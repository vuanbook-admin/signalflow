"""SignalFlow control plane boundary.

This service owns provider app secrets and exchanges Meta OAuth codes. The desktop
renderer receives an authorize URL and connection metadata, never the provider
access token. Credential payloads are stored in the user-only SignalFlow .env
file by default; an in-memory vault is available only when an explicit
test/development fallback is configured.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode, urlsplit

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app_state_store import AgencyStateStore, StateValidationError

app = FastAPI(title="SignalFlow Control Plane", version="0.2.0")
_outbox_recovery_lock = threading.Lock()
_outbox_recovery_thread: threading.Thread | None = None
OUTBOX_RECOVERY_DELAY_SECONDS = 5.0
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):[0-9]+$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["content-type", "x-signalflow-profile-id", "x-signalflow-runtime-id"],
)


@app.middleware("http")
async def reject_stale_profile_runtime(request: Request, call_next):
    if request.method == "OPTIONS" or request.url.path == "/health":
        return await call_next(request)
    expected_profile = os.getenv("SIGNALFLOW_PROFILE_ID", "").strip()
    expected_runtime = os.getenv("SIGNALFLOW_RUNTIME_ID", "").strip()
    if not expected_profile and not expected_runtime:
        return await call_next(request)
    if not expected_profile or not expected_runtime:
        return JSONResponse(status_code=503, content={"detail": {"code": "PROFILE_RUNTIME_IDENTITY_UNAVAILABLE", "message": "Control Plane runtime identity is incomplete."}})
    if request.headers.get("x-signalflow-profile-id") != expected_profile or request.headers.get("x-signalflow-runtime-id") != expected_runtime:
        return JSONResponse(status_code=409, content={"detail": {"code": "PROFILE_RUNTIME_IDENTITY_MISMATCH", "message": "Request belongs to a different active profile runtime."}})
    return await call_next(request)

META_GRAPH_API_VERSION = os.getenv("META_GRAPH_API_VERSION", "v23.0")
META_DIALOG_URL = f"https://www.facebook.com/{META_GRAPH_API_VERSION}/dialog/oauth"
META_TOKEN_URL = f"https://graph.facebook.com/{META_GRAPH_API_VERSION}/oauth/access_token"
META_GRAPH_URL = f"https://graph.facebook.com/{META_GRAPH_API_VERSION}"
DEFAULT_REDIRECT_URI = os.getenv("META_REDIRECT_URI", "https://localhost/oauth/callback")
META_OAUTH_SCOPE = "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management"


def configured_redirect_uris() -> set[str]:
    values = {DEFAULT_REDIRECT_URI}
    configured = os.getenv("SIGNALFLOW_REDIRECT_URI")
    if configured:
        values.add(configured)
    return values


def validate_redirect_uri(redirect_uri: str) -> None:
    if redirect_uri not in configured_redirect_uris():
        raise HTTPException(status_code=400, detail={"code": "REDIRECT_URI_NOT_ALLOWED", "message": "Redirect URI is not registered for SignalFlow."})
    parsed = urlsplit(redirect_uri)
    if parsed.scheme != "https" or parsed.hostname != "localhost" or parsed.port is not None or parsed.path != "/oauth/callback" or parsed.query or parsed.fragment:
        raise HTTPException(status_code=400, detail={"code": "REDIRECT_URI_INVALID", "message": "Redirect URI must be the exact HTTPS localhost callback."})


@dataclass
class OAuthState:
    workspace_id: str
    redirect_uri: str
    expires_at: float
    used: bool = False


class MemoryStateStore:
    def __init__(self) -> None:
        self._items: dict[str, OAuthState] = {}

    def put(self, state: str, item: OAuthState) -> None:
        self._items[state] = item

    def consume(self, state: str, workspace_id: str, redirect_uri: str) -> OAuthState:
        item = self._items.get(state)
        if item is None or item.used:
            raise HTTPException(status_code=400, detail={"code": "OAUTH_STATE_INVALID", "message": "OAuth state is invalid or already used."})
        if item.expires_at < time.time():
            raise HTTPException(status_code=400, detail={"code": "OAUTH_STATE_EXPIRED", "message": "OAuth state has expired."})
        if item.workspace_id != workspace_id or item.redirect_uri != redirect_uri:
            raise HTTPException(status_code=400, detail={"code": "OAUTH_STATE_MISMATCH", "message": "OAuth state does not match this workspace or redirect URI."})
        item.used = True
        return item


def _workspace_key(workspace_id: str) -> str:
    return hashlib.sha256(workspace_id.encode("utf-8")).hexdigest()


def _scalar_account_hints(account_hints: list[dict[str, Any]]) -> list[dict[str, str | None]]:
    normalized: list[dict[str, str | None]] = []
    for hint in account_hints:
        if not isinstance(hint, dict) or not hint.get("id"):
            continue
        normalized.append({
            "id": str(hint["id"]),
            "name": str(hint["name"]) if hint.get("name") is not None else None,
            "kind": str(hint["kind"]) if hint.get("kind") is not None else None,
        })
    return normalized


class TokenVaultError(RuntimeError):
    """Raised without exposing credential payloads or filesystem details."""


class DevelopmentTokenVault:
    """Explicit in-memory fallback for tests and local development only."""

    boundary = "development-memory-explicit"

    def __init__(self) -> None:
        self._tokens: dict[str, dict[str, Any]] = {}

    def put(self, workspace_id: str, token: str, expires_in: int | None, account_hints: list[dict[str, Any]]) -> None:
        key = _workspace_key(workspace_id)
        self._tokens[key] = {
            "access_token": token,
            "expires_at": (time.time() + expires_in) if expires_in else None,
            "account_hints": _scalar_account_hints(account_hints),
            "stored_at": int(time.time()),
        }

    def _item(self, workspace_id: str) -> dict[str, Any] | None:
        return self._tokens.get(_workspace_key(workspace_id))

    def has(self, workspace_id: str) -> bool:
        return self._item(workspace_id) is not None

    def metadata(self, workspace_id: str) -> dict[str, Any] | None:
        item = self._item(workspace_id)
        if not item:
            return None
        return {
            "stored": True,
            "expiresAt": item["expires_at"],
            "accountHintCount": len(item["account_hints"]),
            "storedAt": item["stored_at"],
            "vaultBoundary": self.boundary,
        }


def _env_file_path() -> Path:
    configured = os.getenv("SIGNALFLOW_ENV_FILE", "").strip()
    return Path(configured).expanduser() if configured else Path.home() / ".signalflow" / ".env"


def _account_env_key(account: str) -> str:
    return f"SIGNALFLOW_SECRET_{account.encode('utf-8').hex().upper()}"


def _parse_env_value(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, str) else value
        except json.JSONDecodeError:
            return value[1:-1]
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("\\'", "'").replace("\\\\", "\\")
    return value


def _read_env_secret(account: str) -> str | None:
    key = _account_env_key(account)
    process_value = os.getenv(key)
    if process_value:
        return process_value
    path = _env_file_path()
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return None
    except OSError as error:
        raise TokenVaultError("Unable to read the SignalFlow .env credential file.") from error
    pattern = re.compile(rf"^\s*{re.escape(key)}\s*=\s*(.*?)\s*$")
    for line in lines:
        match = pattern.match(line)
        if match:
            parsed = _parse_env_value(match.group(1))
            return parsed or None
    return None


def _write_env_secret(account: str, value: str | None) -> None:
    path = _env_file_path()
    key = _account_env_key(account)
    try:
        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        lines = existing.splitlines(keepends=True)
        output: list[str] = []
        replaced = False
        pattern = re.compile(rf"^\s*{re.escape(key)}\s*=")
        encoded = f"{key}={json.dumps(value, ensure_ascii=True)}\n" if value else None
        for line in lines:
            if pattern.match(line):
                if encoded and not replaced:
                    output.append(encoded)
                    replaced = True
                continue
            output.append(line)
        if encoded and not replaced:
            if output and not output[-1].endswith(("\n", "\r")):
                output.append("\n")
            output.append(encoded)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        temp.write_text("".join(output), encoding="utf-8")
        os.chmod(temp, 0o600)
        os.replace(temp, path)
        os.chmod(path, 0o600)
    except OSError as error:
        try:
            temp.unlink()
        except (NameError, UnboundLocalError, OSError):
            pass
        raise TokenVaultError("Unable to write the SignalFlow .env credential file.") from error


class EnvFileTokenVault:
    """Stores one JSON token payload per workspace in the SignalFlow .env file."""

    boundary = "env-file-plaintext"

    def _account(self, workspace_id: str) -> str:
        return f"control-plane:meta-token:{_workspace_key(workspace_id)}"

    def put(self, workspace_id: str, token: str, expires_in: int | None, account_hints: list[dict[str, Any]]) -> None:
        payload = json.dumps({
            "access_token": token,
            "expires_at": (time.time() + expires_in) if expires_in else None,
            "account_hints": _scalar_account_hints(account_hints),
            "stored_at": int(time.time()),
        }, separators=(",", ":"), ensure_ascii=True)
        _write_env_secret(self._account(workspace_id), payload)

    def _load(self, workspace_id: str) -> dict[str, Any] | None:
        stored = _read_env_secret(self._account(workspace_id))
        if not stored:
            return None
        try:
            item = json.loads(stored)
        except (TypeError, json.JSONDecodeError) as error:
            raise TokenVaultError("Stored .env token payload is invalid.") from error
        if not isinstance(item, dict) or not isinstance(item.get("access_token"), str) or not item["access_token"]:
            raise TokenVaultError("Stored .env token payload is invalid.")
        return item

    def has(self, workspace_id: str) -> bool:
        return self._load(workspace_id) is not None

    def metadata(self, workspace_id: str) -> dict[str, Any] | None:
        item = self._load(workspace_id)
        if not item:
            return None
        account_hints = item.get("account_hints", [])
        return {
            "stored": True,
            "expiresAt": item.get("expires_at"),
            "accountHintCount": len(account_hints) if isinstance(account_hints, list) else 0,
            "storedAt": item.get("stored_at"),
            "vaultBoundary": self.boundary,
        }


class NativeMetaPageTokenReader:
    """Read and write the desktop Page token through the shared .env file."""

    def __init__(self, runner: Any | None = None) -> None:
        self._runner = runner

    def _read_secret(self, account: str) -> str | None:
        return _read_env_secret(account)

    def page_token(self, workspace_id: str, page_id: str) -> str | None:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", workspace_id) or not re.fullmatch(r"\d{1,64}", page_id):
            raise TokenVaultError("Invalid Meta worker account identifier.")
        base = f"workspace:{workspace_id}:meta:page-access-token:{page_id}"
        stored = self._read_secret(base)
        if stored is None:
            return None
        manifest = re.fullmatch(r"v1:([A-Za-z0-9-]{1,128}):(\d{1,4})", stored)
        if not manifest:
            return stored or None
        generation, raw_count = manifest.groups()
        count = int(raw_count)
        if count < 1 or count > 1024:
            raise TokenVaultError("Stored Meta credential manifest is invalid.")
        chunks: list[str] = []
        for index in range(count):
            chunk = self._read_secret(f"{base}:chunk:{generation}:{index}")
            if chunk is None:
                raise TokenVaultError("Stored Meta credential is incomplete.")
            chunks.append(chunk)
        token = "".join(chunks)
        return token or None

    def write_scalar(self, account: str, value: str) -> None:
        if not re.fullmatch(r"[A-Za-z0-9:_-]{1,240}", account) or not value or len(value) > 4096 or any(character.isspace() for character in value):
            raise TokenVaultError("Invalid worker marker.")
        _write_env_secret(account, value)


def create_token_vault() -> DevelopmentTokenVault | EnvFileTokenVault:
    mode = os.getenv("SIGNALFLOW_TOKEN_VAULT", "dotenv").strip().lower()
    if mode in {"memory", "development-memory"}:
        if os.getenv("SIGNALFLOW_ALLOW_MEMORY_TOKEN_VAULT", "").strip().lower() not in {"1", "true", "yes"}:
            raise RuntimeError("Memory token vault requires explicit SIGNALFLOW_ALLOW_MEMORY_TOKEN_VAULT configuration.")
        return DevelopmentTokenVault()
    if mode not in {"dotenv", "env", "file", "keychain", "macos-keychain"}:
        raise RuntimeError("Unsupported SIGNALFLOW_TOKEN_VAULT mode.")
    return EnvFileTokenVault()


state_store = MemoryStateStore()
agency_state_store: AgencyStateStore | None = None
token_vault = create_token_vault()


def agency_store() -> AgencyStateStore:
    global agency_state_store
    if agency_state_store is None:
        database_path = os.getenv("SIGNALFLOW_CONTROL_PLANE_DB", str(Path.cwd() / "signalflow-control-plane.sqlite3"))
        agency_state_store = AgencyStateStore(database_path)
    return agency_state_store


class WorkerCommandRejected(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def dispatch_worker_command(command: dict[str, Any]) -> dict[str, Any]:
    worker_url = os.getenv("SIGNALFLOW_WORKER_URL", "http://127.0.0.1:18788").rstrip("/")
    parsed = urlsplit(worker_url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.path not in {"", "/"}:
        raise RuntimeError("WORKER_LOOPBACK_URL_INVALID")
    action = command.get("action")
    if action == "approve":
        job = command.get("workerJob")
        if not isinstance(job, dict):
            raise WorkerCommandRejected("TARGET_PUBLICATION_WORKER_JOB_REQUIRED")
        if isinstance(job.get("payload"), dict) and job["payload"].get("simulation") is True:
            raise WorkerCommandRejected("WORKER_SIMULATION_NOT_ALLOWED")
        request = {"job_id": job["jobId"], "idempotency_key": job["idempotencyKey"], "scheduled_at": job["scheduledAtSeconds"], "payload": job["payload"]}
        response = httpx.post(f"{worker_url}/v1/jobs", json=request, timeout=5)
    else:
        body = {"action": action, "request_id": command["requestId"], "expected_revision": command["workerRevision"]}
        if command.get("scheduledAtSeconds") is not None:
            body["scheduled_at"] = command["scheduledAtSeconds"]
        response = httpx.post(f"{worker_url}/v1/jobs/{quote(str(command['workerJobId']), safe='')}/action", json=body, timeout=5)
    if response.status_code in {400, 404, 409, 422}:
        try:
            detail = response.json().get("detail", {})
            code = detail.get("code", "WORKER_COMMAND_REJECTED") if isinstance(detail, dict) else "WORKER_COMMAND_REJECTED"
        except (TypeError, ValueError):
            code = "WORKER_COMMAND_REJECTED"
        raise WorkerCommandRejected(str(code))
    response.raise_for_status()
    try:
        return response.json()
    except (TypeError, ValueError) as error:
        raise RuntimeError("WORKER_COMMAND_RESPONSE_INVALID") from error


def dispatch_and_record_publication_command(store: AgencyStateStore, request_id: str) -> dict[str, Any]:
    status = store._publication_command_status(request_id)
    if status["commandStatus"] != "pending":
        return status
    try:
        response = dispatch_worker_command(status["command"])
        return store.acknowledge_publication_command(request_id, response)
    except WorkerCommandRejected as error:
        return store.fail_publication_command(request_id, error.code)
    except Exception as error:  # noqa: BLE001 - a lost response leaves a retryable durable intent
        code = str(error) if str(error).isascii() and str(error).replace("_", "").replace("-", "").isalnum() else "WORKER_COMMAND_OUTCOME_UNCERTAIN"
        return store.mark_publication_command_pending_error(request_id, code)


def recover_pending_publication_commands(store: AgencyStateStore | None = None) -> int:
    selected_store = store or agency_store()
    pending = selected_store.pending_publication_commands()
    for command in pending:
        dispatch_and_record_publication_command(selected_store, str(command["requestId"]))
    return len(pending)


def start_publication_outbox_recovery() -> None:
    global _outbox_recovery_thread
    with _outbox_recovery_lock:
        if _outbox_recovery_thread and _outbox_recovery_thread.is_alive():
            return

        def drain() -> None:
            global _outbox_recovery_thread
            try:
                for attempt in range(12):
                    if not agency_store().pending_publication_commands():
                        return
                    recover_pending_publication_commands()
                    if attempt < 11 and agency_store().pending_publication_commands():
                        time.sleep(OUTBOX_RECOVERY_DELAY_SECONDS)
            except Exception:  # noqa: BLE001 - startup recovery must leave durable intents available for the next retry
                return
            finally:
                with _outbox_recovery_lock:
                    if _outbox_recovery_thread is threading.current_thread():
                        _outbox_recovery_thread = None

        _outbox_recovery_thread = threading.Thread(target=drain, daemon=True)
        _outbox_recovery_thread.start()


@app.on_event("startup")
def recover_publication_outbox_on_startup() -> None:
    recover_pending_publication_commands()
    start_publication_outbox_recovery()


def agency_error(error: StateValidationError) -> HTTPException:
    code = str(error)
    status = 403 if code == "BRAND_MANAGE_FORBIDDEN" else 409 if code in {"TARGET_PUBLICATION_SLOT_CONFLICT", "TARGET_PUBLICATION_EXISTS", "TARGET_PUBLICATION_STATE_CONFLICT", "PUBLICATION_COMMAND_PENDING", "PUBLICATION_REVISION_CONFLICT", "PUBLICATION_REQUEST_ID_REUSED", "PUBLICATION_WORKER_NOT_ACKNOWLEDGED", "LEGACY_NON_LIVE_ACTION_BLOCKED", "BRAND_NOT_TRASHED", "BRAND_NAME_CONFIRMATION_REQUIRED", "BRAND_PUBLICATIONS_RECONCILIATION_REQUIRED", "BRAND_DELETE_PENDING", "BRAND_IMPACT_CHANGED", "CONTENT_RUN_REVISION_MISMATCH", "CONTENT_RUN_QUALITY_IMMUTABLE", "STRATEGY_CATALOG_VERSION_CONFLICT", "STRATEGY_CATALOG_REVISION_CONFLICT", "STRATEGY_CATALOG_FINGERPRINT_MISMATCH"} else 400
    return HTTPException(status_code=status, detail={"code": code, "message": "Agency operation was rejected by the Control Plane."})


class MetaOAuthStartRequest(BaseModel):
    workspace_id: str = Field(min_length=1, max_length=128)
    redirect_uri: str = Field(min_length=1, max_length=512)


class MetaOAuthExchangeRequest(BaseModel):
    workspace_id: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=1, max_length=4096)
    state: str = Field(min_length=20, max_length=256)
    redirect_uri: str = Field(min_length=1, max_length=512)


class MetaWorkerPublishRequest(BaseModel):
    workspace_id: str = Field(min_length=1, max_length=128)
    page_id: str = Field(pattern=r"^\d{1,64}$")
    message: str = Field(min_length=1, max_length=63206)
    media_url: str | None = Field(default=None, max_length=4096)
    idempotency_key: str = Field(min_length=1, max_length=512)
    approval_state: str = Field(pattern=r"^approved$")
    platform: str = Field(pattern=r"^facebook$")
    kind: str = Field(pattern=r"^(text|image|video)$")
    simulation: bool = False
    client_id: str | None = Field(default=None, max_length=128)
    brand_id: str | None = Field(default=None, max_length=128)
    binding_id: str | None = Field(default=None, max_length=160)
    identity_version_id: str | None = Field(default=None, max_length=160)
    required_scopes: list[str] = Field(default_factory=list, max_length=20)
    media_eligible: bool | None = None
    target_publication_id: str | None = Field(default=None, max_length=160)


@app.get("/health")
def health() -> dict[str, Any]:
    configured = bool(os.getenv("META_APP_ID") and os.getenv("META_APP_SECRET"))
    store = agency_store()
    profile_id = os.getenv("SIGNALFLOW_PROFILE_ID", "").strip() or None
    runtime_id = os.getenv("SIGNALFLOW_RUNTIME_ID", "").strip() or None
    return {
        "ok": True,
        "service": "signalflow-control-plane",
        "configuredProviders": ["meta"] if configured else [],
        "tokenVault": token_vault.boundary,
        "tokenVaultBoundary": token_vault.boundary,
        "tokenVaultConfigured": True,
        "livePublishingReady": False,
        "profileId": profile_id,
        "runtimeId": runtime_id,
        "dataAsOf": store.latest_analytics_time(),
        "workerReconciledAt": store.latest_worker_reconciled_time(),
    }


@app.post("/v1/agency/migrations/commit")
def commit_agency_migration(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return agency_store().commit_renderer_migration(payload)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/brand-actor-bindings/backfill")
def backfill_brand_actor_bindings(payload: dict[str, Any]) -> dict[str, int]:
    try:
        return agency_store().backfill_brand_actor_bindings(payload)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.get("/v1/agency/recovery")
def get_agency_recovery() -> dict[str, list[dict[str, Any]]]:
    return agency_store().recovery_state()


_AGENCY_CREATORS = {
    "clients": "create_client",
    "brands": "create_brand",
    "identities": "create_identity",
    "connections": "create_connection",
    "bindings": "create_binding",
    "generation-profiles": "create_generation_profile",
    "content-runs": "create_content_run",
    "target-publications": "create_target_publication",
    "provider-configurations": "create_provider_configuration",
    "knowledge-items": "create_knowledge_item",
    "prompt-blueprints": "create_prompt_blueprint",
    "research-evidence": "create_research_evidence",
    "trend-signals": "create_trend_signal",
    "media-assets": "create_media_asset",
    "automation-plans": "create_automation_plan",
    "automation-runs": "create_automation_run",
    "analytics-events": "append_analytics_event",
}
_AGENCY_ENTITIES = {
    "clients": "clients",
    "brands": "brands",
    "identities": "brand_identities",
    "bindings": "channel_bindings",
    "connections": "connections",
    "generation-profiles": "generation_profiles",
    "content-runs": "content_runs",
    "target-publications": "target_publications",
    "provider-configurations": "provider_configurations",
    "knowledge-items": "knowledge_items",
    "prompt-blueprints": "prompt_blueprints",
    "research-evidence": "research_evidence",
    "trend-signals": "trend_signals",
    "analytics-events": "analytics_events",
    "audit-events": "audit_events",
    "media-assets": "media_assets",
    "automation-plans": "automation_plans",
    "automation-runs": "automation_runs",
}


@app.post("/v1/agency/content-runs/{record_id}/provider-attempt")
def mark_content_run_provider_attempt(record_id: str) -> dict[str, bool]:
    try:
        agency_store().mark_provider_attempt(record_id)
        return {"providerAttempted": True}
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/target-publications/preflight")
def preflight_target_publication(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return agency_store().preflight_target_publication(payload)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.get("/v1/agency/target-publications/diagnostics")
def target_publication_diagnostics() -> dict[str, Any]:
    return {"scheduleCollisions": agency_store().list_schedule_collisions()}


@app.post("/v1/agency/target-publications/approve")
def approve_target_publication(payload: dict[str, Any]) -> dict[str, Any]:
    store = agency_store()
    try:
        command = store.begin_target_publication_approval(payload)
        return dispatch_and_record_publication_command(store, str(command["commandId"]))
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/target-publications/{record_id}/commands")
def mutate_target_publication(record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    store = agency_store()
    try:
        command = store.begin_target_publication_command(record_id, payload)
        return dispatch_and_record_publication_command(store, str(command["commandId"]))
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/target-publications/commands/recover")
def recover_target_publication_commands() -> dict[str, int]:
    return {"recovered": recover_pending_publication_commands(), "pending": len(agency_store().pending_publication_commands())}


@app.patch("/v1/agency/content-runs/{record_id}")
def update_content_run(record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        if not isinstance(payload, dict) or not payload:
            raise StateValidationError("CONTENT_RUN_PAYLOAD_INVALID")
        updated = agency_store().update_content_run_payload(record_id, payload)
        return {"id": record_id, **updated, "clientId": updated.get("client_id"), "brandId": updated.get("brand_id")}
    except StateValidationError as error:
        raise agency_error(error) from error


@app.patch("/v1/agency/identities/{record_id}/payload")
def update_identity_payload(record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return agency_store().update_identity_payload(record_id, payload)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/generation-profiles/{record_id}/probe")
def probe_generation_profile(record_id: str) -> dict[str, Any]:
    try:
        return agency_store().probe_generation_profile(record_id)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/provider-configurations/{record_id}/probe")
def probe_provider_configuration(record_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        return agency_store().probe_provider_configuration(record_id, bool((payload or {}).get("operatorApproved")))
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/automation-plans/validate-activation")
def validate_automation_plan_activation(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return agency_store().validate_plan_activation(payload)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/knowledge-items/{record_id}/archive")
def archive_knowledge_item(record_id: str) -> dict[str, str]:
    try:
        return agency_store().archive_knowledge_item(record_id)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/media-assets/{record_id}/compensate")
def compensate_media_asset(record_id: str, payload: dict[str, Any]) -> dict[str, str]:
    try:
        return agency_store().compensate_media_asset(record_id, payload)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/media-assets/{record_id}/archive")
def archive_media_asset(record_id: str) -> dict[str, str]:
    try:
        return agency_store().archive_media_asset(record_id)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/media-assets/{record_id}/restore")
def restore_media_asset(record_id: str) -> dict[str, str]:
    try:
        return agency_store().restore_media_asset(record_id)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.get("/v1/agency/knowledge-items/search")
def search_knowledge_items(clientId: str | None = None, brandId: str | None = None, q: str = "") -> list[dict[str, Any]]:
    if not clientId or not brandId:
        raise HTTPException(status_code=400, detail={"code": "KNOWLEDGE_SCOPE_REQUIRED", "message": "Client and Brand filters are required."})
    try:
        return agency_store().search_knowledge_items(clientId, brandId, q)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.get("/v1/agency/strategy-catalogs")
def get_strategy_catalog(clientId: str | None = None, brandId: str | None = None) -> dict[str, Any]:
    if not clientId or not brandId:
        raise HTTPException(status_code=400, detail={"code": "STRATEGY_CATALOG_SCOPE_REQUIRED", "message": "Client and Brand filters are required."})
    try:
        catalog = agency_store().get_strategy_catalog(clientId, brandId)
    except StateValidationError as error:
        raise agency_error(error) from error
    if catalog is None:
        raise HTTPException(status_code=404, detail={"code": "STRATEGY_CATALOG_MISSING", "message": "Strategy catalog does not exist for this Client and Brand."})
    return catalog


@app.patch("/v1/agency/strategy-catalogs")
def save_strategy_catalog(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return agency_store().save_strategy_catalog(payload)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.get("/v1/agency/brands/{record_id}/strategy-catalog")
def get_brand_strategy_catalog(record_id: str, clientId: str | None = None) -> dict[str, Any]:
    if not clientId:
        raise HTTPException(status_code=400, detail={"code": "STRATEGY_CATALOG_SCOPE_REQUIRED", "message": "Client filter is required."})
    try:
        catalog = agency_store().get_strategy_catalog(clientId, record_id)
    except StateValidationError as error:
        raise agency_error(error) from error
    if catalog is None:
        raise HTTPException(status_code=404, detail={"code": "STRATEGY_CATALOG_MISSING", "message": "Strategy catalog does not exist for this Client and Brand."})
    return catalog


@app.patch("/v1/agency/brands/{record_id}/strategy-catalog")
def save_brand_strategy_catalog(record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return agency_store().save_strategy_catalog({**payload, "brandId": record_id})
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/{entity}")
def create_agency_entity(entity: str, payload: dict[str, Any]) -> dict[str, Any]:
    if entity == "target-publications":
        raise HTTPException(status_code=409, detail={"code": "TARGET_PUBLICATION_COMMAND_REQUIRED", "message": "Target Publications must be approved through the durable Control Plane command route."})
    creator = _AGENCY_CREATORS.get(entity)
    if not creator:
        raise HTTPException(status_code=404, detail={"code": "AGENCY_ENTITY_UNSUPPORTED", "message": "Agency entity is not supported."})
    try:
        return getattr(agency_store(), creator)(payload)
    except StateValidationError as error:
        rejected = agency_error(error)
        if entity in {"content-runs", "media-assets"} and str(error) not in {"CONTENT_RUN_CONFLICT", "MEDIA_CONFLICT"}:
            rejected.detail["createOutcome"] = "rejected"
        raise rejected from error


@app.get("/v1/agency/{entity}")
def list_agency_entities(entity: str, clientId: str | None = None, brandId: str | None = None) -> list[dict[str, Any]]:
    if entity == "analytics-events":
        if not clientId or not brandId:
            raise HTTPException(status_code=400, detail={"code": "ANALYTICS_SCOPE_REQUIRED", "message": "Client and Brand filters are required."})
        try:
            return agency_store().list_analytics_events(clientId, brandId)
        except StateValidationError as error:
            raise agency_error(error) from error
    if entity == "target-publications":
        if not clientId or not brandId:
            raise HTTPException(status_code=400, detail={"code": "TARGET_PUBLICATION_SCOPE_REQUIRED", "message": "Client and Brand filters are required."})
        try:
            return agency_store().list_target_publications(clientId, brandId)
        except StateValidationError as error:
            raise agency_error(error) from error
    if entity == "knowledge-items":
        if not clientId or not brandId:
            raise HTTPException(status_code=400, detail={"code": "KNOWLEDGE_SCOPE_REQUIRED", "message": "Client and Brand filters are required."})
        try:
            return agency_store().list_knowledge_items(clientId, brandId)
        except StateValidationError as error:
            raise agency_error(error) from error
    if entity == "prompt-blueprints":
        if not brandId:
            raise HTTPException(status_code=400, detail={"code": "PROMPT_BLUEPRINT_SCOPE_REQUIRED", "message": "Brand filter is required."})
        try:
            return agency_store().list_prompt_blueprints(brandId)
        except StateValidationError as error:
            raise agency_error(error) from error
    if entity == "research-evidence":
        if not clientId:
            raise HTTPException(status_code=400, detail={"code": "RESEARCH_SCOPE_REQUIRED", "message": "Client filter is required."})
        try:
            return agency_store().list_research_evidence(clientId, brandId)
        except StateValidationError as error:
            raise agency_error(error) from error
    if entity == "trend-signals":
        if not clientId:
            raise HTTPException(status_code=400, detail={"code": "TREND_SCOPE_REQUIRED", "message": "Client filter is required."})
        try:
            return agency_store().list_trend_signals(clientId)
        except StateValidationError as error:
            raise agency_error(error) from error
    if entity == "media-assets":
        if not clientId or not brandId:
            raise HTTPException(status_code=400, detail={"code": "MEDIA_SCOPE_REQUIRED", "message": "Client and Brand filters are required."})
        try:
            return agency_store().list_media_assets(clientId, brandId)
        except StateValidationError as error:
            raise agency_error(error) from error
    table = _AGENCY_ENTITIES.get(entity)
    if not table:
        raise HTTPException(status_code=404, detail={"code": "AGENCY_ENTITY_UNSUPPORTED", "message": "Agency entity is not supported."})
    try:
        return agency_store().list_entity(table)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.get("/v1/agency/{entity}/{record_id}")
def get_agency_entity(entity: str, record_id: str) -> dict[str, Any]:
    table = _AGENCY_ENTITIES.get(entity)
    if not table:
        raise HTTPException(status_code=404, detail={"code": "AGENCY_ENTITY_UNSUPPORTED", "message": "Agency entity is not supported."})
    try:
        records = agency_store().list_entity(table, record_id)
    except StateValidationError as error:
        raise agency_error(error) from error
    if not records:
        raise HTTPException(status_code=404, detail={"code": "AGENCY_ENTITY_MISSING", "message": "Agency entity does not exist."})
    return records[0]


@app.get("/v1/agency/brands/{record_id}/impact")
@app.get("/v1/agency/brands/{record_id}/impact-preview")
def get_brand_impact_preview(record_id: str) -> dict[str, Any]:
    try:
        return agency_store().brand_impact_preview(record_id)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.patch("/v1/agency/{entity}/{record_id}")
def update_agency_entity(entity: str, record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if entity == "target-publications":
        raise HTTPException(status_code=409, detail={"code": "TARGET_PUBLICATION_COMMAND_REQUIRED", "message": "Target Publications may only change through durable Control Plane commands or provider-confirmed reconciliation."})
    if entity == "brands":
        raise HTTPException(status_code=409, detail={"code": "BRAND_LIFECYCLE_REQUIRED", "message": "Brands must change through the trash, restore, or permanent-delete authority routes."})
    table = _AGENCY_ENTITIES.get(entity)
    if not table:
        raise HTTPException(status_code=404, detail={"code": "AGENCY_ENTITY_UNSUPPORTED", "message": "Agency entity is not supported."})
    try:
        if entity == "automation-plans":
            return agency_store().update_automation_plan(record_id, payload)
        return agency_store().update_entity(table, record_id, payload)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/research-evidence/{record_id}/approve")
def approve_research_evidence(record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return agency_store().approve_research_evidence(record_id, payload)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.delete("/v1/agency/{entity}/{record_id}", status_code=204)
def delete_agency_entity(entity: str, record_id: str) -> None:
    if entity == "target-publications":
        raise HTTPException(status_code=409, detail={"code": "TARGET_PUBLICATION_COMMAND_REQUIRED", "message": "Target Publications cannot be deleted through generic agency CRUD."})
    if entity == "brands":
        raise HTTPException(status_code=409, detail={"code": "BRAND_LIFECYCLE_REQUIRED", "message": "Brands must change through the trash, restore, or permanent-delete authority routes."})
    table = _AGENCY_ENTITIES.get(entity)
    if not table:
        raise HTTPException(status_code=404, detail={"code": "AGENCY_ENTITY_UNSUPPORTED", "message": "Agency entity is not supported."})
    try:
        agency_store().delete_entity(table, record_id)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/brands/{record_id}/trash")
def trash_brand(record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return agency_store().trash_brand(record_id, payload)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/brands/{record_id}/permanent-delete")
def permanently_delete_brand(record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return agency_store().permanently_delete_brand(record_id, payload.get("confirmation"), payload)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/agency/brands/{record_id}/restore")
def restore_brand(record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return agency_store().restore_brand(record_id, payload)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.get("/v1/agency/brands/{record_id}/deletion-operations")
def list_brand_deletion_operations(record_id: str) -> list[dict[str, Any]]:
    try:
        return agency_store().list_brand_deletion_operations(record_id)
    except StateValidationError as error:
        raise agency_error(error) from error


@app.post("/v1/oauth/meta/start")
def start_meta_oauth(request: MetaOAuthStartRequest) -> dict[str, Any]:
    validate_redirect_uri(request.redirect_uri)
    app_id = os.getenv("META_APP_ID")
    if not app_id:
        raise HTTPException(status_code=503, detail={"code": "META_APP_NOT_CONFIGURED", "message": "META_APP_ID is not configured on the control plane."})
    state = secrets.token_urlsafe(32)
    expires_at = time.time() + 600
    state_store.put(state, OAuthState(request.workspace_id, request.redirect_uri, expires_at))
    query = urlencode({
        "client_id": app_id,
        "redirect_uri": request.redirect_uri,
        "state": state,
        "response_type": "code",
        "scope": META_OAUTH_SCOPE,
    })
    return {"authorizeUrl": f"{META_DIALOG_URL}?{query}", "provider": "meta", "state": state, "expiresAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires_at))}


def classify_meta_publish_response(status_code: int, payload: Any) -> tuple[int, str, str]:
    """Return safe HTTP/code/message classification without echoing provider response text."""
    if status_code == 429 or status_code >= 500:
        return 503, "META_WORKER_PROVIDER_RETRYABLE", "Meta temporarily rejected the worker publish."
    error = payload.get("error") if isinstance(payload, dict) else None
    provider_code = error.get("code") if isinstance(error, dict) else None
    provider_message = str(error.get("message", "")) if isinstance(error, dict) else ""
    normalized = provider_message.lower()
    scope_signal = provider_code in {10, 200, 294} or any(term in normalized for term in ("permission", "permissions", "scope", "not authorized", "not authorised", "does not have access", "publish_posts"))
    if status_code == 401 or scope_signal:
        return 403, "META_WORKER_PAGE_PUBLISH_SCOPE_REQUIRED", "Meta rejected the publish because the Page token lacks the required Page publishing permission. Reconnect Meta with pages_manage_posts and rediscover the Page."
    if status_code >= 400:
        return 400, "META_WORKER_PROVIDER_REJECTED", "Meta rejected the worker publish."
    return status_code, "META_WORKER_PROVIDER_ACCEPTED", "Meta accepted the worker publish."


async def discover_meta_accounts(client: httpx.AsyncClient, access_token: str) -> list[dict[str, Any]]:
    response = await client.get(f"{META_GRAPH_URL}/me/accounts", params={"fields": "id,name,tasks,instagram_business_account,access_token"}, headers={"Authorization": f"Bearer {access_token}"})
    if response.status_code >= 400:
        return []
    payload = response.json()
    hints: list[dict[str, Any]] = []
    for page in payload.get("data", []):
        if not isinstance(page, dict) or not page.get("id"):
            continue
        hints.append({"id": page["id"], "name": page.get("name"), "kind": "page"})
        instagram = page.get("instagram_business_account")
        if isinstance(instagram, dict) and instagram.get("id"):
            hints.append({"id": instagram["id"], "name": page.get("name"), "kind": "instagram_business"})
    return hints


@app.post("/v1/oauth/meta/exchange")
async def exchange_meta_code(request: MetaOAuthExchangeRequest) -> dict[str, Any]:
    validate_redirect_uri(request.redirect_uri)
    state_store.consume(request.state, request.workspace_id, request.redirect_uri)
    app_id = os.getenv("META_APP_ID")
    app_secret = os.getenv("META_APP_SECRET")
    if not app_id or not app_secret:
        raise HTTPException(status_code=503, detail={"code": "META_APP_NOT_CONFIGURED", "message": "Meta app credentials are not configured on the control plane."})
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(META_TOKEN_URL, data={"client_id": app_id, "client_secret": app_secret, "redirect_uri": request.redirect_uri, "code": request.code})
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail={"code": "META_TOKEN_EXCHANGE_FAILED", "message": "Meta rejected the OAuth code exchange."})
        payload = response.json()
        access_token = payload.get("access_token")
        if not access_token:
            raise HTTPException(status_code=502, detail={"code": "META_TOKEN_MISSING", "message": "Meta returned no access token."})
        account_hints = await discover_meta_accounts(client, access_token)
    token_vault.put(request.workspace_id, access_token, payload.get("expires_in"), account_hints)
    metadata = token_vault.metadata(request.workspace_id) or {"expiresAt": None, "accountHintCount": 0}
    return {"provider": "meta", "status": "connected", "storedInVault": True, "expiresAt": metadata["expiresAt"], "accountHintCount": metadata["accountHintCount"], "vaultBoundary": metadata.get("vaultBoundary", token_vault.boundary), "accountHints": account_hints}


@app.post("/v1/worker/meta/page-text")
@app.post("/v1/worker/meta/page-photo")
@app.post("/v1/worker/meta/page-video")
async def worker_meta_page_text(request: MetaWorkerPublishRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    expected_auth = os.getenv("SIGNALFLOW_WORKER_AUTH_TOKEN", "").strip()
    if not expected_auth:
        raise HTTPException(status_code=503, detail={"code": "WORKER_AUTH_NOT_CONFIGURED", "message": "Durable worker authorization is not configured."})
    if authorization != f"Bearer {expected_auth}":
        raise HTTPException(status_code=401, detail={"code": "WORKER_UNAUTHORIZED", "message": "Worker authorization is invalid."})
    if request.simulation:
        raise HTTPException(status_code=400, detail={"code": "WORKER_SIMULATION_NOT_ALLOWED", "message": "The Meta control-plane worker boundary accepts approved live payloads only."})
    if any(character.isspace() and character not in " \n\r\t" for character in request.message) or any(character in request.message for character in "\x00\x01\x02\x03"):
        raise HTTPException(status_code=400, detail={"code": "META_MESSAGE_INVALID", "message": "Meta message contains unsupported control characters."})
    if request.kind in {"image", "video"} and (not request.media_url or not request.media_url.startswith("https://")):
        raise HTTPException(status_code=400, detail={"code": "META_MEDIA_URL_INVALID", "message": "Facebook image and video publishing require an HTTPS media URL."})
    if request.binding_id and request.client_id and request.brand_id and request.identity_version_id:
        preflight = agency_store().preflight_target_publication({"clientId": request.client_id, "brandId": request.brand_id, "bindingId": request.binding_id, "identityVersionId": request.identity_version_id, "variantId": request.idempotency_key, "platform": request.platform, "kind": request.kind, "scheduledAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 60)), "approvalState": request.approval_state, "requiredScopes": request.required_scopes, "mediaRequired": request.kind in {"image", "video"}, "mediaEligible": request.media_eligible is True, "mediaUrl": request.media_url})
        if preflight["ok"] is not True:
            raise HTTPException(status_code=400, detail={"code": "WORKER_PREFLIGHT_BLOCKED", "message": f"Target preflight blocked: {preflight.get('blockReason', 'target_not_ready')}"})
    reader = NativeMetaPageTokenReader()
    marker_account = f"workspace:{_workspace_key(request.workspace_id)}:meta:worker-marker:{hashlib.sha256(request.idempotency_key.encode('utf-8')).hexdigest()}"
    try:
        existing = reader._read_secret(marker_account)
        if existing:
            if request.target_publication_id:
                try:
                    agency_store().reconcile_target_publication(request.target_publication_id, "published", existing, 1)
                except StateValidationError:
                    pass
            return {"provider": "meta", "providerJobId": existing, "providerState": "published", "idempotentReplay": True}
        page_token = reader.page_token(request.workspace_id, request.page_id)
    except TokenVaultError as error:
        raise HTTPException(status_code=503, detail={"code": "META_WORKER_CREDENTIAL_UNAVAILABLE", "message": str(error)}) from error
    if not page_token:
        raise HTTPException(status_code=503, detail={"code": "META_PAGE_ACCESS_TOKEN_NOT_CONFIGURED", "message": "Meta Page discovery must complete before the worker can publish."})
    async with httpx.AsyncClient(timeout=60) as client:
        if request.kind == "image":
            response = await client.post(f"{META_GRAPH_URL}/{request.page_id}/photos", data={"caption": request.message, "url": request.media_url, "access_token": page_token})
        elif request.kind == "video":
            response = await client.post(f"{META_GRAPH_URL}/{request.page_id}/videos", data={"description": request.message, "file_url": request.media_url, "published": "true", "access_token": page_token})
        else:
            response = await client.post(f"{META_GRAPH_URL}/{request.page_id}/feed", data={"message": request.message, "access_token": page_token})
    try:
        provider_body = response.json()
    except (TypeError, ValueError):
        provider_body = {}
    classified_status, classified_code, classified_message = classify_meta_publish_response(response.status_code, provider_body)
    if response.status_code >= 400:
        raise HTTPException(status_code=classified_status, detail={"code": classified_code, "message": classified_message})
    body = provider_body if isinstance(provider_body, dict) else {}
    provider_job_id = body.get("post_id") or body.get("id")
    if not isinstance(provider_job_id, str) or not provider_job_id:
        raise HTTPException(status_code=503, detail={"code": "META_WORKER_PROVIDER_ID_MISSING", "message": "Meta returned no publish id."})
    try:
        reader.write_scalar(marker_account, provider_job_id)
    except TokenVaultError as error:
        raise HTTPException(status_code=503, detail={"code": "META_WORKER_IDEMPOTENCY_STORE_FAILED", "message": str(error)}) from error
    if request.target_publication_id:
        try:
            agency_store().reconcile_target_publication(request.target_publication_id, "published", provider_job_id, 1)
        except StateValidationError:
            pass
    return {"provider": "meta", "providerJobId": provider_job_id, "providerState": "published", "idempotentReplay": False}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8787")))
