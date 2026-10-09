import type { WorkspaceState } from "./workspaceDomain";

export type BrandTrashPreview = {
  brandId: string;
  brandName: string;
  draftCount: number;
  planCount: number;
  unsentScheduleCount: number;
  sharedMediaCount: number;
  countsKnown?: boolean;
  clientId?: string;
  brandStatus?: string;
  deletedAt?: string | null;
  blockers?: string[];
  observedAt?: string;
  revision?: string;
  source?: "local" | "control_plane";
};

export type BrandImpactPreview = {
  clientId: string;
  brandId: string;
  brandName: string;
  brandStatus: string;
  deletedAt?: string | null;
  counts: { draftCount: number; planCount: number; unsentScheduleCount: number; sharedMediaCount: number };
  blockers: string[];
  observedAt: string;
  revision: string;
};

/** Only a durable Control Plane response can unlock destructive Brand deletion. */
export function isAuthoritativeBrandImpact(preview: BrandTrashPreview | undefined): boolean {
  return preview?.source === "control_plane" && preview.countsKnown === true;
}

export type BrandDeleteScope = {
  profileId: string;
  profileRevision: number;
  clientId: string;
  brandId: string;
  brandName: string;
  impactRevision?: string;
};

export type BrandLifecycleOperation = "permanent-delete" | "restore";

export type BrandLifecycleRequestToken = BrandDeleteScope & {
  operation: BrandLifecycleOperation;
  requestId: string;
  scopeKey: string;
};

export type BrandDeleteRequestToken = BrandLifecycleRequestToken & { operation: "permanent-delete" };
export type BrandRestoreRequestToken = BrandLifecycleRequestToken & { operation: "restore" };

export type BrandDeleteOutcome = {
  status: "pending" | "acknowledged" | "rejected" | "unknown";
  requestId?: string;
  operationId?: string;
  code?: string;
  message?: string;
};

export type BrandDeleteReconciliation =
  | { status: "completed"; ack: Record<string, unknown> }
  | { status: "pending" }
  | { status: "rejected"; code: string }
  | { status: "unknown" };

export type BrandDeleteModalState = {
  brandId?: string;
  confirmation: string;
  pending: boolean;
  requestVersion: number;
};

export type BrandDeleteModalEvent =
  | { type: "open"; brandId: string }
  | { type: "input"; confirmation: string }
  | { type: "begin"; expectedBrandId: string; expectedBrandName: string }
  | { type: "close"; openerConnected: boolean }
  | { type: "outcome"; requestVersion: number; outcome: BrandDeleteOutcome };

export type BrandDeleteModalTransition = {
  state: BrandDeleteModalState;
  dispatch?: { brandId: string; confirmation: string; requestVersion: number };
  focusTarget?: "opener" | "fallback";
};

/** Shared Settings modal transition seam; the component and executable tests use the same event rules. */
export function transitionBrandDeleteModal(state: BrandDeleteModalState, event: BrandDeleteModalEvent): BrandDeleteModalTransition {
  if (event.type === "open") return { state: { brandId: event.brandId, confirmation: "", pending: false, requestVersion: state.requestVersion + 1 } };
  if (event.type === "input") return { state: state.pending ? state : { ...state, confirmation: event.confirmation } };
  if (event.type === "begin") {
    if (state.pending || state.brandId !== event.expectedBrandId || state.confirmation !== event.expectedBrandName) return { state };
    return { state: { ...state, pending: true }, dispatch: { brandId: state.brandId, confirmation: state.confirmation, requestVersion: state.requestVersion } };
  }
  if (event.type === "close") {
    if (state.pending) return { state };
    return { state: { brandId: undefined, confirmation: "", pending: false, requestVersion: state.requestVersion + 1 }, focusTarget: event.openerConnected ? "opener" : "fallback" };
  }
  if (event.requestVersion !== state.requestVersion) return { state };
  if (event.outcome.status === "acknowledged") return { state: { brandId: undefined, confirmation: "", pending: false, requestVersion: state.requestVersion + 1 }, focusTarget: "fallback" };
  return { state: { ...state, pending: false } };
}

/** One lock covers every Brand lifecycle operation for one runtime scope. */
export function brandLifecycleScopeKey(scope: Pick<BrandDeleteScope, "profileId" | "profileRevision" | "clientId" | "brandId">): string {
  return JSON.stringify([scope.profileId, scope.profileRevision, scope.clientId, scope.brandId]);
}

/** Compatibility name retained for delete callers; operation is intentionally excluded from the key. */
export function brandDeleteScopeKey(scope: Pick<BrandDeleteScope, "profileId" | "profileRevision" | "clientId" | "brandId">, _operation = "permanent-delete"): string {
  return brandLifecycleScopeKey(scope);
}

export function beginBrandLifecycleRequest(lock: Map<string, string>, scope: BrandDeleteScope, operation: BrandLifecycleOperation, requestId = `${operation === "restore" ? "brand-restore" : "brand-delete"}-${scope.brandId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`): BrandLifecycleRequestToken | undefined {
  const scopeKey = brandLifecycleScopeKey(scope);
  if (lock.has(scopeKey)) return undefined;
  const token: BrandLifecycleRequestToken = { ...scope, operation, requestId, scopeKey };
  lock.set(scopeKey, requestId);
  return token;
}

export function beginBrandDeleteRequest(lock: Map<string, string>, scope: BrandDeleteScope, requestId?: string): BrandDeleteRequestToken | undefined {
  const token = beginBrandLifecycleRequest(lock, scope, "permanent-delete", requestId);
  return token?.operation === "permanent-delete" ? token as BrandDeleteRequestToken : undefined;
}

export function endBrandLifecycleRequest(lock: Map<string, string>, token: BrandLifecycleRequestToken): void {
  if (lock.get(token.scopeKey) === token.requestId) lock.delete(token.scopeKey);
}

export function endBrandDeleteRequest(lock: Map<string, string>, token: BrandDeleteRequestToken): void {
  endBrandLifecycleRequest(lock, token);
}

function recordField(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined) return record[key];
  return undefined;
}

function recordScopeValues(value: unknown): { brandIds: string[]; clientIds: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { brandIds: [], clientIds: [] };
  const record = value as Record<string, unknown>;
  const brand = recordField(record, "brandId", "brand_id") ?? recordField(record, "id");
  const clientValues = ["clientId", "client_id", "workspaceId", "workspace_id"]
    .map((key) => record[key])
    .filter((item): item is string => typeof item === "string" && item.length > 0);
  return { brandIds: typeof brand === "string" ? [brand] : [], clientIds: clientValues };
}

/** Match a record to both source IDs. Records without a client field are accepted only when their Brand ID has one unambiguous owner. */
export function brandDeleteRecordMatchesScope(value: unknown, scope: Pick<BrandDeleteScope, "clientId" | "brandId">, ownerClientIds: readonly string[] = []): boolean {
  const record = recordScopeValues(value);
  if (!record.brandIds.includes(scope.brandId)) return false;
  if (record.clientIds.length > 0) return record.clientIds.every((clientId) => clientId === scope.clientId);
  return ownerClientIds.length === 1 && ownerClientIds[0] === scope.clientId;
}

/** Validate the durable response identity before any local record is removed. */
export function validateBrandDeleteAck(value: unknown, scope: BrandDeleteScope, expectedOperationId?: string): { ok: true; operationId?: string } | { ok: false; code: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "BRAND_DELETE_ACK_INVALID" };
  const input = value as Record<string, unknown>;
  if (input.status !== "deleted") return { ok: false, code: "BRAND_DELETE_ACK_STATUS_INVALID" };
  const nested = input.identity && typeof input.identity === "object" && !Array.isArray(input.identity) ? input.identity as Record<string, unknown> : {};
  const rawBrandId = recordField(input, "brandId", "brand_id", "id") ?? recordField(nested, "brandId", "brand_id", "id");
  const rawClientId = recordField(input, "clientId", "client_id") ?? recordField(nested, "clientId", "client_id");
  if (typeof rawBrandId !== "string" || rawBrandId !== scope.brandId || typeof rawClientId !== "string" || rawClientId !== scope.clientId) return { ok: false, code: "BRAND_DELETE_ACK_SCOPE_MISMATCH" };
  const rawName = recordField(input, "brandName", "name") ?? recordField(nested, "brandName", "name");
  if (rawName !== undefined && (typeof rawName !== "string" || rawName !== scope.brandName)) return { ok: false, code: "BRAND_DELETE_ACK_NAME_MISMATCH" };
  const rawOperationId = recordField(input, "operationId", "operation_id") ?? recordField(nested, "operationId", "operation_id");
  if (rawOperationId !== undefined && (typeof rawOperationId !== "string" || !rawOperationId.trim())) return { ok: false, code: "BRAND_DELETE_ACK_OPERATION_INVALID" };
  if (expectedOperationId !== undefined && rawOperationId !== expectedOperationId) return { ok: false, code: "BRAND_DELETE_ACK_OPERATION_MISMATCH" };
  return { ok: true, ...(typeof rawOperationId === "string" ? { operationId: rawOperationId } : {}) };
}

/** Convert persisted deletion-operation rows into a completion only when their scope is exact. */
export function reconcileBrandDeleteOperations(rows: readonly unknown[], scope: BrandDeleteScope): BrandDeleteReconciliation {
  const matching = rows.filter((value): value is Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const brandId = recordField(record, "brandId", "brand_id");
    const clientId = recordField(record, "clientId", "client_id");
    return brandId === scope.brandId && clientId === scope.clientId;
  });
  const operation = matching[matching.length - 1];
  if (!operation) return { status: "unknown" };
  const state = String(recordField(operation, "state") ?? "").toLowerCase();
  if (["pending", "running", "started", "reconciling"].includes(state)) return { status: "pending" };
  if (["failed", "rejected", "cancelled", "canceled"].includes(state)) return { status: "rejected", code: "BRAND_DELETE_RECONCILED_FAILURE" };
  if (!["completed", "complete", "deleted"].includes(state)) return { status: "unknown" };
  const operationId = recordField(operation, "id", "operationId", "operation_id");
  if (typeof operationId !== "string" || !operationId.trim()) return { status: "unknown" };
  const ack = { status: "deleted", id: scope.brandId, brandId: scope.brandId, clientId: scope.clientId, name: scope.brandName, operationId };
  const validated = validateBrandDeleteAck(ack, scope, operationId);
  return validated.ok ? { status: "completed", ack } : { status: "unknown" };
}

export const BRAND_DELETE_REQUEST_DEADLINE_MS = 30_000;

function defaultBrandDeleteUnknownError(error: unknown): boolean {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return candidate.name === "AbortError" || code === "CONTROL_PLANE_UNREACHABLE" || status === 408 || status === 504 || /timeout|timed out|network|fetch failed|connection reset/i.test(`${code} ${message}`);
}

async function withBrandDeleteDeadline<T>(task: Promise<T>, deadlineMs: number): Promise<T> {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return await task;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("Brand delete request timed out."), { code: "BRAND_DELETE_TIMEOUT", status: 504 })), deadlineMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runBrandDeleteLifecycle(input: {
  lock: Map<string, string>;
  unknownRequests: Map<string, BrandLifecycleRequestToken>;
  scope: BrandDeleteScope;
  confirmation: string;
  requestId?: string;
  dispatch: (token: BrandDeleteRequestToken) => Promise<unknown>;
  reconcile: (token: BrandDeleteRequestToken) => Promise<unknown | undefined>;
  preDispatchReconcile?: (token: BrandDeleteRequestToken) => Promise<BrandDeleteReconciliation | undefined>;
  commit: (token: BrandDeleteRequestToken, ack: Record<string, unknown>) => void | Promise<void>;
  isUnknownError?: (error: unknown) => boolean;
  deadlineMs?: number;
  reconciliationDeadlineMs?: number;
  onRequestStarted?: (token: BrandDeleteRequestToken) => void;
  onReconciliationStarted?: (token: BrandDeleteRequestToken) => void;
}): Promise<BrandDeleteOutcome> {
  if (input.confirmation !== input.scope.brandName) return { status: "rejected", code: "BRAND_NAME_CONFIRMATION_REQUIRED" };
  const token = beginBrandDeleteRequest(input.lock, input.scope, input.requestId);
  if (!token) return { status: "pending", code: "BRAND_DELETE_ALREADY_IN_FLIGHT" };
  input.onRequestStarted?.(token);
  const unknownError = input.isUnknownError ?? defaultBrandDeleteUnknownError;
  const reconcile = async (): Promise<BrandDeleteOutcome> => {
    input.onReconciliationStarted?.(token);
    try {
      const raw = await withBrandDeleteDeadline(input.reconcile(token), input.reconciliationDeadlineMs ?? Math.min(input.deadlineMs ?? BRAND_DELETE_REQUEST_DEADLINE_MS, 5_000));
      if (raw === undefined) return { status: "unknown", requestId: token.requestId, code: "BRAND_DELETE_OUTCOME_UNKNOWN" };
      const validated = validateBrandDeleteAck(raw, token);
      if (!validated.ok) {
        input.unknownRequests.delete(token.scopeKey);
        return { status: "rejected", requestId: token.requestId, code: validated.code };
      }
      await input.commit(token, raw as Record<string, unknown>);
      input.unknownRequests.delete(token.scopeKey);
      return { status: "acknowledged", requestId: token.requestId, ...(validated.operationId ? { operationId: validated.operationId } : {}) };
    } catch (error) {
      if (!unknownError(error)) {
        input.unknownRequests.delete(token.scopeKey);
        return { status: "rejected", requestId: token.requestId, code: error instanceof Error ? error.message : "BRAND_DELETE_RECONCILIATION_FAILED" };
      }
      return { status: "unknown", requestId: token.requestId, code: "BRAND_DELETE_OUTCOME_UNKNOWN" };
    }
  };
  try {
    const uncertainLifecycle = input.unknownRequests.get(token.scopeKey);
    if (uncertainLifecycle?.operation === "restore") {
      return { status: "pending", requestId: uncertainLifecycle.requestId, code: "BRAND_RESTORE_OUTCOME_UNKNOWN" };
    }
    if (uncertainLifecycle?.operation === "permanent-delete") {
      const outcome = await reconcile();
      if (outcome.status === "unknown") input.unknownRequests.set(token.scopeKey, uncertainLifecycle ?? token);
      return outcome;
    }
    if (input.preDispatchReconcile) {
      let preflight: BrandDeleteReconciliation | undefined;
      try {
        preflight = await withBrandDeleteDeadline(input.preDispatchReconcile(token), input.reconciliationDeadlineMs ?? Math.min(input.deadlineMs ?? BRAND_DELETE_REQUEST_DEADLINE_MS, 5_000));
      } catch (error) {
        if (!unknownError(error)) return { status: "rejected", requestId: token.requestId, code: error instanceof Error ? error.message : "BRAND_DELETE_RECONCILIATION_FAILED" };
        input.unknownRequests.set(token.scopeKey, token);
        return { status: "unknown", requestId: token.requestId, code: "BRAND_DELETE_OUTCOME_UNKNOWN" };
      }
      if (preflight?.status === "pending") {
        input.unknownRequests.set(token.scopeKey, token);
        return { status: "pending", requestId: token.requestId, code: "BRAND_DELETE_RECONCILIATION_PENDING" };
      }
      if (preflight?.status === "rejected") {
        input.unknownRequests.delete(token.scopeKey);
        return { status: "rejected", requestId: token.requestId, code: preflight.code };
      }
      if (preflight?.status === "unknown") {
        input.unknownRequests.set(token.scopeKey, token);
        return { status: "unknown", requestId: token.requestId, code: "BRAND_DELETE_OUTCOME_UNKNOWN" };
      }
      if (preflight?.status === "completed") {
        const validated = validateBrandDeleteAck(preflight.ack, token);
        if (!validated.ok) return { status: "rejected", requestId: token.requestId, code: validated.code };
        await input.commit(token, preflight.ack);
        input.unknownRequests.delete(token.scopeKey);
        return { status: "acknowledged", requestId: token.requestId, ...(validated.operationId ? { operationId: validated.operationId } : {}) };
      }
    }
    let raw: unknown;
    try {
      raw = await withBrandDeleteDeadline(input.dispatch(token), input.deadlineMs ?? BRAND_DELETE_REQUEST_DEADLINE_MS);
    } catch (error) {
      if (!unknownError(error)) return { status: "rejected", requestId: token.requestId, code: error instanceof Error ? error.message : "BRAND_DELETE_REJECTED" };
      const outcome = await reconcile();
      if (outcome.status === "unknown") input.unknownRequests.set(token.scopeKey, uncertainLifecycle ?? token);
      return outcome;
    }
    const validated = validateBrandDeleteAck(raw, token);
    if (!validated.ok) return { status: "rejected", requestId: token.requestId, code: validated.code };
    await input.commit(token, raw as Record<string, unknown>);
    return { status: "acknowledged", requestId: token.requestId, ...(validated.operationId ? { operationId: validated.operationId } : {}) };
  } finally {
    endBrandDeleteRequest(input.lock, token);
  }
}

export function validateBrandRestoreAck(value: unknown, scope: BrandDeleteScope): { ok: true } | { ok: false; code: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "BRAND_RESTORE_ACK_INVALID" };
  const input = value as Record<string, unknown>;
  const nested = input.identity && typeof input.identity === "object" && !Array.isArray(input.identity) ? input.identity as Record<string, unknown> : {};
  const rawBrandId = recordField(input, "brandId", "brand_id", "id") ?? recordField(nested, "brandId", "brand_id", "id");
  const rawClientId = recordField(input, "clientId", "client_id") ?? recordField(nested, "clientId", "client_id");
  if (rawBrandId !== scope.brandId || rawClientId !== scope.clientId) return { ok: false, code: "BRAND_RESTORE_ACK_SCOPE_MISMATCH" };
  if (input.status !== "draft") return { ok: false, code: "BRAND_RESTORE_ACK_STATUS_INVALID" };
  return { ok: true };
}

export async function runBrandRestoreLifecycle(input: {
  lock: Map<string, string>;
  unknownRequests: Map<string, BrandLifecycleRequestToken>;
  scope: BrandDeleteScope;
  dispatch: (token: BrandRestoreRequestToken) => Promise<unknown>;
  reconcile?: (token: BrandRestoreRequestToken) => Promise<unknown | undefined>;
  commit: (token: BrandRestoreRequestToken, ack: Record<string, unknown>) => void | Promise<void>;
  isCurrent?: (token: BrandRestoreRequestToken) => boolean;
  isUnknownError?: (error: unknown) => boolean;
  deadlineMs?: number;
  reconciliationDeadlineMs?: number;
  onRequestStarted?: (token: BrandRestoreRequestToken) => void;
  onReconciliationStarted?: (token: BrandRestoreRequestToken) => void;
}): Promise<BrandDeleteOutcome> {
  const scopeKey = brandLifecycleScopeKey(input.scope);
  const uncertain = input.unknownRequests.get(scopeKey);
  if (uncertain) {
    if (uncertain.operation !== "restore" || !input.reconcile) return { status: "pending", requestId: uncertain.requestId, code: "BRAND_LIFECYCLE_OUTCOME_UNKNOWN" };
    if (input.lock.has(scopeKey)) return { status: "pending", requestId: uncertain.requestId, code: "BRAND_LIFECYCLE_ALREADY_IN_FLIGHT" };
    input.onReconciliationStarted?.(uncertain as BrandRestoreRequestToken);
    try {
      const restoreToken = uncertain as BrandRestoreRequestToken;
      const raw = await withBrandDeleteDeadline(input.reconcile(restoreToken), input.reconciliationDeadlineMs ?? Math.min(input.deadlineMs ?? BRAND_DELETE_REQUEST_DEADLINE_MS, 5_000));
      if (raw === undefined) return { status: "unknown", requestId: uncertain.requestId, code: "BRAND_RESTORE_OUTCOME_UNKNOWN" };
      const validated = validateBrandRestoreAck(raw, restoreToken);
      if (!validated.ok || input.isCurrent?.(restoreToken) === false) return { status: "rejected", requestId: uncertain.requestId, code: !validated.ok ? validated.code : "BRAND_RESTORE_SCOPE_CHANGED" };
      await input.commit(restoreToken, raw as Record<string, unknown>);
      input.unknownRequests.delete(scopeKey);
      return { status: "acknowledged", requestId: uncertain.requestId };
    } catch (error) {
      const isUnknown = input.isUnknownError ? input.isUnknownError(error) : defaultBrandDeleteUnknownError(error);
      return isUnknown ? { status: "unknown", requestId: uncertain.requestId, code: "BRAND_RESTORE_OUTCOME_UNKNOWN" } : { status: "rejected", requestId: uncertain.requestId, code: error instanceof Error ? error.message : "BRAND_RESTORE_RECONCILIATION_FAILED" };
    }
  }
  const token = beginBrandLifecycleRequest(input.lock, input.scope, "restore");
  if (!token || token.operation !== "restore") return { status: "pending", code: "BRAND_LIFECYCLE_ALREADY_IN_FLIGHT" };
  const restoreToken = token as BrandRestoreRequestToken;
  input.onRequestStarted?.(restoreToken);
  const unknownError = input.isUnknownError ?? defaultBrandDeleteUnknownError;
  const reconcile = async (): Promise<BrandDeleteOutcome> => {
    input.onReconciliationStarted?.(restoreToken);
    if (!input.reconcile) return { status: "unknown", requestId: restoreToken.requestId, code: "BRAND_RESTORE_OUTCOME_UNKNOWN" };
    try {
      const raw = await withBrandDeleteDeadline(input.reconcile(restoreToken), input.reconciliationDeadlineMs ?? Math.min(input.deadlineMs ?? BRAND_DELETE_REQUEST_DEADLINE_MS, 5_000));
      if (raw === undefined) return { status: "unknown", requestId: restoreToken.requestId, code: "BRAND_RESTORE_OUTCOME_UNKNOWN" };
      const validated = validateBrandRestoreAck(raw, restoreToken);
      if (!validated.ok || input.isCurrent?.(restoreToken) === false) return { status: "rejected", requestId: restoreToken.requestId, code: !validated.ok ? validated.code : "BRAND_RESTORE_SCOPE_CHANGED" };
      await input.commit(restoreToken, raw as Record<string, unknown>);
      input.unknownRequests.delete(restoreToken.scopeKey);
      return { status: "acknowledged", requestId: restoreToken.requestId };
    } catch (error) {
      if (!unknownError(error)) {
        input.unknownRequests.delete(restoreToken.scopeKey);
        return { status: "rejected", requestId: restoreToken.requestId, code: error instanceof Error ? error.message : "BRAND_RESTORE_REJECTED" };
      }
      return { status: "unknown", requestId: restoreToken.requestId, code: "BRAND_RESTORE_OUTCOME_UNKNOWN" };
    }
  };
  try {
    let raw: unknown;
    try {
      raw = await withBrandDeleteDeadline(input.dispatch(restoreToken), input.deadlineMs ?? BRAND_DELETE_REQUEST_DEADLINE_MS);
    } catch (error) {
      if (!unknownError(error)) return { status: "rejected", requestId: restoreToken.requestId, code: error instanceof Error ? error.message : "BRAND_RESTORE_REJECTED" };
      const outcome = await reconcile();
      if (outcome.status === "unknown") input.unknownRequests.set(restoreToken.scopeKey, restoreToken);
      return outcome;
    }
    const validated = validateBrandRestoreAck(raw, restoreToken);
    if (!validated.ok) return { status: "rejected", requestId: restoreToken.requestId, code: validated.code };
    if (input.isCurrent?.(restoreToken) === false) return { status: "rejected", requestId: restoreToken.requestId, code: "BRAND_RESTORE_SCOPE_CHANGED" };
    await input.commit(restoreToken, raw as Record<string, unknown>);
    return { status: "acknowledged", requestId: restoreToken.requestId };
  } finally {
    endBrandLifecycleRequest(input.lock, restoreToken);
  }
}

type BrandTrashContext = {
  clientId?: string;
  drafts?: Array<{ brandId?: string; deletedAt?: string }>;
  plans?: Array<{ brandId?: string }>;
  publications?: Array<{ brandId?: string; state?: string }>;
  assets?: Array<{ id?: string | number; brandId?: string; distribution?: string; shared?: boolean; sharedBrandIds?: string[] }>;
  countsKnown?: boolean;
};

const TERMINAL_PUBLICATION_STATES = new Set(["published", "canceled", "cancelled", "failed", "permanent_error", "approval_failed", "blocked"]);

export function buildBrandTrashPreview(state: WorkspaceState, brandId: string, context: BrandTrashContext = {}): BrandTrashPreview {
  const brand = state.brands.find((candidate) => candidate.id === brandId && (!context.clientId || (candidate.clientId ?? candidate.workspaceId) === context.clientId));
  if (!brand) throw new Error("BRAND_NOT_FOUND");
  return {
    brandId,
    brandName: brand.name,
    clientId: brand.clientId ?? brand.workspaceId,
    brandStatus: brand.status,
    deletedAt: brand.deletedAt ?? null,
    draftCount: context.drafts?.filter((draft) => draft.brandId === brandId && !draft.deletedAt).length ?? 0,
    planCount: context.plans?.filter((plan) => plan.brandId === brandId).length ?? 0,
    unsentScheduleCount: context.publications?.filter((publication) => publication.brandId === brandId && !TERMINAL_PUBLICATION_STATES.has(publication.state ?? "")).length ?? 0,
    sharedMediaCount: context.assets?.filter((asset) => asset.brandId === brandId && (asset.shared === true || asset.distribution === "universal" || (asset.sharedBrandIds?.length ?? 0) > 0)).length ?? 0,
    countsKnown: context.countsKnown ?? true,
  };
}

export function trashBrand(state: WorkspaceState, brandId: string, preview: Partial<BrandTrashPreview> = {}): { state: WorkspaceState; preview: BrandTrashPreview } {
  const brand = state.brands.find((candidate) => candidate.id === brandId);
  if (!brand) throw new Error("BRAND_NOT_FOUND");
  const deletedAt = brand.deletedAt ?? new Date().toISOString();
  const nextActiveBrandId = state.activeBrandId === brandId
    ? state.brands.find((candidate) => candidate.workspaceId === brand.workspaceId && candidate.id !== brandId && !candidate.deletedAt)?.id ?? ""
    : state.activeBrandId;
  return {
    state: { ...state, activeBrandId: nextActiveBrandId, brands: state.brands.map((candidate) => candidate.id === brandId ? { ...candidate, status: "archived" as const, deletedAt } : candidate) },
    preview: { brandId, brandName: brand.name, draftCount: preview.draftCount ?? 0, planCount: preview.planCount ?? 0, unsentScheduleCount: preview.unsentScheduleCount ?? 0, sharedMediaCount: preview.sharedMediaCount ?? 0, countsKnown: preview.countsKnown ?? true },
  };
}

export function restoreBrand(state: WorkspaceState, brandId: string): WorkspaceState {
  const canRestore = state.brands.some((brand) => brand.id === brandId && Boolean(brand.deletedAt));
  if (!canRestore) return state;
  const activeBrandStillExists = state.brands.some((brand) => brand.id === state.activeBrandId && !brand.deletedAt && brand.id !== brandId);
  return { ...state, activeBrandId: activeBrandStillExists ? state.activeBrandId : brandId, brands: state.brands.map((brand) => brand.id === brandId && Boolean(brand.deletedAt) ? { ...brand, status: "draft" as const, deletedAt: undefined } : brand) };
}

/** Apply an already-authoritative delete to the latest local snapshot without changing another scope. */
export function removeBrandRecordsForScope(state: WorkspaceState, scope: Pick<BrandDeleteScope, "brandId" | "clientId">): WorkspaceState {
  const brand = state.brands.find((candidate) => candidate.id === scope.brandId && (candidate.clientId ?? candidate.workspaceId) === scope.clientId);
  if (!brand) return state;
  const ownerClientIds = [...new Set(state.brands.filter((candidate) => candidate.id === scope.brandId).map((candidate) => candidate.clientId ?? candidate.workspaceId))];
  const matches = (value: unknown) => brandDeleteRecordMatchesScope(value, scope, ownerClientIds);
  const workspace = state.workspaces.find((candidate) => candidate.id === brand.workspaceId);
  const nextBrands = state.brands.filter((candidate) => !matches(candidate));
  const nextActiveBrandId = state.activeBrandId === scope.brandId && state.activeWorkspaceId === brand.workspaceId
    ? nextBrands.find((candidate) => candidate.workspaceId === brand.workspaceId && !candidate.deletedAt)?.id ?? ""
    : state.activeBrandId;
  const nextWorkspaceState = workspace ? {
    ...state,
    activeBrandId: nextActiveBrandId,
    workspaces: state.workspaces.map((candidate) => candidate.id === workspace.id ? { ...candidate, brandIds: candidate.brandIds.filter((id) => !(id === scope.brandId && candidate.id === scope.clientId)) } : candidate),
  } : { ...state, activeBrandId: nextActiveBrandId };
  return {
    ...nextWorkspaceState,
    brands: nextBrands,
    brandIdentities: (state.brandIdentities ?? []).filter((identity) => !matches(identity)),
    channelBindings: (state.channelBindings ?? []).filter((binding) => !matches(binding)),
    contentRecipes: (state.contentRecipes ?? []).filter((recipe) => !matches(recipe)),
    brandVoiceByBrand: ownerClientIds.length === 1 ? Object.fromEntries(Object.entries(state.brandVoiceByBrand).filter(([id]) => id !== scope.brandId)) : state.brandVoiceByBrand,
    brandVisualTokensByBrand: ownerClientIds.length === 1 ? Object.fromEntries(Object.entries(state.brandVisualTokensByBrand ?? {}).filter(([id]) => id !== scope.brandId)) : state.brandVisualTokensByBrand,
  };
}

export function permanentlyDeleteBrand(state: WorkspaceState, brandId: string, confirmation: string, clientId?: string): { ok: true; state: WorkspaceState } | { ok: false; code: "BRAND_NAME_CONFIRMATION_REQUIRED" | "BRAND_NOT_FOUND" } {
  const brand = state.brands.find((candidate) => candidate.id === brandId && (!clientId || (candidate.clientId ?? candidate.workspaceId) === clientId));
  if (!brand) return { ok: false, code: "BRAND_NOT_FOUND" };
  if (!brand.deletedAt || confirmation !== brand.name) return { ok: false, code: "BRAND_NAME_CONFIRMATION_REQUIRED" };
  return { ok: true, state: removeBrandRecordsForScope(state, { brandId, clientId: brand.clientId ?? brand.workspaceId }) };
}
