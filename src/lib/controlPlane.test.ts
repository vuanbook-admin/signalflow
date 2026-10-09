import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandImpactPreview, ControlPlaneClient, ControlPlaneError, brandImpactPreviewMatchesBrand, brandImpactPreviewScopeKey, createControlPlaneClient, normalizeBrandImpactPreview } from "./controlPlane";
import { setProfileRuntimeIdentity } from "./nativeRuntime";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ControlPlaneClient agency state boundary", () => {
  const impactPayload = {
    clientId: "client-b",
    brandId: "brand-b",
    brandName: "Brand B",
    brandStatus: "archived",
    deletedAt: "2026-09-14T00:00:00.000Z",
    counts: { draftCount: 3, planCount: 2, unsentScheduleCount: 1, sharedMediaCount: 4 },
    blockers: ["publication-b"],
    observedAt: "2026-09-14T00:00:00.000Z",
    revision: "a".repeat(64),
    identity: { clientId: "client-b", brandId: "brand-b", brandStatus: "archived", deletedAt: "2026-09-14T00:00:00.000Z" },
  };

  it("loads and normalizes the exact durable Brand impact response without a renderer client scope", async () => {
    const typedImpactPayload: BrandImpactPreview = impactPayload;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => typedImpactPayload });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787");

    await expect(client.brandImpactPreview("brand-b")).resolves.toEqual(impactPayload);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:18787/v1/agency/brands/brand-b/impact", expect.objectContaining({ headers: expect.anything() }));
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  it("invokes the default browser fetch with its Window binding", async () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    const browserFetch = function (this: unknown, _input: RequestInfo | URL): Promise<Response> {
      if (this !== globalThis.window) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: browserFetch as typeof fetch });
    try {
      await expect(new ControlPlaneClient("http://127.0.0.1:18787").health()).resolves.toMatchObject({ ok: true });
    } finally {
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else Reflect.deleteProperty(globalThis, "window");
      if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor);
      else Reflect.deleteProperty(globalThis, "fetch");
    }
  });

  it("aborts a never-settling lifecycle request at the bounded deadline", async () => {
    let aborted = false;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    }));
    const client = new ControlPlaneClient("http://127.0.0.1:18787", { timeoutMs: 10, fetchImpl: fetchMock as unknown as typeof fetch });
    await expect(client.permanentlyDeleteBrand("brand-a", { actorUserId: "user-a", role: "owner", capability: "manage_brand", confirmation: "Brand A" })).rejects.toMatchObject({ code: "CONTROL_PLANE_TIMEOUT", status: 504 });
    expect(aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed, mismatched, and unexpected Brand impact responses", () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["missing counts", { ...impactPayload, counts: undefined }, "BRAND_IMPACT_COUNTS_INVALID"],
      ["negative count", { ...impactPayload, counts: { ...impactPayload.counts, planCount: -1 } }, "BRAND_IMPACT_COUNTS_INVALID"],
      ["mismatched Brand", { ...impactPayload, brandId: "brand-other" }, "BRAND_IMPACT_ID_MISMATCH"],
      ["mismatched identity Client", { ...impactPayload, identity: { ...impactPayload.identity, clientId: "client-other" } }, "BRAND_IMPACT_SCOPE_MISMATCH"],
      ["unexpected status", { ...impactPayload, brandStatus: "deleted" }, "BRAND_IMPACT_STATUS_INVALID"],
    ];

    for (const [, payload, code] of cases) {
      expect(() => normalizeBrandImpactPreview(payload, "brand-b")).toThrow(expect.objectContaining({ code }));
    }
  });

  it("requires exact profile/workspace/Brand scope and current Client/Brand identity before acknowledging impact", () => {
    const preview = normalizeBrandImpactPreview(impactPayload, "brand-b");
    expect(brandImpactPreviewScopeKey("profile-a", "client-b", "brand-b")).not.toBe(brandImpactPreviewScopeKey("profile-a", "client-c", "brand-b"));
    expect(brandImpactPreviewMatchesBrand(preview, { id: "brand-b", clientId: "client-b" })).toBe(true);
    expect(brandImpactPreviewMatchesBrand(preview, { id: "brand-b", clientId: "client-other" })).toBe(false);
    expect(brandImpactPreviewMatchesBrand(preview, { id: "brand-other", clientId: "client-b" })).toBe(false);
  });
  it("binds requests to the current native profile runtime", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setProfileRuntimeIdentity({ profileId: "profile-b", runtimeId: "runtime-b-1" });
    await new ControlPlaneClient("http://127.0.0.1:18787").health();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "x-signalflow-profile-id": "profile-b", "x-signalflow-runtime-id": "runtime-b-1" });
  });

  it("uses the validated Electron loopback Control Plane URL from preload", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    Object.defineProperty(globalThis, "window", { configurable: true, value: { signalflow: { controlPlaneUrl: "http://127.0.0.1:19787" } } });
    try {
      const client = createControlPlaneClient();
      expect(client).toBeDefined();
      await client?.health();
      expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:19787/health", expect.anything());
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("sends a scalar Client intent to the Control Plane and returns its decision", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "client-a", name: "Client A", timezone: "Asia/Ho_Chi_Minh", status: "active" }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787") as unknown as { createAgencyEntity?: (entity: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>> };

    expect(client.createAgencyEntity).toBeTypeOf("function");
    if (!client.createAgencyEntity) return;
    await expect(client.createAgencyEntity("clients", { id: "client-a", name: "Client A", timezone: "Asia/Ho_Chi_Minh", status: "active" })).resolves.toMatchObject({ id: "client-a" });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:18787/v1/agency/clients", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).not.toHaveProperty("apiKey");
  });

  it("unwraps a scalar Control Plane rejection without exposing response internals", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: { code: "SENSITIVE_FIELD_REJECTED", message: "Agency operation was rejected by the Control Plane." } }) }) as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787");

    await expect(client.health()).rejects.toEqual(expect.objectContaining<Partial<ControlPlaneError>>({ code: "SENSITIVE_FIELD_REJECTED", status: 400 }));
  });

  it("keeps target publication lifecycle changes off generic agency CRUD", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787") as unknown as {
      updateAgencyEntity: (entity: string, id: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
      deleteAgencyEntity: (entity: string, id: string) => Promise<void>;
    };

    expect(() => client.updateAgencyEntity("target-publications", "publication-a", { state: "published", providerJobId: "forged-provider-id" })).toThrow(expect.objectContaining({ code: "TARGET_PUBLICATION_COMMAND_REQUIRED" }));
    expect(() => client.deleteAgencyEntity("target-publications", "publication-a")).toThrow(expect.objectContaining({ code: "TARGET_PUBLICATION_COMMAND_REQUIRED" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("commits a scalar migration before reporting the renderer migration marker", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ controlPlaneMigrated: true, clientCount: 1, brandCount: 1, identityCount: 1, bindingCount: 0 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787") as unknown as { commitAgencyMigration?: (payload: Record<string, unknown>) => Promise<{ controlPlaneMigrated: boolean }> };

    expect(client.commitAgencyMigration).toBeTypeOf("function");
    if (!client.commitAgencyMigration) return;
    await expect(client.commitAgencyMigration({ clients: [], brands: [], identities: [], connections: [], bindings: [] })).resolves.toEqual(expect.objectContaining({ controlPlaneMigrated: true }));
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:18787/v1/agency/migrations/commit", expect.objectContaining({ method: "POST" }));
  });

  it("keeps knowledge/archive/probe actions on the Control Plane boundary", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: "knowledge-a", clientId: "client-a", brandId: "brand-a" }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "knowledge-a", archiveState: "archived" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "profile-a", status: "connected" }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787");
    await expect(client.listAgencyRecords("knowledge-items", { clientId: "client-a", brandId: "brand-a" })).resolves.toHaveLength(1);
    await expect(client.archiveKnowledgeItem("knowledge-a")).resolves.toEqual({ id: "knowledge-a", archiveState: "archived" });
    await expect(client.probeGenerationProfile("profile-a")).resolves.toMatchObject({ status: "connected" });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("clientId=client-a");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/archive");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/probe");
  });

  it("approves Research Evidence through the scoped command and returns the canonical record", async () => {
    const record = { id: "evidence/a", clientId: "client-a", brandId: "brand-a", sourceUrl: "https://example.test", sourceTitle: "Source", retrievedAt: "2026-09-13T00:00:00.000Z", summary: "Summary", rightsState: "licensed", reviewState: "approved", sourceType: "operator_selected" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => record });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787");
    const payload = { brandId: "brand-a", actor: { actorUserId: "user-a", role: "owner" as const, capability: "manage_brand" as const } };
    await expect(client.approveResearchEvidence("evidence/a", payload)).resolves.toEqual(record);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:18787/v1/agency/research-evidence/evidence%2Fa/approve", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual(payload);
  });

  it("persists target approval, target-scoped commands and outbox recovery through the Control Plane", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "publication-a", commandStatus: "acknowledged", revision: 0 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "publication-a", commandStatus: "acknowledged", revision: 1, state: "queued" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ recovered: 1, pending: 0 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787");
    const approval = { id: "publication-a", clientId: "client-a", brandId: "brand-a", bindingId: "binding-a", variantId: "variant-a", idempotencyKey: "key-a", approvalState: "approved", planId: "plan-a", scheduledAt: "2026-09-14T09:00:00.000Z", simulation: false, requestId: "approve-job-a", workerJob: { jobId: "job-a", idempotencyKey: "key-a", scheduledAt: "2026-09-14T09:00:00.000Z", payload: { target_publication_id: "publication-a", binding_id: "binding-a", page_id: "page-a", plan_id: "plan-a", approval_state: "approved", simulation: false } } };

    await expect(client.approveTargetPublication(approval)).resolves.toMatchObject({ id: "publication-a", commandStatus: "acknowledged" });
    await client.targetPublicationCommand("publication-a", { action: "publish_now", clientId: "client-a", brandId: "brand-a", expectedRevision: 0, requestId: "publish-now-a" });
    await expect(client.recoverPublicationCommands()).resolves.toEqual({ recovered: 1, pending: 0 });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://127.0.0.1:18787/v1/agency/target-publications/approve", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({ id: "publication-a", planId: "plan-a", workerJob: { jobId: "job-a", payload: { target_publication_id: "publication-a" } } });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://127.0.0.1:18787/v1/agency/target-publications/publication-a/commands", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({ action: "publish_now", expectedRevision: 0, requestId: "publish-now-a" });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:18787/v1/agency/target-publications/commands/recover", expect.objectContaining({ method: "POST" }));
  });

  it("compensates the first acknowledged target when a later fan-out approval fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "publication-page-a", clientId: "client-a", brandId: "brand-a", workerJobId: "job-page-a", state: "scheduled", simulation: false, workerAckState: "acknowledged", commandStatus: "acknowledged", revision: 0 }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ detail: { code: "TARGET_PUBLICATION_SLOT_CONFLICT", message: "Rejected" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "publication-page-a", state: "canceled", commandStatus: "acknowledged", revision: 1 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787");
    const target = (pageId: string) => ({ id: `publication-${pageId}`, clientId: "client-a", brandId: "brand-a", bindingId: `binding-${pageId}`, variantId: `variant-${pageId}`, idempotencyKey: `key-${pageId}`, approvalState: "approved", planId: "plan-a", scheduledAt: "2026-09-14T09:00:00.000Z", simulation: false, requestId: `approve-${pageId}`, workerJob: { jobId: `job-${pageId}`, idempotencyKey: `key-${pageId}`, scheduledAt: "2026-09-14T09:00:00.000Z", payload: { target_publication_id: `publication-${pageId}`, binding_id: `binding-${pageId}`, page_id: pageId, plan_id: "plan-a", approval_state: "approved", simulation: false } } });

    const result = await client.approveTargetPublications([target("page-a"), target("page-b")]);
    expect(result).toMatchObject({ failureCode: "TARGET_PUBLICATION_SLOT_CONFLICT", compensated: true, pending: [] });
    expect(fetchMock.mock.calls).toHaveLength(3);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).workerJob.payload).toMatchObject({ target_publication_id: "publication-page-a", page_id: "page-a" });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string).workerJob.payload).toMatchObject({ target_publication_id: "publication-page-b", page_id: "page-b" });
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/target-publications/publication-page-a/commands");
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toMatchObject({ action: "cancel", expectedRevision: 0 });
  });

  it("keeps acknowledged siblings pending while one fan-out target is retryable, then recovers every target ID", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "publication-page-a", clientId: "client-a", brandId: "brand-a", workerJobId: "job-page-a", targetExternalId: "page-a", state: "scheduled", simulation: false, workerAckState: "acknowledged", commandStatus: "acknowledged", revision: 0 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "publication-page-b", clientId: "client-a", brandId: "brand-a", workerJobId: "job-page-b", targetExternalId: "page-b", pendingCommandId: "approve-page-b", commandStatus: "pending", revision: 0 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "publication-page-a", clientId: "client-a", brandId: "brand-a", workerJobId: "job-page-a", targetExternalId: "page-a", state: "scheduled", simulation: false, workerAckState: "acknowledged", commandStatus: "acknowledged", revision: 0 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "publication-page-b", clientId: "client-a", brandId: "brand-a", workerJobId: "job-page-b", targetExternalId: "page-b", state: "scheduled", simulation: false, workerAckState: "acknowledged", commandStatus: "acknowledged", revision: 0 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787");
    const target = (pageId: string) => ({ id: `publication-${pageId}`, clientId: "client-a", brandId: "brand-a", bindingId: `binding-${pageId}`, variantId: `variant-${pageId}`, idempotencyKey: `key-${pageId}`, approvalState: "approved", planId: "plan-a", scheduledAt: "2026-09-14T09:00:00.000Z", simulation: false, requestId: `approve-${pageId}`, workerJob: { jobId: `job-${pageId}`, idempotencyKey: `key-${pageId}`, scheduledAt: "2026-09-14T09:00:00.000Z", payload: { target_publication_id: `publication-${pageId}`, binding_id: `binding-${pageId}`, page_id: pageId, plan_id: "plan-a", approval_state: "approved", simulation: false } } });
    const targets = [target("page-a"), target("page-b")];

    const partial = await client.approveTargetPublications(targets);
    expect(partial.complete).toBe(false);
    expect(partial.acknowledged.map((item) => item.id)).toEqual(["publication-page-a"]);
    expect(partial.pending.map((item) => item.id)).toEqual(["publication-page-b"]);
    expect(partial.results.map((item) => [item.publicationId, item.targetPageId, item.status])).toEqual([
      ["publication-page-a", "page-a", "acknowledged"],
      ["publication-page-b", "page-b", "pending"],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const recovered = await client.approveTargetPublications(targets);
    expect(recovered.complete).toBe(true);
    expect(recovered.acknowledged.map((item) => item.id)).toEqual(["publication-page-a", "publication-page-b"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/target-publications/approve");
    expect(JSON.parse(fetchMock.mock.calls[3]?.[1]?.body as string).workerJob.payload).toMatchObject({ target_publication_id: "publication-page-b", page_id: "page-b" });
  });

  it("does not treat an acknowledged replay of a canceled publication as an approval", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "publication-canceled", clientId: "client-a", brandId: "brand-a", workerJobId: "job-canceled", targetExternalId: "page-a", state: "canceled", workerAckState: "acknowledged", commandStatus: "acknowledged", revision: 2 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787");
    const payload = { id: "publication-canceled", clientId: "client-a", brandId: "brand-a", bindingId: "binding-a", variantId: "variant-a", idempotencyKey: "key-a", approvalState: "approved", requestId: "approve-publication-canceled", scheduledAt: "2026-09-14T09:00:00.000Z", simulation: false, workerJob: { jobId: "job-canceled", idempotencyKey: "key-a", scheduledAt: "2026-09-14T09:00:00.000Z", payload: { target_publication_id: "publication-canceled", binding_id: "binding-a", page_id: "page-a", approval_state: "approved", simulation: false } } };

    const result = await client.approveTargetPublications([payload]);
    expect(result.complete).toBe(false);
    expect(result.acknowledged).toEqual([]);
    expect(result.failed.map((item) => item.id)).toEqual(["publication-canceled"]);
    expect(result.results).toMatchObject([{ publicationId: "publication-canceled", status: "failed", errorCode: "TARGET_PUBLICATION_ALREADY_TERMINAL" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a simulated or legacy target before dispatching approval", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787");
    const liveFields = { id: "publication-simulation", clientId: "client-a", brandId: "brand-a", bindingId: "binding-a", variantId: "variant-a", idempotencyKey: "key-a", approvalState: "approved", scheduledAt: "2026-09-14T09:00:00.000Z", workerJob: { jobId: "job-a", payload: { page_id: "page-a", approval_state: "approved" } } };

    await expect(client.approveTargetPublications([{ ...liveFields, simulation: true }])).rejects.toMatchObject({ code: "TARGET_PUBLICATION_SIMULATION_REMOVED" });
    await expect(client.approveTargetPublications([{ ...liveFields, legacyNonLive: true }])).rejects.toMatchObject({ code: "LEGACY_NON_LIVE_ACTION_BLOCKED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a worker-backed approval payload before dispatch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787");

    await expect(client.approveTargetPublications([{ id: "publication-no-worker", clientId: "client-a", brandId: "brand-a", bindingId: "binding-a", variantId: "variant-a", idempotencyKey: "key-a", approvalState: "approved", scheduledAt: "2026-09-14T09:00:00.000Z" }])).rejects.toMatchObject({ code: "TARGET_PUBLICATION_WORKER_REQUIRED" });
    await expect(client.approveTargetPublications([{ id: "publication-invalid-worker", clientId: "client-a", brandId: "brand-a", bindingId: "binding-a", variantId: "variant-a", idempotencyKey: "key-a", approvalState: "approved", scheduledAt: "2026-09-14T09:00:00.000Z", workerJob: { jobId: "job-a", payload: "invalid" } }])).rejects.toMatchObject({ code: "TARGET_PUBLICATION_WORKER_PAYLOAD_REQUIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks target commands for migrated non-live rows before dispatch", () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ControlPlaneClient("http://127.0.0.1:18787");

    expect(() => client.targetPublicationCommand("publication-legacy", { action: "cancel", clientId: "client-a", brandId: "brand-a", legacyNonLive: true })).toThrow(expect.objectContaining({ code: "LEGACY_NON_LIVE_ACTION_BLOCKED" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
