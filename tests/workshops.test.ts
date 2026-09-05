import { describe, expect, it } from "vitest";
import { experienceForLevel } from "../src/game/experience";
import { ITEMS } from "../src/game/registry";
import {
  ANVIL_ENCHANTMENT_COST,
  getAnvilResult,
  getGrindstoneResult,
  isRepairMaterial,
  MAX_REPAIR_COST,
  nextRepairCost,
  normalizeItemName,
} from "../src/game/workshops";
import type { ItemStack, Slot } from "../src/game/types";

const xp = experienceForLevel(50);
const stack = (id: string, data: Partial<ItemStack> = {}): ItemStack => ({
  id,
  count: 1,
  ...data,
});
const book = (
  enchantments: Record<string, number>,
  data: Partial<ItemStack> = {},
) => stack("enchanted_book", { enchantments, ...data });
const anvil = (
  left: Slot,
  right: Slot = null,
  options: { name?: string; points?: number; creative?: boolean } = {},
) =>
  getAnvilResult(
    left,
    right,
    options.name ?? left?.customName ?? ITEMS[left?.id ?? ""]?.name ?? "",
    options.points ?? xp,
    options.creative ?? false,
  );

describe("anvil input names and arithmetic", () => {
  it("uses a 50 UTF-16-unit cap, permits Chinese and full surrogate pairs, and rejects overlong input", () => {
    expect(normalizeItemName("镐".repeat(50))).toHaveLength(50);
    expect(normalizeItemName("镐".repeat(51))).toBeNull();
    expect(normalizeItemName("⛏️".repeat(25))).toHaveLength(50);
    expect(normalizeItemName("🧱".repeat(25))).toHaveLength(50);
    expect(normalizeItemName("🧱".repeat(26))).toBeNull();
  });
  it("strips ASCII/C1 controls and section signs, retains meaningful surrounding spaces, and clears blank names", () => {
    expect(normalizeItemName("\n\t勇\u0000者\u007f\u0085§之镐")).toBe(
      "勇者之镐",
    );
    expect(normalizeItemName("  勇者之镐  ")).toBe("  勇者之镐  ");
    expect(normalizeItemName("\u00a0\u3000 ")).toBe("");
    expect(normalizeItemName("\ufeff\u3000 ")).toBe("");
    expect(normalizeItemName("a".repeat(50) + "\n")).toHaveLength(50);
  });
  it("grows previous work as 2n+1 with saturated integer arithmetic", () => {
    expect([0, 1, 3, 7, 15].map(nextRepairCost)).toEqual([1, 3, 7, 15, 31]);
    expect(nextRepairCost(MAX_REPAIR_COST)).toBe(MAX_REPAIR_COST);
    expect(nextRepairCost(1_073_741_824)).toBe(MAX_REPAIR_COST);
    for (const value of [-1, 0.5, NaN, Infinity, MAX_REPAIR_COST + 1])
      expect(() => nextRepairCost(value)).toThrow(RangeError);
  });
  it("renames an entire 64-stack for one level without increasing prior work", () => {
    const result = anvil(stack("cobblestone", { count: 64 }), null, {
      name: "地基",
    });
    expect(result).toMatchObject({
      available: true,
      levelCost: 1,
      materialCost: 0,
      output: { id: "cobblestone", count: 64, customName: "地基" },
    });
    expect(result.output?.repairCost).toBeUndefined();
  });
  it("clears a custom name with blank input and leaves default-name no-ops unavailable", () => {
    expect(anvil(stack("diamond_pickaxe"))).toMatchObject({
      available: false,
      output: null,
      levelCost: 0,
    });
    const result = anvil(
      stack("diamond_pickaxe", { customName: "旧名", repairCost: 7 }),
      null,
      { name: "  " },
    );
    expect(result).toMatchObject({
      available: true,
      levelCost: 8,
      output: { repairCost: 7 },
    });
    expect(result.output?.customName).toBeUndefined();
  });
  it("caps rename-only work at 39 levels even at maximum prior work", () => {
    const result = anvil(
      stack("diamond_pickaxe", { repairCost: MAX_REPAIR_COST }),
      null,
      { name: "传家镐" },
    );
    expect(result).toMatchObject({
      available: true,
      levelCost: 39,
      output: { repairCost: MAX_REPAIR_COST },
    });
    expect(
      anvil(stack("diamond_pickaxe", { repairCost: MAX_REPAIR_COST }), null, {
        name: "传家镐",
        points: experienceForLevel(38),
      }),
    ).toMatchObject({ available: false, levelCost: 39 });
  });
  it("retains a concrete output preview while rejecting insufficient level or survival cost 40", () => {
    const left = stack("iron_pickaxe", { durability: 1, repairCost: 31 });
    const result = anvil(left, book({ unbreaking: 3 }, { repairCost: 7 }));
    expect(result).toMatchObject({
      available: false,
      levelCost: 41,
      output: { enchantments: { unbreaking: 3 }, repairCost: 63 },
    });
    expect(result.reason).toContain("过于昂贵");
    const poor = anvil(stack("iron_pickaxe"), book({ unbreaking: 3 }), {
      points: experienceForLevel(2),
    });
    expect(poor).toMatchObject({
      available: false,
      levelCost: 3,
      output: { enchantments: { unbreaking: 3 } },
    });
    expect(poor.reason).toContain("需要 3 级");
  });
  it("allows creative high-cost outputs with zero levels and keeps the numeric cost bounded", () => {
    const result = anvil(
      stack("iron_pickaxe", { repairCost: MAX_REPAIR_COST }),
      book({ unbreaking: 3 }, { repairCost: MAX_REPAIR_COST }),
      { creative: true, points: 0 },
    );
    expect(result).toMatchObject({
      available: true,
      levelCost: MAX_REPAIR_COST,
      output: { repairCost: MAX_REPAIR_COST },
    });
  });
  it("returns explicit invalid previews rather than making malformed stack, XP, or name data usable", () => {
    for (const left of [
      stack("missing"),
      stack("iron_pickaxe", { count: 2 }),
      stack("iron_pickaxe", { durability: 0 }),
      stack("iron_pickaxe", { repairCost: Infinity }),
      stack("iron_pickaxe", { enchantments: { unknown: 1 } }),
      stack("enchanted_book"),
      stack("stone", { customName: "§bad" }),
    ])
      expect(anvil(left, null, { name: "命名" })).toMatchObject({
        available: false,
        output: null,
      });
    expect(
      anvil(stack("iron_pickaxe"), null, { name: "名".repeat(51) }),
    ).toMatchObject({ available: false, output: null });
    for (const points of [NaN, Infinity, -1, MAX_REPAIR_COST + 1])
      expect(
        anvil(stack("iron_pickaxe"), book({ unbreaking: 1 }), { points }),
      ).toMatchObject({ available: false, output: null });
    expect(anvil(null)).toMatchObject({ available: false, output: null });
  });
});

describe("anvil repair and donor consumption", () => {
  it.each([
    ["wood_pickaxe", "planks", 59, 14],
    ["stone_axe", "cobblestone", 131, 32],
    ["stone_hoe", "cobbled_deepslate", 131, 32],
    ["iron_sword", "iron_ingot", 250, 62],
    ["gold_shovel", "gold_ingot", 32, 8],
    ["diamond_pickaxe", "diamond", 1561, 390],
    ["iron_helmet", "iron_ingot", 165, 41],
    ["diamond_chestplate", "diamond", 528, 132],
  ])("repairs %s by floor(max/4) per %s", (id, material, max, quarter) => {
    expect(ITEMS[id].maxDurability).toBe(max);
    const result = anvil(
      stack(id, { durability: 1 }),
      stack(material, { count: 1 }),
    );
    expect(result).toMatchObject({
      available: true,
      materialCost: 1,
      levelCost: 1,
      output: { durability: 1 + quarter, repairCost: 1 },
    });
  });
  it("consumes only the needed material, never the remaining 61 diamonds", () => {
    const result = anvil(
      stack("diamond_pickaxe", {
        durability: 391,
        enchantments: { efficiency: 4 },
        customName: "旧镐",
        repairCost: 3,
      }),
      stack("diamond", { count: 64 }),
    );
    expect(result).toMatchObject({
      available: true,
      levelCost: 6,
      materialCost: 3,
      output: {
        durability: 1561,
        customName: "旧镐",
        enchantments: { efficiency: 4 },
        repairCost: 7,
      },
    });
  });
  it("needs five wood planks to restore a 1/59 tool because quarter durability rounds down", () => {
    expect(
      anvil(
        stack("wood_pickaxe", { durability: 1 }),
        stack("planks", { count: 64 }),
      ),
    ).toMatchObject({
      levelCost: 5,
      materialCost: 5,
      output: { durability: 59 },
    });
  });
  it("refuses material repair for an undamaged tool even when a rename is requested", () => {
    expect(
      anvil(stack("iron_pickaxe"), stack("iron_ingot"), { name: "新名" }),
    ).toMatchObject({ available: false, output: null });
  });
  it("does not mistake logs, ordinary stone, raw iron, or iron ingots for unsupported repairs", () => {
    for (const [target, donor] of [
      ["wood_axe", "log"],
      ["stone_pickaxe", "stone"],
      ["iron_sword", "raw_iron"],
      ["shears", "iron_ingot"],
    ]) {
      expect(isRepairMaterial(target, donor)).toBe(false);
      expect(
        anvil(stack(target, { durability: 1 }), stack(donor)),
      ).toMatchObject({ available: false, output: null });
    }
  });
  it("combines same tools with a 12% maximum durability bonus and a two-level repair charge", () => {
    expect(
      anvil(
        stack("iron_pickaxe", { durability: 10 }),
        stack("iron_pickaxe", { durability: 20 }),
      ),
    ).toMatchObject({
      available: true,
      levelCost: 2,
      materialCost: 1,
      output: { durability: 60, repairCost: 1 },
    });
    expect(
      anvil(
        stack("shears", { durability: 10 }),
        stack("shears", { durability: 20 }),
      ),
    ).toMatchObject({ available: true, output: { durability: 58 } });
  });
  it("charges no repair fee when already full, but still permits an actual enchantment upgrade", () => {
    expect(anvil(stack("iron_pickaxe"), stack("iron_pickaxe"))).toMatchObject({
      available: false,
      output: null,
    });
    expect(
      anvil(
        stack("iron_pickaxe", { enchantments: { unbreaking: 1 } }),
        stack("iron_pickaxe", { enchantments: { unbreaking: 1 } }),
      ),
    ).toMatchObject({
      available: true,
      levelCost: 4,
      output: { enchantments: { unbreaking: 2 } },
    });
  });
  it("a rename-only same-tool operation consumes its donor, includes both prior costs, but does not grow the larger prior", () => {
    const result = anvil(
      stack("iron_pickaxe", { repairCost: 3 }),
      stack("iron_pickaxe", { repairCost: 7 }),
      { name: "合并未修复" },
    );
    expect(result).toMatchObject({
      available: true,
      levelCost: 11,
      materialCost: 1,
      output: { repairCost: 7 },
    });
  });
  it("counts named or enchanted repair materials as materials without transferring their metadata", () => {
    const result = anvil(
      stack("iron_pickaxe", { durability: 20 }),
      stack("iron_ingot", {
        customName: "特殊铁",
        enchantments: { protection: 4 },
        repairCost: 3,
      }),
    );
    expect(result).toMatchObject({
      available: true,
      levelCost: 4,
      output: { durability: 82, repairCost: 7 },
    });
    expect(result.output?.enchantments).toBeUndefined();
    expect(result.output?.customName).toBeUndefined();
  });
});

describe("anvil enchantment combinations", () => {
  it("uses all eight data-driven anvil multipliers and the book half-discount floored to one", () => {
    expect(ANVIL_ENCHANTMENT_COST).toEqual({
      efficiency: 1,
      unbreaking: 2,
      fortune: 4,
      silk_touch: 8,
      sharpness: 1,
      protection: 1,
      feather_falling: 2,
      respiration: 4,
    });
    expect(
      anvil(stack("diamond_pickaxe"), book({ silk_touch: 1 })),
    ).toMatchObject({ levelCost: 4 });
    expect(
      anvil(
        stack("diamond_pickaxe"),
        stack("diamond_pickaxe", { enchantments: { silk_touch: 1 } }),
      ),
    ).toMatchObject({ levelCost: 8 });
    expect(
      anvil(
        stack("diamond_boots"),
        book({ protection: 4, feather_falling: 4, unbreaking: 3 }),
      ),
    ).toMatchObject({ levelCost: 11 });
  });
  it("combines equal levels up to the cap and charges even if a weaker donor cannot raise the target", () => {
    expect(
      anvil(book({ efficiency: 4 }), book({ efficiency: 4 })),
    ).toMatchObject({
      available: true,
      levelCost: 5,
      output: { enchantments: { efficiency: 5 } },
    });
    expect(
      anvil(book({ efficiency: 5 }), book({ efficiency: 2 })),
    ).toMatchObject({
      available: true,
      levelCost: 5,
      output: { enchantments: { efficiency: 5 } },
    });
    expect(
      anvil(book({ efficiency: 5 }), book({ efficiency: 5 })),
    ).toMatchObject({
      available: true,
      levelCost: 5,
      output: { enchantments: { efficiency: 5 } },
    });
  });
  it("combines books from different equipment domains while preserving the left name", () => {
    const result = anvil(
      book({ efficiency: 3 }, { customName: "百科" }),
      book({ protection: 4 }, { customName: "赠书" }),
    );
    expect(result).toMatchObject({
      available: true,
      output: {
        id: "enchanted_book",
        count: 1,
        customName: "百科",
        enchantments: { efficiency: 3, protection: 4 },
      },
    });
  });
  it("keeps applicable parts of a mixed book and ignores unsuitable enchantments without charging them", () => {
    const result = anvil(
      stack("diamond_axe"),
      book({ sharpness: 4, respiration: 3 }),
    );
    expect(result).toMatchObject({
      available: true,
      levelCost: 4,
      output: { enchantments: { sharpness: 4 } },
    });
  });
  it("adds one conflict penalty when another donor enchantment succeeds, but rejects all-conflicting donors", () => {
    const left = stack("diamond_pickaxe", { enchantments: { fortune: 3 } });
    expect(anvil(left, book({ silk_touch: 1, efficiency: 2 }))).toMatchObject({
      available: true,
      levelCost: 3,
      output: { enchantments: { fortune: 3, efficiency: 2 } },
    });
    expect(anvil(left, book({ silk_touch: 1 }))).toMatchObject({
      available: false,
      output: null,
    });
    expect(
      anvil(left, book({ silk_touch: 1 }), { creative: true }),
    ).toMatchObject({ available: false, output: null });
  });
  it("rejects an entirely invalid enchantment donor even if repairing or renaming could otherwise succeed", () => {
    const left = stack("diamond_pickaxe", {
      durability: 100,
      enchantments: { fortune: 3 },
    });
    const right = stack("diamond_pickaxe", {
      durability: 100,
      enchantments: { silk_touch: 1 },
    });
    expect(anvil(left, right, { name: "不会绕过" })).toMatchObject({
      available: false,
      output: null,
    });
  });
  it("supports shear efficiency and axe sharpness through books", () => {
    expect(
      anvil(stack("shears"), book({ efficiency: 5, unbreaking: 3 })),
    ).toMatchObject({
      available: true,
      levelCost: 8,
      output: { enchantments: { efficiency: 5, unbreaking: 3 } },
    });
    expect(anvil(stack("iron_axe"), book({ sharpness: 5 }))).toMatchObject({
      available: true,
      output: { enchantments: { sharpness: 5 } },
    });
  });
  it("does not treat ordinary books as survival anvil targets or enchantment donors", () => {
    expect(anvil(stack("book"), book({ efficiency: 3 }))).toMatchObject({
      available: false,
      output: null,
    });
    expect(
      anvil(
        stack("iron_pickaxe"),
        stack("book", { enchantments: { efficiency: 3 } }),
      ),
    ).toMatchObject({ available: false, output: null });
  });
  it("creative accepts arbitrary items and ordinary books, but does not convert an ordinary book ID", () => {
    expect(
      anvil(stack("book"), book({ efficiency: 3 }), {
        creative: true,
        points: 0,
      }),
    ).toMatchObject({
      available: true,
      levelCost: 3,
      output: { id: "book", enchantments: { efficiency: 3 } },
    });
    expect(
      anvil(stack("cobblestone", { count: 64 }), book({ protection: 4 }), {
        creative: true,
        points: 0,
      }),
    ).toMatchObject({
      available: true,
      levelCost: 40,
      output: { id: "cobblestone", count: 64, enchantments: { protection: 4 } },
    });
  });
  it("does not mutate either input or allow output enchantments to alias the inputs", () => {
    const left = book({ efficiency: 3 }, { customName: "收藏", repairCost: 1 });
    const right = book({ unbreaking: 2 });
    const before = structuredClone([left, right]);
    const first = anvil(left, right);
    expect(anvil(left, right)).toEqual(first);
    first.output!.enchantments!.efficiency = 1;
    expect([left, right]).toEqual(before);
  });
});

describe("grindstone disenchantment and repair", () => {
  it("disenchants one item in either slot, preserves durability/name, and resets prior work", () => {
    const input = stack("diamond_pickaxe", {
      durability: 75,
      enchantments: { efficiency: 4, unbreaking: 3 },
      customName: "勇者之镐",
      repairCost: 31,
    });
    const result = getGrindstoneResult(input, null);
    expect(result).toMatchObject({
      available: true,
      levelCost: 0,
      output: {
        id: "diamond_pickaxe",
        count: 1,
        durability: 75,
        customName: "勇者之镐",
      },
      experienceMin: 26,
      experienceMax: 51,
    });
    expect(result.output?.enchantments).toBeUndefined();
    expect(result.output?.repairCost).toBeUndefined();
    expect(getGrindstoneResult(null, input).output).toEqual(result.output);
  });
  it("returns no single-item output for a plain damaged, renamed, or previously worked item", () => {
    expect(
      getGrindstoneResult(
        stack("iron_pickaxe", {
          durability: 1,
          customName: "旧名",
          repairCost: 31,
        }),
        null,
      ),
    ).toMatchObject({ available: false, output: null });
    expect(getGrindstoneResult(null, null)).toMatchObject({
      available: false,
      output: null,
    });
  });
  it("repairs two identical tools with a floor(5% max) bonus and no levels or XP for unenchanted inputs", () => {
    expect(
      getGrindstoneResult(
        stack("iron_pickaxe", { durability: 10 }),
        stack("iron_pickaxe", { durability: 20 }),
      ),
    ).toMatchObject({
      available: true,
      output: { durability: 42, count: 1 },
      experienceMin: 0,
      experienceMax: 0,
      levelCost: 0,
    });
    expect(
      getGrindstoneResult(
        stack("shears", { durability: 10 }),
        stack("shears", { durability: 20 }),
      ),
    ).toMatchObject({ available: true, output: { durability: 41 } });
  });
  it("caps repaired durability at maximum, including two full tools", () => {
    expect(
      getGrindstoneResult(stack("diamond_pickaxe"), stack("diamond_pickaxe")),
    ).toMatchObject({
      available: true,
      output: { durability: 1561, count: 1 },
    });
  });
  it("keeps only the left custom name, clears both sets of enchantments, and resets prior work", () => {
    const result = getGrindstoneResult(
      stack("iron_pickaxe", {
        durability: 1,
        customName: "左",
        repairCost: 31,
        enchantments: { fortune: 3 },
      }),
      stack("iron_pickaxe", {
        durability: 1,
        customName: "右",
        repairCost: 31,
        enchantments: { silk_touch: 1 },
      }),
    );
    expect(result).toMatchObject({
      available: true,
      output: { customName: "左", durability: 14 },
    });
    expect(result.output?.repairCost).toBeUndefined();
    expect(result.output?.enchantments).toBeUndefined();
    expect(
      getGrindstoneResult(
        stack("iron_pickaxe"),
        stack("iron_pickaxe", { customName: "右" }),
      ).output?.customName,
    ).toBeUndefined();
  });
  it("XP uses both inputs and counts repeated enchantments separately", () => {
    const input = stack("diamond_pickaxe", { enchantments: { efficiency: 5 } });
    expect(getGrindstoneResult(input, input)).toMatchObject({
      experienceMin: 41,
      experienceMax: 81,
    });
  });
  it("XP reward range is ceil(sum/2) through 2ceil(sum/2)-1, inclusive", () => {
    expect(getGrindstoneResult(book({ efficiency: 1 }), null)).toMatchObject({
      experienceMin: 1,
      experienceMax: 1,
    });
    expect(getGrindstoneResult(book({ respiration: 1 }), null)).toMatchObject({
      experienceMin: 5,
      experienceMax: 9,
    });
    expect(getGrindstoneResult(book({ efficiency: 5 }), null)).toMatchObject({
      experienceMin: 21,
      experienceMax: 41,
    });
  });
  it("turns one enchanted book into one ordinary book and keeps its custom name", () => {
    const result = getGrindstoneResult(
      book({ protection: 4 }, { customName: "纪念书", repairCost: 63 }),
      null,
    );
    expect(result.output).toEqual({
      id: "book",
      count: 1,
      customName: "纪念书",
    });
    expect(
      getGrindstoneResult(book({ protection: 4 }), book({ protection: 4 })),
    ).toMatchObject({ available: false, output: null });
  });
  it("permits two identical creative-enchanted stackable items and preserves the count after disenchantment", () => {
    const input = stack("cobblestone", {
      enchantments: { protection: 1 },
      customName: "魔石",
    });
    expect(getGrindstoneResult(input, structuredClone(input))).toMatchObject({
      available: true,
      output: { id: "cobblestone", count: 2, customName: "魔石" },
      experienceMin: 1,
      experienceMax: 1,
    });
    expect(
      getGrindstoneResult(input, { ...input, customName: "不同" }),
    ).toMatchObject({ available: false, output: null });
    expect(
      getGrindstoneResult(input, { ...input, enchantments: { protection: 2 } }),
    ).toMatchObject({ available: false, output: null });
  });
  it("rejects stack inputs, mismatched items, ordinary blocks, and invalid metadata", () => {
    expect(
      getGrindstoneResult(
        stack("book", { count: 2, enchantments: { efficiency: 1 } }),
        null,
      ),
    ).toMatchObject({ available: false, output: null });
    expect(
      getGrindstoneResult(stack("iron_pickaxe"), stack("stone_pickaxe")),
    ).toMatchObject({ available: false, output: null });
    expect(
      getGrindstoneResult(stack("cobblestone"), stack("cobblestone")),
    ).toMatchObject({ available: false, output: null });
    expect(
      getGrindstoneResult(
        stack("iron_pickaxe", { enchantments: { unbreaking: 4 } }),
        null,
      ),
    ).toMatchObject({ available: false, output: null });
  });
  it("does not mutate the inputs while repeatedly previewing repairs", () => {
    const left = stack("iron_pickaxe", {
      durability: 5,
      customName: "左",
      enchantments: { efficiency: 5 },
      repairCost: 31,
    });
    const right = stack("iron_pickaxe", {
      durability: 10,
      enchantments: { unbreaking: 3 },
    });
    const before = structuredClone([left, right]);
    const result = getGrindstoneResult(left, right);
    expect(getGrindstoneResult(left, right)).toEqual(result);
    result.output!.durability = 1;
    expect([left, right]).toEqual(before);
  });
});
