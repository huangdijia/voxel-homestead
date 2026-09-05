import { describe, expect, it } from "vitest";
import {
  sampleBlock,
  seedNumber,
  surfaceHeight,
} from "../src/engine/generator";
import { buildChunk } from "../src/engine/mesher";
import { intersectsWorld, moveBody, raycastVoxel } from "../src/engine/physics";
import type { Vec3 } from "../src/game/types";

const world = (blocks: Record<string, number>, floor = false) => ({
  getBlock: (x: number, y: number, z: number) =>
    blocks[x + "," + y + "," + z] ?? (floor && y < 0 ? 3 : 0),
});
describe("deterministic terrain", () => {
  it("keeps a safe, empty spawn and the expected world bounds for several seeds", () => {
    for (const seed of ["home", "世界", "12345", "iron-age"]) {
      expect(seedNumber(seed)).toBe(seedNumber(seed));
      expect(surfaceHeight(seed, 0, 0)).toBe(22);
      expect(sampleBlock(seed, 0, 22, 0)).toBe(1);
      expect(sampleBlock(seed, 0, 23, 0)).toBe(0);
      expect(sampleBlock(seed, 0, 24, 0)).toBe(0);
      expect(sampleBlock(seed, -8, -16, 1)).toBe(24);
      expect(sampleBlock(seed, 0, 96, 0)).toBe(0);
      expect(sampleBlock(seed, -6, surfaceHeight(seed, -6, 5) + 1, 5)).toBe(7);
      expect(sampleBlock(seed, 3, 18, -20)).toBe(6);
    }
  });
  it("provides an enterable mine with visible coal and enough iron on its walls", () => {
    for (const seed of ["home", "世界"]) {
      for (let x = 8; x <= 28; x++) expect(sampleBlock(seed, x, 24, 2)).toBe(0);
      expect(sampleBlock(seed, 14, 24, 0)).toBe(9);
      let iron = 0;
      for (let x = 20; x <= 28; x++)
        for (let y = 23; y <= 26; y++)
          for (const z of [0, 5]) if (sampleBlock(seed, x, y, z) === 10) iron++;
      expect(iron).toBeGreaterThanOrEqual(32);
    }
  });
  it("varies non-spawn terrain by seed while retaining reproducibility at negative coordinates", () => {
    const samples = (seed: string) =>
      Array.from({ length: 20 }, (_, i) =>
        surfaceHeight(seed, -200 + i * 9, 137),
      );
    expect(samples("a")).toEqual(samples("a"));
    expect(samples("a")).not.toEqual(samples("b"));
  });
});

describe("chunk geometry", () => {
  const request = {
    worldId: "test",
    seed: "mesh",
    key: "0,4,0",
    cx: 0,
    cy: 4,
    cz: 0,
    revision: 7,
    changes: [] as Array<Vec3 & { id: number }>,
  };
  it("merges cubes into one layer and excludes their common face", () => {
    const result = buildChunk({
      ...request,
      changes: [
        { x: 1, y: 65, z: 1, id: 3 },
        { x: 2, y: 65, z: 1, id: 3 },
      ],
    });
    expect(result.layers[0].indices.length).toBe(10 * 6);
    expect(result.layers[0].positions.length / 3).toBe(10 * 4);
    expect(result.revision).toBe(7);
    expect(result.voxels[1 * 256 + 1 * 16 + 1]).toBe(3);
  });
  it("uses the adjacent chunk snapshot to cull chunk-border faces", () => {
    const result = buildChunk({
      ...request,
      changes: [
        { x: 15, y: 65, z: 1, id: 3 },
        { x: 16, y: 65, z: 1, id: 3 },
      ],
    });
    expect(result.layers[0].indices.length).toBe(5 * 6);
  });
  it("separates water and torch glow while retaining partial slab height", () => {
    const slab = buildChunk({
      ...request,
      changes: [{ x: 1, y: 65, z: 1, id: 21 }],
    });
    const ys = [...slab.layers[0].positions].filter(
      (_, index) => index % 3 === 1,
    );
    expect(Math.max(...ys)).toBe(1.5);
    const mixed = buildChunk({
      ...request,
      changes: [
        { x: 1, y: 65, z: 1, id: 6 },
        { x: 3, y: 65, z: 1, id: 16 },
      ],
    });
    expect(mixed.layers[2].indices.length).toBeGreaterThan(0);
    expect(mixed.layers[3].indices.length).toBeGreaterThan(0);
  });
  it("darkens a surface covered by a roof and restores sky exposure when that roof is removed", () => {
    const floor = { x: 1, y: 65, z: 1, id: 3 };
    const open = buildChunk({ ...request, changes: [floor] });
    const enclosed = buildChunk({
      ...request,
      changes: [floor, { x: 1, y: 69, z: 1, id: 3 }],
    });
    const topColors = (result: ReturnType<typeof buildChunk>) => {
      const layer = result.layers[0],
        colors = [];
      for (let i = 0; i < layer.positions.length; i += 3)
        if (layer.positions[i + 1] === 2 && layer.normals[i + 1] === 1)
          colors.push(layer.colors[i]);
      return colors;
    };
    expect(topColors(open).every((c) => c === 1)).toBe(true);
    expect(Math.max(...topColors(enclosed))).toBeLessThan(0.5);
  });
});

describe("voxel collision and interaction", () => {
  it("sweeps a large movement without tunnelling through a wall", () => {
    const w = world({ "2,0,0": 3, "2,1,0": 3 }, true);
    const result = moveBody(
      w,
      { x: 0.5, y: 0, z: 0.5 },
      { x: 8, y: -0.1, z: 0 },
    );
    expect(result.position.x).toBeCloseTo(1.7);
    expect(result.hitX).toBe(true);
    expect(result.grounded).toBe(true);
    expect(intersectsWorld(w, result.position)).toBe(false);
  });
  it("steps onto a half slab but cannot step onto a full block", () => {
    const start = { x: 0.5, y: 0, z: 0.5 },
      movement = { x: 0.7, y: -0.1, z: 0 };
    const slab = moveBody(world({ "1,0,0": 21 }, true), start, movement);
    expect(slab.position.x).toBeCloseTo(1.2);
    expect(slab.position.y).toBeCloseTo(0.5);
    expect(moveBody(world({ "1,0,0": 3 }, true), start, movement).hitX).toBe(
      true,
    );
  });
  it("falls onto the ground without penetration and hits a low ceiling", () => {
    const landed = moveBody(
      world({}, true),
      { x: -0.5, y: 5, z: -0.5 },
      { x: 0, y: -10, z: 0 },
    );
    expect(landed.position.y).toBe(0);
    expect(landed.grounded).toBe(true);
    const ceiling = moveBody(
      world({ "0,2,0": 3 }),
      { x: 0.5, y: 0, z: 0.5 },
      { x: 0, y: 3, z: 0 },
    );
    expect(ceiling.position.y).toBeCloseTo(0.2);
    expect(ceiling.hitY).toBe(true);
  });
  it("distinguishes closed doors and open leaves and ignores water collision", () => {
    const closed = world({ "0,0,0": 18, "0,1,0": 25 });
    const open = world({ "0,0,0": 19, "0,1,0": 26 });
    const start = { x: 0.6, y: 0, z: -0.5 },
      delta = { x: 0, y: 0, z: 2 };
    expect(moveBody(closed, start, delta).hitZ).toBe(true);
    expect(moveBody(open, start, delta).hitZ).toBe(false);
    expect(
      intersectsWorld(world({ "0,0,0": 6 }), { x: 0.5, y: 0, z: 0.5 }),
    ).toBe(false);
  });
  it("raycasts negative coordinates, skips air above a slab, and selects thin ladder geometry", () => {
    const hit = raycastVoxel(
      world({ "-2,0,0": 3 }),
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: -1, y: 0, z: 0 },
    );
    expect(hit).toEqual({
      position: { x: -2, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      id: 3,
      distance: 1.5,
    });
    const beyond = raycastVoxel(
      world({ "1,0,0": 21, "2,0,0": 3 }),
      { x: 0, y: 0.75, z: 0.5 },
      { x: 1, y: 0, z: 0 },
    );
    expect(beyond?.position.x).toBe(2);
    expect(
      raycastVoxel(
        world({ "0,0,1": 20 }),
        { x: 0.5, y: 0.5, z: 0 },
        { x: 0, y: 0, z: 1 },
      )?.id,
    ).toBe(20);
  });
});
