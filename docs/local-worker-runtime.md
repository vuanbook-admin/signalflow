# Local worker runtime

The packaged Electron SignalFlow app starts and supervises the loopback-only control plane on port 18787 and durable worker on port 18788 automatically. It adopts an already healthy pair, starts the bundled runtime when both are absent, and restarts its own launcher with bounded backoff if it exits. Run `pnpm worker:local` only for standalone development or an external always-on worker host.

SignalFlow desktop automatically uses `http://127.0.0.1:18788` when running in Electron. The supervisor keeps the runtime on the same user account that owns the shared `SIGNALFLOW_ENV_FILE` (default `~/.signalflow/.env`); the worker reads the selected Page token directly from that file and never accepts a token in a queue payload.

The packaged SQLite files are `signalflow-worker.sqlite3` and `signalflow-control-plane.sqlite3` under Electron `userData`; the first packaged start copies legacy files only when the target does not exist. Stop the app to stop the supervisor-owned runtime; the worker still exposes safe-stop and recovery endpoints for controlled operations. Set `SIGNALFLOW_ENV_FILE` when the shared credential file is stored elsewhere.
