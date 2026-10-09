import type { AutomationPlan, AutomationPlatformPlan, AutomationCronSchedule } from "./automationPlanner";
import { resolveFormatSequence, resolveLocalDateTime } from "./contentStrategyResolver";
import type { AutomationDateRange, CampaignScheduleTemplate } from "./contentStrategyResolver";

export type { CampaignScheduleTemplate, ResolvedAutomationSlot } from "./contentStrategyResolver";
export { buildAutomationStrategySnapshot, buildResolvedAutomationSlots, captureAutomationStrategySnapshot, cloneCampaignScheduleTemplate, resolveFormatSequence, resolveLocalDateTime } from "./contentStrategyResolver";
export type { AutomationDateRange } from "./contentStrategyResolver";

export type AutomationSchedulerMode = "in_process";

export const automationSchedulerMode: AutomationSchedulerMode = "in_process";

export const automationSchedulerNote = "Portable in-process scheduler: runs on the shared application timer while SignalFlow is open.";

export type ScheduledAtJob = { scheduledAt: string };

export function localDateKey(date: Date): string {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function filterScheduledJobsForDate<T extends ScheduledAtJob>(jobs: readonly T[], selectedDate: string): T[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return [...jobs];
  return jobs.filter((job) => job.scheduledAt.slice(0, 10) === selectedDate);
}

function zonedParts(date: Date, timezone: string): { year: number; month: number; day: number } {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

export function nextScheduledAtForRunDays(now: Date, publishTime: string, timezone: string, runDays: readonly number[]): Date {
  const local = zonedParts(now, timezone);
  const base = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const weekday = ((base.getUTCDay() + 6) % 7) + 1;
  for (let delta = 0; delta <= 7; delta += 1) {
    const candidateDay = new Date(base.getTime() + delta * 86_400_000);
    const candidateWeekday = ((weekday - 1 + delta) % 7) + 1;
    if (!runDays.includes(candidateWeekday)) continue;
    const date = candidateDay.toISOString().slice(0, 10);
    const resolved = resolveLocalDateTime(date, publishTime, timezone);
    if (resolved.ok && resolved.value.getTime() > now.getTime()) return resolved.value;
  }
  throw new Error("SCHEDULE_RUN_DAYS_INVALID");
}

export function cronScopeKey(platform: AutomationCronSchedule["platform"], pageId?: string): string {
  return pageId ? `page:${pageId}` : `platform:${platform}`;
}

export function setDailyCronForScope(plan: AutomationPlan, input: { platform: AutomationCronSchedule["platform"]; pageId?: string; bindingId?: string; startTime?: string; timezone?: string; now?: Date }): AutomationPlan {
  const key = cronScopeKey(input.platform, input.pageId);
  const now = input.now ?? new Date();
  const revision = (plan.cronSchedules?.[key]?.revision ?? plan.revision ?? 1) + 1;
  const schedule: AutomationCronSchedule = {
    scopeId: key,
    platform: input.platform,
    pageId: input.pageId,
    bindingId: input.bindingId,
    enabled: true,
    startTime: input.startTime ?? plan.cron.startTime,
    timezone: input.timezone ?? plan.cron.timezone,
    revision,
    updatedAt: now.toISOString(),
  };
  return { ...plan, cron: { ...plan.cron, enabled: true }, cronSchedules: { ...(plan.cronSchedules ?? {}), [key]: schedule }, revision, updatedAt: now.toISOString() };
}

export type AutomationUpcomingJob = {
  id: string;
  planId: string;
  scopeId: string;
  platform: AutomationCronSchedule["platform"];
  pageId?: string;
  bindingId?: string;
  publishTime: string;
  postIndex: number;
  mediaKind: "image" | "video";
  contentKind: "image" | "video" | "short_video";
  nextActionAt: string;
  revision: number;
  scheduleSource?: "campaign_template" | "scope";
  weekday?: number;
};

function dateRangeValues(range: AutomationDateRange | undefined): { startDate: string; endDate: string } | undefined {
  if (!range) return undefined;
  const startDate = range.startDate ?? range.start;
  const endDate = range.endDate ?? range.end;
  return typeof startDate === "string" && typeof endDate === "string" ? { startDate, endDate } : undefined;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 9999) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isValidAutomationTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isoWeekday(dateKey: string): number {
  const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function nextScheduledAtForTemplate(now: Date, postIndex: number, timezone: string, runDays: readonly number[], template: CampaignScheduleTemplate, dateRange?: AutomationDateRange): { scheduledAt: Date; publishTime: string; weekday: number } | undefined {
  const local = zonedParts(now, timezone);
  const base = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const range = dateRangeValues(dateRange);
  for (let delta = 0; delta <= 370; delta += 1) {
    const candidateDay = new Date(base.getTime() + delta * 86_400_000);
    const date = candidateDay.toISOString().slice(0, 10);
    if (range && date < range.startDate) continue;
    if (range && date > range.endDate) return undefined;
    const weekday = isoWeekday(date);
    if (!runDays.includes(weekday)) continue;
    const publishTime = template.timesByWeekday?.[weekday]?.[postIndex];
    if (!publishTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(publishTime)) continue;
    const resolved = resolveLocalDateTime(date, publishTime, timezone);
    if (resolved.ok && resolved.value.getTime() > now.getTime()) return { scheduledAt: resolved.value, publishTime, weekday };
  }
  return undefined;
}

function nextScheduledAtInRange(now: Date, publishTime: string, timezone: string, runDays: readonly number[], dateRange?: AutomationDateRange): { scheduledAt: Date; weekday: number } | undefined {
  const range = dateRangeValues(dateRange);
  if (!range) {
    try {
      const scheduledAt = nextScheduledAtForRunDays(now, publishTime, timezone, runDays);
      return { scheduledAt, weekday: isoWeekday(localDateKeyForTimezone(scheduledAt, timezone)) };
    } catch {
      return undefined;
    }
  }
  const local = zonedParts(now, timezone);
  const base = new Date(Date.UTC(local.year, local.month - 1, local.day));
  for (let delta = 0; delta <= 370; delta += 1) {
    const day = new Date(base.getTime() + delta * 86_400_000);
    const date = day.toISOString().slice(0, 10);
    if (date < range.startDate) continue;
    if (date > range.endDate) return undefined;
    const weekday = isoWeekday(date);
    if (!runDays.includes(weekday)) continue;
    const resolved = resolveLocalDateTime(date, publishTime, timezone);
    if (resolved.ok && resolved.value.getTime() > now.getTime()) return { scheduledAt: resolved.value, weekday };
  }
  return undefined;
}

function localDateKeyForTimezone(date: Date, timezone: string): string {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function jobsForPlanEntry(plan: AutomationPlan, platform: AutomationCronSchedule["platform"], item: AutomationPlatformPlan, pageId: string | undefined, bindingIdForPage: (pageId: string) => string | undefined, now: Date, scheduleTemplate?: CampaignScheduleTemplate, scheduleSource: "campaign_template" | "scope" = scheduleTemplate ? "campaign_template" : "scope", dateRange?: AutomationDateRange): AutomationUpcomingJob[] {
  if (!item || typeof item !== "object" || !Array.isArray(item.publishTimes)) return [];
  const postCount = scheduleTemplate && scheduleSource === "campaign_template" ? item.postsPerDay : item.publishTimes.length;
  if (!item.enabled || postCount === 0) return [];
  const scopeId = cronScopeKey(platform, pageId);
  const baseCron = plan.cron && typeof plan.cron === "object" ? plan.cron : { enabled: false, startTime: "", timezone: "" };
  const cron = plan.cronSchedules?.[scopeId] ?? { enabled: baseCron.enabled, startTime: baseCron.startTime, timezone: baseCron.timezone };
  const timezone = scheduleTemplate?.timezone ?? cron.timezone;
  const runDays = item.runDays?.length ? item.runDays : [1, 2, 3, 4, 5, 6, 7];
  let formats: ("image" | "video")[];
  const formatMode = item.formatMode ?? plan.formatMode;
  const formatMix = item.formatMix ?? plan.formatMix;
  try { formats = formatMode ? resolveFormatSequence({ mode: formatMode, mix: formatMix, slotCount: postCount }) : Array.from({ length: postCount }, (_, index) => index < item.imageCount ? "image" : "video"); }
  catch { return []; }
  return Array.from({ length: postCount }, (_, postIndex): AutomationUpcomingJob | undefined => {
    const templateSchedule = scheduleTemplate && scheduleSource === "campaign_template" ? nextScheduledAtForTemplate(now, postIndex, scheduleTemplate.timezone, runDays, scheduleTemplate, dateRange) : undefined;
    const publishTime = templateSchedule?.publishTime ?? item.publishTimes[postIndex] ?? "";
    const scheduled = templateSchedule ?? (isValidAutomationTime(publishTime) ? nextScheduledAtInRange(now, publishTime, timezone, runDays, dateRange) : undefined);
    if (!scheduled) return undefined;
    const mediaKind = formats[postIndex]!;
    return {
      id: `${plan.id}:${scopeId}:${postIndex}`,
      planId: plan.id,
      scopeId,
      platform,
      pageId,
      bindingId: pageId ? plan.cronSchedules?.[scopeId]?.bindingId ?? bindingIdForPage(pageId) : undefined,
      publishTime,
      postIndex,
      mediaKind,
      contentKind: mediaKind === "image" ? "image" : platform === "facebook" ? "video" : "short_video",
      nextActionAt: scheduled.scheduledAt.toISOString(),
      revision: plan.cronSchedules?.[scopeId]?.revision ?? plan.revision ?? 1,
      scheduleSource,
      weekday: scheduled.weekday,
    };
  }).filter((job): job is AutomationUpcomingJob => job !== undefined);
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; } catch { return false; }
}

function schedulerPageIds(plan: AutomationPlan): string[] {
  if (Array.isArray(plan.targetPageIds)) return plan.targetPageIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim());
  return (Array.isArray(plan.bindingIds) ? plan.bindingIds : []).flatMap((bindingId) => {
    const marker = "-facebook-";
    const index = bindingId.indexOf(marker);
    return index >= 0 && bindingId.slice(index + marker.length) ? [bindingId.slice(index + marker.length)] : [];
  });
}

function schedulerBindingIdForPage(plan: AutomationPlan, pageId: string, fallback: (pageId: string) => string | undefined): string | undefined {
  const index = Array.isArray(plan.targetPageIds) ? plan.targetPageIds.indexOf(pageId) : -1;
  const indexed = index >= 0 ? plan.bindingIds?.[index] : undefined;
  return indexed ?? plan.bindingIds?.find((bindingId) => bindingId.includes(`-facebook-${pageId}`)) ?? fallback(pageId);
}

function schedulerPlatformSignature(item: AutomationPlatformPlan | undefined): string {
  if (!item) return "missing";
  return JSON.stringify({ enabled: item.enabled, postsPerDay: item.postsPerDay, imageCount: item.imageCount, videoCount: item.videoCount, publishTimes: item.publishTimes, runDays: item.runDays ? [...item.runDays].sort((left, right) => left - right) : undefined, formatMode: item.formatMode, formatMix: item.formatMix ? { image: item.formatMix.image, video: item.formatMix.video } : undefined, strategySelection: item.strategySelection ? { objective: item.strategySelection.objective, pillar: item.strategySelection.pillar, angle: item.strategySelection.angle } : undefined, invalidReason: item.invalidReason });
}

function schedulerExplicitNonFacebookOverride(pagePlan: AutomationPlatformPlan | undefined, globalPlan: AutomationPlatformPlan | undefined): boolean {
  if (!pagePlan || schedulerPlatformSignature(pagePlan) === schedulerPlatformSignature(globalPlan)) return false;
  return pagePlan.enabled || pagePlan.postsPerDay > 0 || pagePlan.imageCount > 0 || pagePlan.videoCount > 0 || pagePlan.publishTimes.length > 0 || pagePlan.formatMode !== undefined || pagePlan.formatMix !== undefined || pagePlan.strategySelection !== undefined;
}

export type AutomationScheduleSource = "campaign_template" | "scope";
export type AutomationPlanScope = { platform: AutomationCronSchedule["platform"]; pageId?: string; bindingId?: string; item: AutomationPlatformPlan; source: AutomationScheduleSource };

function schedulerPageBindingId(plan: AutomationPlan, pageId: string): string | undefined {
  const index = Array.isArray(plan.targetPageIds) ? plan.targetPageIds.indexOf(pageId) : -1;
  const indexed = index >= 0 ? plan.bindingIds?.[index] : undefined;
  const synthetic = `binding-${plan.brandId}-facebook-${pageId}`;
  if (indexed && indexed !== synthetic) return indexed;
  return plan.bindingIds?.find((bindingId) => bindingId.includes(`-facebook-${pageId}`) && bindingId !== synthetic);
}

export function resolveAutomationPlanScope(plan: AutomationPlan, platform: AutomationCronSchedule["platform"], pageId?: string): AutomationPlanScope {
  if (!pageId) return { platform, item: plan.platforms[platform], source: "campaign_template" };
  const bindingId = schedulerPageBindingId(plan, pageId);
  const binding = bindingId ? plan.bindingSchedules?.[bindingId] : undefined;
  if (platform === "facebook" && binding?.mode === "independent") return { platform, pageId, bindingId, source: "scope", item: { enabled: true, postsPerDay: binding.postsPerDay, imageCount: binding.imageCount, videoCount: binding.videoCount, publishTimes: binding.publishTimes, runDays: binding.runDays, formatMode: binding.formatMode, formatMix: binding.formatMix } };
  const pagePlan = plan.pagePlans?.[pageId]?.[platform];
  if (platform !== "facebook" && schedulerExplicitNonFacebookOverride(pagePlan, plan.platforms[platform])) return { platform, pageId, bindingId, source: "scope", item: pagePlan! };
  if (platform !== "facebook") return { platform, item: plan.platforms[platform], source: "campaign_template" };
  return { platform, pageId, bindingId, source: "scope", item: pagePlan ?? { enabled: false, postsPerDay: 0, imageCount: 0, videoCount: 0, publishTimes: [] } };
}

export function resolveAutomationPlanScopes(plan: AutomationPlan): AutomationPlanScope[] {
  const pageIds = schedulerPageIds(plan);
  const hasPageScopes = plan.targetPageIds !== undefined || (plan.bindingIds?.length ?? 0) > 0;
  if (!hasPageScopes) return (["facebook", "instagram", "tiktok", "youtube"] as AutomationCronSchedule["platform"][]).map((platform) => resolveAutomationPlanScope(plan, platform));
  const scopes: AutomationPlanScope[] = pageIds.map((pageId) => resolveAutomationPlanScope(plan, "facebook", pageId));
  for (const platform of (["instagram", "tiktok", "youtube"] as AutomationCronSchedule["platform"][])) {
    const explicitPages = pageIds.filter((pageId) => schedulerExplicitNonFacebookOverride(plan.pagePlans?.[pageId]?.[platform], plan.platforms[platform]));
    if (explicitPages.length > 0) explicitPages.forEach((pageId) => scopes.push(resolveAutomationPlanScope(plan, platform, pageId)));
    else scopes.push(resolveAutomationPlanScope(plan, platform));
  }
  return scopes;
}

export function filterAutomationPlanScopesForDiscoveredPages(scopes: readonly AutomationPlanScope[], discoveredPageIds: readonly string[]): AutomationPlanScope[] {
  const discovered = new Set(discoveredPageIds);
  return scopes.filter((scope) => !scope.pageId || discovered.has(scope.pageId));
}

export function buildUpcomingAutomationJobs(plan: AutomationPlan, now = new Date(), bindingIdForPage: (pageId: string) => string | undefined = () => undefined): AutomationUpcomingJob[] {
  const campaignId = typeof plan.campaignId === "string" ? plan.campaignId.trim() : "";
  const template = plan.scheduleTemplate && typeof plan.scheduleTemplate === "object" ? plan.scheduleTemplate : undefined;
  const campaignPlanningConfigured = Boolean(campaignId || plan.dateRange || template);
  const range = dateRangeValues(plan.dateRange);
  if (campaignPlanningConfigured) {
    if (!campaignId || !template || typeof template.campaignId !== "string" || typeof template.brandId !== "string" || !template.timesByWeekday || typeof template.timesByWeekday !== "object" || Array.isArray(template.timesByWeekday) || !range || !validDate(range.startDate) || !validDate(range.endDate) || range.startDate > range.endDate || !validTimezone(template.timezone)) return [];
    if (template.campaignId !== campaignId || template.brandId !== plan.brandId) return [];
  }
  const jobs: AutomationUpcomingJob[] = [];
  const pageIds = schedulerPageIds(plan);
  if (pageIds.length > 0 || plan.targetPageIds !== undefined || (plan.bindingIds?.length ?? 0) > 0) {
    pageIds.forEach((pageId) => {
      const bindingId = schedulerBindingIdForPage(plan, pageId, bindingIdForPage);
      const binding = bindingId ? plan.bindingSchedules?.[bindingId] : undefined;
      const item = binding?.mode === "independent"
        ? { enabled: true, postsPerDay: binding.postsPerDay, imageCount: binding.imageCount, videoCount: binding.videoCount, publishTimes: binding.publishTimes, runDays: binding.runDays, formatMode: binding.formatMode, formatMix: binding.formatMix }
        : plan.pagePlans?.[pageId]?.facebook ?? { enabled: false, postsPerDay: 0, imageCount: 0, videoCount: 0, publishTimes: [] };
      jobs.push(...jobsForPlanEntry(plan, "facebook", item, pageId, bindingIdForPage, now, template, "scope", range));
    });
    for (const platform of (["instagram", "tiktok", "youtube"] as AutomationCronSchedule["platform"][])) {
      const explicit = pageIds.filter((pageId) => {
        const pagePlan = plan.pagePlans?.[pageId]?.[platform];
        return schedulerExplicitNonFacebookOverride(pagePlan, plan.platforms?.[platform]);
      });
      if (explicit.length > 0) explicit.forEach((pageId) => jobs.push(...jobsForPlanEntry(plan, platform, plan.pagePlans?.[pageId]?.[platform]!, pageId, bindingIdForPage, now, template, "scope", range)));
      else if (plan.platforms?.[platform]) jobs.push(...jobsForPlanEntry(plan, platform, plan.platforms[platform], undefined, bindingIdForPage, now, template, "campaign_template", range));
    }
  } else {
    (Object.keys(plan.platforms ?? {}) as AutomationCronSchedule["platform"][]).forEach((platform) => jobs.push(...jobsForPlanEntry(plan, platform, plan.platforms[platform], undefined, bindingIdForPage, now, template, "campaign_template", range)));
  }
  return jobs.sort((left, right) => left.nextActionAt.localeCompare(right.nextActionAt) || left.id.localeCompare(right.id));
}

export function updateAutomationPlanForUpcomingJob(plan: AutomationPlan, job: AutomationUpcomingJob, publishTime: string, now = new Date()): AutomationPlan {
  const revision = Math.max(plan.revision ?? 1, plan.cronSchedules?.[job.scopeId]?.revision ?? job.revision ?? 1) + 1;
  const updatedAt = now.toISOString();
  const finish = (candidate: AutomationPlan): AutomationPlan => {
    const current = candidate.cronSchedules?.[job.scopeId] ?? plan.cronSchedules?.[job.scopeId] ?? {
      scopeId: job.scopeId,
      platform: job.platform,
      pageId: job.pageId,
      bindingId: job.bindingId,
      enabled: candidate.cron?.enabled ?? false,
      startTime: candidate.cron?.startTime ?? "",
      timezone: candidate.cron?.timezone ?? "",
      revision,
      updatedAt,
    };
    return { ...candidate, revision, updatedAt, cronSchedules: { ...(candidate.cronSchedules ?? {}), [job.scopeId]: { ...current, revision, updatedAt } } };
  };
  if (job.scheduleSource === "campaign_template" && plan.scheduleTemplate && job.weekday !== undefined) {
    const times = [...(plan.scheduleTemplate.timesByWeekday[job.weekday] ?? [])];
    times[job.postIndex] = publishTime;
    return finish({ ...plan, scheduleTemplate: { ...plan.scheduleTemplate, source: "campaign_override", timesByWeekday: { ...plan.scheduleTemplate.timesByWeekday, [job.weekday]: times } } });
  }
  if (job.pageId) {
    const binding = job.bindingId ? plan.bindingSchedules?.[job.bindingId] : undefined;
    if (job.platform === "facebook" && job.bindingId && binding?.mode === "independent") {
      const publishTimes = binding.publishTimes.map((time, index) => index === job.postIndex ? publishTime : time);
      return finish({ ...plan, bindingSchedules: { ...(plan.bindingSchedules ?? {}), [job.bindingId]: { ...binding, publishTimes } } });
    }
    const currentPage = plan.pagePlans?.[job.pageId] ?? { ...plan.platforms };
    const currentPlatform = currentPage[job.platform] ?? plan.platforms[job.platform];
    const updatedPlatform = { ...currentPlatform, publishTimes: currentPlatform.publishTimes.map((time, index) => index === job.postIndex ? publishTime : time) };
    const pagePlans = { ...(plan.pagePlans ?? {}), [job.pageId]: { ...currentPage, [job.platform]: updatedPlatform } };
    return finish({ ...plan, pagePlans });
  }
  const currentPlatform = plan.platforms[job.platform];
  return finish({ ...plan, platforms: { ...plan.platforms, [job.platform]: { ...currentPlatform, publishTimes: currentPlatform.publishTimes.map((time, index) => index === job.postIndex ? publishTime : time) } } });
}
