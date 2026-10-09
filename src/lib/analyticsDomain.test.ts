import { describe, expect, it } from "vitest";
async function analytics() { return await import("./analyticsDomain").catch(() => undefined); }
describe("instrumented analytics", () => {
  it("returns NOT_INSTRUMENTED rather than a decorative zero", async () => {
    const api = await analytics(); expect(api).toBeDefined(); if (!api) return;
    expect(api.reviewDecisionApprovalRate([], { clientId: "client-a", brandId: "brand-a" })).toEqual({ state: "NOT_INSTRUMENTED", code: "NO_REVIEW_DECISIONS" });
  });
  it("calculates approval-rate only from in-scope, non-simulation events", async () => {
    const api = await analytics(); expect(api).toBeDefined(); if (!api) return;
    const events = [
      { eventName: "approval.decided", clientId: "client-a", brandId: "brand-a", occurredAt: "2026-08-29T00:00:00.000Z", properties: { decision: "approved", simulation: false } },
      { eventName: "approval.decided", clientId: "client-a", brandId: "brand-a", occurredAt: "2026-08-29T00:00:00.000Z", properties: { decision: "rejected", simulation: false } },
      { eventName: "approval.decided", clientId: "client-a", brandId: "brand-a", occurredAt: "2026-08-29T00:00:00.000Z", properties: { decision: "approved", simulation: true } },
    ];
    expect(api.reviewDecisionApprovalRate(events, { clientId: "client-a", brandId: "brand-a" })).toEqual({ state: "READY", value: 0.5, numerator: 1, denominator: 2 });
  });

  it("keeps terminal publication and preflight-rate metrics blocked until their evidence exists", async () => {
    const api = await analytics(); expect(api).toBeDefined(); if (!api) return;
    expect(api.targetPublishSuccessRate([], { clientId: "client-a", brandId: "brand-a" })).toEqual({ state: "NOT_INSTRUMENTED", code: "NO_TERMINAL_PUBLICATIONS" });
    const publications = [
      { clientId: "client-a", brandId: "brand-a", state: "published", providerJobId: "provider-a", simulation: false },
      { clientId: "client-a", brandId: "brand-a", state: "published", providerJobId: "legacy-provider", legacyNonLive: true },
      { clientId: "client-a", brandId: "brand-a", state: "permanent_error", simulation: false },
      { clientId: "client-a", brandId: "brand-a", state: "retryable_error", simulation: false },
    ];
    expect(api.targetPublishSuccessRate(publications, { clientId: "client-a", brandId: "brand-a" })).toEqual({ state: "READY", value: 0.5, numerator: 1, denominator: 2 });
    expect(api.preflightBlockRateByReason([], { clientId: "client-a", brandId: "brand-a" }, "missing_approval")).toEqual({ state: "NOT_INSTRUMENTED", code: "NO_RECENT_PREFLIGHT_DATA" });
  });

  it("applies platform, binding, and terminal date filters to publish success", async () => {
    const api = await analytics(); expect(api).toBeDefined(); if (!api) return;
    const publications = [
      { clientId: "client-a", brandId: "brand-a", platform: "facebook", bindingId: "binding-a", terminalAt: "2026-09-10T00:00:00.000Z", state: "published", providerJobId: "provider-facebook" },
      { clientId: "client-a", brandId: "brand-a", platform: "instagram", bindingId: "binding-b", terminalAt: "2026-09-10T00:00:00.000Z", state: "published", providerJobId: "provider-instagram" },
      { clientId: "client-a", brandId: "brand-a", platform: "facebook", bindingId: "binding-a", terminalAt: "2026-08-01T00:00:00.000Z", state: "published", providerJobId: "provider-old" },
      { clientId: "client-a", brandId: "brand-a", platform: "facebook", bindingId: "binding-a", terminalAt: "2026-09-11T00:00:00.000Z", state: "permanent_error" },
    ];
    expect(api.targetPublishSuccessRate(publications, { clientId: "client-a", brandId: "brand-a", platform: "facebook", bindingId: "binding-a", from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T23:59:59.999Z" })).toEqual({ state: "READY", value: 0.5, numerator: 1, denominator: 2 });
  });

  it("marks stale/degraded data unusable and applies Client/Brand/platform/binding filters", async () => {
    const api = await analytics(); expect(api).toBeDefined(); if (!api) return;
    expect(api.analyticsReadiness({ dataAsOf: "2026-08-29T00:00:00.000Z", workerReconciledAt: "2026-08-29T00:00:00.000Z", now: "2026-08-29T00:20:00.000Z", workerState: "running", instrumented: true })).toEqual({ state: "STALE", decisionUse: false });
    expect(api.analyticsReadiness({ dataAsOf: "2026-08-29T00:01:00.000Z", workerReconciledAt: "2026-08-29T00:02:00.000Z", now: "2026-08-29T00:03:00.000Z", workerState: "degraded", instrumented: true })).toEqual({ state: "DEGRADED", decisionUse: false });
    const events = [{ eventName: "approval.decided", clientId: "a", brandId: "b", occurredAt: "2026-08-29T00:00:00.000Z", properties: { platform: "facebook", bindingId: "binding-1" } }, { eventName: "approval.decided", clientId: "a", brandId: "b", occurredAt: "2026-08-29T00:00:00.000Z", properties: { platform: "instagram", bindingId: "binding-2" } }];
    expect(api.filterAnalyticsEvents(events, { clientId: "a", brandId: "b", platform: "facebook", bindingId: "binding-1" })).toHaveLength(1);
  });

  it("applies platform, binding, and date scope inside every event metric helper", async () => {
    const api = await analytics(); expect(api).toBeDefined(); if (!api) return;
    const events = [
      { eventName: "approval.decided", clientId: "a", brandId: "b", occurredAt: "2026-09-10T00:00:00.000Z", properties: { platform: "facebook", bindingId: "binding-1", decision: "approved" } },
      { eventName: "approval.decided", clientId: "a", brandId: "b", occurredAt: "2026-09-11T00:00:00.000Z", properties: { platform: "instagram", bindingId: "binding-2", decision: "rejected" } },
      { eventName: "approval.decided", clientId: "a", brandId: "b", occurredAt: "2026-08-31T00:00:00.000Z", properties: { platform: "facebook", bindingId: "binding-1", decision: "rejected" } },
      { eventName: "preflight.checked", clientId: "a", brandId: "b", occurredAt: "2026-09-10T00:00:00.000Z", properties: { platform: "facebook", bindingId: "binding-1", blockReason: "missing_approval" } },
      { eventName: "preflight.checked", clientId: "a", brandId: "b", occurredAt: "2026-09-11T00:00:00.000Z", properties: { platform: "instagram", bindingId: "binding-2", blockReason: "missing_approval" } },
      { eventName: "preflight.checked", clientId: "a", brandId: "b", occurredAt: "2026-08-31T00:00:00.000Z", properties: { platform: "facebook", bindingId: "binding-1", blockReason: "missing_approval" } },
    ];
    const filter = { clientId: "a", brandId: "b", platform: "facebook", bindingId: "binding-1", from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T23:59:59.999Z" };
    expect(api.eventMatchesFilter(events[0], filter)).toBe(true);
    expect(api.eventMatchesFilter(events[1], filter)).toBe(false);
    expect(api.eventMatchesFilter(events[2], filter)).toBe(false);
    expect(api.filterAnalyticsEvents(events, filter)).toHaveLength(2);
    expect(api.reviewDecisionApprovalRate(events, filter)).toEqual({ state: "READY", value: 1, numerator: 1, denominator: 1 });
    expect(api.preflightBlockRateByReason(events, filter, "missing_approval")).toEqual({ state: "READY", value: 1, numerator: 1, denominator: 1 });
  });
});
