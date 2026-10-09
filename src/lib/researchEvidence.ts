import type { RightsState, ReviewState } from "./contentIntelligence";

export type ResearchEvidenceRecord = { id: string; clientId: string; sourceUrl: string; sourceTitle: string; retrievedAt: string; summary: string; sourceType: "operator_selected" | "manual_entry"; rightsState: RightsState; reviewState: ReviewState };

export function validateResearchEvidence(item: Partial<ResearchEvidenceRecord>, clientId: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!item.id || !item.clientId || !item.sourceUrl?.startsWith("https://") || !item.sourceTitle || !item.summary) errors.push("RESEARCH_REQUIRED_FIELD_MISSING");
  if (!item.retrievedAt || Number.isNaN(Date.parse(item.retrievedAt))) errors.push("RESEARCH_RETRIEVED_AT_REQUIRED");
  if (item.clientId !== clientId || (item.rightsState !== "user_owned" && item.rightsState !== "licensed") || item.reviewState !== "approved") errors.push("RIGHTS_OR_REVIEW_BLOCKED");
  return { ok: errors.length === 0, errors };
}
