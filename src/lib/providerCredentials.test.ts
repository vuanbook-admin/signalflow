import { describe, expect, it } from "vitest";
import { clearProviderKey, isValidProviderSecretRef, providerSecretAccount, providerSecretRef, saveProviderKey } from "./providerCredentials";
import type { SecretStore } from "./secretStore";

class MemorySecretStore implements SecretStore {
  values = new Map<string, string>();
  async set(account: string, secret: string) {
    this.values.set(account, secret);
  }
  async get(account: string) {
    return this.values.get(account) ?? null;
  }
  async delete(account: string) {
    this.values.delete(account);
  }
}

describe("generic provider-key entry", () => {
  it("saves through the secret store and returns only an opaque secretRef", async () => {
    const store = new MemorySecretStore();
    const result = await saveProviderKey("workspace-1", "openrouter", "test-key-material", store);
    expect(result).toEqual({ providerKind: "openrouter", secretRef: "env:signalflow/profiles/profile-bavy/providers/workspace-1/openrouter", status: "configured" });
    expect(JSON.stringify(result)).not.toContain("test-key-material");
    expect(await store.get(providerSecretAccount("workspace-1", "openrouter"))).toBe("test-key-material");
    expect(isValidProviderSecretRef(result.secretRef)).toBe(true);
  });

  it("derives scoped account names and secretRefs per provider", () => {
    expect(providerSecretAccount("ws-1", "nvidia_nim", "profile-linh")).toBe("profile:profile-linh:workspace:ws-1:provider:nvidia_nim:api-key");
    expect(providerSecretRef("ws-1", "nvidia_nim", "profile-linh")).toBe("env:signalflow/profiles/profile-linh/providers/ws-1/nvidia_nim");
    expect(providerSecretAccount("ws-1", "openai_official", "profile-a")).not.toBe(providerSecretAccount("ws-1", "openai_official", "profile-b"));
    expect(isValidProviderSecretRef("env:signalflow/profiles/profile-bavy/providers/ws-1/openrouter")).toBe(true);
    expect(isValidProviderSecretRef("apiKey:sk-secret")).toBe(false);
    expect(isValidProviderSecretRef(undefined)).toBe(false);
  });

  it("keeps identical workspace and provider credentials separate across profiles", async () => {
    const store = new MemorySecretStore();
    const accountA = providerSecretAccount("workspace-1", "openrouter", "profile-a");
    const accountB = providerSecretAccount("workspace-1", "openrouter", "profile-b");
    const refA = providerSecretRef("workspace-1", "openrouter", "profile-a");
    const refB = providerSecretRef("workspace-1", "openrouter", "profile-b");

    await saveProviderKey("workspace-1", "openrouter", "key-a", store, "profile-a");
    await saveProviderKey("workspace-1", "openrouter", "key-b", store, "profile-b");

    expect(accountA).not.toBe(accountB);
    expect(refA).not.toBe(refB);
    expect(isValidProviderSecretRef(refA, "profile-a")).toBe(true);
    expect(isValidProviderSecretRef(refA, "profile-b")).toBe(false);
    expect(await store.get(accountA)).toBe("key-a");
    expect(await store.get(accountB)).toBe("key-b");
  });

  it("rejects empty keys, invalid scope and oversized values", async () => {
    const store = new MemorySecretStore();
    await expect(saveProviderKey("workspace-1", "openrouter", "   ", store)).rejects.toThrow("Enter an API key");
    await expect(saveProviderKey("../escape", "openrouter", "k", store)).rejects.toThrow("PROVIDER_WORKSPACE_INVALID");
    await expect(saveProviderKey("workspace-1", "unknown_kind", "k", store)).rejects.toThrow("PROVIDER_KIND_UNSUPPORTED");
    await expect(saveProviderKey("workspace-1", "openrouter", "x".repeat(100_001), store)).rejects.toThrow("SECURE_STORE_VALUE_INVALID");
    expect(store.values.size).toBe(0);
  });

  it("clears the scoped credential without touching other providers", async () => {
    const store = new MemorySecretStore();
    await saveProviderKey("workspace-1", "openrouter", "key-a", store);
    await saveProviderKey("workspace-1", "openai_official", "key-b", store);
    await clearProviderKey("workspace-1", "openrouter", store);
    expect(await store.get(providerSecretAccount("workspace-1", "openrouter"))).toBeNull();
    expect(await store.get(providerSecretAccount("workspace-1", "openai_official"))).toBe("key-b");
  });
});
