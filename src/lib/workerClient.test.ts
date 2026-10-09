import { describe, expect, it, vi } from "vitest";
import { buildDurableWorkerMediaPayload, createDurableWorkerClient, DurableWorkerClient, workerMediaSourceForRegistrationMode } from "./workerClient";

describe("durable worker client", () => {
  it("maps media registration modes to the truthful worker provenance source", () => {
    expect(workerMediaSourceForRegistrationMode("generated")).toBe("generated");
    expect(workerMediaSourceForRegistrationMode("google_drive")).toBe("drive");
    expect(workerMediaSourceForRegistrationMode("public_url")).toBe("public_https");
    expect(workerMediaSourceForRegistrationMode(undefined)).toBe("public_https");
  });

  it("builds the approved Facebook video media contract with decoded frame provenance", () => {
    expect(buildDurableWorkerMediaPayload("video", { id: "drive-video-1", registrationMode: "google_drive", checksum: "sha256:" + "a".repeat(64), visualFingerprint: "0123456789abcdef", visualFingerprintSource: "decoded_image" }, "brand-1", "binding-1", "identity-1-v1", "100000000000001", "reservation-1")).toEqual({
      media_contract_version: 1,
      brand_id: "brand-1",
      binding_id: "binding-1",
      identity_version_id: "identity-1-v1",
      target_page_id: "100000000000001",
      media_asset_id: "drive-video-1",
      media_status: "eligible",
      media_source: "drive",
      media_sha256: "a".repeat(64),
      media_fingerprint: "0123456789abcdef",
      media_fingerprint_source: "decoded_video_frames",
      reservation_id: "reservation-1",
      reservation_state: "reserved",
    });
  });

  it("sends only approved publish payload metadata to the worker", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ jobId: "job-1", state: "queued" }), { status: 200 }));
    const client = new DurableWorkerClient("http://127.0.0.1:8788", fetchImpl);
    const result = await client.enqueue({ jobId: "job-1", idempotencyKey: "key-1", scheduledAt: "2026-08-20T10:00:00.000Z", payload: { provider: "meta", pageId: "111", message: "Approved", simulation: false } });
    expect(result.jobId).toBe("job-1");
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8788/v1/jobs", expect.objectContaining({ method: "POST", body: expect.stringContaining("Approved") }));
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("access_token");
  });

  it("normalizes worker failures without exposing response bodies", async () => {
    const fetchImpl = vi.fn(async () => new Response("provider-secret-body", { status: 503 }));
    await expect(new DurableWorkerClient("http://127.0.0.1:8788", fetchImpl).health()).rejects.toThrow("Durable worker request failed (503)");
    await expect(new DurableWorkerClient("http://127.0.0.1:8788", fetchImpl).health()).rejects.not.toThrow("provider-secret-body");
  });

  it("invokes the default browser fetch with its Window binding", async () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    const browserFetch = function (this: unknown, _input: RequestInfo | URL): Promise<Response> {
      if (this !== globalThis.window) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(JSON.stringify({ ok: true, service: "worker" }), { status: 200, headers: { "content-type": "application/json" } }));
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: browserFetch as typeof fetch });
    try {
      await expect(new DurableWorkerClient("http://127.0.0.1:8788").health()).resolves.toMatchObject({ ok: true, service: "worker" });
    } finally {
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else Reflect.deleteProperty(globalThis, "window");
      if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor);
      else Reflect.deleteProperty(globalThis, "fetch");
    }
  });

  it("reads scalar job outcomes for local queue reconciliation", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ id: "job-1", state: "completed", provider_job_id: "meta-1", attempts: 1 }]), { status: 200 }));
    const jobs = await new DurableWorkerClient("http://127.0.0.1:8788", fetchImpl).listJobs();
    expect(jobs[0]).toMatchObject({ id: "job-1", state: "completed", provider_job_id: "meta-1" });
  });

  it("scopes health and job reads to the active workspace", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, queue: { queued: 1, running: 0, completed: 0, failed: 0 } }), { status: 200 }));
    const client = new DurableWorkerClient("http://127.0.0.1:8788", fetchImpl);
    await client.health("workspace-a");
    await client.listJobs("workspace-a");
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "http://127.0.0.1:8788/health?workspace_id=workspace-a", expect.anything());
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "http://127.0.0.1:8788/v1/jobs?workspace_id=workspace-a", expect.anything());
  });

  it("sends durable publish, reschedule and cancel mutations", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "job-1", state: "queued", scheduled_at: 1_800_000_000, revision: 1 }), { status: 200 }));
    const client = new DurableWorkerClient("http://127.0.0.1:8788", fetchImpl);
    await client.publishNow("job-1", 0, "request-now");
    await client.reschedule("job-1", "2026-09-12T10:00:00.000Z", 1, "request-reschedule");
    await client.cancel("job-1", 2, "request-cancel");
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "http://127.0.0.1:8788/v1/jobs/job-1/action", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "publish_now", request_id: "request-now", expected_revision: 0 }) }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "http://127.0.0.1:8788/v1/jobs/job-1/action", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "reschedule", request_id: "request-reschedule", expected_revision: 1, scheduled_at: 1789207200 }) }));
    expect(fetchImpl).toHaveBeenNthCalledWith(3, "http://127.0.0.1:8788/v1/jobs/job-1/action", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "cancel", request_id: "request-cancel", expected_revision: 2 }) }));
  });

  it("exposes operator-safe health and control operations", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true, service: "signalflow-automation-worker", workerMode: "simulation", executorConfigured: false, configurationStatus: "simulation", workerState: "running", acceptingJobs: true, safeStopRequested: false, supportsRecovery: true, queue: { queued: 1, running: 0, completed: 2, failed: 0 } }), { status: 200 });
      if (url.endsWith("/v1/stop")) return new Response(JSON.stringify({ ok: true, state: "stopped", acceptingJobs: false, safeStopRequested: true }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, state: "stopped", acceptingJobs: false, recoveredJobs: 1, queue: { queued: 1, running: 0, completed: 2, failed: 0 } }), { status: 200 });
    });
    const client = new DurableWorkerClient("http://127.0.0.1:8788", fetchImpl);
    expect((await client.health()).configurationStatus).toBe("simulation");
    expect((await client.safeStop("test"))).toMatchObject({ state: "stopped", acceptingJobs: false });
    expect((await client.recover("test"))).toMatchObject({ recoveredJobs: 1 });
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8788/v1/stop", expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "test" }) }));
  });

  it("uses the loopback worker by default inside Electron", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { signalflow: {} } });
    try {
      expect((createDurableWorkerClient() as unknown as { baseUrl: string }).baseUrl).toBe("http://127.0.0.1:18788");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("uses the validated Electron loopback worker URL from preload", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { signalflow: { workerUrl: "http://127.0.0.1:19788" } } });
    try {
      expect((createDurableWorkerClient() as unknown as { baseUrl: string }).baseUrl).toBe("http://127.0.0.1:19788");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("uses the Electron loopback bridge instead of browser fetch", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const invoke = vi.fn(async () => ({ status: 200, body: JSON.stringify({ ok: true, service: "signalflow-automation-worker", workerMode: "http_provider_executor", executorConfigured: true, configurationStatus: "ready", workerState: "running", acceptingJobs: true, safeStopRequested: false, supportsRecovery: true, queue: { queued: 0, running: 0, completed: 0, failed: 0 } }) }));
    const fetchImpl = vi.fn();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { signalflow: { invoke } } });
    try {
      expect((await new DurableWorkerClient("http://127.0.0.1:18788", fetchImpl).health()).configurationStatus).toBe("ready");
      expect(invoke).toHaveBeenCalledWith("worker_request", { path: "/health", method: "GET", body: "" });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
});
