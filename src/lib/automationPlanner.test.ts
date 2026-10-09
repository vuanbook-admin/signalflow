import { describe, expect, it } from "vitest";
import { acknowledgeAutomationPlannerDraft, AUTOMATION_PLATFORMS, automationAIPreferenceForRoute, automationAIOptionMatchesRoute, automationDraftKeyExists, automationPlanDisplayState, automationPlanMatchesBrandScope, automationPlannerDraftKey, automationPlannerScopeForBrand, automationRunDayInTimezone, beginAutomationPlannerSave, buildAutomationPlannerPreview, canApplyAutomationPlanSaveResult, canGenerateAutomationImageWithoutSource, canonicalizeAutomationPlanScope, campaignDateToInstant, campaignInstantToDate, cloneCampaignScheduleTemplate, countProviderConfirmedPublications, createAutomationPlan, dirtyPlannerDraftForScope, emptyAutomationPlatformPlan, finishAutomationPlannerSave, getAutomationPlatformPlanForPage, getDueAutomationPlans, hasPlannerStrategyOverrides, hasProviderConfirmedPublicationState, nextAutomationFormatPatch, normalizeAutomationPlan, normalizePlannerStrategyPlan, plannerDraftForScope, plannerStrategyChoices, prepareAutomationPlanForSave, resolveAutomationAI, resolveFormatSequence, reviseAutomationPlannerDraft, resolveAutomationBindingIds, resolveAutomationTargetJobIds, resolveAutomationTargetPageIdsFromBindings, reviewOnlyAutomationPlanGuard, REVIEW_ONLY_DRAFT_STATUS, runSingleFlight, selectAutomationMediaForPost, selectAutomationPlansForRun, selectCanonicalAutomationPlan, selectNextAvailablePlanSlot, targetPublicationBindingsAcknowledged, targetPublicationsProviderConfirmed, targetPublicationsProviderConfirmedForScope, togglePageFacebookEnabled, upsertAutomationPlan, validateAutomationPlan, validateAutomationPlanRoute, validateAutomationPlanSchedule, validateBindingSchedule, validAutomationStrategySnapshot, type AutomationPlannerDraftScope, type AutomationPlannerDraftState, type AutomationPlannerSaveToken, type AutomationStrategySelection } from "./automationPlanner";
import { defaultAIAccounts } from "./aiAccounts";
import { MediaReservationLedger } from "./automationDomain";
import { starterStrategyCatalog } from "./contentStrategy";
import { buildUpcomingAutomationJobs, cronScopeKey, setDailyCronForScope } from "./automationScheduler";
import { canInteractWithUpcomingJobs } from "../ExpandedViews";

type CampaignDateConversionError = { ok: false; code: string; error: string };

function expectCampaignDateError(value: unknown, code: string) {
  expect(value).toMatchObject({ ok: false, code });
  expect((value as CampaignDateConversionError).error).toEqual(expect.any(String));
}

function basePlan(id: string) {
  const plan = createAutomationPlan("workspace-1", "brand-1", "Asia/Ho_Chi_Minh", new Date("2026-08-24T00:00:00.000Z"));
  return {
    ...plan,
    generationProfileId: "profile-a",
    id,
    targetPageIds: ["100000000000001"],
    pagePlans: {
      "100000000000001": {
        ...plan.platforms,
        facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:15"], runDays: [1, 2, 3, 4, 5, 6, 7] },
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function plannerDraft(scope: AutomationPlannerDraftScope, plan: ReturnType<typeof basePlan>, patch: Partial<AutomationPlannerDraftState> = {}): AutomationPlannerDraftState {
  return { scope, plan, dirty: false, editingJobId: "", editingTime: "", editRevision: 0, ...patch };
}

describe("campaign date keys in the plan timezone", () => {
  it("converts calendar boundaries to UTC instants and back", () => {
    expect(campaignDateToInstant("2026-09-13", "Asia/Ho_Chi_Minh", "start")).toBe("2026-09-12T17:00:00.000Z");
    expect(campaignInstantToDate("2026-09-12T17:00:00.000Z", "Asia/Ho_Chi_Minh")).toBe("2026-09-13");
    expect(campaignDateToInstant("2026-09-13", "Asia/Ho_Chi_Minh", "end")).toBe("2026-09-13T16:59:59.999Z");
  });

  it("rejects malformed calendar dates, invalid timezones, and non-UTC instants", () => {
    expectCampaignDateError(campaignDateToInstant("2026-02-30", "Asia/Ho_Chi_Minh", "start"), "INVALID_DATE");
    expectCampaignDateError(campaignDateToInstant("", "Asia/Ho_Chi_Minh", "start"), "INVALID_DATE");
    expectCampaignDateError(campaignDateToInstant("2026-09-13", "Not/AZone", "start"), "INVALID_TIMEZONE");
    expectCampaignDateError(campaignInstantToDate("2026-09-12T17:00:00.000", "Asia/Ho_Chi_Minh"), "INVALID_INSTANT");
    expectCampaignDateError(campaignInstantToDate("2026-02-30T00:00:00.000Z", "Asia/Ho_Chi_Minh"), "INVALID_INSTANT");
  });

  it("keeps ordinary New York DST boundaries exact and round-trippable", () => {
    expect(campaignDateToInstant("2026-03-08", "America/New_York", "start")).toBe("2026-03-08T05:00:00.000Z");
    expect(campaignDateToInstant("2026-03-08", "America/New_York", "end")).toBe("2026-03-09T03:59:59.999Z");
    expect(campaignDateToInstant("2026-11-01", "America/New_York", "start")).toBe("2026-11-01T04:00:00.000Z");
    expect(campaignDateToInstant("2026-11-01", "America/New_York", "end")).toBe("2026-11-02T04:59:59.999Z");
    expect(campaignInstantToDate("2026-03-09T03:59:59.999Z", "America/New_York")).toBe("2026-03-08");
    expect(campaignInstantToDate("2026-11-02T04:59:59.999Z", "America/New_York")).toBe("2026-11-01");
  });

  it("rejects nonexistent and ambiguous midnight boundaries at timezone transitions", () => {
    expectCampaignDateError(campaignDateToInstant("2026-03-08", "America/Havana", "start"), "NONEXISTENT_TIME");
    expectCampaignDateError(campaignDateToInstant("2026-11-01", "America/Havana", "start"), "AMBIGUOUS_TIME");
  });

  it("keeps a legacy UTC instant unchanged while rendering its plan date", () => {
    const legacy = { ...basePlan("legacy-date"), campaignStartAt: "2026-08-24T00:00:00.000Z" };
    expect(campaignInstantToDate(legacy.campaignStartAt, legacy.cron.timezone)).toBe("2026-08-24");
    expect(new Date(legacy.campaignStartAt).toISOString()).toBe("2026-08-24T00:00:00.000Z");
  });

  it("allows blank optional dates, rejects invalid or reversed instants, and keeps a same-day range inclusive", () => {
    const optional = { ...basePlan("optional-dates"), campaignStartAt: undefined, campaignEndAt: undefined };
    expect(validateAutomationPlan(optional).errors.filter((error) => error.toLowerCase().includes("campaign"))).toEqual([]);

    const invalid = { ...basePlan("invalid-date"), campaignStartAt: "2026-02-30T00:00:00.000Z" };
    expect(validateAutomationPlan(invalid).errors).toContain("Campaign start instant must be a valid UTC ISO instant.");
    const invalidTimezone = { ...basePlan("invalid-timezone"), cron: { ...basePlan("invalid-timezone").cron, timezone: "Not/AZone" } };
    expect(validateAutomationPlan(invalidTimezone).errors).toContain("Timezone must be a valid IANA timezone.");

    const reversed = { ...basePlan("reversed-dates"), campaignStartAt: "2026-09-14T00:00:00.000Z", campaignEndAt: "2026-09-13T23:59:59.999Z" };
    expect(validateAutomationPlan(reversed).errors).toContain("Campaign end must be on or after campaign start.");

    const start = campaignDateToInstant("2026-09-13", "Asia/Ho_Chi_Minh", "start");
    const end = campaignDateToInstant("2026-09-13", "Asia/Ho_Chi_Minh", "end");
    expect(start).toBe("2026-09-12T17:00:00.000Z");
    expect(end).toBe("2026-09-13T16:59:59.999Z");
    const sameDay = { ...basePlan("same-day"), campaignStartAt: start as string, campaignEndAt: end as string };
    expect(validateAutomationPlan(sameDay).ok).toBe(true);
    expect(validateAutomationPlanSchedule(sameDay, "facebook", "100000000000001", new Date(start as string))).toEqual({ ok: true });
    expect(validateAutomationPlanSchedule(sameDay, "facebook", "100000000000001", new Date(end as string))).toEqual({ ok: true });
    expect(validateAutomationPlanSchedule(sameDay, "facebook", "100000000000001", new Date(new Date(end as string).getTime() + 1))).toEqual({ ok: false, code: "OUTSIDE_CAMPAIGN" });
  });

  it("keeps next-slot selection inside the same-day campaign boundary", () => {
    const end = campaignDateToInstant("2026-09-13", "Asia/Ho_Chi_Minh", "end");
    expect(end).toBe("2026-09-13T16:59:59.999Z");
    const seed = basePlan("same-day-slot");
    const plan = {
      ...seed,
      campaignStartAt: "2026-09-12T17:00:00.000Z",
      campaignEndAt: end as string,
      pagePlans: {
        ...seed.pagePlans,
        "100000000000001": {
          ...seed.pagePlans!["100000000000001"],
          facebook: { ...seed.pagePlans!["100000000000001"].facebook, publishTimes: ["23:59"], runDays: [7] },
        },
      },
    };
    expect(selectNextAvailablePlanSlot([plan], plan.id, "binding-1", new Date("2026-09-12T17:00:00.000Z"), [], plan.targetPageIds)).toMatchObject({ ok: true, scheduledAt: "2026-09-13T16:59:00.000Z", planId: plan.id });
    expect(selectNextAvailablePlanSlot([{ ...plan, campaignStartAt: "2026-02-30T00:00:00.000Z" }], plan.id, "binding-1", new Date("2026-09-12T17:00:00.000Z"), [], plan.targetPageIds)).toEqual({ ok: false, code: "NO_AVAILABLE_PLAN_SLOT" });
  });

  it("does not select or attempt an active plan outside its campaign window", () => {
    const seed = basePlan("window-plan");
    const enabledCron = { ...seed.cron, enabled: true, startTime: "00:00", timezone: "UTC" };
    const beforeStart = { ...seed, cron: enabledCron, campaignStartAt: "2026-09-13T00:00:00.000Z", campaignEndAt: "2026-09-13T23:59:59.999Z", status: "active" as const };
    const afterEnd = { ...beforeStart, id: "window-plan-ended", campaignStartAt: "2026-09-12T00:00:00.000Z", campaignEndAt: "2026-09-12T23:59:59.999Z" };
    const before = selectAutomationPlansForRun([beforeStart], new Date("2026-09-12T23:59:00.000Z"));
    const after = selectAutomationPlansForRun([afterEnd], new Date("2026-09-13T00:01:00.000Z"));
    expect(before).toEqual([]);
    expect(after).toEqual([]);
    expect([...before, ...after].map((plan) => plan.id)).toEqual([]);
  });

  it("includes an exact campaign-start slot only when the request is clamped to the lower bound", () => {
    const seed = basePlan("exact-start-slot");
    const plan = {
      ...seed,
      cron: { ...seed.cron, enabled: true, startTime: "00:00", timezone: "UTC" },
      campaignStartAt: "2026-09-13T00:00:00.000Z",
      campaignEndAt: "2026-09-13T23:59:59.999Z",
      pagePlans: {
        ...seed.pagePlans,
        "100000000000001": {
          ...seed.pagePlans!["100000000000001"],
          facebook: { ...seed.pagePlans!["100000000000001"].facebook, publishTimes: ["00:00"], runDays: [7] },
        },
      },
    };
    expect(selectNextAvailablePlanSlot([plan], plan.id, "binding-1", new Date("2026-09-12T00:00:00.000Z"), [], plan.targetPageIds)).toMatchObject({ ok: true, scheduledAt: "2026-09-13T00:00:00.000Z", planId: plan.id });
    expect(selectNextAvailablePlanSlot([plan], plan.id, "binding-1", new Date("2026-09-13T00:00:00.000Z"), [], plan.targetPageIds)).toEqual({ ok: false, code: "NO_AVAILABLE_PLAN_SLOT" });
  });
});

describe("A09.6 planner strategy seam", () => {
  const catalog = starterStrategyCatalog("brand-1", new Date("2026-09-15T00:00:00.000Z"));
  const scheduleTemplate = cloneCampaignScheduleTemplate({
    id: "brand-default",
    campaignId: "brand-default",
    brandId: "brand-1",
    timezone: "UTC",
    timesByWeekday: { 1: ["09:00"] },
    version: 1,
    source: "brand_default",
  }, "campaign-1");

  it("offers Specific/Mix IDs and filters angles to the selected enabled pillar and channel", () => {
    catalog.channelOverrides.instagram = { disabledAngleIds: ["practical-education-step-by-step-guide"] };
    const choices = plannerStrategyChoices(catalog, ["facebook"] as const, { objective: "mix", pillar: "practical-education", angle: "mix" });

    expect(choices.objectives.map((item) => item.value)).toContain("mix");
    expect(choices.pillars.map((item) => item.value)).toContain("practical-education");
    expect(choices.angles.map((item) => item.value)).toContain("practical-education-step-by-step-guide");
    expect(choices.angles.every((item) => item.pillarId === "practical-education" || item.value === "mix")).toBe(true);

    const filtered = plannerStrategyChoices(catalog, ["instagram"] as const, { objective: "mix", pillar: "practical-education", angle: "mix" });
    expect(filtered.angles.map((item) => item.value)).not.toContain("practical-education-step-by-step-guide");
  });

  it("returns resolved rows with canonical labels, applicability, recipe metadata and fingerprint", () => {
    const plan = {
      ...createAutomationPlan("workspace-1", "brand-1", "UTC", new Date("2026-09-15T00:00:00.000Z")),
      id: "plan-a096",
      campaignId: "campaign-1",
      dateRange: { startDate: "2026-09-14", endDate: "2026-09-14" },
      scheduleTemplate,
      targetChannels: ["facebook" as const],
      strategySelection: { objective: "reach" as const, pillar: "practical-education", angle: "practical-education-step-by-step-guide" },
      platforms: {
        ...createAutomationPlan("workspace-1", "brand-1", "UTC").platforms,
        facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], formatMode: "image" as const },
      },
    };
    const preview = buildAutomationPlannerPreview({ plan, catalog, scheduleTemplate });

    expect(preview).toMatchObject({ ok: true });
    if (!preview.ok) return;
    expect(preview.rows[0]).toMatchObject({ objectiveKey: "reach", objectiveLabel: "Reach", pillarId: "practical-education", pillarLabel: "Practical education", angleId: "practical-education-step-by-step-guide", angleLabel: "Step-by-step guide", applicableChannels: ["facebook"], catalogVersion: 1, catalogFingerprint: expect.any(String) });
  });

  it("fails closed for stale catalogs and invalid preview without partial rows", () => {
    const plan = {
      ...createAutomationPlan("workspace-1", "brand-1", "UTC", new Date("2026-09-15T00:00:00.000Z")),
      id: "plan-stale",
      campaignId: "campaign-1",
      dateRange: { startDate: "2026-09-14", endDate: "2026-09-14" },
      scheduleTemplate,
      targetChannels: ["facebook" as const],
      strategySelection: { objective: "reach" as const, pillar: "practical-education", angle: "practical-education-step-by-step-guide" },
      strategySnapshot: { catalogVersion: 1, catalogFingerprint: "old", selection: { objective: "reach" as const, pillar: "practical-education", angle: "practical-education-step-by-step-guide" }, targetChannels: ["facebook" as const], resolvedSlots: [], capturedAt: "2026-09-14T00:00:00.000Z", resolvedFingerprint: "old" } as never,
      platforms: {
        ...createAutomationPlan("workspace-1", "brand-1", "UTC").platforms,
        facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], formatMode: "image" as const },
      },
    };
    const stale = buildAutomationPlannerPreview({ plan, catalog, scheduleTemplate });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.rows).toBeUndefined();

    const invalid = buildAutomationPlannerPreview({ plan: { ...plan, strategySnapshot: undefined, scheduleTemplate: { ...scheduleTemplate, timezone: "Not/AZone" } }, catalog, scheduleTemplate: { ...scheduleTemplate, timezone: "Not/AZone" } });
    expect(invalid).toMatchObject({ ok: false, errors: expect.any(Array) });
    if (!invalid.ok) expect(invalid.rows).toBeUndefined();
  });

  it("attaches an immutable strategySelection and snapshot for the existing save path", () => {
    const plan = {
      ...createAutomationPlan("workspace-1", "brand-1", "UTC", new Date("2026-09-15T00:00:00.000Z")),
      id: "plan-save",
      campaignId: "campaign-1",
      dateRange: { startDate: "2026-09-14", endDate: "2026-09-14" },
      scheduleTemplate,
      targetChannels: ["facebook" as const],
      strategySelection: { objective: "reach" as const, pillar: "practical-education", angle: "practical-education-step-by-step-guide" },
      platforms: {
        ...createAutomationPlan("workspace-1", "brand-1", "UTC").platforms,
        facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], formatMode: "image" as const },
      },
    };
    const prepared = prepareAutomationPlanForSave({ plan, catalog, scheduleTemplate, capturedAt: "2026-09-15T01:00:00.000Z" });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    expect(prepared.plan.strategySelection).toEqual(plan.strategySelection);
    expect(prepared.plan.strategySnapshot).toMatchObject({ catalogVersion: 1, catalogFingerprint: expect.any(String), capturedAt: "2026-09-15T01:00:00.000Z" });
    expect(prepared.plan.strategySnapshot).not.toBe(prepared.plan.strategySelection);
  });

  it("captures an explicit null recipe and empty recipe guidance when the catalog has no recipe", () => {
    const plan = {
      ...createAutomationPlan("workspace-1", "brand-1", "UTC", new Date("2026-09-15T00:00:00.000Z")),
      id: "plan-no-recipe",
      campaignId: "campaign-1",
      dateRange: { startDate: "2026-09-14", endDate: "2026-09-14" },
      scheduleTemplate,
      targetChannels: ["facebook"] as Array<"facebook">,
      strategySelection: { objective: "reach" as const, pillar: "practical-education", angle: "practical-education-step-by-step-guide" },
      platforms: {
        ...createAutomationPlan("workspace-1", "brand-1", "UTC").platforms,
        facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], formatMode: "image" as const },
      },
    };
    const prepared = prepareAutomationPlanForSave({ plan, catalog, scheduleTemplate, capturedAt: "2026-09-15T01:00:00.000Z" });

    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    expect(prepared.snapshot.resolvedSlots[0]).toMatchObject({ recipeId: null, recipeGuidance: "" });
  });

  it("captures required historical labels, recipe guidance and channel-specific angle guidance", () => {
    const angleId = "practical-education-step-by-step-guide";
    const recipe = {
      id: "recipe-step",
      brandId: "brand-1",
      name: "Step playbook",
      platforms: ["facebook", "instagram"] as const,
      contentKinds: ["image"] as const,
      pillarId: "practical-education",
      angleId,
      hookGuidance: "Open with one question.",
      structureGuidance: "Explain three steps.",
      ctaGuidance: "Invite a save.",
      qualityChecklist: ["Check facts"],
      status: "active" as const,
    };
    const recipeCatalog = structuredClone(catalog);
    recipeCatalog.channelOverrides.instagram = { guidanceByAngleId: { [angleId]: "Instagram exact guidance." } };
    recipeCatalog.pillars.find((pillar) => pillar.id === "practical-education")!.angles.find((angle) => angle.id === angleId)!.recipeId = recipe.id;
    const plan = {
      ...createAutomationPlan("workspace-1", "brand-1", "UTC", new Date("2026-09-15T00:00:00.000Z")),
      id: "plan-snapshot-fields",
      campaignId: "campaign-1",
      dateRange: { startDate: "2026-09-14", endDate: "2026-09-14" },
      scheduleTemplate,
      targetChannels: ["facebook", "instagram"] as Array<"facebook" | "instagram">,
      strategySelection: { objective: "reach" as const, pillar: "practical-education", angle: angleId },
      platforms: {
        ...createAutomationPlan("workspace-1", "brand-1", "UTC").platforms,
        facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], formatMode: "image" as const },
      },
    };
    const prepared = prepareAutomationPlanForSave({ plan, catalog: recipeCatalog, scheduleTemplate, recipes: [recipe], capturedAt: "2026-09-15T01:00:00.000Z" });

    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    expect(prepared.snapshot.resolvedSlots[0]).toMatchObject({
      objectiveKey: "reach",
      objectiveLabel: "Reach",
      pillarId: "practical-education",
      pillarLabel: "Practical education",
      angleId,
      angleLabel: "Step-by-step guide",
      angleGuidance: "Break a useful process into simple steps.",
      angleGuidanceByChannel: { facebook: "Break a useful process into simple steps.", instagram: "Instagram exact guidance." },
      recipeId: "recipe-step",
      recipeGuidance: expect.stringContaining("Hook: Open with one question."),
      strategyVersion: 1,
      catalogFingerprint: prepared.snapshot.catalogFingerprint,
    });
    expect(prepared.snapshot.capturedAt).toBe("2026-09-15T01:00:00.000Z");
  });

  it("reports the missing historical snapshot field instead of only a generic invalid error", () => {
    const plan = {
      ...createAutomationPlan("workspace-1", "brand-1", "UTC", new Date("2026-09-15T00:00:00.000Z")),
      id: "plan-partial-snapshot",
      campaignId: "campaign-1",
      dateRange: { startDate: "2026-09-14", endDate: "2026-09-14" },
      scheduleTemplate,
      targetChannels: ["facebook"] as Array<"facebook">,
      strategySelection: { objective: "reach" as const, pillar: "practical-education", angle: "practical-education-step-by-step-guide" },
      platforms: {
        ...createAutomationPlan("workspace-1", "brand-1", "UTC").platforms,
        facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], formatMode: "image" as const },
      },
    };
    const prepared = prepareAutomationPlanForSave({ plan, catalog, scheduleTemplate, capturedAt: "2026-09-15T01:00:00.000Z" });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    const partial = structuredClone(prepared.plan.strategySnapshot)!;
    delete (partial.resolvedSlots[0] as Record<string, unknown>).angleGuidance;
    expect(validAutomationStrategySnapshot(partial)).toBe(false);
    const validation = validateAutomationPlan({ ...prepared.plan, strategySnapshot: partial });
    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("Strategy snapshot resolvedSlots[0].angleGuidance is required.");
  });

  it("guards review-only runs to the last acknowledged Page-targeted plan", () => {
    const persisted = { ...basePlan("review-only"), cron: { ...basePlan("review-only").cron, enabled: true } };
    expect(reviewOnlyAutomationPlanGuard({ plan: persisted, persistedPlan: persisted, draftDirty: false })).toEqual({ ok: true });
    expect(reviewOnlyAutomationPlanGuard({ plan: persisted, persistedPlan: persisted, draftDirty: true })).toMatchObject({ ok: false, code: "PLANNER_DRAFT_DIRTY" });
    expect(reviewOnlyAutomationPlanGuard({ plan: persisted, persistedPlan: undefined, draftDirty: false })).toMatchObject({ ok: false, code: "PLANNER_PLAN_NOT_PERSISTED" });
    expect(reviewOnlyAutomationPlanGuard({ plan: persisted, persistedPlan: { ...persisted, id: "other-plan" }, draftDirty: false })).toMatchObject({ ok: false, code: "PLANNER_PLAN_SELECTION_CHANGED" });
    expect(reviewOnlyAutomationPlanGuard({ plan: { ...persisted, targetPageIds: [], pagePlans: {} }, persistedPlan: { ...persisted, targetPageIds: [], pagePlans: {} }, draftDirty: false })).toMatchObject({ ok: false, code: "PLANNER_PAGE_TARGET_REQUIRED" });
  });

  it("uses the canonical Brand Client for planner scope and adapts only matching legacy plans", () => {
    const brand = { id: "brand-scoped", clientId: "client-canonical", workspaceId: "workspace-renderer" };
    expect(automationPlannerScopeForBrand("profile-a", brand)).toEqual({ profileId: "profile-a", clientId: "client-canonical", brandId: "brand-scoped" });
    const legacy = { ...basePlan("legacy-scope"), workspaceId: "workspace-renderer", brandId: "brand-scoped" };
    const foreign = { ...legacy, workspaceId: "client-foreign" };
    expect(canonicalizeAutomationPlanScope(legacy, brand).workspaceId).toBe("client-canonical");
    expect(canonicalizeAutomationPlanScope(foreign, brand)).toBe(foreign);
    expect(canonicalizeAutomationPlanScope(legacy, brand)).not.toBe(legacy);
  });

  it("strips hidden platform and Page strategy overrides before preview and save", () => {
    const plan = {
      ...createAutomationPlan("workspace-1", "brand-1", "UTC", new Date("2026-09-15T00:00:00.000Z")),
      id: "root-only",
      campaignId: "campaign-1",
      dateRange: { startDate: "2026-09-14", endDate: "2026-09-14" },
      scheduleTemplate,
      targetChannels: ["facebook" as const],
      strategySelection: { objective: "reach" as const, pillar: "practical-education", angle: "practical-education-step-by-step-guide" },
      platforms: {
        ...createAutomationPlan("workspace-1", "brand-1", "UTC").platforms,
        facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], formatMode: "image" as const, strategySelection: { objective: "engagement" as const, pillar: "practical-education", angle: "practical-education-step-by-step-guide" },
        },
      },
    };
    const withPageOverride = { ...plan, pagePlans: { "page-a": { ...plan.platforms, facebook: { ...plan.platforms.facebook, strategySelection: { objective: "conversion" as const, pillar: "practical-education", angle: "practical-education-step-by-step-guide" } } } } };
    expect(hasPlannerStrategyOverrides(withPageOverride)).toBe(true);
    const normalized = normalizePlannerStrategyPlan(withPageOverride);
    expect(normalized.platforms.facebook.strategySelection).toBeUndefined();
    expect(normalized.pagePlans?.["page-a"]?.facebook.strategySelection).toBeUndefined();
    const preview = buildAutomationPlannerPreview({ plan: withPageOverride, catalog, scheduleTemplate });
    expect(preview).toMatchObject({ ok: true });
    if (!preview.ok) return;
    expect(preview.rows[0]?.objectiveKey).toBe("reach");
    const prepared = prepareAutomationPlanForSave({ plan: withPageOverride, catalog, scheduleTemplate });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    expect(prepared.plan.platforms.facebook.strategySelection).toBeUndefined();
    expect(prepared.plan.pagePlans?.["page-a"]?.facebook.strategySelection).toBeUndefined();
  });

  it("derives a review-required display state when the catalog snapshot is stale", () => {
    const stale = {
      ...basePlan("stale-display"),
      strategySelection: { objective: "reach" as const, pillar: "practical-education", angle: "practical-education-step-by-step-guide" },
      strategySnapshot: { catalogVersion: 1, catalogFingerprint: "old", selection: { objective: "reach" as const, pillar: "practical-education", angle: "practical-education-step-by-step-guide" }, targetChannels: ["facebook" as const], resolvedSlots: [], capturedAt: "2026-09-14T00:00:00.000Z", resolvedFingerprint: "old" } as never,
    };
    expect(automationPlanDisplayState(stale, catalog)).toMatchObject({ status: "review_required", label: "Review required", reviewRequired: true });
    expect(selectAutomationPlansForRun([{ ...stale, cron: { ...stale.cron, enabled: true } }], new Date("2026-09-15T00:00:00.000Z"), true, catalog)).toEqual([]);
  });
});

describe("automation planner media routing", () => {
  it("allows image generation only for image specs with a live managed image provider", () => {
    expect(canGenerateAutomationImageWithoutSource("image", "google_flow", true)).toBe(true);
    expect(canGenerateAutomationImageWithoutSource("image", "vertex_ai", true)).toBe(true);
    expect(canGenerateAutomationImageWithoutSource("video", "google_flow", true)).toBe(false);
    expect(canGenerateAutomationImageWithoutSource("image", "google_flow", false)).toBe(false);
  });

  it("selects eligible media from the full Client/Brand pool instead of a pinned asset list", () => {
    const asset = (id: string, distribution: "universal" | "facebook") => ({ id, brandId: "brand-1", campaignId: "", topic: "", platform: "facebook" as const, distribution, kind: "image" as const, name: id, mimeType: "image/jpeg", sizeBytes: 1, modifiedAt: "2026-08-24T00:00:00.000Z", source: "public_https" as const, status: "eligible" as const, normalizedUrl: `https://cdn.example.test/${id}.jpg`, sha256: "a".repeat(64), visualFingerprint: distribution === "facebook" ? "1111111111111111" : "2222222222222222", visualFingerprintSource: "decoded_image" as const, reviewStatus: "verified" as const, duplicateStatus: "unique" as const, usageStatus: "available" as const, publicUrlVerified: true });
    const selected = selectAutomationMediaForPost({ selectedAssetIds: ["asset-a"] }, [asset("asset-a", "universal"), asset("asset-b", "facebook")], { brandId: "brand-1", campaignId: "", topic: "", platform: "facebook", kind: "image" }, new MediaReservationLedger());
    expect(selected?.id).toBe("asset-b");
  });
});

describe("automation planner strategy fields", () => {
  it("migrates one legacy contentStrategySelection key without using legacy scalar choices", () => {
    const selection: AutomationStrategySelection = { objective: "reach", pillar: "mix", angle: "mix" };
    const migrated = normalizeAutomationPlan({
      ...basePlan("strategy-migration"),
      strategySelection: undefined,
      objectiveMode: "Education",
      contentPillar: "legacy-pillar",
      angle: "legacy-angle",
      contentStrategySelection: selection,
    } as unknown as ReturnType<typeof basePlan> & { contentStrategySelection: AutomationStrategySelection });

    expect(migrated.strategySelection).toEqual(selection);
    expect("contentStrategySelection" in migrated).toBe(false);
    expect(migrated.objectiveMode).toBe("Education");
  });

  it("allocates a platform format mix into concrete image and video specs", () => {
    const sequence = resolveFormatSequence({ mode: "mix", mix: { image: 60, video: 40 }, slotCount: 7 });
    expect(sequence).toHaveLength(7);
    expect(sequence.filter((kind) => kind === "image")).toHaveLength(4);
    expect(sequence.filter((kind) => kind === "video")).toHaveLength(3);
    expect(sequence).toEqual(resolveFormatSequence({ mode: "mix", mix: { image: 60, video: 40 }, slotCount: 7 }));
    expect(() => resolveFormatSequence({ mode: "mix", mix: { image: 0, video: 0 }, slotCount: 2 })).toThrow("FORMAT_MIX_RATIO_INVALID");
  });

  it("derives legacy counts when a new format mode is present and drops malformed date ranges", () => {
    const plan = createAutomationPlan("workspace-1", "brand-1", "UTC");
    plan.platforms.facebook = { enabled: true, postsPerDay: 7, imageCount: 0, videoCount: 7, publishTimes: ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00"], formatMode: "mix", formatMix: { image: 60, video: 40 } };
    expect(normalizeAutomationPlan(plan).platforms.facebook).toMatchObject({ imageCount: 4, videoCount: 3 });
    expect(normalizeAutomationPlan({ ...plan, dateRange: { startDate: "0005-05-06", endDate: "2026-09-11" } })).not.toHaveProperty("dateRange");
  });

  it("uses root format fields when platform counts are legacy placeholders", () => {
    const plan = createAutomationPlan("workspace-1", "brand-1", "UTC");
    plan.formatMode = "mix";
    plan.formatMix = { image: 60, video: 40 };
    plan.platforms.facebook = { enabled: true, postsPerDay: 7, imageCount: 0, videoCount: 0, publishTimes: ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00"] };

    expect((resolveFormatSequence({ mode: plan.formatMode, mix: plan.formatMix, slotCount: plan.platforms.facebook.postsPerDay }))).toEqual(["image", "video", "image", "video", "image", "video", "image"]);
    expect(normalizeAutomationPlan(plan).platforms.facebook).toMatchObject({ imageCount: 4, videoCount: 3 });
    expect(validateAutomationPlan(plan).errors).not.toContain("facebook image and video counts must equal posts per day.");
    expect((plan as unknown as { formatMode: "mix"; formatMix: { image: number; video: number }; platforms: typeof plan.platforms }).formatMode).toBe("mix");
  });

  it("clears a stale ratio when switching from Mix to an explicit format", () => {
    expect(nextAutomationFormatPatch({ formatMode: "mix", formatMix: { image: 60, video: 40 }, imageCount: 4, videoCount: 3 }, "image")).toEqual({ formatMode: "image", formatMix: undefined });
  });

  it("blocks an active plan with an invalid per-platform strategy override", () => {
    const plan = { ...basePlan("invalid-strategy-override"), status: "active" as const, cron: { enabled: true, startTime: "00:00", timezone: "UTC" }, platforms: { ...basePlan("invalid-strategy-override").platforms, instagram: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], strategySelection: { objective: "unknown-objective" as never, pillar: "mix", angle: "mix" } } } };

    expect(validateAutomationPlan(plan).errors).toContain("instagram strategy selection is invalid.");
    expect(selectAutomationPlansForRun([plan], new Date("2026-08-24T00:00:00.000Z"))).toEqual([]);
  });

  it("rejects unknown and wrong-channel strategy IDs when a catalog is available", () => {
    const catalog = starterStrategyCatalog("brand-1");
    catalog.channelOverrides.instagram = { disabledPillarIds: ["practical-education"] };
    const plan = createAutomationPlan("workspace-1", "brand-1", "UTC");
    plan.platforms.instagram = { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], strategySelection: { objective: "reach", pillar: "practical-education", angle: "practical-education-step-by-step-guide" } };
    plan.platforms.tiktok = { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["10:00"], strategySelection: { objective: "reach", pillar: "mix", angle: "missing-angle" } };

    expect(validateAutomationPlan(plan, catalog).errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/instagram.*cannot resolve.*practical-education/i),
      expect.stringMatching(/tiktok.*cannot resolve.*missing-angle/i),
    ]));
  });

  it("normalizes malformed platform entries into a typed invalid plan state", () => {
    const plan = { ...createAutomationPlan("workspace-1", "brand-1", "UTC"), platforms: { facebook: null } } as never;
    const normalized = normalizeAutomationPlan(plan);
    expect(normalized.platforms.facebook).toMatchObject({ enabled: false, invalidReason: "PLATFORM_ENTRY_INVALID" });
    expect(validateAutomationPlan(normalized).errors).toContain("facebook plan entry is invalid: PLATFORM_ENTRY_INVALID.");
  });
});

describe("automation AI route selections", () => {
  it("keeps subscription and LLM option values on their own route", () => {
    expect(automationAIOptionMatchesRoute("gemini:web_subscription", "subscription")).toBe(true);
    expect(automationAIOptionMatchesRoute("openai:official_api", "subscription")).toBe(false);
    expect(automationAIOptionMatchesRoute("openai:official_api", "llm")).toBe(true);
    expect(automationAIOptionMatchesRoute("gemini:manual_assisted", "llm")).toBe(true);
    expect(automationAIOptionMatchesRoute("gemini:web_subscription", "llm")).toBe(false);
  });

  it("switches a legacy or auto preference to a valid provider for the chosen route", () => {
    expect(automationAIPreferenceForRoute("subscription", { provider: "auto", mode: "web_subscription" })).toEqual({ provider: "gemini", mode: "web_subscription" });
    expect(automationAIPreferenceForRoute("llm", { provider: "auto", mode: "web_subscription" })).toEqual({ provider: "openai", mode: "official_api" });
    expect(automationAIPreferenceForRoute("llm", { provider: "gemini", mode: "manual_assisted" })).toEqual({ provider: "gemini", mode: "manual_assisted" });
  });

  it("keeps an explicit injected mock preference separate from application safety state", () => {
    const accounts = defaultAIAccounts();
    accounts.gemini.status = "configured";
    expect(resolveAutomationAI({ provider: "gemini", mode: "official_api" }, accounts)).toMatchObject({ provider: "gemini", mode: "official_api", available: true });
    expect(resolveAutomationAI({ provider: "mock", mode: "mock" }, accounts)).toMatchObject({ provider: "mock", mode: "mock", available: true });
  });
});

describe("binding-aware automation plans", () => {
  it("preserves every binding's durable job identity for a multi-target draft", () => {
    const publications = [
      { id: "publication-a", variantId: "variant-7", workerJobId: "worker-page-a" },
      { id: "publication-b", variantId: "variant-7", workerJobId: "worker-page-b" },
      { id: "publication-other", variantId: "variant-8", workerJobId: "worker-page-other" },
    ];
    expect(resolveAutomationTargetJobIds(publications, "variant-7")).toEqual(["worker-page-a", "worker-page-b"]);
    expect(resolveAutomationTargetJobIds(publications, "variant-7", ["worker-page-b", "worker-page-a"])).toEqual(["worker-page-b", "worker-page-a"]);
    expect(resolveAutomationTargetJobIds([{ id: "publication-legacy", variantId: "variant-9", legacyNonLive: true }], "variant-9")).toEqual([]);
  });

  it("restores Scheduled only when every selected binding remains acknowledged", () => {
    const acknowledged = [
      { bindingId: "binding-a", state: "scheduled", commandStatus: "acknowledged", workerAckState: "acknowledged" },
      { bindingId: "binding-b", state: "scheduled", commandStatus: "acknowledged", workerAckState: "acknowledged" },
    ];
    expect(targetPublicationBindingsAcknowledged(acknowledged, ["binding-a", "binding-b"])).toBe(true);
    expect(targetPublicationBindingsAcknowledged(acknowledged.slice(0, 1), ["binding-a", "binding-b"])).toBe(false);
    expect(targetPublicationBindingsAcknowledged([{ ...acknowledged[0] }, { ...acknowledged[1], commandStatus: "pending" }], ["binding-a", "binding-b"])).toBe(false);
    expect(targetPublicationBindingsAcknowledged([{ bindingId: "binding-legacy", state: "scheduled", commandStatus: "acknowledged", workerAckState: "acknowledged", legacyNonLive: true }], ["binding-legacy"])).toBe(false);
  });

  it("requires CP published state and provider job evidence before reporting live success", () => {
    expect(hasProviderConfirmedPublicationState({ state: "scheduled", workerState: "completed", simulation: false })).toBe(false);
    expect(hasProviderConfirmedPublicationState({ state: "published", simulation: false })).toBe(false);
    expect(hasProviderConfirmedPublicationState({ state: "published", providerJobId: "provider-1", simulation: false })).toBe(true);
    expect(hasProviderConfirmedPublicationState({ state: "published", providerJobId: "legacy-provider-1", legacyNonLive: true })).toBe(false);
    expect(countProviderConfirmedPublications([
      { state: "scheduled", workerState: "completed", simulation: false },
      { state: "published", simulation: false },
      { state: "published", providerJobId: "provider-1", simulation: false },
      { state: "published", providerJobId: "legacy-provider-1", legacyNonLive: true },
    ])).toBe(1);
    expect(targetPublicationsProviderConfirmed([
      { bindingId: "binding-a", state: "published", providerJobId: "provider-a" },
      { bindingId: "binding-b", state: "published", providerJobId: "provider-b" },
    ], ["binding-a", "binding-b"])).toBe(true);
    expect(targetPublicationsProviderConfirmed([{ bindingId: "binding-a", state: "published", providerJobId: "provider-a" }], ["binding-a", "binding-b"])).toBe(false);
  });

  it("scopes quality publication evidence to the active Client and Brand", () => {
    const publication = { clientId: "client-a", brandId: "brand-a", contentRunId: "run-1", variantId: "variant-7", bindingId: "binding-a", state: "published", providerJobId: "provider-a" };
    expect(targetPublicationsProviderConfirmedForScope([publication], { clientId: "client-a", brandId: "brand-a", contentRunId: "run-1", variantId: "variant-7" }, ["binding-a"])).toBe(true);
    expect(targetPublicationsProviderConfirmedForScope([publication], { clientId: "client-b", brandId: "brand-b", contentRunId: "run-1", variantId: "variant-7" }, ["binding-a"])).toBe(false);
  });

  it("never exposes migrated non-live rows as runnable target jobs", () => {
    expect(resolveAutomationTargetJobIds([{ id: "publication-legacy", variantId: "variant-9", simulation: true }], "variant-9")).toEqual([]);
  });

  it("uses explicit binding IDs and preserves legacy Page IDs only through the migration adapter", () => {
    const plan = createAutomationPlan("workspace-1", "brand-1", "UTC");
    plan.bindingIds = ["binding-1", "binding-2"];
    plan.targetPageIds = ["legacy-page"];
    expect(resolveAutomationBindingIds(plan)).toEqual(["binding-1", "binding-2"]);
    expect(resolveAutomationBindingIds({ ...plan, bindingIds: undefined })).toEqual(["legacy-page"]);
    expect(resolveAutomationTargetPageIdsFromBindings({ bindingIds: ["binding-brand-facebook-page-1"], targetPageIds: undefined })).toEqual(["page-1"]);
  });

  it("requires one explicit GenerationProfile for an active plan", () => {
    const plan = { ...basePlan("profile-plan"), status: "active" as const, generationProfileId: undefined };
    expect(validateAutomationPlan(plan).errors).toContain("GenerationProfile is required for an active plan.");
    expect(validateAutomationPlan({ ...plan, generationProfileId: "profile-a" }).errors).not.toContain("GenerationProfile is required for an active plan.");
  });

  it("blocks an active plan when its selected route cannot run unattended", () => {
    expect(validateAutomationPlanRoute({ mode: "subscription_package", provider: "gemini_web", model: "gemini", status: "connected", capabilities: ["copy"] }, ["copy"], false)).toEqual({ ok: false, code: "APP_OPEN_REQUIRED" });
    expect(validateAutomationPlanRoute({ mode: "llm_provider", provider: "openrouter", model: "model", status: "not_configured", capabilities: ["copy"] }, ["copy"], false)).toEqual({ ok: false, code: "LLM_PROVIDER_NOT_READY" });
    expect(validateAutomationPlanRoute({ mode: "llm_provider", provider: "openrouter", model: "model", status: "connected", capabilities: ["copy"] }, ["video"], false)).toEqual({ ok: false, code: "GENERATION_CAPABILITY_MISSING" });
  });

  it("validates inherited and independent per-binding schedules", () => {
    expect(validateBindingSchedule({ mode: "inherit_facebook" })).toEqual({ ok: true, errors: [] });
    expect(validateBindingSchedule({ mode: "independent", postsPerDay: 2, imageCount: 1, videoCount: 1, publishTimes: ["09:00", "18:00"] })).toEqual({ ok: true, errors: [] });
    expect(validateBindingSchedule({ mode: "independent", postsPerDay: 2, imageCount: 0, videoCount: 1, publishTimes: ["18:00"] })).toMatchObject({ ok: false, errors: expect.arrayContaining(["Binding schedule media totals must equal posts per day."]) });
  });

  it("validates per-platform run days and resolves the local weekday", () => {
    expect(automationRunDayInTimezone(new Date("2026-08-24T00:00:00.000Z"), "Asia/Ho_Chi_Minh")).toBe(1);
    expect(validateBindingSchedule({ mode: "independent", postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], runDays: [] }).ok).toBe(false);
    const plan = basePlan("run-days");
    plan.pagePlans!["100000000000001"].facebook.runDays = [1, 3];
    expect(validateAutomationPlan(plan).ok).toBe(true);
    plan.pagePlans!["100000000000001"].facebook.runDays = [8];
    expect(validateAutomationPlan(plan).errors).toContain("facebook Page 100000000000001 needs one or more valid run days (1-7).");
  });

  it("creates a per-scope daily Cron schedule and sorts upcoming jobs by next action", () => {
    const plan = { ...basePlan("upcoming"), cron: { enabled: false, startTime: "09:00", timezone: "UTC" }, platforms: { ...basePlan("upcoming").platforms, instagram: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["08:00"], runDays: [1, 2, 3, 4, 5, 6, 7] } } };
    const scoped = setDailyCronForScope(plan, { platform: "instagram", startTime: "08:00", timezone: "UTC" });
    expect(cronScopeKey("instagram")).toBe("platform:instagram");
    expect(scoped.cronSchedules?.["platform:instagram"]).toMatchObject({ enabled: true, platform: "instagram", startTime: "08:00", timezone: "UTC", revision: 2 });
    const jobs = buildUpcomingAutomationJobs(scoped, new Date("2026-08-24T07:00:00.000Z"), (pageId) => `binding-${pageId}`);
    expect(jobs.length).toBe(2);
    expect(jobs[0].nextActionAt <= jobs[1].nextActionAt).toBe(true);
    expect(jobs.find((job) => job.platform === "instagram")?.nextActionAt).toBe("2026-08-24T08:00:00.000Z");
  });
});

describe("automation planner forced review-only selection", () => {
  const now = new Date("2026-08-24T08:00:00.000Z");

  it("force-selects an active same-day plan while normal due selection still suppresses it", () => {
    const plan = { ...basePlan("active-same-day"), status: "active" as const, cron: { enabled: true, startTime: "00:00", timezone: "Asia/Ho_Chi_Minh" }, targetPageIds: ["100000000000001"], lastDueAt: now.toISOString() };
    expect(getDueAutomationPlans([plan], now)).toEqual([]);
    expect(selectAutomationPlansForRun([plan], now, true)).toEqual([plan]);
  });

  it("force-selects a draft for explicit review-only runs but ignores disabled and invalid plans", () => {
    const active = { ...basePlan("active-valid"), status: "active" as const, cron: { enabled: true, startTime: "00:00", timezone: "Asia/Ho_Chi_Minh" }, targetPageIds: ["100000000000001"] };
    const draft = { ...active, id: "draft-plan", status: "draft" as const, generationProfileId: undefined };
    const disabled = { ...active, id: "disabled-plan", cron: { ...active.cron, enabled: false } };
    const invalid = { ...active, id: "invalid-page-plan", targetPageIds: [] };
    expect(selectAutomationPlansForRun([active, draft, disabled, invalid], now, true).map((plan) => plan.id)).toEqual(["active-valid", "draft-plan"]);
  });

  it("binds a review-only run to the exact acknowledged plan and Client/Brand scope", () => {
    const selected = { ...basePlan("selected-plan"), status: "active" as const, cron: { enabled: true, startTime: "00:00", timezone: "Asia/Ho_Chi_Minh" } };
    const other = { ...selected, id: "other-plan" };
    expect(selectAutomationPlansForRun([selected, other], now, true, undefined, { planId: selected.id, clientId: selected.workspaceId, brandId: selected.brandId }).map((plan) => plan.id)).toEqual(["selected-plan"]);
  });

  it("makes a legacy renderer-scoped plan due for its active Brand and excludes a foreign Client", () => {
    const brand = { id: "brand-scoped", clientId: "client-canonical", workspaceId: "workspace-renderer" };
    const active = { ...basePlan("legacy-scheduler"), workspaceId: brand.workspaceId, brandId: brand.id, status: "active" as const, cron: { enabled: true, startTime: "00:00", timezone: "Asia/Ho_Chi_Minh" } };
    const foreign = { ...active, id: "foreign-client", workspaceId: "client-foreign" };
    const scoped = [active, foreign].filter((plan) => automationPlanMatchesBrandScope(plan, brand)).map((plan) => canonicalizeAutomationPlanScope(plan, brand));
    expect(getDueAutomationPlans(scoped, now).map((plan) => plan.id)).toEqual(["legacy-scheduler"]);
  });

  it("allows a Failed draft to retry while non-failed drafts still dedupe", () => {
    expect(automationDraftKeyExists([{ automationKey: "retry-key", status: "Failed" }], "retry-key")).toBe(false);
    expect(automationDraftKeyExists([{ automationKey: "retry-key", status: "Needs review" }], "retry-key")).toBe(true);
    expect(automationDraftKeyExists([{ automationKey: "retry-key", status: "Scheduled" }], "retry-key")).toBe(true);
  });

  it("dedupes repeated forced runs by automation key and keeps review-only status", () => {
    expect(automationDraftKeyExists([{ automationKey: "same-key" }], "same-key")).toBe(true);
    expect(automationDraftKeyExists([{ automationKey: "same-key", state: "needs_review" }], "same-key")).toBe(true);
    expect(automationDraftKeyExists([{ automationKey: "same-key", state: "failed" }].filter((run) => run.state !== "failed"), "same-key")).toBe(false);
    expect(automationDraftKeyExists([], "same-key")).toBe(false);
    expect(REVIEW_ONLY_DRAFT_STATUS).toBe("Needs review");
  });
});

describe("automation planner entry-point single-flight", () => {
  it("does not overlap startup and manual planner provider work", async () => {
    const guard = { current: false };
    let providerCalls = 0;
    let releaseStartup: (() => void) | undefined;
    const startupProvider = new Promise<void>((resolve) => { releaseStartup = resolve; });
    const startup = runSingleFlight(guard, async () => {
      providerCalls += 1;
      await startupProvider;
      return "startup";
    });
    const manual = runSingleFlight(guard, async () => {
      providerCalls += 1;
      return "manual";
    });
    await expect(manual).resolves.toBeUndefined();
    releaseStartup?.();
    await expect(startup).resolves.toBe("startup");
    expect(providerCalls).toBe(1);
    expect(guard.current).toBe(false);
  });
});

describe("automation planner persistence and due selection", () => {
  it("keeps multiple plans for one workspace/brand and replaces only the edited plan", () => {
    const historical = { ...basePlan("historical-plan"), cron: { enabled: false, startTime: "09:00", timezone: "Asia/Ho_Chi_Minh" }, status: "draft" as const };
    const edited = { ...basePlan("edited-plan"), cron: { enabled: true, startTime: "08:00", timezone: "Asia/Ho_Chi_Minh" }, status: "active" as const };
    const saved = upsertAutomationPlan([historical, edited], edited);
    const selected = saved.find((candidate) => candidate.workspaceId === edited.workspaceId && candidate.brandId === edited.brandId);
    expect(saved.filter((candidate) => candidate.workspaceId === edited.workspaceId && candidate.brandId === edited.brandId)).toHaveLength(2);
    expect(selected).toMatchObject({
      id: edited.id,
      cron: { enabled: true, startTime: "08:00", timezone: "Asia/Ho_Chi_Minh" },
      targetPageIds: ["100000000000001"],
      pagePlans: { "100000000000001": { facebook: { postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:15"] } } },
      status: "active",
    });
  });

  it("selects the next free slot for a plan and binding", () => {
    const seed = basePlan("slot-plan");
    const plan = { ...seed, cron: { ...seed.cron, timezone: "UTC" }, campaignStartAt: "2026-08-24T00:00:00.000Z", targetPageIds: ["100000000000001"], pagePlans: { "100000000000001": { ...seed.platforms, facebook: { enabled: true, postsPerDay: 2, imageCount: 2, videoCount: 0, publishTimes: ["09:00", "10:00"], runDays: [1, 2, 3, 4, 5, 6, 7] } } } };
    const requestedAt = new Date("2026-08-24T00:00:00.000Z");
    const first = selectNextAvailablePlanSlot([plan], plan.id, "binding-1", requestedAt, [], ["100000000000001"]);
    expect(first).toMatchObject({ ok: true, scheduledAt: "2026-08-24T09:00:00.000Z", planId: plan.id });
    const second = selectNextAvailablePlanSlot([plan], plan.id, "binding-2", requestedAt, ["facebook|100000000000001|2026-08-24T09:00:00.000Z"], ["100000000000001"]);
    expect(second).toMatchObject({ ok: true, scheduledAt: "2026-08-24T10:00:00.000Z" });
  });

  it("validates manual schedules by campaign, local run day, and shared Page slot", () => {
    const seed = basePlan("manual-slot");
    const plan = { ...seed, campaignStartAt: "2026-08-24T00:00:00.000Z", campaignEndAt: "2026-08-31T23:59:59.000Z", pagePlans: { ...seed.pagePlans, "100000000000001": { ...seed.pagePlans!["100000000000001"], facebook: { ...seed.pagePlans!["100000000000001"].facebook, runDays: [1] } } } };
    const monday = new Date("2026-08-24T02:00:00.000Z");
    expect(validateAutomationPlanSchedule(plan, "facebook", "100000000000001", monday)).toEqual({ ok: true });
    expect(validateAutomationPlanSchedule(plan, "facebook", "100000000000001", new Date("2026-08-25T02:00:00.000Z"))).toEqual({ ok: false, code: "RUN_DAY_NOT_ALLOWED" });
    expect(validateAutomationPlanSchedule(plan, "facebook", "100000000000001", monday, ["facebook|100000000000001|2026-08-24T02:00:00.000Z"])).toEqual({ ok: false, code: "SLOT_RESERVED" });
    expect(validateAutomationPlanSchedule(plan, "facebook", "100000000000001", new Date("2026-09-01T02:00:00.000Z"))).toEqual({ ok: false, code: "OUTSIDE_CAMPAIGN" });
  });

  it("returns only enabled, unattempted plans after their local start time", () => {
    const now = new Date("2026-08-24T02:30:00.000Z");
    const due = { ...basePlan("due-plan"), cron: { enabled: true, startTime: "08:00", timezone: "Asia/Ho_Chi_Minh" }, status: "active" as const };
    const disabled = { ...due, id: "disabled-plan", cron: { ...due.cron, enabled: false } };
    const attempted = { ...due, id: "attempted-plan", lastDueAt: "2026-08-24T01:30:00.000Z" };
    expect(getDueAutomationPlans([due, disabled, attempted], now).map((plan) => plan.id)).toEqual(["due-plan"]);
  });
});

describe("automation planner platform scope fallbacks", () => {
  it("returns disabled defaults for missing platforms so due-run iteration stays safe", () => {
    const seed = createAutomationPlan("workspace-1", "brand-1", "UTC");
    const pageId = "page-a";
    const facebook = { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"] };
    const plan = {
      ...seed,
      targetPageIds: [pageId],
      platforms: { facebook } as typeof seed.platforms,
      pagePlans: { [pageId]: { facebook } as typeof seed.platforms },
    };

    expect(() => AUTOMATION_PLATFORMS.forEach((platform) => {
      const platformPlan = getAutomationPlatformPlanForPage(plan, pageId, platform);
      if (!platformPlan.enabled) return;
    })).not.toThrow();
    expect(getAutomationPlatformPlanForPage(plan, "missing-page", "facebook")).toEqual(emptyAutomationPlatformPlan());
    expect(getAutomationPlatformPlanForPage(plan, pageId, "instagram")).toEqual(emptyAutomationPlatformPlan());
    expect(getAutomationPlatformPlanForPage(plan, pageId, "tiktok")).toEqual(emptyAutomationPlatformPlan());
    expect(getAutomationPlatformPlanForPage(plan, pageId, "youtube")).toEqual(emptyAutomationPlatformPlan());
  });

  it("preserves a page override before falling back to the global platform plan", () => {
    const seed = createAutomationPlan("workspace-1", "brand-1", "UTC");
    const globalInstagram = { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["10:00"] };
    const pageInstagram = { ...globalInstagram, publishTimes: ["11:00"] };
    const plan = {
      ...seed,
      targetPageIds: ["page-a"],
      platforms: { ...seed.platforms, instagram: globalInstagram },
      pagePlans: { "page-a": { ...seed.platforms, instagram: pageInstagram } },
    };

    expect(getAutomationPlatformPlanForPage(plan, "page-a", "instagram")).toEqual(pageInstagram);
    expect(getAutomationPlatformPlanForPage({ ...plan, pagePlans: { "page-a": { facebook: plan.platforms.facebook } as typeof seed.platforms } }, "page-a", "instagram")).toEqual(globalInstagram);
  });
});


describe("Automation Planner session drafts and save acknowledgements", () => {
  const scopeA = { profileId: "profile-a", clientId: "client-a", brandId: "brand-a", planId: "plan-a" };
  const scopeB = { profileId: "profile-a", clientId: "client-b", brandId: "brand-b", planId: "plan-b" };

  it("restores plan name and dirty state after leaving and returning to Planner", () => {
    const plan = { ...basePlan("plan-a"), name: "Edited name" };
    const draft = plannerDraft(scopeA, plan, { dirty: true, editRevision: 1 });
    const drafts = { [automationPlannerDraftKey(scopeA)]: draft };

    expect(plannerDraftForScope(drafts, scopeA)).toEqual(draft);
    expect(dirtyPlannerDraftForScope(drafts, scopeA)).toEqual(draft);
  });

  it("keeps A and B job drafts separate through A to B to A", () => {
    const draftA = plannerDraft(scopeA, basePlan("plan-a"), { dirty: true, selectedJobId: "job-a", editingJobId: "job-a", editingTime: "09:00", editRevision: 2 });
    const draftB = plannerDraft(scopeB, { ...basePlan("plan-b"), workspaceId: "client-b", brandId: "brand-b" }, { selectedJobId: "job-b", editingJobId: "job-b", editingTime: "11:00", editRevision: 1 });
    const drafts = { [automationPlannerDraftKey(scopeA)]: draftA, [automationPlannerDraftKey(scopeB)]: draftB };

    expect(automationPlannerDraftKey(scopeA)).not.toBe(automationPlannerDraftKey(scopeB));
    expect(plannerDraftForScope(drafts, scopeB)).toMatchObject({ selectedJobId: "job-b", editingTime: "11:00" });
    expect(plannerDraftForScope(drafts, scopeA)).toMatchObject({ selectedJobId: "job-a", editingTime: "09:00" });
  });

  it("reconciles A's successful save without replacing B's visible draft", async () => {
    const planA = basePlan("plan-a");
    const planB = { ...basePlan("plan-b"), workspaceId: "client-b", brandId: "brand-b" };
    const keyA = automationPlannerDraftKey(scopeA);
    const keyB = automationPlannerDraftKey(scopeB);
    const draftA = plannerDraft(scopeA, { ...planA, name: "Saved A" }, { dirty: true, editRevision: 3 });
    const draftB = plannerDraft(scopeB, planB, { editingJobId: "job-b", editingTime: "11:00", editRevision: 4 });
    let drafts = { [keyA]: draftA, [keyB]: draftB };
    const captured: AutomationPlannerSaveToken = { draftKey: keyA, scopeGeneration: 1, requestId: 1, editRevision: 3 };
    const currentOnB: AutomationPlannerSaveToken = { draftKey: keyB, scopeGeneration: 2, requestId: 0, editRevision: 4 };
    const request = deferred<typeof planA>();
    const completion = request.promise.then((acknowledged) => {
      drafts = acknowledgeAutomationPlannerDraft(drafts, captured, 1, acknowledged);
      return { nextDrafts: drafts, mayUpdateVisibleForm: canApplyAutomationPlanSaveResult(captured, currentOnB) };
    });
    request.resolve({ ...planA, name: "Saved A", generationProfileId: "profile-ack" });

    const result = await completion;
    expect(result.mayUpdateVisibleForm).toBe(false);
    expect(plannerDraftForScope(result.nextDrafts, scopeA)).toMatchObject({ dirty: false, plan: { name: "Saved A", generationProfileId: "profile-ack" } });
    expect(plannerDraftForScope(result.nextDrafts, scopeB)).toEqual(draftB);
  });

  it("keeps a newer 10:00 edit when the older 09:00 save succeeds after A to B to A", async () => {
    const key = automationPlannerDraftKey(scopeA);
    const original = plannerDraft(scopeA, basePlan("plan-a"), { dirty: true, selectedJobId: "job-a", editingJobId: "job-a", editingTime: "09:00", editRevision: 1 });
    const captured: AutomationPlannerSaveToken = { draftKey: key, scopeGeneration: 1, requestId: 1, editRevision: 1 };
    const request = deferred<typeof original.plan>();
    const newer = reviseAutomationPlannerDraft(original, { editingTime: "10:00", dirty: true });
    let currentDrafts = { [key]: newer };
    const currentToken: AutomationPlannerSaveToken = { ...captured, scopeGeneration: 3, editRevision: 2 };
    const completion = request.promise.then((acknowledged) => {
      const mayApply = canApplyAutomationPlanSaveResult(captured, currentToken);
      currentDrafts = acknowledgeAutomationPlannerDraft(currentDrafts, captured, 1, acknowledged);
      return mayApply;
    });
    request.resolve({ ...original.plan, pagePlans: { ...original.plan.pagePlans, "100000000000001": { ...original.plan.pagePlans!["100000000000001"], facebook: { ...original.plan.pagePlans!["100000000000001"].facebook, publishTimes: ["09:00"] } } } });

    await expect(completion).resolves.toBe(false);
    expect(plannerDraftForScope(currentDrafts, scopeA)).toMatchObject({ dirty: true, selectedJobId: "job-a", editingTime: "10:00", editRevision: 2 });
  });

  it("keeps the newer job edit and releases Save after the old request rejects", async () => {
    const key = automationPlannerDraftKey(scopeA);
    const original = plannerDraft(scopeA, basePlan("plan-a"), { dirty: true, editingJobId: "job-a", editingTime: "09:00", editRevision: 1 });
    const newer = reviseAutomationPlannerDraft(original, { editingTime: "10:00", dirty: true });
    const currentDrafts = { [key]: newer };
    const captured: AutomationPlannerSaveToken = { draftKey: key, scopeGeneration: 1, requestId: 1, editRevision: 1 };
    const current: AutomationPlannerSaveToken = { ...captured, scopeGeneration: 3, editRevision: 2 };
    const requestIds = new Map([[key, 1]]);
    const inFlight = new Set([key]);
    const request = deferred<typeof original.plan>();
    const completion = request.promise.catch(() => canApplyAutomationPlanSaveResult(captured, current)).finally(() => finishAutomationPlannerSave(requestIds, inFlight, key, captured.requestId));
    request.reject(new Error("older edit rejected"));

    await expect(completion).resolves.toBe(false);
    expect(plannerDraftForScope(currentDrafts, scopeA)).toMatchObject({ editingTime: "10:00", dirty: true });
    expect(inFlight.has(key)).toBe(false);
    expect(beginAutomationPlannerSave(requestIds, inFlight, key)).toBe(2);
  });

  it("stores the authoritative GenerationProfile from the acknowledged plan", () => {
    const key = automationPlannerDraftKey(scopeA);
    const draft = plannerDraft(scopeA, basePlan("plan-a"), { dirty: true, editRevision: 1 });
    const token: AutomationPlannerSaveToken = { draftKey: key, scopeGeneration: 1, requestId: 1, editRevision: 1 };
    const acknowledged = { ...draft.plan, generationProfileId: "profile-from-control-plane" };
    const drafts = acknowledgeAutomationPlannerDraft({ [key]: draft }, token, 1, acknowledged);

    expect(plannerDraftForScope(drafts, scopeA)?.plan.generationProfileId).toBe("profile-from-control-plane");
    expect(plannerDraftForScope(drafts, scopeA)?.dirty).toBe(false);
  });

  it("keeps a pending plan acknowledgement applicable when opening a job", async () => {
    const key = automationPlannerDraftKey(scopeA);
    const draft = plannerDraft(scopeA, basePlan("plan-a"), { dirty: true, editRevision: 1 });
    const token: AutomationPlannerSaveToken = { draftKey: key, scopeGeneration: 1, requestId: 1, editRevision: 1 };
    const request = deferred<typeof draft.plan>();
    let currentDraft = draft;
    const completion = request.promise.then((acknowledged) => acknowledgeAutomationPlannerDraft({ [key]: currentDraft }, token, 1, acknowledged));

    const openJobWhileSaving = () => {
      if (!canInteractWithUpcomingJobs(true)) return;
      currentDraft = reviseAutomationPlannerDraft(currentDraft, { selectedJobId: "job-a", editingJobId: "", editingTime: "" });
    };
    openJobWhileSaving();
    expect(currentDraft.editRevision).toBe(1);
    request.resolve({ ...draft.plan, name: "Saved plan" });

    const nextDrafts = await completion;
    expect(canInteractWithUpcomingJobs(false)).toBe(true);
    expect(plannerDraftForScope(nextDrafts, scopeA)).toMatchObject({ dirty: false, plan: { name: "Saved plan" } });
  });

  it("allows only one save request per draft when Save is double-clicked", () => {
    const key = automationPlannerDraftKey(scopeA);
    const requestIds = new Map<string, number>();
    const inFlight = new Set<string>();

    expect(beginAutomationPlannerSave(requestIds, inFlight, key)).toBe(1);
    expect(beginAutomationPlannerSave(requestIds, inFlight, key)).toBeUndefined();
    expect(inFlight.size).toBe(1);
  });
});

describe("automation planner remount selection", () => {
  it("selects the latest edited plan after parent save reorders historical records", () => {
    const historical = { ...basePlan("historical-plan"), cron: { enabled: false, startTime: "15:55", timezone: "Asia/Ho_Chi_Minh" }, status: "draft" as const, updatedAt: "2026-08-24T07:55:00.000Z" };
    const submitted = { ...basePlan("postfix-live-1787553712753"), cron: { enabled: true, startTime: "00:55", timezone: "Asia/Ho_Chi_Minh" }, status: "active" as const, updatedAt: "2026-08-24T08:05:00.000Z" };
    const parentPlansAfterSave = [historical, submitted];
    const remountedPlan = selectCanonicalAutomationPlan(parentPlansAfterSave, submitted.workspaceId, submitted.brandId);
    expect(remountedPlan).toMatchObject({
      id: submitted.id,
      status: "active",
      cron: { enabled: true, startTime: "00:55", timezone: "Asia/Ho_Chi_Minh" },
      targetPageIds: ["100000000000001"],
      pagePlans: { "100000000000001": { facebook: { postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:15"] } } },
    });
  });
});

describe("per-Page Facebook enable toggle", () => {
  it("preserves a 2-post 1-image/1-video Page plan across off→on", () => {
    const active = { enabled: true, postsPerDay: 2, imageCount: 1, videoCount: 1, publishTimes: ["09:00", "09:30"], runDays: [1, 2, 3, 4, 5, 6, 7] };
    const offPatch = togglePageFacebookEnabled(active);
    expect(offPatch).toEqual({ enabled: false });
    const disabled = { ...active, ...offPatch };
    expect(disabled.postsPerDay).toBe(2);
    expect(disabled.imageCount).toBe(1);
    expect(disabled.videoCount).toBe(1);
    expect(disabled.publishTimes).toEqual(["09:00", "09:30"]);
    expect(togglePageFacebookEnabled(disabled)).toEqual({ enabled: true, postsPerDay: 2, imageCount: 1, videoCount: 1 });
  });

  it("uses the safe 1-image default when re-enabling a zero-count Page plan", () => {
    expect(togglePageFacebookEnabled({ enabled: false, postsPerDay: 0, imageCount: 0, videoCount: 0, publishTimes: [] })).toEqual({ enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0 });
  });
});
