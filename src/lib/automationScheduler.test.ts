import { describe, expect, it } from "vitest";
import { starterStrategyCatalog } from "./contentStrategy";
import { captureAutomationStrategySnapshot, createAutomationPlan, expandAutomationPlatformPlan, normalizeAutomationPlan, upsertAutomationPlan, validateAutomationPlan, validAutomationStrategySnapshot, type AutomationPlan } from "./automationPlanner";
import { buildResolvedAutomationSlots, buildUpcomingAutomationJobs, cloneCampaignScheduleTemplate, resolveAutomationPlanScopes, type CampaignScheduleTemplate } from "./automationScheduler";
import { createBrandDraft, createClient, defaultWorkspaceState, ensureBrandScheduleTemplate } from "./workspaceDomain";

const template: CampaignScheduleTemplate = {
  id: "brand-default",
  campaignId: "brand-default",
  brandId: "brand-1",
  timezone: "UTC",
  timesByWeekday: { 1: ["09:00"], 2: ["09:00"], 3: ["09:00"], 4: ["09:00"], 5: ["09:00"], 6: ["10:00"], 7: ["10:00"] },
  version: 1,
  source: "brand_default",
};

function plan(): AutomationPlan {
  const base = createAutomationPlan("workspace-1", "brand-1", "UTC", new Date("2026-09-14T00:00:00.000Z"));
  return {
    ...base,
    campaignId: "campaign-1",
    dateRange: { startDate: "2026-09-14", endDate: "2026-09-15" },
    scheduleTemplate: cloneCampaignScheduleTemplate(template, "campaign-1", new Date("2026-09-14T00:00:00.000Z")),
    strategySelection: { objective: "reach", pillar: "practical-education", angle: "practical-education-step-by-step-guide" },
    platforms: {
      ...base.platforms,
      facebook: { ...base.platforms.facebook, enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], formatMode: "image" },
      instagram: { ...base.platforms.instagram, enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], formatMode: "image" },
    },
  };
}

describe("campaign schedule cloning", () => {
  it("creates an isolated campaign-owned template", () => {
    const cloned = cloneCampaignScheduleTemplate(template, "campaign-1", new Date("2026-09-14T01:02:03.000Z"));

    expect(cloned).toMatchObject({ campaignId: "campaign-1", brandId: "brand-1", source: "campaign_clone" });
    expect(cloned.id).not.toBe(template.id);
    cloned.timesByWeekday[1]!.push("18:00");
    expect(template.timesByWeekday[1]).toEqual(["09:00"]);
  });
});

describe("Brand default schedule handoff", () => {
  it("renders the next deterministic local slot from an ensured Brand default", () => {
    const createdAt = new Date("2026-09-14T00:00:00.000Z");
    const client = createClient("Scheduler Client", "UTC", "client-scheduler");
    const brand = { ...createBrandDraft(client.id, "Scheduler Brand", "brand-scheduler"), status: "active" as const };
    const state = { ...structuredClone(defaultWorkspaceState), workspaces: [client], brands: [brand] };
    const ensured = ensureBrandScheduleTemplate(state, client.id, brand.id, createdAt);
    const brandDefault = ensured.scheduleTemplatesByBrand?.[JSON.stringify([client.id, brand.id])];
    const base = createAutomationPlan(client.id, brand.id, "UTC", createdAt);
    const plan: AutomationPlan = {
      ...base,
      id: "plan-brand-default",
      campaignId: "campaign-brand-default",
      dateRange: { startDate: "2026-09-14", endDate: "2026-09-14" },
      scheduleTemplate: { ...brandDefault!, campaignId: "campaign-brand-default", source: "brand_default" },
      platforms: { ...base.platforms, facebook: { ...base.platforms.facebook, enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"] } },
    };

    const first = buildUpcomingAutomationJobs(plan, new Date("2026-09-13T18:00:00.000Z"));
    const second = buildUpcomingAutomationJobs(plan, new Date("2026-09-13T18:00:00.000Z"));

    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({ publishTime: "09:00", nextActionAt: "2026-09-14T09:00:00.000Z", scheduleSource: "campaign_template", weekday: 1 });
  });

  it("produces no jobs when a trashed Brand cannot supply a default template", () => {
    const now = new Date("2026-09-13T18:00:00.000Z");
    const client = createClient("Trashed Client", "UTC", "client-trashed");
    const brand = { ...createBrandDraft(client.id, "Trashed Brand", "brand-trashed"), status: "archived" as const, deletedAt: now.toISOString() };
    const state = { ...structuredClone(defaultWorkspaceState), workspaces: [client], brands: [brand] };
    const ensured = ensureBrandScheduleTemplate(state, client.id, brand.id, now);
    const base = createAutomationPlan(client.id, brand.id, "UTC", now);
    const plan = { ...base, campaignId: "campaign-trashed", dateRange: { startDate: "2026-09-14", endDate: "2026-09-14" }, platforms: { ...base.platforms, facebook: { ...base.platforms.facebook, enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"] } } };

    expect(ensured.scheduleTemplatesByBrand).toBeUndefined();
    expect(buildUpcomingAutomationJobs(plan, now)).toEqual([]);
  });
});

describe("resolved automation slot preview", () => {
  it("expands deterministic date/time/platform slots with channel angles", () => {
    const input = { plan: plan(), catalog: starterStrategyCatalog("brand-1", new Date("2026-09-14T00:00:00.000Z")), scheduleTemplate: cloneCampaignScheduleTemplate(template, "campaign-1") };
    const first = buildResolvedAutomationSlots(input);
    const second = buildResolvedAutomationSlots(input);

    expect(first).toMatchObject({ ok: true });
    expect(first).toEqual(second);
    if (!first.ok) return;
    expect(first.slots).toHaveLength(4);
    expect(first.slots[0]).toMatchObject({ id: expect.any(String), scheduledAt: "2026-09-14T09:00:00.000Z", mediaKind: "image", contentKind: "image", objectiveKey: "reach", pillarId: "practical-education", catalogFingerprint: expect.any(String), angleIdByChannel: { facebook: "practical-education-step-by-step-guide", instagram: "practical-education-step-by-step-guide" } });
  });

  it("returns all preview errors and never returns partial slots", () => {
    const invalid = plan();
    invalid.platforms.youtube = { ...invalid.platforms.youtube, enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], formatMode: "image" };
    invalid.scheduleTemplate = { ...invalid.scheduleTemplate!, timezone: "Not/AZone", timesByWeekday: { 1: ["not-time"] } };
    const result = buildResolvedAutomationSlots({ plan: invalid, catalog: starterStrategyCatalog("brand-1"), scheduleTemplate: invalid.scheduleTemplate });

    expect(result).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringMatching(/timezone/i), expect.stringMatching(/youtube|capability/i)]) });
    if (result.ok) return;
    expect(result).not.toHaveProperty("slots");
  });

  it("accepts startDate/endDate and resets a Mix sequence for each calendar day", () => {
    const value = plan();
    value.dateRange = { startDate: "2026-09-14", endDate: "2026-09-20" };
    value.platforms.instagram = { ...value.platforms.instagram, enabled: false };
    value.platforms.facebook = { ...value.platforms.facebook, postsPerDay: 2, imageCount: 1, videoCount: 1, publishTimes: ["09:00", "18:00"], formatMode: "mix", formatMix: { image: 1, video: 1 } };
    value.scheduleTemplate = { ...value.scheduleTemplate!, timesByWeekday: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [index + 1, ["09:00", "18:00"]])) };
    const result = buildResolvedAutomationSlots({ plan: value, catalog: starterStrategyCatalog("brand-1"), scheduleTemplate: value.scheduleTemplate });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const byDate = result.slots.reduce((groups, slot) => {
      const date = slot.scheduledAt.slice(0, 10);
      groups[date] = [...(groups[date] ?? []), slot.mediaKind];
      return groups;
    }, {} as Record<string, string[]>);
    expect(Object.values(byDate)).toEqual(Array.from({ length: 7 }, () => ["image", "video"]));
  });

  it("honors each platform runDays while treating absent template weekdays as non-run days", () => {
    const value = plan();
    value.dateRange = { startDate: "2026-09-14", endDate: "2026-09-16" };
    value.platforms.facebook = { ...value.platforms.facebook, runDays: [1] };
    value.platforms.instagram = { ...value.platforms.instagram, runDays: [2] };
    value.scheduleTemplate = { ...value.scheduleTemplate!, timesByWeekday: { 1: ["09:00"], 2: ["10:00"] } };
    const result = buildResolvedAutomationSlots({ plan: value, catalog: starterStrategyCatalog("brand-1"), scheduleTemplate: value.scheduleTemplate });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.slots.map((slot) => [slot.scheduledAt.slice(0, 10), slot.platform])).toEqual([["2026-09-14", "facebook"], ["2026-09-15", "instagram"]]);
  });

  it("resolves independent Page schedules without producing partial slots", () => {
    const value = plan();
    value.platforms.facebook = { ...value.platforms.facebook, enabled: false };
    value.platforms.instagram = { ...value.platforms.instagram, enabled: false };
    value.targetPageIds = ["page-a", "page-b"];
    value.bindingIds = ["binding-a", "binding-b"];
    value.pagePlans = {
      "page-a": { ...value.platforms, facebook: { enabled: true, postsPerDay: 2, imageCount: 1, videoCount: 1, publishTimes: ["08:00", "12:00"], formatMode: "mix", formatMix: { image: 1, video: 1 } } },
      "page-b": { ...value.platforms, facebook: { enabled: true, postsPerDay: 1, imageCount: 0, videoCount: 1, publishTimes: ["17:00"], formatMode: "video" } },
    };
    value.dateRange = { startDate: "2026-09-14", endDate: "2026-09-14" };
    const result = buildResolvedAutomationSlots({ plan: value, catalog: starterStrategyCatalog("brand-1"), scheduleTemplate: value.scheduleTemplate! });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.slots.map((slot) => [slot.targetPageId, slot.mediaKind])).toEqual([["page-a", "image"], ["page-a", "video"], ["page-b", "video"]]);
  });

  it("rejects a nonexistent local time before returning any slot", () => {
    const value = plan();
    value.dateRange = { startDate: "2026-03-08", endDate: "2026-03-08" };
    value.platforms.instagram = { ...value.platforms.instagram, enabled: false };
    value.platforms.facebook = { ...value.platforms.facebook, postsPerDay: 1, imageCount: 1, videoCount: 0 };
    const localTemplate = { ...value.scheduleTemplate!, timezone: "America/New_York", timesByWeekday: { 7: ["02:30"] } };
    const result = buildResolvedAutomationSlots({ plan: value, catalog: starterStrategyCatalog("brand-1"), scheduleTemplate: localTemplate });

    expect(result).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringContaining("does not exist")]) });
  });

  it("captures an immutable strategy snapshot and requires it for a new active plan", () => {
    const value = plan();
    const catalog = starterStrategyCatalog("brand-1");
    const preview = buildResolvedAutomationSlots({ plan: value, catalog, scheduleTemplate: value.scheduleTemplate! });
    expect(preview).toMatchObject({ ok: true });
    if (!preview.ok) return;
    const snapshot = captureAutomationStrategySnapshot({ plan: value, catalog, preview, capturedAt: "2026-09-14T00:00:00.000Z" });

    expect(snapshot).toMatchObject({ catalogVersion: 1, catalogFingerprint: expect.any(String), selection: value.strategySelection, targetChannels: ["facebook", "instagram"], capturedAt: "2026-09-14T00:00:00.000Z", revision: value.revision, resolvedFingerprint: expect.any(String) });
    expect(snapshot.resolvedSlots[0]).toMatchObject({ objectiveLabel: "Reach", pillarLabel: "Practical education", angleLabelByChannel: { facebook: "Step-by-step guide", instagram: "Step-by-step guide" }, angleGuidanceByChannel: expect.any(Object) });
    expect(validateAutomationPlan({ ...value, status: "active", generationProfileId: "profile-a", strategySnapshot: undefined }).errors).toContain("Strategy snapshot is required for an active plan.");
    const stored = upsertAutomationPlan([], { ...value, status: "active", generationProfileId: "profile-a", strategySnapshot: undefined }, snapshot)[0];
    expect(stored.strategySnapshot).toEqual(snapshot);
    const replacement = { ...snapshot, resolvedFingerprint: "replacement-fingerprint" };
    expect(upsertAutomationPlan([], { ...value, status: "active", generationProfileId: "profile-a", strategySnapshot: snapshot }, replacement)[0].strategySnapshot).toEqual(replacement);
    expect(() => upsertAutomationPlan([], { ...value, status: "active", generationProfileId: "profile-a", strategySnapshot: undefined })).toThrow("STRATEGY_SNAPSHOT_REQUIRED");
    expect(validateAutomationPlan({ ...value, status: "active", generationProfileId: "profile-a", strategySnapshot: { ...snapshot, selection: undefined } as never }).errors).toContain("Strategy snapshot is invalid.");
    value.strategySelection!.objective = "mix";
    expect(snapshot.selection.objective).toBe("reach");
  });

  it("blocks a stale catalog snapshot without silently re-resolving the plan", () => {
    const value = plan();
    const catalog = starterStrategyCatalog("brand-1");
    const preview = buildResolvedAutomationSlots({ plan: value, catalog, scheduleTemplate: value.scheduleTemplate! });
    expect(preview).toMatchObject({ ok: true });
    if (!preview.ok) return;
    const snapshot = captureAutomationStrategySnapshot({ plan: value, catalog, preview, capturedAt: "2026-09-14T00:00:00.000Z" });
    const staleCatalog = { ...catalog, version: 2, updatedAt: "2026-09-15T00:00:00.000Z" };
    const stale = buildResolvedAutomationSlots({ plan: { ...value, strategySnapshot: snapshot }, catalog: staleCatalog, scheduleTemplate: value.scheduleTemplate! });

    expect(stale).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringMatching(/catalog|snapshot|review/i)]) });
  });

  it("rejects a missing selection or malformed preview before snapshot capture", () => {
    const value = plan();
    const catalog = starterStrategyCatalog("brand-1");
    expect(() => captureAutomationStrategySnapshot({ plan: { ...value, strategySelection: undefined }, catalog, preview: { ok: false, errors: ["invalid"] }, capturedAt: "2026-09-14T00:00:00.000Z" })).toThrow("STRATEGY_SELECTION_REQUIRED");
    expect(() => captureAutomationStrategySnapshot({ plan: { ...value, scheduleTemplate: undefined }, catalog, slots: [], capturedAt: "2026-09-14T00:00:00.000Z" })).toThrow("STRATEGY_SNAPSHOT_PREVIEW_REQUIRED");
    expect(() => captureAutomationStrategySnapshot({ plan: value, catalog, preview: { ok: false, errors: ["invalid"] }, capturedAt: "2026-09-14T00:00:00.000Z" })).toThrow("STRATEGY_SNAPSHOT_PREVIEW_INVALID");
    expect(() => captureAutomationStrategySnapshot({ plan: { ...value, scheduleTemplate: undefined }, catalog, preview: { ok: true, slots: [] }, capturedAt: "2026-09-14T00:00:00.000Z" })).toThrow("STRATEGY_SNAPSHOT_PREVIEW_UNVERIFIED");
  });

  it("keeps shared objective/pillar while resolving different channel angles", () => {
    const value = plan();
    value.strategySelection = { objective: "reach", pillar: "practical-education", angle: "mix" };
    const catalog = starterStrategyCatalog("brand-1");
    catalog.channelOverrides.instagram = { disabledAngleIds: ["practical-education-step-by-step-guide"] };
    const preview = buildResolvedAutomationSlots({ plan: value, catalog, scheduleTemplate: value.scheduleTemplate! });

    expect(preview).toMatchObject({ ok: true });
    if (!preview.ok) return;
    expect(preview.slots[0]).toMatchObject({ objectiveKey: "reach", pillarId: "practical-education", angleIdByChannel: { facebook: "practical-education-step-by-step-guide", instagram: "practical-education-common-mistake" } });
  });

  it("uses root format fields for expansion, preview, validation, and upcoming jobs", () => {
    const value = plan();
    value.platforms.instagram = { ...value.platforms.instagram, enabled: false };
    value.platforms.facebook = { ...value.platforms.facebook, postsPerDay: 7, imageCount: 0, videoCount: 0, publishTimes: ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"], formatMode: undefined, formatMix: undefined };
    value.formatMode = "mix";
    value.formatMix = { image: 60, video: 40 };
    value.dateRange = { startDate: "2026-09-14", endDate: "2026-09-14" };
    value.scheduleTemplate = { ...value.scheduleTemplate!, timesByWeekday: { 1: ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"] } };

    const expanded = expandAutomationPlatformPlan("facebook", value as never);
    expect(expanded.filter((spec) => spec.mediaKind === "image")).toHaveLength(4);
    expect(validateAutomationPlan(value).errors).not.toContain("facebook image and video counts must equal posts per day.");
    const preview = buildResolvedAutomationSlots({ plan: value, catalog: starterStrategyCatalog("brand-1"), scheduleTemplate: value.scheduleTemplate });
    expect(preview).toMatchObject({ ok: true });
    const jobs = buildUpcomingAutomationJobs(value, new Date("2026-09-13T18:00:00.000Z"));
    expect(jobs.filter((job) => job.mediaKind === "image")).toHaveLength(4);
  });

  it("rejects ambiguous wall-clock time and Page spring-forward time consistently", () => {
    const ambiguous = plan();
    ambiguous.platforms.instagram = { ...ambiguous.platforms.instagram, enabled: false };
    ambiguous.dateRange = { startDate: "2026-11-01", endDate: "2026-11-01" };
    ambiguous.scheduleTemplate = { ...ambiguous.scheduleTemplate!, timezone: "America/New_York", timesByWeekday: { 7: ["01:30"] } };
    const ambiguousPreview = buildResolvedAutomationSlots({ plan: ambiguous, catalog: starterStrategyCatalog("brand-1"), scheduleTemplate: ambiguous.scheduleTemplate });
    expect(ambiguousPreview).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringMatching(/ambiguous/i)]) });

    const page = plan();
    page.platforms.facebook = { ...page.platforms.facebook, enabled: false };
    page.platforms.instagram = { ...page.platforms.instagram, enabled: false };
    page.targetPageIds = ["page-a"];
    page.bindingIds = ["binding-a"];
    page.pagePlans = { "page-a": { ...page.platforms, facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["02:30"] } } };
    page.dateRange = { startDate: "2026-03-08", endDate: "2026-03-08" };
    page.scheduleTemplate = { ...page.scheduleTemplate!, timezone: "America/New_York", timesByWeekday: { 7: ["09:00"] } };
    const pagePreview = buildResolvedAutomationSlots({ plan: page, catalog: starterStrategyCatalog("brand-1"), scheduleTemplate: page.scheduleTemplate });
    expect(pagePreview).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringMatching(/does not exist|nonexistent/i)]) });
    expect(buildUpcomingAutomationJobs(page, new Date("2026-03-07T12:00:00.000Z"))).toEqual([]);
  });

  it("keeps a count-only non-Facebook Page override as an explicit scope", () => {
    const value = plan();
    value.platforms.facebook = { ...value.platforms.facebook, enabled: false };
    value.platforms.instagram = { enabled: true, postsPerDay: 1, imageCount: 0, videoCount: 1, publishTimes: ["09:00"] };
    value.targetPageIds = ["page-a"];
    value.bindingIds = ["binding-a"];
    value.pagePlans = { "page-a": { ...value.platforms, facebook: { enabled: false, postsPerDay: 0, imageCount: 0, videoCount: 0, publishTimes: [] }, instagram: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"] } } };

    expect(resolveAutomationPlanScopes(value).filter((scope) => scope.platform === "instagram")).toEqual([expect.objectContaining({ pageId: "page-a", source: "scope", item: expect.objectContaining({ imageCount: 1, videoCount: 0 }) })]);
  });

  it("uses root format fields for an independent binding when the binding has legacy counts", () => {
    const value = plan();
    value.formatMode = "mix";
    value.formatMix = { image: 60, video: 40 };
    value.platforms.facebook = { ...value.platforms.facebook, enabled: false };
    value.platforms.instagram = { ...value.platforms.instagram, enabled: false };
    value.targetPageIds = ["page-a"];
    value.bindingIds = ["binding-a"];
    value.pagePlans = { "page-a": { ...value.platforms, facebook: { enabled: false, postsPerDay: 0, imageCount: 0, videoCount: 0, publishTimes: [] } } };
    value.bindingSchedules = { "binding-a": { mode: "independent", postsPerDay: 2, imageCount: 0, videoCount: 0, publishTimes: ["08:00", "12:00"], runDays: [1] } };
    value.dateRange = { startDate: "2026-09-14", endDate: "2026-09-14" };
    expect(validateAutomationPlan(value).errors).not.toContain("binding-a: Binding schedule media totals must equal posts per day.");
    const normalized = normalizeAutomationPlan(value);
    expect(normalized.bindingSchedules?.["binding-a"]).toMatchObject({ imageCount: 1, videoCount: 1 });
    expect(validateAutomationPlan(normalized).errors).not.toContain("binding-a: Binding schedule media totals must equal posts per day.");
    const preview = buildResolvedAutomationSlots({ plan: normalized, catalog: starterStrategyCatalog("brand-1"), scheduleTemplate: normalized.scheduleTemplate! });
    expect(preview).toMatchObject({ ok: true });
    expect(buildUpcomingAutomationJobs(normalized, new Date("2026-09-13T12:00:00.000Z")).map((job) => job.mediaKind)).toEqual(["image", "video"]);
    const binding = normalized.bindingSchedules?.["binding-a"];
    if (!binding || binding.mode !== "independent") return;
    expect(expandAutomationPlatformPlan("facebook", { enabled: true, postsPerDay: binding.postsPerDay, imageCount: binding.imageCount, videoCount: binding.videoCount, publishTimes: binding.publishTimes }, normalized).map((spec) => spec.mediaKind)).toEqual(["image", "video"]);
  });

  it("rejects malformed snapshot slot platform and timestamp before active/upsert", () => {
    const value = plan();
    const catalog = starterStrategyCatalog("brand-1");
    const preview = buildResolvedAutomationSlots({ plan: value, catalog, scheduleTemplate: value.scheduleTemplate! });
    expect(preview).toMatchObject({ ok: true });
    if (!preview.ok) return;
    const snapshot = captureAutomationStrategySnapshot({ plan: value, catalog, preview, capturedAt: "2026-09-14T00:00:00.000Z" });
    const unknownPlatform = { ...snapshot, resolvedSlots: [{ ...snapshot.resolvedSlots[0], platform: "mastodon" }] };
    const invalidTimestamp = { ...snapshot, resolvedSlots: [{ ...snapshot.resolvedSlots[0], scheduledAt: "not-an-iso-instant" }] };

    expect(validAutomationStrategySnapshot(unknownPlatform as never)).toBe(false);
    expect(validAutomationStrategySnapshot(invalidTimestamp as never)).toBe(false);
    expect(validateAutomationPlan({ ...value, status: "active", generationProfileId: "profile-a", strategySnapshot: unknownPlatform as never }).errors).toContain("Strategy snapshot is invalid.");
  });
});

describe("campaign template upcoming jobs", () => {
  it("uses cloned template times and date range for the next job", () => {
    const value = plan();
    value.platforms.instagram = { ...value.platforms.instagram, enabled: false };
    value.dateRange = { startDate: "2026-09-14", endDate: "2026-09-14" };
    value.scheduleTemplate = { ...value.scheduleTemplate!, timezone: "UTC", timesByWeekday: { 1: ["11:00"] } };
    const jobs = buildUpcomingAutomationJobs(value, new Date("2026-09-13T18:00:00.000Z"));

    expect(jobs.map((job) => [job.publishTime, job.nextActionAt])).toEqual([["11:00", "2026-09-14T11:00:00.000Z"]]);
    expect(jobs[0]).toMatchObject({ scheduleSource: "campaign_template", weekday: 1 });
  });
});
