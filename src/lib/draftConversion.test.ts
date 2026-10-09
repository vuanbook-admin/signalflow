import { describe, expect, it } from "vitest";
import { draftToContentVariant, hasEffectiveContentRunMedia, restoreContentRunLineage, restoreContentRunMediaEvidence } from "./draftConversion";

const evidence = [{ assetId: "asset-a", sha256: "a".repeat(64), mimeType: "image/webp", order: 0, role: "publish", uploadState: "processed", attachmentBoundary: "chat_upload" }];

describe("restore Content Run media evidence", () => {
  it("restores validated top-level evidence into draft media fields", () => {
    expect(restoreContentRunMediaEvidence({ mediaEvidence: evidence }, "variant-a")).toMatchObject({ mediaAssetIds: ["asset-a"], mediaEvidence: [{ mimeType: "image/webp", uploadState: "processed", attachmentBoundary: "chat_upload" }] });
  });

  it("falls back to variant metadata and strips unapproved path fields", () => {
    expect(restoreContentRunMediaEvidence({ variants: [{ id: "variant-a", metadata: { mediaEvidence: evidence } }] }, "variant-a")?.mediaAssetIds).toEqual(["asset-a"]);
    const restored = restoreContentRunMediaEvidence({ mediaEvidence: [{ ...evidence[0], localAssetPath: "/private/path" }] }, "variant-a");
    expect(restored?.mediaEvidence?.[0]).not.toHaveProperty("localAssetPath");
    expect(restoreContentRunMediaEvidence({ mediaEvidence: [{ ...evidence[0], sha256: "invalid" }] }, "variant-a")).toBeUndefined();
  });
});

describe("A04 Content Run lineage restoration", () => {
  it("returns reconciliation required for partial durable lineage", () => {
    const partial = restoreContentRunLineage({ prompt: "Partial prompt", contentIntelligenceLineage: { selectedKnowledgeItemIds: ["knowledge-approved-a"] } }, "variant-a04");
    expect(partial).toMatchObject({ ok: false, status: "reconciliation_required", code: "CONTENT_INTELLIGENCE_RELOAD_LINEAGE_MISSING" });
    if (partial?.ok === false) expect(partial.missingFields).toEqual(expect.arrayContaining(["selectedResearchEvidenceIds", "selectedPromptBlueprintId", "selectedRecipeId", "transformMode", "customerFacts"]));
    expect(restoreContentRunLineage({ prompt: "Partial prompt", selectedKnowledgeItemIds: ["knowledge-approved-a"] })).toMatchObject({ ok: false, status: "reconciliation_required" });
    expect(restoreContentRunLineage({ prompt: "Partial prompt", variants: [{ id: "variant-a04", metadata: { contentIntelligenceLineage: { selectedKnowledgeItemIds: ["knowledge-approved-a"] } } }] }, "variant-a04")).toMatchObject({ ok: false, status: "reconciliation_required" });
  });

  it("restores durable lineage independent of the current App selection", () => {
    const lineage = {
      selectedKnowledgeItemIds: ["knowledge-approved-a"],
      selectedResearchEvidenceIds: ["evidence-approved-a", "evidence-client-a"],
      selectedPromptBlueprintId: "blueprint-a",
      selectedPromptBlueprintVersion: 7,
      selectedRecipeId: "recipe-a",
      transformMode: "repurpose" as const,
      mediaSetFingerprint: "a".repeat(64),
      customerFacts: ["Topic: Durable fixture"],
    };
    const run = { id: "run-a04", prompt: "Durable prompt", contentIntelligenceLineage: lineage, ...lineage, variants: [{ id: "variant-a04", metadata: { contentIntelligenceLineage: lineage } }] };
    const restored = restoreContentRunLineage(run, "variant-a04");
    expect(restored?.ok).toBe(true);
    if (!restored?.ok) return;
    const value = restored.value;
    expect(value).toMatchObject({ selectedKnowledgeItemIds: ["knowledge-approved-a"], selectedResearchEvidenceIds: ["evidence-approved-a", "evidence-client-a"], selectedPromptBlueprintId: "blueprint-a", promptBlueprintVersion: 7, recipeId: "recipe-a", transformMode: "repurpose", mediaSetFingerprint: "a".repeat(64), customerFacts: ["Topic: Durable fixture"], prompt: "Durable prompt" });
    const currentSelection = ["knowledge-current-ui", "evidence-current-ui"];
    expect(value.selectedKnowledgeItemIds).toEqual(["knowledge-approved-a"]);
    expect(value.selectedResearchEvidenceIds).not.toEqual(currentSelection);
    const variant = draftToContentVariant({ id: 104, title: "Fixture", platform: "Facebook", contentKind: "text", body: "Fixture body", revisionId: "revision-parent", parentRevisionId: "revision-grandparent", selectedKnowledgeItemIds: value.selectedKnowledgeItemIds, selectedResearchEvidenceIds: value.selectedResearchEvidenceIds, selectedPromptBlueprintId: value.selectedPromptBlueprintId, promptBlueprintVersion: value.promptBlueprintVersion, recipeId: value.recipeId, transformMode: value.transformMode, mediaSetFingerprint: value.mediaSetFingerprint, customerFacts: value.customerFacts, prompt: value.prompt, contentIntelligenceLineage: value.contentIntelligenceLineage });
    expect(variant.metadata.contentIntelligenceLineage).toMatchObject(lineage);
    expect(variant.metadata.selectedResearchEvidenceIds).toEqual(lineage.selectedResearchEvidenceIds);
    expect(variant.metadata).toMatchObject({ revisionId: "revision-parent", parentRevisionId: "revision-grandparent" });
  });

  it("keeps blank required lineage values in reconciliation for nested and top-level records", () => {
    const lineage = { selectedKnowledgeItemIds: ["knowledge-a"], selectedResearchEvidenceIds: ["evidence-a"], selectedPromptBlueprintId: "blueprint-a", selectedPromptBlueprintVersion: 7, selectedRecipeId: "recipe-a", transformMode: "repurpose", customerFacts: ["Topic: A04"] } as const;
    const nestedBase = { prompt: "Durable prompt", contentIntelligenceLineage: lineage, variants: [{ id: "variant-a04", metadata: { contentIntelligenceLineage: lineage } }] };
    for (const field of ["selectedPromptBlueprintId", "selectedRecipeId"] as const) {
      const nested = { ...lineage, [field]: "   " };
      expect(restoreContentRunLineage({ ...nestedBase, contentIntelligenceLineage: nested }, "variant-a04")).toMatchObject({ ok: false, code: "CONTENT_INTELLIGENCE_RELOAD_LINEAGE_MISSING", missingFields: expect.arrayContaining([field]) });
      expect(restoreContentRunLineage({ prompt: "Durable prompt", ...lineage, [field]: "   " })).toMatchObject({ ok: false, code: "CONTENT_INTELLIGENCE_RELOAD_LINEAGE_MISSING", missingFields: expect.arrayContaining([field]) });
    }
    expect(restoreContentRunLineage({ ...nestedBase, contentIntelligenceLineage: { ...lineage, customerFacts: ["  "] } }, "variant-a04")).toMatchObject({ ok: false, code: "CONTENT_INTELLIGENCE_RELOAD_LINEAGE_MISSING", missingFields: expect.arrayContaining(["customerFacts"]) });
    expect(restoreContentRunLineage({ prompt: "Durable prompt", ...lineage, customerFacts: ["  "] })).toMatchObject({ ok: false, code: "CONTENT_INTELLIGENCE_RELOAD_LINEAGE_MISSING", missingFields: expect.arrayContaining(["customerFacts"]) });
    expect(restoreContentRunLineage({ ...nestedBase, contentIntelligenceLineage: { ...lineage, selectedPromptBlueprintVersion: undefined } }, "variant-a04")).toMatchObject({ ok: false, code: "CONTENT_INTELLIGENCE_RELOAD_LINEAGE_MISSING", missingFields: expect.arrayContaining(["selectedPromptBlueprintVersion"]) });
  });

  it("requires one valid fingerprint for every effective media-bearing shape", () => {
    const lineage = { selectedKnowledgeItemIds: ["knowledge-a"], selectedResearchEvidenceIds: ["evidence-a"], selectedPromptBlueprintId: "blueprint-a", selectedPromptBlueprintVersion: 7, selectedRecipeId: "recipe-a", transformMode: "repurpose" as const, customerFacts: ["Topic: A04"] };
    const topLevel = { prompt: "Media prompt", ...lineage, mediaAssetIds: ["asset-top"] };
    const variant = { prompt: "Media prompt", ...lineage, variants: [{ id: "variant-a04", mediaAssetIds: ["asset-variant"], metadata: {} }] };
    const metadata = { prompt: "Media prompt", ...lineage, variants: [{ id: "variant-a04", metadata: { mediaEvidence: [{ assetId: "asset-meta" }] } }] };
    expect(hasEffectiveContentRunMedia(topLevel)).toBe(true);
    expect(hasEffectiveContentRunMedia(variant)).toBe(true);
    expect(hasEffectiveContentRunMedia(metadata)).toBe(true);
    for (const run of [topLevel, variant, metadata]) expect(restoreContentRunLineage(run, "variant-a04")).toMatchObject({ ok: false, code: "CONTENT_INTELLIGENCE_RELOAD_LINEAGE_MISSING", missingFields: expect.arrayContaining(["mediaSetFingerprint"]) });
    expect(restoreContentRunLineage({ ...topLevel, mediaSetFingerprint: "a".repeat(64) }, "variant-a04")).toMatchObject({ ok: true });
    expect(restoreContentRunLineage({ ...variant, mediaSetFingerprint: "a".repeat(64) }, "variant-a04")).toMatchObject({ ok: true });
    expect(restoreContentRunLineage({ ...metadata, mediaSetFingerprint: "a".repeat(64) }, "variant-a04")).toMatchObject({ ok: true });
    expect(restoreContentRunLineage({ ...variant, mediaSetFingerprint: "a".repeat(64), variants: [{ id: "variant-a04", mediaAssetIds: ["asset-variant"], metadata: { mediaSetFingerprint: "b".repeat(64) } }] }, "variant-a04")).toMatchObject({ ok: false, code: "CONTENT_INTELLIGENCE_RELOAD_LINEAGE_MISSING" });
  });
});

describe("strategy snapshot draft conversion", () => {
  it("copies the immutable strategy snapshot and format-specific asset metadata", () => {
    const snapshot = {
      objectiveKey: "conversion",
      objectiveLabel: "Conversion",
      pillarId: "proof-and-process",
      pillarLabel: "Proof and process",
      angleId: "proof-and-process-proof-point",
      angleLabel: "Proof point",
      angleGuidance: "Explain one evidence-backed point.",
      channel: "instagram" as const,
      format: "video" as const,
      strategyVersion: 4,
      catalogFingerprint: "f".repeat(64),
    } as const;
    const variant = draftToContentVariant({
      id: 105,
      title: "Proof",
      platform: "Instagram",
      contentKind: "short_video",
      body: "A durable caption",
      contentPillar: "Proof and process",
      contentAngle: "Proof point",
      objective: "Conversion",
      strategyVersion: 4,
      strategySnapshot: snapshot,
      videoConcept: "A short process scene",
      videoPrompt: "Show the process in 9:16",
      strategyRationale: "Concrete evidence supports the objective.",
    });
    expect(variant).toMatchObject({ contentAngle: "Proof point", objective: "Conversion", strategyVersion: 4 });
    expect(variant.metadata).toMatchObject({ contentAngle: "Proof point", strategyVersion: 4, strategySnapshot: snapshot, videoConcept: "A short process scene", videoPrompt: "Show the process in 9:16", strategyRationale: "Concrete evidence supports the objective." });
    expect(variant.metadata).not.toHaveProperty("imageConcept");
  });
});
