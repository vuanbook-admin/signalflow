import type { ProviderKind } from "./providerRegistry";
import { invoke } from "./nativeRuntime";

export type ProviderModelEntry = { id: string; name: string };

export type ModelDiscoveryStatus =
  | "ok"
  | "loading"
  | "auth"
  | "rate_limited"
  | "network"
  | "unsupported"
  | "not_configured"
  | "invalid_response"
  | "error";

export type ModelDiscoveryResult = {
  providerKind: string;
  status: ModelDiscoveryStatus;
  models: ProviderModelEntry[];
  errorCode?: string;
};

export const MODEL_DISCOVERY_MAX_MODELS = 500;
export const MODEL_DISCOVERY_MAX_ID_LENGTH = 240;
export const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;

const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@+-]{1,240}$/;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROVIDER_KINDS: ProviderKind[] = [
  "openrouter",
  "google_gemini_api",
  "vertex_ai",
  "openai_official",
  "openai_compatible",
  "nvidia_nim",
  "opencode_go",
];

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

function assertHttpsUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") throw new Error("PROVIDER_BASE_URL_INVALID");
  if (parsed.username || parsed.password) throw new Error("PROVIDER_BASE_URL_INVALID");
  return parsed.toString().replace(/\/+$/, "");
}

function sanitizeModelId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > MODEL_DISCOVERY_MAX_ID_LENGTH || !MODEL_ID_PATTERN.test(id)) return null;
  return id;
}

function sanitizeModelName(raw: unknown, fallbackId: string): string {
  if (typeof raw !== "string") return fallbackId;
  const name = raw.trim().slice(0, 240);
  return name || fallbackId;
}

export function resolveModelListUrl(providerKind: string, baseUrl?: string): { ok: true; url: string } | { ok: false; errorCode: string } {
  if (!PROVIDER_KINDS.includes(providerKind as ProviderKind)) return { ok: false, errorCode: "PROVIDER_KIND_UNSUPPORTED" };
  try {
    switch (providerKind) {
      case "openrouter":
        return { ok: true, url: OPENROUTER_MODELS_URL };
      case "openai_official":
        return { ok: true, url: OPENAI_MODELS_URL };
      case "google_gemini_api":
        return { ok: true, url: GEMINI_MODELS_URL };
      case "openai_compatible":
      case "nvidia_nim": {
        if (typeof baseUrl !== "string" || !baseUrl.trim()) return { ok: false, errorCode: "PROVIDER_BASE_URL_INVALID" };
        return { ok: true, url: `${assertHttpsUrl(baseUrl.trim())}/models` };
      }
      case "vertex_ai":
        return { ok: false, errorCode: "VERTEX_DISCOVERY_REQUIRES_ADC" };
      case "opencode_go":
        return { ok: false, errorCode: "OPENCODE_DISCOVERY_UNSUPPORTED" };
      default:
        return { ok: false, errorCode: "PROVIDER_KIND_UNSUPPORTED" };
    }
  } catch {
    return { ok: false, errorCode: "PROVIDER_BASE_URL_INVALID" };
  }
}

function capModels(models: ProviderModelEntry[]): ProviderModelEntry[] {
  return models.slice(0, MODEL_DISCOVERY_MAX_MODELS);
}

/** OpenRouter `/api/v1/models` shape: `{ data: [{ id, name?, ... }] }`. */
export function parseOpenRouterResponse(payload: unknown): ProviderModelEntry[] {
  if (!payload || typeof payload !== "object") throw new Error("DISCOVERY_INVALID_RESPONSE");
  const data = (payload as Record<string, unknown>).data;
  if (!Array.isArray(data)) throw new Error("DISCOVERY_INVALID_RESPONSE");
  const models: ProviderModelEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = sanitizeModelId(record.id);
    if (!id) continue;
    models.push({ id, name: sanitizeModelName(record.name, id) });
    if (models.length >= MODEL_DISCOVERY_MAX_MODELS) break;
  }
  return capModels(models);
}

/** OpenAI-style `/models` shape: `{ data: [{ id }] }`. Covers OpenAI, OpenAI-compatible and NVIDIA NIM. */
export function parseOpenAICompatibleResponse(payload: unknown): ProviderModelEntry[] {
  if (!payload || typeof payload !== "object") throw new Error("DISCOVERY_INVALID_RESPONSE");
  const data = (payload as Record<string, unknown>).data;
  if (!Array.isArray(data)) throw new Error("DISCOVERY_INVALID_RESPONSE");
  const models: ProviderModelEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const id = sanitizeModelId((item as Record<string, unknown>).id);
    if (!id) continue;
    models.push({ id, name: id });
    if (models.length >= MODEL_DISCOVERY_MAX_MODELS) break;
  }
  return capModels(models);
}

/** Google `v1beta/models` shape: `{ models: [{ name: "models/<id>", displayName? }] }`. */
export function parseGeminiResponse(payload: unknown): ProviderModelEntry[] {
  if (!payload || typeof payload !== "object") throw new Error("DISCOVERY_INVALID_RESPONSE");
  const data = (payload as Record<string, unknown>).models;
  if (!Array.isArray(data)) throw new Error("DISCOVERY_INVALID_RESPONSE");
  const models: ProviderModelEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const rawName = typeof record.name === "string" ? record.name.trim() : "";
    const stripped = rawName.startsWith("models/") ? rawName.slice("models/".length) : rawName;
    const id = sanitizeModelId(stripped);
    if (!id) continue;
    models.push({ id, name: sanitizeModelName(record.displayName, id) });
    if (models.length >= MODEL_DISCOVERY_MAX_MODELS) break;
  }
  return capModels(models);
}

export function parseDiscoveryResponse(providerKind: string, payload: unknown): ProviderModelEntry[] {
  switch (providerKind) {
    case "openrouter":
      return parseOpenRouterResponse(payload);
    case "google_gemini_api":
      return parseGeminiResponse(payload);
    case "openai_official":
    case "openai_compatible":
    case "nvidia_nim":
      return parseOpenAICompatibleResponse(payload);
    default:
      throw new Error("PROVIDER_KIND_UNSUPPORTED");
  }
}

export function mapDiscoveryHttpStatus(status: number): { status: ModelDiscoveryStatus; errorCode: string } {
  if (status === 401 || status === 403) return { status: "auth", errorCode: "DISCOVERY_AUTH_FAILED" };
  if (status === 404) return { status: "not_configured", errorCode: "DISCOVERY_ENDPOINT_NOT_FOUND" };
  if (status === 429) return { status: "rate_limited", errorCode: "DISCOVERY_RATE_LIMITED" };
  if (status >= 500) return { status: "error", errorCode: "DISCOVERY_PROVIDER_ERROR" };
  return { status: "invalid_response", errorCode: "DISCOVERY_REQUEST_FAILED" };
}

export function mapDiscoveryTransportError(error: unknown): { status: ModelDiscoveryStatus; errorCode: string } {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/^DISCOVERY_TIMEOUT$/.test(message)) return { status: "network", errorCode: "DISCOVERY_TIMEOUT" };
  if (/NATIVE_RUNTIME_NOT_AVAILABLE|ELECTRON_CHROMIUM_ACCOUNT_RUNTIME_REQUIRED/.test(message)) return { status: "error", errorCode: "NATIVE_RUNTIME_REQUIRED" };
  if (/^DISCOVERY_INVALID_RESPONSE$/.test(message)) return { status: "invalid_response", errorCode: "DISCOVERY_INVALID_RESPONSE" };
  if (/PROVIDER_(KIND_UNSUPPORTED|BASE_URL_INVALID)/.test(message)) return { status: "error", errorCode: message.match(/PROVIDER_[A-Z_]+/)?.[0] ?? "DISCOVERY_REQUEST_FAILED" };
  if (/^(?:ELECTRON_ARG_INVALID|SECURE_STORE|PROVIDER_SECRET_REF_REQUIRED)/.test(message)) return { status: "not_configured", errorCode: "DISCOVERY_KEY_NOT_CONFIGURED" };
  return { status: "network", errorCode: "DISCOVERY_NETWORK_ERROR" };
}

const KEY_MATERIAL_PATTERN = /(sk-[A-Za-z0-9_-]{8,}|sk-or-v1-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]{8,}|x-goog-api-key\s*[:=]\s*\S+|AIza[A-Za-z0-9_-]{8,})/gi;

/** Strip anything shaped like key material from an error surfaced to the renderer. */
export function sanitizeDiscoveryErrorMessage(message: string): string {
  return String(message ?? "")
    .replace(KEY_MATERIAL_PATTERN, "[redacted]")
    .slice(0, 300);
}

export function sanitizeDiscoveryResult(input: unknown, providerKind: string): ModelDiscoveryResult {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const models = Array.isArray(value.models)
    ? capModels(
        (value.models as unknown[]).flatMap((item): ProviderModelEntry[] => {
          if (!item || typeof item !== "object") return [];
          const record = item as Record<string, unknown>;
          const id = sanitizeModelId(record.id);
          if (!id) return [];
          return [{ id, name: sanitizeModelName(record.name, id) }];
        }),
      )
    : [];
  const rawStatus = typeof value.status === "string" ? value.status : "error";
  const status: ModelDiscoveryStatus =
    rawStatus === "ok" || rawStatus === "loading" || rawStatus === "auth" || rawStatus === "rate_limited" || rawStatus === "network" || rawStatus === "unsupported" || rawStatus === "not_configured" || rawStatus === "invalid_response" || rawStatus === "error"
      ? rawStatus
      : "error";
  const errorCode = typeof value.errorCode === "string" && /^[A-Z][A-Z0-9_:-]{0,63}$/.test(value.errorCode)
    ? sanitizeDiscoveryErrorMessage(value.errorCode)
    : undefined;
  return { providerKind, status, models, ...(errorCode ? { errorCode } : {}) };
}

/**
 * Keep the selected model tied to its provider: accept the selection only when
 * the model id is present in that provider's discovered list (or a manual
 * entry the operator typed explicitly). Never switch providers implicitly.
 */
export function selectProviderModel(input: { providerKind: string; modelId: string; allowedIds: string[]; allowManualEntry?: boolean }): string | null {
  const modelId = input.modelId.trim();
  if (!modelId || modelId.length > MODEL_DISCOVERY_MAX_ID_LENGTH || !MODEL_ID_PATTERN.test(modelId)) return null;
  if (input.allowedIds.includes(modelId)) return modelId;
  return input.allowManualEntry === true ? modelId : null;
}

/**
 * Read-only model discovery. The API key never leaves the native host: the
 * renderer sends only workspace/provider identifiers and receives the typed
 * contract back. Never publishes or generates content.
 */
export async function requestModelDiscovery(input: { workspaceId: string; providerKind: string; baseUrl?: string }): Promise<ModelDiscoveryResult> {
  const workspaceId = input.workspaceId.trim();
  const providerKind = input.providerKind.trim();
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    return { providerKind, status: "error", models: [], errorCode: "DISCOVERY_WORKSPACE_INVALID" };
  }
  if (!PROVIDER_KINDS.includes(providerKind as ProviderKind)) {
    return { providerKind, status: "error", models: [], errorCode: "PROVIDER_KIND_UNSUPPORTED" };
  }
  try {
    const raw = await invoke<unknown>("provider_discover_models", {
      workspaceId,
      providerKind,
      ...(input.baseUrl?.trim() ? { baseUrl: input.baseUrl.trim() } : {}),
    });
    return sanitizeDiscoveryResult(raw, providerKind);
  } catch (error) {
    const mapped = mapDiscoveryTransportError(error);
    return { providerKind, status: mapped.status, models: [], errorCode: mapped.errorCode };
  }
}
