import { describe, expect, it } from "vitest";
import { driveDownloadResultSchema, driveLocalAnalysisResultSchema, driveUploadResultSchema, type DriveDownloadResult, type DriveLocalAnalysisResult, type DriveUploadResult } from "./driveMediaContracts";

describe("Drive media domain contracts", () => {
  it("models truthful download status without public reachability claims", () => {
    const result: DriveDownloadResult = {
      providerFileId: "file-123",
      name: "cover.png",
      mimeType: "image/png",
      localAssetPath: "/owned/userData/media/workspace-1/cover.png",
      bytes: 42,
      sha256: "a".repeat(64),
      modifiedAt: "2026-08-23T00:00:00.000Z",
      analysisStatus: "needs_review",
      visualFingerprint: null,
      visualFingerprintSource: null,
      duplicateStatus: "unknown",
      publicReachability: "not_applicable",
    };
    expect(driveDownloadResultSchema(result)).toBe(true);
    expect(driveDownloadResultSchema({ ...result, visualFingerprint: "0123456789abcdef", visualFingerprintSource: "decoded_video_frames" })).toBe(true);
    expect(driveDownloadResultSchema({ ...result, visualFingerprint: "not-a-fingerprint", visualFingerprintSource: "decoded_video_frames" })).toBe(false);
    expect(driveDownloadResultSchema({ ...result, visualFingerprintSource: "filename_hash" })).toBe(false);
    expect("publicUrl" in result).toBe(false);
  });

  it("validates scalar-only local analysis metadata and rejects URL/path leakage", () => {
    const result: DriveLocalAnalysisResult = {
      mimeType: "image/png",
      bytes: 42,
      sha256: "a".repeat(64),
      modifiedAt: "2026-08-23T00:00:00.000Z",
      analysisStatus: "verified_bytes",
      visualFingerprint: "0123456789abcdef",
      visualFingerprintSource: "decoded_image",
      duplicateStatus: "unknown",
      publicReachability: "not_applicable",
    };
    expect(driveLocalAnalysisResultSchema(result)).toBe(true);
    expect(driveLocalAnalysisResultSchema({ ...result, visualFingerprint: null, analysisStatus: "needs_review" })).toBe(true);
    expect(driveLocalAnalysisResultSchema({ ...result, localAssetPath: "/owned/media/image.png" })).toBe(false);
    expect(driveLocalAnalysisResultSchema({ ...result, normalizedUrl: "https://drive.google.com/file/d/id/view" })).toBe(false);
    expect(driveLocalAnalysisResultSchema({ ...result, visualFingerprint: "not-a-64-bit-hash" })).toBe(false);
  });

  it("requires upload public confirmation before marking publicUrlVerified", () => {
    const pending: DriveUploadResult = {
      providerFileId: "file-123",
      name: "cover.png",
      shareUrl: "https://drive.google.com/file/d/file-123/view",
      normalizedUrl: "https://drive.google.com/uc?export=download&id=file-123",
      publicUrlVerified: false,
      publicReachability: "needs_public_share",
    };
    expect(driveUploadResultSchema(pending)).toBe(true);
    expect(driveUploadResultSchema({ ...pending, publicUrlVerified: true, publicReachability: "confirmed" })).toBe(true);
  });
});
