import {
  sampleBlock,
  surfaceHeight,
  CHUNK_SIZE,
  WORLD_MIN_Y,
} from "./generator";
import { isOpaque } from "./shapes";
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
        padded[offset(x, y, z)] = sampleBlock(seed, ox + x, oy + y, oz + z);
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
          sampleBlock(seed, ox + x, y, oz + z);
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
        if (id === 20) {
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
