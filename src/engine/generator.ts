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

/** Deterministic terrain; trees never cover the safe spawn at (0, 0). */
export function sampleBlock(
  seed: string,
  x: number,
  y: number,
  z: number,
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
    return treeAt(seed, x, y, z);
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
    if (tunnel > 2.35) return 0;
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
  if (cluster > 0.89 && speck > 0.24) return 9;
  if (cluster > 0.78 && cluster < 0.85 && speck > 0.3) return 10;
  if (cluster > 0.72 && cluster < 0.75 && y < 14) return 5;
  return 3;
}
