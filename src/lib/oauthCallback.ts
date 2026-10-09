import type { SocialPlatform } from "./mvpContracts";

export interface PendingOAuthFlow {
  platform: SocialPlatform;
  workspaceId: string;
  state: string;
  profileId: string;
  profileRevision: number;
  createdAt: number;
  expiresAt: number;
}

export interface OAuthCallbackSuccess {
  ok: true;
  platform: SocialPlatform;
  workspaceId: string;
  code: string;
  state: string;
  profileId: string;
  profileRevision: number;
}

export interface OAuthCallbackFailure {
  ok: false;
  reason: "invalid_url" | "state_mismatch" | "expired_state" | "provider_error" | "missing_code" | "stale_profile";
  message: string;
}

export type OAuthCallbackResult = OAuthCallbackSuccess | OAuthCallbackFailure;

const callbackPath = "/oauth/callback";
const metaHttpsCallback = "https://localhost/oauth/callback";
const flowTtlMs = 10 * 60 * 1000;
const pendingFlows = new Map<string, PendingOAuthFlow>();
const profileIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type OAuthProfileIdentity = { profileId: string; profileRevision: number };
export type OAuthFencedExchange<T> = { status: "stale" } | { status: "exchanged"; value: T };

export function registerOAuthFlow(flow: Omit<PendingOAuthFlow, "createdAt" | "expiresAt">): PendingOAuthFlow {
  const now = Date.now();
  const pending: PendingOAuthFlow = { ...flow, createdAt: now, expiresAt: now + flowTtlMs };
  pendingFlows.set(flow.state, pending);
  return pending;
}

export function parseOAuthCallback(rawUrl: string, now = Date.now()): OAuthCallbackResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url", message: "OAuth callback is not a valid URL." };
  }

  const isAllowedCallback = url.href.startsWith(`${metaHttpsCallback}?`) || (url.protocol === "signalflow:" && ((url.hostname === "oauth" && url.pathname === "/callback") || (url.hostname === "" && url.pathname === callbackPath)));
  if (!isAllowedCallback) {
    return { ok: false, reason: "invalid_url", message: "OAuth callback scheme, host or path is not allowed." };
  }

  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  if (providerError) {
    const description = url.searchParams.get("error_description") ?? providerError;
    if (state) pendingFlows.delete(state);
    return { ok: false, reason: "provider_error", message: `Provider denied authorization: ${description}` };
  }

  if (!state) {
    return { ok: false, reason: "state_mismatch", message: "OAuth callback has no state parameter." };
  }

  const pending = pendingFlows.get(state);
  if (!pending || pending.expiresAt < now) {
    pendingFlows.delete(state);
    return { ok: false, reason: "expired_state", message: "OAuth state is missing or expired. Start authorization again." };
  }
  if (!profileIdPattern.test(pending.profileId) || !Number.isSafeInteger(pending.profileRevision) || pending.profileRevision < 0) {
    pendingFlows.delete(state);
    return { ok: false, reason: "stale_profile", message: "OAuth state has no verified profile owner. Start authorization again." };
  }

  const code = url.searchParams.get("code");
  if (!code) {
    pendingFlows.delete(state);
    return { ok: false, reason: "missing_code", message: "OAuth callback has no authorization code." };
  }

  pendingFlows.delete(state);
  return { ok: true, platform: pending.platform, workspaceId: pending.workspaceId, code, state, profileId: pending.profileId, profileRevision: pending.profileRevision };
}

export async function exchangeOAuthCallbackIfCurrent<T>(
  flow: OAuthCallbackSuccess,
  readActiveProfile: () => Promise<OAuthProfileIdentity>,
  exchange: (currentFlow: OAuthCallbackSuccess) => Promise<T>,
): Promise<OAuthFencedExchange<T>> {
  const activeProfile = await readActiveProfile();
  if (flow.profileId !== activeProfile.profileId || flow.profileRevision !== activeProfile.profileRevision) return { status: "stale" };
  return { status: "exchanged", value: await exchange(flow) };
}

export function clearOAuthFlows(): void {
  pendingFlows.clear();
}
