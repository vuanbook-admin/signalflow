import { describe, expect, it } from "vitest";
import { createBrandDraft, createClient, defaultWorkspaceState, ensureBrandScheduleTemplate, ensureBrandStrategyCatalog, strategyCatalogScopeKey, switchBrand, switchWorkspace } from "./workspaceDomain";

describe("Client and Brand setup", () => {
  it("creates a Client and a draft Brand without exposing it across Client boundaries", () => {
    const client = createClient("Client A", "UTC", "client-a");
    const brand = createBrandDraft(client.id, "Brand A", "brand-a");
    const state = { ...defaultWorkspaceState, workspaces: [...defaultWorkspaceState.workspaces, client], brands: [...defaultWorkspaceState.brands, brand] };
    const switched = switchWorkspace(state, client.id);
    expect(switched.activeBrandId).toBe("brand-a");
    expect(switchBrand(defaultWorkspaceState, "brand-a")).toEqual(defaultWorkspaceState);
    expect(brand.status).toBe("draft");
  });

  it("does not create a default schedule for draft or archived/trashed Brands", () => {
    const now = new Date("2026-09-14T00:00:00.000Z");
    const client = createClient("Client A", "UTC", "client-a");
    const draft = createBrandDraft(client.id, "Draft", "brand-draft");
    const trashed = { ...createBrandDraft(client.id, "Trashed", "brand-trashed"), status: "archived" as const, deletedAt: now.toISOString() };
    const state = { ...structuredClone(defaultWorkspaceState), activeWorkspaceId: client.id, activeBrandId: draft.id, workspaces: [client], brands: [draft, trashed] };

    const withDraft = ensureBrandScheduleTemplate(state, client.id, draft.id, now);
    const withTrashed = ensureBrandScheduleTemplate(state, client.id, trashed.id, now);

    expect(withDraft.scheduleTemplatesByBrand?.[strategyCatalogScopeKey(client.id, draft.id)]).toBeUndefined();
    expect(withTrashed.scheduleTemplatesByBrand?.[strategyCatalogScopeKey(client.id, trashed.id)]).toBeUndefined();
  });

  it("normalizes existing schedules to explicit ordered weekdays and detached scoped copies", () => {
    const now = new Date("2026-09-14T00:00:00.000Z");
    const clientA = createClient("Client A", "Not/AZone", "client-a");
    const clientB = createClient("Client B", "Not/AZone", "client-b");
    const brandA = { ...createBrandDraft(clientA.id, "Shared A", "brand-shared"), status: "active" as const };
    const brandB = { ...createBrandDraft(clientB.id, "Shared B", "brand-shared"), status: "active" as const };
    const sharedTemplate = { id: "legacy-schedule", brandId: "brand-shared", timezone: "Not/AZone", timesByWeekday: { 1: ["18:00", "09:00"] }, version: 4, updatedAt: now.toISOString() };
    const keyA = strategyCatalogScopeKey(clientA.id, brandA.id);
    const keyB = strategyCatalogScopeKey(clientB.id, brandB.id);
    const state = { ...structuredClone(defaultWorkspaceState), workspaces: [clientA, clientB], brands: [brandA, brandB], scheduleTemplatesByBrand: { [keyA]: sharedTemplate, [keyB]: sharedTemplate } };

    const result = ensureBrandScheduleTemplate(state, clientA.id, brandA.id, now);
    const templateA = result.scheduleTemplatesByBrand?.[keyA];
    const templateB = result.scheduleTemplatesByBrand?.[keyB];

    expect(templateA).toMatchObject({ brandId: brandA.id, timezone: "Asia/Ho_Chi_Minh", version: 4 });
    expect(Object.keys(templateA?.timesByWeekday ?? {})).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(templateA?.timesByWeekday[1]).toEqual(["09:00", "18:00"]);
    expect(templateB?.timesByWeekday[1]).toEqual(["09:00", "18:00"]);
    templateA?.timesByWeekday[1]?.push("22:00");
    expect(templateB?.timesByWeekday[1]).toEqual(["09:00", "18:00"]);
    expect(sharedTemplate.timesByWeekday[1]).toEqual(["18:00", "09:00"]);
  });

  it("keeps intentionally disabled weekdays but replaces an all-disabled active template", () => {
    const now = new Date("2026-09-14T00:00:00.000Z");
    const client = createClient("Client A", "UTC", "client-a");
    const brand = { ...createBrandDraft(client.id, "Brand A", "brand-a"), status: "active" as const };
    const key = strategyCatalogScopeKey(client.id, brand.id);
    const disabledWeekdayTemplate = {
      id: "disabled-weekday",
      brandId: brand.id,
      timezone: "UTC",
      timesByWeekday: { 1: [], 2: ["18:00", "09:00"] },
      version: 2,
      updatedAt: now.toISOString(),
    };
    const state = { ...structuredClone(defaultWorkspaceState), workspaces: [client], brands: [brand], scheduleTemplatesByBrand: { [key]: disabledWeekdayTemplate } };

    const disabled = ensureBrandScheduleTemplate(state, client.id, brand.id, now).scheduleTemplatesByBrand?.[key];
    expect(disabled?.timesByWeekday[1]).toEqual([]);
    expect(disabled?.timesByWeekday[2]).toEqual(["09:00", "18:00"]);

    const allDisabled = {
      ...disabledWeekdayTemplate,
      timesByWeekday: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] },
    };
    const repaired = ensureBrandScheduleTemplate({ ...state, scheduleTemplatesByBrand: { [key]: allDisabled } }, client.id, brand.id, now).scheduleTemplatesByBrand?.[key];
    expect(repaired?.timesByWeekday).toEqual({ 1: ["09:00"], 2: ["09:00"], 3: ["09:00"], 4: ["09:00"], 5: ["09:00"], 6: ["10:00"], 7: ["10:00"] });
  });

  it("keys catalogs by Client and Brand together and clones the tailored/starter seeds", () => {
    const now = new Date("2026-09-14T00:00:00.000Z");
    const state = {
      ...structuredClone(defaultWorkspaceState),
      activeWorkspaceId: "client-a",
      activeBrandId: "brand-shared",
      workspaces: [
        { ...createClient("Client A", "UTC", "client-a"), brandIds: ["brand-shared", "brand-bellamy-baby", "brand-trash"] },
        { ...createClient("Client B", "UTC", "client-b"), brandIds: ["brand-shared"] },
      ],
      brands: [
        { ...createBrandDraft("client-a", "Shared A", "brand-shared"), status: "active" as const },
        { ...createBrandDraft("client-b", "Shared B", "brand-shared"), status: "active" as const },
        { ...createBrandDraft("client-a", "Bellamy Baby", "brand-bellamy-baby"), status: "active" as const },
        { ...createBrandDraft("client-a", "Trashed", "brand-trash"), status: "archived" as const, deletedAt: "2026-09-13T00:00:00.000Z" },
      ],
    };
    const withA = ensureBrandScheduleTemplate(ensureBrandStrategyCatalog(state, "client-a", "brand-shared", now), "client-a", "brand-shared", now);
    const withB = ensureBrandScheduleTemplate(ensureBrandStrategyCatalog(withA, "client-b", "brand-shared", now), "client-b", "brand-shared", now);
    const result = ensureBrandStrategyCatalog(withB, "client-a", "brand-bellamy-baby", now);

    const keyA = strategyCatalogScopeKey("client-a", "brand-shared");
    const keyB = strategyCatalogScopeKey("client-b", "brand-shared");
    expect(keyA).not.toBe(keyB);
    expect(result.strategyCatalogsByBrand?.[keyA]?.brandId).toBe("brand-shared");
    expect(result.strategyCatalogsByBrand?.[keyB]?.brandId).toBe("brand-shared");
    expect(result.strategyCatalogsByBrand?.[strategyCatalogScopeKey("client-a", "brand-bellamy-baby")]?.pillars[0].id).toBe("product-proof");
    expect(result.strategyCatalogsByBrand?.[keyA]).not.toBe(result.strategyCatalogsByBrand?.[keyB]);
    expect(result.strategyCatalogsByBrand?.[strategyCatalogScopeKey("client-a", "brand-trash")]).toBeUndefined();
    expect(result.scheduleTemplatesByBrand?.[keyA]?.timezone).toBe("UTC");

    result.strategyCatalogsByBrand![keyB].pillars[0].label = "Changed only in B";
    expect(result.strategyCatalogsByBrand![keyA].pillars[0].label).toBe("Audience insight");
  });

  it("serializes Unicode scope keys identically and drops a legacy Brand-only key", () => {
    const key = strategyCatalogScopeKey("khách-hàng", "bränd-shared");
    expect(key).toBe("[\"khách-hàng\",\"bränd-shared\"]");
    const state = { ...structuredClone(defaultWorkspaceState), strategyCatalogsByBrand: { "brand-mile-mark-money": {} as never } };
    const result = ensureBrandStrategyCatalog(state, "workspace-mile-mark-money", "brand-mile-mark-money", new Date("2026-09-14T00:00:00.000Z"));
    expect(result.strategyCatalogsByBrand).not.toHaveProperty("brand-mile-mark-money");
    expect(result.strategyCatalogsByBrand).toHaveProperty(strategyCatalogScopeKey("workspace-mile-mark-money", "brand-mile-mark-money"));
  });
});
