import { describe, expect, it } from "vitest";
import { profileSnapshotKey } from "./profileDomain";

function storageWith(values: Map<string, string>) {
  const removed: string[] = [];
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { removed.push(key); values.delete(key); },
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
  };
  return { localStorage, removed };
}

describe("renderer SafeMode removal", () => {
  it("removes obsolete SafeMode persistence helpers", async () => {
    const api = await import("./persistence");
    for (const name of [
      "applySafeModePreference",
      "readSafeModePreference",
      "safeModeAfterPreferenceChange",
      "safeModeForCurrentTransition",
      "sameSafeModeScope",
      "sameSafeModeTransition",
      "settleSafeModeTransition",
      "writeSafeModePreference",
    ]) expect(api).not.toHaveProperty(name);
  });

  it("removes legacy SafeMode state while preserving drafts, media, and publication history", async () => {
    const snapshot = {
      schemaVersion: 5,
      savedAt: "2026-09-18T00:00:00.000Z",
      drafts: [{ id: "draft-keep", title: "Keep draft" }],
      selectedPlatforms: ["Facebook"],
      mediaAssets: [{ id: "asset-keep", filename: "cover.png" }],
      queue: {
        jobs: [{ id: "job-keep", state: "published" }],
        variants: [],
        connections: [],
        targetPublications: [{ id: "publication-legacy", state: "published", simulation: true }],
      },
      safeMode: true,
      safeModePreference: { workspaceId: "workspace-a", safeMode: true },
    };
    const values = new Map<string, string>([
      [profileSnapshotKey("profile-a"), JSON.stringify(snapshot)],
      ["signalflow.safe-mode.preference.v1.workspace-a", "true"],
      ["signalflow.safe-mode.preference.v2.profile-a.workspace-a", "true"],
    ]);
    const { localStorage, removed } = storageWith(values);
    (globalThis as { window?: unknown }).window = { localStorage } as unknown as Window;

    const api = await import("./persistence");
    const restored = api.restoreSnapshot([], [] as string[], undefined, undefined, undefined, undefined, [], undefined, "profile-a");

    expect(restored.drafts).toEqual(snapshot.drafts);
    expect(restored.mediaAssets).toEqual(snapshot.mediaAssets);
    expect(restored.queue).toEqual(snapshot.queue);
    expect(restored).not.toHaveProperty("safeMode");
    expect(restored).not.toHaveProperty("safeModePreference");
    expect(removed.sort()).toEqual([
      "signalflow.safe-mode.preference.v1.workspace-a",
      "signalflow.safe-mode.preference.v2.profile-a.workspace-a",
    ]);
  });
});
