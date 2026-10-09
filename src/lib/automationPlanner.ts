import type { BrandSystem, ContentKind, ContentVariant, SocialPlatform } from "./mvpContracts";
import type { AIAccountRegistry } from "./aiAccounts";
import { selectMediaForPost, type ImageProvider, type MediaInventoryRecord, type MediaReservationLedger, type MediaSelectionRequest } from "./automationDomain";
import { catalogForChannel, STRATEGY_OBJECTIVE_KEYS, validateStrategyCatalog, type BrandStrategyCatalog, type StrategyObjectiveKey } from "./contentStrategy";
import { clientIdForBrand, sanitizeBrandTypography, type BrandRecord } from "./workspaceDomain";
import { nextScheduledAtForRunDays } from "./automationScheduler";
import { automationPlanCatalogReviewState, buildResolvedAutomationSlots, captureAutomationStrategySnapshot, isResolvedAutomationSlot, resolveFormatSequence, resolveLocalDateTime, resolveStrategyForSlot } from "./contentStrategyResolver";
import type { AutomationDateRange, AutomationFormatMix, AutomationFormatMode, AutomationStrategySelection, AutomationStrategySnapshot, CampaignScheduleTemplate, ResolvedAutomationSlot } from "./contentStrategyResolver";
import { validateContentRecipe, validateContentRecipeForStrategy, type ContentRecipe } from "./contentRecipe";

export type { AutomationDateRange, AutomationFormatMix, AutomationFormatMode, AutomationPlanCatalogReview, AutomationStrategySelection, AutomationStrategySnapshot, AutomationStrategySnapshotInput, CampaignScheduleTemplate, ResolvedAutomationSlot, ResolvedStrategy } from "./contentStrategyResolver";
export { automationPlanCatalogReviewState, buildAutomationStrategySnapshot, buildResolvedAutomationSlots, captureAutomationStrategySnapshot, cloneCampaignScheduleTemplate, resolveFormatSequence, resolveStrategyForSlot, reviewAutomationPlanStrategy, stableMixSequence } from "./contentStrategyResolver";
export { isResolvedAutomationSlot } from "./contentStrategyResolver";

export type AutomationPlanStatus = "draft" | "active" | "paused";
export const AUTOMATION_RUN_DAYS: number[] = [1, 2, 3, 4, 5, 6, 7];
export type AutomationPlatformPlan = {
  enabled: boolean;
  postsPerDay: number;
  imageCount: number;
  videoCount: number;
  publishTimes: string[];
  /** ISO weekday numbers: Monday=1 through Sunday=7. */
  runDays?: number[];
  formatMode?: AutomationFormatMode;
  formatMix?: AutomationFormatMix;
  strategySelection?: AutomationStrategySelection;
  invalidReason?: string;
};
export type AutomationPostSpec = { publishTime: string; mediaKind: "image" | "video"; contentKind: ContentKind; postIndex: number };
export type AutomationCronConfig = {
  enabled: boolean;
  startTime: string;
  timezone: string;
};
export type AutomationCronSchedule = AutomationCronConfig & { scopeId: string; platform: SocialPlatform; pageId?: string; bindingId?: string; revision: number; updatedAt: string };
export type BindingSchedule = { mode: "inherit_facebook" } | { mode: "independent"; postsPerDay: number; imageCount: number; videoCount: number; publishTimes: string[]; runDays?: number[]; formatMode?: AutomationFormatMode; formatMix?: AutomationFormatMix };
export type AutomationPlan = {
  id: string;
  workspaceId: string;
  brandId: string;
  name?: string;
  objectiveMode?: string;
  contentPillar?: string;
  angle?: string;
  campaignStartAt?: string;
  campaignEndAt?: string;
  campaignId?: string;
  dateRange?: AutomationDateRange;
  scheduleTemplate?: CampaignScheduleTemplate;
  strategySelection?: AutomationStrategySelection;
  strategySnapshot?: AutomationStrategySnapshot;
  /** Migration-only alias; normalized payloads retain strategySnapshot only. */
  planStrategySnapshot?: AutomationStrategySnapshot;
  /** Migration-only alias; normalized payloads retain strategySelection only. */
  contentStrategySelection?: AutomationStrategySelection;
  formatMode?: AutomationFormatMode;
  formatMix?: AutomationFormatMix;
  targetChannels?: SocialPlatform[];
  /** Optional preference: an empty array enables deterministic automatic selection from eligible brand media. */
  selectedAssetIds?: Array<string | number>;
  /** Exact Facebook Page IDs targeted by this brand plan. An explicit empty array targets no Pages; absent in legacy snapshots enables single-page compatibility. */
  targetPageIds?: string[];
  /** Agency contract: one explicit binding per social destination. Legacy targetPageIds remain a migration-only adapter. */
  bindingIds?: string[];
  bindingSchedules?: Record<string, BindingSchedule>;
  /** Explicit per-Page schedules. When targetPageIds is present, missing Page entries do not fall back to the global rhythm. */
  pagePlans?: Record<string, Record<SocialPlatform, AutomationPlatformPlan>>;
  platforms: Record<SocialPlatform, AutomationPlatformPlan>;
  cron: AutomationCronConfig;
  cronSchedules?: Record<string, AutomationCronSchedule>;
  revision?: number;
  status: AutomationPlanStatus;
  generationProfileId?: string;
  createdAt: string;
  updatedAt: string;
  lastDueAt?: string;
};

export type AutomationPlanRunScope = { planId: string; clientId: string; brandId: string };

export type PlannerStrategyOption = {
  value: string;
  label: string;
  description?: string;
  pillarId?: string;
  channels: SocialPlatform[];
};

export type PlannerStrategyChoices = {
  objectives: PlannerStrategyOption[];
  pillars: PlannerStrategyOption[];
  angles: PlannerStrategyOption[];
  errors: string[];
};

export type AutomationPlannerResolvedCatalogRow = {
  id: string;
  scheduledAt: string;
  platform: SocialPlatform;
  targetPageId?: string;
  objectiveKey: StrategyObjectiveKey;
  objectiveLabel: string;
  pillarId: string;
  pillarLabel: string;
  angleId: string;
  angleLabel: string;
  applicableChannels: SocialPlatform[];
  recipeId?: string;
  recipeLabel: string;
  catalogVersion: number;
  catalogFingerprint: string;
};

export type AutomationPlannerPreviewResult =
  | { ok: true; preview: { ok: true; slots: ResolvedAutomationSlot[] }; slots: ResolvedAutomationSlot[]; rows: AutomationPlannerResolvedCatalogRow[]; errors: [] }
  | { ok: false; errors: string[]; firstError: string; remainingErrors: number; slots?: undefined; rows?: undefined };

export type AutomationPlannerSavePreparation =
  | { ok: true; plan: AutomationPlan; preview: AutomationPlannerPreviewResult & { ok: true }; snapshot: AutomationStrategySnapshot }
  | { ok: false; errors: string[]; firstError: string; remainingErrors: number };

export function normalizeAutomationStrategySelection(input: unknown): AutomationStrategySelection {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const objective = value.objective === "mix" || STRATEGY_OBJECTIVE_KEYS.includes(value.objective as typeof STRATEGY_OBJECTIVE_KEYS[number]) ? value.objective as AutomationStrategySelection["objective"] : "mix";
  const choice = (candidate: unknown): string | "mix" => candidate === "mix" ? "mix" : typeof candidate === "string" && candidate.trim() ? candidate.trim() : "mix";
  return { objective, pillar: choice(value.pillar), angle: choice(value.angle) };
}

const PLANNER_STRATEGY_CHANNELS: SocialPlatform[] = ["facebook", "instagram", "tiktok", "youtube"];

function plannerErrorResult(errors: string[]): AutomationPlannerPreviewResult {
  const unique = [...new Set(errors.filter((item) => typeof item === "string" && item.trim()))];
  const safeErrors = unique.length > 0 ? unique : ["STRATEGY_PREVIEW_INVALID"];
  return { ok: false, errors: safeErrors, firstError: safeErrors[0]!, remainingErrors: Math.max(0, safeErrors.length - 1) };
}

function plannerTargetChannels(channels: readonly SocialPlatform[] | undefined): SocialPlatform[] {
  const selected = [...new Set((channels ?? []).filter((channel): channel is SocialPlatform => PLANNER_STRATEGY_CHANNELS.includes(channel)))];
  return selected.length > 0 ? selected : [...PLANNER_STRATEGY_CHANNELS];
}

/** Build planner controls from the active BrandStrategyCatalog; IDs remain the persisted values. */
export function plannerStrategyChoices(catalog: BrandStrategyCatalog | undefined, targetChannels: readonly SocialPlatform[] = PLANNER_STRATEGY_CHANNELS, selection: AutomationStrategySelection = { objective: "mix", pillar: "mix", angle: "mix" }): PlannerStrategyChoices {
  if (!catalog) return { objectives: [], pillars: [], angles: [], errors: ["STRATEGY_CATALOG_REQUIRED"] };
  const validation = validateStrategyCatalog(catalog);
  if (!validation.ok) return { objectives: [], pillars: [], angles: [], errors: validation.errors.map((error) => `STRATEGY_CATALOG_INVALID: ${error}`) };
  const channels = plannerTargetChannels(targetChannels);
  const filtered = new Map<SocialPlatform, BrandStrategyCatalog>();
  const errors: string[] = [];
  for (const channel of channels) {
    try { filtered.set(channel, catalogForChannel(catalog, channel)); }
    catch { errors.push(`STRATEGY_CATALOG_INVALID: ${channel}`); }
  }
  if (errors.length > 0) return { objectives: [], pillars: [], angles: [], errors };
  const catalogs = [...filtered.values()];
  const objectives = catalogs[0]?.objectives
    .filter((objective) => catalogs.every((item) => item.objectives.some((candidate) => candidate.key === objective.key)))
    .sort((left, right) => left.order - right.order)
    .map((objective) => ({ value: objective.key, label: objective.label, description: objective.description, channels: channels.filter((channel) => filtered.get(channel)?.objectives.some((candidate) => candidate.key === objective.key)) })) ?? [];
  const pillars = catalogs[0]?.pillars
    .filter((pillar) => catalogs.every((item) => item.pillars.some((candidate) => candidate.id === pillar.id)))
    .sort((left, right) => left.order - right.order)
    .map((pillar) => ({ value: pillar.id, label: pillar.label, description: pillar.description, channels: channels.filter((channel) => filtered.get(channel)?.pillars.some((candidate) => candidate.id === pillar.id)) })) ?? [];
  const selectedPillar = selection.pillar === "mix" ? undefined : selection.pillar;
  const candidatePillars = selectedPillar
    ? pillars.filter((pillar) => pillar.value === selectedPillar)
    : pillars;
  const angleMap = new Map<string, PlannerStrategyOption>();
  candidatePillars.forEach((pillar) => {
    const angles = catalogs[0]?.pillars.find((item) => item.id === pillar.value)?.angles ?? [];
    angles.filter((angle) => catalogs.every((item) => item.pillars.find((candidate) => candidate.id === pillar.value)?.angles.some((nested) => nested.id === angle.id))).forEach((angle) => {
      angleMap.set(angle.id, { value: angle.id, label: angle.label, description: angle.guidance, pillarId: pillar.value, channels: channels.filter((channel) => filtered.get(channel)?.pillars.find((item) => item.id === pillar.value)?.angles.some((nested) => nested.id === angle.id)) });
    });
  });
  return {
    objectives: [{ value: "mix", label: "Mix · rotate objectives", description: "Rotate through enabled catalog objectives.", channels }, ...objectives],
    pillars: [{ value: "mix", label: "Mix · rotate pillars", description: "Rotate through enabled catalog pillars.", channels }, ...pillars],
    angles: [{ value: "mix", label: "Mix · rotate angles", description: "Rotate through enabled angles.", channels }, ...[...angleMap.values()].sort((left, right) => (left.pillarId ?? "").localeCompare(right.pillarId ?? "") || left.label.localeCompare(right.label))],
    errors: [],
  };
}

/** Resolve the same deterministic slots used by generation and expose only complete rows to the planner UI. */
export function buildAutomationPlannerPreview(input: { plan: AutomationPlan; catalog?: BrandStrategyCatalog; scheduleTemplate?: CampaignScheduleTemplate; recipes?: readonly ContentRecipe[] }): AutomationPlannerPreviewResult {
  if (!input.catalog) return plannerErrorResult(["STRATEGY_CATALOG_REQUIRED: Load the active Brand strategy catalog before preview."]);
  if (!input.scheduleTemplate) return plannerErrorResult(["SCHEDULE_TEMPLATE_REQUIRED: Load the active Brand schedule template before preview."]);
  if (!input.plan.strategySelection) return plannerErrorResult(["STRATEGY_SELECTION_REQUIRED: Choose Specific or Mix values before preview."]);
  const plannerPlan = normalizePlannerStrategyPlan(input.plan);
  const validation = validateStrategyCatalog(input.catalog);
  if (!validation.ok) return plannerErrorResult(validation.errors.map((error) => `STRATEGY_CATALOG_INVALID: ${error}`));
  const result = buildResolvedAutomationSlots({ plan: plannerPlan, catalog: input.catalog, scheduleTemplate: input.scheduleTemplate });
  if (!result.ok) return plannerErrorResult(result.errors);
  const rows: AutomationPlannerResolvedCatalogRow[] = [];
  const errors: string[] = [];
  result.slots.forEach((slot) => {
    const angleId = slot.angleIdByChannel[slot.platform];
    const resolved = resolveStrategyForSlot({ catalog: input.catalog!, channel: slot.platform, selection: { objective: slot.objectiveKey, pillar: slot.pillarId, angle: angleId ?? "mix" }, slotIndex: 0 });
    if (!resolved.ok) {
      errors.push(`STRATEGY_${resolved.code}: ${slot.platform}: ${resolved.message}`);
      return;
    }
    const recipe = resolved.strategy.recipeId ? input.recipes?.find((candidate) => candidate.id === resolved.strategy.recipeId && candidate.brandId === plannerPlan.brandId) : undefined;
    if (resolved.strategy.recipeId && !recipe) {
      errors.push(`STRATEGY_RECIPE_UNAVAILABLE: ${slot.platform}: recipe ${resolved.strategy.recipeId} is missing from the active Brand catalog.`);
      return;
    }
    if (recipe) {
      try {
        const recipeValidity = validateContentRecipe(recipe, input.plan.brandId, slot.platform, slot.contentKind);
        const strategyValidity = validateContentRecipeForStrategy(recipe, { pillarId: resolved.strategy.pillarId, angleId: resolved.strategy.angleId });
        if (!recipeValidity.ok || !strategyValidity.ok) {
          errors.push(`STRATEGY_RECIPE_INCOMPATIBLE: ${slot.platform}: recipe ${recipe.id} is not compatible with the resolved strategy.`);
          return;
        }
      } catch {
        errors.push(`STRATEGY_RECIPE_INVALID: ${slot.platform}: recipe ${recipe.id} is invalid.`);
        return;
      }
    }
    rows.push({
      id: slot.id,
      scheduledAt: slot.scheduledAt,
      platform: slot.platform,
      ...(slot.targetPageId ? { targetPageId: slot.targetPageId } : {}),
      objectiveKey: resolved.strategy.objectiveKey,
      objectiveLabel: resolved.strategy.objectiveLabel,
      pillarId: resolved.strategy.pillarId,
      pillarLabel: resolved.strategy.pillarLabel,
      angleId: resolved.strategy.angleId,
      angleLabel: resolved.strategy.angleLabel,
      applicableChannels: Object.keys(slot.angleIdByChannel).filter((channel): channel is SocialPlatform => PLANNER_STRATEGY_CHANNELS.includes(channel as SocialPlatform)),
      ...(resolved.strategy.recipeId ? { recipeId: resolved.strategy.recipeId } : {}),
      recipeLabel: recipe?.name ?? resolved.strategy.recipeId ?? "No compatible recipe assigned",
      catalogVersion: resolved.strategy.strategyVersion,
      catalogFingerprint: resolved.strategy.catalogFingerprint,
    });
  });
  if (errors.length > 0 || rows.length !== result.slots.length) return plannerErrorResult(errors.length > 0 ? errors : ["STRATEGY_PREVIEW_INCOMPLETE"]);
  return { ok: true, preview: result, slots: result.slots, rows, errors: [] };
}

/** Capture the current validated preview through the existing planner CAS payload. */
export function prepareAutomationPlanForSave(input: { plan: AutomationPlan; catalog?: BrandStrategyCatalog; scheduleTemplate?: CampaignScheduleTemplate; recipes?: readonly ContentRecipe[]; capturedAt?: string }): AutomationPlannerSavePreparation {
  if (!input.catalog) return plannerErrorResult(["STRATEGY_CATALOG_REQUIRED: Load the active Brand strategy catalog before saving."]) as AutomationPlannerSavePreparation;
  const selection = input.plan.strategySelection ? normalizeAutomationStrategySelection(input.plan.strategySelection) : undefined;
  if (!selection) return plannerErrorResult(["STRATEGY_SELECTION_REQUIRED: Choose Specific or Mix values before saving."]) as AutomationPlannerSavePreparation;
  const candidate: AutomationPlan = { ...normalizePlannerStrategyPlan(input.plan), strategySelection: selection, strategySnapshot: undefined, planStrategySnapshot: undefined, contentStrategySelection: undefined };
  const preview = buildAutomationPlannerPreview({ plan: candidate, catalog: input.catalog, scheduleTemplate: input.scheduleTemplate, recipes: input.recipes });
  if (!preview.ok) return preview;
  try {
    const snapshot = captureAutomationStrategySnapshot({ plan: candidate, catalog: input.catalog, preview: preview.preview, recipes: input.recipes, capturedAt: input.capturedAt });
    const plan: AutomationPlan = { ...candidate, targetChannels: [...snapshot.targetChannels], strategySnapshot: structuredClone(snapshot), updatedAt: input.capturedAt ?? new Date().toISOString() };
    return { ok: true, plan, preview, snapshot };
  } catch (caught) {
    return plannerErrorResult([caught instanceof Error ? caught.message : "STRATEGY_SNAPSHOT_INVALID"]) as AutomationPlannerSavePreparation;
  }
}

/** Planner contract: the visible root strategy is the only strategy input it persists or resolves. */
export function hasPlannerStrategyOverrides(plan: Pick<AutomationPlan, "platforms" | "pagePlans">): boolean {
  return Object.values(plan.platforms ?? {}).some((item) => item?.strategySelection !== undefined)
    || Object.values(plan.pagePlans ?? {}).some((entries) => Object.values(entries ?? {}).some((item) => item?.strategySelection !== undefined));
}

export function normalizePlannerStrategyPlan(plan: AutomationPlan): AutomationPlan {
  const next = structuredClone(plan);
  const withoutStrategy = (item: AutomationPlatformPlan): AutomationPlatformPlan => {
    if (item.strategySelection === undefined) return item;
    const clean = { ...item };
    delete clean.strategySelection;
    return clean;
  };
  next.platforms = Object.fromEntries(Object.entries(next.platforms ?? {}).map(([platform, item]) => [platform, withoutStrategy(item)])) as Record<SocialPlatform, AutomationPlatformPlan>;
  next.pagePlans = Object.fromEntries(Object.entries(next.pagePlans ?? {}).map(([pageId, entries]) => [pageId, Object.fromEntries(Object.entries(entries ?? {}).map(([platform, item]) => [platform, withoutStrategy(item)])) as Record<SocialPlatform, AutomationPlatformPlan>])) as Record<string, Record<SocialPlatform, AutomationPlatformPlan>>;
  return next;
}

export function resolveAutomationPlatformFormats(plan: Pick<AutomationPlatformPlan, "postsPerDay" | "imageCount" | "videoCount" | "formatMode" | "formatMix">, slotCount = plan.postsPerDay, root?: Pick<AutomationPlan, "formatMode" | "formatMix">): ("image" | "video")[] {
  const mode = plan.formatMode ?? root?.formatMode;
  if (mode) return resolveFormatSequence({ mode, mix: plan.formatMix ?? root?.formatMix, slotCount });
  return Array.from({ length: slotCount }, (_, index) => index < plan.imageCount ? "image" : "video");
}

export function nextAutomationFormatPatch(item: Pick<AutomationPlatformPlan, "formatMode" | "formatMix" | "imageCount" | "videoCount">, mode: AutomationFormatMode): Pick<AutomationPlatformPlan, "formatMode" | "formatMix"> {
  const mix = item.formatMix ?? (item.formatMode ? { image: 1, video: 1 } : { image: Math.max(1, item.imageCount), video: Math.max(1, item.videoCount) });
  return { formatMode: mode, formatMix: mode === "mix" ? mix : undefined };
}

export function normalizeAutomationPlatformPlan(plan: AutomationPlatformPlan, root?: Pick<AutomationPlan, "formatMode" | "formatMix">): AutomationPlatformPlan {
  if (!plan || typeof plan !== "object" || Array.isArray(plan) || typeof plan.enabled !== "boolean" || ![plan.postsPerDay, plan.imageCount, plan.videoCount].every((value) => typeof value === "number") || !Array.isArray(plan.publishTimes)) return { enabled: false, postsPerDay: 0, imageCount: 0, videoCount: 0, publishTimes: [], invalidReason: "PLATFORM_ENTRY_INVALID" };
  if (!plan.formatMode && !root?.formatMode) return plan;
  try {
    const formats = resolveAutomationPlatformFormats(plan, plan.postsPerDay, root);
    const imageCount = formats.filter((format) => format === "image").length;
    const videoCount = formats.length - imageCount;
    return imageCount === plan.imageCount && videoCount === plan.videoCount ? plan : { ...plan, imageCount, videoCount };
  } catch {
    return plan;
  }
}

/** Normalize strategy aliases; legacy scalar fields remain readable but never drive generation. */
export function normalizeAutomationPlan(input: AutomationPlan): AutomationPlan {
  const normalized = structuredClone(input) as AutomationPlan & Record<string, unknown>;
  const legacySelection = normalized.contentStrategySelection;
  if (normalized.strategySelection === undefined && legacySelection && typeof legacySelection === "object" && !Array.isArray(legacySelection)) normalized.strategySelection = legacySelection as AutomationStrategySelection;
  const legacySnapshot = normalized.planStrategySnapshot;
  if (normalized.strategySnapshot === undefined && legacySnapshot && typeof legacySnapshot === "object" && !Array.isArray(legacySnapshot)) normalized.strategySnapshot = legacySnapshot as AutomationStrategySnapshot;
  delete normalized.contentStrategySelection;
  delete normalized.planStrategySnapshot;
  if (normalized.strategySnapshot && typeof normalized.strategySnapshot === "object") {
    const snapshot = normalized.strategySnapshot as AutomationStrategySnapshot & Record<string, unknown>;
    const nestedLegacySelection = snapshot.contentStrategySelection;
    if (!snapshot.selection && nestedLegacySelection && typeof nestedLegacySelection === "object" && !Array.isArray(nestedLegacySelection)) snapshot.selection = nestedLegacySelection as AutomationStrategySelection;
    delete snapshot.contentStrategySelection;
    if (normalized.revision !== undefined && snapshot.revision !== normalized.revision) snapshot.revision = normalized.revision;
  }
  if (normalized.dateRange) {
    const range = normalized.dateRange;
    const startDate = range.startDate ?? range.start;
    const endDate = range.endDate ?? range.end;
    if (isValidAutomationDate(startDate) && isValidAutomationDate(endDate) && startDate <= endDate) normalized.dateRange = { startDate, endDate };
    else delete normalized.dateRange;
  }
  if (normalized.platforms && typeof normalized.platforms === "object" && !Array.isArray(normalized.platforms)) normalized.platforms = Object.fromEntries(Object.entries(normalized.platforms).map(([platform, item]) => [platform, normalizeAutomationPlatformPlan(item, normalized)])) as Record<SocialPlatform, AutomationPlatformPlan>;
  if (normalized.pagePlans && typeof normalized.pagePlans === "object" && !Array.isArray(normalized.pagePlans)) normalized.pagePlans = Object.fromEntries(Object.entries(normalized.pagePlans).map(([pageId, entries]) => [pageId, entries && typeof entries === "object" && !Array.isArray(entries) ? Object.fromEntries(Object.entries(entries).map(([platform, item]) => [platform, normalizeAutomationPlatformPlan(item, normalized)])) as Record<SocialPlatform, AutomationPlatformPlan> : { facebook: normalizeAutomationPlatformPlan(null as never, normalized) }])) as AutomationPlan["pagePlans"];
  if (normalized.bindingSchedules && typeof normalized.bindingSchedules === "object") normalized.bindingSchedules = Object.fromEntries(Object.entries(normalized.bindingSchedules).map(([bindingId, schedule]) => {
    if (!schedule || schedule.mode !== "independent" || (!schedule.formatMode && !normalized.formatMode)) return [bindingId, schedule];
    try {
      const formatMode = schedule.formatMode ?? normalized.formatMode;
      const formatMix = schedule.formatMix ?? normalized.formatMix;
      if (!formatMode) return [bindingId, schedule];
      const formats = resolveFormatSequence({ mode: formatMode, mix: formatMix, slotCount: schedule.postsPerDay });
      return [bindingId, { ...schedule, imageCount: formats.filter((format) => format === "image").length, videoCount: formats.filter((format) => format === "video").length }];
    } catch {
      return [bindingId, schedule];
    }
  })) as AutomationPlan["bindingSchedules"];
  return normalized;
}

export const AUTOMATION_PLATFORMS: SocialPlatform[] = ["facebook", "instagram", "tiktok", "youtube"];

export type AutomationAIMode = "mock" | "manual_assisted" | "web_subscription" | "official_api";
export type AutomationAIProviderSelection = "auto" | "mock" | "gemini" | "openai";
export type AutomationAIPreference = { provider: AutomationAIProviderSelection; mode: AutomationAIMode };
export type ResolvedAutomationAI = { provider: "mock" | "gemini" | "openai"; mode: AutomationAIMode; model?: string; available: boolean; reason: string };
export type AutomationGenerationProfile = { mode: "subscription_package" | "llm_provider"; provider: string; model: string; status: "not_configured" | "needs_reauth" | "review_required" | "connected" | "unsupported"; capabilities: string[] };
export type AutomationAIRoute = "subscription" | "llm";

export function automationAIOptionMatchesRoute(value: string, route: AutomationAIRoute): boolean {
  const mode = value.split(":", 2)[1];
  return route === "subscription" ? mode === "web_subscription" : mode === "official_api" || mode === "manual_assisted" || mode === "mock";
}

export function automationAIPreferenceForRoute(route: AutomationAIRoute, current: AutomationAIPreference): AutomationAIPreference {
  const provider = current.provider === "gemini" || current.provider === "openai" ? current.provider : route === "subscription" ? "gemini" : "openai";
  if (route === "subscription") return { provider, mode: "web_subscription" };
  const mode = current.mode === "official_api" || current.mode === "manual_assisted" || current.mode === "mock" ? current.mode : "official_api";
  return { provider, mode };
}

export function validateAutomationPlanRoute(profile: AutomationGenerationProfile, requiredCapabilities: string[], appOpen: boolean): { ok: true } | { ok: false; code: "APP_OPEN_REQUIRED" | "LLM_PROVIDER_NOT_READY" | "GENERATION_CAPABILITY_MISSING" } {
  if (requiredCapabilities.some((capability) => !profile.capabilities.includes(capability))) return { ok: false, code: "GENERATION_CAPABILITY_MISSING" };
  if (profile.status !== "connected") return { ok: false, code: profile.mode === "subscription_package" ? "APP_OPEN_REQUIRED" : "LLM_PROVIDER_NOT_READY" };
  if (profile.mode === "subscription_package" && !appOpen) return { ok: false, code: "APP_OPEN_REQUIRED" };
  return { ok: true };
}

/** Runs one planner task at a time and always releases ownership, including on provider errors. */
export async function runSingleFlight<T>(guard: { current: boolean }, task: () => Promise<T>): Promise<T | undefined> {
  if (guard.current) return undefined;
  guard.current = true;
  try {
    return await task();
  } finally {
    guard.current = false;
  }
}

export const DEFAULT_AUTOMATION_AI_PREFERENCE: AutomationAIPreference = { provider: "auto", mode: "web_subscription" };

export function sanitizeAutomationAIPreference(input: unknown): AutomationAIPreference | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  const provider: AutomationAIProviderSelection = value.provider === "mock" || value.provider === "gemini" || value.provider === "openai" || value.provider === "auto" ? value.provider : "auto";
  const mode: AutomationAIMode = value.mode === "official_api" || value.mode === "manual_assisted" || value.mode === "web_subscription" || value.mode === "mock" ? value.mode : DEFAULT_AUTOMATION_AI_PREFERENCE.mode;
  if (provider === "mock") return { provider, mode: "mock" };
  return { provider, mode };
}

export function resolveAutomationAI(preference: AutomationAIPreference | undefined, accounts: AIAccountRegistry): ResolvedAutomationAI {
  const selected = sanitizeAutomationAIPreference(preference) ?? DEFAULT_AUTOMATION_AI_PREFERENCE;
  if (selected.provider === "auto") {
    return { provider: "mock", mode: "mock", available: false, reason: "Select one explicit GenerationProfile before automation can run; SignalFlow never falls back between subscription and API providers." };
  }
  if (selected.provider === "mock" || selected.mode === "mock") return { provider: "mock", mode: "mock", available: true, reason: "An injected local fixture is selected; no AI provider will be contacted." };
  const provider = selected.provider;
  const account = accounts[provider];
  if (selected.mode === "web_subscription") {
    if (account.status === "web_session") return { provider, mode: selected.mode, model: account.model, available: true, reason: `${provider === "gemini" ? "Gemini Pro" : "ChatGPT Plus"} managed subscription session is ready.` };
    return { provider, mode: selected.mode, model: account.model, available: false, reason: `${provider === "gemini" ? "Gemini Pro" : "ChatGPT Plus"} subscription is unavailable: open and verify the SignalFlow-managed Chromium session.` };
  }
  if (selected.mode === "official_api") {
    if (account.status === "configured") return { provider, mode: selected.mode, model: account.model, available: true, reason: `${provider === "gemini" ? "Gemini" : "OpenAI"} official API is configured in the .env credential file.` };
    return { provider, mode: selected.mode, model: account.model, available: false, reason: `${provider === "gemini" ? "Gemini" : "OpenAI"} official API is unavailable: configure its key through the .env credential file.` };
  }
  return { provider, mode: "manual_assisted", model: account.model, available: true, reason: `Manual assist is selected for ${provider === "gemini" ? "Gemini" : "OpenAI"}; SignalFlow will not contact a provider.` };
}

export function isUnusableProviderEcho(output: unknown, requestPrompt?: string): boolean {
  const value = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const text = typeof output === "string" ? output : [value.title, value.body].filter((item): item is string => typeof item === "string").join(" ");
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return true;
  const prompt = requestPrompt?.trim().replace(/\s+/g, " ").toLowerCase();
  if (prompt && (normalized === prompt || (normalized.startsWith(prompt) && normalized.length <= prompt.length + 160))) return true;
  return /^(?:create one concise content idea|write a review-first .* caption|topic: .*target platforms: .*content kinds: )/.test(normalized)
    || (normalized.includes("brand name:") && normalized.includes("return exactly one") && normalized.includes("requested media kind:"))
    || (normalized.includes("target platforms:") && normalized.includes("content kinds:") && normalized.includes("schema"));
}

export function selectAutomationAIMode(aiMode: "api" | "manual_assisted" | "web_subscription", aiProvider: string, allowOfficialAI: boolean): AutomationAIMode {
  if (!allowOfficialAI) return aiMode === "manual_assisted" ? "manual_assisted" : "mock";
  if (aiMode === "web_subscription" && (aiProvider === "gemini" || aiProvider === "openai")) return "web_subscription";
  if (allowOfficialAI && aiMode === "api" && aiProvider !== "mock") return "official_api";
  return aiMode === "manual_assisted" ? "manual_assisted" : "mock";
}

export function emptyAutomationPlatformPlan(): AutomationPlatformPlan {
  return { enabled: false, postsPerDay: 0, imageCount: 0, videoCount: 0, publishTimes: [], runDays: [...AUTOMATION_RUN_DAYS] };
}

export function togglePageFacebookEnabled(item: AutomationPlatformPlan): Partial<AutomationPlatformPlan> {
  if (item.enabled) return { enabled: false };
  const postsPerDay = item.postsPerDay > 0 ? item.postsPerDay : 1;
  const imageCount = item.postsPerDay > 0 ? Math.min(postsPerDay, item.imageCount) : 1;
  return { enabled: true, postsPerDay, imageCount, videoCount: postsPerDay - imageCount };
}

export function automationRunDayInTimezone(now: Date, timezone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[weekday] ?? 1;
}

function hasValidRunDays(runDays: number[] | undefined): boolean {
  const days = runDays ?? AUTOMATION_RUN_DAYS;
  return days.length > 0 && days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7);
}

export function expandAutomationPlatformPlan(platform: SocialPlatform, plan: AutomationPlatformPlan | Pick<AutomationPlan, "platforms" | "formatMode" | "formatMix">, rootPlan?: Pick<AutomationPlan, "formatMode" | "formatMix">): AutomationPostSpec[] {
  const videoContentKind: ContentKind = platform === "facebook" ? "video" : "short_video";
  const item = "platforms" in plan ? plan.platforms[platform] : plan;
  const root = "platforms" in plan ? plan : rootPlan;
  const formats = resolveAutomationPlatformFormats(item, item.publishTimes.length, root);
  return item.publishTimes.map((publishTime, postIndex) => {
    const mediaKind = formats[postIndex]!;
    return { publishTime, mediaKind, contentKind: mediaKind === "image" ? "image" : videoContentKind, postIndex };
  });
}

export function createAutomationPlan(workspaceId: string, brandId: string, timezone: string, now = new Date()): AutomationPlan {
  const platforms = Object.fromEntries(AUTOMATION_PLATFORMS.map((platform) => [platform, emptyAutomationPlatformPlan()])) as Record<SocialPlatform, AutomationPlatformPlan>;
  return {
    id: `automation-${workspaceId}-${brandId}`,
    workspaceId,
    brandId,
    name: "Kế hoạch mới",
    objectiveMode: "Education",
    contentPillar: "",
    angle: "",
    campaignStartAt: now.toISOString(),
    selectedAssetIds: [],
    bindingIds: [],
    bindingSchedules: {},
    pagePlans: {},
    platforms,
    cron: { enabled: false, startTime: "09:00", timezone },
    cronSchedules: {},
    revision: 1,
    status: "draft",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function getAutomationPlatformPlanForPage(plan: AutomationPlan, pageId: string, platform: SocialPlatform): AutomationPlatformPlan {
  if (platform === "facebook" && plan.targetPageIds !== undefined) return plan.pagePlans?.[pageId]?.[platform] ?? emptyAutomationPlatformPlan();
  return plan.pagePlans?.[pageId]?.[platform] ?? plan.platforms[platform] ?? emptyAutomationPlatformPlan();
}

export function resolveAutomationTargetPageIds(plan: AutomationPlan, selectedPageId: string): string[] {
  if (plan.targetPageIds !== undefined) return plan.targetPageIds.filter((pageId) => typeof pageId === "string" && pageId.trim());
  return selectedPageId.trim() ? [selectedPageId.trim()] : [];
}

export function resolveAutomationBindingIds(plan: Pick<AutomationPlan, "bindingIds" | "targetPageIds">): string[] {
  if (plan.bindingIds?.length) return plan.bindingIds.filter((bindingId) => typeof bindingId === "string" && bindingId.trim());
  return (plan.targetPageIds ?? []).filter((pageId) => typeof pageId === "string" && pageId.trim());
}

export function resolveAutomationTargetPageIdsFromBindings(plan: Pick<AutomationPlan, "bindingIds" | "targetPageIds">): string[] {
  if (plan.targetPageIds !== undefined) return plan.targetPageIds.filter((pageId) => typeof pageId === "string" && pageId.trim());
  return (plan.bindingIds ?? []).flatMap((bindingId) => {
    const marker = "-facebook-";
    const index = bindingId.indexOf(marker);
    return index >= 0 && bindingId.slice(index + marker.length) ? [bindingId.slice(index + marker.length)] : [];
  });
}

export function validateBindingSchedule(schedule: BindingSchedule, root?: Pick<AutomationPlan, "formatMode" | "formatMix">): AutomationPlanValidation {
  if (schedule.mode === "inherit_facebook") return { ok: true, errors: [] };
  const errors: string[] = [];
  const formatMode = schedule.formatMode ?? root?.formatMode;
  const formatMix = schedule.formatMix ?? root?.formatMix;
  let imageCount = schedule.imageCount;
  let videoCount = schedule.videoCount;
  if (formatMode) {
    try {
      const formats = resolveFormatSequence({ mode: formatMode, mix: formatMix, slotCount: schedule.postsPerDay });
      imageCount = formats.filter((format) => format === "image").length;
      videoCount = formats.length - imageCount;
    } catch (formatError) {
      errors.push(`Binding schedule format ratio is invalid: ${formatError instanceof Error ? formatError.message : String(formatError)}.`);
    }
  }
  if (![schedule.postsPerDay, imageCount, videoCount].every((value) => Number.isInteger(value) && value >= 0)) errors.push("Binding schedule counts must be non-negative integers.");
  if (imageCount + videoCount !== schedule.postsPerDay) errors.push("Binding schedule media totals must equal posts per day.");
  if (schedule.publishTimes.length !== schedule.postsPerDay) errors.push("Binding schedule needs one publish time per post.");
  if (schedule.publishTimes.some((time) => !isValidAutomationTime(time))) errors.push("Binding schedule times must use HH:mm.");
  if (schedule.publishTimes.some((time, index) => index > 0 && time <= schedule.publishTimes[index - 1])) errors.push("Binding schedule times must be ordered.");
  if (!hasValidRunDays(schedule.runDays)) errors.push("Binding schedule needs one or more valid run days (1-7).");
  return { ok: errors.length === 0, errors };
}

export function isValidAutomationTime(value: string): boolean {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  return true;
}

export function isValidAutomationTimezone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function isValidAutomationDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type CampaignDateBoundary = "start" | "end";
export type CampaignDateConversionErrorCode = "INVALID_DATE" | "INVALID_TIMEZONE" | "INVALID_BOUNDARY" | "NONEXISTENT_TIME" | "AMBIGUOUS_TIME" | "INVALID_INSTANT" | "ROUND_TRIP_FAILED";
export type CampaignDateConversionError = { ok: false; code: CampaignDateConversionErrorCode; error: string };
export type CampaignDateConversion = string | CampaignDateConversionError;

type CampaignDateParts = { dateKey: string; year: number; month: number; day: number };
type CampaignWallParts = { dateKey: string; wallKey: string; offsetMs: number };
const CAMPAIGN_DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CAMPAIGN_UTC_INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?Z$/;
const CAMPAIGN_DAY_MS = 86_400_000;
const CAMPAIGN_OFFSET_SCAN_WINDOW_MS = 3 * CAMPAIGN_DAY_MS;
const CAMPAIGN_OFFSET_SCAN_STEP_MS = 60_000;

function campaignDateError(code: CampaignDateConversionErrorCode, error: string): CampaignDateConversionError {
  return { ok: false, code, error };
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseCampaignDateKey(value: unknown): CampaignDateParts | undefined {
  if (typeof value !== "string") return undefined;
  const match = CAMPAIGN_DATE_KEY_PATTERN.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  return { dateKey: value, year, month, day };
}

function parseCampaignInstant(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const match = CAMPAIGN_UTC_INSTANT_PATTERN.exec(value);
  if (!match || !parseCampaignDateKey(match[1])) return undefined;
  const milliseconds = Number((match[5] ?? "").padEnd(3, "0") || 0);
  if (milliseconds > 999) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function campaignDateFormatter(timezone: string): Intl.DateTimeFormat | undefined {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    });
  } catch {
    return undefined;
  }
}

function parseCampaignOffset(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?)?$/.exec(value);
  if (!match) return undefined;
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  if (minutes > 59 || seconds > 59) return undefined;
  const milliseconds = (Number(match[2] ?? 0) * 3_600 + minutes * 60 + seconds) * 1_000;
  return match[1] === "-" ? -milliseconds : milliseconds;
}

function campaignWallParts(date: Date, formatter: Intl.DateTimeFormat): CampaignWallParts | undefined {
  if (!Number.isFinite(date.getTime())) return undefined;
  const values = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const year = values.year?.padStart(4, "0");
  const month = values.month;
  const day = values.day;
  const hour = values.hour;
  const minute = values.minute;
  const second = values.second;
  const fractionalSecond = String(date.getUTCMilliseconds()).padStart(3, "0");
  const offsetMs = parseCampaignOffset(values.timeZoneName);
  if (!year || !month || !day || !hour || !minute || !second || !fractionalSecond || offsetMs === undefined) return undefined;
  return {
    dateKey: `${year}-${month}-${day}`,
    wallKey: `${year}-${month}-${day}T${hour}:${minute}:${second}.${fractionalSecond}`,
    offsetMs,
  };
}

function utcWallTimeMs(parts: CampaignDateParts, hour: number, minute: number, second: number, millisecond: number): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(hour, minute, second, millisecond);
  return date.getTime();
}

function candidateCampaignOffsets(naiveWallMs: number, formatter: Intl.DateTimeFormat): Set<number> {
  // ponytail: minute-resolution offset scan; use Temporal when the runtime baseline supports exact transition enumeration.
  const offsets = new Set<number>();
  for (let timestamp = naiveWallMs - CAMPAIGN_OFFSET_SCAN_WINDOW_MS; timestamp <= naiveWallMs + CAMPAIGN_OFFSET_SCAN_WINDOW_MS; timestamp += CAMPAIGN_OFFSET_SCAN_STEP_MS) {
    const offsetMs = campaignWallParts(new Date(timestamp), formatter)?.offsetMs;
    if (offsetMs !== undefined) offsets.add(offsetMs);
  }
  return offsets;
}

/** Convert a plan calendar date boundary into one exact UTC ISO instant. */
export function campaignDateToInstant(dateKey: string, timezone: string, boundary: CampaignDateBoundary): CampaignDateConversion {
  const parts = parseCampaignDateKey(dateKey);
  if (!parts) return campaignDateError("INVALID_DATE", "Campaign date must be a real YYYY-MM-DD calendar date.");
  if (boundary !== "start" && boundary !== "end") return campaignDateError("INVALID_BOUNDARY", "Campaign date boundary must be start or end.");
  if (typeof timezone !== "string" || !timezone.trim()) return campaignDateError("INVALID_TIMEZONE", "Campaign timezone must be a valid IANA timezone.");
  const formatter = campaignDateFormatter(timezone);
  if (!formatter) return campaignDateError("INVALID_TIMEZONE", `Campaign timezone \"${timezone}\" must be a valid IANA timezone.`);
  const hour = boundary === "start" ? 0 : 23;
  const minute = boundary === "start" ? 0 : 59;
  const second = boundary === "start" ? 0 : 59;
  const millisecond = boundary === "start" ? 0 : 999;
  const expectedWallKey = `${parts.dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.${String(millisecond).padStart(3, "0")}`;
  const naiveWallMs = utcWallTimeMs(parts, hour, minute, second, millisecond);
  const candidates = new Map<number, Date>();
  candidateCampaignOffsets(naiveWallMs, formatter).forEach((offsetMs) => {
    const candidate = new Date(naiveWallMs - offsetMs);
    const wall = campaignWallParts(candidate, formatter);
    if (wall?.wallKey === expectedWallKey) candidates.set(candidate.getTime(), candidate);
  });
  if (candidates.size === 0) return campaignDateError("NONEXISTENT_TIME", `Campaign ${boundary} boundary ${parts.dateKey} does not exist in ${timezone}; choose another date.`);
  if (candidates.size > 1) return campaignDateError("AMBIGUOUS_TIME", `Campaign ${boundary} boundary ${parts.dateKey} is ambiguous in ${timezone}; choose another date.`);
  const iso = [...candidates.values()][0]!.toISOString();
  const roundTrip = campaignInstantToDate(iso, timezone);
  if (typeof roundTrip !== "string" || roundTrip !== parts.dateKey) return campaignDateError("ROUND_TRIP_FAILED", `Campaign ${boundary} boundary ${parts.dateKey} could not be verified in ${timezone}.`);
  return iso;
}

/** Render one persisted UTC ISO instant as a calendar date in the plan timezone. */
export function campaignInstantToDate(iso: string, timezone: string): CampaignDateConversion {
  const parsed = parseCampaignInstant(iso);
  if (!parsed) return campaignDateError("INVALID_INSTANT", "Campaign instant must be a valid UTC ISO instant ending in Z.");
  if (typeof timezone !== "string" || !timezone.trim()) return campaignDateError("INVALID_TIMEZONE", "Campaign timezone must be a valid IANA timezone.");
  const formatter = campaignDateFormatter(timezone);
  if (!formatter) return campaignDateError("INVALID_TIMEZONE", `Campaign timezone \"${timezone}\" must be a valid IANA timezone.`);
  const wall = campaignWallParts(parsed, formatter);
  if (!wall || !parseCampaignDateKey(wall.dateKey)) return campaignDateError("ROUND_TRIP_FAILED", `Campaign instant could not be rendered exactly in ${timezone}.`);
  return wall.dateKey;
}

export type AutomationPlanValidation = { ok: boolean; errors: string[] };

function validAutomationStrategySelection(value: AutomationStrategySelection | undefined): boolean {
  if (!value || typeof value !== "object") return false;
  const objectiveValid = value.objective === "mix" || STRATEGY_OBJECTIVE_KEYS.includes(value.objective as typeof STRATEGY_OBJECTIVE_KEYS[number]);
  const pillarValid = value.pillar === "mix" || (typeof value.pillar === "string" && value.pillar.trim().length > 0);
  const angleValid = value.angle === "mix" || (typeof value.angle === "string" && value.angle.trim().length > 0);
  return objectiveValid && pillarValid && angleValid;
}

function validateAutomationFormat(mode: AutomationFormatMode | undefined, mix: AutomationFormatMix | undefined, label: string, errors: string[]): void {
  if (mode !== undefined && mode !== "image" && mode !== "video" && mode !== "mix") errors.push(`${label} format mode is invalid.`);
  if (mode === "mix" && (!mix || !Number.isFinite(mix.image) || !Number.isFinite(mix.video) || mix.image <= 0 || mix.video <= 0)) errors.push(`${label} format mix needs positive image and video ratios.`);
  if (mode !== "mix" && mix !== undefined) errors.push(`${label} format mix is only valid when format mode is mix.`);
}

function validateAutomationDateRange(range: AutomationDateRange | undefined, errors: string[]): void {
  if (!range) return;
  const startDate = range.startDate ?? range.start;
  const endDate = range.endDate ?? range.end;
  if (!isValidAutomationDate(startDate) || !isValidAutomationDate(endDate) || endDate < startDate) errors.push("Plan date range must contain ordered YYYY-MM-DD dates.");
}

function validateAutomationScheduleTemplate(template: CampaignScheduleTemplate | undefined, errors: string[]): void {
  if (!template) return;
  const id = typeof template.id === "string" ? template.id : "";
  const campaignId = typeof template.campaignId === "string" ? template.campaignId : "";
  const brandId = typeof template.brandId === "string" ? template.brandId : "";
  const timezone = typeof template.timezone === "string" ? template.timezone : "";
  if (!id.trim() || !campaignId.trim() || !brandId.trim()) errors.push("Schedule template identity is required.");
  if (!isValidAutomationTimezone(timezone)) errors.push("Schedule template timezone must be a valid IANA timezone.");
  Object.entries(template.timesByWeekday && typeof template.timesByWeekday === "object" && !Array.isArray(template.timesByWeekday) ? template.timesByWeekday : {}).forEach(([weekday, times]) => {
    if (!/^[1-7]$/.test(weekday) || !Array.isArray(times)) errors.push("Schedule template weekdays must use ISO weekday numbers 1-7.");
    else if (times.some((time) => !isValidAutomationTime(time))) errors.push(`Schedule template weekday ${weekday} times must use HH:mm.`);
    if (Array.isArray(times) && times.some((time, index) => index > 0 && time <= times[index - 1])) errors.push(`Schedule template weekday ${weekday} times must be ordered.`);
  });
}

function resolvedFormatCounts(plan: AutomationPlatformPlan, label: string, errors: string[], root?: Pick<AutomationPlan, "formatMode" | "formatMix">): { imageCount: number; videoCount: number } {
  if (!plan.formatMode && !root?.formatMode) return { imageCount: plan.imageCount, videoCount: plan.videoCount };
  try {
    const formats = resolveAutomationPlatformFormats(plan, plan.postsPerDay, root);
    return { imageCount: formats.filter((format) => format === "image").length, videoCount: formats.filter((format) => format === "video").length };
  } catch (formatError) {
    errors.push(`${label} format ratio is invalid: ${formatError instanceof Error ? formatError.message : String(formatError)}.`);
    return { imageCount: 0, videoCount: 0 };
  }
}

function hasNewAutomationStrategyFields(plan: AutomationPlan): boolean {
  return plan.strategySelection !== undefined
    || plan.strategySnapshot !== undefined
    || plan.planStrategySnapshot !== undefined
    || plan.contentStrategySelection !== undefined
    || plan.campaignId !== undefined
    || plan.dateRange !== undefined
    || plan.scheduleTemplate !== undefined
    || plan.formatMode !== undefined
    || plan.formatMix !== undefined
    || Object.values(plan.platforms ?? {}).some((item) => item?.formatMode !== undefined || item?.formatMix !== undefined || item?.strategySelection !== undefined);
}

function snapshotRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function snapshotFieldText(record: Record<string, unknown>, field: string, path: string, errors: string[], allowEmpty = false): void {
  const value = record[field];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) errors.push(`Strategy snapshot ${path}.${field} is required.`);
}

export function automationStrategySnapshotValidationErrors(snapshot: unknown): string[] {
  const errors: string[] = [];
  const root = snapshotRecord(snapshot);
  if (!root) return ["Strategy snapshot must be an object."];
  if (!validAutomationStrategySelection(root.selection as AutomationStrategySelection | undefined)) errors.push("Strategy snapshot selection is required and valid.");
  if (!Number.isInteger(root.catalogVersion) || Number(root.catalogVersion) < 1) errors.push("Strategy snapshot catalogVersion is required and must be a positive integer.");
  if (typeof root.catalogFingerprint !== "string" || !root.catalogFingerprint.trim()) errors.push("Strategy snapshot catalogFingerprint is required.");
  if (typeof root.resolvedFingerprint !== "string" || !root.resolvedFingerprint.trim()) errors.push("Strategy snapshot resolvedFingerprint is required.");
  if (typeof root.capturedAt !== "string" || !Number.isFinite(Date.parse(root.capturedAt))) errors.push("Strategy snapshot capturedAt is required and must be a valid timestamp.");

  const targetChannels = Array.isArray(root.targetChannels) ? root.targetChannels : [];
  if (targetChannels.length === 0) errors.push("Strategy snapshot targetChannels is required.");
  if (targetChannels.length > 0 && (new Set(targetChannels).size !== targetChannels.length || targetChannels.some((channel) => !AUTOMATION_PLATFORMS.includes(channel as SocialPlatform)))) errors.push("Strategy snapshot targetChannels must contain unique supported channels.");

  const resolvedSlots = Array.isArray(root.resolvedSlots) ? root.resolvedSlots : [];
  if (resolvedSlots.length === 0) errors.push("Strategy snapshot resolvedSlots is required.");
  const ids = new Set<string>();
  resolvedSlots.forEach((value, slotIndex) => {
    const path = `resolvedSlots[${slotIndex}]`;
    const slotValue = snapshotRecord(value);
    if (!slotValue) {
      errors.push(`Strategy snapshot ${path} is required as an object.`);
      return;
    }
    const slot: Record<string, unknown> = slotValue;
    const angleId = slot["angleId"];
    const platform = slot["platform"];
    const slotRecipeId = slot["recipeId"];
    const slotCapturedAt = slot["capturedAt"];
    const slotCatalogVersion = slot["catalogVersion"];
    const slotCatalogFingerprint = slot["catalogFingerprint"];
    const slotId = slot["id"];
    ["objectiveKey", "objectiveLabel", "pillarId", "pillarLabel", "angleId", "angleLabel", "angleGuidance"].forEach((field) => snapshotFieldText(slot, field, path, errors));
    if (!Object.prototype.hasOwnProperty.call(slot, "recipeId")) errors.push(`Strategy snapshot ${path}.recipeId is required.`);
    else if (slotRecipeId !== null && (typeof slotRecipeId !== "string" || !slotRecipeId.trim())) errors.push(`Strategy snapshot ${path}.recipeId must be a non-empty string or null.`);
    snapshotFieldText(slot, "recipeGuidance", path, errors, true);
    snapshotFieldText(slot, "capturedAt", path, errors);
    if (typeof slotCapturedAt === "string" && !Number.isFinite(Date.parse(slotCapturedAt))) errors.push(`Strategy snapshot ${path}.capturedAt must be a valid timestamp.`);
    if (!Number.isInteger(slotCatalogVersion) || slotCatalogVersion !== root.catalogVersion) errors.push(`Strategy snapshot ${path}.catalogVersion must match catalogVersion.`);
    snapshotFieldText(slot, "catalogFingerprint", path, errors);
    if (slotCatalogFingerprint !== root.catalogFingerprint) errors.push(`Strategy snapshot ${path}.catalogFingerprint must match catalogFingerprint.`);
    if (typeof slotId === "string" && slotId.trim()) {
      if (ids.has(slotId.trim())) errors.push(`Strategy snapshot ${path}.id must be unique.`);
      ids.add(slotId.trim());
    }
    if (!isResolvedAutomationSlot(slot, targetChannels as SocialPlatform[], false, false)) errors.push(`Strategy snapshot ${path} resolved slot identity is invalid.`);
    if (typeof platform !== "string" || !targetChannels.includes(platform as SocialPlatform)) errors.push(`Strategy snapshot ${path}.platform must be one of targetChannels.`);
    const angleIds = snapshotRecord((slot as Record<string, unknown>)["angleIdByChannel"]);
    const angleLabels = snapshotRecord((slot as Record<string, unknown>)["angleLabelByChannel"]);
    const angleGuidance = snapshotRecord((slot as Record<string, unknown>)["angleGuidanceByChannel"]);
    if (typeof angleId === "string" && typeof platform === "string" && angleIds?.[platform] !== angleId) errors.push(`Strategy snapshot ${path}.angleId must match angleIdByChannel for its platform.`);
    if (!angleIds) errors.push(`Strategy snapshot ${path}.angleIdByChannel is required.`);
    if (!angleLabels) errors.push(`Strategy snapshot ${path}.angleLabelByChannel is required.`);
    if (!angleGuidance) errors.push(`Strategy snapshot ${path}.angleGuidanceByChannel is required.`);
    if (angleIds && angleLabels && angleGuidance) {
      Object.keys(angleIds).forEach((channel) => {
        if (!targetChannels.includes(channel as SocialPlatform)) errors.push(`Strategy snapshot ${path}.angleIdByChannel contains an unsupported channel.`);
      });
      targetChannels.forEach((channel) => {
        if (typeof angleIds[channel] !== "string" || !String(angleIds[channel]).trim()) errors.push(`Strategy snapshot ${path}.angleIdByChannel.${channel} is required.`);
        if (typeof angleLabels[channel] !== "string" || !String(angleLabels[channel]).trim()) errors.push(`Strategy snapshot ${path}.angleLabelByChannel.${channel} is required.`);
        if (typeof angleGuidance[channel] !== "string" || !String(angleGuidance[channel]).trim()) errors.push(`Strategy snapshot ${path}.angleGuidanceByChannel.${channel} is required.`);
      });
    }
    if (snapshotRecord(root.selection)) {
      const selection = root.selection as AutomationStrategySelection;
      if (selection.objective !== "mix" && slot["objectiveKey"] !== selection.objective) errors.push(`Strategy snapshot ${path}.objectiveKey does not match selection.`);
      if (selection.pillar !== "mix" && slot["pillarId"] !== selection.pillar) errors.push(`Strategy snapshot ${path}.pillarId does not match selection.`);
      if (selection.angle !== "mix" && angleIds && Object.values(angleIds).some((angleId) => angleId !== selection.angle)) errors.push(`Strategy snapshot ${path}.angleIdByChannel does not match selection.`);
    }
  });
  return [...new Set(errors)];
}

export function validAutomationStrategySnapshot(snapshot: AutomationStrategySnapshot): boolean {
  return automationStrategySnapshotValidationErrors(snapshot).length === 0;
}

export const isValidAutomationStrategySnapshot = validAutomationStrategySnapshot;

function validateStrategySelectionsAgainstCatalog(plan: AutomationPlan, catalog: BrandStrategyCatalog, errors: string[]): void {
  const rootSelection = plan.strategySelection;
  const globalChannels = AUTOMATION_PLATFORMS.filter((platform) => plan.platforms?.[platform]?.enabled);
  const pageChannels = Object.values(plan.pagePlans ?? {}).flatMap((entries) => AUTOMATION_PLATFORMS.filter((platform) => entries?.[platform]?.enabled));
  const targetChannels = plan.targetChannels?.length ? plan.targetChannels : [...new Set([...globalChannels, ...pageChannels])];
  if (rootSelection) targetChannels.forEach((channel) => {
    const resolution = resolveStrategyForSlot({ catalog, channel, selection: rootSelection, slotIndex: 0 });
    if (!resolution.ok) errors.push(`Strategy selection cannot resolve for ${channel}: ${resolution.code} — ${resolution.message}`);
  });
  AUTOMATION_PLATFORMS.forEach((platform) => {
    const selection = plan.platforms?.[platform]?.strategySelection;
    if (!selection) return;
    const resolution = resolveStrategyForSlot({ catalog, channel: platform, selection, slotIndex: 0 });
    if (!resolution.ok) errors.push(`${platform} strategy selection cannot resolve: ${resolution.code} — ${resolution.message}`);
  });
  Object.entries(plan.pagePlans ?? {}).forEach(([pageId, entries]) => Object.entries(entries ?? {}).forEach(([platform, item]) => {
    if (!item?.strategySelection || !AUTOMATION_PLATFORMS.includes(platform as SocialPlatform)) return;
    const resolution = resolveStrategyForSlot({ catalog, channel: platform as SocialPlatform, selection: item.strategySelection, slotIndex: 0 });
    if (!resolution.ok) errors.push(`${platform} Page ${pageId} strategy selection cannot resolve: ${resolution.code} — ${resolution.message}`);
  }));
  const snapshot = plan.strategySnapshot;
  if (snapshot && Array.isArray(snapshot.resolvedSlots)) snapshot.resolvedSlots.forEach((slot, slotIndex) => Object.entries(slot?.angleIdByChannel ?? {}).forEach(([channel, angleId]) => {
    if (!AUTOMATION_PLATFORMS.includes(channel as SocialPlatform) || typeof angleId !== "string") return;
    const resolution = resolveStrategyForSlot({ catalog, channel: channel as SocialPlatform, selection: { objective: slot.objectiveKey, pillar: slot.pillarId, angle: angleId }, slotIndex });
    if (!resolution.ok) errors.push(`Strategy snapshot slot ${slotIndex + 1} cannot resolve for ${channel}: ${resolution.code} — ${resolution.message}`);
  }));
}

export function validateAutomationPlan(plan: AutomationPlan, catalog?: BrandStrategyCatalog): AutomationPlanValidation {
  const errors: string[] = [];
  if (typeof plan.workspaceId !== "string" || !plan.workspaceId.trim()) errors.push("Workspace is required.");
  if (typeof plan.brandId !== "string" || !plan.brandId.trim()) errors.push("Brand is required.");
  if (plan.status === "active" && (typeof plan.generationProfileId !== "string" || !plan.generationProfileId.trim())) errors.push("GenerationProfile is required for an active plan.");
  const newStrategyFieldsPresent = hasNewAutomationStrategyFields(plan);
  if (plan.strategySelection !== undefined && !validAutomationStrategySelection(plan.strategySelection)) errors.push("Strategy selection is invalid.");
  if (plan.strategySnapshot?.selection !== undefined && !validAutomationStrategySelection(plan.strategySnapshot.selection)) errors.push("Strategy snapshot selection is invalid.");
  if (plan.strategySnapshot !== undefined) {
    const snapshotErrors = automationStrategySnapshotValidationErrors(plan.strategySnapshot);
    if (snapshotErrors.length > 0) {
      errors.push("Strategy snapshot is invalid.");
      snapshotErrors.forEach((message) => errors.push(message));
    }
  }
  if (plan.status === "active" && newStrategyFieldsPresent && !plan.strategySelection) errors.push("Strategy selection is required for an active plan.");
  if (plan.status === "active" && newStrategyFieldsPresent && !plan.strategySnapshot) errors.push("Strategy snapshot is required for an active plan.");
  if (plan.strategySelection && plan.strategySnapshot?.selection && (plan.strategySelection.objective !== plan.strategySnapshot.selection.objective || plan.strategySelection.pillar !== plan.strategySnapshot.selection.pillar || plan.strategySelection.angle !== plan.strategySnapshot.selection.angle)) errors.push("Strategy snapshot selection must match the plan selection.");
  if (catalog) {
    validateStrategySelectionsAgainstCatalog(plan, catalog, errors);
    const review = automationPlanCatalogReviewState(plan, catalog);
    if (!review.ok) errors.push(`${review.code}: ${review.message}`);
  }
  else if (plan.status === "active" && newStrategyFieldsPresent) errors.push("Strategy catalog is required for an active strategy plan.");
  if (plan.campaignId !== undefined && (typeof plan.campaignId !== "string" || !plan.campaignId.trim())) errors.push("Campaign ID is required when provided.");
  validateAutomationDateRange(plan.dateRange, errors);
  validateAutomationScheduleTemplate(plan.scheduleTemplate, errors);
  if (plan.scheduleTemplate?.campaignId !== undefined && plan.campaignId !== undefined && plan.scheduleTemplate.campaignId !== plan.campaignId) errors.push("Schedule template must belong to the plan campaign.");
  if (plan.scheduleTemplate?.brandId !== undefined && plan.scheduleTemplate.brandId !== plan.brandId) errors.push("Schedule template must belong to the plan brand.");
  validateAutomationFormat(plan.formatMode, plan.formatMix, "Plan", errors);
  if (!plan.cron || typeof plan.cron !== "object") errors.push("Cron schedule is required.");
  else {
    if (!isValidAutomationTime(plan.cron.startTime)) errors.push("Cron start time must use HH:mm.");
    if (!isValidAutomationTimezone(plan.cron.timezone)) errors.push("Timezone must be a valid IANA timezone.");
  }
  const campaignStart = plan.campaignStartAt ? parseCampaignInstant(plan.campaignStartAt) : undefined;
  const campaignEnd = plan.campaignEndAt ? parseCampaignInstant(plan.campaignEndAt) : undefined;
  if (plan.campaignStartAt && !campaignStart) errors.push("Campaign start instant must be a valid UTC ISO instant.");
  if (plan.campaignEndAt && !campaignEnd) errors.push("Campaign end instant must be a valid UTC ISO instant.");
  if (campaignStart && campaignEnd && campaignEnd.getTime() < campaignStart.getTime()) errors.push("Campaign end must be on or after campaign start.");
  const hasPageTargets = resolveAutomationBindingIds(plan).length > 0;
  AUTOMATION_PLATFORMS.forEach((platform) => {
    if (platform === "facebook" && hasPageTargets) return;
    const item = plan.platforms?.[platform];
    if (!item) {
      errors.push(`${platform} plan is missing.`);
      return;
    }
    if (item.invalidReason) errors.push(`${platform} plan entry is invalid: ${item.invalidReason}.`);
    const counts = [item.postsPerDay, ...(item.formatMode ?? plan.formatMode ? [] : [item.imageCount, item.videoCount])];
    const formatCounts = resolvedFormatCounts(item, platform, errors, plan);
    validateAutomationFormat(item.formatMode, item.formatMix, platform, errors);
    if (item.strategySelection !== undefined && !validAutomationStrategySelection(item.strategySelection)) errors.push(`${platform} strategy selection is invalid.`);
    if (counts.some((count) => !Number.isInteger(count) || count < 0)) errors.push(`${platform} counts must be non-negative integers.`);
    if (item.enabled && item.postsPerDay < 1) errors.push(`${platform} needs at least one post when enabled.`);
    if (formatCounts.imageCount + formatCounts.videoCount !== item.postsPerDay) errors.push(`${platform} image and video counts must equal posts per day.`);
    if (item.publishTimes.length !== item.postsPerDay) errors.push(`${platform} needs one publish time for every post.`);
    if (item.publishTimes.some((time) => !isValidAutomationTime(time))) errors.push(`${platform} publish times must use HH:mm.`);
    if (item.publishTimes.some((time, index) => index > 0 && time <= item.publishTimes[index - 1])) errors.push(`${platform} publish times must be ordered.`);
    if (item.enabled && !hasValidRunDays(item.runDays)) errors.push(`${platform} needs one or more valid run days (1-7).`);
    if (platform === "youtube" && item.enabled && formatCounts.imageCount > 0) errors.push("youtube supports video posts only; set images to 0.");
  });
  resolveAutomationTargetPageIdsFromBindings(plan).forEach((pageId) => {
    const pagePlan = plan.pagePlans?.[pageId];
    if (!pagePlan?.facebook) {
      errors.push(`facebook Page ${pageId} needs an explicit per-Page schedule.`);
      return;
    }
    const item = pagePlan.facebook;
    if (item.invalidReason) errors.push(`facebook Page ${pageId} plan entry is invalid: ${item.invalidReason}.`);
    if (item.enabled && item.postsPerDay < 1) errors.push(`facebook Page ${pageId} needs at least one post when enabled.`);
    const formatCounts = resolvedFormatCounts(item, `facebook Page ${pageId}`, errors, plan);
    if (formatCounts.imageCount + formatCounts.videoCount !== item.postsPerDay) errors.push(`facebook Page ${pageId} image and video counts must equal posts per day.`);
    if (item.publishTimes.length !== item.postsPerDay) errors.push(`facebook Page ${pageId} needs one publish time for every post.`);
    if (item.publishTimes.some((time) => !isValidAutomationTime(time))) errors.push(`facebook Page ${pageId} publish times must use HH:mm.`);
    if (item.publishTimes.some((time, index) => index > 0 && time <= item.publishTimes[index - 1])) errors.push(`facebook Page ${pageId} publish times must be ordered.`);
    if (item.enabled && !hasValidRunDays(item.runDays)) errors.push(`facebook Page ${pageId} needs one or more valid run days (1-7).`);
  });
  Object.entries(plan.pagePlans ?? {}).forEach(([pageId, pagePlan]) => {
    Object.entries(pagePlan ?? {}).forEach(([platform, override]) => {
      if (override?.invalidReason) errors.push(`${platform} Page ${pageId} plan entry is invalid: ${override.invalidReason}.`);
      if (override?.strategySelection !== undefined && !validAutomationStrategySelection(override.strategySelection)) errors.push(`${platform} Page ${pageId} strategy selection is invalid.`);
    });
  });
  Object.entries(plan.bindingSchedules ?? {}).forEach(([bindingId, schedule]) => {
    const scheduleValidation = validateBindingSchedule(schedule, plan);
    scheduleValidation.errors.forEach((error) => errors.push(`${bindingId}: ${error}`));
  });
  return { ok: errors.length === 0, errors };
}

export type BrandKitStatus = { ready: boolean; missing: string[] };
export function selectAutomationMediaForPost(
  _plan: Pick<AutomationPlan, "selectedAssetIds">,
  assets: MediaInventoryRecord[],
  request: MediaSelectionRequest,
  ledger: MediaReservationLedger,
): MediaInventoryRecord | undefined {
  return selectMediaForPost(assets, request, ledger);
}

export function canGenerateAutomationImageWithoutSource(mediaKind: "image" | "video", provider: ImageProvider, providerLive: boolean): boolean {
  return mediaKind === "image" && providerLive && (provider === "google_flow" || provider === "vertex_ai");
}

export function buildAutomationIdeaPrompt(input: {
  brandName: string;
  brandVoice: string;
  brandSystem: Pick<BrandSystem, "visualTokens">;
  platform: SocialPlatform;
  targetPageId: string;
  publishTime: string;
  mediaKind: "image" | "video";
}): string {
  return [
    `Create one concise content idea for the ${input.brandName} brand.`,
    `Brand name: ${input.brandName}.`,
    `Brand voice: ${input.brandVoice}.`,
    `Platform: ${input.platform}. Facebook Page: ${input.targetPageId}. Exact publish time: ${input.publishTime}.`,
    `Requested media kind: ${input.mediaKind}.`,
    `Brand Kit visual context: primary ${input.brandSystem.visualTokens.primary}; secondary ${input.brandSystem.visualTokens.secondary}; typography ${sanitizeBrandTypography(input.brandSystem.visualTokens.typography)}.`,
    "Return exactly one variant in the existing structured JSON contract; use the title/body for one concise idea, no hashtags, no fabricated claims, and no commentary.",
  ].join(" ");
}

const MAX_AUTOMATION_IDEA_LENGTH = 280;
const PROMPT_CONTROL_PATTERNS = [
  /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|earlier|above)\s+(?:instructions?|prompts?)\b/giu,
  /(?:^|\s)(?:bỏ qua|bo qua)\s+(?:mọi\s+)?(?:chỉ dẫn|chi dan|hướng dẫn|huong dan)\s+(?:trước đó|truoc do)(?=\s|$)/giu,
  /\b(?:system|developer|assistant)\s+(?:prompt|message)\b/giu,
  /\b(?:reveal|show|print|provide)\s+(?:the\s+)?(?:secret|token|password|api(?:\s+|[-_])key|access\s+token)\b/giu,
  /\b(?:follow|execute|run)\s+(?:these|the\s+following)\s+instructions?\b/giu,
];

/** Provider output boundary: preserve readable Unicode content, but remove prompt-control syntax and instructions. */
export function sanitizeAutomationIdea(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let normalized = value.trim()
    .replace(/[^\p{L}\p{M}\p{N}\s._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const pattern of PROMPT_CONTROL_PATTERNS) normalized = normalized.replace(pattern, " ");
  normalized = normalized.replace(/\s+/g, " ").trim().slice(0, MAX_AUTOMATION_IDEA_LENGTH).trim();
  return normalized || undefined;
}

export function extractAutomationIdea(variant: Pick<ContentVariant, "title" | "body"> | undefined): string | undefined {
  const title = typeof variant?.title === "string" ? variant.title : "";
  const body = typeof variant?.body === "string" ? variant.body : "";
  return sanitizeAutomationIdea([title, body].filter(Boolean).join(" — "));
}

export function deriveAutomationTopic(input: { brandName: string; platform: SocialPlatform; identityContext: string; intelligenceContext: string; recipe?: Pick<ContentRecipe, "name" | "hookGuidance">; existingTopics: readonly string[] }): string | undefined {
  const existing = new Set(input.existingTopics.map((topic) => topic.trim().toLowerCase()).filter(Boolean));
  const intelligence = input.intelligenceContext.trim();
  const sources = (intelligence ? [intelligence] : [input.identityContext, input.recipe?.hookGuidance, input.recipe?.name])
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  for (const source of sources) {
    const lines = source.split(/\n+/).map((line) => line.trim()).filter((line) => line && !/^(?:identity version|brand identity|platform|target|prompt blueprint|content recipe|recipe|hook|structure|cta|quality checks|brief)\s*:/i.test(line)).map((line) => line.replace(/^[A-Za-z][A-Za-z ]{0,40}:\s*/, "").trim()).filter(Boolean);
    for (const line of lines) {
      const candidate = sanitizeAutomationIdea(line);
      if (!candidate || candidate.length < 12 || /^(?:identity version|prompt blueprint|content recipe|recipe|hook|structure|cta|quality checks|brief)\b/i.test(candidate)) continue;
      const topic = `${input.brandName.trim()}: ${candidate}`.slice(0, MAX_AUTOMATION_IDEA_LENGTH).trim();
      if (!existing.has(topic.toLowerCase()) && ![...existing].some((known) => topic.toLowerCase().includes(known))) return topic;
    }
  }
  return undefined;
}

export function buildAutomationCopyPrompt(input: { brandName: string; platform: SocialPlatform; idea: unknown; mediaAssetId: string; mediaName: string }): { prompt: string; idea: string } {
  const idea = sanitizeAutomationIdea(input.idea) ?? "a brand-safe concept";
  return { prompt: `Write a review-first ${input.platform} caption for ${input.brandName} using this idea: ${idea}; selected media ${input.mediaAssetId} (${input.mediaName}).`, idea };
}

export function buildAutomationImagePrompt(input: {
  brandName: string;
  brandVoice: string;
  brandSystem: Pick<BrandSystem, "visualTokens">;
  platform: SocialPlatform;
  targetPageId: string;
  publishTime: string;
  topic: string;
}): string {
  const typography = sanitizeBrandTypography(input.brandSystem.visualTokens.typography);
  return [
    `Create one review-first image visual for the ${input.brandName} brand.`,
    `Brand identity: ${input.brandName}.`,
    `Brand voice: ${input.brandVoice}.`,
    `Brand Kit visual tokens: primary ${input.brandSystem.visualTokens.primary}; secondary ${input.brandSystem.visualTokens.secondary}; typography ${typography}.`,
    `Platform: ${input.platform}. Facebook Page: ${input.targetPageId}. Exact publish time: ${input.publishTime}.`,
    `Content idea/topic: ${sanitizeAutomationIdea(input.topic) ?? "a brand-safe concept"}.`,
    "Do not add unverified claims, watermarks, or provider branding.",
  ].join(" ");
}

export function getBrandKitStatus(brandStatus: string | undefined, voice: string | undefined, brandKitLinked = brandStatus === "active"): BrandKitStatus {
  const missing: string[] = [];
  if (!brandKitLinked) missing.push("Brand Kit is not linked");
  if (brandStatus !== "active") missing.push("Brand System is not active");
  if (!voice?.trim()) missing.push("Brand voice is missing");
  return { ready: missing.length === 0, missing };
}

function zonedParts(date: Date, timezone: string): { year: string; month: string; day: string; hour: string; minute: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
  } catch {
    const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
  }
}

export function nextAutomationScheduleAt(now: Date, publishTime: string, timezone: string): Date {
  const local = zonedParts(now, timezone);
  const base = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day)));
  for (let delta = 0; delta <= 370; delta += 1) {
    const date = new Date(base.getTime() + delta * 86_400_000).toISOString().slice(0, 10);
    const resolved = resolveLocalDateTime(date, publishTime, timezone);
    if (resolved.ok && resolved.value.getTime() > now.getTime()) return resolved.value;
  }
  throw new Error("SCHEDULE_TIME_INVALID");
}

export function automationPlanDueKey(plan: AutomationPlan, now: Date): string {
  const local = zonedParts(now, plan.cron.timezone);
  return `${plan.id}:${local.year}-${local.month}-${local.day}`;
}

export function automationDraftKey(plan: AutomationPlan, now: Date, platform: SocialPlatform, postIndex: number): string {
  return `${automationPlanDueKey(plan, now)}:${platform}:${postIndex}`;
}

export function isAutomationPlanWithinCampaignWindow(plan: AutomationPlan, instant: Date): boolean {
  if (!Number.isFinite(instant.getTime())) return false;
  const start = plan.campaignStartAt ? parseCampaignInstant(plan.campaignStartAt)?.getTime() : undefined;
  const end = plan.campaignEndAt ? parseCampaignInstant(plan.campaignEndAt)?.getTime() : undefined;
  if ((plan.campaignStartAt && start === undefined) || (plan.campaignEndAt && end === undefined)) return false;
  return (start === undefined || instant.getTime() >= start) && (end === undefined || instant.getTime() <= end);
}

export function getDueAutomationPlans(plans: AutomationPlan[], now: Date): AutomationPlan[] {
  return plans.filter((plan) => {
    const cron = plan?.cron;
    if (!plan || typeof plan !== "object" || !cron || typeof cron !== "object" || Array.isArray(cron) || typeof cron.enabled !== "boolean" || !cron.enabled || typeof cron.timezone !== "string" || !isValidAutomationTimezone(cron.timezone) || typeof cron.startTime !== "string" || !isValidAutomationTime(cron.startTime)) return false;
    if (!isAutomationPlanWithinCampaignWindow(plan, now)) return false;
    const local = zonedParts(now, cron.timezone);
    const currentTime = `${local.hour}:${local.minute}`;
    if (currentTime < cron.startTime) return false;
    if (!plan.lastDueAt) return true;
    const lastDue = new Date(plan.lastDueAt);
    return Number.isNaN(lastDue.getTime()) || automationPlanDueKey(plan, now) !== automationPlanDueKey(plan, lastDue);
  });
}

export const REVIEW_ONLY_DRAFT_STATUS = "Needs review" as const;

/** Select active, valid Page-targeted plans for an explicit review-only run. */
export function selectAutomationPlansForRun(plans: AutomationPlan[], now: Date, forceReviewOnlyOrCatalog: boolean | BrandStrategyCatalog = false, catalog?: BrandStrategyCatalog, runScope?: AutomationPlanRunScope): AutomationPlan[] {
  const forceReviewOnly = typeof forceReviewOnlyOrCatalog === "boolean" ? forceReviewOnlyOrCatalog : false;
  const currentCatalog = typeof forceReviewOnlyOrCatalog === "boolean" ? catalog : forceReviewOnlyOrCatalog;
  const candidates = forceReviewOnly ? plans : getDueAutomationPlans(plans, now);
  return candidates.filter((plan) => {
    const scopeAllowed = !runScope || (plan.id === runScope.planId && plan.workspaceId === runScope.clientId && plan.brandId === runScope.brandId);
    const statusAllowed = forceReviewOnly ? (plan.status === "active" || plan.status === "draft") : plan.status === "active";
    const cronAllowed = Boolean(plan.cron && typeof plan.cron === "object" && plan.cron.enabled === true);
    const display = automationPlanDisplayState(plan, currentCatalog);
    const strategyReady = !hasNewAutomationStrategyFields(plan) || Boolean(currentCatalog && automationPlanCatalogReviewState(plan, currentCatalog).ok);
    return scopeAllowed && statusAllowed && cronAllowed && !display.reviewRequired && isAutomationPlanWithinCampaignWindow(plan, now) && resolveAutomationBindingIds(plan).length > 0 && validateAutomationPlan(plan, currentCatalog).ok && strategyReady;
  });
}

export function automationDraftKeyExists<T extends { automationKey?: string; status?: string }>(drafts: T[], automationKey: string): boolean {
  return drafts.some((draft) => draft.automationKey === automationKey && draft.status !== "Failed");
}

export function markAutomationPlanDue(plan: AutomationPlan, now: Date): AutomationPlan {
  return { ...plan, lastDueAt: now.toISOString(), updatedAt: now.toISOString() };
}

/** Persist that the plan's local calendar day has been attempted, including failed runs. */
export function markAutomationPlanAttempted(plan: AutomationPlan, now: Date): AutomationPlan {
  return markAutomationPlanDue(plan, now);
}

/** Keep one authoritative plan per workspace/brand so stale historical plans cannot replace an edited schedule. */
export function upsertAutomationPlan(plans: AutomationPlan[], plan: AutomationPlan, strategySnapshot?: AutomationStrategySnapshot): AutomationPlan[] {
  const candidate = strategySnapshot ? { ...plan, strategySnapshot } : plan;
  const normalized = normalizeAutomationPlan(candidate);
  const selection = normalized.strategySelection;
  const snapshotSelection = normalized.strategySnapshot?.selection;
  if (selection && snapshotSelection && (selection.objective !== snapshotSelection.objective || selection.pillar !== snapshotSelection.pillar || selection.angle !== snapshotSelection.angle)) throw new Error("STRATEGY_SNAPSHOT_SELECTION_MISMATCH");
  if (strategySnapshot && (!normalized.strategySnapshot || !validAutomationStrategySnapshot(normalized.strategySnapshot))) throw new Error(`STRATEGY_SNAPSHOT_INVALID:${automationStrategySnapshotValidationErrors(normalized.strategySnapshot).join("|")}`);
  if (normalized.status === "active" && hasNewAutomationStrategyFields(normalized) && (!normalized.strategySelection || !normalized.strategySnapshot || !validAutomationStrategySnapshot(normalized.strategySnapshot))) throw new Error("STRATEGY_SNAPSHOT_REQUIRED");
  return [normalized, ...plans.filter((stored) => stored.id !== plan.id)];
}

export type AutomationSlotSelection = { ok: true; scheduledAt: string; planId: string } | { ok: false; code: "PLAN_NOT_FOUND" | "NO_AVAILABLE_PLAN_SLOT" };

export type AutomationScheduleValidation = { ok: true } | { ok: false; code: "INVALID_SCHEDULE" | "TARGET_SCHEDULE_DISABLED" | "OUTSIDE_CAMPAIGN" | "RUN_DAY_NOT_ALLOWED" | "SLOT_RESERVED" };

export function resolveAutomationTargetJobIds(publications: readonly { id: string; variantId?: string; workerJobId?: string; simulation?: boolean; legacyNonLive?: boolean }[], variantId: string, storedJobIds: readonly string[] = []): string[] {
  const scoped = publications.filter((publication) => publication.variantId === variantId);
  const legacyPublications = scoped.filter((publication) => publication.simulation === true || publication.legacyNonLive === true);
  const legacyIds = new Set(legacyPublications.flatMap((publication) => [publication.id, publication.workerJobId].filter((id): id is string => Boolean(id))));
  if (storedJobIds.length) return storedJobIds.filter((id) => typeof id === "string" && id.trim() && !legacyIds.has(id) && !legacyPublications.some((publication) => id.endsWith(publication.id)));
  return scoped.filter((publication) => publication.simulation !== true && publication.legacyNonLive !== true).map((publication) => publication.workerJobId ?? publication.id);
}

export function targetPublicationBindingsAcknowledged(publications: readonly { bindingId?: string; state?: string; commandStatus?: string; pendingCommandId?: string; workerAckState?: string; simulation?: boolean; legacyNonLive?: boolean }[], bindingIds: readonly string[]): boolean {
  const selected = [...new Set(bindingIds.filter(Boolean))];
  return selected.length > 0 && selected.every((bindingId) => {
    const matches = publications.filter((publication) => publication.bindingId === bindingId);
    return matches.length === 1 && matches[0]?.simulation !== true && matches[0]?.legacyNonLive !== true && matches[0]?.state === "scheduled" && matches[0]?.commandStatus === "acknowledged" && !matches[0]?.pendingCommandId
      && ["acknowledged", "confirmed", "accepted"].includes(matches[0]?.workerAckState ?? "");
  });
}

export function hasProviderConfirmedPublicationState(publication: { state?: string; providerJobId?: string; workerState?: string; simulation?: boolean; legacyNonLive?: boolean }): boolean {
  return publication.state === "published" && publication.simulation !== true && publication.legacyNonLive !== true && Boolean(publication.providerJobId?.trim());
}

export function targetPublicationsProviderConfirmed(publications: readonly { bindingId?: string; state?: string; providerJobId?: string; simulation?: boolean; legacyNonLive?: boolean }[], bindingIds: readonly string[]): boolean {
  const selected = [...new Set(bindingIds.filter(Boolean))];
  return selected.length > 0 && selected.every((bindingId) => {
    const matches = publications.filter((publication) => publication.bindingId === bindingId);
    return matches.length === 1 && hasProviderConfirmedPublicationState(matches[0]!);
  });
}

export function targetPublicationsProviderConfirmedForScope(publications: readonly { clientId?: string; brandId?: string; variantId?: string; contentRunId?: string; bindingId?: string; state?: string; providerJobId?: string; simulation?: boolean; legacyNonLive?: boolean }[], scope: { clientId: string; brandId: string; variantId: string; contentRunId?: string }, bindingIds: readonly string[]): boolean {
  const scoped = publications.filter((publication) => publication.clientId === scope.clientId && publication.brandId === scope.brandId && publication.variantId === scope.variantId && (!scope.contentRunId || publication.contentRunId === scope.contentRunId));
  return targetPublicationsProviderConfirmed(scoped, bindingIds);
}

export function countProviderConfirmedPublications(publications: readonly { state?: string; providerJobId?: string; workerState?: string; simulation?: boolean; legacyNonLive?: boolean }[]): number {
  return publications.filter(hasProviderConfirmedPublicationState).length;
}

/** Validate an operator-entered time against one plan target and its UTC Page reservation. */
export function validateAutomationPlanSchedule(plan: AutomationPlan, platform: SocialPlatform, pageId: string, scheduledAt: Date, reservedSlots: readonly string[] = []): AutomationScheduleValidation {
  if (!Number.isFinite(scheduledAt.getTime()) || !isValidAutomationTimezone(plan.cron.timezone)) return { ok: false, code: "INVALID_SCHEDULE" };
  const start = plan.campaignStartAt ? parseCampaignInstant(plan.campaignStartAt)?.getTime() ?? Number.NaN : Number.NEGATIVE_INFINITY;
  const end = plan.campaignEndAt ? parseCampaignInstant(plan.campaignEndAt)?.getTime() ?? Number.NaN : Number.POSITIVE_INFINITY;
  if ((plan.campaignStartAt && !Number.isFinite(start)) || (plan.campaignEndAt && !Number.isFinite(end)) || scheduledAt.getTime() < start || scheduledAt.getTime() > end) return { ok: false, code: "OUTSIDE_CAMPAIGN" };
  const targetPlan = getAutomationPlatformPlanForPage(plan, pageId, platform);
  if (!targetPlan?.enabled) return { ok: false, code: "TARGET_SCHEDULE_DISABLED" };
  const runDays = targetPlan.runDays?.length ? targetPlan.runDays : AUTOMATION_RUN_DAYS;
  if (!runDays.includes(automationRunDayInTimezone(scheduledAt, plan.cron.timezone))) return { ok: false, code: "RUN_DAY_NOT_ALLOWED" };
  if (reservedSlots.includes(`${platform}|${pageId}|${scheduledAt.toISOString()}`)) return { ok: false, code: "SLOT_RESERVED" };
  return { ok: true };
}

/** Pick the next free slot owned by the draft's plan and binding. */
export function selectNextAvailablePlanSlot(plans: AutomationPlan[], planId: string, bindingId: string, requestedAt: Date, reservedSlots: readonly string[] = [], targetPageIds?: readonly string[], platform: SocialPlatform = "facebook"): AutomationSlotSelection {
  const plan = plans.find((candidate) => candidate.id === planId);
  if (!plan) return { ok: false, code: "PLAN_NOT_FOUND" };
  if (!Number.isFinite(requestedAt.getTime())) return { ok: false, code: "NO_AVAILABLE_PLAN_SLOT" };
  const campaignStart = plan.campaignStartAt ? parseCampaignInstant(plan.campaignStartAt) : undefined;
  const campaignEnd = plan.campaignEndAt ? parseCampaignInstant(plan.campaignEndAt) : undefined;
  if ((plan.campaignStartAt && !campaignStart) || (plan.campaignEndAt && !campaignEnd)) return { ok: false, code: "NO_AVAILABLE_PLAN_SLOT" };
  const reserved = new Set(reservedSlots);
  const pageIds = [...new Set(targetPageIds?.length ? targetPageIds : plan.targetPageIds?.length ? [plan.targetPageIds[0]] : [])];
  const schedules = pageIds.length
    ? pageIds.map((pageId) => getAutomationPlatformPlanForPage(plan, pageId, platform))
    : [plan.platforms[platform]];
  const validSchedules = schedules.filter((item): item is AutomationPlatformPlan => Boolean(item?.enabled));
  const times = (validSchedules[0]?.publishTimes ?? []).filter((time) => validSchedules.every((item) => item.publishTimes.includes(time))).sort();
  if (!times.length) return { ok: false, code: "NO_AVAILABLE_PLAN_SLOT" };
  const runDays = AUTOMATION_RUN_DAYS.filter((day) => validSchedules.every((item) => (item.runDays?.length ? item.runDays : AUTOMATION_RUN_DAYS).includes(day)));
  if (!runDays.length) return { ok: false, code: "NO_AVAILABLE_PLAN_SLOT" };
  const requestedAtMs = requestedAt.getTime();
  const campaignStartMs = campaignStart?.getTime();
  const clampedToCampaignStart = campaignStartMs !== undefined && requestedAtMs < campaignStartMs;
  let cursor = new Date(clampedToCampaignStart ? campaignStartMs - 1 : Math.max(requestedAtMs, campaignStartMs ?? requestedAtMs));
  const end = campaignEnd?.getTime() ?? Number.NaN;
  for (let attempt = 0; attempt < 56; attempt += 1) {
    for (const publishTime of times) {
      const candidate = nextScheduledAtForRunDays(cursor, publishTime, plan.cron.timezone, runDays);
      if (Number.isFinite(end) && candidate.getTime() > end) return { ok: false, code: "NO_AVAILABLE_PLAN_SLOT" };
      const reservedByTarget = pageIds.length
        ? pageIds.some((pageId) => reserved.has(`${platform}|${pageId}|${candidate.toISOString()}`))
        : reserved.has(`${bindingId}|${candidate.toISOString()}`);
      if (!reservedByTarget) return { ok: true, scheduledAt: candidate.toISOString(), planId };
      cursor = new Date(candidate.getTime() + 60_000);
    }
  }
  return { ok: false, code: "NO_AVAILABLE_PLAN_SLOT" };
}

/** Select the newest matching plan so a remount cannot restore an older historical schedule. */
export function selectCanonicalAutomationPlan(plans: AutomationPlan[], workspaceId: string, brandId: string): AutomationPlan | undefined {
  const selected = plans
    .filter((plan) => plan.workspaceId === workspaceId && plan.brandId === brandId)
    .reduce<AutomationPlan | undefined>((latest, candidate) => {
      if (!latest) return candidate;
      const latestTime = Date.parse(latest.updatedAt);
      const candidateTime = Date.parse(candidate.updatedAt);
      if (Number.isNaN(latestTime)) return candidate;
      if (Number.isNaN(candidateTime)) return latest;
      return candidateTime > latestTime ? candidate : latest;
    }, undefined);
  return selected && normalizeAutomationPlan(selected);
}

export type AutomationPlannerDraftScope = { profileId: string; clientId: string; brandId: string; planId: string };
export type AutomationPlannerActiveScope = Omit<AutomationPlannerDraftScope, "planId">;
export type AutomationPlannerDraftState = {
  scope: AutomationPlannerDraftScope;
  plan: AutomationPlan;
  dirty: boolean;
  selectedJobId?: string;
  editingJobId: string;
  editingTime: string;
  editRevision: number;
};
export type AutomationPlannerSaveToken = { draftKey: string; scopeGeneration: number; requestId: number; editRevision: number };
export type AutomationPlannerSaveResult = { plan?: AutomationPlan; error?: string; currentScope: boolean };
export type AutomationPlannerBrand = Pick<BrandRecord, "id" | "clientId" | "workspaceId">;
export type AutomationPlanDisplayState = { status: AutomationPlanStatus | "review_required"; label: string; reviewRequired: boolean; message?: string };
export type ReviewOnlyAutomationPlanGuard =
  | { ok: true }
  | { ok: false; code: "PLANNER_DRAFT_DIRTY" | "PLANNER_PLAN_NOT_PERSISTED" | "PLANNER_PLAN_SELECTION_CHANGED" | "PLANNER_PAGE_TARGET_REQUIRED" | "PLANNER_REVIEW_REQUIRED" | "PLANNER_INVALID"; message: string };

export function automationPlannerScopeForBrand(profileId: string, brand: AutomationPlannerBrand): AutomationPlannerActiveScope {
  return { profileId, clientId: clientIdForBrand(brand), brandId: brand.id };
}

/** Match a plan to the active Brand Client, with one explicit adapter for legacy workspace-scoped plans. */
export function automationPlanMatchesBrandScope(plan: Pick<AutomationPlan, "workspaceId" | "brandId">, brand: AutomationPlannerBrand): boolean {
  return plan.brandId === brand.id && (plan.workspaceId === clientIdForBrand(brand) || plan.workspaceId === brand.workspaceId);
}

export function canonicalizeAutomationPlanScope(plan: AutomationPlan, brand: AutomationPlannerBrand): AutomationPlan {
  if (!automationPlanMatchesBrandScope(plan, brand) || plan.workspaceId === clientIdForBrand(brand)) return plan;
  return { ...plan, workspaceId: clientIdForBrand(brand) };
}

export function automationPlanDisplayState(plan: AutomationPlan, catalog?: BrandStrategyCatalog): AutomationPlanDisplayState {
  const catalogReview = catalog ? automationPlanCatalogReviewState(plan, catalog) : undefined;
  if (catalogReview && !catalogReview.ok) return { status: "review_required", label: "Review required", reviewRequired: true, message: catalogReview.message };
  if (hasPlannerStrategyOverrides(plan)) return { status: "review_required", label: "Review required", reviewRequired: true, message: "This plan contains hidden strategy overrides; save it again to apply the visible root strategy." };
  return { status: plan.status, label: plan.status === "active" ? "Đang chạy" : plan.status === "paused" ? "Tạm dừng" : "Bản nháp", reviewRequired: false };
}

export function reviewOnlyAutomationPlanGuard(input: { plan?: AutomationPlan; persistedPlan?: AutomationPlan; draftDirty: boolean; catalog?: BrandStrategyCatalog }): ReviewOnlyAutomationPlanGuard {
  if (input.draftDirty) return { ok: false, code: "PLANNER_DRAFT_DIRTY", message: "Save this draft before running; Run once uses the last acknowledged plan." };
  if (!input.plan || !input.persistedPlan) return { ok: false, code: "PLANNER_PLAN_NOT_PERSISTED", message: "Save this plan first; Run once uses only an acknowledged Page-targeted plan." };
  if (input.plan.id !== input.persistedPlan.id || input.plan.workspaceId !== input.persistedPlan.workspaceId || input.plan.brandId !== input.persistedPlan.brandId || input.plan.updatedAt !== input.persistedPlan.updatedAt || input.plan.revision !== input.persistedPlan.revision) return { ok: false, code: "PLANNER_PLAN_SELECTION_CHANGED", message: "The visible plan differs from the last acknowledged plan; save it before running." };
  if (resolveAutomationBindingIds(input.persistedPlan).length === 0) return { ok: false, code: "PLANNER_PAGE_TARGET_REQUIRED", message: "Select and save at least one Facebook Page before running review-only." };
  const display = automationPlanDisplayState(input.persistedPlan, input.catalog);
  if (display.reviewRequired) return { ok: false, code: "PLANNER_REVIEW_REQUIRED", message: display.message ?? "Review and save the plan before running review-only." };
  if (!validateAutomationPlan(input.persistedPlan, input.catalog).ok) return { ok: false, code: "PLANNER_INVALID", message: "Fix the plan validation errors before running review-only." };
  return { ok: true };
}

export function automationPlannerScopeKey(scope: AutomationPlannerActiveScope): string {
  return JSON.stringify([scope.profileId, scope.clientId, scope.brandId]);
}

export function automationPlannerDraftKey(scope: AutomationPlannerDraftScope): string {
  return JSON.stringify([scope.profileId, scope.clientId, scope.brandId, scope.planId]);
}

export function plannerDraftForScope(drafts: Record<string, AutomationPlannerDraftState>, scope: AutomationPlannerDraftScope): AutomationPlannerDraftState | undefined {
  return drafts[automationPlannerDraftKey(scope)];
}

export function dirtyPlannerDraftForScope(drafts: Record<string, AutomationPlannerDraftState>, scope: AutomationPlannerActiveScope): AutomationPlannerDraftState | undefined {
  return Object.values(drafts).find((draft) => draft.dirty && draft.scope.profileId === scope.profileId && draft.scope.clientId === scope.clientId && draft.scope.brandId === scope.brandId);
}

export function reviseAutomationPlannerDraft(draft: AutomationPlannerDraftState, patch: Partial<Omit<AutomationPlannerDraftState, "scope" | "editRevision">>): AutomationPlannerDraftState {
  return { ...draft, ...patch, editRevision: draft.editRevision + 1 };
}

export function beginAutomationPlannerSave(requestIds: Map<string, number>, inFlight: Set<string>, draftKey: string): number | undefined {
  if (inFlight.has(draftKey)) return undefined;
  const requestId = (requestIds.get(draftKey) ?? 0) + 1;
  requestIds.set(draftKey, requestId);
  inFlight.add(draftKey);
  return requestId;
}

export function finishAutomationPlannerSave(requestIds: Map<string, number>, inFlight: Set<string>, draftKey: string, requestId: number): void {
  if (requestIds.get(draftKey) === requestId) inFlight.delete(draftKey);
}

export function canApplyAutomationPlanSaveResult(captured: AutomationPlannerSaveToken, current: AutomationPlannerSaveToken): boolean {
  return captured.scopeGeneration === current.scopeGeneration
    && captured.requestId === current.requestId
    && captured.draftKey === current.draftKey
    && captured.editRevision === current.editRevision;
}

export function acknowledgeAutomationPlannerDraft(
  drafts: Record<string, AutomationPlannerDraftState>,
  captured: AutomationPlannerSaveToken,
  currentRequestId: number | undefined,
  acknowledgedPlan: AutomationPlan,
): Record<string, AutomationPlannerDraftState> {
  const current = drafts[captured.draftKey];
  if (captured.requestId !== currentRequestId || !current || current.editRevision !== captured.editRevision || current.scope.planId !== acknowledgedPlan.id) return drafts;
  return {
    ...drafts,
    [captured.draftKey]: { ...current, plan: acknowledgedPlan, dirty: false, selectedJobId: undefined, editingJobId: "", editingTime: "" },
  };
}

export function normalizeAutomationPlans(raw: unknown, workspaceId: string): AutomationPlan[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is AutomationPlan => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<AutomationPlan>;
    return candidate.workspaceId === workspaceId && typeof candidate.id === "string" && typeof candidate.brandId === "string" && (candidate.selectedAssetIds === undefined || Array.isArray(candidate.selectedAssetIds)) && (candidate.targetPageIds === undefined || Array.isArray(candidate.targetPageIds)) && Boolean(candidate.platforms) && Boolean(candidate.cron);
  }).map(normalizeAutomationPlan);
}
