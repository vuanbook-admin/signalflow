import {
  platformCapabilities,
  preflightPublish,
  type ContentVariant,
  type ChannelBindingState,
  type SocialConnection,
  type SocialPlatform,
} from "./mvpContracts";
import { connectionSecretAccount, secretStore } from "./secretStore";

export type OAuthState = "idle" | "authorizing" | "connected" | "needs_reauth" | "review_required" | "disabled";

export interface ConnectionHealth {
  platform: SocialPlatform;
  state: OAuthState;
  expiresInDays?: number;
  missingScopes: string[];
  canPublish: boolean;
  message: string;
}

export interface OAuthStartRequest {
  platform: SocialPlatform;
  workspaceId: string;
  redirectUri: string;
  state: string;
  clientId?: string;
}

export interface OAuthStartResult {
  platform: SocialPlatform;
  authorizationUrl: string;
  state: string;
  requiresUserConsent: true;
  mode: "official_oauth_pending";
}

const oauthAuthorizeEndpoints: Record<SocialPlatform, string> = {
  facebook: "https://www.facebook.com/v23.0/dialog/oauth",
  instagram: "https://www.facebook.com/v23.0/dialog/oauth",
  tiktok: "https://www.tiktok.com/v2/auth/authorize/",
  youtube: "https://accounts.google.com/o/oauth2/v2/auth",
};

export function startOfficialOAuth(request: OAuthStartRequest): OAuthStartResult {
  const capability = platformCapabilities[request.platform];
  const url = new URL(oauthAuthorizeEndpoints[request.platform]);
  url.searchParams.set("state", request.state);
  url.searchParams.set("redirect_uri", request.redirectUri);
  url.searchParams.set("response_type", "code");
  const scopeExtras = request.platform === "facebook" || request.platform === "instagram" ? ["business_management"] : [];
  url.searchParams.set("scope", [...new Set([...capability.requiredScopes, ...scopeExtras])].join(" "));
  if (request.clientId) url.searchParams.set("client_id", request.clientId);
  if (request.platform === "youtube") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  return { platform: request.platform, authorizationUrl: url.toString(), state: request.state, requiresUserConsent: true, mode: "official_oauth_pending" };
}

export function getConnectionHealth(connection: SocialConnection, now = new Date()): ConnectionHealth {
  const capability = platformCapabilities[connection.platform];
  const missingScopes = capability.requiredScopes.filter((scope) => !connection.scopes.includes(scope));
  const expiresInDays = connection.expiresAt ? Math.ceil((new Date(connection.expiresAt).getTime() - now.getTime()) / 86_400_000) : undefined;
  const state = connection.status;
  const isSimulation = connection.providerMetadata.connectionMode === "simulation";
  const canPublish = !isSimulation && state === "connected" && missingScopes.length === 0 && (expiresInDays === undefined || expiresInDays > 0);
  const message = isSimulation
    ? "A live provider connection is required before publishing."
    : state !== "connected"
    ? "Connection requires attention before publishing."
    : missingScopes.length > 0
      ? `Missing scopes: ${missingScopes.join(", ")}`
      : expiresInDays !== undefined && expiresInDays <= 7
        ? `Token expires in ${Math.max(expiresInDays, 0)} day(s). Re-authentication recommended.`
        : "Connection is healthy and ready for preflight.";
  return { platform: connection.platform, state, expiresInDays, missingScopes, canPublish, message };
}

export function channelBindingStateForConnection(connection: SocialConnection | undefined, now = new Date()): ChannelBindingState {
  if (!connection) return "not_configured";
  if (connection.status === "disabled") return "unsupported";
  if (connection.status === "review_required") return "review_required";
  const health = getConnectionHealth(connection, now);
  if (connection.status === "needs_reauth" || health.expiresInDays !== undefined && health.expiresInDays <= 0 || health.missingScopes.length > 0) return "needs_reauth";
  return health.canPublish ? "connected" : "review_required";
}

export function validateBeforePublish(variant: ContentVariant, connection: SocialConnection, scheduledAt: Date) {
  const health = getConnectionHealth(connection);
  const preflight = preflightPublish(variant, connection, scheduledAt);
  return {
    ok: health.canPublish && preflight.ok,
    health,
    checks: preflight.checks,
  };
}

export async function persistOAuthToken(connection: SocialConnection, accessToken: string): Promise<void> {
  const account = connectionSecretAccount(connection.workspaceId, connection.platform, connection.accountId);
  await secretStore.set(account, accessToken);
}

export async function readOAuthToken(connection: SocialConnection): Promise<string | null> {
  const account = connectionSecretAccount(connection.workspaceId, connection.platform, connection.accountId);
  return await secretStore.get(account);
}

export async function revokeOAuthToken(connection: SocialConnection): Promise<void> {
  const account = connectionSecretAccount(connection.workspaceId, connection.platform, connection.accountId);
  await secretStore.delete(account);
}

export class ConnectionRegistry {
  constructor(private readonly connections: SocialConnection[] = []) {}

  list(workspaceId: string): SocialConnection[] {
    return this.connections.filter((connection) => connection.workspaceId === workspaceId);
  }

  get(platform: SocialPlatform, workspaceId: string): SocialConnection | undefined {
    return this.list(workspaceId).find((connection) => connection.platform === platform);
  }

  health(workspaceId: string): ConnectionHealth[] {
    return this.list(workspaceId).map((connection) => getConnectionHealth(connection));
  }
}
