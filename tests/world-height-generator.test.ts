import { describe, expect, it } from "vitest";
import { sampleBlock, surfaceHeight } from "../src/engine/generator";
import {
  CHUNK_SIZE,
  SEA_LEVEL,
  WORLD_MAX_Y,
  WORLD_MIN_Y,
  type GeneratorVersion,
} from "../src/engine/world-height";

type Position = [number, number, number];
const seed = "M2-height-20260905";
const block = (x: number, y: number, z: number) =>
  sampleBlock(seed, x, y, z, 5);

// Captured from generator.ts BEFORE adding version 5. The ordered sample spans
// old chunks, starter mine, both trees, and coordinates outside both bounds.
const legacyPositions: Position[] = [];
for (let x = -32; x <= 32; x += 2)
  for (let z = -32; z <= 32; z += 2)
    for (let y = -17; y <= 96; y += 3) legacyPositions.push([x, y, z]);
for (let x = 8; x <= 28; x++)
  for (let z = 0; z <= 5; z++)
    for (let y = 22; y <= 27; y++) legacyPositions.push([x, y, z]);
for (let x = -9; x <= 1; x++)
  for (let z = -8; z <= 7; z++)
    for (let y = 22; y <= 30; y++) legacyPositions.push([x, y, z]);
for (let x = -64; x <= 64; x += 16)
  for (let z = -64; z <= 64; z += 16)
    for (const y of [
      -65, -64, -63, -60, -17, -16, -15, 0, 19, 63, 64, 95, 96, 128, 255, 319,
      320,
    ])
      legacyPositions.push([x, y, z]);

async function digest(values: number[]): Promise<string> {
  const bytes = new ArrayBuffer(values.length * 2);
  const view = new DataView(bytes);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

const legacyHashes: Record<string, string[]> = {
  legacy: [
    "f2797f4c7ac67fd6ca7cd159a18117cf13d1061fdd07f4e55cf94aa88d33934f",
    "7ebe97da7a3318b659a233fe0b5dda8785d59d8fb427c072f07b0e2f466a9f8a",
    "53690fb6e2590356bee5ae4538f8e27966974d140d29c72cb2529170cf407bc8",
    "088dfe09eafbd206faf2730edee1dac6f9ff6a8dd6e42091d567667ced93562a",
  ],
  "M2-minerals-20260905": [
    "21bdc5eb758dae9350e97bf526b6814d97be296b4acfef1aaee0dc6ecb96628e",
    "d074bff321b4fe23dfa977fd6c62a417bd1d95a920b71c7b6351ead2a8f11562",
    "97d0a01c2fcaf13cf64b10b6b310d25c534edb1b81d31ff18304cbf766b875ea",
    "ee48bb1209a18a18ab7fe6adc1005785ff1204d7b7186a6f22224266515aece0",
  ],
  高山河谷: [
    "2f14cf6be0fab90795aaa59694f5091675ac7b02855c63abe61a888b84ca515e",
    "acf8608aa20cbdd4f8a0a1fbf735257b13abce1a1aa54c4ebe8cd13ebefee104",
    "f3c70333cec90e7095b88474d009bcb5e5ad61985dc4f02d4657395efc959804",
    "d263d070b2abec27f10bb19f6b0890af722271793f92280cc10aae02daa6fffd",
  ],
};
const oldHeightHashes: Record<string, string> = {
  legacy: "f0b9e06eaae188baab8a090606a100e5ec254b5f96c5f335156ef3679190ba0e",
  "M2-minerals-20260905":
    "beec351259729e4f7a5d2279bd821f8e1d388ac7d67d8f4381b0975437c86240",
  高山河谷: "9a76ff64c48621f56a61d2943d4585f68e5b3ae88751ff485ceff4d772dca25c",
};

describe("legacy generator byte stability after the height expansion", () => {
  for (const [oldSeed, hashes] of Object.entries(legacyHashes)) {
    for (const version of [1, 2, 3, 4] as const)
      it(`${oldSeed}, version ${version}: preserves 45,099 uint16 block samples`, async () => {
        expect(legacyPositions).toHaveLength(45099);
        const samples = legacyPositions.map(([x, y, z]) =>
          sampleBlock(oldSeed, x, y, z, version),
        );
        expect(await digest(samples)).toBe(hashes[version - 1]);
      });
  }
  for (const [oldSeed, expected] of Object.entries(oldHeightHashes))
    it(`${oldSeed}: preserves 4,225 heights for versions 1–4 and default`, async () => {
      for (const version of [undefined, 1, 2, 3, 4] as const) {
        const values: number[] = [];
        for (let x = -256; x <= 256; x += 8)
          for (let z = -256; z <= 256; z += 8) {
            // Interleave new-world reads to catch a shared cache-key collision.
            surfaceHeight(oldSeed, x, z, 5);
            values.push(surfaceHeight(oldSeed, x, z, version));
          }
        expect(await digest(values)).toBe(expected);
      }
    });

  it("keeps the version 4 mining route and old out-of-range behavior", () => {
    for (const p of [
      [-3, 9, 7],
      [-3, 8, 7],
      [-2, 8, 7],
    ] as Position[])
      expect(sampleBlock("M2-minerals-20260905", ...p, 4)).toBe(88);
    for (const version of [1, 2, 3, 4] as const) {
      expect(sampleBlock(seed, 0, -64, 0, version)).toBe(24);
      expect(sampleBlock(seed, 0, 96, 0, version)).toBe(0);
    }
  });
});

describe("full-height generator 5", () => {
  it("exports 384 vertical blocks and keeps air beyond the inclusive bounds", () => {
    const version: GeneratorVersion = 5;
    expect([WORLD_MIN_Y, WORLD_MAX_Y, SEA_LEVEL, CHUNK_SIZE, version]).toEqual([
      -64, 319, 63, 16, 5,
    ]);
    expect(WORLD_MAX_Y - WORLD_MIN_Y + 1).toBe(384);
    for (const x of [-65, -16, -1, 0, 16, 63])
      for (const z of [-17, 0, 31]) {
        expect(block(x, -65, z)).toBe(0);
        expect(block(x, -64, z)).toBe(24);
        expect(block(x, 319, z)).toBe(0);
        expect(block(x, 320, z)).toBe(0);
      }
  });

  it("has dry clear spawn footing, correctly rooted trees, and reachable stone/iron", () => {
    expect(surfaceHeight(seed, 0, 0, 5)).toBe(68);
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) {
        expect(block(x, 68, z)).toBe(1);
        expect([0, 58]).toContain(block(x, 69, z));
        expect(block(x, 70, z)).toBe(0);
        expect(block(x, 64, z)).toBe(3);
      }
    expect(block(0, 69, 0)).toBe(0);
    for (const [x, z] of [
      [-6, 5],
      [-8, -6],
    ]) {
      const h = surfaceHeight(seed, x, z, 5);
      expect(block(x, h, z)).toBe(1);
      for (let y = h + 1; y <= h + 5; y++) expect(block(x, y, z)).toBe(7);
      expect(block(x, h + 6, z)).toBe(8);
    }
    expect(block(2, 61, 2)).toBe(10);
    expect(block(2, 60, 8)).toBe(9);
  });

  it("generates new hills well above y95, with a real solid surface", () => {
    const h = surfaceHeight(seed, -168, -336, 5);
    expect(h).toBe(228);
    expect(block(-168, h, -336)).toBe(1);
    expect([0, 7, 8, 58]).toContain(block(-168, h + 1, -336));
    expect(block(-168, 150, -336)).not.toBe(0);
    const differences = new Set<number>();
    for (let x = -256; x <= 256; x += 32)
      for (let z = -256; z <= 256; z += 32)
        differences.add(
          surfaceHeight(seed, x, z, 5) - surfaceHeight(seed, x, z, 4),
        );
    // A constant offset of the old compact terrain is not a height expansion.
    expect(differences.size).toBeGreaterThan(30);
  });

  it("places the ocean surface at 63, using y62 as its highest water block", () => {
    const x = -464,
      z = -32,
      floor = surfaceHeight(seed, x, z, 5);
    expect(floor).toBe(50);
    expect(block(x, floor, z)).toBe(4);
    for (let y = floor + 1; y < SEA_LEVEL; y++) expect(block(x, y, z)).toBe(6);
    expect(block(x, SEA_LEVEL, z)).toBe(0);
    expect(block(x, SEA_LEVEL + 1, z)).toBe(0);
  });

  it("extends deepslate and caves below the old floor, with lava only below -54", () => {
    let deepRock = 0,
      caveAir = 0,
      lava = 0,
      layeredBedrock = 0,
      bedrockGaps = 0,
      shallowLava = 0,
      highBedrock = 0,
      ordinaryStone = 0;
    for (let x = -64; x <= 64; x += 2)
      for (let z = -64; z <= 64; z += 2)
        for (let y = -63; y <= 0; y++) {
          const id = block(x, y, z);
          if (id === 90) deepRock++;
          if (id === 0 && y < -16) caveAir++;
          if (id === 76) {
            if (y >= -54) shallowLava++;
            lava++;
          }
          if (y <= -60) {
            if (id === 24) layeredBedrock++;
            else bedrockGaps++;
          } else if (id === 24) highBedrock++;
          if (id === 3) ordinaryStone++;
        }
    expect({ shallowLava, highBedrock, ordinaryStone }).toEqual({
      shallowLava: 0,
      highBedrock: 0,
      ordinaryStone: 0,
    });
    expect(deepRock).toBeGreaterThan(10000);
    expect(caveAir).toBeGreaterThan(100);
    expect(lava).toBeGreaterThan(50);
    expect(layeredBedrock).toBeGreaterThan(1000);
    expect(bedrockGaps).toBeGreaterThan(1000);
  });

  it("keeps all terrain surfaces solid across coast, slopes and negative columns", () => {
    for (let x = -512; x <= 512; x += 17)
      for (let z = -512; z <= 512; z += 19) {
        const top = surfaceHeight(seed, x, z, 5);
        expect(top).toBeGreaterThan(WORLD_MIN_Y);
        expect(top).toBeLessThan(WORLD_MAX_Y - 8);
        expect([1, 4]).toContain(block(x, top, z));
        expect([2, 4]).toContain(block(x, top - 3, z));
      }
  });

  it("floors negative fractional coordinates and is independent of read order", async () => {
    const positions = legacyPositions.filter((_, index) => index % 7 === 0);
    const forward = positions.map((p) => block(...p));
    expect(
      positions
        .slice()
        .reverse()
        .map((p) => block(...p))
        .reverse(),
    ).toEqual(forward);
    const other = positions.map((p) => sampleBlock(`${seed}-other`, ...p, 5));
    expect(await digest(other)).not.toBe(await digest(forward));
    for (const [x, y, z] of positions.slice(0, 200)) {
      expect(block(x + 0.9, y + 0.9, z + 0.9)).toBe(block(x, y, z));
      expect(surfaceHeight(seed, x + 0.9, z + 0.9, 5)).toBe(
        surfaceHeight(seed, x, z, 5),
      );
    }
  });

  it("keeps the natural diamond route and a deep lava source available", () => {
    for (const p of [
      [2, -10, 2],
      [2, -11, 2],
      [2, -12, 2],
    ] as Position[])
      expect(block(...p)).toBe(98);
    // The browser fixture may clear these two stone cells to stand beside the
    // ore, without creating ore or depending on a cave's random opening.
    expect(block(1, -11, 2)).toBe(90);
    expect(block(1, -10, 2)).toBe(90);
    expect(block(1, -12, 2)).toBe(90);
    expect(block(21, -55, 9)).toBe(76);
  });

  it("has a natural mineral cluster spanning a negative chunk boundary", () => {
    expect(block(-65, -18, -33)).toBe(95);
    expect(block(-64, -18, -33)).toBe(95);
    expect(Math.floor(-65 / CHUNK_SIZE)).not.toBe(Math.floor(-64 / CHUNK_SIZE));
  });

  it("naturally supplies bounded gravel pockets in ordinary and deep rock", () => {
    let gravel = 0,
      rock = 0,
      shallowGravel = 0,
      deepGravel = 0;
    for (let x = -48; x <= 48; x += 3)
      for (let z = -48; z <= 48; z += 3)
        for (let y = -59; y <= 80; y += 3) {
          const id = block(x, y, z);
          if (id === 3 || id === 90 || id === 5) rock++;
          if (id !== 5) continue;
          gravel++;
          if (y > 0) shallowGravel++;
          else deepGravel++;
          expect(y).toBeLessThan(surfaceHeight(seed, x, z, 5) - 3);
          expect(x * x + z * z).toBeGreaterThanOrEqual(144);
        }
    expect(shallowGravel).toBeGreaterThan(50);
    expect(deepGravel).toBeGreaterThan(50);
    // A custom abundance guard, not a claim about Java's exact distribution.
    expect(gravel / rock).toBeGreaterThan(0.003);
    expect(gravel / rock).toBeLessThan(0.03);
  });

  for (const [axis, left, right] of [
    ["x", [-49, -24, -48], [-48, -24, -48]],
    ["y", [-48, -33, -33], [-48, -32, -33]],
    ["z", [-48, -24, -49], [-48, -24, -48]],
  ] as Array<[string, Position, Position]>)
    it(`keeps gravel continuous across a negative ${axis} chunk boundary`, () => {
      const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2;
      expect(Math.floor(left[axisIndex] / CHUNK_SIZE)).not.toBe(
        Math.floor(right[axisIndex] / CHUNK_SIZE),
      );
      expect(block(...right)).toBe(5);
      expect(block(...left)).toBe(5);
      expect(block(...right)).toBe(5);
      expect(block(left[0] + 0.9, left[1] + 0.9, left[2] + 0.9)).toBe(5);
    });

  it("adds gravel without changing the previously sampled non-rock terrain", async () => {
    // This baseline was captured before gravel was added to gen5. Only stone,
    // deepslate and new gravel are normalized: ores, caves, lava, soil, plants,
    // bedrock and air must retain their original 69,696-sample digest.
    const values: number[] = [];
    for (let x = -48; x <= 48; x += 3)
      for (let z = -48; z <= 48; z += 3)
        for (let y = -63; y <= 128; y += 3) {
          const id = block(x, y, z);
          values.push(id === 3 || id === 90 || id === 5 ? 0 : id);
        }
    expect(values).toHaveLength(69696);
    expect(await digest(values)).toBe(
      "3ac9c9df67321790ef5275965b99470c66ba40696fd824fda918f657bc7bd58f",
    );
    for (const p of [
      [-9, -34, 2],
      [-9, -33, 2],
      [-9, -35, 2],
      [20, -54, 9],
      [20, -55, 9],
    ] as Position[])
      expect(block(...p)).toBe(90);
    for (const x of [-10, -11, -12]) expect(block(x, -33, 2)).toBe(98);
  });

  for (const [name, id, pos] of [
    ["coal", 9, [-48, 50, -40]],
    ["iron", 10, [-48, 24, -40]],
    ["copper", 84, [-48, 37, -47]],
    ["gold", 85, [-48, 31, 9]],
    ["redstone", 86, [-48, 10, 16]],
    ["lapis", 87, [-47, 16, -26]],
    ["diamond", 88, [-48, 10, 23]],
    ["emerald", 89, [-48, 73, -46]],
    ["deepslate coal", 92, [-25, 0, -39]],
    ["deepslate iron", 93, [-48, -33, -47]],
    ["deepslate copper", 94, [-47, -4, -47]],
    ["deepslate gold", 95, [-48, -39, -46]],
    ["deepslate redstone", 96, [-48, -11, -47]],
    ["deepslate lapis", 97, [-48, -53, -47]],
    ["deepslate diamond", 98, [-48, -61, 2]],
    ["deepslate emerald", 99, [30, -12, -47]],
  ] as Array<[string, number, Position]>)
    it(`naturally generates ${name} without creative placements`, () => {
      expect(block(...pos)).toBe(id);
      expect(pos[1]).toBeLessThan(surfaceHeight(seed, pos[0], pos[2], 5) - 3);
    });

  it("gives ores distinct real-height preferences, normalized by available rock", () => {
    const names: Record<number, string> = {
      9: "coal",
      92: "coal",
      10: "iron",
      93: "iron",
      84: "copper",
      94: "copper",
      85: "gold",
      95: "gold",
      86: "redstone",
      96: "redstone",
      87: "lapis",
      97: "lapis",
      88: "diamond",
      98: "diamond",
      89: "emerald",
      99: "emerald",
    };
    const bands = [-59, -32, -5, 22, 49, 76].map((low) => ({
      low,
      rock: 0,
      counts: {} as Record<string, number>,
    }));
    for (let x = -96; x <= 96; x += 3)
      for (let z = -96; z <= 96; z += 3)
        for (const band of bands)
          for (let y = band.low; y <= band.low + 26; y += 3) {
            const id = block(x, y, z),
              name = names[id];
            if (id === 3 || id === 90 || name) band.rock++;
            if (name) band.counts[name] = (band.counts[name] || 0) + 1;
          }
    const rate = (band: number, mineral: string) =>
      (bands[band].counts[mineral] || 0) / bands[band].rock;
    expect(rate(5, "coal")).toBeGreaterThan(rate(2, "coal"));
    expect(rate(0, "coal")).toBe(0);
    expect(rate(2, "iron")).toBeGreaterThan(rate(0, "iron"));
    expect(rate(3, "copper")).toBeGreaterThan(rate(2, "copper"));
    expect(rate(3, "copper")).toBeGreaterThan(rate(5, "copper"));
    expect(rate(1, "gold")).toBeGreaterThan(rate(3, "gold"));
    expect(rate(0, "redstone")).toBeGreaterThan(rate(2, "redstone"));
    expect(rate(2, "lapis")).toBeGreaterThan(rate(4, "lapis"));
    expect(rate(0, "diamond")).toBeGreaterThan(rate(2, "diamond"));
    expect(rate(3, "diamond")).toBe(0);
    expect(rate(5, "emerald")).toBeGreaterThan(rate(2, "emerald"));
  });
});
