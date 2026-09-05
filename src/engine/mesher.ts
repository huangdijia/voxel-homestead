import {
  sampleBlock,
  surfaceHeight,
  CHUNK_SIZE,
  WORLD_MIN_Y,
} from "./generator";
import { isOpaque, plantHeight, plantStage } from "./shapes";
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
};
export interface PlantVisualPart {
  box: BlockBox;
  tint: [number, number, number];
  tile: number;
}
const plantCache = new Map<number, readonly PlantVisualPart[]>();
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

export function buildChunk(request: ChunkRequest): ChunkResult {
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
        padded[offset(x, y, z)] = sampleBlock(
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
    if (x >= -1 && x <= 16 && y >= -1 && y <= 16 && z >= -1 && z <= 16)
      padded[offset(x, y, z)] = change.id;
  }
  const get = (x: number, y: number, z: number) => padded[offset(x, y, z)];
  // Bake vertical sky occlusion into terrain color. Point lights still illuminate
  // these surfaces, while the scene's global daylight no longer fills deep caves.
  const roofs = new Int16Array(18 * 18);
  const changesByPosition = new Map(
    request.changes.map((c) => [c.x + "," + c.y + "," + c.z, c.id]),
  );
  const roofOffset = (x: number, z: number) => (z + 1) * 18 + x + 1;
  for (let z = -1; z <= 16; z++)
    for (let x = -1; x <= 16; x++)
      roofs[roofOffset(x, z)] = surfaceHeight(seed, ox + x, oz + z);
  for (const change of request.changes) {
    const x = change.x - ox,
      z = change.z - oz;
    if (x >= -1 && x <= 16 && z >= -1 && z <= 16 && isOpaque(change.id))
      roofs[roofOffset(x, z)] = Math.max(roofs[roofOffset(x, z)], change.y);
  }
  for (let z = -1; z <= 16; z++)
    for (let x = -1; x <= 16; x++) {
      const index = roofOffset(x, z);
      let y = roofs[index];
      while (y > WORLD_MIN_Y) {
        const id =
          changesByPosition.get(ox + x + "," + y + "," + (oz + z)) ??
          sampleBlock(seed, ox + x, y, oz + z, request.generatorVersion);
        if (isOpaque(id)) break;
        y--;
      }
      roofs[index] = y;
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
          (neighbor === id && (id === 6 || id === 8 || id === 17)))
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
  for (let y = 0; y < 16; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const id = get(x, y, z);
        voxels[y * 256 + z * 16 + x] = id;
        if (!id) continue;
        if (id >= 59 && id <= 67) {
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
        } else if (id === 6) {
          addBox(
            x,
            y,
            z,
            id,
            [0, 0, 0, 1, get(x, y + 1, z) === 6 ? 1 : 0.87, 1],
            2,
            [0.23, 0.61, 0.85],
          );
        } else if (id === 17) {
          addBox(x, y, z, id, [0, 0, 0, 1, 1, 1], 2, [0.75, 0.94, 1]);
        } else {
          addBox(
            x,
            y,
            z,
            id,
            [0, 0, 0, 1, 1, 1],
            id === 8 ? 1 : 0,
            id === 24 ? [0.45, 0.45, 0.48] : [1, 1, 1],
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
