import { invoke } from "./nativeRuntime";
import type { AIGenerationRequest, AIGenerationResult, SocialPlatform } from "./mvpContracts";
import { normalizeGeneratedVariant, validateGatewayResult, type AIGateway } from "./gateway";
import { buildGeminiWebPrompt } from "./geminiWebGateway";
import { getMediaAttachmentRequestId, matchProcessedMediaEvidence, validateMediaAttachments } from "./mediaAttachment";

type GeneratedPayload = { variants?: unknown[]; topic?: string; title?: string; body?: string; caption?: string; safetyNotes?: string[] };

type NativeInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function extractJsonObject(raw: string): unknown | null {
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== "{") continue;
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
      if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(raw.slice(start, index + 1)); } catch { break; }
        }
      }
    }
  }
  return null;
}

function parseGeneratedPayload(raw: string, depth = 0): GeneratedPayload | null {
  if (depth > 2) return null;
  let candidate = raw.trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    candidate = candidate.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "string") {
        candidate = parsed;
        continue;
      }
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        if (Array.isArray(record.variants) || ["topic", "title", "body", "caption"].some((key) => typeof record[key] === "string")) return record as GeneratedPayload;
        if (typeof record.text === "string") return parseGeneratedPayload(record.text, depth + 1);
      }
    } catch {
      const extracted = extractJsonObject(candidate);
      if (extracted && typeof extracted === "object") {
        const record = extracted as Record<string, unknown>;
        if (Array.isArray(record.variants) || ["topic", "title", "body", "caption"].some((key) => typeof record[key] === "string")) return record as GeneratedPayload;
        if (typeof record.text === "string") return parseGeneratedPayload(record.text, depth + 1);
      }
      const repaired = candidate.replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
      if (repaired !== candidate) {
        candidate = repaired;
        continue;
      }
    }
    break;
  }
  return null;
}

function parseChatGPTWebPayload(raw: string, fallbackPlatform: SocialPlatform = "facebook"): AIGenerationResult {
  const parsed = parseGeneratedPayload(raw);
  if (!parsed) throw new Error("ChatGPT SignalFlow Chrome session returned invalid JSON.");
  const variants = Array.isArray(parsed.variants) ? parsed.variants : parsed.title || parsed.topic || parsed.body || parsed.caption ? [parsed] : [];
  return {
    traceId: `chatgpt-web-${Date.now()}`,
    provider: "chatgpt_web",
    variants: variants.map((variant) => normalizeGeneratedVariant(variant, fallbackPlatform)),
    safetyNotes: Array.isArray(parsed.safetyNotes) ? parsed.safetyNotes : [],
  };
}

export class ChatGPTWebAIGateway implements AIGateway {
  private readonly invoke: NativeInvoke;
  private readonly model: string;

  constructor(config: { invoke?: NativeInvoke; model: string }) {
    this.invoke = config.invoke ?? invoke;
    this.model = config.model;
  }

  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    const requestedAttachments = request.mediaAttachments?.length ? request.mediaAttachments : (request.imageAttachment ? [{ ...request.imageAttachment, order: 0, role: "publish" as const }] : []);
    const attachmentValidation = requestedAttachments.length ? validateMediaAttachments(requestedAttachments, "chatgpt_web") : { ok: true as const, attachments: [] };
    if (!attachmentValidation.ok) throw new Error(attachmentValidation.code);
    const attachments = attachmentValidation.attachments;
    const requestId = attachments.length ? getMediaAttachmentRequestId(request.metadata?.requestId) : undefined;
    const attachmentManifest = attachments.map(({ assetId, sha256, mimeType, order, role }) => ({ assetId, sha256, mimeType, order, role }));
    try {
      await this.invoke("chatgpt_web_open", { workspaceId: request.workspaceId });
      const response = await this.invoke("chatgpt_web_complete", { workspaceId: request.workspaceId, prompt: buildGeminiWebPrompt({ ...request, mediaAttachments: attachments }), model: this.model, ...(attachments.length ? { requestId, attachmentPaths: attachments.map((attachment) => attachment.localAssetPath), attachmentHashes: attachments.map((attachment) => attachment.sha256), attachmentManifest } : {}) }) as { text?: string; requestId?: string; attachmentEvidence?: unknown; attachmentAccepted?: boolean; attachmentCount?: number; attachmentBoundary?: string };
      if (!response.text?.trim()) throw new Error("ChatGPT SignalFlow Chrome session returned no response.");
      const attachmentEvidence = attachments.length ? matchProcessedMediaEvidence(attachments, response.attachmentEvidence) : undefined;
      if (attachments.length && (response.requestId !== requestId || response.attachmentBoundary !== "chat_upload" || response.attachmentAccepted !== true || response.attachmentCount !== attachments.length || !attachmentEvidence)) throw new Error("IMAGE_ATTACHMENT_NOT_CONFIRMED");
      const parsed = parseChatGPTWebPayload(response.text, request.targetPlatforms[0] ?? "facebook");
      return validateGatewayResult(request, { ...parsed, variants: parsed.variants.map((variant) => ({ ...variant, metadata: { ...variant.metadata, attachmentAccepted: Boolean(attachmentEvidence), attachmentCount: attachmentEvidence?.length ?? 0, attachmentBoundary: attachmentEvidence ? response.attachmentBoundary : "none", mediaAssetIds: attachmentEvidence?.map((attachment) => attachment.assetId) ?? [], ...(attachmentEvidence ? { mediaEvidence: attachmentEvidence } : {}) } })), safetyNotes: [...parsed.safetyNotes, ...(attachmentEvidence ? [`${attachmentEvidence.length} attachment(s) processed in the managed chat composer.`] : [])] });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("ChatGPT SignalFlow Chrome session returned")) throw error;
      const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
      if (/^(?:STRATEGY_|IMAGE_METADATA_REQUIRED|VIDEO_METADATA_REQUIRED|TEXT_ASSET_METADATA_FORBIDDEN|IMAGE_VIDEO_METADATA_FORBIDDEN|VIDEO_IMAGE_METADATA_FORBIDDEN)/.test(message)) throw error;
      const providerCode = message.match(/\b(?:CHATGPT|ACCOUNT_WEBVIEW|CHROME_CDP|IMAGE_ATTACHMENT)_[A-Z0-9_]+\b/)?.[0];
      if (providerCode) throw new Error(providerCode);
      throw new Error("ChatGPT SignalFlow Chrome request failed. Open the managed Chrome window and verify the session.");
    }
  }
}
