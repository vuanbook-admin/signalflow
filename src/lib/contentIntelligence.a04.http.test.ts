// @ts-nocheck
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControlPlaneClient } from "./controlPlane";
import { dispatchContentIntelligenceRun } from "./contentIntelligenceDispatch";
import { restoreContentRunLineage, draftToContentVariant } from "./draftConversion";

const scope = { clientId: "client-a", brandId: "brand-a" };
const knowledge = { id: "knowledge-approved-a", clientId: "client-a", brandId: "brand-a", kind: "product_fact", title: "Approved fact", contentHash: "a".repeat(64), provenance: "owner document", rightsState: "user_owned", reviewState: "approved", text: "Approved product fact", sourceUpdatedAt: "2026-09-14T00:00:00Z", archiveState: "active" };
const evidence = { id: "evidence-approved-a", clientId: "client-a", brandId: "brand-a", sourceUrl: "https://example.test/brand", sourceTitle: "Brand research", retrievedAt: "2026-09-14T00:00:00Z", summary: "Approved brand evidence", rightsState: "licensed", reviewState: "approved" };
const clientEvidence = { id: "evidence-client-a", clientId: "client-a", brandId: null, sourceUrl: "https://example.test/client", sourceTitle: "Client research", retrievedAt: "2026-09-14T00:00:00Z", summary: "Approved client evidence", rightsState: "user_owned", reviewState: "approved" };
const blueprint = { id: "blueprint-a", brandId: "brand-a", kind: "caption", template: "Use approved facts only.", version: 7, status: "active" };
const recipe = { id: "recipe-a", brandId: "brand-a", name: "Education flow", platforms: ["facebook"], contentKinds: ["text"], hookGuidance: "Open with tension.", structureGuidance: "Context then action.", ctaGuidance: "Invite a save.", qualityChecklist: ["Claims have a source"], status: "active" };
const lineageFacts = ["Topic: Durable HTTP fixture", "Customer supplied fact"];

async function startControlPlane(dbPath) {
  const database = new DatabaseSync(dbPath);
  database.exec("CREATE TABLE IF NOT EXISTS content_runs (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)");
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const json = (status, value) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); };
    if (url.pathname === "/health") return json(200, { ok: true });
    const body = async () => { let raw = ""; for await (const chunk of request) raw += chunk; return raw ? JSON.parse(raw) : {}; };
    try {
      if (url.pathname === "/v1/agency/content-runs" && request.method === "POST") {
        const payload = await body();
        database.prepare("INSERT INTO content_runs(id, payload_json) VALUES (?, ?)").run(String(payload.id), JSON.stringify(payload));
        return json(200, payload);
      }
      if (url.pathname === "/v1/agency/content-runs" && request.method === "GET") {
        const rows = database.prepare("SELECT payload_json FROM content_runs ORDER BY id").all().map((row) => JSON.parse(row.payload_json));
        return json(200, rows.filter((row) => (!url.searchParams.get("clientId") || row.clientId === url.searchParams.get("clientId")) && (!url.searchParams.get("brandId") || row.brandId === url.searchParams.get("brandId"))));
      }
      const match = url.pathname.match(/^\/v1\/agency\/content-runs\/([^/]+)$/);
      if (match && request.method === "PATCH") {
        const id = decodeURIComponent(match[1]);
        const current = database.prepare("SELECT payload_json FROM content_runs WHERE id = ?").get(id);
        if (!current) return json(404, { detail: { code: "CONTENT_RUN_MISSING" } });
        const payload = { ...JSON.parse(current.payload_json), ...(await body()) };
        database.prepare("UPDATE content_runs SET payload_json = ? WHERE id = ?").run(JSON.stringify(payload), id);
        return json(200, payload);
      }
      return json(404, { detail: { code: "NOT_FOUND" } });
    } catch (error) {
      return json(400, { detail: { code: error?.message || "LOCAL_CP_ERROR" } });
    }
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { client: new ControlPlaneClient(baseUrl, { fetchImpl: fetch }), stop: async () => { await new Promise((resolvePromise) => server.close(resolvePromise)); database.close(); } };
}

function inputFor(client, gateway, runId, overrides = {}) {
  const request = { workspaceId: scope.clientId, prompt: "placeholder", targetPlatforms: ["facebook"], contentKinds: ["text"], brandSystem: { workspaceId: scope.clientId, voice: "clear", audience: "customers", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "system" } }, metadata: {} };
  return {
    runId,
    identityVersionId: "identity-a-v1",
    userBrief: "Durable HTTP fixture",
    selectedKnowledgeItemIds: [knowledge.id],
    selectedResearchEvidenceIds: [evidence.id, clientEvidence.id],
    knowledgeItems: [knowledge],
    researchEvidence: [evidence, clientEvidence],
    promptBlueprints: [blueprint],
    selectedPromptBlueprintId: blueprint.id,
    contentRecipes: [recipe],
    selectedRecipeId: recipe.id,
    clientId: scope.clientId,
    brandId: scope.brandId,
    transformMode: "repurpose",
    mediaSetFingerprint: "d".repeat(64),
    customerFacts: lineageFacts,
    promptBuilder: (context) => `HTTP production prompt\n${context}\nBrief: Durable HTTP fixture`,
    request,
    gateway,
    transport: { createContentRun: (payload) => client.createAgencyRecord("content-runs", payload), updateContentRun: (id, payload) => client.updateAgencyEntity("content-runs", id, payload) },
    createPayload: { clientId: scope.clientId, brandId: scope.brandId, identityVersionId: "identity-a-v1", executionMode: "subscription_package", planId: "plan-a", promptVersion: "blueprint-a:v7", revisionId: runId === "run-a04-http" ? "revision-parent" : "revision-child", state: "needs_review" },
    completionPayload: (result, lineage, prompt) => ({ prompt, providerTraceId: result.traceId, state: "needs_review", approvalState: "pending", qualityStatus: "pending", variants: [{ id: runId === "run-a04-http" ? "variant-a04-http" : "variant-a04-http-child", platform: "facebook", kind: "text", title: "HTTP fixture", body: result.variants[0]?.body ?? "", caption: result.variants[0]?.body ?? "", mediaAssetIds: [], metadata: { contentIntelligenceLineage: lineage } }] }),
    ...overrides,
  };
}

describe("A04 production HTTP Control Plane fixture", () => {
  it("persists, restarts, converts and rewrites the same lineage through local HTTP/SQLite CP transport", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "signalflow-a04-http-"));
    const dbPath = join(temporaryDirectory, "control-plane.sqlite3");
    const calls = [];
    const gateway = { generate: async (request) => { calls.push(request); return { traceId: `http-recording-${calls.length}`, provider: "mock", variants: [{ platform: "facebook", kind: "text", title: "HTTP fixture", body: "Durable HTTP generated body", caption: "Durable HTTP generated body", contentPillar: "Education", objective: "Engagement", cta: "Save", hashtags: [], seoKeywords: [], scheduledAt: "", sources: [], notes: "", metadata: {} }], safetyNotes: ["Local recording gateway"] }; } };
    let server = await startControlPlane(dbPath);
    try {
      const first = await dispatchContentIntelligenceRun(inputFor(server.client, gateway, "run-a04-http"));
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(calls).toHaveLength(1);
      const firstPrompt = first.prompt;
      expect(calls[0].prompt).toBe(firstPrompt);
      const firstSaved = await server.client.listAgencyRecords("content-runs", scope);
      expect(firstSaved).toHaveLength(1);
      expect(firstSaved[0].prompt).toBe(firstPrompt);
      expect(firstSaved[0].revisionId).toBe("revision-parent");
      expect(firstSaved[0].contentIntelligenceLineage).toEqual({ selectedKnowledgeItemIds: [knowledge.id], selectedResearchEvidenceIds: [evidence.id, clientEvidence.id], selectedPromptBlueprintId: blueprint.id, selectedPromptBlueprintVersion: 7, selectedRecipeId: recipe.id, transformMode: "repurpose", mediaSetFingerprint: "d".repeat(64), customerFacts: lineageFacts });
      await server.stop();
      server = await startControlPlane(dbPath);
      const reloaded = (await server.client.listAgencyRecords("content-runs", scope))[0];
      expect(reloaded.prompt).toBe(firstPrompt);
      const restored = restoreContentRunLineage(reloaded, "variant-a04-http");
      expect(restored?.ok).toBe(true);
      if (!restored?.ok) return;
      const changedCurrentAppSelection = ["knowledge-current-ui", "evidence-current-ui"];
      expect(restored.value.selectedKnowledgeItemIds).toEqual([knowledge.id]);
      expect(restored.value.selectedResearchEvidenceIds).toEqual([evidence.id, clientEvidence.id]);
      expect(restored.value.selectedKnowledgeItemIds).not.toEqual(changedCurrentAppSelection);
      const restoredVariant = draftToContentVariant({ id: 404, title: "HTTP fixture", platform: "Facebook", contentKind: "text", body: "Durable HTTP generated body", ...restored.value });
      expect(restoredVariant.metadata.contentIntelligenceLineage).toEqual(first.lineage);
      expect(restoredVariant.metadata.selectedResearchEvidenceIds).toEqual([evidence.id, clientEvidence.id]);
      expect(restoredVariant.metadata.prompt).toBe(firstPrompt);
      const rewrite = await dispatchContentIntelligenceRun(inputFor(server.client, gateway, "run-a04-http-rewrite", { selectedKnowledgeItemIds: [...restored.value.selectedKnowledgeItemIds], selectedResearchEvidenceIds: [...restored.value.selectedResearchEvidenceIds], selectedPromptBlueprintId: restored.value.selectedPromptBlueprintId, selectedRecipeId: restored.value.recipeId, transformMode: restored.value.transformMode, mediaSetFingerprint: restored.value.mediaSetFingerprint, customerFacts: [...restored.value.customerFacts], createPayload: { clientId: scope.clientId, brandId: scope.brandId, identityVersionId: "identity-a-v1", executionMode: "subscription_package", planId: "plan-a", parentContentRunId: "run-a04-http", parentRevisionId: "revision-parent", revisionId: "revision-child", state: "needs_review", approvalState: "pending", qualityStatus: "pending" }, promptBuilder: (context) => `HTTP rewrite prompt\n${context}\nBrief: Durable HTTP fixture` }));
      expect(rewrite.ok).toBe(true);
      if (!rewrite.ok) return;
      expect(calls).toHaveLength(2);
      expect(rewrite.lineage.selectedKnowledgeItemIds).toEqual(first.lineage.selectedKnowledgeItemIds);
      expect(rewrite.lineage.selectedResearchEvidenceIds).toEqual(first.lineage.selectedResearchEvidenceIds);
      expect(rewrite.lineage.selectedPromptBlueprintVersion).toBe(first.lineage.selectedPromptBlueprintVersion);
      expect(rewrite.lineage.selectedRecipeId).toBe(first.lineage.selectedRecipeId);
      expect(rewrite.lineage.transformMode).toBe(first.lineage.transformMode);
      expect(rewrite.lineage.mediaSetFingerprint).toBe(first.lineage.mediaSetFingerprint);
      expect(rewrite.lineage.customerFacts).toEqual(first.lineage.customerFacts);
      const parentAfterRewrite = (await server.client.listAgencyRecords("content-runs", scope)).find((run) => run.id === "run-a04-http");
      const childAfterRewrite = (await server.client.listAgencyRecords("content-runs", scope)).find((run) => run.id === "run-a04-http-rewrite");
      expect(parentAfterRewrite.prompt).toBe(firstPrompt);
      expect(childAfterRewrite.planId).toBe("plan-a");
      expect(childAfterRewrite.parentContentRunId).toBe("run-a04-http");
      expect(childAfterRewrite.revisionId).toBe("revision-child");
      expect(childAfterRewrite.parentRevisionId).toBe("revision-parent");
      expect(childAfterRewrite.state).toBe("needs_review");
      expect(childAfterRewrite.approvalState).toBe("pending");
      expect(childAfterRewrite.qualityStatus).toBe("pending");
      expect(childAfterRewrite.prompt).toBe(calls[1].prompt);
      expect(childAfterRewrite.contentIntelligenceLineage).toEqual(parentAfterRewrite.contentIntelligenceLineage);
    } finally {
      await server.stop();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }, 30_000);
});
