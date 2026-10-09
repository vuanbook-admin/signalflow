export type DurableWorkerMediaSource = "drive" | "generated" | "public_https";

/** Map renderer registration metadata to the worker's explicit media provenance contract. */
export function workerMediaSourceForRegistrationMode(registrationMode: string | undefined): DurableWorkerMediaSource {
  if (registrationMode === "google_drive") return "drive";
  if (registrationMode === "generated") return "generated";
  return "public_https";
}

export type DurableWorkerMediaContract = {
  id: string | number;
  registrationMode?: string;
  checksum?: string;
  visualFingerprint?: string;
  visualFingerprintSource?: string;
};

export function buildDurableWorkerMediaPayload(
  kind: "image" | "video",
  asset: DurableWorkerMediaContract | undefined,
  brandId: string,
  bindingId: string,
  identityVersionId: string,
  targetPageId: string,
  reservationId: string,
): Record<string, unknown> {
  if (!asset) return {};
  return {
    media_contract_version: 1,
    brand_id: brandId,
    binding_id: bindingId,
    identity_version_id: identityVersionId,
    target_page_id: targetPageId,
    media_asset_id: String(asset.id),
    media_status: "eligible",
    media_source: workerMediaSourceForRegistrationMode(asset.registrationMode),
    media_sha256: (asset.checksum ?? "").replace(/^sha256:/i, ""),
    media_fingerprint: asset.visualFingerprint,
    media_fingerprint_source: kind === "video" ? "decoded_video_frames" : asset.visualFingerprintSource,
    reservation_id: reservationId,
    reservation_state: "reserved",
  };
}

export type DurableWorkerJob = {
  jobId: string;
  idempotencyKey: string;
  scheduledAt: string;
  payload: Record<string, unknown>;
};

export type DurableWorkerHealth = {
  ok: boolean;
  service: string;
  workerMode: string;
  executorConfigured: boolean;
  configurationStatus: "ready" | "blocked" | string;
  workerState: "running" | "stopped" | string;
  acceptingJobs: boolean;
  safeStopRequested: boolean;
  supportsRecovery: boolean;
  queue: { queued: number; running: number; completed: number; failed: number; unknown?: number };
  profileId?: string | null;
  runtimeId?: string | null;
};

export type DurableWorkerJobRecord = {
  id: string;
  idempotency_key: string;
  scheduled_at: number;
  next_attempt_at?: number | null;
  state: "queued" | "running" | "completed" | "failed" | string;
  revision: number;
  provider_job_id?: string | null;
  last_error?: string | null;
  attempts?: number;
};

export type DurableWorkerControlResult = {
  ok: boolean;
  state: string;
  acceptingJobs: boolean;
  safeStopRequested?: boolean;
  recoveredJobs?: number;
  queue?: DurableWorkerHealth["queue"];
};

export type DurableWorkerJobMutation = {
  id: string;
  state: string;
  scheduled_at: number;
  revision: number;
};

type DurableWorkerFetch = typeof fetch;

export class DurableWorkerClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: DurableWorkerFetch;
  private readonly usesElectronBridge: boolean;

  constructor(baseUrl: string, fetchImpl: DurableWorkerFetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.usesElectronBridge = isElectronRuntime();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (this.usesElectronBridge) {
      let response: { status: number; body: string };
      try {
        response = await invoke("worker_request", { path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" });
      } catch {
        throw new Error("Durable worker is unreachable.");
      }
      if (response.status < 200 || response.status >= 300) {
        if (response.status === 409) {
          try {
            const code = (JSON.parse(response.body) as { detail?: { code?: unknown } }).detail?.code;
            if (typeof code === "string") throw new Error(code);
          } catch (error) {
            if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
          }
          throw new Error("Durable worker request conflict.");
        }
        throw new Error(`Durable worker request failed (${response.status})`);
      }
      try {
        return JSON.parse(response.body) as T;
      } catch {
        throw new Error("Durable worker returned an invalid response.");
      }
    }
    let response: Response;
    try {
      response = await this.fetchImpl.call(typeof window === "undefined" ? globalThis : window, `${this.baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    } catch {
      throw new Error("Durable worker is unreachable.");
    }
    if (!response.ok) {
      if (response.status === 409) {
        try {
          const body = await response.json() as { detail?: { code?: unknown } };
          if (typeof body.detail?.code === "string") throw new Error(body.detail.code);
        } catch (error) {
          if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
        }
        throw new Error("Durable worker request conflict.");
      }
      throw new Error(`Durable worker request failed (${response.status})`);
    }
    try {
      return await response.json() as T;
    } catch {
      throw new Error("Durable worker returned an invalid response.");
    }
  }

  health(workspaceId?: string): Promise<DurableWorkerHealth> {
    return this.request<DurableWorkerHealth>(workspaceId ? `/health?workspace_id=${encodeURIComponent(workspaceId)}` : "/health");
  }

  enqueue(job: DurableWorkerJob): Promise<{ jobId: string; state: string; revision: number }> {
    const scheduledAt = Date.parse(job.scheduledAt);
    if (!Number.isFinite(scheduledAt)) throw new Error("Durable worker job has an invalid schedule.");
    return this.request<{ jobId: string; state: string; revision: number }>("/v1/jobs", {
      method: "POST",
      body: JSON.stringify({ job_id: job.jobId, idempotency_key: job.idempotencyKey, scheduled_at: scheduledAt / 1000, payload: job.payload }),
    });
  }

  listJobs(workspaceId?: string): Promise<DurableWorkerJobRecord[]> {
    return this.request<DurableWorkerJobRecord[]>(workspaceId ? `/v1/jobs?workspace_id=${encodeURIComponent(workspaceId)}` : "/v1/jobs");
  }

  mutateJob(jobId: string, action: "publish_now" | "reschedule" | "cancel", expectedRevision: number, requestId = `request-${Date.now()}`, scheduledAt?: string): Promise<DurableWorkerJobMutation> {
    if (!/^[A-Za-z0-9_.:-]{1,240}$/.test(jobId)) throw new Error("Durable worker job id is invalid.");
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Durable worker job revision is invalid.");
    const parsed = scheduledAt === undefined ? undefined : Date.parse(scheduledAt);
    if (scheduledAt !== undefined && !Number.isFinite(parsed)) throw new Error("Durable worker job has an invalid schedule.");
    return this.request<DurableWorkerJobMutation>(`/v1/jobs/${jobId}/action`, { method: "POST", body: JSON.stringify({ action, request_id: requestId, expected_revision: expectedRevision, ...(parsed === undefined ? {} : { scheduled_at: parsed / 1000 }) }) });
  }

  publishNow(jobId: string, expectedRevision: number, requestId?: string): Promise<DurableWorkerJobMutation> {
    return this.mutateJob(jobId, "publish_now", expectedRevision, requestId);
  }

  reschedule(jobId: string, scheduledAt: string, expectedRevision: number, requestId?: string): Promise<DurableWorkerJobMutation> {
    return this.mutateJob(jobId, "reschedule", expectedRevision, requestId, scheduledAt);
  }

  cancel(jobId: string, expectedRevision: number, requestId?: string): Promise<DurableWorkerJobMutation> {
    return this.mutateJob(jobId, "cancel", expectedRevision, requestId);
  }

  safeStop(reason = "operator_request"): Promise<DurableWorkerControlResult> {
    return this.request<DurableWorkerControlResult>("/v1/stop", { method: "POST", body: JSON.stringify({ reason }) });
  }

  recover(reason = "operator_recovery"): Promise<DurableWorkerControlResult> {
    return this.request<DurableWorkerControlResult>("/v1/recover", { method: "POST", body: JSON.stringify({ reason }) });
  }
}

export function createDurableWorkerClient(baseUrl = import.meta.env.VITE_WORKER_URL as string | undefined): DurableWorkerClient | undefined {
  const bridgeUrl = typeof window !== "undefined" && typeof window.signalflow?.workerUrl === "string" ? window.signalflow.workerUrl.trim() : "";
  const resolved = bridgeUrl || baseUrl?.trim() || (typeof window !== "undefined" && Boolean(window.signalflow) ? "http://127.0.0.1:18788" : "");
  return resolved ? new DurableWorkerClient(resolved) : undefined;
}

export type { DurableWorkerFetch };
import { invoke, isElectronRuntime } from "./nativeRuntime";
