import { describe, expect, it } from "vitest";
import {
  mapDiscoveryHttpStatus,
  mapDiscoveryTransportError,
  parseDiscoveryResponse,
  parseGeminiResponse,
  parseOpenAICompatibleResponse,
  parseOpenRouterResponse,
  requestModelDiscovery,
  resolveModelListUrl,
  sanitizeDiscoveryErrorMessage,
  sanitizeDiscoveryResult,
  selectProviderModel,
} from "./providerModels";

describe("OpenRouter model parsing", () => {
  it("parses the /api/v1/models data array into selectable id/name entries", () => {
    const models = parseOpenRouterResponse({
      data: [
        { id: "openai/gpt-5.6", name: "GPT 5.6" },
        { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
        { id: "x-ai/grok-4" },
      ],
    });
    expect(models).toEqual([
      { id: "openai/gpt-5.6", name: "GPT 5.6" },
      { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
      { id: "x-ai/grok-4", name: "x-ai/grok-4" },
    ]);
  });

  it("rejects malformed and empty OpenRouter payloads without fabricating models", () => {
    expect(() => parseOpenRouterResponse(null)).toThrow("DISCOVERY_INVALID_RESPONSE");
    expect(() => parseOpenRouterResponse({})).toThrow("DISCOVERY_INVALID_RESPONSE");
    expect(() => parseOpenRouterResponse({ data: "models" })).toThrow("DISCOVERY_INVALID_RESPONSE");
    expect(parseOpenRouterResponse({ data: [] })).toEqual([]);
    expect(parseOpenRouterResponse({ data: [{ id: "" }, { id: 42 }, null, { id: "a".repeat(300) }] })).toEqual([]);
  });

  it("caps the model list and drops ids that violate the registry pattern", () => {
    const data: Array<Record<string, unknown>> = Array.from({ length: 600 }, (_, index) => ({ id: `vendor/model-${index}`, name: `Model ${index}` }));
    data.push({ id: "bad id with spaces!" });
    const models = parseOpenRouterResponse({ data });
    expect(models).toHaveLength(500);
    expect(models.every((model) => /^[A-Za-z0-9._:/@+-]{1,240}$/.test(model.id))).toBe(true);
  });
});

describe("generic provider routing", () => {
  it("resolves the official list route per provider", () => {
    expect(resolveModelListUrl("openrouter")).toMatchObject({ ok: true, url: "https://openrouter.ai/api/v1/models" });
    expect(resolveModelListUrl("openai_official")).toMatchObject({ ok: true, url: "https://api.openai.com/v1/models" });
    expect(resolveModelListUrl("google_gemini_api")).toMatchObject({ ok: true, url: expect.stringContaining("generativelanguage.googleapis.com") });
    expect(resolveModelListUrl("openai_compatible", "https://provider.example/v1/")).toMatchObject({ ok: true, url: "https://provider.example/v1/models" });
    expect(resolveModelListUrl("nvidia_nim", "https://integrate.api.nvidia.com/v1")).toMatchObject({ ok: true, url: "https://integrate.api.nvidia.com/v1/models" });
  });

  it("returns explicit unsupported or invalid states instead of fake models", () => {
    expect(resolveModelListUrl("vertex_ai")).toMatchObject({ ok: false, errorCode: "VERTEX_DISCOVERY_REQUIRES_ADC" });
    expect(resolveModelListUrl("opencode_go")).toMatchObject({ ok: false, errorCode: "OPENCODE_DISCOVERY_UNSUPPORTED" });
    expect(resolveModelListUrl("unknown_kind")).toMatchObject({ ok: false, errorCode: "PROVIDER_KIND_UNSUPPORTED" });
    expect(resolveModelListUrl("openai_compatible", "http://insecure.example/v1")).toMatchObject({ ok: false, errorCode: "PROVIDER_BASE_URL_INVALID" });
    expect(resolveModelListUrl("openai_compatible")).toMatchObject({ ok: false, errorCode: "PROVIDER_BASE_URL_INVALID" });
    expect(resolveModelListUrl("nvidia_nim", "https://user:pass@example.test/v1")).toMatchObject({ ok: false, errorCode: "PROVIDER_BASE_URL_INVALID" });
  });

  it("routes each provider to its response parser", () => {
    expect(parseDiscoveryResponse("openai_official", { data: [{ id: "gpt-5.6" }] })).toEqual([{ id: "gpt-5.6", name: "gpt-5.6" }]);
    expect(parseDiscoveryResponse("nvidia_nim", { data: [{ id: "meta/llama-3.3-70b" }] })).toEqual([{ id: "meta/llama-3.3-70b", name: "meta/llama-3.3-70b" }]);
    expect(parseDiscoveryResponse("google_gemini_api", { models: [{ name: "models/gemini-3.7-flash", displayName: "Gemini 3.7 Flash" }] })).toEqual([
      { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
    ]);
    expect(() => parseDiscoveryResponse("vertex_ai", { data: [] })).toThrow("PROVIDER_KIND_UNSUPPORTED");
  });

  it("parses OpenAI-compatible and Gemini payloads defensively", () => {
    expect(() => parseOpenAICompatibleResponse({})).toThrow("DISCOVERY_INVALID_RESPONSE");
    expect(parseOpenAICompatibleResponse({ data: [{ id: "  " }, { noId: true }] })).toEqual([]);
    expect(() => parseGeminiResponse({ models: "nope" })).toThrow("DISCOVERY_INVALID_RESPONSE");
    expect(parseGeminiResponse({ models: [{ name: "models/" }, { name: 7 }] })).toEqual([]);
  });
});

describe("discovery error mapping", () => {
  it("maps HTTP failures to auth/rate-limit/not-configured states", () => {
    expect(mapDiscoveryHttpStatus(401)).toMatchObject({ status: "auth", errorCode: "DISCOVERY_AUTH_FAILED" });
    expect(mapDiscoveryHttpStatus(403)).toMatchObject({ status: "auth" });
    expect(mapDiscoveryHttpStatus(429)).toMatchObject({ status: "rate_limited", errorCode: "DISCOVERY_RATE_LIMITED" });
    expect(mapDiscoveryHttpStatus(404)).toMatchObject({ status: "not_configured" });
    expect(mapDiscoveryHttpStatus(500)).toMatchObject({ status: "error", errorCode: "DISCOVERY_PROVIDER_ERROR" });
    expect(mapDiscoveryHttpStatus(400)).toMatchObject({ status: "invalid_response" });
  });

  it("maps transport failures without leaking key material", () => {
    expect(mapDiscoveryTransportError(new Error("DISCOVERY_TIMEOUT"))).toMatchObject({ status: "network", errorCode: "DISCOVERY_TIMEOUT" });
    expect(mapDiscoveryTransportError(new Error("NATIVE_RUNTIME_NOT_AVAILABLE"))).toMatchObject({ errorCode: "NATIVE_RUNTIME_REQUIRED" });
    expect(mapDiscoveryTransportError(new Error("ELECTRON_ARG_INVALID:workspaceId"))).toMatchObject({ status: "not_configured", errorCode: "DISCOVERY_KEY_NOT_CONFIGURED" });
    expect(mapDiscoveryTransportError(new TypeError("fetch failed"))).toMatchObject({ status: "network", errorCode: "DISCOVERY_NETWORK_ERROR" });
  });

  it("redacts key-shaped material from surfaced errors", () => {
    const scrubbed = sanitizeDiscoveryErrorMessage("request failed with sk-or-v1-abcdefgh12345678 and Bearer abcdefgh12345678");
    expect(scrubbed).not.toContain("sk-or-v1-abcdefgh12345678");
    expect(scrubbed).not.toContain("abcdefgh12345678");
    expect(scrubbed).toContain("[redacted]");
  });

  it("sanitizes native results to the typed contract", () => {
    const result = sanitizeDiscoveryResult(
      { status: "ok", models: [{ id: "openai/gpt-5.6", name: "GPT", apiKey: "sk-secret", extra: 1 }, { id: "bad id!" }], errorCode: "weird code!!" },
      "openrouter",
    );
    expect(result).toEqual({ providerKind: "openrouter", status: "ok", models: [{ id: "openai/gpt-5.6", name: "GPT" }] });
    expect(JSON.stringify(result)).not.toContain("sk-secret");
    expect(sanitizeDiscoveryResult({ status: "suspicious", models: "nope" }, "openai_official")).toMatchObject({ status: "error", models: [] });
  });
});

describe("model selection state", () => {
  it("keeps the selected model tied to the provider allow-list", () => {
    expect(selectProviderModel({ providerKind: "openrouter", modelId: "openai/gpt-5.6", allowedIds: ["openai/gpt-5.6"] })).toBe("openai/gpt-5.6");
    expect(selectProviderModel({ providerKind: "openrouter", modelId: "other/model", allowedIds: ["openai/gpt-5.6"] })).toBeNull();
    expect(selectProviderModel({ providerKind: "openrouter", modelId: "other/model", allowedIds: [], allowManualEntry: true })).toBe("other/model");
    expect(selectProviderModel({ providerKind: "openrouter", modelId: "bad id!", allowedIds: [], allowManualEntry: true })).toBeNull();
    expect(selectProviderModel({ providerKind: "openrouter", modelId: "", allowedIds: [] })).toBeNull();
  });

  it("rejects invalid scope before touching native IPC", async () => {
    await expect(requestModelDiscovery({ workspaceId: "../escape", providerKind: "openrouter" })).resolves.toMatchObject({ status: "error", models: [] });
    await expect(requestModelDiscovery({ workspaceId: "ws-1", providerKind: "nope" })).resolves.toMatchObject({ errorCode: "PROVIDER_KIND_UNSUPPORTED" });
  });
});
