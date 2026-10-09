import type { AutomationPlan } from "./automationPlanner";
import type { CreativeRunRecord, MediaInventoryRecord } from "./automationDomain";

type PlannerDiagnosticPlan = Pick<AutomationPlan, "id" | "workspaceId" | "brandId" | "status" | "lastDueAt" | "cron" | "targetPageIds">;

export type PlannerDiagnosticDraft = {
  id: number;
  automationKey?: string;
  status: string;
  title?: string;
  body?: string;
};

export type SafePlannerRun = {
  planId: string | null;
  creativeRunId: string;
  automationKey: string | null;
  state: CreativeRunRecord["state"];
  platform: CreativeRunRecord["platform"] | null;
  targetPageId: string | null;
  ideaProvider: string | null;
  copyProvider: string | null;
  copyResultImageAware: boolean | null;
  mediaAssetId: string | null;
  providerFileId: string | null;
  imageProvider: CreativeRunRecord["imageProvider"] | null;
  draftId: number | null;
  draftStatus: string | null;
  draftCount: number;
  needsReviewDraftCount: number;
  createdAt: string;
  updatedAt: string;
  safeErrorCode: string | null;
};

export type SafePlannerDiagnostics = {
  planSummaries: Array<{ workspaceId: string; brandId: string; planId: string; status: AutomationPlan["status"]; cronEnabled: boolean; startTime: string; timezone: string; targetPageIds: string[]; lastDueAt: string | null }>;
  runs: SafePlannerRun[];
};

const SAFE_ERROR_CODE = /^(?:CREATIVE_(?:COPY_FAILED|GENERATION_FAILED)|(?:GEMINI|CHATGPT)_WEB_[A-Z0-9_]+|(?:FLOW|VERTEX|AI|IMAGE|RESERVATION|GENERATED|CONTENT|IDEA)_[A-Z0-9_]+)$/;

function safeErrorCode(error: unknown): string | null {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const candidates = raw.toUpperCase().match(/[A-Z][A-Z0-9_]{2,}/g) ?? [];
  const code = candidates.find((candidate) => SAFE_ERROR_CODE.test(candidate));
  return code ?? null;
}

function planIdFromAutomationKey(automationKey: string | undefined, plans: PlannerDiagnosticPlan[]): string | null {
  if (!automationKey) return null;
  const match = plans.find((plan) => automationKey === plan.id || automationKey.startsWith(`${plan.id}:`));
  return match?.id ?? null;
}

function selectedProviderFileId(run: CreativeRunRecord, mediaAssets: MediaInventoryRecord[]): string | null {
  if (!run.mediaAssetId) return null;
  const asset = mediaAssets.find((candidate) => candidate.id === run.mediaAssetId);
  return asset?.providerFileId ?? asset?.provenance?.providerFileId ?? null;
}

function isSuccessfulPlannerRun(run: CreativeRunRecord): boolean {
  return run.state !== "failed" && run.state !== "idea" && run.state !== "media_selected" && run.state !== "media_generated" && run.state !== "image" && run.state !== "copy";
}

function orderRunsForDiagnostics(runs: CreativeRunRecord[]): CreativeRunRecord[] {
  return runs
    .map((run, index) => ({ run, index }))
    .sort((left, right) => {
      const successfulRank = Number(isSuccessfulPlannerRun(right.run)) - Number(isSuccessfulPlannerRun(left.run));
      if (successfulRank !== 0) return successfulRank;
      const leftTime = Date.parse(left.run.updatedAt);
      const rightTime = Date.parse(right.run.updatedAt);
      if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
      return left.index - right.index;
    })
    .map(({ run }) => run);
}

export function buildSafePlannerDiagnostics(input: {
  plans: PlannerDiagnosticPlan[];
  runs: CreativeRunRecord[];
  drafts: PlannerDiagnosticDraft[];
  mediaAssets: MediaInventoryRecord[];
}): SafePlannerDiagnostics {
  const draftCount = input.drafts.length;
  const needsReviewDraftCount = input.drafts.filter((draft) => draft.status === "Needs review").length;
  const planSummaries = input.plans.map((plan) => ({ workspaceId: plan.workspaceId, brandId: plan.brandId, planId: plan.id, status: plan.status, cronEnabled: plan.cron.enabled, startTime: plan.cron.startTime, timezone: plan.cron.timezone, targetPageIds: [...(plan.targetPageIds ?? [])], lastDueAt: plan.lastDueAt ?? null }));
  const runs = orderRunsForDiagnostics(input.runs).map((run): SafePlannerRun => {
    const automationKey = run.automationKey ?? null;
    const draft = automationKey ? input.drafts.find((candidate) => candidate.automationKey === automationKey) : undefined;
    return {
      planId: planIdFromAutomationKey(run.automationKey, input.plans),
      creativeRunId: run.id,
      automationKey,
      state: run.state,
      platform: run.platform ?? null,
      targetPageId: run.targetPageId ?? null,
      ideaProvider: run.ideaProvider ?? null,
      copyProvider: run.copyProvider ?? null,
      copyResultImageAware: typeof run.copyResult?.imageAware === "boolean" ? run.copyResult.imageAware : null,
      mediaAssetId: run.mediaAssetId ?? null,
      providerFileId: selectedProviderFileId(run, input.mediaAssets),
      imageProvider: run.imageProvider ?? null,
      draftId: draft?.id ?? null,
      draftStatus: draft?.status ?? null,
      draftCount,
      needsReviewDraftCount,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      safeErrorCode: safeErrorCode(run.error),
    };
  });
  return { planSummaries, runs };
}
