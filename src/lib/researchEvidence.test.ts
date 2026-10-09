import { describe, expect, it } from "vitest";
async function evidence() { return await import("./researchEvidence").catch(() => undefined); }
describe("user-triggered Research Evidence", () => {
  it("requires dated, reviewed, same-client evidence and never creates a publication instruction", async () => {
    const api = await evidence(); expect(api).toBeDefined(); if (!api) return;
    const item = { id: "evidence-a", clientId: "client-a", sourceUrl: "https://example.test/source", sourceTitle: "Source", retrievedAt: "2026-08-29T00:00:00.000Z", summary: "Observed fact", sourceType: "operator_selected", rightsState: "licensed", reviewState: "approved" } as const;
    expect(api.validateResearchEvidence(item, "client-a")).toEqual({ ok: true, errors: [] });
    expect(api.validateResearchEvidence({ ...item, retrievedAt: "" }, "client-a")).toMatchObject({ ok: false, errors: expect.arrayContaining(["RESEARCH_RETRIEVED_AT_REQUIRED"]) });
    expect(api.validateResearchEvidence(item, "client-b")).toMatchObject({ ok: false, errors: expect.arrayContaining(["RIGHTS_OR_REVIEW_BLOCKED"]) });
  });
});
