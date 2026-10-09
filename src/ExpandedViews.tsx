import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AuditEntry } from "./lib/auditLog";
import { resolveMetaCredentialValue } from "./lib/metaSettings";
import { AI_MODEL_OPTIONS, type AIAccountRegistry, type AIProvider } from "./lib/aiAccounts";
import { invoke } from "./lib/nativeRuntime";
import { canRole, clientIdForBrand, strategyCatalogScopeKey, type BrandRecord, type BrandVisualTokens, type ContentTemplate, type MembershipRecord, type WorkspaceRecord, type WorkspaceState } from "./lib/workspaceDomain";
import { resolveActiveBrandIdentity, type BrandIdentityRecord } from "./lib/brandIdentity";
import { STRATEGY_OBJECTIVE_KEYS, strategyCatalogFingerprint, validateStrategyCatalog, type BrandStrategyCatalog, type ChannelStrategyOverride, type ContentAngleDefinition, type ContentPillarDefinition, type StrategyObjectiveDefinition, type StrategyObjectiveKey } from "./lib/contentStrategy";
import { AUTOMATION_PLATFORMS, AUTOMATION_RUN_DAYS, automationAIPreferenceForRoute, automationAIOptionMatchesRoute, automationPlanCatalogReviewState, automationPlanDisplayState, automationPlanMatchesBrandScope, automationPlannerDraftKey, automationPlannerScopeForBrand, automationPlannerScopeKey, buildAutomationPlannerPreview, canApplyAutomationPlanSaveResult, campaignDateToInstant, campaignInstantToDate, canonicalizeAutomationPlanScope, createAutomationPlan, dirtyPlannerDraftForScope, getBrandKitStatus, plannerDraftForScope, plannerStrategyChoices, prepareAutomationPlanForSave, normalizePlannerStrategyPlan, reviewOnlyAutomationPlanGuard, reviseAutomationPlannerDraft, resolveAutomationAI, resolveAutomationTargetPageIdsFromBindings, selectCanonicalAutomationPlan, togglePageFacebookEnabled, validateAutomationPlan, validateAutomationPlanRoute, type AutomationAIPreference, type AutomationAIProviderSelection, type AutomationAIRoute, type AutomationPlan, type AutomationPlannerActiveScope, type AutomationPlannerDraftScope, type AutomationPlannerDraftState, type AutomationPlannerPreviewResult, type AutomationPlannerResolvedCatalogRow, type AutomationPlannerSaveResult, type AutomationPlannerSaveToken, type AutomationPlatformPlan, type AutomationStrategySelection, type PlannerStrategyChoices, type ResolvedAutomationAI, type BindingSchedule } from "./lib/automationPlanner";
import { automationSchedulerNote, buildUpcomingAutomationJobs, cronScopeKey, filterScheduledJobsForDate, localDateKey, setDailyCronForScope } from "./lib/automationScheduler";
import { isNonPublicMediaHost, localMediaPreviewUrl, localMediaThumbnailUrl, normalizeGoogleDriveMediaUrl } from "./lib/mediaAssets";
import { createDurableWorkerClient, type DurableWorkerHealth } from "./lib/workerClient";
import type { ContentKind, SocialPlatform } from "./lib/mvpContracts";
import { canReviewResearchEvidence, validateContentIntelligenceRecord, validateContentIntelligenceSelection, type ContentIntelligenceIntakeDraftPatch, type ContentIntelligenceIntakeDraftSet, type ContentIntelligenceIntakeKind, type KnowledgeItem, type PromptBlueprint, type ResearchEvidence } from "./lib/contentIntelligence";
import type { ContentTransformMode } from "./lib/contentTransform";
import { validateContentRecipe, validateContentRecipeForStrategy, type ContentRecipe } from "./lib/contentRecipe";
import type { TrendSignal } from "./lib/trendSignals";
import { searchKnowledgeItems } from "./lib/knowledgeRetrieval";
import { canUseImageProvider, canUseVideoProvider, type CreativePipelineState, type CreativeRunRecord, type ImageProvider, type VideoProvider } from "./lib/automationDomain";
import { generatedMediaHostingNextAction, mediaBlockers, mediaDistributionLabel, mediaStateBadges, plannerAssetFilter, projectStrategyCatalogForUi, resolveDraftTargetTime, resolveTargetDisplayName, shouldOpenRowFromKey, summarizeMediaAssets } from "./lib/uiPresentation";
import { providerRegistry } from "./lib/providerRegistry";
import { analyticsReadiness, preflightBlockRateByReason, reviewDecisionApprovalRate, targetPublishSuccessRate, type AnalyticsEvent } from "./lib/analyticsDomain";
import { createControlPlaneClient } from "./lib/controlPlane";
import { RevoContentStudio, type DraftActionFeedback, type DraftActionKind, type DraftActionOutcome, type RevoContentFilter, type RevoDraftPatch } from "./RevoContentStudio";
import { BetterContentIcon, BetterMetricIcon, BetterPlatformIcon, BetterProviderIcon, type BetterContentIconName, type BetterPlatformIconName } from "./lib/betterIcons";
import { contentActionItems, contentActionLabel, type ContentAction } from "./lib/contentActions";
import { brandDeleteScopeKey, isAuthoritativeBrandImpact, transitionBrandDeleteModal, type BrandDeleteModalState, type BrandDeleteOutcome, type BrandTrashPreview } from "./lib/brandTrash";

type Platform = "Facebook" | "Instagram" | "TikTok" | "YouTube";
type DraftStatus = "Needs review" | "Scheduled" | "Published" | "Failed";
type DraftLike = { id: number; title: string; topic?: string; platform: Platform; status: DraftStatus; time: string; tag: string; tone: string; color: string; body?: string; contentPillar?: string; objective?: "Reach" | "Engagement" | "Education" | "Knowledge" | "Conversion"; cta?: string; hashtags?: string[]; seoKeywords?: string[]; scheduledAt?: string; sources?: string[]; notes?: string; mediaUrl?: string; mediaPreviewUrl?: string; mediaThumbnailUrl?: string; mediaKind?: "image" | "video"; contentKind?: string; mediaAssetIds?: string[]; mediaOperation?: { kind: "image" | "video"; status: "idle" | "running" | "completed" | "blocked" | "failed"; provider?: string; reason?: string; createdAt?: string }; mediaOperations?: Array<{ kind: "image" | "video"; status: "idle" | "running" | "completed" | "blocked" | "failed"; provider?: string; reason?: string; createdAt?: string }>; qualityStatus?: "pending" | "passed" | "failed"; qualityChecks?: Array<{ key: string; label: string; ok: boolean; message?: string }>; approvalState?: "proposed" | "ready" | "scheduled" | "publishing" | "published" | "failed"; pendingPublicationIds?: string[]; strategyRationale?: string; visualConcept?: string; visualPrompt?: string; researchState?: "VERIFIED" | "REVIEW" | "NOT_SELECTED"; researchSourceCount?: number; researchScore?: number; mediaProvenance?: { source?: unknown; providerFileId?: string }; idea?: string; ideaProvider?: string; contentRunId?: string; identityVersionId?: string; generationProfileId?: string; executionMode?: "subscription_package" | "llm_provider"; providerTraceId?: string; bindingIds?: string[]; targetPageId?: string; queueJobId?: string; queueJobIds?: string[]; planId?: string; videoProvider?: string; selectedKnowledgeItemIds?: string[]; selectedResearchEvidenceIds?: string[]; promptBlueprintId?: string; recipeId?: string; transformMode?: ContentTransformMode; sourceRef?: string };
type MediaCard = { id: string | number; clientId?: string; brandId?: string; name: string; kind: "Image" | "Video" | "Audio" | "Unknown"; status: "Local" | "Ready" | "Used" | "Failed" | "Needs public URL" | "Needs review"; size: string; usage: string; color: string; publicUrl?: string; localAssetPath?: string; mimeType?: string; modifiedAt?: string; checksum?: string; visualFingerprint?: string; visualFingerprintSource?: "decoded_image" | "decoded_video_frames"; registrationMode?: "seed" | "public_url" | "google_drive" | "generated"; providerFileId?: string; reviewStatus?: "needs_review" | "verified" | "rejected"; duplicateStatus?: "unknown" | "unique" | "duplicate"; duplicateKind?: "exact" | "near"; duplicateReason?: string; usedReason?: string; reservedReason?: string; usageStatus?: "available" | "reserved" | "used"; publicUrlVerified?: boolean; archiveState?: "active" | "archived"; topic?: string; platform?: SocialPlatform; distribution?: "universal" | SocialPlatform; shared?: boolean; sharedBrandIds?: string[]; campaignId?: string; provenance?: { source: "google_drive" | "public_https" | "local" | "generated"; providerFileId?: string; importedAt?: string }; hierarchy?: { clientId: string; brandId: string; platform: SocialPlatform; date: string; contentRunId: string; relativePath: string } };
type RegisterAssetInput = { name: string; kind: MediaCard["kind"]; publicUrl: string; localAssetPath?: string; checksum?: string; visualFingerprint?: string };
type QueueJobLike = { id: string; variantId: string; connectionId: string; bindingId?: string; scheduledAt: string; state: string; attempts: number };

export type StrategyCatalogEdit =
  | { type: "set-objective"; key: StrategyObjectiveKey; patch: Partial<Omit<StrategyObjectiveDefinition, "key">> }
  | { type: "add-objective"; item: StrategyObjectiveDefinition }
  | { type: "remove-objective"; key: StrategyObjectiveKey }
  | { type: "move-objective"; key: StrategyObjectiveKey; direction: "up" | "down" }
  | { type: "set-pillar"; id: string; patch: Partial<Omit<ContentPillarDefinition, "id" | "angles">> }
  | { type: "add-pillar"; item: ContentPillarDefinition }
  | { type: "remove-pillar"; id: string }
  | { type: "move-pillar"; id: string; direction: "up" | "down" }
  | { type: "set-angle"; pillarId: string; id: string; patch: Partial<Omit<ContentAngleDefinition, "id">> }
  | { type: "add-angle"; pillarId: string; item: ContentAngleDefinition }
  | { type: "remove-angle"; pillarId: string; id: string }
  | { type: "move-angle"; pillarId: string; id: string; direction: "up" | "down" }
  | { type: "toggle-pillar-channel"; pillarId: string; channel: SocialPlatform }
  | { type: "toggle-angle-channel"; pillarId: string; id: string; channel: SocialPlatform }
  | { type: "update-override"; channel: SocialPlatform; patch: Partial<ChannelStrategyOverride> };

export type StrategyCatalogSaveResult = { currentScope: boolean; acknowledged?: boolean; catalog?: BrandStrategyCatalog; revision?: number; fingerprint?: string; error?: string };

export type StrategyCatalogPanelSaveState = {
  phase: "idle" | "pending" | "success" | "rejected";
  scopeKey: string;
  revision: number;
  capturedFingerprint: string;
  draft: BrandStrategyCatalog;
  error?: string;
};

export function beginStrategyCatalogPanelSave(catalog: BrandStrategyCatalog, scopeKey: string, revision: number): StrategyCatalogPanelSaveState {
  const validation = validateStrategyCatalog(catalog);
  const capturedFingerprint = strategyCatalogFingerprint(catalog);
  if (!validation.ok) return { phase: "rejected", scopeKey, revision, capturedFingerprint, draft: structuredClone(catalog), error: validation.errors.join(" · ") };
  return { phase: "pending", scopeKey, revision, capturedFingerprint, draft: structuredClone(catalog) };
}

function isSafeCatalogRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function canReloadStrategyCatalogPanel(state: Pick<BrandStrategyPanelControllerState, "catalogLoading" | "externalPending" | "dirty" | "localPending">, hasReloadHandler: boolean): boolean {
  return hasReloadHandler && !state.catalogLoading && !state.localPending && !state.externalPending && !state.dirty;
}

export function settleStrategyCatalogPanelSave(state: StrategyCatalogPanelSaveState, result: StrategyCatalogSaveResult, currentScopeKey: string, currentRevision: number): StrategyCatalogPanelSaveState {
  if (state.phase !== "pending" || state.scopeKey !== currentScopeKey || state.revision !== currentRevision) return state;
  if (strategyCatalogFingerprint(state.draft) !== state.capturedFingerprint) return { ...state, phase: "rejected", error: "STRATEGY_CATALOG_REQUEST_FINGERPRINT_MISMATCH" };
  if (result.acknowledged === true && result.revision === undefined) return { ...state, phase: "rejected", error: "STRATEGY_CATALOG_ACK_REVISION_MISSING" };
  if (result.acknowledged === true && !isSafeCatalogRevision(result.revision)) return { ...state, phase: "rejected", error: "STRATEGY_CATALOG_ACK_REVISION_INVALID" };
  if (result.revision !== undefined && isSafeCatalogRevision(result.revision) && result.revision !== state.revision + 1) return state;
  const expectedAckCatalog = { ...state.draft, version: state.draft.version + 1 };
  if (result.currentScope !== true || result.acknowledged !== true || !result.catalog || result.catalog.brandId !== state.draft.brandId || !isSafeCatalogRevision(result.catalog.version) || result.catalog.version !== expectedAckCatalog.version || result.fingerprint !== strategyCatalogFingerprint(expectedAckCatalog) || result.fingerprint !== strategyCatalogFingerprint(result.catalog) || !validateStrategyCatalog(result.catalog).ok) {
    return { ...state, phase: "rejected", error: result.error ?? "Control Plane chưa xác nhận catalog." };
  }
  return { phase: "success", scopeKey: state.scopeKey, revision: result.revision ?? state.revision + 1, capturedFingerprint: result.fingerprint ?? strategyCatalogFingerprint(result.catalog), draft: structuredClone(result.catalog) };
}

export type StrategyCatalogHydrationAction = "wait" | "hydrate" | "preserve";

export function resolveStrategyCatalogHydrationAction(input: { scopeChanged: boolean; catalogLoading: boolean; dirty: boolean; hasDraft: boolean; hasCanonicalCatalog: boolean }): StrategyCatalogHydrationAction {
  if (input.scopeChanged) return "hydrate";
  if (input.catalogLoading) return input.dirty && input.hasDraft ? "preserve" : "wait";
  if (input.dirty && input.hasDraft) return "preserve";
  return input.hasCanonicalCatalog ? "hydrate" : "preserve";
}

export function handleStrategyCatalogEscape(event: { key: string; preventDefault: () => void }, heading: Pick<HTMLElement, "isConnected" | "focus"> | null, panel: Pick<HTMLElement, "isConnected" | "focus"> | null): boolean {
  if (event.key !== "Escape") return false;
  event.preventDefault();
  const target = heading?.isConnected ? heading : panel?.isConnected ? panel : undefined;
  target?.focus();
  return true;
}

export function brandStrategyCanManage(brand: Pick<BrandRecord, "clientId" | "workspaceId">, memberships: readonly MembershipRecord[], userId?: string): boolean {
  if (!userId) return false;
  const membership = memberships.find((candidate) => candidate.workspaceId === clientIdForBrand(brand) && candidate.userId === userId && candidate.status === "active");
  return Boolean(membership && canRole(membership.role, "manage_brand"));
}

function moveStrategyItem<T extends { order: number }>(items: readonly T[], id: string, getId: (item: T) => string, direction: "up" | "down"): T[] {
  const next = [...items].sort((left, right) => left.order - right.order);
  const index = next.findIndex((item) => getId(item) === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= next.length) return next.map((item, itemIndex) => ({ ...item, order: itemIndex + 1 }));
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next.map((item, itemIndex) => ({ ...item, order: itemIndex + 1 }));
}

function toggleStrategyChannel(channels: readonly SocialPlatform[], channel: SocialPlatform): SocialPlatform[] {
  const next = new Set(channels);
  if (next.has(channel)) next.delete(channel); else next.add(channel);
  return ["facebook", "instagram", "tiktok", "youtube"].filter((item): item is SocialPlatform => next.has(item as SocialPlatform));
}

export function applyStrategyCatalogEdit(catalog: BrandStrategyCatalog, edit: StrategyCatalogEdit, now = new Date()): BrandStrategyCatalog {
  if (!validateStrategyCatalog(catalog).ok) return structuredClone(catalog);
  const next = structuredClone(catalog);
  switch (edit.type) {
    case "set-objective":
      next.objectives = next.objectives.map((item) => item.key === edit.key ? { ...item, ...structuredClone(edit.patch) } : item);
      break;
    case "add-objective":
      if (!next.objectives.some((item) => item.key === edit.item.key)) next.objectives = [...next.objectives, structuredClone(edit.item)].map((item, index) => ({ ...item, order: index + 1 }));
      break;
    case "remove-objective":
      next.objectives = next.objectives.filter((item) => item.key !== edit.key).map((item, index) => ({ ...item, order: index + 1 }));
      break;
    case "move-objective":
      next.objectives = moveStrategyItem(next.objectives, edit.key, (item) => item.key, edit.direction);
      break;
    case "set-pillar":
      next.pillars = next.pillars.map((item) => item.id === edit.id ? { ...item, ...structuredClone(edit.patch) } : item);
      break;
    case "add-pillar":
      if (!next.pillars.some((item) => item.id === edit.item.id)) next.pillars = [...next.pillars, structuredClone(edit.item)].map((item, index) => ({ ...item, order: index + 1 }));
      break;
    case "remove-pillar":
      next.pillars = next.pillars.filter((item) => item.id !== edit.id).map((item, index) => ({ ...item, order: index + 1 }));
      break;
    case "move-pillar":
      next.pillars = moveStrategyItem(next.pillars, edit.id, (item) => item.id, edit.direction);
      break;
    case "set-angle":
      next.pillars = next.pillars.map((pillar) => pillar.id === edit.pillarId ? { ...pillar, angles: pillar.angles.map((item) => item.id === edit.id ? { ...item, ...structuredClone(edit.patch) } : item) } : pillar);
      break;
    case "add-angle":
      next.pillars = next.pillars.map((pillar) => pillar.id === edit.pillarId && !pillar.angles.some((item) => item.id === edit.item.id) ? { ...pillar, angles: [...pillar.angles, structuredClone(edit.item)].map((item, index) => ({ ...item, order: index + 1 })) } : pillar);
      break;
    case "remove-angle":
      next.pillars = next.pillars.map((pillar) => pillar.id === edit.pillarId ? { ...pillar, angles: pillar.angles.filter((item) => item.id !== edit.id).map((item, index) => ({ ...item, order: index + 1 })) } : pillar);
      break;
    case "move-angle":
      next.pillars = next.pillars.map((pillar) => pillar.id === edit.pillarId ? { ...pillar, angles: moveStrategyItem(pillar.angles, edit.id, (item) => item.id, edit.direction) } : pillar);
      break;
    case "toggle-pillar-channel":
      next.pillars = next.pillars.map((pillar) => pillar.id === edit.pillarId ? { ...pillar, channels: toggleStrategyChannel(pillar.channels, edit.channel) } : pillar);
      break;
    case "toggle-angle-channel":
      next.pillars = next.pillars.map((pillar) => pillar.id === edit.pillarId ? { ...pillar, angles: pillar.angles.map((item) => item.id === edit.id ? { ...item, channels: toggleStrategyChannel(item.channels, edit.channel) } : item) } : pillar);
      break;
    case "update-override":
      next.channelOverrides[edit.channel] = { ...(next.channelOverrides[edit.channel] ?? {}), ...structuredClone(edit.patch) };
      break;
  }
  if (["remove-objective", "remove-pillar", "remove-angle"].includes(edit.type) && !validateStrategyCatalog(next).ok) return structuredClone(catalog);
  next.updatedAt = now.toISOString();
  return next;
}

export function contentIntelligenceRecordsForScope<
  Knowledge extends { clientId: string; brandId: string },
  Evidence extends { clientId: string; brandId?: string | null },
  Blueprint extends { brandId: string },
  Recipe extends { brandId: string },
  Trend extends { clientId: string },
>(input: { clientId: string; brandId: string; knowledgeItems: Knowledge[]; researchEvidence: Evidence[]; promptBlueprints: Blueprint[]; contentRecipes: Recipe[]; trendSignals: Trend[] }) {
  return {
    knowledgeItems: input.knowledgeItems.filter((item) => item.clientId === input.clientId && item.brandId === input.brandId),
    researchEvidence: input.researchEvidence.filter((item) => item.clientId === input.clientId && (!item.brandId || item.brandId === input.brandId)),
    promptBlueprints: input.promptBlueprints.filter((item) => item.brandId === input.brandId),
    contentRecipes: input.contentRecipes.filter((item) => item.brandId === input.brandId),
    trendSignals: input.trendSignals.filter((item) => item.clientId === input.clientId),
  };
}

export function canInteractWithUpcomingJobs(planSavePending: boolean): boolean {
  return !planSavePending;
}

export type AutomationPlannerModalMode = "create" | "edit";
export type AutomationPlannerModalState = {
  mode: AutomationPlannerModalMode;
  planId: string;
  draftKey: string;
  scopeKey: string;
  originPlanId?: string;
};

export function createAutomationPlannerModalState(activeScope: AutomationPlannerActiveScope, mode: AutomationPlannerModalMode, plan: Pick<AutomationPlan, "id">, originPlanId?: string): AutomationPlannerModalState {
  const scope = { ...activeScope, planId: plan.id };
  return { mode, planId: plan.id, draftKey: automationPlannerDraftKey(scope), scopeKey: automationPlannerScopeKey(activeScope), originPlanId };
}

export function automationPlannerModalCancel(modal: Pick<AutomationPlannerModalState, "draftKey" | "originPlanId">, fallbackPlanId?: string): { draftKey: string; restorePlanId: string; removeDraft: true } {
  return { draftKey: modal.draftKey, restorePlanId: modal.originPlanId ?? fallbackPlanId ?? "", removeDraft: true };
}

export function projectAutomationPlannerModal(plan: AutomationPlan) {
  const copyPlatformPlan = (item: AutomationPlatformPlan) => ({ ...item, publishTimes: [...item.publishTimes], runDays: [...(item.runDays ?? AUTOMATION_RUN_DAYS)] });
  return {
    planId: plan.id,
    metadata: { name: plan.name ?? "", objectiveMode: plan.objectiveMode ?? "Education", contentPillar: plan.contentPillar ?? "", angle: plan.angle ?? "", campaignStartAt: plan.campaignStartAt, campaignEndAt: plan.campaignEndAt },
    strategy: { selection: structuredClone(plan.strategySelection ?? plan.strategySnapshot?.selection ?? { objective: "mix", pillar: "mix", angle: "mix" }), snapshot: plan.strategySnapshot ? structuredClone(plan.strategySnapshot) : undefined },
    scope: { selectedAssetIds: [...(plan.selectedAssetIds ?? [])], targetPageIds: [...(plan.targetPageIds ?? [])], bindingIds: [...(plan.bindingIds ?? [])] },
    cadence: {
      cron: { ...plan.cron },
      platforms: AUTOMATION_PLATFORMS.map((platform) => ({ platform, plan: copyPlatformPlan(plan.platforms[platform]) })),
      pagePlans: Object.entries(plan.pagePlans ?? {}).map(([pageId, pagePlan]) => ({ pageId, facebook: copyPlatformPlan(pagePlan.facebook) })),
    },
  };
}

export function updateAutomationPlannerModalDraft(
  activeScope: AutomationPlannerActiveScope,
  currentDraft: AutomationPlannerDraftState | undefined,
  nextPlan: AutomationPlan,
  patch: Partial<Omit<AutomationPlannerDraftState, "scope" | "editRevision" | "plan">> = {},
): { draftKey: string; draft: AutomationPlannerDraftState } {
  const scope = { ...activeScope, planId: nextPlan.id };
  const draftKey = automationPlannerDraftKey(scope);
  const base = currentDraft ?? { scope, plan: nextPlan, dirty: false, editingJobId: "", editingTime: "", editRevision: 0 };
  return { draftKey, draft: reviseAutomationPlannerDraft(base, { ...patch, plan: nextPlan }) };
}

export type AutomationPlannerModalSavePhase = "idle" | "pending" | "failure" | "success";
export type AutomationPlannerModalSaveState = {
  phase: AutomationPlannerModalSavePhase;
  canClose: boolean;
  notice?: string;
  payload?: { plan: AutomationPlan; token: AutomationPlannerSaveToken };
};
export type AutomationPlannerModalSaveEvent =
  | { type: "begin"; plan: AutomationPlan; token: AutomationPlannerSaveToken; notice: string }
  | { type: "failure"; notice: string }
  | { type: "success"; notice: string };

export function transitionAutomationPlannerModalSave(state: AutomationPlannerModalSaveState, event: AutomationPlannerModalSaveEvent): AutomationPlannerModalSaveState {
  if (event.type === "begin") return { phase: "pending", canClose: false, notice: event.notice, payload: { plan: event.plan, token: event.token } };
  if (event.type === "failure") return { ...state, phase: "failure", canClose: true, notice: event.notice };
  return { ...state, phase: "success", canClose: true, notice: event.notice };
}

export function canCloseAutomationPlannerModal(phase: AutomationPlannerModalSavePhase): boolean {
  return phase !== "pending";
}

function trapDialogTab(event: ReactKeyboardEvent<HTMLElement>, dialog: HTMLElement | null): void {
  if (event.key !== "Tab") return;
  const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
    .filter((element) => element.getAttribute("aria-hidden") !== "true");
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) { event.preventDefault(); dialog?.focus(); }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export type BrandDeleteModalController = {
  open: (brandId: string, opener: HTMLButtonElement | null) => boolean;
  input: (confirmation: string) => void;
  cancel: () => boolean;
  backdrop: (isBackdropTarget: boolean) => boolean;
  close: (force?: boolean) => boolean;
  confirm: () => Promise<boolean | BrandDeleteOutcome | undefined>;
  keyDown: (event: ReactKeyboardEvent<HTMLElement>, dialog: HTMLElement | null) => void;
};

export function createBrandDeleteModalController(input: {
  getState: () => BrandDeleteModalState;
  setState: (state: BrandDeleteModalState) => void;
  requestVersionRef: { current: number };
  openerRef: { current: HTMLButtonElement | null };
  fallbackRef: { current: HTMLElement | null };
  isBusy?: () => boolean;
  canConfirm?: () => boolean;
  getExpectedBrandName?: () => string | undefined;
  onConfirm?: (brandId: string, confirmation: string) => Promise<boolean | BrandDeleteOutcome | undefined>;
  onFeedback?: (message: string) => void;
  scheduleFocus?: (callback: () => void) => void;
}): BrandDeleteModalController {
  const scheduleFocus = input.scheduleFocus ?? ((callback: () => void) => {
    if (typeof window === "undefined") callback();
    else window.requestAnimationFrame(callback);
  });
  const apply = (state: BrandDeleteModalState) => {
    input.requestVersionRef.current = state.requestVersion;
    input.setState(state);
  };
  const focusAfterClose = (target: "opener" | "fallback") => scheduleFocus(() => {
    if (target === "opener" && input.openerRef.current?.isConnected) input.openerRef.current.focus();
    else input.fallbackRef.current?.focus();
  });
  const close = (force = false): boolean => {
    const current = input.getState();
    const transition = transitionBrandDeleteModal(force ? { ...current, pending: false } : current, { type: "close", openerConnected: Boolean(input.openerRef.current?.isConnected) });
    if (transition.state.pending) return false;
    apply(transition.state);
    input.onFeedback?.("");
    if (transition.focusTarget) focusAfterClose(transition.focusTarget);
    return true;
  };
  const open = (brandId: string, opener: HTMLButtonElement | null): boolean => {
    if (input.isBusy?.()) return false;
    input.openerRef.current = opener;
    const transition = transitionBrandDeleteModal(input.getState(), { type: "open", brandId });
    apply(transition.state);
    return true;
  };
  const confirm = async (): Promise<boolean | BrandDeleteOutcome | undefined> => {
    if (input.isBusy?.() || input.canConfirm?.() === false) return undefined;
    const begin = transitionBrandDeleteModal(input.getState(), { type: "begin", expectedBrandId: input.getState().brandId ?? "", expectedBrandName: input.getExpectedBrandName?.() ?? input.getState().confirmation });
    if (!begin.dispatch || !input.onConfirm) return undefined;
    apply(begin.state);
    const requestVersion = begin.dispatch.requestVersion;
    const requestedBrandId = begin.dispatch.brandId;
    try {
      const result = await input.onConfirm(requestedBrandId, begin.dispatch.confirmation);
      if (requestVersion !== input.requestVersionRef.current || input.getState().brandId !== requestedBrandId) return result;
      const outcome = result && typeof result === "object" ? result : undefined;
      if (result === true || outcome?.status === "acknowledged") close(true);
      else {
        apply({ ...input.getState(), pending: false });
        input.onFeedback?.(outcome?.status === "unknown" ? "Chưa xác định kết quả; cần đối soát trước khi thử lại." : "Control Plane chưa xác nhận xóa; dữ liệu cục bộ vẫn được giữ.");
      }
      return result;
    } catch (error) {
      if (requestVersion !== input.requestVersionRef.current || input.getState().brandId !== requestedBrandId) return undefined;
      apply({ ...input.getState(), pending: false });
      input.onFeedback?.(error instanceof Error ? error.message : "Chưa xác định kết quả; cần đối soát trước khi thử lại.");
      return undefined;
    }
  };
  const keyDown = (event: ReactKeyboardEvent<HTMLElement>, dialog: HTMLElement | null) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!input.isBusy?.()) close();
      return;
    }
    trapDialogTab(event, dialog);
  };
  const inputValue = (confirmation: string) => apply(transitionBrandDeleteModal(input.getState(), { type: "input", confirmation }).state);
  const cancel = () => close();
  const backdrop = (isBackdropTarget: boolean) => isBackdropTarget ? close() : false;
  return { open, input: inputValue, cancel, backdrop, close, confirm, keyDown };
}

type Props = {
  activeNav: string;
  drafts: DraftLike[];
  assets: MediaCard[];
  queueJobs: QueueJobLike[];
  reviewCount: number;
  liveReadiness: "ready" | "blocked";
  autoRunDueJobs: boolean;
  onAutoRunDueJobsChange: (value: boolean) => void;
  brandVoice: string;
  brandVisualTokens: BrandVisualTokens;
  savedNotice: string;
  workspaceState: WorkspaceState;
  activeWorkspace: WorkspaceRecord;
  activeBrand: BrandRecord;
  activeBrandId?: string;
  activeUserId?: string;
  currentMembership?: MembershipRecord;
  draftActionFeedbackByDraftId?: Record<number, Partial<Record<DraftActionKind, DraftActionFeedback>>>;
  publishBlockersByDraftId?: Record<number, string | undefined>;
  onActiveActionDraftChange?: (draftId: number | undefined) => void;
  templates: ContentTemplate[];
  auditEntries: AuditEntry[];
  analyticsEvents?: AnalyticsEvent[];
  targetPublications?: Array<{ clientId: string; brandId: string; state: string; platform?: string; bindingId?: string; terminalAt?: string; providerJobId?: string; legacyNonLive?: boolean }>;
  analyticsDataAsOf?: string | null;
  analyticsWorkerReconciledAt?: string | null;
  onOpenComposer: () => void;
  inlineContentGenerating?: boolean;
  focusDraftId?: number;
  generationError?: string;
  onOpenReview?: () => void;
  onSelect: (nav: string) => void;
  onApprove: (id: number) => Promise<DraftActionOutcome>;
  onReject: (id: number) => void;
  onExportManualPackage: (id: number) => void;
  onUpdateDraft?: (id: number, patch: RevoDraftPatch) => void | Promise<void>;
  onQualityCheck: (id: number) => Promise<DraftActionOutcome>;
  onGenerateMedia?: (id: number, kind: "image" | "video") => void | Promise<void>;
  onCopyDraft?: (id: number) => void | Promise<void>;
  onPublishDraft?: (id: number) => Promise<DraftActionOutcome>;
  onTelegramDraft?: (id: number) => void | Promise<void>;
  onRegenerateDraft?: (id: number) => void | Promise<void>;
  onRestoreRevision?: (id: number, revisionId: string) => void | Promise<void>;
  onDeleteDraft?: (id: number) => void | Promise<void>;
  onRefreshContent?: () => void | Promise<void>;
  contentStudioFilter?: RevoContentFilter;
  dashboardCalendarDate?: string;
  targetConnectionTargets?: Array<{ id: string; platform: SocialPlatform; name: string; state: string }>;
  connectionDisplayNames?: Record<string, string>;
  brandIdentitiesForBinding?: BrandIdentityRecord[];
  channelBindingsForBinding?: Array<{ targetExternalId: string; identityId: string }>;
  onSaveTargetBindings?: (targetIds: string[], identityByTarget: Record<string, string>) => void;
  onBeginConnection?: (platform: SocialPlatform) => void | Promise<void>;
  settingsSection?: "safety" | "bindings" | "ai" | "meta" | "workspace";
  onAddAsset: (input?: RegisterAssetInput) => void;
  onImportLocalImage: (file: File) => Promise<void>;
  mediaImportBusy: boolean;
  mediaImportNotice: string;
  onVerifyAsset: (assetId: string | number, input: { publicUrl: string; sha256: string; visualFingerprint: string }) => void;
  onSyncDriveInventory: () => Promise<void>;
  driveInventorySyncBusy: boolean;
  onAnalyzeDriveAsset: (assetId: string | number) => Promise<void>;
  onAnalyzeLocalAsset: (assetId: string | number) => Promise<void>;
  onUploadAssetToDrive: (assetId: string | number) => Promise<void>;
  onMakeDrivePublic: (assetId: string | number) => Promise<void>;
  onArchiveAsset: (assetId: string | number) => void;
  onRestoreAsset: (assetId: string | number) => void;
  onBrandVoiceChange: (value: string) => void;
  onBrandVisualTokensChange: (value: BrandVisualTokens) => void;
  onSaveBrand: () => void;
  onBrandIdentityChange?: (identity: BrandIdentityRecord) => void;
  strategyCatalog?: BrandStrategyCatalog;
  strategyCatalogRevision?: number;
  strategyCatalogLoading?: boolean;
  strategyCatalogError?: string;
  onSaveStrategyCatalog?: (catalog: BrandStrategyCatalog, scopeKey: string, capturedRevision: number) => Promise<StrategyCatalogSaveResult>;
  onReloadStrategyCatalog?: () => void | Promise<void>;
  brands?: BrandRecord[];
  brandTrashPreviews?: Record<string, BrandTrashPreview>;
  brandImpactLoading?: Record<string, boolean>;
  brandImpactErrors?: Record<string, string | undefined>;
  brandDeleteStates?: Record<string, { status: "pending" | "reconciling" | "unknown"; requestId: string; message: string }>;
  onLoadBrandTrashPreview?: (brandId: string) => void | Promise<boolean>;
  onTrashBrand?: (brandId: string) => void;
  onRestoreBrand?: (brandId: string) => void | Promise<BrandDeleteOutcome>;
  onPermanentlyDeleteBrand?: (brandId: string, confirmation: string) => void | Promise<boolean | BrandDeleteOutcome>;
  onReschedule: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  onDraftTargetAction?: (draftId: number, action: "reschedule" | "cancel") => void;
  onExportDiagnostics: () => void;
  onExportMigrationBackup?: () => void;
  onExportReport: () => void;
  onUseTemplate: (template: ContentTemplate) => void;
  onAddTemplate: () => void;
  metaAppId: string;
  metaSecretConfigured: boolean;
  metaAccessTokenConfigured: boolean;
  metaAccountHints: Array<{ id: string; name?: string; kind?: string }>;
  metaSelectedPageId: string;
  metaSettingsNotice: string;
  metaDiscoveryBusy: boolean;
  metaTokenExchangeBusy: boolean;
  onSaveMetaConfiguration: (input: { appId: string; appSecret: string; accessToken: string }) => void;
  onDiscoverMetaConfiguration: () => void;
  onExchangeMetaToken: () => void;
  onSelectMetaPage: (pageId: string) => void;
  aiAccounts: AIAccountRegistry;
  aiSettingsNotice: string;
  onSaveAIProviderKey: (input: { provider: AIProvider; apiKey: string; model: string }) => void;
  onOpenAIProviderAccount: (provider: AIProvider) => void;
  onClearAIProvider: (provider: AIProvider) => void;
  onUpdateAIModel: (provider: AIProvider, model: string) => void;
  automationPlans: AutomationPlan[];
  profileId: string;
  profileRevision: number;
  plannerScopeGeneration: number;
  automationPlannerDrafts: Record<string, AutomationPlannerDraftState>;
  automationPlannerSelections: Record<string, string>;
  onPlannerDraftChange: (draftKey: string, draft: AutomationPlannerDraftState | undefined, generation: number) => void;
  onPlannerSelectionChange: (scopeKey: string, planId: string, generation: number) => void;
  onBeginPlannerSave: (draftKey: string, generation: number) => number | undefined;
  automationAI: AutomationAIPreference;
  automationAIResolution: ResolvedAutomationAI;
  onAutomationAIChange: (value: AutomationAIPreference) => void;
  creativeRuns: CreativeRunRecord[];
  imageProvider: ImageProvider;
  onImageProviderChange: (provider: ImageProvider) => void;
  videoProvider: VideoProvider;
  onVideoProviderChange: (provider: VideoProvider) => void;
  onRetryCreativeRun: (runId: string) => void;
  onSaveProviderConfiguration: (input: { providerKind: string; model: string; baseUrl?: string; projectId?: string; location?: string; secretRef: string }) => Promise<void>;
  onProbeProviderConfiguration: (providerKind: string, operatorApproved?: boolean) => Promise<void>;
  providerConfigurationNotice: string;
  onSaveAutomationPlan: (plan: AutomationPlan, token: AutomationPlannerSaveToken) => Promise<AutomationPlannerSaveResult>;
  onRunReviewOnlyAutomationPlan: (scope: AutomationPlannerDraftScope) => Promise<void>;
  plannerRunBusy: boolean;
  knowledgeItems: KnowledgeItem[];
  researchEvidence: ResearchEvidence[];
  promptBlueprints: PromptBlueprint[];
  contentRecipes?: ContentRecipe[];
  selectedKnowledgeItemIds: string[];
  selectedResearchEvidenceIds: string[];
  selectedPromptBlueprintId: string;
  selectedRecipeId?: string;
  transformMode: ContentTransformMode;
  intakeDrafts: ContentIntelligenceIntakeDraftSet;
  onIntakeDraftChange: <K extends ContentIntelligenceIntakeKind>(kind: K, patch: ContentIntelligenceIntakeDraftPatch<K>) => void;
  onKnowledgeSelectionChange: (ids: string[]) => void;
  onResearchSelectionChange: (ids: string[]) => void;
  onPromptBlueprintChange: (id: string) => void;
  onRecipeChange?: (id: string) => void;
  onTransformModeChange: (mode: ContentTransformMode) => void;
  onCreateResearchEvidence: (input: { sourceUrl: string; sourceTitle: string; retrievedAt: string; summary: string; sourceType?: "operator_selected" | "manual_entry"; rightsState: "user_owned" | "licensed" }, revision: number) => Promise<boolean>;
  onCreateKnowledgeItem?: (input: { title: string; text: string; provenance: string; rightsState: "user_owned" | "licensed" }, revision: number) => Promise<boolean>;
  onCreateTrendSignal?: (input: { source: string; topic: string; metric: string; evidenceIds: string[] }, revision: number) => Promise<boolean>;
  onApproveResearchEvidence: (id: string) => Promise<boolean>;
  trendSignals?: TrendSignal[];
};

const platformMeta: Record<Platform, { className: string; icon: BetterPlatformIconName }> = { Facebook: { className: "facebook", icon: "facebook" }, Instagram: { className: "instagram", icon: "instagram" }, TikTok: { className: "tiktok", icon: "tiktok" }, YouTube: { className: "youtube", icon: "youtube" } };
function PlatformMark({ platform }: { platform: Platform }) { const meta = platformMeta[platform]; return <span className={`platform-mark ${meta.className}`}><BetterPlatformIcon name={meta.icon} /></span>; }
function StatusPill({ status }: { status: DraftStatus }) { return <span className={`status-pill ${status.toLowerCase().replace(/\s+/g, "-")}`}>{status}</span>; }
function contentIconName(draft: Pick<DraftLike, "contentKind" | "mediaKind" | "tag" | "title">): BetterContentIconName { const descriptor = `${draft.contentKind ?? ""} ${draft.mediaKind ?? ""} ${draft.tag} ${draft.title}`.toLowerCase(); if (/ai generated|generated by ai|ai draft/.test(`${draft.tag} ${draft.title}`.toLowerCase())) return "sparkles"; if (/video|clip|reel|short video/.test(descriptor)) return "video"; if (/image|photo|picture|ảnh/.test(descriptor)) return "image"; return "sparkles"; }
function PanelHeading({ kicker, title, action, onAction }: { kicker: string; title: string; action?: string; onAction?: () => void }) { return <div className="panel-heading"><div><p className="panel-kicker">{kicker}</p><h2>{title}</h2></div>{action && <button className="text-button" onClick={onAction}>{action} <span>↗</span></button>}</div>; }
function ViewHeader({ kicker, title, subtitle, action, onAction }: { kicker: string; title: string; subtitle: string; action?: string; onAction?: () => void }) { return <div className="view-header"><div><p className="eyebrow">{kicker}</p><h1>{title}</h1><p className="hero-subtitle">{subtitle}</p></div>{action && <button className="primary-button" onClick={onAction}>{action}</button>}</div>; }

export function resolveContentTableTargetAction(draft: Pick<DraftLike, "queueJobId" | "queueJobIds">): { mode: "draft" | "job" | "unavailable"; jobId?: string } {
  const queueJobIds = draft.queueJobIds?.length ? draft.queueJobIds : draft.queueJobId ? [draft.queueJobId] : [];
  if (queueJobIds.length > 1) return { mode: "draft" };
  if (queueJobIds.length === 1) return { mode: "job", jobId: queueJobIds[0] };
  return { mode: "unavailable" };
}

export function dispatchContentTableTargetAction(draft: Pick<DraftLike, "id" | "queueJobId" | "queueJobIds">, action: "reschedule" | "cancel_schedule", callbacks: { onDraftTargetAction?: Props["onDraftTargetAction"]; onReschedule?: (jobId: string) => void; onCancel?: (jobId: string) => void }): "draft" | "job" | "unavailable" {
  const targetAction = resolveContentTableTargetAction(draft);
  if (targetAction.mode === "draft") callbacks.onDraftTargetAction?.(draft.id, action === "cancel_schedule" ? "cancel" : "reschedule");
  else if (targetAction.mode === "job") (action === "cancel_schedule" ? callbacks.onCancel : callbacks.onReschedule)?.(targetAction.jobId!);
  return targetAction.mode;
}

function ContentTable({ drafts, onApprove, onReject, onExportManualPackage, onRegenerate, onDelete, onPublish, onReschedule, onCancel, onDraftTargetAction, connectionDisplayNames = {}, detailed = false, canApprove = true, actionFeedbackByDraftId = {}, publishBlockersByDraftId = {} }: { drafts: DraftLike[]; onApprove: (id: number) => Promise<DraftActionOutcome>; onReject?: (id: number) => void; onExportManualPackage: (id: number) => void; onRegenerate?: (id: number) => void | Promise<void>; onDelete?: (id: number) => void | Promise<void>; onPublish?: (id: number) => Promise<DraftActionOutcome>; onReschedule?: (jobId: string) => void; onCancel?: (jobId: string) => void; onDraftTargetAction?: Props["onDraftTargetAction"]; connectionDisplayNames?: Props["connectionDisplayNames"]; detailed?: boolean; canApprove?: boolean; actionFeedbackByDraftId?: Props["draftActionFeedbackByDraftId"]; publishBlockersByDraftId?: Props["publishBlockersByDraftId"] }) {
  const [openMenuId, setOpenMenuId] = useState<number | undefined>();
  const menuTriggersRef = useRef(new Map<number, HTMLButtonElement>());
  const closeMenu = (draftId: number) => {
    setOpenMenuId(undefined);
    window.requestAnimationFrame(() => menuTriggersRef.current.get(draftId)?.focus());
  };
  const runAction = (action: ContentAction, draft: DraftLike) => {
    setOpenMenuId(undefined);
    if (action === "approve") return onApprove(draft.id);
    if (action === "regenerate_copy") return onRegenerate?.(draft.id);
    if (action === "delete") return onDelete?.(draft.id);
    if (action === "publish_now") return onPublish?.(draft.id);
    if (action === "reschedule" || action === "cancel_schedule") return dispatchContentTableTargetAction(draft, action, { onDraftTargetAction, onReschedule, onCancel });
    return undefined;
  };
  return <div className="content-table expanded-content-table"><div className="table-row table-head"><span>CONTENT</span><span>CHANNEL</span><span>STATUS</span><span>DATE</span><span /></div>{drafts.length === 0 && <div className="empty-state">No content matches this filter.</div>}{drafts.map((draft) => {
    const actions = contentActionItems(draft.status);
    const feedback = actionFeedbackByDraftId[draft.id] ?? {};
    const publishBlocker = publishBlockersByDraftId[draft.id];
    const locked = Boolean(draft.pendingPublicationIds?.length || [feedback.quality, feedback.approval, feedback.publish].some((item) => item?.status === "running" || item?.status === "pending"));
    const publishLocked = Boolean([feedback.quality, feedback.approval, feedback.publish].some((item) => item?.status === "running" || item?.status === "pending") || (draft.pendingPublicationIds?.length && publishBlocker));
    const approvalDenied = !canApprove;
    const anyFeedback = (["quality", "approval", "publish"] as const).some((action) => Boolean(feedback[action]));
    return <div className="table-row" data-review-id={draft.id} key={draft.id} role={detailed ? "button" : undefined} tabIndex={detailed ? 0 : undefined} onKeyDown={detailed ? (event) => { if (shouldOpenRowFromKey(event.key, event.target, event.currentTarget)) { event.preventDefault(); event.currentTarget.click(); } } : undefined}>
      <div className="content-cell"><div className="content-thumb" style={{ background: draft.color }}><BetterContentIcon name={contentIconName(draft)} /></div><div><strong>{draft.title}</strong><span>{draft.tag} · {draft.tone}</span>{draft.idea && <small className="creative-idea" title={draft.idea}>Idea: {draft.idea.slice(0, 140)}{draft.idea.length > 140 ? "…" : ""}</small>}{detailed && <small>Preflight: approval gate, channel capability and idempotency check.</small>}{approvalDenied && draft.status === "Needs review" && <small role="status">View-only · approve_content permission required.</small>}{generatedMediaHostingNextAction({ provenanceSource: draft.mediaProvenance?.source, publicUrl: draft.mediaUrl }) && <small className="generated-media-next-action" role="status">{generatedMediaHostingNextAction({ provenanceSource: draft.mediaProvenance?.source, publicUrl: draft.mediaUrl })}</small>}{publishBlocker && <small className="publish-blocker" role="status">{publishBlocker}</small>}{anyFeedback && <small className="draft-action-feedback" role={Object.values(feedback).some((item) => item?.status === "failure") ? "alert" : "status"}>{(["quality", "approval", "publish"] as const).flatMap((action) => feedback[action] ? [`${action}: ${feedback[action]!.message}`] : []).join(" · ")}</small>}</div></div>
      <div className="channel-cell"><PlatformMark platform={draft.platform} /><span>{draft.platform}</span></div><StatusPill status={draft.status} /><span className="date-cell">{resolveDraftTargetTime(draft.time, draft.targetPageId, connectionDisplayNames)}</span>
      <div className="row-actions">{draft.status === "Needs review" && <button type="button" className="row-action approve" disabled={approvalDenied || locked} title={approvalDenied ? "View-only · approve_content permission required" : undefined} onClick={(event) => { event.stopPropagation(); void onApprove(draft.id); }}>{feedback.approval?.status === "running" ? "Đang duyệt…" : "Duyệt"}</button>}{draft.status === "Needs review" && onReject && <button type="button" className="row-action reject" disabled={locked} onClick={(event) => { event.stopPropagation(); onReject(draft.id); }}>Bỏ</button>}<button type="button" className="row-action manual" onClick={(event) => { event.stopPropagation(); onExportManualPackage(draft.id); }}>Export package</button><div className="row-menu"><button type="button" className="row-more" aria-label={`Thao tác ${draft.title}`} aria-haspopup="menu" aria-expanded={openMenuId === draft.id} ref={(node) => { if (node) menuTriggersRef.current.set(draft.id, node); else menuTriggersRef.current.delete(draft.id); }} onKeyDown={(event) => { if (event.key === "Escape" && openMenuId === draft.id) { event.preventDefault(); closeMenu(draft.id); } }} onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => current === draft.id ? undefined : draft.id); }}>•••</button>{openMenuId === draft.id && <div className="row-action-menu" role="menu" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeMenu(draft.id); } }}>{actions.map((action) => {
        const needsJob = action === "reschedule" || action === "cancel_schedule";
        const targetAction = resolveContentTableTargetAction(draft);
        const targetActionAvailable = targetAction.mode === "draft" ? Boolean(onDraftTargetAction) : targetAction.mode === "job" ? Boolean(action === "reschedule" ? onReschedule : onCancel) : false;
        const disabled = (action === "approve" && (approvalDenied || locked)) || ((action === "regenerate_copy" || action === "delete") && locked) || (action === "regenerate_copy" && !onRegenerate) || (action === "delete" && !onDelete) || (action === "publish_now" && (!onPublish || publishLocked || Boolean(publishBlocker))) || (needsJob && !targetActionAvailable);
        const suffix = action === "approve" && approvalDenied ? " · View-only" : action === "publish_now" && publishBlocker ? ` · ${publishBlocker}` : needsJob && targetAction.mode === "unavailable" ? " · Chưa có queue" : "";
        return <button type="button" role="menuitem" disabled={disabled} title={action === "publish_now" ? publishBlocker : undefined} key={action} onClick={(event) => { event.stopPropagation(); void runAction(action, draft); }}>{contentActionLabel(action)}{suffix}</button>;
      })}</div>}</div></div>
    </div>;
  })}</div>;
}

function targetDisplayNamesFor(draft: Pick<DraftLike, "bindingIds" | "targetPageId">, names: Readonly<Record<string, string>>): string {
  const identifiers = draft.bindingIds?.length ? draft.bindingIds : draft.targetPageId ? [draft.targetPageId] : [];
  return identifiers.length ? identifiers.map((identifier) => resolveTargetDisplayName(identifier, names)).join(", ") : "Not recorded";
}

function ContentIntelligencePanel({ profileId, activeBrandId, activeClientId, currentMembership, knowledgeItems, researchEvidence, promptBlueprints, contentRecipes, trendSignals = [], selectedKnowledgeItemIds, selectedResearchEvidenceIds, selectedPromptBlueprintId, selectedRecipeId, transformMode, intakeDrafts, onIntakeDraftChange, onKnowledgeSelectionChange, onResearchSelectionChange, onPromptBlueprintChange, onRecipeChange, onTransformModeChange, onCreateResearchEvidence, onCreateKnowledgeItem, onCreateTrendSignal, onApproveResearchEvidence }: Pick<Props, "profileId" | "activeBrandId" | "currentMembership" | "knowledgeItems" | "researchEvidence" | "promptBlueprints" | "contentRecipes" | "trendSignals" | "intakeDrafts" | "onIntakeDraftChange" | "selectedKnowledgeItemIds" | "selectedResearchEvidenceIds" | "selectedPromptBlueprintId" | "selectedRecipeId" | "transformMode" | "onKnowledgeSelectionChange" | "onResearchSelectionChange" | "onPromptBlueprintChange" | "onRecipeChange" | "onTransformModeChange" | "onCreateResearchEvidence" | "onCreateKnowledgeItem" | "onCreateTrendSignal" | "onApproveResearchEvidence"> & { activeClientId: string }) {
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [evidenceReviewFeedback, setEvidenceReviewFeedback] = useState<Record<string, { status: "pending" | "success" | "failure"; message: string }>>({});
  const brandId = activeBrandId ?? "";
  const knowledgeDraft = intakeDrafts.knowledge;
  const researchDraft = intakeDrafts.research;
  const trendDraft = intakeDrafts.trend;
  const scoped = useMemo(() => contentIntelligenceRecordsForScope({ clientId: activeClientId, brandId, knowledgeItems, researchEvidence, promptBlueprints, contentRecipes: contentRecipes ?? [], trendSignals }), [activeClientId, brandId, contentRecipes, knowledgeItems, promptBlueprints, researchEvidence, trendSignals]);
  const { knowledgeItems: scopedKnowledgeItems, researchEvidence: scopedResearchEvidence, promptBlueprints: scopedPromptBlueprints, trendSignals: scopedTrendSignals } = scoped;
  const canReviewEvidence = canReviewResearchEvidence(currentMembership, activeClientId);
  const availableRecipes = useMemo(() => scoped.contentRecipes.filter((item) => item.status === "active"), [scoped.contentRecipes]);
  const knowledgeEligibility = useMemo(() => new Map(scopedKnowledgeItems.map((item) => [item.id, validateContentIntelligenceRecord("knowledge", item, { clientId: activeClientId, brandId })])), [activeClientId, brandId, scopedKnowledgeItems]);
  const evidenceEligibility = useMemo(() => new Map(scopedResearchEvidence.map((item) => [item.id, validateContentIntelligenceRecord("research", item, { clientId: activeClientId, brandId })])), [activeClientId, brandId, scopedResearchEvidence]);
  const selectionValidation = useMemo(() => validateContentIntelligenceSelection({ scope: { clientId: activeClientId, brandId }, knowledgeItems: scopedKnowledgeItems, selectedKnowledgeItemIds, researchEvidence: scopedResearchEvidence, selectedResearchEvidenceIds, promptBlueprints: scopedPromptBlueprints, selectedPromptBlueprintId, contentRecipes: scoped.contentRecipes, selectedRecipeId }), [activeClientId, brandId, scoped.contentRecipes, scopedKnowledgeItems, scopedPromptBlueprints, scopedResearchEvidence, selectedKnowledgeItemIds, selectedPromptBlueprintId, selectedRecipeId, selectedResearchEvidenceIds]);
  const selectedKnowledgeInScope = selectedKnowledgeItemIds;
  const selectedEvidenceInScope = selectedResearchEvidenceIds;
  const activeBlueprintId = scopedPromptBlueprints.some((item) => item.id === selectedPromptBlueprintId && item.status === "active") ? selectedPromptBlueprintId : "";
  const activeRecipeId = availableRecipes.some((item) => item.id === selectedRecipeId) ? selectedRecipeId ?? "" : "";
  const searchableItems = useMemo(() => scopedKnowledgeItems.map((item) => ({ id: item.id, clientId: item.clientId, brandId: item.brandId, title: item.title, text: item.text, rightsState: item.rightsState, reviewState: item.reviewState, archived: item.archiveState === "archived", sourceUpdatedAt: item.sourceUpdatedAt })), [scopedKnowledgeItems]);
  const knowledgeResults = knowledgeQuery.trim() ? searchKnowledgeItems(searchableItems, { clientId: activeClientId, brandId, query: knowledgeQuery, now: new Date().toISOString() }) : [];
  const submitKnowledge = () => {
    if (!knowledgeDraft.title.trim() || !knowledgeDraft.text.trim() || !knowledgeDraft.provenance.trim() || !onCreateKnowledgeItem) return;
    void onCreateKnowledgeItem({ title: knowledgeDraft.title.trim(), text: knowledgeDraft.text.trim(), provenance: knowledgeDraft.provenance.trim(), rightsState: knowledgeDraft.rightsState }, knowledgeDraft.revision);
  };
  const submitTrend = () => {
    if (!trendDraft.source.trim() || !trendDraft.topic.trim() || !trendDraft.metric.trim() || !onCreateTrendSignal) return;
    void onCreateTrendSignal({ source: trendDraft.source.trim(), topic: trendDraft.topic.trim(), metric: trendDraft.metric.trim(), evidenceIds: selectedEvidenceInScope }, trendDraft.revision);
  };
  const toggle = (id: string) => onKnowledgeSelectionChange(selectedKnowledgeInScope.includes(id) ? selectedKnowledgeInScope.filter((item) => item !== id) : [...selectedKnowledgeInScope, id]);
  const toggleEvidence = (id: string) => onResearchSelectionChange(selectedEvidenceInScope.includes(id) ? selectedEvidenceInScope.filter((item) => item !== id) : [...selectedEvidenceInScope, id]);
  const submitResearch = () => {
    if (!researchDraft.sourceUrl.trim() || !researchDraft.sourceTitle.trim() || !researchDraft.summary.trim()) return;
    const input = { sourceUrl: researchDraft.sourceUrl.trim(), sourceTitle: researchDraft.sourceTitle.trim(), retrievedAt: new Date().toISOString(), summary: researchDraft.summary.trim(), sourceType: researchDraft.sourceType, rightsState: researchDraft.rightsState };
    void onCreateResearchEvidence(input, researchDraft.revision);
  };
  const reviewFeedbackKey = (id: string) => JSON.stringify([profileId, activeClientId, brandId, id]);
  const approveEvidence = async (id: string) => {
    const feedbackKey = reviewFeedbackKey(id);
    if (!canReviewEvidence) {
      setEvidenceReviewFeedback((current) => ({ ...current, [feedbackKey]: { status: "failure", message: "Active Brand manager permission is required to approve research evidence." } }));
      return;
    }
    setEvidenceReviewFeedback((current) => ({ ...current, [feedbackKey]: { status: "pending", message: "Waiting for Control Plane review acknowledgement…" } }));
    try {
      const approved = await onApproveResearchEvidence(id);
      setEvidenceReviewFeedback((current) => ({ ...current, [feedbackKey]: approved
        ? { status: "success", message: "Approved and selectable." }
        : { status: "failure", message: "Approval was not saved; evidence remains pending." } }));
    } catch (error) {
      setEvidenceReviewFeedback((current) => ({ ...current, [feedbackKey]: { status: "failure", message: `Approval was not saved. ${error instanceof Error ? error.message : "Retry after Control Plane is available."}` } }));
    }
  };
  return <article className="panel intelligence-panel">
    <PanelHeading kicker="CONTENT INTELLIGENCE" title="Approved sources & evidence" />
    <p className="settings-help">Only approved, user-owned/licensed, Client/Brand-scoped material enters a Content Run. Search and research are opt-in; selecting a card is explicit.</p>
    {selectionValidation.issues.length > 0 && <div className="queue-notice failure" role="alert">Selection blocked: {selectionValidation.issues.map((issue) => `${issue.id} · ${issue.code}`).join("; ")}. Repair the marked selection before submitting.</div>}
    <div className="intelligence-section">
      <div className="section-heading-inline"><strong>Knowledge Library</strong><button className="text-button" disabled={knowledgeDraft.status === "pending"} onClick={() => onIntakeDraftChange("knowledge", { open: !knowledgeDraft.open })}>{knowledgeDraft.open ? "Close register" : "Register source"}</button></div>
      <label className="field-label">Search reviewed sources<input value={knowledgeQuery} onChange={(event) => setKnowledgeQuery(event.target.value)} placeholder="voice, product facts, claims…" /></label>
      {knowledgeDraft.open && <div className="research-intake">
        <label className="field-label">Title<input value={knowledgeDraft.title} disabled={knowledgeDraft.status === "pending"} onChange={(event) => onIntakeDraftChange("knowledge", { title: event.target.value })} /></label>
        <label className="field-label">Approved text extract<textarea value={knowledgeDraft.text} disabled={knowledgeDraft.status === "pending"} onChange={(event) => onIntakeDraftChange("knowledge", { text: event.target.value })} rows={3} /></label>
        <label className="field-label">Provenance<input value={knowledgeDraft.provenance} disabled={knowledgeDraft.status === "pending"} onChange={(event) => onIntakeDraftChange("knowledge", { provenance: event.target.value })} placeholder="owner document, licence ID…" /></label>
        <label className="field-label">Rights<select value={knowledgeDraft.rightsState} disabled={knowledgeDraft.status === "pending"} onChange={(event) => onIntakeDraftChange("knowledge", { rightsState: event.target.value as "user_owned" | "licensed" })}><option value="user_owned">User owned</option><option value="licensed">Licensed</option></select></label>
        <button className="primary-button" disabled={knowledgeDraft.status === "pending" || !onCreateKnowledgeItem || !knowledgeDraft.title.trim() || !knowledgeDraft.text.trim() || !knowledgeDraft.provenance.trim()} onClick={submitKnowledge}>{knowledgeDraft.status === "pending" ? "Saving…" : "Save approved source"}</button>
        <small className="muted-note">SignalFlow records a SHA-256 from the text and keeps this source scoped to the active Client/Brand.</small>
      </div>}
      {knowledgeQuery.trim() ? knowledgeResults.slice(0, 25).map((result) => { const eligibility = knowledgeEligibility.get(result.id); return <label className="intelligence-row" key={result.id}><input type="checkbox" disabled={!eligibility?.ok} checked={selectedKnowledgeInScope.includes(result.id)} onChange={() => toggle(result.id)} /><span><strong>{result.title}</strong><small>{result.retrievalMode} · score {result.score} · {result.stale ? "stale" : "fresh"} · {result.excerpt}{eligibility?.ok ? "" : ` · blocked: ${eligibility?.errors.join(", ") ?? "record unavailable"}`}</small></span></label>; }) : scopedKnowledgeItems.length === 0 ? <div className="empty-state">No approved Knowledge Items in this Client / Brand scope.</div> : scopedKnowledgeItems.slice(0, 25).map((item) => { const eligibility = knowledgeEligibility.get(item.id); return <label className="intelligence-row" key={item.id}><input type="checkbox" disabled={!eligibility?.ok} checked={selectedKnowledgeInScope.includes(item.id)} onChange={() => toggle(item.id)} /><span><strong>{item.title || item.id}</strong><small>{item.provenance || "missing provenance"} · {item.rightsState} · {item.reviewState} · {item.sourceUpdatedAt || "missing source date"}{eligibility?.ok ? "" : ` · blocked: ${eligibility?.errors.join(", ") ?? "record unavailable"}`}</small></span></label>; })}
    </div>
    <div className="intelligence-section">
      <div className="section-heading-inline"><strong>Research / Evidence</strong><button className="text-button" disabled={researchDraft.status === "pending"} onClick={() => onIntakeDraftChange("research", { open: !researchDraft.open })}>{researchDraft.open ? "Close intake" : "Add evidence"}</button></div>
      {researchDraft.open && <div className="research-intake">
        <label className="field-label">Source URL<input value={researchDraft.sourceUrl} disabled={researchDraft.status === "pending"} onChange={(event) => onIntakeDraftChange("research", { sourceUrl: event.target.value })} placeholder="https://…" /></label>
        <label className="field-label">Source title<input value={researchDraft.sourceTitle} disabled={researchDraft.status === "pending"} onChange={(event) => onIntakeDraftChange("research", { sourceTitle: event.target.value })} /></label>
        <label className="field-label">Operator-approved summary<textarea value={researchDraft.summary} disabled={researchDraft.status === "pending"} onChange={(event) => onIntakeDraftChange("research", { summary: event.target.value })} rows={3} /></label>
        <label className="field-label">Source type<select value={researchDraft.sourceType} disabled={researchDraft.status === "pending"} onChange={(event) => onIntakeDraftChange("research", { sourceType: event.target.value as "operator_selected" | "manual_entry" })}><option value="operator_selected">Operator selected source</option><option value="manual_entry">Manual entry</option></select></label>
        <label className="field-label">Rights<select value={researchDraft.rightsState} disabled={researchDraft.status === "pending"} onChange={(event) => onIntakeDraftChange("research", { rightsState: event.target.value as "user_owned" | "licensed" })}><option value="user_owned">User owned</option><option value="licensed">Licensed</option></select></label>
        <button className="primary-button" disabled={researchDraft.status === "pending" || !researchDraft.sourceUrl.trim() || !researchDraft.sourceTitle.trim() || !researchDraft.summary.trim()} onClick={submitResearch}>{researchDraft.status === "pending" ? "Saving…" : "Save evidence as pending review"}</button>
      </div>}
      {scopedResearchEvidence.length === 0 ? <div className="empty-state">No evidence records. Live search never runs automatically.</div> : scopedResearchEvidence.slice(0, 25).map((item) => {
        const review = evidenceReviewFeedback[reviewFeedbackKey(item.id)];
        const rightsOk = item.rightsState === "user_owned" || item.rightsState === "licensed";
        const eligibility = evidenceEligibility.get(item.id);
        return <div className="intelligence-evidence-entry" key={item.id}>
          <label className="intelligence-row"><input type="checkbox" disabled={!eligibility?.ok} checked={selectedEvidenceInScope.includes(item.id)} onChange={() => toggleEvidence(item.id)} /><span><strong>{item.sourceTitle || item.id}</strong><small>{item.sourceUrl || "missing source URL"}</small><small>Retrieved {item.retrievedAt || "missing date"} · {item.reviewState} · {item.rightsState}{item.sourceType ? ` · ${item.sourceType}` : ""}</small><small>Summary: {item.summary || "missing summary"}{eligibility?.ok ? "" : ` · blocked: ${eligibility?.errors.join(", ") ?? "record unavailable"}`}</small></span></label>
          {item.reviewState === "pending" && <button type="button" className="secondary-button intelligence-evidence-review" disabled={!canReviewEvidence || !rightsOk || review?.status === "pending"} title={!canReviewEvidence ? "Active Brand manager permission required to approve evidence." : undefined} onClick={() => void approveEvidence(item.id)}>{review?.status === "pending" ? "Approving…" : "Review and approve"}</button>}
          {review && <small className={`intelligence-review-feedback ${review.status}`} role={review.status === "failure" ? "alert" : "status"}>{review.message}</small>}
        </div>;
      })}
    </div>
    <div className="intelligence-section trend-section">
      <div className="section-heading-inline"><strong>Observed Trend Signals</strong><button className="text-button" disabled={trendDraft.status === "pending"} onClick={() => onIntakeDraftChange("trend", { open: !trendDraft.open })}>{trendDraft.open ? "Close intake" : "Add observed signal"}</button></div>
      {trendDraft.open && <div className="research-intake">
        <label className="field-label">Source / channel<input value={trendDraft.source} disabled={trendDraft.status === "pending"} onChange={(event) => onIntakeDraftChange("trend", { source: event.target.value })} placeholder="operator note, approved report…" /></label>
        <label className="field-label">Observed topic<input value={trendDraft.topic} disabled={trendDraft.status === "pending"} onChange={(event) => onIntakeDraftChange("trend", { topic: event.target.value })} /></label>
        <label className="field-label">Observed metric<input value={trendDraft.metric} disabled={trendDraft.status === "pending"} onChange={(event) => onIntakeDraftChange("trend", { metric: event.target.value })} placeholder="mentions, saves, search volume…" /></label>
        <button className="primary-button" disabled={trendDraft.status === "pending" || !onCreateTrendSignal || !trendDraft.source.trim() || !trendDraft.topic.trim() || !trendDraft.metric.trim()} onClick={submitTrend}>{trendDraft.status === "pending" ? "Saving…" : "Save observed signal"}</button>
        <small className="muted-note">Observed only: no prediction, forecast, probability, or automatic publication instruction.</small>
      </div>}
      {scopedTrendSignals.slice(0, 10).map((signal) => <div className="intelligence-row" key={signal.id}><span><strong>{signal.topic}</strong><small>{signal.source} · {signal.metric} · {signal.observedAt} · {signal.status}</small></span></div>)}
      {scopedTrendSignals.length === 0 && !trendDraft.open && <div className="empty-state">No observed trend signals yet.</div>}
    </div>
    <div className="intelligence-controls">
      <label className="field-label">Prompt Blueprint<select value={selectedPromptBlueprintId} onChange={(event) => onPromptBlueprintChange(event.target.value)}><option value="">No blueprint selected</option>{selectedPromptBlueprintId && !activeBlueprintId && <option value={selectedPromptBlueprintId}>Blocked selection · {selectedPromptBlueprintId}</option>}{scopedPromptBlueprints.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>{item.id} · {item.kind} v{item.version}</option>)}</select></label>
      <label className="field-label">Content Recipe<select value={selectedRecipeId ?? ""} onChange={(event) => onRecipeChange?.(event.target.value)}><option value="">No recipe selected</option>{selectedRecipeId && !activeRecipeId && <option value={selectedRecipeId}>Blocked selection · {selectedRecipeId}</option>}{availableRecipes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label>
      <label className="field-label">Transform mode<select value={transformMode} onChange={(event) => onTransformModeChange(event.target.value as ContentTransformMode)}><option value="original">Original</option><option value="rewrite">Rewrite</option><option value="repurpose">Repurpose · rights required</option><option value="imitation">Imitation · rights required</option><option value="de_ai_detector_evasion">Improve naturalness · no detector guarantee</option></select></label>
    </div>
    {transformMode === "de_ai_detector_evasion" && <small className="muted-note">Cải thiện độ tự nhiên; không bảo đảm kết quả detector.</small>}
    {[knowledgeDraft, researchDraft, trendDraft].filter((draft) => draft.message).map((draft) => <div key={draft.kind} className={`queue-notice ${draft.status}`} role={draft.status === "failure" ? "alert" : "status"}><span className="online-dot" /><span>{draft.message}</span></div>)}
  </article>;
}

function ContentIntelligenceForWorkspace({ props }: { props: Props }) {
  return <ContentIntelligencePanel
    profileId={props.profileId}
    activeBrandId={props.activeBrand.id}
    activeClientId={props.activeWorkspace.id}
    currentMembership={props.currentMembership}
    knowledgeItems={props.knowledgeItems}
    researchEvidence={props.researchEvidence}
    promptBlueprints={props.promptBlueprints}
    contentRecipes={props.contentRecipes}
    trendSignals={props.trendSignals}
    intakeDrafts={props.intakeDrafts}
    onIntakeDraftChange={props.onIntakeDraftChange}
    selectedKnowledgeItemIds={props.selectedKnowledgeItemIds}
    selectedResearchEvidenceIds={props.selectedResearchEvidenceIds}
    selectedPromptBlueprintId={props.selectedPromptBlueprintId}
    selectedRecipeId={props.selectedRecipeId}
    transformMode={props.transformMode}
    onKnowledgeSelectionChange={props.onKnowledgeSelectionChange}
    onResearchSelectionChange={props.onResearchSelectionChange}
    onPromptBlueprintChange={props.onPromptBlueprintChange}
    onRecipeChange={props.onRecipeChange}
    onTransformModeChange={props.onTransformModeChange}
    onCreateResearchEvidence={props.onCreateResearchEvidence}
    onCreateKnowledgeItem={props.onCreateKnowledgeItem}
    onCreateTrendSignal={props.onCreateTrendSignal}
    onApproveResearchEvidence={props.onApproveResearchEvidence}
  />;
}

function formatJobTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function CalendarView({ queueJobs, onOpenComposer, onReschedule, onCancel, liveReadiness, dashboardCalendarDate, connectionDisplayNames = {} }: Pick<Props, "queueJobs" | "onOpenComposer" | "onReschedule" | "onCancel" | "liveReadiness" | "dashboardCalendarDate" | "connectionDisplayNames">) {
  const [view, setView] = useState<"Week" | "Month" | "Agenda">("Week");
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedJob, setSelectedJob] = useState<QueueJobLike | undefined>();
  const [selectedDate, setSelectedDate] = useState(dashboardCalendarDate ?? "");
  const activeJobs = useMemo(() => queueJobs.filter((job) => ["queued", "retryable_error", "preflight_failed"].includes(job.state)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)), [queueJobs]);
  const visibleAgendaJobs = useMemo(() => selectedDate ? filterScheduledJobsForDate(activeJobs, selectedDate) : activeJobs, [activeJobs, selectedDate]);
  useEffect(() => {
    if (!dashboardCalendarDate) return;
    setSelectedDate(dashboardCalendarDate);
    const next = new Date(`${dashboardCalendarDate}T12:00:00`);
    if (!Number.isNaN(next.getTime())) setCursor(next);
  }, [dashboardCalendarDate]);
  const dayStart = new Date(cursor); dayStart.setHours(0, 0, 0, 0);
  const monday = new Date(dayStart); const day = monday.getDay(); monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  const weekDays = Array.from({ length: 7 }, (_, index) => { const date = new Date(monday); date.setDate(monday.getDate() + index); return date; });
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const firstDay = monthStart.getDay();
  const monthGridStart = new Date(monthStart); monthGridStart.setDate(1 - (firstDay === 0 ? 6 : firstDay - 1));
  const monthDays = Array.from({ length: 42 }, (_, index) => { const date = new Date(monthGridStart); date.setDate(monthGridStart.getDate() + index); return date; });
  const dateKey = localDateKey;
  const jobsForDay = (date: Date) => activeJobs.filter((job) => dateKey(new Date(job.scheduledAt)) === dateKey(date));
  const targetNameFor = (job: QueueJobLike) => resolveTargetDisplayName(job.bindingId ?? job.connectionId, connectionDisplayNames);
  const movePeriod = (direction: number) => setCursor((current) => { const next = new Date(current); if (view === "Month") next.setMonth(next.getMonth() + direction); else next.setDate(next.getDate() + direction * 7); return next; });
  const selectDate = (date: Date) => setSelectedDate(dateKey(date));
  const renderJobs = (date: Date) => {
    const jobs = jobsForDay(date);
    if (jobs.length === 0) return <small className="muted-note">No scheduled work</small>;
    return jobs.slice(0, 5).map((job, index) => <button className={`calendar-card ${index % 3 === 0 ? "blue-event" : index % 3 === 1 ? "purple-event" : "green-event"}`} key={job.id} onClick={(event) => { event.stopPropagation(); setSelectedJob(job); }}><b>{job.variantId}</b><small>{formatJobTime(job.scheduledAt)} · {job.state.replace(/_/g, " ")}</small></button>);
  };
  const renderDayCell = (date: Date, extraClass = "") => <div className={`calendar-cell calendar-day-cell ${selectedDate === dateKey(date) ? "selected" : ""} ${extraClass}`} role="button" tabIndex={0} aria-label={`Select ${date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}`} onClick={() => selectDate(date)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectDate(date); } }}><time dateTime={dateKey(date)}>{date.getDate()}</time>{renderJobs(date)}</div>;
  const periodLabel = view === "Month" ? cursor.toLocaleDateString("vi-VN", { month: "long", year: "numeric" }) : monday.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  return <section className="expanded-view"><ViewHeader kicker="PUBLISHING OPERATIONS" title="Calendar" subtitle="Calendar reads queued target publications; select a bar for details, then reschedule or cancel safely." action="Schedule content" onAction={onOpenComposer}/><div className="calendar-toolbar"><div className="calendar-tabs">{(["Week", "Month", "Agenda"] as const).map((item) => <button key={item} className={view === item ? "selected" : ""} onClick={() => setView(item)}>{item}</button>)}</div><div className="calendar-nav"><button className="secondary-button" onClick={() => movePeriod(-1)}>← Earlier</button><strong>{periodLabel}</strong><button className="secondary-button" onClick={() => movePeriod(1)}>Later →</button></div><span><span className="online-dot"/> {selectedDate ? `Selected ${selectedDate} · ` : ""}{visibleAgendaJobs.length} queued jobs{selectedDate ? " for selected day" : ""} · {liveReadiness === "ready" ? "Official Meta route ready" : "Live route blocked"}</span></div>{view === "Agenda" ? <article className="panel agenda-list"><PanelHeading kicker="QUEUE AGENDA" title={`${visibleAgendaJobs.length} scheduled jobs`}/>{visibleAgendaJobs.length === 0 && <div className="empty-state">No queued jobs for this selected day.</div>}{visibleAgendaJobs.slice(0, 5).map((job) => <button className="agenda-row" key={job.id} onClick={() => setSelectedJob(job)}><span>{formatJobTime(job.scheduledAt)}</span><strong>{job.variantId}</strong><span className={`queue-state ${job.state}`}>{job.state.replace(/_/g, " ")}</span><span>{targetNameFor(job)} · {job.attempts} attempts</span><span>Open detail →</span></button>)}</article> : view === "Month" ? <div className="full-calendar panel month-calendar"><div className="month-calendar-head">{["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((label) => <strong key={label}>{label}</strong>)}</div><div className="month-calendar-grid">{monthDays.map((date) => renderDayCell(date, date.getMonth() === cursor.getMonth() ? "" : "outside-month"))}</div></div> : <div className="full-calendar panel week-calendar"><div className="full-calendar-head"><span>DATE</span>{weekDays.map((date) => <strong key={dateKey(date)}>{date.toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit" })}</strong>)}</div>{weekDays.map((date) => <div className="calendar-grid-row" key={dateKey(date)}><span>{date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}</span>{renderDayCell(date)}</div>)}</div>}{selectedJob && <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={() => setSelectedJob(undefined)}><section className="composer-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="panel-kicker">QUEUE DETAIL</p><h2>{selectedJob.variantId}</h2><span>{formatJobTime(selectedJob.scheduledAt)} · {selectedJob.state}</span></div><button className="close-button" onClick={() => setSelectedJob(undefined)}>×</button></div><div className="detail-grid"><span>Job</span><strong>{selectedJob.id}</strong><span>Target</span><strong>{targetNameFor(selectedJob)}</strong><span>Attempts</span><strong>{selectedJob.attempts}</strong></div><div className="composer-foot"><button className="secondary-button" onClick={() => { onReschedule(selectedJob.id); setSelectedJob(undefined); }}>Reschedule +2h</button><button className="text-button danger-text" onClick={() => { onCancel(selectedJob.id); setSelectedJob(undefined); }}>Cancel safely</button></div></section></div>}</section>;
}
function FacebookTargetPicker({ pages, selectedPageIds, onToggle }: { pages: Array<{ id: string; name?: string }>; selectedPageIds: string[]; onToggle: (pageId: string) => void }) {
  const [open, setOpen] = useState(false);
  const selectedPages = pages.filter((page) => selectedPageIds.includes(page.id));
  return <div className="planner-target-picker">
    <button type="button" className="planner-target-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span>{selectedPages.length === 0 ? "Select Facebook Pages" : `${selectedPages.length} Facebook Page${selectedPages.length === 1 ? "" : "s"} selected`}</span><span aria-hidden="true">⌄</span>
    </button>
    {selectedPages.length > 0 && <div className="planner-target-chips" aria-label="Selected Facebook Pages">{selectedPages.map((page) => <span className="planner-target-chip" key={page.id}><strong>{page.name ?? "Facebook Page"}</strong><button type="button" aria-label={`Remove ${page.name ?? "Facebook Page"}`} onClick={() => onToggle(page.id)}>×</button></span>)}</div>}
    {open && <div className="planner-target-popover" role="listbox" aria-label="Facebook Page results">{pages.length === 0 ? <div className="empty-state">No discovered Facebook Pages.</div> : pages.map((page) => { const selected = selectedPageIds.includes(page.id); return <label className={`planner-target-option ${selected ? "selected" : ""}`} key={page.id}><input type="checkbox" checked={selected} onChange={() => onToggle(page.id)} /><span><strong>{page.name ?? "Facebook Page"}</strong><small>Facebook Page · {selected ? "Selected" : "Available"}</small></span><em>{selected ? "Selected" : "Add"}</em></label>; })}</div>}
  </div>;
}

export type PlannerStrategySectionProps = {
  activeBrandName: string;
  catalog?: BrandStrategyCatalog;
  catalogRevision?: number;
  catalogLoading?: boolean;
  catalogError?: string;
  selection: AutomationStrategySelection;
  choices: PlannerStrategyChoices;
  preview: AutomationPlannerPreviewResult;
  stale?: boolean;
  onChange: (patch: Partial<AutomationStrategySelection>) => void;
};

export function PlannerStrategySection({ activeBrandName, catalog, catalogRevision = 0, catalogLoading = false, catalogError = "", selection, choices, preview, stale = false, onChange }: PlannerStrategySectionProps) {
  const fingerprint = catalog ? strategyCatalogFingerprint(catalog) : "—";
  const disabled = catalogLoading || !catalog || choices.errors.length > 0;
  return <article className="panel planner-card planner-strategy-card" data-testid="planner-content-strategy">
    <div className="panel-heading"><div><p className="panel-kicker">CONTENT STRATEGY</p><h2>Content strategy</h2></div><span className="planner-catalog-state">{catalogLoading ? "Loading" : catalog ? "Use Brand catalog" : "Catalog unavailable"}</span></div>
    <div className="planner-catalog-meta"><span>Active Brand <strong>{activeBrandName}</strong></span><span>Catalog version <strong>{catalog ? `v${catalog.version}` : "—"}</strong></span><span>Catalog revision <strong>{catalog ? catalogRevision : "—"}</strong></span><span>Catalog fingerprint <strong title={fingerprint}>{fingerprint === "—" ? fingerprint : fingerprint.slice(0, 12)}</strong></span><label className="planner-catalog-toggle"><input type="checkbox" checked={Boolean(catalog)} readOnly disabled/><span>Use Brand catalog</span></label></div>
    {catalogError && <div className="planner-errors" role="alert"><strong>Catalog error</strong><span>{catalogError}</span></div>}
    {!catalogLoading && !catalog && !catalogError && <div className="planner-errors" role="alert"><strong>Catalog unavailable</strong><span>STRATEGY_CATALOG_REQUIRED · open Brand system to load the active catalog.</span></div>}
    {stale && <div className="planner-stale-banner" role="alert"><strong>Matrix updated — review plan</strong><span>The saved strategy snapshot uses an older catalog version or fingerprint. Review and resave before activation.</span></div>}
    <div className="planner-strategy-controls">
      <label className="field-label">Objective<select value={selection.objective} disabled={disabled} onChange={(event) => onChange({ objective: event.target.value as AutomationStrategySelection["objective"] })}>{choices.objectives.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Specific values are canonical objective IDs; Mix rotates enabled objectives.</small></label>
      <label className="field-label">Pillar<select value={selection.pillar} disabled={disabled} onChange={(event) => onChange({ pillar: event.target.value })}>{choices.pillars.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Specific values are canonical pillar IDs.</small></label>
      <label className="field-label">Angle<select value={selection.angle} disabled={disabled} onChange={(event) => onChange({ angle: event.target.value })}>{choices.angles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Enabled angles are filtered by the selected pillar and target channel.</small></label>
    </div>
    {choices.errors.length > 0 && <div className="planner-errors" role="alert"><strong>Strategy choices blocked</strong>{choices.errors.map((error) => <span key={error}>· {error}</span>)}</div>}
    {!preview.ok && <div className="planner-errors planner-preview-errors" role="alert"><strong>First error</strong><span>{preview.firstError}</span>{preview.remainingErrors > 0 && <span>{preview.remainingErrors} remaining error{preview.remainingErrors === 1 ? "" : "s"}.</span>}</div>}
    {preview.ok && <div className="planner-resolved-catalog" aria-label="Resolved content catalog rows"><div className="planner-resolved-heading"><strong>Resolved content catalog</strong><span>{preview.rows.length} slot{preview.rows.length === 1 ? "" : "s"} · read-only</span></div>{preview.rows.map((row: AutomationPlannerResolvedCatalogRow) => <div className="planner-resolved-row" key={row.id}><div><strong>{row.objectiveKey} · {row.objectiveLabel}</strong><span>{row.pillarId} · {row.pillarLabel}</span><span>{row.angleId} · {row.angleLabel}</span></div><div><span>Target {row.targetPageId ?? row.platform}</span><span>Applicable {row.applicableChannels.join(", ") || "—"}</span><span>Recipe {row.recipeId ? `${row.recipeId} · ${row.recipeLabel}` : row.recipeLabel}</span></div><small>Catalog v{row.catalogVersion} · {row.catalogFingerprint.slice(0, 12)} · {new Date(row.scheduledAt).toLocaleString("vi-VN")}</small></div>)}</div>}
  </article>;
}

export function plannerStrategySaveBlocked(input: { catalogLoading: boolean; hasCatalog: boolean; catalogError: string; previewOk: boolean; staleReviewRequired: boolean }): boolean {
  return input.catalogLoading || !input.hasCatalog || Boolean(input.catalogError) || !input.previewOk || input.staleReviewRequired;
}

export function AutomationPlannerView({ plans, profileId, plannerScopeGeneration, plannerDrafts, plannerSelections, onDraftChange, onSelectionChange, onBeginSave, workspace, activeBrand, brandVoice, assets, bindings = [], onSave, onSelect, metaAccountHints, targetConnectionTargets = [], onBeginConnection, onRunReviewOnlyAutomationPlan, plannerRunBusy, automationAIResolution, strategyCatalog, strategyCatalogRevision = 0, strategyCatalogLoading = false, strategyCatalogError = "", scheduleTemplate, contentRecipes = [] }: { plans: AutomationPlan[]; profileId: string; plannerScopeGeneration: number; plannerDrafts: Record<string, AutomationPlannerDraftState>; plannerSelections: Record<string, string>; onDraftChange: Props["onPlannerDraftChange"]; onSelectionChange: Props["onPlannerSelectionChange"]; onBeginSave: Props["onBeginPlannerSave"]; workspace: WorkspaceRecord; activeBrand: BrandRecord; brandVoice: string; assets: MediaCard[]; bindings?: Array<{ id: string; brandId: string; targetExternalId: string; state: string }>; onSave: (plan: AutomationPlan, token: AutomationPlannerSaveToken) => Promise<AutomationPlannerSaveResult>; onSelect: (nav: string) => void; metaAccountHints: Array<{ id: string; name?: string; kind?: string }>; targetConnectionTargets?: Props["targetConnectionTargets"]; onBeginConnection?: Props["onBeginConnection"]; onRunReviewOnlyAutomationPlan: (scope: AutomationPlannerDraftScope) => Promise<void>; plannerRunBusy: boolean; automationAIResolution: ResolvedAutomationAI; strategyCatalog?: BrandStrategyCatalog; strategyCatalogRevision?: number; strategyCatalogLoading?: boolean; strategyCatalogError?: string; scheduleTemplate?: import("./lib/contentStrategyResolver").CampaignScheduleTemplate; contentRecipes?: ContentRecipe[] }) {
  const activeClientId = clientIdForBrand(activeBrand);
  const scopedPlans = plans.filter((candidate) => automationPlanMatchesBrandScope(candidate, activeBrand)).map((candidate) => canonicalizeAutomationPlanScope(candidate, activeBrand));
  const activeScope: AutomationPlannerActiveScope = automationPlannerScopeForBrand(profileId, activeBrand);
  const scopeKey = automationPlannerScopeKey(activeScope);
  const canonicalPlan = selectCanonicalAutomationPlan(scopedPlans, activeClientId, activeBrand.id);
  const scopeDraft = dirtyPlannerDraftForScope(plannerDrafts, activeScope);
  const selectedPlanId = plannerSelections[scopeKey] ?? scopeDraft?.scope.planId ?? canonicalPlan?.id;
  const storedPlan = scopedPlans.find((candidate) => candidate.id === selectedPlanId) ?? canonicalPlan;
  const initialPlan = useMemo(() => storedPlan ?? createAutomationPlan(activeClientId, activeBrand.id, workspace.timezone), [activeBrand.id, activeClientId, storedPlan?.id, storedPlan?.updatedAt, workspace.timezone]);
  const draftScope: AutomationPlannerDraftScope = { ...activeScope, planId: selectedPlanId ?? initialPlan.id };
  const draftKey = automationPlannerDraftKey(draftScope);
  const draft = plannerDraftForScope(plannerDrafts, draftScope);
  const plan = draft?.plan ?? storedPlan ?? initialPlan;
  const plannerModalProjection = projectAutomationPlannerModal(plan);
  const draftDirty = draft?.dirty ?? false;
  const selectedUpcomingJobId = draft?.selectedJobId;
  const editingUpcomingJob = draft?.editingJobId ?? "";
  const editingUpcomingTime = draft?.editingTime ?? "";
  const [activePlannerSave, setActivePlannerSave] = useState<AutomationPlannerSaveToken>();
  const planSavePending = activePlannerSave?.draftKey === draftKey && activePlannerSave.scopeGeneration === plannerScopeGeneration;
  const [planModal, setPlanModal] = useState<AutomationPlannerModalState>();
  const createPlanTriggerRef = useRef<HTMLButtonElement>(null);
  const planModalTriggerRef = useRef<HTMLElement | null>(null);
  const planModalNameRef = useRef<HTMLInputElement>(null);
  const createPlanDialogRef = useRef<HTMLElement>(null);
  const planSaveRequestIdsRef = useRef(new Map<string, number>());
  const currentSaveContextRef = useRef<AutomationPlannerSaveToken>({ draftKey, scopeGeneration: plannerScopeGeneration, requestId: planSaveRequestIdsRef.current.get(draftKey) ?? 0, editRevision: draft?.editRevision ?? 0 });
  currentSaveContextRef.current = { draftKey, scopeGeneration: plannerScopeGeneration, requestId: planSaveRequestIdsRef.current.get(draftKey) ?? 0, editRevision: draft?.editRevision ?? 0 };
  const [notice, setNotice] = useState("");
  const storePlannerDraft = (nextPlan: AutomationPlan, patch: Partial<Omit<AutomationPlannerDraftState, "scope" | "editRevision" | "plan">> = {}) => {
    const nextScope = { ...activeScope, planId: nextPlan.id };
    const current = plannerDraftForScope(plannerDrafts, nextScope) ?? { scope: nextScope, plan: nextPlan, dirty: false, editingJobId: "", editingTime: "", editRevision: 0 };
    const updated = updateAutomationPlannerModalDraft(activeScope, current, nextPlan, patch);
    onDraftChange(updated.draftKey, updated.draft, plannerScopeGeneration);
  };
  const closePlanModal = (discard = true) => {
    if (!planModal) return;
    const modalSavePending = activePlannerSave?.draftKey === planModal.draftKey && activePlannerSave.scopeGeneration === plannerScopeGeneration;
    if (discard && !canCloseAutomationPlannerModal(modalSavePending ? "pending" : "idle")) {
      setNotice("Plan persistence is still pending; wait for its result before closing the editor.");
      return;
    }
    if (discard) {
      const restore = automationPlannerModalCancel(planModal, canonicalPlan?.id ?? initialPlan.id);
      if (restore.removeDraft) onDraftChange(restore.draftKey, undefined, plannerScopeGeneration);
      onSelectionChange(planModal.scopeKey, restore.restorePlanId, plannerScopeGeneration);
    }
    setPlanModal(undefined);
    window.requestAnimationFrame(() => { if (planModalTriggerRef.current?.isConnected) planModalTriggerRef.current.focus(); });
  };
  useEffect(() => {
    if (!planModal) return;
    const frame = window.requestAnimationFrame(() => planModalNameRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [planModal]);
  useEffect(() => {
    if (!planModal || planModal.scopeKey === scopeKey) return;
    const restore = automationPlannerModalCancel(planModal);
    onDraftChange(restore.draftKey, undefined, plannerScopeGeneration);
    setPlanModal(undefined);
    planModalTriggerRef.current = null;
  }, [onDraftChange, planModal, plannerScopeGeneration, scopeKey]);
  const discoveredPages = metaAccountHints.filter((account) => account.kind === "page");
  const unavailableTargets = targetConnectionTargets.filter((target) => target.platform !== "facebook");
  const targetPlatformLabel = (platform: SocialPlatform) => platform === "instagram" ? "Instagram Business" : platform === "tiktok" ? "TikTok Target" : "YouTube Target";
  const selectedPageIds = resolveAutomationTargetPageIdsFromBindings(plan);
  const bindingIdForPage = (pageId: string) => bindings.find((binding) => binding.brandId === activeBrand.id && binding.targetExternalId === pageId && binding.state === "connected")?.id ?? `binding-${activeBrand.id}-facebook-${pageId}`;
  const selectedBindingIds = plan.bindingIds ?? selectedPageIds.map(bindingIdForPage);
  const activeRouteProfile = automationAIResolution.provider === "mock" ? undefined : { mode: automationAIResolution.mode === "web_subscription" ? "subscription_package" as const : "llm_provider" as const, provider: automationAIResolution.provider, model: automationAIResolution.model ?? "unselected", status: automationAIResolution.available ? "connected" as const : "not_configured" as const, capabilities: ["copy", "image", "video"] };
  const routeReadiness = activeRouteProfile && automationAIResolution.mode !== "manual_assisted" ? validateAutomationPlanRoute(activeRouteProfile, ["copy"], true) : { ok: false as const, code: "LLM_PROVIDER_NOT_READY" as const };
  const brandKit = getBrandKitStatus(activeBrand.status, brandVoice, activeBrand.brandKitLinked);
  const plannerValidationPlan = normalizePlannerStrategyPlan(plan);
  const validation = validateAutomationPlan(plannerValidationPlan, strategyCatalog);
  const campaignStartDateResult = plan.campaignStartAt ? campaignInstantToDate(plan.campaignStartAt, plan.cron.timezone) : "";
  const campaignEndDateResult = plan.campaignEndAt ? campaignInstantToDate(plan.campaignEndAt, plan.cron.timezone) : "";
  const campaignStartDate = typeof campaignStartDateResult === "string" ? campaignStartDateResult : "";
  const campaignEndDate = typeof campaignEndDateResult === "string" ? campaignEndDateResult : "";
  const campaignDateErrors = [
    typeof campaignStartDateResult === "string" ? undefined : `Campaign start: ${campaignStartDateResult.error}`,
    typeof campaignEndDateResult === "string" ? undefined : `Campaign end: ${campaignEndDateResult.error}`,
  ].filter((error): error is string => Boolean(error));
  const plannerTargetChannels = [...new Set([...AUTOMATION_PLATFORMS.filter((platform) => plan.platforms[platform]?.enabled), ...(selectedPageIds.length > 0 ? ["facebook" as const] : [])])];
  const plannerSelection: AutomationStrategySelection = plan.strategySelection ?? { objective: "mix", pillar: "mix", angle: "mix" };
  const strategyChoices = useMemo(() => plannerStrategyChoices(strategyCatalog, plannerTargetChannels, plannerSelection), [plannerSelection.angle, plannerSelection.objective, plannerSelection.pillar, plannerTargetChannels.join("|"), strategyCatalog]);
  const previewStartDate = (plan.dateRange?.startDate ?? plan.dateRange?.start ?? campaignStartDate) || new Date().toISOString().slice(0, 10);
  const previewEndDate = (plan.dateRange?.endDate ?? plan.dateRange?.end ?? campaignEndDate) || previewStartDate;
  const plannerPreviewPlan = useMemo(() => {
    const campaignId = plan.campaignId ?? plan.id;
    const selectedTemplate = plan.scheduleTemplate ?? scheduleTemplate;
    const previewSchedule = selectedTemplate ? { ...structuredClone(selectedTemplate), id: selectedTemplate.id || `schedule-template-${campaignId}`, campaignId, brandId: activeBrand.id, source: selectedTemplate.source ?? "brand_default" as const } : undefined;
    return normalizePlannerStrategyPlan({ ...plan, campaignId, dateRange: { startDate: previewStartDate, endDate: previewEndDate }, strategySelection: plannerSelection, targetChannels: plannerTargetChannels, scheduleTemplate: previewSchedule });
  }, [activeBrand.id, campaignEndDate, campaignStartDate, plan, previewEndDate, previewStartDate, plannerSelection, plannerTargetChannels, scheduleTemplate]);
  const plannerPreview = useMemo(() => buildAutomationPlannerPreview({ plan: plannerPreviewPlan, catalog: strategyCatalog, scheduleTemplate: plannerPreviewPlan.scheduleTemplate, recipes: contentRecipes }), [contentRecipes, plannerPreviewPlan, strategyCatalog]);
  const staleCatalogReview = strategyCatalog && plan.strategySnapshot ? automationPlanCatalogReviewState(plan, strategyCatalog) : { ok: true, matrixUpdated: false, reviewRequired: false };
  const planDisplay = automationPlanDisplayState(plan, strategyCatalog);
  const reviewOnlyGuard = reviewOnlyAutomationPlanGuard({ plan, persistedPlan: storedPlan, draftDirty, catalog: strategyCatalog });
  const reviewOnlyScope: AutomationPlannerDraftScope | undefined = reviewOnlyGuard.ok && storedPlan ? { ...activeScope, planId: storedPlan.id } : undefined;
  const strategyLabel = (kind: "objective" | "pillar" | "angle") => {
    const value = plannerSelection[kind];
    const options = kind === "objective" ? strategyChoices.objectives : kind === "pillar" ? strategyChoices.pillars : strategyChoices.angles;
    return options.find((option) => option.value === value)?.label ?? value;
  };
  const plannerAssets = assets.filter(plannerAssetFilter);
  const plannerExcludedCount = assets.length - plannerAssets.length;
  const updateLocalPlan = (updater: (current: AutomationPlan) => AutomationPlan) => { if (planSavePending) { setNotice("Wait for plan persistence to finish before editing again."); return; } storePlannerDraft(updater(plan), { dirty: true }); };
  const updatePlan = (patch: Partial<AutomationPlan>) => updateLocalPlan((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));
  const updateStrategySelection = (patch: Partial<AutomationStrategySelection>) => updatePlan({ strategySelection: { ...plannerSelection, ...patch } });
  const updateCampaignDate = (boundary: "start" | "end", dateKey: string) => {
    if (!dateKey) {
      updatePlan(boundary === "start" ? { campaignStartAt: undefined } : { campaignEndAt: undefined });
      return;
    }
    const result = campaignDateToInstant(dateKey, plan.cron.timezone, boundary);
    if (typeof result !== "string") {
      setNotice(`Campaign ${boundary} date was not changed. ${result.error}`);
      return;
    }
    updatePlan(boundary === "start" ? { campaignStartAt: result } : { campaignEndAt: result });
  };
  const updateBindingSchedule = (bindingId: string, schedule: BindingSchedule) => updateLocalPlan((current) => ({ ...current, bindingSchedules: { ...(current.bindingSchedules ?? {}), [bindingId]: schedule }, updatedAt: new Date().toISOString() }));
  const dayLabels = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;
  const runDaysFor = (item: AutomationPlatformPlan) => item.runDays ?? [...AUTOMATION_RUN_DAYS];
  const updatePlatform = (platform: SocialPlatform, patch: Partial<AutomationPlatformPlan>) => updateLocalPlan((current) => {
    const existing = current.platforms[platform];
    const nextPosts = patch.postsPerDay === undefined ? existing.postsPerDay : Math.max(0, Math.floor(patch.postsPerDay));
    const publishTimes = Array.from({ length: nextPosts }, (_, index) => existing.publishTimes[index] ?? `${String((9 + Math.floor(index / 2)) % 24).padStart(2, "0")}:${index % 2 === 0 ? "00" : "30"}`);
    return { ...current, updatedAt: new Date().toISOString(), platforms: { ...current.platforms, [platform]: { ...existing, ...patch, postsPerDay: nextPosts, publishTimes } } };
  });
  const updatePlatformTime = (platform: SocialPlatform, index: number, value: string) => updateLocalPlan((current) => ({ ...current, updatedAt: new Date().toISOString(), platforms: { ...current.platforms, [platform]: { ...current.platforms[platform], publishTimes: current.platforms[platform].publishTimes.map((entry, timeIndex) => timeIndex === index ? value : entry) } } }));
  const togglePlatformDay = (platform: SocialPlatform, day: number) => { const current = plan.platforms[platform]; const days = runDaysFor(current); updatePlatform(platform, { runDays: days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort((a, b) => a - b) }); };
  const togglePage = (pageId: string) => updateLocalPlan((current) => {
    const selected = current.targetPageIds ?? [];
    const included = selected.includes(pageId);
    const nextPageIds = included ? selected.filter((id) => id !== pageId) : [...selected, pageId];
    const pagePlans = { ...(current.pagePlans ?? {}) };
    if (included) delete pagePlans[pageId];
    else pagePlans[pageId] = { ...current.platforms };
    return { ...current, targetPageIds: nextPageIds, bindingIds: nextPageIds.map(bindingIdForPage), pagePlans, updatedAt: new Date().toISOString() };
  });
  const updatePageFacebook = (pageId: string, patch: Partial<AutomationPlatformPlan>) => updateLocalPlan((current) => {
    const existing = current.pagePlans?.[pageId]?.facebook ?? current.platforms.facebook;
    const nextPosts = patch.postsPerDay === undefined ? existing.postsPerDay : Math.max(0, Math.floor(patch.postsPerDay));
    const publishTimes = Array.from({ length: nextPosts }, (_, index) => existing.publishTimes[index] ?? `${String((9 + Math.floor(index / 2)) % 24).padStart(2, "0")}:${index % 2 === 0 ? "00" : "30"}`);
    const next = { ...existing, ...patch, postsPerDay: nextPosts, publishTimes };
    const pagePlans = { ...(current.pagePlans ?? {}), [pageId]: { ...(current.pagePlans?.[pageId] ?? current.platforms), facebook: next } };
    const firstPageId = current.targetPageIds?.[0];
    const bindingId = bindingIdForPage(pageId);
    const bindingSchedule = current.bindingSchedules?.[bindingId];
    const bindingSchedules = bindingSchedule?.mode === "independent" ? { ...(current.bindingSchedules ?? {}), [bindingId]: { ...bindingSchedule, postsPerDay: next.postsPerDay, imageCount: next.imageCount, videoCount: next.videoCount, publishTimes: next.publishTimes, runDays: next.runDays } } : current.bindingSchedules;
    return { ...current, pagePlans, bindingSchedules, platforms: firstPageId === pageId ? { ...current.platforms, facebook: next } : current.platforms, updatedAt: new Date().toISOString() };
  });
  const updatePageFacebookTime = (pageId: string, index: number, value: string) => updateLocalPlan((current) => {
    const existing = current.pagePlans?.[pageId]?.facebook ?? current.platforms.facebook;
    const next = { ...existing, publishTimes: existing.publishTimes.map((entry, timeIndex) => timeIndex === index ? value : entry) };
    const pagePlans = { ...(current.pagePlans ?? {}), [pageId]: { ...(current.pagePlans?.[pageId] ?? current.platforms), facebook: next } };
    const bindingId = bindingIdForPage(pageId);
    const bindingSchedule = current.bindingSchedules?.[bindingId];
    const bindingSchedules = bindingSchedule?.mode === "independent" ? { ...(current.bindingSchedules ?? {}), [bindingId]: { ...bindingSchedule, publishTimes: next.publishTimes } } : current.bindingSchedules;
    return { ...current, pagePlans, bindingSchedules, platforms: current.targetPageIds?.[0] === pageId ? { ...current.platforms, facebook: next } : current.platforms, updatedAt: new Date().toISOString() };
  });
  const togglePageDay = (pageId: string, day: number) => { const current = plan.pagePlans?.[pageId]?.facebook ?? plan.platforms.facebook; const days = runDaysFor(current); updatePageFacebook(pageId, { runDays: days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort((a, b) => a - b) }); };
  const setDailyCron = (platform: SocialPlatform, pageId?: string) => updateLocalPlan((current) => setDailyCronForScope(current, { platform, pageId, bindingId: pageId ? bindingIdForPage(pageId) : undefined }));
  const togglePlatform = (platform: SocialPlatform) => {
    const current = plan.platforms[platform];
    const youtube = platform === "youtube";
    updatePlatform(platform, current.enabled ? { enabled: false } : { enabled: true, postsPerDay: current.postsPerDay || 1, imageCount: youtube ? 0 : current.imageCount || 1, videoCount: youtube ? current.videoCount || 1 : current.videoCount, publishTimes: current.publishTimes.length > 0 ? current.publishTimes : ["09:00"] });
  };
  const persistPlan = async (submittedPlan: AutomationPlan, pendingMessage: string, successMessage: (saved: AutomationPlan) => string, failureMessage: string): Promise<boolean> => {
    const requestId = onBeginSave(draftKey, plannerScopeGeneration);
    if (requestId === undefined) { setNotice("A save for this plan is already in progress. Wait for its result."); return false; }
    const token: AutomationPlannerSaveToken = { draftKey, scopeGeneration: plannerScopeGeneration, requestId, editRevision: draft?.editRevision ?? 0 };
    planSaveRequestIdsRef.current.set(draftKey, requestId);
    currentSaveContextRef.current = token;
    setActivePlannerSave(token);
    const pendingState = transitionAutomationPlannerModalSave({ phase: "idle", canClose: true }, { type: "begin", plan: submittedPlan, token, notice: pendingMessage });
    setNotice(pendingState.notice ?? pendingMessage);
    const isCurrent = () => canApplyAutomationPlanSaveResult(token, currentSaveContextRef.current);
    try {
      const result = await onSave(pendingState.payload!.plan, pendingState.payload!.token);
      if (!result.plan) {
        if (result.currentScope && isCurrent()) {
          const failureState = transitionAutomationPlannerModalSave(pendingState, { type: "failure", notice: `${failureMessage} ${result.error ?? "Control Plane persistence failed."}` });
          setNotice(failureState.notice ?? failureMessage);
        }
        return false;
      }
      if (!result.currentScope || !isCurrent()) return false;
      const successState = transitionAutomationPlannerModalSave(pendingState, { type: "success", notice: successMessage(result.plan) });
      setNotice(successState.notice ?? successMessage(result.plan));
      return successState.canClose;
    } catch (error) {
      if (isCurrent()) {
        const failureState = transitionAutomationPlannerModalSave(pendingState, { type: "failure", notice: `${failureMessage} ${error instanceof Error ? error.message : "Control Plane persistence failed."}` });
        setNotice(failureState.notice ?? failureMessage);
      }
      return false;
    } finally {
      setActivePlannerSave((current) => current?.draftKey === token.draftKey && current.requestId === token.requestId ? undefined : current);
    }
  };
  const savePlan = async (status: AutomationPlan["status"]): Promise<boolean> => {
    if (planSavePending) return false;
    if (dirtyUpcomingJobEdit) { setNotice("Save or discard the upcoming job time before saving the plan."); return false; }
    if (strategyCatalogLoading || !strategyCatalog || strategyCatalogError) { setNotice(strategyCatalogError || "Strategy catalog is unavailable; open Brand system and load the active catalog before saving."); return false; }
    if (status === "active" && staleCatalogReview.reviewRequired) { setNotice("Matrix updated — review plan and save a fresh strategy snapshot before activation."); return false; }
    if (status === "active" && !brandKit.ready) { setNotice("Link and complete the Brand Kit before activating this plan. You can keep it as a draft."); return false; }
    if (status === "active" && !plan.cron.enabled) { setNotice("Enable the daily cron before activating this plan."); return false; }
    if (status === "active" && scheduleItems.length === 0) { setNotice("Enable at least one platform before activating this plan."); return false; }
    if (status === "active" && selectedPageIds.length === 0) { setNotice("Discover and select at least one Facebook Page before activating this plan."); return false; }
    if (status === "active" && (!plan.generationProfileId || !routeReadiness.ok)) { setNotice(routeReadiness.ok ? "Select one GenerationProfile before activating this plan." : routeReadiness.code === "APP_OPEN_REQUIRED" ? "APP_OPEN_REQUIRED · open the managed subscription browser before activation." : "LLM_PROVIDER_NOT_READY · configure and probe the selected API route before activation."); return false; }
    const prepared = prepareAutomationPlanForSave({ plan: { ...plannerPreviewPlan, status }, catalog: strategyCatalog, scheduleTemplate: plannerPreviewPlan.scheduleTemplate, recipes: contentRecipes });
    if (!prepared.ok) { setNotice(`${prepared.firstError}${prepared.remainingErrors > 0 ? ` · ${prepared.remainingErrors} more error(s)` : ""}`); return false; }
    const next = { ...prepared.plan, status, updatedAt: new Date().toISOString() };
    const finalValidation = validateAutomationPlan(next, strategyCatalog);
    if (!finalValidation.ok) { setNotice(finalValidation.errors[0] ?? "Fix the plan validation errors before saving."); return false; }
    return persistPlan(
      next,
      status === "active" ? "Activating plan in Control Plane…" : "Saving plan to Control Plane…",
      (saved) => saved.status === "active" ? "Automation plan activated. Due runs still create review drafts only." : "Automation plan saved as draft.",
      "Plan was not saved. Your edits are kept.",
    );
  };
  const enabledPlans = AUTOMATION_PLATFORMS.map((platform) => ({ platform, item: plan.platforms[platform], pageId: undefined as string | undefined })).filter(({ item }) => item.enabled);
  const pageFacebookPlans = selectedPageIds.map((pageId) => ({ platform: "facebook" as const, item: plan.pagePlans?.[pageId]?.facebook ?? plan.platforms.facebook, pageId }));
  const scheduleItems = selectedPageIds.length > 0
    ? [...enabledPlans.filter(({ platform }) => platform !== "facebook"), ...pageFacebookPlans]
    : enabledPlans;
  const totals = scheduleItems.reduce((result, entry) => ({ posts: result.posts + entry.item.postsPerDay, images: result.images + entry.item.imageCount, videos: result.videos + entry.item.videoCount }), { posts: 0, images: 0, videos: 0 });
  const upcomingJobs = useMemo(() => buildUpcomingAutomationJobs(plan, new Date(), (pageId) => bindingIdForPage(pageId)), [plan, selectedPageIds.join("|")]);
  const selectedUpcomingJob = upcomingJobs.find((candidate) => candidate.id === selectedUpcomingJobId);
  const editingJob = upcomingJobs.find((candidate) => candidate.id === editingUpcomingJob);
  const dirtyUpcomingJobEdit = Boolean(editingJob && editingJob.publishTime !== editingUpcomingTime);
  const hasUnsavedChanges = draftDirty || dirtyUpcomingJobEdit || planSavePending;
  const strategySaveBlocked = plannerStrategySaveBlocked({ catalogLoading: strategyCatalogLoading, hasCatalog: Boolean(strategyCatalog), catalogError: strategyCatalogError, previewOk: plannerPreview.ok, staleReviewRequired: staleCatalogReview.reviewRequired });
  const preventPlanChange = () => {
    if (!hasUnsavedChanges) return false;
    setNotice(planSavePending ? "Plan persistence is still pending; wait for its result before switching plans." : "Save or discard the current plan/job edits before switching plans or creating another plan.");
    return true;
  };
  const openUpcomingJob = (job: typeof upcomingJobs[number]) => {
    if (!canInteractWithUpcomingJobs(planSavePending)) { setNotice("Wait for plan persistence to finish before opening a job."); return; }
    if (dirtyUpcomingJobEdit) { setNotice("Save or discard this job time before opening another job."); return; }
    storePlannerDraft(plan, { dirty: draftDirty, selectedJobId: job.id, editingJobId: "", editingTime: "" });
  };
  const editUpcomingJob = (job: typeof upcomingJobs[number]) => {
    if (!canInteractWithUpcomingJobs(planSavePending)) { setNotice("Wait for plan persistence to finish before editing a job."); return; }
    if (hasUnsavedChanges && !(editingUpcomingJob === job.id && !dirtyUpcomingJobEdit)) { setNotice("Save or discard the current plan/job edits before editing another job."); return; }
    storePlannerDraft(plan, { dirty: draftDirty, selectedJobId: job.id, editingJobId: job.id, editingTime: job.publishTime });
  };
  const discardUpcomingJobEdit = () => {
    if (planSavePending) { setNotice("Wait for plan persistence to finish before discarding the job edit."); return; }
    storePlannerDraft(plan, { dirty: draftDirty, selectedJobId: selectedUpcomingJobId, editingJobId: "", editingTime: "" });
    setNotice("Unsaved job time discarded.");
  };
  const saveUpcomingJob = async () => {
    if (planSavePending) return;
    const job = upcomingJobs.find((candidate) => candidate.id === editingUpcomingJob);
    if (!job || !/^([01]\d|2[0-3]):[0-5]\d$/.test(editingUpcomingTime)) { setNotice("Upcoming job time must use HH:mm."); return; }
    const submittedTime = editingUpcomingTime;
    const revision = (plan.revision ?? 1) + 1;
    let next: AutomationPlan = { ...plan, revision, updatedAt: new Date().toISOString() };
    if (job.pageId) {
      const currentPage = plan.pagePlans?.[job.pageId] ?? { ...plan.platforms };
      const currentFacebook = currentPage.facebook;
      const updatedFacebook = { ...currentFacebook, publishTimes: currentFacebook.publishTimes.map((time, index) => index === job.postIndex ? submittedTime : time) };
      next = { ...next, pagePlans: { ...(plan.pagePlans ?? {}), [job.pageId]: { ...currentPage, facebook: updatedFacebook } } };
      if (plan.targetPageIds?.[0] === job.pageId) next.platforms = { ...plan.platforms, facebook: updatedFacebook };
      const bindingId = job.bindingId ?? bindingIdForPage(job.pageId);
      const bindingSchedule = bindingId ? plan.bindingSchedules?.[bindingId] : undefined;
      if (bindingId && bindingSchedule?.mode === "independent") next.bindingSchedules = { ...(plan.bindingSchedules ?? {}), [bindingId]: { ...bindingSchedule, publishTimes: updatedFacebook.publishTimes } };
    } else {
      const currentPlatform = plan.platforms[job.platform];
      next.platforms = { ...plan.platforms, [job.platform]: { ...currentPlatform, publishTimes: currentPlatform.publishTimes.map((time, index) => index === job.postIndex ? submittedTime : time) } };
    }
    const persistedNext = next.status === "active" && !next.generationProfileId ? { ...next, status: "draft" as const } : next;
    await persistPlan(
      persistedNext,
      "Saving job revision to Control Plane…",
      (saved) => saved.status === "draft" && next.status === "active" ? "Job revision saved as a draft because this plan has no verified GenerationProfile." : "Upcoming job revision saved as an authoritative plan revision.",
      "Job revision was not saved; the current plan/job draft is kept.",
    );
  };
  const createNewPlan = (trigger?: HTMLElement) => {
    if (preventPlanChange()) return;
    const now = new Date();
    const seed = createAutomationPlan(activeClientId, activeBrand.id, workspace.timezone, now);
    const campaignId = `campaign-${activeClientId}-${activeBrand.id}-${now.getTime()}`;
    const dateKey = now.toISOString().slice(0, 10);
    const next = { ...seed, id: `automation-${activeClientId}-${activeBrand.id}-${now.getTime()}`, name: `Kế hoạch ${scopedPlans.length + 1}`, campaignId, campaignStartAt: undefined, campaignEndAt: undefined, dateRange: { startDate: dateKey, endDate: dateKey }, strategySelection: { objective: "mix" as const, pillar: "mix" as const, angle: "mix" as const }, ...(scheduleTemplate ? { scheduleTemplate: { ...structuredClone(scheduleTemplate), campaignId, brandId: activeBrand.id, source: "campaign_clone" as const } } : {}) };
    planModalTriggerRef.current = trigger ?? createPlanTriggerRef.current;
    onSelectionChange(scopeKey, next.id, plannerScopeGeneration);
    storePlannerDraft(next, { dirty: true, selectedJobId: undefined, editingJobId: "", editingTime: "" });
    setPlanModal(createAutomationPlannerModalState(activeScope, "create", next, selectedPlanId));
    setNotice("");
  };
  const editCurrentPlan = (trigger?: HTMLElement) => {
    if (!storedPlan || preventPlanChange()) return;
    planModalTriggerRef.current = trigger ?? createPlanTriggerRef.current;
    setPlanModal(createAutomationPlannerModalState(activeScope, "edit", plan, selectedPlanId ?? plan.id));
  };
  const selectPlan = (id: string) => {
    if (id === selectedPlanId || preventPlanChange()) return;
    onSelectionChange(scopeKey, id, plannerScopeGeneration);
  };
  const nextRun = plan.cron.enabled ? `Daily at ${plan.cron.startTime} · ${plan.cron.timezone}` : "Cron paused";
  const renderScheduleEditor = (platform: SocialPlatform, item: AutomationPlatformPlan, pageId?: string) => {
    const pageName = pageId ? discoveredPages.find((account) => account.id === pageId)?.name ?? "Facebook Page" : undefined;
    const bindingId = pageId ? bindingIdForPage(pageId) : undefined;
    const bindingSchedule = pageId ? plan.bindingSchedules?.[bindingId!] ?? { mode: "inherit_facebook" as const } : undefined;
    const label = pageName ?? `${platform[0].toUpperCase()}${platform.slice(1)}`;
    const toggle = () => pageId ? updatePageFacebook(pageId, togglePageFacebookEnabled(item)) : togglePlatform(platform);
    const update = (patch: Partial<AutomationPlatformPlan>) => pageId ? updatePageFacebook(pageId, patch) : updatePlatform(platform, patch);
    const updateTime = (index: number, value: string) => pageId ? updatePageFacebookTime(pageId, index, value) : updatePlatformTime(platform, index, value);
    const toggleDay = (day: number) => pageId ? togglePageDay(pageId, day) : togglePlatformDay(platform, day);
    const setCron = () => setDailyCron(platform, pageId);
    return <div className={`planner-platform-row ${item.enabled ? "enabled" : ""}`} key={`${platform}-${pageId ?? "shared"}`}>
      <div className="planner-platform-head"><div><strong>{label}</strong><span>{item.enabled ? `${item.postsPerDay} post${item.postsPerDay === 1 ? "" : "s"} per day` : "Not included in this plan"}</span>{pageId && <small>Facebook Page · {bindingSchedule?.mode === "inherit_facebook" ? "inherits source schedule" : "independent cadence"}</small>}</div><button type="button" className={`toggle ${item.enabled ? "on" : ""}`} aria-label={`Enable ${label} plan`} aria-pressed={item.enabled} onClick={toggle}><i/></button></div>
      {item.enabled && <>
        {pageId && <label className="field-label">Schedule mode<select value={bindingSchedule?.mode} onChange={(event) => updateBindingSchedule(bindingId!, event.target.value === "independent" ? { mode: "independent", postsPerDay: item.postsPerDay, imageCount: item.imageCount, videoCount: item.videoCount, publishTimes: item.publishTimes, runDays: item.runDays } : { mode: "inherit_facebook" })}><option value="inherit_facebook">Inherit Facebook/source schedule</option><option value="independent">Independent cadence</option></select></label>}
        <div className="planner-count-fields"><label className="field-label">Posts/day<input type="number" min="0" value={item.postsPerDay} onChange={(event) => update({ postsPerDay: Number(event.target.value) })}/></label><label className="field-label">Images<input type="number" min="0" value={item.imageCount} onChange={(event) => update({ imageCount: Number(event.target.value) })}/></label><label className="field-label">Videos<input type="number" min="0" value={item.videoCount} onChange={(event) => update({ videoCount: Number(event.target.value) })}/></label></div>
        <div className="planner-run-days"><span className="field-label">Run days</span><div>{dayLabels.map((dayLabel, dayIndex) => <button type="button" className={runDaysFor(item).includes(dayIndex + 1) ? "selected" : ""} key={`${platform}-${pageId ?? "shared"}-day-${dayIndex + 1}`} aria-pressed={runDaysFor(item).includes(dayIndex + 1)} onClick={() => toggleDay(dayIndex + 1)}>{dayLabel}</button>)}</div></div>
        <button type="button" className="text-button planner-cron-action" onClick={setCron}>{plan.cronSchedules?.[cronScopeKey(platform, pageId)]?.enabled ? pageId ? "Daily Cron set for this Page" : "Daily Cron set" : pageId ? "Set daily Cron for this Page" : "Set daily Cron"}</button>
        <div className="planner-time-grid">{item.publishTimes.map((time, index) => <label className="field-label" key={`${platform}-${pageId ?? "shared"}-${index}`}>Post {index + 1}<input type="time" value={time} onChange={(event) => updateTime(index, event.target.value)}/></label>)}</div>
        <small className="planner-mix-note">Media assignment: first {item.imageCount} time{item.imageCount === 1 ? "" : "s"} = image; remaining {item.videoCount} = video.</small>
      </>}
    </div>;
  };
  const plannerEditor = <div className="planner-layout planner-modal-layout">
    <article className="panel planner-card planner-plan-meta-card"><PanelHeading kicker="PLAN" title={plannerModalProjection.metadata.name || "Kế hoạch mới"}/><div className="planner-fields"><label className="field-label">Plan name<input ref={planModalNameRef} value={plannerModalProjection.metadata.name} onChange={(event) => updatePlan({ name: event.target.value })} placeholder="Ví dụ: Nội dung thường ngày" /></label><label className="field-label">Campaign start<input type="date" value={campaignStartDate} aria-invalid={typeof campaignStartDateResult !== "string"} onChange={(event) => updateCampaignDate("start", event.target.value)} /></label><label className="field-label">Campaign end<input type="date" value={campaignEndDate} aria-invalid={typeof campaignEndDateResult !== "string"} onChange={(event) => updateCampaignDate("end", event.target.value)} /></label><small className="planner-help">Campaign dates use the plan timezone: {plan.cron.timezone}.</small></div>{campaignDateErrors.length > 0 && <div className="planner-errors" role="alert">{campaignDateErrors.map((error) => <span key={error}>· {error}</span>)}</div>}</article>
    <article className="panel planner-card"><PanelHeading kicker="PLAN SCOPE" title="Brand and assets"/><div className="planner-fields"><div className="planner-brand-value"><span className="field-label">Active brand</span><strong>{activeBrand.name}</strong><small>Brand context is inherited from the active workspace scope.</small></div><div className="planner-status" role="button" tabIndex={0} aria-label="Open Brand system" onClick={() => onSelect("Brand system")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect("Brand system"); } }}><span className={`status-pill ${brandKit.ready ? "published" : "failed"}`}>{brandKit.ready ? "Brand Kit ready" : "Brand Kit incomplete"}</span><small>{activeBrand.status} · {brandVoice ? "voice configured" : "voice missing"}</small></div></div><div className="planner-pages-heading"><strong>Target bindings</strong><span>{selectedBindingIds.length} selected · discovery required for live runs</span></div><div className="planner-page-list">{discoveredPages.length === 0 ? <div className="empty-state">No discovered Pages. Open Settings → Meta and run Discover Page + Instagram.</div> : <FacebookTargetPicker pages={discoveredPages} selectedPageIds={selectedPageIds} onToggle={togglePage}/>} {unavailableTargets.map((target) => { const stateLabel = target.state === "not_configured" ? "Not configured" : target.state === "needs_reauth" ? "Needs reauth" : target.state === "review_required" ? "Review required" : "Not configured · adapter deferred"; const recovery = target.state === "not_configured" || target.state === "unsupported" ? "Link" : target.state === "needs_reauth" ? "Reconnect" : ""; return <div className="planner-page disabled" key={target.platform + "-" + target.id}><input type="checkbox" disabled/><span className={`planner-page-icon ${target.platform}`}><BetterPlatformIcon name={target.platform} /></span><span><strong>{target.name}</strong><small>{targetPlatformLabel(target.platform)} · {stateLabel}</small></span>{recovery && onBeginConnection && <button type="button" className="secondary-button binding-recovery-button" onClick={() => void onBeginConnection(target.platform)}>{recovery}</button>}</div>; })}</div><div className="planner-auto-media"><div className="planner-assets-heading"><div><strong>Automatic visual media selection</strong><span>Eligible Client/Brand inventory is selected per Content Run.</span></div><span>{plannerAssets.length} visual · {plannerExcludedCount} audio/unknown excluded</span></div><div className="planner-asset-rollup" aria-label="Planner media roll-up"><span className="positive"><strong>{plannerAssets.filter((asset) => mediaBlockers(asset).length === 0).length}</strong> eligible for automatic selection</span><span className="muted"><strong>{plannerModalProjection.scope.selectedAssetIds.length}</strong> explicitly selected asset(s)</span><span className="warning"><strong>{plannerAssets.filter((asset) => mediaBlockers(asset).length > 0).length}</strong> require review</span></div><p id="planner-media-help" className="planner-help">Image posts may generate a review-first visual through a verified provider. Video posts require verified media. Public URL, SHA-256, decoded fingerprint, duplicate, reservation and human-approval gates remain required.</p></div></article>
    <PlannerStrategySection activeBrandName={activeBrand.name} catalog={strategyCatalog} catalogRevision={strategyCatalogRevision} catalogLoading={strategyCatalogLoading} catalogError={strategyCatalogError} selection={plannerSelection} choices={strategyChoices} preview={plannerPreview} stale={staleCatalogReview.reviewRequired} onChange={updateStrategySelection}/><article className="panel planner-card"><PanelHeading kicker="DAILY AUTOMATION" title="Cadence and generation route"/><div className="rule-row"><div><strong>Run daily</strong><span>Creates Needs review AI drafts; never publishes directly.</span></div><button type="button" className={`toggle ${plan.cron.enabled ? "on" : ""}`} aria-label="Enable daily automation" aria-pressed={plan.cron.enabled} onClick={() => updatePlan({ cron: { ...plan.cron, enabled: !plan.cron.enabled } })}><i/></button></div><div className="planner-fields"><label className="field-label">Start time<input type="time" value={plan.cron.startTime} onChange={(event) => updatePlan({ cron: { ...plan.cron, startTime: event.target.value } })}/></label><label className="field-label">Timezone<input value={plan.cron.timezone} onChange={(event) => updatePlan({ cron: { ...plan.cron, timezone: event.target.value } })} placeholder="Asia/Ho_Chi_Minh"/></label></div><div className="planner-next-run"><span>Next-run summary</span><strong>{nextRun}</strong><small>{automationSchedulerNote}</small></div><div className="planner-route-card"><div><strong>GenerationProfile</strong><span>{plan.generationProfileId ?? "Not selected"}</span></div><span className={`status-pill ${routeReadiness.ok ? "published" : "failed"}`}>{routeReadiness.ok ? `${activeRouteProfile?.mode} · ${activeRouteProfile?.provider}` : routeReadiness.code}</span>{activeRouteProfile && <button type="button" className="secondary-button" onClick={() => updatePlan({ generationProfileId: `profile-${activeRouteProfile.mode}-${activeRouteProfile.provider}` })}>Use current route</button>}<small>One route per run. Provider errors retry the same route; switching requires a new run.</small></div></article>
    <article className="panel planner-card"><PanelHeading kicker="PLATFORM RHYTHM" title="Posts and publish times"/><p className="planner-help">Configure posts/day, image/video mix, exact publish times and run days in this plan.</p><div className="planner-platform-list">{AUTOMATION_PLATFORMS.filter((platform) => !(platform === "facebook" && selectedPageIds.length > 0)).map((platform) => renderScheduleEditor(platform, plan.platforms[platform]))}</div>{!validation.ok && <div className="planner-errors" role="alert"><strong>Plan needs attention</strong>{validation.errors.map((error) => <span key={error}>· {error}</span>)}</div>}</article>
    {selectedPageIds.length > 0 && <article className="panel planner-card"><PanelHeading kicker="FACEBOOK PAGE RHYTHM" title="Per-Page posts and publish times"/><p className="planner-help">Each selected Facebook Page has its own daily count, image/video mix and exact local times.</p><div className="planner-platform-list">{pageFacebookPlans.map(({ pageId, item }) => renderScheduleEditor("facebook", item, pageId))}</div></article>}
  </div>;
  const savePlanFromModal = async (status: AutomationPlan["status"]) => {
    const saved = await savePlan(status);
    if (saved) closePlanModal(false);
  };
  return <section className="expanded-view planner-view">
    <ViewHeader kicker="VẬN HÀNH TỰ ĐỘNG" title="Kế hoạch tự động" subtitle="Thiết kế nhịp đăng review-first cho brand đang chọn. Kế hoạch không bao giờ bỏ qua phê duyệt thủ công." />
    <div className="planner-create-bar"><div><span className="panel-kicker">AUTOMATION PLANS</span><strong>{scopedPlans.length} kế hoạch cho {activeBrand.name}</strong><small>Mỗi kế hoạch có lịch, Page và trạng thái riêng.</small></div><button ref={createPlanTriggerRef} className="primary-button" type="button" onClick={(event) => createNewPlan(event.currentTarget)}>Tạo kế hoạch tự động <span>＋</span></button></div>
    <div className="planner-scope-strip"><strong>Brand and assets</strong><span>{activeBrand.name} · {plannerAssets.length} media đủ điều kiện · {selectedPageIds.length} Page đã chọn</span><button type="button" className="text-button" onClick={() => onSelect("Brand system")}>Mở Brand system →</button></div>
    {scopedPlans.length > 0 && <div className="planner-plan-list" role="list" aria-label="Danh sách kế hoạch tự động">{scopedPlans.map((candidate) => { const display = automationPlanDisplayState(candidate, strategyCatalog); return <button type="button" role="listitem" className={`planner-plan-chip ${candidate.id === plan.id ? "selected" : ""}`} key={candidate.id} onClick={() => selectPlan(candidate.id)}><strong>{candidate.name ?? candidate.id}</strong><span>{display.label}</span><small>{candidate.id}</small></button>; })}</div>}
    {notice && <div className="queue-notice"><span className="online-dot"/><span>{notice}</span></div>}
    {!brandKit.ready && <div className="planner-warning"><strong>Complete Brand System before generation</strong><span>{brandKit.missing.join(" · ")}. You can still save a draft plan and return to the Brand system when ready.</span><button className="secondary-button" onClick={() => onSelect("Brand system")}>Open Brand system <span>↗</span></button></div>}
    <article className="panel planner-card planner-plan-summary"><PanelHeading kicker="PLAN SUMMARY" title={plannerModalProjection.metadata.name || "Kế hoạch mới"}/><div className="detail-grid"><span>Plan</span><strong>{plannerModalProjection.metadata.name || "Kế hoạch mới"}</strong><span>Objective</span><strong>{strategyLabel("objective")}</strong><span>Content pillar</span><strong>{strategyLabel("pillar")}</strong><span>Angle</span><strong>{strategyLabel("angle")}</strong><span>Campaign dates</span><strong>{campaignStartDate || "Any start"} → {campaignEndDate || "No end"}</strong><span>Timezone</span><strong>{plannerModalProjection.cadence.cron.timezone}</strong></div><div className="planner-account-breakdown"><strong>Brand and assets</strong><span>{activeBrand.name} · {plannerAssets.length} eligible visual asset(s) · {plannerModalProjection.scope.selectedAssetIds.length} explicitly selected</span><strong>Target bindings</strong><span>{selectedBindingIds.length ? selectedBindingIds.join(" · ") : "No Facebook Page binding selected"}</span></div><div className="planner-summary-grid"><div><span>Target Pages</span><strong>{selectedPageIds.length}</strong></div><div><span>Total posts/day</span><strong>{totals.posts}</strong></div><div><span>Images/day</span><strong>{totals.images}</strong></div><div><span>Videos/day</span><strong>{totals.videos}</strong></div></div><div className="planner-schedule-summary">{scheduleItems.length === 0 ? <div className="empty-state">Enable a platform or Facebook Page cadence in the editor.</div> : scheduleItems.map(({ platform, item, pageId }) => <div key={`${platform}-${pageId ?? "shared"}`}><strong>{pageId ? `${discoveredPages.find((account) => account.id === pageId)?.name ?? "Facebook Page"} · ` : ""}{platform[0].toUpperCase() + platform.slice(1)}</strong><span>{item.publishTimes.map((time, index) => `${time} · ${index < item.imageCount ? "image" : "video"}`).join(" · ")} · {item.imageCount} image / {item.videoCount} video</span></div>)}</div><div className="planner-actions"><span className={`status-pill ${planDisplay.reviewRequired ? "failed" : plan.status === "active" ? "published" : "draft"}`}>{planDisplay.label}</span><button type="button" className="primary-button" onClick={(event) => storedPlan ? editCurrentPlan(event.currentTarget) : createNewPlan(event.currentTarget)}>{storedPlan ? "Edit plan" : "Create plan"}</button></div></article>
      <article className="panel planner-card planner-upcoming-card"><PanelHeading kicker="UPCOMING JOBS" title={`${upcomingJobs.length} editable job(s)`}/><p className="planner-help">Jobs are sorted by next action. Open a row for detail, then use the separate Edit action to create an authoritative revision.</p><div className="planner-upcoming-list">{upcomingJobs.length === 0 ? <div className="empty-state">No upcoming jobs. Enable a platform or Page cadence first.</div> : upcomingJobs.map((job) => <div className="planner-upcoming-item" key={job.id}><button type="button" className={`planner-upcoming-row ${selectedUpcomingJob?.id === job.id ? "selected" : ""}`} disabled={!canInteractWithUpcomingJobs(planSavePending)} onClick={() => openUpcomingJob(job)}><span>{new Date(job.nextActionAt).toLocaleString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><strong>{job.pageId ? discoveredPages.find((account) => account.id === job.pageId)?.name ?? "Facebook Page" : job.platform}</strong><em>{job.mediaKind} · post {job.postIndex + 1}</em><small>View detail →</small></button><button type="button" className="text-button planner-edit-button" disabled={!canInteractWithUpcomingJobs(planSavePending)} onClick={(event) => { event.stopPropagation(); editUpcomingJob(job); }}>Edit</button></div>)}</div>{selectedUpcomingJob && <div className="planner-job-detail"><div><strong>{selectedUpcomingJob.platform}{selectedUpcomingJob.pageId ? ` · ${discoveredPages.find((account) => account.id === selectedUpcomingJob.pageId)?.name ?? "Facebook Page"}` : ""}</strong><span>Next action {new Date(selectedUpcomingJob.nextActionAt).toLocaleString("vi-VN")}</span><small>{selectedUpcomingJob.contentKind} · {selectedUpcomingJob.mediaKind} · revision {selectedUpcomingJob.revision}</small></div><button type="button" className="secondary-button" disabled={!canInteractWithUpcomingJobs(planSavePending)} onClick={() => editUpcomingJob(selectedUpcomingJob)}>Edit</button></div>}{editingUpcomingJob && <div className="planner-job-editor"><label className="field-label">Job time<input type="time" value={editingUpcomingTime} disabled={planSavePending} onChange={(event) => storePlannerDraft(plan, { dirty: draftDirty || event.target.value !== editingJob?.publishTime, selectedJobId: selectedUpcomingJobId, editingJobId: editingUpcomingJob, editingTime: event.target.value })} /></label><button type="button" className="secondary-button" disabled={planSavePending} onClick={discardUpcomingJobEdit}>Discard</button><button type="button" className="primary-button" disabled={planSavePending} onClick={() => void saveUpcomingJob()}>{planSavePending ? "Saving…" : "Save job revision"}</button></div>}</article>
    {planModal && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="automation-plan-modal-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closePlanModal(); }}>
      <section ref={createPlanDialogRef} className="composer-modal review-detail-modal planner-modal" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closePlanModal(); } else trapDialogTab(event, createPlanDialogRef.current); }}>
        <div className="modal-heading"><div><p className="panel-kicker">AUTOMATION PLAN</p><h2 id="automation-plan-modal-title">{planModal.mode === "edit" ? "Edit automation plan" : "Create automation plan"}</h2><span>{planModal.mode === "edit" ? "Edit the selected plan in one shared draft." : "Configure the local draft, then save it through Control Plane."}</span></div><button type="button" className="close-button" aria-label="Close automation plan editor" onClick={() => closePlanModal()}>×</button></div>
        {notice && <div className="queue-notice" role="status" aria-live="polite"><span className="online-dot"/><span>{notice}</span></div>}
        {plannerEditor}
        <div className="composer-foot"><span>{planModal.mode === "edit" ? "Cancel discards unsaved edits." : "This local draft is not persisted until save is acknowledged."}</span>{!reviewOnlyGuard.ok && <small id="planner-review-only-help" className="planner-action-help" role="status">{reviewOnlyGuard.message}</small>}<button type="button" className="secondary-button" disabled={planSavePending} onClick={() => closePlanModal()}>Cancel</button><button type="button" className="secondary-button" disabled={planSavePending || strategySaveBlocked} onClick={() => void savePlanFromModal("draft")}>{planSavePending ? "Saving…" : "Save draft"}</button><button type="button" className="secondary-button" aria-describedby={!reviewOnlyGuard.ok ? "planner-review-only-help" : undefined} title={!reviewOnlyGuard.ok ? reviewOnlyGuard.message : undefined} disabled={plannerRunBusy || planSavePending || strategySaveBlocked || staleCatalogReview.reviewRequired || !reviewOnlyScope} onClick={() => { if (reviewOnlyScope) void onRunReviewOnlyAutomationPlan(reviewOnlyScope); }}>{plannerRunBusy ? "Running review-only…" : "Run once now · review-only"}</button><button type="button" className="primary-button" disabled={planSavePending || strategySaveBlocked || staleCatalogReview.reviewRequired || !validation.ok || !brandKit.ready || !plan.cron.enabled || scheduleItems.length === 0 || selectedPageIds.length === 0} onClick={() => void savePlanFromModal("active")}>{planSavePending ? "Activating…" : "Activate plan"}</button></div>
      </section>
    </div>}
  </section>;
}

function ReviewView({ drafts, reviewCount, onApprove, onReject, onExportManualPackage, onRegenerateDraft, onDeleteDraft, onPublishDraft, onReschedule, onCancel, onDraftTargetAction, currentMembership, connectionDisplayNames = {}, draftActionFeedbackByDraftId = {}, publishBlockersByDraftId = {}, onActiveActionDraftChange }: Pick<Props, "drafts" | "reviewCount" | "onApprove" | "onReject" | "onExportManualPackage" | "onRegenerateDraft" | "onDeleteDraft" | "onPublishDraft" | "onReschedule" | "onCancel" | "onDraftTargetAction" | "currentMembership" | "connectionDisplayNames" | "draftActionFeedbackByDraftId" | "publishBlockersByDraftId" | "onActiveActionDraftChange">) {
  const [filter, setFilter] = useState<"All" | DraftStatus>("Needs review");
  const [selectedDraftId, setSelectedDraftId] = useState<number | undefined>();
  const selectedDraft = selectedDraftId === undefined ? undefined : drafts.find((draft) => draft.id === selectedDraftId);
  const reviewModalRef = useRef<HTMLElement>(null);
  const reviewCloseRef = useRef<HTMLButtonElement>(null);
  const reviewTriggerRef = useRef<HTMLElement | null>(null);
  const activeDraftChangeRef = useRef(onActiveActionDraftChange);
  activeDraftChangeRef.current = onActiveActionDraftChange;
  const closeReviewDetail = () => { setSelectedDraftId(undefined); window.requestAnimationFrame(() => reviewTriggerRef.current?.focus()); };
  const openReviewDetail = (draftId: number, trigger: HTMLElement) => { reviewTriggerRef.current = trigger; setSelectedDraftId(draftId); };
  useEffect(() => { if (selectedDraft) window.requestAnimationFrame(() => reviewCloseRef.current?.focus()); }, [selectedDraft?.id]);
  useEffect(() => { activeDraftChangeRef.current?.(selectedDraft?.id); }, [selectedDraft?.id]);
  useEffect(() => () => activeDraftChangeRef.current?.(undefined), []);
  const filtered = useMemo(() => filter === "All" ? drafts : drafts.filter((draft) => draft.status === filter), [drafts, filter]);
  const canApprove = currentMembership ? canRole(currentMembership.role, "approve_content") : false;
  return <section className="expanded-view"><div className="view-header"><div><p className="eyebrow">QUALITY CONTROL</p><h1>Review inbox <span className="count-badge">{reviewCount}</span></h1><p className="hero-subtitle">Approve per target only after identity, media, preflight and provider evidence are visible.</p></div><div className="review-summary"><strong>{reviewCount}</strong><span>waiting for review</span></div></div><div className="review-toolbar"><div className="filter-tabs">{["All", "Needs review", "Scheduled", "Published"].map((item) => <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item as "All" | DraftStatus)}>{item}</button>)}</div><span className="safe-note"><span className="online-dot"/> Approval gate {canApprove ? "active" : "view-only"}</span></div><article className="panel review-table"><div onClick={(event) => { const row = (event.target as HTMLElement).closest<HTMLElement>("[data-review-id]"); const id = row?.dataset.reviewId; if (id) openReviewDetail(Number(id), row!); }}><ContentTable drafts={filtered} onApprove={onApprove} canApprove={canApprove} actionFeedbackByDraftId={draftActionFeedbackByDraftId} publishBlockersByDraftId={publishBlockersByDraftId} onReject={canApprove ? onReject : undefined} onExportManualPackage={onExportManualPackage} onRegenerate={onRegenerateDraft} onDelete={onDeleteDraft} onPublish={onPublishDraft} onReschedule={onReschedule} onCancel={onCancel} onDraftTargetAction={onDraftTargetAction} connectionDisplayNames={connectionDisplayNames} detailed/></div></article>{selectedDraft && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Content detail ${selectedDraft.title}`} onMouseDown={closeReviewDetail}><section className="composer-modal review-detail-modal" ref={reviewModalRef} tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeReviewDetail(); } if (event.key === "Tab") { const focusable = Array.from(reviewModalRef.current?.querySelectorAll<HTMLElement>("button, input, textarea, select, [tabindex]:not([tabindex=\"-1\"])") ?? []); const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }} onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="panel-kicker">CONTENT DETAIL</p><h2>{selectedDraft.title}</h2><span>{selectedDraft.platform} · {selectedDraft.status}</span></div><button className="close-button" ref={reviewCloseRef} onClick={closeReviewDetail}>×</button></div><div className="detail-grid"><span>Content Run</span><strong>{selectedDraft.contentRunId ?? "Not recorded"}</strong><span>Identity version</span><strong>{selectedDraft.identityVersionId ?? "Not recorded"}</strong><span>Execution route</span><strong>{selectedDraft.executionMode ?? "Not recorded"} · {selectedDraft.generationProfileId ?? "No profile"}</strong><span>Provider trace</span><strong>{selectedDraft.providerTraceId ?? selectedDraft.ideaProvider ?? "Not recorded"}</strong><span>Target bindings</span><strong>{targetDisplayNamesFor(selectedDraft, connectionDisplayNames)}</strong><span>Transform</span><strong>{selectedDraft.transformMode ?? "original"}{selectedDraft.sourceRef ? ` · ${selectedDraft.sourceRef}` : ""}</strong></div><article className="panel detail-copy review-structured-fields"><strong>Structured post fields</strong><dl className="review-field-list"><dt>Topic</dt><dd>{selectedDraft.topic ?? selectedDraft.title}</dd><dt>Content pillar</dt><dd>{selectedDraft.contentPillar ?? "Not recorded"}</dd><dt>Objective</dt><dd>{selectedDraft.objective ?? "Not recorded"}</dd><dt>Caption</dt><dd>{selectedDraft.body ?? "Not recorded"}</dd><dt>CTA</dt><dd>{selectedDraft.cta ?? "Not recorded"}</dd><dt>Hashtags</dt><dd>{selectedDraft.hashtags?.join(" ") || "Not recorded"}</dd><dt>SEO keywords</dt><dd>{selectedDraft.seoKeywords?.join(", ") || "Not recorded"}</dd><dt>Scheduled at</dt><dd>{selectedDraft.scheduledAt ?? "Not scheduled"}</dd><dt>Sources</dt><dd>{selectedDraft.sources?.join(" · ") || "Not recorded"}</dd><dt>Notes</dt><dd>{selectedDraft.notes ?? "Not recorded"}</dd><dt>Strategy rationale</dt><dd>{selectedDraft.strategyRationale ?? "Not recorded"}</dd><dt>Research brief</dt><dd>{selectedDraft.researchState ?? "NOT_SELECTED"} · {selectedDraft.researchSourceCount ?? selectedDraft.sources?.length ?? 0} source(s){selectedDraft.researchScore !== undefined ? ` · score ${selectedDraft.researchScore}` : ""}</dd><dt>Quality</dt><dd>{selectedDraft.qualityStatus ?? "pending"} · {selectedDraft.qualityChecks?.filter((check) => check.ok).length ?? 0}/{selectedDraft.qualityChecks?.length ?? 0} checks</dd><dt>Media operations</dt><dd>{selectedDraft.mediaOperations?.map((operation) => `${operation.kind}:${operation.status}:${operation.provider ?? "unconfigured"}`).join(" · ") || "Not recorded"}</dd><dt>Targets</dt><dd>{targetDisplayNamesFor(selectedDraft, connectionDisplayNames)}</dd></dl></article><article className="panel detail-copy"><strong>Complete copy</strong><p>{selectedDraft.body ?? "No copy recorded."}</p>{selectedDraft.hashtags?.length ? <small>#{selectedDraft.hashtags.join(" #")}</small> : null}</article><article className="panel detail-copy"><strong>Media preview</strong>{selectedDraft.mediaUrl ? <img className="media-preview-image" src={selectedDraft.mediaUrl} alt={selectedDraft.title} /> : <p>No media attached to this variant.</p>}<small>Media provenance: {selectedDraft.mediaProvenance?.source ? String(selectedDraft.mediaProvenance.source) : "not recorded"} · asset IDs: {selectedDraft.mediaAssetIds?.join(", ") || "none"}</small></article><article className="panel detail-copy"><strong>Audit/preflight</strong><p>Approval state, target capability, identity version, media eligibility, schedule and idempotency are checked before enqueue. Provider retry stays on this route.</p></article><article className="panel detail-copy"><strong>Recipe / transform quality checks</strong><p>Source rights: {selectedDraft.sourceRef ? "recorded for review" : "no external source"} · identity match: {selectedDraft.identityVersionId ? "recorded" : "missing"} · factual review reminder · platform fit · transform trace: {selectedDraft.transformMode ?? "original"} · recipe: {selectedDraft.recipeId ?? "none"}.</p></article><div className="draft-action-feedback" aria-live="polite">{(["quality", "approval", "publish"] as const).map((action) => { const feedback = draftActionFeedbackByDraftId[selectedDraft.id]?.[action]; return feedback ? <p key={action} className={feedback.status} role={feedback.status === "failure" ? "alert" : "status"}>{action}: {feedback.message}</p> : null; })}{publishBlockersByDraftId[selectedDraft.id] && <p role="status">{publishBlockersByDraftId[selectedDraft.id]}</p>}</div><div className="composer-foot"><span>{canApprove ? "Reviewer action is per target." : "Analyst/view-only role cannot approve, edit bindings or publish."}</span>{selectedDraft.status === "Scheduled" && <button type="button" className="secondary-button" disabled={!onPublishDraft || Boolean(publishBlockersByDraftId[selectedDraft.id]) || Boolean(draftActionFeedbackByDraftId[selectedDraft.id]?.publish?.status === "running" || draftActionFeedbackByDraftId[selectedDraft.id]?.publish?.status === "pending")} onClick={() => void onPublishDraft?.(selectedDraft.id)}>Publish</button>}{selectedDraft.status === "Needs review" && <button className="primary-button" disabled={!canApprove || Boolean(selectedDraft.pendingPublicationIds?.length) || [draftActionFeedbackByDraftId[selectedDraft.id]?.quality, draftActionFeedbackByDraftId[selectedDraft.id]?.approval].some((item) => item?.status === "running" || item?.status === "pending")} title={!canApprove ? "View-only · approve_content permission required" : undefined} onClick={() => void onApprove(selectedDraft.id)}>{draftActionFeedbackByDraftId[selectedDraft.id]?.approval?.status === "running" ? "Approving…" : "Approve target"}</button>}</div></section></div>}</section>;
}

function CreativeRunsPanel({ workspaceId, connectionDisplayNames = {}, creativeRuns, imageProvider, onImageProviderChange, videoProvider, onVideoProviderChange, onRetryCreativeRun }: { workspaceId: string; connectionDisplayNames?: Props["connectionDisplayNames"]; creativeRuns: CreativeRunRecord[]; imageProvider: ImageProvider; onImageProviderChange: (provider: ImageProvider) => void; videoProvider: VideoProvider; onVideoProviderChange: (provider: VideoProvider) => void; onRetryCreativeRun: (runId: string) => void }) {
  const [flowStatus, setFlowStatus] = useState<{ connected?: boolean; composer?: boolean; profilePersistent?: boolean; engine?: string; throttled?: boolean; reason?: string }>({ reason: "Not checked." });
  const [vertexStatus, setVertexStatus] = useState<{ configured?: boolean; officialApiVerified?: boolean; projectIdPresent?: boolean; credentialPresent?: boolean; location?: string; model?: string; reason?: string }>({ reason: "Not checked." });
  const [vertexProjectId, setVertexProjectId] = useState("");
  const [vertexLocation, setVertexLocation] = useState("us-central1");
  const [vertexModel, setVertexModel] = useState("imagen-3.0-generate-002");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try {
      const [flow, vertex] = await Promise.all([invoke<typeof flowStatus>("flow_web_status"), invoke<typeof vertexStatus>("vertex_ai_status", { workspaceId })]);
      setFlowStatus(flow); setVertexStatus(vertex);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Native provider status unavailable.";
      setFlowStatus({ reason }); setVertexStatus({ reason });
    } finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, [workspaceId]);
  const openFlow = async () => { try { await invoke("flow_web_open"); setNotice("Google Flow opened in the SignalFlow-managed Chromium profile. Sign in and keep the visible Flow composer ready, then refresh status."); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not open the managed Google Flow session."); } };
  const saveVertex = async () => { try { await invoke("vertex_ai_save_config", { workspaceId, projectId: vertexProjectId, location: vertexLocation, model: vertexModel }); setNotice("Vertex configuration saved in the .env credential file. A credential must still be provisioned there by the owner; none was created automatically."); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : "Vertex configuration was not saved."); } };
  const verifyVertex = async () => { setBusy(true); try { await invoke("vertex_ai_verify", { workspaceId }); setNotice("Vertex official API verification passed for 10 minutes. The access token remains in the .env credential file."); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : "Vertex official API verification failed."); } finally { setBusy(false); } };
  const capability = imageProvider === "google_flow"
    ? canUseImageProvider(imageProvider, { managedBrowserSession: flowStatus.profilePersistent === true && flowStatus.engine === "chromium", signalFlowSessionVerified: flowStatus.connected === true && flowStatus.composer === true, nativeSecureStore: false, officialApiVerified: false })
    : imageProvider === "vertex_ai"
      ? canUseImageProvider(imageProvider, { managedBrowserSession: false, signalFlowSessionVerified: false, nativeSecureStore: vertexStatus.credentialPresent === true, officialApiVerified: vertexStatus.officialApiVerified === true, projectId: vertexStatus.projectIdPresent ? "configured" : "" })
      : canUseImageProvider("local_preview", {});
  const states: CreativePipelineState[] = ["idea", "media_selected", "media_generated", "content_generated", "needs_review", "approved", "scheduled", "published", "failed"];
  const videoCapability = canUseVideoProvider(videoProvider, { managedBrowserSession: flowStatus.profilePersistent === true && flowStatus.engine === "chromium", signalFlowSessionVerified: flowStatus.connected === true && flowStatus.composer === true });
  const lifecycleCopy = "idea → media selected → media generated → content generated → Needs review → approved → scheduled → published/failed";
  return <article className="panel settings-card full-settings"><PanelHeading kicker="CREATIVE RUNS" title="Review-first creative pipeline"/><p className="settings-help">Every automated run is persisted through the review-first lifecycle. Unconfigured providers stay visibly blocked; local preview is review only.</p><div className="creative-lifecycle" aria-label="Creative Runs lifecycle">{lifecycleCopy.split(" → ").map((state, index) => <span key={state}><span>{state}</span>{index < lifecycleCopy.split(" → ").length - 1 && <i>→</i>}</span>)}</div><div className="planner-fields"><label className="field-label">Image provider<select value={imageProvider} onChange={(event) => onImageProviderChange(event.target.value as ImageProvider)}><option value="local_preview">Deterministic local preview · no live generation</option><option value="google_flow">Google Flow · SignalFlow-managed Chromium</option><option value="vertex_ai">Vertex AI · official .env credential file/API</option></select></label><label className="field-label">Video provider<select value={videoProvider} onChange={(event) => onVideoProviderChange(event.target.value as VideoProvider)}><option value="local_upload">Existing video asset · review only</option><option value="veo">Google Flow / Veo · SignalFlow-managed Chromium</option><option value="runway">Runway · official provider</option></select></label><div className="planner-status"><span className={`status-pill ${capability.allowed ? "published" : "failed"}`}>{capability.allowed ? capability.live ? "Live capability verified" : "Preview only" : "Blocked"}</span><small>{capability.reason ?? (capability.live ? "Provider verified" : "Deterministic preview only")}</small><button className="text-button" disabled={busy} onClick={() => void refresh()}>{busy ? "Checking…" : "Refresh status"}</button></div></div><div className="provider-row provider-session-row"><div><strong>Google Flow session</strong><span>{flowStatus.reason ?? (flowStatus.throttled ? "Google Flow temporarily blocked this session for unusual activity." : `${flowStatus.engine ?? "chromium"} · ${flowStatus.profilePersistent ? "persistent" : "not persistent"} · ${flowStatus.connected ? "connected" : "not verified"}`)}</span></div><em>{flowStatus.connected && flowStatus.composer && flowStatus.profilePersistent && !flowStatus.throttled ? "Verified" : flowStatus.throttled ? "Throttled" : "Setup needed"}</em><button className="text-button" onClick={() => void openFlow()}>Open managed Flow</button></div><div className="provider-row provider-session-row"><div><strong>Vertex AI official boundary</strong><span>{vertexStatus.reason ?? `${vertexStatus.location ?? "location missing"} · ${vertexStatus.model ?? "model missing"} · ${vertexStatus.credentialPresent ? "credential present" : "credential missing"}`}</span></div><em>{vertexStatus.officialApiVerified ? "Verified" : "Setup needed"}</em></div><div className="provider-row provider-session-row video-provider-row"><div><strong>Video generation route</strong><span>{videoCapability.reason ?? videoCapability.label}</span></div><em>{videoCapability.live ? "Verified" : videoProvider === "local_upload" ? "Review only" : "Setup needed"}</em></div><div className="planner-fields"><label className="field-label">Vertex project ID<input value={vertexProjectId} onChange={(event) => setVertexProjectId(event.target.value)} placeholder="my-gcp-project" /></label><label className="field-label">Location<input value={vertexLocation} onChange={(event) => setVertexLocation(event.target.value)} /></label><label className="field-label">Imagen model<input value={vertexModel} onChange={(event) => setVertexModel(event.target.value)} /></label><button className="secondary-button" onClick={() => void saveVertex()}>Save Vertex config</button><button className="secondary-button" disabled={busy || vertexStatus.credentialPresent !== true} onClick={() => void verifyVertex()}>Verify Vertex API</button></div>{notice && <div className="queue-notice"><span className="online-dot"/><span>{notice}</span></div>}<div className="creative-run-list">{creativeRuns.length === 0 ? <div className="empty-state">No persisted CreativeRuns yet.</div> : creativeRuns.slice(-8).reverse().map((run) => <div className="history-row" key={run.id}><span className="history-time">{run.updatedAt}</span><strong title={run.idea ?? run.topic}>{run.idea ? `Idea: ${run.idea.slice(0, 120)}${run.idea.length > 120 ? "…" : ""}` : run.topic}</strong><span>{run.imageProvider}</span><span>{run.mediaProvenance?.source === "generated" && !run.generatedUrl ? "Generated · local/unhosted" : run.mediaProvenance?.source ? `${run.mediaProvenance.source}${run.mediaProvenance.providerFileId ? ` · ${run.mediaProvenance.providerFileId}` : ""}` : "No media yet"}</span><span>{run.targetPageId ? resolveTargetDisplayName(run.targetPageId, connectionDisplayNames, "Facebook Page") : "No Page target"}</span><span className={`audit-outcome ${run.state}`}>{run.state}</span>{run.mediaProvenance?.source === "generated" && !run.generatedUrl && <small className="generated-media-next-action" role="status">Next: Upload to Drive → Make link public → Review metadata.</small>}{run.state === "failed" && <button className="text-button" onClick={() => onRetryCreativeRun(run.id)}>Retry</button>}</div>)}</div><small className="muted-note">Lifecycle contract: {lifecycleCopy}. Internal states: {states.join(" → ")}. Each run retains Page/channel, selected/generated media provenance and provider metadata in the local automation snapshot; status discovery is read-only and provider generation is never triggered by this control.</small></article>;
}

function MediaPreview({ asset, className, controls = false }: { asset: MediaCard; className?: string; controls?: boolean }) {
  const source = localMediaPreviewUrl(asset.localAssetPath) ?? asset.publicUrl;
  if (!source) return <div className="empty-state">No verified public preview is available.</div>;
  if (asset.kind === "Video") return <video className={className} controls={controls} preload="metadata" muted playsInline poster={localMediaThumbnailUrl(asset.localAssetPath)}><source src={source} type="video/mp4" />Your browser cannot preview this video.</video>;
  return <img className={className} src={source} alt={asset.name} loading="lazy" />;
}
function MediaView({ assets, onAddAsset, onImportLocalImage, mediaImportBusy, mediaImportNotice, onVerifyAsset, onSyncDriveInventory, driveInventorySyncBusy, onAnalyzeDriveAsset, onAnalyzeLocalAsset, onUploadAssetToDrive, onMakeDrivePublic, onArchiveAsset, onRestoreAsset }: Pick<Props, "assets" | "onAddAsset" | "onImportLocalImage" | "mediaImportBusy" | "mediaImportNotice" | "onVerifyAsset" | "onSyncDriveInventory" | "driveInventorySyncBusy" | "onAnalyzeDriveAsset" | "onAnalyzeLocalAsset" | "onUploadAssetToDrive" | "onMakeDrivePublic" | "onArchiveAsset" | "onRestoreAsset">) {
  const [libraryView, setLibraryView] = useState<"local" | "drive">("local");
  const [filter, setFilter] = useState<"All" | MediaCard["kind"]>("All");
  const [showRegister, setShowRegister] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MediaCard["kind"]>("Image");
  const [publicUrl, setPublicUrl] = useState("");
  const [checksum, setChecksum] = useState("");
  const [visualFingerprint, setVisualFingerprint] = useState("");
  const [reviewingId, setReviewingId] = useState<string | number | "">("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [reviewChecksum, setReviewChecksum] = useState("");
  const [reviewFingerprint, setReviewFingerprint] = useState("");
  const [error, setError] = useState("");
  const [previewingAsset, setPreviewingAsset] = useState<MediaCard | undefined>();
  const autoAnalyzedIds = useRef(new Set<string | number>());
  const localAssets = assets.filter((asset) => asset.registrationMode !== "google_drive");
  const driveAssets = assets.filter((asset) => asset.registrationMode === "google_drive");
  useEffect(() => {
    const asset = assets.find((candidate) => candidate.kind === "Video" && candidate.localAssetPath && !candidate.visualFingerprintSource && !autoAnalyzedIds.current.has(candidate.id));
    if (!asset) return;
    autoAnalyzedIds.current.add(asset.id);
    void onAnalyzeLocalAsset(asset.id);
  }, [assets, onAnalyzeLocalAsset]);
  const libraryAssets = libraryView === "local" ? localAssets : driveAssets;
  const filterOptions: Array<"All" | MediaCard["kind"]> = ["All", "Image", "Video", "Audio", "Unknown"];
  const filtered = (filter === "All" ? libraryAssets : libraryAssets.filter((asset) => asset.kind === filter));
  const mediaSummary = summarizeMediaAssets(assets);
  const filteredEmptyMessage = libraryAssets.length === 0
    ? libraryView === "local" ? "No local app-owned assets are available yet." : "No Drive inventory is available yet. Sync Drive after opening the managed Drive session."
    : `No ${filter === "All" ? "assets" : filter.toLowerCase()} files in this view. Clear the filter or switch views.`;
  const nextActionFor = (asset: MediaCard) => {
    if (asset.archiveState === "archived") return "Restore from archive";
    if (asset.duplicateStatus === "duplicate") return "Resolve duplicate before planning";
    if (asset.usageStatus === "used") return "No action · already used";
    if (asset.usageStatus === "reserved") return "Release or complete active reservation";
    if ((asset.kind === "Image" || asset.kind === "Video") && asset.localAssetPath && (!asset.visualFingerprint || !asset.visualFingerprintSource)) return asset.kind === "Video" ? "Analyze video frames" : "Analyze local pixels";
    if (asset.providerFileId && !asset.localAssetPath && (asset.kind === "Image" || asset.kind === "Video")) return "Download & analyze";
    if (asset.localAssetPath && !asset.providerFileId && !asset.publicUrlVerified) return "Upload to Drive";
    if (asset.providerFileId && asset.publicUrl && !asset.publicUrlVerified) return "Make link public";
    if (!asset.checksum) return "Verify SHA-256";
    if (asset.kind === "Image" && !asset.visualFingerprint) return "Verify visual fingerprint";
    if (asset.status !== "Ready") return "Review metadata";
    return "None · eligible after review";
  };
  const blockerFor = (asset: MediaCard) => mediaBlockers(asset)[0] ?? "No active blocker";
  const registerAsset = () => {
    const trimmedName = name.trim();
    const trimmedUrl = publicUrl.trim();
    if (!trimmedName) { setError("Asset name is required."); return; }
    if (!trimmedUrl) { setError("Provide a public HTTPS URL or Google Drive share link."); return; }
    if (trimmedUrl && (!/^https:\/\//i.test(trimmedUrl) || isNonPublicMediaHost(trimmedUrl))) { setError("Use a public HTTPS URL; localhost and .local URLs are not publishable."); return; }
    if (trimmedUrl.includes("drive.google.com") && !normalizeGoogleDriveMediaUrl(trimmedUrl)) { setError("Google Drive link must use a valid /file/d/<id>/view or ?id=<id> format."); return; }
    const trimmedChecksum = checksum.trim();
    if (trimmedChecksum && !/^sha256:[a-f0-9]{64}$/i.test(trimmedChecksum)) { setError("Checksum must use sha256: followed by 64 hexadecimal characters."); return; }
    onAddAsset({ name: trimmedName, kind, publicUrl: trimmedUrl, checksum: trimmedChecksum || undefined, visualFingerprint: visualFingerprint.trim() || undefined });
    setName(""); setPublicUrl(""); setChecksum(""); setVisualFingerprint(""); setError(""); setShowRegister(false);
  };
  const startReview = (asset: MediaCard) => { setReviewingId(asset.id); setReviewUrl(asset.publicUrl ?? ""); setReviewChecksum(asset.checksum ?? ""); setReviewFingerprint(asset.visualFingerprint ?? ""); setError(""); };
  const submitReview = () => {
    if (!/^https:\/\//i.test(reviewUrl.trim()) || isNonPublicMediaHost(reviewUrl.trim())) { setError("Review requires a public HTTPS URL; reachability must be confirmed outside SignalFlow."); return; }
    if (!/^sha256:[a-f0-9]{64}$/i.test(reviewChecksum.trim())) { setError("Review requires sha256: followed by 64 hexadecimal characters."); return; }
    if (!/^[a-f0-9]{16}$/i.test(reviewFingerprint.trim())) { setError("Review requires a 16-character hexadecimal visual fingerprint."); return; }
    onVerifyAsset(reviewingId, { publicUrl: reviewUrl.trim(), sha256: reviewChecksum.trim(), visualFingerprint: reviewFingerprint.trim() });
    setReviewingId(""); setError("");
  };
  return <section className="expanded-view"><ViewHeader kicker="ASSET OPERATIONS" title="Media library" subtitle="Local app-owned and Drive inventory stay separate; archive/unlink is non-destructive." action={showRegister ? "Close register" : "Register public asset"} onAction={() => { setShowRegister((value) => !value); setError(""); }}/>{showRegister && <article className="panel asset-register-card"><PanelHeading kicker="PUBLIC MEDIA INPUT" title="Register an asset"/><p className="settings-help">Drive inventory is metadata-first. Use <strong>Download & analyze</strong> to copy a visible Drive file into SignalFlow's owned media folder and compute a real SHA-256. Use <strong>Upload to Drive</strong> for generated/local output, then explicitly make the link public before planner review.</p><div className="asset-register-grid"><label className="field-label">Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="campaign-cover.jpg"/></label><label className="field-label">Kind<select value={kind} onChange={(event) => setKind(event.target.value as MediaCard["kind"])}><option>Image</option><option>Video</option><option>Audio</option></select></label><label className="field-label full-field">Public HTTPS URL or Google Drive share link<input value={publicUrl} onChange={(event) => setPublicUrl(event.target.value)} placeholder="https://drive.google.com/file/d/<id>/view?usp=sharing"/></label><label className="field-label full-field">Checksum (optional)<input value={checksum} onChange={(event) => setChecksum(event.target.value)} placeholder="sha256:…"/></label><label className="field-label full-field">Visual fingerprint (optional)<input value={visualFingerprint} onChange={(event) => setVisualFingerprint(event.target.value)} placeholder="16 hex characters"/></label></div>{error && <div className="generation-error">{error}</div>}<div className="asset-register-actions"><span>Public sharing and visual fingerprint remain explicit review gates.</span><button className="primary-button" onClick={registerAsset}>Register asset</button></div></article>}<div className="media-summary" aria-label="Media library summary"><div><span>Working media</span><strong>{mediaSummary.working}</strong><small>Image + Video</small></div><div className="positive"><span>Eligible</span><strong>{mediaSummary.eligible}</strong><small>ready to plan</small></div><div className={mediaSummary.blocked > 0 ? "warning" : "positive"}><span>Blocked</span><strong>{mediaSummary.blocked}</strong><small>needs a gate</small></div><div><span>Used / reserved</span><strong>{mediaSummary.used} / {mediaSummary.reserved}</strong><small>ledger states</small></div><div className="media-summary-wide"><span>Evidence</span><strong>{mediaSummary.publicVerified}/{mediaSummary.working} public · {mediaSummary.shaVerified}/{mediaSummary.working} SHA · {mediaSummary.fingerprintVerified}/{mediaSummary.working} fingerprint</strong><small>{mediaSummary.duplicates} duplicate · {mediaSummary.nearDuplicates} near duplicate</small></div></div><div className="media-toolbar"><label className="media-import-control">Nhập ảnh cục bộ<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Nhập ảnh cục bộ" disabled={mediaImportBusy} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void onImportLocalImage(file); }}/></label>{mediaImportNotice && <span className="sync-feedback" role="status">{mediaImportNotice}</span>}<div className="media-view-tabs" role="tablist" aria-label="Media library sources"><button className={libraryView === "local" ? "selected" : ""} role="tab" aria-selected={libraryView === "local"} onClick={() => { setLibraryView("local"); setFilter("All"); }}>{`Local · ${localAssets.length}`}</button><button className={libraryView === "drive" ? "selected" : ""} role="tab" aria-selected={libraryView === "drive"} onClick={() => { setLibraryView("drive"); setFilter("All"); }}>{`Drive · ${driveAssets.length}`}</button></div><button className="secondary-button sync-button" disabled={driveInventorySyncBusy} aria-busy={driveInventorySyncBusy} onClick={() => void onSyncDriveInventory()}>{driveInventorySyncBusy ? "Syncing Drive…" : "Sync Drive inventory"}</button><span className="sync-feedback" role={driveInventorySyncBusy ? "status" : undefined}>{driveInventorySyncBusy ? "Reading Drive metadata; existing records stay untouched." : `${libraryAssets.length} assets in ${libraryView}`} · {assets.length} total inventory records</span></div><div className="media-two-pane" aria-label="Local and Drive media panes"><section><div className="media-two-pane-heading"><strong>Local app-owned</strong><span>{localAssets.length}</span></div>{localAssets.slice(0, 6).map((asset) => <button type="button" key={asset.id} onClick={() => setPreviewingAsset(asset)}><span>{asset.kind}</span><strong>{asset.name}</strong><small>{asset.status} · {asset.size}</small></button>)}{localAssets.length === 0 && <div className="empty-state">No local assets.</div>}</section><section><div className="media-two-pane-heading"><strong>Google Drive inventory</strong><span>{driveAssets.length}</span></div>{driveAssets.slice(0, 6).map((asset) => <button type="button" key={asset.id} onClick={() => setPreviewingAsset(asset)}><span>{asset.kind}</span><strong>{asset.name}</strong><small>{asset.status} · {asset.providerFileId ?? "provider ID pending"}</small></button>)}{driveAssets.length === 0 && <div className="empty-state">No Drive assets.</div>}</section></div><div className="media-filter-row"><div className="filter-tabs" role="group" aria-label="Media type filter">{filterOptions.map((item) => <button key={item} className={filter === item ? "selected" : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item === "All" ? "All in this source" : item === "Unknown" ? "Unknown" : `${item}s`}</button>)}</div><small>{libraryView === "local" ? "Local files remain app-owned inspection copies." : "Drive records retain provider IDs; delete remains archive/unlink only."}</small></div><div className="asset-grid">{filtered.length === 0 ? <div className="filtered-empty" role="status"><strong>{filteredEmptyMessage}</strong><small>Inventory records are retained; this view is only filtered, not destructive.</small></div> : filtered.map((asset) => <article className="panel asset-card" key={asset.id}><button type="button" className="asset-preview" style={{ background: asset.color }} onClick={() => setPreviewingAsset(asset)} aria-label={`Preview ${asset.name}`}>{(asset.publicUrl || asset.localAssetPath) && (asset.kind === "Image" || asset.kind === "Video") ? <MediaPreview asset={asset} className="asset-preview-media" /> : <BetterContentIcon name={asset.kind === "Video" ? "video" : asset.kind === "Audio" ? "audio" : "file"} />}{asset.status !== "Ready" && <em>{asset.status === "Local" ? "Upload required" : asset.status}</em>}</button><div className="asset-copy"><div className="asset-heading"><div><strong>{asset.name}</strong><span className="asset-type">{asset.kind} · {asset.size}</span></div><span className={`asset-status ${asset.status === "Ready" ? "ready" : asset.status === "Used" ? "used" : "attention"}`}>{asset.status === "Ready" ? "Eligible" : asset.status}</span></div><div className="asset-context"><span>{asset.usage}</span><span>{mediaDistributionLabel(asset.distribution, asset.registrationMode === "google_drive" ? "Drive inventory" : asset.registrationMode ?? "Local inventory")}</span></div><div className="asset-state-badges" aria-label={`${asset.name} media states`}>{mediaStateBadges(asset).map((badge) => <span className={`media-state-badge ${badge.tone}`} key={badge.label}>{badge.label}</span>)}</div><div className="asset-proof-grid"><small><strong>Next action</strong>{nextActionFor(asset)}</small><small><strong>Blocker</strong>{blockerFor(asset)}</small><small><strong>Public link</strong>{asset.publicUrlVerified ? "Verified" : asset.publicUrl ? "Present · not verified" : "Missing"}</small><small><strong>SHA-256</strong>{asset.checksum ?? "Not supplied"}</small><small><strong>Visual fingerprint</strong>{asset.visualFingerprint ?? "Not supplied"}</small><small><strong>Local file</strong>{asset.localAssetPath ? "Available in app storage" : "Not available"}</small></div><small className="asset-provenance">Provider file ID {asset.providerFileId ?? "not recorded"} · provenance {asset.registrationMode ?? "unknown"}</small>{asset.hierarchy && <small className="asset-hierarchy">Hierarchy {asset.hierarchy.relativePath} · run {asset.hierarchy.contentRunId}</small>}<div className="asset-action-row">{(asset.kind === "Image" || asset.kind === "Video") && asset.providerFileId && !asset.localAssetPath && <button className="secondary-button" onClick={() => void onAnalyzeDriveAsset(asset.id)}>Download & analyze</button>}{asset.kind === "Image" && asset.localAssetPath && (!asset.visualFingerprint || !asset.visualFingerprintSource) && <button className="secondary-button" onClick={() => void onAnalyzeLocalAsset(asset.id)}>Analyze local pixels</button>}{asset.localAssetPath && !asset.providerFileId && !asset.publicUrlVerified && <button className="secondary-button" onClick={() => void onUploadAssetToDrive(asset.id)}>Upload to Drive</button>}{(asset.kind === "Image" || asset.kind === "Video") && asset.providerFileId && asset.publicUrl && !asset.publicUrlVerified && <button className="secondary-button" onClick={() => void onMakeDrivePublic(asset.id)}>Make link public</button>}{asset.status !== "Ready" && <button className="secondary-button" onClick={() => startReview(asset)}>Review metadata</button>}{asset.archiveState === "archived" ? <button className="text-button" onClick={() => onRestoreAsset(asset.id)}>Restore from archive</button> : <button className="text-button danger-text" onClick={() => onArchiveAsset(asset.id)}>Xóa khỏi SignalFlow (archive / unlink)</button>}</div>{reviewingId === asset.id && <div className="asset-review-form"><label className="field-label">Verified public URL<input value={reviewUrl} onChange={(event) => setReviewUrl(event.target.value)} /></label><label className="field-label">SHA-256<input value={reviewChecksum} onChange={(event) => setReviewChecksum(event.target.value)} placeholder="sha256:…" /></label><label className="field-label">Visual fingerprint<input value={reviewFingerprint} onChange={(event) => setReviewFingerprint(event.target.value)} placeholder="16 hex characters" /></label><div className="asset-register-actions"><span>Only mark verified after checking these values with your own trusted file/public-hosting workflow. SignalFlow does not fabricate or fetch them.</span><button className="primary-button" onClick={submitReview}>Mark verified</button></div></div>}</div></article>)}</div>{previewingAsset && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Media preview ${previewingAsset?.name}`} onMouseDown={() => setPreviewingAsset(undefined)}><section className="composer-modal media-preview-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="panel-kicker">MEDIA PREVIEW</p><h2>{previewingAsset?.name}</h2><span>{previewingAsset?.kind} · {previewingAsset?.registrationMode ?? "unknown"} · {previewingAsset?.archiveState ?? "active"}</span></div><button className="close-button" onClick={() => setPreviewingAsset(undefined)}>×</button></div>{(previewingAsset?.publicUrl || previewingAsset?.localAssetPath) && (previewingAsset?.kind === "Image" || previewingAsset?.kind === "Video") ? <MediaPreview asset={previewingAsset!} className="media-preview-image" /> : <div className="empty-state">No verified public preview is available. Inspect the metadata and provenance below.</div>}<div className="detail-grid"><span>Provenance</span><strong>{previewingAsset?.registrationMode ?? "unknown"}</strong><span>Provider file ID</span><strong>{previewingAsset?.providerFileId ?? "not recorded"}</strong><span>Public URL</span><strong>{previewingAsset?.publicUrlVerified ? "verified" : "not verified"}</strong><span>SHA-256</span><strong>{previewingAsset?.checksum ?? "not supplied"}</strong><span>Visual fingerprint</span><strong>{previewingAsset?.visualFingerprint ?? "not supplied"}</strong><span>Usage</span><strong>{previewingAsset?.usage}</strong>{previewingAsset?.hierarchy && <><span>Hierarchy</span><strong>{previewingAsset.hierarchy.relativePath} · run {previewingAsset.hierarchy.contentRunId}</strong></>}</div></section></div>}</section>;
}

function AnalyticsView({ onExportReport, auditEntries, activeWorkspace, activeBrand, analyticsEvents = [], targetPublications = [], analyticsDataAsOf, analyticsWorkerReconciledAt }: Pick<Props, "onExportReport" | "auditEntries" | "activeWorkspace" | "activeBrand" | "analyticsEvents" | "targetPublications" | "analyticsDataAsOf" | "analyticsWorkerReconciledAt">) {
  const [platform, setPlatform] = useState("all");
  const [binding, setBinding] = useState("");
  const [windowDays, setWindowDays] = useState("7");
  const client = useMemo(() => createControlPlaneClient(), []);
  const workerClient = useMemo(() => createDurableWorkerClient(), []);
  const [liveEvents, setLiveEvents] = useState<AnalyticsEvent[]>([]);
  const [liveHealth, setLiveHealth] = useState<{ dataAsOf?: string | null; workerReconciledAt?: string | null }>({});
  const [workerState, setWorkerState] = useState<"running" | "degraded" | "stopped">("degraded");
  useEffect(() => {
    if (!client) return;
    let disposed = false;
    void Promise.all([client.listAgencyRecords("analytics-events", { clientId: activeWorkspace.id, brandId: activeBrand.id }), client.health(), workerClient?.health()]).then(([events, health, worker]) => {
      if (disposed) return;
      setLiveEvents(events as unknown as AnalyticsEvent[]);
      setLiveHealth({ dataAsOf: health.dataAsOf, workerReconciledAt: health.workerReconciledAt });
      setWorkerState(worker?.workerState === "stopped" ? "stopped" : worker?.workerState === "running" ? "running" : "degraded");
    }).catch(() => { if (!disposed) { setLiveEvents([]); setLiveHealth({}); } });
    return () => { disposed = true; };
  }, [activeBrand.id, activeWorkspace.id, client, workerClient]);
  const eventSource = analyticsEvents.length > 0 ? analyticsEvents : liveEvents;
  const dataAsOf = analyticsDataAsOf ?? liveHealth.dataAsOf;
  const workerReconciledAt = analyticsWorkerReconciledAt ?? liveHealth.workerReconciledAt;
  const now = new Date();
  const cutoff = new Date(now.getTime() - Number(windowDays) * 86_400_000);
  const filter = { clientId: activeWorkspace.id, brandId: activeBrand.id, ...(platform !== "all" ? { platform } : {}), ...(binding ? { bindingId: binding } : {}), from: cutoff.toISOString(), to: now.toISOString() };
  const scopedEvents = eventSource.filter((event) => event.clientId === activeWorkspace.id && event.brandId === activeBrand.id && Date.parse(event.occurredAt) >= cutoff.getTime() && Date.parse(event.occurredAt) <= now.getTime() && (!filter.platform || event.properties.platform === filter.platform) && (!filter.bindingId || event.properties.bindingId === filter.bindingId));
  const instrumented = scopedEvents.length > 0;
  const readiness = analyticsReadiness({ dataAsOf: dataAsOf ?? undefined, workerReconciledAt: workerReconciledAt ?? undefined, now: new Date().toISOString(), workerState, instrumented });
  const approval = reviewDecisionApprovalRate(scopedEvents, filter);
  const preflight = preflightBlockRateByReason(scopedEvents, filter, "missing_approval");
  const publish = targetPublishSuccessRate(targetPublications, filter);
  const statusLabel = readiness.state;
  const [drillDown, setDrillDown] = useState("");
  return <section className="expanded-view">
    <ViewHeader kicker="BÁO CÁO TÍN HIỆU" title="Phân tích" subtitle="Mọi chỉ số giữ nguyên Client / Brand / Platform / Binding / thời gian filter và chỉ hiện khi có event đủ điều kiện." action="Xuất báo cáo" onAction={onExportReport}/>
    <div className="demo-notice" role="status"><strong>{statusLabel}</strong><span>{readiness.state === "READY" ? "Control Plane events đã có dữ liệu scoped." : "Chưa có dữ liệu provider đủ điều kiện; SignalFlow không thay bằng số 0 hoặc số minh họa."}</span></div>
    <div className="analytics-filters" aria-label="Analytics filters"><label>Client<input value={activeWorkspace.name} readOnly/></label><label>Brand<input value={activeBrand.name} readOnly/></label><label>Platform<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="all">All platforms</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option></select></label><label>Binding<input value={binding} onChange={(event) => setBinding(event.target.value)} placeholder="Optional binding ID"/></label><label>Window<select value={windowDays} onChange={(event) => setWindowDays(event.target.value)}><option value="7">7 days</option><option value="30">30 days</option></select></label></div>
    <div className="metric-grid analytics-metrics">
      <article className="metric-card accent-blue" role="button" tabIndex={0} onClick={() => setDrillDown("approval")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setDrillDown("approval"); }}><div className="metric-icon"><BetterMetricIcon name="check" /></div><div><span className="metric-label">Review approval rate</span><strong>{approval.state === "READY" ? `${Math.round(approval.value * 100)}%` : "—"}</strong><span className="metric-change neutral">{approval.state === "READY" ? `${approval.numerator}/${approval.denominator}` : approval.code}</span></div></article>
      <article className="metric-card accent-purple" role="button" tabIndex={0} onClick={() => setDrillDown("publish")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setDrillDown("publish"); }}><div className="metric-icon"><BetterMetricIcon name="arrow-up-right" /></div><div><span className="metric-label">Target publish success</span><strong>{publish.state === "READY" ? `${Math.round(publish.value * 100)}%` : "—"}</strong><span className="metric-change neutral">{publish.state === "READY" ? `${publish.numerator}/${publish.denominator}` : publish.code}</span></div></article>
      <article className="metric-card accent-amber" role="button" tabIndex={0} onClick={() => setDrillDown("preflight")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setDrillDown("preflight"); }}><div className="metric-icon"><BetterMetricIcon name="triangle-alert" /></div><div><span className="metric-label">Preflight block · missing approval</span><strong>{preflight.state === "READY" ? `${Math.round(preflight.value * 100)}%` : "—"}</strong><span className="metric-change neutral">{preflight.state === "READY" ? `${preflight.numerator}/${preflight.denominator}` : preflight.code}</span></div></article>
      <article className="metric-card accent-green" role="button" tabIndex={0} onClick={() => setDrillDown("audit")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setDrillDown("audit"); }}><div className="metric-icon"><BetterMetricIcon name="clipboard-check" /></div><div><span className="metric-label">Sự kiện audit</span><strong>{auditEntries.length}</strong><span className="metric-change neutral">{scopedEvents.length} Control Plane events</span></div></article>
    </div>
    <div className="analytics-grid"><article className="panel chart-panel"><PanelHeading kicker="DỮ LIỆU LIVE" title="Event evidence"/><div className="empty-state">{readiness.state === "READY" ? `${scopedEvents.length} scoped event(s) · dataAsOf ${dataAsOf ?? "unknown"} · worker ${workerReconciledAt ?? "not reconciled"}` : `${readiness.state} · metric decision use disabled until event/freshness gates pass.`}</div></article><article className="panel performance-panel"><PanelHeading kicker="DRILL-DOWN" title={drillDown ? `Detail · ${drillDown}` : "Exact filter retained"}/><div className="empty-state">Client {activeWorkspace.id} · Brand {activeBrand.id} · Platform {platform} · Binding {binding || "all"} · {windowDays} days.</div>{drillDown && <div className="analytics-drill-list">{scopedEvents.filter((event) => drillDown === "audit" || (drillDown === "approval" && event.eventName === "approval.decided") || (drillDown === "publish" && event.eventName === "publication.state_changed") || (drillDown === "preflight" && event.eventName === "preflight.checked")).slice(-20).reverse().map((event) => <div className="performance-row" key={`${event.eventName}-${event.occurredAt}`}><strong>{event.eventName}</strong><span>{event.occurredAt}</span><small>{JSON.stringify(event.properties)}</small></div>)}</div>}</article></div>
  </section>;
}

export function BrandView({ activeBrand, brandVoice, brandVisualTokens, savedNotice, onBrandVoiceChange, onBrandVisualTokensChange, onSaveBrand, workspaceState, onBrandIdentityChange }: Pick<Props, "activeBrand" | "brandVoice" | "brandVisualTokens" | "savedNotice" | "onBrandVoiceChange" | "onBrandVisualTokensChange" | "onSaveBrand" | "workspaceState" | "onBrandIdentityChange">) {
  const identity = resolveActiveBrandIdentity(activeBrand.id, workspaceState.brandIdentities ?? []) ?? workspaceState.brandIdentities?.find((item) => item.brandId === activeBrand.id);
  const updateIdentity = (patch: Partial<BrandIdentityRecord>) => { if (identity && onBrandIdentityChange) onBrandIdentityChange({ ...identity, ...patch, strategy: { ...identity.strategy, ...(patch.strategy ?? {}) }, voice: { ...identity.voice, ...(patch.voice ?? {}) }, visual: { ...identity.visual, ...(patch.visual ?? {}) } }); };
  return <section className="expanded-view"><ViewHeader kicker="GOVERNANCE" title="Brand system" subtitle="Give every provider and content variant the same strategic guardrails." action="Save brand system" onAction={onSaveBrand}/>{savedNotice && <div className="success-banner">✓ {savedNotice}</div>}<div className="settings-grid"><article className="panel settings-card"><PanelHeading kicker="VOICE & STYLE" title={activeBrand.name}/><label className="field-label">Brand voice<textarea value={brandVoice} onChange={(event) => onBrandVoiceChange(event.target.value)} rows={5}/></label>{identity ? <><label className="field-label">Vision<input value={identity.strategy.vision} onChange={(event) => updateIdentity({ strategy: { ...identity.strategy, vision: event.target.value } })}/></label><label className="field-label">Mission<textarea value={identity.strategy.mission} onChange={(event) => updateIdentity({ strategy: { ...identity.strategy, mission: event.target.value } })} rows={3}/></label><label className="field-label">Audience<input value={identity.strategy.audience} onChange={(event) => updateIdentity({ strategy: { ...identity.strategy, audience: event.target.value } })}/></label><label className="field-label">Identity tone<input value={identity.voice.tone} onChange={(event) => updateIdentity({ voice: { ...identity.voice, tone: event.target.value } })}/></label></> : <div className="empty-state">Brand Identity chưa được tạo.</div>}<div className="chip-row"><span>Practical</span><span>Non-judgmental</span><span>Evidence-led</span><span>Human review</span></div></article><article className="panel settings-card"><PanelHeading kicker="BRAND KIT VISUALS" title="Visual tokens"/><p className="settings-help">These editable Brand Kit defaults guide image prompts and content variants for {activeBrand.name}. They are local brand settings, not provider-generated claims.</p><div className="token-fields"><label className="field-label">Primary color<input aria-label="Primary color" type="color" value={brandVisualTokens.primary} onChange={(event) => onBrandVisualTokensChange({ ...brandVisualTokens, primary: event.target.value })}/></label><label className="field-label">Secondary color<input aria-label="Secondary color" type="color" value={brandVisualTokens.secondary} onChange={(event) => onBrandVisualTokensChange({ ...brandVisualTokens, secondary: event.target.value })}/></label><label className="field-label">Typography / font family<input aria-label="Typography or font family" type="text" value={brandVisualTokens.typography} onChange={(event) => onBrandVisualTokensChange({ ...brandVisualTokens, typography: event.target.value })} placeholder="SF Pro Display"/></label></div>{identity && <label className="field-label">Style guide<textarea value={identity.visual.styleGuide} onChange={(event) => updateIdentity({ visual: { ...identity.visual, styleGuide: event.target.value } })} rows={5}/></label>}</article><article className="panel settings-card"><PanelHeading kicker="GUARDRAILS" title="Content rules"/>{["Claims require source", "No get-rich-quick language", "Human review before publish"].map((rule) => <div className="rule-row" key={rule}><div><strong>{rule}</strong><span>Applied to every generated variant</span></div><span className="toggle on" aria-hidden="true"><i/></span></div>)}</article></div></section>;
}

export type BrandStrategyPanelProps = {
  activeBrand: BrandRecord;
  activeClientId: string;
  activeClientName?: string;
  activeUserId?: string;
  memberships?: readonly MembershipRecord[];
  catalog?: BrandStrategyCatalog;
  catalogRevision: number;
  catalogLoading?: boolean;
  catalogError?: string;
  activeChannel?: SocialPlatform;
  activeContentKind?: ContentKind;
  pending?: { requestId: string; revision: number };
  error?: string;
  recipes: ContentRecipe[];
  canManage: boolean;
  scopeKey: string;
  onChange?: (catalog: BrandStrategyCatalog) => void;
  onSave?: (catalog: BrandStrategyCatalog, scopeKey: string, capturedRevision: number) => Promise<StrategyCatalogSaveResult>;
  onReload?: () => void | Promise<void>;
};

const strategyChannels: SocialPlatform[] = ["facebook", "instagram", "tiktok", "youtube"];
const strategyChannelLabels: Record<SocialPlatform, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

function strategyCatalogErrorMessage(catalog: BrandStrategyCatalog | undefined): string {
  if (!catalog) return "Strategy catalog chưa được tải.";
  const result = validateStrategyCatalog(catalog);
  if (result.ok) return "";
  const objective = Array.isArray(catalog.objectives) ? catalog.objectives.find((item) => isRenderableStrategyObject(item) && (!Number.isInteger(item.order) || item.order < 1)) : undefined;
  if (objective) return `${result.errors.join(" · ")} · objective ${objective.label} / order ${objective.order} / field order`;
  const pillars = Array.isArray(catalog.pillars) ? catalog.pillars : [];
  const pillar = pillars.find((item) => isRenderableStrategyObject(item) && (!Number.isInteger(item.order) || item.order < 1 || !Array.isArray(item.angles) || item.angles.length === 0));
  if (pillar) return `${result.errors.join(" · ")} · pillar ${pillar.label} / order ${pillar.order} / field order`;
  const angle = pillars.flatMap((item) => isRenderableStrategyObject(item) && Array.isArray(item.angles) ? item.angles.filter(isRenderableStrategyObject).map((nested) => ({ ...nested, pillarLabel: item.label })) : []).find((item) => !Number.isInteger(item.order) || item.order < 1);
  return angle ? `${result.errors.join(" · ")} · angle ${angle.label} / order ${angle.order} / field order` : result.errors.join(" · ");
}

function isRenderableStrategyObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeStrategyText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function safeStrategyOrder(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeStrategyChannels(value: unknown): SocialPlatform[] {
  return Array.isArray(value) ? value.filter((channel): channel is SocialPlatform => strategyChannels.includes(channel as SocialPlatform)) : [];
}

function renderStrategyObjectives(value: unknown): StrategyObjectiveDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRenderableStrategyObject).map((item, index) => ({
    key: (typeof item.key === "string" ? item.key : `invalid-objective-${index + 1}`) as StrategyObjectiveKey,
    label: safeStrategyText(item.label, "Invalid objective"),
    description: safeStrategyText(item.description, "No description supplied."),
    enabled: typeof item.enabled === "boolean" ? item.enabled : false,
    order: safeStrategyOrder(item.order),
  }));
}

function renderStrategyAngles(value: unknown): ContentAngleDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRenderableStrategyObject).map((item, index) => ({
    id: safeStrategyText(item.id, `invalid-angle-${index + 1}`),
    label: safeStrategyText(item.label, "Invalid angle"),
    guidance: safeStrategyText(item.guidance, "No guidance supplied."),
    enabled: typeof item.enabled === "boolean" ? item.enabled : false,
    order: safeStrategyOrder(item.order),
    channels: safeStrategyChannels(item.channels),
    ...(typeof item.recipeId === "string" ? { recipeId: item.recipeId } : {}),
  }));
}

function renderStrategyPillars(value: unknown): ContentPillarDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRenderableStrategyObject).map((item, index) => ({
    id: safeStrategyText(item.id, `invalid-pillar-${index + 1}`),
    label: safeStrategyText(item.label, "Invalid pillar"),
    description: safeStrategyText(item.description, "No description supplied."),
    enabled: typeof item.enabled === "boolean" ? item.enabled : false,
    order: safeStrategyOrder(item.order),
    channels: safeStrategyChannels(item.channels),
    angles: renderStrategyAngles(item.angles),
  }));
}

function strategyCatalogSlug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom";
}

function uniqueStrategyId(prefix: string, values: readonly string[]): string {
  const existing = new Set(values);
  const base = strategyCatalogSlug(prefix);
  let id = base;
  let index = 2;
  while (existing.has(id)) id = `${base}-${index++}`;
  return id;
}

export function strategyRecipeOptions(recipes: readonly ContentRecipe[], brandId: string, platform: SocialPlatform, contentKind: ContentKind, strategy: { pillarId: string; angleId: string }): ContentRecipe[] {
  return recipes.filter((recipe) => {
    try {
      return validateContentRecipe(recipe, brandId, platform, contentKind).ok && validateContentRecipeForStrategy(recipe, strategy).ok;
    } catch {
      return false;
    }
  });
}

export type BrandStrategyPanelControllerState = {
  scopeKey: string;
  revision: number;
  draft?: BrandStrategyCatalog;
  catalogLoading: boolean;
  externalPending: boolean;
  dirty: boolean;
  localPending: boolean;
  error: string;
  notice: string;
};

type BrandStrategyPanelOperation = { token: number; scopeKey: string; revision: number; scopeGeneration: number; draftFingerprint?: string; dirty: boolean; kind: "save" | "reload" };

export type BrandStrategyPanelController = {
  setScope: (scopeKey: string, revision: number) => void;
  edit: (change: StrategyCatalogEdit) => boolean;
  save: () => Promise<StrategyCatalogSaveResult | undefined>;
  reload: () => Promise<void>;
  keyDown: (event: { key: string; preventDefault: () => void }, heading: Pick<HTMLElement, "isConnected" | "focus"> | null, panel: Pick<HTMLElement, "isConnected" | "focus"> | null) => boolean;
};

export function createBrandStrategyPanelController(input: {
  getState: () => BrandStrategyPanelControllerState;
  setState: (state: BrandStrategyPanelControllerState) => void;
  canManage?: () => boolean;
  isSaveAvailable?: () => boolean;
  isReloadAvailable?: () => boolean;
  onChange?: (catalog: BrandStrategyCatalog) => void;
  onSave?: (catalog: BrandStrategyCatalog, scopeKey: string, capturedRevision: number) => Promise<StrategyCatalogSaveResult>;
  onReload?: () => void | Promise<void>;
}): BrandStrategyPanelController {
  let currentScopeKey = input.getState().scopeKey;
  let currentRevision = input.getState().revision;
  let operationToken = 0;
  let scopeGeneration = 0;
  const operations = new Map<number, BrandStrategyPanelOperation>();
  const setState = (patch: Partial<BrandStrategyPanelControllerState>) => input.setState({ ...input.getState(), ...patch });
  const setScope = (scopeKey: string, revision: number) => {
    if (scopeKey !== currentScopeKey || revision !== currentRevision) {
      scopeGeneration += 1;
      operationToken += 1;
    }
    currentScopeKey = scopeKey;
    currentRevision = revision;
  };
  const begin = (kind: BrandStrategyPanelOperation["kind"], state: BrandStrategyPanelControllerState): BrandStrategyPanelOperation => {
    const operation = { token: ++operationToken, scopeKey: state.scopeKey, revision: state.revision, scopeGeneration, draftFingerprint: state.draft ? strategyCatalogFingerprint(state.draft) : undefined, dirty: state.dirty, kind };
    operations.set(operation.token, operation);
    return operation;
  };
  const matchesOperation = (operation: BrandStrategyPanelOperation) => operation.token === operationToken && operation.scopeKey === currentScopeKey && operation.scopeGeneration === scopeGeneration;
  const matches = (operation: BrandStrategyPanelOperation, revision = input.getState().revision) => matchesOperation(operation) && operation.revision === revision;
  const matchesSaveSettlement = (operation: BrandStrategyPanelOperation, result: StrategyCatalogSaveResult | undefined) => {
    if (!result || !matchesOperation(operation)) return false;
    if (result.revision !== undefined && isSafeCatalogRevision(result.revision) && result.revision !== operation.revision + 1) return false;
    if (result.acknowledged !== true || result.revision === undefined || !isSafeCatalogRevision(result.revision)) return matches(operation);
    return matches(operation) || input.getState().revision === result.revision;
  };
  const draftMatches = (operation: BrandStrategyPanelOperation) => {
    const draft = input.getState().draft;
    return operation.draftFingerprint === undefined || Boolean(draft && strategyCatalogFingerprint(draft) === operation.draftFingerprint);
  };
  const release = (operation: BrandStrategyPanelOperation) => { operations.delete(operation.token); };

  const edit = (change: StrategyCatalogEdit): boolean => {
    const state = input.getState();
    if (state.catalogLoading || state.localPending || state.externalPending || input.canManage?.() === false || !state.draft || !validateStrategyCatalog(state.draft).ok) return false;
    const next = applyStrategyCatalogEdit(state.draft, change);
    input.onChange?.(structuredClone(next));
    setState({ draft: next, dirty: true, error: "", notice: "" });
    return true;
  };

  const save = async (): Promise<StrategyCatalogSaveResult | undefined> => {
    const state = input.getState();
    if (!state.draft || state.catalogLoading || state.localPending || state.externalPending || input.canManage?.() === false || input.isSaveAvailable?.() === false || !input.onSave) return undefined;
    const started = beginStrategyCatalogPanelSave(state.draft, state.scopeKey, state.revision);
    if (started.phase !== "pending") { setState({ error: started.error ?? "Strategy catalog không hợp lệ." }); return undefined; }
    const operation = begin("save", state);
    setState({ localPending: true, error: "", notice: "" });
    let result: StrategyCatalogSaveResult | undefined;
    try {
      result = await input.onSave(structuredClone(started.draft), operation.scopeKey, operation.revision);
      if (!matchesSaveSettlement(operation, result) || !draftMatches(operation)) return result;
      const settled = settleStrategyCatalogPanelSave(started, result, operation.scopeKey, operation.revision);
      if (settled === started) return result;
      if (settled.phase === "rejected") {
        setState({ localPending: false, error: settled.error ?? "Control Plane chưa xác nhận catalog." });
        return result;
      }
      currentRevision = settled.revision;
      setState({ scopeKey: currentScopeKey, revision: settled.revision, draft: structuredClone(settled.draft), dirty: false, localPending: false, error: "", notice: `Đã lưu catalog v${settled.draft.version} · fingerprint ${strategyCatalogFingerprint(settled.draft).slice(0, 12)}` });
      return result;
    } catch (caught) {
      const current = input.getState();
      if (matches(operation, current.revision) && draftMatches(operation)) setState({ localPending: false, error: caught instanceof Error ? caught.message : "Catalog chưa được xác nhận; draft được giữ lại." });
      return result;
    } finally {
      const current = input.getState();
      if (matchesSaveSettlement(operation, result) && draftMatches(operation) && current.localPending) setState({ localPending: false });
      release(operation);
    }
  };

  const reload = async (): Promise<void> => {
    const state = input.getState();
    if (state.dirty) {
      setState({ error: "Còn bản nháp chưa lưu; hãy lưu hoặc bỏ bản nháp trước khi tải lại catalog." });
      return;
    }
    if (state.catalogLoading || state.localPending || state.externalPending || input.isReloadAvailable?.() === false || !input.onReload) return;
    const operation = begin("reload", state);
    setState({ localPending: true, error: "", notice: "" });
    try {
      await input.onReload();
      const current = input.getState();
      if (!matches(operation, current.revision) || !draftMatches(operation) || current.dirty !== operation.dirty) return;
      setState({ dirty: false, notice: "Đã yêu cầu tải lại catalog đã lưu.", localPending: false });
    } catch (caught) {
      const current = input.getState();
      if (matches(operation, current.revision) && draftMatches(operation) && current.dirty === operation.dirty) setState({ localPending: false, error: caught instanceof Error ? caught.message : "Không thể tải lại catalog." });
    } finally {
      const current = input.getState();
      if (matches(operation, current.revision) && draftMatches(operation) && current.dirty === operation.dirty && current.localPending) setState({ localPending: false });
      release(operation);
    }
  };

  const keyDown = (event: { key: string; preventDefault: () => void }, heading: Pick<HTMLElement, "isConnected" | "focus"> | null, panel: Pick<HTMLElement, "isConnected" | "focus"> | null): boolean => handleStrategyCatalogEscape(event, heading, panel);
  return { setScope, edit, save, reload, keyDown };
}

export function BrandStrategyPanel({ activeBrand, activeClientName, activeUserId, memberships, catalog, catalogRevision, catalogLoading = false, catalogError, activeChannel = "facebook", activeContentKind = "text", pending: externalPending, error: externalError, recipes, canManage, scopeKey, onChange, onSave, onReload }: BrandStrategyPanelProps) {
  const resolvedCanManage = activeUserId !== undefined && memberships !== undefined
    ? brandStrategyCanManage(activeBrand, memberships, activeUserId)
    : canManage;
  const [draftCatalog, setDraftCatalog] = useState<BrandStrategyCatalog | undefined>(() => catalog ? structuredClone(catalog) : undefined);
  const [selectedChannel, setSelectedChannel] = useState<SocialPlatform>(activeChannel);
  const [selectedContentKind, setSelectedContentKind] = useState<ContentKind>(activeContentKind);
  const [guidanceAngleId, setGuidanceAngleId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [localPending, setLocalPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const currentScopeRef = useRef(scopeKey);
  const currentRevisionRef = useRef(catalogRevision);
  const previousScopeRef = useRef(scopeKey);
  const draftCatalogRef = useRef(draftCatalog);
  const dirtyRef = useRef(dirty);
  currentScopeRef.current = scopeKey;
  currentRevisionRef.current = catalogRevision;
  draftCatalogRef.current = draftCatalog;
  dirtyRef.current = dirty;
  useEffect(() => {
    const scopeChanged = previousScopeRef.current !== scopeKey;
    const action = resolveStrategyCatalogHydrationAction({ scopeChanged, catalogLoading, dirty: dirtyRef.current, hasDraft: Boolean(draftCatalogRef.current), hasCanonicalCatalog: Boolean(catalog) });
    previousScopeRef.current = scopeKey;
    if (action === "preserve" || action === "wait") return;
    setDraftCatalog(catalog ? structuredClone(catalog) : undefined);
    setDirty(false);
    setLocalPending(false);
    setSelectedChannel(activeChannel);
    setSelectedContentKind(activeContentKind);
    setError(catalogError ?? externalError ?? "");
    setNotice("");
    setGuidanceAngleId("");
  }, [scopeKey, catalog?.version, catalog?.updatedAt, catalogLoading, activeChannel, activeContentKind]);
  useEffect(() => {
    if (!dirtyRef.current) setError(catalogError ?? externalError ?? "");
  }, [catalogError, externalError]);

  const panelStateRef = useRef<BrandStrategyPanelControllerState | undefined>(undefined);
  const panelInputsRef = useRef<{
    canManage: boolean;
    onChange?: (next: BrandStrategyCatalog) => void;
    onSave?: BrandStrategyPanelProps["onSave"];
    onReload?: BrandStrategyPanelProps["onReload"];
  }>({ canManage: resolvedCanManage });
  panelInputsRef.current = { canManage: resolvedCanManage, onChange, onSave, onReload };
  panelStateRef.current = { scopeKey, revision: catalogRevision, draft: draftCatalog, catalogLoading, externalPending: Boolean(externalPending), dirty, localPending, error, notice };
  const panelControllerRef = useRef<BrandStrategyPanelController | null>(null);
  if (!panelControllerRef.current) {
    panelControllerRef.current = createBrandStrategyPanelController({
      getState: () => panelStateRef.current!,
      setState: (next) => {
        panelStateRef.current = next;
        setDraftCatalog(next.draft);
        setDirty(next.dirty);
        setLocalPending(next.localPending);
        setError(next.error);
        setNotice(next.notice);
      },
      canManage: () => panelInputsRef.current.canManage,
      isSaveAvailable: () => Boolean(panelInputsRef.current.onSave),
      isReloadAvailable: () => canReloadStrategyCatalogPanel(panelStateRef.current!, Boolean(panelInputsRef.current.onReload)),
      onChange: (next) => panelInputsRef.current.onChange?.(next),
      onSave: async (next, nextScopeKey, nextRevision) => panelInputsRef.current.onSave
        ? await panelInputsRef.current.onSave(next, nextScopeKey, nextRevision)
        : { currentScope: false, error: "Strategy catalog save handler is unavailable." },
      onReload: async () => { await panelInputsRef.current.onReload?.(); },
    });
  }
  const panelController = panelControllerRef.current;
  const controllerScopeRef = useRef({ scopeKey, revision: catalogRevision });
  if (controllerScopeRef.current.scopeKey !== scopeKey || controllerScopeRef.current.revision !== catalogRevision) {
    controllerScopeRef.current = { scopeKey, revision: catalogRevision };
    panelController.setScope(scopeKey, catalogRevision);
  }

  const validation = draftCatalog ? validateStrategyCatalog(draftCatalog) : { ok: false as const, errors: ["STRATEGY_CATALOG_REQUIRED"] };
  const validationMessage = validation.ok ? "" : validation.errors.join(" · ");
  const edit = (change: StrategyCatalogEdit) => panelController.edit(change);
  const updateOverrideList = (field: "disabledObjectiveKeys" | "disabledPillarIds" | "disabledAngleIds", value: string, checked: boolean) => {
    if (!draftCatalog) return;
    const current = Array.isArray(draftCatalog.channelOverrides?.[selectedChannel]?.[field]) ? draftCatalog.channelOverrides[selectedChannel]![field] as string[] : [];
    const next = checked ? [...new Set([...current, value])] : current.filter((item) => item !== value);
    edit({ type: "update-override", channel: selectedChannel, patch: { [field]: next } as Partial<ChannelStrategyOverride> });
  };
  const updateGuidance = (angleId: string, value: string) => {
    if (!draftCatalog || !angleId) return;
    const raw = draftCatalog.channelOverrides?.[selectedChannel]?.guidanceByAngleId;
    const guidanceByAngleId = isRenderableStrategyObject(raw) ? { ...raw } as Record<string, string> : {};
    if (value.trim()) guidanceByAngleId[angleId] = value;
    else delete guidanceByAngleId[angleId];
    edit({ type: "update-override", channel: selectedChannel, patch: { guidanceByAngleId } });
  };
  const addObjective = () => {
    if (!draftCatalog || !Array.isArray(draftCatalog.objectives)) return;
    const key = STRATEGY_OBJECTIVE_KEYS.find((item) => !draftCatalog.objectives.some((objective) => isRenderableStrategyObject(objective) && objective.key === item));
    if (!key) { setError("Đã có đủ objective hợp lệ trong catalog."); return; }
    const label = `${key[0].toUpperCase()}${key.slice(1)}`;
    edit({ type: "add-objective", item: { key, label, description: `Define a useful ${key} outcome.`, enabled: true, order: draftCatalog.objectives.length + 1 } });
  };
  const addPillar = () => {
    if (!draftCatalog || !Array.isArray(draftCatalog.pillars)) return;
    const id = uniqueStrategyId("custom-pillar", draftCatalog.pillars.map((item) => item.id));
    const angleId = `${id}-starting-angle`;
    edit({ type: "add-pillar", item: { id, label: "New pillar", description: "Describe the role of this content pillar.", enabled: true, order: draftCatalog.pillars.length + 1, channels: [...strategyChannels], angles: [{ id: angleId, label: "Starting angle", guidance: "Describe one useful angle.", enabled: true, order: 1, channels: [...strategyChannels] }] } });
  };
  const addAngle = (pillar: ContentPillarDefinition) => {
    if (!draftCatalog || !Array.isArray(draftCatalog.pillars)) return;
    const sourcePillar = draftCatalog.pillars.find((item) => isRenderableStrategyObject(item) && item.id === pillar.id);
    if (!sourcePillar || !Array.isArray(sourcePillar.angles)) return;
    const id = uniqueStrategyId(`${pillar.id}-angle`, sourcePillar.angles.filter(isRenderableStrategyObject).map((item) => safeStrategyText(item.id, "invalid-angle")));
    edit({ type: "add-angle", pillarId: pillar.id, item: { id, label: "New angle", guidance: "Describe one useful angle.", enabled: true, order: sourcePillar.angles.length + 1, channels: [...strategyChannels] } });
  };
  const addOverridePillar = () => {
    if (!draftCatalog || !Array.isArray(draftCatalog.pillars) || !isRenderableStrategyObject(draftCatalog.channelOverrides)) return;
    const override = isRenderableStrategyObject(draftCatalog.channelOverrides[selectedChannel]) ? draftCatalog.channelOverrides[selectedChannel] as ChannelStrategyOverride : {};
    const ids = [...draftCatalog.pillars.filter(isRenderableStrategyObject).map((item) => safeStrategyText(item.id, "invalid-pillar")), ...(Array.isArray(override.addedPillars) ? override.addedPillars.filter(isRenderableStrategyObject).map((item) => safeStrategyText(item.id, "invalid-pillar")) : [])];
    const id = uniqueStrategyId(`${selectedChannel}-pillar`, ids);
    const next = [...(override.addedPillars ?? []), { id, label: `${strategyChannelLabels[selectedChannel]} pillar`, description: "Channel-specific pillar.", enabled: true, order: draftCatalog.pillars.length + (override.addedPillars?.length ?? 0) + 1, channels: [selectedChannel], angles: [{ id: `${id}-angle`, label: "Channel angle", guidance: "Use one channel-specific angle.", enabled: true, order: 1, channels: [selectedChannel] }] }];
    edit({ type: "update-override", channel: selectedChannel, patch: { addedPillars: next } });
  };
  const addOverrideAngle = (pillar: ContentPillarDefinition) => {
    if (!draftCatalog || !isRenderableStrategyObject(draftCatalog.channelOverrides)) return;
    const override = isRenderableStrategyObject(draftCatalog.channelOverrides[selectedChannel]) ? draftCatalog.channelOverrides[selectedChannel] as ChannelStrategyOverride : {};
    const current = Array.isArray(override.addedAnglesByPillarId?.[pillar.id]) ? override.addedAnglesByPillarId[pillar.id] : [];
    const id = uniqueStrategyId(`${pillar.id}-${selectedChannel}-angle`, [...pillar.angles.map((item) => item.id), ...current.map((item) => item.id)]);
    const addedAnglesByPillarId = { ...(override.addedAnglesByPillarId ?? {}), [pillar.id]: [...current, { id, label: `${strategyChannelLabels[selectedChannel]} angle`, guidance: "Use a channel-specific angle.", enabled: true, order: pillar.angles.length + current.length + 1, channels: [selectedChannel] }] };
    edit({ type: "update-override", channel: selectedChannel, patch: { addedAnglesByPillarId } });
  };
  const save = () => panelController.save();
  const reload = () => panelController.reload();
  const renderObjectives = renderStrategyObjectives(draftCatalog?.objectives);
  const renderPillars = renderStrategyPillars(draftCatalog?.pillars);
  const projection = useMemo(() => {
    if (!draftCatalog) return undefined;
    try { return projectStrategyCatalogForUi(draftCatalog, selectedChannel); } catch { return undefined; }
  }, [selectedChannel, draftCatalog]);
  const rawOverride = draftCatalog?.channelOverrides?.[selectedChannel];
  const override: ChannelStrategyOverride = rawOverride && typeof rawOverride === "object" && !Array.isArray(rawOverride) ? rawOverride : {};
  const angleOptions = renderPillars.flatMap((pillar) => pillar.angles.map((angle) => ({ ...angle, pillarId: pillar.id, pillarLabel: pillar.label })));
  const selectedGuidanceAngle = angleOptions.find((angle) => angle.id === guidanceAngleId) ?? angleOptions[0];
  const invalidText = catalogError || externalError || error || strategyCatalogErrorMessage(draftCatalog);
  const disabledObjectiveKeys = new Set(Array.isArray(override.disabledObjectiveKeys) ? override.disabledObjectiveKeys : []);
  const disabledPillarIds = new Set(Array.isArray(override.disabledPillarIds) ? override.disabledPillarIds : []);
  const disabledAngleIds = new Set(Array.isArray(override.disabledAngleIds) ? override.disabledAngleIds : []);
  const baseFingerprint = useMemo(() => {
    if (!draftCatalog) return "—";
    try { return strategyCatalogFingerprint(draftCatalog); } catch { return "invalid"; }
  }, [draftCatalog]);
  const busy = catalogLoading || localPending || Boolean(externalPending);
  const disabled = busy || !resolvedCanManage || !validation.ok;
  const disabledObjectiveLabels = renderObjectives.filter((objective) => disabledObjectiveKeys.has(objective.key)).map((objective) => objective.label);
  const disabledPillarLabels = renderPillars.filter((pillar) => disabledPillarIds.has(pillar.id)).map((pillar) => pillar.label);
  const disabledAngleLabels = angleOptions.filter((angle) => disabledAngleIds.has(angle.id)).map((angle) => angle.label) ?? [];
  const panelRef = useRef<HTMLElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!handleStrategyCatalogEscape(event, panelHeadingRef.current, panelRef.current)) return;
    setNotice("Đã đóng chỉnh sửa trường hiện tại; bản nháp vẫn được giữ lại.");
  };
  return <article ref={panelRef} tabIndex={-1} onKeyDown={handlePanelKeyDown} className="panel strategy-catalog-panel" data-testid="brand-strategy-panel">
    <div className="panel-heading"><div><p className="panel-kicker">CONTENT STRATEGY</p><h2 ref={panelHeadingRef} tabIndex={-1}>Objectives, pillars & angles</h2></div><div className="strategy-catalog-actions"><button type="button" className="secondary-button" onClick={() => void reload()} disabled={!canReloadStrategyCatalogPanel({ catalogLoading, externalPending: Boolean(externalPending), dirty, localPending }, Boolean(onReload))}>{busy ? "Working…" : "Reload saved catalog"}</button><button type="button" className="primary-button" onClick={() => void save()} disabled={disabled || !dirty || !validation.ok || !onSave}>{busy ? "Saving…" : error && dirty ? "Retry save" : "Save catalog"}</button></div></div>
    <div className="strategy-catalog-meta"><span>Client <strong>{activeClientName?.trim() || "Current client"}</strong></span><span>Brand <strong>{activeBrand.name}</strong></span><span>Version <strong>{draftCatalog?.version ?? "—"}</strong></span><span>Fingerprint <strong title={baseFingerprint}>{baseFingerprint}</strong></span><span>Saved at <strong>{draftCatalog?.updatedAt ?? "—"}</strong></span><span className={dirty ? "warning-text" : "positive-text"}>{dirty ? "Unsaved draft" : "Saved state"}</span></div>
    {dirty && <div className="strategy-catalog-pending" role="status">Reload bị khóa khi còn bản nháp chưa lưu. Hãy lưu hoặc bỏ bản nháp trước.</div>}
    {(catalogLoading || !draftCatalog) && <div className="strategy-catalog-empty" role="status">{catalogLoading ? "Đang tải catalog theo Client/Brand…" : "Chưa có catalog cho Brand này."}<button type="button" className="text-button" onClick={() => void reload()} disabled={!canReloadStrategyCatalogPanel({ catalogLoading, externalPending: Boolean(externalPending), dirty, localPending }, Boolean(onReload))}>Reload saved catalog</button></div>}
    {externalPending && <div className="strategy-catalog-pending" role="status" aria-live="polite">Đang chờ durable ACK cho catalog · revision {externalPending.revision}.</div>}
    {draftCatalog && <>
      {!resolvedCanManage && <div className="queue-notice" role="status">Role hiện tại chỉ được xem; chỉnh sửa catalog cần capability manage_brand.</div>}
      {invalidText && <div className="strategy-catalog-error" role="alert">Catalog validation: {invalidText}</div>}
      {notice && <div className="success-banner" role="status">✓ {notice}</div>}
      {Array.isArray(draftCatalog.objectives) && Array.isArray(draftCatalog.pillars) && <>
      <section className="strategy-catalog-section" aria-labelledby="strategy-objectives-heading"><div className="strategy-section-heading"><div><h3 id="strategy-objectives-heading">Objectives</h3><small>Enable, describe and order the five strategic outcomes.</small></div><button type="button" className="text-button" onClick={addObjective} disabled={disabled}>Add objective</button></div><div className="strategy-objective-list">{renderObjectives.map((objective, index) => <article className="strategy-objective-card" key={`${objective.key}-${index}`}><div className="strategy-card-toolbar"><label className="check-row"><input type="checkbox" checked={objective.enabled} disabled={disabled} onChange={(event) => edit({ type: "set-objective", key: objective.key, patch: { enabled: event.target.checked } })}/><strong>{objective.label}</strong></label><span className="strategy-id">{objective.key}</span><button type="button" className="text-button" onClick={() => edit({ type: "move-objective", key: objective.key, direction: "up" })} disabled={disabled || index === 0} aria-label={`Move objective ${objective.label} up`}>↑</button><button type="button" className="text-button" onClick={() => edit({ type: "move-objective", key: objective.key, direction: "down" })} disabled={disabled || index === renderObjectives.length - 1} aria-label={`Move objective ${objective.label} down`}>↓</button><button type="button" className="text-button danger-text" onClick={() => edit({ type: "remove-objective", key: objective.key })} disabled={disabled || renderObjectives.length <= STRATEGY_OBJECTIVE_KEYS.length}>Delete</button></div><div className="strategy-fields"><label className="field-label">Label<input value={objective.label} disabled={disabled} onChange={(event) => edit({ type: "set-objective", key: objective.key, patch: { label: event.target.value } })}/></label><label className="field-label">Order<input type="number" min="1" value={objective.order} disabled={disabled} onChange={(event) => edit({ type: "set-objective", key: objective.key, patch: { order: Number(event.target.value) } })}/></label><label className="field-label full-field">Description<textarea value={objective.description} disabled={disabled} rows={2} onChange={(event) => edit({ type: "set-objective", key: objective.key, patch: { description: event.target.value } })}/></label></div>{!validation.ok && <small className="strategy-inline-error">{validationMessage} · item {objective.key} / order {objective.order}</small>}</article>)}</div></section>
      <section className="strategy-catalog-section" aria-labelledby="strategy-pillars-heading"><div className="strategy-section-heading"><div><h3 id="strategy-pillars-heading">Pillars & angles</h3><small>Each pillar owns its enabled angles and channel applicability.</small></div><button type="button" className="text-button" onClick={addPillar} disabled={disabled}>Add base pillar</button></div><div className="strategy-pillar-list">{renderPillars.map((pillar, pillarIndex) => <article className="strategy-pillar-card" key={`${pillar.id}-${pillarIndex}`}><div className="strategy-card-toolbar"><label className="check-row"><input type="checkbox" checked={pillar.enabled} disabled={disabled} onChange={(event) => edit({ type: "set-pillar", id: pillar.id, patch: { enabled: event.target.checked } })}/><strong>{pillar.label}</strong></label><span className="strategy-id">{pillar.id}</span><button type="button" className="text-button" onClick={() => edit({ type: "move-pillar", id: pillar.id, direction: "up" })} disabled={disabled || pillarIndex === 0} aria-label={`Move pillar ${pillar.label} up`}>↑</button><button type="button" className="text-button" onClick={() => edit({ type: "move-pillar", id: pillar.id, direction: "down" })} disabled={disabled || pillarIndex === renderPillars.length - 1} aria-label={`Move pillar ${pillar.label} down`}>↓</button><button type="button" className="text-button danger-text" onClick={() => edit({ type: "remove-pillar", id: pillar.id })} disabled={disabled || renderPillars.length <= 1}>Delete pillar</button></div><div className="strategy-fields"><label className="field-label">Label<input value={pillar.label} disabled={disabled} onChange={(event) => edit({ type: "set-pillar", id: pillar.id, patch: { label: event.target.value } })}/></label><label className="field-label">Order<input type="number" min="1" value={pillar.order} disabled={disabled} onChange={(event) => edit({ type: "set-pillar", id: pillar.id, patch: { order: Number(event.target.value) } })}/></label><label className="field-label full-field">Description<textarea value={pillar.description} disabled={disabled} rows={2} onChange={(event) => edit({ type: "set-pillar", id: pillar.id, patch: { description: event.target.value } })}/></label></div><div className="strategy-channel-checks"><span>Channels</span>{strategyChannels.map((channel) => <label key={channel}><input type="checkbox" checked={pillar.channels.includes(channel)} disabled={disabled} onChange={() => edit({ type: "toggle-pillar-channel", pillarId: pillar.id, channel })}/>{strategyChannelLabels[channel]}</label>)}</div><div className="strategy-angle-list">{pillar.angles.map((angle, angleIndex) => <article className="strategy-angle-card" key={`${pillar.id}-${angle.id}-${angleIndex}`}><div className="strategy-card-toolbar"><label className="check-row"><input type="checkbox" checked={angle.enabled} disabled={disabled} onChange={(event) => edit({ type: "set-angle", pillarId: pillar.id, id: angle.id, patch: { enabled: event.target.checked } })}/><strong>{angle.label}</strong></label><span className="strategy-id">{angle.id}</span><button type="button" className="text-button" onClick={() => edit({ type: "move-angle", pillarId: pillar.id, id: angle.id, direction: "up" })} disabled={disabled || angleIndex === 0} aria-label={`Move angle ${angle.label} up`}>↑</button><button type="button" className="text-button" onClick={() => edit({ type: "move-angle", pillarId: pillar.id, id: angle.id, direction: "down" })} disabled={disabled || angleIndex === pillar.angles.length - 1} aria-label={`Move angle ${angle.label} down`}>↓</button><button type="button" className="text-button danger-text" onClick={() => edit({ type: "remove-angle", pillarId: pillar.id, id: angle.id })} disabled={disabled || pillar.angles.length <= 1}>Delete angle</button></div><div className="strategy-fields"><label className="field-label">Label<input value={angle.label} disabled={disabled} onChange={(event) => edit({ type: "set-angle", pillarId: pillar.id, id: angle.id, patch: { label: event.target.value } })}/></label><label className="field-label">Order<input type="number" min="1" value={angle.order} disabled={disabled} onChange={(event) => edit({ type: "set-angle", pillarId: pillar.id, id: angle.id, patch: { order: Number(event.target.value) } })}/></label><label className="field-label full-field">Guidance<textarea value={angle.guidance} disabled={disabled} rows={2} onChange={(event) => edit({ type: "set-angle", pillarId: pillar.id, id: angle.id, patch: { guidance: event.target.value } })}/></label></div><div className="strategy-channel-checks">{strategyChannels.map((channel) => <label key={channel}><input type="checkbox" checked={angle.channels.includes(channel)} disabled={disabled} onChange={() => edit({ type: "toggle-angle-channel", pillarId: pillar.id, id: angle.id, channel })}/>{strategyChannelLabels[channel]}</label>)}</div><label className="field-label">Recipe<select value={angle.recipeId ?? ""} disabled={disabled} onChange={(event) => edit({ type: "set-angle", pillarId: pillar.id, id: angle.id, patch: { recipeId: event.target.value || undefined } })}><option value="">No assigned recipe</option>{strategyRecipeOptions(recipes, activeBrand.id, selectedChannel, selectedContentKind, { pillarId: pillar.id, angleId: angle.id }).map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label></article>)}<button type="button" className="secondary-button" onClick={() => addAngle(pillar)} disabled={disabled}>Add base angle</button></div>{!validation.ok && <small className="strategy-inline-error">{validationMessage} · pillar {pillar.id}</small>}</article>)}</div></section>
      <section className="strategy-catalog-section" aria-labelledby="strategy-overrides-heading"><div className="strategy-section-heading"><div><h3 id="strategy-overrides-heading">Channel overrides</h3><small>Disable base items or add guidance without mutating the base catalog.</small></div><label className="field-label strategy-channel-select">Channel<select value={selectedChannel} disabled={disabled} onChange={(event) => setSelectedChannel(event.target.value as SocialPlatform)}>{strategyChannels.map((channel) => <option key={channel} value={channel}>{strategyChannelLabels[channel]}</option>)}</select></label></div><div className="strategy-override-grid"><fieldset><legend>Disable base items</legend><div className="strategy-override-list"><strong>Objectives</strong>{renderObjectives.map((objective) => <label key={`${objective.key}-override`}><input type="checkbox" checked={disabledObjectiveKeys.has(objective.key)} disabled={disabled} onChange={(event) => updateOverrideList("disabledObjectiveKeys", objective.key, event.target.checked)}/>{objective.label}</label>)}<strong>Pillars</strong>{renderPillars.map((pillar, index) => <label key={`${pillar.id}-${index}-override`}><input type="checkbox" checked={disabledPillarIds.has(pillar.id)} disabled={disabled} onChange={(event) => updateOverrideList("disabledPillarIds", pillar.id, event.target.checked)}/>{pillar.label}</label>)}<strong>Angles</strong>{angleOptions.map((angle, index) => <label key={`${angle.id}-${index}-override`}><input type="checkbox" checked={disabledAngleIds.has(angle.id)} disabled={disabled} onChange={(event) => updateOverrideList("disabledAngleIds", angle.id, event.target.checked)}/>{angle.label} · {angle.pillarLabel}</label>)}</div></fieldset><fieldset><legend>Guidance and additions</legend><label className="field-label">Recipe content kind<select aria-label="Recipe content kind" value={selectedContentKind} disabled={disabled} onChange={(event) => setSelectedContentKind(event.target.value as ContentKind)}>{(["text", "image", "carousel", "video", "short_video", "long_video"] as ContentKind[]).map((kind) => <option key={kind} value={kind}>{kind.replace(/_/g, " ")}</option>)}</select></label><label className="field-label">Angle guidance<select value={selectedGuidanceAngle?.id ?? ""} disabled={disabled} onChange={(event) => setGuidanceAngleId(event.target.value)}>{angleOptions.map((angle) => <option key={angle.id} value={angle.id}>{angle.label}</option>)}</select></label><label className="field-label">Effective guidance<textarea value={(selectedGuidanceAngle && override.guidanceByAngleId?.[selectedGuidanceAngle.id]) ?? selectedGuidanceAngle?.guidance ?? ""} disabled={disabled} rows={3} onChange={(event) => updateGuidance(selectedGuidanceAngle?.id ?? "", event.target.value)}/></label><div className="strategy-override-buttons"><button type="button" className="secondary-button" onClick={addOverridePillar} disabled={disabled}>Add channel pillar</button>{renderPillars.map((pillar, index) => <button type="button" className="text-button" key={`${pillar.id}-${index}-add-angle`} onClick={() => addOverrideAngle(pillar)} disabled={disabled}>Add {strategyChannelLabels[selectedChannel]} angle to {pillar.label}</button>)}</div></fieldset></div><div className="strategy-effective-preview" data-testid="strategy-effective-preview"><div className="strategy-section-heading"><div><h4>Effective {strategyChannelLabels[selectedChannel]} catalog</h4><small>Read-only projection after base disables, guidance and channel additions.</small></div>{projection && <span className="strategy-fingerprint">{projection.fingerprint.slice(0, 12)}</span>}</div>{projection ? <><p><strong>Base items disabled:</strong> objectives: {disabledObjectiveLabels.join(", ") || "none"}; pillars: {disabledPillarLabels.join(", ") || "none"}; angles: {disabledAngleLabels.join(", ") || "none"}.</p><p><strong>Overrides in effect:</strong> {Object.keys(override.guidanceByAngleId ?? {}).length} guidance override(s), {(override.addedPillars ?? []).length} channel pillar(s), {Object.values(override.addedAnglesByPillarId ?? {}).flat().length} channel angle(s).</p><div className="strategy-effective-list">{projection.catalog.objectives.map((objective) => <span key={objective.key}><strong>{objective.label}</strong></span>)}{projection.catalog.pillars.map((pillar) => <div key={pillar.id}><strong>{pillar.label}</strong><small>{pillar.angles.map((angle) => angle.label).join(" · ")}</small></div>)}</div></> : <p role="alert">Effective preview unavailable until the catalog is valid.</p>}</div></section>
      </>}
    </>}
  </article>;
}

export type BrandViewV2Props = Pick<Props, "activeBrand" | "activeUserId" | "brandVoice" | "brandVisualTokens" | "savedNotice" | "onBrandVoiceChange" | "onBrandVisualTokensChange" | "onSaveBrand" | "workspaceState" | "onBrandIdentityChange" | "activeWorkspace" | "strategyCatalog" | "strategyCatalogRevision" | "strategyCatalogLoading" | "strategyCatalogError" | "contentRecipes" | "currentMembership" | "onSaveStrategyCatalog" | "onReloadStrategyCatalog">;

export function BrandViewV2({ activeBrand, activeUserId, brandVoice, savedNotice, onBrandVoiceChange, onSaveBrand, workspaceState, onBrandIdentityChange, activeWorkspace, strategyCatalog, strategyCatalogRevision = 0, strategyCatalogLoading, strategyCatalogError, contentRecipes = [], onSaveStrategyCatalog, onReloadStrategyCatalog }: BrandViewV2Props) {
  const identity = resolveActiveBrandIdentity(activeBrand.id, workspaceState.brandIdentities ?? []) ?? workspaceState.brandIdentities?.find((item) => item.brandId === activeBrand.id);
  const updateIdentity = (patch: Partial<BrandIdentityRecord>) => { if (identity && onBrandIdentityChange) onBrandIdentityChange({ ...identity, ...patch, strategy: { ...identity.strategy, ...(patch.strategy ?? {}) }, voice: { ...identity.voice, ...(patch.voice ?? {}) }, visual: { ...identity.visual, ...(patch.visual ?? {}) } }); };
  const updateList = (field: "values" | "personality", value: string) => { if (!identity) return; updateIdentity({ strategy: { ...identity.strategy, [field]: value.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean) } }); };
  const updateProhibited = (value: string) => { if (!identity) return; updateIdentity({ voice: { ...identity.voice, prohibitedClaims: value.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean) } }); };
  const updateColors = (value: string, index: number, field: "name" | "hex" | "rgb" | "cmyk") => { if (!identity) return; const colors = identity.visual.colors.map((color, colorIndex) => colorIndex === index ? { ...color, [field]: value } : color); updateIdentity({ visual: { ...identity.visual, colors } }); };
  const canManage = brandStrategyCanManage(activeBrand, workspaceState.memberships, activeUserId);
  return <section className="expanded-view"><ViewHeader kicker="GOVERNANCE" title="Brand system" subtitle="One versioned identity powers every provider, post, target and visual." action="Save brand system" onAction={onSaveBrand}/>{savedNotice && <div className="success-banner">✓ {savedNotice}</div>}<div className="brand-identity-grid"><article className="panel settings-card"><PanelHeading kicker="IDENTITY VERSION" title={activeBrand.name}/><div className="identity-version-banner"><strong>{identity?.name ?? "No identity"} · v{identity?.version ?? 0}</strong><span>{identity?.isDefault ? "Default identity" : "Alternate identity"} · {identity?.status ?? "draft"}</span></div><label className="field-label">Brand voice<textarea value={brandVoice} onChange={(event) => onBrandVoiceChange(event.target.value)} rows={4}/></label>{identity ? <><label className="field-label">Vision<input value={identity.strategy.vision} onChange={(event) => updateIdentity({ strategy: { ...identity.strategy, vision: event.target.value } })}/></label><label className="field-label">Mission<textarea value={identity.strategy.mission} onChange={(event) => updateIdentity({ strategy: { ...identity.strategy, mission: event.target.value } })} rows={3}/></label><label className="field-label">Values<textarea value={identity.strategy.values.join(", ")} onChange={(event) => updateList("values", event.target.value)} rows={2} placeholder="Trust, clarity, care"/></label><label className="field-label">Personality<textarea value={identity.strategy.personality.join(", ")} onChange={(event) => updateList("personality", event.target.value)} rows={2} placeholder="Warm, direct, practical"/></label><label className="field-label">Audience<input value={identity.strategy.audience} onChange={(event) => updateIdentity({ strategy: { ...identity.strategy, audience: event.target.value } })}/></label><label className="field-label">Positioning<textarea value={identity.strategy.positioning ?? ""} onChange={(event) => updateIdentity({ strategy: { ...identity.strategy, positioning: event.target.value } })} rows={2}/></label><label className="field-label">Identity tone<input value={identity.voice.tone} onChange={(event) => updateIdentity({ voice: { ...identity.voice, tone: event.target.value } })}/></label><label className="field-label">Vocabulary<textarea value={identity.voice.vocabulary.join(", ")} onChange={(event) => updateIdentity({ voice: { ...identity.voice, vocabulary: event.target.value.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean) } })} rows={2}/></label><label className="field-label">Prohibited claims<textarea value={identity.voice.prohibitedClaims.join(", ")} onChange={(event) => updateProhibited(event.target.value)} rows={2}/></label><label className="field-label">Required disclosure<textarea value={identity.voice.requiredDisclosure ?? ""} onChange={(event) => updateIdentity({ voice: { ...identity.voice, requiredDisclosure: event.target.value } })} rows={2}/></label></> : <div className="empty-state">Brand Identity chưa được tạo.</div>}</article><article className="panel settings-card"><PanelHeading kicker="VISUAL IDENTITY" title="Brand Kit fields"/>{identity && <><label className="field-label">Logo asset IDs<input value={identity.visual.logoAssetIds.join(", ")} onChange={(event) => updateIdentity({ visual: { ...identity.visual, logoAssetIds: event.target.value.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean) } })} placeholder="asset-logo-primary"/></label><label className="field-label">Tagline<input value={identity.visual.tagline ?? ""} onChange={(event) => updateIdentity({ visual: { ...identity.visual, tagline: event.target.value } })}/></label><label className="field-label">Heading typography<input value={identity.visual.typography.heading} onChange={(event) => updateIdentity({ visual: { ...identity.visual, typography: { ...identity.visual.typography, heading: event.target.value } } })}/></label><label className="field-label">Body typography<input value={identity.visual.typography.body} onChange={(event) => updateIdentity({ visual: { ...identity.visual, typography: { ...identity.visual.typography, body: event.target.value } } })}/></label><div className="identity-colors">{identity.visual.colors.map((color, index) => <div className="identity-color-row" key={`${color.name}-${index}`}><input value={color.name} aria-label={`Color ${index + 1} name`} onChange={(event) => updateColors(event.target.value, index, "name")}/><input value={color.hex} aria-label={`Color ${index + 1} HEX`} onChange={(event) => updateColors(event.target.value, index, "hex")}/><input value={color.rgb ?? ""} aria-label={`Color ${index + 1} RGB`} placeholder="RGB" onChange={(event) => updateColors(event.target.value, index, "rgb")}/><input value={color.cmyk ?? ""} aria-label={`Color ${index + 1} CMYK`} placeholder="CMYK" onChange={(event) => updateColors(event.target.value, index, "cmyk")}/></div>)}</div><label className="field-label">Style guide<textarea value={identity.visual.styleGuide} onChange={(event) => updateIdentity({ visual: { ...identity.visual, styleGuide: event.target.value } })} rows={8}/></label></>}</article><article className="panel settings-card"><PanelHeading kicker="GUARDRAILS" title="Content rules"/>{["Claims require source", "No get-rich-quick language", "Human review before publish"].map((rule) => <div className="rule-row" key={rule}><div><strong>{rule}</strong><span>Applied to every generated variant</span></div><span className="toggle on" aria-hidden="true"><i/></span></div>)}</article></div><BrandStrategyPanel activeBrand={activeBrand} activeClientId={clientIdForBrand(activeBrand)} activeClientName={activeWorkspace.name} activeUserId={activeUserId} memberships={workspaceState.memberships} catalog={strategyCatalog} catalogRevision={strategyCatalogRevision} catalogLoading={strategyCatalogLoading} catalogError={strategyCatalogError} recipes={contentRecipes} canManage={canManage} scopeKey={strategyCatalogScopeKey(clientIdForBrand(activeBrand), activeBrand.id)} onSave={onSaveStrategyCatalog} onReload={onReloadStrategyCatalog}/></section>;
}

function MembershipPanel({ workspace, memberships }: { workspace: WorkspaceRecord; memberships: MembershipRecord[] }) { const members = memberships.filter((member) => member.workspaceId === workspace.id); return <article className="panel settings-card full-settings"><PanelHeading kicker="ROLE & MEMBERSHIP" title={`${members.length} workspace members`}/><div className="membership-list">{members.map((member) => <div className="membership-row" key={member.id}><div className="user-avatar small-avatar">{member.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div><div><strong>{member.displayName}</strong><span>{member.email}</span></div><span className={`membership-status ${member.status}`}>{member.status}</span><strong className="role-label">{member.role}</strong></div>)}</div><small className="muted-note">Role capabilities: owner/admin manage workspace; editor creates and schedules; reviewer approves; analyst views analytics.</small></article>; }

function AuditViewer({ entries }: { entries: AuditEntry[] }) { const recent = entries.slice(-8).reverse(); return <article className="panel settings-card full-settings"><PanelHeading kicker="AUDIT & DIAGNOSTICS" title="Local operation history"/><div className="audit-viewer"><div className="audit-toolbar"><span>{entries.length} scalar-only audit entries</span><span className="safe-note"><span className="online-dot"/> Secrets excluded</span></div>{recent.length === 0 ? <div className="empty-state">No queue audit entries yet. Approve or schedule a draft to create one.</div> : recent.map((entry) => <div className="audit-row" key={entry.id}><span className="audit-time">{new Date(entry.timestamp).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><strong>{entry.action.replace(/_/g, " ")}</strong><span className={`audit-outcome ${entry.outcome}`}>{entry.outcome}</span><span>{entry.platform ?? "local"}</span><small>{entry.message ?? entry.jobId}</small></div>)}</div></article>; }

type AccountBrowserKey = "gemini" | "drive" | "chatgpt";
type AccountBrowserStatus = { connected?: boolean; windowOpen?: boolean; loginRequired?: boolean; accountHint?: string | null; candidateSummary?: string; url?: string };

const accountBrowsers: Record<AccountBrowserKey, { open: string; status: string; label: string; detail: string }> = {
  gemini: { open: "gemini_web_open", status: "gemini_web_status", label: "Gemini Pro", detail: "AI subscription session" },
  drive: { open: "drive_web_open", status: "drive_web_status", label: "Google Drive", detail: "Media hosting account" },
  chatgpt: { open: "chatgpt_web_open", status: "chatgpt_web_status", label: "ChatGPT Plus", detail: "AI subscription session" },
};

function AccountBrowserSessions({ onOpenAIProviderAccount }: { onOpenAIProviderAccount: (provider: AIProvider) => void }) {
  const [statuses, setStatuses] = useState<Partial<Record<AccountBrowserKey, AccountBrowserStatus>>>({});
  const [busy, setBusy] = useState<AccountBrowserKey | "">("");
  const [notice, setNotice] = useState("");
  const refresh = async () => {
    const next: Partial<Record<AccountBrowserKey, AccountBrowserStatus>> = {};
    await Promise.all(Object.entries(accountBrowsers).map(async ([key, config]) => {
      try { next[key as AccountBrowserKey] = await invoke<AccountBrowserStatus>(config.status); } catch { next[key as AccountBrowserKey] = { connected: false, windowOpen: false, loginRequired: true }; }
    }));
    setStatuses(next);
  };
  useEffect(() => { void refresh(); }, []);
  const open = async (key: AccountBrowserKey) => {
    setBusy(key); setNotice("");
    try {
      if (key === "gemini") await onOpenAIProviderAccount("gemini");
      else if (key === "chatgpt") await onOpenAIProviderAccount("openai");
      else await invoke(accountBrowsers[key].open);
      await refresh();
      window.setTimeout(() => void refresh(), 2500);
      setNotice(`${accountBrowsers[key].label} đã mở trong Chrome window do SignalFlow quản lý. Đăng nhập trong cửa sổ đó nếu cần.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Không thể mở ${accountBrowsers[key].label}.`);
    } finally { setBusy(""); }
  };
  return <article className="panel settings-card full-settings"><PanelHeading kicker="SIGNALFLOW ACCOUNT WINDOWS" title="Chromium account sessions"/><p className="settings-help">Mỗi dịch vụ có một profile Chrome persistent riêng do SignalFlow sở hữu. SignalFlow mở và điều khiển cửa sổ Chrome qua local CDP; đây không phải WKWebView và không dùng Chrome profile cá nhân. Hồ sơ giữ dữ liệu phiên qua lần đóng/mở app; SignalFlow không đọc, giải mã hoặc copy cookie, password hay token ra ngoài bridge.</p><div className="account-session-row">{(Object.keys(accountBrowsers) as AccountBrowserKey[]).map((key) => { const config = accountBrowsers[key]; const status = statuses[key]; const state = status?.connected ? "Đã đăng nhập" : status?.windowOpen ? "Cửa sổ đang mở" : "Chưa xác nhận"; const accountHint = status?.accountHint ? ` · ${status.accountHint}` : ""; return <div className="account-session-item" key={key}><div><strong>{config.label}</strong><span>{config.detail}{accountHint} · {state}</span></div><button className="text-button" disabled={busy !== ""} onClick={() => void open(key)}>{busy === key ? "Opening…" : "Open / continue"}</button></div>; })}</div>{notice && <div className="queue-notice"><span className="online-dot"/><span>{notice}</span></div>}</article>;
}

function DurableWorkerStatus({ workspaceId }: { workspaceId: string }) {
  const client = useMemo(() => createDurableWorkerClient(), []);
  const [health, setHealth] = useState<DurableWorkerHealth | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"refresh" | "stop" | "recover" | "">("");
  const refresh = async () => {
    if (!client) return;
    setBusy("refresh");
    try {
      setHealth(await client.health(workspaceId));
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Worker health check failed.");
    } finally {
      setBusy("");
    }
  };
  useEffect(() => { void refresh(); }, [client, workspaceId]);
  const control = async (action: "stop" | "recover") => {
    if (!client) return;
    setBusy(action);
    try {
      const result = action === "stop" ? await client.safeStop("settings_operator_stop") : await client.recover("settings_operator_recovery");
      setNotice(action === "stop" ? "Safe stop đã bật. Worker không nhận job mới; restart service để resume." : `Đã recovery ${result.recoveredJobs ?? 0} job interrupted về trạng thái queued.`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Worker control action failed.");
    } finally {
      setBusy("");
    }
  };
  const stopped = health?.workerState === "stopped" || health?.safeStopRequested;
  const statusText = !client ? "Worker chưa được bật" : !health ? "Đang kiểm tra worker…" : health.configurationStatus === "ready" ? "Ready · approved Facebook Page text only" : "Blocked · live executor/auth missing";
  const statusTone = health?.configurationStatus === "ready" && !stopped ? "healthy" : "attention";
  return <article className="panel settings-card full-settings"><PanelHeading kicker="DURABLE EXECUTION" title="Closed-app worker"/><p className="settings-help">Worker chỉ nhận job đã được human approval. Live mode chỉ dành cho Facebook Page text đã approved, qua control plane và Page token trong .env credential file; không chạy AI subscription, không đọc Chrome profile/session và không nhận token từ renderer. Live executor hoặc auth thiếu sẽ bị chặn.</p><div className="rule-row"><div><strong>{statusText}</strong><span>{client ? health ? `Workspace-scoped queue · ${health.queue.queued} queued · ${health.queue.running} running · ${health.queue.failed} failed` : "Health chưa xác nhận." : "Đặt VITE_WORKER_URL rồi build lại để bật closed-app worker; nếu không, app chỉ dùng scheduler khi cửa sổ mở."}</span></div><span className={`connection-state ${statusTone}`}>{!client ? "Not configured" : !health ? "Checking" : stopped ? "Safe stopped" : health.configurationStatus === "ready" ? "Ready" : "Blocked"}</span></div>{client && <div className="meta-settings-actions"><button className="secondary-button" disabled={busy !== ""} onClick={() => void refresh()}>{busy === "refresh" ? "Refreshing…" : "Refresh health"}</button><button className="secondary-button" disabled={busy !== "" || stopped} onClick={() => void control("stop")}>Safe stop</button><button className="secondary-button" disabled={busy !== "" || !stopped} onClick={() => void control("recover")}>{busy === "recover" ? "Recovering…" : "Recover interrupted jobs"}</button></div>}{notice && <div className="queue-notice"><span className="online-dot"/><span>{notice}</span></div>}</article>;
}

function ProviderSetupPanel({ onSave, onProbe, notice }: { onSave: Props["onSaveProviderConfiguration"]; onProbe: Props["onProbeProviderConfiguration"]; notice: string }) {
  const [providerKind, setProviderKind] = useState("openrouter");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [projectId, setProjectId] = useState("");
  const [location, setLocation] = useState("");
  const [secretRef, setSecretRef] = useState("");
  const [operatorApproved, setOperatorApproved] = useState(false);
  const submit = () => void onSave({ providerKind, model, baseUrl: baseUrl || undefined, projectId: projectId || undefined, location: location || undefined, secretRef });
  const needsBaseUrl = providerKind === "openai_compatible" || providerKind === "nvidia_nim";
  const needsGcp = providerKind === "vertex_ai";
  return <article className="panel settings-card full-settings"><PanelHeading kicker="CONTROL PLANE PROVIDER REGISTRY" title="Configure one candidate"/><p className="settings-help">Only scalar configuration is entered here. The credential itself stays in the .env credential file; use an opaque profile-qualified `secretRef`, never a key or auth-file path.</p><div className="provider-card-grid">{providerRegistry.map((entry) => <button type="button" className={providerKind === entry.kind ? "provider-card selected" : "provider-card"} key={entry.kind} onClick={() => setProviderKind(entry.kind)}><strong>{entry.displayName}</strong><span>{entry.kind} · {entry.healthProbe}</span><small>{entry.capabilities.join(" · ")} · no fallback</small></button>)}</div><div className="settings-form-grid"><label className="field-label">Provider<select value={providerKind} onChange={(event) => setProviderKind(event.target.value)}>{providerRegistry.map((entry) => <option key={entry.kind} value={entry.kind}>{entry.displayName}</option>)}</select></label><label className="field-label">Model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="provider/model-id"/></label>{needsBaseUrl && <label className="field-label">HTTPS base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://provider.example/v1"/></label>}{needsGcp && <><label className="field-label">Project ID<input value={projectId} onChange={(event) => setProjectId(event.target.value)}/></label><label className="field-label">Location<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="us-central1"/></label></>}<label className="field-label">Credential secretRef<input value={secretRef} onChange={(event) => setSecretRef(event.target.value)} placeholder="env:signalflow/profiles/profile-id/providers/workspace/provider" autoComplete="off"/></label></div><label className="check-row"><input type="checkbox" checked={operatorApproved} onChange={(event) => setOperatorApproved(event.target.checked)} /> I approve a non-publishing readiness probe for this provider/model.</label><div className="meta-settings-actions"><button className="primary-button" disabled={!model.trim() || !secretRef.trim()} onClick={submit}>Save candidate</button><button className="secondary-button" disabled={!model.trim() || !secretRef.trim() || !operatorApproved} onClick={() => void onProbe(providerKind, operatorApproved)}>Probe readiness</button><span className="meta-config-status">Probe records scalar health only and never publishes.</span></div>{notice && <div className="queue-notice"><span className="online-dot"/><span>{notice}</span></div>}</article>;
}

function BindingSettingsPanel({ targets = [], identities = [], bindings = [], onSave, onBeginConnection }: { targets?: Props["targetConnectionTargets"]; identities?: BrandIdentityRecord[]; bindings?: Props["channelBindingsForBinding"]; onSave?: Props["onSaveTargetBindings"]; onBeginConnection?: Props["onBeginConnection"] }) {
  const [selected, setSelected] = useState<string[]>(() => bindings?.map((binding) => binding.targetExternalId) ?? []);
  const [identityByTarget, setIdentityByTarget] = useState<Record<string, string>>(() => Object.fromEntries((bindings ?? []).map((binding) => [binding.targetExternalId, binding.identityId])));
  const activeIdentities = identities.filter((identity) => identity.status !== "archived");
  const canSelect = (target: { state: string }) => target.state === "connected";
  const recoveryCta = (state: string) => state === "not_configured" ? "Link" : state === "needs_reauth" ? "Reconnect" : "";
  const toggle = (target: { id: string; state: string }) => { if (!canSelect(target)) return; setSelected((current) => current.includes(target.id) ? current.filter((id) => id !== target.id) : [...current, target.id]); setIdentityByTarget((current) => ({ ...current, [target.id]: current[target.id] ?? activeIdentities.find((identity) => identity.isDefault)?.id ?? activeIdentities[0]?.id ?? "" })); };
  return <article className="panel settings-card full-settings binding-settings-panel"><PanelHeading kicker="TARGET BINDINGS" title="Settings control room"/><p className="settings-help">One real destination per binding. Assign a Brand Identity explicitly; unavailable targets remain visible but cannot be selected.</p>{(targets ?? []).map((target) => { const isSelected = selected.includes(target.id); const selectable = canSelect(target); const cta = recoveryCta(target.state); return <div className={`binding-settings-row ${isSelected ? "selected" : ""} ${selectable ? "" : "disabled"}`} key={`${target.platform}-${target.id}`}><label><input type="checkbox" checked={isSelected} disabled={!selectable} onChange={() => toggle(target)}/><span className={`binding-settings-platform ${target.platform}`} aria-hidden="true"><BetterPlatformIcon name={target.platform} /></span><span><strong>{target.name}</strong><small>{target.platform} · {selectable ? "Connected" : target.state}</small></span></label>{isSelected && activeIdentities.length > 0 && <select aria-label={`Identity for ${target.name}`} value={identityByTarget[target.id] ?? ""} onChange={(event) => setIdentityByTarget((current) => ({ ...current, [target.id]: event.target.value }))}>{activeIdentities.map((identity) => <option key={identity.id} value={identity.id}>{identity.name} v{identity.version}{identity.isDefault ? " · default" : ""}</option>)}</select>}{!selectable && cta && onBeginConnection && <button className="secondary-button binding-recovery-button" onClick={() => void onBeginConnection(target.platform)}>{cta}</button>}</div>; })}{(targets ?? []).length === 0 && <div className="empty-state">No discovered target. Use Meta setup to connect a destination.</div>}<div className="meta-settings-actions"><button className="primary-button" disabled={!onSave} onClick={() => onSave?.(selected, identityByTarget)}>Save bindings</button><span className="meta-config-status">{selected.length} selected · {selected.filter((id) => (targets ?? []).some((target) => target.id === id && canSelect(target))).length} ready</span></div></article>;
}

function AutomationAIRoutePanel({ automationAI, automationAIResolution, aiAccounts, onAutomationAIChange }: { automationAI: AutomationAIPreference; automationAIResolution: ResolvedAutomationAI; aiAccounts: AIAccountRegistry; onAutomationAIChange: (value: AutomationAIPreference) => void }) {
  const options = [
    { value: "gemini:web_subscription", label: "Gemini Pro · in-app subscription" },
    { value: "openai:web_subscription", label: "ChatGPT Plus · in-app subscription" },
    { value: "openai:official_api", label: "Official OpenAI API" },
    { value: "gemini:official_api", label: "Official Gemini API" },
    { value: "openai:manual_assisted", label: "ChatGPT · manual assist" },
    { value: "gemini:manual_assisted", label: "Gemini · manual assist" },
  ];
  const route: AutomationAIRoute = automationAI.mode === "web_subscription" ? "subscription" : "llm";
  const currentValue = `${automationAI.provider}:${automationAI.mode}`;
  const subscriptionOptions = options.filter((option) => automationAIOptionMatchesRoute(option.value, "subscription"));
  const llmOptions = options.filter((option) => automationAIOptionMatchesRoute(option.value, "llm"));
  const valueFor = (targetRoute: AutomationAIRoute) => automationAIOptionMatchesRoute(currentValue, targetRoute) ? currentValue : targetRoute === "subscription" ? "gemini:web_subscription" : "openai:official_api";
  const preferenceFor = (value: string, targetRoute: AutomationAIRoute): AutomationAIPreference => {
    const [provider, mode] = value.split(":") as [AutomationAIProviderSelection, AutomationAIPreference["mode"]];
    return automationAIPreferenceForRoute(targetRoute, { provider, mode });
  };
  const changeRoute = (targetRoute: AutomationAIRoute) => onAutomationAIChange(automationAIPreferenceForRoute(targetRoute, automationAI));
  const statusFor = (value: string, targetRoute: AutomationAIRoute) => {
    const resolution = value === currentValue ? automationAIResolution : resolveAutomationAI(preferenceFor(value, targetRoute), aiAccounts);
    const label = resolution.available ? resolution.provider === "gemini" ? "Gemini Pro" : resolution.provider === "openai" ? "ChatGPT / OpenAI" : "Blocked" : "Blocked";
    return <div className="automation-route-status" role="status"><span className={`status-pill ${resolution.available ? "published" : "failed"}`}>{label}</span><small>{resolution.reason}</small></div>;
  };
  const renderChoice = (targetRoute: AutomationAIRoute, label: string, description: string, routeOptions: typeof options) => {
    const selected = route === targetRoute;
    const value = valueFor(targetRoute);
    return <div className={`automation-route-choice ${selected ? "selected" : ""}`}><label className="automation-route-label"><input type="radio" name="automation-execution-route" checked={selected} onChange={() => changeRoute(targetRoute)} /><span><strong>{label}</strong><small>{description}</small></span></label>{selected && <div className="automation-route-selection"><label className="field-label">Selected provider/model<select value={value} onChange={(event) => onAutomationAIChange(preferenceFor(event.target.value, targetRoute))}>{routeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{statusFor(value, targetRoute)}</div>}</div>;
  };
  return <article className="panel settings-card full-settings automation-ai-panel" aria-labelledby="automation-ai-heading"><PanelHeading kicker="AUTOMATION AI" title="Daily run provider"/><p id="automation-ai-heading" className="settings-help">This setting is separate from the manual composer. It controls the idea and final-copy stages for due automation plans and stores only provider/mode metadata locally; credentials and browser session data never enter the snapshot.</p><fieldset className="route-selector automation-route-selector"><legend>Execution route (exclusive)</legend>{renderChoice("subscription", "Subscription package", "Managed browser · app open only", subscriptionOptions)}{renderChoice("llm", "LLM provider", "One configured API route", llmOptions)}<small>Inactive mode remains visible but cannot be selected automatically after an error.</small></fieldset><small id="automation-ai-help" className="muted-note">Subscription AI runs only while the SignalFlow-managed Chromium session is open and verified. Official API choices require a configured .env credential file key.</small></article>;
}

function SettingsView({ profileId, profileRevision = 0, liveReadiness, autoRunDueJobs, onAutoRunDueJobsChange, onExportDiagnostics, onExportMigrationBackup, workspace, memberships, entries, currentMembership, brands = [], brandTrashPreviews = {}, brandImpactLoading = {}, brandImpactErrors = {}, brandDeleteStates = {}, onLoadBrandTrashPreview, onTrashBrand, onRestoreBrand, onPermanentlyDeleteBrand, metaAppId, metaSecretConfigured, metaAccessTokenConfigured, metaAccountHints, metaSelectedPageId, metaSettingsNotice, metaDiscoveryBusy, metaTokenExchangeBusy, onSaveMetaConfiguration, onDiscoverMetaConfiguration, onExchangeMetaToken, onSelectMetaPage, aiAccounts, aiSettingsNotice, onSaveAIProviderKey, onOpenAIProviderAccount, onClearAIProvider, onUpdateAIModel, automationAI, automationAIResolution, onAutomationAIChange, creativeRuns, imageProvider, onImageProviderChange, videoProvider, onVideoProviderChange, onRetryCreativeRun, onSaveProviderConfiguration, onProbeProviderConfiguration, providerConfigurationNotice, targetConnectionTargets, connectionDisplayNames, brandIdentitiesForBinding, channelBindingsForBinding, onSaveTargetBindings, onBeginConnection, initialSection }: { profileId: string; profileRevision?: number; liveReadiness: "ready" | "blocked"; autoRunDueJobs: boolean; onAutoRunDueJobsChange: (value: boolean) => void; onExportDiagnostics: () => void; onExportMigrationBackup?: () => void; workspace: WorkspaceRecord; memberships: MembershipRecord[]; entries: AuditEntry[]; currentMembership?: MembershipRecord; brands?: BrandRecord[]; brandTrashPreviews?: Record<string, BrandTrashPreview>; brandImpactLoading?: Record<string, boolean>; brandImpactErrors?: Record<string, string | undefined>; brandDeleteStates?: Record<string, { status: "pending" | "reconciling" | "unknown"; requestId: string; message: string }>; onLoadBrandTrashPreview?: (brandId: string) => void | Promise<boolean>; onTrashBrand?: (brandId: string) => void; onRestoreBrand?: (brandId: string) => void | Promise<BrandDeleteOutcome>; onPermanentlyDeleteBrand?: (brandId: string, confirmation: string) => void | Promise<boolean | BrandDeleteOutcome>; metaAppId: string; metaSecretConfigured: boolean; metaAccessTokenConfigured: boolean; metaAccountHints: Array<{ id: string; name?: string; kind?: string }>; metaSelectedPageId: string; metaSettingsNotice: string; metaDiscoveryBusy: boolean; metaTokenExchangeBusy: boolean; onSaveMetaConfiguration: (input: { appId: string; appSecret: string; accessToken: string }) => void; onDiscoverMetaConfiguration: () => void; onExchangeMetaToken: () => void; onSelectMetaPage: (pageId: string) => void; aiAccounts: AIAccountRegistry; aiSettingsNotice: string; onSaveAIProviderKey: (input: { provider: AIProvider; apiKey: string; model: string }) => void; onOpenAIProviderAccount: (provider: AIProvider) => void; onClearAIProvider: (provider: AIProvider) => void; onUpdateAIModel: (provider: AIProvider, model: string) => void; automationAI: AutomationAIPreference; automationAIResolution: ResolvedAutomationAI; onAutomationAIChange: (value: AutomationAIPreference) => void; creativeRuns: CreativeRunRecord[]; imageProvider: ImageProvider; onImageProviderChange: (provider: ImageProvider) => void; videoProvider: VideoProvider; onVideoProviderChange: (provider: VideoProvider) => void; onRetryCreativeRun: (runId: string) => void; onSaveProviderConfiguration: Props["onSaveProviderConfiguration"]; onProbeProviderConfiguration: Props["onProbeProviderConfiguration"]; providerConfigurationNotice: string; targetConnectionTargets?: Props["targetConnectionTargets"]; connectionDisplayNames?: Props["connectionDisplayNames"]; brandIdentitiesForBinding?: BrandIdentityRecord[]; channelBindingsForBinding?: Props["channelBindingsForBinding"]; onSaveTargetBindings?: Props["onSaveTargetBindings"]; onBeginConnection?: Props["onBeginConnection"]; initialSection?: Props["settingsSection"] }) {
  const canManage = currentMembership ? canRole(currentMembership.role, "manage_workspace") : false;
  const autoRunEligible = liveReadiness === "ready";
  const [appId, setAppId] = useState(metaAppId);
  const [appSecret, setAppSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const appSecretInputRef = useRef<HTMLInputElement>(null);
  const accessTokenInputRef = useRef<HTMLInputElement>(null);
  const [aiKeyInputs, setAiKeyInputs] = useState<Record<AIProvider, string>>({ openai: "", gemini: "" });
  const [settingsSection, setSettingsSection] = useState<"safety" | "bindings" | "ai" | "meta" | "workspace">(initialSection ?? "safety");
  const [permanentDeleteBrandId, setPermanentDeleteBrandId] = useState<string>();
  const [permanentDeleteName, setPermanentDeleteName] = useState("");
  const [permanentDeleteFeedback, setPermanentDeleteFeedback] = useState("");
  const [permanentDeletePending, setPermanentDeletePending] = useState(false);
  const permanentDeleteDialogRef = useRef<HTMLElement>(null);
  const permanentDeleteOpenerRef = useRef<HTMLButtonElement>(null);
  const permanentDeleteFallbackRef = useRef<HTMLDivElement>(null);
  const permanentDeleteRequestRef = useRef(0);
  const permanentDeleteModalState = (): BrandDeleteModalState => ({ brandId: permanentDeleteBrandId, confirmation: permanentDeleteName, pending: permanentDeletePending, requestVersion: permanentDeleteRequestRef.current });
  const applyPermanentDeleteModalState = (state: BrandDeleteModalState) => {
    permanentDeleteRequestRef.current = state.requestVersion;
    setPermanentDeleteBrandId(state.brandId);
    setPermanentDeleteName(state.confirmation);
    setPermanentDeletePending(state.pending);
  };
  useEffect(() => { if (initialSection) setSettingsSection(initialSection); }, [initialSection]);
  const scopeKeyForBrand = (brand: Pick<BrandRecord, "id" | "clientId" | "workspaceId">) => brandDeleteScopeKey({ profileId, profileRevision, clientId: brand.clientId ?? brand.workspaceId, brandId: brand.id });
  const permanentDeleteBrand = brands.find((brand) => brand.id === permanentDeleteBrandId && (brand.clientId ?? brand.workspaceId) === workspace.id && Boolean(brand.deletedAt));
  const permanentDeleteScopeKey = permanentDeleteBrand ? scopeKeyForBrand(permanentDeleteBrand) : "";
  const permanentDeleteImpact = permanentDeleteBrand ? brandTrashPreviews[permanentDeleteScopeKey] : undefined;
  const permanentDeleteImpactIsAuthoritative = isAuthoritativeBrandImpact(permanentDeleteImpact);
  const canManageBrand = Boolean(currentMembership && canRole(currentMembership.role, "manage_brand"));
  const permanentDeleteLifecycle = permanentDeleteBrand ? brandDeleteStates[permanentDeleteScopeKey] : undefined;
  const permanentDeleteBusy = permanentDeletePending || permanentDeleteLifecycle?.status === "pending" || permanentDeleteLifecycle?.status === "reconciling";
  const permanentDeleteController = createBrandDeleteModalController({
    getState: permanentDeleteModalState,
    setState: applyPermanentDeleteModalState,
    requestVersionRef: permanentDeleteRequestRef,
    openerRef: permanentDeleteOpenerRef,
    fallbackRef: permanentDeleteFallbackRef,
    isBusy: () => permanentDeleteBusy,
    canConfirm: () => Boolean(permanentDeleteBrand && permanentDeleteImpactIsAuthoritative && canManageBrand && onPermanentlyDeleteBrand && permanentDeleteName === permanentDeleteBrand.name),
    getExpectedBrandName: () => permanentDeleteBrand?.name,
    onConfirm: async (brandId, confirmation) => {
      if (!onPermanentlyDeleteBrand) return undefined;
      const result = await onPermanentlyDeleteBrand(brandId, confirmation);
      return typeof result === "boolean" || result && typeof result === "object" ? result : undefined;
    },
    onFeedback: setPermanentDeleteFeedback,
  });
  const openPermanentDelete = (brandId: string, opener: HTMLButtonElement) => {
    const requestedScopeKey = scopeKeyForBrand({ id: brandId, workspaceId: workspace.id });
    const lifecycle = brandDeleteStates[requestedScopeKey];
    if (!permanentDeleteController.open(brandId, opener)) return;
    const requestVersion = permanentDeleteRequestRef.current;
    setPermanentDeleteFeedback(lifecycle?.status === "unknown" ? lifecycle.message : onLoadBrandTrashPreview ? "Đang tải impact từ Control Plane…" : "");
    setPermanentDeletePending(false);
    if (onLoadBrandTrashPreview) {
      void Promise.resolve(onLoadBrandTrashPreview(brandId)).then((ok) => {
        if (permanentDeleteRequestRef.current === requestVersion) setPermanentDeleteFeedback(ok ? lifecycle?.status === "unknown" ? lifecycle.message : "" : brandImpactErrors[requestedScopeKey] ?? "Không thể tải impact từ Control Plane; dữ liệu chưa đủ để xóa.");
      });
    }
  };
  useEffect(() => {
    if (permanentDeleteBrandId && !permanentDeleteBrand) {
      applyPermanentDeleteModalState({ brandId: undefined, confirmation: "", pending: false, requestVersion: permanentDeleteRequestRef.current + 1 });
      setPermanentDeleteFeedback("");
    }
  }, [workspace.id, permanentDeleteBrandId, permanentDeleteBrand?.id]);
  return <section className="expanded-view">
    <ViewHeader kicker="ĐIỀU KHIỂN WORKSPACE" title="Cài đặt" subtitle="Quản lý approval gate, live provider readiness, vai trò và diagnostics cục bộ." action="Xuất diagnostics" onAction={onExportDiagnostics}/>
    <div className="settings-tabs" role="group" aria-label="Nhóm cài đặt">
      {[{ id: "safety", label: "An toàn xuất bản" }, { id: "bindings", label: "Target bindings" }, { id: "ai", label: "AI & media" }, { id: "meta", label: "Meta" }, { id: "workspace", label: "Workspace & audit" }].map((item) => <button key={item.id} aria-pressed={settingsSection === item.id} className={settingsSection === item.id ? "selected" : ""} onClick={() => setSettingsSection(item.id as typeof settingsSection)}>{item.label}</button>)}
    </div>
    {settingsSection === "bindings" && <BindingSettingsPanel targets={targetConnectionTargets} identities={brandIdentitiesForBinding} bindings={channelBindingsForBinding} onSave={onSaveTargetBindings} onBeginConnection={onBeginConnection}/>}
    {settingsSection === "ai" && <>
    <CreativeRunsPanel workspaceId={workspace.id} connectionDisplayNames={connectionDisplayNames} creativeRuns={creativeRuns} imageProvider={imageProvider} onImageProviderChange={onImageProviderChange} videoProvider={videoProvider} onVideoProviderChange={onVideoProviderChange} onRetryCreativeRun={onRetryCreativeRun}/>
    <ProviderSetupPanel onSave={onSaveProviderConfiguration} onProbe={onProbeProviderConfiguration} notice={providerConfigurationNotice}/>
    <AutomationAIRoutePanel automationAI={automationAI} automationAIResolution={automationAIResolution} aiAccounts={aiAccounts} onAutomationAIChange={onAutomationAIChange} />
    <AccountBrowserSessions onOpenAIProviderAccount={onOpenAIProviderAccount} />
    </>}
    {settingsSection === "safety" && <>
    <DurableWorkerStatus workspaceId={workspace.id} />
    <div className="settings-grid">
      <article className="panel settings-card"><PanelHeading kicker="RUNTIME" title="Publishing safety"/><div className="rule-row"><div><strong>Require approval gate</strong><span>Jobs cannot enter execution without human approval</span></div><span className="toggle on" aria-hidden="true"><i/></span></div><div className="rule-row"><div><strong>Auto-run due jobs</strong><span>{autoRunEligible ? "Every 60 seconds; approved Facebook Page text jobs may publish when enabled." : "Disabled until Discover Page succeeds and a Page token is stored in the .env credential file."}</span></div><button className={`toggle ${autoRunDueJobs ? "on" : ""}`} disabled={!autoRunEligible} aria-label="Auto-run due jobs" aria-pressed={autoRunDueJobs} onClick={() => onAutoRunDueJobsChange(!autoRunDueJobs)}><i/></button></div><div className="rule-row"><div><strong>Persist drafts locally</strong><span>Content state is saved without storing provider secrets</span></div><span className="toggle on" aria-hidden="true"><i/></span></div></article>
      <article className="panel settings-card"><PanelHeading kicker="AI PROVIDERS" title="Provider health"/><p className="settings-help">Each run chooses one route and one model. The cards below show candidate readiness only; a candidate never becomes a fallback.</p>{(["openai", "gemini"] as AIProvider[]).map((provider) => { const account = aiAccounts[provider]; const isWebSubscription = account.mode === "web_subscription"; const label = isWebSubscription ? provider === "gemini" ? "Gemini Pro · Chromium in-app" : "ChatGPT Plus · Chromium in-app" : "OpenAI Responses API"; return <div className="provider-row" key={provider}><span className="provider-logo">{provider === "openai" ? <BetterProviderIcon name="openai" /> : <BetterProviderIcon name="googlegemini" />}</span><div><strong>{label}</strong><span>{isWebSubscription ? "Persistent app-owned Chromium session · sign in inside SignalFlow" : account.status === "configured" ? `Native .env credential file · ${account.model}` : account.status === "manual_assist" ? "Manual assist only · no background automation" : "No API key configured"}</span><select value={account.model} onChange={(event) => onUpdateAIModel(provider, event.target.value)}>{AI_MODEL_OPTIONS[provider].map((model) => <option key={model} value={model}>{model}</option>)}</select>{!isWebSubscription && <input className="provider-key-input" type="password" value={aiKeyInputs[provider]} onChange={(event) => setAiKeyInputs((current) => ({ ...current, [provider]: event.target.value }))} placeholder={account.status === "configured" ? "Enter new key to replace" : "API key saved to .env credential file"} autoComplete="off" />}</div><em>{isWebSubscription ? "Web subscription" : account.status === "configured" ? "Configured" : account.status === "manual_assist" ? "Manual assist" : "Not configured"}</em>{isWebSubscription ? <button className="text-button" onClick={() => onOpenAIProviderAccount(provider)}>Open {provider === "gemini" ? "Gemini" : "ChatGPT"} browser</button> : <button className="text-button" onClick={() => { onSaveAIProviderKey({ provider, apiKey: aiKeyInputs[provider], model: account.model }); setAiKeyInputs((current) => ({ ...current, [provider]: "" })); }}>Save API key</button>}<button className="text-button danger-text" onClick={() => onClearAIProvider(provider)}>Clear account</button></div>; })}{providerRegistry.filter((provider) => provider.kind !== "openai_official" && provider.kind !== "google_gemini_api").map((provider) => <div className="provider-row" key={provider.kind}><span className="provider-logo"><BetterContentIcon name="sparkles" /></span><div><strong>{provider.displayName}</strong><span>Candidate · configured only through Control Plane/.env credential file · probe: {provider.healthProbe}</span></div><em>{provider.kind === "opencode_go" ? "Policy confirmation required" : "Not configured"}</em></div>)}{aiSettingsNotice && <div className="queue-notice"><span className="online-dot"/><span>{aiSettingsNotice}</span></div>}</article>
    </div>
    </>}
    {settingsSection === "meta" && <article className="panel settings-card full-settings meta-settings-card">
      <PanelHeading kicker="META DEVELOPMENT" title="Facebook + Instagram configuration"/>
      <p className="settings-help">App Secret và bootstrap user token đi qua .env credential file boundary; không lưu vào snapshot, diagnostics hoặc renderer log. Dùng official OAuth để kết nối Meta; bootstrap token chỉ dùng cho lần Discover đầu tiên. Sau lần Discover, SignalFlow lưu Page token trong .env credential file và ghi nhớ Page/Instagram IDs, nên không cần Generate lại token mỗi lần mở app. Facebook Page text và Instagram image/Reel routes vẫn cần public media URL và được kiểm tra qua live readiness boundary. TikTok và YouTube vẫn cần manual/adapter riêng.</p>
      <div className="settings-form-grid">
        <label className="field-label">Meta App ID<input value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="1234567890123456"/></label>
        <label className="field-label">App Secret<input ref={appSecretInputRef} type="password" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} placeholder={metaSecretConfigured ? "Đã lưu trong .env credential file · nhập mới để thay thế" : "Nhập App Secret"}/></label>
        <label className="field-label full-field">Bootstrap user token (one-time discovery)<input ref={accessTokenInputRef} type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder={metaAccessTokenConfigured ? "Đã lưu trong .env credential file · nhập mới để thay thế" : "Official OAuth token hoặc Graph Explorer bootstrap token"}/></label>
      </div>
      <div className="meta-settings-actions">
        <button className="primary-button" onClick={() => { onSaveMetaConfiguration({ appId, appSecret: resolveMetaCredentialValue(appSecretInputRef.current?.value ?? "", appSecret), accessToken: resolveMetaCredentialValue(accessTokenInputRef.current?.value ?? "", accessToken) }); setAppSecret(""); setAccessToken(""); }}>Save to .env credential file</button>
        <button className="secondary-button" disabled={!metaAccessTokenConfigured || !metaSecretConfigured || metaTokenExchangeBusy} onClick={onExchangeMetaToken}>{metaTokenExchangeBusy ? "Exchanging…" : "Exchange long-lived token"}</button>
        <button className="secondary-button" disabled={!metaAccessTokenConfigured || metaDiscoveryBusy} onClick={onDiscoverMetaConfiguration}>{metaDiscoveryBusy ? "Discovering…" : "Discover Page + Instagram"}</button>
        <span className="meta-config-status">App ID {metaAppId ? "configured" : "missing"} · Secret {metaSecretConfigured ? "stored" : "missing"} · Token {metaAccessTokenConfigured ? "stored" : "missing"}</span>
      </div>
      {metaSettingsNotice && <div className="queue-notice"><span className="online-dot"/><span>{metaSettingsNotice}</span></div>}
      {metaAccountHints.some((account) => account.kind === "page") && !metaSelectedPageId && <div className="queue-notice"><span className="online-dot"/><span>Chọn một Facebook Page bên dưới trước khi live readiness được xác nhận.</span></div>}
      {metaAccountHints.length > 0 && <div className="meta-account-list">{metaAccountHints.map((account) => <label className="meta-account-row" key={account.id}>{account.kind === "page" && <input type="radio" name="meta-live-page" checked={metaSelectedPageId === account.id} onChange={() => onSelectMetaPage(account.id)} />}<strong>{account.name ?? (account.kind === "instagram_business" ? "Instagram Business" : "Facebook Page")}</strong><span>{account.kind ?? "page"}{account.kind === "page" && metaSelectedPageId === account.id ? " · selected for live" : ""}</span></label>)}</div>}
    </article>}
    {settingsSection === "workspace" && <>
      <MembershipPanel workspace={workspace} memberships={memberships}/>
      <AuditViewer entries={entries}/>
      <article className="panel settings-card full-settings">
        <PanelHeading kicker="BRANDS" title="Quản lý brand"/>
        <div ref={permanentDeleteFallbackRef} className="brand-trash-list" tabIndex={-1} aria-label="Danh sách brand">
          {brands.filter((brand) => brand.workspaceId === workspace.id).map((brand) => {
            const trashed = Boolean(brand.deletedAt);
            const impact = brandTrashPreviews[scopeKeyForBrand(brand)];
            const lifecycle = brandDeleteStates[scopeKeyForBrand(brand)];
            return <div className="brand-trash-row" key={brand.id}>
              <div>
                <strong>{brand.name}</strong>
                <span>{trashed ? "Đã xóa · có thể khôi phục" : brand.status}</span>
                {!impact || impact.countsKnown !== true
                  ? <small>Impact đang tải; chưa xác nhận count từ Control Plane</small>
                  : <small>{impact.draftCount} bản nháp · {impact.planCount} kế hoạch · {impact.unsentScheduleCount} lịch chưa gửi · {impact.sharedMediaCount} media dùng chung</small>}
                {lifecycle && <small role="status">{lifecycle.message}</small>}
              </div>
              {trashed ? <>
                <button type="button" className="secondary-button" disabled={lifecycle?.status === "pending" || lifecycle?.status === "reconciling" || lifecycle?.status === "unknown"} onClick={() => void onRestoreBrand?.(brand.id)}>Khôi phục</button>
                <button type="button" className="text-button danger-text" disabled={lifecycle?.status === "pending" || lifecycle?.status === "reconciling"} onClick={(event) => openPermanentDelete(brand.id, event.currentTarget)}>{lifecycle?.status === "unknown" ? "Đối soát kết quả" : lifecycle?.status === "pending" || lifecycle?.status === "reconciling" ? "Đang chờ…" : "Xóa vĩnh viễn"}</button>
              </> : <button type="button" className="text-button danger-text" onClick={() => void onTrashBrand?.(brand.id)}>Đưa vào Đã xóa</button>}
            </div>;
          })}
          {brands.filter((brand) => brand.workspaceId === workspace.id).length === 0 && <div className="empty-state">Chưa có brand. Bấm “Thêm brand” để bắt đầu.</div>}
        </div>
        <small className="muted-note">Xóa brand không xóa bài đã đăng trên Facebook hoặc file nguồn dùng chung. Mọi thao tác chỉ hoàn tất sau xác nhận bền vững từ Control Plane.</small>
      </article>
      <article className="panel settings-card full-settings">
        <PanelHeading kicker="WORKSPACE" title={workspace.name}/>
        <div className="workspace-settings">
          <span>Vai trò hiện tại</span><strong>{currentMembership?.role ?? "member"}</strong>
          <span>Lưu trữ</span><strong>Versioned local snapshot v3</strong>
          <span>Xuất bản live</span><strong className="warning-text">{liveReadiness === "ready" ? "Chỉ Facebook Page text sẵn sàng · Instagram/TikTok/YouTube vẫn deferred/manual" : "Facebook live đang bị chặn · cần Discover Page + token trong .env credential file"}</strong>
          <span>Quyền quản trị</span><strong>{canManage ? "Có thể quản trị workspace" : "Chỉ xem cài đặt workspace"}</strong>
        </div>
        <div className="meta-settings-actions"><button className="secondary-button" onClick={onExportMigrationBackup ?? onExportDiagnostics}>Export migration backup</button><span className="meta-config-status">Sanitized renderer recovery snapshot; worker SQLite backup is separate.</span></div>
      </article>
    </>}
    {permanentDeleteBrand && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="permanent-delete-brand-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !permanentDeleteBusy) permanentDeleteController.close(); }}>
      <section ref={permanentDeleteDialogRef} className="composer-modal brand-delete-modal" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => permanentDeleteController.keyDown(event, permanentDeleteDialogRef.current)}>
        <div className="modal-heading">
          <div><p className="panel-kicker">BRAND LIFECYCLE</p><h2 id="permanent-delete-brand-title">Xóa vĩnh viễn “{permanentDeleteBrand.name}”?</h2><span>Chỉ thực hiện sau khi Control Plane xác nhận bền vững.</span></div>
          <button type="button" className="close-button" aria-label="Đóng xác nhận xóa brand" disabled={permanentDeleteBusy} onClick={() => permanentDeleteController.close()}>×</button>
        </div>
        <div className="brand-delete-impact" aria-label="Tác động xóa brand">
          <strong>Dữ liệu SignalFlow sẽ bị xóa</strong>
          {brandImpactLoading[permanentDeleteScopeKey]
            ? <p role="status">Đang tải impact từ Control Plane…</p>
            : brandImpactErrors[permanentDeleteScopeKey]
              ? <p role="alert">{brandImpactErrors[permanentDeleteScopeKey]} · Hãy đóng và mở lại để thử lại.</p>
              : permanentDeleteImpact && permanentDeleteImpactIsAuthoritative
                ? <ul><li>{permanentDeleteImpact.draftCount} bản nháp</li><li>{permanentDeleteImpact.planCount} kế hoạch</li><li>{permanentDeleteImpact.unsentScheduleCount} lịch chưa gửi</li><li>{permanentDeleteImpact.sharedMediaCount} media dùng chung sẽ được giữ tham chiếu</li></ul>
                : <p role="status">Impact chưa được Control Plane xác nhận. Chưa thể xóa.</p>}
        </div>
        <p className="settings-help">Các bản ghi riêng tư thuộc brand, content run, kế hoạch và tham chiếu nội bộ sẽ bị loại bỏ sau ACK. Bài đã đăng trên Facebook, file Drive bên ngoài và media dùng chung vẫn được giữ.</p>
        {!canManageBrand && <div className="queue-notice" role="alert"><span className="online-dot"/> Cần quyền owner/admin có capability manage_brand.</div>}
        {(permanentDeleteFeedback || permanentDeleteLifecycle?.message) && <div className="queue-notice" role={permanentDeleteLifecycle?.status === "unknown" ? "status" : "alert"}><span className="online-dot"/> {permanentDeleteFeedback || permanentDeleteLifecycle?.message}</div>}
        <label className="field-label">Nhập chính xác tên brand để xác nhận<input autoFocus value={permanentDeleteName} disabled={permanentDeleteBusy} onChange={(event) => { permanentDeleteController.input(event.target.value); setPermanentDeleteFeedback(""); }} placeholder={permanentDeleteBrand.name}/></label>
        <div className="composer-foot"><button type="button" className="secondary-button" disabled={permanentDeleteBusy} onClick={() => permanentDeleteController.close()}>Hủy</button><button type="button" className="revo-danger" disabled={permanentDeleteBusy || !canManageBrand || !permanentDeleteImpactIsAuthoritative || permanentDeleteName !== permanentDeleteBrand.name || !onPermanentlyDeleteBrand} onClick={() => void permanentDeleteController.confirm()}>{permanentDeleteBusy ? permanentDeleteLifecycle?.status === "reconciling" ? "Đang đối soát…" : "Đang chờ Control Plane…" : "Xóa vĩnh viễn"}</button></div>
      </section>
    </div>}
  </section>;
}
export function WorkspaceViews(props: Props) {
  const activeUserId = props.activeUserId ?? (props.profileId === "profile-bavy" ? "user-bavy" : props.profileId);
  switch (props.activeNav) {
    case "Content studio": return <><RevoContentStudio drafts={props.drafts} clientName={props.activeWorkspace.name} brandName={props.activeBrand.name} initialFilter={props.contentStudioFilter} targetSummary={`${(props.workspaceState.channelBindings ?? []).filter((binding) => binding.brandId === props.activeBrand.id).length} binding(s) · ${props.liveReadiness === "ready" ? "provider route ready" : "live route blocked"}`} onOpenComposer={props.onOpenComposer} inlineGenerating={props.inlineContentGenerating} generationError={props.generationError} focusDraftId={props.focusDraftId} onOpenReview={props.onOpenReview} onRefresh={props.onRefreshContent} onUpdateDraft={props.onUpdateDraft ?? (() => undefined)} onQualityCheck={props.onQualityCheck} actionFeedbackByDraftId={props.draftActionFeedbackByDraftId} publishBlockersByDraftId={props.publishBlockersByDraftId} canApprove={Boolean(props.currentMembership && canRole(props.currentMembership.role, "approve_content"))} onActiveActionDraftChange={props.onActiveActionDraftChange} onGenerateMedia={props.onGenerateMedia ?? (() => undefined)} onApprove={props.onApprove} onReject={props.onReject} onCopy={props.onCopyDraft ?? props.onExportManualPackage} onExport={props.onExportManualPackage} onPublish={props.onPublishDraft ?? (async () => ({ status: "failure", message: "Publish handler is unavailable." }))} onTelegram={props.onTelegramDraft ?? (() => undefined)} onRegenerate={props.onRegenerateDraft ?? (() => undefined)} onRestoreRevision={props.onRestoreRevision} videoProvider={props.videoProvider} onVideoProviderChange={props.onVideoProviderChange} /><ContentIntelligenceForWorkspace props={props} /></>;
    case "Calendar": return <CalendarView queueJobs={props.queueJobs} dashboardCalendarDate={props.dashboardCalendarDate} connectionDisplayNames={props.connectionDisplayNames} onOpenComposer={props.onOpenComposer} onReschedule={props.onReschedule} onCancel={props.onCancel} liveReadiness={props.liveReadiness}/>;
    case "Automation Planner": return <AutomationPlannerView plans={props.automationPlans} profileId={props.profileId} plannerScopeGeneration={props.plannerScopeGeneration} plannerDrafts={props.automationPlannerDrafts} plannerSelections={props.automationPlannerSelections} onDraftChange={props.onPlannerDraftChange} onSelectionChange={props.onPlannerSelectionChange} onBeginSave={props.onBeginPlannerSave} workspace={props.activeWorkspace} activeBrand={props.activeBrand} brandVoice={props.brandVoice} assets={props.assets} bindings={props.workspaceState.channelBindings ?? []} onSave={props.onSaveAutomationPlan} onSelect={props.onSelect} metaAccountHints={props.metaAccountHints} targetConnectionTargets={props.targetConnectionTargets} onBeginConnection={props.onBeginConnection} onRunReviewOnlyAutomationPlan={props.onRunReviewOnlyAutomationPlan} plannerRunBusy={props.plannerRunBusy} automationAIResolution={props.automationAIResolution} strategyCatalog={props.strategyCatalog} strategyCatalogRevision={props.strategyCatalogRevision} strategyCatalogLoading={props.strategyCatalogLoading} strategyCatalogError={props.strategyCatalogError} scheduleTemplate={(() => { const template = props.workspaceState.scheduleTemplatesByBrand?.[strategyCatalogScopeKey(clientIdForBrand(props.activeBrand), props.activeBrand.id)]; return template ? { id: template.id, campaignId: `brand-default-${props.activeBrand.id}`, brandId: template.brandId, timezone: template.timezone, timesByWeekday: template.timesByWeekday, version: template.version, source: "brand_default" as const } : undefined; })()} contentRecipes={(props.contentRecipes ?? []).filter((recipe) => recipe.brandId === props.activeBrand.id)}/>;
    case "Review inbox": return <ReviewView drafts={props.drafts} reviewCount={props.reviewCount} onApprove={props.onApprove} onReject={props.onReject} onExportManualPackage={props.onExportManualPackage} onRegenerateDraft={props.onRegenerateDraft} onDeleteDraft={props.onDeleteDraft} onPublishDraft={props.onPublishDraft} onReschedule={props.onReschedule} onCancel={props.onCancel} onDraftTargetAction={props.onDraftTargetAction} currentMembership={props.currentMembership} connectionDisplayNames={props.connectionDisplayNames} draftActionFeedbackByDraftId={props.draftActionFeedbackByDraftId} publishBlockersByDraftId={props.publishBlockersByDraftId} onActiveActionDraftChange={props.onActiveActionDraftChange}/>;
    case "Media library": return <MediaView assets={props.assets} onAddAsset={props.onAddAsset} onImportLocalImage={props.onImportLocalImage} mediaImportBusy={props.mediaImportBusy} mediaImportNotice={props.mediaImportNotice} onVerifyAsset={props.onVerifyAsset} onSyncDriveInventory={props.onSyncDriveInventory} driveInventorySyncBusy={props.driveInventorySyncBusy} onAnalyzeDriveAsset={props.onAnalyzeDriveAsset} onAnalyzeLocalAsset={props.onAnalyzeLocalAsset} onUploadAssetToDrive={props.onUploadAssetToDrive} onMakeDrivePublic={props.onMakeDrivePublic} onArchiveAsset={props.onArchiveAsset} onRestoreAsset={props.onRestoreAsset}/>;
    case "Analytics": return <AnalyticsView onExportReport={props.onExportReport} auditEntries={props.auditEntries} activeWorkspace={props.activeWorkspace} activeBrand={props.activeBrand} analyticsEvents={props.analyticsEvents} targetPublications={props.targetPublications} analyticsDataAsOf={props.analyticsDataAsOf} analyticsWorkerReconciledAt={props.analyticsWorkerReconciledAt}/>;
    case "Brand system": return <BrandViewV2 activeBrand={props.activeBrand} activeUserId={activeUserId} activeWorkspace={props.activeWorkspace} brandVoice={props.brandVoice} brandVisualTokens={props.brandVisualTokens} savedNotice={props.savedNotice} onBrandVoiceChange={props.onBrandVoiceChange} onBrandVisualTokensChange={props.onBrandVisualTokensChange} onSaveBrand={props.onSaveBrand} workspaceState={props.workspaceState} onBrandIdentityChange={props.onBrandIdentityChange} strategyCatalog={props.strategyCatalog} strategyCatalogRevision={props.strategyCatalogRevision} strategyCatalogLoading={props.strategyCatalogLoading} strategyCatalogError={props.strategyCatalogError} contentRecipes={props.contentRecipes} currentMembership={props.currentMembership} onSaveStrategyCatalog={props.onSaveStrategyCatalog} onReloadStrategyCatalog={props.onReloadStrategyCatalog}/>;
    case "Settings": return <SettingsView profileId={props.profileId} profileRevision={props.profileRevision} automationAI={props.automationAI} automationAIResolution={props.automationAIResolution} onAutomationAIChange={props.onAutomationAIChange} creativeRuns={props.creativeRuns} imageProvider={props.imageProvider} onImageProviderChange={props.onImageProviderChange} videoProvider={props.videoProvider} onVideoProviderChange={props.onVideoProviderChange} onRetryCreativeRun={props.onRetryCreativeRun} liveReadiness={props.liveReadiness} autoRunDueJobs={props.autoRunDueJobs} onAutoRunDueJobsChange={props.onAutoRunDueJobsChange} onExportDiagnostics={props.onExportDiagnostics} onExportMigrationBackup={props.onExportMigrationBackup} workspace={props.activeWorkspace} memberships={props.workspaceState.memberships} brands={props.workspaceState.brands} brandTrashPreviews={props.brandTrashPreviews} brandImpactLoading={props.brandImpactLoading} brandImpactErrors={props.brandImpactErrors} brandDeleteStates={props.brandDeleteStates} onLoadBrandTrashPreview={props.onLoadBrandTrashPreview} onTrashBrand={props.onTrashBrand} onRestoreBrand={props.onRestoreBrand} onPermanentlyDeleteBrand={props.onPermanentlyDeleteBrand} entries={props.auditEntries} currentMembership={props.currentMembership} metaAppId={props.metaAppId} metaSecretConfigured={props.metaSecretConfigured} metaAccessTokenConfigured={props.metaAccessTokenConfigured} metaAccountHints={props.metaAccountHints} metaSelectedPageId={props.metaSelectedPageId} metaSettingsNotice={props.metaSettingsNotice} metaDiscoveryBusy={props.metaDiscoveryBusy} metaTokenExchangeBusy={props.metaTokenExchangeBusy} onSaveMetaConfiguration={props.onSaveMetaConfiguration} onDiscoverMetaConfiguration={props.onDiscoverMetaConfiguration} onExchangeMetaToken={props.onExchangeMetaToken} onSelectMetaPage={props.onSelectMetaPage} aiAccounts={props.aiAccounts} aiSettingsNotice={props.aiSettingsNotice} onSaveAIProviderKey={props.onSaveAIProviderKey} onOpenAIProviderAccount={props.onOpenAIProviderAccount} onClearAIProvider={props.onClearAIProvider} onUpdateAIModel={props.onUpdateAIModel} onSaveProviderConfiguration={props.onSaveProviderConfiguration} onProbeProviderConfiguration={props.onProbeProviderConfiguration} providerConfigurationNotice={props.providerConfigurationNotice} targetConnectionTargets={props.targetConnectionTargets} connectionDisplayNames={props.connectionDisplayNames} brandIdentitiesForBinding={props.brandIdentitiesForBinding} channelBindingsForBinding={props.channelBindingsForBinding} onSaveTargetBindings={props.onSaveTargetBindings} onBeginConnection={props.onBeginConnection} initialSection={props.settingsSection} />;
    default: return null;
  }
}
