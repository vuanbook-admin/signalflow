import { catalogForChannel, strategyCatalogFingerprint, STRATEGY_OBJECTIVE_KEYS, validateStrategyCatalog, type BrandStrategyCatalog, type ContentAngleDefinition, type ContentPillarDefinition, type StrategyChoice, type StrategyObjectiveKey, type StrategySnapshot } from "./contentStrategy";
import { platformCapabilities, type ContentKind, type SocialPlatform } from "./mvpContracts";
import { serializeContentRecipe, validateContentRecipe, validateContentRecipeForStrategy, type ContentRecipe } from "./contentRecipe";
import type { AutomationPlan, AutomationPlatformPlan } from "./automationPlanner";

export type ResolvedStrategy = {
  objectiveKey: StrategyObjectiveKey;
  objectiveLabel: string;
  pillarId: string;
  pillarLabel: string;
  angleId: string;
  angleLabel: string;
  angleGuidance: string;
  angleIdByChannel?: Partial<Record<SocialPlatform, string>>;
  channel: SocialPlatform;
  strategyVersion: number;
  catalogFingerprint: string;
  recipeId?: string;
  format?: "text" | "image" | "video";
  strategySnapshot?: StrategySnapshot;
};

export type ResolveStrategyInput = {
  catalog: BrandStrategyCatalog;
  channel: SocialPlatform;
  selection: {
    objective: StrategyChoice<StrategyObjectiveKey>;
    pillar: StrategyChoice<string>;
    angle: StrategyChoice<string>;
  };
  slotIndex: number;
};

export type AutomationFormatMode = "image" | "video" | "mix";
export type AutomationFormatMix = { image: number; video: number };
export type AutomationStrategySelection = {
  objective: StrategyChoice<StrategyObjectiveKey>;
  pillar: StrategyChoice<string>;
  angle: StrategyChoice<string>;
};

/** New plans use startDate/endDate; start/end is accepted only at raw migration boundaries. */
export type AutomationDateRange = { startDate: string; endDate: string; start?: string; end?: string };

export type CampaignScheduleTemplate = {
  id: string;
  campaignId: string;
  brandId: string;
  timezone: string;
  timesByWeekday: Record<number, string[]>;
  version: number;
  source: "brand_default" | "campaign_clone" | "campaign_override";
};

export type ResolvedAutomationSlot = {
  id: string;
  campaignId: string;
  scheduledAt: string;
  platform: SocialPlatform;
  targetPageId?: string;
  bindingId?: string;
  mediaKind: "image" | "video";
  contentKind: ContentKind;
  objectiveKey: StrategyObjectiveKey;
  pillarId: string;
  angleIdByChannel: Partial<Record<SocialPlatform, string>>;
  strategyVersion: number;
  catalogFingerprint: string;
};

export type AutomationStrategySnapshotSlot = Pick<ResolvedAutomationSlot, "id" | "scheduledAt" | "platform" | "objectiveKey" | "pillarId" | "angleIdByChannel" | "strategyVersion" | "catalogFingerprint"> & {
  objectiveLabel: string;
  pillarLabel: string;
  angleId: string;
  angleLabel: string;
  angleGuidance: string;
  angleLabelByChannel: Partial<Record<SocialPlatform, string>>;
  angleGuidanceByChannel: Partial<Record<SocialPlatform, string>>;
  recipeId: string | null;
  recipeGuidance: string;
  catalogVersion: number;
  capturedAt: string;
};

export type AutomationStrategySnapshot = {
  catalogVersion: number;
  catalogFingerprint: string;
  selection: AutomationStrategySelection;
  targetChannels: SocialPlatform[];
  resolvedSlots: AutomationStrategySnapshotSlot[];
  capturedAt: string;
  revision?: number;
  resolvedFingerprint: string;
};

export type AutomationStrategySnapshotInput = {
  plan: AutomationPlan;
  catalog: BrandStrategyCatalog;
  slots?: readonly ResolvedAutomationSlot[];
  preview?: { ok: true; slots: readonly ResolvedAutomationSlot[] } | { ok: false; errors: string[] };
  recipes?: readonly ContentRecipe[];
  capturedAt?: string;
};

export type AutomationPlanCatalogReview = {
  ok: boolean;
  matrixUpdated: boolean;
  reviewRequired: boolean;
  code?: "STRATEGY_CATALOG_UPDATED";
  message?: string;
};

const PLATFORMS: readonly SocialPlatform[] = ["facebook", "instagram", "tiktok", "youtube"];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const UTC_ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;
const VERIFIED_PREVIEWS = new WeakSet<object>();

function validUtcInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_ISO_INSTANT.exec(value);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === `${match[1]}T${match[2]}:${match[3]}:${match[4]}`;
}

export function isResolvedAutomationSlot(value: unknown, targetChannels?: readonly SocialPlatform[], requireMedia = true, requireIdentity = true): value is ResolvedAutomationSlot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const slot = value as Partial<ResolvedAutomationSlot>;
  const mediaValid = !requireMedia || (slot.mediaKind === "image" && slot.contentKind === "image") || (slot.mediaKind === "video" && (slot.contentKind === "video" || slot.contentKind === "short_video"));
  const identityValid = !requireIdentity || (typeof slot.campaignId === "string" && Boolean(slot.campaignId.trim()));
  const basicValid = typeof slot.id === "string" && Boolean(slot.id.trim()) && identityValid && validUtcInstant(slot.scheduledAt) && PLATFORMS.includes(slot.platform as SocialPlatform) && mediaValid && STRATEGY_OBJECTIVE_KEYS.includes(slot.objectiveKey as StrategyObjectiveKey) && typeof slot.pillarId === "string" && Boolean(slot.pillarId.trim()) && typeof slot.strategyVersion === "number" && Number.isInteger(slot.strategyVersion) && slot.strategyVersion >= 1 && typeof slot.catalogFingerprint === "string" && Boolean(slot.catalogFingerprint.trim()) && Boolean(slot.angleIdByChannel) && typeof slot.angleIdByChannel === "object" && !Array.isArray(slot.angleIdByChannel);
  if (!basicValid) return false;
  const angleEntries = Object.entries(slot.angleIdByChannel ?? {});
  const channels = targetChannels ?? [slot.platform as SocialPlatform];
  const result = channels.every((channel) => PLATFORMS.includes(channel) && typeof slot.angleIdByChannel?.[channel] === "string" && Boolean(slot.angleIdByChannel[channel]?.trim()))
    && angleEntries.every(([channel, angleId]) => PLATFORMS.includes(channel as SocialPlatform) && typeof angleId === "string" && Boolean(angleId.trim()));
  return result;
}

function error(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}

function ordered<T extends { order: number; id?: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.order - right.order || (left.id ?? "").localeCompare(right.id ?? ""));
}

function modulo(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function validSlotIndex(value: number): boolean {
  return Number.isInteger(value) && Number.isFinite(value);
}

export function stableMixSequence<T extends string>(values: readonly T[], slotCount: number, startIndex = 0): T[] {
  if (!Number.isInteger(slotCount) || slotCount <= 0 || values.length === 0) return [];
  const start = validSlotIndex(startIndex) ? modulo(startIndex, values.length) : 0;
  return Array.from({ length: slotCount }, (_, index) => values[modulo(start + index, values.length)]!);
}

function availableObjectives(catalog: BrandStrategyCatalog): BrandStrategyCatalog["objectives"] {
  return ordered(catalog.objectives.filter((item) => item.enabled));
}

function availablePillars(catalog: BrandStrategyCatalog): ContentPillarDefinition[] {
  return ordered(catalog.pillars.filter((item) => item.enabled)).map((pillar) => ({ ...pillar, angles: ordered(pillar.angles.filter((angle) => angle.enabled)) }));
}

function availableAngles(pillar: ContentPillarDefinition): ContentAngleDefinition[] {
  return ordered(pillar.angles.filter((angle) => angle.enabled));
}

function choose<T extends { id: string }>(items: readonly T[], choice: StrategyChoice<string>, slotIndex: number): T | undefined {
  if (items.length === 0) return undefined;
  if (choice === "mix") return items[modulo(slotIndex, items.length)];
  return items.find((item) => item.id === choice);
}

function chooseObjective(catalog: BrandStrategyCatalog, choice: StrategyChoice<StrategyObjectiveKey>, slotIndex: number): BrandStrategyCatalog["objectives"][number] | undefined {
  const items = availableObjectives(catalog);
  if (items.length === 0) return undefined;
  if (choice === "mix") return items[modulo(slotIndex, items.length)];
  return items.find((item) => item.key === choice);
}

export function resolveStrategyForSlot(input: ResolveStrategyInput): { ok: true; strategy: ResolvedStrategy } | { ok: false; code: string; message: string } {
  if (!PLATFORMS.includes(input.channel) || !validSlotIndex(input.slotIndex) || input.slotIndex < 0 || !input.selection || typeof input.selection !== "object") return error("STRATEGY_INPUT_INVALID", "Strategy channel, selection, and slot index must be valid.");
  let filtered: BrandStrategyCatalog;
  try {
    filtered = catalogForChannel(input.catalog, input.channel);
  } catch {
    return error("STRATEGY_CATALOG_INVALID", "The brand strategy catalog is invalid for this channel.");
  }

  const objective = chooseObjective(filtered, input.selection.objective, input.slotIndex);
  if (!objective) return error("STRATEGY_OPTION_UNAVAILABLE", `Objective "${String(input.selection.objective)}" is not enabled for ${input.channel}.`);

  const pillars = availablePillars(filtered);
  if (pillars.length === 0) return error("STRATEGY_OPTION_UNAVAILABLE", `No enabled strategy pillar is available for ${input.channel}.`);
  const angleChoice = input.selection.angle;
  let pillar: ContentPillarDefinition | undefined;
  if (input.selection.pillar === "mix") {
    if (angleChoice === "mix") pillar = pillars[modulo(input.slotIndex, pillars.length)];
    else {
      const compatible = pillars.filter((item) => availableAngles(item).some((angle) => angle.id === angleChoice));
      if (compatible.length === 0) return error("ANGLE_PILLAR_INCOMPATIBLE", `Angle "${String(angleChoice)}" is not available under any enabled pillar for ${input.channel}.`);
      pillar = compatible[modulo(input.slotIndex, compatible.length)];
    }
  } else {
    pillar = pillars.find((item) => item.id === input.selection.pillar);
    if (!pillar) return error("STRATEGY_OPTION_UNAVAILABLE", `Pillar "${String(input.selection.pillar)}" is not enabled for ${input.channel}.`);
  }

  const angles = availableAngles(pillar!);
  const angle = choose(angles, angleChoice, input.slotIndex);
  if (!angle) {
    const code = angleChoice === "mix" ? "STRATEGY_OPTION_UNAVAILABLE" : "ANGLE_PILLAR_INCOMPATIBLE";
    return error(code, `Angle "${String(angleChoice)}" is not available under pillar "${pillar!.id}" for ${input.channel}.`);
  }
  const fingerprint = strategyCatalogFingerprint(input.catalog);
  return {
    ok: true,
    strategy: {
      objectiveKey: objective.key,
      objectiveLabel: objective.label,
      pillarId: pillar!.id,
      pillarLabel: pillar!.label,
      angleId: angle.id,
      angleLabel: angle.label,
      angleGuidance: angle.guidance,
      angleIdByChannel: { [input.channel]: angle.id },
      channel: input.channel,
      strategyVersion: input.catalog.version,
      catalogFingerprint: fingerprint,
      ...(angle.recipeId ? { recipeId: angle.recipeId } : {}),
    },
  };
}

function validRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function resolveFormatSequence(input: { mode: AutomationFormatMode; mix?: AutomationFormatMix; slotCount: number }): ("image" | "video")[] {
  if (!Number.isInteger(input.slotCount) || input.slotCount < 0) throw new Error("FORMAT_SLOT_COUNT_INVALID");
  if (input.mode === "image" || input.mode === "video") return Array.from({ length: input.slotCount }, () => input.mode as "image" | "video");
  if (input.mode !== "mix") throw new Error("FORMAT_MODE_INVALID");
  if (!validRatio(input.mix?.image) || !validRatio(input.mix?.video)) throw new Error("FORMAT_MIX_RATIO_INVALID");
  const total = input.mix.image + input.mix.video;
  const imageCount = Math.round(input.slotCount * input.mix.image / total);
  return Array.from({ length: input.slotCount }, (_, index) => Math.round((index + 1) * imageCount / input.slotCount) > Math.round(index * imageCount / input.slotCount) ? "image" : "video");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

function stableFingerprint(value: unknown): string {
  const bytes = new TextEncoder().encode(stableSerialize(value));
  const seeds = [0xcbf29ce484222325n, 0x84222325cbf29ce4n, 0x9e3779b185ebca87n, 0x6a09e667f3bcc909n];
  return seeds.map((seed) => {
    let hash = seed;
    for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
    return hash.toString(16).padStart(16, "0");
  }).join("");
}

export function captureAutomationStrategySnapshot(input: AutomationStrategySnapshotInput): AutomationStrategySnapshot {
  const selected = input.plan.strategySelection ?? input.plan.strategySnapshot?.selection ?? input.plan.planStrategySnapshot?.selection;
  if (!selected) throw new Error("STRATEGY_SELECTION_REQUIRED");
  const selection = { objective: selected.objective, pillar: selected.pillar, angle: selected.angle };
  let slots: readonly ResolvedAutomationSlot[];
  if (input.preview) {
    if (!input.preview.ok) throw new Error("STRATEGY_SNAPSHOT_PREVIEW_INVALID");
    if (!input.plan.scheduleTemplate && !VERIFIED_PREVIEWS.has(input.preview)) throw new Error("STRATEGY_SNAPSHOT_PREVIEW_UNVERIFIED");
    slots = input.preview.slots;
    if (input.plan.scheduleTemplate) {
      const rerun = buildResolvedAutomationSlots({ plan: input.plan, catalog: input.catalog, scheduleTemplate: input.plan.scheduleTemplate });
      if (!rerun.ok) throw new Error(`STRATEGY_SNAPSHOT_PREVIEW_INVALID:${rerun.errors.join("|")}`);
      if (stableSerialize(rerun.slots) !== stableSerialize(slots)) throw new Error("STRATEGY_SNAPSHOT_PREVIEW_MISMATCH");
      slots = rerun.slots;
    }
  } else if (input.plan.scheduleTemplate) {
    const rerun = buildResolvedAutomationSlots({ plan: input.plan, catalog: input.catalog, scheduleTemplate: input.plan.scheduleTemplate });
    if (!rerun.ok) throw new Error(`STRATEGY_SNAPSHOT_PREVIEW_INVALID:${rerun.errors.join("|")}`);
    slots = rerun.slots;
  } else {
    throw new Error("STRATEGY_SNAPSHOT_PREVIEW_REQUIRED");
  }
  if (input.slots && stableSerialize(input.slots) !== stableSerialize(slots)) throw new Error("STRATEGY_SNAPSHOT_PREVIEW_MISMATCH");
  if (slots.length === 0) throw new Error("STRATEGY_SNAPSHOT_SLOTS_REQUIRED");
  if (!validateStrategyCatalog(input.catalog).ok) throw new Error("STRATEGY_CATALOG_INVALID");
  const targetChannels = [...new Set(input.plan.targetChannels ?? slots.flatMap((slot) => [slot.platform, ...Object.keys(slot.angleIdByChannel)] as SocialPlatform[]))];
  if (!slots.every((slot) => isResolvedAutomationSlot(slot, targetChannels))) throw new Error("STRATEGY_SNAPSHOT_SLOT_INVALID");
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("STRATEGY_SNAPSHOT_DATE_INVALID");
  const resolvedSlots = slots.map((slot) => {
    const primaryAngle = slot.angleIdByChannel[slot.platform];
    const primary = resolveStrategyForSlot({ catalog: input.catalog, channel: slot.platform, selection: { objective: slot.objectiveKey, pillar: slot.pillarId, angle: primaryAngle ?? "mix" }, slotIndex: 0 });
    if (!primary.ok) throw new Error(`STRATEGY_SNAPSHOT_INVALID:${primary.code}`);
    const angleLabelByChannel: Partial<Record<SocialPlatform, string>> = {};
    const angleGuidanceByChannel: Partial<Record<SocialPlatform, string>> = {};
    for (const [rawChannel, angleId] of Object.entries(slot.angleIdByChannel)) {
      if (!PLATFORMS.includes(rawChannel as SocialPlatform) || typeof angleId !== "string") continue;
      const channel = rawChannel as SocialPlatform;
      const resolved = channel === slot.platform
        ? primary
        : resolveStrategyForSlot({ catalog: input.catalog, channel, selection: { objective: slot.objectiveKey, pillar: slot.pillarId, angle: angleId }, slotIndex: 0 });
      if (!resolved.ok) throw new Error(`STRATEGY_SNAPSHOT_INVALID:${resolved.code}`);
      angleLabelByChannel[channel] = resolved.strategy.angleLabel;
      angleGuidanceByChannel[channel] = resolved.strategy.angleGuidance;
    }
    const recipeId = primary.strategy.recipeId ?? null;
    const recipe = recipeId === null
      ? undefined
      : input.recipes?.find((candidate) => candidate.id === recipeId && candidate.brandId === input.plan.brandId);
    if (recipeId !== null && !recipe) throw new Error(`STRATEGY_SNAPSHOT_RECIPE_UNAVAILABLE:${recipeId}`);
    if (recipe) {
      const recipeValidation = validateContentRecipe(recipe, input.plan.brandId, slot.platform, slot.contentKind);
      const strategyValidation = validateContentRecipeForStrategy(recipe, { pillarId: primary.strategy.pillarId, angleId: primary.strategy.angleId });
      if (!recipeValidation.ok || !strategyValidation.ok) throw new Error(`STRATEGY_SNAPSHOT_RECIPE_INVALID:${recipeId}`);
    }
    const recipeHasGuidance = recipe && [recipe.hookGuidance, recipe.structureGuidance, recipe.ctaGuidance, ...recipe.qualityChecklist].some((value) => typeof value === "string" && value.trim());
    return {
      id: slot.id,
      scheduledAt: slot.scheduledAt,
      platform: slot.platform,
      objectiveKey: slot.objectiveKey,
      pillarId: slot.pillarId,
      angleIdByChannel: { ...slot.angleIdByChannel },
      strategyVersion: slot.strategyVersion,
      catalogFingerprint: slot.catalogFingerprint,
      objectiveLabel: primary.strategy.objectiveLabel,
      pillarLabel: primary.strategy.pillarLabel,
      angleId: primary.strategy.angleId,
      angleLabel: primary.strategy.angleLabel,
      angleGuidance: primary.strategy.angleGuidance,
      angleLabelByChannel,
      angleGuidanceByChannel,
      recipeId,
      recipeGuidance: recipeHasGuidance ? serializeContentRecipe(recipe!) : "",
      catalogVersion: input.catalog.version,
      capturedAt,
    };
  });
  return {
    catalogVersion: input.catalog.version,
    catalogFingerprint: strategyCatalogFingerprint(input.catalog),
    selection,
    targetChannels,
    resolvedSlots,
    capturedAt,
    ...(input.plan.revision !== undefined ? { revision: input.plan.revision } : {}),
    resolvedFingerprint: stableFingerprint(resolvedSlots),
  };
}

export const buildAutomationStrategySnapshot = captureAutomationStrategySnapshot;

export function automationPlanCatalogReviewState(plan: AutomationPlan, catalog: BrandStrategyCatalog): AutomationPlanCatalogReview {
  const snapshot = plan.strategySnapshot ?? plan.planStrategySnapshot;
  if (!snapshot) return { ok: true, matrixUpdated: false, reviewRequired: false };
  if (typeof snapshot !== "object") return { ok: false, matrixUpdated: true, reviewRequired: true, code: "STRATEGY_CATALOG_UPDATED", message: "The plan strategy snapshot is malformed; review the plan before resolving slots." };
  const currentFingerprint = strategyCatalogFingerprint(catalog);
  const matrixUpdated = snapshot.catalogVersion !== catalog.version || snapshot.catalogFingerprint !== currentFingerprint;
  return matrixUpdated
    ? { ok: false, matrixUpdated: true, reviewRequired: true, code: "STRATEGY_CATALOG_UPDATED", message: "The brand strategy catalog changed after this plan snapshot; review the plan before resolving slots." }
    : { ok: true, matrixUpdated: false, reviewRequired: false };
}

export const reviewAutomationPlanStrategy = automationPlanCatalogReviewState;

export function cloneCampaignScheduleTemplate(template: CampaignScheduleTemplate, campaignId: string, now = new Date()): CampaignScheduleTemplate {
  if (!campaignId.trim()) throw new Error("SCHEDULE_CAMPAIGN_ID_INVALID");
  if (!Number.isFinite(now.getTime())) throw new Error("SCHEDULE_CLONE_DATE_INVALID");
  return {
    ...structuredClone(template),
    id: `schedule-template-${campaignId}`,
    campaignId,
    source: "campaign_clone",
    timesByWeekday: Object.fromEntries(Object.entries(template.timesByWeekday ?? {}).map(([day, times]) => [day, [...times]])),
  };
}

function dateParts(value: string): { year: number; month: number; day: number } | undefined {
  const match = ISO_DATE.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 9999) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { year, month, day } : undefined;
}

function timezoneFormatter(timezone: string): Intl.DateTimeFormat | undefined {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" });
  } catch {
    return undefined;
  }
}

function timezoneOffsetMinutes(date: Date, formatter: Intl.DateTimeFormat): number | undefined {
  const value = formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  if (value === "GMT") return 0;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(value);
  if (!match) return undefined;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "+" ? minutes : -minutes;
}

export type LocalDateTimeResolution = { ok: true; value: Date } | { ok: false; code: "INVALID_TIMEZONE" | "INVALID_TIME" | "NONEXISTENT_TIME" | "AMBIGUOUS_TIME"; message: string };

export function resolveLocalDateTime(date: string, time: string, timezone: string): LocalDateTimeResolution {
  const parts = dateParts(date);
  const timeParts = TIME.exec(time);
  if (!parts || !timeParts) return { ok: false, code: "INVALID_TIME", message: `Local date/time ${date} ${time} must use valid YYYY-MM-DD and HH:mm values.` };
  const formatter = timezoneFormatter(timezone);
  if (!formatter) return { ok: false, code: "INVALID_TIMEZONE", message: `Timezone "${timezone}" is not a valid IANA timezone.` };
  const hour = Number(timeParts[1]);
  const minute = Number(timeParts[2]);
  const localAsUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute));
  const offsets = new Set<number>();
  for (let dayOffset = -3; dayOffset <= 3; dayOffset += 1) {
    const offset = timezoneOffsetMinutes(new Date(localAsUtc.getTime() + dayOffset * 86_400_000), formatter);
    if (offset !== undefined) offsets.add(offset);
  }
  const candidates = [...offsets].map((offset) => new Date(localAsUtc.getTime() - offset * 60_000)).filter((candidate, index, all) => {
    if (all.findIndex((other) => other.getTime() === candidate.getTime()) !== index) return false;
    const rendered = Object.fromEntries(formatter.formatToParts(candidate).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${rendered.year}-${rendered.month}-${rendered.day}` === date && `${rendered.hour}:${rendered.minute}` === time;
  });
  if (candidates.length === 1) return { ok: true, value: candidates[0]! };
  if (candidates.length > 1) return { ok: false, code: "AMBIGUOUS_TIME", message: `Ambiguous local time ${date} ${time} occurs more than once in ${timezone}.` };
  return { ok: false, code: "NONEXISTENT_TIME", message: `Local time ${date} ${time} does not exist in ${timezone}.` };
}

function dateRangeValues(range: AutomationDateRange | undefined): { startDate: string; endDate: string } | undefined {
  if (!range) return undefined;
  const startDate = range.startDate ?? range.start;
  const endDate = range.endDate ?? range.end;
  return typeof startDate === "string" && typeof endDate === "string" ? { startDate, endDate } : undefined;
}

function dateRangeForPlan(plan: AutomationPlan): { startDate: string; endDate: string } | undefined {
  const explicit = dateRangeValues(plan.dateRange);
  return explicit;
}

function weekdayForDate(date: string): number {
  const parts = dateParts(date)!;
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

function datesInRange(range: AutomationDateRange): string[] {
  const values = dateRangeValues(range);
  if (!values) return [];
  const start = dateParts(values.startDate);
  const end = dateParts(values.endDate);
  if (!start || !end) return [];
  const first = Date.UTC(start.year, start.month - 1, start.day);
  const last = Date.UTC(end.year, end.month - 1, end.day);
  if (last < first) return [];
  const days: string[] = [];
  for (let instant = first; instant <= last; instant += 86_400_000) days.push(new Date(instant).toISOString().slice(0, 10));
  return days;
}

function contentKindFor(platform: SocialPlatform, mediaKind: "image" | "video"): ContentKind {
  if (mediaKind === "image") return "image";
  return platform === "facebook" ? "video" : "short_video";
}

function normalizedChannels(plan: AutomationPlan, enabledPlatforms: SocialPlatform[]): SocialPlatform[] {
  const source = plan.targetChannels ?? enabledPlatforms;
  return [...new Set(source.filter((channel): channel is SocialPlatform => PLATFORMS.includes(channel as SocialPlatform)))];
}

function formatSequenceForPlan(plan: AutomationPlan, item: AutomationPlatformPlan, count: number): ("image" | "video")[] {
  const mode = item.formatMode ?? plan.formatMode;
  if (mode) return resolveFormatSequence({ mode, mix: item.formatMix ?? plan.formatMix, slotCount: count });
  const imageCount = Math.max(0, Math.min(count, Number.isInteger(item.imageCount) ? item.imageCount : 0));
  return Array.from({ length: count }, (_, index) => index < imageCount ? "image" : "video");
}

function validRunDays(runDays: number[] | undefined): boolean {
  return runDays === undefined || (runDays.length > 0 && runDays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7));
}

function appendError(errors: string[], message: string): void {
  if (!errors.includes(message)) errors.push(message);
}

type PreviewScope = { platform: SocialPlatform; item: AutomationPlatformPlan; pageId?: string; bindingId?: string; source: "campaign_template" | "scope" };

function bindingIdForPage(plan: AutomationPlan, pageId: string): string | undefined {
  const index = plan.targetPageIds?.indexOf(pageId) ?? -1;
  const indexed = index >= 0 ? plan.bindingIds?.[index] : undefined;
  if (indexed) return indexed;
  return plan.bindingIds?.find((bindingId) => bindingId.includes(`-facebook-${pageId}`));
}

function pageIdsForPlan(plan: AutomationPlan): string[] {
  if (Array.isArray(plan.targetPageIds)) return plan.targetPageIds.filter((pageId) => typeof pageId === "string" && pageId.trim()).map((pageId) => pageId.trim());
  return (Array.isArray(plan.bindingIds) ? plan.bindingIds : []).flatMap((bindingId) => {
    const marker = "-facebook-";
    const index = bindingId.indexOf(marker);
    return index >= 0 && bindingId.slice(index + marker.length) ? [bindingId.slice(index + marker.length)] : [];
  });
}

function platformSignature(item: AutomationPlatformPlan | undefined): string {
  if (!item) return "missing";
  return JSON.stringify({
    enabled: item.enabled,
    postsPerDay: item.postsPerDay,
    imageCount: item.imageCount,
    videoCount: item.videoCount,
    publishTimes: item.publishTimes,
    runDays: item.runDays ? [...item.runDays].sort((left, right) => left - right) : undefined,
    formatMode: item.formatMode,
    formatMix: item.formatMix ? { image: item.formatMix.image, video: item.formatMix.video } : undefined,
    strategySelection: item.strategySelection ? { objective: item.strategySelection.objective, pillar: item.strategySelection.pillar, angle: item.strategySelection.angle } : undefined,
  });
}

function explicitNonFacebookOverride(pagePlan: AutomationPlatformPlan | undefined, globalPlan: AutomationPlatformPlan | undefined): boolean {
  if (!pagePlan || platformSignature(pagePlan) === platformSignature(globalPlan)) return false;
  return pagePlan.enabled || pagePlan.postsPerDay > 0 || pagePlan.imageCount > 0 || pagePlan.videoCount > 0 || pagePlan.publishTimes.length > 0 || pagePlan.formatMode !== undefined || pagePlan.formatMix !== undefined || pagePlan.strategySelection !== undefined;
}

function previewScopes(plan: AutomationPlan): PreviewScope[] {
  const pages = pageIdsForPlan(plan);
  if (pages.length === 0 && plan.targetPageIds === undefined && !(plan.bindingIds?.length)) return PLATFORMS.map((platform) => ({ platform, item: plan.platforms?.[platform] ?? { enabled: false, postsPerDay: 0, imageCount: 0, videoCount: 0, publishTimes: [] }, source: "campaign_template" }));
  const facebook = pages.map((pageId) => {
    const bindingId = bindingIdForPage(plan, pageId);
    const binding = bindingId ? plan.bindingSchedules?.[bindingId] : undefined;
    if (binding?.mode === "independent") return { platform: "facebook" as const, pageId, bindingId, source: "scope" as const, item: { enabled: true, postsPerDay: binding.postsPerDay, imageCount: binding.imageCount, videoCount: binding.videoCount, publishTimes: binding.publishTimes, runDays: binding.runDays, formatMode: binding.formatMode, formatMix: binding.formatMix } };
    return { platform: "facebook" as const, pageId, bindingId, source: "scope" as const, item: plan.pagePlans?.[pageId]?.facebook ?? { enabled: false, postsPerDay: 0, imageCount: 0, videoCount: 0, publishTimes: [] } };
  });
  const nonFacebook: PreviewScope[] = [];
  for (const platform of PLATFORMS.filter((candidate) => candidate !== "facebook")) {
    const explicit = pages.filter((pageId) => {
      const pagePlan = plan.pagePlans?.[pageId]?.[platform];
      return explicitNonFacebookOverride(pagePlan, plan.platforms?.[platform]);
    });
    if (explicit.length > 0) {
      explicit.forEach((pageId) => {
        const item = plan.pagePlans?.[pageId]?.[platform] ?? plan.platforms?.[platform];
        if (item) nonFacebook.push({ platform, pageId, bindingId: bindingIdForPage(plan, pageId), source: "scope", item });
      });
    } else {
      const item = plan.platforms?.[platform];
      if (item) nonFacebook.push({ platform, source: "campaign_template", item });
    }
  }
  return [...facebook, ...nonFacebook];
}

function scopeKey(scope: Pick<PreviewScope, "pageId" | "platform">): string {
  return `${scope.pageId ?? ""}:${scope.platform}`;
}

export function buildResolvedAutomationSlots(input: {
  plan: AutomationPlan;
  catalog: BrandStrategyCatalog;
  scheduleTemplate: CampaignScheduleTemplate;
}): { ok: true; slots: ResolvedAutomationSlot[] } | { ok: false; errors: string[] } {
  const { plan, catalog, scheduleTemplate } = input;
  const errors: string[] = [];
  const templateId = typeof scheduleTemplate?.id === "string" ? scheduleTemplate.id : "";
  const templateCampaignId = typeof scheduleTemplate?.campaignId === "string" ? scheduleTemplate.campaignId : "";
  const templateBrandId = typeof scheduleTemplate?.brandId === "string" ? scheduleTemplate.brandId : "";
  const templateTimezone = typeof scheduleTemplate?.timezone === "string" ? scheduleTemplate.timezone : "";
  const templateTimesByWeekday = scheduleTemplate?.timesByWeekday && typeof scheduleTemplate.timesByWeekday === "object" && !Array.isArray(scheduleTemplate.timesByWeekday) ? scheduleTemplate.timesByWeekday : {};
  const planBrandId = typeof plan.brandId === "string" ? plan.brandId : "";
  const planCampaignId = typeof plan.campaignId === "string" ? plan.campaignId : "";
  const campaignId = planCampaignId.trim();
  if (!campaignId) appendError(errors, "CAMPAIGN_ID_REQUIRED: Campaign ID is required for schedule preview.");
  if (catalog.brandId !== planBrandId) appendError(errors, "STRATEGY_BRAND_MISMATCH: Strategy catalog and plan must belong to the same brand.");
  const catalogValidation = validateStrategyCatalog(catalog);
  if (!catalogValidation.ok) catalogValidation.errors.forEach((catalogError) => appendError(errors, `STRATEGY_CATALOG_INVALID: ${catalogError}`));
  const catalogReview = automationPlanCatalogReviewState(plan, catalog);
  if (!catalogReview.ok) appendError(errors, `${catalogReview.code}: ${catalogReview.message}`);
  if (!templateBrandId.trim() || templateBrandId !== planBrandId) appendError(errors, "SCHEDULE_BRAND_MISMATCH: Schedule template and plan must belong to the same brand.");
  if (!templateCampaignId.trim() || (planCampaignId.trim() && templateCampaignId !== planCampaignId)) appendError(errors, "SCHEDULE_CAMPAIGN_MISMATCH: Schedule template and plan must belong to the same campaign.");
  if (!templateId.trim() || !Number.isInteger(scheduleTemplate?.version) || scheduleTemplate.version < 1 || !["brand_default", "campaign_clone", "campaign_override"].includes(scheduleTemplate?.source as string)) appendError(errors, "INVALID_SCHEDULE: Schedule template identity, version, or source is invalid.");
  const formatter = timezoneFormatter(templateTimezone);
  if (!formatter) appendError(errors, `INVALID_TIMEZONE: Schedule timezone "${templateTimezone}" is not a valid IANA timezone.`);
  Object.entries(templateTimesByWeekday).forEach(([weekday, times]) => {
    if (!/^[1-7]$/.test(weekday) || !Array.isArray(times)) {
      appendError(errors, "INVALID_SCHEDULE: Schedule template weekdays must use ISO weekday numbers 1-7.");
      return;
    }
    if (times.some((time) => typeof time !== "string" || !TIME.test(time))) appendError(errors, `INVALID_SCHEDULE: Schedule times for weekday ${weekday} must use HH:mm.`);
    if (times.some((time, index) => index > 0 && time <= times[index - 1])) appendError(errors, `INVALID_SCHEDULE: Schedule times for weekday ${weekday} must be ordered.`);
  });

  const range = dateRangeForPlan(plan);
  if (!range || !dateParts(range.startDate) || !dateParts(range.endDate)) appendError(errors, "INVALID_DATE_RANGE: Plan dateRange must contain valid YYYY-MM-DD start and end dates.");
  else if (range.startDate > range.endDate) appendError(errors, "INVALID_DATE_RANGE: Plan dateRange end must be on or after start.");
  const days = range && dateParts(range.startDate) && dateParts(range.endDate) && range.startDate <= range.endDate ? datesInRange(range) : [];

  const rawPlatforms = plan.platforms && typeof plan.platforms === "object" ? Object.entries(plan.platforms) : [];
  const enabledPlatforms = rawPlatforms.filter(([, item]) => item?.enabled).map(([platform]) => platform).filter((platform): platform is SocialPlatform => PLATFORMS.includes(platform as SocialPlatform));
  const unknownPlatforms = rawPlatforms.map(([platform]) => platform).filter((platform) => !PLATFORMS.includes(platform as SocialPlatform));
  unknownPlatforms.forEach((platform) => appendError(errors, `CAPABILITY_PLATFORM_UNSUPPORTED: Platform "${platform}" is not supported.`));
  if (plan.targetChannels) plan.targetChannels.filter((channel) => !PLATFORMS.includes(channel)).forEach((channel) => appendError(errors, `CAPABILITY_PLATFORM_UNSUPPORTED: Platform "${String(channel)}" is not supported.`));
  const scopes = previewScopes(plan);
  scopes.filter((scope) => scope.item.invalidReason).forEach((scope) => appendError(errors, `INVALID_PLAN: ${scope.pageId ? `Page ${scope.pageId} ` : ""}${scope.platform} entry is invalid (${scope.item.invalidReason}).`));
  const enabledScopes = scopes.filter((scope) => scope.item.enabled);
  if (enabledScopes.length === 0) appendError(errors, "NO_ENABLED_PLATFORMS: Enable at least one platform before preview.");
  const targetChannels = normalizedChannels(plan, [...enabledPlatforms, ...enabledScopes.map((scope) => scope.platform)]);
  if (targetChannels.length === 0) appendError(errors, "STRATEGY_CHANNELS_REQUIRED: At least one target channel is required.");
  const sharedPlanSelection = plan.strategySelection ?? plan.strategySnapshot?.selection ?? plan.planStrategySnapshot?.selection;
  const formatsByScope = new Map<string, ("image" | "video")[]>();
  for (const scope of enabledScopes) {
    if (!validRunDays(scope.item.runDays)) appendError(errors, `INVALID_SCHEDULE: ${scope.pageId ? `Page ${scope.pageId} ` : ""}${scope.platform} runDays must contain ISO weekdays 1-7.`);
    if (!Number.isInteger(scope.item.postsPerDay) || scope.item.postsPerDay < 1) {
      appendError(errors, `INVALID_SCHEDULE: ${scope.pageId ? `Page ${scope.pageId} ` : ""}${scope.platform} postsPerDay must be a positive integer when enabled.`);
      continue;
    }
    let formats: ("image" | "video")[];
    try { formats = formatSequenceForPlan(plan, scope.item, scope.item.postsPerDay); }
    catch (formatError) { appendError(errors, `${scope.pageId ? `Page ${scope.pageId} ` : ""}${scope.platform} format ratio is invalid: ${formatError instanceof Error ? formatError.message : "Format mix is invalid."}`); continue; }
    formatsByScope.set(scopeKey(scope), formats);
    if (scope.platform === "youtube" && formats.includes("image")) appendError(errors, "youtube supports video posts only; set images to 0.");
    const selection = scope.item.strategySelection ?? sharedPlanSelection;
    if (!selection) appendError(errors, `STRATEGY_SELECTION_REQUIRED: ${scope.pageId ? `Page ${scope.pageId} ` : ""}${scope.platform} needs strategySelection before preview.`);
    else {
      const channels = [...new Set([scope.platform, ...targetChannels])];
      channels.forEach((channel) => {
        const resolution = resolveStrategyForSlot({ catalog, channel, selection, slotIndex: 0 });
        if (!resolution.ok) appendError(errors, `STRATEGY_${resolution.code}: ${channel}: ${resolution.message}`);
      });
    }
  }

  type PreviewCandidate = { scope: PreviewScope; date: string; time: string; postIndex: number; mediaKind: "image" | "video"; scheduledAt: Date };
  const candidates: PreviewCandidate[] = [];
  for (const date of days) {
    const weekday = weekdayForDate(date);
    for (const scope of enabledScopes) {
      if (!(scope.item.runDays ?? [1, 2, 3, 4, 5, 6, 7]).includes(weekday)) continue;
      const templateTimes = templateTimesByWeekday[weekday];
      const times = scope.source === "scope" ? scope.item.publishTimes : templateTimes;
      if (!Array.isArray(times)) {
        appendError(errors, `INVALID_SCHEDULE: ${scope.source === "scope" && scope.pageId ? `Page ${scope.pageId} ` : ""}${scope.platform} has no times for weekday ${weekday}.`);
        continue;
      }
      if (times.some((time) => typeof time !== "string" || !TIME.test(time))) appendError(errors, `INVALID_SCHEDULE: ${scope.source === "scope" && scope.pageId ? `Page ${scope.pageId} ` : ""}${scope.platform} schedule times must use HH:mm.`);
      if (times.some((time, index) => index > 0 && time <= times[index - 1])) appendError(errors, `INVALID_SCHEDULE: ${scope.source === "scope" && scope.pageId ? `Page ${scope.pageId} ` : ""}${scope.platform} schedule times must be ordered.`);
      if (times.length < scope.item.postsPerDay) {
        appendError(errors, `INVALID_SCHEDULE: ${scope.source === "scope" && scope.pageId ? `Page ${scope.pageId} ` : "Schedule template"} needs ${scope.item.postsPerDay} times for ${scope.platform} on ${date}.`);
        continue;
      }
      const formats = formatsByScope.get(scopeKey(scope));
      if (!formats) continue;
      for (let postIndex = 0; postIndex < scope.item.postsPerDay; postIndex += 1) {
        const time = times[postIndex]!;
        const localResolution = resolveLocalDateTime(date, time, templateTimezone);
        const scheduledAt = formatter && TIME.test(time) && localResolution.ok ? localResolution.value : undefined;
        if (!scheduledAt) {
          appendError(errors, `INVALID_SCHEDULE: ${localResolution.ok ? `Local time ${date} ${time} is invalid.` : localResolution.message}`);
          continue;
        }
        const mediaKind = formats[postIndex]!;
        const capability = platformCapabilities[scope.platform];
        const contentKind = contentKindFor(scope.platform, mediaKind);
        if (!capability || !capability.supportedKinds.includes(contentKind)) appendError(errors, scope.platform === "youtube" && mediaKind === "image" ? "youtube supports video posts only; set images to 0." : `CAPABILITY_${scope.platform.toUpperCase()}_${mediaKind.toUpperCase()}_UNSUPPORTED: ${scope.platform} does not support ${mediaKind} preview slots.`);
        candidates.push({ scope, date, time, postIndex, mediaKind, scheduledAt });
      }
    }
  }

  candidates.sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime() || PLATFORMS.indexOf(left.scope.platform) - PLATFORMS.indexOf(right.scope.platform) || (left.scope.pageId ?? "").localeCompare(right.scope.pageId ?? "") || left.postIndex - right.postIndex);
  const groups = [...candidates.reduce((map, candidate) => {
    const key = `${candidate.date}:${candidate.time}:${candidate.scope.pageId ?? ""}`;
    map.set(key, [...(map.get(key) ?? []), candidate]);
    return map;
  }, new Map<string, PreviewCandidate[]>()).values()];
  const slots: ResolvedAutomationSlot[] = [];
  groups.forEach((group, groupIndex) => {
    const first = group[0]!;
    const sharedSelection = first.scope.item.strategySelection ?? sharedPlanSelection;
    if (!sharedSelection) { appendError(errors, `STRATEGY_SELECTION_REQUIRED: ${first.scope.platform} needs strategySelection before preview.`); return; }
    const sharedResolution = resolveStrategyForSlot({ catalog, channel: first.scope.platform, selection: sharedSelection, slotIndex: groupIndex });
    if (!sharedResolution.ok) { appendError(errors, `STRATEGY_${sharedResolution.code}: ${first.scope.platform} ${first.date} ${first.time}: ${sharedResolution.message}`); return; }
    const shared = sharedResolution.strategy;
    const groupChannels = [...new Set([...targetChannels, ...group.map((candidate) => candidate.scope.platform)])];
    const selectionByChannel = new Map<SocialPlatform, AutomationStrategySelection>(group.map((candidate) => [candidate.scope.platform, candidate.scope.item.strategySelection ?? sharedPlanSelection ?? sharedSelection]));
    const angleIdByChannel: Partial<Record<SocialPlatform, string>> = {};
    let channelFailed = false;
    for (const channel of groupChannels) {
      const channelSelection: AutomationStrategySelection = { objective: shared.objectiveKey, pillar: shared.pillarId, angle: selectionByChannel.get(channel)?.angle ?? sharedSelection.angle };
      const channelResolved = channel === first.scope.platform
        ? sharedResolution
        : resolveStrategyForSlot({ catalog, channel, selection: channelSelection, slotIndex: groupIndex });
      if (!channelResolved.ok) {
        channelFailed = true;
        appendError(errors, `STRATEGY_${channelResolved.code}: ${channel} ${first.date} ${first.time}: ${channelResolved.message}`);
      } else angleIdByChannel[channel] = channelResolved.strategy.angleId;
    }
    if (channelFailed) return;
    group.forEach((candidate) => {
      const scopePrefix = candidate.scope.pageId ? `${candidate.scope.pageId}:` : "";
      slots.push({
        id: `${campaignId}:${candidate.date}:${scopePrefix}${candidate.time}:${candidate.scope.platform}:${candidate.postIndex}`,
        campaignId,
        scheduledAt: candidate.scheduledAt.toISOString(),
        platform: candidate.scope.platform,
        ...(candidate.scope.pageId ? { targetPageId: candidate.scope.pageId, bindingId: candidate.scope.bindingId } : {}),
        mediaKind: candidate.mediaKind,
        contentKind: contentKindFor(candidate.scope.platform, candidate.mediaKind),
        objectiveKey: shared.objectiveKey,
        pillarId: shared.pillarId,
        angleIdByChannel: { ...angleIdByChannel },
        strategyVersion: shared.strategyVersion,
        catalogFingerprint: shared.catalogFingerprint,
      });
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  const preview = { ok: true as const, slots };
  VERIFIED_PREVIEWS.add(preview);
  return preview;
}
