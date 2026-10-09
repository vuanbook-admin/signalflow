import type { AIGateway } from "./gateway";
import type { AIGenerationRequest, AIGenerationResult } from "./mvpContracts";
import { buildContentIntelligenceContext, captureContentIntelligenceLineage, contentIntelligenceLineageFields, validateContentIntelligenceSelection, type ContentIntelligenceLineage, type ContentIntelligenceSelectionIssue, type ContentIntelligenceTransform, type KnowledgeItem, type PromptBlueprint, type ResearchEvidence } from "./contentIntelligence";
import type { ContentRecipe } from "./contentRecipe";
import { createContentRunWithMediaOwnership, type ContentRunMediaOwnershipInput } from "./contentRunMedia";

export type ContentIntelligenceDispatchTransport = {
  createContentRun: (payload: Record<string, unknown>) => Promise<unknown>;
  getContentRun?: (id: string) => Promise<Record<string, unknown> | undefined>;
  updateContentRun: (id: string, payload: Record<string, unknown>) => Promise<unknown>;
};

export type ContentIntelligenceDispatchInput = {
  runId: string;
  identityVersionId: string;
  userBrief: string;
  selectedKnowledgeItemIds: readonly string[];
  selectedResearchEvidenceIds: readonly string[];
  knowledgeItems: readonly KnowledgeItem[];
  researchEvidence: readonly ResearchEvidence[];
  promptBlueprints: readonly PromptBlueprint[];
  selectedPromptBlueprintId?: string;
  contentRecipes: readonly ContentRecipe[];
  selectedRecipeId?: string;
  clientId: string;
  brandId: string;
  transformMode: ContentIntelligenceTransform;
  mediaSetFingerprint?: string;
  mediaEvidence?: readonly unknown[];
  customerFacts: readonly string[];
  promptBuilder: (context: string) => string;
  request: AIGenerationRequest;
  gateway: AIGateway;
  transport?: ContentIntelligenceDispatchTransport;
  createPayload?: Record<string, unknown>;
  beforeGenerate?: () => void | Promise<void>;
  completionPayload?: (result: AIGenerationResult, lineage: ContentIntelligenceLineage, prompt: string) => Record<string, unknown>;
  onCreatePersisted?: () => void;
  onLineageCaptured?: (lineage: ContentIntelligenceLineage) => void;
  mediaOwnership?: ContentRunMediaOwnershipInput;
  gatewayRequestCount?: () => number;
};

export type ContentIntelligenceDispatchResult =
  | { ok: false; code: "CONTENT_INTELLIGENCE_SELECTION_BLOCKED"; issues: ContentIntelligenceSelectionIssue[]; gatewayRequestCount: 0 }
  | { ok: true; context: string; prompt: string; lineage: ContentIntelligenceLineage; request: AIGenerationRequest; createPayload: Record<string, unknown>; completionPayload?: Record<string, unknown>; result: AIGenerationResult; gatewayRequestCount: number };

export async function dispatchContentIntelligenceRun(input: ContentIntelligenceDispatchInput): Promise<ContentIntelligenceDispatchResult> {
  if (input.mediaOwnership && !input.transport) throw new Error("CONTENT_RUN_CONTROL_PLANE_REQUIRED");
  if (input.mediaOwnership && (input.mediaOwnership.scope.clientId !== input.clientId || input.mediaOwnership.scope.brandId !== input.brandId)) throw new Error("MEDIA_ATTACHMENT_SCOPE_MISMATCH");
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
  if (!selection.ok) {
    return { ok: false, code: "CONTENT_INTELLIGENCE_SELECTION_BLOCKED", issues: selection.issues, gatewayRequestCount: 0 };
  }
  if (!selection.selectedPromptBlueprint || !selection.selectedRecipe || (input.mediaEvidence?.length && !input.mediaSetFingerprint)) {
    return { ok: false, code: "CONTENT_INTELLIGENCE_SELECTION_BLOCKED", issues: [{ field: !selection.selectedPromptBlueprint ? "promptBlueprint" : "recipe", id: input.runId, code: "CONTENT_INTELLIGENCE_LINEAGE_INVALID", message: "Complete blueprint, version, recipe, customer facts and media fingerprint lineage before dispatch." }], gatewayRequestCount: 0 };
  }
  const contextResult = buildContentIntelligenceContext({
    clientId: input.clientId,
    brandId: input.brandId,
    identityVersionId: input.identityVersionId,
    knowledgeItems: input.knowledgeItems as KnowledgeItem[],
    selectedKnowledgeItemIds: [...input.selectedKnowledgeItemIds],
    researchEvidence: input.researchEvidence as ResearchEvidence[],
    selectedResearchEvidenceIds: [...input.selectedResearchEvidenceIds],
    promptBlueprint: selection.selectedPromptBlueprint,
    recipe: selection.selectedRecipe,
    userBrief: input.userBrief,
    transformMode: input.transformMode,
  });
  if (!contextResult.ok) {
    return { ok: false, code: "CONTENT_INTELLIGENCE_SELECTION_BLOCKED", issues: [{ field: "knowledge", id: "content-intelligence", code: contextResult.code, message: contextResult.code }], gatewayRequestCount: 0 };
  }
  const prompt = input.promptBuilder(contextResult.context);
  if (!prompt.trim()) {
    return { ok: false, code: "CONTENT_INTELLIGENCE_SELECTION_BLOCKED", issues: [{ field: "promptBlueprint", id: input.runId, code: "CONTENT_INTELLIGENCE_LINEAGE_INVALID", message: "Prompt provenance is required before dispatch." }], gatewayRequestCount: 0 };
  }
  const lineage = captureContentIntelligenceLineage({
    selectedKnowledgeItemIds: selection.selectedKnowledgeItems.map((item) => item.id),
    selectedResearchEvidenceIds: selection.selectedResearchEvidence.map((item) => item.id),
    selectedPromptBlueprintId: selection.selectedPromptBlueprint?.id,
    selectedPromptBlueprintVersion: selection.selectedPromptBlueprint?.version,
    selectedRecipeId: selection.selectedRecipe?.id,
    transformMode: input.transformMode,
    mediaSetFingerprint: input.mediaSetFingerprint,
    customerFacts: input.customerFacts,
  });
  input.onLineageCaptured?.(lineage);
  const lineageFields = contentIntelligenceLineageFields(lineage);
  const request: AIGenerationRequest = { ...input.request, prompt, metadata: { ...input.request.metadata, ...lineageFields } };
  const createPayload = { ...input.createPayload, id: input.runId, prompt, ...lineageFields, generationStatus: "pending", state: input.createPayload?.state ?? "needs_review" };
  if (input.transport) {
    await createContentRunWithMediaOwnership(input.mediaOwnership, () => input.transport!.createContentRun(createPayload), { runId: input.runId, getContentRun: input.transport.getContentRun });
    input.onCreatePersisted?.();
  }
  await input.beforeGenerate?.();
  const result = await input.gateway.generate(request);
  const completionPayload = input.completionPayload?.(result, lineage, prompt);
  if (input.transport && completionPayload) await input.transport.updateContentRun(input.runId, { ...completionPayload, prompt, ...lineageFields, generationStatus: "completed", providerTraceId: result.traceId });
  return { ok: true, context: contextResult.context, prompt, lineage, request, createPayload, ...(completionPayload ? { completionPayload: { ...completionPayload, prompt, ...lineageFields, generationStatus: "completed", providerTraceId: result.traceId } } : {}), result, gatewayRequestCount: Math.max(1, input.gatewayRequestCount?.() ?? 1) };
}
