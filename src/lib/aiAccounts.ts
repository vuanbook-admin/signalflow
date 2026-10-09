import { profileSecretAccount, secretStore, secretStoreBoundary, type SecretStore } from "./secretStore";
import { activeUserProfileId } from "./profileDomain";

export type AIProvider = "openai" | "gemini";
export type AIAccountMode = "api" | "manual_assisted" | "web_subscription";
export type AIAccountStatus = "not_configured" | "configured" | "manual_assist" | "web_session";

export interface AIAccountRecord {
  provider: AIProvider;
  mode: AIAccountMode;
  status: AIAccountStatus;
  model: string;
  displayName: string;
  loginUrl: string;
  lastManualAssistAt?: string;
  lastWebSessionAt?: string;
}

export type AIAccountRegistry = Record<AIProvider, AIAccountRecord>;

export interface ScalarMetadataStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const AI_MODEL_OPTIONS: Record<AIProvider, string[]> = {
  openai: ["gpt-5.6", "gpt-5.4-mini"],
  gemini: ["gemini-3.7-flash", "gemini-3.5-pro"],
};

const AI_LOGIN_URLS: Record<AIProvider, string> = {
  openai: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/",
};

const AI_METADATA_KEY_PREFIX = "signalflow.ai.accounts.v1:";

function browserStorage(): ScalarMetadataStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function metadataKey(workspaceId: string, profileId: string): string {
  return `${AI_METADATA_KEY_PREFIX}${profileId}:${workspaceId}`;
}

export function aiSecretAccount(workspaceId: string, provider: AIProvider, profileId = activeUserProfileId()): string {
  return profileSecretAccount(profileId, `workspace:${workspaceId}:ai:${provider}:api-key`);
}

export function getAIProviderLoginUrl(provider: AIProvider): string {
  return AI_LOGIN_URLS[provider];
}

export function defaultAIAccount(provider: AIProvider): AIAccountRecord {
  const isGemini = provider === "gemini";
  return {
    provider,
    mode: isGemini ? "web_subscription" : "api",
    status: "not_configured",
    model: AI_MODEL_OPTIONS[provider][0],
    displayName: provider === "openai" ? "OpenAI" : "Google Gemini",
    loginUrl: getAIProviderLoginUrl(provider),
  };
}

export function defaultAIAccounts(): AIAccountRegistry {
  return { openai: defaultAIAccount("openai"), gemini: defaultAIAccount("gemini") };
}

export function sanitizeAIAccountRecord(input: unknown, provider: AIProvider): AIAccountRecord {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const model = typeof value.model === "string" && AI_MODEL_OPTIONS[provider].includes(value.model) ? value.model : defaultAIAccount(provider).model;
  const mode: AIAccountMode = value.mode === "manual_assisted" ? "manual_assisted" : value.mode === "web_subscription" ? "web_subscription" : "api";
  const status: AIAccountStatus = mode === "manual_assisted" ? "manual_assist" : mode === "web_subscription" && typeof value.lastWebSessionAt === "string" && value.lastWebSessionAt.length > 0 ? "web_session" : "not_configured";
  const lastManualAssistAt = typeof value.lastManualAssistAt === "string" && value.lastManualAssistAt.length < 80 ? value.lastManualAssistAt : undefined;
  const lastWebSessionAt = typeof value.lastWebSessionAt === "string" && value.lastWebSessionAt.length < 80 ? value.lastWebSessionAt : undefined;
  return { ...defaultAIAccount(provider), mode, status, model, lastManualAssistAt, lastWebSessionAt };
}

function readStoredMetadata(workspaceId: string, storage: ScalarMetadataStorage | undefined, profileId: string): Partial<AIAccountRegistry> {
  if (!storage) return {};
  try {
    let raw = storage.getItem(metadataKey(workspaceId, profileId));
    if (!raw && profileId === "profile-bavy") {
      raw = storage.getItem(`${AI_METADATA_KEY_PREFIX}${workspaceId}`);
      if (raw) storage.setItem(metadataKey(workspaceId, profileId), raw);
    }
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const gemini = sanitizeAIAccountRecord(parsed.gemini, "gemini");
    return {
      openai: sanitizeAIAccountRecord(parsed.openai, "openai"),
      gemini: gemini.mode === "manual_assisted" ? { ...defaultAIAccount("gemini"), model: gemini.model } : gemini,
    };
  } catch {
    return {};
  }
}

function writeStoredMetadata(workspaceId: string, registry: AIAccountRegistry, storage: ScalarMetadataStorage | undefined, profileId: string): void {
  if (!storage) return;
  const scalarRegistry = {
    openai: { provider: registry.openai.provider, mode: registry.openai.mode, model: registry.openai.model, lastManualAssistAt: registry.openai.lastManualAssistAt, lastWebSessionAt: registry.openai.lastWebSessionAt },
    gemini: { provider: registry.gemini.provider, mode: registry.gemini.mode, model: registry.gemini.model, lastManualAssistAt: registry.gemini.lastManualAssistAt, lastWebSessionAt: registry.gemini.lastWebSessionAt },
  };
  try { storage.setItem(metadataKey(workspaceId, profileId), JSON.stringify(scalarRegistry)); } catch { /* metadata persistence is best effort */ }
}

export async function readAIAccountRegistry(workspaceId: string, store: SecretStore = secretStore, storage: ScalarMetadataStorage | undefined = browserStorage(), profileId = activeUserProfileId()): Promise<AIAccountRegistry> {
  const stored = readStoredMetadata(workspaceId, storage, profileId);
  const registry = defaultAIAccounts();
  for (const provider of ["openai", "gemini"] as const) {
    const metadata = stored[provider] ?? registry[provider];
    const secret = await store.get(aiSecretAccount(workspaceId, provider, profileId)).catch(() => null);
    registry[provider] = {
      ...metadata,
      status: metadata.mode === "manual_assisted" ? "manual_assist" : metadata.mode === "web_subscription" && metadata.lastWebSessionAt ? "web_session" : secret ? "configured" : "not_configured",
    };
  }
  return registry;
}

export async function readAIProviderKey(workspaceId: string, provider: AIProvider, store: SecretStore = secretStore, profileId = activeUserProfileId()): Promise<string | null> {
  return store.get(aiSecretAccount(workspaceId, provider, profileId));
}

export async function saveAIProviderKey(workspaceId: string, provider: AIProvider, apiKey: string, model: string, store: SecretStore = secretStore, storage: ScalarMetadataStorage | undefined = browserStorage(), profileId = activeUserProfileId()): Promise<AIAccountRegistry> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("Enter an API key before saving.");
  if (store === secretStore && secretStoreBoundary() !== "env_file") throw new Error("API keys require the packaged .env credential boundary. Use Manual assist or configure the provider key.");
  const registry = await readAIAccountRegistry(workspaceId, store, storage, profileId);
  await store.set(aiSecretAccount(workspaceId, provider, profileId), trimmed);
  registry[provider] = { ...registry[provider], mode: "api", status: "configured", model: AI_MODEL_OPTIONS[provider].includes(model) ? model : registry[provider].model, lastManualAssistAt: undefined };
  writeStoredMetadata(workspaceId, registry, storage, profileId);
  return registry;
}

export async function markAIManualAssist(workspaceId: string, provider: AIProvider, model: string, storage: ScalarMetadataStorage | undefined = browserStorage(), profileId = activeUserProfileId()): Promise<AIAccountRegistry> {
  const registry = await readAIAccountRegistry(workspaceId, secretStore, storage, profileId);
  registry[provider] = { ...registry[provider], mode: "manual_assisted", status: "manual_assist", model: AI_MODEL_OPTIONS[provider].includes(model) ? model : registry[provider].model, lastManualAssistAt: new Date().toISOString() };
  writeStoredMetadata(workspaceId, registry, storage, profileId);
  return registry;
}

export async function markAIWebSubscription(workspaceId: string, provider: AIProvider, model: string, store: SecretStore = secretStore, storage: ScalarMetadataStorage | undefined = browserStorage(), profileId = activeUserProfileId()): Promise<AIAccountRegistry> {
  if (provider !== "gemini" && provider !== "openai") throw new Error("Unsupported web subscription provider.");
  const registry = await readAIAccountRegistry(workspaceId, store, storage, profileId);
  registry[provider] = { ...registry[provider], mode: "web_subscription", status: "web_session", model: AI_MODEL_OPTIONS[provider].includes(model) ? model : registry[provider].model, lastWebSessionAt: new Date().toISOString() };
  writeStoredMetadata(workspaceId, registry, storage, profileId);
  return registry;
}

export async function updateAIProviderModel(workspaceId: string, provider: AIProvider, model: string, storage: ScalarMetadataStorage | undefined = browserStorage(), profileId = activeUserProfileId()): Promise<AIAccountRegistry> {
  const registry = await readAIAccountRegistry(workspaceId, secretStore, storage, profileId);
  registry[provider] = { ...registry[provider], model: AI_MODEL_OPTIONS[provider].includes(model) ? model : registry[provider].model };
  writeStoredMetadata(workspaceId, registry, storage, profileId);
  return registry;
}

export async function clearAIProvider(workspaceId: string, provider: AIProvider, store: SecretStore = secretStore, storage: ScalarMetadataStorage | undefined = browserStorage(), profileId = activeUserProfileId()): Promise<AIAccountRegistry> {
  await store.delete(aiSecretAccount(workspaceId, provider, profileId));
  const registry = await readAIAccountRegistry(workspaceId, store, storage, profileId);
  registry[provider] = { ...defaultAIAccount(provider), model: registry[provider].model };
  writeStoredMetadata(workspaceId, registry, storage, profileId);
  return registry;
}
