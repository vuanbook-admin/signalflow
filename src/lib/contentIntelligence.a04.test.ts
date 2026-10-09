import { describe, expect, it } from "vitest";
import { acknowledgeResearchEvidenceApproval, captureContentIntelligenceLineage, contentIntelligenceLineageFields, validateContentIntelligenceSelection, buildContentIntelligenceContext, type KnowledgeItem, type PromptBlueprint, type ResearchEvidence } from "./contentIntelligence";
import { restoreContentRunLineage } from "./draftConversion";
import type { AIGenerationRequest } from "./mvpContracts";
import type { ContentRecipe } from "./contentRecipe";
import { summarizeContentIntelligenceSelection } from "../RevoContentStudio";
import { dispatchContentIntelligenceRun } from "./contentIntelligenceDispatch";

const scope = { clientId: "client-a", brandId: "brand-a" };
const knowledge: KnowledgeItem = { id: "knowledge-approved-a", clientId: "client-a", brandId: "brand-a", kind: "product_fact", title: "Approved fact", contentHash: "a".repeat(64), provenance: "owner document", rightsState: "user_owned", reviewState: "approved", text: "Approved product fact", sourceUpdatedAt: "2026-09-14T00:00:00Z", archiveState: "active" };
const evidence: ResearchEvidence[] = [
  { id: "evidence-approved-a", clientId: "client-a", brandId: "brand-a", sourceUrl: "https://example.test/brand", sourceTitle: "Brand research", retrievedAt: "2026-09-14T00:00:00Z", summary: "Approved brand evidence", rightsState: "licensed", reviewState: "approved" },
  { id: "evidence-client-a", clientId: "client-a", brandId: null, sourceUrl: "https://example.test/client", sourceTitle: "Client research", retrievedAt: "2026-09-14T00:00:00Z", summary: "Approved client evidence", rightsState: "user_owned", reviewState: "approved" },
  { id: "evidence-pending-a", clientId: "client-a", brandId: "brand-a", sourceUrl: "https://example.test/pending", sourceTitle: "Pending evidence", retrievedAt: "2026-09-14T00:00:00Z", summary: "Awaiting ACK", rightsState: "licensed", reviewState: "pending" },
];
const blueprint: PromptBlueprint = { id: "blueprint-a", brandId: "brand-a", kind: "caption", template: "Use approved facts only.", version: 7, status: "active" };
const recipe: ContentRecipe = { id: "recipe-a", brandId: "brand-a", name: "Education flow", platforms: ["facebook"], contentKinds: ["text"], hookGuidance: "Open with tension.", structureGuidance: "Context then action.", ctaGuidance: "Invite a save.", qualityChecklist: ["Claims have a source"], status: "active" };

describe("A04 Content Intelligence lineage fixture", () => {
  it("keeps panel summary and prompt builder on the exact same eligible IDs", () => {
    const selectedKnowledgeItemIds = [knowledge.id];
    const selectedResearchEvidenceIds = [evidence[0]!.id, evidence[1]!.id];
    const input = { scope, knowledgeItems: [knowledge], selectedKnowledgeItemIds, researchEvidence: evidence, selectedResearchEvidenceIds, promptBlueprints: [blueprint], selectedPromptBlueprintId: blueprint.id, contentRecipes: [recipe], selectedRecipeId: recipe.id };
    const validation = validateContentIntelligenceSelection(input);
    expect(validation).toMatchObject({ ok: true, selectedKnowledgeItems: [knowledge], selectedResearchEvidence: [evidence[0], evidence[1]], selectedPromptBlueprint: blueprint, selectedRecipe: recipe });
    const summary = summarizeContentIntelligenceSelection({ clientId: scope.clientId, brandId: scope.brandId, knowledgeItems: [knowledge], researchEvidence: evidence, promptBlueprints: [blueprint], contentRecipes: [recipe], selectedKnowledgeItemIds, selectedResearchEvidenceIds, selectedPromptBlueprintId: blueprint.id, selectedRecipeId: recipe.id, transformMode: "repurpose" });
    expect(summary.knowledgeItems.map((item) => item.id)).toEqual(selectedKnowledgeItemIds);
    expect(summary.researchEvidence.map((item) => item.id)).toEqual(selectedResearchEvidenceIds);
    const context = buildContentIntelligenceContext({ clientId: scope.clientId, brandId: scope.brandId, identityVersionId: "identity-a-v1", knowledgeItems: [knowledge], selectedKnowledgeItemIds, researchEvidence: evidence, selectedResearchEvidenceIds, promptBlueprint: blueprint, recipe, userBrief: "Fixture topic", transformMode: "repurpose" });
    expect(context).toMatchObject({ ok: true, sourceMetadata: [{ id: knowledge.id }, { id: evidence[0]!.id }, { id: evidence[1]!.id }] });
  });

  it("blocks stale, pending and malformed selections before a recording gateway call", () => {
    const invalid = validateContentIntelligenceSelection({ scope, knowledgeItems: [knowledge], selectedKnowledgeItemIds: [knowledge.id, "knowledge-stale-a"], researchEvidence: evidence, selectedResearchEvidenceIds: ["evidence-pending-a"], promptBlueprints: [blueprint], selectedPromptBlueprintId: "blueprint-stale-a", contentRecipes: [recipe], selectedRecipeId: "recipe-stale-a" });
    expect(invalid.ok).toBe(false);
    expect(invalid.issues.map((issue) => `${issue.id}:${issue.code}`)).toEqual(expect.arrayContaining(["knowledge-stale-a:KNOWLEDGE_SELECTION_STALE", "evidence-pending-a:RESEARCH_REVIEW_PENDING", "blueprint-stale-a:PROMPT_BLUEPRINT_SELECTION_STALE", "recipe-stale-a:RECIPE_SELECTION_STALE"]));
    const blocked = buildContentIntelligenceContext({ clientId: scope.clientId, brandId: scope.brandId, identityVersionId: "identity-a-v1", knowledgeItems: [knowledge], selectedKnowledgeItemIds: [knowledge.id], researchEvidence: evidence, selectedResearchEvidenceIds: ["evidence-pending-a"], promptBlueprint: blueprint, recipe, userBrief: "Fixture topic", transformMode: "repurpose" });
    expect(blocked).toEqual({ ok: false, code: "RIGHTS_OR_REVIEW_BLOCKED" });
    const requests: unknown[] = [];
    if (blocked.ok) requests.push(blocked.context);
    expect(requests).toHaveLength(0);
  });

  it("accepts pending evidence only after the exact approved ACK", () => {
    const pending = evidence[2]!;
    const mismatched = acknowledgeResearchEvidenceApproval([pending], pending, { id: "evidence-other", reviewState: "approved" });
    expect(mismatched[0]!.reviewState).toBe("pending");
    const approved = acknowledgeResearchEvidenceApproval([pending], pending, { id: pending.id, reviewState: "approved" });
    expect(approved[0]!.reviewState).toBe("approved");
    const eligible = validateContentIntelligenceSelection({ scope, knowledgeItems: [knowledge], selectedKnowledgeItemIds: [], researchEvidence: approved, selectedResearchEvidenceIds: [pending.id], promptBlueprints: [blueprint], selectedPromptBlueprintId: blueprint.id, contentRecipes: [recipe], selectedRecipeId: recipe.id });
    expect(eligible.ok).toBe(true);
  });

  it("captures immutable lineage immediately before dispatch and preserves exact arrays", async () => {
    const selectedKnowledgeItemIds = [knowledge.id];
    const selectedResearchEvidenceIds = [evidence[0]!.id, evidence[1]!.id];
    const customerFacts = ["Topic: Fixture topic", "Customer supplied fact"];
    const lineage = captureContentIntelligenceLineage({ selectedKnowledgeItemIds, selectedResearchEvidenceIds, selectedPromptBlueprintId: blueprint.id, selectedPromptBlueprintVersion: blueprint.version, selectedRecipeId: recipe.id, transformMode: "repurpose", mediaSetFingerprint: "b".repeat(64), customerFacts });
    selectedKnowledgeItemIds.push("knowledge-mutated-after-capture");
    selectedResearchEvidenceIds.reverse();
    customerFacts.push("mutated after capture");
    expect(lineage.selectedKnowledgeItemIds).toEqual([knowledge.id]);
    expect(lineage.selectedResearchEvidenceIds).toEqual([evidence[0]!.id, evidence[1]!.id]);
    expect(lineage.customerFacts).toEqual(["Topic: Fixture topic", "Customer supplied fact"]);
    expect(Object.isFrozen(lineage)).toBe(true);
    const requests: Array<{ prompt: string; metadata: Record<string, unknown> }> = [];
    const recordingGateway = { generate: async (request: { prompt: string; metadata: Record<string, unknown> }) => { requests.push(request); return { traceId: "recording-a04", provider: "recording", variants: [] }; } };
    await recordingGateway.generate({ prompt: "Fixture prompt", metadata: { ...contentIntelligenceLineageFields(lineage), prompt: "Fixture prompt" } });
    expect(requests[0]?.prompt).toBe("Fixture prompt");
    expect(requests[0]?.metadata.contentIntelligenceLineage).toBe(lineage);
    expect(requests[0]?.metadata.selectedKnowledgeItemIds).toEqual([knowledge.id]);
    expect(requests[0]?.metadata.selectedResearchEvidenceIds).toEqual([evidence[0]!.id, evidence[1]!.id]);
    expect(requests[0]?.metadata.selectedPromptBlueprintVersion).toBe(7);
    expect(requests[0]?.metadata.selectedRecipeId).toBe("recipe-a");
    expect(requests[0]?.metadata.transformMode).toBe("repurpose");
    expect(requests[0]?.metadata.mediaSetFingerprint).toBe("b".repeat(64));
    expect(requests[0]?.metadata.customerFacts).toEqual(["Topic: Fixture topic", "Customer supplied fact"]);
  });
});

describe("A04 production dispatch fixture", () => {
  const positiveKnowledge = knowledge;
  const positiveEvidence = evidence.filter((item) => item.reviewState === "approved");
  const allKnowledge: KnowledgeItem[] = [
    positiveKnowledge,
    { ...positiveKnowledge, id: "knowledge-archived-a", archiveState: "archived" },
    { ...positiveKnowledge, id: "knowledge-whitespace-a", title: "   ", provenance: "  " },
    { ...positiveKnowledge, id: "knowledge-missing-text-a", text: "" },
    { ...positiveKnowledge, id: "knowledge-missing-hash-a", contentHash: "invalid" },
    { ...positiveKnowledge, id: "knowledge-brand-b-same-client", brandId: "brand-b" },
    { ...positiveKnowledge, id: "knowledge-cross-client", clientId: "client-b" },
  ];
  const allEvidence: ResearchEvidence[] = [
    ...positiveEvidence,
    { ...evidence[2]!, id: "evidence-pending-a" },
    { ...positiveEvidence[0]!, id: "evidence-no-summary-a", summary: "" },
    { ...positiveEvidence[0]!, id: "evidence-brand-b-same-client", brandId: "brand-b" },
  ];

  function request(): Parameters<typeof dispatchContentIntelligenceRun>[0]["request"] {
    return { workspaceId: "client-a", prompt: "", targetPlatforms: ["facebook"], contentKinds: ["text"], brandSystem: { workspaceId: "client-a", voice: "clear", audience: "customers", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "system" } }, metadata: {} };
  }

  function recordingFixture() {
    const calls: Array<{ prompt: string; metadata: Record<string, unknown> }> = [];
    const durable = new Map<string, Record<string, unknown>>();
    const gateway = { generate: async (input: AIGenerationRequest) => { calls.push({ prompt: input.prompt, metadata: input.metadata ?? {} }); return { traceId: `recording-${calls.length}`, provider: "mock" as const, variants: [{ platform: "facebook" as const, kind: "text" as const, title: "Fixture title", body: "Fixture generated body", caption: "Fixture generated body", contentPillar: "Education", objective: "Engagement", cta: "Save", hashtags: [], seoKeywords: [], scheduledAt: "", sources: [], notes: "", metadata: {} }], safetyNotes: ["Recording gateway fixture"] }; } };
    const transport = {
      createContentRun: async (payload: Record<string, unknown>) => {
        const parentId = typeof payload.parentContentRunId === "string" ? payload.parentContentRunId : undefined;
        if (parentId) {
          const parent = durable.get(parentId);
          if (!parent || JSON.stringify(parent.contentIntelligenceLineage) !== JSON.stringify(payload.contentIntelligenceLineage)) throw new Error("CONTENT_RUN_PARENT_LINEAGE_MISMATCH");
          if (parent.planId !== payload.planId) throw new Error("CONTENT_RUN_PARENT_PLAN_MISMATCH");
        }
        durable.set(String(payload.id), JSON.parse(JSON.stringify(payload)) as Record<string, unknown>);
      },
      updateContentRun: async (id: string, payload: Record<string, unknown>) => { durable.set(id, { ...(durable.get(id) ?? {}), ...JSON.parse(JSON.stringify(payload)) as Record<string, unknown> }); },
    };
    return { calls, durable, gateway, transport };
  }

  function inputFor(fixture: ReturnType<typeof recordingFixture>, overrides: Partial<Parameters<typeof dispatchContentIntelligenceRun>[0]> = {}): Parameters<typeof dispatchContentIntelligenceRun>[0] {
    return {
      runId: "run-a04-production",
      identityVersionId: "identity-a-v1",
      userBrief: "Fixture topic",
      selectedKnowledgeItemIds: [positiveKnowledge.id],
      selectedResearchEvidenceIds: [positiveEvidence[0]!.id, positiveEvidence[1]!.id],
      knowledgeItems: allKnowledge,
      researchEvidence: allEvidence,
      promptBlueprints: [blueprint],
      selectedPromptBlueprintId: blueprint.id,
      contentRecipes: [recipe],
      selectedRecipeId: recipe.id,
      clientId: scope.clientId,
      brandId: scope.brandId,
      transformMode: "repurpose",
      mediaSetFingerprint: "c".repeat(64),
      customerFacts: ["Topic: Fixture topic", "Customer supplied fact"],
      promptBuilder: (context) => `Identity fixture\n\n${context}\n\nTopic: Fixture topic`,
      request: request(),
      gateway: fixture.gateway,
      transport: fixture.transport,
      createPayload: { clientId: scope.clientId, brandId: scope.brandId, identityVersionId: "identity-a-v1", executionMode: "subscription_package", planId: "plan-a", promptVersion: "blueprint-a:v7", state: "needs_review" },
      completionPayload: (result, lineage, prompt) => ({ prompt, providerTraceId: result.traceId, state: "needs_review", approvalState: "pending", qualityStatus: "pending", variants: [{ id: "variant-production", platform: "facebook", kind: "text", title: "Fixture title", body: result.variants[0]?.body ?? "", caption: result.variants[0]?.body ?? "", mediaAssetIds: [], metadata: { contentIntelligenceLineage: lineage } }] }),
      ...overrides,
    };
  }

  it("runs the production seam through prompt, recording gateway, CP create/completion, reload and rewrite", async () => {
    const fixture = recordingFixture();
    let captureCount = 0;
    const first = await dispatchContentIntelligenceRun(inputFor(fixture, { onLineageCaptured: () => { captureCount += 1; } }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]!.prompt).toContain("Knowledge knowledge-approved-a");
    expect(fixture.calls[0]!.metadata.contentIntelligenceLineage).toBe(first.lineage);
    expect(first.createPayload.contentIntelligenceLineage).toBe(first.lineage);
    expect(first.completionPayload?.contentIntelligenceLineage).toBe(first.lineage);
    expect(captureCount).toBe(1);
    expect(first.request.metadata?.selectedKnowledgeItemIds).toEqual(["knowledge-approved-a"]);
    expect(first.request.metadata?.selectedResearchEvidenceIds).toEqual(["evidence-approved-a", "evidence-client-a"]);
    expect(first.request.metadata?.selectedPromptBlueprintVersion).toBe(7);
    expect(first.request.metadata?.selectedRecipeId).toBe("recipe-a");
    expect(first.request.metadata?.transformMode).toBe("repurpose");
    expect(first.request.metadata?.mediaSetFingerprint).toBe("c".repeat(64));
    expect(first.request.metadata?.customerFacts).toEqual(["Topic: Fixture topic", "Customer supplied fact"]);
    const saved = fixture.durable.get("run-a04-production");
    expect(saved?.prompt).toBe(first.prompt);
    expect(saved?.selectedKnowledgeItemIds).toEqual(["knowledge-approved-a"]);
    expect(saved?.selectedResearchEvidenceIds).toEqual(["evidence-approved-a", "evidence-client-a"]);
    const restored = restoreContentRunLineage(saved);
    expect(restored?.ok).toBe(true);
    if (!restored?.ok) return;
    expect(restored.value.selectedKnowledgeItemIds).toEqual(["knowledge-approved-a"]);
    expect(restored.value.selectedResearchEvidenceIds).toEqual(["evidence-approved-a", "evidence-client-a"]);
    expect(restored.value.promptBlueprintVersion).toBe(7);
    expect(restored.value.recipeId).toBe("recipe-a");
    expect(restored.value.transformMode).toBe("repurpose");
    expect(restored.value.mediaSetFingerprint).toBe("c".repeat(64));
    const currentAppSelection = ["knowledge-current-ui", "evidence-current-ui"];
    expect(restored.value.selectedKnowledgeItemIds).not.toEqual(currentAppSelection);
    const rewrite = await dispatchContentIntelligenceRun(inputFor(fixture, { runId: "run-a04-production-rewrite", selectedKnowledgeItemIds: restored.value.selectedKnowledgeItemIds!, selectedResearchEvidenceIds: restored.value.selectedResearchEvidenceIds!, selectedPromptBlueprintId: restored.value.selectedPromptBlueprintId, selectedRecipeId: restored.value.recipeId, mediaSetFingerprint: restored.value.mediaSetFingerprint, customerFacts: restored.value.customerFacts, createPayload: { clientId: scope.clientId, brandId: scope.brandId, identityVersionId: "identity-a-v1", executionMode: "subscription_package", planId: "plan-a", parentContentRunId: "run-a04-production", parentRevisionId: "revision-parent", revisionId: "revision-child", state: "needs_review" } }));
    expect(rewrite.ok).toBe(true);
    if (!rewrite.ok) return;
    expect(fixture.calls).toHaveLength(2);
    expect(rewrite.lineage.selectedKnowledgeItemIds).toEqual(first.lineage.selectedKnowledgeItemIds);
    expect(rewrite.lineage.selectedResearchEvidenceIds).toEqual(first.lineage.selectedResearchEvidenceIds);
    expect(rewrite.lineage.mediaSetFingerprint).toBe(first.lineage.mediaSetFingerprint);
    expect(fixture.durable.get("run-a04-production")?.prompt).toBe(first.prompt);
    expect(fixture.durable.get("run-a04-production-rewrite")?.selectedKnowledgeItemIds).toEqual(["knowledge-approved-a"]);
    expect(fixture.durable.get("run-a04-production-rewrite")?.state).toBe("needs_review");
    expect(fixture.durable.get("run-a04-production-rewrite")?.approvalState).toBe("pending");
    await expect(dispatchContentIntelligenceRun(inputFor(fixture, { runId: "run-a04-production-bad-lineage", selectedKnowledgeItemIds: ["knowledge-approved-a"], selectedResearchEvidenceIds: ["evidence-client-a"], createPayload: { clientId: scope.clientId, brandId: scope.brandId, identityVersionId: "identity-a-v1", executionMode: "subscription_package", planId: "plan-a", parentContentRunId: "run-a04-production", state: "needs_review" } }))).rejects.toThrow("CONTENT_RUN_PARENT_LINEAGE_MISMATCH");
    await expect(dispatchContentIntelligenceRun(inputFor(fixture, { runId: "run-a04-production-bad-plan", createPayload: { clientId: scope.clientId, brandId: scope.brandId, identityVersionId: "identity-a-v1", executionMode: "subscription_package", planId: "plan-b", parentContentRunId: "run-a04-production", state: "needs_review" } }))).rejects.toThrow("CONTENT_RUN_PARENT_PLAN_MISMATCH");
    expect(fixture.calls).toHaveLength(2);
  });

  it("executes every named negative control with a repair reason and zero gateway requests", async () => {
    const cases: Array<{ id: string; input: Partial<Parameters<typeof dispatchContentIntelligenceRun>[0]>; code: string }> = [
      { id: "knowledge-archived-a", input: { selectedKnowledgeItemIds: ["knowledge-archived-a"] }, code: "KNOWLEDGE_ARCHIVED" },
      { id: "knowledge-whitespace-a", input: { selectedKnowledgeItemIds: ["knowledge-whitespace-a"] }, code: "KNOWLEDGE_TITLE_MISSING" },
      { id: "knowledge-missing-text-a", input: { selectedKnowledgeItemIds: ["knowledge-missing-text-a"] }, code: "KNOWLEDGE_TEXT_MISSING" },
      { id: "knowledge-missing-hash-a", input: { selectedKnowledgeItemIds: ["knowledge-missing-hash-a"] }, code: "KNOWLEDGE_CONTENT_HASH_INVALID" },
      { id: "evidence-pending-a", input: { selectedKnowledgeItemIds: [], selectedResearchEvidenceIds: ["evidence-pending-a"] }, code: "RESEARCH_REVIEW_PENDING" },
      { id: "evidence-no-summary-a", input: { selectedKnowledgeItemIds: [], selectedResearchEvidenceIds: ["evidence-no-summary-a"] }, code: "RESEARCH_REQUIRED_FIELD_MISSING" },
      { id: "knowledge-brand-b-same-client", input: { selectedKnowledgeItemIds: ["knowledge-brand-b-same-client"] }, code: "KNOWLEDGE_SCOPE_MISMATCH" },
      { id: "knowledge-cross-client", input: { selectedKnowledgeItemIds: ["knowledge-cross-client"] }, code: "KNOWLEDGE_SCOPE_MISMATCH" },
      { id: "evidence-brand-b-same-client", input: { selectedKnowledgeItemIds: [], selectedResearchEvidenceIds: ["evidence-brand-b-same-client"] }, code: "RESEARCH_SCOPE_MISMATCH" },
      { id: "knowledge-stale-a", input: { selectedKnowledgeItemIds: ["knowledge-stale-a"] }, code: "KNOWLEDGE_SELECTION_STALE" },
      { id: "evidence-stale-a", input: { selectedKnowledgeItemIds: [], selectedResearchEvidenceIds: ["evidence-stale-a"] }, code: "RESEARCH_SELECTION_STALE" },
      { id: "blueprint-stale-a", input: { selectedPromptBlueprintId: "blueprint-stale-a" }, code: "PROMPT_BLUEPRINT_SELECTION_STALE" },
      { id: "recipe-stale-a", input: { selectedRecipeId: "recipe-stale-a" }, code: "RECIPE_SELECTION_STALE" },
    ];
    for (const negative of cases) {
      const fixture = recordingFixture();
      const result = await dispatchContentIntelligenceRun(inputFor(fixture, negative.input));
      expect(result.ok, negative.id).toBe(false);
      if (result.ok) continue;
      expect(result.gatewayRequestCount, negative.id).toBe(0);
      expect(result.issues.some((issue) => issue.id === negative.id && issue.code === negative.code), negative.id).toBe(true);
      expect(fixture.calls, negative.id).toHaveLength(0);
    }
  });

  it("uses the same A04 dispatch seam for an automatic run before CP create", async () => {
    const fixture = recordingFixture();
    const events: string[] = [];
    const created: Record<string, unknown>[] = [];
    const result = await dispatchContentIntelligenceRun(inputFor(fixture, {
      createPayload: { clientId: scope.clientId, brandId: scope.brandId, identityVersionId: "identity-a-v1", executionMode: "subscription_package", trigger: "automation", planId: "plan-a" },
      gateway: { generate: async (request) => { events.push("gateway"); return fixture.gateway.generate(request); } },
      transport: { createContentRun: async (payload) => { events.push("create"); created.push(payload); return fixture.transport.createContentRun(payload); }, updateContentRun: fixture.transport.updateContentRun },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(events).toEqual(["create", "gateway"]);
    expect(created[0]?.trigger).toBe("automation");
    expect(created[0]?.contentIntelligenceLineage).toBe(result.lineage);
    expect(result.request.metadata?.contentIntelligenceLineage).toBe(result.lineage);
    expect(result.request.metadata?.selectedPromptBlueprintVersion).toBe(7);
    expect(result.request.metadata?.selectedRecipeId).toBe("recipe-a");
    const blockedEvents: string[] = [];
    const blocked = await dispatchContentIntelligenceRun(inputFor(recordingFixture(), { selectedPromptBlueprintId: undefined, gateway: { generate: async () => { blockedEvents.push("gateway"); return { traceId: "should-not-run", provider: "mock", variants: [], safetyNotes: [] }; } }, transport: { createContentRun: async () => { blockedEvents.push("create"); }, updateContentRun: async () => undefined } }));
    expect(blocked.ok).toBe(false);
    expect(blockedEvents).toEqual([]);
  });
});
