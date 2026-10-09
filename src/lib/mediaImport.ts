export const MAX_LOCAL_IMAGE_BYTES = 20 * 1024 * 1024;
const LOCAL_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type LocalImageImport = { assetId: string; name: string; localAssetPath: string; mimeType: "image/png" | "image/jpeg" | "image/webp"; sha256: string; sizeBytes: number; clientId: string; brandId: string };

export function safeLocalImageFileName(name: string, mimeType: string): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const basename = name.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
  const stem = basename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 160) || "image";
  return `${stem}.${extension}`;
}

export function validateLocalImageFile(file: Pick<File, "type" | "size">): string | undefined {
  if (!LOCAL_IMAGE_MIME_TYPES.has(file.type.toLowerCase())) return "LOCAL_MEDIA_TYPE_UNSUPPORTED";
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return "LOCAL_MEDIA_EMPTY";
  if (file.size > MAX_LOCAL_IMAGE_BYTES) return "LOCAL_MEDIA_TOO_LARGE";
  return undefined;
}

export async function encodeLocalImageFile(file: Pick<File, "arrayBuffer">): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function parseLocalImageImport(value: unknown, clientId: string, brandId: string): LocalImageImport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = value as Record<string, unknown>;
  const { assetId, name, localAssetPath, mimeType, sha256, sizeBytes } = result;
  if (result.clientId !== clientId || result.brandId !== brandId || typeof assetId !== "string" || !assetId.trim() || typeof name !== "string" || !name.trim() || typeof localAssetPath !== "string" || !localAssetPath.trim()) return undefined;
  if (typeof mimeType !== "string" || !LOCAL_IMAGE_MIME_TYPES.has(mimeType.toLowerCase()) || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(sha256)) return undefined;
  if (!Number.isSafeInteger(sizeBytes) || Number(sizeBytes) <= 0 || Number(sizeBytes) > MAX_LOCAL_IMAGE_BYTES) return undefined;
  return { assetId, name, localAssetPath, mimeType: mimeType.toLowerCase() as LocalImageImport["mimeType"], sha256: sha256.toLowerCase(), sizeBytes: Number(sizeBytes), clientId, brandId };
}
