export type TrendSignal = { id: string; clientId: string; source: string; observedAt: string; topic: string; metric: string; evidenceIds: string[]; status: "observed" | "reviewed" };

export function validateTrendSignal(input: Record<string, unknown>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (["prediction", "forecast", "probability"].some((key) => key in input)) errors.push("TREND_PREDICTION_FIELD_REJECTED");
  for (const key of ["id", "clientId", "source", "observedAt", "topic", "metric", "status"]) if (typeof input[key] !== "string" || !input[key]) errors.push("TREND_REQUIRED_FIELD_MISSING");
  if (!Array.isArray(input.evidenceIds) || input.evidenceIds.some((id) => typeof id !== "string" || !id)) errors.push("TREND_EVIDENCE_REQUIRED");
  if (typeof input.observedAt === "string" && Number.isNaN(Date.parse(input.observedAt))) errors.push("TREND_OBSERVED_AT_INVALID");
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}
