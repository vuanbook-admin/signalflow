import { describe, expect, it } from "vitest";
import type { CreativeRunRecord, MediaInventoryRecord } from "./automationDomain";
import { buildSafePlannerDiagnostics, type PlannerDiagnosticDraft } from "./safePlannerDiagnostics";

const plan = {
  id: "postfix-live-1787553712753",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  status: "active" as const,
  cron: { enabled: true, startTime: "08:00", timezone: "Asia/Ho_Chi_Minh" },
  targetPageIds: ["100000000000001"],
  lastDueAt: "2026-08-24T07:28:17.793Z",
};

const selectedAsset: MediaInventoryRecord = {
  id: "drive-1Zyx-wVuTsRqPoNmLkJiHg__FeDcBa-01",
  brandId: "brand-bellamy",
  campaignId: "",
  topic: "",
  platform: "facebook",
  kind: "image",
  name: "Bellamy Baby image",
  mimeType: "image/png",
  sizeBytes: 12,
  modifiedAt: "2026-08-24T07:20:00.000Z",
  source: "drive",
  status: "eligible",
  providerFileId: "1Zyx-wVuTsRqPoNmLkJiHg__FeDcBa-01",
  provenance: { source: "google_drive", providerFileId: "1Zyx-wVuTsRqPoNmLkJiHg__FeDcBa-01", importedAt: "2026-08-24T07:20:00.000Z" },
};

const successfulRun: CreativeRunRecord = {
  id: "creative-postfix-live-1787553712753:2026-08-24:facebook:0:100000000000001",
  brandId: "brand-bellamy",
  topic: "DO NOT EXPORT THIS PROMPT BODY",
  state: "needs_review",
  platform: "facebook",
  targetPageId: "100000000000001",
  automationKey: "postfix-live-1787553712753:2026-08-24:facebook:0:100000000000001",
  idea: "DO NOT EXPORT THIS IDEA",
  ideaProvider: "gemini_web",
  ideaTraceId: "trace-secret",
  mediaAssetId: selectedAsset.id,
  mediaProvenance: { source: "google_drive", providerFileId: "wrong-run-provider-id" },
  imageProvider: "google_flow",
  copyProvider: "gemini_web",
  copyModel: "private-model",
  copyResult: { imageAware: true, title: "DO NOT EXPORT THIS TITLE", body: "DO NOT EXPORT THIS RESPONSE BODY", traceId: "response-secret" },
  promptVersion: "v1",
  brandVoiceVersion: "v1",
  createdAt: "2026-08-24T07:20:00.000Z",
  updatedAt: "2026-08-24T07:30:00.000Z",
};

const failedRun: CreativeRunRecord = {
  ...successfulRun,
  id: "creative-missing-plan:2026-08-24:facebook:1:100000000000001",
  automationKey: "missing-plan:2026-08-24:facebook:1:100000000000001",
  state: "failed",
  copyProvider: undefined,
  copyResult: undefined,
  error: "GEMINI_WEB_RESPONSE_TIMEOUT /Users/example/Library/Application Support/SignalFlow/private-prompt.json arbitrary message",
  updatedAt: "2026-08-24T07:31:00.000Z",
};

const drafts: PlannerDiagnosticDraft[] = [
  { id: 901, automationKey: successfulRun.automationKey, status: "Needs review", title: "DO NOT EXPORT DRAFT TITLE", body: "DO NOT EXPORT DRAFT BODY" },
];

describe("safe planner diagnostics", () => {
  it("exports only allowlisted correlated run fields and redacts sensitive-shaped values", () => {
    const exported = buildSafePlannerDiagnostics({ plans: [plan], runs: [successfulRun, failedRun], drafts, mediaAssets: [selectedAsset] });
    expect(exported.planSummaries).toEqual([{ workspaceId: "workspace-1", brandId: "brand-1", planId: plan.id, status: "active", cronEnabled: true, startTime: "08:00", timezone: "Asia/Ho_Chi_Minh", targetPageIds: ["100000000000001"], lastDueAt: plan.lastDueAt }]);
    expect(exported.runs).toHaveLength(2);
    expect(exported.runs[0]).toEqual({
      planId: plan.id,
      creativeRunId: successfulRun.id,
      automationKey: successfulRun.automationKey,
      state: "needs_review",
      platform: "facebook",
      targetPageId: "100000000000001",
      ideaProvider: "gemini_web",
      copyProvider: "gemini_web",
      copyResultImageAware: true,
      mediaAssetId: selectedAsset.id,
      providerFileId: selectedAsset.providerFileId,
      imageProvider: "google_flow",
      draftId: 901,
      draftStatus: "Needs review",
      draftCount: 1,
      needsReviewDraftCount: 1,
      createdAt: successfulRun.createdAt,
      updatedAt: successfulRun.updatedAt,
      safeErrorCode: null,
    });
    expect(exported.runs[1]).toMatchObject({
      planId: null,
      creativeRunId: failedRun.id,
      automationKey: failedRun.automationKey,
      state: "failed",
      draftId: null,
      draftStatus: null,
      draftCount: 1,
      needsReviewDraftCount: 1,
      safeErrorCode: "GEMINI_WEB_RESPONSE_TIMEOUT",
    });
    expect(Object.keys(exported.runs[0]).sort()).toEqual([
      "automationKey", "copyProvider", "copyResultImageAware", "createdAt", "creativeRunId", "draftCount", "draftId", "draftStatus", "ideaProvider", "imageProvider", "mediaAssetId", "needsReviewDraftCount", "planId", "platform", "providerFileId", "safeErrorCode", "state", "targetPageId", "updatedAt",
    ].sort());
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain("DO NOT EXPORT");
    expect(serialized).not.toContain("trace-secret");
    expect(serialized).not.toContain("private-model");
    expect(serialized).not.toContain("wrong-run-provider-id");
    expect(serialized).not.toContain("/Users/example");
    expect(serialized).not.toContain("arbitrary message");
    expect(serialized).not.toMatch(/prompt|response body|title|body|token|password|cookie|path/i);
  });

  it("puts the newest successful run first when stale runs are restored ahead of it", () => {
    const newestRun: CreativeRunRecord = {
      ...successfulRun,
      id: "creative-postfix-live-1787553712753:2026-08-24:facebook:0:100000000000001:newest",
      updatedAt: "2026-08-24T07:32:00.000Z",
      automationKey: `${successfulRun.automationKey}:newest`,
    };
    const newestDrafts: PlannerDiagnosticDraft[] = [
      ...drafts,
      { id: 902, automationKey: newestRun.automationKey, status: "Needs review" },
    ];
    const exported = buildSafePlannerDiagnostics({ plans: [plan], runs: [successfulRun, newestRun], drafts: newestDrafts, mediaAssets: [selectedAsset] });
    expect(exported.runs[0]).toMatchObject({ creativeRunId: newestRun.id, updatedAt: newestRun.updatedAt, state: "needs_review" });
    expect(exported.runs[1]).toMatchObject({ creativeRunId: successfulRun.id, updatedAt: successfulRun.updatedAt });
  });
});
