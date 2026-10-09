export type WorkspaceRole = "owner" | "admin" | "editor" | "reviewer" | "analyst";
import type { BrandIdentityRecord, ChannelBindingRecord } from "./brandIdentity";
import type { GenerationProfile, ProviderConfiguration } from "./mvpContracts";
import type { ContentRecipe } from "./contentRecipe";
import { bellamyBabyStrategyCatalog, cloneStrategyCatalog, starterStrategyCatalog } from "./contentStrategy";
import type { BrandStrategyCatalog } from "./contentStrategy";
export type MembershipStatus = "active" | "invited" | "suspended";
export type WorkspaceCapability = "manage_workspace" | "manage_brand" | "create_content" | "approve_content" | "schedule_content" | "view_analytics";

export interface BrandVisualTokens {
  primary: string;
  secondary: string;
  typography: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  clientLabel: string;
  timezone: string;
  brandIds: string[];
  membershipIds: string[];
}

/** UI/domain name for the legacy workspace compatibility record. */
export type ClientRecord = WorkspaceRecord;

export interface BrandRecord {
  id: string;
  /** Added for the agency migration; legacy snapshots continue to use workspaceId. */
  clientId?: string;
  workspaceId: string;
  name: string;
  systemId: string;
  status: "active" | "draft" | "archived";
  deletedAt?: string;
  brandKitLinked?: boolean;
  externalPageId?: string;
}

export function isBrandTrashed(brand: BrandRecord): boolean {
  return Boolean(brand.deletedAt) || brand.status === "archived";
}

export function createClient(name: string, timezone: string, id: string): WorkspaceRecord {
  return { id, name: name.trim(), clientLabel: "Client", timezone: timezone.trim(), brandIds: [], membershipIds: [] };
}

export function createBrandDraft(clientId: string, name: string, id: string): BrandRecord {
  return { id, clientId, workspaceId: clientId, name: name.trim(), systemId: id, status: "draft", brandKitLinked: false };
}

export interface MembershipRecord {
  id: string;
  workspaceId: string;
  userId: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
  status: MembershipStatus;
}

export interface ContentTemplate {
  id: string;
  workspaceId: string;
  brandId: string;
  name: string;
  description: string;
  kind: "text" | "image" | "carousel" | "short_video" | "long_video";
  platforms: Array<"Facebook" | "Instagram" | "TikTok" | "YouTube">;
  hook: string;
  bodyTemplate: string;
  defaultCta: string;
  active: boolean;
}

export type StrategyCatalogScopeKey = string;

/** One canonical key for every catalog/template read, write, and acknowledgement. */
export function strategyCatalogScopeKey(clientId: string, brandId: string): StrategyCatalogScopeKey {
  const client = typeof clientId === "string" ? clientId.trim() : "";
  const brand = typeof brandId === "string" ? brandId.trim() : "";
  if (!client || !brand) throw new Error("STRATEGY_CATALOG_SCOPE_INVALID");
  return JSON.stringify([client, brand]);
}

export type BrandScheduleTemplate = {
  id: string;
  brandId: string;
  timezone: string;
  /** ISO 8601 weekday keys: Monday=1 through Sunday=7. */
  timesByWeekday: Record<number, string[]>;
  version: number;
  updatedAt: string;
};

const DEFAULT_SCHEDULE_TIMEZONE = "Asia/Ho_Chi_Minh";
const SCHEDULE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_SCHEDULE_TIMES_BY_WEEKDAY: Readonly<Record<number, readonly string[]>> = {
  1: ["09:00"], 2: ["09:00"], 3: ["09:00"], 4: ["09:00"], 5: ["09:00"], 6: ["10:00"], 7: ["10:00"],
};

export interface WorkspaceState {
  activeWorkspaceId: string;
  activeBrandId: string;
  brandVoiceByBrand: Record<string, string>;
  /** Optional for legacy snapshots; values are editable Brand Kit defaults/overrides, not provider-generated claims. */
  brandVisualTokensByBrand?: Record<string, BrandVisualTokens>;
  /** Migrated agency records remain optional until a legacy snapshot is hydrated. */
  brandIdentities?: BrandIdentityRecord[];
  channelBindings?: ChannelBindingRecord[];
  generationProfiles?: GenerationProfile[];
  providerConfigurations?: ProviderConfiguration[];
  contentRecipes?: ContentRecipe[];
  strategyCatalogsByBrand?: Record<StrategyCatalogScopeKey, BrandStrategyCatalog>;
  scheduleTemplatesByBrand?: Record<StrategyCatalogScopeKey, BrandScheduleTemplate>;
  workspaces: WorkspaceRecord[];
  brands: BrandRecord[];
  memberships: MembershipRecord[];
}

export const roleCapabilities: Record<WorkspaceRole, WorkspaceCapability[]> = {
  owner: ["manage_workspace", "manage_brand", "create_content", "approve_content", "schedule_content", "view_analytics"],
  admin: ["manage_workspace", "manage_brand", "create_content", "approve_content", "schedule_content", "view_analytics"],
  editor: ["create_content", "schedule_content", "view_analytics"],
  reviewer: ["approve_content", "view_analytics"],
  analyst: ["view_analytics"],
};

export function canRole(role: WorkspaceRole, capability: WorkspaceCapability): boolean {
  return roleCapabilities[role].includes(capability);
}

export function activeWorkspace(state: WorkspaceState): WorkspaceRecord {
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? state.workspaces[0];
}

export const activeClient = activeWorkspace;

export function clientIdForBrand(brand: Pick<BrandRecord, "clientId" | "workspaceId">): string {
  return brand.clientId ?? brand.workspaceId;
}

export function activeBrand(state: WorkspaceState): BrandRecord {
  const workspace = activeWorkspace(state);
  const visible = state.brands.filter((brand) => brand.workspaceId === workspace?.id && !isBrandTrashed(brand));
  return visible.find((brand) => brand.id === state.activeBrandId)
    ?? visible[0]
    ?? { id: `empty-brand-${workspace?.id ?? "workspace"}`, clientId: workspace?.id ?? "", workspaceId: workspace?.id ?? "", name: "Chưa có brand", systemId: "", status: "draft" };
}

export function activeMembership(state: WorkspaceState, userId = "user-bavy"): MembershipRecord | undefined {
  return state.memberships.find((membership) => membership.workspaceId === state.activeWorkspaceId && membership.userId === userId)
    ?? state.memberships.find((membership) => membership.workspaceId === state.activeWorkspaceId);
}

export const defaultBrandVisualTokensByBrand: Record<string, BrandVisualTokens> = {
  "brand-mile-mark-money": { primary: "#4f46e5", secondary: "#f6f7fb", typography: "Inter" },
  "brand-bellamy-baby": { primary: "#d97706", secondary: "#fff7ed", typography: "Noto Sans" },
  "brand-north-star": { primary: "#0f766e", secondary: "#f0fdfa", typography: "Inter" },
};

const BRAND_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_TYPOGRAPHY_LENGTH = 40;
const SAFE_DEFAULT_TYPOGRAPHY = "Inter";

export function sanitizeBrandTypography(value: unknown, fallback = SAFE_DEFAULT_TYPOGRAPHY): string {
  const normalize = (input: string): string => input.trim().replace(/[^\p{L}\p{N}\s._-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TYPOGRAPHY_LENGTH).trim();
  const safeFallback = typeof fallback === "string" ? normalize(fallback) || SAFE_DEFAULT_TYPOGRAPHY : SAFE_DEFAULT_TYPOGRAPHY;
  if (typeof value !== "string") return safeFallback;
  return normalize(value) || safeFallback;
}

export function isBrandVisualTokens(value: unknown): value is BrandVisualTokens {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BrandVisualTokens>;
  return typeof candidate.primary === "string" && BRAND_COLOR.test(candidate.primary)
    && typeof candidate.secondary === "string" && BRAND_COLOR.test(candidate.secondary)
    && typeof candidate.typography === "string" && candidate.typography.trim().length > 0 && candidate.typography.trim().length <= MAX_TYPOGRAPHY_LENGTH;
}

export function sanitizeBrandVisualTokens(value: unknown, fallback: BrandVisualTokens = defaultBrandVisualTokensByBrand["brand-mile-mark-money"]): BrandVisualTokens {
  const safeFallback = isBrandVisualTokens(fallback) ? { ...fallback } : { ...defaultBrandVisualTokensByBrand["brand-mile-mark-money"] };
  const candidate = value && typeof value === "object" ? value as Partial<BrandVisualTokens> : {};
  return {
    primary: typeof candidate.primary === "string" && BRAND_COLOR.test(candidate.primary) ? candidate.primary : safeFallback.primary,
    secondary: typeof candidate.secondary === "string" && BRAND_COLOR.test(candidate.secondary) ? candidate.secondary : safeFallback.secondary,
    typography: sanitizeBrandTypography(candidate.typography, safeFallback.typography),
  };
}

export function mergeBrandVisualTokensByBrand(saved: WorkspaceState["brandVisualTokensByBrand"], fallback: WorkspaceState["brandVisualTokensByBrand"] = defaultBrandVisualTokensByBrand): Record<string, BrandVisualTokens> {
  const merged: Record<string, BrandVisualTokens> = {};
  Object.entries(fallback ?? {}).forEach(([brandId, tokens]) => {
    if (isBrandVisualTokens(tokens)) merged[brandId] = sanitizeBrandVisualTokens(tokens, tokens);
  });
  Object.entries(defaultBrandVisualTokensByBrand).forEach(([brandId, tokens]) => {
    if (!merged[brandId]) merged[brandId] = { ...tokens };
  });
  Object.entries(saved ?? {}).forEach(([brandId, tokens]) => {
    if (isBrandVisualTokens(tokens)) merged[brandId] = sanitizeBrandVisualTokens(tokens, merged[brandId] ?? defaultBrandVisualTokensByBrand["brand-mile-mark-money"]);
  });
  return merged;
}

export function getBrandVisualTokens(state: WorkspaceState, brandId: string, fallback: BrandVisualTokens): BrandVisualTokens {
  const fallbackTokens = isBrandVisualTokens(fallback) ? fallback : defaultBrandVisualTokensByBrand["brand-mile-mark-money"];
  const resolved = state.brandVisualTokensByBrand?.[brandId] ?? defaultBrandVisualTokensByBrand[brandId] ?? fallbackTokens;
  return sanitizeBrandVisualTokens(resolved, fallbackTokens);
}

export function ensureBrandVisualTokensByBrand(state: WorkspaceState, brandId: string, fallback: BrandVisualTokens): WorkspaceState {
  const tokens = getBrandVisualTokens(state, brandId, fallback);
  return { ...state, brandVisualTokensByBrand: { ...mergeBrandVisualTokensByBrand(state.brandVisualTokensByBrand), [brandId]: { ...tokens } } };
}

function scopedBrand(state: WorkspaceState, clientId: string, brandId: string): BrandRecord | undefined {
  const client = clientId.trim();
  const brand = brandId.trim();
  return state.brands.find((item) => item.id === brand && clientIdForBrand(item) === client && !isBrandTrashed(item));
}

function scopedCatalogMap(state: WorkspaceState, value: unknown): Record<string, BrandStrategyCatalog> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, catalog]) => {
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return false;
    try {
      const scope = JSON.parse(key);
      return Array.isArray(scope) && scope.length === 2 && typeof scope[0] === "string" && typeof scope[1] === "string" && strategyCatalogScopeKey(scope[0], scope[1]) === key && (catalog as BrandStrategyCatalog).brandId === scope[1] && state.brands.some((brand) => brand.id === scope[1] && clientIdForBrand(brand) === scope[0] && !isBrandTrashed(brand));
    } catch {
      return false;
    }
  })) as Record<string, BrandStrategyCatalog>;
}

function scopedScheduleMap(state: WorkspaceState, value: unknown): Record<string, BrandScheduleTemplate> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, template]) => {
    if (!template || typeof template !== "object" || Array.isArray(template)) return false;
    try {
      const scope = JSON.parse(key);
      const owner = state.brands.find((brand) => brand.id === scope?.[1] && clientIdForBrand(brand) === scope?.[0] && brand.status === "active" && !isBrandTrashed(brand));
      const normalized = normalizeBrandScheduleTemplate(template);
      return Array.isArray(scope) && scope.length === 2 && typeof scope[0] === "string" && typeof scope[1] === "string" && strategyCatalogScopeKey(scope[0], scope[1]) === key && (template as BrandScheduleTemplate).brandId === scope[1] && Boolean(owner) && Boolean(normalized);
    } catch {
      return false;
    }
  }).map(([key, template]) => [key, normalizeBrandScheduleTemplate(template)!])) as Record<string, BrandScheduleTemplate>;
}

function validScheduleTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeBrandScheduleTemplate(template: unknown): BrandScheduleTemplate | undefined {
  if (!template || typeof template !== "object" || Array.isArray(template)) return undefined;
  const candidate = template as BrandScheduleTemplate;
  const source = candidate.timesByWeekday && typeof candidate.timesByWeekday === "object" && !Array.isArray(candidate.timesByWeekday)
    ? candidate.timesByWeekday
    : {};
  const timesByWeekday: Record<number, string[]> = {};
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const times = source[weekday];
    if (times === undefined) {
      timesByWeekday[weekday] = [...DEFAULT_SCHEDULE_TIMES_BY_WEEKDAY[weekday]!];
      continue;
    }
    if (!Array.isArray(times) || times.some((time) => typeof time !== "string" || !SCHEDULE_TIME.test(time))) return undefined;
    timesByWeekday[weekday] = [...times].sort();
  }
  // Empty arrays disable a weekday; all seven disabled means no deterministic next slot.
  if (Object.values(timesByWeekday).every((times) => times.length === 0)) return undefined;
  const version = Number.isInteger(candidate.version) && candidate.version >= 1 ? candidate.version : 1;
  return {
    ...structuredClone(candidate),
    timezone: validScheduleTimezone(candidate.timezone) ? candidate.timezone.trim() : DEFAULT_SCHEDULE_TIMEZONE,
    timesByWeekday,
    version,
  };
}

export function ensureBrandStrategyCatalog(state: WorkspaceState, clientId: string, brandId: string, now?: Date): WorkspaceState {
  const key = strategyCatalogScopeKey(clientId, brandId);
  const client = clientId.trim();
  const brandIdentifier = brandId.trim();
  const catalogs = scopedCatalogMap(state, state.strategyCatalogsByBrand);
  if (catalogs[key] || !scopedBrand(state, client, brandIdentifier)) return state;
  const brand = scopedBrand(state, client, brandIdentifier);
  const tailored = brand?.id === "brand-bellamy-baby" || brand?.systemId === "bellamy-baby";
  const source = tailored ? bellamyBabyStrategyCatalog(now) : starterStrategyCatalog(brandIdentifier, now);
  const catalog = cloneStrategyCatalog(source, brandIdentifier, now);
  return { ...state, strategyCatalogsByBrand: { ...catalogs, [key]: catalog } };
}

export function ensureBrandScheduleTemplate(state: WorkspaceState, clientId: string, brandId: string, now?: Date): WorkspaceState {
  const key = strategyCatalogScopeKey(clientId, brandId);
  const client = clientId.trim();
  const brandIdentifier = brandId.trim();
  const templates = scopedScheduleMap(state, state.scheduleTemplatesByBrand);
  const brand = scopedBrand(state, client, brandIdentifier);
  if (!brand || brand.status !== "active") return state.scheduleTemplatesByBrand ? { ...state, scheduleTemplatesByBrand: templates } : state;
  if (templates[key]) return { ...state, scheduleTemplatesByBrand: templates };
  const timezoneCandidate = state.workspaces.find((item) => item.id === brand.workspaceId)?.timezone
    ?? state.workspaces.find((item) => item.id === client)?.timezone
    ?? DEFAULT_SCHEDULE_TIMEZONE;
  const timezone = validScheduleTimezone(timezoneCandidate) ? timezoneCandidate.trim() : DEFAULT_SCHEDULE_TIMEZONE;
  return {
    ...state,
    scheduleTemplatesByBrand: {
      ...templates,
      [key]: {
        id: `schedule-template-${client}-${brandIdentifier}`,
        brandId: brandIdentifier,
        timezone,
        timesByWeekday: Object.fromEntries(Object.entries(DEFAULT_SCHEDULE_TIMES_BY_WEEKDAY).map(([weekday, times]) => [weekday, [...times]])),
        version: 1,
        updatedAt: (now ?? new Date()).toISOString(),
      },
    },
  };
}

export function switchWorkspace(state: WorkspaceState, workspaceId: string): WorkspaceState {
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return state;
  const brand = state.brands.find((item) => item.id === state.activeBrandId && item.workspaceId === workspaceId && !isBrandTrashed(item))
    ?? state.brands.find((item) => item.workspaceId === workspaceId && !isBrandTrashed(item));
  return { ...state, activeWorkspaceId: workspace.id, activeBrandId: brand?.id ?? state.activeBrandId };
}

export function switchBrand(state: WorkspaceState, brandId: string): WorkspaceState {
  const brand = state.brands.find((item) => item.id === brandId && item.workspaceId === state.activeWorkspaceId && !isBrandTrashed(item));
  return brand ? { ...state, activeBrandId: brand.id } : state;
}

export const defaultWorkspaceState: WorkspaceState = {
  activeWorkspaceId: "workspace-mile-mark-money",
  activeBrandId: "brand-mile-mark-money",
  brandVoiceByBrand: {
    "brand-mile-mark-money": "Clear, practical, warm and evidence-led. Explain money without shame or hype.",
    "brand-bellamy-baby": "Ấm áp, gần gũi với phụ huynh Việt; mô tả thật về đồ trẻ em, chất liệu và kiểu dáng Hàn Quốc; màu sắc nhẹ nhàng, CTA đặt hàng rõ qua bellamy.example; không phóng đại công dụng.",
    "brand-north-star": "Calm, structured and transparent. Teach financial decisions with context and evidence.",
  },
  brandVisualTokensByBrand: defaultBrandVisualTokensByBrand,
  workspaces: [
    { id: "workspace-mile-mark-money", name: "Mile Mark Money", clientLabel: "Owned studio", timezone: "Asia/Ho_Chi_Minh", brandIds: ["brand-mile-mark-money", "brand-bellamy-baby"], membershipIds: ["member-bavy", "member-linh"] },
    { id: "workspace-north-star", name: "North Star Finance", clientLabel: "Client workspace", timezone: "Asia/Singapore", brandIds: ["brand-north-star"], membershipIds: ["member-bavy-north", "member-mai"] },
  ],
  brands: [
    { id: "brand-mile-mark-money", workspaceId: "workspace-mile-mark-money", name: "Mile Mark Money", systemId: "mile-mark-money", status: "active", brandKitLinked: true },
    { id: "brand-bellamy-baby", workspaceId: "workspace-mile-mark-money", name: "Bellamy Baby", systemId: "bellamy-baby", status: "active", brandKitLinked: true, externalPageId: "100000000000001" },
    { id: "brand-north-star", workspaceId: "workspace-north-star", name: "North Star Finance", systemId: "north-star", status: "draft", brandKitLinked: false },
  ],
  memberships: [
    { id: "member-bavy", workspaceId: "workspace-mile-mark-money", userId: "user-bavy", displayName: "Bảo Vy", email: "owner@signalflow.local", role: "owner", status: "active" },
    { id: "member-linh", workspaceId: "workspace-mile-mark-money", userId: "user-linh", displayName: "Lan Nguyễn", email: "review@signalflow.local", role: "reviewer", status: "active" },
    { id: "member-bavy-north", workspaceId: "workspace-north-star", userId: "user-bavy", displayName: "Bảo Vy", email: "owner@signalflow.local", role: "admin", status: "active" },
    { id: "member-mai", workspaceId: "workspace-north-star", userId: "user-mai", displayName: "Mai Trần", email: "editor@signalflow.local", role: "editor", status: "invited" },
  ],
};

export const defaultContentTemplates: ContentTemplate[] = [
  { id: "template-education", workspaceId: "workspace-mile-mark-money", brandId: "brand-mile-mark-money", name: "Practical education", description: "Explain one money system without shame or hype.", kind: "text", platforms: ["Facebook", "Instagram", "YouTube"], hook: "The money habit most people skip is…", bodyTemplate: "Context → 3 practical steps → one small action today.", defaultCta: "Save this for your next money reset.", active: true },
  { id: "template-carousel", workspaceId: "workspace-mile-mark-money", brandId: "brand-mile-mark-money", name: "Checklist carousel", description: "Turn a repeatable routine into a platform-native carousel.", kind: "carousel", platforms: ["Instagram", "Facebook"], hook: "Use this checklist before you…", bodyTemplate: "Slide 1 promise → slides 2–5 checklist → final reminder.", defaultCta: "Share with someone building a safety net.", active: true },
  { id: "template-short-video", workspaceId: "workspace-north-star", brandId: "brand-north-star", name: "Short-form myth bust", description: "A concise myth, evidence and practical alternative.", kind: "short_video", platforms: ["TikTok", "YouTube", "Instagram"], hook: "A common money myth is…", bodyTemplate: "Myth → why it fails → better rule → example.", defaultCta: "Follow for practical money systems.", active: true },
];
