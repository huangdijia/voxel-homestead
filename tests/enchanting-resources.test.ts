import { describe, expect, it } from "vitest";
import { BLOCKS, ITEMS, ENTITIES, COW_DROP_RANGES } from "../src/game/registry";
import {
  RECIPES,
  SMELTING,
  consumeRecipe,
  matchRecipe,
  recipeIngredients,
  craftFromInventory,
} from "../src/game/recipes";
import type { Slot } from "../src/game/types";

const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;
const stack = (id: string, count = 1): Slot => ({ id, count });

describe("survival resources for enchanting", () => {
  it("registers the three fixed block IDs and all eight version 6 items", () => {
    for (const [id, name] of [
      [111, "sugar_cane"],
      [112, "enchanting_table"],
      [113, "bookshelf"],
    ] as const) {
      expect(BLOCKS[id].key).toBe(name);
      expect(ITEMS[name].block).toBe(id);
    }
    for (const id of [
      "sugar_cane",
      "paper",
      "leather",
      "book",
      "enchanting_table",
      "bookshelf",
      "raw_beef",
      "cooked_beef",
    ])
      expect(ITEMS[id]).toMatchObject({
        id,
        maxStack: 64,
        introducedVersion: 6,
      });
    expect(BLOCKS[111]).toMatchObject({
      solid: false,
      opaque: false,
      hardness: 0,
      drop: "sugar_cane",
    });
    expect(BLOCKS[112]).toMatchObject({
      solid: true,
      opaque: false,
      hardness: 5,
      tool: "pickaxe",
      tier: 1,
      shape: "enchanting_table",
    });
    expect(BLOCKS[113]).toMatchObject({
      solid: true,
      drop: "book",
      dropCount: [3, 3],
      tool: "axe",
    });
  });
  it("defines adult cow base ranges and edible beef with a furnace recipe", () => {
    expect(ENTITIES.cow).toMatchObject({
      health: 10,
      hostile: false,
      kind: "cow",
    });
    expect(ENTITIES.cow.drops).toEqual([
      { id: "raw_beef", count: 2 },
      { id: "leather", count: 1 },
    ]);
    expect(COW_DROP_RANGES).toEqual({ raw_beef: [1, 3], leather: [0, 2] });
    expect(ITEMS.raw_beef.food).toBe(3);
    expect(ITEMS.cooked_beef.food).toBe(8);
    expect(SMELTING.raw_beef).toEqual({ output: "cooked_beef", count: 1 });
  });
  it("requires a horizontal row of three cane and outputs three paper", () => {
    const grid: Slot[] = Array(9).fill(null);
    for (const i of [3, 4, 5]) grid[i] = stack("sugar_cane", 2);
    expect(consumeRecipe(grid, 3)).toEqual({ id: "paper", count: 3 });
    expect([3, 4, 5].map((i) => grid[i]?.count)).toEqual([1, 1, 1]);
    const vertical: Slot[] = Array(9).fill(null);
    for (const i of [0, 3, 6]) vertical[i] = stack("sugar_cane");
    expect(matchRecipe(vertical, 3)).toBeNull();
    expect(recipe("paper").station).toBe("workbench");
  });
  it("makes a book shapelessly in a 2×2 grid and consumes each ingredient once", () => {
    for (let leather = 0; leather < 4; leather++) {
      const grid = Array.from({ length: 4 }, (_, i) =>
        stack(i === leather ? "leather" : "paper", 2),
      );
      expect(consumeRecipe(grid, 2)).toEqual({ id: "book", count: 1 });
      expect(grid.every((s) => s?.count === 1)).toBe(true);
    }
    expect(
      matchRecipe([stack("paper", 3), stack("leather"), null, null], 2),
    ).toBeNull();
    expect(
      matchRecipe(
        [stack("paper"), stack("paper"), stack("paper"), stack("stick")],
        2,
      ),
    ).toBeNull();
  });
  it("uses exact bookshelf and enchanting table ingredient counts", () => {
    expect(recipeIngredients(recipe("bookshelf"))).toEqual({
      planks: 6,
      book: 3,
    });
    expect(recipeIngredients(recipe("enchanting_table"))).toEqual({
      book: 1,
      diamond: 2,
      obsidian: 4,
    });
    const bookshelf = [
      "planks",
      "planks",
      "planks",
      "book",
      "book",
      "book",
      "planks",
      "planks",
      "planks",
    ].map((id) => stack(id));
    expect(consumeRecipe(bookshelf, 3)).toEqual({ id: "bookshelf", count: 1 });
    expect(bookshelf).toEqual(Array(9).fill(null));
    const table = [
      null,
      stack("book"),
      null,
      stack("diamond"),
      stack("obsidian"),
      stack("diamond"),
      stack("obsidian"),
      stack("obsidian"),
      stack("obsidian"),
    ];
    expect(consumeRecipe(table, 3)).toEqual({
      id: "enchanting_table",
      count: 1,
    });
    expect(table).toEqual(Array(9).fill(null));
  });
  it("crafts the survival chain from harvested inputs and cannot create a table without diamonds", () => {
    const inventory: Slot[] = [
      stack("sugar_cane", 12),
      stack("leather", 4),
      stack("planks", 6),
      stack("obsidian", 4),
      ...Array(16).fill(null),
    ];
    for (let i = 0; i < 4; i++)
      expect(craftFromInventory(recipe("paper"), inventory)).toBe(true);
    for (let i = 0; i < 4; i++)
      expect(craftFromInventory(recipe("book"), inventory)).toBe(true);
    expect(craftFromInventory(recipe("bookshelf"), inventory)).toBe(true);
    const before = structuredClone(inventory);
    expect(craftFromInventory(recipe("enchanting_table"), inventory)).toBe(
      false,
    );
    expect(inventory).toEqual(before);
    inventory[inventory.findIndex((s) => s === null)] = stack("diamond", 2);
    expect(craftFromInventory(recipe("enchanting_table"), inventory)).toBe(
      true,
    );
    expect(
      inventory
        .filter(Boolean)
        .map((s) => s!.id)
        .sort(),
    ).toEqual(["bookshelf", "enchanting_table"]);
  });
});
