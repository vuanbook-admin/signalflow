import { describe, expect, it } from "vitest";
import {
  MediaReservationLedger,
  canUseImageProvider,
  createCreativeRun,
  runCreativeCopyAttempt,
  safeCreativeRunError,
  getMediaEligibilityReason,
  findDuplicateMedia,
  hydrateReservationLedger,
  selectMediaForPost,
  transitionCreativeRun,
  retryCreativeRun,
  isMediaEligible,
  type MediaInventoryRecord,
} from "./automationDomain";
import { persistAutomationCheckpoint, persistSnapshot, restoreSnapshot } from "./persistence";

const validAsset = (overrides: Partial<MediaInventoryRecord> = {}): MediaInventoryRecord => ({
  id: "asset-1",
  brandId: "brand-1",
  campaignId: "campaign-1",
  topic: "emergency fund",
  platform: "facebook",
  kind: "image",
  name: "cover.png",
  mimeType: "image/png",
  sizeBytes: 100,
  modifiedAt: "2026-08-23T00:00:00.000Z",
  source: "drive",
  status: "eligible",
  normalizedDriveFileId: "drive-1",
  normalizedUrl: "https://cdn.example.test/cover.png",
  sha256: "a".repeat(64),
  visualFingerprint: "0000000000000000",
  visualFingerprintSource: "decoded_image",
  reviewStatus: "verified",
  duplicateStatus: "unique",
  usageStatus: "available",
  publicUrlVerified: true,
  ...overrides,
});

function installStore() {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = { localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    length: 0,
  } } as unknown as Window;
  return store;
}

describe("production workflow gaps", () => {
  it("hydrates the reservation ledger from persisted automation state on relaunch", () => {
    const persisted = [{ reservationKey: "plan:2026-08-23:page-a:0", assetId: "asset-1", channel: "facebook" as const, dayKey: "2026-08-23", state: "reserved" as const }];
    const ledger = hydrateReservationLedger(persisted);
    expect(ledger.get("plan:2026-08-23:page-a:0")).toEqual(persisted[0]);
    expect(ledger.isAvailable("asset-1")).toBe(false);
  });

  it("persists reservation transitions and restores them without losing used state", () => {
    installStore();
    const state = { schemaVersion: 1 as const, brandPlans: [], mediaAssets: [validAsset()], reservations: [{ reservationKey: "r1", assetId: "asset-1", channel: "facebook" as const, dayKey: "2026-08-23", state: "used" as const }], creativeRuns: [{ id: "run-1", brandId: "brand-1", topic: "Emergency fund", state: "review" as const, imageProvider: "google_flow" as const, generatedLocalAssetPath: "/safe/app-owned/flow.png", generatedMimeType: "image/png", generatedSha256: "b".repeat(64), generatedFingerprint: "1111111111111111", copyResult: { provider: "gemini_web", imageAware: true, body: "Caption" }, promptVersion: "v1", brandVoiceVersion: "v1", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:01:00.000Z" }], imageProvider: "google_flow" as const };
    persistSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, undefined, [], state);
    const restored = restoreSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, [], undefined);
    expect(restored.automationState?.reservations).toEqual(state.reservations);
    expect(restored.automationState?.imageProvider).toBe("google_flow");
    expect(restored.automationState?.creativeRuns[0].generatedSha256).toBe("b".repeat(64));
    expect(restored.automationState?.creativeRuns[0].copyResult?.imageAware).toBe(true);
  });

  it("recovers an interrupted media operation on relaunch so the post can retry", () => {
    installStore();
    persistSnapshot([{ id: 42, mediaOperation: { kind: "image", status: "running" }, mediaOperations: [{ kind: "image", status: "running" }] }], ["Facebook"]);
    const restored = restoreSnapshot([], ["Facebook"]);
    expect((restored.drafts[0] as { mediaOperation: { status: string; reason: string } }).mediaOperation).toMatchObject({ status: "failed", reason: "APP_RESTART_INTERRUPTED" });
    expect((restored.drafts[0] as { mediaOperations: Array<{ status: string; reason: string }> }).mediaOperations[0]).toMatchObject({ status: "failed", reason: "APP_RESTART_INTERRUPTED" });
  });

  it("excludes duplicate, used, and reserved media with deterministic review reasons", () => {
    const ledger = new MediaReservationLedger();
    const reserved = validAsset({ id: "reserved" });
    ledger.reserve({ assetId: reserved.id, reservationKey: "r-reserved", channel: "facebook", dayKey: "2026-08-23" });
    expect(selectMediaForPost([validAsset({ id: "duplicate", duplicateStatus: "duplicate", duplicateReason: "Exact SHA-256 match" }), validAsset({ id: "used", usageStatus: "used", usedReason: "Published on Page A" }), reserved], { brandId: "brand-1", campaignId: "campaign-1", topic: "emergency fund", platform: "facebook", kind: "image" }, ledger)).toBeUndefined();
    expect(getMediaEligibilityReason(validAsset({ duplicateStatus: "duplicate", duplicateReason: "Exact SHA-256 match" }), ledger)).toBe("Duplicate: Exact SHA-256 match");
    expect(getMediaEligibilityReason(validAsset({ usageStatus: "used", usedReason: "Published on Page A" }), ledger)).toBe("Used: Published on Page A");
    expect(getMediaEligibilityReason(reserved, ledger)).toBe("Reserved by r-reserved");
  });

  it("selects the same eligible asset deterministically and reports review blockers", () => {
    const ledger = new MediaReservationLedger();
    const assets = [validAsset({ id: "z", modifiedAt: "2026-08-22T00:00:00.000Z" }), validAsset({ id: "a", modifiedAt: "2026-08-23T00:00:00.000Z" })];
    expect(selectMediaForPost(assets, { brandId: "brand-1", campaignId: "campaign-1", topic: "emergency fund", platform: "facebook", kind: "image" }, ledger)?.id).toBe("a");
    expect(getMediaEligibilityReason(validAsset({ reviewStatus: "needs_review" }), ledger)).toBe("Needs review: verify public URL, SHA-256, and visual fingerprint");
  });

  it("enforces the CreativeRun idea to image to copy to review to scheduled/published state machine", () => {
    const run = createCreativeRun({ id: "run-1", brandId: "brand-1", topic: "Emergency fund", imageProvider: "local_preview", now: new Date("2026-08-23T00:00:00.000Z") });
    const image = transitionCreativeRun(run, "image");
    const copy = transitionCreativeRun(image, "copy");
    const review = transitionCreativeRun(copy, "review");
    const scheduled = transitionCreativeRun(review, "scheduled");
    const published = transitionCreativeRun(scheduled, "published");
    expect(published.state).toBe("published");
    expect(() => transitionCreativeRun(run, "published")).toThrow("Invalid CreativeRun transition: idea -> published");
  });

  it("persists the media-selected to copy attempt before the awaited provider operation", async () => {
    const run = transitionCreativeRun(createCreativeRun({ id: "copy-order", brandId: "brand-1", topic: "Emergency fund", imageProvider: "local_preview", now: new Date("2026-08-23T00:00:00.000Z") }), "media_selected");
    const events: string[] = [];
    let releaseProvider: (() => void) | undefined;
    const provider = new Promise<string>((resolve) => { releaseProvider = () => resolve("provider-result"); });
    const attempt = runCreativeCopyAttempt(run, (next) => events.push(`persist:${next.state}`), async () => {
      events.push("provider:await");
      return await provider;
    }, new Date("2026-08-23T00:00:01.000Z"));
    expect(events).toEqual(["persist:copy", "provider:await"]);
    releaseProvider?.();
    await expect(attempt).resolves.toMatchObject({ run: { state: "copy" }, result: "provider-result" });
  });

  it("walks media_selected through copy to content_generated and needs_review, and releases a failed copy reservation", () => {
    const run = transitionCreativeRun(createCreativeRun({ id: "copy-review", brandId: "brand-1", topic: "Emergency fund", imageProvider: "local_preview", now: new Date("2026-08-23T00:00:00.000Z") }), "media_selected");
    const copy = transitionCreativeRun(run, "copy");
    const content = transitionCreativeRun(copy, "content_generated");
    const review = transitionCreativeRun(content, "needs_review");
    expect(review).toMatchObject({ state: "needs_review", reviewedAt: expect.any(String) });

    const ledger = new MediaReservationLedger();
    const reservationKey = "copy-review:reservation";
    expect(ledger.reserve({ assetId: "asset-1", reservationKey, channel: "facebook", dayKey: "2026-08-23" })).toBe(true);
    const failed = { ...copy, state: "failed" as const, error: "CREATIVE_COPY_FAILED:GEMINI_WEB_RESPONSE_TIMEOUT" };
    expect(ledger.release(reservationKey)).toBe(true);
    expect(ledger.get(reservationKey)).toBeUndefined();
    expect(failed).toMatchObject({ state: "failed", error: "CREATIVE_COPY_FAILED:GEMINI_WEB_RESPONSE_TIMEOUT" });
    expect(safeCreativeRunError(new Error("GEMINI_WEB_RESPONSE_TIMEOUT at /private/local/image.png"), "CREATIVE_COPY_FAILED")).toBe("CREATIVE_COPY_FAILED:GEMINI_WEB_RESPONSE_TIMEOUT");
    expect(safeCreativeRunError(new Error("provider rejected"), "CREATIVE_COPY_FAILED")).toBe("CREATIVE_COPY_FAILED:PROVIDER_ERROR");
  });

  it("retries a failed CreativeRun only by creating a fresh idea state", () => {
    const failed = { ...createCreativeRun({ id: "retry-1", brandId: "brand-1", topic: "Emergency fund", imageProvider: "google_flow", now: new Date("2026-08-23T00:00:00.000Z") }), state: "failed" as const, error: "FLOW_DOWNLOAD_TIMEOUT" };
    expect(retryCreativeRun(failed, new Date("2026-08-23T00:02:00.000Z"))).toMatchObject({ id: "retry-1", state: "idea", imageProvider: "google_flow" });
    expect(() => retryCreativeRun(createCreativeRun({ id: "not-failed", brandId: "brand-1", topic: "x", imageProvider: "local_preview" }))).toThrow("requires failed state");
  });

  it("never treats unverified Google Flow or Vertex AI configuration as live-ready", () => {
    expect(canUseImageProvider("google_flow", { managedBrowserSession: true, signalFlowSessionVerified: false })).toMatchObject({ allowed: false, reason: "Google Flow session is not verified." });
    expect(canUseImageProvider("vertex_ai", { projectId: "project-1", nativeSecureStore: true, officialApiVerified: false })).toMatchObject({ allowed: false, reason: "Vertex AI official API boundary is not verified." });
    expect(canUseImageProvider("local_preview", {})).toMatchObject({ allowed: true, live: false });
  });

  it("walks the production state machine through media selection, review, approval, scheduling and publish", () => {
    const idea = createCreativeRun({ id: "run-production", brandId: "brand-1", topic: "Emergency fund", imageProvider: "local_preview", platform: "facebook", targetPageId: "page-a", automationKey: "plan:day:facebook:0", mediaAssetId: "asset-1", mediaProvenance: { source: "google_drive", providerFileId: "drive-1" }, now: new Date("2026-08-23T00:00:00.000Z") });
    const selected = transitionCreativeRun(idea, "media_selected");
    const content = transitionCreativeRun(selected, "content_generated");
    const review = transitionCreativeRun(content, "needs_review");
    const approved = transitionCreativeRun(review, "approved");
    const scheduled = transitionCreativeRun(approved, "scheduled");
    const published = transitionCreativeRun(scheduled, "published");
    expect(published).toMatchObject({ state: "published", targetPageId: "page-a", mediaAssetId: "asset-1", mediaProvenance: { providerFileId: "drive-1" } });
    expect(() => transitionCreativeRun(idea, "published")).toThrow("Invalid CreativeRun transition: idea -> published");
  });

  it("blocks video near-dedupe and eligibility when no decoded frame fingerprint exists", () => {
    const video = validAsset({ id: "video-1", kind: "video", mimeType: "video/mp4", visualFingerprint: "0000000000000000", visualFingerprintSource: undefined });
    const similarVideo = validAsset({ id: "video-2", kind: "video", mimeType: "video/mp4", normalizedDriveFileId: "drive-video-2", sha256: "b".repeat(64), visualFingerprint: "0000000000000001", visualFingerprintSource: undefined });
    expect(isMediaEligible(video)).toBe(false);
    expect(findDuplicateMedia(video, [similarVideo])).toBeUndefined();
    expect(getMediaEligibilityReason(video)).toBe("Needs review: re-analyze locally to record decoded fingerprint provenance");
  });

  it("maps legacy creative states during migration and removes sensitive-shaped persisted keys", () => {
    const store = installStore();
    store.set("signalflow.workspace.snapshot.v3", JSON.stringify({ drafts: [], selectedPlatforms: ["Facebook"], automationState: { schemaVersion: 1, brandPlans: [], mediaAssets: [], reservations: [], creativeRuns: [{ id: "legacy", brandId: "brand-1", topic: "x", state: "review", access_token: "redacted", promptVersion: "v1", brandVoiceVersion: "v1", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" }] } }));
    const restored = restoreSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, [], undefined);
    expect(restored.automationState?.creativeRuns[0]).toMatchObject({ state: "needs_review" });
    expect(JSON.stringify(restored)).not.toContain("access_token");
  });
});


describe("renderer copy checkpoint durability", () => {
  it("rejects a synthetic schedule marker as the durable CreativeRun topic", () => {
    const store = installStore();
    const run = createCreativeRun({ id: "synthetic-topic", brandId: "brand-1", topic: "Bellamy Baby · facebook · 09:00", imageProvider: "google_flow", platform: "facebook", targetPageId: "page-1", automationKey: "automation-key", now: new Date("2026-08-24T07:20:00.000Z") });
    persistAutomationCheckpoint("profile-bavy", { ...run, state: "needs_review", updatedAt: "2026-08-24T07:30:00.000Z" });
    const raw = store.get("signalflow.profile.profile-bavy.automation.creative-checkpoints.v1");
    expect(raw ?? "").not.toContain("Bellamy Baby · facebook · 09:00");
  });

  it("restores only the active profile checkpoint when run and automation IDs are shared", () => {
    const store = installStore();
    const sameIdentity = { id: "creative-cloned-run", brandId: "brand-shared", imageProvider: "google_flow" as const, platform: "facebook" as const, targetPageId: "page-shared", automationKey: "plan:shared:facebook:0" };
    const runA = createCreativeRun({ ...sameIdentity, topic: "Profile A baseline", now: new Date("2026-08-24T07:20:00.000Z") });
    const runB = createCreativeRun({ ...sameIdentity, topic: "Profile B baseline", now: new Date("2026-08-24T07:20:00.000Z") });
    const stateFor = (run: typeof runA) => ({ schemaVersion: 1 as const, brandPlans: [], mediaAssets: [], reservations: [], creativeRuns: [run], imageProvider: "google_flow" as const });
    persistSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, undefined, [], stateFor(runA), false, "profile-a");
    persistSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, undefined, [], stateFor(runB), false, "profile-b");

    persistAutomationCheckpoint("profile-a", {
      ...runA,
      state: "needs_review",
      topic: "Profile A checkpoint only",
      ideaProvider: "gemini_web",
      updatedAt: "2026-08-24T07:30:00.000Z",
    });

    const restoredA = restoreSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, [], undefined, "profile-a");
    const restoredB = restoreSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, [], undefined, "profile-b");
    expect(restoredA.automationState?.creativeRuns[0]).toMatchObject({ id: runA.id, state: "needs_review", topic: "Profile A checkpoint only" });
    expect(restoredB.automationState?.creativeRuns[0]).toMatchObject({ id: runB.id, state: "idea", topic: "Profile B baseline" });
    expect(store.get("signalflow.profile.profile-b.automation.creative-checkpoints.v1")).toBeUndefined();
  });

  it("migrates the legacy global checkpoint ledger into the owner profile only", () => {
    const store = installStore();
    const ownerRun = createCreativeRun({ id: "legacy-shared-run", brandId: "brand-shared", topic: "Owner baseline", imageProvider: "google_flow", automationKey: "plan:shared:facebook:0", now: new Date("2026-08-24T07:20:00.000Z") });
    const otherRun = { ...ownerRun, topic: "Profile B baseline" };
    const stateFor = (run: typeof ownerRun) => ({ schemaVersion: 1 as const, brandPlans: [], mediaAssets: [], reservations: [], creativeRuns: [run], imageProvider: "google_flow" as const });
    persistSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, undefined, [], stateFor(ownerRun), false, "profile-bavy");
    persistSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, undefined, [], stateFor(otherRun), false, "profile-b");
    store.set("signalflow.automation.creative-checkpoints.v1", JSON.stringify({
      [ownerRun.id]: { state: "needs_review", updatedAt: "2026-08-24T07:30:00.000Z", run: { topic: "Legacy owner checkpoint" } },
    }));

    const restoredB = restoreSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, [], undefined, "profile-b");
    const restoredOwner = restoreSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, [], undefined, "profile-bavy");

    expect(restoredB.automationState?.creativeRuns[0]).toMatchObject({ state: "idea", topic: "Profile B baseline" });
    expect(restoredOwner.automationState?.creativeRuns[0]).toMatchObject({ state: "needs_review", topic: "Legacy owner checkpoint" });
    expect(store.get("signalflow.profile.profile-bavy.automation.creative-checkpoints.v1")).toBeDefined();
    expect(store.get("signalflow.profile.profile-b.automation.creative-checkpoints.v1")).toBeUndefined();
  });

  it("restores the newest provider result fields from a checkpoint over a stale snapshot", () => {
    const store = installStore();
    const staleRun = createCreativeRun({ id: "converge-run", brandId: "brand-bellamy", topic: "Bellamy Baby", imageProvider: "google_flow", platform: "facebook", targetPageId: "100000000000001", automationKey: "plan:day:facebook:0:100000000000001", now: new Date("2026-08-24T07:20:00.000Z") });
    persistSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, undefined, [], {
      schemaVersion: 1,
      brandPlans: [],
      mediaAssets: [validAsset({ id: "drive-asset", providerFileId: "drive-file" })],
      reservations: [],
      creativeRuns: [{ ...staleRun, ideaProvider: "mock", copyProvider: "mock", copyResult: { imageAware: false }, updatedAt: "2026-08-24T07:25:00.000Z" }],
      imageProvider: "google_flow",
    });
    const newestRun = {
      ...staleRun,
      state: "needs_review" as const,
      ideaProvider: "gemini_web",
      copyProvider: "gemini_web",
      copyResult: { provider: "gemini_web", imageAware: true, title: "CHECKPOINT_RESPONSE_TITLE_SENTINEL", body: "CHECKPOINT_RESPONSE_BODY_SENTINEL" },
      mediaAssetId: "drive-asset",
      mediaProvenance: { source: "google_drive" as const, providerFileId: "drive-file" },
      updatedAt: "2026-08-24T07:30:00.000Z",
    };
    persistAutomationCheckpoint("profile-bavy", newestRun);
    const checkpointJson = store.get("signalflow.profile.profile-bavy.automation.creative-checkpoints.v1") ?? "";
    expect(checkpointJson).not.toContain("CHECKPOINT_RESPONSE_TITLE_SENTINEL");
    expect(checkpointJson).not.toContain("CHECKPOINT_RESPONSE_BODY_SENTINEL");
    const restored = restoreSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, [], undefined, "profile-bavy");
    expect(restored.automationState?.creativeRuns[0]).toMatchObject({
      id: newestRun.id,
      state: "needs_review",
      ideaProvider: "gemini_web",
      copyProvider: "gemini_web",
      copyResult: { provider: "gemini_web", imageAware: true },
      mediaAssetId: "drive-asset",
      mediaProvenance: { providerFileId: "drive-file" },
    });
  });

  it("persists the copy stage before the provider promise resolves", async () => {
    const store = installStore();
    const mediaSelected = transitionCreativeRun(createCreativeRun({ id: "durable-copy", brandId: "brand-1", topic: "Bellamy Baby", imageProvider: "google_flow", platform: "facebook", targetPageId: "100000000000001", automationKey: "automation-key", mediaAssetId: "drive-asset", mediaProvenance: { source: "google_drive", providerFileId: "1Zyx-wVuTsRqPoNmLkJiHg__FeDcBa-01" }, now: new Date("2026-08-24T00:00:00.000Z") }), "media_selected", new Date("2026-08-24T00:00:00.000Z"));
    const baseState = { schemaVersion: 1 as const, brandPlans: [], mediaAssets: [], reservations: [], creativeRuns: [mediaSelected], imageProvider: "google_flow" as const };
    persistSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, undefined, [], baseState);
    let releaseProvider: (() => void) | undefined;
    const provider = new Promise<string>((resolve) => { releaseProvider = () => resolve("stable-provider-result"); });
    const attempt = runCreativeCopyAttempt(mediaSelected, (copyRun) => {
      persistAutomationCheckpoint("profile-bavy", copyRun);
    }, async () => await provider, new Date("2026-08-24T00:00:01.000Z"));

    const restoredBeforeProvider = restoreSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, [], undefined, "profile-bavy");
    expect(restoredBeforeProvider.automationState?.creativeRuns[0]).toMatchObject({ id: mediaSelected.id, state: "copy" });
    expect(store.has("signalflow.workspace.snapshot.v3")).toBe(true);
    releaseProvider?.();
    await expect(attempt).resolves.toMatchObject({ run: { state: "copy" }, result: "stable-provider-result" });
  });
});

it("keeps typed media reconciliation and residual IDs through a checkpoint reload and blocks blind retry", () => {
  installStore();
  const run = createCreativeRun({ id: "receipt-checkpoint", brandId: "brand-1", topic: "Approved evidence", imageProvider: "google_flow", now: new Date("2026-09-14T00:00:00Z") });
  const state = { schemaVersion: 1 as const, brandPlans: [], mediaAssets: [], reservations: [], creativeRuns: [run], imageProvider: "google_flow" as const };
  persistSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, undefined, [], state, false, "profile-receipts");
  const mediaOwnershipReconciliation = { code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED" as const, rollback: { attemptedAssetIds: [] as string[], remainingAssetIds: ["asset-a"], verified: true, failures: [{ code: "CONTENT_RUN_CREATE_OUTCOME_RECONCILIATION_REQUIRED" }] }, contentRun: { id: run.id, outcome: "unknown" as const } };
  persistAutomationCheckpoint("profile-receipts", { ...run, state: "failed", mediaOwnershipReconciliation, updatedAt: "2026-09-14T01:00:00Z" });
  const restored = restoreSnapshot([], ["Facebook"], undefined, undefined, undefined, undefined, [], undefined, "profile-receipts").automationState!.creativeRuns[0];
  expect(restored.mediaOwnershipReconciliation).toEqual(mediaOwnershipReconciliation);
  expect(() => retryCreativeRun(restored)).toThrow("MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED");
});
