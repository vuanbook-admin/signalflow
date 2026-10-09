const { contextBridge, ipcRenderer } = require("electron");

const DEFAULT_CONTROL_PLANE_PORT = 18_787;
const DEFAULT_WORKER_PORT = 18_788;

function configuredPort(name, fallback) {
  const argumentPrefix = `--${name.replace(/^SIGNALFLOW_/, "signalflow-").replaceAll("_", "-").toLowerCase()}=`;
  const argument = (Array.isArray(process.argv) ? process.argv : []).find((value) => value.startsWith(argumentPrefix));
  const raw = argument ? argument.slice(argumentPrefix.length) : process.env?.[name];
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name}_INVALID`);
  const port = Number(raw.trim());
  if (!Number.isSafeInteger(port) || port <= 0 || port >= 65_536) throw new Error(`${name}_INVALID`);
  return port;
}

const controlPlanePort = configuredPort("SIGNALFLOW_CONTROL_PLANE_PORT", DEFAULT_CONTROL_PLANE_PORT);
const workerPort = configuredPort("SIGNALFLOW_WORKER_PORT", DEFAULT_WORKER_PORT);
if (controlPlanePort === workerPort) throw new Error("SIGNALFLOW_PORTS_CONFLICT");
const controlPlaneUrl = `http://127.0.0.1:${controlPlanePort}`;
const workerUrl = `http://127.0.0.1:${workerPort}`;

contextBridge.exposeInMainWorld("signalflow", {
  controlPlanePort,
  workerPort,
  controlPlaneUrl,
  workerUrl,
  invoke: (command, args = {}) => ipcRenderer.invoke("signalflow:invoke", command, args),
  openUrl: (url) => ipcRenderer.invoke("signalflow:open-url", url),
  onOAuthUrl: (listener) => {
    const handler = (_event, urls) => listener(urls);
    ipcRenderer.on("signalflow:oauth-url", handler);
    return () => ipcRenderer.removeListener("signalflow:oauth-url", handler);
  },
  onMetaOAuthResult: (listener) => {
    const handler = (_event, result) => listener(result);
    ipcRenderer.on("signalflow:meta-oauth-result", handler);
    return () => ipcRenderer.removeListener("signalflow:meta-oauth-result", handler);
  },
});
