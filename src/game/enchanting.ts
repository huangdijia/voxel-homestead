import { WORLD_MIN_Y, WORLD_MAX_Y } from "../engine/world-height";
import { isFluid } from "./fluid-blocks";
import {
  ENCHANTMENTS,
  canOfferEnchantment,
  enchantability,
  type EnchantmentId,
} from "./enchantments";
import { experienceStatus, MAX_EXPERIENCE, spendLevels } from "./experience";
import type {
  EnchantingOffer,
  ItemStack,
  Slot,
  Vec3,
  WorldPort,
} from "./types";

export const BOOKSHELF_ID = 113;
export const ENCHANTING_TABLE_ID = 112;
export const MAX_BOOKSHELVES = 15;
export const BOOKSHELF_OFFSETS: readonly Vec3[] = Object.freeze(
  [0, 1].flatMap((y) =>
    Array.from({ length: 5 }, (_, i) => i - 2).flatMap((x) =>
      Array.from({ length: 5 }, (_, i) => i - 2)
        .filter((z) => Math.abs(x) === 2 || Math.abs(z) === 2)
        .map((z) => ({ x, y, z })),
    ),
  ),
);
/** Java 1.21.1 checks one gap at the shelf's height; its replaceable tag includes fluids and short grass. */
export function countBookshelves(world: WorldPort, table: Vec3): number {
  if (
    ![table.x, table.y, table.z].every(Number.isInteger) ||
    table.y < WORLD_MIN_Y ||
    table.y > WORLD_MAX_Y ||
    !world.isReady(table.x, table.z, table.y) ||
    world.getBlock(table.x, table.y, table.z) !== ENCHANTING_TABLE_ID
  )
    return 0;
  let count = 0;
  for (const offset of BOOKSHELF_OFFSETS) {
    const x = table.x + offset.x,
      y = table.y + offset.y,
      z = table.z + offset.z;
    const gapX = table.x + Math.trunc(offset.x / 2),
      gapZ = table.z + Math.trunc(offset.z / 2);
    if (
      y > WORLD_MAX_Y ||
      !world.isReady(x, z, y) ||
      !world.isReady(gapX, gapZ, y)
    )
      continue;
    if (world.getBlock(x, y, z) !== BOOKSHELF_ID) continue;
    const gap = world.getBlock(gapX, y, gapZ);
    if (gap === 0 || gap === 58 || isFluid(gap)) count++;
    if (count >= MAX_BOOKSHELVES) return MAX_BOOKSHELVES;
  }
  return count;
}

/** The legacy Java LCG; local instances make UI reads side-effect free. */
class EnchantRandom {
  private state: bigint;
  constructor(seed: number) {
    this.state = (BigInt(seed | 0) ^ 0x5deece66dn) & ((1n << 48n) - 1n);
  }
  next(bits: number) {
    this.state = (this.state * 0x5deece66dn + 11n) & ((1n << 48n) - 1n);
    return Number(this.state >> BigInt(48 - bits));
  }
  int(bound: number): number {
    if ((bound & -bound) === bound)
      return Math.floor((bound * this.next(31)) / 2 ** 31);
    let bits: number, value: number;
    do {
      bits = this.next(31);
      value = bits % bound;
    } while (bits - value + bound - 1 >= 2 ** 31);
    return value;
  }
  float() {
    return this.next(24) / 2 ** 24;
  }
}
type SelectedEnchantment = { id: EnchantmentId; level: number };
type RolledOffer = {
  requiredLevel: number;
  chosen: SelectedEnchantment[];
  hint: SelectedEnchantment | null;
};

function weighted(pool: SelectedEnchantment[], random: EnchantRandom) {
  let value = random.int(
    pool.reduce((sum, candidate) => sum + ENCHANTMENTS[candidate.id].weight, 0),
  );
  for (const candidate of pool) {
    value -= ENCHANTMENTS[candidate.id].weight;
    if (value < 0) return candidate;
  }
  return pool[pool.length - 1]!;
}
function roll(
  stack: ItemStack,
  requiredLevel: number,
  seed: number,
  option: number,
): RolledOffer {
  const random = new EnchantRandom((seed + option) | 0);
  const powerRange = Math.floor(enchantability(stack.id) / 4) + 1;
  let power =
    requiredLevel + 1 + random.int(powerRange) + random.int(powerRange);
  power = Math.max(
    1,
    Math.round(power * (1 + (random.float() + random.float() - 1) * 0.15)),
  );
  let pool: SelectedEnchantment[] = [];
  for (const definition of Object.values(ENCHANTMENTS)) {
    if (!canOfferEnchantment(stack.id, definition.id)) continue;
    for (let level = definition.maxLevel; level >= 1; level--) {
      if (
        power >= definition.minCost.a * level + definition.minCost.b &&
        power <= definition.maxCost.a * level + definition.maxCost.b
      ) {
        pool.push({ id: definition.id, level });
        break;
      }
    }
  }
  const chosen: SelectedEnchantment[] = [];
  if (pool.length) {
    chosen.push(weighted(pool, random));
    while (random.int(50) <= power) {
      pool = pool.filter((candidate) =>
        chosen.every(
          (existing) =>
            existing.id !== candidate.id &&
            !ENCHANTMENTS[existing.id].incompatible.includes(candidate.id),
        ),
      );
      if (!pool.length) break;
      chosen.push(weighted(pool, random));
      power = Math.floor(power / 2);
    }
  }
  // Java removes one random enchantment from a book when more than one was rolled.
  if (stack.id === "book" && chosen.length > 1)
    chosen.splice(random.int(chosen.length), 1);
  return {
    requiredLevel,
    chosen,
    hint: chosen.length ? chosen[random.int(chosen.length)]! : null,
  };
}
function rollOffers(
  stack: ItemStack,
  bookshelves: number,
  seed: number,
): RolledOffer[] {
  const b = Math.max(
    0,
    Math.min(
      MAX_BOOKSHELVES,
      Number.isFinite(bookshelves) ? Math.floor(bookshelves) : 0,
    ),
  );
  const random = new EnchantRandom(seed);
  return [0, 1, 2].map((option) => {
    const base = random.int(8) + 1 + Math.floor(b / 2) + random.int(b + 1);
    const level =
      option === 0
        ? Math.max(1, Math.floor(base / 3))
        : option === 1
          ? Math.floor((base * 2) / 3) + 1
          : Math.max(base, 2 * b);
    return level < option + 1
      ? { requiredLevel: 0, chosen: [], hint: null }
      : roll(stack, level, seed, option);
  });
}
function inputReason(
  stack: Slot,
  seed: number,
  points: number,
): string | undefined {
  if (!stack) return "放入一件未附魔装备或一本书";
  if (stack.count !== 1 || !enchantability(stack.id))
    return "该物品不能在附魔台附魔";
  if (stack.enchantments !== undefined) return "已有附魔，不能再次使用附魔台";
  if (
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffff_ffff ||
    !Number.isFinite(points) ||
    points < 0 ||
    points > MAX_EXPERIENCE
  )
    return "经验数据无效";
  return undefined;
}
/** Full rolls remain private; clients receive exactly one truthful clue per option. */
export function getEnchantingOffers(
  stack: Slot,
  bookshelves: number,
  seed: number,
  points: number,
  lapisCount: number,
): EnchantingOffer[] {
  const invalid = inputReason(stack, seed, points);
  if (invalid)
    return ([0, 1, 2] as const).map((option) => ({
      option,
      requiredLevel: 0,
      levelCost: option + 1,
      lapisCost: option + 1,
      hint: null,
      available: false,
      reason: invalid,
    }));
  const level = experienceStatus(points).level;
  return rollOffers(stack!, bookshelves, seed).map((result, index) => {
    const option = index as 0 | 1 | 2;
    const cost = option + 1;
    const reason = !result.hint
      ? "没有可用附魔"
      : level < result.requiredLevel
        ? `需要达到 ${result.requiredLevel} 级`
        : !Number.isInteger(lapisCount) || lapisCount < cost
          ? `需要 ${cost} 个青金石`
          : undefined;
    return {
      option,
      requiredLevel: result.requiredLevel,
      levelCost: cost,
      lapisCost: cost,
      hint: result.hint ? { ...result.hint } : null,
      available: !reason,
      ...(reason ? { reason } : {}),
    };
  });
}
export interface EnchantmentResult {
  stack: ItemStack;
  points: number;
  lapisCost: number;
  seed: number;
}
/** Recomputes the selection and validates all costs before returning any changes. */
export function applyEnchantment(
  stack: ItemStack,
  bookshelves: number,
  seed: number,
  points: number,
  lapisCount: number,
  option: number,
): EnchantmentResult | null {
  if (
    !Number.isInteger(option) ||
    option < 0 ||
    option > 2 ||
    !getEnchantingOffers(stack, bookshelves, seed, points, lapisCount)[option]
      ?.available
  )
    return null;
  const result = rollOffers(stack, bookshelves, seed)[option]!;
  const remainder = spendLevels(points, option + 1);
  if (remainder === null || !result.chosen.length) return null;
  let nextSeed = new EnchantRandom(seed ^ 0x6a09e667).next(32);
  if (nextSeed === seed) nextSeed = (seed + 1) >>> 0;
  return {
    stack: {
      ...stack,
      id: stack.id === "book" ? "enchanted_book" : stack.id,
      enchantments: Object.fromEntries(
        result.chosen.map((enchantment) => [enchantment.id, enchantment.level]),
      ),
    },
    points: remainder,
    lapisCost: option + 1,
    seed: nextSeed,
  };
}
