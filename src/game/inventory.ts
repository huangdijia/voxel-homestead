import { ITEMS } from "./registry";
import type { ItemStack, Slot } from "./types";

export const createInventory = (): Slot[] =>
  Array.from({ length: 36 }, () => null);
const copy = (stack: ItemStack): ItemStack => ({
  ...stack,
  ...(stack.enchantments ? { enchantments: { ...stack.enchantments } } : {}),
  ...(ITEMS[stack.id]?.maxDurability !== undefined &&
  stack.durability === undefined
    ? { durability: ITEMS[stack.id].maxDurability }
    : {}),
});
export const compatibleStacks = (a: ItemStack, b: ItemStack) =>
  a.id === b.id &&
  (a.durability ?? ITEMS[a.id]?.maxDurability) ===
    (b.durability ?? ITEMS[b.id]?.maxDurability) &&
  Object.keys(a.enchantments ?? {}).length ===
    Object.keys(b.enchantments ?? {}).length &&
  Object.entries(a.enchantments ?? {}).every(
    ([id, level]) => b.enchantments?.[id] === level,
  );
export function countItem(slots: Slot[], id: string): number {
  return slots.reduce(
    (sum, slot) => sum + (slot?.id === id ? slot.count : 0),
    0,
  );
}
/** Adds as much as fits. Returns only the remainder; tools retain their own durability. */
export function addItem(slots: Slot[], stack: ItemStack): ItemStack | null {
  const definition = ITEMS[stack.id];
  if (!definition || !Number.isSafeInteger(stack.count) || stack.count < 1)
    return { ...stack };
  const remaining = copy(stack);
  for (const slot of slots) {
    if (!slot || !compatibleStacks(slot, remaining)) continue;
    const moved = Math.min(
      Math.max(0, definition.maxStack - slot.count),
      remaining.count,
    );
    slot.count += moved;
    remaining.count -= moved;
    if (!remaining.count) return null;
  }
  for (let index = 0; index < slots.length; index++) {
    if (slots[index]) continue;
    const count = Math.min(definition.maxStack, remaining.count);
    slots[index] = { ...copy(remaining), count };
    remaining.count -= count;
    if (!remaining.count) return null;
  }
  return remaining;
}
/** Material removal is atomic: a shortage never consumes any ingredient. */
export function removeItems(
  slots: Slot[],
  ingredients: Record<string, number>,
): boolean {
  if (
    Object.entries(ingredients).some(
      ([id, count]) =>
        !ITEMS[id] ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        countItem(slots, id) < count,
    )
  )
    return false;
  for (const [id, count] of Object.entries(ingredients)) {
    let remaining = count;
    for (let index = 0; index < slots.length && remaining > 0; index++) {
      const slot = slots[index];
      if (slot?.id !== id) continue;
      const taken = Math.min(slot.count, remaining);
      slot.count -= taken;
      remaining -= taken;
      if (!slot.count) slots[index] = null;
    }
  }
  return true;
}
export function clickInventorySlot(
  slots: Slot[],
  index: number,
  cursor: Slot,
  right: boolean,
): Slot {
  if (!Number.isInteger(index) || index < 0 || index >= slots.length)
    return cursor;
  const slot = slots[index];
  if (!cursor) {
    if (!slot) return null;
    const count = right ? Math.ceil(slot.count / 2) : slot.count;
    const taken = { ...copy(slot), count };
    slot.count -= count;
    if (!slot.count) slots[index] = null;
    return taken;
  }
  const definition = ITEMS[cursor.id];
  if (!definition) return cursor;
  if (!slot || compatibleStacks(slot, cursor)) {
    const moved = Math.min(
      right ? 1 : cursor.count,
      definition.maxStack - (slot?.count ?? 0),
    );
    if (!moved) return cursor;
    slots[index] = { ...copy(cursor), count: (slot?.count ?? 0) + moved };
    return cursor.count > moved
      ? { ...copy(cursor), count: cursor.count - moved }
      : null;
  }
  if (right) return cursor;
  slots[index] = copy(cursor);
  return copy(slot);
}
