import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))

from app_state_store import AgencyStateStore, StateValidationError

try:
    from fastapi.testclient import TestClient
    import control_plane_service as service
except ModuleNotFoundError:
    TestClient = None
    service = None


class BrandLifecycleStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.path = Path(self.temp_dir.name) / "agency.sqlite3"
        self.store = AgencyStateStore(self.path)
        self.store.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
        self.store.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
        self.store.bind_brand_actor("brand-a", "user-a", "owner", ["manage_brand"])
        self.store.create_identity({"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
        self.store.create_connection({"id": "connection-a", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a", "displayName": "Page A", "connectionState": "connected", "scopes": []})
        self.store.create_binding({"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})

    def tearDown(self):
        self.store.close()
        self.temp_dir.cleanup()

    @staticmethod
    def actor(role="owner"):
        return {"actorUserId": "user-a", "role": role, "capability": "manage_brand"}

    def bind_actor(self, role="owner"):
        self.store.bind_brand_actor("brand-a", "user-a", role, ["manage_brand"])

    def seed_legacy_publication(self, publication_id, variant_id, state):
        self.store.connection.execute(
            "INSERT INTO target_publications(id, binding_id, variant_id, idempotency_key, approval_state, state, client_id, brand_id, simulation, legacy_non_live, scheduled_at, target_external_id, target_platform) VALUES (?, 'binding-a', ?, ?, 'approved', ?, 'client-a', 'brand-a', 1, 0, ?, 'page-a', 'facebook')",
            (publication_id, variant_id, f"key-{publication_id}", state, "2099-01-05T09:00:00Z"),
        )
        self.store.connection.commit()

    def test_trash_persists_deleted_at_across_restart_and_restore_keeps_plans_paused(self):
        self.bind_actor()
        self.store.create_automation_plan({"id": "plan-a", "brandId": "brand-a", "state": "active", "bindingIds": []})
        trashed = self.store.trash_brand("brand-a", self.actor())
        self.assertEqual(trashed["status"], "archived")
        self.assertTrue(trashed["deletedAt"])
        self.assertEqual(self.store.list_entity("automation_plans", "plan-a")[0]["state"], "paused")
        self.store.close()
        self.store = AgencyStateStore(self.path)
        brand = self.store.list_entity("brands", "brand-a")[0]
        self.assertEqual(brand["status"], "archived")
        self.assertTrue(brand["deletedAt"])
        restored = self.store.restore_brand("brand-a", self.actor())
        self.assertEqual(restored["status"], "draft")
        self.assertIsNone(restored["deletedAt"])
        self.assertEqual(self.store.list_entity("automation_plans", "plan-a")[0]["state"], "paused")

    def test_draft_brand_can_be_trashed_and_restored(self):
        self.bind_actor()
        self.store.connection.execute("UPDATE brands SET status = 'draft' WHERE id = 'brand-a'")
        self.store.connection.commit()
        self.store.trash_brand("brand-a", self.actor())
        self.assertEqual(self.store.list_entity("brands", "brand-a")[0]["status"], "archived")
        self.assertEqual(self.store.restore_brand("brand-a", self.actor())["status"], "draft")

    def test_manage_brand_role_and_capability_are_enforced_at_authority(self):
        self.bind_actor("editor")
        with self.assertRaisesRegex(StateValidationError, "BRAND_MANAGE_FORBIDDEN"):
            self.store.trash_brand("brand-a", self.actor())
        with self.assertRaisesRegex(StateValidationError, "BRAND_ACTOR_REQUIRED"):
            self.store.trash_brand("brand-a", {"role": "owner"})

    def test_actor_identity_is_required_and_role_is_resolved_from_durable_binding(self):
        with self.assertRaisesRegex(StateValidationError, "BRAND_ACTOR_REQUIRED"):
            self.store.trash_brand("brand-a", {"role": "owner", "capability": "manage_brand"})
        self.bind_actor("editor")
        with self.assertRaisesRegex(StateValidationError, "BRAND_MANAGE_FORBIDDEN"):
            self.store.trash_brand("brand-a", self.actor())

    def test_brand_create_and_renderer_migration_seed_durable_owner_bindings(self):
        created = self.store.create_brand({"id": "brand-created", "clientId": "client-a", "name": "Created", "status": "draft", "actor": self.actor()})
        self.assertEqual(created["id"], "brand-created")
        binding = self.store.connection.execute("SELECT role, capabilities_json FROM brand_actor_bindings WHERE brand_id = 'brand-created' AND actor_user_id = 'user-a'").fetchone()
        self.assertIsNotNone(binding)
        self.assertEqual(binding["role"], "owner")
        self.assertIn("manage_brand", json.loads(binding["capabilities_json"]))

        migrated = AgencyStateStore(":memory:")
        try:
            result = migrated.commit_renderer_migration({
                "clients": [{"id": "client-m", "name": "Migrated", "timezone": "UTC", "status": "active"}],
                "brands": [{"id": "brand-m", "clientId": "client-m", "name": "Migrated Brand", "status": "active"}],
                "identities": [], "connections": [], "bindings": [],
                "migrationActor": self.actor(),
            })
            self.assertEqual(result["actorBindingCount"], 1)
            self.assertIsNotNone(migrated.connection.execute("SELECT 1 FROM brand_actor_bindings WHERE brand_id = 'brand-m' AND actor_user_id = 'user-a'").fetchone())
        finally:
            migrated.close()

    def test_already_migrated_store_backfills_only_unbound_brands_idempotently(self):
        self.store.create_brand({"id": "brand-unbound", "clientId": "client-a", "name": "Unbound", "status": "active"})
        self.store.connection.execute("INSERT INTO control_plane_metadata(key, value) VALUES ('control_plane_migrated', 'true')")
        self.store.connection.commit()
        first = self.store.backfill_brand_actor_bindings({"actor": self.actor(), "brandIds": ["brand-a", "brand-unbound"]})
        second = self.store.backfill_brand_actor_bindings({"actor": self.actor(), "brandIds": ["brand-a", "brand-unbound"]})
        self.assertEqual(first["seededCount"], 1)
        self.assertEqual(second["seededCount"], 0)
        self.assertEqual(self.store.connection.execute("SELECT COUNT(*) FROM brand_actor_bindings WHERE brand_id IN ('brand-a', 'brand-unbound')").fetchone()[0], 2)
        self.store.connection.execute("DELETE FROM brand_actor_bindings WHERE brand_id = 'brand-a'")
        self.store.connection.commit()
        with self.assertRaisesRegex(StateValidationError, "BRAND_MANAGE_FORBIDDEN"):
            self.store.trash_brand("brand-a", self.actor())

    def test_trash_blocks_unsent_publication_until_c2_cancel_is_reconciled(self):
        self.bind_actor()
        self.seed_legacy_publication("publication-a", "variant-a", "scheduled")
        with self.assertRaisesRegex(StateValidationError, "BRAND_PUBLICATIONS_RECONCILIATION_REQUIRED"):
            self.store.trash_brand("brand-a", self.actor())
        self.assertEqual(self.store.list_entity("brands", "brand-a")[0]["status"], "active")

    def test_terminal_publication_requires_worker_ack_before_trash(self):
        self.bind_actor()
        self.seed_legacy_publication("publication-canceled", "variant-canceled", "canceled")
        with self.assertRaisesRegex(StateValidationError, "BRAND_PUBLICATIONS_RECONCILIATION_REQUIRED"):
            self.store.trash_brand("brand-a", self.actor())
        self.store.connection.execute("UPDATE target_publications SET worker_ack_state = 'acknowledged' WHERE id = 'publication-canceled'")
        self.store.connection.commit()
        self.assertEqual(self.store.trash_brand("brand-a", self.actor())["status"], "archived")

    def test_failed_publication_is_safe_only_after_durable_worker_failure_ack(self):
        self.bind_actor()
        self.store.create_target_publication({"id": "publication-failed", "bindingId": "binding-a", "variantId": "variant-failed", "clientId": "client-a", "brandId": "brand-a", "idempotencyKey": "key-failed", "approvalState": "approved", "state": "failed", "simulation": False, "scheduledAt": "2099-01-05T09:00:00Z"})
        with self.assertRaisesRegex(StateValidationError, "BRAND_PUBLICATIONS_RECONCILIATION_REQUIRED"):
            self.store.trash_brand("brand-a", self.actor())
        self.store.connection.execute("UPDATE target_publications SET worker_ack_state = 'failed' WHERE id = 'publication-failed'")
        self.store.connection.commit()
        self.assertEqual(self.store.trash_brand("brand-a", self.actor())["status"], "archived")

    def test_published_publication_still_requires_provider_evidence_even_with_failed_ack(self):
        self.bind_actor()
        self.store.create_target_publication({"id": "publication-published", "bindingId": "binding-a", "variantId": "variant-published", "clientId": "client-a", "brandId": "brand-a", "idempotencyKey": "key-published", "approvalState": "approved", "state": "published", "simulation": False, "scheduledAt": "2099-01-05T09:00:00Z"})
        self.store.connection.execute("UPDATE target_publications SET worker_ack_state = 'failed' WHERE id = 'publication-published'")
        self.store.connection.commit()
        with self.assertRaisesRegex(StateValidationError, "BRAND_PUBLICATIONS_RECONCILIATION_REQUIRED"):
            self.store.trash_brand("brand-a", self.actor())
        self.store.connection.execute("UPDATE target_publications SET provider_job_id = 'provider-post-1' WHERE id = 'publication-published'")
        self.store.connection.commit()
        self.assertEqual(self.store.trash_brand("brand-a", self.actor())["status"], "archived")

    def test_permanent_delete_requires_exact_name_and_trashed_precondition(self):
        self.bind_actor()
        with self.assertRaisesRegex(StateValidationError, "BRAND_NOT_TRASHED"):
            self.store.permanently_delete_brand("brand-a", "Brand A", self.actor())
        self.store.trash_brand("brand-a", self.actor())
        with self.assertRaisesRegex(StateValidationError, "BRAND_NAME_CONFIRMATION_REQUIRED"):
            self.store.permanently_delete_brand("brand-a", " Brand A ", self.actor())
        with self.assertRaisesRegex(StateValidationError, "BRAND_NAME_CONFIRMATION_REQUIRED"):
            self.store.permanently_delete_brand("brand-a", "Wrong", self.actor())

    def test_permanent_delete_cleans_fk_records_preserves_shared_media_and_never_calls_provider(self):
        self.bind_actor()
        self.store.create_brand({"id": "brand-b", "clientId": "client-a", "name": "Brand B", "status": "active"})
        self.store.create_media_asset({"id": "asset-private", "clientId": "client-a", "brandId": "brand-a", "source": "local", "metadata": {"kind": "image"}})
        self.store.create_media_asset({"id": "asset-shared", "clientId": "client-a", "brandId": "brand-a", "source": "drive", "providerFileId": "drive-shared", "metadata": {"kind": "image", "shared": True, "distribution": "universal"}})
        self.store.create_media_asset({"id": "asset-other", "clientId": "client-a", "brandId": "brand-b", "source": "local", "metadata": {"kind": "image"}})
        self.store.create_automation_plan({"id": "plan-a", "brandId": "brand-a", "state": "active", "bindingIds": []})
        self.store.update_automation_plan("plan-a", {"state": "paused", "payload": {"revision": 2}})
        self.store.create_automation_run({"id": "run-a", "planId": "plan-a", "trigger": "manual", "reviewOnly": True})
        self.store.create_content_run({"id": "content-a", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "llm_provider"})
        self.seed_legacy_publication("publication-a", "variant-a", "canceled")
        self.store.connection.execute("UPDATE target_publications SET worker_ack_state = 'acknowledged' WHERE id = 'publication-a'")
        self.store.connection.commit()
        now = "2099-01-01T00:00:00Z"
        self.store.connection.execute("INSERT INTO publication_commands(request_id, publication_id, action, fingerprint, status, command_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ("command-a", "publication-a", "cancel", "fingerprint", "acknowledged", "{}", now, now))
        self.store.connection.execute("INSERT INTO analytics_events(id, client_id, brand_id, event_name, occurred_at, properties_json) VALUES (?, ?, ?, ?, ?, ?)", ("analytics-a", "client-a", "brand-a", "quality.checked", now, "{}"))
        self.store.connection.execute("INSERT INTO audit_events(id, client_id, brand_id, event_name, occurred_at, properties_json) VALUES (?, ?, ?, ?, ?, ?)", ("audit-a", "client-a", "brand-a", "brand.trash", now, "{}"))
        self.store.connection.commit()
        self.store.trash_brand("brand-a", self.actor())
        deleted = self.store.permanently_delete_brand("brand-a", "Brand A", self.actor())
        self.assertEqual(deleted["status"], "deleted")
        self.assertEqual(self.store.connection.execute("SELECT COUNT(*) FROM brands WHERE id = 'brand-a'").fetchone()[0], 0)
        for table, key in (("publication_commands", "publication_id"), ("target_publications", "brand_id"), ("automation_plan_revisions", "plan_id"), ("automation_plans", "brand_id"), ("automation_runs", "plan_id"), ("content_runs", "brand_id"), ("analytics_events", "brand_id"), ("audit_events", "brand_id"), ("channel_bindings", "brand_id"), ("brand_identities", "brand_id")):
            where = "publication_id = 'publication-a'" if table == "publication_commands" else "plan_id = 'plan-a'" if table in {"automation_plan_revisions", "automation_runs"} else "brand_id = 'brand-a'"
            self.assertEqual(self.store.connection.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}").fetchone()[0], 0, table)
        shared = self.store.connection.execute("SELECT brand_id, metadata_json FROM media_assets WHERE id = 'asset-shared'").fetchone()
        self.assertIsNotNone(shared)
        self.assertIsNone(shared["brand_id"])
        self.assertEqual(self.store.connection.execute("SELECT COUNT(*) FROM media_assets WHERE id = 'asset-private'").fetchone()[0], 0)
        self.assertEqual(self.store.connection.execute("SELECT COUNT(*) FROM media_assets WHERE id = 'asset-other'").fetchone()[0], 1)

    def test_shared_media_is_listed_to_another_live_brand_without_exposing_private_assets(self):
        self.bind_actor()
        self.store.create_brand({"id": "brand-b", "clientId": "client-a", "name": "Brand B", "status": "active"})
        self.store.create_brand({"id": "brand-c", "clientId": "client-a", "name": "Brand C", "status": "active"})
        self.store.create_media_asset({"id": "asset-shared-live", "clientId": "client-a", "brandId": "brand-a", "source": "drive", "metadata": {"kind": "image", "distribution": "universal", "sha256": "a" * 64, "mimeType": "image/png"}})
        self.store.create_media_asset({"id": "asset-shared-to-b", "clientId": "client-a", "brandId": "brand-a", "source": "drive", "metadata": {"kind": "image", "sharedBrandIds": ["brand-b"], "sha256": "c" * 64, "mimeType": "image/png"}})
        self.store.create_media_asset({"id": "asset-private-live", "clientId": "client-a", "brandId": "brand-a", "source": "local", "metadata": {"kind": "image", "sha256": "b" * 64, "mimeType": "image/png"}})
        rows = self.store.list_media_assets("client-a", "brand-b")
        self.assertEqual([row["id"] for row in rows], ["asset-shared-live", "asset-shared-to-b"])
        self.assertTrue(all(row["brandId"] == "brand-a" for row in rows))
        self.assertEqual([row["id"] for row in self.store.list_media_assets("client-a", "brand-c")], ["asset-shared-live"])

    def test_shared_media_with_actual_other_brand_content_run_reference_is_preserved(self):
        self.bind_actor()
        self.store.create_brand({"id": "brand-b", "clientId": "client-a", "name": "Brand B", "status": "active"})
        self.store.create_identity({"id": "identity-b", "brandId": "brand-b", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
        self.store.create_media_asset({"id": "asset-cross-brand", "clientId": "client-a", "brandId": "brand-a", "source": "local", "metadata": {"kind": "image"}})
        self.store.create_content_run({"id": "content-b", "clientId": "client-a", "brandId": "brand-b", "identityVersionId": "identity-b", "executionMode": "llm_provider", "mediaAssetIds": ["asset-cross-brand"], "mediaSetFingerprint": "a" * 64})
        self.store.trash_brand("brand-a", self.actor())
        self.store.permanently_delete_brand("brand-a", "Brand A", self.actor())
        self.assertIsNotNone(self.store.connection.execute("SELECT id FROM media_assets WHERE id = 'asset-cross-brand'").fetchone())
        self.assertEqual(self.store.list_media_assets("client-a", "brand-b")[0]["id"], "asset-cross-brand")

    def test_pending_deletion_operation_can_be_retried_after_restart(self):
        self.bind_actor()
        self.store.trash_brand("brand-a", self.actor())
        self.store.connection.execute("INSERT INTO brand_deletion_operations(id, brand_id, client_id, state, phase, requested_at, updated_at) VALUES ('operation-retry', 'brand-a', 'client-a', 'pending', 'started', '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z')")
        self.store.connection.commit()
        self.store.close()
        self.store = AgencyStateStore(self.path)
        deleted = self.store.permanently_delete_brand("brand-a", "Brand A", self.actor())
        self.assertEqual(deleted["status"], "deleted")
        self.assertEqual(self.store.list_brand_deletion_operations("brand-a")[0]["state"], "completed")

    def test_concurrent_delete_requests_share_one_pending_operation(self):
        self.bind_actor()
        self.store.trash_brand("brand-a", self.actor())
        results = []
        errors = []

        def delete_once():
            try:
                results.append(self.store.permanently_delete_brand("brand-a", "Brand A", self.actor()))
            except Exception as error:  # noqa: BLE001 - second idempotent caller may observe the completed row
                errors.append(str(error))

        threads = [threading.Thread(target=delete_once) for _ in range(2)]
        for thread in threads: thread.start()
        for thread in threads: thread.join()
        self.assertEqual(self.store.connection.execute("SELECT COUNT(*) FROM brand_deletion_operations WHERE brand_id = 'brand-a'").fetchone()[0], 1)
        self.assertGreaterEqual(len(results), 1)

    def test_interrupted_deletion_remains_pending_and_is_not_reported_complete(self):
        self.store.connection.execute("INSERT INTO brand_deletion_operations(id, brand_id, client_id, state, phase, requested_at, updated_at) VALUES ('operation-a', 'brand-a', 'client-a', 'pending', 'started', '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z')")
        self.store.connection.commit()
        operations = self.store.list_brand_deletion_operations("brand-a")
        self.assertEqual(operations[0]["state"], "pending")
        self.assertNotEqual(operations[0]["state"], "completed")


@unittest.skipUnless(TestClient is not None and service is not None, "FastAPI is not installed in this Python runtime")
class BrandLifecycleApiTests(unittest.TestCase):
    def setUp(self):
        self.store = AgencyStateStore(":memory:")
        self.previous_store = service.agency_state_store
        service.agency_state_store = self.store
        self.client = TestClient(service.app)
        self.store.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
        self.store.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
        self.store.bind_brand_actor("brand-a", "user-a", "owner", ["manage_brand"])

    def tearDown(self):
        service.agency_state_store = self.previous_store
        self.store.close()

    def test_routes_reject_editor_and_wrong_confirmation(self):
        editor = self.client.post("/v1/agency/brands/brand-a/trash", json={"actorUserId": "user-editor", "role": "editor", "capability": "manage_brand"})
        self.assertEqual(editor.status_code, 403)
        owner = self.client.post("/v1/agency/brands/brand-a/trash", json={"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"})
        self.assertEqual(owner.status_code, 200)
        wrong = self.client.post("/v1/agency/brands/brand-a/permanent-delete", json={"actorUserId": "user-a", "role": "owner", "capability": "manage_brand", "confirmation": "Wrong"})
        self.assertEqual(wrong.status_code, 409)
        self.assertEqual(wrong.json()["detail"]["code"], "BRAND_NAME_CONFIRMATION_REQUIRED")

    def test_generic_brand_delete_and_patch_are_blocked(self):
        patch_response = self.client.patch("/v1/agency/brands/brand-a", json={"status": "archived"})
        delete_response = self.client.delete("/v1/agency/brands/brand-a")
        self.assertEqual(patch_response.status_code, 409)
        self.assertEqual(delete_response.status_code, 409)
        self.assertEqual(patch_response.json()["detail"]["code"], "BRAND_LIFECYCLE_REQUIRED")
        self.assertEqual(delete_response.json()["detail"]["code"], "BRAND_LIFECYCLE_REQUIRED")

    def test_backfill_route_seeds_only_unbound_brand_after_migration(self):
        self.store.create_brand({"id": "brand-unbound", "clientId": "client-a", "name": "Unbound", "status": "active"})
        self.store.connection.execute("INSERT INTO control_plane_metadata(key, value) VALUES ('control_plane_migrated', 'true')")
        self.store.connection.commit()
        response = self.client.post("/v1/agency/brand-actor-bindings/backfill", json={"actor": {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"}, "brandIds": ["brand-a", "brand-unbound"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["seededCount"], 1)


if __name__ == "__main__":
    unittest.main()
