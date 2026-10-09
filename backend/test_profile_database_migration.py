import hashlib
import json
import os
import sqlite3
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from backend.profile_database_migration import MigrationError, _browser_inventory, _migrate_profile_databases_in_place, _source_material, _write_stage_owner, migrate_profile_databases, verify_profile_migration


DATABASES = ("signalflow-control-plane.sqlite3", "signalflow-worker.sqlite3")


def create_database(path: Path, *, invalid_foreign_key: bool = False) -> None:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA wal_autocheckpoint=0")
    connection.execute("CREATE TABLE parent (id INTEGER PRIMARY KEY)")
    connection.execute("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
    connection.execute("CREATE TABLE child (parent_id INTEGER REFERENCES parent(id))")
    connection.executemany("INSERT INTO records(value) VALUES (?)", [("one",), ("two",)])
    connection.execute("INSERT INTO child(parent_id) VALUES (?)", (999,) if invalid_foreign_key else (None,))
    connection.commit()
    connection.close()


def source_fingerprints(root: Path) -> dict[str, str]:
    result = {}
    for name in DATABASES:
        for suffix in ("", "-wal", "-shm"):
            path = root / f"{name}{suffix}"
            if path.exists():
                result[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


class ProfileDatabaseMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="signalflow-profile-migration-")
        self.root = Path(self.temp.name)
        self.source = self.root / "legacy"
        self.destination = self.root / "profiles" / "profile-bavy"
        self.source.mkdir()
        for name in DATABASES:
            create_database(self.source / name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_online_backup_verifies_counts_preserves_sources_and_publishes_marker_last(self) -> None:
        before = source_fingerprints(self.source)
        replacements = []

        def record_replace(source: str, destination: str) -> None:
            replacements.append(Path(destination).name)
            os.replace(source, destination)

        marker = migrate_profile_databases(
            "profile-bavy", self.source, self.destination,
            verified_at="2026-09-12T00:00:00Z", replace_func=record_replace,
        )

        self.assertEqual(marker["version"], 2)
        self.assertEqual(marker["profileId"], "profile-bavy")
        self.assertEqual(marker["integrityCheck"], "ok")
        self.assertEqual(marker["foreignKeyCheck"], "ok")
        self.assertTrue(marker["recordCountsVerified"])
        self.assertTrue(marker["sourcePreserved"])
        self.assertEqual(marker["verifiedAt"], "2026-09-12T00:00:00Z")
        self.assertEqual(marker["recordCounts"][DATABASES[0]]["records"], 2)
        self.assertEqual(replacements[-1], "profile-migration-v2.json")
        after = source_fingerprints(self.source)
        self.assertTrue(all(after.get(name) == digest for name, digest in before.items()))
        self.assertTrue(verify_profile_migration("profile-bavy", self.destination))

    def test_uncheckpointed_wal_data_survives_backup_when_sqlite_rebuilds_shm(self) -> None:
        database_name = DATABASES[0]
        source_path = self.source / database_name
        for suffix in ("", "-wal", "-shm"):
            (self.source / f"{database_name}{suffix}").unlink(missing_ok=True)
        subprocess.run(
            [
                sys.executable,
                "-c",
                textwrap.dedent(
                    """
                    import os, sqlite3, sys
                    connection = sqlite3.connect(sys.argv[1])
                    connection.execute("PRAGMA journal_mode=WAL")
                    connection.execute("PRAGMA wal_autocheckpoint=0")
                    connection.execute("CREATE TABLE wal_records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
                    connection.executemany("INSERT INTO wal_records(value) VALUES (?)", [("one",), ("two",)])
                    connection.commit()
                    os._exit(0)
                    """
                ),
                str(source_path),
            ],
            check=True,
        )
        wal_path = self.source / f"{database_name}-wal"
        shm_path = self.source / f"{database_name}-shm"
        self.assertTrue(wal_path.exists())
        before = source_fingerprints(self.source)
        marker = migrate_profile_databases("profile-bavy", self.source, self.destination)
        with sqlite3.connect(self.destination / database_name) as migrated:
            self.assertEqual(migrated.execute("SELECT COUNT(*) FROM wal_records").fetchone()[0], 2)
        self.assertEqual(source_fingerprints(self.source), before)
        self.assertEqual(marker["sourceFilesVerified"], before)
        self.assertTrue(verify_profile_migration("profile-bavy", self.destination))

    def test_corrupt_source_is_rejected_without_a_marker_or_destination(self) -> None:
        (self.source / DATABASES[1]).write_bytes(b"not a sqlite database")

        with self.assertRaises(MigrationError) as raised:
            migrate_profile_databases("profile-bavy", self.source, self.destination)

        self.assertEqual(raised.exception.code, "PROFILE_MIGRATION_SOURCE_INVALID")
        self.assertFalse((self.destination / "profile-migration-v2.json").exists())
        self.assertFalse(any((self.destination / name).exists() for name in DATABASES))

    def test_symlinked_database_source_is_rejected_without_importing_out_of_root_rows(self) -> None:
        outside_root = self.root / "outside"
        outside_root.mkdir()
        outside_database = outside_root / DATABASES[0]
        create_database(outside_database)
        with sqlite3.connect(outside_database) as outside:
            outside.execute("INSERT INTO records(value) VALUES ('must never be imported')")
        (self.source / DATABASES[0]).unlink()
        (self.source / DATABASES[0]).symlink_to(outside_database)

        with self.assertRaises(MigrationError) as raised:
            migrate_profile_databases("profile-bavy", self.source, self.destination)

        self.assertEqual(raised.exception.code, "PROFILE_MIGRATION_SOURCE_PATH_INVALID")
        self.assertFalse(self.destination.exists())

    def test_symlinked_wal_and_shm_components_are_rejected(self) -> None:
        outside = self.root / "outside-sidecar"
        outside.write_bytes(b"external sqlite sidecar")
        for suffix in ("-wal", "-shm"):
            source_component = self.source / f"{DATABASES[0]}{suffix}"
            source_component.symlink_to(outside)
            try:
                with self.subTest(suffix=suffix):
                    with self.assertRaises(MigrationError) as raised:
                        migrate_profile_databases("profile-bavy", self.source, self.destination)
                    self.assertEqual(raised.exception.code, "PROFILE_MIGRATION_SOURCE_PATH_INVALID")
                    self.assertFalse(self.destination.exists())
            finally:
                source_component.unlink()

    def test_foreign_key_invalid_source_is_rejected(self) -> None:
        connection = sqlite3.connect(self.source / DATABASES[0])
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("INSERT INTO child(parent_id) VALUES (12345)")
        connection.commit()
        connection.close()

        with self.assertRaises(MigrationError) as raised:
            migrate_profile_databases("profile-bavy", self.source, self.destination)

        self.assertEqual(raised.exception.code, "PROFILE_MIGRATION_FOREIGN_KEY_INVALID")
        self.assertFalse((self.destination / "profile-migration-v2.json").exists())

    def test_record_count_mismatch_rolls_back_all_staged_destinations(self) -> None:
        def omit_rows(source: sqlite3.Connection, destination: sqlite3.Connection) -> None:
            source.backup(destination)
            destination.execute("DELETE FROM records")
            destination.commit()

        with self.assertRaises(MigrationError) as raised:
            migrate_profile_databases("profile-bavy", self.source, self.destination, backup_func=omit_rows)

        self.assertEqual(raised.exception.code, "PROFILE_MIGRATION_RECORD_COUNT_MISMATCH")
        self.assertFalse((self.destination / "profile-migration-v2.json").exists())
        self.assertFalse(any((self.destination / name).exists() for name in DATABASES))

    def test_second_atomic_publish_failure_removes_first_destination_and_marker(self) -> None:
        original_replace = os.replace
        calls = 0

        def fail_second_publish(source: str, destination: str) -> None:
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("injected publish failure")
            original_replace(source, destination)

        with self.assertRaises(MigrationError) as raised:
            migrate_profile_databases("profile-bavy", self.source, self.destination, replace_func=fail_second_publish)

        self.assertEqual(raised.exception.code, "PROFILE_MIGRATION_PUBLISH_FAILED")
        self.assertFalse((self.destination / "profile-migration-v2.json").exists())
        self.assertFalse(any((self.destination / name).exists() for name in DATABASES))

    def test_restart_atomically_publishes_a_complete_staged_profile_after_crash(self) -> None:
        stage_container = self.destination.parent / ".profile-bavy.migration-crashed"
        stage_profile = stage_container / "profiles" / "profile-bavy"
        stage_profile.mkdir(parents=True)
        _write_stage_owner(stage_container, "profile-bavy", _source_material(self.source, {}), {})
        sqlite_snapshot = stage_container / "sqlite-source"
        sqlite_snapshot.mkdir()
        for database_name in DATABASES:
            shutil.copyfile(self.source / database_name, sqlite_snapshot / database_name)
            wal = self.source / f"{database_name}-wal"
            if wal.is_file():
                shutil.copyfile(wal, sqlite_snapshot / wal.name)
        _migrate_profile_databases_in_place("profile-bavy", sqlite_snapshot, stage_profile, verified_at="2026-09-12T00:00:00Z")
        owner_path = stage_container / ".profile-migration-stage.json"
        owner = json.loads(owner_path.read_text(encoding="utf-8"))
        owner["pid"] = 0
        owner_path.write_text(json.dumps(owner), encoding="utf-8")

        marker = migrate_profile_databases("profile-bavy", self.source, self.destination)

        self.assertEqual(marker["version"], 2)
        self.assertTrue(all((self.destination / name).is_file() for name in DATABASES))
        self.assertTrue((self.destination / "profile-migration-v2.json").is_file())
        self.assertFalse(stage_container.exists())
        self.assertTrue(verify_profile_migration("profile-bavy", self.destination))

    def test_v1_marker_never_proves_existing_destination_databases(self) -> None:
        self.destination.mkdir(parents=True)
        for name in DATABASES:
            (self.destination / name).write_bytes(b"existing destination")
        (self.destination / "profile-migration-v1.json").write_text(json.dumps({
            "version": 1, "profileId": "profile-bavy", "sourcePreserved": True,
        }), encoding="utf-8")

        with self.assertRaises(MigrationError) as raised:
            migrate_profile_databases("profile-bavy", self.source, self.destination)

        self.assertEqual(raised.exception.code, "PROFILE_MIGRATION_DESTINATION_EXISTS_UNVERIFIED")
        self.assertEqual((self.destination / DATABASES[0]).read_bytes(), b"existing destination")

    def test_verified_owner_database_can_change_after_migration_but_invalid_foreign_keys_fail(self) -> None:
        migrate_profile_databases("profile-bavy", self.source, self.destination)
        database = self.destination / DATABASES[0]
        connection = sqlite3.connect(database)
        connection.execute("INSERT INTO records(value) VALUES ('created after migration')")
        connection.commit()
        self.assertTrue(verify_profile_migration("profile-bavy", self.destination))
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("INSERT INTO child(parent_id) VALUES (54321)")
        connection.commit()
        connection.close()

        self.assertFalse(verify_profile_migration("profile-bavy", self.destination))

    def test_browser_only_owner_migration_copies_closed_profile_and_records_inventory_proof(self) -> None:
        browser_source = self.source / "account-profiles" / "gemini"
        browser_source.mkdir(parents=True)
        (browser_source / "Preferences").write_text("profile preferences", encoding="utf-8")
        (browser_source / "Default").mkdir()
        (browser_source / "Default" / "Bookmarks").write_text("profile bookmarks", encoding="utf-8")
        entries, inventory_hash, total_bytes = _browser_inventory(browser_source)
        staging_root = self.root / "browser-staging-test"
        staging_root.mkdir(parents=True)
        shutil.copytree(browser_source, staging_root / "gemini")
        proof = {
            "gemini": {
                "relativeRoot": "account-profiles/gemini",
                "fileCount": len(entries),
                "totalBytes": total_bytes,
                "inventorySha256": inventory_hash,
                "ownerVerifiedClosed": True,
                "sourcePreserved": True,
            }
        }

        marker = migrate_profile_databases(
            "profile-bavy", self.source, self.destination,
            browser_staging_root=staging_root, browser_profiles=proof,
        )

        migrated = self.destination / "account-profiles" / "gemini"
        self.assertEqual(marker["browserProfiles"], proof)
        self.assertEqual((migrated / "Default" / "Bookmarks").read_text(encoding="utf-8"), "profile bookmarks")
        self.assertEqual(_browser_inventory(browser_source)[1:], (inventory_hash, total_bytes))
        (migrated / "Preferences").write_text("normal later browser update", encoding="utf-8")
        self.assertTrue(verify_profile_migration("profile-bavy", self.destination))


if __name__ == "__main__":
    unittest.main()
