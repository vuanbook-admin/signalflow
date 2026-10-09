import { describe, expect, it } from "vitest";
import { starterStrategyCatalog } from "./contentStrategy";
import { resolveStrategyForSlot } from "./contentStrategyResolver";
import { compileStrategyPrompt, structuredAssetInstruction, validateGeneratedStrategyOutput } from "./contentStrategyPrompt";

const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-14T00:00:00.000Z"));
const resolved = resolveStrategyForSlot({
  catalog,
  channel: "instagram",
  selection: { objective: "conversion", pillar: "practical-education", angle: "practical-education-common-mistake" },
  slotIndex: 0,
});

describe("strategy prompt compiler", () => {
  it("compiles the resolved strategy, recipe guidance, approved context, and topic exclusions", () => {
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const prompt = compileStrategyPrompt({
      brandName: "North Star",
      brandVoice: "Clear, calm, evidence-led",
      channel: "instagram",
      format: "image",
      strategy: { ...resolved.strategy, format: "image", strategySnapshot: { ...resolved.strategy, format: "image" } },
      recipe: {
        id: "recipe-a",
        brandId: "brand-a",
        name: "Checklist",
        platforms: ["instagram"],
        contentKinds: ["image"],
        pillarId: resolved.strategy.pillarId,
        angleId: resolved.strategy.angleId,
        hookGuidance: "Open with one concrete mistake",
        structureGuidance: "Mistake then three fixes",
        ctaGuidance: "Invite a save",
        qualityChecklist: ["Check factual claims"],
        status: "active",
      },
      identityContext: "IDENTITY: The brand is practical and respectful.",
      intelligenceContext: "A04 APPROVED KNOWLEDGE: knowledge-a\nA04 EVIDENCE: evidence-a\nmediaSetFingerprint: abc",
      brief: "Help new savers choose a simple next step.",
      existingTopics: ["Already covered topic"],
      customerMedia: [{ assetId: "asset-a", mimeType: "image/png", order: 0, role: "publish" }],
    });
    expect(prompt).toContain("IDENTITY: The brand is practical and respectful.");
    expect(prompt).toContain("A04 APPROVED KNOWLEDGE: knowledge-a");
    expect(prompt).toContain("OBJECTIVE: conversion");
    expect(prompt).toContain("CONTENT PILLAR: practical-education");
    expect(prompt).toContain("CONTENT ANGLE: practical-education-common-mistake");
    expect(prompt).toContain("CHANNEL: instagram");
    expect(prompt).toContain("FORMAT: image");
    expect(prompt).toContain("Open with one concrete mistake");
    expect(prompt).toContain("Do not repeat: Already covered topic");
    expect(prompt).toContain("asset-a");
    expect(prompt).not.toContain("/private/");
  });

  it("keeps image and video output instructions in separate metadata branches", () => {
    expect(structuredAssetInstruction("image")).toContain("metadata.imageConcept");
    expect(structuredAssetInstruction("image")).toContain("metadata.imagePrompt");
    expect(structuredAssetInstruction("image")).not.toContain("metadata.videoConcept");
    expect(structuredAssetInstruction("image")).not.toContain("metadata.videoPrompt");
    expect(structuredAssetInstruction("video")).toContain("metadata.videoConcept");
    expect(structuredAssetInstruction("video")).toContain("metadata.videoPrompt");
    expect(structuredAssetInstruction("video")).not.toContain("metadata.imageConcept");
    expect(structuredAssetInstruction("video")).not.toContain("metadata.imagePrompt");
    expect(structuredAssetInstruction("text")).not.toMatch(/imageConcept|imagePrompt|videoConcept|videoPrompt/);
  });

  it("validates strategy identity and the requested asset branch", () => {
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const complete = (format: "text" | "image" | "video", assets: Record<string, string> = {}) => {
      const expected = { ...resolved.strategy, format };
      return { objective: expected.objectiveKey, contentPillar: expected.pillarId, contentAngle: expected.angleId, channel: expected.channel, strategyVersion: expected.strategyVersion, catalogFingerprint: expected.catalogFingerprint, strategySnapshot: { ...expected }, format, ...assets };
    };
    const expected = { ...resolved.strategy, format: "image" as const, strategySnapshot: { ...resolved.strategy, format: "image" as const } };
    expect(validateGeneratedStrategyOutput({
      format: "image",
      expected,
      output: complete("image", { imageConcept: "A calm desk", imagePrompt: "A calm desk in daylight" }),
    })).toEqual({ ok: true });
    expect(validateGeneratedStrategyOutput({ format: "image", expected, output: { ...complete("image", { imageConcept: "A desk", imagePrompt: "A desk" }), objective: "reach" } })).toMatchObject({ ok: false, code: "STRATEGY_OBJECTIVE_MISMATCH" });
    expect(validateGeneratedStrategyOutput({ format: "image", expected, output: { ...complete("image", { imageConcept: "A desk" }), imagePrompt: undefined } })).toMatchObject({ ok: false, code: "IMAGE_METADATA_REQUIRED" });
    const videoExpected = { ...resolved.strategy, format: "video" as const, strategySnapshot: { ...resolved.strategy, format: "video" as const } };
    expect(validateGeneratedStrategyOutput({ format: "video", expected: videoExpected, output: { ...complete("video", { videoConcept: "A short scene" }), videoPrompt: undefined } })).toMatchObject({ ok: false, code: "VIDEO_METADATA_REQUIRED" });
    const textExpected = { ...resolved.strategy, format: "text" as const, strategySnapshot: { ...resolved.strategy, format: "text" as const } };
    expect(validateGeneratedStrategyOutput({ format: "text", expected: textExpected, output: { ...complete("text"), contentAngle: "wrong-angle" } })).toMatchObject({ ok: false, code: "STRATEGY_ANGLE_MISMATCH" });
  });

  it("requires returned channel, version, fingerprint, snapshot, and format to match", () => {
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const expected = { ...resolved.strategy, format: "image" as const, strategySnapshot: { ...resolved.strategy, format: "image" as const } };
    const snapshot = { ...resolved.strategy, format: "image" as const, catalogFingerprint: expected.catalogFingerprint };
    const valid = { objective: expected.objectiveKey, contentPillar: expected.pillarId, contentAngle: expected.angleId, channel: expected.channel, strategyVersion: expected.strategyVersion, catalogFingerprint: expected.catalogFingerprint, strategySnapshot: snapshot, format: "image" as const, imageConcept: "A concept", imagePrompt: "A prompt" };
    expect(validateGeneratedStrategyOutput({ format: "image", expected, output: valid })).toEqual({ ok: true });
    expect(validateGeneratedStrategyOutput({ format: "image", expected, output: { ...valid, channel: "facebook" } })).toMatchObject({ ok: false, code: "STRATEGY_CHANNEL_MISMATCH" });
    expect(validateGeneratedStrategyOutput({ format: "image", expected, output: { ...valid, strategyVersion: expected.strategyVersion + 1 } })).toMatchObject({ ok: false, code: "STRATEGY_VERSION_MISMATCH" });
    expect(validateGeneratedStrategyOutput({ format: "image", expected, output: { ...valid, catalogFingerprint: "a".repeat(64) } })).toMatchObject({ ok: false, code: "STRATEGY_FINGERPRINT_MISMATCH" });
    expect(validateGeneratedStrategyOutput({ format: "image", expected, output: { ...valid, strategySnapshot: { ...snapshot, angleId: "wrong-angle" } } })).toMatchObject({ ok: false, code: "STRATEGY_SNAPSHOT_MISMATCH" });
    expect(validateGeneratedStrategyOutput({ format: "image", expected, output: { ...valid, format: "video" as const } })).toMatchObject({ ok: false, code: "STRATEGY_FORMAT_MISMATCH" });
    expect(validateGeneratedStrategyOutput({ format: "image", expected, output: { ...valid, strategySnapshot: undefined } })).toMatchObject({ ok: false, code: "STRATEGY_SNAPSHOT_INVALID" });
  });

  it("rejects incomplete expected identity and malformed returned snapshots before persistence", () => {
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const expected = { ...resolved.strategy, format: "image" as const, strategySnapshot: { ...resolved.strategy, format: "image" as const } };
    const valid = { objective: expected.objectiveKey, contentPillar: expected.pillarId, contentAngle: expected.angleId, channel: expected.channel, strategyVersion: expected.strategyVersion, catalogFingerprint: expected.catalogFingerprint, strategySnapshot: expected.strategySnapshot, format: "image" as const, imageConcept: "A concept", imagePrompt: "A prompt" };
    expect(validateGeneratedStrategyOutput({ format: "image", expected: { ...expected, angleGuidance: "", strategySnapshot: { ...expected.strategySnapshot, angleGuidance: "" } }, output: valid })).toMatchObject({ ok: false, code: "STRATEGY_EXPECTED_INVALID" });
    expect(validateGeneratedStrategyOutput({ format: "image", expected: { ...expected, strategySnapshot: undefined } as never, output: valid })).toMatchObject({ ok: false, code: "STRATEGY_EXPECTED_INVALID" });
    expect(validateGeneratedStrategyOutput({ format: "image", expected, output: { ...valid, strategySnapshot: { ...expected.strategySnapshot, angleGuidance: "" } } })).toMatchObject({ ok: false, code: "STRATEGY_SNAPSHOT_INVALID" });
    expect(validateGeneratedStrategyOutput({ format: "image", expected, output: { ...valid, strategySnapshot: { ...expected.strategySnapshot, format: undefined } } })).toMatchObject({ ok: false, code: "STRATEGY_SNAPSHOT_INVALID" });
  });
});


describe("fix4 immutable provider contract", () => {
  it("exposes every required snapshot value verbatim in the compiled prompt", () => {
    if (!resolved.ok) throw new Error("strategy fixture failed");
    const snapshot = { ...resolved.strategy, format: "image" as const, recipeId: "recipe-identity", recipeGuidance: "Hook, proof, CTA.", angleIdByChannel: { instagram: resolved.strategy.angleId, facebook: "other-angle" } };
    const strategy = { ...snapshot, strategySnapshot: snapshot };
    const prompt = compileStrategyPrompt({ brandName: "North Star", brandVoice: "Clear", channel: "instagram", format: "image", strategy, identityContext: "Approved brand", intelligenceContext: "Approved knowledge", brief: "A useful post", existingTopics: [] });
    const identity = JSON.parse(prompt.match(/IMMUTABLE STRATEGY IDENTITY JSON:\n([^\n]+)/)?.[1] ?? "{}");
    expect(identity).toEqual({ objective: snapshot.objectiveKey, contentPillar: snapshot.pillarId, contentAngle: snapshot.angleId, channel: snapshot.channel, format: snapshot.format, strategyVersion: snapshot.strategyVersion, catalogFingerprint: snapshot.catalogFingerprint, strategySnapshot: snapshot });
  });

  it("accepts reordered channel map keys without changing any identity value", () => {
    if (!resolved.ok) throw new Error("strategy fixture failed");
    const snapshot = { ...resolved.strategy, format: "text" as const, angleIdByChannel: { instagram: resolved.strategy.angleId, facebook: "other-angle" } };
    const expected = { ...snapshot, strategySnapshot: snapshot };
    expect(validateGeneratedStrategyOutput({ format: "text", expected, output: { objective: snapshot.objectiveKey, contentPillar: snapshot.pillarId, contentAngle: snapshot.angleId, channel: snapshot.channel, format: "text", strategyVersion: snapshot.strategyVersion, catalogFingerprint: snapshot.catalogFingerprint, strategySnapshot: { ...snapshot, angleIdByChannel: { facebook: "other-angle", instagram: resolved.strategy.angleId } } } })).toEqual({ ok: true });
  });
});
