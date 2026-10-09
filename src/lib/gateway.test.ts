import { describe, expect, it } from "vitest";
import { buildMediaRegenerationPrompt, buildRewritePrompt, extractGeneratedContentFields, MockAIGateway, normalizeGeneratedVariant, structuredOutputInstruction, validateGatewayResult } from "./gateway";
import { OfficialAIGateway } from "./officialGateway";
import { GeminiWebAIGateway } from "./geminiWebGateway";
import { ChatGPTWebAIGateway } from "./chatgptWebGateway";

describe("context-derived generation prompts", () => {
  it("includes selected brand facts, content context and the draft visual prompt", () => {
    const prompt = buildRewritePrompt({
      brandName: "North Star",
      brandFacts: ["Mission: make budgeting less intimidating", "Audience: first-time savers"],
      contentContext: "Pillar: practical education\nObjective: save-worthy guidance",
      visualPrompt: "Minimal desk scene with a paper budget and warm daylight",
      platform: "facebook",
      title: "Current title",
      body: "Current body",
    });
    expect(prompt).toContain("make budgeting less intimidating");
    expect(prompt).toContain("save-worthy guidance");
    expect(prompt).toContain("Minimal desk scene");
    expect(prompt).not.toMatch(/baby outfit|cotton baby|pale sage/i);
  });

  it("builds media prompts from brand and content context for either image or video", () => {
    const prompt = buildMediaRegenerationPrompt({ kind: "video", brandName: "North Star", brandFacts: ["Evidence-led and calm"], contentContext: "Topic: emergency fund", visualPrompt: "Paper notes beside a laptop" });
    expect(prompt).toContain("North Star");
    expect(prompt).toContain("Evidence-led and calm");
    expect(prompt).toContain("Paper notes beside a laptop");
    expect(prompt).toContain("9:16");
    expect(prompt).not.toMatch(/baby outfit|cotton baby|pale sage/i);
  });
});

describe("strategy-aware gateway contracts", () => {
  const strategy = {
    objectiveKey: "conversion",
    objectiveLabel: "Conversion",
    pillarId: "proof-and-process",
    pillarLabel: "Proof and process",
    angleId: "proof-and-process-proof-point",
    angleLabel: "Proof point",
    angleGuidance: "Explain the evidence behind one useful claim.",
    channel: "instagram" as const,
    strategyVersion: 4,
    catalogFingerprint: "f".repeat(64),
  };
  const completeImageStrategy = { ...strategy, format: "image" as const, strategySnapshot: { ...strategy, format: "image" as const } };

  it("round-trips strategy and image/video fields from camelCase and snake_case", () => {
    const fields = extractGeneratedContentFields({
      content_angle: "Proof point",
      strategy_version: 4,
      strategy_snapshot: strategy,
      catalog_fingerprint: strategy.catalogFingerprint,
      video_concept: "A short proof scene",
      video_prompt: "Show the process in 9:16",
      strategy_rationale: "The selected angle supports a concrete next step.",
    });
    expect(fields).toMatchObject({ contentAngle: "Proof point", strategyVersion: 4, strategySnapshot: strategy, videoConcept: "A short proof scene", videoPrompt: "Show the process in 9:16", strategyRationale: "The selected angle supports a concrete next step." });
    const variant = normalizeGeneratedVariant({ platform: "instagram", kind: "video", title: "Proof", body: "Copy", content_angle: "Proof point", strategy_version: 4, strategy_snapshot: strategy, video_concept: "A short proof scene", video_prompt: "Show the process in 9:16" });
    expect(variant).toMatchObject({ contentAngle: "Proof point", strategyVersion: 4, strategySnapshot: strategy });
    expect(variant.metadata).toMatchObject({ contentAngle: "Proof point", content_angle: "Proof point", strategyVersion: 4, strategy_version: 4, strategySnapshot: strategy, videoConcept: "A short proof scene", videoPrompt: "Show the process in 9:16" });
    expect(extractGeneratedContentFields({ strategy_snapshot: { objective_key: "conversion", objective_label: "Conversion", pillar_id: "proof-and-process", pillar_label: "Proof and process", angle_id: "proof-and-process-proof-point", angle_label: "Proof point", angle_guidance: "Explain the evidence behind one useful claim.", angle_id_by_channel: { instagram: "proof-and-process-proof-point" }, channel: "instagram", format: "image", strategy_version: 4, catalog_fingerprint: strategy.catalogFingerprint } }).strategySnapshot).toEqual({ objectiveKey: "conversion", objectiveLabel: "Conversion", pillarId: "proof-and-process", pillarLabel: "Proof and process", angleId: "proof-and-process-proof-point", angleLabel: "Proof point", angleGuidance: "Explain the evidence behind one useful claim.", angleIdByChannel: { instagram: "proof-and-process-proof-point" }, channel: "instagram", format: "image", strategyVersion: 4, catalogFingerprint: strategy.catalogFingerprint });
  });

  it("emits a format-specific structured contract", () => {
    expect(structuredOutputInstruction("image")).toMatch(/contentAngle/);
    expect(structuredOutputInstruction("image")).toMatch(/imageConcept.*imagePrompt/);
    expect(structuredOutputInstruction("image")).not.toMatch(/videoConcept|videoPrompt/);
    expect(structuredOutputInstruction("video")).toMatch(/videoConcept.*videoPrompt/);
    expect(structuredOutputInstruction("video")).not.toMatch(/imageConcept|imagePrompt/);
    expect(structuredOutputInstruction("text")).not.toMatch(/imageConcept|imagePrompt|videoConcept|videoPrompt/);
  });

  it("requires a resolved strategy and never invents an Education fallback in mock structured output", async () => {
    const gateway = new MockAIGateway();
    const request = {
      workspaceId: "workspace-a",
      prompt: "Generate a proof post",
      targetPlatforms: ["instagram" as const],
      contentKinds: ["image" as const],
      brandSystem: { workspaceId: "workspace-a", voice: "Clear", audience: "Customers", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "Inter" } },
      metadata: { structuredOutput: true, brandName: "North Star", existingTopics: [], assetFormat: "image", resolvedStrategy: completeImageStrategy, strategySnapshot: completeImageStrategy.strategySnapshot },
    };
    await expect(gateway.generate({ ...request, metadata: { ...request.metadata, resolvedStrategy: undefined } })).rejects.toThrow("STRATEGY_REQUIRED");
    const result = await gateway.generate(request);
    expect(result.variants[0]).toMatchObject({ contentPillar: "Proof and process", objective: "Conversion", contentAngle: "Proof point", strategyVersion: 4, strategySnapshot: completeImageStrategy.strategySnapshot });
    expect(result.variants[0]?.metadata).toMatchObject({ imageConcept: expect.any(String), imagePrompt: expect.any(String), strategyRationale: expect.any(String) });
    expect(result.variants[0]?.metadata).not.toHaveProperty("videoConcept");
    expect(result.variants[0]?.metadata).not.toHaveProperty("videoPrompt");
  });

  it("returns video metadata only for a video strategy request", async () => {
    const videoStrategy = { ...strategy, channel: "facebook" as const, format: "video" as const, strategySnapshot: { ...strategy, channel: "facebook" as const, format: "video" as const } };
    const result = await new MockAIGateway().generate({
      workspaceId: "workspace-a",
      prompt: "Generate a process video",
      targetPlatforms: ["facebook"],
      contentKinds: ["video"],
      brandSystem: { workspaceId: "workspace-a", voice: "Clear", audience: "Customers", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "Inter" } },
      metadata: { structuredOutput: true, brandName: "North Star", existingTopics: [], assetFormat: "video", resolvedStrategy: videoStrategy, strategySnapshot: videoStrategy.strategySnapshot },
    });
    expect(result.variants[0]?.metadata).toMatchObject({ videoConcept: expect.any(String), videoPrompt: expect.any(String) });
    expect(result.variants[0]?.metadata).not.toHaveProperty("imageConcept");
    expect(result.variants[0]?.metadata).not.toHaveProperty("imagePrompt");
  });

  it("fails closed when a persisted strategy request is missing or malformed", () => {
    const result = { traceId: "trace", provider: "mock" as const, variants: [], safetyNotes: [] };
    expect(() => validateGatewayResult({ workspaceId: "workspace-a", prompt: "x", targetPlatforms: ["facebook"], contentKinds: ["text"], brandSystem: { workspaceId: "workspace-a", voice: "Clear", audience: "Customers", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "Inter" } }, metadata: { structuredOutput: true, assetFormat: "text" } }, result)).toThrow("STRATEGY_REQUIRED");
    expect(() => validateGatewayResult({ workspaceId: "workspace-a", prompt: "x", targetPlatforms: ["facebook"], contentKinds: ["text"], brandSystem: { workspaceId: "workspace-a", voice: "Clear", audience: "Customers", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "Inter" } }, metadata: { structuredOutput: true, assetFormat: "text", resolvedStrategy: { objectiveKey: "reach" } } }, result)).toThrow("STRATEGY_REQUIRED");
  });

  it("rejects empty structured results and incomplete per-channel strategy maps with typed errors", () => {
    const facebook = { ...strategy, channel: "facebook" as const, format: "text" as const, strategySnapshot: { ...strategy, channel: "facebook" as const, format: "text" as const } };
    const instagram = { ...strategy, channel: "instagram" as const, format: "text" as const, strategySnapshot: { ...strategy, channel: "instagram" as const, format: "text" as const } };
    const request = { workspaceId: "workspace-a", prompt: "x", targetPlatforms: ["facebook", "instagram"] as Array<"facebook" | "instagram">, contentKinds: ["text"] as Array<"text">, brandSystem: { workspaceId: "workspace-a", voice: "Clear", audience: "Customers", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "Inter" } }, metadata: { structuredOutput: true, assetFormat: "text", resolvedStrategy: facebook, resolvedStrategiesByChannel: { facebook, instagram } } };
    expect(() => validateGatewayResult(request, { traceId: "trace", provider: "mock", variants: [], safetyNotes: [] })).toThrow("STRATEGY_VARIANTS_REQUIRED");
    expect(() => validateGatewayResult({ ...request, metadata: { ...request.metadata, resolvedStrategiesByChannel: { facebook } } }, { traceId: "trace", provider: "mock", variants: [], safetyNotes: [] })).toThrow("STRATEGY_CHANNEL_MAP_INCOMPLETE");
    expect(() => validateGatewayResult({ ...request, metadata: { ...request.metadata, resolvedStrategiesByChannel: { facebook, instagram: { ...instagram, angleGuidance: undefined, strategySnapshot: undefined } } } }, { traceId: "trace", provider: "mock", variants: [{ platform: "facebook", kind: "text", title: "x", body: "copy" }] as never, safetyNotes: [] })).toThrow("STRATEGY_REQUIRED");
    expect(() => validateGatewayResult({ ...request, targetPlatforms: ["instagram"], metadata: { ...request.metadata, resolvedStrategiesByChannel: {}, resolvedStrategy: facebook } }, { traceId: "trace", provider: "mock", variants: [{ platform: "instagram", kind: "text", title: "x", body: "copy", contentPillar: facebook.pillarLabel, contentAngle: facebook.angleLabel, objective: facebook.objectiveLabel, channel: facebook.channel, strategyVersion: facebook.strategyVersion, catalogFingerprint: facebook.catalogFingerprint, strategySnapshot: facebook.strategySnapshot, format: "text" }] as never, safetyNotes: [] })).toThrow("STRATEGY_CHANNEL_MISMATCH");
  });

  it("preserves opposite-branch contract errors through official and managed web adapters", async () => {
    const imageStrategy = completeImageStrategy;
    const imagePayload = JSON.stringify({ variants: [{ platform: "instagram", kind: "image", title: "x", body: "copy", contentPillar: strategy.pillarLabel, contentAngle: strategy.angleLabel, objective: strategy.objectiveLabel, channel: strategy.channel, strategyVersion: strategy.strategyVersion, catalogFingerprint: strategy.catalogFingerprint, strategySnapshot: imageStrategy.strategySnapshot, format: "image", metadata: { imageConcept: "concept", imagePrompt: "prompt", videoConcept: "wrong", videoPrompt: "wrong" } }] });
    const official = new OfficialAIGateway({ provider: "openai", apiKey: "test-key", model: "model", fetchImpl: async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: imagePayload }] }] }), { status: 200 }) });
    const request = { workspaceId: "workspace-a", prompt: "x", targetPlatforms: ["instagram" as const], contentKinds: ["image" as const], brandSystem: { workspaceId: "workspace-a", voice: "Clear", audience: "Customers", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "Inter" } }, metadata: { structuredOutput: true, assetFormat: "image", resolvedStrategy: imageStrategy, strategySnapshot: imageStrategy.strategySnapshot } };
    await expect(official.generate(request)).rejects.toThrow("IMAGE_VIDEO_METADATA_FORBIDDEN");

    const videoStrategy = { ...strategy, channel: "facebook" as const, format: "video" as const, strategySnapshot: { ...strategy, channel: "facebook" as const, format: "video" as const } };
    const videoPayload = JSON.stringify({ variants: [{ platform: "facebook", kind: "video", title: "x", body: "copy", contentPillar: videoStrategy.pillarLabel, contentAngle: videoStrategy.angleLabel, objective: videoStrategy.objectiveLabel, channel: videoStrategy.channel, strategyVersion: videoStrategy.strategyVersion, catalogFingerprint: videoStrategy.catalogFingerprint, strategySnapshot: videoStrategy.strategySnapshot, format: "video", metadata: { videoConcept: "concept", videoPrompt: "prompt", imageConcept: "wrong", imagePrompt: "wrong" } }] });
    const gemini = new GeminiWebAIGateway({ model: "model", invoke: async () => ({ text: videoPayload }) });
    await expect(gemini.generate({ ...request, targetPlatforms: ["facebook"], contentKinds: ["video"], metadata: { structuredOutput: true, assetFormat: "video", resolvedStrategy: videoStrategy, strategySnapshot: videoStrategy.strategySnapshot } })).rejects.toThrow("VIDEO_IMAGE_METADATA_FORBIDDEN");
    const chatgpt = new ChatGPTWebAIGateway({ model: "model", invoke: async (command) => command === "chatgpt_web_open" ? { opened: true } : { text: videoPayload } });
    await expect(chatgpt.generate({ ...request, targetPlatforms: ["facebook"], contentKinds: ["video"], metadata: { structuredOutput: true, assetFormat: "video", resolvedStrategy: videoStrategy, strategySnapshot: videoStrategy.strategySnapshot } })).rejects.toThrow("VIDEO_IMAGE_METADATA_FORBIDDEN");
  });
});


describe("fix4 self-describing official and managed-web contracts (transport fixtures only)", () => {
  for (const format of ["text", "image", "video"] as const) {
    for (const provider of ["openai", "gemini", "gemini_web", "chatgpt_web"] as const) {
      it(`${provider} ${format}: accepts an identity learned only from the transmitted prompt`, async () => {
        const { prepareStrategyGenerationForChannels, runStrategyGenerationWithRetry } = await import("./generationRoute");
        const { starterStrategyCatalog } = await import("./contentStrategy");
        const prepared = prepareStrategyGenerationForChannels({ catalog: starterStrategyCatalog("brand-a"), channels: ["facebook", "instagram"], format, selection: { objective: "conversion", pillar: "proof-and-process", angle: "mix" }, slotIndex: 0 });
        if (!prepared.ok) throw new Error(prepared.code);
        const strategies = Object.fromEntries(Object.entries(prepared.strategies).map(([channel, value]) => {
          const snapshot = { ...value.strategySnapshot!, recipeId: "recipe-a", recipeGuidance: "Hook then proof then CTA.", angleIdByChannel: { facebook: prepared.strategies.facebook.angleId, instagram: prepared.strategies.instagram.angleId } };
          return [channel, { ...value, recipeId: snapshot.recipeId, strategySnapshot: snapshot }];
        }));
        const request = { workspaceId: "client-a", prompt: "Write a useful post using the supplied identity.", targetPlatforms: ["facebook", "instagram"] as Array<"facebook" | "instagram">, contentKinds: [format], brandSystem: { workspaceId: "client-a", voice: "Clear", audience: "Customers", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "system" } }, metadata: { structuredOutput: true, assetFormat: format, resolvedStrategy: strategies.facebook, resolvedStrategiesByChannel: strategies } };
        const prompts: string[] = [];
        const snake = (value: unknown): unknown => Array.isArray(value) ? value.map(snake) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), snake(item)])) : value;
        const reply = (prompt: string) => {
          prompts.push(prompt);
          const identities = [...prompt.matchAll(/IMMUTABLE STRATEGY IDENTITY JSON:\n([^\n]+)/g)].map((match) => JSON.parse(match[1]!));
          const variants = identities.map((identity) => ({ ...identity, platform: identity.channel, kind: format, title: "Fixture topic", body: "A fixture copy derived independently of application metadata.", metadata: { ...(format === "image" ? { imageConcept: "Fixture image", imagePrompt: "Fixture image prompt" } : format === "video" ? { videoConcept: "Fixture video", videoPrompt: "Fixture video prompt" } : {}), strategyRationale: "Fixture rationale." } }));
          // The first fixture response reports a mismatch. The second uses only the wire contract.
          if (prompts.length === 1 && variants.length) variants[0].contentAngle = "wrong-angle";
          return JSON.stringify(snake({ variants, safetyNotes: ["Transport fixture; no provider called."] }));
        };
        const gateway = provider === "openai" || provider === "gemini"
          ? new OfficialAIGateway({ provider, apiKey: "fixture-only", model: "fixture", fetchImpl: async (_url, init) => { const wire = JSON.parse(String(init?.body)); const output = reply(provider === "openai" ? wire.input : wire.contents[0].parts[0].text); return new Response(JSON.stringify(provider === "openai" ? { output: [{ content: [{ type: "output_text", text: output }] }] } : { candidates: [{ content: { parts: [{ text: output }] } }] }), { status: 200 }); } })
          : provider === "gemini_web" ? new GeminiWebAIGateway({ model: "fixture", invoke: async (_command, args) => ({ text: reply(String(args?.prompt)) }) }) : new ChatGPTWebAIGateway({ model: "fixture", invoke: async (command, args) => command === "chatgpt_web_open" ? {} : { text: reply(String(args?.prompt)) } });
        const count = { value: 0 };
        const result = await runStrategyGenerationWithRetry({ contentRunId: "wire-fixture", strategy: strategies.facebook!, format, attemptCounter: count, generate: () => gateway.generate(request), validate: () => ({ ok: true }) });
        expect(count.value).toBe(2);
        expect(prompts).toHaveLength(2);
        expect(prompts[1]).toBe(prompts[0]);
        expect(result.variants).toHaveLength(2);
        for (const variant of result.variants) expect(variant.strategySnapshot).toEqual(strategies[variant.platform]!.strategySnapshot);
      });
    }
  }
});
