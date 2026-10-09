export type MediaAssetKind = "image" | "video" | "audio" | "thumbnail";
export type MediaAssetStatus = "local" | "uploading" | "ready" | "failed" | "expired";

export type MediaAsset = {
  id: string;
  workspaceId: string;
  kind: MediaAssetKind;
  filename: string;
  mimeType: string;
  bytes: number;
  checksum?: string;
  localPath?: string;
  publicUrl?: string;
  status: MediaAssetStatus;
  providerRefs?: Record<string, string>;
  createdAt: string;
  expiresAt?: string;
  error?: string;
};

export type AssetUploadRequest = {
  workspaceId: string;
  filename: string;
  mimeType: string;
  bytes: number;
  checksum?: string;
};

export type AssetUploadPlan = {
  assetId: string;
  uploadUrl: string;
  method: "PUT" | "POST";
  requiredHeaders: Record<string, string>;
  expiresAt: string;
};

export type AssetPreflightResult = {
  ok: boolean;
  reasons: string[];
  warnings: string[];
};

const PUBLIC_URL = /^https:\/\//i;

/** Render app-owned inspection media without treating the local path as publishable URL. */
export function localMediaPreviewUrl(localPath: string | undefined): string | undefined {
  if (!localPath || !localPath.startsWith("/")) return undefined;
  return encodeURI(`file://${localPath}`);
}

export function localMediaThumbnailUrl(localPath: string | undefined): string | undefined {
  if (!localPath) return undefined;
  if (localPath.startsWith("file://")) return encodeURI(`${localPath}.thumb.jpg`);
  return localMediaPreviewUrl(`${localPath}.thumb.jpg`);
}

export function normalizeGoogleDriveMediaUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.trim());
    if (url.hostname !== "drive.google.com") return null;
    const pathMatch = url.pathname.match(/^\/file\/d\/([^/]+)\/view$/);
    const fileId = pathMatch?.[1] ?? url.searchParams.get("id");
    if (!fileId || !/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return null;
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  } catch {
    return null;
  }
}

export function isNonPublicMediaHost(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local");
  } catch {
    return false;
  }
}

export function sanitizeLegacyMediaAsset<T extends { publicUrl?: string; status: string }>(
  asset: T,
  readyStatus: T["status"],
  nonReadyStatus: T["status"],
): T {
  if (!isNonPublicMediaHost(asset.publicUrl)) return asset;
  const sanitized = { ...asset };
  delete sanitized.publicUrl;
  sanitized.status = sanitized.status === readyStatus ? nonReadyStatus : sanitized.status;
  return sanitized;
}

export function preflightMediaAsset(asset: MediaAsset | undefined, requiredKind: MediaAssetKind): AssetPreflightResult {
  if (!asset) {
    return { ok: false, reasons: [`A ${requiredKind} asset is required before publishing.`], warnings: [] };
  }
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (asset.kind !== requiredKind) reasons.push(`Expected ${requiredKind} media but received ${asset.kind}.`);
  if (asset.status !== "ready") reasons.push(`Media asset is ${asset.status}; it must be ready before publishing.`);
  if (!asset.publicUrl || !PUBLIC_URL.test(asset.publicUrl) || isNonPublicMediaHost(asset.publicUrl)) reasons.push("A public HTTPS media URL is required before provider publishing.");
  if (asset.expiresAt && new Date(asset.expiresAt).getTime() <= Date.now()) reasons.push("Media asset URL has expired and must be refreshed.");
  if (asset.bytes > 100 * 1024 * 1024) warnings.push("Asset is larger than 100 MB; provider-specific size limits must be checked.");
  return { ok: reasons.length === 0, reasons, warnings };
}

export class LocalMediaAssetRegistry {
  private readonly assets = new Map<string, MediaAsset>();

  upsert(asset: MediaAsset): MediaAsset {
    this.assets.set(asset.id, asset);
    return asset;
  }

  get(assetId: string): MediaAsset | undefined {
    return this.assets.get(assetId);
  }

  list(workspaceId: string): MediaAsset[] {
    return [...this.assets.values()].filter((asset) => asset.workspaceId === workspaceId);
  }

  remove(assetId: string): void {
    this.assets.delete(assetId);
  }
}
