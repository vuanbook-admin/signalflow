import { describe, expect, it } from "vitest";
import { starterStrategyCatalog } from "./contentStrategy";

async function routes() { return await import("./generationRoute").catch(() => undefined); }

describe("exclusive generation route presentation", () => {
  it("renders exactly the Control Plane selected mode and never an automatic alternate", async () => {
    const api = await routes();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.presentGenerationDecision({ route: "provider_api", mode: "llm_provider", provider: "openrouter", model: "model-a", capabilities: ["copy"] })).toEqual({ state: "ready", label: "LLM provider · OpenRouter · model-a", alternateRoute: "inactive" });
    expect(api.presentGenerationDecision({ blockedReason: "APP_OPEN_REQUIRED", mode: "subscription_package", provider: "gemini_web", model: "gemini", capabilities: ["copy"] })).toMatchObject({ state: "blocked", recoveryCode: "APP_OPEN_REQUIRED", alternateRoute: "inactive" });
  });

  it("does not claim a route switch after first provider attempt", async () => {
    const api = await routes();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.canChangeGenerationProfile({ providerAttempted: true, generationProfileId: "profile-a" }, "profile-b")).toBe(false);
    expect(api.canChangeGenerationProfile({ providerAttempted: false, generationProfileId: "profile-a" }, "profile-b")).toBe(true);
  });

  it("resolves a manual strategy before a gateway can be called", async () => {
    const api = await routes();
    expect(api).toBeDefined();
    if (!api) return;
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-14T00:00:00.000Z"));
    const prepared = api.prepareStrategyGeneration({ catalog, channel: "instagram", format: "image", selection: { objective: "conversion", pillar: "proof-and-process", angle: "proof-and-process-proof-point" }, slotIndex: 0 });
    expect(prepared).toMatchObject({ ok: true, strategy: { objectiveKey: "conversion", pillarId: "proof-and-process", angleId: "proof-and-process-proof-point", channel: "instagram", strategyVersion: 1 } });
    const invalid = api.prepareStrategyGeneration({ catalog, channel: "instagram", format: "image", selection: { objective: "conversion", pillar: "proof-and-process", angle: "missing-angle" }, slotIndex: 0 });
    expect(invalid).toMatchObject({ ok: false, code: expect.stringMatching(/ANGLE|STRATEGY/) });
  });

  it("creates stable idempotency keys for a content run strategy and format", async () => {
    const api = await routes();
    expect(api).toBeDefined();
    if (!api) return;
    const input = { contentRunId: "run-a", strategyVersion: 7, format: "video" as const };
    expect(api.generationIdempotencyKey(input)).toBe("generation:run-a:v7:video");
    expect(api.generationIdempotencyKey(input)).toBe(api.generationIdempotencyKey(input));
    expect(api.generationIdempotencyKey({ ...input, format: "image" })).not.toBe(api.generationIdempotencyKey(input));
  });

  it("retries one strategy mismatch with the same slot/version/idempotency key", async () => {
    const api = await routes();
    expect(api).toBeDefined();
    if (!api) return;
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-14T00:00:00.000Z"));
    const prepared = api.prepareStrategyGeneration({ catalog, channel: "facebook", format: "text", selection: { objective: "reach", pillar: "audience-insight", angle: "audience-insight-pain-point" }, slotIndex: 0 });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const attempts: Array<{ attempt: number; idempotencyKey: string }> = [];
    let calls = 0;
    const result = await api.runStrategyGenerationWithRetry({ contentRunId: "run-retry", strategy: prepared.strategy, format: "text", generate: async (context) => { attempts.push(context); calls += 1; return calls === 1 ? "mismatch" : "valid"; }, validate: (value) => value === "valid" ? { ok: true } : { ok: false, code: "STRATEGY_ANGLE_MISMATCH", message: "wrong angle" } });
    expect(result).toBe("valid");
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual({ attempt: 1, idempotencyKey: "generation:run-retry:v1:text" });
    expect(attempts[1]).toEqual({ attempt: 2, idempotencyKey: attempts[0]!.idempotencyKey });
    await expect(api.runStrategyGenerationWithRetry({ contentRunId: "run-no-partial", strategy: prepared.strategy, format: "text", generate: async () => "mismatch", validate: () => ({ ok: false, code: "STRATEGY_OUTPUT_INVALID", message: "still wrong" }) })).rejects.toThrow("STRATEGY_OUTPUT_INVALID");
  });

  it("retries typed adapter contract failures once and preserves the idempotency key", async () => {
    const api = await routes();
    expect(api).toBeDefined();
    if (!api) return;
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-14T00:00:00.000Z"));
    const prepared = api.prepareStrategyGeneration({ catalog, channel: "facebook", format: "image", selection: { objective: "reach", pillar: "practical-education", angle: "practical-education-step-by-step-guide" }, slotIndex: 0 });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const attempts: Array<{ attempt: number; idempotencyKey: string }> = [];
    let calls = 0;
    const result = await api.runStrategyGenerationWithRetry({ contentRunId: "run-typed-retry", strategy: prepared.strategy, format: "image", generate: async (context) => { attempts.push(context); calls += 1; if (calls === 1) throw new Error("IMAGE_VIDEO_METADATA_FORBIDDEN: image branch is invalid"); return "valid"; }, validate: () => ({ ok: true }) });
    expect(result).toBe("valid");
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.idempotencyKey).toBe(attempts[0]!.idempotencyKey);
    await expect(api.runStrategyGenerationWithRetry({ contentRunId: "run-typed-failure", strategy: prepared.strategy, format: "image", generate: async () => { throw new Error("VIDEO_IMAGE_METADATA_FORBIDDEN: video branch is invalid"); }, validate: () => ({ ok: true }) })).rejects.toThrow("VIDEO_IMAGE_METADATA_FORBIDDEN");
  });

  it("classifies opposite asset branches as deterministic contract failures", async () => {
    const api = await routes();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.isDeterministicGenerationFailure("IMAGE_VIDEO_METADATA_FORBIDDEN: wrong branch")).toBe(true);
    expect(api.isDeterministicGenerationFailure("VIDEO_IMAGE_METADATA_FORBIDDEN: wrong branch")).toBe(true);
    expect(api.isDeterministicGenerationFailure("AI provider timed out")).toBe(false);
  });

  it("resolves a channel-specific angle for every manual target", async () => {
    const api = await routes();
    expect(api).toBeDefined();
    if (!api) return;
    const base = starterStrategyCatalog("brand-a", new Date("2026-09-14T00:00:00.000Z"));
    const firstInstagramAngle = base.pillars[0]!.angles[0]!.id;
    const catalog = { ...base, channelOverrides: { ...base.channelOverrides, instagram: { disabledAngleIds: [firstInstagramAngle] } } };
    const resolved = api.prepareStrategyGenerationForChannels({ catalog, channels: ["facebook", "instagram"], format: "text", selection: { objective: "reach", pillar: "audience-insight", angle: "mix" }, slotIndex: 0 });
    expect(resolved).toMatchObject({ ok: true, strategies: { facebook: { channel: "facebook", angleId: firstInstagramAngle }, instagram: { channel: "instagram", angleId: "audience-insight-pain-point" } } });
  });

  it("rejects an invalid channel before a multi-channel gateway dispatch", async () => {
    const api = await routes();
    expect(api).toBeDefined();
    if (!api) return;
    const catalog = starterStrategyCatalog("brand-a", new Date("2026-09-14T00:00:00.000Z"));
    const invalid = api.prepareStrategyGenerationForChannels({ catalog, channels: ["facebook", "instagram"], format: "text", selection: { objective: "reach", pillar: "audience-insight", angle: "missing-angle" }, slotIndex: 0 });
    expect(invalid).toMatchObject({ ok: false, code: expect.stringMatching(/ANGLE|STRATEGY/) });
  });
});


describe("fix4 typed mismatch retry", () => {
  it("retries a thrown typed code even when its message does not repeat the code", async () => {
    const api = await routes();
    if (!api) throw new Error("missing route module");
    const resolved = api.prepareStrategyGeneration({ catalog: starterStrategyCatalog("brand-a"), channel: "facebook", format: "text", selection: { objective: "reach", pillar: "mix", angle: "mix" }, slotIndex: 0 });
    if (!resolved.ok) throw new Error(resolved.code);
    const attempts: Array<{ attempt: number; idempotencyKey: string }> = [];
    const counter = { value: 0 };
    const result = await api.runStrategyGenerationWithRetry({ contentRunId: "typed-code", strategy: resolved.strategy, format: "text", attemptCounter: counter, generate: async (context) => { attempts.push(context); if (attempts.length === 1) throw Object.assign(new Error("Wrong strategy returned"), { code: "STRATEGY_SNAPSHOT_MISMATCH" }); return "valid"; }, validate: () => ({ ok: true }) });
    expect(result).toBe("valid");
    expect(counter.value).toBe(2);
    expect(attempts.map((item) => item.idempotencyKey)).toEqual(["generation:typed-code:v1:text", "generation:typed-code:v1:text"]);
    let calls = 0;
    await expect(api.runStrategyGenerationWithRetry({ contentRunId: "typed-code-twice", strategy: resolved.strategy, format: "text", generate: async () => { calls++; throw { code: "STRATEGY_SNAPSHOT_MISMATCH", message: "Wrong identity" }; }, validate: () => ({ ok: true }) })).rejects.toMatchObject({ code: "STRATEGY_SNAPSHOT_MISMATCH" });
    expect(calls).toBe(2);
  });
});
