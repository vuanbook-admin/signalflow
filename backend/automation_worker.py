"""Portable durable job worker core.

Provider execution is injected by the caller. This module owns persistence,
idempotency, claiming and retry semantics so a future Meta/Drive executor can
run independently of the desktop window.
"""

from __future__ import annotations

import json
import hashlib
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
import time
from pathlib import Path
from typing import Any, Callable


class RetryableJobError(RuntimeError):
    pass


class PermanentJobError(RuntimeError):
    pass


class UnknownJobOutcomeError(RuntimeError):
    pass


class JobMutationError(RuntimeError):
    pass


class SQLiteJobStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connection() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS automation_jobs (
                    id TEXT PRIMARY KEY,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    scheduled_at REAL NOT NULL,
                    next_attempt_at REAL NOT NULL,
                    payload_json TEXT NOT NULL,
                    state TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    provider_job_id TEXT,
                    last_error TEXT,
                    updated_at REAL NOT NULL
                )
                """
            )
            columns = {row[1] for row in connection.execute("PRAGMA table_info(automation_jobs)").fetchall()}
            if "revision" not in columns:
                connection.execute("ALTER TABLE automation_jobs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")
            if "last_request_id" not in columns:
                connection.execute("ALTER TABLE automation_jobs ADD COLUMN last_request_id TEXT")
            connection.execute("CREATE TABLE IF NOT EXISTS automation_job_actions (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL)")

    def enqueue(self, job_id: str, idempotency_key: str, scheduled_at: float, payload: dict[str, Any]) -> dict[str, Any]:
        now = time.time()
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO automation_jobs
                (id, idempotency_key, scheduled_at, next_attempt_at, payload_json, state, updated_at)
                VALUES (?, ?, ?, ?, ?, 'queued', ?)
                ON CONFLICT(idempotency_key) DO NOTHING
                """,
                (job_id, idempotency_key, scheduled_at, scheduled_at, json.dumps(payload, separators=(",", ":")), now),
            )
            row = connection.execute("SELECT * FROM automation_jobs WHERE idempotency_key = ?", (idempotency_key,)).fetchone()
        if row is None:
            raise RuntimeError("worker enqueue did not return a job")
        return self._row_to_job(row, include_payload=False)

    def claim_due(self, now: float) -> list[dict[str, Any]]:
        claimed: list[dict[str, Any]] = []
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute(
                "SELECT * FROM automation_jobs WHERE state = 'queued' AND scheduled_at <= ? AND next_attempt_at <= ? ORDER BY scheduled_at, id",
                (now, now),
            ).fetchall()
            for row in rows:
                attempts = int(row["attempts"]) + 1
                connection.execute(
                    "UPDATE automation_jobs SET state = 'running', attempts = ?, updated_at = ? WHERE id = ? AND state = 'queued'",
                    (attempts, now, row["id"]),
                )
                claimed.append(self._row_to_job(row, attempts=attempts, state="running"))
        return claimed

    def complete(self, job_id: str, provider_job_id: str | None, now: float | None = None) -> None:
        with self._connection() as connection:
            connection.execute(
                "UPDATE automation_jobs SET state = 'completed', provider_job_id = ?, last_error = NULL, updated_at = ? WHERE id = ?",
                (provider_job_id, now or time.time(), job_id),
            )

    def retry(self, job_id: str, error: str, next_attempt_at: float, now: float | None = None) -> None:
        with self._connection() as connection:
            connection.execute(
                "UPDATE automation_jobs SET state = 'queued', next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?",
                (next_attempt_at, error[:2000], now or time.time(), job_id),
            )

    def fail(self, job_id: str, error: str, now: float | None = None) -> None:
        with self._connection() as connection:
            connection.execute(
                "UPDATE automation_jobs SET state = 'failed', last_error = ?, updated_at = ? WHERE id = ?",
                (error[:2000], now or time.time(), job_id),
            )

    def mutate(self, job_id: str, action: str, request_id: str, scheduled_at: float | None = None, *, expected_revision: int, now: float | None = None) -> dict[str, Any]:
        if action not in {"cancel", "reschedule", "publish_now"}:
            raise JobMutationError("WORKER_JOB_ACTION_INVALID")
        if not request_id.strip():
            raise JobMutationError("WORKER_JOB_REQUEST_ID_REQUIRED")
        if not isinstance(expected_revision, int) or expected_revision < 0:
            raise JobMutationError("WORKER_JOB_REVISION_REQUIRED")
        fingerprint = hashlib.sha256(json.dumps([job_id, action, expected_revision, scheduled_at], separators=(",", ":")).encode("utf-8")).hexdigest()
        current_time = time.time() if now is None else now
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            prior = connection.execute("SELECT fingerprint, result_json FROM automation_job_actions WHERE request_id = ?", (request_id,)).fetchone()
            if prior is not None:
                if prior["fingerprint"] != fingerprint:
                    raise JobMutationError("WORKER_JOB_REQUEST_ID_REUSED")
                return json.loads(prior["result_json"])
            row = connection.execute("SELECT * FROM automation_jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                raise JobMutationError("WORKER_JOB_NOT_FOUND")
            if row["state"] == "unknown":
                raise JobMutationError("WORKER_JOB_OUTCOME_UNKNOWN")
            if row["state"] != "queued":
                raise JobMutationError("WORKER_JOB_STATE_CONFLICT")
            if row["revision"] != expected_revision:
                raise JobMutationError("WORKER_JOB_REVISION_CONFLICT")
            if action == "reschedule":
                if scheduled_at is None or not isinstance(scheduled_at, (int, float)) or scheduled_at < current_time:
                    raise JobMutationError("WORKER_JOB_SCHEDULE_INVALID")
                next_state, next_scheduled = "queued", scheduled_at
            elif action == "publish_now":
                next_state, next_scheduled = "queued", current_time
            else:
                next_state, next_scheduled = "canceled", row["scheduled_at"]
            result = connection.execute(
                "UPDATE automation_jobs SET state = ?, scheduled_at = ?, next_attempt_at = ?, revision = revision + 1, last_request_id = ?, updated_at = ? WHERE id = ? AND state = 'queued' AND revision = ?",
                (next_state, next_scheduled, next_scheduled, request_id, current_time, job_id, expected_revision),
            )
            if result.rowcount != 1:
                raise JobMutationError("WORKER_JOB_REVISION_CONFLICT")
            updated = connection.execute("SELECT * FROM automation_jobs WHERE id = ?", (job_id,)).fetchone()
            response = self._row_to_job(updated, include_payload=False)
            connection.execute("INSERT INTO automation_job_actions(request_id, fingerprint, result_json) VALUES (?, ?, ?)", (request_id, fingerprint, json.dumps(response, separators=(",", ":"))))
        return response

    def list_jobs(self, *, include_payload: bool = False, workspace_id: str | None = None) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute("SELECT * FROM automation_jobs ORDER BY scheduled_at, id").fetchall()
        if workspace_id is not None:
            rows = [row for row in rows if self._payload_workspace_id(row) == workspace_id]
        return [self._row_to_job(row, include_payload=include_payload) for row in rows]

    def recover_running_jobs(self, now: float | None = None) -> int:
        current_time = time.time() if now is None else now
        with self._connection() as connection:
            result = connection.execute(
                "UPDATE automation_jobs SET state = 'unknown', revision = revision + 1, last_error = ?, updated_at = ? WHERE state = 'running'",
                ("WORKER_OUTCOME_UNKNOWN_AFTER_RESTART", current_time),
            )
            return int(result.rowcount)

    def mark_unknown(self, job_id: str, error: str, now: float | None = None) -> None:
        with self._connection() as connection:
            connection.execute("UPDATE automation_jobs SET state = 'unknown', last_error = ?, updated_at = ? WHERE id = ? AND state = 'running'", (error[:2000], now or time.time(), job_id))

    def summary(self, workspace_id: str | None = None) -> dict[str, int]:
        with self._connection() as connection:
            rows = connection.execute("SELECT state, payload_json, COUNT(*) AS count FROM automation_jobs GROUP BY state, payload_json").fetchall()
        summary = {"queued": 0, "running": 0, "completed": 0, "failed": 0, "unknown": 0}
        for row in rows:
            if workspace_id is not None and self._payload_workspace_id(row) != workspace_id:
                continue
            state = str(row["state"])
            summary[state] = int(summary.get(state, 0)) + int(row["count"])
        return summary

    @staticmethod
    def _payload_workspace_id(row: sqlite3.Row) -> str | None:
        try:
            payload = json.loads(row["payload_json"] or "{}")
        except (TypeError, json.JSONDecodeError):
            return None
        value = payload.get("workspace_id") if isinstance(payload, dict) else None
        return value if isinstance(value, str) else None

    @staticmethod
    def _row_to_job(row: sqlite3.Row, *, attempts: int | None = None, state: str | None = None, include_payload: bool = True) -> dict[str, Any]:
        result = {
            "id": row["id"],
            "idempotency_key": row["idempotency_key"],
            "scheduled_at": row["scheduled_at"],
            "next_attempt_at": row["next_attempt_at"],
            "state": state or row["state"],
            "attempts": attempts if attempts is not None else row["attempts"],
            "provider_job_id": row["provider_job_id"],
            "last_error": row["last_error"],
            "revision": row["revision"] if "revision" in row.keys() else 0,
        }
        if include_payload:
            result["payload"] = json.loads(row["payload_json"])
        return result


class AutomationWorker:
    def __init__(self, store: SQLiteJobStore, retry_delay_seconds: float = 300):
        self.store = store
        self.retry_delay_seconds = retry_delay_seconds

    def run_once(self, executor: Callable[[dict[str, Any]], str | None], now: float | None = None) -> dict[str, int]:
        current_time = time.time() if now is None else now
        summary = {"completed": 0, "retryable": 0, "failed": 0, "unknown": 0}
        for job in self.store.claim_due(current_time):
            try:
                provider_job_id = executor(job["payload"])
            except RetryableJobError as error:
                self.store.retry(job["id"], str(error), current_time + self.retry_delay_seconds, current_time)
                summary["retryable"] += 1
            except PermanentJobError as error:
                self.store.fail(job["id"], str(error), current_time)
                summary["failed"] += 1
            except UnknownJobOutcomeError as error:
                self.store.mark_unknown(job["id"], str(error), current_time)
                summary["unknown"] += 1
            except Exception as error:  # noqa: BLE001 - unknown provider outcomes require reconciliation
                self.store.mark_unknown(job["id"], str(error), current_time)
                summary["unknown"] += 1
            else:
                self.store.complete(job["id"], provider_job_id, current_time)
                summary["completed"] += 1
        return summary

    def run_forever(self, executor: Callable[[dict[str, Any]], str | None], poll_seconds: float = 60, stop_event: threading.Event | None = None) -> None:
        event = stop_event or threading.Event()
        while not event.is_set():
            self.run_once(executor)
            event.wait(poll_seconds)
