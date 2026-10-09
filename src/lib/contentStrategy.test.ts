import { describe, expect, it } from "vitest";
import {
  STRATEGY_OBJECTIVE_KEYS,
  bellamyBabyStrategyCatalog,
  catalogForChannel,
  cloneStrategyCatalog,
  starterStrategyCatalog,
  strategyCatalogFingerprint,
  validateStrategyCatalog,
} from "./contentStrategy";

const CHANNELS = ["facebook", "instagram", "tiktok", "youtube"] as const;

describe("brand-owned content strategy catalog", () => {
  it("keeps stable objectives and the two required seed families", () => {
    const timestamp = new Date("2026-09-02T00:00:00.000Z");
    const starter = starterStrategyCatalog("brand-new", timestamp);
    const bellamy = bellamyBabyStrategyCatalog(timestamp);

    expect(STRATEGY_OBJECTIVE_KEYS).toEqual(["reach", "engagement", "education", "knowledge", "conversion"]);
    expect(starter.objectives.map(({ key, label, order }) => ({ key, label, order }))).toEqual([
      { key: "reach", label: "Reach", order: 1 },
      { key: "engagement", label: "Engagement", order: 2 },
      { key: "education", label: "Education", order: 3 },
      { key: "knowledge", label: "Knowledge", order: 4 },
      { key: "conversion", label: "Conversion", order: 5 },
    ]);
    expect(starter.pillars.map(({ id }) => id)).toEqual([
      "audience-insight",
      "practical-education",
      "proof-and-process",
      "use-case-and-action",
      "brand-trust",
    ]);
    expect(bellamy.pillars.map(({ id }) => id)).toEqual([
      "product-proof",
      "care-and-material",
      "parent-guidance",
      "style-and-occasion",
      "brand-trust",
    ]);
    expect(starter.pillars.map((pillar) => pillar.angles.map(({ id }) => id))).toEqual([
      ["audience-insight-audience-question", "audience-insight-pain-point", "audience-insight-trend-signal"],
      ["practical-education-step-by-step-guide", "practical-education-common-mistake", "practical-education-checklist"],
      ["proof-and-process-behind-the-process", "proof-and-process-proof-point", "proof-and-process-customer-result"],
      ["use-case-and-action-use-case", "use-case-and-action-how-to-apply", "use-case-and-action-next-step"],
      ["brand-trust-brand-values", "brand-trust-quality-standard", "brand-trust-customer-proof"],
    ]);
    expect(bellamy.pillars.map((pillar) => pillar.angles.map(({ id }) => id))).toEqual([
      ["product-proof-material-detail", "product-proof-fit-and-comfort", "product-proof-everyday-use"],
      ["care-and-material-fabric-care", "care-and-material-wash-routine", "care-and-material-durability"],
      ["parent-guidance-how-to-choose", "parent-guidance-common-mistake", "parent-guidance-routine-tip"],
      ["style-and-occasion-minimalist-korean-style", "style-and-occasion-home-to-outing", "style-and-occasion-seasonal-layering"],
      ["brand-trust-behind-the-design", "brand-trust-quality-process", "brand-trust-customer-proof"],
    ]);
    expect(starter.pillars.every((pillar) => pillar.angles.length === 3 && pillar.channels.every((channel) => CHANNELS.includes(channel)) && pillar.angles.every((angle) => angle.channels.every((channel) => CHANNELS.includes(channel))))).toBe(true);
    expect(validateStrategyCatalog(starter).ok).toBe(true);
    expect(validateStrategyCatalog(bellamy).ok).toBe(true);
    expect(JSON.stringify(starter)).not.toBe(JSON.stringify(bellamy));
  });

  it("deep-clones every nested catalog collection and preserves the source", () => {
    const source = bellamyBabyStrategyCatalog(new Date("2026-09-02T00:00:00.000Z"));
    source.pillars[0].angles[0].guidance = "Source guidance";
    source.channelOverrides.facebook = {
      disabledObjectiveKeys: ["conversion"],
      disabledPillarIds: ["brand-trust"],
      disabledAngleIds: ["product-proof-everyday-use"],
      guidanceByAngleId: { "product-proof-material-detail": "Source guidance" },
    };
    const clone = cloneStrategyCatalog(source, "brand-copy", new Date("2026-09-03T00:00:00.000Z"));

    clone.objectives[0].label = "Changed objective";
    clone.pillars[0].angles[0].guidance = "Changed angle";
    clone.channelOverrides.facebook!.disabledObjectiveKeys!.push("reach");
    clone.channelOverrides.facebook!.guidanceByAngleId!["product-proof-material-detail"] = "Changed guidance";

    expect(clone).toMatchObject({ brandId: "brand-copy", version: source.version, updatedAt: "2026-09-03T00:00:00.000Z" });
    expect(source.objectives[0].label).not.toBe("Changed objective");
    expect(source.pillars[0].angles[0].guidance).toBe("Source guidance");
    expect(source.channelOverrides.facebook!.disabledObjectiveKeys).toEqual(["conversion"]);
    expect(source.channelOverrides.facebook!.guidanceByAngleId!["product-proof-material-detail"]).toBe("Source guidance");
  });

  it("rejects malformed IDs, text, objective keys, ordering, channels, recipes, and secret-like values", () => {
    const starter = starterStrategyCatalog("brand-new");
    const cases = [
      { name: "non-kebab pillar id", catalog: { ...starter, pillars: [{ ...starter.pillars[0], id: "Audience Insight" }, ...starter.pillars.slice(1)] } },
      { name: "blank label", catalog: { ...starter, pillars: [{ ...starter.pillars[0], label: "   " }, ...starter.pillars.slice(1)] } },
      { name: "long guidance", catalog: { ...starter, pillars: [{ ...starter.pillars[0], angles: [{ ...starter.pillars[0].angles[0], guidance: "x".repeat(501) }, ...starter.pillars[0].angles.slice(1)] }, ...starter.pillars.slice(1)] } },
      { name: "unknown objective", catalog: { ...starter, objectives: [{ ...starter.objectives[0], key: "unknown" as never }, ...starter.objectives.slice(1)] } },
      { name: "duplicate objective order", catalog: { ...starter, objectives: starter.objectives.map((objective, index) => index === 1 ? { ...objective, order: 1 } : objective) } },
      { name: "objective order does not start at one", catalog: { ...starter, objectives: starter.objectives.map((objective, index) => index === 0 ? { ...objective, order: 2 } : objective) } },
      { name: "duplicate channel", catalog: { ...starter, pillars: [{ ...starter.pillars[0], channels: ["facebook", "facebook"] as never }, ...starter.pillars.slice(1)] } },
      { name: "unknown channel", catalog: { ...starter, pillars: [{ ...starter.pillars[0], channels: ["linkedin"] as never }, ...starter.pillars.slice(1)] } },
      { name: "recipe id", catalog: { ...starter, pillars: [{ ...starter.pillars[0], angles: [{ ...starter.pillars[0].angles[0], recipeId: "bad recipe" }, ...starter.pillars[0].angles.slice(1)] }, ...starter.pillars.slice(1)] } },
      { name: "secret-like value", catalog: { ...starter, pillars: [{ ...starter.pillars[0], angles: [{ ...starter.pillars[0].angles[0], guidance: "Use this password in the prompt" }, ...starter.pillars[0].angles.slice(1)] }, ...starter.pillars.slice(1)] } },
      { name: "missing active angle", catalog: { ...starter, pillars: [{ ...starter.pillars[0], angles: starter.pillars[0].angles.map((angle) => ({ ...angle, enabled: false })) }, ...starter.pillars.slice(1)] } },
      { name: "invalid version", catalog: { ...starter, version: 0 } },
    ];

    for (const testCase of cases) expect(validateStrategyCatalog(testCase.catalog), testCase.name).toMatchObject({ ok: false });
  });

  it("rejects unknown nested catalog fields instead of silently dropping them", () => {
    const catalog = starterStrategyCatalog("brand-new");
    const withUnknown = { ...catalog, pillars: [{ ...catalog.pillars[0], angles: [{ ...catalog.pillars[0].angles[0], unknownField: true }, ...catalog.pillars[0].angles.slice(1)] }, ...catalog.pillars.slice(1)] } as never;
    const withOverrideUnknown = { ...catalog, channelOverrides: { facebook: { disabledObjectiveKeys: ["reach"], unknownField: true } } } as never;
    expect(validateStrategyCatalog(withUnknown).ok).toBe(false);
    expect(validateStrategyCatalog(withOverrideUnknown).ok).toBe(false);
  });

  it("rejects unattached override angles and duplicate IDs across overrides", () => {
    const unattached = starterStrategyCatalog("brand-new");
    unattached.channelOverrides.facebook = {
      addedAnglesByPillarId: { "missing-pillar": [structuredClone(unattached.pillars[0].angles[0])] },
    };
    expect(validateStrategyCatalog(unattached).ok).toBe(false);

    const duplicate = starterStrategyCatalog("brand-new");
    duplicate.channelOverrides.facebook = { addedPillars: [{ ...duplicate.pillars[0], id: "facebook-only", angles: [{ ...duplicate.pillars[0].angles[0], id: "shared-angle" }] }] };
    duplicate.channelOverrides.instagram = { addedAnglesByPillarId: { "audience-insight": [{ ...duplicate.pillars[0].angles[0], id: "shared-angle" }] } };
    expect(validateStrategyCatalog(duplicate).ok).toBe(false);
  });

  it("rejects duplicate override orders and duplicate disabled objective keys", () => {
    const duplicate = starterStrategyCatalog("brand-new");
    duplicate.channelOverrides.facebook = {
      disabledObjectiveKeys: ["reach", "reach"],
      addedPillars: [{ ...duplicate.pillars[0], id: "facebook-only", order: 1 }],
      addedAnglesByPillarId: { "audience-insight": [{ ...duplicate.pillars[0].angles[0], id: "facebook-only-angle", order: 1 }] },
    };
    expect(validateStrategyCatalog(duplicate).ok).toBe(false);
  });

  it.each(["duplicate", "non-starting"] as const)("rejects %s nested angle orders in channel-added pillars", (caseName) => {
    const catalog = starterStrategyCatalog("brand-new");
    const baseAngles = catalog.pillars[0].angles;
    const nestedAngles = baseAngles.map((item, index) => ({
      ...item,
      id: `facebook-only-angle-${index + 1}`,
      order: caseName === "duplicate" ? (index === 1 ? 1 : index + 1) : index + 2,
    }));
    catalog.channelOverrides.facebook = {
      addedPillars: [{ ...catalog.pillars[0], id: "facebook-only", order: 6, angles: nestedAngles }],
    };

    expect(validateStrategyCatalog(catalog).ok).toBe(false);
  });

  it("filters channel scope and overrides into an independent catalog", () => {
    const source = bellamyBabyStrategyCatalog(new Date("2026-09-02T00:00:00.000Z"));
    source.pillars[0].channels = ["instagram"];
    source.pillars[0].angles[0].channels = ["instagram"];
    source.channelOverrides.instagram = {
      disabledObjectiveKeys: ["conversion"],
      disabledPillarIds: ["brand-trust"],
      disabledAngleIds: ["product-proof-everyday-use"],
      addedAnglesByPillarId: { "product-proof": [{ ...source.pillars[0].angles[0], id: "product-proof-reel", order: 4, guidance: "Original addition" }] },
      addedPillars: [{ id: "instagram-only", label: "Instagram only", description: "Channel addition", enabled: true, order: 6, channels: ["instagram"], angles: [{ id: "instagram-only-angle", label: "Quick demo", guidance: "Show one detail", enabled: true, order: 1, channels: ["instagram"] }] }],
      guidanceByAngleId: { "product-proof-material-detail": "Use a close crop" },
    };

    const filtered = catalogForChannel(source, "instagram");
    const productProof = filtered.pillars.find((pillar) => pillar.id === "product-proof");

    expect(filtered.objectives.map(({ key }) => key)).not.toContain("conversion");
    expect(filtered.pillars.map(({ id }) => id)).toEqual(expect.arrayContaining(["product-proof", "instagram-only"]));
    expect(filtered.pillars.map(({ id }) => id)).not.toContain("brand-trust");
    expect(productProof?.angles.map(({ id }) => id)).toEqual(expect.arrayContaining(["product-proof-material-detail", "product-proof-reel"]));
    expect(productProof?.angles.map(({ id }) => id)).not.toContain("product-proof-everyday-use");
    expect(productProof?.angles.find(({ id }) => id === "product-proof-material-detail")?.guidance).toBe("Use a close crop");
    const filteredValidation = validateStrategyCatalog(filtered);
    expect(filteredValidation, JSON.stringify(filteredValidation)).toMatchObject({ ok: false, errors: expect.arrayContaining(["OBJECTIVE_KEY_SET_INVALID"]) });
    expect(() => catalogForChannel(source, "instagram")).not.toThrow();
    expect(source.pillars.map(({ id }) => id)).not.toContain("instagram-only");
    expect(source.pillars[0].angles[0].guidance).not.toBe("Use a close crop");
  });

  it("rejects invalid input and refuses to return an empty effective catalog", () => {
    const invalid = starterStrategyCatalog("brand-new");
    invalid.pillars[0].id = "Invalid Pillar ID";
    expect(() => catalogForChannel(invalid, "facebook")).toThrow("STRATEGY_CATALOG_INVALID");

    const empty = starterStrategyCatalog("brand-new");
    empty.channelOverrides.facebook = {
      disabledObjectiveKeys: [...STRATEGY_OBJECTIVE_KEYS],
      disabledPillarIds: empty.pillars.map(({ id }) => id),
    };
    expect(() => catalogForChannel(empty, "facebook")).toThrow("STRATEGY_CATALOG_INVALID");
  });

  it("rejects cross-channel override references instead of resolving them globally", () => {
    const catalog = starterStrategyCatalog("brand-new");
    const addedAngle = { ...catalog.pillars[0].angles[0], id: "instagram-only-angle", order: 4, guidance: "Instagram addition" };
    catalog.channelOverrides = {
      instagram: { addedAnglesByPillarId: { "audience-insight": [addedAngle] } },
      facebook: { disabledAngleIds: [addedAngle.id], guidanceByAngleId: { [addedAngle.id]: "Cross-channel guidance" } },
    };

    expect(validateStrategyCatalog(catalog).ok).toBe(false);
    expect(() => catalogForChannel(catalog, "facebook")).toThrow("STRATEGY_CATALOG_INVALID");
  });

  it("requires exactly the five canonical objectives for every persisted catalog", () => {
    const missing = starterStrategyCatalog("brand-new");
    missing.objectives = missing.objectives.slice(1);
    expect(validateStrategyCatalog(missing)).toMatchObject({ ok: false, errors: expect.arrayContaining(["OBJECTIVE_KEY_SET_INVALID"]) });

    const duplicate = starterStrategyCatalog("brand-new");
    duplicate.objectives[4] = { ...duplicate.objectives[4], key: "reach" };
    expect(validateStrategyCatalog(duplicate)).toMatchObject({ ok: false, errors: expect.arrayContaining(["OBJECTIVE_KEY_SET_INVALID"]) });

    const valid = starterStrategyCatalog("brand-new");
    expect(validateStrategyCatalog(valid)).toEqual({ ok: true });
  });

  it("produces stable fingerprints and changes them when catalog content changes", () => {
    const timestamp = new Date("2026-09-02T00:00:00.000Z");
    const source = starterStrategyCatalog("brand-new", timestamp);
    const same = starterStrategyCatalog("brand-new", timestamp);
    const changed = cloneStrategyCatalog(source, "brand-new", timestamp);
    changed.pillars[0].angles[0].guidance = "A changed but valid strategy guidance";

    expect(strategyCatalogFingerprint(source)).toMatch(/^[a-f0-9]{64}$/);
    expect(strategyCatalogFingerprint(source)).toBe(strategyCatalogFingerprint(same));
    expect(strategyCatalogFingerprint(source)).not.toBe(strategyCatalogFingerprint(changed));
    expect(strategyCatalogFingerprint(catalogForChannel(source, "facebook"))).toBe(strategyCatalogFingerprint(catalogForChannel(source, "facebook")));
  });

  it("matches JSON persistence for undefined fields and distinguishes UTF-8 astral characters", () => {
    const source = starterStrategyCatalog("brand-new", new Date("2026-09-02T00:00:00.000Z"));
    const explicitUndefined = cloneStrategyCatalog(source, "brand-new", new Date("2026-09-02T00:00:00.000Z"));
    explicitUndefined.pillars[0].angles[0].recipeId = undefined;
    expect(strategyCatalogFingerprint(explicitUndefined)).toBe(strategyCatalogFingerprint(source));

    const grinning = cloneStrategyCatalog(source, "brand-new", new Date("2026-09-02T00:00:00.000Z"));
    const beaming = cloneStrategyCatalog(source, "brand-new", new Date("2026-09-02T00:00:00.000Z"));
    grinning.pillars[0].angles[0].guidance = "Use emoji 😀 in the guidance";
    beaming.pillars[0].angles[0].guidance = "Use emoji 😁 in the guidance";
    expect(strategyCatalogFingerprint(grinning)).not.toBe(strategyCatalogFingerprint(beaming));
  });
});
