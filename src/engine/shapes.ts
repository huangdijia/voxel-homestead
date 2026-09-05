export type BlockBox = [number, number, number, number, number, number];
const FULL: BlockBox[] = [[0, 0, 0, 1, 1, 1]];
export function isOpaque(id: number): boolean {
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
  if (id === 0 || id === 6 || id === 16 || id === 20) return [];
  if (id === 21) return [[0, 0, 0, 1, 0.5, 1]];
  if (id === 22 || id === 27) return [[0, 0, 0, 1, 0.5625, 1]];
  if (id === 18 || id === 25) return [[0, 0, 0.8125, 1, 1, 1]];
  if (id === 19 || id === 26) return [[0, 0, 0, 0.1875, 1, 1]];
  return FULL;
}
export function selectionBoxes(id: number): BlockBox[] {
  if (id === 16) return [[0.38, 0, 0.38, 0.62, 0.8, 0.62]];
  if (id === 20) return [[0, 0, 0.89, 1, 1, 1]];
  return collisionBoxes(id);
}
