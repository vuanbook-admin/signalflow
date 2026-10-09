import type { ChannelBindingState, SocialPlatform } from "./mvpContracts";
import { clientIdForBrand, getBrandVisualTokens, strategyCatalogScopeKey, type BrandRecord, type WorkspaceState } from "./workspaceDomain";
import type { BrandStrategyCatalog } from "./contentStrategy";

export interface BrandIdentityPayload {
  /** Optional transport-only catalog field; persistence keeps one canonical copy. */
  strategyCatalog?: BrandStrategyCatalog;
  strategy: {
    vision: string;
    mission: string;
    values: string[];
    personality: string[];
    audience: string;
    positioning?: string;
  };
  voice: {
    tone: string;
    vocabulary: string[];
    prohibitedClaims: string[];
    requiredDisclosure?: string;
  };
  visual: {
    logoAssetIds: string[];
    colors: Array<{ name: string; hex: string; rgb?: string; cmyk?: string }>;
    typography: { heading: string; body: string };
    tagline?: string;
    styleGuide: string;
  };
}

export interface BrandIdentityRecord extends BrandIdentityPayload {
  id: string;
  brandId: string;
  name: string;
  isDefault: boolean;
  version: number;
  status: "draft" | "active" | "archived";
}

export interface ChannelConnectionRecord {
  id: string;
  clientId: string;
  platform: SocialPlatform;
  externalAccountId: string;
  displayName: string;
  connectionState: ChannelBindingState;
  scopes: string[];
}

export interface ChannelBindingRecord {
  id: string;
  brandId: string;
  identityId: string;
  connectionId: string;
  targetExternalId: string;
  targetName: string;
  platform: SocialPlatform;
  state: ChannelBindingState;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export const LEGACY_IDENTITY_ID_MAX_LENGTH = 128 as const;
export const LEGACY_IDENTITY_ID_SCOPE_TOO_LONG = "IDENTITY_ID_SCOPE_TOO_LONG" as const;

export class LegacyIdentityScopeError extends Error {
  readonly code = LEGACY_IDENTITY_ID_SCOPE_TOO_LONG;

  constructor() {
    super(LEGACY_IDENTITY_ID_SCOPE_TOO_LONG);
    this.name = "LegacyIdentityScopeError";
  }
}

export function legacyAgencyIdentityId(brand: Pick<BrandRecord, "id" | "clientId" | "workspaceId">): string {
  const scopeKey = strategyCatalogScopeKey(clientIdForBrand(brand), brand.id);
  let encodedScope: string;
  try {
    encodedScope = encodeURIComponent(scopeKey);
  } catch {
    throw new LegacyIdentityScopeError();
  }
  const identityId = `identity-${encodedScope}-v1`;
  if (identityId.length > LEGACY_IDENTITY_ID_MAX_LENGTH) throw new LegacyIdentityScopeError();
  return identityId;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SECRET_SHAPED = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|cookie|password|private[_-]?key|session(?:data)?)/i;
const MAX_TEXT_LENGTH = 600;

function isBoundedText(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string" && value.trim().length <= MAX_TEXT_LENGTH && (allowEmpty || value.trim().length > 0);
}

function containsSecretShapedValue(value: unknown): boolean {
  if (typeof value === "string") return SECRET_SHAPED.test(value);
  if (Array.isArray(value)) return value.some(containsSecretShapedValue);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => SECRET_SHAPED.test(key) || containsSecretShapedValue(item));
}

export function validateBrandClient(brand: Pick<BrandRecord, "clientId" | "workspaceId">, clientIds: string[]): ValidationResult {
  const clientId = brand.clientId ?? brand.workspaceId;
  return clientIds.includes(clientId) ? { ok: true, errors: [] } : { ok: false, errors: ["BRAND_CLIENT_MISSING"] };
}

export function validateBrandIdentity(identity: BrandIdentityRecord): ValidationResult {
  const errors: string[] = [];
  if (!isBoundedText(identity.id) || !isBoundedText(identity.brandId) || !isBoundedText(identity.name) || !Number.isInteger(identity.version) || identity.version < 1) errors.push("IDENTITY_REQUIRED_FIELD_INVALID");
  if (!identity.visual?.colors?.length || identity.visual.colors.some((color) => !isBoundedText(color.name) || !HEX_COLOR.test(color.hex))) errors.push("IDENTITY_COLOR_INVALID");
  if (!isBoundedText(identity.strategy?.vision) || !isBoundedText(identity.strategy?.mission) || !isBoundedText(identity.strategy?.audience) || !isBoundedText(identity.voice?.tone) || !isBoundedText(identity.visual?.typography?.heading) || !isBoundedText(identity.visual?.typography?.body) || !isBoundedText(identity.visual?.styleGuide)) errors.push("IDENTITY_REQUIRED_FIELD_INVALID");
  if (containsSecretShapedValue(identity)) errors.push("IDENTITY_SECRET_SHAPED_VALUE");
  return { ok: errors.length === 0, errors };
}

export function resolveActiveBrandIdentity(brandId: string, identities: BrandIdentityRecord[]): BrandIdentityRecord | undefined {
  return identities.find((identity) => identity.brandId === brandId && identity.isDefault)
    ?? identities.find((identity) => identity.brandId === brandId && identity.status === "active")
    ?? identities.find((identity) => identity.brandId === brandId);
}

export function validateChannelBinding(input: {
  binding: ChannelBindingRecord;
  brands: BrandRecord[];
  identities: BrandIdentityRecord[];
  connections: ChannelConnectionRecord[];
}): ValidationResult {
  const brand = input.brands.find((item) => item.id === input.binding.brandId);
  const identity = input.identities.find((item) => item.id === input.binding.identityId);
  const connection = input.connections.find((item) => item.id === input.binding.connectionId);
  const errors: string[] = [];
  if (!brand) errors.push("BINDING_BRAND_MISSING");
  if (!identity || identity.brandId !== input.binding.brandId) errors.push("BINDING_IDENTITY_MISMATCH");
  if (!connection) errors.push("BINDING_CONNECTION_MISSING");
  if (brand && connection && clientIdForBrand(brand) !== connection.clientId) errors.push("CONNECTION_CLIENT_MISMATCH");
  if (connection && connection.platform !== input.binding.platform) errors.push("BINDING_PLATFORM_MISMATCH");
  return { ok: errors.length === 0, errors };
}

export function hydrateLegacyAgencyRecords(state: WorkspaceState): {
  clients: Array<{ id: string; name: string; timezone: string; clientLabel: string }>;
  identities: BrandIdentityRecord[];
  bindings: ChannelBindingRecord[];
} {
  const clients = state.workspaces.map(({ id, name, timezone, clientLabel }) => ({ id, name, timezone, clientLabel }));
  const identityIds = state.brands.map(legacyAgencyIdentityId);
  const identities = state.brands.map((brand, index) => {
    const scopeKey = strategyCatalogScopeKey(clientIdForBrand(brand), brand.id);
    const tokens = getBrandVisualTokens(state, brand.id, { primary: "#4f46e5", secondary: "#f6f7fb", typography: "Inter" });
    const voice = state.brandVoiceByBrand[scopeKey] ?? state.brandVoiceByBrand[brand.id];
    return {
      id: identityIds[index],
      brandId: brand.id,
      name: "Default identity",
      isDefault: true,
      version: 1,
      status: brand.status === "archived" ? "archived" : brand.brandKitLinked ? "active" : "draft",
      strategy: { vision: brand.name, mission: voice || `${brand.name} legacy mission`, values: [], personality: [], audience: "Legacy audience pending review" },
      voice: { tone: voice || "Legacy voice pending review", vocabulary: [], prohibitedClaims: [] },
      visual: {
        logoAssetIds: [],
        colors: [{ name: "Primary", hex: tokens.primary }, { name: "Secondary", hex: tokens.secondary }],
        typography: { heading: tokens.typography, body: tokens.typography },
        styleGuide: "Legacy Brand Kit migration",
      },
    } satisfies BrandIdentityRecord;
  });
  const bindings = state.channelBindings ?? [];
  return { clients, identities, bindings };
}
