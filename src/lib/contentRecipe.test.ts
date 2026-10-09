import { describe, expect, it } from "vitest";
async function recipes() { return await import("./contentRecipe").catch(() => undefined); }
describe("Brand-scoped Content Recipes", () => {
  it("serializes one compatible recipe through the controlled prompt context", async () => {
    const api = await recipes(); expect(api).toBeDefined(); if (!api) return;
    const recipe = { id: "recipe-a", brandId: "brand-a", name: "Educational", platforms: ["facebook"], contentKinds: ["text"], hookGuidance: "Start with one insight", structureGuidance: "Context then action", ctaGuidance: "Save this", qualityChecklist: ["factual review"], status: "active" } as const;
    expect(api.validateContentRecipe(recipe, "brand-a", "facebook", "text")).toEqual({ ok: true });
    expect(api.serializeContentRecipe(recipe)).toContain("Hook: Start with one insight");
  });

  it("accepts a recipe only when its optional strategy references match", async () => {
    const api = await recipes(); expect(api).toBeDefined(); if (!api) return;
    const recipe = { id: "recipe-a", brandId: "brand-a", name: "Guide", platforms: ["facebook"], contentKinds: ["text"], pillarId: "practical-education", angleId: "practical-education-checklist", hookGuidance: "Open with a question", structureGuidance: "Question then steps", ctaGuidance: "Save it", qualityChecklist: ["Check facts"], status: "active" } as const;
    expect(api.validateContentRecipeForStrategy(recipe, { pillarId: "practical-education", angleId: "practical-education-checklist" })).toEqual({ ok: true });
    expect(api.validateContentRecipeForStrategy(recipe, { pillarId: "practical-education", angleId: "practical-education-common-mistake" })).toEqual({ ok: false, code: "RECIPE_STRATEGY_MISMATCH" });
  });

  it("keeps legacy recipes on the existing serialized compatibility path", async () => {
    const api = await recipes(); expect(api).toBeDefined(); if (!api) return;
    const recipe = { id: "legacy", brandId: "brand-a", name: "Legacy", platforms: ["facebook"], contentKinds: ["text"], hookGuidance: "Hook", structureGuidance: "Structure", ctaGuidance: "CTA", qualityChecklist: ["Check"], status: "active" } as const;
    expect(api.serializeContentRecipe(recipe)).toBe("Recipe: Legacy\nHook: Hook\nStructure: Structure\nCTA: CTA\nQuality checks: Check");
  });

  it("excludes other-brand, inactive, wrong-platform, wrong-kind and mismatched-strategy recipes", async () => {
    const api = await recipes(); expect(api).toBeDefined(); if (!api) return;
    const strategy = { pillarId: "practical-education", angleId: "practical-education-checklist" };
    const base = { platforms: ["facebook" as const], contentKinds: ["text" as const], hookGuidance: "Hook", structureGuidance: "Structure", ctaGuidance: "CTA", qualityChecklist: ["Check"] };
    const matching = { ...base, id: "matching", brandId: "brand-a", name: "Matching", status: "active" as const, ...strategy };
    const legacy = { ...base, id: "legacy", brandId: "brand-a", name: "Legacy", status: "active" as const };
    const candidates = [
      matching,
      legacy,
      { ...base, id: "other-brand", brandId: "brand-b", name: "Other brand", status: "active" as const },
      { ...base, id: "inactive", brandId: "brand-a", name: "Inactive", status: "archived" as const },
      { ...base, id: "wrong-platform", brandId: "brand-a", name: "Wrong platform", platforms: ["instagram" as const], status: "active" as const },
      { ...base, id: "wrong-kind", brandId: "brand-a", name: "Wrong kind", contentKinds: ["image" as const], status: "active" as const },
      { ...base, id: "strategy-mismatch", brandId: "brand-a", name: "Strategy mismatch", status: "active" as const, pillarId: "proof-and-process", angleId: "proof-and-process-proof-point" },
    ];
    const eligible = candidates.filter((recipe) => api.validateContentRecipe(recipe, "brand-a", "facebook", "text").ok && api.validateContentRecipeForStrategy(recipe, strategy).ok);
    expect(eligible.map((recipe) => recipe.id)).toEqual(["matching", "legacy"]);
    expect(api.validateContentRecipe(candidates[2]!, "brand-a", "facebook", "text")).toEqual({ ok: false, code: "RECIPE_UNAVAILABLE" });
    expect(api.validateContentRecipe(candidates[3]!, "brand-a", "facebook", "text")).toEqual({ ok: false, code: "RECIPE_UNAVAILABLE" });
    expect(api.validateContentRecipe(candidates[4]!, "brand-a", "facebook", "text")).toEqual({ ok: false, code: "RECIPE_INCOMPATIBLE" });
    expect(api.validateContentRecipe(candidates[5]!, "brand-a", "facebook", "text")).toEqual({ ok: false, code: "RECIPE_INCOMPATIBLE" });
    expect(api.validateContentRecipeForStrategy(candidates[6]!, strategy)).toEqual({ ok: false, code: "RECIPE_STRATEGY_MISMATCH" });
    expect(api.validateContentRecipeForStrategy(legacy, strategy)).toEqual({ ok: true });
  });
});
