import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import httpx
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient

from automation_worker import PermanentJobError, RetryableJobError, SQLiteJobStore, UnknownJobOutcomeError
from automation_worker_service import HttpProviderExecutor, create_worker_app, executor_from_environment, worker_port_from_environment


class AutomationWorkerServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = SQLiteJobStore(Path(self.temp_dir.name) / "worker.sqlite3")
        self.client = TestClient(create_worker_app(self.store, lambda _payload: "injected-provider", run_background=False))

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_default_port_and_health_contract_match_electron_loopback(self):
        previous = os.environ.pop("SIGNALFLOW_WORKER_PORT", None)
        try:
            self.assertEqual(worker_port_from_environment(), 18788)
            os.environ["SIGNALFLOW_WORKER_PORT"] = "19876"
            self.assertEqual(worker_port_from_environment(), 19876)
        finally:
            if previous is None:
                os.environ.pop("SIGNALFLOW_WORKER_PORT", None)
            else:
                os.environ["SIGNALFLOW_WORKER_PORT"] = previous

        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["service"], "signalflow-automation-worker")
        self.assertTrue(response.json()["ok"])
        self.assertEqual(response.json()["workerState"], "running")
        self.assertEqual(response.json()["workerMode"], "http_provider_executor")
        self.assertEqual(response.json()["configurationStatus"], "blocked")

    def test_unconfigured_worker_reports_blocked_provider_executor_without_simulation_mode(self):
        with patch.dict(os.environ, {"SIGNALFLOW_PROVIDER_EXECUTOR_URL": "", "SIGNALFLOW_PROFILE_ID": "", "SIGNALFLOW_RUNTIME_ID": ""}, clear=False):
            client = TestClient(create_worker_app(self.store, executor_from_environment(), run_background=False))
        health = client.get("/health").json()
        self.assertEqual(health["workerMode"], "http_provider_executor")
        self.assertEqual(health["configurationStatus"], "blocked")

    def test_worker_rejects_simulated_payloads_at_enqueue_boundary(self):
        response = self.client.post("/v1/jobs", json={"job_id": "job-simulation-removed", "idempotency_key": "key-simulation-removed", "scheduled_at": 100.0, "payload": {"simulation": True, "message": "must not run"}})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "WORKER_SIMULATION_NOT_ALLOWED")

    def test_worker_launcher_disables_python_bytecode_for_both_children_without_changing_identity(self):
        repository_root = Path(__file__).resolve().parents[1]
        launcher_path = repository_root / "scripts" / "run-local-worker.mjs"
        supervisor_path = repository_root / "desktop" / "worker-supervisor.cjs"
        user_data_root = Path(tempfile.mkdtemp(prefix="signalflow-launcher-bytecode-"))
        profile_root = user_data_root / "profiles" / "profile-qc"
        capture_path = user_data_root / "children.jsonl"
        fake_uv_path = user_data_root / "fake-uv.cjs"
        fake_uv_path.write_text(
            "#!/usr/bin/env node\n"
            "const fs = require('node:fs');\n"
            f"fs.appendFileSync({json.dumps(str(capture_path))}, JSON.stringify({{ args: process.argv.slice(2), env: {{ PORT: process.env.PORT, SIGNALFLOW_CONTROL_PLANE_PORT: process.env.SIGNALFLOW_CONTROL_PLANE_PORT, SIGNALFLOW_WORKER_PORT: process.env.SIGNALFLOW_WORKER_PORT, SIGNALFLOW_PROFILE_ID: process.env.SIGNALFLOW_PROFILE_ID, SIGNALFLOW_RUNTIME_ID: process.env.SIGNALFLOW_RUNTIME_ID, SIGNALFLOW_CONTROL_PLANE_DB: process.env.SIGNALFLOW_CONTROL_PLANE_DB, SIGNALFLOW_WORKER_DB: process.env.SIGNALFLOW_WORKER_DB, PYTHONDONTWRITEBYTECODE: process.env.PYTHONDONTWRITEBYTECODE }} }}) + '\\n');\n",
            encoding="utf-8",
        )
        fake_uv_path.chmod(0o755)
        control_db = profile_root / "signalflow-control-plane.sqlite3"
        worker_db = profile_root / "signalflow-worker.sqlite3"
        launcher_environment = {
            **os.environ,
            "SIGNALFLOW_UV": str(fake_uv_path),
            "SIGNALFLOW_PROFILE_ID": "profile-qc",
            "SIGNALFLOW_RUNTIME_ID": "runtime-profile-qc-1",
            "SIGNALFLOW_CONTROL_PLANE_DB": str(control_db),
            "SIGNALFLOW_WORKER_DB": str(worker_db),
            "SIGNALFLOW_CONTROL_PLANE_PORT": "19787",
            "SIGNALFLOW_WORKER_PORT": "19788",
            "PYTHONDONTWRITEBYTECODE": "0",
        }
        launcher_result = subprocess.run(
            ["node", str(launcher_path)], cwd=user_data_root, env=launcher_environment,
            capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(launcher_result.returncode, 1, launcher_result.stderr)
        records = [json.loads(line) for line in capture_path.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(records), 2)
        control = next(record for record in records if record["env"].get("PORT") == "19787")
        worker = next(record for record in records if record["args"][-1] == str(repository_root / "backend" / "automation_worker_service.py"))
        self.assertIsNot(control, worker)
        self.assertEqual(control["args"][-1], str(repository_root / "backend" / "control_plane_service.py"))
        self.assertEqual(control["env"]["PORT"], "19787")
        self.assertEqual(worker["env"]["SIGNALFLOW_WORKER_PORT"], "19788")
        for record in (control, worker):
            self.assertEqual(record["env"]["PYTHONDONTWRITEBYTECODE"], "1")
            self.assertEqual(record["env"]["SIGNALFLOW_PROFILE_ID"], "profile-qc")
            self.assertEqual(record["env"]["SIGNALFLOW_RUNTIME_ID"], "runtime-profile-qc-1")
            self.assertEqual(record["env"]["SIGNALFLOW_CONTROL_PLANE_PORT"], "19787")
        self.assertEqual(control["env"]["SIGNALFLOW_CONTROL_PLANE_DB"], str(control_db))
        self.assertEqual(worker["env"]["SIGNALFLOW_WORKER_DB"], str(worker_db))

        spec_script = (
            f"const {{ buildWorkerLauncherSpec }} = require({json.dumps(str(supervisor_path))});"
            f"const spec = buildWorkerLauncherSpec({json.dumps({'isPackaged': True, 'resourcesPath': '/Applications/SignalFlow.app/Contents/Resources', 'sourceRoot': str(repository_root), 'userDataRoot': str(user_data_root), 'profileId': 'profile-qc', 'runtimeId': 'runtime-profile-qc-1', 'nodePath': '/Applications/SignalFlow.app/Contents/MacOS/SignalFlow', 'env': {'SIGNALFLOW_CONTROL_PLANE_PORT': '19787', 'SIGNALFLOW_WORKER_PORT': '19788', 'PYTHONDONTWRITEBYTECODE': '0', 'CUSTOM_LAUNCHER_ENV': 'preserve-me'}})});"
            "process.stdout.write(JSON.stringify({ guard: spec.env.PYTHONDONTWRITEBYTECODE, custom: spec.env.CUSTOM_LAUNCHER_ENV, controlPort: spec.env.SIGNALFLOW_CONTROL_PLANE_PORT, workerPort: spec.env.SIGNALFLOW_WORKER_PORT, controlDb: spec.env.SIGNALFLOW_CONTROL_PLANE_DB, workerDb: spec.env.SIGNALFLOW_WORKER_DB }));"
        )
        spec_result = subprocess.run(["node", "-e", spec_script], cwd=repository_root, capture_output=True, text=True, check=True)
        spec = json.loads(spec_result.stdout)
        self.assertEqual(spec["guard"], "1")
        self.assertEqual(spec["custom"], "preserve-me")
        self.assertEqual(spec["controlPort"], "19787")
        self.assertEqual(spec["workerPort"], "19788")
        self.assertEqual(os.path.realpath(spec["controlDb"]), os.path.realpath(str(control_db)))
        self.assertEqual(os.path.realpath(spec["workerDb"]), os.path.realpath(str(worker_db)))

    def test_enqueue_and_run_once_is_durable_and_idempotent(self):
        job = {
            "job_id": "job-1",
            "idempotency_key": "workspace-1:post-1",
            "scheduled_at": 100.0,
            "payload": {"simulation": False, "approval_state": "approved", "workspace_id": "workspace-1", "page_id": "123456", "message": "approved post", "platform": "facebook", "kind": "text", "idempotency_key": "workspace-1:post-1"},
        }
        first = self.client.post("/v1/jobs", json=job)
        second = self.client.post("/v1/jobs", json={**job, "job_id": "job-duplicate"})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["jobId"], second.json()["jobId"])
        result = self.client.post("/v1/run-once", json={"now": 100.0})
        self.assertEqual(result.json(), {"completed": 1, "retryable": 0, "failed": 0, "unknown": 0})
        self.assertEqual(self.client.get("/v1/jobs").json()[0]["state"], "completed")
        self.assertNotIn("payload", self.client.get("/v1/jobs").json()[0])
        replay = self.client.post("/v1/jobs", json={**job, "job_id": "job-replay"})
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["jobId"], "job-1")
        self.assertEqual(replay.json()["state"], "completed")
        self.assertEqual(replay.json()["revision"], 0)
        self.assertEqual(replay.json()["scheduled_at"], 100.0)
        self.assertIsNotNone(replay.json()["provider_job_id"])

    def test_action_endpoint_is_durable_targeted_and_idempotent(self):
        job = {"job_id": "job-action", "idempotency_key": "workspace-1:action", "scheduled_at": 4102444800.0, "payload": {"simulation": False, "approval_state": "approved", "workspace_id": "workspace-1", "page_id": "123456", "message": "approved post", "platform": "facebook", "kind": "text", "idempotency_key": "workspace-1:action"}}
        self.assertEqual(self.client.post("/v1/jobs", json=job).status_code, 200)
        missing_revision = self.client.post("/v1/jobs/job-action/action", json={"action": "reschedule", "request_id": "missing-revision", "scheduled_at": 4102448400.0})
        self.assertEqual(missing_revision.status_code, 422)
        moved = self.client.post("/v1/jobs/job-action/action", json={"action": "reschedule", "request_id": "request-1", "expected_revision": 0, "scheduled_at": 4102448400.0})
        self.assertEqual(moved.status_code, 200)
        self.assertEqual(moved.json()["scheduled_at"], 4102448400.0)
        self.assertEqual(moved.json()["revision"], 1)
        changed_replay = self.client.post("/v1/jobs/job-action/action", json={"action": "reschedule", "request_id": "request-1", "expected_revision": 0, "scheduled_at": 4102452000.0})
        self.assertEqual(changed_replay.status_code, 409)
        self.assertEqual(changed_replay.json()["detail"]["code"], "WORKER_JOB_REQUEST_ID_REUSED")
        newer = self.client.post("/v1/jobs/job-action/action", json={"action": "reschedule", "request_id": "request-2", "expected_revision": 1, "scheduled_at": 4102452000.0})
        self.assertEqual(newer.status_code, 200)
        repeated = self.client.post("/v1/jobs/job-action/action", json={"action": "reschedule", "request_id": "request-1", "expected_revision": 0, "scheduled_at": 4102448400.0})
        self.assertEqual(repeated.json()["scheduled_at"], 4102448400.0)
        self.assertEqual(self.client.get("/v1/jobs").json()[0]["scheduled_at"], 4102452000.0)
        stale = self.client.post("/v1/jobs/job-action/action", json={"action": "cancel", "request_id": "stale", "expected_revision": 1})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["detail"]["code"], "WORKER_JOB_REVISION_CONFLICT")
        canceled = self.client.post("/v1/jobs/job-action/action", json={"action": "cancel", "request_id": "request-3", "expected_revision": 2})
        self.assertEqual(canceled.json()["state"], "canceled")
        self.assertEqual(canceled.json()["revision"], 3)
        restarted_store = SQLiteJobStore(Path(self.temp_dir.name) / "worker.sqlite3")
        calls = []
        restarted_client = TestClient(create_worker_app(restarted_store, lambda payload: calls.append(payload) or "unexpected", run_background=False))
        self.assertEqual(restarted_client.post("/v1/run-once", json={"now": 4102452000.0}).json(), {"completed": 0, "retryable": 0, "failed": 0, "unknown": 0})
        self.assertEqual(restarted_store.list_jobs()[0]["state"], "canceled")
        self.assertEqual(calls, [])

    def test_allows_only_electron_file_origin_for_loopback_requests(self):
        response = self.client.options("/health", headers={"Origin": "null", "Access-Control-Request-Method": "GET"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "null")

    def test_live_payload_requires_approval_and_real_executor_configuration(self):
        job = {
            "job_id": "job-1",
            "idempotency_key": "workspace-1:post-1",
            "scheduled_at": 100.0,
            "payload": {"simulation": False, "workspace_id": "workspace-1", "page_id": "123456", "message": "approved post", "platform": "facebook", "kind": "text", "idempotency_key": "workspace-1:post-1"},
        }
        rejected = self.client.post("/v1/jobs", json=job)
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(rejected.json()["detail"]["code"], "WORKER_APPROVAL_REQUIRED")

    def test_safe_stop_blocks_new_jobs_and_recovers_interrupted_jobs(self):
        running = {
            "job_id": "job-1",
            "idempotency_key": "workspace-1:post-1",
            "scheduled_at": 100.0,
            "payload": {"simulation": False, "approval_state": "approved", "workspace_id": "workspace-1", "page_id": "123456", "message": "approved post", "platform": "facebook", "kind": "text", "idempotency_key": "workspace-1:post-1"},
        }
        self.assertEqual(self.client.post("/v1/jobs", json=running).status_code, 200)
        self.store.claim_due(100.0)

        stopped = self.client.post("/v1/stop", json={"reason": "operator_test"})
        self.assertEqual(stopped.status_code, 200)
        self.assertFalse(stopped.json()["acceptingJobs"])
        blocked = self.client.post("/v1/jobs", json={**running, "job_id": "job-2", "idempotency_key": "workspace-1:post-2"})
        self.assertEqual(blocked.status_code, 409)

        recovered = self.client.post("/v1/recover", json={"reason": "operator_test_recovery"})
        self.assertEqual(recovered.status_code, 200)
        self.assertEqual(recovered.json()["recoveredJobs"], 1)
        self.assertEqual(self.client.get("/v1/jobs").json()[0]["state"], "unknown")
        health = self.client.get("/health").json()
        self.assertEqual(health["workerState"], "stopped")
        self.assertTrue(health["supportsRecovery"])

    def test_stop_and_recover_barrier_blocks_requeue_during_inflight_executor(self):
        started = threading.Event()
        release = threading.Event()

        def blocking_executor(_payload):
            started.set()
            self.assertTrue(release.wait(timeout=2))
            return "provider-after-stop"

        blocking_client = TestClient(create_worker_app(self.store, blocking_executor, run_background=False))
        job = {
            "job_id": "job-inflight",
            "idempotency_key": "workspace-1:inflight",
            "scheduled_at": 100.0,
            "payload": {"simulation": False, "approval_state": "approved", "workspace_id": "workspace-1", "page_id": "123456", "message": "approved post", "platform": "facebook", "kind": "text", "idempotency_key": "workspace-1:inflight"},
        }
        self.assertEqual(blocking_client.post("/v1/jobs", json=job).status_code, 200)
        run_result = {}
        run_thread = threading.Thread(target=lambda: run_result.setdefault("response", blocking_client.post("/v1/run-once", json={"now": 100.0})))
        run_thread.start()
        self.assertTrue(started.wait(timeout=2))

        stopped = blocking_client.post("/v1/stop", json={"reason": "blocking-test"})
        self.assertEqual(stopped.status_code, 200)
        self.assertEqual(stopped.json()["state"], "stopping")
        self.assertEqual(stopped.json()["inFlightExecutions"], 1)
        blocked = blocking_client.post("/v1/recover", json={"reason": "too-early"})
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()["detail"]["code"], "WORKER_EXECUTION_IN_FLIGHT")

        release.set()
        run_thread.join(timeout=2)
        self.assertFalse(run_thread.is_alive())
        self.assertEqual(run_result["response"].json(), {"completed": 1, "retryable": 0, "failed": 0, "unknown": 0})
        recovered = blocking_client.post("/v1/recover", json={"reason": "after-completion"})
        self.assertEqual(recovered.status_code, 200)
        self.assertEqual(recovered.json()["recoveredJobs"], 0)
        self.assertEqual(blocking_client.get("/v1/jobs").json()[0]["state"], "completed")

    def test_http_provider_executor_forwards_only_approved_live_payload_and_returns_scalar_id(self):
        class Response:
            def __init__(self, status_code, body):
                self.status_code = status_code
                self._body = body

            def json(self):
                return self._body

        calls = []
        executor = HttpProviderExecutor("http://provider.local", auth_token="worker-secret", request=lambda *args, **kwargs: calls.append((args, kwargs)) or Response(200, {"providerJobId": "meta-1"}))
        payload = {
            "workspace_id": "workspace-1",
            "page_id": "123456",
            "message": "Approved",
            "idempotency_key": "workspace-1:post-1",
            "approval_state": "approved",
            "platform": "facebook",
            "kind": "text",
            "simulation": False,
        }
        self.assertEqual(executor(payload), "meta-1")
        self.assertEqual(calls[0][1]["json"], payload)
        self.assertEqual(calls[0][1]["headers"]["authorization"], "Bearer worker-secret")
        with self.assertRaises(Exception):
            executor({**payload, "access_token": "must-not-forward"})

    def test_environment_executor_forwards_the_runtime_identity_to_control_plane(self):
        class Response:
            status_code = 200

            @staticmethod
            def json():
                return {"providerJobId": "meta-runtime-1"}

        calls = []

        def request(endpoint, *, json, headers, timeout):
            calls.append({"endpoint": endpoint, "headers": headers, "timeout": timeout})
            return Response()

        env = {
            "SIGNALFLOW_PROVIDER_EXECUTOR_URL": "http://127.0.0.1:18787/v1/worker/meta/page-text",
            "SIGNALFLOW_WORKER_AUTH_TOKEN": "worker-secret",
            "SIGNALFLOW_PROFILE_ID": "profile-a",
            "SIGNALFLOW_RUNTIME_ID": "runtime-profile-a-1",
        }
        payload = {
            "workspace_id": "workspace-1", "page_id": "123456", "message": "Approved",
            "idempotency_key": "workspace-1:runtime-1", "approval_state": "approved",
            "platform": "facebook", "kind": "text", "simulation": False,
        }
        with patch.dict(os.environ, env, clear=False), patch("automation_worker_service.httpx.post", side_effect=request):
            self.assertEqual(executor_from_environment()(payload), "meta-runtime-1")
        self.assertEqual(calls[0]["headers"]["x-signalflow-profile-id"], "profile-a")
        self.assertEqual(calls[0]["headers"]["x-signalflow-runtime-id"], "runtime-profile-a-1")

    def test_environment_executor_rejects_partial_runtime_identity(self):
        with patch.dict(os.environ, {
            "SIGNALFLOW_PROVIDER_EXECUTOR_URL": "http://127.0.0.1:18787/v1/worker/meta/page-text",
            "SIGNALFLOW_PROFILE_ID": "profile-a",
        }, clear=False):
            os.environ.pop("SIGNALFLOW_RUNTIME_ID", None)
            with self.assertRaisesRegex(ValueError, "WORKER_RUNTIME_IDENTITY_INCOMPLETE"):
                executor_from_environment()

    def test_http_provider_executor_accepts_approved_live_image_payload_with_public_media_url(self):
        class Response:
            status_code = 200

            @staticmethod
            def json():
                return {"providerJobId": "meta-photo-1"}

        calls = []
        executor = HttpProviderExecutor("http://provider.local", auth_token="worker-secret", request=lambda *args, **kwargs: calls.append((args, kwargs)) or Response())
        payload = {
            "workspace_id": "workspace-1",
            "page_id": "123456",
            "message": "Bellamy caption",
            "media_url": "https://drive.google.com/file/d/asset/view?usp=sharing",
            "idempotency_key": "workspace-1:photo-1",
            "approval_state": "approved",
            "platform": "facebook",
            "kind": "image",
            "simulation": False,
        }

        self.assertEqual(executor(payload), "meta-photo-1")
        self.assertEqual(calls[0][1]["json"], payload)

    def test_http_provider_executor_is_fail_closed_when_auth_is_missing(self):
        executor = HttpProviderExecutor("http://provider.local", request=lambda *_args, **_kwargs: self.fail("provider must not be called"))
        with self.assertRaises(Exception) as context:
            executor({
                "workspace_id": "workspace-1",
                "page_id": "123456",
                "message": "Approved",
                "idempotency_key": "key-1",
                "approval_state": "approved",
                "platform": "facebook",
                "kind": "text",
                "simulation": False,
            })
        self.assertIn("WORKER_PROVIDER_AUTH_NOT_CONFIGURED", str(context.exception))

    def test_http_provider_executor_classifies_scope_rejection_as_permanent(self):
        class Response:
            status_code = 403

            @staticmethod
            def json():
                return {"detail": {"code": "META_WORKER_PAGE_PUBLISH_SCOPE_REQUIRED", "message": "Page publish permission is missing."}}

        executor = HttpProviderExecutor("http://provider.local", auth_token="worker-secret", request=lambda *_args, **_kwargs: Response())
        with self.assertRaises(PermanentJobError) as context:
            executor({
                "workspace_id": "workspace-1",
                "page_id": "123456",
                "message": "Approved",
                "idempotency_key": "key-scope-1",
                "approval_state": "approved",
                "platform": "facebook",
                "kind": "text",
                "simulation": False,
            })
        self.assertEqual(str(context.exception), "WORKER_PROVIDER_REJECTED_403")

    def test_http_provider_executor_marks_5xx_outcome_unknown(self):
        class Response:
            status_code = 503

            @staticmethod
            def json():
                return {}

        executor = HttpProviderExecutor("http://provider.local", auth_token="worker-secret", request=lambda *_args, **_kwargs: Response())
        with self.assertRaises(UnknownJobOutcomeError):
            executor({
                "workspace_id": "workspace-1",
                "page_id": "123456",
                "message": "Approved",
                "idempotency_key": "key-1",
                "approval_state": "approved",
                "platform": "facebook",
                "kind": "text",
                "simulation": False,
            })

    def test_http_provider_executor_marks_network_timeout_outcome_unknown(self):
        executor = HttpProviderExecutor("http://provider.local", auth_token="worker-secret", request=lambda *_args, **_kwargs: (_ for _ in ()).throw(httpx.ReadTimeout("connection timed out")))
        with self.assertRaises(UnknownJobOutcomeError):
            executor({
                "workspace_id": "workspace-1",
                "page_id": "123456",
                "message": "Approved",
                "idempotency_key": "key-timeout-1",
                "approval_state": "approved",
                "platform": "facebook",
                "kind": "text",
                "simulation": False,
            })


if __name__ == "__main__":
    unittest.main()
