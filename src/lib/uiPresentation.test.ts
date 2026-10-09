import { describe, expect, it } from "vitest";
import { draftPublishBlocker, GENERATED_MEDIA_HOSTING_NEXT_ACTION, generatedMediaHostingNextAction, hydrateRestoredMediaCardDistribution, mediaBlockers, mediaDistributionLabel, mediaStateBadges, plannerAssetBlockerSummary, plannerAssetFilter, projectStrategyCatalogForUi, publishCommandOutcome, resolveDraftTargetTime, resolveTargetDisplayName, shouldOpenRowFromKey, summarizeMediaAssets, targetActionModalFocusTarget, targetActionSelectionOutcome, type PresentationMediaAsset } from "./uiPresentation";
import { bellamyBabyStrategyCatalog, strategyCatalogFingerprint, type BrandStrategyCatalog } from "./contentStrategy";

const eligibleImage: PresentationMediaAsset = {
  name: "hero.png",
  kind: "Image",
  status: "Ready",
  duplicateStatus: "unique",
  usageStatus: "available",
  publicUrl: "https://cdn.example.test/hero.png",
  publicUrlVerified: true,
  checksum: `sha256:${"a".repeat(64)}`,
  visualFingerprint: "0000000000000000",
  visualFingerprintSource: "decoded_image",
};

const blockedVideo: PresentationMediaAsset = {
  name: "reel.mp4",
  kind: "Video",
  status: "Needs review",
  duplicateStatus: "duplicate",
  duplicateKind: "near",
  duplicateReason: "near match with hero.mp4",
  usageStatus: "reserved",
  reservedReason: "brand-1:page-1:slot-2",
  publicUrl: "https://cdn.example.test/reel.mp4",
  publicUrlVerified: false,
  checksum: undefined,
  visualFingerprint: undefined,
};

describe("frontend media presentation contracts", () => {
  it("gives Publish one truthful blocker across draft and durable target states", () => {
    const draft = { id: 7, clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", status: "Scheduled", qualityStatus: "passed", approvalState: "ready" };
    const acknowledged = [{ id: "pub-7", clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", variantId: "variant-7", state: "scheduled", commandStatus: "acknowledged", workerAckState: "acknowledged" }];

    expect(draftPublishBlocker({ ...draft, qualityStatus: "pending" }, acknowledged)).toMatch(/Quality check/i);
    expect(draftPublishBlocker(draft, [{ ...acknowledged[0]!, commandStatus: "pending", workerAckState: "pending" }])).toMatch(/reconciliation/i);
    expect(draftPublishBlocker({ ...draft, pendingPublicationIds: ["pub-pending"] }, [{ ...acknowledged[0]!, id: "pub-pending", commandStatus: "pending", workerAckState: "pending" }])).toMatch(/reconciliation/i);
    expect(draftPublishBlocker({ ...draft, status: "Needs review", approvalState: "proposed" }, acknowledged)).toMatch(/approved and scheduled/i);
    expect(draftPublishBlocker(draft, [])).toMatch(/no acknowledged target job/i);
    expect(draftPublishBlocker(draft, acknowledged)).toBeUndefined();
    expect(draftPublishBlocker(draft, [{ ...acknowledged[0]!, state: "published", providerJobId: "provider-7" }])).toMatch(/already published/i);
  });

  it("evaluates Publish eligibility per selected target when a Content Run has mixed target states", () => {
    const draft = { id: 7, clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", status: "Published", qualityStatus: "passed", approvalState: "published" };
    const targets = [
      { id: "publication-done", clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", variantId: "variant-7", state: "published", commandStatus: "acknowledged", workerAckState: "acknowledged", providerJobId: "provider-7" },
      { id: "publication-live", clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", variantId: "variant-7", state: "scheduled", commandStatus: "acknowledged", workerAckState: "acknowledged" },
      { id: "publication-pending", clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", variantId: "variant-7", state: "scheduled", commandStatus: "pending", workerAckState: "pending" },
    ];

    expect(draftPublishBlocker(draft, targets)).toBeUndefined();
    expect(draftPublishBlocker(draft, targets, "publication-live")).toBeUndefined();
    expect(draftPublishBlocker(draft, targets, "publication-done")).toMatch(/already published/i);
    expect(draftPublishBlocker(draft, targets, "publication-pending")).toMatch(/reconciliation/i);
    expect(draftPublishBlocker(draft, targets, "missing-publication")).toMatch(/not part of this Content Run/i);
  });

  it("presents only provider-backed Publish acknowledgement outcomes", () => {
    expect(publishCommandOutcome({ commandStatus: "acknowledged", workerAckState: "acknowledged", state: "queued" })).toMatchObject({ status: "pending", code: "PROVIDER_CONFIRMATION_PENDING" });
    expect(publishCommandOutcome({ commandStatus: "acknowledged", workerAckState: "acknowledged", state: "published", providerJobId: "provider-1" })).toMatchObject({ status: "success", code: "LIVE_PROVIDER_ACKNOWLEDGED", message: expect.stringMatching(/provider confirmed Published/i) });
    expect(publishCommandOutcome({ commandStatus: "acknowledged", workerAckState: "acknowledged", state: "published", providerJobId: "provider-1" }).message).not.toMatch(/remains Scheduled|waiting for provider/i);
    expect(publishCommandOutcome({ commandStatus: "failed" })).toMatchObject({ status: "failure", code: "PUBLISH_COMMAND_BLOCKED" });
    expect(publishCommandOutcome({ simulation: true })).toMatchObject({ status: "failure", code: "TARGET_PUBLICATION_SIMULATION_REMOVED" });
    expect(publishCommandOutcome({ legacyNonLive: true })).toMatchObject({ status: "failure", code: "LEGACY_NON_LIVE_ACTION_BLOCKED" });
  });

  it("keeps a selected acknowledged target publishable when a sibling is pending", () => {
    const draft = { id: 7, clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", status: "Scheduled", qualityStatus: "passed", approvalState: "ready", pendingPublicationIds: ["publication-pending"] };
    const targets = [
      { id: "publication-done", clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", variantId: "variant-7", state: "published", commandStatus: "acknowledged", workerAckState: "acknowledged", providerJobId: "provider-7" },
      { id: "publication-live", clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", variantId: "variant-7", state: "scheduled", commandStatus: "acknowledged", workerAckState: "acknowledged" },
      { id: "publication-pending", clientId: "client-a", brandId: "brand-a", contentRunId: "run-7", variantId: "variant-7", state: "scheduled", commandStatus: "pending", workerAckState: "pending" },
    ];
    expect(draftPublishBlocker(draft, targets)).toBeUndefined();
    expect(draftPublishBlocker(draft, targets, "publication-live")).toBeUndefined();
    expect(draftPublishBlocker(draft, targets, "publication-pending")).toMatch(/selected target/i);
  });

  it("clears target selection without producing a Control Plane command", () => {
    expect(targetActionSelectionOutcome(undefined, "")).toEqual({ clearSelection: true, command: undefined });
    expect(targetActionSelectionOutcome({ action: "publish_now", scopeKey: "scope-a" }, "publication-a")).toEqual({ clearSelection: true, command: { action: "publish_now", jobId: "publication-a" } });
  });

  it("keeps target modal Tab focus inside the dialog", () => {
    expect(targetActionModalFocusTarget("Tab", false, 3, 4)).toBe("first");
    expect(targetActionModalFocusTarget("Tab", true, 0, 4)).toBe("last");
    expect(targetActionModalFocusTarget("Tab", false, -1, 4, true)).toBe("first");
    expect(targetActionModalFocusTarget("Tab", true, -1, 4, true)).toBe("last");
    expect(targetActionModalFocusTarget("Tab", false, 1, 4)).toBeUndefined();
    expect(targetActionModalFocusTarget("Escape", false, 3, 4)).toBeUndefined();
  });

  it("opens a row from its own Enter/Space key but ignores nested interactive controls", () => {
    const row = {};
    const menuButton = { closest: (selector: string) => selector.includes("button") ? {} : null };
    const textChild = { closest: () => null };
    expect(shouldOpenRowFromKey("Enter", row, row)).toBe(true);
    expect(shouldOpenRowFromKey(" ", textChild, row)).toBe(true);
    expect(shouldOpenRowFromKey("Enter", menuButton, row)).toBe(false);
    expect(shouldOpenRowFromKey(" ", menuButton, row)).toBe(false);
    expect(shouldOpenRowFromKey("Escape", row, row)).toBe(false);
  });

  it("summarizes eligible, blocked, ledger, and evidence states", () => {
    expect(summarizeMediaAssets([eligibleImage, blockedVideo, { kind: "Audio", status: "Local" }])).toMatchObject({
      total: 3,
      working: 2,
      eligible: 1,
      blocked: 1,
      reserved: 1,
      duplicates: 0,
      nearDuplicates: 1,
      publicVerified: 1,
      shaVerified: 1,
      fingerprintVerified: 1,
    });
  });

  it("keeps duplicate and reservation blockers scannable and itemized", () => {
    expect(mediaBlockers(blockedVideo)).toEqual([
      "Near duplicate · near match with hero.mp4",
      "Reserved · brand-1:page-1:slot-2",
      "Public link not verified",
      "SHA-256 not verified",
      "Visual fingerprint not available",
      "Review gates incomplete",
    ]);
    expect(plannerAssetBlockerSummary([eligibleImage, blockedVideo])).toEqual([{ name: "reel.mp4", blockers: mediaBlockers(blockedVideo) }]);
    expect(mediaStateBadges(blockedVideo).map((badge) => badge.label)).toEqual(["Near duplicate", "Reserved", "Public unverified", "SHA missing", "Fingerprint missing"]);
  });

  it("shows the hosting next action only for unhosted generated media", () => {
    expect(generatedMediaHostingNextAction({ provenanceSource: "generated" })).toBe(GENERATED_MEDIA_HOSTING_NEXT_ACTION);
    expect(generatedMediaHostingNextAction({ provenanceSource: "generated", publicUrl: "https://drive.google.com/uc?id=asset" })).toBeUndefined();
    expect(generatedMediaHostingNextAction({ provenanceSource: "generated", publicUrlVerified: true })).toBeUndefined();
    expect(generatedMediaHostingNextAction({ provenanceSource: "google_drive" })).toBeUndefined();
  });

  it("labels universal, platform-scoped, and missing media distribution safely", () => {
    expect(mediaDistributionLabel("universal", "Drive inventory")).toBe("Universal media · reusable across enabled channels");
    expect(mediaDistributionLabel("instagram", "Drive inventory")).toBe("Instagram-scoped media");
    expect(mediaDistributionLabel(undefined, "Drive inventory")).toBe("Drive inventory");
  });

  it("hydrates restored Drive visual cards universally while preserving generated platform scope", () => {
    const restoredEvidence = { providerFileId: "drive-asset-1", checksum: "sha256:abc", reviewStatus: "verified" as const };
    expect(hydrateRestoredMediaCardDistribution({ kind: "Image" as const, registrationMode: "google_drive" as const, ...restoredEvidence })).toMatchObject({ distribution: "universal", ...restoredEvidence });
    expect(hydrateRestoredMediaCardDistribution({ kind: "Video" as const, registrationMode: "google_drive" as const, ...restoredEvidence })).toMatchObject({ distribution: "universal", ...restoredEvidence });
    expect(hydrateRestoredMediaCardDistribution({ kind: "Image" as const, registrationMode: "generated" as const, platform: "facebook" as const })).toMatchObject({ distribution: "facebook" });
  });

  it("filters Audio and Unknown out of planner visual media", () => {
    expect(plannerAssetFilter(eligibleImage)).toBe(true);
    expect(plannerAssetFilter({ kind: "Audio", status: "Local" })).toBe(false);
    expect(plannerAssetFilter({ kind: "Unknown", status: "Needs review" })).toBe(false);
  });

  it("resolves internal connection ids to human target names without leaking ids", () => {
    const names = { "100000000000001": "Bellamy Baby", "connection-instagram": "Bellamy Instagram" };
    expect(resolveTargetDisplayName("meta-page-100000000000001", names)).toBe("Bellamy Baby");
    expect(resolveTargetDisplayName("connection-instagram", names)).toBe("Bellamy Instagram");
    expect(resolveTargetDisplayName("meta-page-unknown", names)).toBe("Facebook Page");
    expect(resolveTargetDisplayName("connection-unknown", names)).toBe("Social target");
    expect(resolveTargetDisplayName("meta-page-999", { "999": "999" })).toBe("Facebook Page");
    expect(resolveTargetDisplayName("connection-999", { "connection-999": "999" }, "Facebook Page")).toBe("Facebook Page");
    expect(resolveDraftTargetTime("Planner · 23:10 · 100000000000001", "meta-page-100000000000001", { "100000000000001": "Bellamy Baby" })).toBe("Planner · 23:10 · Bellamy Baby");
  });
});

describe("effective strategy catalog UI projection", () => {
  const makeCatalog = (): BrandStrategyCatalog => {
    const catalog = bellamyBabyStrategyCatalog(new Date("2026-09-15T00:00:00.000Z"));
    catalog.channelOverrides.instagram = {
      disabledObjectiveKeys: ["conversion", "reach"],
      disabledPillarIds: ["brand-trust"],
      disabledAngleIds: ["product-proof-everyday-use", "product-proof-fit-and-comfort"],
      addedPillars: [{
        id: "instagram-community",
        label: "Instagram community",
        description: "Create useful community prompts.",
        enabled: true,
        order: 6,
        channels: ["instagram"],
        angles: [{ id: "instagram-community-story", label: "Community story", guidance: "Share one real community story.", enabled: true, order: 1, channels: ["instagram"] }],
      }],
      addedAnglesByPillarId: {
        "product-proof": [{ id: "instagram-material-closeup", label: "Material close-up", guidance: "Show material detail in a close crop.", enabled: true, order: 4, channels: ["instagram"] }],
      },
    };
    return catalog;
  };

  it("projects selected channel disables and additions with sorted override IDs", () => {
    const projection = projectStrategyCatalogForUi(makeCatalog(), "instagram");

    expect(projection).toMatchObject({
      channel: "instagram",
      disabledObjectiveKeys: ["conversion", "reach"],
      disabledPillarIds: ["brand-trust"],
      disabledAngleIds: ["product-proof-everyday-use", "product-proof-fit-and-comfort"],
      addedPillarIds: ["instagram-community"],
      addedAngleIds: ["instagram-material-closeup"],
    });
    expect(projection.catalog.channelOverrides).toEqual({});
    expect(projection.catalog.objectives.map((objective) => objective.key)).toEqual(["engagement", "education", "knowledge"]);
    expect(projection.catalog.pillars.map((pillar) => pillar.id)).toEqual(["product-proof", "care-and-material", "parent-guidance", "style-and-occasion", "instagram-community"]);
    expect(projection.catalog.pillars[0].angles.map((angle) => angle.id)).toEqual(["product-proof-material-detail", "instagram-material-closeup"]);
  });

  it("does not mutate the input and returns detached catalog data", () => {
    const source = makeCatalog();
    const before = structuredClone(source);
    const projection = projectStrategyCatalogForUi(source, "instagram");

    expect(source).toEqual(before);
    projection.catalog.pillars[0].angles[0].label = "Changed in projection";
    projection.disabledAngleIds.push("projection-only");
    expect(source).toEqual(before);
  });

  it("keeps fingerprints stable and changes them when the effective catalog changes", () => {
    const source = makeCatalog();
    const first = projectStrategyCatalogForUi(source, "instagram");

    expect(first.fingerprint).toBe(projectStrategyCatalogForUi(source, "instagram").fingerprint);
    expect(first.fingerprint).toBe(strategyCatalogFingerprint(first.catalog));

    const changed = structuredClone(source);
    changed.channelOverrides.instagram!.guidanceByAngleId = { "product-proof-material-detail": "Use a brighter close crop." };
    expect(projectStrategyCatalogForUi(changed, "instagram").fingerprint).not.toBe(first.fingerprint);
  });

  it("throws STRATEGY_CATALOG_INVALID for invalid catalog or channel", () => {
    expect(() => projectStrategyCatalogForUi(null as never, "instagram")).toThrow("STRATEGY_CATALOG_INVALID");
    expect(() => projectStrategyCatalogForUi(makeCatalog(), "linkedin" as never)).toThrow("STRATEGY_CATALOG_INVALID");
  });
});
