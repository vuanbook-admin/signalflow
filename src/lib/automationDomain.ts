import type { StrategySnapshot } from "./contentStrategy";
import type { ContentRunMediaEvidence } from "./contentRun";

export type AutomationTargetPlatform = "facebook" | "instagram" | "tiktok" | "youtube";
export type AutomationLiveAdapter = "native_meta" | "unsupported";
export type BrandAutomationStatus = "draft" | "active" | "paused";

export interface FacebookPageTarget {
  id: string;
  platform: "facebook";
  accountId: string;
  displayName: string;
  postsPerDay: number;
  imageCount: number;
  videoCount: number;
  publishTimes: string[];
  liveAdapter: AutomationLiveAdapter;
}

export interface BrandAutomationPlan {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  brandId: string;
  timezone: string;
  targetPages: FacebookPageTarget[];
  status: BrandAutomationStatus;
  createdAt: string;
  updatedAt: string;
}

export function createBrandAutomationPlan(workspaceId: string, brandId: string, timezone: string, targetPages: FacebookPageTarget[] = [], now = new Date()): BrandAutomationPlan {
  return { schemaVersion: 1, id: `brand-automation-${workspaceId}-${brandId}`, workspaceId, brandId, timezone, targetPages, status: "draft", createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

function validTime(value: string): boolean { return /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }

export interface BrandAutomationValidationContext {
  brandKitReady?: boolean;
  brandVoiceReady?: boolean;
  eligibleMediaCount?: number;
}

export function validateBrandAutomationPlan(plan: BrandAutomationPlan, context: BrandAutomationValidationContext = {}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!plan.workspaceId.trim()) errors.push("Workspace is required.");
  if (!plan.brandId.trim()) errors.push("Brand is required.");
  if (!plan.timezone.trim()) errors.push("Timezone is required.");
  if (plan.targetPages.length === 0 || plan.targetPages.some((page) => !page.accountId.trim())) errors.push("At least one target Page/account is required.");
  plan.targetPages.forEach((page) => {
    if (page.platform !== "facebook") errors.push(`${page.platform} target ${page.accountId || page.id.replace(/^target-/, "")} is not a Facebook Page.`);
    if (page.liveAdapter !== "native_meta") errors.push(`facebook target ${page.accountId || page.id.replace(/^target-/, "")} live adapter is unsupported.`);
    if (!Number.isInteger(page.postsPerDay) || page.postsPerDay < 1) errors.push(`facebook target ${page.accountId || page.id.replace(/^target-/, "")} needs at least one post per day.`);
    if (![page.imageCount, page.videoCount].every((count) => Number.isInteger(count) && count >= 0)) errors.push(`facebook target ${page.accountId || page.id.replace(/^target-/, "")} media counts must be non-negative integers.`);
    if (page.imageCount + page.videoCount !== page.postsPerDay) errors.push(`facebook target ${page.accountId || page.id.replace(/^target-/, "")} image and video counts must equal posts per day.`);
    if (page.publishTimes.length !== page.postsPerDay || page.publishTimes.some((time) => !validTime(time))) errors.push(`facebook target ${page.accountId || page.id.replace(/^target-/, "")} needs one valid exact time per post.`);
    if (page.publishTimes.some((time, index) => index > 0 && time <= page.publishTimes[index - 1])) errors.push(`facebook target ${page.accountId || page.id.replace(/^target-/, "")} publish times must be ordered.`);
  });
  if (plan.status === "active") {
    if (context.brandKitReady === false) errors.push("Brand Kit is required before activation.");
    if (context.brandVoiceReady === false) errors.push("Brand voice is required before activation.");
    if ((context.eligibleMediaCount ?? 0) < 1) errors.push("At least one eligible media asset is required for activation.");
  }
  return { ok: errors.length === 0, errors };
}

export interface AutomationScheduleEntry {
  deterministicKey: string;
  targetPageId: string;
  accountId: string;
  platform: "facebook";
  publishTime: string;
  postIndex: number;
  mediaKind: "image" | "video";
}

export function expandBrandAutomationSchedule(plan: BrandAutomationPlan): AutomationScheduleEntry[] {
  return plan.targetPages.flatMap((page) => page.publishTimes.map((publishTime, postIndex) => ({
    deterministicKey: `${plan.id}:${page.accountId}:${postIndex}`,
    targetPageId: page.id,
    accountId: page.accountId,
    platform: page.platform,
    publishTime,
    postIndex,
    mediaKind: postIndex < page.imageCount ? "image" : "video",
  })));
}

export type MediaInventoryKind = "image" | "video" | "unknown";
export type MediaDistribution = "universal" | AutomationTargetPlatform;
export type MediaInventoryStatus = "discovered" | "classified" | "eligible" | "reserved" | "used" | "failed" | "archived" | "duplicate" | "private";

export type MediaReviewStatus = "needs_review" | "verified" | "rejected";
export type MediaDuplicateStatus = "unknown" | "unique" | "duplicate";
export type MediaDuplicateKind = "exact" | "near";
export type MediaUsageStatus = "available" | "reserved" | "used";
export type MediaArchiveState = "active" | "archived";

export interface MediaProvenance {
  source: "google_drive" | "public_https" | "local" | "generated";
  providerFileId?: string;
  provider?: "google_flow" | "vertex_ai";
  importedAt?: string;
}

export type MediaFingerprintSource = "decoded_image" | "decoded_video_frames";

export interface MediaInventoryRecord {
  id: string;
  clientId?: string;
  brandId: string;
  campaignId: string;
  topic: string;
  platform: AutomationTargetPlatform;
  /** Universal media is reusable across enabled channels; generated media remains platform-scoped. */
  distribution?: MediaDistribution;
  kind: MediaInventoryKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedAt: string;
  source: "drive" | "public_https" | "local" | "generated";
  status: MediaInventoryStatus;
  normalizedDriveFileId?: string;
  shareUrl?: string;
  normalizedUrl?: string;
  localAssetPath?: string;
  thumbnailPath?: string;
  sha256?: string;
  visualFingerprint?: string;
  /** A fingerprint is publishable evidence only when produced from decoded pixels/frames. */
  visualFingerprintSource?: MediaFingerprintSource;
  reviewedReady?: boolean;
  providerFileId?: string;
  reviewStatus?: MediaReviewStatus;
  rightsState?: "user_owned" | "licensed" | "unknown" | "restricted";
  duplicateStatus?: MediaDuplicateStatus;
  duplicateKind?: MediaDuplicateKind;
  duplicateReason?: string;
  usageStatus?: MediaUsageStatus;
  usedReason?: string;
  reservedReason?: string;
  publicUrlVerified?: boolean;
  archiveState?: MediaArchiveState;
  provenance?: MediaProvenance;
  hierarchy?: { clientId: string; brandId: string; platform: AutomationTargetPlatform; date: string; contentRunId: string; relativePath: string };
}

export function buildMediaHierarchy(input: { clientId: string; brandId: string; platform: AutomationTargetPlatform; capturedAt: string; contentRunId: string; filename: string }): MediaInventoryRecord["hierarchy"] {
  const safe = (value: string, code: string) => { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) || value.includes("..") || value.includes("/") || value.includes("\\")) throw new Error(code); return value; };
  const date = new Date(input.capturedAt);
  if (Number.isNaN(date.getTime())) throw new Error("MEDIA_HIERARCHY_DATE_INVALID");
  const clientId = safe(input.clientId, "MEDIA_HIERARCHY_CLIENT_INVALID");
  const brandId = safe(input.brandId, "MEDIA_HIERARCHY_BRAND_INVALID");
  const contentRunId = safe(input.contentRunId, "MEDIA_HIERARCHY_RUN_INVALID");
  const filename = safe(input.filename, "MEDIA_HIERARCHY_FILENAME_INVALID");
  const platform = safe(input.platform, "MEDIA_HIERARCHY_PLATFORM_INVALID") as AutomationTargetPlatform;
  const dateKey = date.toISOString().slice(0, 10);
  return { clientId, brandId, platform, date: dateKey, contentRunId, relativePath: `${clientId}/${brandId}/${platform}/${dateKey.slice(0, 4)}/${dateKey.slice(5, 7)}/${dateKey.slice(8, 10)}/${filename}` };
}

export function createGeneratedMediaRecord(input: {
  id: string;
  clientId?: string;
  brandId: string;
  topic: string;
  platform: AutomationTargetPlatform;
  name: string;
  localAssetPath: string;
  thumbnailPath?: string;
  mimeType: string;
  generatedAt: string;
  generatedSha256?: string;
  visualFingerprint?: string;
  provider: "google_flow" | "vertex_ai";
  contentRunId?: string;
}): MediaInventoryRecord {
  const contentRunId = input.contentRunId ?? input.id;
  const video = input.mimeType.toLowerCase().includes("video") || /\.(?:mp4|webm|mov)$/i.test(input.localAssetPath);
  const extension = video ? ".mp4" : input.mimeType.toLowerCase().includes("jpeg") ? ".jpg" : ".png";
  const hierarchyFilename = `${input.id.replace(/[^A-Za-z0-9._-]/g, "-")}${extension}`;
  return {
    id: input.id,
    clientId: input.clientId,
    brandId: input.brandId,
    campaignId: "",
    topic: input.topic,
    platform: input.platform,
    distribution: input.platform,
    kind: video ? "video" : "image",
    name: input.name,
    mimeType: input.mimeType,
    sizeBytes: 0,
    modifiedAt: input.generatedAt,
    source: "generated",
    status: "classified",
    localAssetPath: input.localAssetPath,
    thumbnailPath: input.thumbnailPath,
    sha256: input.generatedSha256,
    visualFingerprint: input.visualFingerprint,
    visualFingerprintSource: input.visualFingerprint ? (video ? "decoded_video_frames" : "decoded_image") : undefined,
    hierarchy: input.clientId ? buildMediaHierarchy({ clientId: input.clientId, brandId: input.brandId, platform: input.platform, capturedAt: input.generatedAt, contentRunId, filename: hierarchyFilename }) : undefined,
    reviewStatus: "needs_review",
    duplicateStatus: "unknown",
    usageStatus: "available",
    publicUrlVerified: false,
    provenance: { source: "generated", provider: input.provider, importedAt: input.generatedAt },
  };
}

export interface DriveInventoryInput {
  providerFileId: string;
  name: string;
  mimeType: string;
  kind?: MediaInventoryKind;
  sizeBytes: number;
  sizeText?: string;
  modifiedAt: string;
  shareUrl?: string;
  normalizedUrl?: string;
}

function normalizedDriveId(value: string): string { return value.trim().replace(/[^A-Za-z0-9_-]/g, ""); }

export function normalizeDriveFileId(value: string | undefined): string | undefined {
  const input = value?.trim() ?? "";
  if (!input) return undefined;
  const fromPath = input.match(/\/file\/d\/([A-Za-z0-9_-]+)/i)?.[1] ?? input.match(/[?&]id=([A-Za-z0-9_-]+)/i)?.[1];
  const result = normalizedDriveId(fromPath ?? input);
  return result || undefined;
}

export function normalizeDriveShareUrl(shareUrl: string | undefined, fileId: string): string | undefined {
  if (shareUrl && !/^https:\/\/drive\.google\.com\//i.test(shareUrl)) return undefined;
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

function mimeTypeFromName(name: string): string {
  const extension = name.toLowerCase().match(/\.(png|jpe?g|webp|gif|mp4|mov|webm)(?:\b|[^a-z0-9])/i)?.[1];
  if (!extension) return "application/octet-stream";
  return ["mp4", "mov", "webm"].includes(extension) ? `video/${extension === "mov" ? "quicktime" : extension}` : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension}`;
}

function parseDriveSize(sizeText: string | undefined): number {
  const match = sizeText?.trim().match(/^(\d+(?:[.,]\d+)?)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) return 0;
  const unit = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4 }[match[2].toUpperCase() as "B" | "KB" | "MB" | "GB" | "TB"];
  return Math.round(Number(match[1].replace(",", ".")) * 1024 ** unit);
}

export function classifyDriveInventory(input: DriveInventoryInput): MediaInventoryRecord {
  const declaredMimeType = (input.mimeType || "").trim().toLowerCase();
  const filenameMimeType = mimeTypeFromName(input.name);
  const declaredKind = input.kind === "image" || input.kind === "video" ? input.kind : undefined;
  const mimeType = declaredMimeType.startsWith("image/") || declaredMimeType.startsWith("video/")
    ? declaredMimeType
    : filenameMimeType !== "application/octet-stream" ? filenameMimeType : declaredMimeType || filenameMimeType;
  const kind: MediaInventoryKind = declaredKind ?? (mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : "unknown");
  const fileId = normalizeDriveFileId(input.providerFileId);
  return {
    id: `drive-${fileId ?? stableMediaRecordIdHash(input.name)}`,
    brandId: "",
    campaignId: "",
    topic: "",
    platform: "facebook",
    distribution: "universal",
    kind,
    name: input.name,
    mimeType,
    sizeBytes: input.sizeBytes || parseDriveSize(input.sizeText),
    modifiedAt: input.modifiedAt,
    source: "drive",
    status: "classified",
    normalizedDriveFileId: fileId,
    providerFileId: input.providerFileId,
    shareUrl: input.shareUrl,
    normalizedUrl: input.normalizedUrl && /^https:\/\//i.test(input.normalizedUrl) ? input.normalizedUrl : fileId ? normalizeDriveShareUrl(input.shareUrl, fileId) : undefined,
    reviewStatus: "needs_review",
    duplicateStatus: "unknown",
    usageStatus: "available",
    publicUrlVerified: false,
    provenance: { source: "google_drive", providerFileId: input.providerFileId },
  };
}

/** Reclassify legacy Drive records without changing operator review or usage state. */
export function resolveMediaDistribution(record: Pick<MediaInventoryRecord, "source" | "platform" | "distribution">): MediaDistribution {
  if (record.distribution === "universal" || record.distribution === "facebook" || record.distribution === "instagram" || record.distribution === "tiktok" || record.distribution === "youtube") return record.distribution;
  return record.source === "generated" ? record.platform : "universal";
}

export function normalizeDriveInventoryRecord(record: MediaInventoryRecord): MediaInventoryRecord {
  const distribution = resolveMediaDistribution(record);
  const isDriveRecord = record.source === "drive" || String(record.source) === "google_drive" || record.provenance?.source === "google_drive" || Boolean(record.providerFileId || record.normalizedDriveFileId);
  if (!isDriveRecord || String(record.kind).toLowerCase() !== "unknown") return { ...record, distribution };
  const classified = classifyDriveInventory({
    providerFileId: record.providerFileId ?? record.normalizedDriveFileId ?? record.id,
    name: record.name,
    mimeType: record.mimeType,
    kind: record.kind,
    sizeBytes: record.sizeBytes,
    modifiedAt: record.modifiedAt,
    shareUrl: record.shareUrl,
    normalizedUrl: record.normalizedUrl,
  });
  return {
    ...record,
    distribution,
    kind: classified.kind,
    mimeType: classified.mimeType,
    normalizedDriveFileId: record.normalizedDriveFileId ?? classified.normalizedDriveFileId,
    providerFileId: record.providerFileId ?? classified.providerFileId,
  };
}

/** Only an explicit import into the active Client/Brand may adopt unowned Drive inventory.
 * The legacy brand-only form preserves old metadata merges without claiming Client ownership.
 */
export function mergeDriveInventoryRecord(incoming: MediaInventoryRecord, existing: MediaInventoryRecord | undefined, scope: string | { clientId: string; brandId: string }): MediaInventoryRecord {
  const brandId = typeof scope === "string" ? scope : scope.brandId;
  const ownership = typeof scope === "string" ? {} : { clientId: scope.clientId, brandId: scope.brandId };
  if (typeof scope !== "string") {
    if (!scope.clientId.trim() || !scope.brandId.trim()) throw new Error("DRIVE_MEDIA_SCOPE_REQUIRED");
    for (const record of [incoming, existing]) {
      if (record && (record.clientId && record.clientId !== scope.clientId || record.brandId && record.brandId !== scope.brandId)) throw new Error("DRIVE_MEDIA_OWNERSHIP_CONFLICT");
    }
  }
  if (!existing) return { ...incoming, brandId, ...ownership };
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    brandId: existing.brandId || brandId,
    ...ownership,
    campaignId: existing.campaignId,
    topic: existing.topic,
    distribution: existing.distribution ?? incoming.distribution ?? resolveMediaDistribution(existing),
    status: existing.status ?? incoming.status,
    reviewedReady: existing.reviewedReady ?? incoming.reviewedReady,
    reviewStatus: existing.reviewStatus ?? incoming.reviewStatus,
    duplicateStatus: existing.duplicateStatus ?? incoming.duplicateStatus,
    duplicateKind: existing.duplicateKind ?? incoming.duplicateKind,
    duplicateReason: existing.duplicateReason ?? incoming.duplicateReason,
    usageStatus: existing.usageStatus ?? incoming.usageStatus,
    usedReason: existing.usedReason ?? incoming.usedReason,
    reservedReason: existing.reservedReason ?? incoming.reservedReason,
    localAssetPath: existing.localAssetPath ?? incoming.localAssetPath,
    sha256: existing.sha256 ?? incoming.sha256,
    visualFingerprint: existing.visualFingerprint ?? incoming.visualFingerprint,
    visualFingerprintSource: existing.visualFingerprintSource ?? incoming.visualFingerprintSource,
    shareUrl: incoming.shareUrl ?? existing.shareUrl,
    normalizedUrl: existing.publicUrlVerified ? existing.normalizedUrl ?? incoming.normalizedUrl : incoming.normalizedUrl ?? existing.normalizedUrl,
    publicUrlVerified: existing.publicUrlVerified ?? incoming.publicUrlVerified,
    provenance: { ...existing.provenance, ...incoming.provenance, source: "google_drive", providerFileId: incoming.providerFileId ?? existing.providerFileId },
  };
}

/** Validate the entire discovery/saved identity sets before adopting any unowned row. */
export function mergeDriveInventory(imported: readonly MediaInventoryRecord[], existing: readonly MediaInventoryRecord[], scope: { clientId: string; brandId: string }): MediaInventoryRecord[] {
  const index = (records: readonly MediaInventoryRecord[]) => {
    const groups = new Map<string, MediaInventoryRecord[]>();
    const localIds = new Set<string>();
    for (const record of records) {
      const providerIds = [...new Set([record.providerFileId, record.normalizedDriveFileId, record.provenance?.providerFileId].map(normalizeDriveFileId).filter((id): id is string => Boolean(id)))];
      if (providerIds.length > 1 || localIds.has(record.id)) throw new Error("DRIVE_MEDIA_IDENTITY_AMBIGUOUS");
      localIds.add(record.id);
      if (providerIds.length) groups.set(providerIds[0], [...(groups.get(providerIds[0]) ?? []), record]);
    }
    for (const group of groups.values()) {
      if (group.length > 1) throw new Error("DRIVE_MEDIA_IDENTITY_AMBIGUOUS");
    }
    return groups;
  };
  const saved = index(existing);
  const discovered = index(imported);
  const merged = [...discovered.entries()].map(([id, [incoming]]) => {
    if (existing.some((record) => record.id === incoming.id && record !== saved.get(id)?.[0])) throw new Error("DRIVE_MEDIA_IDENTITY_AMBIGUOUS");
    return mergeDriveInventoryRecord(incoming, saved.get(id)?.[0], scope);
  });
  if (merged.length !== imported.length) throw new Error("DRIVE_MEDIA_IDENTITY_AMBIGUOUS");
  return [...merged, ...existing.filter((record) => !merged.some((item) => item.id === record.id))];
}

/** Stable record-ID fallback only; never use this hash for duplicate or visual similarity decisions. */
export function stableMediaRecordIdHash(input: string | Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const bytes = typeof input === "string" ? Array.from(input).map((character) => character.charCodeAt(0)) : Array.from(input);
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, "0");
}

const SHA256 = /^[a-f0-9]{64}$/i;
const HTTPS = /^https:\/\//i;

export function isMediaEligible(asset: MediaInventoryRecord, ledger?: MediaReservationLedger): boolean {
  return asset.archiveState !== "archived"
    && (asset.kind === "image" || asset.kind === "video")
    && (asset.status === "eligible" || (asset.status === "classified" && asset.reviewedReady === true))
    && asset.reviewStatus !== "needs_review"
    && asset.reviewStatus !== "rejected"
    && asset.duplicateStatus !== "duplicate"
    && (asset.usageStatus ?? "available") === "available"
    && asset.publicUrlVerified === true
    && Boolean(asset.normalizedUrl && HTTPS.test(asset.normalizedUrl))
    && Boolean(asset.sha256 && SHA256.test(asset.sha256))
    && validVisualFingerprint(asset)
    && (ledger ? ledger.isAvailable(asset.id) : true);
}

export interface DecodedImageAnalysis {
  bytes: number;
  sha256: string;
  modifiedAt: string;
  mimeType: string;
  visualFingerprint?: string | null;
  visualFingerprintSource?: "decoded_image" | "decoded_video_frames" | null;
}

/** Apply fresh local pixel analysis; a bare legacy fingerprint is never treated as decoded evidence. */
export function applyDecodedImageAnalysis(record: MediaInventoryRecord, analysis: DecodedImageAnalysis): MediaInventoryRecord {
  return {
    ...record,
    sizeBytes: analysis.bytes,
    sha256: analysis.sha256,
    modifiedAt: analysis.modifiedAt,
    mimeType: analysis.mimeType,
    visualFingerprint: analysis.visualFingerprint ?? undefined,
    visualFingerprintSource: analysis.visualFingerprint ? analysis.visualFingerprintSource ?? "decoded_image" : undefined,
  };
}

/** Promote only a freshly decoded, fully verified Image; all other results remain blocked. */
export function promoteVerifiedDecodedImage(record: MediaInventoryRecord): MediaInventoryRecord {
  const canPromote = record.kind === "image"
    && record.reviewStatus === "verified"
    && record.publicUrlVerified === true
    && validSha256(record.sha256)
    && validVisualFingerprint(record);
  return canPromote ? { ...record, status: "eligible", reviewedReady: true } : { ...record, status: "classified" };
}

export interface DuplicateMatch { kind: "exact" | "near"; assetId: string; }

export function getMediaEligibilityReason(asset: MediaInventoryRecord, ledger?: MediaReservationLedger): string | undefined {
  if (asset.archiveState === "archived") return "Archived in SignalFlow (provider asset was not deleted)";
  if (asset.kind !== "image" && asset.kind !== "video") return `Unsupported media kind: ${asset.kind}`;
  if (asset.reviewStatus === "needs_review" || asset.reviewStatus === undefined && asset.status === "classified") return "Needs review: verify public URL, SHA-256, and visual fingerprint";
  if (asset.reviewStatus === "rejected") return "Rejected in media review";
  if (asset.duplicateStatus === "duplicate") return `Duplicate: ${asset.duplicateReason ?? "matching SHA-256 or visual fingerprint"}`;
  if (asset.usageStatus === "used" || asset.status === "used") return `Used: ${asset.usedReason ?? "already published or consumed"}`;
  if (asset.usageStatus === "reserved" || (ledger && !ledger.isAvailable(asset.id))) {
    const reservation = ledger?.list().find((entry) => entry.assetId === asset.id);
    return `Reserved by ${reservation?.reservationKey ?? asset.reservedReason ?? "another post"}`;
  }
  if (!asset.normalizedUrl || !HTTPS.test(asset.normalizedUrl) || asset.publicUrlVerified !== true) return "Needs review: verify public HTTPS URL reachability";
  if (!asset.sha256 || !SHA256.test(asset.sha256)) return "Needs review: verify SHA-256 checksum";
  if (asset.visualFingerprint && !asset.visualFingerprintSource) return "Needs review: re-analyze locally to record decoded fingerprint provenance";
  if (!validVisualFingerprint(asset)) return "Needs review: verify visual fingerprint";
  if (asset.status !== "eligible" && !(asset.status === "classified" && asset.reviewedReady === true)) return `Not eligible: ${asset.status}`;
  return undefined;
}

export function archiveMediaAsset(record: MediaInventoryRecord): MediaInventoryRecord {
  return { ...record, archiveState: "archived", status: "archived" };
}

export function restoreMediaAsset(record: MediaInventoryRecord): MediaInventoryRecord {
  return { ...record, archiveState: "active", status: "classified", reviewStatus: "needs_review", reviewedReady: false, usageStatus: "available", reservedReason: undefined, usedReason: undefined };
}

function validSha256(value: string | undefined): value is string { return Boolean(value && SHA256.test(value)); }

function validVisualFingerprint(asset: Pick<MediaInventoryRecord, "kind" | "visualFingerprint" | "visualFingerprintSource">): boolean {
  if (!asset.visualFingerprint || !/^[a-f0-9]{16}$/i.test(asset.visualFingerprint)) return false;
  return asset.visualFingerprintSource === "decoded_image" || asset.visualFingerprintSource === "decoded_video_frames";
}

function fingerprintDistance(left: string, right: string): number {
  if (!/^[a-f0-9]{16}$/i.test(left) || !/^[a-f0-9]{16}$/i.test(right)) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let bits = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    while (bits) { distance += bits & 1; bits >>>= 1; }
  }
  return distance;
}

export function findDuplicateMedia(asset: MediaInventoryRecord, candidates: MediaInventoryRecord[]): DuplicateMatch | undefined {
  const assetDriveId = normalizeDriveFileId(asset.normalizedDriveFileId ?? asset.providerFileId);
  const assetSha = validSha256(asset.sha256) ? asset.sha256.toLowerCase() : undefined;
  const exact = candidates.find((candidate) => {
    if (candidate.id === asset.id) return false;
    const candidateDriveId = normalizeDriveFileId(candidate.normalizedDriveFileId ?? candidate.providerFileId);
    const candidateSha = validSha256(candidate.sha256) ? candidate.sha256.toLowerCase() : undefined;
    return Boolean((assetSha && candidateSha && assetSha === candidateSha) || (assetDriveId && candidateDriveId && assetDriveId === candidateDriveId));
  });
  if (exact) return { kind: "exact", assetId: exact.id };
  if (!validVisualFingerprint(asset)) return undefined;
  const near = candidates.find((candidate) => candidate.id !== asset.id && candidate.kind === asset.kind && validVisualFingerprint(candidate) && fingerprintDistance(asset.visualFingerprint!, candidate.visualFingerprint!) <= 2);
  return near ? { kind: "near", assetId: near.id } : undefined;
}

export interface MediaReservation {
  reservationKey: string;
  assetId: string;
  channel: AutomationTargetPlatform;
  dayKey: string;
  state: "reserved" | "used";
}

export interface MediaReservationRequest { assetId: string; reservationKey: string; channel: AutomationTargetPlatform; dayKey: string; }

export class MediaReservationLedger {
  private readonly reservations = new Map<string, MediaReservation>();
  private readonly assetReservations = new Map<string, string>();

  constructor(records: MediaReservation[] = []) { this.hydrate(records); }

  hydrate(records: MediaReservation[]): void {
    records.forEach((record) => {
      if (!record?.reservationKey || !record.assetId || !["reserved", "used"].includes(record.state)) return;
      if (this.reservations.has(record.reservationKey) || this.assetReservations.has(record.assetId)) return;
      this.reservations.set(record.reservationKey, { ...record });
      this.assetReservations.set(record.assetId, record.reservationKey);
    });
  }

  reserve(request: MediaReservationRequest): boolean {
    const currentForKey = this.reservations.get(request.reservationKey);
    if (currentForKey) return currentForKey.assetId === request.assetId && (currentForKey.state === "reserved" || currentForKey.state === "used");
    if (this.assetReservations.has(request.assetId)) return false;
    const record: MediaReservation = { ...request, state: "reserved" };
    this.reservations.set(request.reservationKey, record);
    this.assetReservations.set(request.assetId, request.reservationKey);
    return true;
  }

  get(reservationKey: string): MediaReservation | undefined { return this.reservations.get(reservationKey); }
  list(): MediaReservation[] { return [...this.reservations.values()]; }
  isAvailable(assetId: string): boolean { return !this.assetReservations.has(assetId); }

  reservationForAsset(assetId: string): MediaReservation | undefined {
    const key = this.assetReservations.get(assetId);
    return key ? this.reservations.get(key) : undefined;
  }

  release(reservationKey: string): boolean {
    const record = this.reservations.get(reservationKey);
    if (!record || record.state !== "reserved") return false;
    this.reservations.delete(reservationKey);
    this.assetReservations.delete(record.assetId);
    return true;
  }

  markUsed(reservationKey: string): boolean {
    const record = this.reservations.get(reservationKey);
    if (!record || record.state !== "reserved") return false;
    this.reservations.set(reservationKey, { ...record, state: "used" });
    return true;
  }
}

export function hydrateReservationLedger(records: MediaReservation[]): MediaReservationLedger {
  return new MediaReservationLedger(records);
}

/** Project one persisted reservation outcome onto its media record without changing review or duplicate evidence. */
export function applyMediaReservationToRecord(record: MediaInventoryRecord, reservation?: MediaReservation): MediaInventoryRecord {
  if (reservation?.state === "used") return { ...record, status: "used", usageStatus: "used", usedReason: `Reservation ${reservation.reservationKey} completed` };
  if (reservation?.state === "reserved") return { ...record, status: "reserved", usageStatus: "reserved", reservedReason: reservation.reservationKey };
  if (!reservation && record.usageStatus === "reserved") return { ...record, status: record.reviewStatus === "verified" ? "eligible" : "classified", usageStatus: "available", reservedReason: undefined };
  return record;
}

export interface MediaSelectionRequest { clientId?: string; brandId: string; campaignId: string; topic: string; platform: AutomationTargetPlatform; kind: "image" | "video"; }

export function selectMediaForPost(assets: MediaInventoryRecord[], request: MediaSelectionRequest, ledger: MediaReservationLedger): MediaInventoryRecord | undefined {
  const requestedTopic = request.topic.trim().toLowerCase();
  return assets
    .filter((asset) => (request.clientId === undefined || asset.clientId === request.clientId) && asset.brandId === request.brandId && asset.kind === request.kind && (resolveMediaDistribution(asset) === request.platform || resolveMediaDistribution(asset) === "universal") && isMediaEligible(asset, ledger))
    .sort((left, right) => {
      const leftDistribution = resolveMediaDistribution(left);
      const rightDistribution = resolveMediaDistribution(right);
      const leftPlatformRank = Number(leftDistribution === request.platform);
      const rightPlatformRank = Number(rightDistribution === request.platform);
      if (leftPlatformRank !== rightPlatformRank) return rightPlatformRank - leftPlatformRank;
      const leftCampaignRank = Number(Boolean(request.campaignId) && left.campaignId === request.campaignId);
      const rightCampaignRank = Number(Boolean(request.campaignId) && right.campaignId === request.campaignId);
      if (leftCampaignRank !== rightCampaignRank) return rightCampaignRank - leftCampaignRank;
      const leftTopic = left.topic.trim().toLowerCase();
      const rightTopic = right.topic.trim().toLowerCase();
      const leftTopicRank = !requestedTopic ? 0 : leftTopic === requestedTopic ? 2 : leftTopic === "" ? 1 : 0;
      const rightTopicRank = !requestedTopic ? 0 : rightTopic === requestedTopic ? 2 : rightTopic === "" ? 1 : 0;
      if (leftTopicRank !== rightTopicRank) return rightTopicRank - leftTopicRank;
      const modified = right.modifiedAt.localeCompare(left.modifiedAt);
      return modified || left.id.localeCompare(right.id);
    })[0];
}

function localDayKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export interface DailyAutomationDraft {
  deterministicKey: string;
  reservationKey: string;
  targetPageId: string;
  accountId: string;
  platform: "facebook";
  publishTime: string;
  postIndex: number;
  mediaKind: "image" | "video";
  mediaAssetId: string;
  pipelineState: "needs_review";
}

export function createDailyDraftPlan(plan: BrandAutomationPlan, now: Date, assets: MediaInventoryRecord[], ledger: MediaReservationLedger): DailyAutomationDraft[] {
  const dayKey = localDayKey(now, plan.timezone);
  return expandBrandAutomationSchedule(plan).flatMap((entry) => {
    const deterministicKey = `${plan.id}:${dayKey}:${entry.accountId}:${entry.postIndex}`;
    const existing = ledger.get(deterministicKey);
    if (existing?.state === "used") return [];
    const selected = existing ? assets.find((asset) => asset.id === existing.assetId && isMediaEligible(asset)) : selectMediaForPost(assets, { brandId: plan.brandId, campaignId: "", topic: "", platform: entry.platform, kind: entry.mediaKind }, ledger);
    if (!selected) return [];
    if (!existing && !ledger.reserve({ assetId: selected.id, reservationKey: deterministicKey, channel: entry.platform, dayKey })) return [];
    return [{ ...entry, deterministicKey, reservationKey: deterministicKey, mediaAssetId: selected.id, pipelineState: "needs_review" as const }];
  });
}

export type CreativePipelineState = "idea" | "media_selected" | "media_generated" | "content_generated" | "needs_review" | "approved" | "scheduled" | "published" | "failed" | "image" | "copy" | "review";

export type CreativeAssetOperationStatus = "idle" | "running" | "completed" | "blocked" | "failed";
export const ASSET_GENERATION_TIMEOUT_MS = 120_000;
export const ASSET_OPERATION_TERMINAL_GRACE_MS = 5_000;

export interface CreativeAssetOperation {
  kind: "image" | "video";
  status: CreativeAssetOperationStatus;
  /** Monotonic attempt version within one slot/idempotency key. */
  operationVersion?: number;
  provider?: string;
  stage?: string;
  reason?: string;
  createdAt?: string;
  slotId?: string;
  strategyVersion?: number;
  idempotencyKey?: string;
  deadlineAt?: number;
}

export type AssetOperationDeadline = { deadlineAt: number; remainingMs: () => number };

export function createAssetOperationDeadline(timeoutMs = ASSET_GENERATION_TIMEOUT_MS, now = Date.now): AssetOperationDeadline {
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : ASSET_GENERATION_TIMEOUT_MS;
  const deadlineAt = now() + duration;
  return { deadlineAt, remainingMs: () => Math.max(1, deadlineAt - now()) };
}

export function withAssetOperationDeadline<T>(operation: Promise<T> | (() => Promise<T>), deadlineAt: number, timeoutCode = "ASSET_GENERATION_TIMEOUT"): Promise<T> {
  if (deadlineAt <= Date.now()) {
    if (typeof operation !== "function") void operation.catch(() => undefined);
    return Promise.reject(new Error(timeoutCode));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (kind: "resolve" | "reject", value: T | unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (kind === "resolve") resolve(value as T);
      else reject(value);
    };
    const timer = setTimeout(() => finish("reject", new Error(timeoutCode)), Math.max(1, deadlineAt - Date.now()));
    Promise.resolve().then(() => typeof operation === "function" ? operation() : operation).then((value) => finish("resolve", value), (error) => finish("reject", error));
  });
}

export function withAssetOperationTerminalGrace<T>(operation: Promise<T> | (() => Promise<T>), deadlineAt: number, timeoutCode = "ASSET_OPERATION_TERMINAL_PERSIST_TIMEOUT"): Promise<T> {
  return withAssetOperationDeadline(operation, deadlineAt + ASSET_OPERATION_TERMINAL_GRACE_MS, timeoutCode);
}

function validOperationVersion(operation: Pick<CreativeAssetOperation, "operationVersion">): number | undefined {
  return Number.isSafeInteger(operation.operationVersion) && operation.operationVersion! > 0 ? operation.operationVersion : undefined;
}

function sameAssetOperationAttempt(left: CreativeAssetOperation, right: CreativeAssetOperation): boolean {
  if (left.kind !== right.kind) return false;
  const leftVersion = validOperationVersion(left);
  const rightVersion = validOperationVersion(right);
  if (leftVersion !== undefined && rightVersion !== undefined && leftVersion !== rightVersion) return false;
  return (!left.slotId || !right.slotId || left.slotId === right.slotId) && (!left.idempotencyKey || !right.idempotencyKey || left.idempotencyKey === right.idempotencyKey);
}

export function nextCreativeAssetOperationVersion(history: readonly CreativeAssetOperation[], kind: "image" | "video", slotId?: string, idempotencyKey?: string): number {
  const versions = history.filter((operation) => operation.kind === kind && (!slotId || !operation.slotId || operation.slotId === slotId) && (!idempotencyKey || !operation.idempotencyKey || operation.idempotencyKey === idempotencyKey)).map(validOperationVersion).filter((version): version is number => version !== undefined);
  return (versions.length ? Math.max(...versions) : 0) + 1;
}

export function assetAttemptIdempotencyKey(baseKey: string | undefined, operationVersion: number): string | undefined {
  if (!baseKey || operationVersion <= 1) return baseKey;
  return `${baseKey}:attempt-${operationVersion}`;
}

export function settleCreativeAssetOperationHistory(history: readonly CreativeAssetOperation[], settled: CreativeAssetOperation): CreativeAssetOperation[] {
  const settledVersion = validOperationVersion(settled);
  if (settledVersion !== undefined) {
    const existingTerminalIndices = history.reduce<number[]>((indices, operation, index) => {
      const terminal = operation.status === "completed" || operation.status === "failed" || operation.status === "blocked";
      if (terminal && validOperationVersion(operation) === settledVersion && sameAssetOperationAttempt(operation, settled)) indices.push(index);
      return indices;
    }, []);
    if (existingTerminalIndices.length > 0) {
      const firstTerminal = existingTerminalIndices[0]!;
      return history.filter((operation, index) => index === firstTerminal || !(validOperationVersion(operation) === settledVersion && sameAssetOperationAttempt(operation, settled)));
    }
  }
  const matchingRunning = history.reduce<number[]>((indices, operation, index) => operation.status === "running" && sameAssetOperationAttempt(operation, settled) ? [...indices, index] : indices, []);
  const activeIndex = matchingRunning[matchingRunning.length - 1];
  if (activeIndex === undefined) return [...history, settled];
  const matched = new Set(matchingRunning);
  return history.map((operation, index) => index === activeIndex ? { ...settled } : matched.has(index) ? { ...operation, status: "failed", reason: operation.reason ?? "ASSET_OPERATION_SUPERSEDED" } : operation);
}

export function upsertCreativeAssetOperationHistory(history: readonly CreativeAssetOperation[], operation: CreativeAssetOperation): CreativeAssetOperation[] {
  if (operation.status !== "running") return settleCreativeAssetOperationHistory(history, operation);
  const activeIndex = history.reduce((last, candidate, index) => candidate.status === "running" && sameAssetOperationAttempt(candidate, operation) ? index : last, -1);
  return activeIndex < 0 ? [...history, operation] : history.map((candidate, index) => index === activeIndex ? { ...operation } : candidate);
}

/** Keep asset failure terminal while leaving the content run available for review and retry. */
export function recordCreativeAssetFailure(input: Omit<CreativeAssetOperation, "status">): CreativeAssetOperation {
  return { ...input, status: "failed" };
}

export function timeoutCreativeAssetOperation(operation: CreativeAssetOperation, now = new Date()): CreativeAssetOperation {
  if (operation.status !== "running") return operation;
  return { ...operation, status: "failed", stage: operation.stage ?? "asset_generation", reason: operation.reason ?? "ASSET_GENERATION_TIMEOUT", createdAt: operation.createdAt ?? now.toISOString() };
}

export function settleAssetOperation(operation: CreativeAssetOperation, reason: string, now = new Date()): CreativeAssetOperation {
  if (operation.status !== "running") return operation;
  return reason === "ASSET_GENERATION_TIMEOUT" ? timeoutCreativeAssetOperation(operation, now) : recordCreativeAssetFailure({ ...operation, reason });
}

/** Build the same content-run media checkpoint for manual and automatic asset attempts. */
export function buildAssetOperationPersistencePatch(operation: CreativeAssetOperation, history: readonly CreativeAssetOperation[], options: { state?: string | null; extra?: Record<string, unknown>; invalidateReview?: boolean } = {}): Record<string, unknown> {
  const asContentOperation = (item: CreativeAssetOperation) => { const { kind, ...rest } = item; return { ...rest, type: kind }; };
  const snapshot = (history.length ? history : [operation]).map(asContentOperation);
  const state = options.state === undefined ? "content_generated" : options.state;
  return {
    ...(options.extra ?? {}),
    ...(options.invalidateReview ? { qualityStatus: "pending", qualityChecks: [], approvalState: "pending" } : {}),
    mediaOperations: snapshot,
    visualOperations: snapshot,
    ...(state ? { state } : {}),
  };
}

export type MediaReplacementDescriptor = Pick<ContentRunMediaEvidence, "assetId" | "sha256" | "mimeType" | "order" | "role">;

export async function fingerprintMediaReplacement(media: readonly MediaReplacementDescriptor[]): Promise<string> {
  if (!media.length || media.some((item, index) => item.order !== index || !/^[a-f0-9]{64}$/i.test(item.sha256) || !/^(?:image|video)\/[a-z0-9.+-]+$/i.test(item.mimeType))) throw new Error("MEDIA_SET_FINGERPRINT_REQUIRED");
  const canonical = [...media].sort((left, right) => left.order - right.order).map(({ assetId, sha256, mimeType, order, role }) => ({ assetId, sha256: sha256.toLowerCase(), mimeType: mimeType.toLowerCase(), order, role }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildMediaReplacementPersistencePatch(
  operation: CreativeAssetOperation,
  history: readonly CreativeAssetOperation[],
  replacement: { mediaAssetIds: readonly string[]; mediaSetFingerprint: string; mediaEvidence: readonly ContentRunMediaEvidence[]; extra?: Record<string, unknown> },
): Record<string, unknown> {
  if (!replacement.mediaAssetIds.length || !/^[a-f0-9]{64}$/i.test(replacement.mediaSetFingerprint)) throw new Error("MEDIA_SET_FINGERPRINT_REQUIRED");
  if (replacement.mediaEvidence.length !== replacement.mediaAssetIds.length || replacement.mediaEvidence.some((item, index) => item.assetId !== replacement.mediaAssetIds[index] || item.order !== index)) throw new Error("MEDIA_REPLACEMENT_EVIDENCE_INVALID");
  return buildAssetOperationPersistencePatch(operation, history, {
    state: "needs_review",
    invalidateReview: true,
    extra: {
      ...(replacement.extra ?? {}),
      mediaReplacement: true,
      mediaAssetIds: [...replacement.mediaAssetIds],
      mediaSetFingerprint: replacement.mediaSetFingerprint.toLowerCase(),
      mediaEvidence: replacement.mediaEvidence.map((item) => ({ ...item })),
    },
  });
}

export type ContentRunMediaReplacementReconciliation =
  | { status: "acknowledged"; acknowledgement: unknown; mediaRevision: number }
  | { status: "reconciled"; snapshot: Record<string, unknown>; mediaRevision: number }
  | { status: "unknown"; code: "CONTENT_RUN_MEDIA_REPLACEMENT_RECONCILIATION_REQUIRED" };

function replacementAckAliased(row: Record<string, unknown>, aliases: readonly string[], equal: (left: unknown, right: unknown) => boolean, missingCode: string, conflictCode: string): unknown {
  const present = aliases.filter((alias) => Object.prototype.hasOwnProperty.call(row, alias));
  if (!present.length) throw new Error(missingCode);
  const first = row[present[0]!];
  if (present.slice(1).some((alias) => !equal(first, row[alias]))) throw new Error(conflictCode);
  return first;
}

export function validateContentRunMediaReplacementSnapshot(
  snapshot: unknown,
  runId: string,
  operation: CreativeAssetOperation,
  submittedRevision: number,
  replacement: { mediaAssetIds: readonly string[]; mediaSetFingerprint: string; mediaEvidence: readonly ContentRunMediaEvidence[] },
): number {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("CONTENT_RUN_MEDIA_REPLACEMENT_ACK_MISSING");
  const row = snapshot as Record<string, unknown>;
  if (row.id !== runId) throw new Error("CONTENT_RUN_MEDIA_REPLACEMENT_ACK_INVALID");
  if (row.state !== "needs_review") throw new Error("CONTENT_RUN_MEDIA_REPLACEMENT_ACK_STATE_MISMATCH");
  const operations = row.mediaOperations ?? row.media_operations ?? row.visualOperations ?? row.visual_operations;
  if (!Array.isArray(operations) || !operations.some((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const value = candidate as Record<string, unknown>;
    return value.type === operation.kind
      && value.status === operation.status
      && (operation.slotId === undefined || value.slotId === operation.slotId)
      && (operation.strategyVersion === undefined || value.strategyVersion === operation.strategyVersion)
      && (operation.idempotencyKey === undefined || value.idempotencyKey === operation.idempotencyKey);
  })) throw new Error("CONTENT_RUN_MEDIA_REPLACEMENT_ACK_OPERATION_MISMATCH");
  if (!Number.isSafeInteger(submittedRevision) || submittedRevision < 0 || submittedRevision >= Number.MAX_SAFE_INTEGER) throw new Error("CONTENT_RUN_MEDIA_REVISION_SUBMITTED_INVALID");
  const revision = replacementAckAliased(row, ["mediaRevision", "media_revision", "contentRunRevision", "content_run_revision"], (left, right) => left === right, "CONTENT_RUN_MEDIA_REVISION_ACK_MISSING", "CONTENT_RUN_MEDIA_REVISION_ACK_ALIAS_MISMATCH");
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) throw new Error("CONTENT_RUN_MEDIA_REVISION_ACK_INVALID");
  if (revision !== submittedRevision + 1) throw new Error("CONTENT_RUN_MEDIA_REVISION_ACK_STALE");
  const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  const mediaAssetIds = replacementAckAliased(row, ["mediaAssetIds", "media_asset_ids"], sameJson, "CONTENT_RUN_MEDIA_REPLACEMENT_ACK_MEDIA_MISSING", "CONTENT_RUN_MEDIA_REPLACEMENT_ACK_ALIAS_MISMATCH");
  if (!sameJson(mediaAssetIds, replacement.mediaAssetIds)) throw new Error("CONTENT_RUN_MEDIA_REPLACEMENT_ACK_MEDIA_MISMATCH");
  const fingerprint = replacementAckAliased(row, ["mediaSetFingerprint", "media_set_fingerprint"], (left, right) => typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase(), "CONTENT_RUN_MEDIA_REPLACEMENT_ACK_MEDIA_MISSING", "CONTENT_RUN_MEDIA_REPLACEMENT_ACK_ALIAS_MISMATCH");
  if (typeof fingerprint !== "string" || fingerprint.toLowerCase() !== replacement.mediaSetFingerprint.toLowerCase()) throw new Error("CONTENT_RUN_MEDIA_REPLACEMENT_ACK_MEDIA_MISMATCH");
  const mediaEvidence = replacementAckAliased(row, ["mediaEvidence", "media_evidence"], sameJson, "CONTENT_RUN_MEDIA_REPLACEMENT_ACK_MEDIA_MISSING", "CONTENT_RUN_MEDIA_REPLACEMENT_ACK_ALIAS_MISMATCH");
  if (!sameJson(mediaEvidence, replacement.mediaEvidence)) throw new Error("CONTENT_RUN_MEDIA_REPLACEMENT_ACK_MEDIA_MISMATCH");
  return revision;
}

export async function reconcileContentRunMediaReplacement(input: {
  runId: string;
  operation: CreativeAssetOperation;
  submittedRevision: number;
  replacement: { mediaAssetIds: readonly string[]; mediaSetFingerprint: string; mediaEvidence: readonly ContentRunMediaEvidence[] };
  acknowledge: () => Promise<unknown>;
  getContentRun: (runId: string) => Promise<Record<string, unknown> | undefined>;
}): Promise<ContentRunMediaReplacementReconciliation> {
  try {
    const acknowledgement = await input.acknowledge();
    return { status: "acknowledged", acknowledgement, mediaRevision: validateContentRunMediaReplacementSnapshot(acknowledgement, input.runId, input.operation, input.submittedRevision, input.replacement) };
  } catch {
    try {
      const snapshot = await input.getContentRun(input.runId);
      if (!snapshot) throw new Error("CONTENT_RUN_MEDIA_REPLACEMENT_READBACK_MISSING");
      return { status: "reconciled", snapshot, mediaRevision: validateContentRunMediaReplacementSnapshot(snapshot, input.runId, input.operation, input.submittedRevision, input.replacement) };
    } catch {
      return { status: "unknown", code: "CONTENT_RUN_MEDIA_REPLACEMENT_RECONCILIATION_REQUIRED" };
    }
  }
}

export type AssetOperationValidation = { ok: true } | { ok: false; stage: string; reason: string };

export interface AssetOperationRunnerInput<T> {
  kind: "image" | "video";
  provider?: string;
  slotId?: string;
  strategyVersion?: number;
  idempotencyKey?: string;
  operationVersion?: number;
  history?: readonly CreativeAssetOperation[];
  deadlineAt?: number;
  now?: Date;
  validate?: () => AssetOperationValidation;
  execute: () => Promise<T>;
  failureStage?: (error: unknown) => string;
  describeResult?: (result: T) => Partial<Pick<CreativeAssetOperation, "provider" | "stage" | "createdAt">>;
  checkpoint?: (operation: CreativeAssetOperation, history: readonly CreativeAssetOperation[], extra: Record<string, unknown>) => void;
  persist?: (operation: CreativeAssetOperation, history: readonly CreativeAssetOperation[], extra: Record<string, unknown>) => Promise<unknown>;
  extraForOperation?: (operation: CreativeAssetOperation, result?: T) => Record<string, unknown>;
  onSettled?: (operation: CreativeAssetOperation) => void;
}

export interface AssetOperationRunnerResult<T> {
  operation: CreativeAssetOperation;
  history: CreativeAssetOperation[];
  result?: T;
  error?: unknown;
  terminalPersistenceFailed?: boolean;
}

function assetOperationFailureReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "ASSET_PROVIDER_ERROR";
}

/** Run one independent asset attempt; content callers can persist their checkpoint before invoking this boundary. */
export async function runAssetOperation<T>(input: AssetOperationRunnerInput<T>): Promise<AssetOperationRunnerResult<T>> {
  const now = input.now ?? new Date();
  const deadlineAt = Number.isSafeInteger(input.deadlineAt) && input.deadlineAt! > 0 ? input.deadlineAt! : createAssetOperationDeadline(undefined, () => now.getTime()).deadlineAt;
  const previousHistory = (input.history ?? []).map((operation) => operation.status === "running" ? settleAssetOperation(operation, "APP_RESTART_INTERRUPTED", now) : operation);
  const running: CreativeAssetOperation = { kind: input.kind, status: "running", provider: input.provider, stage: "provider_readiness", createdAt: now.toISOString(), slotId: input.slotId, strategyVersion: input.strategyVersion, idempotencyKey: input.idempotencyKey, operationVersion: input.operationVersion ?? nextCreativeAssetOperationVersion(previousHistory, input.kind, input.slotId, input.idempotencyKey), deadlineAt };
  let history = upsertCreativeAssetOperationHistory(previousHistory, running);
  const extra = (operation: CreativeAssetOperation, result?: T) => input.extraForOperation?.(operation, result) ?? {};
  const commit = async (operation: CreativeAssetOperation, result?: T) => {
    history = operation.status === "running" ? upsertCreativeAssetOperationHistory(history, operation) : settleCreativeAssetOperationHistory(history, operation);
    const operationExtra = extra(operation, result);
    input.checkpoint?.(operation, history, operationExtra);
    if (!input.persist) return;
    const persistWithDeadline = operation.status === "running" ? withAssetOperationDeadline : withAssetOperationTerminalGrace;
    await persistWithDeadline(() => input.persist!(operation, history, operationExtra), deadlineAt);
  };
  const fail = async (base: CreativeAssetOperation, reason: string, error: unknown): Promise<AssetOperationRunnerResult<T>> => {
    const failed = { ...base, status: "failed" as const, stage: base.stage ?? "asset_generation", reason: base.reason ?? reason };
    input.onSettled?.(failed);
    try { await commit(failed); return { operation: failed, history, error }; } catch (terminalError) {
      input.checkpoint?.(failed, history, extra(failed));
      return { operation: failed, history, error: terminalError, terminalPersistenceFailed: true };
    }
  };
  try {
    await commit(running);
  } catch (error) {
    return fail({ ...running, stage: "persistence" }, assetOperationFailureReason(error), error);
  }
  const validation = input.validate?.();
  if (validation && !validation.ok) {
    const blocked = { ...running, status: "blocked" as const, stage: validation.stage, reason: validation.reason };
    input.onSettled?.(blocked);
    try { await commit(blocked); } catch (error) {
      const failed = { ...blocked, status: "failed" as const, stage: "persistence", reason: "ASSET_OPERATION_TERMINAL_PERSISTENCE_REQUIRED" };
      input.onSettled?.(failed);
      try { await commit(failed); } catch { input.checkpoint?.(failed, history, extra(failed)); }
      return { operation: failed, history, error, terminalPersistenceFailed: true };
    }
    return { operation: blocked, history, error: new Error(validation.reason) };
  }
  try {
    const result = await withAssetOperationDeadline(input.execute, deadlineAt);
    const completed = { ...running, status: "completed" as const, ...input.describeResult?.(result) };
    input.onSettled?.(completed);
    try {
      await commit(completed, result);
      return { operation: completed, history, result };
    } catch (error) {
      return fail({ ...running, stage: "persistence" }, assetOperationFailureReason(error), error);
    }
  } catch (error) {
    return fail({ ...running, stage: input.failureStage?.(error) ?? running.stage }, assetOperationFailureReason(error), error);
  }
}

export interface CreativeRunRecord {
  id: string;
  brandId: string;
  topic: string;
  /** Optional idea-stage output; absent in legacy snapshots. */
  idea?: string;
  ideaProvider?: string;
  ideaTraceId?: string;
  ideaModel?: string;
  state: CreativePipelineState;
  imageProvider?: ImageProvider;
  videoProvider?: VideoProvider;
  platform?: AutomationTargetPlatform;
  targetPageId?: string;
  automationKey?: string;
  mediaAssetId?: string;
  mediaProvenance?: MediaProvenance;
  strategySnapshot?: StrategySnapshot;
  strategyVersion?: number;
  generationIdempotencyKey?: string;
  generatedUrl?: string;
  generatedLocalAssetPath?: string;
  generatedMimeType?: string;
  generatedSha256?: string;
  generatedFingerprint?: string;
  assetOperation?: CreativeAssetOperation;
  copyResult?: { traceId?: string; provider?: string; imageAware: boolean; title?: string; body?: string };
  copyProvider?: string;
  copyModel?: string;
  promptVersion: string;
  brandVoiceVersion: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  error?: string;
  mediaOwnershipReconciliation?: MediaOwnershipReconciliationState;
}

export interface CreativeRunInput { id: string; brandId: string; topic: string; imageProvider: ImageProvider; videoProvider?: VideoProvider; now?: Date; platform?: AutomationTargetPlatform; targetPageId?: string; automationKey?: string; mediaAssetId?: string; mediaProvenance?: MediaProvenance; strategySnapshot?: StrategySnapshot; strategyVersion?: number; generationIdempotencyKey?: string; assetOperation?: CreativeAssetOperation; idea?: string; ideaProvider?: string; ideaTraceId?: string; ideaModel?: string; }

export function createCreativeRun(input: CreativeRunInput): CreativeRunRecord {
  const now = (input.now ?? new Date()).toISOString();
  return { id: input.id, brandId: input.brandId, topic: input.topic, idea: input.idea, ideaProvider: input.ideaProvider, ideaTraceId: input.ideaTraceId, ideaModel: input.ideaModel, state: "idea", imageProvider: input.imageProvider, videoProvider: input.videoProvider, platform: input.platform, targetPageId: input.targetPageId, automationKey: input.automationKey, mediaAssetId: input.mediaAssetId, mediaProvenance: input.mediaProvenance, strategySnapshot: input.strategySnapshot ? structuredClone(input.strategySnapshot) : undefined, strategyVersion: input.strategyVersion ?? input.strategySnapshot?.strategyVersion, generationIdempotencyKey: input.generationIdempotencyKey, assetOperation: input.assetOperation ? { ...input.assetOperation } : undefined, promptVersion: "v1", brandVoiceVersion: "v1", createdAt: now, updatedAt: now };
}

const CREATIVE_TRANSITIONS: Record<CreativePipelineState, CreativePipelineState[]> = {
  idea: ["media_selected", "image", "failed"],
  media_selected: ["media_generated", "copy", "content_generated", "failed"],
  media_generated: ["content_generated", "failed"],
  content_generated: ["needs_review", "review", "failed"],
  needs_review: ["approved", "failed"],
  approved: ["scheduled", "failed"],
  image: ["copy", "content_generated", "failed"],
  copy: ["content_generated", "review", "needs_review", "failed"],
  review: ["approved", "scheduled", "failed"],
  scheduled: ["published", "failed"],
  published: [],
  failed: [],
};

export function transitionCreativeRun(run: CreativeRunRecord, nextState: CreativePipelineState, now = new Date()): CreativeRunRecord {
  if (!CREATIVE_TRANSITIONS[run.state].includes(nextState)) throw new Error(`Invalid CreativeRun transition: ${run.state} -> ${nextState}`);
  return { ...run, state: nextState, updatedAt: now.toISOString(), ...(nextState === "review" || nextState === "needs_review" ? { reviewedAt: now.toISOString() } : {}) };
}

/** Persist the copy-stage checkpoint synchronously before the provider request is awaited. */
export function persistCreativeCopyAttempt(run: CreativeRunRecord, persist: (run: CreativeRunRecord) => void, now = new Date()): CreativeRunRecord {
  const copyRun = transitionCreativeRun(run, "copy", now);
  persist(copyRun);
  return copyRun;
}

export async function runCreativeCopyAttempt<T>(run: CreativeRunRecord, persist: (run: CreativeRunRecord) => void, generate: (run: CreativeRunRecord) => Promise<T>, now = new Date()): Promise<{ run: CreativeRunRecord; result: T }> {
  const copyRun = persistCreativeCopyAttempt(run, persist, now);
  const result = await generate(copyRun);
  return { run: copyRun, result };
}

export function safeCreativeRunError(error: unknown, namespace: "CREATIVE_COPY_FAILED" | "CREATIVE_GENERATION_FAILED"): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const safeCode = raw.toUpperCase().match(/[A-Z][A-Z0-9_]{2,}/g)?.find((candidate) => candidate.includes("_") && candidate.length <= 80);
  return `${namespace}:${safeCode ?? "PROVIDER_ERROR"}`;
}

export function retryCreativeRun(run: CreativeRunRecord, now = new Date()): CreativeRunRecord {
  if (run.mediaOwnershipReconciliation) throw new Error("MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED");
  if (run.state !== "failed") throw new Error(`CreativeRun retry requires failed state: ${run.state}`);
  return createCreativeRun({ id: run.id, brandId: run.brandId, topic: run.topic, imageProvider: run.imageProvider ?? "local_preview", videoProvider: run.videoProvider, now, platform: run.platform, targetPageId: run.targetPageId, automationKey: run.automationKey, mediaAssetId: run.mediaAssetId, mediaProvenance: run.mediaProvenance, strategySnapshot: run.strategySnapshot, strategyVersion: run.strategyVersion, generationIdempotencyKey: run.generationIdempotencyKey, assetOperation: run.assetOperation });
}

export interface AutomationPersistenceState {
  schemaVersion: 1;
  brandPlans: BrandAutomationPlan[];
  mediaAssets: MediaInventoryRecord[];
  reservations: MediaReservation[];
  creativeRuns: CreativeRunRecord[];
  imageProvider?: ImageProvider;
  videoProvider?: VideoProvider;
  automationAI?: import("./automationPlanner").AutomationAIPreference;
}

export type ImageProvider = "google_flow" | "vertex_ai" | "local_preview";
export type VideoProvider = "veo" | "runway" | "local_upload";
export const VIDEO_PROVIDER_CAPABILITIES: Record<VideoProvider, { label: string; configured: boolean; live: boolean; mode: "official_api" | "review_only" }> = {
  veo: { label: "Google Veo · official provider", configured: false, live: false, mode: "official_api" },
  runway: { label: "Runway · official provider", configured: false, live: false, mode: "official_api" },
  local_upload: { label: "Existing video asset · review only", configured: true, live: false, mode: "review_only" },
};
export function canUseVideoProvider(provider: VideoProvider, config: { configured?: boolean; officialApiVerified?: boolean; managedBrowserSession?: boolean; signalFlowSessionVerified?: boolean } = {}): { label: string; configured: boolean; live: boolean; allowed: boolean; reason?: string } {
  const base = VIDEO_PROVIDER_CAPABILITIES[provider];
  if (provider === "local_upload") return { ...base, allowed: true, reason: "Use a verified existing video asset; no generation provider call is made." };
  if (provider === "veo" && config.managedBrowserSession === true && config.signalFlowSessionVerified === true) return { ...base, label: "Google Flow / Veo · SignalFlow-managed Chromium", configured: true, live: true, allowed: true, reason: "Google Flow/Veo session verified; generation stays on the explicit app-owned browser route." };
  const configured = config.configured === true;
  const live = configured && config.officialApiVerified === true;
  return { ...base, configured, live, allowed: live, reason: live ? undefined : "Video provider requires a configured and operator-verified official API route." };
}
export interface ImageProviderCapability { label: string; configured: boolean; live: boolean; mode: "browser_assisted" | "official_api" | "deterministic_local"; }
export const IMAGE_PROVIDER_CAPABILITIES: Record<ImageProvider, ImageProviderCapability> = {
  google_flow: { label: "Google Flow · managed browser", configured: false, live: false, mode: "browser_assisted" },
  vertex_ai: { label: "Vertex AI · .env credential file", configured: false, live: false, mode: "official_api" },
  local_preview: { label: "Deterministic local preview", configured: true, live: false, mode: "deterministic_local" },
};

export interface ImageProviderVerificationConfig { managedBrowserSession?: boolean; projectId?: string; nativeSecureStore?: boolean; signalFlowSessionVerified?: boolean; officialApiVerified?: boolean; }

export function canUseImageProvider(provider: ImageProvider, config: ImageProviderVerificationConfig): ImageProviderCapability & { allowed: boolean; reason?: string } {
  const capability = getImageProviderCapability(provider, config);
  if (provider === "local_preview") return { ...capability, allowed: true, live: false };
  if (provider === "google_flow" && config.managedBrowserSession !== true) return { ...capability, configured: false, live: false, allowed: false, reason: "Google Flow session is not available." };
  if (provider === "google_flow" && config.signalFlowSessionVerified !== true) return { ...capability, configured: false, live: false, allowed: false, reason: "Google Flow session is not verified." };
  if (provider === "vertex_ai" && config.officialApiVerified !== true) return { ...capability, configured: false, live: false, allowed: false, reason: "Vertex AI official API boundary is not verified." };
  return { ...capability, allowed: capability.configured && capability.live };
}

export function getImageProviderCapability(provider: ImageProvider, config: { managedBrowserSession?: boolean; projectId?: string; nativeSecureStore?: boolean }): ImageProviderCapability {
  const base = IMAGE_PROVIDER_CAPABILITIES[provider];
  if (provider === "google_flow") return { ...base, configured: config.managedBrowserSession === true, live: config.managedBrowserSession === true };
  if (provider === "vertex_ai") { const configured = Boolean(config.projectId?.trim() && config.nativeSecureStore === true); return { ...base, configured, live: configured }; }
  return base;
}
import type { MediaOwnershipReconciliationState } from "./contentRunMedia";
