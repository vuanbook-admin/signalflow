import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staging = path.join(root, "dist-electron-staging");

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(path.join(staging, "desktop"), { recursive: true });
fs.cpSync(path.join(root, "dist"), path.join(staging, "dist"), { recursive: true });
for (const filename of ["main.cjs", "preload.cjs", "account-browser.cjs", "chrome-browser.cjs", "worker-supervisor.cjs", "secret-chunks.cjs", "portable-env.cjs", "secure-store.cjs", "meta.cjs", "provider-models.cjs", "oauth-url.cjs", "security.cjs", "vertex-ai.cjs", "drive-media.cjs"]) {
  fs.copyFileSync(path.join(root, "desktop", filename), path.join(staging, "desktop", filename));
}
const workerRuntime = path.join(staging, "worker-runtime");
fs.mkdirSync(path.join(workerRuntime, "backend"), { recursive: true });
fs.copyFileSync(path.join(root, "scripts", "run-local-worker.mjs"), path.join(workerRuntime, "run-local-worker.mjs"));
for (const filename of ["app_state_store.py", "automation_worker.py", "automation_worker_service.py", "control_plane_service.py", "generation_policy.py", "profile_database_migration.py"]) {
  fs.copyFileSync(path.join(root, "backend", filename), path.join(workerRuntime, "backend", filename));
}
fs.writeFileSync(path.join(staging, "package.json"), JSON.stringify({
  name: "signalflow-electron",
  productName: "SignalFlow",
  version: "0.1.0",
  description: "SignalFlow social marketing operating system",
  main: "desktop/main.cjs",
}, null, 2) + "\n");
