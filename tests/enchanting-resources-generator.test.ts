import { describe, expect, it } from "vitest";
import { sampleBlock, surfaceHeight } from "../src/engine/generator";
import type { GeneratorVersion } from "../src/engine/world-height";

const seed = "M2-enchanting-20260905";
async function digest(values: number[]): Promise<string> {
  const bytes = new ArrayBuffer(values.length * 2),
    view = new DataView(bytes);
  values.forEach((value, i) => view.setUint16(i * 2, value, true));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
describe("generator 6 adds renewable cane without changing existing worlds", () => {
  // Captured before adding gen6, including gen5's completed gravel pockets.
  for (const [oldSeed, hash] of Object.entries({
    "M2-height-20260905":
      "39168a2bbfef25423df01cc51db15d493163106845e82eeaa3eef9b790980d09",
    "M2-enchanting-20260905":
      "260bf4fd2874683583a6f2057e060ecc54e97e24e38b80093ba632eedccaeaba",
    高山河谷:
      "3d90caf4270ca9f58a71eecc1e48be2b47cc12fb02e644c3bd32bcdfba4d1364",
  }))
    it(`preserves 84,500 gen5 block samples for ${oldSeed}`, async () => {
      const values: number[] = [];
      for (let x = -128; x <= 128; x += 4)
        for (let z = -128; z <= 128; z += 4)
          for (const y of [
            -65, -64, -63, -48, -33, -16, 0, 32, 61, 62, 63, 64, 65, 68, 69, 80,
            128, 228, 319, 320,
          ]) {
            sampleBlock(oldSeed, x, y, z, 6);
            values.push(sampleBlock(oldSeed, x, y, z, 5));
          }
      expect(values).toHaveLength(84500);
      expect(await digest(values)).toBe(hash);
    });
  it("only adds cane in v5 air beside actual water and valid ground", () => {
    let stalks = 0;
    for (let x = -256; x <= 256; x += 2)
      for (let z = -256; z <= 256; z += 2)
        for (const y of [62, 63, 64, 65, 66]) {
          const old = sampleBlock(seed, x, y, z, 5),
            current = sampleBlock(seed, x, y, z, 6);
          if (current !== 111) {
            expect(current).toBe(old);
            continue;
          }
          expect(old).toBe(0);
          expect([1, 2, 4]).toContain(sampleBlock(seed, x, 62, z, 6));
          expect(
            [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ].some(
              ([dx, dz]) => sampleBlock(seed, x + dx, 62, z + dz, 6) === 6,
            ),
          ).toBe(true);
          expect(y).toBeGreaterThanOrEqual(63);
          expect(y).toBeLessThanOrEqual(65);
          if (y === 63) stalks++;
          else expect(sampleBlock(seed, x, y - 1, z, 6)).toBe(111);
        }
    expect(stalks).toBeGreaterThan(20);
    // All 330,245 coastal samples are intentional. Allow loaded CI / browser QA
    // hosts to complete the assertions; this is not a performance benchmark.
  }, 20_000);
  it("has two three-high natural stalks for the survival browser route", () => {
    for (const x of [-1, 0]) {
      for (const y of [63, 64, 65]) {
        expect(sampleBlock(seed, x, y, -181, 6)).toBe(111);
        for (const old of [1, 2, 3, 4, 5] as GeneratorVersion[])
          expect(sampleBlock(seed, x, y, -181, old)).not.toBe(111);
      }
      expect(sampleBlock(seed, x, 66, -181, 6)).toBe(0);
      expect(sampleBlock(seed, x, 62, -181, 6)).toBe(4);
      expect(sampleBlock(seed, x, 62, -182, 6)).toBe(6);
    }
  });
  it("preserves full-height terrain, surface caches, trees and safe spawn", () => {
    for (const s of [seed, "M2-height-20260905"])
      for (let x = -256; x <= 256; x += 16)
        for (let z = -256; z <= 256; z += 16) {
          expect(surfaceHeight(s, x, z, 6)).toBe(surfaceHeight(s, x, z, 5));
          for (const y of [-65, -64, -33, 0, 32, 68, 95, 150, 228, 319, 320])
            expect(sampleBlock(s, x, y, z, 6)).toBe(sampleBlock(s, x, y, z, 5));
        }
    expect(surfaceHeight(seed, 0, 0, 6)).toBe(68);
    expect(sampleBlock(seed, 0, 69, 0, 6)).toBe(0);
    for (const [x, z] of [
      [-6, 5],
      [-8, -6],
    ]) {
      const top = surfaceHeight(seed, x, z, 6);
      expect(sampleBlock(seed, x, top + 1, z, 6)).toBe(7);
    }
  });
  it("uses deterministic seed-dependent coast placement across negative coordinates", () => {
    const positions: Array<[number, number, number]> = [];
    for (let x = -20; x <= 20; x++)
      for (let z = -210; z <= -175; z++) positions.push([x, 63, z]);
    const forward = positions.map((p) => sampleBlock(seed, ...p, 6));
    expect(
      positions
        .slice()
        .reverse()
        .map((p) => sampleBlock(seed, ...p, 6))
        .reverse(),
    ).toEqual(forward);
    expect(
      positions.map((p) => sampleBlock(`${seed}-other`, ...p, 6)),
    ).not.toEqual(forward);
    expect(sampleBlock(seed, -0.1, 63.9, -180.1, 6)).toBe(111);
  });
});
