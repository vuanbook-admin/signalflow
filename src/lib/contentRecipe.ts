import type { ContentKind, SocialPlatform } from "./mvpContracts";

export type ContentRecipe = { id: string; brandId: string; name: string; platforms: ReadonlyArray<SocialPlatform>; contentKinds: ReadonlyArray<ContentKind>; pillarId?: string; angleId?: string; hookGuidance: string; structureGuidance: string; ctaGuidance: string; qualityChecklist: ReadonlyArray<string>; status: "draft" | "active" | "archived" };

export function validateContentRecipe(recipe: ContentRecipe, brandId: string, platform: SocialPlatform, contentKind: ContentKind): { ok: true } | { ok: false; code: string } {
  if (recipe.brandId !== brandId || recipe.status !== "active") return { ok: false, code: "RECIPE_UNAVAILABLE" };
  if (!recipe.platforms.includes(platform) || !recipe.contentKinds.includes(contentKind)) return { ok: false, code: "RECIPE_INCOMPATIBLE" };
  return { ok: true };
}

export function validateContentRecipeForStrategy(recipe: ContentRecipe, strategy: { pillarId: string; angleId: string }): { ok: true } | { ok: false; code: string } {
  const legacy = recipe.pillarId === undefined && recipe.angleId === undefined;
  if (legacy) return { ok: true };
  return recipe.pillarId === strategy.pillarId && recipe.angleId === strategy.angleId ? { ok: true } : { ok: false, code: "RECIPE_STRATEGY_MISMATCH" };
}

export function serializeContentRecipe(recipe: ContentRecipe): string {
  return [`Recipe: ${recipe.name}`, `Hook: ${recipe.hookGuidance}`, `Structure: ${recipe.structureGuidance}`, `CTA: ${recipe.ctaGuidance}`, `Quality checks: ${recipe.qualityChecklist.join(", ")}`].join("\n");
}
