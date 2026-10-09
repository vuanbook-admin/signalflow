import { describe, expect, it } from "vitest";
import type { BrandIdentityRecord } from "./brandIdentity";
async function context() { return await import("./promptContext").catch(() => undefined); }
describe("versioned Brand Identity prompt context", () => {
  it("serializes one bounded deterministic context with platform, prohibited claims and disclosure", async () => {
    const api = await context(); expect(api).toBeDefined(); if (!api) return;
    const identity: BrandIdentityRecord = { id: "identity-a-v2", brandId: "brand-a", name: "Default", isDefault: true, version: 2, status: "active", strategy: { vision: "Vision", mission: "Mission", values: ["honest"], personality: ["calm"], audience: "Audience" }, voice: { tone: "Clear", vocabulary: ["plain"], prohibitedClaims: ["guaranteed"], requiredDisclosure: "Educational only" }, visual: { logoAssetIds: [], colors: [{ name: "Ink", hex: "#112233" }], typography: { heading: "Inter", body: "Inter" }, styleGuide: "Clean" } };
    const result = api.buildGenerationContext(identity, { platform: "facebook", targetName: "Page A" }, "Write a helpful post");
    expect(result.identityVersionId).toBe("identity-a-v2");
    expect(result.context).toContain("Platform: facebook");
    expect(result.context).toContain("Prohibited claims: guaranteed");
    expect(result.context).toContain("Required disclosure: Educational only");
    expect(api.buildGenerationContext(identity, { platform: "facebook", targetName: "Page A" }, "x".repeat(20_000)).context.length).toBeLessThanOrEqual(12_000);
  });
});
