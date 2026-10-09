import { hasNativeRuntime, invoke } from "./nativeRuntime";
import { secretStore, type SecretStore } from "./secretStore";

export type MetaAccountHint = {
  id: string;
  name?: string;
  kind?: string;
  tasks?: string[];
  instagram_business_account?: { id?: string };
};

export type MetaSettingsStatus = {
  appId: string;
  appSecretConfigured: boolean;
  accessTokenConfigured: boolean;
};

export type MetaLiveReadiness = "ready" | "blocked";
export const META_OAUTH_REDIRECT_URI = "https://localhost/oauth/callback";

export const META_PUBLIC_SMOKE_MESSAGE = "SignalFlow live publishing test — Page connection confirmed.";
export function metaPublicSmokeIdempotencyKey(pageId: string): string {
  return `signalflow-public-smoke:${pageId}:v1`;
}

type MetaHintStorage = Pick<Storage, "getItem" | "setItem">;

export function getMetaLiveReadiness(
  hasDiscoveredPage: boolean,
  metaAccessTokenConfigured: boolean,
): MetaLiveReadiness {
  return hasDiscoveredPage && metaAccessTokenConfigured ? "ready" : "blocked";
}

export function canAutoRunDueJobs(
  autoRunDueJobs: boolean,
  liveReadiness: MetaLiveReadiness,
): boolean {
  return autoRunDueJobs && liveReadiness === "ready";
}

const appIdStorageKey = "signalflow.meta.appId";
const metaAccountHintsStorageKey = (profileId: string, workspaceId: string) => `signalflow.profile.${profileId}.meta.account-hints:${encodeURIComponent(workspaceId)}`;
const metaSelectedPageStorageKey = (profileId: string, workspaceId: string) => `signalflow.profile.${profileId}.meta.selected-page:${encodeURIComponent(workspaceId)}`;
const legacyMetaAccountHintsStorageKey = (workspaceId: string) => `signalflow.meta.account-hints:${workspaceId}`;
const legacyMetaSelectedPageStorageKey = (workspaceId: string) => `signalflow.meta.selected-page:${workspaceId}`;
const appSecretKey = (workspaceId: string) => `workspace:${workspaceId}:meta:app-secret`;
const accessTokenKey = (workspaceId: string) => `workspace:${workspaceId}:meta:manual-access-token`;
const defaultMetaHintStorage = (): MetaHintStorage | undefined => typeof window === "undefined" ? undefined : window.localStorage;

function normalizeMetaAccountHints(raw: unknown): MetaAccountHint[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as Partial<MetaAccountHint>;
    const kind = candidate.kind === "page" || candidate.kind === "instagram_business" ? candidate.kind : undefined;
    if (!kind || typeof candidate.id !== "string" || !candidate.id.trim()) return [];
    return [{ id: candidate.id.trim(), ...(typeof candidate.name === "string" && candidate.name.trim() ? { name: candidate.name.trim() } : {}), kind }];
  });
}

function validateMetaProfileId(profileId: string): string {
  if (typeof profileId !== "string" || profileId !== profileId.trim() || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profileId)) throw new Error("PROFILE_ID_INVALID");
  return profileId;
}

export function persistMetaAccountHints(profileId: string, workspaceId: string, hints: MetaAccountHint[], storage: MetaHintStorage | undefined = defaultMetaHintStorage()): void {
  const safeProfileId = validateMetaProfileId(profileId);
  if (!storage || !workspaceId.trim()) return;
  storage.setItem(metaAccountHintsStorageKey(safeProfileId, workspaceId), JSON.stringify(normalizeMetaAccountHints(hints)));
}

export function readMetaAccountHints(profileId: string, workspaceId: string, storage: MetaHintStorage | undefined = defaultMetaHintStorage()): MetaAccountHint[] {
  const safeProfileId = validateMetaProfileId(profileId);
  if (!storage || !workspaceId.trim()) return [];
  try {
    const scopedKey = metaAccountHintsStorageKey(safeProfileId, workspaceId);
    const scopedValue = storage.getItem(scopedKey);
    if (scopedValue !== null) return normalizeMetaAccountHints(JSON.parse(scopedValue));
    if (safeProfileId !== "profile-bavy") return [];
    const legacyValue = storage.getItem(legacyMetaAccountHintsStorageKey(workspaceId));
    if (legacyValue === null) return [];
    const ownerHints = normalizeMetaAccountHints(JSON.parse(legacyValue));
    try { storage.setItem(scopedKey, JSON.stringify(ownerHints)); } catch { /* retain the owner-only legacy read for this session */ }
    return ownerHints;
  } catch {
    return [];
  }
}

export function persistMetaSelectedPageId(profileId: string, workspaceId: string, pageId: string, storage: MetaHintStorage | undefined = defaultMetaHintStorage()): void {
  const safeProfileId = validateMetaProfileId(profileId);
  if (!storage || !workspaceId.trim()) return;
  storage.setItem(metaSelectedPageStorageKey(safeProfileId, workspaceId), pageId.trim());
}

export function readMetaSelectedPageId(profileId: string, workspaceId: string, storage: MetaHintStorage | undefined = defaultMetaHintStorage()): string {
  const safeProfileId = validateMetaProfileId(profileId);
  if (!storage || !workspaceId.trim()) return "";
  try {
    const scopedKey = metaSelectedPageStorageKey(safeProfileId, workspaceId);
    const scopedValue = storage.getItem(scopedKey);
    if (scopedValue !== null) return scopedValue.trim();
    if (safeProfileId !== "profile-bavy") return "";
    const legacyValue = storage.getItem(legacyMetaSelectedPageStorageKey(workspaceId));
    if (legacyValue === null) return "";
    const ownerPageId = legacyValue.trim();
    try { storage.setItem(scopedKey, ownerPageId); } catch { /* retain the owner-only legacy read for this session */ }
    return ownerPageId;
  } catch {
    return "";
  }
}

export function resolveMetaCredentialValue(inputValue: string, stateValue: string): string {
  return inputValue.trim() || stateValue.trim();
}

export function chooseMetaPageId(hints: Array<Pick<MetaAccountHint, "id" | "kind">>, savedPageId: string): string {
  const pages = hints.filter((hint) => hint.kind === "page");
  if (pages.some((page) => page.id === savedPageId)) return savedPageId;
  return pages.length === 1 ? pages[0].id : "";
}

function legacyMetaWorkspaceIds(workspaceId: string): string[] {
  return workspaceId === "workspace-mile-mark-money" ? ["mile-mark-money"] : [];
}

async function readMetaSecretWithMigration(workspaceId: string, keyFactory: (id: string) => string, store: SecretStore): Promise<string | null> {
  const current = await store.get(keyFactory(workspaceId));
  if (current) return current;
  for (const legacyId of legacyMetaWorkspaceIds(workspaceId)) {
    const legacy = await store.get(keyFactory(legacyId));
    if (legacy) {
      await store.set(keyFactory(workspaceId), legacy);
      return legacy;
    }
  }
  return null;
}

export function readMetaAppId(): string {
  if (typeof window === "undefined") return import.meta.env.VITE_META_APP_ID ?? "";
  return window.localStorage.getItem(appIdStorageKey) ?? import.meta.env.VITE_META_APP_ID ?? "";
}

export async function saveMetaSettings(workspaceId: string, input: { appId: string; appSecret: string; accessToken: string }): Promise<void> {
  if (typeof window !== "undefined") window.localStorage.setItem(appIdStorageKey, input.appId.trim());
  if (input.appSecret.trim()) await secretStore.set(appSecretKey(workspaceId), input.appSecret.trim());
  if (input.accessToken.trim()) {
    if (hasNativeRuntime()) await invoke("meta_save_access_token", { workspaceId, accessToken: input.accessToken.trim() });
    else await secretStore.set(accessTokenKey(workspaceId), input.accessToken.trim());
  }
}

export async function readMetaSettingsStatus(workspaceId: string, store: SecretStore = secretStore): Promise<MetaSettingsStatus> {
  const [appSecret, accessToken] = await Promise.all([
    readMetaSecretWithMigration(workspaceId, appSecretKey, store),
    readMetaSecretWithMigration(workspaceId, accessTokenKey, store),
  ]);
  return { appId: readMetaAppId(), appSecretConfigured: Boolean(appSecret), accessTokenConfigured: Boolean(accessToken) };
}

export async function discoverMetaAccounts(workspaceId: string): Promise<{ provider: "meta"; status: string; tokenBoundary: string; accountHints: MetaAccountHint[] }> {
  if (!hasNativeRuntime()) {
    throw new Error("META_NATIVE_BOUNDARY_REQUIRED: Open the packaged SignalFlow app for .env credential discovery.");
  }
  await readMetaSettingsStatus(workspaceId);
  return await invoke("meta_discover_accounts", { workspaceId });
}

export type MetaTokenExchangeResult = {
  provider: "meta";
  status: "long_lived_token_saved";
  expiresIn?: number | null;
  expiresAt?: number | null;
  tokenBoundary: "env_file";
};

export async function exchangeMetaToken(workspaceId: string, appId: string): Promise<MetaTokenExchangeResult> {
  if (!hasNativeRuntime()) {
    throw new Error("META_NATIVE_BOUNDARY_REQUIRED: open the packaged SignalFlow app");
  }
  return await invoke<MetaTokenExchangeResult>("meta_exchange_long_lived_token", { workspaceId, appId });
}

export type MetaOAuthCodeExchangeResult = {
  provider: "meta";
  status: "oauth_connected";
  expiresIn?: number | null;
  expiresAt?: number | null;
  tokenBoundary: "env_file";
  accountHints: MetaAccountHint[];
};

export async function exchangeMetaOAuthCode(workspaceId: string, appId: string, code: string, profileId: string, profileRevision: number): Promise<MetaOAuthCodeExchangeResult> {
  if (!hasNativeRuntime()) {
    throw new Error("META_NATIVE_BOUNDARY_REQUIRED: open the packaged SignalFlow app");
  }
  return await invoke<MetaOAuthCodeExchangeResult>("meta_exchange_oauth_code", {
    workspaceId,
    appId,
    code,
    redirectUri: META_OAUTH_REDIRECT_URI,
    profileId,
    profileRevision,
  });
}


export type MetaSmokePostResult = {
  provider: "meta";
  providerJobId: string;
  providerState: "accepted";
  published: false;
  idempotentReplay: boolean;
  tokenBoundary: "env_file";
};

export async function publishMetaUnpublishedPagePost(
  workspaceId: string,
  pageId: string,
  message: string,
): Promise<MetaSmokePostResult> {
  if (!hasNativeRuntime()) {
    throw new Error("META_NATIVE_BOUNDARY_REQUIRED: open the packaged Tauri app");
  }
  return await invoke<MetaSmokePostResult>("meta_publish_unpublished_page_post", {
    workspaceId,
    pageId,
    message,
  });
}

export type MetaQueuedPublishResult = {
  provider: "meta";
  providerJobId: string;
  providerState: "published";
  published: true;
  idempotentReplay: boolean;
  tokenBoundary: "env_file";
};

export async function publishMetaPageJob(
  workspaceId: string,
  pageId: string,
  message: string,
  idempotencyKey: string,
): Promise<MetaQueuedPublishResult> {
  if (!hasNativeRuntime()) {
    throw new Error("META_NATIVE_BOUNDARY_REQUIRED: open the packaged Tauri app");
  }
  return await invoke<MetaQueuedPublishResult>("meta_publish_page_job", {
    workspaceId,
    pageId,
    message,
    idempotencyKey,
    approvalState: "approved",
  });
}

export async function publishMetaPagePhotoJob(
  workspaceId: string,
  pageId: string,
  caption: string,
  mediaUrl: string,
  idempotencyKey: string,
): Promise<MetaQueuedPublishResult> {
  if (!hasNativeRuntime()) {
    throw new Error("META_NATIVE_BOUNDARY_REQUIRED: open the packaged Tauri app");
  }
  return await invoke<MetaQueuedPublishResult>("meta_publish_page_photo_job", {
    workspaceId,
    pageId,
    caption,
    mediaUrl,
    idempotencyKey,
    approvalState: "approved",
  });
}

export async function publishMetaPageVideoJob(
  workspaceId: string,
  pageId: string,
  caption: string,
  mediaUrl: string,
  idempotencyKey: string,
): Promise<MetaQueuedPublishResult> {
  if (!hasNativeRuntime()) {
    throw new Error("META_NATIVE_BOUNDARY_REQUIRED: open the packaged SignalFlow app");
  }
  return await invoke<MetaQueuedPublishResult>("meta_publish_page_video_job", {
    workspaceId,
    pageId,
    caption,
    mediaUrl,
    idempotencyKey,
    approvalState: "approved",
  });
}
export async function publishMetaInstagramJob(
  workspaceId: string,
  pageId: string,
  instagramUserId: string,
  caption: string,
  mediaUrl: string,
  mediaKind: "image" | "video",
  idempotencyKey: string,
): Promise<MetaQueuedPublishResult> {
  if (!hasNativeRuntime()) {
    throw new Error("META_NATIVE_BOUNDARY_REQUIRED: open the packaged SignalFlow app");
  }
  return await invoke<MetaQueuedPublishResult>("meta_publish_instagram_job", {
    workspaceId,
    pageId,
    instagramUserId,
    caption,
    mediaUrl,
    mediaKind,
    idempotencyKey,
    approvalState: "approved",
  });
}
