# Portability boundary

SignalFlow's product core must remain platform-neutral. The current macOS build is a host implementation, not the domain contract for a future Windows build.

## Keep portable

- React screens, workspace/brand state, Automation Planner validation, media-mix expansion, approval gates, publish queue, idempotency and persistence contracts.
- `src/lib/automationScheduler.ts`: the shared in-process timer contract. It must not install launch agents, scheduled tasks or invoke shell commands.
- `src/lib/secretStore.ts`: `SecretStore` and the `env_file` boundary. Renderer code never reads the `.env` path or credential values.
- Provider adapters: each adapter receives typed connection metadata and returns scalar provider results; provider credentials stay behind the native/control-plane boundary.
- Gemini Pro subscription: `GeminiWebAIGateway` is renderer-neutral; the packaged Electron adapter owns a real Chrome profile and visible composer session through local CDP. No cookie store, password or token extraction is part of the contract.
- Account browsers: Gemini, ChatGPT and Google Drive use stable, service-specific app-owned Chrome/Edge profiles under the host user-data directory. The browser window is launched and controlled by SignalFlow; it is not the user's ordinary Chrome profile and it is not WKWebView. SignalFlow never extracts stored session data into React, logs or chat. Drive transfer commands (`drive_download_asset`, `drive_upload_asset`, and explicit `drive_make_public`) use only visible CDP/DOM interaction; downloaded/uploaded files are restricted to app-owned paths, and transfer results expose scalar metadata without secrets.
- Tauri account-login and account-transfer commands are legacy-disabled: `nativeRuntime` rejects `gemini_web_*`, `chatgpt_web_*`, `drive_web_*`, `drive_inventory`, `drive_download_asset`, `drive_upload_asset`, and `drive_make_public` unless the Electron bridge exists. This keeps all active account and Drive file-transfer surfaces on the Electron/Chromium path while non-account native commands remain portable.

## Host adapters

- Current portable backend: Electron and Tauri implement `secret_set`, `secret_get` and `secret_delete` against `SIGNALFLOW_ENV_FILE` or `~/.signalflow/.env`, with user-only `0600` permissions on Unix. Control Plane uses the same path and encoded account keys.
- Future managed backend: replace only the storage adapter with an approved vault or OS credential manager when the threat model requires it. Do not change Planner, queue, AI gateway or React settings code.
- Future background execution: add a separately deployed worker/service that reads the same durable plan contract. Do not add OS startup/scheduler code to the desktop domain.
- Future Windows account browser: keep the same `gemini_web_*`, `chatgpt_web_*`, `drive_web_*`, `drive_download_asset`, `drive_upload_asset`, and `drive_make_public` contracts; only Chrome/Edge binary discovery, profile root, path canonicalization and packaging should vary. Windows packaging and Credential Manager/DPAPI are intentionally deferred until requested.

## Porting gate

Before a Windows build is started, verify that no renderer or domain file imports OS APIs, assumes `/Users`, `~/Library`, `security`, `launchctl`, browser profile paths or platform-specific provider URLs. Only the native adapter and deployment packaging may contain host-specific code.
