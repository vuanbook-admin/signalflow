import type { ContentRecipe } from "./contentRecipe";
import { STRATEGY_OBJECTIVE_KEYS, type StrategySnapshot } from "./contentStrategy";
import type { ResolvedStrategy } from "./contentStrategyResolver";
import type { SocialPlatform } from "./mvpContracts";

export type AssetPromptFormat = "text" | "image" | "video";
export type CustomerMediaPromptEvidence = { assetId: string; mimeType?: string; order: number; role: "publish" | "reference"; sha256?: string };
export type StrategyPromptInput = {
  brandName: string;
  brandVoice: string;
  channel: SocialPlatform;
  format: AssetPromptFormat;
  strategy: ResolvedStrategy;
  recipe?: ContentRecipe;
  identityContext: string;
  intelligenceContext: string;
  brief: string;
  existingTopics: string[];
  customerMedia?: readonly CustomerMediaPromptEvidence[];
};

const clean = (value: string | undefined): string => value?.trim() ?? "";
const same = (value: unknown, ...expected: Array<string | undefined>): boolean => typeof value === "string" && expected.filter(Boolean).some((candidate) => value.trim().toLowerCase() === candidate!.trim().toLowerCase());
const PLATFORMS: readonly SocialPlatform[] = ["facebook", "instagram", "tiktok", "youtube"];
const FINGERPRINT = /^[a-f0-9]{64}$/i;
const SNAPSHOT_KEYS = new Set(["objectiveKey", "objectiveLabel", "pillarId", "pillarLabel", "angleId", "angleLabel", "angleGuidance", "angleIdByChannel", "channel", "format", "strategyVersion", "catalogFingerprint", "recipeId", "recipeGuidance"]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function positiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function completeSnapshot(value: unknown, format: AssetPromptFormat): value is StrategySnapshot {
  const snapshot = record(value);
  if (!snapshot || [...Object.keys(snapshot)].some((key) => !SNAPSHOT_KEYS.has(key))) return false;
  const requiredText = ["objectiveLabel", "pillarId", "pillarLabel", "angleId", "angleLabel", "angleGuidance", "channel"];
  if (!requiredText.every((key) => typeof snapshot[key] === "string" && Boolean((snapshot[key] as string).trim()))) return false;
  if (!STRATEGY_OBJECTIVE_KEYS.includes(snapshot.objectiveKey as typeof STRATEGY_OBJECTIVE_KEYS[number]) || !PLATFORMS.includes(snapshot.channel as SocialPlatform) || snapshot.format !== format || !positiveVersion(snapshot.strategyVersion) || typeof snapshot.catalogFingerprint !== "string" || !FINGERPRINT.test(snapshot.catalogFingerprint)) return false;
  const angleIdByChannel = snapshot.angleIdByChannel;
  if (angleIdByChannel !== undefined) {
    const angleMap = record(angleIdByChannel);
    if (!angleMap || Object.entries(angleMap).some(([channel, angleId]) => !PLATFORMS.includes(channel as SocialPlatform) || typeof angleId !== "string" || !angleId.trim())) return false;
  }
  if (snapshot.recipeId !== undefined && (typeof snapshot.recipeId !== "string" || !snapshot.recipeId.trim())) return false;
  if (snapshot.recipeGuidance !== undefined && (typeof snapshot.recipeGuidance !== "string" || !snapshot.recipeGuidance.trim())) return false;
  return true;
}

function sameSnapshotField(field: string, actual: unknown, expected: unknown): boolean {
  if (field === "catalogFingerprint" && typeof actual === "string" && typeof expected === "string") return actual.toLowerCase() === expected.toLowerCase();
  if (["objectiveKey", "objectiveLabel", "pillarId", "pillarLabel", "angleId", "angleLabel", "angleGuidance", "channel", "format", "recipeId", "recipeGuidance"].includes(field) && typeof actual === "string" && typeof expected === "string") return actual.trim().toLowerCase() === expected.trim().toLowerCase();
  if (field === "angleIdByChannel") {
    const left = record(actual);
    const right = record(expected);
    if (left && right) return Object.keys(left).length === Object.keys(right).length && Object.entries(right).every(([channel, angle]) => left[channel] === angle);
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function expectedSnapshotFor(strategy: ResolvedStrategy): Record<string, unknown> {
  return strategy.strategySnapshot as unknown as Record<string, unknown>;
}

export type StrategyIdentityValidation = { ok: true; strategy: ResolvedStrategy; snapshot: StrategySnapshot } | { ok: false; code: "STRATEGY_EXPECTED_INVALID"; message: string };

/** Validate the complete strategy identity before a provider response can be accepted. */
export function validateResolvedStrategyIdentity(value: unknown, format: AssetPromptFormat): StrategyIdentityValidation {
  const strategy = record(value);
  if (!strategy || !STRATEGY_OBJECTIVE_KEYS.includes(strategy.objectiveKey as typeof STRATEGY_OBJECTIVE_KEYS[number]) || typeof strategy.objectiveLabel !== "string" || !strategy.objectiveLabel.trim() || typeof strategy.pillarId !== "string" || !strategy.pillarId.trim() || typeof strategy.pillarLabel !== "string" || !strategy.pillarLabel.trim() || typeof strategy.angleId !== "string" || !strategy.angleId.trim() || typeof strategy.angleLabel !== "string" || !strategy.angleLabel.trim() || typeof strategy.angleGuidance !== "string" || !strategy.angleGuidance.trim() || !PLATFORMS.includes(strategy.channel as SocialPlatform) || strategy.format !== format || !positiveVersion(strategy.strategyVersion) || typeof strategy.catalogFingerprint !== "string" || !FINGERPRINT.test(strategy.catalogFingerprint) || !completeSnapshot(strategy.strategySnapshot, format)) {
    return { ok: false, code: "STRATEGY_EXPECTED_INVALID", message: "Resolved strategy must include objective, pillar, angle guidance, channel, version, fingerprint, format, and a complete snapshot." };
  }
  const snapshot = strategy.strategySnapshot as StrategySnapshot;
  const snapshotRecord = snapshot as unknown as Record<string, unknown>;
  const fields = ["objectiveKey", "objectiveLabel", "pillarId", "pillarLabel", "angleId", "angleLabel", "angleGuidance", "channel", "format", "strategyVersion", "catalogFingerprint"];
  if (fields.some((field) => !sameSnapshotField(field, snapshotRecord[field], strategy[field]))) return { ok: false, code: "STRATEGY_EXPECTED_INVALID", message: "Resolved strategy and strategy snapshot do not describe the same immutable identity." };
  return { ok: true, strategy: value as ResolvedStrategy, snapshot };
}

export function structuredAssetInstruction(format: AssetPromptFormat): string {
  if (format === "image") return "For this image format, return metadata.imageConcept and metadata.imagePrompt only for the asset branch. Return JSON only.";
  if (format === "video") return "For this video format, return metadata.videoConcept and metadata.videoPrompt only for the asset branch. Return JSON only.";
  return "For this text format, return no asset metadata. Return JSON only.";
}

/** Provider-visible immutable values, copied by the provider and verified on return. */
export function strategyIdentityInstruction(strategy: ResolvedStrategy, format: AssetPromptFormat): string {
  const identity = validateResolvedStrategyIdentity(strategy, format);
  if (!identity.ok) throw new Error(`${identity.code}: ${identity.message}`);
  const snapshot = identity.snapshot;
  return [
    "Copy the following identity fields exactly into the variant for this channel. They are immutable routing data, not creative placeholders. Preserve the entire strategySnapshot including optional recipe and angleIdByChannel fields; omit optional fields absent here. Generate only the creative fields from the supplied facts.",
    "IMMUTABLE STRATEGY IDENTITY JSON:",
    JSON.stringify({ objective: snapshot.objectiveKey, contentPillar: snapshot.pillarId, contentAngle: snapshot.angleId, channel: snapshot.channel, format: snapshot.format, strategyVersion: snapshot.strategyVersion, catalogFingerprint: snapshot.catalogFingerprint, strategySnapshot: snapshot }),
  ].join("\n");
}

export function compileStrategyPrompt(input: StrategyPromptInput): string {
  const strategy = input.strategy;
  const recipe = input.recipe;
  const media = [...(input.customerMedia ?? [])].sort((left, right) => left.order - right.order);
  return [
    `BRAND: ${input.brandName.trim()}`,
    `BRAND VOICE: ${input.brandVoice.trim()}`,
    clean(input.identityContext),
    clean(input.intelligenceContext),
    "RESOLVED STRATEGY (follow these values exactly)",
    `OBJECTIVE: ${strategy.objectiveKey} · ${strategy.objectiveLabel}${clean((strategy as ResolvedStrategy & { objectiveDescription?: string }).objectiveDescription) ? ` · ${clean((strategy as ResolvedStrategy & { objectiveDescription?: string }).objectiveDescription)}` : ""}`,
    `CONTENT PILLAR: ${strategy.pillarId} · ${strategy.pillarLabel}${clean((strategy as ResolvedStrategy & { pillarDescription?: string }).pillarDescription) ? ` · ${clean((strategy as ResolvedStrategy & { pillarDescription?: string }).pillarDescription)}` : ""}`,
    `CONTENT ANGLE: ${strategy.angleId} · ${strategy.angleLabel} · ${strategy.angleGuidance}`,
    `CHANNEL: ${strategy.channel}`,
    `FORMAT: ${input.format}`,
    strategyIdentityInstruction(strategy, input.format),
    recipe ? `RECIPE: ${recipe.id} · ${recipe.name}\n${recipe.hookGuidance ? `HOOK GUIDANCE: ${recipe.hookGuidance}` : ""}\n${recipe.structureGuidance ? `STRUCTURE GUIDANCE: ${recipe.structureGuidance}` : ""}\n${recipe.ctaGuidance ? `CTA GUIDANCE: ${recipe.ctaGuidance}` : ""}\n${recipe.qualityChecklist.length ? `QUALITY CHECKLIST: ${recipe.qualityChecklist.join(", ")}` : ""}` : "RECIPE: none; follow the resolved angle guidance.",
    media.length ? `SELECTED CUSTOMER MEDIA EVIDENCE (files are attached to this same request):\n${media.map((item, index) => `${index + 1}. ${item.assetId} · ${item.role} · ${item.mimeType ?? "unknown"}${item.sha256 ? ` · sha256 ${item.sha256}` : ""}`).join("\n")}\nUse the publish item for the post and reference items for context only.` : "SELECTED CUSTOMER MEDIA EVIDENCE: none; do not invent visual details.",
    `BRIEF: ${clean(input.brief)}`,
    input.existingTopics.length ? `TOPICS TO AVOID REPEATING:\n${input.existingTopics.filter(Boolean).map((topic) => `- ${topic}`).join("\n")}\nDo not repeat: ${input.existingTopics.filter(Boolean).join("; ")}` : "TOPICS TO AVOID REPEATING: none",
    "Generate every creative field from the active brand identity, approved intelligence lineage, resolved strategy, and brief. Copy the immutable strategy identity exactly. Never replace the resolved strategy with a default objective or pillar.",
    structuredAssetInstruction(input.format),
  ].filter(Boolean).join("\n\n");
}

function strategyError(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}

export function validateGeneratedStrategyOutput(input: {
  format: AssetPromptFormat;
  expected: ResolvedStrategy;
  output: {
    contentPillar?: string;
    contentAngle?: string;
    objective?: string;
    channel?: string;
    strategyVersion?: number;
    catalogFingerprint?: string;
    strategySnapshot?: Partial<Record<string, unknown>>;
    format?: AssetPromptFormat;
    imageConcept?: string;
    imagePrompt?: string;
    videoConcept?: string;
    videoPrompt?: string;
  };
}): { ok: true } | { ok: false; code: string; message: string } {
  const { output, expected } = input;
  const expectedIdentity = validateResolvedStrategyIdentity(expected, input.format);
  if (!expectedIdentity.ok) return expectedIdentity;
  if (!clean(output.objective)) return strategyError("STRATEGY_OBJECTIVE_REQUIRED", "Generated output must include the resolved objective.");
  if (!same(output.objective, expected.objectiveKey, expected.objectiveLabel)) return strategyError("STRATEGY_OBJECTIVE_MISMATCH", "Generated objective does not match the resolved strategy.");
  if (!clean(output.contentPillar)) return strategyError("STRATEGY_PILLAR_REQUIRED", "Generated output must include the resolved content pillar.");
  if (!same(output.contentPillar, expected.pillarId, expected.pillarLabel)) return strategyError("STRATEGY_PILLAR_MISMATCH", "Generated content pillar does not match the resolved strategy.");
  if (!clean(output.contentAngle)) return strategyError("STRATEGY_ANGLE_REQUIRED", "Generated output must include the resolved content angle.");
  if (!same(output.contentAngle, expected.angleId, expected.angleLabel)) return strategyError("STRATEGY_ANGLE_MISMATCH", "Generated content angle does not match the resolved strategy.");
  if (!clean(output.channel)) return strategyError("STRATEGY_CHANNEL_REQUIRED", "Generated output must include the resolved channel.");
  if (!same(output.channel, expected.channel)) return strategyError("STRATEGY_CHANNEL_MISMATCH", "Generated channel does not match the resolved strategy.");
  if (output.strategyVersion === undefined) return strategyError("STRATEGY_VERSION_REQUIRED", "Generated output must include the resolved strategy version.");
  if (output.strategyVersion !== expected.strategyVersion) return strategyError("STRATEGY_VERSION_MISMATCH", "Generated strategy version does not match the resolved strategy.");
  const catalogFingerprint = output.catalogFingerprint;
  if (typeof catalogFingerprint !== "string" || !catalogFingerprint.trim()) return strategyError("STRATEGY_FINGERPRINT_REQUIRED", "Generated output must include the resolved catalog fingerprint.");
  if (catalogFingerprint.toLowerCase() !== expected.catalogFingerprint.toLowerCase()) return strategyError("STRATEGY_FINGERPRINT_MISMATCH", "Generated catalog fingerprint does not match the resolved strategy.");
  if (!completeSnapshot(output.strategySnapshot, input.format)) return strategyError("STRATEGY_SNAPSHOT_INVALID", "Generated output must include a complete strategy snapshot with guidance and format.");
  const expectedSnapshot = expectedSnapshotFor(expected);
  const snapshotFields = ["objectiveKey", "objectiveLabel", "pillarId", "pillarLabel", "angleId", "angleLabel", "angleGuidance", "channel", "format", "strategyVersion", "catalogFingerprint", "recipeId", "recipeGuidance", "angleIdByChannel"];
  if (snapshotFields.some((field) => { const actual = (output.strategySnapshot as Record<string, unknown>)[field]; const expectedValue = expectedSnapshot[field]; if (["recipeId", "recipeGuidance", "angleIdByChannel"].includes(field) && expectedValue === undefined) return actual !== undefined; return !sameSnapshotField(field, actual, expectedValue); })) return strategyError("STRATEGY_SNAPSHOT_MISMATCH", "Generated strategy snapshot does not match the resolved strategy.");
  if (output.format === undefined) return strategyError("STRATEGY_FORMAT_REQUIRED", "Generated output must include the requested format.");
  if (output.format !== input.format || output.format !== expectedSnapshot.format) return strategyError("STRATEGY_FORMAT_MISMATCH", "Generated format does not match the resolved strategy.");
  if (input.format === "image") {
    if (!clean(output.imageConcept) || !clean(output.imagePrompt)) return strategyError("IMAGE_METADATA_REQUIRED", "Image output requires imageConcept and imagePrompt.");
    if (clean(output.videoConcept) || clean(output.videoPrompt)) return strategyError("IMAGE_VIDEO_METADATA_FORBIDDEN", "Image output cannot include video metadata.");
  } else if (input.format === "video") {
    if (!clean(output.videoConcept) || !clean(output.videoPrompt)) return strategyError("VIDEO_METADATA_REQUIRED", "Video output requires videoConcept and videoPrompt.");
    if (clean(output.imageConcept) || clean(output.imagePrompt)) return strategyError("VIDEO_IMAGE_METADATA_FORBIDDEN", "Video output cannot include image metadata.");
  } else if (clean(output.imageConcept) || clean(output.imagePrompt) || clean(output.videoConcept) || clean(output.videoPrompt)) {
    return strategyError("TEXT_ASSET_METADATA_FORBIDDEN", "Text output cannot include image or video metadata.");
  }
  return { ok: true };
}
