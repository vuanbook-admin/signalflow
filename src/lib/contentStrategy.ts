import type { SocialPlatform } from "./mvpContracts";

export const STRATEGY_OBJECTIVE_KEYS: readonly ["reach", "engagement", "education", "knowledge", "conversion"] = ["reach", "engagement", "education", "knowledge", "conversion"];
export type StrategyObjectiveKey = typeof STRATEGY_OBJECTIVE_KEYS[number];
export type StrategyChoice<T extends string> = T | "mix";

export type StrategyObjectiveDefinition = {
  key: StrategyObjectiveKey;
  label: string;
  description: string;
  enabled: boolean;
  order: number;
};

export type ContentAngleDefinition = {
  id: string;
  label: string;
  guidance: string;
  enabled: boolean;
  order: number;
  channels: SocialPlatform[];
  recipeId?: string;
};

export type ContentPillarDefinition = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  order: number;
  channels: SocialPlatform[];
  angles: ContentAngleDefinition[];
};

export type ChannelStrategyOverride = {
  disabledObjectiveKeys?: StrategyObjectiveKey[];
  disabledPillarIds?: string[];
  disabledAngleIds?: string[];
  addedPillars?: ContentPillarDefinition[];
  addedAnglesByPillarId?: Record<string, ContentAngleDefinition[]>;
  guidanceByAngleId?: Record<string, string>;
};

export type BrandStrategyCatalog = {
  brandId: string;
  version: number;
  objectives: StrategyObjectiveDefinition[];
  pillars: ContentPillarDefinition[];
  channelOverrides: Partial<Record<SocialPlatform, ChannelStrategyOverride>>;
  updatedAt: string;
};

export type StrategySnapshot = {
  objectiveKey: StrategyObjectiveKey;
  objectiveLabel: string;
  pillarId: string;
  pillarLabel: string;
  angleId: string;
  angleLabel: string;
  angleGuidance: string;
  angleIdByChannel?: Partial<Record<SocialPlatform, string>>;
  channel: SocialPlatform;
  format: "text" | "image" | "video";
  strategyVersion: number;
  catalogFingerprint: string;
  recipeId?: string;
  recipeGuidance?: string;
};

const PLATFORMS: readonly SocialPlatform[] = ["facebook", "instagram", "tiktok", "youtube"];
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_LABEL_LENGTH = 160;
const MAX_GUIDANCE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_UPDATED_AT_LENGTH = 80;
const SECRET_LIKE_VALUE = /(?:^|[^a-z])(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|token|password|cookie)(?:$|[^a-z])/i;

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function angle(pillarId: string, id: string, label: string, guidance: string, order: number): ContentAngleDefinition {
  return { id: `${pillarId}-${id}`, label, guidance, enabled: true, order, channels: [...PLATFORMS] };
}

function pillar(id: string, label: string, description: string, order: number, angles: ContentAngleDefinition[]): ContentPillarDefinition {
  return { id, label, description, enabled: true, order, channels: [...PLATFORMS], angles };
}

function objectives(descriptions: readonly string[]): StrategyObjectiveDefinition[] {
  const labels = ["Reach", "Engagement", "Education", "Knowledge", "Conversion"] as const;
  return STRATEGY_OBJECTIVE_KEYS.map((key, index) => ({ key, label: labels[index], description: descriptions[index], enabled: true, order: index + 1 }));
}

export function starterStrategyCatalog(brandId: string, now?: Date): BrandStrategyCatalog {
  return {
    brandId,
    version: 1,
    updatedAt: nowIso(now),
    objectives: objectives([
      "Help the right audience discover the brand.",
      "Invite useful conversations around the brand's point of view.",
      "Explain practical ideas clearly and honestly.",
      "Build confidence through specific, useful details.",
      "Guide an interested audience to an appropriate next step.",
    ]),
    pillars: [
      pillar("audience-insight", "Audience insight", "Connect the brand to real questions and decisions.", 1, [
        angle("audience-insight", "audience-question", "Audience question", "Answer one question the audience is likely to ask.", 1),
        angle("audience-insight", "pain-point", "Pain point", "Name one real friction point and clarify its context.", 2),
        angle("audience-insight", "trend-signal", "Trend signal", "Explain one relevant trend without overstating its meaning.", 3),
      ]),
      pillar("practical-education", "Practical education", "Turn useful knowledge into clear, actionable guidance.", 2, [
        angle("practical-education", "step-by-step-guide", "Step-by-step guide", "Break a useful process into simple steps.", 1),
        angle("practical-education", "common-mistake", "Common mistake", "Correct one common mistake with calm, specific context.", 2),
        angle("practical-education", "checklist", "Checklist", "Turn the guidance into a short, practical checklist.", 3),
      ]),
      pillar("proof-and-process", "Proof and process", "Make quality, evidence, and working methods visible.", 3, [
        angle("proof-and-process", "behind-the-process", "Behind the process", "Show a truthful part of the work behind the result.", 1),
        angle("proof-and-process", "proof-point", "Proof point", "Explain the evidence or detail that supports a useful claim.", 2),
        angle("proof-and-process", "customer-result", "Customer result", "Use a real customer result with relevant context.", 3),
      ]),
      pillar("use-case-and-action", "Use case and action", "Help the audience understand fit and choose a next step.", 4, [
        angle("use-case-and-action", "use-case", "Use case", "Show where the offer or idea is useful in practice.", 1),
        angle("use-case-and-action", "how-to-apply", "How to apply", "Show how to apply the idea in a specific situation.", 2),
        angle("use-case-and-action", "next-step", "Next step", "Offer one clear next step without pressure or unsupported urgency.", 3),
      ]),
      pillar("brand-trust", "Brand trust", "Make the brand's standards and commitments visible.", 5, [
        angle("brand-trust", "brand-values", "Brand values", "Explain one value the brand follows in practice.", 1),
        angle("brand-trust", "quality-standard", "Quality standard", "Explain one standard the brand follows consistently.", 2),
        angle("brand-trust", "customer-proof", "Customer proof", "Use real customer proof with relevant context.", 3),
      ]),
    ],
    channelOverrides: {},
  };
}

export function bellamyBabyStrategyCatalog(now?: Date): BrandStrategyCatalog {
  return {
    brandId: "brand-bellamy-baby",
    version: 1,
    updatedAt: nowIso(now),
    objectives: objectives([
      "Help more parents discover Bellamy Baby.",
      "Invite useful parent conversations.",
      "Teach practical baby clothing care and choices.",
      "Build confidence through specific product knowledge.",
      "Guide ready parents to the right next step.",
    ]),
    pillars: [
      pillar("product-proof", "Product proof", "Show practical product details.", 1, [
        angle("product-proof", "material-detail", "Material detail", "Show texture, finish, and honest material details.", 1),
        angle("product-proof", "fit-and-comfort", "Fit and comfort", "Explain fit and comfort in a child-first way.", 2),
        angle("product-proof", "everyday-use", "Everyday use", "Show how the item works in ordinary family routines.", 3),
      ]),
      pillar("care-and-material", "Care and material", "Make fabric care simple.", 2, [
        angle("care-and-material", "fabric-care", "Fabric care", "Give clear fabric-care guidance.", 1),
        angle("care-and-material", "wash-routine", "Wash routine", "Share a realistic wash routine.", 2),
        angle("care-and-material", "durability", "Durability", "Describe durability without inflated claims.", 3),
      ]),
      pillar("parent-guidance", "Parent guidance", "Help parents choose with confidence.", 3, [
        angle("parent-guidance", "how-to-choose", "How to choose", "Give a clear choice framework.", 1),
        angle("parent-guidance", "common-mistake", "Common mistake", "Correct a common clothing choice mistake kindly.", 2),
        angle("parent-guidance", "routine-tip", "Routine tip", "Offer one useful daily routine tip.", 3),
      ]),
      pillar("style-and-occasion", "Style and occasion", "Make outfits easy to use.", 4, [
        angle("style-and-occasion", "minimalist-korean-style", "Minimalist Korean style", "Show a calm, practical Korean-inspired look.", 1),
        angle("style-and-occasion", "home-to-outing", "Home to outing", "Show an outfit from home routine to a short outing.", 2),
        angle("style-and-occasion", "seasonal-layering", "Seasonal layering", "Explain comfortable seasonal layering.", 3),
      ]),
      pillar("brand-trust", "Brand trust", "Make the brand's standards visible.", 5, [
        angle("brand-trust", "behind-the-design", "Behind the design", "Explain one intentional design choice.", 1),
        angle("brand-trust", "quality-process", "Quality process", "Share a specific quality process detail.", 2),
        angle("brand-trust", "customer-proof", "Customer proof", "Use real customer proof with context.", 3),
      ]),
    ],
    channelOverrides: {},
  };
}

export function cloneStrategyCatalog(source: BrandStrategyCatalog, brandId: string, now?: Date): BrandStrategyCatalog {
  const copy = structuredClone(source);
  return { ...copy, brandId, updatedAt: nowIso(now) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isKebabCase(value: unknown): value is string {
  return typeof value === "string" && KEBAB_CASE.test(value);
}

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength && !SECRET_LIKE_VALUE.test(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_UPDATED_AT_LENGTH && !Number.isNaN(Date.parse(value));
}

function validChannels(value: unknown): value is SocialPlatform[] {
  return Array.isArray(value) && value.length > 0 && value.every((channel) => PLATFORMS.includes(channel as SocialPlatform)) && new Set(value).size === value.length;
}

function validRecipeId(value: unknown): boolean {
  return value === undefined || isKebabCase(value);
}

function validObjective(value: unknown): value is StrategyObjectiveDefinition {
  return isRecord(value)
    && hasOnlyKeys(value, ["key", "label", "description", "enabled", "order"])
    && STRATEGY_OBJECTIVE_KEYS.includes(value.key as StrategyObjectiveKey)
    && validText(value.label, MAX_LABEL_LENGTH)
    && validText(value.description, MAX_DESCRIPTION_LENGTH)
    && typeof value.enabled === "boolean"
    && Number.isInteger(value.order)
    && Number(value.order) > 0;
}

function validAngle(value: unknown): value is ContentAngleDefinition {
  return isRecord(value)
    && hasOnlyKeys(value, ["id", "label", "guidance", "enabled", "order", "channels", "recipeId"])
    && isKebabCase(value.id)
    && validText(value.label, MAX_LABEL_LENGTH)
    && validText(value.guidance, MAX_GUIDANCE_LENGTH)
    && typeof value.enabled === "boolean"
    && Number.isInteger(value.order)
    && Number(value.order) > 0
    && validChannels(value.channels)
    && validRecipeId(value.recipeId);
}

function validPillar(value: unknown): value is ContentPillarDefinition {
  return isRecord(value)
    && hasOnlyKeys(value, ["id", "label", "description", "enabled", "order", "channels", "angles"])
    && isKebabCase(value.id)
    && validText(value.label, MAX_LABEL_LENGTH)
    && validText(value.description, MAX_DESCRIPTION_LENGTH)
    && typeof value.enabled === "boolean"
    && Number.isInteger(value.order)
    && Number(value.order) > 0
    && validChannels(value.channels)
    && Array.isArray(value.angles)
    && value.angles.every(validAngle)
    && value.angles.some((item) => validAngle(item) && item.enabled);
}

function hasContiguousOrders(items: readonly unknown[]): boolean {
  const orders = items.map((item) => isRecord(item) && typeof item.order === "number" ? item.order : NaN);
  return orders.length > 0 && new Set(orders).size === orders.length && orders.every((order, index) => order === index + 1);
}

function addDuplicateError(errors: string[], values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) errors.push(code);
}

function collectStrings(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, seen));
  return Object.values(value).flatMap((item) => collectStrings(item, seen));
}

function validIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isKebabCase) && new Set(value).size === value.length;
}

type StrategyCatalogValidationResult = { ok: true } | { ok: false; errors: string[] };

function validateStrategyCatalogInternal(catalog: BrandStrategyCatalog, allowReducedObjectives = false): StrategyCatalogValidationResult {
  const errors: string[] = [];
  if (!isRecord(catalog) || !hasOnlyKeys(catalog, ["brandId", "version", "objectives", "pillars", "channelOverrides", "updatedAt"]) || !isKebabCase(catalog.brandId) || !Number.isInteger(catalog.version) || catalog.version < 1 || !validDate(catalog.updatedAt)) errors.push("CATALOG_REQUIRED_FIELD_INVALID");
  if (isRecord(catalog) && collectStrings(catalog).some((value) => SECRET_LIKE_VALUE.test(value))) errors.push("SECRET_LIKE_VALUE");

  const objectives = isRecord(catalog) && Array.isArray(catalog.objectives) ? catalog.objectives : undefined;
  if (!objectives || objectives.length === 0) errors.push("OBJECTIVES_REQUIRED");
  else {
    const validObjectiveKeys = objectives.filter(validObjective).map((item) => item.key);
    addDuplicateError(errors, validObjectiveKeys, "OBJECTIVE_KEY_DUPLICATE");
    if (!allowReducedObjectives && (objectives.length !== STRATEGY_OBJECTIVE_KEYS.length || validObjectiveKeys.length !== STRATEGY_OBJECTIVE_KEYS.length || STRATEGY_OBJECTIVE_KEYS.some((key) => !validObjectiveKeys.includes(key)))) errors.push("OBJECTIVE_KEY_SET_INVALID");
    if (objectives.some((item) => !validObjective(item))) errors.push("OBJECTIVE_INVALID");
    if (objectives.every(validObjective) && !hasContiguousOrders(objectives)) errors.push("OBJECTIVE_ORDER_INVALID");
  }

  const pillars = isRecord(catalog) && Array.isArray(catalog.pillars) ? catalog.pillars : undefined;
  if (!pillars || pillars.length === 0) errors.push("PILLARS_REQUIRED");
  else {
    const validPillars = pillars.filter(validPillar);
    addDuplicateError(errors, validPillars.map((item) => item.id), "PILLAR_ID_DUPLICATE");
    if (pillars.some((item) => !validPillar(item))) errors.push("PILLAR_INVALID");
    if (pillars.every(validPillar) && !hasContiguousOrders(pillars)) errors.push("PILLAR_ORDER_INVALID");
    const angleIds: string[] = [];
    for (const item of validPillars) {
      if (!item.angles.some((itemAngle) => itemAngle.enabled)) errors.push("PILLAR_ACTIVE_ANGLE_REQUIRED");
      addDuplicateError(errors, item.angles.map((itemAngle) => itemAngle.id), "ANGLE_ID_DUPLICATE");
      angleIds.push(...item.angles.map((itemAngle) => itemAngle.id));
      if (!hasContiguousOrders(item.angles)) errors.push("ANGLE_ORDER_INVALID");
    }
    addDuplicateError(errors, angleIds, "ANGLE_ID_DUPLICATE");
  }

  const overrides = isRecord(catalog) ? catalog.channelOverrides : undefined;
  if (!isRecord(overrides)) errors.push("OVERRIDES_INVALID");
  const basePillars = (pillars ?? []).filter(validPillar);
  const basePillarIds = basePillars.map((item) => item.id);
  const baseAngleIds = basePillars.flatMap((item) => item.angles.map((itemAngle) => itemAngle.id));
  const allPillarIds = [...basePillarIds];
  const allAngleIds = [...baseAngleIds];

  for (const [channel, rawOverride] of Object.entries(isRecord(overrides) ? overrides : {})) {
    if (!PLATFORMS.includes(channel as SocialPlatform)) errors.push("OVERRIDE_CHANNEL_INVALID");
    if (!isRecord(rawOverride)) {
      errors.push("OVERRIDE_INVALID");
      continue;
    }
    const override = rawOverride;
    if (!hasOnlyKeys(override, ["disabledObjectiveKeys", "disabledPillarIds", "disabledAngleIds", "addedPillars", "addedAnglesByPillarId", "guidanceByAngleId"])) {
      errors.push("OVERRIDE_INVALID");
    }
    const addedPillars = override.addedPillars === undefined ? [] : override.addedPillars;
    const addedAnglesByPillarId = override.addedAnglesByPillarId === undefined ? {} : override.addedAnglesByPillarId;
    if (!Array.isArray(addedPillars) || !isRecord(addedAnglesByPillarId)) {
      errors.push("OVERRIDE_INVALID");
      continue;
    }
    const validAddedPillars = addedPillars.filter(validPillar);
    const addedPillarIds = validAddedPillars.map((item) => item.id);
    const knownPillarIds = new Set([...basePillarIds, ...addedPillarIds]);
    const addedAngles = Object.values(addedAnglesByPillarId).flat();
    if (addedPillars.some((item) => !validPillar(item)) || addedAngles.some((item) => !validAngle(item))) errors.push("OVERRIDE_ADDITION_INVALID");
    if (addedPillars.every(validPillar) && addedPillars.length > 0 && !hasContiguousOrders([...basePillars, ...addedPillars])) errors.push("PILLAR_ORDER_INVALID");
    if (addedPillars.some((item) => validPillar(item) && !hasContiguousOrders(item.angles))) errors.push("ANGLE_ORDER_INVALID");
    const localAngleIds = [...baseAngleIds, ...validAddedPillars.flatMap((item) => item.angles.map((itemAngle) => itemAngle.id))];
    for (const [pillarId, angles] of Object.entries(addedAnglesByPillarId)) {
      if (!knownPillarIds.has(pillarId) || !Array.isArray(angles)) errors.push("ANGLE_PILLAR_INVALID");
      const baseAngles = basePillars.find((item) => item.id === pillarId)?.angles ?? validAddedPillars.find((item) => item.id === pillarId)?.angles ?? [];
      if (Array.isArray(angles) && angles.every(validAngle) && angles.length > 0 && !hasContiguousOrders([...baseAngles, ...angles])) errors.push("ANGLE_ORDER_INVALID");
      if (knownPillarIds.has(pillarId)) localAngleIds.push(...(Array.isArray(angles) ? angles.filter(validAngle).map((item) => item.id) : []));
    }
    allPillarIds.push(...addedPillarIds);
    allAngleIds.push(...validAddedPillars.flatMap((item) => item.angles.map((itemAngle) => itemAngle.id)), ...addedAngles.filter(validAngle).map((item) => item.id));
    const disabledObjectives = override.disabledObjectiveKeys;
    const disabledPillars = override.disabledPillarIds;
    const disabledAngles = override.disabledAngleIds;
    const guidanceByAngleId = override.guidanceByAngleId;
    const invalidOverrideLists = (disabledObjectives !== undefined && (!Array.isArray(disabledObjectives) || disabledObjectives.some((key) => !STRATEGY_OBJECTIVE_KEYS.includes(key as StrategyObjectiveKey)) || new Set(disabledObjectives).size !== disabledObjectives.length))
      || (disabledPillars !== undefined && !validIdList(disabledPillars))
      || (disabledAngles !== undefined && !validIdList(disabledAngles))
      || (guidanceByAngleId !== undefined && (!isRecord(guidanceByAngleId) || Object.entries(guidanceByAngleId).some(([id, guidance]) => !isKebabCase(id) || !validText(guidance, MAX_GUIDANCE_LENGTH))));
    if (invalidOverrideLists) errors.push("OVERRIDE_INVALID");
    if (Array.isArray(disabledPillars) && disabledPillars.some((id) => !knownPillarIds.has(id))) errors.push("OVERRIDE_PILLAR_UNKNOWN");
    if (Array.isArray(disabledAngles) && disabledAngles.some((id) => !localAngleIds.includes(id))) errors.push("OVERRIDE_ANGLE_UNKNOWN");
    if (isRecord(guidanceByAngleId) && Object.keys(guidanceByAngleId).some((id) => !localAngleIds.includes(id))) errors.push("OVERRIDE_ANGLE_UNKNOWN");
  }
  addDuplicateError(errors, allPillarIds, "PILLAR_ID_DUPLICATE");
  addDuplicateError(errors, allAngleIds, "ANGLE_ID_DUPLICATE");

  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true };
}

export function validateStrategyCatalog(catalog: BrandStrategyCatalog): StrategyCatalogValidationResult {
  return validateStrategyCatalogInternal(catalog);
}

function byOrder<T extends { order: number; id?: string }>(left: T, right: T): number {
  return left.order - right.order || (left.id ?? "").localeCompare(right.id ?? "");
}

function renumber<T extends { order: number }>(items: T[]): T[] {
  return items.map((item, index) => ({ ...item, order: index + 1 }));
}

export function catalogForChannel(catalog: BrandStrategyCatalog, platform: SocialPlatform): BrandStrategyCatalog {
  if (!PLATFORMS.includes(platform)) throw new Error("STRATEGY_CATALOG_INVALID");
  const validation = validateStrategyCatalog(catalog);
  if (!validation.ok) throw new Error("STRATEGY_CATALOG_INVALID");
  const copy = structuredClone(catalog);
  const override = copy.channelOverrides[platform] ?? {};
  const disabledObjectives = new Set(override.disabledObjectiveKeys ?? []);
  const disabledPillars = new Set(override.disabledPillarIds ?? []);
  const disabledAngles = new Set(override.disabledAngleIds ?? []);
  const additions = override.addedAnglesByPillarId ?? {};
  const guidanceByAngleId = override.guidanceByAngleId ?? {};
  const filterAngle = (item: ContentAngleDefinition): ContentAngleDefinition | undefined => item.enabled && item.channels.includes(platform) && !disabledAngles.has(item.id) ? { ...item, guidance: guidanceByAngleId[item.id] ?? item.guidance } : undefined;
  const filterPillar = (item: ContentPillarDefinition): ContentPillarDefinition | undefined => {
    if (!item.enabled || !item.channels.includes(platform) || disabledPillars.has(item.id)) return undefined;
    const angles = [...item.angles, ...(additions[item.id] ?? [])].map(filterAngle).filter((itemAngle): itemAngle is ContentAngleDefinition => itemAngle !== undefined).sort(byOrder);
    return angles.length ? { ...item, angles: renumber(angles) } : undefined;
  };
  const pillars = copy.pillars.map(filterPillar).filter((item): item is ContentPillarDefinition => item !== undefined);
  const addedPillars = (override.addedPillars ?? []).map(filterPillar).filter((item): item is ContentPillarDefinition => item !== undefined);
  copy.objectives = renumber(copy.objectives.filter((item) => item.enabled && !disabledObjectives.has(item.key)).sort(byOrder));
  copy.pillars = renumber([...pillars, ...addedPillars].sort(byOrder));
  copy.channelOverrides = {};
  if (!validateStrategyCatalogInternal(copy, true).ok) throw new Error("STRATEGY_CATALOG_INVALID");
  return copy;
}

function stableSerialize(value: unknown): string {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record).filter((key) => record[key] !== undefined && typeof record[key] !== "function" && typeof record[key] !== "symbol").sort();
  return `{${entries.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

function hash64(input: Uint8Array, seed: bigint): string {
  let hash = seed;
  for (const byte of input) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, "0");
}

// ponytail: four synchronous FNV lanes keep this browser-safe; use Web Crypto only if a cryptographic fingerprint is required.
export function strategyCatalogFingerprint(catalog: BrandStrategyCatalog): string {
  const bytes = new TextEncoder().encode(stableSerialize(catalog));
  return [
    0xcbf29ce484222325n,
    0x84222325cbf29ce4n,
    0x9e3779b185ebca87n,
    0x6a09e667f3bcc909n,
  ].map((seed) => hash64(bytes, seed)).join("");
}
