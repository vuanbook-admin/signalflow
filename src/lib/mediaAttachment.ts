import type { MediaAttachment, MediaAttachmentEvidence } from "./mvpContracts";

type VerifiedMediaAttachment = MediaAttachment & { sha256: string };

export type MediaAttachmentValidation = { ok: true; attachments: VerifiedMediaAttachment[] } | { ok: false; code: "MEDIA_ATTACHMENT_MISSING" | "MEDIA_ATTACHMENT_PATH_MISSING" | "MEDIA_ATTACHMENT_HASH_MISSING" | "MEDIA_ATTACHMENT_TYPE_UNSUPPORTED" | "MEDIA_ATTACHMENT_DUPLICATE" | "MEDIA_ATTACHMENT_LIMIT_EXCEEDED" | "MEDIA_ATTACHMENT_ORDER_INVALID" | "MEDIA_ATTACHMENT_ROLE_ORDER_INVALID" | "MEDIA_ATTACHMENT_PROVIDER_UNSUPPORTED" | "VIDEO_ATTACHMENT_UNSUPPORTED"; assetId?: string };

export function validateMediaAttachments(attachments: readonly MediaAttachment[], provider: "gemini_web" | "chatgpt_web" | "api"): MediaAttachmentValidation {
  if (!attachments.length) return { ok: false, code: "MEDIA_ATTACHMENT_MISSING" };
  if (attachments.length > 6) return { ok: false, code: "MEDIA_ATTACHMENT_LIMIT_EXCEEDED" };
  const ordered = [...attachments].sort((left, right) => left.order - right.order);
  const seen = new Set<string>();
  const normalized: VerifiedMediaAttachment[] = [];
  for (const [index, attachment] of ordered.entries()) {
    if (!attachment.assetId?.trim() || seen.has(attachment.assetId)) return { ok: false, code: "MEDIA_ATTACHMENT_DUPLICATE", assetId: attachment.assetId };
    seen.add(attachment.assetId);
    if (!attachment.localAssetPath?.trim()) return { ok: false, code: "MEDIA_ATTACHMENT_PATH_MISSING", assetId: attachment.assetId };
    const mimeType = attachment.mimeType?.trim().toLowerCase();
    if (!mimeType || !/^(image|video)\/[a-z0-9.+-]+$/.test(mimeType)) return { ok: false, code: "MEDIA_ATTACHMENT_TYPE_UNSUPPORTED", assetId: attachment.assetId };
    if (mimeType.startsWith("video/")) return { ok: false, code: "VIDEO_ATTACHMENT_UNSUPPORTED", assetId: attachment.assetId };
    const sha256 = attachment.sha256?.replace(/^sha256:/i, "").toLowerCase();
    if (!sha256) return { ok: false, code: "MEDIA_ATTACHMENT_HASH_MISSING", assetId: attachment.assetId };
    if (!/^[a-f0-9]{64}$/.test(sha256)) return { ok: false, code: "MEDIA_ATTACHMENT_TYPE_UNSUPPORTED", assetId: attachment.assetId };
    if (!Number.isInteger(attachment.order) || attachment.order !== index) return { ok: false, code: "MEDIA_ATTACHMENT_ORDER_INVALID", assetId: attachment.assetId };
    if (attachment.role !== (index === 0 ? "publish" : "reference")) return { ok: false, code: "MEDIA_ATTACHMENT_ROLE_ORDER_INVALID", assetId: attachment.assetId };
    normalized.push({ ...attachment, mimeType, sha256 });
  }
  if (provider === "api") return { ok: false, code: "MEDIA_ATTACHMENT_PROVIDER_UNSUPPORTED" };
  return { ok: true, attachments: normalized };
}

export function getMediaAttachmentRequestId(requested: unknown): string {
  if (requested === undefined) return globalThis.crypto.randomUUID();
  if (typeof requested !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requested)) throw new Error("MEDIA_ATTACHMENT_REQUEST_ID_INVALID");
  return requested;
}

export async function fingerprintMediaSet(attachments: readonly MediaAttachment[]): Promise<string> {
  const validation = validateMediaAttachments(attachments, "gemini_web");
  if (!validation.ok) throw new Error(validation.code);
  const canonical = validation.attachments.map(({ assetId, sha256, mimeType, order, role }) => ({ assetId, sha256, mimeType, order, role }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function matchProcessedMediaEvidence(attachments: readonly VerifiedMediaAttachment[], evidence: unknown): MediaAttachmentEvidence[] | undefined {
  if (!Array.isArray(evidence) || evidence.length !== attachments.length) return undefined;
  const processed: MediaAttachmentEvidence[] = [];
  for (const [index, value] of evidence.entries()) {
    const expected = attachments[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const item = value as Record<string, unknown>;
    const sha256 = typeof item.sha256 === "string" ? item.sha256.replace(/^sha256:/i, "").toLowerCase() : "";
    if (item.assetId !== expected.assetId || sha256 !== expected.sha256?.replace(/^sha256:/i, "").toLowerCase()
      || typeof item.mimeType !== "string" || item.mimeType.trim().toLowerCase() !== expected.mimeType.trim().toLowerCase()
      || item.order !== expected.order || item.role !== expected.role || item.uploadState !== "processed") return undefined;
    processed.push({ assetId: expected.assetId, sha256, mimeType: expected.mimeType, order: expected.order, role: expected.role, uploadState: "processed" });
  }
  return processed;
}
