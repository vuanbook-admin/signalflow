import { invoke } from "./nativeRuntime";
import type { AIGenerationRequest, ImageAttachment, MediaAttachment, SocialPlatform } from "./mvpContracts";
import { validateMediaAttachments } from "./mediaAttachment";

export type NativeProviderInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export type AssetGenerationRequest = {
  kind: "image" | "video";
  prompt: string;
  concept: string;
  slotId: string;
  strategyVersion: number;
  idempotencyKey: string;
  workspaceId?: string;
  deadlineAt?: number;
};

export type NativeAssetGenerationRequest = AssetGenerationRequest & { workspaceId: string };

export type AssetPromptDraft = {
  mediaKind?: "image" | "video";
  visualPrompt?: string;
  videoPrompt?: string;
};

export function assetPromptForDraft(draft: AssetPromptDraft, kind: "image" | "video"): { ok: true; prompt: string } | { ok: false; code: string; message: string } {
  if (draft.mediaKind && draft.mediaKind !== kind) return { ok: false, code: "ASSET_MEDIA_KIND_MISMATCH", message: `Requested ${kind} asset does not match the draft media kind ${draft.mediaKind}.` };
  const prompt = kind === "image" ? draft.visualPrompt?.trim() : draft.videoPrompt?.trim();
  if (!prompt) return { ok: false, code: `${kind.toUpperCase()}_PROMPT_REQUIRED`, message: `${kind === "image" ? "Image" : "Video"} generation requires its own prompt branch.` };
  return { ok: true, prompt };
}

type FlowNativeStatus = { connected?: boolean; composer?: boolean; profilePersistent?: boolean; windowOpen?: boolean; engine?: string; loginRequired?: boolean; throttled?: boolean };
type VertexNativeStatus = { configured?: boolean; officialApiVerified?: boolean; projectIdPresent?: boolean; credentialPresent?: boolean; location?: string; model?: string; reason?: string };
type NativeImageResult = { provider?: "google_flow" | "vertex_ai"; live?: boolean; localAssetPath?: string; mimeType?: string; generatedAt?: string; generatedSha256?: string; visualFingerprint?: string; error?: string };
type NativeVideoResult = { provider?: "google_flow"; live?: boolean; localAssetPath?: string; mimeType?: string; generatedAt?: string; generatedSha256?: string; visualFingerprint?: string; error?: string };

export type ImageGenerationResult = {
  provider: "google_flow" | "vertex_ai";
  live: true;
  localAssetPath: string;
  mimeType: string;
  generatedAt: string;
  generatedSha256?: string;
  visualFingerprint?: string;
};

export type VideoGenerationResult = {
  provider: "veo";
  live: true;
  localAssetPath: string;
  mimeType: string;
  generatedAt: string;
  generatedSha256?: string;
  visualFingerprint?: string;
};

export type FlowCapability = FlowNativeStatus & { provider: "google_flow"; managedBrowserSession: boolean; live: boolean; reason?: string };
export type VertexCapability = VertexNativeStatus & { provider: "vertex_ai"; live: boolean; reason?: string };
export type ManagedCopyProvider = "gemini" | "openai";
export type ManagedCopyCapability = { provider: ManagedCopyProvider; connected: boolean; composer: boolean; live: boolean; reason?: string };

function errorCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /^[A-Z][A-Z0-9_:-]+$/.test(message) ? message : fallback;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const VISUAL_FINGERPRINT = /^[a-f0-9]{16}$/i;

type ProviderGenerateInput = AssetGenerationRequest | { prompt: string };

function nativeAssetArgs(input: ProviderGenerateInput): Record<string, unknown> {
  const args: Record<string, unknown> = { prompt: input.prompt };
  if ("workspaceId" in input && input.workspaceId?.trim()) args.workspaceId = input.workspaceId.trim();
  if ("slotId" in input) args.slotId = input.slotId;
  if ("strategyVersion" in input) args.strategyVersion = input.strategyVersion;
  if ("idempotencyKey" in input) args.idempotencyKey = input.idempotencyKey;
  if ("deadlineAt" in input && input.deadlineAt !== undefined) args.deadlineAt = input.deadlineAt;
  return args;
}

function scalarImageResult(raw: unknown, provider: "google_flow" | "vertex_ai"): ImageGenerationResult {
  const result = (raw && typeof raw === "object" ? raw : {}) as NativeImageResult;
  if (result.provider !== provider || result.live !== true || typeof result.localAssetPath !== "string" || !result.localAssetPath.trim()) throw new Error(`${provider === "google_flow" ? "FLOW" : "VERTEX"}_IMAGE_RESULT_INVALID`);
  return { provider, live: true, localAssetPath: result.localAssetPath, mimeType: typeof result.mimeType === "string" && result.mimeType ? result.mimeType : "image/png", generatedAt: typeof result.generatedAt === "string" ? result.generatedAt : new Date().toISOString(), generatedSha256: typeof result.generatedSha256 === "string" && SHA256.test(result.generatedSha256) ? result.generatedSha256.toLowerCase() : undefined, visualFingerprint: typeof result.visualFingerprint === "string" && VISUAL_FINGERPRINT.test(result.visualFingerprint) ? result.visualFingerprint.toLowerCase() : undefined };
}

export class GoogleFlowImageProvider {
  private readonly invoke: NativeProviderInvoke;
  constructor(config: { invoke?: NativeProviderInvoke } = {}) { this.invoke = config.invoke ?? invoke; }

  async status(): Promise<FlowCapability> {
    try {
      const raw = await this.invoke("flow_web_status") as FlowNativeStatus;
      const managedBrowserSession = raw?.windowOpen === true && raw?.profilePersistent === true && raw?.engine === "chromium";
      const live = managedBrowserSession && raw?.connected === true && raw?.composer === true && raw?.loginRequired !== true && raw?.throttled !== true;
      return { provider: "google_flow", ...raw, managedBrowserSession, live, reason: live ? undefined : raw?.throttled ? "Google Flow has temporarily blocked this session for unusual activity; wait before retrying." : raw?.loginRequired ? "Google Flow sign-in is required in the SignalFlow-managed Chromium session." : "Google Flow managed session is not verified." };
    } catch (error) { return { provider: "google_flow", managedBrowserSession: false, live: false, reason: errorCode(error, "FLOW_STATUS_UNAVAILABLE") }; }
  }

  async generate(input: ProviderGenerateInput): Promise<ImageGenerationResult> {
    const capability = await this.status();
    if (!capability.live) throw new Error(capability.throttled ? "FLOW_THROTTLED_UNUSUAL_ACTIVITY" : "FLOW_SESSION_NOT_VERIFIED");
    return scalarImageResult(await this.invoke("flow_web_generate_image", nativeAssetArgs(input)), "google_flow");
  }
}

export class VertexAIImageProvider {
  private readonly invoke: NativeProviderInvoke;
  constructor(config: { invoke?: NativeProviderInvoke } = {}) { this.invoke = config.invoke ?? invoke; }

  async status(workspaceId?: string): Promise<VertexCapability> {
    try {
      const raw = await this.invoke("vertex_ai_status", workspaceId?.trim() ? { workspaceId: workspaceId.trim() } : undefined) as VertexNativeStatus;
      const live = raw?.configured === true && raw?.officialApiVerified === true && raw?.projectIdPresent === true;
      return { provider: "vertex_ai", ...raw, live, reason: live ? undefined : raw?.reason ?? "Vertex AI requires project/model configuration and a .env credential." };
    } catch (error) { return { provider: "vertex_ai", live: false, reason: errorCode(error, "VERTEX_STATUS_UNAVAILABLE") }; }
  }

  async generate(input: ProviderGenerateInput): Promise<ImageGenerationResult> {
    const capability = await this.status("workspaceId" in input ? input.workspaceId : undefined);
    if (!capability.live) throw new Error("VERTEX_API_NOT_VERIFIED");
    return scalarImageResult(await this.invoke("vertex_ai_generate_image", nativeAssetArgs(input)), "vertex_ai");
  }
}

export class GoogleFlowVideoProvider {
  private readonly invoke: NativeProviderInvoke;
  constructor(config: { invoke?: NativeProviderInvoke } = {}) { this.invoke = config.invoke ?? invoke; }

  async status(): Promise<FlowCapability> {
    try {
      const raw = await this.invoke("flow_web_status") as FlowNativeStatus;
      const managedBrowserSession = raw?.windowOpen === true && raw?.profilePersistent === true && raw?.engine === "chromium";
      const live = managedBrowserSession && raw?.connected === true && raw?.composer === true && raw?.loginRequired !== true && raw?.throttled !== true;
      return { provider: "google_flow", ...raw, managedBrowserSession, live, reason: live ? undefined : raw?.throttled ? "Google Flow has temporarily blocked this session for unusual activity; wait before retrying." : raw?.loginRequired ? "Google Flow sign-in is required in the SignalFlow-managed Chromium session." : "Google Flow managed session is not verified." };
    } catch (error) { return { provider: "google_flow", managedBrowserSession: false, live: false, reason: errorCode(error, "FLOW_STATUS_UNAVAILABLE") }; }
  }

  async generate(input: ProviderGenerateInput): Promise<VideoGenerationResult> {
    const capability = await this.status();
    if (!capability.live) throw new Error(capability.throttled ? "FLOW_THROTTLED_UNUSUAL_ACTIVITY" : "FLOW_SESSION_NOT_VERIFIED");
    const raw = await this.invoke("flow_web_generate_video", nativeAssetArgs(input)) as NativeVideoResult;
    if (raw?.provider !== "google_flow" || raw.live !== true || typeof raw.localAssetPath !== "string" || !raw.localAssetPath.trim()) throw new Error("FLOW_VIDEO_RESULT_INVALID");
    return { provider: "veo", live: true, localAssetPath: raw.localAssetPath, mimeType: typeof raw.mimeType === "string" && raw.mimeType ? raw.mimeType : "video/mp4", generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : new Date().toISOString(), generatedSha256: typeof raw.generatedSha256 === "string" && SHA256.test(raw.generatedSha256) ? raw.generatedSha256.toLowerCase() : undefined, visualFingerprint: typeof raw.visualFingerprint === "string" && VISUAL_FINGERPRINT.test(raw.visualFingerprint) ? raw.visualFingerprint.toLowerCase() : undefined };
  }
}

export async function getManagedCopyCapability(provider: ManagedCopyProvider, invokeImpl: NativeProviderInvoke = invoke, workspaceId?: string): Promise<ManagedCopyCapability> {
  const command = provider === "gemini" ? "gemini_web_status" : "chatgpt_web_status";
  try {
    const raw = await invokeImpl(command, workspaceId ? { workspaceId } : undefined) as { connected?: boolean; composer?: boolean; loginRequired?: boolean };
    const live = raw?.connected === true && raw?.composer === true && raw?.loginRequired !== true;
    return { provider, connected: raw?.connected === true, composer: raw?.composer === true, live, reason: live ? undefined : "The app-internal managed browser session is not verified." };
  } catch { return { provider, connected: false, composer: false, live: false, reason: "The app-internal managed browser session is unavailable." }; }
}

export function buildImageAwareCopyRequest(input: { workspaceId: string; prompt: string; imageAssetId: string; imageLocalAssetPath: string; imageMimeType: string; imageSha256?: string; targetPlatforms: SocialPlatform[]; brandVoice: string }): AIGenerationRequest {
  const imageAttachment: ImageAttachment = { assetId: input.imageAssetId, localAssetPath: input.imageLocalAssetPath, mimeType: input.imageMimeType, sha256: input.imageSha256 };
  return buildMediaAwareCopyRequest({ workspaceId: input.workspaceId, prompt: input.prompt, attachments: [{ ...imageAttachment, order: 0, role: "publish" }], targetPlatforms: input.targetPlatforms, brandVoice: input.brandVoice });
}

export function buildVideoAwareCopyRequest(input: { workspaceId: string; prompt: string; videoAssetId: string; videoLocalAssetPath: string; videoMimeType: string; videoSha256?: string; targetPlatforms: SocialPlatform[]; brandVoice: string; customerFacts?: string[] }): AIGenerationRequest {
  return {
    workspaceId: input.workspaceId,
    prompt: `${input.prompt}\nThe selected video remains attached to the publish boundary; caption generation must use only the supplied brief and strategy metadata.`,
    targetPlatforms: input.targetPlatforms,
    contentKinds: ["video"],
    brandSystem: { workspaceId: input.workspaceId, voice: input.brandVoice, audience: "Brand audience", prohibitedClaims: [], visualTokens: { primary: "#4f46e5", secondary: "#f6f7fb", typography: "Inter" } },
    customerFacts: input.customerFacts,
    metadata: { videoAware: true, videoMediaDeferred: true, mediaAssetIds: [input.videoAssetId], attachmentBoundary: "publish_media", mediaMimeType: input.videoMimeType, mediaSha256: input.videoSha256 },
  };
}

export function buildMediaAwareCopyRequest(input: { workspaceId: string; prompt: string; attachments: MediaAttachment[]; targetPlatforms: SocialPlatform[]; brandVoice: string; customerFacts?: string[] }): AIGenerationRequest {
  const mediaAttachments = input.attachments;
  const validation = validateMediaAttachments(mediaAttachments, "gemini_web");
  if (!validation.ok) throw new Error(validation.code);
  const first = validation.attachments[0];
  return {
    workspaceId: input.workspaceId,
    prompt: `${input.prompt}\n${validation.attachments.length} customer media attachment(s) are provided through the verified SignalFlow managed-chat upload path. Describe and reference only visible content in those attachments; do not infer from an asset ID.`,
    targetPlatforms: input.targetPlatforms,
    contentKinds: ["image"],
    brandSystem: { workspaceId: input.workspaceId, voice: input.brandVoice, audience: "Brand audience", prohibitedClaims: [], visualTokens: { primary: "#4f46e5", secondary: "#f6f7fb", typography: "Inter" } },
    ...(validation.attachments.length === 1 && first ? { imageAttachment: { assetId: first.assetId, localAssetPath: first.localAssetPath, mimeType: first.mimeType, sha256: first.sha256 } } : {}),
    mediaAttachments: validation.attachments,
    customerFacts: input.customerFacts,
    metadata: { imageAware: true, mediaAware: true, mediaAssetIds: validation.attachments.map((attachment) => attachment.assetId), attachmentBoundary: "chat_upload", attachmentState: "pending" },
  };
}
