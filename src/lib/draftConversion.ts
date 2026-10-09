import type { ContentKind, ContentVariant, SocialPlatform } from "./mvpContracts";
import type { ContentTransformMode } from "./contentTransform";
import { captureContentIntelligenceLineage, type ContentIntelligenceLineage } from "./contentIntelligence";
import type { StrategySnapshot } from "./contentStrategy";

export type DraftPlatform = "Facebook" | "Instagram" | "TikTok" | "YouTube";

export interface DraftConversionInput {
  id: number;
  title: string;
  topic?: string;
  platform: DraftPlatform;
  tag?: string;
  body?: string;
  hashtags?: string[];
  contentPillar?: string;
  contentAngle?: string;
  objective?: string;
  strategyVersion?: number;
  catalogFingerprint?: string;
  strategySnapshot?: StrategySnapshot;
  cta?: string;
  seoKeywords?: string[];
  scheduledAt?: string;
  sources?: string[];
  notes?: string;
  qualityStatus?: "pending" | "passed" | "failed";
  approvalState?: "proposed" | "ready" | "scheduled" | "publishing" | "published" | "failed";
  contentKind?: ContentKind;
  mediaAssetIds?: string[];
  mediaUrl?: string;
  automationKey?: string;
  planId?: string;
  targetPageId?: string;
  brandId?: string;
  imageProvider?: string;
  videoProvider?: string;
  imageConcept?: string;
  imagePrompt?: string;
  videoConcept?: string;
  videoPrompt?: string;
  strategyRationale?: string;
  mediaSha256?: string;
  visualFingerprint?: string;
  mediaProvenance?: Record<string, unknown>;
  mediaEvidence?: Array<{ assetId: string; sha256?: string; mimeType?: string; order: number; role: "publish" | "reference"; uploadState: "pending" | "processed" | "failed"; attachmentBoundary?: string }>;
  contentRunId?: string;
  revisionId?: string;
  parentRevisionId?: string;
  identityVersionId?: string;
  generationProfileId?: string;
  executionMode?: "subscription_package" | "llm_provider";
  providerTraceId?: string;
  bindingIds?: string[];
  recipeId?: string;
  transformMode?: ContentTransformMode;
  sourceRef?: string;
  selectedKnowledgeItemIds?: string[];
  selectedResearchEvidenceIds?: string[];
  selectedPromptBlueprintId?: string;
  promptBlueprintVersion?: number;
  mediaSetFingerprint?: string;
  customerFacts?: string[];
  prompt?: string;
  contentIntelligenceLineage?: ContentIntelligenceLineage;
}

export function draftToContentVariant(draft: DraftConversionInput): ContentVariant {
  const platform = draft.platform.toLowerCase() as SocialPlatform;
  const kind: ContentKind = draft.contentKind ?? (draft.tag?.toLowerCase().includes("carousel")
    ? "carousel"
    : draft.tag?.toLowerCase().includes("short")
      ? "short_video"
      : draft.tag?.toLowerCase().includes("long")
        ? "long_video"
        : "text");
  const strategySnapshot = draft.strategySnapshot ? structuredClone(draft.strategySnapshot) : undefined;
  return {
    id: `variant-${draft.id}`,
    contentId: `content-${draft.id}`,
    platform,
    kind,
    title: draft.title,
    body: draft.body?.trim() || draft.title,
    caption: draft.body?.trim() || draft.title,
    contentPillar: draft.contentPillar,
    contentAngle: draft.contentAngle,
    objective: draft.objective,
    strategyVersion: draft.strategyVersion,
    catalogFingerprint: draft.catalogFingerprint,
    strategySnapshot,
    cta: draft.cta,
    mediaAssetIds: draft.mediaAssetIds ?? [],
    hashtags: draft.hashtags ?? [],
    seoKeywords: draft.seoKeywords,
    scheduledAt: draft.scheduledAt,
    sources: draft.sources,
    notes: draft.notes,
    qualityStatus: draft.qualityStatus,
    approvalState: draft.approvalState,
    metadata: {
      ...(draft.mediaUrl ? kind === "image" ? { imageUrl: draft.mediaUrl } : { videoUrl: draft.mediaUrl } : {}),
      ...(draft.automationKey ? { automationKey: draft.automationKey } : {}),
      ...(draft.planId ? { planId: draft.planId } : {}),
      ...(draft.targetPageId ? { targetPageId: draft.targetPageId } : {}),
      ...(draft.brandId ? { brandId: draft.brandId } : {}),
      ...(draft.imageProvider ? { imageProvider: draft.imageProvider } : {}),
      ...(draft.videoProvider ? { videoProvider: draft.videoProvider } : {}),
      ...(draft.mediaSha256 ? { mediaSha256: draft.mediaSha256 } : {}),
      ...(draft.visualFingerprint ? { visualFingerprint: draft.visualFingerprint } : {}),
      ...(draft.mediaProvenance ? { mediaProvenance: draft.mediaProvenance } : {}),
      ...(draft.mediaEvidence ? { mediaEvidence: draft.mediaEvidence } : {}),
      ...(draft.contentRunId ? { contentRunId: draft.contentRunId } : {}),
      ...(draft.revisionId ? { revisionId: draft.revisionId } : {}),
      ...(draft.parentRevisionId ? { parentRevisionId: draft.parentRevisionId } : {}),
      ...(draft.identityVersionId ? { identityVersionId: draft.identityVersionId } : {}),
      ...(draft.generationProfileId ? { generationProfileId: draft.generationProfileId } : {}),
      ...(draft.executionMode ? { executionMode: draft.executionMode } : {}),
      ...(draft.providerTraceId ? { providerTraceId: draft.providerTraceId } : {}),
      ...(draft.bindingIds ? { bindingIds: draft.bindingIds } : {}),
      ...(draft.recipeId ? { recipeId: draft.recipeId } : {}),
      ...(draft.transformMode ? { transformMode: draft.transformMode } : {}),
      ...(draft.sourceRef ? { sourceRef: draft.sourceRef } : {}),
      ...(draft.selectedKnowledgeItemIds ? { selectedKnowledgeItemIds: [...draft.selectedKnowledgeItemIds] } : {}),
      ...(draft.selectedResearchEvidenceIds ? { selectedResearchEvidenceIds: [...draft.selectedResearchEvidenceIds] } : {}),
      ...(draft.selectedPromptBlueprintId ? { selectedPromptBlueprintId: draft.selectedPromptBlueprintId } : {}),
      ...(draft.promptBlueprintVersion !== undefined ? { promptBlueprintVersion: draft.promptBlueprintVersion } : {}),
      ...(draft.mediaSetFingerprint ? { mediaSetFingerprint: draft.mediaSetFingerprint } : {}),
      ...(draft.customerFacts ? { customerFacts: [...draft.customerFacts] } : {}),
      ...(draft.prompt ? { prompt: draft.prompt } : {}),
      ...(draft.contentIntelligenceLineage ? { contentIntelligenceLineage: draft.contentIntelligenceLineage } : {}),
      ...(draft.topic ? { topic: draft.topic } : {}),
      ...(draft.contentPillar ? { contentPillar: draft.contentPillar } : {}),
      ...(draft.contentAngle ? { contentAngle: draft.contentAngle } : {}),
      ...(draft.objective ? { objective: draft.objective } : {}),
      ...(draft.strategyVersion !== undefined ? { strategyVersion: draft.strategyVersion } : {}),
      ...(draft.catalogFingerprint ? { catalogFingerprint: draft.catalogFingerprint } : {}),
      ...(strategySnapshot ? { strategySnapshot } : {}),
      ...(draft.imageConcept ? { imageConcept: draft.imageConcept } : {}),
      ...(draft.imagePrompt ? { imagePrompt: draft.imagePrompt } : {}),
      ...(draft.videoConcept ? { videoConcept: draft.videoConcept } : {}),
      ...(draft.videoPrompt ? { videoPrompt: draft.videoPrompt } : {}),
      ...(draft.strategyRationale ? { strategyRationale: draft.strategyRationale } : {}),
      ...(draft.cta ? { cta: draft.cta } : {}),
      ...(draft.seoKeywords ? { seoKeywords: draft.seoKeywords } : {}),
      ...(draft.scheduledAt ? { scheduledAt: draft.scheduledAt } : {}),
      ...(draft.sources ? { sources: draft.sources } : {}),
      ...(draft.notes ? { notes: draft.notes } : {}),
      ...(draft.qualityStatus ? { qualityStatus: draft.qualityStatus } : {}),
      ...(draft.approvalState ? { approvalState: draft.approvalState } : {}),
    },
    lifecycle: "approved",
  };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const MEDIA_METADATA_KEYS = ["mediaEvidence", "mediaAssetIds", "mediaUrl", "imageUrl", "videoUrl", "publicUrl", "mediaSha256", "visualFingerprint", "mediaProvenance", "mediaOperations", "mediaKind"] as const;

function hasMediaValue(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim().length > 0 : Boolean(value && typeof value === "object");
}

export function hasEffectiveContentRunMedia(runValue: unknown): boolean {
  const run = recordFrom(runValue);
  if (hasMediaValue(run.mediaEvidence) || hasMediaValue(run.mediaAssetIds)) return true;
  const variants = Array.isArray(run.variants) ? run.variants.map(recordFrom) : [];
  return variants.some((variant) => hasMediaValue(variant.mediaAssetIds) || MEDIA_METADATA_KEYS.some((key) => hasMediaValue(recordFrom(variant.metadata)[key])));
}

type RestoredContentRunLineage = Pick<DraftConversionInput, "selectedKnowledgeItemIds" | "selectedResearchEvidenceIds" | "selectedPromptBlueprintId" | "promptBlueprintVersion" | "recipeId" | "transformMode" | "sourceRef" | "mediaSetFingerprint" | "customerFacts" | "prompt" | "contentIntelligenceLineage" | "revisionId" | "parentRevisionId">;
export type ContentRunLineageRestoreResult = { ok: true; status: "restored"; value: RestoredContentRunLineage } | { ok: false; status: "reconciliation_required"; code: "CONTENT_INTELLIGENCE_RELOAD_LINEAGE_MISSING"; missingFields: string[] };

export function restoreContentRunLineage(runValue: unknown, variantId?: string): ContentRunLineageRestoreResult | undefined {
  const run = recordFrom(runValue);
  const variants = Array.isArray(run.variants) ? run.variants : [];
  const variant = variants.map(recordFrom).find((item) => item.id === variantId) ?? recordFrom(variants[0]);
  const metadata = recordFrom(variant.metadata);
  const nestedValue = run.contentIntelligenceLineage ?? metadata.contentIntelligenceLineage ?? run.lineage ?? metadata.lineage;
  const hasTopLevelLineage = ["selectedKnowledgeItemIds", "selectedResearchEvidenceIds", "selectedPromptBlueprintId", "selectedPromptBlueprintVersion", "promptBlueprintVersion", "selectedRecipeId", "recipeId", "transformMode", "mediaSetFingerprint", "customerFacts", "prompt"].some((key) => Object.prototype.hasOwnProperty.call(run, key) || Object.prototype.hasOwnProperty.call(metadata, key));
  if (nestedValue === undefined && !hasTopLevelLineage) return undefined;
  const nested = nestedValue === undefined ? undefined : recordFrom(nestedValue);
  const source: Record<string, unknown> = nestedValue === undefined ? run : nested ?? {};
  const missingFields: string[] = [];
  const required = (key: string) => { if (!Object.prototype.hasOwnProperty.call(source, key)) missingFields.push(key); };
  required("selectedKnowledgeItemIds");
  required("selectedResearchEvidenceIds");
  required("selectedPromptBlueprintId");
  if (!Object.prototype.hasOwnProperty.call(source, "selectedRecipeId") && !Object.prototype.hasOwnProperty.call(source, "recipeId")) missingFields.push("selectedRecipeId");
  required("transformMode");
  required("customerFacts");
  const list = (key: string): string[] | undefined => {
    const value = source[key];
    return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0) ? [...value] : undefined;
  };
  const knowledge = list("selectedKnowledgeItemIds");
  const evidence = list("selectedResearchEvidenceIds");
  if (Object.prototype.hasOwnProperty.call(source, "selectedKnowledgeItemIds") && !knowledge) missingFields.push("selectedKnowledgeItemIds");
  if (Object.prototype.hasOwnProperty.call(source, "selectedResearchEvidenceIds") && !evidence) missingFields.push("selectedResearchEvidenceIds");
  const blueprintId = typeof source.selectedPromptBlueprintId === "string" ? source.selectedPromptBlueprintId.trim() : undefined;
  if (!blueprintId) missingFields.push("selectedPromptBlueprintId");
  const blueprintVersionValue = source.selectedPromptBlueprintVersion ?? source.promptBlueprintVersion;
  const blueprintVersion = typeof blueprintVersionValue === "number" && Number.isSafeInteger(blueprintVersionValue) && blueprintVersionValue >= 1 ? blueprintVersionValue : undefined;
  if (blueprintId && blueprintVersion === undefined) missingFields.push("selectedPromptBlueprintVersion");
  const recipeId = typeof source.selectedRecipeId === "string" ? source.selectedRecipeId.trim() : typeof source.recipeId === "string" ? source.recipeId.trim() : undefined;
  if (!recipeId) missingFields.push("selectedRecipeId");
  const allowedTransforms = ["original", "rewrite", "repurpose", "imitation", "de_ai_detector_evasion"] as const;
  const transformValue = allowedTransforms.includes(source.transformMode as typeof allowedTransforms[number]) ? source.transformMode as ContentTransformMode : undefined;
  if (!transformValue) missingFields.push("transformMode");
  const customerFacts = Array.isArray(source.customerFacts) && source.customerFacts.every((item) => typeof item === "string" && item.trim().length > 0) ? source.customerFacts.map((item) => item.trim()) : undefined;
  if (Object.prototype.hasOwnProperty.call(source, "customerFacts") && !customerFacts) missingFields.push("customerFacts");
  const promptValue = [source.prompt, run.prompt, metadata.prompt].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!promptValue) missingFields.push("prompt");
  const variantFingerprints = variants.map(recordFrom).flatMap((item) => {
    const itemMetadata = recordFrom(item.metadata);
    const itemLineage = recordFrom(itemMetadata.contentIntelligenceLineage ?? itemMetadata.lineage);
    return [itemMetadata.mediaSetFingerprint, itemLineage.mediaSetFingerprint];
  }).filter((value) => value !== undefined);
  const fingerprintValues = [source.mediaSetFingerprint, run.mediaSetFingerprint, metadata.mediaSetFingerprint, ...variantFingerprints].filter((value) => value !== undefined);
  const fingerprintValue = fingerprintValues[0];
  const fingerprint = fingerprintValue === undefined ? undefined : typeof fingerprintValue === "string" && /^[a-f0-9]{64}$/i.test(fingerprintValue) ? fingerprintValue : undefined;
  if (fingerprintValue !== undefined && !fingerprint) missingFields.push("mediaSetFingerprint");
  if (fingerprint && fingerprintValues.some((value) => typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value) || value.toLowerCase() !== fingerprint.toLowerCase())) missingFields.push("mediaSetFingerprint");
  if (hasEffectiveContentRunMedia(run) && !fingerprint) missingFields.push("mediaSetFingerprint");
  if (missingFields.length > 0) return { ok: false, status: "reconciliation_required", code: "CONTENT_INTELLIGENCE_RELOAD_LINEAGE_MISSING", missingFields: [...new Set(missingFields)] };
  const lineage = captureContentIntelligenceLineage({ selectedKnowledgeItemIds: knowledge!, selectedResearchEvidenceIds: evidence!, selectedPromptBlueprintId: blueprintId, selectedPromptBlueprintVersion: blueprintVersion, selectedRecipeId: recipeId, transformMode: transformValue!, mediaSetFingerprint: fingerprint, customerFacts: customerFacts! });
  const revisionId = typeof run.revisionId === "string" && run.revisionId.trim() ? run.revisionId.trim() : undefined;
  const parentRevisionId = typeof run.parentRevisionId === "string" && run.parentRevisionId.trim() ? run.parentRevisionId.trim() : undefined;
  const value: RestoredContentRunLineage = { selectedKnowledgeItemIds: [...lineage.selectedKnowledgeItemIds], selectedResearchEvidenceIds: [...lineage.selectedResearchEvidenceIds], ...(lineage.selectedPromptBlueprintId ? { selectedPromptBlueprintId: lineage.selectedPromptBlueprintId } : {}), ...(lineage.selectedPromptBlueprintVersion !== undefined ? { promptBlueprintVersion: lineage.selectedPromptBlueprintVersion } : {}), ...(lineage.selectedRecipeId ? { recipeId: lineage.selectedRecipeId } : {}), transformMode: lineage.transformMode, ...(lineage.mediaSetFingerprint ? { mediaSetFingerprint: lineage.mediaSetFingerprint } : {}), customerFacts: [...lineage.customerFacts], prompt: promptValue, ...(revisionId ? { revisionId } : {}), ...(parentRevisionId ? { parentRevisionId } : {}), contentIntelligenceLineage: lineage };
  return { ok: true, status: "restored", value };
}

export function restoreContentRunMediaEvidence(runValue: unknown, variantId?: string): Pick<DraftConversionInput, "mediaEvidence" | "mediaAssetIds"> | undefined {
  if (!runValue || typeof runValue !== "object" || Array.isArray(runValue)) return undefined;
  const run = runValue as Record<string, unknown>;
  const variants = Array.isArray(run.variants) ? run.variants.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
  const variant = variants.find((item) => item.id === variantId) ?? variants[0];
  const metadata = variant?.metadata && typeof variant.metadata === "object" && !Array.isArray(variant.metadata) ? variant.metadata as Record<string, unknown> : {};
  const runEvidence = Array.isArray(run.mediaEvidence) && run.mediaEvidence.length ? run.mediaEvidence : undefined;
  const rawEvidence = runEvidence ?? (Array.isArray(metadata.mediaEvidence) ? metadata.mediaEvidence : undefined);
  if (!rawEvidence?.length) return undefined;
  const mediaEvidence = rawEvidence.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const item = value as Record<string, unknown>;
    const sha256 = typeof item.sha256 === "string" ? item.sha256.replace(/^sha256:/i, "").toLowerCase() : "";
    const mimeType = typeof item.mimeType === "string" ? item.mimeType.trim().toLowerCase() : "";
    if (typeof item.assetId !== "string" || !item.assetId || !/^[a-f0-9]{64}$/.test(sha256) || !/^image\/(png|jpeg|webp)$/.test(mimeType) || item.order !== index || item.role !== (index === 0 ? "publish" : "reference") || !["pending", "processed", "failed"].includes(String(item.uploadState))) return undefined;
    return { assetId: item.assetId, sha256, mimeType, order: index, role: item.role as "publish" | "reference", uploadState: item.uploadState as "pending" | "processed" | "failed", ...(typeof item.attachmentBoundary === "string" ? { attachmentBoundary: item.attachmentBoundary } : {}) };
  });
  if (mediaEvidence.some((item) => !item)) return undefined;
  const validEvidence = mediaEvidence as NonNullable<(typeof mediaEvidence)[number]>[];
  return { mediaEvidence: validEvidence, mediaAssetIds: validEvidence.map((item) => item.assetId) };
}
