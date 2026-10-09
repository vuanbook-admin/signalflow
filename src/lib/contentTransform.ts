import type { RightsState, ReviewState } from "./contentIntelligence";

export type ContentTransformMode = "original" | "rewrite" | "repurpose" | "imitation" | "de_ai_detector_evasion";

export function validateContentTransform(input: { mode: ContentTransformMode; sourceRef?: string; rightsState?: RightsState; reviewState?: ReviewState }): { ok: true } | { ok: false; code: "RIGHTS_BLOCKED" } {
  if (input.mode === "repurpose" || input.mode === "imitation") {
    if (!input.sourceRef || (input.rightsState !== "user_owned" && input.rightsState !== "licensed") || input.reviewState !== "approved") return { ok: false, code: "RIGHTS_BLOCKED" };
  }
  return { ok: true };
}

export function transformGuidance(mode: ContentTransformMode): { sourceRefRequired: boolean; reviewGuidance: string } {
  if (mode === "de_ai_detector_evasion") return { sourceRefRequired: false, reviewGuidance: "Cải thiện độ tự nhiên; không bảo đảm kết quả detector. Preserve internal provenance and review factual claims." };
  return { sourceRefRequired: mode === "repurpose" || mode === "imitation", reviewGuidance: "Review source rights, identity match, factual accuracy, platform fit, and transform trace before approval." };
}
