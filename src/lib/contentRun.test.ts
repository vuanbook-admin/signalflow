import { describe, expect, it } from "vitest";
import { beginDraftAction, buildPublishReadinessChecks, contentRewriteBlocker, contentRevisionFingerprint, contentRunQualityExpectedRevisionFields, contentRunRevisionFieldsFromDraft, createContentRun, draftActionLockKey, draftActionScopeKey, endDraftAction, hasDraftActionInFlight, hasActiveContentRunPublication, initialContentRunRevisionId, markNeedsRegeneration, qualityAcknowledgementMatches, reconcilePendingGeneration, runContentRewriteSingleFlight, submitContentRunQualityCheck, updateContentRunGeneration } from "./contentRun";
async function runs() { return await import("./contentRun").catch(() => undefined); }
describe("manual and automation Content Runs", () => {
  it("rejects a rewrite recipe that no longer matches the edited strategy before creating a child", async () => {
    const api = await runs(); expect(api).toBeDefined(); if (!api) return;
    const recipe = { id: "recipe-a", brandId: "brand-a", name: "Proof flow", platforms: ["facebook"], contentKinds: ["text"], pillarId: "audience-insight", angleId: "audience-insight-pain-point", hookGuidance: "Open with proof", structureGuidance: "Context then action", ctaGuidance: "Invite a save", qualityChecklist: ["Check facts"], status: "active" } as const;
    expect(api.validateRewriteRecipeForStrategy(recipe, { pillarId: "audience-insight", angleId: "audience-insight-audience-question" })).toMatchObject({ ok: false, code: "RECIPE_STRATEGY_MISMATCH" });
    expect(api.validateRewriteRecipeForStrategy(recipe, { pillarId: "audience-insight", angleId: "audience-insight-pain-point" })).toEqual({ ok: true });
  });

  it("creates the same review-first run/variant shape for either trigger", async () => {
    const api = await runs(); expect(api).toBeDefined(); if (!api) return;
    const base = { id: "run-a", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a-v1", generationProfileId: "profile-a", executionMode: "llm_provider", providerTraceId: "trace-a", topic: "Topic", contentPillar: "Pillar", objective: "Education", caption: "Caption", body: "Caption", cta: "CTA", hashtags: ["#tag"], seoKeywords: ["keyword"], scheduledAt: "2026-08-30T10:00:00.000Z", sources: ["source"], notes: "Notes", targetPlatforms: ["facebook"], targetBindingIds: ["binding-a"], bindingIds: ["binding-a"], visualOperations: [{ type: "image", status: "completed" }], mediaOperations: [{ type: "image", status: "completed" }], qualityChecks: [{ key: "visual", passed: true }], qualityStatus: "passed", approvalState: "pending", trace: { providerTraceId: "trace-a" }, variants: [{ id: "variant-a", platform: "facebook", kind: "image", body: "Draft", mediaAssetIds: ["asset-a"], mediaOperations: [{ type: "image", status: "completed" }] }] } as const;
    const manual = api.createContentRun({ ...base, trigger: "manual" } as unknown as Parameters<typeof api.createContentRun>[0]);
    const automation = api.createContentRun({ ...base, trigger: "automation" } as unknown as Parameters<typeof api.createContentRun>[0]);
    expect(manual).toMatchObject({ state: "needs_review", trigger: "manual", variants: [expect.objectContaining({ lifecycle: "needs_review" })] });
    expect(automation).toMatchObject({ state: "needs_review", trigger: "automation", variants: [expect.objectContaining({ lifecycle: "needs_review" })] });
    for (const field of ["clientId", "brandId", "identityVersionId", "generationProfileId", "executionMode", "providerTraceId", "topic", "contentPillar", "objective", "caption", "body", "cta", "hashtags", "seoKeywords", "scheduledAt", "sources", "notes", "targetPlatforms", "targetBindingIds", "bindingIds", "visualOperations", "mediaOperations", "qualityChecks", "qualityStatus", "approvalState", "trace", "variants"] as const) expect(automation[field]).toEqual(manual[field]);
  });

  it("normalizes editable copy fields and exports caption with hashtags", async () => {
    const api = await runs(); expect(api).toBeDefined(); if (!api) return;
    const fields = api.normalizeEditableFields({ caption: "  Hello  ", cta: "  Book now ", hashtags: [" #SignalFlow ", "signalflow", ""], seoKeywords: [" social tool ", "social tool"], sources: ["  source-a "] });
    expect(fields).toMatchObject({ caption: "Hello", body: "Hello", cta: "Book now", hashtags: ["#SignalFlow"], seoKeywords: ["social tool"], sources: ["source-a"] });
    expect(api.exportContentText({ caption: fields.caption, hashtags: fields.hashtags })).toBe("Hello\n\n#SignalFlow");
  });

  it("reports readiness failures and passes without claiming live publish", async () => {
    const api = await runs(); expect(api).toBeDefined(); if (!api) return;
    const base = { id: "run-a", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a-v1", generationProfileId: "profile-a", executionMode: "llm_provider" as const, providerTraceId: "trace-a", trigger: "manual" as const, variants: [{ id: "variant-a", platform: "facebook" as const, kind: "text" as const, body: "Draft" }] };
    expect(api.checkPublishReadiness(api.createContentRun(base))).toMatchObject({ ok: false, failures: expect.arrayContaining(["approval"]) });
    const ready = api.createContentRun({ ...base, approvalState: "approved", qualityChecks: [{ key: "copy", passed: true }] });
    expect(api.checkPublishReadiness(ready)).toMatchObject({ ok: true, livePublishAttempted: false });
  });

  it("persists quality checks and rejects invalid transitions", async () => {
    const api = await runs(); expect(api).toBeDefined(); if (!api) return;
    const base = { id: "run-a", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a-v1", generationProfileId: "profile-a", executionMode: "llm_provider" as const, providerTraceId: "trace-a", trigger: "automation" as const, variants: [{ id: "variant-a", platform: "facebook" as const, kind: "text" as const, body: "Draft" }] };
    const checked = api.persistQualityChecks(api.createContentRun(base), [{ key: "copy", passed: true }]);
    expect(checked).toMatchObject({ state: "quality_passed", qualityStatus: "passed", qualityChecks: [{ key: "copy", passed: true }] });
    expect(() => api.transitionContentRun(checked, "published")).toThrow(/Invalid Content Run transition/);
    expect(api.transitionContentRun(checked, "ready").state).toBe("ready");
  });

  it("exposes the ten Revo publish-readiness checks as persisted-safe pure data", async () => {
    const api = await runs(); expect(api).toBeDefined(); if (!api) return;
    const run = api.createContentRun({ id: "run-readiness", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a-v1", generationProfileId: "profile-a", executionMode: "llm_provider", providerTraceId: "trace-a", trigger: "manual", topic: "Hook", contentPillar: "Education", objective: "Education", caption: "x", body: "x", cta: "Save", hashtags: ["#x"], variants: [{ id: "variant-a", platform: "facebook", kind: "image", body: "x", mediaAssetIds: ["asset-a"] }] });
    expect(api.buildPublishReadinessChecks(run)).toHaveLength(10);
    expect(api.buildPublishReadinessChecks(run).find((check) => check.key === "visual")?.passed).toBe(true);
  });

  it("marks interrupted pending generations unknown and requires new IDs for retries", () => {
    const pending = createContentRun({ id: "run-pending", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", generationProfileId: "profile-a", executionMode: "llm_provider", providerTraceId: "pending", trigger: "manual", requestId: "request-a", promptVersion: "revo-v1", generationStatus: "pending", variants: [] });
    expect(reconcilePendingGeneration(pending)).toMatchObject({ generationStatus: "unknown", requestId: "request-a" });
    expect(reconcilePendingGeneration({ ...pending, generationStatus: "completed" })).toMatchObject({ generationStatus: "completed" });
  });

  it("keeps an ordinary no-provider draft rewrite linked to a durable initial revision", () => {
    const parentRevisionId = initialContentRunRevisionId("run-ordinary");
    const parent = createContentRun({ id: "run-ordinary", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", generationProfileId: "manual-review", executionMode: "subscription_package", providerTraceId: "manual", trigger: "manual", revisionId: parentRevisionId, body: "Original copy", variants: [{ id: "variant-ordinary", platform: "facebook", kind: "text", body: "Original copy", metadata: { revisionId: parentRevisionId } }] });
    const child = createContentRun({ id: "run-ordinary-rewrite", clientId: parent.clientId, brandId: parent.brandId, identityVersionId: parent.identityVersionId, generationProfileId: parent.generationProfileId, executionMode: parent.executionMode, providerTraceId: "manual", trigger: "manual", revisionId: "revision-run-ordinary-rewrite", parentContentRunId: parent.id, parentRevisionId: parent.revisionId, body: "Rewritten copy", qualityStatus: "pending", approvalState: "pending", variants: [{ id: "variant-ordinary", platform: "facebook", kind: "text", body: "Rewritten copy", metadata: { revisionId: "revision-run-ordinary-rewrite", parentRevisionId: parent.revisionId } }] });
    expect(parent.revisionId).toBe(parentRevisionId);
    expect(child).toMatchObject({ parentContentRunId: parent.id, parentRevisionId, revisionId: "revision-run-ordinary-rewrite", state: "needs_review", qualityStatus: "pending", approvalState: "pending" });
    expect(parent.body).toBe("Original copy");
    expect(child.variants[0]?.metadata).toMatchObject({ revisionId: "revision-run-ordinary-rewrite", parentRevisionId });
  });

  it("completes only when every selected attachment has processed evidence", () => {
    const pending = createContentRun({ id: "run-a", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", generationProfileId: "profile-a", executionMode: "subscription_package", providerTraceId: "pending", trigger: "manual", requestId: "request-a", promptVersion: "revo-v1", generationStatus: "pending", mediaEvidence: [{ assetId: "asset-a", sha256: "a".repeat(64), mimeType: "image/png", order: 0, role: "publish", uploadState: "pending" }], variants: [] });
    expect(() => updateContentRunGeneration(pending, "completed")).toThrow("CONTENT_RUN_MEDIA_EVIDENCE_NOT_PROCESSED");
    expect(updateContentRunGeneration(pending, "completed", [{ assetId: "asset-a", sha256: "a".repeat(64), mimeType: "image/png", order: 0, role: "publish", uploadState: "processed", attachmentBoundary: "chat_upload" }])).toMatchObject({ generationStatus: "completed", mediaEvidence: [{ uploadState: "processed" }] });
    expect(updateContentRunGeneration(pending, "failed", [{ assetId: "asset-a", sha256: "a".repeat(64), mimeType: "image/png", order: 0, role: "publish", uploadState: "failed" }])).toMatchObject({ generationStatus: "failed", mediaEvidence: [{ uploadState: "failed" }] });
  });

  it("keeps media evidence immutable and blocks rewrites with an active scheduled target", () => {
    const evidence = [{ assetId: "asset-a", sha256: "a".repeat(64), mimeType: "image/jpeg", order: 0, role: "publish" as const, uploadState: "processed" as const }];
    const run = createContentRun({ id: "run-media", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", generationProfileId: "profile-a", executionMode: "llm_provider", providerTraceId: "trace-a", trigger: "manual", mediaEvidence: evidence, variants: [] });
    expect(run.mediaEvidence).toEqual(evidence);
    expect(hasActiveContentRunPublication([{ contentRunId: "run-media", variantId: "variant-a", state: "scheduled" }], "run-media")).toBe(true);
    expect(hasActiveContentRunPublication([{ contentRunId: "run-media", variantId: "variant-a", state: "published" }], "run-media")).toBe(false);
    expect(hasActiveContentRunPublication([{ contentRunId: "other-run", variantId: "variant-a", state: "scheduled" }], "run-media")).toBe(false);
  });

  it("rejects the second rewrite while the first rewrite is in flight and releases the guard", async () => {
    const inFlight = new Set<string>();
    let release!: () => void;
    const first = runContentRewriteSingleFlight(inFlight, "draft-1", () => new Promise((resolve) => { release = () => resolve("first"); }));
    await expect(runContentRewriteSingleFlight(inFlight, "draft-1", async () => "second")).resolves.toBeUndefined();
    release();
    await expect(first).resolves.toBe("first");
    await expect(runContentRewriteSingleFlight(inFlight, "draft-1", async () => "retry")).resolves.toBe("retry");
  });

  it("blocks rewrites without durable authority or while a prior outcome is unresolved", () => {
    expect(contentRewriteBlocker(false)).toBe("CONTENT_RUN_CONTROL_PLANE_REQUIRED");
    expect(contentRewriteBlocker(true, "pending")).toBe("CONTENT_RUN_RECONCILIATION_REQUIRED");
    expect(contentRewriteBlocker(true, "unknown")).toBe("CONTENT_RUN_RECONCILIATION_REQUIRED");
    expect(contentRewriteBlocker(true, "failed")).toBeUndefined();
    expect(contentRewriteBlocker(true, "completed")).toBeUndefined();
  });

  it("single-flights draft actions by active profile, Client, Brand, draft, Content Run, and action", () => {
    const scope = { profileId: "profile-a", profileRevision: 2, clientId: "client-a", brandId: "brand-a", draftId: 7, contentRunId: "run-7" };
    const scopeKey = draftActionScopeKey(scope);
    const locks = new Map<string, symbol>();
    const qualityKey = draftActionLockKey(scopeKey, "quality");
    const first = beginDraftAction(locks, qualityKey);

    expect(first).toBeDefined();
    expect(beginDraftAction(locks, qualityKey)).toBeUndefined();
    expect(hasDraftActionInFlight(locks, scopeKey, ["quality", "approval"])).toBe(true);
    expect(beginDraftAction(locks, draftActionLockKey(draftActionScopeKey({ ...scope, draftId: 8, contentRunId: "run-8" }), "quality"))).toBeDefined();
    expect(beginDraftAction(locks, draftActionLockKey(scopeKey, "approval"))).toBeDefined();

    endDraftAction(locks, qualityKey, Symbol("not-the-owner"));
    expect(locks.get(qualityKey)).toBe(first);
    endDraftAction(locks, qualityKey, first!);
    expect(hasDraftActionInFlight(locks, scopeKey, ["quality", "approval"])).toBe(true);
  });

  it("keeps one deferred Quality write across Studio and Review calls, then releases for retry", async () => {
    const scope = { profileId: "profile-a", profileRevision: 3, clientId: "client-a", brandId: "brand-a", draftId: 9, contentRunId: "run-9" };
    const scopeKey = draftActionScopeKey(scope);
    const lockKey = draftActionLockKey(scopeKey, "quality");
    const locks = new Map<string, symbol>();
    const checkedAt = "2026-09-13T05:00:00.000Z";
    const qualityChecks = [{ key: "copy", passed: true }];
    let durableRecord: Record<string, unknown> = { id: "run-9", clientId: "client-a", brandId: "brand-a", revisionId: "revision-3", state: "needs_review", qualityStatus: "pending" };
    let writes = 0;
    let resolveWrite!: (record: Record<string, unknown>) => void;
    const deferredWrite = new Promise<Record<string, unknown>>((resolve) => { resolveWrite = resolve; });
    const request = async () => {
      const token = beginDraftAction(locks, lockKey);
      if (!token) return { status: "pending" as const };
      try {
        writes += 1;
        const acknowledgement = await deferredWrite;
        if (!qualityAcknowledgementMatches(acknowledgement, { contentRunId: "run-9", clientId: "client-a", brandId: "brand-a", revisionId: "revision-3", state: "ready", qualityStatus: "passed", qualityChecks, checkedAt })) return { status: "failure" as const };
        durableRecord = acknowledgement;
        return { status: "success" as const };
      } finally {
        endDraftAction(locks, lockKey, token);
      }
    };

    const studioCall = request();
    await expect(request()).resolves.toEqual({ status: "pending" });
    expect(writes).toBe(1);
    expect(durableRecord.qualityStatus).toBe("pending");
    resolveWrite({ id: "run-9", clientId: "client-a", brandId: "brand-a", revisionId: "revision-3", state: "ready", qualityStatus: "passed", qualityChecks, checkedAt });
    await expect(studioCall).resolves.toEqual({ status: "success" });
    expect(durableRecord.qualityStatus).toBe("passed");
    await expect(request()).resolves.toEqual({ status: "success" });
    expect(writes).toBe(2);
  });

  it("uses one deferred Control Plane Quality request and rejects a mismatched ACK", async () => {
    const expectedRevisionFields = { revisionId: "revision-3", topic: "Hook", body: "Copy", caption: "Copy", contentPillar: "Education", objective: "Reach", cta: "Read", hashtags: ["#tag"], seoKeywords: [], scheduledAt: null, sources: ["source"], notes: null, variantId: "variant-9", variant: { title: "Hook", body: "Copy", caption: "Copy", cta: "Read", hashtags: ["#tag"], seoKeywords: [], mediaAssetIds: [], mediaOperations: [], mediaEvidence: [] } };
    const input = { contentRunId: "run-9", clientId: "client-a", brandId: "brand-a", revisionId: "revision-3", state: "ready", qualityStatus: "passed", qualityChecks: [{ key: "copy", passed: true }], checkedAt: "2026-09-13T05:00:00.000Z", expectedRevisionFields };
    let calls = 0;
    let resolve!: (record: Record<string, unknown>) => void;
    const response = new Promise<Record<string, unknown>>((next) => { resolve = next; });
    const update = (payload: Record<string, unknown>) => { calls += 1; expect(payload).toMatchObject({ state: "ready", qualityStatus: "passed", expectedRevisionFields }); return response; };
    const first = submitContentRunQualityCheck(update, input);
    const duplicate = submitContentRunQualityCheck(update, input);
    expect(calls).toBe(2);
    resolve({ id: "run-other", clientId: "client-a", brandId: "brand-a", revisionId: "revision-3", state: "ready", qualityStatus: "passed", qualityChecks: input.qualityChecks, checkedAt: input.checkedAt });
    await expect(first).rejects.toThrow("CONTENT_RUN_QUALITY_ACK_MISMATCH");
    await expect(duplicate).rejects.toThrow("CONTENT_RUN_QUALITY_ACK_MISMATCH");
  });

  it("fingerprints the captured content revision and accepts only its matching durable quality ACK", () => {
    const draft = { id: 7, contentRunId: "run-7", revisionId: "revision-2", title: "Hook", body: "Copy", cta: "Read", hashtags: ["#one"], mediaAssetIds: ["asset-1"] };
    const checkedAt = "2026-09-13T03:00:00.000Z";
    const qualityChecks = [{ key: "copy", passed: true, message: "Passed" }];
    const ack = { id: "run-7", clientId: "client-a", brandId: "brand-a", revisionId: "revision-2", state: "ready", qualityStatus: "passed", qualityChecks, checkedAt };

    expect(contentRevisionFingerprint(draft)).toBe(contentRevisionFingerprint({ ...draft }));
    expect(contentRevisionFingerprint(draft)).not.toBe(contentRevisionFingerprint({ ...draft, body: "Changed while checking" }));
    expect(qualityAcknowledgementMatches(ack, { contentRunId: "run-7", clientId: "client-a", brandId: "brand-a", revisionId: "revision-2", state: "ready", qualityStatus: "passed", qualityChecks, checkedAt })).toBe(true);
    expect(qualityAcknowledgementMatches({ ...ack, id: "run-other" }, { contentRunId: "run-7", clientId: "client-a", brandId: "brand-a", revisionId: "revision-2", state: "ready", qualityStatus: "passed", qualityChecks, checkedAt })).toBe(false);
    expect(qualityAcknowledgementMatches({ ...ack, qualityChecks: [{ key: "copy", passed: false }] }, { contentRunId: "run-7", clientId: "client-a", brandId: "brand-a", revisionId: "revision-2", state: "ready", qualityStatus: "passed", qualityChecks, checkedAt })).toBe(false);
    expect(qualityAcknowledgementMatches({ ...ack, checkedAt: "2026-09-13T03:00:01.000Z" }, { contentRunId: "run-7", clientId: "client-a", brandId: "brand-a", revisionId: "revision-2", state: "ready", qualityStatus: "passed", qualityChecks, checkedAt })).toBe(false);
  });

  it("sends the exact persisted ContentRun and selected variant fields as the Quality CAS expectation", () => {
    const run = createContentRun({ id: "run-cas", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", generationProfileId: "profile-a", executionMode: "llm_provider", providerTraceId: "trace-a", trigger: "manual", revisionId: "revision-4", topic: "Hook", body: "Copy", cta: "Read", hashtags: ["tag"], variants: [{ id: "variant-7", platform: "facebook", kind: "text", title: "Hook", body: "Copy", caption: "Copy", cta: "Read", hashtags: ["tag"], mediaAssetIds: ["asset-1"], metadata: { mediaEvidence: [{ assetId: "asset-1", uploadState: "processed" }] } }] });

    expect(contentRunQualityExpectedRevisionFields(run, "variant-7")).toMatchObject({
      revisionId: "revision-4", topic: "Hook", body: "Copy", caption: "Copy", hashtags: ["#tag"], variantId: "variant-7",
      variant: { title: "Hook", body: "Copy", caption: "Copy", cta: "Read", hashtags: ["#tag"], mediaAssetIds: ["asset-1"], mediaEvidence: [{ assetId: "asset-1", uploadState: "processed" }] },
    });
    expect(() => contentRunQualityExpectedRevisionFields(run, "missing-variant")).toThrow("CONTENT_RUN_VARIANT_MISSING");
  });

  it("carries a non-null draft revision into the Quality CAS and accepts its matching ACK", async () => {
    const revisionFields = contentRunRevisionFieldsFromDraft({ revisionId: "revision-live", parentRevisionId: "revision-prior" });
    const run = createContentRun({ id: "run-live", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", generationProfileId: "profile-a", executionMode: "llm_provider", providerTraceId: "trace-a", trigger: "manual", ...revisionFields, topic: "Hook", body: "Copy", variants: [{ id: "variant-live", platform: "facebook", kind: "text", title: "Hook", body: "Copy", caption: "Copy" }] });
    const expectedRevisionFields = contentRunQualityExpectedRevisionFields(run, "variant-live");
    const qualityChecks = [{ key: "copy", passed: true }];
    const checkedAt = "2026-09-13T06:30:00.000Z";
    const acknowledgement = await submitContentRunQualityCheck(async (payload) => {
      expect(payload).toMatchObject({ state: "ready", qualityStatus: "passed" });
      expect((payload.expectedRevisionFields as Record<string, unknown>).revisionId).toBe("revision-live");
      return { id: "run-live", clientId: "client-a", brandId: "brand-a", revisionId: "revision-live", state: "ready", qualityStatus: "passed", qualityChecks, checkedAt };
    }, { contentRunId: "run-live", clientId: "client-a", brandId: "brand-a", revisionId: "revision-live", state: "ready", qualityStatus: "passed", qualityChecks, checkedAt, expectedRevisionFields });
    expect(acknowledgement.revisionId).toBe("revision-live");
  });

  it("keeps strategy snapshots immutable and requires an angle for new readiness checks", () => {
    const strategySnapshot = {
      objectiveKey: "conversion" as const,
      objectiveLabel: "Conversion",
      pillarId: "proof-and-process",
      pillarLabel: "Proof and process",
      angleId: "proof-and-process-proof-point",
      angleLabel: "Proof point",
      angleGuidance: "Explain one evidence-backed point.",
      channel: "facebook" as const,
      format: "text" as const,
      strategyVersion: 3,
      catalogFingerprint: "f".repeat(64),
    };
    const run = createContentRun({ id: "run-strategy", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", generationProfileId: "profile-a", executionMode: "llm_provider", providerTraceId: "trace-a", trigger: "manual", contentPillar: strategySnapshot.pillarLabel, objective: strategySnapshot.objectiveLabel, contentAngle: strategySnapshot.angleLabel, strategyVersion: strategySnapshot.strategyVersion, strategySnapshot, variants: [{ id: "variant-strategy", platform: "facebook", kind: "text", body: "A sufficiently useful body" }] });
    expect(run.strategySnapshot).toEqual(strategySnapshot);
    expect(buildPublishReadinessChecks({ ...run, contentAngle: undefined }).find((check) => check.key === "strategy")?.passed).toBe(false);
    expect(buildPublishReadinessChecks(run).find((check) => check.key === "strategy")?.passed).toBe(true);
    const changedCatalogSnapshot = { ...run, strategySnapshot: { ...strategySnapshot, pillarLabel: "Changed catalog label" } };
    expect(run.strategySnapshot?.pillarLabel).toBe("Proof and process");
    expect(changedCatalogSnapshot.strategySnapshot?.pillarLabel).toBe("Changed catalog label");
    expect(run.variants[0]?.body).toBe("A sufficiently useful body");
  });

  it("marks a run for regeneration without changing body, media, or snapshot", () => {
    const strategySnapshot = { objectiveKey: "reach" as const, objectiveLabel: "Reach", pillarId: "audience-insight", pillarLabel: "Audience insight", angleId: "audience-insight-pain-point", angleLabel: "Pain point", angleGuidance: "Name one friction point.", channel: "facebook" as const, format: "image" as const, strategyVersion: 2, catalogFingerprint: "a".repeat(64) };
    const run = createContentRun({ id: "run-regenerate", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", generationProfileId: "profile-a", executionMode: "llm_provider", providerTraceId: "trace-a", trigger: "manual", body: "Original body", mediaEvidence: [{ assetId: "asset-a", sha256: "a".repeat(64), mimeType: "image/png", order: 0, role: "publish", uploadState: "processed" }], strategySnapshot, strategyVersion: 2, contentAngle: "Pain point", variants: [{ id: "variant-regenerate", platform: "facebook", kind: "image", body: "Original body", mediaAssetIds: ["asset-a"] }] });
    const marked = markNeedsRegeneration(run);
    expect(marked).toMatchObject({ regenerationState: "needs_regeneration", body: "Original body", strategySnapshot, mediaEvidence: [{ assetId: "asset-a" }] });
    expect(marked.variants[0]?.mediaAssetIds).toEqual(["asset-a"]);
  });

  it("clones strategy snapshots at the variant boundary", () => {
    const sourceSnapshot = { objectiveKey: "reach" as const, objectiveLabel: "Reach", pillarId: "audience-insight", pillarLabel: "Audience insight", angleId: "audience-insight-audience-question", angleLabel: "Audience question", angleGuidance: "Answer one question.", channel: "facebook" as const, format: "text" as const, strategyVersion: 1, catalogFingerprint: "a".repeat(64) };
    const run = createContentRun({ id: "run-clone", clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", generationProfileId: "profile-a", executionMode: "llm_provider", providerTraceId: "trace-a", trigger: "manual", strategySnapshot: sourceSnapshot, variants: [{ id: "variant-clone", platform: "facebook", kind: "text", body: "Copy", strategySnapshot: sourceSnapshot }] });
    sourceSnapshot.angleLabel = "Changed outside the run";
    expect(run.strategySnapshot?.angleLabel).toBe("Audience question");
    expect(run.variants[0]?.strategySnapshot?.angleLabel).toBe("Audience question");
    expect(run.variants[0]?.strategySnapshot).not.toBe(sourceSnapshot);
  });
});
