import { describe, expect, it } from "vitest";
import { starterStrategyCatalog, type BrandStrategyCatalog } from "./contentStrategy";
import { resolveStrategyForSlot, stableMixSequence } from "./contentStrategyResolver";

function catalog(): BrandStrategyCatalog {
  return starterStrategyCatalog("brand-1", new Date("2026-09-14T00:00:00.000Z"));
}

describe("content strategy resolver", () => {
  it("resolves a specific objective, pillar, and related angle after channel filtering", () => {
    const result = resolveStrategyForSlot({
      catalog: catalog(),
      channel: "instagram",
      selection: { objective: "reach", pillar: "practical-education", angle: "practical-education-step-by-step-guide" },
      slotIndex: 0,
    });

    expect(result).toMatchObject({ ok: true, strategy: {
      objectiveKey: "reach",
      pillarId: "practical-education",
      angleId: "practical-education-step-by-step-guide",
      channel: "instagram",
      strategyVersion: 1,
    } });
  });

  it("rotates every Mix choice by slot index and repeats in stable order", () => {
    const first = resolveStrategyForSlot({ catalog: catalog(), channel: "facebook", selection: { objective: "mix", pillar: "mix", angle: "mix" }, slotIndex: 3 });
    const second = resolveStrategyForSlot({ catalog: catalog(), channel: "facebook", selection: { objective: "mix", pillar: "mix", angle: "mix" }, slotIndex: 3 });

    expect(first).toEqual(second);
    expect(stableMixSequence(["a", "b", "c"], 7)).toEqual(["a", "b", "c", "a", "b", "c", "a"]);
  });

  it("filters Mix pillars by a specific angle and rejects incompatible pairs", () => {
    const compatible = resolveStrategyForSlot({
      catalog: catalog(),
      channel: "tiktok",
      selection: { objective: "engagement", pillar: "mix", angle: "practical-education-common-mistake" },
      slotIndex: 0,
    });
    const incompatible = resolveStrategyForSlot({
      catalog: catalog(),
      channel: "tiktok",
      selection: { objective: "engagement", pillar: "mix", angle: "does-not-exist" },
      slotIndex: 0,
    });

    expect(compatible).toMatchObject({ ok: true, strategy: { pillarId: "practical-education", angleId: "practical-education-common-mistake" } });
    expect(incompatible).toMatchObject({ ok: false, code: "ANGLE_PILLAR_INCOMPATIBLE" });
  });

  it("rejects a disabled channel choice instead of falling back to another item", () => {
    const source = catalog();
    const disabled: BrandStrategyCatalog = {
      ...source,
      channelOverrides: { instagram: { disabledObjectiveKeys: ["reach"] } },
    };

    expect(resolveStrategyForSlot({ catalog: disabled, channel: "instagram", selection: { objective: "reach", pillar: "mix", angle: "mix" }, slotIndex: 0 })).toMatchObject({ ok: false, code: "STRATEGY_OPTION_UNAVAILABLE" });
  });
});
