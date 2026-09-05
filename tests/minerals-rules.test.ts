import { describe, expect, it } from "vitest";
import {
  addItem,
  clickInventorySlot,
  countItem,
  createInventory,
} from "../src/game/inventory";
import {
  canCraft,
  consumeRecipe,
  craftFromInventory,
  matchRecipe,
  RECIPES,
  recipeIngredients,
  SMELTING,
} from "../src/game/recipes";
import { BLOCKS, ITEMS } from "../src/game/registry";
import type { Slot } from "../src/game/types";

const recipe = (id: string) => {
  const result = RECIPES.find((entry) => entry.id === id);
  if (!result) throw new Error(`Missing recipe: ${id}`);
  return result;
};
const compressed = [
  ["copper_block", "copper_ingot"],
  ["gold_block", "gold_ingot"],
  ["redstone_block", "redstone"],
  ["lapis_block", "lapis_lazuli"],
  ["diamond_block", "diamond"],
  ["emerald_block", "emerald"],
  ["iron_block", "iron_ingot"],
  ["coal_block", "coal"],
  ["raw_iron_block", "raw_iron"],
  ["raw_copper_block", "raw_copper"],
  ["raw_gold_block", "raw_gold"],
] as const;
const minerals = [
  ["coal", "coal", "coal", 1, [1, 1]],
  ["iron", "raw_iron", "iron_ingot", 2, [1, 1]],
  ["copper", "raw_copper", "copper_ingot", 2, [2, 5]],
  ["gold", "raw_gold", "gold_ingot", 3, [1, 1]],
  ["redstone", "redstone", "redstone", 3, [4, 5]],
  ["lapis", "lapis_lazuli", "lapis_lazuli", 2, [4, 9]],
  ["diamond", "diamond", "diamond", 3, [1, 1]],
  ["emerald", "emerald", "emerald", 3, [1, 1]],
] as const;

describe("mineral definition and save identity contracts", () => {
  it("preserves old boundary IDs and assigns every new block its fixed ID", () => {
    expect(BLOCKS[9].key).toBe("coal_ore");
    expect(BLOCKS[10].key).toBe("iron_ore");
    expect(BLOCKS[81].key).toBe("obsidian");
    expect(BLOCKS[82].key).toBe("persistent_leaves");
    expect(BLOCKS[83].key).toBe("oak_sapling");
    const keys = [
      "copper_ore",
      "gold_ore",
      "redstone_ore",
      "lapis_ore",
      "diamond_ore",
      "emerald_ore",
      "deepslate",
      "cobbled_deepslate",
      "deepslate_coal_ore",
      "deepslate_iron_ore",
      "deepslate_copper_ore",
      "deepslate_gold_ore",
      "deepslate_redstone_ore",
      "deepslate_lapis_ore",
      "deepslate_diamond_ore",
      "deepslate_emerald_ore",
      ...compressed.map(([block]) => block),
    ];
    keys.forEach((key, index) => {
      expect(BLOCKS[84 + index].key).toBe(key);
      expect(ITEMS[key]).toMatchObject({
        block: 84 + index,
        maxStack: 64,
        introducedVersion: 4,
      });
    });
    expect(new Set(Object.values(BLOCKS).map((block) => block.key)).size).toBe(
      Object.keys(BLOCKS).length,
    );
  });

  it("marks all 55 new items as v4 without changing legacy item availability", () => {
    const introduced = Object.values(ITEMS).filter(
      (item) => item.introducedVersion === 4,
    );
    expect(introduced).toHaveLength(55);
    for (const id of [
      "raw_copper",
      "raw_gold",
      "copper_ingot",
      "gold_ingot",
      "redstone",
      "lapis_lazuli",
      "diamond",
      "emerald",
      "gold_nugget",
      "iron_nugget",
    ])
      expect(ITEMS[id]).toMatchObject({
        id,
        maxStack: 64,
        introducedVersion: 4,
      });
    for (const id of [
      "coal",
      "raw_iron",
      "iron_ingot",
      "iron_pickaxe",
      "iron_helmet",
      "obsidian",
      "oak_sapling",
      "lava_bucket",
    ])
      expect(ITEMS[id].introducedVersion).toBeUndefined();
  });

  it.each(minerals)(
    "%s ore and its deep variant keep the same harvest gate and resource yield",
    (mineral, drop, _smelted, tier, drops) => {
      const normal = BLOCKS[ITEMS[`${mineral}_ore`].block!];
      const deep = BLOCKS[ITEMS[`deepslate_${mineral}_ore`].block!];
      for (const block of [normal, deep]) {
        expect(block).toMatchObject({ tool: "pickaxe", tier, drop });
        expect(block.dropCount ?? [1, 1]).toEqual(drops);
        expect(ITEMS[block.drop!]).toBeDefined();
      }
      expect(normal.hardness).toBe(3);
      expect(deep.hardness).toBe(4.5);
    },
  );

  it("allows an appropriate pickaxe to reclaim compressed blocks and keeps coal fuel separate from charcoal", () => {
    for (const [key] of compressed) {
      const block = BLOCKS[ITEMS[key].block!];
      expect(block.drop).toBe(key);
      expect(block.tool).toBe("pickaxe");
      expect(block.tier).toBeGreaterThanOrEqual(1);
      expect(block.tier).toBeLessThanOrEqual(ITEMS.iron_pickaxe.tier!);
    }
    expect(BLOCKS[102].tier).toBe(1);
    expect(ITEMS.coal_block.fuel).toBe(800);
    expect(recipeIngredients(recipe("coal_block"))).toEqual({ coal: 9 });
    const charcoal: Slot[] = [{ id: "charcoal", count: 9 }];
    expect(craftFromInventory(recipe("coal_block"), charcoal)).toBe(false);
    expect(charcoal).toEqual([{ id: "charcoal", count: 9 }]);
  });
});

describe("gold and diamond equipment", () => {
  it.each([
    ["wood", 1, 2, 59],
    ["stone", 2, 4, 131],
    ["iron", 3, 6, 250],
    ["gold", 1, 12, 32],
    ["diamond", 4, 8, 1561],
  ] as const)(
    "%s tool speed, harvest tier and durability remain independent",
    (material, tier, miningSpeed, maxDurability) => {
      for (const tool of ["pickaxe", "axe", "shovel", "sword", "hoe"]) {
        const id = `${material}_${tool}`;
        expect(ITEMS[id]).toMatchObject({
          tool,
          tier,
          miningSpeed,
          maxDurability,
          maxStack: 1,
        });
        expect(recipe(id).output).toEqual({ id, count: 1 });
      }
    },
  );

  it("a faster gold pick cannot harvest iron, while a diamond pick can collect obsidian", () => {
    expect(ITEMS.gold_pickaxe.miningSpeed).toBeGreaterThan(
      ITEMS.diamond_pickaxe.miningSpeed!,
    );
    expect(ITEMS.gold_pickaxe.tier).toBeLessThan(BLOCKS[10].tier!);
    expect(ITEMS.iron_pickaxe.tier).toBeLessThan(BLOCKS[81].tier!);
    expect(ITEMS.diamond_pickaxe.tier).toBe(BLOCKS[81].tier);
  });

  it.each([
    ["gold", [2, 5, 3, 1], [77, 112, 105, 91], 0],
    ["diamond", [3, 8, 6, 3], [363, 528, 495, 429], 2],
  ] as const)(
    "%s armor has a complete slot set with its own protection and toughness",
    (material, points, durability, toughness) => {
      const pieces = ["helmet", "chestplate", "leggings", "boots"];
      const slots = ["head", "chest", "legs", "feet"];
      pieces.forEach((piece, index) => {
        const item = ITEMS[`${material}_${piece}`];
        expect(item).toMatchObject({
          armorSlot: slots[index],
          armorPoints: points[index],
          maxDurability: durability[index],
          maxStack: 1,
          introducedVersion: 4,
        });
        expect(item.armorToughness ?? 0).toBe(toughness);
      });
    },
  );

  it.each([
    ["gold", "gold_ingot"],
    ["diamond", "diamond"],
  ] as const)(
    "crafts the full %s set from exactly 35 resources and 9 sticks",
    (material, resource) => {
      const inventory = createInventory();
      addItem(inventory, { id: resource, count: 35 });
      addItem(inventory, { id: "stick", count: 9 });
      const equipment = [
        "pickaxe",
        "axe",
        "shovel",
        "sword",
        "hoe",
        "helmet",
        "chestplate",
        "leggings",
        "boots",
      ];
      for (const piece of equipment) {
        const id = `${material}_${piece}`;
        expect(craftFromInventory(recipe(id), inventory)).toBe(true);
        expect(inventory.find((stack) => stack?.id === id)).toEqual({
          id,
          count: 1,
          durability: ITEMS[id].maxDurability,
        });
      }
      expect(countItem(inventory, resource)).toBe(0);
      expect(countItem(inventory, "stick")).toBe(0);
      expect(inventory.filter(Boolean)).toHaveLength(9);
    },
  );

  it("does not partially spend diamonds when missing sticks or space for the crafted tool", () => {
    const missing: Slot[] = [
      { id: "diamond", count: 3 },
      { id: "stick", count: 1 },
      null,
    ];
    const missingBefore = structuredClone(missing);
    expect(craftFromInventory(recipe("diamond_pickaxe"), missing)).toBe(false);
    expect(missing).toEqual(missingBefore);
    const full: Slot[] = [
      { id: "diamond", count: 4 },
      { id: "stick", count: 3 },
    ];
    const fullBefore = structuredClone(full);
    expect(canCraft(recipe("diamond_pickaxe"), full)).toBe(false);
    expect(craftFromInventory(recipe("diamond_pickaxe"), full)).toBe(false);
    expect(full).toEqual(fullBefore);
  });

  it("rejects mixed-metal armor and accepts a mirrored diamond axe without altering its materials", () => {
    const armor: Slot[] = [
      { id: "gold_ingot", count: 1 },
      { id: "iron_ingot", count: 1 },
      { id: "gold_ingot", count: 1 },
      { id: "gold_ingot", count: 1 },
      null,
      { id: "gold_ingot", count: 1 },
      null,
      null,
      null,
    ];
    const before = structuredClone(armor);
    expect(consumeRecipe(armor, 3)).toBeNull();
    expect(armor).toEqual(before);
    const axe: Slot[] = [
      null,
      { id: "diamond", count: 1 },
      { id: "diamond", count: 1 },
      null,
      { id: "stick", count: 1 },
      { id: "diamond", count: 1 },
      null,
      { id: "stick", count: 1 },
      null,
    ];
    expect(consumeRecipe(axe, 3)).toEqual({
      id: "diamond_axe",
      count: 1,
      durability: 1561,
    });
    expect(axe.every((slot) => slot === null)).toBe(true);
  });
});

describe("mineral crafting conserves resources", () => {
  it.each(compressed)(
    "compresses and unpacks %s across multiple stacks without changing totals",
    (block, material) => {
      const inventory = createInventory();
      addItem(inventory, { id: material, count: 81 });
      addItem(inventory, { id: "stick", count: 19 });
      for (let i = 0; i < 9; i++)
        expect(craftFromInventory(recipe(block), inventory)).toBe(true);
      expect(countItem(inventory, block)).toBe(9);
      expect(countItem(inventory, material)).toBe(0);
      for (let i = 0; i < 9; i++)
        expect(craftFromInventory(recipe(`${block}_unpack`), inventory)).toBe(
          true,
        );
      expect(countItem(inventory, block)).toBe(0);
      expect(countItem(inventory, material)).toBe(81);
      expect(countItem(inventory, "stick")).toBe(19);
      expect(
        inventory.every(
          (stack) => !stack || stack.count <= ITEMS[stack.id].maxStack,
        ),
      ).toBe(true);
    },
  );

  it.each(["iron", "gold"] as const)(
    "converts %s nuggets through ingots and a block then back without loss",
    (metal) => {
      const inventory = createInventory();
      addItem(inventory, { id: `${metal}_nugget`, count: 81 });
      for (let i = 0; i < 9; i++)
        expect(
          craftFromInventory(recipe(`${metal}_ingot_from_nuggets`), inventory),
        ).toBe(true);
      expect(craftFromInventory(recipe(`${metal}_block`), inventory)).toBe(
        true,
      );
      expect(inventory.filter(Boolean)).toEqual([
        { id: `${metal}_block`, count: 1 },
      ]);
      expect(
        craftFromInventory(recipe(`${metal}_block_unpack`), inventory),
      ).toBe(true);
      for (let i = 0; i < 9; i++)
        expect(craftFromInventory(recipe(`${metal}_nugget`), inventory)).toBe(
          true,
        );
      expect(countItem(inventory, `${metal}_nugget`)).toBe(81);
      expect(countItem(inventory, `${metal}_ingot`)).toBe(0);
      expect(countItem(inventory, `${metal}_block`)).toBe(0);
    },
  );

  it("requires nine separate grid cells for a block and permits unpacking in a shifted 2×2 cell", () => {
    const single: Slot[] = [null, null, null, { id: "diamond", count: 9 }];
    expect(matchRecipe(single, 2)).toBeNull();
    const block: Slot[] = [null, null, null, { id: "diamond_block", count: 2 }];
    expect(consumeRecipe(block, 2)).toEqual({ id: "diamond", count: 9 });
    expect(block[3]).toEqual({ id: "diamond_block", count: 1 });
    const fullGrid: Slot[] = Array.from({ length: 9 }, () => ({
      id: "diamond",
      count: 2,
    }));
    expect(consumeRecipe(fullGrid, 3)).toEqual({
      id: "diamond_block",
      count: 1,
    });
    expect(fullGrid.every((slot) => slot?.count === 1)).toBe(true);
  });

  it("keeps blocks untouched when unpacked materials cannot fit", () => {
    const inventory: Slot[] = [
      { id: "diamond_block", count: 2 },
      { id: "diamond", count: 60 },
    ];
    const before = structuredClone(inventory);
    expect(craftFromInventory(recipe("diamond_block_unpack"), inventory)).toBe(
      false,
    );
    expect(inventory).toEqual(before);
  });

  it("stacks new resources up to 64 but preserves individually worn gold and diamond tools", () => {
    const resources: Slot[] = [{ id: "raw_copper", count: 63 }, null];
    expect(addItem(resources, { id: "raw_copper", count: 67 })).toEqual({
      id: "raw_copper",
      count: 2,
    });
    expect(resources).toEqual([
      { id: "raw_copper", count: 64 },
      { id: "raw_copper", count: 64 },
    ]);
    const tools: Slot[] = [
      { id: "gold_pickaxe", count: 1, durability: 4 },
      null,
      null,
    ];
    addItem(tools, { id: "gold_pickaxe", count: 1 });
    addItem(tools, { id: "diamond_pickaxe", count: 1, durability: 918 });
    let cursor = clickInventorySlot(tools, 2, null, false);
    cursor = clickInventorySlot(tools, 0, cursor, false);
    expect(tools[0]).toEqual({
      id: "diamond_pickaxe",
      count: 1,
      durability: 918,
    });
    expect(tools[1]).toEqual({ id: "gold_pickaxe", count: 1, durability: 32 });
    expect(cursor).toEqual({ id: "gold_pickaxe", count: 1, durability: 4 });
  });

  it("supports a furnace and stone tools made from deep cave rock without replacing old recipes", () => {
    const inventory = createInventory();
    addItem(inventory, { id: "cobbled_deepslate", count: 11 });
    addItem(inventory, { id: "stick", count: 2 });
    expect(craftFromInventory(recipe("furnace_deepslate"), inventory)).toBe(
      true,
    );
    expect(
      craftFromInventory(recipe("stone_pickaxe_deepslate"), inventory),
    ).toBe(true);
    expect(countItem(inventory, "cobbled_deepslate")).toBe(0);
    expect(countItem(inventory, "furnace")).toBe(1);
    expect(countItem(inventory, "stone_pickaxe")).toBe(1);
    expect(recipeIngredients(recipe("furnace"))).toEqual({ cobblestone: 8 });
    expect(recipeIngredients(recipe("stone_pickaxe"))).toEqual({
      cobblestone: 3,
      stick: 2,
    });
  });
});

describe("mineral furnace recipes", () => {
  it.each(minerals)(
    "smelts normal and deep %s ore to one product rather than its mining yield",
    (mineral, _raw, product) => {
      expect(SMELTING[`${mineral}_ore`]).toEqual({ output: product, count: 1 });
      expect(SMELTING[`deepslate_${mineral}_ore`]).toEqual({
        output: product,
        count: 1,
      });
    },
  );

  it("smelts raw metals and deepslate while avoiding a compressed-block shortcut", () => {
    for (const metal of ["iron", "copper", "gold"]) {
      expect(SMELTING[`raw_${metal}`]).toEqual({
        output: `${metal}_ingot`,
        count: 1,
      });
      expect(SMELTING[`raw_${metal}_block`]).toBeUndefined();
    }
    expect(SMELTING.cobbled_deepslate).toEqual({
      output: "deepslate",
      count: 1,
    });
    expect(SMELTING.log).toEqual({ output: "charcoal", count: 1 });
  });

  it("all new recipe IDs are unique and every smelting input/output is a registered item", () => {
    expect(new Set(RECIPES.map((entry) => entry.id)).size).toBe(RECIPES.length);
    for (const [input, { output, count }] of Object.entries(SMELTING)) {
      expect(ITEMS[input]).toBeDefined();
      expect(ITEMS[output]).toBeDefined();
      expect(
        Number.isInteger(count) && count > 0 && count <= ITEMS[output].maxStack,
      ).toBe(true);
    }
    expect(ITEMS.golden_apple).toBeUndefined();
  });
});
