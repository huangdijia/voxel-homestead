import { describe, expect, it } from "vitest";
import { buildChunk } from "../src/engine/mesher";
import { sampleBlock, surfaceHeight } from "../src/engine/generator";

const seed = "M2-minerals-20260905";
const newOres = new Set([84, 85, 86, 87, 88, 89, 94, 95, 96, 97, 98, 99]);
const positions: Array<[number, number, number]> = [];
for (let x = -32; x <= 32; x += 2)
  for (let z = -32; z <= 32; z += 2)
    for (let y = -17; y <= 96; y += 3) positions.push([x, y, z]);
for (let x = 8; x <= 28; x++)
  for (let z = 0; z <= 5; z++)
    for (let y = 22; y <= 27; y++) positions.push([x, y, z]);
for (let x = -9; x <= 1; x++)
  for (let z = -8; z <= 7; z++)
    for (let y = 22; y <= 30; y++) positions.push([x, y, z]);
const oldDigests = [
  [
    "legacy",
    1,
    "e976482a7f86ada6e6d1bc9198c300bef4401fc971d623b29b10298c29682d1a",
  ],
  [
    "legacy",
    2,
    "1c12eaf6929d16ce789ca0cde620f824983d399c0591d5d66ab7c5bd26cc1a37",
  ],
  [
    "legacy",
    3,
    "6ec9e7d307f1ea1a0fa48bfab04e1eacefb9051237972781afc091f46a3378fd",
  ],
  [
    "矿脉之旅",
    1,
    "eb26d036c28bf45b530a54492eb31cb11e5ba35293726512a71ddbb26e552e4b",
  ],
  [
    "矿脉之旅",
    2,
    "760d5517db2d68218bd5612266a8b0a529307d294c35539e317f7bb33b2e973f",
  ],
  [
    "矿脉之旅",
    3,
    "47da230fab353e3a6b2547d8bc8405fedac5bef586098bb1c849b67b1aece1eb",
  ],
  [
    "negative-origin",
    1,
    "ef0bec22e5be87419c85a5dc5fd9c9c3a7002587f8fb5fe1af444541d593eedf",
  ],
  [
    "negative-origin",
    2,
    "e239a2b078c6be74ba2cbe202a653cac4e97e38ceabe57362ca88dfebf7f9ae0",
  ],
  [
    "negative-origin",
    3,
    "53fbd1036f4433c40107d8814c7572ed20846a480a50373eb433f64a5b42bd40",
  ],
] as const;
async function digest(name: string, version: 1 | 2 | 3 | 4) {
  const bytes = new ArrayBuffer(positions.length * 2);
  const view = new DataView(bytes);
  positions.forEach(([x, y, z], i) =>
    view.setUint16(i * 2, sampleBlock(name, x, y, z, version), true),
  );
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

describe("versioned mineral terrain compatibility", () => {
  // Captured before adding version 4: 43,722 uint16 little-endian samples per
  // seed/version, covering negative chunks, deep caves, spawn and starter mine.
  it.each(oldDigests)(
    "preserves the pre-change sample bytes for seed %s version %i",
    async (name, version, expected) => {
      expect(positions).toHaveLength(43722);
      expect(await digest(name, version)).toBe(expected);
    },
  );
  it("keeps omitted generator version identical to legacy version 1", () => {
    for (const [x, y, z] of positions.filter((_, i) => i % 13 === 0))
      expect(sampleBlock(seed, x, y, z)).toBe(sampleBlock(seed, x, y, z, 1));
  });
  it("is deterministic regardless of seed switching, cache churn and sample order", async () => {
    const expected = await digest(seed, 4);
    expect(await digest("different-mineral-seed", 4)).not.toBe(expected);
    // More than the descriptor cache capacity, exercising cache eviction.
    for (let x = 0; x < 17000; x++)
      sampleBlock("cache-churn", x * 5 + 2, -3, 2, 4);
    expect(await digest(seed, 4)).toBe(expected);
    const forward = positions
      .filter((_, i) => i % 17 === 0)
      .map(([x, y, z]) => sampleBlock(seed, x, y, z, 4));
    const reverse = positions
      .filter((_, i) => i % 17 === 0)
      .reverse()
      .map(([x, y, z]) => sampleBlock(seed, x, y, z, 4))
      .reverse();
    expect(reverse).toEqual(forward);
  });
  it("changes only underground stone and the deep variants of existing coal and iron", () => {
    let changed = 0,
      lava = 0;
    for (const [x, y, z] of positions) {
      const previous = sampleBlock(seed, x, y, z, 3),
        current = sampleBlock(seed, x, y, z, 4);
      if (previous === 76) {
        lava++;
        expect(current).toBe(76);
      }
      if (previous === current) continue;
      changed++;
      if (previous === 9 || previous === 10) {
        expect(y).toBeLessThanOrEqual(0);
        expect(current).toBe(previous === 9 ? 92 : 93);
      } else {
        expect(previous).toBe(3);
        expect(newOres.has(current) || current === 90).toBe(true);
      }
    }
    expect(changed).toBeGreaterThan(1000);
    expect(lava).toBeGreaterThan(0);
  });
  it("preserves topsoil, seawater, surface vegetation, spawn clearance and starter coal/iron", () => {
    for (let x = -32; x <= 32; x++)
      for (let z = -32; z <= 32; z++) {
        const top = surfaceHeight(seed, x, z);
        for (let y = top - 3; y <= top + 7; y++)
          expect(sampleBlock(seed, x, y, z, 4)).toBe(
            sampleBlock(seed, x, y, z, 3),
          );
      }
    for (let x = 8; x <= 28; x++)
      for (let z = 0; z <= 5; z++)
        for (let y = 23; y <= 26; y++)
          expect(sampleBlock(seed, x, y, z, 4)).toBe(
            sampleBlock(seed, x, y, z, 3),
          );
    expect(sampleBlock(seed, 14, 24, 0, 4)).toBe(9);
    expect(sampleBlock(seed, 23, 24, 0, 4)).toBe(10);
    expect(sampleBlock(seed, 0, 23, 0, 4)).toBe(0);
    expect(sampleBlock(seed, 0, 24, 0, 4)).toBe(0);
    expect(sampleBlock(seed, 3, 18, -20, 4)).toBe(6);
  });
  it("keeps the compact world's bounds explicit instead of adopting Java ore-height assumptions", () => {
    for (const [x, z] of [
      [0, 0],
      [-17, -16],
      [400, -399],
    ]) {
      expect(sampleBlock(seed, x, -16, z, 4)).toBe(24);
      expect(sampleBlock(seed, x, -17, z, 4)).toBe(24);
      expect(sampleBlock(seed, x, 96, z, 4)).toBe(0);
    }
    expect(sampleBlock(seed, -2.1, 8.9, 7.9, 4)).toBe(
      sampleBlock(seed, -3, 8, 7, 4),
    );
  });
});

interface Survey {
  counts: Record<number, number>;
  invalid: number;
  hillEmeralds: number;
  lowEmeralds: number;
  hillSamples: number;
  lowSamples: number;
  midLapis: number;
  otherLapis: number;
}
let cachedSurvey: Survey | undefined;
function survey(): Survey {
  if (cachedSurvey) return cachedSurvey;
  const result: Survey = {
    counts: {},
    invalid: 0,
    hillEmeralds: 0,
    lowEmeralds: 0,
    hillSamples: 0,
    lowSamples: 0,
    midLapis: 0,
    otherLapis: 0,
  };
  for (let x = -64; x <= 64; x++)
    for (let z = -64; z <= 64; z++) {
      const hill = surfaceHeight(seed, x, z) >= 33;
      for (let y = -15; y <= 32; y++) {
        const id = sampleBlock(seed, x, y, z, 4);
        result.counts[id] = (result.counts[id] ?? 0) + 1;
        if (
          (id >= 84 && id <= 89 && y <= 0) ||
          (id >= 92 && id <= 99 && y > 0) ||
          (id === 90 && y > 0)
        )
          result.invalid++;
        if (hill) result.hillSamples++;
        else result.lowSamples++;
        if (id === 89 || id === 99) {
          if (hill) result.hillEmeralds++;
          else result.lowEmeralds++;
        }
        if (id === 87 || id === 97) {
          if (y >= -3 && y <= 12) result.midLapis++;
          else result.otherLapis++;
        }
      }
    }
  cachedSurvey = result;
  return result;
}

describe("natural mineral availability and compact-world depth preferences", () => {
  it.each(["legacy", "矿脉之旅", "negative-origin"])(
    "has at least three natural diamonds near spawn for an unrelated seed %s",
    (name) => {
      let diamonds = 0;
      search: for (let x = -32; x <= 32; x++)
        for (let z = -32; z <= 32; z++)
          for (let y = -15; y <= 9; y++) {
            const id = sampleBlock(name, x, y, z, 4);
            if (id === 88 || id === 98) diamonds++;
            if (diamonds >= 3) break search;
          }
      expect(diamonds).toBeGreaterThanOrEqual(3);
      expect(sampleBlock(name, 23, 24, 0, 4)).toBe(10);
    },
  );
  it.each([84, 85, 86, 87, 88, 89, 90, 92, 93, 94, 95, 96, 97, 98, 99])(
    "naturally finds block %i within 64 blocks horizontally of spawn",
    (id) => {
      expect(survey().counts[id]).toBeGreaterThan(0);
    },
  );
  it("never generates cobbled deepslate or compressed storage blocks as natural ore", () => {
    expect(survey().counts[91] ?? 0).toBe(0);
    for (let id = 100; id <= 110; id++)
      expect(survey().counts[id] ?? 0).toBe(0);
    expect(survey().invalid).toBe(0);
  });
  it("favors shallow copper, deep gold/redstone/diamond and mid-lower lapis", () => {
    const { counts, midLapis, otherLapis } = survey();
    // Compare rates in equal x/z areas, accounting for the 32 positive and
    // 16 nonpositive sampled height levels. This is not an original-game fit.
    expect(counts[84] / 32).toBeGreaterThan((counts[94] / 16) * 2);
    for (const [upper, deep] of [
      [85, 95],
      [86, 96],
      [88, 98],
    ])
      expect(counts[deep] / 16).toBeGreaterThan((counts[upper] / 32) * 2);
    expect(midLapis / 16).toBeGreaterThan(otherLapis / 32);
  });
  it("has a higher natural emerald density below hills without excluding lowlands entirely", () => {
    const s = survey();
    expect(s.lowEmeralds).toBeGreaterThan(0);
    expect(s.hillEmeralds / s.hillSamples).toBeGreaterThan(
      (s.lowEmeralds / s.lowSamples) * 3,
    );
  });
  it("keeps a connected new mineral vein across a negative chunk boundary in worker samples", () => {
    // A deterministic deep-redstone vein straddles x=-17/-16, independently of
    // the mesher's chunk traversal and both workers' local array coordinates.
    expect(sampleBlock(seed, -17, -3, -63, 4)).toBe(96);
    expect(sampleBlock(seed, -16, -3, -63, 4)).toBe(96);
    const request = {
      seed,
      worldId: "mineral-seam",
      generatorVersion: 4 as const,
      cy: -1,
      cz: -4,
      revision: 0,
      changes: [],
    };
    const left = buildChunk({ ...request, cx: -2, key: "-2,-1,-4" });
    const right = buildChunk({ ...request, cx: -1, key: "-1,-1,-4" });
    const y = 13,
      z = 1;
    expect(left.voxels[y * 256 + z * 16 + 15]).toBe(96);
    expect(right.voxels[y * 256 + z * 16]).toBe(96);
    expect([...left.voxels].filter((id) => id === 96).length).toBeGreaterThan(
      1,
    );
    expect([...right.voxels].filter((id) => id === 96).length).toBeGreaterThan(
      1,
    );
  });
  it("provides natural starter iron, a nearby multi-diamond vein and natural lava for the progression route", () => {
    expect(sampleBlock(seed, 23, 24, 0, 4)).toBe(10);
    const diamonds = [
      { x: -3, y: 9, z: 7 },
      { x: -3, y: 8, z: 7 },
      { x: -2, y: 8, z: 7 },
    ];
    for (const p of diamonds)
      expect(sampleBlock(seed, p.x, p.y, p.z, 4)).toBe(88);
    expect(surfaceHeight(seed, -3, 7)).toBe(22);
    expect(sampleBlock(seed, 14, -5, 16, 4)).toBe(76);
    // An alternative exposed vein has two air cells and a solid standing floor.
    expect(sampleBlock(seed, 38, 7, 57, 4)).toBe(88);
    expect(sampleBlock(seed, 38, 7, 58, 4)).toBe(0);
    expect(sampleBlock(seed, 38, 8, 58, 4)).toBe(0);
    expect([0, 6, 76]).not.toContain(sampleBlock(seed, 38, 6, 58, 4));
  });
});
