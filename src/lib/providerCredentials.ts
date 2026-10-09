import { profileSecretAccount, profileSecretRef, secretStore, secretStoreBoundary, type SecretStore } from "./secretStore";
import type { ProviderKind } from "./providerRegistry";
import { activeUserProfileId } from "./profileDomain";

const PROVIDER_KINDS: ProviderKind[] = [
  "openrouter",
  "google_gemini_api",
  "vertex_ai",
  "openai_official",
  "openai_compatible",
  "nvidia_nim",
  "opencode_go",
];

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SECRET_REF_PATTERN = /^env:signalflow\/profiles\/[a-z0-9][a-z0-9_-]{0,63}\/providers\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\/[A-Za-z0-9._:/@+-]{1,240}$/;

export type ProviderKeySaveResult = {
  providerKind: ProviderKind;
  secretRef: string;
  status: "configured";
};

export function providerSecretAccount(workspaceId: string, providerKind: string, profileId = activeUserProfileId()): string {
  if (!PROFILE_ID_PATTERN.test(profileId)) throw new Error("PROFILE_ID_INVALID");
  return profileSecretAccount(profileId, `workspace:${workspaceId}:provider:${providerKind}:api-key`);
}

export function providerSecretRef(workspaceId: string, providerKind: string, profileId = activeUserProfileId()): string {
  return profileSecretRef(profileId, `providers/${workspaceId}/${providerKind}`);
}

function assertScope(workspaceId: string, providerKind: string, profileId: string): ProviderKind {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) throw new Error("PROVIDER_WORKSPACE_INVALID");
  if (!PROVIDER_KINDS.includes(providerKind as ProviderKind)) throw new Error("PROVIDER_KIND_UNSUPPORTED");
  if (!PROFILE_ID_PATTERN.test(profileId)) throw new Error("PROFILE_ID_INVALID");
  return providerKind as ProviderKind;
}

/**
 * Secure generic provider-key entry. The key is written only through the
 * packaged `.env` credential boundary (native secret store) and the caller
 * receives an opaque `secretRef` plus redacted status for Control Plane —
 * never the key itself.
 */
export async function saveProviderKey(
  workspaceId: string,
  providerKind: string,
  apiKey: string,
  store: SecretStore = secretStore,
  profileId = activeUserProfileId(),
): Promise<ProviderKeySaveResult> {
  const kind = assertScope(workspaceId.trim(), providerKind.trim(), profileId);
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("Enter an API key before saving.");
  if (trimmed.length > 100_000 || /[\u0000]/.test(trimmed)) throw new Error("SECURE_STORE_VALUE_INVALID");
  if (store === secretStore && secretStoreBoundary() !== "env_file") {
    throw new Error("API keys require the packaged .env credential boundary. Model discovery is unavailable in preview mode.");
  }
  await store.set(providerSecretAccount(workspaceId.trim(), kind, profileId), trimmed);
  return { providerKind: kind, secretRef: providerSecretRef(workspaceId.trim(), kind, profileId), status: "configured" };
}

export async function clearProviderKey(workspaceId: string, providerKind: string, store: SecretStore = secretStore, profileId = activeUserProfileId()): Promise<void> {
  const kind = assertScope(workspaceId.trim(), providerKind.trim(), profileId);
  await store.delete(providerSecretAccount(workspaceId.trim(), kind, profileId));
}

export function isValidProviderSecretRef(secretRef: unknown, profileId = activeUserProfileId()): boolean {
  return PROFILE_ID_PATTERN.test(profileId) && typeof secretRef === "string"
    && SECRET_REF_PATTERN.test(secretRef)
    && secretRef.startsWith(`env:signalflow/profiles/${profileId}/`);
}
