export const WORLD_MIN_Y = -16;
export const WORLD_MAX_Y = 95;
export const SEA_LEVEL = 19;
export const CHUNK_SIZE = 16;

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
export function surfaceHeight(seed: string, x: number, z: number): number {
  x = Math.floor(x);
  z = Math.floor(z);
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

function treeAt(seed: string, x: number, y: number, z: number): number {
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
        (tx > 5 && tx < 35 && Math.abs(tz - 2) < 9)
      )
        continue;
      candidates.push([tx, tz, 4 + Math.floor(hash(s, cx, 8, cz) * 3)]);
    }
  for (const [tx, tz, tall] of candidates) {
    const dx = Math.abs(x - tx),
      dz = Math.abs(z - tz);
    if (dx > 2 || dz > 2) continue;
    const floor = surfaceHeight(seed, tx, tz);
    if (floor <= SEA_LEVEL + 1) continue;
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

/** Deterministic terrain; trees never cover the safe spawn at (0, 0). */
export function sampleBlock(
  seed: string,
  x: number,
  y: number,
  z: number,
  generatorVersion: 1 | 2 | 3 | 4 = 1,
): number {
  x = Math.floor(x);
  y = Math.floor(y);
  z = Math.floor(z);
  if (y <= WORLD_MIN_Y) return 24;
  if (y > WORLD_MAX_Y) return 0;
  const top = surfaceHeight(seed, x, z);
  if (y > top) {
    if (y <= SEA_LEVEL) return 6;
    if (y > top + 9) return 0;
    const tree = treeAt(seed, x, y, z);
    if (tree) return tree;
    // Version 1 terrain remains byte-for-byte unchanged for existing saves.
    if (
      generatorVersion >= 2 &&
      y === top + 1 &&
      top > SEA_LEVEL + 1 &&
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
  if (y < top - 5 && y > WORLD_MIN_Y + 3 && Math.hypot(x, z) > 9) {
    const tunnel =
      Math.sin(x * 0.12 + Math.sin(z * 0.09) * 2 + (s % 91)) +
      Math.sin(y * 0.22 + z * 0.11) +
      Math.cos(z * 0.13 - x * 0.065 + y * 0.095);
    if (tunnel > 2.35) return generatorVersion >= 3 && y <= -5 ? 76 : 0;
  }
  if (y === top) return top <= SEA_LEVEL + 1 ? 4 : 1;
  if (y >= top - 3) return top <= SEA_LEVEL + 1 ? 4 : 2;
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
