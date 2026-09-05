/** Generator 7 landmark. All parts are real, editable voxels, shared by workers. */
export const SEASIDE_VILLA = { x: 32, y: 69, z: -10 } as const;

const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function coastWeight(x: number, z: number): number {
  const edge = clamp(Math.min(x + 96, 144 - x, z + 224, 32 - z) / 32);
  return edge * edge * (3 - 2 * edge);
}
export function coastHeight(x: number, z: number, original: number): number {
  const weight = coastWeight(x, z);
  // A level lawn, a walkable sand slope and a broad, gently deepening bay.
  const shore = z >= -34 ? 68 : Math.max(51, 68 + (z + 34) / 2.5);
  return Math.floor(original * (1 - weight) + shore * weight);
}

const blocks = new Map<string, number>();
const put = (x: number, y: number, z: number, id: number) =>
  blocks.set(`${x},${y},${z}`, id);
const box = (
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  id: number,
) => {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) put(x, y, z, id);
};

// White two-storey villa, oak floors, continuous glass bays and roof overhangs.
box(17, 67, -32, 47, 68, -9, 23);
box(19, 68, -30, 45, 68, -11, 11);
box(18, 69, -30, 46, 79, -10, 0);
for (const [bottom, top] of [
  [69, 73],
  [75, 79],
]) {
  for (let x = 18; x <= 46; x++)
    for (let z = -30; z <= -10; z++) {
      if (x !== 18 && x !== 46 && z !== -30 && z !== -10) continue;
      const pillar =
        x === 18 || x === 46 ? (z + 30) % 5 === 0 : (x - 18) % 7 === 0;
      for (let y = bottom; y <= top; y++)
        put(x, y, z, y === bottom || pillar ? 23 : 17);
    }
}
box(17, 74, -32, 47, 74, -9, 23);
box(19, 74, -30, 45, 74, -11, 11);
box(16, 80, -32, 48, 80, -8, 23);
// Main entrance is open and three blocks wide. Sea-facing balcony doors too.
box(31, 69, -10, 33, 72, -10, 0);
box(31, 75, -30, 33, 78, -30, 0);
box(25, 74, -36, 40, 74, -31, 11);
box(25, 75, -36, 40, 75, -36, 17);
box(25, 75, -35, 25, 75, -31, 17);
box(40, 75, -35, 40, 75, -31, 17);
// Six full-block steps with a stairwell cut through the upper floor.
box(20, 69, -23, 23, 78, -13, 0);
for (let i = 0; i < 6; i++) box(20, 69, -15 - i, 23, 69 + i, -15 - i, 11);
box(20, 74, -25, 23, 74, -21, 11);
// Living room, kitchen and upstairs bedrooms.
box(37, 69, -18, 42, 69, -18, 23);
box(37, 70, -19, 42, 70, -19, 23);
box(38, 69, -15, 41, 69, -15, 21);
box(39, 69, -27, 44, 69, -27, 11);
put(43, 70, -27, 14);
put(40, 70, -27, 13);
put(39, 75, -25, 22);
put(39, 75, -26, 27);
put(42, 75, -25, 22);
put(42, 75, -26, 27);
put(43, 75, -15, 15);
for (const y of [69, 75]) for (const x of [25, 35, 44]) put(x, y, -12, 16);
// Pool has a solid basin and water surface one block below the lawn.
box(50, 65, -30, 64, 68, -13, 23);
box(51, 66, -29, 63, 67, -14, 6);
box(51, 68, -29, 63, 68, -14, 0);
// Shallow entry steps let a swimming player walk/jump out.
box(51, 66, -16, 53, 66, -14, 23);
box(51, 67, -15, 53, 67, -15, 132);
box(51, 67, -14, 53, 67, -14, 23);
box(66, 69, -23, 66, 69, -19, 21);
box(69, 69, -23, 69, 69, -19, 21);
// Arrival path and a stepped walk down to the pier.
box(0, 68, -2, 33, 68, 1, 12);
box(30, 68, -9, 33, 68, -2, 12);
for (let z = -35; z >= -44; z--) {
  const y = Math.max(64, Math.floor(68 + (z + 34) / 2.5));
  box(30, y, z, 34, y, z, 11);
}
box(30, 64, -69, 34, 64, -45, 11);
box(27, 64, -72, 37, 64, -65, 11);
for (const z of [-47, -55, -63, -70])
  for (const x of [30, 34]) {
    box(x, 53, z, x, 65, z, 7);
    put(x, 66, z, 16);
  }
// Stylized palms built from existing log and persistent foliage voxels.
for (const [x, z, ground] of [
  [9, -34, 68],
  [73, -32, 68],
  [5, -45, 63],
  [61, -44, 64],
]) {
  box(x, ground + 1, z, x, ground + 7, z, 7);
  box(x - 1, ground + 8, z - 1, x + 1, ground + 8, z + 1, 82);
  for (let d = 1; d <= 4; d++) {
    const y = ground + 8 - Math.floor(d / 3);
    put(x + d, y, z, 82);
    put(x - d, y, z, 82);
    put(x, y, z + d, 82);
    put(x, y, z - d, 82);
  }
}

export function coastStructure(
  x: number,
  y: number,
  z: number,
): number | undefined {
  if (x < 0 || x > 77 || y < 53 || y > 80 || z < -72 || z > 1) return undefined;
  return blocks.get(`${x},${y},${z}`);
}
