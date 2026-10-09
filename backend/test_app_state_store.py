import os
import json
import sys
import unittest
from datetime import datetime
from hashlib import sha256

sys.path.insert(0, os.path.dirname(__file__))

try:
    from app_state_store import AgencyStateStore, StateValidationError
except ImportError:
    AgencyStateStore = None
    StateValidationError = Exception


class AgencyStateStoreTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(AgencyStateStore)
        if AgencyStateStore is None:
            return
        self.store = AgencyStateStore(":memory:")
        self.store.create_client({"id": "client-a", "name": "Client A", "timezone": "Asia/Ho_Chi_Minh", "status": "active"})
        self.store.create_client({"id": "client-b", "name": "Client B", "timezone": "Asia/Ho_Chi_Minh", "status": "active"})
        self.store.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
        self.store.bind_brand_actor("brand-a", "user-a", "owner", ["manage_brand"])
        self.store.create_identity({"id": "identity-a-v1", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
        self.store.create_connection({"id": "connection-a", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a", "displayName": "Page A", "connectionState": "connected", "scopes": []})
        self.store.create_connection({"id": "connection-b", "clientId": "client-b", "platform": "facebook", "externalAccountId": "page-b", "displayName": "Page B", "connectionState": "connected", "scopes": []})

    def _fix5_media(self, **metadata):
        return self.store.create_media_asset({"id": "receipt-asset", "clientId": "client-a", "brandId": "brand-a", "source": "local", "metadata": {"ownershipReceiptId": "receipt-a", "sha256": "a" * 64, "mimeType": "image/png", **metadata}})

    def _fix5_compensate(self, **overrides):
        return self.store.compensate_media_asset("receipt-asset", {"clientId": "client-a", "brandId": "brand-a", "ownershipReceiptId": "receipt-a", "sha256": "a" * 64, "mimeType": "image/png", **overrides})

    def _fix6_media_replacement_run(self, run_id="run-fix6", variant_id="variant-fix6", revision=0, target_metadata=None):
        old_fingerprint = "a" * 64
        new_fingerprint = "b" * 64
        old_asset = f"asset-old-{run_id}"
        new_asset = f"asset-new-{run_id}"
        for asset_id, checksum in ((old_asset, "1" * 64), (new_asset, "2" * 64)):
            self.store.create_media_asset({"id": asset_id, "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"kind": "image", "sha256": checksum, "mimeType": "image/png", "archiveState": "active"}})
        lineage = {"selectedKnowledgeItemIds": [], "selectedResearchEvidenceIds": [], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 1, "selectedRecipeId": "recipe-a", "transformMode": "original", "mediaSetFingerprint": old_fingerprint, "customerFacts": ["Operator supplied brief"]}
        old_evidence = {"assetId": old_asset, "sha256": "1" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
        self.store.create_content_run({"id": run_id, "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Fix6 replacement prompt", "contentIntelligenceLineage": lineage, **lineage, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "visual", "passed": True}], "approvalState": "pending", "mediaSetFingerprint": old_fingerprint, "mediaRevision": revision, "mediaAssetIds": [old_asset], "mediaEvidence": [old_evidence], "variants": [{"id": variant_id, "platform": "facebook", "kind": "image", "body": "Durable copy", "caption": "Durable copy", "mediaAssetIds": [old_asset], "mediaEvidence": [old_evidence], "metadata": {"mediaEvidence": [old_evidence], "mediaSetFingerprint": old_fingerprint}}], **(target_metadata or {})})
        new_evidence = {"assetId": new_asset, "sha256": "2" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
        replacement = {"mediaReplacement": True, "mediaRevision": revision, "state": "needs_review", "qualityStatus": "pending", "approvalState": "pending", "mediaSetFingerprint": new_fingerprint, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": new_fingerprint}, "prompt": "Fix6 replacement prompt", "mediaAssetIds": [new_asset], "mediaEvidence": [new_evidence]}
        return lineage, replacement, old_asset, new_asset, old_evidence, new_evidence

    def test_fix5_receipt_deletes_only_its_own_unreferenced_row(self):
        self._fix5_media()
        result = self._fix5_compensate()
        self.assertEqual(result, {"assetId": "receipt-asset", "status": "deleted"})
        self.assertEqual(self.store.list_entity("media_assets"), [])
        self.assertEqual(self._fix5_compensate(), {"assetId": "receipt-asset", "status": "absent"})

    def test_fix5_receipt_preserves_another_receipt_scope_shared_and_unknown_row(self):
        for metadata, request in [({"ownershipReceiptId": "receipt-b"}, {}), ({}, {"brandId": "other-brand"}), ({}, {"sha256": "b" * 64}), ({"distribution": "universal"}, {}), ({"usageStatus": "reserved"}, {})]:
            with self.subTest(metadata=metadata, request=request):
                self.store.connection.execute("DELETE FROM media_assets")
                self.store.connection.execute("DELETE FROM media_ownership_compensations")
                self.store.connection.commit()
                self._fix5_media(**metadata)
                result = self._fix5_compensate(**request)
                self.assertEqual(result["status"], "retained")
                self.assertEqual(len(self.store.list_entity("media_assets")), 1)
        self.store.connection.execute("UPDATE media_assets SET metadata_json = 'not-json'")
        self.store.connection.commit()
        self.assertEqual(self._fix5_compensate()["status"], "retained")

    def test_fix5_receipt_preserves_same_brand_and_cross_brand_committed_references(self):
        self.store.create_brand({"id": "brand-other", "clientId": "client-a", "name": "Other", "status": "active"})
        self.store.create_identity({"id": "identity-other", "brandId": "brand-other", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
        for brand_id, identity_id in [("brand-a", "identity-a-v1"), ("brand-other", "identity-other")]:
            with self.subTest(brand_id=brand_id):
                self.store.connection.execute("DELETE FROM content_runs")
                self.store.connection.execute("DELETE FROM media_assets")
                self.store.connection.execute("DELETE FROM media_ownership_compensations")
                self.store.connection.commit()
                self._fix5_media(**({"distribution": "universal"} if brand_id != "brand-a" else {}))
                self.store.create_content_run({"id": "run-b", "clientId": "client-a", "brandId": brand_id, "identityVersionId": identity_id, "executionMode": "llm_provider", "mediaSetFingerprint": "b" * 64, "mediaEvidence": [{"assetId": "receipt-asset", "sha256": "a" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "pending"}]})
                self.assertEqual(self._fix5_compensate()["status"], "retained")
                self.assertEqual(len(self.store.list_entity("content_runs")), 1)
                self.assertEqual(len(self.store.list_entity("media_assets")), 1)

    def test_fix5_compensation_blocks_late_run_commit_and_same_receipt_resurrection(self):
        import sqlite3
        self._fix5_media()
        self.assertEqual(self._fix5_compensate()["status"], "deleted")
        with self.assertRaisesRegex(StateValidationError, "MEDIA_CONFLICT"):
            self._fix5_media()
        # The run may have completed its Python preflight before compensation; enforce this at INSERT too.
        with self.assertRaisesRegex(sqlite3.IntegrityError, "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED"):
            self.store.connection.execute("INSERT INTO content_runs(id, client_id, brand_id, identity_version_id, execution_mode, payload_json) VALUES (?, ?, ?, ?, ?, ?)", ("late-run", "client-a", "brand-a", "identity-a-v1", "llm_provider", json.dumps({"mediaAssetIds": ["receipt-asset"]})))
        self.store.connection.rollback()
        self.assertEqual(self.store.list_entity("content_runs"), [])
        self.assertEqual(self.store.list_entity("media_assets"), [])

    def test_fix5_late_validated_run_cannot_commit_after_receipt_compensation(self):
        import threading
        from unittest.mock import patch
        self._fix5_media()
        validated, resume = threading.Event(), threading.Event()
        original = self.store._content_run_media_evidence
        errors = []
        def held_validation(*args):
            result = original(*args)
            validated.set()
            if not resume.wait(2):
                raise AssertionError("fixture did not resume")
            return result
        def create_run():
            try:
                self.store.create_content_run({"id": "late-run", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "mediaSetFingerprint": "b" * 64, "mediaEvidence": [{"assetId": "receipt-asset", "sha256": "a" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "pending"}]})
            except Exception as error:
                errors.append(error)
        with patch.object(self.store, "_content_run_media_evidence", side_effect=held_validation):
            writer = threading.Thread(target=create_run)
            writer.start()
            try:
                self.assertTrue(validated.wait(2))
                self.assertEqual(self._fix5_compensate()["status"], "deleted")
            finally:
                resume.set()
                writer.join(2)
        self.assertFalse(writer.is_alive())
        self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], StateValidationError)
        self.assertEqual(self.store.list_entity("content_runs"), [])
        self.assertEqual(self.store.list_entity("media_assets"), [])

    def test_fix5_compensated_receipt_stays_terminal_after_store_restart(self):
        import sqlite3
        import tempfile
        from pathlib import Path
        self._fix5_media()
        self.assertEqual(self._fix5_compensate()["status"], "deleted")
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "receipt.sqlite"
            with sqlite3.connect(filename) as snapshot:
                self.store.connection.backup(snapshot)
            reopened = AgencyStateStore(filename)
            try:
                with self.assertRaisesRegex(StateValidationError, "MEDIA_CONFLICT"):
                    reopened.create_media_asset({"id": "receipt-asset", "clientId": "client-a", "brandId": "brand-a", "source": "local", "metadata": {"ownershipReceiptId": "receipt-a", "sha256": "a" * 64, "mimeType": "image/png"}})
                self.assertEqual(reopened.list_entity("media_assets"), [])
            finally:
                reopened.close()

    def test_fix5_unknown_durable_reference_shape_retains_the_receipt_row(self):
        self._fix5_media()
        self.store.connection.execute("INSERT INTO content_runs(id, client_id, brand_id, identity_version_id, execution_mode, payload_json) VALUES (?, ?, ?, ?, ?, ?)", ("unknown-run", "client-a", "brand-a", "identity-a-v1", "llm_provider", "[]"))
        self.store.connection.commit()
        self.assertEqual(self._fix5_compensate()["status"], "retained")
        self.assertEqual(len(self.store.list_entity("media_assets")), 1)

    def test_fix5_generic_media_delete_cannot_bypass_receipt_guard(self):
        self._fix5_media()
        with self.assertRaisesRegex(StateValidationError, "MEDIA_OWNERSHIP_COMMAND_REQUIRED"):
            self.store.delete_entity("media_assets", "receipt-asset")
        self.assertEqual(len(self.store.list_entity("media_assets")), 1)

    def test_rejects_cross_client_binding_and_duplicate_default_identity(self):
        if AgencyStateStore is None:
            return
        with self.assertRaisesRegex(StateValidationError, "CONNECTION_CLIENT_MISMATCH"):
            self.store.create_binding({"id": "binding-b", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-b", "targetExternalId": "page-b", "targetName": "Page B", "state": "connected"})
        with self.assertRaisesRegex(StateValidationError, "IDENTITY_DEFAULT_CONFLICT"):
            self.store.create_identity({"id": "identity-a-v2", "brandId": "brand-a", "name": "Second default", "isDefault": True, "version": 2, "status": "active"})

    def test_identity_payload_is_durable_and_scalar(self):
        if AgencyStateStore is None:
            return
        identity = self.store.update_identity_payload("identity-a-v1", {"strategy": {"vision": "A"}, "voice": {"tone": "calm"}, "visual": {"styleGuide": "plain"}})
        self.assertEqual(identity["voice"]["tone"], "calm")
        self.assertEqual(self.store.list_entity("brand_identities")[0]["visual"]["styleGuide"], "plain")

    def test_create_identity_persists_each_nested_payload_field_without_wrapping_the_record(self):
        if AgencyStateStore is None:
            return
        payload = {
            "strategy": {"vision": "Created vision", "mission": "Created mission", "values": ["Care"], "personality": ["Warm"], "audience": "Families"},
            "voice": {"tone": "Clear", "vocabulary": ["proof"], "prohibitedClaims": ["guaranteed"]},
            "visual": {"logoAssetIds": ["logo-a"], "colors": [{"name": "Primary", "hex": "#4f46e5"}], "typography": {"heading": "Inter", "body": "Inter"}, "styleGuide": "Simple"},
        }
        self.store.create_identity({"id": "identity-created", "brandId": "brand-a", "name": "Created", "isDefault": False, "version": 2, "status": "draft", **payload})
        stored = self.store.list_entity("brand_identities", "identity-created")
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["strategy"], payload["strategy"])
        self.assertEqual(stored[0]["voice"], payload["voice"])
        self.assertEqual(stored[0]["visual"], payload["visual"])

    @staticmethod
    def _catalog(brand_id="brand-a"):
        objectives = [{"key": key, "label": key.title(), "description": f"{key} objective", "enabled": True, "order": index} for index, key in enumerate(("reach", "engagement", "education", "knowledge", "conversion"), 1)]
        angle = {"id": "proof-point", "label": "Proof point", "guidance": "Use one verified proof point.", "enabled": True, "order": 1, "channels": ["facebook", "instagram", "tiktok", "youtube"]}
        pillar = {"id": "proof-and-process", "label": "Proof and process", "description": "Make evidence visible.", "enabled": True, "order": 1, "channels": ["facebook", "instagram", "tiktok", "youtube"], "angles": [angle]}
        return {"brandId": brand_id, "version": 1, "objectives": objectives, "pillars": [pillar], "channelOverrides": {}, "updatedAt": "2026-09-14T00:00:00.000Z"}

    def test_strategy_catalog_save_is_scoped_versioned_and_atomic(self):
        catalog = self._catalog()
        saved = self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": catalog, "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"}})
        self.assertEqual(saved["scopeKey"], self.store.strategy_catalog_scope_key("client-a", "brand-a"))
        self.assertEqual((saved["version"], saved["revision"]), (2, 1))
        self.assertEqual(len(saved["fingerprint"]), 64)
        self.assertEqual(self.store.strategy_catalog_migration_version(), 5)
        self.assertEqual(self.store.get_strategy_catalog("client-a", "brand-a")["version"], 2)

    def test_strategy_catalog_requires_exactly_the_five_canonical_objectives_for_direct_store_save(self):
        catalog = self._catalog()
        reduced = {**catalog, "objectives": catalog["objectives"][:-1]}
        with self.assertRaisesRegex(StateValidationError, "STRATEGY_CATALOG_OBJECTIVE_SET_INVALID"):
            self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": reduced, "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"}})
        saved = self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": catalog, "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"}})
        self.assertEqual([item["key"] for item in saved["strategyCatalog"]["objectives"]], ["reach", "engagement", "education", "knowledge", "conversion"])
        self.assertIsNone(self.store.get_strategy_catalog("client-b", "brand-a"))

        with self.assertRaisesRegex(StateValidationError, "STRATEGY_CATALOG_REVISION_CONFLICT"):
            self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": {**catalog, "version": 2}, "expectedVersion": 2, "expectedRevision": 0, "actor": {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"}})
        self.assertEqual(self.store.get_strategy_catalog("client-a", "brand-a")["version"], 2)

    def test_strategy_catalog_validation_rejects_bad_scope_order_channel_recipe_and_actor_without_partial_write(self):
        catalog = self._catalog()
        cases = [
            ({"brandId": "brand-a", "version": 1, "objectives": [{**catalog["objectives"][0], "order": 2}], "pillars": catalog["pillars"], "channelOverrides": {}, "updatedAt": catalog["updatedAt"]}, "OBJECTIVE_ORDER_INVALID"),
            ({**catalog, "pillars": [{**catalog["pillars"][0], "angles": [{**catalog["pillars"][0]["angles"][0], "channels": ["fax"]}]}]}, "CATALOG_CHANNEL_INVALID"),
        ]
        for invalid, code in cases:
            with self.subTest(code=code):
                with self.assertRaisesRegex(StateValidationError, code):
                    self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": invalid, "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"}})
        with self.assertRaisesRegex(StateValidationError, "BRAND_MANAGE_FORBIDDEN"):
            self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": catalog, "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "unbound", "role": "owner", "capability": "manage_brand"}})
        self.assertIsNone(self.store.get_strategy_catalog("client-a", "brand-a"))

    def test_strategy_catalog_accepts_syntactically_valid_recipe_until_registry_exists(self):
        catalog = self._catalog()
        catalog["pillars"][0]["angles"][0]["recipeId"] = "recipe-a"
        saved = self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": catalog, "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"}})
        self.assertEqual(saved["strategyCatalog"]["pillars"][0]["angles"][0]["recipeId"], "recipe-a")

        self.store.connection.execute("CREATE TABLE content_recipes (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, status TEXT NOT NULL, angle_id TEXT)")
        self.store.connection.execute("INSERT INTO content_recipes(id, brand_id, status, angle_id) VALUES ('recipe-other', 'brand-other', 'active', 'proof-point')")
        self.store.connection.commit()
        bad = {**catalog, "version": 2, "pillars": [{**catalog["pillars"][0], "angles": [{**catalog["pillars"][0]["angles"][0], "recipeId": "recipe-other"}]}]}
        with self.assertRaisesRegex(StateValidationError, "RECIPE_REFERENCE_INVALID"):
            self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": bad, "expectedVersion": 2, "expectedRevision": 1, "actor": {"actorUserId": "user-a"}})

    def test_strategy_catalog_rejects_unknown_nested_keys_and_base_added_angle_collisions(self):
        catalog = self._catalog()
        catalog["pillars"][0]["angles"][0]["unknownField"] = True
        with self.assertRaisesRegex(StateValidationError, "STRATEGY_CATALOG_SCHEMA_INVALID"):
            self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": catalog, "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "user-a"}})

        catalog = self._catalog()
        added = {**catalog["pillars"][0]["angles"][0], "id": "added-angle", "order": 2}
        catalog["channelOverrides"] = {"facebook": {"addedAnglesByPillarId": {"proof-and-process": [added, {**added, "order": 3}]}}}
        with self.assertRaisesRegex(StateValidationError, "STRATEGY_CATALOG_ANGLE_DUPLICATE"):
            self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": catalog, "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "user-a"}})

        catalog = self._catalog()
        first = {**catalog["pillars"][0]["angles"][0], "id": "cross-channel-angle", "order": 2}
        catalog["channelOverrides"] = {"facebook": {"addedAnglesByPillarId": {"proof-and-process": [first]}}, "instagram": {"addedAnglesByPillarId": {"proof-and-process": [{**first, "order": 2}]}}}
        with self.assertRaisesRegex(StateValidationError, "STRATEGY_CATALOG_ANGLE_DUPLICATE"):
            self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": catalog, "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "user-a"}})

        catalog = self._catalog()
        catalog["channelOverrides"] = {"facebook": {"addedPillars": [{**catalog["pillars"][0], "id": "added-pillar", "angles": [{**catalog["pillars"][0]["angles"][0], "id": "proof-point", "order": 1}]}]}}
        with self.assertRaisesRegex(StateValidationError, "STRATEGY_CATALOG_ANGLE_DUPLICATE"):
            self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": catalog, "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "user-a"}})

    def test_strategy_catalog_scope_is_unicode_stable_and_non_default_identity_is_rejected(self):
        self.assertEqual(self.store.strategy_catalog_scope_key("khách-hàng", "bränd-shared"), "[\"khách-hàng\",\"bränd-shared\"]")
        self.store.create_identity({"id": "identity-a-v2", "brandId": "brand-a", "name": "Secondary", "isDefault": False, "version": 2, "status": "active"})
        with self.assertRaisesRegex(StateValidationError, "STRATEGY_CATALOG_IDENTITY_NONCANONICAL"):
            self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "identityId": "identity-a-v2", "strategyCatalog": self._catalog(), "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "user-a"}})
        self.assertIsNone(self.store.get_strategy_catalog("client-a", "brand-a"))

        saved = self.store.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": self._catalog(), "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "user-a"}})
        self.store.connection.execute("UPDATE brand_identities SET payload_json = ? WHERE id = 'identity-a-v2'", (json.dumps({"strategyCatalog": {**self._catalog(), "version": 9}}),))
        self.store.connection.commit()
        current = self.store.get_strategy_catalog("client-a", "brand-a")
        self.assertEqual((current["identityId"], current["version"], current["revision"], current["fingerprint"]), ("identity-a-v1", saved["version"], saved["revision"], saved["fingerprint"]))

    def test_duplicate_brand_id_across_clients_is_rejected_before_mutation(self):
        with self.assertRaisesRegex(StateValidationError, "BRAND_ID_SCOPE_CONFLICT"):
            self.store.create_brand({"id": "brand-a", "clientId": "client-b", "name": "Shadow Brand", "status": "active"})
        self.assertEqual([row["client_id"] for row in self.store.connection.execute("SELECT client_id FROM brands WHERE id = 'brand-a'").fetchall()], ["client-a"])

    def test_identity_catalog_alias_is_rejected_without_mutating_identity(self):
        with self.assertRaisesRegex(StateValidationError, "IDENTITY_PAYLOAD_INVALID"):
            self.store.update_identity_payload("identity-a-v1", {"clientId": "client-a", "brandId": "brand-a", "catalog": self._catalog(), "actor": {"actorUserId": "user-a"}})
        self.assertNotIn("strategyCatalog", self.store.list_entity("brand_identities", "identity-a-v1")[0])

    def test_strategy_catalog_ack_survives_store_reload(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.sqlite3"
            durable = AgencyStateStore(path)
            durable.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            durable.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            durable.bind_brand_actor("brand-a", "user-a", "owner", ["manage_brand"])
            durable.create_identity({"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            saved = durable.save_strategy_catalog({"clientId": "client-a", "brandId": "brand-a", "strategyCatalog": self._catalog(), "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"}})
            durable.close()
            reopened = AgencyStateStore(path)
            self.assertEqual(reopened.acknowledge_strategy_catalog("client-a", "brand-a", saved["revision"], saved["version"], saved["fingerprint"], saved["scopeKey"])["fingerprint"], saved["fingerprint"])
            with self.assertRaisesRegex(StateValidationError, "STRATEGY_CATALOG_ACK_SCOPE_MISMATCH"):
                reopened.acknowledge_strategy_catalog("client-a", "brand-a", saved["revision"], saved["version"], saved["fingerprint"], "[\"client-b\",\"brand-a\"]")
            reopened.close()


    def test_enforces_generation_mode_and_immutable_content_run_route(self):
        if AgencyStateStore is None:
            return
        with self.assertRaisesRegex(StateValidationError, "GENERATION_MODE_INVALID"):
            self.store.create_generation_profile({"id": "profile-invalid", "brandId": "brand-a", "mode": "both", "provider": "openrouter", "model": "x", "capabilities": ["copy"], "status": "connected"})
        self.store.create_generation_profile({"id": "profile-a", "brandId": "brand-a", "mode": "llm_provider", "provider": "openrouter", "model": "model-a", "capabilities": ["copy"], "status": "connected"})
        self.store.create_generation_profile({"id": "profile-b", "brandId": "brand-a", "mode": "llm_provider", "provider": "nvidia_nim", "model": "model-b", "capabilities": ["copy"], "status": "connected"})
        self.store.create_content_run({"id": "run-a", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "generationProfileId": "profile-a", "executionMode": "llm_provider"})
        self.store.mark_provider_attempt("run-a")
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_PROFILE_IMMUTABLE"):
            self.store.update_content_run_profile("run-a", "profile-b")

    def test_persists_structured_content_run_payload_without_changing_route(self):
        if AgencyStateStore is None:
            return
        self.store.create_generation_profile({"id": "profile-a", "brandId": "brand-a", "mode": "llm_provider", "provider": "openrouter", "model": "model-a", "capabilities": ["copy"], "status": "connected"})
        self.store.create_content_run({"id": "run-structured", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "generationProfileId": "profile-a", "executionMode": "llm_provider", "topic": "Topic", "contentPillar": "Education", "objective": "Reach", "hashtags": ["#signalflow"], "state": "needs_review"})
        updated = self.store.update_content_run_payload("run-structured", {"caption": "A persisted caption", "qualityStatus": "passed", "qualityChecks": [{"key": "caption", "passed": True}], "approvalState": "pending", "state": "quality_passed"})
        self.assertEqual(updated["caption"], "A persisted caption")
        self.assertEqual(updated["qualityStatus"], "passed")
        self.assertEqual(updated["state"], "quality_passed")
        self.assertEqual(updated["generation_profile_id"], "profile-a")

    def test_content_run_asset_operation_plural_payload_round_trips_running_and_terminal_ack(self):
        if AgencyStateStore is None:
            return
        self.store.create_content_run({"id": "run-asset-operations", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "topic": "Asset checkpoint", "body": "Durable content", "caption": "Durable content", "state": "content_generated", "variants": [{"id": "variant-asset", "platform": "facebook", "kind": "image", "body": "Durable content", "caption": "Durable content", "mediaAssetIds": [], "mediaOperations": []}]})
        running = {"mediaOperations": [{"type": "image", "status": "running", "slotId": "slot-cp", "strategyVersion": 2, "idempotencyKey": "slot-cp:v2:image"}], "visualOperations": [{"type": "image", "status": "running", "slotId": "slot-cp", "strategyVersion": 2, "idempotencyKey": "slot-cp:v2:image"}], "state": "content_generated", "generationStatus": "completed"}
        running_ack = self.store.update_content_run_payload("run-asset-operations", running)
        self.assertEqual(running_ack["state"], "content_generated")
        self.assertEqual(running_ack["mediaOperations"][0]["status"], "running")
        self.assertNotIn("mediaOperation", running_ack)
        terminal = {"mediaOperations": [{"type": "image", "status": "failed", "stage": "asset_generation", "reason": "ASSET_GENERATION_TIMEOUT", "slotId": "slot-cp", "strategyVersion": 2, "idempotencyKey": "slot-cp:v2:image"}], "visualOperations": [{"type": "image", "status": "failed", "stage": "asset_generation", "reason": "ASSET_GENERATION_TIMEOUT", "slotId": "slot-cp", "strategyVersion": 2, "idempotencyKey": "slot-cp:v2:image"}], "state": "content_generated", "generationStatus": "completed"}
        terminal_ack = self.store.update_content_run_payload("run-asset-operations", terminal)
        self.assertEqual(terminal_ack["mediaOperations"][0]["status"], "failed")
        self.assertNotIn("mediaOperation", terminal_ack)

    def test_non_cas_checkpoint_honors_false_commit_and_rolls_back(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "transaction-contract.sqlite3"
            seed = AgencyStateStore(path)
            seed.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            seed.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            seed.create_identity({"id": "identity-a-v1", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            seed.create_content_run({"id": "run-transaction-contract", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "state": "content_generated", "generationStatus": "pending", "variants": [{"id": "variant-transaction-contract", "platform": "facebook", "kind": "image", "body": "Durable content", "mediaOperations": []}]})
            seed.close()

            writer = AgencyStateStore(path)
            reader = AgencyStateStore(path)
            try:
                before_payload = reader.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-transaction-contract",)).fetchone()["payload_json"]
                updated = writer.update_content_run_payload("run-transaction-contract", {"mediaOperations": [{"type": "image", "status": "running", "slotId": "slot-cp", "strategyVersion": 2, "idempotencyKey": "slot-cp:v2:image"}], "generationStatus": "completed"}, _commit=False)

                self.assertEqual(updated["generationStatus"], "completed")
                self.assertTrue(writer.connection.in_transaction)
                self.assertEqual(reader.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-transaction-contract",)).fetchone()["payload_json"], before_payload)

                writer.connection.rollback()
                self.assertFalse(writer.connection.in_transaction)
                self.assertEqual(reader.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-transaction-contract",)).fetchone()["payload_json"], before_payload)
            finally:
                writer.close()
                reader.close()

    def test_media_replacement_resets_review_and_reloads_new_durable_media(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "media-replacement.sqlite3"
            store = AgencyStateStore(path)
            store.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            store.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            store.create_identity({"id": "identity-a-v1", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            old_fingerprint = "a" * 64
            new_fingerprint = "b" * 64
            for asset_id, checksum in (("asset-old", "1" * 64), ("asset-new", "2" * 64), ("asset-third", "3" * 64)):
                store.create_media_asset({"id": asset_id, "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"kind": "image", "sha256": checksum, "mimeType": "image/png", "archiveState": "active"}})
            lineage = {"selectedKnowledgeItemIds": [], "selectedResearchEvidenceIds": [], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 1, "selectedRecipeId": "recipe-a", "transformMode": "original", "mediaSetFingerprint": old_fingerprint, "customerFacts": ["Operator supplied brief"]}
            store.create_content_run({"id": "run-media-replacement", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Media replacement prompt", "contentIntelligenceLineage": lineage, **lineage, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "visual", "passed": True}], "approvalState": "pending", "mediaSetFingerprint": old_fingerprint, "mediaAssetIds": ["asset-old"], "mediaEvidence": [{"assetId": "asset-old", "sha256": "1" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}], "variants": [{"id": "variant-media-replacement", "platform": "facebook", "kind": "image", "body": "Durable copy", "caption": "Durable copy", "mediaAssetIds": ["asset-old"], "metadata": {"mediaEvidence": [{"assetId": "asset-old", "sha256": "1" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}]}}]})
            replacement = {"mediaReplacement": True, "mediaRevision": 0, "state": "needs_review", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaSetFingerprint": new_fingerprint, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": new_fingerprint}, "prompt": "Media replacement prompt", "mediaAssetIds": ["asset-new"], "mediaEvidence": [{"assetId": "asset-new", "sha256": "2" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}], "mediaOperations": [{"type": "image", "status": "completed", "assetId": "asset-new", "operationVersion": 2}], "visualOperations": [{"type": "image", "status": "completed", "assetId": "asset-new", "operationVersion": 2}]}
            updated = store.update_content_run_payload("run-media-replacement", replacement)
            self.assertEqual(updated["state"], "needs_review")
            self.assertEqual(updated["qualityStatus"], "pending")
            self.assertEqual(updated["qualityChecks"], [])
            self.assertEqual(updated["approvalState"], "pending")
            self.assertEqual(updated["mediaSetFingerprint"], new_fingerprint)
            self.assertEqual(updated["contentIntelligenceLineage"]["mediaSetFingerprint"], new_fingerprint)
            self.assertEqual(updated["mediaAssetIds"], ["asset-new"])
            self.assertEqual(updated["mediaEvidence"][0]["assetId"], "asset-new")
            store.close()

            reopened = AgencyStateStore(path)
            durable = reopened.list_entity("content_runs", "run-media-replacement")[0]
            self.assertEqual(durable["state"], "needs_review")
            self.assertEqual(durable["qualityStatus"], "pending")
            self.assertEqual(durable["qualityChecks"], [])
            self.assertEqual(durable["approvalState"], "pending")
            self.assertEqual(durable["mediaSetFingerprint"], new_fingerprint)
            self.assertEqual(durable["contentIntelligenceLineage"]["mediaSetFingerprint"], new_fingerprint)
            self.assertEqual(durable["mediaAssetIds"], ["asset-new"])
            self.assertEqual(durable["mediaEvidence"][0]["assetId"], "asset-new")
            reopened.close()

    def test_media_replacement_flag_cannot_bypass_approved_run_immutability(self):
        old_fingerprint = "a" * 64
        self.store.create_content_run({"id": "run-media-replacement-locked", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "state": "scheduled", "approvalState": "approved", "qualityStatus": "passed", "mediaSetFingerprint": old_fingerprint, "mediaAssetIds": ["asset-old"]})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_IMMUTABLE"):
            self.store.update_content_run_payload("run-media-replacement-locked", {"mediaReplacement": True, "state": "needs_review", "qualityStatus": "pending", "approvalState": "pending", "mediaSetFingerprint": "b" * 64, "mediaAssetIds": ["asset-new"]})

    def test_media_replacement_preserves_published_and_active_publication_runs(self):
        old_fingerprint = "a" * 64
        evidence = {"assetId": "asset-old", "sha256": "1" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
        self.store.create_media_asset({"id": "asset-old", "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"sha256": "1" * 64, "mimeType": "image/png", "archiveState": "active"}})
        self.store.create_binding({"id": "binding-active-replacement", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        for run_id, state, approval_state in (("run-media-published", "published", "published"), ("run-media-active-publication", "ready", "pending")):
            self.store.create_content_run({"id": run_id, "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "state": state, "approvalState": approval_state, "qualityStatus": "passed", "mediaSetFingerprint": old_fingerprint, "mediaAssetIds": ["asset-old"], "mediaEvidence": [evidence], "variants": [{"id": f"variant-{run_id}", "platform": "facebook", "kind": "image", "body": "Durable copy", "mediaAssetIds": ["asset-old"], "metadata": {"mediaEvidence": [evidence], "mediaSetFingerprint": old_fingerprint}}]})
        self.store.create_target_publication({"id": "publication-active-replacement", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-active-replacement", "variantId": "variant-run-media-active-publication", "idempotencyKey": "key-active-replacement", "approvalState": "approved", "state": "scheduled", "scheduledAt": "2999-01-01T09:00:00+00:00", "contentRunId": "run-media-active-publication"})

        for run_id in ("run-media-published", "run-media-active-publication"):
            before_json = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", (run_id,)).fetchone()["payload_json"]
            with self.subTest(run_id=run_id), self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_IMMUTABLE"):
                self.store.update_content_run_payload(run_id, {"mediaReplacement": True, "state": "needs_review", "qualityStatus": "pending", "approvalState": "pending", "mediaSetFingerprint": "b" * 64, "mediaAssetIds": ["asset-new"]})
            after_json = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", (run_id,)).fetchone()["payload_json"]
            self.assertEqual(after_json, before_json)
        self.assertEqual(self.store.list_entity("target_publications", "publication-active-replacement")[0]["state"], "scheduled")

    def test_media_replacement_clears_omitted_review_and_target_metadata(self):
        _, replacement, _, _, _, _ = self._fix6_media_replacement_run(
            run_id="run-fix6-reset",
            variant_id="variant-fix6-reset",
            target_metadata={"checkedAt": "2026-09-16T00:00:00Z", "targetApprovalState": "acknowledged", "targetApprovalIntents": [{"id": "stale-target"}]},
        )
        updated = self.store.update_content_run_payload("run-fix6-reset", replacement)
        self.assertEqual(updated["qualityChecks"], [])
        self.assertIsNone(updated["checkedAt"])
        self.assertEqual(updated["approvalState"], "pending")
        self.assertEqual(updated["targetApprovalState"], "pending")
        self.assertEqual(updated["targetApprovalIntents"], [])
        raw = json.loads(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix6-reset'").fetchone()[0])
        self.assertEqual({key: raw.get(key) for key in ("qualityChecks", "checkedAt", "approvalState", "targetApprovalState", "targetApprovalIntents")}, {"qualityChecks": [], "checkedAt": None, "approvalState": "pending", "targetApprovalState": "pending", "targetApprovalIntents": []})

    def test_media_replacement_rejects_provider_confirmed_published_target(self):
        self.store.create_binding({"id": "binding-fix6-provider", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        _, replacement, _, _, _, _ = self._fix6_media_replacement_run(run_id="run-fix6-provider", variant_id="variant-fix6-provider")
        self.store.create_target_publication({"id": "publication-fix6-provider", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-fix6-provider", "variantId": "variant-fix6-provider", "idempotencyKey": "key-fix6-provider", "approvalState": "approved", "state": "published", "simulation": False, "scheduledAt": "2999-01-01T09:00:00Z", "contentRunId": "run-fix6-provider"})
        self.store.connection.execute("UPDATE target_publications SET provider_job_id = 'provider-post-fix6' WHERE id = 'publication-fix6-provider'")
        self.store.connection.commit()
        before_run = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix6-provider'").fetchone()[0]
        before_publication = tuple(self.store.connection.execute("SELECT state, simulation, provider_job_id FROM target_publications WHERE id = 'publication-fix6-provider'").fetchone())
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_IMMUTABLE"):
            self.store.update_content_run_payload("run-fix6-provider", replacement)
        self.assertEqual(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix6-provider'").fetchone()[0], before_run)
        self.assertEqual(tuple(self.store.connection.execute("SELECT state, simulation, provider_job_id FROM target_publications WHERE id = 'publication-fix6-provider'").fetchone()), before_publication)

    def test_persisted_media_revision_aliases_reload_and_replace_to_one_canonical_key(self):
        for alias in ("media_revision", "contentRunRevision", "content_run_revision"):
            with self.subTest(alias=alias):
                run_id = f"run-fix6-replace-{alias}"
                _, replacement, _, _, _, _ = self._fix6_media_replacement_run(run_id=run_id, variant_id=f"variant-{run_id}", revision=7)
                row = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", (run_id,)).fetchone()
                payload = json.loads(row[0])
                payload.pop("mediaRevision", None)
                payload[alias] = 7
                self.store.connection.execute("UPDATE content_runs SET payload_json = ? WHERE id = ?", (json.dumps(payload, separators=(",", ":")), run_id))
                self.store.connection.commit()
                reloaded = self.store.list_entity("content_runs", run_id)[0]
                self.assertEqual(reloaded["mediaRevision"], 7)
                self.assertNotIn(alias, reloaded)
                updated = self.store.update_content_run_payload(run_id, replacement)
                self.assertEqual(updated["mediaRevision"], 8)
                raw = json.loads(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", (run_id,)).fetchone()[0])
                self.assertEqual(raw["mediaRevision"], 8)
                self.assertNotIn("media_revision", raw)
                self.assertNotIn("content_run_revision", raw)

    def test_persisted_media_revision_aliases_reload_and_validate_approval_snapshot(self):
        self.store.create_binding({"id": "binding-fix6-approval", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        for alias in ("media_revision", "content_run_revision"):
            with self.subTest(alias=alias):
                run_id = f"run-fix6-approval-{alias}"
                variant_id = f"variant-{run_id}"
                _, _, old_asset, _, old_evidence, _ = self._fix6_media_replacement_run(run_id=run_id, variant_id=variant_id, revision=7)
                row = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", (run_id,)).fetchone()
                payload = json.loads(row[0])
                payload.pop("mediaRevision", None)
                payload[alias] = 7
                self.store.connection.execute("UPDATE content_runs SET payload_json = ? WHERE id = ?", (json.dumps(payload, separators=(",", ":")), run_id))
                self.store.connection.commit()
                fingerprint = "a" * 64
                publication_id = f"publication-{run_id}"
                request_id = f"approve-{run_id}"
                idempotency_key = f"key-{run_id}"
                scheduled_at = "2999-01-01T09:00:00Z" if alias == "media_revision" else "2999-01-01T10:00:00Z"
                worker_payload = {"client_id": "client-a", "brand_id": "brand-a", "binding_id": "binding-fix6-approval", "identity_version_id": "identity-a-v1", "target_publication_id": publication_id, "page_id": "page-a", "plan_id": None, "content_run_id": run_id, "variant_id": variant_id, "platform": "facebook", "kind": "image", "required_scopes": [], "approval_state": "approved", "simulation": False, "mediaAssetIds": [old_asset], "media_set_fingerprint": fingerprint, "mediaRevision": 7}
                approval = {"id": publication_id, "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-fix6-approval", "identityVersionId": "identity-a-v1", "variantId": variant_id, "idempotencyKey": idempotency_key, "approvalState": "approved", "platform": "facebook", "kind": "image", "requiredScopes": [], "mediaRequired": True, "mediaEligible": True, "mediaUrl": "https://cdn.example/old.png", "simulation": False, "scheduledAt": scheduled_at, "requestId": request_id, "contentRunId": run_id, "mediaRevision": 7, "mediaSetFingerprint": fingerprint, "mediaAssetIds": [old_asset], "workerJob": {"jobId": f"job-{run_id}", "idempotencyKey": idempotency_key, "scheduledAt": scheduled_at, "payload": worker_payload}}
                result = self.store.begin_target_publication_approval(approval)
                self.assertEqual(result["commandStatus"], "pending")
                self.assertEqual(self.store.list_entity("target_publications", publication_id)[0]["state"], "approval_pending")

    def test_conflicting_persisted_media_revision_aliases_reject_replacement_and_approval(self):
        self.store.create_binding({"id": "binding-fix6-conflict", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        _, replacement, old_asset, _, _, _ = self._fix6_media_replacement_run(run_id="run-fix6-conflict", variant_id="variant-fix6-conflict", revision=1)
        row = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix6-conflict'").fetchone()
        payload = json.loads(row[0])
        payload["media_revision"] = 2
        self.store.connection.execute("UPDATE content_runs SET payload_json = ? WHERE id = 'run-fix6-conflict'", (json.dumps(payload, separators=(",", ":")),))
        self.store.connection.commit()
        before = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix6-conflict'").fetchone()[0]
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_REVISION_ALIAS_MISMATCH"):
            self.store.update_content_run_payload("run-fix6-conflict", replacement)
        self.assertEqual(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix6-conflict'").fetchone()[0], before)
        scheduled_at = "2999-01-01T11:00:00Z"
        idempotency_key = "key-fix6-conflict"
        worker_payload = {"client_id": "client-a", "brand_id": "brand-a", "binding_id": "binding-fix6-conflict", "identity_version_id": "identity-a-v1", "target_publication_id": "publication-fix6-conflict", "page_id": "page-a", "plan_id": None, "content_run_id": "run-fix6-conflict", "variant_id": "variant-fix6-conflict", "platform": "facebook", "kind": "image", "required_scopes": [], "approval_state": "approved", "simulation": False, "mediaAssetIds": [old_asset], "media_set_fingerprint": "a" * 64, "mediaRevision": 1}
        approval = {"id": "publication-fix6-conflict", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-fix6-conflict", "identityVersionId": "identity-a-v1", "variantId": "variant-fix6-conflict", "idempotencyKey": idempotency_key, "approvalState": "approved", "platform": "facebook", "kind": "image", "requiredScopes": [], "mediaRequired": True, "mediaEligible": True, "mediaUrl": "https://cdn.example/old.png", "simulation": False, "scheduledAt": scheduled_at, "requestId": "approve-fix6-conflict", "contentRunId": "run-fix6-conflict", "mediaRevision": 1, "mediaSetFingerprint": "a" * 64, "mediaAssetIds": [old_asset], "workerJob": {"jobId": "job-fix6-conflict", "idempotencyKey": idempotency_key, "scheduledAt": scheduled_at, "payload": worker_payload}}
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_REVISION_ALIAS_MISMATCH"):
            self.store.begin_target_publication_approval(approval)
        self.assertEqual(self.store.list_entity("target_publications"), [])

    def test_running_media_checkpoint_rejects_scheduled_content_run_without_mutation(self):
        self._fix6_media_replacement_run(run_id="run-fix7-scheduled", variant_id="variant-fix7-scheduled")
        row = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix7-scheduled'").fetchone()
        payload = json.loads(row["payload_json"])
        payload["state"] = "scheduled"
        self.store.connection.execute("UPDATE content_runs SET payload_json = ? WHERE id = 'run-fix7-scheduled'", (json.dumps(payload, separators=(",", ":")),))
        self.store.connection.commit()
        before = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix7-scheduled'").fetchone()["payload_json"]
        running = {"state": "content_generated", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaOperations": [{"type": "image", "status": "running", "slotId": "run-fix7-scheduled"}], "visualOperations": [{"type": "image", "status": "running", "slotId": "run-fix7-scheduled"}]}
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_IMMUTABLE"):
            self.store.update_content_run_payload("run-fix7-scheduled", running)
        self.assertEqual(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix7-scheduled'").fetchone()["payload_json"], before)

    def test_running_media_checkpoint_rejects_approved_content_run_without_mutation(self):
        self._fix6_media_replacement_run(run_id="run-fix7-approved", variant_id="variant-fix7-approved", target_metadata={"approvalState": "approved"})
        before = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix7-approved'").fetchone()["payload_json"]
        running = {"state": "content_generated", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaOperations": [{"type": "image", "status": "running", "slotId": "run-fix7-approved"}], "visualOperations": [{"type": "image", "status": "running", "slotId": "run-fix7-approved"}]}
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_IMMUTABLE"):
            self.store.update_content_run_payload("run-fix7-approved", running)
        self.assertEqual(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix7-approved'").fetchone()["payload_json"], before)

    def test_running_media_checkpoint_rejects_provider_confirmed_published_run_without_mutation(self):
        self.store.create_binding({"id": "binding-fix7-provider", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        self._fix6_media_replacement_run(run_id="run-fix7-provider", variant_id="variant-fix7-provider")
        self.store.create_target_publication({"id": "publication-fix7-provider", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-fix7-provider", "variantId": "variant-fix7-provider", "idempotencyKey": "key-fix7-provider", "approvalState": "approved", "state": "published", "simulation": False, "scheduledAt": "2999-01-01T09:00:00Z", "contentRunId": "run-fix7-provider"})
        self.store.connection.execute("UPDATE target_publications SET provider_job_id = 'provider-post-fix7' WHERE id = 'publication-fix7-provider'")
        self.store.connection.commit()
        before_run = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix7-provider'").fetchone()["payload_json"]
        before_publication = tuple(self.store.connection.execute("SELECT * FROM target_publications WHERE id = 'publication-fix7-provider'").fetchone())
        running = {"state": "content_generated", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaOperations": [{"type": "image", "status": "running", "slotId": "run-fix7-provider"}], "visualOperations": [{"type": "image", "status": "running", "slotId": "run-fix7-provider"}]}
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_IMMUTABLE"):
            self.store.update_content_run_payload("run-fix7-provider", running)
        self.assertEqual(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix7-provider'").fetchone()["payload_json"], before_run)
        self.assertEqual(tuple(self.store.connection.execute("SELECT * FROM target_publications WHERE id = 'publication-fix7-provider'").fetchone()), before_publication)

    def test_locked_content_run_accepts_approval_state_patch_without_mutating_content(self):
        self.store.create_binding({"id": "binding-approval-lock", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        run_id = "run-approval-lock"
        variant_id = "variant-approval-lock"
        self.store.create_content_run({
            "id": run_id, "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1",
            "executionMode": "llm_provider", "state": "ready", "qualityStatus": "passed",
            "qualityChecks": [{"key": "copy", "passed": True}], "approvalState": "pending",
            "body": "Immutable approved copy", "caption": "Immutable approved copy",
            "variants": [{"id": variant_id, "platform": "facebook", "kind": "text", "body": "Immutable approved copy", "caption": "Immutable approved copy"}],
        })
        self.store.create_target_publication({
            "id": "publication-approval-lock", "clientId": "client-a", "brandId": "brand-a",
            "bindingId": "binding-approval-lock", "variantId": variant_id, "idempotencyKey": "key-approval-lock",
            "approvalState": "approved", "state": "scheduled", "simulation": False,
            "scheduledAt": "2999-01-01T09:00:00Z", "contentRunId": run_id,
        })
        self.store.connection.execute("UPDATE target_publications SET worker_ack_state = 'not_required' WHERE id = 'publication-approval-lock'")
        self.store.connection.commit()
        before = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", (run_id,)).fetchone()["payload_json"]
        updated = self.store.update_content_run_payload(run_id, {
            "state": "scheduled", "approvalState": "approved", "targetApprovalState": "acknowledged",
            "scheduledAt": "2999-01-01T09:00:00Z", "planId": "plan-approval-lock",
            "targetBindingIds": ["binding-approval-lock"], "bindingIds": ["binding-approval-lock"],
            "targetApprovalIntents": [{"id": "publication-approval-lock", "bindingId": "binding-approval-lock"}],
        })
        after = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", (run_id,)).fetchone()["payload_json"]
        self.assertEqual(updated["state"], "scheduled")
        self.assertEqual(updated["approvalState"], "approved")
        self.assertEqual(updated["targetApprovalState"], "acknowledged")
        self.assertEqual(json.loads(after)["body"], "Immutable approved copy")
        self.assertEqual(json.loads(after)["variants"], json.loads(before)["variants"])
        self.assertNotEqual(after, before)
        duplicate_patch = {
            "state": "scheduled", "approvalState": "approved", "targetApprovalState": "acknowledged",
            "targetApprovalIntents": [{"id": "publication-approval-lock", "bindingId": "binding-approval-lock"}] * 2,
        }
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_IMMUTABLE"):
            self.store.update_content_run_payload(run_id, duplicate_patch)

    def test_locked_content_run_still_rejects_content_and_media_checkpoint_mutations(self):
        self.store.create_content_run({
            "id": "run-approval-lock-reject", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1",
            "executionMode": "llm_provider", "state": "scheduled", "approvalState": "approved",
            "body": "Immutable copy", "variants": [{"id": "variant-approval-lock-reject", "platform": "facebook", "kind": "text", "body": "Immutable copy"}],
        })
        for patch in ({"body": "changed"}, {"mediaOperations": [{"type": "image", "status": "running"}]}):
            with self.subTest(patch=patch), self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_IMMUTABLE"):
                self.store.update_content_run_payload("run-approval-lock-reject", patch)

    def test_authority_read_normalizes_content_run_revision_alias_and_rejects_conflicting_or_invalid_aliases(self):
        _, replacement, _, _, _, _ = self._fix6_media_replacement_run(run_id="run-fix7-read", variant_id="variant-fix7-read", revision=7)
        row = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix7-read'").fetchone()
        payload = json.loads(row["payload_json"])
        payload.pop("mediaRevision", None)
        payload["content_run_revision"] = 7
        self.store.connection.execute("UPDATE content_runs SET payload_json = ? WHERE id = 'run-fix7-read'", (json.dumps(payload, separators=(",", ":")),))
        self.store.connection.commit()
        reloaded = self.store.list_entity("content_runs", "run-fix7-read")[0]
        self.assertEqual(reloaded["mediaRevision"], 7)
        self.assertNotIn("content_run_revision", reloaded)
        updated = self.store.update_content_run_payload("run-fix7-read", replacement)
        self.assertEqual(updated["mediaRevision"], 8)
        canonical = json.loads(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix7-read'").fetchone()["payload_json"])
        self.assertEqual(canonical["mediaRevision"], 8)
        self.assertNotIn("content_run_revision", canonical)

        self._fix6_media_replacement_run(run_id="run-fix7-read-conflict", variant_id="variant-fix7-read-conflict", revision=1)
        conflict_row = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix7-read-conflict'").fetchone()
        conflict_payload = json.loads(conflict_row["payload_json"])
        conflict_payload["content_run_revision"] = 2
        conflict_before = json.dumps(conflict_payload, separators=(",", ":"))
        self.store.connection.execute("UPDATE content_runs SET payload_json = ? WHERE id = 'run-fix7-read-conflict'", (conflict_before,))
        self.store.connection.commit()
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_REVISION_ALIAS_MISMATCH"):
            self.store.list_entity("content_runs", "run-fix7-read-conflict")
        self.assertEqual(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = 'run-fix7-read-conflict'").fetchone()["payload_json"], conflict_before)

        invalid_payload = json.loads(conflict_before)
        invalid_payload.pop("mediaRevision", None)
        invalid_payload["content_run_revision"] = -1
        invalid_before = json.dumps(invalid_payload, separators=(",", ":"))
        self.store.connection.execute("UPDATE content_runs SET payload_json = ? WHERE id = 'run-fix7-read-conflict'", (invalid_before,))
        self.store.connection.commit()
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_REVISION_INVALID"):
            self.store.list_entity("content_runs", "run-fix7-read-conflict")

    def test_approval_rejects_arbitrary_variant_when_content_run_variants_are_empty(self):
        self.store.create_binding({"id": "binding-fix7-empty-variants", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        self.store.create_content_run({"id": "run-fix7-empty-variants", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "state": "ready", "qualityStatus": "passed", "approvalState": "pending", "mediaSetFingerprint": "a" * 64, "mediaAssetIds": ["asset-top-level"], "variants": []})
        approval = {"id": "publication-fix7-empty-variants", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-fix7-empty-variants", "identityVersionId": "identity-a-v1", "variantId": "variant-arbitrary", "idempotencyKey": "key-fix7-empty-variants", "approvalState": "approved", "platform": "facebook", "kind": "image", "requiredScopes": [], "mediaRequired": False, "mediaEligible": True, "simulation": True, "scheduledAt": "2999-01-01T09:00:00Z", "requestId": "approve-fix7-empty-variants", "contentRunId": "run-fix7-empty-variants"}
        with self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_SIMULATION_REMOVED"):
            self.store.begin_target_publication_approval(approval)
        self.assertEqual(self.store.list_entity("target_publications"), [])
        self.assertEqual(self.store.connection.execute("SELECT request_id FROM publication_commands").fetchall(), [])

    def test_locked_content_runs_reject_all_persisted_media_outcomes_without_mutation(self):
        locked_cases = [
            ("state-scheduled", {"state": "scheduled"}, None),
            ("state-publishing", {"state": "publishing"}, None),
            ("state-published", {"state": "published"}, None),
            ("approval-approved", {"approvalState": "approved"}, None),
            ("approval-scheduled", {"approvalState": "scheduled"}, None),
            ("approval-publishing", {"approvalState": "publishing"}, None),
            ("approval-published", {"approvalState": "published"}, None),
            ("active-publication", {}, {"state": "scheduled", "simulation": False}),
            ("provider-confirmed", {}, {"state": "published", "simulation": False}),
        ]
        patches = [
            ("generation status", {"generationStatus": "failed"}),
            ("media provenance", {"mediaProvenance": {"provider": "forged"}}),
            ("rewrite status", {"rewriteStatus": "failed"}),
            ("rewrite error", {"rewriteError": "forged provider error"}),
            ("media URLs kind and fingerprints", {"mediaUrl": "https://cdn.example/forged.png", "imageUrl": "https://cdn.example/forged-image.png", "videoUrl": "https://cdn.example/forged-video.mp4", "publicUrl": "https://cdn.example/forged-public.png", "mediaKind": "video", "mediaSha256": "b" * 64, "visualFingerprint": "forged-fingerprint"}),
            ("content kind", {"contentKind": "video"}),
            ("media operations", {"mediaOperations": [{"type": "image", "status": "failed"}], "visualOperations": [{"type": "image", "status": "failed"}]}),
            ("lifecycle quality approval", {"state": "content_generated", "qualityStatus": "pending", "qualityChecks": [], "checkedAt": "2026-09-17T00:00:00.000Z", "approvalState": "pending"}),
            ("media identity", {"mediaAssetIds": ["forged-asset"], "mediaEvidence": [], "mediaSetFingerprint": "b" * 64, "mediaRevision": 1}),
            ("target approval metadata", {"targetApprovalState": "pending", "targetApprovalIntents": []}),
        ]
        self.store.create_binding({"id": "binding-fix8-active", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        for index, (label, run_fields, publication_fields) in enumerate(locked_cases):
            run_id = f"run-fix8-{label}"
            publication_id = f"publication-fix8-{label}"
            self.store.create_content_run({"id": run_id, "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "state": "needs_review", "approvalState": "pending", **run_fields})
            if publication_fields is not None:
                self.store.create_target_publication({"id": publication_id, "bindingId": "binding-fix8-active", "variantId": f"variant-{label}", "clientId": "client-a", "brandId": "brand-a", "contentRunId": run_id, "idempotencyKey": f"key-fix8-{label}", "approvalState": "approved", "scheduledAt": f"2999-01-01T{10 + index:02d}:00:00Z", **publication_fields})
                if label == "provider-confirmed":
                    self.store.connection.execute("UPDATE target_publications SET provider_job_id = ? WHERE id = ?", ("provider-post-fix8", publication_id))
                    self.store.connection.commit()
            before_payload = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", (run_id,)).fetchone()["payload_json"]
            before_publication = self.store.connection.execute("SELECT * FROM target_publications WHERE id = ?", (publication_id,)).fetchone() if publication_fields is not None else None
            for patch_label, patch in patches:
                with self.subTest(case=label, patch=patch_label), self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_IMMUTABLE"):
                    self.store.update_content_run_payload(run_id, patch)
                self.assertEqual(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", (run_id,)).fetchone()["payload_json"], before_payload)
                if before_publication is not None:
                    self.assertEqual(self.store.connection.execute("SELECT * FROM target_publications WHERE id = ?", (publication_id,)).fetchone(), before_publication)

    def test_approval_rejects_arbitrary_variant_for_no_media_empty_variants(self):
        self.store.create_binding({"id": "binding-fix8-empty-no-media", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        self.store.create_content_run({"id": "run-fix8-empty-no-media", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "state": "ready", "qualityStatus": "passed", "approvalState": "pending", "variants": []})
        approval = {"id": "publication-fix8-empty-no-media", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-fix8-empty-no-media", "identityVersionId": "identity-a-v1", "variantId": "variant-arbitrary", "idempotencyKey": "key-fix8-empty-no-media", "approvalState": "approved", "platform": "facebook", "kind": "text", "requiredScopes": [], "mediaRequired": False, "mediaEligible": True, "simulation": True, "scheduledAt": "2999-01-01T09:00:00Z", "requestId": "approve-fix8-empty-no-media", "contentRunId": "run-fix8-empty-no-media"}
        with self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_SIMULATION_REMOVED"):
            self.store.begin_target_publication_approval(approval)
        self.assertEqual(self.store.list_entity("target_publications"), [])
        self.assertEqual(self.store.connection.execute("SELECT request_id FROM publication_commands").fetchall(), [])

    def test_media_replacement_requires_and_updates_every_durable_variant(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "media-variants.sqlite3"
            store = AgencyStateStore(path)
            store.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            store.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            store.create_identity({"id": "identity-a-v1", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            old_fingerprint = "a" * 64
            new_fingerprint = "b" * 64
            old_evidence = {"assetId": "asset-old", "sha256": "1" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
            new_evidence = {"assetId": "asset-new", "sha256": "2" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
            store.create_media_asset({"id": "asset-old", "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"kind": "image", "sha256": "1" * 64, "mimeType": "image/png", "archiveState": "active"}})
            store.create_media_asset({"id": "asset-new", "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"kind": "image", "sha256": "2" * 64, "mimeType": "image/png", "archiveState": "active"}})
            lineage = {"selectedKnowledgeItemIds": [], "selectedResearchEvidenceIds": [], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 1, "selectedRecipeId": "recipe-a", "transformMode": "original", "mediaSetFingerprint": old_fingerprint, "customerFacts": ["Operator supplied brief"]}
            old_variant = {"id": "variant-a", "platform": "facebook", "kind": "image", "body": "Durable copy", "caption": "Durable copy", "mediaAssetIds": ["asset-old"], "mediaEvidence": [old_evidence], "metadata": {"mediaEvidence": [old_evidence], "mediaSetFingerprint": old_fingerprint}}
            second_variant = {"id": "variant-b", "platform": "instagram", "kind": "image", "body": "Durable copy", "caption": "Durable copy", "mediaAssetIds": ["asset-old"], "metadata": {"mediaEvidence": [old_evidence], "mediaSetFingerprint": old_fingerprint}}
            store.create_content_run({"id": "run-media-variants", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Media variants prompt", "contentIntelligenceLineage": lineage, **lineage, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "visual", "passed": True}], "approvalState": "pending", "mediaSetFingerprint": old_fingerprint, "mediaAssetIds": ["asset-old"], "mediaEvidence": [old_evidence], "variants": [old_variant, second_variant]})
            replacement = {"mediaReplacement": True, "mediaRevision": 0, "state": "needs_review", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaSetFingerprint": new_fingerprint, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": new_fingerprint}, "prompt": "Media variants prompt", "mediaAssetIds": ["asset-new"], "mediaEvidence": [new_evidence], "mediaOperations": [{"type": "image", "status": "completed", "assetId": "asset-new", "operationVersion": 2}], "visualOperations": [{"type": "image", "status": "completed", "assetId": "asset-new", "operationVersion": 2}]}
            store.update_content_run_payload("run-media-variants", replacement)
            store.close()

            reopened = AgencyStateStore(path)
            durable = reopened.list_entity("content_runs", "run-media-variants")[0]
            self.assertEqual(durable["mediaAssetIds"], ["asset-new"])
            self.assertEqual(durable["mediaSetFingerprint"], new_fingerprint)
            for variant in durable["variants"]:
                self.assertEqual(variant["mediaAssetIds"], ["asset-new"])
                self.assertEqual(variant["metadata"]["mediaEvidence"], [new_evidence])
                self.assertEqual(variant["metadata"]["mediaSetFingerprint"], new_fingerprint)
            self.assertEqual(durable["variants"][0]["mediaEvidence"], [new_evidence])
            self.assertNotIn("mediaEvidence", durable["variants"][1])
            reopened.close()

    def test_media_replacement_rejects_stale_non_media_lineage(self):
        old_fingerprint = "a" * 64
        new_fingerprint = "b" * 64
        old_evidence = {"assetId": "asset-old", "sha256": "1" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
        new_evidence = {"assetId": "asset-new", "sha256": "2" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
        self.store.create_media_asset({"id": "asset-old", "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"kind": "image", "sha256": "1" * 64, "mimeType": "image/png", "archiveState": "active"}})
        self.store.create_media_asset({"id": "asset-new", "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"kind": "image", "sha256": "2" * 64, "mimeType": "image/png", "archiveState": "active"}})
        lineage = {"selectedKnowledgeItemIds": ["knowledge-old"], "selectedResearchEvidenceIds": [], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 1, "selectedRecipeId": "recipe-a", "transformMode": "original", "mediaSetFingerprint": old_fingerprint, "customerFacts": ["Operator supplied brief"]}
        self.store.create_content_run({"id": "run-media-stale-lineage", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Media replacement prompt", "contentIntelligenceLineage": lineage, **lineage, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "visual", "passed": True}], "approvalState": "pending", "mediaSetFingerprint": old_fingerprint, "mediaAssetIds": ["asset-old"], "mediaEvidence": [old_evidence], "variants": [{"id": "variant-stale", "platform": "facebook", "kind": "image", "body": "Durable copy", "mediaAssetIds": ["asset-old"], "metadata": {"mediaEvidence": [old_evidence], "mediaSetFingerprint": old_fingerprint}}]})
        replacement = {"mediaReplacement": True, "mediaRevision": 0, "state": "needs_review", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaSetFingerprint": new_fingerprint, "contentIntelligenceLineage": {**lineage, "selectedKnowledgeItemIds": ["knowledge-stale"], "mediaSetFingerprint": new_fingerprint}, "prompt": "Media replacement prompt", "mediaAssetIds": ["asset-new"], "mediaEvidence": [new_evidence]}
        before_json = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-media-stale-lineage",)).fetchone()["payload_json"]
        before_payload = json.loads(before_json)
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_LINEAGE_IMMUTABLE"):
            self.store.update_content_run_payload("run-media-stale-lineage", replacement)
        after_json = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-media-stale-lineage",)).fetchone()["payload_json"]
        self.assertEqual(after_json, before_json)
        self.assertEqual(json.loads(after_json), before_payload)
        self.assertEqual(json.loads(after_json)["variants"], before_payload["variants"])

    def test_media_replacement_rejects_non_string_or_mismatched_ids(self):
        old_fingerprint = "a" * 64
        new_fingerprint = "b" * 64
        old_evidence = {"assetId": "asset-old", "sha256": "1" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
        new_evidence = {"assetId": "asset-new", "sha256": "2" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
        self.store.create_media_asset({"id": "asset-old", "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"kind": "image", "sha256": "1" * 64, "mimeType": "image/png", "archiveState": "active"}})
        self.store.create_media_asset({"id": "asset-new", "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"kind": "image", "sha256": "2" * 64, "mimeType": "image/png", "archiveState": "active"}})
        lineage = {"selectedKnowledgeItemIds": [], "selectedResearchEvidenceIds": [], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 1, "selectedRecipeId": "recipe-a", "transformMode": "original", "mediaSetFingerprint": old_fingerprint, "customerFacts": ["Operator supplied brief"]}
        self.store.create_content_run({"id": "run-media-invalid-ids", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Media replacement prompt", "contentIntelligenceLineage": lineage, **lineage, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "visual", "passed": True}], "approvalState": "pending", "mediaSetFingerprint": old_fingerprint, "mediaAssetIds": ["asset-old"], "mediaEvidence": [old_evidence], "variants": [{"id": "variant-invalid", "platform": "facebook", "kind": "image", "body": "Durable copy", "mediaAssetIds": ["asset-old"], "metadata": {"mediaEvidence": [old_evidence], "mediaSetFingerprint": old_fingerprint}}]})
        base = {"mediaReplacement": True, "mediaRevision": 0, "state": "needs_review", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaSetFingerprint": new_fingerprint, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": new_fingerprint}, "prompt": "Media replacement prompt", "mediaEvidence": [new_evidence]}
        before_json = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-media-invalid-ids",)).fetchone()["payload_json"]
        before_payload = json.loads(before_json)
        for invalid_ids in ([123], ["wrong-id"], ["asset-new", "asset-new"]):
            with self.subTest(invalid_ids=invalid_ids), self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_REPLACEMENT_IDS_INVALID"):
                self.store.update_content_run_payload("run-media-invalid-ids", {**base, "mediaAssetIds": invalid_ids})
            after_json = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-media-invalid-ids",)).fetchone()["payload_json"]
            self.assertEqual(after_json, before_json)
            self.assertEqual(json.loads(after_json), before_payload)
            self.assertEqual(json.loads(after_json)["variants"], before_payload["variants"])

    def test_media_replacement_requires_explicit_revision_for_existing_media(self):
        old_fingerprint = "a" * 64
        new_fingerprint = "b" * 64
        old_evidence = {"assetId": "asset-old", "sha256": "1" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
        new_evidence = {"assetId": "asset-new", "sha256": "2" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
        for asset_id, checksum in (("asset-old", "1" * 64), ("asset-new", "2" * 64)):
            self.store.create_media_asset({"id": asset_id, "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"sha256": checksum, "mimeType": "image/png", "archiveState": "active"}})
        lineage = {"selectedKnowledgeItemIds": [], "selectedResearchEvidenceIds": [], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 1, "selectedRecipeId": "recipe-a", "transformMode": "original", "mediaSetFingerprint": old_fingerprint, "customerFacts": ["Operator supplied brief"]}
        self.store.create_content_run({"id": "run-media-revision-required", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Revision required prompt", "contentIntelligenceLineage": lineage, **lineage, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "visual", "passed": True}], "approvalState": "pending", "mediaSetFingerprint": old_fingerprint, "mediaAssetIds": ["asset-old"], "mediaEvidence": [old_evidence], "variants": [{"id": "variant-media-revision-required", "platform": "facebook", "kind": "image", "body": "Durable copy", "mediaAssetIds": ["asset-old"], "metadata": {"mediaEvidence": [old_evidence], "mediaSetFingerprint": old_fingerprint}}]})
        self.assertEqual(self.store.list_entity("content_runs", "run-media-revision-required")[0]["mediaRevision"], 0)
        before_json = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-media-revision-required",)).fetchone()["payload_json"]
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_REVISION_REQUIRED"):
            self.store.update_content_run_payload("run-media-revision-required", {"mediaReplacement": True, "state": "needs_review", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaSetFingerprint": new_fingerprint, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": new_fingerprint}, "prompt": "Revision required prompt", "mediaAssetIds": ["asset-new"], "mediaEvidence": [new_evidence]})
        self.assertEqual(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-media-revision-required",)).fetchone()["payload_json"], before_json)

    def test_media_replacement_two_writers_from_same_revision_have_one_winner_without_mixed_payload(self):
        import tempfile
        import threading
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "m05-two-writers.sqlite3"
            seed = AgencyStateStore(path)
            seed.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            seed.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            seed.create_identity({"id": "identity-a-v1", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            for asset_id, checksum in (("asset-old", "1" * 64), ("asset-new", "2" * 64), ("asset-other", "3" * 64)):
                seed.create_media_asset({"id": asset_id, "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"sha256": checksum, "mimeType": "image/png", "archiveState": "active"}})
            old_fingerprint = "a" * 64
            lineage = {"selectedKnowledgeItemIds": [], "selectedResearchEvidenceIds": [], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 1, "selectedRecipeId": "recipe-a", "transformMode": "original", "mediaSetFingerprint": old_fingerprint, "customerFacts": ["Operator supplied brief"]}
            old_evidence = {"assetId": "asset-old", "sha256": "1" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
            seed.create_content_run({"id": "run-media-two-writers", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Two writers prompt", "contentIntelligenceLineage": lineage, **lineage, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "visual", "passed": True}], "approvalState": "pending", "mediaSetFingerprint": old_fingerprint, "mediaAssetIds": ["asset-old"], "mediaEvidence": [old_evidence], "variants": [{"id": "variant-media-two-writers", "platform": "facebook", "kind": "image", "body": "Durable copy", "mediaAssetIds": ["asset-old"], "metadata": {"mediaEvidence": [old_evidence], "mediaSetFingerprint": old_fingerprint}}]})
            seed.close()

            left = AgencyStateStore(path)
            right = AgencyStateStore(path)
            barrier = threading.Barrier(2)
            results = []
            replacements = {
                "new": {"mediaReplacement": True, "mediaRevision": 0, "state": "needs_review", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaSetFingerprint": "b" * 64, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": "b" * 64}, "prompt": "Two writers prompt", "mediaAssetIds": ["asset-new"], "mediaEvidence": [{"assetId": "asset-new", "sha256": "2" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}]},
                "other": {"mediaReplacement": True, "mediaRevision": 0, "state": "needs_review", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaSetFingerprint": "c" * 64, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": "c" * 64}, "prompt": "Two writers prompt", "mediaAssetIds": ["asset-other"], "mediaEvidence": [{"assetId": "asset-other", "sha256": "3" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}]},
            }

            def write(store, label):
                barrier.wait(5)
                try:
                    results.append((label, "committed", store.update_content_run_payload("run-media-two-writers", replacements[label])))
                except Exception as error:
                    results.append((label, "rejected", error))

            threads = [threading.Thread(target=write, args=(left, "new")), threading.Thread(target=write, args=(right, "other"))]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(5)
            self.assertTrue(all(not thread.is_alive() for thread in threads))
            self.assertEqual([item[1] for item in results].count("committed"), 1)
            self.assertEqual([item[1] for item in results].count("rejected"), 1)
            rejected = next(item for item in results if item[1] == "rejected")[2]
            self.assertIsInstance(rejected, StateValidationError)
            winner_label, _, winner = next(item for item in results if item[1] == "committed")
            winner_payload = replacements[winner_label]
            current = left.list_entity("content_runs", "run-media-two-writers")[0]
            self.assertEqual(current["mediaRevision"], 1)
            self.assertEqual(current["mediaAssetIds"], winner_payload["mediaAssetIds"])
            self.assertEqual(current["mediaSetFingerprint"], winner_payload["mediaSetFingerprint"])
            self.assertEqual(current["contentIntelligenceLineage"]["mediaSetFingerprint"], winner_payload["mediaSetFingerprint"])
            self.assertEqual(current["mediaEvidence"], winner_payload["mediaEvidence"])
            for variant in current["variants"]:
                self.assertEqual(variant["mediaAssetIds"], winner_payload["mediaAssetIds"])
                self.assertEqual(variant["mediaSetFingerprint"], winner_payload["mediaSetFingerprint"])
                self.assertEqual(variant["metadata"]["mediaEvidence"], winner_payload["mediaEvidence"])
            left.close()
            right.close()

    def test_approval_rejects_stale_legacy_media_id_and_conflicting_snapshot_aliases(self):
        self.store.create_binding({"id": "binding-media-snapshot", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        for asset_id, checksum in (("asset-old", "1" * 64), ("asset-current", "2" * 64)):
            self.store.create_media_asset({"id": asset_id, "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"sha256": checksum, "mimeType": "image/png", "archiveState": "active"}})
        fingerprint = "b" * 64
        evidence = {"assetId": "asset-current", "sha256": "2" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
        self.store.create_content_run({"id": "run-media-snapshot-aliases", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Snapshot aliases prompt", "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "visual", "passed": True}], "approvalState": "pending", "mediaSetFingerprint": fingerprint, "mediaRevision": 1, "mediaAssetIds": ["asset-current"], "mediaEvidence": [evidence], "variants": [{"id": "variant-media-snapshot-aliases", "platform": "facebook", "kind": "image", "body": "Durable copy", "mediaAssetIds": ["asset-current"], "mediaEvidence": [evidence], "metadata": {"mediaEvidence": [evidence], "mediaSetFingerprint": fingerprint}}]})

        worker_base = {"client_id": "client-a", "brand_id": "brand-a", "binding_id": "binding-media-snapshot", "identity_version_id": "identity-a-v1", "page_id": "page-a", "plan_id": None, "content_run_id": "run-media-snapshot-aliases", "variant_id": "variant-media-snapshot-aliases", "platform": "facebook", "kind": "image", "required_scopes": [], "approval_state": "approved", "simulation": False, "mediaAssetIds": ["asset-current"], "media_set_fingerprint": fingerprint, "mediaRevision": 1}

        def approval_for(worker, suffix):
            publication_id = f"publication-media-snapshot-{suffix}"
            scheduled_at = f"2999-01-01T{10 + len(suffix):02d}:00:00+00:00"
            return {"id": publication_id, "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-media-snapshot", "identityVersionId": "identity-a-v1", "variantId": "variant-media-snapshot-aliases", "idempotencyKey": f"key-media-snapshot-{suffix}", "approvalState": "approved", "platform": "facebook", "kind": "image", "requiredScopes": [], "mediaRequired": True, "mediaEligible": True, "mediaUrl": "https://cdn.example/current.png", "simulation": False, "scheduledAt": scheduled_at, "requestId": f"approve-media-snapshot-{suffix}", "contentRunId": "run-media-snapshot-aliases", "mediaRevision": 1, "mediaSetFingerprint": fingerprint, "mediaAssetIds": ["asset-current"], "workerJob": {"jobId": f"job-media-snapshot-{suffix}", "idempotencyKey": f"key-media-snapshot-{suffix}", "scheduledAt": scheduled_at, "payload": {**worker_base, "target_publication_id": publication_id, **worker}}}

        with self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_STALE") as stale:
            self.store.begin_target_publication_approval(approval_for({"media_asset_id": "asset-old", "media_sha256": "2" * 64, "media_mime_type": "image/png"}, "legacy"))
        self.assertIsInstance(stale.exception, StateValidationError)
        self.assertEqual(self.store.list_entity("target_publications"), [])
        self.assertEqual(self.store.connection.execute("SELECT request_id FROM publication_commands").fetchall(), [])

        conflicts = {
            "ids": {"media_asset_ids": ["asset-old"]},
            "fingerprint": {"mediaSetFingerprint": fingerprint, "media_set_fingerprint": "c" * 64},
            "revision": {"mediaRevision": 1, "media_revision": 0},
        }
        for suffix, extra in conflicts.items():
            with self.subTest(alias=suffix), self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_STALE"):
                self.store.begin_target_publication_approval(approval_for(extra, suffix))
            self.assertEqual(self.store.list_entity("target_publications"), [])
            self.assertEqual(self.store.connection.execute("SELECT request_id FROM publication_commands").fetchall(), [])

    def test_m05_approval_and_media_replacement_have_one_deterministic_winner(self):
        import tempfile
        import threading
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "m05-race.sqlite3"
            seed = AgencyStateStore(path)
            seed.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            seed.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            seed.create_identity({"id": "identity-a-v1", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            seed.create_connection({"id": "connection-a", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a", "displayName": "Page A", "connectionState": "connected", "scopes": []})
            seed.create_binding({"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
            for asset_id, checksum in (("asset-old", "1" * 64), ("asset-new", "2" * 64)):
                seed.create_media_asset({"id": asset_id, "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"kind": "image", "sha256": checksum, "mimeType": "image/png", "archiveState": "active"}})
            old_fingerprint = "a" * 64
            new_fingerprint = "b" * 64
            lineage = {"selectedKnowledgeItemIds": [], "selectedResearchEvidenceIds": [], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 1, "selectedRecipeId": "recipe-a", "transformMode": "original", "mediaSetFingerprint": old_fingerprint, "customerFacts": ["Operator supplied brief"]}
            old_evidence = {"assetId": "asset-old", "sha256": "1" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
            seed.create_content_run({"id": "run-m05-race", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Race prompt", "contentIntelligenceLineage": lineage, **lineage, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "visual", "passed": True}], "approvalState": "pending", "mediaSetFingerprint": old_fingerprint, "mediaAssetIds": ["asset-old"], "mediaEvidence": [old_evidence], "variants": [{"id": "variant-m05-race", "platform": "facebook", "kind": "image", "body": "Durable copy", "caption": "Durable copy", "mediaAssetIds": ["asset-old"], "metadata": {"mediaEvidence": [old_evidence], "mediaSetFingerprint": old_fingerprint}}]})
            seed.close()

            approval_store = AgencyStateStore(path)
            replacement_store = AgencyStateStore(path)
            preflight_entered = threading.Event()
            release_preflight = threading.Event()
            replacement_finished = threading.Event()
            approval_errors = []
            replacement_results = []
            original_preflight = approval_store.preflight_target_publication

            def held_preflight(value):
                result = original_preflight(value)
                preflight_entered.set()
                if not release_preflight.wait(5):
                    raise AssertionError("approval preflight did not resume")
                return result

            approval_store.preflight_target_publication = held_preflight
            worker_payload = {"client_id": "client-a", "brand_id": "brand-a", "binding_id": "binding-a", "identity_version_id": "identity-a-v1", "target_publication_id": "publication-m05-race", "page_id": "page-a", "plan_id": None, "content_run_id": "run-m05-race", "variant_id": "variant-m05-race", "platform": "facebook", "kind": "image", "required_scopes": [], "approval_state": "approved", "simulation": False, "mediaAssetIds": ["asset-old"], "media_set_fingerprint": old_fingerprint, "mediaRevision": 0, "media_asset_id": "asset-old", "media_sha256": "1" * 64}
            approval = {"id": "publication-m05-race", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-a", "identityVersionId": "identity-a-v1", "variantId": "variant-m05-race", "idempotencyKey": "key-m05-race", "approvalState": "approved", "platform": "facebook", "kind": "image", "requiredScopes": [], "mediaRequired": True, "mediaEligible": True, "mediaUrl": "https://cdn.example/old.png", "simulation": False, "scheduledAt": "2999-01-01T09:00:00+00:00", "requestId": "approve-m05-race", "contentRunId": "run-m05-race", "mediaRevision": 0, "mediaSetFingerprint": old_fingerprint, "mediaAssetIds": ["asset-old"], "workerJob": {"jobId": "job-m05-race", "idempotencyKey": "key-m05-race", "scheduledAt": "2999-01-01T09:00:00+00:00", "payload": worker_payload}}

            def approve():
                try:
                    approval_store.begin_target_publication_approval(approval)
                except Exception as error:
                    approval_errors.append(error)

            def replace():
                try:
                    replacement_results.append(replacement_store.update_content_run_payload("run-m05-race", {"mediaReplacement": True, "mediaRevision": 0, "state": "needs_review", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaSetFingerprint": new_fingerprint, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": new_fingerprint}, "prompt": "Race prompt", "mediaAssetIds": ["asset-new"], "mediaEvidence": [{"assetId": "asset-new", "sha256": "2" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}]}))
                except Exception as error:
                    replacement_results.append(error)
                finally:
                    replacement_finished.set()

            approval_thread = threading.Thread(target=approve)
            approval_thread.start()
            if not preflight_entered.wait(5):
                approval_thread.join(1)
                self.fail(f"approval preflight did not start: {approval_errors!r}")
            replacement_thread = threading.Thread(target=replace)
            replacement_thread.start()
            self.assertTrue(replacement_finished.wait(5))
            release_preflight.set()
            approval_thread.join(5)
            replacement_thread.join(5)
            self.assertFalse(approval_thread.is_alive())
            self.assertFalse(replacement_thread.is_alive())
            self.assertEqual(len(replacement_results), 1)
            self.assertIsInstance(replacement_results[0], dict)
            self.assertEqual(len(approval_errors), 1)
            self.assertIsInstance(approval_errors[0], StateValidationError)
            self.assertEqual(approval_store.list_entity("target_publications"), [])
            self.assertEqual(approval_store.connection.execute("SELECT request_id FROM publication_commands").fetchall(), [])
            current = approval_store.list_entity("content_runs", "run-m05-race")[0]
            self.assertEqual(current["mediaAssetIds"], ["asset-new"])
            self.assertEqual(current["mediaSetFingerprint"], new_fingerprint)
            self.assertEqual(current["mediaRevision"], 1)
            commands = approval_store.connection.execute("SELECT command_json FROM publication_commands").fetchall()
            for row in commands:
                command = json.loads(row["command_json"])
                media_payload = command.get("workerJob", {}).get("payload", {})
                self.assertEqual(media_payload.get("mediaAssetIds"), current["mediaAssetIds"])
                self.assertEqual(media_payload.get("media_set_fingerprint"), current["mediaSetFingerprint"])

            approval_lock_entered = threading.Event()
            release_approval_lock = threading.Event()
            replacement_attempted = threading.Event()
            replacement_winner_finished = threading.Event()
            approval_winner_errors = []
            replacement_winner_errors = []
            original_snapshot_validation = approval_store._validate_content_run_approval_media_snapshot

            def held_snapshot_validation(*args):
                approval_lock_entered.set()
                if not release_approval_lock.wait(5):
                    raise AssertionError("approval transaction did not resume")
                return original_snapshot_validation(*args)

            approval_store._validate_content_run_approval_media_snapshot = held_snapshot_validation
            current_fingerprint = new_fingerprint
            current_revision = 1
            approval_winner_worker = {"client_id": "client-a", "brand_id": "brand-a", "binding_id": "binding-a", "identity_version_id": "identity-a-v1", "target_publication_id": "publication-m05-race-approval-wins", "page_id": "page-a", "plan_id": None, "content_run_id": "run-m05-race", "variant_id": "variant-m05-race", "platform": "facebook", "kind": "image", "required_scopes": [], "approval_state": "approved", "simulation": False, "mediaAssetIds": ["asset-new"], "media_set_fingerprint": current_fingerprint, "mediaRevision": current_revision}
            approval_winner = {"id": "publication-m05-race-approval-wins", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-a", "identityVersionId": "identity-a-v1", "variantId": "variant-m05-race", "idempotencyKey": "key-m05-race-approval-wins", "approvalState": "approved", "platform": "facebook", "kind": "image", "requiredScopes": [], "mediaRequired": True, "mediaEligible": True, "mediaUrl": "https://cdn.example/new.png", "simulation": False, "scheduledAt": "2999-01-01T10:00:00+00:00", "requestId": "approve-m05-race-approval-wins", "contentRunId": "run-m05-race", "mediaRevision": current_revision, "mediaSetFingerprint": current_fingerprint, "mediaAssetIds": ["asset-new"], "workerJob": {"jobId": "job-m05-race-approval-wins", "idempotencyKey": "key-m05-race-approval-wins", "scheduledAt": "2999-01-01T10:00:00+00:00", "payload": approval_winner_worker}}

            def approve_current_media():
                try:
                    approval_store.begin_target_publication_approval(approval_winner)
                except Exception as error:
                    approval_winner_errors.append(error)

            def replace_after_approval():
                replacement_attempted.set()
                try:
                    replacement_store.update_content_run_payload("run-m05-race", {"mediaReplacement": True, "mediaRevision": current_revision, "state": "needs_review", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaSetFingerprint": "c" * 64, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": "c" * 64}, "prompt": "Race prompt", "mediaAssetIds": ["asset-third"], "mediaEvidence": [{"assetId": "asset-third", "sha256": "3" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}]})
                except Exception as error:
                    replacement_winner_errors.append(error)
                finally:
                    replacement_winner_finished.set()

            approval_winner_thread = threading.Thread(target=approve_current_media)
            approval_winner_thread.start()
            self.assertTrue(approval_lock_entered.wait(5))
            replacement_after_approval_thread = threading.Thread(target=replace_after_approval)
            replacement_after_approval_thread.start()
            self.assertTrue(replacement_attempted.wait(5))
            release_approval_lock.set()
            self.assertTrue(replacement_winner_finished.wait(5))
            approval_winner_thread.join(5)
            replacement_after_approval_thread.join(5)
            self.assertFalse(approval_winner_thread.is_alive())
            self.assertFalse(replacement_after_approval_thread.is_alive())
            self.assertEqual(approval_winner_errors, [])
            self.assertEqual(len(replacement_winner_errors), 1)
            self.assertIsInstance(replacement_winner_errors[0], StateValidationError)
            committed = approval_store.connection.execute("SELECT command_json FROM publication_commands WHERE request_id = ?", ("approve-m05-race-approval-wins",)).fetchone()
            self.assertIsNotNone(committed)
            committed_payload = json.loads(committed["command_json"])["workerJob"]["payload"]
            self.assertEqual(committed_payload["mediaAssetIds"], ["asset-new"])
            self.assertEqual(committed_payload["media_set_fingerprint"], current_fingerprint)
            self.assertEqual(committed_payload["mediaRevision"], current_revision)
            self.assertEqual(approval_store.list_entity("content_runs", "run-m05-race")[0]["mediaAssetIds"], ["asset-new"])
            approval_store.close()
            replacement_store.close()

    def test_non_cas_checkpoint_rejects_approval_committed_between_read_and_write(self):
        import tempfile
        import threading
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "m05-authority-race.sqlite3"
            seed = AgencyStateStore(path)
            seed.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            seed.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            seed.create_identity({"id": "identity-a-v1", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            seed.create_connection({"id": "connection-a", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a", "displayName": "Page A", "connectionState": "connected", "scopes": []})
            seed.create_binding({"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
            seed.create_content_run({"id": "run-authority-race", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "copy", "passed": True}], "approvalState": "pending", "variants": [{"id": "variant-authority-race", "platform": "facebook", "kind": "text", "body": "Original copy"}]})
            seed.close()

            updater = AgencyStateStore(path)
            approver = AgencyStateStore(path)
            first_read = threading.Event()
            release = threading.Event()
            approval_done = threading.Event()
            update_errors = []
            approval_errors = []
            original_locked = updater._content_run_is_locked

            def held_locked(content_run_id, payload):
                result = original_locked(content_run_id, payload)
                if not updater.connection.in_transaction:
                    first_read.set()
                    if not release.wait(5):
                        raise AssertionError("authority race barrier was not released")
                return result

            updater._content_run_is_locked = held_locked
            before_payload = updater.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-authority-race",)).fetchone()["payload_json"]

            approval = {
                "id": "publication-authority-race", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-a",
                "identityVersionId": "identity-a-v1", "variantId": "variant-authority-race", "idempotencyKey": "key-authority-race",
                "approvalState": "approved", "platform": "facebook", "kind": "text", "requiredScopes": [],
                "mediaRequired": False, "simulation": False, "scheduledAt": "2999-01-01T09:00:00+00:00",
                "workerJob": {"jobId": "job-authority-race", "idempotencyKey": "key-authority-race", "scheduledAt": "2999-01-01T09:00:00+00:00", "payload": {"approval_state": "approved", "workspace_id": "client-a", "client_id": "client-a", "brand_id": "brand-a", "binding_id": "binding-a", "identity_version_id": "identity-a-v1", "page_id": "page-a", "platform": "facebook", "kind": "text", "required_scopes": [], "target_publication_id": "publication-authority-race", "content_run_id": "run-authority-race", "variant_id": "variant-authority-race"}},
                "requestId": "approve-authority-race", "contentRunId": "run-authority-race",
            }

            def update():
                try:
                    updater.update_content_run_payload("run-authority-race", {"generationStatus": "failed"})
                except Exception as error:
                    update_errors.append(error)

            def approve():
                try:
                    approver.begin_target_publication_approval(approval)
                except Exception as error:
                    approval_errors.append(error)
                finally:
                    approval_done.set()

            update_thread = threading.Thread(target=update)
            approval_thread = threading.Thread(target=approve)
            update_thread.start()
            try:
                self.assertTrue(first_read.wait(5))
                approval_thread.start()
                self.assertTrue(approval_done.wait(5), approval_errors)
                after_approval_payload = approver.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-authority-race",)).fetchone()["payload_json"]
                after_approval_publications = [tuple(row) for row in approver.connection.execute("SELECT id, binding_id, variant_id, content_run_id, state, simulation, scheduled_at FROM target_publications ORDER BY id").fetchall()]
                after_approval_commands = [tuple(row) for row in approver.connection.execute("SELECT request_id, publication_id, status, command_json FROM publication_commands ORDER BY request_id").fetchall()]
            finally:
                release.set()
                update_thread.join(5)
                approval_thread.join(5)

            self.assertFalse(update_thread.is_alive())
            self.assertFalse(approval_thread.is_alive())
            self.assertEqual(approval_errors, [])
            self.assertEqual(len(update_errors), 1)
            self.assertIsInstance(update_errors[0], StateValidationError)
            self.assertEqual(str(update_errors[0]), "CONTENT_RUN_REVISION_IMMUTABLE")
            self.assertEqual(after_approval_payload, before_payload)
            self.assertEqual(updater.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-authority-race",)).fetchone()["payload_json"], before_payload)
            self.assertEqual([tuple(row) for row in updater.connection.execute("SELECT id, binding_id, variant_id, content_run_id, state, simulation, scheduled_at FROM target_publications ORDER BY id").fetchall()], after_approval_publications)
            self.assertEqual([tuple(row) for row in updater.connection.execute("SELECT request_id, publication_id, status, command_json FROM publication_commands ORDER BY request_id").fetchall()], after_approval_commands)
            self.assertEqual(len(after_approval_publications), 1)
            updater.close()
            approver.close()

    def test_media_replacement_rejections_preserve_complete_payload(self):
        self.store.create_brand({"id": "brand-other", "clientId": "client-a", "name": "Other Brand", "status": "active"})
        old_fingerprint = "a" * 64
        lineage = {"selectedKnowledgeItemIds": [], "selectedResearchEvidenceIds": [], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 1, "selectedRecipeId": "recipe-a", "transformMode": "original", "mediaSetFingerprint": old_fingerprint, "customerFacts": ["Operator supplied brief"]}
        old_evidence = {"assetId": "asset-old", "sha256": "1" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
        self.store.create_media_asset({"id": "asset-old", "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"sha256": "1" * 64, "mimeType": "image/png", "archiveState": "active"}})
        self.store.create_content_run({"id": "run-media-rejection-payload", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Stable prompt", "contentIntelligenceLineage": lineage, **lineage, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "visual", "passed": True}], "approvalState": "pending", "mediaSetFingerprint": old_fingerprint, "mediaAssetIds": ["asset-old"], "mediaEvidence": [old_evidence], "variants": [{"id": "variant-rejection-a", "platform": "facebook", "kind": "image", "body": "Copy A", "mediaAssetIds": ["asset-old"], "metadata": {"mediaEvidence": [old_evidence], "mediaSetFingerprint": old_fingerprint}}, {"id": "variant-rejection-b", "platform": "instagram", "kind": "image", "body": "Copy B", "mediaAssetIds": ["asset-old"], "metadata": {"mediaEvidence": [old_evidence], "mediaSetFingerprint": old_fingerprint}}]})
        self.store.create_media_asset({"id": "asset-cross-scope", "clientId": "client-a", "brandId": "brand-other", "source": "generated", "metadata": {"sha256": "2" * 64, "mimeType": "image/png", "archiveState": "active"}})
        self.store.create_media_asset({"id": "asset-archived", "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"sha256": "3" * 64, "mimeType": "image/png", "archiveState": "active"}})
        self.store.archive_media_asset("asset-archived")
        self.store.create_media_asset({"id": "asset-hash-mismatch", "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"sha256": "4" * 64, "mimeType": "image/png", "archiveState": "active"}})
        self.store.create_media_asset({"id": "asset-mime-mismatch", "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"sha256": "5" * 64, "mimeType": "image/jpeg", "archiveState": "active"}})
        cases = [
            ("cross-scope", "asset-cross-scope", "2" * 64, "image/png", "CONTENT_RUN_MEDIA_ASSET_SCOPE_MISMATCH"),
            ("archived", "asset-archived", "3" * 64, "image/png", "CONTENT_RUN_MEDIA_ASSET_ARCHIVED"),
            ("hash-mismatched", "asset-hash-mismatch", "6" * 64, "image/png", "CONTENT_RUN_MEDIA_ASSET_METADATA_MISMATCH"),
            ("mime-mismatched", "asset-mime-mismatch", "5" * 64, "image/png", "CONTENT_RUN_MEDIA_ASSET_METADATA_MISMATCH"),
        ]
        before_json = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-media-rejection-payload",)).fetchone()["payload_json"]
        before_payload = json.loads(before_json)
        for index, (label, asset_id, checksum, mime_type, error_code) in enumerate(cases):
            with self.subTest(label=label), self.assertRaisesRegex(StateValidationError, error_code):
                self.store.update_content_run_payload("run-media-rejection-payload", {"mediaReplacement": True, "mediaRevision": 0, "state": "needs_review", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaSetFingerprint": f"{index + 2:x}" * 64, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": f"{index + 2:x}" * 64}, "prompt": "Stable prompt", "mediaAssetIds": [asset_id], "mediaEvidence": [{"assetId": asset_id, "sha256": checksum, "mimeType": mime_type, "order": 0, "role": "publish", "uploadState": "processed"}]})
            after_json = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-media-rejection-payload",)).fetchone()["payload_json"]
            self.assertEqual(after_json, before_json)
            self.assertEqual(json.loads(after_json), before_payload)
            self.assertEqual(json.loads(after_json)["variants"], before_payload["variants"])

    def test_media_replacement_revision_fence_rejects_stale_writer(self):
        old_fingerprint = "a" * 64
        lineage = {"selectedKnowledgeItemIds": [], "selectedResearchEvidenceIds": [], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 1, "selectedRecipeId": "recipe-a", "transformMode": "original", "mediaSetFingerprint": old_fingerprint, "customerFacts": ["Operator supplied brief"]}
        old_evidence = {"assetId": "asset-old", "sha256": "1" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}
        for asset_id, checksum in (("asset-old", "1" * 64), ("asset-new", "2" * 64), ("asset-other", "3" * 64)):
            self.store.create_media_asset({"id": asset_id, "clientId": "client-a", "brandId": "brand-a", "source": "generated", "metadata": {"sha256": checksum, "mimeType": "image/png", "archiveState": "active"}})
        self.store.create_content_run({"id": "run-media-revision-fence", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Revision fence prompt", "contentIntelligenceLineage": lineage, **lineage, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "visual", "passed": True}], "approvalState": "pending", "mediaSetFingerprint": old_fingerprint, "mediaAssetIds": ["asset-old"], "mediaEvidence": [old_evidence], "variants": [{"id": "variant-media-revision-fence", "platform": "facebook", "kind": "image", "body": "Durable copy", "mediaAssetIds": ["asset-old"], "metadata": {"mediaEvidence": [old_evidence], "mediaSetFingerprint": old_fingerprint}}]})
        first_fingerprint = "b" * 64
        first = {"mediaReplacement": True, "mediaRevision": 0, "state": "needs_review", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaSetFingerprint": first_fingerprint, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": first_fingerprint}, "prompt": "Revision fence prompt", "mediaAssetIds": ["asset-new"], "mediaEvidence": [{"assetId": "asset-new", "sha256": "2" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}]}
        self.assertEqual(self.store.update_content_run_payload("run-media-revision-fence", first)["mediaRevision"], 1)
        before_stale = self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-media-revision-fence",)).fetchone()["payload_json"]
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_REVISION_IMMUTABLE"):
            self.store.update_content_run_payload("run-media-revision-fence", {"mediaRevision": 2})
        self.assertEqual(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-media-revision-fence",)).fetchone()["payload_json"], before_stale)
        stale_fingerprint = "c" * 64
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_REVISION_MISMATCH"):
            self.store.update_content_run_payload("run-media-revision-fence", {"mediaReplacement": True, "mediaRevision": 0, "state": "needs_review", "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "mediaSetFingerprint": stale_fingerprint, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": stale_fingerprint}, "prompt": "Revision fence prompt", "mediaAssetIds": ["asset-other"], "mediaEvidence": [{"assetId": "asset-other", "sha256": "3" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}]})
        self.assertEqual(self.store.connection.execute("SELECT payload_json FROM content_runs WHERE id = ?", ("run-media-revision-fence",)).fetchone()["payload_json"], before_stale)

    def test_content_run_strategy_fields_round_trip_through_create_update_and_quality_cas(self):
        if AgencyStateStore is None:
            return
        snapshot = {
            "objectiveKey": "reach", "objectiveLabel": "Reach", "pillarId": "audience-insight", "pillarLabel": "Audience insight",
            "angleId": "audience-insight-audience-question", "angleLabel": "Audience question", "angleGuidance": "Answer one audience question.",
            "channel": "facebook", "format": "text", "strategyVersion": 4, "catalogFingerprint": "a" * 64,
        }
        lineage = {"selectedKnowledgeItemIds": [], "selectedResearchEvidenceIds": [], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 1, "selectedRecipeId": "recipe-a", "transformMode": "original", "customerFacts": ["Operator supplied topic"]}
        payload = {
            "id": "run-strategy-fields", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider",
            "prompt": "strategy prompt", "contentAngle": "Audience question", "strategyVersion": 4, "catalogFingerprint": "a" * 64, "strategySnapshot": snapshot,
            "strategyState": "clean", "regenerationState": "clean", "contentPillar": "Audience insight", "objective": "Reach", "state": "needs_review",
            "contentIntelligenceLineage": lineage, **lineage,
        }
        created = self.store.create_content_run(payload)
        self.assertEqual(created["contentAngle"], "Audience question")
        self.assertEqual(created["strategyVersion"], 4)
        self.assertEqual(created["catalogFingerprint"], "a" * 64)
        self.assertEqual(created["strategySnapshot"], snapshot)
        self.assertEqual(created["strategyState"], "clean")
        updated = self.store.update_content_run_payload("run-strategy-fields", {"strategyState": "needs_regeneration", "regenerationState": "needs_regeneration"})
        self.assertEqual((updated["strategyState"], updated["regenerationState"], updated["strategySnapshot"]), ("needs_regeneration", "needs_regeneration", snapshot))
        expected = {
            "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "revisionId": None, "topic": None, "body": None, "caption": None,
            "contentPillar": "Audience insight", "contentAngle": "Audience question", "objective": "Reach", "strategyVersion": 4, "catalogFingerprint": "a" * 64,
            "strategySnapshot": snapshot, "strategyState": "needs_regeneration", "regenerationState": "needs_regeneration", "cta": None, "hashtags": None, "seoKeywords": None,
            "scheduledAt": None, "sources": None, "notes": None, "variantId": "variant-strategy",
            "variant": {"title": None, "body": None, "caption": None, "contentPillar": None, "contentAngle": None, "objective": None, "strategyVersion": None, "catalogFingerprint": None, "strategySnapshot": None, "cta": None, "hashtags": [], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "mediaEvidence": []},
        }
        self.store.update_content_run_payload("run-strategy-fields", {"variants": [{"id": "variant-strategy", "platform": "facebook", "kind": "text", "title": None, "body": "Copy", "caption": "Copy", "contentPillar": "Audience insight", "contentAngle": "Audience question", "objective": "Reach", "strategyVersion": 4, "catalogFingerprint": "a" * 64, "strategySnapshot": snapshot, "cta": "Read", "hashtags": [], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "metadata": {"mediaEvidence": []}}], "body": "Copy", "caption": "Copy", "topic": "Topic", "revisionId": "revision-strategy", "qualityStatus": "pending", "qualityChecks": [], "state": "needs_review"})
        expected.update({"revisionId": "revision-strategy", "topic": "Topic", "body": "Copy", "caption": "Copy", "strategyState": "needs_regeneration", "regenerationState": "needs_regeneration", "variantId": "variant-strategy", "variant": {"title": None, "body": "Copy", "caption": "Copy", "contentPillar": "Audience insight", "contentAngle": "Audience question", "objective": "Reach", "strategyVersion": 4, "catalogFingerprint": "a" * 64, "strategySnapshot": snapshot, "cta": "Read", "hashtags": [], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "mediaEvidence": []}})
        quality = self.store.update_content_run_payload("run-strategy-fields", {"expectedRevisionFields": expected, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "copy", "passed": True}], "checkedAt": "2026-09-14T00:00:00.000Z"})
        self.assertEqual((quality["strategyVersion"], quality["catalogFingerprint"], quality["strategySnapshot"]), (4, "a" * 64, snapshot))
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_PAYLOAD_INVALID"):
            self.store.create_content_run({**payload, "id": "run-strategy-unknown", "unknownStrategyField": True})
        self.assertEqual(self.store.list_entity("content_runs", "run-strategy-unknown"), [])

    def test_content_run_quality_cas_rejects_a_held_stale_revision_then_accepts_current_revision(self):
        if AgencyStateStore is None:
            return
        self.store.create_content_run({
            "id": "run-quality-cas", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1",
            "executionMode": "llm_provider", "revisionId": "revision-old", "topic": "Old topic", "body": "Old copy",
            "caption": "Old copy", "contentPillar": "Education", "objective": "Reach", "cta": "Read", "hashtags": ["#old"],
            "seoKeywords": [], "sources": ["source"], "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "state": "needs_review",
            "variants": [{"id": "variant-7", "platform": "facebook", "kind": "text", "title": "Old title", "body": "Old copy", "caption": "Old copy", "cta": "Read", "hashtags": ["#old"], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "metadata": {"mediaEvidence": []}}],
        })

        def expected_revision(revision_id, topic, body, title, tag):
            return {
                "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "revisionId": revision_id, "topic": topic, "body": body, "caption": body, "contentPillar": "Education",
                "objective": "Reach", "cta": "Read", "hashtags": [tag], "seoKeywords": [], "scheduledAt": None,
                "sources": ["source"], "notes": None, "variantId": "variant-7",
                "variant": {"title": title, "body": body, "caption": body, "cta": "Read", "hashtags": [tag], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "mediaEvidence": []},
            }

        held_request_fields = expected_revision("revision-old", "Old topic", "Old copy", "Old title", "#old")
        self.store.update_content_run_payload("run-quality-cas", {
            "revisionId": "revision-new", "topic": "New topic", "body": "New copy", "caption": "New copy", "hashtags": ["#new"], "qualityStatus": "pending",
            "qualityChecks": [], "approvalState": "pending", "state": "needs_review",
            "variants": [{"id": "variant-7", "platform": "facebook", "kind": "text", "title": "New title", "body": "New copy", "caption": "New copy", "cta": "Read", "hashtags": ["#new"], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "metadata": {"mediaEvidence": []}}],
        })

        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_MISMATCH"):
            self.store.update_content_run_payload("run-quality-cas", {
                "expectedRevisionFields": held_request_fields, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "copy", "passed": True}], "checkedAt": "2026-09-13T05:00:00.000Z",
            })
        current = self.store.list_entity("content_runs", "run-quality-cas")[0]
        self.assertEqual((current["revisionId"], current["body"], current["qualityStatus"], current["qualityChecks"], current["state"]), ("revision-new", "New copy", "pending", [], "needs_review"))

        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_QUALITY_RESULT_INVALID"):
            self.store.update_content_run_payload("run-quality-cas", {
                "expectedRevisionFields": expected_revision("revision-new", "New topic", "New copy", "New title", "#new"),
                "state": "needs_review", "qualityStatus": "passed", "qualityChecks": [{"key": "copy", "passed": True}], "checkedAt": "2026-09-13T05:00:30.000Z",
            })
        current = self.store.list_entity("content_runs", "run-quality-cas")[0]
        self.assertEqual((current["qualityStatus"], current["qualityChecks"], current["state"]), ("pending", [], "needs_review"))

        matching = self.store.update_content_run_payload("run-quality-cas", {
            "expectedRevisionFields": expected_revision("revision-new", "New topic", "New copy", "New title", "#new"),
            "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "copy", "passed": True}], "checkedAt": "2026-09-13T05:01:00.000Z",
        })
        self.assertEqual((matching["revisionId"], matching["qualityStatus"], matching["state"], matching["approvalState"], matching["checkedAt"]), ("revision-new", "passed", "ready", "pending", "2026-09-13T05:01:00.000Z"))
        self.assertNotIn("expectedRevisionFields", matching)

    def test_content_run_quality_cas_rejects_changed_identity_scope(self):
        if AgencyStateStore is None:
            return
        self.store.create_identity({"id": "identity-a-v2", "brandId": "brand-a", "name": "Second", "isDefault": False, "version": 2, "status": "active"})
        self.store.create_content_run({"id": "run-quality-scope", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "revisionId": "revision-1", "topic": "Hook", "body": "Copy", "caption": "Copy", "contentPillar": "Education", "objective": "Reach", "cta": "Read", "hashtags": ["#tag"], "seoKeywords": [], "sources": ["source"], "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "state": "needs_review", "variants": [{"id": "variant-scope", "platform": "facebook", "kind": "text", "title": "Hook", "body": "Copy", "caption": "Copy", "cta": "Read", "hashtags": ["#tag"], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "metadata": {"mediaEvidence": []}}]})
        expected = {"clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "revisionId": "revision-1", "topic": "Hook", "body": "Copy", "caption": "Copy", "contentPillar": "Education", "objective": "Reach", "cta": "Read", "hashtags": ["#tag"], "seoKeywords": [], "scheduledAt": None, "sources": ["source"], "notes": None, "variantId": "variant-scope", "variant": {"title": "Hook", "body": "Copy", "caption": "Copy", "cta": "Read", "hashtags": ["#tag"], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "mediaEvidence": []}}
        self.store.connection.execute("UPDATE content_runs SET identity_version_id = 'identity-a-v2' WHERE id = 'run-quality-scope'")
        self.store.connection.commit()
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_MISMATCH"):
            self.store.update_content_run_payload("run-quality-scope", {"expectedRevisionFields": expected, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "copy", "passed": True}], "checkedAt": "2026-09-13T05:02:00.000Z"})
        current = self.store.list_entity("content_runs", "run-quality-scope")[0]
        self.assertEqual((current["identity_version_id"], current["qualityStatus"], current["qualityChecks"]), ("identity-a-v2", "pending", []))

    def test_content_run_c3_evidence_round_trips_across_restart(self):
        if AgencyStateStore is None:
            return
        import tempfile
        from pathlib import Path

        evidence = [
            {"assetId": f"asset-{order}", "sha256": str(order + 1) * 64, "mimeType": "image/png", "order": order, "role": "publish" if order == 0 else "reference", "uploadState": "pending"}
            for order in range(6)
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agency.sqlite3"
            store = AgencyStateStore(path)
            store.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            store.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            store.create_identity({"id": "identity-a-v1", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            for order in range(6):
                store.create_media_asset({"id": f"asset-{order}", "clientId": "client-a", "brandId": "brand-a", "source": "local", "metadata": {"sha256": str(order + 1) * 64, "mimeType": "image/png", "sizeBytes": 1}})
            created = store.create_content_run({"id": "run-c3", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "requestId": "request-c3", "promptVersion": "prompt-v1", "mediaSetFingerprint": "a" * 64, "generationStatus": "pending", "mediaEvidence": evidence})
            self.assertEqual({key: created[key] for key in ("requestId", "promptVersion", "mediaSetFingerprint", "generationStatus")}, {"requestId": "request-c3", "promptVersion": "prompt-v1", "mediaSetFingerprint": "a" * 64, "generationStatus": "pending"})
            self.assertEqual(created["mediaEvidence"], evidence)
            updated = store.update_content_run_payload("run-c3", {"requestId": "request-c3-retry", "promptVersion": "prompt-v2", "mediaSetFingerprint": "b" * 64, "generationStatus": "completed", "mediaEvidence": [{**item, "uploadState": "processed"} for item in evidence]})
            self.assertEqual(updated["generationStatus"], "completed")
            store.close()

            reopened = AgencyStateStore(path)
            stored = reopened.list_entity("content_runs", "run-c3")[0]
            self.assertEqual(stored["requestId"], "request-c3-retry")
            self.assertEqual(stored["promptVersion"], "prompt-v2")
            self.assertEqual(stored["mediaSetFingerprint"], "b" * 64)
            self.assertEqual(stored["generationStatus"], "completed")
            self.assertEqual(stored["mediaEvidence"], [{**item, "uploadState": "processed"} for item in evidence])
            reopened.close()

    def test_content_run_c3_rejects_invalid_metadata_and_media_evidence(self):
        if AgencyStateStore is None:
            return
        evidence = [
            {"assetId": "asset-1", "sha256": "a" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"},
            {"assetId": "asset-2", "sha256": "b" * 64, "mimeType": "image/jpeg", "order": 1, "role": "reference", "uploadState": "pending"},
        ]
        invalid = [
            ("too many attachments", {"mediaEvidence": [{**evidence[0], "assetId": f"asset-{index}", "order": index, "role": "publish" if index == 0 else "reference"} for index in range(7)]}, "CONTENT_RUN_MEDIA_EVIDENCE_INVALID"),
            ("missing hash", {"mediaEvidence": [{key: value for key, value in evidence[0].items() if key != "sha256"}]}, "CONTENT_RUN_MEDIA_EVIDENCE_INVALID"),
            ("missing mime", {"mediaEvidence": [{key: value for key, value in evidence[0].items() if key != "mimeType"}]}, "CONTENT_RUN_MEDIA_EVIDENCE_INVALID"),
            ("invalid hash", {"mediaEvidence": [{**evidence[0], "sha256": "not-a-hash"}]}, "CONTENT_RUN_MEDIA_EVIDENCE_INVALID"),
            ("invalid mime", {"mediaEvidence": [{**evidence[0], "mimeType": "application/pdf"}]}, "CONTENT_RUN_MEDIA_EVIDENCE_INVALID"),
            ("noncontiguous order", {"mediaEvidence": [evidence[0], {**evidence[1], "order": 2}]}, "CONTENT_RUN_MEDIA_EVIDENCE_INVALID"),
            ("duplicate order", {"mediaEvidence": [evidence[0], {**evidence[1], "order": 0}]}, "CONTENT_RUN_MEDIA_EVIDENCE_INVALID"),
            ("duplicate asset", {"mediaEvidence": [evidence[0], {**evidence[1], "assetId": "asset-1"}]}, "CONTENT_RUN_MEDIA_EVIDENCE_INVALID"),
            ("invalid role", {"mediaEvidence": [{**evidence[0], "role": "reference"}]}, "CONTENT_RUN_MEDIA_EVIDENCE_INVALID"),
            ("invalid upload state", {"mediaEvidence": [{**evidence[0], "uploadState": "uploaded"}]}, "CONTENT_RUN_MEDIA_EVIDENCE_INVALID"),
            ("nested local path", {"mediaEvidence": [{**evidence[0], "metadata": {"source": {"localPath": "/Users/private/image.png"}}}]}, "CONTENT_RUN_MEDIA_PATH_REJECTED"),
            ("path value without path key", {"mediaEvidence": [{**evidence[0], "attachmentBoundary": "/Users/private/image.png"}]}, "CONTENT_RUN_MEDIA_PATH_REJECTED"),
            ("top-level local path", {"localAssetPath": "/Users/private/image.png"}, "CONTENT_RUN_MEDIA_PATH_REJECTED"),
            ("generation status", {"generationStatus": "processing"}, "CONTENT_RUN_GENERATION_STATUS_INVALID"),
            ("request id length", {"requestId": "r" * 129}, "CONTENT_RUN_REQUEST_ID_INVALID"),
            ("prompt version length", {"promptVersion": "v" * 129}, "CONTENT_RUN_PROMPT_VERSION_INVALID"),
            ("fingerprint shape", {"mediaSetFingerprint": "asset-1:0:publish"}, "CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID"),
        ]
        for index, (label, changes, error_code) in enumerate(invalid):
            with self.subTest(label=label):
                with self.assertRaisesRegex(StateValidationError, error_code):
                    self.store.create_content_run({"id": f"run-c3-invalid-{index}", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", **changes})

        self.store.create_content_run({"id": "run-c3-path-update", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider"})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_PATH_REJECTED"):
            self.store.update_content_run_payload("run-c3-path-update", {"mediaEvidence": [{**evidence[0], "details": {"path": "/Users/private/image.png"}}]})
        self.assertNotIn("mediaEvidence", self.store.list_entity("content_runs", "run-c3-path-update")[0])

    def test_content_run_c3_media_evidence_requires_owned_active_asset_with_matching_hash_and_mime(self):
        if AgencyStateStore is None:
            return
        self.store.create_brand({"id": "brand-a-other", "clientId": "client-a", "name": "Other Brand", "status": "active"})
        self.store.create_brand({"id": "brand-b", "clientId": "client-b", "name": "Brand B", "status": "active"})
        self.store.create_identity({"id": "identity-a-other", "brandId": "brand-a-other", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
        self.store.create_identity({"id": "identity-b-v1", "brandId": "brand-b", "name": "Default", "isDefault": True, "version": 1, "status": "active"})

        def media(asset_id, client_id="client-a", brand_id="brand-a", checksum="a" * 64, mime="image/png"):
            return {"id": asset_id, "clientId": client_id, "brandId": brand_id, "source": "local", "metadata": {"sha256": checksum, "mimeType": mime, "sizeBytes": 1}}

        def evidence(asset_id, checksum="a" * 64, mime="image/png"):
            return [{"assetId": asset_id, "sha256": checksum, "mimeType": mime, "order": 0, "role": "publish", "uploadState": "pending"}]

        failures = [
            ("missing", "asset-missing", None, "CONTENT_RUN_MEDIA_ASSET_MISSING"),
            ("other brand", "asset-other-brand", media("asset-other-brand", brand_id="brand-a-other"), "CONTENT_RUN_MEDIA_ASSET_SCOPE_MISMATCH"),
            ("other client", "asset-other-client", media("asset-other-client", client_id="client-b", brand_id="brand-b"), "CONTENT_RUN_MEDIA_ASSET_SCOPE_MISMATCH"),
            ("hash mismatch", "asset-hash-mismatch", media("asset-hash-mismatch", checksum="b" * 64), "CONTENT_RUN_MEDIA_ASSET_METADATA_MISMATCH"),
            ("mime mismatch", "asset-mime-mismatch", media("asset-mime-mismatch", mime="image/jpeg"), "CONTENT_RUN_MEDIA_ASSET_METADATA_MISMATCH"),
        ]
        for index, (label, asset_id, asset_record, error_code) in enumerate(failures):
            with self.subTest(label=label):
                if asset_record is not None:
                    self.store.create_media_asset(asset_record)
                with self.assertRaisesRegex(StateValidationError, error_code):
                    self.store.create_content_run({"id": f"run-media-scope-{index}", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "mediaEvidence": evidence(asset_id)})

        self.store.create_media_asset(media("asset-archived"))
        self.store.archive_media_asset("asset-archived")
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_ASSET_ARCHIVED"):
            self.store.create_content_run({"id": "run-media-archived", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "mediaEvidence": evidence("asset-archived")})

        self.store.create_media_asset(media("asset-update-cross-brand", brand_id="brand-a-other"))
        self.store.create_content_run({"id": "run-media-scope-update", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider"})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_ASSET_SCOPE_MISMATCH"):
            self.store.update_content_run_payload("run-media-scope-update", {"mediaEvidence": evidence("asset-update-cross-brand")})
        self.assertNotIn("mediaEvidence", self.store.list_entity("content_runs", "run-media-scope-update")[0])

    def test_content_run_c3_accepts_same_client_universal_media_as_reusable_scope(self):
        if AgencyStateStore is None:
            return
        self.store.connection.execute(
            "INSERT INTO media_assets(id, client_id, brand_id, metadata_json) VALUES (?, ?, ?, ?)",
            ("asset-universal", "client-a", None, json.dumps({"source": "drive", "distribution": "universal", "sha256": "a" * 64, "mimeType": "image/png", "archiveState": "active"}, separators=(",", ":"))),
        )
        self.store.connection.commit()
        created = self.store.create_content_run({
            "id": "run-universal-media", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider",
            "mediaSetFingerprint": "b" * 64,
            "mediaEvidence": [{"assetId": "asset-universal", "sha256": "a" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "pending"}],
        })
        self.assertEqual(created["mediaEvidence"][0]["assetId"], "asset-universal")

    def test_media_asset_metadata_rejects_local_paths_at_the_durable_boundary(self):
        if AgencyStateStore is None:
            return
        with self.assertRaisesRegex(StateValidationError, "MEDIA_METADATA_PATH_REJECTED"):
            self.store.create_media_asset({"id": "asset-path", "clientId": "client-a", "brandId": "brand-a", "source": "local", "metadata": {"sha256": "a" * 64, "mimeType": "image/png", "localAssetPath": "/Users/private/image.png"}})

    def test_persists_target_approval_state_and_full_target_intents_for_restart_replay(self):
        if AgencyStateStore is None:
            return
        import tempfile
        from pathlib import Path

        intents = [
            {"id": "publication-page-a", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-a", "targetPageId": "page-a", "planId": "plan-intents", "requestId": "approve-page-a", "workerJob": {"jobId": "job-page-a", "payload": {"target_publication_id": "publication-page-a", "page_id": "page-a", "plan_id": "plan-intents", "approval_state": "approved", "simulation": False}}},
            {"id": "publication-page-b", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-b", "targetPageId": "page-b", "planId": "plan-intents", "requestId": "approve-page-b", "workerJob": {"jobId": "job-page-b", "payload": {"target_publication_id": "publication-page-b", "page_id": "page-b", "plan_id": "plan-intents", "approval_state": "approved", "simulation": False}}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agency.sqlite3"
            durable = AgencyStateStore(path)
            durable.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            durable.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            durable.create_identity({"id": "identity-a-v1", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            durable.create_automation_plan({"id": "plan-intents", "brandId": "brand-a", "state": "active", "bindingIds": []})
            durable.create_content_run({"id": "run-target-intents", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "planId": "plan-intents", "targetApprovalState": "pending", "targetApprovalIntents": intents, "state": "needs_review"})
            durable.close()

            reopened = AgencyStateStore(path)
            stored = reopened.list_entity("content_runs", "run-target-intents")[0]
            self.assertEqual(stored["targetApprovalState"], "pending")
            self.assertEqual(stored["targetApprovalIntents"], intents)
            self.assertNotIn("access_token", repr(stored))
            reopened.close()

    def test_persists_safe_manual_content_run_without_a_provider_profile(self):
        if AgencyStateStore is None:
            return
        run = self.store.create_content_run({"id": "run-safe-manual", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "trigger": "manual", "state": "needs_review", "topic": "Manual safe draft", "body": "Draft body"})
        self.assertEqual(run["id"], "run-safe-manual")
        self.assertIsNone(run.get("generation_profile_id"))
        updated = self.store.update_content_run_payload("run-safe-manual", {"caption": "Persisted without a provider profile", "state": "needs_review"})
        self.assertEqual(updated["caption"], "Persisted without a provider profile")

    def test_content_run_revision_metadata_is_durable_and_old_run_is_not_mutated(self):
        if AgencyStateStore is None:
            return
        self.store.create_content_run({"id": "run-parent", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "body": "Original copy", "state": "needs_review", "revisionId": "revision-parent"})
        self.store.create_content_run({"id": "run-revision", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "body": "Rewritten copy", "state": "needs_review", "requestId": "request-rewrite", "revisionId": "revision-rewrite", "parentRevisionId": "revision-parent", "parentContentRunId": "run-parent", "revisionCreatedAt": "2026-09-11T00:01:00.000Z", "revisionHistory": [{"id": "revision-parent", "title": "Original", "body": "Original copy", "createdAt": "2026-09-11T00:00:00.000Z"}]})
        parent = self.store.list_entity("content_runs", "run-parent")[0]
        revision = self.store.list_entity("content_runs", "run-revision")[0]
        self.assertEqual(parent["body"], "Original copy")
        self.assertEqual(revision["requestId"], "request-rewrite")
        self.assertEqual(revision["revisionId"], "revision-rewrite")
        self.assertEqual(revision["parentRevisionId"], "revision-parent")
        self.assertEqual(revision["parentContentRunId"], "run-parent")
        self.assertEqual(revision["revisionCreatedAt"], "2026-09-11T00:01:00.000Z")
        self.assertEqual(revision["revisionHistory"][0]["body"], "Original copy")

    def test_scheduled_content_run_rejects_copy_mutation(self):
        if AgencyStateStore is None:
            return
        self.store.create_content_run({"id": "run-scheduled-immutable", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "body": "Approved copy", "state": "scheduled", "approvalState": "approved"})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_IMMUTABLE"):
            self.store.update_content_run_payload("run-scheduled-immutable", {"body": "Should stay unchanged", "caption": "Should stay unchanged"})
        self.assertEqual(self.store.list_entity("content_runs", "run-scheduled-immutable")[0]["body"], "Approved copy")

    def test_revision_creation_rejects_unresolved_or_published_parent(self):
        if AgencyStateStore is None:
            return
        self.store.create_content_run({"id": "run-parent-outcome", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "body": "Original", "state": "needs_review", "generationStatus": "unknown"})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_RECONCILIATION_REQUIRED"):
            self.store.create_content_run({"id": "run-child-outcome", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "parentContentRunId": "run-parent-outcome", "revisionId": "revision-child", "body": "New"})

        self.store.create_content_run({"id": "run-parent-scheduled", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "body": "Approved", "state": "needs_review"})
        self.store.create_binding({"id": "binding-revision-parent", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        self.store.create_target_publication({"id": "publication-parent-active", "bindingId": "binding-revision-parent", "variantId": "variant-parent", "clientId": "client-a", "brandId": "brand-a", "contentRunId": "run-parent-scheduled", "idempotencyKey": "key-parent-active", "approvalState": "approved", "state": "scheduled", "simulation": False, "scheduledAt": "2099-01-05T09:00:00Z"})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_IMMUTABLE"):
            self.store.create_content_run({"id": "run-child-scheduled", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "parentContentRunId": "run-parent-scheduled", "revisionId": "revision-child-scheduled", "body": "New"})

        self.store.create_content_run({"id": "run-parent-published", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "body": "Published copy", "state": "needs_review"})
        self.store.create_target_publication({"id": "publication-parent-published", "bindingId": "binding-revision-parent", "variantId": "variant-parent-published", "clientId": "client-a", "brandId": "brand-a", "contentRunId": "run-parent-published", "idempotencyKey": "key-parent-published", "approvalState": "approved", "state": "published", "simulation": False, "scheduledAt": "2099-01-05T09:00:00Z"})
        self.store.connection.execute("UPDATE target_publications SET provider_job_id = 'provider-post-parent' WHERE id = 'publication-parent-published'")
        self.store.connection.commit()
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_REVISION_IMMUTABLE"):
            self.store.create_content_run({"id": "run-child-published", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "parentContentRunId": "run-parent-published", "revisionId": "revision-child-published", "body": "New"})

    def test_plan_id_round_trips_through_content_run_and_target_publication(self):
        if AgencyStateStore is None:
            return
        self.store.create_binding({"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        plan = {"id": "plan-a", "timezone": "Asia/Ho_Chi_Minh", "campaignStartAt": "2099-01-01T00:00:00+07:00", "campaignEndAt": "2099-01-31T23:59:00+07:00", "pagePlans": {"page-a": {"facebook": {"enabled": True, "runDays": [1], "publishTimes": ["09:00"]}}}}
        self.store.create_automation_plan({"id": "plan-a", "brandId": "brand-a", "state": "active", "bindingIds": ["binding-a"], "payload": plan})
        run = self.store.create_content_run({"id": "run-plan", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "planId": "plan-a", "targetPageId": "page-a", "targetPlatforms": ["facebook"], "scheduledAt": "2099-01-05T09:00:00+07:00", "state": "needs_review"})
        self.assertEqual(run["planId"], "plan-a")
        publication = self.store.create_target_publication({"id": "publication-plan", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-a", "variantId": "variant-plan", "idempotencyKey": "key-plan", "approvalState": "approved", "state": "scheduled", "scheduledAt": "2099-01-05T09:00:00+07:00", "planId": "plan-a"})
        self.assertEqual(publication["planId"], "plan-a")
        self.assertEqual(self.store.list_target_publications("client-a", "brand-a")[0]["planId"], "plan-a")

    def test_target_publication_content_run_id_survives_create_list_and_reopen(self):
        if AgencyStateStore is None:
            return
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agency.sqlite3"
            store = AgencyStateStore(path)
            store.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            store.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            store.create_identity({"id": "identity-a-v1", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            store.create_connection({"id": "connection-a", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a", "displayName": "Page A", "connectionState": "connected", "scopes": []})
            store.create_binding({"id": "binding-content-run", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
            store.create_content_run({"id": "run-content-association", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "state": "needs_review"})
            created = store.create_target_publication({"id": "publication-content-association", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-content-run", "variantId": "variant-content-association", "idempotencyKey": "key-content-association", "approvalState": "approved", "state": "scheduled", "scheduledAt": "2099-01-05T09:00:00Z", "contentRunId": "run-content-association"})
            self.assertEqual(created.get("contentRunId"), "run-content-association")
            store.close()

            reopened = AgencyStateStore(path)
            publication = reopened.list_target_publications("client-a", "brand-a")[0]
            self.assertEqual(publication.get("contentRunId"), "run-content-association")
            reopened.close()

    def test_target_publication_content_run_id_migration_keeps_legacy_rows_optional(self):
        if AgencyStateStore is None:
            return
        import sqlite3
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agency.sqlite3"
            store = AgencyStateStore(path)
            store.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            store.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            store.create_identity({"id": "identity-a-v1", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            store.create_connection({"id": "connection-a", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a", "displayName": "Page A", "connectionState": "connected", "scopes": []})
            store.create_binding({"id": "binding-legacy-content-run", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
            store.create_target_publication({"id": "publication-legacy-content-run", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-legacy-content-run", "variantId": "variant-legacy-content-run", "idempotencyKey": "key-legacy-content-run", "approvalState": "approved", "state": "scheduled", "scheduledAt": "2099-01-05T09:00:00Z"})
            store.close()

            connection = sqlite3.connect(path)
            columns_before_migration = {row[1] for row in connection.execute("PRAGMA table_info(target_publications)").fetchall()}
            if "content_run_id" in columns_before_migration:
                connection.execute("ALTER TABLE target_publications DROP COLUMN content_run_id")
            connection.commit()
            connection.close()

            migrated = AgencyStateStore(path)
            columns = {row[1] for row in migrated.connection.execute("PRAGMA table_info(target_publications)").fetchall()}
            self.assertIn("content_run_id", columns)
            self.assertIsNone(migrated.list_target_publications("client-a", "brand-a")[0].get("contentRunId"))
            migrated.close()

            reopened = AgencyStateStore(path)
            columns_after_second_open = [row[1] for row in reopened.connection.execute("PRAGMA table_info(target_publications)").fetchall()]
            self.assertEqual(columns_after_second_open.count("content_run_id"), 1)
            self.assertIsNone(reopened.list_target_publications("client-a", "brand-a")[0].get("contentRunId"))
            reopened.close()

    def test_target_publication_rejects_content_run_from_another_scope(self):
        if AgencyStateStore is None:
            return
        self.store.create_binding({"id": "binding-content-scope", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        self.store.create_brand({"id": "brand-b", "clientId": "client-b", "name": "Brand B", "status": "active"})
        self.store.create_identity({"id": "identity-b-v1", "brandId": "brand-b", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
        self.store.create_content_run({"id": "run-other-scope", "clientId": "client-b", "brandId": "brand-b", "identityVersionId": "identity-b-v1", "executionMode": "llm_provider"})

        with self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_CONTENT_RUN_SCOPE_MISMATCH"):
            self.store.create_target_publication({"id": "publication-other-run-scope", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-content-scope", "variantId": "variant-other-run-scope", "idempotencyKey": "key-other-run-scope", "approvalState": "approved", "state": "scheduled", "scheduledAt": "2099-01-05T09:00:00Z", "contentRunId": "run-other-scope"})

    def test_campaign_run_day_validation_blocks_draft_creation_and_approval(self):
        if AgencyStateStore is None:
            return
        self.store.create_binding({"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        plan = {"id": "plan-days", "timezone": "Asia/Ho_Chi_Minh", "campaignStartAt": "2099-01-01T00:00:00+07:00", "campaignEndAt": "2099-01-31T23:59:00+07:00", "pagePlans": {"page-a": {"facebook": {"enabled": True, "runDays": [1], "publishTimes": ["09:00"]}}}}
        self.store.create_automation_plan({"id": "plan-days", "brandId": "brand-a", "state": "active", "bindingIds": ["binding-a"], "payload": plan})
        with self.assertRaisesRegex(StateValidationError, "PLAN_RUN_DAY_INVALID"):
            self.store.create_content_run({"id": "run-sunday", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "planId": "plan-days", "targetPageId": "page-a", "targetPlatforms": ["facebook"], "scheduledAt": "2099-01-04T09:00:00+07:00", "state": "needs_review"})
        with self.assertRaisesRegex(StateValidationError, "PLAN_RUN_DAY_INVALID"):
            self.store.create_target_publication({"id": "publication-sunday", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-a", "variantId": "variant-sunday", "idempotencyKey": "key-sunday", "approvalState": "approved", "state": "scheduled", "scheduledAt": "2099-01-04T09:00:00+07:00", "planId": "plan-days"})
        with self.assertRaisesRegex(StateValidationError, "PLAN_CAMPAIGN_WINDOW_INVALID"):
            self.store.create_content_run({"id": "run-outside-campaign", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "llm_provider", "planId": "plan-days", "targetPageId": "page-a", "targetPlatforms": ["facebook"], "scheduledAt": "2099-02-02T09:00:00+07:00", "state": "needs_review"})
        self.store.create_automation_plan({"id": "plan-timezone", "brandId": "brand-a", "state": "active", "bindingIds": ["binding-a"], "payload": {**plan, "id": "plan-timezone", "timezone": "Mars/Alpha"}})
        with self.assertRaisesRegex(StateValidationError, "PLAN_TIMEZONE_INVALID"):
            self.store.create_target_publication({"id": "publication-timezone", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-a", "variantId": "variant-timezone", "idempotencyKey": "key-timezone", "approvalState": "approved", "state": "scheduled", "scheduledAt": "2099-01-05T09:00:00+07:00", "planId": "plan-timezone"})

    def test_schedule_slots_normalize_utc_and_include_platform_and_remote_page(self):
        if AgencyStateStore is None:
            return
        self.store.create_binding({"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        self.store.create_binding({"id": "binding-a2", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A second binding", "state": "connected"})
        self.store.create_target_publication({"id": "publication-first", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-a", "variantId": "variant-first", "idempotencyKey": "key-first", "approvalState": "approved", "state": "scheduled", "scheduledAt": "2099-01-05T02:00:00Z"})
        with self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_SLOT_CONFLICT"):
            self.store.create_target_publication({"id": "publication-same-page", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-a2", "variantId": "variant-second", "idempotencyKey": "key-second", "approvalState": "approved", "state": "scheduled", "scheduledAt": "2099-01-05T09:00:00+07:00"})

        self.store.create_connection({"id": "connection-ig", "clientId": "client-a", "platform": "instagram", "externalAccountId": "page-a", "displayName": "Instagram A", "connectionState": "connected", "scopes": []})
        self.store.create_binding({"id": "binding-ig", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-ig", "targetExternalId": "page-a", "targetName": "Instagram A", "state": "connected"})
        self.store.create_target_publication({"id": "publication-other-platform", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-ig", "variantId": "variant-instagram", "idempotencyKey": "key-instagram", "approvalState": "approved", "state": "scheduled", "scheduledAt": "2099-01-05T02:00:00.000Z"})

    def test_store_restart_reports_existing_page_slot_collisions_without_deleting_rows(self):
        if AgencyStateStore is None:
            return
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agency.sqlite3"
            store = AgencyStateStore(path)
            store.create_client({"id": "client-r", "name": "Client", "timezone": "UTC", "status": "active"})
            store.create_brand({"id": "brand-r", "clientId": "client-r", "name": "Brand", "status": "active"})
            store.create_identity({"id": "identity-r", "brandId": "brand-r", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            store.create_connection({"id": "connection-r", "clientId": "client-r", "platform": "facebook", "externalAccountId": "page-r", "displayName": "Page", "connectionState": "connected", "scopes": []})
            for binding_id in ("binding-r1", "binding-r2"):
                store.create_binding({"id": binding_id, "brandId": "brand-r", "identityId": "identity-r", "connectionId": "connection-r", "targetExternalId": "page-r", "targetName": "Page", "state": "connected"})
            store.close()

            import sqlite3
            connection = sqlite3.connect(path)
            for index, (binding_id, scheduled_at) in enumerate((("binding-r1", "2099-01-05T02:00:00Z"), ("binding-r2", "2099-01-05T09:00:00+07:00"))):
                connection.execute("INSERT INTO target_publications(id, binding_id, variant_id, idempotency_key, approval_state, state, client_id, brand_id, simulation, scheduled_at, target_external_id) VALUES (?, ?, ?, ?, 'approved', 'scheduled', 'client-r', 'brand-r', 0, ?, 'page-r')", (f"publication-r{index}", binding_id, f"variant-r{index}", f"key-r{index}", scheduled_at))
            connection.commit()
            connection.close()

            reopened = AgencyStateStore(path)
            collisions = reopened.list_schedule_collisions()
            self.assertEqual(len(collisions), 1)
            self.assertEqual(set(collisions[0]["publicationIds"]), {"publication-r0", "publication-r1"})
            self.assertEqual(len(reopened.list_target_publications("client-r", "brand-r")), 2)
            reopened.close()

    def test_persists_automation_plan_payload_and_revision_history(self):
        if AgencyStateStore is None:
            return
        self.store.create_automation_plan({"id": "plan-revision", "brandId": "brand-a", "state": "draft", "bindingIds": [], "payload": {"revision": 1}})
        updated = self.store.update_automation_plan("plan-revision", {"state": "draft", "bindingIds": ["binding-a"], "payload": {"revision": 2, "cronSchedules": {"platform:instagram": {"enabled": True}}}})
        self.assertEqual(updated["payload"]["revision"], 2)
        self.assertEqual(updated["binding_ids_json"], '["binding-a"]')
        self.assertEqual(len(self.store.list_automation_plan_revisions("plan-revision")), 1)

    def test_enforces_target_publication_idempotency_per_binding(self):
        if AgencyStateStore is None:
            return
        self.store.create_binding({"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        publication = {"id": "publication-a", "bindingId": "binding-a", "variantId": "variant-a", "idempotencyKey": "key-a", "approvalState": "approved", "state": "scheduled"}
        self.store.create_target_publication(publication)
        with self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_IDEMPOTENCY_CONFLICT"):
            self.store.create_target_publication({**publication, "id": "publication-b"})

    def test_generic_entity_updates_cannot_change_target_publication_lifecycle(self):
        if AgencyStateStore is None:
            return
        self.store.create_binding({"id": "binding-lifecycle", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        self.store.create_target_publication({"id": "publication-lifecycle", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-lifecycle", "variantId": "variant-lifecycle", "idempotencyKey": "key-lifecycle", "approvalState": "approved", "state": "scheduled"})

        with self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_COMMAND_REQUIRED"):
            self.store.update_entity("target_publications", "publication-lifecycle", {"state": "published", "providerJobId": "forged-provider-id"})
        with self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_COMMAND_REQUIRED"):
            self.store.delete_entity("target_publications", "publication-lifecycle")

        publication = self.store.list_entity("target_publications", "publication-lifecycle")[0]
        self.assertEqual(publication["state"], "scheduled")
        self.assertIsNone(publication["provider_job_id"])

    def test_rejects_same_page_and_slot_across_two_bindings(self):
        if AgencyStateStore is None:
            return
        self.store.create_connection({"id": "connection-a2", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a-2", "displayName": "Page A mirror", "connectionState": "connected", "scopes": []})
        for binding_id, connection_id in (("binding-a", "connection-a"), ("binding-a2", "connection-a2")):
            self.store.create_binding({"id": binding_id, "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": connection_id, "targetExternalId": "same-page", "targetName": "Same Page", "state": "connected"})
        base = {"bindingId": "binding-a", "variantId": "variant-slot-a", "idempotencyKey": "slot-a", "approvalState": "approved", "state": "scheduled", "scheduledAt": "2999-01-01T09:00:00+00:00"}
        self.store.create_target_publication({"id": "publication-slot-a", **base})
        with self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_SLOT_CONFLICT"):
            self.store.create_target_publication({"id": "publication-slot-b", **{**base, "bindingId": "binding-a2", "variantId": "variant-slot-b", "idempotencyKey": "slot-b"}})

    def test_reschedule_target_publication_updates_only_after_worker_command_ack(self):
        if AgencyStateStore is None:
            return
        self.store.create_binding({"id": "binding-reschedule", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        worker_payload = {"client_id": "client-a", "brand_id": "brand-a", "binding_id": "binding-reschedule", "identity_version_id": "identity-a-v1", "target_publication_id": "publication-reschedule", "page_id": "page-a", "plan_id": None, "platform": "facebook", "kind": "text", "required_scopes": [], "approval_state": "approved", "simulation": False}
        approval = self.store.begin_target_publication_approval({"id": "publication-reschedule", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-reschedule", "identityVersionId": "identity-a-v1", "variantId": "variant-reschedule", "idempotencyKey": "key-reschedule", "approvalState": "approved", "platform": "facebook", "kind": "text", "requiredScopes": [], "mediaRequired": False, "mediaEligible": True, "simulation": False, "scheduledAt": "2999-01-01T09:00:00+00:00", "requestId": "approve-reschedule", "workerJob": {"jobId": "job-reschedule", "idempotencyKey": "key-reschedule", "scheduledAt": "2999-01-01T09:00:00+00:00", "payload": worker_payload}})
        self.store.acknowledge_publication_command("approve-reschedule", {"id": "job-reschedule", "state": "queued", "scheduled_at": datetime.fromisoformat("2999-01-01T09:00:00+00:00").timestamp(), "revision": 0})
        moved = self.store.begin_target_publication_command("publication-reschedule", {"action": "reschedule", "clientId": "client-a", "brandId": "brand-a", "expectedRevision": 0, "requestId": "reschedule-command", "scheduledAt": "2999-01-01T10:00:00+00:00"})
        self.assertEqual(moved["commandStatus"], "pending")
        self.assertEqual(moved["scheduledAt"], "2999-01-01T09:00:00.000Z")
        updated = self.store.acknowledge_publication_command("reschedule-command", {"id": "job-reschedule", "state": "queued", "scheduled_at": datetime.fromisoformat("2999-01-01T10:00:00+00:00").timestamp(), "revision": 1})
        self.assertEqual(updated["state"], "scheduled")
        self.assertEqual(updated["scheduledAt"], "2999-01-01T10:00:00.000Z")
        self.assertEqual(updated["revision"], 1)

    def test_reschedule_ack_with_old_worker_slot_does_not_ack_or_move_cp_slot(self):
        if AgencyStateStore is None:
            return
        self.store.create_binding({"id": "binding-reschedule-mismatch", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        worker_payload = {"client_id": "client-a", "brand_id": "brand-a", "binding_id": "binding-reschedule-mismatch", "identity_version_id": "identity-a-v1", "target_publication_id": "publication-reschedule-mismatch", "page_id": "page-a", "plan_id": None, "platform": "facebook", "kind": "text", "required_scopes": [], "approval_state": "approved", "simulation": False}
        self.store.begin_target_publication_approval({"id": "publication-reschedule-mismatch", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-reschedule-mismatch", "identityVersionId": "identity-a-v1", "variantId": "variant-reschedule-mismatch", "idempotencyKey": "key-reschedule-mismatch", "approvalState": "approved", "platform": "facebook", "kind": "text", "requiredScopes": [], "mediaRequired": False, "mediaEligible": True, "simulation": False, "scheduledAt": "2999-01-01T09:00:00+00:00", "requestId": "approve-reschedule-mismatch", "workerJob": {"jobId": "job-reschedule-mismatch", "idempotencyKey": "key-reschedule-mismatch", "scheduledAt": "2999-01-01T09:00:00+00:00", "payload": worker_payload}})
        self.store.acknowledge_publication_command("approve-reschedule-mismatch", {"id": "job-reschedule-mismatch", "state": "queued", "scheduled_at": datetime.fromisoformat("2999-01-01T09:00:00+00:00").timestamp(), "revision": 0})
        self.store.begin_target_publication_command("publication-reschedule-mismatch", {"action": "reschedule", "clientId": "client-a", "brandId": "brand-a", "expectedRevision": 0, "requestId": "reschedule-mismatch", "scheduledAt": "2999-01-01T10:00:00+00:00"})

        with self.assertRaisesRegex(StateValidationError, "PUBLICATION_WORKER_ACK_MISMATCH"):
            self.store.acknowledge_publication_command("reschedule-mismatch", {"id": "job-reschedule-mismatch", "state": "queued", "scheduled_at": datetime.fromisoformat("2999-01-01T09:00:00+00:00").timestamp(), "revision": 1})

        publication = self.store.list_target_publications("client-a", "brand-a")[0]
        command = self.store._publication_command_status("reschedule-mismatch")
        self.assertEqual(publication["scheduledAt"], "2999-01-01T09:00:00.000Z")
        self.assertEqual(publication["pendingCommandId"], "reschedule-mismatch")
        self.assertEqual(command["commandStatus"], "pending")

    def test_brand_trash_pauses_plans_after_c2_cancels_unsent_publications(self):
        if AgencyStateStore is None:
            return
        self.store.create_automation_plan({"id": "plan-trash", "brandId": "brand-a", "state": "active", "bindingIds": []})
        self.store.create_binding({"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        self.store.create_target_publication({"id": "publication-trash", "bindingId": "binding-a", "variantId": "variant-trash", "idempotencyKey": "key-trash", "approvalState": "approved", "state": "scheduled"})
        self.store.connection.execute("UPDATE target_publications SET state = 'canceled', worker_ack_state = 'acknowledged' WHERE id = 'publication-trash'")
        self.store.connection.commit()
        result = self.store.trash_brand("brand-a", {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"})
        self.assertEqual(result["status"], "archived")
        self.assertEqual(self.store.list_entity("automation_plans")[0]["state"], "paused")
        self.assertEqual(self.store.list_entity("target_publications")[0]["state"], "canceled")

    def test_permanent_brand_delete_preserves_client_and_requires_trash(self):
        if AgencyStateStore is None:
            return
        with self.assertRaisesRegex(StateValidationError, "BRAND_NOT_TRASHED"):
            self.store.permanently_delete_brand("brand-a", "Brand A", {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"})
        self.store.trash_brand("brand-a", {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"})
        result = self.store.permanently_delete_brand("brand-a", "Brand A", {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"})
        self.assertEqual(result["sharedMedia"], "untouched")
        self.assertEqual(self.store.list_entity("brands"), [])
        self.assertEqual(self.store.list_entity("clients")[0]["id"], "client-a")

    def test_restore_brand_returns_draft_without_reactivating_plans(self):
        if AgencyStateStore is None:
            return
        self.store.trash_brand("brand-a", {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"})
        restored = self.store.restore_brand("brand-a", {"actorUserId": "user-a", "role": "owner", "capability": "manage_brand"})
        self.assertEqual(restored["status"], "draft")
        self.assertEqual(self.store.list_entity("brands")[0]["status"], "draft")

    def test_target_preflight_checks_scope_identity_state_and_future_schedule(self):
        if AgencyStateStore is None:
            return
        self.store.create_binding({"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        result = self.store.preflight_target_publication({"clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-a", "identityVersionId": "identity-a-v1", "variantId": "variant-a", "platform": "facebook", "kind": "text", "scheduledAt": "2999-01-01T00:00:00+00:00", "approvalState": "approved", "requiredScopes": []})
        self.assertTrue(result["ok"])
        blocked = self.store.preflight_target_publication({"clientId": "client-b", "brandId": "brand-a", "bindingId": "binding-a", "identityVersionId": "identity-a-v1", "variantId": "variant-b", "platform": "facebook", "kind": "text", "scheduledAt": "2999-01-01T00:00:00+00:00", "approvalState": "approved", "requiredScopes": []})
        self.assertFalse(blocked["ok"])
        self.assertEqual(blocked["blockReason"], "client")

    def test_analytics_and_audit_tables_are_append_only(self):
        if AgencyStateStore is None:
            return
        self.store.append_analytics_event({"id": "event-a", "eventName": "approval.decided", "clientId": "client-a", "brandId": "brand-a", "occurredAt": "2026-08-29T00:00:00Z", "properties": {"decision": "approved"}})
        with self.assertRaisesRegex(StateValidationError, "APPEND_ONLY_ENTITY"):
            self.store.update_entity("analytics_events", "event-a", {"eventName": "preflight.checked"})
        with self.assertRaisesRegex(StateValidationError, "APPEND_ONLY_ENTITY"):
            self.store.delete_entity("analytics_events", "event-a")

    def test_rejects_target_publication_without_approval_or_binding(self):
        if AgencyStateStore is None:
            return
        with self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_APPROVAL_REQUIRED"):
            self.store.create_target_publication({"id": "publication-unapproved", "bindingId": "binding-a", "variantId": "variant-a", "idempotencyKey": "key-a", "approvalState": "pending", "state": "scheduled"})

    def test_derives_target_publication_key_from_full_scope_when_not_supplied(self):
        if AgencyStateStore is None:
            return
        self.store.create_binding({"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        record = self.store.create_target_publication({"id": "publication-derived", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-a", "variantId": "variant-a", "scheduledSlot": "2026-08-29T09:00:00.000Z", "approvalState": "approved", "state": "scheduled"})
        self.assertEqual(record["idempotencyKey"], sha256("client-a\x1fbrand-a\x1fbinding-a\x1fvariant-a\x1f2026-08-29T09:00:00.000Z".encode()).hexdigest())

    def test_rejects_secret_shaped_fields_and_auth_store_paths(self):
        if AgencyStateStore is None:
            return
        with self.assertRaisesRegex(StateValidationError, "SENSITIVE_FIELD_REJECTED"):
            self.store.validate_scalar_payload({"apiKey": "secret-value"})
        with self.assertRaisesRegex(StateValidationError, "AUTH_FILE_PATH_REJECTED"):
            self.store.validate_scalar_payload({"authFile": "/Users/test/.local/share/opencode/auth.json"})

    def test_marks_renderer_snapshot_migrated_only_after_durable_commit(self):
        if AgencyStateStore is None:
            return
        store = AgencyStateStore(":memory:")
        migration = {
            "clients": [{"id": "client-m", "name": "Client M", "timezone": "UTC", "status": "active"}],
            "brands": [{"id": "brand-m", "clientId": "client-m", "name": "Brand M", "status": "active"}],
            "identities": [{"id": "identity-m", "brandId": "brand-m", "name": "Default", "isDefault": True, "version": 1, "status": "active"}],
            "connections": [],
            "bindings": [],
        }
        try:
            self.assertTrue(hasattr(store, "commit_renderer_migration"))
            if not hasattr(store, "commit_renderer_migration"):
                return
            self.assertEqual(store.commit_renderer_migration(migration), {"controlPlaneMigrated": True, "clientCount": 1, "brandCount": 1, "identityCount": 1, "bindingCount": 0})
            self.assertTrue(store.control_plane_migrated())
            self.assertEqual(store.recovery_state()["brands"][0]["id"], "brand-m")
            with self.assertRaisesRegex(StateValidationError, "RENDERER_STATE_REPLACEMENT_REJECTED"):
                store.commit_renderer_migration(migration)
        finally:
            store.close()

    def test_renderer_migration_upserts_an_existing_false_marker_without_rolling_back_clients(self):
        if AgencyStateStore is None:
            return
        store = AgencyStateStore(":memory:")
        migration = {
            "clients": [{"id": "client-fresh", "name": "Fresh Client", "timezone": "UTC", "status": "active"}],
            "brands": [],
            "identities": [],
            "connections": [],
            "bindings": [],
        }
        try:
            store.connection.execute("INSERT INTO control_plane_metadata(key, value) VALUES ('control_plane_migrated', 'false')")
            store.connection.commit()

            result = store.commit_renderer_migration(migration)

            self.assertEqual(result, {"controlPlaneMigrated": True, "clientCount": 1, "brandCount": 0, "identityCount": 0, "bindingCount": 0})
            self.assertEqual(store.recovery_state()["clients"], [{"id": "client-fresh", "name": "Fresh Client", "timezone": "UTC", "status": "active"}])
            self.assertEqual(store.connection.execute("SELECT value FROM control_plane_metadata WHERE key = 'control_plane_migrated'").fetchone()["value"], "true")
        finally:
            store.close()

    def test_renderer_migration_still_rejects_a_preexisting_true_marker(self):
        if AgencyStateStore is None:
            return
        store = AgencyStateStore(":memory:")
        try:
            store.connection.execute("INSERT INTO control_plane_metadata(key, value) VALUES ('control_plane_migrated', 'true')")
            store.connection.commit()

            with self.assertRaisesRegex(StateValidationError, "RENDERER_STATE_REPLACEMENT_REJECTED"):
                store.commit_renderer_migration({"clients": [{"id": "client-conflict", "name": "Conflict", "timezone": "UTC", "status": "active"}], "brands": [], "identities": [], "connections": [], "bindings": []})
            self.assertEqual(store.recovery_state()["clients"], [])
        finally:
            store.close()

    def test_renderer_migration_keeps_real_client_conflicts_fail_closed(self):
        if AgencyStateStore is None:
            return
        store = AgencyStateStore(":memory:")
        try:
            store.connection.execute("INSERT INTO control_plane_metadata(key, value) VALUES ('control_plane_migrated', 'false')")
            store.create_client({"id": "client-existing", "name": "Existing", "timezone": "UTC", "status": "active"})

            with self.assertRaisesRegex(StateValidationError, "MIGRATION_CONFLICT"):
                store.commit_renderer_migration({"clients": [{"id": "client-existing", "name": "Different", "timezone": "UTC", "status": "active"}], "brands": [], "identities": [], "connections": [], "bindings": []})
            self.assertEqual(store.recovery_state()["clients"], [{"id": "client-existing", "name": "Existing", "timezone": "UTC", "status": "active"}])
            self.assertEqual(store.connection.execute("SELECT value FROM control_plane_metadata WHERE key = 'control_plane_migrated'").fetchone()["value"], "false")
        finally:
            store.close()

    def test_appends_only_scalar_analytics_events_for_the_correct_client_and_brand(self):
        if AgencyStateStore is None:
            return
        event = self.store.append_analytics_event({"id": "event-a", "eventName": "approval.decided", "clientId": "client-a", "brandId": "brand-a", "occurredAt": "2026-08-29T00:00:00.000Z", "properties": {"bindingId": "binding-a", "simulation": False, "decision": "approved"}})
        self.assertEqual(event["eventName"], "approval.decided")
        self.assertEqual(self.store.list_analytics_events("client-a", "brand-a"), [event])
        with self.assertRaisesRegex(StateValidationError, "SENSITIVE_FIELD_REJECTED"):
            self.store.append_analytics_event({"id": "event-secret", "eventName": "approval.decided", "clientId": "client-a", "brandId": "brand-a", "occurredAt": "2026-08-29T00:00:00.000Z", "properties": {"apiKey": "not-allowed"}})

    def test_knowledge_items_are_scoped_reviewed_and_archiveable_without_deleting_the_record(self):
        if AgencyStateStore is None:
            return
        value = {"id": "knowledge-a", "clientId": "client-a", "brandId": "brand-a", "kind": "product_fact", "title": "Approved fact", "contentHash": "a" * 64, "provenance": "owner document", "rightsState": "user_owned", "reviewState": "approved", "text": "Fact A", "sourceUpdatedAt": "2026-08-29T00:00:00.000Z"}
        self.assertEqual(self.store.create_knowledge_item(value)["id"], "knowledge-a")
        with self.assertRaisesRegex(StateValidationError, "RIGHTS_OR_REVIEW_BLOCKED"):
            self.store.create_knowledge_item({**value, "id": "knowledge-b", "contentHash": "b" * 64, "clientId": "client-b"})
        self.assertEqual(self.store.archive_knowledge_item("knowledge-a")["archiveState"], "archived")
        self.assertEqual(self.store.list_knowledge_items("client-a", "brand-a", include_archived=False), [])
        self.assertEqual(self.store.list_knowledge_items("client-a", "brand-a", include_archived=True)[0]["id"], "knowledge-a")

    def test_research_and_trend_records_require_reviewable_dates_and_never_prediction_fields(self):
        if AgencyStateStore is None:
            return
        evidence = {"id": "evidence-a", "clientId": "client-a", "brandId": "brand-a", "sourceUrl": "https://example.test/source", "sourceTitle": "Source", "retrievedAt": "2026-08-29T00:00:00.000Z", "summary": "Observed fact", "rightsState": "licensed", "reviewState": "pending"}
        self.assertEqual(self.store.create_research_evidence(evidence)["id"], "evidence-a")
        with self.assertRaisesRegex(StateValidationError, "RESEARCH_RETRIEVED_AT_REQUIRED"):
            self.store.create_research_evidence({**evidence, "id": "evidence-b", "retrievedAt": ""})
        self.assertEqual(self.store.create_trend_signal({"id": "trend-a", "clientId": "client-a", "source": "operator", "observedAt": "2026-08-29T00:00:00.000Z", "topic": "Topic", "metric": "mentions", "evidenceIds": ["evidence-a"], "status": "observed"})["id"], "trend-a")
        with self.assertRaisesRegex(StateValidationError, "TREND_PREDICTION_FIELD_REJECTED"):
            self.store.create_trend_signal({"id": "trend-b", "clientId": "client-a", "source": "operator", "observedAt": "2026-08-29T00:00:00.000Z", "topic": "Topic", "metric": "mentions", "evidenceIds": [], "status": "observed", "forecast": "later"})
        self.assertEqual(self.store.create_research_evidence({**evidence, "id": "evidence-pending", "reviewState": "pending"})["reviewState"], "pending")

    def test_research_evidence_creation_rejects_approved_and_unknown_review_states(self):
        for index, review_state in enumerate(("approved", "unknown")):
            with self.subTest(review_state=review_state):
                with self.assertRaisesRegex(StateValidationError, "RIGHTS_OR_REVIEW_BLOCKED"):
                    self.store.create_research_evidence({"id": f"evidence-invalid-{index}", "clientId": "client-a", "brandId": "brand-a", "sourceUrl": "https://example.test/source", "sourceTitle": "Source", "retrievedAt": "2026-08-29T00:00:00.000Z", "summary": "Observed fact", "rightsState": "licensed", "reviewState": review_state})

        self.assertEqual(self.store.list_research_evidence("client-a", "brand-a"), [])

    def test_target_publication_key_is_deterministic_sha256_of_full_scope(self):
        if AgencyStateStore is None:
            return
        expected = sha256("client-a\x1fbrand-a\x1fbinding-a\x1fvariant-a\x1f2026-08-29T09:00:00.000Z".encode()).hexdigest()
        self.assertEqual(self.store.target_publication_idempotency_key("client-a", "brand-a", "binding-a", "variant-a", "2026-08-29T09:00:00.000Z"), expected)

    def test_generation_probe_and_plan_activation_are_explicitly_gated(self):
        if AgencyStateStore is None:
            return
        profile = {"id": "profile-a", "brandId": "brand-a", "mode": "llm_provider", "provider": "openrouter", "model": "model-a", "capabilities": ["copy"], "status": "connected", "secretRef": "keychain:provider-a"}
        self.store.create_generation_profile(profile)
        self.assertEqual(self.store.probe_generation_profile("profile-a")["status"], "connected")
        self.assertEqual(self.store.validate_plan_activation({"brandId": "brand-a", "generationProfileId": "profile-a", "bindingIds": ["binding-a"], "appOpen": False})["code"], "BINDINGS_NOT_READY")
        self.assertEqual(self.store.validate_plan_activation({"brandId": "brand-a", "generationProfileId": "profile-a", "bindingIds": [], "appOpen": False})["code"], "BINDINGS_REQUIRED")

    def test_subscription_activation_requires_open_managed_browser(self):
        if AgencyStateStore is None:
            return
        self.store.create_binding({"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        self.store.create_generation_profile({"id": "profile-sub", "brandId": "brand-a", "mode": "subscription_package", "provider": "gemini_web", "model": "gemini", "capabilities": ["copy"], "status": "connected"})
        self.assertEqual(self.store.validate_plan_activation({"brandId": "brand-a", "generationProfileId": "profile-sub", "bindingIds": ["binding-a"], "appOpen": False})["code"], "APP_OPEN_REQUIRED")

    def test_provider_configuration_probe_is_scalar_and_requires_explicit_policy_for_opencode(self):
        if AgencyStateStore is None:
            return
        config = {"id": "provider-openrouter", "clientId": "client-a", "providerKind": "openrouter", "displayName": "OpenRouter", "model": "model-a", "status": "not_configured", "capabilities": ["copy"], "secretRef": "keychain:openrouter"}
        self.store.create_provider_configuration(config)
        self.assertEqual(self.store.probe_provider_configuration("provider-openrouter")["status"], "not_configured")
        self.store.create_provider_configuration({"id": "provider-opencode", "clientId": "client-a", "providerKind": "opencode_go", "displayName": "OpenCode Go", "model": "model-a", "status": "connected", "capabilities": ["copy"], "secretRef": "keychain:opencode"})
        self.assertEqual(self.store.probe_provider_configuration("provider-opencode")["errorCode"], "POLICY_CONFIRMATION_REQUIRED")
        with self.assertRaisesRegex(StateValidationError, "PROVIDER_SECRET_REF_INVALID"):
            self.store.create_provider_configuration({"id": "provider-raw", "clientId": "client-a", "providerKind": "openrouter", "displayName": "OpenRouter", "model": "model-a", "status": "not_configured", "capabilities": ["copy"], "secretRef": "raw-secret-value"})

    def test_manual_plan_run_creates_reviewable_run_and_never_a_publication(self):
        if AgencyStateStore is None:
            return
        self.store.create_automation_plan({"id": "plan-a", "brandId": "brand-a", "state": "active", "generationProfileId": "profile-a", "bindingIds": ["binding-a"]})
        result = self.store.create_automation_run({"id": "run-a", "planId": "plan-a", "trigger": "manual", "runDate": "2026-08-29", "state": "needs_review"})
        self.assertEqual(result["state"], "needs_review")
        self.assertEqual(self.store.list_entity("target_publications"), [])

    def test_review_only_run_can_use_a_draft_plan_but_stays_reviewable(self):
        if AgencyStateStore is None:
            return
        self.store.create_automation_plan({"id": "plan-review", "brandId": "brand-a", "state": "draft", "bindingIds": ["binding-a"]})
        result = self.store.create_automation_run({"id": "run-review", "planId": "plan-review", "trigger": "manual", "runDate": "2026-08-30", "reviewOnly": True})
        self.assertEqual(result["state"], "needs_review")
        self.assertEqual(self.store.list_entity("target_publications"), [])
        with self.assertRaisesRegex(StateValidationError, "PLAN_NOT_ACTIVE"):
            self.store.create_automation_run({"id": "run-review-scheduled", "planId": "plan-review", "trigger": "scheduled", "runDate": "2026-08-30"})

    def test_media_archive_is_scalar_and_non_destructive(self):
        if AgencyStateStore is None:
            return
        asset = self.store.create_media_asset({"id": "asset-a", "clientId": "client-a", "brandId": "brand-a", "source": "drive", "providerFileId": "drive-a", "metadata": {"kind": "image", "checksum": "a" * 64, "reviewState": "approved"}})
        self.assertEqual(asset["archiveState"], "active")
        self.assertEqual(self.store.archive_media_asset("asset-a"), {"id": "asset-a", "archiveState": "archived", "providerFileId": "drive-a"})
        self.assertEqual(self.store.list_media_assets("client-a", "brand-a")[0]["archiveState"], "archived")

    def test_media_archive_can_be_recovered_without_restoring_publish_eligibility(self):
        if AgencyStateStore is None:
            return
        self.store.create_media_asset({"id": "asset-recover", "clientId": "client-a", "brandId": "brand-a", "source": "drive", "providerFileId": "drive-recover", "metadata": {"kind": "image", "status": "eligible", "reviewStatus": "verified"}})
        self.assertEqual(self.store.archive_media_asset("asset-recover")["archiveState"], "archived")
        restored = self.store.restore_media_asset("asset-recover")
        self.assertEqual(restored["archiveState"], "active")
        record = self.store.list_media_assets("client-a", "brand-a")[0]
        self.assertEqual(record["status"], "classified")
        self.assertEqual(record["reviewStatus"], "needs_review")

    def test_full_text_search_returns_only_reviewed_in_scope_knowledge_with_deterministic_order(self):
        if AgencyStateStore is None:
            return
        for index, title in enumerate(("Voice guide", "Product fact", "Other")):
            self.store.create_knowledge_item({"id": f"knowledge-{index}", "clientId": "client-a", "brandId": "brand-a", "kind": "fact", "title": title, "contentHash": f"{index + 1:064x}", "provenance": "owner", "rightsState": "user_owned", "reviewState": "approved", "text": "calm financial language" if index < 2 else "unrelated"})
        self.assertEqual([item["id"] for item in self.store.search_knowledge_items("client-a", "brand-a", "calm financial")], ["knowledge-0", "knowledge-1"])
        self.assertEqual(self.store.resolve_prompt_blueprint("missing", "brand-a"), None)

    def test_prompt_blueprints_and_evidence_are_listed_in_renderer_safe_shape(self):
        if AgencyStateStore is None:
            return
        blueprint = self.store.create_prompt_blueprint({"id": "blueprint-a", "brandId": "brand-a", "identityId": "identity-a-v1", "kind": "copy", "template": "Write clearly", "version": 1, "status": "active"})
        self.assertEqual(self.store.list_prompt_blueprints("brand-a"), [blueprint])
        evidence = self.store.create_research_evidence({"id": "evidence-a", "clientId": "client-a", "brandId": "brand-a", "sourceUrl": "https://example.test", "sourceTitle": "Source", "retrievedAt": "2026-08-29T00:00:00.000Z", "summary": "Summary", "rightsState": "licensed", "reviewState": "pending"})
        self.assertEqual(self.store.list_research_evidence("client-a", "brand-a"), [evidence])

    def test_research_evidence_query_includes_brand_and_client_level_only(self):
        if AgencyStateStore is None:
            return
        self.store.create_brand({"id": "brand-a2", "clientId": "client-a", "name": "Brand A2", "status": "active"})
        self.store.create_brand({"id": "brand-b1", "clientId": "client-b", "name": "Brand B1", "status": "active"})
        records = [
            {"id": "evidence-a1", "clientId": "client-a", "brandId": "brand-a", "sourceUrl": "https://example.test/evidence", "sourceTitle": "A1", "retrievedAt": "2026-09-13T00:00:00.000Z", "summary": "A1", "rightsState": "licensed", "reviewState": "pending"},
            {"id": "evidence-a2", "clientId": "client-a", "brandId": "brand-a2", "sourceUrl": "https://example.test/evidence", "sourceTitle": "A2", "retrievedAt": "2026-09-13T00:00:00.000Z", "summary": "A2", "rightsState": "licensed", "reviewState": "pending"},
            {"id": "evidence-client", "clientId": "client-a", "brandId": None, "sourceUrl": "https://example.test/evidence", "sourceTitle": "Client-level", "retrievedAt": "2026-09-13T00:00:00.000Z", "summary": "Client-level", "rightsState": "user_owned", "reviewState": "pending"},
            {"id": "evidence-b1", "clientId": "client-b", "brandId": "brand-b1", "sourceUrl": "https://example.test/evidence", "sourceTitle": "B1", "retrievedAt": "2026-09-13T00:00:00.000Z", "summary": "B1", "rightsState": "licensed", "reviewState": "pending"},
        ]
        for record in records:
            self.store.create_research_evidence(record)

        def evidence_ids(client_id, brand_id):
            return {item["id"] for item in self.store.list_research_evidence(client_id, brand_id)}

        self.assertEqual(evidence_ids("client-a", "brand-a"), {"evidence-a1", "evidence-client"})
        self.assertEqual(evidence_ids("client-a", "brand-a2"), {"evidence-a2", "evidence-client"})
        self.assertEqual(evidence_ids("client-b", "brand-b1"), {"evidence-b1"})
        client_evidence = next(item for item in self.store.list_research_evidence("client-a", "brand-a") if item["id"] == "evidence-client")
        self.assertEqual(client_evidence["reviewState"], "pending")

    def test_generic_research_evidence_update_cannot_change_review_state(self):
        evidence = self.store.create_research_evidence({"id": "evidence-pending", "clientId": "client-a", "brandId": "brand-a", "sourceUrl": "https://example.test", "sourceTitle": "Source", "retrievedAt": "2026-09-13T00:00:00.000Z", "summary": "Summary", "rightsState": "licensed", "reviewState": "pending"})

        with self.assertRaisesRegex(StateValidationError, "ENTITY_UPDATE_INVALID"):
            self.store.update_entity("research_evidence", evidence["id"], {"reviewState": "approved"})

        self.assertEqual(self.store.list_research_evidence("client-a", "brand-a")[0]["reviewState"], "pending")

    def test_brand_impact_preview_returns_durable_scope_counts_and_counts_worker_once(self):
        self.store.create_brand({"id": "brand-b", "clientId": "client-b", "name": "Brand B", "status": "active"})
        self.store.create_identity({"id": "identity-b-v1", "brandId": "brand-b", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
        self.store.create_media_asset({"id": "asset-shared", "clientId": "client-a", "brandId": "brand-a", "source": "drive", "providerFileId": "drive-shared", "metadata": {"kind": "image"}})
        for index in range(3):
            self.store.create_content_run({"id": f"run-impact-{index}", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package"})
        for index in range(2):
            self.store.create_automation_plan({"id": f"plan-impact-{index}", "brandId": "brand-a", "state": "active", "bindingIds": []})
        self.store.connection.execute(
            "INSERT INTO content_runs(id, client_id, brand_id, identity_version_id, execution_mode, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
            ("run-other-scope", "client-b", "brand-b", "identity-b-v1", "subscription_package", '{"mediaAssetIds":["asset-shared"]}'),
        )
        self.store.create_binding({"id": "binding-impact", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        self.store.create_target_publication({"id": "publication-impact", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-impact", "variantId": "variant-impact", "idempotencyKey": "key-impact", "approvalState": "approved", "state": "scheduled", "scheduledAt": "2099-01-05T09:00:00Z"})
        self.store.connection.execute("UPDATE target_publications SET worker_job_id = ? WHERE id = ?", ("worker-impact", "publication-impact"))
        self.store.connection.commit()
        before = self.store.connection.execute("SELECT status, deleted_at FROM brands WHERE id = ?", ("brand-a",)).fetchone()

        first = self.store.brand_impact_preview("brand-a")
        second = self.store.brand_impact_preview("brand-a")

        self.assertEqual(first["clientId"], "client-a")
        self.assertEqual(first["brandId"], "brand-a")
        self.assertEqual(first["brandName"], "Brand A")
        self.assertEqual(first["brandStatus"], "active")
        self.assertIsNone(first["deletedAt"])
        self.assertEqual(first["counts"], {"draftCount": 3, "planCount": 2, "unsentScheduleCount": 1, "sharedMediaCount": 1})
        self.assertEqual(first["blockers"], ["publication-impact"])
        self.assertEqual(first["revision"], second["revision"])
        self.assertRegex(first["revision"], r"^[a-f0-9]{64}$")
        self.assertRegex(first["observedAt"], r"^20\d{2}-\d{2}-\d{2}T.*Z$")
        self.assertTrue(all(isinstance(value, int) and value >= 0 for value in first["counts"].values()))
        after = self.store.connection.execute("SELECT status, deleted_at FROM brands WHERE id = ?", ("brand-a",)).fetchone()
        self.assertEqual(tuple(before), tuple(after))

    def test_brand_impact_preview_hydrates_trashed_inactive_brand_without_mutating_it(self):
        self.store.create_brand({"id": "brand-trashed", "clientId": "client-b", "name": "Trashed Brand", "status": "active"})
        self.store.create_identity({"id": "identity-trashed-v1", "brandId": "brand-trashed", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
        self.store.create_content_run({"id": "run-trashed", "clientId": "client-b", "brandId": "brand-trashed", "identityVersionId": "identity-trashed-v1", "executionMode": "subscription_package"})
        self.store.create_automation_plan({"id": "plan-trashed", "brandId": "brand-trashed", "state": "active", "bindingIds": []})
        self.store.bind_brand_actor("brand-trashed", "user-trash", "owner", ["manage_brand"])
        self.store.trash_brand("brand-trashed", {"actorUserId": "user-trash"})
        before = self.store.connection.execute("SELECT status, deleted_at FROM brands WHERE id = ?", ("brand-trashed",)).fetchone()

        preview = self.store.brand_impact_preview("brand-trashed")

        self.assertEqual(preview["clientId"], "client-b")
        self.assertEqual(preview["brandId"], "brand-trashed")
        self.assertEqual(preview["brandName"], "Trashed Brand")
        self.assertEqual(preview["brandStatus"], "archived")
        self.assertIsInstance(preview["deletedAt"], str)
        self.assertEqual(preview["counts"], {"draftCount": 1, "planCount": 1, "unsentScheduleCount": 0, "sharedMediaCount": 0})
        self.assertEqual(preview["blockers"], [])
        after = self.store.connection.execute("SELECT status, deleted_at FROM brands WHERE id = ?", ("brand-trashed",)).fetchone()
        self.assertEqual(tuple(before), tuple(after))

    def test_brand_impact_preview_rejects_malformed_or_negative_count_snapshots(self):
        original = self.store._brand_impact_counts
        self.store._brand_impact_counts = lambda _brand_id: {"draftCount": -1, "planCount": 0, "unsentScheduleCount": float("nan"), "sharedMediaCount": 0}
        try:
            with self.assertRaisesRegex(StateValidationError, "BRAND_IMPACT_COUNTS_INVALID"):
                self.store.brand_impact_preview("brand-a")
        finally:
            self.store._brand_impact_counts = original

    def test_brand_impact_preview_rejects_missing_brand(self):
        with self.assertRaisesRegex(StateValidationError, "BRAND_MISSING"):
            self.store.brand_impact_preview("brand-missing")

    def test_content_intelligence_lineage_round_trips_and_is_immutable(self):
        lineage = {
            "selectedKnowledgeItemIds": ["knowledge-approved-a"],
            "selectedResearchEvidenceIds": ["evidence-approved-a", "evidence-client-a"],
            "selectedPromptBlueprintId": "blueprint-a",
            "selectedPromptBlueprintVersion": 7,
            "selectedRecipeId": "recipe-a",
            "transformMode": "repurpose",
            "mediaSetFingerprint": "a" * 64,
            "customerFacts": ["Topic: Fixture topic", "Notes: Customer supplied fact"],
        }
        run = {
            "id": "run-a04-lineage", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1",
            "executionMode": "subscription_package", "providerTraceId": "pending", "generationStatus": "pending",
            "prompt": "Fixture prompt with approved sources", "revisionId": "revision-a04-parent", "contentIntelligenceLineage": lineage, **lineage,
            "recipeId": "recipe-a", "variants": [],
        }
        created = self.store.create_content_run(run)
        self.assertEqual(created["contentIntelligenceLineage"], lineage)
        completed = self.store.update_content_run_payload("run-a04-lineage", {"generationStatus": "completed", "providerTraceId": "recording-gateway-trace", "prompt": run["prompt"], "contentIntelligenceLineage": lineage, **lineage})
        self.assertEqual(completed["contentIntelligenceLineage"], lineage)
        self.assertEqual(completed["selectedKnowledgeItemIds"], ["knowledge-approved-a"])
        self.assertEqual(completed["selectedResearchEvidenceIds"], ["evidence-approved-a", "evidence-client-a"])
        self.assertEqual(completed["selectedPromptBlueprintVersion"], 7)
        self.assertEqual(completed["mediaSetFingerprint"], "a" * 64)
        child = self.store.create_content_run({**run, "id": "run-a04-lineage-rewrite", "parentContentRunId": "run-a04-lineage", "revisionId": "revision-a04-child", "parentRevisionId": "revision-a04-parent", "providerTraceId": "pending", "generationStatus": "pending", "body": "", "caption": "", "state": "needs_review", "approvalState": "pending"})
        self.assertEqual(child["parentContentRunId"], "run-a04-lineage")
        self.assertEqual(child["contentIntelligenceLineage"], lineage)
        self.assertEqual((child["state"], child["approvalState"]), ("needs_review", "pending"))
        self.assertEqual((child["revisionId"], child["parentRevisionId"]), ("revision-a04-child", "revision-a04-parent"))
        self.assertEqual(self.store.list_entity("content_runs", "run-a04-lineage")[0]["prompt"], run["prompt"])
        self.store.update_content_run_payload("run-a04-lineage", {"revisionHistory": [{"id": "revision-a04-history", "title": "Earlier", "body": "Earlier body", "createdAt": "2026-09-13T00:00:00Z"}]})
        history_child = self.store.create_content_run({**run, "id": "run-a04-history-child", "parentContentRunId": "run-a04-lineage", "parentRevisionId": "revision-a04-history", "revisionId": "revision-a04-history-child", "providerTraceId": "pending", "generationStatus": "pending", "body": "", "caption": "", "state": "needs_review", "approvalState": "pending"})
        self.assertEqual(history_child["parentRevisionId"], "revision-a04-history")
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_PARENT_REVISION_REQUIRED"):
            self.store.create_content_run({**run, "id": "run-a04-missing-parent-revision", "parentContentRunId": "run-a04-lineage"})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_PARENT_REVISION_MISMATCH"):
            self.store.create_content_run({**run, "id": "run-a04-wrong-parent-revision", "parentContentRunId": "run-a04-lineage", "parentRevisionId": "revision-unrelated", "revisionId": "revision-wrong-child"})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_LINEAGE_ALIAS_MISMATCH"):
            self.store.create_content_run({**run, "id": "run-a04-alias-mismatch", "recipeId": "recipe-b"})
        self.store.create_automation_plan({"id": "plan-a", "brandId": "brand-a", "state": "draft", "bindingIds": []})
        self.store.create_automation_plan({"id": "plan-b", "brandId": "brand-a", "state": "draft", "bindingIds": []})
        self.store.update_content_run_payload("run-a04-lineage", {"planId": "plan-a"})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_PARENT_LINEAGE_MISMATCH"):
            self.store.create_content_run({**run, "id": "run-a04-source-mismatch", "parentContentRunId": "run-a04-lineage", "selectedKnowledgeItemIds": ["knowledge-other"], "contentIntelligenceLineage": {**lineage, "selectedKnowledgeItemIds": ["knowledge-other"]}, "planId": "plan-a"})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_PARENT_PLAN_MISMATCH"):
            self.store.create_content_run({**run, "id": "run-a04-plan-mismatch", "parentContentRunId": "run-a04-lineage", "planId": "plan-b"})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_LINEAGE_IMMUTABLE"):
            self.store.update_content_run_payload("run-a04-lineage", {"prompt": "mutated request provenance"})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_LINEAGE_IMMUTABLE"):
            self.store.update_content_run_payload("run-a04-lineage", {"prompt": run["prompt"], "contentIntelligenceLineage": {**lineage, "selectedResearchEvidenceIds": ["evidence-other"]}, "selectedResearchEvidenceIds": ["evidence-other"]})
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "lineage.sqlite3")
            durable = AgencyStateStore(path)
            durable.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            durable.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            durable.create_identity({"id": "identity-a-v1", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            durable.create_content_run({**run, "id": "run-a04-durable"})
            durable.close()
            reopened = AgencyStateStore(path)
            self.assertEqual(reopened.list_entity("content_runs", "run-a04-durable")[0]["contentIntelligenceLineage"], lineage)
            reopened.close()

    def test_content_intelligence_lineage_rejects_partial_create_and_update(self):
        lineage = {"selectedKnowledgeItemIds": ["knowledge-a"], "selectedResearchEvidenceIds": ["evidence-a"], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 7, "selectedRecipeId": "recipe-a", "transformMode": "repurpose", "mediaSetFingerprint": "a" * 64, "customerFacts": ["Topic: A04"]}
        base = {"clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "fixed request provenance", "contentIntelligenceLineage": lineage, **lineage}
        for field in ("selectedKnowledgeItemIds", "selectedResearchEvidenceIds", "selectedPromptBlueprintId", "selectedPromptBlueprintVersion", "selectedRecipeId", "transformMode", "customerFacts"):
            nested = dict(lineage)
            nested.pop(field)
            payload = {**base, "id": f"run-a04-direct-missing-{field}", "contentIntelligenceLineage": nested}
            payload.pop(field, None)
            payload.pop("promptBlueprintVersion", None)
            with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_LINEAGE_INVALID"):
                self.store.create_content_run(payload)
        self.store.create_content_run({**base, "id": "run-a04-direct-partial-update"})
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_LINEAGE_INVALID"):
            self.store.update_content_run_payload("run-a04-direct-partial-update", {"prompt": "fixed request provenance", "contentIntelligenceLineage": {"selectedKnowledgeItemIds": ["knowledge-a"]}})

    def test_a04_fix4_parent_link_patch_and_media_fingerprint_fail_closed_without_partial_writes(self):
        lineage = {"selectedKnowledgeItemIds": ["knowledge-a"], "selectedResearchEvidenceIds": ["evidence-a"], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 7, "selectedRecipeId": "recipe-a", "transformMode": "repurpose", "customerFacts": ["Topic: A04"]}
        parent = {"id": "run-a04-fix4-parent", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Parent prompt", "revisionId": "revision-parent", "contentIntelligenceLineage": lineage, **lineage, "generationStatus": "completed", "state": "needs_review", "approvalState": "pending"}
        self.store.create_content_run(parent)
        child = {"id": "run-a04-fix4-child", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Child prompt", "revisionId": "revision-child", "parentRevisionId": "revision-parent", "parentContentRunId": parent["id"], "contentIntelligenceLineage": lineage, **lineage, "generationStatus": "pending", "state": "needs_review", "approvalState": "pending"}
        self.store.create_content_run(child)
        self.store.create_brand({"id": "brand-b", "clientId": "client-b", "name": "Brand B", "status": "active"})
        self.store.create_identity({"id": "identity-b-v1", "brandId": "brand-b", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
        self.store.create_content_run({"id": "run-a04-fix4-other-scope-parent", "clientId": "client-b", "brandId": "brand-b", "identityVersionId": "identity-b-v1", "executionMode": "subscription_package", "prompt": "Other scope prompt", "revisionId": "revision-other-scope", "generationStatus": "completed", "state": "needs_review", "approvalState": "pending"})
        before_child = self.store.list_entity("content_runs", child["id"])[0]
        before_parent = self.store.list_entity("content_runs", parent["id"])[0]
        invalid_patches = [
            ({"parentRevisionId": "revision-unrelated"}, "CONTENT_RUN_PARENT_REVISION_MISMATCH"),
            ({"generationStatus": "completed", "parentRevisionId": "revision-unrelated"}, "CONTENT_RUN_PARENT_REVISION_MISMATCH"),
            ({"parentRevisionId": ""}, "CONTENT_RUN_PARENT_REVISION_ID_INVALID"),
            ({"parentContentRunId": parent["id"]}, "CONTENT_RUN_PARENT_REVISION_REQUIRED"),
            ({"parentContentRunId": parent["id"], "parentRevisionId": "revision-parent"}, "CONTENT_RUN_REVISION_ID_INVALID"),
            ({"parentContentRunId": "run-a04-fix4-missing-parent", "parentRevisionId": "revision-parent"}, "CONTENT_RUN_PARENT_MISSING"),
            ({"parentContentRunId": "run-a04-fix4-other-scope-parent", "parentRevisionId": "revision-other-scope"}, "CONTENT_RUN_PARENT_SCOPE_MISMATCH"),
            ({"parentContentRunId": "run-a04-fix4-child", "parentRevisionId": "revision-parent"}, "CONTENT_RUN_PARENT_ID_INVALID"),
            ({"revisionId": "revision-detached"}, "CONTENT_RUN_PARENT_LINK_IMMUTABLE"),
        ]
        for patch, code in invalid_patches:
            with self.assertRaisesRegex(StateValidationError, code):
                self.store.update_content_run_payload(child["id"], patch)
            self.assertEqual(self.store.list_entity("content_runs", child["id"])[0], before_child)
            self.assertEqual(self.store.list_entity("content_runs", parent["id"])[0], before_parent)

        media_lineage = {**lineage, "mediaSetFingerprint": "a" * 64}
        media_base = {"id": "run-a04-fix4-media-top", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "Media prompt", "revisionId": "revision-media-top", "contentIntelligenceLineage": media_lineage, **media_lineage, "mediaAssetIds": ["asset-top"], "variants": []}
        self.store.create_content_run(media_base)
        self.assertEqual(self.store.list_entity("content_runs", media_base["id"])[0]["mediaSetFingerprint"], "a" * 64)
        completed_top = self.store.update_content_run_payload(media_base["id"], {"generationStatus": "completed"})
        self.assertEqual(completed_top["mediaSetFingerprint"], "a" * 64)
        before_changed_fingerprint = self.store.list_entity("content_runs", media_base["id"])[0]
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_LINEAGE_IMMUTABLE"):
            self.store.update_content_run_payload(media_base["id"], {"mediaSetFingerprint": "b" * 64})
        self.assertEqual(self.store.list_entity("content_runs", media_base["id"])[0], before_changed_fingerprint)
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID"):
            self.store.create_content_run({**media_base, "id": "run-a04-fix4-media-top-missing", "mediaSetFingerprint": None, "contentIntelligenceLineage": {**media_lineage, "mediaSetFingerprint": None}})

        variant_media_base = {**media_base, "id": "run-a04-fix4-media-variant", "revisionId": "revision-media-variant", "mediaAssetIds": [], "variants": [{"id": "variant-media", "mediaAssetIds": ["asset-variant"], "metadata": {}}]}
        self.store.create_content_run(variant_media_base)
        self.assertEqual(self.store.update_content_run_payload(variant_media_base["id"], {"generationStatus": "completed"})["mediaSetFingerprint"], "a" * 64)
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID"):
            self.store.create_content_run({**media_base, "id": "run-a04-fix4-media-variant-missing", "mediaAssetIds": [], "variants": [{"id": "variant-media", "mediaAssetIds": ["asset-variant"], "metadata": {}}], "mediaSetFingerprint": None, "contentIntelligenceLineage": {**media_lineage, "mediaSetFingerprint": None}})

        no_media_lineage = {key: value for key, value in lineage.items() if key != "mediaSetFingerprint"}
        no_media = {"id": "run-a04-fix4-media-patch", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a-v1", "executionMode": "subscription_package", "prompt": "No media prompt", "revisionId": "revision-no-media", "contentIntelligenceLineage": no_media_lineage, **no_media_lineage, "variants": []}
        self.store.create_content_run(no_media)
        before_media_patch = self.store.list_entity("content_runs", no_media["id"])[0]
        with self.assertRaisesRegex(StateValidationError, "CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID"):
            self.store.update_content_run_payload(no_media["id"], {"mediaAssetIds": ["asset-patch"]})
        self.assertEqual(self.store.list_entity("content_runs", no_media["id"])[0], before_media_patch)

    def test_legacy_simulated_publication_migrates_to_read_only_and_survives_restart(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "legacy-publication.sqlite3"
            store = AgencyStateStore(database_path)
            store.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
            store.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
            store.create_identity({"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
            store.create_connection({"id": "connection-a", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a", "displayName": "Page A", "connectionState": "connected", "scopes": []})
            store.create_binding({"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
            store.connection.execute(
                "INSERT INTO target_publications(id, binding_id, variant_id, idempotency_key, approval_state, state, client_id, brand_id, simulation, scheduled_at, target_external_id, target_platform) VALUES (?, ?, ?, ?, 'approved', 'scheduled', ?, ?, 1, ?, ?, ?)",
                ("publication-legacy", "binding-a", "variant-legacy", "key-legacy", "client-a", "brand-a", "2099-01-05T09:00:00Z", "page-a", "facebook"),
            )
            store.connection.commit()
            store.append_analytics_event({"id": "event-legacy", "eventName": "publication.state_changed", "clientId": "client-a", "brandId": "brand-a", "occurredAt": "2099-01-05T09:00:00Z", "properties": {"targetPublicationId": "publication-legacy", "simulation": True}})
            store.append_analytics_event({"id": "event-live", "eventName": "publication.state_changed", "clientId": "client-a", "brandId": "brand-a", "occurredAt": "2099-01-05T09:01:00Z", "properties": {"targetPublicationId": "publication-live", "simulation": False}})
            store.close()

            reopened = AgencyStateStore(database_path)
            try:
                publication = reopened.list_target_publications("client-a", "brand-a")[0]
                self.assertTrue(publication["legacyNonLive"])
                self.assertTrue(publication["simulation"])
                self.assertEqual(publication["state"], "blocked")
                self.assertEqual(publication["workerAckState"], "not_required")
                self.assertEqual([event["id"] for event in reopened.list_analytics_events("client-a", "brand-a")], ["event-live"])
                with self.assertRaisesRegex(StateValidationError, "LEGACY_NON_LIVE_ACTION_BLOCKED"):
                    reopened.begin_target_publication_command("publication-legacy", {"action": "cancel", "clientId": "client-a", "brandId": "brand-a", "expectedRevision": 0, "requestId": "legacy-cancel"})
            finally:
                reopened.close()

            restarted = AgencyStateStore(database_path)
            try:
                publication = restarted.list_target_publications("client-a", "brand-a")[0]
                self.assertTrue(publication["legacyNonLive"])
                self.assertEqual(publication["state"], "blocked")
                self.assertEqual(restarted.connection.execute("SELECT legacy_non_live FROM target_publications WHERE id = 'publication-legacy'").fetchone()[0], 1)
            finally:
                restarted.close()

    def test_new_target_publications_are_live_only_and_legacy_simulation_is_rejected(self):
        self.store.create_binding({"id": "binding-live-only", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        live = self.store.create_target_publication({"id": "publication-live-only", "bindingId": "binding-live-only", "variantId": "variant-live-only", "clientId": "client-a", "brandId": "brand-a", "idempotencyKey": "key-live-only", "approvalState": "approved", "state": "approval_pending", "simulation": False, "scheduledAt": "2099-01-05T09:00:00Z"})
        self.assertFalse(live["simulation"])
        self.assertFalse(live["legacyNonLive"])
        self.assertEqual(tuple(self.store.connection.execute("SELECT simulation, legacy_non_live FROM target_publications WHERE id = 'publication-live-only'").fetchone()), (0, 0))
        with self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_SIMULATION_REMOVED"):
            self.store.create_target_publication({"id": "publication-simulation", "bindingId": "binding-live-only", "variantId": "variant-simulation", "clientId": "client-a", "brandId": "brand-a", "idempotencyKey": "key-simulation", "approvalState": "approved", "state": "scheduled", "simulation": True, "scheduledAt": "2099-01-06T09:00:00Z"})

    def test_approval_rejects_non_boolean_nested_simulation_marker(self):
        self.store.create_binding({"id": "binding-invalid-simulation", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        with self.assertRaisesRegex(StateValidationError, "TARGET_PUBLICATION_SIMULATION_INVALID"):
            self.store.begin_target_publication_approval({
                "id": "publication-invalid-simulation", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-invalid-simulation", "identityVersionId": "identity-a-v1", "variantId": "variant-invalid-simulation", "idempotencyKey": "key-invalid-simulation", "approvalState": "approved", "platform": "facebook", "kind": "text", "requiredScopes": [], "mediaRequired": False, "mediaEligible": True, "scheduledAt": "2999-01-05T09:00:00+00:00",
                "workerJob": {"jobId": "job-invalid-simulation", "idempotencyKey": "key-invalid-simulation", "scheduledAt": "2999-01-05T09:00:00+00:00", "payload": {"simulation": "false", "approval_state": "approved", "workspace_id": "client-a", "client_id": "client-a", "brand_id": "brand-a", "binding_id": "binding-invalid-simulation", "identity_version_id": "identity-a-v1", "page_id": "page-a", "platform": "facebook", "kind": "text", "required_scopes": [], "target_publication_id": "publication-invalid-simulation"}},
            })

    def test_analytics_reference_with_unhashable_json_value_does_not_crash(self):
        event = self.store.append_analytics_event({"id": "event-unhashable-reference", "eventName": "publication.state_changed", "clientId": "client-a", "brandId": "brand-a", "occurredAt": "2099-01-05T09:00:00Z", "properties": {"targetPublicationId": []}})
        listed = self.store.list_analytics_events("client-a", "brand-a")
        self.assertIn(event, listed)

    def test_approval_normalizes_missing_simulation_and_requires_live_worker_ack(self):
        self.store.create_binding({"id": "binding-approval-live", "brandId": "brand-a", "identityId": "identity-a-v1", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"})
        scheduled_at = "2999-01-05T09:00:00+00:00"
        command = self.store.begin_target_publication_approval({
            "id": "publication-approval-live", "clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-approval-live", "identityVersionId": "identity-a-v1", "variantId": "variant-approval-live", "idempotencyKey": "key-approval-live", "approvalState": "approved", "platform": "facebook", "kind": "text", "requiredScopes": [], "mediaRequired": False, "mediaEligible": True, "scheduledAt": scheduled_at,
            "workerJob": {"jobId": "job-approval-live", "idempotencyKey": "key-approval-live", "scheduledAt": scheduled_at, "payload": {"approval_state": "approved", "workspace_id": "client-a", "client_id": "client-a", "brand_id": "brand-a", "binding_id": "binding-approval-live", "identity_version_id": "identity-a-v1", "page_id": "page-a", "platform": "facebook", "kind": "text", "required_scopes": [], "target_publication_id": "publication-approval-live"}},
        })
        self.assertEqual(command["commandStatus"], "pending")
        publication = self.store.list_target_publications("client-a", "brand-a")[0]
        self.assertFalse(publication["simulation"])
        self.assertFalse(publication["legacyNonLive"])
        self.assertEqual(publication["workerAckState"], "pending")
        acknowledged = self.store.acknowledge_publication_command(command["commandId"], {"id": "job-approval-live", "state": "queued", "revision": 0, "scheduled_at": datetime.fromisoformat(scheduled_at).timestamp()})
        self.assertEqual(acknowledged["state"], "scheduled")
        self.assertEqual(acknowledged["workerAckState"], "acknowledged")


if __name__ == "__main__":
    unittest.main()
