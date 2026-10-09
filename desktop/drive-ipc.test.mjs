import { describe, expect, it } from "vitest";
import { validateCommandArgs } from "./security.cjs";

describe("Drive IPC validation", () => {
  it("allows the managed Electron Drive window command without accepting credentials", () => {
    expect(validateCommandArgs("drive_web_open", {})).toEqual({});
  });

  it("accepts validated download metadata, local analysis metadata, and upload paths for native handling", () => {
    expect(validateCommandArgs("drive_download_asset", { workspaceId: "brand-1", providerFileId: "1AbC_-x", filename: "cover.png", mimeType: "image/png", modifiedAt: "2026-08-23T00:00:00.000Z" })).toMatchObject({ providerFileId: "1AbC_-x", filename: "cover.png" });
    expect(validateCommandArgs("drive_download_asset", { workspaceId: "brand-1", providerFileId: "1AbC_-x", filename: "clip.mp4", publicReachabilityConfirmed: true })).toMatchObject({ publicReachabilityConfirmed: true });
    expect(validateCommandArgs("drive_analyze_local_asset", { localAssetPath: "/owned/media/cover.png", mimeType: "image/png", modifiedAt: "2026-08-23T00:00:00.000Z" })).toMatchObject({ localAssetPath: "/owned/media/cover.png", mimeType: "image/png" });
    expect(validateCommandArgs("drive_upload_asset", { workspaceId: "brand-1", localAssetPath: "/owned/media/cover.png", filename: "cover.png" })).toMatchObject({ filename: "cover.png" });
    expect(validateCommandArgs("drive_make_public", { workspaceId: "brand-1", providerFileId: "1AbC_-x" })).toEqual({ workspaceId: "brand-1", providerFileId: "1AbC_-x" });
  });

  it("rejects traversal, secret-shaped, and invalid metadata before native execution", () => {
    expect(() => validateCommandArgs("drive_download_asset", { workspaceId: "brand-1", providerFileId: "../token", filename: "cover.png" })).toThrow("ELECTRON_ARG_INVALID:providerFileId");
    expect(() => validateCommandArgs("drive_download_asset", { workspaceId: "brand-1", providerFileId: "1AbC", filename: "../cover.png" })).toThrow("ELECTRON_ARG_INVALID:filename");
    expect(() => validateCommandArgs("drive_upload_asset", { workspaceId: "brand-1", localAssetPath: "/owned/.env", filename: "cover.png" })).toThrow("ELECTRON_ARG_INVALID:localAssetPath");
    expect(() => validateCommandArgs("drive_analyze_local_asset", { localAssetPath: "../outside.png", mimeType: "image/png" })).toThrow("ELECTRON_ARG_INVALID:localAssetPath");
    expect(() => validateCommandArgs("drive_analyze_local_asset", { localAssetPath: "/owned/session-token.png", mimeType: "image/png" })).toThrow("ELECTRON_ARG_INVALID:localAssetPath");
    expect(() => validateCommandArgs("drive_analyze_local_asset", { localAssetPath: "/owned/image.png", mimeType: "not-a-mime" })).toThrow("ELECTRON_ARG_INVALID:mimeType");
    expect(() => validateCommandArgs("drive_download_asset", { workspaceId: "brand/../secret", providerFileId: "1AbC", filename: "cover.png" })).toThrow("ELECTRON_ARG_INVALID:workspaceId");
    expect(() => validateCommandArgs("drive_download_asset", { workspaceId: "brand-1", providerFileId: "1AbC", filename: "cover.png", mimeType: "not-a-mime" })).toThrow("ELECTRON_ARG_INVALID:mimeType");
    expect(() => validateCommandArgs("drive_download_asset", { workspaceId: "brand-1", providerFileId: "1AbC", filename: "clip.mp4", publicReachabilityConfirmed: "yes" })).toThrow("ELECTRON_ARG_INVALID:publicReachabilityConfirmed");
  });
});
