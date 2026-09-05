export type MineralColor = [number, number, number];
export interface MineralAppearance {
  kind: "ore" | "slate" | "block" | "raw";
  base: MineralColor;
  grain: MineralColor;
  highlight: MineralColor;
  tile: number;
}
const mineralPalettes: MineralColor[] = [
  [0.12, 0.14, 0.17], // Coal
  [0.77, 0.57, 0.43], // Iron
  [0.93, 0.49, 0.27], // Copper
  [1, 0.76, 0.2], // Gold
  [0.88, 0.12, 0.13], // Redstone
  [0.15, 0.34, 0.88], // Lapis
  [0.28, 0.87, 0.86], // Diamond
  [0.12, 0.74, 0.35], // Emerald
];
const mineralHighlights: MineralColor[] = [
  [0.33, 0.37, 0.41],
  [0.95, 0.76, 0.57],
  [0.35, 0.77, 0.61],
  [1, 0.94, 0.59],
  [1, 0.4, 0.29],
  [0.38, 0.61, 1],
  [0.74, 1, 0.95],
  [0.5, 0.96, 0.61],
];
const mineralAppearances = new Map<number, MineralAppearance>();
for (let id = 84; id <= 89; id++)
  mineralAppearances.set(id, {
    kind: "ore",
    base: [1, 1, 1],
    grain: mineralPalettes[id - 82],
    highlight: mineralHighlights[id - 82],
    tile: 3,
  });
for (let id = 90; id <= 91; id++)
  mineralAppearances.set(id, {
    kind: "slate",
    base: [0.39, 0.43, 0.47],
    grain: [0.27, 0.3, 0.34],
    highlight: [0.5, 0.55, 0.59],
    tile: id === 90 ? 3 : 12,
  });
for (let id = 92; id <= 99; id++)
  mineralAppearances.set(id, {
    kind: "ore",
    base: [0.39, 0.43, 0.47],
    grain: mineralPalettes[id - 92],
    highlight: mineralHighlights[id - 92],
    tile: 3,
  });
for (const [id, mineral] of [
  [100, 2],
  [101, 3],
  [102, 4],
  [103, 5],
  [104, 6],
  [105, 7],
  [106, 1],
  [107, 0],
  [108, 1],
  [109, 2],
  [110, 3],
]) {
  const grain =
      id === 106
        ? ([0.78, 0.84, 0.86] as MineralColor)
        : mineralPalettes[mineral],
    highlight =
      id === 106
        ? ([0.98, 1, 0.97] as MineralColor)
        : mineralHighlights[mineral];
  mineralAppearances.set(id, {
    kind: id >= 108 ? "raw" : "block",
    base: grain.map(
      (value) => value * (id >= 108 ? 0.56 : 0.78),
    ) as MineralColor,
    grain,
    highlight,
    tile: 15,
  });
}
/** Shared palette for chunk faces and inventory icons, independent of mining rules. */
export function mineralAppearance(id: number): MineralAppearance | undefined {
  return mineralAppearances.get(id);
}
