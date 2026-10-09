export type ProviderKind = "openrouter" | "google_gemini_api" | "vertex_ai" | "openai_official" | "openai_compatible" | "nvidia_nim" | "opencode_go";
export type ProviderCapability = "copy" | "image" | "video";
export type ProviderStatus = "not_configured" | "needs_reauth" | "review_required" | "connected" | "unsupported";

export type ProviderRegistryEntry = {
  kind: ProviderKind;
  displayName: string;
  requiredFields: string[];
  capabilities: ProviderCapability[];
  healthProbe: "model_list" | "readiness" | "operator_approved_smoke";
  allowFallback: false;
};

export type ProviderConfiguration = {
  id: string;
  clientId: string;
  providerKind: ProviderKind;
  displayName: string;
  model: string;
  baseUrl?: string;
  projectId?: string;
  location?: string;
  secretRef?: string;
  status: ProviderStatus;
  capabilities: ProviderCapability[];
};

export type ProviderHealthResult = { providerId: string; providerKind: ProviderKind; model: string; capabilities: ProviderCapability[]; checkedAt: string; status: ProviderStatus; errorCode?: string };

export const providerRegistry: ProviderRegistryEntry[] = [
  { kind: "openrouter", displayName: "OpenRouter", requiredFields: ["model", "secretRef"], capabilities: ["copy", "image", "video"], healthProbe: "model_list", allowFallback: false },
  { kind: "google_gemini_api", displayName: "Google Gemini API", requiredFields: ["model", "secretRef"], capabilities: ["copy", "image", "video"], healthProbe: "model_list", allowFallback: false },
  { kind: "vertex_ai", displayName: "Vertex AI", requiredFields: ["projectId", "location", "model", "secretRef"], capabilities: ["copy", "image", "video"], healthProbe: "readiness", allowFallback: false },
  { kind: "openai_official", displayName: "OpenAI API", requiredFields: ["model", "secretRef"], capabilities: ["copy", "image", "video"], healthProbe: "model_list", allowFallback: false },
  { kind: "openai_compatible", displayName: "OpenAI-compatible endpoint", requiredFields: ["baseUrl", "model", "secretRef"], capabilities: ["copy", "image", "video"], healthProbe: "readiness", allowFallback: false },
  { kind: "nvidia_nim", displayName: "NVIDIA NIM", requiredFields: ["baseUrl", "model", "secretRef"], capabilities: ["copy", "image", "video"], healthProbe: "model_list", allowFallback: false },
  { kind: "opencode_go", displayName: "OpenCode Go", requiredFields: ["model", "secretRef"], capabilities: ["copy"], healthProbe: "operator_approved_smoke", allowFallback: false },
];

const sensitive = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|cookie|password|private[_-]?key|session(?:data)?)/i;
const authPath = /(?:\/\.hermes(?:\/|$)|\/\.local\/share\/opencode(?:\/|$)|\/opencode\/auth\.json$)/i;
const PROFILE_SECRET_REF = /^env:signalflow\/profiles\/[a-z0-9][a-z0-9_-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,240}$/;
const allowedCapabilities: ProviderCapability[] = ["copy", "image", "video"];

function hasSensitive(value: unknown): boolean {
  if (typeof value === "string") return authPath.test(value);
  if (Array.isArray(value)) return value.some(hasSensitive);
  return Boolean(value && typeof value === "object" && Object.entries(value).some(([key, item]) => sensitive.test(key) || hasSensitive(item)));
}

export function validateProviderConfiguration(input: Record<string, unknown>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (hasSensitive(input)) errors.push("SENSITIVE_FIELD_REJECTED");
  const descriptor = providerRegistry.find((item) => item.kind === input.providerKind);
  if (!descriptor) errors.push("PROVIDER_KIND_UNSUPPORTED");
  for (const field of ["id", "clientId", "displayName", "model", "status"]) if (typeof input[field] !== "string" || !input[field]?.trim()) errors.push(`PROVIDER_${field.toUpperCase()}_INVALID`);
  if (typeof input.model === "string" && (!/^[A-Za-z0-9._:/@+-]{1,240}$/.test(input.model))) errors.push("PROVIDER_MODEL_INVALID");
  if (input.providerKind === "openai_compatible" || input.providerKind === "nvidia_nim") {
    if (typeof input.baseUrl !== "string" || !/^https:\/\//i.test(input.baseUrl)) errors.push("PROVIDER_BASE_URL_INVALID");
  }
  if (input.providerKind === "vertex_ai") {
    if (typeof input.projectId !== "string" || !input.projectId.trim()) errors.push("PROVIDER_PROJECT_ID_INVALID");
    if (typeof input.location !== "string" || !input.location.trim()) errors.push("PROVIDER_LOCATION_INVALID");
  }
  if (typeof input.secretRef !== "string" || !input.secretRef.trim()) errors.push("PROVIDER_SECRET_REF_REQUIRED");
  else if (!PROFILE_SECRET_REF.test(input.secretRef) || input.secretRef.includes("..")) errors.push("PROVIDER_SECRET_REF_SCOPE_INVALID");
  if (!Array.isArray(input.capabilities) || input.capabilities.some((value) => !allowedCapabilities.includes(value as ProviderCapability))) errors.push("PROVIDER_CAPABILITIES_INVALID");
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function createProviderHealthResult(input: { providerId: string; providerKind: ProviderKind; model: string; capabilities: ProviderCapability[]; checkedAt: string; policyConfirmationRequired?: boolean }): ProviderHealthResult {
  if (input.providerKind === "opencode_go" && input.policyConfirmationRequired) return { ...input, status: "review_required", errorCode: "POLICY_CONFIRMATION_REQUIRED" };
  return { providerId: input.providerId, providerKind: input.providerKind, model: input.model, capabilities: [...input.capabilities], checkedAt: input.checkedAt, status: "connected" };
}
