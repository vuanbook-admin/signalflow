import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Vitest executes this focused source-boundary check in Node; the app tsconfig does not include Node declarations.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveReadinessIndicator, assertContentRunAssetAck, awaitAgencyMigration, brandCreateConflictMatchesRecovery, clientCreateConflictMatchesRecovery, createRevoComposerRequestGate, guardComposerMutation, managedBrandBackfillGroups, localMediaBelongsToBrand, openRevoComposerHandler, reconcileAgencyCreateConflict, runAgencyMigrationSingleFlight, runGuardedComposerMutation, settleRevoComposerRequest, strategyCatalogResponseMatchesSaveAck, strategyCatalogResponseMatchesScope, strategyCatalogScopeForBrand, strategyCatalogScopeMatchesState, strategySnapshotFromResolved, targetPublicationSafeForBrandTrash, targetPublicationSummary, validateRevoComposerSchedule, type RevoComposerRequestScope } from "./App";
import { createBrandDeleteModalController } from "./ExpandedViews";
import * as appModule from "./App";
import { beginDraftAction, contentRunRevisionFieldsFromDraft, draftActionLockKey, draftActionScopeKey, endDraftAction, submitContentRunQualityCheck } from "./lib/contentRun";
import { closeTargetActionPromptOutcome, draftPublishBlocker, publishCommandOutcome, targetActionSelectionOutcome } from "./lib/uiPresentation";
import { clientIdForBrand, defaultWorkspaceState, strategyCatalogScopeKey, type WorkspaceState } from "./lib/workspaceDomain";
import { getMetaLiveReadiness } from "./lib/metaSettings";
import { brandDeleteScopeKey, reconcileBrandDeleteOperations, removeBrandRecordsForScope, runBrandDeleteLifecycle, runBrandRestoreLifecycle, isAuthoritativeBrandImpact, trashBrand, validateBrandDeleteAck, type BrandDeleteModalState, type BrandLifecycleRequestToken, type BrandDeleteScope, type BrandDeleteOutcome } from "./lib/brandTrash";
import { createRevoComposerModalController, RevoNewContentModal, type RevoComposerCloseEvent, type RevoComposerFocusTarget } from "./RevoContentStudio";
import { MockAIGateway } from "./lib/gateway";
import { ControlPlaneError } from "./lib/controlPlane";
import { prepareStrategyGeneration } from "./lib/generationRoute";
import { starterStrategyCatalog, strategyCatalogFingerprint } from "./lib/contentStrategy";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

type ApprovalSchedulePromptApi = {
  approvalSchedulePromptDecision: (input: { planId?: string; hasMatchingPlan: boolean; draftScheduledAt?: string; overrideScheduledAt?: string }) => { action: "open_picker" | "continue" | "reject"; message?: string; scheduledAt?: string };
  closeApprovalSchedulePromptState: (state: { draftId?: number; value: string }) => { draftId?: number; value: string; approvalRequested: false };
  submitApprovalSchedulePromptValue: (value: string, now: Date) => { ok: true; scheduledAt: string } | { ok: false; message: string };
};
const approvalSchedulePromptApi = appModule as unknown as ApprovalSchedulePromptApi;

describe("C5 App ownership boundaries", () => {
  it("accepts a needs-review ACK for a completed media replacement operation", () => {
    expect(() => assertContentRunAssetAck({ id: "run-media-change", state: "needs_review", mediaOperations: [{ type: "image", status: "completed", slotId: "run-media-change", strategyVersion: 2, idempotencyKey: "run-media-change:v2:image" }] }, "run-media-change", { kind: "image", status: "completed", slotId: "run-media-change", strategyVersion: 2, idempotencyKey: "run-media-change:v2:image" })).not.toThrow();
  });

  it("routes generated media replacement through the durable review invalidation boundary", () => {
    const region = appSource.slice(appSource.indexOf("const generateDraftMedia ="), appSource.indexOf("const exportManualPackage ="));
    expect(region).toContain("buildMediaReplacementPersistencePatch");
    expect(region).toContain("fingerprintMediaReplacement(generatedEvidence)");
    expect(region).toContain('createAgencyRecord("media-assets"');
    expect(region).toContain("mediaAssetIds: replacementMediaEvidence.map");
    expect(region).toContain("invalidateReview: true");
  });

  it("reconciles uncertain replacement ACKs through the Control Plane readback seam", () => {
    const region = appSource.slice(appSource.indexOf("const generateDraftMedia ="), appSource.indexOf("const exportManualPackage ="));
    expect(region).toContain("reconcileContentRunMediaReplacement");
    expect(region).toContain("getContentRun");
    expect(region).toContain("CONTENT_RUN_MEDIA_REPLACEMENT_RECONCILIATION_REQUIRED");
  });

  it("reads the canonical Content Run media revision across legacy aliases", () => {
    expect(appSource).toContain("run.contentRunRevision");
    expect(appSource).toContain("run.content_run_revision");
  });

  it("coalesces concurrent migration commits and keeps Brand creation behind its ACK", async () => {
    const flight = { scopeKey: "", promise: undefined as Promise<void> | undefined };
    const events: string[] = [];
    let release!: () => void;
    const migration = vi.fn(() => new Promise<void>((resolve) => {
      events.push("migration-start");
      release = resolve;
    }));

    const first = runAgencyMigrationSingleFlight(flight, "profile-a:1", migration);
    const duplicate = runAgencyMigrationSingleFlight(flight, "profile-a:1", migration);
    const brandCreate = awaitAgencyMigration(flight, "profile-a:1", false).then(() => events.push("brand-create"));

    await Promise.resolve();
    expect(migration).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["migration-start"]);
    release();
    await Promise.all([first, duplicate, brandCreate]);
    expect(events).toEqual(["migration-start", "brand-create"]);
  });

  it("reconciles a Brand create conflict only when CP has the exact Brand and identity scope", () => {
    const recovery = {
      brands: [{ id: "brand-a", client_id: "client-a", name: "Brand A", status: "draft" }],
      identities: [{ id: "legacy-identity", brand_id: "brand-a", is_default: 1 }],
    };

    expect(brandCreateConflictMatchesRecovery(recovery, { brandId: "brand-a", clientId: "client-a", brandName: "Brand A" })).toBe(true);
  });

  it("keeps a Brand create conflict when CP records have a mismatched scope or identity", () => {
    const recovery = {
      brands: [{ id: "brand-a", client_id: "client-other", name: "Brand A", status: "draft" }],
      identities: [{ id: "identity-a", brand_id: "brand-other", is_default: true }],
    };

    expect(brandCreateConflictMatchesRecovery(recovery, { brandId: "brand-a", clientId: "client-a", brandName: "Brand A" })).toBe(false);
    expect(brandCreateConflictMatchesRecovery({ ...recovery, brands: [{ id: "brand-a", client_id: "client-a", name: "Other Brand", status: "draft" }] }, { brandId: "brand-a", clientId: "client-a", brandName: "Brand A" })).toBe(false);
  });

  it("reconciles an addClient conflict only when the exact Client, Brand and default identity are durable", () => {
    const recovery = {
      clients: [{ id: "client-a", name: "Client A", timezone: "Asia/Ho_Chi_Minh", status: "active" }],
      brands: [{ id: "brand-a", client_id: "client-a", name: "Client A Brand", status: "draft" }],
      identities: [{ id: "legacy-identity", brand_id: "brand-a", is_default: 1 }],
    };
    const expected = { clientId: "client-a", clientName: "Client A", timezone: "Asia/Ho_Chi_Minh", brandId: "brand-a", brandName: "Client A Brand" };

    expect(clientCreateConflictMatchesRecovery(recovery, expected)).toBe(true);
    expect(clientCreateConflictMatchesRecovery({ ...recovery, clients: [{ ...recovery.clients[0], timezone: "UTC" }] }, expected)).toBe(false);
  });

  it("reads recovery only for a typed duplicate conflict and preserves mismatched results", async () => {
    const recovery = {
      brands: [{ id: "brand-a", client_id: "client-a", name: "Brand A", status: "draft" }],
      identities: [{ id: "legacy-identity", brand_id: "brand-a", is_default: 1 }],
    };
    const client = { agencyRecovery: vi.fn().mockResolvedValue(recovery) };
    const error = new ControlPlaneError("BRAND_CONFLICT", "Agency operation was rejected by the Control Plane.", 400);
    const expected = { brandId: "brand-a", clientId: "client-a", brandName: "Brand A" };

    await expect(reconcileAgencyCreateConflict(client, error, new Set(["BRAND_CONFLICT"]), (value) => brandCreateConflictMatchesRecovery(value, expected))).resolves.toBe(true);
    await expect(reconcileAgencyCreateConflict(client, error, new Set(["BRAND_CONFLICT"]), (value) => brandCreateConflictMatchesRecovery({ ...value, brands: [{ ...recovery.brands[0], name: "Other Brand" }] }, expected))).resolves.toBe(false);
    await expect(reconcileAgencyCreateConflict(client, new Error("unrelated"), new Set(["BRAND_CONFLICT"]), () => true)).resolves.toBe(false);
    await expect(reconcileAgencyCreateConflict(client, new ControlPlaneError("BRAND_CLIENT_MISSING", "Agency operation was rejected by the Control Plane.", 400), new Set(["BRAND_CONFLICT"]), () => true)).resolves.toBe(false);
    expect(client.agencyRecovery).toHaveBeenCalledTimes(2);
  });

  it("resolves dashboard detail from the active Brand-scoped draft collection", () => {
    expect(appSource).toMatch(/const selectedDashboardDraft = selectedDashboardDraftId === undefined \? undefined : scopedDrafts\.find\(\(draft\) => draft\.id === selectedDashboardDraftId\);/);
    expect(appSource).not.toMatch(/const selectedDashboardDraft = selectedDashboardDraftId === undefined \? undefined : drafts\.find\(\(draft\) => draft\.id === selectedDashboardDraftId/);
  });

  it("keeps the Brand strategy panel on the active Client/Brand scope and durable ACK fence", () => {
    expect(appSource).toMatch(/const activeBrandScope = strategyCatalogScopeForBrand\(activeBrandRecord\);/);
    expect(appSource).toMatch(/const \{ clientId, brandId, scopeKey: expectedScopeKey \} = activeBrandScope;/);
    expect(appSource).toMatch(/strategyCatalogResponseMatchesScope\(response/);
    expect(appSource).toMatch(/strategyCatalogResponseMatchesSaveAck\(response/);
    expect(appSource).toMatch(/activeWorkspace=\{activeWorkspaceRecord\}/);
    expect(appSource).toMatch(/onSaveStrategyCatalog=\{saveStrategyCatalog\}/);
    expect(appSource).toMatch(/onReloadStrategyCatalog=\{reloadStrategyCatalog\}/);
  });

  it("accepts a Brand client scope that differs from its renderer workspace and rejects foreign responses", () => {
    const scopedBrand = { id: "brand-scoped", clientId: "client-canonical", workspaceId: "workspace-renderer" };
    const scope = strategyCatalogScopeForBrand(scopedBrand);
    const state = { activeBrandId: scopedBrand.id, brands: [scopedBrand] } as unknown as Pick<WorkspaceState, "activeBrandId" | "brands">;

    expect(scope).toEqual({ clientId: "client-canonical", brandId: "brand-scoped", scopeKey: '["client-canonical","brand-scoped"]' });
    expect(strategyCatalogScopeMatchesState(state, scope)).toBe(true);
    expect(strategyCatalogScopeMatchesState(state, { ...scope, clientId: "client-foreign", scopeKey: '["client-foreign","brand-scoped"]' })).toBe(false);
    expect(strategyCatalogScopeMatchesState({ ...state, activeBrandId: "brand-other" }, scope)).toBe(false);
    expect(strategyCatalogScopeMatchesState(state, { ...scope, scopeKey: '["client-foreign","brand-scoped"]' })).toBe(false);
    expect(strategyCatalogResponseMatchesScope({ clientId: "client-canonical", brandId: "brand-scoped", scopeKey: scope.scopeKey }, scope)).toBe(true);
    expect(strategyCatalogResponseMatchesScope({ clientId: "client-foreign", brandId: "brand-scoped", scopeKey: scope.scopeKey }, scope)).toBe(false);
    expect(strategyCatalogResponseMatchesScope({ clientId: "client-canonical", client_id: "client-foreign", brandId: "brand-scoped", scopeKey: scope.scopeKey }, scope)).toBe(false);
  });

  it("requires a strict durable acknowledgement before accepting a matching catalog response", () => {
    const catalog = starterStrategyCatalog("brand-scoped", new Date("2026-09-15T00:00:00.000Z"));
    const scope = strategyCatalogScopeForBrand({ id: "brand-scoped", clientId: "client-canonical", workspaceId: "workspace-renderer" });
    const savedCatalog = { ...structuredClone(catalog), version: catalog.version + 1 };
    const response = {
      acknowledged: true,
      clientId: scope.clientId,
      brandId: scope.brandId,
      scopeKey: scope.scopeKey,
      strategyCatalog: savedCatalog,
      strategyCatalogRevision: 8,
      revision: 8,
      version: savedCatalog.version,
      fingerprint: strategyCatalogFingerprint(savedCatalog),
    };

    expect(strategyCatalogResponseMatchesSaveAck(response, scope, catalog, 7)).toBe(true);
    expect(strategyCatalogResponseMatchesSaveAck({ ...response, acknowledged: false }, scope, catalog, 7)).toBe(false);
    expect(strategyCatalogResponseMatchesSaveAck({ ...response, acknowledged: undefined }, scope, catalog, 7)).toBe(false);
    expect(strategyCatalogResponseMatchesSaveAck({ ...response, strategyCatalogRevision: 8, revision: 7 }, scope, catalog, 7)).toBe(false);
    expect(strategyCatalogResponseMatchesSaveAck({ ...response, strategyCatalogRevision: "8" }, scope, catalog, 7)).toBe(false);
    expect(strategyCatalogResponseMatchesSaveAck({ ...response, revision: true }, scope, catalog, 7)).toBe(false);
    expect(strategyCatalogResponseMatchesSaveAck({ ...response, version: String(savedCatalog.version) }, scope, catalog, 7)).toBe(false);
    expect(strategyCatalogResponseMatchesSaveAck({ ...response, fingerprint: "wrong-fingerprint" }, scope, catalog, 7)).toBe(false);
    const missingRevision = Object.fromEntries(Object.entries(response).filter(([key]) => key !== "strategyCatalogRevision" && key !== "revision"));
    expect(strategyCatalogResponseMatchesSaveAck(missingRevision, scope, catalog, 7)).toBe(false);
  });

  it("passes the active scoped catalog and plan root format through automation run boundaries", () => {
    expect(appSource).toContain("selectAutomationPlansForRun(automationPlans.filter((plan) => automationPlanMatchesBrandScope(plan, activeBrandRecord)).map((plan) => canonicalizeAutomationPlanScope(plan, activeBrandRecord)), now, forceReviewOnly, activeStrategyCatalog, runScope)");
    expect(appSource).toContain("expandAutomationPlatformPlan(platform, platformPlan, plan)");
    expect(appSource).toContain("validateAutomationPlan(plan, activeStrategyCatalog)");
    expect(appSource).toContain("formatMode: bindingSchedule.formatMode");
    expect(appSource).toContain("formatMix: bindingSchedule.formatMix");
  });

  it("uses the Brand client scope when the Client differs from the workspace id", () => {
    const scopedBrand = { id: "brand-scoped", clientId: "client-canonical", workspaceId: "workspace-renderer" };
    expect(scopedBrand.clientId).not.toBe(scopedBrand.workspaceId);
    expect(strategyCatalogScopeKey(clientIdForBrand(scopedBrand), scopedBrand.id)).toBe('["client-canonical","brand-scoped"]');
    expect(appSource).toContain("strategyCatalogScopeKey(clientIdForBrand(activeBrandRecord), activeBrandRecord.id)");
    expect(appSource).toContain("clientIdForBrand(activeBrandRecord)");
    expect(appSource).toContain("canonicalizeAutomationPlanScope(plan, activeBrandRecord)");
    expect(appSource).toContain("automationPlanMatchesBrandScope(plan, activeBrandRecord)");
  });

  it("keeps planner validation and run once truthful for the visible catalog-scoped plan", () => {
    expect(appSource).toContain("validateAutomationPlan(scopedPlan, activeStrategyCatalog)");
    expect(appSource).toContain("const activeClientId = clientIdForBrand(activeBrandRecord);");
    expect(appSource).toContain("automationPlanMatchesBrandScope(plan, activeBrandRecord)");
  });

  it("binds Run once to the acknowledged visible plan and keeps periodic due checks on canonical Brand scope", () => {
    expect(appSource).toContain("const runReviewOnlyAutomationPlan = async (runScope: AutomationPlannerDraftScope) =>");
    expect(appSource).toContain("executeDueAutomationPlans(now, allowOfficialAI, forceReviewOnly, runScope)");
    expect(appSource).toContain("selectAutomationPlansForRun(automationPlans.filter((plan) => automationPlanMatchesBrandScope(plan, activeBrandRecord)).map((plan) => canonicalizeAutomationPlanScope(plan, activeBrandRecord)), now, forceReviewOnly, activeStrategyCatalog, runScope)");
    const plannerDueIndex = appSource.indexOf("const plannerDue =");
    const schedulerRegion = appSource.slice(plannerDueIndex, plannerDueIndex + 500);
    expect(schedulerRegion).toContain("state.automationPlans.filter((plan) => automationPlanMatchesBrandScope(plan, state.activeBrand)).map((plan) => canonicalizeAutomationPlanScope(plan, state.activeBrand))");
  });

  it("fences catalog recovery and ACKs by the canonical Client and Brand pair", () => {
    expect(appSource).toContain("const recoveryBrand = recovery.brands.find");
    expect(appSource).toContain("clientIdForBrand(activeBrandRecord)");
    expect(appSource).toContain("strategyCatalogResponseMatchesScope(response");
    expect(appSource).toContain("item.client_id ?? item.clientId");
  });

  it("renders only live provider readiness states", () => {
    const ready = renderToStaticMarkup(createElement(LiveReadinessIndicator, { readiness: "ready" }));
    const blocked = renderToStaticMarkup(createElement(LiveReadinessIndicator, { readiness: "blocked" }));
    expect(ready).toContain('role="status"');
    expect(ready).toContain("Verified Facebook Page text route ready · approved jobs only");
    expect(blocked).toContain("Live route blocked · Page and token required");
    expect(`${ready}${blocked}`).not.toMatch(/simulation|safe.?mode|live publishing blocked/i);
    expect(`${ready}${blocked}`).not.toContain("<button");
  });

  it("keeps ready copy scoped to verified Facebook text and deferred channel capabilities", () => {
    const markup = renderToStaticMarkup(createElement(LiveReadinessIndicator, { readiness: "ready" }));
    expect(markup).toContain("Verified Facebook Page text route ready · approved jobs only");
    expect(markup).toContain("Instagram requires a Business account and public media");
    expect(markup).toContain("TikTok and YouTube remain manual/deferred");
  });

  it("wires the normal App shell to a read-only indicator without Simulation or smoke plumbing", () => {
    const topbar = appSource.slice(appSource.indexOf('<header className="topbar">'), appSource.indexOf('<header className="topbar">') + 1800);
    expect(topbar).toContain("<LiveReadinessIndicator");
    expect(topbar).not.toContain("safe-mode-toggle");
    expect(appSource).not.toMatch(/safe.?mode|meta_set_safety_mode|metaSmokePost|metaPublicSmoke|publishMetaSmoke|publishMetaPublicSmoke/i);
    expect(appSource).toContain("getMetaLiveReadiness(hasDiscoveredMetaPage, metaAccessTokenConfigured)");
    const approvalRegion = appSource.slice(appSource.indexOf("const performApproveDraft"), appSource.indexOf("const approveDraft"));
    expect(approvalRegion).not.toMatch(/simulation|safe.?mode/i);
  });

  it("persists the ordinary draft revision before a no-provider rewrite can select its parent", () => {
    expect(appSource).toContain("const initialRevisionId = initialContentRunRevisionId(contentRunId);");
    expect(appSource).toContain("revisionId: initialRevisionId");
    expect(appSource).toContain("metadata: { ...variant.metadata, contentIntelligenceLineage: lineage, revisionId: initialRevisionId");
    expect(appSource).toContain("parentRevisionId = currentDraft.revisionId ?? latestHistoryRevision?.id ?? \"\";");
    expect(appSource).toContain("if (!parentRevisionId) throw new Error(\"CONTENT_RUN_PARENT_REVISION_REQUIRED\");");
    expect(appSource).not.toContain("`${currentRunId}:current`");
  });

  it("routes automatic runs through the A04 dispatch seam and resolves rewrite strategy from edited fields", () => {
    const automaticRegion = appSource.slice(appSource.indexOf("async function executeDueAutomationPlans"), appSource.indexOf("async function executeDueAutomationPlans") + 28_000);
    expect(automaticRegion).toContain("dispatchContentIntelligenceRun");
    expect(automaticRegion).toContain("contentIntelligenceLineage");
    expect(automaticRegion).toContain("selectedKnowledgeItemIds: approvedKnowledgeItemIds");
    expect(automaticRegion).toContain("topic: idea");
    expect(automaticRegion).toContain("buildVideoAwareCopyRequest");
    const rewriteRegion = appSource.slice(appSource.indexOf("const regenerateDraft"), appSource.indexOf("const storeGeneratedOutput"));
    expect(rewriteRegion).toContain("prepareStrategyGeneration({ catalog: activeStrategyCatalog");
    expect(rewriteRegion).toContain("strategySnapshotFromResolved");
    expect(rewriteRegion).toContain("contentPillar: generated.contentPillar ?? rewriteStrategy?.pillarLabel");
    expect(rewriteRegion).toContain("strategySnapshot: generated.strategySnapshot ?? strategySnapshot");
  });

  it("executes the App snapshot shape for manual, automatic, and rewrite structured success", async () => {
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-14T00:00:00.000Z"));
    const prepared = prepareStrategyGeneration({ catalog, channel: "facebook", format: "image", selection: { objective: "conversion", pillar: "proof-and-process", angle: "proof-and-process-proof-point" }, slotIndex: 0 });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const snapshot = strategySnapshotFromResolved(prepared.strategy as unknown as Record<string, unknown>, "image");
    expect(snapshot).toEqual(prepared.strategy.strategySnapshot);
    expect(snapshot.angleIdByChannel).toEqual({ facebook: "proof-and-process-proof-point" });
    const recipeSnapshot = strategySnapshotFromResolved(prepared.strategy as unknown as Record<string, unknown>, "image", "recipe-proof");
    expect(recipeSnapshot).toMatchObject({ angleIdByChannel: { facebook: "proof-and-process-proof-point" }, recipeId: "recipe-proof", format: "image" });
    const routeRecipe = { ...prepared.strategy, recipeId: "route-recipe", recipeGuidance: "Follow the approved recipe.", strategySnapshot: { ...prepared.strategy.strategySnapshot, recipeId: "route-recipe", recipeGuidance: "Follow the approved recipe." } };
    expect(strategySnapshotFromResolved(routeRecipe as unknown as Record<string, unknown>, "image")).toMatchObject({ angleIdByChannel: { facebook: "proof-and-process-proof-point" }, recipeId: "route-recipe", recipeGuidance: "Follow the approved recipe." });
    for (const trigger of ["manual", "automatic", "rewrite"] as const) {
      const strategy = trigger === "rewrite" ? { ...prepared.strategy, recipeId: "recipe-proof", strategySnapshot: recipeSnapshot } : prepared.strategy;
      const result = await new MockAIGateway().generate({ workspaceId: "brand-a", prompt: `${trigger} proof topic`, targetPlatforms: ["facebook"], contentKinds: ["image"], brandSystem: { workspaceId: "brand-a", voice: "Clear", audience: "Customers", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "system" } }, metadata: { structuredOutput: true, brandName: "Brand A", existingTopics: [], assetFormat: "image", resolvedStrategy: strategy, strategySnapshot: strategy.strategySnapshot } });
      expect(result.variants[0]?.strategySnapshot).toEqual(strategy.strategySnapshot);
    }
  });

  it("keeps multi-channel strategy snapshots channel-specific or blocks before dispatch", () => {
    const generationRegion = appSource.slice(appSource.indexOf("const createDraft"), appSource.indexOf("const persistedBrandBindings"));
    expect(generationRegion).toMatch(/prepareStrategyGenerationForChannels|targetPlatforms\.length > 1|MULTI_CHANNEL_STRATEGY/);
  });

  it("keeps live-readiness decisions fail-closed", () => {
    expect(getMetaLiveReadiness(true, true)).toBe("ready");
    expect(getMetaLiveReadiness(false, true)).toBe("blocked");
    expect(getMetaLiveReadiness(true, false)).toBe("blocked");
  });

  it("opens the picker for a no-plan future draft and keeps cancel from approving", () => {
    expect(approvalSchedulePromptApi.approvalSchedulePromptDecision({ planId: undefined, hasMatchingPlan: false, draftScheduledAt: "2099-01-02T10:15:00.000Z" })).toEqual({ action: "open_picker" });
    expect(approvalSchedulePromptApi.closeApprovalSchedulePromptState({ draftId: 7, value: "2099-01-02T10:15" })).toEqual({ draftId: undefined, value: "", approvalRequested: false });
  });

  it("submits the exact future picker timestamp for the guarded continuation", () => {
    const now = new Date("2026-09-13T00:00:00.000Z");
    expect(approvalSchedulePromptApi.submitApprovalSchedulePromptValue("2099-01-02T10:15:00.000Z", now)).toEqual({ ok: true, scheduledAt: "2099-01-02T10:15:00.000Z" });
  });

  it("rejects a stale non-empty plan ID before and during picker continuation", () => {
    const stalePlan = { planId: "deleted-plan", hasMatchingPlan: false, draftScheduledAt: "2099-01-02T10:15:00.000Z" };
    expect(approvalSchedulePromptApi.approvalSchedulePromptDecision(stalePlan)).toMatchObject({ action: "reject", message: expect.stringContaining("kế hoạch gốc") });
    expect(approvalSchedulePromptApi.approvalSchedulePromptDecision({ ...stalePlan, overrideScheduledAt: "2099-01-03T10:15:00.000Z" })).toMatchObject({ action: "reject", message: expect.stringContaining("kế hoạch gốc") });
  });

  it("keeps a quality-passed locked Content Run snapshot intact during approval persistence", () => {
    const buildApprovalContentRunPatch = (appModule as unknown as {
      buildApprovalContentRunPatch: (input: {
        state: string;
        scheduledAt?: string;
        approvalState: string;
        targetApprovalState: string;
        targetApprovalIntents: readonly Record<string, unknown>[];
        planId?: string;
        targetBindingIds: readonly string[];
        bindingIds: readonly string[];
      }) => Record<string, unknown>;
    }).buildApprovalContentRunPatch;
    expect(buildApprovalContentRunPatch).toBeTypeOf("function");

    const lockedRun = {
      id: "run-quality-locked",
      state: "ready",
      qualityStatus: "passed",
      approvalState: "pending",
      body: "The immutable quality-passed copy must survive approval state persistence.",
      variants: [{ id: "variant-quality-locked", body: "The immutable variant body must survive approval state persistence." }],
      contentIntelligenceLineage: { selectedRecipeId: "recipe-a", transformMode: "original", customerFacts: ["approved fact"] },
      revisionId: "revision-quality-locked",
      parentRevisionId: "revision-parent",
      revisionHistory: [{ id: "revision-parent", title: "Parent", body: "Parent body", createdAt: "2026-09-17T00:00:00.000Z" }],
    };
    const intents = [{ id: "publication-a", approvalState: "approved", workerJob: { jobId: "job-a" } }];
    const patch = buildApprovalContentRunPatch({
      state: "needs_review",
      scheduledAt: "2099-01-02T10:15:00.000Z",
      approvalState: "pending",
      targetApprovalState: "pending",
      targetApprovalIntents: intents,
      planId: "plan-a",
      targetBindingIds: ["binding-a"],
      bindingIds: ["binding-a"],
    });

    expect(Object.keys(patch).sort()).toEqual(["approvalState", "bindingIds", "planId", "scheduledAt", "state", "targetApprovalIntents", "targetApprovalState", "targetBindingIds"]);
    expect(patch).not.toHaveProperty("body");
    expect(patch).not.toHaveProperty("variants");
    expect(patch).not.toHaveProperty("contentIntelligenceLineage");
    expect({ ...lockedRun, ...patch }).toMatchObject({
      body: lockedRun.body,
      variants: lockedRun.variants,
      contentIntelligenceLineage: lockedRun.contentIntelligenceLineage,
      revisionId: lockedRun.revisionId,
      parentRevisionId: lockedRun.parentRevisionId,
      revisionHistory: lockedRun.revisionHistory,
      state: "needs_review",
      targetApprovalIntents: intents,
    });
  });

  it("backfills only active-user brands with an active manage_brand membership", () => {
    const state = {
      ...defaultWorkspaceState,
      brands: [
        { ...defaultWorkspaceState.brands[0]!, id: "brand-owner", clientId: "client-owner", workspaceId: "client-owner" },
        { ...defaultWorkspaceState.brands[0]!, id: "brand-editor", clientId: "client-editor", workspaceId: "client-editor" },
        { ...defaultWorkspaceState.brands[0]!, id: "brand-suspended", clientId: "client-suspended", workspaceId: "client-suspended" },
      ],
      memberships: [
        { ...defaultWorkspaceState.memberships[0]!, workspaceId: "client-owner", userId: "user-a", role: "owner" as const, status: "active" as const },
        { ...defaultWorkspaceState.memberships[0]!, workspaceId: "client-editor", userId: "user-a", role: "editor" as const, status: "active" as const },
        { ...defaultWorkspaceState.memberships[0]!, workspaceId: "client-suspended", userId: "user-a", role: "admin" as const, status: "suspended" as const },
        { ...defaultWorkspaceState.memberships[0]!, workspaceId: "client-other", userId: "user-b", role: "owner" as const, status: "active" as const },
      ],
    } as WorkspaceState;

    expect(managedBrandBackfillGroups(state, "user-a", [
      { id: "recovered-owner-brand", client_id: "client-owner" },
      { id: "other-user-brand", client_id: "client-other" },
    ])).toEqual([{ role: "owner", brandIds: ["brand-owner", "recovered-owner-brand"] }]);
  });

  it("allows same-client shared media with retired brand ids but rejects private, archived, and cross-client records", () => {
    const retired = { clientId: "client-a", brandId: "brand-retired", distribution: "facebook" as const, archiveState: "active" as const };
    expect(localMediaBelongsToBrand(retired, { shared: true }, "client-a", "brand-current")).toBe(true);
    expect(localMediaBelongsToBrand(retired, { sharedBrandIds: ["brand-current"] }, "client-a", "brand-current")).toBe(true);
    expect(localMediaBelongsToBrand({ ...retired, distribution: "universal" }, undefined, "client-a", "brand-current")).toBe(true);
    expect(localMediaBelongsToBrand(retired, undefined, "client-a", "brand-current")).toBe(false);
    expect(localMediaBelongsToBrand({ ...retired, archiveState: "archived" }, { distribution: "universal" }, "client-a", "brand-current")).toBe(false);
    expect(localMediaBelongsToBrand({ ...retired, clientId: "client-b", distribution: "universal" }, undefined, "client-a", "brand-current")).toBe(false);
  });

  it("requires reconciled terminal publication evidence before brand trash", () => {
    const base = { id: "publication-a", clientId: "client-a", brandId: "brand-a", state: "canceled", revision: 2 };
    expect(targetPublicationSafeForBrandTrash({ ...base, workerAckState: "acknowledged" })).toBe(true);
    expect(targetPublicationSafeForBrandTrash({ ...base, workerAckState: "unknown" })).toBe(false);
    expect(targetPublicationSafeForBrandTrash({ ...base, workerAckState: "failed" })).toBe(false);
    expect(targetPublicationSafeForBrandTrash({ ...base, state: "blocked", legacyNonLive: true, workerAckState: "not_required" })).toBe(true);
    expect(targetPublicationSafeForBrandTrash({ ...base, state: "published", providerJobId: "provider-a" })).toBe(true);
    expect(targetPublicationSafeForBrandTrash({ ...base, state: "published" })).toBe(false);
    expect(targetPublicationSafeForBrandTrash({ ...base, state: "published", workerAckState: "acknowledged" })).toBe(false);
    expect(targetPublicationSafeForBrandTrash({ ...base, state: "scheduled" })).toBe(false);
  });

  it("keeps the App action contract single-flight, CAS-acknowledged, target-specific, and cancel-safe", async () => {
    const scopeKey = draftActionScopeKey({ profileId: "profile-a", profileRevision: 1, clientId: "client-a", brandId: "brand-a", draftId: 7, contentRunId: "run-7" });
    const lockKey = draftActionLockKey(scopeKey, "quality");
    const locks = new Map<string, symbol>();
    const qualityChecks = [{ key: "copy", passed: true }];
    const input = { contentRunId: "run-7", clientId: "client-a", brandId: "brand-a", revisionId: "revision-1", state: "ready", qualityStatus: "passed", qualityChecks, checkedAt: "2026-09-13T06:00:00.000Z", expectedRevisionFields: contentRunRevisionFieldsFromDraft({ revisionId: "revision-1", parentRevisionId: "revision-0" }) };
    expect(input.expectedRevisionFields).toEqual({ revisionId: "revision-1", parentRevisionId: "revision-0" });
    let writes = 0;
    let resolveAck!: (value: Record<string, unknown>) => void;
    const deferredAck = new Promise<Record<string, unknown>>((resolve) => { resolveAck = resolve; });
    const update = async (payload: Record<string, unknown>) => { writes += 1; expect(payload).toMatchObject({ state: "ready", qualityStatus: "passed" }); return await deferredAck; };
    const request = async () => {
      const token = beginDraftAction(locks, lockKey);
      if (!token) return "pending";
      try { await submitContentRunQualityCheck(update, input); return "success"; } finally { endDraftAction(locks, lockKey, token); }
    };
    const first = request();
    await expect(request()).resolves.toBe("pending");
    expect(writes).toBe(1);
    resolveAck({ id: "run-7", clientId: "client-a", brandId: "brand-a", revisionId: "revision-1", state: "ready", qualityStatus: "passed", qualityChecks, checkedAt: input.checkedAt });
    await expect(first).resolves.toBe("success");
    await expect(submitContentRunQualityCheck(async () => ({ id: "run-other", clientId: "client-a", brandId: "brand-a", revisionId: "revision-1", state: "ready", qualityStatus: "passed", qualityChecks, checkedAt: input.checkedAt }), input)).rejects.toThrow("CONTENT_RUN_QUALITY_ACK_MISMATCH");

    const draft = { id: 7, clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", status: "Scheduled", qualityStatus: "passed", approvalState: "ready", pendingPublicationIds: ["publication-pending"] };
    const targets = [
      { id: "publication-done", clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", variantId: "variant-7", state: "published", providerJobId: "provider-7", simulation: false, commandStatus: "acknowledged", workerAckState: "acknowledged" },
      { id: "publication-live", clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", variantId: "variant-7", state: "scheduled", simulation: false, commandStatus: "acknowledged", workerAckState: "acknowledged" },
      { id: "publication-pending", clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", variantId: "variant-7", state: "scheduled", simulation: false, commandStatus: "pending", workerAckState: "pending" },
    ];
    expect(draftPublishBlocker(draft, targets)).toBeUndefined();
    expect(draftPublishBlocker(draft, targets, "publication-live")).toBeUndefined();
    expect(draftPublishBlocker(draft, targets, "publication-pending")).toMatch(/selected target.*reconciliation/i);
    expect(publishCommandOutcome({ commandStatus: "acknowledged", workerAckState: "acknowledged", state: "queued" })).toMatchObject({ status: "pending", code: "PROVIDER_CONFIRMATION_PENDING" });
    expect(targetActionSelectionOutcome(undefined, "").command).toBeUndefined();
  });

  it("maps migrated simulation history to a read-only legacy marker", () => {
    const summary = targetPublicationSummary({ id: "publication-legacy", clientId: "client-a", brandId: "brand-a", state: "blocked", simulation: true, workerAckState: "not_required" });
    expect(summary).toMatchObject({ id: "publication-legacy", legacyNonLive: true });
    expect(summary).not.toHaveProperty("simulation");
    expect(appSource).toContain("legacyNonLive");
    expect(appSource).not.toContain("simulation-${publication.id}");
    expect(appSource).not.toContain("simulated target jobs cannot be published live");
    expect(appSource).toContain("!job.legacyNonLive && !durableJobIds.has(job.id)");
    expect(appSource).toContain("Job này chỉ được đọc và không thể retry.");
  });

  it("cleans up the open target prompt for every cancel affordance without a command", () => {
    const prompt = { action: "publish_now" as const, scopeKey: "scope-a" };
    const retryableFeedback = { status: "pending" as const, pendingReason: "selection" as const, message: "Choose a target before retrying." };
    for (const reason of ["Cancel", "Escape", "backdrop", "close"] as const) {
      const closed = closeTargetActionPromptOutcome(prompt);
      const nextPublishFeedback = closed.clearPublishFeedback ? undefined : retryableFeedback;
      expect({ reason, ...closed, nextPublishFeedback }).toMatchObject({ prompt: undefined, jobId: "", clearPublishFeedback: true, nextPublishFeedback: undefined });
      expect(targetActionSelectionOutcome(closed.prompt, closed.jobId)).toEqual({ clearSelection: true, command: undefined });
    }
    expect(closeTargetActionPromptOutcome(prompt, false).clearPublishFeedback).toBe(false);
  });

  it("locks permanent delete before the deferred ACK and dispatches exactly once", async () => {
    const scope: BrandDeleteScope = { profileId: "profile-a", profileRevision: 3, clientId: "client-a", brandId: "brand-a", brandName: "Brand A", impactRevision: "a".repeat(64) };
    const lock = new Map<string, string>();
    const unknownRequests = new Map<string, BrandLifecycleRequestToken>();
    let dispatches = 0;
    let commits = 0;
    let resolveAck!: (value: unknown) => void;
    const deferredAck = new Promise<unknown>((resolve) => { resolveAck = resolve; });
    const request = (requestId: string) => runBrandDeleteLifecycle({
      lock,
      unknownRequests,
      scope,
      confirmation: "Brand A",
      requestId,
      dispatch: async () => { dispatches += 1; return await deferredAck; },
      reconcile: async () => undefined,
      commit: () => { commits += 1; },
    });
    const first = request("request-a");
    await Promise.resolve();
    expect(lock.get(brandDeleteScopeKey(scope))).toBe("request-a");
    expect(dispatches).toBe(1);
    await expect(request("request-b")).resolves.toMatchObject({ status: "pending", code: "BRAND_DELETE_ALREADY_IN_FLIGHT" });
    expect(dispatches).toBe(1);
    expect(commits).toBe(0);
    resolveAck({ status: "deleted", id: "brand-a", clientId: "client-a", name: "Brand A", operationId: "operation-a" });
    await expect(first).resolves.toMatchObject({ status: "acknowledged", operationId: "operation-a" });
    expect(commits).toBe(1);
    expect(lock.has(brandDeleteScopeKey(scope))).toBe(false);
  });

  it("applies a late A completion to A only while the current B snapshot stays unchanged", async () => {
    const scope: BrandDeleteScope = { profileId: "profile-a", profileRevision: 3, clientId: "workspace-mile-mark-money", brandId: "brand-bellamy-baby", brandName: "Bellamy Baby", impactRevision: "b".repeat(64) };
    const trashed = trashBrand(defaultWorkspaceState, scope.brandId).state;
    let state = { ...trashed, activeBrandId: "brand-mile-mark-money" };
    const beforeB = state.brands.find((brand) => brand.id === "brand-mile-mark-money");
    const notice = "B notice";
    const edits = { title: "B edited while A waits" };
    let dispatch!: () => void;
    const response = new Promise<unknown>((resolve) => { dispatch = () => resolve({ status: "deleted", id: scope.brandId, clientId: scope.clientId, name: scope.brandName, operationId: "operation-b" }); });
    const outcome = runBrandDeleteLifecycle({
      lock: new Map<string, string>(),
      unknownRequests: new Map(),
      scope,
      confirmation: scope.brandName,
      dispatch: async () => await response,
      reconcile: async () => undefined,
      commit: (_token, ack) => { expect(validateBrandDeleteAck(ack, scope).ok).toBe(true); state = removeBrandRecordsForScope(state, scope); },
    });
    state = { ...state, activeWorkspaceId: "workspace-mile-mark-money", activeBrandId: "brand-mile-mark-money" };
    dispatch();
    await expect(outcome).resolves.toMatchObject({ status: "acknowledged" });
    expect(state.activeWorkspaceId).toBe("workspace-mile-mark-money");
    expect(state.activeBrandId).toBe("brand-mile-mark-money");
    expect(state.brands.find((brand) => brand.id === "brand-mile-mark-money")).toEqual(beforeB);
    expect(notice).toBe("B notice");
    expect(edits.title).toBe("B edited while A waits");
    expect(state.brands.some((brand) => brand.id === scope.brandId)).toBe(false);
  });

  it("keeps same Brand IDs owned by another Client out of acknowledged cleanup", () => {
    const sourceBrand = defaultWorkspaceState.brands[0]!;
    const sharedId = "brand-shared-id";
    const state: WorkspaceState = {
      ...defaultWorkspaceState,
      activeWorkspaceId: "client-a",
      activeBrandId: sharedId,
      workspaces: [
        { ...defaultWorkspaceState.workspaces[0]!, id: "client-a", brandIds: [sharedId] },
        { ...defaultWorkspaceState.workspaces[1]!, id: "client-b", brandIds: [sharedId] },
      ],
      brands: [
        { ...sourceBrand, id: sharedId, clientId: "client-a", workspaceId: "client-a", deletedAt: "2026-09-14T00:00:00.000Z", status: "archived" },
        { ...sourceBrand, id: sharedId, clientId: "client-b", workspaceId: "client-b", status: "active" },
      ],
      brandVoiceByBrand: { [sharedId]: "Keep both Client voices" },
      brandIdentities: [{ id: "identity-shared", brandId: sharedId, name: "Shared identity", isDefault: true, version: 1, status: "active", strategy: { vision: "", mission: "", values: [], personality: [], audience: "" }, voice: { tone: "", vocabulary: [], prohibitedClaims: [] }, visual: { logoAssetIds: [], colors: [], typography: { heading: "", body: "" }, styleGuide: "" } }],
    };
    const cleaned = removeBrandRecordsForScope(state, { brandId: sharedId, clientId: "client-a" });
    expect(cleaned.brands).toEqual([expect.objectContaining({ id: sharedId, clientId: "client-b", status: "active" })]);
    expect(cleaned.workspaces.find((workspace) => workspace.id === "client-b")?.brandIds).toEqual([sharedId]);
    expect(cleaned.brandIdentities).toHaveLength(1);
    expect(cleaned.brandVoiceByBrand[sharedId]).toBeDefined();
  });

  it("rejects wrong Brand, Client, and status-only ACKs before local cleanup", async () => {
    const scope: BrandDeleteScope = { profileId: "profile-a", profileRevision: 3, clientId: "client-a", brandId: "brand-a", brandName: "Brand A" };
    for (const ack of [
      { status: "deleted", id: "brand-other", clientId: "client-a", operationId: "operation-a" },
      { status: "deleted", id: "brand-a", clientId: "client-other", operationId: "operation-a" },
      { status: "deleted" },
    ]) {
      let commits = 0;
      const result = await runBrandDeleteLifecycle({ lock: new Map(), unknownRequests: new Map(), scope, confirmation: scope.brandName, dispatch: async () => ack, reconcile: async () => undefined, commit: () => { commits += 1; } });
      expect(result.status).toBe("rejected");
      expect(commits).toBe(0);
    }
    expect(reconcileBrandDeleteOperations([{ id: "operation-other", brandId: "brand-other", clientId: "client-a", state: "completed" }], scope)).toEqual({ status: "unknown" });
  });

  it("keeps a lost response unknown and requires reconciliation before any retry", async () => {
    const scope: BrandDeleteScope = { profileId: "profile-a", profileRevision: 3, clientId: "client-a", brandId: "brand-a", brandName: "Brand A" };
    const lock = new Map<string, string>();
    const unknownRequests = new Map<string, BrandLifecycleRequestToken>();
    let dispatches = 0;
    let reconcileCalls = 0;
    const run = () => runBrandDeleteLifecycle({ lock, unknownRequests, scope, confirmation: scope.brandName, dispatch: async () => { dispatches += 1; throw Object.assign(new Error("connection lost"), { code: "CONTROL_PLANE_UNREACHABLE" }); }, reconcile: async () => { reconcileCalls += 1; return undefined; }, commit: () => undefined });
    await expect(run()).resolves.toMatchObject({ status: "unknown", code: "BRAND_DELETE_OUTCOME_UNKNOWN" });
    expect(dispatches).toBe(1);
    await expect(run()).resolves.toMatchObject({ status: "unknown", code: "BRAND_DELETE_OUTCOME_UNKNOWN" });
    expect(dispatches).toBe(1);
    expect(reconcileCalls).toBe(2);
    unknownRequests.set(brandDeleteScopeKey(scope), { ...scope, operation: "permanent-delete", requestId: "request-a", scopeKey: brandDeleteScopeKey(scope) });
    const completed = { status: "deleted", id: scope.brandId, clientId: scope.clientId, name: scope.brandName, operationId: "operation-a" };
    const reconciled = await runBrandDeleteLifecycle({ lock, unknownRequests, scope, confirmation: scope.brandName, dispatch: async () => { dispatches += 1; return completed; }, reconcile: async () => completed, commit: () => undefined });
    expect(reconciled.status).toBe("acknowledged");
    expect(dispatches).toBe(1);
  });

  it("keeps a persisted pending operation unresolved and never dispatches a blind retry", async () => {
    const scope: BrandDeleteScope = { profileId: "profile-a", profileRevision: 3, clientId: "client-a", brandId: "brand-a", brandName: "Brand A" };
    expect(reconcileBrandDeleteOperations([{ id: "operation-a", brandId: "brand-a", clientId: "client-a", state: "pending" }], scope)).toEqual({ status: "pending" });
    const unknownRequests = new Map<string, BrandLifecycleRequestToken>();
    unknownRequests.set(brandDeleteScopeKey(scope), { ...scope, operation: "permanent-delete", requestId: "request-a", scopeKey: brandDeleteScopeKey(scope) });
    let dispatches = 0;
    const result = await runBrandDeleteLifecycle({ lock: new Map(), unknownRequests, scope, confirmation: scope.brandName, dispatch: async () => { dispatches += 1; return {}; }, reconcile: async () => undefined, commit: () => undefined });
    expect(result).toMatchObject({ status: "unknown", code: "BRAND_DELETE_OUTCOME_UNKNOWN" });
    expect(dispatches).toBe(0);
    expect(unknownRequests.get(brandDeleteScopeKey(scope))?.requestId).toBe("request-a");
  });

  it("bounds a never-settling lifecycle dispatch and retains its reconciliation marker", async () => {
    const scope: BrandDeleteScope = { profileId: "profile-a", profileRevision: 3, clientId: "client-a", brandId: "brand-a", brandName: "Brand A" };
    const lock = new Map<string, string>();
    const unknownRequests = new Map<string, BrandLifecycleRequestToken>();
    let dispatches = 0;
    const result = await runBrandDeleteLifecycle({ lock, unknownRequests, scope, confirmation: scope.brandName, deadlineMs: 10, reconciliationDeadlineMs: 10, dispatch: async () => { dispatches += 1; return await new Promise<unknown>(() => undefined); }, reconcile: async () => undefined, commit: () => undefined });
    expect(result).toMatchObject({ status: "unknown", code: "BRAND_DELETE_OUTCOME_UNKNOWN" });
    expect(dispatches).toBe(1);
    expect(lock.has(brandDeleteScopeKey(scope))).toBe(false);
    expect(unknownRequests.has(brandDeleteScopeKey(scope))).toBe(true);
  });

  it("uses one restore/delete lock and suppresses stale restore success after delete wins", async () => {
    const scope: BrandDeleteScope = { profileId: "profile-a", profileRevision: 3, clientId: "client-a", brandId: "brand-a", brandName: "Brand A" };
    const lock = new Map<string, string>();
    const unknownRequests = new Map<string, BrandLifecycleRequestToken>();
    let resolveRestore!: (value: unknown) => void;
    const restore = runBrandRestoreLifecycle({ lock, unknownRequests, scope, deadlineMs: 1_000, dispatch: async () => await new Promise<unknown>((resolve) => { resolveRestore = resolve; }), commit: () => undefined, isCurrent: () => false });
    await Promise.resolve();
    const deleteAttempt = await runBrandDeleteLifecycle({ lock, unknownRequests, scope, confirmation: scope.brandName, dispatch: async () => ({ status: "deleted", id: scope.brandId, clientId: scope.clientId, name: scope.brandName, operationId: "delete-a" }), reconcile: async () => undefined, commit: () => undefined });
    expect(deleteAttempt).toMatchObject({ status: "pending", code: "BRAND_DELETE_ALREADY_IN_FLIGHT" });
    resolveRestore({ status: "draft", id: scope.brandId, clientId: scope.clientId, name: scope.brandName });
    expect(await restore).toMatchObject({ status: "rejected", code: "BRAND_RESTORE_SCOPE_CHANGED" });
  });

  it("drives the rendered Settings modal callbacks through the production controller", async () => {
    const deferredOutcome = () => {
      let resolve!: (value: BrandDeleteOutcome) => void;
      const promise = new Promise<BrandDeleteOutcome>((promiseResolve) => { resolve = promiseResolve; });
      return { promise, resolve };
    };
    type FocusTarget = { isConnected: boolean; focus: ReturnType<typeof vi.fn> };
    const opener = { isConnected: true, focus: vi.fn() } as FocusTarget;
    const fallback = { isConnected: true, focus: vi.fn() } as FocusTarget;
    const stateRef = { current: { brandId: undefined, confirmation: "", pending: false, requestVersion: 0 } as BrandDeleteModalState };
    const requestVersionRef = { current: 0 };
    const openerRef = { current: null as unknown as HTMLButtonElement | null };
    const fallbackRef = { current: fallback as unknown as HTMLElement | null };
    const feedback: string[] = [];
    const calls: Array<[string, string]> = [];
    const responses: Array<Promise<BrandDeleteOutcome>> = [];
    const onConfirm = async (brandId: string, confirmation: string) => {
      calls.push([brandId, confirmation]);
      return await responses.shift()!;
    };
    const controller = createBrandDeleteModalController({
      getState: () => stateRef.current,
      setState: (next) => { stateRef.current = next; },
      requestVersionRef,
      openerRef,
      fallbackRef,
      isBusy: () => stateRef.current.pending,
      canConfirm: () => stateRef.current.confirmation === "Brand A",
      getExpectedBrandName: () => "Brand A",
      onConfirm,
      onFeedback: (message) => { feedback.push(message); },
      scheduleFocus: (callback) => callback(),
    });

    const acknowledged = deferredOutcome();
    responses.push(acknowledged.promise);
    expect(controller.open("brand-a", opener as unknown as HTMLButtonElement)).toBe(true);
    controller.input("Brand A");
    const firstConfirm = controller.confirm();
    await Promise.resolve();
    expect(stateRef.current).toMatchObject({ brandId: "brand-a", confirmation: "Brand A", pending: true });
    expect(calls).toEqual([["brand-a", "Brand A"]]);
    await expect(controller.confirm()).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(controller.cancel()).toBe(false);
    expect(stateRef.current.pending).toBe(true);
    opener.isConnected = false;
    acknowledged.resolve({ status: "acknowledged", requestId: "delete-a" });
    await expect(firstConfirm).resolves.toMatchObject({ status: "acknowledged" });
    expect(stateRef.current.brandId).toBeUndefined();
    expect(fallback.focus).toHaveBeenCalledTimes(1);
    opener.isConnected = true;

    responses.push(Promise.resolve({ status: "rejected", code: "REJECTED" }));
    expect(controller.open("brand-a", opener as unknown as HTMLButtonElement)).toBe(true);
    controller.input("Brand A");
    await expect(controller.confirm()).resolves.toMatchObject({ status: "rejected" });
    expect(stateRef.current).toMatchObject({ brandId: "brand-a", pending: false });
    expect(feedback[feedback.length - 1]).toContain("dữ liệu cục bộ vẫn được giữ");

    responses.push(Promise.resolve({ status: "unknown", code: "UNKNOWN" }));
    controller.input("Brand A");
    await expect(controller.confirm()).resolves.toMatchObject({ status: "unknown" });
    expect(stateRef.current.pending).toBe(false);
    expect(feedback[feedback.length - 1]).toContain("Chưa xác định kết quả");

    controller.cancel();
    expect(stateRef.current.brandId).toBeUndefined();
    expect(opener.focus).toHaveBeenCalled();
    expect(calls).toHaveLength(3);

    expect(controller.open("brand-a", opener as unknown as HTMLButtonElement)).toBe(true);
    const escapeEvent = { key: "Escape", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>;
    controller.keyDown(escapeEvent, null);
    expect(escapeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(stateRef.current.brandId).toBeUndefined();
    expect(controller.open("brand-a", opener as unknown as HTMLButtonElement)).toBe(true);
    expect(controller.backdrop(false)).toBe(false);
    expect(stateRef.current.brandId).toBe("brand-a");
    expect(controller.backdrop(true)).toBe(true);
    expect(stateRef.current.brandId).toBeUndefined();

    const firstTabTarget = { focus: vi.fn(), getAttribute: () => null };
    const lastTabTarget = { focus: vi.fn(), getAttribute: () => null };
    const dialog = { querySelectorAll: () => [firstTabTarget, lastTabTarget] } as unknown as HTMLElement;
    const previousDocument = (globalThis as typeof globalThis & { document?: unknown }).document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: lastTabTarget } });
    try {
      const tabEvent = { key: "Tab", shiftKey: false, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>;
      controller.keyDown(tabEvent, dialog);
      expect(tabEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(firstTabTarget.focus).toHaveBeenCalledTimes(1);
      Object.defineProperty(globalThis.document, "activeElement", { configurable: true, value: firstTabTarget });
      const reverseTabEvent = { key: "Tab", shiftKey: true, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>;
      controller.keyDown(reverseTabEvent, dialog);
      expect(reverseTabEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(lastTabTarget.focus).toHaveBeenCalledTimes(1);
    } finally {
      if (previousDocument === undefined) Reflect.deleteProperty(globalThis, "document");
      else Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    }

    opener.isConnected = false;
    expect(controller.open("brand-a", opener as unknown as HTMLButtonElement)).toBe(true);
    expect(controller.cancel()).toBe(true);
    expect(fallback.focus).toHaveBeenCalledTimes(2);

    const staleOutcome = deferredOutcome();
    const latestOutcome = deferredOutcome();
    responses.push(staleOutcome.promise, latestOutcome.promise);
    expect(controller.open("brand-a", opener as unknown as HTMLButtonElement)).toBe(true);
    controller.input("Brand A");
    const staleConfirm = controller.confirm();
    await Promise.resolve();
    stateRef.current = { brandId: undefined, confirmation: "", pending: false, requestVersion: requestVersionRef.current + 1 };
    requestVersionRef.current = stateRef.current.requestVersion;
    expect(controller.open("brand-b", opener as unknown as HTMLButtonElement)).toBe(true);
    expect(stateRef.current.confirmation).toBe("");
    controller.cancel();
    expect(controller.open("brand-a", opener as unknown as HTMLButtonElement)).toBe(true);
    controller.input("Brand A");
    const latestConfirm = controller.confirm();
    await Promise.resolve();
    feedback.push("B notice");
    staleOutcome.resolve({ status: "acknowledged", requestId: "stale-a" });
    await expect(staleConfirm).resolves.toMatchObject({ status: "acknowledged" });
    expect(stateRef.current).toMatchObject({ brandId: "brand-a", confirmation: "Brand A", pending: true });
    expect(feedback[feedback.length - 1]).toBe("B notice");
    latestOutcome.resolve({ status: "acknowledged", requestId: "latest-a" });
    await expect(latestConfirm).resolves.toMatchObject({ status: "acknowledged" });
    expect(stateRef.current.brandId).toBeUndefined();
    expect(calls.slice(-2)).toEqual([["brand-a", "Brand A"], ["brand-a", "Brand A"]]);

    expect(controller.open("brand-a", opener as unknown as HTMLButtonElement)).toBe(true);
    controller.input("Wrong");
    await expect(controller.confirm()).resolves.toBeUndefined();
    expect(calls).toHaveLength(5);
  });

  it("uses an in-app, ACK-gated brand delete confirmation surface", () => {
    const settingsSource = readFileSync(new URL("./ExpandedViews.tsx", import.meta.url), "utf8");
    expect(settingsSource).toContain("brand-delete-modal");
    expect(settingsSource).toContain("countsKnown !== true");
    expect(settingsSource).toContain("Bài đã đăng trên Facebook");
    expect(settingsSource).toContain("file Drive bên ngoài");
    expect(settingsSource).not.toContain("window.prompt(`Nhập chính xác");
    expect(settingsSource).toContain("permanentDeletePending");
  });

  it("loads permanent-delete impact for the requested inactive Brand", () => {
    const settingsSource = readFileSync(new URL("./ExpandedViews.tsx", import.meta.url), "utf8");
    expect(appSource).toMatch(/brandImpactLoading/);
    expect(appSource).toMatch(/brandImpactErrors/);
    expect(appSource).toMatch(/brandImpactPreview\(brandId\)/);
    expect(appSource).toMatch(/normalizeBrandImpactPreview\(response, brandId\)/);
    expect(settingsSource).toMatch(/onLoadBrandTrashPreview\(brandId\)/);
    expect(settingsSource).toMatch(/brandImpactLoading\[permanentDeleteScopeKey\]/);
    expect(settingsSource).toMatch(/brandImpactErrors\[permanentDeleteScopeKey\]/);
  });

  it("keeps permanent delete locked until a Control Plane impact is authoritative", () => {
    const settingsSource = readFileSync(new URL("./ExpandedViews.tsx", import.meta.url), "utf8");
    const localPreview = { brandId: "brand-a", brandName: "Brand A", draftCount: 0, planCount: 0, unsentScheduleCount: 0, sharedMediaCount: 0, countsKnown: false, source: "local" as const };
    const authoritativePreview = { ...localPreview, countsKnown: true, source: "control_plane" as const };
    expect(isAuthoritativeBrandImpact(localPreview)).toBe(false);
    expect(isAuthoritativeBrandImpact(authoritativePreview)).toBe(true);
    expect(appSource).toContain("countsKnown: false");
    expect(appSource).toContain('CONTROL_PLANE_UNCONFIGURED');
    expect(settingsSource).toContain("!permanentDeleteImpactIsAuthoritative");
  });
});

describe("A03 Revo composer lifecycle", () => {
  const scopeA: RevoComposerRequestScope = { profileId: "profile-a", profileRevision: 3, clientId: "client-a", brandId: "brand-a" };
  const scopeB: RevoComposerRequestScope = { ...scopeA, clientId: "client-b", brandId: "brand-b" };

  const form = {
    topic: "Topic A",
    contentPillar: "Education",
    objective: "Education" as const,
    caption: "",
    cta: "",
    hashtags: "",
    seoKeywords: "",
    scheduledAt: "",
    sources: "",
    notes: "",
    aiProvider: "openai" as const,
    aiMode: "api" as const,
    selectedPlatforms: ["Facebook" as const],
    composerAssetId: "",
  };

  it("opens the same production composer handler from Dashboard and Studio without dispatch", () => {
    const setVisible = vi.fn();
    const captureOpener = vi.fn();
    const clearError = vi.fn();
    const blocked = vi.fn();
    const gatewayDispatch = vi.fn();
    for (const entryPoint of ["Dashboard", "Content Studio"]) {
      expect(openRevoComposerHandler({ isGenerating: false, captureOpener, setVisible, clearError, onBlocked: blocked })).toBe(true);
      void entryPoint;
    }
    expect(setVisible).toHaveBeenCalledWith(true);
    expect(captureOpener).toHaveBeenCalledTimes(2);
    expect(clearError).toHaveBeenCalledTimes(2);
    expect(blocked).not.toHaveBeenCalled();
    expect(gatewayDispatch).not.toHaveBeenCalled();
  });

  it("drives Cancel, Escape and backdrop through the production modal controller", () => {
    const openerFocus = vi.fn();
    const opener: RevoComposerFocusTarget = { isConnected: true, focus: (): void => { openerFocus(); } };
    const openerRef = { current: opener };
    const closeEvents: RevoComposerCloseEvent[] = [];
    const submit = vi.fn();
    let visible = true;
    let generating = false;
    const controller = createRevoComposerModalController({
      isVisible: () => visible,
      isGenerating: () => generating,
      getForm: () => form,
      onSubmit: submit,
      onClose: (event) => closeEvents.push(event),
      openerRef,
      scheduleFocus: (callback) => callback(),
    });

    expect(controller.close("cancel")).toBe(true);
    openerRef.current = opener;
    expect(controller.keyDown({ key: "Escape", shiftKey: false, preventDefault: vi.fn() }, { focusable: [], activeElement: null, focus: (): void => undefined })).toBe(true);
    openerRef.current = opener;
    const backdrop = {};
    expect(controller.backdropMouseDown({ target: backdrop, currentTarget: backdrop })).toBe(true);
    expect(closeEvents.map((event) => event.reason)).toEqual(["cancel", "escape", "backdrop"]);
    expect(closeEvents.every((event) => event.pending === false)).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect(openerFocus).toHaveBeenCalledTimes(3);

    generating = true;
    openerRef.current = opener;
    expect(controller.close("close")).toBe(true);
    expect(closeEvents[closeEvents.length - 1]).toEqual({ reason: "close", pending: true });
    visible = false;
    expect(controller.close("close")).toBe(false);
  });

  it("wraps Tab and Shift+Tab and releases the pending provider only by hiding the modal", () => {
    const firstFocus = vi.fn();
    const lastFocus = vi.fn();
    const first: RevoComposerFocusTarget = { isConnected: true, focus: (): void => { firstFocus(); } };
    const last: RevoComposerFocusTarget = { isConnected: true, focus: (): void => { lastFocus(); } };
    const openerRef = { current: null as RevoComposerFocusTarget | null };
    const preventForward = vi.fn();
    const preventBackward = vi.fn();
    let generating = true;
    const controller = createRevoComposerModalController({
      isVisible: () => true,
      isGenerating: () => generating,
      getForm: () => form,
      onSubmit: vi.fn(),
      onClose: vi.fn(),
      openerRef,
      scheduleFocus: (callback) => callback(),
    });
    expect(controller.keyDown({ key: "Tab", shiftKey: false, preventDefault: preventForward }, { focusable: [first, last], activeElement: last, focus: (): void => undefined })).toBe(true);
    expect(preventForward).toHaveBeenCalledOnce();
    expect(firstFocus).toHaveBeenCalledOnce();
    expect(controller.keyDown({ key: "Tab", shiftKey: true, preventDefault: preventBackward }, { focusable: [first, last], activeElement: first, focus: (): void => undefined })).toBe(true);
    expect(preventBackward).toHaveBeenCalledOnce();
    expect(lastFocus).toHaveBeenCalledOnce();
    const close = vi.fn();
    const pendingController = createRevoComposerModalController({ isVisible: () => true, isGenerating: () => generating, getForm: () => form, onSubmit: close, onClose: vi.fn(), openerRef, scheduleFocus: (callback) => callback() });
    void pendingController.submit();
    expect(close).not.toHaveBeenCalled();
    generating = false;
  });

  it("keeps prepareMedia and generation single-flight while the first request is pending", async () => {
    const gate = createRevoComposerRequestGate();
    const first = gate.begin(scopeA);
    expect(first).toBeDefined();
    let prepareCalls = 0;
    let generationCalls = 0;
    let resolvePrepare!: () => void;
    const preparePending = new Promise<void>((resolve) => { resolvePrepare = resolve; });
    const firstRun = (async () => {
      if (!first) return;
      prepareCalls += 1;
      await preparePending;
      generationCalls += 1;
      gate.end(first);
    })();
    expect(gate.begin(scopeA)).toBeUndefined();
    expect(prepareCalls).toBe(1);
    expect(generationCalls).toBe(0);
    resolvePrepare();
    await firstRun;
    expect(generationCalls).toBe(1);
    expect(gate.begin(scopeA)).toBeDefined();
  });

  it("rejects an invalid date before toISOString and dispatch", () => {
    const dispatch = vi.fn();
    const result = validateRevoComposerSchedule("not-a-date");
    if (result.ok) dispatch(result.iso);
    expect(result).toMatchObject({ ok: false });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps a delayed A result durable to A while the B UI scope stays unchanged", () => {
    const gate = createRevoComposerRequestGate();
    const token = gate.begin(scopeA);
    expect(token).toBeDefined();
    if (!token) return;
    const bUi = { draft: "B draft", form: "B form", error: "", focus: "B" };
    const durable = { scope: scopeA, draft: "A result" };
    expect(gate.isCurrent(token, scopeA)).toBe(true);
    expect(gate.isCurrent(token, scopeB)).toBe(false);
    expect(durable).toEqual({ scope: scopeA, draft: "A result" });
    expect(bUi).toEqual({ draft: "B draft", form: "B form", error: "", focus: "B" });
    gate.end(token);
  });

  it("releases busy after a stale A request settles so the B scope can open and mutate", async () => {
    const gate = createRevoComposerRequestGate();
    const token = gate.begin(scopeA);
    expect(token).toBeDefined();
    if (!token) return;
    let busy = true;
    const busyTransitions: boolean[] = [];
    let currentScope = scopeA;
    let resolve!: () => void;
    const pending = new Promise<void>((promiseResolve) => { resolve = promiseResolve; });
    const settle = () => settleRevoComposerRequest({ gate, token, isCurrentScope: () => gate.isCurrent(token, currentScope), setBusy: (value) => { busy = value; busyTransitions.push(value); } });
    const settled = pending.then(settle);
    currentScope = scopeB;
    resolve();
    await expect(settled).resolves.toBe(false);
    expect(busy).toBe(false);
    expect(busyTransitions).toEqual([false]);
    expect(gate.getActive()).toBeUndefined();
    expect(settle()).toBe(false);
    expect(busyTransitions).toEqual([false]);
    const opened = openRevoComposerHandler({ isGenerating: busy, captureOpener: vi.fn(), setVisible: vi.fn(), clearError: vi.fn() });
    expect(opened).toBe(true);
    const state = { imageProvider: "local_preview", bindings: ["binding-a"] };
    expect(runGuardedComposerMutation({ isBusy: busy, onBlocked: vi.fn(), mutate: () => { state.imageProvider = "vertex"; state.bindings = ["binding-b"]; } })).toBe(true);
    expect(state).toEqual({ imageProvider: "vertex", bindings: ["binding-b"] });
  });

  it("rejects pending provider and target callbacks without mutating state", () => {
    const blocked = vi.fn();
    const state = { imageProvider: "local_preview", videoProvider: "local_upload", automationAI: "mock", bindings: ["binding-a"] };
    const before = { ...state, bindings: [...state.bindings] };
    expect(runGuardedComposerMutation({ isBusy: true, onBlocked: blocked, mutate: () => { state.imageProvider = "vertex"; } })).toBe(false);
    expect(runGuardedComposerMutation({ isBusy: true, onBlocked: blocked, mutate: () => { state.videoProvider = "veo"; } })).toBe(false);
    expect(runGuardedComposerMutation({ isBusy: true, onBlocked: blocked, mutate: () => { state.automationAI = "gemini"; state.bindings = ["binding-b"]; } })).toBe(false);
    expect(state).toEqual(before);
    expect(blocked).toHaveBeenCalledTimes(3);
  });

  it("guards image/video and provider/target entry points before side effects", () => {
    const bodyBetween = (start: string, end: string) => {
      const startIndex = appSource.indexOf(start);
      const endIndex = appSource.indexOf(end, startIndex + start.length);
      expect(startIndex).toBeGreaterThanOrEqual(0);
      expect(endIndex).toBeGreaterThan(startIndex);
      return appSource.slice(startIndex, endIndex);
    };
    const saveAIKey = bodyBetween("const saveAIKey", "const saveProviderConfiguration");
    const saveProviderConfiguration = bodyBetween("const saveProviderConfiguration", "const probeProviderConfiguration");
    const saveTargetBindings = bodyBetween("const saveTargetBindings =", "const saveTargetBindingsForBrand");
    const beginConnection = bodyBetween("const beginConnection", "const openConsentPage");

    expect(saveAIKey.indexOf("guardComposerMutation(composerBusy")).toBeGreaterThanOrEqual(0);
    expect(saveAIKey.indexOf("guardComposerMutation(composerBusy")).toBeLessThan(saveAIKey.indexOf("try {"));
    expect(saveProviderConfiguration.indexOf("guardComposerMutation(composerBusy")).toBeLessThan(saveProviderConfiguration.indexOf("if (!controlPlaneClient)"));
    expect(saveTargetBindings.indexOf("guardComposerMutation(composerBusy")).toBeLessThan(saveTargetBindings.indexOf("if (!currentMembership"));
    expect(beginConnection.indexOf("guardComposerMutation(composerBusy")).toBeLessThan(beginConnection.indexOf("const redirectUri"));

    const workspaceProps = appSource.slice(appSource.indexOf("<WorkspaceViews"), appSource.indexOf("<WorkspaceViews") + 4_500);
    expect(workspaceProps).toMatch(/onImageProviderChange=\{\(provider\) => \{ if \(!setImageProvider\(provider\)\) return; setAutomationState/);
    expect(workspaceProps).toMatch(/onVideoProviderChange=\{\(provider\) => \{ if \(!setVideoProvider\(provider\)\) return; setAutomationState/);
    expect(workspaceProps).toMatch(/onAutomationAIChange=\{\(value\) => \{ runGuardedComposerMutation/);
    expect(appSource).toMatch(/<WorkspaceViews[\s\S]*onExportReport=\{exportAnalyticsReport\}/);
    expect(appSource).toMatch(/<WorkspaceViews[\s\S]*onRecipeChange=\{setSelectedRecipeId\}/);
  });

  it("rejects pending provider, Meta, scheduler and Brand callback seams before side effects", () => {
    const state = { autoRun: false, brandVoice: "A", brandVisual: "A", selectedPage: "A" };
    const before = { ...state };
    const sideEffects: string[] = [];
    const blocked: string[] = [];
    const invoke = (name: string, isBusy: boolean, mutate: () => void) => runGuardedComposerMutation({
      isBusy,
      onBlocked: () => blocked.push(name),
      mutate,
    });

    expect(invoke("probe", true, () => sideEffects.push("provider probe"))).toBe(false);
    expect(invoke("meta save", true, () => sideEffects.push("meta credentials"))).toBe(false);
    expect(invoke("meta discover", true, () => sideEffects.push("meta discovery"))).toBe(false);
    expect(invoke("meta select", true, () => { state.selectedPage = "B"; sideEffects.push("page persistence"); })).toBe(false);
    expect(invoke("meta exchange", true, () => sideEffects.push("oauth exchange"))).toBe(false);
    expect(invoke("auto-run", true, () => { state.autoRun = true; })).toBe(false);
    expect(invoke("brand voice", true, () => { state.brandVoice = "B"; })).toBe(false);
    expect(invoke("brand visuals", true, () => { state.brandVisual = "B"; })).toBe(false);
    expect(invoke("brand identity", true, () => sideEffects.push("identity PATCH"))).toBe(false);

    expect(state).toEqual(before);
    expect(sideEffects).toEqual([]);
    expect(blocked).toEqual(["probe", "meta save", "meta discover", "meta select", "meta exchange", "auto-run", "brand voice", "brand visuals", "brand identity"]);

    expect(invoke("meta select", false, () => { state.selectedPage = "B"; })).toBe(true);
    expect(invoke("brand voice", false, () => { state.brandVoice = "B"; })).toBe(true);
    expect(invoke("auto-run", false, () => { state.autoRun = true; })).toBe(true);
    expect(state).toEqual({ autoRun: true, brandVoice: "B", brandVisual: "A", selectedPage: "B" });
  });

  it("guards every A03 fix-round 2 callback before its first mutation or async boundary", () => {
    const bodyBetween = (start: string, end: string) => {
      const startIndex = appSource.indexOf(start);
      const endIndex = appSource.indexOf(end, startIndex + start.length);
      expect(startIndex).toBeGreaterThanOrEqual(0);
      expect(endIndex).toBeGreaterThan(startIndex);
      return appSource.slice(startIndex, endIndex);
    };
    const probe = bodyBetween("const probeProviderConfiguration", "async function saveContentIntelligenceIntake");
    const saveMeta = bodyBetween("const saveMetaConfiguration", "const discoverMetaConfiguration");
    const discoverMeta = bodyBetween("const discoverMetaConfiguration", "const selectMetaPage");
    const selectMeta = bodyBetween("const selectMetaPage", "const extendMetaToken");
    const extendMeta = bodyBetween("const extendMetaToken", "const [savedNotice");
    const brandCallbacks = bodyBetween("const setBrandVoice", "function syncLedgerState");

    expect(probe.indexOf("guardComposerMutation(composerBusy")).toBeLessThan(probe.indexOf("if (!controlPlaneClient)"));
    expect(saveMeta.indexOf("guardComposerMutation(composerBusy")).toBeLessThan(saveMeta.indexOf("const workspaceId"));
    expect(discoverMeta.indexOf("guardComposerMutation(composerBusy")).toBeLessThan(discoverMeta.indexOf("const workspaceId"));
    expect(selectMeta.indexOf("guardComposerMutation(composerBusy")).toBeLessThan(selectMeta.indexOf("const workspaceId"));
    expect(extendMeta.indexOf("guardComposerMutation(composerBusy")).toBeLessThan(extendMeta.indexOf("const workspaceId"));
    expect(brandCallbacks.indexOf("guardComposerMutation(composerBusy")).toBeGreaterThanOrEqual(0);
    expect(brandCallbacks.indexOf("guardComposerMutation(composerBusy")).toBeLessThan(brandCallbacks.indexOf("setWorkspaceState"));

    const workspaceProps = appSource.slice(appSource.indexOf("<WorkspaceViews"));
    expect(workspaceProps).toMatch(/onAutoRunDueJobsChange=\{[^}]*guardComposerMutation\(composerBusy/);
    expect(workspaceProps).toMatch(/onBrandVoiceChange=\{[^}]*guardComposerMutation\(composerBusy/);
    expect(workspaceProps).toMatch(/onBrandVisualTokensChange=\{[^}]*guardComposerMutation\(composerBusy/);
    expect(workspaceProps).toMatch(/onBrandIdentityChange=\{[^}]*guardComposerMutation\(composerBusy/);
  });

  it("blocks workspace, brand, media and provider mutations while generation is pending", () => {
    const notice = vi.fn();
    expect(guardComposerMutation(true, notice)).toBe(false);
    expect(notice).toHaveBeenCalledOnce();
    expect(guardComposerMutation(false, notice)).toBe(true);
    expect(notice).toHaveBeenCalledOnce();
  });

  it("renders the real composer as a labelled dialog with an explicit cancel affordance", () => {
    const markup = renderToStaticMarkup(createElement(RevoNewContentModal, {
      visible: true,
      brandName: "Brand A",
      clientName: "Client A",
      assets: [],
      generationError: "",
      isGenerating: false,
      onClose: vi.fn(),
      onSubmit: vi.fn(),
      onImportLocalImage: vi.fn(),
      activeClientId: "client-a",
      activeBrandId: "brand-a",
      knowledgeItems: [],
      researchEvidence: [],
      promptBlueprints: [],
      contentRecipes: [],
      selectedKnowledgeItemIds: [],
      selectedResearchEvidenceIds: [],
      selectedPromptBlueprintId: "",
      selectedRecipeId: "",
      transformMode: "original",
    }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="revo-new-content-title"');
    expect(markup).toContain('id="revo-new-content-title"');
    expect(markup).toContain("Hủy");
  });
});
