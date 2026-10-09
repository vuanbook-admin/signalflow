import { describe, expect, it } from "vitest";
import { localMediaThumbnailUrl, normalizeGoogleDriveMediaUrl, preflightMediaAsset } from "./mediaAssets";
import { archiveMediaAsset, classifyDriveInventory, isMediaEligible } from "./automationDomain";

describe("media source boundaries", () => {
  it("keeps Drive inventory separate from app-owned local media", () => {
    const drive = classifyDriveInventory({ providerFileId: "drive-file-123", name: "cover.png", mimeType: "image/png", sizeBytes: 42, modifiedAt: "2026-08-29T00:00:00.000Z" });
    const local = { ...drive, id: "local-1", source: "local" as const, providerFileId: undefined, normalizedDriveFileId: undefined, localAssetPath: "/owned/media/cover.png" };
    expect(drive.source).toBe("drive");
    expect(local.source).toBe("local");
    expect(drive.providerFileId).toBeDefined();
    expect(local.localAssetPath).toContain("/owned/media/");
  });

  it("archives without deleting provider files and blocks unverified media", () => {
    const asset = classifyDriveInventory({ providerFileId: "drive-file-123", name: "cover.png", mimeType: "image/png", sizeBytes: 42, modifiedAt: "2026-08-29T00:00:00.000Z" });
    expect(isMediaEligible(asset)).toBe(false);
    expect(archiveMediaAsset(asset).archiveState).toBe("archived");
    expect(preflightMediaAsset(undefined, "image").ok).toBe(false);
  });

  it("normalizes only valid Drive file links", () => {
    expect(normalizeGoogleDriveMediaUrl("https://drive.google.com/file/d/abc123456789/view?usp=sharing")).toContain("id=abc123456789");
    expect(normalizeGoogleDriveMediaUrl("http://localhost/file.png")).toBeNull();
  });

  it("derives a thumbnail URL from an app-owned file preview URL", () => {
    expect(localMediaThumbnailUrl("file:///owned/media/video.mp4")).toBe("file:///owned/media/video.mp4.thumb.jpg");
  });
});
