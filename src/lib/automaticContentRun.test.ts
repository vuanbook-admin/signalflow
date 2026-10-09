// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dispatchContentIntelligenceRun } from "./contentIntelligenceDispatch";
import { runStrategyGenerationWithRetry } from "./generationRoute";
import { runAssetOperation } from "./automationDomain";
import { assertContentRunAssetAck } from "../App";

const scope = { clientId: "client-a", brandId: "brand-a" };
const knowledge = { id: "knowledge-a", ...scope, kind: "brand_fact", title: "Approved fact", contentHash: "a".repeat(64), provenance: "operator document", rightsState: "user_owned", reviewState: "approved", text: "The approved fact is durable.", sourceUpdatedAt: "2026-09-14T00:00:00Z", archiveState: "active" };
const evidence = { id: "evidence-a", ...scope, sourceUrl: "https://example.test/evidence", sourceTitle: "Approved evidence", retrievedAt: "2026-09-14T00:00:00Z", summary: "Approved research evidence.", rightsState: "licensed", reviewState: "approved" };
const blueprint = { id: "blueprint-a", brandId: scope.brandId, kind: "caption", template: "Use approved facts only.", version: 2, status: "active" };
const recipe = { id: "recipe-a", brandId: scope.brandId, name: "Proof flow", platforms: ["facebook"], contentKinds: ["image", "video"], hookGuidance: "Open with one proof point.", structureGuidance: "Context then action.", ctaGuidance: "Invite a save.", qualityChecklist: ["Check facts"], status: "active" };

function fixture(kind = "image") {
  const assetId = `asset-${kind}`;
  const sha256 = kind === "image" ? "b".repeat(64) : "c".repeat(64);
  const asset = { id: assetId, clientId: scope.clientId, brandId: scope.brandId, source: "drive", providerFileId: `drive-${kind}`, kind, name: `${kind}.` + (kind === "image" ? "png" : "mp4"), mimeType: kind === "image" ? "image/png" : "video/mp4", sizeBytes: 42, normalizedUrl: `https://cdn.example.test/${kind}`, publicUrlVerified: true, reviewStatus: "verified", status: "eligible", usageStatus: "available", duplicateStatus: "unique", archiveState: "active", sha256, visualFingerprint: "d".repeat(16), visualFingerprintSource: kind === "image" ? "decoded_image" : "decoded_video_frames" };
  const attachment = { assetId, localAssetPath: `/app-owned/${asset.name}`, mimeType: asset.mimeType, sha256, order: 0, role: "publish" };
  const contentRuns = new Map();
  const mediaAssets = new Map();
  const events = [];
  const transport = {
    listMediaAssets: vi.fn(async () => [...mediaAssets.values()]),
    createMediaAsset: vi.fn(async (payload) => { events.push("media:create"); const row = { id: payload.id, clientId: payload.clientId, brandId: payload.brandId, metadata: { ...payload.metadata } }; mediaAssets.set(row.id, row); return row; }),
    deleteMediaAsset: vi.fn(async (assetId) => { events.push("media:delete"); mediaAssets.delete(assetId); }),
    createContentRun: vi.fn(async (payload) => { events.push("run:create"); contentRuns.set(payload.id, payload); return payload; }),
    updateContentRun: vi.fn(async (id, payload) => { events.push("run:update"); contentRuns.set(id, { ...contentRuns.get(id), ...payload }); return contentRuns.get(id); }),
  };
  transport.compensateMediaAsset = vi.fn(async (id, receipt) => {
    const row = mediaAssets.get(id);
    if (!row) return { assetId: id, status: "absent" };
    if (row.metadata.ownershipReceiptId !== receipt.ownershipReceiptId || [...contentRuns.values()].some((run) => (run.mediaAssetIds ?? []).includes(id) || (run.mediaEvidence ?? []).some((item) => item.assetId === id))) return { assetId: id, status: "retained", reason: "MEDIA_COMMITTED_REFERENCE" };
    await transport.deleteMediaAsset(id);
    return { assetId: id, status: "deleted" };
  });
  const gateway = { generate: vi.fn(async () => { events.push("gateway"); return { traceId: `trace-${kind}`, provider: "mock", variants: [{ platform: "facebook", kind, title: "Real approved topic", body: "A useful approved content body.", metadata: {} }], safetyNotes: [] }; }) };
  const input = {
    runId: `run-auto-${kind}`,
    identityVersionId: "identity-a-v1",
    userBrief: "Explain the approved product proof in one useful post.",
    selectedKnowledgeItemIds: [knowledge.id],
    selectedResearchEvidenceIds: [evidence.id],
    knowledgeItems: [knowledge],
    researchEvidence: [evidence],
    promptBlueprints: [blueprint],
    selectedPromptBlueprintId: blueprint.id,
    contentRecipes: [recipe],
    selectedRecipeId: recipe.id,
    ...scope,
    transformMode: "original",
    mediaSetFingerprint: "e".repeat(64),
    mediaEvidence: [{ ...attachment, uploadState: "pending" }],
    customerFacts: ["Approved fact from operator."],
    promptBuilder: (context) => `Automatic content prompt\n${context}`,
    request: { workspaceId: scope.clientId, prompt: "placeholder", targetPlatforms: ["facebook"], contentKinds: [kind], brandSystem: { workspaceId: scope.clientId, voice: "Clear", audience: "Customers", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "system" } }, metadata: {} },
    gateway,
    transport: { createContentRun: transport.createContentRun, updateContentRun: transport.updateContentRun },
    createPayload: { clientId: scope.clientId, brandId: scope.brandId, identityVersionId: "identity-a-v1", executionMode: "subscription_package", mediaEvidence: [{ ...attachment, uploadState: "pending" }], state: "needs_review" },
    mediaOwnership: { attachments: [attachment], assets: [asset], scope, transport },
  };
  return { asset, attachment, contentRuns, mediaAssets, events, transport, gateway, input };
}

describe("automatic Content Run media persistence", () => {
  it.each(["running", "failed"])("accepts a valid plural %s asset operation ACK", (status) => {
    const operation = { kind: "image" as const, status: status as "running" | "failed", slotId: "slot-ack", strategyVersion: 2, idempotencyKey: "slot-ack:v2:image" };
    expect(() => assertContentRunAssetAck({ id: "run-ack", state: "content_generated", mediaOperations: [{ type: "image", status, slotId: operation.slotId, strategyVersion: operation.strategyVersion, idempotencyKey: operation.idempotencyKey }] }, "run-ack", operation)).not.toThrow();
  });

  it.each(["running", "failed"])("rejects a missing plural %s asset operation ACK", (status) => {
    const operation = { kind: "image" as const, status: status as "running" | "failed", slotId: "slot-ack", strategyVersion: 2, idempotencyKey: "slot-ack:v2:image" };
    expect(() => assertContentRunAssetAck({ id: "run-ack", state: "content_generated", mediaOperations: [] }, "run-ack", operation)).toThrow("CONTENT_RUN_ASSET_ACK_OPERATIONS_MISSING");
  });

  it.each(["running", "failed"])("rejects a mismatched plural %s asset operation ACK", (status) => {
    const operation = { kind: "image" as const, status: status as "running" | "failed", slotId: "slot-ack", strategyVersion: 2, idempotencyKey: "slot-ack:v2:image" };
    expect(() => assertContentRunAssetAck({ id: "run-ack", state: "content_generated", mediaOperations: [{ type: "video", status: status === "running" ? "failed" : "running", slotId: operation.slotId, strategyVersion: operation.strategyVersion, idempotencyKey: operation.idempotencyKey }] }, "run-ack", operation)).toThrow("CONTENT_RUN_ASSET_ACK_OPERATION_MISMATCH");
  });

  it("routes the automatic asset caller through the shared runner after a durable content checkpoint", () => {
    const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const automatic = source.slice(source.indexOf("async function executeDueAutomationPlans"), source.indexOf("const syncDriveInventory ="));
    const manual = source.slice(source.indexOf("const generateDraftMedia"), source.indexOf("const exportManualPackage"));
    expect(automatic).toContain("runAssetOperation({");
    expect(automatic).toContain("state: \"content_generated\"");
    expect(automatic.indexOf("persistAutomaticAssetOperation")).toBeLessThan(automatic.indexOf("new GoogleFlowImageProvider().generate"));
    expect(automatic.indexOf("runAssetOperation({")).toBeLessThan(automatic.indexOf("new GoogleFlowVideoProvider().generate"));
    expect(automatic).not.toContain("withAssetOperationDeadline(() => new GoogleFlowImageProvider().generate");
    expect(automatic).toContain("CONTENT_RUN_CHECKPOINT_REQUIRED");
    expect(automatic).toContain("assertContentRunAssetAck");
    expect(manual).toContain("assertContentRunAssetAck");
    expect(automatic).toContain("terminalPersistenceFailed");
    expect(automatic).toContain("generationIdempotencyKey: automationGenerationKey");
    expect(automatic).toContain("generatedAsset.id");
  });

  it.each(["image", "video"])("allows preselected %s media to bypass provider-only validation", (kind) => {
    const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const automatic = source.slice(source.indexOf("async function executeDueAutomationPlans"), source.indexOf("const syncDriveInventory ="));
    const validation = automatic.slice(automatic.indexOf("validate: () =>"), automatic.indexOf("failureStage:"));
    expect(validation).toContain("if (resolvedAsset) return { ok: true as const };");
    expect(validation).toContain(`spec.mediaKind === "${kind}"`);
  });

  it("records an automatic timeout as terminal while retaining the prior failed attempt", async () => {
    const previous = { kind: "image" as const, status: "failed" as const, provider: "google_flow", slotId: "auto-slot", strategyVersion: 4, idempotencyKey: "auto-slot:v4:image", operationVersion: 1, reason: "previous" };
    const result = await runAssetOperation({ kind: "image", provider: "google_flow", slotId: previous.slotId, strategyVersion: previous.strategyVersion, idempotencyKey: previous.idempotencyKey, operationVersion: 2, history: [previous], deadlineAt: Date.now() + 5, persist: async () => undefined, execute: () => new Promise((resolve) => setTimeout(resolve, 25)) });
    expect(result.operation).toMatchObject({ status: "failed", reason: "ASSET_GENERATION_TIMEOUT", operationVersion: 2 });
    expect(result.history).toEqual([previous, expect.objectContaining({ status: "failed", operationVersion: 2 })]);
    expect(result.history.some((operation) => operation.status === "running")).toBe(false);
  });

  it.each(["image", "video"])("registers %s media before the CP run and provider", async (kind) => {
    const fixtureValue = fixture(kind);
    const result = await dispatchContentIntelligenceRun(fixtureValue.input);
    expect(result.ok).toBe(true);
    expect(fixtureValue.mediaAssets.has(fixtureValue.asset.id)).toBe(true);
    expect(fixtureValue.contentRuns.has(`run-auto-${kind}`)).toBe(true);
    expect(result.prompt).toContain(`Knowledge ${knowledge.id}`);
    expect(result.lineage.selectedKnowledgeItemIds).toEqual([knowledge.id]);
    expect(fixtureValue.contentRuns.get(`run-auto-${kind}`).contentIntelligenceLineage).toEqual({ selectedKnowledgeItemIds: [knowledge.id], selectedResearchEvidenceIds: [evidence.id], selectedPromptBlueprintId: blueprint.id, selectedPromptBlueprintVersion: blueprint.version, selectedRecipeId: recipe.id, transformMode: "original", mediaSetFingerprint: "e".repeat(64), customerFacts: ["Approved fact from operator."] });
    expect(fixtureValue.events.indexOf("media:create")).toBeGreaterThanOrEqual(0);
    expect(fixtureValue.events.indexOf("media:create")).toBeLessThan(fixtureValue.events.indexOf("run:create"));
    expect(fixtureValue.gateway.generate).toHaveBeenCalledTimes(1);
    expect(fixtureValue.events.indexOf("run:create")).toBeLessThan(fixtureValue.events.indexOf("gateway"));
  });

  it("fails before CP create and provider when the automatic media asset is missing", async () => {
    const fixtureValue = fixture("image");
    fixtureValue.input.mediaOwnership.assets = [];
    await expect(dispatchContentIntelligenceRun(fixtureValue.input)).rejects.toThrow("MEDIA_ATTACHMENT_SCOPE_MISMATCH");
    expect(fixtureValue.transport.createContentRun).not.toHaveBeenCalled();
    expect(fixtureValue.gateway.generate).not.toHaveBeenCalled();
    expect(fixtureValue.contentRuns.size).toBe(0);
  });

  it("fails before CP create and provider when automatic media scope is invalid", async () => {
    const fixtureValue = fixture("video");
    fixtureValue.input.mediaOwnership.assets[0].brandId = "brand-other";
    await expect(dispatchContentIntelligenceRun(fixtureValue.input)).rejects.toThrow("MEDIA_ATTACHMENT_SCOPE_MISMATCH");
    expect(fixtureValue.transport.createContentRun).not.toHaveBeenCalled();
    expect(fixtureValue.gateway.generate).not.toHaveBeenCalled();
    expect(fixtureValue.contentRuns.size).toBe(0);
  });

  it("persists automatic media and the complete lineage through an in-memory SQLite CP adapter", async () => {
    const fixtureValue = fixture("image");
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE media_assets (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, brand_id TEXT NOT NULL, metadata_json TEXT NOT NULL); CREATE TABLE content_runs (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);");
    const sqliteTransport = {
      listMediaAssets: async () => database.prepare("SELECT id, client_id AS clientId, brand_id AS brandId, metadata_json FROM media_assets ORDER BY id").all().map((row) => ({ id: row.id, clientId: row.clientId, brandId: row.brandId, metadata: JSON.parse(row.metadata_json) })),
      createMediaAsset: async (payload) => { database.prepare("INSERT INTO media_assets(id, client_id, brand_id, metadata_json) VALUES (?, ?, ?, ?)").run(payload.id, payload.clientId, payload.brandId, JSON.stringify(payload.metadata)); return payload; },
      compensateMediaAsset: async (assetId) => { database.prepare("DELETE FROM media_assets WHERE id = ?").run(assetId); return { assetId, status: "deleted" }; },
    };
    const input = { ...fixtureValue.input, transport: { createContentRun: async (payload) => { database.prepare("INSERT INTO content_runs(id, payload_json) VALUES (?, ?)").run(payload.id, JSON.stringify(payload)); return payload; }, updateContentRun: async () => undefined }, mediaOwnership: { ...fixtureValue.input.mediaOwnership, transport: sqliteTransport } };
    const result = await dispatchContentIntelligenceRun(input);
    expect(result.ok).toBe(true);
    const mediaRow = database.prepare("SELECT * FROM media_assets WHERE id = ?").get(fixtureValue.asset.id);
    const runRow = database.prepare("SELECT payload_json FROM content_runs WHERE id = ?").get("run-auto-image");
    expect(mediaRow).toBeDefined();
    expect(JSON.parse(runRow.payload_json).contentIntelligenceLineage).toEqual({ selectedKnowledgeItemIds: [knowledge.id], selectedResearchEvidenceIds: [evidence.id], selectedPromptBlueprintId: blueprint.id, selectedPromptBlueprintVersion: blueprint.version, selectedRecipeId: recipe.id, transformMode: "original", mediaSetFingerprint: "e".repeat(64), customerFacts: ["Approved fact from operator."] });
    expect(fixtureValue.gateway.generate).toHaveBeenCalledTimes(1);
    database.close();
  });

  it("rolls back all automatic media rows when the CP Content Run create fails", async () => {
    const fixtureValue = fixture("image");
    fixtureValue.input.transport.createContentRun = vi.fn(async () => { throw Object.assign(new Error("CONTENT_RUN_CREATE_FAILED"), { createOutcome: "rejected" }); });
    await expect(dispatchContentIntelligenceRun(fixtureValue.input)).rejects.toThrow("CONTENT_RUN_CREATE_FAILED");
    expect(fixtureValue.mediaAssets.size).toBe(0);
    expect(fixtureValue.transport.deleteMediaAsset).toHaveBeenCalledWith(fixtureValue.asset.id);
    expect(fixtureValue.gateway.generate).not.toHaveBeenCalled();
  });

  it("rejects invalid A04 lineage before media registration", async () => {
    const fixtureValue = fixture("video");
    fixtureValue.input.selectedPromptBlueprintId = "missing-blueprint";
    const result = await dispatchContentIntelligenceRun(fixtureValue.input);
    expect(result.ok).toBe(false);
    expect(fixtureValue.mediaAssets.size).toBe(0);
    expect(fixtureValue.transport.createMediaAsset).not.toHaveBeenCalled();
    expect(fixtureValue.transport.deleteMediaAsset).not.toHaveBeenCalled();
    expect(fixtureValue.transport.createContentRun).not.toHaveBeenCalled();
    expect(fixtureValue.gateway.generate).not.toHaveBeenCalled();
  });

  it("reports two gateway attempts when a dispatch retry wrapper makes two provider calls", async () => {
    const fixtureValue = fixture("image");
    const attempts = { value: 0 };
    const strategy = { objectiveKey: "reach", objectiveLabel: "Reach", pillarId: "audience-insight", pillarLabel: "Audience insight", angleId: "audience-insight-audience-question", angleLabel: "Audience question", angleGuidance: "Answer one audience question.", channel: "facebook", format: "image", strategyVersion: 1, catalogFingerprint: "a".repeat(64), strategySnapshot: { objectiveKey: "reach", objectiveLabel: "Reach", pillarId: "audience-insight", pillarLabel: "Audience insight", angleId: "audience-insight-audience-question", angleLabel: "Audience question", angleGuidance: "Answer one audience question.", channel: "facebook", format: "image", strategyVersion: 1, catalogFingerprint: "a".repeat(64) } };
    const retryingGateway = { generate: (request) => runStrategyGenerationWithRetry({ contentRunId: "run-auto-image", strategy, format: "image", attemptCounter: attempts, generate: async () => { if (attempts.value === 1) throw new Error("STRATEGY_ANGLE_MISMATCH: retryable contract fixture"); return fixtureValue.gateway.generate(request); }, validate: () => ({ ok: true }) }) };
    const result = await dispatchContentIntelligenceRun({ ...fixtureValue.input, gateway: retryingGateway, gatewayRequestCount: () => attempts.value });
    expect(result.ok).toBe(true);
    expect(attempts.value).toBe(2);
    expect(result.gatewayRequestCount).toBe(2);
  });
});


describe("fix4 first-use Drive through automatic selection and CP dispatch", () => {
  it.each(["image", "video"])("scopes and verifies first-use %s without prepopulated ownership", async (kind) => {
    const { classifyDriveInventory, mergeDriveInventoryRecord, MediaReservationLedger } = await import("./automationDomain");
    const { selectAutomationMediaForPost } = await import("./automationPlanner");
    const value = fixture(kind);
    const unowned = classifyDriveInventory({ providerFileId: `fresh-${kind}`, name: value.asset.name, mimeType: value.asset.mimeType, sizeBytes: 42, modifiedAt: "2026-09-14T00:00:00Z" });
    expect(unowned.clientId).toBeUndefined();
    const scoped = mergeDriveInventoryRecord(unowned, undefined, scope);
    // Simulate the existing explicit review/decoded-file boundary; never infer evidence from Drive metadata.
    const verified = { ...scoped, normalizedUrl: value.asset.normalizedUrl, publicUrlVerified: true, reviewStatus: "verified", rightsState: "licensed", status: "eligible", usageStatus: "available", duplicateStatus: "unique", sha256: value.asset.sha256, visualFingerprint: value.asset.visualFingerprint, visualFingerprintSource: value.asset.visualFingerprintSource, localAssetPath: value.attachment.localAssetPath };
    const selected = selectAutomationMediaForPost({ selectedAssetIds: [] }, [verified], { ...scope, campaignId: "", topic: "", platform: "facebook", kind }, new MediaReservationLedger());
    expect(selected).toBeDefined();
    if (!selected) throw new Error("first-use Drive selection failed");
    value.input.mediaOwnership.assets = [selected];
    value.input.mediaOwnership.attachments = [{ ...value.attachment, assetId: selected.id }];
    value.input.mediaEvidence = [{ ...value.attachment, assetId: selected.id, uploadState: "pending" }];
    const result = await dispatchContentIntelligenceRun(value.input);
    expect(result.ok).toBe(true);
    expect(value.mediaAssets.get(selected.id)).toMatchObject({ ...scope, metadata: { rightsState: "licensed", sha256: selected.sha256, mimeType: selected.mimeType, publicUrlVerified: true } });
    expect(value.transport.createContentRun).toHaveBeenCalledTimes(1);
    expect(value.gateway.generate).toHaveBeenCalledTimes(1);
  });
});

describe("fix4 ownership transaction across dispatch and child creation", () => {
  it("validates lineage and prompt before the first ownership write", async () => {
    const value = fixture();
    value.input.promptBuilder = () => { throw new Error("PROMPT_INVALID"); };
    await expect(dispatchContentIntelligenceRun(value.input)).rejects.toThrow("PROMPT_INVALID");
    expect(value.transport.createMediaAsset).not.toHaveBeenCalled();
    expect(value.transport.createContentRun).not.toHaveBeenCalled();
    expect(value.gateway.generate).not.toHaveBeenCalled();
  });

  it("surfaces reconciliation with actual residual rows and attempts every rollback", async () => {
    const value = fixture();
    const second = { ...value.asset, id: "second", sha256: "d".repeat(64) };
    value.input.mediaOwnership.assets.push(second);
    value.input.mediaOwnership.attachments.push({ ...value.attachment, assetId: second.id, sha256: second.sha256, role: "reference", order: 1 });
    value.input.transport.createContentRun = vi.fn(async () => { throw Object.assign(new Error("CONTENT_RUN_CREATE_FAILED"), { createOutcome: "rejected" }); });
    value.transport.deleteMediaAsset.mockImplementation(async (id) => { if (id === second.id) throw new Error("DELETE_FAILED"); value.mediaAssets.delete(id); });
    await expect(dispatchContentIntelligenceRun(value.input)).rejects.toMatchObject({ code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED", rollback: { verified: true, remainingAssetIds: [second.id], attemptedAssetIds: [second.id, value.asset.id] } });
    expect(value.transport.deleteMediaAsset).toHaveBeenCalledTimes(2);
    expect([...value.mediaAssets.keys()]).toEqual([second.id]);
    expect(value.contentRuns.size).toBe(0);
    expect(value.gateway.generate).not.toHaveBeenCalled();
  });

  it.each(["manual", "rewrite"])("%s keeps ownership unsettled until CP ACK and rolls back all assets on create failure", async (mode) => {
    const api = await import("./contentRunMedia");
    expect(api.createContentRunWithMediaOwnership).toBeTypeOf("function");
    const value = fixture();
    const second = { ...value.asset, id: "second", sha256: "d".repeat(64) };
    value.input.mediaOwnership.assets.push(second);
    value.input.mediaOwnership.attachments.push({ ...value.attachment, assetId: second.id, sha256: second.sha256, role: "reference", order: 1 });
    let rejectCreate;
    const pending = new Promise((_resolve, reject) => { rejectCreate = reject; });
    let entered;
    const createEntered = new Promise((resolve) => { entered = resolve; });
    const operation = api.createContentRunWithMediaOwnership(value.input.mediaOwnership, async () => { entered(); return pending; });
    await createEntered;
    expect(value.mediaAssets.size).toBe(2);
    const rejection = expect(operation).rejects.toThrow(`${mode.toUpperCase()}_CREATE_FAILED`);
    rejectCreate(Object.assign(new Error(`${mode.toUpperCase()}_CREATE_FAILED`), { createOutcome: "rejected" }));
    await rejection;
    expect(value.mediaAssets.size).toBe(0);
    expect(value.transport.deleteMediaAsset).toHaveBeenCalledTimes(2);
    expect(value.gateway.generate).not.toHaveBeenCalled();
  });

  it("retains media after Content Run ACK when generation later fails", async () => {
    const value = fixture();
    value.gateway.generate.mockRejectedValue(new Error("STRATEGY_ANGLE_MISMATCH"));
    await expect(dispatchContentIntelligenceRun(value.input)).rejects.toThrow("STRATEGY_ANGLE_MISMATCH");
    expect(value.contentRuns.size).toBe(1);
    expect(value.mediaAssets.size).toBe(1);
    expect(value.transport.deleteMediaAsset).not.toHaveBeenCalled();
  });
});


it("wires all App Content Run creation paths to the shared ownership boundary", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const manual = source.slice(source.indexOf("const createDraft ="), source.indexOf("const persistedBrandBindings ="));
  const rewrite = source.slice(source.indexOf("const regenerateDraft ="), source.indexOf("const storeGeneratedOutput ="));
  expect(manual).toContain("mediaOwnership: controlPlaneMediaOwnershipInput(mediaAttachments)");
  expect(manual).not.toContain("ownership.commit()");
  expect(rewrite).toContain("await createContentRunWithMediaOwnership(selectedAssets.length ? controlPlaneMediaOwnershipInput(selectedAssets)");
  expect(rewrite).not.toContain("ownership.commit()");
  const automatic = source.slice(source.indexOf("async function executeDueAutomationPlans"), source.indexOf("const syncDriveInventory ="));
  expect(automatic).toContain("dispatchContentIntelligenceRun({");
  expect(automatic).toContain("mediaOwnership:");
  expect(automatic).toContain("asset.clientId === activeClientId && asset.brandId === plan.brandId");
  expect(automatic).not.toContain("ownership.commit()");
});

describe("fix5 uncertain Content Run ACK and media adoption", () => {
  it.each(["committed", "missing", "unavailable"])("retains media when a create ACK is lost and readback is %s", async (outcome) => {
    const value = fixture();
    value.input.transport.getContentRun = vi.fn(async (id) => {
      if (outcome === "unavailable") throw new Error("READBACK_UNAVAILABLE");
      return value.contentRuns.get(id);
    });
    value.input.transport.createContentRun = vi.fn(async (payload) => {
      if (outcome === "committed") value.contentRuns.set(payload.id, payload);
      throw new Error("CONTENT_RUN_ACK_LOST");
    });
    await expect(dispatchContentIntelligenceRun(value.input)).rejects.toMatchObject({
      code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED",
      contentRun: { id: value.input.runId, outcome: outcome === "committed" ? "committed" : "unknown" },
      rollback: { attemptedAssetIds: [], remainingAssetIds: [value.asset.id], verified: true },
    });
    expect(value.input.transport.getContentRun).toHaveBeenCalledWith(value.input.runId);
    expect(value.mediaAssets.size).toBe(1);
    expect(value.contentRuns.size).toBe(outcome === "committed" ? 1 : 0);
    expect(value.transport.deleteMediaAsset).not.toHaveBeenCalled();
    expect(value.gateway.generate).not.toHaveBeenCalled();
    console.info("FIX5_COUNTERS " + JSON.stringify({ fixture: `lost-run-ack-${outcome}`, runRows: value.contentRuns.size, mediaRows: value.mediaAssets.size, mediaCreates: value.transport.createMediaAsset.mock.calls.length, compensationRequests: value.transport.compensateMediaAsset.mock.calls.length, deletes: value.transport.deleteMediaAsset.mock.calls.length, gatewayCalls: value.gateway.generate.mock.calls.length }));
  });

  it.each(["same-brand", "cross-brand-universal"])("preserves a pending receipt's media adopted by a committed %s run", async (mode) => {
    const { createContentRunWithMediaOwnership } = await import("./contentRunMedia");
    const value = fixture();
    if (mode === "cross-brand-universal") value.asset.distribution = "universal";
    value.transport.compensateMediaAsset = vi.fn(async (id, receipt) => {
      const row = value.mediaAssets.get(id);
      if (row?.metadata.ownershipReceiptId !== receipt.ownershipReceiptId || [...value.contentRuns.values()].some((run) => run.mediaAssetIds.includes(id))) return { assetId: id, status: "retained", reason: "MEDIA_COMMITTED_REFERENCE" };
      value.mediaAssets.delete(id);
      return { assetId: id, status: "deleted" };
    });
    await expect(createContentRunWithMediaOwnership(value.input.mediaOwnership, async () => {
      const otherScope = { ...scope, brandId: mode === "same-brand" ? scope.brandId : "brand-b" };
      await createContentRunWithMediaOwnership({ ...value.input.mediaOwnership, scope: otherScope }, async () => {
        value.contentRuns.set("run-b", { id: "run-b", ...otherScope, mediaAssetIds: [value.asset.id] });
      });
      throw Object.assign(new Error("RUN_A_REJECTED"), { createOutcome: "rejected" });
    })).rejects.toMatchObject({ code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED", rollback: { remainingAssetIds: [value.asset.id], verified: true } });
    expect(value.contentRuns.size).toBe(1);
    expect(value.mediaAssets.size).toBe(1);
    expect(value.transport.createMediaAsset).toHaveBeenCalledTimes(1);
    expect(value.transport.compensateMediaAsset).toHaveBeenCalledTimes(1);
    expect(value.transport.deleteMediaAsset).not.toHaveBeenCalled();
    expect(value.gateway.generate).not.toHaveBeenCalled();
    console.info("FIX5_COUNTERS " + JSON.stringify({ fixture: `adopted-${mode}`, runRows: value.contentRuns.size, mediaRows: value.mediaAssets.size, mediaCreates: value.transport.createMediaAsset.mock.calls.length, compensationRequests: value.transport.compensateMediaAsset.mock.calls.length, deletes: value.transport.deleteMediaAsset.mock.calls.length, gatewayCalls: value.gateway.generate.mock.calls.length }));
  });
});

  it("wires the App Drive sync validator before inventory state updates", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const sync = source.slice(source.indexOf("const syncDriveInventory ="), source.indexOf("const persistMediaRecords ="));
    expect(sync).toContain("mergeDriveInventory(imported, canonicalMedia,");
    expect(sync.indexOf("mergeDriveInventory(")).toBeLessThan(sync.indexOf("setAutomationState("));
    expect(sync).not.toContain("new Map(");
  });

it("treats an empty successful create ACK as uncertain and reconciles before any gateway call", async () => {
  const value = fixture();
  value.input.transport.createContentRun = vi.fn(async (payload) => { value.contentRuns.set(payload.id, payload); return {}; });
  value.input.transport.getContentRun = vi.fn(async (id) => value.contentRuns.get(id));
  await expect(dispatchContentIntelligenceRun(value.input)).rejects.toMatchObject({ code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED", contentRun: { id: value.input.runId, outcome: "committed" } });
  expect(value.contentRuns.size).toBe(1);
  expect(value.mediaAssets.size).toBe(1);
  expect(value.gateway.generate).not.toHaveBeenCalled();
  expect(value.transport.deleteMediaAsset).not.toHaveBeenCalled();
});

it("requires the create ACK scope to match before accepting ownership", async () => {
  const value = fixture();
  value.input.transport.createContentRun = vi.fn(async (payload) => ({ ...payload, brandId: "other-brand" }));
  value.input.transport.getContentRun = vi.fn(async () => undefined);
  await expect(dispatchContentIntelligenceRun(value.input)).rejects.toMatchObject({ code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED", contentRun: { id: value.input.runId, outcome: "unknown" } });
  expect(value.mediaAssets.size).toBe(1);
  expect(value.gateway.generate).not.toHaveBeenCalled();
});
