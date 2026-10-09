import { describe, expect, it } from "vitest";
import {
  COMPOSER_MEDIA_LIMIT,
  moveComposerMediaSelection,
  setComposerMediaRole,
  toggleComposerMediaSelection,
} from "./mediaSelection";

describe("composer media selection", () => {
  it("keeps selection order and assigns the first image as publish", () => {
    let manifest = toggleComposerMediaSelection([], "asset-a").manifest;
    manifest = toggleComposerMediaSelection(manifest, "asset-b").manifest;

    expect(manifest).toEqual([
      { assetId: "asset-a", order: 0, role: "publish" },
      { assetId: "asset-b", order: 1, role: "reference" },
    ]);
  });

  it("moves the chosen publish image first and transfers its role", () => {
    let manifest = toggleComposerMediaSelection([], "asset-a").manifest;
    manifest = toggleComposerMediaSelection(manifest, "asset-b").manifest;

    expect(setComposerMediaRole(manifest, "asset-b", "publish")).toEqual([
      { assetId: "asset-b", order: 0, role: "publish" },
      { assetId: "asset-a", order: 1, role: "reference" },
    ]);
  });

  it("reorders images while keeping publish on the first image", () => {
    let manifest = toggleComposerMediaSelection([], "asset-a").manifest;
    manifest = toggleComposerMediaSelection(manifest, "asset-b").manifest;
    manifest = toggleComposerMediaSelection(manifest, "asset-c").manifest;

    expect(moveComposerMediaSelection(manifest, "asset-c", -1)).toEqual([
      { assetId: "asset-a", order: 0, role: "publish" },
      { assetId: "asset-c", order: 1, role: "reference" },
      { assetId: "asset-b", order: 2, role: "reference" },
    ]);
  });

  it("does not add a seventh image", () => {
    let manifest = [] as ReturnType<typeof toggleComposerMediaSelection>["manifest"];
    for (let index = 0; index < COMPOSER_MEDIA_LIMIT; index += 1) {
      manifest = toggleComposerMediaSelection(manifest, `asset-${index}`).manifest;
    }

    const result = toggleComposerMediaSelection(manifest, "asset-over-limit");

    expect(result.manifest).toEqual(manifest);
    expect(result.limitReached).toBe(true);
    expect(result.manifest).toHaveLength(6);
  });
});
