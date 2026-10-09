import { profileRuntimeHeaders } from "./nativeRuntime";
import type { BrandImpactPreview } from "./brandTrash";
import type { MediaAssetCompensationRequest, MediaAssetCompensationResult } from "./contentRunMedia";
export type { BrandImpactPreview } from "./brandTrash";

export type ControlPlaneHealth = {
  ok: boolean;
  service: string;
  profileId?: string | null;
  runtimeId?: string | null;
  configuredProviders: string[];
  tokenVault?: "development-memory-only" | "encrypted" | string;
  livePublishingReady?: boolean;
  dataAsOf?: string | null;
  workerReconciledAt?: string | null;
};

export type MetaOAuthStartRequest = {
  workspaceId: string;
  redirectUri: string;
};

export type MetaOAuthStartResponse = {
  authorizeUrl: string;
  provider: "meta";
  state: string;
  expiresAt: string;
};

export type MetaOAuthExchangeRequest = {
  workspaceId: string;
  code: string;
  state: string;
  redirectUri: string;
};

export type MetaOAuthExchangeResponse = {
  provider: "meta";
  status: "connected";
  storedInVault: boolean;
  expiresAt?: number | null;
  accountHints?: Array<{ id: string; name?: string; kind: "page" | "instagram_business" }>;
};

export type AgencyEntity = "clients" | "brands" | "identities" | "connections" | "bindings" | "generation-profiles" | "content-runs" | "target-publications" | "provider-configurations" | "knowledge-items" | "prompt-blueprints" | "research-evidence" | "trend-signals" | "analytics-events" | "audit-events" | "media-assets" | "automation-plans" | "automation-runs";
type AgencyCreateEntity = Exclude<AgencyEntity, "target-publications">;
type AgencyCrudEntity = Exclude<AgencyEntity, "connections" | "target-publications">;
export type AgencyMigrationInput = {
  clients: Array<Record<string, unknown>>;
  brands: Array<Record<string, unknown>>;
  identities: Array<Record<string, unknown>>;
  connections: Array<Record<string, unknown>>;
  bindings: Array<Record<string, unknown>>;
  migrationActor?: BrandLifecycleActor;
  actorBindings?: Array<{ brandId: string } & BrandLifecycleActor>;
};
export type AgencyMigrationResult = { controlPlaneMigrated: true; clientCount: number; brandCount: number; identityCount: number; bindingCount: number };
export type AgencyRecord = Record<string, unknown>;
export type BrandLifecycleActor = { actorUserId: string; role: "owner" | "admin"; capability: "manage_brand"; confirmation?: string };
export type ResearchEvidenceApprovalRequest = { brandId: string; actor: BrandLifecycleActor };

export const CONTROL_PLANE_REQUEST_TIMEOUT_MS = 30_000;

export type ControlPlaneClientOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const SENSITIVE_INTENT_KEYS = new Set(["accesstoken", "refreshtoken", "authorization", "cookie", "cookies", "password", "secret", "token", "apikey", "privatekey", "clientsecret", "session", "sessiondata", "localstorage", "browserstorage"]);

function assertScalarIntent(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(assertScalarIntent);
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /(?:\/\.hermes(?:\/|$)|\/\.local\/share\/opencode(?:\/|$)|\/opencode\/auth\.json$)/i.test(value)) throw new ControlPlaneError("AUTH_FILE_PATH_REJECTED", "Renderer intent cannot contain an authentication-store path.");
    return;
  }
  Object.entries(value).forEach(([key, item]) => {
    if (SENSITIVE_INTENT_KEYS.has(key.toLowerCase().replace(/[_.-]/g, ""))) throw new ControlPlaneError("SENSITIVE_FIELD_REJECTED", "Renderer intent cannot contain a credential field.");
    assertScalarIntent(item);
  });
}

export class ControlPlaneError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number, public readonly createOutcome?: "rejected") {
    super(message);
    this.name = "ControlPlaneError";
  }
}

export function brandImpactPreviewScopeKey(profileId: string, clientId: string, brandId: string): string {
  return JSON.stringify([profileId, clientId, brandId]);
}

export function normalizeBrandImpactPreview(value: unknown, expectedBrandId: string): BrandImpactPreview {
  if (!value || typeof value !== "object") throw new ControlPlaneError("BRAND_IMPACT_RESPONSE_INVALID", "Brand impact response is invalid.");
  const input = value as Record<string, unknown>;
  if (input.brandId !== expectedBrandId) throw new ControlPlaneError("BRAND_IMPACT_ID_MISMATCH", "Brand impact response does not match the requested Brand.");
  const identity = input.identity;
  if (!identity || typeof identity !== "object" || (identity as Record<string, unknown>).brandId !== input.brandId || (identity as Record<string, unknown>).clientId !== input.clientId) throw new ControlPlaneError("BRAND_IMPACT_SCOPE_MISMATCH", "Brand impact response scope does not match its identity.");
  if (!['active', 'draft', 'archived'].includes(String(input.brandStatus))) throw new ControlPlaneError("BRAND_IMPACT_STATUS_INVALID", "Brand impact response has an invalid Brand status.");
  const counts = input.counts;
  const countKeys = ["draftCount", "planCount", "unsentScheduleCount", "sharedMediaCount"] as const;
  if (!counts || typeof counts !== "object" || countKeys.some((key) => typeof (counts as Record<string, unknown>)[key] !== "number" || !Number.isSafeInteger((counts as Record<string, unknown>)[key]) || ((counts as Record<string, unknown>)[key] as number) < 0)) throw new ControlPlaneError("BRAND_IMPACT_COUNTS_INVALID", "Brand impact counts are invalid.");
  if (typeof input.clientId !== "string" || typeof input.brandName !== "string" || typeof input.observedAt !== "string" || typeof input.revision !== "string" || !/^[a-f0-9]{64}$/i.test(input.revision)) throw new ControlPlaneError("BRAND_IMPACT_RESPONSE_INVALID", "Brand impact response is incomplete.");
  if (!Array.isArray(input.blockers) || input.blockers.some((item) => typeof item !== "string")) throw new ControlPlaneError("BRAND_IMPACT_RESPONSE_INVALID", "Brand impact blockers are invalid.");
  return input as unknown as BrandImpactPreview;
}

export function brandImpactPreviewMatchesBrand(preview: BrandImpactPreview, brand: { id: string; clientId?: string; workspaceId?: string }): boolean {
  return Boolean(preview && preview.brandId === brand.id && preview.clientId === (brand.clientId ?? brand.workspaceId));
}

function assertGenericTargetPublicationMutationAllowed(entity: string): void {
  if (entity === "target-publications") throw new ControlPlaneError("TARGET_PUBLICATION_COMMAND_REQUIRED", "Target Publications must use durable Control Plane commands.");
}

function agencyRecord(value: unknown): AgencyRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AgencyRecord : undefined;
}

function nonLiveActionCode(value: AgencyRecord): "TARGET_PUBLICATION_SIMULATION_REMOVED" | "LEGACY_NON_LIVE_ACTION_BLOCKED" | undefined {
  if (value.simulation === true) return "TARGET_PUBLICATION_SIMULATION_REMOVED";
  if (value.legacyNonLive === true || value.legacy_non_live === true) return "LEGACY_NON_LIVE_ACTION_BLOCKED";
  return undefined;
}

function assertLiveTargetPublicationPayload(payload: AgencyRecord, requireWorkerJob: boolean): void {
  assertScalarIntent(payload);
  const payloadErrorCode = nonLiveActionCode(payload);
  if (payloadErrorCode) throw new ControlPlaneError(payloadErrorCode, payloadErrorCode === "TARGET_PUBLICATION_SIMULATION_REMOVED" ? "Retired non-live markers are not accepted for new Target Publications." : "Migrated non-live Target Publications are read-only.");
  const workerJob = agencyRecord(payload.workerJob);
  if (requireWorkerJob && (!workerJob || typeof workerJob.jobId !== "string" || !workerJob.jobId.trim())) {
    throw new ControlPlaneError("TARGET_PUBLICATION_WORKER_REQUIRED", "Target publication approval requires a durable worker job.");
  }
  const workerPayload = agencyRecord(workerJob?.payload);
  if (requireWorkerJob && !workerPayload) throw new ControlPlaneError("TARGET_PUBLICATION_WORKER_PAYLOAD_REQUIRED", "Target publication approval requires an object worker payload.");
  const workerErrorCode = workerPayload ? nonLiveActionCode(workerPayload) : undefined;
  if (workerErrorCode) throw new ControlPlaneError(workerErrorCode, workerErrorCode === "TARGET_PUBLICATION_SIMULATION_REMOVED" ? "Retired non-live markers are not accepted for new worker payloads." : "Migrated non-live worker payloads are read-only.");
}

export class ControlPlaneClient {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly baseUrl: string, options: ControlPlaneClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? CONTROL_PLANE_REQUEST_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) return;
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new ControlPlaneError("CONTROL_PLANE_TIMEOUT", "Control Plane request timed out.", 504));
      }, this.timeoutMs);
    });
    const callerSignal = init?.signal;
    const abortFromCaller = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
    try {
      const responsePromise = this.fetchImpl.call(typeof window === "undefined" ? globalThis : window, `${this.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "content-type": "application/json", ...profileRuntimeHeaders(), ...(init?.headers ?? {}) },
      });
      response = await (Number.isFinite(this.timeoutMs) && this.timeoutMs > 0 ? Promise.race([responsePromise, timeoutPromise]) : responsePromise);
      const body = await (Number.isFinite(this.timeoutMs) && this.timeoutMs > 0 ? Promise.race([response.json().catch(() => ({})), timeoutPromise]) : response.json().catch(() => ({})));
      if (!response.ok) {
        const detail = body && typeof body.detail === "object" && body.detail ? body.detail : body;
        throw new ControlPlaneError(detail.code ?? "CONTROL_PLANE_ERROR", detail.message ?? "Control plane request failed", response.status, detail.createOutcome === "rejected" ? "rejected" : undefined);
      }
      return body as T;
    } catch (error) {
      if (error instanceof ControlPlaneError) throw error;
      if (timedOut) throw new ControlPlaneError("CONTROL_PLANE_TIMEOUT", "Control Plane request timed out.", 504);
      if (error instanceof DOMException && error.name === "AbortError") throw new ControlPlaneError("CONTROL_PLANE_ABORTED", "Control Plane request was aborted.");
      throw new ControlPlaneError("CONTROL_PLANE_UNREACHABLE", error instanceof Error ? error.message : "Control plane is unreachable");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  health(): Promise<ControlPlaneHealth> {
    return this.request<ControlPlaneHealth>("/health");
  }

  startMetaOAuth(input: MetaOAuthStartRequest): Promise<MetaOAuthStartResponse> {
    return this.request<MetaOAuthStartResponse>("/v1/oauth/meta/start", { method: "POST", body: JSON.stringify(input) });
  }

  exchangeMetaCode(input: MetaOAuthExchangeRequest): Promise<MetaOAuthExchangeResponse> {
    return this.request<MetaOAuthExchangeResponse>("/v1/oauth/meta/exchange", { method: "POST", body: JSON.stringify(input) });
  }

  createAgencyEntity<T extends Record<string, unknown>>(entity: AgencyCreateEntity, payload: T): Promise<T> {
    assertGenericTargetPublicationMutationAllowed(entity);
    assertScalarIntent(payload);
    return this.request<T>(`/v1/agency/${entity}`, { method: "POST", body: JSON.stringify(payload) });
  }

  listAgencyEntities<T extends Record<string, unknown>>(entity: Exclude<AgencyEntity, "connections">): Promise<T[]> {
    return this.request<T[]>(`/v1/agency/${entity}`);
  }

  updateAgencyEntity<T extends Record<string, unknown>>(entity: AgencyCrudEntity, id: string, payload: Partial<T>): Promise<T> {
    assertGenericTargetPublicationMutationAllowed(entity);
    assertScalarIntent(payload);
    return this.request<T>(`/v1/agency/${entity}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
  }

  deleteAgencyEntity(entity: AgencyCrudEntity, id: string): Promise<void> {
    assertGenericTargetPublicationMutationAllowed(entity);
    return this.request<void>(`/v1/agency/${entity}/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  compensateMediaAsset(id: string, receipt: MediaAssetCompensationRequest): Promise<MediaAssetCompensationResult> {
    assertScalarIntent(receipt);
    return this.request<MediaAssetCompensationResult>(`/v1/agency/media-assets/${encodeURIComponent(id)}/compensate`, { method: "POST", body: JSON.stringify(receipt) });
  }

  async getContentRun(id: string): Promise<AgencyRecord | undefined> {
    try {
      const row = await this.request<AgencyRecord>(`/v1/agency/content-runs/${encodeURIComponent(id)}`);
      return { ...row, clientId: row.clientId ?? row.client_id, brandId: row.brandId ?? row.brand_id };
    } catch (error) {
      if (error instanceof ControlPlaneError && error.status === 404 && error.code === "AGENCY_ENTITY_MISSING") return undefined;
      throw error;
    }
  }

  trashBrand(id: string, actor: BrandLifecycleActor): Promise<AgencyRecord> {
    return this.request<AgencyRecord>(`/v1/agency/brands/${encodeURIComponent(id)}/trash`, { method: "POST", body: JSON.stringify(actor) });
  }

  permanentlyDeleteBrand(id: string, actor: BrandLifecycleActor): Promise<AgencyRecord> {
    return this.request<AgencyRecord>(`/v1/agency/brands/${encodeURIComponent(id)}/permanent-delete`, { method: "POST", body: JSON.stringify(actor) });
  }

  restoreBrand(id: string, actor: BrandLifecycleActor): Promise<AgencyRecord> {
    return this.request<AgencyRecord>(`/v1/agency/brands/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify(actor) });
  }

  listBrandDeletionOperations(id: string): Promise<AgencyRecord[]> {
    return this.request<AgencyRecord[]>(`/v1/agency/brands/${encodeURIComponent(id)}/deletion-operations`);
  }

  brandImpactPreview(id: string): Promise<BrandImpactPreview> {
    return this.request<BrandImpactPreview>(`/v1/agency/brands/${encodeURIComponent(id)}/impact`);
  }

  backfillBrandActorBindings(actor: BrandLifecycleActor, brandIds?: string[]): Promise<{ seededCount: number; brandCount: number }> {
    assertScalarIntent(actor);
    const payload = { actor, ...(brandIds ? { brandIds } : {}) };
    assertScalarIntent(payload);
    return this.request<{ seededCount: number; brandCount: number }>("/v1/agency/brand-actor-bindings/backfill", { method: "POST", body: JSON.stringify(payload) });
  }

  commitAgencyMigration(input: AgencyMigrationInput): Promise<AgencyMigrationResult> {
    assertScalarIntent(input);
    return this.request<AgencyMigrationResult>("/v1/agency/migrations/commit", { method: "POST", body: JSON.stringify(input) });
  }

  agencyRecovery(): Promise<{ clients: AgencyRecord[]; brands: AgencyRecord[]; identities: AgencyRecord[]; bindings: AgencyRecord[] }> {
    return this.request<{ clients: AgencyRecord[]; brands: AgencyRecord[]; identities: AgencyRecord[]; bindings: AgencyRecord[] }>("/v1/agency/recovery");
  }

  listAgencyRecords<T extends AgencyRecord>(entity: AgencyEntity, filters?: { clientId?: string; brandId?: string }): Promise<T[]> {
    const query = new URLSearchParams();
    if (filters?.clientId) query.set("clientId", filters.clientId);
    if (filters?.brandId) query.set("brandId", filters.brandId);
    return this.request<T[]>(`/v1/agency/${entity}${query.size ? `?${query.toString()}` : ""}`);
  }

  createAgencyRecord<T extends AgencyRecord>(entity: string, payload: T): Promise<T> {
    assertGenericTargetPublicationMutationAllowed(entity);
    assertScalarIntent(payload);
    return this.request<T>(`/v1/agency/${entity}`, { method: "POST", body: JSON.stringify(payload) });
  }

  approveResearchEvidence(id: string, payload: ResearchEvidenceApprovalRequest): Promise<AgencyRecord> {
    assertScalarIntent(payload);
    return this.request<AgencyRecord>(`/v1/agency/research-evidence/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify(payload) });
  }

  archiveKnowledgeItem(id: string): Promise<{ id: string; archiveState: "archived" }> {
    return this.request<{ id: string; archiveState: "archived" }>(`/v1/agency/knowledge-items/${encodeURIComponent(id)}/archive`, { method: "POST" });
  }

  archiveMediaAsset(id: string): Promise<{ id: string; archiveState: "archived"; providerFileId?: string }> {
    return this.request<{ id: string; archiveState: "archived"; providerFileId?: string }>(`/v1/agency/media-assets/${encodeURIComponent(id)}/archive`, { method: "POST" });
  }

  restoreMediaAsset(id: string): Promise<{ id: string; archiveState: "active" }> {
    return this.request<{ id: string; archiveState: "active" }>(`/v1/agency/media-assets/${encodeURIComponent(id)}/restore`, { method: "POST" });
  }

  searchKnowledgeItems<T extends AgencyRecord>(filters: { clientId: string; brandId: string; query: string }): Promise<T[]> {
    const query = new URLSearchParams({ clientId: filters.clientId, brandId: filters.brandId, q: filters.query });
    return this.request<T[]>(`/v1/agency/knowledge-items/search?${query.toString()}`);
  }

  preflightTargetPublication(payload: AgencyRecord): Promise<AgencyRecord> {
    assertLiveTargetPublicationPayload(payload, false);
    return this.request<AgencyRecord>("/v1/agency/target-publications/preflight", { method: "POST", body: JSON.stringify(payload) });
  }

  approveTargetPublication(payload: AgencyRecord): Promise<AgencyRecord> {
    assertLiveTargetPublicationPayload(payload, true);
    return this.request<AgencyRecord>("/v1/agency/target-publications/approve", { method: "POST", body: JSON.stringify(payload) });
  }

  async approveTargetPublications(payloads: AgencyRecord[]): Promise<{ acknowledged: AgencyRecord[]; pending: AgencyRecord[]; failed: AgencyRecord[]; results: Array<{ publicationId: string; targetPageId?: string; workerJobId?: string; status: "acknowledged" | "pending" | "failed" | "compensated"; errorCode?: string }>; compensatedTargets: AgencyRecord[]; failureCode?: string; compensated: boolean; complete: boolean }> {
    payloads.forEach((payload) => assertLiveTargetPublicationPayload(payload, true));
    const acknowledged: AgencyRecord[] = [];
    const pending: AgencyRecord[] = [];
    const failed: AgencyRecord[] = [];
    const results: Array<{ publicationId: string; targetPageId?: string; workerJobId?: string; status: "acknowledged" | "pending" | "failed" | "compensated"; errorCode?: string }> = [];
    const targetFor = (payload: AgencyRecord, result?: AgencyRecord) => {
      const workerJob = payload.workerJob as AgencyRecord | undefined;
      const workerPayload = workerJob?.payload && typeof workerJob.payload === "object" ? workerJob.payload as AgencyRecord : {};
      return {
        publicationId: String(payload.id ?? result?.id ?? ""),
        targetPageId: String(result?.targetExternalId ?? workerPayload.page_id ?? "") || undefined,
        workerJobId: String(result?.workerJobId ?? workerJob?.jobId ?? "") || undefined,
      };
    };
    let failureCode: string | undefined;
    for (const payload of payloads) {
      const target = targetFor(payload);
      try {
        const result = await this.approveTargetPublication(payload);
        const resultErrorCode = nonLiveActionCode(result);
        if (resultErrorCode) {
          const errorCode = resultErrorCode;
          failed.push(result);
          failureCode ??= errorCode;
          results.push({ ...targetFor(payload, result), status: "failed", errorCode });
          continue;
        }
        const workerIsAcknowledged = String(result.workerAckState ?? result.worker_ack_state ?? "") === "acknowledged";
        if (result.commandStatus === "acknowledged" && result.state === "scheduled" && !result.pendingCommandId && workerIsAcknowledged) {
          acknowledged.push(result);
          results.push({ ...targetFor(payload, result), status: "acknowledged" });
          continue;
        }
        const terminalStates = new Set(["canceled", "cancelled", "published", "failed", "permanent_error", "approval_failed", "blocked"]);
        const terminalReplay = result.commandStatus === "acknowledged" && typeof result.state === "string" && terminalStates.has(result.state);
        const status = result.commandStatus === "failed" || terminalReplay ? "failed" : "pending";
        if (status === "failed") failed.push(result);
        else pending.push(result);
        const errorCode = typeof result.commandError === "string" ? result.commandError : terminalReplay ? "TARGET_PUBLICATION_ALREADY_TERMINAL" : status === "pending" ? "PUBLICATION_COMMAND_PENDING" : "PUBLICATION_APPROVAL_FAILED";
        failureCode ??= errorCode;
        results.push({ ...targetFor(payload, result), status, errorCode });
      } catch (error) {
        const errorCode = error instanceof ControlPlaneError ? error.code : error instanceof Error ? error.message : "PUBLICATION_APPROVAL_FAILED";
        const transient = !(error instanceof ControlPlaneError) || error.code === "CONTROL_PLANE_UNREACHABLE" || (error.status !== undefined && (error.status === 408 || error.status === 429 || error.status >= 500));
        const status = transient ? "pending" : "failed";
        const record = { id: target.publicationId, targetExternalId: target.targetPageId, workerJobId: target.workerJobId, commandStatus: status, commandError: errorCode };
        if (transient) pending.push(record);
        else failed.push(record);
        failureCode ??= errorCode;
        results.push({ ...target, status, errorCode });
      }
    }
    if (pending.length > 0) return { acknowledged, pending, failed, results, compensatedTargets: [], failureCode: failureCode ?? "PUBLICATION_COMMAND_PENDING", compensated: false, complete: false };
    if (failed.length === 0) return { acknowledged, pending, failed, results, compensatedTargets: [], compensated: true, complete: true };
    let compensated = true;
    const compensatedTargets: AgencyRecord[] = [];
    const stillAcknowledged: AgencyRecord[] = [];
    for (const publication of [...acknowledged].reverse()) {
      const id = typeof publication.id === "string" ? publication.id : "";
      const revision = publication.revision;
      if (!id || !Number.isSafeInteger(revision)) {
        pending.push(publication);
        compensated = false;
        stillAcknowledged.push(publication);
        continue;
      }
      try {
        const result = await this.targetPublicationCommand(id, {
          action: "cancel",
          clientId: publication.clientId,
          brandId: publication.brandId,
          expectedRevision: revision,
          requestId: `compensate-${id}-${revision}`,
        });
        if (result.commandStatus !== "acknowledged" || result.state !== "canceled") {
          pending.push(result);
          compensated = false;
          stillAcknowledged.push(publication);
        } else {
          compensatedTargets.push(result);
          const index = results.findIndex((item) => item.publicationId === id);
          if (index >= 0) results[index] = { ...results[index], status: "compensated" };
        }
      } catch {
        pending.push(publication);
        compensated = false;
        stillAcknowledged.push(publication);
      }
    }
    return { acknowledged: stillAcknowledged, pending, failed, results, compensatedTargets, failureCode, compensated, complete: false };
  }

  targetPublicationCommand(id: string, payload: AgencyRecord): Promise<AgencyRecord> {
    assertLiveTargetPublicationPayload(payload, false);
    return this.request<AgencyRecord>(`/v1/agency/target-publications/${encodeURIComponent(id)}/commands`, { method: "POST", body: JSON.stringify(payload) });
  }

  recoverPublicationCommands(): Promise<{ recovered: number; pending: number }> {
    return this.request<{ recovered: number; pending: number }>("/v1/agency/target-publications/commands/recover", { method: "POST" });
  }

  updateIdentityPayload(id: string, payload: Pick<AgencyRecord, "strategy" | "voice" | "visual">): Promise<AgencyRecord> {
    assertScalarIntent(payload);
    return this.request<AgencyRecord>(`/v1/agency/identities/${encodeURIComponent(id)}/payload`, { method: "PATCH", body: JSON.stringify(payload) });
  }

  probeGenerationProfile(id: string): Promise<AgencyRecord> {
    return this.request<AgencyRecord>(`/v1/agency/generation-profiles/${encodeURIComponent(id)}/probe`, { method: "POST" });
  }

  probeProviderConfiguration(id: string, operatorApproved = false): Promise<AgencyRecord> {
    return this.request<AgencyRecord>(`/v1/agency/provider-configurations/${encodeURIComponent(id)}/probe`, { method: "POST", body: JSON.stringify({ operatorApproved }) });
  }

  markContentRunProviderAttempt(id: string): Promise<{ providerAttempted: true }> {
    return this.request<{ providerAttempted: true }>(`/v1/agency/content-runs/${encodeURIComponent(id)}/provider-attempt`, { method: "POST" });
  }

  validateAutomationPlanActivation(payload: AgencyRecord): Promise<AgencyRecord> {
    assertScalarIntent(payload);
    return this.request<AgencyRecord>("/v1/agency/automation-plans/validate-activation", { method: "POST", body: JSON.stringify(payload) });
  }
}

export function createControlPlaneClient(): ControlPlaneClient | undefined {
  const configured = (import.meta.env.VITE_CONTROL_PLANE_URL as string | undefined)?.trim();
  // Electron always talks to the loopback service when one is running. Vite/browser
  // preview stays opt-in so a static preview never pretends to have an authority.
  const bridgeUrl = typeof window !== "undefined" && typeof window.signalflow?.controlPlaneUrl === "string" ? window.signalflow.controlPlaneUrl.trim() : "";
  const loopback = bridgeUrl || (typeof window !== "undefined" && Boolean(window.signalflow) ? "http://127.0.0.1:18787" : "");
  const baseUrl = bridgeUrl || configured || loopback;
  return baseUrl ? new ControlPlaneClient(baseUrl) : undefined;
}
