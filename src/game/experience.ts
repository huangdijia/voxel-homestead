import type { EntityKind } from "./types";

/** Java experience curve. Sources are recorded in /tmp/voxel-enchanting-sources.md. */
export const MAX_EXPERIENCE = 2_147_483_647;
export type RandomSource = () => number;

function assertLevel(level: number) {
  if (!Number.isSafeInteger(level) || level < 0 || level > 10_000_000)
    throw new RangeError("Invalid experience level");
}
export function experienceForLevel(level: number): number {
  assertLevel(level);
  if (level <= 16) return level * level + 6 * level;
  if (level <= 31) return 2.5 * level * level - 40.5 * level + 360;
  return 4.5 * level * level - 162.5 * level + 2220;
}
export function experienceToNextLevel(level: number): number {
  assertLevel(level);
  return level <= 15
    ? 2 * level + 7
    : level <= 30
      ? 5 * level - 38
      : 9 * level - 158;
}
export function experienceStatus(points: number) {
  if (!Number.isFinite(points) || points < 0 || points > MAX_EXPERIENCE)
    throw new RangeError("Invalid experience points");
  let level = Math.floor(
    points < 352
      ? Math.sqrt(points + 9) - 3
      : points < 1507
        ? (40.5 + Math.sqrt(40.5 ** 2 - 10 * (360 - points))) / 5
        : (162.5 + Math.sqrt(162.5 ** 2 - 18 * (2220 - points))) / 9,
  );
  // Correct floating-point rounding at an exact quadratic boundary.
  while (experienceForLevel(level + 1) <= points) level++;
  while (experienceForLevel(level) > points) level--;
  const pointsIntoLevel = points - experienceForLevel(level);
  const pointsToNextLevel = experienceToNextLevel(level);
  return {
    level,
    progress: pointsIntoLevel / pointsToNextLevel,
    pointsIntoLevel,
    pointsToNextLevel,
  };
}
/** Java subtracts levels without changing the fractional experience bar. */
export function spendLevels(points: number, levels: number): number | null {
  if (
    !Number.isInteger(levels) ||
    levels < 0 ||
    !Number.isFinite(points) ||
    points < 0 ||
    points > MAX_EXPERIENCE
  )
    return null;
  const status = experienceStatus(points);
  if (levels > status.level) return null;
  const level = status.level - levels;
  return (
    experienceForLevel(level) + status.progress * experienceToNextLevel(level)
  );
}
export function deathExperience(points: number): number {
  return Math.min(100, experienceStatus(points).level * 7);
}

function range(min: number, max: number, rng: RandomSource) {
  return (
    min +
    Math.floor(
      Math.min(1 - Number.EPSILON, Math.max(0, rng())) * (max - min + 1),
    )
  );
}
const MINING_EXPERIENCE: Readonly<Record<number, readonly [number, number]>> = {
  9: [0, 2],
  92: [0, 2],
  86: [1, 5],
  96: [1, 5],
  87: [2, 5],
  97: [2, 5],
  88: [3, 7],
  98: [3, 7],
  89: [3, 7],
  99: [3, 7],
};
/** Caller must first enforce a successful harvest with the correct tool. Fortune does not multiply XP. */
export function miningExperience(
  blockId: number,
  silkTouch: boolean,
  rng: RandomSource,
): number {
  const reward = MINING_EXPERIENCE[blockId];
  return silkTouch || !reward ? 0 : range(...reward, rng);
}
/** Only call for a qualifying player kill; passive babies yield no experience. */
export function mobExperience(
  kind: EntityKind,
  baby: boolean,
  rng: RandomSource,
): number {
  if (kind === "zombie") return baby ? 12 : 5;
  if (kind === "creeper") return 5;
  return baby ? 0 : range(1, 3, rng);
}
/** Furnace accumulates these fractions per completed recipe, then pays once on collection/breakage. */
export const SMELTING_EXPERIENCE: Readonly<Record<string, number>> =
  Object.freeze({
    potato: 0.35,
    raw_pork: 0.35,
    raw_mutton: 0.35,
    raw_beef: 0.35,
    raw_iron: 0.7,
    raw_copper: 0.7,
    raw_gold: 1,
    log: 0.15,
    sand: 0.1,
    cobblestone: 0.1,
    cobbled_deepslate: 0.1,
    ...Object.fromEntries(
      ["", "deepslate_"].flatMap((prefix) =>
        Object.entries({
          coal: 0.1,
          iron: 0.7,
          copper: 0.7,
          gold: 1,
          redstone: 0.7,
          lapis: 0.2,
          diamond: 1,
          emerald: 1,
        }).map(([ore, xp]) => [`${prefix}${ore}_ore`, xp]),
      ),
    ),
  });
export function rollFractionalExperience(
  value: number,
  rng: RandomSource,
): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_EXPERIENCE)
    throw new RangeError("Invalid experience reward");
  const whole = Math.floor(value);
  const fraction = value - whole;
  return whole + (fraction > 0 && rng() < fraction ? 1 : 0);
}
