import { describe, expect, it } from "vitest";
async function trends() { return await import("./trendSignals").catch(() => undefined); }
describe("observed Trend Signals", () => {
  it("records observed evidence without prediction or publication instruction fields", async () => {
    const api = await trends(); expect(api).toBeDefined(); if (!api) return;
    expect(api.validateTrendSignal({ id: "trend-a", clientId: "client-a", source: "operator", observedAt: "2026-08-29T00:00:00.000Z", topic: "Topic", metric: "mentions", evidenceIds: ["evidence-a"], status: "observed" })).toEqual({ ok: true, errors: [] });
    expect(api.validateTrendSignal({ id: "trend-a", clientId: "client-a", source: "operator", observedAt: "2026-08-29T00:00:00.000Z", topic: "Topic", metric: "mentions", evidenceIds: ["evidence-a"], status: "observed", forecast: "will grow" })).toMatchObject({ ok: false, errors: expect.arrayContaining(["TREND_PREDICTION_FIELD_REJECTED"]) });
  });
});
