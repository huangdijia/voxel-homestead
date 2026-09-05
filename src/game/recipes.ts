import { addItem, removeItems } from "./inventory";
import { ITEMS } from "./registry";
import type { ItemStack, RecipeDefinition, Slot } from "./types";

export const RECIPES: RecipeDefinition[] = [];
function recipe(
  id: string,
  pattern: string[],
  keys: Record<string, string>,
  output: string,
  count = 1,
) {
  RECIPES.push({
    id,
    name: ITEMS[output].name,
    pattern,
    keys,
    output: { id: output, count },
    station:
      pattern.length > 2 || pattern.some((row) => row.length > 2)
        ? "workbench"
        : "inventory",
  });
}
recipe("planks", ["L"], { L: "log" }, "planks", 4);
recipe("stick", ["P", "P"], { P: "planks" }, "stick", 4);
recipe("workbench", ["PP", "PP"], { P: "planks" }, "workbench");
recipe("furnace", ["CCC", "C C", "CCC"], { C: "cobblestone" }, "furnace");
recipe("chest", ["PPP", "P P", "PPP"], { P: "planks" }, "chest");
recipe("torch_coal", ["C", "S"], { C: "coal", S: "stick" }, "torch", 4);
recipe("torch_charcoal", ["C", "S"], { C: "charcoal", S: "stick" }, "torch", 4);
recipe("door", ["PP", "PP", "PP"], { P: "planks" }, "door", 3);
recipe("ladder", ["S S", "SSS", "S S"], { S: "stick" }, "ladder", 3);
recipe("slab", ["PPP"], { P: "planks" }, "slab", 6);
recipe("bed", ["WWW", "PPP"], { W: "wool", P: "planks" }, "bed");
for (const material of ["wood", "stone", "iron"]) {
  const keys = {
    M:
      material === "wood"
        ? "planks"
        : material === "stone"
          ? "cobblestone"
          : "iron_ingot",
    S: "stick",
  };
  recipe(
    `${material}_pickaxe`,
    ["MMM", " S ", " S "],
    keys,
    `${material}_pickaxe`,
  );
  recipe(`${material}_axe`, ["MM", "MS", " S"], keys, `${material}_axe`);
  recipe(`${material}_shovel`, ["M", "S", "S"], keys, `${material}_shovel`);
  recipe(`${material}_sword`, ["M", "M", "S"], keys, `${material}_sword`);
}
recipe("iron_helmet", ["III", "I I"], { I: "iron_ingot" }, "iron_helmet");
recipe(
  "iron_chestplate",
  ["I I", "III", "III"],
  { I: "iron_ingot" },
  "iron_chestplate",
);
recipe(
  "iron_leggings",
  ["III", "I I", "I I"],
  { I: "iron_ingot" },
  "iron_leggings",
);
recipe("iron_boots", ["I I", "I I"], { I: "iron_ingot" }, "iron_boots");

export const SMELTING: Record<string, { output: string; count: number }> = {
  raw_iron: { output: "iron_ingot", count: 1 },
  log: { output: "charcoal", count: 1 },
  raw_pork: { output: "cooked_pork", count: 1 },
  raw_mutton: { output: "cooked_mutton", count: 1 },
  sand: { output: "glass", count: 1 },
  cobblestone: { output: "stone", count: 1 },
};
export function recipeIngredients(
  recipe: RecipeDefinition,
): Record<string, number> {
  if (recipe.ingredients) return { ...recipe.ingredients };
  const ingredients: Record<string, number> = {};
  for (const row of recipe.pattern ?? [])
    for (const key of row) {
      const id = recipe.keys?.[key];
      if (id) ingredients[id] = (ingredients[id] ?? 0) + 1;
    }
  return ingredients;
}
function outputStack(recipe: RecipeDefinition): ItemStack {
  const maxDurability = ITEMS[recipe.output.id].maxDurability;
  return {
    ...recipe.output,
    ...(maxDurability !== undefined ? { durability: maxDurability } : {}),
  };
}
export function matchRecipe(
  grid: Slot[],
  width: number,
): { recipe: RecipeDefinition; output: ItemStack } | null {
  if (![2, 3].includes(width) || grid.length !== width * width) return null;
  const occupied = grid
    .map((slot, index) => (slot ? index : -1))
    .filter((index) => index >= 0);
  if (!occupied.length) return null;
  const minX = Math.min(...occupied.map((index) => index % width));
  const maxX = Math.max(...occupied.map((index) => index % width));
  const minY = Math.min(...occupied.map((index) => Math.floor(index / width)));
  const maxY = Math.max(...occupied.map((index) => Math.floor(index / width)));
  for (const definition of RECIPES) {
    if (width === 2 && definition.station === "workbench") continue;
    if (!definition.pattern) {
      const ingredients = definition.ingredients ?? {};
      const found: Record<string, number> = {};
      for (const index of occupied)
        found[grid[index]!.id] = (found[grid[index]!.id] ?? 0) + 1;
      if (
        Object.keys(found).length === Object.keys(ingredients).length &&
        Object.entries(ingredients).every(([id, count]) => found[id] === count)
      )
        return { recipe: definition, output: outputStack(definition) };
      continue;
    }
    const pattern = definition.pattern;
    const patternWidth = Math.max(...pattern.map((row) => row.length));
    if (patternWidth !== maxX - minX + 1 || pattern.length !== maxY - minY + 1)
      continue;
    for (const mirrored of [false, true]) {
      let matches = true;
      for (let y = 0; y < pattern.length && matches; y++)
        for (let x = 0; x < patternWidth; x++) {
          const symbol = pattern[y][mirrored ? patternWidth - 1 - x : x] ?? " ";
          const expected = definition.keys?.[symbol] ?? null;
          const actual = grid[(minY + y) * width + minX + x]?.id ?? null;
          if (expected !== actual) {
            matches = false;
            break;
          }
        }
      if (matches)
        return { recipe: definition, output: outputStack(definition) };
    }
  }
  return null;
}
export function consumeRecipe(grid: Slot[], width: number): ItemStack | null {
  const result = matchRecipe(grid, width);
  if (!result) return null;
  for (let i = 0; i < grid.length; i++)
    if (grid[i]) {
      grid[i]!.count--;
      if (!grid[i]!.count) grid[i] = null;
    }
  return result.output;
}
function craftPreview(
  recipe: RecipeDefinition,
  inventory: Slot[],
): Slot[] | null {
  const next = inventory.map((stack) => (stack ? { ...stack } : null));
  if (
    !removeItems(next, recipeIngredients(recipe)) ||
    addItem(next, outputStack(recipe))
  )
    return null;
  return next;
}
export function canCraft(recipe: RecipeDefinition, inventory: Slot[]): boolean {
  return craftPreview(recipe, inventory) !== null;
}
export function craftFromInventory(
  recipe: RecipeDefinition,
  inventory: Slot[],
): boolean {
  const next = craftPreview(recipe, inventory);
  if (!next) return false;
  for (let index = 0; index < inventory.length; index++)
    inventory[index] = next[index];
  return true;
}
