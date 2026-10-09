"""Verified one-time migration of the two owner SQLite databases."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import uuid
import shutil
import stat
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from typing import Callable


DATABASES = ("signalflow-control-plane.sqlite3", "signalflow-worker.sqlite3")
SIDECARS = ("", "-wal", "-shm")
CHROME_PROVIDERS = ("gemini", "chatgpt", "drive", "flow", "meta")
PROFILE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class MigrationError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _profile_id(value: str) -> str:
    if not isinstance(value, str) or not PROFILE_ID_PATTERN.fullmatch(value):
        raise MigrationError("PROFILE_ID_INVALID")
    return value


def _profile_root(profile_id: str, destination_root: str | os.PathLike[str]) -> Path:
    safe_id = _profile_id(profile_id)
    root = Path(destination_root).resolve()
    if root.name != safe_id or root.parent.name != "profiles":
        raise MigrationError("PROFILE_MIGRATION_DESTINATION_INVALID")
    return root


def _readonly_connection(database: Path) -> sqlite3.Connection:
    uri = f"file:{quote(str(database), safe='/:')}?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=5)
    connection.execute("PRAGMA query_only=ON")
    return connection


def _table_counts(connection: sqlite3.Connection) -> dict[str, int]:
    tables = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    counts = {}
    for (name,) in tables:
        quoted_name = '"' + name.replace('"', '""') + '"'
        counts[name] = int(connection.execute(f"SELECT COUNT(*) FROM {quoted_name}").fetchone()[0])
    return counts


def _check_database(connection: sqlite3.Connection) -> tuple[str, list[tuple[object, ...]]]:
    integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0]).lower()
    foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
    return integrity, foreign_keys


def _open_source_component(source_root: Path, filename: str) -> int | None:
    root = source_root.resolve(strict=True)
    if not root.is_dir():
        raise MigrationError("PROFILE_MIGRATION_SOURCE_PATH_INVALID")
    source = root / filename
    try:
        before = source.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(before.st_mode):
        raise MigrationError("PROFILE_MIGRATION_SOURCE_PATH_INVALID")
    try:
        resolved = source.resolve(strict=True)
    except OSError as error:
        raise MigrationError("PROFILE_MIGRATION_SOURCE_PATH_INVALID") from error
    if not resolved.is_relative_to(root):
        raise MigrationError("PROFILE_MIGRATION_SOURCE_PATH_INVALID")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(source, flags)
    except OSError as error:
        raise MigrationError("PROFILE_MIGRATION_SOURCE_PATH_INVALID") from error
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise MigrationError("PROFILE_MIGRATION_SOURCE_PATH_INVALID")
        resolved_after_open = source.resolve(strict=True)
        if not resolved_after_open.is_relative_to(root):
            raise MigrationError("PROFILE_MIGRATION_SOURCE_PATH_INVALID")
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _fingerprint_source_component(source_root: Path, filename: str) -> str | None:
    descriptor = _open_source_component(source_root, filename)
    if descriptor is None:
        return None
    digest = hashlib.sha256()
    with os.fdopen(descriptor, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _copy_source_component(source_root: Path, filename: str, destination: Path) -> bool:
    descriptor = _open_source_component(source_root, filename)
    if descriptor is None:
        return False
    with os.fdopen(descriptor, "rb") as source_stream, open(destination, "xb") as destination_stream:
        shutil.copyfileobj(source_stream, destination_stream, length=1024 * 1024)
        destination_stream.flush()
        os.fsync(destination_stream.fileno())
    os.chmod(destination, 0o600)
    return True


def _source_fingerprints(source_root: Path) -> dict[str, str]:
    fingerprints: dict[str, str] = {}
    for database_name in DATABASES:
        for suffix in SIDECARS:
            filename = f"{database_name}{suffix}"
            fingerprint = _fingerprint_source_component(source_root, filename)
            if fingerprint is not None:
                fingerprints[filename] = fingerprint
    return fingerprints


def _durable_source_fingerprints(source_root: Path) -> dict[str, str]:
    durable = {"", "-wal"}
    return {
        name: fingerprint
        for name, fingerprint in _source_fingerprints(source_root).items()
        if any(name == f"{database}{suffix}" for database in DATABASES for suffix in durable)
    }


def _browser_inventory(root: Path) -> tuple[list[dict[str, object]], str, int]:
    if not root.is_dir() or root.is_symlink():
        raise MigrationError("PROFILE_BROWSER_SOURCE_INVALID")
    entries: list[dict[str, object]] = []
    total_bytes = 0
    for directory, child_directories, filenames in os.walk(root, followlinks=False):
        base = Path(directory)
        for name in child_directories:
            if (base / name).is_symlink():
                raise MigrationError("PROFILE_BROWSER_SOURCE_SYMLINK")
        for name in filenames:
            item = base / name
            mode = item.lstat().st_mode
            if not stat.S_ISREG(mode):
                raise MigrationError("PROFILE_BROWSER_SOURCE_INVALID")
            digest = hashlib.sha256()
            with item.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            size = item.stat().st_size
            total_bytes += size
            entries.append({"path": item.relative_to(root).as_posix(), "bytes": size, "sha256": digest.hexdigest()})
    entries.sort(key=lambda entry: str(entry["path"]))
    serialized = json.dumps(entries, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return entries, hashlib.sha256(serialized).hexdigest(), total_bytes


def _validate_browser_profiles(
    profile_root: Path,
    source_root: Path,
    browser_staging_root: str | os.PathLike[str] | None,
    browser_profiles: dict[str, dict[str, object]] | None,
) -> tuple[Path | None, dict[str, dict[str, object]]]:
    proof = browser_profiles or {}
    if not isinstance(proof, dict) or any(provider not in CHROME_PROVIDERS for provider in proof):
        raise MigrationError("PROFILE_BROWSER_MIGRATION_PROOF_INVALID")
    if proof and not browser_staging_root:
        raise MigrationError("PROFILE_BROWSER_MIGRATION_PROOF_INVALID")
    staging = Path(browser_staging_root).resolve() if browser_staging_root else None
    if staging and not staging.is_relative_to(profile_root):
        raise MigrationError("PROFILE_BROWSER_STAGE_PATH_INVALID")
    for provider, record in proof.items():
        if (
            not isinstance(record, dict)
            or record.get("relativeRoot") != f"account-profiles/{provider}"
            or record.get("ownerVerifiedClosed") is not True
            or record.get("sourcePreserved") is not True
        ):
            raise MigrationError("PROFILE_BROWSER_MIGRATION_PROOF_INVALID")
        source = source_root / "account-profiles" / provider
        staged = staging / provider if staging else None
        if staged is None or not staged.is_dir():
            raise MigrationError("PROFILE_BROWSER_STAGE_MISSING")
        for directory, _, filenames in os.walk(staged, followlinks=False):
            if any((Path(directory) / name).is_symlink() for name in filenames):
                raise MigrationError("PROFILE_BROWSER_SOURCE_SYMLINK")
        source_entries, source_hash, source_bytes = _browser_inventory(source)
        _, stage_hash, stage_bytes = _browser_inventory(staged)
        if source_hash != record.get("inventorySha256") or source_bytes != record.get("totalBytes"):
            raise MigrationError("PROFILE_BROWSER_SOURCE_CHANGED")
        if stage_hash != source_hash or stage_bytes != source_bytes or record.get("fileCount") != len(source_entries):
            raise MigrationError("PROFILE_BROWSER_INVENTORY_MISMATCH")
        if (profile_root / "account-profiles" / provider).exists():
            raise MigrationError("PROFILE_BROWSER_DESTINATION_EXISTS_UNVERIFIED")
    return staging, proof


def _marker_path(profile_root: Path) -> Path:
    return profile_root / "profile-migration-v2.json"


def verify_profile_migration(profile_id: str, destination_root: str | os.PathLike[str]) -> bool:
    try:
        root = _profile_root(profile_id, destination_root)
        marker = json.loads(_marker_path(root).read_text(encoding="utf-8"))
        if not (
            marker.get("version") == 2
            and marker.get("profileId") == profile_id
            and marker.get("integrityCheck") == "ok"
            and marker.get("foreignKeyCheck") == "ok"
            and marker.get("recordCountsVerified") is True
            and marker.get("sourcePreserved") is True
            and isinstance(marker.get("sourceFilesVerified"), dict)
            and isinstance(marker.get("verifiedAt"), str)
            and marker.get("recordCounts")
            and isinstance(marker.get("browserProfiles"), dict)
        ):
            return False
        for provider, proof in marker["browserProfiles"].items():
            if provider not in CHROME_PROVIDERS or not isinstance(proof, dict):
                return False
            if not (
                proof.get("relativeRoot") == f"account-profiles/{provider}"
                and proof.get("ownerVerifiedClosed") is True
                and proof.get("sourcePreserved") is True
                and type(proof.get("fileCount")) is int
                and type(proof.get("totalBytes")) is int
                and isinstance(proof.get("inventorySha256"), str)
            ):
                return False
            if not (root / "account-profiles" / provider).is_dir():
                return False
        for database_name in DATABASES:
            historical_counts = marker["recordCounts"].get(database_name)
            if not isinstance(historical_counts, dict) or any(
                not isinstance(name, str) or type(count) is not int or count < 0
                for name, count in historical_counts.items()
            ):
                return False
            database = root / database_name
            if not database.is_file():
                return False
            with closing(_readonly_connection(database)) as connection:
                integrity, foreign_keys = _check_database(connection)
                if integrity != "ok" or foreign_keys:
                    return False
        for name, digest in marker["sourceFilesVerified"].items():
            if not isinstance(name, str) or not isinstance(digest, str) or re.fullmatch(r"[a-f0-9]{64}", digest) is None:
                return False
        return True
    except (OSError, ValueError, TypeError, KeyError, sqlite3.Error, MigrationError):
        return False


def _migrate_profile_databases_in_place(
    profile_id: str,
    source_root: str | os.PathLike[str],
    destination_root: str | os.PathLike[str],
    *,
    verified_at: str | None = None,
    backup_func: Callable[[sqlite3.Connection, sqlite3.Connection], None] | None = None,
    replace_func: Callable[[str | os.PathLike[str], str | os.PathLike[str]], None] = os.replace,
    browser_staging_root: str | os.PathLike[str] | None = None,
    browser_profiles: dict[str, dict[str, object]] | None = None,
    browser_source_root: str | os.PathLike[str] | None = None,
    source_files_verified: dict[str, str] | None = None,
) -> dict[str, object]:
    safe_id = _profile_id(profile_id)
    source = Path(source_root).resolve()
    destination = _profile_root(safe_id, destination_root)
    if source == destination:
        raise MigrationError("PROFILE_MIGRATION_SOURCE_INVALID")
    source_fingerprints = _source_fingerprints(source)

    marker_path = _marker_path(destination)
    if marker_path.exists():
        if verify_profile_migration(safe_id, destination):
            existing_marker = json.loads(marker_path.read_text(encoding="utf-8"))
            if set(browser_profiles or {}) - set(existing_marker.get("browserProfiles", {})):
                raise MigrationError("PROFILE_BROWSER_MIGRATION_PROOF_INVALID")
            return existing_marker
        raise MigrationError("PROFILE_MIGRATION_PROOF_INVALID")

    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    browser_source = Path(browser_source_root).resolve() if browser_source_root else source
    browser_stage, browser_proof = _validate_browser_profiles(destination, browser_source, browser_staging_root, browser_profiles)
    destination_paths = [destination / name for name in DATABASES]
    if any(path.exists() for path in destination_paths):
        raise MigrationError("PROFILE_MIGRATION_DESTINATION_EXISTS_UNVERIFIED")
    source_names = set(source_fingerprints)
    source_paths = [source / name for name in DATABASES]
    present = [name in source_names for name in DATABASES]
    any_database_source = bool(source_names)
    if any_database_source and not all(present):
        raise MigrationError("PROFILE_MIGRATION_SOURCE_INCOMPLETE")
    if not any_database_source and not browser_proof:
        raise MigrationError("PROFILE_MIGRATION_SOURCE_INCOMPLETE")

    source_before = _durable_source_fingerprints(source) if any_database_source else {}
    staged_paths = [destination / f".{name}.{uuid.uuid4().hex}.tmp" for name in DATABASES]
    published: list[Path] = []
    marker_temp = destination / f".profile-migration-v2.{uuid.uuid4().hex}.tmp"
    counts: dict[str, dict[str, int]] = {}
    default_backup = lambda source_connection, target_connection: source_connection.backup(target_connection)
    backup = backup_func or default_backup
    try:
        for source_path, staged_path, database_name in zip(source_paths, staged_paths, DATABASES):
            if not any_database_source:
                target_connection = sqlite3.connect(staged_path, timeout=5)
                try:
                    target_integrity, target_foreign_keys = _check_database(target_connection)
                    if target_integrity != "ok" or target_foreign_keys:
                        raise MigrationError("PROFILE_MIGRATION_BACKUP_INVALID")
                    target_connection.commit()
                finally:
                    target_connection.close()
                counts[database_name] = {}
                continue
            try:
                source_connection = _readonly_connection(source_path)
            except sqlite3.Error as error:
                raise MigrationError("PROFILE_MIGRATION_SOURCE_INVALID") from error
            with closing(source_connection):
                try:
                    source_integrity, source_foreign_keys = _check_database(source_connection)
                except sqlite3.Error as error:
                    raise MigrationError("PROFILE_MIGRATION_SOURCE_INVALID") from error
                if source_integrity != "ok":
                    raise MigrationError("PROFILE_MIGRATION_SOURCE_INVALID")
                if source_foreign_keys:
                    raise MigrationError("PROFILE_MIGRATION_FOREIGN_KEY_INVALID")
                source_counts = _table_counts(source_connection)
                target_connection = sqlite3.connect(staged_path, timeout=5)
                try:
                    backup(source_connection, target_connection)
                    try:
                        target_integrity, target_foreign_keys = _check_database(target_connection)
                        target_counts = _table_counts(target_connection)
                    except sqlite3.Error as error:
                        raise MigrationError("PROFILE_MIGRATION_BACKUP_INVALID") from error
                    if target_integrity != "ok":
                        raise MigrationError("PROFILE_MIGRATION_BACKUP_INVALID")
                    if target_foreign_keys:
                        raise MigrationError("PROFILE_MIGRATION_FOREIGN_KEY_INVALID")
                    target_connection.commit()
                finally:
                    target_connection.close()
                if source_counts != target_counts:
                    raise MigrationError("PROFILE_MIGRATION_RECORD_COUNT_MISMATCH")
                counts[database_name] = target_counts

        source_after = _durable_source_fingerprints(source) if any_database_source else {}
        if any(source_after.get(name) != digest for name, digest in source_before.items()):
            raise MigrationError("PROFILE_MIGRATION_SOURCE_CHANGED")
        for provider, record in browser_proof.items():
            _, source_hash, source_bytes = _browser_inventory(browser_source / "account-profiles" / provider)
            if source_hash != record["inventorySha256"] or source_bytes != record["totalBytes"]:
                raise MigrationError("PROFILE_BROWSER_SOURCE_CHANGED")

        marker: dict[str, object] = {
            "version": 2,
            "profileId": safe_id,
            "integrityCheck": "ok",
            "foreignKeyCheck": "ok",
            "recordCountsVerified": True,
            "recordCounts": counts,
            "sourcePreserved": True,
            "sourceFilesVerified": source_files_verified if source_files_verified is not None else source_before,
            "browserProfiles": browser_proof,
            "verifiedAt": verified_at or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }
        for staged_path, destination_path in zip(staged_paths, destination_paths):
            replace_func(staged_path, destination_path)
            published.append(destination_path)
        for provider in browser_proof:
            staged_profile = browser_stage / provider if browser_stage else None
            destination_profile = destination / "account-profiles" / provider
            if staged_profile is None:
                raise MigrationError("PROFILE_BROWSER_STAGE_MISSING")
            destination_profile.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            replace_func(staged_profile, destination_profile)
            published.append(destination_profile)
        with open(marker_temp, "x", encoding="utf-8") as marker_file:
            os.chmod(marker_temp, 0o600)
            json.dump(marker, marker_file, sort_keys=True, separators=(",", ":"))
            marker_file.write("\n")
            marker_file.flush()
            os.fsync(marker_file.fileno())
        replace_func(marker_temp, marker_path)
        try:
            directory_fd = os.open(destination, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            pass
        return marker
    except MigrationError:
        raise
    except (OSError, sqlite3.Error, ValueError, TypeError) as error:
        raise MigrationError("PROFILE_MIGRATION_PUBLISH_FAILED" if published else "PROFILE_MIGRATION_FAILED") from error
    finally:
        for temporary in (*staged_paths, marker_temp):
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
        if not marker_path.exists():
            for destination_path in published:
                try:
                    if destination_path.is_dir() and not destination_path.is_symlink():
                        shutil.rmtree(destination_path)
                    else:
                        destination_path.unlink()
                except FileNotFoundError:
                    pass


def _source_material(source_root: Path, browser_profiles: dict[str, dict[str, object]] | None) -> dict[str, object]:
    browser_material = {}
    for provider, proof in (browser_profiles or {}).items():
        _, inventory_hash, total_bytes = _browser_inventory(source_root / "account-profiles" / provider)
        browser_material[provider] = {"inventorySha256": inventory_hash, "totalBytes": total_bytes}
    return {"databaseFiles": _source_fingerprints(source_root), "browserProfiles": browser_material}


def _stage_owner_path(stage_container: Path) -> Path:
    return stage_container / ".profile-migration-stage.json"


def _write_stage_owner(stage_container: Path, profile_id: str, source_material: dict[str, object], browser_profiles: dict[str, dict[str, object]]) -> None:
    owner_path = _stage_owner_path(stage_container)
    temporary = stage_container / f".profile-migration-stage.{uuid.uuid4().hex}.tmp"
    with open(temporary, "x", encoding="utf-8") as owner_file:
        os.chmod(temporary, 0o600)
        json.dump({
            "version": 1,
            "profileId": profile_id,
            "pid": os.getpid(),
            "sourceMaterial": source_material,
            "browserProfiles": browser_profiles,
        }, owner_file, sort_keys=True, separators=(",", ":"))
        owner_file.write("\n")
        owner_file.flush()
        os.fsync(owner_file.fileno())
    os.replace(temporary, owner_path)


def _process_is_alive(pid: object) -> bool:
    if type(pid) is not int or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def _publish_profile_directory(stage_profile_root: Path, destination: Path, publish_func: Callable = os.replace) -> None:
    if destination.exists():
        if destination.is_symlink() or not destination.is_dir():
            raise MigrationError("PROFILE_MIGRATION_DESTINATION_EXISTS_UNVERIFIED")
        try:
            next(destination.iterdir())
        except StopIteration:
            destination.rmdir()
        else:
            raise MigrationError("PROFILE_MIGRATION_DESTINATION_EXISTS_UNVERIFIED")
    publish_func(stage_profile_root, destination)
    try:
        directory_fd = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError:
        pass


def _recover_staging_directories(
    profile_id: str,
    source_root: Path,
    destination: Path,
    browser_profiles: dict[str, dict[str, object]],
    publish_func: Callable,
) -> dict[str, object] | None:
    for stage_container in sorted(destination.parent.glob(f".{profile_id}.migration-*")):
        if stage_container.is_symlink() or not stage_container.is_dir():
            raise MigrationError("PROFILE_MIGRATION_STAGING_UNVERIFIED")
        owner_path = _stage_owner_path(stage_container)
        try:
            owner = json.loads(owner_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            children = list(stage_container.iterdir())
            if any(
                child.is_symlink()
                or child.is_dir()
                or not child.name.startswith(".profile-migration-stage.")
                for child in children
            ):
                raise MigrationError("PROFILE_MIGRATION_STAGING_UNVERIFIED")
            shutil.rmtree(stage_container)
            continue
        except (OSError, ValueError):
            raise MigrationError("PROFILE_MIGRATION_STAGING_UNVERIFIED")
        if owner.get("version") != 1 or owner.get("profileId") != profile_id:
            raise MigrationError("PROFILE_MIGRATION_STAGING_UNVERIFIED")
        if _process_is_alive(owner.get("pid")):
            raise MigrationError("PROFILE_MIGRATION_IN_PROGRESS")
        try:
            source_material = _source_material(source_root, browser_profiles)
        except MigrationError:
            raise
        except (OSError, ValueError):
            raise MigrationError("PROFILE_MIGRATION_SOURCE_INVALID")
        if owner.get("sourceMaterial") != source_material or owner.get("browserProfiles") != browser_profiles:
            raise MigrationError("PROFILE_MIGRATION_SOURCE_CHANGED")
        stage_profile_root = stage_container / "profiles" / profile_id
        marker_path = _marker_path(stage_profile_root)
        if marker_path.exists():
            if not verify_profile_migration(profile_id, stage_profile_root):
                raise MigrationError("PROFILE_MIGRATION_STAGING_UNVERIFIED")
            marker = json.loads(marker_path.read_text(encoding="utf-8"))
            stage_browser_root = stage_profile_root / ".browser-staging"
            if stage_browser_root.exists():
                shutil.rmtree(stage_browser_root)
            for provider, proof in browser_profiles.items():
                _, inventory_hash, total_bytes = _browser_inventory(stage_profile_root / "account-profiles" / provider)
                if inventory_hash != proof.get("inventorySha256") or total_bytes != proof.get("totalBytes"):
                    raise MigrationError("PROFILE_BROWSER_INVENTORY_MISMATCH")
            sqlite_snapshot = stage_container / "sqlite-source"
            if sqlite_snapshot.exists():
                shutil.rmtree(sqlite_snapshot)
            _publish_profile_directory(stage_profile_root, destination, publish_func)
            shutil.rmtree(stage_container)
            return marker
        shutil.rmtree(stage_container)
    return None


def migrate_profile_databases(
    profile_id: str,
    source_root: str | os.PathLike[str],
    destination_root: str | os.PathLike[str],
    *,
    verified_at: str | None = None,
    backup_func: Callable[[sqlite3.Connection, sqlite3.Connection], None] | None = None,
    replace_func: Callable[[str | os.PathLike[str], str | os.PathLike[str]], None] = os.replace,
    publish_profile_func: Callable[[str | os.PathLike[str], str | os.PathLike[str]], None] = os.replace,
    browser_staging_root: str | os.PathLike[str] | None = None,
    browser_profiles: dict[str, dict[str, object]] | None = None,
) -> dict[str, object]:
    safe_id = _profile_id(profile_id)
    source = Path(source_root).resolve()
    destination = _profile_root(safe_id, destination_root)
    if source == destination:
        raise MigrationError("PROFILE_MIGRATION_SOURCE_INVALID")
    marker_path = _marker_path(destination)
    if marker_path.exists():
        if verify_profile_migration(safe_id, destination):
            existing = json.loads(marker_path.read_text(encoding="utf-8"))
            if set(browser_profiles or {}) - set(existing.get("browserProfiles", {})):
                raise MigrationError("PROFILE_BROWSER_MIGRATION_PROOF_INVALID")
            return existing
        raise MigrationError("PROFILE_MIGRATION_PROOF_INVALID")

    browser_proof = browser_profiles or {}
    source_before = _source_fingerprints(source)
    source_material = _source_material(source, browser_proof)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    recovered = _recover_staging_directories(safe_id, source, destination, browser_proof, publish_profile_func)
    if recovered is not None:
        return recovered

    stage_container = destination.parent / f".{safe_id}.migration-{uuid.uuid4().hex}"
    stage_container.mkdir(mode=0o700)
    try:
        _write_stage_owner(stage_container, safe_id, source_material, browser_proof)
        sqlite_snapshot = stage_container / "sqlite-source"
        sqlite_snapshot.mkdir(mode=0o700)
        source_names = set(source_before)
        any_database_source = bool(source_names)
        if any_database_source:
            for database_name in DATABASES:
                if database_name not in source_names:
                    raise MigrationError("PROFILE_MIGRATION_SOURCE_INCOMPLETE")
                if not _copy_source_component(source, database_name, sqlite_snapshot / database_name):
                    raise MigrationError("PROFILE_MIGRATION_SOURCE_INCOMPLETE")
                wal_name = f"{database_name}-wal"
                if wal_name in source_names and not _copy_source_component(source, wal_name, sqlite_snapshot / wal_name):
                    raise MigrationError("PROFILE_MIGRATION_SOURCE_CHANGED")
            if _source_fingerprints(source) != source_before:
                raise MigrationError("PROFILE_MIGRATION_SOURCE_CHANGED")
        stage_profile_root = stage_container / "profiles" / safe_id
        stage_profile_root.mkdir(parents=True, mode=0o700)
        stage_browser_root = stage_profile_root / ".browser-staging"
        if browser_proof:
            stage_browser_root.mkdir(mode=0o700)
            input_root = Path(browser_staging_root).resolve() if browser_staging_root else None
            for provider in browser_proof:
                browser_source = input_root / provider if input_root else source / "account-profiles" / provider
                shutil.copytree(browser_source, stage_browser_root / provider, symlinks=False)
    except BaseException:
        if stage_container.exists(): shutil.rmtree(stage_container)
        raise
    try:
        marker = _migrate_profile_databases_in_place(
            safe_id, sqlite_snapshot, stage_profile_root,
            verified_at=verified_at,
            backup_func=backup_func,
            replace_func=replace_func,
            browser_staging_root=stage_browser_root if browser_proof else None,
            browser_profiles=browser_proof,
            browser_source_root=source,
            source_files_verified=source_before,
        )
        if browser_proof:
            shutil.rmtree(stage_browser_root)
        if _source_fingerprints(source) != source_before:
            raise MigrationError("PROFILE_MIGRATION_SOURCE_CHANGED")
        if not verify_profile_migration(safe_id, stage_profile_root):
            raise MigrationError("PROFILE_MIGRATION_STAGING_UNVERIFIED")
        for provider, proof in browser_proof.items():
            _, inventory_hash, total_bytes = _browser_inventory(stage_profile_root / "account-profiles" / provider)
            if inventory_hash != proof.get("inventorySha256") or total_bytes != proof.get("totalBytes"):
                raise MigrationError("PROFILE_BROWSER_INVENTORY_MISMATCH")
        shutil.rmtree(sqlite_snapshot)
        _publish_profile_directory(stage_profile_root, destination, publish_profile_func)
        shutil.rmtree(stage_container)
        return marker
    except BaseException:
        if stage_container.exists():
            shutil.rmtree(stage_container)
        raise


def _main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("migrate", "verify"))
    parser.add_argument("--profile-id", required=True)
    parser.add_argument("--source-root")
    parser.add_argument("--destination-root", required=True)
    parser.add_argument("--browser-staging-root")
    parser.add_argument("--browser-proof-file")
    parser.add_argument("--browser-profiles-json")
    args = parser.parse_args()
    try:
        if args.action == "migrate":
            if not args.source_root:
                raise MigrationError("PROFILE_MIGRATION_SOURCE_INVALID")
            browser_profiles = None
            if args.browser_proof_file:
                browser_profiles = json.loads(Path(args.browser_proof_file).read_text(encoding="utf-8"))
            if args.browser_profiles_json:
                if browser_profiles is not None:
                    raise MigrationError("PROFILE_BROWSER_MIGRATION_PROOF_INVALID")
                browser_profiles = json.loads(args.browser_profiles_json)
            result = migrate_profile_databases(
                args.profile_id, args.source_root, args.destination_root,
                browser_staging_root=args.browser_staging_root,
                browser_profiles=browser_profiles,
            )
            print(json.dumps({"ok": True, "marker": result}, sort_keys=True))
        else:
            print(json.dumps({"ok": verify_profile_migration(args.profile_id, args.destination_root)}))
        return 0
    except MigrationError as error:
        print(json.dumps({"ok": False, "code": error.code}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(_main())
