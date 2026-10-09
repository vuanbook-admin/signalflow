import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.env.SIGNALFLOW_WORKER_RUNTIME_ROOT || sourceRoot);
const uv = process.env.SIGNALFLOW_UV || "uv";
const DEFAULT_CONTROL_PLANE_PORT = 18_787;
const DEFAULT_WORKER_PORT = 18_788;
const profileId = process.env.SIGNALFLOW_PROFILE_ID || "";
const runtimeId = process.env.SIGNALFLOW_RUNTIME_ID || "";
const controlPlaneDb = process.env.SIGNALFLOW_CONTROL_PLANE_DB || "";
const workerDb = process.env.SIGNALFLOW_WORKER_DB || "";
function configuredPort(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name}_INVALID`);
  const port = Number(raw.trim());
  if (!Number.isSafeInteger(port) || port <= 0 || port >= 65_536) throw new Error(`${name}_INVALID`);
  return port;
}

const controlPlanePort = configuredPort("SIGNALFLOW_CONTROL_PLANE_PORT", DEFAULT_CONTROL_PLANE_PORT);
const workerPort = configuredPort("SIGNALFLOW_WORKER_PORT", DEFAULT_WORKER_PORT);
if (controlPlanePort === workerPort) throw new Error("SIGNALFLOW_PORTS_CONFLICT");
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profileId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(runtimeId)) throw new Error("PROFILE_RUNTIME_IDENTITY_REQUIRED");
if (!path.isAbsolute(controlPlaneDb) || !path.isAbsolute(workerDb)) throw new Error("PROFILE_DATABASE_PATHS_REQUIRED");
const profileDataRoot = path.resolve(path.dirname(controlPlaneDb));
if (profileDataRoot !== path.resolve(path.dirname(workerDb))
    || path.basename(profileDataRoot) !== profileId
    || path.basename(path.dirname(profileDataRoot)) !== "profiles"
    || path.basename(controlPlaneDb) !== "signalflow-control-plane.sqlite3"
    || path.basename(workerDb) !== "signalflow-worker.sqlite3") throw new Error("PROFILE_DATABASE_PATHS_INVALID");
const workerToken = randomBytes(32).toString("hex");
const shared = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", SIGNALFLOW_PROFILE_ID: profileId, SIGNALFLOW_RUNTIME_ID: runtimeId, SIGNALFLOW_CONTROL_PLANE_PORT: String(controlPlanePort), SIGNALFLOW_WORKER_PORT: String(workerPort), SIGNALFLOW_WORKER_URL: `http://127.0.0.1:${workerPort}`, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", SIGNALFLOW_WORKER_AUTH_TOKEN: workerToken, META_REDIRECT_URI: "https://localhost/oauth/callback" };
let stopping = false;

function start(label, script, env) {
  const child = spawn(uv, ["run", "--with", "fastapi", "--with", "httpx", "--with", "pydantic", "--with", "uvicorn", "python", script], { cwd: root, env, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`${label} stopped (${signal || code || "unknown"}).`);
    shutdown(1);
  });
  child.on("error", (error) => {
    console.error(`${label} could not start: ${error.message}`);
    shutdown(1);
  });
  return child;
}

const controlPlane = start("SignalFlow control plane", path.join(root, "backend", "control_plane_service.py"), { ...shared, PORT: String(controlPlanePort), SIGNALFLOW_CONTROL_PLANE_DB: controlPlaneDb });
const worker = start("SignalFlow local worker", path.join(root, "backend", "automation_worker_service.py"), {
  ...shared,
  SIGNALFLOW_WORKER_DB: workerDb,
  SIGNALFLOW_PROVIDER_EXECUTOR_URL: `http://127.0.0.1:${controlPlanePort}/v1/worker/meta/page-text`,
});

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [controlPlane, worker]) child.kill("SIGTERM");
  process.exitCode = exitCode;
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
console.log(`SignalFlow local worker runtime started on 127.0.0.1:${controlPlanePort} and :${workerPort}.`);
