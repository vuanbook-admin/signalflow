import { describe, expect, it } from "vitest";
import { canAutoRunDueJobs, chooseMetaPageId, getMetaLiveReadiness, META_PUBLIC_SMOKE_MESSAGE, metaPublicSmokeIdempotencyKey, persistMetaAccountHints, persistMetaSelectedPageId, publishMetaInstagramJob, publishMetaPageJob, publishMetaPagePhotoJob, publishMetaPageVideoJob, readMetaAccountHints, readMetaSelectedPageId, readMetaSettingsStatus, resolveMetaCredentialValue } from "./metaSettings";
import type { SecretStore } from "./secretStore";

class MemorySecretStore implements SecretStore {
  values = new Map<string, string>();
  async set(account: string, secret: string) { this.values.set(account, secret); }
  async get(account: string) { return this.values.get(account) ?? null; }
  async delete(account: string) { this.values.delete(account); }
}

describe("Meta live readiness contract", () => {
  it("is ready only when a Page is discovered and its access token is configured", () => {
    expect(getMetaLiveReadiness(true, true)).toBe("ready");
    expect(getMetaLiveReadiness(false, true)).toBe("blocked");
    expect(getMetaLiveReadiness(true, false)).toBe("blocked");
  });

  it("allows due-job automation only when live readiness is ready", () => {
    expect(canAutoRunDueJobs(true, "ready")).toBe(true);
    expect(canAutoRunDueJobs(true, "blocked")).toBe(false);
    expect(canAutoRunDueJobs(false, "ready")).toBe(false);
  });
});

describe("Meta settings workspace migration", () => {
  it("moves legacy Mile Mark Money secrets to the current workspace key without returning them", async () => {
    const store = new MemorySecretStore();
    await store.set("workspace:mile-mark-money:meta:app-secret", "legacy-app-secret");
    await store.set("workspace:mile-mark-money:meta:manual-access-token", "legacy-access-token");

    const status = await readMetaSettingsStatus("workspace-mile-mark-money", store);

    expect(status).toMatchObject({ appSecretConfigured: true, accessTokenConfigured: true });
    expect(store.values.get("workspace:workspace-mile-mark-money:meta:app-secret")).toBe("legacy-app-secret");
    expect(store.values.get("workspace:workspace-mile-mark-money:meta:manual-access-token")).toBe("legacy-access-token");
    expect(JSON.stringify(status)).not.toContain("legacy");
  });
});

describe("Meta account hint persistence", () => {
  it("restores only scalar Page and Instagram hints without persisting token material", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    persistMetaAccountHints("profile-bavy", "workspace-1", [
      { id: "page-1", name: "Mile Mark Money", kind: "page", tasks: ["CREATE_CONTENT"], instagram_business_account: { id: "ig-1" } },
      { id: "ig-1", name: "Mile Mark Money", kind: "instagram_business", tasks: ["PUBLISH" ] },
    ], storage);

    const restored = readMetaAccountHints("profile-bavy", "workspace-1", storage);

    expect(restored).toEqual([
      { id: "page-1", name: "Mile Mark Money", kind: "page" },
      { id: "ig-1", name: "Mile Mark Money", kind: "instagram_business" },
    ]);
    expect(JSON.stringify(restored)).not.toContain("CREATE_CONTENT");
    expect(JSON.stringify(restored)).not.toContain("access_token");
  });

  it("ignores malformed and unsupported persisted hints", () => {
    const storage = {
      getItem: () => JSON.stringify([{ id: "page-1", kind: "page" }, { id: "bad", kind: "profile" }, { name: "missing id", kind: "page" }]),
      setItem: () => undefined,
    };

    expect(readMetaAccountHints("profile-bavy", "workspace-1", storage)).toEqual([{ id: "page-1", kind: "page" }]);
  });
});

describe("Meta credential input boundary", () => {
  it("prefers the live DOM value so accessibility typing is not lost before save", () => {
    expect(resolveMetaCredentialValue("dom-token", "stale-state")).toBe("dom-token");
    expect(resolveMetaCredentialValue("", "state-token")).toBe("state-token");
  });
});

describe("Meta Page selection", () => {
  it("keeps a valid saved Page, defaults only when exactly one Page exists, and otherwise requires selection", () => {
    const pages = [{ id: "page-1", kind: "page" }, { id: "page-2", kind: "page" }];
    expect(chooseMetaPageId(pages, "page-2")).toBe("page-2");
    expect(chooseMetaPageId(pages, "missing")).toBe("");
    expect(chooseMetaPageId([{ id: "only-page", kind: "page" }], "")).toBe("only-page");
  });

  it("persists only the selected Page id as local scalar metadata", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    persistMetaSelectedPageId("profile-bavy", "workspace-1", "page-2", storage);
    expect(readMetaSelectedPageId("profile-bavy", "workspace-1", storage)).toBe("page-2");
  });

  it("uses one deterministic, reviewable public smoke message and idempotency key", () => {
    expect(META_PUBLIC_SMOKE_MESSAGE).toContain("SignalFlow live publishing test");
    expect(metaPublicSmokeIdempotencyKey("100000000000001")).toBe("signalflow-public-smoke:100000000000001:v1");
  });

  it("omits the retired SafeMode field from every live Meta publish payload", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        signalflow: {
          invoke: async (command: string, args?: Record<string, unknown>) => {
            calls.push({ command, args });
            return { provider: "meta", providerJobId: `provider-${calls.length}`, providerState: "published", published: true, idempotentReplay: false, tokenBoundary: "env_file" };
          },
        },
      },
    });
    try {
      await publishMetaPageJob("workspace-1", "page-1", "Text", "key-text");
      await publishMetaPagePhotoJob("workspace-1", "page-1", "Caption", "https://cdn.example/image.jpg", "key-photo");
      await publishMetaPageVideoJob("workspace-1", "page-1", "Caption", "https://cdn.example/video.mp4", "key-video");
      await publishMetaInstagramJob("workspace-1", "page-1", "ig-1", "Caption", "https://cdn.example/video.mp4", "video", "key-instagram");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
      else Reflect.deleteProperty(globalThis, "window");
    }
    expect(calls).toHaveLength(4);
    calls.forEach(({ args }) => expect(args).not.toHaveProperty("safeMode"));
  });

  it("isolates account hints and selected Page for profiles sharing one workspace", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const hintsA = [{ id: "page-a", name: "Page A", kind: "page" as const }];
    const hintsB = [{ id: "page-b", name: "Page B", kind: "page" as const }];

    persistMetaAccountHints("profile-a", "workspace-shared", hintsA, storage);
    persistMetaSelectedPageId("profile-a", "workspace-shared", "page-a", storage);
    persistMetaAccountHints("profile-b", "workspace-shared", hintsB, storage);
    persistMetaSelectedPageId("profile-b", "workspace-shared", "page-b", storage);

    expect(readMetaAccountHints("profile-a", "workspace-shared", storage)).toEqual(hintsA);
    expect(readMetaSelectedPageId("profile-a", "workspace-shared", storage)).toBe("page-a");
    expect(readMetaAccountHints("profile-b", "workspace-shared", storage)).toEqual(hintsB);
    expect(readMetaSelectedPageId("profile-b", "workspace-shared", storage)).toBe("page-b");
  });

  it("migrates legacy shared hints only into the owner profile", () => {
    const values = new Map<string, string>([
      ["signalflow.meta.account-hints:workspace-shared", JSON.stringify([{ id: "legacy-page", name: "Legacy Owner Page", kind: "page" }])],
      ["signalflow.meta.selected-page:workspace-shared", "legacy-page"],
    ]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };

    expect(readMetaAccountHints("profile-b", "workspace-shared", storage)).toEqual([]);
    expect(readMetaSelectedPageId("profile-b", "workspace-shared", storage)).toBe("");
    expect(readMetaAccountHints("profile-bavy", "workspace-shared", storage)).toEqual([{ id: "legacy-page", name: "Legacy Owner Page", kind: "page" }]);
    expect(readMetaSelectedPageId("profile-bavy", "workspace-shared", storage)).toBe("legacy-page");
    expect(values.has("signalflow.profile.profile-b.meta.account-hints:workspace-shared")).toBe(false);
    expect(values.has("signalflow.profile.profile-bavy.meta.account-hints:workspace-shared")).toBe(true);
  });
});
