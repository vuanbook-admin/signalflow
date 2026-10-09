import type { StrategySnapshot } from "./contentStrategy";
export type { StrategySnapshot } from "./contentStrategy";

export type SocialPlatform = "facebook" | "instagram" | "tiktok" | "youtube";
export type ContentKind = "text" | "image" | "carousel" | "video" | "short_video" | "long_video";
export type ContentLifecycle = "idea" | "draft" | "needs_review" | "approved" | "scheduled" | "publishing" | "published" | "failed";
export type ChannelBindingState = "connected" | "not_configured" | "needs_reauth" | "review_required" | "unsupported";
export type GenerationExecutionMode = "subscription_package" | "llm_provider";
export type GenerationCapability = "copy" | "image" | "video";

export interface GenerationProfile {
  id: string;
  brandId: string;
  mode: GenerationExecutionMode;
  provider: string;
  model: string;
  capabilities: GenerationCapability[];
  status: "not_configured" | "needs_reauth" | "review_required" | "connected" | "unsupported";
  secretRef?: string;
}

export interface ProviderConfiguration {
  id: string;
  clientId: string;
  providerKind: string;
  displayName: string;
  model: string;
  baseUrl?: string;
  projectId?: string;
  location?: string;
  secretRef?: string;
  status: "not_configured" | "needs_reauth" | "review_required" | "connected" | "unsupported";
  capabilities: GenerationCapability[];
}

export interface ClientDisplayAlias {
  clientId: string;
  clientLabel: string;
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  timezone: string;
}

export interface BrandSystem {
  workspaceId: string;
  voice: string;
  audience: string;
  prohibitedClaims: string[];
  requiredDisclosure?: string;
  visualTokens: { primary: string; secondary: string; typography: string };
}

export interface SocialConnection {
  id: string;
  workspaceId: string;
  platform: SocialPlatform;
  accountId: string;
  displayName: string;
  status: "connected" | "needs_reauth" | "review_required" | "disabled";
  scopes: string[];
  expiresAt?: string;
  providerMetadata: Record<string, unknown>;
}

export interface ContentVariant {
  id: string;
  contentId: string;
  platform: SocialPlatform;
  kind: ContentKind;
  title?: string;
  body?: string;
  caption?: string;
  contentPillar?: string;
  contentAngle?: string;
  objective?: string;
  strategyVersion?: number;
  catalogFingerprint?: string;
  strategySnapshot?: StrategySnapshot;
  cta?: string;
  mediaAssetIds: string[];
  hashtags: string[];
  fullText?: string;
  seoKeywords?: string[];
  scheduledAt?: string;
  sources?: string[];
  notes?: string;
  qualityStatus?: "pending" | "passed" | "failed";
  approvalState?: "proposed" | "ready" | "scheduled" | "publishing" | "published" | "failed";
  metadata: Record<string, unknown>;
  lifecycle: ContentLifecycle;
}

export interface ManualPublishPackage {
  platform: SocialPlatform;
  account: string;
  scheduledAt: string;
  kind: ContentKind;
  title?: string;
  caption: string;
  hashtags: string[];
  fullText: string;
  mediaAssetIds: string[];
  mediaUrl?: string;
  livePublishAttempted: false;
  note: string;
}

export function createManualPublishPackage(variant: ContentVariant, connection: SocialConnection, scheduledAt: Date): ManualPublishPackage {
  const metadata = variant.metadata as { publicUrl?: string; imageUrl?: string; videoUrl?: string };
  return {
    platform: connection.platform,
    account: connection.displayName,
    scheduledAt: scheduledAt.toISOString(),
    kind: variant.kind,
    title: variant.title,
    caption: variant.body?.trim() ?? "",
    hashtags: [...variant.hashtags],
    fullText: [variant.body?.trim() ?? "", variant.hashtags.join(" ")].filter(Boolean).join("\n\n"),
    mediaAssetIds: [...variant.mediaAssetIds],
    mediaUrl: metadata.publicUrl ?? metadata.imageUrl ?? metadata.videoUrl,
    livePublishAttempted: false,
    note: "Manual fallback package. SignalFlow did not call a live provider.",
  };
}

export interface ContentItem {
  id: string;
  workspaceId: string;
  campaignId?: string;
  sourcePrompt: string;
  brandSystemVersion: string;
  createdBy: "human" | "ai";
  createdAt: string;
  variants: ContentVariant[];
  lifecycle: ContentLifecycle;
}

export type ProviderJobState = "accepted" | "processing" | "published" | "failed" | "unknown";

export interface ProviderPublishResult {
  providerJobId?: string;
  providerState?: ProviderJobState;
}

export interface ProviderReconciliationResult {
  providerJobId?: string;
  providerState: ProviderJobState;
  message?: string;
  retryable?: boolean;
}

export interface PublishJob {
  id: string;
  variantId: string;
  connectionId: string;
  scheduledAt: string;
  idempotencyKey: string;
  state: "queued" | "preflight_failed" | "uploading" | "processing" | "published" | "retryable_error" | "permanent_error" | "canceled";
  providerJobId?: string;
  providerState?: ProviderJobState;
  lastSyncedAt?: string;
  attempts: number;
  lastError?: { code: string; message: string; retryable: boolean };
  clientId?: string;
  brandId?: string;
  bindingId?: string;
  identityVersionId?: string;
  legacyNonLive?: boolean;
  /** Legacy snapshot marker; new queue records never set it. */
  simulation?: boolean;
}

export interface ImageAttachment {
  assetId: string;
  localAssetPath: string;
  mimeType: string;
  sha256?: string;
}

export interface MediaAttachment {
  assetId: string;
  localAssetPath: string;
  mimeType: string;
  sha256?: string;
  order: number;
  role: "publish" | "reference";
}

export interface MediaAttachmentEvidence extends Omit<MediaAttachment, "localAssetPath" | "sha256"> {
  sha256: string;
  uploadState: "processed";
}

export interface AIGenerationRequest {
  workspaceId: string;
  prompt: string;
  targetPlatforms: SocialPlatform[];
  contentKinds: ContentKind[];
  brandSystem: BrandSystem;
  modelPreference?: "fast" | "balanced" | "quality";
  imageAttachment?: ImageAttachment;
  mediaAttachments?: MediaAttachment[];
  customerFacts?: string[];
  metadata?: Record<string, unknown>;
}

export interface AIGenerationResult {
  traceId: string;
  provider: "openai_api" | "gemini_api" | "gemini_web" | "chatgpt_web" | "manual_assisted" | "mock";
  variants: Array<Pick<ContentVariant, "platform" | "kind" | "title" | "body" | "caption" | "contentPillar" | "contentAngle" | "objective" | "strategyVersion" | "catalogFingerprint" | "strategySnapshot" | "cta" | "hashtags" | "seoKeywords" | "scheduledAt" | "sources" | "notes" | "metadata">>;
  safetyNotes: string[];
}

export interface PlatformCapability {
  platform: SocialPlatform;
  supportedKinds: ContentKind[];
  requiresPublicMediaUrl: boolean;
  supportsProviderScheduling: boolean;
  maxScheduleDays?: number;
  requiresAuditForPublicPublishing: boolean;
  requiredScopes: string[];
}

export const platformCapabilities: Record<SocialPlatform, PlatformCapability> = {
  facebook: { platform: "facebook", supportedKinds: ["text", "image", "video", "carousel"], requiresPublicMediaUrl: false, supportsProviderScheduling: true, maxScheduleDays: 30, requiresAuditForPublicPublishing: false, requiredScopes: ["pages_manage_posts", "pages_read_engagement"] },
  instagram: { platform: "instagram", supportedKinds: ["image", "carousel", "short_video"], requiresPublicMediaUrl: true, supportsProviderScheduling: false, requiresAuditForPublicPublishing: false, requiredScopes: ["instagram_basic", "instagram_content_publish"] },
  tiktok: { platform: "tiktok", supportedKinds: ["image", "carousel", "short_video"], requiresPublicMediaUrl: true, supportsProviderScheduling: false, requiresAuditForPublicPublishing: true, requiredScopes: ["video.publish"] },
  youtube: { platform: "youtube", supportedKinds: ["short_video", "long_video"], requiresPublicMediaUrl: false, supportsProviderScheduling: true, requiresAuditForPublicPublishing: true, requiredScopes: ["youtube.upload"] },
};

export interface PreflightResult { ok: boolean; checks: Array<{ key: string; ok: boolean; message: string }>; }

export function preflightPublish(variant: ContentVariant, connection: SocialConnection, scheduledAt: Date): PreflightResult {
  const capability = platformCapabilities[connection.platform];
  const mediaMetadata = variant.metadata as { publicUrl?: string; imageUrl?: string; videoUrl?: string };
  const hasPublicMedia = Boolean(mediaMetadata.publicUrl ?? mediaMetadata.imageUrl ?? mediaMetadata.videoUrl);
  const scheduleDeltaMs = scheduledAt.getTime() - Date.now();
  const maxScheduleMs = capability.maxScheduleDays === undefined ? undefined : capability.maxScheduleDays * 86_400_000;
  const scheduleWithinProviderWindow = maxScheduleMs === undefined || scheduleDeltaMs <= maxScheduleMs;
  const isSimulation = connection.providerMetadata.connectionMode === "simulation";
  const connectionReady = connection.status === "connected" && !isSimulation;
  const checks = [
    { key: "connection", ok: connectionReady, message: connectionReady ? "Connection is healthy." : isSimulation ? "A live provider connection is required before publication." : "Connection needs re-authentication or review." },
    { key: "kind", ok: capability.supportedKinds.includes(variant.kind), message: capability.supportedKinds.includes(variant.kind) ? "Content kind is supported." : `Content kind ${variant.kind} is not supported by ${connection.platform}.` },
    { key: "scopes", ok: capability.requiredScopes.every((scope) => connection.scopes.includes(scope)), message: capability.requiredScopes.every((scope) => connection.scopes.includes(scope)) ? "Required scopes are present." : "One or more required scopes are missing." },
    { key: "media", ok: !capability.requiresPublicMediaUrl || hasPublicMedia, message: !capability.requiresPublicMediaUrl || hasPublicMedia ? "Media requirements are satisfied." : "A public media URL is required before publishing to this platform." },
    { key: "schedule", ok: scheduledAt.getTime() > Date.now(), message: scheduledAt.getTime() > Date.now() ? "Scheduled time is in the future." : "Scheduled time must be in the future." },
    { key: "provider_window", ok: scheduleWithinProviderWindow, message: scheduleWithinProviderWindow ? "Scheduled time is within the provider window." : `Scheduled time exceeds the ${capability.maxScheduleDays}-day provider window.` },
  ];
  return { ok: checks.every((check) => check.ok), checks };
}
