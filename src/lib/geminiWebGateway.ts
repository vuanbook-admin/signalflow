import { invoke } from "./nativeRuntime";
import type { AIGenerationRequest, AIGenerationResult, SocialPlatform } from "./mvpContracts";
import { assetPromptFormatForRequest, normalizeGeneratedVariant, structuredOutputInstruction, validateGatewayResult, type AIGateway } from "./gateway";
import { getMediaAttachmentRequestId, matchProcessedMediaEvidence, validateMediaAttachments } from "./mediaAttachment";

type GeneratedPayload = {
  variants?: unknown[];
  topic?: string;
  title?: string;
  body?: string;
  caption?: string;
  safetyNotes?: string[];
};

type NativeInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const schemaInstruction = "Return only valid JSON with keys variants, platform, kind, title, body, hashtags, metadata, and safetyNotes. Create one adapted variant for each requested platform. Do not wrap the JSON in markdown.";

export function buildGeminiWebPrompt(request: AIGenerationRequest): string {
  const selectedAttachments = request.mediaAttachments?.length
    ? request.mediaAttachments
    : request.imageAttachment ? [{ ...request.imageAttachment, order: 0, role: "publish" as const }] : [];
  const attachments = [...selectedAttachments].sort((left, right) => left.order - right.order);
  const customerFacts = (request.customerFacts ?? []).map((fact) => fact.trim()).filter(Boolean);
  return [
    `Topic: ${request.prompt}`,
    `Target platforms: ${request.targetPlatforms.join(", ")}`,
    `Content kinds: ${request.contentKinds.join(", ")}`,
    `Brand voice: ${request.brandSystem.voice}`,
    `Audience: ${request.brandSystem.audience}`,
    `Prohibited claims: ${request.brandSystem.prohibitedClaims.join(", ") || "none"}`,
    attachments.length ? `Media role map in upload order:\n${attachments.map((attachment, index) => `${index + 1}. ${attachment.role} (${attachment.mimeType})`).join("\n")}\nUse the publish item as the post image; reference items provide context only and must not replace it.` : "No media is attached; do not invent visual details.",
    `Customer-supplied facts: ${customerFacts.length ? customerFacts.join("; ") : "none provided"}. Use only these facts and the brief; do not invent product details or claims.`,
    request.metadata?.structuredOutput === true ? structuredOutputInstruction(assetPromptFormatForRequest(request), request) : schemaInstruction,
  ].join("\n");
}

function cleanPayload(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
}

function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return raw.slice(start, index + 1);
  }
  return null;
}

function parsePayload(raw: string): GeneratedPayload | null {
  let candidate = cleanPayload(raw);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "string") { candidate = parsed; continue; }
      return parsed && typeof parsed === "object" ? parsed as GeneratedPayload : null;
    } catch {
      const extracted = extractJsonObject(candidate);
      if (!extracted || extracted === candidate) return null;
      candidate = extracted;
    }
  }
  return null;
}

export function parseGeminiWebPayload(raw: string, fallbackPlatform: SocialPlatform = "instagram"): AIGenerationResult {
  const parsed = parsePayload(raw);
  if (!parsed) throw new Error("Gemini SignalFlow Chrome session returned invalid JSON.");
  const variants = Array.isArray(parsed.variants)
    ? parsed.variants
    : parsed.title || parsed.topic || parsed.body || parsed.caption
      ? [parsed]
      : [];
  return {
    traceId: `gemini-web-${Date.now()}`,
    provider: "gemini_web",
    variants: variants.map((variant) => normalizeGeneratedVariant(variant, fallbackPlatform)),
    safetyNotes: Array.isArray(parsed.safetyNotes) ? parsed.safetyNotes : [],
  };
}

export class GeminiWebAIGateway implements AIGateway {
  private readonly invoke: NativeInvoke;
  private readonly model: string;

  constructor(config: { invoke?: NativeInvoke; model: string }) {
    this.invoke = config.invoke ?? invoke;
    this.model = config.model;
  }

  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    // Revo-style subscription path: the native command owns the app-managed Chrome session;
    // this renderer adapter receives only the validated response text.
    const requestedAttachments = request.mediaAttachments?.length ? request.mediaAttachments : (request.imageAttachment ? [{ ...request.imageAttachment, order: 0, role: "publish" as const }] : []);
    const attachmentValidation = requestedAttachments.length ? validateMediaAttachments(requestedAttachments, "gemini_web") : { ok: true as const, attachments: [] };
    if (!attachmentValidation.ok) throw new Error(attachmentValidation.code);
    const attachments = attachmentValidation.attachments;
    let response: { text?: string; requestId?: string; attachmentEvidence?: unknown; attachmentAccepted?: boolean; attachmentCount?: number; attachmentBoundary?: string };
    const requestId = attachments.length ? getMediaAttachmentRequestId(request.metadata?.requestId) : undefined;
    const attachmentManifest = attachments.map(({ assetId, sha256, mimeType, order, role }) => ({ assetId, sha256, mimeType, order, role }));
    try {
      response = await this.invoke("gemini_web_complete", { workspaceId: request.workspaceId, prompt: buildGeminiWebPrompt({ ...request, mediaAttachments: attachments }), model: this.model, ...(attachments.length ? { requestId, attachmentPaths: attachments.map((attachment) => attachment.localAssetPath), attachmentHashes: attachments.map((attachment) => attachment.sha256), attachmentManifest } : {}) }) as typeof response;
    } catch (error) {
      const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
      if (/^(?:STRATEGY_|IMAGE_METADATA_REQUIRED|VIDEO_METADATA_REQUIRED|TEXT_ASSET_METADATA_FORBIDDEN|IMAGE_VIDEO_METADATA_FORBIDDEN|VIDEO_IMAGE_METADATA_FORBIDDEN)/.test(message)) throw error;
      const nativeCode = message.match(/GEMINI_[A-Z0-9_]+/);
      if (nativeCode) throw new Error(nativeCode[0]);
      throw new Error("Gemini SignalFlow Chrome request failed. Open the managed Chrome window and verify the session.");
    }
    if (!response.text?.trim()) throw new Error("Gemini SignalFlow Chrome session returned no response.");
    const attachmentEvidence = attachments.length ? matchProcessedMediaEvidence(attachments, response.attachmentEvidence) : undefined;
    if (attachments.length && (response.requestId !== requestId || response.attachmentBoundary !== "chat_upload" || response.attachmentAccepted !== true || response.attachmentCount !== attachments.length || !attachmentEvidence)) throw new Error("IMAGE_ATTACHMENT_NOT_CONFIRMED");
    const parsed = parseGeminiWebPayload(response.text, request.targetPlatforms[0] ?? "instagram");
    return validateGatewayResult(request, { ...parsed, variants: parsed.variants.map((variant) => ({ ...variant, metadata: { ...variant.metadata, attachmentAccepted: Boolean(attachmentEvidence), attachmentCount: attachmentEvidence?.length ?? 0, attachmentBoundary: attachmentEvidence ? response.attachmentBoundary : "none", mediaAssetIds: attachmentEvidence?.map((attachment) => attachment.assetId) ?? [], ...(attachmentEvidence ? { mediaEvidence: attachmentEvidence } : {}) } })), safetyNotes: [...parsed.safetyNotes, ...(attachmentEvidence ? [`${attachmentEvidence.length} attachment(s) processed in the managed chat composer.`] : [])] });
  }
}
