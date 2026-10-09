import { describe, expect, it } from "vitest";
import { validateCommandArgs } from "./security.cjs";
import { discoverProviderModels, parseDiscoveryResponse, providerSecretAccount, resolveModelListUrl } from "./provider-models.cjs";

const openRouterPayload = { data: [{ id: "openai/gpt-5.6", name: "GPT 5.6" }, { id: "x-ai/grok-4" }] };

function stubFetch(payload, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)) });
}

describe("provider discovery IPC validation", () => {
  it("accepts scoped workspace/provider identifiers with an optional HTTPS base URL", () => {
    expect(validateCommandArgs("provider_discover_models", { workspaceId: "ws-1", providerKind: "openrouter" })).toMatchObject({ providerKind: "openrouter" });
    expect(validateCommandArgs("provider_discover_models", { workspaceId: "ws-1", providerKind: "nvidia_nim", baseUrl: "https://integrate.api.nvidia.com/v1" })).toMatchObject({
      baseUrl: "https://integrate.api.nvidia.com/v1",
    });
  });

  it("rejects unknown providers, non-HTTPS endpoints, credential-bearing URLs and scope escapes", () => {
    expect(() => validateCommandArgs("provider_discover_models", { workspaceId: "ws-1", providerKind: "unknown" })).toThrow("ELECTRON_ARG_INVALID:providerKind");
    expect(() => validateCommandArgs("provider_discover_models", { workspaceId: "ws-1", providerKind: "openai_compatible", baseUrl: "http://insecure.example/v1" })).toThrow(
      "ELECTRON_ARG_INVALID:baseUrl",
    );
    expect(() => validateCommandArgs("provider_discover_models", { workspaceId: "ws-1", providerKind: "nvidia_nim", baseUrl: "https://user:pass@example.test/v1" })).toThrow(
      "ELECTRON_ARG_INVALID:baseUrl",
    );
    expect(() => validateCommandArgs("provider_discover_models", { workspaceId: "../escape", providerKind: "openrouter" })).toThrow("ELECTRON_ARG_INVALID:workspaceId");
    expect(() => validateCommandArgs("provider_discover_models", { workspaceId: "ws-1" })).toThrow("ELECTRON_ARG_INVALID:providerKind");
  });

  it("never accepts a raw credential or account override through discovery args", () => {
    const args = validateCommandArgs("provider_discover_models", { workspaceId: "ws-1", providerKind: "openrouter" });
    expect("apiKey" in args && "secret" in args && "account" in args).toBe(false);
    expect(providerSecretAccount("ws-1", "openrouter")).toBe("workspace:ws-1:provider:openrouter:api-key");
  });
});

describe("native provider model discovery", () => {
  it("discovers OpenRouter models through the stored key without exposing it", async () => {
    const seen = {};
    const result = await discoverProviderModels(
      { workspaceId: "ws-1", providerKind: "openrouter" },
      {
        getSecret: (account) => {
          seen.account = account;
          return "test-key-material";
        },
        fetchImpl: async (url, init) => {
          seen.url = url;
          seen.auth = init.headers.authorization;
          return { ok: true, status: 200, text: async () => JSON.stringify(openRouterPayload) };
        },
      },
    );
    expect(seen).toMatchObject({ account: "workspace:ws-1:provider:openrouter:api-key", url: "https://openrouter.ai/api/v1/models", auth: "Bearer test-key-material" });
    expect(result).toMatchObject({ providerKind: "openrouter", status: "ok" });
    expect(result.models).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("test-key-material");
  });

  it("maps auth, rate-limit and network failures without key material", async () => {
    const keyed = { getSecret: () => "test-key-material" };
    expect(await discoverProviderModels({ workspaceId: "ws-1", providerKind: "openai_official" }, { ...keyed, fetchImpl: stubFetch({}, { ok: false, status: 401 }) })).toMatchObject({
      status: "auth",
      errorCode: "DISCOVERY_AUTH_FAILED",
    });
    expect(await discoverProviderModels({ workspaceId: "ws-1", providerKind: "openai_official" }, { ...keyed, fetchImpl: stubFetch({}, { ok: false, status: 429 }) })).toMatchObject({
      status: "rate_limited",
    });
    expect(await discoverProviderModels({ workspaceId: "ws-1", providerKind: "openai_compatible", baseUrl: "https://provider.example/v1" }, { ...keyed, fetchImpl: async () => { throw new TypeError("fetch failed"); } })).toMatchObject({
      status: "network",
      errorCode: "DISCOVERY_NETWORK_ERROR",
    });
    const authed = await discoverProviderModels({ workspaceId: "ws-1", providerKind: "openai_official" }, { ...keyed, fetchImpl: stubFetch({}, { ok: false, status: 401 }) });
    expect(JSON.stringify(authed)).not.toContain("test-key-material");
  });

  it("rejects malformed and empty provider responses instead of faking models", async () => {
    const keyed = { getSecret: () => "k" };
    expect(await discoverProviderModels({ workspaceId: "ws-1", providerKind: "openrouter" }, { ...keyed, fetchImpl: stubFetch({ unexpected: true }) })).toMatchObject({
      status: "invalid_response",
    });
    expect(await discoverProviderModels({ workspaceId: "ws-1", providerKind: "openrouter" }, { ...keyed, fetchImpl: stubFetch("not json") })).toMatchObject({
      status: "invalid_response",
    });
    expect(await discoverProviderModels({ workspaceId: "ws-1", providerKind: "openrouter" }, { ...keyed, fetchImpl: stubFetch({ data: [] }) })).toMatchObject({
      status: "invalid_response",
      errorCode: "DISCOVERY_EMPTY_MODEL_LIST",
    });
  });

  it("returns explicit unsupported/not-configured states for Vertex, OpenCode Go and missing keys", async () => {
    expect(await discoverProviderModels({ workspaceId: "ws-1", providerKind: "vertex_ai" }, { getSecret: () => "k", fetchImpl: stubFetch({}) })).toMatchObject({
      status: "unsupported",
      errorCode: "VERTEX_DISCOVERY_REQUIRES_ADC",
    });
    expect(await discoverProviderModels({ workspaceId: "ws-1", providerKind: "opencode_go" }, { getSecret: () => "k", fetchImpl: stubFetch({}) })).toMatchObject({
      status: "unsupported",
      errorCode: "OPENCODE_DISCOVERY_UNSUPPORTED",
    });
    expect(await discoverProviderModels({ workspaceId: "ws-1", providerKind: "openrouter" }, { getSecret: () => null, fetchImpl: stubFetch(openRouterPayload) })).toMatchObject({
      status: "not_configured",
      errorCode: "DISCOVERY_KEY_NOT_CONFIGURED",
    });
    expect(resolveModelListUrl("openrouter").url).toBe("https://openrouter.ai/api/v1/models");
    expect(parseDiscoveryResponse("openrouter", openRouterPayload)).toHaveLength(2);
  });
});
