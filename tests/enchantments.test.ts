import { describe, expect, it } from "vitest";
import {
  ENCHANTMENTS,
  canApplyEnchantment,
  canOfferEnchantment,
  consumesOxygen,
  durabilityConsumed,
  efficiencySpeed,
  enchantability,
  enchantmentDamageMultiplier,
  enchantmentLevel,
  fortuneDropCount,
  sharpnessBonus,
  silkTouchDrop,
  validateEnchantments,
} from "../src/game/enchantments";
import type { ItemStack } from "../src/game/types";
import baseline from "../docs/parity/sources/data__pc__1.21.1__enchantments.json";
const stack = (
  id: string,
  enchantments: Record<string, number> = {},
): ItemStack => ({
  id,
  count: 1,
  ...(Object.keys(enchantments).length ? { enchantments } : {}),
});
describe("eight supported Java enchantments", () => {
  it("locks caps, weights and cost ranges to the pinned 1.21.1 data", () => {
    expect(Object.keys(ENCHANTMENTS)).toHaveLength(8);
    for (const definition of Object.values(ENCHANTMENTS)) {
      const reference = baseline.find((value) => value.name === definition.id)!;
      expect(definition).toMatchObject({
        maxLevel: reference.maxLevel,
        weight: reference.weight,
        minCost: reference.minCost,
        maxCost: reference.maxCost,
      });
      expect(definition.incompatible).toEqual(
        reference.exclude.filter((id) => Object.hasOwn(ENCHANTMENTS, id)),
      );
    }
  });
  it("distinguishes supported items from Java table primary items", () => {
    expect(canApplyEnchantment("shears", "efficiency")).toBe(true);
    expect(canOfferEnchantment("shears", "efficiency")).toBe(false);
    expect(canApplyEnchantment("iron_axe", "sharpness")).toBe(true);
    expect(canOfferEnchantment("iron_axe", "sharpness")).toBe(false);
    expect(canOfferEnchantment("iron_sword", "sharpness")).toBe(true);
    expect(canOfferEnchantment("iron_hoe", "fortune")).toBe(true);
    expect(canApplyEnchantment("iron_sword", "fortune")).toBe(false);
    expect(canApplyEnchantment("iron_boots", "respiration")).toBe(false);
    expect(canApplyEnchantment("iron_helmet", "respiration")).toBe(true);
  });
  it("rejects unknown, incompatible, out-of-range, inherited, and wrong-equipment data", () => {
    for (const value of [
      null,
      [],
      {},
      { fortune: 0 },
      { fortune: 4 },
      { fortune: 1.5 },
      { fortune: NaN },
      { fortune: "3" },
      { mending: 1 },
      { fortune: 3, silk_touch: 1 },
      Object.create({ fortune: 3 }),
      JSON.parse('{"__proto__":1}'),
    ])
      expect(validateEnchantments("diamond_pickaxe", value)).toBe(false);
    expect(
      validateEnchantments("diamond_pickaxe", {
        efficiency: 5,
        fortune: 3,
        unbreaking: 3,
      }),
    ).toBe(true);
    expect(validateEnchantments("diamond_sword", { efficiency: 5 })).toBe(
      false,
    );
    expect(
      validateEnchantments("diamond_boots", {
        protection: 4,
        feather_falling: 4,
        unbreaking: 3,
      }),
    ).toBe(true);
    expect(validateEnchantments("stone", { unbreaking: 3 })).toBe(false);
  });
  it("preserves material-specific enchantability without confusing mining tier", () => {
    expect(
      [
        "wood_pickaxe",
        "stone_pickaxe",
        "iron_pickaxe",
        "gold_pickaxe",
        "diamond_pickaxe",
      ].map(enchantability),
    ).toEqual([15, 5, 14, 22, 10]);
    expect(
      ["iron_helmet", "gold_chestplate", "diamond_boots"].map(enchantability),
    ).toEqual([9, 25, 10]);
    expect(enchantability("shears")).toBe(0);
    expect(enchantability("book")).toBe(0);
  });
});
describe("observable enchantment effects", () => {
  it("Efficiency V adds 26 to effective mining speed, leaving unsuitable tool speed alone", () => {
    const tool = stack("diamond_pickaxe", { efficiency: 5 });
    expect(efficiencySpeed(8, tool)).toBe(34);
    expect(efficiencySpeed(1, tool)).toBe(1);
    expect(efficiencySpeed(8, stack("diamond_pickaxe"))).toBe(8);
    expect(
      enchantmentLevel(stack("stone", { efficiency: 5 }), "efficiency"),
    ).toBe(0);
  });
  it("Unbreaking III consumes 1/4 tool durability and 70% armor durability", () => {
    const tool = stack("diamond_pickaxe", { unbreaking: 3 });
    expect(
      durabilityConsumed(
        tool,
        4,
        (() => {
          let n = 0;
          return () => n++ / 4;
        })(),
      ),
    ).toBe(1);
    let state = 12345;
    const random = () =>
      (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    expect(
      durabilityConsumed(
        stack("diamond_chestplate", { unbreaking: 3 }),
        100000,
        random,
      ),
    ).toBeGreaterThan(69500);
    state = 12345;
    expect(
      durabilityConsumed(
        stack("diamond_chestplate", { unbreaking: 3 }),
        100000,
        random,
      ),
    ).toBeLessThan(70500);
    expect(durabilityConsumed(stack("iron_sword"), 7, random)).toBe(7);
  });
  it("Fortune III gives ore multipliers 1,1,2,3,4 and redstone an additive bonus", () => {
    const pick = stack("diamond_pickaxe", { fortune: 3 });
    expect(
      [0, 0.2, 0.4, 0.6, 0.8].map((r) =>
        fortuneDropCount(88, 1, pick, () => r),
      ),
    ).toEqual([1, 1, 2, 3, 4]);
    expect(fortuneDropCount(94, 5, pick, () => 0.99)).toBe(20);
    expect(fortuneDropCount(96, 5, pick, () => 0.99)).toBe(8);
    expect(fortuneDropCount(104, 1, pick, () => 0.99)).toBe(1);
    expect(
      fortuneDropCount(
        88,
        1,
        stack("diamond_pickaxe", { fortune: 3, silk_touch: 1 }),
        () => 0.99,
      ),
    ).toBe(1);
  });
  it("Silk Touch obtains blocks, still requiring a sufficient mining tier", () => {
    const pick = stack("diamond_pickaxe", { silk_touch: 1 });
    expect(silkTouchDrop(88, pick)).toEqual({ id: "diamond_ore", count: 1 });
    expect(silkTouchDrop(98, pick)).toEqual({
      id: "deepslate_diamond_ore",
      count: 1,
    });
    expect(silkTouchDrop(3, pick)).toEqual({ id: "stone", count: 1 });
    expect(silkTouchDrop(17, pick)).toEqual({ id: "glass", count: 1 });
    expect(silkTouchDrop(82, pick)).toEqual({ id: "leaves", count: 1 });
    expect(silkTouchDrop(113, pick)).toEqual({ id: "bookshelf", count: 1 });
    expect(
      silkTouchDrop(88, stack("gold_pickaxe", { silk_touch: 1 })),
    ).toBeNull();
    expect(silkTouchDrop(88, stack("diamond_pickaxe"))).toBeNull();
    expect(silkTouchDrop(6, pick)).toBeNull();
  });
  it("Sharpness uses the Java additive damage formula", () => {
    expect(sharpnessBonus(stack("iron_sword", { sharpness: 1 }))).toBe(1);
    expect(sharpnessBonus(stack("diamond_sword", { sharpness: 5 }))).toBe(3);
    expect(sharpnessBonus(stack("diamond_pickaxe", { sharpness: 5 }))).toBe(0);
  });
  it("Protection and Feather Falling combine up to 80%, after armor", () => {
    const armor = ["helmet", "chestplate", "leggings", "boots"].map((part) =>
      stack(`diamond_${part}`, { protection: 4 }),
    );
    expect(enchantmentDamageMultiplier(armor, "other")).toBeCloseTo(0.36);
    armor[3]!.enchantments!.feather_falling = 4;
    expect(enchantmentDamageMultiplier(armor, "fall")).toBeCloseTo(0.2);
    expect(
      enchantmentDamageMultiplier(
        [stack("iron_boots", { feather_falling: 4 })],
        "fall",
      ),
    ).toBeCloseTo(0.52);
    expect(enchantmentDamageMultiplier(armor, "bypass")).toBe(1);
  });
  it("Respiration III consumes oxygen on one of four ordinary depletion ticks", () => {
    const helmet = stack("iron_helmet", { respiration: 3 });
    expect(
      [0, 0.25, 0.5, 0.75].map((r) => consumesOxygen(helmet, () => r)),
    ).toEqual([true, false, false, false]);
    expect(consumesOxygen(null, () => 0.99)).toBe(true);
    expect(
      consumesOxygen(stack("iron_boots", { respiration: 3 }), () => 0.99),
    ).toBe(true);
  });
});
