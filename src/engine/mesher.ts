import { mineralAppearance } from "../game/mineral-appearance";
import type {
  MineralAppearance,
  MineralColor,
} from "../game/mineral-appearance";
import { sampleBlock } from "./generator";
import { CHUNK_SIZE, WORLD_MIN_Y, WORLD_MAX_Y } from "./world-height";
import {
  fluidSurfaceHeights,
  fluidSurfaceQuads,
  isOpaque,
  plantHeight,
  plantStage,
} from "./shapes";
import { fluidInfo } from "../game/fluid-blocks";
import type { BlockBox } from "./shapes";
import type { ChunkRequest, ChunkResult, MeshArrays } from "./protocol";

const directions = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
// Counter-clockwise when viewed from the outside.
const corners = [
  [
    [1, 0, 1],
    [1, 0, 0],
    [1, 1, 1],
    [1, 1, 0],
  ],
  [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
    [0, 1, 1],
  ],
  [
    [0, 1, 1],
    [1, 1, 1],
    [0, 1, 0],
    [1, 1, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [0, 0, 1],
    [1, 0, 1],
  ],
  [
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ],
  [
    [1, 0, 0],
    [0, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ],
];
const tiles: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 15,
  7: 6,
  8: 8,
  9: 9,
  10: 10,
  11: 11,
  12: 12,
  13: 11,
  14: 12,
  15: 11,
  16: 6,
  17: 15,
  18: 11,
  19: 11,
  20: 11,
  21: 11,
  22: 15,
  23: 15,
  24: 3,
  25: 11,
  26: 11,
  27: 15,
  81: 3,
  82: 8,
};
export interface PlantVisualPart {
  box: BlockBox;
  tint: [number, number, number];
  tile: number;
}
const plantCache = new Map<number, readonly PlantVisualPart[]>();
/** A bounded seven-part sapling silhouette: stem, crossed branches and leaf clusters. */
export const saplingVisualParts: readonly PlantVisualPart[] = [
  { box: [0.47, 0, 0.47, 0.53, 0.72, 0.53], tint: [0.64, 0.49, 0.3], tile: 6 },
  {
    box: [0.26, 0.31, 0.47, 0.73, 0.35, 0.53],
    tint: [0.7, 0.54, 0.32],
    tile: 6,
  },
  {
    box: [0.47, 0.51, 0.23, 0.53, 0.55, 0.77],
    tint: [0.7, 0.54, 0.32],
    tile: 6,
  },
  {
    box: [0.16, 0.32, 0.34, 0.41, 0.51, 0.66],
    tint: [0.76, 0.95, 0.59],
    tile: 8,
  },
  { box: [0.6, 0.32, 0.35, 0.84, 0.5, 0.65], tint: [0.83, 1, 0.68], tile: 8 },
  { box: [0.32, 0.53, 0.16, 0.69, 0.69, 0.84], tint: [0.87, 1, 0.67], tile: 8 },
  { box: [0.34, 0.67, 0.34, 0.66, 0.84, 0.66], tint: [0.95, 1, 0.73], tile: 8 },
];
/** Small cached voxel models: no per-frame meshes, textures or materials per plant. */
export function plantVisualParts(id: number): readonly PlantVisualPart[] {
  const cached = plantCache.get(id);
  if (cached) return cached;
  const plant = plantStage(id);
  if (!plant) return [];
  const parts: PlantVisualPart[] = [];
  const add = (box: BlockBox, tint: [number, number, number], tile = 15) =>
    parts.push({ box, tint, tile });
  const h = plantHeight(id),
    g = plant.stages > 1 ? plant.stage / (plant.stages - 1) : 1;
  const green: [number, number, number] = [
    0.35 - g * 0.11,
    0.68 - g * 0.11,
    0.13,
  ];
  const bright: [number, number, number] = [
    0.53 - g * 0.12,
    0.78 - g * 0.13,
    0.2,
  ];
  if (plant.kind === "grass") {
    // Three stepped, volumetric blades; 6 boxes total for naturally generated grass.
    for (const [x, z, ratio, sign] of [
      [0.34, 0.37, 0.78, -1],
      [0.52, 0.56, 1, 1],
      [0.67, 0.4, 0.65, 1],
    ]) {
      add(
        [x - 0.021, 0, z - 0.032, x + 0.021, h * ratio * 0.7, z + 0.032],
        green,
      );
      const tip = x + sign * 0.045;
      add(
        [
          Math.min(x, tip) - 0.014,
          h * ratio * 0.55,
          z - 0.021,
          Math.max(x, tip) + 0.014,
          h * ratio,
          z + 0.021,
        ],
        bright,
      );
    }
  } else if (plant.kind === "wheat") {
    const ripe = plant.stage === 7;
    const stem: [number, number, number] = ripe ? [0.8, 0.64, 0.26] : green;
    const leaf: [number, number, number] = ripe ? [0.68, 0.65, 0.24] : bright;
    for (const [x, z, ratio] of [
      [0.34, 0.32, 1],
      [0.64, 0.41, 0.83],
      [0.49, 0.64, 0.92],
    ]) {
      const top = h * ratio,
        length = 0.08 + g * 0.12,
        half = 0.018 + g * 0.008;
      add([x - half, -1 / 16, z - half, x + half, top, z + half], stem);
      add(
        [x - length, top * 0.28, z - 0.025, x, top * 0.28 + 0.035, z + 0.025],
        leaf,
      );
      add(
        [x, top * 0.55, z - 0.022, x + length, top * 0.55 + 0.03, z + 0.022],
        leaf,
      );
      if (plant.stage >= 4) {
        const ear: [number, number, number] = ripe
          ? [0.99, 0.77, 0.28]
          : [0.61 + g * 0.15, 0.75, 0.21];
        const pale: [number, number, number] = ripe
          ? [1, 0.88, 0.47]
          : [0.8, 0.86, 0.33];
        const base = top - (0.09 + g * 0.14);
        add(
          [x - 0.046, base, z - 0.043, x + 0.046, top - 0.035, z + 0.043],
          ear,
        );
        add(
          [
            x - 0.066,
            base + 0.035,
            z - 0.035,
            x - 0.02,
            base + 0.086,
            z + 0.035,
          ],
          pale,
        );
        add(
          [
            x + 0.02,
            base + 0.09,
            z - 0.035,
            x + 0.066,
            Math.min(top - 0.025, base + 0.145),
            z + 0.035,
          ],
          pale,
        );
        add([x - 0.009, top - 0.04, z - 0.01, x + 0.009, top, z + 0.01], pale);
      }
    }
  } else {
    const beet = plant.kind === "beetroot",
      potato = plant.kind === "potato";
    const stem: [number, number, number] = beet ? [0.68, 0.19, 0.29] : green;
    const leaves: [number, number, number] = beet
      ? [0.27, 0.52, 0.19]
      : potato
        ? [0.29, 0.59, 0.23]
        : bright;
    add([0.476, -1 / 16, 0.476, 0.524, h, 0.524], stem);
    const length = 0.11 + g * 0.2,
      width =
        (potato || beet ? 0.045 : 0.024) + g * (potato || beet ? 0.045 : 0.018);
    const count = plant.stage === 0 ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const alongX = i % 2 === 0,
        sign = i < 2 ? 1 : -1;
      const y = h * (0.44 + i * 0.09),
        end = 0.5 + sign * length;
      const near = 0.5 + sign * length * 0.46;
      if (alongX) {
        add(
          [
            Math.min(0.5, near),
            y,
            0.5 - width,
            Math.max(0.5, near),
            y + 0.03,
            0.5 + width,
          ],
          stem,
        );
        add(
          [
            Math.min(near, end),
            y + 0.025,
            0.5 - width,
            Math.max(near, end),
            Math.min(h, y + 0.085),
            0.5 + width,
          ],
          leaves,
        );
      } else {
        add(
          [
            0.5 - width,
            y,
            Math.min(0.5, near),
            0.5 + width,
            y + 0.03,
            Math.max(0.5, near),
          ],
          stem,
        );
        add(
          [
            0.5 - width,
            y + 0.025,
            Math.min(near, end),
            0.5 + width,
            Math.min(h, y + 0.085),
            Math.max(near, end),
          ],
          leaves,
        );
      }
    }
    if (g >= 0.55) {
      const r = 0.04 + g * 0.07;
      const root: [number, number, number] = beet
        ? [0.64, 0.12, 0.23]
        : potato
          ? [0.73, 0.57, 0.31]
          : [1, 0.49, 0.12];
      add(
        [0.5 - r, -1 / 16, 0.5 - r, 0.5 + r, 0.04 + g * 0.065, 0.5 + r],
        root,
      );
      if (beet)
        add(
          [
            0.5 - r * 0.7,
            0.075,
            0.5 - r * 0.7,
            0.5 + r * 0.7,
            0.115,
            0.5 + r * 0.7,
          ],
          [0.79, 0.2, 0.31],
        );
      if (potato)
        add([0.32, -1 / 16, 0.48, 0.43, 0.05, 0.59], [0.81, 0.66, 0.4]);
    }
    if (potato && plant.stage >= 5) {
      // Small pale flowers make potato foliage distinct from carrots at maturity.
      const y = h - 0.032;
      add([0.43, y, 0.48, 0.57, h, 0.52], [0.92, 0.86, 0.98]);
      add([0.48, y, 0.43, 0.52, h, 0.57], [0.92, 0.86, 0.98]);
      add([0.485, y + 0.004, 0.485, 0.515, h, 0.515], [1, 0.8, 0.22]);
    }
  }
  plantCache.set(id, parts);
  return parts;
}

type Builder = {
  p: number[];
  n: number[];
  u: number[];
  c: number[];
  i: number[];
};
function empty(): Builder {
  return { p: [], n: [], u: [], c: [], i: [] };
}

// One worker owns one world's bounded cache. Adjacent vertical sections reuse the
// same complete column scan instead of rescanning 384 heights for every mesh.
const MAX_ROOF_COLUMNS = 65536;
let roofWorld = "";
const roofCache = new Map<string, { signature: string; height: number }>();
function columnRoof(
  request: ChunkRequest,
  x: number,
  z: number,
  changes?: Map<number, number>,
): number {
  const key = x + "," + z;
  // Revisions belong to sections; only changes in this column affect its roof.
  const signature = changes
    ? [...changes]
        .sort((a, b) => a[0] - b[0])
        .map(([y, id]) => y + ":" + id)
        .join(";")
    : "";
  const cached = roofCache.get(key);
  if (cached?.signature === signature) return cached.height;
  let height = WORLD_MAX_Y;
  for (; height >= WORLD_MIN_Y; height--) {
    const id =
      changes?.get(height) ??
      sampleBlock(request.seed, x, height, z, request.generatorVersion);
    if (isOpaque(id)) break;
  }
  if (roofCache.size >= MAX_ROOF_COLUMNS)
    roofCache.delete(roofCache.keys().next().value!);
  roofCache.set(key, { signature, height });
  return height;
}

export function buildChunk(request: ChunkRequest): ChunkResult {
  const identity = JSON.stringify([
    request.worldId,
    request.seed,
    request.generatorVersion ?? 1,
  ]);
  if (identity !== roofWorld) {
    roofWorld = identity;
    roofCache.clear();
  }
  const { seed, cx, cy, cz } = request;
  const ox = cx * CHUNK_SIZE,
    oy = cy * CHUNK_SIZE,
    oz = cz * CHUNK_SIZE;
  const padded = new Uint16Array(18 * 18 * 18);
  const offset = (x: number, y: number, z: number) =>
    (y + 1) * 324 + (z + 1) * 18 + x + 1;
  for (let y = -1; y <= 16; y++)
    for (let z = -1; z <= 16; z++)
      for (let x = -1; x <= 16; x++) {
        padded[offset(x, y, z)] =
          oy + y < WORLD_MIN_Y || oy + y > WORLD_MAX_Y
            ? 0
            : sampleBlock(
                seed,
                ox + x,
                oy + y,
                oz + z,
                request.generatorVersion,
              );
      }
  for (const change of request.changes) {
    const x = change.x - ox,
      y = change.y - oy,
      z = change.z - oz;
    if (
      change.y >= WORLD_MIN_Y &&
      change.y <= WORLD_MAX_Y &&
      x >= -1 &&
      x <= 16 &&
      y >= -1 &&
      y <= 16 &&
      z >= -1 &&
      z <= 16
    )
      padded[offset(x, y, z)] = change.id;
  }
  const get = (x: number, y: number, z: number) => padded[offset(x, y, z)];
  // Bake vertical sky occlusion into terrain color. Point lights still illuminate
  // these surfaces, while the scene's global daylight no longer fills deep caves.
  const roofs = new Int16Array(18 * 18);
  const changedColumns = new Map<string, Map<number, number>>();
  const roofOffset = (x: number, z: number) => (z + 1) * 18 + x + 1;
  for (const change of request.changes) {
    if (change.y < WORLD_MIN_Y || change.y > WORLD_MAX_Y) continue;
    const key = change.x + "," + change.z;
    let column = changedColumns.get(key);
    if (!column) changedColumns.set(key, (column = new Map()));
    column.set(change.y, change.id);
  }
  for (let z = -1; z <= 16; z++)
    for (let x = -1; x <= 16; x++) {
      roofs[roofOffset(x, z)] = columnRoof(
        request,
        ox + x,
        oz + z,
        changedColumns.get(ox + x + "," + (oz + z)),
      );
    }
  const voxels = new Uint16Array(4096),
    layers = [empty(), empty(), empty(), empty()];
  function addBox(
    x: number,
    y: number,
    z: number,
    id: number,
    box: BlockBox,
    layer = 0,
    tint = [1, 1, 1],
    tileOverride?: number,
  ) {
    const b = layers[layer];
    for (let face = 0; face < 6; face++) {
      const d = directions[face],
        neighbor = get(x + d[0], y + d[1], z + d[2]);
      const edge =
        face === 0
          ? box[3] === 1
          : face === 1
            ? box[0] === 0
            : face === 2
              ? box[4] === 1
              : face === 3
                ? box[1] === 0
                : face === 4
                  ? box[5] === 1
                  : box[2] === 0;
      if (
        edge &&
        (isOpaque(neighbor) ||
          (neighbor === id && id === 17) ||
          ((id === 8 || id === 82) && (neighbor === 8 || neighbor === 82)))
      )
        continue;
      let tile = tileOverride ?? tiles[id] ?? 3;
      if (tileOverride === undefined) {
        if (id === 1) tile = face === 2 ? 0 : face === 3 ? 2 : 1;
        if (id === 7 && (face === 2 || face === 3)) tile = 7;
        if (id === 13 && face === 2) tile = 13;
        if (id === 14 && face === 5) tile = 14;
        if (id === 15 && face === 5) tile = 13;
      }
      const base = b.p.length / 3,
        col = tile % 4,
        row = Math.floor(tile / 4);
      const depth = roofs[roofOffset(x + d[0], z + d[2])] - (oy + y + d[1]) + 1;
      const sky = depth <= 0 ? 1 : 0.18 + 0.82 * Math.exp(-depth / 2.5);
      const shade =
        layer === 3
          ? 1
          : (face === 2
              ? 1
              : face === 3
                ? 0.52
                : face === 0 || face === 1
                  ? 0.82
                  : 0.69) * sky;
      for (let corner = 0; corner < 4; corner++) {
        const p = corners[face][corner];
        b.p.push(
          x + box[0] + p[0] * (box[3] - box[0]),
          y + box[1] + p[1] * (box[4] - box[1]),
          z + box[2] + p[2] * (box[5] - box[2]),
        );
        b.n.push(...d);
        const u = corner % 2,
          v = corner >= 2 ? 1 : 0,
          inset = 0.001;
        b.u.push(
          (col + inset + u * (1 - inset * 2)) / 4,
          1 - (row + 1 - inset - v * (1 - inset * 2)) / 4,
        );
        b.c.push(tint[0] * shade, tint[1] * shade, tint[2] * shade);
      }
      b.i.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  function addFluid(x: number, y: number, z: number, id: number) {
    const info = fluidInfo(id)!;
    const heights = fluidSurfaceHeights(id, x, y, z, get),
      quads = fluidSurfaceQuads(heights),
      lava = info.kind === "lava",
      b = layers[lava ? 3 : 2];
    for (let face = 0; face < 6; face++) {
      const d = directions[face],
        neighbor = get(x + d[0], y + d[1], z + d[2]),
        other = fluidInfo(neighbor),
        atBoundary = face !== 2 || heights.every((height) => height === 1);
      // All levels of a connected liquid share their corner heights, so the
      // shared wall is entirely internal. Lava owns any temporary mixed edge.
      if (
        other?.kind === info.kind ||
        (!lava && other?.kind === "lava") ||
        (atBoundary && isOpaque(neighbor))
      )
        continue;
      const base = b.p.length / 3,
        depth = roofs[roofOffset(x + d[0], z + d[2])] - (oy + y + d[1]) + 1,
        sky = depth <= 0 ? 1 : 0.18 + 0.82 * Math.exp(-depth / 2.5),
        shade = lava
          ? 1
          : (face === 2 ? 1 : face === 3 ? 0.52 : face < 2 ? 0.82 : 0.69) * sky;
      for (let corner = 0; corner < 4; corner++) {
        const p = quads[face][corner];
        b.p.push(x + p[0], y + p[1], z + p[2]);
        b.n.push(...d);
        const u = corner % 2,
          v = face === 2 || face === 3 ? (corner >= 2 ? 1 : 0) : p[1],
          inset = 0.001;
        b.u.push(
          (3 + inset + u * (1 - inset * 2)) / 4,
          1 - (4 - inset - v * (1 - inset * 2)) / 4,
        );
        // Existing mottled atlas tile, with hot and cooler corners on an unlit
        // material. Bright lava remains readable at night and below a cave roof.
        const heat = lava
          ? ((((ox + x + oz + z + corner) % 3) + 3) % 3) / 2
          : 0;
        const tint = lava
          ? [1, 0.29 + heat * 0.23, 0.025 + heat * 0.04]
          : [0.23, 0.61, 0.85];
        b.c.push(tint[0] * shade, tint[1] * shade, tint[2] * shade);
      }
      b.i.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  function addMineral(
    x: number,
    y: number,
    z: number,
    id: number,
    appearance: MineralAppearance,
  ) {
    addBox(
      x,
      y,
      z,
      id,
      [0, 0, 0, 1, 1, 1],
      0,
      appearance.base,
      appearance.tile,
    );
    const b = layers[0];
    for (let face = 0; face < 6; face++) {
      const d = directions[face];
      if (isOpaque(get(x + d[0], y + d[1], z + d[2]))) continue;
      const depth = roofs[roofOffset(x + d[0], z + d[2])] - (oy + y + d[1]) + 1,
        sky = depth <= 0 ? 1 : 0.18 + 0.82 * Math.exp(-depth / 2.5),
        shade =
          (face === 2 ? 1 : face === 3 ? 0.52 : face < 2 ? 0.82 : 0.69) * sky;
      // Tiny raised, stepped crystal faces retain the stone between the grains.
      // Each exposed face has at most eight extra quads; hidden grains emit none.
      const patch = (
        u: number,
        v: number,
        width: number,
        height: number,
        color: MineralColor,
        lift = 0.0015,
      ) => {
        const base = b.p.length / 3,
          c = corners[face],
          inset = 0.001;
        for (const [pu, pv] of [
          [u, v],
          [u + width, v],
          [u, v + height],
          [u + width, v + height],
        ]) {
          for (let axis = 0; axis < 3; axis++)
            b.p.push(
              [x, y, z][axis] +
                c[0][axis] +
                (c[1][axis] - c[0][axis]) * pu +
                (c[2][axis] - c[0][axis]) * pv +
                d[axis] * lift,
            );
          b.n.push(...d);
          b.u.push(
            (3 + inset + pu * (1 - inset * 2)) / 4,
            1 - (4 - inset - pv * (1 - inset * 2)) / 4,
          );
          b.c.push(color[0] * shade, color[1] * shade, color[2] * shade);
        }
        b.i.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      };
      if (appearance.kind === "ore" || appearance.kind === "raw") {
        const raw = appearance.kind === "raw";
        for (const [u, v, w, h] of raw
          ? [
              [0.05, 0.08, 0.39, 0.31],
              [0.53, 0.14, 0.39, 0.4],
              [0.19, 0.52, 0.34, 0.39],
              [0.65, 0.67, 0.26, 0.26],
            ]
          : [
              [0.14, 0.16, 0.18, 0.12],
              [0.58, 0.3, 0.18, 0.21],
              [0.31, 0.64, 0.26, 0.12],
              [0.73, 0.73, 0.1, 0.12],
            ]) {
          patch(u, v, w, h, appearance.grain);
          patch(
            u + w * 0.18,
            v + h * 0.58,
            w * 0.6,
            h * 0.42,
            appearance.highlight,
            0.0025,
          );
        }
      } else if (appearance.kind === "slate") {
        patch(0, 0.25, 1, 0.055, appearance.grain);
        patch(0.22, 0.69, 0.78, 0.055, appearance.grain);
      } else {
        patch(0.08, 0.08, 0.84, 0.84, appearance.grain);
        patch(0.08, 0.84, 0.84, 0.08, appearance.highlight, 0.0025);
        patch(0.08, 0.15, 0.07, 0.69, appearance.highlight, 0.0025);
        patch(0.66, 0.22, 0.14, 0.09, appearance.highlight, 0.0025);
      }
    }
  }
  for (let y = 0; y < 16; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const id = get(x, y, z);
        voxels[y * 256 + z * 16 + x] = id;
        if (!id) continue;
        const mineral = mineralAppearance(id);
        if (mineral) {
          addMineral(x, y, z, id, mineral);
        } else if (fluidInfo(id)) {
          addFluid(x, y, z, id);
        } else if (id === 83) {
          for (const part of saplingVisualParts)
            addBox(x, y, z, id, part.box, 1, part.tint, part.tile);
        } else if (id >= 59 && id <= 67) {
          const wood = [0.8, 0.67, 0.46];
          addBox(x, y, z, id, [0.04, 0, 0.04, 0.96, 0.13, 0.96], 0, wood, 11);
          addBox(
            x,
            y,
            z,
            id,
            [0.04, 0.1, 0.04, 0.16, 0.875, 0.96],
            0,
            wood,
            11,
          );
          addBox(
            x,
            y,
            z,
            id,
            [0.84, 0.1, 0.04, 0.96, 0.875, 0.96],
            0,
            wood,
            11,
          );
          addBox(
            x,
            y,
            z,
            id,
            [0.16, 0.1, 0.04, 0.84, 0.875, 0.16],
            0,
            wood,
            11,
          );
          addBox(
            x,
            y,
            z,
            id,
            [0.16, 0.1, 0.84, 0.84, 0.875, 0.96],
            0,
            wood,
            11,
          );
          if (id > 59) {
            const top = 0.16 + (id - 59) * 0.074;
            addBox(
              x,
              y,
              z,
              id,
              [0.16, 0.13, 0.16, 0.84, top, 0.84],
              0,
              id === 67 ? [0.76, 0.68, 0.48] : [0.35, 0.29, 0.2],
              id === 67 ? 15 : 2,
            );
            if (id === 67)
              for (const [sx, sz] of [
                [0.26, 0.29],
                [0.57, 0.24],
                [0.41, 0.56],
                [0.64, 0.62],
              ]) {
                addBox(
                  x,
                  y,
                  z,
                  id,
                  [sx, top, sz, sx + 0.09, top + 0.012, sz + 0.08],
                  0,
                  [0.91, 0.86, 0.67],
                  15,
                );
              }
          }
        } else if (id === 28 || id === 29) {
          // Actual 1/16-deep furrows, with a clear dry/wet soil color difference.
          const soil = id === 29 ? [0.44, 0.35, 0.27] : [0.78, 0.63, 0.44];
          addBox(x, y, z, id, [0, 0, 0, 1, 14 / 16, 1], 0, soil, 2);
          for (let row = 0; row < 4; row++) {
            addBox(
              x,
              y,
              z,
              id,
              [0, 14 / 16, row / 4 + 0.025, 1, 15 / 16, row / 4 + 0.215],
              0,
              soil,
              2,
            );
          }
        } else if (plantStage(id)) {
          for (const part of plantVisualParts(id))
            addBox(x, y, z, id, part.box, 1, part.tint, part.tile);
        } else if (id === 20) {
          addBox(x, y, z, id, [0.1, 0, 0.92, 0.21, 1, 0.99]);
          addBox(x, y, z, id, [0.79, 0, 0.92, 0.9, 1, 0.99]);
          for (let rung = 0; rung < 4; rung++)
            addBox(x, y, z, id, [
              0.15,
              0.12 + rung * 0.25,
              0.9,
              0.85,
              0.19 + rung * 0.25,
              0.97,
            ]);
        } else if (id === 16) {
          addBox(x, y, z, id, [0.445, 0, 0.445, 0.555, 0.67, 0.555]);
          addBox(
            x,
            y,
            z,
            id,
            [0.41, 0.62, 0.41, 0.59, 0.84, 0.59],
            3,
            [1, 0.76, 0.26],
            15,
          );
        } else if (id === 18 || id === 25 || id === 19 || id === 26) {
          const open = id === 19 || id === 26;
          const box: BlockBox = open
            ? [0, 0, 0, 0.1875, 1, 1]
            : [0, 0, 0.8125, 1, 1, 1];
          addBox(x, y, z, id, box, 0, [0.89, 0.79, 0.63]);
          if (id === 18)
            addBox(
              x,
              y,
              z,
              id,
              [0.77, 0.75, 0.77, 0.86, 0.85, 0.82],
              0,
              [0.85, 0.72, 0.37],
              15,
            );
          if (id === 19)
            addBox(
              x,
              y,
              z,
              id,
              [0.18, 0.75, 0.77, 0.23, 0.85, 0.86],
              0,
              [0.85, 0.72, 0.37],
              15,
            );
        } else if (id === 22 || id === 27) {
          addBox(
            x,
            y,
            z,
            id,
            [0.04, 0.21, 0.02, 0.96, 0.4, 0.98],
            0,
            [0.8, 0.63, 0.43],
            11,
          );
          addBox(
            x,
            y,
            z,
            id,
            [0.02, 0.4, 0.01, 0.98, 0.5625, 0.99],
            0,
            [0.82, 0.2, 0.17],
            15,
          );
          if (id === 27)
            addBox(
              x,
              y,
              z,
              id,
              [0.1, 0.56, 0.58, 0.9, 0.61, 0.94],
              0,
              [1, 1, 0.92],
              15,
            );
          for (const lx of [0.08, 0.78])
            for (const lz of [0.08, 0.78])
              addBox(
                x,
                y,
                z,
                id,
                [lx, 0, lz, lx + 0.13, 0.23, lz + 0.13],
                0,
                [0.65, 0.48, 0.33],
                11,
              );
        } else if (id === 21) {
          addBox(x, y, z, id, [0, 0, 0, 1, 0.5, 1]);
        } else if (id === 17) {
          addBox(x, y, z, id, [0, 0, 0, 1, 1, 1], 2, [0.75, 0.94, 1]);
        } else {
          addBox(
            x,
            y,
            z,
            id,
            [0, 0, 0, 1, 1, 1],
            id === 8 || id === 82 ? 1 : 0,
            id === 81
              ? [0.19, 0.11, 0.28]
              : id === 24
                ? [0.45, 0.45, 0.48]
                : [1, 1, 1],
          );
        }
      }
  const arrays: MeshArrays[] = layers.map((b) => ({
    positions: new Float32Array(b.p),
    normals: new Float32Array(b.n),
    uvs: new Float32Array(b.u),
    colors: new Float32Array(b.c),
    indices: new Uint32Array(b.i),
  }));
  return {
    worldId: request.worldId,
    key: request.key,
    revision: request.revision,
    voxels,
    layers: arrays,
  };
}
