import { useEffect, useMemo, useRef, useState } from "react";
import { localMediaPreviewUrl, localMediaThumbnailUrl } from "./lib/mediaAssets";
import { BetterContentIcon, BetterMetricIcon, BetterPlatformIcon, type BetterContentIconName, type BetterPlatformIconName } from "./lib/betterIcons";
import { COMPOSER_MEDIA_LIMIT, moveComposerMediaSelection, setComposerMediaRole, toggleComposerMediaSelection, type ComposerMediaRole, type ComposerMediaSelection } from "./lib/mediaSelection";
import { validateContentIntelligenceSelection, type ContentIntelligenceLineage, type ContentIntelligenceSelectionIssue, type KnowledgeItem, type PromptBlueprint, type ResearchEvidence } from "./lib/contentIntelligence";
import type { ContentRecipe } from "./lib/contentRecipe";
import type { ContentTransformMode } from "./lib/contentTransform";
import type { StrategySnapshot } from "./lib/contentStrategy";
import type { AssetPromptFormat } from "./lib/contentStrategyPrompt";

export type RevoDraftStatus = "Needs review" | "Scheduled" | "Published" | "Failed";
export type RevoObjective = "Reach" | "Engagement" | "Education" | "Knowledge" | "Conversion";
export type RevoMediaOperation = {
  kind: "image" | "video";
  status: "idle" | "running" | "completed" | "blocked" | "failed";
  provider?: string;
  reason?: string;
  createdAt?: string;
};
export type RevoVideoProvider = "local_upload" | "veo" | "runway";

export type RevoStudioDraft = {
  id: number;
  title: string;
  topic?: string;
  platform: "Facebook" | "Instagram" | "TikTok" | "YouTube";
  status: RevoDraftStatus;
  time: string;
  tag: string;
  tone: string;
  color: string;
  body?: string;
  contentPillar?: string;
  contentAngle?: string;
  objective?: RevoObjective | "";
  strategyVersion?: number;
  catalogFingerprint?: string;
  strategySnapshot?: StrategySnapshot;
  regenerationState?: "clean" | "needs_regeneration";
  strategyState?: "clean" | "needs_regeneration";
  cta?: string;
  hashtags?: string[];
  seoKeywords?: string[];
  scheduledAt?: string;
  sources?: string[];
  notes?: string;
  mediaUrl?: string;
  mediaPreviewUrl?: string;
  mediaThumbnailUrl?: string;
  mediaKind?: "image" | "video";
  contentKind?: string;
  mediaAssetIds?: string[];
  mediaOperation?: RevoMediaOperation;
  mediaOperations?: RevoMediaOperation[];
  videoProvider?: string;
  qualityStatus?: "pending" | "passed" | "failed";
  qualityChecks?: Array<{ key: string; label: string; ok: boolean; message?: string }>;
  approvalState?: "proposed" | "ready" | "scheduled" | "publishing" | "published" | "failed";
  pendingPublicationIds?: string[];
  telegramState?: "not_sent" | "prepared" | "sent" | "blocked";
  telegramPreparedAt?: string;
  strategyRationale?: string;
  imageConcept?: string;
  imagePrompt?: string;
  videoConcept?: string;
  videoPrompt?: string;
  visualConcept?: string;
  visualPrompt?: string;
  researchState?: "VERIFIED" | "REVIEW" | "NOT_SELECTED";
  researchSourceCount?: number;
  researchScore?: number;
  bindingIds?: string[];
  targetPageId?: string;
  providerTraceId?: string;
  rewriteStatus?: "idle" | "generating" | "failed" | "unknown" | "ready_for_review";
  rewriteError?: string;
  requestId?: string;
  revisionId?: string;
  parentRevisionId?: string;
  revisionHistory?: Array<{ id: string; title: string; body: string; createdAt: string; providerTraceId?: string; requestId?: string; parentRevisionId?: string; revisionId?: string }>;
  mediaEvidence?: Array<{ assetId: string; sha256?: string; mimeType?: string; order: number; role: "publish" | "reference"; uploadState: "pending" | "processed" | "failed"; attachmentBoundary?: string }>;
  selectedKnowledgeItemIds?: string[];
  selectedResearchEvidenceIds?: string[];
  promptBlueprintId?: string;
  promptBlueprintVersion?: number;
  recipeId?: string;
  transformMode?: ContentTransformMode;
  sourceRef?: string;
  mediaSetFingerprint?: string;
  customerFacts?: string[];
  prompt?: string;
  contentIntelligenceLineage?: ContentIntelligenceLineage;
};

export type RevoDraftPatch = Partial<Pick<RevoStudioDraft, "title" | "topic" | "body" | "contentPillar" | "contentAngle" | "objective" | "cta" | "hashtags" | "seoKeywords" | "scheduledAt" | "sources" | "notes" | "regenerationState" | "strategyState">> & { restoreRevisionId?: string };

type Props = {
  drafts: RevoStudioDraft[];
  clientName: string;
  brandName: string;
  targetSummary?: string;
  initialFilter?: RevoContentFilter;
  onOpenComposer: () => void;
  inlineGenerating?: boolean;
  generationError?: string;
  focusDraftId?: number;
  onOpenReview?: () => void;
  onRefresh?: () => void | Promise<void>;
  onUpdateDraft: (id: number, patch: RevoDraftPatch) => void | Promise<void>;
  onQualityCheck: (id: number) => Promise<DraftActionOutcome>;
  onGenerateMedia: (id: number, kind: "image" | "video") => void | Promise<void>;
  onApprove: (id: number) => Promise<DraftActionOutcome>;
  onReject: (id: number) => void;
  onCopy: (id: number) => void | Promise<void>;
  onExport: (id: number) => void;
  onPublish: (id: number) => Promise<DraftActionOutcome>;
  actionFeedbackByDraftId?: Record<number, Partial<Record<DraftActionKind, DraftActionFeedback>>>;
  publishBlockersByDraftId?: Record<number, string | undefined>;
  canApprove?: boolean;
  onActiveActionDraftChange?: (draftId: number | undefined) => void;
  onTelegram: (id: number) => void | Promise<void>;
  onRegenerate: (id: number) => void | Promise<void>;
  onRestoreRevision?: (id: number, revisionId: string) => void | Promise<void>;
  videoProvider: RevoVideoProvider;
  onVideoProviderChange: (provider: RevoVideoProvider) => void;
};

type Filter = "all" | "review" | "ready" | "published";
export type RevoContentFilter = Filter;
export type DraftActionOutcome = { status: "success" | "pending" | "failure"; message: string; pendingReason?: "selection" | "reconciliation" };
export type DraftActionKind = "quality" | "approval" | "publish";
export type DraftActionFeedback = { status: "running" | DraftActionOutcome["status"]; message: string; pendingReason?: DraftActionOutcome["pendingReason"] };

const revoPlatformIcons: Record<RevoNewContentInput["selectedPlatforms"][number], BetterPlatformIconName> = { Facebook: "facebook", Instagram: "instagram", TikTok: "tiktok", YouTube: "youtube" };

export type RevoNewContentInput = {
  autoGenerate?: boolean;
  topic: string;
  contentPillar: string;
  contentAngle?: string;
  objective: RevoObjective | "";
  format?: AssetPromptFormat;
  caption: string;
  cta: string;
  hashtags: string;
  seoKeywords: string;
  scheduledAt: string;
  sources: string;
  notes: string;
  aiProvider: "openai" | "gemini";
  aiMode: "api" | "manual_assisted" | "web_subscription";
  selectedPlatforms: Array<"Facebook" | "Instagram" | "TikTok" | "YouTube">;
  composerAssetId: string | number | "";
  composerAssetIds?: Array<string | number>;
  composerMediaManifest?: ComposerMediaSelection[];
};

export type ContentIntelligenceSelectionSummary = {
  knowledgeItems: Array<{ id: string; title: string }>;
  researchEvidence: Array<{ id: string; title: string }>;
  promptBlueprint?: { id: string; label: string };
  contentRecipe?: { id: string; name: string };
  transformMode: ContentTransformMode;
  issues: ContentIntelligenceSelectionIssue[];
};

export function summarizeContentIntelligenceSelection(input: {
  clientId: string;
  brandId: string;
  knowledgeItems: Array<Pick<KnowledgeItem, "id" | "clientId" | "brandId" | "kind" | "title" | "contentHash" | "provenance" | "rightsState" | "reviewState" | "text" | "sourceUpdatedAt" | "archiveState">>;
  researchEvidence: Array<Pick<ResearchEvidence, "id" | "clientId" | "brandId" | "sourceUrl" | "sourceTitle" | "retrievedAt" | "summary" | "rightsState" | "reviewState"> & { archiveState?: "active" | "archived" }>;
  promptBlueprints: Array<Pick<PromptBlueprint, "id" | "brandId" | "kind" | "version" | "status">>;
  contentRecipes: Array<Pick<ContentRecipe, "id" | "brandId" | "name" | "status">>;
  selectedKnowledgeItemIds: string[];
  selectedResearchEvidenceIds: string[];
  selectedPromptBlueprintId: string;
  selectedRecipeId?: string;
  transformMode: ContentTransformMode;
}): ContentIntelligenceSelectionSummary {
  const selection = validateContentIntelligenceSelection({
    scope: { clientId: input.clientId, brandId: input.brandId },
    knowledgeItems: input.knowledgeItems,
    selectedKnowledgeItemIds: input.selectedKnowledgeItemIds,
    researchEvidence: input.researchEvidence,
    selectedResearchEvidenceIds: input.selectedResearchEvidenceIds,
    promptBlueprints: input.promptBlueprints,
    selectedPromptBlueprintId: input.selectedPromptBlueprintId,
    contentRecipes: input.contentRecipes,
    selectedRecipeId: input.selectedRecipeId,
  });
  const knowledgeItems = selection.selectedKnowledgeItems.map((item) => ({ id: item.id, title: item.title }));
  const researchEvidence = selection.selectedResearchEvidence.map((item) => ({ id: item.id, title: item.sourceTitle }));
  const blueprint = selection.selectedPromptBlueprint;
  const recipe = selection.selectedRecipe;
  return {
    knowledgeItems,
    researchEvidence,
    ...(blueprint ? { promptBlueprint: { id: blueprint.id, label: `${blueprint.id} · ${blueprint.kind} v${blueprint.version}` } } : {}),
    ...(recipe ? { contentRecipe: { id: recipe.id, name: recipe.name } } : {}),
    transformMode: input.transformMode,
    issues: selection.issues,
  };
}

type ContentIntelligenceSelectionInput = Parameters<typeof summarizeContentIntelligenceSelection>[0];
type RevoNewContentModalProps = {
  visible: boolean;
  brandName: string;
  clientName: string;
  assets: Array<{ id: string | number; clientId?: string; brandId?: string; name: string; kind: "Image" | "Video" | "Audio" | "Unknown"; status: string; publicUrl?: string; localAssetPath?: string; mimeType?: string; checksum?: string; archiveState?: "active" | "archived" }>;
  generationError: string;
  isGenerating: boolean;
  mediaImportBusy?: boolean;
  mediaImportNotice?: string;
  onClose: (event?: RevoComposerCloseEvent) => void;
  onSubmit: (input: RevoNewContentInput) => void | Promise<void>;
  onImportLocalImage: (file: File) => void | Promise<void>;
  activeClientId: string;
  activeBrandId: string;
  openerRef?: { current: RevoComposerFocusTarget | null };
  fallbackRef?: { current: RevoComposerFocusTarget | null };
} & Omit<ContentIntelligenceSelectionInput, "clientId" | "brandId">;

export type RevoComposerCloseReason = "cancel" | "escape" | "backdrop" | "close";
export type RevoComposerCloseEvent = { reason: RevoComposerCloseReason; pending: boolean };
export type RevoComposerFocusTarget = { isConnected?: boolean; focus: () => void };
export type RevoComposerDialogFocus = { focusable: readonly RevoComposerFocusTarget[]; activeElement: RevoComposerFocusTarget | null; focus: () => void };

export function createRevoComposerModalController(input: {
  isVisible: () => boolean;
  isGenerating: () => boolean;
  getForm: () => RevoNewContentInput;
  onSubmit: (form: RevoNewContentInput) => void | Promise<void>;
  onClose: (event: RevoComposerCloseEvent) => void;
  openerRef: { current: RevoComposerFocusTarget | null };
  fallbackRef?: { current: RevoComposerFocusTarget | null };
  scheduleFocus?: (callback: () => void) => void;
}) {
  let submissionStarted = false;
  const scheduleFocus = input.scheduleFocus ?? ((callback) => callback());
  const focusReturnTarget = () => {
    const opener = input.openerRef.current;
    const fallback = input.fallbackRef?.current;
    const target = opener?.isConnected === false ? fallback : opener ?? fallback;
    input.openerRef.current = null;
    if (target) scheduleFocus(() => target.focus());
  };
  const close = (reason: RevoComposerCloseReason): boolean => {
    if (!input.isVisible()) return false;
    input.onClose({ reason, pending: input.isGenerating() || submissionStarted });
    focusReturnTarget();
    return true;
  };
  const submit = async (): Promise<void> => {
    if (!input.isVisible() || input.isGenerating() || submissionStarted) return;
    submissionStarted = true;
    try {
      await input.onSubmit(input.getForm());
    } finally {
      submissionStarted = false;
    }
  };
  const keyDown = (event: { key: string; shiftKey: boolean; preventDefault: () => void }, dialog: RevoComposerDialogFocus): boolean => {
    if (event.key === "Escape") {
      event.preventDefault();
      close("escape");
      return true;
    }
    if (event.key !== "Tab") return false;
    const first = dialog.focusable[0];
    const last = dialog.focusable[dialog.focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
      return true;
    }
    if (event.shiftKey && dialog.activeElement === first) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && dialog.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  };
  const backdropMouseDown = (event: { target: unknown; currentTarget: unknown }): boolean => {
    if (event.target !== event.currentTarget) return false;
    return close("backdrop");
  };
  return { close, submit, keyDown, backdropMouseDown };
}

function listValue(value: string[] | undefined, separator: string): string {
  return (value ?? []).join(separator);
}

function parseList(value: string, separator: RegExp): string[] {
  return value.split(separator).map((item) => item.trim()).filter(Boolean);
}

function selectionSummaryText(items: Array<{ id: string; title: string }>, issues: ContentIntelligenceSelectionIssue[] = []): string {
  const selected = items.length ? items.map((item) => `${item.title} [${item.id}]`).join(" · ") : "";
  const blocked = issues.length ? `Blocked selection: ${issues.map((issue) => `${issue.id} · ${issue.code}`).join("; ")}` : "";
  return [selected, blocked].filter(Boolean).join(" · ") || "None selected";
}

function localDateValue(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function readableDate(value: string | undefined): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function visualFor(draft: RevoStudioDraft): boolean {
  return Boolean(draft.mediaUrl || draft.mediaPreviewUrl || draft.mediaAssetIds?.length || draft.mediaOperation?.status === "completed");
}

function mediaKindFor(draft: RevoStudioDraft): "image" | "video" {
  const latestOperation = draft.mediaOperations?.[Math.max(0, draft.mediaOperations.length - 1)];
  return draft.contentKind === "video" || draft.contentKind === "short_video" || draft.contentKind === "long_video" || draft.mediaKind === "video" || draft.mediaOperation?.kind === "video" || latestOperation?.kind === "video" ? "video" : "image";
}

function readinessFor(draft: RevoStudioDraft): Array<{ key: string; label: string; ok: boolean; message: string }> {
  const persisted = draft.qualityChecks?.length ? draft.qualityChecks : undefined;
  if (persisted) return persisted.map((check) => ({ ...check, message: check.message ?? (check.ok ? "Passed" : "Needs attention") }));
  const body = draft.body?.trim() ?? "";
  const sources = draft.sources?.filter(Boolean) ?? [];
  return [
    { key: "hook", label: "Hook mở bài", ok: Boolean((draft.topic ?? draft.title).trim()), message: "Topic/hook exists" },
    { key: "caption", label: "Caption theo engine", ok: body.length >= 80, message: body.length >= 80 ? "Caption length is ready" : "Caption needs at least 80 characters" },
    { key: "cta", label: "CTA rõ ràng", ok: Boolean(draft.cta?.trim()), message: draft.cta?.trim() ? "CTA present" : "Add a CTA" },
    { key: "hashtags", label: "1–10 hashtag", ok: Boolean(draft.hashtags?.length && draft.hashtags.length <= 10), message: `${draft.hashtags?.length ?? 0} hashtag(s)` },
    { key: "visual", label: "Có visual", ok: visualFor(draft), message: visualFor(draft) ? "Visual attached" : "Generate or attach a visual" },
    { key: "playbook", label: "Marketing playbook", ok: true, message: "Brand playbook selected" },
    { key: "strategy", label: "Pillar + angle + mục tiêu", ok: Boolean(draft.contentPillar?.trim() && draft.objective && (!draft.strategySnapshot && draft.strategyVersion === undefined && !draft.contentAngle ? true : draft.contentAngle?.trim())), message: "Pillar, angle and objective" },
    { key: "format", label: "Format đúng engine", ok: Boolean(draft.platform), message: draft.strategySnapshot?.format ?? `${draft.platform} format` },
    { key: "sources", label: "Nguồn nếu factual", ok: sources.length > 0 || !/facts?|research|according|theo nghiên cứu/i.test(body), message: sources.length > 0 ? `${sources.length} source(s)` : "No factual source selected" },
    { key: "research", label: "Research Brief", ok: draft.researchState === "VERIFIED" || draft.researchState === "NOT_SELECTED", message: draft.researchState === "VERIFIED" ? "Verified" : draft.researchState === "REVIEW" ? "Review required" : "No research selected" },
  ];
}

function contentIconName(draft: Pick<RevoStudioDraft, "contentKind" | "mediaKind" | "tag" | "title">): BetterContentIconName {
  const descriptor = `${draft.contentKind ?? ""} ${draft.mediaKind ?? ""} ${draft.tag} ${draft.title}`.toLowerCase();
  if (/ai generated|generated by ai|ai draft/.test(`${draft.tag} ${draft.title}`.toLowerCase())) return "sparkles";
  if (/video|clip|reel|short video/.test(descriptor)) return "video";
  if (/image|photo|picture|ảnh/.test(descriptor)) return "image";
  return "sparkles";
}

function RevoIcon({ name }: { name: "refresh" | "sparkle" | "play" | "check" | "plus" }) {
  const paths = {
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.7 4L20 15"/><path d="M20 20v-5h-5"/></>,
    sparkle: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/><path d="m19 16 .6 2.1L22 19l-2.4.9L19 22l-.6-2.1L16 19l2.4-.9L19 16Z"/></>,
    play: <path d="m8 5 11 7-11 7V5Z"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  }[name];
  return <svg className="revo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
}

function stateFor(draft: RevoStudioDraft): string {
  if (draft.approvalState) return draft.approvalState;
  if (draft.status === "Scheduled") return "scheduled";
  if (draft.status === "Published") return "published";
  if (draft.status === "Failed") return "failed";
  return draft.qualityStatus === "passed" ? "ready" : "proposed";
}

function rewriteStatusFor(draft: RevoStudioDraft): string {
  if (draft.rewriteStatus === "generating") return "Đang tạo bản chữ mới…";
  if (draft.rewriteStatus === "unknown") return "Outcome chưa rõ · cần đối soát, không gửi lại tự động";
  if (draft.rewriteStatus === "failed") return `Làm lại thất bại${draft.rewriteError ? ` · ${draft.rewriteError}` : ""}`;
  if (draft.rewriteStatus === "ready_for_review") return "Bản chữ mới · cần duyệt lại";
  return "";
}

export function RevoContentStudio({ drafts, clientName, brandName, targetSummary, initialFilter, onOpenComposer, inlineGenerating = false, generationError = "", focusDraftId, onOpenReview, onRefresh, onUpdateDraft, onQualityCheck, onGenerateMedia, onApprove, onReject, onCopy, onExport, onPublish, actionFeedbackByDraftId = {}, publishBlockersByDraftId = {}, canApprove = true, onActiveActionDraftChange, onTelegram, onRegenerate, onRestoreRevision, videoProvider, onVideoProviderChange }: Props) {
  const [filter, setFilter] = useState<Filter>(initialFilter ?? "all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | undefined>(drafts[0]?.id);
  const [form, setForm] = useState<RevoDraftPatch>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(() => new Date());
  const [showGeneratedVariants, setShowGeneratedVariants] = useState(false);
  const generatedVariantsTriggerRef = useRef<HTMLButtonElement>(null);
  const generatedVariantsCloseRef = useRef<HTMLButtonElement>(null);
  const generatedVariantsDialogRef = useRef<HTMLElement>(null);
  const selected = drafts.find((draft) => draft.id === selectedId);
  const activeDraftChangeRef = useRef(onActiveActionDraftChange);
  activeDraftChangeRef.current = onActiveActionDraftChange;
  const closeGeneratedVariants = () => {
    setShowGeneratedVariants(false);
    window.requestAnimationFrame(() => { if (generatedVariantsTriggerRef.current?.isConnected) generatedVariantsTriggerRef.current.focus(); });
  };

  useEffect(() => { activeDraftChangeRef.current?.(selected?.id); }, [selected?.id]);
  useEffect(() => () => activeDraftChangeRef.current?.(undefined), []);

  useEffect(() => {
    if (!showGeneratedVariants) return;
    const frame = window.requestAnimationFrame(() => generatedVariantsCloseRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [showGeneratedVariants]);

  useEffect(() => {
    if (!selectedId || !drafts.some((draft) => draft.id === selectedId)) setSelectedId(drafts[0]?.id);
  }, [drafts, selectedId]);

  useEffect(() => {
    if (focusDraftId === undefined) return;
    setSelectedId(focusDraftId);
    setForm({});
    setDirty(false);
  }, [focusDraftId]);

  useEffect(() => {
    if (initialFilter) setFilter(initialFilter);
  }, [initialFilter]);

  useEffect(() => {
    if (!selected) {
      setForm({});
      setDirty(false);
      return;
    }
    setForm({ title: selected.title, topic: selected.topic ?? selected.title, body: selected.body ?? "", contentPillar: selected.contentPillar ?? selected.strategySnapshot?.pillarLabel ?? "", contentAngle: selected.contentAngle ?? selected.strategySnapshot?.angleLabel ?? "", objective: (selected.objective ?? selected.strategySnapshot?.objectiveLabel ?? "") as RevoObjective | "", regenerationState: selected.regenerationState ?? selected.strategyState ?? "clean", strategyState: selected.strategyState ?? selected.regenerationState ?? "clean", cta: selected.cta ?? "", hashtags: selected.hashtags ?? [], seoKeywords: selected.seoKeywords ?? [], scheduledAt: selected.scheduledAt ?? "", sources: selected.sources ?? [], notes: selected.notes ?? "" });
    setDirty(false);
  }, [selected?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLastRefreshAt(new Date());
      void onRefresh?.();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [onRefresh]);

  const visibleDrafts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return drafts.filter((draft) => {
      const ready = draft.qualityStatus === "passed" || draft.approvalState === "ready" || draft.status === "Scheduled";
      const statusMatch = filter === "all" || (filter === "review" && draft.status === "Needs review") || (filter === "ready" && ready) || (filter === "published" && draft.status === "Published");
      if (!statusMatch) return false;
      if (!normalizedQuery) return true;
      return [draft.title, draft.topic, draft.body, draft.contentPillar].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery);
    });
  }, [drafts, filter, query]);

  const counts = useMemo(() => ({ all: drafts.length, review: drafts.filter((draft) => draft.status === "Needs review").length, ready: drafts.filter((draft) => draft.qualityStatus === "passed" || draft.approvalState === "ready" || draft.status === "Scheduled").length, published: drafts.filter((draft) => draft.status === "Published").length }), [drafts]);
  const checks = selected ? readinessFor({ ...selected, ...form, title: form.title ?? selected.title, body: form.body ?? selected.body }) : [];
  const mediaOperations = selected?.mediaOperations ?? (selected?.mediaOperation ? [selected.mediaOperation] : []);
  const latestMediaOperation = mediaOperations[mediaOperations.length - 1];
  const qualityPassed = selected?.qualityStatus === "passed";
  const selectedFeedback = selected ? actionFeedbackByDraftId[selected.id] : undefined;
  const qualityBusy = selectedFeedback?.quality?.status === "running" || selectedFeedback?.quality?.status === "pending";
  const approvalFeedbackBusy = selectedFeedback?.approval?.status === "running" || selectedFeedback?.approval?.status === "pending";
  const pendingPublicationReconciliation = Boolean(selected?.pendingPublicationIds?.length);
  const approvalBusy = approvalFeedbackBusy || pendingPublicationReconciliation;
  const publishBusy = selectedFeedback?.publish?.status === "running" || selectedFeedback?.publish?.status === "pending";
  const actionLocked = qualityBusy || approvalBusy || publishBusy;
  const publishBlocker = selected ? publishBlockersByDraftId[selected.id] : undefined;
  const publishLocked = qualityBusy || approvalFeedbackBusy || publishBusy || (pendingPublicationReconciliation && Boolean(publishBlocker));
  const rewriteBusy = selected?.rewriteStatus === "generating" || selected?.rewriteStatus === "unknown" || inlineGenerating;
  const setField = <K extends keyof RevoDraftPatch>(key: K, value: RevoDraftPatch[K]) => {
    const strategyField = key === "contentPillar" || key === "contentAngle" || key === "objective";
    setForm((current) => ({ ...current, [key]: value, ...(strategyField ? { regenerationState: "needs_regeneration" as const, strategyState: "needs_regeneration" as const } : {}) }));
    setDirty(true);
  };
  const save = async () => {
    if (!selected || !dirty) return;
    setSaving(true);
    try {
      await onUpdateDraft(selected.id, { ...form, topic: form.topic?.trim(), title: (form.title ?? form.topic ?? selected.title).trim(), body: form.body?.trim(), cta: form.cta?.trim(), notes: form.notes?.trim() });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };
  const refresh = () => {
    setLastRefreshAt(new Date());
    void onRefresh?.();
  };

  return <section className="expanded-view revo-content-os" data-testid="revo-content-studio">
    <div className="revo-os-header">
      <div><p className="revo-eyebrow">{clientName} · {brandName} · CONTENT OS</p><h1>Trung tâm quản lý nội dung</h1><p>One selected post, one structured contract, one review-first workflow.</p></div>
      <div className="revo-header-actions"><span className="revo-sync-status"><RevoIcon name="refresh" /> Synced {lastRefreshAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span><button className="revo-secondary" onClick={refresh}><RevoIcon name="refresh" /> Làm mới</button><button className="revo-primary" disabled={inlineGenerating} onClick={() => onOpenComposer()}><RevoIcon name="sparkle" /> {inlineGenerating ? "Đang sinh…" : "Tạo content"}</button></div>
    </div>
    {inlineGenerating && <div className="revo-inline-notice" role="status">Đang sinh content và tự động điền các trường trong editor…</div>}
    {!inlineGenerating && generationError && <div className="revo-inline-notice error" role="alert">Không thể sinh content: {generationError}<button className="revo-inline-retry" onClick={() => onOpenComposer()}>Mở lại composer</button></div>}
    <div className="revo-context-strip" aria-label="Content workspace context"><span><b>Project</b>{clientName}</span><span><b>Channel</b>{brandName}</span><span><b>Target bindings</b>{targetSummary ?? "Not configured"}</span></div>
    <div className="revo-metrics" aria-label="Content OS metrics">
      <button ref={generatedVariantsTriggerRef} type="button" className="revo-metric" onClick={() => setShowGeneratedVariants(true)}><span>TỔNG NỘI DUNG</span><strong>{counts.all}</strong></button><button type="button" className="revo-metric" onClick={() => onOpenReview ? onOpenReview() : setFilter("review")}><span>CẦN DUYỆT</span><strong>{counts.review}</strong></button><div><span>SẴN SÀNG ĐĂNG</span><strong>{counts.ready}</strong></div><div><span>ĐÃ PHÁT HÀNH</span><strong>{counts.published}</strong></div><div><span>QUALITY PASSED</span><strong>{drafts.filter((draft) => draft.qualityStatus === "passed").length}</strong></div>
    </div>
    <div className="revo-layout">
      <aside className="revo-post-rail" aria-label="Content list">
        <div className="revo-rail-heading"><div><span className="revo-kicker">CONTENT QUEUE</span><strong>{visibleDrafts.length} bài viết</strong></div><button className="revo-icon-button" onClick={refresh} aria-label="Refresh content list"><RevoIcon name="refresh" /></button></div>
        <input className="revo-search" aria-label="Search content" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm topic, caption, pillar…" />
        <div className="revo-filter-tabs" role="tablist" aria-label="Content status filters">{([["all", "Tất cả"], ["review", "Duyệt"], ["ready", "Sẵn sàng"], ["published", "Đã đăng"]] as Array<[Filter, string]>).map(([key, label]) => <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? "selected" : ""} onClick={() => setFilter(key)}>{label}<span>{counts[key]}</span></button>)}</div>
        <div className="revo-post-list">{visibleDrafts.map((draft) => <button className={`revo-post-row ${selectedId === draft.id ? "selected" : ""}`} key={draft.id} onClick={() => setSelectedId(draft.id)}><span className="revo-post-glyph"><BetterContentIcon name={contentIconName(draft)} /></span><span className="revo-post-copy"><strong title={draft.title}>{draft.title}</strong><small>{draft.contentPillar ?? draft.tag} · {draft.platform}</small><em>{draft.status === "Needs review" ? "Duyệt" : draft.status === "Published" ? "Đã đăng" : draft.qualityStatus === "passed" ? "Sẵn sàng" : draft.status}</em></span></button>)}{visibleDrafts.length === 0 && <div className="revo-empty">Không có content phù hợp.</div>}</div>
      </aside>
      <main className="revo-editor-panel" aria-label="Selected content editor">
        {!selected ? <div className="revo-empty large">Chọn một content để mở detail editor.</div> : <>
          <div className="revo-editor-heading"><div><span className="revo-kicker">{selected.platform} · AI STUDIO</span><h2>{selected.title}</h2><small>{stateFor(selected)} · Quality {selected.qualityStatus ?? "pending"} · {selected.qualityChecks?.length ?? 0} checks persisted · {selected.providerTraceId ?? "provider trace pending"} · {selected.revisionHistory?.length ?? 0} bản cũ</small>{(selected.regenerationState === "needs_regeneration" || selected.strategyState === "needs_regeneration" || Boolean(dirty && ["contentPillar", "contentAngle", "objective"].some((field) => form[field as keyof RevoDraftPatch] !== selected[field as keyof RevoStudioDraft]))) && <small role="status">Needs regeneration · body và media được giữ nguyên cho tới khi bấm làm lại.</small>}{rewriteStatusFor(selected) && <small role={selected.rewriteStatus === "failed" ? "alert" : "status"}>{rewriteStatusFor(selected)}</small>}</div><span className={`revo-status ${selected.status.toLowerCase().replace(/\s+/g, "-")}`}>{selected.status}</span></div>
          <div className="revo-editor-form">
            <label>TOPIC / TITLE<input disabled={actionLocked} value={form.topic ?? ""} onChange={(event) => setField("topic", event.target.value)} /></label>
            <label>CONTENT PILLAR<input disabled={actionLocked} value={form.contentPillar ?? ""} onChange={(event) => setField("contentPillar", event.target.value)} placeholder="Resolved catalog pillar" /></label>
            <label>CONTENT ANGLE<input disabled={actionLocked} value={form.contentAngle ?? ""} onChange={(event) => setField("contentAngle", event.target.value)} placeholder="Resolved catalog angle" /></label>
            <label>OBJECTIVE<select disabled={actionLocked} value={form.objective ?? ""} onChange={(event) => setField("objective", event.target.value as RevoObjective)}><option value="">Auto · catalog resolves</option>{(["Reach", "Engagement", "Education", "Knowledge", "Conversion"] as RevoObjective[]).map((option) => <option value={option} key={option}>{option}</option>)}</select></label>
            <label>FORMAT<select disabled value={selected.strategySnapshot?.format ?? (selected.contentKind === "video" || selected.contentKind === "short_video" || selected.contentKind === "long_video" || selected.mediaKind === "video" ? "video" : selected.contentKind === "image" || selected.mediaKind === "image" ? "image" : "text")} aria-label="Format"><option value="text">text</option><option value="image">image</option><option value="video">video</option></select></label>
            <label className="revo-span-2">CAPTION<textarea disabled={actionLocked} value={form.body ?? ""} onChange={(event) => setField("body", event.target.value)} rows={8} /></label>
            <label>CTA<input disabled={actionLocked} value={form.cta ?? ""} onChange={(event) => setField("cta", event.target.value)} placeholder="Lưu lại để xem sau" /></label>
            <label>HASHTAGS<input disabled={actionLocked} value={listValue(form.hashtags, " ")} onChange={(event) => setField("hashtags", parseList(event.target.value, /[\s,]+/))} placeholder="#signalflow #contentos" /></label>
            <label>SEO KEYWORDS<input disabled={actionLocked} value={listValue(form.seoKeywords, ", ")} onChange={(event) => setField("seoKeywords", parseList(event.target.value, /[,\n]+/))} placeholder="automation, content operations" /></label>
            <label>SCHEDULED AT<input disabled={actionLocked} type="datetime-local" value={localDateValue(form.scheduledAt)} onChange={(event) => setField("scheduledAt", event.target.value ? new Date(event.target.value).toISOString() : "")} /></label>
            <label className="revo-span-2">SOURCES / RESEARCH BRIEF<textarea disabled={actionLocked} value={(form.sources ?? []).join("\n")} onChange={(event) => setField("sources", parseList(event.target.value, /[\n]+/))} rows={3} placeholder="One source URL per line" /></label>
            <label className="revo-span-2">INTERNAL NOTES<textarea disabled={actionLocked} value={form.notes ?? ""} onChange={(event) => setField("notes", event.target.value)} rows={3} /></label>
          </div>
          <div className="revo-editor-actions"><button className="revo-primary" disabled={!dirty || saving || actionLocked} onClick={() => void save()}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</button><button className="revo-secondary" disabled={saving} onClick={() => void onCopy(selected.id)}>Copy để đăng tay</button><button className="revo-secondary" disabled={saving} onClick={() => onExport(selected.id)}>Export package</button></div>
          <div className="revo-action-row"><button className="revo-secondary" disabled={dirty || saving || rewriteBusy || actionLocked} onClick={() => void onQualityCheck(selected.id)}><RevoIcon name="check" /> {qualityBusy ? "Đang kiểm tra…" : "Quality check"}</button><button className="revo-primary" disabled={!canApprove || dirty || saving || rewriteBusy || actionLocked || !qualityPassed || selected.status !== "Needs review"} title={!canApprove ? "approve_content permission required" : undefined} onClick={() => void onApprove(selected.id)}><RevoIcon name="check" /> {approvalBusy ? "Đang chờ xác nhận…" : "Duyệt nội dung"}</button><button className="revo-secondary" disabled={saving || rewriteBusy || publishLocked || Boolean(publishBlocker)} aria-describedby={publishBlocker ? `publish-blocker-${selected.id}` : undefined} onClick={() => void onPublish(selected.id)}>{publishBusy ? "Đang chờ target…" : "Publish"}</button><button className="revo-secondary" disabled={saving || rewriteBusy || actionLocked || selected.status === "Published"} onClick={() => void onRegenerate(selected.id)}><RevoIcon name="refresh" /> {selected.rewriteStatus === "generating" ? "Đang làm lại…" : "Làm lại phần chữ"}</button><button className="revo-secondary" disabled={saving || rewriteBusy || actionLocked} onClick={() => void onTelegram(selected.id)}>Duyệt qua Telegram{selected.telegramState === "prepared" ? " · payload ready" : ""}</button><button className="revo-danger" disabled={saving || rewriteBusy || actionLocked || selected.status === "Published"} onClick={() => onReject(selected.id)}>Bỏ content</button></div>
          {publishBlocker && <small id={`publish-blocker-${selected.id}`} className="revo-publish-blocker" role="status">{publishBlocker}</small>}
          {(selectedFeedback?.quality || selectedFeedback?.approval || selectedFeedback?.publish) && <div className="revo-action-feedback" aria-live="polite">{(["quality", "approval", "publish"] as const).map((action) => { const feedback = selectedFeedback[action]; return feedback ? <div key={action} className={feedback.status} role={feedback.status === "failure" ? "alert" : "status"}><strong>{action === "quality" ? "Quality" : action === "approval" ? "Approval" : "Publish"}:</strong> {feedback.message}</div> : null; })}</div>}
          {selected.revisionHistory && selected.revisionHistory.length > 0 && <section className="revo-revisions" aria-label="Content revisions"><strong>Phiên bản chữ trước</strong>{selected.revisionHistory.slice().reverse().map((revision) => <div className="revo-revision-row" key={revision.id}><span>{revision.title} · {new Date(revision.createdAt).toLocaleString("vi-VN")}</span><button className="revo-secondary" disabled={saving || rewriteBusy || actionLocked} onClick={() => void (onRestoreRevision ? onRestoreRevision(selected.id, revision.id) : onUpdateDraft(selected.id, { restoreRevisionId: revision.id }))}>Khôi phục bản này</button></div>)}</section>}
        </>}
      </main>
      <aside className="revo-intelligence-panel" aria-label="Publish readiness and strategy">
        {!selected ? <div className="revo-empty">Chưa chọn content.</div> : <>
          <section className="revo-side-card revo-media-card"><div className="revo-side-heading"><span className="revo-kicker">{mediaKindFor(selected) === "video" ? "VIDEO CONTENT" : "ẢNH CONTENT"}</span><button className="revo-icon-button" onClick={() => void onRegenerate(selected.id)} aria-label="Làm lại phần chữ" disabled={rewriteBusy || actionLocked}><RevoIcon name="refresh" /></button></div>{(selected.mediaUrl || selected.mediaPreviewUrl) ? mediaKindFor(selected) === "video" ? <video className="revo-media-preview" src={selected.mediaUrl || selected.mediaPreviewUrl} poster={selected.mediaThumbnailUrl ?? localMediaThumbnailUrl(selected.mediaPreviewUrl)} muted playsInline preload="metadata" /> : <img src={selected.mediaUrl || selected.mediaPreviewUrl} alt={selected.title} /> : <div className="revo-media-empty">No visual yet<span>{selected.visualConcept ?? selected.visualPrompt ?? selected.mediaOperation?.reason ?? "Tạo image hoặc video riêng cho post này."}</span></div>}<div className="revo-media-actions"><button className="revo-secondary" onClick={() => void onGenerateMedia(selected.id, "image")} disabled={rewriteBusy || actionLocked || selected.mediaOperation?.status === "running"}><RevoIcon name="sparkle" /> Tạo lại ảnh AI</button><button className="revo-secondary" onClick={() => void onGenerateMedia(selected.id, "video")} disabled={rewriteBusy || actionLocked || selected.mediaOperation?.status === "running"}><RevoIcon name="play" /> Tạo video AI</button></div>{mediaKindFor(selected) === "image" && (selected.imageConcept || selected.imagePrompt) && <div className="revo-asset-contract"><strong>Image metadata</strong><small>{selected.imageConcept ?? "Concept not recorded"}</small><small>{selected.imagePrompt ?? "Prompt not recorded"}</small></div>}{mediaKindFor(selected) === "video" && (selected.videoConcept || selected.videoPrompt) && <div className="revo-asset-contract"><strong>Video metadata</strong><small>{selected.videoConcept ?? "Concept not recorded"}</small><small>{selected.videoPrompt ?? "Prompt not recorded"}</small></div>}<label className="revo-provider-field">VIDEO PROVIDER<select aria-label="Video provider" disabled={actionLocked} value={videoProvider} onChange={(event) => onVideoProviderChange(event.target.value as RevoVideoProvider)}><option value="local_upload">Existing video asset · review only</option><option value="veo">Google Flow / Veo · SignalFlow-managed Chromium</option><option value="runway">Runway · official provider</option></select><button type="button" className="revo-secondary" aria-label="Use Google Flow Veo" disabled={actionLocked} onClick={() => onVideoProviderChange("veo")}>{videoProvider === "veo" ? <><RevoIcon name="check" /> Google Flow / Veo selected</> : "Use Google Flow / Veo"}</button></label>{latestMediaOperation && <small className={`revo-operation ${latestMediaOperation.status}`}>{latestMediaOperation.kind} · {latestMediaOperation.status}{latestMediaOperation.provider ? ` · ${latestMediaOperation.provider}` : ""}{latestMediaOperation.reason ? ` · ${latestMediaOperation.reason}` : ""}</small>}{mediaOperations.length > 1 && <small className="revo-operation-summary">{mediaOperations.length - 1} earlier attempt(s) retained in audit.</small>}</section>
          <section className="revo-side-card"><div className="revo-side-heading"><span className="revo-kicker">PUBLISH READINESS</span><strong className={qualityPassed ? "passed" : "pending"}>{qualityPassed ? "PASSED" : "REVIEW"}</strong></div><div className="revo-readiness-list">{checks.map((check) => <div key={check.key} className={check.ok ? "ok" : "blocked"}><span>{check.ok ? <BetterMetricIcon name="check" /> : <BetterMetricIcon name="triangle-alert" />}</span><div><strong>{check.label}</strong><small>{check.message}</small></div></div>)}</div></section>
          <section className="revo-side-card"><div className="revo-side-heading"><span className="revo-kicker">THÔNG TIN STRATEGY</span></div><dl className="revo-strategy"><dt>Pillar</dt><dd>{selected.contentPillar ?? selected.strategySnapshot?.pillarLabel ?? "Not set"}</dd><dt>Angle</dt><dd>{selected.contentAngle ?? selected.strategySnapshot?.angleLabel ?? "Not set"}</dd><dt>Mục tiêu</dt><dd>{selected.objective ?? selected.strategySnapshot?.objectiveLabel ?? "Auto · catalog"}</dd><dt>Format</dt><dd>{selected.strategySnapshot?.format ?? (selected.contentKind === "video" || selected.contentKind === "short_video" || selected.contentKind === "long_video" || selected.mediaKind === "video" ? "video" : selected.contentKind === "image" || selected.mediaKind === "image" ? "image" : "text")}</dd><dt>Strategy version</dt><dd>{selected.strategyVersion ?? selected.strategySnapshot?.strategyVersion ?? "Legacy"}</dd><dt>Lịch đăng</dt><dd>{readableDate(selected.scheduledAt)}</dd><dt>Hook</dt><dd>{selected.topic ?? selected.title}</dd></dl><p className="revo-rationale">{selected.strategyRationale ?? "Strategy rationale will be stored with the Content Run."}</p></section>
          <section className="revo-side-card revo-research-card"><div className="revo-side-heading"><span className="revo-kicker">RESEARCH BRIEF</span><strong className={selected.researchState === "VERIFIED" ? "passed" : "pending"}>{selected.researchState ?? "NOT_SELECTED"}</strong></div><p>{selected.researchSourceCount ?? selected.sources?.length ?? 0} trusted source(s){selected.researchScore !== undefined ? ` · score ${selected.researchScore}` : ""}.</p><small>{targetSummary ?? "Target bindings and provider trace remain scoped to this Client / Brand."}</small></section>
        </>}
      </aside>
    </div>
    <section className="revo-run-log" aria-label="Recent run log"><div className="revo-run-log-heading"><div><span className="revo-kicker">GENERATION HISTORY</span><strong>Recent run log</strong></div><span>{drafts.length} run(s)</span></div><div className="revo-run-list">{drafts.slice(0, 7).map((draft) => <div className="revo-run-row" key={`run-${draft.id}`}><span>{draft.time}</span><strong>{draft.topic ?? draft.title}</strong><em>{draft.platform} · {draft.approvalState ?? stateFor(draft)}</em></div>)}{drafts.length === 0 && <div className="revo-empty">No recent runs.</div>}</div></section>
    {showGeneratedVariants && <div className="modal-backdrop revo-variants-backdrop" role="dialog" aria-modal="true" aria-labelledby="generated-variants-title" onMouseDown={closeGeneratedVariants}><section ref={generatedVariantsDialogRef} className="composer-modal revo-variants-modal" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); closeGeneratedVariants(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(generatedVariantsDialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first || !last) { event.preventDefault(); generatedVariantsDialogRef.current?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}><div className="modal-heading"><div><p className="panel-kicker">GENERATED VARIANTS</p><h2 id="generated-variants-title">{drafts.length} content variants</h2><span>Same Client / Brand scope · review remains required.</span></div><button type="button" className="close-button" aria-label="Close generated variants" ref={generatedVariantsCloseRef} onClick={closeGeneratedVariants}>×</button></div><div className="revo-variants-list">{drafts.map((draft) => <div className="revo-variant-row" key={`variant-${draft.id}`}><div><strong>{draft.title}</strong><small>{draft.topic ?? "No topic"} · {draft.contentPillar ?? draft.tag}</small></div><span className={`revo-status ${draft.status.toLowerCase().replace(/\s+/g, "-")}`}>{draft.status}</span></div>)}</div></section></div>}
  </section>;
}

export function RevoNewContentModal({ visible, brandName, clientName, assets, generationError, isGenerating, mediaImportBusy = false, mediaImportNotice = "", onClose, onSubmit, onImportLocalImage, activeClientId, activeBrandId, openerRef, fallbackRef, knowledgeItems, researchEvidence, promptBlueprints, contentRecipes, selectedKnowledgeItemIds, selectedResearchEvidenceIds, selectedPromptBlueprintId, selectedRecipeId, transformMode }: RevoNewContentModalProps) {
  const [form, setForm] = useState<RevoNewContentInput>({ topic: "", contentPillar: "", contentAngle: "", objective: "", format: "text", caption: "", cta: "", hashtags: "", seoKeywords: "", scheduledAt: "", sources: "", notes: "", aiProvider: "openai", aiMode: "api", selectedPlatforms: ["Facebook"], composerAssetId: "", composerAssetIds: [], composerMediaManifest: [] });
  const [mediaSelectionNotice, setMediaSelectionNotice] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const formRef = useRef(form);
  const visibleRef = useRef(visible);
  const generatingRef = useRef(isGenerating);
  const onSubmitRef = useRef(onSubmit);
  const onCloseRef = useRef(onClose);
  const internalOpenerRef = useRef<RevoComposerFocusTarget | null>(null);
  const internalFallbackRef = useRef<RevoComposerFocusTarget | null>(null);
  const controllerRef = useRef<ReturnType<typeof createRevoComposerModalController> | null>(null);
  formRef.current = form;
  visibleRef.current = visible;
  generatingRef.current = isGenerating;
  onSubmitRef.current = onSubmit;
  onCloseRef.current = onClose;
  const effectiveOpenerRef = openerRef ?? internalOpenerRef;
  const effectiveFallbackRef = fallbackRef ?? internalFallbackRef;
  if (!controllerRef.current) {
    controllerRef.current = createRevoComposerModalController({
      isVisible: () => visibleRef.current,
      isGenerating: () => generatingRef.current,
      getForm: () => formRef.current,
      onSubmit: (input) => onSubmitRef.current(input),
      onClose: (event) => onCloseRef.current(event),
      openerRef: effectiveOpenerRef,
      fallbackRef: effectiveFallbackRef,
    });
  }
  const controller = controllerRef.current;
  useEffect(() => {
    if (visible) {
      setForm({ topic: "", contentPillar: "", contentAngle: "", objective: "", format: "text", caption: "", cta: "", hashtags: "", seoKeywords: "", scheduledAt: "", sources: "", notes: "", aiProvider: "openai", aiMode: "api", selectedPlatforms: ["Facebook"], composerAssetId: "", composerAssetIds: [], composerMediaManifest: [] });
      setMediaSelectionNotice("");
    }
  }, [activeBrandId, activeClientId, visible]);
  useEffect(() => {
    if (!visible) return;
    const frame = window.requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      (first ?? dialogRef.current)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visible]);
  if (!visible) return null;
  const update = <K extends keyof RevoNewContentInput>(key: K, value: RevoNewContentInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const togglePlatform = (platform: RevoNewContentInput["selectedPlatforms"][number]) => update("selectedPlatforms", form.selectedPlatforms.includes(platform) ? form.selectedPlatforms.filter((item) => item !== platform) : [...form.selectedPlatforms, platform]);
  const mediaCandidates = assets.filter((asset) => asset.archiveState !== "archived" && asset.kind === "Image" && asset.localAssetPath);
  const selectedMediaManifest = form.composerMediaManifest ?? (form.composerAssetIds?.length ? form.composerAssetIds : form.composerAssetId === "" ? [] : [form.composerAssetId]).map((assetId, order) => ({ assetId, order, role: order === 0 ? "publish" as const : "reference" as const }));
  const intelligenceSelection = summarizeContentIntelligenceSelection({ clientId: activeClientId, brandId: activeBrandId, knowledgeItems, researchEvidence, promptBlueprints, contentRecipes, selectedKnowledgeItemIds, selectedResearchEvidenceIds, selectedPromptBlueprintId, selectedRecipeId, transformMode });
  const saveMediaManifest = (manifest: ComposerMediaSelection[]) => {
    setForm((current) => ({ ...current, composerMediaManifest: manifest, composerAssetIds: manifest.map((item) => item.assetId), composerAssetId: manifest[0]?.assetId ?? "" }));
  };
  const toggleMedia = (assetId: string | number) => {
    const result = toggleComposerMediaSelection(selectedMediaManifest, assetId);
    if (result.limitReached) {
      setMediaSelectionNotice("Đã đạt giới hạn 6 ảnh. Bỏ chọn một ảnh trước khi thêm ảnh khác.");
      return;
    }
    setMediaSelectionNotice("");
    saveMediaManifest(result.manifest);
  };
  const moveMedia = (assetId: string | number, direction: -1 | 1) => saveMediaManifest(moveComposerMediaSelection(selectedMediaManifest, assetId, direction));
  const setMediaRole = (assetId: string | number, role: ComposerMediaRole) => saveMediaManifest(setComposerMediaRole(selectedMediaManifest, assetId, role));
  const mediaUploadStatus = isGenerating ? "Đang chờ phản hồi; chưa có bằng chứng provider xác nhận upload media." : `${selectedMediaManifest.length}/${COMPOSER_MEDIA_LIMIT} ảnh đã chọn · chưa có file nào được provider xác nhận upload.`;
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    controller.keyDown(event, { focusable, activeElement: document.activeElement as RevoComposerFocusTarget | null, focus: () => dialogRef.current?.focus() });
  };
  return <div className="modal-backdrop revo-composer-backdrop" onMouseDown={(event) => controller.backdropMouseDown(event)}>
    <section ref={dialogRef} className="composer-modal revo-new-content-modal" role="dialog" aria-modal="true" aria-labelledby="revo-new-content-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}>
      <div className="modal-heading"><div><p className="panel-kicker">AI CONTENT STUDIO</p><h2 id="revo-new-content-title">Start a new content sprint</h2><span>Client: {clientName} · Brand: {brandName} · Revo-compatible structured Content Run</span></div><button type="button" className="close-button" aria-label="Đóng composer" onClick={() => controller.close("close")}>×</button></div>
      <section className="intelligence-section revo-intelligence-handoff" data-testid="content-intelligence-handoff" aria-labelledby="content-intelligence-handoff-title"><div className="section-heading-inline"><div><strong id="content-intelligence-handoff-title">CONTENT INTELLIGENCE HANDOFF</strong><small>Content Intelligence will be included in this new Content Run.</small></div><span>Current Client / Brand scope</span></div><div className="intelligence-row"><span><strong>Knowledge Items</strong><small>{selectionSummaryText(intelligenceSelection.knowledgeItems, intelligenceSelection.issues.filter((issue) => issue.field === "knowledge"))}</small></span></div><div className="intelligence-row"><span><strong>Research Evidence</strong><small>{selectionSummaryText(intelligenceSelection.researchEvidence, intelligenceSelection.issues.filter((issue) => issue.field === "research"))}</small></span></div><div className="intelligence-row"><span><strong>Prompt Blueprint</strong><small>{intelligenceSelection.promptBlueprint?.label ?? selectionSummaryText([], intelligenceSelection.issues.filter((issue) => issue.field === "promptBlueprint"))}</small></span></div><div className="intelligence-row"><span><strong>Content Recipe</strong><small>{intelligenceSelection.contentRecipe ? `${intelligenceSelection.contentRecipe.name} [${intelligenceSelection.contentRecipe.id}]` : selectionSummaryText([], intelligenceSelection.issues.filter((issue) => issue.field === "recipe"))}</small></span></div><div className="intelligence-row"><span><strong>Transform mode</strong><small>{intelligenceSelection.transformMode}</small></span></div>{intelligenceSelection.issues.length > 0 && <small className="muted-note" role="alert">Selection blocked. Repair the marked source, blueprint, or recipe before submitting.</small>}<small className="muted-note">Only approved, user-owned/licensed, current-scope records are shown. Pending Research Evidence remains unavailable until Brand manager approval.</small></section>
      <div className="revo-composer-grid">
        <label className="field-label">TOPIC / TITLE<input autoFocus value={form.topic} onChange={(event) => update("topic", event.target.value)} placeholder="How to build an emergency fund when income is irregular…" /></label>
        <label className="field-label">CONTENT PILLAR<input value={form.contentPillar} onChange={(event) => update("contentPillar", event.target.value)} placeholder="Auto · catalog resolves" /></label>
        <label className="field-label">CONTENT ANGLE<input value={form.contentAngle ?? ""} onChange={(event) => update("contentAngle", event.target.value)} placeholder="Auto · catalog resolves" /></label>
        <label className="field-label">OBJECTIVE<select value={form.objective} onChange={(event) => update("objective", event.target.value as RevoObjective | "")}><option value="">Auto · catalog resolves</option>{(["Reach", "Engagement", "Education", "Knowledge", "Conversion"] as RevoObjective[]).map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
        <label className="field-label">FORMAT<select value={form.format ?? "text"} onChange={(event) => update("format", event.target.value as AssetPromptFormat)}><option value="text">text</option><option value="image">image</option><option value="video">video</option></select></label>
        <label className="field-label revo-field-wide">CAPTION / BRIEF<textarea value={form.caption} onChange={(event) => update("caption", event.target.value)} rows={5} placeholder="Optional starting copy; review remains required." /></label>
        <label className="field-label">CTA<input value={form.cta} onChange={(event) => update("cta", event.target.value)} placeholder="Lưu lại để xem sau" /></label>
        <label className="field-label">HASHTAGS<input value={form.hashtags} onChange={(event) => update("hashtags", event.target.value)} placeholder="#signalflow #contentos" /></label>
        <label className="field-label">SEO KEYWORDS<input value={form.seoKeywords} onChange={(event) => update("seoKeywords", event.target.value)} placeholder="automation, content operations" /></label>
        <label className="field-label">SCHEDULED AT<input type="datetime-local" value={form.scheduledAt} onChange={(event) => update("scheduledAt", event.target.value)} /></label>
        <label className="field-label revo-field-wide">SOURCES / RESEARCH BRIEF<textarea value={form.sources} onChange={(event) => update("sources", event.target.value)} rows={3} placeholder="One source URL per line" /></label>
        <label className="field-label revo-field-wide">INTERNAL NOTES<textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={3} /></label>
      </div>
      <div className="composer-options"><label className="field-label">AI engine<select disabled={isGenerating} value={form.aiProvider} onChange={(event) => update("aiProvider", event.target.value as RevoNewContentInput["aiProvider"])}><option value="openai">ChatGPT / OpenAI</option><option value="gemini">Gemini Pro · in-app browser</option></select></label><label className="field-label">Mode<select disabled={isGenerating} value={form.aiMode} onChange={(event) => update("aiMode", event.target.value as RevoNewContentInput["aiMode"])}><option value="api">Official API via .env credential file</option><option value="web_subscription">Managed browser subscription</option><option value="manual_assisted">Manual assist · no automation</option></select></label></div>
      <div className="field-label">TARGET CHANNELS<div className="platform-selectors">{(["Facebook", "Instagram", "TikTok", "YouTube"] as RevoNewContentInput["selectedPlatforms"][number][]).map((platform) => <button type="button" disabled={isGenerating} key={platform} className={'platform-selector ' + (form.selectedPlatforms.includes(platform) ? 'selected' : '')} onClick={() => togglePlatform(platform)}><span className={`platform-mark ${platform.toLowerCase()}`}><BetterPlatformIcon name={revoPlatformIcons[platform]} /></span><span>{platform}</span><b>{form.selectedPlatforms.includes(platform) ? <RevoIcon name="check" /> : <RevoIcon name="plus" />}</b></button>)}</div></div>
      <fieldset disabled={isGenerating} className="field-label revo-field-wide media-selection"><legend>MEDIA KHÁCH HÀNG CUNG CẤP</legend><small>Ảnh app-owned có thể dùng cho AI Content Run trước khi public URL hoặc publish review hoàn tất. Provider upload chỉ được ghi nhận khi có bằng chứng chính xác.</small><label className="revo-media-import-control">Nhập ảnh cục bộ<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Nhập ảnh cục bộ" disabled={mediaImportBusy || isGenerating} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void onImportLocalImage(file); }} /></label>{mediaImportNotice && <div className="media-selection-status" role="status">{mediaImportNotice}</div>}<div className="media-selection-status" role="status" aria-live="polite">{mediaSelectionNotice || mediaUploadStatus}{selectedMediaManifest.length === COMPOSER_MEDIA_LIMIT && !mediaSelectionNotice && <span> Đã đạt giới hạn 6 ảnh; bỏ chọn một ảnh trước khi thêm ảnh khác.</span>}</div>{mediaCandidates.length ? <div className="media-selection-grid">{mediaCandidates.map((asset) => {
        const selection = selectedMediaManifest.find((item) => String(item.assetId) === String(asset.id));
        const selected = Boolean(selection);
        const supportedMime = ["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType?.toLowerCase() ?? "");
        const supported = Boolean(asset.localAssetPath && asset.checksum && supportedMime);
        const previewUrl = localMediaPreviewUrl(asset.localAssetPath);
        const availability = !supportedMime ? "Chỉ nhận ảnh PNG, JPEG hoặc WebP" : !asset.checksum ? "Cần SHA-256 trước khi gửi AI" : selected ? "Đang chờ provider xác nhận file" : asset.status !== "Ready" ? "Ảnh riêng tư trong app · dùng cho AI được, vẫn cần duyệt trước khi đăng" : "Sẵn sàng gửi ảnh cho AI";
        return <article className={`media-selection-card ${selected ? "selected" : ""} ${supported ? "" : "unsupported"}`} key={asset.id}>
          <label className="media-selection-card-select"><input type="checkbox" disabled={!supported} checked={selected} onChange={() => toggleMedia(asset.id)} aria-label={`Chọn ảnh ${asset.name}`} /><span className="media-selection-thumb">{previewUrl && <img src={previewUrl} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} />}<small>IMAGE</small></span><span className="media-selection-copy"><strong title={asset.name}>{asset.name}</strong><small>{availability}</small></span></label>
          {selection && <div className="media-selection-controls"><span>Ảnh {selection.order + 1}</span><button type="button" disabled={selection.order === 0} onClick={() => moveMedia(asset.id, -1)} aria-label={`Đưa ${asset.name} lên trước`}>↑</button><button type="button" disabled={selection.order === selectedMediaManifest.length - 1} onClick={() => moveMedia(asset.id, 1)} aria-label={`Đưa ${asset.name} xuống sau`}>↓</button><label>Vai trò<select aria-label={`Vai trò của ${asset.name}`} value={selection.role} onChange={(event) => setMediaRole(asset.id, event.target.value as ComposerMediaRole)}><option value="publish">Ảnh đăng chính</option><option value="reference">Ảnh tham chiếu</option></select></label></div>}
        </article>;
      })}</div> : <div className="empty-state">Import an app-owned image to attach it to AI content.</div>}</fieldset>
      {generationError && <div className="generation-error">{generationError}</div>}
      <div className="composer-foot"><span>Brand voice: {brandName} · approval required</span><button type="button" className="revo-secondary" onClick={() => controller.close("cancel")}>Hủy</button><button className="revo-primary" onClick={() => void controller.submit()} disabled={isGenerating || !form.topic.trim()}>{isGenerating ? "Generating…" : "Generate draft"} <RevoIcon name="sparkle" /></button></div>
    </section>
  </div>;
}
