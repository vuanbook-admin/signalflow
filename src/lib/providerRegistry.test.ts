import { describe, expect, it } from "vitest";

async function registry() {
  return await import("./providerRegistry").catch(() => undefined);
}

describe("LLM Provider Registry", () => {
  it("registers every requested provider as a named, non-fallback candidate", async () => {
    const api = await registry();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.providerRegistry.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["openrouter", "google_gemini_api", "vertex_ai", "openai_official", "openai_compatible", "nvidia_nim", "opencode_go"]));
    expect(api.providerRegistry.find((entry) => entry.kind === "nvidia_nim")?.displayName).toContain("NVIDIA");
    expect(api.providerRegistry.find((entry) => entry.kind === "openrouter")?.allowFallback).toBe(false);
  });

  it("requires an isolated config, secure reference and valid model without exposing credential material", async () => {
    const api = await registry();
    expect(api).toBeDefined();
    if (!api) return;
    const result = api.validateProviderConfiguration({ id: "provider-a", clientId: "client-a", providerKind: "openai_compatible", displayName: "Private model", model: "model-a", baseUrl: "https://example.test/v1", secretRef: "env:signalflow/profiles/profile-a/providers/client-a/provider-a", status: "connected", capabilities: ["copy"] });
    expect(result).toEqual({ ok: true, errors: [] });
    expect(api.validateProviderConfiguration({ id: "provider-a", clientId: "client-a", providerKind: "openai_compatible", displayName: "Private model", model: "model-a", baseUrl: "https://example.test/v1", secretRef: "keychain:provider-a", status: "connected", capabilities: ["copy"] })).toMatchObject({ ok: false, errors: ["PROVIDER_SECRET_REF_SCOPE_INVALID"] });
    expect(api.validateProviderConfiguration({ id: "provider-a", clientId: "client-a", providerKind: "openai_compatible", displayName: "Private model", model: "model-a", baseUrl: "http://example.test", apiKey: "must-be-rejected", status: "connected", capabilities: ["copy"] })).toMatchObject({ ok: false, errors: expect.arrayContaining(["SENSITIVE_FIELD_REJECTED", "PROVIDER_BASE_URL_INVALID"]) });
  });

  it("reports a scalar probe result and keeps OpenCode Go blocked pending policy confirmation", async () => {
    const api = await registry();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.createProviderHealthResult({ providerId: "provider-go", providerKind: "opencode_go", model: "model", capabilities: ["copy"], checkedAt: "2026-08-29T00:00:00.000Z", policyConfirmationRequired: true })).toMatchObject({ status: "review_required", errorCode: "POLICY_CONFIRMATION_REQUIRED" });
    expect(JSON.stringify(api.createProviderHealthResult({ providerId: "provider-a", providerKind: "openrouter", model: "model", capabilities: ["copy"], checkedAt: "2026-08-29T00:00:00.000Z" }))).not.toMatch(/api.?key|cookie|auth\.json/i);
  });
});
