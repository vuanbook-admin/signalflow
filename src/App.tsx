import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { persistAutomationCheckpoint, persistSnapshot, preparePersistedSnapshot, restoreSnapshot, sanitizeSnapshotForExport } from "./lib/persistence";
import { buildRewritePrompt, extractGeneratedContentFields, ManualAssistAIGateway, MockAIGateway, type AIGateway } from "./lib/gateway";
import { compileStrategyPrompt, validateGeneratedStrategyOutput, type AssetPromptFormat } from "./lib/contentStrategyPrompt";
import { strategyCatalogFingerprint, validateStrategyCatalog, type BrandStrategyCatalog } from "./lib/contentStrategy";
import { GeminiWebAIGateway } from "./lib/geminiWebGateway";
import { ChatGPTWebAIGateway } from "./lib/chatgptWebGateway";
import { OfficialAIGateway } from "./lib/officialGateway";
import { createManualPublishPackage, type BrandSystem, type ContentKind, type ContentVariant, type GenerationProfile, type MediaAttachment, type PublishJob, type SocialConnection, type SocialPlatform } from "./lib/mvpContracts";
import { isNonPublicMediaHost, localMediaPreviewUrl, localMediaThumbnailUrl, normalizeGoogleDriveMediaUrl, sanitizeLegacyMediaAsset } from "./lib/mediaAssets";
import { channelBindingStateForConnection, startOfficialOAuth } from "./lib/connectionRegistry";
import { createBindingsForTargets, presentConnectionState, type ConnectionTarget } from "./lib/channelBinding";
import { hydrateLegacyAgencyRecords, resolveActiveBrandIdentity, validateBrandIdentity, type BrandIdentityRecord } from "./lib/brandIdentity";
import { buildGenerationContext } from "./lib/promptContext";
import { acknowledgeContentIntelligenceIntakeSave, acknowledgeResearchEvidenceApproval, beginContentIntelligenceIntakeSave, canReviewResearchEvidence, captureContentIntelligenceLineage, contentIntelligenceIntakeDraftKey, contentIntelligenceIntakeDraftsForScope, contentIntelligenceIntakeDraftsWithFeedback, contentIntelligenceLineageFields, emptyContentIntelligenceIntakeDraft, finishContentIntelligenceIntakeSave, reviseContentIntelligenceIntakeDraft, validateContentIntelligenceSelection, buildContentIntelligenceContext, type ContentIntelligenceIntakeDraft, type ContentIntelligenceIntakeDraftMap, type ContentIntelligenceIntakeDraftPatch, type ContentIntelligenceIntakeKind, type ContentIntelligenceIntakeScope, type ContentIntelligenceIntakeSaveToken, type ContentIntelligenceLineage, type KnowledgeItem, type PromptBlueprint, type ResearchEvidence } from "./lib/contentIntelligence";
import { validateContentTransform, type ContentTransformMode } from "./lib/contentTransform";
import { validateContentRecipeForStrategy, type ContentRecipe } from "./lib/contentRecipe";
import { validateProviderConfiguration } from "./lib/providerRegistry";
import { exchangeOAuthCallbackIfCurrent, parseOAuthCallback, registerOAuthFlow } from "./lib/oauthCallback";
import { invoke, openUrl, hasNativeRuntime, isElectronRuntime, onMetaOAuthResult, onOAuthUrls, profileRuntimeIdentity } from "./lib/nativeRuntime";
import { createTargetPublicationIdempotencyKey, LocalPublishQueue } from "./lib/publishQueue";
import { ControlPlaneError, brandImpactPreviewMatchesBrand, createControlPlaneClient, normalizeBrandImpactPreview, type BrandLifecycleActor } from "./lib/controlPlane";
import { canAutoRunDueJobs, chooseMetaPageId, discoverMetaAccounts, exchangeMetaOAuthCode, exchangeMetaToken, getMetaLiveReadiness, META_OAUTH_REDIRECT_URI, persistMetaAccountHints, persistMetaSelectedPageId, readMetaAccountHints, readMetaAppId, readMetaSelectedPageId, readMetaSettingsStatus, saveMetaSettings, type MetaAccountHint } from "./lib/metaSettings";
import { WorkspaceViews, type StrategyCatalogSaveResult } from "./ExpandedViews";
import { AI_MODEL_OPTIONS, clearAIProvider, defaultAIAccounts, markAIWebSubscription, readAIAccountRegistry, readAIProviderKey, saveAIProviderKey, updateAIProviderModel, type AIAccountRegistry, type AIProvider } from "./lib/aiAccounts";
import { activeBrand, activeMembership, activeWorkspace, canRole, clientIdForBrand, createBrandDraft, createClient, defaultContentTemplates, defaultWorkspaceState, ensureBrandScheduleTemplate, ensureBrandStrategyCatalog, ensureBrandVisualTokensByBrand, getBrandVisualTokens, sanitizeBrandVisualTokens, strategyCatalogScopeKey, switchBrand, switchWorkspace, type BrandRecord, type BrandVisualTokens, type ContentTemplate, type WorkspaceState } from "./lib/workspaceDomain";
import { acknowledgeAutomationPlannerDraft, AUTOMATION_PLATFORMS, AUTOMATION_RUN_DAYS, automationPlanMatchesBrandScope, beginAutomationPlannerSave, buildResolvedAutomationSlots, canonicalizeAutomationPlanScope, DEFAULT_AUTOMATION_AI_PREFERENCE, automationDraftKey, automationPlanDueKey, automationRunDayInTimezone, buildAutomationCopyPrompt, automationDraftKeyExists, countProviderConfirmedPublications, deriveAutomationTopic, expandAutomationPlatformPlan, finishAutomationPlannerSave, getAutomationPlatformPlanForPage, getBrandKitStatus, getDueAutomationPlans, hasProviderConfirmedPublicationState, isAutomationPlanWithinCampaignWindow, isUnusableProviderEcho, markAutomationPlanAttempted, REVIEW_ONLY_DRAFT_STATUS, runSingleFlight, resolveAutomationAI, resolveAutomationTargetJobIds, resolveAutomationTargetPageIdsFromBindings, sanitizeAutomationIdea, selectAutomationMediaForPost, selectAutomationPlansForRun, selectNextAvailablePlanSlot, targetPublicationBindingsAcknowledged, upsertAutomationPlan, validateAutomationPlan, validateAutomationPlanSchedule, type AutomationAIPreference, type AutomationPlan, type AutomationPlanRunScope, type AutomationPlannerDraftScope, type AutomationPlannerDraftState, type AutomationPlannerSaveResult, type AutomationPlannerSaveToken } from "./lib/automationPlanner";
import { buildDurableWorkerMediaPayload, createDurableWorkerClient } from "./lib/workerClient";
import { applyDecodedImageAnalysis, applyMediaReservationToRecord, archiveMediaAsset, restoreMediaAsset, buildAssetOperationPersistencePatch, buildMediaReplacementPersistencePatch, classifyDriveInventory, createAssetOperationDeadline, createCreativeRun, createGeneratedMediaRecord, findDuplicateMedia, fingerprintMediaReplacement, hydrateReservationLedger, isMediaEligible, MediaReservationLedger, mergeDriveInventory, nextCreativeAssetOperationVersion, normalizeDriveInventoryRecord, promoteVerifiedDecodedImage, reconcileContentRunMediaReplacement, retryCreativeRun as resetCreativeRunForRetry, runAssetOperation, safeCreativeRunError, transitionCreativeRun, validateContentRunMediaReplacementSnapshot, withAssetOperationDeadline, withAssetOperationTerminalGrace, type AutomationPersistenceState, type CreativeAssetOperation, type ImageProvider, type VideoProvider, type MediaInventoryRecord } from "./lib/automationDomain";
import { draftToContentVariant, restoreContentRunLineage, restoreContentRunMediaEvidence } from "./lib/draftConversion";
import { GoogleFlowImageProvider, GoogleFlowVideoProvider, VertexAIImageProvider, assetPromptForDraft, buildMediaAwareCopyRequest, buildVideoAwareCopyRequest, getManagedCopyCapability, type AssetGenerationRequest } from "./lib/creativeProviders";
import { driveDownloadResultSchema, driveLocalAnalysisResultSchema, driveUploadResultSchema, type DriveDownloadResult, type DriveLocalAnalysisResult, type DriveUploadResult } from "./lib/driveMediaContracts";
import { buildSafePlannerDiagnostics } from "./lib/safePlannerDiagnostics";
import { closeTargetActionPromptOutcome, draftPublishBlocker, hydrateRestoredMediaCardDistribution, publishCommandOutcome, resolveDraftTargetTime, resolveTargetDisplayName, shouldOpenRowFromKey, targetActionModalFocusTarget, targetActionSelectionOutcome } from "./lib/uiPresentation";
import { localDateKey, nextScheduledAtForRunDays } from "./lib/automationScheduler";
import type { AnalyticsEvent } from "./lib/analyticsDomain";
import type { TrendSignal } from "./lib/trendSignals";
import { beginDraftAction, checkPublishReadiness, contentRevisionFingerprint, contentRewriteBlocker, contentRunQualityExpectedRevisionFields, contentRunRevisionFieldsFromDraft, createContentRun, draftActionLockKey, draftActionScopeKey, endDraftAction, exportContentText, hasActiveContentRunPublication, hasDraftActionInFlight, initialContentRunRevisionId, markNeedsRegeneration, normalizeEditableFields, persistQualityChecks, reconcilePendingGeneration, runContentRewriteSingleFlight, submitContentRunQualityCheck, updateContentRunGeneration, validateRewriteRecipeForStrategy, type ContentOperation, type ContentRun, type ContentRunMediaEvidence, type DraftActionScope, type DraftActionToken, type QualityCheck } from "./lib/contentRun";
import { MediaOwnershipReconciliationError, createContentRunWithMediaOwnership, ensureContentRunMediaOwnership, prepareContentRunMedia, processedEvidenceForVariant, type ContentRunMediaOwnershipAsset, type ContentRunMediaOwnershipInput } from "./lib/contentRunMedia";
import { dispatchContentIntelligenceRun } from "./lib/contentIntelligenceDispatch";
import { encodeLocalImageFile, parseLocalImageImport, safeLocalImageFileName, validateLocalImageFile } from "./lib/mediaImport";
import { RevoNewContentModal, type DraftActionFeedback, type DraftActionKind, type DraftActionOutcome, type RevoComposerCloseEvent, type RevoComposerFocusTarget, type RevoContentFilter, type RevoDraftPatch, type RevoNewContentInput } from "./RevoContentStudio";
import { BetterContentIcon, BetterPlatformIcon, type BetterContentIconName, type BetterPlatformIconName } from "./lib/betterIcons";
import { contentActionItems, contentActionLabel, type ContentAction } from "./lib/contentActions";
import { activeUserProfileId, activateUserProfile, createEmptyProfile, listUserProfiles, saveUserProfile, setActiveUserProfile, type UserProfile } from "./lib/profileDomain";
import { profileSecretRef } from "./lib/secretStore";
import { isValidProviderSecretRef } from "./lib/providerCredentials";
import { brandDeleteRecordMatchesScope, brandDeleteScopeKey, buildBrandTrashPreview, isAuthoritativeBrandImpact, permanentlyDeleteBrand, reconcileBrandDeleteOperations, removeBrandRecordsForScope, runBrandDeleteLifecycle, runBrandRestoreLifecycle, trashBrand, type BrandDeleteOutcome, type BrandDeleteRequestToken, type BrandDeleteScope, type BrandLifecycleRequestToken, type BrandTrashPreview } from "./lib/brandTrash";
import { appendContentRevision, buildRestoredRevision, runRevisionGeneration } from "./lib/contentRevision";
import { generationIdempotencyKey, isDeterministicGenerationFailure, prepareStrategyGeneration, prepareStrategyGenerationForChannels, runStrategyGenerationWithRetry } from "./lib/generationRoute";
import type { StrategySnapshot } from "./lib/contentStrategy";
import type { ResolvedStrategy } from "./lib/contentStrategyResolver";

type Platform = "Facebook" | "Instagram" | "TikTok" | "YouTube";
type DraftStatus = "Needs review" | "Scheduled" | "Published" | "Failed";

const controlPlaneClient = createControlPlaneClient();

export type StrategyCatalogScope = { clientId: string; brandId: string; scopeKey: string };

export function strategyCatalogScopeForBrand(brand: Pick<BrandRecord, "id" | "clientId" | "workspaceId">): StrategyCatalogScope {
  const clientId = clientIdForBrand(brand);
  return { clientId, brandId: brand.id, scopeKey: strategyCatalogScopeKey(clientId, brand.id) };
}

export function sanitizeRecoveredBrandIdentity(identity: BrandIdentityRecord): BrandIdentityRecord {
  const { strategyCatalog: _strategyCatalog, strategyCatalogRevision: _strategyCatalogRevision, ...canonicalIdentity } = identity as BrandIdentityRecord & { strategyCatalog?: unknown; strategyCatalogRevision?: unknown };
  return canonicalIdentity;
}

export function strategyCatalogScopeMatchesState(state: Pick<WorkspaceState, "activeBrandId" | "brands">, scope: StrategyCatalogScope): boolean {
  const activeBrand = state.brands.find((brand) => brand.id === state.activeBrandId);
  if (!activeBrand || activeBrand.id !== scope.brandId) return false;
  return scope.scopeKey === strategyCatalogScopeKey(scope.clientId, scope.brandId) && clientIdForBrand(activeBrand) === scope.clientId;
}

export function strategyCatalogResponseMatchesScope(response: Record<string, unknown>, scope: StrategyCatalogScope): boolean {
  return (response.clientId === undefined || response.clientId === scope.clientId)
    && (response.client_id === undefined || response.client_id === scope.clientId)
    && (response.brandId === undefined || response.brandId === scope.brandId)
    && (response.brand_id === undefined || response.brand_id === scope.brandId)
    && (response.clientId ?? response.client_id) === scope.clientId
    && (response.brandId ?? response.brand_id) === scope.brandId
    && response.scopeKey === scope.scopeKey;
}

export function strategyCatalogResponseMatchesSaveAck(response: Record<string, unknown>, scope: StrategyCatalogScope, catalog: BrandStrategyCatalog, capturedRevision: number): boolean {
  if (response.acknowledged !== true || !Number.isSafeInteger(capturedRevision) || capturedRevision < 0 || !strategyCatalogResponseMatchesScope(response, scope)) return false;
  const readAliasedSafeInteger = (aliases: readonly string[]): number | undefined => {
    let value: number | undefined;
    let present = false;
    for (const alias of aliases) {
      if (!Object.prototype.hasOwnProperty.call(response, alias)) continue;
      present = true;
      const candidate = response[alias];
      if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 0 || (value !== undefined && value !== candidate)) return undefined;
      value = candidate;
    }
    return present ? value : undefined;
  };
  const revision = readAliasedSafeInteger(["strategyCatalogRevision", "revision"]);
  const version = readAliasedSafeInteger(["version"]);
  const savedCatalog = response.strategyCatalog;
  if (revision === undefined || version === undefined || !savedCatalog || typeof savedCatalog !== "object" || Array.isArray(savedCatalog)) return false;
  const expectedCatalog = { ...catalog, version: catalog.version + 1 };
  const savedCatalogRecord = savedCatalog as Record<string, unknown>;
  if (!Number.isSafeInteger(expectedCatalog.version) || savedCatalogRecord.brandId !== scope.brandId) return false;
  let savedValidation: ReturnType<typeof validateStrategyCatalog>;
  try { savedValidation = validateStrategyCatalog(savedCatalog as BrandStrategyCatalog); } catch { return false; }
  if (!savedValidation.ok) return false;
  const fingerprint = response.fingerprint;
  return revision === capturedRevision + 1
    && version === expectedCatalog.version
    && typeof fingerprint === "string"
    && fingerprint === strategyCatalogFingerprint(expectedCatalog)
    && fingerprint === strategyCatalogFingerprint(savedCatalog as BrandStrategyCatalog);
}

type AgencyRecoveryPayload = { clients?: unknown; brands?: unknown; identities?: unknown };
type BrandCreateRecoveryExpectation = { brandId: string; clientId: string; brandName: string };
type ClientCreateRecoveryExpectation = BrandCreateRecoveryExpectation & { clientName: string; timezone: string };
export type AgencyMigrationFlight = { scopeKey: string; promise?: Promise<void> };

export function runAgencyMigrationSingleFlight(flight: AgencyMigrationFlight, scopeKey: string, task: () => Promise<unknown>): Promise<void> {
  if (flight.scopeKey !== scopeKey) {
    flight.scopeKey = scopeKey;
    flight.promise = undefined;
  }
  if (flight.promise) return flight.promise;
  const taskPromise = Promise.resolve().then(task).then(() => undefined);
  let tracked: Promise<void>;
  tracked = taskPromise.finally(() => {
    if (flight.promise === tracked) flight.promise = undefined;
  });
  flight.promise = tracked;
  return tracked;
}

export function awaitAgencyMigration(flight: AgencyMigrationFlight, scopeKey: string, committed: boolean): Promise<void> {
  if (committed) return Promise.resolve();
  if (flight.scopeKey !== scopeKey || !flight.promise) return Promise.reject(new Error("CONTROL_PLANE_MIGRATION_NOT_READY"));
  return flight.promise;
}

function recoveryRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}

function recoveryAliasMatches(row: Record<string, unknown>, camelKey: string, snakeKey: string, expected: string): boolean {
  const camelValue = row[camelKey];
  const snakeValue = row[snakeKey];
  return (camelValue === undefined || camelValue === expected)
    && (snakeValue === undefined || snakeValue === expected)
    && (camelValue ?? snakeValue) === expected;
}

export function brandCreateConflictMatchesRecovery(recovery: AgencyRecoveryPayload, expected: BrandCreateRecoveryExpectation): boolean {
  const brand = recoveryRows(recovery?.brands).find((row) => row.id === expected.brandId
    && row.name === expected.brandName
    && recoveryAliasMatches(row, "clientId", "client_id", expected.clientId));
  if (!brand) return false;
  return recoveryRows(recovery?.identities).some((identity) => {
    const defaults = [identity.isDefault, identity.is_default].filter((value) => value !== undefined);
    return recoveryAliasMatches(identity, "brandId", "brand_id", expected.brandId)
      && defaults.length > 0
      && defaults.every((value) => value === true || value === 1)
      && (identity.clientId === undefined && identity.client_id === undefined
        || recoveryAliasMatches(identity, "clientId", "client_id", expected.clientId));
  });
}

export function clientCreateConflictMatchesRecovery(recovery: AgencyRecoveryPayload, expected: ClientCreateRecoveryExpectation): boolean {
  const client = recoveryRows(recovery?.clients).find((row) => row.id === expected.clientId
    && row.name === expected.clientName
    && row.timezone === expected.timezone
    && row.status === "active");
  return Boolean(client && brandCreateConflictMatchesRecovery(recovery, expected));
}

export async function reconcileAgencyCreateConflict(
  client: { agencyRecovery: () => Promise<AgencyRecoveryPayload> },
  error: unknown,
  conflictCodes: ReadonlySet<string>,
  matches: (recovery: AgencyRecoveryPayload) => boolean,
): Promise<boolean> {
  if (!(error instanceof ControlPlaneError) || !conflictCodes.has(error.code)) return false;
  try {
    return matches(await client.agencyRecovery());
  } catch {
    return false;
  }
}

const CLIENT_CREATE_CONFLICT_CODES = new Set(["CLIENT_CONFLICT"]);
const BRAND_CREATE_CONFLICT_CODES = new Set(["BRAND_CONFLICT", "BRAND_ID_SCOPE_CONFLICT"]);
const IDENTITY_CREATE_CONFLICT_CODES = new Set(["IDENTITY_CONFLICT", "IDENTITY_DEFAULT_CONFLICT"]);

function contentOperationFromAsset(operation: CreativeAssetOperation): ContentOperation {
  const { kind, ...rest } = operation;
  return { ...rest, type: kind };
}

export function assertContentRunAssetAck(ack: unknown, runId: string, operation: CreativeAssetOperation): void {
  if (!ack || typeof ack !== "object" || Array.isArray(ack)) throw new Error("CONTENT_RUN_ASSET_ACK_MISSING");
  const row = ack as Record<string, unknown>;
  if (row.id !== runId) throw new Error("CONTENT_RUN_ASSET_ACK_INVALID");
  if (row.state !== "content_generated" && row.state !== "needs_review") throw new Error("CONTENT_RUN_ASSET_ACK_STATE_MISMATCH");
  const persisted = row.mediaOperations ?? row.media_operations ?? row.visualOperations ?? row.visual_operations;
  if (!Array.isArray(persisted) || persisted.length === 0) throw new Error("CONTENT_RUN_ASSET_ACK_OPERATIONS_MISSING");
  const matchingOperation = persisted.find((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const value = candidate as Record<string, unknown>;
    return value.type === operation.kind
      && value.status === operation.status
      && (operation.slotId === undefined || value.slotId === operation.slotId)
      && (operation.strategyVersion === undefined || value.strategyVersion === operation.strategyVersion)
      && (operation.idempotencyKey === undefined || value.idempotencyKey === operation.idempotencyKey);
  });
  if (!matchingOperation) throw new Error("CONTENT_RUN_ASSET_ACK_OPERATION_MISMATCH");
}

export function assertContentRunMediaReplacementAck(
  ack: unknown,
  runId: string,
  operation: CreativeAssetOperation,
  submittedRevision: number,
  replacement: { mediaAssetIds: readonly string[]; mediaSetFingerprint: string; mediaEvidence: readonly ContentRunMediaEvidence[] },
): number {
  assertContentRunAssetAck(ack, runId, operation);
  return validateContentRunMediaReplacementSnapshot(ack, runId, operation, submittedRevision, replacement);
}

const oauthClientIds: Partial<Record<SocialPlatform, string>> = {
  facebook: import.meta.env.VITE_META_APP_ID,
  instagram: import.meta.env.VITE_META_APP_ID,
  tiktok: import.meta.env.VITE_TIKTOK_CLIENT_KEY,
  youtube: import.meta.env.VITE_GOOGLE_CLIENT_ID,
};

type Draft = {
  id: number;
  title: string;
  topic?: string;
  platform: Platform;
  status: DraftStatus;
  time: string;
  tag: string;
  tone: string;
  color: string;
  body?: string;
  contentPillar?: string;
  contentAngle?: string;
  objective?: "Reach" | "Engagement" | "Education" | "Knowledge" | "Conversion";
  strategyVersion?: number;
  catalogFingerprint?: string;
  strategySnapshot?: StrategySnapshot;
  regenerationState?: "clean" | "needs_regeneration";
  strategyState?: "clean" | "needs_regeneration";
  cta?: string;
  hashtags?: string[];
  seoKeywords?: string[];
  sources?: string[];
  notes?: string;
  contentKind?: ContentKind;
  mediaAssetIds?: string[];
  mediaUrl?: string;
  mediaPreviewUrl?: string;
  mediaThumbnailUrl?: string;
  mediaKind?: "image" | "video";
  mediaOperation?: CreativeAssetOperation;
  mediaOperations?: CreativeAssetOperation[];
  qualityStatus?: "pending" | "passed" | "failed";
  generationStatus?: "pending" | "completed" | "failed" | "unknown";
  qualityChecks?: Array<{ key: string; label: string; ok: boolean; message?: string }>;
  approvalState?: "proposed" | "ready" | "scheduled" | "publishing" | "published" | "failed";
  telegramState?: "not_sent" | "prepared" | "sent" | "blocked";
  telegramPreparedAt?: string;
  strategyRationale?: string;
  imageConcept?: string;
  imagePrompt?: string;
  videoConcept?: string;
  videoPrompt?: string;
  visualConcept?: string;
  visualPrompt?: string;
  researchState?: "VERIFIED" | "REVIEW" | "NOT_SELECTED";
  researchSourceCount?: number;
  researchScore?: number;
  automationKey?: string;
  planId?: string;
  targetPageId?: string;
  brandId?: string;
  imageProvider?: string;
  videoProvider?: string;
  mediaSha256?: string;
  mediaSetFingerprint?: string;
  mediaRevision?: number;
  visualFingerprint?: string;
  mediaProvenance?: Record<string, unknown>;
  mediaEvidence?: Array<{ assetId: string; sha256?: string; mimeType?: string; order: number; role: "publish" | "reference"; uploadState: "pending" | "processed" | "failed"; attachmentBoundary?: string }>;
  idea?: string;
  ideaProvider?: string;
  scheduledAt?: string;
  contentRunId?: string;
  identityVersionId?: string;
  generationProfileId?: string;
  executionMode?: "subscription_package" | "llm_provider";
  providerTraceId?: string;
  generationIdempotencyKey?: string;
  bindingIds?: string[];
  queueJobId?: string;
  queueJobIds?: string[];
  pendingPublicationIds?: string[];
  pendingApprovalCompensation?: boolean;
  deletedAt?: string;
  selectedKnowledgeItemIds?: string[];
  selectedResearchEvidenceIds?: string[];
  promptBlueprintId?: string;
  promptBlueprintVersion?: number;
  transformMode?: ContentTransformMode;
  sourceRef?: string;
  recipeId?: string;
  customerFacts?: string[];
  prompt?: string;
  contentIntelligenceLineage?: ContentIntelligenceLineage;
  rewriteStatus?: "idle" | "generating" | "failed" | "unknown" | "ready_for_review";
  rewriteError?: string;
  requestId?: string;
  revisionId?: string;
  parentRevisionId?: string;
  revisionHistory?: Array<{ id: string; title: string; body: string; createdAt: string; providerTraceId?: string; requestId?: string; parentRevisionId?: string; revisionId?: string }>;
};
type MediaCard = { id: string | number; clientId?: string; brandId?: string; name: string; kind: "Image" | "Video" | "Audio" | "Unknown"; status: "Local" | "Ready" | "Used" | "Failed" | "Needs public URL" | "Needs review"; size: string; usage: string; color: string; publicUrl?: string; localAssetPath?: string; mimeType?: string; modifiedAt?: string; checksum?: string; visualFingerprint?: string; visualFingerprintSource?: MediaInventoryRecord["visualFingerprintSource"]; registrationMode?: "seed" | "public_url" | "google_drive" | "generated"; providerFileId?: string; reviewStatus?: "needs_review" | "verified" | "rejected"; duplicateStatus?: "unknown" | "unique" | "duplicate"; duplicateKind?: "exact" | "near"; duplicateReason?: string; usedReason?: string; reservedReason?: string; usageStatus?: "available" | "reserved" | "used"; publicUrlVerified?: boolean; archiveState?: "active" | "archived"; topic?: string; platform?: SocialPlatform; distribution?: MediaInventoryRecord["distribution"]; shared?: boolean; sharedBrandIds?: string[]; campaignId?: string; provenance?: MediaInventoryRecord["provenance"]; hierarchy?: MediaInventoryRecord["hierarchy"] };
type TargetPublicationSummary = { id: string; clientId: string; brandId: string; state: string; legacyNonLive?: boolean; commandStatus?: string; commandError?: string; bindingId?: string; targetExternalId?: string; platform?: SocialPlatform; planId?: string; contentRunId?: string; variantId?: string; scheduledAt?: string; terminalAt?: string; idempotencyKey?: string; workerJobId?: string; providerJobId?: string; workerState?: string; revision?: number; workerRevision?: number; pendingCommandId?: string; workerAckState?: string };
type TargetPublicationActionOutcome = { status: "acknowledged" | "provider_confirmed" | "pending" | "blocked"; code?: string; message: string; publication?: TargetPublicationSummary };
type DisplayPublishJob = Omit<PublishJob, "state"> & { state: PublishJob["state"] | "reconciliation_error" };

type SharedMediaProof = Pick<MediaCard, "distribution" | "shared" | "sharedBrandIds">;

export function isSharedMediaForBrand(asset: SharedMediaProof, brandId: string): boolean {
  return asset.distribution === "universal" || asset.shared === true || asset.sharedBrandIds?.includes(brandId) === true;
}

export function localMediaBelongsToBrand(record: Pick<MediaInventoryRecord, "clientId" | "brandId" | "distribution" | "archiveState"> & Partial<SharedMediaProof>, card: SharedMediaProof | undefined, clientId: string, brandId: string): boolean {
  if (record.clientId !== clientId || record.archiveState === "archived") return false;
  if (record.brandId === brandId) return true;
  return record.distribution === "universal" || isSharedMediaForBrand({ distribution: card?.distribution, shared: card?.shared ?? record.shared, sharedBrandIds: card?.sharedBrandIds ?? record.sharedBrandIds }, brandId);
}

export function managedBrandBackfillGroups(state: WorkspaceState, userId: string, recoveredBrands: readonly Record<string, unknown>[]): Array<{ role: "owner" | "admin"; brandIds: string[] }> {
  const memberships = new Map(state.memberships.filter((membership) => membership.userId === userId && membership.status === "active" && canRole(membership.role, "manage_brand") && (membership.role === "owner" || membership.role === "admin")).map((membership) => [membership.workspaceId, membership.role as "owner" | "admin"]));
  const brands = new Map(state.brands.map((brand) => [brand.id, brand.clientId ?? brand.workspaceId]));
  recoveredBrands.forEach((brand) => {
    const id = String(brand.id ?? "");
    const clientId = String(brand.clientId ?? brand.client_id ?? "");
    if (id && clientId) brands.set(id, clientId);
  });
  const groups = new Map<"owner" | "admin", string[]>();
  brands.forEach((workspaceId, brandId) => {
    const role = memberships.get(workspaceId);
    if (role) groups.set(role, [...(groups.get(role) ?? []), brandId]);
  });
  return [...groups].map(([role, brandIds]) => ({ role, brandIds }));
}

export function targetPublicationSummary(record: Record<string, unknown>): TargetPublicationSummary {
  const text = (camel: string, snake: string) => String(record[camel] ?? record[snake] ?? "");
  const schedule = record.scheduledAt ?? record.scheduled_at;
  const scheduledAt = typeof schedule === "number" ? new Date(schedule * 1000).toISOString() : typeof schedule === "string" ? schedule : undefined;
  const platform = String(record.platform ?? record.targetPlatform ?? record.target_platform ?? "");
  const properties = record.properties as Record<string, unknown> | undefined;
  const legacyNonLive = record.legacyNonLive === true || record.legacy_non_live === true || record.simulation === true || properties?.simulation === true;
  const terminal = record.terminalAt ?? record.terminal_at;
  return {
    id: text("id", "id"), clientId: text("clientId", "client_id"), brandId: text("brandId", "brand_id"),
    state: text("state", "state"), ...(legacyNonLive ? { legacyNonLive: true } : {}),
    commandStatus: text("commandStatus", "command_status") || undefined,
    commandError: text("commandError", "command_error") || undefined,
    bindingId: text("bindingId", "binding_id") || undefined, targetExternalId: text("targetExternalId", "target_external_id") || undefined,
    platform: ["facebook", "instagram", "tiktok", "youtube"].includes(platform) ? platform as SocialPlatform : undefined,
    planId: text("planId", "plan_id") || undefined, contentRunId: text("contentRunId", "content_run_id") || undefined, variantId: text("variantId", "variant_id") || undefined,
    scheduledAt, terminalAt: typeof terminal === "string" ? terminal : undefined, idempotencyKey: text("idempotencyKey", "idempotency_key") || undefined,
    workerJobId: text("workerJobId", "worker_job_id") || undefined, providerJobId: text("providerJobId", "provider_job_id") || undefined, workerState: text("workerState", "worker_state") || undefined,
    revision: Number.isSafeInteger(record.revision) ? Number(record.revision) : undefined,
    workerRevision: Number.isSafeInteger(record.workerRevision ?? record.worker_revision) ? Number(record.workerRevision ?? record.worker_revision) : undefined,
    pendingCommandId: text("pendingCommandId", "pending_command_id") || undefined,
    workerAckState: text("workerAckState", "worker_ack_state") || undefined,
  };
}

export function targetPublicationSafeForBrandTrash(publication: TargetPublicationSummary): boolean {
  if (publication.pendingCommandId || ["pending", "unknown", "reconciliation_required"].includes(publication.commandStatus ?? "") || ["pending", "unknown", "reconciliation_required"].includes(publication.workerAckState ?? "")) return false;
  if (!["published", "canceled", "cancelled", "failed", "permanent_error", "approval_failed", "blocked"].includes(publication.state)) return false;
  if (publication.legacyNonLive) return publication.state === "blocked" && publication.workerAckState === "not_required";
  if (publication.state === "published") return Boolean(publication.providerJobId?.trim());
  if (["failed", "permanent_error", "approval_failed", "blocked"].includes(publication.state) && publication.workerAckState === "failed") return true;
  return ["acknowledged", "confirmed", "accepted"].includes(publication.workerAckState ?? "");
}

export function LiveReadinessIndicator({ readiness }: { readiness: "ready" | "blocked" }) {
  const copy = readiness === "ready"
    ? { label: "Verified Facebook Page text route ready · approved jobs only", detail: "Instagram requires a Business account and public media; TikTok and YouTube remain manual/deferred." }
    : { label: "Live route blocked · Page and token required", detail: "Discover a Page and store its token before live execution." };
  return <div className={`status-indicator ${readiness}`} role="status" aria-live="polite" aria-label={`${copy.label}. ${copy.detail}`} title={copy.detail}><span className="online-dot" /> {copy.label}</div>;
}

export function brandUiScopeKey(scope: Pick<BrandDeleteScope, "profileId" | "profileRevision" | "clientId" | "brandId">): string {
  return brandDeleteScopeKey(scope);
}

export function setBrandUiScopeEntry<T>(map: Record<string, T>, scope: Pick<BrandDeleteScope, "profileId" | "profileRevision" | "clientId" | "brandId">, value: T): Record<string, T> {
  return { ...map, [brandUiScopeKey(scope)]: value };
}

export function clearBrandUiScopeEntry<T>(map: Record<string, T>, scope: Pick<BrandDeleteScope, "profileId" | "profileRevision" | "clientId" | "brandId">): Record<string, T> {
  const next = { ...map };
  delete next[brandUiScopeKey(scope)];
  return next;
}

function targetJobIdsForDraft(draft: Draft, publications: TargetPublicationSummary[]): string[] {
  const storedIds = draft.queueJobIds?.length ? draft.queueJobIds : draft.queueJobId ? [draft.queueJobId] : [];
  return resolveAutomationTargetJobIds(publications, `variant-${draft.id}`, storedIds);
}

async function downloadLocalJson(filename: string, payload: unknown): Promise<string> {
  const contents = JSON.stringify(payload, null, 2);
  if (hasNativeRuntime()) {
    return await invoke<string>("export_json", { filename, contents });
  }
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

function dateTimeLocalValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export type RevoComposerRequestScope = { profileId: string; profileRevision: number; clientId: string; brandId: string };
export type RevoComposerRequestToken = RevoComposerRequestScope & { requestId: string; scopeKey: string };

export function revoComposerScopeKey(scope: RevoComposerRequestScope): string {
  return JSON.stringify([scope.profileId, scope.profileRevision, scope.clientId, scope.brandId]);
}

export function createRevoComposerRequestGate() {
  let sequence = 0;
  let active: RevoComposerRequestToken | undefined;
  return {
    begin(scope: RevoComposerRequestScope): RevoComposerRequestToken | undefined {
      if (active) return undefined;
      const token = { ...scope, requestId: `revo-${++sequence}`, scopeKey: revoComposerScopeKey(scope) };
      active = token;
      return token;
    },
    isCurrent(token: RevoComposerRequestToken, scope: RevoComposerRequestScope): boolean {
      return active?.requestId === token.requestId && active.scopeKey === revoComposerScopeKey(scope);
    },
    end(token: RevoComposerRequestToken): void {
      if (active?.requestId === token.requestId) active = undefined;
    },
    getActive(): RevoComposerRequestToken | undefined {
      return active;
    },
  };
}

export type RevoComposerRequestGate = ReturnType<typeof createRevoComposerRequestGate>;

export function settleRevoComposerRequest(input: { gate: RevoComposerRequestGate; token: RevoComposerRequestToken; isCurrentScope: () => boolean; setBusy: (busy: boolean) => void }): boolean {
  const ownsCurrentScope = input.isCurrentScope();
  if (input.gate.getActive()?.requestId === input.token.requestId) {
    input.gate.end(input.token);
    input.setBusy(false);
  }
  return ownsCurrentScope;
}

export function validateRevoComposerSchedule(value: string): { ok: true; iso?: string } | { ok: false; message: string } {
  if (!value.trim()) return { ok: true };
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { ok: false, message: "Ngày giờ không hợp lệ; hãy chọn lại trong form." };
  return { ok: true, iso: date.toISOString() };
}

export function guardComposerMutation(isBusy: boolean, onBlocked: () => void): boolean {
  if (!isBusy) return true;
  onBlocked();
  return false;
}

export function runGuardedComposerMutation(input: { isBusy: boolean; onBlocked: () => void; mutate: () => void }): boolean {
  if (!guardComposerMutation(input.isBusy, input.onBlocked)) return false;
  input.mutate();
  return true;
}

export function openRevoComposerHandler(input: { isGenerating: boolean; captureOpener: () => void; setVisible: (visible: boolean) => void; clearError: () => void; onBlocked?: () => void }): boolean {
  if (input.isGenerating) {
    input.onBlocked?.();
    return false;
  }
  input.captureOpener();
  input.clearError();
  input.setVisible(true);
  return true;
}

export type ApprovalSchedulePromptDecision = { action: "open_picker" } | { action: "continue"; scheduledAt?: string } | { action: "reject"; message: string };

export function approvalSchedulePromptDecision(input: { planId?: string; hasMatchingPlan: boolean; draftScheduledAt?: string; overrideScheduledAt?: string }): ApprovalSchedulePromptDecision {
  if (input.planId && !input.hasMatchingPlan) return { action: "reject", message: "Không tìm thấy kế hoạch gốc; không thể xác nhận lịch." };
  if (input.overrideScheduledAt) return { action: "continue", scheduledAt: input.overrideScheduledAt };
  if (!input.planId) return { action: "open_picker" };
  return { action: "continue", scheduledAt: input.draftScheduledAt };
}

export function closeApprovalSchedulePromptState(_state: { draftId?: number; value: string }): { draftId?: number; value: string; approvalRequested: false } {
  return { draftId: undefined, value: "", approvalRequested: false };
}

export function submitApprovalSchedulePromptValue(value: string, now: Date): { ok: true; scheduledAt: string } | { ok: false; message: string } {
  const scheduledAt = new Date(value);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= now.getTime()) return { ok: false, message: "Giờ đăng phải nằm trong tương lai; approval chưa được gửi." };
  return { ok: true, scheduledAt: scheduledAt.toISOString() };
}

export function buildApprovalContentRunPatch(input: {
  state: string;
  scheduledAt?: string;
  approvalState: string;
  targetApprovalState: string;
  targetApprovalIntents: readonly Record<string, unknown>[];
  planId?: string;
  targetBindingIds: readonly string[];
  bindingIds: readonly string[];
}): Record<string, unknown> {
  return {
    state: input.state,
    approvalState: input.approvalState,
    targetApprovalState: input.targetApprovalState,
    targetApprovalIntents: input.targetApprovalIntents.map((intent) => ({ ...intent })),
    ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
    ...(input.planId ? { planId: input.planId } : {}),
    targetBindingIds: [...input.targetBindingIds],
    bindingIds: [...input.bindingIds],
  };
}

function mediaCardFromInventory(record: MediaInventoryRecord): MediaCard {
  const normalized = normalizeDriveInventoryRecord(record);
  const inferredVideo = normalized.kind === "video" || /^video\//i.test(normalized.mimeType ?? "") || /\.(?:mp4|webm|mov)$/i.test(normalized.localAssetPath ?? normalized.name);
  const kind = inferredVideo ? "Video" : normalized.kind === "image" ? "Image" : "Unknown";
  const status: MediaCard["status"] = normalized.archiveState === "archived" ? "Needs review" : normalized.usageStatus === "used" || normalized.status === "used" ? "Used" : normalized.reviewStatus === "needs_review" || !isMediaEligible(normalized) ? "Needs review" : "Ready";
  return { id: normalized.id, clientId: normalized.clientId, brandId: normalized.brandId, name: normalized.name, kind, status, size: normalized.sizeBytes ? `${Math.round(normalized.sizeBytes / 1024)} KB` : "Metadata only", usage: normalized.archiveState === "archived" ? "Archived · provider asset preserved" : normalized.usageStatus === "used" ? `Used · ${normalized.usedReason ?? "reason not recorded"}` : normalized.usageStatus === "reserved" ? `Reserved · ${normalized.reservedReason ?? "active reservation"}` : "Not assigned", color: kind === "Video" ? "#f8e9ff" : kind === "Unknown" ? "#fff1e6" : "#e7f0ff", publicUrl: normalized.normalizedUrl, localAssetPath: normalized.localAssetPath, mimeType: normalized.mimeType, modifiedAt: normalized.modifiedAt, checksum: normalized.sha256 ? `sha256:${normalized.sha256.replace(/^sha256:/i, "")}` : undefined, visualFingerprint: normalized.visualFingerprint, visualFingerprintSource: normalized.visualFingerprintSource, registrationMode: normalized.source === "drive" ? "google_drive" : normalized.source === "public_https" ? "public_url" : normalized.source === "generated" ? "generated" : "seed", providerFileId: normalized.providerFileId ?? normalized.normalizedDriveFileId, reviewStatus: normalized.reviewStatus, duplicateStatus: normalized.duplicateStatus, duplicateKind: normalized.duplicateKind, duplicateReason: normalized.duplicateReason, usedReason: normalized.usedReason, reservedReason: normalized.reservedReason, usageStatus: normalized.usageStatus, publicUrlVerified: normalized.publicUrlVerified, archiveState: normalized.archiveState, topic: normalized.topic, platform: normalized.platform, distribution: normalized.distribution, campaignId: normalized.campaignId, provenance: normalized.provenance, hierarchy: normalized.hierarchy };
}

function mediaInventoryFromCard(asset: MediaCard): MediaInventoryRecord | undefined {
  if (!asset.clientId || !asset.brandId) return undefined;
  const kind = asset.kind === "Image" ? "image" : asset.kind === "Video" ? "video" : "unknown";
  return normalizeDriveInventoryRecord({ id: String(asset.id), clientId: asset.clientId, brandId: asset.brandId, campaignId: asset.campaignId ?? "", topic: asset.topic ?? "", platform: asset.platform ?? "facebook", distribution: asset.distribution, kind, name: asset.name, mimeType: asset.mimeType ?? (kind === "image" ? "image/*" : kind === "video" ? "video/*" : "application/octet-stream"), sizeBytes: 0, modifiedAt: asset.modifiedAt ?? new Date(0).toISOString(), source: asset.registrationMode === "google_drive" ? "drive" : asset.registrationMode === "public_url" ? "public_https" : asset.registrationMode === "generated" ? "generated" : "local", status: asset.archiveState === "archived" ? "archived" : asset.status === "Ready" ? "eligible" : asset.status === "Failed" ? "failed" : "classified", normalizedUrl: asset.publicUrl, localAssetPath: asset.localAssetPath, sha256: asset.checksum?.replace(/^sha256:/i, ""), visualFingerprint: asset.visualFingerprint, visualFingerprintSource: asset.visualFingerprintSource, reviewStatus: asset.reviewStatus ?? "needs_review", duplicateStatus: asset.duplicateStatus ?? "unknown", duplicateKind: asset.duplicateKind, duplicateReason: asset.duplicateReason, usageStatus: asset.usageStatus ?? "available", usedReason: asset.usedReason, reservedReason: asset.reservedReason, publicUrlVerified: asset.publicUrlVerified ?? false, archiveState: asset.archiveState, providerFileId: asset.providerFileId, provenance: asset.provenance, hierarchy: asset.hierarchy });
}

function normalizeRestoredMediaCard(asset: MediaCard): MediaCard {
  const hydrated = hydrateRestoredMediaCardDistribution(asset);
  if (hydrated.kind !== "Unknown" || (hydrated.registrationMode !== "google_drive" && !hydrated.providerFileId)) return hydrated;
  const classified = classifyDriveInventory({ providerFileId: hydrated.providerFileId ?? String(hydrated.id), name: hydrated.name, mimeType: "application/octet-stream", kind: "unknown", sizeBytes: 0, modifiedAt: hydrated.modifiedAt ?? new Date(0).toISOString() });
  if (classified.kind === "unknown") return hydrated;
  return { ...hydrated, kind: classified.kind === "image" ? "Image" : "Video" };
}

function applyLedgerToRecord(record: MediaInventoryRecord, ledger: MediaReservationLedger): MediaInventoryRecord {
  return applyMediaReservationToRecord(record, ledger.reservationForAsset(record.id));
}

const initialMedia: MediaCard[] = [];

const defaultBrandSystem: BrandSystem = {
  workspaceId: "mile-mark-money",
  voice: "Clear, practical, warm and evidence-led. Explain money without shame or hype.",
  audience: "Vietnamese adults building healthier personal finance habits",
  prohibitedClaims: ["guaranteed returns", "get rich quick", "personalized financial advice"],
  visualTokens: { primary: "#4f46e5", secondary: "#f6f7fb", typography: "SF Pro Display" },
};

function draftToVariant(draft: Draft): ContentVariant {
  return draftToContentVariant(draft);
}

function assetFormatForContentKind(kind: ContentKind): AssetPromptFormat {
  return kind === "image" || kind === "carousel" ? "image" : kind === "video" || kind === "short_video" || kind === "long_video" ? "video" : "text";
}

async function automationMediaSetFingerprint(asset: MediaInventoryRecord): Promise<string | undefined> {
  if (!asset.sha256 || !/^[a-f0-9]{64}$/i.test(asset.sha256)) return undefined;
  const canonical = JSON.stringify([{ assetId: asset.id, sha256: asset.sha256.toLowerCase(), mimeType: asset.mimeType.toLowerCase(), order: 0, role: "publish" }]);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function strategySnapshotFromResolved(strategy: Record<string, unknown>, format: AssetPromptFormat, recipeId?: string): StrategySnapshot {
  const supplied = strategy.strategySnapshot && typeof strategy.strategySnapshot === "object" && !Array.isArray(strategy.strategySnapshot)
    ? structuredClone(strategy.strategySnapshot as Record<string, unknown>)
    : {
      objectiveKey: strategy.objectiveKey,
      objectiveLabel: strategy.objectiveLabel ?? strategy.objectiveKey,
      pillarId: strategy.pillarId,
      pillarLabel: strategy.pillarLabel ?? strategy.pillarId,
      angleId: strategy.angleId,
      angleLabel: strategy.angleLabel ?? strategy.angleId,
      angleGuidance: strategy.angleGuidance ?? "",
      ...(strategy.angleIdByChannel && typeof strategy.angleIdByChannel === "object" && !Array.isArray(strategy.angleIdByChannel) ? { angleIdByChannel: structuredClone(strategy.angleIdByChannel) } : {}),
      channel: strategy.channel,
      strategyVersion: strategy.strategyVersion,
      catalogFingerprint: strategy.catalogFingerprint ?? "",
      ...(typeof strategy.recipeGuidance === "string" && strategy.recipeGuidance.trim() ? { recipeGuidance: strategy.recipeGuidance.trim() } : {}),
    };
  const snapshot = { ...supplied, format } as Record<string, unknown>;
  const resolvedRecipeId = recipeId ?? (typeof strategy.recipeId === "string" && strategy.recipeId.trim() ? strategy.recipeId.trim() : undefined);
  if (resolvedRecipeId) snapshot.recipeId = resolvedRecipeId;
  const recipeGuidance = typeof strategy.recipeGuidance === "string" && strategy.recipeGuidance.trim()
    ? strategy.recipeGuidance.trim()
    : undefined;
  if (recipeGuidance && snapshot.recipeGuidance === undefined) snapshot.recipeGuidance = recipeGuidance;
  return snapshot as unknown as StrategySnapshot;
}

const platformMeta: Record<Platform, { className: string; icon: BetterPlatformIconName }> = {
  Facebook: { className: "facebook", icon: "facebook" },
  Instagram: { className: "instagram", icon: "instagram" },
  TikTok: { className: "tiktok", icon: "tiktok" },
  YouTube: { className: "youtube", icon: "youtube" },
};

const initialDrafts: Draft[] = [];

const defaultContentRecipes: ContentRecipe[] = [
  { id: "recipe-education", brandId: "brand-mile-mark-money", name: "Practical education", platforms: ["facebook", "instagram", "youtube"], contentKinds: ["text", "image", "short_video"], hookGuidance: "Open with one specific tension or question.", structureGuidance: "Context → three practical steps → one small action.", ctaGuidance: "Invite a save or a thoughtful reply.", qualityChecklist: ["Claims have a source", "Tone is non-judgmental", "Platform length is respected"], status: "active" },
  { id: "recipe-product", brandId: "brand-bellamy-baby", name: "Product proof", platforms: ["facebook", "instagram"], contentKinds: ["text", "image"], hookGuidance: "Lead with a concrete product detail.", structureGuidance: "Feature → use case → care note.", ctaGuidance: "Invite the operator-approved product action.", qualityChecklist: ["No medical claims", "Material and fit are accurate"], status: "active" },
];

type NavIconName = "overview" | "calendar" | "planner" | "studio" | "media" | "review" | "channels" | "analytics" | "brand" | "settings" | "search";
type NavItem = { id: string; label: string; icon: NavIconName; opensModal?: boolean; reviewBadge?: boolean };

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  { label: "Lập kế hoạch", items: [
    { id: "Command center", label: "Tổng quan", icon: "overview" },
    { id: "Calendar", label: "Lịch đăng", icon: "calendar" },
    { id: "Automation Planner", label: "Kế hoạch tự động", icon: "planner" },
  ] },
  { label: "Sản xuất", items: [
    { id: "Content studio", label: "Xưởng nội dung", icon: "studio", opensModal: true },
    { id: "Media library", label: "Thư viện media", icon: "media" },
  ] },
  { label: "Kiểm soát", items: [
    { id: "Review inbox", label: "Hộp duyệt", icon: "review", reviewBadge: true },
  ] },
  { label: "Theo dõi", items: [
    { id: "Analytics", label: "Phân tích", icon: "analytics" },
  ] },
  { label: "Quản trị", items: [
    { id: "Brand system", label: "Hệ thống brand", icon: "brand" },
    { id: "Settings", label: "Cài đặt", icon: "settings" },
  ] },
];

const allNavItems = navGroups.flatMap((group) => group.items);
const navLabel = (id: string) => allNavItems.find((item) => item.id === id)?.label ?? id;

function NavIcon({ name }: { name: NavIconName }) {
  const paths: Record<NavIconName, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
    planner: <><path d="M5 4h14M5 10h14M5 16h9"/><path d="m16 15 2 2 3-4"/></>,
    studio: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/></>,
    media: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 18 5-5 3 3 3-4 5 6"/></>,
    review: <><path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/></>,
    channels: <><circle cx="6" cy="12" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="m8 11 8-4M8 13l8 4"/></>,
    analytics: <><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/></>,
    brand: <><path d="M12 3 4 7v5c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V7l-8-4Z"/><path d="M9 12h6M12 9v6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20h-3v-.08A1.7 1.7 0 0 0 10.66 18.36a1.7 1.7 0 0 0-1.88.34l-.06.06L6.6 16.64l.06-.06A1.7 1.7 0 0 0 7 14.7a1.7 1.7 0 0 0-1.56-1.04H5v-3h.08A1.7 1.7 0 0 0 6.64 9.62 1.7 1.7 0 0 0 6.3 7.74l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.34 4.4V4h3v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19 9.3a1.7 1.7 0 0 0 1.56 1.04H21v3h-.08A1.7 1.7 0 0 0 19.4 15Z"/></>,
    search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function PlatformMark({ platform }: { platform: Platform }) {
  const meta = platformMeta[platform];
  return <span className={`platform-mark ${meta.className}`}><BetterPlatformIcon name={meta.icon} /></span>;
}

function StatusPill({ status }: { status: DraftStatus }) {
  return <span className={`status-pill ${status.toLowerCase().replace(/ /g, "-")}`}>{status}</span>;
}

function contentIconName(draft: Pick<Draft, "contentKind" | "mediaKind" | "tag" | "title">): BetterContentIconName {
  const descriptor = `${draft.contentKind ?? ""} ${draft.mediaKind ?? ""} ${draft.tag} ${draft.title}`.toLowerCase();
  if (/ai generated|generated by ai|ai draft/.test(`${draft.tag} ${draft.title}`.toLowerCase())) return "sparkles";
  if (/video|clip|reel|short video/.test(descriptor)) return "video";
  if (/image|photo|picture|ảnh/.test(descriptor)) return "image";
  return "sparkles";
}

function emptyProfileWorkspaceState(profileId: string): WorkspaceState {
  const workspaceId = `workspace-${profileId}`;
  return {
    activeWorkspaceId: workspaceId,
    activeBrandId: "",
    brandVoiceByBrand: {},
    workspaces: [{ id: workspaceId, name: "Workspace mới", clientLabel: "Client", timezone: "Asia/Ho_Chi_Minh", brandIds: [], membershipIds: [`member-${profileId}`] }],
    brands: [],
    memberships: [{ id: `member-${profileId}`, workspaceId, userId: profileId, displayName: "Người dùng mới", email: "", role: "owner", status: "active" }],
  };
}


function App() {
  const durableWorkerClient = useMemo(() => createDurableWorkerClient(isElectronRuntime() ? "http://127.0.0.1:18788" : undefined), []);
  const queueRef = useRef(new LocalPublishQueue());
  const reservationByJobRef = useRef(new Map<string, string>());
  const creativeRunByJobRef = useRef(new Map<string, string>());
  const publicationByJobRef = useRef(new Map<string, string>());
  const draftByJobRef = useRef(new Map<string, { draftId: number; contentRunId?: string }>());
  const rewriteInFlightRef = useRef(new Set<string>());
  const draftActionInFlightRef = useRef(new Map<string, DraftActionToken>());
  const durableWorkerJobIdsRef = useRef(new Set<string>());
  const actorBindingBackfillInFlightRef = useRef(new Set<string>());
  const actorBindingBackfillDoneRef = useRef(new Set<string>());
  const pendingCompensationInFlightRef = useRef(new Set<string>());
  const pendingApprovalReplayInFlightRef = useRef(new Set<string>());
  const agencyMigrationFlightRef = useRef<AgencyMigrationFlight>({ scopeKey: "", promise: undefined });
  const brandDeleteInFlightRef = useRef(new Map<string, string>());
  const brandDeleteUnknownRef = useRef(new Map<string, BrandLifecycleRequestToken>());
  const brandDeleteLatestRequestRef = useRef(new Map<string, string>());
  const brandDeleteRequestSequenceRef = useRef(0);
  const automationPlannerRequestIdsRef = useRef(new Map<string, number>());
  const automationPlannerInFlightRef = useRef(new Set<string>());
  const automationPlannerSurfaceRef = useRef({ identity: "", generation: 0 });
  const automationPlannerDraftsRef = useRef<Record<string, AutomationPlannerDraftState>>({});
  const automationPlannerSelectionsRef = useRef<Record<string, string>>({});
  const contentIntelligenceIntakeDraftsRef = useRef<ContentIntelligenceIntakeDraftMap>({});
  const contentIntelligenceIntakeRequestIdsRef = useRef(new Map<string, number>());
  const contentIntelligenceIntakeInFlightRef = useRef(new Set<string>());
  const contentIntelligenceScopeRef = useRef<ContentIntelligenceIntakeScope>({ profileId: "", clientId: "", brandId: "" });
  const sanitizeRestoredMediaAssets = (assets: MediaCard[] | undefined): MediaCard[] | undefined => assets?.map((asset) => normalizeRestoredMediaCard(sanitizeLegacyMediaAsset(asset, "Ready", "Needs public URL")));
  const [activeNav, setActiveNav] = useState("Command center");
  const pageContentRef = useRef<HTMLDivElement>(null);
  const mainNavRef = useRef<HTMLElement>(null);
  const [contentStudioFilter, setContentStudioFilter] = useState<RevoContentFilter>("all");
  const [settingsSection, setSettingsSection] = useState<"safety" | "bindings" | "ai" | "meta" | "workspace">("safety");
  const [dashboardCalendarDate, setDashboardCalendarDate] = useState("");
  const [activeFilter, setActiveFilter] = useState<"All" | DraftStatus>("All");
  const [dashboardContentMenuId, setDashboardContentMenuId] = useState<number | undefined>();
  const [profileId] = useState(() => activeUserProfileId());
  const profileRevision = profileRuntimeIdentity()?.profileRevision ?? 0;
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>(() => listUserProfiles());
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const restoredSnapshot = useMemo(() => {
    const fresh = profileId !== "profile-bavy";
    const snapshot = restoreSnapshot(fresh ? [] : initialDrafts, ["Facebook", "Instagram", "TikTok", "YouTube"], defaultBrandSystem, fresh ? [] : initialMedia, fresh ? emptyProfileWorkspaceState(profileId) : defaultWorkspaceState, fresh ? [] : defaultContentTemplates, [], undefined, profileId);
    return { ...snapshot, mediaAssets: sanitizeRestoredMediaAssets(snapshot.mediaAssets) };
  }, [profileId]);
  const automationLedgerRef = useRef<MediaReservationLedger>(hydrateReservationLedger(restoredSnapshot.automationState?.reservations ?? []));
  const [drafts, setDrafts] = useState(restoredSnapshot.drafts);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const activeActionDraftRef = useRef<{ scopeKey: string; draftId: number } | undefined>(undefined);
  const [draftActionFeedback, setDraftActionFeedback] = useState<Record<string, Partial<Record<DraftActionKind, DraftActionFeedback>>>>({});
  const draftActionFeedbackRef = useRef(draftActionFeedback);
  draftActionFeedbackRef.current = draftActionFeedback;
  const actionContextRef = useRef({ profileId: "", profileRevision: 0, clientId: "", brandId: "" });
  useEffect(() => {
    setDrafts((current) => current.map((draft) => draft.rewriteStatus === "generating" ? { ...draft, rewriteStatus: "unknown", generationStatus: "unknown", rewriteError: "APP_RESTART_INTERRUPTED", time: "Làm lại bị gián đoạn khi khởi động lại · cần đối soát, không tự gửi lại" } : draft));
  }, []);
  const [focusDraftId, setFocusDraftId] = useState<number | undefined>();
  const [showComposer] = useState(false);
  const [showRevoComposer, setShowRevoComposer] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(restoredSnapshot.selectedPlatforms as Platform[]);
  const [queueJobs, setQueueJobs] = useState<PublishJob[]>([]);
  const [selectedQueueJob, setSelectedQueueJob] = useState<DisplayPublishJob | undefined>();
  const [selectedDashboardDraftId, setSelectedDashboardDraftId] = useState<number | undefined>();
  const dashboardMenuTriggerRefs = useRef(new Map<number, HTMLButtonElement>());
  const dashboardDetailTriggerRef = useRef<HTMLElement | null>(null);
  const dashboardDetailCloseRef = useRef<HTMLButtonElement | null>(null);
  const dashboardDetailModalRef = useRef<HTMLElement | null>(null);
  const [queueRevision, setQueueRevision] = useState(0);
  const recordAnalyticsEventRef = useRef<(eventName: AnalyticsEvent["eventName"], properties: Record<string, unknown>) => void>(() => undefined);
  const refreshTargetPublicationsRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    queueRef.current.hydrate(restoredSnapshot.queue);
    setQueueJobs(queueRef.current.list());
    setQueueRevision((value) => value + 1);
  }, [restoredSnapshot.queue]);
  useEffect(() => {
    const resetScroll = () => {
      pageContentRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      mainNavRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };
    resetScroll();
    const resetTimer = window.setTimeout(resetScroll, 0);
    return () => window.clearTimeout(resetTimer);
  }, [activeNav]);
  useEffect(() => {
    return queueRef.current.subscribe((event) => {
      setQueueJobs(queueRef.current.list());
      setQueueRevision((value) => value + 1);
      const reservationKey = reservationByJobRef.current.get(event.job.id);
      const creativeRunId = creativeRunByJobRef.current.get(event.job.id);
      if (event.type === "published" && reservationKey) { automationLedgerRef.current.markUsed(reservationKey); reservationByJobRef.current.delete(event.job.id); syncLedgerState(); }
      if ((event.type === "retryable_error" || event.type === "permanent_error") && reservationKey) { automationLedgerRef.current.release(reservationKey); reservationByJobRef.current.delete(event.job.id); syncLedgerState(); }
      if (creativeRunId && event.type === "published") { creativeRunByJobRef.current.delete(event.job.id); }
      if (creativeRunId && (event.type === "retryable_error" || event.type === "permanent_error")) { setAutomationState((current) => ({ ...current, creativeRuns: current.creativeRuns.map((run) => run.id === creativeRunId && run.state !== "failed" ? { ...run, state: "failed", error: event.message ?? "Provider publish failed", updatedAt: new Date().toISOString() } : run) })); creativeRunByJobRef.current.delete(event.job.id); }
      if ((event.type === "retryable_error" || event.type === "permanent_error") && !event.message?.includes("DUPLICATE_TEST_JOB_CANCELLED")) {
        setQueueNotice(`Publish job ${event.type === "retryable_error" ? "cần retry" : "bị dừng"}: ${event.message ?? "Provider error"}`);
      }
      if (event.type === "published" || event.type === "permanent_error") {
        setQueueNotice("Worker finished; waiting for Control Plane provider-confirmed publication state.");
        void refreshTargetPublicationsRef.current().catch(() => undefined);
      }
    });
  }, []);
  useEffect(() => {
    const queuedVariants = new Set(queueJobs.filter((job) => job.state === "queued" || job.state === "uploading" || job.state === "processing").map((job) => job.variantId));
    if (queuedVariants.size === 0) return;
    setDrafts((current) => {
      let changed = false;
      const next = current.map((draft) => {
        if (draft.status !== "Failed" || !queuedVariants.has(`variant-${draft.id}`)) return draft;
        changed = true;
        return { ...draft, status: "Scheduled" as const, approvalState: "ready" as const, time: "Sẵn sàng · publish job đang chờ" };
      });
      return changed ? next : current;
    });
  }, [queueJobs]);

  const [newTopic, setNewTopic] = useState("");
  const [newContentPillar, setNewContentPillar] = useState("");
  const [newObjective, setNewObjective] = useState<Draft["objective"] | "">("");
  const [newCaption, setNewCaption] = useState("");
  const [newCta, setNewCta] = useState("");
  const [newHashtags, setNewHashtags] = useState("");
  const [newSeoKeywords, setNewSeoKeywords] = useState("");
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [newSources, setNewSources] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [composerAssetId, setComposerAssetId] = useState<string | number | "">("");
  const [aiProvider, setAiProvider] = useState<AIProvider>("openai");
  const [aiMode, setAiMode] = useState<"api" | "manual_assisted" | "web_subscription">("api");
  const [aiAccounts, setAiAccounts] = useState<AIAccountRegistry>(() => defaultAIAccounts());
  const [aiSettingsNotice, setAiSettingsNotice] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const composerRequestGateRef = useRef(createRevoComposerRequestGate());
  const composerOpenerRef = useRef<RevoComposerFocusTarget | null>(null);
  const composerFallbackRef = useRef<RevoComposerFocusTarget | null>(null);
  const [mediaImportBusy, setMediaImportBusy] = useState(false);
  const [mediaImportNotice, setMediaImportNotice] = useState("");
  const [showClientSetup, setShowClientSetup] = useState(false);
  const [showBrandWizard, setShowBrandWizard] = useState(false);
  const [schedulePromptDraftId, setSchedulePromptDraftId] = useState<number | undefined>();
  const schedulePromptOpenerRef = useRef<HTMLElement | null>(null);
  const schedulePromptDialogRef = useRef<HTMLElement>(null);
  const schedulePromptScopeKeyRef = useRef("");
  const [schedulePromptValue, setSchedulePromptValue] = useState("");
  const [reschedulePromptJobId, setReschedulePromptJobId] = useState<string | undefined>();
  const [reschedulePromptValue, setReschedulePromptValue] = useState("");
  const [targetActionPrompt, setTargetActionPrompt] = useState<{ draftId: number; action: "publish_now" | "reschedule" | "cancel"; scopeKey: string }>();
  const [targetActionJobId, setTargetActionJobId] = useState("");
  const targetActionOpenerRef = useRef<HTMLElement | null>(null);
  const targetActionDialogRef = useRef<HTMLElement>(null);
  const [setupName, setSetupName] = useState("");
  const [brandSetupStep, setBrandSetupStep] = useState(1);
  const [brandSetupForm, setBrandSetupForm] = useState({ identityName: "Default identity", vision: "", mission: "", values: "", personality: "", audience: "", positioning: "", tone: "", vocabulary: "", prohibitedClaims: "", requiredDisclosure: "", logoAssetIds: "", tagline: "", primary: "#4f46e5", primaryRgb: "", primaryCmyk: "", secondary: "#f6f7fb", secondaryRgb: "", secondaryCmyk: "", typography: "SF Pro Display", styleGuide: "" });
  const [brandSetupTargets, setBrandSetupTargets] = useState<string[]>([]);
  const [connectionNotice, setConnectionNotice] = useState("");
  const [oauthUrl, setOauthUrl] = useState("");
  const [queueNotice, setQueueNotice] = useState("");
  const workerUnreachableNotice = "Durable worker chưa phản hồi; local queue vẫn được giữ nguyên.";
  const [assets, setAssets] = useState<MediaCard[]>(restoredSnapshot.mediaAssets ?? initialMedia);
  useEffect(() => {
    setAssets((current) => {
      let changed = false;
      const next = current.map((asset) => {
        const linkedVideo = drafts.some((draft) => draft.mediaAssetIds?.includes(String(asset.id)) && (draft.contentKind === "video" || draft.mediaKind === "video" || draft.mediaOperation?.kind === "video"));
        const extensionVideo = /\.(?:mp4|webm|mov)$/i.test(asset.localAssetPath ?? asset.name) || /generated\s+video/i.test(asset.name);
        if (asset.kind !== "Video" && (linkedVideo || extensionVideo)) {
          changed = true;
          return { ...asset, kind: "Video" as const, color: "#f8e9ff" };
        }
        return asset;
      });
      return changed ? next : current;
    });
  }, [drafts]);
  const [driveInventorySyncBusy, setDriveInventorySyncBusy] = useState(false);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(restoredSnapshot.workspaceState ?? defaultWorkspaceState);
  const [contentTemplates, setContentTemplates] = useState<ContentTemplate[]>(restoredSnapshot.contentTemplates ?? defaultContentTemplates);
  const [automationPlans, setAutomationPlans] = useState<AutomationPlan[]>(restoredSnapshot.automationPlans ?? []);
  const [automationPlannerDrafts, setAutomationPlannerDrafts] = useState<Record<string, AutomationPlannerDraftState>>({});
  const [automationPlannerSelections, setAutomationPlannerSelections] = useState<Record<string, string>>({});
  const [contentIntelligenceIntakeDrafts, setContentIntelligenceIntakeDrafts] = useState<ContentIntelligenceIntakeDraftMap>({});
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [researchEvidence, setResearchEvidence] = useState<ResearchEvidence[]>([]);
  const [promptBlueprints, setPromptBlueprints] = useState<PromptBlueprint[]>([]);
  const [trendSignals, setTrendSignals] = useState<TrendSignal[]>([]);
  const [analyticsEvents, setAnalyticsEvents] = useState<AnalyticsEvent[]>([]);
  const [targetPublications, setTargetPublications] = useState<TargetPublicationSummary[]>([]);
  const [loadedTargetPublicationBrandIds, setLoadedTargetPublicationBrandIds] = useState<string[]>([]);
  const [authoritativeBrandImpacts, setAuthoritativeBrandImpacts] = useState<Record<string, BrandTrashPreview>>({});
  const [brandImpactLoading, setBrandImpactLoading] = useState<Record<string, boolean>>({});
  const [brandImpactErrors, setBrandImpactErrors] = useState<Record<string, string | undefined>>({});
  const [brandDeleteStates, setBrandDeleteStates] = useState<Record<string, { status: "pending" | "reconciling" | "unknown"; requestId: string; message: string }>>({});
  const [controlPlaneHealth, setControlPlaneHealth] = useState<{ dataAsOf?: string | null; workerReconciledAt?: string | null }>({});
  const [contentRecipes, setContentRecipes] = useState<ContentRecipe[]>(() => restoredSnapshot.workspaceState?.contentRecipes ?? defaultContentRecipes);
  const [selectedKnowledgeItemIds, setSelectedKnowledgeItemIds] = useState<string[]>([]);
  const [selectedResearchEvidenceIds, setSelectedResearchEvidenceIds] = useState<string[]>([]);
  const [selectedPromptBlueprintId, setSelectedPromptBlueprintId] = useState("");
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [transformMode, setTransformMode] = useState<ContentTransformMode>("original");
  const [providerConfigurationNotice, setProviderConfigurationNotice] = useState("");
  const [agencyMigrationCommitted, setAgencyMigrationCommitted] = useState(Boolean(restoredSnapshot.controlPlaneMigrated));
  const [automationState, setAutomationState] = useState<AutomationPersistenceState>(() => restoredSnapshot.automationState ?? { schemaVersion: 1, brandPlans: [], mediaAssets: [], reservations: [], creativeRuns: [], imageProvider: "local_preview" });
  const [automationAI, setAutomationAI] = useState<AutomationAIPreference>(() => restoredSnapshot.automationState?.automationAI ?? DEFAULT_AUTOMATION_AI_PREFERENCE);
  const [imageProvider, setImageProviderState] = useState<ImageProvider>(restoredSnapshot.automationState?.imageProvider ?? "local_preview");
  const [videoProvider, setVideoProviderState] = useState<VideoProvider>(restoredSnapshot.automationState?.videoProvider ?? "local_upload");
  const workspaceStateRef = useRef(workspaceState);
  const assetsRef = useRef(assets);
  const automationStateRef = useRef(automationState);
  workspaceStateRef.current = workspaceState;
  assetsRef.current = assets;
  automationStateRef.current = automationState;
  automationPlannerDraftsRef.current = automationPlannerDrafts;
  automationPlannerSelectionsRef.current = automationPlannerSelections;
  contentIntelligenceIntakeDraftsRef.current = contentIntelligenceIntakeDrafts;
  const activeWorkspaceRecord = activeWorkspace(workspaceState);
  useEffect(() => {
    setAuthoritativeBrandImpacts({});
    setBrandImpactLoading({});
    setBrandImpactErrors({});
  }, [activeWorkspaceRecord.id, profileId, profileRevision]);
  useEffect(() => {
    if (!durableWorkerClient) return;
    let disposed = false;
    const syncWorkerJobs = async () => {
      try {
        const records = await durableWorkerClient.listJobs(activeWorkspaceRecord.id);
        if (disposed) return;
        setQueueNotice((current) => current === workerUnreachableNotice ? "" : current);
        let changed = false;
        setTargetPublications((current) => current.map((publication) => {
          const record = records.find((candidate) => candidate.id === publication.workerJobId);
          if (!record || (publication.workerState === record.state && publication.workerRevision === record.revision)) return publication;
          changed = true;
          return { ...publication, workerState: record.state, workerRevision: record.revision };
        }));
        records.forEach((record) => {
          durableWorkerJobIdsRef.current.add(record.id);
          const controlPlanePublicationId = publicationByJobRef.current.get(record.id);
          if (controlPlanePublicationId) {
            if (["completed", "failed", "unknown"].includes(record.state)) void refreshTargetPublicationsRef.current().catch(() => undefined);
            return;
          }
          const current = queueRef.current.list().find((job) => job.id === record.id);
          const externalState = record.state === "completed" ? "running" : record.state === "failed" ? "failed" : record.state === "running" ? "running" : "queued";
          const updated = queueRef.current.syncExternalResult(record.id, record.provider_job_id ?? undefined, externalState, record.last_error ?? undefined, record.attempts);
          if (current && updated && JSON.stringify(current) !== JSON.stringify(updated)) changed = true;
        });
        if (changed) { setQueueJobs(queueRef.current.list()); setQueueRevision((value) => value + 1); recordAnalyticsEventRef.current("worker.reconciled", { queueSize: records.length }); }
      } catch {
        if (!disposed) setQueueNotice(workerUnreachableNotice);
      }
    };
    void syncWorkerJobs();
    const intervalId = window.setInterval(() => { void syncWorkerJobs(); }, 60_000);
    return () => { disposed = true; window.clearInterval(intervalId); };
  }, [activeWorkspaceRecord.id]);
  const activeBrandRecord = activeBrand(workspaceState);
  const composerScope: RevoComposerRequestScope = { profileId, profileRevision, clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id };
  const composerBusy = isGenerating || Boolean(composerRequestGateRef.current.getActive());
  const composerRequestOwnsCurrentScope = (token: RevoComposerRequestToken): boolean => composerRequestGateRef.current.isCurrent(token, {
    profileId,
    profileRevision,
    clientId: activeWorkspace(workspaceStateRef.current).id,
    brandId: activeBrand(workspaceStateRef.current).id,
  });
  const setImageProvider = (provider: ImageProvider): boolean => runGuardedComposerMutation({ isBusy: composerBusy, onBlocked: () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi image provider."), mutate: () => setImageProviderState(provider) });
  const setVideoProvider = (provider: VideoProvider): boolean => runGuardedComposerMutation({ isBusy: composerBusy, onBlocked: () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi video provider."), mutate: () => setVideoProviderState(provider) });
  const setShowComposer = (value: boolean) => {
    if (!value) { setShowRevoComposer(false); return; }
    openRevoComposerHandler({
      isGenerating: composerBusy,
      captureOpener: captureComposerOpener,
      setVisible: setShowRevoComposer,
      clearError: () => setGenerationError(""),
      onBlocked: () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi mở composer khác."),
    });
  };
  actionContextRef.current = { profileId, profileRevision, clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id };
  const draftActionScope = (draft: Draft): DraftActionScope => ({ ...actionContextRef.current, draftId: draft.id, contentRunId: draft.contentRunId });
  const captureActionOpener = (): HTMLElement | null => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menuTrigger = active?.closest(".row-menu")?.querySelector<HTMLElement>("button.row-more");
    return menuTrigger ?? active;
  };
  const setActiveActionDraft = (draftId: number | undefined) => {
    if (draftId === undefined) { activeActionDraftRef.current = undefined; return; }
    const draft = draftsRef.current.find((item) => item.id === draftId);
    activeActionDraftRef.current = draft ? { scopeKey: draftActionScopeKey(draftActionScope(draft)), draftId } : undefined;
  };
  const draftActionFeedbackFor = (draft: Draft) => draftActionFeedbackRef.current[draftActionScopeKey(draftActionScope(draft))] ?? {};
  const setDraftActionFeedbackFor = (scopeKey: string, action: DraftActionKind, feedback: DraftActionFeedback | undefined) => {
    const current = draftActionFeedbackRef.current;
    const actions = { ...current[scopeKey], [action]: feedback };
    const next = { ...current, [scopeKey]: actions };
    draftActionFeedbackRef.current = next;
    setDraftActionFeedback(next);
  };
  const actionScopeIsCurrent = (scopeKey: string, draftId: number, contentRunId?: string): boolean => draftActionScopeKey({ ...actionContextRef.current, draftId, contentRunId }) === scopeKey
    && draftsRef.current.some((draft) => draft.id === draftId && draftActionScopeKey(draftActionScope(draft)) === scopeKey);
  const setDraftsForAction = (scopeKey: string, draftId: number, contentRunId: string | undefined, update: (draft: Draft) => Draft) => setDrafts((current) => {
    if (!actionScopeIsCurrent(scopeKey, draftId, contentRunId)) return current;
    return current.map((draft) => draft.id === draftId && draftActionScopeKey(draftActionScope(draft)) === scopeKey ? update(draft) : draft);
  });
  const setActionNotice = (scopeKey: string, draftId: number, contentRunId: string | undefined, message: string) => {
    if (actionScopeIsCurrent(scopeKey, draftId, contentRunId) && activeActionDraftRef.current?.scopeKey === scopeKey && activeActionDraftRef.current.draftId === draftId) setQueueNotice(message);
  };
  const setActionSavedNotice = (scopeKey: string, draftId: number, contentRunId: string | undefined, message: string) => {
    if (actionScopeIsCurrent(scopeKey, draftId, contentRunId) && activeActionDraftRef.current?.scopeKey === scopeKey && activeActionDraftRef.current.draftId === draftId) setSavedNotice(message);
  };
  const openTargetActionPrompt = (draft: Draft, action: "publish_now" | "reschedule" | "cancel") => {
    targetActionOpenerRef.current = captureActionOpener();
    setTargetActionPrompt({ draftId: draft.id, action, scopeKey: draftActionScopeKey(draftActionScope(draft)) });
    setTargetActionJobId("");
  };
  const draftActionLocked = (draft: Draft, action?: DraftActionKind): boolean => {
    const scopeKey = draftActionScopeKey(draftActionScope(draft));
    const feedback = draftActionFeedbackFor(draft);
    return Boolean((action !== "publish" && draft.pendingPublicationIds?.length)
      || hasDraftActionInFlight(draftActionInFlightRef.current, scopeKey, ["quality", "approval", "publish"])
      || [feedback.quality, feedback.approval, feedback.publish].some((item) => item?.status === "running" || item?.status === "pending"));
  };
  const runScopedDraftAction = async (id: number, action: DraftActionKind, task: () => Promise<DraftActionOutcome>, allowPendingContinuation = false): Promise<DraftActionOutcome> => {
    const draft = draftsRef.current.find((item) => item.id === id);
    if (!draft) return { status: "failure", message: "Draft không còn trong workspace hiện tại." };
    const scopeKey = draftActionScopeKey(draftActionScope(draft));
    const actions = draftActionFeedbackFor(draft);
    const unresolved = Boolean((action !== "publish" && draft.pendingPublicationIds?.length) || [actions.quality, actions.approval, actions.publish].some((item) => item?.status === "pending"));
    if (unresolved && !allowPendingContinuation) {
      const selection = actions[action];
      if (selection?.status === "pending" && selection.pendingReason === "selection") return { status: "pending", pendingReason: "selection", message: selection.message };
      const message = "Operation đang chờ Control Plane/worker reconciliation; chờ đồng bộ trước khi thử lại.";
      setDraftActionFeedbackFor(scopeKey, action, { status: "pending", pendingReason: "reconciliation", message });
      return { status: "pending", pendingReason: "reconciliation", message };
    }
    if (hasDraftActionInFlight(draftActionInFlightRef.current, scopeKey, ["quality", "approval", "publish"])) {
      return { status: "pending", message: "Thao tác này đã được gửi từ entry point khác; đợi kết quả hiện tại." };
    }
    const lockKey = draftActionLockKey(scopeKey, action);
    const token = beginDraftAction(draftActionInFlightRef.current, lockKey);
    if (!token) return { status: "pending", message: "Thao tác này đã chạy; đợi kết quả hiện tại." };
    setDraftActionFeedbackFor(scopeKey, action, { status: "running", message: action === "quality" ? "Đang chờ Control Plane xác nhận Quality…" : action === "approval" ? "Đang chờ Control Plane và worker xác nhận mọi target…" : "Đang chờ target command được xác nhận…" });
    try {
      const result = await task();
      setDraftActionFeedbackFor(scopeKey, action, result);
      return result;
    } catch (error) {
      const result = { status: "failure" as const, message: error instanceof Error ? error.message : "Thao tác chưa được xác nhận; thử lại sau khi kiểm tra trạng thái." };
      setDraftActionFeedbackFor(scopeKey, action, result);
      return result;
    } finally {
      endDraftAction(draftActionInFlightRef.current, lockKey, token);
    }
  };
  const activeClientId = clientIdForBrand(activeBrandRecord);
  const contentIntelligenceScope = { profileId, clientId: activeClientId, brandId: activeBrandRecord.id };
  contentIntelligenceScopeRef.current = contentIntelligenceScope;
  const activeContentIntelligenceIntakeDrafts = contentIntelligenceIntakeDraftsForScope(contentIntelligenceIntakeDrafts, contentIntelligenceScope);
  const plannerSurfaceIdentity = JSON.stringify([profileId, activeClientId, activeBrandRecord.id, activeNav]);
  if (automationPlannerSurfaceRef.current.identity !== plannerSurfaceIdentity) {
    automationPlannerSurfaceRef.current = { identity: plannerSurfaceIdentity, generation: automationPlannerSurfaceRef.current.generation + 1 };
  }
  const plannerScopeGeneration = automationPlannerSurfaceRef.current.generation;
  const updateAutomationPlannerDraft = (draftKey: string, draft: AutomationPlannerDraftState | undefined, generation: number) => {
    if (generation !== automationPlannerSurfaceRef.current.generation) return;
    const next = { ...automationPlannerDraftsRef.current };
    if (draft) next[draftKey] = draft;
    else delete next[draftKey];
    automationPlannerDraftsRef.current = next;
    setAutomationPlannerDrafts(next);
  };
  const updateAutomationPlannerSelection = (scopeKey: string, planId: string, generation: number) => {
    if (generation !== automationPlannerSurfaceRef.current.generation) return;
    const next = { ...automationPlannerSelectionsRef.current, [scopeKey]: planId };
    automationPlannerSelectionsRef.current = next;
    setAutomationPlannerSelections(next);
  };
  const beginPlannerSave = (draftKey: string, generation: number) => generation === automationPlannerSurfaceRef.current.generation
    ? beginAutomationPlannerSave(automationPlannerRequestIdsRef.current, automationPlannerInFlightRef.current, draftKey)
    : undefined;
  const activeUserId = profileId === "profile-bavy" ? "user-bavy" : profileId;
  const currentMembership = activeMembership(workspaceState, activeUserId);
  const storeContentIntelligenceIntakeDrafts = (next: ContentIntelligenceIntakeDraftMap) => {
    contentIntelligenceIntakeDraftsRef.current = next;
    setContentIntelligenceIntakeDrafts(next);
  };
  function updateContentIntelligenceIntakeDraft<K extends ContentIntelligenceIntakeKind>(kind: K, patch: ContentIntelligenceIntakeDraftPatch<K>) {
    const scope = contentIntelligenceScope;
    const key = contentIntelligenceIntakeDraftKey(scope, kind);
    const current = (contentIntelligenceIntakeDraftsRef.current[key] as unknown as ContentIntelligenceIntakeDraft<K> | undefined) ?? emptyContentIntelligenceIntakeDraft(scope, kind);
    const updated = reviseContentIntelligenceIntakeDraft(current, patch);
    const next: ContentIntelligenceIntakeDraftMap = { ...contentIntelligenceIntakeDraftsRef.current, [key]: updated as unknown as ContentIntelligenceIntakeDraft };
    storeContentIntelligenceIntakeDrafts(next);
  }
  const setIntakeSaveFeedback = (token: ContentIntelligenceIntakeSaveToken, status: "pending" | "success" | "failure", message: string) => {
    const next = contentIntelligenceIntakeDraftsWithFeedback(contentIntelligenceIntakeDraftsRef.current, token, contentIntelligenceIntakeRequestIdsRef.current.get(token.draftKey), status, message);
    if (next !== contentIntelligenceIntakeDraftsRef.current) storeContentIntelligenceIntakeDrafts(next);
  };
  const isCurrentContentIntelligenceScope = (scope: ContentIntelligenceIntakeScope) => contentIntelligenceIntakeDraftKey(scope, "knowledge") === contentIntelligenceIntakeDraftKey(contentIntelligenceScopeRef.current, "knowledge");
  const brandVoice = workspaceState.brandVoiceByBrand[activeBrandRecord?.id ?? ""] ?? restoredSnapshot.brandSystem?.voice ?? defaultBrandSystem.voice;
  const brandVisualTokens: BrandVisualTokens = getBrandVisualTokens(workspaceState, activeBrandRecord?.id ?? "", defaultBrandSystem.visualTokens);
  const activeBrandIdentity = resolveActiveBrandIdentity(activeBrandRecord.id, workspaceState.brandIdentities ?? hydrateLegacyAgencyRecords(workspaceState).identities);
  const activeBrandScope = strategyCatalogScopeForBrand(activeBrandRecord);
  useEffect(() => {
    setWorkspaceState((current) => ensureBrandStrategyCatalog(current, activeBrandScope.clientId, activeBrandScope.brandId));
  }, [activeBrandRecord.id, activeBrandRecord.clientId, activeBrandRecord.workspaceId]);
  useEffect(() => {
    setWorkspaceState((current) => ensureBrandScheduleTemplate(current, activeBrandScope.clientId, activeBrandScope.brandId));
  }, [activeBrandRecord.id, activeBrandRecord.clientId, activeBrandRecord.workspaceId]);
  const activeStrategyCatalog = workspaceState.strategyCatalogsByBrand?.[activeBrandScope.scopeKey];
  const strategyCatalogRequestIdRef = useRef(0);
  const [strategyCatalogRevision, setStrategyCatalogRevision] = useState(0);
  const [strategyCatalogLoading, setStrategyCatalogLoading] = useState(false);
  const [strategyCatalogError, setStrategyCatalogError] = useState("");
  useEffect(() => {
    const { clientId, brandId, scopeKey } = activeBrandScope;
    const requestId = ++strategyCatalogRequestIdRef.current;
    setStrategyCatalogError("");
    setStrategyCatalogRevision(0);
    setStrategyCatalogLoading(Boolean(controlPlaneClient));
    if (!controlPlaneClient) {
      setStrategyCatalogRevision(0);
      setStrategyCatalogLoading(false);
      return;
    }
    let disposed = false;
    void controlPlaneClient.agencyRecovery().then((recovery) => {
      if (disposed || requestId !== strategyCatalogRequestIdRef.current) return;
      const recoveryBrand = recovery.brands.find((item) => String(item.id ?? "") === brandId && String(item.client_id ?? item.clientId ?? "") === clientId);
      const identity = recoveryBrand
        ? recovery.identities.find((item) => String(item.brand_id ?? item.brandId ?? "") === brandId && Boolean(item.is_default ?? item.isDefault) && item.strategyCatalog)
        : undefined;
      const candidate = identity?.strategyCatalog;
      if (!candidate) {
        setStrategyCatalogRevision(Number(identity?.strategyCatalogRevision ?? 0) || 0);
        setStrategyCatalogLoading(false);
        return;
      }
      if (!validateStrategyCatalog(candidate as BrandStrategyCatalog).ok || (candidate as BrandStrategyCatalog).brandId !== brandId) throw new Error("STRATEGY_CATALOG_INVALID");
      const revision = Number(identity?.strategyCatalogRevision ?? 0) || 0;
      setWorkspaceState((current) => !strategyCatalogScopeMatchesState(current, { clientId, brandId, scopeKey }) ? current : { ...current, strategyCatalogsByBrand: { ...(current.strategyCatalogsByBrand ?? {}), [scopeKey]: structuredClone(candidate as BrandStrategyCatalog) } });
      setStrategyCatalogRevision(revision);
      setStrategyCatalogLoading(false);
    }).catch((error) => {
      if (disposed || requestId !== strategyCatalogRequestIdRef.current) return;
      setStrategyCatalogLoading(false);
      setStrategyCatalogError(error instanceof Error ? error.message : "Không thể tải strategy catalog từ Control Plane.");
    });
    return () => { disposed = true; };
  }, [activeBrandRecord.id, activeBrandRecord.clientId, activeBrandRecord.workspaceId, activeWorkspaceRecord.id, agencyMigrationCommitted]);
  refreshTargetPublicationsRef.current = async () => {
    if (!controlPlaneClient) return;
    const rows = await controlPlaneClient.listAgencyRecords("target-publications", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id });
    const summaries = (rows as unknown as Array<Record<string, unknown>>).map((row) => targetPublicationSummary(row));
    summaries.forEach((publication) => {
      publicationByJobRef.current.set(publication.id, publication.id);
      if (publication.workerJobId) {
        publicationByJobRef.current.set(publication.workerJobId, publication.id);
        durableWorkerJobIdsRef.current.add(publication.workerJobId);
      }
    });
    setTargetPublications((current) => [...summaries, ...current.filter((publication) => !summaries.some((row) => row.id === publication.id))]);
    setLoadedTargetPublicationBrandIds((current) => current.includes(activeBrandRecord.id) ? current : [...current, activeBrandRecord.id]);
    setDrafts((current) => current.map((draft) => {
      if (!draft.bindingIds?.length) return draft;
      const publications = summaries.filter((publication) => publication.variantId === `variant-${draft.id}` && (!publication.contentRunId || publication.contentRunId === draft.contentRunId));
      const providerConfirmedBindings = new Set(publications.filter(hasProviderConfirmedPublicationState).map((publication) => publication.bindingId).filter(Boolean));
      return draft.bindingIds.every((bindingId) => providerConfirmedBindings.has(bindingId))
        ? { ...draft, status: "Published", approvalState: "published", time: "Published · provider confirmed" }
        : draft;
    }));
  };
  const mergeRecoveredAgencyState = (current: WorkspaceState, clients: WorkspaceState["workspaces"], brands: WorkspaceState["brands"], identities: BrandIdentityRecord[], bindings: NonNullable<WorkspaceState["channelBindings"]>): WorkspaceState => {
    const mergedBrands = brands.map((brand) => ({ ...current.brands.find((candidate) => candidate.id === brand.id), ...brand }));
    const activeBrandId = mergedBrands.find((brand) => brand.id === current.activeBrandId && brand.workspaceId === current.activeWorkspaceId && !brand.deletedAt && brand.status !== "archived")?.id
      ?? mergedBrands.find((brand) => brand.workspaceId === current.activeWorkspaceId && !brand.deletedAt && brand.status !== "archived")?.id
      ?? "";
    return {
      ...current,
      activeBrandId,
      workspaces: clients.map((client) => ({ ...current.workspaces.find((workspace) => workspace.id === client.id), ...client, brandIds: [...new Set([...(current.workspaces.find((workspace) => workspace.id === client.id)?.brandIds ?? []), ...brands.filter((brand) => brand.workspaceId === client.id).map((brand) => brand.id)])], membershipIds: current.workspaces.find((workspace) => workspace.id === client.id)?.membershipIds ?? [] })),
      brands: mergedBrands,
      brandIdentities: identities,
      channelBindings: bindings,
    };
  };
  useEffect(() => {
    setKnowledgeItems([]);
    setPromptBlueprints([]);
    setResearchEvidence([]);
    setTrendSignals([]);
    setSelectedKnowledgeItemIds([]);
    setSelectedResearchEvidenceIds([]);
    setSelectedPromptBlueprintId("");
    if (!controlPlaneClient) return;
    let disposed = false;
    void controlPlaneClient.agencyRecovery().then((recovery) => {
      if (disposed || recovery.clients.length === 0) return;
      const clients = recovery.clients.map((item) => ({ id: String(item.id), name: String(item.name ?? item.id), clientLabel: "Client", timezone: String(item.timezone ?? "UTC"), brandIds: [], membershipIds: [] }));
      const brands = recovery.brands.map((item) => ({ id: String(item.id), clientId: String(item.client_id ?? item.clientId), workspaceId: String(item.client_id ?? item.clientId), name: String(item.name ?? item.id), systemId: String(item.id), status: (item.status === "archived" ? "archived" : item.status === "draft" ? "draft" : "active") as "active" | "draft" | "archived", ...(item.deletedAt || item.deleted_at ? { deletedAt: String(item.deletedAt ?? item.deleted_at) } : {}) }));
      const identities = recovery.identities.map((item) => sanitizeRecoveredBrandIdentity({ ...item, id: String(item.id), brandId: String(item.brand_id ?? item.brandId), isDefault: Boolean(item.is_default ?? item.isDefault), version: Number(item.version ?? 1), status: (item.status === "archived" ? "archived" : item.status === "draft" ? "draft" : "active") as "active" | "draft" | "archived" } as unknown as BrandIdentityRecord));
      const bindings = recovery.bindings.map((item) => ({ ...item, id: String(item.id), brandId: String(item.brand_id ?? item.brandId), identityId: String(item.identity_id ?? item.identityId), connectionId: String(item.connection_id ?? item.connectionId), targetExternalId: String(item.target_external_id ?? item.targetExternalId), targetName: String(item.target_name ?? item.targetName), platform: (item.platform === "instagram" || item.platform === "tiktok" || item.platform === "youtube" ? item.platform : "facebook") as SocialPlatform, state: (item.state ?? "connected") as "connected" | "not_configured" | "needs_reauth" | "review_required" | "unsupported" }));
      setWorkspaceState((current) => mergeRecoveredAgencyState(current, clients, brands, identities, bindings));
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (!controlPlaneClient || !agencyMigrationCommitted) return;
    let disposed = false;
    void controlPlaneClient.agencyRecovery().then((recovery) => {
      if (!disposed && recovery.clients.length === 0) setAgencyMigrationCommitted(false);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [agencyMigrationCommitted]);
  useEffect(() => {
    if (!controlPlaneClient || agencyMigrationCommitted) return;
    let disposed = false;
    const hydrated = hydrateLegacyAgencyRecords(workspaceState);
    const migration = {
      clients: hydrated.clients.map((item) => ({ id: item.id, name: item.name, timezone: item.timezone, status: "active" })),
      brands: workspaceState.brands.map((brand) => ({ id: brand.id, clientId: brand.clientId ?? brand.workspaceId, name: brand.name, status: brand.status })),
      identities: hydrated.identities.map((item) => item as unknown as Record<string, unknown>),
      connections: [],
      bindings: (workspaceState.channelBindings ?? []).map((binding) => binding as unknown as Record<string, unknown>),
      ...(brandLifecycleActor() ? { migrationActor: brandLifecycleActor() } : {}),
    };
    void runAgencyMigrationSingleFlight(agencyMigrationFlightRef.current, `${profileId}:${profileRevision}`, () => controlPlaneClient.commitAgencyMigration(migration)).then(() => {
      if (!disposed) {
        setAgencyMigrationCommitted(true);
        void controlPlaneClient.agencyRecovery().then((recovery) => {
          if (disposed || recovery.clients.length === 0) return;
          const clients = recovery.clients.map((item) => ({ id: String(item.id), name: String(item.name ?? item.id), clientLabel: "Client", timezone: String(item.timezone ?? "UTC"), brandIds: [], membershipIds: [] }));
          const brands = recovery.brands.map((item) => ({ id: String(item.id), clientId: String(item.client_id ?? item.clientId), workspaceId: String(item.client_id ?? item.clientId), name: String(item.name ?? item.id), systemId: String(item.id), status: (item.status === "archived" ? "archived" : item.status === "draft" ? "draft" : "active") as "active" | "draft" | "archived", ...(item.deletedAt || item.deleted_at ? { deletedAt: String(item.deletedAt ?? item.deleted_at) } : {}) }));
          const identities = recovery.identities.map((item) => sanitizeRecoveredBrandIdentity({ ...item, id: String(item.id), brandId: String(item.brand_id ?? item.brandId), isDefault: Boolean(item.is_default ?? item.isDefault), version: Number(item.version ?? 1), status: (item.status === "archived" ? "archived" : item.status === "draft" ? "draft" : "active") as "active" | "draft" | "archived" } as unknown as BrandIdentityRecord));
          const bindings = recovery.bindings.map((item) => ({ ...item, id: String(item.id), brandId: String(item.brand_id ?? item.brandId), identityId: String(item.identity_id ?? item.identityId), connectionId: String(item.connection_id ?? item.connectionId), targetExternalId: String(item.target_external_id ?? item.targetExternalId), targetName: String(item.target_name ?? item.targetName), platform: (item.platform === "instagram" || item.platform === "tiktok" || item.platform === "youtube" ? item.platform : "facebook") as SocialPlatform, state: (item.state ?? "connected") as "connected" | "not_configured" | "needs_reauth" | "review_required" | "unsupported" }));
          setWorkspaceState((current) => mergeRecoveredAgencyState(current, clients, brands, identities, bindings));
        }).catch(() => undefined);
      }
    }).catch((error) => {
      if (!disposed && error instanceof ControlPlaneError && error.code === "RENDERER_STATE_REPLACEMENT_REJECTED") setAgencyMigrationCommitted(true);
      // Local snapshot remains usable when the migration is temporarily unavailable.
    });
    return () => { disposed = true; };
  }, [agencyMigrationCommitted, profileId, profileRevision, workspaceState]);
  useEffect(() => {
    if (!controlPlaneClient) return;
    let disposed = false;
    void controlPlaneClient.recoverPublicationCommands().catch(() => undefined).then(() => Promise.all([
      controlPlaneClient.listAgencyRecords("knowledge-items", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id }),
      controlPlaneClient.listAgencyRecords("prompt-blueprints", { brandId: activeBrandRecord.id }),
      controlPlaneClient.listAgencyRecords("research-evidence", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id }),
      controlPlaneClient.listAgencyRecords("trend-signals", { clientId: activeWorkspaceRecord.id }),
      controlPlaneClient.listAgencyRecords("analytics-events", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id }),
      controlPlaneClient.listAgencyRecords("content-runs", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id }),
      controlPlaneClient.listAgencyRecords("target-publications", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id }),
      controlPlaneClient.health(),
    ])).then(async ([knowledge, blueprints, evidence, trends, events, contentRuns, publications, health]) => {
      if (disposed) return;
      setKnowledgeItems((knowledge as unknown as KnowledgeItem[]).filter((item) => item.clientId === activeWorkspaceRecord.id && item.brandId === activeBrandRecord.id));
      setPromptBlueprints((blueprints as unknown as PromptBlueprint[]).filter((item) => item.brandId === activeBrandRecord.id));
      setResearchEvidence((evidence as unknown as ResearchEvidence[]).filter((item) => item.clientId === activeWorkspaceRecord.id && (!item.brandId || item.brandId === activeBrandRecord.id)));
      setTrendSignals((trends as unknown as TrendSignal[]).filter((item) => item.clientId === activeWorkspaceRecord.id));
      setAnalyticsEvents(events as unknown as AnalyticsEvent[]);
      const contentRunRows = contentRuns as unknown as Array<Record<string, unknown>>;
      const interruptedRuns = contentRunRows.filter((run) => (run.generationStatus ?? run.generation_status) === "pending");
      const unknownRuns = contentRunRows.filter((run) => (run.generationStatus ?? run.generation_status) === "unknown");
      const reconciledRuns = await Promise.all(interruptedRuns.map(async (run) => {
        try { await controlPlaneClient.updateAgencyEntity("content-runs", String(run.id), { generationStatus: reconcilePendingGeneration({ generationStatus: "pending" as ContentRun["generationStatus"] }).generationStatus }); return true; }
        catch { return false; }
      }));
      const generationRecoveryNotice = interruptedRuns.length || unknownRuns.length ? reconciledRuns.every(Boolean) ? `${interruptedRuns.length + unknownRuns.length} Content Run có outcome unknown; cần đối soát trước khi thử lại.` : "Một số Content Run vẫn còn pending trong Control Plane; outcome unknown, không thử lại tự động và cần reconciliation." : "";
      setDrafts((current) => current.map((draft) => {
        const runId = draft.contentRunId ?? `content-${draft.id}`;
        const revisionRuns = contentRunRows.filter((candidate) => String(candidate.parentContentRunId ?? candidate.parent_content_run_id ?? "") === runId)
          .sort((left, right) => String(left.revisionCreatedAt ?? left.revision_created_at ?? "").localeCompare(String(right.revisionCreatedAt ?? right.revision_created_at ?? "")));
        const run = revisionRuns[revisionRuns.length - 1] ?? contentRunRows.find((candidate) => String(candidate.id ?? "") === runId);
        if (!run) return draft;
        const storedStatus = String(run.generationStatus ?? run.generation_status ?? "") as ContentRun["generationStatus"];
        const generationStatus = reconcilePendingGeneration({ generationStatus: storedStatus }).generationStatus;
        const restoredMedia = restoreContentRunMediaEvidence(run, `variant-${draft.id}`);
        const lineageRestore = restoreContentRunLineage(run, `variant-${draft.id}`);
        const restoredLineage = lineageRestore?.ok ? lineageRestore.value : undefined;
        const lineageMissing = lineageRestore && !lineageRestore.ok ? lineageRestore : undefined;
        const rawMediaRevision = run.mediaRevision ?? run.media_revision ?? run.contentRunRevision ?? run.content_run_revision;
        const runMediaRevision = typeof rawMediaRevision === "number" && Number.isSafeInteger(rawMediaRevision) && rawMediaRevision >= 0 ? rawMediaRevision : undefined;
        if (!generationStatus && !restoredMedia && !restoredLineage && !lineageMissing && runMediaRevision === undefined) return draft;
        if (lineageMissing) return {
          ...draft,
          generationStatus: "unknown",
          rewriteStatus: "unknown",
          rewriteError: `${lineageMissing.code}:${lineageMissing.missingFields.join(",")}`,
          status: "Needs review",
          approvalState: "proposed",
          qualityStatus: "pending",
          qualityChecks: undefined,
          time: "Content Intelligence lineage incomplete · reconciliation required",
          ...(runMediaRevision !== undefined ? { mediaRevision: runMediaRevision } : {}),
        };
        const isChildRevision = String(run.id ?? "") !== runId;
        const outputVariant = Array.isArray(run.variants) ? run.variants.find((variant: unknown) => variant && typeof variant === "object" && String((variant as Record<string, unknown>).id ?? "") === `variant-${draft.id}`) as Record<string, unknown> | undefined : undefined;
        const recoveredBody = typeof run.body === "string" && run.body.trim() ? run.body : typeof run.caption === "string" && run.caption.trim() ? run.caption : typeof outputVariant?.body === "string" ? outputVariant.body : "";
        const recoveredTitle = typeof run.topic === "string" && run.topic.trim() ? run.topic : typeof outputVariant?.title === "string" && outputVariant.title.trim() ? outputVariant.title : draft.title;
        const recoveredStrategySnapshot = (run.strategySnapshot ?? run.strategy_snapshot ?? outputVariant?.strategySnapshot ?? outputVariant?.strategy_snapshot) as StrategySnapshot | undefined;
        const recoveredContentPillar = typeof run.contentPillar === "string" ? run.contentPillar : typeof run.content_pillar === "string" ? run.content_pillar : typeof outputVariant?.contentPillar === "string" ? outputVariant.contentPillar : typeof outputVariant?.content_pillar === "string" ? outputVariant.content_pillar : draft.contentPillar;
        const recoveredObjective = typeof run.objective === "string" ? run.objective : typeof outputVariant?.objective === "string" ? outputVariant.objective : draft.objective;
        const recoveredContentAngle = typeof run.contentAngle === "string" ? run.contentAngle : typeof run.content_angle === "string" ? run.content_angle : typeof outputVariant?.contentAngle === "string" ? outputVariant.contentAngle : typeof outputVariant?.content_angle === "string" ? outputVariant.content_angle : draft.contentAngle;
        const recoveredStrategyVersion = typeof run.strategyVersion === "number" ? run.strategyVersion : typeof run.strategy_version === "number" ? run.strategy_version : typeof outputVariant?.strategyVersion === "number" ? outputVariant.strategyVersion : draft.strategyVersion;
        const recoveredStrategyState = (run.strategyState ?? run.strategy_state ?? run.regenerationState ?? run.regeneration_state) === "needs_regeneration" ? "needs_regeneration" as const : draft.strategyState ?? draft.regenerationState;
        const recoveredVariantMetadata = outputVariant?.metadata && typeof outputVariant.metadata === "object" && !Array.isArray(outputVariant.metadata) ? outputVariant.metadata as Record<string, unknown> : {};
        const recoveredAssetText = (key: string, snake: string) => typeof run[key] === "string" ? run[key] as string : typeof recoveredVariantMetadata[key] === "string" ? recoveredVariantMetadata[key] as string : typeof recoveredVariantMetadata[snake] === "string" ? recoveredVariantMetadata[snake] as string : undefined;
        const history = Array.isArray(run.revisionHistory) ? run.revisionHistory as NonNullable<Draft["revisionHistory"]> : draft.revisionHistory;
        const runRevisionId = typeof run.revisionId === "string" && run.revisionId.trim() ? run.revisionId : undefined;
        const runParentRevisionId = typeof run.parentRevisionId === "string" && run.parentRevisionId.trim() ? run.parentRevisionId : undefined;
        if (isChildRevision && generationStatus === "completed" && recoveredBody) return {
          ...draft,
          contentRunId: String(run.id), title: recoveredTitle, topic: recoveredTitle, body: recoveredBody,
          ...(recoveredContentPillar ? { contentPillar: recoveredContentPillar } : {}), ...(recoveredObjective ? { objective: recoveredObjective as Draft["objective"] } : {}), ...(recoveredContentAngle ? { contentAngle: recoveredContentAngle } : {}), ...(recoveredStrategyVersion !== undefined ? { strategyVersion: recoveredStrategyVersion } : {}), ...(recoveredStrategySnapshot ? { strategySnapshot: recoveredStrategySnapshot } : {}), ...(recoveredStrategyState ? { strategyState: recoveredStrategyState, regenerationState: recoveredStrategyState } : {}), ...(recoveredAssetText("imageConcept", "image_concept") ? { imageConcept: recoveredAssetText("imageConcept", "image_concept") } : {}), ...(recoveredAssetText("imagePrompt", "image_prompt") ? { imagePrompt: recoveredAssetText("imagePrompt", "image_prompt") } : {}), ...(recoveredAssetText("videoConcept", "video_concept") ? { videoConcept: recoveredAssetText("videoConcept", "video_concept") } : {}), ...(recoveredAssetText("videoPrompt", "video_prompt") ? { videoPrompt: recoveredAssetText("videoPrompt", "video_prompt") } : {}), ...(recoveredAssetText("strategyRationale", "strategy_rationale") ? { strategyRationale: recoveredAssetText("strategyRationale", "strategy_rationale") } : {}),
          providerTraceId: typeof run.providerTraceId === "string" ? run.providerTraceId : draft.providerTraceId,
          revisionId: runRevisionId ?? String(run.id),
          parentRevisionId: runParentRevisionId,
          requestId: typeof run.requestId === "string" ? run.requestId : undefined,
          ...(runMediaRevision !== undefined ? { mediaRevision: runMediaRevision } : {}),
          revisionHistory: history, generationStatus: "completed", rewriteStatus: "ready_for_review", rewriteError: undefined,
          status: "Needs review", approvalState: "proposed", qualityStatus: "pending", qualityChecks: undefined,
          time: "Đã khôi phục bản chữ đã lưu · cần kiểm tra và duyệt lại", ...(restoredMedia ?? {}), ...(restoredLineage ?? {}),
        };
        return {
          ...draft,
          ...(runRevisionId ? { revisionId: runRevisionId } : {}),
          ...(runParentRevisionId ? { parentRevisionId: runParentRevisionId } : {}),
          ...(runMediaRevision !== undefined ? { mediaRevision: runMediaRevision } : {}),
          ...(recoveredContentPillar ? { contentPillar: recoveredContentPillar } : {}), ...(recoveredObjective ? { objective: recoveredObjective as Draft["objective"] } : {}), ...(recoveredContentAngle ? { contentAngle: recoveredContentAngle } : {}), ...(recoveredStrategyVersion !== undefined ? { strategyVersion: recoveredStrategyVersion } : {}), ...(recoveredStrategySnapshot ? { strategySnapshot: recoveredStrategySnapshot } : {}), ...(recoveredStrategyState ? { strategyState: recoveredStrategyState, regenerationState: recoveredStrategyState } : {}), ...(recoveredAssetText("imageConcept", "image_concept") ? { imageConcept: recoveredAssetText("imageConcept", "image_concept") } : {}), ...(recoveredAssetText("imagePrompt", "image_prompt") ? { imagePrompt: recoveredAssetText("imagePrompt", "image_prompt") } : {}), ...(recoveredAssetText("videoConcept", "video_concept") ? { videoConcept: recoveredAssetText("videoConcept", "video_concept") } : {}), ...(recoveredAssetText("videoPrompt", "video_prompt") ? { videoPrompt: recoveredAssetText("videoPrompt", "video_prompt") } : {}), ...(recoveredAssetText("strategyRationale", "strategy_rationale") ? { strategyRationale: recoveredAssetText("strategyRationale", "strategy_rationale") } : {}),
          ...(isChildRevision ? {
            revisionId: runRevisionId ?? String(run.id),
            parentRevisionId: runParentRevisionId,
            requestId: typeof run.requestId === "string" ? run.requestId : undefined,
            revisionHistory: history,
            rewriteStatus: generationStatus === "unknown" || generationStatus === "pending" ? "unknown" as const : generationStatus === "failed" ? "failed" as const : draft.rewriteStatus,
            rewriteError: generationStatus === "unknown" || generationStatus === "pending" ? "REWRITE_OUTCOME_REQUIRES_RECONCILIATION" : draft.rewriteError,
          } : {}),
          ...(generationStatus ? { generationStatus, ...(generationStatus === "unknown" ? { time: "Generation outcome unknown · reconciliation required before retry" } : {}) } : {}),
          ...(restoredMedia ?? {}),
          ...(restoredLineage ?? {}),
        };
      }));
      const publicationRows = publications as unknown as Array<Record<string, unknown>>;
      let summaries = publicationRows.map((item) => targetPublicationSummary(item));
      const replayHandledDraftIds = new Set<number>();
      const rememberPublications = (items: TargetPublicationSummary[]) => items.forEach((publication) => {
        publicationByJobRef.current.set(publication.id, publication.id);
        if (publication.workerJobId) {
          publicationByJobRef.current.set(publication.workerJobId, publication.id);
          durableWorkerJobIdsRef.current.add(publication.workerJobId);
        }
      });
      for (const draft of draftsRef.current.filter((candidate) => candidate.status === "Needs review" && candidate.qualityStatus === "passed" && !candidate.pendingPublicationIds?.length)) {
        const runId = draft.contentRunId ?? `content-${draft.id}`;
        const run = contentRunRows.find((candidate) => String(candidate.id ?? "") === runId);
        const intentsValue = run?.targetApprovalIntents ?? run?.target_approval_intents;
        if (run?.targetApprovalState !== "pending" && run?.target_approval_state !== "pending") continue;
        if (!Array.isArray(intentsValue) || intentsValue.length === 0) continue;
        const intents = intentsValue.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)));
        const publicationIds = intents.map((intent) => String(intent.id ?? "")).filter(Boolean);
        if (publicationIds.length !== intents.length || publicationIds.every((publicationId) => summaries.some((publication) => publication.id === publicationId))) continue;
        replayHandledDraftIds.add(draft.id);
        const bindingIds = intents.map((intent) => String(intent.bindingId ?? "")).filter(Boolean);
        const planId = String(run.planId ?? run.plan_id ?? draft.planId ?? "") || undefined;
        try {
          const replay = await controlPlaneClient.approveTargetPublications(intents);
          if (disposed) return;
          const replayed = replay.acknowledged.map((record) => targetPublicationSummary(record));
          const allAcknowledged = replay.complete && replayed.length === intents.length && targetPublicationBindingsAcknowledged(replayed, bindingIds);
          if (allAcknowledged) {
            try {
              await controlPlaneClient.updateAgencyEntity("content-runs", runId, { state: "scheduled", approvalState: "approved", qualityStatus: "passed", scheduledAt: replayed[0]?.scheduledAt, planId, targetBindingIds: bindingIds, bindingIds, targetApprovalState: "acknowledged" });
              const jobIds = targetJobIdsForDraft({ ...draft, contentRunId: runId }, replayed);
              setDrafts((current) => current.map((candidate) => candidate.id === draft.id ? { ...candidate, contentRunId: runId, bindingIds, planId, queueJobIds: jobIds, queueJobId: jobIds.length === 1 ? jobIds[0] : undefined, scheduledAt: replayed[0]?.scheduledAt, status: "Scheduled", approvalState: "ready", time: `Khôi phục sau khi gửi target còn thiếu · ${jobIds.length} target đã xác nhận` } : candidate));
            } catch (error) {
              setDrafts((current) => current.map((candidate) => candidate.id === draft.id ? { ...candidate, contentRunId: runId, bindingIds, planId, pendingPublicationIds: publicationIds, pendingApprovalCompensation: true, time: "Content Run recovery needs reconciliation" } : candidate));
              setQueueNotice(error instanceof Error ? `Content Run recovery needs reconciliation: ${error.message}` : "Content Run recovery needs reconciliation; approved targets are being canceled.");
            }
          } else {
            const pendingApprovalCommands = replay.results.some((result) => result.status === "pending");
            const terminalFailure = replay.failed.length > 0 && replay.pending.length === 0 && replay.compensated;
            if (terminalFailure) {
              await controlPlaneClient.updateAgencyEntity("content-runs", runId, { state: "needs_review", approvalState: "pending", targetApprovalState: "failed" }).catch(() => undefined);
            } else {
              setDrafts((current) => current.map((candidate) => candidate.id === draft.id ? { ...candidate, contentRunId: runId, bindingIds, planId, pendingPublicationIds: publicationIds, pendingApprovalCompensation: !pendingApprovalCommands && !replay.compensated, time: "Control Plane recovery is reconciling every target" } : candidate));
            }
            setQueueNotice(replay.failureCode ? `Recovered target approval is pending: ${replay.failureCode}` : "Recovered target approval is still reconciling.");
          }
          const refreshed = await controlPlaneClient.listAgencyRecords("target-publications", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id });
          summaries = (refreshed as unknown as Array<Record<string, unknown>>).map((row) => targetPublicationSummary(row));
        } catch (error) {
          setDrafts((current) => current.map((candidate) => candidate.id === draft.id ? { ...candidate, contentRunId: runId, bindingIds, planId, pendingPublicationIds: publicationIds, pendingApprovalCompensation: false, time: "Saved target intent is being replayed after Control Plane recovery" } : candidate));
          setQueueNotice(error instanceof Error ? `Saved target intent replay is pending: ${error.message}` : "Saved target intent replay is pending.");
        }
      }
      rememberPublications(summaries);
      setTargetPublications(summaries);
      setLoadedTargetPublicationBrandIds((current) => current.includes(activeBrandRecord.id) ? current : [...current, activeBrandRecord.id]);
      if (summaries.some((publication) => publication.pendingCommandId || publication.commandStatus === "pending" || publication.workerAckState === "reconciliation_required")) setQueueNotice("Một số target publication đang chờ Control Plane và worker đồng bộ.");
      const availableDrafts = draftsRef.current.filter((draft) => draft.status === "Needs review" && draft.qualityStatus === "passed" && !draft.pendingPublicationIds?.length && !replayHandledDraftIds.has(draft.id));
      for (const draft of availableDrafts) {
        const runId = draft.contentRunId ?? `content-${draft.id}`;
        const run = contentRunRows.find((candidate) => String(candidate.id ?? "") === runId);
        const recordBindings = run?.targetBindingIds ?? run?.target_binding_ids ?? run?.bindingIds ?? run?.binding_ids;
        const bindingIds = Array.isArray(recordBindings) ? recordBindings.map(String).filter(Boolean) : draft.bindingIds ?? [];
        if (!run || bindingIds.length === 0) continue;
        const planId = String(run.planId ?? run.plan_id ?? draft.planId ?? "") || undefined;
        const targets = summaries.filter((publication) => publication.variantId === `variant-${draft.id}` && (!publication.contentRunId || publication.contentRunId === runId) && bindingIds.includes(publication.bindingId ?? ""));
        if (targetPublicationBindingsAcknowledged(targets, bindingIds)) {
          try {
            const scheduledAt = targets[0]?.scheduledAt;
            await controlPlaneClient.updateAgencyEntity("content-runs", runId, { state: "scheduled", approvalState: "approved", qualityStatus: "passed", scheduledAt, planId, targetBindingIds: bindingIds, bindingIds });
            const jobIds = targetJobIdsForDraft({ ...draft, contentRunId: runId }, targets);
            setDrafts((current) => current.map((candidate) => candidate.id === draft.id ? { ...candidate, contentRunId: runId, bindingIds, planId, queueJobIds: jobIds, queueJobId: jobIds.length === 1 ? jobIds[0] : undefined, scheduledAt, status: "Scheduled", approvalState: "ready", time: `Đã khôi phục lịch · ${jobIds.length} target đã được xác nhận` } : candidate));
          } catch (error) {
            setDrafts((current) => current.map((candidate) => candidate.id === draft.id ? { ...candidate, contentRunId: runId, bindingIds, planId, pendingPublicationIds: targets.map((publication) => publication.id), pendingApprovalCompensation: true, time: "Content Run schedule persistence needs reconciliation" } : candidate));
            setQueueNotice(error instanceof Error ? `Content Run recovery needs reconciliation: ${error.message}` : "Content Run recovery needs reconciliation; approved targets are being canceled.");
          }
        } else if (targets.some((publication) => publication.pendingCommandId || publication.commandStatus === "pending" || ["pending", "unknown", "reconciliation_required"].includes(publication.workerAckState ?? ""))) {
          setDrafts((current) => current.map((candidate) => candidate.id === draft.id ? { ...candidate, contentRunId: runId, bindingIds, planId, pendingPublicationIds: targets.map((publication) => publication.id), pendingApprovalCompensation: false, time: "Control Plane approval đang được đối soát" } : candidate));
        } else if (targets.length > 0 && targets.some((publication) => publication.commandStatus === "failed" || ["approval_failed", "failed", "permanent_error"].includes(publication.state))) {
          const scheduledSibling = targets.some((publication) => publication.state === "scheduled" && publication.commandStatus === "acknowledged");
          if (scheduledSibling) setDrafts((current) => current.map((candidate) => candidate.id === draft.id ? { ...candidate, contentRunId: runId, bindingIds, planId, pendingPublicationIds: targets.map((publication) => publication.id), pendingApprovalCompensation: true, time: "Fan-out failed after restart · reconciliation required" } : candidate));
          else if (targets.every((publication) => ["canceled", "cancelled", "failed", "permanent_error", "approval_failed"].includes(publication.state) && !publication.pendingCommandId)) await controlPlaneClient.updateAgencyEntity("content-runs", runId, { state: "needs_review", approvalState: "pending", planId, targetBindingIds: bindingIds, bindingIds, targetApprovalState: "failed" }).catch(() => undefined);
        }
      }
      const publishedVariants = new Set(summaries.filter(hasProviderConfirmedPublicationState).map((publication) => publication.variantId ?? ""));
      if (publishedVariants.size > 0) setDrafts((current) => current.map((draft) => publishedVariants.has(`variant-${draft.id}`) ? { ...draft, status: "Published", approvalState: "published", time: "Published · provider confirmed" } : draft));
      if (generationRecoveryNotice) setQueueNotice(generationRecoveryNotice);
      setControlPlaneHealth({ dataAsOf: health.dataAsOf, workerReconciledAt: health.workerReconciledAt });
    }).catch(() => {
      if (!disposed) {
        setKnowledgeItems([]);
        setPromptBlueprints([]);
        setResearchEvidence([]);
        setTrendSignals([]);
        setSelectedKnowledgeItemIds([]);
        setSelectedResearchEvidenceIds([]);
        setSelectedPromptBlueprintId("");
        setAnalyticsEvents([]);
        setTargetPublications([]);
        setLoadedTargetPublicationBrandIds((current) => current.filter((id) => id !== activeBrandRecord.id));
        setControlPlaneHealth({});
      }
    });
    return () => { disposed = true; };
  }, [activeBrandRecord.id, activeWorkspaceRecord.id]);
  const pendingApprovalSyncKey = drafts.filter((draft) => draft.pendingPublicationIds?.length).map((draft) => `${draft.id}:${draft.pendingApprovalCompensation ? "compensate:" : "await:"}${draft.pendingPublicationIds?.join(",")}`).join("|");
  const pendingPublicationCommandKey = targetPublications.filter((publication) => publication.pendingCommandId || ["pending", "unknown"].includes(publication.commandStatus ?? "") || ["pending", "unknown", "reconciliation_required"].includes(publication.workerAckState ?? "")).map((publication) => `${publication.id}:${publication.revision ?? "?"}`).join("|");
  const durablePublicationSyncKey = [pendingApprovalSyncKey, pendingPublicationCommandKey].filter(Boolean).join(";");
  useEffect(() => {
    if (!controlPlaneClient || !durablePublicationSyncKey) return;
    let disposed = false;
    const syncPendingApprovals = async () => {
      try {
        await controlPlaneClient.recoverPublicationCommands();
        const [rows, contentRuns] = await Promise.all([
          controlPlaneClient.listAgencyRecords("target-publications", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id }),
          controlPlaneClient.listAgencyRecords("content-runs", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id }),
        ]);
        if (disposed) return;
        let summaries = (rows as unknown as Array<Record<string, unknown>>).map((row) => targetPublicationSummary(row));
        const contentRunRows = contentRuns as unknown as Array<Record<string, unknown>>;
        const currentDrafts = draftsRef.current;
        let approvalRecoveredByReplay = false;
        for (const draft of currentDrafts.filter((candidate) => candidate.pendingPublicationIds?.length && !candidate.pendingApprovalCompensation)) {
          const runId = draft.contentRunId ?? `content-${draft.id}`;
          const run = contentRunRows.find((candidate) => String(candidate.id ?? "") === runId);
          const intentsValue = run?.targetApprovalIntents ?? run?.target_approval_intents;
          if (run?.targetApprovalState !== "pending" && run?.target_approval_state !== "pending") continue;
          if (!Array.isArray(intentsValue)) continue;
          const intents = intentsValue.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)));
          const intentIds = intents.map((intent) => String(intent.id ?? "")).filter(Boolean);
          if (intents.length === 0 || intentIds.every((id) => summaries.some((publication) => publication.id === id))) continue;
          if (pendingApprovalReplayInFlightRef.current.has(runId)) continue;
          pendingApprovalReplayInFlightRef.current.add(runId);
          try {
            const replay = await controlPlaneClient.approveTargetPublications(intents);
            const replayed = replay.acknowledged.map((record) => targetPublicationSummary(record));
            const bindingIds = draft.bindingIds?.length ? draft.bindingIds : intents.map((intent) => String(intent.bindingId ?? "")).filter(Boolean);
            if (replay.complete && replayed.length === intents.length && targetPublicationBindingsAcknowledged(replayed, bindingIds)) {
              try {
                const planId = String(run.planId ?? run.plan_id ?? draft.planId ?? "") || undefined;
                await controlPlaneClient.updateAgencyEntity("content-runs", runId, { state: "scheduled", approvalState: "approved", qualityStatus: "passed", scheduledAt: replayed[0]?.scheduledAt, planId, targetBindingIds: bindingIds, bindingIds, targetApprovalState: "acknowledged" });
                const jobIds = targetJobIdsForDraft({ ...draft, contentRunId: runId }, replayed);
                setDrafts((current) => current.map((candidate) => candidate.id === draft.id ? { ...candidate, contentRunId: runId, bindingIds, planId, pendingPublicationIds: undefined, pendingApprovalCompensation: undefined, queueJobIds: jobIds, queueJobId: jobIds.length === 1 ? jobIds[0] : undefined, scheduledAt: replayed[0]?.scheduledAt, status: "Scheduled", approvalState: "ready", time: `Recovered ${jobIds.length} approved targets` } : candidate));
                approvalRecoveredByReplay = true;
              } catch (error) {
                setDrafts((current) => current.map((candidate) => candidate.id === draft.id ? { ...candidate, pendingApprovalCompensation: true, time: "Content Run recovery needs reconciliation" } : candidate));
                setQueueNotice(error instanceof Error ? `Content Run recovery needs reconciliation: ${error.message}` : "Content Run recovery needs reconciliation.");
              }
            }
            const refreshed = await controlPlaneClient.listAgencyRecords("target-publications", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id });
            summaries = (refreshed as unknown as Array<Record<string, unknown>>).map((row) => targetPublicationSummary(row));
          } catch {
            // Stable Content Run intents are replayed on the next recovery poll.
          } finally {
            pendingApprovalReplayInFlightRef.current.delete(runId);
          }
        }
        summaries.forEach((publication) => {
          publicationByJobRef.current.set(publication.id, publication.id);
          if (publication.workerJobId) {
            publicationByJobRef.current.set(publication.workerJobId, publication.id);
            durableWorkerJobIdsRef.current.add(publication.workerJobId);
          }
        });
        setTargetPublications((current) => [...summaries, ...current.filter((publication) => !summaries.some((row) => row.id === publication.id))]);
        let stillPending = summaries.some((publication) => publication.pendingCommandId || publication.commandStatus === "pending" || ["pending", "unknown", "reconciliation_required"].includes(publication.workerAckState ?? ""));
        let compensationFinished = false;
        const compensatedContentRuns = new Set<number>();
        for (const draft of currentDrafts.filter((candidate) => candidate.pendingApprovalCompensation && candidate.pendingPublicationIds?.length)) {
          const targetRows = draft.pendingPublicationIds!.map((id) => summaries.find((publication) => publication.id === id));
          if (targetRows.some((publication) => !publication)) continue;
          const terminal = (targetRows as TargetPublicationSummary[]).every((publication) => ["canceled", "cancelled", "failed", "permanent_error", "approval_failed"].includes(publication.state) && !publication.pendingCommandId && !["pending", "reconciliation_required"].includes(publication.workerAckState ?? ""));
          if (!terminal) continue;
          const contentRunId = draft.contentRunId ?? `content-${draft.id}`;
          try {
            await controlPlaneClient.updateAgencyEntity("content-runs", contentRunId, { state: "needs_review", approvalState: "pending", planId: draft.planId, targetBindingIds: draft.bindingIds, bindingIds: draft.bindingIds, targetApprovalState: "failed" });
            compensatedContentRuns.add(draft.id);
          } catch {
            stillPending = true;
          }
        }
        const approvalRecovered = approvalRecoveredByReplay || currentDrafts.some((draft) => !draft.pendingApprovalCompensation && Boolean(draft.pendingPublicationIds?.length) && draft.pendingPublicationIds!.every((id) => {
          const publication = summaries.find((candidate) => candidate.id === id);
          return Boolean(publication && !publication.legacyNonLive && publication.state === "scheduled" && publication.commandStatus === "acknowledged" && !publication.pendingCommandId && ["acknowledged", "confirmed", "accepted"].includes(publication.workerAckState ?? ""));
        }));
        for (const draft of currentDrafts.filter((candidate) => candidate.pendingApprovalCompensation && candidate.pendingPublicationIds?.length)) {
          const publications = draft.pendingPublicationIds!.map((id) => summaries.find((publication) => publication.id === id));
          if (publications.some((publication) => !publication)) { stillPending = true; continue; }
          const found = publications as TargetPublicationSummary[];
          const pendingStates = new Set(["pending", "reconciliation_required"]);
          const cancelTargets = found.filter((publication) => !publication.legacyNonLive && publication.state === "scheduled" && publication.commandStatus === "acknowledged" && !publication.pendingCommandId && !pendingStates.has(publication.workerAckState ?? "") && ["acknowledged", "confirmed", "accepted"].includes(publication.workerAckState ?? ""));
          await Promise.all(cancelTargets.map(async (publication) => {
            if (!Number.isSafeInteger(publication.revision)) { stillPending = true; return; }
            const key = `${publication.id}:${publication.revision}`;
            if (pendingCompensationInFlightRef.current.has(key)) { stillPending = true; return; }
            pendingCompensationInFlightRef.current.add(key);
            try {
              const result = await controlPlaneClient.targetPublicationCommand(publication.id, {
                action: "cancel", clientId: publication.clientId, brandId: publication.brandId,
                expectedRevision: publication.revision,
                requestId: `c2-fanout-compensate-${publication.id.replace(/[^A-Za-z0-9_.:-]/g, "_")}-${publication.revision}`,
              });
              const parsed = targetPublicationSummary(result);
              const updated = { ...publication, ...Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined && value !== "")) } as TargetPublicationSummary;
              setTargetPublications((current) => current.map((candidate) => candidate.id === publication.id ? updated : candidate));
              if (result.commandStatus !== "acknowledged") stillPending = true;
            } catch {
              stillPending = true;
            } finally {
              pendingCompensationInFlightRef.current.delete(key);
            }
          }));
        }
        setDrafts((current) => current.map((draft) => {
          const ids = draft.pendingPublicationIds;
          if (!ids?.length) return draft;
          const publications = ids.map((id) => summaries.find((publication) => publication.id === id));
          if (publications.some((publication) => !publication)) { stillPending = true; return draft; }
          const found = publications as TargetPublicationSummary[];
          if (draft.bindingIds?.length && new Set(found.map((publication) => publication.bindingId).filter(Boolean)).size !== new Set(draft.bindingIds).size) { stillPending = true; return draft; }
          const safeTerminal = found.every((publication) => ["canceled", "cancelled", "failed", "permanent_error", "approval_failed"].includes(publication.state) && !publication.pendingCommandId && !["pending", "reconciliation_required"].includes(publication.workerAckState ?? ""));
          if (safeTerminal) {
            if (draft.pendingApprovalCompensation && !compensatedContentRuns.has(draft.id)) { stillPending = true; return draft; }
            compensationFinished = true;
            return { ...draft, pendingPublicationIds: undefined, pendingApprovalCompensation: undefined, status: "Needs review", approvalState: "proposed", queueJobId: undefined, queueJobIds: [], time: "Target approval đã được bù trừ; cần duyệt lại" };
          }
          if (found.some((publication) => publication.commandStatus === "pending" || publication.pendingCommandId || ["pending", "reconciliation_required"].includes(publication.workerAckState ?? ""))) { stillPending = true; return draft; }
          if (draft.pendingApprovalCompensation) { stillPending = true; return draft; }
          if (found.some((publication) => publication.commandStatus === "failed" || ["failed", "permanent_error", "approval_failed"].includes(publication.state))) {
            stillPending = true;
            return { ...draft, pendingApprovalCompensation: true, status: "Needs review", approvalState: "proposed", time: "Một target approval thất bại; đang hủy mọi target đã xác nhận" };
          }
          if (found.some((publication) => publication.state === "canceled" || publication.state === "cancelled") && found.some((publication) => publication.state === "scheduled" && publication.commandStatus === "acknowledged")) {
            stillPending = true;
            return { ...draft, pendingApprovalCompensation: true, status: "Needs review", approvalState: "proposed", time: "Fan-out không đồng nhất; đang hủy target đã xác nhận" };
          }
          const expectedBindingIds = draft.bindingIds?.length ? draft.bindingIds : found.map((publication) => publication.bindingId ?? "");
          const allAcknowledged = found.length === expectedBindingIds.length && targetPublicationBindingsAcknowledged(found, expectedBindingIds);
          if (!allAcknowledged) { stillPending = true; return draft; }
          const jobIds = targetJobIdsForDraft(draft, found);
          return { ...draft, pendingPublicationIds: undefined, pendingApprovalCompensation: undefined, queueJobIds: jobIds, queueJobId: jobIds.length === 1 ? jobIds[0] : undefined, scheduledAt: found[0]?.scheduledAt, status: "Scheduled", approvalState: "ready", time: `Đã được Control Plane và worker xác nhận · ${jobIds.length} target` };
        }));
        setDrafts((current) => current.map((draft) => {
          if (draft.pendingPublicationIds?.length || !draft.bindingIds?.length) return draft;
          const targets = summaries.filter((publication) => publication.variantId === `variant-${draft.id}` && draft.bindingIds?.includes(publication.bindingId ?? ""));
          if (targets.length !== draft.bindingIds.length) return draft;
          if (targetPublicationBindingsAcknowledged(targets, draft.bindingIds)) {
            const jobIds = targetJobIdsForDraft(draft, targets);
            return { ...draft, queueJobIds: jobIds, queueJobId: jobIds.length === 1 ? jobIds[0] : undefined, scheduledAt: targets[0]?.scheduledAt, status: "Scheduled", approvalState: "ready", time: `Đã đồng bộ ${jobIds.length} target từ Control Plane` };
          }
          if (targets.every(hasProviderConfirmedPublicationState)) return { ...draft, status: "Published", approvalState: "published", time: "Published · provider confirmed" };
          if (targets.every((publication) => ["canceled", "cancelled", "failed", "permanent_error", "approval_failed"].includes(publication.state)) && draft.status === "Scheduled") return { ...draft, status: "Needs review", approvalState: "proposed", queueJobIds: [], queueJobId: undefined, time: "Đã hủy lịch · cần duyệt lại" };
          return draft;
        }));
        if (stillPending) setQueueNotice("Target approval vẫn đang chờ Control Plane/worker reconciliation; draft chưa chuyển Scheduled.");
        else if (compensationFinished) setQueueNotice("Control Plane đã xác nhận bù trừ mọi target; draft vẫn ở trạng thái cần duyệt lại.");
        else if (approvalRecovered) setQueueNotice("Control Plane và worker đã xác nhận mọi target sau recovery; draft đã chuyển Scheduled.");
        else if (pendingPublicationCommandKey) setQueueNotice((current) => /reconciliation|đang chờ Control Plane/i.test(current) ? "Control Plane và worker đã đồng bộ lại target publication." : current);
      } catch (error) {
        if (!disposed) setQueueNotice(error instanceof Error ? `Reconciliation pending: ${error.message}` : "Reconciliation pending; draft chưa chuyển Scheduled.");
      }
    };
    void syncPendingApprovals();
    const intervalId = window.setInterval(() => { void syncPendingApprovals(); }, 5000);
    return () => { disposed = true; window.clearInterval(intervalId); };
  }, [activeBrandRecord.id, activeWorkspaceRecord.id, controlPlaneClient, durablePublicationSyncKey, pendingPublicationCommandKey]);
  useEffect(() => {
    if (!controlPlaneClient || !agencyMigrationCommitted) return;
    const profileKey = `${profileId}:${profileRevision}`;
    if (actorBindingBackfillDoneRef.current.has(profileKey) || actorBindingBackfillInFlightRef.current.has(profileKey)) return;
    actorBindingBackfillInFlightRef.current.add(profileKey);
    void controlPlaneClient.agencyRecovery().then(async (recovery) => {
      if (recovery.clients.length === 0) return;
      const groups = managedBrandBackfillGroups(workspaceState, activeUserId, recovery.brands);
      await Promise.all(groups.map(({ role, brandIds }) => controlPlaneClient.backfillBrandActorBindings({ actorUserId: activeUserId, role, capability: "manage_brand" }, brandIds)));
      actorBindingBackfillDoneRef.current.add(profileKey);
    }).catch((error) => {
      setQueueNotice(error instanceof Error ? `Brand access recovery failed: ${error.message}` : "Brand access recovery failed.");
    }).finally(() => actorBindingBackfillInFlightRef.current.delete(profileKey));
  }, [agencyMigrationCommitted, profileId, profileRevision, activeUserId]);
  useEffect(() => {
    const brandId = activeBrandRecord?.id;
    if (!brandId) return;
    setWorkspaceState((current) => current.brandVisualTokensByBrand?.[brandId] ? current : ensureBrandVisualTokensByBrand(current, brandId, defaultBrandSystem.visualTokens));
  }, [activeBrandRecord?.id]);
  useEffect(() => {
    setSelectedRecipeId((current) => contentRecipes.some((recipe) => recipe.id === current && recipe.brandId === activeBrandRecord.id && recipe.status === "active")
      ? current
      : contentRecipes.find((recipe) => recipe.brandId === activeBrandRecord.id && recipe.status === "active")?.id ?? "");
  }, [activeBrandRecord.id, contentRecipes]);
  const legacyMediaRecords = useMemo(() => assets.map(mediaInventoryFromCard).filter((record): record is MediaInventoryRecord => Boolean(record)), [assets]);
  const mediaInventorySource = automationState.mediaAssets.length > 0 ? automationState.mediaAssets : legacyMediaRecords;
  const canonicalMedia = useMemo(() => mediaInventorySource.map(normalizeDriveInventoryRecord), [mediaInventorySource]);
  const activeMediaRecords = useMemo(() => {
    const cards = new Map(assets.map((asset) => [String(asset.id), asset]));
    return mediaInventorySource.filter((asset) => localMediaBelongsToBrand(asset, cards.get(asset.id), activeWorkspaceRecord.id, activeBrandRecord.id)).map(normalizeDriveInventoryRecord);
  }, [assets, mediaInventorySource, activeBrandRecord.id, activeWorkspaceRecord.id]);
  const activeMediaCards = useMemo(() => activeMediaRecords.map(mediaCardFromInventory), [activeMediaRecords]);
  useEffect(() => {
    setDrafts((current) => {
      let changed = false;
      const next = current.map((draft) => {
        const asset = activeMediaCards.find((candidate) => draft.mediaAssetIds?.includes(String(candidate.id)));
        const latestOperation = draft.mediaOperations?.[Math.max(0, draft.mediaOperations.length - 1)];
        const inferredVideo = draft.contentKind === "video" || draft.mediaOperation?.kind === "video" || latestOperation?.kind === "video" || /video|clip|short video/i.test(`${draft.title} ${draft.tag}`);
        const mediaKind = inferredVideo ? "video" : draft.mediaKind ?? draft.mediaOperation?.kind ?? latestOperation?.kind;
        const mediaPreviewUrl = draft.mediaPreviewUrl ?? localMediaPreviewUrl(asset?.localAssetPath);
        if (!mediaPreviewUrl && !mediaKind) return draft;
        if (draft.mediaPreviewUrl === mediaPreviewUrl && draft.mediaKind === mediaKind) return draft;
        changed = true;
        return { ...draft, mediaPreviewUrl, mediaKind };
      });
      return changed ? next : current;
    });
  }, [activeMediaCards]);
  const setBrandVoice = (value: string): boolean => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi Brand voice."))) return false;
    setWorkspaceState((current) => ({ ...current, brandVoiceByBrand: { ...current.brandVoiceByBrand, [current.activeBrandId]: value } }));
    return true;
  };
  const setBrandVisualTokens = (value: BrandVisualTokens): boolean => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi Brand visual tokens."))) return false;
    setWorkspaceState((current) => ({ ...current, brandVisualTokensByBrand: { ...(current.brandVisualTokensByBrand ?? {}), [current.activeBrandId]: sanitizeBrandVisualTokens(value, getBrandVisualTokens(current, current.activeBrandId, defaultBrandSystem.visualTokens)) } }));
    return true;
  };
  const updateActiveBrandIdentity = (identity: BrandIdentityRecord): boolean => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi Brand Identity."))) return false;
    if (!currentMembership || !canRole(currentMembership.role, "manage_brand")) { setQueueNotice("Role hiện tại chỉ được xem; không có quyền sửa Brand Identity."); return false; }
    const next = { ...identity, status: validateBrandIdentity(identity).ok ? "active" as const : "draft" as const };
    setWorkspaceState((current) => ({ ...current, brandIdentities: [...(current.brandIdentities ?? hydrateLegacyAgencyRecords(current).identities).filter((item) => item.id !== identity.id), next] }));
    if (controlPlaneClient) void controlPlaneClient.updateIdentityPayload(identity.id, { strategy: next.strategy, voice: next.voice, visual: next.visual }).catch((error) => setQueueNotice(error instanceof Error ? error.message : "Control Plane could not persist Brand Identity."));
    return true;
  };
  function syncLedgerState() {
    const reservations = automationLedgerRef.current.list();
    setAutomationState((current) => {
      const base = current.mediaAssets.length > 0 ? current.mediaAssets : assets.map(mediaInventoryFromCard).filter((record): record is MediaInventoryRecord => Boolean(record));
      return { ...current, reservations, mediaAssets: base.map((record) => applyLedgerToRecord(record, automationLedgerRef.current)) };
    });
    setAssets((current) => current.map((asset) => {
      const source = mediaInventoryFromCard(asset);
      if (!source) return asset;
      const record = applyLedgerToRecord(source, automationLedgerRef.current);
      return { ...asset, ...mediaCardFromInventory(record) };
    }));
  }
  const [autoRunDueJobs, setAutoRunDueJobs] = useState(false);
  const automationAIResolution = useMemo(() => resolveAutomationAI(automationAI, aiAccounts), [aiAccounts, automationAI]);
  const [metaAppId, setMetaAppId] = useState(readMetaAppId());
  const [metaSecretConfigured, setMetaSecretConfigured] = useState(false);
  const [metaAccessTokenConfigured, setMetaAccessTokenConfigured] = useState(false);
  const [metaAccountHints, setMetaAccountHints] = useState<MetaAccountHint[]>(() => readMetaAccountHints(profileId, activeWorkspaceRecord?.id ?? "mile-mark-money"));
  const [metaSelectedPageId, setMetaSelectedPageId] = useState(() => readMetaSelectedPageId(profileId, activeWorkspaceRecord?.id ?? "mile-mark-money"));
  const [metaSettingsNotice, setMetaSettingsNotice] = useState("");
  const [metaDiscoveryBusy, setMetaDiscoveryBusy] = useState(false);
  const [metaTokenExchangeBusy, setMetaTokenExchangeBusy] = useState(false);
  const applyMetaOAuthResult = (rawResult: Record<string, unknown>) => {
    const resultProfileId = typeof rawResult.profileId === "string" ? rawResult.profileId : profileId;
    if (resultProfileId !== profileId) {
      setConnectionNotice("Meta OAuth result belongs to a different profile. No account hints were applied.");
      return;
    }
    const workspaceId = typeof rawResult.workspaceId === "string" ? rawResult.workspaceId : activeWorkspaceRecord.id;
    if (rawResult.status === "error") {
      setConnectionNotice(`Meta OAuth exchange failed: ${typeof rawResult.code === "string" ? rawResult.code : "META_OAUTH_EXCHANGE_FAILED"}`);
      return;
    }
    const accountHints = Array.isArray(rawResult.accountHints) ? rawResult.accountHints as MetaAccountHint[] : [];
    persistMetaAccountHints(profileId, workspaceId, accountHints);
    const selectedPageId = chooseMetaPageId(accountHints, readMetaSelectedPageId(profileId, workspaceId));
    persistMetaSelectedPageId(profileId, workspaceId, selectedPageId);
    setMetaAccountHints(accountHints);
    setMetaSelectedPageId(selectedPageId);
    setMetaAccessTokenConfigured(true);
    setMetaSettingsNotice(`Meta OAuth connected: ${accountHints.length} account hint(s). Page token đã lưu trong .env credential file.`);
    setConnectionNotice(`Meta OAuth connected. ${accountHints.length} account hint(s) discovered.`);
  };
  useEffect(() => {
    if (!isElectronRuntime()) return;
    return onMetaOAuthResult(applyMetaOAuthResult);
  }, [activeWorkspaceRecord.id, profileId]);
  const openDashboardDraft = (draftId: number, trigger: HTMLElement) => {
    dashboardDetailTriggerRef.current = trigger;
    setSelectedDashboardDraftId(draftId);
    setActiveActionDraft(draftId);
  };
  const closeDashboardDraft = (restoreFocus = true) => {
    setSelectedDashboardDraftId(undefined);
    if (activeActionDraftRef.current?.draftId === selectedDashboardDraftId) activeActionDraftRef.current = undefined;
    if (restoreFocus) window.requestAnimationFrame(() => {
      if (dashboardDetailTriggerRef.current?.isConnected) dashboardDetailTriggerRef.current.focus();
    });
  };
  useEffect(() => {
    if (selectedDashboardDraftId === undefined) return;
    const frame = window.requestAnimationFrame(() => dashboardDetailCloseRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [selectedDashboardDraftId]);
  useEffect(() => {
    let disposed = false;
    void readAIAccountRegistry(activeWorkspaceRecord?.id ?? "mile-mark-money").then((registry) => { if (!disposed) setAiAccounts(registry); });
    return () => { disposed = true; };
  }, [activeWorkspaceRecord?.id]);
  const saveAIKey = async (input: { provider: AIProvider; apiKey: string; model: string }) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi AI provider."))) return;
    try { setAiAccounts(await saveAIProviderKey(activeWorkspaceRecord?.id ?? "mile-mark-money", input.provider, input.apiKey, input.model)); setAiSettingsNotice(`${input.provider === "openai" ? "OpenAI" : "Gemini"} API key saved through the .env credential file.`); } catch (error) { setAiSettingsNotice(error instanceof Error ? error.message : "Could not save the AI API key."); }
  };
  const saveProviderConfiguration = async (input: { providerKind: string; model: string; baseUrl?: string; projectId?: string; location?: string; secretRef: string }) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi provider configuration."))) return;
    if (!controlPlaneClient) {
      setProviderConfigurationNotice("Control Plane chưa được cấu hình; candidate chưa được lưu. Không giả lập trạng thái provider.");
      return;
    }
    if (!isValidProviderSecretRef(input.secretRef, profileId)) {
      setProviderConfigurationNotice("Provider secretRef must belong to the active user profile.");
      return;
    }
    const validation = validateProviderConfiguration({ id: `provider-${activeWorkspaceRecord.id}-${input.providerKind}`, clientId: activeWorkspaceRecord.id, displayName: input.providerKind, ...input, status: "not_configured", capabilities: ["copy"] });
    if (!validation.ok) {
      setProviderConfigurationNotice(`Provider config blocked: ${validation.errors.join(" · ")}`);
      return;
    }
    try {
      await controlPlaneClient.createAgencyRecord("provider-configurations", { id: `provider-${activeWorkspaceRecord.id}-${input.providerKind}`, clientId: activeWorkspaceRecord.id, providerKind: input.providerKind, displayName: input.providerKind, model: input.model, baseUrl: input.baseUrl, projectId: input.projectId, location: input.location, secretRef: input.secretRef, status: "not_configured", capabilities: ["copy"] });
      setProviderConfigurationNotice("Provider candidate saved in Control Plane. Run its read-only health probe before selecting it for a GenerationProfile.");
    } catch (error) {
      setProviderConfigurationNotice(error instanceof Error ? error.message : "Provider candidate could not be saved.");
    }
  };
  const probeProviderConfiguration = async (providerKind: string, operatorApproved = false) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi probe provider."))) return;
    if (!controlPlaneClient) {
      setProviderConfigurationNotice("Control Plane chưa được cấu hình; không thể probe provider.");
      return;
    }
    const id = `provider-${activeWorkspaceRecord.id}-${providerKind}`;
    try {
      const result = await controlPlaneClient.probeProviderConfiguration(id, operatorApproved);
      setProviderConfigurationNotice(`${providerKind}: ${String(result.status)}${result.errorCode ? ` · ${String(result.errorCode)}` : ""}. Không có publish nào được gọi.`);
    } catch (error) {
      setProviderConfigurationNotice(error instanceof Error ? error.message : "Provider health probe failed.");
    }
  };
  async function saveContentIntelligenceIntake(kind: ContentIntelligenceIntakeKind, revision: number, persist: (scope: ContentIntelligenceIntakeScope, client: NonNullable<typeof controlPlaneClient>) => Promise<Record<string, unknown>>, isAcknowledged: (record: Record<string, unknown>, scope: ContentIntelligenceIntakeScope) => boolean, commit: (record: Record<string, unknown>, scope: ContentIntelligenceIntakeScope) => void, successMessage: string): Promise<boolean> {
    const scope = contentIntelligenceScope;
    const draftKey = contentIntelligenceIntakeDraftKey(scope, kind);
    const current = contentIntelligenceIntakeDraftsRef.current[draftKey];
    if (!current || current.revision !== revision) return false;
    const token = beginContentIntelligenceIntakeSave(contentIntelligenceIntakeRequestIdsRef.current, contentIntelligenceIntakeInFlightRef.current, scope, kind, revision);
    if (!token) return false;
    setIntakeSaveFeedback(token, "pending", "Saving to Control Plane…");
    try {
      if (!controlPlaneClient) throw new Error("Control Plane is not configured.");
      const record = await persist(scope, controlPlaneClient);
      if (!isAcknowledged(record, scope)) throw new Error("Control Plane acknowledgement did not match the submitted record.");
      if (isCurrentContentIntelligenceScope(scope)) commit(record, scope);
      const next = acknowledgeContentIntelligenceIntakeSave(contentIntelligenceIntakeDraftsRef.current, token, contentIntelligenceIntakeRequestIdsRef.current.get(token.draftKey), successMessage);
      if (next !== contentIntelligenceIntakeDraftsRef.current) storeContentIntelligenceIntakeDrafts(next);
      return true;
    } catch (error) {
      setIntakeSaveFeedback(token, "failure", error instanceof Error ? `Not saved. ${error.message}` : "Not saved. The Control Plane did not acknowledge this record.");
      return false;
    } finally {
      finishContentIntelligenceIntakeSave(contentIntelligenceIntakeRequestIdsRef.current, contentIntelligenceIntakeInFlightRef.current, token);
    }
  }
  const createResearchEvidence = async (input: { sourceUrl: string; sourceTitle: string; retrievedAt: string; summary: string; sourceType?: "operator_selected" | "manual_entry"; rightsState: "user_owned" | "licensed" }, revision: number) => {
    const id = `evidence-${contentIntelligenceScope.clientId}-${Date.now()}`;
    return saveContentIntelligenceIntake(
      "research", revision,
      async (scope, client) => client.createAgencyRecord<Record<string, unknown>>("research-evidence", { id, clientId: scope.clientId, brandId: scope.brandId, ...input, sourceType: input.sourceType ?? "operator_selected", reviewState: "pending" }),
      (record, scope) => record.id === id && record.clientId === scope.clientId && record.brandId === scope.brandId && record.sourceUrl === input.sourceUrl && record.sourceTitle === input.sourceTitle && record.summary === input.summary && record.retrievedAt === input.retrievedAt && record.sourceType === (input.sourceType ?? "operator_selected") && record.rightsState === input.rightsState && record.reviewState === "pending",
      (record, scope) => setResearchEvidence((current) => isCurrentContentIntelligenceScope(scope) ? [record as unknown as ResearchEvidence, ...current] : current),
      "Evidence saved as pending operator review.",
    );
  };
  const approveResearchEvidence = async (id: string): Promise<boolean> => {
    const scope = contentIntelligenceScope;
    if (!currentMembership || !canReviewResearchEvidence(currentMembership, scope.clientId)) return false;
    const evidence = researchEvidence.find((item) => item.id === id && item.clientId === scope.clientId && (!item.brandId || item.brandId === scope.brandId));
    if (!controlPlaneClient || !evidence || evidence.reviewState !== "pending" || !["user_owned", "licensed"].includes(evidence.rightsState)) return false;
    try {
      const actor: BrandLifecycleActor = { actorUserId: activeUserId, role: currentMembership.role as "owner" | "admin", capability: "manage_brand" };
      const acknowledged = await controlPlaneClient.approveResearchEvidence(id, { brandId: scope.brandId, actor });
      if (acknowledgeResearchEvidenceApproval([evidence], evidence, acknowledged)[0]?.reviewState !== "approved") return false;
      setResearchEvidence((current) => isCurrentContentIntelligenceScope(scope) ? acknowledgeResearchEvidenceApproval(current, evidence, acknowledged) : current);
      return true;
    } catch {
      return false;
    }
  };
  const createKnowledgeItem = async (input: { title: string; text: string; provenance: string; rightsState: "user_owned" | "licensed" }, revision: number) => {
    const id = `knowledge-${contentIntelligenceScope.brandId}-${Date.now()}`;
    return saveContentIntelligenceIntake(
      "knowledge", revision,
      async (scope, client) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.text));
      const contentHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      return client.createAgencyRecord<Record<string, unknown>>("knowledge-items", { id, clientId: scope.clientId, brandId: scope.brandId, kind: "operator_source", title: input.title, contentHash, provenance: input.provenance, rightsState: input.rightsState, reviewState: "approved", text: input.text, sourceUpdatedAt: new Date().toISOString() });
      },
      (record, scope) => record.id === id && record.clientId === scope.clientId && record.brandId === scope.brandId && record.title === input.title && record.provenance === input.provenance && record.rightsState === input.rightsState && record.reviewState === "approved",
      (record, scope) => setKnowledgeItems((current) => isCurrentContentIntelligenceScope(scope) ? [{ ...record, text: input.text, sourceUpdatedAt: record.sourceUpdatedAt ?? new Date().toISOString() } as unknown as KnowledgeItem, ...current] : current),
      "Knowledge Item saved in this Client/Brand scope.",
    );
  };
  const createTrendSignal = async (input: { source: string; topic: string; metric: string; evidenceIds: string[] }, revision: number) => {
    const id = `trend-${contentIntelligenceScope.clientId}-${Date.now()}`;
    return saveContentIntelligenceIntake(
      "trend", revision,
      async (scope, client) => client.createAgencyRecord<Record<string, unknown>>("trend-signals", { id, clientId: scope.clientId, ...input, observedAt: new Date().toISOString(), status: "observed" }),
      (record, scope) => record.id === id && record.clientId === scope.clientId && record.source === input.source && record.topic === input.topic && record.metric === input.metric,
      (record, scope) => setTrendSignals((current) => isCurrentContentIntelligenceScope(scope) ? [record as unknown as TrendSignal, ...current] : current),
      "Observed Trend Signal saved; no prediction or publish job was created.",
    );
  };
  const recordAnalyticsEvent = (eventName: AnalyticsEvent["eventName"], properties: Record<string, unknown>) => {
    if (!controlPlaneClient) return;
    const event: AnalyticsEvent & { id: string } = { id: `event-${eventName}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, eventName, clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id, occurredAt: new Date().toISOString(), properties };
    setAnalyticsEvents((current) => [...current, event]);
    void controlPlaneClient.createAgencyRecord("analytics-events", event).catch(() => undefined);
  };
  recordAnalyticsEventRef.current = recordAnalyticsEvent;
  const openAIAccount = async (provider: AIProvider) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi AI provider."))) return;
    const workspaceId = activeWorkspaceRecord?.id ?? "mile-mark-money";
    if (provider === "gemini" || provider === "openai") {
      try {
        setAiAccounts(await markAIWebSubscription(workspaceId, provider, aiAccounts[provider].model));
        await invoke(provider === "gemini" ? "gemini_web_open" : "chatgpt_web_open", { workspaceId });
        setAiSettingsNotice(`${provider === "gemini" ? "Gemini Pro" : "ChatGPT Plus"} browser đã mở trong SignalFlow. Đăng nhập một lần ngay trong cửa sổ này; hồ sơ phiên app sẽ được giữ bền vững và không cần API key.`);
      } catch (error) {
        setAiSettingsNotice(error instanceof Error ? error.message : "Không thể mở AI browser trong app.");
      }
      return;
    }
  };
  const clearAIAccount = async (provider: AIProvider) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi AI provider."))) return;
    setAiAccounts(await clearAIProvider(activeWorkspaceRecord?.id ?? "mile-mark-money", provider));
    setAiSettingsNotice(`${provider === "openai" ? "OpenAI" : "Gemini"} account metadata cleared and .env credential file API key removed if present.`);
  };
  const updateAIModel = async (provider: AIProvider, model: string) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi AI provider."))) return;
    setAiAccounts(await updateAIProviderModel(activeWorkspaceRecord?.id ?? "mile-mark-money", provider, model));
  };
  const hasDiscoveredMetaPage = metaAccountHints.some((account) => account.kind === "page" && account.id === metaSelectedPageId);
  const metaLiveReadiness = getMetaLiveReadiness(hasDiscoveredMetaPage, metaAccessTokenConfigured);
  const schedulerStateRef = useRef({ autoRunDueJobs, liveReadiness: metaLiveReadiness, automationPlans, activeClientId, brandId: activeBrandRecord.id, activeBrand: activeBrandRecord });
  schedulerStateRef.current = { autoRunDueJobs, liveReadiness: metaLiveReadiness, automationPlans, activeClientId, brandId: activeBrandRecord.id, activeBrand: activeBrandRecord };
  const runDueJobsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const runDueAutomationPlansRef = useRef<(now?: Date, allowOfficialAI?: boolean, forceReviewOnly?: boolean, runScope?: AutomationPlanRunScope) => Promise<void>>(() => Promise.resolve());
  const schedulerRunInFlightRef = useRef(false);
  // The outer scheduler guard covers timer-triggered publisher runs; this guard covers planner creative runs from every entry point.
  const plannerRunInFlightRef = useRef(false);
  const [plannerRunBusy, setPlannerRunBusy] = useState(false);
  useEffect(() => {
    if (metaLiveReadiness !== "ready") setAutoRunDueJobs(false);
  }, [metaLiveReadiness]);
  useEffect(() => {
    const workspaceId = activeWorkspaceRecord?.id ?? "mile-mark-money";
    const cachedHints = readMetaAccountHints(profileId, workspaceId);
    setMetaAccountHints(cachedHints);
    setMetaSelectedPageId(chooseMetaPageId(cachedHints, readMetaSelectedPageId(profileId, workspaceId)));
    void readMetaSettingsStatus(workspaceId).then((status) => { setMetaAppId(status.appId); setMetaSecretConfigured(status.appSecretConfigured); setMetaAccessTokenConfigured(status.accessTokenConfigured); });
  }, [activeWorkspaceRecord?.id, profileId]);
  const saveMetaConfiguration = async (input: { appId: string; appSecret: string; accessToken: string }) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi Meta configuration."))) return;
    const workspaceId = activeWorkspaceRecord?.id ?? "mile-mark-money";
    try { await saveMetaSettings(workspaceId, input); const status = await readMetaSettingsStatus(workspaceId); setMetaAppId(status.appId); setMetaSecretConfigured(status.appSecretConfigured); setMetaAccessTokenConfigured(status.accessTokenConfigured); setMetaSettingsNotice("Meta configuration saved. Secrets remain in the .env credential file."); } catch (error) { setMetaSettingsNotice(error instanceof Error ? error.message : "Could not save Meta configuration."); }
  };
  const discoverMetaConfiguration = async () => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi Discover Meta accounts."))) return;
    const workspaceId = activeWorkspaceRecord?.id ?? "mile-mark-money";
    setMetaDiscoveryBusy(true); setMetaSettingsNotice("");
    try {
      const result = await discoverMetaAccounts(workspaceId);
      persistMetaAccountHints(profileId, workspaceId, result.accountHints);
      setMetaAccountHints(result.accountHints);
      const selectedPageId = chooseMetaPageId(result.accountHints, readMetaSelectedPageId(profileId, workspaceId));
      setMetaSelectedPageId(selectedPageId);
      persistMetaSelectedPageId(profileId, workspaceId, selectedPageId);
      setMetaSettingsNotice(`Meta account discovery succeeded: ${result.accountHints.length} account hint(s). Page token đã được lưu trong .env credential file; ${selectedPageId ? "Page đã chọn sẵn." : "hãy chọn Page trước khi xác nhận live readiness."}`);
    } catch (error) {
      const cachedHints = readMetaAccountHints(profileId, workspaceId);
      setMetaAccountHints(cachedHints);
      const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Meta account discovery failed.";
      setMetaSettingsNotice(message.startsWith("META_ACCESS_TOKEN_EXPIRED")
        ? cachedHints.some((account) => account.kind === "page")
          ? "Bootstrap user token đã hết hạn, nhưng Page token đã lưu vẫn được giữ lại. Không cần Generate lại trừ khi cần Discover lại hoặc Page token bị thu hồi."
          : "Bootstrap user token đã hết hạn trước lần Discover đầu tiên. Hãy dùng official OAuth hoặc tạo token hợp lệ một lần để Discover Page."
        : message);
    } finally { setMetaDiscoveryBusy(false); }
  };
  const selectMetaPage = (pageId: string) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi Meta Page."))) return;
    const workspaceId = activeWorkspaceRecord?.id ?? "mile-mark-money";
    persistMetaSelectedPageId(profileId, workspaceId, pageId);
    setMetaSelectedPageId(pageId);
    setMetaSettingsNotice("Page live đã chọn. Live readiness sẽ được xác nhận sau khi đủ Page và token.");
  };
  const extendMetaToken = async () => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi Meta token."))) return;
    const workspaceId = activeWorkspaceRecord?.id ?? "mile-mark-money";
    setMetaTokenExchangeBusy(true); setMetaSettingsNotice("");
    try {
      const result = await exchangeMetaToken(workspaceId, metaAppId);
      const expiry = result.expiresIn ? ` · khoảng ${Math.round(result.expiresIn / 86_400)} ngày` : "";
      setMetaSettingsNotice(`Bootstrap token đã được đổi sang long-lived token và lưu trong .env credential file${expiry}. Bấm Discover Page + Instagram một lần để lưu Page token.`);
    } catch (error) {
      setMetaSettingsNotice(error instanceof Error ? error.message : typeof error === "string" ? error : "Không thể đổi Meta token sang long-lived token.");
    } finally { setMetaTokenExchangeBusy(false); }
  };
  const [savedNotice, setSavedNotice] = useState("");
  useEffect(() => { persistSnapshot(drafts, selectedPlatforms, queueRef.current.snapshot(), { ...defaultBrandSystem, workspaceId: activeBrandRecord?.systemId ?? defaultBrandSystem.workspaceId, voice: brandVoice }, assets, { ...workspaceState, contentRecipes }, contentTemplates, automationPlans, { ...automationState, imageProvider, videoProvider, automationAI }, agencyMigrationCommitted, profileId); }, [agencyMigrationCommitted, assets, automationAI, automationPlans, automationState, brandVoice, contentRecipes, contentTemplates, drafts, imageProvider, videoProvider, selectedPlatforms, queueRevision, workspaceState, activeBrandRecord?.systemId, profileId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const handleOAuthUrls = (urls: string[]) => {
      urls.forEach((rawUrl) => {
        const result = parseOAuthCallback(rawUrl);
        setActiveNav("Settings");
        setSettingsSection("bindings");
        if (!result.ok) {
          setConnectionNotice(result.message);
          return;
        }
        if (!isElectronRuntime() || (result.platform !== "facebook" && result.platform !== "instagram")) {
          setConnectionNotice(`${result.platform} authorization code received for ${result.workspaceId}. Token exchange remains server-side and is not performed in the renderer.`);
          return;
        }
        if (result.profileId !== profileId || result.profileRevision !== profileRevision) {
          setConnectionNotice("OAuth callback belongs to an older profile session. Start authorization again from the active profile.");
          return;
        }
        void exchangeOAuthCallbackIfCurrent(
          result,
          () => invoke<{ profileId: string; profileRevision: number }>("profile_selection"),
          (flow) => exchangeMetaOAuthCode(flow.workspaceId, metaAppId || readMetaAppId(), flow.code, flow.profileId, flow.profileRevision),
        ).then((fenced) => {
            if (fenced.status === "stale") {
              setConnectionNotice("OAuth callback belongs to an older profile session. Start authorization again from the active profile.");
              return;
            }
            const exchange = fenced.value;
            persistMetaAccountHints(result.profileId, result.workspaceId, exchange.accountHints);
            const selectedPageId = chooseMetaPageId(exchange.accountHints, readMetaSelectedPageId(result.profileId, result.workspaceId));
            persistMetaSelectedPageId(result.profileId, result.workspaceId, selectedPageId);
            setMetaAccountHints(exchange.accountHints);
            setMetaSelectedPageId(selectedPageId);
            setMetaAccessTokenConfigured(true);
            setMetaSettingsNotice(`Meta OAuth connected: ${exchange.accountHints.length} account hint(s). Page token đã lưu trong .env credential file.`);
            setConnectionNotice(`Meta OAuth connected. ${exchange.accountHints.length} account hint(s) discovered.`);
          })
          .catch((error) => setConnectionNotice(error instanceof Error ? error.message : "Meta OAuth token exchange failed."));
      });
    };

    void (async () => {
      if (typeof window === "undefined") return;
      if ("__TAURI_INTERNALS__" in window) {
        const deepLink = await import("@tauri-apps/plugin-deep-link");
        const initialUrls = await deepLink.getCurrent();
        if (!disposed && initialUrls) handleOAuthUrls(initialUrls);
        unlisten = await deepLink.onOpenUrl((urls) => handleOAuthUrls(urls));
      } else {
        unlisten = onOAuthUrls(handleOAuthUrls);
        const pendingUrls = await invoke<string[]>("oauth_callback_ready");
        if (!disposed && pendingUrls.length > 0) handleOAuthUrls(pendingUrls);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const scopedDrafts = useMemo(() => drafts.filter((draft) => draft.brandId === activeBrandRecord.id && !draft.deletedAt).map((draft) => {
    const linkedAsset = draft.mediaAssetIds?.map((assetId) => assets.find((asset) => String(asset.id) === String(assetId))).find(Boolean);
    const localPreview = draft.mediaPreviewUrl ?? localMediaPreviewUrl(linkedAsset?.localAssetPath);
    const localThumbnail = draft.mediaThumbnailUrl ?? localMediaThumbnailUrl(linkedAsset?.localAssetPath);
    const displayTitle = draft.automationKey && draft.title.length > 90 ? `${activeBrandRecord.name} · ${draft.platform} · ${draft.scheduledAt ? new Date(draft.scheduledAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "planned"}` : draft.title;
    const normalizedDraft = displayTitle === draft.title ? draft : { ...draft, title: displayTitle };
    return localPreview ? { ...normalizedDraft, mediaUrl: localPreview, mediaPreviewUrl: localPreview, ...(localThumbnail ? { mediaThumbnailUrl: localThumbnail } : {}) } : normalizedDraft;
  }), [activeBrandRecord.id, activeBrandRecord.name, assets, drafts]);
  const draftActionFeedbackByDraftId = useMemo(() => Object.fromEntries(scopedDrafts.map((draft) => [draft.id, draftActionFeedback[draftActionScopeKey(draftActionScope(draft))] ?? {}])), [draftActionFeedback, scopedDrafts]);
  const publishBlockersByDraftId = useMemo(() => Object.fromEntries(scopedDrafts.map((draft) => [draft.id, draftPublishBlocker({ id: draft.id, clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id, contentRunId: draft.contentRunId, status: draft.status, qualityStatus: draft.qualityStatus, approvalState: draft.approvalState, pendingPublicationIds: draft.pendingPublicationIds }, targetPublications)])), [activeBrandRecord.id, activeWorkspaceRecord.id, scopedDrafts, targetPublications]);
  useEffect(() => {
    for (const draft of scopedDrafts) {
      const scopeKey = draftActionScopeKey(draftActionScope(draft));
      if (draft.pendingPublicationIds?.length) continue;
      for (const action of ["quality", "approval", "publish"] as const) {
        const pending = draftActionFeedback[scopeKey]?.[action];
        if (pending?.status !== "pending" || pending.pendingReason !== "reconciliation") continue;
        const settled = action === "approval" && draft.status === "Scheduled" && draft.approvalState === "ready"
          ? { status: "success" as const, message: "Control Plane and worker reconciliation confirmed every target." }
          : { status: "failure" as const, message: `${action} was not sent while the previous operation was unresolved. Reconciliation is complete; retry if still needed.` };
        setDraftActionFeedbackFor(scopeKey, action, settled);
      }
    }
  }, [draftActionFeedback, scopedDrafts]);
  const brandScopeKeyFor = (brand: { id: string; clientId?: string; workspaceId: string }) => brandUiScopeKey({ profileId, profileRevision, clientId: brand.clientId ?? brand.workspaceId, brandId: brand.id });
  const brandTrashPreviews = useMemo<Record<string, BrandTrashPreview>>(() => Object.fromEntries(workspaceState.brands.map((brand) => {
    const clientId = brand.clientId ?? brand.workspaceId;
    const scopeKey = brandScopeKeyFor(brand);
    const durablePublicationIds = new Set(targetPublications.flatMap((publication) => [publication.id, publication.workerJobId].filter((id): id is string => Boolean(id))));
    const localOnlyJobs = queueJobs
      .filter((job) => job.brandId === brand.id && (!job.clientId || job.clientId === clientId) && !durablePublicationIds.has(job.id))
      .map((job) => ({ brandId: job.brandId, clientId: job.clientId, state: job.state }));
    const local = buildBrandTrashPreview(workspaceState, brand.id, {
      clientId,
      drafts,
      plans: automationPlans,
      publications: [...targetPublications.filter((publication) => publication.clientId === clientId && publication.brandId === brand.id), ...localOnlyJobs],
      assets,
      countsKnown: false,
    });
    const authoritative = authoritativeBrandImpacts[scopeKey];
    return [scopeKey, authoritative && isAuthoritativeBrandImpact(authoritative) ? { ...local, ...authoritative, countsKnown: true } : { ...local, source: "local" as const }];
  })), [assets, authoritativeBrandImpacts, automationPlans, drafts, loadedTargetPublicationBrandIds, profileId, profileRevision, queueJobs, targetPublications, workspaceState]);
  const loadBrandTrashPreview = async (brandId: string): Promise<boolean> => {
    const brand = workspaceState.brands.find((candidate) => candidate.id === brandId && (candidate.clientId ?? candidate.workspaceId) === activeWorkspaceRecord.id);
    const scopeKey = brandUiScopeKey({ profileId, profileRevision, clientId: brand?.clientId ?? brand?.workspaceId ?? activeWorkspaceRecord.id, brandId });
    if (!brand) {
      setBrandImpactErrors((current) => ({ ...current, [scopeKey]: "BRAND_NOT_FOUND" }));
      return false;
    }
    if (!controlPlaneClient) {
      setAuthoritativeBrandImpacts((current) => clearBrandUiScopeEntry(current, { profileId, profileRevision, clientId: brand.clientId ?? brand.workspaceId, brandId }));
      setBrandImpactErrors((current) => ({ ...current, [scopeKey]: "CONTROL_PLANE_UNCONFIGURED" }));
      return false;
    }
    setBrandImpactLoading((current) => ({ ...current, [scopeKey]: true }));
    setBrandImpactErrors((current) => ({ ...current, [scopeKey]: undefined }));
    try {
      const response = await controlPlaneClient.brandImpactPreview(brandId);
      const normalized = normalizeBrandImpactPreview(response, brandId);
      if (!brandImpactPreviewMatchesBrand(normalized, { id: brandId, clientId: brand.clientId, workspaceId: brand.workspaceId })) throw new Error("BRAND_IMPACT_SCOPE_MISMATCH");
      const { counts, ...identity } = normalized;
      setAuthoritativeBrandImpacts((current) => setBrandUiScopeEntry(current, { profileId, profileRevision, clientId: brand.clientId ?? brand.workspaceId, brandId }, { ...identity, ...counts, source: "control_plane", countsKnown: true }));
      return true;
    } catch (error) {
      setAuthoritativeBrandImpacts((current) => clearBrandUiScopeEntry(current, { profileId, profileRevision, clientId: brand.clientId ?? brand.workspaceId, brandId }));
      setBrandImpactErrors((current) => ({ ...current, [scopeKey]: error instanceof Error ? error.message : "BRAND_IMPACT_PREVIEW_UNAVAILABLE" }));
      return false;
    } finally {
      setBrandImpactLoading((current) => ({ ...current, [scopeKey]: false }));
    }
  };
  const publicationQueueJobs = useMemo<DisplayPublishJob[]>(() => targetPublications
    .filter((publication) => publication.clientId === activeWorkspaceRecord.id && publication.brandId === activeBrandRecord.id && !publication.legacyNonLive && publication.scheduledAt)
    .map((publication) => {
      const binding = workspaceState.channelBindings?.find((candidate) => candidate.id === publication.bindingId);
      const workerState = publication.workerState;
      const providerConfirmed = hasProviderConfirmedPublicationState(publication);
      const workerCompletionPending = workerState === "completed" && !providerConfirmed;
      const missingProviderEvidence = publication.state === "published" && !publication.providerJobId;
      const reconciliationPending = Boolean(publication.pendingCommandId) || ["pending", "unknown"].includes(publication.commandStatus ?? "") || ["pending", "unknown", "reconciling", "reconciliation_required"].includes(publication.state) || ["pending", "unknown", "reconciliation_required"].includes(publication.workerAckState ?? "") || workerState === "unknown" || workerCompletionPending || missingProviderEvidence;
      const state: DisplayPublishJob["state"] = reconciliationPending ? "reconciliation_error"
        : publication.commandStatus === "failed" ? "retryable_error"
        : providerConfirmed ? "published"
        : ["failed", "permanent_error", "approval_failed"].includes(publication.state) ? "permanent_error"
        : workerState === "failed" ? "reconciliation_error"
        : workerState === "running" || publication.state === "running" ? "uploading"
          : publication.state === "canceled" || publication.state === "cancelled" ? "canceled" : "queued";
      return { id: publication.workerJobId ?? publication.id, variantId: publication.variantId ?? `publication-${publication.id}`, connectionId: binding?.connectionId ?? publication.targetExternalId ?? publication.bindingId ?? publication.id, scheduledAt: publication.scheduledAt!, idempotencyKey: publication.idempotencyKey ?? publication.id, providerJobId: publication.providerJobId, state, attempts: 0, clientId: publication.clientId, brandId: publication.brandId, bindingId: publication.bindingId, ...(reconciliationPending ? { lastError: { code: "PUBLICATION_RECONCILIATION_REQUIRED", message: workerCompletionPending ? "Worker completed; waiting for Control Plane provider confirmation." : publication.workerAckState === "unknown" || workerState === "unknown" ? "Worker outcome is unknown; reconcile before another action." : "Control Plane and worker acknowledgement is still pending.", retryable: false } } : publication.commandStatus === "failed" ? { lastError: { code: publication.commandError ?? "PUBLICATION_COMMAND_REJECTED", message: "Last command was rejected; target schedule remains unchanged. Retry when the worker is ready.", retryable: true } } : {}) };
    }), [activeBrandRecord.id, activeWorkspaceRecord.id, targetPublications, workspaceState.channelBindings]);
  const durableJobIds = useMemo(() => new Set(publicationQueueJobs.map((job) => job.id)), [publicationQueueJobs]);
  const displayQueueJobs = useMemo(() => [...queueJobs.filter((job) => !job.legacyNonLive && !durableJobIds.has(job.id)), ...publicationQueueJobs], [durableJobIds, publicationQueueJobs, queueJobs]);
  const operationalQueueJobs = useMemo(() => displayQueueJobs.filter((job) => job.state !== "canceled"), [displayQueueJobs]);
  const filteredDrafts = useMemo(
    () => activeFilter === "All" ? scopedDrafts : scopedDrafts.filter((draft) => draft.status === activeFilter),
    [activeFilter, scopedDrafts],
  );
  const selectedDashboardDraft = selectedDashboardDraftId === undefined ? undefined : scopedDrafts.find((draft) => draft.id === selectedDashboardDraftId);
  const publishedTargetCount = countProviderConfirmedPublications(targetPublications.filter((publication) => publication.clientId === activeWorkspaceRecord.id && publication.brandId === activeBrandRecord.id));
  const publishedDraftCount = publishedTargetCount;
  const reviewDrafts = scopedDrafts.filter((draft) => draft.status === "Needs review");
  const calendarDays = useMemo(() => {
    const today = new Date();
    const monday = new Date(today);
    monday.setHours(0, 0, 0, 0);
    const day = monday.getDay();
    monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return { day: date.toLocaleDateString("vi-VN", { day: "2-digit" }), date: localDateKey(date), label: index === (today.getDay() === 0 ? 6 : today.getDay() - 1) ? "Hôm nay" : "" };
    });
  }, []);

  const togglePlatform = (platform: Platform) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi thay đổi kênh."))) return;
    setSelectedPlatforms((current) => current.includes(platform)
      ? current.filter((item) => item !== platform)
      : [...current, platform]);
  };

  const captureComposerOpener = (opener?: RevoComposerFocusTarget | null) => {
    composerOpenerRef.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (!composerFallbackRef.current) composerFallbackRef.current = mainNavRef.current ?? pageContentRef.current;
  };
  const openComposer = (opener?: RevoComposerFocusTarget | null) => {
    const opened = openRevoComposerHandler({
      isGenerating: composerBusy,
      captureOpener: () => captureComposerOpener(opener),
      setVisible: setShowRevoComposer,
      clearError: () => setGenerationError(""),
      onBlocked: () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi mở composer khác."),
    });
    if (opened) setActiveNav("Content studio");
    return opened;
  };
  const closeComposer = (event?: RevoComposerCloseEvent) => {
    setShowComposer(false);
    if (event?.pending) setQueueNotice("Generation vẫn đang chạy ở scope đã gửi; SignalFlow không giả vờ hủy provider.");
  };

  const openContentStudioFilter = (filter: RevoContentFilter) => {
    setContentStudioFilter(filter);
    setActiveNav("Content studio");
    setShowComposer(false);
  };

  const controlPlaneMediaOwnershipInput = (attachments: readonly MediaAttachment[], importedRecords: readonly MediaInventoryRecord[] = []): ContentRunMediaOwnershipInput => {
    if (!controlPlaneClient) throw new Error("CONTENT_RUN_CONTROL_PLANE_REQUIRED");
    const scope = { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id };
    const availableAssets: ContentRunMediaOwnershipAsset[] = [...importedRecords, ...activeMediaRecords] as ContentRunMediaOwnershipAsset[];
    return {
      attachments,
      assets: availableAssets,
      scope,
      transport: {
        listMediaAssets: (requestedScope) => controlPlaneClient.listAgencyRecords("media-assets", requestedScope),
        createMediaAsset: (payload) => controlPlaneClient.createAgencyRecord("media-assets", payload),
        compensateMediaAsset: (assetId, receipt) => controlPlaneClient.compensateMediaAsset(assetId, receipt),
      },
    };
  };

  const createDraft = async (input?: RevoNewContentInput) => {
    const token = composerRequestGateRef.current.begin(composerScope);
    if (!token) return;
    setIsGenerating(true);
    setGenerationError("");
    const requestOwnsCurrentScope = () => composerRequestOwnsCurrentScope(token);
    const setComposerError = (message: string) => {
      if (requestOwnsCurrentScope()) setGenerationError(message);
    };
    const setComposerNotice = (message: string) => {
      if (requestOwnsCurrentScope()) setQueueNotice(message);
    };
    try {
    const form = input ?? { topic: newTopic, contentPillar: newContentPillar, objective: newObjective ?? "", contentAngle: "", format: "text" as const, caption: newCaption, cta: newCta, hashtags: newHashtags, seoKeywords: newSeoKeywords, scheduledAt: newScheduledAt, sources: newSources, notes: newNotes, aiProvider, aiMode, selectedPlatforms, composerAssetId };
    const autoGenerate = form.autoGenerate === true;
    const requestedTopic = form.topic.trim();
    const topic = requestedTopic || "Bài viết mới";
    const scheduleValidation = validateRevoComposerSchedule(form.scheduledAt);
    if (!scheduleValidation.ok) {
      setComposerError(scheduleValidation.message);
      return;
    }
    const structuredBrief = normalizeEditableFields({
      topic,
      contentPillar: form.contentPillar,
      objective: form.objective,
      caption: form.caption,
      cta: form.cta,
      hashtags: form.hashtags.split(/[\s,]+/),
      seoKeywords: form.seoKeywords.split(/[,\n]+/),
      scheduledAt: scheduleValidation.iso,
      sources: form.sources.split(/[\n]+/),
      notes: form.notes,
    });
    const targetPlatforms = (form.selectedPlatforms.length > 0 ? form.selectedPlatforms : ["Instagram"]).map((platform) => platform.toLowerCase() as SocialPlatform);
    const mediaManifest = form.composerMediaManifest?.length ? form.composerMediaManifest : (form.composerAssetIds?.length ? form.composerAssetIds : form.composerAssetId === "" ? [] : [form.composerAssetId]).map((assetId, order) => ({ assetId, order, role: order === 0 ? "publish" as const : "reference" as const }));
    let preparedMedia: Awaited<ReturnType<typeof prepareContentRunMedia>>;
    try {
      preparedMedia = await prepareContentRunMedia(mediaManifest, activeMediaCards, { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id });
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "MEDIA_ATTACHMENT_PREPARATION_FAILED");
      return;
    }
    if (!preparedMedia.ok) { setComposerError(preparedMedia.code); return; }
    if (preparedMedia.attachments.length && !isElectronRuntime()) { setComposerError("MANAGED_CHAT_MEDIA_REQUIRES_ELECTRON"); return; }
    const selectedMediaList = preparedMedia.attachments.map((attachment) => activeMediaCards.find((asset) => String(asset.id) === attachment.assetId)).filter((asset): asset is MediaCard => Boolean(asset));
    const selectedMedia = preparedMedia.attachments.find((attachment) => attachment.role === "publish") ? selectedMediaList[0] : undefined;
    const selectedLocalAssetPath = selectedMedia?.localAssetPath;
    const managedCopyProvider = form.aiProvider === "gemini" || form.aiProvider === "openai" ? form.aiProvider : undefined;
    const brandSystem: BrandSystem = {
      workspaceId: activeWorkspaceRecord.id,
      voice: brandVoice,
      audience: `Audience defined by the ${activeBrandRecord.name} brand system.`,
      prohibitedClaims: ["guaranteed returns", "get rich quick", "personalized financial advice"],
      visualTokens: brandVisualTokens,
    };
    const generationFormat: AssetPromptFormat = form.format === "video" ? "video" : form.format === "image" || preparedMedia.attachments.length > 0 ? "image" : assetFormatForContentKind(preparedMedia.contentKind);
    const contentKinds: ContentKind[] = [generationFormat === "image" ? "image" : generationFormat === "video" ? "video" : "text"];
    if (preparedMedia.attachments.length > 0 && !(form.aiMode === "web_subscription" && managedCopyProvider)) {
      setComposerError("MEDIA_ATTACHMENT_PROVIDER_UNSUPPORTED");
      return;
    }
    if (!activeBrandIdentity) {
      setComposerError("BRAND_IDENTITY_REQUIRED");
      return;
    }
    if (activeBrandIdentity.status !== "active" || !validateBrandIdentity(activeBrandIdentity).ok) {
      setComposerError("BRAND_IDENTITY_NOT_READY");
      return;
    }
    const identityContext = buildGenerationContext(activeBrandIdentity, { platform: targetPlatforms[0] ?? "facebook", targetName: activeBrandRecord.name }, requestedTopic || `an original content package for ${activeBrandRecord.name}`);
    const selectionValidation = validateContentIntelligenceSelection({
      scope: { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id },
      knowledgeItems,
      selectedKnowledgeItemIds,
      researchEvidence,
      selectedResearchEvidenceIds,
      promptBlueprints,
      selectedPromptBlueprintId,
      contentRecipes,
      selectedRecipeId,
    });
    if (!selectionValidation.ok) {
      setComposerError(selectionValidation.issues.map((issue) => `${issue.id}: ${issue.message}`).join(" "));
      return;
    }
    const selectedRecipe = selectionValidation.selectedRecipe;
    const recipeCompatible = selectedRecipe ? selectedRecipe.platforms.some((platform) => targetPlatforms.includes(platform)) && selectedRecipe.contentKinds.some((kind) => contentKinds.includes(kind)) : true;
    if (selectedRecipeId && (!selectedRecipe || !recipeCompatible)) {
      setComposerError("RECIPE_INCOMPATIBLE");
      return;
    }
    if (!activeStrategyCatalog) {
      setComposerError("STRATEGY_CATALOG_REQUIRED");
      return;
    }
    const objectiveChoice = ({ Reach: "reach", Engagement: "engagement", Education: "education", Knowledge: "knowledge", Conversion: "conversion" } as Record<string, string>)[String(form.objective ?? "").trim()] ?? (String(form.objective ?? "").trim().toLowerCase() || "mix");
    const pillarValue = String(form.contentPillar ?? "").trim();
    const pillarChoice = activeStrategyCatalog.pillars.find((pillar) => pillar.id === pillarValue || pillar.label.toLowerCase() === pillarValue.toLowerCase())?.id ?? (pillarValue || "mix");
    const angleValue = String(form.contentAngle ?? "").trim();
    const angleChoice = activeStrategyCatalog.pillars.flatMap((pillar) => pillar.angles).find((angle) => angle.id === angleValue || angle.label.toLowerCase() === angleValue.toLowerCase())?.id ?? (angleValue || "mix");
    const strategyResult = prepareStrategyGenerationForChannels({ catalog: activeStrategyCatalog, channels: targetPlatforms, format: generationFormat, selection: { objective: objectiveChoice as never, pillar: pillarChoice, angle: angleChoice }, slotIndex: 0 });
    if (!strategyResult.ok) {
      setComposerError(strategyResult.message);
      return;
    }
    const resolvedStrategies = Object.fromEntries(Object.entries(strategyResult.strategies).map(([channel, strategy]) => {
      const strategySnapshot = strategySnapshotFromResolved(strategy as unknown as Record<string, unknown>, generationFormat, selectedRecipe?.id);
      return [channel, { ...strategy, ...(strategySnapshot.recipeId ? { recipeId: strategySnapshot.recipeId } : {}), strategySnapshot }];
    })) as typeof strategyResult.strategies;
    const resolvedStrategy = resolvedStrategies[targetPlatforms[0] ?? "facebook"]!;
    const strategySnapshot = strategySnapshotFromResolved(resolvedStrategy as unknown as Record<string, unknown>, generationFormat, selectedRecipe?.id);
    const strategySnapshotsByChannel = Object.fromEntries(Object.entries(resolvedStrategies).map(([channel, strategy]) => [channel, strategySnapshotFromResolved(strategy as unknown as Record<string, unknown>, generationFormat, selectedRecipe?.id)]));
    if (selectedRecipe && Object.values(resolvedStrategies).some((strategy) => !validateContentRecipeForStrategy(selectedRecipe, strategy).ok)) {
      setComposerError("RECIPE_STRATEGY_MISMATCH");
      return;
    }
    const sourceItem = selectionValidation.selectedKnowledgeItems[0] ?? selectionValidation.selectedResearchEvidence[0];
    const transformValidation = validateContentTransform({ mode: transformMode, sourceRef: sourceItem?.id, rightsState: sourceItem?.rightsState, reviewState: sourceItem?.reviewState });
    if (!transformValidation.ok) {
      setComposerError(transformValidation.code);
      return;
    }
    const intelligenceContext = buildContentIntelligenceContext({
      clientId: activeWorkspaceRecord.id,
      brandId: activeBrandRecord.id,
      identityVersionId: identityContext.identityVersionId,
      knowledgeItems,
      selectedKnowledgeItemIds,
      researchEvidence,
      selectedResearchEvidenceIds,
      promptBlueprint: selectionValidation.selectedPromptBlueprint,
      recipe: selectedRecipe,
      userBrief: requestedTopic || `Create one original post for ${activeBrandRecord.name}.`,
      transformMode,
    });
    if (!intelligenceContext.ok) {
      setComposerError(intelligenceContext.code);
      return;
    }
    const requestId = globalThis.crypto.randomUUID();
    const contentRunId = `run-manual-${requestId}`;
    const initialRevisionId = initialContentRunRevisionId(contentRunId);
    const selectedBlueprint = selectionValidation.selectedPromptBlueprint;
    const promptVersion = selectedBlueprint ? `${selectedBlueprint.id}:v${selectedBlueprint.version}` : "revo-content-os-v1";
    const customerFacts = [
      structuredBrief.topic ? `Topic: ${structuredBrief.topic}` : "",
      structuredBrief.caption ? `Caption: ${structuredBrief.caption}` : "",
      structuredBrief.notes ? `Notes: ${structuredBrief.notes}` : "",
      structuredBrief.sources?.length ? `Sources: ${structuredBrief.sources.map((source) => typeof source === "string" ? source : source.url ?? source.ref ?? source.title ?? "").filter(Boolean).join(" | ")}` : "",
    ].filter(Boolean);
    const generationFields = { requestId, promptVersion, contentPillar: resolvedStrategy.pillarLabel, contentAngle: resolvedStrategy.angleLabel, objective: resolvedStrategy.objectiveLabel, strategyVersion: resolvedStrategy.strategyVersion, strategySnapshot, catalogFingerprint: resolvedStrategy.catalogFingerprint, strategyState: "clean" as const, regenerationState: "clean" as const, ...(preparedMedia.mediaSetFingerprint ? { mediaSetFingerprint: preparedMedia.mediaSetFingerprint } : {}), generationStatus: "pending" as const, ...(preparedMedia.pendingEvidence.length ? { mediaEvidence: preparedMedia.pendingEvidence } : {}) };
    const existingTopics = scopedDrafts.map((draft) => draft.title).filter(Boolean).slice(0, 30);
    const structuredBriefText = autoGenerate
      ? [
        "Revo Content OS auto-generation: create exactly one original social content package for the active brand.",
        `Brand: ${activeBrandRecord.name}`,
        existingTopics.length ? `Existing topics to avoid repeating:\n${existingTopics.map((existingTopic) => `- ${existingTopic}`).join("\n")}` : "This is the first generated topic for this brand.",
        requestedTopic ? `Operator brief (use as a direction, not as final copy): ${requestedTopic}` : "Do not ask the operator for a topic; choose the topic from the brand identity, audience, and content intelligence context.",
        "Return the complete structured Content OS payload from the resolved strategy and approved context. Do not echo placeholder/default values.",
      ].join("\n")
      : [
        `Topic: ${structuredBrief.topic ?? topic}`,
        `Content pillar: ${structuredBrief.contentPillar ?? ""}`,
        `Objective: ${structuredBrief.objective ?? ""}`,
        form.contentAngle ? `Content angle: ${form.contentAngle}` : "",
        structuredBrief.caption ? `Draft caption to improve: ${structuredBrief.caption}` : "",
        structuredBrief.cta ? `CTA: ${structuredBrief.cta}` : "",
        structuredBrief.hashtags?.length ? `Hashtags: ${structuredBrief.hashtags.join(" ")}` : "",
        structuredBrief.seoKeywords?.length ? `SEO keywords: ${structuredBrief.seoKeywords.join(", ")}` : "",
        structuredBrief.sources?.length ? `Sources: ${structuredBrief.sources.join(" | ")}` : "",
        structuredBrief.notes ? `Internal notes: ${structuredBrief.notes}` : "",
      ].filter(Boolean).join("\n");
    const mediaAttachments = preparedMedia.attachments;
    const generationPrompt = targetPlatforms.map((channel) => compileStrategyPrompt({ brandName: activeBrandRecord.name, brandVoice, channel, format: generationFormat, strategy: resolvedStrategies[channel]!, recipe: selectedRecipe, identityContext: identityContext.context, intelligenceContext: intelligenceContext.context, brief: structuredBriefText, existingTopics, customerMedia: mediaAttachments.map(({ assetId, mimeType, order, role, sha256 }) => ({ assetId, mimeType, order, role, sha256 })) })).join("\n\n");
    const generationMetadata = { identityVersionId: identityContext.identityVersionId, targetPlatform: targetPlatforms[0], promptBlueprintId: selectedBlueprint?.id || undefined, revisionId: initialRevisionId, structuredOutput: true, brandName: activeBrandRecord.name, existingTopics, assetFormat: generationFormat, resolvedStrategy, resolvedStrategiesByChannel: resolvedStrategies, strategySnapshot, strategySnapshotsByChannel, strategyVersion: resolvedStrategy.strategyVersion, catalogFingerprint: resolvedStrategy.catalogFingerprint, idempotencyKey: generationIdempotencyKey({ contentRunId, strategyVersion: resolvedStrategy.strategyVersion, format: generationFormat }) };
    const mediaAwareRequest = mediaAttachments.length > 0 ? buildMediaAwareCopyRequest({ workspaceId: brandSystem.workspaceId, prompt: generationPrompt, attachments: mediaAttachments, targetPlatforms, brandVoice, customerFacts }) : undefined;
    const generationInput = mediaAwareRequest
      ? { ...mediaAwareRequest, brandSystem, metadata: { ...mediaAwareRequest.metadata, ...generationMetadata, ...generationFields } }
      : { workspaceId: brandSystem.workspaceId, prompt: generationPrompt, targetPlatforms, contentKinds, brandSystem, modelPreference: "balanced" as const, metadata: { ...generationMetadata, ...generationFields } };
    let pendingRunPersisted = false;
    let providerDispatched = false;
    let generationResponseReceived = false;
    let completionPersistenceAttempted = false;
    let confirmedMediaEvidence: ContentRunMediaEvidence[] | undefined;
    let dispatchLineage: ContentIntelligenceLineage | undefined;
    let evidenceByVariant: Array<ContentRunMediaEvidence[] | undefined> = [];
    const draftIdBase = Date.now();
    try {
      const executionMode = form.aiMode === "web_subscription" ? "subscription_package" as const : "llm_provider" as const;
      const providerRun = form.aiMode !== "manual_assisted";
      const providerAccount = aiAccounts[form.aiProvider];
      const generationProfileId = providerRun ? `profile-${activeBrandRecord.id}-${form.aiProvider}-${providerAccount.model}` : undefined;
      if (controlPlaneClient) {
        if (providerRun && generationProfileId) {
        const profileStatus = form.aiMode === "web_subscription" ? aiAccounts[form.aiProvider].status === "web_session" ? "connected" : "not_configured" : aiAccounts[form.aiProvider].status === "configured" ? "connected" : "not_configured";
        const existingProfiles = await controlPlaneClient.listAgencyRecords("generation-profiles", { brandId: activeBrandRecord.id });
        const providerKind = form.aiProvider === "openai" ? "openai_official" : "google_gemini_api";
        const profile: GenerationProfile = { id: generationProfileId, brandId: activeBrandRecord.id, mode: executionMode, provider: providerKind, model: aiAccounts[form.aiProvider].model, capabilities: ["copy", "image", "video"], status: profileStatus as "connected" | "not_configured", ...(form.aiMode === "api" ? { secretRef: profileSecretRef(profileId, `providers/${activeWorkspaceRecord.id}/${providerKind}`) } : {}) };
        if (!existingProfiles.some((candidate) => candidate.id === generationProfileId)) await controlPlaneClient.createAgencyRecord("generation-profiles", profile as unknown as Record<string, unknown>);
        if (requestOwnsCurrentScope()) setWorkspaceState((current) => ({ ...current, generationProfiles: [...(current.generationProfiles ?? []).filter((candidate) => candidate.id !== generationProfileId), profile] }));
        }
      }
      let gateway: MockAIGateway | ManualAssistAIGateway | OfficialAIGateway | GeminiWebAIGateway | ChatGPTWebAIGateway;
      if (form.aiMode === "manual_assisted") gateway = new ManualAssistAIGateway();
      else if (form.aiProvider === "gemini" && form.aiMode === "web_subscription") gateway = new GeminiWebAIGateway({ model: aiAccounts.gemini.model });
      else if (form.aiProvider === "openai" && form.aiMode === "web_subscription") gateway = new ChatGPTWebAIGateway({ model: aiAccounts.openai.model });
      else {
        const apiKey = await readAIProviderKey(activeWorkspaceRecord.id, form.aiProvider);
        if (!apiKey) throw new Error(`No ${form.aiProvider === "openai" ? "OpenAI" : "Gemini"} API key is configured in the .env credential file. Save it in Settings or choose another AI mode.`);
        gateway = new OfficialAIGateway({ provider: form.aiProvider, apiKey, model: aiAccounts[form.aiProvider].model });
      }
      const strategyGatewayAttempts = { value: 0 };
      const strategyGateway: AIGateway = {
        generate: (request) => runStrategyGenerationWithRetry({ contentRunId, strategy: resolvedStrategy, format: generationFormat, attemptCounter: strategyGatewayAttempts, generate: () => gateway.generate(request), validate: (result) => result.variants.map((variant) => validateGeneratedStrategyOutput({ format: generationFormat, expected: resolvedStrategies[variant.platform] ?? resolvedStrategy, output: extractGeneratedContentFields(variant) })).find((check) => !check.ok) ?? { ok: true } }),
      };
      if (selectedMediaList.length > 0 && !selectedLocalAssetPath) throw new Error("IMAGE_AWARE_COPY_REQUIRES_APP_OWNED_LOCAL_ASSET");
      if (selectedMediaList.length > 0 && managedCopyProvider) {
        const copyCapability = await getManagedCopyCapability(managedCopyProvider, invoke, activeWorkspaceRecord.id);
        if (!copyCapability.live) throw new Error(copyCapability.reason ?? "IMAGE_AWARE_COPY_SESSION_NOT_VERIFIED");
      }
      const dispatch = await dispatchContentIntelligenceRun({
        runId: contentRunId,
        identityVersionId: identityContext.identityVersionId,
        userBrief: requestedTopic || `Create one original post for ${activeBrandRecord.name}.`,
        selectedKnowledgeItemIds,
        selectedResearchEvidenceIds,
        knowledgeItems,
        researchEvidence,
        promptBlueprints,
        selectedPromptBlueprintId,
        contentRecipes,
        selectedRecipeId,
        clientId: activeWorkspaceRecord.id,
        brandId: activeBrandRecord.id,
        transformMode,
        mediaSetFingerprint: preparedMedia.mediaSetFingerprint,
        mediaEvidence: preparedMedia.pendingEvidence,
        customerFacts,
        promptBuilder: (context) => targetPlatforms.map((channel) => compileStrategyPrompt({ brandName: activeBrandRecord.name, brandVoice, channel, format: generationFormat, strategy: resolvedStrategies[channel]!, recipe: selectedRecipe, identityContext: identityContext.context, intelligenceContext: context, brief: structuredBriefText, existingTopics, customerMedia: mediaAttachments.map(({ assetId, mimeType, order, role, sha256 }) => ({ assetId, mimeType, order, role, sha256 })) })).join("\n\n"),
        request: generationInput,
        gateway: strategyGateway,
        gatewayRequestCount: () => strategyGatewayAttempts.value,
        ...(mediaAttachments.length ? { mediaOwnership: controlPlaneMediaOwnershipInput(mediaAttachments) } : {}),
        ...(controlPlaneClient ? { transport: { getContentRun: (id) => controlPlaneClient.getContentRun(id), createContentRun: (payload) => controlPlaneClient.createAgencyRecord("content-runs", payload), updateContentRun: (id, payload) => controlPlaneClient.updateAgencyEntity("content-runs", id, payload) } } : {}),
        createPayload: { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id, identityVersionId: identityContext.identityVersionId, ...(generationProfileId ? { generationProfileId } : {}), executionMode, providerTraceId: "pending", topic: structuredBrief.topic, caption: structuredBrief.caption, body: structuredBrief.body, cta: structuredBrief.cta, hashtags: structuredBrief.hashtags, seoKeywords: structuredBrief.seoKeywords, scheduledAt: structuredBrief.scheduledAt, sources: structuredBrief.sources, notes: structuredBrief.notes, targetPlatforms, qualityStatus: "pending", approvalState: "pending", state: "needs_review", trigger: "manual", recipeId: selectedRecipe?.id, revisionId: initialRevisionId, ...generationFields, variants: [] },
        beforeGenerate: async () => { if (controlPlaneClient && providerRun) await controlPlaneClient.markContentRunProviderAttempt(contentRunId); providerDispatched = true; },
        onCreatePersisted: () => { pendingRunPersisted = true; recordAnalyticsEvent("content_run.created", { trigger: "manual", identityVersionId: identityContext.identityVersionId, generationProfileId, executionMode, recipeId: selectedRecipe?.id }); },
        onLineageCaptured: (captured) => { dispatchLineage = captured; },
        completionPayload: (providerResult, lineage, prompt) => {
          evidenceByVariant = mediaAttachments.length ? providerResult.variants.map((variant) => processedEvidenceForVariant(mediaAttachments, variant.metadata)) : [];
          if (mediaAttachments.length && evidenceByVariant.some((evidence) => !evidence)) throw new Error("IMAGE_ATTACHMENT_NOT_CONFIRMED");
          confirmedMediaEvidence = evidenceByVariant[0];
          const generatedFields = providerResult.variants.map((variant) => extractGeneratedContentFields(variant));
          if (providerResult.variants.length === 0 || generatedFields.some((generated) => !generated.topic || !generated.body || generated.body.length < 20 || !generated.cta || !generated.hashtags?.length || !generated.seoKeywords?.length || generationFormat === "image" && (!generated.imageConcept || !generated.imagePrompt) || generationFormat === "video" && (!generated.videoConcept || !generated.videoPrompt))) throw new Error(autoGenerate ? "AI_STRUCTURED_CONTENT_INVALID" : "CONTENT_GENERATION_EMPTY_RESULT");
          const generated = generatedFields[0] ?? {};
          return {
            ...generationFields,
            prompt,
            revisionId: initialRevisionId,
            providerTraceId: providerResult.traceId,
            topic: generated.topic ?? structuredBrief.topic,
            contentPillar: generated.contentPillar ?? resolvedStrategy.pillarLabel,
            contentAngle: generated.contentAngle ?? resolvedStrategy.angleLabel,
            objective: generated.objective ?? resolvedStrategy.objectiveLabel,
            strategyVersion: generated.strategyVersion ?? resolvedStrategy.strategyVersion,
            catalogFingerprint: generated.catalogFingerprint ?? resolvedStrategy.catalogFingerprint,
            strategySnapshot: generated.strategySnapshot ?? strategySnapshot,
            caption: generated.caption ?? generated.body ?? structuredBrief.caption,
            body: generated.body ?? generated.caption ?? structuredBrief.body,
            cta: generated.cta ?? structuredBrief.cta,
            hashtags: generated.hashtags ?? structuredBrief.hashtags ?? [],
            seoKeywords: generated.seoKeywords ?? structuredBrief.seoKeywords ?? [],
            scheduledAt: generated.scheduledAt ?? structuredBrief.scheduledAt,
            sources: generated.sources ?? structuredBrief.sources ?? [],
            notes: generated.notes ?? structuredBrief.notes,
            customerFacts: [...lineage.customerFacts],
            ...(evidenceByVariant[0] ? { mediaEvidence: evidenceByVariant[0] } : {}),
            state: "needs_review",
            qualityStatus: "pending",
            approvalState: "pending",
            variants: providerResult.variants.map((variant, index) => { const variantStrategy = resolvedStrategies[variant.platform] ?? resolvedStrategy; const variantSnapshot = strategySnapshotFromResolved(variantStrategy as unknown as Record<string, unknown>, generationFormat, selectedRecipe?.id); return { ...variant, id: `variant-${draftIdBase + index}`, contentPillar: variant.contentPillar ?? variantStrategy.pillarLabel, contentAngle: variant.contentAngle ?? variantStrategy.angleLabel, objective: variant.objective ?? variantStrategy.objectiveLabel, strategyVersion: variant.strategyVersion ?? variantStrategy.strategyVersion, catalogFingerprint: variant.catalogFingerprint ?? variantStrategy.catalogFingerprint, strategySnapshot: variant.strategySnapshot ?? variantSnapshot, metadata: { ...variant.metadata, contentIntelligenceLineage: lineage, revisionId: initialRevisionId, contentAngle: variant.contentAngle ?? variantStrategy.angleLabel, strategyVersion: variant.strategyVersion ?? variantStrategy.strategyVersion, strategySnapshot: variant.strategySnapshot ?? variantSnapshot, catalogFingerprint: variant.catalogFingerprint ?? variantStrategy.catalogFingerprint, ...(evidenceByVariant[index] ? { mediaEvidence: evidenceByVariant[index] } : {}) } }; }),
          };
        },
      });
      if (!dispatch.ok) throw new Error(dispatch.issues.map((issue) => `${issue.id}: ${issue.message}`).join(" "));
      dispatchLineage = dispatch.lineage;
      generationResponseReceived = true;
      if (controlPlaneClient) completionPersistenceAttempted = true;
      const result = dispatch.result;
      const lineage = dispatch.lineage;
      const generatedFields = result.variants.map((variant) => extractGeneratedContentFields(variant));
      if (result.variants.length === 0 || generatedFields.some((generated) => !generated.topic || !generated.body || generated.body.length < 20 || !generated.cta || !generated.hashtags?.length || !generated.seoKeywords?.length || generationFormat === "image" && (!generated.imageConcept || !generated.imagePrompt) || generationFormat === "video" && (!generated.videoConcept || !generated.videoPrompt))) {
        throw new Error(autoGenerate ? "AI_STRUCTURED_CONTENT_INVALID" : "CONTENT_GENERATION_EMPTY_RESULT");
      }
      const createdDrafts: Draft[] = result.variants.map((variant, index) => {
        const generated = generatedFields[index] ?? {};
        const variantStrategy = resolvedStrategies[variant.platform] ?? resolvedStrategy;
        const variantSnapshot = generated.strategySnapshot ?? strategySnapshotFromResolved(variantStrategy as unknown as Record<string, unknown>, generationFormat, selectedRecipe?.id);
        const objective = generated.objective ?? variantStrategy.objectiveLabel;
        return ({
        id: draftIdBase + index,
        title: generated.topic ?? variant.title ?? topic,
        topic: generated.topic ?? structuredBrief.topic ?? topic,
        platform: variant.platform === "facebook" ? "Facebook" : variant.platform === "tiktok" ? "TikTok" : variant.platform === "youtube" ? "YouTube" : "Instagram",
        status: "Needs review",
        time: `Vừa tạo · ${result.provider}`,
        tag: "AI generated",
        tone: "Brand voice",
        color: index % 2 === 0 ? "#fff5d9" : "#eef2ff",
        body: generated.body ?? variant.body ?? structuredBrief.body ?? structuredBrief.caption,
        contentPillar: generated.contentPillar ?? variantStrategy.pillarLabel,
        contentAngle: generated.contentAngle ?? variantStrategy.angleLabel,
        objective: objective as Draft["objective"],
        strategyVersion: generated.strategyVersion ?? variantStrategy.strategyVersion,
        catalogFingerprint: generated.catalogFingerprint ?? variantStrategy.catalogFingerprint,
        strategySnapshot: variantSnapshot,
        cta: generated.cta ?? structuredBrief.cta,
        hashtags: generated.hashtags?.length ? generated.hashtags : variant.hashtags?.length ? variant.hashtags : structuredBrief.hashtags,
        seoKeywords: generated.seoKeywords?.length ? generated.seoKeywords : structuredBrief.seoKeywords,
        scheduledAt: generated.scheduledAt ?? structuredBrief.scheduledAt,
        sources: (generated.sources?.length ? generated.sources : structuredBrief.sources)?.map((source) => typeof source === "string" ? source : source.url ?? source.ref ?? source.title ?? "").filter(Boolean),
        notes: generated.notes ?? structuredBrief.notes,
        prompt: dispatch.prompt,
        imageConcept: generated.imageConcept,
        imagePrompt: generated.imagePrompt,
        videoConcept: generated.videoConcept,
        videoPrompt: generated.videoPrompt,
        visualConcept: generationFormat === "video" ? generated.videoConcept : generated.imageConcept,
        visualPrompt: generationFormat === "video" ? generated.videoPrompt : generated.imagePrompt,
        strategyRationale: generated.strategyRationale,
        contentKind: generationFormat === "image" ? "image" : generationFormat === "video" ? "video" : variant.kind,
        brandId: activeBrandRecord.id,
        mediaAssetIds: preparedMedia.attachments.map((attachment) => attachment.assetId),
        mediaOperations: selectedMediaList.map((asset) => ({ kind: asset.kind === "Video" ? "video" as const : "image" as const, status: "completed" as const, provider: "existing", createdAt: new Date().toISOString() })),
        mediaEvidence: evidenceByVariant[index],
        mediaUrl: selectedMedia?.publicUrl ?? (variant.metadata as { publicUrl?: string; imageUrl?: string; videoUrl?: string }).publicUrl
          ?? (variant.metadata as { imageUrl?: string }).imageUrl
          ?? (variant.metadata as { videoUrl?: string }).videoUrl,
        mediaProvenance: selectedMedia ? { source: selectedMedia.registrationMode ?? "local", providerFileId: selectedMedia.providerFileId, attachmentAccepted: Boolean(evidenceByVariant[index]?.length), attachmentBoundary: evidenceByVariant[index]?.[0]?.attachmentBoundary ?? "not_attached" } : undefined,
        contentRunId,
        revisionId: initialRevisionId,
        identityVersionId: identityContext.identityVersionId,
        ...(providerRun ? { executionMode, generationProfileId } : {}),
        providerTraceId: result.traceId,
        generationStatus: "completed",
        videoProvider: selectedMedia?.kind === "Video" ? videoProvider : undefined,
        qualityStatus: "pending",
        approvalState: "proposed",
        researchState: selectedResearchEvidenceIds.length > 0 ? selectedResearchEvidenceIds.every((evidenceId) => researchEvidence.find((evidence) => evidence.id === evidenceId)?.reviewState === "approved") ? "VERIFIED" : "REVIEW" : "NOT_SELECTED",
        researchSourceCount: selectedResearchEvidenceIds.length,
        selectedKnowledgeItemIds: [...lineage.selectedKnowledgeItemIds],
        selectedResearchEvidenceIds: [...lineage.selectedResearchEvidenceIds],
        promptBlueprintId: lineage.selectedPromptBlueprintId || undefined,
        promptBlueprintVersion: lineage.selectedPromptBlueprintVersion,
        transformMode: lineage.transformMode,
        sourceRef: [...lineage.selectedKnowledgeItemIds, ...lineage.selectedResearchEvidenceIds][0],
        recipeId: lineage.selectedRecipeId || undefined,
        mediaSetFingerprint: lineage.mediaSetFingerprint,
        customerFacts: [...lineage.customerFacts],
        contentIntelligenceLineage: lineage,
        generationIdempotencyKey: generationIdempotencyKey({ contentRunId, strategyVersion: generated.strategyVersion ?? variantStrategy.strategyVersion, format: generationFormat }),
        });
      });
      if (requestOwnsCurrentScope()) {
        setDrafts((current) => [...createdDrafts, ...current]);
        setFocusDraftId(createdDrafts[0]?.id);
        setNewTopic("");
        setNewContentPillar("");
        setNewObjective("");
        setNewCaption("");
        setNewCta("");
        setNewHashtags("");
        setNewSeoKeywords("");
        setNewScheduledAt("");
        setNewSources("");
        setNewNotes("");
        setComposerAssetId("");
        setShowComposer(false);
        setActiveFilter("All");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể tạo content lúc này.";
      const deterministicGenerationFailure = isDeterministicGenerationFailure(message);
      const generationStatus = error instanceof MediaOwnershipReconciliationError || providerDispatched && !deterministicGenerationFailure && (!generationResponseReceived || message === "IMAGE_ATTACHMENT_NOT_CONFIRMED") ? "unknown" as const : "failed" as const;
      if (controlPlaneClient && pendingRunPersisted && !completionPersistenceAttempted) {
        const failureEvidence = generationStatus === "failed" && confirmedMediaEvidence?.length ? confirmedMediaEvidence : generationStatus === "failed" && !providerDispatched ? preparedMedia.pendingEvidence.map((item) => ({ ...item, uploadState: "failed" as const })) : preparedMedia.pendingEvidence;
        const generationUpdate = { ...updateContentRunGeneration(generationFields, generationStatus, failureEvidence.length ? failureEvidence : undefined), ...(dispatchLineage ? contentIntelligenceLineageFields(dispatchLineage) : {}), ...(dispatchLineage ? { prompt: generationPrompt } : {}) };
        await controlPlaneClient.updateAgencyEntity("content-runs", contentRunId, generationUpdate).catch((persistError) => setComposerNotice(persistError instanceof Error ? `Generation outcome ${generationStatus}; Control Plane reconciliation required: ${persistError.message}` : `Generation outcome ${generationStatus}; Control Plane reconciliation required.`));
      }
      if (generationStatus === "unknown" || completionPersistenceAttempted) setComposerNotice("Generation outcome is unknown; reconcile the Content Run before retrying.");
      setComposerError(generationStatus === "unknown" ? `${message} · Outcome unknown; reconcile before retrying.` : message);
    }
    } finally {
      settleRevoComposerRequest({ gate: composerRequestGateRef.current, token, isCurrentScope: requestOwnsCurrentScope, setBusy: setIsGenerating });
    }
  };

  const persistedBrandBindings = (workspaceState.channelBindings ?? []).filter((binding) => binding.brandId === activeBrandRecord.id);
  const hintedConnections: SocialConnection[] = metaAccountHints.filter((account) => account.kind === "page" && metaAccessTokenConfigured).map((account) => ({
    id: `meta-page-${account.id}`,
    workspaceId: activeWorkspaceRecord.id,
    platform: "facebook" as const,
    accountId: account.id,
    displayName: account.name ?? account.id,
    status: "connected" as const,
    scopes: ["pages_manage_posts", "pages_read_engagement"],
    providerMetadata: { connectionMode: "official", tokenBoundary: "env_file", pageId: account.id },
  }));
  const persistedConnections: SocialConnection[] = persistedBrandBindings.map((binding) => ({
    id: binding.connectionId,
    workspaceId: activeWorkspaceRecord.id,
    platform: binding.platform,
    accountId: binding.targetExternalId,
    displayName: binding.targetName,
    status: binding.state === "connected" ? "connected" : binding.state === "needs_reauth" ? "needs_reauth" : binding.state === "review_required" ? "review_required" : "disabled",
    scopes: binding.platform === "facebook" ? ["pages_manage_posts", "pages_read_engagement"] : ["instagram_basic", "instagram_content_publish"],
    providerMetadata: { connectionMode: "control_plane", targetExternalId: binding.targetExternalId },
  }));
  const agencyConnections: SocialConnection[] = Array.from(new Map([...hintedConnections, ...persistedConnections].map((connection) => [connection.accountId, connection])).values());
  const metaTargetState = metaAccessTokenConfigured ? "connected" as const : metaAccountHints.length > 0 ? "needs_reauth" as const : "not_configured" as const;
  const discoveredTargets: ConnectionTarget[] = [
    ...metaAccountHints.filter((account) => account.kind === "page").map((account) => ({ id: account.id, platform: "facebook" as const, name: account.name ?? account.id, state: agencyConnections.find((connection) => connection.accountId === account.id) ? channelBindingStateForConnection(agencyConnections.find((connection) => connection.accountId === account.id)) : metaTargetState })),
    ...persistedBrandBindings.map((binding) => ({ id: binding.targetExternalId, platform: binding.platform, name: binding.targetName, state: binding.state })),
  ];
  const connectionTargets: ConnectionTarget[] = Array.from(new Map(discoveredTargets.map((target) => [target.id, target])).values()).concat(discoveredTargets.length === 0 ? [{ id: "facebook-not-configured", platform: "facebook" as const, name: "Facebook Page · not discovered", state: metaTargetState }] : []).concat([
    ...(metaAccountHints.filter((account) => account.kind === "instagram_business").length > 0
      ? metaAccountHints.filter((account) => account.kind === "instagram_business").map((account) => ({ id: account.id, platform: "instagram" as const, name: account.name ?? account.id, state: "review_required" as const }))
      : [{ id: "instagram-not-configured", platform: "instagram" as const, name: "Instagram Business · link required", state: "not_configured" as const }]),
    { id: "tiktok", platform: "tiktok" as const, name: "TikTok", state: "unsupported" as const },
    { id: "youtube", platform: "youtube" as const, name: "YouTube", state: "unsupported" as const },
  ]);
  const readyBindingCount = connectionTargets.filter((target) => presentConnectionState(target.state).selectable).length;
  const connectionDisplayNames = Object.fromEntries([
    ...agencyConnections.map((connection) => [connection.id, connection.displayName] as const),
    ...connectionTargets.flatMap((target) => [[target.id, target.name] as const, [`meta-page-${target.id}`, target.name] as const]),
    ...persistedBrandBindings.flatMap((binding) => [[binding.id, binding.targetName] as const, [binding.connectionId, binding.targetName] as const]),
  ]);
  const saveTargetBindings = (targetIds: string[], identityByTarget: Record<string, string>) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi target bindings."))) return;
    if (!currentMembership || !canRole(currentMembership.role, "manage_brand")) { setQueueNotice("Role hiện tại chỉ được xem; không có quyền sửa target bindings."); return; }
    const identities = workspaceState.brandIdentities ?? hydrateLegacyAgencyRecords(workspaceState).identities;
    const scopedIdentities = identities.filter((identity) => identity.brandId === activeBrandRecord.id);
    const connectionIdByTarget = Object.fromEntries(agencyConnections.map((connection) => [connection.accountId, connection.id]));
    const selectedTargets = connectionTargets.filter((target) => targetIds.includes(target.id));
    const retained = (workspaceState.channelBindings ?? []).filter((binding) => binding.brandId !== activeBrandRecord.id);
    const created = selectedTargets.flatMap((target) => {
      const identityId = identityByTarget[target.id] ?? scopedIdentities.find((identity) => identity.isDefault)?.id ?? scopedIdentities[0]?.id;
      if (!identityId) return [];
      return createBindingsForTargets({ brandId: activeBrandRecord.id, identityId, connectionIdByTarget, targets: [target] }).bindings;
    });
    setWorkspaceState((current) => ({ ...current, channelBindings: [...retained, ...created] }));
    setQueueNotice(`${created.length} target binding(s) saved for ${activeBrandRecord.name}. Non-ready targets remain unavailable.`);
    if (controlPlaneClient) {
      void (async () => {
        for (const target of selectedTargets) {
          const connectionId = connectionIdByTarget[target.id];
          const identityId = identityByTarget[target.id] ?? scopedIdentities.find((identity) => identity.isDefault)?.id ?? scopedIdentities[0]?.id;
          if (!connectionId || !identityId || !presentConnectionState(target.state).selectable) continue;
          try {
            const existingConnections = await controlPlaneClient.listAgencyRecords("connections", { clientId: activeWorkspaceRecord.id });
            if (!existingConnections.some((connection) => connection.id === connectionId)) {
        await controlPlaneClient.createAgencyRecord("connections", { id: connectionId, clientId: activeWorkspaceRecord.id, platform: target.platform, externalAccountId: target.id, displayName: target.name, connectionState: "connected", scopes: target.platform === "facebook" ? ["pages_manage_posts", "pages_read_engagement"] : ["instagram_basic", "instagram_content_publish"], secretRef: profileSecretRef(profileId, `workspaces/${activeWorkspaceRecord.id}/meta`) });
            }
            const binding = created.find((item) => item.targetExternalId === target.id && item.identityId === identityId);
            if (binding) await controlPlaneClient.createAgencyRecord("bindings", binding as unknown as Record<string, unknown>);
          } catch (error) {
            setQueueNotice(error instanceof Error ? error.message : "Control Plane could not persist this binding.");
          }
        }
      })();
    }
  };
  const saveTargetBindingsForBrand = (brandId: string, identityId: string, targetIds: string[], identityByTarget: Record<string, string>) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi target bindings."))) return;
    const connectionIdByTarget = Object.fromEntries(agencyConnections.map((connection) => [connection.accountId, connection.id]));
    const created = connectionTargets.filter((target) => targetIds.includes(target.id)).flatMap((target) => createBindingsForTargets({ brandId, identityId: identityByTarget[target.id] ?? identityId, connectionIdByTarget, targets: [target] }).bindings);
    if (!created.length) return;
    setWorkspaceState((current) => ({ ...current, channelBindings: [...(current.channelBindings ?? []).filter((binding) => binding.brandId !== brandId), ...created] }));
  };

  const beginConnection = async (platform: SocialPlatform) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi kết nối target mới."))) return;
    const redirectUri = META_OAUTH_REDIRECT_URI;
    if (isElectronRuntime() && (platform === "facebook" || platform === "instagram")) {
      const state = `signalflow-${platform}-${crypto.randomUUID()}`;
      registerOAuthFlow({ platform, workspaceId: activeWorkspaceRecord.id, state, profileId, profileRevision });
      const result = startOfficialOAuth({ platform, workspaceId: activeWorkspaceRecord.id, redirectUri, state, clientId: metaAppId || readMetaAppId() });
      try {
        await invoke("meta_oauth_open", { authorizationUrl: result.authorizationUrl, workspaceId: activeWorkspaceRecord.id, appId: metaAppId || readMetaAppId(), platform });
        setOauthUrl("");
        setConnectionNotice(`${platform} OAuth đã mở trong Chromium profile riêng của SignalFlow.`);
        void invoke<Record<string, unknown>>("meta_oauth_wait", { state })
          .then(applyMetaOAuthResult)
          .catch((error) => setConnectionNotice(error instanceof Error ? error.message : "Meta OAuth exchange failed."));
      } catch (error) {
        setConnectionNotice(error instanceof Error ? error.message : "Không thể mở Chromium OAuth của Meta.");
      }
      return;
    }
    if (controlPlaneClient && (platform === "facebook" || platform === "instagram")) {
      try {
        const result = await controlPlaneClient.startMetaOAuth({ workspaceId: activeWorkspaceRecord.id, redirectUri });
        registerOAuthFlow({ platform, workspaceId: activeWorkspaceRecord.id, state: result.state, profileId, profileRevision });
        setOauthUrl(result.authorizeUrl);
        setConnectionNotice(`${platform} OAuth is ready through the control plane. Provider secrets remain server-side.`);
        return;
      } catch (error) {
        setConnectionNotice(error instanceof Error ? error.message : "Control plane OAuth could not start.");
        return;
      }
    }

    const state = `signalflow-${platform}-${Date.now()}`;
    registerOAuthFlow({ platform, workspaceId: activeWorkspaceRecord.id, state, profileId, profileRevision });
    const result = startOfficialOAuth({ platform, workspaceId: activeWorkspaceRecord.id, redirectUri, state, clientId: oauthClientIds[platform] });
    setOauthUrl(result.authorizationUrl);
    setConnectionNotice(`${platform} OAuth ready. Consent URL generated for official authorization; no browser session or token was accessed.`);
    console.info("OAuth authorization boundary", result.authorizationUrl);
  };

  const openConsentPage = async () => {
    if (!oauthUrl) return;
    try {
      await openUrl(oauthUrl);
    } catch {
      setConnectionNotice("Consent URL is ready, but the desktop opener is unavailable in this preview. Use the packaged Tauri app to open it.");
    }
  };

  const runDueJobs = async () => {
    if (!currentMembership || !canRole(currentMembership.role, "schedule_content")) { setQueueNotice("Role hiện tại chỉ được xem; không có quyền chạy due jobs."); return; }
    const now = new Date();
    if (metaLiveReadiness !== "ready") {
      await runDueAutomationPlans(now, false);
      setQueueNotice("Live execution bị chặn: cần Discover Page và Page token hợp lệ trước khi chạy job.");
      return;
    }
    if (!controlPlaneClient || !durableWorkerClient) {
      setQueueNotice("Live publishing bị chặn: Control Plane và durable worker bắt buộc; renderer không gọi Meta trực tiếp.");
      return;
    }
    await runDueAutomationPlans(now, true);
    setQueueNotice("Control Plane và durable worker sở hữu live publish jobs; renderer không thực thi local publish.");
  };

  runDueJobsRef.current = runDueJobs;
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const state = schedulerStateRef.current;
      const plannerDue = getDueAutomationPlans(state.automationPlans.filter((plan) => automationPlanMatchesBrandScope(plan, state.activeBrand)).map((plan) => canonicalizeAutomationPlanScope(plan, state.activeBrand)), new Date()).length > 0;
      const publisherEligible = canAutoRunDueJobs(state.autoRunDueJobs, state.liveReadiness);
      if ((!publisherEligible && !plannerDue) || schedulerRunInFlightRef.current) return;
      schedulerRunInFlightRef.current = true;
      const run = publisherEligible ? runDueJobsRef.current() : runDueAutomationPlansRef.current(new Date(), false);
      void run.finally(() => { schedulerRunInFlightRef.current = false; });
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const retryQueueJob = (jobId: string) => {
    try {
      const retried = queueRef.current.retry(jobId, new Date(Date.now() + 5 * 60 * 1000));
      setQueueJobs(queueRef.current.list());
      setQueueRevision((value) => value + 1);
      setQueueNotice(retried?.state === "queued" ? "Job đã được đặt lại sau 5 phút." : "Job này chưa ở trạng thái retryable.");
    } catch (error) {
      setQueueNotice(error instanceof Error ? error.message : "Job này chỉ được đọc và không thể retry.");
    }
  };

  const publicationForJob = (jobId: string, publications: readonly TargetPublicationSummary[] = targetPublications) => {
    const publicationId = publicationByJobRef.current.get(jobId) ?? jobId;
    return publications.find((publication) => publication.id === publicationId || publication.workerJobId === jobId);
  };
  const applyTargetPublicationAction = async (jobId: string, action: "publish_now" | "reschedule" | "cancel", scheduledAtIso?: string, updateDraft = true, publicationOverride?: readonly TargetPublicationSummary[], actionScope?: { scopeKey: string; draftId: number; contentRunId?: string }): Promise<TargetPublicationActionOutcome> => {
    const publication = publicationForJob(jobId, publicationOverride ?? targetPublications);
    const associatedDraft = draftsRef.current.find((candidate) => candidate.contentRunId === undefined
      ? candidate.id === Number(publication?.variantId?.replace("variant-", ""))
      : `variant-${candidate.id}` === publication?.variantId);
    const effectiveActionScope = actionScope ?? (associatedDraft ? { scopeKey: draftActionScopeKey(draftActionScope(associatedDraft)), draftId: associatedDraft.id, contentRunId: associatedDraft.contentRunId } : undefined);
    const notify = (message: string) => effectiveActionScope
      ? setActionNotice(effectiveActionScope.scopeKey, effectiveActionScope.draftId, effectiveActionScope.contentRunId, message)
      : setQueueNotice(message);
    if (effectiveActionScope && !actionScopeIsCurrent(effectiveActionScope.scopeKey, effectiveActionScope.draftId, effectiveActionScope.contentRunId)) return { status: "blocked", message: "Target action scope is no longer current." };
    if (!controlPlaneClient || !publication || !Number.isSafeInteger(publication.revision)) {
      const message = "Target publication chưa được Control Plane xác nhận; trạng thái vẫn đang chờ đồng bộ.";
      notify(message);
      return { status: "blocked", code: "TARGET_PUBLICATION_NOT_READY", message };
    }
    if (publication.legacyNonLive) { const message = "Target publication là lịch sử non-live đã migrate và chỉ được đọc."; notify(message); return { status: "blocked", code: "LEGACY_NON_LIVE_ACTION_BLOCKED", message }; }
    if (publication.pendingCommandId || ["pending", "unknown"].includes(publication.commandStatus ?? "") || ["pending", "unknown", "reconciliation_required"].includes(publication.workerAckState ?? "")) {
      const message = "Target publication đang cần Control Plane/worker reconciliation; đợi đồng bộ xong rồi thử lại.";
      notify(message);
      return { status: "pending", code: "PUBLICATION_RECONCILIATION_REQUIRED", message, publication };
    }
    let scheduledAt: Date | undefined;
    if (action === "reschedule") {
      scheduledAt = scheduledAtIso ? new Date(scheduledAtIso) : undefined;
      if (!scheduledAt || !Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) { const message = "Giờ đăng mới phải nằm trong tương lai."; notify(message); return { status: "blocked", code: "TARGET_PUBLICATION_SCHEDULE_INVALID", message }; }
      const binding = workspaceState.channelBindings?.find((candidate) => candidate.id === publication.bindingId);
      const targetPageId = publication.targetExternalId ?? binding?.targetExternalId ?? "";
      if (!targetPageId) { const message = "Target publication thiếu Page identity; không thể đổi lịch an toàn."; notify(message); return { status: "blocked", code: "TARGET_PUBLICATION_TARGET_MISSING", message }; }
      const platform = publication.platform ?? binding?.platform ?? "facebook";
      const plan = publication.planId ? automationPlans.find((candidate) => candidate.id === publication.planId) : undefined;
      if (publication.planId && !plan) { const message = "Không tìm thấy kế hoạch gốc; lịch cũ vẫn được giữ."; notify(message); return { status: "blocked", code: "AUTOMATION_PLAN_MISSING", message }; }
      const reservedSlots = targetPublications.filter((candidate) => candidate.id !== publication.id && candidate.state !== "canceled" && candidate.state !== "cancelled" && candidate.scheduledAt)
        .flatMap((candidate) => {
          const candidateBinding = workspaceState.channelBindings?.find((item) => item.id === candidate.bindingId);
          const pageId = candidate.targetExternalId ?? candidateBinding?.targetExternalId;
          const candidatePlatform = candidate.platform ?? candidateBinding?.platform;
          return pageId && candidatePlatform && candidate.scheduledAt ? [`${candidatePlatform}|${pageId}|${new Date(candidate.scheduledAt).toISOString()}`] : [];
        });
      queueRef.current.list().forEach((job) => {
        if (job.id === jobId || publicationByJobRef.current.has(job.id) || job.state === "canceled") return;
        const jobBinding = workspaceState.channelBindings?.find((candidate) => candidate.id === job.bindingId);
        const pageId = jobBinding?.targetExternalId ?? job.connectionId;
        const jobPlatform = jobBinding?.platform ?? agencyConnections.find((candidate) => candidate.id === job.connectionId)?.platform;
        if (pageId && jobPlatform) reservedSlots.push(`${jobPlatform}|${pageId}|${new Date(job.scheduledAt).toISOString()}`);
      });
      if (reservedSlots.includes(`${platform}|${targetPageId}|${scheduledAt.toISOString()}`)) { const message = "Giờ đăng đã được giữ cho cùng platform và Page; lịch cũ vẫn được giữ."; notify(message); return { status: "blocked", code: "SLOT_RESERVED", message }; }
      if (plan) {
        const validation = validateAutomationPlanSchedule(plan, platform, targetPageId, scheduledAt, reservedSlots);
        if (!validation.ok) { const message = `Lịch không hợp lệ theo kế hoạch (${validation.code}); lịch cũ vẫn được giữ.`; notify(message); return { status: "blocked", code: validation.code, message }; }
      }
    }
    try {
      const result = await controlPlaneClient.targetPublicationCommand(publication.id, {
        action, clientId: publication.clientId, brandId: publication.brandId, expectedRevision: publication.revision,
        requestId: `c2-${action}-${publication.id.replace(/[^A-Za-z0-9_.:-]/g, "_")}-${publication.revision}-${Date.now()}`,
        ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
      });
      if (effectiveActionScope && !actionScopeIsCurrent(effectiveActionScope.scopeKey, effectiveActionScope.draftId, effectiveActionScope.contentRunId)) return { status: "blocked", message: "Target action scope is no longer current." };
      if (result.commandStatus !== "acknowledged") {
        const pendingSummary = targetPublicationSummary(result);
        setTargetPublications((current) => effectiveActionScope && !actionScopeIsCurrent(effectiveActionScope.scopeKey, effectiveActionScope.draftId, effectiveActionScope.contentRunId) ? current : current.map((candidate) => candidate.id === publication.id ? {
          ...candidate,
          commandStatus: pendingSummary.commandStatus ?? "pending",
          pendingCommandId: pendingSummary.pendingCommandId,
          workerAckState: pendingSummary.workerAckState ?? (pendingSummary.commandStatus === "failed" ? candidate.workerAckState : "reconciliation_required"),
        } : candidate));
        const message = `Target publication command đang chờ đồng bộ: ${String(result.commandError ?? result.commandStatus ?? "reconciliation required")}.`;
        notify(message);
        return { status: "pending", code: String(result.commandError ?? result.commandStatus ?? "PUBLICATION_COMMAND_PENDING"), message, publication };
      }
      const parsed = targetPublicationSummary(result);
      const updatedPublication = { ...publication, ...Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined && value !== "")) } as TargetPublicationSummary;
      if (scheduledAt) updatedPublication.scheduledAt = scheduledAt.toISOString();
      setTargetPublications((current) => effectiveActionScope && !actionScopeIsCurrent(effectiveActionScope.scopeKey, effectiveActionScope.draftId, effectiveActionScope.contentRunId) ? current : current.map((candidate) => candidate.id === publication.id ? updatedPublication : candidate));
      if (updatedPublication.workerJobId) publicationByJobRef.current.set(updatedPublication.workerJobId, updatedPublication.id);
      const localJob = queueRef.current.list().find((candidate) => candidate.id === jobId);
      if (localJob && action === "cancel") queueRef.current.cancel(jobId);
      if (localJob && action === "reschedule" && scheduledAt) queueRef.current.reschedule(jobId, scheduledAt);
      if (localJob && action !== "publish_now") { setQueueJobs(queueRef.current.list()); setQueueRevision((value) => value + 1); }
      const draft = draftsRef.current.find((candidate) => candidate.contentRunId === undefined ? candidate.id === Number(publication.variantId?.replace("variant-", "")) : `variant-${candidate.id}` === publication.variantId);
      if (updateDraft && draft && action !== "publish_now") {
        const siblings = targetPublications.filter((candidate) => candidate.variantId === publication.variantId);
        const resultingSiblings = siblings.map((candidate) => candidate.id === publication.id ? updatedPublication : candidate);
        if (action === "cancel" && resultingSiblings.length > 0 && resultingSiblings.every((candidate) => candidate.state === "canceled" || candidate.state === "cancelled")) {
          setDrafts((current) => current.map((candidate) => candidate.id === draft.id ? { ...candidate, status: "Needs review", approvalState: "proposed", queueJobId: undefined, queueJobIds: [], time: "Đã hủy lịch · cần duyệt lại" } : candidate));
        } else if (action === "reschedule" && siblings.length === 1 && scheduledAt) {
          setDrafts((current) => current.map((candidate) => candidate.id === draft.id ? { ...candidate, scheduledAt: scheduledAt!.toISOString(), time: `Đã đổi lịch · ${scheduledAt!.toLocaleString("vi-VN")}` } : candidate));
        }
      }
      const providerConfirmed = action === "publish_now" && updatedPublication.state === "published" && Boolean(updatedPublication.providerJobId?.trim());
      const status: TargetPublicationActionOutcome["status"] = action === "publish_now" ? providerConfirmed ? "provider_confirmed" : "pending" : "acknowledged";
      const message = action === "publish_now"
        ? providerConfirmed ? "Control Plane and provider confirmed publish-now for the selected target." : "Control Plane and worker acknowledged publish-now; waiting for provider confirmation."
        : action === "cancel" ? "Control Plane and worker acknowledged target cancellation." : `Control Plane and worker acknowledged the new schedule · ${scheduledAt?.toLocaleString("vi-VN")}.`;
      notify(message);
      return { status, code: providerConfirmed ? "LIVE_PROVIDER_ACKNOWLEDGED" : action === "publish_now" ? "PROVIDER_CONFIRMATION_PENDING" : "TARGET_PUBLICATION_COMMAND_ACKNOWLEDGED", message, publication: updatedPublication };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Control Plane chưa xác nhận command; trạng thái cũ vẫn được giữ.";
      notify(message);
      return { status: "blocked", code: error instanceof ControlPlaneError ? error.code : "TARGET_PUBLICATION_COMMAND_FAILED", message };
    }
  };
  const applyRescheduleQueueJob = (jobId: string, scheduledAtIso: string) => applyTargetPublicationAction(jobId, "reschedule", scheduledAtIso);
  const rescheduleQueueJob = (jobId: string) => {
    const current = displayQueueJobs.find((job) => job.id === jobId);
    const initial = new Date(Math.max(Date.now() + 60 * 60 * 1000, current ? new Date(current.scheduledAt).getTime() : Date.now() + 60 * 60 * 1000));
    setReschedulePromptValue(dateTimeLocalValue(initial));
    setReschedulePromptJobId(jobId);
  };
  const cancelQueueJob = async (jobId: string, updateDraft = true, publicationOverride?: readonly TargetPublicationSummary[]): Promise<boolean> => {
    const canceled = await applyTargetPublicationAction(jobId, "cancel", undefined, updateDraft, publicationOverride);
    if (canceled.status !== "acknowledged") return false;
    const reservationKey = reservationByJobRef.current.get(jobId);
    if (reservationKey) { automationLedgerRef.current.release(reservationKey); reservationByJobRef.current.delete(jobId); syncLedgerState(); }
    return true;
  };
  const switchToWorkspace = (workspaceId: string) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi chuyển workspace."))) return;
    const membership = workspaceState.memberships.find((item) => item.workspaceId === workspaceId && item.userId === activeUserId);
    if (!membership) {
      setQueueNotice("Bạn chưa là thành viên của workspace này.");
      return;
    }
    setWorkspaceState((current) => switchWorkspace(current, workspaceId));
    setActiveNav("Command center");
    setSavedNotice(`Đã chuyển sang workspace ${workspaceState.workspaces.find((item) => item.id === workspaceId)?.name ?? workspaceId}.`);
    window.setTimeout(() => setSavedNotice(""), 2400);
  };
  const switchUserProfile = async (nextProfileId: string) => {
    if (nextProfileId === profileId) { setShowProfileMenu(false); return; }
    if (composerBusy || plannerRunBusy) { setQueueNotice("Chờ lượt tạo nội dung hoàn tất trước khi chuyển hồ sơ."); return; }
    if (isElectronRuntime()) {
      try {
        await activateUserProfile(
          nextProfileId,
          () => invoke("profile_activate", { profileId: nextProfileId }),
          undefined,
          (previousProfileId) => invoke("profile_activate", { profileId: previousProfileId }),
        );
      } catch (error) {
        if (error instanceof Error && ["PROFILE_REGISTRY_UPDATE_FAILED", "PROFILE_REGISTRY_CORRUPT", "PROFILE_RUNTIME_ROLLBACK_FAILED"].includes(error.message)) {
          window.location.reload();
          return;
        }
        setQueueNotice(error instanceof Error ? error.message : "Không thể chuyển runtime của hồ sơ người dùng.");
        return;
      }
    } else if (!setActiveUserProfile(nextProfileId)) {
      setQueueNotice("Không thể chuyển hồ sơ người dùng.");
      return;
    }
    window.location.reload();
  };
  const createUserProfile = () => {
    const displayName = window.prompt("Tên người dùng mới");
    if (!displayName?.trim()) return;
    const profile = createEmptyProfile(displayName);
    setUserProfiles(saveUserProfile(profile));
    void switchUserProfile(profile.id);
  };
  const switchToBrand = (brandId: string) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi chuyển Brand."))) return;
    setWorkspaceState((current) => switchBrand(current, brandId));
    setActiveNav("Brand system");
  };
  const brandLifecycleActor = (brandId?: string): BrandLifecycleActor | undefined => {
    const brand = brandId ? workspaceState.brands.find((candidate) => candidate.id === brandId && clientIdForBrand(candidate) === activeBrandScope.clientId) : undefined;
    const membership = brandId
      ? brand && workspaceState.memberships.find((candidate) => candidate.workspaceId === clientIdForBrand(brand) && candidate.userId === activeUserId && candidate.status === "active")
      : workspaceState.memberships.find((candidate) => candidate.workspaceId === activeBrandScope.clientId && candidate.userId === activeUserId && candidate.status === "active");
    if (!membership || !canRole(membership.role, "manage_brand")) return undefined;
    const role = membership.role === "owner" || membership.role === "admin" ? membership.role : undefined;
    return role ? { actorUserId: activeUserId, role, capability: "manage_brand" } : undefined;
  };
  const saveStrategyCatalog = async (catalog: BrandStrategyCatalog, scopeKey: string, capturedRevision: number): Promise<StrategyCatalogSaveResult> => {
    const { clientId, brandId, scopeKey: expectedScopeKey } = activeBrandScope;
    if (scopeKey !== expectedScopeKey) return { currentScope: false, error: "Strategy catalog scope changed; draft was not written." };
    if (!controlPlaneClient) return { currentScope: true, error: "Control Plane chưa sẵn sàng; draft được giữ lại." };
    const actor = brandLifecycleActor(brandId);
    const identity = resolveActiveBrandIdentity(brandId, workspaceStateRef.current.brandIdentities ?? hydrateLegacyAgencyRecords(workspaceStateRef.current).identities);
    const validation = validateStrategyCatalog(catalog);
    if (!actor || !identity?.isDefault) return { currentScope: true, error: "Cần default Brand Identity và quyền manage_brand để lưu catalog." };
    if (!validation.ok || catalog.brandId !== brandId) return { currentScope: true, error: validation.ok ? "STRATEGY_CATALOG_SCOPE_MISMATCH" : validation.errors.join(" · ") };
    const requestId = ++strategyCatalogRequestIdRef.current;
    try {
      const response = await controlPlaneClient.updateIdentityPayload(identity.id, {
        strategyCatalog: structuredClone(catalog),
        clientId,
        brandId,
        scopeKey,
        expectedVersion: catalog.version,
        expectedRevision: capturedRevision,
        fingerprint: strategyCatalogFingerprint(catalog),
        actor,
      } as unknown as Pick<Record<string, unknown>, "strategy" | "voice" | "visual">);
      if (requestId !== strategyCatalogRequestIdRef.current || !strategyCatalogScopeMatchesState(workspaceStateRef.current, { clientId, brandId, scopeKey })) return { currentScope: false, error: "Strategy catalog response belongs to an older scope." };
      const savedCatalog = response.strategyCatalog as BrandStrategyCatalog | undefined;
      const responseRevision = response.strategyCatalogRevision ?? response.revision;
      const revision = typeof responseRevision === "number" && Number.isSafeInteger(responseRevision) ? responseRevision : undefined;
      if (!strategyCatalogResponseMatchesSaveAck(response, { clientId, brandId, scopeKey }, catalog, capturedRevision) || !savedCatalog) return { currentScope: true, error: "STRATEGY_CATALOG_ACK_INVALID" };
      if (revision === undefined) return { currentScope: true, error: "STRATEGY_CATALOG_ACK_REVISION_INVALID" };
      setWorkspaceState((current) => !strategyCatalogScopeMatchesState(current, { clientId, brandId, scopeKey }) ? current : ({ ...current, strategyCatalogsByBrand: { ...(current.strategyCatalogsByBrand ?? {}), [scopeKey]: structuredClone(savedCatalog) } }));
      setStrategyCatalogRevision(revision);
      setStrategyCatalogError("");
      return { currentScope: true, acknowledged: true, catalog: savedCatalog, revision, fingerprint: typeof response.fingerprint === "string" ? response.fingerprint : undefined };
    } catch (error) {
      if (requestId !== strategyCatalogRequestIdRef.current || !strategyCatalogScopeMatchesState(workspaceStateRef.current, { clientId, brandId, scopeKey })) return { currentScope: false, error: "Strategy catalog response belongs to an older scope." };
      return { currentScope: true, error: error instanceof Error ? error.message : "STRATEGY_CATALOG_SAVE_REJECTED" };
    }
  };
  const reloadStrategyCatalog = async (): Promise<void> => {
    const { clientId, brandId, scopeKey } = activeBrandScope;
    if (!controlPlaneClient) throw new Error("Control Plane chưa sẵn sàng; catalog local chưa bị thay đổi.");
    const requestId = ++strategyCatalogRequestIdRef.current;
    const recovery = await controlPlaneClient.agencyRecovery();
    if (requestId !== strategyCatalogRequestIdRef.current || !strategyCatalogScopeMatchesState(workspaceStateRef.current, { clientId, brandId, scopeKey })) return;
    const recoveryBrand = recovery.brands.find((item) => String(item.id ?? "") === brandId && String(item.client_id ?? item.clientId ?? "") === clientId);
    const identity = recoveryBrand
      ? recovery.identities.find((item) => String(item.brand_id ?? item.brandId ?? "") === brandId && Boolean(item.is_default ?? item.isDefault) && item.strategyCatalog)
      : undefined;
    const candidate = identity?.strategyCatalog as BrandStrategyCatalog | undefined;
    if (!candidate || !validateStrategyCatalog(candidate).ok || candidate.brandId !== brandId) throw new Error("STRATEGY_CATALOG_MISSING");
    setWorkspaceState((current) => !strategyCatalogScopeMatchesState(current, { clientId, brandId, scopeKey }) ? current : ({ ...current, strategyCatalogsByBrand: { ...(current.strategyCatalogsByBrand ?? {}), [scopeKey]: structuredClone(candidate) } }));
    setStrategyCatalogRevision(Number(identity?.strategyCatalogRevision ?? 0) || 0);
    setStrategyCatalogError("");
  };
  const setBrandDeleteUiState = (token: BrandLifecycleRequestToken, status: "pending" | "reconciling" | "unknown", message: string) => {
    setBrandDeleteStates((current) => setBrandUiScopeEntry(current, token, { status, requestId: token.requestId, message }));
  };
  const clearBrandDeleteUiState = (token: BrandLifecycleRequestToken) => {
    setBrandDeleteStates((current) => {
      if (current[token.scopeKey]?.requestId !== token.requestId) return current;
      return clearBrandUiScopeEntry(current, token);
    });
  };
  const brandDeleteRequestOwnsCurrentUi = (token: BrandLifecycleRequestToken): boolean => {
    const current = workspaceStateRef.current;
    return profileId === token.profileId
      && profileRevision === token.profileRevision
      && activeWorkspace(current).id === token.clientId
      && activeBrand(current).id === token.brandId
      && brandDeleteLatestRequestRef.current.get(token.scopeKey) === token.requestId;
  };
  const setBrandDeleteNoticeIfCurrent = (token: BrandLifecycleRequestToken, message: string) => {
    if (brandDeleteRequestOwnsCurrentUi(token)) setQueueNotice(message);
  };
  const applyAcknowledgedBrandDelete = (token: BrandDeleteRequestToken, authority: Record<string, unknown>) => {
    const sourceState = workspaceStateRef.current;
    const ownerClientIds = [...new Set(sourceState.brands.filter((brand) => brand.id === token.brandId).map((brand) => brand.clientId ?? brand.workspaceId))];
    const matchesSource = (value: unknown) => brandDeleteRecordMatchesScope(value, token, ownerClientIds);
    const currentAssets = [...assetsRef.current, ...automationStateRef.current.mediaAssets];
    const currentDrafts = draftsRef.current;
    const currentCreativeRuns = automationStateRef.current.creativeRuns;
    const retainedSharedAssets = new Set(currentAssets.filter((asset) => {
      if (!matchesSource(asset)) return false;
      const metadata = asset as typeof asset & { shared?: boolean; sharedBrandIds?: string[] };
      const flaggedShared = metadata.shared === true || asset.distribution === "universal" || (metadata.sharedBrandIds?.length ?? 0) > 0;
      const referencedByOtherDraft = currentDrafts.some((draft) => !matchesSource(draft) && draft.mediaAssetIds?.some((assetId) => String(assetId) === String(asset.id)));
      const referencedByOtherCreativeRun = currentCreativeRuns.some((run) => !matchesSource(run) && run.mediaAssetId !== undefined && String(run.mediaAssetId) === String(asset.id));
      return flaggedShared || referencedByOtherDraft || referencedByOtherCreativeRun;
    }).map((asset) => String(asset.id)));
    const preservedSharedMediaIds = authority.preservedSharedMediaIds;
    if (Array.isArray(preservedSharedMediaIds)) {
      preservedSharedMediaIds.forEach((assetId) => {
        const id = String(assetId);
        if (currentAssets.some((asset) => matchesSource(asset) && String(asset.id) === id)) retainedSharedAssets.add(id);
      });
    }
    const sourceAssetIds = new Set(currentAssets.filter(matchesSource).map((asset) => String(asset.id)));
    const otherScopeAssetIds = new Set(currentAssets.filter((asset) => !matchesSource(asset)).map((asset) => String(asset.id)));
    const privateDeletedAssetIds = new Set([...sourceAssetIds].filter((assetId) => !retainedSharedAssets.has(assetId) && !otherScopeAssetIds.has(assetId)));
    const retainedReservations = automationLedgerRef.current.list().filter((reservation) => !privateDeletedAssetIds.has(String(reservation.assetId)));
    automationLedgerRef.current = hydrateReservationLedger(retainedReservations);
    const retainedReservationKeys = new Set(retainedReservations.map((reservation) => reservation.reservationKey));
    for (const [jobId, reservationKey] of reservationByJobRef.current) if (!retainedReservationKeys.has(reservationKey)) reservationByJobRef.current.delete(jobId);
    setWorkspaceState((current) => removeBrandRecordsForScope(current, token));
    setAutomationPlans((current) => current.filter((plan) => !matchesSource(plan)));
    setContentRecipes((current) => current.filter((recipe) => !matchesSource(recipe)));
    setContentTemplates((current) => current.filter((template) => !matchesSource(template)));
    setDrafts((current) => current.filter((draft) => !matchesSource(draft) || draft.status === "Published"));
    setAssets((current) => current.filter((asset) => !matchesSource(asset) || !privateDeletedAssetIds.has(String(asset.id))).map((asset) => matchesSource(asset) && retainedSharedAssets.has(String(asset.id)) ? { ...asset, distribution: "universal" as const } : asset));
    setAutomationState((current) => ({
      ...current,
      brandPlans: current.brandPlans.filter((plan) => !matchesSource(plan)),
      mediaAssets: current.mediaAssets.filter((asset) => !matchesSource(asset) || !privateDeletedAssetIds.has(String(asset.id))).map((asset) => matchesSource(asset) && retainedSharedAssets.has(String(asset.id)) ? { ...asset, distribution: "universal" as const } : asset),
      reservations: current.reservations.filter((reservation) => !privateDeletedAssetIds.has(String(reservation.assetId))),
      creativeRuns: current.creativeRuns.filter((run) => !matchesSource(run)),
    }));
    setKnowledgeItems((current) => current.filter((item) => !matchesSource(item)));
    setResearchEvidence((current) => current.filter((item) => !matchesSource(item)));
    setPromptBlueprints((current) => current.filter((item) => !matchesSource(item)));
    setAnalyticsEvents((current) => current.filter((event) => !matchesSource(event)));
    setTargetPublications((current) => current.filter((publication) => !matchesSource(publication) || publication.state === "published"));
    setAuthoritativeBrandImpacts((current) => clearBrandUiScopeEntry(current, token));
  };
  const trashBrandFromSettings = async (brandId: string) => {
    const actor = brandLifecycleActor(brandId);
    if (!actor) { setQueueNotice("Role hiện tại không có quyền xóa brand."); return; }
    if (!controlPlaneClient) { setQueueNotice("Không thể đưa brand vào Đã xóa: Control Plane chưa sẵn sàng."); return; }
    const brand = workspaceState.brands.find((candidate) => candidate.id === brandId);
    if (!brand) { setQueueNotice("Không tìm thấy brand cần xóa."); return; }
    const clientId = brand.clientId ?? brand.workspaceId;
    try {
      await controlPlaneClient.recoverPublicationCommands();
      const listBrandPublications = async () => (await controlPlaneClient.listAgencyRecords("target-publications", { clientId, brandId })).map((row) => targetPublicationSummary(row as Record<string, unknown>));
      const publications = await listBrandPublications();
      if (publications.some((publication) => publication.clientId !== clientId || publication.brandId !== brandId)) throw new Error("BRAND_PUBLICATIONS_SCOPE_MISMATCH");
      const terminalStates = new Set(["published", "canceled", "cancelled", "failed", "permanent_error", "approval_failed", "blocked"]);
      const cancellations = await Promise.all(publications.filter((publication) => !terminalStates.has(publication.state)).map((publication) => cancelQueueJob(publication.workerJobId ?? publication.id, false, publications)));
      if (cancellations.some((confirmed) => !confirmed)) throw new Error("BRAND_PUBLICATION_CANCEL_UNCONFIRMED");
      await controlPlaneClient.recoverPublicationCommands();
      const reconciledPublications = await listBrandPublications();
      if (reconciledPublications.some((publication) => publication.clientId !== clientId || publication.brandId !== brandId || !targetPublicationSafeForBrandTrash(publication))) throw new Error("BRAND_PUBLICATIONS_RECONCILIATION_REQUIRED");

      const localJobs = queueRef.current.list().filter((job) => job.brandId === brandId && !["published", "canceled", "permanent_error"].includes(job.state));
      const publicationForLocalJob = (jobId: string) => reconciledPublications.find((publication) => publication.id === jobId || publication.workerJobId === jobId);
      const unmatchedLocalJobs = localJobs.filter((job) => !publicationForLocalJob(job.id));
      if (unmatchedLocalJobs.some((job) => durableWorkerJobIdsRef.current.has(job.id) && !durableWorkerClient)) throw new Error("DURABLE_WORKER_RECONCILIATION_REQUIRED");
      const workerRows = unmatchedLocalJobs.length && durableWorkerClient ? await durableWorkerClient.listJobs(clientId) : [];
      const workerCancellations: string[] = [];
      for (const job of localJobs) {
        const publication = publicationForLocalJob(job.id);
        if (publication) {
          if (publication.state === "published") queueRef.current.syncExternalResult(job.id, publication.providerJobId, "completed");
          else if (["failed", "permanent_error", "approval_failed", "blocked"].includes(publication.state)) queueRef.current.syncExternalResult(job.id, publication.providerJobId, "failed");
          else if (queueRef.current.cancel(job.id)?.state !== "canceled") throw new Error("LOCAL_QUEUE_CANCEL_UNCONFIRMED");
          continue;
        }
        const workerJob = workerRows.find((record) => record.id === job.id);
        if (workerJob) {
          if (workerJob.state === "completed") queueRef.current.syncExternalResult(job.id, workerJob.provider_job_id ?? undefined, "completed", undefined, workerJob.attempts);
          else if (workerJob.state === "failed") queueRef.current.syncExternalResult(job.id, workerJob.provider_job_id ?? undefined, "failed", workerJob.last_error ?? undefined, workerJob.attempts);
          else if (workerJob.state === "canceled") {
            if (queueRef.current.cancel(job.id)?.state !== "canceled") throw new Error("LOCAL_QUEUE_RECONCILIATION_REQUIRED");
          }
          else {
            if (!durableWorkerClient || !Number.isSafeInteger(workerJob.revision)) throw new Error("DURABLE_WORKER_RECONCILIATION_REQUIRED");
            const canceled = await durableWorkerClient.cancel(job.id, workerJob.revision, `brand-trash-${brandId.replace(/[^A-Za-z0-9_.:-]/g, "_")}-${job.id.replace(/[^A-Za-z0-9_.:-]/g, "_")}-${workerJob.revision}`);
            if (canceled.state !== "canceled") throw new Error("DURABLE_WORKER_CANCEL_UNCONFIRMED");
            workerCancellations.push(job.id);
            if (queueRef.current.cancel(job.id)?.state !== "canceled") throw new Error("LOCAL_QUEUE_CANCEL_UNCONFIRMED");
          }
        } else {
          if (durableWorkerJobIdsRef.current.has(job.id) || queueRef.current.cancel(job.id)?.state !== "canceled") throw new Error("LOCAL_QUEUE_RECONCILIATION_REQUIRED");
        }
      }
      if (workerCancellations.length) {
        const finalWorkerRows = await durableWorkerClient!.listJobs(clientId);
        if (workerCancellations.some((jobId) => finalWorkerRows.find((record) => record.id === jobId)?.state !== "canceled")) throw new Error("DURABLE_WORKER_RECONCILIATION_REQUIRED");
      }
      const unresolvedLocalJobs = queueRef.current.list().filter((job) => job.brandId === brandId && !["published", "canceled", "permanent_error"].includes(job.state));
      if (unresolvedLocalJobs.length) throw new Error("LOCAL_QUEUE_RECONCILIATION_REQUIRED");
      setQueueJobs(queueRef.current.list());
      setQueueRevision((value) => value + 1);
      if (brandId === activeBrandRecord.id) setTargetPublications(reconciledPublications);
      const freshPreview = buildBrandTrashPreview(workspaceState, brandId, { drafts, plans: automationPlans, publications: [...reconciledPublications, ...queueRef.current.list().filter((job) => job.brandId === brandId)], assets, countsKnown: true });
      const authority = await controlPlaneClient.trashBrand(brandId, actor);
      if (authority.status !== "archived") throw new Error("BRAND_TRASH_NOT_ACKNOWLEDGED");
      const result = trashBrand(workspaceState, brandId, freshPreview);
      const authorityDeletedAt = typeof authority.deletedAt === "string" ? authority.deletedAt : result.state.brands.find((brand) => brand.id === brandId)?.deletedAt;
      setWorkspaceState({ ...result.state, brands: result.state.brands.map((brand) => brand.id === brandId && authorityDeletedAt ? { ...brand, deletedAt: authorityDeletedAt, status: "archived" as const } : brand) });
      setAutomationPlans((current) => current.map((plan) => plan.brandId === brandId ? { ...plan, status: "paused" as const } : plan));
      setQueueNotice(`Đã đưa brand “${result.preview.brandName}” vào Đã xóa. ${result.preview.draftCount} bản nháp · ${result.preview.planCount} kế hoạch · ${result.preview.unsentScheduleCount} lịch chưa gửi · ${result.preview.sharedMediaCount} media dùng chung.`);
    } catch (error) { setQueueNotice(error instanceof Error ? error.message : "Không thể đưa brand vào Đã xóa."); }
  };
  const restoreBrandFromSettings = async (brandId: string): Promise<BrandDeleteOutcome> => {
    const actor = brandLifecycleActor(brandId);
    if (!actor) { setQueueNotice("Role hiện tại không có quyền khôi phục brand."); return { status: "rejected", code: "BRAND_MANAGE_FORBIDDEN" }; }
    if (!controlPlaneClient) { setQueueNotice("Không thể khôi phục brand: Control Plane chưa sẵn sàng."); return { status: "rejected", code: "CONTROL_PLANE_UNCONFIGURED" }; }
    const brand = workspaceStateRef.current.brands.find((candidate) => candidate.id === brandId && (candidate.clientId ?? candidate.workspaceId) === activeWorkspaceRecord.id);
    if (!brand) { setQueueNotice("Không tìm thấy brand cần khôi phục."); return { status: "rejected", code: "BRAND_NOT_FOUND" }; }
    const scope: BrandDeleteScope = { profileId, profileRevision, clientId: brand.clientId ?? brand.workspaceId, brandId, brandName: brand.name };
    const outcome = await runBrandRestoreLifecycle({
      lock: brandDeleteInFlightRef.current,
      unknownRequests: brandDeleteUnknownRef.current,
      scope,
      deadlineMs: 30_000,
      onRequestStarted: (token) => {
        brandDeleteLatestRequestRef.current.set(token.scopeKey, token.requestId);
        setBrandDeleteUiState(token, "pending", "Đang chờ Control Plane xác nhận khôi phục…");
      },
      onReconciliationStarted: (token) => setBrandDeleteUiState(token, "reconciling", "Đang đối soát kết quả khôi phục với Control Plane…"),
      dispatch: (token) => controlPlaneClient.restoreBrand(token.brandId, { ...actor }),
      reconcile: async (token) => {
        const recovery = await controlPlaneClient.agencyRecovery();
        const row = recovery.brands.find((candidate) => String(candidate.id ?? "") === token.brandId && String(candidate.clientId ?? candidate.client_id ?? "") === token.clientId);
        if (!row || row.status === "archived" || row.deletedAt || row.deleted_at) return undefined;
        return { id: token.brandId, brandId: token.brandId, clientId: token.clientId, name: token.brandName, status: "draft" };
      },
      isCurrent: (token) => {
        const current = workspaceStateRef.current.brands.find((candidate) => candidate.id === token.brandId && (candidate.clientId ?? candidate.workspaceId) === token.clientId);
        return Boolean(current?.deletedAt);
      },
      commit: (token) => setWorkspaceState((current) => {
        const ownerClientIds = [...new Set(current.brands.filter((candidate) => candidate.id === token.brandId).map((candidate) => candidate.clientId ?? candidate.workspaceId))];
        if (!brandDeleteRecordMatchesScope(current.brands.find((candidate) => candidate.id === token.brandId && (candidate.clientId ?? candidate.workspaceId) === token.clientId), token, ownerClientIds)) return current;
        return { ...current, brands: current.brands.map((candidate) => brandDeleteRecordMatchesScope(candidate, token, ownerClientIds) && candidate.deletedAt ? { ...candidate, status: "draft" as const, deletedAt: undefined } : candidate) };
      }),
    });
    const token = { ...scope, operation: "restore" as const, requestId: outcome.requestId ?? "", scopeKey: brandDeleteScopeKey(scope) };
    if (outcome.status === "acknowledged") {
      clearBrandDeleteUiState(token);
      setBrandDeleteNoticeIfCurrent(token, "Brand đã khôi phục ở trạng thái draft; kế hoạch không tự bật lại.");
    } else if (outcome.status === "unknown") {
      setBrandDeleteUiState(token, "unknown", "Chưa xác định kết quả khôi phục; cần đối soát trước khi thử lại.");
      setBrandDeleteNoticeIfCurrent(token, "Chưa xác định kết quả khôi phục; cần đối soát trước khi thử lại.");
    } else if (outcome.status === "rejected") {
      clearBrandDeleteUiState(token);
      setBrandDeleteNoticeIfCurrent(token, `Control Plane chưa xác nhận khôi phục (${outcome.code ?? "rejected"}); dữ liệu cục bộ vẫn được giữ.`);
    }
    return outcome;
  };
  const permanentlyDeleteBrandFromSettings = async (brandId: string, confirmation: string): Promise<BrandDeleteOutcome> => {
    const currentState = workspaceStateRef.current;
    const brand = currentState.brands.find((candidate) => candidate.id === brandId && (candidate.clientId ?? candidate.workspaceId) === activeWorkspaceRecord.id);
    const actor = brandLifecycleActor(brandId);
    if (!actor) { setQueueNotice("Role hiện tại không có quyền xóa vĩnh viễn brand."); return { status: "rejected", code: "BRAND_MANAGE_FORBIDDEN" }; }
    if (!controlPlaneClient) { setQueueNotice("Không thể xóa vĩnh viễn brand: Control Plane chưa sẵn sàng."); return { status: "rejected", code: "CONTROL_PLANE_UNCONFIGURED" }; }
    if (!brand) { setQueueNotice("Không tìm thấy brand."); return { status: "rejected", code: "BRAND_NOT_FOUND" }; }
    const clientId = brand.clientId ?? brand.workspaceId;
    const scopeKey = brandDeleteScopeKey({ profileId, profileRevision, clientId, brandId });
    const localValidation = permanentlyDeleteBrand(currentState, brandId, confirmation, clientId);
    if (!localValidation.ok) {
      const message = localValidation.code === "BRAND_NAME_CONFIRMATION_REQUIRED" ? "Tên xác nhận không khớp hoặc brand chưa ở Đã xóa." : "Không tìm thấy brand.";
      setQueueNotice(message);
      return { status: "rejected", code: localValidation.code };
    }
    const impact = brandTrashPreviews[scopeKey];
    if (!isAuthoritativeBrandImpact(impact) || typeof impact.revision !== "string" || !impact.revision) {
      const outcome = { status: "rejected" as const, code: "BRAND_IMPACT_REQUIRED" };
      setQueueNotice("Impact chưa được Control Plane xác nhận; chưa thể xóa brand.");
      return outcome;
    }
    const scope: BrandDeleteScope = { profileId, profileRevision, clientId, brandId, brandName: brand.name, impactRevision: impact.revision };
    const requestId = `brand-delete-${++brandDeleteRequestSequenceRef.current}`;
    const outcome = await runBrandDeleteLifecycle({
      lock: brandDeleteInFlightRef.current,
      unknownRequests: brandDeleteUnknownRef.current,
      scope,
      confirmation,
      requestId,
      onRequestStarted: (token) => {
        brandDeleteLatestRequestRef.current.set(token.scopeKey, token.requestId);
        setBrandDeleteUiState(token, "pending", "Đang chờ Control Plane xác nhận xóa…");
      },
      onReconciliationStarted: (token) => setBrandDeleteUiState(token, "reconciling", "Đang đối soát kết quả xóa với Control Plane…"),
      preDispatchReconcile: async (token) => {
        const rows = await controlPlaneClient.listBrandDeletionOperations(token.brandId);
        if (rows.length === 0) return undefined;
        return reconcileBrandDeleteOperations(rows, token);
      },
      dispatch: (token) => controlPlaneClient.permanentlyDeleteBrand(token.brandId, { ...actor, confirmation, ...(token.impactRevision ? { expectedImpactRevision: token.impactRevision } : {}) }),
      reconcile: async (token) => {
        const rows = await controlPlaneClient.listBrandDeletionOperations(token.brandId);
        const reconciliation = reconcileBrandDeleteOperations(rows, token);
        if (reconciliation.status === "completed") return reconciliation.ack;
        if (reconciliation.status === "rejected") throw new Error(reconciliation.code);
        if (reconciliation.status === "pending") return undefined;
        try {
          const refreshed = normalizeBrandImpactPreview(await controlPlaneClient.brandImpactPreview(token.brandId), token.brandId);
          if (!brandImpactPreviewMatchesBrand(refreshed, { id: token.brandId, clientId: token.clientId })) throw new Error("BRAND_DELETE_RECONCILIATION_SCOPE_MISMATCH");
          const { counts, ...identity } = refreshed;
          setAuthoritativeBrandImpacts((current) => setBrandUiScopeEntry(current, token, { ...identity, ...counts, source: "control_plane", countsKnown: true }));
          // An archived Brand while an operation is pending remains unresolved; only a
          // scoped terminal deletion operation above may authorize local cleanup.
        } catch (error) {
          return undefined;
        }
        return undefined;
      },
      commit: (token, authority) => applyAcknowledgedBrandDelete(token, authority),
    });
    if (outcome.requestId) {
      if (outcome.status === "pending") {
        const token = { ...scope, operation: "permanent-delete" as const, requestId: outcome.requestId, scopeKey: brandDeleteScopeKey(scope) };
        setBrandDeleteUiState(token, "pending", "Brand đang có thao tác lifecycle khác chưa hoàn tất; chưa thể xóa tiếp.");
      } else if (outcome.status === "acknowledged") {
        clearBrandDeleteUiState({ ...scope, operation: "permanent-delete", requestId: outcome.requestId, scopeKey: brandDeleteScopeKey(scope) });
        setBrandDeleteNoticeIfCurrent({ ...scope, operation: "permanent-delete", requestId: outcome.requestId, scopeKey: brandDeleteScopeKey(scope) }, "Brand đã được xóa vĩnh viễn khỏi dữ liệu SignalFlow. Bài đã đăng và file nguồn dùng chung vẫn được giữ.");
      } else if (outcome.status === "unknown") {
        const token = { ...scope, operation: "permanent-delete" as const, requestId: outcome.requestId, scopeKey: brandDeleteScopeKey(scope) };
        setBrandDeleteUiState(token, "unknown", "Chưa xác định kết quả; cần đối soát trước khi thử lại.");
        setBrandDeleteNoticeIfCurrent(token, "Chưa xác định kết quả; cần đối soát trước khi thử lại.");
      } else {
        const token = { ...scope, operation: "permanent-delete" as const, requestId: outcome.requestId, scopeKey: brandDeleteScopeKey(scope) };
        clearBrandDeleteUiState(token);
        setBrandDeleteNoticeIfCurrent(token, outcome.code === "BRAND_NAME_CONFIRMATION_REQUIRED" ? "Tên xác nhận không khớp hoặc brand chưa ở Đã xóa." : `Control Plane chưa xác nhận xóa (${outcome.code ?? "rejected"}); dữ liệu cục bộ vẫn được giữ.`);
      }
    }
    return outcome;
  };
  const addClient = () => {
    if (!currentMembership || !canRole(currentMembership.role, "manage_workspace")) { setQueueNotice("Role hiện tại chỉ được xem; không có quyền tạo Client."); return; }
    const name = setupName.trim();
    if (!name) return;
    const id = `client-${Date.now()}`;
    const client = createClient(name, activeWorkspaceRecord.timezone, id);
    const brandId = `brand-${id}`;
    const brand = createBrandDraft(id, `${name} Brand`, brandId);
    const identity = { id: `identity-${brandId}-v1`, brandId, name: "Default identity", isDefault: true, version: 1, status: "draft" as const, strategy: { vision: name, mission: "", values: [], personality: [], audience: "" }, voice: { tone: "", vocabulary: [], prohibitedClaims: [] }, visual: { logoAssetIds: [], colors: [{ name: "Primary", hex: "#4f46e5" }], typography: { heading: "SF Pro Display", body: "SF Pro Text" }, styleGuide: "" } };
    const membership = { id: `member-${id}`, workspaceId: id, userId: activeUserId, displayName: userProfiles.find((profile) => profile.id === profileId)?.displayName ?? "Người dùng", email: "", role: "owner" as const, status: "active" as const };
    setWorkspaceState((current) => ({ ...current, activeWorkspaceId: id, activeBrandId: brandId, workspaces: [...current.workspaces, { ...client, brandIds: [brandId] }], brands: [...current.brands, brand], memberships: [...current.memberships, membership], brandIdentities: [...(current.brandIdentities ?? hydrateLegacyAgencyRecords(current).identities), identity] }));
    const actor = brandLifecycleActor();
    if (controlPlaneClient) void (async () => {
      const expected = { clientId: id, clientName: name, timezone: client.timezone, brandId, brandName: brand.name };
      await awaitAgencyMigration(agencyMigrationFlightRef.current, `${profileId}:${profileRevision}`, agencyMigrationCommitted);
      try {
        await controlPlaneClient.createAgencyRecord("clients", { id, name, timezone: client.timezone, status: "active" });
      } catch (error) {
        if (!await reconcileAgencyCreateConflict(controlPlaneClient, error, CLIENT_CREATE_CONFLICT_CODES, (recovery) => clientCreateConflictMatchesRecovery(recovery, expected))) throw error;
        return;
      }
      try {
        await controlPlaneClient.createAgencyRecord("brands", { id: brandId, clientId: id, name: brand.name, status: "draft", ...(actor ? { actor } : {}) });
      } catch (error) {
        if (!await reconcileAgencyCreateConflict(controlPlaneClient, error, BRAND_CREATE_CONFLICT_CODES, (recovery) => clientCreateConflictMatchesRecovery(recovery, expected))) throw error;
        return;
      }
      try {
        await controlPlaneClient.createAgencyRecord("identities", identity as unknown as Record<string, unknown>);
      } catch (error) {
        if (!await reconcileAgencyCreateConflict(controlPlaneClient, error, IDENTITY_CREATE_CONFLICT_CODES, (recovery) => clientCreateConflictMatchesRecovery(recovery, expected))) throw error;
      }
    })().catch((error) => setQueueNotice(error instanceof Error ? error.message : "Control Plane could not persist the new Client."));
    setSetupName(""); setShowClientSetup(false); setSavedNotice("Client và Brand draft đầu tiên đã được tạo. Hoàn thiện identity trước khi kích hoạt automation.");
  };
  const openBrandSetup = () => {
    if (!currentMembership || !canRole(currentMembership.role, "manage_brand")) { setQueueNotice("Role hiện tại chỉ được xem; không có quyền tạo Brand."); return; }
    setSetupName("");
    setBrandSetupStep(1);
    setBrandSetupTargets([]);
    setBrandSetupForm({ identityName: "Default identity", vision: "", mission: "", values: "", personality: "", audience: "", positioning: "", tone: "", vocabulary: "", prohibitedClaims: "", requiredDisclosure: "", logoAssetIds: "", tagline: "", primary: "#4f46e5", primaryRgb: "", primaryCmyk: "", secondary: "#f6f7fb", secondaryRgb: "", secondaryCmyk: "", typography: "SF Pro Display", styleGuide: "" });
    setShowBrandWizard(true);
  };
  const addBrand = () => {
    if (!currentMembership || !canRole(currentMembership.role, "manage_brand")) { setQueueNotice("Role hiện tại chỉ được xem; không có quyền tạo Brand."); return; }
    const name = setupName.trim();
    if (!name) return;
    const id = `brand-${Date.now()}`;
    const brand = createBrandDraft(activeWorkspaceRecord.id, name, id);
    const identityCandidate: BrandIdentityRecord = { id: `identity-${id}-v1`, brandId: id, name: brandSetupForm.identityName.trim() || "Default identity", isDefault: true, version: 1, status: "draft", strategy: { vision: brandSetupForm.vision.trim() || name, mission: brandSetupForm.mission.trim(), values: brandSetupForm.values.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean), personality: brandSetupForm.personality.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean), audience: brandSetupForm.audience.trim(), positioning: brandSetupForm.positioning.trim() }, voice: { tone: brandSetupForm.tone.trim(), vocabulary: brandSetupForm.vocabulary.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean), prohibitedClaims: brandSetupForm.prohibitedClaims.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean), requiredDisclosure: brandSetupForm.requiredDisclosure.trim() }, visual: { logoAssetIds: brandSetupForm.logoAssetIds.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean), tagline: brandSetupForm.tagline.trim(), colors: [{ name: "Primary", hex: brandSetupForm.primary, rgb: brandSetupForm.primaryRgb.trim() || undefined, cmyk: brandSetupForm.primaryCmyk.trim() || undefined }, { name: "Secondary", hex: brandSetupForm.secondary, rgb: brandSetupForm.secondaryRgb.trim() || undefined, cmyk: brandSetupForm.secondaryCmyk.trim() || undefined }], typography: { heading: brandSetupForm.typography.trim() || "SF Pro Display", body: brandSetupForm.typography.trim() || "SF Pro Text" }, styleGuide: brandSetupForm.styleGuide.trim() } };
    const identity = validateBrandIdentity(identityCandidate).ok ? { ...identityCandidate, status: "active" as const } : identityCandidate;
    setWorkspaceState((current) => ({ ...current, activeBrandId: id, workspaces: current.workspaces.map((workspace) => workspace.id === activeWorkspaceRecord.id ? { ...workspace, brandIds: [...workspace.brandIds, id] } : workspace), brands: [...current.brands, brand], brandIdentities: [...(current.brandIdentities ?? hydrateLegacyAgencyRecords(current).identities), identity], brandVoiceByBrand: { ...current.brandVoiceByBrand, [id]: identity.voice.tone } }));
    const actor = brandLifecycleActor();
    if (controlPlaneClient) void (async () => {
      const expected = { brandId: id, clientId: activeWorkspaceRecord.id, brandName: name };
      await awaitAgencyMigration(agencyMigrationFlightRef.current, `${profileId}:${profileRevision}`, agencyMigrationCommitted);
      try {
        await controlPlaneClient.createAgencyRecord("brands", { id, clientId: activeWorkspaceRecord.id, name, status: "draft", ...(actor ? { actor } : {}) });
      } catch (error) {
        if (!await reconcileAgencyCreateConflict(controlPlaneClient, error, BRAND_CREATE_CONFLICT_CODES, (recovery) => brandCreateConflictMatchesRecovery(recovery, expected))) throw error;
        return;
      }
      try {
        await controlPlaneClient.createAgencyRecord("identities", identity as unknown as Record<string, unknown>);
      } catch (error) {
        if (!await reconcileAgencyCreateConflict(controlPlaneClient, error, IDENTITY_CREATE_CONFLICT_CODES, (recovery) => brandCreateConflictMatchesRecovery(recovery, expected))) throw error;
      }
    })().catch((error) => setQueueNotice(error instanceof Error ? error.message : "Control Plane could not persist the new Brand."));
    setSetupName(""); setShowBrandWizard(false); setBrandSetupStep(1); setActiveNav("Brand system"); setSavedNotice(identity.status === "active" ? "Brand đã tạo với identity active." : "Brand draft đã tạo. Hoàn thiện identity trong Hệ thống brand trước khi kích hoạt automation.");
    if (brandSetupTargets.length > 0) {
      const identityMap = Object.fromEntries(brandSetupTargets.map((targetId) => [targetId, identity.id]));
      window.setTimeout(() => saveTargetBindingsForBrand(id, identity.id, brandSetupTargets, identityMap), 0);
    }
  };
  const useTemplate = (template: ContentTemplate) => {
    if (!currentMembership || !canRole(currentMembership.role, "create_content")) {
      setQueueNotice("Role hiện tại không có quyền tạo content.");
      return;
    }
    const isScoped = template.workspaceId === workspaceState.activeWorkspaceId && template.brandId === workspaceState.activeBrandId && template.active;
    if (!isScoped) {
      setQueueNotice("Template không thuộc brand/workspace đang active hoặc đang inactive.");
      return;
    }
    setNewTopic([template.name, template.hook, template.bodyTemplate, template.defaultCta].filter(Boolean).join("\n\n"));
    setShowComposer(true);
  };
  const addTemplate = () => {
    if (!currentMembership || !canRole(currentMembership.role, "manage_brand")) {
      setQueueNotice("Chỉ owner/admin mới có thể tạo content template.");
      return;
    }
    const template: ContentTemplate = {
      id: `template-${Date.now()}`,
      workspaceId: workspaceState.activeWorkspaceId,
      brandId: workspaceState.activeBrandId,
      name: "New controlled template",
      description: "Template mới cần được hoàn thiện trước khi dùng trong production.",
      kind: "text",
      platforms: ["Facebook", "Instagram"],
      hook: "Start with one clear insight…",
      bodyTemplate: "Context → practical steps → evidence note.",
      defaultCta: "Save this for later.",
      active: false,
    };
    setContentTemplates((current) => [template, ...current]);
    setSavedNotice("Template mới đã được tạo ở trạng thái inactive.");
    window.setTimeout(() => setSavedNotice(""), 2400);
  };
  const exportDiagnostics = () => {
    const queueSnapshot = queueRef.current.snapshot();
    void downloadLocalJson(`signalflow-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, {
      exportedAt: new Date().toISOString(),
      schemaVersion: 3,
      activeNav,
      queue: {
        jobs: queueSnapshot.jobs,
        variants: queueSnapshot.variants.map(({ metadata: _metadata, ...variant }) => variant),
        connections: queueSnapshot.connections.map(({ providerMetadata: _providerMetadata, ...connection }) => connection),
      },
      workspace: { id: activeWorkspaceRecord?.id, name: activeWorkspaceRecord?.name, timezone: activeWorkspaceRecord?.timezone, activeBrand: activeBrandRecord?.name, membershipRole: currentMembership?.role },
      drafts: drafts.map(({ id, title, platform, status, time, tag, tone }) => ({ id, title, platform, status, time, tag, tone })),
      mediaAssets: assets.map(({ id, name, kind, status, size, usage, publicUrl, checksum, registrationMode }) => ({ id, name, kind, status, size, usage, publicUrl, checksum, registrationMode })),
      auditEntries: (queueSnapshot.auditEntries ?? []).slice(-100),
      contentTemplates: contentTemplates.filter((template) => template.workspaceId === workspaceState.activeWorkspaceId).map(({ id, name, kind, platforms, active }) => ({ id, name, kind, platforms, active })),
      automationPlanner: buildSafePlannerDiagnostics({
        plans: automationPlans.map(({ id, workspaceId, brandId, status, cron, targetPageIds, lastDueAt }) => ({ id, workspaceId, brandId, status, cron, targetPageIds, lastDueAt })),
        runs: automationState.creativeRuns,
        drafts: drafts.map(({ id, automationKey, status }) => ({ id, automationKey, status })),
        mediaAssets: canonicalMedia,
      }),
      note: "Sanitized local diagnostics. Planner run fields are explicitly allowlisted; prompts, responses, traces, paths, provider metadata, credentials, and browser session data are excluded. Native credentials and session data are never exported.",
    }).catch((error) => setQueueNotice(error instanceof Error ? error.message : "Không thể xuất diagnostics."));
  };
  const exportMigrationBackup = () => {
    const queueSnapshot = queueRef.current.snapshot();
    const safeQueue = {
      jobs: queueSnapshot.jobs.map(({ id, variantId, connectionId, scheduledAt, idempotencyKey, state, attempts, providerJobId, clientId, brandId, bindingId, identityVersionId, simulation, legacyNonLive }) => ({ id, variantId, connectionId, scheduledAt, idempotencyKey, state, attempts, providerJobId, clientId, brandId, bindingId, identityVersionId, ...(legacyNonLive || simulation === true ? { legacyNonLive: true } : {}) })),
      variants: queueSnapshot.variants.map(({ id, contentId, platform, kind, title, body, mediaAssetIds, hashtags, lifecycle }) => ({ id, contentId, platform, kind, title, body, mediaAssetIds, hashtags, lifecycle, metadata: {} })),
      connections: queueSnapshot.connections.map(({ id, workspaceId, platform, accountId, displayName, status, scopes, expiresAt }) => ({ id, workspaceId, platform, accountId, displayName, status, scopes, expiresAt, providerMetadata: {} })),
      auditEntries: queueSnapshot.auditEntries,
    };
    const backup = sanitizeSnapshotForExport(preparePersistedSnapshot({ drafts, selectedPlatforms, queue: safeQueue, brandSystem: { ...defaultBrandSystem, workspaceId: activeBrandRecord?.systemId ?? defaultBrandSystem.workspaceId, voice: brandVoice }, mediaAssets: assets, workspaceState: { ...workspaceState, contentRecipes }, contentTemplates, automationPlans, automationState: { ...automationState, imageProvider, videoProvider, automationAI }, controlPlaneMigrated: agencyMigrationCommitted }));
    void downloadLocalJson(`signalflow-migration-backup-${new Date().toISOString().slice(0, 10)}.json`, { ...backup, exportedAt: new Date().toISOString(), note: "Sanitized renderer recovery snapshot. Provider credentials, cookies, browser storage and auth-file paths are excluded; SQLite backup is stored separately." }).then((location) => setQueueNotice(`Migration backup exported: ${location}`)).catch((error) => setQueueNotice(error instanceof Error ? error.message : "Không thể xuất migration backup."));
  };
  const exportAnalyticsReport = () => {
    void downloadLocalJson(`signalflow-analytics-${new Date().toISOString().slice(0, 10)}.json`, {
      exportedAt: new Date().toISOString(),
      source: "control-plane analytics events",
      scope: { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id },
      events: analyticsEvents,
      targetPublications,
      freshness: controlPlaneHealth,
      status: analyticsEvents.length > 0 ? "instrumented_event_export" : "NOT_INSTRUMENTED",
      note: "No reach/engagement value is fabricated. The export contains only scalar Control Plane events and target-publication states.",
    }).catch((error) => setQueueNotice(error instanceof Error ? error.message : "Không thể xuất analytics report."));
  };

  const refreshContentRuns = async () => {
    if (!controlPlaneClient) return;
    try {
      const runs = await controlPlaneClient.listAgencyRecords("content-runs", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id });
      setSavedNotice(`Content OS synced · ${runs.length} persisted run(s)`);
      window.setTimeout(() => setSavedNotice(""), 2400);
    } catch (error) {
      setQueueNotice(error instanceof Error ? error.message : "Content OS sync failed; local recovery remains available.");
    }
  };

  const updateDraft = async (id: number, patch: RevoDraftPatch) => {
    const currentDraft = draftsRef.current.find((draft) => draft.id === id);
    if (!currentDraft) return;
    if (draftActionLocked(currentDraft)) { setQueueNotice("Content Run đang kiểm tra hoặc chờ approval reconciliation; không thể sửa revision này."); return; }
    const actionScopeKey = draftActionScopeKey(draftActionScope(currentDraft));
    if (patch.restoreRevisionId) {
      await restoreDraftRevision(id, patch.restoreRevisionId);
      return;
    }
    if (currentDraft.status === "Published" || currentDraft.approvalState === "published") {
      setQueueNotice("Published content is read-only; create a new Content Run to change it.");
      return;
    }
    const normalized = normalizeEditableFields({
      topic: patch.topic ?? patch.title ?? currentDraft.topic ?? currentDraft.title,
      contentPillar: patch.contentPillar ?? currentDraft.contentPillar,
      contentAngle: patch.contentAngle ?? currentDraft.contentAngle,
      objective: patch.objective ?? currentDraft.objective,
      caption: patch.body ?? currentDraft.body,
      body: patch.body ?? currentDraft.body,
      cta: patch.cta ?? currentDraft.cta,
      hashtags: patch.hashtags ?? currentDraft.hashtags,
      seoKeywords: patch.seoKeywords ?? currentDraft.seoKeywords,
      scheduledAt: patch.scheduledAt ?? currentDraft.scheduledAt,
      sources: patch.sources ?? currentDraft.sources,
      notes: patch.notes ?? currentDraft.notes,
    });
    const strategyChanged = patch.contentPillar !== undefined || patch.contentAngle !== undefined || patch.objective !== undefined;
    const nextPatch: Partial<Draft> = {
      ...patch,
      ...normalized,
      title: normalized.topic ?? patch.title ?? currentDraft.title,
      topic: normalized.topic ?? patch.topic ?? currentDraft.topic ?? currentDraft.title,
      objective: normalized.objective as Draft["objective"],
      sources: normalized.sources?.map((source) => typeof source === "string" ? source : source.url ?? source.ref ?? source.title ?? "").filter(Boolean),
      qualityStatus: "pending",
      qualityChecks: undefined,
      approvalState: "proposed",
      ...(strategyChanged ? { regenerationState: "needs_regeneration" as const, strategyState: "needs_regeneration" as const } : {}),
    };
    if (controlPlaneClient && currentDraft.contentRunId) {
      try {
        await controlPlaneClient.updateAgencyEntity("content-runs", currentDraft.contentRunId, {
        planId: currentDraft.planId,
        targetBindingIds: currentDraft.bindingIds,
        bindingIds: currentDraft.bindingIds,
        topic: nextPatch.topic,
        contentPillar: nextPatch.contentPillar,
        contentAngle: nextPatch.contentAngle,
        objective: nextPatch.objective,
        strategyVersion: currentDraft.strategyVersion,
        strategySnapshot: currentDraft.strategySnapshot,
        regenerationState: nextPatch.regenerationState ?? currentDraft.regenerationState,
        strategyState: nextPatch.strategyState ?? currentDraft.strategyState ?? currentDraft.regenerationState,
        caption: nextPatch.body,
        body: nextPatch.body,
        cta: nextPatch.cta,
        hashtags: nextPatch.hashtags,
        seoKeywords: nextPatch.seoKeywords,
        scheduledAt: nextPatch.scheduledAt,
        sources: nextPatch.sources,
        notes: nextPatch.notes,
        qualityStatus: "pending",
        approvalState: "pending",
        state: "needs_review",
          variants: [{ id: `${currentDraft.contentRunId}-variant-${currentDraft.id}`, platform: currentDraft.platform.toLowerCase(), kind: nextPatch.contentKind ?? currentDraft.contentKind ?? "text", title: nextPatch.title ?? currentDraft.title, body: nextPatch.body ?? currentDraft.body ?? "", caption: nextPatch.body ?? currentDraft.body ?? "", contentPillar: nextPatch.contentPillar ?? currentDraft.contentPillar, contentAngle: nextPatch.contentAngle ?? currentDraft.contentAngle, objective: nextPatch.objective ?? currentDraft.objective, strategyVersion: currentDraft.strategyVersion, strategySnapshot: currentDraft.strategySnapshot, cta: nextPatch.cta ?? currentDraft.cta, hashtags: nextPatch.hashtags ?? currentDraft.hashtags ?? [], seoKeywords: nextPatch.seoKeywords ?? currentDraft.seoKeywords ?? [], mediaAssetIds: currentDraft.mediaAssetIds ?? [], mediaOperations: currentDraft.mediaOperations ?? [], metadata: { mediaEvidence: currentDraft.mediaEvidence ?? [], ...(currentDraft.imageConcept ? { imageConcept: currentDraft.imageConcept } : {}), ...(currentDraft.imagePrompt ? { imagePrompt: currentDraft.imagePrompt } : {}), ...(currentDraft.videoConcept ? { videoConcept: currentDraft.videoConcept } : {}), ...(currentDraft.videoPrompt ? { videoPrompt: currentDraft.videoPrompt } : {}), ...(currentDraft.strategyRationale ? { strategyRationale: currentDraft.strategyRationale } : {}) } }],
          mediaOperations: currentDraft.mediaOperations ?? [],
          visualOperations: currentDraft.mediaOperations ?? [],
          trace: { providerTraceId: currentDraft.providerTraceId, imageProvider: currentDraft.imageProvider, videoProvider: currentDraft.videoProvider, executionMode: currentDraft.executionMode },
          providerTraceId: currentDraft.providerTraceId,
        });
      } catch (error) {
        setActionNotice(actionScopeKey, id, currentDraft.contentRunId, error instanceof Error ? error.message : "Content Run could not be persisted.");
        return;
      }
    }
    setDraftsForAction(actionScopeKey, id, currentDraft.contentRunId, (draft) => ({ ...draft, ...nextPatch }));
    setDraftActionFeedbackFor(actionScopeKey, "quality", undefined);
    setDraftActionFeedbackFor(actionScopeKey, "approval", undefined);
    setDraftActionFeedbackFor(actionScopeKey, "publish", undefined);
    setActionSavedNotice(actionScopeKey, id, currentDraft.contentRunId, "Thay đổi content đã được lưu vào local draft; bấm Quality check trước khi duyệt.");
    if (actionScopeIsCurrent(actionScopeKey, id, currentDraft.contentRunId)) window.setTimeout(() => { if (actionScopeIsCurrent(actionScopeKey, id, currentDraft.contentRunId)) setSavedNotice(""); }, 2400);
  };

  const qualityChecksForDraft = (draft: Draft): QualityCheck[] => {
    const body = draft.body?.trim() ?? "";
    const sources = draft.sources?.filter(Boolean) ?? [];
    const visual = Boolean(draft.mediaUrl || draft.mediaAssetIds?.length || draft.mediaOperation?.status === "completed");
    return [
      { key: "hook", passed: Boolean((draft.topic ?? draft.title).trim()), message: "Hook mở bài" },
      { key: "caption", passed: body.length >= 80, message: "Caption >= 80 characters" },
      { key: "cta", passed: Boolean(draft.cta?.trim()), message: "CTA rõ ràng" },
      { key: "hashtags", passed: Boolean(draft.hashtags?.length && draft.hashtags.length <= 10), message: "1–10 hashtags" },
      { key: "visual", passed: visual, message: "Visual attached or generated" },
      { key: "playbook", passed: true, message: "Marketing playbook" },
      { key: "strategy", passed: Boolean(draft.contentPillar?.trim() && draft.objective && (!draft.strategySnapshot && draft.strategyVersion === undefined && !draft.contentAngle ? true : draft.contentAngle?.trim())), message: "Pillar + angle + objective" },
      { key: "format", passed: Boolean(draft.platform), message: "Format" },
      { key: "sources", passed: sources.length > 0 || !/facts?|research|according|theo nghiên cứu/i.test(body), message: "Sources when factual" },
      { key: "research", passed: draft.researchState !== "REVIEW", message: "Research Brief reviewed" },
    ];
  };

  const buildContentRunFromDraft = (draft: Draft): ContentRun & { planId?: string } => {
    const variant = draftToVariant(draft);
    const lineage = draft.contentIntelligenceLineage ?? captureContentIntelligenceLineage({ selectedKnowledgeItemIds: draft.selectedKnowledgeItemIds ?? [], selectedResearchEvidenceIds: draft.selectedResearchEvidenceIds ?? [], selectedPromptBlueprintId: draft.promptBlueprintId, selectedPromptBlueprintVersion: draft.promptBlueprintVersion, selectedRecipeId: draft.recipeId, transformMode: draft.transformMode ?? "original", mediaSetFingerprint: draft.mediaSetFingerprint, customerFacts: draft.customerFacts ?? [] });
    const contentRun = createContentRun({
      id: draft.contentRunId ?? `content-${draft.id}`,
      clientId: activeWorkspaceRecord.id,
      brandId: draft.brandId ?? activeBrandRecord.id,
      identityVersionId: draft.identityVersionId ?? activeBrandIdentity?.id ?? `identity-${activeBrandRecord.id}-v1`,
      generationProfileId: draft.generationProfileId ?? "manual-review",
      executionMode: draft.executionMode ?? "llm_provider",
      providerTraceId: draft.providerTraceId ?? "renderer-manual",
      trigger: draft.automationKey ? "automation" : "manual",
      prompt: draft.prompt,
      topic: draft.topic ?? draft.title,
      contentPillar: draft.contentPillar,
      contentAngle: draft.contentAngle,
      objective: draft.objective,
      strategyVersion: draft.strategyVersion,
      catalogFingerprint: draft.catalogFingerprint,
      strategySnapshot: draft.strategySnapshot,
      regenerationState: draft.regenerationState,
      strategyState: draft.strategyState ?? draft.regenerationState,
      caption: draft.body,
      body: draft.body,
      cta: draft.cta,
      hashtags: draft.hashtags,
      seoKeywords: draft.seoKeywords,
      scheduledAt: draft.scheduledAt,
      sources: draft.sources,
      notes: draft.notes,
      ...contentRunRevisionFieldsFromDraft(draft),
      ...contentIntelligenceLineageFields(lineage),
      targetPlatforms: [draft.platform.toLowerCase() as SocialPlatform],
      targetBindingIds: draft.bindingIds,
      bindingIds: draft.bindingIds,
      trace: { providerTraceId: draft.providerTraceId, imageProvider: draft.imageProvider, videoProvider: draft.videoProvider, executionMode: draft.executionMode, generationIdempotencyKey: draft.generationIdempotencyKey },
      qualityStatus: draft.qualityStatus ?? "pending",
      qualityChecks: draft.qualityChecks?.map((check) => ({ key: check.key, passed: check.ok, message: check.message })),
      approvalState: draft.approvalState === "ready" || draft.approvalState === "scheduled" || draft.approvalState === "published" ? "approved" : "pending",
      visualOperations: (draft.mediaOperations ?? (draft.mediaOperation ? [draft.mediaOperation] : [])).filter((operation) => operation.kind === "image" || operation.kind === "video").map(contentOperationFromAsset),
      mediaOperations: (draft.mediaOperations ?? (draft.mediaOperation ? [draft.mediaOperation] : [])).map(contentOperationFromAsset),
      variants: [{ id: variant.id, platform: variant.platform, kind: variant.kind, body: variant.body ?? "", title: variant.title, caption: draft.body, contentPillar: draft.contentPillar, contentAngle: draft.contentAngle, objective: draft.objective, strategyVersion: draft.strategyVersion, catalogFingerprint: draft.catalogFingerprint, strategySnapshot: draft.strategySnapshot, cta: draft.cta, hashtags: draft.hashtags, seoKeywords: draft.seoKeywords, mediaAssetIds: draft.mediaAssetIds ?? [], mediaOperations: (draft.mediaOperations ?? []).map(contentOperationFromAsset), metadata: { mediaEvidence: draft.mediaEvidence ?? [], contentIntelligenceLineage: lineage, generationIdempotencyKey: draft.generationIdempotencyKey, ...(draft.imageConcept ? { imageConcept: draft.imageConcept } : {}), ...(draft.imagePrompt ? { imagePrompt: draft.imagePrompt } : {}), ...(draft.videoConcept ? { videoConcept: draft.videoConcept } : {}), ...(draft.videoPrompt ? { videoPrompt: draft.videoPrompt } : {}), ...(draft.strategyRationale ? { strategyRationale: draft.strategyRationale } : {}) } }],
    });
    const persistedRun = (draft.regenerationState === "needs_regeneration" || draft.strategyState === "needs_regeneration") ? markNeedsRegeneration(contentRun) : contentRun;
    return { ...persistedRun, planId: draft.planId };
  };

  const performQualityCheckDraft = async (id: number): Promise<DraftActionOutcome> => {
    const draft = draftsRef.current.find((item) => item.id === id);
    if (!draft) return { status: "failure", message: "Draft không còn trong workspace hiện tại." };
    if (draft.status === "Scheduled" || draft.status === "Published" || draft.approvalState === "scheduled" || draft.approvalState === "publishing" || draft.approvalState === "published") return { status: "failure", message: "Quality check bị chặn khi Content Run đã được lên lịch hoặc xuất bản." };
    if (draft.rewriteStatus === "generating" || draft.rewriteStatus === "unknown" || draft.generationStatus === "pending" || draft.generationStatus === "unknown" || draft.mediaOperation?.status === "running") return { status: "failure", message: "Quality check bị chặn khi copy hoặc media đang chạy/chờ đối soát." };
    const capturedScopeKey = draftActionScopeKey(draftActionScope(draft));
    const capturedFingerprint = contentRevisionFingerprint(draft);
    const contentRunId = draft.contentRunId;
    const notice = (message: string) => setActionNotice(capturedScopeKey, id, contentRunId, message);
    const checks = qualityChecksForDraft(draft);
    const checked = persistQualityChecks(buildContentRunFromDraft(draft), checks);
    const expectedRevisionFields = contentRunQualityExpectedRevisionFields(checked, `variant-${draft.id}`);
    const qualityChecks = checks.map((check) => ({ key: check.key, label: check.message ?? check.key, ok: check.passed, message: check.passed ? "Passed" : "Needs attention" }));
    const qualityStatus = checked.qualityStatus ?? "failed";
    if (!controlPlaneClient || !contentRunId) {
      const message = "Quality check was not saved: this draft has no durable Control Plane Content Run. Create or recover the Content Run, then retry; the previous quality and approval state is kept.";
      notice(message);
      return { status: "failure", message };
    }
    const contentRunState = qualityStatus === "passed" ? "ready" : "needs_review";
    const checkedAt = new Date().toISOString();
    try {
      await submitContentRunQualityCheck(
        (payload) => controlPlaneClient.updateAgencyEntity<Record<string, unknown>>("content-runs", contentRunId, payload),
        { contentRunId, clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id, revisionId: draft.revisionId, state: contentRunState, qualityStatus, qualityChecks: checks, checkedAt, expectedRevisionFields },
      );
    } catch (error) {
      const message = error instanceof Error && error.message === "CONTENT_RUN_QUALITY_ACK_MISMATCH"
        ? "Quality check was not applied: Control Plane returned an acknowledgement for a different Content Run, revision, or check result. Retry after sync."
        : `Quality check was not saved to Control Plane; the previous quality and approval state is kept. ${error instanceof Error ? error.message : "Retry after Control Plane is available."}`;
      notice(message);
      return { status: "failure", message };
    }
    const currentDraft = draftsRef.current.find((item) => item.id === id);
    if (!currentDraft || draftActionScopeKey(draftActionScope(currentDraft)) !== capturedScopeKey || contentRevisionFingerprint(currentDraft) !== capturedFingerprint) {
      const message = "Quality check acknowledgement was stale; the current draft revision and review state were left unchanged.";
      notice(message);
      return { status: "failure", message };
    }
    setDraftsForAction(capturedScopeKey, id, contentRunId, (item) => ({ ...item, qualityStatus, qualityChecks, approvalState: qualityStatus === "passed" ? "ready" : "proposed" }));
    recordAnalyticsEvent("quality.checked", { contentRunId, qualityStatus, passed: qualityChecks.filter((check) => check.ok).length, total: qualityChecks.length });
    const qualityMessage = qualityStatus === "passed"
      ? "Quality passed · Control Plane đã lưu trạng thái và content đã sẵn sàng để duyệt."
      : "Quality chưa đạt · sửa các mục màu đỏ rồi kiểm tra lại.";
    setActionSavedNotice(capturedScopeKey, id, contentRunId, qualityMessage);
    if (actionScopeIsCurrent(capturedScopeKey, id, contentRunId)) window.setTimeout(() => { if (actionScopeIsCurrent(capturedScopeKey, id, contentRunId)) setSavedNotice(""); }, 3000);
    return { status: qualityStatus === "passed" ? "success" : "failure", message: qualityMessage };
  };
  const qualityCheckDraft = (id: number): Promise<DraftActionOutcome> => runScopedDraftAction(id, "quality", () => performQualityCheckDraft(id));

  const copyDraft = async (id: number) => {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) return;
    const text = exportContentText({ caption: draft.body, body: draft.body, hashtags: draft.hashtags });
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("CLIPBOARD_UNAVAILABLE");
      setQueueNotice("Đã copy caption + hashtags để đăng tay.");
    } catch {
      await exportManualPackage(id);
    }
  };

  const requestDraftTargetAction = (draft: Draft, action: "publish_now" | "reschedule" | "cancel") => {
    if (targetActionPrompt || schedulePromptDraftId !== undefined) { setQueueNotice("Finish or cancel the open target/schedule selection before starting another action."); return; }
    const jobIds = targetJobIdsForDraft(draft, targetPublications);
    if (jobIds.length === 0) { setQueueNotice("Draft chưa có target publication được Control Plane xác nhận."); return; }
    if (action === "publish_now" && draft.status !== "Scheduled") { setQueueNotice("Publish bị chặn: content phải được Quality check và Duyệt trước."); return; }
    if (jobIds.length > 1) {
      openTargetActionPrompt(draft, action);
      return;
    }
    const jobId = jobIds[0];
    if (action === "publish_now") void applyTargetPublicationAction(jobId, action);
    else if (action === "cancel") void cancelQueueJob(jobId);
    else rescheduleQueueJob(jobId);
  };
  const requestDraftTargetActionById = (draftId: number, action: "reschedule" | "cancel") => {
    const draft = draftsRef.current.find((item) => item.id === draftId);
    if (draft) requestDraftTargetAction(draft, action);
  };

  const performPublishDraft = async (id: number, targetJobId?: string): Promise<DraftActionOutcome> => {
    const draft = draftsRef.current.find((item) => item.id === id);
    if (!draft) return { status: "failure", message: "Draft không còn trong workspace hiện tại." };
    const scopeKey = draftActionScopeKey(draftActionScope(draft));
    const contentRunId = draft.contentRunId;
    const notice = (message: string) => setActionNotice(scopeKey, id, contentRunId, message);
    const commandScope = { scopeKey, draftId: id, contentRunId };
    if (targetActionPrompt && (targetActionPrompt.draftId !== id || !targetJobId)) {
      const message = "Finish or cancel the open target selection before starting another Publish action.";
      notice(message);
      return { status: "failure", message };
    }
    const publishState = { id: draft.id, clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id, contentRunId, status: draft.status, qualityStatus: draft.qualityStatus, approvalState: draft.approvalState, pendingPublicationIds: draft.pendingPublicationIds };
    const jobIds = targetJobIdsForDraft(draft, targetPublications);
    const selectedPublication = targetJobId ? publicationForJob(targetJobId) : undefined;
    const blocker = targetJobId && selectedPublication
      ? draftPublishBlocker(publishState, targetPublications, selectedPublication.id)
      : draftPublishBlocker(publishState, targetPublications);
    if (blocker) { notice(blocker); return { status: "failure", message: blocker }; }
    if (targetJobId) {
      const publication = selectedPublication;
      if (!jobIds.includes(targetJobId) || !publication) {
        const message = "Publish blocked: choose a target job from this Content Run.";
        notice(message);
        return { status: "failure", message };
      }
      const actionOutcome = await applyTargetPublicationAction(targetJobId, "publish_now", undefined, true, undefined, commandScope);
      const outcome = publishCommandOutcome({ commandStatus: actionOutcome.status === "provider_confirmed" || actionOutcome.status === "pending" ? "acknowledged" : "failed", workerAckState: actionOutcome.status === "provider_confirmed" || actionOutcome.status === "pending" ? "acknowledged" : undefined, state: actionOutcome.publication?.state, providerJobId: actionOutcome.publication?.providerJobId, legacyNonLive: actionOutcome.publication?.legacyNonLive });
      notice(outcome.message);
      return outcome;
    }
    const liveJobIds = jobIds.filter((jobId) => {
      const publication = publicationForJob(jobId);
      return Boolean(publication && !draftPublishBlocker(publishState, targetPublications, publication.id));
    });
    if (liveJobIds.length === 0) {
      const message = "Publish blocked: no live target job is available; wait for Control Plane and provider confirmation.";
      notice(message);
      return { status: "failure", message };
    }
    if (liveJobIds.length > 1) {
      openTargetActionPrompt(draft, "publish_now");
      return { status: "pending", pendingReason: "selection", message: "Choose the target. No publish command has been sent yet." };
    }
    const actionOutcome = await applyTargetPublicationAction(liveJobIds[0]!, "publish_now", undefined, true, undefined, commandScope);
    const outcome = publishCommandOutcome({ commandStatus: actionOutcome.status === "provider_confirmed" || actionOutcome.status === "pending" ? "acknowledged" : "failed", workerAckState: actionOutcome.status === "provider_confirmed" || actionOutcome.status === "pending" ? "acknowledged" : undefined, state: actionOutcome.publication?.state, providerJobId: actionOutcome.publication?.providerJobId, legacyNonLive: actionOutcome.publication?.legacyNonLive });
    notice(outcome.message);
    return outcome;
  };
  const publishDraft = (id: number, targetJobId?: string): Promise<DraftActionOutcome> => runScopedDraftAction(
    id, "publish", () => performPublishDraft(id, targetJobId), Boolean((targetJobId && targetActionPrompt?.draftId === id && targetActionPrompt.action === "publish_now") || (!targetJobId && publishBlockersByDraftId[id] === undefined)),
  );

  const telegramDraft = async (id: number) => {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) return;
    const text = exportContentText({ caption: draft.body, body: draft.body, hashtags: draft.hashtags });
    await downloadLocalJson(`signalflow-telegram-${draft.id}.json`, { destination: "telegram", status: "pending_operator_send", draftId: draft.id, title: draft.title, platform: draft.platform, text, generatedAt: new Date().toISOString() });
    const preparedAt = new Date().toISOString();
    setDrafts((current) => current.map((item) => item.id === id ? { ...item, telegramState: "prepared", telegramPreparedAt: preparedAt } : item));
    recordAnalyticsEvent("telegram.prepared", { contentRunId: draft.contentRunId ?? `content-${draft.id}`, status: "pending_operator_send" });
    setQueueNotice("Telegram relay chưa được cấu hình trong SignalFlow; payload đã được chuẩn bị, chưa gửi ra ngoài.");
  };

  const restoreDraftRevision = async (id: number, revisionId: string) => {
    const draft = draftsRef.current.find((item) => item.id === id);
    const selected = draft?.revisionHistory?.find((revision) => revision.id === revisionId);
    if (!draft || !selected) return;
    if (draftActionLocked(draft)) { setQueueNotice("Không thể khôi phục revision trong lúc Quality/approval đang chạy hoặc chờ reconciliation."); return; }
    if (!controlPlaneClient) { setQueueNotice("Khôi phục bị chặn: Control Plane chưa sẵn sàng để lưu revision bền vững."); return; }
    if (contentRewriteBlocker(true, draft.generationStatus) || draft.rewriteStatus === "unknown") { setQueueNotice("Khôi phục bị chặn: outcome trước đang cần đối soát trước khi tạo revision mới."); return; }
    const runId = draft.contentRunId ?? `content-${draft.id}`;
    if (draft.status === "Published" || draft.approvalState === "published" || targetPublications.some((publication) => publication.contentRunId === runId && hasProviderConfirmedPublicationState(publication))) { setQueueNotice("Published content is read-only; tạo Content Run mới để khôi phục bản chữ."); return; }
    if (draft.status === "Scheduled" || draft.approvalState === "scheduled" || draft.approvalState === "publishing" || draft.pendingPublicationIds?.length || hasActiveContentRunPublication(targetPublications, runId, `variant-${draft.id}`)) {
      setQueueNotice("Khôi phục bị chặn: Content Run đang có target publication cần hủy hoặc đối soát trước.");
      return;
    }
    const result = await runContentRewriteSingleFlight(rewriteInFlightRef.current, String(id), async () => {
      const requestId = globalThis.crypto.randomUUID();
      const nextRevisionId = `revision-${runId}-${requestId}`;
      const restored = buildRestoredRevision(draft.revisionHistory, draft, selected, { revisionId: nextRevisionId, requestId, createdAt: new Date().toISOString() });
      const identityVersionId = draft.identityVersionId ?? activeBrandIdentity?.id ?? `identity-${activeBrandRecord.id}-v1`;
      const executionMode = draft.executionMode ?? "llm_provider";
      const variantId = `variant-${id}`;
      const revisionCreatedAt = new Date().toISOString();
      const restoreLineage = draft.contentIntelligenceLineage ?? captureContentIntelligenceLineage({ selectedKnowledgeItemIds: draft.selectedKnowledgeItemIds ?? [], selectedResearchEvidenceIds: draft.selectedResearchEvidenceIds ?? [], selectedPromptBlueprintId: draft.promptBlueprintId, selectedPromptBlueprintVersion: draft.promptBlueprintVersion, selectedRecipeId: draft.recipeId, transformMode: draft.transformMode ?? "original", mediaSetFingerprint: draft.mediaSetFingerprint, customerFacts: draft.customerFacts ?? [] });
      const persistedRun = {
        id: nextRevisionId,
        parentContentRunId: runId,
        revisionCreatedAt,
        clientId: activeWorkspaceRecord.id,
        brandId: draft.brandId ?? activeBrandRecord.id,
        identityVersionId,
        ...(draft.generationProfileId && draft.generationProfileId !== "manual-review" ? { generationProfileId: draft.generationProfileId } : {}),
        executionMode,
        providerTraceId: selected.providerTraceId ?? draft.providerTraceId ?? "manual-restore",
        trigger: draft.automationKey ? "automation" : "manual",
        prompt: draft.prompt,
        requestId,
        revisionId: nextRevisionId,
        parentRevisionId: selected.id,
        revisionHistory: restored.revisionHistory,
        generationStatus: "completed",
        ...(draft.mediaSetFingerprint ? { mediaSetFingerprint: draft.mediaSetFingerprint } : {}),
        mediaEvidence: draft.mediaEvidence,
        ...contentIntelligenceLineageFields(restoreLineage),
        topic: restored.title,
        contentPillar: draft.contentPillar,
        contentAngle: draft.contentAngle,
        objective: draft.objective,
        strategyVersion: draft.strategyVersion,
        strategySnapshot: draft.strategySnapshot,
        strategyState: "clean",
        regenerationState: "clean",
        caption: restored.body,
        body: restored.body,
        cta: draft.cta,
        hashtags: draft.hashtags ?? [],
        seoKeywords: draft.seoKeywords ?? [],
        scheduledAt: draft.scheduledAt,
        sources: draft.sources ?? [],
        notes: draft.notes,
        targetPlatforms: [draft.platform.toLowerCase() as SocialPlatform],
        targetBindingIds: draft.bindingIds,
        bindingIds: draft.bindingIds,
        planId: draft.planId,
        qualityStatus: "pending",
        approvalState: "pending",
        state: "needs_review",
        variants: [{ id: variantId, platform: draft.platform.toLowerCase(), kind: draft.contentKind ?? "text", title: restored.title, body: restored.body, caption: restored.body, contentPillar: draft.contentPillar, contentAngle: draft.contentAngle, objective: draft.objective, strategyVersion: draft.strategyVersion, strategySnapshot: draft.strategySnapshot, cta: draft.cta, hashtags: draft.hashtags ?? [], seoKeywords: draft.seoKeywords ?? [], scheduledAt: draft.scheduledAt, sources: draft.sources ?? [], notes: draft.notes, mediaAssetIds: draft.mediaAssetIds ?? [], mediaOperations: draft.mediaOperations ?? [], metadata: { mediaEvidence: draft.mediaEvidence ?? [], contentIntelligenceLineage: restoreLineage, strategySnapshot: draft.strategySnapshot, revisionId: nextRevisionId, parentRevisionId: selected.id } }],
      };
      setDrafts((current) => current.map((item) => item.id === id ? { ...item, rewriteStatus: "generating", rewriteError: undefined, revisionId: nextRevisionId, parentRevisionId: selected.id, requestId, time: "Đang khôi phục bản chữ…" } : item));
      try {
        await controlPlaneClient.createAgencyRecord("content-runs", persistedRun as unknown as Record<string, unknown>);
        const nextDraft: Draft = { ...draft, ...restored, contentRunId: nextRevisionId, identityVersionId, executionMode, providerTraceId: restored.providerTraceId ?? draft.providerTraceId ?? "manual-restore", generationStatus: "completed", status: "Needs review", approvalState: "proposed", qualityStatus: "pending", qualityChecks: undefined, rewriteStatus: "ready_for_review", rewriteError: undefined, revisionId: nextRevisionId, parentRevisionId: selected.id, requestId, queueJobId: undefined, queueJobIds: [], pendingPublicationIds: undefined, time: "Đã khôi phục bản chữ · cần kiểm tra và duyệt lại" };
        setDrafts((current) => current.map((item) => item.id === id ? nextDraft : item));
        setQueueNotice(`Đã khôi phục ${selected.title}; bản hiện tại vẫn được giữ trong lịch sử, cần kiểm tra và duyệt lại.`);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Không thể khôi phục revision; bản hiện tại vẫn được giữ nguyên.";
        setDrafts((current) => current.map((item) => item.id === id ? { ...item, rewriteStatus: "failed", rewriteError: message, generationStatus: draft.generationStatus, revisionId: draft.revisionId, parentRevisionId: draft.parentRevisionId, requestId: draft.requestId, time: "Khôi phục thất bại · bản hiện tại vẫn được giữ nguyên" } : item));
        setQueueNotice(message);
        return false;
      }
    });
    if (result === undefined) setQueueNotice("Content Run đang có một thao tác rewrite/restore khác; thử lại sau khi hoàn tất.");
  };

  const regenerateDraft = async (id: number) => {
    const draft = draftsRef.current.find((item) => item.id === id);
    if (!draft) return;
    if (draftActionLocked(draft)) { setQueueNotice("Không thể rewrite trong lúc Quality/approval đang chạy hoặc chờ reconciliation."); return; }
    if (!controlPlaneClient) { setQueueNotice("Làm lại bị chặn: Control Plane chưa sẵn sàng để lưu revision bền vững."); return; }
    const rewriteBlocker = contentRewriteBlocker(true, draft.generationStatus);
    if (rewriteBlocker || draft.rewriteStatus === "unknown") {
      setQueueNotice("Làm lại bị chặn: outcome trước đang chưa rõ; cần đối soát trước khi gửi yêu cầu mới.");
      return;
    }
    const runId = draft.contentRunId ?? `content-${draft.id}`;
    if (draft.status === "Published" || draft.approvalState === "published" || targetPublications.some((publication) => publication.contentRunId === runId && hasProviderConfirmedPublicationState(publication))) { setQueueNotice("Published content is read-only; tạo Content Run mới để viết lại."); return; }
    if (draft.status === "Scheduled" || draft.approvalState === "scheduled" || draft.approvalState === "publishing" || draft.pendingPublicationIds?.length || hasActiveContentRunPublication(targetPublications, runId, `variant-${draft.id}`)) {
      setQueueNotice("Làm lại bị chặn: Content Run đang có target publication cần hủy hoặc đối soát trước.");
      return;
    }
    const result = await runContentRewriteSingleFlight(rewriteInFlightRef.current, String(id), async () => {
      setIsGenerating(true);
      setGenerationError("");
      let pendingRunPersisted = false;
      let providerDispatched = false;
      let providerResponded = false;
      let completionPersistenceAttempted = false;
      let revisionId = "";
      let requestId = "";
      let parentRevisionId = "";
      try {
        const currentDraft = draftsRef.current.find((item) => item.id === id);
        if (!currentDraft) return false;
        const currentRewriteBlocker = contentRewriteBlocker(true, currentDraft.generationStatus);
        if (currentRewriteBlocker || currentDraft.rewriteStatus === "unknown") throw new Error(currentRewriteBlocker ?? "CONTENT_RUN_RECONCILIATION_REQUIRED");
        const currentRunId = currentDraft.contentRunId ?? `content-${currentDraft.id}`;
        const currentVariantId = `variant-${currentDraft.id}`;
        if (currentDraft.status === "Scheduled" || currentDraft.approvalState === "scheduled" || currentDraft.approvalState === "publishing" || currentDraft.pendingPublicationIds?.length || hasActiveContentRunPublication(targetPublications, currentRunId, currentVariantId)) throw new Error("CONTENT_RUN_PUBLICATION_ACTIVE");
        const route = automationAIResolution;
        const routeHint = `${currentDraft.providerTraceId ?? ""} ${currentDraft.generationProfileId ?? ""}`.toLowerCase();
        const provider: AIProvider | undefined = routeHint.includes("gemini") ? "gemini" : routeHint.includes("chatgpt") || routeHint.includes("openai") ? "openai" : route.provider === "gemini" || route.provider === "openai" ? route.provider : undefined;
        if (!provider) throw new Error("REWRITE_ROUTE_NOT_CONFIGURED");
        const subscriptionRoute = currentDraft.executionMode ? currentDraft.executionMode === "subscription_package" : route.mode === "web_subscription";
        const platform = currentDraft.platform.toLowerCase() as SocialPlatform;
        const mediaIds = currentDraft.mediaAssetIds ?? [];
        const evidence = currentDraft.mediaEvidence ?? [];
        if (mediaIds.length !== evidence.length || evidence.some((item, index) => item.assetId !== mediaIds[index] || !item.sha256 || !item.mimeType || item.order !== index || item.role !== (index === 0 ? "publish" : "reference") || item.uploadState !== "processed")) throw new Error("CONTENT_RUN_MEDIA_EVIDENCE_REQUIRED");
        const selectedAssets: MediaAttachment[] = evidence.map((item) => {
          const asset = assets.find((candidate) => String(candidate.id) === item.assetId);
          if (!asset?.localAssetPath) throw new Error("CONTENT_RUN_MEDIA_ASSET_UNAVAILABLE");
          return { assetId: item.assetId, localAssetPath: asset.localAssetPath, mimeType: item.mimeType!, sha256: item.sha256!, order: item.order, role: item.role };
        });
        if (selectedAssets.length && !subscriptionRoute) throw new Error("MEDIA_ATTACHMENT_PROVIDER_UNSUPPORTED");
        const gateway: GeminiWebAIGateway | ChatGPTWebAIGateway | OfficialAIGateway = subscriptionRoute
          ? provider === "gemini" ? new GeminiWebAIGateway({ model: aiAccounts.gemini.model }) : new ChatGPTWebAIGateway({ model: aiAccounts.openai.model })
          : new OfficialAIGateway({ provider, apiKey: await readAIProviderKey(activeWorkspaceRecord.id, provider) ?? (() => { throw new Error("REWRITE_API_KEY_NOT_CONFIGURED"); })(), model: aiAccounts[provider].model });
        if (subscriptionRoute) {
          const capability = await getManagedCopyCapability(provider, invoke, activeWorkspaceRecord.id);
          if (!capability.live) throw new Error(capability.reason ?? "REWRITE_MANAGED_SESSION_NOT_VERIFIED");
        }
        const identity = activeBrandIdentity;
        const brandFacts = [
          identity?.strategy.vision ? `Vision: ${identity.strategy.vision}` : "",
          identity?.strategy.mission ? `Mission: ${identity.strategy.mission}` : "",
          identity?.strategy.audience ? `Audience: ${identity.strategy.audience}` : "",
          identity?.voice.tone ? `Tone: ${identity.voice.tone}` : `Tone: ${brandVoice}`,
          identity?.voice.vocabulary?.length ? `Vocabulary: ${identity.voice.vocabulary.join(", ")}` : "",
          identity?.voice.prohibitedClaims?.length ? `Prohibited claims: ${identity.voice.prohibitedClaims.join(", ")}` : "",
        ].filter(Boolean);
        const contentContext = [`Pillar: ${currentDraft.contentPillar ?? ""}`, `Angle: ${currentDraft.contentAngle ?? ""}`, `Objective: ${currentDraft.objective ?? ""}`, currentDraft.sources?.length ? `Sources: ${currentDraft.sources.join(" | ")}` : "", currentDraft.notes ? `Notes: ${currentDraft.notes}` : ""].filter(Boolean).join("\n");
        const rewriteLineage = currentDraft.contentIntelligenceLineage ?? captureContentIntelligenceLineage({ selectedKnowledgeItemIds: currentDraft.selectedKnowledgeItemIds ?? [], selectedResearchEvidenceIds: currentDraft.selectedResearchEvidenceIds ?? [], selectedPromptBlueprintId: currentDraft.promptBlueprintId, selectedPromptBlueprintVersion: currentDraft.promptBlueprintVersion, selectedRecipeId: currentDraft.recipeId, transformMode: currentDraft.transformMode ?? "original", mediaSetFingerprint: currentDraft.mediaSetFingerprint, customerFacts: currentDraft.customerFacts ?? [currentDraft.notes, ...(currentDraft.sources ?? [])].filter((value): value is string => Boolean(value)) });
        const parentStrategySnapshot = currentDraft.strategySnapshot;
        const rewriteFormat: AssetPromptFormat = parentStrategySnapshot?.format ?? assetFormatForContentKind((currentDraft.contentKind ?? "text") as ContentKind);
        const rewriteRecipe = currentDraft.recipeId ? contentRecipes.find((recipe) => recipe.id === currentDraft.recipeId && recipe.brandId === activeBrandRecord.id) : undefined;
        if (currentDraft.recipeId && !rewriteRecipe) throw new Error("RECIPE_UNAVAILABLE");
        let strategySnapshot = parentStrategySnapshot;
        let rewriteStrategy: ResolvedStrategy | undefined = parentStrategySnapshot;
        if (parentStrategySnapshot) {
          if (!activeStrategyCatalog) throw new Error("STRATEGY_CATALOG_REQUIRED");
          const objectiveValue = String(currentDraft.objective ?? parentStrategySnapshot.objectiveLabel).trim();
          const objectiveChoice = ({ Reach: "reach", Engagement: "engagement", Education: "education", Knowledge: "knowledge", Conversion: "conversion" } as Record<string, string>)[objectiveValue] ?? (objectiveValue.toLowerCase() || "mix");
          const pillarValue = String(currentDraft.contentPillar ?? parentStrategySnapshot.pillarLabel).trim();
          const pillarChoice = activeStrategyCatalog.pillars.find((candidate) => candidate.id === pillarValue || candidate.label.toLowerCase() === pillarValue.toLowerCase())?.id ?? (pillarValue || "mix");
          const angleValue = String(currentDraft.contentAngle ?? parentStrategySnapshot.angleLabel).trim();
          const angleChoice = activeStrategyCatalog.pillars.flatMap((candidate) => candidate.angles).find((candidate) => candidate.id === angleValue || candidate.label.toLowerCase() === angleValue.toLowerCase())?.id ?? (angleValue || "mix");
          const preparedRewriteStrategy = prepareStrategyGeneration({ catalog: activeStrategyCatalog, channel: platform, format: rewriteFormat, selection: { objective: objectiveChoice as never, pillar: pillarChoice, angle: angleChoice }, slotIndex: 0 });
          if (!preparedRewriteStrategy.ok) throw new Error(`${preparedRewriteStrategy.code}: ${preparedRewriteStrategy.message}`);
          rewriteStrategy = preparedRewriteStrategy.strategy;
          const recipeValidation = validateRewriteRecipeForStrategy(rewriteRecipe, rewriteStrategy);
          if (!recipeValidation.ok) throw new Error(recipeValidation.code);
          strategySnapshot = strategySnapshotFromResolved(rewriteStrategy as unknown as Record<string, unknown>, rewriteFormat, rewriteRecipe?.id);
          rewriteStrategy = { ...rewriteStrategy, ...(strategySnapshot.recipeId ? { recipeId: strategySnapshot.recipeId } : {}), strategySnapshot };
        }
        const rewritePrompt = rewriteStrategy
          ? compileStrategyPrompt({ brandName: activeBrandRecord.name, brandVoice, channel: platform, format: rewriteFormat, strategy: rewriteStrategy, recipe: rewriteRecipe, identityContext: brandFacts.join("\n"), intelligenceContext: contentContext, brief: buildRewritePrompt({ brandName: activeBrandRecord.name, brandFacts, contentContext, visualPrompt: currentDraft.visualPrompt, platform, title: currentDraft.title, body: currentDraft.body ?? "" }), existingTopics: scopedDrafts.filter((candidate) => candidate.id !== id).map((candidate) => candidate.title).filter(Boolean).slice(0, 30), customerMedia: selectedAssets.map(({ assetId, mimeType, order, role, sha256 }) => ({ assetId, mimeType, order, role, sha256 })) })
          : buildRewritePrompt({ brandName: activeBrandRecord.name, brandFacts, contentContext, visualPrompt: currentDraft.visualPrompt, platform, title: currentDraft.title, body: currentDraft.body ?? "" });
        const requestBase = selectedAssets.length
          ? buildMediaAwareCopyRequest({ workspaceId: activeWorkspaceRecord.id, prompt: rewritePrompt, attachments: selectedAssets, targetPlatforms: [platform], brandVoice, customerFacts: [...rewriteLineage.customerFacts] })
          : { workspaceId: activeWorkspaceRecord.id, prompt: rewritePrompt, targetPlatforms: [platform], contentKinds: [currentDraft.contentKind ?? "text"] as ContentKind[], brandSystem: { workspaceId: activeWorkspaceRecord.id, voice: brandVoice, audience: identity?.strategy.audience ?? `Audience defined by the ${activeBrandRecord.name} brand system.`, prohibitedClaims: identity?.voice.prohibitedClaims ?? [], visualTokens: brandVisualTokens }, modelPreference: "quality" as const };
        const latestHistoryRevision = currentDraft.revisionHistory?.[Math.max(0, (currentDraft.revisionHistory?.length ?? 1) - 1)];
        requestId = globalThis.crypto.randomUUID();
        parentRevisionId = currentDraft.revisionId ?? latestHistoryRevision?.id ?? "";
        if (!parentRevisionId) throw new Error("CONTENT_RUN_PARENT_REVISION_REQUIRED");
        const request = { ...requestBase, contentKinds: [currentDraft.contentKind ?? requestBase.contentKinds[0] ?? "text"] as ContentKind[], brandSystem: { workspaceId: activeWorkspaceRecord.id, voice: brandVoice, audience: identity?.strategy.audience ?? `Audience defined by the ${activeBrandRecord.name} brand system.`, prohibitedClaims: identity?.voice.prohibitedClaims ?? [], visualTokens: brandVisualTokens }, metadata: { ...requestBase.metadata, ...contentIntelligenceLineageFields(rewriteLineage), rewrite: true, parentContentRunId: currentRunId, parentRevisionId, requestId, ...(strategySnapshot && rewriteStrategy ? { structuredOutput: true, assetFormat: rewriteFormat, resolvedStrategy: rewriteStrategy, strategySnapshot, strategyVersion: strategySnapshot.strategyVersion, catalogFingerprint: strategySnapshot.catalogFingerprint, idempotencyKey: generationIdempotencyKey({ contentRunId: currentRunId, strategyVersion: strategySnapshot.strategyVersion, format: rewriteFormat }) } : {}) } };
        revisionId = `revision-${currentRunId}-${requestId}`;
        const revisionCreatedAt = new Date().toISOString();
        const revisionHistory = appendContentRevision(currentDraft.revisionHistory, currentDraft, parentRevisionId, revisionCreatedAt);
        const revisionProfileId = currentDraft.generationProfileId && currentDraft.generationProfileId !== "manual-review" && currentDraft.generationProfileId.toLowerCase().includes(provider) ? currentDraft.generationProfileId : undefined;
        const pendingRun = {
          id: revisionId,
          parentContentRunId: currentRunId,
          revisionCreatedAt,
          clientId: activeWorkspaceRecord.id,
          brandId: currentDraft.brandId ?? activeBrandRecord.id,
          identityVersionId: currentDraft.identityVersionId ?? identity?.id ?? `identity-${activeBrandRecord.id}-v1`,
          ...(revisionProfileId ? { generationProfileId: revisionProfileId } : {}),
          executionMode: subscriptionRoute ? "subscription_package" : "llm_provider",
          providerTraceId: "pending",
          trigger: currentDraft.automationKey ? "automation" : "manual",
          prompt: rewritePrompt,
          requestId,
          revisionId,
          parentRevisionId,
          revisionHistory,
          generationStatus: "pending",
          ...(currentDraft.mediaSetFingerprint ? { mediaSetFingerprint: currentDraft.mediaSetFingerprint } : {}),
          ...(evidence.length ? { mediaEvidence: evidence } : {}),
          ...contentIntelligenceLineageFields(rewriteLineage),
          topic: currentDraft.topic ?? currentDraft.title,
          contentPillar: rewriteStrategy?.pillarLabel ?? currentDraft.contentPillar,
          contentAngle: rewriteStrategy?.angleLabel ?? currentDraft.contentAngle,
          objective: rewriteStrategy?.objectiveLabel ?? currentDraft.objective,
          strategyVersion: rewriteStrategy?.strategyVersion ?? currentDraft.strategyVersion,
          catalogFingerprint: rewriteStrategy?.catalogFingerprint ?? currentDraft.catalogFingerprint,
          strategySnapshot,
          strategyState: "clean",
          regenerationState: "clean",
          body: "",
          caption: "",
          cta: currentDraft.cta,
          hashtags: currentDraft.hashtags ?? [],
          seoKeywords: currentDraft.seoKeywords ?? [],
          scheduledAt: currentDraft.scheduledAt,
          sources: currentDraft.sources ?? [],
          notes: currentDraft.notes,
          targetPlatforms: [platform],
          targetBindingIds: currentDraft.bindingIds,
          bindingIds: currentDraft.bindingIds,
          planId: currentDraft.planId,
          qualityStatus: "pending",
          approvalState: "pending",
          state: "needs_review",
          variants: [{ id: currentVariantId, platform, kind: currentDraft.contentKind ?? "text", title: currentDraft.title, body: "", caption: "", contentPillar: rewriteStrategy?.pillarLabel ?? currentDraft.contentPillar, contentAngle: rewriteStrategy?.angleLabel ?? currentDraft.contentAngle, objective: rewriteStrategy?.objectiveLabel ?? currentDraft.objective, strategyVersion: rewriteStrategy?.strategyVersion ?? currentDraft.strategyVersion, catalogFingerprint: rewriteStrategy?.catalogFingerprint ?? currentDraft.catalogFingerprint, strategySnapshot, cta: currentDraft.cta, hashtags: currentDraft.hashtags ?? [], seoKeywords: currentDraft.seoKeywords ?? [], mediaAssetIds: [...mediaIds], mediaOperations: currentDraft.mediaOperations ?? [], metadata: { mediaEvidence: evidence, strategySnapshot, revisionId, parentRevisionId } }],
        };
        setDrafts((current) => current.map((item) => item.id === id ? { ...item, rewriteStatus: "generating", rewriteError: undefined, generationStatus: "pending", revisionId, parentRevisionId, requestId, time: "Đang tạo bản chữ mới…" } : item));
        await createContentRunWithMediaOwnership(selectedAssets.length ? controlPlaneMediaOwnershipInput(selectedAssets) : undefined, () => controlPlaneClient.createAgencyRecord("content-runs", pendingRun as unknown as Record<string, unknown>), { runId: pendingRun.id, getContentRun: (id) => controlPlaneClient.getContentRun(id) });
        pendingRunPersisted = true;
        await controlPlaneClient.markContentRunProviderAttempt(revisionId);
        providerDispatched = true;
        const rewriteGateway: AIGateway = strategySnapshot && rewriteStrategy ? {
          generate: (generationRequest) => runStrategyGenerationWithRetry({ contentRunId: currentRunId, strategy: rewriteStrategy!, format: rewriteFormat, generate: () => gateway.generate(generationRequest), validate: (result) => result.variants.map((candidate) => validateGeneratedStrategyOutput({ format: rewriteFormat, expected: rewriteStrategy!, output: extractGeneratedContentFields(candidate) })).find((check) => !check.ok) ?? { ok: true } }),
        } : gateway;
        let nextDraft: Draft | undefined;
        await runRevisionGeneration(rewriteGateway, request, async (providerResult) => {
          providerResponded = true;
          const variant = providerResult.variants[0];
          const generated = extractGeneratedContentFields(variant);
          const copy = variant?.body?.trim() || variant?.caption?.trim();
          if (!copy) throw new Error("CONTENT_GENERATION_EMPTY_RESULT");
          if (strategySnapshot && rewriteStrategy) {
            const contract = validateGeneratedStrategyOutput({ format: rewriteFormat, expected: rewriteStrategy, output: generated });
            if (!contract.ok) throw new Error(`${contract.code}: ${contract.message}`);
          }
          const nextTitle = variant?.title?.trim() || currentDraft.title;
          nextDraft = { ...currentDraft, contentRunId: revisionId, title: nextTitle, topic: nextTitle, body: copy, prompt: rewritePrompt, contentPillar: generated.contentPillar ?? rewriteStrategy?.pillarLabel ?? currentDraft.contentPillar, contentAngle: generated.contentAngle ?? rewriteStrategy?.angleLabel ?? currentDraft.contentAngle, objective: (generated.objective ?? rewriteStrategy?.objectiveLabel ?? currentDraft.objective) as Draft["objective"], strategyVersion: generated.strategyVersion ?? rewriteStrategy?.strategyVersion ?? currentDraft.strategyVersion, catalogFingerprint: generated.catalogFingerprint ?? rewriteStrategy?.catalogFingerprint ?? currentDraft.catalogFingerprint, strategySnapshot: generated.strategySnapshot ?? strategySnapshot ?? currentDraft.strategySnapshot, imageConcept: generated.imageConcept ?? currentDraft.imageConcept, imagePrompt: generated.imagePrompt ?? currentDraft.imagePrompt, videoConcept: generated.videoConcept ?? currentDraft.videoConcept, videoPrompt: generated.videoPrompt ?? currentDraft.videoPrompt, strategyRationale: generated.strategyRationale ?? currentDraft.strategyRationale, hashtags: variant?.hashtags?.length ? variant.hashtags : currentDraft.hashtags, providerTraceId: providerResult.traceId, requestId, revisionId, parentRevisionId, revisionHistory, generationStatus: "completed", regenerationState: "clean", strategyState: "clean", rewriteStatus: "ready_for_review", rewriteError: undefined, qualityStatus: "pending", qualityChecks: undefined, approvalState: "proposed", status: "Needs review", queueJobId: undefined, queueJobIds: [], pendingPublicationIds: undefined, time: "Đã tạo bản chữ mới · cần kiểm tra và duyệt lại" };
          const persistedPayload = { ...pendingRun, generationStatus: "completed", providerTraceId: providerResult.traceId, topic: nextDraft.topic, contentPillar: nextDraft.contentPillar, contentAngle: nextDraft.contentAngle, objective: nextDraft.objective, strategyVersion: nextDraft.strategyVersion, catalogFingerprint: nextDraft.catalogFingerprint, strategySnapshot: nextDraft.strategySnapshot, body: copy, caption: copy, cta: nextDraft.cta, hashtags: nextDraft.hashtags ?? [], seoKeywords: nextDraft.seoKeywords ?? [], qualityStatus: "pending", qualityChecks: [], approvalState: "pending", state: "needs_review", revisionHistory, ...contentIntelligenceLineageFields(rewriteLineage), variants: [{ id: currentVariantId, platform, kind: currentDraft.contentKind ?? "text", title: nextTitle, body: copy, caption: copy, contentPillar: nextDraft.contentPillar, contentAngle: nextDraft.contentAngle, objective: nextDraft.objective, strategyVersion: nextDraft.strategyVersion, catalogFingerprint: nextDraft.catalogFingerprint, strategySnapshot: nextDraft.strategySnapshot, cta: nextDraft.cta, hashtags: nextDraft.hashtags ?? [], seoKeywords: nextDraft.seoKeywords ?? [], mediaAssetIds: [...mediaIds], mediaOperations: currentDraft.mediaOperations ?? [], metadata: { mediaEvidence: evidence, contentIntelligenceLineage: rewriteLineage, strategySnapshot: nextDraft.strategySnapshot, ...(generated.imageConcept ? { imageConcept: generated.imageConcept } : {}), ...(generated.imagePrompt ? { imagePrompt: generated.imagePrompt } : {}), ...(generated.videoConcept ? { videoConcept: generated.videoConcept } : {}), ...(generated.videoPrompt ? { videoPrompt: generated.videoPrompt } : {}), ...(generated.strategyRationale ? { strategyRationale: generated.strategyRationale } : {}), revisionId, parentRevisionId } }] };
          completionPersistenceAttempted = true;
          await controlPlaneClient.updateAgencyEntity("content-runs", revisionId, persistedPayload as Record<string, unknown>);
        });
        if (!nextDraft) throw new Error("CONTENT_GENERATION_EMPTY_RESULT");
        setDrafts((current) => current.map((item) => item.id === id ? nextDraft! : item));
        setQueueNotice(`Đã tạo bản chữ mới cho ${currentDraft.title}; media và kế hoạch gốc được giữ nguyên, cần kiểm tra và duyệt lại.`);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Không thể làm lại phần chữ; bản cũ vẫn được giữ nguyên.";
        const deterministicFailure = isDeterministicGenerationFailure(message);
        const outcome = error instanceof MediaOwnershipReconciliationError || !deterministicFailure && (providerDispatched && !providerResponded || completionPersistenceAttempted) ? "unknown" as const : "failed" as const;
        if (pendingRunPersisted && !completionPersistenceAttempted && revisionId) await controlPlaneClient.updateAgencyEntity("content-runs", revisionId, { generationStatus: outcome, state: outcome === "unknown" ? "needs_review" : "failed", rewriteError: message }).catch(() => undefined);
        setDrafts((current) => current.map((item) => item.id === id ? {
          ...item,
          rewriteStatus: outcome === "unknown" ? "unknown" : "failed",
          rewriteError: message,
          generationStatus: pendingRunPersisted ? outcome : item.generationStatus,
          revisionId: pendingRunPersisted ? revisionId : item.revisionId,
          parentRevisionId: pendingRunPersisted ? parentRevisionId : item.parentRevisionId,
          requestId: pendingRunPersisted ? requestId : item.requestId,
          time: `${outcome === "unknown" ? "Làm lại chưa rõ kết quả · cần đối soát" : "Làm lại thất bại"} · bản cũ vẫn được giữ nguyên`,
        } : item));
        setGenerationError(message);
        setQueueNotice(`${message} · bản cũ vẫn được giữ nguyên.`);
        return false;
      } finally {
        setIsGenerating(false);
      }
    });
    if (result === undefined) setQueueNotice("Content Run đang có một thao tác rewrite/restore khác; thử lại sau khi hoàn tất.");
  };

  const storeGeneratedOutput = async (result: { localAssetPath: string; mimeType: string; generatedAt: string; generatedSha256?: string; visualFingerprint?: string; thumbnailPath?: string }, contentRunId: string, platform: SocialPlatform, filename: string): Promise<typeof result & { sha256?: string }> => {
    if (!isElectronRuntime()) return result;
    try {
      return await invoke<typeof result & { sha256?: string }>("store_generated_media", { workspaceId: activeWorkspaceRecord.id, clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id, platform, capturedAt: result.generatedAt, contentRunId, localAssetPath: result.localAssetPath, filename, mimeType: result.mimeType });
    } catch (error) {
      throw new Error(error instanceof Error && error.message.startsWith("MEDIA_") ? error.message : "MEDIA_HIERARCHY_STORAGE_FAILED");
    }
  };

  const generateDraftMedia = async (id: number, kind: "image" | "video") => {
    const draft = draftsRef.current.find((item) => item.id === id);
    if (!draft) return;
    if (draftActionLocked(draft)) { setQueueNotice("Không thể tạo lại media trong lúc Quality/approval đang chạy hoặc chờ reconciliation."); return; }
    if (draft.generationStatus === "unknown" || draft.rewriteStatus === "unknown") { setQueueNotice("Không thể retry media: outcome chưa rõ, cần Control Plane reconciliation trước."); return; }
    const runId = draft.contentRunId ?? `content-${draft.id}`;
    if (draft.status === "Published" || draft.approvalState === "published" || draft.status === "Scheduled" || draft.approvalState === "scheduled" || draft.approvalState === "publishing" || draft.pendingPublicationIds?.length || hasActiveContentRunPublication(targetPublications, runId, `variant-${draft.id}`)) {
      setQueueNotice("Media regeneration bị chặn: Content Run đang có target publication cần hủy hoặc đối soát trước.");
      return;
    }
    const assetDeadline = createAssetOperationDeadline();
    const now = new Date();
    const provider = kind === "video" ? videoProvider : imageProvider;
    const slotId = draft.automationKey ?? runId;
    const strategyVersion = draft.strategyVersion ?? draft.strategySnapshot?.strategyVersion ?? 1;
    const idempotencyKey = draft.generationIdempotencyKey ?? generationIdempotencyKey({ contentRunId: runId, strategyVersion, format: kind });
    const operationVersion = nextCreativeAssetOperationVersion(draft.mediaOperations ?? [], kind, slotId, idempotencyKey);
    const currentMediaKind = draft.contentKind === "image" || draft.contentKind === "carousel" ? "image" : draft.contentKind === "video" || draft.contentKind === "short_video" || draft.contentKind === "long_video" ? "video" : draft.mediaKind;
    const promptResult = assetPromptForDraft({ mediaKind: currentMediaKind, visualPrompt: draft.visualPrompt, videoPrompt: draft.videoPrompt }, kind);
    const durableReplacement = Boolean(controlPlaneClient && draft.contentRunId);
    const submittedMediaRevision = typeof draft.mediaRevision === "number" && Number.isSafeInteger(draft.mediaRevision) && draft.mediaRevision >= 0 ? draft.mediaRevision : 0;
    const preAttemptMediaReview = {
      mediaAssetIds: draft.mediaAssetIds ? [...draft.mediaAssetIds] : undefined,
      mediaUrl: draft.mediaUrl,
      mediaPreviewUrl: draft.mediaPreviewUrl,
      mediaThumbnailUrl: draft.mediaThumbnailUrl,
      mediaKind: draft.mediaKind,
      contentKind: draft.contentKind,
      mediaSha256: draft.mediaSha256,
      visualFingerprint: draft.visualFingerprint,
      mediaProvenance: draft.mediaProvenance ? { ...draft.mediaProvenance } : undefined,
      mediaEvidence: draft.mediaEvidence?.map((item) => ({ ...item })),
      mediaSetFingerprint: draft.mediaSetFingerprint,
      mediaRevision: draft.mediaRevision,
      qualityStatus: draft.qualityStatus,
      qualityChecks: draft.qualityChecks?.map((item) => ({ ...item })),
      approvalState: draft.approvalState,
      status: draft.status,
      time: draft.time,
    };
    let stage = "asset_generation";
    let completedExtra: Record<string, unknown> = {};
    let replacementMediaFingerprint: string | undefined;
    let replacementMediaEvidence: ContentRunMediaEvidence[] = [];
    let replacementReconciliation: string = "none";
    const markReplacementReconciliationRequired = () => {
      replacementReconciliation = "unknown";
      setDrafts((current) => current.map((item) => item.id === id ? { ...item, generationStatus: "unknown", rewriteStatus: "unknown", rewriteError: "CONTENT_RUN_MEDIA_REPLACEMENT_RECONCILIATION_REQUIRED", qualityStatus: "pending", qualityChecks: undefined, approvalState: "proposed", status: "Needs review", time: "Media outcome unknown · reconciliation required before retry" } : item));
    };
    let attemptActive = true;
    const persistMediaOperation = (operation: CreativeAssetOperation, history: readonly CreativeAssetOperation[], extra: Record<string, unknown>): Promise<unknown> => {
      if (operation.status === "failed" && replacementReconciliation === "unknown") return Promise.resolve();
      if (!controlPlaneClient || !draft.contentRunId) return Promise.resolve();
      const commonExtra = { planId: draft.planId, targetBindingIds: draft.bindingIds, bindingIds: draft.bindingIds, generationIdempotencyKey: idempotencyKey, ...extra };
      const replacementExtra = replacementMediaFingerprint
        ? { ...commonExtra, mediaRevision: submittedMediaRevision, ...(draft.contentIntelligenceLineage ? { prompt: draft.prompt, contentIntelligenceLineage: { ...draft.contentIntelligenceLineage, mediaSetFingerprint: replacementMediaFingerprint } } : {}) }
        : commonExtra;
      const payload = operation.status === "completed" && replacementMediaFingerprint
        ? buildMediaReplacementPersistencePatch(operation, history, { mediaAssetIds: replacementMediaEvidence.map((item) => item.assetId), mediaSetFingerprint: replacementMediaFingerprint, mediaEvidence: replacementMediaEvidence, extra: replacementExtra })
        : buildAssetOperationPersistencePatch(operation, history, { state: "content_generated", invalidateReview: true, extra: commonExtra });
      const write = operation.status === "running" ? withAssetOperationDeadline : withAssetOperationTerminalGrace;
      const persist = write(async () => {
        if (operation.status === "completed" && replacementMediaFingerprint) {
          const replacement = { mediaAssetIds: replacementMediaEvidence.map((item) => item.assetId), mediaSetFingerprint: replacementMediaFingerprint, mediaEvidence: replacementMediaEvidence };
          const reconciliation = await reconcileContentRunMediaReplacement({
            runId: draft.contentRunId!,
            operation,
            submittedRevision: submittedMediaRevision,
            replacement,
            acknowledge: () => controlPlaneClient.updateAgencyEntity("content-runs", draft.contentRunId!, payload),
            getContentRun: (contentRunId) => controlPlaneClient.getContentRun(contentRunId),
          });
          if (reconciliation.status === "unknown") {
            markReplacementReconciliationRequired();
            throw new Error(reconciliation.code);
          }
          if (reconciliation.status === "reconciled") {
            replacementReconciliation = "reconciled";
            const snapshot = reconciliation.snapshot;
            const durableMediaAssetIds = snapshot.mediaAssetIds ?? snapshot.media_asset_ids;
            const durableMediaEvidence = snapshot.mediaEvidence ?? snapshot.media_evidence;
            const durableMediaOperations = snapshot.mediaOperations ?? snapshot.media_operations ?? snapshot.visualOperations ?? snapshot.visual_operations;
            const durableMediaSetFingerprint = snapshot.mediaSetFingerprint ?? snapshot.media_set_fingerprint;
            setDrafts((current) => current.map((item) => item.id === id ? {
              ...item,
              ...extra,
              ...(Array.isArray(durableMediaAssetIds) ? { mediaAssetIds: [...durableMediaAssetIds] as string[] } : {}),
              ...(Array.isArray(durableMediaEvidence) ? { mediaEvidence: durableMediaEvidence as Draft["mediaEvidence"] } : {}),
              ...(Array.isArray(durableMediaOperations) ? { mediaOperations: durableMediaOperations as CreativeAssetOperation[] } : {}),
              ...(typeof durableMediaSetFingerprint === "string" ? { mediaSetFingerprint: durableMediaSetFingerprint } : {}),
              mediaRevision: reconciliation.mediaRevision,
              generationStatus: typeof snapshot.generationStatus === "string" ? snapshot.generationStatus as Draft["generationStatus"] : item.generationStatus,
              qualityStatus: "pending",
              qualityChecks: undefined,
              approvalState: "proposed",
              status: "Needs review",
              time: "Media replacement confirmed by Control Plane after ACK reconciliation",
            } : item));
            return snapshot;
          }
          setDrafts((current) => current.map((item) => item.id === id ? { ...item, ...extra, mediaRevision: reconciliation.mediaRevision } : item));
          return reconciliation.acknowledgement;
        }
        const ack = await controlPlaneClient.updateAgencyEntity("content-runs", draft.contentRunId!, payload);
        assertContentRunAssetAck(ack, draft.contentRunId!, operation);
        return ack;
      }, assetDeadline.deadlineAt);
      return persist.catch((error) => {
        if (operation.status === "completed" && replacementMediaFingerprint && replacementReconciliation === "none") markReplacementReconciliationRequired();
        throw error;
      });
    };
    const outcome = await runAssetOperation({
      kind,
      provider,
      slotId,
      strategyVersion,
      idempotencyKey,
      operationVersion,
      history: draft.mediaOperations,
      deadlineAt: assetDeadline.deadlineAt,
      now,
      checkpoint: (operation, history, extra) => {
        setDrafts((current) => current.map((item) => {
          if (item.id !== id) return item;
          const checkpoint = { ...item, mediaOperation: operation, mediaOperations: [...history], generationIdempotencyKey: idempotencyKey, qualityStatus: "pending" as const, qualityChecks: undefined, approvalState: "proposed" as const, status: "Needs review" as const };
          if (operation.status === "failed" && durableReplacement && replacementMediaFingerprint) {
            if (replacementReconciliation === "unknown") return { ...checkpoint, generationStatus: "unknown", rewriteStatus: "unknown", rewriteError: "CONTENT_RUN_MEDIA_REPLACEMENT_RECONCILIATION_REQUIRED", time: "Media outcome unknown · reconciliation required before retry" };
            return { ...checkpoint, ...preAttemptMediaReview };
          }
          if (operation.status === "completed" && durableReplacement && replacementMediaFingerprint) return checkpoint;
          return { ...checkpoint, ...extra };
        }));
      },
      persist: persistMediaOperation,
      validate: () => {
        if (!promptResult.ok) return { ok: false as const, stage: "prompt_validation", reason: promptResult.code };
        if (kind === "video" && videoProvider !== "veo") return { ok: false as const, stage: "provider_readiness", reason: "VIDEO_PROVIDER_NOT_CONFIGURED" };
        if (kind === "image" && imageProvider === "local_preview") return { ok: false as const, stage: "provider_readiness", reason: "IMAGE_PROVIDER_NOT_VERIFIED" };
        return { ok: true as const };
      },
      extraForOperation: (operation) => operation.status === "completed" ? completedExtra : {},
      failureStage: (error) => /(?:NOT_VERIFIED|NOT_CONFIGURED|SESSION|THROTTLED|API_NOT)/i.test(error instanceof Error ? error.message : "") ? "provider_readiness" : stage,
      onSettled: (operation) => { if (operation.status !== "running") attemptActive = false; },
      execute: async () => {
        const assetRequest: AssetGenerationRequest = { kind, prompt: promptResult.ok ? promptResult.prompt : "", concept: (kind === "image" ? draft.visualConcept : draft.videoConcept)?.trim() ?? "", slotId, strategyVersion, idempotencyKey, workspaceId: activeWorkspaceRecord.id, deadlineAt: assetDeadline.deadlineAt };
        const result = kind === "video"
          ? await new GoogleFlowVideoProvider().generate(assetRequest)
          : imageProvider === "google_flow" ? await new GoogleFlowImageProvider().generate(assetRequest) : await new VertexAIImageProvider().generate(assetRequest);
        if (!attemptActive) throw new Error("ASSET_ATTEMPT_SUPERSEDED");
        stage = "asset_storage";
        const extension = kind === "video" ? "mp4" : result.mimeType.toLowerCase().includes("jpeg") || result.mimeType.toLowerCase().includes("jpg") ? "jpg" : "png";
        const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, "-");
        const stored = await storeGeneratedOutput(result, runId, draft.platform.toLowerCase() as SocialPlatform, `generated-${safeRunId}-${kind}.${extension}`);
        if (!attemptActive) throw new Error("ASSET_ATTEMPT_SUPERSEDED");
        const record = createGeneratedMediaRecord({ id: `generated-content-${safeRunId}-${kind}`, clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id, contentRunId: runId, topic: draft.topic ?? draft.title, platform: draft.platform.toLowerCase() as SocialPlatform, name: `${draft.title} · generated ${kind}`, localAssetPath: stored.localAssetPath, mimeType: stored.mimeType, generatedAt: stored.generatedAt ?? result.generatedAt, generatedSha256: stored.generatedSha256 ?? stored.sha256, visualFingerprint: stored.visualFingerprint, provider: kind === "video" ? "google_flow" : result.provider === "vertex_ai" ? "vertex_ai" : "google_flow" });
        const generatedSha256 = (stored.generatedSha256 ?? stored.sha256 ?? "").replace(/^sha256:/i, "").toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(generatedSha256)) throw new Error("MEDIA_SET_FINGERPRINT_REQUIRED");
        const generatedEvidence: ContentRunMediaEvidence[] = [{ assetId: record.id, sha256: generatedSha256, mimeType: stored.mimeType.trim().toLowerCase(), order: 0, role: "publish", uploadState: "processed", attachmentBoundary: "generated_asset" }];
        if (controlPlaneClient && draft.contentRunId) {
          const storedMedia = await controlPlaneClient.listAgencyRecords("media-assets", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id });
          if (!storedMedia.some((item) => String(item.id ?? "") === record.id)) await controlPlaneClient.createAgencyRecord("media-assets", {
            id: record.id,
            clientId: activeWorkspaceRecord.id,
            brandId: activeBrandRecord.id,
            source: "generated",
            metadata: { kind: record.kind, mimeType: generatedEvidence[0].mimeType, sha256: generatedSha256, visualFingerprint: record.visualFingerprint, archiveState: "active", reviewStatus: "needs_review", distribution: record.distribution, usageStatus: "available" },
          });
        }
        replacementMediaFingerprint = await fingerprintMediaReplacement(generatedEvidence);
        replacementMediaEvidence = generatedEvidence;
        setAutomationState((current) => ({ ...current, mediaAssets: [record, ...current.mediaAssets.filter((asset) => asset.id !== record.id)] }));
        setAssets((current) => [{ ...mediaCardFromInventory(record), status: "Needs review", size: "Generated local output · unverified" }, ...current.filter((asset) => String(asset.id) !== record.id)]);
        completedExtra = { mediaAssetIds: [record.id], mediaPreviewUrl: localMediaPreviewUrl(stored.localAssetPath), ...(stored.thumbnailPath ? { mediaThumbnailUrl: localMediaPreviewUrl(stored.thumbnailPath) } : {}), mediaKind: kind, mediaProvenance: record.provenance as unknown as Record<string, unknown>, mediaSha256: record.sha256, visualFingerprint: record.visualFingerprint, contentKind: kind, mediaSetFingerprint: replacementMediaFingerprint, mediaEvidence: replacementMediaEvidence, ...(kind === "video" ? { videoProvider } : {}) };
        return { result, stored };
      },
      describeResult: ({ result }) => ({ stage, provider: result.provider, createdAt: result.generatedAt }),
    });
    if (replacementReconciliation === "unknown") setQueueNotice(`${kind === "video" ? "Video" : "Image"} media outcome unknown · Control Plane reconciliation required before retry.`);
    else if (outcome.operation.status === "blocked") setQueueNotice(`${kind === "video" ? "Video" : "Image"} generation blocked · ${provider} · ${outcome.operation.stage} · ${outcome.operation.reason}`);
    else if (outcome.operation.status === "failed") setQueueNotice(`${kind === "video" ? "Video" : "Image"} generation failed · ${provider} · ${outcome.operation.stage} · ${outcome.operation.reason ?? "ASSET_PROVIDER_ERROR"}. Content vẫn giữ nguyên để review/retry.`);
    else setQueueNotice(kind === "video" ? "Video mới đã tạo qua Google Flow/Veo; cần upload/public URL + review metadata trước khi publish live." : "Ảnh mới đã tạo qua provider được verify; cần upload/public URL + review metadata trước khi publish live.");
  };
  const exportManualPackage = (id: number) => {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) return;
    const connection = agencyConnections.find((item) => item.platform === draft.platform.toLowerCase());
    if (!connection) {
      setQueueNotice(`Không tìm thấy channel để xuất manual package cho ${draft.platform}.`);
      return;
    }
    const payload = createManualPublishPackage(draftToVariant(draft), connection, new Date(Date.now() + 60 * 60 * 1000));
    void downloadLocalJson(`signalflow-manual-${draft.platform.toLowerCase()}-${draft.id}.json`, payload)
      .then((location) => setQueueNotice(`Đã xuất manual publish package cho ${draft.platform}: ${location}`))
      .catch((error) => setQueueNotice(error instanceof Error ? error.message : "Không thể xuất manual publish package."));
  };
  const performApproveDraft = async (id: number, overrideScheduledAt?: string): Promise<DraftActionOutcome> => {
    const draft = draftsRef.current.find((item) => item.id === id);
    if (!draft) return { status: "failure", message: "Draft không còn trong workspace hiện tại." };
    const scopeKey = draftActionScopeKey(draftActionScope(draft));
    const contentRunId = draft.contentRunId;
    const notify = (message: string) => setActionNotice(scopeKey, id, contentRunId, message);
    const fail = (message: string): DraftActionOutcome => { notify(message); return { status: "failure", message }; };
    if (schedulePromptDraftId !== undefined && schedulePromptDraftId !== id) return fail("Finish or cancel the open schedule picker before starting another approval.");
    if (targetActionPrompt) return fail("Finish or cancel the open target selection before starting another approval.");
    if (!currentMembership || !canRole(currentMembership.role, "approve_content")) return fail("Role hiện tại chỉ được xem; không có quyền approve target.");
    if (draft.status !== "Needs review") return fail("Only drafts in Needs review can be approved.");
    if (draft.pendingPublicationIds?.length) return { status: "pending", pendingReason: "reconciliation", message: "Approval đang được Control Plane/worker đối soát; chờ đồng bộ target trước khi thử lại." };
    if (draft.rewriteStatus === "generating" || draft.rewriteStatus === "unknown" || draft.generationStatus === "pending" || draft.generationStatus === "unknown" || draft.mediaOperation?.status === "running") return fail("Approval bị chặn khi copy hoặc media đang chạy/chờ đối soát.");
    if (draft.qualityStatus !== "passed") return fail("Approval blocked: run Quality check and resolve every failed readiness item first.");
    const plan = draft.planId ? automationPlans.find((candidate) => candidate.id === draft.planId) : undefined;
    const scheduleDecision = approvalSchedulePromptDecision({ planId: draft.planId, hasMatchingPlan: Boolean(plan), draftScheduledAt: draft.scheduledAt, overrideScheduledAt });
    if (scheduleDecision.action === "reject") return fail(scheduleDecision.message);
    const openSchedulePrompt = (message: string): DraftActionOutcome => {
      const fallback = new Date(Date.now() + 60 * 60 * 1000);
      schedulePromptOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      schedulePromptScopeKeyRef.current = scopeKey;
      setSchedulePromptValue(dateTimeLocalValue(fallback));
      setSchedulePromptDraftId(id);
      return { status: "pending", pendingReason: "selection", message };
    };
    if (scheduleDecision.action === "open_picker") return openSchedulePrompt("Bài chưa có kế hoạch; chọn ngày giờ trong cửa sổ vừa mở. Chưa gửi approval request.");
    if (!controlPlaneClient) return fail("Approval bị chặn: Control Plane chưa sẵn sàng.");
    const baseConnection = agencyConnections.find((item) => item.platform === draft.platform.toLowerCase());
    if (!baseConnection) return fail(`Không tìm thấy connection cho ${draft.platform}.`);
    let bindingIds = draft.bindingIds?.length ? [...draft.bindingIds] : [];
    if (bindingIds.some((bindingId) => !workspaceState.channelBindings?.some((binding) => binding.id === bindingId && binding.state === "connected"))) bindingIds = [];
    if (bindingIds.length === 0) {
      const targetId = draft.targetPageId ?? metaSelectedPageId ?? baseConnection.accountId;
      const existingBinding = workspaceState.channelBindings?.find((binding) => binding.brandId === activeBrandRecord.id && binding.targetExternalId === targetId && binding.state === "connected");
      if (existingBinding) bindingIds = [existingBinding.id];
      else {
        const target = connectionTargets.find((candidate) => candidate.id === targetId && candidate.platform === draft.platform.toLowerCase());
        const identityId = draft.identityVersionId ?? activeBrandIdentity?.id;
        const connectionIdByTarget = Object.fromEntries(agencyConnections.map((connection) => [connection.accountId, connection.id]));
        if (!target || !presentConnectionState(target.state).selectable || !identityId) return fail("Bài chưa gắn với Page đăng. Mở Settings → Target bindings và chọn Page trước khi duyệt.");
        const createdBinding = createBindingsForTargets({ brandId: activeBrandRecord.id, identityId, connectionIdByTarget, targets: [target] }).bindings[0];
        if (!createdBinding) return fail("Không thể tạo target binding cho Page đã chọn.");
        try { await controlPlaneClient.createAgencyRecord("bindings", createdBinding as unknown as Record<string, unknown>); }
        catch (error) { return fail(`Target binding chưa được lưu; chưa duyệt target nào. ${error instanceof Error ? error.message : "BINDING_PERSIST_FAILED"}`); }
        if (actionScopeIsCurrent(scopeKey, id, contentRunId)) setWorkspaceState((current) => ({ ...current, channelBindings: [...(current.channelBindings ?? []).filter((binding) => binding.id !== createdBinding.id), createdBinding] }));
        bindingIds = [createdBinding.id];
      }
    }
    const identityVersionId = draft.identityVersionId ?? activeBrandIdentity?.id;
    const variant = draftToVariant({ ...draft, identityVersionId, bindingIds });
    const readiness = checkPublishReadiness({ ...buildContentRunFromDraft({ ...draft, bindingIds, qualityStatus: "passed", approvalState: "ready" }), approvalState: "approved" });
    if (!readiness.ok) return fail(`Approval blocked by readiness: ${readiness.failures.join(" · ")}`);
    const linkedAsset = draft.mediaAssetIds?.map((assetId) => assets.find((asset) => String(asset.id) === String(assetId))).find(Boolean);
    const workerKind = variant.kind === "image" ? "image" : variant.kind === "video" || variant.kind === "short_video" ? "video" : "text";
    const workerMediaUrl = workerKind === "image" ? (variant.metadata as { imageUrl?: string }).imageUrl ?? linkedAsset?.publicUrl : workerKind === "video" ? (variant.metadata as { videoUrl?: string }).videoUrl ?? linkedAsset?.publicUrl : undefined;
    const targets = bindingIds.map((bindingId) => {
      const binding = workspaceState.channelBindings?.find((item) => item.id === bindingId);
      const pageId = binding?.targetExternalId ?? draft.targetPageId ?? metaSelectedPageId ?? baseConnection.accountId;
      const connection = agencyConnections.find((item) => item.id === binding?.connectionId) ?? agencyConnections.find((item) => item.accountId === pageId) ?? baseConnection;
      return { bindingId, pageId, platform: binding?.platform ?? connection.platform, connection };
    });
    if (targets.some((target) => !target.pageId || !target.bindingId)) return fail("Mọi target phải có binding và Page ID rõ ràng trước khi duyệt.");
    if (targets.some((target) => target.platform === "facebook" && workerKind !== "text" && (!workerMediaUrl || !linkedAsset || linkedAsset.status !== "Ready" || !linkedAsset.publicUrl || !linkedAsset.visualFingerprint || !/^sha256:[a-f0-9]{64}$/i.test(linkedAsset.checksum ?? "")))) {
      return fail("Live media publish requires Ready public media with HTTPS URL, SHA-256 and visual fingerprint metadata.");
    }

    const reservedSlots = targetPublications.filter((publication) => publication.state !== "canceled" && publication.state !== "cancelled" && publication.scheduledAt)
      .flatMap((publication) => {
        const binding = workspaceState.channelBindings?.find((item) => item.id === publication.bindingId);
        const pageId = publication.targetExternalId ?? binding?.targetExternalId;
        const platform = publication.platform ?? binding?.platform;
        return pageId && platform && publication.scheduledAt ? [`${platform}|${pageId}|${new Date(publication.scheduledAt).toISOString()}`] : [];
      });
    queueRef.current.list().forEach((job) => {
      if (publicationByJobRef.current.has(job.id) || job.state === "canceled") return;
      const binding = workspaceState.channelBindings?.find((item) => item.id === job.bindingId);
      const pageId = binding?.targetExternalId ?? job.connectionId;
      const platform = binding?.platform ?? agencyConnections.find((item) => item.id === job.connectionId)?.platform;
      if (platform && pageId) reservedSlots.push(`${platform}|${pageId}|${new Date(job.scheduledAt).toISOString()}`);
    });
    const requestedAt = overrideScheduledAt ? new Date(overrideScheduledAt) : draft.scheduledAt ? new Date(draft.scheduledAt) : undefined;
    if (overrideScheduledAt && (!requestedAt || !Number.isFinite(requestedAt.getTime()) || requestedAt.getTime() <= Date.now())) return fail("Giờ đăng phải nằm trong tương lai.");
    const schedules: Array<{ target: typeof targets[number]; scheduledAt: Date }> = [];
    for (const target of targets) {
      let selected = requestedAt && Number.isFinite(requestedAt.getTime()) && requestedAt.getTime() > Date.now() ? requestedAt : undefined;
      const slotKey = (date: Date) => `${target.platform}|${target.pageId}|${date.toISOString()}`;
      const validate = (date: Date) => {
        if (reservedSlots.includes(slotKey(date))) return { ok: false as const, code: "SLOT_RESERVED" };
        return plan ? validateAutomationPlanSchedule(plan, target.platform, target.pageId, date, reservedSlots) : { ok: true as const };
      };
      if (selected) {
        const result = validate(selected);
        if (!result.ok) {
          if (overrideScheduledAt) return fail(`Giờ đăng không hợp lệ cho ${target.pageId} (${result.code}); chưa có target nào được duyệt.`);
          selected = undefined;
        }
      }
      if (!selected && plan) {
        const slotStart = requestedAt && Number.isFinite(requestedAt.getTime()) && requestedAt.getTime() > Date.now() ? requestedAt : new Date();
        const next = selectNextAvailablePlanSlot(automationPlans, plan.id, target.bindingId, slotStart, reservedSlots, [target.pageId], target.platform);
        if (next.ok && Date.parse(next.scheduledAt) > Date.now()) selected = new Date(next.scheduledAt);
      }
      if (!selected) {
        if (overrideScheduledAt) return fail(`Không có giờ hợp lệ cho target ${target.pageId}; chưa có target nào được duyệt.`);
        return openSchedulePrompt(plan ? `Kế hoạch ${plan.name ?? plan.id} không còn slot đủ điều kiện; chọn giờ trong cửa sổ vừa mở. Chưa gửi approval request.` : "Bài chưa có kế hoạch hoặc giờ đăng hợp lệ; chọn ngày giờ trong cửa sổ vừa mở. Chưa gửi approval request.");
      }
      schedules.push({ target, scheduledAt: selected });
      reservedSlots.push(slotKey(selected));
    }

    const requests = schedules.map(({ target, scheduledAt }) => {
      const idempotencyKey = createTargetPublicationIdempotencyKey(activeWorkspaceRecord.id, activeBrandRecord.id, target.bindingId, variant.id, scheduledAt.toISOString());
      const workerJobId = `job_${idempotencyKey.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const publicationId = `publication-${workerJobId}`;
      const preflight = {
        clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id, bindingId: target.bindingId,
        identityVersionId: identityVersionId ?? "", variantId: variant.id, platform: target.platform, kind: workerKind,
        scheduledAt: scheduledAt.toISOString(), approvalState: "approved",
        requiredScopes: target.platform === "facebook" ? ["pages_manage_posts", "pages_read_engagement"] : [],
        mediaRequired: workerKind !== "text", mediaEligible: linkedAsset?.status === "Ready", mediaUrl: workerMediaUrl,
      };
      const workerMediaPayload = workerKind !== "text" ? buildDurableWorkerMediaPayload(workerKind, linkedAsset, activeBrandRecord.id, target.bindingId, identityVersionId ?? `identity-${activeBrandRecord.id}-v1`, target.pageId, draft.automationKey ?? idempotencyKey) : {};
      const workerPayload = {
        agency_contract_version: 1, workspace_id: target.connection.workspaceId, client_id: activeWorkspaceRecord.id, brand_id: activeBrandRecord.id,
        target_publication_id: publicationId, binding_id: target.bindingId, page_id: target.pageId, plan_id: draft.planId,
        content_run_id: draft.contentRunId ?? `content-${draft.id}`,
        variant_id: variant.id, identity_version_id: identityVersionId ?? `identity-${activeBrandRecord.id}-v1`,
        media_eligible: workerKind === "text" || linkedAsset?.status === "Ready", message: variant.body?.trim() ?? variant.title,
        required_scopes: preflight.requiredScopes,
        ...(workerMediaUrl ? { media_url: workerMediaUrl } : {}), ...workerMediaPayload, idempotency_key: idempotencyKey,
        approval_state: "approved", platform: target.platform, kind: workerKind,
      };
      return {
        target, preflight, scheduledAt: scheduledAt.toISOString(), idempotencyKey, workerJobId, publicationId,
        payload: {
          id: publicationId, contentRunId: draft.contentRunId ?? `content-${draft.id}`, idempotencyKey,
          requestId: `approve-${publicationId}`, planId: draft.planId,
          ...preflight,
          workerJob: { jobId: workerJobId, idempotencyKey, scheduledAt: scheduledAt.toISOString(), payload: workerPayload },
        },
      };
    });
    try {
      const preflights = await Promise.all(requests.map((request) => controlPlaneClient.preflightTargetPublication(request.preflight)));
      const blocked = preflights.find((result) => result.ok !== true);
      if (blocked) return fail(`Control Plane preflight blocked approval: ${String(blocked.blockReason ?? "TARGET_NOT_READY")}.`);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Control Plane preflight could not be confirmed.");
    }
    const approvalContentRunId = draft.contentRunId ?? `content-${draft.id}`;
    try {
      const run = buildContentRunFromDraft({ ...draft, bindingIds, qualityStatus: "passed", approvalState: "ready" });
      const runRecord = {
        ...run, id: approvalContentRunId, planId: draft.planId, targetBindingIds: bindingIds, bindingIds,
        scheduledAt: schedules[0]?.scheduledAt, state: "needs_review", approvalState: "pending", qualityStatus: "passed",
        targetApprovalState: "pending", targetApprovalIntents: requests.map((request) => request.payload),
        variants: [{ id: variant.id, platform: variant.platform, kind: variant.kind, title: variant.title, body: variant.body ?? "", caption: variant.body ?? "", cta: variant.cta, hashtags: variant.hashtags, seoKeywords: variant.seoKeywords, mediaAssetIds: variant.mediaAssetIds, metadata: variant.metadata }],
      };
      if (draft.contentRunId) await controlPlaneClient.updateAgencyEntity("content-runs", approvalContentRunId, buildApprovalContentRunPatch({
        state: "needs_review", scheduledAt: schedules[0]?.scheduledAt.toISOString(), approvalState: "pending", targetApprovalState: "pending",
        targetApprovalIntents: requests.map((request) => request.payload), planId: draft.planId, targetBindingIds: bindingIds, bindingIds,
      }));
      else await controlPlaneClient.createAgencyRecord("content-runs", runRecord as unknown as Record<string, unknown>);
      if (!draft.contentRunId) setDraftsForAction(scopeKey, id, contentRunId, (item) => ({ ...item, contentRunId: approvalContentRunId }));
    } catch (error) {
      return fail(error instanceof Error ? `Content Run identity could not be persisted; no target was approved: ${error.message}` : "Content Run identity could not be persisted; no target was approved.");
    }
    let outcome: Awaited<ReturnType<typeof controlPlaneClient.approveTargetPublications>>;
    try { outcome = await controlPlaneClient.approveTargetPublications(requests.map((request) => request.payload)); }
    catch (error) { return fail(error instanceof Error ? `Control Plane approval request failed: ${error.message}` : "Control Plane approval request failed."); }
    const allTargetsAcknowledged = outcome.acknowledged.length === requests.length && outcome.acknowledged.every((publication) => {
      const workerAckState = String(publication.workerAckState ?? publication.worker_ack_state ?? "");
      return publication.commandStatus === "acknowledged" && publication.state === "scheduled" && !publication.pendingCommandId && !publication.pending_command_id
        && ["acknowledged", "confirmed", "accepted"].includes(workerAckState);
    });
    if (!outcome.complete || !allTargetsAcknowledged || outcome.pending.length > 0) {
      const pendingApprovalCommands = outcome.results.some((result) => result.status === "pending");
      const terminallyCompensated = outcome.failed.length > 0 && outcome.pending.length === 0 && outcome.compensated;
      let needsReconciliation = !terminallyCompensated && (pendingApprovalCommands || !outcome.compensated || !allTargetsAcknowledged);
      if (needsReconciliation) setDraftsForAction(scopeKey, id, contentRunId, (item) => ({
        ...item, contentRunId: approvalContentRunId, bindingIds, planId: draft.planId,
        pendingPublicationIds: requests.map((request) => request.publicationId),
        pendingApprovalCompensation: !pendingApprovalCommands && !outcome.compensated,
        time: "Control Plane approval đang được đối soát",
      }));
      if (terminallyCompensated) {
        try {
          await controlPlaneClient.updateAgencyEntity("content-runs", approvalContentRunId, { state: "needs_review", approvalState: "pending", targetApprovalState: "failed", planId: draft.planId, targetBindingIds: bindingIds, bindingIds });
        } catch {
          setDraftsForAction(scopeKey, id, contentRunId, (item) => ({ ...item, contentRunId: approvalContentRunId, bindingIds, planId: draft.planId, pendingPublicationIds: requests.map((request) => request.publicationId), pendingApprovalCompensation: true, time: "Targets are canceled; Content Run state is reconciling" }));
          needsReconciliation = true;
        }
      }
      try {
        const rows = await controlPlaneClient.listAgencyRecords("target-publications", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id });
        const summaries = (rows as unknown as Array<Record<string, unknown>>).map((row) => targetPublicationSummary(row));
        summaries.forEach((publication) => {
          publicationByJobRef.current.set(publication.id, publication.id);
          if (publication.workerJobId) { publicationByJobRef.current.set(publication.workerJobId, publication.id); durableWorkerJobIdsRef.current.add(publication.workerJobId); }
        });
        if (actionScopeIsCurrent(scopeKey, id, contentRunId)) {
          let canceledLegacyJobs = false;
          outcome.compensatedTargets.forEach((record) => {
            const publication = targetPublicationSummary(record);
            const workerJobId = publication.workerJobId ?? requests.find((request) => request.publicationId === publication.id)?.workerJobId;
            if (workerJobId && queueRef.current.cancel(workerJobId)?.state === "canceled") canceledLegacyJobs = true;
          });
          if (canceledLegacyJobs) { setQueueJobs(queueRef.current.list()); setQueueRevision((value) => value + 1); }
          setTargetPublications((current) => [...summaries, ...current.filter((publication) => !summaries.some((row) => row.id === publication.id))]);
        }
      } catch { /* The reconciliation poll retries after outbox recovery. */ }
      const message = outcome.compensated
        ? `Approval chưa hoàn tất; Control Plane chưa xác nhận toàn bộ targets. Mã: ${outcome.failureCode ?? "PUBLICATION_COMMAND_PENDING"}.`
        : `Approval fan-out đang cần reconciliation; draft vẫn ở trạng thái cần duyệt lại. Mã: ${outcome.failureCode ?? "PUBLICATION_COMMAND_PENDING"}.`;
      notify(message);
      return needsReconciliation ? { status: "pending", pendingReason: "reconciliation", message } : { status: "failure", message };
    }
    try {
      await controlPlaneClient.updateAgencyEntity("content-runs", approvalContentRunId, buildApprovalContentRunPatch({
        state: "scheduled", approvalState: "approved", scheduledAt: schedules[0]?.scheduledAt.toISOString(), targetApprovalState: "acknowledged",
        targetApprovalIntents: requests.map((request) => request.payload), planId: draft.planId, targetBindingIds: bindingIds, bindingIds,
      }));
    } catch (error) {
      const compensationResults = await Promise.all(outcome.acknowledged.map(async (publication) => {
        const publicationId = typeof publication.id === "string" ? publication.id : "";
        const revision = publication.revision;
        if (!publicationId || !Number.isSafeInteger(revision)) return { publicationId, commandStatus: "pending", state: "scheduled" };
        try {
          return await controlPlaneClient.targetPublicationCommand(publicationId, {
            action: "cancel", clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id,
            expectedRevision: revision, requestId: `c2-content-run-save-compensate-${publicationId.replace(/[^A-Za-z0-9_.:-]/g, "_")}-${revision}`,
          });
        } catch {
          return { publicationId, commandStatus: "pending", state: "scheduled" };
        }
      }));
      const allCompensated = compensationResults.length === requests.length && compensationResults.every((result) => result.commandStatus === "acknowledged" && result.state === "canceled");
      const summaries = compensationResults.map((result, index) => {
        const parsed = targetPublicationSummary(result);
        const request = requests[index];
        return { ...parsed, id: parsed.id || request.publicationId, clientId: parsed.clientId || activeWorkspaceRecord.id, brandId: parsed.brandId || activeBrandRecord.id, bindingId: parsed.bindingId || request.target.bindingId, targetExternalId: parsed.targetExternalId || request.target.pageId, platform: parsed.platform || request.target.platform, variantId: parsed.variantId || variant.id, planId: parsed.planId || draft.planId, scheduledAt: parsed.scheduledAt || request.scheduledAt, workerJobId: parsed.workerJobId || request.workerJobId } as TargetPublicationSummary;
      });
      if (actionScopeIsCurrent(scopeKey, id, contentRunId)) setTargetPublications((current) => [...summaries, ...current.filter((candidate) => !summaries.some((publication) => publication.id === candidate.id))]);
      if (!allCompensated) setDraftsForAction(scopeKey, id, contentRunId, (item) => ({ ...item, pendingPublicationIds: requests.map((request) => request.publicationId), pendingApprovalCompensation: true, status: "Needs review", approvalState: "proposed", time: "Content Run update failed · target reconciliation required" }));
      const message = allCompensated ? `Targets were canceled because the approved Content Run state could not be saved: ${error instanceof Error ? error.message : "Control Plane error"}` : "Content Run state could not be saved; acknowledged targets are being canceled and reconciled. Draft remains Needs review.";
      notify(message);
      return allCompensated ? { status: "failure", message } : { status: "pending", pendingReason: "reconciliation", message };
    }
    const approvedPublications = outcome.acknowledged.map((record, index) => {
      const request = requests[index];
      const parsed = targetPublicationSummary(record);
      const publication: TargetPublicationSummary = {
        ...parsed, id: parsed.id || request.publicationId, clientId: parsed.clientId || activeWorkspaceRecord.id,
        brandId: parsed.brandId || activeBrandRecord.id, bindingId: parsed.bindingId || request.target.bindingId,
        targetExternalId: parsed.targetExternalId || request.target.pageId, platform: parsed.platform || request.target.platform,
        variantId: parsed.variantId || variant.id, planId: parsed.planId || draft.planId, scheduledAt: parsed.scheduledAt || request.scheduledAt,
        idempotencyKey: parsed.idempotencyKey || request.idempotencyKey, state: parsed.state || "scheduled",
        workerJobId: parsed.workerJobId || request.workerJobId,
      };
      if (actionScopeIsCurrent(scopeKey, id, contentRunId)) {
        const displayJobId = publication.workerJobId ?? publication.id;
        publicationByJobRef.current.set(displayJobId, publication.id);
        publicationByJobRef.current.set(publication.id, publication.id);
        if (publication.workerJobId) durableWorkerJobIdsRef.current.add(publication.workerJobId);
        if (draft.automationKey) reservationByJobRef.current.set(displayJobId, draft.automationKey);
        if (draft.automationKey) creativeRunByJobRef.current.set(displayJobId, `creative-${draft.automationKey}`);
        draftByJobRef.current.set(displayJobId, { draftId: id, contentRunId: draft.contentRunId });
      }
      return publication;
    });
    if (actionScopeIsCurrent(scopeKey, id, contentRunId)) {
      setTargetPublications((current) => [...approvedPublications, ...current.filter((candidate) => !approvedPublications.some((publication) => publication.id === candidate.id))]);
      if (draft.automationKey) setAutomationState((current) => ({ ...current, creativeRuns: current.creativeRuns.map((run) => run.id === `creative-${draft.automationKey}` && (run.state === "needs_review" || run.state === "review") ? transitionCreativeRun(transitionCreativeRun(run, "approved"), "scheduled") : run) }));
    }
    const jobIds = approvedPublications.map((publication) => publication.workerJobId ?? publication.id);
    const scheduledAt = approvedPublications[0]?.scheduledAt;
    setDraftsForAction(scopeKey, id, contentRunId, (item) => ({ ...item, bindingIds, queueJobIds: jobIds, queueJobId: jobIds.length === 1 ? jobIds[0] : undefined, scheduledAt, status: "Scheduled", approvalState: "ready", time: `Đã được Control Plane và worker xác nhận · ${jobIds.length} target` }));
    const message = `${draft.platform} ${jobIds.length} target đã được Control Plane xác nhận; worker đang sở hữu lịch đăng.`;
    notify(message);
    return { status: "success", message };
  };
  const approveDraft = (id: number, overrideScheduledAt?: string): Promise<DraftActionOutcome> => {
    const draft = draftsRef.current.find((item) => item.id === id);
    const continueScheduleSelection = Boolean(overrideScheduledAt && (schedulePromptDraftId === id || (draft && draftActionFeedbackFor(draft).approval?.pendingReason === "selection")));
    return runScopedDraftAction(id, "approval", () => performApproveDraft(id, overrideScheduledAt), continueScheduleSelection);
  };

  const retryCreativeRun = (runId: string) => {
    const failed = automationState.creativeRuns.find((run) => run.id === runId && run.state === "failed");
    if (!failed) return;
    if (failed.mediaOwnershipReconciliation) {
      const { rollback, contentRun } = failed.mediaOwnershipReconciliation;
      setQueueNotice(`MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED · Cần đối soát ${contentRun?.id ?? failed.id} trước khi thử lại. Media còn lại: ${rollback.verified ? rollback.remainingAssetIds?.join(", ") || "không có" : "chưa xác minh"}.`);
      return;
    }
    const retry = resetCreativeRunForRetry(failed, new Date());
    setAutomationState((current) => ({ ...current, creativeRuns: [...current.creativeRuns.filter((run) => run.id !== runId), retry] }));
    setQueueNotice(`Retry queued for ${failed.topic}. Provider capability and media review gates will run again.`);
    window.setTimeout(() => { void runDueAutomationPlansRef.current(new Date(), true); }, 0);
  };

  const rejectDraft = (id: number) => {
    if (!currentMembership || !canRole(currentMembership.role, "approve_content")) {
      setQueueNotice("Role hiện tại chỉ được xem; không có quyền reject target.");
      return;
    }
    const draft = drafts.find((item) => item.id === id);
    if (draft && draftActionLocked(draft)) { setQueueNotice("Không thể reject trong lúc Quality/approval đang chạy hoặc chờ reconciliation."); return; }
    if (draft?.automationKey) { automationLedgerRef.current.release(draft.automationKey); syncLedgerState(); setAutomationState((current) => ({ ...current, creativeRuns: current.creativeRuns.map((run) => run.id === `creative-${draft.automationKey}` && run.state !== "failed" ? { ...run, state: "failed", error: "Draft rejected during review", updatedAt: new Date().toISOString() } : run) })); }
    setDrafts((current) => current.map((item) => item.id === id ? { ...item, status: "Failed", approvalState: "failed", time: "Rejected · cần chỉnh sửa" } : item));
    recordAnalyticsEvent("approval.decided", { targetPublicationId: draft?.contentRunId, decision: "rejected" });
  };

  const deleteDraft = async (id: number) => {
    if (!currentMembership || !canRole(currentMembership.role, "approve_content")) {
      setQueueNotice("Role hiện tại chỉ được xem; không có quyền xóa content.");
      return;
    }
    const draft = drafts.find((item) => item.id === id);
    if (draft && draftActionLocked(draft)) { setQueueNotice("Không thể xóa content trong lúc Quality/approval đang chạy hoặc chờ reconciliation."); return; }
    if (!draft || draft.status === "Published") {
      setQueueNotice("Chỉ có thể xóa content chưa xuất bản.");
      return;
    }
    const targetJobIds = targetJobIdsForDraft(draft, targetPublications);
    for (const jobId of targetJobIds) {
      if (!await cancelQueueJob(jobId, false)) {
        setQueueNotice("Draft vẫn còn hiển thị vì Control Plane chưa xác nhận hủy mọi target.");
        return;
      }
    }
    if (draft.automationKey) {
      automationLedgerRef.current.release(draft.automationKey);
      syncLedgerState();
    }
    const deletedAt = new Date().toISOString();
    setDrafts((current) => current.map((item) => item.id === id ? { ...item, deletedAt, approvalState: "failed", time: "Đã chuyển vào mục Đã xóa" } : item));
    recordAnalyticsEvent("content.deleted", { contentRunId: draft.contentRunId ?? `content-${draft.id}`, recoverable: true });
    setQueueNotice(`Đã chuyển “${draft.title}” vào mục Đã xóa. Bản nháp vẫn có thể khôi phục trong Cài đặt.`);
  };

  const runDashboardContentAction = (action: ContentAction, draft: Draft) => {
    setDashboardContentMenuId(undefined);
    if (action === "approve") return void approveDraft(draft.id);
    if (action === "regenerate_copy") return void regenerateDraft(draft.id);
    if (action === "delete") return void deleteDraft(draft.id);
    if (action === "publish_now") return void publishDraft(draft.id);
    if (action === "reschedule") return requestDraftTargetAction(draft, "reschedule");
    if (action === "cancel_schedule") return requestDraftTargetAction(draft, "cancel");
    setQueueNotice(`${contentActionLabel(action)} chưa khả dụng: queue job chưa được ghi nhận.`);
  };
  const closeDashboardContentMenu = (draftId: number) => {
    setDashboardContentMenuId(undefined);
    window.requestAnimationFrame(() => dashboardMenuTriggerRefs.current.get(draftId)?.focus());
  };

  const ensureAutomationGenerationProfile = async (plan: AutomationPlan): Promise<string | undefined> => {
    if (!controlPlaneClient || automationAIResolution.provider === "mock" || !automationAIResolution.available || automationAIResolution.mode === "manual_assisted") return undefined;
    const mode = automationAIResolution.mode === "web_subscription" ? "subscription_package" as const : "llm_provider" as const;
    const provider = mode === "subscription_package" ? automationAIResolution.provider === "gemini" ? "gemini_web" : "chatgpt_web" : automationAIResolution.provider === "gemini" ? "google_gemini_api" : "openai_official";
    const generationProfileId = plan.generationProfileId ?? `profile-${activeBrandRecord.id}-${mode}-${provider}-${automationAIResolution.model ?? "default"}`;
    const profiles = await controlPlaneClient.listAgencyRecords("generation-profiles", { brandId: plan.brandId });
    const secretProvider = automationAIResolution.provider === "gemini" ? "google_gemini_api" : "openai_official";
    if (!profiles.some((profile) => profile.id === generationProfileId)) {
      await controlPlaneClient.createAgencyRecord("generation-profiles", { id: generationProfileId, brandId: plan.brandId, mode, provider, model: automationAIResolution.model ?? "default", capabilities: ["copy", "image", "video"], status: "connected", ...(mode === "llm_provider" ? { secretRef: profileSecretRef(profileId, `providers/${activeWorkspaceRecord.id}/${secretProvider}`) } : {}) });
    }
    setWorkspaceState((current) => ({ ...current, generationProfiles: [...(current.generationProfiles ?? []).filter((profile) => profile.id !== generationProfileId), { id: generationProfileId, brandId: plan.brandId, mode, provider, model: automationAIResolution.model ?? "default", capabilities: ["copy", "image", "video"], status: "connected", ...(mode === "llm_provider" ? { secretRef: profileSecretRef(profileId, `providers/${activeWorkspaceRecord.id}/${secretProvider}`) } : {}) }] }));
    return generationProfileId;
  };

  const saveAutomationPlan = async (plan: AutomationPlan, token: AutomationPlannerSaveToken): Promise<AutomationPlannerSaveResult> => {
    const isCurrentRequest = () => automationPlannerRequestIdsRef.current.get(token.draftKey) === token.requestId;
    const isCurrentScope = () => isCurrentRequest() && automationPlannerSurfaceRef.current.generation === token.scopeGeneration;
    const fail = (message: string): AutomationPlannerSaveResult => {
      const currentScope = isCurrentScope();
      if (currentScope) setQueueNotice(message);
      return { error: message, currentScope };
    };
    try {
      if (!isCurrentRequest()) return { error: "Planner save request is no longer current.", currentScope: false };
      if (!currentMembership || !canRole(currentMembership.role, "schedule_content")) return fail("Role hiện tại chỉ được xem; không có quyền sửa automation plan.");
      const scopedPlan = canonicalizeAutomationPlanScope(plan, activeBrandRecord);
      const validation = validateAutomationPlan(scopedPlan, activeStrategyCatalog);
      if (!validation.ok) return fail(validation.errors[0] ?? "Automation plan needs attention before saving.");
      if (scopedPlan.status === "active" && (!scopedPlan.generationProfileId || !automationAIResolution.available)) {
        return fail(!automationAIResolution.available ? "Automation activation blocked: choose and verify one explicit GenerationProfile." : "Automation activation blocked: a GenerationProfile is required.");
      }
      if (scopedPlan.status === "active" && !controlPlaneClient) return fail("Activation requires the Control Plane; the plan remains an unsaved draft.");
      let persistedProfileId: string | undefined;
      try { persistedProfileId = scopedPlan.status === "active" ? await ensureAutomationGenerationProfile(scopedPlan) : scopedPlan.generationProfileId; }
      catch (error) { return fail(error instanceof Error ? `GenerationProfile could not be persisted: ${error.message}` : "GenerationProfile could not be persisted."); }
      const planWithProfile = persistedProfileId && persistedProfileId !== scopedPlan.generationProfileId ? { ...scopedPlan, generationProfileId: persistedProfileId } : scopedPlan;
      if (controlPlaneClient) {
        try {
          if (planWithProfile.status === "active") {
            const decision = await controlPlaneClient.validateAutomationPlanActivation({ brandId: planWithProfile.brandId, generationProfileId: planWithProfile.generationProfileId, bindingIds: planWithProfile.bindingIds ?? [], appOpen: true });
            if (decision.ok !== true) return fail(`Automation activation blocked by Control Plane: ${String(decision.code ?? "ROUTE_NOT_READY")}`);
          }
          const storedPlans = await controlPlaneClient.listAgencyRecords("automation-plans", { brandId: planWithProfile.brandId });
          const planPayload = { id: planWithProfile.id, brandId: planWithProfile.brandId, state: planWithProfile.status, generationProfileId: planWithProfile.generationProfileId, bindingIds: planWithProfile.bindingIds ?? [], payload: planWithProfile };
          if (storedPlans.some((candidate) => candidate.id === planWithProfile.id)) await controlPlaneClient.updateAgencyEntity("automation-plans", planWithProfile.id, planPayload);
          else await controlPlaneClient.createAgencyRecord("automation-plans", planPayload);
        } catch (error) { return fail(error instanceof Error ? `Control Plane could not persist this automation plan: ${error.message}` : "Control Plane could not persist this automation plan."); }
      }
      setAutomationPlans((current) => upsertAutomationPlan(current, planWithProfile));
      setAutomationState((current) => ({ ...current, brandPlans: current.brandPlans.filter((item) => item.id !== planWithProfile.id) }));
      const latestRequestId = automationPlannerRequestIdsRef.current.get(token.draftKey);
      const nextDrafts = acknowledgeAutomationPlannerDraft(automationPlannerDraftsRef.current, token, latestRequestId, planWithProfile);
      if (nextDrafts !== automationPlannerDraftsRef.current) {
        automationPlannerDraftsRef.current = nextDrafts;
        setAutomationPlannerDrafts(nextDrafts);
      }
      const currentScope = isCurrentScope();
      if (currentScope) setQueueNotice(controlPlaneClient
        ? planWithProfile.status === "active" ? "Automation plan activated. Due runs create Needs review drafts only; approval is still required." : "Automation plan saved as draft."
        : "Automation plan saved locally as a draft; Control Plane persistence is unavailable.");
      return { plan: planWithProfile, currentScope };
    } finally {
      finishAutomationPlannerSave(automationPlannerRequestIdsRef.current, automationPlannerInFlightRef.current, token.draftKey, token.requestId);
    }
  };

  async function executeDueAutomationPlans(now = new Date(), _allowOfficialAI = false, forceReviewOnly = false, runScope?: AutomationPlanRunScope) {
    const duePlans = selectAutomationPlansForRun(automationPlans.filter((plan) => automationPlanMatchesBrandScope(plan, activeBrandRecord)).map((plan) => canonicalizeAutomationPlanScope(plan, activeBrandRecord)), now, forceReviewOnly, activeStrategyCatalog, runScope);
    if (duePlans.length === 0) {
      if (forceReviewOnly) setQueueNotice("Review-only run blocked: no active valid Page-targeted plan is available.");
      return;
    }
    const brandKit = getBrandKitStatus(activeBrandRecord.status, brandVoice, activeBrandRecord.brandKitLinked);
    if (!brandKit.ready) {
      setQueueNotice(`Automation plan blocked: ${brandKit.missing.join(" · ")}. Complete the Brand Kit before generation.`);
      return;
    }
    if (!activeBrandIdentity || activeBrandIdentity.status !== "active" || !validateBrandIdentity(activeBrandIdentity).ok) {
      setQueueNotice("Automation plan blocked: active Brand Identity version is missing or incomplete.");
      return;
    }
    const createdDrafts: Draft[] = [];
    const attemptedPlanIds = duePlans.map((plan) => plan.id);
    setAutomationPlans((current) => current.map((plan) => attemptedPlanIds.includes(plan.id) ? markAutomationPlanAttempted(plan, now) : plan));
    for (const plan of duePlans) {
      try {
        const validation = validateAutomationPlan(plan, activeStrategyCatalog);
        if (!validation.ok) {
          setQueueNotice(`Automation plan ${plan.id} blocked: ${validation.errors[0] ?? "validation failed"}`);
          continue;
        }
        if (!activeStrategyCatalog) {
          setQueueNotice(`Automation plan ${plan.id} blocked: STRATEGY_CATALOG_REQUIRED`);
          continue;
        }
        const storedScheduleTemplate = workspaceState.scheduleTemplatesByBrand?.[strategyCatalogScopeKey(clientIdForBrand(activeBrandRecord), activeBrandRecord.id)];
        const scheduleTemplate = plan.scheduleTemplate ?? (storedScheduleTemplate ? { id: storedScheduleTemplate.id, campaignId: plan.campaignId ?? plan.id, brandId: storedScheduleTemplate.brandId, timezone: storedScheduleTemplate.timezone, timesByWeekday: storedScheduleTemplate.timesByWeekday, version: storedScheduleTemplate.version, source: "brand_default" as const } : undefined);
        if (!scheduleTemplate) {
          setQueueNotice(`Automation plan ${plan.id} blocked: SCHEDULE_TEMPLATE_REQUIRED`);
          continue;
        }
        const strategyPreview = buildResolvedAutomationSlots({ plan, catalog: activeStrategyCatalog, scheduleTemplate });
        if (!strategyPreview.ok) {
          setQueueNotice(`Automation plan ${plan.id} blocked: ${strategyPreview.errors[0] ?? "strategy preview failed"}`);
          continue;
        }
        if (controlPlaneClient) {
          try {
            await controlPlaneClient.createAgencyRecord("automation-runs", { id: `run-${plan.id}-${automationPlanDueKey(plan, now)}`, planId: plan.id, trigger: forceReviewOnly ? "manual" : "scheduled", runDate: now.toISOString().slice(0, 10), ...(forceReviewOnly ? { reviewOnly: true } : {}) });
          } catch (error) {
            if (!(error instanceof ControlPlaneError && /CONFLICT|already|duplicate/i.test(error.code))) {
              setQueueNotice(error instanceof Error ? error.message : "Control Plane blocked the automation run.");
              continue;
            }
          }
        }
        let gateway: MockAIGateway | ManualAssistAIGateway | OfficialAIGateway | GeminiWebAIGateway | ChatGPTWebAIGateway;
        const resolvedAutomationAI = automationAIResolution;
        const identityVersionId = activeBrandIdentity?.id ?? `identity-${activeBrandRecord.id}-v1`;
        if (!resolvedAutomationAI.available) throw new Error(`AUTOMATION_AI_UNAVAILABLE: ${resolvedAutomationAI.reason}`);
        const gatewayMode = resolvedAutomationAI.mode;
        const routedProvider = resolvedAutomationAI.provider;
        if (gatewayMode === "manual_assisted") gateway = new ManualAssistAIGateway();
        else if (gatewayMode === "web_subscription") gateway = routedProvider === "openai" ? new ChatGPTWebAIGateway({ model: resolvedAutomationAI.model ?? aiAccounts.openai.model }) : new GeminiWebAIGateway({ model: resolvedAutomationAI.model ?? aiAccounts.gemini.model });
        else if (gatewayMode === "mock") gateway = new MockAIGateway();
        else {
          if (routedProvider === "mock") throw new Error("AUTOMATION_AI_UNAVAILABLE: Official API requires an explicit configured provider.");
          const apiKey = await readAIProviderKey(activeWorkspaceRecord.id, routedProvider);
          if (!apiKey) throw new Error(`No ${routedProvider === "openai" ? "OpenAI" : "Gemini"} API key is configured in the .env credential file.`);
          gateway = new OfficialAIGateway({ provider: routedProvider, apiKey, model: resolvedAutomationAI.model ?? aiAccounts[routedProvider].model });
        }
        const brandSystem: BrandSystem = {
          workspaceId: plan.workspaceId,
          voice: brandVoice,
          audience: `Audience defined by the ${activeBrandRecord.name} brand system.`,
          prohibitedClaims: ["guaranteed returns", "get rich quick", "personalized financial advice"],
          visualTokens: brandVisualTokens,
        };
        const selectionPool = canonicalMedia.filter((asset) => asset.clientId === activeClientId && asset.brandId === plan.brandId);
        const discoveredPageIds = new Set(metaAccountHints.filter((account) => account.kind === "page").map((account) => account.id));
        const targetPageIds = resolveAutomationTargetPageIdsFromBindings(plan).filter((pageId) => discoveredPageIds.has(pageId));
        if (targetPageIds.length === 0) {
          setQueueNotice(`Automation plan ${plan.id} blocked: discover and select a valid Facebook Page before the daily run.`);
          continue;
        }
        for (const targetPageId of targetPageIds) {
          for (const platform of AUTOMATION_PLATFORMS) {
            const bindingId = plan.bindingIds?.find((candidate) => candidate.endsWith(targetPageId)) ?? `binding-${activeBrandRecord.id}-facebook-${targetPageId}`;
            const bindingSchedule = plan.bindingSchedules?.[bindingId];
            const platformPlan = platform === "facebook" && bindingSchedule?.mode === "independent"
              ? { enabled: true, postsPerDay: bindingSchedule.postsPerDay, imageCount: bindingSchedule.imageCount, videoCount: bindingSchedule.videoCount, publishTimes: bindingSchedule.publishTimes, runDays: bindingSchedule.runDays, formatMode: bindingSchedule.formatMode, formatMix: bindingSchedule.formatMix }
              : getAutomationPlatformPlanForPage(plan, targetPageId, platform);
            if (!platformPlan.enabled) continue;
            if (!(platformPlan.runDays ?? AUTOMATION_RUN_DAYS).includes(automationRunDayInTimezone(now, plan.cron.timezone))) continue;
            for (const spec of expandAutomationPlatformPlan(platform, platformPlan, plan)) {
              const automationKey = `${automationDraftKey(plan, now, platform, spec.postIndex)}:${targetPageId}`;
              if (automationDraftKeyExists(drafts, automationKey) || automationDraftKeyExists(createdDrafts, automationKey) || automationDraftKeyExists(automationState.creativeRuns.filter((run) => run.state !== "failed"), automationKey)) continue;
              const scheduledAt = nextScheduledAtForRunDays(now, spec.publishTime, plan.cron.timezone, platformPlan.runDays ?? AUTOMATION_RUN_DAYS);
              if (!isAutomationPlanWithinCampaignWindow(plan, scheduledAt)) {
                setQueueNotice(`Automation blocked ${platform} ${spec.publishTime}: next slot is outside the campaign window.`);
                continue;
              }
              const resolvedSlot = strategyPreview.slots.find((slot) => slot.platform === platform && slot.mediaKind === spec.mediaKind && slot.targetPageId === targetPageId && slot.scheduledAt === scheduledAt.toISOString())
                ?? strategyPreview.slots.find((slot) => slot.platform === platform && slot.mediaKind === spec.mediaKind && slot.targetPageId === targetPageId);
              if (!resolvedSlot) {
                setQueueNotice(`Automation blocked ${platform} ${spec.publishTime}: resolved strategy slot is missing.`);
                continue;
              }
              const resolvedGeneration = prepareStrategyGeneration({ catalog: activeStrategyCatalog, channel: platform, format: spec.mediaKind, selection: { objective: resolvedSlot.objectiveKey, pillar: resolvedSlot.pillarId, angle: resolvedSlot.angleIdByChannel[platform] ?? "mix" }, slotIndex: spec.postIndex });
              if (!resolvedGeneration.ok) {
                setQueueNotice(`Automation blocked ${platform} ${spec.publishTime}: ${resolvedGeneration.code}`);
                continue;
              }
              let resolvedStrategy = resolvedGeneration.strategy;
              let strategySnapshot = strategySnapshotFromResolved(resolvedStrategy as unknown as Record<string, unknown>, spec.mediaKind, undefined);
              const strategyGatewayAttempts = { value: 0 };
              const strategyGateway: AIGateway = {
                generate: (request) => runStrategyGenerationWithRetry({ contentRunId: creativeRun.id, strategy: resolvedStrategy, format: spec.mediaKind, attemptCounter: strategyGatewayAttempts, generate: () => gateway.generate(request), validate: (result) => result.variants.map((candidate) => validateGeneratedStrategyOutput({ format: spec.mediaKind, expected: resolvedStrategy, output: extractGeneratedContentFields(candidate) })).find((check) => !check.ok) ?? { ok: true } }),
              };
              let asset: MediaInventoryRecord | undefined;
              const mediaAssetIds: string[] = [];
              let resolvedAsset: MediaInventoryRecord | undefined;
              let draftMediaUrl: string | undefined;
              const creativeRunId = `creative-${automationKey}`;
              const automationGenerationKey = generationIdempotencyKey({ contentRunId: creativeRunId, strategyVersion: resolvedStrategy.strategyVersion, format: spec.mediaKind });
              let creativeRun = createCreativeRun({ id: creativeRunId, brandId: plan.brandId, topic: `${activeBrandRecord.name} · ${platform} · ${spec.publishTime}`, imageProvider, videoProvider, platform, targetPageId, automationKey, strategySnapshot, strategyVersion: resolvedStrategy.strategyVersion, generationIdempotencyKey: automationGenerationKey, now });
              let result: Awaited<ReturnType<MockAIGateway["generate"]>>;
              let automationRecipeId: string | undefined;
              let automationLineage: ContentIntelligenceLineage | undefined;
              let automationPrompt = "";
              let automationMediaFingerprint: string | undefined;
              let automationMediaEvidence: ContentRunMediaEvidence[] = [];
              let pendingAutomationRunPersisted = false;
              try {
                const identityContext = activeBrandIdentity ? buildGenerationContext(activeBrandIdentity, { platform, targetName: targetPageId }, `${activeBrandRecord.name} automation run at ${spec.publishTime}`) : undefined;
                if (!identityContext) throw new Error("BRAND_IDENTITY_REQUIRED");
                const automationRecipe = contentRecipes.find((recipe) => recipe.brandId === activeBrandRecord.id && recipe.status === "active" && recipe.platforms.includes(platform) && recipe.contentKinds.includes(spec.contentKind));
                automationRecipeId = automationRecipe?.id;
                if (!automationRecipe || !validateContentRecipeForStrategy(automationRecipe, resolvedStrategy).ok) throw new Error("RECIPE_STRATEGY_MISMATCH");
                strategySnapshot = strategySnapshotFromResolved(resolvedStrategy as unknown as Record<string, unknown>, spec.mediaKind, automationRecipe.id);
                resolvedStrategy = { ...resolvedStrategy, recipeId: automationRecipe.id, strategySnapshot };
                const automationBlueprint = promptBlueprints.find((candidate) => candidate.brandId === activeBrandRecord.id && candidate.status === "active");
                if (!automationBlueprint) throw new Error("CONTENT_INTELLIGENCE_LINEAGE_REQUIRED");
                const approvedKnowledgeItems = knowledgeItems.filter((item) => item.clientId === activeClientId && item.brandId === activeBrandRecord.id && item.reviewState === "approved" && item.archiveState !== "archived").slice(0, 3);
                const approvedKnowledgeItemIds = approvedKnowledgeItems.map((item) => item.id);
                const approvedKnowledgeContext = approvedKnowledgeItems.map((item) => `${item.title}: ${item.text}`).join("\n");
                const idea = deriveAutomationTopic({ brandName: activeBrandRecord.name, platform, identityContext: approvedKnowledgeItems.length ? "" : identityContext.context, intelligenceContext: approvedKnowledgeItems.length ? approvedKnowledgeContext : "", recipe: automationRecipe, existingTopics: scopedDrafts.map((draft) => draft.title).filter(Boolean).slice(0, 30) });
                if (!idea) throw new Error("AUTOMATION_TOPIC_REQUIRED");
                creativeRun = { ...creativeRun, topic: idea, idea, ideaProvider: "local_strategy_context", ideaModel: undefined };
                setAutomationState((current) => ({ ...current, creativeRuns: [...current.creativeRuns.filter((run) => run.id !== creativeRun.id), creativeRun] }));
                asset = selectAutomationMediaForPost(plan, selectionPool, { clientId: activeClientId, brandId: plan.brandId, campaignId: "", topic: idea, platform, kind: spec.mediaKind }, automationLedgerRef.current);
                if (asset && !automationLedgerRef.current.reserve({ assetId: asset.id, reservationKey: automationKey, channel: platform, dayKey: automationPlanDueKey(plan, now) })) throw new Error(`RESERVATION_CONFLICT:${asset.name}`);
                if (asset) { mediaAssetIds.push(asset.id); resolvedAsset = asset; draftMediaUrl = asset.normalizedUrl; creativeRun = { ...creativeRun, mediaAssetId: asset.id, mediaProvenance: asset.provenance }; }
                creativeRun = transitionCreativeRun(creativeRun, "media_selected", now);
                setAutomationState((current) => ({ ...current, creativeRuns: [...current.creativeRuns.filter((run) => run.id !== creativeRun.id), creativeRun] }));
                const copyAsset = resolvedAsset;
                if (copyAsset && ((gatewayMode !== "web_subscription" && gatewayMode !== "mock" && gatewayMode !== "manual_assisted") || !copyAsset.localAssetPath)) throw new Error("MEDIA_ATTACHMENT_PROVIDER_UNSUPPORTED");
                const safeIdea = sanitizeAutomationIdea(creativeRun.idea) ?? "a brand-safe concept";
                const copyPrompt = buildAutomationCopyPrompt({ brandName: activeBrandRecord.name, platform, idea: safeIdea, mediaAssetId: mediaAssetIds[0] ?? automationKey, mediaName: copyAsset?.name ?? `${spec.mediaKind} asset pending` });
                const mediaSetFingerprint = copyAsset ? await automationMediaSetFingerprint(copyAsset) : undefined;
                if (copyAsset && !mediaSetFingerprint) throw new Error("MEDIA_SET_FINGERPRINT_REQUIRED");
                const copyAttachment: MediaAttachment | undefined = copyAsset ? { assetId: mediaAssetIds[0]!, localAssetPath: copyAsset.localAssetPath!, mimeType: copyAsset.mimeType, sha256: copyAsset.sha256, order: 0, role: "publish" } : undefined;
                const copyRequest = spec.mediaKind === "video" && copyAsset
                  ? buildVideoAwareCopyRequest({ workspaceId: plan.workspaceId, prompt: copyPrompt.prompt, videoAssetId: copyAttachment!.assetId, videoLocalAssetPath: copyAttachment!.localAssetPath, videoMimeType: copyAttachment!.mimeType, videoSha256: copyAttachment!.sha256, targetPlatforms: [platform], brandVoice })
                  : gatewayMode === "web_subscription" && copyAttachment
                    ? buildMediaAwareCopyRequest({ workspaceId: plan.workspaceId, prompt: copyPrompt.prompt, attachments: [copyAttachment], targetPlatforms: [platform], brandVoice })
                    : { workspaceId: plan.workspaceId, prompt: copyPrompt.prompt, targetPlatforms: [platform], contentKinds: [spec.contentKind], brandSystem, modelPreference: "balanced" as const, metadata: { mediaAssetIds, videoMediaDeferred: false } };
                const generationKey = automationGenerationKey;
                const customerFacts = [`Automation plan: ${plan.id}`, `Slot: ${resolvedSlot.id}`, `Topic: ${safeIdea}`];
                const mediaEvidence: ContentRunMediaEvidence[] = copyAsset ? [{ assetId: mediaAssetIds[0]!, sha256: copyAsset.sha256!, mimeType: copyAsset.mimeType, order: 0, role: "publish", uploadState: "processed", attachmentBoundary: spec.mediaKind === "video" || gatewayMode !== "web_subscription" ? "publish_media" : "chat_upload" }] : [];
                automationMediaFingerprint = mediaSetFingerprint;
                automationMediaEvidence = mediaEvidence;
                const dispatch = await dispatchContentIntelligenceRun({
                  runId: creativeRun.id,
                  identityVersionId: identityContext.identityVersionId,
                  userBrief: safeIdea,
                  selectedKnowledgeItemIds: approvedKnowledgeItemIds,
                  selectedResearchEvidenceIds: [],
                  knowledgeItems,
                  researchEvidence,
                  promptBlueprints: [automationBlueprint],
                  selectedPromptBlueprintId: automationBlueprint.id,
                  contentRecipes: [automationRecipe],
                  selectedRecipeId: automationRecipe.id,
                  clientId: activeClientId,
                  brandId: activeBrandRecord.id,
                  transformMode: "original",
                  mediaSetFingerprint,
                  mediaEvidence,
                  customerFacts,
                  promptBuilder: (context) => compileStrategyPrompt({ brandName: activeBrandRecord.name, brandVoice, channel: platform, format: spec.mediaKind, strategy: resolvedStrategy, recipe: automationRecipe, identityContext: identityContext.context, intelligenceContext: context, brief: copyPrompt.prompt, existingTopics: scopedDrafts.map((draft) => draft.title).filter(Boolean).slice(0, 30), customerMedia: spec.mediaKind === "image" && copyAsset ? [{ assetId: mediaAssetIds[0]!, mimeType: copyAsset.mimeType, order: 0, role: "publish", sha256: copyAsset.sha256 }] : undefined }),
                  request: { ...copyRequest, brandSystem, contentKinds: [spec.contentKind], metadata: { ...copyRequest.metadata, idea: safeIdea, mediaAssetId: mediaAssetIds[0], mediaProvenance: copyAsset?.provenance, contentIntelligenceLineage: automationLineage, structuredOutput: true, assetFormat: spec.mediaKind, resolvedStrategy, strategySnapshot, strategyVersion: resolvedStrategy.strategyVersion, catalogFingerprint: resolvedStrategy.catalogFingerprint, idempotencyKey: generationKey } },
                  gateway: strategyGateway,
                  gatewayRequestCount: () => strategyGatewayAttempts.value,
                  ...(controlPlaneClient ? { transport: { getContentRun: (id: string) => controlPlaneClient.getContentRun(id), createContentRun: (payload: Record<string, unknown>) => controlPlaneClient.createAgencyRecord("content-runs", payload), updateContentRun: (id: string, payload: Record<string, unknown>) => controlPlaneClient.updateAgencyEntity("content-runs", id, payload) } } : {}),
                  createPayload: { clientId: activeClientId, brandId: plan.brandId, identityVersionId: identityContext.identityVersionId, ...(plan.generationProfileId ? { generationProfileId: plan.generationProfileId } : {}), executionMode: gatewayMode === "web_subscription" ? "subscription_package" : "llm_provider", providerTraceId: "pending", trigger: "automation", planId: plan.id, targetPageId, targetPlatforms: [platform], targetBindingIds: [bindingId], bindingIds: [bindingId], topic: safeIdea, contentPillar: resolvedStrategy.pillarLabel, contentAngle: resolvedStrategy.angleLabel, objective: resolvedStrategy.objectiveLabel, strategyVersion: resolvedStrategy.strategyVersion, catalogFingerprint: resolvedStrategy.catalogFingerprint, strategySnapshot, strategyState: "clean", regenerationState: "clean", mediaAssetIds, mediaEvidence, qualityStatus: "pending", approvalState: "pending", state: "needs_review", variants: [] },
                  ...(controlPlaneClient && copyAsset && copyAttachment ? { mediaOwnership: { attachments: [copyAttachment], assets: [copyAsset], scope: { clientId: activeClientId, brandId: plan.brandId }, transport: { listMediaAssets: (requestedScope: { clientId: string; brandId: string }) => controlPlaneClient.listAgencyRecords("media-assets", requestedScope), createMediaAsset: (payload: Record<string, unknown>) => controlPlaneClient.createAgencyRecord("media-assets", payload), compensateMediaAsset: (assetId, receipt) => controlPlaneClient.compensateMediaAsset(assetId, receipt) } } } : {}),
                  onCreatePersisted: () => { pendingAutomationRunPersisted = true; },
                  onLineageCaptured: (lineage) => { automationLineage = lineage; },
                  beforeGenerate: async () => { if (controlPlaneClient && plan.generationProfileId) await controlPlaneClient.markContentRunProviderAttempt(creativeRun.id); },
                });
                if (!dispatch.ok) throw new Error(dispatch.issues.map((issue) => `${issue.id}: ${issue.message}`).join(" "));
                automationLineage = dispatch.lineage;
                automationPrompt = dispatch.prompt;
                result = dispatch.result;
                if (!result.variants[0]) throw new Error("AI_PROVIDER_ECHO_RESPONSE");
                if (isUnusableProviderEcho(result.variants[0], dispatch.prompt)) throw new Error("AI_PROVIDER_ECHO_RESPONSE");
                creativeRun = transitionCreativeRun(transitionCreativeRun(creativeRun, "content_generated", now), "needs_review", now);
                const copyVariant = result.variants[0];
                creativeRun = { ...creativeRun, copyProvider: result.provider, copyModel: routedProvider === "gemini" || routedProvider === "openai" ? resolvedAutomationAI.model ?? aiAccounts[routedProvider].model : undefined, copyResult: { traceId: result.traceId, provider: result.provider, imageAware: true, title: copyVariant?.title, body: copyVariant?.body } };
                persistAutomationCheckpoint(profileId, creativeRun);
                setAutomationState((current) => ({ ...current, creativeRuns: [...current.creativeRuns.filter((run) => run.id !== creativeRun.id), creativeRun] }));
              } catch (error) {
                automationLedgerRef.current.release(automationKey);
                syncLedgerState();
                if (pendingAutomationRunPersisted && controlPlaneClient) await controlPlaneClient.updateAgencyEntity("content-runs", creativeRun.id, { generationStatus: "failed", state: "failed", rewriteError: error instanceof Error ? error.message : "CREATIVE_GENERATION_FAILED" }).catch(() => undefined);
                const failedCreativeRun = { ...creativeRun, state: "failed" as const, ...(error instanceof MediaOwnershipReconciliationError ? { mediaOwnershipReconciliation: error.reconciliation } : {}), error: safeCreativeRunError(error, creativeRun.state === "copy" ? "CREATIVE_COPY_FAILED" : "CREATIVE_GENERATION_FAILED"), updatedAt: new Date().toISOString() };
                persistAutomationCheckpoint(profileId, failedCreativeRun);
                setAutomationState((current) => ({ ...current, creativeRuns: [...current.creativeRuns.filter((run) => run.id !== creativeRun.id), failedCreativeRun] }));
                      setQueueNotice(`Automation blocked ${platform} ${spec.publishTime} · ${resolveTargetDisplayName(targetPageId, connectionDisplayNames)}: ${error instanceof Error ? error.message : "creative generation failed"}`);
                continue;
              }
              const variant = result.variants[0];
              const generated = extractGeneratedContentFields(variant);
              const initialAssetOperations: ContentOperation[] = [];
              let automationContentRun = { ...createContentRun({
                id: creativeRun.id,
                clientId: activeClientId,
                brandId: plan.brandId,
                identityVersionId,
                generationProfileId: plan.generationProfileId ?? "manual-review",
                executionMode: gatewayMode === "web_subscription" ? "subscription_package" : "llm_provider",
                providerTraceId: result.traceId,
                trigger: "automation",
                prompt: automationPrompt,
                topic: creativeRun.idea ?? `${activeBrandRecord.name} · ${platform}`,
                contentPillar: variant?.contentPillar ?? resolvedStrategy.pillarLabel,
                contentAngle: variant?.contentAngle ?? resolvedStrategy.angleLabel,
                objective: variant?.objective ?? resolvedStrategy.objectiveLabel,
                strategyVersion: variant?.strategyVersion ?? resolvedStrategy.strategyVersion,
                catalogFingerprint: resolvedStrategy.catalogFingerprint,
                strategySnapshot: variant?.strategySnapshot ?? strategySnapshot,
                mediaSetFingerprint: automationMediaFingerprint,
                mediaEvidence: automationMediaEvidence,
                ...(automationLineage ? contentIntelligenceLineageFields(automationLineage) : {}),
                caption: variant?.body ?? "",
                body: variant?.body ?? "",
                cta: "Lưu lại để xem sau",
                hashtags: variant?.hashtags ?? [],
                seoKeywords: [],
                scheduledAt: scheduledAt.toISOString(),
                sources: [],
                notes: `Automation plan ${plan.id} · binding ${bindingId}`,
                targetPlatforms: [platform],
                targetBindingIds: [bindingId],
                bindingIds: [bindingId],
                trace: { generationIdempotencyKey: automationGenerationKey, assetFormat: spec.mediaKind, strategySnapshot },
                visualOperations: initialAssetOperations,
                mediaOperations: initialAssetOperations,
                qualityStatus: "pending",
                approvalState: "pending",
                recipeId: automationRecipeId,
                variants: [{ id: `variant-${creativeRun.id}`, platform, kind: spec.contentKind, title: variant?.title, body: variant?.body ?? "", caption: variant?.body ?? "", contentPillar: variant?.contentPillar ?? resolvedStrategy.pillarLabel, contentAngle: variant?.contentAngle ?? resolvedStrategy.angleLabel, objective: variant?.objective ?? resolvedStrategy.objectiveLabel, strategyVersion: variant?.strategyVersion ?? resolvedStrategy.strategyVersion, catalogFingerprint: resolvedStrategy.catalogFingerprint, strategySnapshot: variant?.strategySnapshot ?? strategySnapshot, cta: "Lưu lại để xem sau", hashtags: variant?.hashtags ?? [], seoKeywords: [], mediaAssetIds, mediaOperations: initialAssetOperations, metadata: { ...(variant?.metadata ?? {}), ...(spec.mediaKind === "image" ? { imageConcept: generated.imageConcept, imagePrompt: generated.imagePrompt } : { videoConcept: generated.videoConcept, videoPrompt: generated.videoPrompt }), strategyRationale: generated.strategyRationale, generationIdempotencyKey: automationGenerationKey, strategySnapshot: variant?.strategySnapshot ?? strategySnapshot } }],
              }), planId: plan.id };
              const assetDeadline = createAssetOperationDeadline();
              const assetPrompt = assetPromptForDraft({ mediaKind: spec.mediaKind, visualPrompt: generated.imagePrompt, videoPrompt: generated.videoPrompt }, spec.mediaKind);
              const provider = spec.mediaKind === "video" ? videoProvider : imageProvider;
              let assetOperation: CreativeAssetOperation | undefined;
              let assetOperationHistory: CreativeAssetOperation[] = [];
              let latestAssetOperationHistory: CreativeAssetOperation[] = [];
              let attemptActive = true;
              let assetStage = "asset_generation";
              let completedAssetExtra: Record<string, unknown> = resolvedAsset ? { mediaAssetIds: [...mediaAssetIds], mediaUrl: draftMediaUrl, mediaProvenance: resolvedAsset.provenance, mediaSha256: resolvedAsset.sha256, visualFingerprint: resolvedAsset.visualFingerprint } : {};
              const operationVariants = (history: readonly CreativeAssetOperation[]) => automationContentRun.variants.map((candidate) => ({ ...candidate, mediaAssetIds: [...mediaAssetIds], mediaOperations: history.map(contentOperationFromAsset), visualOperations: history.map(contentOperationFromAsset) }));
              const persistAutomaticAssetOperation = (operation: CreativeAssetOperation, history: readonly CreativeAssetOperation[], extra: Record<string, unknown>): Promise<unknown> => {
                if (!controlPlaneClient || !pendingAutomationRunPersisted) return Promise.resolve();
                const payload = buildAssetOperationPersistencePatch(operation, history, { state: "content_generated", extra: { ...automationContentRun, generationStatus: "completed", generationIdempotencyKey: automationGenerationKey, variants: operationVariants(history), planId: plan.id, targetBindingIds: [bindingId], bindingIds: [bindingId], ...extra } });
                const write = operation.status === "running" ? withAssetOperationDeadline : withAssetOperationTerminalGrace;
                return write(async () => {
                  const ack = await controlPlaneClient.updateAgencyEntity("content-runs", creativeRun.id, payload);
                  assertContentRunAssetAck(ack, creativeRun.id, operation);
                  return ack;
                }, assetDeadline.deadlineAt);
              };
              const outcome = await runAssetOperation({
                kind: spec.mediaKind,
                provider,
                slotId: resolvedSlot.id,
                strategyVersion: resolvedStrategy.strategyVersion,
                idempotencyKey: automationGenerationKey,
                history: [],
                deadlineAt: assetDeadline.deadlineAt,
                now,
                checkpoint: (operation, history) => {
                  assetOperation = operation;
                  assetOperationHistory = [...history];
                  latestAssetOperationHistory = [...history];
                  creativeRun = { ...creativeRun, generationIdempotencyKey: automationGenerationKey, assetOperation: operation };
                  persistAutomationCheckpoint(profileId, creativeRun);
                  setAutomationState((current) => ({ ...current, creativeRuns: [...current.creativeRuns.filter((run) => run.id !== creativeRun.id), creativeRun] }));
                },
                persist: persistAutomaticAssetOperation,
                validate: () => {
                  if (!controlPlaneClient || !pendingAutomationRunPersisted) return { ok: false as const, stage: "persistence", reason: "CONTENT_RUN_CHECKPOINT_REQUIRED" };
                  if (resolvedAsset) return { ok: true as const };
                  if (!assetPrompt.ok) return { ok: false as const, stage: "prompt_validation", reason: assetPrompt.code };
                  if (spec.mediaKind === "image" && imageProvider === "local_preview") return { ok: false as const, stage: "provider_readiness", reason: "IMAGE_PROVIDER_NOT_VERIFIED" };
                  if (spec.mediaKind === "video" && videoProvider !== "veo") return { ok: false as const, stage: "provider_readiness", reason: "VIDEO_PROVIDER_NOT_CONFIGURED" };
                  return { ok: true as const };
                },
                extraForOperation: (operation) => {
                  if (operation.status !== "completed") return {};
                  const historyForExtra = latestAssetOperationHistory[latestAssetOperationHistory.length - 1]?.status === "running" ? [...latestAssetOperationHistory.slice(0, -1), operation] : [...latestAssetOperationHistory, operation];
                  return { ...completedAssetExtra, mediaOperations: historyForExtra.map(contentOperationFromAsset), visualOperations: historyForExtra.map(contentOperationFromAsset), variants: operationVariants(historyForExtra) };
                },
                failureStage: (error) => /(?:NOT_VERIFIED|NOT_CONFIGURED|SESSION|THROTTLED|API_NOT)/i.test(error instanceof Error ? error.message : "") ? "provider_readiness" : assetStage,
                onSettled: (operation) => { if (operation.status !== "running") attemptActive = false; },
                execute: async () => {
                  if (resolvedAsset) return { selected: true as const };
                  if (!assetPrompt.ok) throw new Error(assetPrompt.code);
                  const assetRequest: AssetGenerationRequest = { kind: spec.mediaKind, prompt: assetPrompt.prompt, concept: (spec.mediaKind === "image" ? generated.imageConcept : generated.videoConcept) ?? "", slotId: resolvedSlot.id, strategyVersion: resolvedStrategy.strategyVersion, idempotencyKey: automationGenerationKey, workspaceId: activeClientId, deadlineAt: assetDeadline.deadlineAt };
                  const generatedResult = spec.mediaKind === "video"
                    ? await new GoogleFlowVideoProvider().generate(assetRequest)
                    : imageProvider === "google_flow" ? await new GoogleFlowImageProvider().generate(assetRequest) : await new VertexAIImageProvider().generate(assetRequest);
                  if (!attemptActive) throw new Error("ASSET_ATTEMPT_SUPERSEDED");
                  assetStage = "asset_storage";
                  const extension = spec.mediaKind === "video" ? "mp4" : generatedResult.mimeType.toLowerCase().includes("jpeg") || generatedResult.mimeType.toLowerCase().includes("jpg") ? "jpg" : "png";
                  const safeRunId = creativeRun.id.replace(/[^A-Za-z0-9_-]/g, "-");
                  const storedResult = await storeGeneratedOutput(generatedResult, creativeRun.id, platform, `generated-${safeRunId}.${extension}`);
                  if (!attemptActive) throw new Error("ASSET_ATTEMPT_SUPERSEDED");
                  const generatedAsset = createGeneratedMediaRecord({ id: `generated-${safeRunId}`, clientId: activeClientId, brandId: plan.brandId, contentRunId: creativeRun.id, topic: creativeRun.idea ?? `${activeBrandRecord.name} · ${platform} · ${spec.publishTime}`, platform, name: `${activeBrandRecord.name} · generated ${spec.mediaKind}`, localAssetPath: storedResult.localAssetPath, mimeType: storedResult.mimeType, generatedAt: storedResult.generatedAt ?? generatedResult.generatedAt, generatedSha256: storedResult.generatedSha256 ?? storedResult.sha256, visualFingerprint: storedResult.visualFingerprint, provider: spec.mediaKind === "video" ? "google_flow" : generatedResult.provider === "vertex_ai" ? "vertex_ai" : "google_flow" });
                  const generatedDuplicate = findDuplicateMedia(generatedAsset, canonicalMedia);
                  if (generatedDuplicate) throw new Error(`GENERATED_MEDIA_DUPLICATE:${generatedDuplicate.kind}:${generatedDuplicate.assetId}`);
                  setAutomationState((current) => ({ ...current, mediaAssets: [generatedAsset, ...current.mediaAssets.filter((record) => record.id !== generatedAsset.id)] }));
                  setAssets((current) => [{ ...mediaCardFromInventory(generatedAsset), status: "Needs review", size: "Generated local output · unverified" }, ...current.filter((item) => String(item.id) !== generatedAsset.id)]);
                  if (!automationLedgerRef.current.reserve({ assetId: generatedAsset.id, reservationKey: automationKey, channel: platform, dayKey: automationPlanDueKey(plan, now) })) throw new Error("GENERATED_MEDIA_RESERVATION_FAILED");
                  syncLedgerState();
                  mediaAssetIds[0] = generatedAsset.id;
                  resolvedAsset = generatedAsset;
                  draftMediaUrl = generatedAsset.normalizedUrl;
                  creativeRun = { ...creativeRun, generatedLocalAssetPath: generatedResult.localAssetPath, generatedMimeType: generatedResult.mimeType, generatedSha256: generatedResult.generatedSha256, generatedFingerprint: generatedResult.visualFingerprint, mediaAssetId: generatedAsset.id, mediaProvenance: generatedAsset.provenance };
                  completedAssetExtra = { mediaAssetIds: [...mediaAssetIds], mediaUrl: draftMediaUrl, mediaProvenance: generatedAsset.provenance, mediaSha256: generatedAsset.sha256, visualFingerprint: generatedAsset.visualFingerprint };
                  return { selected: false as const, generatedResult };
                },
                describeResult: (value) => value.selected ? { stage: "asset_selection", provider: "existing" } : { stage: assetStage, provider: value.generatedResult.provider, createdAt: value.generatedResult.generatedAt },
              });
              assetOperation = outcome.operation;
              assetOperationHistory = [...outcome.history];
              if (outcome.terminalPersistenceFailed) {
                assetOperation = { ...assetOperation, status: "failed", stage: "persistence", reason: "CONTENT_RUN_TERMINAL_PERSISTENCE_REQUIRED" };
                setQueueNotice(`Automation asset terminal persistence requires reconciliation · ${assetOperation.idempotencyKey}`);
              }
              if (assetOperation.status === "failed" && !outcome.terminalPersistenceFailed) setQueueNotice(`Automation asset failed · ${provider} · ${assetOperation.reason ?? "ASSET_PROVIDER_ERROR"}; content vẫn giữ nguyên để review/retry.`);
              if (assetOperation.status === "blocked") setQueueNotice(`Automation asset blocked · ${provider} · ${assetOperation.reason ?? "ASSET_OPERATION_BLOCKED"}`);
              automationContentRun = { ...automationContentRun, state: "needs_review", mediaOperations: assetOperationHistory.map(contentOperationFromAsset), visualOperations: assetOperationHistory.map(contentOperationFromAsset), variants: operationVariants(assetOperationHistory) };
              createdDrafts.push({
                id: Date.now() + createdDrafts.length,
                title: `${activeBrandRecord.name} · ${platform} · ${spec.publishTime}`,
                topic: automationContentRun.topic,
                platform: platform === "facebook" ? "Facebook" : platform === "tiktok" ? "TikTok" : platform === "youtube" ? "YouTube" : "Instagram",
                status: REVIEW_ONLY_DRAFT_STATUS,
                time: `Planner · ${spec.publishTime} · ${resolveTargetDisplayName(targetPageId, connectionDisplayNames)}`,
                tag: spec.mediaKind === "image" ? "Image post" : "Short video",
                tone: "Brand voice",
                color: createdDrafts.length % 2 === 0 ? "#fff5d9" : "#eef2ff",
                body: automationContentRun.body,
                contentPillar: automationContentRun.contentPillar,
                contentAngle: automationContentRun.contentAngle,
                objective: automationContentRun.objective as Draft["objective"],
                strategyVersion: automationContentRun.strategyVersion,
                strategySnapshot: automationContentRun.strategySnapshot,
                catalogFingerprint: automationContentRun.catalogFingerprint,
                regenerationState: automationContentRun.regenerationState,
                strategyState: automationContentRun.strategyState,
                imageConcept: (variant?.metadata as Record<string, unknown> | undefined)?.imageConcept as string | undefined,
                imagePrompt: (variant?.metadata as Record<string, unknown> | undefined)?.imagePrompt as string | undefined,
                videoConcept: (variant?.metadata as Record<string, unknown> | undefined)?.videoConcept as string | undefined,
                videoPrompt: (variant?.metadata as Record<string, unknown> | undefined)?.videoPrompt as string | undefined,
                visualConcept: spec.mediaKind === "video" ? generated.videoConcept : generated.imageConcept,
                visualPrompt: spec.mediaKind === "video" ? generated.videoPrompt : generated.imagePrompt,
                strategyRationale: (variant?.metadata as Record<string, unknown> | undefined)?.strategyRationale as string | undefined,
                cta: automationContentRun.cta,
                hashtags: automationContentRun.hashtags,
                seoKeywords: [],
                sources: [],
                notes: automationContentRun.notes,
                contentKind: spec.contentKind,
                mediaAssetIds,
                mediaUrl: draftMediaUrl,
                mediaOperation: assetOperation,
                mediaOperations: assetOperationHistory,
                qualityStatus: "pending",
                approvalState: "proposed",
                researchState: "NOT_SELECTED",
                researchSourceCount: 0,
                automationKey,
                planId: plan.id,
                targetPageId,
                brandId: plan.brandId,
                imageProvider,
                videoProvider: spec.mediaKind === "video" ? videoProvider : undefined,
                mediaSha256: creativeRun.generatedSha256 ?? resolvedAsset?.sha256,
                visualFingerprint: creativeRun.generatedFingerprint ?? resolvedAsset?.visualFingerprint,
                mediaProvenance: creativeRun.mediaProvenance ? { ...creativeRun.mediaProvenance } : resolvedAsset?.provenance ? { ...resolvedAsset.provenance } : undefined,
                idea: creativeRun.idea,
                ideaProvider: creativeRun.ideaProvider,
                scheduledAt: scheduledAt.toISOString(),
                contentRunId: automationContentRun.id,
                generationIdempotencyKey: automationGenerationKey,
                identityVersionId,
                generationProfileId: plan.generationProfileId,
                executionMode: automationContentRun.executionMode,
                providerTraceId: automationContentRun.providerTraceId,
                bindingIds: [bindingId],
                recipeId: automationRecipeId,
              });
            }
          }
        }
      } catch (error) {
        setQueueNotice(error instanceof Error ? `Automation plan blocked: ${error.message}` : "Automation plan AI generation failed safely.");
      }
    }
    if (createdDrafts.length > 0) setDrafts((current) => [...createdDrafts, ...current]);
  }
  async function runDueAutomationPlans(now = new Date(), allowOfficialAI = false, forceReviewOnly = false, runScope?: AutomationPlanRunScope) {
    if (plannerRunInFlightRef.current) return;
    setPlannerRunBusy(true);
    try {
      await runSingleFlight(plannerRunInFlightRef, () => executeDueAutomationPlans(now, allowOfficialAI, forceReviewOnly, runScope));
    } finally {
      setPlannerRunBusy(false);
    }
  }
  const runReviewOnlyAutomationPlan = async (runScope: AutomationPlannerDraftScope) => {
    if (!currentMembership || !canRole(currentMembership.role, "schedule_content")) { setQueueNotice("Role hiện tại chỉ được xem; không có quyền chạy planner."); return; }
    if (runScope.profileId !== profileId || runScope.clientId !== clientIdForBrand(activeBrandRecord) || runScope.brandId !== activeBrandRecord.id) { setQueueNotice("Review-only run blocked: active Brand scope changed."); return; }
    setQueueNotice("Starting one-off review-only planner run. No post will be published.");
    await runDueAutomationPlans(new Date(), true, true, runScope);
  };
  runDueAutomationPlansRef.current = runDueAutomationPlans;
  const syncDriveInventory = async () => {
    if (driveInventorySyncBusy) return;
    setDriveInventorySyncBusy(true);
    try {
      const result = await invoke<{ assets?: Array<{ providerFileId: string; name: string; mimeType: string; kind?: "image" | "video" | "unknown"; sizeBytes?: number; sizeText?: string; modifiedAt?: string; shareUrl?: string | null; normalizedUrl?: string | null }> }>("drive_inventory");
      const imported = (result.assets ?? []).map((item) => classifyDriveInventory({ providerFileId: item.providerFileId, name: item.name, mimeType: item.mimeType, kind: item.kind, sizeBytes: item.sizeBytes ?? 0, sizeText: item.sizeText, modifiedAt: item.modifiedAt ?? new Date().toISOString(), shareUrl: item.shareUrl ?? undefined, normalizedUrl: item.normalizedUrl ?? undefined }));
      const nextRecords = mergeDriveInventory(imported, canonicalMedia, { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id }).map((asset) => applyLedgerToRecord(asset, automationLedgerRef.current));
      setAutomationState((current) => ({ ...current, mediaAssets: nextRecords, reservations: automationLedgerRef.current.list() }));
      setAssets((current) => [...nextRecords.map(mediaCardFromInventory), ...current.filter((asset) => !nextRecords.some((item) => String(item.id) === String(asset.id))) ]);
      setQueueNotice(`Drive inventory synced: ${imported.length} metadata record(s). Provider IDs and provenance are stored; assets remain Needs review until URL, SHA-256 and visual fingerprint are explicitly verified.`);
    } catch (error) {
      setQueueNotice(error instanceof Error ? error.message : "Drive inventory unavailable; open the managed Drive window first.");
    } finally {
      setDriveInventorySyncBusy(false);
    }
  };
  const persistMediaRecords = (records: MediaInventoryRecord[]) => {
    const nextRecords = records.map((record) => applyLedgerToRecord(record, automationLedgerRef.current));
    setAutomationState((current) => ({ ...current, mediaAssets: nextRecords, reservations: automationLedgerRef.current.list() }));
    setAssets(nextRecords.map(mediaCardFromInventory));
  };
  const archiveAsset = (assetId: string | number) => {
    const existing = canonicalMedia.find((asset) => String(asset.id) === String(assetId));
    if (!existing) return;
    persistMediaRecords(canonicalMedia.map((asset) => String(asset.id) === String(assetId) ? archiveMediaAsset(asset) : asset));
    if (controlPlaneClient) void controlPlaneClient.archiveMediaAsset(String(assetId)).catch(() => undefined);
    setQueueNotice(`${existing.name} đã được archive/unlink khỏi SignalFlow. File provider không bị xóa.`);
  };
  const restoreAsset = (assetId: string | number) => {
    const existing = canonicalMedia.find((asset) => String(asset.id) === String(assetId));
    if (!existing || existing.archiveState !== "archived") return;
    persistMediaRecords(canonicalMedia.map((asset) => String(asset.id) === String(assetId) ? restoreMediaAsset(asset) : asset));
    if (controlPlaneClient) void controlPlaneClient.restoreMediaAsset(String(assetId)).catch(() => undefined);
    setQueueNotice(`${existing.name} đã được khôi phục khỏi archive; cần review metadata lại trước khi plan.`);
  };
  const safeDriveFilename = (name: string, fallback = "signalflow-media.bin") => {
    const extension = name.match(/\.(png|jpe?g|webp|gif|mp4|mov|webm)$/i)?.[0].toLowerCase() ?? "";
    const base = name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 150) || fallback.replace(/\.[^.]+$/, "");
    return `${base}${extension || (fallback.match(/\.[^.]+$/)?.[0] ?? ".bin")}`.slice(0, 180);
  };
  const analyzeDriveAsset = async (assetId: string | number) => {
    const existing = canonicalMedia.find((asset) => String(asset.id) === String(assetId));
    if (!existing?.providerFileId) { setQueueNotice("Drive analysis requires a discovered Drive file ID."); return; }
    if (existing.kind !== "image" && existing.kind !== "video") { setQueueNotice("Only image and video files can enter the media analysis workflow."); return; }
    try {
      const result = await invoke<unknown>("drive_download_asset", { workspaceId: activeWorkspaceRecord.id, clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id, platform: existing.platform, capturedAt: existing.modifiedAt, contentRunId: `media-${existing.id}`, providerFileId: existing.providerFileId, filename: safeDriveFilename(existing.name, existing.kind === "image" ? "signalflow-image.png" : existing.kind === "video" ? "signalflow-video.mp4" : "signalflow-media.bin"), mimeType: existing.mimeType, modifiedAt: existing.modifiedAt, publicReachabilityConfirmed: existing.publicUrlVerified === true });
      if (!driveDownloadResultSchema(result)) throw new Error("DRIVE_DOWNLOAD_RESULT_INVALID");
      const downloaded = result as DriveDownloadResult;
      const candidate: MediaInventoryRecord = { ...existing, localAssetPath: downloaded.localAssetPath, sizeBytes: downloaded.bytes, sha256: downloaded.sha256, modifiedAt: downloaded.modifiedAt, mimeType: downloaded.mimeType, hierarchy: downloaded.manifest, visualFingerprint: downloaded.visualFingerprint ?? existing.visualFingerprint, visualFingerprintSource: downloaded.visualFingerprintSource ?? existing.visualFingerprintSource, reviewStatus: "needs_review", status: "classified", duplicateStatus: "unknown", publicUrlVerified: existing.publicUrlVerified ?? false };
      const duplicate = findDuplicateMedia(candidate, canonicalMedia.filter((asset) => asset.id !== existing.id));
      const updated = duplicate ? { ...candidate, status: "duplicate" as const, duplicateStatus: "duplicate" as const, duplicateKind: duplicate.kind, duplicateReason: `${duplicate.kind} match: ${duplicate.assetId}` } : candidate;
      persistMediaRecords(canonicalMedia.map((asset) => asset.id === existing.id ? updated : asset));
      setQueueNotice(`${existing.name} downloaded into SignalFlow media storage. SHA-256 verified; visual fingerprint remains ${downloaded.visualFingerprint ? "available" : "Needs review"}.`);
    } catch (error) { setQueueNotice(error instanceof Error ? error.message : "Drive media analysis failed."); }
  };
  const analyzeLocalAsset = async (assetId: string | number) => {
    const existing = canonicalMedia.find((asset) => String(asset.id) === String(assetId));
    if (!existing?.localAssetPath) { setQueueNotice("Local analysis requires an app-owned local media path."); return; }
    if (existing.kind !== "image" && existing.kind !== "video") { setQueueNotice("Local analysis is available for image and video media only."); return; }
    try {
      const result = await invoke<unknown>("drive_analyze_local_asset", { localAssetPath: existing.localAssetPath, mimeType: existing.mimeType, modifiedAt: existing.modifiedAt });
      if (!driveLocalAnalysisResultSchema(result)) throw new Error("DRIVE_LOCAL_ANALYSIS_RESULT_INVALID");
      const analysis = result as DriveLocalAnalysisResult;
      const analyzed = applyDecodedImageAnalysis(existing, analysis);
      const reviewed = { ...analyzed, reviewStatus: analysis.visualFingerprint ? (existing.reviewStatus ?? "needs_review") : "needs_review" as const };
      const candidate: MediaInventoryRecord = { ...(existing.kind === "image" ? promoteVerifiedDecodedImage(reviewed) : reviewed), duplicateStatus: "unknown", duplicateKind: undefined, duplicateReason: undefined };
      const duplicate = findDuplicateMedia(candidate, canonicalMedia.filter((asset) => asset.id !== existing.id));
      const updated = duplicate ? { ...candidate, status: "duplicate" as const, duplicateStatus: "duplicate" as const, duplicateKind: duplicate.kind, duplicateReason: `${duplicate.kind} match: ${duplicate.assetId}` } : candidate;
      persistMediaRecords(canonicalMedia.map((asset) => asset.id === existing.id ? updated : asset));
      setQueueNotice(`${existing.name} re-analyzed locally; ${analysis.visualFingerprint ? `visual fingerprint ${analysis.visualFingerprint} (${analysis.visualFingerprintSource ?? "source missing"})` : `visual fingerprint unavailable (${analysis.analysisStatus}; ${analysis.mimeType})`}, kept ${updated.status}. No Drive download was performed.`);
    } catch (error) { setQueueNotice(error instanceof Error ? error.message : "Local media analysis failed."); }
  };
  const uploadAssetToDrive = async (assetId: string | number) => {
    const existing = canonicalMedia.find((asset) => String(asset.id) === String(assetId));
    if (!existing?.localAssetPath) { setQueueNotice("Drive upload requires an app-owned local media path."); return; }
    try {
      const result = await invoke<unknown>("drive_upload_asset", { workspaceId: activeWorkspaceRecord.id, localAssetPath: existing.localAssetPath, filename: safeDriveFilename(existing.name, existing.kind === "image" ? "signalflow-image.png" : existing.kind === "video" ? "signalflow-video.mp4" : "signalflow-media.bin") });
      if (!driveUploadResultSchema(result)) throw new Error("DRIVE_UPLOAD_RESULT_INVALID");
      const uploaded = result as DriveUploadResult;
      let hosted = uploaded;
      if (!uploaded.publicUrlVerified) {
        hosted = await invoke<DriveUploadResult>("drive_make_public", { workspaceId: activeWorkspaceRecord.id, providerFileId: uploaded.providerFileId });
      }
      const updated: MediaInventoryRecord = { ...existing, source: existing.source === "local" ? "local" : existing.source, providerFileId: hosted.providerFileId, normalizedDriveFileId: hosted.providerFileId, shareUrl: hosted.shareUrl, normalizedUrl: hosted.normalizedUrl, publicUrlVerified: hosted.publicUrlVerified, reviewStatus: "needs_review", status: "classified" };
      persistMediaRecords(canonicalMedia.map((asset) => asset.id === existing.id ? updated : asset));
      setQueueNotice(`${existing.name} uploaded to managed Google Drive. ${hosted.publicReachability === "confirmed" ? "Public link confirmed automatically." : "Public link still needs review."}`);
    } catch (error) { setQueueNotice(error instanceof Error ? error.message : "Drive upload failed."); }
  };
  const makeDriveAssetPublic = async (assetId: string | number) => {
    const existing = canonicalMedia.find((asset) => String(asset.id) === String(assetId));
    if (!existing?.providerFileId) { setQueueNotice("Public sharing requires a discovered Drive file ID."); return; }
    if (existing.kind !== "image" && existing.kind !== "video") { setQueueNotice("Only image and video files can be hosted for social publishing."); return; }
    try {
      const result = await invoke<Pick<DriveUploadResult, "providerFileId" | "shareUrl" | "normalizedUrl" | "publicUrlVerified" | "publicReachability">>("drive_make_public", { workspaceId: activeWorkspaceRecord.id, providerFileId: existing.providerFileId });
      if (result.publicUrlVerified !== true || result.publicReachability !== "confirmed") throw new Error("DRIVE_PUBLIC_CONFIRMATION_NOT_VISIBLE");
      const updated = { ...existing, providerFileId: result.providerFileId, normalizedDriveFileId: result.providerFileId, shareUrl: result.shareUrl, normalizedUrl: result.normalizedUrl, publicUrlVerified: true, reviewStatus: "needs_review" as const, status: "classified" as const };
      persistMediaRecords(canonicalMedia.map((asset) => asset.id === existing.id ? updated : asset));
      setQueueNotice(`${existing.name} is now public on Drive. Review SHA-256 and visual fingerprint before activation.`);
    } catch (error) { setQueueNotice(error instanceof Error ? error.message : "Drive public-share confirmation failed."); }
  };
  const addAsset = (input?: { name: string; kind: MediaCard["kind"]; publicUrl: string; localAssetPath?: string; checksum?: string; visualFingerprint?: string }) => {
    if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi thay đổi media."))) return;
    const submittedUrl = input?.publicUrl?.trim();
    const driveUrl = submittedUrl ? normalizeGoogleDriveMediaUrl(submittedUrl) : null;
    const publicUrl = driveUrl ?? submittedUrl;
    const urlShapeValid = Boolean(publicUrl && /^https:\/\//i.test(publicUrl) && !isNonPublicMediaHost(publicUrl));
    const kind = input?.kind ?? "Image";
    const id = `local-${Date.now()}`;
    const record: MediaInventoryRecord = { id, clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id, campaignId: "", topic: "", platform: "facebook", distribution: "universal", kind: kind === "Image" ? "image" : kind === "Video" ? "video" : "unknown", name: input?.name.trim() || `new-asset-${Date.now()}.bin`, mimeType: kind === "Image" ? "image/*" : kind === "Video" ? "video/*" : "application/octet-stream", sizeBytes: 0, modifiedAt: new Date().toISOString(), source: driveUrl ? "drive" : urlShapeValid ? "public_https" : "local", status: "classified", normalizedUrl: urlShapeValid ? publicUrl : undefined, localAssetPath: input?.localAssetPath, sha256: input?.checksum?.replace(/^sha256:/i, ""), visualFingerprint: input?.visualFingerprint, visualFingerprintSource: input?.visualFingerprint ? kind === "Image" ? "decoded_image" : "decoded_video_frames" : undefined, reviewStatus: "needs_review", duplicateStatus: "unknown", usageStatus: "available", publicUrlVerified: false, provenance: { source: driveUrl ? "google_drive" : urlShapeValid ? "public_https" : "local", providerFileId: undefined, importedAt: new Date().toISOString() } };
    setAutomationState((current) => ({ ...current, mediaAssets: [record, ...current.mediaAssets.filter((asset) => asset.id !== id)] }));
    setAssets((current) => [{ ...mediaCardFromInventory(record), status: "Needs review", size: urlShapeValid ? "Registered URL · unverified" : "Pending", checksum: input?.checksum || undefined }, ...current]);
  };
  const importLocalImage = async (file: File) => {
    if (!guardComposerMutation(composerBusy, () => setMediaImportNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi thay đổi media."))) return;
    const invalid = validateLocalImageFile(file);
    if (invalid) { setMediaImportNotice(invalid); return; }
    if (!isElectronRuntime()) { setMediaImportNotice("LOCAL_MEDIA_IMPORT_REQUIRES_ELECTRON"); return; }
    setMediaImportBusy(true);
    setMediaImportNotice("");
    try {
      const declaredMimeType = file.type.toLowerCase();
      const result = await invoke<unknown>("import_local_media", { clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id, fileName: safeLocalImageFileName(file.name, declaredMimeType), declaredMimeType, fileBytesBase64: await encodeLocalImageFile(file) });
      const imported = parseLocalImageImport(result, activeWorkspaceRecord.id, activeBrandRecord.id);
      if (!imported) throw new Error("LOCAL_MEDIA_IMPORT_RESULT_INVALID");
      const record: MediaInventoryRecord = { id: imported.assetId, clientId: imported.clientId, brandId: imported.brandId, campaignId: "", topic: "", platform: "facebook", distribution: "universal", kind: "image", name: file.name, mimeType: imported.mimeType, sizeBytes: imported.sizeBytes, modifiedAt: new Date().toISOString(), source: "local", status: "classified", localAssetPath: imported.localAssetPath, sha256: imported.sha256, reviewStatus: "needs_review", duplicateStatus: "unknown", usageStatus: "available", publicUrlVerified: false, provenance: { source: "local", importedAt: new Date().toISOString() } };
      const duplicate = findDuplicateMedia(record, activeMediaRecords);
      const savedRecord = duplicate ? { ...record, status: "duplicate" as const, duplicateStatus: "duplicate" as const, duplicateKind: duplicate.kind, duplicateReason: `${duplicate.kind} match: ${duplicate.assetId}` } : record;
      persistMediaRecords([savedRecord, ...canonicalMedia.filter((asset) => asset.id !== savedRecord.id)]);
      try {
        const ownership = await ensureContentRunMediaOwnership(controlPlaneMediaOwnershipInput([{ assetId: savedRecord.id, localAssetPath: imported.localAssetPath, mimeType: imported.mimeType, sha256: imported.sha256, order: 0, role: "publish" }], [savedRecord]));
        ownership.commit(); // This explicit import persists media independently of Content Run creation.
        setMediaImportNotice(`${file.name} đã nhập · SHA-256 và Client/Brand đã được xác minh.`);
      } catch (error) {
        setMediaImportNotice(`${file.name} đã lưu cục bộ; Control Plane chưa xác nhận quyền sở hữu: ${error instanceof Error ? error.message : "MEDIA_ASSET_SYNC_FAILED"}.`);
      }
    } catch (error) {
      setMediaImportNotice(error instanceof Error ? error.message : "LOCAL_MEDIA_IMPORT_FAILED");
    } finally {
      setMediaImportBusy(false);
    }
  };
  const verifyAsset = (assetId: string | number, input: { publicUrl: string; sha256: string; visualFingerprint: string }) => {
    const currentRecords = canonicalMedia;
    const existing = currentRecords.find((asset) => String(asset.id) === String(assetId));
    const normalizedUrl = normalizeGoogleDriveMediaUrl(input.publicUrl.trim()) ?? input.publicUrl.trim();
    const sha256 = input.sha256.trim().replace(/^sha256:/i, "").toLowerCase();
    const visualFingerprint = input.visualFingerprint.trim().toLowerCase();
    if (!existing || !/^https:\/\//i.test(normalizedUrl) || isNonPublicMediaHost(normalizedUrl) || !/^[a-f0-9]{64}$/i.test(sha256) || !/^[a-f0-9]{16}$/i.test(visualFingerprint)) { setQueueNotice("Media review blocked: valid public HTTPS URL, SHA-256 and 16-character visual fingerprint are required."); return; }
    if (existing.sha256 && existing.sha256.toLowerCase() !== sha256) { setQueueNotice("Media review blocked: SHA-256 does not match the bytes analyzed by SignalFlow."); return; }
    if (existing.visualFingerprint && existing.visualFingerprint.toLowerCase() !== visualFingerprint) { setQueueNotice("Media review blocked: visual fingerprint does not match the analyzed asset."); return; }
    const candidate: MediaInventoryRecord = { ...existing, normalizedUrl, sha256, visualFingerprint, status: "eligible", reviewStatus: "verified", duplicateStatus: "unique", publicUrlVerified: true, usageStatus: existing.usageStatus ?? "available" };
    const duplicate = findDuplicateMedia(candidate, currentRecords);
    const verified = duplicate ? { ...candidate, status: "duplicate" as const, duplicateStatus: "duplicate" as const, duplicateKind: duplicate.kind, duplicateReason: `${duplicate.kind} match: ${duplicate.assetId}` } : { ...candidate, duplicateKind: undefined, duplicateReason: undefined };
    const nextRecords = currentRecords.map((asset) => asset.id === existing.id ? verified : asset);
    setAutomationState((current) => ({ ...current, mediaAssets: nextRecords }));
    setAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, ...mediaCardFromInventory(verified) } : asset));
    setQueueNotice(duplicate ? `Media review saved: ${existing.name} is blocked as a ${duplicate.kind} duplicate of ${duplicate.assetId}.` : `Media review saved: ${existing.name} is verified for planner eligibility.`);
  };
  useEffect(() => {
    const startupRun = window.setTimeout(() => { void runDueAutomationPlansRef.current(new Date(), false); }, 0);
    return () => window.clearTimeout(startupRun);
  }, []);

  const targetActionDraft = targetActionPrompt ? drafts.find((draft) => draft.id === targetActionPrompt.draftId && draftActionScopeKey(draftActionScope(draft)) === targetActionPrompt.scopeKey) : undefined;
  const targetActionJobIds = targetActionDraft ? targetJobIdsForDraft(targetActionDraft, targetPublications).filter((jobId) => {
    if (targetActionPrompt?.action !== "publish_now") return true;
    const publication = publicationForJob(jobId);
    return Boolean(publication && !draftPublishBlocker({ id: targetActionDraft.id, clientId: activeWorkspaceRecord.id, brandId: activeBrandRecord.id, contentRunId: targetActionDraft.contentRunId, status: targetActionDraft.status, qualityStatus: targetActionDraft.qualityStatus, approvalState: targetActionDraft.approvalState, pendingPublicationIds: targetActionDraft.pendingPublicationIds }, targetPublications, publication.id));
  }) : [];
  const closeSchedulePrompt = (clearFeedback = true, returnFocus = true) => {
    if (clearFeedback && schedulePromptScopeKeyRef.current) setDraftActionFeedbackFor(schedulePromptScopeKeyRef.current, "approval", undefined);
    const closed = closeApprovalSchedulePromptState({ draftId: schedulePromptDraftId, value: schedulePromptValue });
    setSchedulePromptDraftId(closed.draftId);
    setSchedulePromptValue(closed.value);
    schedulePromptScopeKeyRef.current = "";
    if (returnFocus) window.requestAnimationFrame(() => schedulePromptOpenerRef.current?.focus());
  };
  const submitSchedulePrompt = () => {
    const draftId = schedulePromptDraftId;
    if (draftId === undefined) return;
    const currentDraft = draftsRef.current.find((draft) => draft.id === draftId);
    if (!currentDraft || draftActionScopeKey(draftActionScope(currentDraft)) !== schedulePromptScopeKeyRef.current) { closeSchedulePrompt(); setQueueNotice("Client, Brand, Profile, or Content Run changed. Reopen approval from the current draft."); return; }
    const submitted = submitApprovalSchedulePromptValue(schedulePromptValue, new Date());
    if (!submitted.ok) { setQueueNotice(submitted.message); return; }
    closeSchedulePrompt(false, false);
    void approveDraft(draftId, submitted.scheduledAt);
  };
  const closeTargetActionPrompt = (clearFeedback = true, returnFocus = true) => {
    const prompt = targetActionPrompt;
    const closed = closeTargetActionPromptOutcome(prompt, clearFeedback);
    if (closed.clearPublishFeedback && prompt) setDraftActionFeedbackFor(prompt.scopeKey, "publish", undefined);
    setTargetActionPrompt(closed.prompt);
    setTargetActionJobId(closed.jobId);
    if (returnFocus) window.requestAnimationFrame(() => {
      if (targetActionOpenerRef.current?.isConnected) targetActionOpenerRef.current.focus();
      targetActionOpenerRef.current = null;
    });
    else targetActionOpenerRef.current = null;
  };
  useEffect(() => {
    if (schedulePromptDraftId !== undefined) {
      const draft = draftsRef.current.find((item) => item.id === schedulePromptDraftId);
      if (!draft || draftActionScopeKey(draftActionScope(draft)) !== schedulePromptScopeKeyRef.current) closeSchedulePrompt();
    }
    if (targetActionPrompt && !targetActionDraft) closeTargetActionPrompt();
  }, [activeBrandRecord.id, activeWorkspaceRecord.id, draftActionFeedback, drafts, profileId, profileRevision, schedulePromptDraftId, targetActionPrompt, targetActionDraft]);
  useEffect(() => {
    if (!targetActionPrompt) return;
    const frame = window.requestAnimationFrame(() => targetActionDialogRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [targetActionPrompt?.scopeKey]);
  const confirmTargetAction = () => {
    if (!targetActionPrompt || !targetActionDraft || !targetActionJobId || !actionScopeIsCurrent(targetActionPrompt.scopeKey, targetActionPrompt.draftId, targetActionDraft.contentRunId)) return;
    const selection = targetActionSelectionOutcome(targetActionPrompt, targetActionJobId);
    const action = selection.command?.action;
    const jobId = selection.command?.jobId;
    closeTargetActionPrompt(true, false);
    if (!action || !jobId) return;
    if (action === "publish_now") void publishDraft(targetActionPrompt.draftId, jobId);
    else if (action === "cancel") void cancelQueueJob(jobId);
    else rescheduleQueueJob(jobId);
  };

  return (
    <main className="app-shell">
      <RevoNewContentModal visible={showRevoComposer} clientName={activeWorkspaceRecord.name} brandName={activeBrandRecord.name} assets={activeMediaCards} generationError={generationError} isGenerating={isGenerating} mediaImportBusy={mediaImportBusy} mediaImportNotice={mediaImportNotice} onImportLocalImage={importLocalImage} onClose={closeComposer} onSubmit={createDraft} activeClientId={activeWorkspaceRecord.id} activeBrandId={activeBrandRecord.id} openerRef={composerOpenerRef} fallbackRef={composerFallbackRef} knowledgeItems={knowledgeItems} researchEvidence={researchEvidence} promptBlueprints={promptBlueprints} contentRecipes={contentRecipes} selectedKnowledgeItemIds={selectedKnowledgeItemIds} selectedResearchEvidenceIds={selectedResearchEvidenceIds} selectedPromptBlueprintId={selectedPromptBlueprintId} selectedRecipeId={selectedRecipeId} transformMode={transformMode} />
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-symbol"><NavIcon name="studio" /></div>
          <div>
            <div className="brand-name">SignalFlow</div>
            <div className="brand-caption">Social operating system</div>
          </div>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">{activeWorkspaceRecord?.name.slice(0, 1) ?? "S"}</div>
          <div className="workspace-copy">
            <strong>{activeWorkspaceRecord?.name ?? "SignalFlow workspace"}</strong>
            <span>{activeWorkspaceRecord?.clientLabel ?? "Workspace"} · {currentMembership?.role ?? "member"}</span>
          </div>
          <select className="workspace-select" aria-label="Switch workspace" value={workspaceState.activeWorkspaceId} onChange={(event) => switchToWorkspace(event.target.value)}>
            {workspaceState.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
          <button className="icon-button" aria-label="Add client" onClick={() => { setSetupName(""); setShowClientSetup(true); }}>+</button>
        </div>
        <div className="brand-selector-row">
          <span className="nav-section-label">Active brand</span>
          <select className="brand-select" value={workspaceState.activeBrandId} onChange={(event) => switchToBrand(event.target.value)}>
            {workspaceState.brands.filter((brand) => brand.workspaceId === workspaceState.activeWorkspaceId && !brand.deletedAt && brand.status !== "archived").map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
          <button className="text-button" onClick={openBrandSetup}>+ Add brand</button>
        </div>

        <nav className="main-nav" ref={mainNavRef} aria-label="Điều hướng chính">
          {navGroups.map((group) => <div className="nav-group" key={group.label}>
            <div className="nav-section-label">{group.label}</div>
            {group.items.map((item) => <button
              className={`nav-item ${activeNav === item.id ? "active" : ""}`}
              key={item.id}
              ref={item.id === "Content studio" ? (node) => { composerFallbackRef.current = node; } : undefined}
              aria-current={activeNav === item.id ? "page" : undefined}
              onClick={() => {
                setActiveNav(item.id);
                if (item.id === "Content studio") setShowComposer(false);
                if (item.id === "Review inbox") setActiveFilter("Needs review");
              }}
            >
              <span className="nav-icon"><NavIcon name={item.icon}/></span>
              <span>{item.label}</span>
              {item.reviewBadge && <span className="nav-badge" role="status" aria-label={`${reviewDrafts.length} nội dung chờ duyệt`}>{reviewDrafts.length}</span>}
            </button>)}
          </div>)}
        </nav>

        <div className="sidebar-footer">
          <div className="plan-card">
            <div className="plan-topline"><span>Route AI</span><strong>{automationAIResolution.available && automationAIResolution.provider !== "mock" ? "Sẵn sàng" : "Bị chặn"}</strong></div>
            <div className="progress-track"><div className={automationAIResolution.available && automationAIResolution.provider !== "mock" ? "progress-value" : ""} /></div>
            <p>{automationAIResolution.reason}</p>
            <button onClick={() => setActiveNav("Settings")}>Quản lý nhà cung cấp <span>→</span></button>
          </div>
          <div className="user-row profile-switcher">
            <button type="button" className="profile-trigger" aria-haspopup="menu" aria-expanded={showProfileMenu} onClick={() => setShowProfileMenu((value) => !value)}><span className="user-avatar">{(userProfiles.find((profile) => profile.id === profileId)?.displayName ?? "BV").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><strong>{userProfiles.find((profile) => profile.id === profileId)?.displayName ?? "Bảo Vy"}</strong><small>{currentMembership?.role ?? "Chủ sở hữu"} · hồ sơ riêng</small></span><span className="more-button" aria-hidden="true">•••</span></button>
            {showProfileMenu && <div className="profile-menu" role="menu"><strong>Chuyển người dùng</strong>{userProfiles.filter((profile) => profile.status === "active").map((profile) => <button type="button" role="menuitem" className={profile.id === profileId ? "selected" : ""} key={profile.id} onClick={() => switchUserProfile(profile.id)}>{profile.displayName}{profile.id === profileId ? " · đang dùng" : ""}</button>)}<button type="button" role="menuitem" onClick={createUserProfile}>＋ Tạo người dùng mới</button></div>}
          </div>
        </div>
      </aside>

      <section className="content-area">
        <header className="topbar">
              <div className="breadcrumb"><span>{activeWorkspaceRecord?.name ?? "Workspace"}</span><b>/</b><strong>{activeBrandRecord?.name ?? "Brand"}</strong><b>/</b><strong>{navLabel(activeNav)}</strong></div>
          <div className="top-actions">
            <LiveReadinessIndicator readiness={metaLiveReadiness} />
            <button className="icon-button" aria-label="Tìm kiếm nội dung" title="Mở tìm kiếm nội dung" onClick={() => { setActiveNav("Content studio"); setContentStudioFilter("all"); }}><NavIcon name="search"/></button>
            <div className="notification-wrap">
              <button className="icon-button has-alert" aria-label="Thông báo" aria-expanded={showNotifications} onClick={() => setShowNotifications((value) => !value)}><NavIcon name="review"/></button>
              {showNotifications && <div className="notification-popover" role="status"><strong>{reviewDrafts.length} nội dung cần duyệt</strong><span>Kiểm tra preflight trước khi đưa vào lịch.</span><span>Trạng thái provider được giữ tách biệt với nội dung.</span></div>}
            </div>
            <button className="create-button" aria-label="Thêm brand" onClick={openBrandSetup}><span aria-hidden="true">+</span> Thêm brand</button>
          </div>
        </header>

        <div className="page-content" ref={pageContentRef}>
          {(queueNotice || connectionNotice) && <div className="queue-notice"><span className="online-dot" /><span>{queueNotice || connectionNotice}</span>{oauthUrl && <button className="secondary-button" onClick={() => void openConsentPage()}>Open consent page</button>}<button onClick={() => { setQueueNotice(""); setConnectionNotice(""); setOauthUrl(""); }}>×</button></div>}
          {activeNav === "Command center" ? <>
          <section className="hero-row">
            <div>
              <p className="eyebrow">LỊCH XUẤT BẢN · TUẦN NÀY</p>
              <h1>Nhịp đăng của {activeBrandRecord.name}</h1>
              <p className="hero-subtitle">Kiểm tra lịch, nội dung chờ duyệt và trạng thái xuất bản của brand đang chọn.</p>
            </div>
            <div className="hero-actions">
              <button className="secondary-button" onClick={() => setActiveNav("Calendar")}>Mở lịch đầy đủ <span>↗</span></button>
              <button className="primary-button" onClick={(event) => { event.preventDefault(); openComposer(event.currentTarget); }} disabled={composerBusy}>Tạo nội dung <span aria-hidden="true">+</span></button>
            </div>
          </section>

          <section className="metric-grid" aria-label="Workspace metrics">
            <article className="metric-card accent-blue" role="button" tabIndex={0} onClick={() => openContentStudioFilter("published")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openContentStudioFilter("published"); }}><div className="metric-icon"><NavIcon name="planner"/></div><div><span className="metric-label">Nội dung đã xuất bản</span><strong>{publishedDraftCount}</strong><span className="metric-change neutral">Control Plane provider-confirmed TargetPublications</span></div><div className="mini-bars blue-bars"><i /><i /><i /><i /><i /><i /><i /></div></article>
            <article className="metric-card accent-purple" role="button" tabIndex={0} onClick={() => setActiveNav("Analytics")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setActiveNav("Analytics"); }}><div className="metric-icon"><NavIcon name="analytics"/></div><div><span className="metric-label">Tương tác trung bình</span><strong>—</strong><span className="metric-change neutral">NOT_INSTRUMENTED · chưa có event live</span></div><div className="sparkline purple-line"><span /></div></article>
            <article className="metric-card accent-amber" role="button" tabIndex={0} onClick={() => { setActiveNav("Review inbox"); setContentStudioFilter("review"); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setActiveNav("Review inbox"); setContentStudioFilter("review"); }; }}><div className="metric-icon"><NavIcon name="review"/></div><div><span className="metric-label">Chờ duyệt</span><strong>{reviewDrafts.length}</strong><span className="metric-change neutral">Mở hộp duyệt để xử lý</span></div><div className="ring-chart"><span>{reviewDrafts.length}</span></div></article>
            <article className="metric-card accent-green" role="button" tabIndex={0} onClick={() => { setSettingsSection("bindings"); setActiveNav("Settings"); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setSettingsSection("bindings"); setActiveNav("Settings"); }; }}><div className="metric-icon"><NavIcon name="channels"/></div><div><span className="metric-label">Target đã kết nối</span><strong>{readyBindingCount}</strong><span className="metric-change neutral">Chỉ target Meta official đã discover</span></div><div className="channel-stack"><span className="facebook"><BetterPlatformIcon name="facebook" /></span></div></article>
          </section>

          <section className="dashboard-grid">
            <article className="panel calendar-panel">
              <div className="panel-heading"><div><p className="panel-kicker">KẾ HOẠCH TUẦN</p><h2>Lịch xuất bản</h2></div><button className="text-button" onClick={() => setActiveNav("Calendar")}>Mở lịch đầy đủ <span>↗</span></button></div>
              <div className="week-header"><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span></div>
              <div className="week-days">{calendarDays.map((item) => <button type="button" className={`day ${item.label ? "active" : ""} ${dashboardCalendarDate === item.date ? "selected" : ""}`} key={item.day} onClick={() => { setDashboardCalendarDate(item.date); setActiveNav("Calendar"); }}><strong>{item.day}</strong>{item.label && <span>{item.label}</span>}</button>)}</div>
              <div className="calendar-events">{displayQueueJobs.filter((job) => ["queued", "retryable_error", "preflight_failed"].includes(job.state)).slice(0, 3).map((job, index) => <div className="event-line" key={job.id}><span className="event-time">{new Date(job.scheduledAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span><button type="button" className={`event-block ${index % 2 === 0 ? "blue-event" : "purple-event"}`} onClick={() => { setDashboardCalendarDate(job.scheduledAt.slice(0, 10)); setActiveNav("Calendar"); }}><b>{job.state.replace(/_/g, " ")}</b><small>{job.variantId}</small></button><span className="event-channel">{resolveTargetDisplayName(job.bindingId ?? job.connectionId, connectionDisplayNames)}</span></div>)}{displayQueueJobs.filter((job) => ["queued", "retryable_error", "preflight_failed"].includes(job.state)).length === 0 && <div className="empty-state">Không có lịch đã queue cho Brand này.</div>}</div>
            </article>

            <article className="panel review-panel">
              <div className="panel-heading"><div><p className="panel-kicker">CẦN XỬ LÝ</p><h2>Nội dung chờ duyệt <span className="count-badge" role="status" aria-label={`${reviewDrafts.length} nội dung chờ duyệt`}>{reviewDrafts.length}</span></h2></div><span className="more-button" aria-hidden="true">•••</span></div>
              <div className="review-list">{reviewDrafts.slice(0, 3).map((draft, index) => <div className="review-item" key={draft.id}><div className={`review-art ${index === 0 ? "art-one" : index === 1 ? "art-two" : "art-three"}`}><BetterContentIcon name={contentIconName(draft)}/></div><div className="review-copy"><strong title={draft.title}>{draft.title}</strong><span><PlatformMark platform={draft.platform}/> {draft.tag}</span></div><button className="round-arrow" onClick={() => setActiveNav("Review inbox")}>→</button></div>)}{reviewDrafts.length === 0 && <div className="empty-state">Không có nội dung chờ duyệt.</div>}</div>
              <button className="full-width-button" onClick={() => setActiveNav("Review inbox")}>Mở hộp duyệt <span>→</span></button>
            </article>
          </section>

          <section className="queue-monitor-grid">
            <article className="panel queue-panel">
              <div className="panel-heading"><div><p className="panel-kicker">VẬN HÀNH XUẤT BẢN</p><h2>Hàng đợi <span className="count-badge">{operationalQueueJobs.length}</span></h2></div><button className="secondary-button queue-run-button" onClick={() => void runDueJobs()}>Chạy job đến hạn <span>↗</span></button></div>
              {operationalQueueJobs.length === 0 ? <div className="queue-empty"><span className="queue-empty-icon"><NavIcon name="calendar"/></span><strong>Chưa có job xuất bản</strong><span>Duyệt nội dung để tạo job đã qua preflight.</span></div> : <div className="queue-list">{operationalQueueJobs.map((job) => { const isRetryable = job.state === "retryable_error"; return <div className="queue-row" role="button" tabIndex={0} key={job.id} onClick={() => setSelectedQueueJob(job)} onKeyDown={(event) => { if (shouldOpenRowFromKey(event.key, event.target, event.currentTarget)) { event.preventDefault(); setSelectedQueueJob(job); } }}><div className="queue-row-main"><span className={`queue-state ${job.state}`}>{job.state.replace(/_/g, " ")}</span><strong>{resolveTargetDisplayName(job.bindingId ?? job.connectionId, connectionDisplayNames)}</strong><span>{new Date(job.scheduledAt).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></div><div className="queue-row-meta"><code>{job.idempotencyKey.slice(0, 24)}…</code>{isRetryable && !publicationByJobRef.current.has(job.id) && <button className="text-button" onClick={(event) => { event.stopPropagation(); retryQueueJob(job.id); }}>Chạy lại</button>}</div></div>; })}</div>}
            </article>
          </section>

          {selectedQueueJob && <div className="modal-backdrop queue-detail-backdrop" role="dialog" aria-modal="true" onMouseDown={() => setSelectedQueueJob(undefined)}><section className="composer-modal queue-detail-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="panel-kicker">QUEUE DETAIL</p><h2>{selectedQueueJob.variantId}</h2><span>{selectedQueueJob.state.replace(/_/g, " ")} · {new Date(selectedQueueJob.scheduledAt).toLocaleString("vi-VN")}</span></div><button className="close-button" onClick={() => setSelectedQueueJob(undefined)}>×</button></div><div className="detail-grid"><span>Job</span><strong>{selectedQueueJob.id}</strong><span>Target</span><strong>{resolveTargetDisplayName(selectedQueueJob.bindingId ?? selectedQueueJob.connectionId, connectionDisplayNames)}</strong><span>Attempts</span><strong>{selectedQueueJob.attempts}</strong><span>Provider trace</span><strong>{selectedQueueJob.providerJobId ?? "not assigned"}</strong>{selectedQueueJob.lastError && <><span>Command status</span><strong>{selectedQueueJob.lastError.code} · {selectedQueueJob.lastError.message}</strong></>}</div><div className="composer-foot"><button className="secondary-button" onClick={() => { rescheduleQueueJob(selectedQueueJob.id); setSelectedQueueJob(undefined); }}>Đổi lịch</button><button className="text-button danger-text" onClick={() => { void cancelQueueJob(selectedQueueJob.id); setSelectedQueueJob(undefined); }}>Hủy lịch</button></div></section></div>}
          {selectedDashboardDraft && (
            <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="dashboard-content-detail-title" onMouseDown={() => closeDashboardDraft()}>
              <section
                ref={dashboardDetailModalRef}
                className="composer-modal review-detail-modal"
                tabIndex={-1}
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeDashboardDraft();
                    return;
                  }
                  if (event.key !== "Tab") return;
                  const focusable = Array.from(dashboardDetailModalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], audio[controls], [tabindex]:not([tabindex="-1"])') ?? [])
                    .filter((element) => element.getAttribute("aria-hidden") !== "true");
                  const first = focusable[0];
                  const last = focusable[focusable.length - 1];
                  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
                  if (focusable.length === 0) {
                    event.preventDefault();
                    dashboardDetailModalRef.current?.focus();
                  } else if (event.shiftKey && (document.activeElement === first || activeIndex < 0)) {
                    event.preventDefault();
                    last?.focus();
                  } else if (!event.shiftKey && (document.activeElement === last || activeIndex < 0)) {
                    event.preventDefault();
                    first?.focus();
                  }
                }}
              >
                <div className="modal-heading">
                  <div><p className="panel-kicker">CONTENT DETAIL</p><h2 id="dashboard-content-detail-title">{selectedDashboardDraft.title}</h2><span>{selectedDashboardDraft.platform} · {selectedDashboardDraft.status}</span></div>
                  <button type="button" className="close-button" aria-label="Đóng chi tiết nội dung" ref={dashboardDetailCloseRef} onClick={() => closeDashboardDraft()}>×</button>
                </div>
                <div className="detail-grid">
                  <span>Quality</span><strong>{selectedDashboardDraft.qualityStatus ?? "pending"}</strong>
                  <span>Approval</span><strong>{selectedDashboardDraft.approvalState ?? "proposed"}</strong>
                  <span>Target bindings</span><strong>{selectedDashboardDraft.bindingIds?.length ? selectedDashboardDraft.bindingIds.map((id) => resolveTargetDisplayName(id, connectionDisplayNames)).join(", ") : selectedDashboardDraft.targetPageId ? resolveTargetDisplayName(selectedDashboardDraft.targetPageId, connectionDisplayNames) : "Chưa chọn target"}</strong>
                  <span>Target ID</span><strong>{selectedDashboardDraft.targetPageId ?? selectedDashboardDraft.bindingIds?.join(", ") ?? "Chưa ghi nhận"}</strong>
                  <span>Lịch đăng</span><strong>{selectedDashboardDraft.scheduledAt ? new Date(selectedDashboardDraft.scheduledAt).toLocaleString("vi-VN") : "Chưa lên lịch"}</strong>
                  <span>Provider trace</span><strong>{selectedDashboardDraft.providerTraceId ?? "Chưa ghi nhận"}</strong>
                  <span>Plan</span><strong>{selectedDashboardDraft.planId ?? "Không thuộc kế hoạch"}</strong>
                  <span>Media type</span><strong>{selectedDashboardDraft.mediaKind ?? selectedDashboardDraft.contentKind ?? "Chưa ghi nhận"}</strong>
                  <span>Media operations</span><strong>{selectedDashboardDraft.mediaOperations?.map((operation) => `${operation.kind}:${operation.status}:${operation.provider ?? "unconfigured"}`).join(" · ") ?? (selectedDashboardDraft.mediaOperation ? `${selectedDashboardDraft.mediaOperation.kind}:${selectedDashboardDraft.mediaOperation.status}:${selectedDashboardDraft.mediaOperation.provider ?? "unconfigured"}` : "Chưa ghi nhận")}</strong>
                </div>
                <article className="panel detail-copy"><strong>Caption</strong><p>{selectedDashboardDraft.body ?? "Chưa có caption"}</p><small>{selectedDashboardDraft.hashtags?.join(" ")}</small></article>
                <article className="panel detail-copy">
                  <strong>Media</strong>
                  {(selectedDashboardDraft.mediaUrl ?? selectedDashboardDraft.mediaPreviewUrl ?? selectedDashboardDraft.mediaThumbnailUrl)
                    ? selectedDashboardDraft.mediaKind === "video" || selectedDashboardDraft.contentKind === "video"
                      ? <video className="media-preview-image" src={selectedDashboardDraft.mediaUrl ?? selectedDashboardDraft.mediaPreviewUrl ?? selectedDashboardDraft.mediaThumbnailUrl} controls playsInline />
                      : <img className="media-preview-image" src={selectedDashboardDraft.mediaUrl ?? selectedDashboardDraft.mediaPreviewUrl ?? selectedDashboardDraft.mediaThumbnailUrl} alt={selectedDashboardDraft.title} />
                    : <p>Chưa có media gắn với content.</p>}
                  <small>Asset IDs: {selectedDashboardDraft.mediaAssetIds?.join(", ") || "none"} · Evidence: {selectedDashboardDraft.mediaEvidence?.map((item) => `${item.assetId}:${item.role}:${item.uploadState}`).join(", ") || "none"}</small>
                </article>
                <div className="draft-action-feedback" aria-live="polite">{(["quality", "approval", "publish"] as const).map((action) => { const feedback = draftActionFeedbackFor(selectedDashboardDraft)[action]; return feedback ? <p key={action} className={feedback.status} role={feedback.status === "failure" ? "alert" : "status"}>{action}: {feedback.message}</p> : null; })}{publishBlockersByDraftId[selectedDashboardDraft.id] && <p role="status">{publishBlockersByDraftId[selectedDashboardDraft.id]}</p>}</div>
                <div className="composer-foot">
                  <button type="button" className="secondary-button" onClick={() => { setFocusDraftId(selectedDashboardDraft.id); closeDashboardDraft(false); setActiveNav("Content studio"); }}>Mở Xưởng nội dung</button>
                  {selectedDashboardDraft.status === "Needs review" && <button type="button" className="primary-button" disabled={!currentMembership || !canRole(currentMembership.role, "approve_content") || draftActionLocked(selectedDashboardDraft)} title={!currentMembership || !canRole(currentMembership.role, "approve_content") ? "approve_content permission required" : undefined} onClick={() => void approveDraft(selectedDashboardDraft.id)}>{draftActionFeedbackFor(selectedDashboardDraft).approval?.status === "running" ? "Đang chờ xác nhận…" : "Duyệt nội dung"}</button>}
                  {selectedDashboardDraft.status === "Scheduled" && <button type="button" className="secondary-button" disabled={Boolean(publishBlockersByDraftId[selectedDashboardDraft.id]) || draftActionLocked(selectedDashboardDraft, "publish")} onClick={() => void publishDraft(selectedDashboardDraft.id)}>Publish</button>}
                </div>
              </section>
            </div>
          )}

          <section className="lower-grid">
            <article className="panel table-panel">
              <div className="panel-heading table-heading"><div><p className="panel-kicker">LUỒNG NỘI DUNG</p><h2>Nội dung gần đây</h2></div><div className="filter-tabs">{(["All", "Needs review", "Scheduled", "Published"] as const).map((filter) => <button key={filter} className={activeFilter === filter ? "selected" : ""} onClick={() => setActiveFilter(filter)}>{filter === "All" ? "Tất cả" : filter === "Needs review" ? "Chờ duyệt" : filter === "Scheduled" ? "Đã lên lịch" : "Đã xuất bản"}</button>)}</div></div>
              <div className="content-table"><div className="table-row table-head"><span>NỘI DUNG</span><span>KÊNH</span><span>TRẠNG THÁI</span><span>THỜI GIAN</span><span /></div>{filteredDrafts.map((draft) => {
                const actions = contentActionItems(draft.status);
                const feedback = draftActionFeedbackFor(draft);
                const locked = draftActionLocked(draft);
                const publishBlocker = publishBlockersByDraftId[draft.id];
                const approvalDenied = !currentMembership || !canRole(currentMembership.role, "approve_content");
                return <div className="table-row" key={draft.id} role="button" tabIndex={0} onClick={(event) => openDashboardDraft(draft.id, event.currentTarget)} onKeyDown={(event) => { if (shouldOpenRowFromKey(event.key, event.target, event.currentTarget)) { event.preventDefault(); openDashboardDraft(draft.id, event.currentTarget); } }}>
                  <div className="content-cell"><div className="content-thumb" style={{ background: draft.color }}><BetterContentIcon name={contentIconName(draft)}/></div><div><strong title={draft.title}>{draft.title}</strong><span>{draft.tag} · {draft.tone}</span>{feedback.approval && <small role={feedback.approval.status === "failure" ? "alert" : "status"}>{feedback.approval.status}: {feedback.approval.message}</small>}{feedback.quality && <small role={feedback.quality.status === "failure" ? "alert" : "status"}>Quality {feedback.quality.status}: {feedback.quality.message}</small>}{publishBlocker && <small role="status">{publishBlocker}</small>}</div></div>
                  <div className="channel-cell"><PlatformMark platform={draft.platform} /><span>{draft.platform}</span></div><StatusPill status={draft.status} /><span className="date-cell">{resolveDraftTargetTime(draft.time, draft.targetPageId, connectionDisplayNames)}</span>
                  <div className="row-actions"><div className="row-menu"><button type="button" className="row-more" aria-label={`Thao tác ${draft.title}`} aria-haspopup="menu" aria-expanded={dashboardContentMenuId === draft.id} ref={(node) => { if (node) dashboardMenuTriggerRefs.current.set(draft.id, node); else dashboardMenuTriggerRefs.current.delete(draft.id); }} onKeyDown={(event) => { if (event.key === "Escape" && dashboardContentMenuId === draft.id) { event.preventDefault(); closeDashboardContentMenu(draft.id); } }} onClick={(event) => { event.stopPropagation(); setDashboardContentMenuId((current) => current === draft.id ? undefined : draft.id); }}>•••</button>{dashboardContentMenuId === draft.id && <div className="row-action-menu" role="menu" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeDashboardContentMenu(draft.id); } }}>{actions.map((action) => {
                    const needsJob = action === "reschedule" || action === "cancel_schedule";
                    const queueMissing = needsJob && targetJobIdsForDraft(draft, targetPublications).length === 0;
                    const disabled = (action === "approve" && (approvalDenied || locked)) || ((action === "regenerate_copy" || action === "delete") && locked) || (action === "publish_now" && (draftActionLocked(draft, "publish") || Boolean(publishBlocker))) || queueMissing;
                    const suffix = action === "approve" && approvalDenied ? " · View-only" : action === "publish_now" && publishBlocker ? ` · ${publishBlocker}` : queueMissing ? " · Chưa có queue" : "";
                    return <button type="button" role="menuitem" disabled={disabled} title={action === "publish_now" ? publishBlocker : approvalDenied && action === "approve" ? "approve_content permission required" : undefined} key={action} onClick={(event) => { event.stopPropagation(); runDashboardContentAction(action, draft); }}>{contentActionLabel(action)}{suffix}</button>;
                  })}</div>}</div></div>
                </div>;
              })}</div>
            </article>

            <article className="panel channel-panel"><div className="panel-heading"><div><p className="panel-kicker">TRẠNG THÁI KÊNH</p><h2>Target bindings</h2></div><button className="text-button" onClick={() => { setSettingsSection("bindings"); setActiveNav("Settings"); }}>Quản lý <span>↗</span></button></div><div className="channel-list">{connectionTargets.map((target) => { const state = presentConnectionState(target.state); const platform = target.platform === "facebook" ? "Facebook" : target.platform === "instagram" ? "Instagram" : target.platform === "tiktok" ? "TikTok" : "YouTube"; return <div className="channel-row" key={`${target.platform}:${target.id}`}><span className="channel-icon-box"><PlatformMark platform={platform}/></span><div className="channel-copy"><strong>{platform} {target.platform === "facebook" ? "Page" : target.platform === "instagram" ? "Business" : "Target"}</strong><span>{target.name}</span></div><span className={state.selectable ? "connected-status" : "connection-state attention"}><i /> {state.label}</span></div>; })}</div><div className="channel-footer"><span><span className="online-dot" /> {readyBindingCount} selectable target(s)</span><span>Non-ready targets cannot publish</span></div></article>
          </section>
          </> : <WorkspaceViews activeNav={activeNav} dashboardCalendarDate={dashboardCalendarDate} drafts={scopedDrafts} assets={activeMediaCards} queueJobs={displayQueueJobs} reviewCount={reviewDrafts.length} automationPlans={automationPlans} profileId={profileId} profileRevision={profileRevision} plannerScopeGeneration={plannerScopeGeneration} automationPlannerDrafts={automationPlannerDrafts} automationPlannerSelections={automationPlannerSelections} onPlannerDraftChange={updateAutomationPlannerDraft} onPlannerSelectionChange={updateAutomationPlannerSelection} onBeginPlannerSave={beginPlannerSave} automationAI={automationAI} automationAIResolution={automationAIResolution} onAutomationAIChange={(value) => { runGuardedComposerMutation({ isBusy: composerBusy, onBlocked: () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi AI route."), mutate: () => setAutomationAI(value) }); }} creativeRuns={automationState.creativeRuns} imageProvider={imageProvider} onImageProviderChange={(provider) => { if (!setImageProvider(provider)) return; setAutomationState((current) => ({ ...current, imageProvider: provider })); }} videoProvider={videoProvider} onVideoProviderChange={(provider) => { if (!setVideoProvider(provider)) return; setAutomationState((current) => ({ ...current, videoProvider: provider })); }} onRetryCreativeRun={retryCreativeRun} onSaveAutomationPlan={saveAutomationPlan} onRunReviewOnlyAutomationPlan={runReviewOnlyAutomationPlan} plannerRunBusy={plannerRunBusy} brandVoice={brandVoice} savedNotice={savedNotice} workspaceState={workspaceState} activeWorkspace={activeWorkspaceRecord} activeBrand={activeBrandRecord} currentMembership={currentMembership} templates={contentTemplates.filter((template) => template.workspaceId === workspaceState.activeWorkspaceId && template.brandId === workspaceState.activeBrandId && template.active)} auditEntries={queueRef.current.snapshot().auditEntries ?? []} liveReadiness={metaLiveReadiness} aiAccounts={aiAccounts} aiSettingsNotice={aiSettingsNotice} onSaveAIProviderKey={saveAIKey} onOpenAIProviderAccount={openAIAccount} onClearAIProvider={clearAIAccount} onUpdateAIModel={updateAIModel} autoRunDueJobs={autoRunDueJobs} onAutoRunDueJobsChange={(value) => { if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi auto-run setting."))) return; setAutoRunDueJobs(value); }} onOpenComposer={openComposer} inlineContentGenerating={isGenerating} generationError={generationError} focusDraftId={focusDraftId} onOpenReview={() => { setActiveNav("Review inbox"); setContentStudioFilter("review"); }} onSelect={(nav) => setActiveNav(nav)} onApprove={approveDraft} onReject={rejectDraft} onDeleteDraft={deleteDraft} onExportManualPackage={exportManualPackage} onUpdateDraft={updateDraft} onQualityCheck={qualityCheckDraft} draftActionFeedbackByDraftId={draftActionFeedbackByDraftId} publishBlockersByDraftId={publishBlockersByDraftId} onActiveActionDraftChange={setActiveActionDraft} onGenerateMedia={generateDraftMedia} onCopyDraft={copyDraft} onPublishDraft={publishDraft} onTelegramDraft={telegramDraft} onRegenerateDraft={regenerateDraft} onRestoreRevision={restoreDraftRevision} onRefreshContent={refreshContentRuns} contentStudioFilter={contentStudioFilter} settingsSection={settingsSection} brands={workspaceState.brands} brandTrashPreviews={brandTrashPreviews} brandImpactLoading={brandImpactLoading} brandImpactErrors={brandImpactErrors} brandDeleteStates={brandDeleteStates} onLoadBrandTrashPreview={loadBrandTrashPreview} onTrashBrand={trashBrandFromSettings} onRestoreBrand={restoreBrandFromSettings} onPermanentlyDeleteBrand={permanentlyDeleteBrandFromSettings} targetConnectionTargets={connectionTargets} connectionDisplayNames={connectionDisplayNames} brandIdentitiesForBinding={(workspaceState.brandIdentities ?? hydrateLegacyAgencyRecords(workspaceState).identities).filter((identity) => identity.brandId === activeBrandRecord.id)} channelBindingsForBinding={(workspaceState.channelBindings ?? []).filter((binding) => binding.brandId === activeBrandRecord.id)} onSaveTargetBindings={saveTargetBindings} onBeginConnection={beginConnection} analyticsEvents={analyticsEvents} targetPublications={targetPublications} analyticsDataAsOf={controlPlaneHealth.dataAsOf} analyticsWorkerReconciledAt={controlPlaneHealth.workerReconciledAt} onAddAsset={addAsset} onImportLocalImage={importLocalImage} mediaImportBusy={mediaImportBusy} mediaImportNotice={mediaImportNotice} onVerifyAsset={verifyAsset} onSyncDriveInventory={syncDriveInventory} driveInventorySyncBusy={driveInventorySyncBusy} onAnalyzeDriveAsset={analyzeDriveAsset} onAnalyzeLocalAsset={analyzeLocalAsset} onUploadAssetToDrive={uploadAssetToDrive} onMakeDrivePublic={makeDriveAssetPublic} onArchiveAsset={archiveAsset} onRestoreAsset={restoreAsset} onReschedule={rescheduleQueueJob} onCancel={cancelQueueJob} onDraftTargetAction={requestDraftTargetActionById} onExportDiagnostics={exportDiagnostics} onExportMigrationBackup={exportMigrationBackup} onExportReport={exportAnalyticsReport} onBrandVoiceChange={(value) => { if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi Brand voice."))) return; setBrandVoice(value); }} brandVisualTokens={brandVisualTokens} onBrandVisualTokensChange={(value) => { if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi Brand visual tokens."))) return; setBrandVisualTokens(value); }} onSaveBrand={() => { setSavedNotice("Brand system saved locally"); window.setTimeout(() => setSavedNotice(""), 2400); }} onBrandIdentityChange={(identity) => { if (!guardComposerMutation(composerBusy, () => setQueueNotice("Chờ lượt tạo nội dung hiện tại hoàn tất trước khi đổi Brand Identity."))) return; updateActiveBrandIdentity(identity); }} strategyCatalog={activeStrategyCatalog} strategyCatalogRevision={strategyCatalogRevision} strategyCatalogLoading={strategyCatalogLoading} strategyCatalogError={strategyCatalogError} onSaveStrategyCatalog={saveStrategyCatalog} onReloadStrategyCatalog={reloadStrategyCatalog} onUseTemplate={useTemplate} onAddTemplate={addTemplate} onSaveProviderConfiguration={saveProviderConfiguration} onProbeProviderConfiguration={probeProviderConfiguration} providerConfigurationNotice={providerConfigurationNotice} intakeDrafts={activeContentIntelligenceIntakeDrafts} onIntakeDraftChange={updateContentIntelligenceIntakeDraft} onCreateResearchEvidence={createResearchEvidence} onApproveResearchEvidence={approveResearchEvidence} metaAppId={metaAppId} metaSecretConfigured={metaSecretConfigured} metaAccessTokenConfigured={metaAccessTokenConfigured} metaAccountHints={metaAccountHints} metaSelectedPageId={metaSelectedPageId} metaSettingsNotice={metaSettingsNotice} metaDiscoveryBusy={metaDiscoveryBusy} metaTokenExchangeBusy={metaTokenExchangeBusy} onSaveMetaConfiguration={saveMetaConfiguration} onDiscoverMetaConfiguration={discoverMetaConfiguration} onExchangeMetaToken={extendMetaToken} onSelectMetaPage={selectMetaPage} knowledgeItems={knowledgeItems} researchEvidence={researchEvidence} promptBlueprints={promptBlueprints} contentRecipes={contentRecipes} trendSignals={trendSignals} selectedKnowledgeItemIds={selectedKnowledgeItemIds} selectedResearchEvidenceIds={selectedResearchEvidenceIds} selectedPromptBlueprintId={selectedPromptBlueprintId} selectedRecipeId={selectedRecipeId} transformMode={transformMode} onKnowledgeSelectionChange={setSelectedKnowledgeItemIds} onResearchSelectionChange={setSelectedResearchEvidenceIds} onPromptBlueprintChange={setSelectedPromptBlueprintId} onRecipeChange={setSelectedRecipeId} onTransformModeChange={setTransformMode} onCreateKnowledgeItem={createKnowledgeItem} onCreateTrendSignal={createTrendSignal} />}
        </div>
      </section>

      {showClientSetup && <div className="modal-backdrop" onMouseDown={() => setShowClientSetup(false)}><section className="composer-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="panel-kicker">CLIENT SETUP</p><h2>Add client</h2><span>Creates a new isolated Client draft.</span></div><button className="close-button" onClick={() => setShowClientSetup(false)}>×</button></div><label className="field-label">Client name<input autoFocus value={setupName} onChange={(event) => setSetupName(event.target.value)} placeholder="Client name"/></label><div className="composer-foot"><span>Timezone: {activeWorkspaceRecord.timezone}</span><button className="primary-button" onClick={addClient} disabled={!setupName.trim()}>Create client</button></div></section></div>}
      {showBrandWizard && <div className="modal-backdrop" onMouseDown={() => setShowBrandWizard(false)}><section className="composer-modal brand-wizard" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="panel-kicker">BRAND SETUP · STEP {brandSetupStep}/5</p><h2>Add brand</h2><span>Save an incomplete draft now; automation remains blocked until the identity is complete.</span></div><button className="close-button" onClick={() => setShowBrandWizard(false)}>×</button></div>{brandSetupStep === 1 && <div className="wizard-step"><label className="field-label">Brand name<input autoFocus value={setupName} onChange={(event) => setSetupName(event.target.value)} placeholder="Brand name"/></label><label className="field-label">Identity name<input value={brandSetupForm.identityName} onChange={(event) => setBrandSetupForm((current) => ({ ...current, identityName: event.target.value }))} /></label></div>}{brandSetupStep === 2 && <div className="wizard-step"><label className="field-label">Vision<input value={brandSetupForm.vision} onChange={(event) => setBrandSetupForm((current) => ({ ...current, vision: event.target.value }))} placeholder="What this brand helps people do"/></label><label className="field-label">Mission<textarea value={brandSetupForm.mission} onChange={(event) => setBrandSetupForm((current) => ({ ...current, mission: event.target.value }))} rows={3}/></label><label className="field-label">Core values<textarea value={brandSetupForm.values} onChange={(event) => setBrandSetupForm((current) => ({ ...current, values: event.target.value }))} placeholder="Trust, care, clarity"/></label><label className="field-label">Brand personality<textarea value={brandSetupForm.personality} onChange={(event) => setBrandSetupForm((current) => ({ ...current, personality: event.target.value }))} placeholder="Warm, direct, practical"/></label><label className="field-label">Audience<input value={brandSetupForm.audience} onChange={(event) => setBrandSetupForm((current) => ({ ...current, audience: event.target.value }))} /></label><label className="field-label">Positioning<textarea value={brandSetupForm.positioning} onChange={(event) => setBrandSetupForm((current) => ({ ...current, positioning: event.target.value }))} rows={2}/></label></div>}{brandSetupStep === 3 && <div className="wizard-step"><label className="field-label">Voice / tone<textarea value={brandSetupForm.tone} onChange={(event) => setBrandSetupForm((current) => ({ ...current, tone: event.target.value }))} rows={4} placeholder="Clear, warm, evidence-led…"/></label><label className="field-label">Vocabulary<textarea value={brandSetupForm.vocabulary} onChange={(event) => setBrandSetupForm((current) => ({ ...current, vocabulary: event.target.value }))} placeholder="Words to use"/></label><label className="field-label">Prohibited claims<textarea value={brandSetupForm.prohibitedClaims} onChange={(event) => setBrandSetupForm((current) => ({ ...current, prohibitedClaims: event.target.value }))} placeholder="Claims to avoid"/></label><label className="field-label">Required disclosure<textarea value={brandSetupForm.requiredDisclosure} onChange={(event) => setBrandSetupForm((current) => ({ ...current, requiredDisclosure: event.target.value }))} placeholder="Optional disclosure text"/></label></div>}{brandSetupStep === 4 && <div className="wizard-step"><div className="token-fields"><label className="field-label">Primary<input type="color" value={brandSetupForm.primary} onChange={(event) => setBrandSetupForm((current) => ({ ...current, primary: event.target.value }))}/></label><label className="field-label">Primary RGB<input value={brandSetupForm.primaryRgb} onChange={(event) => setBrandSetupForm((current) => ({ ...current, primaryRgb: event.target.value }))} placeholder="rgb(79, 70, 229)"/></label><label className="field-label">Primary CMYK<input value={brandSetupForm.primaryCmyk} onChange={(event) => setBrandSetupForm((current) => ({ ...current, primaryCmyk: event.target.value }))} placeholder="70, 65, 0, 10"/></label><label className="field-label">Secondary<input type="color" value={brandSetupForm.secondary} onChange={(event) => setBrandSetupForm((current) => ({ ...current, secondary: event.target.value }))}/></label><label className="field-label">Secondary RGB<input value={brandSetupForm.secondaryRgb} onChange={(event) => setBrandSetupForm((current) => ({ ...current, secondaryRgb: event.target.value }))} placeholder="rgb(246, 247, 251)"/></label><label className="field-label">Secondary CMYK<input value={brandSetupForm.secondaryCmyk} onChange={(event) => setBrandSetupForm((current) => ({ ...current, secondaryCmyk: event.target.value }))} placeholder="2, 2, 0, 0"/></label><label className="field-label">Logo asset IDs<input value={brandSetupForm.logoAssetIds} onChange={(event) => setBrandSetupForm((current) => ({ ...current, logoAssetIds: event.target.value }))} placeholder="asset-logo-primary"/></label><label className="field-label">Tagline<input value={brandSetupForm.tagline} onChange={(event) => setBrandSetupForm((current) => ({ ...current, tagline: event.target.value }))}/></label><label className="field-label">Typography<input value={brandSetupForm.typography} onChange={(event) => setBrandSetupForm((current) => ({ ...current, typography: event.target.value }))}/></label></div><label className="field-label">Style guide<textarea value={brandSetupForm.styleGuide} onChange={(event) => setBrandSetupForm((current) => ({ ...current, styleGuide: event.target.value }))} rows={4}/></label></div>}{brandSetupStep === 5 && <div className="wizard-step"><strong>Initial target bindings (optional)</strong><p className="settings-help">Only Connected targets can be selected. You can edit identity assignments later in Target bindings.</p><div className="wizard-target-list">{connectionTargets.map((target) => { const state = presentConnectionState(target.state); const chosen = brandSetupTargets.includes(target.id); return <label className={`binding-chip ${chosen ? "selected" : ""} ${state.selectable ? "" : "disabled"}`} key={target.id} aria-disabled={!state.selectable}><input type="checkbox" disabled={!state.selectable} checked={chosen} onChange={() => setBrandSetupTargets((current) => chosen ? current.filter((id) => id !== target.id) : [...current, target.id])}/><span className={`binding-chip-platform ${target.platform}`} aria-hidden="true"><BetterPlatformIcon name={target.platform} /></span><span className="binding-chip-copy"><strong>{target.name}</strong><small>{state.label}{state.recoveryCta ? ` · ${state.recoveryCta}` : ""}</small></span></label>; })}</div></div>}{brandSetupStep > 1 && <button className="text-button" onClick={() => setBrandSetupStep((current) => current - 1)}>← Back</button>}<div className="composer-foot"><span>{brandSetupStep < 5 ? "Continue to next section" : "Incomplete forms remain draft"}</span>{brandSetupStep < 5 ? <button className="primary-button" disabled={brandSetupStep === 1 && !setupName.trim()} onClick={() => setBrandSetupStep((current) => current + 1)}>Next →</button> : <button className="primary-button" onClick={addBrand} disabled={!setupName.trim()}>Create Brand</button>}</div></section></div>}

      {showComposer && <div className="modal-backdrop" onMouseDown={() => setShowComposer(false)}><section className="composer-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="panel-kicker">AI CONTENT STUDIO</p><h2>Start a new content sprint</h2><span>Generate one idea, then adapt it across every channel.</span></div><button className="close-button" onClick={() => setShowComposer(false)}>×</button></div><label className="field-label">What should we talk about?<textarea value={newTopic} onChange={(event) => setNewTopic(event.target.value)} placeholder="Example: How to build an emergency fund when income is irregular..." rows={4} /></label><div className="composer-options"><label className="field-label">AI engine<select value={aiProvider} onChange={(event) => { const value = event.target.value as AIProvider; setAiProvider(value); if (value === "gemini" || value === "openai") setAiMode(value === "gemini" ? "web_subscription" : "api"); }}><option value="openai">ChatGPT / OpenAI</option><option value="gemini">Gemini Pro · in-app browser</option></select></label><><label className="field-label">Mode<select value={aiMode} onChange={(event) => setAiMode(event.target.value as "api" | "manual_assisted" | "web_subscription")}><option value="api">Official API via .env credential file</option>{(aiProvider === "gemini" || aiProvider === "openai") && <option value="web_subscription">{aiProvider === "gemini" ? "Gemini Pro" : "ChatGPT Plus"} · in-app browser</option>}<option value="manual_assisted">Manual assist · no automation</option></select></label><label className="field-label">Model<select value={aiAccounts[aiProvider].model} onChange={(event) => void updateAIModel(aiProvider, event.target.value)}>{AI_MODEL_OPTIONS[aiProvider].map((model) => <option key={model} value={model}>{model}</option>)}</select></label><span className="settings-help">{aiMode === "web_subscription" ? `SignalFlow sẽ dùng session ${aiProvider === "gemini" ? "Gemini Pro" : "ChatGPT Plus"} đã đăng nhập trong cửa sổ app; hồ sơ phiên được giữ bền vững và không cần API key hay Chrome ngoài.` : aiMode === "manual_assisted" ? "Mở trang chính thức trong app để bố thao tác thủ công; không dùng Chrome ngoài." : aiAccounts[aiProvider].status === "configured" ? ".env credential file account ready." : "Save an API key in Settings → AI Providers first."}</span></></div><div className="field-label">Target channels<div className="platform-selectors">{(["Facebook", "Instagram", "TikTok", "YouTube"] as Platform[]).map((platform) => <button key={platform} className={`platform-selector ${selectedPlatforms.includes(platform) ? "selected" : ""}`} onClick={() => togglePlatform(platform)}><PlatformMark platform={platform} /><span>{platform}</span><b>{selectedPlatforms.includes(platform) ? "✓" : "＋"}</b></button>)}</div></div>{assets.some((asset) => asset.kind === "Image" && asset.status === "Ready" && asset.publicUrl) && <label className="field-label">Media asset for this Facebook image test<select value={composerAssetId} onChange={(event) => setComposerAssetId(event.target.value || "")}><option value="">Text-only post</option>{assets.filter((asset) => asset.kind === "Image" && asset.status === "Ready" && asset.publicUrl).map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · Drive public link</option>)}</select></label>} {generationError && <div className="generation-error">{generationError}<button className="text-button" onClick={() => { setAiProvider(aiProvider === "gemini" ? "openai" : aiProvider === "openai" ? "gemini" : "openai"); setAiMode("api"); setGenerationError("New run route selected explicitly; provider retry will not cross modes."); }}>Create new run with another route</button></div>}<div className="composer-foot"><span><span className="sparkle-dot">✦</span> Brand voice: {activeBrandRecord.name}</span><button className="primary-button" onClick={() => void createDraft()} disabled={isGenerating}>{isGenerating ? "Generating…" : "Generate draft"} <span>✦</span></button></div></section></div>}
      {targetActionPrompt && targetActionDraft && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="target-action-title" onMouseDown={() => closeTargetActionPrompt()}><section ref={targetActionDialogRef} className="composer-modal" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeTargetActionPrompt(); return; } if (event.key !== "Tab") return; const focusable = Array.from(targetActionDialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []); const first = focusable[0]; const last = focusable[focusable.length - 1]; const activeIndex = focusable.findIndex((element) => element === document.activeElement); const focusTarget = targetActionModalFocusTarget(event.key, event.shiftKey, activeIndex, focusable.length, document.activeElement === targetActionDialogRef.current); if (!first || !last) { event.preventDefault(); targetActionDialogRef.current?.focus(); } else if (focusTarget === "last") { event.preventDefault(); last.focus(); } else if (focusTarget === "first") { event.preventDefault(); first.focus(); } }}><div className="modal-heading"><div><p className="panel-kicker">TARGET REQUIRED</p><h2 id="target-action-title">Chọn đúng target</h2><span>{targetActionPrompt.action === "publish_now" ? "Publish-now chỉ tác động Page đã xác nhận; chọn target live." : targetActionPrompt.action === "reschedule" ? "Đổi lịch cho một Page tại một thời điểm." : "Hủy lịch cho một Page tại một thời điểm."}</span></div><button type="button" className="close-button" aria-label="Đóng chọn target" onClick={() => closeTargetActionPrompt()}>×</button></div><label className="field-label">Page / binding<select autoFocus value={targetActionJobId} onChange={(event) => setTargetActionJobId(event.target.value)}><option value="">Chọn target</option>{targetActionJobIds.map((jobId) => { const job = displayQueueJobs.find((candidate) => candidate.id === jobId); const publication = publicationForJob(jobId); const binding = workspaceState.channelBindings?.find((candidate) => candidate.id === (publication?.bindingId ?? job?.bindingId)); const label = publication?.targetExternalId ?? binding?.targetName ?? binding?.targetExternalId ?? jobId; return <option key={jobId} value={jobId}>{label} · {jobId}</option>; })}</select></label><div className="composer-foot"><button type="button" className="secondary-button" onClick={() => closeTargetActionPrompt()}>Hủy</button><button type="button" className="primary-button" disabled={!targetActionJobId} onClick={confirmTargetAction}>Tiếp tục</button></div></section></div>}
      {schedulePromptDraftId !== undefined && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="schedule-required-title" onMouseDown={() => closeSchedulePrompt()}><section ref={schedulePromptDialogRef} className="composer-modal" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeSchedulePrompt(); return; } if (event.key !== "Tab") return; const focusable = Array.from(schedulePromptDialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []); const first = focusable[0]; const last = focusable[focusable.length - 1]; if (!first || !last) { event.preventDefault(); schedulePromptDialogRef.current?.focus(); } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }}><div className="modal-heading"><div><p className="panel-kicker">SCHEDULE REQUIRED</p><h2 id="schedule-required-title">Chọn giờ đăng</h2><span>Giờ nhập theo múi giờ thiết bị; campaign và run days được kiểm tra theo {automationPlans.find((plan) => plan.id === draftsRef.current.find((draft) => draft.id === schedulePromptDraftId)?.planId)?.cron.timezone ?? "kế hoạch gốc"}. Chưa có approval request nào được gửi.</span></div><button type="button" className="close-button" aria-label="Đóng chọn lịch" onClick={() => closeSchedulePrompt()}>×</button></div><label className="field-label">Ngày giờ đăng<input autoFocus type="datetime-local" value={schedulePromptValue} onChange={(event) => setSchedulePromptValue(event.target.value)} /></label><div className="composer-foot"><button type="button" className="secondary-button" onClick={() => closeSchedulePrompt()}>Hủy</button><button type="button" className="primary-button" disabled={!schedulePromptValue} onClick={submitSchedulePrompt}>Duyệt và lên lịch</button></div></section></div>}
      {reschedulePromptJobId !== undefined && <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={() => setReschedulePromptJobId(undefined)}><section className="composer-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="panel-kicker">RESCHEDULE</p><h2>Đổi lịch đăng</h2><span>Lịch cũ chỉ đổi sau khi Control Plane và worker cùng xác nhận.</span></div><button className="close-button" onClick={() => setReschedulePromptJobId(undefined)}>×</button></div><label className="field-label">Ngày giờ mới<input autoFocus type="datetime-local" value={reschedulePromptValue} onChange={(event) => setReschedulePromptValue(event.target.value)} /></label><div className="composer-foot"><button className="secondary-button" onClick={() => setReschedulePromptJobId(undefined)}>Hủy</button><button className="primary-button" disabled={!reschedulePromptValue} onClick={() => { const jobId = reschedulePromptJobId; const value = new Date(reschedulePromptValue); setReschedulePromptJobId(undefined); if (!Number.isNaN(value.getTime())) void applyRescheduleQueueJob(jobId, value.toISOString()); }}>Lưu giờ mới</button></div></section></div>}
    </main>
  );
}

export default App;
