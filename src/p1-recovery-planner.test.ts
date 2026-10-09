// @ts-expect-error Vitest executes this focused source-boundary check in Node; the app tsconfig does not include Node declarations.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { starterStrategyCatalog } from "./lib/contentStrategy";
import { strategyCatalogScopeKey } from "./lib/workspaceDomain";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const expandedViewsSource = readFileSync(new URL("./ExpandedViews.tsx", import.meta.url), "utf8");

describe("P1 recovery and planner guards", () => {
  it("removes transport catalog fields while keeping the canonical scoped catalog map", async () => {
    const appModule = await import("./App") as unknown as {
      sanitizeRecoveredBrandIdentity?: (identity: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(typeof appModule.sanitizeRecoveredBrandIdentity).toBe("function");
    if (typeof appModule.sanitizeRecoveredBrandIdentity !== "function") return;

    const catalog = starterStrategyCatalog("brand-a");
    const recovered = appModule.sanitizeRecoveredBrandIdentity({
      id: "identity-a",
      brandId: "brand-a",
      name: "Default identity",
      isDefault: true,
      version: 4,
      status: "active",
      strategy: { vision: "Vision", mission: "Mission", values: [], personality: [], audience: "Audience" },
      voice: { tone: "Warm", vocabulary: [], prohibitedClaims: [] },
      visual: { logoAssetIds: [], colors: [], typography: { heading: "Inter", body: "Inter" }, styleGuide: "" },
      strategyCatalog: catalog,
      strategyCatalogRevision: 12,
    });

    expect(recovered).toMatchObject({ id: "identity-a", brandId: "brand-a", version: 4, voice: { tone: "Warm" } });
    expect(recovered).not.toHaveProperty("strategyCatalog");
    expect(recovered).not.toHaveProperty("strategyCatalogRevision");

    const scopeKey = strategyCatalogScopeKey("client-a", "brand-a");
    const state = { strategyCatalogsByBrand: { [scopeKey]: catalog }, brandIdentities: [recovered] };
    expect(state.strategyCatalogsByBrand[scopeKey]).toBe(catalog);
    expect(state.brandIdentities[0]).not.toHaveProperty("strategyCatalog");
    expect(appSource.match(/sanitizeRecoveredBrandIdentity\(\{/g)?.length).toBe(2);
  });

  it("blocks planner save when the visible strategy snapshot requires matrix review", async () => {
    const expandedViewsModule = await import("./ExpandedViews") as unknown as {
      plannerStrategySaveBlocked?: (input: { catalogLoading: boolean; hasCatalog: boolean; catalogError: string; previewOk: boolean; staleReviewRequired: boolean }) => boolean;
    };
    expect(typeof expandedViewsModule.plannerStrategySaveBlocked).toBe("function");
    if (typeof expandedViewsModule.plannerStrategySaveBlocked !== "function") return;

    expect(expandedViewsModule.plannerStrategySaveBlocked({ catalogLoading: false, hasCatalog: true, catalogError: "", previewOk: true, staleReviewRequired: true })).toBe(true);
    expect(expandedViewsModule.plannerStrategySaveBlocked({ catalogLoading: false, hasCatalog: true, catalogError: "", previewOk: true, staleReviewRequired: false })).toBe(false);
    expect(expandedViewsModule.plannerStrategySaveBlocked({ catalogLoading: false, hasCatalog: true, catalogError: "", previewOk: false, staleReviewRequired: true })).toBe(true);
    expect(expandedViewsSource).toContain("const strategySaveBlocked = plannerStrategySaveBlocked({");
  });
});
