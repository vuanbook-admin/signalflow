import { catalogForChannel, strategyCatalogFingerprint, validateStrategyCatalog, type BrandStrategyCatalog } from "./contentStrategy";
import type { SocialPlatform } from "./mvpContracts";

export type PresentationMediaKind = "Image" | "Video" | "Audio" | "Unknown";
export type PresentationMediaDistribution = "universal" | "facebook" | "instagram" | "tiktok" | "youtube";
export type RestoredMediaCardDistributionInput = { kind: PresentationMediaKind; registrationMode?: "seed" | "public_url" | "google_drive" | "generated"; providerFileId?: string; platform?: PresentationMediaDistribution; distribution?: PresentationMediaDistribution };
export type PresentationMediaStatus = "Local" | "Ready" | "Used" | "Failed" | "Needs public URL" | "Needs review";

export type PresentationMediaAsset = {
  name?: string;
  kind: PresentationMediaKind;
  status: PresentationMediaStatus;
  duplicateStatus?: "unknown" | "unique" | "duplicate";
  duplicateKind?: "exact" | "near";
  duplicateReason?: string;
  usageStatus?: "available" | "reserved" | "used";
  usedReason?: string;
  reservedReason?: string;
  publicUrl?: string;
  publicUrlVerified?: boolean;
  distribution?: PresentationMediaDistribution;
  checksum?: string;
  visualFingerprint?: string;
  visualFingerprintSource?: "decoded_image" | "decoded_video_frames";
};

export type MediaStateBadge = { label: string; tone: "positive" | "warning" | "danger" | "neutral" };

export type StrategyCatalogUiProjection = {
  channel: SocialPlatform;
  catalog: BrandStrategyCatalog;
  fingerprint: string;
  disabledObjectiveKeys: string[];
  disabledPillarIds: string[];
  disabledAngleIds: string[];
  addedPillarIds: string[];
  addedAngleIds: string[];
};

export function projectStrategyCatalogForUi(catalog: BrandStrategyCatalog, channel: SocialPlatform): StrategyCatalogUiProjection {
  const validation = validateStrategyCatalog(catalog);
  if (!validation.ok) throw new Error("STRATEGY_CATALOG_INVALID");
  const projectedCatalog = structuredClone(catalogForChannel(catalog, channel));
  const override = catalog.channelOverrides[channel] ?? {};
  const sorted = (values: readonly string[] | undefined) => [...(values ?? [])].sort();
  return {
    channel,
    catalog: projectedCatalog,
    fingerprint: strategyCatalogFingerprint(projectedCatalog),
    disabledObjectiveKeys: sorted(override.disabledObjectiveKeys),
    disabledPillarIds: sorted(override.disabledPillarIds),
    disabledAngleIds: sorted(override.disabledAngleIds),
    addedPillarIds: (override.addedPillars ?? []).map((pillar) => pillar.id).sort(),
    addedAngleIds: Object.values(override.addedAnglesByPillarId ?? {}).flatMap((angles) => angles.map((angle) => angle.id)).sort(),
  };
}

export const GENERATED_MEDIA_HOSTING_NEXT_ACTION = "Next: Upload to Drive → Make link public → Review metadata.";

export function mediaDistributionLabel(distribution: PresentationMediaDistribution | undefined, fallback: string): string {
  if (distribution === "universal") return "Universal media · reusable across enabled channels";
  if (distribution) return `${distribution[0].toUpperCase()}${distribution.slice(1)}-scoped media`;
  return fallback;
}

export function hydrateRestoredMediaCardDistribution<T extends RestoredMediaCardDistributionInput>(asset: T): T {
  if (asset.distribution) return asset;
  if (asset.registrationMode === "generated") return asset.platform ? { ...asset, distribution: asset.platform } : asset;
  if (asset.kind === "Image" || asset.kind === "Video") return { ...asset, distribution: "universal" };
  return asset;
}

export function generatedMediaHostingNextAction(input: { provenanceSource?: unknown; publicUrl?: string; publicUrlVerified?: boolean }): string | undefined {
  if (input.provenanceSource !== "generated" || input.publicUrlVerified === true || Boolean(input.publicUrl)) return undefined;
  return GENERATED_MEDIA_HOSTING_NEXT_ACTION;
}

const VISUAL_KINDS = new Set<PresentationMediaKind>(["Image", "Video"]);

export function mediaBlockers(asset: PresentationMediaAsset): string[] {
  if (!VISUAL_KINDS.has(asset.kind)) return ["Not a visual social-post asset"];
  const blockers: string[] = [];
  if (asset.duplicateStatus === "duplicate") blockers.push(`${asset.duplicateKind === "near" ? "Near duplicate" : "Duplicate"} · ${asset.duplicateReason ?? "matching content"}`);
  if (asset.usageStatus === "used" || asset.status === "Used") blockers.push(`Used · ${asset.usedReason ?? "already consumed"}`);
  else if (asset.usageStatus === "reserved") blockers.push(`Reserved · ${asset.reservedReason ?? "active reservation"}`);
  if (!asset.publicUrl) blockers.push("Public link required");
  if (asset.publicUrlVerified !== true) blockers.push("Public link not verified");
  if (!asset.checksum) blockers.push("SHA-256 not verified");
  if (asset.visualFingerprint && !asset.visualFingerprintSource) blockers.push("Decoded fingerprint provenance missing; re-analyze local pixels");
  else if (!asset.visualFingerprint) blockers.push("Visual fingerprint not available");
  if (asset.status !== "Ready") blockers.push("Review gates incomplete");
  return blockers;
}

export function summarizeMediaAssets(assets: PresentationMediaAsset[]) {
  const working = assets.filter((asset) => VISUAL_KINDS.has(asset.kind));
  const eligible = working.filter((asset) => mediaBlockers(asset).length === 0).length;
  return {
    total: assets.length,
    working: working.length,
    eligible,
    blocked: working.length - eligible,
    used: working.filter((asset) => asset.usageStatus === "used" || asset.status === "Used").length,
    reserved: working.filter((asset) => asset.usageStatus === "reserved").length,
    duplicates: working.filter((asset) => asset.duplicateStatus === "duplicate" && asset.duplicateKind !== "near").length,
    nearDuplicates: working.filter((asset) => asset.duplicateStatus === "duplicate" && asset.duplicateKind === "near").length,
    publicVerified: working.filter((asset) => asset.publicUrlVerified === true).length,
    shaVerified: working.filter((asset) => Boolean(asset.checksum)).length,
    fingerprintVerified: working.filter((asset) => Boolean(asset.visualFingerprint)).length,
  };
}

export function mediaStateBadges(asset: PresentationMediaAsset): MediaStateBadge[] {
  const badges: MediaStateBadge[] = [];
  if (asset.duplicateStatus === "duplicate") badges.push({ label: asset.duplicateKind === "near" ? "Near duplicate" : "Duplicate", tone: "danger" });
  else if (asset.duplicateStatus === "unique") badges.push({ label: "Unique", tone: "positive" });
  else badges.push({ label: "Duplicate check pending", tone: "neutral" });

  if (asset.usageStatus === "used" || asset.status === "Used") badges.push({ label: "Used", tone: "danger" });
  else if (asset.usageStatus === "reserved") badges.push({ label: "Reserved", tone: "warning" });
  else badges.push({ label: "Available", tone: "positive" });

  badges.push({ label: asset.publicUrlVerified === true ? "Public verified" : asset.publicUrl ? "Public unverified" : "Public missing", tone: asset.publicUrlVerified === true ? "positive" : "warning" });
  badges.push({ label: asset.checksum ? "SHA verified" : "SHA missing", tone: asset.checksum ? "positive" : "warning" });
  badges.push({ label: asset.visualFingerprint && asset.visualFingerprintSource ? "Fingerprint verified" : asset.visualFingerprint ? "Fingerprint source missing" : "Fingerprint missing", tone: asset.visualFingerprint && asset.visualFingerprintSource ? "positive" : "warning" });
  return badges;
}

export function plannerAssetFilter(asset: PresentationMediaAsset): boolean {
  return VISUAL_KINDS.has(asset.kind);
}

export function plannerAssetBlockerSummary(assets: PresentationMediaAsset[]) {
  return assets.filter((asset) => mediaBlockers(asset).length > 0).map((asset) => ({ name: asset.name ?? "Unnamed asset", blockers: mediaBlockers(asset) }));
}

export function resolveTargetDisplayName(identifier: string | undefined, names: Readonly<Record<string, string>>, fallback = "Social target"): string {
  if (!identifier) return fallback;
  const usable = (value: string | undefined) => {
    const normalized = value?.trim() ?? "";
    return Boolean(normalized) && !/^\d+$/.test(normalized) && !/^(meta-page-|binding-|connection-)/i.test(normalized);
  };
  const direct = names[identifier]?.trim();
  if (usable(direct)) return direct!;
  const externalId = identifier.startsWith("meta-page-") ? identifier.slice("meta-page-".length) : identifier;
  const external = names[externalId]?.trim();
  return usable(external) ? external! : (identifier.startsWith("meta-page-") ? "Facebook Page" : fallback);
}

export function resolveDraftTargetTime(time: string | undefined, targetIdentifier: string | undefined, names: Readonly<Record<string, string>>): string {
  const value = time?.trim() ?? "";
  if (!value) return "Not scheduled";
  const parts = value.split(" · ");
  if (parts[0] === "Planner" && parts.length >= 3) return `${parts[0]} · ${parts[1]} · ${targetIdentifier ? resolveTargetDisplayName(targetIdentifier, names, "Facebook Page") : "Facebook Page"}`;
  return value;
}

export type DraftPublishState = {
  id: number | string; clientId: string; brandId: string; contentRunId?: string; status: string;
  qualityStatus?: string; approvalState?: string; pendingPublicationIds?: readonly string[];
};
export type DraftPublishTarget = {
  id?: string; clientId: string; brandId: string; contentRunId?: string; variantId?: string; state?: string;
  commandStatus?: string; pendingCommandId?: string; workerAckState?: string; providerJobId?: string;
};

export type PublishCommandOutcome = { status: "success" | "pending" | "failure"; code: "LIVE_PROVIDER_ACKNOWLEDGED" | "PROVIDER_CONFIRMATION_PENDING" | "PUBLISH_COMMAND_BLOCKED" | "TARGET_PUBLICATION_SIMULATION_REMOVED" | "LEGACY_NON_LIVE_ACTION_BLOCKED"; message: string };
export type PublishCommandInput = { commandStatus?: string; workerAckState?: string; providerAck?: boolean; providerJobId?: string; state?: string; simulation?: boolean; legacyNonLive?: boolean };

export function publishCommandOutcome(input: PublishCommandInput): PublishCommandOutcome {
  if (input.simulation === true) return { status: "failure", code: "TARGET_PUBLICATION_SIMULATION_REMOVED", message: "Publish blocked: this target record is retired and cannot run as a live job." };
  if (input.legacyNonLive === true) return { status: "failure", code: "LEGACY_NON_LIVE_ACTION_BLOCKED", message: "Publish blocked: migrated non-live target jobs are read-only." };
  const providerConfirmed = input.providerAck === true || input.state === "published" && Boolean(input.providerJobId?.trim());
  if (providerConfirmed) return { status: "success", code: "LIVE_PROVIDER_ACKNOWLEDGED", message: "Live provider confirmed Published for the selected target." };
  const commandAcknowledged = input.commandStatus === "acknowledged" && ["acknowledged", "confirmed", "accepted"].includes(input.workerAckState ?? "");
  if (commandAcknowledged) return { status: "pending", code: "PROVIDER_CONFIRMATION_PENDING", message: "Control Plane and worker acknowledged the target command; waiting for provider confirmation before reporting Published." };
  return { status: "failure", code: "PUBLISH_COMMAND_BLOCKED", message: "Publish blocked: live provider acknowledgement is missing. Reconcile the target before retrying." };
}

export type TargetActionSelectionPrompt = { action: "publish_now" | "reschedule" | "cancel"; scopeKey: string };

export function targetActionSelectionOutcome(prompt: TargetActionSelectionPrompt | undefined, jobId: string): { clearSelection: true; command: { action: TargetActionSelectionPrompt["action"]; jobId: string } | undefined } {
  return { clearSelection: true, command: prompt && jobId ? { action: prompt.action, jobId } : undefined };
}

export function closeTargetActionPromptOutcome(prompt: TargetActionSelectionPrompt | undefined, clearFeedback = true): { prompt: undefined; jobId: ""; clearPublishFeedback: boolean } {
  return { prompt: undefined, jobId: "", clearPublishFeedback: clearFeedback && prompt?.action === "publish_now" };
}

export function targetActionModalFocusTarget(key: string, shiftKey: boolean, activeIndex: number, focusableCount: number, dialogFocused = false): "first" | "last" | undefined {
  if (key !== "Tab" || focusableCount < 1) return undefined;
  if (shiftKey && (dialogFocused || activeIndex === 0)) return "last";
  if (!shiftKey && (dialogFocused || activeIndex === focusableCount - 1)) return "first";
  return undefined;
}

export function draftPublishBlocker(draft: DraftPublishState, publications: readonly DraftPublishTarget[], targetPublicationId?: string): string | undefined {
  const variantId = `variant-${draft.id}`;
  const allTargets = publications.filter((publication) => publication.clientId === draft.clientId && publication.brandId === draft.brandId
    && (draft.contentRunId ? publication.contentRunId === draft.contentRunId : publication.variantId === variantId));
  const targets = targetPublicationId ? allTargets.filter((target) => target.id === targetPublicationId) : allTargets;
  const isPending = (target: DraftPublishTarget) => Boolean(target.pendingCommandId || ["pending", "unknown"].includes(target.commandStatus ?? "") || ["pending", "unknown", "reconciliation_required"].includes(target.workerAckState ?? "") || ["pending", "unknown", "reconciliation_required"].includes(target.state ?? ""));
  const isProviderConfirmed = (target: DraftPublishTarget) => target.state === "published" && Boolean(target.providerJobId);
  const isAcknowledgedScheduled = (target: DraftPublishTarget) => target.state === "scheduled" && target.commandStatus === "acknowledged" && !target.pendingCommandId
    && ["acknowledged", "confirmed", "accepted"].includes(target.workerAckState ?? "");
  const isLiveAcknowledgedScheduled = isAcknowledgedScheduled;
  if (targetPublicationId && targets.length === 0) return "Publish blocked: selected target is not part of this Content Run.";
  if (targetPublicationId && draft.pendingPublicationIds?.includes(targetPublicationId)) return "Publish blocked: selected target is pending Control Plane/worker reconciliation.";
  if (targetPublicationId && targets.some(isPending)) return "Publish blocked: selected target is pending Control Plane/worker reconciliation.";
  if (targetPublicationId && targets.some(isProviderConfirmed)) return "Already published: provider confirmation is recorded for this target.";
  if (draft.qualityStatus !== "passed") return "Publish blocked: Quality check must pass first.";
  if (targetPublicationId) {
    if (targets.some(isAcknowledgedScheduled)) return undefined;
    return "Publish blocked: selected target has no acknowledged scheduled job.";
  }
  if (allTargets.length > 0 && allTargets.every(isProviderConfirmed)) return "Already published: provider confirmation is recorded for every target.";
  if (draft.status === "Published" && !allTargets.some((target) => target.state === "scheduled" && target.commandStatus === "acknowledged")) return "Publish blocked: provider confirmation is missing; reconcile the Control Plane state first.";
  const approved = draft.status === "Scheduled" || ["ready", "scheduled", "published"].includes(draft.approvalState ?? "");
  if (!approved) return "Publish blocked: the draft must be approved and scheduled first.";
  if (allTargets.some(isLiveAcknowledgedScheduled)) return undefined;
  if (draft.pendingPublicationIds?.length || allTargets.some(isPending)) return "Publish blocked: Control Plane or worker acknowledgement is pending reconciliation.";
  if (allTargets.length === 0) return "Publish blocked: no acknowledged target job is available.";
  return "Publish blocked: no acknowledged target job is available.";
}

export function shouldOpenRowFromKey(key: string, target: unknown, currentTarget: unknown): boolean {
  if (key !== "Enter" && key !== " ") return false;
  if (target === currentTarget) return true;
  const element = target as { closest?: (selector: string) => unknown } | null;
  if (typeof element?.closest !== "function") return Boolean(target);
  return !element.closest('button, a[href], input, select, textarea, summary, [role="button"], [role="menuitem"], [contenteditable="true"]');
}
