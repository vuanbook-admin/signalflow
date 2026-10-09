import { describe, expect, it } from "vitest";
async function transforms() { return await import("./contentTransform").catch(() => undefined); }
describe("rights-aware Content Transform", () => {
  it("blocks unreviewed imitation or repurpose before a variant exists", async () => {
    const api = await transforms(); expect(api).toBeDefined(); if (!api) return;
    expect(api.validateContentTransform({ mode: "imitation", sourceRef: "knowledge-a", rightsState: "unknown", reviewState: "pending" })).toEqual({ ok: false, code: "RIGHTS_BLOCKED" });
    expect(api.validateContentTransform({ mode: "repurpose", sourceRef: "knowledge-a", rightsState: "licensed", reviewState: "approved" })).toEqual({ ok: true });
  });
  it("does not promise detector bypass and always preserves provenance", async () => {
    const api = await transforms(); expect(api).toBeDefined(); if (!api) return;
    expect(api.transformGuidance("de_ai_detector_evasion")).toMatchObject({ sourceRefRequired: false, reviewGuidance: expect.stringContaining("Cải thiện độ tự nhiên; không bảo đảm kết quả detector.") });
  });
});
