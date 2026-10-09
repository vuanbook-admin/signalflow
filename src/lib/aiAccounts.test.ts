import { describe, expect, it, vi } from "vitest";
import { aiSecretAccount, clearAIProvider, defaultAIAccounts, getAIProviderLoginUrl, markAIManualAssist, markAIWebSubscription, readAIAccountRegistry, saveAIProviderKey, sanitizeAIAccountRecord, updateAIProviderModel } from "./aiAccounts";
import { ManualAssistAIGateway, MockAIGateway } from "./gateway";
import { OfficialAIGateway } from "./officialGateway";
import type { AIGenerationRequest } from "./mvpContracts";
import type { SecretStore } from "./secretStore";

class MemorySecretStore implements SecretStore {
  values = new Map<string, string>();
  async set(account: string, secret: string) { this.values.set(account, secret); }
  async get(account: string) { return this.values.get(account) ?? null; }
  async delete(account: string) { this.values.delete(account); }
}

const storage = () => {
  const values = new Map<string, string>();
  return { values, value: null as string | null, getItem(key: string) { return values.get(key) ?? null; }, setItem(key: string, value: string) { values.set(key, value); this.value = value; } };
};
const request: AIGenerationRequest = { workspaceId: "workspace-1", prompt: "Build a useful finance post", targetPlatforms: ["facebook"], contentKinds: ["text"], brandSystem: { workspaceId: "workspace-1", voice: "Clear and practical", audience: "Adults", prohibitedClaims: [], visualTokens: { primary: "#000", secondary: "#fff", typography: "Inter" } } };
const mediaRequest: AIGenerationRequest = { ...request, mediaAttachments: [{ assetId: "asset-1", localAssetPath: "/app/media/one.png", mimeType: "image/png", order: 0, role: "publish" }] };
const mockStrategyBase = { objectiveKey: "reach" as const, objectiveLabel: "Reach", pillarId: "audience-insight", pillarLabel: "Audience insight", angleId: "audience-insight-audience-question", angleLabel: "Audience question", angleGuidance: "Answer one audience question.", channel: "facebook" as const, format: "text" as const, strategyVersion: 1, catalogFingerprint: "a".repeat(64) };
const mockStrategy = { ...mockStrategyBase, strategySnapshot: { ...mockStrategyBase } };

describe("AI account boundary", () => {
  it("opens official subscription pages for manual assist without reading the session", () => {
    expect(getAIProviderLoginUrl("openai")).toBe("https://chatgpt.com/");
    expect(getAIProviderLoginUrl("gemini")).toBe("https://gemini.google.com/");
  });

  it("keeps API keys out of scalar metadata and reports configured status", async () => {
    const store = new MemorySecretStore(); const meta = storage();
    const registry = await saveAIProviderKey("workspace-1", "openai", "sk-secret-value", "gpt-5.6", store, meta);
    expect(registry.openai.status).toBe("configured");
    expect(meta.value).not.toContain("sk-secret-value");
    expect(store.values.size).toBe(1);
    const restored = await readAIAccountRegistry("workspace-1", store, meta);
    expect(restored.openai.status).toBe("configured");
    expect(JSON.stringify(restored)).not.toContain("sk-secret-value");
  });

  it("separates identical workspace AI settings and keys by profile", async () => {
    const store = new MemorySecretStore();
    const values = new Map<string, string>();
    const meta = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };

    await saveAIProviderKey("workspace-1", "openai", "profile-a-key", "gpt-5.6", store, meta, "profile-a");
    await saveAIProviderKey("workspace-1", "openai", "profile-b-key", "gpt-5.6", store, meta, "profile-b");

    expect(aiSecretAccount("workspace-1", "openai", "profile-a")).not.toBe(aiSecretAccount("workspace-1", "openai", "profile-b"));
    expect(values.size).toBe(2);
    expect((await readAIAccountRegistry("workspace-1", store, meta, "profile-a")).openai.status).toBe("configured");
    expect((await readAIAccountRegistry("workspace-1", store, meta, "profile-b")).openai.status).toBe("configured");
    await clearAIProvider("workspace-1", "openai", store, meta, "profile-a");
    expect((await readAIAccountRegistry("workspace-1", store, meta, "profile-a")).openai.status).toBe("not_configured");
    expect((await readAIAccountRegistry("workspace-1", store, meta, "profile-b")).openai.status).toBe("configured");
  });

  it("stores only scalar manual-assist metadata and supports model/clear actions", async () => {
    const store = new MemorySecretStore(); const meta = storage();
    let registry = await markAIManualAssist("workspace-1", "gemini", "gemini-3.5-pro", meta);
    expect(registry.gemini.status).toBe("manual_assist");
    expect(registry.gemini.mode).toBe("manual_assisted");
    expect(registry.gemini.lastManualAssistAt).toBeTruthy();
    registry = await updateAIProviderModel("workspace-1", "gemini", "gemini-3.7-flash", meta);
    expect(registry.gemini.model).toBe("gemini-3.7-flash");
    registry = await clearAIProvider("workspace-1", "gemini", store, meta);
    expect(registry.gemini.status).toBe("not_configured");
    expect(registry.gemini.mode).toBe("web_subscription");
    expect(meta.value).not.toContain("token");
  });

  it("stores web-subscription mode without creating an API secret", async () => {
    const store = new MemorySecretStore(); const meta = storage();
    const registry = await markAIWebSubscription("workspace-1", "gemini", "gemini-3.5-pro", store, meta);
    expect(registry.gemini.status).toBe("web_session");
    expect(registry.gemini.mode).toBe("web_subscription");
    expect(store.values.size).toBe(0);
    expect(meta.value).not.toContain("cookie");
  });

  it("supports ChatGPT subscription mode without creating an API secret", async () => {
    const store = new MemorySecretStore(); const meta = storage();
    const registry = await markAIWebSubscription("workspace-1", "openai", "gpt-5.6", store, meta);
    expect(registry.openai.status).toBe("web_session");
    expect(registry.openai.mode).toBe("web_subscription");
    expect(store.values.size).toBe(0);
  });

  it("migrates legacy Gemini manual metadata to the in-app subscription mode", async () => {
    const store = new MemorySecretStore();
    const legacy = storage();
    legacy.setItem("signalflow.ai.accounts.v1:workspace-1", JSON.stringify({ gemini: { mode: "manual_assisted", model: "gemini-3.5-pro" } }));
    const registry = await readAIAccountRegistry("workspace-1", store, legacy);
    expect(registry.gemini.mode).toBe("web_subscription");
    expect(registry.gemini.status).toBe("not_configured");
    expect(legacy.values.has("signalflow.ai.accounts.v1:profile-bavy:workspace-1")).toBe(true);
    const otherProfile = await readAIAccountRegistry("workspace-1", store, legacy, "profile-linh");
    expect(otherProfile.gemini.mode).toBe("web_subscription");
    expect(otherProfile.gemini.status).toBe("not_configured");
  });

  it("redacts untrusted account metadata", () => {
    const record = sanitizeAIAccountRecord({ mode: "manual_assisted", model: "invalid", accessToken: "secret" }, "openai");
    expect(record.status).toBe("manual_assist");
    expect(record.model).toBe("gpt-5.6");
    expect(JSON.stringify(record)).not.toContain("secret");
    expect(defaultAIAccounts().openai.status).toBe("not_configured");
  });
});

describe("OfficialAIGateway safe errors", () => {
  it("fails closed before sending customer media to an unsupported API route", async () => {
    const fetchImpl = vi.fn(async () => new Response("should not be called", { status: 200 }));
    await expect(new OfficialAIGateway({ provider: "openai", apiKey: "sk-runtime-secret", model: "gpt-5.6", fetchImpl }).generate(mediaRequest)).rejects.toThrow("MEDIA_ATTACHMENT_PROVIDER_UNSUPPORTED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not expose provider response bodies and uses injected fetch", async () => {
    const fetchImpl = vi.fn(async () => new Response("provider-secret-body", { status: 401, statusText: "Unauthorized" }));
    const gateway = new OfficialAIGateway({ provider: "openai", apiKey: "sk-runtime-secret", model: "gpt-5.6", fetchImpl, timeoutMs: 50 });
    await expect(gateway.generate(request)).rejects.toThrow("AI provider openai request failed (401)");
    await expect(gateway.generate(request)).rejects.not.toThrow("provider-secret-body");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("parses a successful official JSON response for the authenticated smoke path", async () => {
    const output = JSON.stringify({ variants: [{ platform: "facebook", kind: "text", title: "OK", body: "OK", hashtags: [], metadata: {} }], safetyNotes: [] });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: output }] }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await new OfficialAIGateway({ provider: "openai", apiKey: "sk-runtime-secret", model: "gpt-5.6", fetchImpl }).generate(request);
    expect(result.provider).toBe("openai_api");
    expect(result.variants[0]).toMatchObject({ platform: "facebook", kind: "text", title: "OK", body: "OK" });
  });
});

describe("Manual assist gateway", () => {
  it("does not pretend manual or local generation inspected customer media", async () => {
    await expect(new ManualAssistAIGateway().generate(mediaRequest)).rejects.toThrow("MEDIA_ATTACHMENT_PROVIDER_UNSUPPORTED");
    await expect(new MockAIGateway().generate(mediaRequest)).rejects.toThrow("MEDIA_ATTACHMENT_PROVIDER_UNSUPPORTED");
  });

  it("creates a local draft without claiming browser-session automation", async () => {
    const result = await new ManualAssistAIGateway().generate(request);
    expect(result.provider).toBe("manual_assisted");
    expect(result.variants).toHaveLength(1);
    expect(result.safetyNotes.join(" ")).toContain("did not read browser sessions");
    expect(JSON.stringify(result)).not.toContain("cookie");
  });
});

describe("Structured Content OS generation", () => {
  it("returns AI-shaped fields from the safe simulation without renderer defaults", async () => {
    const result = await new MockAIGateway().generate({ ...request, metadata: { structuredOutput: true, brandName: "Bellamy Baby", existingTopics: [], assetFormat: "text", resolvedStrategy: mockStrategy, strategySnapshot: mockStrategy.strategySnapshot } });
    expect(result.variants[0]).toMatchObject({ contentPillar: "Audience insight", contentAngle: "Audience question", objective: "Reach", strategyVersion: 1, strategySnapshot: mockStrategy.strategySnapshot, cta: "Lưu lại để xem sau" });
    expect(result.variants[0]?.title).toContain("Bellamy Baby:");
    expect(result.variants[0]?.hashtags?.length).toBeGreaterThan(0);
    expect(result.variants[0]?.seoKeywords?.length).toBeGreaterThan(0);
    expect(result.variants[0]?.metadata).toMatchObject({ structuredOutput: true, strategyRationale: expect.any(String) });
    expect(result.variants[0]?.metadata).not.toHaveProperty("imageConcept");
  });

  it("requires strategy metadata for structured mock output", async () => {
    await expect(new MockAIGateway().generate({ ...request, metadata: { structuredOutput: true, brandName: "Bellamy Baby", existingTopics: [] } })).rejects.toThrow("STRATEGY_REQUIRED");
  });
});
