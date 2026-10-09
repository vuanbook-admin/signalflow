import { describe, expect, it } from "vitest";
import { createBrandDraft, createClient, defaultContentTemplates, defaultWorkspaceState, ensureBrandStrategyCatalog, strategyCatalogScopeKey } from "./workspaceDomain";
import { starterStrategyCatalog } from "./contentStrategy";
import { LEGACY_IDENTITY_ID_SCOPE_TOO_LONG, legacyAgencyIdentityId } from "./brandIdentity";
import { automationPlanDisplayState, createAutomationPlan, prepareAutomationPlanForSave } from "./automationPlanner";

async function loadPersistence() {
  return await import("./persistence");
}

const legacySnapshot = {
  schemaVersion: 3,
  savedAt: "2026-08-20T10:00:00.000Z",
  drafts: [{ id: "draft-1", title: "Existing draft" }],
  selectedPlatforms: ["Facebook"],
  workspaceState: defaultWorkspaceState,
  contentTemplates: defaultContentTemplates,
  mediaAssets: [{ id: "asset-1", workspaceId: "workspace-mile-mark-money", filename: "cover.png" }],
  automationPlans: [{ id: "plan-1", workspaceId: "workspace-mile-mark-money", brandId: "brand-bellamy-baby" }],
  queue: { jobs: [{ id: "job-1", idempotencyKey: "legacy-key" }], variants: [], connections: [{ id: "connection-1", workspaceId: "workspace-mile-mark-money", secretRef: "keychain:page" }] },
  automationState: { apiKey: "must-not-survive" },
};

describe("agency snapshot migration", () => {
  it("round-trips every strategy display field byte-for-byte and marks a catalog edit review-required", async () => {
    const api = await loadPersistence();
    const catalog = starterStrategyCatalog("brand-bellamy-baby", new Date("2026-09-14T00:00:00.000Z"));
    const scheduleTemplate = { id: "brand-default", campaignId: "campaign-snapshot", brandId: "brand-bellamy-baby", timezone: "UTC", timesByWeekday: { 1: ["09:00"] }, version: 1, source: "brand_default" as const };
    const plan = {
      ...createAutomationPlan("workspace-mile-mark-money", "brand-bellamy-baby", "UTC", new Date("2026-09-14T00:00:00.000Z")),
      id: "plan-snapshot-roundtrip",
      campaignId: "campaign-snapshot",
      dateRange: { startDate: "2026-09-14", endDate: "2026-09-14" },
      scheduleTemplate,
      targetChannels: ["facebook"] as Array<"facebook">,
      strategySelection: { objective: "reach" as const, pillar: "practical-education", angle: "practical-education-step-by-step-guide" },
      platforms: {
        ...createAutomationPlan("workspace-mile-mark-money", "brand-bellamy-baby", "UTC").platforms,
        facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], formatMode: "image" as const },
      },
    };
    const prepared = prepareAutomationPlanForSave({ plan, catalog, scheduleTemplate, capturedAt: "2026-09-14T01:00:00.000Z" });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    const beforeBytes = JSON.stringify(prepared.plan.strategySnapshot);
    const persisted = api.preparePersistedSnapshot({ drafts: [], selectedPlatforms: [], automationPlans: [prepared.plan], savedAt: "2026-09-14T02:00:00.000Z" });
    const reloaded = api.migrateLegacySnapshot(persisted, { migrationTimestamp: "2026-09-14T02:00:00.000Z" });
    expect(JSON.stringify(reloaded.automationPlans?.[0]?.strategySnapshot)).toBe(beforeBytes);
    expect(reloaded.automationPlans?.[0]?.strategySnapshot?.resolvedSlots[0]).toMatchObject({ capturedAt: "2026-09-14T01:00:00.000Z" });

    const editedCatalog = structuredClone(catalog);
    editedCatalog.objectives[0]!.label = "Reach renamed";
    editedCatalog.objectives[0]!.description = "Reach guidance renamed";
    const pillar = editedCatalog.pillars.find((item) => item.id === "practical-education")!;
    pillar.label = "Practical education renamed";
    pillar.description = "Pillar guidance renamed";
    const angle = pillar.angles.find((item) => item.id === "practical-education-step-by-step-guide")!;
    angle.label = "Steps renamed";
    angle.guidance = "Angle guidance renamed";
    angle.recipeId = "recipe-added-after-save";

    expect(JSON.stringify(reloaded.automationPlans?.[0]?.strategySnapshot)).toBe(beforeBytes);
    expect(automationPlanDisplayState(reloaded.automationPlans![0]!, editedCatalog)).toMatchObject({ status: "review_required", reviewRequired: true });
  });

  it("round-trips the immutable automation strategy snapshot with the plan revision", async () => {
    const api = await loadPersistence();
    const plan = {
      id: "snapshot-plan",
      workspaceId: "workspace-mile-mark-money",
      brandId: "brand-bellamy-baby",
      revision: 8,
      strategySelection: { objective: "reach", pillar: "mix", angle: "mix" },
      strategySnapshot: {
        catalogVersion: 3,
        catalogFingerprint: "catalog-fingerprint",
        selection: { objective: "reach", pillar: "mix", angle: "mix" },
        targetChannels: ["facebook"],
        resolvedFingerprint: "resolved-fingerprint",
        resolvedSlots: [],
        capturedAt: "2026-09-14T00:00:00.000Z",
        revision: 2,
      },
    } as never;
    const saved = api.preparePersistedSnapshot({ drafts: [], selectedPlatforms: [], automationPlans: [plan] });

    expect(saved.automationPlans?.[0]?.strategySnapshot).toMatchObject({ catalogVersion: 3, resolvedFingerprint: "resolved-fingerprint", revision: 8 });
    expect(saved.automationPlans?.[0]).not.toHaveProperty("contentStrategySelection");
    expect(saved.automationPlans?.[0]).not.toHaveProperty("planStrategySnapshot");
  });

  it("migrates v4 catalogs only for active scoped Brands and keeps existing versions", async () => {
    const api = await loadPersistence();
    const now = new Date("2026-09-14T00:00:00.000Z");
    const existing = { ...starterStrategyCatalog("brand-shared", now), version: 7 };
    const sourceState = {
      ...structuredClone(defaultWorkspaceState),
      workspaces: [
        { id: "client-a", name: "A", clientLabel: "Client", timezone: "UTC", brandIds: ["brand-shared", "brand-trash"], membershipIds: [] },
        { id: "client-b", name: "B", clientLabel: "Client", timezone: "UTC", brandIds: ["brand-shared"], membershipIds: [] },
      ],
      brands: [
        { id: "brand-shared", clientId: "client-a", workspaceId: "client-a", name: "A shared", systemId: "a", status: "active" as const },
        { id: "brand-shared", clientId: "client-b", workspaceId: "client-b", name: "B shared", systemId: "b", status: "active" as const },
        { id: "brand-trash", clientId: "client-a", workspaceId: "client-a", name: "Trash", systemId: "trash", status: "archived" as const, deletedAt: "2026-09-13T00:00:00.000Z" },
      ],
      strategyCatalogsByBrand: { [strategyCatalogScopeKey("client-a", "brand-shared")]: existing },
      scheduleTemplatesByBrand: {},
    };
    const migrated = api.migrateLegacySnapshot({ ...legacySnapshot, schemaVersion: 4, workspaceState: sourceState }, { migrationTimestamp: legacySnapshot.savedAt });

    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.strategyCatalogMigrationVersion).toBe(5);
    expect(migrated.workspaceState?.strategyCatalogsByBrand?.[strategyCatalogScopeKey("client-a", "brand-shared")]?.version).toBe(7);
    expect(migrated.workspaceState?.strategyCatalogsByBrand?.[strategyCatalogScopeKey("client-a", "brand-shared")]?.brandId).toBe("brand-shared");
    expect(migrated.workspaceState?.strategyCatalogsByBrand?.[strategyCatalogScopeKey("client-b", "brand-shared")]?.brandId).toBe("brand-shared");
    expect(migrated.workspaceState?.strategyCatalogsByBrand?.[strategyCatalogScopeKey("client-a", "brand-trash")]).toBeUndefined();
    expect(migrated.workspaceState?.brandIdentities?.map((identity) => identity.id)).toEqual(sourceState.brands.map((brand) => legacyAgencyIdentityId(brand)));
    expect(migrated.queue).toEqual(legacySnapshot.queue);
    expect(migrated.drafts).toEqual(legacySnapshot.drafts);

    const second = api.migrateLegacySnapshot(migrated, { migrationTimestamp: legacySnapshot.savedAt });
    expect(JSON.stringify(second)).toBe(JSON.stringify(migrated));
  });

  it("drops catalog and schedule entries with missing, wrong-client, or trashed owners", async () => {
    const api = await loadPersistence();
    const now = new Date("2026-09-14T00:00:00.000Z");
    const catalog = starterStrategyCatalog("brand-shared", now);
    const template = { id: "schedule", brandId: "brand-shared", timezone: "UTC", timesByWeekday: { 1: ["09:00"] }, version: 1, updatedAt: now.toISOString() };
    const state = {
      ...structuredClone(defaultWorkspaceState),
      workspaces: [{ id: "client-a", name: "A", clientLabel: "Client", timezone: "UTC", brandIds: ["brand-shared", "brand-trash"], membershipIds: [] }],
      brands: [
        { id: "brand-shared", clientId: "client-a", workspaceId: "client-a", name: "Shared", systemId: "shared", status: "active" as const },
        { id: "brand-trash", clientId: "client-a", workspaceId: "client-a", name: "Trash", systemId: "trash", status: "archived" as const, deletedAt: "2026-09-13T00:00:00.000Z" },
      ],
      strategyCatalogsByBrand: {
        [strategyCatalogScopeKey("client-a", "missing")]: { ...catalog, brandId: "missing" },
        [strategyCatalogScopeKey("client-b", "brand-shared")]: catalog,
        [strategyCatalogScopeKey("client-a", "brand-trash")]: { ...catalog, brandId: "brand-trash" },
      },
      scheduleTemplatesByBrand: {
        [strategyCatalogScopeKey("client-a", "missing")]: { ...template, brandId: "missing" },
        [strategyCatalogScopeKey("client-b", "brand-shared")]: template,
        [strategyCatalogScopeKey("client-a", "brand-trash")]: { ...template, brandId: "brand-trash" },
      },
    } as never;
    const migrated = api.migrateLegacySnapshot({ ...legacySnapshot, schemaVersion: 4, workspaceState: state }, { migrationTimestamp: legacySnapshot.savedAt });
    expect(Object.keys(migrated.workspaceState?.strategyCatalogsByBrand ?? {})).toEqual([strategyCatalogScopeKey("client-a", "brand-shared")]);
    expect(Object.keys(migrated.workspaceState?.scheduleTemplatesByBrand ?? {})).toEqual([strategyCatalogScopeKey("client-a", "brand-shared")]);
  });

  it("persists deterministic scoped defaults for active Brands across migration and reload", async () => {
    const api = await loadPersistence();
    const savedAt = "2026-09-14T00:00:00.000Z";
    const clientA = { id: "client-a", name: "A", clientLabel: "Client", timezone: "Not/AZone", brandIds: ["brand-shared", "brand-trash"], membershipIds: [] };
    const clientB = { id: "client-b", name: "B", clientLabel: "Client", timezone: "America/New_York", brandIds: ["brand-shared"], membershipIds: [] };
    const sourceState = {
      ...structuredClone(defaultWorkspaceState),
      activeWorkspaceId: clientA.id,
      activeBrandId: "brand-shared",
      workspaces: [clientA, clientB],
      brands: [
        { id: "brand-shared", clientId: clientA.id, workspaceId: clientA.id, name: "A shared", systemId: "a", status: "active" as const },
        { id: "brand-shared", clientId: clientB.id, workspaceId: clientB.id, name: "B shared", systemId: "b", status: "active" as const },
        { id: "brand-trash", clientId: clientA.id, workspaceId: clientA.id, name: "Trash", systemId: "trash", status: "archived" as const, deletedAt: savedAt },
      ],
      strategyCatalogsByBrand: {},
      scheduleTemplatesByBrand: {},
    };
    const source = {
      ...legacySnapshot,
      schemaVersion: 4,
      savedAt,
      workspaceState: sourceState,
      drafts: [{ id: "draft-preserved", title: "Keep me" }],
      automationPlans: [{ id: "plan-preserved", workspaceId: clientA.id, brandId: "brand-shared" }],
      contentRuns: [{ id: "run-preserved", clientId: clientA.id, brandId: "brand-shared", state: "draft" }],
    };

    const first = api.migrateLegacySnapshot(source, { migrationTimestamp: savedAt });
    const keyA = strategyCatalogScopeKey(clientA.id, "brand-shared");
    const keyB = strategyCatalogScopeKey(clientB.id, "brand-shared");
    const schedules = first.workspaceState?.scheduleTemplatesByBrand ?? {};

    expect(Object.keys(schedules)).toEqual([keyA, keyB]);
    expect(schedules[keyA]).toMatchObject({ brandId: "brand-shared", timezone: "Asia/Ho_Chi_Minh", version: 1 });
    expect(schedules[keyB]).toMatchObject({ brandId: "brand-shared", timezone: "America/New_York", version: 1 });
    expect(Object.keys(schedules[keyA]?.timesByWeekday ?? {})).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(schedules[keyA]?.timesByWeekday[1]).toEqual(["09:00"]);
    expect(schedules[strategyCatalogScopeKey(clientA.id, "brand-trash")]).toBeUndefined();
    expect(first.drafts).toEqual(source.drafts);
    expect(first.automationPlans).toMatchObject(source.automationPlans);
    expect((first as typeof first & { contentRuns?: unknown[] }).contentRuns).toEqual(source.contentRuns);

    const second = api.migrateLegacySnapshot(first, { migrationTimestamp: savedAt });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const store = new Map([["signalflow.workspace.snapshot.v3", JSON.stringify(first)]]);
    (globalThis as { window?: unknown }).window = { localStorage: { getItem: (key: string) => store.get(key) ?? null } } as unknown as Window;
    const reloaded = api.restoreSnapshot([], [], undefined, undefined, sourceState, [], []);
    expect(reloaded.workspaceState?.scheduleTemplatesByBrand?.[keyA]).toEqual(schedules[keyA]);
    expect(reloaded.workspaceState?.scheduleTemplatesByBrand?.[keyB]).toEqual(schedules[keyB]);
  });

  it("drops schedules owned by draft, archived, or deleted Brands without an active owner", async () => {
    const api = await loadPersistence();
    const savedAt = "2026-09-14T00:00:00.000Z";
    const client = createClient("Draft-only Client", "UTC", "client-draft-only");
    const draftBrand = createBrandDraft(client.id, "Draft-only Brand", "brand-draft-only");
    const archivedBrand = { ...createBrandDraft(client.id, "Archived Brand", "brand-archived-only"), status: "archived" as const, deletedAt: savedAt };
    const deletedBrand = { ...createBrandDraft(client.id, "Deleted Brand", "brand-deleted-only"), status: "active" as const, deletedAt: savedAt };
    const staleSchedule = (brandId: string) => ({ id: `stale-${brandId}`, brandId, timezone: "Not/AZone", timesByWeekday: { 1: ["not-time"] }, version: 0, updatedAt: savedAt });
    const draftKey = strategyCatalogScopeKey(client.id, draftBrand.id);
    const archivedKey = strategyCatalogScopeKey(client.id, archivedBrand.id);
    const deletedKey = strategyCatalogScopeKey(client.id, deletedBrand.id);
    const sourceState = {
      ...structuredClone(defaultWorkspaceState),
      activeWorkspaceId: client.id,
      activeBrandId: draftBrand.id,
      workspaces: [client],
      brands: [draftBrand, archivedBrand, deletedBrand],
      strategyCatalogsByBrand: {},
      scheduleTemplatesByBrand: {
        [draftKey]: staleSchedule(draftBrand.id),
        [archivedKey]: staleSchedule(archivedBrand.id),
        [deletedKey]: staleSchedule(deletedBrand.id),
      },
    };
    const source = {
      ...legacySnapshot,
      schemaVersion: 4,
      savedAt,
      workspaceState: sourceState,
      drafts: [{ id: "draft-preserved", title: "Keep this draft" }],
      automationPlans: [{ id: "plan-preserved", workspaceId: client.id, brandId: draftBrand.id }],
      contentRuns: [{ id: "run-preserved", clientId: client.id, brandId: draftBrand.id, state: "draft" }],
    };

    const first = api.migrateLegacySnapshot(source, { migrationTimestamp: savedAt });
    expect(first.workspaceState?.scheduleTemplatesByBrand).toEqual({});
    expect(first.drafts).toEqual(source.drafts);
    expect(first.automationPlans?.map((plan) => plan.id)).toEqual(["plan-preserved"]);
    expect((first as typeof first & { contentRuns?: unknown[] }).contentRuns).toEqual(source.contentRuns);

    const second = api.migrateLegacySnapshot(first, { migrationTimestamp: savedAt });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("normalizes retained active schedules through migration with scoped cloned arrays", async () => {
    const api = await loadPersistence();
    const savedAt = "2026-09-14T00:00:00.000Z";
    const clientA = createClient("Active A", "Not/AZone", "client-active-a");
    const clientB = createClient("Active B", "UTC", "client-active-b");
    const brandA = { ...createBrandDraft(clientA.id, "Shared A", "brand-shared"), status: "active" as const };
    const brandB = { ...createBrandDraft(clientB.id, "Shared B", "brand-shared"), status: "active" as const };
    const allDisabledBrand = { ...createBrandDraft(clientA.id, "All Disabled", "brand-all-disabled"), status: "active" as const };
    const keyA = strategyCatalogScopeKey(clientA.id, brandA.id);
    const keyB = strategyCatalogScopeKey(clientB.id, brandB.id);
    const allDisabledKey = strategyCatalogScopeKey(clientA.id, allDisabledBrand.id);
    const sharedTimesByWeekday = { 1: ["18:00", "09:00"], 2: [] };
    const templateA = { id: "legacy-schedule-a", brandId: "brand-shared", timezone: "Not/AZone", timesByWeekday: sharedTimesByWeekday, version: 0, updatedAt: savedAt };
    const templateB = { id: "legacy-schedule-b", brandId: "brand-shared", timezone: "UTC", timesByWeekday: sharedTimesByWeekday, version: 0, updatedAt: savedAt };
    const sourceState = {
      ...structuredClone(defaultWorkspaceState),
      activeWorkspaceId: clientA.id,
      activeBrandId: brandA.id,
      workspaces: [clientA, clientB],
      brands: [brandA, brandB, allDisabledBrand],
      strategyCatalogsByBrand: {},
      scheduleTemplatesByBrand: {
        [keyA]: templateA,
        [keyB]: templateB,
        [allDisabledKey]: { id: "all-disabled", brandId: allDisabledBrand.id, timezone: "UTC", timesByWeekday: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }, version: 4, updatedAt: savedAt },
      },
    };

    const migrated = api.migrateLegacySnapshot({ ...legacySnapshot, schemaVersion: 4, savedAt, workspaceState: sourceState }, { migrationTimestamp: savedAt });
    const schedules = migrated.workspaceState?.scheduleTemplatesByBrand ?? {};
    expect(schedules[keyA]).toMatchObject({ brandId: "brand-shared", timezone: "Asia/Ho_Chi_Minh", version: 1 });
    expect(schedules[keyB]).toMatchObject({ brandId: "brand-shared", timezone: "UTC", version: 1 });
    expect(Object.keys(schedules[keyA]?.timesByWeekday ?? {})).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(schedules[keyA]?.timesByWeekday[1]).toEqual(["09:00", "18:00"]);
    expect(schedules[keyA]?.timesByWeekday[2]).toEqual([]);
    expect(schedules[allDisabledKey]?.timesByWeekday).toEqual({ 1: ["09:00"], 2: ["09:00"], 3: ["09:00"], 4: ["09:00"], 5: ["09:00"], 6: ["10:00"], 7: ["10:00"] });
    schedules[keyA]!.timesByWeekday[1]!.push("22:00");
    expect(schedules[keyB]?.timesByWeekday[1]).toEqual(["09:00", "18:00"]);
    expect(sharedTimesByWeekday[1]).toEqual(["18:00", "09:00"]);

    const second = api.migrateLegacySnapshot(migrated, { migrationTimestamp: savedAt });
    expect(JSON.stringify(second)).toBe(JSON.stringify(migrated));
  });

  it("keeps a draft edit and saved version until a matching durable ACK", async () => {
    const api = await loadPersistence();
    const now = new Date("2026-09-14T00:00:00.000Z");
    const saved = ensureBrandStrategyCatalog(defaultWorkspaceState, "workspace-mile-mark-money", "brand-bellamy-baby", now).strategyCatalogsByBrand![strategyCatalogScopeKey("workspace-mile-mark-money", "brand-bellamy-baby")];
    const draft = api.beginStrategyCatalogSave(saved, "workspace-mile-mark-money", "brand-bellamy-baby", 4);
    draft.catalog.pillars[0].label = "Draft edit";
    expect(draft.catalog.version).toBe(1);
    const scopeKey = strategyCatalogScopeKey("workspace-mile-mark-money", "brand-bellamy-baby");
    expect(api.settleStrategyCatalogSave(draft, { clientId: "other-client", brandId: "brand-bellamy-baby", revision: 4, version: 2, fingerprint: "x", scopeKey: strategyCatalogScopeKey("other-client", "brand-bellamy-baby") }).savedVersion).toBe(1);

    const fingerprint = api.strategyCatalogFingerprint({ ...draft.catalog, version: 2 });
    const acknowledged = api.settleStrategyCatalogSave(draft, { clientId: "workspace-mile-mark-money", brandId: "brand-bellamy-baby", revision: 4, version: 2, fingerprint, scopeKey });
    expect(acknowledged.errorCode).toBeNull();
    expect(acknowledged.savedVersion).toBe(2);
    expect(acknowledged.catalog.version).toBe(2);
    expect(api.settleStrategyCatalogSave(acknowledged, { clientId: "workspace-mile-mark-money", brandId: "brand-bellamy-baby", revision: 4, version: 2, fingerprint, scopeKey })).toBe(acknowledged);

    const rejected = api.settleStrategyCatalogSave({ ...draft, catalog: { ...draft.catalog, version: 1 }, savedVersion: 1 }, { clientId: "workspace-mile-mark-money", brandId: "brand-bellamy-baby", revision: 4, version: 2, fingerprint: "bad", scopeKey });
    expect(rejected.errorCode).toBe("STRATEGY_CATALOG_ACK_INVALID");
    expect(rejected.catalog.pillars[0].label).toBe("Draft edit");
    expect(rejected.savedVersion).toBe(1);
  });

  it("requires an ACK scope key and keeps identity transport from replacing the canonical map", async () => {
    const api = await loadPersistence();
    const now = new Date("2026-09-14T00:00:00.000Z");
    const scopeKey = strategyCatalogScopeKey("workspace-mile-mark-money", "brand-bellamy-baby");
    const canonical = ensureBrandStrategyCatalog(defaultWorkspaceState, "workspace-mile-mark-money", "brand-bellamy-baby", now).strategyCatalogsByBrand![scopeKey];
    const staleIdentity = { ...canonical, version: 2, pillars: [{ ...canonical.pillars[0], label: "Stale identity copy" }, ...canonical.pillars.slice(1)] };
    const migrated = api.migrateLegacySnapshot({ ...legacySnapshot, schemaVersion: 4, workspaceState: { ...defaultWorkspaceState, strategyCatalogsByBrand: { [scopeKey]: canonical }, brandIdentities: [{ ...defaultWorkspaceState.brands[1], id: "identity-brand-bellamy-baby-v1", brandId: "brand-bellamy-baby", name: "Default", isDefault: true, version: 1, status: "active", strategyCatalog: staleIdentity }] as never } }, { migrationTimestamp: legacySnapshot.savedAt });
    expect(migrated.workspaceState?.strategyCatalogsByBrand?.[scopeKey]?.version).toBe(1);
    expect(migrated.workspaceState?.strategyCatalogsByBrand?.[scopeKey]?.pillars[0].label).not.toBe("Stale identity copy");
    expect((migrated.workspaceState?.brandIdentities?.[0] as Record<string, unknown> | undefined)?.strategyCatalog).toBeUndefined();

    const draft = api.beginStrategyCatalogSave(canonical, "workspace-mile-mark-money", "brand-bellamy-baby", 4);
    const fingerprint = api.strategyCatalogFingerprint({ ...draft.catalog, version: 2 });
    const missingScope = api.settleStrategyCatalogSave(draft, { clientId: "workspace-mile-mark-money", brandId: "brand-bellamy-baby", revision: 4, version: 2, fingerprint } as never);
    expect(missingScope.errorCode).toBe("STRATEGY_CATALOG_ACK_INVALID");
    expect(api.strategyCatalogSaveAckMatches(draft, { clientId: "workspace-mile-mark-money", brandId: "brand-bellamy-baby", revision: 4, version: 2, fingerprint, scopeKey })).toBe(true);
  });

  it("imports an identity-only catalog into the scoped map before stripping transport", async () => {
    const api = await loadPersistence();
    const now = new Date("2026-09-14T00:00:00.000Z");
    const state = structuredClone(defaultWorkspaceState);
    const brand = state.brands.find((item) => item.id === "brand-bellamy-baby")!;
    const scopeKey = strategyCatalogScopeKey(brand.workspaceId, brand.id);
    const edited = ensureBrandStrategyCatalog(state, brand.workspaceId, brand.id, now).strategyCatalogsByBrand![scopeKey];
    edited.version = 9;
    edited.pillars[0].label = "Identity transport edit";
    state.strategyCatalogsByBrand = {};
    state.brandIdentities = [{
      id: legacyAgencyIdentityId(brand),
      brandId: brand.id,
      name: "Default identity",
      isDefault: true,
      version: 1,
      status: "active",
      strategy: { vision: brand.name, mission: "Mission", values: [], personality: [], audience: "Audience" },
      voice: { tone: "Warm", vocabulary: [], prohibitedClaims: [] },
      visual: { logoAssetIds: [], colors: [{ name: "Primary", hex: "#d97706" }], typography: { heading: "Inter", body: "Inter" }, styleGuide: "Style" },
      strategyCatalog: edited,
    }] as never;

    const migrated = api.migrateLegacySnapshot({ ...legacySnapshot, schemaVersion: 4, workspaceState: state }, { migrationTimestamp: legacySnapshot.savedAt });
    const loaded = migrated.workspaceState?.strategyCatalogsByBrand?.[scopeKey];
    expect(loaded).toEqual(edited);
    expect(api.strategyCatalogFingerprint(loaded!)).toBe(api.strategyCatalogFingerprint(edited));
    expect((migrated.workspaceState?.brandIdentities?.[0] as Record<string, unknown> | undefined)?.strategyCatalog).toBeUndefined();
  });

  it("uses injective Client+Brand identity IDs for hyphenated scopes", () => {
    const first = legacyAgencyIdentityId({ id: "brand-b-c", clientId: "client-a", workspaceId: "client-a" });
    const second = legacyAgencyIdentityId({ id: "c", clientId: "client-a-brand-b", workspaceId: "client-a-brand-b" });
    expect(first).not.toBe(second);
    expect(first.endsWith("-v1")).toBe(true);
    expect(second.endsWith("-v1")).toBe(true);
  });

  it("does not promote a non-default identity-only catalog", async () => {
    const api = await loadPersistence();
    const now = new Date("2026-09-14T00:00:00.000Z");
    const state = structuredClone(defaultWorkspaceState);
    const brand = state.brands.find((item) => item.id === "brand-bellamy-baby")!;
    const scopeKey = strategyCatalogScopeKey(brand.workspaceId, brand.id);
    const transported = ensureBrandStrategyCatalog(state, brand.workspaceId, brand.id, now).strategyCatalogsByBrand![scopeKey];
    transported.version = 9;
    transported.pillars[0].label = "Non-default transport edit";
    state.strategyCatalogsByBrand = {};
    state.brandIdentities = [{
      id: "identity-non-default",
      brandId: brand.id,
      name: "Non-default identity",
      isDefault: false,
      version: 1,
      status: "active",
      strategy: { vision: brand.name, mission: "Mission", values: [], personality: [], audience: "Audience" },
      voice: { tone: "Warm", vocabulary: [], prohibitedClaims: [] },
      visual: { logoAssetIds: [], colors: [{ name: "Primary", hex: "#d97706" }], typography: { heading: "Inter", body: "Inter" }, styleGuide: "Style" },
      strategyCatalog: transported,
    }] as never;

    const migrated = api.migrateLegacySnapshot({ ...legacySnapshot, schemaVersion: 4, workspaceState: state }, { migrationTimestamp: legacySnapshot.savedAt });
    const loaded = migrated.workspaceState?.strategyCatalogsByBrand?.[scopeKey];
    expect(loaded?.version).toBe(1);
    expect(loaded?.pillars[0].label).not.toBe("Non-default transport edit");
    expect((migrated.workspaceState?.brandIdentities?.[0] as Record<string, unknown> | undefined)?.strategyCatalog).toBeUndefined();
  });

  it("rejects an overlong identity scope before hydration can produce partial state", async () => {
    const api = await loadPersistence();
    const clientId = "c".repeat(128);
    const brandId = "b".repeat(128);
    expect(() => legacyAgencyIdentityId({ id: brandId, clientId, workspaceId: clientId })).toThrow(LEGACY_IDENTITY_ID_SCOPE_TOO_LONG);
    const state = {
      ...structuredClone(defaultWorkspaceState),
      workspaces: [...defaultWorkspaceState.workspaces, { id: clientId, name: "Long Client", clientLabel: "Client", timezone: "UTC", brandIds: [brandId], membershipIds: [] }],
      brands: [...defaultWorkspaceState.brands, { id: brandId, clientId, workspaceId: clientId, name: "Long Brand", systemId: "long-brand", status: "active" as const }],
    };
    expect(() => api.migrateLegacySnapshot({ ...legacySnapshot, schemaVersion: 4, workspaceState: state }, { migrationTimestamp: legacySnapshot.savedAt })).toThrow(LEGACY_IDENTITY_ID_SCOPE_TOO_LONG);
    expect(state.brandIdentities).toBeUndefined();
    expect(state.strategyCatalogsByBrand).toBeUndefined();
  });

  it("preserves content runs and Control Plane records while adding the migration marker", async () => {
    const api = await loadPersistence();
    const source = { ...legacySnapshot, schemaVersion: 4, contentRuns: [{ id: "run-1", clientId: "client-a", brandId: "brand-a" }], controlPlaneRecords: [{ id: "cp-1", state: "durable" }] } as typeof legacySnapshot & Record<string, unknown>;
    const migrated = api.migrateLegacySnapshot(source, { migrationTimestamp: legacySnapshot.savedAt });
    expect(migrated.contentRuns).toEqual(source.contentRuns);
    expect(migrated.controlPlaneRecords).toEqual(source.controlPlaneRecords);
    expect(migrated.strategyCatalogMigrationVersion).toBe(5);
  });

  it("migrates a legacy snapshot twice with byte-identical Client/Brand/Identity state and no secrets", async () => {
    const api = await loadPersistence();
    expect(api.migrateLegacySnapshot).toBeTypeOf("function");
    if (typeof api.migrateLegacySnapshot !== "function") return;

    const first = api.migrateLegacySnapshot(legacySnapshot, { migrationTimestamp: "2026-08-20T10:00:00.000Z" });
    const second = api.migrateLegacySnapshot(legacySnapshot, { migrationTimestamp: "2026-08-20T10:00:00.000Z" });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.schemaVersion).toBe(5);
    expect(first.workspaceState?.brands.every((brand: { workspaceId: string; clientId?: string }) => brand.clientId === brand.workspaceId)).toBe(true);
    expect(first.workspaceState?.brandIdentities).toHaveLength(defaultWorkspaceState.brands.length);
    if (!first.workspaceState?.brandIdentities) return;
    expect(first.workspaceState?.brandIdentities.every((identity: { isDefault: boolean }) => identity.isDefault)).toBe(true);
    expect(first.workspaceState?.channelBindings).toEqual([]);
    expect(JSON.stringify(first)).not.toContain("must-not-survive");
    expect(JSON.stringify(first)).toContain("secretRef");
  });

  it("preserves Control-Plane-owned Client, Brand, Identity and Binding records against renderer replacement", async () => {
    const api = await loadPersistence();
    expect(api.preparePersistedSnapshot).toBeTypeOf("function");
    if (typeof api.preparePersistedSnapshot !== "function") return;

    const migrated = typeof api.migrateLegacySnapshot === "function"
      ? api.migrateLegacySnapshot(legacySnapshot, { migrationTimestamp: "2026-08-20T10:00:00.000Z", controlPlaneMigrated: true })
      : undefined;
    expect(migrated).toBeDefined();
    if (!migrated) return;
    const rendererState = { ...defaultWorkspaceState, brands: defaultWorkspaceState.brands.map((brand) => ({ ...brand, clientId: "renderer-should-not-win" })) };
    const saved = api.preparePersistedSnapshot({
      drafts: [],
      selectedPlatforms: ["Facebook"],
      workspaceState: rendererState,
      existingSnapshot: migrated,
      savedAt: "2026-08-21T10:00:00.000Z",
    });

    expect(saved.controlPlaneMigrated).toBe(true);
    expect(saved.workspaceState?.brands.map((brand: { clientId?: string }) => brand.clientId)).not.toContain("renderer-should-not-win");
    expect(saved.drafts).toEqual([]);
  });

  it("removes local media paths from migration exports", async () => {
    const api = await loadPersistence();
    const snapshot = { schemaVersion: 4, savedAt: "2026-08-20T10:00:00.000Z", drafts: [{ id: "draft-1", mediaEvidence: [{ assetId: "asset-1", localAssetPath: "/Users/private/image.png" }], generatedLocalAssetPath: "/Users/private/generated.png", mediaPreviewUrl: "file:///Users/private/preview.png", mediaThumbnailUrl: "/Users/private/thumb.png", thumbnailPath: "/Users/private/thumb.png", publicUrl: "https://cdn.example.test/keep.png" }], mediaAssets: [{ id: "asset-1", localAssetPath: "/Users/private/image.png" }] } as never;
    const sanitized = api.sanitizeSnapshotForExport(snapshot);
    expect(JSON.stringify(sanitized)).not.toContain("localAssetPath");
    expect(JSON.stringify(sanitized)).not.toContain("generatedLocalAssetPath");
    expect(JSON.stringify(sanitized)).not.toContain("mediaPreviewUrl");
    expect(JSON.stringify(sanitized)).not.toContain("mediaThumbnailUrl");
    expect(JSON.stringify(sanitized)).not.toContain("thumbnailPath");
    expect(JSON.stringify(sanitized)).not.toContain("/Users/private");
    expect(JSON.stringify(sanitized)).toContain("https://cdn.example.test/keep.png");
  });

  it("derives a binding only from verified saved connection and matching Page metadata", async () => {
    const api = await loadPersistence();
    expect(api.migrateLegacySnapshot).toBeTypeOf("function");
    if (typeof api.migrateLegacySnapshot !== "function") return;

    const migrated = api.migrateLegacySnapshot({
      ...legacySnapshot,
      queue: {
        ...legacySnapshot.queue,
        connections: [{
          id: "meta-page-bellamy",
          workspaceId: "workspace-mile-mark-money",
          platform: "facebook",
          accountId: "100000000000001",
          displayName: "Bellamy Baby",
          status: "connected",
          scopes: ["pages_manage_posts", "pages_read_engagement"],
          providerMetadata: { connectionMode: "official", verifiedAt: "2026-08-20T10:00:00.000Z" },
        }],
      },
    }, { migrationTimestamp: "2026-08-20T10:00:00.000Z" });

    expect(migrated.workspaceState?.channelBindings).toEqual([expect.objectContaining({
      brandId: "brand-bellamy-baby",
      connectionId: "meta-page-bellamy",
      targetExternalId: "100000000000001",
      state: "connected",
    })]);
  });

  it("adapts legacy targetPageIds into deterministic bindingIds without changing the old schedule", async () => {
    const api = await loadPersistence();
    expect(api.migrateLegacySnapshot).toBeTypeOf("function");
    if (typeof api.migrateLegacySnapshot !== "function") return;
    const migrated = api.migrateLegacySnapshot({ ...legacySnapshot, automationPlans: [{ id: "plan-a", workspaceId: "workspace-mile-mark-money", brandId: "brand-bellamy-baby", targetPageIds: ["100000000000001"], platforms: {}, cron: {}, status: "draft", createdAt: legacySnapshot.savedAt, updatedAt: legacySnapshot.savedAt }] }, { migrationTimestamp: legacySnapshot.savedAt });
    expect(migrated.automationPlans?.[0]).toMatchObject({ bindingIds: ["binding-brand-bellamy-baby-facebook-100000000000001"], targetPageIds: ["100000000000001"] });
  });

  it("persists the current empty Brand state after the last Control Plane Brand is removed", async () => {
    const api = await loadPersistence();
    const client = createClient("C7 Client", "UTC", "client-c7");
    const brandA = { ...createBrandDraft(client.id, "Brand A", "brand-a-c7"), status: "active" as const };
    const brandB = { ...createBrandDraft(client.id, "Brand B", "brand-b-c7"), status: "active" as const };
    const existing = api.preparePersistedSnapshot({
      drafts: [],
      selectedPlatforms: [],
      workspaceState: {
        ...structuredClone(defaultWorkspaceState),
        activeWorkspaceId: client.id,
        activeBrandId: brandB.id,
        workspaces: [{ ...client, brandIds: [brandA.id, brandB.id] }],
        brands: [brandA, brandB],
        memberships: [],
        strategyCatalogsByBrand: {},
        scheduleTemplatesByBrand: {},
      },
      controlPlaneMigrated: true,
      savedAt: "2026-09-17T06:30:00.000Z",
    });
    const current = {
      ...existing.workspaceState!,
      activeBrandId: "",
      workspaces: [{ ...client, brandIds: [] }],
      brands: [],
      brandIdentities: [],
      channelBindings: [],
      contentRecipes: [],
      strategyCatalogsByBrand: {},
      scheduleTemplatesByBrand: {},
    };

    const saved = api.preparePersistedSnapshot({
      drafts: [],
      selectedPlatforms: [],
      workspaceState: current,
      existingSnapshot: existing,
      savedAt: "2026-09-17T06:31:00.000Z",
    });

    expect(saved.workspaceState?.activeWorkspaceId).toBe(client.id);
    expect(saved.workspaceState?.activeBrandId).toBe("");
    expect(saved.workspaceState?.brands).toEqual([]);
    expect(saved.workspaceState?.workspaces).toEqual([{ ...client, brandIds: [] }]);
    expect(saved.workspaceState?.brandIdentities).toEqual([]);
    expect(saved.workspaceState?.channelBindings).toEqual([]);
    expect(saved.workspaceState?.strategyCatalogsByBrand).toEqual({});
    expect(saved.workspaceState?.scheduleTemplatesByBrand).toEqual({});

    const previousWindow = (globalThis as { window?: unknown }).window;
    const store = new Map<string, string>([["signalflow.workspace.snapshot.v3", JSON.stringify(saved)]]);
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
      },
    } as unknown as Window;
    try {
      const reloaded = api.restoreSnapshot([], [], undefined, undefined, defaultWorkspaceState, []);
      expect(reloaded.workspaceState?.activeBrandId).toBe("");
      expect(reloaded.workspaceState?.brands).toEqual([]);
    } finally {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  });

  it("keeps current Brand lifecycle changes and removes stale Control Plane records", async () => {
    const api = await loadPersistence();
    const client = createClient("C7 Client", "UTC", "client-c7-lifecycle");
    const brandA = { ...createBrandDraft(client.id, "Brand A", "brand-a-c7-lifecycle"), status: "active" as const };
    const brandB = { ...createBrandDraft(client.id, "Brand B", "brand-b-c7-lifecycle"), status: "active" as const };
    const existing = api.preparePersistedSnapshot({
      drafts: [],
      selectedPlatforms: [],
      workspaceState: {
        ...structuredClone(defaultWorkspaceState),
        activeWorkspaceId: client.id,
        activeBrandId: brandA.id,
        workspaces: [{ ...client, brandIds: [brandA.id, brandB.id] }],
        brands: [brandA, brandB],
        memberships: [],
      },
      controlPlaneMigrated: true,
      savedAt: "2026-09-17T06:30:00.000Z",
    });
    const archivedAt = "2026-09-17T06:31:00.000Z";
    const archived = api.preparePersistedSnapshot({
      drafts: [],
      selectedPlatforms: [],
      workspaceState: {
        ...existing.workspaceState!,
        activeBrandId: brandA.id,
        brands: [
          { ...brandA, name: "Brand A current" },
          { ...brandB, status: "archived" as const, deletedAt: archivedAt, name: "Brand B archived" },
        ],
      },
      existingSnapshot: existing,
      savedAt: archivedAt,
    });
    expect(archived.workspaceState?.brands).toEqual([
      { ...brandA, name: "Brand A current" },
      { ...brandB, status: "archived" as const, deletedAt: archivedAt, name: "Brand B archived" },
    ]);
    expect(archived.workspaceState?.activeBrandId).toBe(brandA.id);
    expect(archived.workspaceState?.scheduleTemplatesByBrand).not.toHaveProperty(strategyCatalogScopeKey(client.id, brandB.id));
    expect(archived.workspaceState?.strategyCatalogsByBrand).not.toHaveProperty(strategyCatalogScopeKey(client.id, brandB.id));

    const removed = api.preparePersistedSnapshot({
      drafts: [],
      selectedPlatforms: [],
      workspaceState: {
        ...archived.workspaceState!,
        brands: [{ ...brandA, name: "Brand A current" }],
        workspaces: [{ ...client, brandIds: [brandA.id] }],
        brandIdentities: (archived.workspaceState?.brandIdentities ?? []).filter((identity) => identity.brandId === brandA.id),
        channelBindings: (archived.workspaceState?.channelBindings ?? []).filter((binding) => binding.brandId === brandA.id),
      },
      existingSnapshot: existing,
      savedAt: "2026-09-17T06:32:00.000Z",
    });
    expect(removed.workspaceState?.brands.map((brand) => brand.id)).toEqual([brandA.id]);
    expect(removed.workspaceState?.workspaces[0]?.brandIds).toEqual([brandA.id]);
    expect(removed.workspaceState?.brands).not.toContainEqual(expect.objectContaining({ id: brandB.id }));
    expect(removed.workspaceState?.brandIdentities?.every((identity) => identity.brandId === brandA.id)).toBe(true);
    expect(removed.workspaceState?.channelBindings?.every((binding) => binding.brandId === brandA.id)).toBe(true);
  });

  it("removes one duplicate Brand scope without resurrecting its scoped records", async () => {
    const api = await loadPersistence();
    const clientA = createClient("C7 Client A", "UTC", "client-c7-a");
    const clientB = createClient("C7 Client B", "UTC", "client-c7-b");
    const sharedBrandId = "brand-shared-c7";
    const brandA = { ...createBrandDraft(clientA.id, "Shared Brand A", sharedBrandId), status: "active" as const };
    const brandB = { ...createBrandDraft(clientB.id, "Shared Brand B", sharedBrandId), status: "active" as const };
    const keyA = strategyCatalogScopeKey(clientA.id, sharedBrandId);
    const keyB = strategyCatalogScopeKey(clientB.id, sharedBrandId);
    const base = api.preparePersistedSnapshot({
      drafts: [],
      selectedPlatforms: [],
      workspaceState: {
        ...structuredClone(defaultWorkspaceState),
        activeWorkspaceId: clientB.id,
        activeBrandId: sharedBrandId,
        workspaces: [
          { ...clientA, brandIds: [sharedBrandId] },
          { ...clientB, brandIds: [sharedBrandId] },
        ],
        brands: [brandA, brandB],
        memberships: [],
        brandVoiceByBrand: { [keyA]: "Voice A", [keyB]: "Voice B" },
      },
      controlPlaneMigrated: true,
      savedAt: "2026-09-17T07:00:00.000Z",
    });
    const identityA = base.workspaceState?.brandIdentities?.find((identity) => identity.id === legacyAgencyIdentityId(brandA))!;
    const identityB = base.workspaceState?.brandIdentities?.find((identity) => identity.id === legacyAgencyIdentityId(brandB))!;
    const bindingAId = "binding-c7-a";
    const bindingBId = "binding-c7-b";
    const recipeAId = "recipe-c7-a";
    const recipeBId = "recipe-c7-b";
    const bindingA = { id: bindingAId, brandId: sharedBrandId, clientId: clientA.id, identityId: identityA.id, connectionId: "connection-c7-a", targetExternalId: "page-c7-a", targetName: "Page A", platform: "facebook", state: "connected" } as never;
    const bindingB = { id: bindingBId, brandId: sharedBrandId, clientId: clientB.id, identityId: identityB.id, connectionId: "connection-c7-b", targetExternalId: "page-c7-b", targetName: "Page B", platform: "facebook", state: "connected" } as never;
    const recipeA = { id: recipeAId, brandId: sharedBrandId, clientId: clientA.id } as never;
    const recipeB = { id: recipeBId, brandId: sharedBrandId, clientId: clientB.id } as never;
    const existing = {
      ...base,
      workspaceState: {
        ...base.workspaceState!,
        brandIdentities: [identityA, identityB],
        channelBindings: [bindingA, bindingB],
        contentRecipes: [recipeA, recipeB],
        strategyCatalogsByBrand: {
          ...base.workspaceState?.strategyCatalogsByBrand,
          [keyA]: starterStrategyCatalog(sharedBrandId, new Date("2026-09-17T07:00:00.000Z")),
          [keyB]: starterStrategyCatalog(sharedBrandId, new Date("2026-09-17T07:00:00.000Z")),
        },
        scheduleTemplatesByBrand: {
          ...base.workspaceState?.scheduleTemplatesByBrand,
          [keyA]: { id: "schedule-c7-a", brandId: sharedBrandId, timezone: "UTC", timesByWeekday: { 1: ["09:00"] }, version: 1, updatedAt: "2026-09-17T07:00:00.000Z" },
          [keyB]: { id: "schedule-c7-b", brandId: sharedBrandId, timezone: "UTC", timesByWeekday: { 1: ["10:00"] }, version: 1, updatedAt: "2026-09-17T07:00:00.000Z" },
        },
      },
    };
    const current = {
      ...existing.workspaceState!,
      activeWorkspaceId: clientB.id,
      activeBrandId: sharedBrandId,
      workspaces: [
        { ...clientA, brandIds: [] },
        { ...clientB, brandIds: [sharedBrandId] },
      ],
      brands: [brandB],
    };

    const saved = api.preparePersistedSnapshot({
      drafts: [],
      selectedPlatforms: [],
      workspaceState: current,
      existingSnapshot: existing,
      savedAt: "2026-09-17T07:01:00.000Z",
    });
    expect(saved.workspaceState?.brands).toEqual([brandB]);
    expect(saved.workspaceState?.workspaces.map((workspace) => workspace.brandIds)).toEqual([[], [sharedBrandId]]);
    expect(saved.workspaceState?.brandIdentities?.map((identity) => identity.id)).toEqual([identityB.id]);
    expect(saved.workspaceState?.channelBindings?.map((binding) => binding.id)).toEqual([bindingBId]);
    expect(saved.workspaceState?.contentRecipes?.map((recipe) => recipe.id)).toEqual([recipeBId]);
    expect(saved.workspaceState?.strategyCatalogsByBrand).toHaveProperty(keyB);
    expect(saved.workspaceState?.strategyCatalogsByBrand).not.toHaveProperty(keyA);
    expect(saved.workspaceState?.scheduleTemplatesByBrand).toHaveProperty(keyB);
    expect(saved.workspaceState?.scheduleTemplatesByBrand).not.toHaveProperty(keyA);

    const wrongScope = api.preparePersistedSnapshot({
      drafts: [],
      selectedPlatforms: [],
      workspaceState: { ...current, brands: [{ ...brandB, clientId: "renderer-client" }] },
      existingSnapshot: existing,
      savedAt: "2026-09-17T07:02:00.000Z",
    });
    expect(wrongScope.workspaceState?.brands).toEqual([brandB]);
  });
});
