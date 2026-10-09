import { describe, expect, it } from "vitest";
import { defaultWorkspaceState } from "./workspaceDomain";
import { buildBrandTrashPreview, permanentlyDeleteBrand, restoreBrand, trashBrand } from "./brandTrash";

describe("brand trash", () => {
  it("moves a brand to recoverable trash and restores it as draft", () => {
    const moved = trashBrand(defaultWorkspaceState, "brand-bellamy-baby");
    expect(moved.state.brands.find((brand) => brand.id === "brand-bellamy-baby")?.status).toBe("archived");
    expect(restoreBrand(moved.state, "brand-bellamy-baby").brands.find((brand) => brand.id === "brand-bellamy-baby")?.status).toBe("draft");
  });

  it("moves the active selection away from a trashed brand", () => {
    const source = { ...defaultWorkspaceState, activeBrandId: "brand-bellamy-baby" };
    const moved = trashBrand(source, "brand-bellamy-baby");
    expect(moved.state.activeBrandId).toBe("brand-mile-mark-money");
  });

  it("requires the exact brand name for permanent deletion", () => {
    const moved = trashBrand(defaultWorkspaceState, "brand-bellamy-baby");
    expect(permanentlyDeleteBrand(moved.state, "brand-bellamy-baby", "wrong")).toEqual({ ok: false, code: "BRAND_NAME_CONFIRMATION_REQUIRED" });
    const deleted = permanentlyDeleteBrand(moved.state, "brand-bellamy-baby", "Bellamy Baby");
    expect(deleted.ok).toBe(true);
    if (deleted.ok) expect(deleted.state.brands.some((brand) => brand.id === "brand-bellamy-baby")).toBe(false);
  });

  it("restores a draft brand after trashing it", () => {
    const source = { ...defaultWorkspaceState, brands: defaultWorkspaceState.brands.map((brand) => brand.id === "brand-bellamy-baby" ? { ...brand, status: "draft" as const } : brand) };
    const moved = trashBrand(source, "brand-bellamy-baby");
    expect(restoreBrand(moved.state, "brand-bellamy-baby").brands.find((brand) => brand.id === "brand-bellamy-baby")).toMatchObject({ status: "draft", deletedAt: undefined });
  });

  it("counts drafts, plans, unsent schedules and shared media in the impact preview", () => {
    const preview = buildBrandTrashPreview(defaultWorkspaceState, "brand-bellamy-baby", {
      drafts: [{ brandId: "brand-bellamy-baby", deletedAt: undefined }, { brandId: "brand-bellamy-baby", deletedAt: "2026-01-01T00:00:00.000Z" }],
      plans: [{ brandId: "brand-bellamy-baby" }, { brandId: "brand-mile-mark-money" }],
      publications: [{ brandId: "brand-bellamy-baby", state: "scheduled" }, { brandId: "brand-bellamy-baby", state: "published" }],
      assets: [{ id: "shared", brandId: "brand-bellamy-baby", distribution: "universal" }, { id: "private", brandId: "brand-bellamy-baby" }],
    });
    expect(preview).toMatchObject({ draftCount: 1, planCount: 1, unsentScheduleCount: 1, sharedMediaCount: 1 });
  });

  it("requires a trashed brand and clears the active brand when the last brand is removed", () => {
    const onlyBrand = {
      ...defaultWorkspaceState,
      activeBrandId: "brand-bellamy-baby",
      activeWorkspaceId: "workspace-mile-mark-money",
      brands: defaultWorkspaceState.brands.filter((brand) => brand.id === "brand-bellamy-baby"),
      workspaces: defaultWorkspaceState.workspaces.map((workspace) => workspace.id === "workspace-mile-mark-money" ? { ...workspace, brandIds: ["brand-bellamy-baby"] } : workspace),
    };
    expect(permanentlyDeleteBrand(onlyBrand, "brand-bellamy-baby", "Bellamy Baby")).toEqual({ ok: false, code: "BRAND_NAME_CONFIRMATION_REQUIRED" });
    const trashed = trashBrand(onlyBrand, "brand-bellamy-baby");
    const deleted = permanentlyDeleteBrand(trashed.state, "brand-bellamy-baby", "Bellamy Baby");
    expect(deleted.ok).toBe(true);
    if (deleted.ok) expect(deleted.state).toMatchObject({ activeBrandId: "" });
  });

  it("rejects confirmation with extra whitespace and does not delete an active brand", () => {
    expect(permanentlyDeleteBrand(defaultWorkspaceState, "brand-bellamy-baby", " Bellamy Baby ")).toEqual({ ok: false, code: "BRAND_NAME_CONFIRMATION_REQUIRED" });
    expect(permanentlyDeleteBrand(defaultWorkspaceState, "brand-bellamy-baby", "Bellamy Baby")).toEqual({ ok: false, code: "BRAND_NAME_CONFIRMATION_REQUIRED" });
  });
});
