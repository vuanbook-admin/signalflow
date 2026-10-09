import { describe, expect, it, vi } from "vitest";
import { ensureContentRunMediaOwnership, prepareContentRunMedia, processedEvidenceForVariant, validateMediaAssetProof } from "./contentRunMedia";

const fakeCompensation = (remove: (assetId: string) => Promise<void>) => async (assetId: string) => { await remove(assetId); return { assetId, status: 'deleted' as const }; };
const rejected = (message: string) => Object.assign(new Error(message), { createOutcome: 'rejected' as const });

const scope = { clientId: "client-a", brandId: "brand-a" };
const hash = "a".repeat(64);
const assets = [
  { id: "publish", clientId: "client-a", brandId: "brand-a", kind: "Image", localAssetPath: "/app/media/publish.webp", mimeType: "image/webp", checksum: `sha256:${hash}` },
  { id: "reference", clientId: "client-a", brandId: "brand-a", kind: "Image", localAssetPath: "/app/media/reference.jpg", mimeType: "image/jpeg", checksum: `sha256:${"b".repeat(64)}` },
];

describe("Content Run media manifest", () => {
  it("uses the manifest publish role and order for content kind and fingerprint", async () => {
    const prepared = await prepareContentRunMedia([
      { assetId: "reference", order: 1, role: "reference" },
      { assetId: "publish", order: 0, role: "publish" },
    ], assets, scope);
    expect(prepared).toMatchObject({ ok: true, contentKind: "image", attachments: [{ assetId: "publish", order: 0, role: "publish" }, { assetId: "reference", order: 1, role: "reference" }] });
    if (prepared.ok) expect(prepared.mediaSetFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects missing hashes and scopes that do not match the active Client and Brand", async () => {
    const missingHash = await prepareContentRunMedia([{ assetId: "publish", order: 0, role: "publish" }], [{ ...assets[0], checksum: undefined }], scope);
    expect(missingHash).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_HASH_MISSING" });
    const unsupportedMime = await prepareContentRunMedia([{ assetId: "publish", order: 0, role: "publish" }], [{ ...assets[0], mimeType: "image/gif" }], scope);
    expect(unsupportedMime).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_TYPE_UNSUPPORTED" });
    const wrongScope = await prepareContentRunMedia([{ assetId: "publish", order: 0, role: "publish" }], [{ ...assets[0], brandId: "brand-b" }], scope);
    expect(wrongScope).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_SCOPE_MISMATCH" });
  });

  it("rejects archived assets before any gateway call", async () => {
    const archived = await prepareContentRunMedia([{ assetId: "publish", order: 0, role: "publish" }], [{ ...assets[0], archiveState: "archived" }], scope);
    expect(archived).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_ARCHIVED" });
  });

  it("changes the fingerprint when verified bytes change", async () => {
    const manifest = [{ assetId: "publish", order: 0, role: "publish" as const }];
    const before = await prepareContentRunMedia(manifest, assets, scope);
    const after = await prepareContentRunMedia(manifest, [{ ...assets[0], checksum: `sha256:${"c".repeat(64)}` }], scope);
    if (!before.ok || !after.ok) throw new Error("Expected valid media sets");
    expect(after.mediaSetFingerprint).not.toBe(before.mediaSetFingerprint);
  });

  it("accepts only exact processed evidence returned for every selected file", async () => {
    const prepared = await prepareContentRunMedia([{ assetId: "publish", order: 0, role: "publish" }], assets, scope);
    if (!prepared.ok) throw new Error("Expected valid media set");
    expect(processedEvidenceForVariant(prepared.attachments, { attachmentAccepted: true, attachmentCount: 1, attachmentBoundary: "chat_upload", mediaEvidence: [{ assetId: "publish", sha256: hash, mimeType: "image/webp", order: 0, role: "publish", uploadState: "processed" }] })).toMatchObject([{ assetId: "publish", uploadState: "processed", attachmentBoundary: "chat_upload" }]);
    expect(processedEvidenceForVariant(prepared.attachments, { attachmentAccepted: true, attachmentCount: 1, attachmentBoundary: "chat_upload", mediaEvidence: [{ assetId: "other", sha256: hash, mimeType: "image/webp", order: 0, role: "publish", uploadState: "processed" }] })).toBeUndefined();
  });

  it("requires a matching scoped Control Plane media record before generation", async () => {
    const prepared = await prepareContentRunMedia([{ assetId: "publish", order: 0, role: "publish" }], assets, scope);
    if (!prepared.ok) throw new Error("Expected valid media set");
    const row = { id: "publish", ...scope, sha256: hash, mimeType: "image/webp" };
    expect(validateMediaAssetProof(prepared.attachments, [row], scope)).toEqual({ ok: true });
    expect(validateMediaAssetProof(prepared.attachments, [{ id: "publish", ...scope, metadata: { sha256: hash, mimeType: "image/webp" } }], scope)).toEqual({ ok: true });
    expect(validateMediaAssetProof(prepared.attachments, [], scope)).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_CONTROL_PLANE_ASSET_MISSING" });
    expect(validateMediaAssetProof(prepared.attachments, [{ ...row, brandId: "brand-b" }], scope)).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_SCOPE_MISMATCH" });
    expect(validateMediaAssetProof(prepared.attachments, [{ ...row, sha256: "d".repeat(64) }], scope)).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_CONTROL_PLANE_EVIDENCE_MISMATCH" });
  });

  it("accepts app-owned universal media with a null or retired brand id", async () => {
    const universal = await prepareContentRunMedia([{ assetId: "publish", order: 0, role: "publish" }], [{ ...assets[0], brandId: null, distribution: "universal" }], scope);
    expect(universal).toMatchObject({ ok: true });
    const retired = await prepareContentRunMedia([{ assetId: "publish", order: 0, role: "publish" }], [{ ...assets[0], brandId: "brand-retired", distribution: "universal" }], scope);
    expect(retired).toMatchObject({ ok: true });
    const privateRetired = await prepareContentRunMedia([{ assetId: "publish", order: 0, role: "publish" }], [{ ...assets[0], brandId: "brand-retired" }], scope);
    expect(privateRetired).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_SCOPE_MISMATCH" });
  });

  it("accepts universal Control Plane proof while retaining client, archive, hash and MIME checks", async () => {
    const prepared = await prepareContentRunMedia([{ assetId: "publish", order: 0, role: "publish" }], assets, scope);
    if (!prepared.ok) throw new Error("Expected valid media set");
    const universalRow = { id: "publish", clientId: "client-a", brandId: null, distribution: "universal", sha256: hash, mimeType: "image/webp", localAssetPath: "/private/path-must-not-be-returned" };
    expect(validateMediaAssetProof(prepared.attachments, [universalRow], scope)).toEqual({ ok: true });
    const processed = processedEvidenceForVariant(prepared.attachments, { attachmentAccepted: true, attachmentCount: 1, attachmentBoundary: "chat_upload", mediaEvidence: [{ assetId: "publish", sha256: hash, mimeType: "image/webp", order: 0, role: "publish", uploadState: "processed" }] });
    expect(processed?.[0]).not.toHaveProperty("localAssetPath");
    expect(validateMediaAssetProof(prepared.attachments, [{ ...universalRow, clientId: "client-b" }], scope)).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_SCOPE_MISMATCH" });
    expect(validateMediaAssetProof(prepared.attachments, [{ ...universalRow, metadata: { ...universalRow, archiveState: "archived" } }], scope)).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_ARCHIVED" });
    expect(validateMediaAssetProof(prepared.attachments, [{ ...universalRow, mimeType: "image/png" }], scope)).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_CONTROL_PLANE_EVIDENCE_MISMATCH" });
  });

  it("preflights every automatic attachment before creating any Control Plane media row", async () => {
    const attachments = [
      { assetId: "publish", localAssetPath: "/app/media/publish.webp", mimeType: "image/webp", sha256: hash, order: 0, role: "publish" as const },
      { assetId: "reference", localAssetPath: "/app/media/reference.jpg", mimeType: "image/jpeg", sha256: "f".repeat(64), order: 1, role: "reference" as const },
    ];
    const rows: Record<string, unknown>[] = [];
    const createMediaAsset = vi.fn(async (payload: Record<string, unknown>) => { rows.push({ id: payload.id, clientId: payload.clientId, brandId: payload.brandId, metadata: payload.metadata }); });
    const deleteMediaAsset = vi.fn(async (assetId: string) => { const index = rows.findIndex((row) => row.id === assetId); if (index >= 0) rows.splice(index, 1); });
    await expect(ensureContentRunMediaOwnership({ attachments, assets, scope, transport: { listMediaAssets: async () => rows, createMediaAsset, compensateMediaAsset: fakeCompensation(deleteMediaAsset) } })).rejects.toThrow("MEDIA_ATTACHMENT_CONTROL_PLANE_EVIDENCE_MISMATCH");
    expect(createMediaAsset).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("rolls back newly registered media when the durable Content Run create fails", async () => {
    const attachment = { assetId: "publish", localAssetPath: "/app/media/publish.webp", mimeType: "image/webp", sha256: hash, order: 0, role: "publish" as const };
    const rows: Record<string, unknown>[] = [];
    const transport = {
      listMediaAssets: async () => rows,
      createMediaAsset: async (payload: Record<string, unknown>) => { rows.push({ id: payload.id, clientId: payload.clientId, brandId: payload.brandId, metadata: payload.metadata }); },
      compensateMediaAsset: fakeCompensation(async (assetId: string) => { const index = rows.findIndex((row) => row.id === assetId); if (index >= 0) rows.splice(index, 1); }),
    };
    const gateway = vi.fn(async () => { throw new Error("gateway must not run"); });
    await expect((async () => {
      const { dispatchContentIntelligenceRun } = await import("./contentIntelligenceDispatch");
      return dispatchContentIntelligenceRun({
        runId: "run-rollback", identityVersionId: "identity-a", userBrief: "A real topic", selectedKnowledgeItemIds: [], selectedResearchEvidenceIds: [], knowledgeItems: [], researchEvidence: [], promptBlueprints: [{ id: "blueprint-a", brandId: "brand-a", kind: "caption", template: "Use facts", version: 1, status: "active" }], selectedPromptBlueprintId: "blueprint-a", contentRecipes: [{ id: "recipe-a", brandId: "brand-a", name: "Recipe", platforms: ["facebook"], contentKinds: ["image"], hookGuidance: "Hook", structureGuidance: "Structure", ctaGuidance: "CTA", qualityChecklist: ["Check"], status: "active" }], selectedRecipeId: "recipe-a", ...scope, transformMode: "original", mediaSetFingerprint: "a".repeat(64), mediaEvidence: [{ ...attachment, uploadState: "processed" }], customerFacts: ["A fact"], promptBuilder: (context: string) => context, request: { workspaceId: scope.clientId, prompt: "placeholder", targetPlatforms: ["facebook"], contentKinds: ["image"], brandSystem: { workspaceId: scope.clientId, voice: "Clear", audience: "Customers", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "system" } }, metadata: {} }, gateway: { generate: gateway }, transport: { createContentRun: async () => { throw rejected("CONTENT_RUN_CREATE_FAILED"); }, updateContentRun: async () => undefined }, createPayload: { clientId: scope.clientId, brandId: scope.brandId, identityVersionId: "identity-a", executionMode: "subscription_package" }, mediaOwnership: { attachments: [attachment], assets, scope, transport },
      });
    })()).rejects.toThrow("CONTENT_RUN_CREATE_FAILED");
    expect(rows).toHaveLength(0);
    expect(gateway).not.toHaveBeenCalled();
  });
});


describe("fix4 ownership rollback verification", () => {
  it("detects a delete ACK that did not remove its media row", async () => {
    const rows: Record<string, unknown>[] = [];
    const receipt = await ensureContentRunMediaOwnership({ scope, assets, attachments: [{ assetId: "publish", localAssetPath: "/app/media/publish.webp", mimeType: "image/webp", sha256: hash, role: "publish", order: 0 }], transport: { listMediaAssets: async () => rows, createMediaAsset: async (payload) => { rows.push(payload); }, compensateMediaAsset: fakeCompensation(async () => undefined) } });
    await expect(receipt.rollback()).rejects.toMatchObject({ code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED", rollback: { verified: true, remainingAssetIds: ["publish"] } });
  });

  it("does not claim zero residual media when rollback verification is unavailable", async () => {
    const rows: Record<string, unknown>[] = [];
    const listMediaAssets = vi.fn(async () => rows);
    const receipt = await ensureContentRunMediaOwnership({ scope, assets, attachments: [{ assetId: "publish", localAssetPath: "/app/media/publish.webp", mimeType: "image/webp", sha256: hash, role: "publish", order: 0 }], transport: { listMediaAssets, createMediaAsset: async (payload) => { rows.push(payload); }, compensateMediaAsset: fakeCompensation(async () => { rows.length = 0; }) } });
    listMediaAssets.mockRejectedValue(new Error("CP_LIST_UNAVAILABLE"));
    await expect(receipt.rollback()).rejects.toMatchObject({ code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED", rollback: { verified: false, remainingAssetIds: null } });
  });
});


describe("fix4 partial registration and receipt lifecycle", () => {
  const attachments = assets.map((asset, order) => ({ assetId: asset.id, localAssetPath: asset.localAssetPath, mimeType: asset.mimeType, sha256: asset.checksum.replace("sha256:", ""), order, role: order === 0 ? "publish" as const : "reference" as const }));

  it("rolls back both rows when the second media create commits but its ACK is lost", async () => {
    const rows: Record<string, unknown>[] = [];
    const deleted: string[] = [];
    await expect(ensureContentRunMediaOwnership({ scope, assets, attachments, transport: {
      listMediaAssets: async () => rows,
      createMediaAsset: async (payload) => { rows.push(payload); if (payload.id === "reference") throw new Error("MEDIA_ACK_LOST"); },
      compensateMediaAsset: fakeCompensation(async (id) => { deleted.push(id); rows.splice(rows.findIndex((row) => row.id === id), 1); }),
    } })).rejects.toThrow("MEDIA_ACK_LOST");
    expect(deleted).toEqual(["reference", "publish"]);
    expect(rows).toHaveLength(0);
  });

  it("does not delete a pre-existing shared row when later Content Run creation fails", async () => {
    const api = await import("./contentRunMedia");
    const existing = { id: "publish", clientId: scope.clientId, brandId: null, metadata: { distribution: "universal", sha256: hash, mimeType: "image/webp" } };
    const rows: Record<string, unknown>[] = [existing];
    const deleted: string[] = [];
    await expect(api.createContentRunWithMediaOwnership({ scope, assets, attachments, transport: { listMediaAssets: async () => rows, createMediaAsset: async (payload) => { rows.push(payload); }, compensateMediaAsset: fakeCompensation(async (id) => { deleted.push(id); rows.splice(rows.findIndex((row) => row.id === id), 1); }) } }, async () => { throw rejected("CP_CREATE_FAILED"); })).rejects.toThrow("CP_CREATE_FAILED");
    expect(deleted).toEqual(["reference"]);
    expect(rows).toEqual([existing]);
  });

  it("reports a registration failure whose rollback also fails instead of hiding it", async () => {
    const rows: Record<string, unknown>[] = [];
    await expect(ensureContentRunMediaOwnership({ scope, assets, attachments, transport: { listMediaAssets: async () => rows, createMediaAsset: async (payload) => { if (payload.id === "reference") throw rejected("REGISTER_FAILED"); rows.push(payload); }, compensateMediaAsset: fakeCompensation(async () => { throw new Error("DELETE_FAILED"); }) } })).rejects.toMatchObject({ code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED", rollback: { verified: true, remainingAssetIds: ["publish"], attemptedAssetIds: ["publish"] }, originalError: rejected("REGISTER_FAILED") });
  });

  it("will not register any row without a rollback operation", async () => {
    const createMediaAsset = vi.fn(async () => undefined);
    await expect(ensureContentRunMediaOwnership({ scope, assets, attachments, transport: { listMediaAssets: async () => [], createMediaAsset } })).rejects.toThrow("MEDIA_OWNERSHIP_ROLLBACK_UNAVAILABLE");
    expect(createMediaAsset).not.toHaveBeenCalled();
  });

  it("records receipt status and retries only residual rows after a partial rollback", async () => {
    const rows: Record<string, unknown>[] = [];
    let failReference = true;
    const deleted: string[] = [];
    const receipt = await ensureContentRunMediaOwnership({ scope, assets, attachments, transport: { listMediaAssets: async () => rows, createMediaAsset: async (payload) => { rows.push(payload); }, compensateMediaAsset: fakeCompensation(async (id) => { deleted.push(id); if (id === "reference" && failReference) throw new Error("DELETE_FAILED"); const index = rows.findIndex((row) => row.id === id); if (index < 0) throw new Error("ENTITY_MISSING"); rows.splice(index, 1); }) } });
    expect(receipt.state).toBe("pending");
    await expect(receipt.rollback()).rejects.toMatchObject({ code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED" });
    expect(receipt.state).toBe("reconciliation_required");
    failReference = false;
    await expect(receipt.rollback()).resolves.toMatchObject({ verified: true, remainingAssetIds: [] });
    expect(receipt.state).toBe("rolled_back");
    expect(deleted).toEqual(["reference", "publish", "reference"]);
  });
});

describe("fix5 Control Plane receipt transport", () => {
  it("uses the scoped conditional command and preserves explicit rejection versus uncertain errors", async () => {
    const { ControlPlaneClient } = await import("./controlPlane");
    const requests: Array<{ url: string; method?: string; body?: string }> = [];
    const client = new ControlPlaneClient("https://cp.test", { fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init?.method, body: String(init?.body ?? "") });
      if (String(url).endsWith("/compensate")) return new Response(JSON.stringify({ assetId: "asset/a", status: "retained", reason: "MEDIA_COMMITTED_REFERENCE" }));
      if (init?.method === "POST") return new Response(JSON.stringify({ detail: { code: "CONTENT_RUN_IDENTITY_MISSING", message: "Rejected", createOutcome: "rejected" } }), { status: 400 });
      return new Response(JSON.stringify({ id: "run/a", client_id: "client-a", brand_id: "brand-a" }));
    } });
    const receipt = { ...scope, ownershipReceiptId: "receipt-a", sha256: hash, mimeType: "image/webp" };
    await expect(client.compensateMediaAsset("asset/a", receipt)).resolves.toMatchObject({ status: "retained" });
    expect(requests[0]).toEqual({ url: "https://cp.test/v1/agency/media-assets/asset%2Fa/compensate", method: "POST", body: JSON.stringify(receipt) });
    await expect(client.createAgencyRecord("content-runs", { id: "run/a" })).rejects.toMatchObject({ createOutcome: "rejected" });
    await expect(client.getContentRun("run/a")).resolves.toMatchObject({ id: "run/a", ...scope });
    const missing = new ControlPlaneClient("https://cp.test", { fetchImpl: async () => new Response(JSON.stringify({ detail: { code: "AGENCY_ENTITY_MISSING" } }), { status: 404 }) });
    await expect(missing.getContentRun("run/a")).resolves.toBeUndefined();
    const disconnected = new ControlPlaneClient("https://cp.test", { fetchImpl: async () => { throw new Error("ACK_LOST"); } });
    await expect(disconnected.createAgencyRecord("content-runs", { id: "run/a" })).rejects.toMatchObject({ code: "CONTROL_PLANE_UNREACHABLE", createOutcome: undefined });
  });
});

it("never treats scoped absence as proof after an uncertain compensation ACK", async () => {
  const rows: Record<string, unknown>[] = [];
  const compensateMediaAsset = vi.fn(async () => { throw new Error("ACK_LOST"); });
  const listMediaAssets = vi.fn(async () => rows);
  const receipt = await ensureContentRunMediaOwnership({ scope, assets, attachments: [{ assetId: "publish", localAssetPath: assets[0].localAssetPath, mimeType: "image/webp", sha256: hash, role: "publish", order: 0 }], transport: { listMediaAssets, createMediaAsset: async (row) => { rows.push(row); }, compensateMediaAsset } });
  // An adopted row can leave the old scoped listing while still existing globally in the CP.
  listMediaAssets.mockResolvedValue([]);
  await expect(receipt.rollback()).rejects.toMatchObject({ code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED", rollback: { verified: false, remainingAssetIds: null } });
  await expect(receipt.rollback()).rejects.toMatchObject({ code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED", rollback: { verified: false, remainingAssetIds: null } });
  expect(compensateMediaAsset).toHaveBeenCalledTimes(2);
  expect(rows).toHaveLength(1);
});
