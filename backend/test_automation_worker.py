import unittest
import os
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from automation_worker import AutomationWorker, PermanentJobError, RetryableJobError, SQLiteJobStore, UnknownJobOutcomeError


class AutomationWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = SQLiteJobStore(Path(self.temp_dir.name) / "worker.sqlite3")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_enqueue_is_idempotent_by_key(self):
        first = self.store.enqueue("job-1", "plan:day:facebook:0", 100.0, {"message": "hello"})
        second = self.store.enqueue("job-2", "plan:day:facebook:0", 100.0, {"message": "duplicate"})

        self.assertEqual(first, second)
        self.assertEqual(len(self.store.list_jobs()), 1)

    def test_enqueue_replay_returns_the_existing_job_state_revision_and_provider_evidence(self):
        self.store.enqueue("job-existing", "key-existing", 100.0, {"message": "approved"})
        self.store.claim_due(100.0)
        self.store.complete("job-existing", "provider-existing", now=100.0)

        replay = self.store.enqueue("job-requested", "key-existing", 200.0, {"message": "new payload"})

        self.assertEqual(replay["id"], "job-existing")
        self.assertEqual(replay["state"], "completed")
        self.assertEqual(replay["revision"], 0)
        self.assertEqual(replay["provider_job_id"], "provider-existing")
        self.assertEqual(replay["scheduled_at"], 100.0)

    def test_enqueue_replay_returns_the_existing_queued_revision_and_schedule(self):
        self.store.enqueue("job-revision", "key-revision", 100.0, {"message": "approved"})
        self.store.mutate("job-revision", "reschedule", "reschedule-revision", 150.0, expected_revision=0, now=50.0)

        replay = self.store.enqueue("job-requested", "key-revision", 200.0, {"message": "approved"})

        self.assertEqual(replay["id"], "job-revision")
        self.assertEqual(replay["state"], "queued")
        self.assertEqual(replay["revision"], 1)
        self.assertEqual(replay["scheduled_at"], 150.0)

    def test_run_once_completes_due_job_and_does_not_repeat_it(self):
        self.store.enqueue("job-1", "key-1", 100.0, {"message": "hello"})
        calls = []
        worker = AutomationWorker(self.store, retry_delay_seconds=30)

        first = worker.run_once(lambda payload: calls.append(payload) or "provider-1", now=100.0)
        second = worker.run_once(lambda payload: calls.append(payload) or "provider-2", now=101.0)

        self.assertEqual(first, {"completed": 1, "retryable": 0, "failed": 0, "unknown": 0})
        self.assertEqual(second, {"completed": 0, "retryable": 0, "failed": 0, "unknown": 0})
        self.assertEqual(calls, [{"message": "hello"}])
        self.assertEqual(self.store.list_jobs()[0]["provider_job_id"], "provider-1")

    def test_job_state_survives_store_reopen(self):
        database_path = Path(self.temp_dir.name) / "worker.sqlite3"
        self.store.enqueue("job-1", "key-1", 100.0, {"message": "hello"})
        reopened = SQLiteJobStore(database_path)
        self.assertEqual(reopened.list_jobs()[0]["idempotency_key"], "key-1")
        AutomationWorker(reopened).run_once(lambda _payload: "provider-1", now=100.0)
        self.assertEqual(SQLiteJobStore(database_path).list_jobs()[0]["state"], "completed")

    def test_retryable_failure_requeues_without_duplicate_claim(self):
        self.store.enqueue("job-1", "key-1", 100.0, {"message": "hello"})
        worker = AutomationWorker(self.store, retry_delay_seconds=30)

        result = worker.run_once(lambda _payload: (_ for _ in ()).throw(RetryableJobError("temporary")), now=100.0)

        self.assertEqual(result, {"completed": 0, "retryable": 1, "failed": 0, "unknown": 0})
        job = self.store.list_jobs()[0]
        self.assertEqual(job["state"], "queued")
        self.assertEqual(job["attempts"], 1)
        self.assertEqual(job["next_attempt_at"], 130.0)

    def test_permanent_failure_stops_retrying(self):
        self.store.enqueue("job-1", "key-1", 100.0, {"message": "hello"})
        worker = AutomationWorker(self.store)

        result = worker.run_once(lambda _payload: (_ for _ in ()).throw(PermanentJobError("invalid")), now=100.0)

        self.assertEqual(result, {"completed": 0, "retryable": 0, "failed": 1, "unknown": 0})
        self.assertEqual(self.store.list_jobs()[0]["state"], "failed")

    def test_recover_running_jobs_and_redact_payloads_from_default_listing(self):
        self.store.enqueue("job-1", "key-1", 100.0, {"message": "approved", "access_token": "never-return"})
        self.store.claim_due(100.0)

        self.assertEqual(self.store.summary(), {"queued": 0, "running": 1, "completed": 0, "failed": 0, "unknown": 0})
        self.assertEqual(self.store.list_jobs()[0]["state"], "running")
        self.assertNotIn("payload", self.store.list_jobs()[0])

        self.assertEqual(self.store.recover_running_jobs(101.0), 1)
        recovered = self.store.list_jobs(include_payload=True)[0]
        self.assertEqual(recovered["state"], "unknown")
        self.assertEqual(recovered["payload"]["message"], "approved")

    def test_list_and_summary_can_be_scoped_to_workspace(self):
        self.store.enqueue("job-a", "key-a", 100.0, {"workspace_id": "workspace-a", "simulation": True})
        self.store.enqueue("job-b", "key-b", 100.0, {"workspace_id": "workspace-b", "simulation": True})
        self.assertEqual([job["id"] for job in self.store.list_jobs(workspace_id="workspace-a")], ["job-a"])
        self.assertEqual(self.store.summary("workspace-a"), {"queued": 1, "running": 0, "completed": 0, "failed": 0, "unknown": 0})

    def test_job_mutations_are_revision_guarded_and_request_ids_are_fingerprinted(self):
        self.store.enqueue("job-1", "key-1", 100.0, {"workspace_id": "workspace-a", "simulation": True})
        first = self.store.mutate("job-1", "reschedule", "request-1", 200.0, expected_revision=0, now=150.0)
        second = self.store.mutate("job-1", "reschedule", "request-2", 300.0, expected_revision=1, now=150.0)
        repeated = self.store.mutate("job-1", "reschedule", "request-1", 200.0, expected_revision=0, now=150.0)
        self.assertEqual(first["scheduled_at"], 200.0)
        self.assertEqual(repeated["scheduled_at"], 200.0)
        self.assertEqual(second["scheduled_at"], 300.0)
        self.assertEqual(self.store.list_jobs()[0]["scheduled_at"], 300.0)
        with self.assertRaisesRegex(Exception, "WORKER_JOB_REQUEST_ID_REUSED"):
            self.store.mutate("job-1", "cancel", "request-1", expected_revision=0, now=150.0)
        with self.assertRaisesRegex(Exception, "WORKER_JOB_REVISION_CONFLICT"):
            self.store.mutate("job-1", "cancel", "request-stale", expected_revision=0, now=150.0)
        canceled = self.store.mutate("job-1", "cancel", "request-3", expected_revision=2, now=150.0)
        self.assertEqual(canceled["state"], "canceled")
        self.store.enqueue("job-2", "key-2", 100.0, {"workspace_id": "workspace-a", "simulation": True})
        self.store.claim_due(100.0)
        with self.assertRaisesRegex(Exception, "WORKER_JOB_STATE_CONFLICT"):
            self.store.mutate("job-2", "cancel", "request-4", expected_revision=0, now=100.0)

    def test_interrupted_running_job_becomes_unknown_and_never_reaches_executor_after_restart(self):
        database_path = Path(self.temp_dir.name) / "worker.sqlite3"
        self.store.enqueue("job-running", "key-running", 100.0, {"workspace_id": "workspace-a", "simulation": True})
        self.store.claim_due(100.0)
        restarted = SQLiteJobStore(database_path)

        self.assertEqual(restarted.recover_running_jobs(101.0), 1)
        calls = []
        self.assertEqual(AutomationWorker(restarted).run_once(lambda payload: calls.append(payload) or "should-not-run", now=1000.0), {"completed": 0, "retryable": 0, "failed": 0, "unknown": 0})
        self.assertEqual(restarted.list_jobs()[0]["state"], "unknown")
        self.assertEqual(calls, [])
        with self.assertRaisesRegex(Exception, "WORKER_JOB_OUTCOME_UNKNOWN"):
            restarted.mutate("job-running", "cancel", "request-unknown", expected_revision=0, now=101.0)

    def test_unknown_provider_outcome_is_not_retried_after_restart(self):
        database_path = Path(self.temp_dir.name) / "worker.sqlite3"
        self.store.enqueue("job-unknown", "key-unknown", 100.0, {"workspace_id": "workspace-a", "simulation": True})
        calls = []

        def unknown(_payload):
            calls.append("called")
            raise UnknownJobOutcomeError("provider outcome could not be confirmed")

        self.assertEqual(AutomationWorker(self.store).run_once(unknown, now=100.0), {"completed": 0, "retryable": 0, "failed": 0, "unknown": 1})
        restarted = SQLiteJobStore(database_path)
        self.assertEqual(AutomationWorker(restarted).run_once(lambda _payload: calls.append("replayed") or "duplicate", now=1000.0), {"completed": 0, "retryable": 0, "failed": 0, "unknown": 0})
        self.assertEqual(restarted.list_jobs()[0]["state"], "unknown")
        self.assertEqual(calls, ["called"])


if __name__ == "__main__":
    unittest.main()
