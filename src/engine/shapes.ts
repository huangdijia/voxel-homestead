export type BlockBox = [number, number, number, number, number, number];
const FULL: BlockBox[] = [[0, 0, 0, 1, 1, 1]];

// Numeric ranges are the world-format contract shared with the crop registry.
export type PlantKind = "wheat" | "carrot" | "potato" | "beetroot" | "grass";
export function plantStage(id: number): { kind: PlantKind; stage: number; stages: number } | null {
  if (id >= 30 && id <= 37) return { kind: "wheat", stage: id - 30, stages: 8 };
  if (id >= 38 && id <= 45) return { kind: "carrot", stage: id - 38, stages: 8 };
  if (id >= 46 && id <= 53) return { kind: "potato", stage: id - 46, stages: 8 };
  if (id >= 54 && id <= 57) return { kind: "beetroot", stage: id - 54, stages: 4 };
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
  if ((id >= 28 && id <= 58)) return false;
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
  if (id === 0 || id === 6 || id === 16 || id === 20 || (id >= 30 && id <= 58)) return [];
  if (id === 28 || id === 29) return [[0, 0, 0, 1, 15 / 16, 1]];
  if (id === 21) return [[0, 0, 0, 1, 0.5, 1]];
  if (id === 22 || id === 27) return [[0, 0, 0, 1, 0.5625, 1]];
  if (id === 18 || id === 25) return [[0, 0, 0.8125, 1, 1, 1]];
  if (id === 19 || id === 26) return [[0, 0, 0, 0.1875, 1, 1]];
  return FULL;
}
export function selectionBoxes(id: number): BlockBox[] {
  if (id === 16) return [[0.38, 0, 0.38, 0.62, 0.8, 0.62]];
  if (id === 20) return [[0, 0, 0.89, 1, 1, 1]];
  const plant = plantStage(id);
  if (plant) {
    const grown = plant.stages > 1 ? plant.stage / (plant.stages - 1) : 1;
    const inset = plant.kind === "wheat" || plant.kind === "grass" ? 0.12 : 0.3 - grown * 0.16;
    return [[inset, plant.kind === "grass" ? 0 : -1 / 16, inset, 1 - inset, plantHeight(id), 1 - inset]];
  }
  return collisionBoxes(id);
}
