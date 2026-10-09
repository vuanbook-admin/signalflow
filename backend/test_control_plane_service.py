import json
import os
import tempfile
import sys
import threading
import time
import unittest
from datetime import datetime
from unittest.mock import patch
from pathlib import Path
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(__file__))
from automation_worker import SQLiteJobStore
from automation_worker_service import create_worker_app
import control_plane_service as service
from app_state_store import AgencyStateStore


class EnvFileTokenVaultTests(unittest.TestCase):
    def test_put_stores_one_json_secret_and_metadata_is_scalar_only(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"SIGNALFLOW_ENV_FILE": os.path.join(directory, ".env")}, clear=False):
            vault = service.EnvFileTokenVault()
            vault.put("workspace-1", "secret-token", 100, [{"id": "page-1", "name": "Page", "kind": "page", "tasks": ["manage"]}])
            metadata = vault.metadata("workspace-1")
            stored = Path(os.environ["SIGNALFLOW_ENV_FILE"]).read_text(encoding="utf-8")
            mode = Path(os.environ["SIGNALFLOW_ENV_FILE"]).stat().st_mode & 0o777

        self.assertIn(service._account_env_key(vault._account("workspace-1")), stored)
        self.assertEqual(mode, 0o600)
        self.assertEqual(metadata["accountHintCount"], 1)
        self.assertEqual(metadata["vaultBoundary"], "env-file-plaintext")
        self.assertNotIn("access_token", metadata)
        self.assertNotIn("secret-token", repr(metadata))

    def test_env_file_errors_do_not_expose_secret_payload(self):
        with patch.dict(os.environ, {"SIGNALFLOW_ENV_FILE": "/private/no-such-parent/.env"}, clear=False), patch.object(service.Path, "read_text", side_effect=OSError("secret-token leaked")):
            with self.assertRaises(service.TokenVaultError) as context:
                service.EnvFileTokenVault().has("workspace-1")
        self.assertNotIn("secret-token", str(context.exception))

    def test_memory_vault_requires_explicit_configuration(self):
        with patch.dict(os.environ, {"SIGNALFLOW_TOKEN_VAULT": "memory", "SIGNALFLOW_ALLOW_MEMORY_TOKEN_VAULT": "true"}, clear=False):
            vault = service.create_token_vault()
            self.assertEqual(vault.boundary, "development-memory-explicit")
        with patch.dict(os.environ, {"SIGNALFLOW_TOKEN_VAULT": "memory"}, clear=False):
            os.environ.pop("SIGNALFLOW_ALLOW_MEMORY_TOKEN_VAULT", None)
            with self.assertRaises(RuntimeError):
                service.create_token_vault()

    def test_health_identifies_boundary_without_claiming_live_ready(self):
        health = service.health()
        self.assertIn(health["tokenVault"], {"env-file-plaintext", "development-memory-explicit"})
        self.assertEqual(health["tokenVault"], health["tokenVaultBoundary"])
        self.assertFalse(health["livePublishingReady"])
        self.assertIn("dataAsOf", health)
        self.assertIn("workerReconciledAt", health)

    def test_control_plane_rejects_requests_from_a_previous_profile_runtime(self):
        with patch.dict(os.environ, {"SIGNALFLOW_PROFILE_ID": "profile-b", "SIGNALFLOW_RUNTIME_ID": "runtime-b"}, clear=False):
            client = TestClient(service.app)
            stale = client.get("/v1/profile-runtime-guard-test", headers={"x-signalflow-profile-id": "profile-a", "x-signalflow-runtime-id": "runtime-a"})
            current = client.get("/v1/profile-runtime-guard-test", headers={"x-signalflow-profile-id": "profile-b", "x-signalflow-runtime-id": "runtime-b"})

        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["detail"]["code"], "PROFILE_RUNTIME_IDENTITY_MISMATCH")
        self.assertEqual(current.status_code, 404)

    def test_cors_allows_the_runtime_identity_headers_from_the_desktop_renderer(self):
        response = TestClient(service.app).options(
            "/v1/agency/recovery",
            headers={
                "Origin": "null",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-signalflow-profile-id,x-signalflow-runtime-id",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "null")

    def test_native_page_token_reader_reassembles_chunks_without_putting_token_in_arguments(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"SIGNALFLOW_ENV_FILE": os.path.join(directory, ".env")}, clear=False):
            base = "workspace:workspace-1:meta:page-access-token:111"
            service._write_env_secret(base, "v1:generation-1:2")
            service._write_env_secret(f"{base}:chunk:generation-1:0", "page-token-")
            service._write_env_secret(f"{base}:chunk:generation-1:1", "secret")
            reader = service.NativeMetaPageTokenReader()
            token = reader.page_token("workspace-1", "111")
        self.assertEqual(token, "page-token-secret")


class OAuthStateBehaviorTests(unittest.TestCase):
    def test_state_can_be_consumed_once_and_rejects_replay(self):
        store = service.MemoryStateStore()
        store.put("state-1", service.OAuthState("workspace-1", "https://localhost/oauth/callback", 9999999999))
        store.consume("state-1", "workspace-1", "https://localhost/oauth/callback")
        with self.assertRaises(service.HTTPException) as context:
            store.consume("state-1", "workspace-1", "signalflow://oauth/callback")
        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail["code"], "OAUTH_STATE_INVALID")


class WorkerMetaPublishTests(unittest.TestCase):
    def test_worker_meta_page_text_uses_native_page_token_and_returns_only_provider_metadata(self):
        class FakeReader:
            def __init__(self):
                self.markers = {}

            def _read_secret(self, account):
                return self.markers.get(account)

            def page_token(self, workspace_id, page_id):
                return "page-secret-token"

            def write_scalar(self, account, value):
                self.markers[account] = value

        class FakeResponse:
            status_code = 200

            @staticmethod
            def json():
                return {"id": "111_222"}

        class FakeAsyncClient:
            def __init__(self):
                self.post_count = 0

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def post(self, *_args, **_kwargs):
                self.post_count += 1
                return FakeResponse()

        reader = FakeReader()
        client = FakeAsyncClient()
        request = {"workspace_id": "workspace-1", "page_id": "111", "message": "Approved", "idempotency_key": "key-1", "approval_state": "approved", "platform": "facebook", "kind": "text", "simulation": False}
        headers = {"Authorization": "Bearer worker-test-token"}
        with patch.dict(os.environ, {"SIGNALFLOW_WORKER_AUTH_TOKEN": "worker-test-token"}, clear=False), patch.object(service, "NativeMetaPageTokenReader", return_value=reader), patch.object(service.httpx, "AsyncClient", return_value=client):
            test_client = TestClient(service.app)
            response = test_client.post("/v1/worker/meta/page-text", json=request, headers=headers)
            replay = test_client.post("/v1/worker/meta/page-text", json=request, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"provider": "meta", "providerJobId": "111_222", "providerState": "published", "idempotentReplay": False})
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json(), {"provider": "meta", "providerJobId": "111_222", "providerState": "published", "idempotentReplay": True})
        self.assertEqual(client.post_count, 1)
        self.assertNotIn("page-secret-token", response.text)

    def test_worker_requires_explicit_auth_configuration(self):
        request = {"workspace_id": "workspace-1", "page_id": "111", "message": "Approved", "idempotency_key": "key-unauthorized", "approval_state": "approved", "platform": "facebook", "kind": "text", "simulation": False}
        with patch.dict(os.environ, {"SIGNALFLOW_WORKER_AUTH_TOKEN": ""}, clear=False):
            response = TestClient(service.app).post("/v1/worker/meta/page-text", json=request)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "WORKER_AUTH_NOT_CONFIGURED")

    def test_worker_meta_page_photo_uses_public_media_url_and_is_idempotent(self):
        class FakeReader:
            def __init__(self):
                self.markers = {}

            def _read_secret(self, account):
                return self.markers.get(account)

            def page_token(self, workspace_id, page_id):
                return "page-secret-token"

            def write_scalar(self, account, value):
                self.markers[account] = value

        class FakeResponse:
            status_code = 200

            @staticmethod
            def json():
                return {"post_id": "111_333"}

        class FakeAsyncClient:
            def __init__(self):
                self.calls = []

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def post(self, *args, **kwargs):
                self.calls.append((args, kwargs))
                return FakeResponse()

        reader = FakeReader()
        client = FakeAsyncClient()
        request = {"workspace_id": "workspace-1", "page_id": "111", "message": "Bellamy caption", "media_url": "https://drive.google.com/file/d/asset/view?usp=sharing", "idempotency_key": "key-photo-1", "approval_state": "approved", "platform": "facebook", "kind": "image", "simulation": False}
        headers = {"Authorization": "Bearer worker-test-token"}
        with patch.dict(os.environ, {"SIGNALFLOW_WORKER_AUTH_TOKEN": "worker-test-token"}, clear=False), patch.object(service, "NativeMetaPageTokenReader", return_value=reader), patch.object(service.httpx, "AsyncClient", return_value=client):
            test_client = TestClient(service.app)
            response = test_client.post("/v1/worker/meta/page-photo", json=request, headers=headers)
            replay = test_client.post("/v1/worker/meta/page-photo", json=request, headers=headers)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"provider": "meta", "providerJobId": "111_333", "providerState": "published", "idempotentReplay": False})
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["idempotentReplay"], True)
        self.assertEqual(client.calls[0][0][0], "https://graph.facebook.com/v23.0/111/photos")
        self.assertEqual(client.calls[0][1]["data"]["url"], request["media_url"])
        self.assertEqual(client.calls[0][1]["data"]["caption"], request["message"])
        self.assertNotIn("page-secret-token", response.text)


    def test_classifies_missing_page_publish_scope_as_truthful_permanent_error(self):
        status, code, message = service.classify_meta_publish_response(400, {"error": {"code": 200, "message": "Permissions error"}})
        self.assertEqual(status, 403)
        self.assertEqual(code, "META_WORKER_PAGE_PUBLISH_SCOPE_REQUIRED")
        self.assertIn("pages_manage_posts", message)
        self.assertNotIn("Permissions error", message)

        retry_status, retry_code, _ = service.classify_meta_publish_response(503, {})
        self.assertEqual((retry_status, retry_code), (503, "META_WORKER_PROVIDER_RETRYABLE"))


class AgencyStateApiTests(unittest.TestCase):
    def setUp(self):
        self.store = AgencyStateStore(":memory:")
        self.previous_store = getattr(service, "agency_state_store", None)
        service.agency_state_store = self.store
        self.client = TestClient(service.app)

    def tearDown(self):
        recovery_thread = getattr(service, "_outbox_recovery_thread", None)
        if recovery_thread and recovery_thread.is_alive():
            recovery_thread.join(timeout=1)
        service.agency_state_store = self.previous_store
        self.store.close()

    def test_fix5_conditional_receipt_route_and_explicit_create_rejection(self):
        self.store.create_client({"id": "client-a", "name": "A", "timezone": "UTC", "status": "active"})
        self.store.create_brand({"id": "brand-a", "clientId": "client-a", "name": "A", "status": "active"})
        self.store.create_media_asset({"id": "asset-a", "clientId": "client-a", "brandId": "brand-a", "source": "local", "metadata": {"ownershipReceiptId": "receipt-a", "sha256": "a" * 64, "mimeType": "image/png"}})
        request = {"clientId": "client-a", "brandId": "brand-a", "ownershipReceiptId": "receipt-a", "sha256": "a" * 64, "mimeType": "image/png"}
        retained = self.client.post("/v1/agency/media-assets/asset-a/compensate", json={**request, "ownershipReceiptId": "wrong"})
        self.assertEqual(retained.status_code, 200)
        self.assertEqual(retained.json()["status"], "retained")
        deleted = self.client.post("/v1/agency/media-assets/asset-a/compensate", json=request)
        self.assertEqual(deleted.json(), {"assetId": "asset-a", "status": "deleted"})
        rejected = self.client.post("/v1/agency/content-runs", json={"id": "bad-run"})
        self.assertEqual(rejected.json()["detail"]["createOutcome"], "rejected")

    def test_fix6_compensation_route_retains_both_shared_brand_metadata_spellings(self):
        self.store.create_client({"id": "client-a", "name": "A", "timezone": "UTC", "status": "active"})
        self.store.create_brand({"id": "brand-a", "clientId": "client-a", "name": "A", "status": "active"})
        self.store.create_brand({"id": "brand-b", "clientId": "client-a", "name": "B", "status": "active"})
        request = {"clientId": "client-a", "brandId": "brand-a", "ownershipReceiptId": "receipt-a", "sha256": "a" * 64, "mimeType": "image/png"}

        for asset_id, shared_metadata_key in (("asset-shared-camel", "sharedBrandIds"), ("asset-shared-snake", "shared_brand_ids")):
            with self.subTest(shared_metadata_key=shared_metadata_key):
                self.store.create_media_asset({
                    "id": asset_id,
                    "clientId": "client-a",
                    "brandId": "brand-a",
                    "source": "local",
                    "metadata": {"ownershipReceiptId": "receipt-a", "sha256": "a" * 64, "mimeType": "image/png", shared_metadata_key: ["brand-b"]},
                })
                response = self.client.post(f"/v1/agency/media-assets/{asset_id}/compensate", json=request)

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["status"], "retained")
                self.assertEqual(len(self.store.list_entity("media_assets", asset_id)), 1)

    def test_identity_route_returns_durable_strategy_catalog_ack_and_rejects_stale_scope(self):
        for payload in (
            {"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"},
            {"id": "client-b", "name": "Client B", "timezone": "UTC", "status": "active"},
        ):
            self.assertEqual(self.client.post("/v1/agency/clients", json=payload).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/identities", json={"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-b", "clientId": "client-b", "name": "Brand B", "status": "active"}).status_code, 200)
        self.store.bind_brand_actor("brand-a", "manager-a", "owner", ["manage_brand"])
        catalog = AgencyStateApiTests._catalog("brand-a")
        reduced = {**catalog, "objectives": catalog["objectives"][:-1]}
        reduced_response = self.client.patch("/v1/agency/identities/identity-a/payload", json={"clientId": "client-a", "brandId": "brand-a", "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "manager-a", "role": "owner", "capability": "manage_brand"}, "strategyCatalog": reduced})
        self.assertEqual(reduced_response.status_code, 400)
        self.assertEqual(reduced_response.json()["detail"]["code"], "STRATEGY_CATALOG_OBJECTIVE_SET_INVALID")
        response = self.client.patch("/v1/agency/identities/identity-a/payload", json={"clientId": "client-a", "brandId": "brand-a", "expectedVersion": 1, "expectedRevision": 0, "actor": {"actorUserId": "manager-a", "role": "owner", "capability": "manage_brand"}, "strategyCatalog": catalog})
        self.assertEqual(response.status_code, 200)
        ack = response.json()
        self.assertEqual((ack["clientId"], ack["brandId"], ack["version"], ack["revision"]), ("client-a", "brand-a", 2, 1))
        self.assertEqual(len(ack["fingerprint"]), 64)
        self.assertEqual(self.client.get("/v1/agency/identities/identity-a").json()["strategyCatalog"]["brandId"], "brand-a")

        stale = self.client.patch("/v1/agency/identities/identity-a/payload", json={"clientId": "client-b", "brandId": "brand-a", "expectedVersion": 2, "expectedRevision": 1, "actor": {"actorUserId": "manager-a", "role": "owner", "capability": "manage_brand"}, "strategyCatalog": catalog})
        self.assertEqual(stale.status_code, 400)
        self.assertEqual(stale.json()["detail"]["code"], "STRATEGY_CATALOG_SCOPE_MISMATCH")
        self.assertEqual(self.client.get("/v1/agency/identities/identity-a").json()["strategyCatalog"]["version"], 2)
        alias = self.client.patch("/v1/agency/identities/identity-a/payload", json={"clientId": "client-a", "brandId": "brand-a", "catalog": catalog, "actor": {"actorUserId": "manager-a"}})
        self.assertEqual(alias.status_code, 400)
        self.assertEqual(alias.json()["detail"]["code"], "IDENTITY_PAYLOAD_INVALID")

    @staticmethod
    def _catalog(brand_id):
        objectives = [{"key": key, "label": key.title(), "description": f"{key} objective", "enabled": True, "order": index} for index, key in enumerate(("reach", "engagement", "education", "knowledge", "conversion"), 1)]
        angle = {"id": "proof-point", "label": "Proof point", "guidance": "Use one verified proof point.", "enabled": True, "order": 1, "channels": ["facebook", "instagram", "tiktok", "youtube"]}
        pillar = {"id": "proof-and-process", "label": "Proof and process", "description": "Make evidence visible.", "enabled": True, "order": 1, "channels": ["facebook", "instagram", "tiktok", "youtube"], "angles": [angle]}
        return {"brandId": brand_id, "version": 1, "objectives": objectives, "pillars": [pillar], "channelOverrides": {}, "updatedAt": "2026-09-14T00:00:00.000Z"}

    def test_scalar_crud_rejects_cross_client_binding_and_sensitive_payloads(self):
        client_a = {"id": "client-a", "name": "Client A", "timezone": "Asia/Ho_Chi_Minh", "status": "active"}
        client_b = {"id": "client-b", "name": "Client B", "timezone": "Asia/Ho_Chi_Minh", "status": "active"}
        self.assertEqual(self.client.post("/v1/agency/clients", json=client_a).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/clients", json=client_b).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/identities", json={"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/connections", json={"id": "connection-b", "clientId": "client-b", "platform": "facebook", "externalAccountId": "page-b", "displayName": "Page B", "connectionState": "connected", "scopes": [], "secretRef": "keychain:opaque"}).status_code, 200)

        binding = self.client.post("/v1/agency/bindings", json={"id": "binding-b", "brandId": "brand-a", "identityId": "identity-a", "connectionId": "connection-b", "targetExternalId": "page-b", "targetName": "Page B", "state": "connected"})
        self.assertEqual(binding.status_code, 400)
        self.assertEqual(binding.json()["detail"]["code"], "CONNECTION_CLIENT_MISMATCH")
        sensitive = self.client.post("/v1/agency/clients", json={**client_a, "id": "client-sensitive", "apiKey": "must-not-return"})
        self.assertEqual(sensitive.status_code, 400)
        self.assertEqual(sensitive.json()["detail"]["code"], "SENSITIVE_FIELD_REJECTED")
        listed = self.client.get("/v1/agency/clients")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item["id"] for item in listed.json()], ["client-a", "client-b"])

    def test_migration_marks_the_renderer_boundary_only_after_sqlite_commits(self):
        payload = {
            "clients": [{"id": "client-m", "name": "Client M", "timezone": "UTC", "status": "active"}],
            "brands": [{"id": "brand-m", "clientId": "client-m", "name": "Brand M", "status": "active"}],
            "identities": [{"id": "identity-m", "brandId": "brand-m", "name": "Default", "isDefault": True, "version": 1, "status": "active"}],
            "connections": [],
            "bindings": [],
        }
        result = self.client.post("/v1/agency/migrations/commit", json=payload)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["controlPlaneMigrated"], True)
        self.assertEqual(self.store.strategy_catalog_migration_version(), 5)
        self.assertEqual(self.client.get("/v1/agency/recovery").json()["brands"][0]["id"], "brand-m")
        repeat = self.client.post("/v1/agency/migrations/commit", json=payload)
        self.assertEqual(repeat.status_code, 400)
        self.assertEqual(repeat.json()["detail"]["code"], "RENDERER_STATE_REPLACEMENT_REJECTED")

    def test_migration_persists_one_scoped_strategy_catalog_payload(self):
        catalog = self._catalog("brand-m")
        payload = {
            "clients": [{"id": "client-m", "name": "Client M", "timezone": "UTC", "status": "active"}],
            "brands": [{"id": "brand-m", "clientId": "client-m", "name": "Brand M", "status": "active"}],
            "identities": [{"id": "identity-m", "brandId": "brand-m", "clientId": "client-m", "name": "Default", "isDefault": True, "version": 1, "status": "active", "strategyCatalog": catalog}],
            "connections": [],
            "bindings": [],
            "migrationActor": {"actorUserId": "manager-m", "role": "owner", "capability": "manage_brand"},
            "actorBindings": [{"brandId": "brand-m", "actorUserId": "manager-m", "role": "owner", "capability": "manage_brand"}],
        }
        response = self.client.post("/v1/agency/migrations/commit", json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["strategyCatalogCount"], 1)
        persisted = self.client.get("/v1/agency/strategy-catalogs", params={"clientId": "client-m", "brandId": "brand-m"})
        self.assertEqual(persisted.status_code, 200)
        self.assertEqual(persisted.json()["strategyCatalog"]["brandId"], "brand-m")
        self.assertEqual(persisted.json()["revision"], 0)

    def test_catalog_migration_requires_manage_brand_and_rejects_duplicate_brand_scopes_before_mutation(self):
        catalog = self._catalog("brand-m")
        payload = {
            "clients": [{"id": "client-m", "name": "Client M", "timezone": "UTC", "status": "active"}],
            "brands": [{"id": "brand-m", "clientId": "client-m", "name": "Brand M", "status": "active"}],
            "identities": [{"id": "identity-m", "brandId": "brand-m", "name": "Default", "isDefault": True, "version": 1, "status": "active", "strategyCatalog": catalog}],
            "connections": [],
            "bindings": [],
        }
        missing_actor = self.client.post("/v1/agency/migrations/commit", json=payload)
        self.assertEqual(missing_actor.status_code, 400)
        self.assertEqual(missing_actor.json()["detail"]["code"], "BRAND_ACTOR_REQUIRED")
        self.assertEqual(self.store.list_entity("clients"), [])

        duplicate = {**payload, "clients": [{"id": "client-a", "name": "A", "timezone": "UTC", "status": "active"}, {"id": "client-b", "name": "B", "timezone": "UTC", "status": "active"}], "brands": [{"id": "brand-shared", "clientId": "client-a", "name": "A", "status": "active"}, {"id": "brand-shared", "clientId": "client-b", "name": "B", "status": "active"}], "identities": []}
        duplicate_response = self.client.post("/v1/agency/migrations/commit", json=duplicate)
        self.assertEqual(duplicate_response.status_code, 400)
        self.assertEqual(duplicate_response.json()["detail"]["code"], "BRAND_ID_SCOPE_CONFLICT")
        self.assertEqual(self.store.list_entity("clients"), [])

    def test_http_routes_enforce_generation_route_and_target_idempotency(self):
        for client_id in ("client-a",):
            self.assertEqual(self.client.post("/v1/agency/clients", json={"id": client_id, "name": "Client A", "timezone": "UTC", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/identities", json={"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/connections", json={"id": "connection-a", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a", "displayName": "Page A", "connectionState": "connected", "scopes": []}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/bindings", json={"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"}).status_code, 200)
        invalid = self.client.post("/v1/agency/generation-profiles", json={"id": "profile-invalid", "brandId": "brand-a", "mode": "both", "provider": "openrouter", "model": "x", "capabilities": ["copy"], "status": "connected"})
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["detail"]["code"], "GENERATION_MODE_INVALID")
        self.assertEqual(self.client.post("/v1/agency/generation-profiles", json={"id": "profile-a", "brandId": "brand-a", "mode": "llm_provider", "provider": "openrouter", "model": "model-a", "capabilities": ["copy"], "status": "connected"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/generation-profiles", json={"id": "profile-b", "brandId": "brand-a", "mode": "llm_provider", "provider": "nvidia_nim", "model": "model-b", "capabilities": ["copy"], "status": "connected"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/content-runs", json={"id": "run-a", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "generationProfileId": "profile-a", "executionMode": "llm_provider"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/content-runs/run-a/provider-attempt").status_code, 200)
        immutable = self.client.patch("/v1/agency/content-runs/run-a", json={"generationProfileId": "profile-b"})
        self.assertEqual(immutable.status_code, 400)
        self.assertEqual(immutable.json()["detail"]["code"], "CONTENT_RUN_PROFILE_IMMUTABLE")
        structured = self.client.patch("/v1/agency/content-runs/run-a", json={"caption": "Saved caption", "qualityStatus": "passed", "qualityChecks": [{"key": "caption", "passed": True}], "state": "quality_passed"})
        self.assertEqual(structured.status_code, 200)
        self.assertEqual(structured.json()["caption"], "Saved caption")
        publication = {"id": "publication-a", "bindingId": "binding-a", "variantId": "variant-a", "idempotencyKey": "key-a", "approvalState": "approved", "state": "scheduled"}
        direct = self.client.post("/v1/agency/target-publications", json=publication)
        self.assertEqual(direct.status_code, 409)
        self.assertEqual(direct.json()["detail"]["code"], "TARGET_PUBLICATION_COMMAND_REQUIRED")

    def test_content_run_http_create_and_completion_reject_unknown_payload_fields(self):
        self.assertEqual(self.client.post("/v1/agency/clients", json={"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/identities", json={"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"}).status_code, 200)
        lineage = {"selectedKnowledgeItemIds": ["knowledge-a"], "selectedResearchEvidenceIds": ["evidence-a"], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 7, "selectedRecipeId": "recipe-a", "transformMode": "repurpose", "mediaSetFingerprint": "a" * 64, "customerFacts": ["Topic: A04"]}
        base = {"id": "run-a04-allow-list", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "subscription_package", "generationStatus": "pending", "prompt": "fixed request provenance", "contentIntelligenceLineage": lineage, **lineage}
        rejected_create = self.client.post("/v1/agency/content-runs", json={**base, "unlistedA04Field": {"x": 1}})
        self.assertEqual(rejected_create.status_code, 400)
        self.assertEqual(rejected_create.json()["detail"]["code"], "CONTENT_RUN_PAYLOAD_INVALID")
        self.assertEqual(self.client.post("/v1/agency/content-runs", json=base).status_code, 200)
        rejected_update = self.client.patch("/v1/agency/content-runs/run-a04-allow-list", json={"generationStatus": "completed", "unlistedA04Field": {"x": 1}})
        self.assertEqual(rejected_update.status_code, 400)
        self.assertEqual(rejected_update.json()["detail"]["code"], "CONTENT_RUN_PAYLOAD_INVALID")
        self.assertNotIn("unlistedA04Field", self.client.get("/v1/agency/content-runs/run-a04-allow-list").json())
        prompt_update = self.client.patch("/v1/agency/content-runs/run-a04-allow-list", json={"prompt": "changed request provenance"})
        self.assertEqual(prompt_update.status_code, 400)
        self.assertEqual(prompt_update.json()["detail"]["code"], "CONTENT_RUN_LINEAGE_IMMUTABLE")
        self.assertEqual(self.client.get("/v1/agency/content-runs/run-a04-allow-list").json()["prompt"], "fixed request provenance")

    def test_content_run_http_round_trips_strategy_fields_and_quality_cas(self):
        self.assertEqual(self.client.post("/v1/agency/clients", json={"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/identities", json={"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"}).status_code, 200)
        snapshot = {"objectiveKey": "reach", "objectiveLabel": "Reach", "pillarId": "audience-insight", "pillarLabel": "Audience insight", "angleId": "audience-insight-audience-question", "angleLabel": "Audience question", "angleGuidance": "Answer one audience question.", "channel": "facebook", "format": "text", "strategyVersion": 4, "catalogFingerprint": "a" * 64}
        lineage = {"selectedKnowledgeItemIds": [], "selectedResearchEvidenceIds": [], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 1, "selectedRecipeId": "recipe-a", "transformMode": "original", "customerFacts": ["Operator supplied topic"]}
        payload = {"id": "run-http-strategy", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "subscription_package", "prompt": "strategy prompt", "contentAngle": "Audience question", "strategyVersion": 4, "catalogFingerprint": "a" * 64, "strategySnapshot": snapshot, "strategyState": "clean", "regenerationState": "clean", "contentPillar": "Audience insight", "objective": "Reach", "state": "needs_review", "contentIntelligenceLineage": lineage, **lineage}
        created = self.client.post("/v1/agency/content-runs", json=payload)
        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.json()["strategySnapshot"], snapshot)
        updated = self.client.patch("/v1/agency/content-runs/run-http-strategy", json={"strategyState": "needs_regeneration", "regenerationState": "needs_regeneration"})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual((updated.json()["strategyState"], updated.json()["regenerationState"]), ("needs_regeneration", "needs_regeneration"))
        rejected = self.client.post("/v1/agency/content-runs", json={**payload, "id": "run-http-strategy-unknown", "unknownStrategyField": True})
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(rejected.json()["detail"]["code"], "CONTENT_RUN_PAYLOAD_INVALID")
        self.assertEqual(self.client.get("/v1/agency/content-runs/run-http-strategy-unknown").status_code, 404)

    def test_content_run_http_rejects_incomplete_lineage_on_create_and_completion(self):
        self.assertEqual(self.client.post("/v1/agency/clients", json={"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/identities", json={"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"}).status_code, 200)
        lineage = {"selectedKnowledgeItemIds": ["knowledge-a"], "selectedResearchEvidenceIds": ["evidence-a"], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 7, "selectedRecipeId": "recipe-a", "transformMode": "repurpose", "mediaSetFingerprint": "a" * 64, "customerFacts": ["Topic: A04"]}
        base = {"clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "subscription_package", "prompt": "fixed request provenance", "contentIntelligenceLineage": lineage, **lineage}
        for field in ("selectedKnowledgeItemIds", "selectedResearchEvidenceIds", "selectedPromptBlueprintId", "selectedPromptBlueprintVersion", "selectedRecipeId", "transformMode", "customerFacts"):
            nested = dict(lineage)
            nested.pop(field, None)
            payload = {**base, "id": f"run-a04-create-missing-{field}", "contentIntelligenceLineage": nested}
            payload.pop(field, None)
            payload.pop("promptBlueprintVersion", None)
            response = self.client.post("/v1/agency/content-runs", json=payload)
            self.assertEqual(response.status_code, 400, field)
            self.assertEqual(response.json()["detail"]["code"], "CONTENT_RUN_LINEAGE_INVALID", field)
        missing_prompt = {**base, "id": "run-a04-create-missing-prompt"}
        missing_prompt.pop("prompt")
        self.assertEqual(self.client.post("/v1/agency/content-runs", json=missing_prompt).json()["detail"]["code"], "CONTENT_RUN_LINEAGE_INVALID")
        self.assertEqual(self.client.post("/v1/agency/content-runs", json={**base, "id": "run-a04-completion-valid"}).status_code, 200)
        for field in ("selectedKnowledgeItemIds", "selectedResearchEvidenceIds", "selectedPromptBlueprintId", "selectedPromptBlueprintVersion", "selectedRecipeId", "transformMode", "customerFacts"):
            nested = dict(lineage)
            nested.pop(field, None)
            response = self.client.patch("/v1/agency/content-runs/run-a04-completion-valid", json={"prompt": base["prompt"], "contentIntelligenceLineage": nested})
            self.assertEqual(response.status_code, 400, field)
            self.assertEqual(response.json()["detail"]["code"], "CONTENT_RUN_LINEAGE_INVALID", field)
        self.assertEqual(self.client.get("/v1/agency/content-runs/run-a04-completion-valid").json()["contentIntelligenceLineage"], lineage)

        self.assertEqual(self.client.post("/v1/agency/media-assets", json={"id": "asset-a04", "clientId": "client-a", "brandId": "brand-a", "source": "local", "metadata": {"sha256": "b" * 64, "mimeType": "image/png", "sizeBytes": 1}}).status_code, 200)
        media_evidence = [{"assetId": "asset-a04", "sha256": "b" * 64, "mimeType": "image/png", "order": 0, "role": "publish", "uploadState": "processed"}]
        missing_fingerprint = {**base, "id": "run-a04-create-missing-fingerprint", "mediaEvidence": media_evidence}
        nested_without_fingerprint = dict(lineage)
        nested_without_fingerprint.pop("mediaSetFingerprint")
        missing_fingerprint["contentIntelligenceLineage"] = nested_without_fingerprint
        missing_fingerprint.pop("mediaSetFingerprint")
        self.assertEqual(self.client.post("/v1/agency/content-runs", json=missing_fingerprint).json()["detail"]["code"], "CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")
        valid_media = {**base, "id": "run-a04-update-missing-fingerprint", "mediaEvidence": media_evidence}
        self.assertEqual(self.client.post("/v1/agency/content-runs", json=valid_media).status_code, 200)
        patch_missing_fingerprint = dict(nested_without_fingerprint)
        patch_response = self.client.patch("/v1/agency/content-runs/run-a04-update-missing-fingerprint", json={"prompt": base["prompt"], "contentIntelligenceLineage": patch_missing_fingerprint})
        self.assertEqual(patch_response.status_code, 400)
        self.assertEqual(patch_response.json()["detail"]["code"], "CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")

    def test_content_run_http_requires_parent_revision_and_accepts_current_parent_revision(self):
        self.assertEqual(self.client.post("/v1/agency/clients", json={"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/identities", json={"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"}).status_code, 200)
        lineage = {"selectedKnowledgeItemIds": ["knowledge-a"], "selectedResearchEvidenceIds": ["evidence-a"], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 7, "selectedRecipeId": "recipe-a", "transformMode": "repurpose", "mediaSetFingerprint": "a" * 64, "customerFacts": ["Topic: A04"]}
        parent = {"id": "run-a04-parent-revision", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "subscription_package", "prompt": "parent prompt", "revisionId": "revision-parent", "contentIntelligenceLineage": lineage, **lineage, "generationStatus": "completed", "state": "needs_review", "approvalState": "pending", "qualityStatus": "pending"}
        self.assertEqual(self.client.post("/v1/agency/content-runs", json=parent).status_code, 200)
        child = {"id": "run-a04-child-revision", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "subscription_package", "prompt": "child prompt", "revisionId": "revision-child", "parentContentRunId": "run-a04-parent-revision", "contentIntelligenceLineage": lineage, **lineage, "generationStatus": "pending", "state": "needs_review", "approvalState": "pending", "qualityStatus": "pending"}
        missing = self.client.post("/v1/agency/content-runs", json=child)
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json()["detail"]["code"], "CONTENT_RUN_PARENT_REVISION_REQUIRED")
        wrong = self.client.post("/v1/agency/content-runs", json={**child, "id": "run-a04-child-wrong-revision", "parentRevisionId": "revision-unrelated"})
        self.assertEqual(wrong.status_code, 400)
        self.assertEqual(wrong.json()["detail"]["code"], "CONTENT_RUN_PARENT_REVISION_MISMATCH")
        accepted = self.client.post("/v1/agency/content-runs", json={**child, "parentRevisionId": "revision-parent"})
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual((accepted.json()["revisionId"], accepted.json()["parentRevisionId"], accepted.json()["parentContentRunId"]), ("revision-child", "revision-parent", "run-a04-parent-revision"))
        self.assertEqual(self.client.get("/v1/agency/content-runs/run-a04-parent-revision").json()["revisionId"], "revision-parent")

    def test_content_run_http_parent_patch_and_completion_keep_link_immutable(self):
        for path, payload in (
            ("/v1/agency/clients", {"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}),
            ("/v1/agency/brands", {"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}),
            ("/v1/agency/identities", {"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"}),
            ("/v1/agency/brands", {"id": "brand-b", "clientId": "client-b", "name": "Brand B", "status": "active"}),
            ("/v1/agency/identities", {"id": "identity-b", "brandId": "brand-b", "name": "Default", "isDefault": True, "version": 1, "status": "active"}),
        ):
            if path == "/v1/agency/brands" and payload["id"] == "brand-b":
                self.assertEqual(self.client.post("/v1/agency/clients", json={"id": "client-b", "name": "Client B", "timezone": "UTC", "status": "active"}).status_code, 200)
            self.assertEqual(self.client.post(path, json=payload).status_code, 200)
        lineage = {"selectedKnowledgeItemIds": ["knowledge-a"], "selectedResearchEvidenceIds": ["evidence-a"], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 7, "selectedRecipeId": "recipe-a", "transformMode": "repurpose", "customerFacts": ["Topic: A04"]}
        parent = {"id": "run-a04-patch-parent", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "subscription_package", "prompt": "Parent prompt", "revisionId": "revision-parent", "contentIntelligenceLineage": lineage, **lineage, "generationStatus": "completed", "state": "needs_review", "approvalState": "pending"}
        self.assertEqual(self.client.post("/v1/agency/content-runs", json=parent).status_code, 200)
        child = {"id": "run-a04-patch-child", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "subscription_package", "prompt": "Child prompt", "revisionId": "revision-child", "parentRevisionId": "revision-parent", "parentContentRunId": parent["id"], "contentIntelligenceLineage": lineage, **lineage, "generationStatus": "pending", "state": "needs_review", "approvalState": "pending"}
        self.assertEqual(self.client.post("/v1/agency/content-runs", json=child).status_code, 200)
        other_parent = {"id": "run-a04-patch-other-parent", "clientId": "client-b", "brandId": "brand-b", "identityVersionId": "identity-b", "executionMode": "subscription_package", "prompt": "Other prompt", "revisionId": "revision-other", "generationStatus": "completed", "state": "needs_review", "approvalState": "pending"}
        self.assertEqual(self.client.post("/v1/agency/content-runs", json=other_parent).status_code, 200)
        before_child = self.client.get("/v1/agency/content-runs/" + child["id"]).json()
        before_parent = self.client.get("/v1/agency/content-runs/" + parent["id"]).json()
        invalid_patches = [
            ({"parentRevisionId": "revision-unrelated"}, "CONTENT_RUN_PARENT_REVISION_MISMATCH"),
            ({"generationStatus": "completed", "parentRevisionId": "revision-unrelated"}, "CONTENT_RUN_PARENT_REVISION_MISMATCH"),
            ({"parentRevisionId": ""}, "CONTENT_RUN_PARENT_REVISION_ID_INVALID"),
            ({"parentContentRunId": parent["id"]}, "CONTENT_RUN_PARENT_REVISION_REQUIRED"),
            ({"parentContentRunId": parent["id"], "parentRevisionId": "revision-parent"}, "CONTENT_RUN_REVISION_ID_INVALID"),
            ({"parentContentRunId": "run-a04-patch-missing-parent", "parentRevisionId": "revision-parent"}, "CONTENT_RUN_PARENT_MISSING"),
            ({"parentContentRunId": other_parent["id"], "parentRevisionId": "revision-other"}, "CONTENT_RUN_PARENT_SCOPE_MISMATCH"),
            ({"parentContentRunId": child["id"], "parentRevisionId": "revision-parent"}, "CONTENT_RUN_PARENT_ID_INVALID"),
            ({"revisionId": "revision-detached"}, "CONTENT_RUN_PARENT_LINK_IMMUTABLE"),
        ]
        for patch, code in invalid_patches:
            response = self.client.patch("/v1/agency/content-runs/" + child["id"], json=patch)
            self.assertEqual(response.status_code, 400, patch)
            self.assertEqual(response.json()["detail"]["code"], code, patch)
            self.assertEqual(self.client.get("/v1/agency/content-runs/" + child["id"]).json(), before_child)
            self.assertEqual(self.client.get("/v1/agency/content-runs/" + parent["id"]).json(), before_parent)

    def test_content_run_http_media_fingerprint_covers_top_level_variants_metadata_and_patch(self):
        for path, payload in (
            ("/v1/agency/clients", {"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}),
            ("/v1/agency/brands", {"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}),
            ("/v1/agency/identities", {"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"}),
        ):
            self.assertEqual(self.client.post(path, json=payload).status_code, 200)
        lineage = {"selectedKnowledgeItemIds": ["knowledge-a"], "selectedResearchEvidenceIds": ["evidence-a"], "selectedPromptBlueprintId": "blueprint-a", "selectedPromptBlueprintVersion": 7, "selectedRecipeId": "recipe-a", "transformMode": "repurpose", "customerFacts": ["Topic: A04"]}
        base = {"clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "subscription_package", "prompt": "Media prompt", "contentIntelligenceLineage": lineage, **lineage, "variants": []}
        top_missing = self.client.post("/v1/agency/content-runs", json={**base, "id": "run-a04-http-media-top-missing", "mediaAssetIds": ["asset-top"]})
        self.assertEqual(top_missing.status_code, 400)
        self.assertEqual(top_missing.json()["detail"]["code"], "CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")
        top_valid = {**base, "id": "run-a04-http-media-top-valid", "revisionId": "revision-top", "mediaAssetIds": ["asset-top"], "mediaSetFingerprint": "a" * 64, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": "a" * 64}}
        self.assertEqual(self.client.post("/v1/agency/content-runs", json=top_valid).status_code, 200)
        completed_top = self.client.patch("/v1/agency/content-runs/run-a04-http-media-top-valid", json={"generationStatus": "completed"})
        self.assertEqual(completed_top.status_code, 200)
        self.assertEqual(completed_top.json()["mediaSetFingerprint"], "a" * 64)
        variant_missing = self.client.post("/v1/agency/content-runs", json={**base, "id": "run-a04-http-media-variant-missing", "variants": [{"id": "variant-v", "mediaAssetIds": ["asset-variant"], "metadata": {}}]})
        self.assertEqual(variant_missing.status_code, 400)
        self.assertEqual(variant_missing.json()["detail"]["code"], "CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")
        variant_valid = {**base, "id": "run-a04-http-media-variant-valid", "revisionId": "revision-variant", "variants": [{"id": "variant-v", "mediaAssetIds": ["asset-variant"], "metadata": {}}], "mediaSetFingerprint": "b" * 64, "contentIntelligenceLineage": {**lineage, "mediaSetFingerprint": "b" * 64}}
        self.assertEqual(self.client.post("/v1/agency/content-runs", json=variant_valid).status_code, 200)
        self.assertEqual(self.client.patch("/v1/agency/content-runs/run-a04-http-media-variant-valid", json={"generationStatus": "completed"}).status_code, 200)
        metadata_missing = self.client.post("/v1/agency/content-runs", json={**base, "id": "run-a04-http-media-metadata-missing", "variants": [{"id": "variant-m", "metadata": {"mediaEvidence": [{"assetId": "asset-meta"}]}}]})
        self.assertEqual(metadata_missing.status_code, 400)
        self.assertEqual(metadata_missing.json()["detail"]["code"], "CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")
        before_patch = self.client.get("/v1/agency/content-runs/run-a04-http-media-top-valid").json()
        changed = self.client.patch("/v1/agency/content-runs/run-a04-http-media-top-valid", json={"mediaSetFingerprint": "c" * 64})
        self.assertEqual(changed.status_code, 400)
        self.assertEqual(changed.json()["detail"]["code"], "CONTENT_RUN_LINEAGE_IMMUTABLE")
        self.assertEqual(self.client.get("/v1/agency/content-runs/run-a04-http-media-top-valid").json(), before_patch)

    def test_held_quality_patch_cannot_write_passed_state_after_revision_changes(self):
        self.assertEqual(self.client.post("/v1/agency/clients", json={"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/identities", json={"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/content-runs", json={
            "id": "run-quality-cas", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "llm_provider",
            "revisionId": "revision-old", "topic": "Old topic", "body": "Old copy", "caption": "Old copy", "contentPillar": "Education",
            "objective": "Reach", "cta": "Read", "hashtags": ["#old"], "seoKeywords": [], "sources": ["source"], "qualityStatus": "pending",
            "qualityChecks": [], "approvalState": "pending", "state": "needs_review",
            "variants": [{"id": "variant-7", "platform": "facebook", "kind": "text", "title": "Old title", "body": "Old copy", "caption": "Old copy", "cta": "Read", "hashtags": ["#old"], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "metadata": {"mediaEvidence": []}}],
        }).status_code, 200)
        old_revision = {
            "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "revisionId": "revision-old", "topic": "Old topic", "body": "Old copy", "caption": "Old copy", "contentPillar": "Education",
            "objective": "Reach", "cta": "Read", "hashtags": ["#old"], "seoKeywords": [], "scheduledAt": None, "sources": ["source"], "notes": None,
            "variantId": "variant-7", "variant": {"title": "Old title", "body": "Old copy", "caption": "Old copy", "cta": "Read", "hashtags": ["#old"], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "mediaEvidence": []},
        }
        revision_update = self.client.patch("/v1/agency/content-runs/run-quality-cas", json={
            "revisionId": "revision-new", "topic": "New topic", "body": "New copy", "caption": "New copy", "hashtags": ["#new"], "qualityStatus": "pending", "qualityChecks": [], "approvalState": "pending", "state": "needs_review",
            "variants": [{"id": "variant-7", "platform": "facebook", "kind": "text", "title": "New title", "body": "New copy", "caption": "New copy", "cta": "Read", "hashtags": ["#new"], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "metadata": {"mediaEvidence": []}}],
        })
        self.assertEqual(revision_update.status_code, 200)

        held_quality_request = self.client.patch("/v1/agency/content-runs/run-quality-cas", json={
            "expectedRevisionFields": old_revision, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "copy", "passed": True}], "checkedAt": "2026-09-13T05:00:00.000Z",
        })
        self.assertEqual(held_quality_request.status_code, 409)
        self.assertEqual(held_quality_request.json()["detail"]["code"], "CONTENT_RUN_REVISION_MISMATCH")
        current = self.client.get("/v1/agency/content-runs/run-quality-cas").json()
        self.assertEqual((current["revisionId"], current["body"], current["qualityStatus"], current["qualityChecks"], current["state"]), ("revision-new", "New copy", "pending", [], "needs_review"))

    def test_quality_patch_ack_exposes_renderer_identity_fields_at_http_boundary(self):
        self.assertEqual(self.client.post("/v1/agency/clients", json={"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/identities", json={"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/content-runs", json={
            "id": "run-quality-ack", "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "llm_provider",
            "revisionId": "revision-ack", "topic": "Topic", "body": "Body", "caption": "Body", "contentPillar": "Education",
            "objective": "Reach", "cta": "Read", "hashtags": ["#tag"], "seoKeywords": [], "sources": ["source"], "qualityStatus": "pending",
            "qualityChecks": [], "approvalState": "pending", "state": "needs_review",
            "variants": [{"id": "variant-ack", "platform": "facebook", "kind": "text", "title": "Title", "body": "Body", "caption": "Body", "cta": "Read", "hashtags": ["#tag"], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "metadata": {"mediaEvidence": []}}],
        }).status_code, 200)
        expected = {
            "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "revisionId": "revision-ack", "topic": "Topic", "body": "Body", "caption": "Body", "contentPillar": "Education",
            "objective": "Reach", "cta": "Read", "hashtags": ["#tag"], "seoKeywords": [], "scheduledAt": None, "sources": ["source"], "notes": None,
            "variantId": "variant-ack", "variant": {"title": "Title", "body": "Body", "caption": "Body", "cta": "Read", "hashtags": ["#tag"], "seoKeywords": [], "mediaAssetIds": [], "mediaOperations": [], "mediaEvidence": []},
        }
        response = self.client.patch("/v1/agency/content-runs/run-quality-ack", json={"expectedRevisionFields": expected, "state": "ready", "qualityStatus": "passed", "qualityChecks": [{"key": "copy", "passed": True}], "checkedAt": "2026-09-13T06:00:00.000Z"})
        self.assertEqual(response.status_code, 200)
        acknowledgement = response.json()
        self.assertEqual((acknowledgement["client_id"], acknowledgement["clientId"], acknowledgement["brand_id"], acknowledgement["brandId"]), ("client-a", "client-a", "brand-a", "brand-a"))
        self.assertEqual((acknowledgement["id"], acknowledgement["revisionId"], acknowledgement["state"], acknowledgement["qualityStatus"], acknowledgement["qualityChecks"], acknowledgement["checkedAt"]), ("run-quality-ack", "revision-ack", "ready", "passed", [{"key": "copy", "passed": True}], "2026-09-13T06:00:00.000Z"))

    def test_analytics_events_are_append_only_and_scoped(self):
        self.assertEqual(self.client.post("/v1/agency/clients", json={"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        event = {"id": "event-a", "eventName": "approval.decided", "clientId": "client-a", "brandId": "brand-a", "occurredAt": "2026-08-29T00:00:00.000Z", "properties": {"decision": "approved", "simulation": False}}
        self.assertEqual(self.client.post("/v1/agency/analytics-events", json=event).status_code, 200)
        listed = self.client.get("/v1/agency/analytics-events", params={"clientId": "client-a", "brandId": "brand-a"})
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json(), [event])

    def test_knowledge_research_and_provider_routes_return_scalar_decisions(self):
        self.assertEqual(self.client.post("/v1/agency/clients", json={"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        knowledge = {"id": "knowledge-a", "clientId": "client-a", "brandId": "brand-a", "kind": "fact", "title": "Fact", "contentHash": "a" * 64, "provenance": "owner", "rightsState": "user_owned", "reviewState": "approved", "text": "Fact"}
        self.assertEqual(self.client.post("/v1/agency/knowledge-items", json=knowledge).status_code, 200)
        self.assertEqual(self.client.get("/v1/agency/knowledge-items", params={"clientId": "client-a", "brandId": "brand-a"}).json()[0]["id"], "knowledge-a")
        self.assertEqual(self.client.post("/v1/agency/knowledge-items/knowledge-a/archive").json(), {"id": "knowledge-a", "archiveState": "archived"})
        provider = {"id": "provider-a", "clientId": "client-a", "providerKind": "openrouter", "displayName": "OpenRouter", "model": "model-a", "status": "connected", "capabilities": ["copy"], "secretRef": "keychain:provider-a"}
        self.assertEqual(self.client.post("/v1/agency/provider-configurations", json=provider).status_code, 200)
        self.assertNotIn("secretRef", self.client.get("/v1/agency/provider-configurations").json()[0])

    def test_knowledge_search_and_target_preflight_are_scoped(self):
        self.assertEqual(self.client.post("/v1/agency/clients", json={"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/identities", json={"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/connections", json={"id": "connection-a", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a", "displayName": "Page A", "connectionState": "connected", "scopes": []}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/bindings", json={"id": "binding-a", "brandId": "brand-a", "identityId": "identity-a", "connectionId": "connection-a", "targetExternalId": "page-a", "targetName": "Page A", "state": "connected"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/knowledge-items", json={"id": "knowledge-a", "clientId": "client-a", "brandId": "brand-a", "kind": "fact", "title": "Fact", "contentHash": "a" * 64, "provenance": "owner", "rightsState": "user_owned", "reviewState": "approved", "text": "Fact"}).status_code, 200)
        valid = self.client.post("/v1/agency/target-publications/preflight", json={"clientId": "client-a", "brandId": "brand-a", "bindingId": "binding-a", "identityVersionId": "identity-a", "variantId": "variant-a", "platform": "facebook", "kind": "text", "scheduledAt": "2999-01-01T00:00:00+00:00", "approvalState": "approved", "requiredScopes": []})
        self.assertEqual(valid.status_code, 200)
        self.assertTrue(valid.json()["ok"])
        search = self.client.get("/v1/agency/knowledge-items/search", params={"clientId": "client-a", "brandId": "brand-a", "q": "Fact"})
        self.assertEqual(search.status_code, 200)
        self.assertEqual(search.json()[0]["id"], "knowledge-a")

    def test_media_route_archives_without_provider_delete(self):
        self.assertEqual(self.client.post("/v1/agency/clients", json={"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/media-assets", json={"id": "asset-a", "clientId": "client-a", "brandId": "brand-a", "source": "drive", "providerFileId": "drive-a", "metadata": {"kind": "image"}}).status_code, 200)
        archived = self.client.post("/v1/agency/media-assets/asset-a/archive")
        self.assertEqual(archived.status_code, 200)
        self.assertEqual(archived.json(), {"id": "asset-a", "archiveState": "archived", "providerFileId": "drive-a"})

    def test_research_and_prompt_routes_require_explicit_scope_and_return_scalar_records(self):
        self.assertEqual(self.client.post("/v1/agency/clients", json={"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"}).status_code, 200)
        self.assertEqual(self.client.post("/v1/agency/brands", json={"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"}).status_code, 200)
        blueprint = {"id": "blueprint-a", "brandId": "brand-a", "kind": "copy", "template": "Write clearly", "version": 1, "status": "active"}
        self.assertEqual(self.client.post("/v1/agency/prompt-blueprints", json=blueprint).status_code, 200)
        self.assertEqual(self.client.get("/v1/agency/prompt-blueprints", params={"brandId": "brand-a"}).json()[0]["id"], "blueprint-a")
        evidence = {"id": "evidence-a", "clientId": "client-a", "brandId": "brand-a", "sourceUrl": "https://example.test", "sourceTitle": "Source", "retrievedAt": "2026-08-29T00:00:00.000Z", "summary": "Summary", "rightsState": "licensed", "reviewState": "pending"}
        self.assertEqual(self.client.post("/v1/agency/research-evidence", json=evidence).status_code, 200)
        self.assertEqual(self.client.get("/v1/agency/research-evidence", params={"clientId": "client-a", "brandId": "brand-a"}).json()[0]["id"], "evidence-a")

    def _create_research_approval_fixtures(self):
        for client_id in ("client-a", "client-b"):
            self.store.create_client({"id": client_id, "name": client_id, "timezone": "UTC", "status": "active"})
        for brand_id, client_id in (("brand-a", "client-a"), ("brand-a2", "client-a"), ("brand-b", "client-b")):
            self.store.create_brand({"id": brand_id, "clientId": client_id, "name": brand_id, "status": "active"})
        self.store.bind_brand_actor("brand-a", "manager-a", "owner", ["manage_brand"])
        self.store.bind_brand_actor("brand-a2", "manager-a2", "admin", ["manage_brand"])
        self.store.bind_brand_actor("brand-b", "manager-b", "owner", ["manage_brand"])
        self.store.bind_brand_actor("brand-a", "editor-a", "editor", [])

    def _create_research_evidence(self, evidence_id, brand_id="brand-a", client_id="client-a", rights_state="licensed", review_state="pending"):
        return self.store.create_research_evidence({"id": evidence_id, "clientId": client_id, "brandId": brand_id, "sourceUrl": "https://example.test/source", "sourceTitle": "Source", "retrievedAt": "2026-09-13T00:00:00.000Z", "summary": "Summary", "rightsState": rights_state, "reviewState": review_state})

    def _approve_research_evidence(self, evidence_id, brand_id, actor_user_id, role="owner", capability="manage_brand"):
        return self.client.post(f"/v1/agency/research-evidence/{evidence_id}/approve", json={"brandId": brand_id, "actor": {"actorUserId": actor_user_id, "role": role, "capability": capability}})

    def test_research_evidence_approval_uses_persisted_manager_binding_and_is_retry_safe(self):
        self._create_research_approval_fixtures()
        self._create_research_evidence("evidence-approved")
        self._create_research_evidence("evidence-denied")

        first = self._approve_research_evidence("evidence-approved", "brand-a", "manager-a", role="editor", capability="none")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["reviewState"], "approved")
        replay = self._approve_research_evidence("evidence-approved", "brand-a", "manager-a", role="editor", capability="none")
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json(), first.json())

        for actor_user_id in ("editor-a", "unbound-user"):
            denied = self._approve_research_evidence("evidence-denied", "brand-a", actor_user_id, role="owner", capability="manage_brand")
            self.assertEqual(denied.status_code, 403)
            self.assertEqual(denied.json()["detail"]["code"], "BRAND_MANAGE_FORBIDDEN")
        denied_record = next(item for item in self.store.list_research_evidence("client-a", "brand-a") if item["id"] == "evidence-denied")
        self.assertEqual(denied_record["reviewState"], "pending")

    def test_research_evidence_approval_enforces_brand_and_client_scope(self):
        self._create_research_approval_fixtures()
        self._create_research_evidence("evidence-brand-a")
        self._create_research_evidence("evidence-client-a", brand_id=None)
        self._create_research_evidence("evidence-client-a-cross", brand_id=None)

        wrong_brand = self._approve_research_evidence("evidence-brand-a", "brand-a2", "manager-a2")
        self.assertEqual(wrong_brand.status_code, 400)
        self.assertEqual(wrong_brand.json()["detail"]["code"], "RESEARCH_EVIDENCE_SCOPE_INVALID")

        same_client = self._approve_research_evidence("evidence-client-a", "brand-a2", "manager-a2")
        self.assertEqual(same_client.status_code, 200)
        self.assertEqual(same_client.json()["reviewState"], "approved")

        wrong_client = self._approve_research_evidence("evidence-client-a-cross", "brand-b", "manager-b")
        self.assertEqual(wrong_client.status_code, 400)
        self.assertEqual(wrong_client.json()["detail"]["code"], "RESEARCH_EVIDENCE_SCOPE_INVALID")

        missing = self._approve_research_evidence("evidence-missing", "brand-a", "manager-a")
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json()["detail"]["code"], "RESEARCH_EVIDENCE_MISSING")

    def test_research_evidence_approval_rejects_invalid_rights_and_review_state(self):
        self._create_research_approval_fixtures()
        self._create_research_evidence("evidence-invalid-rights")
        self._create_research_evidence("evidence-invalid-state")
        self.store.connection.execute("UPDATE research_evidence SET rights_state = 'public' WHERE id = 'evidence-invalid-rights'")
        self.store.connection.execute("UPDATE research_evidence SET review_state = 'rejected' WHERE id = 'evidence-invalid-state'")
        self.store.connection.commit()

        invalid_rights = self._approve_research_evidence("evidence-invalid-rights", "brand-a", "manager-a")
        self.assertEqual(invalid_rights.status_code, 400)
        self.assertEqual(invalid_rights.json()["detail"]["code"], "RIGHTS_OR_REVIEW_BLOCKED")
        invalid_state = self._approve_research_evidence("evidence-invalid-state", "brand-a", "manager-a")
        self.assertEqual(invalid_state.status_code, 400)
        self.assertEqual(invalid_state.json()["detail"]["code"], "RESEARCH_REVIEW_STATE_INVALID")

    def test_generic_research_evidence_patch_cannot_approve(self):
        self._create_research_approval_fixtures()
        self._create_research_evidence("evidence-pending")

        response = self.client.patch("/v1/agency/research-evidence/evidence-pending", json={"reviewState": "approved"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "ENTITY_UPDATE_INVALID")
        pending = next(item for item in self.store.list_research_evidence("client-a", "brand-a") if item["id"] == "evidence-pending")
        self.assertEqual(pending["reviewState"], "pending")

    def test_generic_research_evidence_create_cannot_create_approved_record(self):
        self._create_research_approval_fixtures()
        payload = {"id": "evidence-forged-approved", "clientId": "client-a", "brandId": "brand-a", "sourceUrl": "https://example.test/source", "sourceTitle": "Source", "retrievedAt": "2026-09-13T00:00:00.000Z", "summary": "Summary", "rightsState": "licensed", "reviewState": "approved"}

        response = self.client.post("/v1/agency/research-evidence", json=payload)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "RIGHTS_OR_REVIEW_BLOCKED")
        listed = self.client.get("/v1/agency/research-evidence", params={"clientId": "client-a", "brandId": "brand-a"})
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json(), [])

    def test_brand_impact_route_returns_typed_read_only_exact_brand_snapshot(self):
        self.store.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
        self.store.create_brand({"id": "brand-impact", "clientId": "client-a", "name": "Impact Brand", "status": "active"})
        before = self.store.connection.execute("SELECT status, deleted_at FROM brands WHERE id = ?", ("brand-impact",)).fetchone()

        response = self.client.get("/v1/agency/brands/brand-impact/impact", params={"clientId": "client-forged"})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["clientId"], "client-a")
        self.assertEqual(body["brandId"], "brand-impact")
        self.assertEqual(body["brandName"], "Impact Brand")
        self.assertEqual(body["brandStatus"], "active")
        self.assertIsNone(body["deletedAt"])
        self.assertEqual(body["counts"], {"draftCount": 0, "planCount": 0, "unsentScheduleCount": 0, "sharedMediaCount": 0})
        self.assertEqual(body["blockers"], [])
        self.assertRegex(body["revision"], r"^[a-f0-9]{64}$")
        self.assertRegex(body["observedAt"], r"^20\d{2}-\d{2}-\d{2}T.*Z$")
        self.assertEqual(set(body), {"clientId", "brandId", "brandName", "brandStatus", "deletedAt", "counts", "blockers", "observedAt", "revision", "identity"})
        after = self.store.connection.execute("SELECT status, deleted_at FROM brands WHERE id = ?", ("brand-impact",)).fetchone()
        self.assertEqual(tuple(before), tuple(after))

    def test_brand_impact_route_maps_missing_brand_to_safe_error_shape(self):
        response = self.client.get("/v1/agency/brands/brand-missing/impact")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": {"code": "BRAND_MISSING", "message": "Agency operation was rejected by the Control Plane."}})


class PublicationCommandApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "control-plane.sqlite3"
        self.worker_db_path = Path(self.temp_dir.name) / "worker.sqlite3"
        self.store = AgencyStateStore(self.db_path)
        self.previous_store = getattr(service, "agency_state_store", None)
        service.agency_state_store = self.store
        self.client = TestClient(service.app)
        self.store.create_client({"id": "client-a", "name": "Client A", "timezone": "UTC", "status": "active"})
        self.store.create_brand({"id": "brand-a", "clientId": "client-a", "name": "Brand A", "status": "active"})
        self.store.create_identity({"id": "identity-a", "brandId": "brand-a", "name": "Default", "isDefault": True, "version": 1, "status": "active"})
        self.store.create_connection({"id": "connection-a", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a", "displayName": "Page A", "connectionState": "connected", "scopes": []})
        self.store.create_connection({"id": "connection-b", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-b", "displayName": "Page B", "connectionState": "connected", "scopes": []})
        for binding_id, connection_id, page_id in (("binding-a", "connection-a", "page-a"), ("binding-b", "connection-b", "page-b")):
            self.store.create_binding({"id": binding_id, "brandId": "brand-a", "identityId": "identity-a", "connectionId": connection_id, "targetExternalId": page_id, "targetName": page_id, "state": "connected"})
        self.store.create_automation_plan({"id": "plan-a", "brandId": "brand-a", "state": "active", "bindingIds": ["binding-a", "binding-b"], "payload": {"id": "plan-a", "cron": {"enabled": True, "timezone": "UTC"}, "timezone": "UTC", "campaignStartAt": "2000-01-01T00:00:00Z", "campaignEndAt": "2100-01-31T23:59:00Z", "targetPageIds": ["page-a", "page-b"], "pagePlans": {"page-a": {"facebook": {"enabled": True, "runDays": [1, 2, 3, 4, 5, 6, 7], "publishTimes": ["09:00"]}}, "page-b": {"facebook": {"enabled": True, "runDays": [1, 2, 3, 4, 5, 6, 7], "publishTimes": ["09:00"]}}}}})
        self.worker_store = SQLiteJobStore(self.worker_db_path)
        self.executor_calls = []
        self.worker_client = TestClient(create_worker_app(self.worker_store, lambda payload: self.executor_calls.append(payload) or "recorded-provider-id", run_background=False))

    def tearDown(self):
        recovery_thread = getattr(service, "_outbox_recovery_thread", None)
        if recovery_thread and recovery_thread.is_alive():
            recovery_thread.join(timeout=1)
        service.agency_state_store = self.previous_store
        self.store.close()
        self.temp_dir.cleanup()

    def publication_payload(self, publication_id, job_id, binding_id="binding-a", page_id="page-a", scheduled_at="2099-01-05T09:00:00Z"):
        idempotency_key = f"key-{job_id}"
        return {
            "id": publication_id,
            "clientId": "client-a",
            "brandId": "brand-a",
            "bindingId": binding_id,
            "variantId": f"variant-{job_id}",
            "idempotencyKey": idempotency_key,
            "approvalState": "approved",
            "requestId": f"approve-{publication_id}",
            "identityVersionId": "identity-a",
            "platform": "facebook",
            "kind": "text",
            "requiredScopes": [],
            "mediaRequired": False,
            "mediaEligible": True,
            "simulation": False,
            "planId": "plan-a",
            "scheduledAt": scheduled_at,
            "workerJob": {
                "jobId": job_id,
                "idempotencyKey": idempotency_key,
                "scheduledAt": scheduled_at,
                "payload": {"simulation": False, "approval_state": "approved", "workspace_id": "client-a", "client_id": "client-a", "brand_id": "brand-a", "binding_id": binding_id, "identity_version_id": "identity-a", "page_id": page_id, "plan_id": "plan-a", "target_publication_id": publication_id, "platform": "facebook", "kind": "text", "message": "Approved", "idempotency_key": idempotency_key, "required_scopes": []},
            },
        }

    def worker_dispatch(self, command):
        if command["action"] == "approve":
            worker_job = command["workerJob"]
            response = self.worker_client.post("/v1/jobs", json={"job_id": worker_job["jobId"], "idempotency_key": worker_job["idempotencyKey"], "scheduled_at": worker_job["scheduledAtSeconds"], "payload": worker_job["payload"]})
        else:
            body = {"action": command["action"], "request_id": command["requestId"], "expected_revision": command["workerRevision"]}
            if command.get("scheduledAtSeconds") is not None:
                body["scheduled_at"] = command["scheduledAtSeconds"]
            response = self.worker_client.post(f"/v1/jobs/{command['workerJobId']}/action", json=body)
        if response.status_code >= 400:
            detail = response.json().get("detail", {})
            raise service.WorkerCommandRejected(str(detail.get("code", "WORKER_COMMAND_REJECTED")))
        result = response.json()
        if command["action"] == "approve":
            return {"id": result["jobId"], "state": result["state"], "revision": result.get("revision", 0), "scheduled_at": result["scheduled_at"], "provider_job_id": result.get("provider_job_id")}
        return result

    def test_approval_outbox_recovers_after_control_plane_restart(self):
        payload = self.publication_payload("publication-restart", "job-restart")
        calls = []

        def crash_before_enqueue(command):
            calls.append(command["requestId"])
            if len(calls) == 1:
                raise TimeoutError("simulated crash before worker enqueue")
            return self.worker_dispatch(command)

        with patch.object(service, "dispatch_worker_command", side_effect=crash_before_enqueue, create=True):
            pending = self.client.post("/v1/agency/target-publications/approve", json=payload)
            self.assertEqual(pending.status_code, 200)
            self.assertEqual(pending.json()["commandStatus"], "pending")
            self.assertEqual(self.worker_store.list_jobs(), [])
            self.client.get("/health")
            self.assertEqual(len(calls), 1)
            self.assertEqual(self.store.list_target_publications("client-a", "brand-a")[0]["state"], "approval_pending")

            self.store.close()
            self.store = AgencyStateStore(self.db_path)
            service.agency_state_store = self.store
            with TestClient(service.app) as restarted_client:
                recovered = restarted_client.get("/health")

        self.assertEqual(recovered.status_code, 200)
        publication = next(item for item in self.store.list_target_publications("client-a", "brand-a") if item["id"] == "publication-restart")
        self.assertEqual(publication["state"], "scheduled")
        self.assertEqual(publication["planId"], "plan-a")
        self.assertEqual(publication["workerJobId"], "job-restart")
        self.assertEqual([job["id"] for job in self.worker_store.list_jobs()], ["job-restart"])
        self.assertEqual(self.worker_store.list_jobs(include_payload=True)[0]["payload"]["plan_id"], "plan-a")
        self.assertEqual(calls[0], calls[1])

    def test_approval_readback_returns_scoped_content_run_association(self):
        content_run_id = "run-provider-evidence"
        payload = self.publication_payload("publication-content-run", "job-content-run")
        payload["contentRunId"] = content_run_id
        payload["workerJob"]["payload"]["content_run_id"] = content_run_id
        payload["workerJob"]["payload"]["variant_id"] = payload["variantId"]
        self.store.create_content_run({"id": content_run_id, "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "llm_provider", "state": "needs_review", "variants": [{"id": payload["variantId"]}]})

        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True):
            approved = self.client.post("/v1/agency/target-publications/approve", json=payload)

        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.json()["state"], "scheduled")
        self.assertEqual(approved.json().get("contentRunId"), content_run_id)
        listed = self.client.get("/v1/agency/target-publications", params={"clientId": "client-a", "brandId": "brand-a"})
        self.assertEqual(listed.status_code, 200)
        publication = next(item for item in listed.json() if item["id"] == "publication-content-run")
        self.assertEqual(publication.get("contentRunId"), content_run_id)

    def test_approval_rejects_variant_missing_from_empty_content_run_before_generation(self):
        content_run_id = "run-empty-variants"
        self.store.create_content_run({"id": content_run_id, "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "llm_provider", "state": "needs_review", "variants": []})
        payload = self.publication_payload("publication-empty-variants", "job-empty-variants")
        payload["contentRunId"] = content_run_id
        payload["workerJob"]["payload"]["content_run_id"] = content_run_id
        payload["workerJob"]["payload"]["variant_id"] = payload["variantId"]

        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True) as dispatch:
            response = self.client.post("/v1/agency/target-publications/approve", json=payload)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "TARGET_PUBLICATION_VARIANT_NOT_IN_CONTENT_RUN")
        dispatch.assert_not_called()
        self.assertEqual(self.worker_store.list_jobs(), [])
        self.assertEqual(self.store.list_target_publications("client-a", "brand-a"), [])
        self.assertEqual(self.store.connection.execute("SELECT request_id FROM publication_commands").fetchall(), [])

    def test_approval_rejects_worker_content_run_id_mismatch_before_dispatch(self):
        content_run_id = "run-content-run-mismatch"
        self.store.create_content_run({"id": content_run_id, "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "llm_provider", "state": "needs_review"})
        payload = self.publication_payload("publication-content-run-mismatch", "job-content-run-mismatch")
        payload["contentRunId"] = content_run_id
        payload["workerJob"]["payload"]["content_run_id"] = "run-another-content"

        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True) as dispatch:
            response = self.client.post("/v1/agency/target-publications/approve", json=payload)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "TARGET_PUBLICATION_WORKER_CONTENT_RUN_MISMATCH")
        dispatch.assert_not_called()
        self.assertEqual(self.worker_store.list_jobs(), [])
        self.assertEqual(self.store.list_target_publications("client-a", "brand-a"), [])

    def test_approval_rejects_worker_variant_id_mismatch_before_dispatch(self):
        content_run_id = "run-worker-variant-mismatch"
        self.store.create_content_run({"id": content_run_id, "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "llm_provider", "state": "needs_review"})
        payload = self.publication_payload("publication-worker-variant-mismatch", "job-worker-variant-mismatch")
        payload["contentRunId"] = content_run_id
        payload["workerJob"]["payload"]["content_run_id"] = content_run_id
        payload["workerJob"]["payload"]["variant_id"] = "variant-not-selected"

        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True) as dispatch:
            response = self.client.post("/v1/agency/target-publications/approve", json=payload)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "TARGET_PUBLICATION_WORKER_VARIANT_MISMATCH")
        dispatch.assert_not_called()
        self.assertEqual(self.worker_store.list_jobs(), [])
        self.assertEqual(self.store.list_target_publications("client-a", "brand-a"), [])

    def test_approval_rejects_variant_missing_from_nonempty_content_run_variants(self):
        content_run_id = "run-variant-membership"
        self.store.create_content_run({"id": content_run_id, "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "llm_provider", "state": "needs_review", "variants": [{"id": "variant-allowed"}]})
        payload = self.publication_payload("publication-variant-membership", "job-variant-membership")
        payload["contentRunId"] = content_run_id
        payload["workerJob"]["payload"]["content_run_id"] = content_run_id
        payload["workerJob"]["payload"]["variant_id"] = payload["variantId"]

        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True) as dispatch:
            response = self.client.post("/v1/agency/target-publications/approve", json=payload)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "TARGET_PUBLICATION_VARIANT_NOT_IN_CONTENT_RUN")
        dispatch.assert_not_called()
        self.assertEqual(self.worker_store.list_jobs(), [])
        self.assertEqual(self.store.list_target_publications("client-a", "brand-a"), [])

    def test_publish_now_advances_only_the_selected_approved_target_and_cancel_releases_slot(self):
        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True):
            first = self.client.post("/v1/agency/target-publications/approve", json=self.publication_payload("publication-a", "job-a"))
            second = self.client.post("/v1/agency/target-publications/approve", json=self.publication_payload("publication-b", "job-b", "binding-b", "page-b"))
            self.assertEqual(first.json()["commandStatus"], "acknowledged")
            self.assertEqual(second.json()["commandStatus"], "acknowledged")

            published_now = self.client.post("/v1/agency/target-publications/publication-a/commands", json={"action": "publish_now", "clientId": "client-a", "brandId": "brand-a", "expectedRevision": first.json()["revision"], "requestId": "request-now-a"})
            self.assertEqual(published_now.status_code, 200)
            jobs = {job["id"]: job for job in self.worker_store.list_jobs()}
            self.assertLessEqual(jobs["job-a"]["scheduled_at"], time.time())
            self.assertGreater(jobs["job-b"]["scheduled_at"], time.time())

            current = self.store.list_target_publications("client-a", "brand-a")
            first_record = next(item for item in current if item["id"] == "publication-a")
            canceled = self.client.post("/v1/agency/target-publications/publication-a/commands", json={"action": "cancel", "clientId": "client-a", "brandId": "brand-a", "expectedRevision": first_record["revision"], "requestId": "request-cancel-a"})
            self.assertEqual(canceled.status_code, 200)
            self.assertEqual(canceled.json()["state"], "canceled")
            self.assertEqual(canceled.json()["commandStatus"], "acknowledged")

    def test_legacy_reconcile_and_reschedule_routes_cannot_mutate_target_or_worker_state(self):
        payload = self.publication_payload("publication-legacy-routes", "job-legacy-routes")
        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True):
            approved = self.client.post("/v1/agency/target-publications/approve", json=payload)
            self.assertEqual(approved.json()["commandStatus"], "acknowledged")
            old_slot = approved.json()["scheduledAt"]
            old_worker_slot = self.worker_store.list_jobs()[0]["scheduled_at"]
            rejected_reschedule = self.client.post("/v1/agency/target-publications/publication-legacy-routes/reschedule", json={"scheduledAt": "2099-01-06T09:00:00Z"})
            rejected_reconcile = self.client.post("/v1/agency/target-publications/publication-legacy-routes/reconcile", json={"state": "canceled"})

        self.assertEqual(rejected_reschedule.status_code, 404)
        self.assertEqual(rejected_reconcile.status_code, 404)
        publication = self.store.list_target_publications("client-a", "brand-a")[0]
        self.assertEqual(publication["scheduledAt"], old_slot)
        self.assertEqual(publication["state"], "scheduled")
        self.assertEqual(self.worker_store.list_jobs()[0]["scheduled_at"], old_worker_slot)

    def test_generic_target_publication_patch_cannot_forge_provider_lifecycle_state(self):
        payload = self.publication_payload("publication-generic-patch", "job-generic-patch")
        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True):
            approved = self.client.post("/v1/agency/target-publications/approve", json=payload)

        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.json()["state"], "scheduled")
        before = self.store.list_target_publications("client-a", "brand-a")[0]
        response = self.client.patch(
            "/v1/agency/target-publications/publication-generic-patch",
            json={"state": "published", "providerJobId": "forged-provider-id"},
        )
        deleted = self.client.delete("/v1/agency/target-publications/publication-generic-patch")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["code"], "TARGET_PUBLICATION_COMMAND_REQUIRED")
        self.assertEqual(deleted.status_code, 409)
        self.assertEqual(deleted.json()["detail"]["code"], "TARGET_PUBLICATION_COMMAND_REQUIRED")
        after = self.store.list_target_publications("client-a", "brand-a")[0]
        self.assertEqual(after["state"], before["state"])
        self.assertEqual(after["providerJobId"], before["providerJobId"])

    def test_reschedule_api_keeps_prior_cp_slot_when_worker_ack_reports_the_old_slot(self):
        payload = self.publication_payload("publication-stale-reschedule-ack", "job-stale-reschedule-ack")
        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True):
            approved = self.client.post("/v1/agency/target-publications/approve", json=payload)
        self.assertEqual(approved.json()["commandStatus"], "acknowledged")
        prior_slot = approved.json()["scheduledAt"]
        prior_worker_slot = self.worker_store.list_jobs()[0]["scheduled_at"]
        requested_slot = "2099-01-06T09:00:00Z"

        def report_old_worker_slot(command):
            response = self.worker_dispatch(command)
            response["scheduled_at"] = prior_worker_slot
            return response

        with patch.object(service, "dispatch_worker_command", side_effect=report_old_worker_slot, create=True):
            result = self.client.post(
                "/v1/agency/target-publications/publication-stale-reschedule-ack/commands",
                json={"action": "reschedule", "clientId": "client-a", "brandId": "brand-a", "expectedRevision": 0, "requestId": "reschedule-stale-ack", "scheduledAt": requested_slot},
            )

        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["commandStatus"], "pending")
        self.assertEqual(result.json()["state"], "scheduled")
        self.assertEqual(result.json()["scheduledAt"], prior_slot)
        self.assertEqual(result.json()["pendingCommandId"], "reschedule-stale-ack")
        self.assertEqual(self.worker_store.list_jobs()[0]["scheduled_at"], datetime.fromisoformat(requested_slot.replace("Z", "+00:00")).timestamp())

    def test_startup_retries_pending_command_when_worker_becomes_ready_later(self):
        payload = self.publication_payload("publication-late-worker", "job-late-worker")
        worker_ready = {"value": False}
        startup_attempted = threading.Event()
        calls = []

        def dispatch(command):
            calls.append(command["requestId"])
            if len(calls) == 1:
                raise TimeoutError("worker has not started")
            startup_attempted.set()
            if not worker_ready["value"]:
                raise TimeoutError("worker is still starting")
            return self.worker_dispatch(command)

        with patch.object(service, "dispatch_worker_command", side_effect=dispatch, create=True), patch.object(service, "OUTBOX_RECOVERY_DELAY_SECONDS", 0.01):
            pending = self.client.post("/v1/agency/target-publications/approve", json=payload)
            self.assertEqual(pending.json()["commandStatus"], "pending")
            self.store.close()
            self.store = AgencyStateStore(self.db_path)
            service.agency_state_store = self.store
            with TestClient(service.app):
                self.assertTrue(startup_attempted.wait(timeout=1))
                self.assertEqual(self.store.list_target_publications("client-a", "brand-a")[0]["state"], "approval_pending")
                worker_ready["value"] = True
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline and self.store.list_target_publications("client-a", "brand-a")[0]["state"] != "scheduled":
                    time.sleep(0.01)

        publication = self.store.list_target_publications("client-a", "brand-a")[0]
        self.assertEqual(publication["state"], "scheduled")
        self.assertEqual(self.worker_store.list_jobs()[0]["id"], "job-late-worker")
        self.assertGreaterEqual(len(calls), 3)

    def test_approval_replays_after_worker_accepts_but_control_plane_ack_is_lost(self):
        payload = self.publication_payload("publication-ack-lost", "job-ack-lost")
        calls = []

        def lose_first_ack(command):
            result = self.worker_dispatch(command)
            calls.append(command["requestId"])
            if len(calls) == 1:
                raise TimeoutError("Control Plane crashed after worker enqueue")
            return result

        with patch.object(service, "dispatch_worker_command", side_effect=lose_first_ack, create=True):
            pending = self.client.post("/v1/agency/target-publications/approve", json=payload)
            self.assertEqual(pending.json()["commandStatus"], "pending")
            self.assertEqual([job["id"] for job in self.worker_store.list_jobs()], ["job-ack-lost"])
            self.store.close()
            self.store = AgencyStateStore(self.db_path)
            service.agency_state_store = self.store
            with TestClient(service.app):
                deadline = time.monotonic() + 1
                while time.monotonic() < deadline and self.store.list_target_publications("client-a", "brand-a")[0]["state"] != "scheduled":
                    time.sleep(0.01)

        self.assertEqual(calls[0], calls[1])
        self.assertEqual([job["id"] for job in self.worker_store.list_jobs()], ["job-ack-lost"])
        self.assertEqual(self.executor_calls, [])

    def test_approval_replay_never_relabels_existing_completed_canceled_or_unknown_job_as_scheduled(self):
        states = (("completed", "09:00", "provider-completed"), ("completed-without-evidence", "10:00", None), ("canceled", "11:00", None), ("failed", "12:00", None), ("running", "13:00", None), ("unknown", "14:00", None), ("queued-revision", "15:00", None), ("queued-mismatched-slot", "16:00", None))
        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True):
            for existing_state, hour, provider_job_id in states:
                with self.subTest(existing_state=existing_state):
                    scheduled_at = f"2099-01-05T{hour}:00Z"
                    job_id = f"job-existing-{existing_state}"
                    payload = self.publication_payload(f"publication-existing-{existing_state}", job_id, scheduled_at=scheduled_at)
                    scheduled_seconds = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00")).timestamp()
                    worker_schedule = scheduled_seconds + 3600 if existing_state == "queued-mismatched-slot" else scheduled_seconds
                    self.worker_store.enqueue(job_id, payload["idempotencyKey"], worker_schedule, payload["workerJob"]["payload"])
                    if existing_state == "completed":
                        self.worker_store.claim_due(scheduled_seconds)
                        self.worker_store.complete(job_id, provider_job_id, now=scheduled_seconds)
                    elif existing_state == "completed-without-evidence":
                        self.worker_store.claim_due(scheduled_seconds)
                        self.worker_store.complete(job_id, None, now=scheduled_seconds)
                    elif existing_state == "canceled":
                        self.worker_store.mutate(job_id, "cancel", f"cancel-{job_id}", expected_revision=0, now=0)
                    elif existing_state in {"running", "unknown"}:
                        self.worker_store.claim_due(scheduled_seconds)
                        if existing_state == "unknown":
                            self.worker_store.recover_running_jobs(scheduled_seconds + 1)
                    elif existing_state == "failed":
                        self.worker_store.fail(job_id, "recorded permanent failure", now=scheduled_seconds)
                    elif existing_state == "queued-revision":
                        self.worker_store.mutate(job_id, "reschedule", f"reschedule-{job_id}", scheduled_seconds, expected_revision=0, now=0)

                    response = self.client.post("/v1/agency/target-publications/approve", json=payload)
                    self.assertEqual(response.status_code, 200)
                    publication = next(item for item in self.store.list_target_publications("client-a", "brand-a") if item["id"] == payload["id"])
                    if existing_state == "completed":
                        self.assertEqual(publication["state"], "published")
                        self.assertEqual(publication["providerJobId"], provider_job_id)
                        self.assertEqual(response.json()["commandStatus"], "acknowledged")
                    elif existing_state == "canceled":
                        self.assertEqual(publication["state"], "approval_failed")
                        self.assertEqual(response.json()["commandStatus"], "failed")
                    elif existing_state == "failed":
                        self.assertEqual(publication["state"], "approval_failed")
                        self.assertEqual(response.json()["commandStatus"], "failed")
                    else:
                        self.assertNotEqual(publication["state"], "scheduled")
                        self.assertEqual(publication["state"], "reconciliation_required")
                        self.assertEqual(publication["workerAckState"], "reconciliation_required")
                        self.assertEqual(response.json()["commandStatus"], "pending")
        self.assertEqual(self.executor_calls, [])

    def test_approval_replay_after_cancel_keeps_worker_canceled(self):
        payload = self.publication_payload("publication-canceled-replay", "job-canceled-replay")
        dispatches = []

        def record_dispatch(command):
            dispatches.append((command["action"], command["requestId"]))
            return self.worker_dispatch(command)

        with patch.object(service, "dispatch_worker_command", side_effect=record_dispatch, create=True):
            approved = self.client.post("/v1/agency/target-publications/approve", json=payload)
            canceled = self.client.post("/v1/agency/target-publications/publication-canceled-replay/commands", json={"action": "cancel", "clientId": "client-a", "brandId": "brand-a", "expectedRevision": 0, "requestId": "cancel-replay-target"})
            replay = self.client.post("/v1/agency/target-publications/approve", json=payload)

        self.assertEqual(approved.json()["commandStatus"], "acknowledged")
        self.assertEqual(canceled.json()["state"], "canceled")
        self.assertEqual(replay.json()["commandStatus"], "acknowledged")
        self.assertEqual(replay.json()["state"], "canceled")
        self.assertEqual(dispatches, [("approve", "approve-publication-canceled-replay"), ("cancel", "cancel-replay-target")])
        restarted_worker = TestClient(create_worker_app(SQLiteJobStore(self.worker_db_path), lambda payload: self.executor_calls.append(payload) or "unexpected-provider-id", run_background=False))
        self.assertEqual(restarted_worker.post("/v1/run-once", json={"now": 5_000_000_000.0}).json()["completed"], 0)
        self.assertEqual(self.worker_store.list_jobs()[0]["state"], "canceled")
        self.assertEqual(self.executor_calls, [])

    def test_approval_idempotency_key_for_another_worker_job_is_terminal_conflict(self):
        payload = self.publication_payload("publication-idempotency-conflict", "job-new-request")
        schedule_seconds = datetime.fromisoformat(payload["scheduledAt"].replace("Z", "+00:00")).timestamp()
        self.worker_store.enqueue("job-existing-request", payload["idempotencyKey"], schedule_seconds, payload["workerJob"]["payload"])

        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True):
            response = self.client.post("/v1/agency/target-publications/approve", json=payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["commandStatus"], "failed")
        self.assertEqual(response.json()["commandError"], "WORKER_JOB_IDEMPOTENCY_CONFLICT")
        publication = self.store.list_target_publications("client-a", "brand-a")[0]
        self.assertEqual(publication["state"], "approval_failed")
        self.assertEqual(self.worker_store.list_jobs()[0]["id"], "job-existing-request")
        self.assertEqual(self.worker_store.list_jobs()[0]["state"], "queued")
        self.assertEqual(self.executor_calls, [])

    def test_saved_two_target_intents_replay_only_missing_target_after_restart(self):
        intent_a = self.publication_payload("publication-replay-page-a", "job-replay-page-a", "binding-a", "page-a")
        intent_b = self.publication_payload("publication-replay-page-b", "job-replay-page-b", "binding-b", "page-b")
        run_id = "content-run-replay-fanout"
        self.store.create_content_run({"id": run_id, "clientId": "client-a", "brandId": "brand-a", "identityVersionId": "identity-a", "executionMode": "llm_provider", "planId": "plan-a", "targetApprovalState": "pending", "targetApprovalIntents": [intent_a, intent_b], "state": "needs_review"})
        dispatches = []

        def record_dispatch(command):
            dispatches.append((command["action"], command["requestId"], command.get("workerJobId")))
            return self.worker_dispatch(command)

        with patch.object(service, "dispatch_worker_command", side_effect=record_dispatch, create=True):
            first = self.client.post("/v1/agency/target-publications/approve", json=intent_a)
            self.assertEqual(first.json()["commandStatus"], "acknowledged")
            self.assertEqual([job["id"] for job in self.worker_store.list_jobs()], ["job-replay-page-a"])
            self.assertEqual(self.store.list_entity("content_runs", run_id)[0]["state"], "needs_review")

            self.store.close()
            self.store = AgencyStateStore(self.db_path)
            service.agency_state_store = self.store
            saved_run = self.store.list_entity("content_runs", run_id)[0]
            saved_intents = saved_run["targetApprovalIntents"]
            self.assertEqual(saved_run["targetApprovalState"], "pending")
            self.assertEqual([item["requestId"] for item in saved_intents], ["approve-publication-replay-page-a", "approve-publication-replay-page-b"])

            replay_a = self.client.post("/v1/agency/target-publications/approve", json=saved_intents[0])
            self.assertEqual(replay_a.json()["commandStatus"], "acknowledged")
            self.assertEqual(replay_a.json()["state"], "scheduled")
            self.assertEqual(self.store.list_entity("content_runs", run_id)[0]["state"], "needs_review")
            replay_b = self.client.post("/v1/agency/target-publications/approve", json=saved_intents[1])
            self.assertEqual(replay_b.json()["commandStatus"], "acknowledged")
            self.assertEqual(replay_b.json()["state"], "scheduled")
            self.assertEqual(len(self.store.list_target_publications("client-a", "brand-a")), 2)
            self.assertEqual(self.store.update_content_run_payload(run_id, {"state": "scheduled", "approvalState": "approved", "targetApprovalState": "acknowledged"})["state"], "scheduled")

        self.assertEqual(dispatches, [("approve", intent_a["requestId"], "job-replay-page-a"), ("approve", intent_b["requestId"], "job-replay-page-b")])
        jobs = {job["id"]: job for job in self.worker_store.list_jobs()}
        self.assertEqual(set(jobs), {"job-replay-page-a", "job-replay-page-b"})
        self.assertEqual(jobs["job-replay-page-a"]["revision"], 0)
        self.assertEqual(self.executor_calls, [])

    def test_reschedule_replays_after_worker_ack_is_lost_and_keeps_cp_slot_pending(self):
        first_calls = []

        def lose_first_reschedule_ack(command):
            response = self.worker_dispatch(command)
            if command["action"] == "reschedule":
                first_calls.append(command["requestId"])
                if len(first_calls) == 1:
                    raise TimeoutError("Control Plane lost the reschedule acknowledgement")
            return response

        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True):
            approved = self.client.post("/v1/agency/target-publications/approve", json=self.publication_payload("publication-reschedule-retry", "job-reschedule-retry"))
            self.assertEqual(approved.json()["commandStatus"], "acknowledged")
        original_slot = approved.json()["scheduledAt"]
        new_slot = "2099-01-06T09:00:00Z"
        payload = {"action": "reschedule", "clientId": "client-a", "brandId": "brand-a", "expectedRevision": 0, "requestId": "reschedule-ack-lost", "scheduledAt": new_slot}
        with patch.object(service, "dispatch_worker_command", side_effect=lose_first_reschedule_ack, create=True):
            pending = self.client.post("/v1/agency/target-publications/publication-reschedule-retry/commands", json=payload)
            self.assertEqual(pending.json()["commandStatus"], "pending")
            self.assertEqual(pending.json()["scheduledAt"], original_slot)
            self.assertEqual(self.worker_store.list_jobs()[0]["scheduled_at"], datetime.fromisoformat(new_slot.replace("Z", "+00:00")).timestamp())
            self.store.close()
            self.store = AgencyStateStore(self.db_path)
            service.agency_state_store = self.store
            with TestClient(service.app):
                deadline = time.monotonic() + 1
                while time.monotonic() < deadline and self.store.list_target_publications("client-a", "brand-a")[0]["revision"] == 0:
                    time.sleep(0.01)

        self.assertEqual(first_calls, ["reschedule-ack-lost", "reschedule-ack-lost"])
        current = self.store.list_target_publications("client-a", "brand-a")[0]
        self.assertEqual(current["scheduledAt"], "2099-01-06T09:00:00.000Z")
        self.assertEqual(current["revision"], 1)

    def test_simulation_publications_reschedule_and_cancel_at_control_plane_without_worker(self):
        payload = self.publication_payload("publication-simulation", "job-simulation")
        payload["simulation"] = True
        payload.pop("workerJob")
        with patch.object(service, "dispatch_worker_command", side_effect=lambda _command: self.fail("simulation must not call the worker"), create=True):
            rejected = self.client.post("/v1/agency/target-publications/approve", json=payload)
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(rejected.json()["detail"]["code"], "TARGET_PUBLICATION_SIMULATION_REMOVED")
        self.assertEqual(self.worker_store.list_jobs(), [])
        self.assertEqual(self.executor_calls, [])
        self.assertEqual(self.client.get("/v1/agency/target-publications", params={"clientId": "client-a", "brandId": "brand-a"}).json(), [])

    def test_failed_reschedule_conflict_preserves_prior_publication_and_worker_slots(self):
        self.store.create_connection({"id": "connection-a2", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a-2", "displayName": "Page A mirror", "connectionState": "connected", "scopes": []})
        self.store.create_binding({"id": "binding-a2", "brandId": "brand-a", "identityId": "identity-a", "connectionId": "connection-a2", "targetExternalId": "page-a", "targetName": "Page A mirror", "state": "connected"})
        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True):
            first = self.client.post("/v1/agency/target-publications/approve", json=self.publication_payload("publication-reschedule-a", "job-reschedule-a", scheduled_at="2099-01-05T09:00:00Z"))
            second = self.client.post("/v1/agency/target-publications/approve", json=self.publication_payload("publication-reschedule-b", "job-reschedule-b", binding_id="binding-a2", scheduled_at="2099-01-06T09:00:00Z"))
            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            conflict = self.client.post("/v1/agency/target-publications/publication-reschedule-a/commands", json={"action": "reschedule", "clientId": "client-a", "brandId": "brand-a", "expectedRevision": first.json()["revision"], "requestId": "reschedule-conflict", "scheduledAt": "2099-01-06T09:00:00Z"})
            self.assertEqual(conflict.status_code, 409)
            publications = self.store.list_target_publications("client-a", "brand-a")
            self.assertEqual(next(item for item in publications if item["id"] == "publication-reschedule-a")["scheduledAt"], "2099-01-05T09:00:00.000Z")
            self.assertEqual(next(job for job in self.worker_store.list_jobs() if job["id"] == "job-reschedule-a")["scheduled_at"], 4071286800.0)

    def test_approval_rejects_campaign_window_and_run_day_before_persisting_or_enqueuing(self):
        with patch.object(service, "dispatch_worker_command", side_effect=self.worker_dispatch, create=True):
            out_of_window = self.publication_payload("publication-out-of-window", "job-out-of-window", scheduled_at="2101-01-05T09:00:00Z")
            rejected_window = self.client.post("/v1/agency/target-publications/approve", json=out_of_window)
            self.assertEqual(rejected_window.status_code, 400)
            self.assertEqual(rejected_window.json()["detail"]["code"], "PLAN_CAMPAIGN_WINDOW_INVALID")

            self.store.create_automation_plan({"id": "plan-monday", "brandId": "brand-a", "state": "active", "bindingIds": ["binding-a"], "payload": {"id": "plan-monday", "cron": {"timezone": "UTC"}, "campaignStartAt": "2000-01-01T00:00:00Z", "campaignEndAt": "2100-01-01T00:00:00Z", "targetPageIds": ["page-a"], "pagePlans": {"page-a": {"facebook": {"enabled": True, "runDays": [1], "publishTimes": ["09:00"]}}}}})
            off_day = self.publication_payload("publication-off-day", "job-off-day", scheduled_at="2099-01-04T09:00:00Z")
            off_day["planId"] = "plan-monday"
            off_day["workerJob"]["payload"]["plan_id"] = "plan-monday"
            rejected_day = self.client.post("/v1/agency/target-publications/approve", json=off_day)
            self.assertEqual(rejected_day.status_code, 400)
            self.assertEqual(rejected_day.json()["detail"]["code"], "PLAN_RUN_DAY_INVALID")

        self.assertEqual(self.store.list_target_publications("client-a", "brand-a"), [])
        self.assertEqual(self.worker_store.list_jobs(), [])

    def test_approval_runs_authoritative_target_preflight_before_worker_enqueue(self):
        calls = []
        payloads = []
        scopes = self.publication_payload("publication-preflight-scopes", "job-preflight-scopes")
        scopes["requiredScopes"] = ["pages_manage_posts"]
        scopes["workerJob"]["payload"]["required_scopes"] = ["pages_manage_posts"]
        payloads.append((scopes, "TARGET_PUBLICATION_PREFLIGHT_BLOCKED_SCOPES"))
        identity = self.publication_payload("publication-preflight-identity", "job-preflight-identity")
        identity["identityVersionId"] = "identity-other"
        identity["workerJob"]["payload"]["identity_version_id"] = "identity-other"
        payloads.append((identity, "TARGET_PUBLICATION_PREFLIGHT_BLOCKED_IDENTITY"))
        platform = self.publication_payload("publication-preflight-platform", "job-preflight-platform")
        platform["platform"] = "instagram"
        platform["workerJob"]["payload"]["platform"] = "instagram"
        payloads.append((platform, "TARGET_PUBLICATION_PREFLIGHT_BLOCKED_PLATFORM"))
        media = self.publication_payload("publication-preflight-media", "job-preflight-media")
        media["mediaRequired"] = True
        media["mediaEligible"] = False
        payloads.append((media, "TARGET_PUBLICATION_PREFLIGHT_BLOCKED_MEDIA"))

        with patch.object(service, "dispatch_worker_command", side_effect=lambda command: calls.append(command) or self.worker_dispatch(command), create=True):
            for payload, code in payloads:
                with self.subTest(code=code):
                    rejected = self.client.post("/v1/agency/target-publications/approve", json=payload)
                    self.assertEqual(rejected.status_code, 400)
                    self.assertEqual(rejected.json()["detail"]["code"], code)

        self.assertEqual(calls, [])
        self.assertEqual(self.store.list_target_publications("client-a", "brand-a"), [])
        self.assertEqual(self.worker_store.list_jobs(), [])

    def test_migration_collision_report_is_readable_without_deleting_legacy_publications(self):
        self.store.create_connection({"id": "connection-a2", "clientId": "client-a", "platform": "facebook", "externalAccountId": "page-a-2", "displayName": "Page A mirror", "connectionState": "connected", "scopes": []})
        self.store.create_binding({"id": "binding-a2", "brandId": "brand-a", "identityId": "identity-a", "connectionId": "connection-a2", "targetExternalId": "page-a", "targetName": "Page A mirror", "state": "connected"})
        for index, (binding_id, scheduled_at) in enumerate((("binding-a", "2099-01-05T09:00:00Z"), ("binding-a2", "2099-01-05T02:00:00-07:00"))):
            self.store.connection.execute("INSERT INTO target_publications(id, binding_id, variant_id, idempotency_key, approval_state, state, client_id, brand_id, scheduled_at, target_external_id) VALUES (?, ?, ?, ?, 'approved', 'scheduled', 'client-a', 'brand-a', ?, 'page-a')", (f"legacy-publication-{index}", binding_id, f"legacy-variant-{index}", f"legacy-key-{index}", scheduled_at))
        self.store.connection.commit()
        self.store.close()
        self.store = AgencyStateStore(self.db_path)
        service.agency_state_store = self.store

        response = self.client.get("/v1/agency/target-publications/diagnostics")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()["scheduleCollisions"][0]["publicationIds"]), {"legacy-publication-0", "legacy-publication-1"})
        self.assertEqual(len(self.store.list_target_publications("client-a", "brand-a")), 2)

    def test_legacy_non_live_publication_approval_and_actions_are_blocked(self):
        self.store.connection.execute(
            "INSERT INTO target_publications(id, binding_id, variant_id, idempotency_key, approval_state, state, client_id, brand_id, simulation, scheduled_at, target_external_id, target_platform) VALUES (?, ?, ?, ?, 'approved', 'scheduled', ?, ?, 1, ?, ?, ?)",
            ("publication-legacy-actions", "binding-a", "variant-legacy-actions", "key-legacy-actions", "client-a", "brand-a", "2099-01-05T09:00:00Z", "page-a", "facebook"),
        )
        self.store.connection.commit()
        self.store.close()
        self.store = AgencyStateStore(self.db_path)
        service.agency_state_store = self.store

        listed = self.client.get("/v1/agency/target-publications", params={"clientId": "client-a", "brandId": "brand-a"})
        self.assertEqual(listed.status_code, 200)
        self.assertTrue(next(item for item in listed.json() if item["id"] == "publication-legacy-actions")["legacyNonLive"])

        approval = self.client.post("/v1/agency/target-publications/approve", json={"id": "publication-legacy-actions", "simulation": True})
        self.assertEqual(approval.status_code, 409)
        self.assertEqual(approval.json()["detail"]["code"], "LEGACY_NON_LIVE_ACTION_BLOCKED")
        for action, extra in (("cancel", {}), ("publish_now", {}), ("reschedule", {"scheduledAt": "2099-01-06T09:00:00Z"})):
            response = self.client.post(f"/v1/agency/target-publications/publication-legacy-actions/commands", json={"action": action, "clientId": "client-a", "brandId": "brand-a", "expectedRevision": 0, "requestId": f"legacy-{action}", **extra})
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()["detail"]["code"], "LEGACY_NON_LIVE_ACTION_BLOCKED")


if __name__ == "__main__":
    unittest.main()
