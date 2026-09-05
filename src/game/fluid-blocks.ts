/** Stable block IDs shared by simulation, worker meshing and ray selection. */
export type FluidKind = "water" | "lava";
export interface FluidInfo {
  kind: FluidKind;
  level: number;
  falling: boolean;
  source: boolean;
}
export function fluidInfo(id: number): FluidInfo | undefined {
  if (id === 6)
    return { kind: "water", level: 0, falling: false, source: true };
  if (id >= 68 && id <= 74)
    return { kind: "water", level: id - 67, falling: false, source: false };
  if (id === 75)
    return { kind: "water", level: 0, falling: true, source: false };
  if (id === 76)
    return { kind: "lava", level: 0, falling: false, source: true };
  if (id >= 77 && id <= 79)
    return {
      kind: "lava",
      level: (id - 76) * 2,
      falling: false,
      source: false,
    };
  if (id === 80)
    return { kind: "lava", level: 0, falling: true, source: false };
}
export const isWater = (id: number) => id === 6 || (id >= 68 && id <= 75);
export const isLava = (id: number) => id >= 76 && id <= 80;
export const isFluid = (id: number) => isWater(id) || isLava(id);
export function fluidBlock(
  kind: FluidKind,
  level: number,
  falling = false,
): number {
  if (falling) return kind === "water" ? 75 : 80;
  if (level <= 0) return kind === "water" ? 6 : 76;
  if (kind === "water") return level <= 7 ? 67 + Math.ceil(level) : 0;
  return level <= 6 ? 76 + Math.ceil(level / 2) : 0;
}
export function fluidHeight(id: number, aboveId = 0): number {
  const info = fluidInfo(id);
  if (!info) return 0;
  if (fluidInfo(aboveId)?.kind === info.kind || info.falling) return 1;
  return (8 - info.level) / 9;
}
