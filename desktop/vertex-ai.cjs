const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getSecret, setSecret, deleteSecret } = require("./secure-store.cjs");

const DEFAULT_LOCATION = "us-central1";
const DEFAULT_MODEL = "imagen-3.0-generate-002";
const VERIFICATION_TTL_MS = 10 * 60_000;

function accountPrefix(workspaceId) {
  if (typeof workspaceId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(workspaceId)) throw new Error("VERTEX_WORKSPACE_INVALID");
  return `workspace:${workspaceId}:vertex-ai`;
}

function validateConfig(input) {
  const projectId = String(input.projectId || "").trim();
  const location = String(input.location || DEFAULT_LOCATION).trim();
  const model = String(input.model || DEFAULT_MODEL).trim();
  if (!/^[a-z][a-z0-9-]{4,62}[a-z0-9]$/.test(projectId)) throw new Error("VERTEX_PROJECT_ID_INVALID");
  if (!/^[a-z0-9-]+$/.test(location) || location.length > 64) throw new Error("VERTEX_LOCATION_INVALID");
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(model)) throw new Error("VERTEX_MODEL_INVALID");
  return { projectId, location, model };
}

function readConfig(workspaceId) {
  const raw = getSecret(`${accountPrefix(workspaceId)}:config`);
  if (!raw) return null;
  try { return validateConfig(JSON.parse(raw)); } catch { return null; }
}

function saveConfig(workspaceId, input) {
  const config = validateConfig(input);
  setSecret(`${accountPrefix(workspaceId)}:config`, JSON.stringify(config));
  deleteSecret(`${accountPrefix(workspaceId)}:verified-at`);
  return { configured: true, projectIdPresent: true, location: config.location, model: config.model };
}

function deleteConfig(workspaceId) {
  deleteSecret(`${accountPrefix(workspaceId)}:config`);
  deleteSecret(`${accountPrefix(workspaceId)}:verified-at`);
  return { configured: false, projectIdPresent: false };
}

function verifiedAt(workspaceId) {
  const value = Number(getSecret(`${accountPrefix(workspaceId)}:verified-at`));
  return Number.isFinite(value) && value > 0 && Date.now() - value < VERIFICATION_TTL_MS ? new Date(value).toISOString() : undefined;
}

function statusVertex(workspaceId) {
  const config = readConfig(workspaceId);
  const credentialPresent = Boolean(getSecret(`${accountPrefix(workspaceId)}:access-token`));
  if (!config) return { provider: "vertex_ai", configured: false, officialApiVerified: false, projectIdPresent: false, credentialPresent, reason: "Vertex AI project/location/model configuration is missing in the .env credential file." };
  if (!credentialPresent) return { provider: "vertex_ai", configured: false, officialApiVerified: false, projectIdPresent: true, credentialPresent: false, location: config.location, model: config.model, reason: "Vertex AI credential is missing from the .env credential file; no credential is created automatically." };
  const lastVerifiedAt = verifiedAt(workspaceId);
  return { provider: "vertex_ai", configured: true, officialApiVerified: Boolean(lastVerifiedAt), projectIdPresent: true, credentialPresent: true, location: config.location, model: config.model, ...(lastVerifiedAt ? { verifiedAt: lastVerifiedAt } : { reason: "Vertex AI credential is present but has not passed a recent official API verification." }) };
}

async function verifyVertexApi(workspaceId) {
  const config = readConfig(workspaceId);
  const accessToken = getSecret(`${accountPrefix(workspaceId)}:access-token`);
  if (!config || !accessToken) throw new Error("VERTEX_API_NOT_CONFIGURED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const endpoint = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/locations/${encodeURIComponent(config.location)}`;
    const response = await fetch(endpoint, { headers: { accept: "application/json", authorization: `Bearer ${accessToken}` }, signal: controller.signal });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) deleteSecret(`${accountPrefix(workspaceId)}:verified-at`);
      throw new Error(`VERTEX_API_VERIFY_FAILED:${response.status}`);
    }
    setSecret(`${accountPrefix(workspaceId)}:verified-at`, String(Date.now()));
    return statusVertex(workspaceId);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("VERTEX_API_VERIFY_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function creativeDirectory(userDataRoot) {
  if (typeof userDataRoot !== "string" || !userDataRoot.trim()) throw new Error("VERTEX_OUTPUT_ROOT_REQUIRED");
  const requestedRoot = path.resolve(userDataRoot);
  let rootStats;
  try { rootStats = fs.lstatSync(requestedRoot); } catch { throw new Error("VERTEX_OUTPUT_PATH_INVALID"); }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error("VERTEX_OUTPUT_PATH_INVALID");
  const root = path.resolve(fs.realpathSync(requestedRoot));
  if (root !== requestedRoot) throw new Error("VERTEX_OUTPUT_PATH_INVALID");
  const directory = path.join(root, "creative-assets");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStats = fs.lstatSync(directory);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()
      || path.resolve(fs.realpathSync(directory)) !== directory
      || !directory.startsWith(`${root}${path.sep}`)) throw new Error("VERTEX_OUTPUT_PATH_INVALID");
  return directory;
}

function writeGeneratedVertexImage(bytes, { userDataRoot } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("VERTEX_IMAGE_RESULT_INVALID");
  const outputDirectory = creativeDirectory(userDataRoot);
  const output = path.join(outputDirectory, `vertex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  const descriptor = fs.openSync(output, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  const generatedSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  return { provider: "vertex_ai", live: true, localAssetPath: output, mimeType: "image/png", generatedAt: new Date().toISOString(), generatedSha256, sourceKind: "official_vertex_api" };
}

async function generateVertexImage(workspaceId, prompt, { userDataRoot } = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("VERTEX_PROMPT_INVALID");
  const config = readConfig(workspaceId);
  const accessToken = getSecret(`${accountPrefix(workspaceId)}:access-token`);
  if (!config || !accessToken) throw new Error("VERTEX_API_NOT_CONFIGURED");
  const endpoint = `https://${config.location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/locations/${encodeURIComponent(config.location)}/publishers/google/models/${encodeURIComponent(config.model)}:predict`;
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ instances: [{ prompt: prompt.trim() }], parameters: { sampleCount: 1 } }) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) deleteSecret(`${accountPrefix(workspaceId)}:verified-at`);
    throw new Error(`VERTEX_API_REQUEST_FAILED:${response.status}`);
  }
  const encoded = body?.predictions?.[0]?.bytesBase64Encoded || body?.predictions?.[0]?.image?.bytesBase64Encoded;
  if (typeof encoded !== "string" || !encoded) throw new Error("VERTEX_IMAGE_RESULT_INVALID");
  const bytes = Buffer.from(encoded, "base64");
  return writeGeneratedVertexImage(bytes, { userDataRoot });
}

module.exports = { creativeDirectory, deleteConfig, generateVertexImage, readConfig, saveConfig, statusVertex, validateConfig, verifyVertexApi, writeGeneratedVertexImage };
