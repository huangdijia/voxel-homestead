import { describe, expect, it } from "vitest";
import {
  addItem,
  clickInventorySlot,
  countItem,
  createInventory,
  removeItems,
} from "../src/game/inventory";
import {
  canCraft,
  consumeRecipe,
  craftFromInventory,
  matchRecipe,
  recipeIngredients,
  RECIPES,
  SMELTING,
} from "../src/game/recipes";
import { BLOCKS, ITEMS } from "../src/game/registry";
import type { RecipeDefinition, Slot } from "../src/game/types";
const find = (id: string) => RECIPES.find((recipe) => recipe.id === id)!;
function gridFor(recipe: RecipeDefinition, width = 3): Slot[] {
  const grid: Slot[] = Array.from({ length: width * width }, () => null);
  if (recipe.ingredients) {
    let index = 0;
    for (const [id, count] of Object.entries(recipe.ingredients))
      for (let i = 0; i < count; i++) grid[index++] = { id, count: 2 };
  }
  recipe.pattern?.forEach((row, y) =>
    Array.from(row).forEach((char, x) => {
      const id = recipe.keys?.[char];
      if (id) grid[y * width + x] = { id, count: 2 };
    }),
  );
  return grid;
}
describe("registries and survival dependency chain", () => {
  it("every drop, recipe ingredient and product resolves to an item", () => {
    for (const block of Object.values(BLOCKS))
      if (block.drop) expect(ITEMS[block.drop]).toBeDefined();
    for (const recipe of RECIPES) {
      expect(ITEMS[recipe.output.id]).toBeDefined();
      for (const id of Object.keys(recipeIngredients(recipe)))
        expect(ITEMS[id]).toBeDefined();
    }
  });
  it("has a coal-free light chain, food chain, full tool/armor chain", () => {
    expect(SMELTING.log.output).toBe("charcoal");
    expect(recipeIngredients(find("torch_charcoal"))).toEqual({
      charcoal: 1,
      stick: 1,
    });
    expect(SMELTING.raw_pork.output).toBe("cooked_pork");
    expect(SMELTING.raw_mutton.output).toBe("cooked_mutton");
    expect(SMELTING.raw_iron.output).toBe("iron_ingot");
    for (const material of ["wood", "stone", "iron"])
      for (const tool of ["pickaxe", "axe", "shovel", "sword"])
        expect(find(`${material}_${tool}`)).toBeDefined();
    for (const piece of ["helmet", "chestplate", "leggings", "boots"])
      expect(find(`iron_${piece}`)).toBeDefined();
  });
});
describe("crafting grid", () => {
  it.each(RECIPES.map((recipe) => [recipe.id, recipe] as const))(
    "matches and consumes %s exactly once",
    (_, recipe) => {
      const grid = gridFor(recipe);
      expect(matchRecipe(grid, 3)?.recipe.id).toBe(recipe.id);
      const output = consumeRecipe(grid, 3);
      expect(output?.id).toBe(recipe.output.id);
      expect(output?.count).toBe(recipe.output.count);
      for (const slot of grid) if (slot) expect(slot.count).toBe(1);
      if (ITEMS[recipe.output.id].maxDurability)
        expect(output?.durability).toBe(ITEMS[recipe.output.id].maxDurability);
    },
  );
  it("accepts shifted recipes and mirrored axes", () => {
    const shifted: Slot[] = [
      null,
      null,
      null,
      null,
      null,
      { id: "planks", count: 1 },
      null,
      null,
      { id: "planks", count: 1 },
    ];
    expect(matchRecipe(shifted, 3)?.recipe.id).toBe("stick");
    const axe: Slot[] = [
      null,
      { id: "planks", count: 1 },
      { id: "planks", count: 1 },
      null,
      { id: "stick", count: 1 },
      { id: "planks", count: 1 },
      null,
      { id: "stick", count: 1 },
      null,
    ];
    expect(matchRecipe(axe, 3)?.recipe.id).toBe("wood_axe");
  });
  it("rejects extra ingredients, invalid dimensions and wrong ordering", () => {
    const grid = gridFor(find("torch_coal"));
    grid[8] = { id: "dirt", count: 1 };
    expect(consumeRecipe(grid, 3)).toBeNull();
    expect(grid[0]?.count).toBe(2);
    expect(matchRecipe([{ id: "log", count: 1 }], 1)).toBeNull();
    expect(
      matchRecipe(
        [{ id: "stick", count: 1 }, null, { id: "coal", count: 1 }, null],
        2,
      ),
    ).toBeNull();
    expect(matchRecipe(gridFor(find("workbench"), 2), 2)?.output.id).toBe(
      "workbench",
    );
  });
});
describe("inventory atomicity and item conservation", () => {
  it("splits stack additions and returns only the overflow", () => {
    const slots: Slot[] = [{ id: "dirt", count: 60 }, null];
    expect(addItem(slots, { id: "dirt", count: 70 })).toEqual({
      id: "dirt",
      count: 2,
    });
    expect(slots.map((slot) => slot?.count)).toEqual([64, 64]);
  });
  it("leaves all materials untouched if one ingredient is missing", () => {
    const slots: Slot[] = [
      { id: "planks", count: 10 },
      { id: "stick", count: 1 },
    ];
    const original = structuredClone(slots);
    expect(removeItems(slots, { planks: 3, stick: 2 })).toBe(false);
    expect(slots).toEqual(original);
  });
  it("checks resulting capacity before committing a craft", () => {
    const slots: Slot[] = [{ id: "log", count: 2 }];
    expect(canCraft(find("planks"), slots)).toBe(false);
    expect(craftFromInventory(find("planks"), slots)).toBe(false);
    expect(slots).toEqual([{ id: "log", count: 2 }]);
    slots[0]!.count = 1;
    expect(craftFromInventory(find("planks"), slots)).toBe(true);
    expect(slots).toEqual([{ id: "planks", count: 4 }]);
  });
  it("right click takes the larger half, places one, merges and caps stacks", () => {
    const slots: Slot[] = [
      { id: "dirt", count: 9 },
      { id: "dirt", count: 63 },
      null,
    ];
    let cursor = clickInventorySlot(slots, 0, null, true);
    expect(cursor?.count).toBe(5);
    expect(slots[0]?.count).toBe(4);
    cursor = clickInventorySlot(slots, 1, cursor, false);
    expect(cursor?.count).toBe(4);
    cursor = clickInventorySlot(slots, 2, cursor, true);
    expect(cursor?.count).toBe(3);
    expect(slots[2]?.count).toBe(1);
    expect(countItem(slots, "dirt") + cursor!.count).toBe(72);
  });
  it("preserves durable items through pickup, swap and add", () => {
    const slots: Slot[] = [
      { id: "wood_pickaxe", count: 1, durability: 12 },
      { id: "dirt", count: 1 },
      null,
    ];
    let cursor = clickInventorySlot(slots, 0, null, false);
    cursor = clickInventorySlot(slots, 1, cursor, false);
    expect(slots[1]).toEqual({ id: "wood_pickaxe", count: 1, durability: 12 });
    expect(cursor?.id).toBe("dirt");
    addItem(slots, { id: "wood_pickaxe", count: 1 });
    expect(slots[0]).toEqual({ id: "wood_pickaxe", count: 1, durability: 59 });
    expect(createInventory()).toHaveLength(36);
  });
});
