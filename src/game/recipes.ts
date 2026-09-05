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
for (const [material, ingredient, suffix] of [
  ["wood", "planks", ""],
  ["stone", "cobblestone", ""],
  ["iron", "iron_ingot", ""],
  ["gold", "gold_ingot", ""],
  ["diamond", "diamond", ""],
  ["stone", "cobbled_deepslate", "_deepslate"],
] as const) {
  const keys = { M: ingredient, S: "stick" };
  recipe(
    `${material}_pickaxe${suffix}`,
    ["MMM", " S ", " S "],
    keys,
    `${material}_pickaxe`,
  );
  recipe(
    `${material}_axe${suffix}`,
    ["MM", "MS", " S"],
    keys,
    `${material}_axe`,
  );
  recipe(
    `${material}_shovel${suffix}`,
    ["M", "S", "S"],
    keys,
    `${material}_shovel`,
  );
  recipe(
    `${material}_sword${suffix}`,
    ["M", "M", "S"],
    keys,
    `${material}_sword`,
  );
  recipe(
    `${material}_hoe${suffix}`,
    ["MM", " S", " S"],
    keys,
    `${material}_hoe`,
  );
}
for (const [material, ingredient] of [
  ["iron", "iron_ingot"],
  ["gold", "gold_ingot"],
  ["diamond", "diamond"],
] as const) {
  const keys = { I: ingredient };
  recipe(`${material}_helmet`, ["III", "I I"], keys, `${material}_helmet`);
  recipe(
    `${material}_chestplate`,
    ["I I", "III", "III"],
    keys,
    `${material}_chestplate`,
  );
  recipe(
    `${material}_leggings`,
    ["III", "I I", "I I"],
    keys,
    `${material}_leggings`,
  );
  recipe(`${material}_boots`, ["I I", "I I"], keys, `${material}_boots`);
}
recipe(
  "furnace_deepslate",
  ["CCC", "C C", "CCC"],
  { C: "cobbled_deepslate" },
  "furnace",
);
for (const [block, material] of [
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
] as const) {
  recipe(block, ["MMM", "MMM", "MMM"], { M: material }, block);
  recipe(`${block}_unpack`, ["B"], { B: block }, material, 9);
}
for (const metal of ["iron", "gold"] as const) {
  recipe(
    `${metal}_ingot_from_nuggets`,
    ["NNN", "NNN", "NNN"],
    { N: `${metal}_nugget` },
    `${metal}_ingot`,
  );
  recipe(
    `${metal}_nugget`,
    ["I"],
    { I: `${metal}_ingot` },
    `${metal}_nugget`,
    9,
  );
}

recipe("bread", ["WWW"], { W: "wheat" }, "bread");
recipe("bowl", ["P P", " P "], { P: "planks" }, "bowl", 4);
recipe("bucket", ["I I", " I "], { I: "iron_ingot" }, "bucket");
recipe("shears", [" I", "I "], { I: "iron_ingot" }, "shears");
recipe("composter", ["S S", "S S", "SSS"], { S: "slab" }, "composter");
RECIPES.push({
  id: "beetroot_soup",
  name: "甜菜汤",
  ingredients: { beetroot: 6, bowl: 1 },
  output: { id: "beetroot_soup", count: 1 },
  station: "workbench",
});

export const SMELTING: Record<string, { output: string; count: number }> = {
  potato: { output: "baked_potato", count: 1 },
  raw_iron: { output: "iron_ingot", count: 1 },
  raw_copper: { output: "copper_ingot", count: 1 },
  raw_gold: { output: "gold_ingot", count: 1 },
  log: { output: "charcoal", count: 1 },
  raw_pork: { output: "cooked_pork", count: 1 },
  raw_mutton: { output: "cooked_mutton", count: 1 },
  sand: { output: "glass", count: 1 },
  cobblestone: { output: "stone", count: 1 },
  cobbled_deepslate: { output: "deepslate", count: 1 },
};
for (const [mineral, output] of [
  ["coal", "coal"],
  ["iron", "iron_ingot"],
  ["copper", "copper_ingot"],
  ["gold", "gold_ingot"],
  ["redstone", "redstone"],
  ["lapis", "lapis_lazuli"],
  ["diamond", "diamond"],
  ["emerald", "emerald"],
] as const)
  for (const prefix of ["", "deepslate_"])
    SMELTING[`${prefix}${mineral}_ore`] = { output, count: 1 };
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
