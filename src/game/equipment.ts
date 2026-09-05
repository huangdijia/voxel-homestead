import type { BlockDefinition, ItemDefinition, Slot } from "./types";
import { efficiencySpeed } from "./enchantments";

/** Material speed and harvest eligibility are independent (notably for gold). */
export function canHarvest(
  block: BlockDefinition,
  item?: ItemDefinition | null,
): boolean {
  return (
    !block.tier || (item?.tool === "pickaxe" && (item.tier ?? 0) >= block.tier)
  );
}

export function miningDuration(
  block: BlockDefinition,
  item?: ItemDefinition | null,
  stack: Slot = null,
): number {
  if (!Number.isFinite(block.hardness)) return Infinity;
  if (block.hardness <= 0) return 0.05;
  const efficient = block.tool && item?.tool === block.tool;
  const shears = item?.id === "shears" && [8, 23, 58, 82].includes(block.id);
  const speed = shears
    ? 15
    : efficient
      ? (item.miningSpeed ?? [1, 2, 4, 6, 8][item.tier ?? 0] ?? 1)
      : 1;
  // 30 ticks for a harvestable hardness-1 block at speed 1; 100 otherwise.
  return Math.max(
    0.05,
    (block.hardness * (canHarvest(block, item) ? 1.5 : 5)) /
      efficiencySpeed(speed, stack),
  );
}

export function damageAfterArmor(
  damage: number,
  armor: number,
  toughness: number,
): number {
  const effective = Math.min(
    20,
    Math.max(armor / 5, armor - damage / (2 + toughness / 4)),
  );
  return damage * (1 - Math.max(0, effective) / 25);
}
