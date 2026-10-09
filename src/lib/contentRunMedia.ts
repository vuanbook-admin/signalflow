import type { ContentKind, MediaAttachment } from "./mvpContracts";
import { fingerprintMediaSet, matchProcessedMediaEvidence, validateMediaAttachments } from "./mediaAttachment";
import type { ContentRunMediaEvidence } from "./contentRun";

export type ComposerMediaItem = { assetId: string | number; order: number; role: "publish" | "reference" };
export type ComposerMediaAsset = { id: string | number; clientId?: string; brandId?: string | null; distribution?: "universal" | string; shared?: boolean; sharedBrandIds?: string[]; kind: string; localAssetPath?: string; mimeType?: string; checksum?: string; archiveState?: "active" | "archived" };
export type PreparedContentRunMedia = { ok: true; attachments: MediaAttachment[]; contentKind: ContentKind; mediaSetFingerprint?: string; pendingEvidence: ContentRunMediaEvidence[] } | { ok: false; code: string };

export type ContentRunMediaOwnershipAsset = ComposerMediaAsset & {
  source?: string;
  providerFileId?: string;
  normalizedUrl?: string;
  publicUrlVerified?: boolean;
  reviewStatus?: string;
  rightsState?: string;
  duplicateStatus?: string;
  usageStatus?: string;
  status?: string;
  sizeBytes?: number;
  sha256?: string;
  provenance?: { source?: string; providerFileId?: string };
};

export type ContentRunMediaOwnershipTransport = {
  listMediaAssets: (scope: { clientId: string; brandId: string }) => Promise<readonly Record<string, unknown>[]>;
  createMediaAsset: (payload: Record<string, unknown>) => Promise<unknown>;
  compensateMediaAsset?: (assetId: string, receipt: MediaAssetCompensationRequest) => Promise<MediaAssetCompensationResult>;
};

export type MediaAssetCompensationRequest = { clientId: string; brandId: string; ownershipReceiptId: string; sha256: string; mimeType: string };
export type MediaAssetCompensationResult = { assetId: string; status: "deleted" | "absent" | "retained"; reason?: string };
export type ContentRunCreateReconciliation = { id: string; outcome: "committed" | "unknown" };

export type ContentRunMediaOwnershipInput = {
  attachments: readonly MediaAttachment[];
  assets: readonly ContentRunMediaOwnershipAsset[];
  scope: { clientId: string; brandId: string };
  transport: ContentRunMediaOwnershipTransport;
};

export type ContentRunMediaRollback = {
  attemptedAssetIds: string[];
  remainingAssetIds: string[] | null;
  verified: boolean;
  failures: Array<{ assetId?: string; code: string }>;
};

export type MediaOwnershipReconciliationState = { code: "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED"; rollback: ContentRunMediaRollback; contentRun?: ContentRunCreateReconciliation };

export class MediaOwnershipReconciliationError extends Error {
  readonly code = "MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED";
  get reconciliation(): MediaOwnershipReconciliationState { return structuredClone({ code: this.code, rollback: this.rollback, ...(this.contentRun ? { contentRun: this.contentRun } : {}) }); }
  constructor(readonly rollback: ContentRunMediaRollback, readonly originalError?: unknown, readonly contentRun?: ContentRunCreateReconciliation) {
    super(`MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED: ${contentRun ? `Content Run ${contentRun.id} ${contentRun.outcome}; ` : ""}${rollback.verified ? `remaining media: ${rollback.remainingAssetIds!.join(", ") || "none"}` : "remaining media could not be verified"}`);
  }
}

export type ContentRunMediaOwnershipReceipt = {
  createdAssetIds: readonly string[];
  readonly state: "pending" | "committed" | "rolled_back" | "reconciliation_required";
  commit: () => void;
  rollback: (originalError?: unknown) => Promise<ContentRunMediaRollback>;
  retain: (originalError: unknown, contentRun: ContentRunCreateReconciliation) => Promise<never>;
};

/** Keep the receipt open until Content Run creation is acknowledged by the CP. */
export async function createContentRunWithMediaOwnership<T>(input: ContentRunMediaOwnershipInput | undefined, create: () => Promise<T>, reconciliation?: { runId: string; getContentRun?: (id: string) => Promise<Record<string, unknown> | undefined> }): Promise<T> {
  const receipt = input ? await ensureContentRunMediaOwnership(input) : undefined;
  try {
    const ack = await create();
    if (receipt && reconciliation) {
      const row = ack && typeof ack === "object" ? ack as Record<string, unknown> : undefined;
      if (row?.id !== reconciliation.runId || row.clientId !== input?.scope.clientId || row.brandId !== input?.scope.brandId) throw new Error("CONTENT_RUN_CREATE_ACK_INVALID");
    }
    receipt?.commit();
    return ack;
  } catch (error) {
    if (receipt && input) {
      // Only an explicit CP pre-commit rejection authorizes compensation. A timeout/404 cannot prove absence.
      if (error && typeof error === "object" && "createOutcome" in error && error.createOutcome === "rejected") {
        await receipt.rollback(error);
      } else {
        let outcome: ContentRunCreateReconciliation["outcome"] = "unknown";
        try {
          const run = reconciliation?.getContentRun ? await reconciliation.getContentRun(reconciliation.runId) : undefined;
          if (run?.id === reconciliation?.runId && run?.clientId === input.scope.clientId && run?.brandId === input.scope.brandId) outcome = "committed";
        } catch { /* An unavailable readback leaves the create outcome unknown. */ }
        await receipt.retain(error, { id: reconciliation?.runId ?? "unknown", outcome });
      }
    }
    throw error;
  }
}

function isUniversalMediaAsset(asset: ComposerMediaAsset, brandId: string): boolean {
  return asset.brandId === null || asset.distribution === "universal" || asset.shared === true || asset.sharedBrandIds?.includes(brandId) === true;
}

export async function prepareContentRunMedia(manifest: readonly ComposerMediaItem[], assets: readonly ComposerMediaAsset[], scope: { clientId: string; brandId: string }): Promise<PreparedContentRunMedia> {
  if (!manifest.length) return { ok: true, attachments: [], contentKind: "text", pendingEvidence: [] };
  const attachments: MediaAttachment[] = [];
  for (const item of manifest) {
    const asset = assets.find((candidate) => String(candidate.id) === String(item.assetId));
    if (!asset || asset.clientId !== scope.clientId || asset.brandId !== scope.brandId && !isUniversalMediaAsset(asset, scope.brandId)) return { ok: false, code: "MEDIA_ATTACHMENT_SCOPE_MISMATCH" };
    if (asset.archiveState === "archived") return { ok: false, code: "MEDIA_ATTACHMENT_ARCHIVED" };
    if (asset.kind === "Video") return { ok: false, code: "VIDEO_ATTACHMENT_UNSUPPORTED" };
    if (asset.kind !== "Image") return { ok: false, code: "MEDIA_ATTACHMENT_TYPE_UNSUPPORTED" };
    const mimeType = asset.mimeType?.trim().toLowerCase();
    if (!mimeType || !["image/png", "image/jpeg", "image/webp"].includes(mimeType)) return { ok: false, code: "MEDIA_ATTACHMENT_TYPE_UNSUPPORTED" };
    attachments.push({ assetId: String(asset.id), localAssetPath: asset.localAssetPath ?? "", mimeType, sha256: asset.checksum?.replace(/^sha256:/i, ""), order: item.order, role: item.role });
  }
  const validation = validateMediaAttachments(attachments, "gemini_web");
  if (!validation.ok) return { ok: false, code: validation.code };
  const publishImage = validation.attachments.find((attachment) => attachment.role === "publish");
  if (!publishImage) return { ok: false, code: "MEDIA_ATTACHMENT_ROLE_ORDER_INVALID" };
  const publishAsset = assets.find((asset) => String(asset.id) === publishImage.assetId);
  if (!publishAsset || publishAsset.kind !== "Image") return { ok: false, code: "MEDIA_ATTACHMENT_TYPE_UNSUPPORTED" };
  return {
    ok: true,
    attachments: validation.attachments,
    contentKind: publishAsset.kind === "Image" ? "image" : "text",
    mediaSetFingerprint: await fingerprintMediaSet(validation.attachments),
    pendingEvidence: validation.attachments.map(({ assetId, sha256, mimeType, order, role }) => ({ assetId, sha256: sha256!, mimeType, order, role, uploadState: "pending" })),
  };
}

export function validateMediaAssetProof(attachments: readonly MediaAttachment[], records: readonly Record<string, unknown>[], scope: { clientId: string; brandId: string }): { ok: true } | { ok: false; code: string } {
  for (const attachment of attachments) {
    const record = records.find((item) => item.id === attachment.assetId);
    if (!record) return { ok: false, code: "MEDIA_ATTACHMENT_CONTROL_PLANE_ASSET_MISSING" };
    const recordMetadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata) ? record.metadata as Record<string, unknown> : record;
    const recordIsUniversal = record.brandId === null || recordMetadata.distribution === "universal" || recordMetadata.shared === true || Array.isArray(recordMetadata.sharedBrandIds) && recordMetadata.sharedBrandIds.includes(scope.brandId);
    if (record.clientId !== scope.clientId || record.brandId !== scope.brandId && !recordIsUniversal) return { ok: false, code: "MEDIA_ATTACHMENT_SCOPE_MISMATCH" };
    if (recordMetadata.archiveState === "archived" || record.archiveState === "archived") return { ok: false, code: "MEDIA_ATTACHMENT_ARCHIVED" };
    const sha256 = typeof recordMetadata.sha256 === "string" ? recordMetadata.sha256.replace(/^sha256:/i, "").toLowerCase() : "";
    const mimeType = typeof recordMetadata.mimeType === "string" ? recordMetadata.mimeType.trim().toLowerCase() : "";
    if (sha256 !== attachment.sha256?.replace(/^sha256:/i, "").toLowerCase() || mimeType !== attachment.mimeType.toLowerCase()) return { ok: false, code: "MEDIA_ATTACHMENT_CONTROL_PLANE_EVIDENCE_MISMATCH" };
  }
  return { ok: true };
}

const SHA256 = /^[a-f0-9]{64}$/i;
const HTTPS = /^https:\/\//i;

function normalizedAssetSha(asset: ContentRunMediaOwnershipAsset): string {
  return (asset.sha256 ?? asset.checksum ?? "").replace(/^sha256:/i, "").trim().toLowerCase();
}

/** Preflight every selected asset, then register missing ownership with a reversible receipt. */
export async function ensureContentRunMediaOwnership(input: ContentRunMediaOwnershipInput): Promise<ContentRunMediaOwnershipReceipt> {
  const createdAssetIds: string[] = [];
  const submittedAssetIds: string[] = [];
  const ownershipReceiptId = globalThis.crypto.randomUUID();
  const confirmedCompensatedAssetIds = new Set<string>();
  let state: ContentRunMediaOwnershipReceipt["state"] = "pending";
  let rollbackResult: ContentRunMediaRollback | undefined;
  let retainedRun: ContentRunCreateReconciliation | undefined;
  const receipt: ContentRunMediaOwnershipReceipt = {
    createdAssetIds,
    get state() { return state; },
    commit: () => {
      if (state !== "pending") throw new Error("MEDIA_OWNERSHIP_RECEIPT_SETTLED");
      state = "committed";
    },
    retain: async (originalError, contentRun) => {
      retainedRun = contentRun;
      state = "reconciliation_required";
      const result: ContentRunMediaRollback = { attemptedAssetIds: [], remainingAssetIds: null, verified: false, failures: [{ code: "CONTENT_RUN_CREATE_OUTCOME_RECONCILIATION_REQUIRED" }] };
      try {
        const observed = await input.transport.listMediaAssets(input.scope);
        result.remainingAssetIds = input.attachments.filter(({ assetId }) => observed.some((row) => row.id === assetId)).map(({ assetId }) => assetId);
        result.verified = true;
      } catch { result.failures.push({ code: "MEDIA_OWNERSHIP_ROLLBACK_VERIFICATION_FAILED" }); }
      rollbackResult = result;
      throw new MediaOwnershipReconciliationError(result, originalError, contentRun);
    },
    rollback: async (originalError) => {
      if (state === "committed") throw new Error("MEDIA_OWNERSHIP_ALREADY_COMMITTED");
      if (state === "rolled_back") return rollbackResult!;
      if (retainedRun) throw new MediaOwnershipReconciliationError(rollbackResult!, originalError, retainedRun);
      const result: ContentRunMediaRollback = { attemptedAssetIds: [], remainingAssetIds: null, verified: false, failures: [] };
      // A rejected create can still have committed. Only delete uncertain rows bearing this receipt.
      if (submittedAssetIds.some((id) => !createdAssetIds.includes(id))) {
        try {
          const observed = await input.transport.listMediaAssets(input.scope);
          for (const row of observed) {
            const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : row;
            const id = String(row.id);
            if (submittedAssetIds.includes(id) && !createdAssetIds.includes(id) && metadata.ownershipReceiptId === ownershipReceiptId) createdAssetIds.push(id);
          }
        } catch { result.failures.push({ code: "MEDIA_OWNERSHIP_CREATE_OUTCOME_UNKNOWN" }); }
      }
      const retainedAssetIds: string[] = [];
      for (const assetId of [...createdAssetIds].reverse().filter((id) => !confirmedCompensatedAssetIds.has(id))) {
        result.attemptedAssetIds.push(assetId);
        try {
          if (!input.transport.compensateMediaAsset) throw new Error("MEDIA_OWNERSHIP_ROLLBACK_UNAVAILABLE");
          const attachment = input.attachments.find((item) => item.assetId === assetId)!;
          const ack = await input.transport.compensateMediaAsset(assetId, { ...input.scope, ownershipReceiptId, sha256: attachment.sha256!.replace(/^sha256:/i, "").trim().toLowerCase(), mimeType: attachment.mimeType.trim().toLowerCase() });
          if (!ack || ack.assetId !== assetId || !["deleted", "absent", "retained"].includes(ack.status)) throw new Error("MEDIA_OWNERSHIP_COMPENSATION_ACK_INVALID");
          if (ack.status === "retained") {
            retainedAssetIds.push(assetId);
            result.failures.push({ assetId, code: ack.reason ?? "MEDIA_OWNERSHIP_ADOPTED" });
          } else confirmedCompensatedAssetIds.add(assetId);
        } catch { result.failures.push({ assetId, code: "MEDIA_OWNERSHIP_DELETE_FAILED" }); }
      }
      try {
        const observed = await input.transport.listMediaAssets(input.scope);
        result.remainingAssetIds = submittedAssetIds.filter((id) => retainedAssetIds.includes(id) || observed.some((row) => row.id === id));
        result.verified = true;
        for (const id of result.remainingAssetIds) confirmedCompensatedAssetIds.delete(id);
        if (createdAssetIds.some((id) => !confirmedCompensatedAssetIds.has(id) && !result.remainingAssetIds!.includes(id))) {
          result.verified = false;
          result.remainingAssetIds = null;
          result.failures.push({ code: "MEDIA_OWNERSHIP_COMPENSATION_OUTCOME_UNKNOWN" });
        }
      } catch { result.failures.push({ code: "MEDIA_OWNERSHIP_ROLLBACK_VERIFICATION_FAILED" }); }
      if (submittedAssetIds.some((id) => !createdAssetIds.includes(id))) {
        result.failures.push({ code: "MEDIA_OWNERSHIP_CREATE_OUTCOME_UNKNOWN" });
        result.verified = false;
        result.remainingAssetIds = null;
      }
      rollbackResult = result;
      if (!result.verified || result.remainingAssetIds!.length || result.failures.length) {
        state = "reconciliation_required";
        throw new MediaOwnershipReconciliationError(result, originalError);
      }
      state = "rolled_back";
      return result;
    },
  };
  if (!input.attachments.length) return receipt;
  if (input.attachments.length > 6) throw new Error("MEDIA_ATTACHMENT_LIMIT_EXCEEDED");
  const ordered = [...input.attachments].sort((left, right) => left.order - right.order);
  const seen = new Set<string>();
  for (const [index, attachment] of ordered.entries()) {
    if (!attachment.assetId?.trim() || seen.has(attachment.assetId)) throw new Error("MEDIA_ATTACHMENT_DUPLICATE");
    seen.add(attachment.assetId);
    if (!attachment.localAssetPath.trim()) throw new Error("MEDIA_ATTACHMENT_LOCAL_PATH_REQUIRED");
    if (!/^(?:image|video)\/[a-z0-9.+-]+$/i.test(attachment.mimeType.trim())) throw new Error("MEDIA_ATTACHMENT_TYPE_UNSUPPORTED");
    if (!attachment.sha256 || !SHA256.test(attachment.sha256.replace(/^sha256:/i, "").trim())) throw new Error("MEDIA_ATTACHMENT_HASH_MISSING");
    if (!Number.isInteger(attachment.order) || attachment.order !== index) throw new Error("MEDIA_ATTACHMENT_ORDER_INVALID");
    if (attachment.role !== (index === 0 ? "publish" : "reference")) throw new Error("MEDIA_ATTACHMENT_ROLE_ORDER_INVALID");
  }
  let records = [...await input.transport.listMediaAssets(input.scope)];
  const pending: Array<{ attachment: MediaAttachment; payload: Record<string, unknown> }> = [];
  for (const attachment of ordered) {
    const currentProof = validateMediaAssetProof([attachment], records, input.scope);
    if (currentProof.ok) continue;
    if (currentProof.code !== "MEDIA_ATTACHMENT_CONTROL_PLANE_ASSET_MISSING") throw new Error(currentProof.code);
    const asset = input.assets.find((candidate) => String(candidate.id) === attachment.assetId);
    if (!asset || asset.clientId !== input.scope.clientId || asset.brandId !== input.scope.brandId && asset.brandId !== null && asset.distribution !== "universal" && asset.shared !== true && !asset.sharedBrandIds?.includes(input.scope.brandId)) throw new Error("MEDIA_ATTACHMENT_SCOPE_MISMATCH");
    if (asset.archiveState === "archived" || asset.status === "archived") throw new Error("MEDIA_ATTACHMENT_ARCHIVED");
    if (asset.reviewStatus === "rejected" || asset.rightsState !== undefined && !["user_owned", "licensed"].includes(asset.rightsState)) throw new Error("MEDIA_ATTACHMENT_RIGHTS_INVALID");
    if (asset.duplicateStatus === "duplicate" || asset.usageStatus === "used" || asset.usageStatus === "reserved") throw new Error("MEDIA_ATTACHMENT_NOT_ELIGIBLE");
    const assetSha = normalizedAssetSha(asset);
    const attachmentSha = (attachment.sha256 ?? "").replace(/^sha256:/i, "").trim().toLowerCase();
    if (!SHA256.test(attachmentSha) || assetSha && assetSha !== attachmentSha) throw new Error("MEDIA_ATTACHMENT_CONTROL_PLANE_EVIDENCE_MISMATCH");
    const assetMime = asset.mimeType?.trim().toLowerCase() ?? "";
    if (!assetMime || assetMime !== attachment.mimeType.trim().toLowerCase()) throw new Error("MEDIA_ATTACHMENT_CONTROL_PLANE_EVIDENCE_MISMATCH");
    const expectedKind = attachment.mimeType.toLowerCase().startsWith("video/") ? "video" : "image";
    if (String(asset.kind).toLowerCase() !== expectedKind) throw new Error("MEDIA_ATTACHMENT_TYPE_UNSUPPORTED");
    const source = String(asset.source ?? asset.provenance?.source ?? "local").toLowerCase();
    const externallyHosted = source === "drive" || source === "google_drive" || source === "public_https" || Boolean(asset.providerFileId || asset.provenance?.providerFileId);
    if (externallyHosted && asset.reviewStatus !== "verified") throw new Error("MEDIA_ATTACHMENT_REVIEW_REQUIRED");
    if (externallyHosted && (asset.publicUrlVerified !== true || !asset.normalizedUrl || !HTTPS.test(asset.normalizedUrl))) throw new Error("MEDIA_ATTACHMENT_PUBLIC_URL_REQUIRED");
    const metadata = {
      source,
      ownershipReceiptId,
      providerFileId: asset.providerFileId ?? asset.provenance?.providerFileId,
      sha256: attachmentSha,
      mimeType: attachment.mimeType.trim().toLowerCase(),
      sizeBytes: Number.isSafeInteger(asset.sizeBytes) && (asset.sizeBytes ?? 0) >= 0 ? asset.sizeBytes : 0,
      archiveState: "active",
      ...(asset.normalizedUrl ? { normalizedUrl: asset.normalizedUrl } : {}),
      ...(asset.publicUrlVerified !== undefined ? { publicUrlVerified: asset.publicUrlVerified } : {}),
      ...(asset.reviewStatus ? { reviewStatus: asset.reviewStatus } : {}),
      ...(asset.rightsState ? { rightsState: asset.rightsState } : {}),
      ...(asset.distribution ? { distribution: asset.distribution } : {}),
      ...(asset.shared !== undefined ? { shared: asset.shared } : {}),
      ...(asset.sharedBrandIds ? { sharedBrandIds: [...asset.sharedBrandIds] } : {}),
    };
    pending.push({ attachment, payload: { id: attachment.assetId, clientId: input.scope.clientId, brandId: input.scope.brandId, source, providerFileId: asset.providerFileId ?? asset.provenance?.providerFileId, metadata } });
  }
  if (pending.length && !input.transport.compensateMediaAsset) throw new Error("MEDIA_OWNERSHIP_ROLLBACK_UNAVAILABLE");
  try {
    for (const item of pending) {
      submittedAssetIds.push(item.attachment.assetId);
      try {
        await input.transport.createMediaAsset(item.payload);
      } catch (error) {
        if (error && typeof error === "object" && "createOutcome" in error && error.createOutcome === "rejected") submittedAssetIds.pop();
        throw error;
      }
      createdAssetIds.push(item.attachment.assetId);
    }
    records = [...await input.transport.listMediaAssets(input.scope)];
    const finalProof = validateMediaAssetProof(input.attachments, records, input.scope);
    if (!finalProof.ok) throw new Error(finalProof.code);
  } catch (error) {
    await receipt.rollback(error);
    throw error;
  }
  return receipt;
}

export function processedEvidenceForVariant(attachments: readonly MediaAttachment[], metadataValue: unknown): ContentRunMediaEvidence[] | undefined {
  if (!attachments.length) return [];
  const validation = validateMediaAttachments(attachments, "gemini_web");
  if (!validation.ok) return undefined;
  if (!metadataValue || typeof metadataValue !== "object" || Array.isArray(metadataValue)) return undefined;
  const metadata = metadataValue as Record<string, unknown>;
  if (metadata.attachmentAccepted !== true || metadata.attachmentCount !== attachments.length || metadata.attachmentBoundary !== "chat_upload") return undefined;
  const evidence = matchProcessedMediaEvidence(validation.attachments, metadata.mediaEvidence);
  return evidence?.map((item) => ({ ...item, attachmentBoundary: "chat_upload" }));
}
