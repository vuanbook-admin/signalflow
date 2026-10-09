// @ts-expect-error Vitest executes this focused source check in Node; the app tsconfig does not include Node declarations.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { automationPlannerModalCancel, beginStrategyCatalogPanelSave, BrandStrategyPanel, BrandViewV2, brandStrategyCanManage, canCloseAutomationPlannerModal, canReloadStrategyCatalogPanel, contentIntelligenceRecordsForScope, createAutomationPlannerModalState, createBrandStrategyPanelController, dispatchContentTableTargetAction, PlannerStrategySection, projectAutomationPlannerModal, resolveStrategyCatalogHydrationAction, resolveContentTableTargetAction, settleStrategyCatalogPanelSave, strategyRecipeOptions, transitionAutomationPlannerModalSave, updateAutomationPlannerModalDraft, type BrandStrategyPanelControllerState, type BrandViewV2Props, type StrategyCatalogSaveResult } from "./ExpandedViews";
import { summarizeContentIntelligenceSelection } from "./RevoContentStudio";
import { buildAutomationPlannerPreview, createAutomationPlan, plannerStrategyChoices, type AutomationPlan, type AutomationPlannerPreviewResult, type AutomationPlannerSaveResult, type AutomationPlannerSaveToken } from "./lib/automationPlanner";
import { starterStrategyCatalog, strategyCatalogFingerprint, type BrandStrategyCatalog } from "./lib/contentStrategy";
import { defaultWorkspaceState } from "./lib/workspaceDomain";
import { applyStrategyCatalogEdit } from "./ExpandedViews";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => { resolve = promiseResolve; reject = promiseReject; });
  return { promise, resolve, reject };
}

describe("content intelligence brand scope", () => {
  it("keeps only active-client and active-brand records, allowing unassigned research evidence", () => {
    const scoped = contentIntelligenceRecordsForScope({
      clientId: "client-a",
      brandId: "brand-a",
      knowledgeItems: [
        { id: "knowledge-a", clientId: "client-a", brandId: "brand-a" },
        { id: "knowledge-b", clientId: "client-a", brandId: "brand-b" },
        { id: "knowledge-c", clientId: "client-b", brandId: "brand-a" },
      ],
      researchEvidence: [
        { id: "evidence-a", clientId: "client-a", brandId: "brand-a" },
        { id: "evidence-unassigned", clientId: "client-a" },
        { id: "evidence-b", clientId: "client-a", brandId: "brand-b" },
        { id: "evidence-c", clientId: "client-b", brandId: "brand-a" },
      ],
      promptBlueprints: [
        { id: "blueprint-a", brandId: "brand-a" },
        { id: "blueprint-b", brandId: "brand-b" },
      ],
      contentRecipes: [
        { id: "recipe-a", brandId: "brand-a" },
        { id: "recipe-b", brandId: "brand-b" },
      ],
      trendSignals: [
        { id: "trend-a", clientId: "client-a" },
        { id: "trend-b", clientId: "client-b" },
      ],
    });

    expect(scoped.knowledgeItems.map(({ id }) => id)).toEqual(["knowledge-a"]);
    expect(scoped.researchEvidence.map(({ id }) => id)).toEqual(["evidence-a", "evidence-unassigned"]);
    expect(scoped.promptBlueprints.map(({ id }) => id)).toEqual(["blueprint-a"]);
    expect(scoped.contentRecipes.map(({ id }) => id)).toEqual(["recipe-a"]);
    expect(scoped.trendSignals.map(({ id }) => id)).toEqual(["trend-a"]);
  });
});

describe("SafeMode-free renderer contracts", () => {
  it("does not expose SafeMode controls, copy, or a visible local mock provider", () => {
    const source = readFileSync(new URL("./ExpandedViews.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/safe.?mode|simulation mode|mô phỏng|Local mock/i);
    expect(source).not.toContain("onSafeModeChange");
    expect(source).toContain('liveReadiness: "ready" | "blocked"');
  });

  it("does not default or render a Local mock option in the production Revo composer", () => {
    const source = readFileSync(new URL("./RevoContentStudio.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/aiProvider:\s*["']mock["']/);
    expect(source).not.toMatch(/Local mock/i);
  });
});

describe("Brand strategy catalog edits", () => {
  const makeCatalog = (): BrandStrategyCatalog => starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));

  it("applies nested structural edits without mutating the saved catalog", () => {
    const source = makeCatalog();
    const before = structuredClone(source);
    const edited = applyStrategyCatalogEdit(source, { type: "set-objective", key: "reach", patch: { label: "Discover families" } }, new Date("2026-09-15T01:00:00.000Z"));
    const withAngle = applyStrategyCatalogEdit(edited, { type: "set-angle", pillarId: "audience-insight", id: "audience-insight-audience-question", patch: { guidance: "Answer one verified family question." } }, new Date("2026-09-15T01:00:00.000Z"));
    expect(withAngle.objectives.find((item) => item.key === "reach")?.label).toBe("Discover families");
    expect(withAngle.pillars[0].angles[0].guidance).toBe("Answer one verified family question.");
    expect(source).toEqual(before);
    expect(withAngle.updatedAt).toBe("2026-09-15T01:00:00.000Z");
  });

  it("renumbers order and toggles channel overrides through one edit contract", () => {
    const source = makeCatalog();
    const moved = applyStrategyCatalogEdit(source, { type: "move-pillar", id: "brand-trust", direction: "up" }, new Date("2026-09-15T01:00:00.000Z"));
    const channel = applyStrategyCatalogEdit(moved, { type: "toggle-angle-channel", pillarId: "brand-trust", id: "brand-trust-brand-values", channel: "instagram" }, new Date("2026-09-15T01:00:00.000Z"));
    const override = applyStrategyCatalogEdit(channel, { type: "update-override", channel: "instagram", patch: { disabledPillarIds: ["brand-trust"], guidanceByAngleId: { "audience-insight-audience-question": "Use a concise answer." } } }, new Date("2026-09-15T01:00:00.000Z"));
    expect(override.pillars.find((item) => item.id === "brand-trust")?.order).toBe(4);
    expect(override.pillars.map((item) => item.order)).toEqual([1, 2, 3, 4, 5]);
    expect(override.pillars.find((item) => item.id === "brand-trust")?.angles[0].channels).not.toContain("instagram");
    expect(override.channelOverrides.instagram).toMatchObject({ disabledPillarIds: ["brand-trust"], guidanceByAngleId: { "audience-insight-audience-question": "Use a concise answer." } });
  });
});

describe("E08 multi-target review actions", () => {
  it("keeps multi-target reschedule and cancel actions on the draft-level route", () => {
    expect(resolveContentTableTargetAction({ queueJobIds: ["job-a", "job-b"] })).toEqual({ mode: "draft" });
    expect(resolveContentTableTargetAction({ queueJobId: "job-a" })).toEqual({ mode: "job", jobId: "job-a" });
    expect(resolveContentTableTargetAction({ queueJobIds: [] })).toEqual({ mode: "unavailable" });
  });

  it("dispatches multi-target actions through the draft callback and single-target actions through job callbacks", () => {
    const onDraftTargetAction = vi.fn();
    const onReschedule = vi.fn();
    const onCancel = vi.fn();
    const callbacks = { onDraftTargetAction, onReschedule, onCancel };

    expect(dispatchContentTableTargetAction({ id: 7, queueJobIds: ["job-a", "job-b"] }, "reschedule", callbacks)).toBe("draft");
    expect(onDraftTargetAction).toHaveBeenCalledWith(7, "reschedule");
    expect(onReschedule).not.toHaveBeenCalled();
    expect(dispatchContentTableTargetAction({ id: 7, queueJobIds: ["job-a", "job-b"] }, "cancel_schedule", callbacks)).toBe("draft");
    expect(onDraftTargetAction).toHaveBeenLastCalledWith(7, "cancel");

    expect(dispatchContentTableTargetAction({ id: 8, queueJobId: "job-c" }, "reschedule", callbacks)).toBe("job");
    expect(onReschedule).toHaveBeenCalledWith("job-c");
    expect(dispatchContentTableTargetAction({ id: 8, queueJobId: "job-c" }, "cancel_schedule", callbacks)).toBe("job");
    expect(onCancel).toHaveBeenCalledWith("job-c");

    expect(dispatchContentTableTargetAction({ id: 9 }, "cancel_schedule", callbacks)).toBe("unavailable");
    expect(onDraftTargetAction).toHaveBeenCalledTimes(2);
    expect(onReschedule).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("E08 automation plan editor state", () => {
  it("projects create and edit modes onto the selected plan identity", () => {
    const scope = { profileId: "profile-a", clientId: "client-a", brandId: "brand-a" };
    const plan = createAutomationPlan("client-a", "brand-a", "Asia/Ho_Chi_Minh", new Date("2026-09-13T00:00:00.000Z"));
    const create = createAutomationPlannerModalState(scope, "create", { id: "local-create-1" }, plan.id);
    const edit = createAutomationPlannerModalState(scope, "edit", plan, plan.id);

    expect(create).toMatchObject({ mode: "create", planId: "local-create-1", originPlanId: plan.id });
    expect(edit).toMatchObject({ mode: "edit", planId: plan.id, originPlanId: plan.id });
    expect(create.draftKey).not.toBe(edit.draftKey);
    expect(edit.scopeKey).toBe(create.scopeKey);
  });

  it("restores the opener plan and removes only the modal draft on cancel", () => {
    const modal = createAutomationPlannerModalState(
      { profileId: "profile-a", clientId: "client-a", brandId: "brand-a" },
      "create",
      { id: "local-create-1" },
      "plan-existing",
    );

    expect(automationPlannerModalCancel(modal, "plan-canonical")).toEqual({ draftKey: modal.draftKey, restorePlanId: "plan-existing", removeDraft: true });
    expect(automationPlannerModalCancel({ ...modal, originPlanId: undefined }, "plan-canonical").restorePlanId).toBe("plan-canonical");
  });

  it("keeps metadata, assets, targets and cadence in one save projection", () => {
    const base = createAutomationPlan("client-a", "brand-a", "Asia/Ho_Chi_Minh", new Date("2026-09-13T00:00:00.000Z"));
    const plan = {
      ...base,
      id: "plan-edit-1",
      name: "September launch",
      objectiveMode: "Reach",
      contentPillar: "Product",
      angle: "Proof",
      campaignStartAt: "2026-09-14T00:00:00.000Z",
      campaignEndAt: "2026-09-30T16:59:59.999Z",
      selectedAssetIds: ["asset-1"],
      targetPageIds: ["page-1"],
      bindingIds: ["binding-1"],
      platforms: {
        ...base.platforms,
        instagram: { enabled: true, postsPerDay: 2, imageCount: 1, videoCount: 1, publishTimes: ["09:00", "18:00"], runDays: [1, 3, 5] },
      },
      pagePlans: {
        "page-1": {
          ...base.platforms,
          facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["10:30"], runDays: [2, 4, 6] },
        },
      },
      cron: { enabled: true, startTime: "08:15", timezone: "Asia/Ho_Chi_Minh" },
    };
    const projection = projectAutomationPlannerModal(plan);

    expect(projection.metadata).toMatchObject({ name: "September launch", objectiveMode: "Reach", contentPillar: "Product", angle: "Proof" });
    expect(projection.scope).toEqual({ selectedAssetIds: ["asset-1"], targetPageIds: ["page-1"], bindingIds: ["binding-1"] });
    expect(projection.cadence.cron).toEqual(plan.cron);
    expect(projection.cadence.platforms.find(({ platform }) => platform === "instagram")?.plan).toMatchObject({ postsPerDay: 2, imageCount: 1, videoCount: 1, publishTimes: ["09:00", "18:00"], runDays: [1, 3, 5] });
    expect(projection.cadence.pagePlans).toEqual([{ pageId: "page-1", facebook: expect.objectContaining({ postsPerDay: 1, publishTimes: ["10:30"], runDays: [2, 4, 6] }) }]);
  });

  it("drives representative create and edit updates into one draft and exact save payload", async () => {
    const scope = { profileId: "profile-a", clientId: "client-a", brandId: "brand-a" };
    const base = createAutomationPlan("client-a", "brand-a", "Asia/Ho_Chi_Minh", new Date("2026-09-13T00:00:00.000Z"));
    const createPlan = { ...base, id: "local-create-1" };
    const metadataPlan = { ...createPlan, name: "September launch", objectiveMode: "Reach", contentPillar: "Product", angle: "Proof", campaignStartAt: "2026-09-14T00:00:00.000Z", campaignEndAt: "2026-09-30T16:59:59.999Z" };
    const scopePlan = { ...metadataPlan, selectedAssetIds: ["asset-1"], targetPageIds: ["page-1"], bindingIds: ["binding-1"] };
    const cadencePlan = {
      ...scopePlan,
      cron: { enabled: true, startTime: "08:15", timezone: "Asia/Ho_Chi_Minh" },
      platforms: { ...base.platforms, instagram: { enabled: true, postsPerDay: 2, imageCount: 1, videoCount: 1, publishTimes: ["09:00", "18:00"], runDays: [1, 3, 5] } },
      pagePlans: { "page-1": { ...base.platforms, facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["10:30"], runDays: [2, 4, 6] } } },
    };
    const first = updateAutomationPlannerModalDraft(scope, undefined, createPlan, { dirty: true });
    const second = updateAutomationPlannerModalDraft(scope, first.draft, metadataPlan, { dirty: true });
    const third = updateAutomationPlannerModalDraft(scope, second.draft, scopePlan, { dirty: true });
    const finalDraft = updateAutomationPlannerModalDraft(scope, third.draft, cadencePlan, { dirty: true });

    expect(finalDraft.draft.scope.planId).toBe(createPlan.id);
    expect(projectAutomationPlannerModal(finalDraft.draft.plan)).toMatchObject({
      planId: createPlan.id,
      metadata: expect.objectContaining({ name: "September launch", objectiveMode: "Reach", contentPillar: "Product", angle: "Proof" }),
      scope: { selectedAssetIds: ["asset-1"], targetPageIds: ["page-1"], bindingIds: ["binding-1"] },
    });
    expect(finalDraft.draft.plan.platforms.instagram).toMatchObject({ postsPerDay: 2, imageCount: 1, videoCount: 1, publishTimes: ["09:00", "18:00"], runDays: [1, 3, 5] });
    expect(finalDraft.draft.plan.pagePlans?.["page-1"]?.facebook).toMatchObject({ postsPerDay: 1, publishTimes: ["10:30"], runDays: [2, 4, 6] });

    const editPlan = { ...finalDraft.draft.plan, id: "persisted-edit-1" };
    const editDraft = updateAutomationPlannerModalDraft(scope, undefined, editPlan, { dirty: true });
    const save = vi.fn<(plan: AutomationPlan, token: AutomationPlannerSaveToken) => Promise<AutomationPlannerSaveResult>>().mockResolvedValue({ plan: editPlan, currentScope: true });
    for (const mode of ["create", "edit"] as const) {
      const plan = mode === "create" ? finalDraft.draft.plan : editDraft.draft.plan;
      const token: AutomationPlannerSaveToken = { draftKey: `${mode}-draft`, scopeGeneration: 9, requestId: mode === "create" ? 1 : 2, editRevision: mode === "create" ? finalDraft.draft.editRevision : editDraft.draft.editRevision };
      const pending = transitionAutomationPlannerModalSave({ phase: "idle", canClose: true }, { type: "begin", plan, token, notice: "Saving" });
      expect(pending.payload).toEqual({ plan, token });
      await save(pending.payload!.plan, pending.payload!.token);
      expect(save).toHaveBeenLastCalledWith(plan, token);
    }
  });

  it("blocks close while save is deferred and keeps the draft/notice on failure", async () => {
    const plan = createAutomationPlan("client-a", "brand-a", "Asia/Ho_Chi_Minh", new Date("2026-09-13T00:00:00.000Z"));
    const token: AutomationPlannerSaveToken = { draftKey: "edit-draft", scopeGeneration: 4, requestId: 1, editRevision: 3 };
    const pendingOutcome = deferred<AutomationPlannerSaveResult>();
    const save = vi.fn<(payload: AutomationPlan, capturedToken: AutomationPlannerSaveToken) => Promise<AutomationPlannerSaveResult>>().mockReturnValue(pendingOutcome.promise);
    const pending = transitionAutomationPlannerModalSave({ phase: "idle", canClose: true }, { type: "begin", plan, token, notice: "Saving plan" });
    const request = pending.payload!;
    const saveCall = save(request.plan, request.token);

    expect(pending.phase).toBe("pending");
    expect(canCloseAutomationPlannerModal(pending.phase)).toBe(false);
    expect(save).toHaveBeenCalledWith(plan, token);

    pendingOutcome.resolve({ currentScope: true, error: "Control Plane unavailable" });
    await expect(saveCall).resolves.toMatchObject({ currentScope: true, error: "Control Plane unavailable" });
    const failure = transitionAutomationPlannerModalSave(pending, { type: "failure", notice: "Plan was not saved. Control Plane unavailable" });
    expect(failure).toMatchObject({ phase: "failure", canClose: true, notice: "Plan was not saved. Control Plane unavailable", payload: request });
    expect(canCloseAutomationPlannerModal(failure.phase)).toBe(true);

    const success = transitionAutomationPlannerModalSave(pending, { type: "success", notice: "Automation plan saved as draft." });
    expect(success).toMatchObject({ phase: "success", canClose: true, notice: "Automation plan saved as draft.", payload: request });
  });

  it("keeps the complete editor on the shared draft/save path", () => {
    const source = readFileSync(new URL("./ExpandedViews.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/createAutomationPlannerModalState\(activeScope, "create"/);
    expect(source).toMatch(/createAutomationPlannerModalState\(activeScope, "edit"/);
    expect(source).toMatch(/updateAutomationPlannerModalDraft\(activeScope, current, nextPlan, patch\)/);
    expect(source).toMatch(/transitionAutomationPlannerModalSave/);
    expect(source).toMatch(/Target bindings/);
    expect(source).toMatch(/FACEBOOK PAGE RHYTHM/);
    expect(source).toMatch(/savePlanFromModal\("draft"\)/);
    expect(source).not.toMatch(/Brand and assets sẽ được cấu hình ngay sau khi tạo bản nháp/);
  });
});

describe("A09.6 planner popup strategy panel", () => {
  const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));
  const template = { id: "schedule-brand-a", campaignId: "campaign-a", brandId: "brand-a", timezone: "UTC", timesByWeekday: { 1: ["09:00"] }, version: 1, source: "brand_default" as const };
  const plan: AutomationPlan = {
    ...createAutomationPlan("client-a", "brand-a", "UTC", new Date("2026-09-15T00:00:00.000Z")),
    id: "plan-a096-ui",
    campaignId: "campaign-a",
    dateRange: { startDate: "2026-09-14", endDate: "2026-09-14" },
    scheduleTemplate: template,
    targetChannels: ["facebook"],
    strategySelection: { objective: "reach", pillar: "practical-education", angle: "practical-education-step-by-step-guide" },
    platforms: { ...createAutomationPlan("client-a", "brand-a", "UTC").platforms, facebook: { enabled: true, postsPerDay: 1, imageCount: 1, videoCount: 0, publishTimes: ["09:00"], formatMode: "image" } },
  };

  it("renders the real content strategy popup section with canonical labels, IDs and resolved rows", () => {
    const preview = buildAutomationPlannerPreview({ plan, catalog, scheduleTemplate: template });
    const markup = renderToStaticMarkup(createElement(PlannerStrategySection, {
      activeBrandName: "Brand A",
      catalog,
      catalogRevision: 7,
      selection: plan.strategySelection!,
      choices: plannerStrategyChoices(catalog, ["facebook"], plan.strategySelection!),
      preview,
      onChange: vi.fn(),
      stale: false,
    }));

    expect(markup).toContain("CONTENT STRATEGY");
    expect(markup).toContain("Use Brand catalog");
    expect(markup).toContain("v1");
    expect(markup).toContain("practical-education");
    expect(markup).toContain("Step-by-step guide");
    expect(markup).toContain("Resolved content catalog");
    expect(markup).toContain("facebook");
    expect(markup).toContain("fingerprint");
  });

  it("renders stale and invalid states without partial resolved rows", () => {
    const invalid: AutomationPlannerPreviewResult = { ok: false, errors: ["STRATEGY_CATALOG_UPDATED: review the plan", "second error"], firstError: "STRATEGY_CATALOG_UPDATED: review the plan", remainingErrors: 1 };
    const markup = renderToStaticMarkup(createElement(PlannerStrategySection, {
      activeBrandName: "Brand A",
      catalog,
      catalogRevision: 8,
      selection: plan.strategySelection!,
      choices: plannerStrategyChoices(catalog, ["facebook"], plan.strategySelection!),
      preview: invalid,
      onChange: vi.fn(),
      stale: true,
    }));

    expect(markup).toContain("Matrix updated — review plan");
    expect(markup).toMatch(/First error/i);
    expect(markup).toContain("1 remaining error");
    expect(markup).not.toContain("Resolved content catalog row");
  });
});

describe("E08 Content Intelligence handoff", () => {
  it("summarizes only eligible selections from the active Client and Brand", () => {
    const summary = summarizeContentIntelligenceSelection({
      clientId: "client-a",
      brandId: "brand-a",
      knowledgeItems: [
        { id: "knowledge-a", clientId: "client-a", brandId: "brand-a", kind: "brand_fact", title: "Approved facts", contentHash: "a".repeat(64), provenance: "owner document", text: "Approved fact text", sourceUpdatedAt: "2026-09-13T00:00:00Z", rightsState: "licensed", reviewState: "approved", archiveState: "active" },
        { id: "knowledge-b", clientId: "client-b", brandId: "brand-a", kind: "brand_fact", title: "Other client", contentHash: "b".repeat(64), provenance: "owner document", text: "Other client text", sourceUpdatedAt: "2026-09-13T00:00:00Z", rightsState: "licensed", reviewState: "approved", archiveState: "active" },
        { id: "knowledge-pending", clientId: "client-a", brandId: "brand-a", kind: "brand_fact", title: "Pending facts", contentHash: "c".repeat(64), provenance: "owner document", text: "Pending fact text", sourceUpdatedAt: "2026-09-13T00:00:00Z", rightsState: "licensed", reviewState: "pending", archiveState: "active" },
        { id: "knowledge-malformed", clientId: "client-a", brandId: "brand-a", kind: undefined as unknown as string, title: "Malformed approved facts", contentHash: "not-a-sha", provenance: "", text: null as unknown as string, sourceUpdatedAt: undefined as unknown as string, rightsState: "licensed", reviewState: "approved", archiveState: "active" },
      ],
      researchEvidence: [
        { id: "evidence-a", clientId: "client-a", brandId: "brand-a", sourceUrl: "https://example.test/research", sourceTitle: "Approved research", retrievedAt: "2026-09-13T00:00:00Z", summary: "Approved summary", rightsState: "user_owned", reviewState: "approved" },
        { id: "evidence-pending", clientId: "client-a", brandId: "brand-a", sourceUrl: "https://example.test/pending", sourceTitle: "Pending research", retrievedAt: "2026-09-13T00:00:00Z", summary: "Pending summary", rightsState: "licensed", reviewState: "pending" },
        { id: "evidence-malformed", clientId: "client-a", brandId: "brand-a", sourceUrl: undefined as unknown as string, sourceTitle: "", retrievedAt: "", summary: null as unknown as string, rightsState: "licensed", reviewState: "approved" },
      ],
      promptBlueprints: [
        { id: "blueprint-a", brandId: "brand-a", kind: "caption", version: 2, status: "active" },
        { id: "blueprint-draft", brandId: "brand-a", kind: "caption", version: 3, status: "draft" },
      ],
      contentRecipes: [
        { id: "recipe-a", brandId: "brand-a", name: "Education flow", status: "active" },
        { id: "recipe-old", brandId: "brand-a", name: "Archived flow", status: "archived" },
      ],
      selectedKnowledgeItemIds: ["knowledge-a", "knowledge-b", "knowledge-pending", "knowledge-malformed"],
      selectedResearchEvidenceIds: ["evidence-a", "evidence-pending", "evidence-malformed"],
      selectedPromptBlueprintId: "blueprint-a",
      selectedRecipeId: "recipe-a",
      transformMode: "repurpose",
    });

    expect(summary).toMatchObject({
      knowledgeItems: [{ id: "knowledge-a", title: "Approved facts" }],
      researchEvidence: [{ id: "evidence-a", title: "Approved research" }],
      promptBlueprint: { id: "blueprint-a", label: "blueprint-a · caption v2" },
      contentRecipe: { id: "recipe-a", name: "Education flow" },
      transformMode: "repurpose",
    });
    expect(summary.issues.map((issue) => `${issue.id}:${issue.code}`)).toEqual(expect.arrayContaining([
      "knowledge-b:KNOWLEDGE_SCOPE_MISMATCH",
      "knowledge-pending:RIGHTS_OR_REVIEW_BLOCKED",
      "knowledge-malformed:KNOWLEDGE_TEXT_MISSING",
      "evidence-pending:RESEARCH_REVIEW_PENDING",
      "evidence-malformed:RESEARCH_REQUIRED_FIELD_MISSING",
    ]));
  });

  it("keeps one active panel and wires the modal to the same selection state", () => {
    const expandedSource = readFileSync(new URL("./ExpandedViews.tsx", import.meta.url), "utf8");
    const revoSource = readFileSync(new URL("./RevoContentStudio.tsx", import.meta.url), "utf8");
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect((expandedSource.match(/<ContentIntelligencePanel\b/g) ?? []).length).toBe(1);
    expect(expandedSource).not.toMatch(/export function StudioView/);
    expect(expandedSource).toMatch(/<ContentIntelligenceForWorkspace props=\{props\} \/>/);
    expect(revoSource).toMatch(/summarizeContentIntelligenceSelection/);
    expect(revoSource).toMatch(/Content Intelligence will be included in this new Content Run/);
    expect(revoSource.match(/onClick=\{(?:\(\) => onOpenComposer\(\)|onOpenComposer)\}/g)).toEqual([
      "onClick={() => onOpenComposer()}",
      "onClick={() => onOpenComposer()}",
    ]);
    expect(revoSource).not.toMatch(/onGenerateInline/);
    expect(revoSource).toMatch(/Client: \{clientName\}/);
    expect(appSource).toMatch(/<RevoNewContentModal[\s\S]*selectedKnowledgeItemIds=\{selectedKnowledgeItemIds\}/);
    expect(appSource).toMatch(/<RevoNewContentModal[\s\S]*selectedResearchEvidenceIds=\{selectedResearchEvidenceIds\}/);
    expect(appSource).toMatch(/<RevoNewContentModal[\s\S]*selectedPromptBlueprintId=\{selectedPromptBlueprintId\}/);
    expect(appSource).toMatch(/<RevoNewContentModal[\s\S]*selectedRecipeId=\{selectedRecipeId\}/);
    expect(appSource).toMatch(/<RevoNewContentModal[\s\S]*transformMode=\{transformMode\}/);
    expect(appSource).toMatch(/<RevoNewContentModal[\s\S]*clientName=\{activeWorkspaceRecord\.name\}/);
    expect(appSource).not.toMatch(/onClick=\{generateInlineContent\}/);
    expect(appSource).not.toMatch(/onGenerateInlineContent=/);
    expect(appSource).toMatch(/onClick=\{\(event\) => \{ event\.preventDefault\(\); openComposer\(event\.currentTarget\); \}\} disabled=\{composerBusy\}>Tạo nội dung/);
  });
});

describe("A09.5 brand strategy panel", () => {
  const brand = { id: "brand-a", clientId: "client-a", workspaceId: "client-a", name: "Brand A", systemId: "brand-a", status: "active" as const };
  const recipes = [{ id: "recipe-text", brandId: "brand-a", name: "Text recipe", platforms: ["facebook" as const], contentKinds: ["text" as const], hookGuidance: "Open with one proof.", structureGuidance: "Context then action.", ctaGuidance: "Invite a reply.", qualityChecklist: ["Check facts"], status: "active" as const }];

  it("keeps the shipped panel on the same controller seam used by interaction regressions", () => {
    const source = readFileSync(new URL("./ExpandedViews.tsx", import.meta.url), "utf8");
    const panelSource = source.slice(source.indexOf("export function BrandStrategyPanel"), source.indexOf("export type BrandViewV2Props"));
    expect(panelSource).toContain("createBrandStrategyPanelController");
    expect(panelSource).toContain("panelController.edit(change)");
    expect(panelSource).toContain("panelController.save()");
    expect(panelSource).toContain("panelController.reload()");
    expect(panelSource).toContain("canReloadStrategyCatalogPanel");
  });

  it("renders five objectives, nested pillars and angles, controls, scope metadata and effective override preview", () => {
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));
    catalog.channelOverrides.facebook = { disabledObjectiveKeys: ["reach"], guidanceByAngleId: { "audience-insight-audience-question": "Use a brighter close crop." } };
    const markup = renderToStaticMarkup(createElement(BrandStrategyPanel, {
      activeBrand: brand,
      activeClientId: "client-a",
      activeClientName: "Client A",
      catalog,
      catalogRevision: 4,
      recipes,
      canManage: true,
      scopeKey: "[\"client-a\",\"brand-a\"]",
      onChange: vi.fn(),
      onSave: vi.fn().mockResolvedValue({ currentScope: true, acknowledged: true, catalog: { ...catalog, version: 2 } }),
      onReload: vi.fn(),
    }));

    expect((markup.match(/strategy-objective-card/g) ?? []).length).toBe(5);
    expect((markup.match(/strategy-pillar-card/g) ?? []).length).toBe(5);
    expect((markup.match(/strategy-angle-card/g) ?? []).length).toBe(15);
    expect(markup).toContain("Objectives, pillars &amp; angles");
    expect(markup).toContain("Client A");
    expect(markup).toContain("Brand A");
    expect(markup).toContain("Reload saved catalog");
    expect(markup).toContain("Add base pillar");
    expect(markup).toContain("Add base angle");
    expect(markup).toContain("Delete pillar");
    expect(markup).toContain("Delete angle");
    expect(markup).toContain("Facebook");
    expect(markup).toContain("Text recipe");
    expect(markup).toContain("Base items disabled");
    expect(markup).toContain("Overrides in effect");
    expect(markup).not.toContain("CONTENT STRATEGY MATRIX");
  });

  it("keeps draft edits through pending, stale and rejected callbacks and only settles on a durable ACK", () => {
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));
    const edited = applyStrategyCatalogEdit(catalog, { type: "set-objective", key: "reach", patch: { label: "Discover families" } });
    const pending = beginStrategyCatalogPanelSave(edited, "scope-a", 7);
    expect(pending).toMatchObject({ phase: "pending", scopeKey: "scope-a", revision: 7, draft: edited });
    expect(pending).toMatchObject({ capturedFingerprint: strategyCatalogFingerprint(edited) });
    const stale = settleStrategyCatalogPanelSave(pending, { currentScope: false, error: "older scope" }, "scope-b", 8);
    expect(stale).toEqual(pending);
    const acknowledgedCatalog = { ...structuredClone(edited), version: edited.version + 1 };
    const acknowledgedFingerprint = strategyCatalogFingerprint(acknowledgedCatalog);
    const staleRevision = settleStrategyCatalogPanelSave(pending, { currentScope: true, acknowledged: true, catalog: acknowledgedCatalog, revision: 6 }, "scope-a", 7);
    expect(staleRevision).toEqual(pending);
    const missingRevision = settleStrategyCatalogPanelSave(pending, { currentScope: true, acknowledged: true, catalog: acknowledgedCatalog, fingerprint: acknowledgedFingerprint }, "scope-a", 7);
    expect(missingRevision).toMatchObject({ phase: "rejected", draft: edited, error: "STRATEGY_CATALOG_ACK_REVISION_MISSING" });
    const wrongTypedRevision = settleStrategyCatalogPanelSave(pending, { currentScope: true, acknowledged: true, catalog: acknowledgedCatalog, revision: "8" as never, fingerprint: acknowledgedFingerprint }, "scope-a", 7);
    expect(wrongTypedRevision).toMatchObject({ phase: "rejected", draft: edited, error: "STRATEGY_CATALOG_ACK_REVISION_INVALID" });
    const futureRevision = settleStrategyCatalogPanelSave(pending, { currentScope: true, acknowledged: true, catalog: acknowledgedCatalog, revision: 9, fingerprint: acknowledgedFingerprint }, "scope-a", 7);
    expect(futureRevision).toEqual(pending);
    const foreignScope = settleStrategyCatalogPanelSave(pending, { currentScope: true, acknowledged: true, catalog: acknowledgedCatalog, revision: 8, fingerprint: acknowledgedFingerprint }, "scope-b", 7);
    expect(foreignScope).toEqual(pending);
    const wrongVersionCatalog = { ...structuredClone(edited), version: edited.version + 2 };
    expect(settleStrategyCatalogPanelSave(pending, { currentScope: true, acknowledged: true, catalog: wrongVersionCatalog, revision: 8, fingerprint: strategyCatalogFingerprint(wrongVersionCatalog) }, "scope-a", 7)).toMatchObject({ phase: "rejected", draft: edited });
    expect(settleStrategyCatalogPanelSave(pending, { currentScope: true, acknowledged: true, catalog: acknowledgedCatalog, revision: 8, fingerprint: "wrong-fingerprint" }, "scope-a", 7)).toMatchObject({ phase: "rejected", draft: edited });
    const rejected = settleStrategyCatalogPanelSave(pending, { currentScope: true, error: "Control Plane rejected" }, "scope-a", 7);
    expect(rejected).toMatchObject({ phase: "rejected", draft: edited, error: "Control Plane rejected" });
    expect(rejected.draft.objectives.find((item) => item.key === "reach")?.label).toBe("Discover families");

    const success = settleStrategyCatalogPanelSave(pending, { currentScope: true, acknowledged: true, catalog: acknowledgedCatalog, revision: 8, fingerprint: acknowledgedFingerprint }, "scope-a", 7);
    expect(success).toMatchObject({ phase: "success", draft: acknowledgedCatalog, revision: 8 });
  });

  it("returns focus through the production Escape handler and ignores disconnected targets", async () => {
    const module = await import("./ExpandedViews") as typeof import("./ExpandedViews") & {
      handleStrategyCatalogEscape?: (event: { key: string; preventDefault: () => void }, heading: { isConnected: boolean; focus: () => void } | null, panel: { isConnected: boolean; focus: () => void } | null) => boolean;
    };
    expect(typeof module.handleStrategyCatalogEscape).toBe("function");
    const heading = { isConnected: true, focus: vi.fn() };
    const panel = { isConnected: true, focus: vi.fn() };
    const event = { key: "Escape", preventDefault: vi.fn() };
    expect(module.handleStrategyCatalogEscape?.(event, heading, panel)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(heading.focus).toHaveBeenCalledOnce();
    expect(panel.focus).not.toHaveBeenCalled();

    const disconnectedHeading = { isConnected: false, focus: vi.fn() };
    expect(module.handleStrategyCatalogEscape?.({ key: "Escape", preventDefault: vi.fn() }, disconnectedHeading, panel)).toBe(true);
    expect(disconnectedHeading.focus).not.toHaveBeenCalled();
    expect(panel.focus).toHaveBeenCalledOnce();
  });

  it("drives the production strategy panel controller through focus, loading, malformed, retry, and stale operation paths", async () => {
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));
    const scopeA = "scope-a";
    const scopeB = "scope-b";
    const stateRef = { current: { scopeKey: scopeA, revision: 7, draft: structuredClone(catalog), catalogLoading: false, externalPending: false, dirty: false, localPending: false, error: "", notice: "" } as BrandStrategyPanelControllerState };
    const stateChanges: BrandStrategyPanelControllerState[] = [];
    const saveResponses: Array<ReturnType<typeof deferred<StrategyCatalogSaveResult>>> = [];
    const onSave = vi.fn(async (_catalog: BrandStrategyCatalog, _scopeKey: string, _capturedRevision: number): Promise<StrategyCatalogSaveResult> => {
      const next = saveResponses.shift();
      if (!next) throw new Error("missing deferred response");
      return await next.promise;
    });
    const controller = createBrandStrategyPanelController({
      getState: () => stateRef.current,
      setState: (next) => { stateRef.current = next; stateChanges.push(next); },
      canManage: () => true,
      onSave,
      onReload: vi.fn(),
    });

    const heading = { isConnected: true, focus: vi.fn() };
    const escape = { key: "Escape", preventDefault: vi.fn() };
    expect(controller.keyDown(escape, heading, null)).toBe(true);
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(heading.focus).toHaveBeenCalledOnce();

    stateRef.current = { ...stateRef.current, catalogLoading: true };
    expect(controller.edit({ type: "set-objective", key: "reach", patch: { label: "Blocked while loading" } })).toBe(false);
    await expect(controller.save()).resolves.toBeUndefined();
    await Promise.resolve();

    const malformed = { ...catalog, objectives: [null] } as unknown as BrandStrategyCatalog;
    stateRef.current = { ...stateRef.current, catalogLoading: false, draft: malformed, dirty: false };
    expect(controller.edit({ type: "set-objective", key: "reach", patch: { label: "Must fail closed" } })).toBe(false);
    expect(stateRef.current.draft).toBe(malformed);

    stateRef.current = { ...stateRef.current, draft: structuredClone(catalog), dirty: true, error: "", notice: "" };
    const rejected = deferred<Awaited<ReturnType<typeof onSave>>>();
    saveResponses.push(rejected as never);
    const firstSave = controller.save();
    await Promise.resolve();
    expect(stateRef.current.localPending).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
    const rejectedCatalog = { ...structuredClone(catalog), version: catalog.version + 1 };
    rejected.resolve({ currentScope: true, acknowledged: false, catalog: rejectedCatalog, revision: 8, fingerprint: strategyCatalogFingerprint(rejectedCatalog) });
    await firstSave;
    expect(stateRef.current).toMatchObject({ dirty: true, localPending: false });
    expect(stateRef.current.error).toContain("Control Plane chưa xác nhận catalog");

    const accepted = deferred<Awaited<ReturnType<typeof onSave>>>();
    saveResponses.push(accepted as never);
    const retry = controller.save();
    await Promise.resolve();
    const acceptedCatalog = { ...structuredClone(stateRef.current.draft!), version: stateRef.current.draft!.version + 1 };
    accepted.resolve({ currentScope: true, acknowledged: true, catalog: acceptedCatalog, revision: 8, fingerprint: strategyCatalogFingerprint(acceptedCatalog) });
    await retry;
    expect(stateRef.current).toMatchObject({ dirty: false, localPending: false, draft: acceptedCatalog });
    expect(onSave).toHaveBeenCalledTimes(2);

    const stale = deferred<Awaited<ReturnType<typeof onSave>>>();
    saveResponses.push(stale as never);
    stateRef.current = { ...stateRef.current, scopeKey: scopeA, revision: 8, dirty: true, localPending: false, notice: "newer draft" };
    const staleSave = controller.save();
    await Promise.resolve();
    controller.setScope(scopeB, 9);
    stateRef.current = { ...stateRef.current, scopeKey: scopeB, revision: 9, draft: structuredClone(catalog), dirty: false, localPending: false, notice: "B notice" };
    controller.setScope(scopeA, 10);
    stateRef.current = { ...stateRef.current, scopeKey: scopeA, revision: 10, draft: structuredClone(catalog), dirty: true, localPending: false, notice: "new A notice" };
    stale.resolve({ currentScope: true, acknowledged: true, catalog: { ...structuredClone(catalog), version: 2 }, revision: 9, fingerprint: strategyCatalogFingerprint({ ...catalog, version: 2 }) });
    await staleSave;
    expect(stateRef.current).toMatchObject({ scopeKey: scopeA, revision: 10, dirty: true, notice: "new A notice", localPending: false });
    expect(stateChanges.length).toBeGreaterThan(0);
  });

  it("keeps newer same-scope draft state when an older save settles", async () => {
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));
    const stateRef = { current: { scopeKey: "scope-a", revision: 7, draft: structuredClone(catalog), catalogLoading: false, externalPending: false, dirty: true, localPending: false, error: "", notice: "" } as BrandStrategyPanelControllerState };
    const pending = deferred<{ currentScope: true; acknowledged: true; catalog: BrandStrategyCatalog; revision: number; fingerprint: string }>();
    const controller = createBrandStrategyPanelController({
      getState: () => stateRef.current,
      setState: (next) => { stateRef.current = next; },
      canManage: () => true,
      onSave: async () => await pending.promise,
    });
    const save = controller.save();
    await Promise.resolve();
    const newerDraft = applyStrategyCatalogEdit(catalog, { type: "set-objective", key: "reach", patch: { label: "Newer draft" } });
    stateRef.current = { ...stateRef.current, draft: newerDraft, dirty: true, notice: "Newer draft is still being edited" };
    const acknowledged = { ...structuredClone(catalog), version: catalog.version + 1 };
    pending.resolve({ currentScope: true, acknowledged: true, catalog: acknowledged, revision: 8, fingerprint: strategyCatalogFingerprint(acknowledged) });
    await save;
    expect(stateRef.current.draft).toEqual(newerDraft);
    expect(stateRef.current).toMatchObject({ dirty: true, notice: "Newer draft is still being edited", localPending: true });
  });

  it.each([
    { label: "stale", revision: 6 },
    { label: "future", revision: 9 },
  ])("keeps localPending for a $label save ACK revision", async ({ revision }) => {
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));
    const pending = deferred<StrategyCatalogSaveResult>();
    const stateRef = { current: { scopeKey: "scope-a", revision: 7, draft: structuredClone(catalog), catalogLoading: false, externalPending: false, dirty: true, localPending: false, error: "", notice: "" } as BrandStrategyPanelControllerState };
    const controller = createBrandStrategyPanelController({
      getState: () => stateRef.current,
      setState: (next) => { stateRef.current = next; },
      canManage: () => true,
      onSave: async () => await pending.promise,
    });

    const save = controller.save();
    await Promise.resolve();
    expect(stateRef.current.localPending).toBe(true);
    stateRef.current = { ...stateRef.current, notice: "Newer state remains visible" };
    const acknowledged = { ...structuredClone(catalog), version: catalog.version + 1 };
    pending.resolve({ currentScope: true, acknowledged: true, catalog: acknowledged, revision, fingerprint: strategyCatalogFingerprint(acknowledged) });
    await save;

    expect(stateRef.current).toMatchObject({ draft: catalog, dirty: true, localPending: true, notice: "Newer state remains visible" });
  });

  it("accepts an exact ACK only from the operation matching an advanced same-scope revision", async () => {
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));
    const first = deferred<StrategyCatalogSaveResult>();
    const second = deferred<StrategyCatalogSaveResult>();
    const stateRef = { current: { scopeKey: "scope-a", revision: 7, draft: structuredClone(catalog), catalogLoading: false, externalPending: false, dirty: true, localPending: false, error: "", notice: "" } as BrandStrategyPanelControllerState };
    const onSave = vi.fn<(_catalog: BrandStrategyCatalog, _scopeKey: string, _revision: number) => Promise<StrategyCatalogSaveResult>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const controller = createBrandStrategyPanelController({ getState: () => stateRef.current, setState: (next) => { stateRef.current = next; }, canManage: () => true, onSave });

    const oldSave = controller.save();
    await Promise.resolve();
    const newerDraft = applyStrategyCatalogEdit(catalog, { type: "set-objective", key: "reach", patch: { label: "Newer revision" } });
    controller.setScope("scope-a", 8);
    stateRef.current = { ...stateRef.current, revision: 8, draft: newerDraft, dirty: true, localPending: false, notice: "Newer revision" };
    const newSave = controller.save();
    await Promise.resolve();
    stateRef.current = { ...stateRef.current, notice: "Newer revision" };

    const oldCatalog = { ...structuredClone(catalog), version: catalog.version + 1 };
    first.resolve({ currentScope: true, acknowledged: true, catalog: oldCatalog, revision: 8, fingerprint: strategyCatalogFingerprint(oldCatalog) });
    await oldSave;
    expect(stateRef.current).toMatchObject({ revision: 8, draft: newerDraft, dirty: true, localPending: true, notice: "Newer revision" });

    const newCatalog = { ...structuredClone(newerDraft), version: newerDraft.version + 1 };
    second.resolve({ currentScope: true, acknowledged: true, catalog: newCatalog, revision: 9, fingerprint: strategyCatalogFingerprint(newCatalog) });
    await newSave;
    expect(stateRef.current).toMatchObject({ revision: 9, draft: newCatalog, dirty: false, localPending: false });
  });

  it("lets the newest overlapping same-scope save own settlement state", async () => {
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));
    const first = deferred<StrategyCatalogSaveResult>();
    const second = deferred<StrategyCatalogSaveResult>();
    const stateRef = { current: { scopeKey: "scope-a", revision: 7, draft: structuredClone(catalog), catalogLoading: false, externalPending: false, dirty: true, localPending: false, error: "", notice: "" } as BrandStrategyPanelControllerState };
    const onSave = vi.fn<(_catalog: BrandStrategyCatalog, _scopeKey: string, _revision: number) => Promise<StrategyCatalogSaveResult>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const controller = createBrandStrategyPanelController({ getState: () => stateRef.current, setState: (next) => { stateRef.current = next; }, canManage: () => true, onSave });
    const oldSave = controller.save();
    await Promise.resolve();
    const newerDraft = applyStrategyCatalogEdit(catalog, { type: "set-objective", key: "reach", patch: { label: "Newest" } });
    stateRef.current = { ...stateRef.current, draft: newerDraft, dirty: true, localPending: false, notice: "Newest draft" };
    const newSave = controller.save();
    await Promise.resolve();
    stateRef.current = { ...stateRef.current, notice: "Newest operation" };
    const oldCatalog = { ...structuredClone(catalog), version: catalog.version + 1 };
    first.resolve({ currentScope: true, acknowledged: true, catalog: oldCatalog, revision: 8, fingerprint: strategyCatalogFingerprint(oldCatalog) });
    await oldSave;
    expect(stateRef.current).toMatchObject({ draft: newerDraft, dirty: true, notice: "Newest operation", localPending: true });
    const newCatalog = { ...structuredClone(newerDraft), version: newerDraft.version + 1 };
    second.resolve({ currentScope: true, acknowledged: true, catalog: newCatalog, revision: 8, fingerprint: strategyCatalogFingerprint(newCatalog) });
    await newSave;
    expect(stateRef.current).toMatchObject({ draft: newCatalog, dirty: false, localPending: false });
  });

  it("keeps newer dirty state when an older reload settles", async () => {
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));
    const pending = deferred<void>();
    const stateRef = { current: { scopeKey: "scope-a", revision: 7, draft: structuredClone(catalog), catalogLoading: false, externalPending: false, dirty: false, localPending: false, error: "", notice: "" } as BrandStrategyPanelControllerState };
    const controller = createBrandStrategyPanelController({
      getState: () => stateRef.current,
      setState: (next) => { stateRef.current = next; },
      onReload: async () => await pending.promise,
    });
    const reload = controller.reload();
    await Promise.resolve();
    stateRef.current = { ...stateRef.current, dirty: true, notice: "Newer draft is still being edited" };
    pending.resolve();
    await reload;
    expect(stateRef.current).toMatchObject({ dirty: true, notice: "Newer draft is still being edited", localPending: true });
  });

  it("blocks dirty reload in the controller and production availability predicate", async () => {
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));
    const onReload = vi.fn(async () => undefined);
    const stateRef = { current: { scopeKey: "scope-a", revision: 7, draft: structuredClone(catalog), catalogLoading: false, externalPending: false, dirty: true, localPending: false, error: "", notice: "" } as BrandStrategyPanelControllerState };
    const controller = createBrandStrategyPanelController({ getState: () => stateRef.current, setState: (next) => { stateRef.current = next; }, onReload });
    await controller.reload();
    expect(onReload).not.toHaveBeenCalled();
    expect(stateRef.current).toMatchObject({ dirty: true, localPending: false, error: "Còn bản nháp chưa lưu; hãy lưu hoặc bỏ bản nháp trước khi tải lại catalog." });
    expect(canReloadStrategyCatalogPanel(stateRef.current, true)).toBe(false);
    expect(canReloadStrategyCatalogPanel({ ...stateRef.current, dirty: false }, true)).toBe(true);
  });

  it("invalidates a pending save when the same Client/Brand revision advances", async () => {
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));
    const pending = deferred<{ currentScope: true; acknowledged: true; catalog: BrandStrategyCatalog; revision: number; fingerprint: string }>();
    const stateRef = { current: { scopeKey: "scope-a", revision: 7, draft: structuredClone(catalog), catalogLoading: false, externalPending: false, dirty: true, localPending: false, error: "", notice: "" } as BrandStrategyPanelControllerState };
    const controller = createBrandStrategyPanelController({ getState: () => stateRef.current, setState: (next) => { stateRef.current = next; }, canManage: () => true, onSave: async () => await pending.promise });
    const save = controller.save();
    await Promise.resolve();
    controller.setScope("scope-a", 8);
    stateRef.current = { ...stateRef.current, revision: 8, dirty: true, notice: "Newer revision" };
    const acknowledged = { ...structuredClone(catalog), version: catalog.version + 1 };
    pending.resolve({ currentScope: true, acknowledged: true, catalog: acknowledged, revision: 8, fingerprint: strategyCatalogFingerprint(acknowledged) });
    await save;
    expect(stateRef.current).toMatchObject({ revision: 8, dirty: true, notice: "Newer revision", localPending: true });
  });

  it("ignores a stale reload after the panel returns from A through B to A", async () => {
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z"));
    const pending = deferred<void>();
    const stateRef = { current: { scopeKey: "scope-a", revision: 7, draft: structuredClone(catalog), catalogLoading: false, externalPending: false, dirty: false, localPending: false, error: "", notice: "" } as BrandStrategyPanelControllerState };
    const controller = createBrandStrategyPanelController({ getState: () => stateRef.current, setState: (next) => { stateRef.current = next; }, onReload: async () => await pending.promise });
    const reload = controller.reload();
    await Promise.resolve();
    controller.setScope("scope-b", 8);
    controller.setScope("scope-a", 9);
    stateRef.current = { ...stateRef.current, revision: 9, dirty: true, localPending: true, notice: "New A draft" };
    pending.resolve();
    await reload;
    expect(stateRef.current).toMatchObject({ scopeKey: "scope-a", revision: 9, dirty: true, localPending: true, notice: "New A draft" });
  });

  it("uses the canonical Client membership when Brand and renderer workspace IDs differ", () => {
    const brand = { id: "brand-scoped", clientId: "client-canonical", workspaceId: "workspace-renderer" };
    const memberships = [
      { id: "membership-canonical", workspaceId: "client-canonical", userId: "user-a", role: "admin" as const, status: "active" as const, displayName: "User A", email: "a@example.test" },
      { id: "membership-foreign", workspaceId: "client-foreign", userId: "user-b", role: "owner" as const, status: "active" as const, displayName: "User B", email: "b@example.test" },
    ];
    expect(brandStrategyCanManage(brand, memberships, "user-a")).toBe(true);
    expect(brandStrategyCanManage({ ...brand, clientId: "client-foreign" }, memberships, "user-a")).toBe(false);
    expect(brandStrategyCanManage(brand, memberships, "user-b")).toBe(false);
  });

  it("renders BrandViewV2 as editable only for the canonical Client membership", () => {
    const scopedBrand = { id: "brand-scoped", clientId: "client-canonical", workspaceId: "workspace-renderer", name: "Scoped Brand", systemId: "brand-scoped", status: "active" as const };
    const canonicalMembership = { ...defaultWorkspaceState.memberships[0]!, id: "membership-canonical", workspaceId: "client-canonical", userId: "user-a", role: "admin" as const, status: "active" as const };
    const rendererMembership = { ...defaultWorkspaceState.memberships[0]!, id: "membership-renderer", workspaceId: "workspace-renderer", userId: "user-b", role: "owner" as const, status: "active" as const };
    const baseProps: BrandViewV2Props = { activeBrand: scopedBrand, activeUserId: "user-a", activeWorkspace: { ...defaultWorkspaceState.workspaces[0]!, id: "workspace-renderer", name: "Renderer workspace" }, brandVoice: "Voice", brandVisualTokens: { primary: "#000000", secondary: "#ffffff", typography: "system" }, savedNotice: "", workspaceState: { ...defaultWorkspaceState, memberships: [canonicalMembership] }, strategyCatalog: starterStrategyCatalog(scopedBrand.id), strategyCatalogRevision: 1, contentRecipes: [], currentMembership: rendererMembership, onBrandVoiceChange: vi.fn(), onBrandVisualTokensChange: vi.fn(), onSaveBrand: vi.fn(), onSaveStrategyCatalog: vi.fn().mockResolvedValue({ currentScope: true }), onReloadStrategyCatalog: vi.fn() };
    const editable = renderToStaticMarkup(createElement(BrandViewV2, baseProps));
    expect(editable).not.toContain("Role hiện tại chỉ được xem; chỉnh sửa catalog cần capability manage_brand.");
    const foreign = renderToStaticMarkup(createElement(BrandViewV2, { ...baseProps, activeUserId: "user-b", workspaceState: { ...baseProps.workspaceState, memberships: [rendererMembership] } }));
    expect(foreign).toContain("Role hiện tại chỉ được xem; chỉnh sửa catalog cần capability manage_brand.");
  });

  it("filters rendered recipe choices by Brand, lifecycle, channel, content kind, and strategy", () => {
    const target = { pillarId: "audience-insight", angleId: "audience-insight-audience-question" };
    const base = { platforms: ["facebook" as const], contentKinds: ["text" as const], hookGuidance: "Hook", structureGuidance: "Structure", ctaGuidance: "CTA", qualityChecklist: ["Check"] };
    const recipeList = [
      { ...base, id: "matching", brandId: "brand-a", name: "Matching", status: "active" as const, ...target },
      { ...base, id: "legacy", brandId: "brand-a", name: "Legacy", status: "active" as const },
      { ...base, id: "other-brand", brandId: "brand-b", name: "Other brand", status: "active" as const },
      { ...base, id: "inactive", brandId: "brand-a", name: "Inactive", status: "archived" as const },
      { ...base, id: "wrong-platform", brandId: "brand-a", name: "Wrong platform", platforms: ["instagram" as const], status: "active" as const },
      { ...base, id: "wrong-kind", brandId: "brand-a", name: "Wrong kind", contentKinds: ["image" as const], status: "active" as const },
      { ...base, id: "strategy-mismatch", brandId: "brand-a", name: "Strategy mismatch", status: "active" as const, pillarId: "proof-and-process", angleId: "proof-and-process-proof-point" },
    ];

    expect(strategyRecipeOptions(recipeList, "brand-a", "facebook", "text", target).map((recipe) => recipe.id)).toEqual(["matching", "legacy"]);
    const markup = renderToStaticMarkup(createElement(BrandStrategyPanel, { activeBrand: brand, activeClientId: "client-a", activeClientName: "Client A", catalog: starterStrategyCatalog("brand-a", new Date("2026-09-15T00:00:00.000Z")), catalogRevision: 4, recipes: recipeList, canManage: true, scopeKey: '["client-a","brand-a"]', onSave: vi.fn(), onReload: vi.fn() }));
    const targetAngleStart = markup.indexOf('<article class="strategy-angle-card"');
    const targetAngleMarkup = markup.slice(targetAngleStart, markup.indexOf('</article>', targetAngleStart));
    expect(targetAngleMarkup).toContain(">Matching</option>");
    expect(targetAngleMarkup).toContain(">Legacy</option>");
    for (const label of ["Other brand", "Inactive", "Wrong platform", "Wrong kind", "Strategy mismatch"]) expect(targetAngleMarkup).not.toContain(`>${label}</option>`);
  });

  it("blocks invalid catalog saves before the durable callback", () => {
    const invalid = starterStrategyCatalog("brand-a");
    invalid.objectives = [];
    const state = beginStrategyCatalogPanelSave(invalid, "scope-a", 7);
    expect(state).toMatchObject({ phase: "rejected", scopeKey: "scope-a", revision: 7 });
    expect(state.error).toContain("OBJECTIVES_REQUIRED");
  });

  it("blocks catalog editing during hydration without discarding an existing dirty draft", () => {
    expect(resolveStrategyCatalogHydrationAction({ scopeChanged: false, catalogLoading: true, dirty: false, hasDraft: true, hasCanonicalCatalog: false })).toBe("wait");
    expect(resolveStrategyCatalogHydrationAction({ scopeChanged: false, catalogLoading: true, dirty: true, hasDraft: true, hasCanonicalCatalog: false })).toBe("preserve");
    expect(resolveStrategyCatalogHydrationAction({ scopeChanged: true, catalogLoading: true, dirty: true, hasDraft: true, hasCanonicalCatalog: true })).toBe("hydrate");
    expect(resolveStrategyCatalogHydrationAction({ scopeChanged: false, catalogLoading: false, dirty: true, hasDraft: true, hasCanonicalCatalog: true })).toBe("preserve");
  });

  it("renders a stable focus heading for Escape return and disables malformed catalogs", () => {
    const malformed = { ...starterStrategyCatalog("brand-a"), objectives: [null], pillars: [{ ...starterStrategyCatalog("brand-a").pillars[0], angles: [null] }], channelOverrides: null } as never;
    const markup = renderToStaticMarkup(createElement(BrandStrategyPanel, {
      activeBrand: brand,
      activeClientId: "client-a",
      activeClientName: "Client A",
      catalog: malformed,
      catalogRevision: 4,
      recipes,
      canManage: true,
      scopeKey: "[\"client-a\",\"brand-a\"]",
      onSave: vi.fn(),
      onReload: vi.fn(),
    }));

    expect(markup).toMatch(/<h2[^>]*tabindex="-1"[^>]*>Objectives, pillars &amp; angles/);
    expect(markup).toContain("Catalog validation:");
    expect(markup).toContain("OBJECTIVE_INVALID");
    expect(markup).toContain('button type="button" class="primary-button" disabled');
  });

  it("fails closed for malformed nested fields during render and edit interaction", () => {
    const malformed = {
      ...starterStrategyCatalog("brand-a"),
      objectives: [null],
      pillars: [{
        ...starterStrategyCatalog("brand-a").pillars[0],
        id: { invalid: true },
        label: { invalid: true },
        channels: null,
        angles: [{ id: { invalid: true }, label: { invalid: true }, guidance: null, enabled: true, order: 1, channels: null }],
      }],
      channelOverrides: { facebook: { addedAnglesByPillarId: { "audience-insight": null } } },
    } as unknown as BrandStrategyCatalog;
    expect(() => renderToStaticMarkup(createElement(BrandStrategyPanel, {
      activeBrand: brand,
      activeClientId: "client-a",
      activeClientName: "Client A",
      catalog: malformed,
      catalogRevision: 4,
      recipes,
      canManage: true,
      scopeKey: "[\"client-a\",\"brand-a\"]",
      onSave: vi.fn(),
      onReload: vi.fn(),
    }))).not.toThrow();
    expect(() => applyStrategyCatalogEdit(malformed, { type: "remove-objective", key: "reach" })).not.toThrow();

    const empty = { ...malformed, objectives: null, pillars: null, channelOverrides: null } as never;
    const emptyMarkup = renderToStaticMarkup(createElement(BrandStrategyPanel, {
      activeBrand: brand,
      activeClientId: "client-a",
      activeClientName: "Client A",
      catalog: empty,
      catalogRevision: 4,
      recipes,
      canManage: true,
      scopeKey: "[\"client-a\",\"brand-a\"]",
      onSave: vi.fn(),
      onReload: vi.fn(),
    }));
    expect(emptyMarkup).toContain("Catalog validation:");
    expect(emptyMarkup).toContain("OBJECTIVES_REQUIRED");
    expect(emptyMarkup).toContain('button type="button" class="primary-button" disabled');
  });
});
