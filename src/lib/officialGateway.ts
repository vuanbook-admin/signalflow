import type { AIGenerationRequest, AIGenerationResult, SocialPlatform } from "./mvpContracts";
import { assetPromptFormatForRequest, normalizeGeneratedVariant, structuredOutputInstruction, validateGatewayResult, type AIGateway } from "./gateway";

type Provider = "openai" | "gemini";
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OfficialProviderConfig {
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

type GeneratedPayload = { variants?: unknown[]; topic?: string; title?: string; body?: string; caption?: string; safetyNotes?: string[] };
const schemaInstruction = "Return only valid JSON with keys variants, platform, kind, title, body, hashtags, metadata, and safetyNotes. Create one adapted variant for each requested platform. Do not wrap the JSON in markdown.";

function parseGeneratedPayload(raw: string): GeneratedPayload {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as GeneratedPayload;
  return { ...parsed, variants: Array.isArray(parsed.variants) ? parsed.variants : [], safetyNotes: Array.isArray(parsed.safetyNotes) ? parsed.safetyNotes : [] };
}

function toResult(provider: AIGenerationResult["provider"], raw: string, fallbackPlatform: SocialPlatform): AIGenerationResult {
  const payload = parseGeneratedPayload(raw);
  const variants = Array.isArray(payload.variants) ? payload.variants : payload.title || payload.topic || payload.body || payload.caption ? [payload] : [];
  return { traceId: `${provider}-${Date.now()}`, provider, variants: variants.map((variant) => normalizeGeneratedVariant(variant, fallbackPlatform)), safetyNotes: payload.safetyNotes ?? [] };
}

function safeProviderError(provider: Provider, status?: number): Error {
  return new Error(`AI provider ${provider} request failed${status ? ` (${status})` : ""}. Check the configured API account or retry later.`);
}

async function requestWithTimeout(fetchImpl: FetchLike, provider: Provider, input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch {
    throw safeProviderError(provider);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson<T>(response: Response, provider: Provider): Promise<T> {
  try { return await response.json() as T; } catch { throw safeProviderError(provider, response.status); }
}

export class OfficialAIGateway implements AIGateway {
  constructor(private readonly config: OfficialProviderConfig) {}

  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    if (!this.config.apiKey.trim()) throw new Error(`Missing ${this.config.provider} API key.`);
    if (request.mediaAttachments?.length || request.imageAttachment) throw new Error("MEDIA_ATTACHMENT_PROVIDER_UNSUPPORTED");
    const prompt = [`Topic: ${request.prompt}`, `Target platforms: ${request.targetPlatforms.join(", ")}`, `Content kinds: ${request.contentKinds.join(", ")}`, `Brand voice: ${request.brandSystem.voice}`, `Audience: ${request.brandSystem.audience}`, `Prohibited claims: ${request.brandSystem.prohibitedClaims.join(", ") || "none"}`, request.metadata?.structuredOutput === true ? structuredOutputInstruction(assetPromptFormatForRequest(request), request) : schemaInstruction].join("\n");
    try {
      if (this.config.provider === "openai") return validateGatewayResult(request, await this.generateOpenAI(prompt, request.targetPlatforms[0] ?? "facebook"));
      return validateGatewayResult(request, await this.generateGemini(prompt, request.targetPlatforms[0] ?? "facebook"));
    } catch (error) {
      if (error instanceof Error && (error.message.startsWith("AI provider ") || /^(?:STRATEGY_|IMAGE_METADATA_REQUIRED|VIDEO_METADATA_REQUIRED|TEXT_ASSET_METADATA_FORBIDDEN|IMAGE_VIDEO_METADATA_FORBIDDEN|VIDEO_IMAGE_METADATA_FORBIDDEN)/.test(error.message))) throw error;
      throw safeProviderError(this.config.provider);
    }
  }

  private async generateOpenAI(prompt: string, fallbackPlatform: SocialPlatform): Promise<AIGenerationResult> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const response = await requestWithTimeout(fetchImpl, "openai", `${this.config.baseUrl ?? "https://api.openai.com/v1"}/responses`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` }, body: JSON.stringify({ model: this.config.model, instructions: "You are a careful social content strategist. Follow the requested JSON contract.", input: prompt }) }, this.config.timeoutMs ?? 30_000);
    if (!response.ok) throw safeProviderError("openai", response.status);
    const payload = await readJson<{ output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }>(response, "openai");
    const raw = (payload.output ?? []).flatMap((item) => item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("\n");
    return toResult("openai_api", raw, fallbackPlatform);
  }

  private async generateGemini(prompt: string, fallbackPlatform: SocialPlatform): Promise<AIGenerationResult> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const endpoint = `${this.config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"}/models/${encodeURIComponent(this.config.model)}:generateContent`;
    const response = await requestWithTimeout(fetchImpl, "gemini", endpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": this.config.apiKey }, body: JSON.stringify({ systemInstruction: { parts: [{ text: "You are a careful social content strategist. Follow the requested JSON contract." }] }, contents: [{ role: "user", parts: [{ text: prompt }] }] }) }, this.config.timeoutMs ?? 30_000);
    if (!response.ok) throw safeProviderError("gemini", response.status);
    const payload = await readJson<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>(response, "gemini");
    const raw = (payload.candidates ?? []).flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text ?? "").join("\n");
    return toResult("gemini_api", raw, fallbackPlatform);
  }
}
