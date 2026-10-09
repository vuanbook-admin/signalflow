import {
  AIGenerationRequest,
  AIGenerationResult,
  ContentVariant,
  PublishJob,
  SocialConnection,
  SocialPlatform,
  preflightPublish,
} from "./mvpContracts";
import { strategyIdentityInstruction, structuredAssetInstruction, validateGeneratedStrategyOutput, validateResolvedStrategyIdentity, type AssetPromptFormat } from "./contentStrategyPrompt";
import type { StrategySnapshot } from "./contentStrategy";
import type { ResolvedStrategy } from "./contentStrategyResolver";

export interface AIGateway {
  generate(request: AIGenerationRequest): Promise<AIGenerationResult>;
}

export type GeneratedContentFields = {
  topic?: string;
  contentPillar?: string;
  contentAngle?: string;
  channel?: SocialPlatform;
  format?: AssetPromptFormat;
  objective?: string;
  strategyVersion?: number;
  strategySnapshot?: StrategySnapshot;
  catalogFingerprint?: string;
  caption?: string;
  body?: string;
  cta?: string;
  hashtags?: string[];
  seoKeywords?: string[];
  scheduledAt?: string;
  sources?: string[];
  notes?: string;
  imageConcept?: string;
  imagePrompt?: string;
  videoConcept?: string;
  videoPrompt?: string;
  strategyRationale?: string;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord => value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
const firstText = (...values: unknown[]): string | undefined => values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
const firstNumber = (...values: unknown[]): number | undefined => values.find((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1);
const stringList = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
  return undefined;
};
const hashtagList = (value: unknown): string[] | undefined => stringList(value)?.map((tag) => tag.startsWith("#") ? tag : `#${tag.replace(/^#+/, "")}`);

function normalizeStrategySnapshot(value: unknown): StrategySnapshot | undefined {
  const record = asRecord(value);
  const objectiveKey = firstText(record.objectiveKey, record.objective_key);
  const objectiveLabel = firstText(record.objectiveLabel, record.objective_label);
  const pillarId = firstText(record.pillarId, record.pillar_id);
  const pillarLabel = firstText(record.pillarLabel, record.pillar_label);
  const angleId = firstText(record.angleId, record.angle_id);
  const angleLabel = firstText(record.angleLabel, record.angle_label);
  const angleGuidance = firstText(record.angleGuidance, record.angle_guidance);
  const channel = firstText(record.channel);
  const format = firstText(record.format);
  const strategyVersion = firstNumber(record.strategyVersion, record.strategy_version);
  const catalogFingerprint = firstText(record.catalogFingerprint, record.catalog_fingerprint);
  if (!objectiveKey || !objectiveLabel || !pillarId || !pillarLabel || !angleId || !angleLabel || !channel || strategyVersion === undefined || !catalogFingerprint) return undefined;
  const angleIdByChannelValue = record.angleIdByChannel ?? record.angle_id_by_channel;
  const angleIdByChannel = angleIdByChannelValue && typeof angleIdByChannelValue === "object" && !Array.isArray(angleIdByChannelValue) ? angleIdByChannelValue as Record<string, string> : undefined;
  const recipeId = firstText(record.recipeId, record.recipe_id);
  const recipeGuidance = firstText(record.recipeGuidance, record.recipe_guidance);
  return { objectiveKey: objectiveKey as StrategySnapshot["objectiveKey"], objectiveLabel, pillarId, pillarLabel, angleId, angleLabel, angleGuidance: angleGuidance ?? "", ...(angleIdByChannel ? { angleIdByChannel } : {}), channel: channel as SocialPlatform, ...(format && ["text", "image", "video"].includes(format) ? { format: format as StrategySnapshot["format"] } : {}), strategyVersion, catalogFingerprint, ...(recipeId ? { recipeId } : {}), ...(recipeGuidance ? { recipeGuidance } : {}) } as unknown as StrategySnapshot;
}

/** Normalize Revo-style snake_case or SignalFlow camelCase fields without trusting provider extras. */
export function extractGeneratedContentFields(value: unknown): GeneratedContentFields {
  const record = asRecord(value);
  const metadata = asRecord(record.metadata);
  const snapshot = normalizeStrategySnapshot(record.strategySnapshot ?? record.strategy_snapshot ?? metadata.strategySnapshot ?? metadata.strategy_snapshot);
  return {
    topic: firstText(record.topic, record.title, metadata.topic),
    contentPillar: firstText(record.contentPillar, record.content_pillar, metadata.contentPillar, metadata.content_pillar, snapshot?.pillarLabel, snapshot?.pillarId),
    contentAngle: firstText(record.contentAngle, record.content_angle, metadata.contentAngle, metadata.content_angle, snapshot?.angleLabel, snapshot?.angleId),
    channel: firstText(record.channel, record.channel_name, metadata.channel, metadata.channel_name) as SocialPlatform | undefined,
    format: firstText(record.format, metadata.format) as AssetPromptFormat | undefined,
    objective: firstText(record.objective, metadata.objective, snapshot?.objectiveLabel, snapshot?.objectiveKey),
    strategyVersion: firstNumber(record.strategyVersion, record.strategy_version, metadata.strategyVersion, metadata.strategy_version, snapshot?.strategyVersion),
    strategySnapshot: snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : undefined,
    catalogFingerprint: firstText(record.catalogFingerprint, record.catalog_fingerprint, metadata.catalogFingerprint, metadata.catalog_fingerprint, snapshot?.catalogFingerprint),
    caption: firstText(record.caption, record.body, metadata.caption, metadata.body),
    body: firstText(record.body, record.caption, metadata.body, metadata.caption),
    cta: firstText(record.cta, metadata.cta),
    hashtags: hashtagList(record.hashtags ?? metadata.hashtags),
    seoKeywords: stringList(record.seoKeywords ?? record.seo_keywords ?? metadata.seoKeywords ?? metadata.seo_keywords),
    scheduledAt: firstText(record.scheduledAt, record.scheduled_at, metadata.scheduledAt, metadata.scheduled_at),
    sources: stringList(record.sources ?? metadata.sources),
    notes: firstText(record.notes, metadata.notes),
    imageConcept: firstText(record.imageConcept, record.image_concept, metadata.imageConcept, metadata.image_concept),
    imagePrompt: firstText(record.imagePrompt, record.image_prompt, metadata.imagePrompt, metadata.image_prompt),
    videoConcept: firstText(record.videoConcept, record.video_concept, metadata.videoConcept, metadata.video_concept),
    videoPrompt: firstText(record.videoPrompt, record.video_prompt, metadata.videoPrompt, metadata.video_prompt),
    strategyRationale: firstText(record.strategyRationale, record.strategy_rationale, record.rationale, metadata.strategyRationale, metadata.strategy_rationale, metadata.rationale),
  };
}

export function normalizeGeneratedVariant(value: unknown, fallbackPlatform: SocialPlatform = "facebook"): AIGenerationResult["variants"][number] {
  const record = asRecord(value);
  const fields = extractGeneratedContentFields(record);
  const metadata = asRecord(record.metadata);
  const structuredMetadata: UnknownRecord = {
    ...metadata,
    ...(fields.topic ? { topic: fields.topic } : {}),
    ...(fields.contentPillar ? { contentPillar: fields.contentPillar, content_pillar: fields.contentPillar } : {}),
    ...(fields.contentAngle ? { contentAngle: fields.contentAngle, content_angle: fields.contentAngle } : {}),
    ...(fields.channel ? { channel: fields.channel, channel_name: fields.channel } : {}),
    ...(fields.format ? { format: fields.format } : {}),
    ...(fields.objective ? { objective: fields.objective } : {}),
    ...(fields.strategyVersion !== undefined ? { strategyVersion: fields.strategyVersion, strategy_version: fields.strategyVersion } : {}),
    ...(fields.strategySnapshot ? { strategySnapshot: fields.strategySnapshot, strategy_snapshot: fields.strategySnapshot } : {}),
    ...(fields.catalogFingerprint ? { catalogFingerprint: fields.catalogFingerprint, catalog_fingerprint: fields.catalogFingerprint } : {}),
    ...(fields.cta ? { cta: fields.cta } : {}),
    ...(fields.seoKeywords ? { seoKeywords: fields.seoKeywords, seo_keywords: fields.seoKeywords } : {}),
    ...(fields.scheduledAt ? { scheduledAt: fields.scheduledAt, scheduled_at: fields.scheduledAt } : {}),
    ...(fields.sources ? { sources: fields.sources } : {}),
    ...(fields.notes ? { notes: fields.notes } : {}),
    ...(fields.imageConcept ? { imageConcept: fields.imageConcept, image_concept: fields.imageConcept } : {}),
    ...(fields.imagePrompt ? { imagePrompt: fields.imagePrompt, image_prompt: fields.imagePrompt } : {}),
    ...(fields.videoConcept ? { videoConcept: fields.videoConcept, video_concept: fields.videoConcept } : {}),
    ...(fields.videoPrompt ? { videoPrompt: fields.videoPrompt, video_prompt: fields.videoPrompt } : {}),
    ...(fields.strategyRationale ? { strategyRationale: fields.strategyRationale, rationale: fields.strategyRationale } : {}),
  };
  const platforms: SocialPlatform[] = ["facebook", "instagram", "tiktok", "youtube"];
  const kinds = ["text", "image", "carousel", "video", "short_video", "long_video"] as const;
  const platform = platforms.includes(record.platform as SocialPlatform) ? record.platform as SocialPlatform : fallbackPlatform;
  const kind = kinds.includes(record.kind as typeof kinds[number]) ? record.kind as typeof kinds[number] : "text";
  return {
    platform,
    kind,
    title: firstText(record.title, fields.topic) ?? "Untitled draft",
    body: fields.body ?? "",
    caption: fields.caption,
    contentPillar: fields.contentPillar,
    contentAngle: fields.contentAngle,
    objective: fields.objective,
    strategyVersion: fields.strategyVersion,
    catalogFingerprint: fields.catalogFingerprint,
    strategySnapshot: fields.strategySnapshot,
    cta: fields.cta,
    hashtags: fields.hashtags ?? [],
    seoKeywords: fields.seoKeywords,
    scheduledAt: fields.scheduledAt,
    sources: fields.sources,
    notes: fields.notes,
    metadata: structuredMetadata,
  };
}

export function structuredOutputInstruction(format: AssetPromptFormat = "text", request?: AIGenerationRequest): string {
  const identities = request ? [...new Set(request.targetPlatforms)].map((channel) => {
    const strategy = resolvedStrategyFor(request, format, channel) as ResolvedStrategy;
    if (strategy.channel !== channel) throw new Error("STRATEGY_CHANNEL_MISMATCH: each requested channel needs its own resolved strategy.");
    return strategyIdentityInstruction(strategy, format);
  }) : [];
  return [`For a structured Content OS run, return one JSON object with a variants array and safetyNotes array. Create exactly one variant for each requested platform. Each variant must include platform, kind, title (topic), body/caption, contentPillar, contentAngle, objective, channel, format, strategyVersion, catalogFingerprint, strategySnapshot, cta, hashtags, seoKeywords, scheduledAt, sources, notes, and metadata.strategyRationale. Copy the immutable strategy identity fields exactly. Generate the creative fields from the brand context and brief. Leave scheduledAt and sources empty only when no truthful value is available. ${structuredAssetInstruction(format)}`, ...identities].join("\n\n");
}

export type RewritePromptInput = { brandName: string; brandFacts?: readonly string[]; contentContext?: string; visualPrompt?: string; platform: SocialPlatform | string; title: string; body: string };

export function buildRewritePrompt(input: RewritePromptInput): string {
  return [
    "Rewrite the copy for the existing Content Run as a new review-required revision.",
    `Brand: ${input.brandName}`,
    input.brandFacts?.filter(Boolean).length ? `Selected brand facts:\n${input.brandFacts.filter(Boolean).join("\n")}` : "",
    input.contentContext?.trim() ? `Approved content context:\n${input.contentContext.trim()}` : "",
    `Target platform: ${input.platform}`,
    `Current title: ${input.title}`,
    `Current copy: ${input.body}`,
    input.visualPrompt?.trim() ? `Keep the visual direction consistent with this draft prompt: ${input.visualPrompt.trim()}` : "",
    "Preserve only supplied facts. Do not invent price, material, product, medical or performance claims. Return one structured variant with a new title and body.",
  ].filter(Boolean).join("\n");
}

export function buildMediaRegenerationPrompt(input: { kind: "image" | "video"; brandName: string; brandFacts?: readonly string[]; contentContext?: string; visualPrompt?: string }): string {
  const format = input.kind === "video" ? "9:16 product video" : "square product image";
  return [
    `Create a new original ${format} for the selected brand.`,
    `Brand: ${input.brandName}`,
    input.brandFacts?.filter(Boolean).length ? `Selected brand facts:\n${input.brandFacts.filter(Boolean).join("\n")}` : "",
    input.contentContext?.trim() ? `Content context:\n${input.contentContext.trim()}` : "",
    input.visualPrompt?.trim() ? `Draft visual direction:\n${input.visualPrompt.trim()}` : "",
    "Use only the supplied brand and content context. No invented product facts, price, logo, text, watermark, medical or performance claim.",
  ].filter(Boolean).join("\n");
}

function promptField(prompt: string, label: string): string | undefined {
  const match = prompt.match(new RegExp(`(?:^|\\n)${label}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || undefined;
}

function structuredBrief(request: AIGenerationRequest): { title: string; caption?: string } {
  const topic = promptField(request.prompt, "Topic") ?? promptField(request.prompt, "Brief") ?? request.prompt.trim().split(/\s+/).slice(0, 12).join(" ");
  const caption = promptField(request.prompt, "Draft caption to improve");
  return { title: topic.slice(0, 180), caption };
}

export function assetPromptFormatForRequest(request: AIGenerationRequest): AssetPromptFormat {
  const value = request.metadata?.assetFormat;
  if (value === "image" || value === "video" || value === "text") return value;
  const kind = request.contentKinds[0];
  return kind === "image" || kind === "carousel" ? "image" : kind === "video" || kind === "short_video" || kind === "long_video" ? "video" : "text";
}

function resolvedStrategyFor(request: AIGenerationRequest, format: AssetPromptFormat, channel?: SocialPlatform): Record<string, unknown> {
  const byChannel = asRecord(request.metadata?.resolvedStrategiesByChannel);
  const value = asRecord(channel ? byChannel[channel] ?? request.metadata?.resolvedStrategy : request.metadata?.resolvedStrategy);
  const identity = validateResolvedStrategyIdentity(value, format);
  if (!identity.ok) throw new Error(`STRATEGY_REQUIRED: ${identity.message}`);
  return value;
}

function strategySnapshotFor(request: AIGenerationRequest, strategy: Record<string, unknown>, format: AssetPromptFormat, channel?: SocialPlatform): StrategySnapshot {
  const byChannel = asRecord(request.metadata?.strategySnapshotsByChannel);
  const supplied = normalizeStrategySnapshot(channel ? byChannel[channel] ?? request.metadata?.strategySnapshot ?? request.metadata?.strategy_snapshot : request.metadata?.strategySnapshot ?? request.metadata?.strategy_snapshot);
  const snapshot = supplied ? { ...supplied, format: supplied.format ?? format } : {
    objectiveKey: firstText(strategy.objectiveKey, strategy.objective)!,
    objectiveLabel: firstText(strategy.objectiveLabel, strategy.objectiveKey, strategy.objective)!,
    pillarId: firstText(strategy.pillarId)!,
    pillarLabel: firstText(strategy.pillarLabel, strategy.pillarId)!,
    angleId: firstText(strategy.angleId)!,
    angleLabel: firstText(strategy.angleLabel, strategy.angleId)!,
    angleGuidance: firstText(strategy.angleGuidance) ?? "",
    channel: firstText(strategy.channel) as SocialPlatform,
    format,
    strategyVersion: firstNumber(strategy.strategyVersion)!,
    catalogFingerprint: firstText(strategy.catalogFingerprint) ?? "",
    ...(strategy.angleIdByChannel && typeof strategy.angleIdByChannel === "object" && !Array.isArray(strategy.angleIdByChannel) ? { angleIdByChannel: { ...(strategy.angleIdByChannel as Record<string, string>) } } : {}),
  };
  return snapshot as unknown as StrategySnapshot;
}

export function validateGatewayResult(request: AIGenerationRequest, result: AIGenerationResult): AIGenerationResult {
  const rawStrategy = request.metadata?.resolvedStrategy;
  const byChannel = asRecord(request.metadata?.resolvedStrategiesByChannel);
  if (request.metadata?.structuredOutput === true && (!rawStrategy || typeof rawStrategy !== "object" || Array.isArray(rawStrategy)) && Object.keys(byChannel).length === 0) throw new Error("STRATEGY_REQUIRED");
  if ((!rawStrategy || typeof rawStrategy !== "object" || Array.isArray(rawStrategy)) && Object.keys(byChannel).length === 0) return result;
  const format = assetPromptFormatForRequest(request);
  const targetPlatforms = request.targetPlatforms;
  if (targetPlatforms.length === 0) throw new Error("STRATEGY_VARIANTS_REQUIRED: at least one target platform is required for structured output.");
  const mapKeys = Object.keys(byChannel);
  if (mapKeys.length > 0 && (mapKeys.length !== new Set(targetPlatforms).size || mapKeys.some((channel) => !targetPlatforms.includes(channel as SocialPlatform)) || targetPlatforms.some((channel) => !Object.prototype.hasOwnProperty.call(byChannel, channel)))) throw new Error("STRATEGY_CHANNEL_MAP_INCOMPLETE: every target channel must have one complete resolved strategy.");
  const strategies = mapKeys.length > 0 ? targetPlatforms.map((channel) => ({ channel, value: byChannel[channel] })) : [{ channel: targetPlatforms[0]!, value: rawStrategy }];
  for (const item of strategies) {
    const identity = validateResolvedStrategyIdentity(item.value, format);
    if (!identity.ok) throw new Error(`STRATEGY_REQUIRED: ${identity.message}`);
  }
  if (!Array.isArray(result.variants) || result.variants.length === 0) throw new Error("STRATEGY_VARIANTS_REQUIRED: structured output must include one variant per target channel.");
  const resultPlatforms = result.variants.map((variant) => variant.platform);
  if (new Set(resultPlatforms).size !== resultPlatforms.length || resultPlatforms.length !== new Set(targetPlatforms).size || resultPlatforms.some((platform) => !targetPlatforms.includes(platform))) throw new Error("STRATEGY_VARIANTS_REQUIRED: structured output must include exactly one variant per target channel.");
  for (const variant of result.variants) {
    const strategy = (byChannel[variant.platform] ?? rawStrategy) as ResolvedStrategy;
    const identity = validateResolvedStrategyIdentity(strategy, format);
    if (!identity.ok) throw new Error(`STRATEGY_REQUIRED: ${identity.message}`);
    if (identity.strategy.channel !== variant.platform) throw new Error("STRATEGY_CHANNEL_MISMATCH: resolved strategy channel does not match the returned variant platform.");
    const check = validateGeneratedStrategyOutput({ format, expected: strategy, output: extractGeneratedContentFields(variant) });
    if (!check.ok) throw new Error(`${check.code}: ${check.message}`);
  }
  return result;
}

/**
 * Local vertical-slice provider. Official API and Gemini web-subscription
 * adapters remain separate implementations behind the same interface.
 */
export class MockAIGateway implements AIGateway {
  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    if (request.mediaAttachments?.length || request.imageAttachment) throw new Error("MEDIA_ATTACHMENT_PROVIDER_UNSUPPORTED");
    const brief = structuredBrief(request);
    if (request.metadata?.structuredOutput === true) {
      const assetFormat = assetPromptFormatForRequest(request);
      const baseStrategy = resolvedStrategyFor(request, assetFormat);
      const brandName = String(request.metadata.brandName ?? "the active brand");
      const existingTopics = Array.isArray(request.metadata.existingTopics) ? request.metadata.existingTopics.map(String) : [];
      const candidates = [
        `${brandName}: cách chọn một sản phẩm phù hợp cho nhu cầu hằng ngày`,
        `${brandName}: ba dấu hiệu cho thấy bạn đang chọn sai chất liệu`,
        `${brandName}: một thói quen nhỏ giúp sản phẩm bền đẹp hơn`,
      ];
      const title = candidates.find((candidate) => !existingTopics.some((topic) => topic.toLowerCase() === candidate.toLowerCase())) ?? `${brandName}: gợi ý mới từ AI`;
      const hashtags = [`#${brandName.replace(/[^A-Za-z0-9]+/g, "") || "brand"}`, "#practicaltips"];
      const strategyMap = asRecord(request.metadata?.resolvedStrategiesByChannel);
      const structuredResult: AIGenerationResult = {
        traceId: `mock-structured-${Date.now()}`,
        provider: "mock",
        variants: request.targetPlatforms.map((platform) => {
          const strategy = Object.keys(strategyMap).length ? resolvedStrategyFor(request, assetFormat, platform) : baseStrategy;
          const strategySnapshot = strategySnapshotFor(request, strategy, assetFormat, platform);
          const contentPillar = firstText(strategy.pillarLabel, strategy.pillarId)!;
          const contentAngle = firstText(strategy.angleLabel, strategy.angleId)!;
          const objective = firstText(strategy.objectiveLabel, strategy.objectiveKey, strategy.objective)!;
          const body = `Một gợi ý thực tế cho chủ đề “${title}”, triển khai theo góc “${contentAngle}” và brand voice: ${request.brandSystem.voice}. Hãy đối chiếu thông tin với nhu cầu thật trước khi quyết định.`;
          const seoKeywords = [title, "gợi ý thực tế", String(strategy.angleId)];
          const assetMetadata = assetFormat === "image"
            ? { imageConcept: `Editorial visual concept for ${title}.`, imagePrompt: `Clean brand-safe editorial image for ${title}, natural light, no text, no watermark.` }
            : assetFormat === "video"
              ? { videoConcept: `Short process scene for ${title}.`, videoPrompt: `Create a brand-safe 9:16 video for ${title}, clear pacing, no text, no watermark.` }
              : {};
          return {
            platform,
            kind: request.contentKinds[0] ?? "text",
            title,
            body,
            caption: body,
            contentPillar,
            contentAngle,
            objective,
            cta: "Lưu lại để xem sau",
            hashtags,
            seoKeywords,
            scheduledAt: "",
            sources: [],
            notes: "Generated by an injected local fixture; replace with a verified AI route before production use.",
            strategyVersion: firstNumber(strategy.strategyVersion),
            catalogFingerprint: strategySnapshot.catalogFingerprint,
            strategySnapshot,
            metadata: { generatedFor: platform, mode: "mock", structuredOutput: true, brandName, ...assetMetadata, strategyRationale: `The selected ${contentAngle} angle supports the ${objective} objective for ${brandName}.`, workspaceId: request.workspaceId, brandVoice: request.brandSystem.voice, contentAngle, content_angle: contentAngle, channel: strategy.channel, format: assetFormat, strategyVersion: firstNumber(strategy.strategyVersion), strategy_version: firstNumber(strategy.strategyVersion), strategySnapshot, strategy_snapshot: strategySnapshot, catalogFingerprint: strategySnapshot.catalogFingerprint },
          };
        }),
        safetyNotes: ["Structured fields were generated locally for review; human review required before publishing.", "No consumer subscription session was accessed."],
      };
      return validateGatewayResult(request, structuredResult);
    }
    const variants = request.targetPlatforms.map((platform) => ({
      platform,
      kind: request.contentKinds[0] ?? "text",
      title: brief.title,
      body: `${brief.caption ?? `Gợi ý triển khai: ${brief.title}.`}\n\nGóc triển khai theo brand voice: ${request.brandSystem.voice}.`,
      hashtags: [],
      metadata: { generatedFor: platform, mode: "mock", workspaceId: request.workspaceId, brandVoice: request.brandSystem.voice },
    }));

    return {
      traceId: `mock-${Date.now()}`,
      provider: "mock",
      variants,
      safetyNotes: ["Draft only: human review required before publishing.", "No consumer subscription session was accessed."],
    };
  }
}

export class ManualAssistAIGateway implements AIGateway {
  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    if (request.mediaAttachments?.length || request.imageAttachment) throw new Error("MEDIA_ATTACHMENT_PROVIDER_UNSUPPORTED");
    if (request.metadata?.structuredOutput === true) {
      const structured = await new MockAIGateway().generate(request);
      return { ...structured, traceId: `manual-structured-${Date.now()}`, provider: "manual_assisted", safetyNotes: ["Manual-assist only: SignalFlow did not read browser sessions or a provider.", "Structured fields were prepared locally; human review remains required."] };
    }
    const brief = structuredBrief(request);
    const variants = request.targetPlatforms.map((platform) => ({
      platform,
      kind: request.contentKinds[0] ?? "text",
      title: brief.title,
      body: `${brief.caption ?? `Gợi ý triển khai: ${brief.title}.`}\n\nManual-assist draft for ${request.brandSystem.voice}. Export or paste into the official provider manually.`,
      hashtags: [],
      metadata: { generatedFor: platform, mode: "manual_assisted", workspaceId: request.workspaceId, brandVoice: request.brandSystem.voice },
    }));
    return {
      traceId: `manual-${Date.now()}`,
      provider: "manual_assisted",
      variants,
      safetyNotes: ["Manual-assist only: SignalFlow did not read browser sessions or call a provider.", "Use manual export when no official API key is configured."],
    };
  }
}

export interface PublisherAdapter {
  platform: SocialConnection["platform"];
  preflight(variant: ContentVariant, connection: SocialConnection, scheduledAt: Date): ReturnType<typeof preflightPublish>;
  enqueue(variant: ContentVariant, connection: SocialConnection, scheduledAt: Date, idempotencyKey: string): Promise<PublishJob>;
}

export class MockPublisherRegistry {
  constructor(private readonly adapters: PublisherAdapter[] = []) {}

  get(platform: SocialConnection["platform"]): PublisherAdapter | undefined {
    return this.adapters.find((adapter) => adapter.platform === platform);
  }

  async enqueue(variant: ContentVariant, connection: SocialConnection, scheduledAt: Date, idempotencyKey: string): Promise<PublishJob> {
    const adapter = this.get(connection.platform);
    if (!adapter) throw new Error(`No publisher adapter registered for ${connection.platform}`);
    const preflight = adapter.preflight(variant, connection, scheduledAt);
    if (!preflight.ok) throw new Error(preflight.checks.filter((check) => !check.ok).map((check) => check.message).join(" "));
    return adapter.enqueue(variant, connection, scheduledAt, idempotencyKey);
  }
}
