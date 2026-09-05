import type { ItemStack } from "../game/types";
import { ITEMS } from "../game/registry";
import { ENCHANTMENTS } from "../game/enchantments";

const roman = ["", "I", "II", "III", "IV", "V"];
export function enchantmentLabel(id: string, level: number): string {
  const definition = ENCHANTMENTS[id as keyof typeof ENCHANTMENTS];
  return `${definition?.name ?? id} ${roman[level] ?? level}`;
}
export function hasEnchantments(stack?: ItemStack | null): boolean {
  return (
    !!stack?.enchantments &&
    Object.values(stack.enchantments).some((level) => level > 0)
  );
}
export function itemDescription(stack: ItemStack): string {
  return [
    ITEMS[stack.id]?.name ?? stack.id,
    ...Object.entries(stack.enchantments ?? {})
      .filter(([, level]) => level > 0)
      .map(([id, level]) => enchantmentLabel(id, level)),
    ...(stack.durability !== undefined
      ? [
          `耐久 ${stack.durability} / ${ITEMS[stack.id]?.maxDurability ?? stack.durability}`,
        ]
      : []),
  ].join("\n");
}
