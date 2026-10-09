import { describe, expect, it, vi } from "vitest";
import { activeUserProfileId, activateUserProfile, createEmptyProfile, listUserProfiles, preferredStartupProfileId, profileDataRoot, profileSnapshotKey, saveUserProfile, setActiveUserProfile, startupUserProfileId } from "./profileDomain";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value), removeItem: (key) => void values.delete(key), clear: () => values.clear(), key: (index) => [...values.keys()][index] ?? null, length: values.size } as Storage;
}

describe("local user profiles", () => {
  it("rejects invalid IDs before deriving profile paths and keeps valid roots distinct", () => {
    expect(() => profileSnapshotKey("Bảo Vy / client")).toThrow("PROFILE_ID_INVALID");
    expect(() => profileDataRoot("/app/user-data", "../profile-bavy")).toThrow("PROFILE_ID_INVALID");
    expect(() => profileDataRoot("/app/user-data", "profile-A")).toThrow("PROFILE_ID_INVALID");
    expect(profileDataRoot("/app/user-data", "profile-a")).toBe("/app/user-data/profiles/profile-a");
    expect(profileDataRoot("/app/user-data", "profile-a")).not.toBe(profileDataRoot("/app/user-data", "profile-b"));
  });

  it("keeps a new profile separate and switchable", () => {
    const store = memoryStorage();
    const first = listUserProfiles(store)[0];
    const second = createEmptyProfile("Linh", "profile-linh", new Date("2026-09-11T00:00:00.000Z"));
    saveUserProfile(second, store);
    expect(setActiveUserProfile(second.id, store)).toBe(true);
    expect(activeUserProfileId(store)).toBe(second.id);
    expect(listUserProfiles(store)).toHaveLength(2);
    expect(first.id).not.toBe(second.id);
  });

  it("reads the startup profile without writing the registry before native activation", () => {
    const store = memoryStorage();
    expect(startupUserProfileId(store)).toBe("profile-bavy");
    expect(store.length).toBe(0);
  });

  it("prefers persisted native selection and falls back to the renderer registry once", () => {
    const store = memoryStorage();
    const profile = createEmptyProfile("Linh", "profile-linh");
    saveUserProfile(profile, store);
    expect(preferredStartupProfileId("profile-native", store)).toBe("profile-native");
    expect(preferredStartupProfileId(null, store)).toBe("profile-bavy");
  });

  it("fails closed for a tampered native or persisted profile alias instead of selecting the canonical lowercase profile", () => {
    const store = memoryStorage();
    saveUserProfile(createEmptyProfile("A", "profile-a"), store);
    saveUserProfile(createEmptyProfile("B", "profile-b"), store);
    store.setItem("signalflow.active-profile.v1", "profile-a ");

    expect(() => preferredStartupProfileId("profile-a ", store)).toThrow("PROFILE_ID_INVALID");
    expect(() => activeUserProfileId(store)).toThrow("PROFILE_ID_INVALID");
    expect(() => startupUserProfileId(store)).toThrow("PROFILE_ID_INVALID");
  });

  it("validates an activation ID before invoking native runtime activation", async () => {
    const store = memoryStorage();
    const activate = vi.fn(async () => ({ state: "ready", ready: true, profileId: "profile-a", runtimeId: "runtime-a" }));

    await expect(activateUserProfile("profile-a ", activate, store)).rejects.toThrow("PROFILE_ID_INVALID");

    expect(activate).not.toHaveBeenCalled();
  });

  it("persists the renderer selection only after exact native readiness", async () => {
    const store = memoryStorage();
    const second = createEmptyProfile("Linh", "profile-linh", new Date("2026-09-11T00:00:00.000Z"));
    saveUserProfile(second, store);
    let resolveActivation: (value: unknown) => void = () => undefined;
    const pending = activateUserProfile(second.id, () => new Promise((resolve) => { resolveActivation = resolve; }), store);
    expect(activeUserProfileId(store)).toBe("profile-bavy");
    resolveActivation({ state: "ready", ready: true, profileId: second.id, runtimeId: "signalflow-profile-linh-launch-1" });
    await pending;
    expect(activeUserProfileId(store)).toBe(second.id);

    const failedStore = memoryStorage();
    saveUserProfile(second, failedStore);
    await expect(activateUserProfile(second.id, async () => ({ state: "ready", ready: true, profileId: second.id, runtimeId: "" }), failedStore)).rejects.toThrow("PROFILE_RUNTIME_NOT_READY");
    expect(activeUserProfileId(failedStore)).toBe("profile-bavy");
  });

  it("syncs a native active profile that is absent from the renderer registry", async () => {
    const store = memoryStorage();
    await activateUserProfile("profile-native", async () => ({ state: "ready", ready: true, profileId: "profile-native", runtimeId: "runtime-native-1" }), store);
    expect(activeUserProfileId(store)).toBe("profile-native");
    expect(listUserProfiles(store).find((profile) => profile.id === "profile-native")?.displayName).toBe("Người dùng");
  });

  it("requests native rollback when renderer active-profile persistence fails", async () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === "signalflow.active-profile.v1" && value === "profile-linh") throw new Error("storage unavailable");
        values.set(key, value);
      },
      removeItem: (key: string) => void values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    } as Storage;
    const second = createEmptyProfile("Linh", "profile-linh");
    saveUserProfile(second, store);
    setActiveUserProfile("profile-bavy", store);
    let rollbackProfileId = "";

    await expect(activateUserProfile(
      second.id,
      async () => ({ state: "ready", ready: true, profileId: second.id, runtimeId: "runtime-b" }),
      store,
      async (profileId) => {
        rollbackProfileId = profileId;
        return { state: "ready", ready: true, profileId, runtimeId: "runtime-a-2" };
      },
    )).rejects.toThrow("PROFILE_REGISTRY_UPDATE_FAILED");

    expect(rollbackProfileId).toBe("profile-bavy");
    expect(activeUserProfileId(store)).toBe("profile-bavy");
  });
});
