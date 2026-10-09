import { describe, expect, it } from "vitest";
import { createTargetPublicationIdempotencyKey, LocalPublishQueue, PublishQueueError } from "./publishQueue";

describe("target publication idempotency", () => {
  it("keys each target publication by Client, Brand, Binding, Variant and schedule", () => {
    const key = createTargetPublicationIdempotencyKey("client-a", "brand-a", "binding-a", "variant-a", "2026-08-29T09:00:00.000Z");
    expect(key).toMatch(/^target-publication:[a-f0-9]{16}$/);
    expect(key).toBe(createTargetPublicationIdempotencyKey("client-a", "brand-a", "binding-a", "variant-a", "2026-08-29T09:00:00.000Z"));
    expect(key).not.toBe(createTargetPublicationIdempotencyKey("client-a", "brand-a", "binding-b", "variant-a", "2026-08-29T09:00:00.000Z"));
  });

  it("stores one target publication context on an approved queue job", () => {
    const queue = new LocalPublishQueue();
    const variant = { id: "variant-a", contentId: "content-a", platform: "facebook" as const, kind: "text" as const, title: "Draft", body: "Approved", mediaAssetIds: [], hashtags: [], metadata: {}, lifecycle: "approved" as const };
    const connection = { id: "connection-a", workspaceId: "client-a", platform: "facebook" as const, accountId: "page-a", displayName: "Page A", status: "connected" as const, scopes: ["pages_manage_posts", "pages_read_engagement"], providerMetadata: { connectionMode: "official" } };
    const job = queue.approveAndQueue(variant, connection, new Date(Date.now() + 60_000), { clientId: "client-a", brandId: "brand-a", bindingId: "binding-a" });
    expect(job).toMatchObject({ clientId: "client-a", brandId: "brand-a", bindingId: "binding-a", idempotencyKey: createTargetPublicationIdempotencyKey("client-a", "brand-a", "binding-a", "variant-a", job.scheduledAt) });
    expect(job).not.toHaveProperty("simulation");
    expect(job).not.toHaveProperty("legacyNonLive");
  });

  it("fans one approved variant out into independently keyed target jobs", () => {
    const queue = new LocalPublishQueue();
    const variant = { id: "variant-fanout", contentId: "content-a", platform: "facebook" as const, kind: "text" as const, title: "Draft", body: "Approved", mediaAssetIds: [], hashtags: [], metadata: {}, lifecycle: "approved" as const };
    const connection = (id: string, accountId: string) => ({ id, workspaceId: "client-a", platform: "facebook" as const, accountId, displayName: accountId, status: "connected" as const, scopes: ["pages_manage_posts", "pages_read_engagement"], providerMetadata: { connectionMode: "official" } });
    const jobs = queue.approveAndQueueTargets(variant, [
      { connection: connection("connection-1", "page-1"), bindingId: "binding-1", clientId: "client-a", brandId: "brand-a" },
      { connection: connection("connection-2", "page-2"), bindingId: "binding-2", clientId: "client-a", brandId: "brand-a" },
    ], new Date(Date.now() + 60_000));
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((job) => job.bindingId))).toEqual(new Set(["binding-1", "binding-2"]));
    expect(new Set(jobs.map((job) => job.idempotencyKey)).size).toBe(2);
  });

  it("rejects simulation-only target input before storing a queue job", () => {
    const queue = new LocalPublishQueue();
    const variant = { id: "variant-replay", contentId: "content-a", platform: "facebook" as const, kind: "text" as const, title: "Draft", body: "Approved", mediaAssetIds: [], hashtags: [], metadata: {}, lifecycle: "approved" as const };
    const connection = { id: "connection-a", workspaceId: "client-a", platform: "facebook" as const, accountId: "page-a", displayName: "Page A", status: "connected" as const, scopes: ["pages_manage_posts", "pages_read_engagement"], providerMetadata: { connectionMode: "simulation" } };
    expect(() => queue.approveAndQueue(variant, connection, new Date(Date.now() + 60_000))).toThrowError(new PublishQueueError("LIVE_CONNECTION_REQUIRED", "A provider-backed connection is required for publication."));
    expect(() => queue.approveAndQueue(variant, { ...connection, providerMetadata: { connectionMode: "official" } }, new Date(Date.now() + 60_000), { clientId: "client-a", brandId: "brand-a", bindingId: "binding-a", simulation: true })).toThrow(expect.objectContaining({ code: "TARGET_PUBLICATION_SIMULATION_REMOVED" }));
    expect(queue.list()).toHaveLength(0);
  });

  it("does not enqueue a target publication when the variant is not approved", () => {
    const queue = new LocalPublishQueue();
    const variant = { id: "variant-unapproved", contentId: "content-a", platform: "facebook" as const, kind: "text" as const, title: "Draft", body: "Draft", mediaAssetIds: [], hashtags: [], metadata: {}, lifecycle: "needs_review" as const };
    const connection = { id: "connection-a", workspaceId: "client-a", platform: "facebook" as const, accountId: "page-a", displayName: "Page A", status: "connected" as const, scopes: ["pages_manage_posts", "pages_read_engagement"], providerMetadata: { connectionMode: "official" } };
    expect(queue.approveAndQueue(variant, connection, new Date(Date.now() + 60_000), { clientId: "client-a", brandId: "brand-a", bindingId: "binding-a", identityVersionId: "identity-a-v1" }).state).toBe("preflight_failed");
  });

  it("hydrates legacy simulation jobs as read-only non-live history", () => {
    const queue = new LocalPublishQueue();
    queue.hydrate({
      jobs: [{ id: "legacy-job", variantId: "variant-legacy", connectionId: "connection-legacy", scheduledAt: "2026-09-12T09:00:00.000Z", idempotencyKey: "legacy-key", state: "retryable_error", attempts: 1, simulation: true }],
      variants: [],
      connections: [],
      auditEntries: [],
    });

    expect(queue.list()[0]).toMatchObject({ legacyNonLive: true, simulation: true });
    expect(() => queue.retry("legacy-job", new Date("2026-09-13T09:00:00.000Z"))).toThrow(expect.objectContaining({ code: "LEGACY_NON_LIVE_ACTION_BLOCKED" }));
    expect(() => queue.cancel("legacy-job")).toThrow(expect.objectContaining({ code: "LEGACY_NON_LIVE_ACTION_BLOCKED" }));
  });
});
