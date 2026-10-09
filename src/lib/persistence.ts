import type { AuditEntry } from "./auditLog";
import type { BrandSystem, ContentVariant, PublishJob, SocialConnection } from "./mvpContracts";
import { normalizeAutomationPlan, sanitizeAutomationAIPreference, type AutomationPlan } from "./automationPlanner";
import type { AutomationPersistenceState, CreativePipelineState, CreativeRunRecord, MediaInventoryRecord } from "./automationDomain";
import { sanitizeLegacyMediaAsset } from "./mediaAssets";
import { normalizeDriveInventoryRecord } from "./automationDomain";
import { clientIdForBrand, ensureBrandScheduleTemplate, ensureBrandStrategyCatalog, isBrandTrashed, mergeBrandVisualTokensByBrand, normalizeBrandScheduleTemplate, strategyCatalogScopeKey, type BrandRecord, type BrandScheduleTemplate, type ContentTemplate, type WorkspaceState } from "./workspaceDomain";
import { hydrateLegacyAgencyRecords, legacyAgencyIdentityId, type ChannelConnectionRecord } from "./brandIdentity";
import { profileSnapshotKey } from "./profileDomain";
import { strategyCatalogFingerprint, validateStrategyCatalog, type BrandStrategyCatalog } from "./contentStrategy";

export { strategyCatalogFingerprint } from "./contentStrategy";

const STORAGE_KEY = "signalflow.workspace.snapshot.v3";
const LEGACY_KEYS = ["signalflow.workspace.snapshot.v2", "signalflow.workspace.snapshot.v1"];
export const PERSISTED_SNAPSHOT_SCHEMA_VERSION = 5 as const;
const LEGACY_CREATIVE_CHECKPOINT_KEY = "signalflow.automation.creative-checkpoints.v1";

type CreativeCheckpointRunPatch = Partial<Pick<CreativeRunRecord, "brandId" | "topic" | "idea" | "ideaProvider" | "imageProvider" | "platform" | "targetPageId" | "automationKey" | "mediaAssetId" | "mediaProvenance" | "generatedMimeType" | "generatedSha256" | "generatedFingerprint" | "copyProvider" | "reviewedAt" | "error" | "mediaOwnershipReconciliation">> & { copyResult?: { provider?: string; imageAware: boolean } };
type CreativeCheckpoint = { state: CreativePipelineState; updatedAt: string; automationKey?: string; run?: CreativeCheckpointRunPatch };
type CreativeCheckpointLedger = Record<string, CreativeCheckpoint>;

const CREATIVE_STATE_ORDER: Record<CreativePipelineState, number> = {
  idea: 1,
  media_selected: 2,
  media_generated: 3,
  image: 3,
  copy: 4,
  content_generated: 5,
  review: 6,
  needs_review: 6,
  approved: 7,
  scheduled: 8,
  published: 9,
  failed: 10,
};

export interface PersistedQueueState {
  jobs: PublishJob[];
  variants: ContentVariant[];
  connections: SocialConnection[];
  auditEntries?: AuditEntry[];
}

export interface PersistedSnapshot<T, M = unknown> {
  [key: string]: unknown;
  schemaVersion: typeof PERSISTED_SNAPSHOT_SCHEMA_VERSION;
  savedAt: string;
  drafts: T[];
  selectedPlatforms: string[];
  queue?: PersistedQueueState;
  brandSystem?: BrandSystem;
  mediaAssets?: M[];
  workspaceState?: WorkspaceState;
  contentTemplates?: ContentTemplate[];
  automationPlans?: AutomationPlan[];
  automationState?: AutomationPersistenceState;
  /** Idempotent marker for the v4 -> v5 strategy catalog migration. */
  strategyCatalogMigrationVersion?: typeof PERSISTED_SNAPSHOT_SCHEMA_VERSION;
  /** Set only after the Control Plane commits Client/Brand/Identity/Binding state. */
  controlPlaneMigrated?: boolean;
}

export interface RestoredSnapshot<T, M = unknown> {
  [key: string]: unknown;
  drafts: T[];
  selectedPlatforms: string[];
  queue?: PersistedQueueState;
  brandSystem?: BrandSystem;
  mediaAssets?: M[];
  workspaceState?: WorkspaceState;
  contentTemplates?: ContentTemplate[];
  automationPlans?: AutomationPlan[];
  automationState?: AutomationPersistenceState;
  strategyCatalogMigrationVersion?: typeof PERSISTED_SNAPSHOT_SCHEMA_VERSION;
  controlPlaneMigrated?: boolean;
}

export type StrategyCatalogSaveDraft = {
  clientId: string;
  brandId: string;
  scopeKey: string;
  catalog: BrandStrategyCatalog;
  savedVersion: number;
  revision: number;
  pending: boolean;
  errorCode: string | null;
};

export type StrategyCatalogSaveAcknowledgement = {
  clientId: string;
  brandId: string;
  revision: number;
  version: number;
  fingerprint: string;
  scopeKey: string;
};

/** Keep the draft at its durable version until the Control Plane ACK matches it. */
export function beginStrategyCatalogSave(catalog: StrategyCatalogSaveDraft["catalog"], clientId: string, brandId: string, revision: number): StrategyCatalogSaveDraft {
  if (!validateStrategyCatalog(catalog).ok) throw new Error("STRATEGY_CATALOG_INVALID");
  if (catalog.brandId !== brandId) throw new Error("STRATEGY_CATALOG_SCOPE_MISMATCH");
  return { clientId, brandId, scopeKey: strategyCatalogScopeKey(clientId, brandId), catalog: structuredClone(catalog), savedVersion: catalog.version, revision, pending: true, errorCode: null };
}

export function strategyCatalogSaveAckMatches(draft: StrategyCatalogSaveDraft, acknowledgement: StrategyCatalogSaveAcknowledgement): boolean {
  const savedCatalog = { ...draft.catalog, version: acknowledgement.version };
  return acknowledgement.scopeKey === draft.scopeKey
    && acknowledgement.clientId === draft.clientId
    && acknowledgement.brandId === draft.brandId
    && acknowledgement.revision === draft.revision
    && acknowledgement.version === draft.savedVersion + 1
    && acknowledgement.fingerprint === strategyCatalogFingerprint(savedCatalog);
}

export function settleStrategyCatalogSave(current: StrategyCatalogSaveDraft, acknowledgement: StrategyCatalogSaveAcknowledgement | { errorCode: string }): StrategyCatalogSaveDraft {
  if (!current.pending) return current;
  if ("errorCode" in acknowledgement) return { ...current, pending: false, errorCode: acknowledgement.errorCode };
  if (typeof acknowledgement.scopeKey !== "string") return { ...current, pending: false, errorCode: "STRATEGY_CATALOG_ACK_INVALID" };
  if (acknowledgement.scopeKey !== current.scopeKey) return current;
  if (acknowledgement.clientId !== current.clientId || acknowledgement.brandId !== current.brandId || acknowledgement.revision !== current.revision) return current;
  if (!strategyCatalogSaveAckMatches(current, acknowledgement)) return { ...current, pending: false, errorCode: "STRATEGY_CATALOG_ACK_INVALID" };
  return { ...current, catalog: { ...current.catalog, version: acknowledgement.version }, savedVersion: acknowledgement.version, pending: false, errorCode: null };
}

export const rejectStrategyCatalogSave = (current: StrategyCatalogSaveDraft, errorCode = "STRATEGY_CATALOG_SAVE_REJECTED"): StrategyCatalogSaveDraft => ({ ...current, pending: false, errorCode });
export const applyStrategyCatalogSaveAck = settleStrategyCatalogSave;

function recoverInterruptedMediaOperations<T>(drafts: T[]): T[] {
  return drafts.map((draft) => {
    if (!draft || typeof draft !== "object") return draft;
    const value = draft as T & { mediaOperation?: { status?: string; reason?: string }; mediaOperations?: Array<{ status?: string; reason?: string }> };
    if (value.mediaOperation?.status !== "running" && !value.mediaOperations?.some((operation) => operation.status === "running")) return draft;
    const recover = <TItem extends { status?: string; reason?: string }>(operation: TItem): TItem => operation.status === "running" ? { ...operation, status: "failed", reason: operation.reason ?? "APP_RESTART_INTERRUPTED" } : operation;
    return { ...value, mediaOperation: value.mediaOperation ? recover(value.mediaOperation) : value.mediaOperation, mediaOperations: value.mediaOperations?.map(recover) } as T;
  });
}

const FORBIDDEN_PERSISTED_KEYS = new Set([
  "accesstoken", "refreshtoken", "authorization", "cookie", "cookies", "password", "secret", "token", "apikey", "privatekey", "clientsecret", "session", "sessiondata", "localstorage", "browserstorage",
]);

function isForbiddenPersistedKey(key: string): boolean {
  return FORBIDDEN_PERSISTED_KEYS.has(key.toLowerCase().replace(/[_.-]/g, ""));
}

function stripSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitiveKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isForbiddenPersistedKey(key)).map(([key, item]) => [key, stripSensitiveKeys(item)]));
}

function isLocalPathExportKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_.-]/g, "");
  return normalized !== "relativepath" && (normalized.endsWith("path") || normalized === "localasseturl");
}

function isLocalPathExportValue(value: unknown): boolean {
  return typeof value === "string" && /^(?:file:|blob:|data:image\/|~\/|\/(?:Users|private|tmp|var|home|Volumes|mnt)(?:\/|$)|[A-Za-z]:[\\/]|\\\\)/i.test(value.trim());
}

function stripExportOnlyKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripExportOnlyKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => {
      if (isForbiddenPersistedKey(key) || isLocalPathExportKey(key)) return false;
      const normalized = key.toLowerCase().replace(/[_.-]/g, "");
      return !(isLocalPathExportValue(item) && /(asset|media|preview|thumbnail|file|url)/.test(normalized));
    })
    .map(([key, item]) => [key, stripExportOnlyKeys(item)]));
}

function creativeCheckpointKey(profileId: string): string {
  return profileSnapshotKey(profileId).replace(/\.snapshot\.v1$/, ".automation.creative-checkpoints.v1");
}

function parseCreativeCheckpointLedger(raw: string | null): CreativeCheckpointLedger {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => {
      if (!value || typeof value !== "object") return false;
      const checkpoint = value as Partial<CreativeCheckpoint>;
      return typeof checkpoint.state === "string" && checkpoint.state in CREATIVE_STATE_ORDER && typeof checkpoint.updatedAt === "string" && (checkpoint.run === undefined || (typeof checkpoint.run === "object" && checkpoint.run !== null));
    })) as CreativeCheckpointLedger;
  } catch {
    return {};
  }
}

function readCreativeCheckpointLedger(profileId?: string): CreativeCheckpointLedger {
  if (!profileId || typeof window === "undefined" || !window.localStorage) return {};
  try {
    const storageKey = creativeCheckpointKey(profileId);
    let raw = window.localStorage.getItem(storageKey);
    if (!raw && profileId === "profile-bavy") {
      raw = window.localStorage.getItem(LEGACY_CREATIVE_CHECKPOINT_KEY);
      if (raw) {
        const ownerLedger = parseCreativeCheckpointLedger(raw);
        if (Object.keys(ownerLedger).length > 0) {
          try { window.localStorage.setItem(storageKey, JSON.stringify(ownerLedger)); } catch { /* legacy owner reads remain scoped in memory */ }
        }
        return ownerLedger;
      }
    }
    return parseCreativeCheckpointLedger(raw);
  } catch {
    return {};
  }
}

/** Persist the scalar stage plus safe run identity/provider/media fields before or after an awaited provider call. */
export function persistAutomationCheckpoint(profileId: string, run: Pick<CreativeRunRecord, "id" | "state" | "updatedAt" | "automationKey" | "brandId" | "topic"> & Partial<Pick<CreativeRunRecord, "idea" | "ideaProvider" | "imageProvider" | "platform" | "targetPageId" | "mediaAssetId" | "mediaProvenance" | "generatedMimeType" | "generatedSha256" | "generatedFingerprint" | "copyProvider" | "copyResult" | "reviewedAt" | "error" | "mediaOwnershipReconciliation">>): void {
  try {
    if (!run.id || !run.updatedAt || !(run.state in CREATIVE_STATE_ORDER)) return;
    if (/\s·\s(?:facebook|instagram|tiktok|youtube)\s·\s(?:[01]\d|2[0-3]):[0-5]\d$/i.test(run.topic.trim())) return;
    const storageKey = creativeCheckpointKey(profileId);
    const ledger = readCreativeCheckpointLedger(profileId);
    const runPatch: CreativeCheckpointRunPatch = {
      brandId: run.brandId,
      topic: run.topic,
      idea: run.idea,
      ideaProvider: run.ideaProvider,
      imageProvider: run.imageProvider,
      platform: run.platform,
      targetPageId: run.targetPageId,
      automationKey: run.automationKey,
      mediaAssetId: run.mediaAssetId,
      mediaProvenance: run.mediaProvenance,
      generatedMimeType: run.generatedMimeType,
      generatedSha256: run.generatedSha256,
      generatedFingerprint: run.generatedFingerprint,
      copyProvider: run.copyProvider,
      copyResult: run.copyResult ? { provider: run.copyResult.provider, imageAware: run.copyResult.imageAware } : undefined,
      reviewedAt: run.reviewedAt,
      error: run.error,
      mediaOwnershipReconciliation: run.mediaOwnershipReconciliation,
    };
    ledger[run.id] = { state: run.state, updatedAt: run.updatedAt, ...(run.automationKey ? { automationKey: run.automationKey } : {}), run: runPatch };
    window.localStorage.setItem(storageKey, JSON.stringify(ledger));
  } catch {
    // Snapshot persistence remains the fallback when local storage is unavailable.
  }
}

function applyCreativeCheckpoints(state: AutomationPersistenceState | undefined, profileId?: string): AutomationPersistenceState | undefined {
  if (!state || !profileId) return state;
  const ledger = readCreativeCheckpointLedger(profileId);
  if (Object.keys(ledger).length === 0) return state;
  return {
    ...state,
    creativeRuns: state.creativeRuns.map((run) => {
      const checkpoint = ledger[run.id];
      if (!checkpoint) return run;
      const runTime = Date.parse(run.updatedAt);
      const checkpointTime = Date.parse(checkpoint.updatedAt);
      const checkpointIsNewer = Number.isNaN(runTime) || Number.isNaN(checkpointTime) || checkpointTime > runTime;
      const sameTimeAndForward = checkpointTime === runTime && CREATIVE_STATE_ORDER[checkpoint.state] > CREATIVE_STATE_ORDER[run.state];
      if (!(checkpointIsNewer || sameTimeAndForward)) return run;
      const checkpointRun = checkpoint.run;
      const safeRunPatch = checkpointRun ? Object.fromEntries(Object.entries({
        brandId: checkpointRun.brandId,
        topic: checkpointRun.topic,
        idea: checkpointRun.idea,
        ideaProvider: checkpointRun.ideaProvider,
        imageProvider: checkpointRun.imageProvider,
        platform: checkpointRun.platform,
        targetPageId: checkpointRun.targetPageId,
        automationKey: checkpointRun.automationKey,
        mediaAssetId: checkpointRun.mediaAssetId,
        mediaProvenance: checkpointRun.mediaProvenance,
        generatedMimeType: checkpointRun.generatedMimeType,
        generatedSha256: checkpointRun.generatedSha256,
        generatedFingerprint: checkpointRun.generatedFingerprint,
        copyProvider: checkpointRun.copyProvider,
        reviewedAt: checkpointRun.reviewedAt,
        error: checkpointRun.error,
        mediaOwnershipReconciliation: checkpointRun.mediaOwnershipReconciliation,
      }).filter(([, value]) => value !== undefined)) as Partial<CreativeRunRecord> : {};
      const safeCopyResult = checkpointRun?.copyResult && typeof checkpointRun.copyResult.imageAware === "boolean"
        ? { ...(checkpointRun.copyResult.provider !== undefined ? { provider: checkpointRun.copyResult.provider } : {}), imageAware: checkpointRun.copyResult.imageAware }
        : undefined;
      const mergedCopyResult = safeCopyResult ? { ...run.copyResult, ...safeCopyResult } : run.copyResult;
      return { ...run, ...safeRunPatch, ...(mergedCopyResult ? { copyResult: mergedCopyResult } : {}), state: checkpoint.state, updatedAt: checkpoint.updatedAt };
    }),
  };
}

function migrateAutomationState(raw: unknown, fallback?: AutomationPersistenceState): AutomationPersistenceState | undefined {
  if (!raw || typeof raw !== "object") return fallback;
  const candidate = raw as Partial<AutomationPersistenceState>;
  if (candidate.schemaVersion !== 1) return fallback;
  const legacyStateMap: Record<string, string> = { image: "media_generated", copy: "content_generated", review: "needs_review" };
  const creativeRuns = Array.isArray(candidate.creativeRuns)
    ? candidate.creativeRuns.map((run) => {
      if (!run || typeof run !== "object") return run;
      const record = run as unknown as Record<string, unknown>;
      const state = typeof record.state === "string" ? legacyStateMap[record.state] ?? record.state : record.state;
      return { ...record, state };
    })
    : [];
  const mediaAssets = Array.isArray(candidate.mediaAssets)
    ? candidate.mediaAssets.map((asset) => {
      if (!asset || typeof asset !== "object") return asset;
      const sanitized = sanitizeLegacyMediaAsset(
        asset as MediaInventoryRecord & { publicUrl?: string },
        "eligible",
        "classified",
      );
      return normalizeDriveInventoryRecord(sanitized as MediaInventoryRecord);
    })
    : [];
  return {
    schemaVersion: 1,
    brandPlans: Array.isArray(candidate.brandPlans) ? candidate.brandPlans : [],
    mediaAssets,
    reservations: Array.isArray(candidate.reservations) ? candidate.reservations : [],
    creativeRuns,
    imageProvider: candidate.imageProvider,
    videoProvider: candidate.videoProvider,
    automationAI: sanitizeAutomationAIPreference(candidate.automationAI),
  } as AutomationPersistenceState;
}

function mapOrEmpty<T>(value: unknown): Record<string, T> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, T> : {};
}

function validSnapshotTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function migrationTimestamp(value: unknown, fallback: string): string {
  return validSnapshotTimestamp(value) ? value : validSnapshotTimestamp(fallback) ? fallback : "1970-01-01T00:00:00.000Z";
}

function scopedCatalogMaps(state: WorkspaceState): Pick<WorkspaceState, "strategyCatalogsByBrand" | "scheduleTemplatesByBrand"> {
  const catalogs: NonNullable<WorkspaceState["strategyCatalogsByBrand"]> = {};
  const templates: NonNullable<WorkspaceState["scheduleTemplatesByBrand"]> = {};
  for (const [key, catalog] of Object.entries(mapOrEmpty<BrandStrategyCatalog>(state.strategyCatalogsByBrand))) {
    if (!catalog || typeof catalog !== "object" || validateStrategyCatalog(catalog).ok === false) continue;
    const record = catalog as BrandStrategyCatalog;
    let decoded: unknown;
    try { decoded = JSON.parse(key); } catch { decoded = undefined; }
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== "string" || typeof decoded[1] !== "string" || decoded[1] !== record.brandId) continue;
    const owner = state.brands.find((brand) => brand.id === decoded[1] && clientIdForBrand(brand) === decoded[0] && !isBrandTrashed(brand));
    if (!owner) continue;
    const canonicalKey = strategyCatalogScopeKey(decoded[0], decoded[1]);
    catalogs[canonicalKey] = structuredClone(record);
  }
  for (const [key, template] of Object.entries(mapOrEmpty<BrandScheduleTemplate>(state.scheduleTemplatesByBrand))) {
    if (!template || typeof template !== "object") continue;
    let decoded: unknown;
    try { decoded = JSON.parse(key); } catch { decoded = undefined; }
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== "string" || typeof decoded[1] !== "string" || template.brandId !== decoded[1]) continue;
    const owner = state.brands.find((brand) => brand.id === decoded[1] && clientIdForBrand(brand) === decoded[0] && brand.status === "active" && !isBrandTrashed(brand));
    const normalized = normalizeBrandScheduleTemplate(template);
    if (!owner || !normalized) continue;
    templates[strategyCatalogScopeKey(decoded[0], decoded[1])] = normalized;
  }
  return { strategyCatalogsByBrand: catalogs, scheduleTemplatesByBrand: templates };
}

function identityCatalogOwner(identity: { id: string; brandId: string; clientId?: unknown }, brands: BrandRecord[]): BrandRecord | undefined {
  const candidates = brands.filter((brand) => brand.id === identity.brandId && brand.status === "active" && !isBrandTrashed(brand));
  if (typeof identity.clientId === "string") {
    const scoped = candidates.filter((brand) => clientIdForBrand(brand) === identity.clientId);
    return scoped.length === 1 ? scoped[0] : undefined;
  }
  if (candidates.length === 1) return candidates[0];
  const matches = candidates.filter((brand) => legacyAgencyIdentityId(brand) === identity.id);
  return matches.length === 1 ? matches[0] : undefined;
}

function importIdentityCatalogs(state: WorkspaceState, catalogs: Record<string, BrandStrategyCatalog>): Record<string, BrandStrategyCatalog> {
  const identities = [...(state.brandIdentities ?? [])].sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || Number(right.status === "active") - Number(left.status === "active") || left.id.localeCompare(right.id));
  for (const identity of identities) {
    const candidate = identity as typeof identity & { clientId?: unknown };
    const catalog = candidate.strategyCatalog;
    if (!candidate.isDefault || candidate.status !== "active" || !catalog || !validateStrategyCatalog(catalog).ok || catalog.brandId !== candidate.brandId) continue;
    const owner = identityCatalogOwner(candidate, state.brands);
    if (!owner) continue;
    const scopeKey = strategyCatalogScopeKey(clientIdForBrand(owner), owner.id);
    if (!catalogs[scopeKey]) catalogs[scopeKey] = structuredClone(catalog);
  }
  return catalogs;
}

function ensureWorkspaceCatalogs(state: WorkspaceState, now?: Date): WorkspaceState {
  const acceptedMaps = scopedCatalogMaps(state);
  let ensured: WorkspaceState = { ...state, ...acceptedMaps, strategyCatalogsByBrand: importIdentityCatalogs({ ...state, ...acceptedMaps }, acceptedMaps.strategyCatalogsByBrand ?? {}) };
  for (const brand of ensured.brands) {
    if (isBrandTrashed(brand) || brand.status !== "active") continue;
    const clientId = clientIdForBrand(brand);
    ensured = ensureBrandStrategyCatalog(ensured, clientId, brand.id, now);
    ensured = ensureBrandScheduleTemplate(ensured, clientId, brand.id, now);
  }
  return ensured;
}

function stripIdentityCatalogs(state: WorkspaceState): WorkspaceState {
  if (!state.brandIdentities) return state;
  return {
    ...state,
    brandIdentities: state.brandIdentities.map((identity) => {
      const { strategyCatalog: _ignored, ...withoutCatalog } = identity;
      return withoutCatalog;
    }),
  };
}

function mergeControlPlaneWorkspaceState(saved: WorkspaceState, current: WorkspaceState, now?: Date): WorkspaceState {
  const validBrandStatus = (value: unknown): value is BrandRecord["status"] => value === "active" || value === "draft" || value === "archived";
  const currentBrandFor = (savedBrand: BrandRecord): BrandRecord | undefined => {
    const candidates = current.brands.filter((brand) => brand.id === savedBrand.id);
    const exactScope = candidates.filter((brand) => clientIdForBrand(brand) === clientIdForBrand(savedBrand));
    if (exactScope.length === 1) return exactScope[0];
    const exactWorkspace = candidates.filter((brand) => brand.workspaceId === savedBrand.workspaceId);
    if (exactWorkspace.length === 1) return exactWorkspace[0];
    return saved.brands.filter((brand) => brand.id === savedBrand.id).length === 1 && candidates.length === 1 ? candidates[0] : undefined;
  };
  const brands = saved.brands.flatMap((savedBrand) => {
    const currentBrand = currentBrandFor(savedBrand);
    if (!currentBrand) return [];
    const sameScope = clientIdForBrand(currentBrand) === clientIdForBrand(savedBrand);
    const safeName = sameScope && typeof currentBrand.name === "string" && currentBrand.name.trim().length > 0 ? { name: currentBrand.name.trim() } : {};
    const safeStatus = sameScope && validBrandStatus(currentBrand.status) ? { status: currentBrand.status } : {};
    const hasDeletedAt = Object.prototype.hasOwnProperty.call(currentBrand, "deletedAt");
    const safeDeletedAt = sameScope && hasDeletedAt && (currentBrand.deletedAt === undefined || typeof currentBrand.deletedAt === "string") ? { deletedAt: currentBrand.deletedAt } : {};
    return [{ ...savedBrand, ...safeName, ...safeStatus, ...safeDeletedAt }];
  });
  const savedBrandIdCounts = new Map<string, number>();
  saved.brands.forEach((brand) => savedBrandIdCounts.set(brand.id, (savedBrandIdCounts.get(brand.id) ?? 0) + 1));
  const retainedBrandIdCounts = new Map<string, number>();
  brands.forEach((brand) => retainedBrandIdCounts.set(brand.id, (retainedBrandIdCounts.get(brand.id) ?? 0) + 1));
  const retainedBrandScopes = new Set(brands.map((brand) => strategyCatalogScopeKey(clientIdForBrand(brand), brand.id)));
  const recordScopeKey = <T extends { id: string }>(record: T, brandIdOf: (record: T) => string): string | undefined => {
    const brandId = brandIdOf(record);
    const scopedRecord = record as T & { clientId?: unknown; workspaceId?: unknown };
    const clientId = typeof scopedRecord.clientId === "string" && scopedRecord.clientId.trim().length > 0
      ? scopedRecord.clientId
      : typeof scopedRecord.workspaceId === "string" && scopedRecord.workspaceId.trim().length > 0 ? scopedRecord.workspaceId : undefined;
    if (clientId) return strategyCatalogScopeKey(clientId, brandId);
    const identityOwner = brands.find((brand) => brand.id === brandId && legacyAgencyIdentityId(brand) === record.id);
    if (identityOwner) return strategyCatalogScopeKey(clientIdForBrand(identityOwner), identityOwner.id);
    const owners = brands.filter((brand) => brand.id === brandId);
    if (owners.length !== 1 || savedBrandIdCounts.get(brandId) !== 1) return undefined;
    return strategyCatalogScopeKey(clientIdForBrand(owners[0]), owners[0].id);
  };
  const mergeScopedRecords = <T extends { id: string }>(savedRecords: T[] | undefined, currentRecords: T[] | undefined, brandIdOf: (record: T) => string): T[] | undefined => {
    const source = savedRecords ?? currentRecords;
    if (!source) return undefined;
    const currentIds = currentRecords ? new Set(currentRecords.map((record) => record.id)) : undefined;
    return source.filter((record) => {
      const scopeKey = recordScopeKey(record, brandIdOf);
      return Boolean(scopeKey && retainedBrandScopes.has(scopeKey) && (!currentIds || currentIds.has(record.id)));
    });
  };
  const currentWorkspaceFor = (savedWorkspace: WorkspaceState["workspaces"][number]) => current.workspaces.find((workspace) => workspace.id === savedWorkspace.id);
  const workspaces = saved.workspaces.map((savedWorkspace) => {
    const currentWorkspace = currentWorkspaceFor(savedWorkspace);
    if (!currentWorkspace) return savedWorkspace;
    const safeName = typeof currentWorkspace.name === "string" && currentWorkspace.name.trim().length > 0 ? { name: currentWorkspace.name.trim() } : {};
    const brandIds = Array.isArray(currentWorkspace.brandIds)
      ? [...new Set(currentWorkspace.brandIds.filter((brandId) => brands.some((brand) => brand.id === brandId && (brand.workspaceId === savedWorkspace.id || clientIdForBrand(brand) === savedWorkspace.id))))]
      : savedWorkspace.brandIds;
    return { ...savedWorkspace, ...safeName, ...(Array.isArray(currentWorkspace.brandIds) ? { brandIds } : {}) };
  });
  const retainedBrandMapKeys = new Set(brands.flatMap((brand) => [
    ...(retainedBrandIdCounts.get(brand.id) === 1 && savedBrandIdCounts.get(brand.id) === 1 ? [brand.id] : []),
    strategyCatalogScopeKey(clientIdForBrand(brand), brand.id),
  ]));
  const retainBrandMap = <T>(value: Record<string, T> | undefined): Record<string, T> => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => retainedBrandMapKeys.has(key)));
  const activeWorkspaceId = typeof current.activeWorkspaceId === "string" && current.activeWorkspaceId.trim().length > 0 ? current.activeWorkspaceId : saved.activeWorkspaceId;
  const activeBrandId = typeof current.activeBrandId === "string" ? current.activeBrandId : saved.activeBrandId;
  return ensureWorkspaceCatalogs({
    ...saved,
    activeWorkspaceId,
    activeBrandId,
    brandVoiceByBrand: retainBrandMap(saved.brandVoiceByBrand),
    ...(saved.brandVisualTokensByBrand ? { brandVisualTokensByBrand: retainBrandMap(saved.brandVisualTokensByBrand) } : {}),
    brandIdentities: mergeScopedRecords(saved.brandIdentities, current.brandIdentities, (identity) => identity.brandId),
    channelBindings: mergeScopedRecords(saved.channelBindings, current.channelBindings, (binding) => binding.brandId),
    contentRecipes: mergeScopedRecords(saved.contentRecipes, current.contentRecipes, (recipe) => recipe.brandId),
    strategyCatalogsByBrand: { ...mapOrEmpty(saved.strategyCatalogsByBrand), ...mapOrEmpty(current.strategyCatalogsByBrand) },
    scheduleTemplatesByBrand: { ...mapOrEmpty(saved.scheduleTemplatesByBrand), ...mapOrEmpty(current.scheduleTemplatesByBrand) },
    workspaces,
    brands,
  }, now);
}

function mergeWorkspaceState(saved: WorkspaceState, fallback: WorkspaceState, now?: Date): WorkspaceState {
  const mergeBy = <T>(defaults: T[], stored: T[], keyOf: (item: T) => string): T[] => {
    const storedByKey = new Map(stored.map((item) => [keyOf(item), item]));
    return [...defaults.map((item) => ({ ...item, ...storedByKey.get(keyOf(item)) })), ...stored.filter((item) => !defaults.some((defaultItem) => keyOf(defaultItem) === keyOf(item)))];
  };
  const mergeById = <T extends { id: string }>(defaults: T[], stored: T[]): T[] => mergeBy(defaults, stored, (item) => item.id);
  const workspaces = mergeById(fallback.workspaces, saved.workspaces).map((workspace) => {
    const stored = saved.workspaces.find((item) => item.id === workspace.id);
    return stored ? { ...workspace, brandIds: [...new Set([...workspace.brandIds, ...stored.brandIds])], membershipIds: [...new Set([...workspace.membershipIds, ...stored.membershipIds])] } : workspace;
  });
  const brands = mergeBy(fallback.brands, saved.brands, (brand) => `${clientIdForBrand(brand)}\u0000${brand.id}`);
  const memberships = mergeById(fallback.memberships, saved.memberships);
  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === saved.activeWorkspaceId) ? saved.activeWorkspaceId : fallback.activeWorkspaceId;
  const activeBrandId = brands.some((brand) => brand.id === saved.activeBrandId && brand.workspaceId === activeWorkspaceId && !isBrandTrashed(brand))
    ? saved.activeBrandId
    : brands.find((brand) => brand.workspaceId === activeWorkspaceId)?.id ?? fallback.activeBrandId;
  return stripIdentityCatalogs(ensureWorkspaceCatalogs({
    activeWorkspaceId,
    activeBrandId,
    brandVoiceByBrand: { ...fallback.brandVoiceByBrand, ...saved.brandVoiceByBrand },
    brandVisualTokensByBrand: mergeBrandVisualTokensByBrand(saved.brandVisualTokensByBrand, fallback.brandVisualTokensByBrand),
    brandIdentities: saved.brandIdentities ?? fallback.brandIdentities,
    channelBindings: saved.channelBindings ?? fallback.channelBindings,
    contentRecipes: saved.contentRecipes ?? fallback.contentRecipes,
    strategyCatalogsByBrand: saved.strategyCatalogsByBrand ?? fallback.strategyCatalogsByBrand,
    scheduleTemplatesByBrand: saved.scheduleTemplatesByBrand ?? fallback.scheduleTemplatesByBrand,
    workspaces,
    brands,
    memberships,
  }, now));
}

function verifiedLegacyConnections(value: unknown): ChannelConnectionRecord[] {
  const connections = value && typeof value === "object" && Array.isArray((value as { connections?: unknown }).connections)
    ? (value as { connections: unknown[] }).connections
    : [];
  return connections.flatMap((connection): ChannelConnectionRecord[] => {
    if (!connection || typeof connection !== "object") return [];
    const item = connection as Record<string, unknown>;
    const metadata = item.providerMetadata;
    const isOfficial = metadata && typeof metadata === "object" && (metadata as Record<string, unknown>).connectionMode === "official";
    if (!isOfficial || item.status !== "connected" || typeof item.id !== "string" || typeof item.workspaceId !== "string" || typeof item.platform !== "string" || typeof item.accountId !== "string" || typeof item.displayName !== "string") return [];
    if (!(["facebook", "instagram", "tiktok", "youtube"] as string[]).includes(item.platform)) return [];
    return [{
      id: item.id,
      clientId: item.workspaceId,
      platform: item.platform as ChannelConnectionRecord["platform"],
      externalAccountId: item.accountId,
      displayName: item.displayName,
      connectionState: "connected",
      scopes: Array.isArray(item.scopes) ? item.scopes.filter((scope): scope is string => typeof scope === "string") : [],
    }];
  });
}

function normalizeAgencyWorkspaceState(state: WorkspaceState, connections: ChannelConnectionRecord[] = [], now?: Date): WorkspaceState {
  const hydrated = hydrateLegacyAgencyRecords(state);
  const bindings = state.channelBindings ?? state.brands.flatMap((brand) => {
    if (!brand.externalPageId) return [];
    const connection = connections.find((item) => item.clientId === (brand.clientId ?? brand.workspaceId) && item.externalAccountId === brand.externalPageId && item.platform === "facebook");
    const matchingBrands = state.brands.filter((candidate) => candidate.id === brand.id);
    const existingIdentity = state.brandIdentities?.filter((item) => item.brandId === brand.id && item.isDefault);
    const identity = matchingBrands.length === 1 && existingIdentity?.length === 1
      ? existingIdentity[0]
      : hydrated.identities.find((item) => item.id === legacyAgencyIdentityId(brand) && item.isDefault);
    return connection && identity ? [{
      id: `binding-${brand.id}-${connection.id}-${brand.externalPageId}`,
      brandId: brand.id,
      identityId: identity.id,
      connectionId: connection.id,
      targetExternalId: brand.externalPageId,
      targetName: connection.displayName,
      platform: connection.platform,
      state: "connected" as const,
    }] : [];
  });
  const brands = state.brands.map((brand) => ({
    ...brand,
    clientId: brand.clientId ?? brand.workspaceId,
    ...(brand.status === "archived" && !brand.deletedAt && now ? { deletedAt: now.toISOString() } : {}),
  }));
  return stripIdentityCatalogs(ensureWorkspaceCatalogs({
    ...state,
    brands,
    brandIdentities: state.brandIdentities ?? hydrated.identities,
    channelBindings: bindings,
  }, now));
}

function migrateAutomationPlans(plans: unknown): AutomationPlan[] {
  if (!Array.isArray(plans)) return [];
  return plans.flatMap((plan) => {
    if (!plan || typeof plan !== "object") return [];
    const record = plan as AutomationPlan;
    const pageIds = Array.isArray(record.targetPageIds) ? record.targetPageIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
    const bindingIds = Array.isArray(record.bindingIds) ? record.bindingIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : pageIds.map((pageId) => `binding-${record.brandId}-facebook-${pageId}`);
    return [normalizeAutomationPlan({ ...record, ...(bindingIds.length > 0 || record.bindingIds !== undefined ? { bindingIds } : {}) })];
  });
}

export interface SnapshotMigrationOptions {
  migrationTimestamp: string;
  controlPlaneMigrated?: boolean;
}

const LEGACY_RENDERER_PREFERENCE_PREFIXES = [
  ["signalflow", ["safe", "mode"].join("-"), "preference", "v1"].join(".") + ".",
  ["signalflow", ["safe", "mode"].join("-"), "preference", "v2"].join(".") + ".",
];
const OBSOLETE_RENDERER_STATE_PREFIX = ["safe", "mode"].join("");

function isObsoleteRendererStateKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_.-]/g, "");
  return normalized.startsWith(OBSOLETE_RENDERER_STATE_PREFIX)
    || normalized.startsWith(["meta", "safe", "mode"].join(""));
}

function dropObsoleteRendererState<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isObsoleteRendererStateKey(key))) as T;
}

function discardLegacyRendererPreferences(storage: Storage | undefined): void {
  if (!storage || typeof storage.length !== "number" || typeof storage.key !== "function") return;
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key));
    keys.filter((key) => LEGACY_RENDERER_PREFERENCE_PREFIXES.some((prefix) => key.startsWith(prefix))).forEach((key) => storage.removeItem(key));
  } catch {
    // Preference cleanup is best effort; the snapshot remains the source of truth.
  }
}

/** Deterministic legacy migration: IDs and timestamps come from the source snapshot or explicit input only. */
export function migrateLegacySnapshot<T, M = unknown>(raw: unknown, options: SnapshotMigrationOptions): PersistedSnapshot<T, M> {
  const source = dropObsoleteRendererState(stripSensitiveKeys(raw) as Partial<PersistedSnapshot<T, M>> & { schemaVersion?: number });
  const savedAt = migrationTimestamp(source.savedAt, options.migrationTimestamp);
  const workspaceState = source.workspaceState ? normalizeAgencyWorkspaceState(source.workspaceState, verifiedLegacyConnections(source.queue), new Date(savedAt)) : undefined;
  return {
    ...source,
    schemaVersion: PERSISTED_SNAPSHOT_SCHEMA_VERSION,
    savedAt,
    drafts: Array.isArray(source.drafts) ? source.drafts : [],
    selectedPlatforms: Array.isArray(source.selectedPlatforms) ? source.selectedPlatforms : [],
    ...(source.queue ? { queue: source.queue } : {}),
    ...(source.brandSystem ? { brandSystem: source.brandSystem } : {}),
    ...(Array.isArray(source.mediaAssets) ? { mediaAssets: source.mediaAssets } : {}),
    ...(workspaceState ? { workspaceState } : {}),
    ...(Array.isArray(source.contentTemplates) ? { contentTemplates: source.contentTemplates } : {}),
    ...(Array.isArray(source.automationPlans) ? { automationPlans: migrateAutomationPlans(source.automationPlans) } : {}),
    ...(source.automationState ? { automationState: source.automationState } : {}),
    ...(source.controlPlaneMigrated || options.controlPlaneMigrated ? { controlPlaneMigrated: true } : {}),
    strategyCatalogMigrationVersion: PERSISTED_SNAPSHOT_SCHEMA_VERSION,
  };
}

export interface PersistedSnapshotInput<T, M = unknown> {
  [key: string]: unknown;
  drafts: T[];
  selectedPlatforms: string[];
  queue?: PersistedQueueState;
  brandSystem?: BrandSystem;
  mediaAssets?: M[];
  workspaceState?: WorkspaceState;
  contentTemplates?: ContentTemplate[];
  automationPlans?: AutomationPlan[];
  automationState?: AutomationPersistenceState;
  savedAt?: string;
  existingSnapshot?: Partial<PersistedSnapshot<T, M>>;
  controlPlaneMigrated?: boolean;
}

/** Keeps Control-Plane-owned tenancy records intact while still saving renderer recovery data. */
export function preparePersistedSnapshot<T, M = unknown>(input: PersistedSnapshotInput<T, M>): PersistedSnapshot<T, M> {
  const existingSnapshot = input.existingSnapshot ? dropObsoleteRendererState(input.existingSnapshot) : undefined;
  const controlPlaneMigrated = Boolean(existingSnapshot?.controlPlaneMigrated || input.controlPlaneMigrated);
  const savedAt = input.savedAt ?? new Date().toISOString();
  const migrationDate = validSnapshotTimestamp(savedAt) ? new Date(savedAt) : undefined;
  const existingWorkspace = existingSnapshot?.workspaceState;
  const workspaceStateCandidate = controlPlaneMigrated && existingWorkspace && input.workspaceState
    ? mergeControlPlaneWorkspaceState(existingWorkspace, input.workspaceState, migrationDate)
    : controlPlaneMigrated && existingWorkspace
      ? ensureWorkspaceCatalogs(existingWorkspace, migrationDate)
    : input.workspaceState ? normalizeAgencyWorkspaceState({
      ...input.workspaceState,
      strategyCatalogsByBrand: { ...mapOrEmpty(existingWorkspace?.strategyCatalogsByBrand), ...mapOrEmpty(input.workspaceState.strategyCatalogsByBrand) },
      scheduleTemplatesByBrand: { ...mapOrEmpty(existingWorkspace?.scheduleTemplatesByBrand), ...mapOrEmpty(input.workspaceState.scheduleTemplatesByBrand) },
    }, [], migrationDate) : undefined;
  const workspaceState = workspaceStateCandidate ? stripIdentityCatalogs(workspaceStateCandidate) : undefined;
  return {
    ...existingSnapshot,
    schemaVersion: PERSISTED_SNAPSHOT_SCHEMA_VERSION,
    savedAt,
    drafts: input.drafts,
    selectedPlatforms: input.selectedPlatforms,
    ...(input.queue ? { queue: input.queue } : {}),
    ...(input.brandSystem ? { brandSystem: input.brandSystem } : {}),
    ...(input.mediaAssets ? { mediaAssets: input.mediaAssets } : {}),
    ...(workspaceState ? { workspaceState } : {}),
    ...(input.contentTemplates ? { contentTemplates: input.contentTemplates } : {}),
    ...(input.automationPlans ? { automationPlans: migrateAutomationPlans(input.automationPlans) } : {}),
    ...(input.automationState ? { automationState: input.automationState } : {}),
    ...(controlPlaneMigrated ? { controlPlaneMigrated: true } : {}),
    strategyCatalogMigrationVersion: PERSISTED_SNAPSHOT_SCHEMA_VERSION,
  };
}

export function restoreSnapshot<T, M = unknown>(
  fallbackDrafts: T[],
  fallbackPlatforms: string[],
  fallbackBrandSystem?: BrandSystem,
  fallbackMediaAssets?: M[],
  fallbackWorkspaceState?: WorkspaceState,
  fallbackContentTemplates?: ContentTemplate[],
  fallbackAutomationPlans: AutomationPlan[] = [],
  fallbackAutomationState?: AutomationPersistenceState,
  profileId?: string,
): RestoredSnapshot<T, M> {
  const fallback = {
    drafts: fallbackDrafts,
    selectedPlatforms: fallbackPlatforms,
    brandSystem: fallbackBrandSystem,
    mediaAssets: fallbackMediaAssets,
    workspaceState: fallbackWorkspaceState,
    contentTemplates: fallbackContentTemplates,
    automationPlans: fallbackAutomationPlans,
    automationState: fallbackAutomationState,
  };
  try {
    discardLegacyRendererPreferences(window.localStorage);
    const profileKeys = profileId ? [profileSnapshotKey(profileId), ...(profileId === "profile-bavy" ? [STORAGE_KEY, ...LEGACY_KEYS] : [])] : [STORAGE_KEY, ...LEGACY_KEYS];
    const raw = profileKeys.map((key) => window.localStorage.getItem(key)).find(Boolean);
    if (!raw) return fallback;
    const rawSnapshot = stripSensitiveKeys(JSON.parse(raw)) as Partial<PersistedSnapshot<T, M>> & { schemaVersion?: number };
    const snapshot = dropObsoleteRendererState(rawSnapshot.schemaVersion === PERSISTED_SNAPSHOT_SCHEMA_VERSION
      ? rawSnapshot as PersistedSnapshot<T, M>
      : migrateLegacySnapshot<T, M>(rawSnapshot, { migrationTimestamp: migrationTimestamp(rawSnapshot.savedAt, "1970-01-01T00:00:00.000Z") }));
    if (!Array.isArray(snapshot.drafts)) return fallback;
    const savedAt = validSnapshotTimestamp(snapshot.savedAt) ? new Date(snapshot.savedAt) : undefined;
    return {
      ...snapshot,
      drafts: recoverInterruptedMediaOperations(snapshot.drafts),
      selectedPlatforms: Array.isArray(snapshot.selectedPlatforms) && snapshot.selectedPlatforms.length > 0 ? snapshot.selectedPlatforms : fallbackPlatforms,
      queue: snapshot.queue,
      brandSystem: snapshot.brandSystem ?? fallbackBrandSystem,
      mediaAssets: Array.isArray(snapshot.mediaAssets) ? snapshot.mediaAssets : fallbackMediaAssets,
      workspaceState: snapshot.workspaceState && fallbackWorkspaceState ? snapshot.controlPlaneMigrated ? snapshot.workspaceState : mergeWorkspaceState(snapshot.workspaceState, fallbackWorkspaceState, savedAt) : snapshot.workspaceState ?? fallbackWorkspaceState,
      contentTemplates: Array.isArray(snapshot.contentTemplates) ? snapshot.contentTemplates : fallbackContentTemplates,
      automationPlans: Array.isArray(snapshot.automationPlans) ? migrateAutomationPlans(snapshot.automationPlans) : fallbackAutomationPlans,
      automationState: applyCreativeCheckpoints(migrateAutomationState(snapshot.automationState, fallbackAutomationState), profileId),
      controlPlaneMigrated: snapshot.controlPlaneMigrated === true,
      strategyCatalogMigrationVersion: snapshot.strategyCatalogMigrationVersion,
    };
  } catch {
    return fallback;
  }
}

export function persistSnapshot<T, M = unknown>(
  drafts: T[],
  selectedPlatforms: string[],
  queue?: PersistedQueueState,
  brandSystem?: BrandSystem,
  mediaAssets?: M[],
  workspaceState?: WorkspaceState,
  contentTemplates?: ContentTemplate[],
  automationPlans: AutomationPlan[] = [],
  automationState?: AutomationPersistenceState,
  controlPlaneMigrated = false,
  profileId?: string,
): void {
  let existingSnapshot: Partial<PersistedSnapshot<T, M>> | undefined;
  try {
    const raw = window.localStorage.getItem(profileId ? profileSnapshotKey(profileId) : STORAGE_KEY);
    if (raw) existingSnapshot = migrateLegacySnapshot<T, M>(JSON.parse(raw), { migrationTimestamp: "1970-01-01T00:00:00.000Z" });
  } catch {
    existingSnapshot = undefined;
  }
  const snapshot = preparePersistedSnapshot({ drafts, selectedPlatforms, queue, brandSystem, mediaAssets, workspaceState, contentTemplates, automationPlans, automationState, existingSnapshot, controlPlaneMigrated });
  snapshot.controlPlaneMigrated = controlPlaneMigrated || Boolean(existingSnapshot?.controlPlaneMigrated);
  const safeSnapshot = stripSensitiveKeys(snapshot) as PersistedSnapshot<T, M>;
  try {
    window.localStorage.setItem(profileId ? profileSnapshotKey(profileId) : STORAGE_KEY, JSON.stringify(safeSnapshot));
  } catch {
    // A full backend/store adapter will report persistence failures explicitly.
  }
}

export function clearPersistedSnapshot(profileId?: string): void {
  window.localStorage.removeItem(profileId ? profileSnapshotKey(profileId) : STORAGE_KEY);
  LEGACY_KEYS.forEach((key) => window.localStorage.removeItem(key));
}

/** Export boundary for migration/recovery files; strips credential-shaped keys before leaving the renderer. */
export function sanitizeSnapshotForExport<T, M = unknown>(snapshot: PersistedSnapshot<T, M>): PersistedSnapshot<T, M> {
  return stripExportOnlyKeys(snapshot) as PersistedSnapshot<T, M>;
}
