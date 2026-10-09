import type { ContentKind, GenerationExecutionMode, SocialPlatform } from "./mvpContracts";
import type { ContentIntelligenceLineage } from "./contentIntelligence";
import type { StrategySnapshot } from "./contentStrategy";
import { validateContentRecipeForStrategy, type ContentRecipe } from "./contentRecipe";

export type ContentRunTrigger = "manual" | "automation";
export type ContentRunState = "proposed" | "needs_review" | "quality_passed" | "ready" | "scheduled" | "publishing" | "published" | "failed";
export type ApprovalState = "pending" | "approved" | "rejected";
export type QualityStatus = "pending" | "passed" | "failed";
export type GenerationStatus = "pending" | "completed" | "failed" | "unknown";
export type RegenerationState = "clean" | "needs_regeneration";
export type QualityCheck = { key: string; passed: boolean; message?: string };
export type ContentSource = string | { title?: string; url?: string; ref?: string };
export type ContentOperation = { type: string; status?: string; assetId?: string; operationId?: string; [key: string]: unknown };
export type ContentRunMediaEvidence = { assetId: string; sha256: string; mimeType: string; order: number; role: "publish" | "reference"; uploadState: "pending" | "processed" | "failed"; attachmentBoundary?: string };

export function validateRewriteRecipeForStrategy(recipe: ContentRecipe | undefined, strategy: { pillarId: string; angleId: string }): { ok: true } | { ok: false; code: string } {
  return recipe ? validateContentRecipeForStrategy(recipe, strategy) : { ok: true };
}

export type ContentRunVariant = { id: string; platform: SocialPlatform; kind: ContentKind; body: string; lifecycle: ContentRunState; identityVersionId: string; providerTraceId: string; title?: string; caption?: string; contentPillar?: string; contentAngle?: string; objective?: string; strategyVersion?: number; catalogFingerprint?: string; strategySnapshot?: StrategySnapshot; cta?: string; hashtags?: string[]; seoKeywords?: string[]; mediaAssetIds?: string[]; visualOperations?: ContentOperation[]; mediaOperations?: ContentOperation[]; metadata?: Record<string, unknown> };
export type ContentRun = { id: string; clientId: string; brandId: string; identityVersionId: string; generationProfileId: string; executionMode: GenerationExecutionMode; providerTraceId: string; trigger: ContentRunTrigger; requestId?: string; promptVersion?: string; mediaSetFingerprint?: string; generationStatus?: GenerationStatus; regenerationState?: RegenerationState; strategyState?: RegenerationState; mediaEvidence?: ContentRunMediaEvidence[]; topic?: string; contentPillar?: string; contentAngle?: string; objective?: string; strategyVersion?: number; catalogFingerprint?: string; strategySnapshot?: StrategySnapshot; caption?: string; body?: string; cta?: string; hashtags?: string[]; seoKeywords?: string[]; scheduledAt?: string; sources?: ContentSource[]; notes?: string; targetPlatforms?: SocialPlatform[]; targetBindingIds?: string[]; bindingIds?: string[]; identity?: Record<string, unknown>; profile?: Record<string, unknown>; trace?: Record<string, unknown>; visualOperations?: ContentOperation[]; mediaOperations?: ContentOperation[]; qualityChecks?: QualityCheck[]; qualityStatus?: QualityStatus; approvalState?: ApprovalState; recipeId?: string; transformMode?: string; sourceRef?: string; planId?: string; parentContentRunId?: string; revisionId?: string; parentRevisionId?: string; selectedKnowledgeItemIds?: string[]; selectedResearchEvidenceIds?: string[]; selectedPromptBlueprintId?: string; selectedPromptBlueprintVersion?: number; customerFacts?: string[]; contentIntelligenceLineage?: ContentIntelligenceLineage; prompt?: string; state: ContentRunState; variants: ContentRunVariant[] };

export function initialContentRunRevisionId(contentRunId: string): string {
  return `revision-${contentRunId}`;
}

export function contentRunRevisionFieldsFromDraft(draft: Pick<ContentRun, "revisionId" | "parentRevisionId">): Pick<ContentRun, "revisionId" | "parentRevisionId"> {
  return {
    ...(draft.revisionId ? { revisionId: draft.revisionId } : {}),
    ...(draft.parentRevisionId ? { parentRevisionId: draft.parentRevisionId } : {}),
  };
}

export type DraftAction = "quality" | "approval" | "publish";
export type DraftActionScope = { profileId: string; profileRevision: number; clientId: string; brandId: string; draftId: string | number; contentRunId?: string };
export type DraftActionToken = symbol;

export function draftActionScopeKey(scope: DraftActionScope): string {
  return JSON.stringify([scope.profileId, scope.profileRevision, scope.clientId, scope.brandId, String(scope.draftId), scope.contentRunId ?? `content-${scope.draftId}`]);
}

export function draftActionLockKey(scopeKey: string, action: DraftAction): string {
  return JSON.stringify([scopeKey, action]);
}

export function beginDraftAction(inFlight: Map<string, DraftActionToken>, key: string): DraftActionToken | undefined {
  if (inFlight.has(key)) return undefined;
  const token = Symbol(key);
  inFlight.set(key, token);
  return token;
}

export function endDraftAction(inFlight: Map<string, DraftActionToken>, key: string, token: DraftActionToken): void {
  if (inFlight.get(key) === token) inFlight.delete(key);
}

export function hasDraftActionInFlight(inFlight: Map<string, DraftActionToken>, scopeKey: string, actions: readonly DraftAction[]): boolean {
  return actions.some((action) => inFlight.has(draftActionLockKey(scopeKey, action)));
}

export type ContentRevisionFingerprintInput = {
  id: string | number; contentRunId?: string; revisionId?: string; title?: string; topic?: string; body?: string;
  contentPillar?: string; contentAngle?: string; objective?: string; strategyVersion?: number; strategySnapshot?: StrategySnapshot; cta?: string; hashtags?: string[]; seoKeywords?: string[];
  scheduledAt?: string; sources?: unknown[]; notes?: string; contentKind?: string; mediaKind?: string;
  mediaAssetIds?: string[]; mediaSha256?: string; mediaSetFingerprint?: string; visualFingerprint?: string;
  mediaEvidence?: unknown[]; mediaOperation?: unknown; mediaOperations?: unknown[];
};

export function contentRevisionFingerprint(draft: ContentRevisionFingerprintInput): string {
  return JSON.stringify([
    draft.id, draft.contentRunId, draft.revisionId, draft.title, draft.topic, draft.body, draft.contentPillar,
    draft.contentAngle, draft.objective, draft.strategyVersion, draft.strategySnapshot, draft.cta, draft.hashtags, draft.seoKeywords, draft.scheduledAt, draft.sources, draft.notes,
    draft.contentKind, draft.mediaKind, draft.mediaAssetIds, draft.mediaSha256, draft.mediaSetFingerprint,
    draft.visualFingerprint, draft.mediaEvidence, draft.mediaOperation, draft.mediaOperations,
  ]);
}

export function qualityAcknowledgementMatches(
  record: unknown,
  expected: { contentRunId: string; clientId: string; brandId: string; revisionId?: string; state: string; qualityStatus: string; qualityChecks: readonly QualityCheck[]; checkedAt: string },
): boolean {
  if (!record || typeof record !== "object") return false;
  const ack = record as Record<string, unknown>;
  return ack.id === expected.contentRunId
    && ack.clientId === expected.clientId
    && ack.brandId === expected.brandId
    && ack.revisionId === expected.revisionId
    && ack.state === expected.state
    && ack.qualityStatus === expected.qualityStatus
    && JSON.stringify(ack.qualityChecks) === JSON.stringify(expected.qualityChecks)
    && ack.checkedAt === expected.checkedAt;
}

export type ContentRunQualityCommandInput = {
  contentRunId: string;
  clientId: string;
  brandId: string;
  revisionId?: string;
  state: string;
  qualityStatus: string;
  qualityChecks: readonly QualityCheck[];
  checkedAt: string;
  expectedRevisionFields: Record<string, unknown>;
};

export async function submitContentRunQualityCheck<T extends Record<string, unknown>>(
  update: (payload: Record<string, unknown>) => Promise<T>,
  input: ContentRunQualityCommandInput,
): Promise<T> {
  const acknowledgement = await update({ state: input.state, qualityStatus: input.qualityStatus, qualityChecks: input.qualityChecks, checkedAt: input.checkedAt, expectedRevisionFields: input.expectedRevisionFields });
  if (!qualityAcknowledgementMatches(acknowledgement, input)) throw new Error("CONTENT_RUN_QUALITY_ACK_MISMATCH");
  return acknowledgement;
}

export function contentRunQualityExpectedRevisionFields(run: ContentRun, variantId: string): Record<string, unknown> {
  const variant = run.variants.find((candidate) => candidate.id === variantId);
  if (!variant) throw new Error("CONTENT_RUN_VARIANT_MISSING");
  const metadata = variant.metadata ?? {};
  return {
    clientId: run.clientId,
    brandId: run.brandId,
    identityVersionId: run.identityVersionId,
    revisionId: run.revisionId ?? null,
    topic: run.topic ?? null,
    body: run.body ?? null,
    caption: run.caption ?? null,
    contentPillar: run.contentPillar ?? null,
    contentAngle: run.contentAngle ?? null,
    objective: run.objective ?? null,
    strategyVersion: run.strategyVersion ?? null,
    catalogFingerprint: run.catalogFingerprint ?? null,
    strategySnapshot: run.strategySnapshot ?? null,
    strategyState: run.strategyState ?? run.regenerationState ?? null,
    regenerationState: run.regenerationState ?? run.strategyState ?? null,
    cta: run.cta ?? null,
    hashtags: run.hashtags ?? [],
    seoKeywords: run.seoKeywords ?? [],
    scheduledAt: run.scheduledAt ?? null,
    sources: run.sources ?? null,
    notes: run.notes ?? null,
    variantId,
    variant: {
      title: variant.title ?? null,
      body: variant.body ?? null,
      caption: variant.caption ?? null,
      contentPillar: variant.contentPillar ?? null,
      contentAngle: variant.contentAngle ?? null,
      objective: variant.objective ?? null,
      strategyVersion: variant.strategyVersion ?? null,
      catalogFingerprint: variant.catalogFingerprint ?? null,
      strategySnapshot: variant.strategySnapshot ?? null,
      cta: variant.cta ?? null,
      hashtags: variant.hashtags ?? [],
      seoKeywords: variant.seoKeywords ?? [],
      mediaAssetIds: variant.mediaAssetIds ?? [],
      mediaOperations: variant.mediaOperations ?? [],
      mediaEvidence: Array.isArray(metadata.mediaEvidence) ? metadata.mediaEvidence : [],
    },
  };
}

type EditableFields = Partial<Pick<ContentRun, "topic" | "contentPillar" | "contentAngle" | "objective" | "caption" | "body" | "cta" | "hashtags" | "seoKeywords" | "scheduledAt" | "sources" | "notes">>;
const cleanList = (values: readonly string[] | undefined, hashtag = false) => (values ?? []).map((value) => value.trim()).filter(Boolean).map((value) => hashtag && !value.startsWith("#") ? `#${value}` : value).filter((value, index, all) => all.findIndex((candidate) => (hashtag ? candidate.toLowerCase() : candidate) === (hashtag ? value.toLowerCase() : value)) === index);

export function normalizeEditableFields(input: EditableFields): EditableFields {
  const caption = (input.caption ?? input.body)?.trim(); const body = (input.body ?? input.caption)?.trim();
  return { ...input, topic: input.topic?.trim(), contentPillar: input.contentPillar?.trim(), contentAngle: input.contentAngle?.trim(), objective: input.objective?.trim(), caption, body, cta: input.cta?.trim(), notes: input.notes?.trim(), hashtags: cleanList(input.hashtags, true), seoKeywords: cleanList(input.seoKeywords), sources: input.sources?.map((source) => typeof source === "string" ? source.trim() : source).filter((source) => typeof source !== "string" || Boolean(source)) };
}

export function createContentRun(input: Omit<ContentRun, "state" | "variants"> & { variants: ReadonlyArray<{ id: string; platform: SocialPlatform; kind: ContentKind; body: string; title?: string; caption?: string; contentPillar?: string; contentAngle?: string; objective?: string; strategyVersion?: number; catalogFingerprint?: string; strategySnapshot?: StrategySnapshot; cta?: string; hashtags?: string[]; seoKeywords?: string[]; mediaAssetIds?: string[]; visualOperations?: ContentOperation[]; mediaOperations?: ContentOperation[]; metadata?: Record<string, unknown> }> }): ContentRun {
  const fields = normalizeEditableFields(input);
  const strategyState = input.strategyState ?? input.regenerationState ?? "clean";
  const snapshot = input.strategySnapshot ? structuredClone(input.strategySnapshot) : undefined;
  return { ...input, ...fields, ...(snapshot ? { strategyVersion: input.strategyVersion ?? snapshot.strategyVersion, catalogFingerprint: input.catalogFingerprint ?? snapshot.catalogFingerprint, strategySnapshot: snapshot } : {}), state: "needs_review", regenerationState: strategyState, strategyState, qualityStatus: input.qualityStatus ?? "pending", approvalState: input.approvalState ?? "pending", variants: input.variants.map((variant) => ({ ...variant, contentPillar: variant.contentPillar ?? input.contentPillar, contentAngle: variant.contentAngle ?? input.contentAngle, objective: variant.objective ?? input.objective, strategyVersion: variant.strategyVersion ?? input.strategyVersion ?? snapshot?.strategyVersion, catalogFingerprint: variant.catalogFingerprint ?? input.catalogFingerprint ?? snapshot?.catalogFingerprint, ...(variant.strategySnapshot ? { strategySnapshot: structuredClone(variant.strategySnapshot) } : snapshot ? { strategySnapshot: structuredClone(snapshot) } : {}), lifecycle: "needs_review", identityVersionId: input.identityVersionId, providerTraceId: input.providerTraceId, hashtags: cleanList(variant.hashtags, true), seoKeywords: cleanList(variant.seoKeywords) })) };
}

export function markNeedsRegeneration(run: ContentRun): ContentRun {
  return { ...run, regenerationState: "needs_regeneration", strategyState: "needs_regeneration" };
}

export function updateContentRunGeneration<T extends { generationStatus?: GenerationStatus; mediaEvidence?: ContentRunMediaEvidence[] }>(run: T, generationStatus: GenerationStatus, mediaEvidence = run.mediaEvidence): T {
  if (generationStatus === "completed" && mediaEvidence?.some((item) => item.uploadState !== "processed")) throw new Error("CONTENT_RUN_MEDIA_EVIDENCE_NOT_PROCESSED");
  return { ...run, generationStatus, ...(mediaEvidence ? { mediaEvidence: mediaEvidence.map((item) => ({ ...item })) } : {}) };
}

export function reconcilePendingGeneration<T extends { generationStatus?: GenerationStatus }>(run: T): T {
  return run.generationStatus === "pending" ? { ...run, generationStatus: "unknown" } : run;
}

export function contentRewriteBlocker(controlPlaneAvailable: boolean, generationStatus?: GenerationStatus): string | undefined {
  if (!controlPlaneAvailable) return "CONTENT_RUN_CONTROL_PLANE_REQUIRED";
  if (generationStatus === "pending" || generationStatus === "unknown") return "CONTENT_RUN_RECONCILIATION_REQUIRED";
  return undefined;
}

export type ContentRunPublication = { contentRunId?: string; variantId?: string; state?: string; commandStatus?: string; pendingCommandId?: string; workerAckState?: string };
const TERMINAL_PUBLICATION_STATES = new Set(["published", "canceled", "cancelled", "failed", "permanent_error", "approval_failed", "blocked"]);

export function hasActiveContentRunPublication(publications: readonly ContentRunPublication[], contentRunId: string, variantId?: string): boolean {
  return publications.some((publication) => publication.contentRunId === contentRunId && (!variantId || publication.variantId === variantId) && !TERMINAL_PUBLICATION_STATES.has(publication.state ?? ""));
}

export function runContentRewriteSingleFlight<T>(inFlight: Set<string>, key: string, task: () => Promise<T>): Promise<T | undefined> {
  if (inFlight.has(key)) return Promise.resolve(undefined);
  inFlight.add(key);
  return task().finally(() => inFlight.delete(key));
}

export function exportContentText(content: Pick<ContentRun, "caption" | "body" | "hashtags"> | Pick<ContentRunVariant, "caption" | "body" | "hashtags">): string { const copy = (content.caption ?? content.body ?? "").trim(); const tags = cleanList(content.hashtags, true); return [copy, tags.join(" ")].filter(Boolean).join("\n\n"); }

export function buildPublishReadinessChecks(run: Pick<ContentRun, "topic" | "contentPillar" | "objective" | "caption" | "body" | "cta" | "hashtags" | "sources" | "qualityChecks" | "variants"> & { contentAngle?: string; strategyVersion?: number; strategySnapshot?: StrategySnapshot }): QualityCheck[] {
  const copy = (run.caption ?? run.body ?? "").trim();
  const sourceCount = (run.sources ?? []).length;
  const visual = run.variants.some((variant) => Boolean(variant.mediaAssetIds?.length || variant.mediaOperations?.some((operation) => operation.status === "completed")));
  return [
    { key: "hook", passed: Boolean(run.topic?.trim()), message: "Hook mở bài" },
    { key: "caption", passed: copy.length >= 80, message: "Caption theo engine" },
    { key: "cta", passed: Boolean(run.cta?.trim()), message: "CTA rõ ràng" },
    { key: "hashtags", passed: Boolean(run.hashtags?.length && run.hashtags.length <= 10), message: "1–10 hashtag" },
    { key: "visual", passed: visual, message: "Có visual" },
    { key: "playbook", passed: true, message: "Marketing playbook" },
    { key: "strategy", passed: Boolean(run.contentPillar?.trim() && run.objective?.trim() && (!run.strategySnapshot && run.strategyVersion === undefined && !run.contentAngle ? true : run.contentAngle?.trim())), message: "Pillar + angle + mục tiêu" },
    { key: "format", passed: run.variants.length > 0, message: "Format đúng engine" },
    { key: "sources", passed: sourceCount > 0 || !/facts?|research|according|theo nghiên cứu/i.test(copy), message: "Nguồn nếu factual" },
    { key: "research", passed: true, message: "Research Brief" },
  ];
}

export function checkPublishReadiness(run: ContentRun): { ok: boolean; failures: string[]; checks: Array<{ key: string; ok: boolean }>; livePublishAttempted: false } {
  const checks = [{ key: "approval", ok: run.approvalState === "approved" }, { key: "quality", ok: run.qualityStatus === "passed" || Boolean(run.qualityChecks?.length && run.qualityChecks.every((check) => check.passed)) }, { key: "identity", ok: Boolean(run.identityVersionId) }, { key: "profile", ok: Boolean(run.generationProfileId) }, { key: "trace", ok: Boolean(run.providerTraceId) }, { key: "content", ok: run.variants.length > 0 && run.variants.every((variant) => Boolean(variant.body.trim())) }];
  return { ok: checks.every((check) => check.ok), failures: checks.filter((check) => !check.ok).map((check) => check.key), checks, livePublishAttempted: false };
}

export function persistQualityChecks(run: ContentRun, qualityChecks: ReadonlyArray<QualityCheck>): ContentRun { const checks = qualityChecks.map((check) => ({ ...check })); const passed = checks.length > 0 && checks.every((check) => check.passed); return { ...run, qualityChecks: checks, qualityStatus: passed ? "passed" : "failed", state: passed && (run.state === "needs_review" || run.state === "proposed") ? "quality_passed" : run.state }; }

const transitions: Record<ContentRunState, readonly ContentRunState[]> = { proposed: ["quality_passed", "failed"], needs_review: ["quality_passed", "failed"], quality_passed: ["ready", "failed"], ready: ["scheduled", "failed"], scheduled: ["publishing", "failed"], publishing: ["published", "failed"], published: [], failed: [] };
export function transitionContentRun(run: ContentRun, nextState: ContentRunState): ContentRun { if (!transitions[run.state].includes(nextState)) throw new Error(`Invalid Content Run transition: ${run.state} -> ${nextState}`); return { ...run, state: nextState, variants: run.variants.map((variant) => ({ ...variant, lifecycle: nextState })) }; }
