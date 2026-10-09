export type DriveAnalysisStatus = "verified_bytes" | "needs_review";
export type DriveDuplicateStatus = "unknown" | "exact" | "not_exact";
export type DrivePublicReachability = "not_applicable" | "needs_public_share" | "confirmed";
export type DriveVisualFingerprintSource = "decoded_image" | "decoded_video_frames" | null;
export interface DriveContentMediaManifest { manifestVersion: 1; clientId: string; brandId: string; platform: "facebook" | "instagram" | "tiktok" | "youtube"; date: string; contentRunId: string; filename: string; relativePath: string; directory?: string; providerFileId?: string; sha256?: string; visualFingerprint?: string; mediaKind?: "image" | "video"; }

export interface DriveLocalAnalysisResult {
  mimeType: string;
  bytes: number;
  sha256: string;
  modifiedAt: string;
  analysisStatus: DriveAnalysisStatus;
  visualFingerprint: string | null;
  visualFingerprintSource: DriveVisualFingerprintSource;
  duplicateStatus: DriveDuplicateStatus;
  publicReachability: "not_applicable";
}

export interface DriveDownloadResult {
  providerFileId: string;
  name: string;
  mimeType: string;
  localAssetPath: string;
  bytes: number;
  sha256: string;
  modifiedAt: string;
  analysisStatus: DriveAnalysisStatus;
  visualFingerprint: string | null;
  visualFingerprintSource: DriveVisualFingerprintSource;
  duplicateStatus: DriveDuplicateStatus;
  publicReachability: "not_applicable";
  manifest?: DriveContentMediaManifest;
}

export interface DriveUploadResult {
  providerFileId: string;
  name: string;
  shareUrl: string;
  normalizedUrl: string;
  publicUrlVerified: boolean;
  publicReachability: Exclude<DrivePublicReachability, "not_applicable">;
}

export interface DriveMakePublicResult {
  providerFileId: string;
  shareUrl: string;
  normalizedUrl: string;
  publicUrlVerified: true;
  publicReachability: "confirmed";
}

const DRIVE_ANALYSIS_KEYS = new Set(["mimeType", "bytes", "sha256", "modifiedAt", "analysisStatus", "visualFingerprint", "visualFingerprintSource", "duplicateStatus", "publicReachability"]);

export function driveLocalAnalysisResultSchema(value: unknown): value is DriveLocalAnalysisResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return Object.keys(result).every((key) => DRIVE_ANALYSIS_KEYS.has(key))
    && typeof result.mimeType === "string"
    && typeof result.bytes === "number"
    && Number.isSafeInteger(result.bytes)
    && result.bytes >= 0
    && typeof result.sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(result.sha256)
    && typeof result.modifiedAt === "string"
    && (result.analysisStatus === "verified_bytes" || result.analysisStatus === "needs_review")
    && (result.visualFingerprint === null || (typeof result.visualFingerprint === "string" && /^[a-f0-9]{16}$/i.test(result.visualFingerprint)))
    && (result.visualFingerprintSource === null || result.visualFingerprintSource === "decoded_image" || result.visualFingerprintSource === "decoded_video_frames")
    && (result.duplicateStatus === "unknown" || result.duplicateStatus === "exact" || result.duplicateStatus === "not_exact")
    && result.publicReachability === "not_applicable";
}

export function driveDownloadResultSchema(value: unknown): value is DriveDownloadResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.providerFileId === "string"
    && typeof result.name === "string"
    && typeof result.mimeType === "string"
    && typeof result.localAssetPath === "string"
    && typeof result.bytes === "number"
    && Number.isSafeInteger(result.bytes)
    && typeof result.sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(result.sha256)
    && typeof result.modifiedAt === "string"
    && (result.analysisStatus === "verified_bytes" || result.analysisStatus === "needs_review")
    && (result.visualFingerprint === null || (typeof result.visualFingerprint === "string" && /^[a-f0-9]{16}$/i.test(result.visualFingerprint)))
    && (result.visualFingerprintSource === null || result.visualFingerprintSource === "decoded_image" || result.visualFingerprintSource === "decoded_video_frames")
    && (result.duplicateStatus === "unknown" || result.duplicateStatus === "exact" || result.duplicateStatus === "not_exact")
    && result.publicReachability === "not_applicable"
    && !("publicUrl" in result);
}

export function driveUploadResultSchema(value: unknown): value is DriveUploadResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.providerFileId === "string"
    && typeof result.name === "string"
    && typeof result.shareUrl === "string"
    && /^https:\/\/drive\.google\.com\//i.test(result.shareUrl)
    && typeof result.normalizedUrl === "string"
    && /^https:\/\//i.test(result.normalizedUrl)
    && typeof result.publicUrlVerified === "boolean"
    && (result.publicReachability === "needs_public_share" || result.publicReachability === "confirmed")
    && (result.publicUrlVerified ? result.publicReachability === "confirmed" : true);
}
