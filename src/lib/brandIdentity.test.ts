import { describe, expect, it } from "vitest";
import { defaultWorkspaceState } from "./workspaceDomain";

async function loadBrandIdentity() {
  return await import(/* @vite-ignore */ "./brandIdentity").catch(() => undefined);
}

const identity = {
  id: "identity-a-v1",
  brandId: "brand-a",
  name: "Default identity",
  isDefault: true,
  version: 1,
  status: "active" as const,
  strategy: { vision: "Make planning clear", mission: "Teach practical action", values: ["honest"], personality: ["calm"], audience: "Founders" },
  voice: { tone: "Clear", vocabulary: ["plan"], prohibitedClaims: ["Guaranteed outcome"], requiredDisclosure: "Educational only" },
  visual: { logoAssetIds: [], colors: [{ name: "Ink", hex: "#112233" }], typography: { heading: "Inter", body: "Inter" }, styleGuide: "Simple and direct" },
};

describe("agency Brand Identity contracts", () => {
  it("rejects a Brand whose Client does not exist", async () => {
    const api = await loadBrandIdentity();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.validateBrandClient).toBeTypeOf("function");
    if (typeof api.validateBrandClient !== "function") return;

    expect(api.validateBrandClient({ workspaceId: "client-missing" }, ["client-a"])).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["BRAND_CLIENT_MISSING"]),
    });
  });

  it("validates exact identity colors and rejects secret-shaped values", async () => {
    const api = await loadBrandIdentity();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.validateBrandIdentity).toBeTypeOf("function");
    if (typeof api.validateBrandIdentity !== "function") return;

    expect(api.validateBrandIdentity(identity)).toEqual({ ok: true, errors: [] });
    expect(api.validateBrandIdentity({ ...identity, visual: { ...identity.visual, colors: [{ name: "Bad", hex: "#fff" }] } })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["IDENTITY_COLOR_INVALID"]),
    });
    expect(api.validateBrandIdentity({ ...identity, voice: { ...identity.voice, vocabulary: ["api_key=do-not-store"] } })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["IDENTITY_SECRET_SHAPED_VALUE"]),
    });
  });

  it("rejects a ChannelBinding whose connection belongs to another Client", async () => {
    const api = await loadBrandIdentity();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.validateChannelBinding).toBeTypeOf("function");
    if (typeof api.validateChannelBinding !== "function") return;

    const result = api.validateChannelBinding({
      binding: { id: "binding-a", brandId: "brand-a", identityId: identity.id, connectionId: "connection-b", targetExternalId: "page-b", targetName: "Page B", platform: "facebook", state: "connected" },
      brands: [{ id: "brand-a", workspaceId: "client-a", clientId: "client-a", name: "A", systemId: "a", status: "active" }],
      identities: [identity],
      connections: [{ id: "connection-b", clientId: "client-b", platform: "facebook", externalAccountId: "account-b", displayName: "Account B", connectionState: "connected", scopes: [] }],
    });

    expect(result).toMatchObject({ ok: false, errors: expect.arrayContaining(["CONNECTION_CLIENT_MISMATCH"]) });
  });

  it("hydrates each legacy Brand with one default identity and no inferred cross-client binding", async () => {
    const api = await loadBrandIdentity();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.hydrateLegacyAgencyRecords).toBeTypeOf("function");
    if (typeof api.hydrateLegacyAgencyRecords !== "function") return;

    const hydrated = api.hydrateLegacyAgencyRecords(defaultWorkspaceState);
    expect(hydrated.clients.map((client: { id: string }) => client.id)).toEqual(defaultWorkspaceState.workspaces.map((workspace) => workspace.id));
    expect(hydrated.identities).toHaveLength(defaultWorkspaceState.brands.length);
    expect(hydrated.identities.every((item: { isDefault: boolean }) => item.isDefault)).toBe(true);
    expect(hydrated.bindings).toEqual([]);
    expect(api.resolveActiveBrandIdentity("brand-bellamy-baby", hydrated.identities)?.brandId).toBe("brand-bellamy-baby");
  });

  it("scopes generated legacy identity IDs by Client when Brand IDs repeat", async () => {
    const api = await loadBrandIdentity();
    expect(api).toBeDefined();
    if (!api || typeof api.hydrateLegacyAgencyRecords !== "function" || typeof api.legacyAgencyIdentityId !== "function") return;
    const state = {
      ...structuredClone(defaultWorkspaceState),
      workspaces: [
        { id: "client-a", name: "A", clientLabel: "Client", timezone: "UTC", brandIds: ["brand-shared"], membershipIds: [] },
        { id: "client-b", name: "B", clientLabel: "Client", timezone: "UTC", brandIds: ["brand-shared"], membershipIds: [] },
      ],
      brands: [
        { id: "brand-shared", clientId: "client-a", workspaceId: "client-a", name: "A", systemId: "a", status: "active" as const },
        { id: "brand-shared", clientId: "client-b", workspaceId: "client-b", name: "B", systemId: "b", status: "active" as const },
      ],
      brandVoiceByBrand: {},
    };
    const identities = api.hydrateLegacyAgencyRecords(state).identities;
    expect(identities.map((item: { id: string }) => item.id)).toEqual(state.brands.map((brand) => api.legacyAgencyIdentityId(brand)));
  });

  it("keeps an incomplete legacy Brand Identity as a draft instead of activating it", async () => {
    const api = await loadBrandIdentity();
    expect(api).toBeDefined();
    if (!api || typeof api.hydrateLegacyAgencyRecords !== "function" || typeof api.validateBrandIdentity !== "function") return;

    const identity = api.hydrateLegacyAgencyRecords(defaultWorkspaceState).identities.find((item: { brandId: string }) => item.brandId === "brand-north-star");
    expect(identity).toMatchObject({ isDefault: true, status: "draft" });
    if (!identity) return;
    expect(api.validateBrandIdentity(identity)).toEqual({ ok: true, errors: [] });
  });
});
