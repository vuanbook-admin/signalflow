export type AnalyticsEvent = { eventName: string; clientId: string; brandId: string; occurredAt: string; properties: Record<string, unknown> };
export type MetricFilter = { clientId: string; brandId: string; platform?: string; bindingId?: string; from?: string; to?: string };
export type AnalyticsReadiness = { state: "READY" | "STALE" | "DEGRADED" | "NOT_INSTRUMENTED"; decisionUse: boolean };

function isNonLiveProperties(properties: Record<string, unknown>): boolean {
  return properties.simulation === true || properties.legacyNonLive === true || properties.legacy_non_live === true;
}

function publicationMatchesFilter(publication: { clientId: string; brandId: string; platform?: string; bindingId?: string; terminalAt?: string }, filter: MetricFilter): boolean {
  if (publication.clientId !== filter.clientId || publication.brandId !== filter.brandId) return false;
  if (filter.platform && publication.platform !== filter.platform) return false;
  if (filter.bindingId && publication.bindingId !== filter.bindingId) return false;
  if (!filter.from && !filter.to) return true;
  const terminalAt = Date.parse(publication.terminalAt ?? "");
  if (Number.isNaN(terminalAt)) return false;
  const from = filter.from ? Date.parse(filter.from) : Number.NEGATIVE_INFINITY;
  const to = filter.to ? Date.parse(filter.to) : Number.POSITIVE_INFINITY;
  if ((filter.from && !Number.isFinite(from)) || (filter.to && !Number.isFinite(to))) return false;
  return terminalAt >= from && terminalAt <= to;
}

export function eventMatchesFilter(event: AnalyticsEvent, filter: MetricFilter): boolean {
  if (event.clientId !== filter.clientId || event.brandId !== filter.brandId) return false;
  if (filter.platform && event.properties.platform !== filter.platform) return false;
  if (filter.bindingId && event.properties.bindingId !== filter.bindingId) return false;
  if (!filter.from && !filter.to) return true;
  const occurredAt = Date.parse(event.occurredAt);
  if (Number.isNaN(occurredAt)) return false;
  const from = filter.from ? Date.parse(filter.from) : Number.NEGATIVE_INFINITY;
  const to = filter.to ? Date.parse(filter.to) : Number.POSITIVE_INFINITY;
  if ((filter.from && !Number.isFinite(from)) || (filter.to && !Number.isFinite(to))) return false;
  return occurredAt >= from && occurredAt <= to;
}

export function analyticsReadiness(input: { dataAsOf?: string; workerReconciledAt?: string; now: string; workerState: "running" | "degraded" | "stopped"; instrumented: boolean }): AnalyticsReadiness {
  if (!input.instrumented) return { state: "NOT_INSTRUMENTED", decisionUse: false };
  if (input.workerState === "degraded" || input.workerState === "stopped") return { state: "DEGRADED", decisionUse: false };
  const timestamps = [input.dataAsOf, input.workerReconciledAt].filter((value): value is string => Boolean(value)).map((value) => Date.parse(value));
  const now = Date.parse(input.now);
  if (!timestamps.length || Number.isNaN(now) || timestamps.some((value) => Number.isNaN(value) || now - value > 15 * 60_000)) return { state: "STALE", decisionUse: false };
  return { state: "READY", decisionUse: true };
}

export function filterAnalyticsEvents<T extends AnalyticsEvent>(events: T[], filter: MetricFilter): T[] {
  return events.filter((event) => !isNonLiveProperties(event.properties) && eventMatchesFilter(event, filter));
}

export function reviewDecisionApprovalRate(events: AnalyticsEvent[], filter: MetricFilter): { state: "NOT_INSTRUMENTED"; code: "NO_REVIEW_DECISIONS" } | { state: "READY"; value: number; numerator: number; denominator: number } {
  const decisions = events.filter((event) => event.eventName === "approval.decided" && !isNonLiveProperties(event.properties) && eventMatchesFilter(event, filter) && (event.properties.decision === "approved" || event.properties.decision === "rejected"));
  const numerator = decisions.filter((event) => event.properties.decision === "approved").length;
  const denominator = decisions.length;
  if (!denominator) return { state: "NOT_INSTRUMENTED", code: "NO_REVIEW_DECISIONS" };
  return { state: "READY", value: numerator / denominator, numerator, denominator };
}

export function targetPublishSuccessRate(publications: Array<{ clientId: string; brandId: string; platform?: string; bindingId?: string; terminalAt?: string; state: string; providerJobId?: string; simulation?: boolean; legacyNonLive?: boolean }>, filter: MetricFilter): { state: "NOT_INSTRUMENTED"; code: "NO_TERMINAL_PUBLICATIONS" } | { state: "READY"; value: number; numerator: number; denominator: number } {
  const terminal = publications.filter((item) => publicationMatchesFilter(item, filter) && item.simulation !== true && item.legacyNonLive !== true && (item.state === "permanent_error" || item.state === "published" && Boolean(item.providerJobId?.trim())));
  const numerator = terminal.filter((item) => item.state === "published" && Boolean(item.providerJobId?.trim())).length;
  if (!terminal.length) return { state: "NOT_INSTRUMENTED", code: "NO_TERMINAL_PUBLICATIONS" };
  return { state: "READY", value: numerator / terminal.length, numerator, denominator: terminal.length };
}

export function preflightBlockRateByReason(events: AnalyticsEvent[], filter: MetricFilter, reason: string): { state: "NOT_INSTRUMENTED"; code: "NO_RECENT_PREFLIGHT_DATA" } | { state: "READY"; value: number; numerator: number; denominator: number } {
  const checks = events.filter((event) => event.eventName === "preflight.checked" && !isNonLiveProperties(event.properties) && eventMatchesFilter(event, filter));
  if (!checks.length) return { state: "NOT_INSTRUMENTED", code: "NO_RECENT_PREFLIGHT_DATA" };
  const numerator = checks.filter((event) => event.properties.blockReason === reason).length;
  return { state: "READY", value: numerator / checks.length, numerator, denominator: checks.length };
}
