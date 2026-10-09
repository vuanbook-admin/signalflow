# SignalFlow Control Plane

The desktop app uses `VITE_CONTROL_PLANE_URL` when configured and otherwise connects to the loopback Control Plane at `127.0.0.1:18787` when running inside Electron. Static browser preview remains opt-in and does not pretend to have an authority.

## Development setup

```bash
export META_APP_ID="your-meta-app-id"
export META_APP_SECRET="your-meta-app-secret"
export PORT=8787
python3 backend/control_plane_service.py
```

The service exposes `GET /health`, `POST /v1/oauth/meta/start`, and `POST /v1/oauth/meta/exchange`. The callback URI must be registered in the Meta app as `https://localhost/oauth/callback`; SignalFlow captures this exact loopback URL from its managed Chromium profile and exchanges the code natively.

## Durable worker core

`backend/automation_worker.py` is the portable SQLite worker core. It owns the durable job table, unique idempotency keys, atomic due-job claims, attempt counts, retry scheduling and permanent-failure states. Provider execution is injected as a callable so Meta/Drive credentials do not leak into the queue contract.

The current desktop app still uses its in-process scheduler while the window is open. A deployed worker must provide the injected provider executor, the authenticated control-plane channel, a durable database volume, and supervised lifecycle management. Treat `simulation`, `blocked`, `safe stopped`, and `unreachable` as non-live states; do not claim unattended publishing until a supervised local end-to-end test has completed with fake provider responses and a separately approved non-public provider smoke.

The local worker service is now available at `backend/automation_worker_service.py`. It exposes `GET /health`, `POST /v1/jobs`, `GET /v1/jobs`, `POST /v1/run-once`, `POST /v1/stop`, and `POST /v1/recover`, and runs a background poller when started normally. Set `SIGNALFLOW_PROVIDER_EXECUTOR_URL` to `/v1/worker/meta/page-text` and set the same non-empty `SIGNALFLOW_WORKER_AUTH_TOKEN` on both services so approved Facebook Page text/image jobs use the control plane's shared `.env` Page-token boundary; image jobs require an HTTPS `media_url`. The control plane also accepts the explicit `/v1/worker/meta/page-photo` alias. If no executor URL is configured, health reports `configurationStatus=simulation`; if the executor URL is present but auth is missing, health reports `configurationStatus=blocked` and live forwarding is fail-closed. The worker accepts only explicit approved Facebook metadata and never accepts tokens in job payloads. `POST /v1/stop` is an idempotent safe stop that rejects new jobs and stops the poller; restart the supervised worker service to resume accepting jobs. While stopped, `POST /v1/recover` requeues interrupted jobs without changing their idempotency keys. Queue listings and health contain scalar metadata only; payloads are not returned. No closed-app live publishing claim is valid without supervised runtime evidence.

## Agency state authority

`backend/app_state_store.py` is the SQLite authority for Client, Brand, Brand Identity, connection metadata, Channel Binding, Generation Profile, Content Run, Target Publication, automation, media, analytics, and audit records. It enforces foreign keys, one default identity per Brand, one idempotency key per binding, valid generation modes, and an immutable Content Run profile after its first provider attempt.

The scalar API is under `/v1/agency/`. Clients, Brands, Identities, Connections, and Bindings support create/read/update/delete. Generation profiles, content runs, target publications, target preflight/reconciliation, migration commit, provider probes, Knowledge FTS search, and read-only recovery are explicit routes. Analytics and audit tables are append-only. The Control Plane rejects token/cookie/key-shaped fields and Hermes/OpenCode authentication-store paths before persistence. It never returns secret references, credentials, browser state, or provider blobs.

Set `SIGNALFLOW_CONTROL_PLANE_DB` to the app-owned SQLite file location in a deployed setup. The default local filename is `signalflow-control-plane.sqlite3`. A renderer migration calls `POST /v1/agency/migrations/commit`; the store writes every scalar record in one transaction and only then returns `controlPlaneMigrated: true`. A second renderer-originated replacement is rejected, while `GET /v1/agency/recovery` remains a read-only recovery source.

## Security boundary

The desktop renderer sends `workspaceId` and `redirectUri` to the control plane. The control plane creates a one-time state, builds the provider consent URL, verifies the returned state, exchanges the authorization code, and stores the resulting token in the user-only SignalFlow `.env` file by default. The shared file path is `SIGNALFLOW_ENV_FILE` when set, otherwise `~/.signalflow/.env`; entries use encoded account keys and the file is written with `0600` permissions. The in-memory vault is available only with an explicit development/test fallback flag.

Access tokens must never be returned to the renderer, written to `localStorage`, committed to source control, or placed in a public URL. The control plane should also be protected by authenticated workspace sessions, rate limits, structured audit logs, and provider-specific app review before production use.

## Production replacement checklist

1. Replace the local plaintext `.env` boundary with the deployment's managed secret policy and add key rotation before multi-user production.
2. Bind OAuth state to the authenticated user and workspace server-side.
3. Add token refresh, revocation, and re-authentication lifecycle handling.
4. Resolve Facebook Pages and Instagram Professional accounts after exchange and persist only non-secret account metadata in the desktop workspace.
5. Add provider error normalization and retry policy without retrying invalid grants.
6. Restrict CORS and callback allowlists to the SignalFlow desktop origin and registered scheme.
7. Run the worker as a supervised service with an authenticated control-plane channel and a durable database volume.

## Local Meta environment

For local development, copy `.env.example` to `.env.local`, fill the values directly on the development Mac, and load it only into the shell that starts the FastAPI control plane:

```bash
cp .env.example .env.local
set -a
source .env.local
set +a
python3 backend/control_plane_service.py
```

`META_APP_SECRET` and `META_DEV_ACCESS_TOKEN` must remain backend-only. Do not prefix secrets with `VITE_`, do not put them in React state or persistence snapshots, and do not commit `.env.local`. Keep `META_LIVE_PUBLISHING=false` until the OAuth/account-discovery checks and an explicitly approved non-production smoke test are complete. The token previously pasted into chat must be revoked and must not be reused.

The control-plane token vault defaults to `SIGNALFLOW_TOKEN_VAULT=dotenv` on every host. `SIGNALFLOW_ENV_FILE` overrides the shared path and defaults to `~/.signalflow/.env`. Set `SIGNALFLOW_TOKEN_VAULT=memory` only together with `SIGNALFLOW_ALLOW_MEMORY_TOKEN_VAULT=true` for isolated tests or explicit local development; never use that fallback for a real account. Existing macOS Keychain entries can be copied once with `pnpm migrate:env`; the runtime no longer calls the macOS `security` CLI.

## In-app Meta development configuration

The simplest local path is now available from **Settings → Meta Development**. Enter the public App ID, App Secret, and a development access token there. The desktop app stores the App Secret and access token in the shared user-only `.env` file under workspace-scoped encoded accounts; the values are never written to persistence snapshots, diagnostics exports, or renderer logs. The Discover Page + Instagram action calls the native control boundary, which reads the credential from `.env` and sends it to Graph API through request headers/body without exposing it to the renderer.

This in-app path is a manual development connection for account discovery and non-production verification. It does not replace official OAuth for production multi-user onboarding. The native development route supports Facebook Page text and image after Page discovery, `.env` credential presence, human approval, a public HTTPS image URL for image posts, and Simulation mode being turned off; production still requires provider scopes/App Review, managed secret storage, token lifecycle handling and explicit test-account rollout.
