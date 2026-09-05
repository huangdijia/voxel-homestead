import {
  WORLD_MIN_Y,
  WORLD_MAX_Y,
  SEA_LEVEL,
  type GeneratorVersion,
} from "./world-height.ts";
export {
  WORLD_MIN_Y,
  WORLD_MAX_Y,
  SEA_LEVEL,
  CHUNK_SIZE,
  type GeneratorVersion,
} from "./world-height.ts";

// These coordinates are part of the saved-world contract, not current bounds.
const LEGACY_MIN_Y = -16;
const LEGACY_MAX_Y = 95;
const LEGACY_SEA_LEVEL = 19;

const seeds = new Map<string, number>();
export function seedNumber(seed: string): number {
  const known = seeds.get(seed);
  if (known !== undefined) return known;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++)
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const result = h >>> 0;
  if (seeds.size > 32) seeds.clear();
  seeds.set(seed, result);
  return result;
}

function hash(seed: number, x: number, y: number, z: number): number {
  let h =
    seed ^
    Math.imul(x, 374761393) ^
    Math.imul(y, 668265263) ^
    Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
function noise(seed: number, x: number, z: number, size: number): number {
  const fx = x / size,
    fz = z / size,
    ix = Math.floor(fx),
    iz = Math.floor(fz);
  const tx = smooth(fx - ix),
    tz = smooth(fz - iz);
  const a = hash(seed, ix, 0, iz),
    b = hash(seed, ix + 1, 0, iz);
  const c = hash(seed, ix, 0, iz + 1),
    d = hash(seed, ix + 1, 0, iz + 1);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}
const heights = new Map<string, number>();
export function surfaceHeight(
  seed: string,
  x: number,
  z: number,
  generatorVersion: GeneratorVersion = 1,
): number {
  x = Math.floor(x);
  z = Math.floor(z);
  if (generatorVersion === 5) return fullHeight(seed, x, z);
  const key = seed + ":" + x + "," + z;
  const cached = heights.get(key);
  if (cached !== undefined) return cached;
  const s = seedNumber(seed);
  let y =
    17 +
    noise(s, x, z, 100) * 16 +
    noise(s + 91, x, z, 29) * 7 +
    noise(s + 12, x, z, 9) * 2;
  const distance = Math.hypot(x, z);
  const flat = Math.max(0, 1 - Math.max(0, distance - 7) / 13);
  y = y * (1 - flat) + 22 * flat;
  const pond = Math.max(0, 1 - Math.hypot(x - 3, z + 20) / 8);
  y = y * (1 - pond) + 16 * pond;
  // A small hillside with an accessible, lit-from-outside starter mine.
  const hill = Math.max(0, 1 - Math.hypot(x - 21, (z - 2) * 1.45) / 15);
  if (hill > 0) y = Math.max(y, 22 + hill * 12);
  const result = Math.floor(y);
  if (heights.size > 90000) heights.clear();
  heights.set(key, result);
  return result;
}

function treeAt(
  seed: string,
  x: number,
  y: number,
  z: number,
  generatorVersion: GeneratorVersion = 1,
): number {
  const s = seedNumber(seed),
    gx = Math.floor(x / 10),
    gz = Math.floor(z / 10);
  let leaf = false;
  // Two guaranteed trees are outside the player's clear spawn area.
  const candidates: Array<[number, number, number]> = [
    [-6, 5, 5],
    [-8, -6, 5],
  ];
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const cx = gx + dx,
        cz = gz + dz;
      if (hash(s + 812, cx, 0, cz) < 0.28) continue;
      const tx = cx * 10 + 2 + Math.floor(hash(s, cx, 6, cz) * 6);
      const tz = cz * 10 + 2 + Math.floor(hash(s, cx, 7, cz) * 6);
      if (
        Math.hypot(tx, tz) < 12 ||
        (generatorVersion !== 5 && tx > 5 && tx < 35 && Math.abs(tz - 2) < 9)
      )
        continue;
      candidates.push([tx, tz, 4 + Math.floor(hash(s, cx, 8, cz) * 3)]);
    }
  for (const [tx, tz, tall] of candidates) {
    const dx = Math.abs(x - tx),
      dz = Math.abs(z - tz);
    if (dx > 2 || dz > 2) continue;
    const floor = surfaceHeight(seed, tx, tz, generatorVersion);
    if (floor <= (generatorVersion === 5 ? SEA_LEVEL : LEGACY_SEA_LEVEL) + 1)
      continue;
    const top = floor + tall;
    if (dx === 0 && dz === 0 && y > floor && y <= top) return 7;
    const dy = y - top;
    if (
      dy >= -2 &&
      dy <= 1 &&
      dx + dz <= (dy === 1 ? 2 : 4) &&
      !(dx === 2 && dz === 2 && dy >= 0)
    )
      leaf = true;
  }
  return leaf ? 8 : 0;
}

interface MineralVein {
  id: number;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}
const mineralVeins = new Map<string, MineralVein | null>();
const deepMinerals: Record<number, number> = {
  84: 94,
  85: 95,
  86: 96,
  87: 97,
  88: 98,
  89: 99,
};

/**
 * Version 4 uses its own compact-world distribution, NOT Java's ore heights.
 * Each five-cell grid box may contain an irregular ellipsoid. The grid is
 * independent of sixteen-cell chunks, so veins cross chunk boundaries without
 * depending on generation order, worker state, or the item registry.
 */
function mineralAt(
  seed: string,
  s: number,
  x: number,
  y: number,
  z: number,
): number {
  const gx = Math.floor(x / 5),
    gy = Math.floor(y / 5),
    gz = Math.floor(z / 5);
  const key = `${s}:${gx},${gy},${gz}`;
  let vein = mineralVeins.get(key);
  if (vein === undefined) {
    const centerY = gy * 5 + 2;
    const hill = surfaceHeight(seed, gx * 5 + 2, gz * 5 + 2) >= 33;
    const deep = centerY <= 0;
    // Absolute probabilities leave most boxes empty. Copper favors the shallow
    // rock; diamond/gold/redstone favor the compressed deep band. Emerald is
    // ten times as frequent below hills as beneath low terrain.
    const choices: Array<[number, number]> = [
      [84, centerY <= 37 ? (deep ? 0.014 : 0.08) : 0],
      [85, centerY <= 17 ? (deep ? 0.045 : 0.02) : 0],
      [86, centerY <= 12 ? (deep ? 0.075 : 0.03) : 0],
      [87, centerY <= 22 ? (centerY >= -3 && centerY <= 12 ? 0.05 : 0.025) : 0],
      [88, centerY <= 7 ? (deep ? 0.022 : 0.008) : 0],
      [89, centerY <= 37 ? (hill ? 0.04 : 0.004) : 0],
    ];
    let pick = hash(s + 7309, gx, gy, gz),
      id = 0;
    for (const [candidate, probability] of choices) {
      if (pick < probability) {
        id = candidate;
        break;
      }
      pick -= probability;
    }
    vein = id
      ? {
          id,
          x: gx * 5 + 2 + (hash(s + 7311, gx, gy, gz) - 0.5) * 0.8,
          y: centerY + (hash(s + 7313, gx, gy, gz) - 0.5) * 0.6,
          z: gz * 5 + 2 + (hash(s + 7319, gx, gy, gz) - 0.5) * 0.8,
          rx: 1.65 + hash(s + 7321, gx, gy, gz) * 0.7,
          ry: 1.3 + hash(s + 7327, gx, gy, gz) * 0.6,
          rz: 1.65 + hash(s + 7331, gx, gy, gz) * 0.7,
        }
      : null;
    if (mineralVeins.size >= 16384) mineralVeins.clear();
    mineralVeins.set(key, vein);
  }
  if (!vein) return 0;
  const distance =
    ((x - vein.x) / vein.rx) ** 2 +
    ((y - vein.y) / vein.ry) ** 2 +
    ((z - vein.z) / vein.rz) ** 2;
  if (distance > 1 + (hash(s + 7333, x, y, z) - 0.5) * 0.25) return 0;
  return y <= 0 ? deepMinerals[vein.id] : vein.id;
}

const fullHeights = new Map<string, number>();
const fullVeins = new Map<string, MineralVein | null>();
const fullGravelPockets = new Map<string, MineralVein | null>();
const fullDeepMinerals: Record<number, number> = {
  9: 92,
  10: 93,
  ...deepMinerals,
};
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const triangle = (y: number, peak: number, spread: number): number =>
  Math.max(0, 1 - Math.abs(y - peak) / spread);

/** Version 5 has independent terrain, not a vertical rescale of older worlds. */
function fullHeight(seed: string, x: number, z: number): number {
  const key = `${seed}:${x},${z}`;
  const known = fullHeights.get(key);
  if (known !== undefined) return known;
  const s = seedNumber(seed);
  const continental = noise(s + 15013, x, z, 320);
  const mountain = clamp01((noise(s + 15017, x, z, 168) - 0.52) / 0.48);
  const inland = smooth(clamp01((continental - 0.3) / 0.35));
  let y =
    45 +
    continental * 37 +
    noise(s + 15031, x, z, 36) * 8 +
    mountain ** 1.7 * 154 * inland +
    noise(s + 15053, x, z, 11) * 3;
  // The only spawn guarantee is dry, level footing and the two nearby trees.
  // No mineral wall or pre-carved starter mine is carried into this generator.
  const blend = smooth(clamp01((Math.hypot(x, z) - 8) / 24));
  y = 68 * (1 - blend) + y * blend;
  const result = Math.floor(Math.min(WORLD_MAX_Y - 12, y));
  if (fullHeights.size >= 90000) fullHeights.clear();
  fullHeights.set(key, result);
  return result;
}

/**
 * Broad ore-height preferences only: this is not Mojang's density function,
 * biome placement, exposure reduction, or large ore-vein generator. Profiles
 * use real Y coordinates and stone/deepslate variants instead of old heights.
 * Seven-cell ore boxes are independent of chunk boundaries and load order.
 */
function fullMineralAt(
  seed: string,
  s: number,
  x: number,
  y: number,
  z: number,
): number {
  const gx = Math.floor(x / 7),
    gy = Math.floor(y / 7),
    gz = Math.floor(z / 7);
  const key = `${s}:${gx},${gy},${gz}`;
  let vein = fullVeins.get(key);
  if (vein === undefined) {
    const centerY = gy * 7 + 3;
    const highland = fullHeight(seed, gx * 7 + 3, gz * 7 + 3) >= 96;
    const within = (low: number, high: number) =>
      centerY >= low && centerY <= high;
    const deep = clamp01((16 - centerY) / 76);
    const choices: Array<[number, number]> = [
      [9, within(0, 256) ? 0.025 + 0.11 * triangle(centerY, 96, 96) : 0],
      [
        10,
        within(-60, 256)
          ? 0.024 +
            0.09 * triangle(centerY, 16, 64) +
            (highland ? 0.12 * triangle(centerY, 176, 112) : 0)
          : 0,
      ],
      [84, within(-16, 112) ? 0.018 + 0.105 * triangle(centerY, 48, 64) : 0],
      [85, within(-60, 32) ? 0.018 + 0.06 * triangle(centerY, -16, 48) : 0],
      [86, within(-60, 16) ? 0.022 + 0.075 * deep : 0],
      [87, within(-60, 64) ? 0.018 + 0.07 * triangle(centerY, 0, 48) : 0],
      [88, within(-60, 16) ? 0.009 + 0.04 * deep : 0],
      [
        89,
        highland && within(-16, 256)
          ? 0.012 + 0.055 * triangle(centerY, 128, 144)
          : 0,
      ],
    ];
    let pick = hash(s + 17011, gx, gy, gz),
      id = 0;
    for (const [candidate, probability] of choices) {
      if (pick < probability) {
        id = candidate;
        break;
      }
      pick -= probability;
    }
    vein = id
      ? {
          id,
          x: gx * 7 + 3 + (hash(s + 17021, gx, gy, gz) - 0.5) * 0.8,
          y: centerY + (hash(s + 17027, gx, gy, gz) - 0.5) * 0.6,
          z: gz * 7 + 3 + (hash(s + 17033, gx, gy, gz) - 0.5) * 0.8,
          rx: 2.05 + hash(s + 17041, gx, gy, gz) * 0.65,
          ry: id === 9 ? 3.2 : 1.65 + hash(s + 17047, gx, gy, gz) * 0.7,
          rz: 2.05 + hash(s + 17053, gx, gy, gz) * 0.65,
        }
      : null;
    if (fullVeins.size >= 16384) fullVeins.clear();
    fullVeins.set(key, vein);
  }
  if (!vein || (vein.id === 9 && y < 0)) return 0;
  const distance =
    ((x - vein.x) / vein.rx) ** 2 +
    ((y - vein.y) / vein.ry) ** 2 +
    ((z - vein.z) / vein.rz) ** 2;
  if (distance > 1 + (hash(s + 17059, x, y, z) - 0.5) * 0.2) return 0;
  return y <= 0 ? fullDeepMinerals[vein.id] : vein.id;
}

/** Small gravel pockets replace only unmineralized rock, never cave air/soil. */
function fullGravelAt(s: number, x: number, y: number, z: number): boolean {
  // Keep the spawn column's foundation stable while players first dig down.
  if (x * x + z * z < 144) return false;
  const gx = Math.floor(x / 9),
    gy = Math.floor(y / 9),
    gz = Math.floor(z / 9);
  const key = `${s}:${gx},${gy},${gz}`;
  let pocket = fullGravelPockets.get(key);
  if (pocket === undefined) {
    pocket =
      hash(s + 21001, gx, gy, gz) < 0.12
        ? {
            id: 5,
            x: gx * 9 + 4 + (hash(s + 21011, gx, gy, gz) - 0.5) * 0.8,
            y: gy * 9 + 4 + (hash(s + 21013, gx, gy, gz) - 0.5) * 0.8,
            z: gz * 9 + 4 + (hash(s + 21017, gx, gy, gz) - 0.5) * 0.8,
            rx: 2.4 + hash(s + 21019, gx, gy, gz) * 0.8,
            ry: 1.8 + hash(s + 21023, gx, gy, gz),
            rz: 2.4 + hash(s + 21031, gx, gy, gz) * 0.8,
          }
        : null;
    if (fullGravelPockets.size >= 16384) fullGravelPockets.clear();
    fullGravelPockets.set(key, pocket);
  }
  if (!pocket) return false;
  const distance =
    ((x - pocket.x) / pocket.rx) ** 2 +
    ((y - pocket.y) / pocket.ry) ** 2 +
    ((z - pocket.z) / pocket.rz) ** 2;
  return distance <= 1 + (hash(s + 21037, x, y, z) - 0.5) * 0.15;
}

function sampleFullHeight(
  seed: string,
  x: number,
  y: number,
  z: number,
): number {
  if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) return 0;
  if (y === WORLD_MIN_Y) return 24;
  const s = seedNumber(seed);
  if (y < -59 && hash(s + 19001, x, y, z) < (-59 - y) / 5) return 24;
  const top = fullHeight(seed, x, z);
  if (y > top) {
    // SEA_LEVEL names the geometric water surface, not the top block index.
    if (y < SEA_LEVEL) return 6;
    if (y > top + 18) return 0;
    const tree = treeAt(seed, x, y, z, 5);
    if (tree) return tree;
    if (
      y === top + 1 &&
      top > SEA_LEVEL + 1 &&
      Math.hypot(x, z) > 2 &&
      hash(s + 19009, x, y, z) < 0.24
    )
      return 58;
    return 0;
  }
  // Keep a soil roof and spawn footing intact; deep caves still pass underneath
  // the spawn column. Cavities continue down to the top of the bedrock layer.
  if (y < top - 4 && y > -60 && !(y > 48 && Math.hypot(x, z) < 9)) {
    const phase = (s % 7919) * 0.013;
    const chamber =
      Math.sin(x * 0.075 + Math.sin(z * 0.041 + phase) * 2.3 + phase) +
      Math.cos(y * 0.104 - x * 0.023 + phase * 1.3) +
      Math.sin(z * 0.079 + y * 0.057 - phase * 0.7);
    const worm =
      Math.abs(Math.sin(x * 0.037 + y * 0.069 + phase)) +
      Math.abs(Math.cos(z * 0.047 - y * 0.051 + phase * 1.7));
    if (chamber > 2.42 || worm < 0.14) return y < -54 ? 76 : 0;
  }
  if (y === top) return top <= SEA_LEVEL ? 4 : 1;
  if (y >= top - 3) return top <= SEA_LEVEL ? 4 : 2;
  return (
    fullMineralAt(seed, s, x, y, z) ||
    (fullGravelAt(s, x, y, z) ? 5 : y <= 0 ? 90 : 3)
  );
}

/** Deterministic terrain; trees never cover the safe spawn at (0, 0). */
export function sampleBlock(
  seed: string,
  x: number,
  y: number,
  z: number,
  generatorVersion: GeneratorVersion = 1,
): number {
  x = Math.floor(x);
  y = Math.floor(y);
  z = Math.floor(z);
  if (generatorVersion === 5) return sampleFullHeight(seed, x, y, z);
  if (y <= LEGACY_MIN_Y) return 24;
  if (y > LEGACY_MAX_Y) return 0;
  const top = surfaceHeight(seed, x, z);
  if (y > top) {
    if (y <= LEGACY_SEA_LEVEL) return 6;
    if (y > top + 9) return 0;
    const tree = treeAt(seed, x, y, z);
    if (tree) return tree;
    // Version 1 terrain remains byte-for-byte unchanged for existing saves.
    if (
      generatorVersion >= 2 &&
      y === top + 1 &&
      top > LEGACY_SEA_LEVEL + 1 &&
      Math.hypot(x, z) > 2 &&
      hash(seedNumber(seed) + 521, x, y, z) < 0.24
    )
      return 58;
    return 0;
  }
  const s = seedNumber(seed);
  const starterTunnel =
    x >= 8 && x <= 28 && z >= 1 && z <= 4 && y >= 23 && y <= 26;
  if (starterTunnel) return 0;
  if (x >= 11 && x <= 17 && (z === 0 || z === 5) && y >= 23 && y <= 26)
    return 9;
  if (x >= 20 && x <= 28 && (z === 0 || z === 5) && y >= 23 && y <= 26)
    return 10;
  if (y < top - 5 && y > LEGACY_MIN_Y + 3 && Math.hypot(x, z) > 9) {
    const tunnel =
      Math.sin(x * 0.12 + Math.sin(z * 0.09) * 2 + (s % 91)) +
      Math.sin(y * 0.22 + z * 0.11) +
      Math.cos(z * 0.13 - x * 0.065 + y * 0.095);
    if (tunnel > 2.35) return generatorVersion >= 3 && y <= -5 ? 76 : 0;
  }
  if (y === top) return top <= LEGACY_SEA_LEVEL + 1 ? 4 : 1;
  if (y >= top - 3) return top <= LEGACY_SEA_LEVEL + 1 ? 4 : 2;
  const cluster = hash(
    s + 352,
    Math.floor(x / 3),
    Math.floor(y / 3),
    Math.floor(z / 3),
  );
  const speck = hash(s + 99, x, y, z);
  if (cluster > 0.89 && speck > 0.24)
    return generatorVersion >= 4 && y <= 0 ? 92 : 9;
  if (cluster > 0.78 && cluster < 0.85 && speck > 0.3)
    return generatorVersion >= 4 && y <= 0 ? 93 : 10;
  if (cluster > 0.72 && cluster < 0.75 && y < 14) return 5;
  if (generatorVersion >= 4)
    return mineralAt(seed, s, x, y, z) || (y <= 0 ? 90 : 3);
  return 3;
}
