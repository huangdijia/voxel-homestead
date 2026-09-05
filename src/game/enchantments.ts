import { BLOCKS, ITEMS } from "./registry";
import { canHarvest } from "./equipment";
import type { ItemStack, Slot } from "./types";
import type { RandomSource } from "./experience";

export type EnchantmentId =
  | "efficiency"
  | "unbreaking"
  | "fortune"
  | "silk_touch"
  | "sharpness"
  | "protection"
  | "feather_falling"
  | "respiration";
export interface EnchantmentDefinition {
  id: EnchantmentId;
  name: string;
  maxLevel: number;
  weight: number;
  minCost: { a: number; b: number };
  maxCost: { a: number; b: number };
  incompatible: readonly EnchantmentId[];
}
function definition(
  id: EnchantmentId,
  name: string,
  maxLevel: number,
  weight: number,
  minA: number,
  minB: number,
  maxA: number,
  maxB: number,
  incompatible: EnchantmentId[] = [],
): EnchantmentDefinition {
  return {
    id,
    name,
    maxLevel,
    weight,
    minCost: { a: minA, b: minB },
    maxCost: { a: maxA, b: maxB },
    incompatible,
  };
}
/** Costs/weights locked to docs/parity/sources/data__pc__1.21.1__enchantments.json. */
export const ENCHANTMENTS: Readonly<
  Record<EnchantmentId, EnchantmentDefinition>
> = Object.freeze({
  efficiency: definition("efficiency", "效率", 5, 10, 10, -9, 10, 41),
  feather_falling: definition("feather_falling", "摔落缓冲", 4, 5, 6, -1, 6, 5),
  fortune: definition("fortune", "时运", 3, 2, 9, 6, 9, 56, ["silk_touch"]),
  protection: definition("protection", "保护", 4, 10, 11, -10, 11, 1),
  respiration: definition("respiration", "水下呼吸", 3, 2, 10, 0, 10, 30),
  sharpness: definition("sharpness", "锋利", 5, 10, 11, -10, 11, 10),
  silk_touch: definition("silk_touch", "精准采集", 1, 1, 0, 15, 0, 65, [
    "fortune",
  ]),
  unbreaking: definition("unbreaking", "耐久", 3, 5, 8, -3, 8, 47),
});
export function canApplyEnchantment(itemId: string, id: string): boolean {
  const item = ITEMS[itemId];
  if (!item || !Object.hasOwn(ENCHANTMENTS, id)) return false;
  if (itemId === "book" || itemId === "enchanted_book") return true;
  if (!item.maxDurability) return false;
  const digging =
    item.tool === "pickaxe" ||
    item.tool === "axe" ||
    item.tool === "shovel" ||
    item.tool === "hoe";
  switch (id as EnchantmentId) {
    case "unbreaking":
      return true;
    case "efficiency":
      return digging || itemId === "shears";
    case "fortune":
    case "silk_touch":
      return digging;
    case "sharpness":
      return item.tool === "sword" || item.tool === "axe";
    case "protection":
      return !!item.armorSlot;
    case "feather_falling":
      return item.armorSlot === "feet";
    case "respiration":
      return item.armorSlot === "head";
  }
}
/** Table primary items differ from items which can accept an enchantment at a future anvil. */
export function canOfferEnchantment(itemId: string, id: string): boolean {
  return (
    canApplyEnchantment(itemId, id) &&
    itemId !== "enchanted_book" &&
    itemId !== "shears" &&
    (id !== "sharpness" || itemId === "book" || ITEMS[itemId]?.tool === "sword")
  );
}
/** Schema 7 preserves creative-anvil metadata on any registered item; active effects remain item-specific. */
export function validateEnchantments(
  itemId: string,
  value: unknown,
  allowAnyItem = false,
): boolean {
  if (!Object.hasOwn(ITEMS, itemId)) return false;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 8) return false;
  for (const [id, level] of entries) {
    if (
      !Object.hasOwn(ENCHANTMENTS, id) ||
      (!allowAnyItem && !canApplyEnchantment(itemId, id)) ||
      typeof level !== "number" ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > ENCHANTMENTS[id as EnchantmentId].maxLevel
    )
      return false;
    if (
      ENCHANTMENTS[id as EnchantmentId].incompatible.some((conflict) =>
        Object.hasOwn(value, conflict),
      )
    )
      return false;
  }
  return true;
}
export function enchantmentLevel(
  stack: Slot | undefined,
  id: EnchantmentId,
): number {
  if (stack?.id === "book" || stack?.id === "enchanted_book") return 0;
  const level = stack?.enchantments?.[id];
  return stack &&
    canApplyEnchantment(stack.id, id) &&
    Number.isInteger(level) &&
    level! > 0 &&
    level! <= ENCHANTMENTS[id].maxLevel
    ? level!
    : 0;
}
export function enchantability(itemId: string): number {
  if (itemId === "book") return 1;
  const item = ITEMS[itemId];
  if (!item?.maxDurability || (!item.tool && !item.armorSlot)) return 0;
  const material = itemId.split("_")[0];
  const values: Record<string, number> = item.armorSlot
    ? { iron: 9, gold: 25, diamond: 10 }
    : { wood: 15, stone: 5, iron: 14, gold: 22, diamond: 10 };
  return values[material] ?? 0;
}
/** Pass the block-specific effective speed, not the item's unrelated base mining speed. */
export function efficiencySpeed(
  baseSpeed: number,
  stack: Slot | undefined,
): number {
  const level = enchantmentLevel(stack, "efficiency");
  return baseSpeed > 1 && level > 0 ? baseSpeed + level * level + 1 : baseSpeed;
}
/** One independent Unbreaking trial per incoming durability point. */
export function durabilityConsumed(
  stack: ItemStack,
  amount: number,
  rng: RandomSource,
): number {
  if (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000)
    throw new RangeError("Invalid durability damage");
  const level = enchantmentLevel(stack, "unbreaking");
  if (!level) return amount;
  const armor = !!ITEMS[stack.id]?.armorSlot;
  let consumed = 0;
  for (let i = 0; i < amount; i++) {
    if ((armor && rng() < 0.6) || Math.floor(rng() * (level + 1)) === 0)
      consumed++;
  }
  return consumed;
}
const ORE_MULTIPLIERS = new Set([
  9, 10, 84, 85, 87, 88, 89, 92, 93, 94, 95, 97, 98, 99,
]);
export function fortuneDropCount(
  blockId: number,
  baseCount: number,
  stack: Slot | undefined,
  rng: RandomSource,
): number {
  const level = enchantmentLevel(stack, "fortune");
  if (!level || enchantmentLevel(stack, "silk_touch")) return baseCount;
  if (blockId === 86 || blockId === 96)
    return baseCount + Math.floor(rng() * (level + 1));
  if (ORE_MULTIPLIERS.has(blockId))
    return baseCount * (Math.max(0, Math.floor(rng() * (level + 2)) - 1) + 1);
  return baseCount;
}
/** Only overrides blocks with an implemented distinct Silk Touch drop; the caller handles normal drops otherwise. */
export function silkTouchDrop(
  blockId: number,
  stack: Slot | undefined,
): ItemStack | null {
  if (!enchantmentLevel(stack, "silk_touch")) return null;
  const block = BLOCKS[blockId];
  if (!block || !canHarvest(block, stack ? ITEMS[stack.id] : undefined))
    return null;
  if (blockId === 8 || blockId === 82) return { id: "leaves", count: 1 };
  if (
    [1, 3, 17, 90, 113].includes(blockId) ||
    ORE_MULTIPLIERS.has(blockId) ||
    blockId === 86 ||
    blockId === 96
  ) {
    if (ITEMS[block.key]) return { id: block.key, count: 1 };
  }
  return null;
}
export function sharpnessBonus(stack: Slot | undefined): number {
  const level = enchantmentLevel(stack, "sharpness");
  return level ? 0.5 * level + 0.5 : 0;
}
/** Applied after armor/toughness. Void/starvation bypass enchantment protection. */
export function enchantmentDamageMultiplier(
  armorSlots: readonly Slot[],
  cause: "fall" | "other" | "bypass",
): number {
  if (cause === "bypass") return 1;
  const epf = armorSlots.reduce(
    (sum, stack) =>
      sum +
      enchantmentLevel(stack, "protection") +
      (cause === "fall" ? 3 * enchantmentLevel(stack, "feather_falling") : 0),
    0,
  );
  return 1 - Math.min(20, epf) / 25;
}
/** Roll at each regular oxygen-depletion tick, including the submerged drowning countdown. */
export function consumesOxygen(
  helmet: Slot | undefined,
  rng: RandomSource,
): boolean {
  const level = enchantmentLevel(helmet, "respiration");
  return !level || Math.floor(rng() * (level + 1)) === 0;
}
