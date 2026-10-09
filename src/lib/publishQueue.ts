import { preflightPublish, type ContentVariant, type ProviderPublishResult, type ProviderReconciliationResult, type PublishJob, type SocialConnection } from "./mvpContracts";
import { LocalAuditLog, type AuditAction, type AuditOutcome } from "./auditLog";
import type { PersistedQueueState } from "./persistence";
import { stableMediaRecordIdHash } from "./automationDomain";

export interface PublisherExecutor {
  publish(job: PublishJob, variant: ContentVariant, connection: SocialConnection): Promise<ProviderPublishResult>;
  reconcile?(job: PublishJob, variant: ContentVariant, connection: SocialConnection): Promise<ProviderReconciliationResult>;
}

export class PublishQueueError extends Error {
  constructor(public readonly code: "LIVE_CONNECTION_REQUIRED" | "TARGET_PUBLICATION_SIMULATION_REMOVED" | "LEGACY_NON_LIVE_ACTION_BLOCKED", message: string) {
    super(message);
    this.name = "PublishQueueError";
  }
}

type QueueTargetContext = { clientId: string; brandId: string; bindingId: string; identityVersionId?: string; simulation?: boolean; legacyNonLive?: boolean };

function assertLiveQueueInput(connection: SocialConnection, context?: QueueTargetContext): void {
  if (context?.simulation === true) throw new PublishQueueError("TARGET_PUBLICATION_SIMULATION_REMOVED", "Live target jobs cannot use the retired non-live marker.");
  if (context?.legacyNonLive === true) throw new PublishQueueError("LEGACY_NON_LIVE_ACTION_BLOCKED", "Migrated non-live target jobs cannot be queued or published.");
  if (connection.providerMetadata.connectionMode === "simulation") throw new PublishQueueError("LIVE_CONNECTION_REQUIRED", "A provider-backed connection is required for publication.");
}

function isLegacyQueueJob(job: PublishJob): boolean {
  return job.legacyNonLive === true || job.simulation === true;
}

export interface QueueEvent {
  type: "queued" | "preflight_failed" | "uploading" | "processing" | "published" | "retryable_error" | "permanent_error" | "rescheduled" | "reconciled" | "reconciliation_error" | "canceled";
  job: PublishJob;
  message?: string;
}

export function createIdempotencyKey(variantId: string, connectionId: string, scheduledAt: string): string {
  return `${variantId}:${connectionId}:${scheduledAt}`;
}

/** ponytail: synchronous 64-bit hash keeps queue operations synchronous; replace with SHA-256 only if an external contract requires cryptographic keys. */
export function createTargetPublicationIdempotencyKey(clientId: string, brandId: string, bindingId: string, variantId: string, scheduledSlot: string): string {
  return `target-publication:${stableMediaRecordIdHash([clientId, brandId, bindingId, variantId, scheduledSlot].join("\x1f"))}`;
}

export function classifyPublishError(error: unknown): { code: string; message: string; retryable: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const explicitRetryable = typeof error === "object" && error !== null && "retryable" in error && typeof (error as { retryable?: unknown }).retryable === "boolean"
    ? (error as { retryable: boolean }).retryable
    : undefined;
  const retryable = explicitRetryable ?? (normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("429") || normalized.includes("temporarily") || normalized.includes("503") || normalized.includes("network"));
  return { code: retryable ? "RETRYABLE_PROVIDER_ERROR" : "PERMANENT_PROVIDER_ERROR", message, retryable };
}

export class LocalPublishQueue {
  private readonly jobs = new Map<string, PublishJob>();
  private readonly variants = new Map<string, ContentVariant>();
  private readonly connections = new Map<string, SocialConnection>();
  private readonly listeners = new Set<(event: QueueEvent) => void>();
  private readonly auditLog = new LocalAuditLog();

  subscribe(listener: (event: QueueEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: QueueEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private recordAudit(job: PublishJob, action: AuditAction, outcome: AuditOutcome, message?: string, providerJobId?: string): void {
    const connection = this.connections.get(job.connectionId);
    this.auditLog.append({ action, outcome, jobId: job.id, workspaceId: connection?.workspaceId, platform: connection?.platform, providerJobId, message });
  }

  auditEntries() {
    return this.auditLog.list();
  }

  approveAndQueue(variant: ContentVariant, connection: SocialConnection, scheduledAt: Date, context?: QueueTargetContext): PublishJob {
    assertLiveQueueInput(connection, context);
    const scheduledAtIso = scheduledAt.toISOString();
    const idempotencyKey = context ? createTargetPublicationIdempotencyKey(context.clientId, context.brandId, context.bindingId, variant.id, scheduledAtIso) : createIdempotencyKey(variant.id, connection.id, scheduledAtIso);
    const existing = [...this.jobs.values()].find((job) => job.idempotencyKey === idempotencyKey);
    if (existing) return existing;
    const basePreflight = preflightPublish(variant, connection, scheduledAt);
    const preflight = variant.lifecycle === "approved"
      ? basePreflight
      : { ok: false, checks: [...basePreflight.checks, { key: "approval", ok: false, message: "Target publication requires approvalState=approved before enqueue." }] };
    const job: PublishJob = {
      id: `job_${idempotencyKey.replace(/[^a-zA-Z0-9]/g, "_")}`,
      variantId: variant.id,
      connectionId: connection.id,
      scheduledAt: scheduledAtIso,
      idempotencyKey,
      state: preflight.ok ? "queued" : "preflight_failed",
      attempts: 0,
      ...(context ? { clientId: context.clientId, brandId: context.brandId, bindingId: context.bindingId, ...(context.identityVersionId ? { identityVersionId: context.identityVersionId } : {}) } : {}),
      lastError: preflight.ok ? undefined : { code: "PREFLIGHT_FAILED", message: preflight.checks.filter((check) => !check.ok).map((check) => check.message).join(" "), retryable: false },
    };
    this.jobs.set(job.id, job);
    this.variants.set(variant.id, variant);
    this.connections.set(connection.id, connection);
    this.recordAudit(job, "queue_created", job.state === "queued" ? "accepted" : "blocked", job.lastError?.message);
    this.emit({ type: job.state === "queued" ? "queued" : "preflight_failed", job, message: job.lastError?.message });
    return job;
  }

  approveAndQueueTargets(variant: ContentVariant, targets: Array<{ connection: SocialConnection; clientId: string; brandId: string; bindingId: string; identityVersionId?: string; simulation?: boolean; legacyNonLive?: boolean }>, scheduledAt: Date): PublishJob[] {
    return targets.map((target) => this.approveAndQueue(variant, target.connection, scheduledAt, target));
  }

  list(): PublishJob[] {
    return [...this.jobs.values()].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }

  snapshot(): PersistedQueueState {
    return {
      jobs: [...this.jobs.values()],
      variants: [...this.variants.values()],
      connections: [...this.connections.values()],
      auditEntries: this.auditLog.snapshot(),
    };
  }

  hydrate(snapshot?: PersistedQueueState): void {
    if (!snapshot) return;
    snapshot.jobs.forEach((job) => this.jobs.set(job.id, job.simulation === true ? { ...job, legacyNonLive: true } : job));
    snapshot.variants.forEach((variant) => this.variants.set(variant.id, variant));
    snapshot.connections.forEach((connection) => this.connections.set(connection.id, connection));
    this.auditLog.hydrate(snapshot.auditEntries);
  }

  reconcileOfficialConnection(officialConnection: SocialConnection): number {
    if (officialConnection.providerMetadata.connectionMode !== "official") return 0;
    let replaced = 0;
    for (const job of this.jobs.values()) {
      if (job.state !== "queued" || isLegacyQueueJob(job)) continue;
      const stored = this.connections.get(job.connectionId);
      if (!stored || stored.workspaceId !== officialConnection.workspaceId || stored.platform !== officialConnection.platform) continue;
      this.connections.set(job.connectionId, { ...officialConnection, id: job.connectionId });
      replaced += 1;
    }
    return replaced;
  }

  async runDue(now: Date, executor: PublisherExecutor): Promise<PublishJob[]> {
    const completed: PublishJob[] = [];
    for (const job of this.jobs.values()) {
      if (isLegacyQueueJob(job) || job.state !== "queued" || new Date(job.scheduledAt).getTime() > now.getTime()) continue;
      const variant = this.variants.get(job.variantId);
      const connection = this.connections.get(job.connectionId);
      if (!variant || !connection) continue;
      const uploading = { ...job, state: "uploading" as const, attempts: job.attempts + 1 };
      this.jobs.set(job.id, uploading);
      this.emit({ type: "uploading", job: uploading });
      try {
        const result = await executor.publish(uploading, variant, connection);
        const providerState = result.providerState ?? "published";
        if (providerState === "failed") {
          const lastError = { code: "PROVIDER_REPORTED_FAILURE", message: "Provider reported a failed publish operation.", retryable: false };
          const failed = { ...uploading, state: "permanent_error" as const, providerJobId: result.providerJobId, providerState, lastSyncedAt: new Date().toISOString(), lastError };
          this.jobs.set(job.id, failed);
          this.recordAudit(failed, "publish_dispatched", "failed", lastError.message, result.providerJobId);
          this.emit({ type: "permanent_error", job: failed, message: lastError.message });
          continue;
        }
        const isProcessing = providerState === "accepted" || providerState === "processing" || providerState === "unknown";
        const updated = { ...uploading, state: isProcessing ? "processing" as const : "published" as const, providerJobId: result.providerJobId, providerState, lastSyncedAt: new Date().toISOString() };
        this.jobs.set(job.id, updated);
        this.recordAudit(updated, "publish_dispatched", isProcessing ? "pending" : "completed", isProcessing ? "Provider accepted the job; reconciliation is required." : "Provider confirmed publish.", result.providerJobId);
        this.emit({ type: isProcessing ? "processing" : "published", job: updated });
        if (!isProcessing) completed.push(updated);
      } catch (error) {
        const lastError = classifyPublishError(error);
        const failed = { ...uploading, state: lastError.retryable ? "retryable_error" as const : "permanent_error" as const, lastError, lastSyncedAt: new Date().toISOString() };
        this.jobs.set(job.id, failed);
        this.recordAudit(failed, "publish_dispatched", "failed", lastError.message);
        this.emit({ type: failed.state, job: failed, message: lastError.message });
      }
    }
    return completed;
  }

  async reconcile(jobId: string, executor: PublisherExecutor): Promise<PublishJob | undefined> {
    const current = this.jobs.get(jobId);
    if (!current || isLegacyQueueJob(current) || current.state !== "processing") return current;
    const variant = this.variants.get(current.variantId);
    const connection = this.connections.get(current.connectionId);
    if (!variant || !connection || !executor.reconcile) return current;
    try {
      const result = await executor.reconcile(current, variant, connection);
      const providerState = result.providerState;
      if (providerState === "failed") {
        const lastError = { code: "PROVIDER_REPORTED_FAILURE", message: result.message ?? "Provider reported a failed publish operation.", retryable: result.retryable ?? false };
        const failed = { ...current, state: lastError.retryable ? "retryable_error" as const : "permanent_error" as const, providerJobId: result.providerJobId ?? current.providerJobId, providerState, lastSyncedAt: new Date().toISOString(), lastError };
        this.jobs.set(jobId, failed);
        this.recordAudit(failed, "publish_reconciled", lastError.retryable ? "pending" : "failed", lastError.message, result.providerJobId ?? current.providerJobId);
        this.emit({ type: failed.state, job: failed, message: lastError.message });
        return failed;
      }
      const updated = { ...current, state: providerState === "published" ? "published" as const : "processing" as const, providerJobId: result.providerJobId ?? current.providerJobId, providerState, lastSyncedAt: new Date().toISOString(), lastError: undefined };
      this.jobs.set(jobId, updated);
      this.recordAudit(updated, "publish_reconciled", providerState === "published" ? "completed" : "pending", result.message, updated.providerJobId);
      this.emit({ type: providerState === "published" ? "published" : "reconciled", job: updated, message: result.message });
      return updated;
    } catch (error) {
      const lastError = classifyPublishError(error);
      const failed = lastError.retryable
        ? { ...current, state: "processing" as const, lastSyncedAt: new Date().toISOString(), lastError }
        : { ...current, state: "permanent_error" as const, lastSyncedAt: new Date().toISOString(), lastError };
      this.jobs.set(jobId, failed);
      this.recordAudit(failed, "publish_reconciled", lastError.retryable ? "pending" : "failed", lastError.message, current.providerJobId);
      this.emit({ type: lastError.retryable ? "reconciliation_error" : "permanent_error", job: failed, message: lastError.message });
      return failed;
    }
  }

  syncExternalResult(jobId: string, providerJobId: string | undefined, workerState: "queued" | "running" | "completed" | "failed", lastError?: string, attempts?: number): PublishJob | undefined {
    const current = this.jobs.get(jobId);
    if (!current || isLegacyQueueJob(current) || current.state === "published" || current.state === "canceled") return current;
    const nextAttempts = attempts === undefined ? current.attempts : Math.max(current.attempts, attempts);
    const updated: PublishJob = workerState === "completed"
      ? { ...current, state: "published", providerState: "published", providerJobId: providerJobId ?? current.providerJobId, lastSyncedAt: new Date().toISOString(), lastError: undefined, attempts: nextAttempts }
      : workerState === "failed"
        ? { ...current, state: "permanent_error", providerState: "failed", providerJobId: providerJobId ?? current.providerJobId, lastSyncedAt: new Date().toISOString(), attempts: nextAttempts, lastError: { code: "DURABLE_WORKER_FAILED", message: lastError ?? "Durable worker failed the job.", retryable: false } }
        : { ...current, state: workerState === "running" ? "uploading" : "queued", providerJobId: providerJobId ?? current.providerJobId, attempts: nextAttempts };
    this.jobs.set(jobId, updated);
    if (workerState === "completed" || workerState === "failed") {
      this.recordAudit(updated, "publish_reconciled", workerState === "completed" ? "completed" : "failed", lastError, updated.providerJobId);
      this.emit({ type: workerState === "completed" ? "published" : "permanent_error", job: updated, message: lastError });
    }
    return updated;
  }

  retry(jobId: string, scheduledAt: Date): PublishJob | undefined {
    const current = this.jobs.get(jobId);
    if (current && isLegacyQueueJob(current)) throw new PublishQueueError("LEGACY_NON_LIVE_ACTION_BLOCKED", "Migrated non-live target jobs are read-only.");
    if (!current || current.state !== "retryable_error") return current;
    const scheduledAtIso = scheduledAt.toISOString();
    const idempotencyKey = current.clientId && current.brandId && current.bindingId ? createTargetPublicationIdempotencyKey(current.clientId, current.brandId, current.bindingId, current.variantId, scheduledAtIso) : createIdempotencyKey(current.variantId, current.connectionId, scheduledAtIso);
    const retried = { ...current, state: "queued" as const, scheduledAt: scheduledAtIso, idempotencyKey, lastError: undefined };
    this.jobs.set(jobId, retried);
    this.recordAudit(retried, "retry_scheduled", "accepted", "Retry scheduled.");
    this.emit({ type: "queued", job: retried, message: "Retry scheduled." });
    return retried;
  }

  reschedule(jobId: string, scheduledAt: Date): PublishJob | undefined {
    const current = this.jobs.get(jobId);
    if (current && isLegacyQueueJob(current)) throw new PublishQueueError("LEGACY_NON_LIVE_ACTION_BLOCKED", "Migrated non-live target jobs are read-only.");
    if (!current || (current.state !== "queued" && current.state !== "retryable_error")) return current;
    const variant = this.variants.get(current.variantId);
    const connection = this.connections.get(current.connectionId);
    if (!variant || !connection) return current;
    const preflight = preflightPublish(variant, connection, scheduledAt);
    const scheduledAtIso = scheduledAt.toISOString();
    const idempotencyKey = current.clientId && current.brandId && current.bindingId ? createTargetPublicationIdempotencyKey(current.clientId, current.brandId, current.bindingId, current.variantId, scheduledAtIso) : createIdempotencyKey(current.variantId, current.connectionId, scheduledAtIso);
    const updated: PublishJob = preflight.ok
      ? { ...current, state: "queued", scheduledAt: scheduledAtIso, idempotencyKey, lastError: undefined }
      : { ...current, state: "preflight_failed", scheduledAt: scheduledAtIso, idempotencyKey, lastError: { code: "PREFLIGHT_FAILED", message: preflight.checks.filter((check) => !check.ok).map((check) => check.message).join(" "), retryable: false } };
    this.jobs.set(jobId, updated);
    this.recordAudit(updated, "rescheduled", preflight.ok ? "accepted" : "blocked", updated.lastError?.message ?? "Schedule updated.");
    this.emit({ type: preflight.ok ? "rescheduled" : "preflight_failed", job: updated, message: updated.lastError?.message ?? "Schedule updated." });
    return updated;
  }

  cancel(jobId: string): PublishJob | undefined {
    const current = this.jobs.get(jobId);
    if (current && isLegacyQueueJob(current)) throw new PublishQueueError("LEGACY_NON_LIVE_ACTION_BLOCKED", "Migrated non-live target jobs are read-only.");
    if (!current || (current.state !== "queued" && current.state !== "retryable_error" && current.state !== "preflight_failed")) return current;
    const canceled = { ...current, state: "canceled" as const };
    this.jobs.set(jobId, canceled);
    this.recordAudit(canceled, "canceled", "completed", "Job canceled.");
    this.emit({ type: "canceled", job: canceled, message: "Job canceled." });
    return canceled;
  }
}
