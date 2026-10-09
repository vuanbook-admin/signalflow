import { describe, expect, it } from "vitest";
import {
  IMAGE_PROVIDER_CAPABILITIES,
  MediaReservationLedger,
  applyDecodedImageAnalysis,
  buildMediaHierarchy,
  canUseVideoProvider,
  applyMediaReservationToRecord,
  buildAssetOperationPersistencePatch,
  buildMediaReplacementPersistencePatch,
  fingerprintMediaReplacement,
  createCreativeRun,
  createGeneratedMediaRecord,
  archiveMediaAsset,
  restoreMediaAsset,
  classifyDriveInventory,
  createBrandAutomationPlan,
  createDailyDraftPlan,
  expandBrandAutomationSchedule,
  getMediaEligibilityReason,
  findDuplicateMedia,
  getImageProviderCapability,
  isMediaEligible,
  mergeDriveInventoryRecord,
  normalizeDriveFileId,
  normalizeDriveInventoryRecord,
  promoteVerifiedDecodedImage,
  recordCreativeAssetFailure,
  retryCreativeRun,
  runAssetOperation,
  resolveMediaDistribution,
  stableMediaRecordIdHash,
  selectMediaForPost,
  timeoutCreativeAssetOperation,
  transitionCreativeRun,
  validateBrandAutomationPlan,
  type BrandAutomationPlan,
  type MediaInventoryRecord,
} from "./automationDomain";
import { selectAutomationMediaForPost } from "./automationPlanner";
import { assertContentRunMediaReplacementAck } from "../App";

const page = (id: string, publishTimes = ["09:00", "13:00"]) => ({
  id: `target-${id}`,
  platform: "facebook" as const,
  accountId: id,
  displayName: `Page ${id}`,
  postsPerDay: publishTimes.length,
  imageCount: 1,
  videoCount: publishTimes.length - 1,
  publishTimes,
  liveAdapter: "native_meta" as const,
});

const basePlan = (): BrandAutomationPlan => createBrandAutomationPlan("workspace-1", "brand-1", "Asia/Ho_Chi_Minh", [page("page-a"), page("page-b", ["10:00"])], new Date("2026-08-23T00:00:00.000Z"));

const media = (overrides: Partial<MediaInventoryRecord> = {}): MediaInventoryRecord => ({
  id: "asset-1",
  brandId: "brand-1",
  campaignId: "campaign-1",
  topic: "emergency fund",
  platform: "facebook",
  kind: "image",
  name: "cover.png",
  mimeType: "image/png",
  sizeBytes: 1024,
  modifiedAt: "2026-08-22T00:00:00.000Z",
  source: "drive",
  status: "eligible",
  normalizedDriveFileId: "drive-1",
  shareUrl: "https://drive.google.com/file/d/drive-1/view",
  normalizedUrl: "https://drive.google.com/uc?export=download&id=drive-1",
  sha256: "a".repeat(64),
  visualFingerprint: "0000000000000000",
  visualFingerprintSource: "decoded_image",
  publicUrlVerified: true,
  ...overrides,
});

const fix6ReplacementOperation = { kind: "image" as const, status: "completed" as const, slotId: "run-m05-ack", strategyVersion: 2, idempotencyKey: "run-m05-ack:v2:image" };
const fix6ReplacementEvidence = [{ assetId: "asset-new", sha256: "b".repeat(64), mimeType: "image/png", order: 0, role: "publish" as const, uploadState: "processed" as const }];
const fix6Replacement = { mediaAssetIds: ["asset-new"], mediaSetFingerprint: "c".repeat(64), mediaEvidence: fix6ReplacementEvidence };
const fix6ReplacementAck = { id: "run-m05-ack", state: "needs_review", mediaOperations: [{ type: "image", status: "completed", slotId: fix6ReplacementOperation.slotId, strategyVersion: fix6ReplacementOperation.strategyVersion, idempotencyKey: fix6ReplacementOperation.idempotencyKey }], mediaRevision: 1, media_revision: 1, mediaAssetIds: ["asset-new"], media_asset_ids: ["asset-new"], mediaSetFingerprint: fix6Replacement.mediaSetFingerprint, mediaEvidence: fix6ReplacementEvidence };

describe("fix6 replacement ACK boundary", () => {
  it("accepts only the submitted revision plus one and matching media", () => {
    expect(assertContentRunMediaReplacementAck(fix6ReplacementAck, "run-m05-ack", fix6ReplacementOperation, 0, fix6Replacement)).toBe(1);
  });

  it("rejects a stale replacement ACK revision", () => {
    expect(() => assertContentRunMediaReplacementAck({ ...fix6ReplacementAck, mediaRevision: 0, media_revision: 0 }, "run-m05-ack", fix6ReplacementOperation, 0, fix6Replacement)).toThrow("CONTENT_RUN_MEDIA_REVISION_ACK_STALE");
  });

  it("rejects an absent replacement ACK revision", () => {
    const { mediaRevision: _mediaRevision, media_revision: _media_revision, ...ack } = fix6ReplacementAck;
    expect(() => assertContentRunMediaReplacementAck(ack, "run-m05-ack", fix6ReplacementOperation, 0, fix6Replacement)).toThrow("CONTENT_RUN_MEDIA_REVISION_ACK_MISSING");
  });

  it("rejects conflicting replacement ACK revision aliases", () => {
    expect(() => assertContentRunMediaReplacementAck({ ...fix6ReplacementAck, media_revision: 2 }, "run-m05-ack", fix6ReplacementOperation, 0, fix6Replacement)).toThrow("CONTENT_RUN_MEDIA_REVISION_ACK_ALIAS_MISMATCH");
  });

  it("rejects replacement ACK media that does not match the generated asset", () => {
    expect(() => assertContentRunMediaReplacementAck({ ...fix6ReplacementAck, mediaAssetIds: ["asset-old"], media_asset_ids: ["asset-old"] }, "run-m05-ack", fix6ReplacementOperation, 0, fix6Replacement)).toThrow("CONTENT_RUN_MEDIA_REPLACEMENT_ACK_MEDIA_MISMATCH");
  });

  it("reconciles a committed replacement after a wrong ACK by reading the durable snapshot", async () => {
    const api = await import("./automationDomain");
    const reconcile = (api as unknown as { reconcileContentRunMediaReplacement: (input: Record<string, unknown>) => Promise<Record<string, unknown>> }).reconcileContentRunMediaReplacement;
    let durable = { ...fix6ReplacementAck };
    const result = await reconcile({
      runId: "run-m05-ack",
      operation: fix6ReplacementOperation,
      submittedRevision: 0,
      replacement: fix6Replacement,
      acknowledge: async () => { durable = { ...fix6ReplacementAck }; return { ...fix6ReplacementAck, mediaRevision: 0, media_revision: 0 }; },
      getContentRun: async () => durable,
    });
    expect(result).toMatchObject({ status: "reconciled", mediaRevision: 1, snapshot: { id: "run-m05-ack", mediaRevision: 1 } });
  });

  it("marks replacement outcome unknown when readback fails after an uncertain ACK", async () => {
    const api = await import("./automationDomain");
    const reconcile = (api as unknown as { reconcileContentRunMediaReplacement: (input: Record<string, unknown>) => Promise<Record<string, unknown>> }).reconcileContentRunMediaReplacement;
    const result = await reconcile({
      runId: "run-m05-ack",
      operation: fix6ReplacementOperation,
      submittedRevision: 0,
      replacement: fix6Replacement,
      acknowledge: async () => { throw new Error("CONTROL_PLANE_TIMEOUT"); },
      getContentRun: async () => { throw new Error("CONTROL_PLANE_UNREACHABLE"); },
    });
    expect(result).toEqual({ status: "unknown", code: "CONTENT_RUN_MEDIA_REPLACEMENT_RECONCILIATION_REQUIRED" });
  });
});

describe("brand automation domain", () => {
  it("archives a local/Drive asset without deleting provenance and blocks reuse", () => {
    const archived = archiveMediaAsset(media({ providerFileId: "drive-1", publicUrlVerified: true }));
    expect(archived).toMatchObject({ archiveState: "archived", status: "archived", providerFileId: "drive-1" });
    expect(isMediaEligible(archived)).toBe(false);
    expect(getMediaEligibilityReason(archived)).toContain("provider asset was not deleted");
    expect(restoreMediaAsset(archived)).toMatchObject({ archiveState: "active", status: "classified", providerFileId: "drive-1" });
  });
  it("supports multiple Facebook Pages with exact per-post schedules and mix", () => {
    const plan = basePlan();
    expect(validateBrandAutomationPlan(plan)).toEqual({ ok: true, errors: [] });
    expect(expandBrandAutomationSchedule(plan)).toEqual([
      expect.objectContaining({ accountId: "page-a", publishTime: "09:00", mediaKind: "image", postIndex: 0 }),
      expect.objectContaining({ accountId: "page-a", publishTime: "13:00", mediaKind: "video", postIndex: 1 }),
      expect.objectContaining({ accountId: "page-b", publishTime: "10:00", mediaKind: "image", postIndex: 0 }),
    ]);
  });

  it("blocks activation for missing account, invalid order, unsupported live adapter and missing eligible media", () => {
    const plan = { ...basePlan(), status: "active" as const, targetPages: [{ ...page("page-a", ["13:00", "09:00"]), accountId: "" }, { ...page("page-b"), liveAdapter: "unsupported" as const }] };
    const result = validateBrandAutomationPlan(plan, { brandKitReady: true, brandVoiceReady: true, eligibleMediaCount: 0 });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "At least one target Page/account is required.",
      "facebook target page-a publish times must be ordered.",
      "facebook target page-b live adapter is unsupported.",
      "At least one eligible media asset is required for activation.",
    ]));
  });

  it("rejects a legacy simulation adapter at the validation boundary", () => {
    const plan = { ...basePlan(), targetPages: [{ ...page("page-a"), liveAdapter: "simulation" as never }] };
    expect(validateBrandAutomationPlan(plan).errors).toContain("facebook target page-a live adapter is unsupported.");
  });

  it("classifies Drive inventory and keeps unknown/private media out of eligibility", () => {
    const ready = classifyDriveInventory({ providerFileId: "drive-42", name: "hero.jpg", mimeType: "", sizeBytes: 0, sizeText: "1.5 MB", modifiedAt: "2026-08-22T00:00:00.000Z", shareUrl: "https://drive.google.com/file/d/drive-42/view" });
    const unknown = classifyDriveInventory({ providerFileId: "drive-43", name: "notes.bin", mimeType: "application/octet-stream", sizeBytes: 10, modifiedAt: "2026-08-22T00:00:00.000Z", shareUrl: "https://drive.google.com/file/d/drive-43/view" });
    const privateAsset = media({ status: "classified", normalizedUrl: undefined, shareUrl: undefined });
    expect(ready).toMatchObject({ kind: "image", status: "classified", normalizedDriveFileId: "drive-42", mimeType: "image/jpeg", sizeBytes: 1572864, distribution: "universal" });
    expect(classifyDriveInventory({ providerFileId: "drive-44", name: "exec-0213.png Hình ảnh Thông tin khác", mimeType: "", sizeBytes: 0, modifiedAt: "2026-08-22T00:00:00.000Z" })).toMatchObject({ kind: "image", mimeType: "image/png" });
    expect(classifyDriveInventory({ providerFileId: "drive-45", name: "exec-5738.png Hình ảnh", mimeType: "application/octet-stream", sizeBytes: 0, modifiedAt: "2026-08-22T00:00:00.000Z" })).toMatchObject({ kind: "image", mimeType: "image/png" });
    expect(classifyDriveInventory({ providerFileId: "drive-46", name: "Drive label omitted", mimeType: "", kind: "image", sizeBytes: 0, modifiedAt: "2026-08-22T00:00:00.000Z" })).toMatchObject({ kind: "image" });
    expect(unknown).toMatchObject({ kind: "unknown", status: "classified" });
    expect(classifyDriveInventory({ providerFileId: "drive-47", name: "private-image.png", mimeType: "image/png", sizeBytes: 10, modifiedAt: "2026-08-22T00:00:00.000Z" })).toMatchObject({ normalizedUrl: "https://drive.google.com/uc?export=download&id=drive-47", publicUrlVerified: false });
    expect(isMediaEligible(ready)).toBe(false);
    expect(isMediaEligible({ ...ready, status: "eligible", normalizedUrl: "https://cdn.example.test/hero.jpg", sha256: "b".repeat(64), visualFingerprint: "1111111111111111", visualFingerprintSource: "decoded_image", reviewStatus: "verified", duplicateStatus: "unique", usageStatus: "available", publicUrlVerified: true })).toBe(true);
    expect(isMediaEligible(privateAsset)).toBe(false);
  });

  it("migrates a legacy Drive facebook default to universal without losing evidence or ledger state", () => {
    const legacy = media({ platform: "facebook", distribution: undefined, reviewStatus: "verified", usageStatus: "reserved", reservedReason: "automation-key", publicUrlVerified: true, sha256: "d".repeat(64), visualFingerprint: "1111111111111111" });
    const normalized = normalizeDriveInventoryRecord(legacy);
    expect(resolveMediaDistribution(legacy)).toBe("universal");
    expect(normalized).toMatchObject({ distribution: "universal", reviewStatus: "verified", usageStatus: "reserved", reservedReason: "automation-key", publicUrlVerified: true, sha256: "d".repeat(64), visualFingerprint: "1111111111111111" });
  });

  it("reclassifies a stale Drive PNG without losing review, usage or checksum state", () => {
    const stale = media({ kind: "unknown", mimeType: "application/octet-stream", name: "exec-0213e875-e6a1-4a89-bf3a-b6498cb108b5.png Hình ảnh", reviewStatus: "verified", usageStatus: "reserved", reservedReason: "brand-1:today", sha256: "c".repeat(64) });
    const normalized = normalizeDriveInventoryRecord(stale);
    expect(normalized).toMatchObject({ kind: "image", mimeType: "image/png", reviewStatus: "verified", usageStatus: "reserved", reservedReason: "brand-1:today", sha256: "c".repeat(64) });
    const merged = mergeDriveInventoryRecord(classifyDriveInventory({ providerFileId: "drive-1", name: stale.name, mimeType: "application/octet-stream", sizeBytes: 1024, modifiedAt: stale.modifiedAt }), stale, "brand-1");
    expect(merged).toMatchObject({ kind: "image", mimeType: "image/png", reviewStatus: "verified", usageStatus: "reserved", sha256: "c".repeat(64) });
  });

  it("keeps a verified Drive asset eligible when fresh metadata is merged", () => {
    const verified = media({ reviewedReady: true, reviewStatus: "verified", duplicateStatus: "unique", usageStatus: "available" });
    const freshMetadata = classifyDriveInventory({ providerFileId: "drive-1", name: "cover.png", mimeType: "image/png", sizeBytes: 4096, modifiedAt: "2026-08-23T00:00:00.000Z", shareUrl: "https://drive.google.com/file/d/drive-1/view" });
    const merged = mergeDriveInventoryRecord(freshMetadata, verified, "brand-1");
    expect(merged).toMatchObject({ status: "eligible", reviewedReady: true, reviewStatus: "verified", duplicateStatus: "unique", usageStatus: "available", sha256: "a".repeat(64), visualFingerprint: "0000000000000000", visualFingerprintSource: "decoded_image", publicUrlVerified: true });
    expect(isMediaEligible(merged)).toBe(true);
  });

  it("blocks a legacy fingerprint without provenance and repairs it only through decoded analysis", () => {
    const legacy = media({ status: "classified", reviewStatus: "verified", duplicateStatus: "unique", usageStatus: "available", visualFingerprint: "0000000000000000", visualFingerprintSource: undefined });
    expect(isMediaEligible(legacy)).toBe(false);
    expect(getMediaEligibilityReason(legacy)).toBe("Needs review: re-analyze locally to record decoded fingerprint provenance");

    const analyzed = applyDecodedImageAnalysis(legacy, { bytes: 4096, sha256: "b".repeat(64), modifiedAt: "2026-08-23T00:00:00.000Z", mimeType: "image/png", visualFingerprint: "1111111111111111" });
    expect(analyzed.visualFingerprintSource).toBe("decoded_image");
    const promoted = promoteVerifiedDecodedImage(analyzed);
    expect(promoted).toMatchObject({ status: "eligible", reviewedReady: true });
    expect(isMediaEligible(promoted)).toBe(true);
    expect(promoteVerifiedDecodedImage({ ...analyzed, reviewStatus: "needs_review" })).toMatchObject({ status: "classified" });
  });

  it("detects exact and near visual duplicates deterministically", () => {
    expect(stableMediaRecordIdHash("same bytes")).toBe(stableMediaRecordIdHash("same bytes"));
    expect(normalizeDriveFileId("https://drive.google.com/file/d/drive-42/view?usp=sharing")).toBe("drive-42");
    expect(normalizeDriveFileId("https://drive.google.com/open?id=drive-43")).toBe("drive-43");
    const exact = media({ id: "exact", sha256: "c".repeat(64) });
    const same = media({ id: "same", sha256: "c".repeat(64) });
    const near = media({ id: "near", normalizedDriveFileId: "drive-near", sha256: "d".repeat(64), visualFingerprint: "0000000000000001" });
    expect(findDuplicateMedia(exact, [same])).toMatchObject({ kind: "exact", assetId: "same" });
    expect(findDuplicateMedia(exact, [near])).toMatchObject({ kind: "near", assetId: "near" });
    expect(findDuplicateMedia(exact, [near, { ...near, id: "near-video", kind: "video", mimeType: "video/mp4" }])).toMatchObject({ kind: "near", assetId: "near" });
    expect(findDuplicateMedia(exact, [{ ...near, id: "cross-kind-video", kind: "video", mimeType: "video/mp4" }])).toBeUndefined();
    const videoBase = media({ id: "video-base", kind: "video", mimeType: "video/mp4", visualFingerprint: "0000000000000000", visualFingerprintSource: "decoded_video_frames" });
    const videoNear = media({ id: "video-near", kind: "video", mimeType: "video/mp4", normalizedDriveFileId: "drive-video-near", providerFileId: "drive-video-near", sha256: "b".repeat(64), visualFingerprint: "0000000000000001", visualFingerprintSource: "decoded_video_frames" });
    expect(findDuplicateMedia(videoBase, [videoNear])).toMatchObject({ kind: "near", assetId: "video-near" });
  });

  it("reserves atomically, excludes conflicts, releases failures, and marks used", () => {
    const ledger = new MediaReservationLedger();
    const asset = media();
    expect(selectMediaForPost([asset], { brandId: "brand-1", campaignId: "campaign-1", topic: "emergency fund", platform: "facebook", kind: "image" }, ledger)).toEqual(asset);
    expect(ledger.reserve({ assetId: asset.id, reservationKey: "brand-1:2026-08-23:page-a:0", channel: "facebook", dayKey: "2026-08-23" })).toBe(true);
    expect(ledger.reserve({ assetId: asset.id, reservationKey: "brand-1:2026-08-23:page-b:0", channel: "instagram", dayKey: "2026-08-23" })).toBe(false);
    expect(selectMediaForPost([asset], { brandId: "brand-1", campaignId: "campaign-1", topic: "emergency fund", platform: "facebook", kind: "image" }, ledger)).toBeUndefined();
    expect(ledger.release("brand-1:2026-08-23:page-a:0")).toBe(true);
    expect(ledger.reserve({ assetId: asset.id, reservationKey: "brand-1:2026-08-23:page-b:0", channel: "instagram", dayKey: "2026-08-23" })).toBe(true);
    expect(ledger.markUsed("brand-1:2026-08-23:page-b:0")).toBe(true);
    expect(ledger.reserve({ assetId: asset.id, reservationKey: "brand-1:2026-08-24:page-b:0", channel: "instagram", dayKey: "2026-08-24" })).toBe(false);
  });

  it("projects reserved and used ledger state onto verified Drive image and video records", () => {
    const video = media({ id: "drive-video", name: "broll.mp4", kind: "video", mimeType: "video/mp4", visualFingerprint: "1111111111111111", visualFingerprintSource: "decoded_video_frames", normalizedDriveFileId: "drive-video", providerFileId: "drive-video", reviewStatus: "verified", duplicateStatus: "unique", publicUrlVerified: true, usageStatus: "available" });
    const ledger = new MediaReservationLedger();
    const reservation = { reservationKey: "plan:day:page:1", assetId: video.id, channel: "facebook" as const, dayKey: "2026-08-24", state: "reserved" as const };
    expect(selectMediaForPost([video], { brandId: "brand-1", campaignId: "", topic: "", platform: "facebook", kind: "video" }, ledger)).toEqual(video);
    expect(ledger.reserve(reservation)).toBe(true);
    const reserved = applyMediaReservationToRecord(video, reservation);
    expect(reserved).toMatchObject({ kind: "video", reviewStatus: "verified", duplicateStatus: "unique", publicUrlVerified: true, usageStatus: "reserved", status: "reserved" });
    expect(selectMediaForPost([reserved], { brandId: "brand-1", campaignId: "", topic: "", platform: "facebook", kind: "video" }, ledger)).toBeUndefined();
    const usedReservation = { ...reservation, state: "used" as const };
    const used = applyMediaReservationToRecord(video, usedReservation);
    expect(used).toMatchObject({ usageStatus: "used", status: "used", usedReason: expect.stringContaining(reservation.reservationKey) });
    expect(isMediaEligible(used, ledger)).toBe(false);
  });

  it("preserves generated local media evidence and provider provenance", () => {
    const generated = createGeneratedMediaRecord({ id: "generated-run-1", clientId: "client-1", contentRunId: "run-1", brandId: "brand-1", topic: "Emergency fund", platform: "facebook", name: "Generated visual", localAssetPath: "/app-owned/generated.png", mimeType: "image/png", generatedAt: "2026-08-23T00:00:00.000Z", generatedSha256: "a".repeat(64), visualFingerprint: "1111111111111111", provider: "google_flow" });
    expect(generated).toMatchObject({ id: "generated-run-1", source: "generated", status: "classified", kind: "image", localAssetPath: "/app-owned/generated.png", sha256: "a".repeat(64), visualFingerprint: "1111111111111111", visualFingerprintSource: "decoded_image", reviewStatus: "needs_review", duplicateStatus: "unknown", usageStatus: "available", publicUrlVerified: false, provenance: { source: "generated", provider: "google_flow" }, hierarchy: { clientId: "client-1", brandId: "brand-1", platform: "facebook", date: "2026-08-23", contentRunId: "run-1" } });
    const ledger = new MediaReservationLedger();
    expect(ledger.reserve({ assetId: generated.id, reservationKey: "creative:generated-run-1", channel: "facebook", dayKey: "2026-08-23" })).toBe(true);
    expect(ledger.get("creative:generated-run-1")).toMatchObject({ assetId: generated.id, state: "reserved" });
    expect(ledger.isAvailable(generated.id)).toBe(false);
    expect(isMediaEligible(generated, ledger)).toBe(false);
  });

  it("classifies a generated video as video with frame fingerprint evidence", () => {
    const generated = createGeneratedMediaRecord({ id: "generated-video-1", clientId: "client-1", contentRunId: "run-video", brandId: "brand-1", topic: "Cotton video", platform: "facebook", name: "generated.mp4", localAssetPath: "/app-owned/generated.mp4", mimeType: "video/mp4", generatedAt: "2026-08-23T00:00:00.000Z", generatedSha256: "a".repeat(64), visualFingerprint: "1111111111111111", provider: "google_flow" });
    expect(generated).toMatchObject({ kind: "video", visualFingerprintSource: "decoded_video_frames" });
  });

  it("uses the owned media extension when a provider returns a stale MIME type", () => {
    const generated = createGeneratedMediaRecord({ id: "generated-video-mime", clientId: "client-1", contentRunId: "run-video-mime", brandId: "brand-1", topic: "Cotton video", platform: "facebook", name: "generated video", localAssetPath: "/app-owned/generated.mp4", mimeType: "image/png", generatedAt: "2026-08-23T00:00:00.000Z", generatedSha256: "a".repeat(64), visualFingerprint: "1111111111111111", provider: "google_flow" });
    expect(generated).toMatchObject({ kind: "video", visualFingerprintSource: "decoded_video_frames", hierarchy: { relativePath: expect.stringContaining("generated-video-mime.mp4") } });
  });

  it("records the Client/Brand/platform/date/content-run hierarchy for generated media", () => {
    const hierarchy = buildMediaHierarchy({ clientId: "client-a", brandId: "brand-a", platform: "facebook", capturedAt: "2026-08-30T12:00:00.000Z", contentRunId: "run-a", filename: "cover.png" });
    expect(hierarchy).toMatchObject({ clientId: "client-a", brandId: "brand-a", platform: "facebook", date: "2026-08-30", contentRunId: "run-a", relativePath: "client-a/brand-a/facebook/2026/08/30/cover.png" });
    expect(() => buildMediaHierarchy({ clientId: "client-a/../secret", brandId: "brand-a", platform: "facebook", capturedAt: "2026-08-30T12:00:00.000Z", contentRunId: "run-a", filename: "cover.png" })).toThrow("MEDIA_HIERARCHY_CLIENT_INVALID");
  });

  it("reuses universal media across channels and ranks exact platform and topic preferences deterministically", () => {
    const ledger = new MediaReservationLedger();
    const universalGeneric = media({ id: "universal-generic", distribution: "universal", platform: "facebook", topic: "", modifiedAt: "2026-08-24T00:00:00.000Z" });
    const universalMismatch = media({ id: "universal-mismatch", distribution: "universal", platform: "facebook", topic: "retirement", modifiedAt: "2026-08-25T00:00:00.000Z" });
    const universalExactTopic = media({ id: "universal-exact-topic", distribution: "universal", platform: "facebook", topic: "emergency fund", modifiedAt: "2026-08-20T00:00:00.000Z" });
    const platformExact = media({ id: "platform-exact", distribution: "instagram", platform: "instagram", topic: "emergency fund", modifiedAt: "2026-08-19T00:00:00.000Z" });
    const request = { brandId: "brand-1", campaignId: "campaign-1", topic: "emergency fund", platform: "instagram" as const, kind: "image" as const };
    expect(selectMediaForPost([universalGeneric], request, ledger)?.id).toBe("universal-generic");
    expect(selectMediaForPost([universalMismatch, universalGeneric, universalExactTopic], { ...request, platform: "youtube" }, ledger)?.id).toBe("universal-exact-topic");
    expect(selectMediaForPost([universalGeneric, universalExactTopic, platformExact], request, ledger)?.id).toBe("platform-exact");
    expect(selectMediaForPost([universalMismatch, universalGeneric], { ...request, platform: "youtube" }, ledger)?.id).toBe("universal-generic");
  });

  it("keeps generated media scoped to its requested platform", () => {
    const generated = createGeneratedMediaRecord({ id: "generated-instagram", brandId: "brand-1", topic: "Launch", platform: "instagram", name: "generated.png", localAssetPath: "/app-owned/generated.png", mimeType: "image/png", generatedAt: "2026-08-23T00:00:00.000Z", generatedSha256: "a".repeat(64), visualFingerprint: "1111111111111111", provider: "google_flow" });
    const eligibleGenerated = { ...generated, status: "eligible" as const, normalizedUrl: "https://cdn.example.test/generated.png", publicUrlVerified: true, reviewStatus: "verified" as const, duplicateStatus: "unique" as const, visualFingerprintSource: "decoded_image" as const };
    expect(generated.distribution).toBe("instagram");
    expect(selectMediaForPost([eligibleGenerated], { brandId: "brand-1", campaignId: "", topic: "", platform: "facebook", kind: "image" }, new MediaReservationLedger())).toBeUndefined();
    expect(selectMediaForPost([eligibleGenerated], { brandId: "brand-1", campaignId: "", topic: "", platform: "instagram", kind: "image" }, new MediaReservationLedger())).toEqual(eligibleGenerated);
  });

  it("automatically selects deterministic eligible brand media and respects gates", () => {
    const ledger = new MediaReservationLedger();
    const reserved = media({ id: "reserved", modifiedAt: "2026-08-24T00:00:00.000Z" });
    expect(ledger.reserve({ assetId: reserved.id, reservationKey: "existing", channel: "facebook", dayKey: "2026-08-24" })).toBe(true);
    const eligible = media({ id: "eligible", modifiedAt: "2026-08-23T00:00:00.000Z" });
    const assets = [
      media({ id: "duplicate", duplicateStatus: "duplicate" }),
      media({ id: "used", usageStatus: "used" }),
      reserved,
      eligible,
      media({ id: "other-brand", brandId: "brand-2" }),
    ];
    const request = { brandId: "brand-1", campaignId: "", topic: "", platform: "facebook" as const, kind: "image" as const };
    expect(selectAutomationMediaForPost({ selectedAssetIds: [] }, assets, request, ledger)?.id).toBe("eligible");
    expect(selectAutomationMediaForPost({ selectedAssetIds: ["duplicate", "eligible"] }, assets, request, ledger)?.id).toBe("eligible");
    expect(selectAutomationMediaForPost({ selectedAssetIds: ["duplicate"] }, assets, request, ledger)?.id).toBe("eligible");
  });

  it("creates idempotent daily drafts with deterministic keys", () => {
    const plan = basePlan();
    const ledger = new MediaReservationLedger();
    const assets = [media(), media({ id: "asset-2", normalizedDriveFileId: "drive-2", sha256: "e".repeat(64), visualFingerprint: "2222222222222222" }), media({ id: "asset-3", kind: "video", name: "broll.mp4", mimeType: "video/mp4", normalizedDriveFileId: "drive-3", sha256: "f".repeat(64), visualFingerprint: "3333333333333333" })];
    const first = createDailyDraftPlan(plan, new Date("2026-08-23T03:00:00.000Z"), assets, ledger);
    const second = createDailyDraftPlan(plan, new Date("2026-08-23T03:00:00.000Z"), assets, ledger);
    expect(first).toHaveLength(3);
    expect(second).toEqual(first);
    expect(new Set(first.map((draft) => draft.deterministicKey)).size).toBe(3);
  });

  it("reports honest image-provider capability states", () => {
    expect(IMAGE_PROVIDER_CAPABILITIES.local_preview.live).toBe(false);
    expect(getImageProviderCapability("google_flow", {})).toMatchObject({ configured: false, live: false });
    expect(getImageProviderCapability("vertex_ai", { projectId: "project-1", nativeSecureStore: true })).toMatchObject({ configured: true, live: true });
  });

  it("keeps video generation separate from review-only video assets", () => {
    expect(canUseVideoProvider("local_upload")).toMatchObject({ allowed: true, live: false });
    expect(canUseVideoProvider("veo")).toMatchObject({ allowed: false, live: false });
    expect(canUseVideoProvider("veo", { managedBrowserSession: true, signalFlowSessionVerified: true })).toMatchObject({ allowed: true, live: true, configured: true });
    expect(canUseVideoProvider("runway", { configured: true, officialApiVerified: true })).toMatchObject({ allowed: true, live: true });
  });

  it("keeps content generated when an asset operation fails", () => {
    const run = transitionCreativeRun(transitionCreativeRun(createCreativeRun({ id: "asset-failure", brandId: "brand-1", topic: "Emergency fund", imageProvider: "google_flow", generationIdempotencyKey: "asset-failure:strategy-v1:image", now: new Date("2026-08-23T00:00:00.000Z") }), "media_selected"), "content_generated");
    const operation = recordCreativeAssetFailure({ kind: "image", provider: "google_flow", stage: "asset_generation", reason: "FLOW_DOWNLOAD_TIMEOUT", createdAt: "2026-08-23T00:01:00.000Z" });
    expect(run.state).toBe("content_generated");
    expect(operation).toMatchObject({ kind: "image", status: "failed", provider: "google_flow", stage: "asset_generation", reason: "FLOW_DOWNLOAD_TIMEOUT" });
  });

  it("retries a failed slot with the same strategy identity and idempotency key", () => {
    const failed = {
      ...createCreativeRun({ id: "asset-retry", brandId: "brand-1", topic: "Emergency fund", imageProvider: "google_flow", generationIdempotencyKey: "asset-retry:strategy-v3:image", automationKey: "slot-7", now: new Date("2026-08-23T00:00:00.000Z") }),
      state: "failed" as const,
    };
    const retried = retryCreativeRun(failed, new Date("2026-08-23T00:02:00.000Z"));
    expect(retried).toMatchObject({ state: "idea", automationKey: "slot-7", generationIdempotencyKey: "asset-retry:strategy-v3:image" });
  });

  it("moves a running asset operation to a terminal failure on timeout", () => {
    const running = { kind: "video" as const, status: "running" as const, provider: "veo", stage: "asset_generation", createdAt: "2026-08-23T00:00:00.000Z" };
    expect(timeoutCreativeAssetOperation(running, new Date("2026-08-23T00:02:00.000Z"))).toMatchObject({ status: "failed", stage: "asset_generation", reason: "ASSET_GENERATION_TIMEOUT" });
    expect(timeoutCreativeAssetOperation({ ...running, status: "completed" })).toMatchObject({ status: "completed" });
  });

  it("keeps the prior failed attempt and settles the retry after a terminal timeout", async () => {
    const previous = { kind: "image" as const, status: "failed" as const, provider: "google_flow", slotId: "slot-timeout", strategyVersion: 2, idempotencyKey: "slot-timeout:v2:image", operationVersion: 1, reason: "FLOW_DOWNLOAD_TIMEOUT" };
    const result = await runAssetOperation({ kind: "image", provider: "google_flow", slotId: previous.slotId, strategyVersion: previous.strategyVersion, idempotencyKey: previous.idempotencyKey, operationVersion: 2, history: [previous], deadlineAt: Date.now() + 5, persist: async () => undefined, execute: () => new Promise((resolve) => setTimeout(resolve, 25)) });
    expect(result.operation).toMatchObject({ status: "failed", reason: "ASSET_GENERATION_TIMEOUT", operationVersion: 2, idempotencyKey: previous.idempotencyKey });
    expect(result.history).toEqual([previous, expect.objectContaining({ status: "failed", operationVersion: 2 })]);
    expect(result.history.some((operation) => operation.status === "running")).toBe(false);
  });

  it("surfaces terminal persistence failure instead of leaving an in-flight operation", async () => {
    const result = await runAssetOperation({
      kind: "image",
      provider: "google_flow",
      slotId: "slot-ack",
      strategyVersion: 4,
      idempotencyKey: "slot-ack:v4:image",
      deadlineAt: Date.now() + 1_000,
      persist: async (operation) => { if (operation.status === "completed" || operation.status === "failed") throw new Error("CONTROL_PLANE_TERMINAL_ACK_UNCERTAIN"); },
      execute: async () => "asset",
    });
    expect(result).toMatchObject({ terminalPersistenceFailed: true, operation: { status: "failed" } });
    expect(result.operation.reason).toBe("CONTROL_PLANE_TERMINAL_ACK_UNCERTAIN");
    expect(result.history.some((operation) => operation.status === "running")).toBe(false);
  });

  it("surfaces terminal persistence failure when validation blocks after the running checkpoint", async () => {
    const events: string[] = [];
    const result = await runAssetOperation({
      kind: "video",
      provider: "local_upload",
      slotId: "slot-blocked-ack",
      strategyVersion: 1,
      idempotencyKey: "slot-blocked-ack:v1:video",
      deadlineAt: Date.now() + 1_000,
      persist: async (operation) => { events.push(operation.status); if (operation.status === "blocked" || operation.status === "failed") throw new Error("CONTROL_PLANE_TERMINAL_ACK_REJECTED"); },
      validate: () => ({ ok: false as const, stage: "provider_readiness", reason: "VIDEO_PROVIDER_NOT_CONFIGURED" }),
      execute: async () => "must-not-run",
    });
    expect(events).toEqual(["running", "blocked", "failed"]);
    expect(result).toMatchObject({ terminalPersistenceFailed: true, operation: { status: "failed" } });
    expect(result.history.some((operation) => operation.status === "running")).toBe(false);
  });

  it("keeps asset operation persistence within the Control Plane plural operation allow-list", () => {
    const operation = { kind: "image" as const, status: "running" as const, provider: "google_flow", slotId: "slot-cp", strategyVersion: 2, idempotencyKey: "slot-cp:v2:image" };
    const patch = buildAssetOperationPersistencePatch(operation, [operation]);
    expect(patch).not.toHaveProperty("mediaOperation");
    expect(patch).toMatchObject({ mediaOperations: [{ type: "image", status: "running" }], visualOperations: [{ type: "image", status: "running" }], state: "content_generated" });
  });

  it("invalidates durable review state and replaces media evidence for a new asset", () => {
    const replacementFingerprint = "b".repeat(64);
    const replacementEvidence = [{ assetId: "asset-new", sha256: replacementFingerprint, mimeType: "image/png", order: 0, role: "publish" as const, uploadState: "pending" as const }];
    const patch = buildMediaReplacementPersistencePatch(
      { kind: "image", status: "completed", provider: "google_flow", slotId: "run-media-change", strategyVersion: 2, idempotencyKey: "run-media-change:v2:image", operationVersion: 2 },
      [{ kind: "image", status: "completed", provider: "google_flow", slotId: "run-media-change", strategyVersion: 2, idempotencyKey: "run-media-change:v2:image", operationVersion: 1 }],
      { mediaAssetIds: ["asset-new"], mediaSetFingerprint: replacementFingerprint, mediaEvidence: replacementEvidence, extra: { mediaRevision: 0, mediaSha256: replacementFingerprint, mediaKind: "image" } },
    );
    expect(patch).toMatchObject({
      state: "needs_review",
      mediaReplacement: true,
      qualityStatus: "pending",
      qualityChecks: [],
      approvalState: "pending",
      mediaAssetIds: ["asset-new"],
      mediaSetFingerprint: replacementFingerprint,
      mediaEvidence: replacementEvidence,
      mediaRevision: 0,
      mediaSha256: replacementFingerprint,
      mediaKind: "image",
    });
  });

  it("fingerprints replacement media from ordered identity, bytes and MIME", async () => {
    const descriptor = [{ assetId: "asset-new", sha256: "b".repeat(64), mimeType: "image/png", order: 0, role: "publish" as const }];
    const fingerprint = await fingerprintMediaReplacement(descriptor);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(await fingerprintMediaReplacement([{ ...descriptor[0], sha256: "c".repeat(64) }])).not.toBe(fingerprint);
    await expect(fingerprintMediaReplacement([{ ...descriptor[0], order: 1 }])).rejects.toThrow("MEDIA_SET_FINGERPRINT_REQUIRED");
  });


  it("fences late execution after a timeout before media state can be written", async () => {
    let attemptActive = true;
    let wroteMedia = false;
    const result = await runAssetOperation({
      kind: "video",
      provider: "veo",
      slotId: "slot-late",
      strategyVersion: 1,
      idempotencyKey: "slot-late:v1:video",
      deadlineAt: Date.now() + 5,
      onSettled: () => { attemptActive = false; },
      persist: async () => undefined,
      execute: async () => { await new Promise((resolve) => setTimeout(resolve, 25)); if (attemptActive) wroteMedia = true; return "late"; },
    });
    expect(result.operation).toMatchObject({ status: "failed", reason: "ASSET_GENERATION_TIMEOUT" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(wroteMedia).toBe(false);
  });
});


describe("fix4 explicit Drive ownership boundary", () => {
  const scope = { clientId: "client-a", brandId: "brand-a" };
  const incoming = () => classifyDriveInventory({ providerFileId: "first-use-file", name: "First image.png", mimeType: "image/png", sizeBytes: 128, modifiedAt: "2026-09-14T00:00:00Z" });

  it("assigns active Client and Brand only at explicit scoped import", () => {
    expect(incoming().clientId).toBeUndefined();
    const assigned = mergeDriveInventoryRecord(incoming(), undefined, scope);
    expect(assigned).toMatchObject({ ...scope, reviewStatus: "needs_review", publicUrlVerified: false });
    expect(assigned.sha256).toBeUndefined();
    expect(isMediaEligible(assigned)).toBe(false);
  });

  it("preserves evidence and rights when explicitly adopting an unowned legacy inventory row", () => {
    const verified = { ...incoming(), clientId: undefined, brandId: scope.brandId, sha256: "e".repeat(64), publicUrlVerified: true, reviewStatus: "verified" as const, rightsState: "licensed" as const, normalizedUrl: "https://example.test/first.png", visualFingerprint: "a".repeat(16), visualFingerprintSource: "decoded_image" as const };
    const merged = mergeDriveInventoryRecord(incoming(), verified, scope);
    expect(merged).toMatchObject({ ...scope, sha256: verified.sha256, publicUrlVerified: true, reviewStatus: "verified", rightsState: "licensed", mimeType: "image/png", normalizedUrl: verified.normalizedUrl, visualFingerprint: verified.visualFingerprint });
  });

  it("refuses to rebind a known other Client or Brand during sync", () => {
    expect(() => mergeDriveInventoryRecord(incoming(), { ...incoming(), clientId: "client-other", brandId: scope.brandId }, scope)).toThrow("DRIVE_MEDIA_OWNERSHIP_CONFLICT");
    expect(() => mergeDriveInventoryRecord(incoming(), { ...incoming(), clientId: scope.clientId, brandId: "brand-other" }, scope)).toThrow("DRIVE_MEDIA_OWNERSHIP_CONFLICT");
    expect(() => mergeDriveInventoryRecord(incoming(), undefined, { clientId: "", brandId: scope.brandId })).toThrow("DRIVE_MEDIA_SCOPE_REQUIRED");
  });

  it("excludes ambiguous and other-client inventory before automatic selection", () => {
    const eligible = { ...media(), ...scope };
    const request = { ...scope, campaignId: "", topic: "", platform: "facebook" as const, kind: "image" as const };
    expect(selectAutomationMediaForPost({ selectedAssetIds: [] }, [{ ...eligible, clientId: undefined }, { ...eligible, clientId: "other" }], request, new MediaReservationLedger())).toBeUndefined();
    expect(selectAutomationMediaForPost({ selectedAssetIds: [] }, [eligible], request, new MediaReservationLedger())).toEqual(eligible);
  });
});

describe("fix5 Drive provider identity groups", () => {
  it.each([false, true])("rejects a scoped conflict hidden by an unowned duplicate before state writes (reverse=%s)", async (reverse) => {
    const api = await import("./automationDomain");
    const incoming = classifyDriveInventory({ providerFileId: "drive-shared-id", name: "Photo.png", mimeType: "image/png", sizeBytes: 1, modifiedAt: "2026-09-14T00:00:00Z" });
    const conflict = { ...incoming, id: "owned-b", clientId: "client-b", brandId: "brand-b" };
    const unowned = { ...incoming, id: "legacy-unowned", brandId: "" };
    const existing = reverse ? [unowned, conflict] : [conflict, unowned];
    const before = structuredClone(existing);
    const writes: string[] = [];
    expect(() => {
      api.mergeDriveInventory([incoming], existing, { clientId: "client-a", brandId: "brand-a" });
      writes.push("setAutomationState", "setAssets", "CP");
    }).toThrow("DRIVE_MEDIA_IDENTITY_AMBIGUOUS");
    expect(writes).toEqual([]);
    expect(existing).toEqual(before);
  });

  it("retains unique inventory and explicitly scopes first-use rows", async () => {
    const api = await import("./automationDomain");
    const first = classifyDriveInventory({ providerFileId: "drive-first", name: "First.png", mimeType: "image/png", sizeBytes: 1, modifiedAt: "2026-09-14T00:00:00Z" });
    const second = { ...first, id: "retained-id", providerFileId: "drive-second", normalizedDriveFileId: "drive-second", provenance: { source: "google_drive" as const, providerFileId: "drive-second" }, clientId: "client-b", brandId: "brand-b" };
    expect(api.mergeDriveInventory([first], [second], { clientId: "client-a", brandId: "brand-a" })).toEqual([{ ...first, clientId: "client-a", brandId: "brand-a" }, second]);
  });


});

it("rejects conflicting local IDs across an incoming and a saved provider identity", async () => {
  const api = await import("./automationDomain");
  const incoming = classifyDriveInventory({ providerFileId: "drive-incoming", name: "A.png", mimeType: "image/png", sizeBytes: 1, modifiedAt: "2026-09-14T00:00:00Z" });
  const existing = { ...classifyDriveInventory({ providerFileId: "drive-saved", name: "B.png", mimeType: "image/png", sizeBytes: 1, modifiedAt: "2026-09-14T00:00:00Z" }), id: incoming.id };
  expect(() => api.mergeDriveInventory([incoming], [existing], { clientId: "client-a", brandId: "brand-a" })).toThrow("DRIVE_MEDIA_IDENTITY_AMBIGUOUS");
});
