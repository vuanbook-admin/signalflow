const { getSecret } = require("./secure-store.cjs");

const PROVIDER_KINDS = new Set([
  "openrouter",
  "google_gemini_api",
  "vertex_ai",
  "openai_official",
  "openai_compatible",
  "nvidia_nim",
  "opencode_go",
]);

const MAX_MODELS = 500;
const MAX_ID_LENGTH = 240;
const MAX_BODY_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@+-]{1,240}$/;

function providerSecretAccount(workspaceId, providerKind) {
  return `workspace:${workspaceId}:provider:${providerKind}:api-key`;
}

function resolveModelListUrl(providerKind, baseUrl) {
  switch (providerKind) {
    case "openrouter":
      return { url: "https://openrouter.ai/api/v1/models" };
    case "openai_official":
      return { url: "https://api.openai.com/v1/models" };
    case "google_gemini_api":
      return { url: "https://generativelanguage.googleapis.com/v1beta/models" };
    case "openai_compatible":
    case "nvidia_nim": {
      if (typeof baseUrl !== "string" || !baseUrl.trim()) return { errorCode: "PROVIDER_BASE_URL_INVALID" };
      let parsed;
      try {
        parsed = new URL(baseUrl.trim());
      } catch {
        return { errorCode: "PROVIDER_BASE_URL_INVALID" };
      }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return { errorCode: "PROVIDER_BASE_URL_INVALID" };
      return { url: `${parsed.toString().replace(/\/+$/, "")}/models` };
    }
    case "vertex_ai":
      return { errorCode: "VERTEX_DISCOVERY_REQUIRES_ADC" };
    case "opencode_go":
      return { errorCode: "OPENCODE_DISCOVERY_UNSUPPORTED" };
    default:
      return { errorCode: "PROVIDER_KIND_UNSUPPORTED" };
  }
}

function sanitizeId(raw) {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > MAX_ID_LENGTH || !MODEL_ID_PATTERN.test(id)) return null;
  return id;
}

function sanitizeName(raw, fallbackId) {
  if (typeof raw !== "string" || !raw.trim()) return fallbackId;
  return raw.trim().slice(0, 240);
}

function parseOpenRouter(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.data)) throw new Error("DISCOVERY_INVALID_RESPONSE");
  const models = [];
  for (const item of payload.data) {
    if (!item || typeof item !== "object") continue;
    const id = sanitizeId(item.id);
    if (!id) continue;
    models.push({ id, name: sanitizeName(item.name, id) });
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

function parseOpenAICompatible(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.data)) throw new Error("DISCOVERY_INVALID_RESPONSE");
  const models = [];
  for (const item of payload.data) {
    if (!item || typeof item !== "object") continue;
    const id = sanitizeId(item.id);
    if (!id) continue;
    models.push({ id, name: id });
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

function parseGemini(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.models)) throw new Error("DISCOVERY_INVALID_RESPONSE");
  const models = [];
  for (const item of payload.models) {
    if (!item || typeof item !== "object") continue;
    const rawName = typeof item.name === "string" ? item.name.trim() : "";
    const stripped = rawName.startsWith("models/") ? rawName.slice("models/".length) : rawName;
    const id = sanitizeId(stripped);
    if (!id) continue;
    models.push({ id, name: sanitizeName(item.displayName, id) });
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

function parseDiscoveryResponse(providerKind, payload) {
  if (providerKind === "openrouter") return parseOpenRouter(payload);
  if (providerKind === "google_gemini_api") return parseGemini(payload);
  return parseOpenAICompatible(payload);
}

function authHeaders(providerKind, apiKey) {
  if (providerKind === "google_gemini_api") return { "x-goog-api-key": apiKey };
  return { authorization: `Bearer ${apiKey}` };
}

function mapHttpStatus(status) {
  if (status === 401 || status === 403) return { status: "auth", errorCode: "DISCOVERY_AUTH_FAILED" };
  if (status === 404) return { status: "not_configured", errorCode: "DISCOVERY_ENDPOINT_NOT_FOUND" };
  if (status === 429) return { status: "rate_limited", errorCode: "DISCOVERY_RATE_LIMITED" };
  if (status >= 500) return { status: "error", errorCode: "DISCOVERY_PROVIDER_ERROR" };
  return { status: "invalid_response", errorCode: "DISCOVERY_REQUEST_FAILED" };
}

async function discoverProviderModels(args = {}, deps = {}) {
  const { workspaceId, providerKind, baseUrl } = args;
  const readSecret = deps.getSecret || getSecret;
  const fetchImpl = deps.fetchImpl || fetch;
  if (typeof workspaceId !== "string" || typeof providerKind !== "string" || !PROVIDER_KINDS.has(providerKind)) {
    throw new Error("ELECTRON_ARG_INVALID:providerKind");
  }
  const resolved = resolveModelListUrl(providerKind, baseUrl);
  if (resolved.errorCode) {
    const unsupported = resolved.errorCode === "VERTEX_DISCOVERY_REQUIRES_ADC" || resolved.errorCode === "OPENCODE_DISCOVERY_UNSUPPORTED";
    return { providerKind, status: unsupported ? "unsupported" : "error", models: [], errorCode: resolved.errorCode };
  }
  let apiKey;
  try {
    apiKey = readSecret(providerSecretAccount(workspaceId, providerKind));
    if (apiKey && typeof apiKey.then === "function") apiKey = await apiKey;
  } catch {
    return { providerKind, status: "not_configured", models: [], errorCode: "DISCOVERY_KEY_NOT_CONFIGURED" };
  }
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return { providerKind, status: "not_configured", models: [], errorCode: "DISCOVERY_KEY_NOT_CONFIGURED" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(resolved.url, {
      method: "GET",
      headers: { accept: "application/json", ...authHeaders(providerKind, apiKey.trim()) },
      signal: controller.signal,
    });
    if (!response.ok) return { providerKind, status: mapHttpStatus(response.status).status, models: [], errorCode: mapHttpStatus(response.status).errorCode };
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      return { providerKind, status: "invalid_response", models: [], errorCode: "DISCOVERY_RESPONSE_TOO_LARGE" };
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return { providerKind, status: "invalid_response", models: [], errorCode: "DISCOVERY_INVALID_RESPONSE" };
    }
    try {
      const models = parseDiscoveryResponse(providerKind, payload);
      if (models.length === 0) return { providerKind, status: "invalid_response", models: [], errorCode: "DISCOVERY_EMPTY_MODEL_LIST" };
      return { providerKind, status: "ok", models };
    } catch {
      return { providerKind, status: "invalid_response", models: [], errorCode: "DISCOVERY_INVALID_RESPONSE" };
    }
  } catch (error) {
    if (error && (error.name === "AbortError" || /aborted/i.test(String((error && error.message) || "")))) {
      return { providerKind, status: "network", models: [], errorCode: "DISCOVERY_TIMEOUT" };
    }
    return { providerKind, status: "network", models: [], errorCode: "DISCOVERY_NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { discoverProviderModels, resolveModelListUrl, parseDiscoveryResponse, providerSecretAccount };
