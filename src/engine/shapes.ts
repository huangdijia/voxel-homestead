import { fluidHeight, fluidInfo, isFluid } from "../game/fluid-blocks";

export type BlockBox = [number, number, number, number, number, number];
const FULL: BlockBox[] = [[0, 0, 0, 1, 1, 1]];
export type FluidSurface = [number, number, number, number];
export type ShapeVertex = [number, number, number];
export type ShapeQuad = [ShapeVertex, ShapeVertex, ShapeVertex, ShapeVertex];

export interface ProgressionBlockPart {
  box: BlockBox;
  tint: [number, number, number];
  tile: number;
  /** Decorative parts are omitted when this side touches an opaque neighbor. */
  face?: number;
}
const progressionParts = new Map<number, readonly ProgressionBlockPart[]>();
/** Original small voxel models shared by terrain and held items. */
export function progressionBlockParts(
  id: number,
): readonly ProgressionBlockPart[] {
  const cached = progressionParts.get(id);
  if (cached) return cached;
  const parts: ProgressionBlockPart[] = [];
  const add = (
    box: BlockBox,
    tint: ProgressionBlockPart["tint"],
    tile = 15,
    face?: number,
  ) => parts.push({ box, tint, tile, ...(face !== undefined ? { face } : {}) });
  if (id === 111) {
    for (const [x, z, green] of [
      [0.23, 0.32, 0.74],
      [0.49, 0.64, 0.85],
      [0.73, 0.34, 0.67],
    ]) {
      add([x, 0, z, x + 0.065, 1, z + 0.065], [0.47, green, 0.24]);
      for (const y of [0.3, 0.68])
        add(
          [x - 0.014, y, z - 0.014, x + 0.079, y + 0.038, z + 0.079],
          [0.66, 0.83, 0.36],
        );
      const direction = x < 0.5 ? -1 : 1;
      add(
        [
          Math.min(x, x + direction * 0.17),
          0.73,
          z + 0.017,
          Math.max(x + 0.065, x + direction * 0.17),
          0.78,
          z + 0.047,
        ],
        [0.35, 0.65, 0.2],
      );
    }
  } else if (id === 112) {
    add([0, 0, 0, 1, 0.6875, 1], [0.23, 0.13, 0.31], 3);
    add([0, 0.6875, 0, 1, 0.75, 1], [0.61, 0.16, 0.2]);
    for (const x of [0.025, 0.85])
      for (const z of [0.025, 0.85])
        add([x, 0.7, z, x + 0.125, 0.755, z + 0.125], [0.3, 0.78, 0.77]);
    // An open book rests above the table: stepped page wings meet at a lower spine.
    for (const side of [-1, 1])
      for (let page = 0; page < 3; page++) {
        const start = side < 0 ? 0.2 + page * 0.1 : 0.5 + page * 0.1;
        const y = 0.84 + (side < 0 ? 2 - page : page) * 0.025;
        add([start, y, 0.28, start + 0.1, y + 0.025, 0.73], [0.51, 0.22, 0.13]);
        add(
          [start + 0.008, y + 0.025, 0.3, start + 0.095, y + 0.055, 0.71],
          [0.95, 0.88, 0.66],
        );
      }
    add([0.485, 0.83, 0.27, 0.515, 0.857, 0.74], [0.68, 0.39, 0.2]);
    add([0.51, 0.854, 0.56, 0.535, 0.866, 0.81], [0.78, 0.22, 0.2]);
  } else if (id === 113) {
    add([0, 0, 0, 1, 1, 1], [0.64, 0.44, 0.25], 11);
    const palette: ProgressionBlockPart["tint"][] = [
      [0.5, 0.23, 0.22],
      [0.3, 0.5, 0.42],
      [0.76, 0.59, 0.28],
      [0.36, 0.4, 0.63],
    ];
    const sideBox = (
      face: number,
      u: number,
      v: number,
      w: number,
      h: number,
      depth = 0.008,
    ): BlockBox =>
      face === 0
        ? [1, v, u, 1 + depth, v + h, u + w]
        : face === 1
          ? [-depth, v, u, 0, v + h, u + w]
          : face === 4
            ? [u, v, 1, u + w, v + h, 1 + depth]
            : [u, v, -depth, u + w, v + h, 0];
    for (const face of [0, 1, 4, 5]) {
      for (let row = 0; row < 2; row++)
        for (let book = 0; book < 4; book++) {
          const y = 0.09 + row * 0.47,
            h = 0.28 + ((book + row) % 3) * 0.035;
          add(
            sideBox(face, 0.1 + book * 0.2, y, 0.15, h),
            palette[(book + row + face) % 4],
            15,
            face,
          );
          // A small pale title band retains the pixel silhouette at a distance.
          add(
            sideBox(face, 0.12 + book * 0.2, y + h - 0.075, 0.11, 0.025, 0.011),
            [0.89, 0.8, 0.58],
            15,
            face,
          );
        }
      add(sideBox(face, 0, 0.47, 1, 0.055), [0.8, 0.62, 0.35], 11, face);
    }
  }
  if (parts.length) progressionParts.set(id, parts);
  return parts;
}

/** Heights at (0,0), (1,0), (0,1), (1,1), shared by rendering and selection.
 * Every corner samples the same four world cells, including across chunk borders.
 */
export function fluidSurfaceHeights(
  id: number,
  x: number,
  y: number,
  z: number,
  getBlock: (x: number, y: number, z: number) => number,
): FluidSurface {
  const kind = fluidInfo(id)?.kind;
  if (!kind) return [0, 0, 0, 0];
  const corner = (dx: number, dz: number): number => {
    let total = 0,
      weights = 0;
    for (let cz = z + dz - 1; cz <= z + dz; cz++)
      for (let cx = x + dx - 1; cx <= x + dx; cx++) {
        const cell = getBlock(cx, y, cz),
          info = fluidInfo(cell);
        if (info?.kind !== kind) continue;
        const height = fluidHeight(cell, getBlock(cx, y + 1, cz));
        // A falling column and the cell beneath it meet without an air seam.
        if (height === 1) return 1;
        const weight = info.source ? 10 : 1;
        total += height * weight;
        weights += weight;
      }
    return weights ? total / weights : fluidHeight(id);
  };
  return [corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)];
}

/** Same quad order and triangle diagonal as the chunk mesh (+x,-x,+y,-y,+z,-z). */
export function fluidSurfaceQuads([a, b, c, d]: FluidSurface): ShapeQuad[] {
  return [
    [
      [1, 0, 1],
      [1, 0, 0],
      [1, d, 1],
      [1, b, 0],
    ],
    [
      [0, 0, 0],
      [0, 0, 1],
      [0, a, 0],
      [0, c, 1],
    ],
    [
      [0, c, 1],
      [1, d, 1],
      [0, a, 0],
      [1, b, 0],
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
      [0, c, 1],
      [1, d, 1],
    ],
    [
      [1, 0, 0],
      [0, 0, 0],
      [1, b, 0],
      [0, a, 0],
    ],
  ];
}

// Numeric ranges are the world-format contract shared with the crop registry.
export type PlantKind = "wheat" | "carrot" | "potato" | "beetroot" | "grass";
export function plantStage(
  id: number,
): { kind: PlantKind; stage: number; stages: number } | null {
  if (id >= 30 && id <= 37) return { kind: "wheat", stage: id - 30, stages: 8 };
  if (id >= 38 && id <= 45)
    return { kind: "carrot", stage: id - 38, stages: 8 };
  if (id >= 46 && id <= 53)
    return { kind: "potato", stage: id - 46, stages: 8 };
  if (id >= 54 && id <= 57)
    return { kind: "beetroot", stage: id - 54, stages: 4 };
  if (id === 58) return { kind: "grass", stage: 0, stages: 1 };
  return null;
}
export function plantHeight(id: number): number {
  const plant = plantStage(id);
  if (!plant) return 0;
  if (plant.kind === "grass") return 0.55;
  const grown = plant.stage / (plant.stages - 1);
  return plant.kind === "wheat" ? 0.16 + grown * 0.73 : 0.13 + grown * 0.49;
}
export function isOpaque(id: number): boolean {
  if (
    (id >= 28 && id <= 67) ||
    isFluid(id) ||
    id === 82 ||
    id === 83 ||
    id === 111 ||
    id === 112
  )
    return false;
  return (
    id !== 0 &&
    id !== 6 &&
    id !== 8 &&
    id !== 16 &&
    id !== 17 &&
    id !== 18 &&
    id !== 19 &&
    id !== 20 &&
    id !== 21 &&
    id !== 22 &&
    id !== 25 &&
    id !== 26 &&
    id !== 27
  );
}
export function collisionBoxes(id: number): BlockBox[] {
  if (
    id === 0 ||
    isFluid(id) ||
    id === 16 ||
    id === 20 ||
    id === 83 ||
    id === 111 ||
    (id >= 30 && id <= 58)
  )
    return [];
  if (id === 28 || id === 29) return [[0, 0, 0, 1, 15 / 16, 1]];
  if (id === 112) return [[0, 0, 0, 1, 0.75, 1]];
  if (id >= 59 && id <= 67) return [[0, 0, 0, 1, 0.875, 1]];
  if (id === 21) return [[0, 0, 0, 1, 0.5, 1]];
  if (id === 22 || id === 27) return [[0, 0, 0, 1, 0.5625, 1]];
  if (id === 18 || id === 25) return [[0, 0, 0.8125, 1, 1, 1]];
  if (id === 19 || id === 26) return [[0, 0, 0, 0.1875, 1, 1]];
  return FULL;
}
export function selectionBoxes(id: number): BlockBox[] {
  if (id === 111) return [[0.08, 0, 0.15, 0.93, 1, 0.8]];
  if (id === 83) return [[0.16, 0, 0.16, 0.84, 0.84, 0.84]];
  if (id === 16) return [[0.38, 0, 0.38, 0.62, 0.8, 0.62]];
  if (id === 20) return [[0, 0, 0.89, 1, 1, 1]];
  const plant = plantStage(id);
  if (plant) {
    const grown = plant.stages > 1 ? plant.stage / (plant.stages - 1) : 1;
    const inset =
      plant.kind === "wheat" || plant.kind === "grass"
        ? 0.12
        : 0.3 - grown * 0.16;
    return [
      [
        inset,
        plant.kind === "grass" ? 0 : -1 / 16,
        inset,
        1 - inset,
        plantHeight(id),
        1 - inset,
      ],
    ];
  }
  return collisionBoxes(id);
}
