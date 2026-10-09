import { serializeContentRecipe, type ContentRecipe } from "./contentRecipe";
import { canRole, type MembershipRecord } from "./workspaceDomain";

export type RightsState = "user_owned" | "licensed" | "unknown";
export type ReviewState = "pending" | "approved" | "archived";
export type KnowledgeItem = { id: string; clientId: string; brandId: string; kind: string; title: string; contentHash: string; provenance: string; rightsState: RightsState; reviewState: ReviewState; text: string; sourceUpdatedAt: string; archiveState?: "active" | "archived" };
export type ResearchEvidence = { id: string; clientId: string; brandId?: string | null; sourceUrl: string; sourceTitle: string; retrievedAt: string; summary: string; sourceType?: "operator_selected" | "manual_entry"; rightsState: RightsState; reviewState: ReviewState; archiveState?: "active" | "archived" };
export type PromptBlueprint = { id: string; brandId: string; identityId?: string; kind: string; template: string; version: number; status: "draft" | "active" | "archived" };
export type ContentIntelligenceTransform = "original" | "rewrite" | "repurpose" | "imitation" | "de_ai_detector_evasion";

export type ContentIntelligenceScope = { clientId: string; brandId: string };
export type ContentIntelligenceSelectionIssue = { field: "knowledge" | "research" | "promptBlueprint" | "recipe"; id: string; code: string; message: string };
export type ContentIntelligenceLineage = Readonly<{
  selectedKnowledgeItemIds: readonly string[];
  selectedResearchEvidenceIds: readonly string[];
  selectedPromptBlueprintId: string;
  selectedPromptBlueprintVersion?: number;
  selectedRecipeId: string;
  transformMode: ContentIntelligenceTransform;
  mediaSetFingerprint?: string;
  customerFacts: readonly string[];
}>;

export type ContentIntelligenceIntakeKind = "knowledge" | "research" | "trend";
export type ContentIntelligenceIntakeScope = { profileId: string; clientId: string; brandId: string };
export type ContentIntelligenceIntakeValues = {
  knowledge: { title: string; text: string; provenance: string; rightsState: "user_owned" | "licensed" };
  research: { sourceUrl: string; sourceTitle: string; summary: string; sourceType: "operator_selected" | "manual_entry"; rightsState: "user_owned" | "licensed" };
  trend: { source: string; topic: string; metric: string };
};
export type ContentIntelligenceIntakeDraft<K extends ContentIntelligenceIntakeKind = ContentIntelligenceIntakeKind> = {
  [Kind in K]: {
    kind: Kind;
    scope: ContentIntelligenceIntakeScope;
    open: boolean;
    revision: number;
    status: "idle" | "pending" | "success" | "failure";
    message: string;
  } & ContentIntelligenceIntakeValues[Kind]
}[K];
export type ContentIntelligenceIntakeDraftPatch<K extends ContentIntelligenceIntakeKind> = Partial<ContentIntelligenceIntakeValues[K]> & { open?: boolean };
export type ContentIntelligenceIntakeDraftMap = Record<string, ContentIntelligenceIntakeDraft>;
export type ContentIntelligenceIntakeDraftSet = { [K in ContentIntelligenceIntakeKind]: ContentIntelligenceIntakeDraft<K> };
export type ContentIntelligenceIntakeSaveToken = { draftKey: string; scope: ContentIntelligenceIntakeScope; kind: ContentIntelligenceIntakeKind; revision: number; requestId: number };

export function contentIntelligenceIntakeDraftKey(scope: ContentIntelligenceIntakeScope, kind: ContentIntelligenceIntakeKind): string {
  return JSON.stringify([scope.profileId, scope.clientId, scope.brandId, kind]);
}

export function emptyContentIntelligenceIntakeDraft<K extends ContentIntelligenceIntakeKind>(scope: ContentIntelligenceIntakeScope, kind: K): ContentIntelligenceIntakeDraft<K> {
  const common = { kind, scope, open: false, revision: 0, status: "idle" as const, message: "" };
  if (kind === "knowledge") return { ...common, title: "", text: "", provenance: "", rightsState: "user_owned" } as unknown as ContentIntelligenceIntakeDraft<K>;
  if (kind === "research") return { ...common, sourceUrl: "", sourceTitle: "", summary: "", sourceType: "operator_selected", rightsState: "user_owned" } as unknown as ContentIntelligenceIntakeDraft<K>;
  return { ...common, source: "", topic: "", metric: "" } as unknown as ContentIntelligenceIntakeDraft<K>;
}

export function contentIntelligenceIntakeDraftsForScope(drafts: ContentIntelligenceIntakeDraftMap, scope: ContentIntelligenceIntakeScope): ContentIntelligenceIntakeDraftSet {
  return {
    knowledge: (drafts[contentIntelligenceIntakeDraftKey(scope, "knowledge")] as ContentIntelligenceIntakeDraft<"knowledge"> | undefined) ?? emptyContentIntelligenceIntakeDraft(scope, "knowledge"),
    research: (drafts[contentIntelligenceIntakeDraftKey(scope, "research")] as ContentIntelligenceIntakeDraft<"research"> | undefined) ?? emptyContentIntelligenceIntakeDraft(scope, "research"),
    trend: (drafts[contentIntelligenceIntakeDraftKey(scope, "trend")] as ContentIntelligenceIntakeDraft<"trend"> | undefined) ?? emptyContentIntelligenceIntakeDraft(scope, "trend"),
  };
}

export function reviseContentIntelligenceIntakeDraft<K extends ContentIntelligenceIntakeKind>(draft: ContentIntelligenceIntakeDraft<K>, patch: ContentIntelligenceIntakeDraftPatch<K>): ContentIntelligenceIntakeDraft<K> {
  const edited = Object.keys(patch).some((key) => key !== "open");
  return { ...draft, ...patch, revision: draft.revision + Number(edited), ...(edited ? { status: "idle" as const, message: "" } : {}) } as unknown as ContentIntelligenceIntakeDraft<K>;
}

export function beginContentIntelligenceIntakeSave(requestIds: Map<string, number>, inFlight: Set<string>, scope: ContentIntelligenceIntakeScope, kind: ContentIntelligenceIntakeKind, revision: number): ContentIntelligenceIntakeSaveToken | undefined {
  const draftKey = contentIntelligenceIntakeDraftKey(scope, kind);
  if (inFlight.has(draftKey)) return undefined;
  const requestId = (requestIds.get(draftKey) ?? 0) + 1;
  requestIds.set(draftKey, requestId);
  inFlight.add(draftKey);
  return { draftKey, scope, kind, revision, requestId };
}

export function finishContentIntelligenceIntakeSave(requestIds: Map<string, number>, inFlight: Set<string>, token: ContentIntelligenceIntakeSaveToken): void {
  if (requestIds.get(token.draftKey) === token.requestId) inFlight.delete(token.draftKey);
}

export function contentIntelligenceIntakeDraftsWithFeedback(drafts: ContentIntelligenceIntakeDraftMap, token: ContentIntelligenceIntakeSaveToken, currentRequestId: number | undefined, status: "pending" | "success" | "failure", message: string): ContentIntelligenceIntakeDraftMap {
  const current = drafts[token.draftKey];
  if (!current || current.kind !== token.kind || current.revision !== token.revision || currentRequestId !== token.requestId) return drafts;
  return { ...drafts, [token.draftKey]: { ...current, status, message } as ContentIntelligenceIntakeDraft };
}

export function acknowledgeContentIntelligenceIntakeSave(drafts: ContentIntelligenceIntakeDraftMap, token: ContentIntelligenceIntakeSaveToken, currentRequestId: number | undefined, message: string): ContentIntelligenceIntakeDraftMap {
  const current = drafts[token.draftKey];
  if (!current || current.kind !== token.kind || current.revision !== token.revision || currentRequestId !== token.requestId) return drafts;
  const cleared = emptyContentIntelligenceIntakeDraft(token.scope, token.kind);
  return { ...drafts, [token.draftKey]: { ...cleared, revision: current.revision + 1, status: "success", message } as ContentIntelligenceIntakeDraft };
}

export function canReviewResearchEvidence(membership: MembershipRecord | undefined, clientId: string): boolean {
  return Boolean(membership && membership.workspaceId === clientId && membership.status === "active" && canRole(membership.role, "manage_brand"));
}

export function acknowledgeResearchEvidenceApproval(records: ResearchEvidence[], current: ResearchEvidence, acknowledgement: Record<string, unknown>): ResearchEvidence[] {
  const acknowledgedId = acknowledgement.id;
  const reviewState = acknowledgement.reviewState ?? acknowledgement.review_state;
  if (acknowledgedId !== current.id || reviewState !== "approved") return records;
  return records.map((item) => item.id === current.id && item.clientId === current.clientId && (item.brandId ?? null) === (current.brandId ?? null) && item.reviewState === "pending"
    ? { ...item, reviewState: "approved" }
    : item);
}

const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_CONTEXT = 12_000;

export function validateKnowledgeItem(item: Partial<KnowledgeItem>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!hasText(item.id) || !hasText(item.clientId) || !hasText(item.brandId) || !hasText(item.kind) || !hasText(item.title) || !hasText(item.provenance) || !hasText(item.text) || !hasText(item.sourceUpdatedAt)) errors.push("KNOWLEDGE_REQUIRED_FIELD_MISSING");
  if (!hasText(item.title)) errors.push("KNOWLEDGE_TITLE_MISSING");
  if (!hasText(item.provenance)) errors.push("KNOWLEDGE_PROVENANCE_MISSING");
  if (!hasText(item.text)) errors.push("KNOWLEDGE_TEXT_MISSING");
  if (!hasText(item.sourceUpdatedAt)) errors.push("KNOWLEDGE_SOURCE_UPDATED_AT_MISSING");
  if (!item.contentHash || !SHA256.test(item.contentHash)) errors.push("KNOWLEDGE_CONTENT_HASH_INVALID");
  if (item.archiveState === "archived") errors.push("KNOWLEDGE_ARCHIVED");
  if ((item.rightsState !== "user_owned" && item.rightsState !== "licensed") || item.reviewState !== "approved") errors.push("RIGHTS_OR_REVIEW_BLOCKED");
  return { ok: errors.length === 0, errors };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function issueMessage(code: string, id: string): string {
  const messages: Record<string, string> = {
    KNOWLEDGE_SELECTION_STALE: `Knowledge Item ${id} không còn trong scope hiện tại; bỏ chọn hoặc tải lại dữ liệu.`,
    RESEARCH_SELECTION_STALE: `Research Evidence ${id} không còn trong scope hiện tại; bỏ chọn hoặc tải lại dữ liệu.`,
    PROMPT_BLUEPRINT_SELECTION_STALE: `Prompt Blueprint ${id} không còn trong Brand hiện tại; chọn blueprint đang active.`,
    RECIPE_SELECTION_STALE: `Content Recipe ${id} không còn trong Brand hiện tại; chọn recipe đang active.`,
    KNOWLEDGE_ARCHIVED: `Knowledge Item ${id} đã archived; chọn nguồn active khác.`,
    KNOWLEDGE_REVIEW_PENDING: `Knowledge Item ${id} còn pending; cần approved review trước khi chọn.`,
    KNOWLEDGE_RIGHTS_INVALID: `Knowledge Item ${id} thiếu quyền user_owned/licensed; sửa rights trước khi chọn.`,
    RESEARCH_ARCHIVED: `Research Evidence ${id} đã archived; chọn evidence active khác.`,
    RESEARCH_REVIEW_PENDING: `Research Evidence ${id} còn pending; cần matching approved ACK trước khi chọn.`,
    KNOWLEDGE_SCOPE_MISMATCH: `Knowledge Item ${id} khác Client/Brand hiện tại; bỏ chọn nguồn này.`,
    RESEARCH_SCOPE_MISMATCH: `Research Evidence ${id} khác Client/Brand hiện tại; bỏ chọn nguồn này.`,
    PROMPT_BLUEPRINT_SCOPE_MISMATCH: `Prompt Blueprint ${id} khác Brand hiện tại; chọn blueprint đúng scope.`,
    PROMPT_BLUEPRINT_INACTIVE: `Prompt Blueprint ${id} chưa active; chọn blueprint active.`,
    RECIPE_SCOPE_MISMATCH: `Content Recipe ${id} khác Brand hiện tại; chọn recipe đúng scope.`,
    RECIPE_INACTIVE: `Content Recipe ${id} chưa active; chọn recipe active.`,
    KNOWLEDGE_SELECTION_DUPLICATE: `Knowledge Item ${id} bị chọn lặp; giữ một ID duy nhất.`,
    RESEARCH_SELECTION_DUPLICATE: `Research Evidence ${id} bị chọn lặp; giữ một ID duy nhất.`,
    PROMPT_BLUEPRINT_REQUIRED_FIELDS: `Prompt Blueprint ${id} thiếu ID hoặc version hợp lệ.`,
    RECIPE_REQUIRED_FIELDS: `Content Recipe ${id} thiếu ID hoặc name hợp lệ.`,
  };
  return messages[code] ?? `${code}: sửa lựa chọn ${id} trước khi gửi. `;
}

export function validateContentIntelligenceRecord(kind: "knowledge", item: Partial<KnowledgeItem>, scope: ContentIntelligenceScope): { ok: boolean; errors: string[] };
export function validateContentIntelligenceRecord(kind: "research", item: Partial<ResearchEvidence>, scope: ContentIntelligenceScope): { ok: boolean; errors: string[] };
export function validateContentIntelligenceRecord(kind: "knowledge" | "research", item: Partial<KnowledgeItem> | Partial<ResearchEvidence>, scope: ContentIntelligenceScope): { ok: boolean; errors: string[] } {
  if (kind === "knowledge") {
    const result = validateKnowledgeItem(item as Partial<KnowledgeItem>);
    const scopeErrors = item.clientId !== scope.clientId || item.brandId !== scope.brandId ? ["KNOWLEDGE_SCOPE_MISMATCH"] : [];
    const knowledge = item as Partial<KnowledgeItem>;
    const reviewErrors = knowledge.reviewState === "pending" ? ["KNOWLEDGE_REVIEW_PENDING"] : [];
    const rightsErrors = knowledge.rightsState !== "user_owned" && knowledge.rightsState !== "licensed" ? ["KNOWLEDGE_RIGHTS_INVALID"] : [];
    return { ok: result.ok && scopeErrors.length === 0, errors: [...scopeErrors, ...result.errors, ...reviewErrors, ...rightsErrors] };
  }
  const evidence = item as Partial<ResearchEvidence>;
  const errors: string[] = [];
  if (!hasText(evidence.id) || !hasText(evidence.clientId) || !hasText(evidence.sourceUrl) || !evidence.sourceUrl.trim().startsWith("https://") || !hasText(evidence.sourceTitle) || !hasText(evidence.retrievedAt) || Number.isNaN(Date.parse(evidence.retrievedAt)) || !hasText(evidence.summary)) errors.push("RESEARCH_REQUIRED_FIELD_MISSING");
  if (evidence.archiveState === "archived") errors.push("RESEARCH_ARCHIVED");
  if (evidence.clientId !== scope.clientId || Boolean(evidence.brandId) && evidence.brandId !== scope.brandId) errors.push("RESEARCH_SCOPE_MISMATCH");
  if (evidence.rightsState !== "user_owned" && evidence.rightsState !== "licensed") errors.push("RIGHTS_OR_REVIEW_BLOCKED");
  if (evidence.reviewState !== "approved") errors.push(evidence.reviewState === "pending" ? "RESEARCH_REVIEW_PENDING" : "RIGHTS_OR_REVIEW_BLOCKED");
  return { ok: errors.length === 0, errors };
}

export function validateContentIntelligenceSelection<Blueprint extends Pick<PromptBlueprint, "id" | "brandId" | "kind" | "version" | "status"> = PromptBlueprint, Recipe extends Pick<ContentRecipe, "id" | "brandId" | "name" | "status"> = ContentRecipe>(input: {
  scope: ContentIntelligenceScope;
  knowledgeItems: readonly KnowledgeItem[];
  selectedKnowledgeItemIds: readonly string[];
  researchEvidence: readonly ResearchEvidence[];
  selectedResearchEvidenceIds: readonly string[];
  promptBlueprints: readonly Blueprint[];
  selectedPromptBlueprintId?: string;
  contentRecipes: readonly Recipe[];
  selectedRecipeId?: string;
}): { ok: boolean; selectedKnowledgeItems: KnowledgeItem[]; selectedResearchEvidence: ResearchEvidence[]; selectedPromptBlueprint?: Blueprint; selectedRecipe?: Recipe; issues: ContentIntelligenceSelectionIssue[] } {
  const issues: ContentIntelligenceSelectionIssue[] = [];
  const selectedKnowledgeItems: KnowledgeItem[] = [];
  const selectedResearchEvidence: ResearchEvidence[] = [];
  const addIssues = (field: ContentIntelligenceSelectionIssue["field"], id: string, errors: readonly string[]) => errors.forEach((code) => issues.push({ field, id, code, message: issueMessage(code, id) }));
  const seenKnowledge = new Set<string>();
  for (const id of input.selectedKnowledgeItemIds) {
    if (seenKnowledge.has(id)) addIssues("knowledge", id, ["KNOWLEDGE_SELECTION_DUPLICATE"]);
    seenKnowledge.add(id);
    const item = input.knowledgeItems.find((candidate) => candidate.id === id);
    if (!item) { addIssues("knowledge", id, ["KNOWLEDGE_SELECTION_STALE"]); continue; }
    const result = validateContentIntelligenceRecord("knowledge", item, input.scope);
    if (result.ok) selectedKnowledgeItems.push(item); else addIssues("knowledge", id, result.errors);
  }
  const seenEvidence = new Set<string>();
  for (const id of input.selectedResearchEvidenceIds) {
    if (seenEvidence.has(id)) addIssues("research", id, ["RESEARCH_SELECTION_DUPLICATE"]);
    seenEvidence.add(id);
    const item = input.researchEvidence.find((candidate) => candidate.id === id);
    if (!item) { addIssues("research", id, ["RESEARCH_SELECTION_STALE"]); continue; }
    const result = validateContentIntelligenceRecord("research", item, input.scope);
    if (result.ok) selectedResearchEvidence.push(item); else addIssues("research", id, result.errors);
  }
  let selectedPromptBlueprint: Blueprint | undefined;
  const blueprintId = input.selectedPromptBlueprintId?.trim() ?? "";
  if (blueprintId) {
    const item = input.promptBlueprints.find((candidate) => candidate.id === blueprintId);
    if (!item) addIssues("promptBlueprint", blueprintId, ["PROMPT_BLUEPRINT_SELECTION_STALE"]);
    else {
      const errors = [
        ...(item.brandId !== input.scope.brandId ? ["PROMPT_BLUEPRINT_SCOPE_MISMATCH"] : []),
        ...(item.status !== "active" ? ["PROMPT_BLUEPRINT_INACTIVE"] : []),
        ...(!hasText(item.id) || !Number.isSafeInteger(item.version) || item.version < 1 ? ["PROMPT_BLUEPRINT_REQUIRED_FIELDS"] : []),
      ];
      if (errors.length) addIssues("promptBlueprint", blueprintId, errors); else selectedPromptBlueprint = item;
    }
  }
  let selectedRecipe: Recipe | undefined;
  const recipeId = input.selectedRecipeId?.trim() ?? "";
  if (recipeId) {
    const item = input.contentRecipes.find((candidate) => candidate.id === recipeId);
    if (!item) addIssues("recipe", recipeId, ["RECIPE_SELECTION_STALE"]);
    else {
      const errors = [
        ...(item.brandId !== input.scope.brandId ? ["RECIPE_SCOPE_MISMATCH"] : []),
        ...(item.status !== "active" ? ["RECIPE_INACTIVE"] : []),
        ...(!hasText(item.id) || !hasText(item.name) ? ["RECIPE_REQUIRED_FIELDS"] : []),
      ];
      if (errors.length) addIssues("recipe", recipeId, errors); else selectedRecipe = item;
    }
  }
  return { ok: issues.length === 0, selectedKnowledgeItems, selectedResearchEvidence, ...(selectedPromptBlueprint ? { selectedPromptBlueprint } : {}), ...(selectedRecipe ? { selectedRecipe } : {}), issues };
}

export function captureContentIntelligenceLineage(input: {
  selectedKnowledgeItemIds: readonly string[];
  selectedResearchEvidenceIds: readonly string[];
  selectedPromptBlueprintId?: string;
  selectedPromptBlueprintVersion?: number;
  selectedRecipeId?: string;
  transformMode: ContentIntelligenceTransform;
  mediaSetFingerprint?: string;
  customerFacts: readonly string[];
}): ContentIntelligenceLineage {
  return Object.freeze({
    selectedKnowledgeItemIds: Object.freeze([...input.selectedKnowledgeItemIds]),
    selectedResearchEvidenceIds: Object.freeze([...input.selectedResearchEvidenceIds]),
    selectedPromptBlueprintId: input.selectedPromptBlueprintId?.trim() ?? "",
    ...(input.selectedPromptBlueprintVersion !== undefined ? { selectedPromptBlueprintVersion: input.selectedPromptBlueprintVersion } : {}),
    selectedRecipeId: input.selectedRecipeId?.trim() ?? "",
    transformMode: input.transformMode,
    ...(input.mediaSetFingerprint ? { mediaSetFingerprint: input.mediaSetFingerprint.toLowerCase() } : {}),
    customerFacts: Object.freeze([...input.customerFacts]),
  });
}

export function contentIntelligenceLineageFields(lineage: ContentIntelligenceLineage): Record<string, unknown> {
  return {
    selectedKnowledgeItemIds: [...lineage.selectedKnowledgeItemIds],
    selectedResearchEvidenceIds: [...lineage.selectedResearchEvidenceIds],
    selectedPromptBlueprintId: lineage.selectedPromptBlueprintId,
    ...(lineage.selectedPromptBlueprintVersion !== undefined ? { selectedPromptBlueprintVersion: lineage.selectedPromptBlueprintVersion } : {}),
    selectedRecipeId: lineage.selectedRecipeId,
    ...(lineage.selectedRecipeId ? { recipeId: lineage.selectedRecipeId } : {}),
    transformMode: lineage.transformMode,
    ...(lineage.mediaSetFingerprint ? { mediaSetFingerprint: lineage.mediaSetFingerprint } : {}),
    customerFacts: [...lineage.customerFacts],
    contentIntelligenceLineage: lineage,
  };
}

export function buildContentIntelligenceContext(input: { clientId: string; brandId: string; identityVersionId: string; knowledgeItems: KnowledgeItem[]; selectedKnowledgeItemIds: string[]; researchEvidence: ResearchEvidence[]; selectedResearchEvidenceIds: string[]; promptBlueprint?: PromptBlueprint; recipe?: ContentRecipe; userBrief: string; transformMode?: ContentIntelligenceTransform }): { ok: true; context: string; sourceMetadata: Array<{ id: string; title: string }> } | { ok: false; code: "RIGHTS_OR_REVIEW_BLOCKED" } {
  const selection = validateContentIntelligenceSelection({
    scope: { clientId: input.clientId, brandId: input.brandId },
    knowledgeItems: input.knowledgeItems,
    selectedKnowledgeItemIds: input.selectedKnowledgeItemIds,
    researchEvidence: input.researchEvidence,
    selectedResearchEvidenceIds: input.selectedResearchEvidenceIds,
    promptBlueprints: input.promptBlueprint ? [input.promptBlueprint] : [],
    selectedPromptBlueprintId: input.promptBlueprint?.id,
    contentRecipes: input.recipe ? [input.recipe] : [],
    selectedRecipeId: input.recipe?.id,
  });
  if (!selection.ok) return { ok: false, code: "RIGHTS_OR_REVIEW_BLOCKED" };
  const selectedKnowledge = selection.selectedKnowledgeItems;
  const selectedEvidence = selection.selectedResearchEvidence;
  if ((input.transformMode === "repurpose" || input.transformMode === "imitation") && selectedKnowledge.length + selectedEvidence.length === 0) return { ok: false, code: "RIGHTS_OR_REVIEW_BLOCKED" };
  const entries = [
    `Identity version: ${input.identityVersionId}`,
    ...(input.promptBlueprint ? [`Prompt blueprint ${input.promptBlueprint.id} v${input.promptBlueprint.version}: ${input.promptBlueprint.template}`] : []),
    ...(input.recipe ? [`Content recipe ${input.recipe.id} v1:\n${serializeContentRecipe(input.recipe)}`] : []),
    ...selectedKnowledge.map((item) => `Knowledge ${item.id} (${item.title}): ${item.text}`),
    ...selectedEvidence.map((item) => `Evidence ${item.id} (${item.sourceTitle}, ${item.retrievedAt}): ${item.summary}`),
    `Brief: ${input.userBrief}`,
  ];
  const context = entries.join("\n\n").slice(0, MAX_CONTEXT);
  return { ok: true, context, sourceMetadata: [...selectedKnowledge.map((item) => ({ id: item.id, title: item.title })), ...selectedEvidence.map((item) => ({ id: item.id, title: item.sourceTitle }))] };
}
