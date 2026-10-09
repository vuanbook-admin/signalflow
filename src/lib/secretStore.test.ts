import { afterEach, describe, expect, it, vi } from "vitest";

describe("profile-owned secret store", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps same-account preview secrets separated between profiles", async () => {
    const values = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
      clear: () => void values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    };
    localStorage.setItem("signalflow.user-profiles.v1", JSON.stringify([
      { id: "profile-a", displayName: "A", createdAt: "2026-09-12T00:00:00.000Z", status: "active" },
      { id: "profile-b", displayName: "B", createdAt: "2026-09-12T00:00:00.000Z", status: "active" },
    ]));
    localStorage.setItem("signalflow.active-profile.v1", "profile-a");
    vi.stubGlobal("window", { localStorage });
    const api = await import("./secretStore");
    const account = "workspace:shared:provider:openrouter:api-key";

    await api.secretStore.set(account, "profile-a-key");
    localStorage.setItem("signalflow.active-profile.v1", "profile-b");
    expect(await api.secretStore.get(account)).toBeNull();
    await api.secretStore.set(account, "profile-b-key");
    expect(await api.secretStore.get(account)).toBe("profile-b-key");
    localStorage.setItem("signalflow.active-profile.v1", "profile-a");
    expect(await api.secretStore.get(account)).toBe("profile-a-key");
    await api.secretStore.delete(account);
    expect(await api.secretStore.get(account)).toBeNull();
    localStorage.setItem("signalflow.active-profile.v1", "profile-b");
    expect(await api.secretStore.get(account)).toBe("profile-b-key");
  });
});
