"""Portable HTTP service for durable, approved publish jobs.

The service deliberately does not generate AI content. Subscription AI sessions
belong to the desktop webview. This worker owns the closed-app publish phase and
delegates provider calls to an explicit control-plane endpoint.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Callable

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from automation_worker import AutomationWorker, JobMutationError, PermanentJobError, RetryableJobError, SQLiteJobStore, UnknownJobOutcomeError


class EnqueueJobRequest(BaseModel):
    job_id: str = Field(min_length=1, max_length=240)
    idempotency_key: str = Field(min_length=1, max_length=512)
    scheduled_at: float = Field(ge=0)
    payload: dict[str, Any]


class RunOnceRequest(BaseModel):
    now: float | None = Field(default=None, ge=0)


class WorkerControlRequest(BaseModel):
    reason: str = Field(default="operator_request", min_length=1, max_length=160)


class JobActionRequest(BaseModel):
    action: str = Field(min_length=1, max_length=32)
    request_id: str = Field(min_length=1, max_length=160)
    expected_revision: int = Field(ge=0)
    scheduled_at: float | None = Field(default=None, ge=0)


def _contains_secret_key(value: Any) -> bool:
    forbidden = {"accesstoken", "refreshtoken", "authorization", "cookie", "cookies", "password", "secret", "token", "apikey", "privatekey", "clientsecret", "session", "sessiondata", "localstorage", "browserstorage"}
    if isinstance(value, dict):
        return any(str(key).lower().replace("_", "").replace("-", "") in forbidden or _contains_secret_key(item) for key, item in value.items())
    if isinstance(value, list):
        return any(_contains_secret_key(item) for item in value)
    return False


def _contains_auth_file_path(value: Any) -> bool:
    if isinstance(value, str):
        return bool(re.search(r"(?:/\.hermes(?:/|$)|/\.local/share/opencode(?:/|$)|/opencode/auth\.json$)", value, re.IGNORECASE))
    if isinstance(value, dict):
        return any(_contains_auth_file_path(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_auth_file_path(item) for item in value)
    return False


def validate_worker_payload(payload: dict[str, Any]) -> None:
    if _contains_secret_key(payload):
        raise PermanentJobError("WORKER_PAYLOAD_SECRET_FIELD_REJECTED")
    if _contains_auth_file_path(payload):
        raise PermanentJobError("WORKER_AUTH_FILE_PATH_REJECTED")
    simulation = payload.get("simulation")
    if simulation is not None and not isinstance(simulation, bool):
        raise PermanentJobError("WORKER_PAYLOAD_SIMULATION_FLAG_INVALID")
    if simulation is True:
        raise PermanentJobError("WORKER_SIMULATION_NOT_ALLOWED")
    if payload.get("approval_state") != "approved":
        raise PermanentJobError("WORKER_APPROVAL_REQUIRED")
    if payload.get("platform") != "facebook" or payload.get("kind") not in {"text", "image", "video"}:
        raise PermanentJobError("WORKER_PLATFORM_UNSUPPORTED")
    if payload.get("agency_contract_version") == 1:
        for field in ("brand_id", "binding_id", "identity_version_id"):
            if not isinstance(payload.get(field), str) or not payload[field].strip():
                raise PermanentJobError(f"WORKER_{field.upper()}_REQUIRED")
    for field in ("workspace_id", "page_id", "message", "idempotency_key"):
        if not isinstance(payload.get(field), str) or not payload[field].strip():
            raise PermanentJobError(f"WORKER_PAYLOAD_{field.upper()}_REQUIRED")
    if payload.get("kind") in {"image", "video"} and (not isinstance(payload.get("media_url"), str) or not payload["media_url"].strip().startswith("https://")):
        raise PermanentJobError("WORKER_PAYLOAD_MEDIA_URL_REQUIRED")
    if payload.get("media_contract_version") == 1:
        if payload.get("target_page_id") != payload.get("page_id"):
            raise PermanentJobError("WORKER_PAGE_MISMATCH")
        for field in ("brand_id", "binding_id", "identity_version_id", "media_asset_id", "reservation_id"):
            if not isinstance(payload.get(field), str) or not payload[field].strip():
                raise PermanentJobError(f"WORKER_{field.upper()}_REQUIRED" if field != "reservation_id" else "WORKER_RESERVATION_REQUIRED")
        if payload.get("media_status") not in {"eligible", "reserved"} or payload.get("media_source") not in {"public_https", "drive", "generated"}:
            raise PermanentJobError("WORKER_MEDIA_NOT_ELIGIBLE")
        if payload.get("reservation_state") != "reserved":
            raise PermanentJobError("WORKER_RESERVATION_NOT_RESERVED")
        fingerprint = payload.get("media_fingerprint")
        if not isinstance(fingerprint, str) or not fingerprint or len(fingerprint) != 16 or any(character.lower() not in "0123456789abcdef" for character in fingerprint):
            raise PermanentJobError("WORKER_MEDIA_FINGERPRINT_REQUIRED")
        fingerprint_source = payload.get("media_fingerprint_source")
        if fingerprint_source not in {"decoded_image", "decoded_video_frames"}:
            raise PermanentJobError("WORKER_MEDIA_FINGERPRINT_SOURCE_REQUIRED")
        if payload.get("kind") == "image" and fingerprint_source != "decoded_image":
            raise PermanentJobError("WORKER_IMAGE_FINGERPRINT_SOURCE_INVALID")
        if payload.get("kind") == "video" and fingerprint_source != "decoded_video_frames":
            raise PermanentJobError("WORKER_VIDEO_FINGERPRINT_REQUIRES_DECODED_FRAMES")
        media_sha256 = payload.get("media_sha256")
        if not isinstance(media_sha256, str) or len(media_sha256) != 64 or any(character.lower() not in "0123456789abcdef" for character in media_sha256):
            raise PermanentJobError("WORKER_MEDIA_SHA256_REQUIRED")


class SimulationProviderExecutor:
    def __call__(self, payload: dict[str, Any]) -> str:
        if not payload.get("simulation", False):
            raise PermanentJobError("WORKER_PROVIDER_EXECUTOR_NOT_CONFIGURED")
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]
        return f"simulation-{digest}"


class HttpProviderExecutor:
    def __init__(self, endpoint: str, auth_token: str = "", request: Callable[..., httpx.Response] | None = None, profile_id: str | None = None, runtime_id: str | None = None):
        if bool(profile_id) != bool(runtime_id):
            raise ValueError("WORKER_RUNTIME_IDENTITY_INCOMPLETE")
        self.endpoint = endpoint
        self.auth_token = auth_token
        self.request = request or httpx.post
        self.profile_id = profile_id or ""
        self.runtime_id = runtime_id or ""

    @property
    def configured(self) -> bool:
        return bool(self.endpoint and self.auth_token)

    def __call__(self, payload: dict[str, Any]) -> str:
        validate_worker_payload(payload)
        if not self.configured:
            raise PermanentJobError("WORKER_PROVIDER_AUTH_NOT_CONFIGURED")
        if payload.get("simulation") is True:
            raise PermanentJobError("WORKER_PROVIDER_LIVE_PAYLOAD_REQUIRED")
        headers = {"content-type": "application/json", "authorization": f"Bearer {self.auth_token}"}
        if self.profile_id and self.runtime_id:
            headers["x-signalflow-profile-id"] = self.profile_id
            headers["x-signalflow-runtime-id"] = self.runtime_id
        try:
            response = self.request(self.endpoint, json=payload, headers=headers, timeout=60)
        except httpx.HTTPError as error:
            raise UnknownJobOutcomeError("WORKER_PROVIDER_NETWORK_OUTCOME_UNKNOWN") from error
        if response.status_code == 429:
            raise RetryableJobError("WORKER_PROVIDER_RETRYABLE_429")
        if response.status_code == 408 or response.status_code >= 500:
            provider_code = ""
            try:
                body = response.json()
                detail = body.get("detail") if isinstance(body, dict) else None
                provider_code = detail.get("code", "") if isinstance(detail, dict) else ""
            except (TypeError, ValueError):
                pass
            if not isinstance(provider_code, str) or not provider_code.isascii() or not provider_code.replace("_", "").replace("-", "").isalnum():
                provider_code = ""
            raise UnknownJobOutcomeError(provider_code or f"WORKER_PROVIDER_OUTCOME_UNKNOWN_{response.status_code}")
        if response.status_code >= 400:
            raise PermanentJobError(f"WORKER_PROVIDER_REJECTED_{response.status_code}")
        try:
            body = response.json()
        except (TypeError, ValueError) as error:
            raise UnknownJobOutcomeError("WORKER_PROVIDER_RESPONSE_OUTCOME_UNKNOWN") from error
        provider_job_id = body.get("providerJobId") if isinstance(body, dict) else None
        if not isinstance(provider_job_id, str) or not provider_job_id:
            raise UnknownJobOutcomeError("WORKER_PROVIDER_JOB_ID_MISSING")
        return provider_job_id


def executor_from_environment() -> Callable[[dict[str, Any]], str]:
    endpoint = os.getenv("SIGNALFLOW_PROVIDER_EXECUTOR_URL", "").strip()
    if not endpoint:
        return HttpProviderExecutor(
            "",
            "",
            profile_id=os.getenv("SIGNALFLOW_PROFILE_ID", "").strip() or None,
            runtime_id=os.getenv("SIGNALFLOW_RUNTIME_ID", "").strip() or None,
        )
    return HttpProviderExecutor(
        endpoint,
        os.getenv("SIGNALFLOW_WORKER_AUTH_TOKEN", "").strip(),
        profile_id=os.getenv("SIGNALFLOW_PROFILE_ID", "").strip() or None,
        runtime_id=os.getenv("SIGNALFLOW_RUNTIME_ID", "").strip() or None,
    )


def worker_port_from_environment() -> int:
    return int(os.getenv("SIGNALFLOW_WORKER_PORT", "18788"))


def create_worker_app(store: SQLiteJobStore, executor: Callable[[dict[str, Any]], str], *, run_background: bool = True) -> FastAPI:
    store.recover_running_jobs()
    worker = AutomationWorker(store)
    stop_event = threading.Event()
    lifecycle_lock = threading.RLock()
    worker_thread: threading.Thread | None = None
    lifecycle = {"accepting_jobs": True, "stop_requested": False, "active_runs": 0}

    def worker_state() -> str:
        with lifecycle_lock:
            if not lifecycle["stop_requested"]:
                return "running"
            if lifecycle["active_runs"] > 0 or (worker_thread is not None and worker_thread.is_alive()):
                return "stopping"
            return "stopped"

    def run_once_guarded(now: float | None = None) -> dict[str, int]:
        with lifecycle_lock:
            if lifecycle["stop_requested"]:
                return {"completed": 0, "retryable": 0, "failed": 0}
            lifecycle["active_runs"] += 1
        try:
            return worker.run_once(executor, now)
        finally:
            with lifecycle_lock:
                lifecycle["active_runs"] -= 1

    def background_loop() -> None:
        while not stop_event.is_set():
            run_once_guarded()
            stop_event.wait(60)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        nonlocal worker_thread
        if run_background:
            worker_thread = threading.Thread(target=background_loop, daemon=True)
            worker_thread.start()
        try:
            yield
        finally:
            stop_event.set()
            if worker_thread:
                worker_thread.join(timeout=2)

    app = FastAPI(title="SignalFlow Automation Worker", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["null"],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
    )

    @app.get("/health")
    def health(workspace_id: str | None = None) -> dict[str, Any]:
        profile_id = os.getenv("SIGNALFLOW_PROFILE_ID", "").strip() or None
        runtime_id = os.getenv("SIGNALFLOW_RUNTIME_ID", "").strip() or None
        return {
            "ok": True,
            "service": "signalflow-automation-worker",
            "workerMode": "http_provider_executor",
            "executorConfigured": isinstance(executor, HttpProviderExecutor) and executor.configured,
            "configurationStatus": "ready" if isinstance(executor, HttpProviderExecutor) and executor.configured else "blocked",
            "workerState": worker_state(),
            "acceptingJobs": lifecycle["accepting_jobs"],
            "safeStopRequested": lifecycle["stop_requested"],
            "inFlightExecutions": lifecycle["active_runs"],
            "queue": store.summary(workspace_id),
            "supportsRecovery": True,
            "dbPath": store.path,
            "profileId": profile_id,
            "runtimeId": runtime_id,
        }

    @app.post("/v1/jobs")
    def enqueue(request: EnqueueJobRequest) -> dict[str, Any]:
        if not lifecycle["accepting_jobs"]:
            raise HTTPException(status_code=409, detail={"code": "WORKER_SAFE_STOP_ACTIVE", "message": "Worker is safely stopped and not accepting new jobs."})
        try:
            validate_worker_payload(request.payload)
        except PermanentJobError as error:
            raise HTTPException(status_code=400, detail={"code": str(error), "message": "Worker payload is not eligible for execution."}) from error
        job = store.enqueue(request.job_id, request.idempotency_key, request.scheduled_at, request.payload)
        return {"jobId": job["id"], "state": job["state"], "revision": job["revision"], "scheduled_at": job["scheduled_at"], "provider_job_id": job["provider_job_id"]}

    @app.get("/v1/jobs")
    def list_jobs(workspace_id: str | None = None) -> list[dict[str, Any]]:
        return store.list_jobs(include_payload=False, workspace_id=workspace_id)

    @app.post("/v1/jobs/{job_id}/action")
    def action(job_id: str, request: JobActionRequest) -> dict[str, Any]:
        try:
            return store.mutate(job_id, request.action, request.request_id, request.scheduled_at, expected_revision=request.expected_revision)
        except JobMutationError as error:
            code = str(error)
            status = 404 if code == "WORKER_JOB_NOT_FOUND" else 409 if code in {"WORKER_JOB_STATE_CONFLICT", "WORKER_JOB_OUTCOME_UNKNOWN", "WORKER_JOB_REVISION_CONFLICT", "WORKER_JOB_REQUEST_ID_REUSED"} else 400
            raise HTTPException(status_code=status, detail={"code": code, "message": "Worker job mutation was rejected."}) from error

    @app.post("/v1/run-once")
    def run_once(request: RunOnceRequest) -> dict[str, int]:
        if not lifecycle["accepting_jobs"]:
            raise HTTPException(status_code=409, detail={"code": "WORKER_SAFE_STOP_ACTIVE", "message": "Worker is safely stopped."})
        return run_once_guarded(request.now)

    @app.post("/v1/stop")
    def stop(request: WorkerControlRequest) -> dict[str, Any]:
        with lifecycle_lock:
            lifecycle["accepting_jobs"] = False
            lifecycle["stop_requested"] = True
            stop_event.set()
            active_runs = lifecycle["active_runs"]
            thread = worker_thread
        if active_runs == 0 and thread is not None and thread is not threading.current_thread():
            thread.join(timeout=2)
        state = worker_state()
        return {"ok": True, "state": state, "acceptingJobs": False, "safeStopRequested": True, "inFlightExecutions": lifecycle["active_runs"], "reason": request.reason}

    @app.post("/v1/recover")
    def recover(request: WorkerControlRequest) -> dict[str, Any]:
        with lifecycle_lock:
            accepting_jobs = lifecycle["accepting_jobs"]
            active_runs = lifecycle["active_runs"]
            thread = worker_thread
        if accepting_jobs:
            raise HTTPException(status_code=409, detail={"code": "WORKER_MUST_BE_STOPPED", "message": "Stop the worker before recovering interrupted jobs."})
        if active_runs > 0:
            raise HTTPException(status_code=409, detail={"code": "WORKER_EXECUTION_IN_FLIGHT", "message": "Recovery is blocked until the in-flight worker execution returns."})
        if thread is not None and thread.is_alive():
            raise HTTPException(status_code=409, detail={"code": "WORKER_STOP_IN_PROGRESS", "message": "Recovery is blocked until the worker thread has stopped."})
        recovered = store.recover_running_jobs()
        return {"ok": True, "state": "stopped", "acceptingJobs": False, "recoveredJobs": recovered, "reason": request.reason, "queue": store.summary()}

    return app


def main() -> None:
    import uvicorn

    database_path = Path(os.getenv("SIGNALFLOW_WORKER_DB", "signalflow-worker.sqlite3"))
    port = worker_port_from_environment()
    uvicorn.run(create_worker_app(SQLiteJobStore(database_path), executor_from_environment()), host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
