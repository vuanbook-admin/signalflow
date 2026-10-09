import { describe, expect, it } from "vitest";
import type { ContentIntelligenceIntakeDraftMap } from "./contentIntelligence";

async function intelligence() { return await import("./contentIntelligence").catch(() => undefined); }

const approved = { id: "knowledge-a", clientId: "client-a", brandId: "brand-a", kind: "product_fact", title: "Approved fact", contentHash: "a".repeat(64), provenance: "owner document", rightsState: "user_owned" as const, reviewState: "approved" as const, text: "Fact A", sourceUpdatedAt: "2026-08-29T00:00:00.000Z" };

describe("Content Intelligence rights and scope gates", () => {
  it("rejects a knowledge item missing required rights/review provenance", async () => {
    const api = await intelligence();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.validateKnowledgeItem(approved)).toEqual({ ok: true, errors: [] });
    expect(api.validateKnowledgeItem({ ...approved, rightsState: "unknown" })).toMatchObject({ ok: false, errors: expect.arrayContaining(["RIGHTS_OR_REVIEW_BLOCKED"]) });
    expect(api.validateKnowledgeItem({ ...approved, contentHash: "not-a-hash" })).toMatchObject({ ok: false, errors: expect.arrayContaining(["KNOWLEDGE_CONTENT_HASH_INVALID"]) });
  });

  it("builds bounded context only from selected approved, same-client sources", async () => {
    const api = await intelligence();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.buildContentIntelligenceContext({ clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", knowledgeItems: [approved], selectedKnowledgeItemIds: ["knowledge-a"], researchEvidence: [], selectedResearchEvidenceIds: [], userBrief: "Write a post" })).toMatchObject({ ok: true, sourceMetadata: [{ id: "knowledge-a", title: "Approved fact" }] });
    expect(api.buildContentIntelligenceContext({ clientId: "client-b", brandId: "brand-b", identityVersionId: "identity-b", knowledgeItems: [approved], selectedKnowledgeItemIds: ["knowledge-a"], researchEvidence: [], selectedResearchEvidenceIds: [], userBrief: "Write a post" })).toEqual({ ok: false, code: "RIGHTS_OR_REVIEW_BLOCKED" });
  });

  it("rejects same-client research evidence assigned to another brand while allowing client-level evidence", async () => {
    const api = await intelligence();
    expect(api).toBeDefined();
    if (!api) return;
    const brandBEvidence = { id: "evidence-b", clientId: "client-a", brandId: "brand-b", sourceUrl: "https://example.test/b", sourceTitle: "Brand B only", retrievedAt: "2026-09-13T00:00:00.000Z", summary: "Private to Brand B", sourceType: "operator_selected" as const, rightsState: "user_owned" as const, reviewState: "approved" as const };
    const clientEvidence = { ...brandBEvidence, id: "evidence-client", brandId: undefined, sourceTitle: "Client evidence" };
    const pendingBrandAEvidence = { ...brandBEvidence, id: "evidence-pending", brandId: "brand-a", reviewState: "pending" as const };
    const build = (evidence: typeof brandBEvidence | typeof clientEvidence | typeof pendingBrandAEvidence) => api.buildContentIntelligenceContext({ clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", knowledgeItems: [], selectedKnowledgeItemIds: [], researchEvidence: [evidence], selectedResearchEvidenceIds: [evidence.id], userBrief: "Write a post" });
    expect(build(brandBEvidence)).toEqual({ ok: false, code: "RIGHTS_OR_REVIEW_BLOCKED" });
    expect(build(clientEvidence)).toMatchObject({ ok: true, sourceMetadata: [{ id: "evidence-client", title: "Client evidence" }] });
    expect(build(pendingBrandAEvidence)).toEqual({ ok: false, code: "RIGHTS_OR_REVIEW_BLOCKED" });
  });

  it("passes the fixed 25-item source-selection fixture with zero cross-client or unsafe selections", async () => {
    const api = await intelligence();
    expect(api).toBeDefined();
    if (!api) return;
    const kinds = ["brand_voice", "product_fact", "approved_claim", "media_reference", "recipe_material"];
    const items = kinds.flatMap((kind, kindIndex) => Array.from({ length: 5 }, (_, index) => ({ ...approved, id: `${kind}-${index}`, kind, title: `${kind} ${index}`, contentHash: `${(kindIndex * 5 + index + 1).toString(16)}`.padStart(64, "0"), text: `${kind} approved material ${index}` })));
    const result = api.buildContentIntelligenceContext({ clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", knowledgeItems: items, selectedKnowledgeItemIds: items.map((item) => item.id), researchEvidence: [], selectedResearchEvidenceIds: [], userBrief: "Use approved material only" });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.sourceMetadata).toHaveLength(25);
  });

  it("blocks repurpose/imitation when no approved source was explicitly selected", async () => {
    const api = await intelligence(); expect(api).toBeDefined(); if (!api) return;
    expect(api.buildContentIntelligenceContext({ clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a", knowledgeItems: [], selectedKnowledgeItemIds: [], researchEvidence: [], selectedResearchEvidenceIds: [], userBrief: "Rewrite this", transformMode: "imitation" })).toEqual({ ok: false, code: "RIGHTS_OR_REVIEW_BLOCKED" });
  });

  it("serializes one active brand recipe into the bounded context", async () => {
    const api = await intelligence();
    expect(api).toBeDefined();
    if (!api) return;
    const result = api.buildContentIntelligenceContext({
      clientId: "client-a", brandId: "brand-a", identityVersionId: "identity-a-v1",
      knowledgeItems: [], selectedKnowledgeItemIds: [], researchEvidence: [], selectedResearchEvidenceIds: [], userBrief: "brief",
      recipe: { id: "recipe-a", brandId: "brand-a", name: "Hook first", platforms: ["facebook"], contentKinds: ["text"], hookGuidance: "one hook", structureGuidance: "three beats", ctaGuidance: "save", qualityChecklist: ["facts"], status: "active" },
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.context).toContain("Content recipe recipe-a v1");
  });
});

describe("Content Intelligence intake drafts", () => {
  const scopeA = { profileId: "profile-a", clientId: "client-a", brandId: "brand-a" };
  const scopeB = { ...scopeA, brandId: "brand-b" };

  it("keeps every intake field and form visibility after a scoped save fails", async () => {
    const api = await intelligence();
    expect(api?.emptyContentIntelligenceIntakeDraft).toBeDefined();
    if (!api?.emptyContentIntelligenceIntakeDraft) return;

    let drafts: ContentIntelligenceIntakeDraftMap = {};
    const inputs = {
      knowledge: { title: "Knowledge title", text: "Knowledge body", provenance: "Owner document", rightsState: "licensed" as const },
      research: { sourceUrl: "https://example.test/source", sourceTitle: "Research title", summary: "Research summary", sourceType: "manual_entry" as const, rightsState: "licensed" as const },
      trend: { source: "Operator note", topic: "Observed topic", metric: "12 mentions" },
    };

    for (const kind of ["knowledge", "research", "trend"] as const) {
      let draft = api.emptyContentIntelligenceIntakeDraft(scopeA, kind);
      draft = api.reviseContentIntelligenceIntakeDraft(draft, { open: true });
      draft = api.reviseContentIntelligenceIntakeDraft(draft, inputs[kind]);
      const token = api.beginContentIntelligenceIntakeSave(new Map(), new Set(), scopeA, kind, draft.revision);
      expect(token).toBeDefined();
      if (!token) continue;
      drafts[token.draftKey] = draft;
      drafts = api.contentIntelligenceIntakeDraftsWithFeedback(drafts, token, token.requestId, "failure", "Save failed.");

      const retained = api.contentIntelligenceIntakeDraftsForScope(drafts, scopeA)[kind];
      expect(retained).toMatchObject({ open: true, status: "failure", message: "Save failed.", ...inputs[kind] });
    }
  });

  it("acknowledges Brand A's saved revision without clearing Brand B's draft", async () => {
    const api = await intelligence();
    expect(api?.emptyContentIntelligenceIntakeDraft).toBeDefined();
    if (!api?.emptyContentIntelligenceIntakeDraft) return;

    const ids = new Map<string, number>();
    const inFlight = new Set<string>();
    let drafts: ContentIntelligenceIntakeDraftMap = {};
    let draftA = api.emptyContentIntelligenceIntakeDraft(scopeA, "research");
    draftA = api.reviseContentIntelligenceIntakeDraft(draftA, { open: true });
    draftA = api.reviseContentIntelligenceIntakeDraft(draftA, { sourceUrl: "https://example.test/a", sourceTitle: "A title", summary: "A summary" });
    const token = api.beginContentIntelligenceIntakeSave(ids, inFlight, scopeA, "research", draftA.revision);
    expect(token).toBeDefined();
    if (!token) return;
    expect(api.beginContentIntelligenceIntakeSave(ids, inFlight, scopeA, "research", draftA.revision)).toBeUndefined();
    drafts[token.draftKey] = api.contentIntelligenceIntakeDraftsWithFeedback({ [token.draftKey]: draftA }, token, token.requestId, "pending", "Saving…")[token.draftKey];

    let draftB = api.emptyContentIntelligenceIntakeDraft(scopeB, "research");
    draftB = api.reviseContentIntelligenceIntakeDraft(draftB, { open: true });
    draftB = api.reviseContentIntelligenceIntakeDraft(draftB, { sourceUrl: "https://example.test/b", sourceTitle: "B title", summary: "B summary" });
    const tokenB = api.beginContentIntelligenceIntakeSave(ids, inFlight, scopeB, "research", draftB.revision);
    expect(tokenB?.draftKey).not.toBe(token.draftKey);
    drafts[api.contentIntelligenceIntakeDraftKey(scopeB, "research")] = draftB;

    drafts = api.acknowledgeContentIntelligenceIntakeSave(drafts, token, token.requestId, "Saved.");
    const current = api.contentIntelligenceIntakeDraftsForScope(drafts, scopeB).research;
    expect(current).toMatchObject({ open: true, sourceUrl: "https://example.test/b", sourceTitle: "B title", summary: "B summary" });
    expect(api.contentIntelligenceIntakeDraftsForScope(drafts, scopeA).research).toMatchObject({ open: false, sourceUrl: "", sourceTitle: "", summary: "", status: "success" });
    if (tokenB) api.finishContentIntelligenceIntakeSave(ids, inFlight, tokenB);
  });

  it("keeps Brand A's rejected fields and notice scoped away from Brand B", async () => {
    const api = await intelligence();
    expect(api?.emptyContentIntelligenceIntakeDraft).toBeDefined();
    if (!api?.emptyContentIntelligenceIntakeDraft) return;

    const ids = new Map<string, number>();
    const inFlight = new Set<string>();
    let draftA = api.emptyContentIntelligenceIntakeDraft(scopeA, "trend");
    draftA = api.reviseContentIntelligenceIntakeDraft(draftA, { open: true });
    draftA = api.reviseContentIntelligenceIntakeDraft(draftA, { source: "A source", topic: "A topic", metric: "A metric" });
    const token = api.beginContentIntelligenceIntakeSave(ids, inFlight, scopeA, "trend", draftA.revision);
    expect(token).toBeDefined();
    if (!token) return;

    let drafts: ContentIntelligenceIntakeDraftMap = { [token.draftKey]: draftA };
    drafts = api.contentIntelligenceIntakeDraftsWithFeedback(drafts, token, token.requestId, "failure", "A Control Plane error.");
    let draftB = api.emptyContentIntelligenceIntakeDraft(scopeB, "trend");
    draftB = api.reviseContentIntelligenceIntakeDraft(draftB, { open: true });
    draftB = api.reviseContentIntelligenceIntakeDraft(draftB, { source: "B source", topic: "B topic", metric: "B metric" });
    drafts[api.contentIntelligenceIntakeDraftKey(scopeB, "trend")] = draftB;

    expect(api.contentIntelligenceIntakeDraftsForScope(drafts, scopeA).trend).toMatchObject({ open: true, source: "A source", topic: "A topic", metric: "A metric", status: "failure", message: "A Control Plane error." });
    expect(api.contentIntelligenceIntakeDraftsForScope(drafts, scopeB).trend).toMatchObject({ open: true, source: "B source", topic: "B topic", metric: "B metric", status: "idle", message: "" });
  });

  it("does not clear a newer revision when an older save acknowledges", async () => {
    const api = await intelligence();
    expect(api?.emptyContentIntelligenceIntakeDraft).toBeDefined();
    if (!api?.emptyContentIntelligenceIntakeDraft) return;

    const ids = new Map<string, number>();
    const inFlight = new Set<string>();
    let draft = api.emptyContentIntelligenceIntakeDraft(scopeA, "knowledge");
    draft = api.reviseContentIntelligenceIntakeDraft(draft, { title: "Submitted title", text: "Submitted text", provenance: "Owner" });
    const token = api.beginContentIntelligenceIntakeSave(ids, inFlight, scopeA, "knowledge", draft.revision);
    expect(token).toBeDefined();
    if (!token) return;
    draft = api.reviseContentIntelligenceIntakeDraft(draft, { title: "Newer title" });

    const result = api.acknowledgeContentIntelligenceIntakeSave({ [token.draftKey]: draft }, token, token.requestId, "Saved.");
    expect(result[token.draftKey]).toMatchObject({ title: "Newer title", text: "Submitted text", provenance: "Owner" });
  });

  it("allows approval only for active manage_brand membership and applies only an acknowledged approval", async () => {
    const api = await intelligence();
    expect(api?.canReviewResearchEvidence).toBeDefined();
    expect(api?.acknowledgeResearchEvidenceApproval).toBeDefined();
    if (!api?.canReviewResearchEvidence || !api.acknowledgeResearchEvidenceApproval) return;
    const manager = { id: "manager", workspaceId: "client-a", userId: "u1", displayName: "Manager", email: "manager@example.test", role: "admin" as const, status: "active" as const };
    const editor = { ...manager, role: "editor" as const };
    const suspended = { ...manager, status: "suspended" as const };
    expect(api.canReviewResearchEvidence(manager, "client-a")).toBe(true);
    expect(api.canReviewResearchEvidence(editor, "client-a")).toBe(false);
    expect(api.canReviewResearchEvidence(suspended, "client-a")).toBe(false);
    expect(api.canReviewResearchEvidence(manager, "client-b")).toBe(false);

    const pending = { id: "evidence-a", clientId: "client-a", brandId: "brand-a", sourceUrl: "https://example.test/a", sourceTitle: "A", retrievedAt: "2026-09-13T00:00:00Z", summary: "Summary", rightsState: "licensed" as const, reviewState: "pending" as const };
    expect(api.acknowledgeResearchEvidenceApproval([pending], pending, { id: pending.id, review_state: "pending" })).toEqual([pending]);
    expect(api.acknowledgeResearchEvidenceApproval([pending], pending, { id: pending.id, review_state: "approved" })).toMatchObject([{ reviewState: "approved" }]);
  });
});
