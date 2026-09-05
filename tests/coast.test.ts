import { describe, expect, it } from "vitest";
import { coastWeight } from "../src/engine/coast";
import { sampleBlock, surfaceHeight } from "../src/engine/generator";
import { intersectsWorld, moveBody } from "../src/engine/physics";
import { createNewSave, Simulation } from "../src/game/Simulation";
import { validateSave } from "../src/game/storage";
import type { Vec3, WorldPort } from "../src/game/types";

const seed = "coast-20260905";
const block = (x: number, y: number, z: number) =>
  sampleBlock(seed, x, y, z, 7);
const world = { getBlock: block, isReady: () => true };

describe("seaside world", () => {
  it.each([seed, "mountain", "海风"])(
    "creates a dry spawn, villa and ocean for %s",
    (seed) => {
      const save = createNewSave("海边", seed, "survival");
      expect(save.manifest.generatorVersion).toBe(7);
      expect(validateSave(save)).toEqual(save);
      expect(surfaceHeight(seed, 0, 0, 7)).toBe(68);
      expect(sampleBlock(seed, 31, 68, -14, 7)).toBe(11);
      expect(sampleBlock(seed, 40, 62, -85, 7)).toBe(6);
      expect(sampleBlock(seed, 40, 63, -85, 7)).toBe(0);
      expect(sampleBlock(seed, 51, 66, -20, 7)).toBe(6);
    },
  );
  it("preserves remote terrain and underground v6 content", () => {
    for (let x = -160; x <= 192; x += 16)
      for (let z = -256; z <= 80; z += 16)
        for (const y of [-64, -32, 0, 47, 63, 80, 120, 319]) {
          if (coastWeight(x, z) > 0 && y >= 48) continue;
          expect(block(x, y, z)).toBe(sampleBlock(seed, x, y, z, 6));
        }
  });
  it("has a clear arrival route and connected rooms, stairs and balcony", () => {
    const walk = (from: Vec3, delta: Vec3) => {
      const moved = moveBody(world, from, delta, 0.6, 1.8);
      expect(moved.hitX || moved.hitZ).toBe(false);
      expect(intersectsWorld(world, moved.position)).toBe(false);
      return moved.position;
    };
    let p = { x: 0.5, y: 69, z: 0.5 };
    for (let i = 0; i < 32; i++) p = walk(p, { x: 1, y: 0, z: 0 });
    for (let i = 0; i < 15; i++) p = walk(p, { x: 0, y: 0, z: -1 });
    expect(p.z).toBe(-14.5);
    // Each full block stair is jumpable with two clear blocks above it.
    for (let i = 0; i < 6; i++) {
      const floor = { x: 21, y: 69 + i, z: -15 - i };
      expect(block(floor.x, floor.y, floor.z)).toBe(11);
      expect(
        intersectsWorld(world, { x: 21.5, y: floor.y + 1, z: floor.z + 0.5 }),
      ).toBe(false);
    }
    p = { x: 21.5, y: 75, z: -20.5 };
    p = walk(p, { x: 0, y: 0, z: -1 });
    expect(block(21, 74, -22)).toBe(11);
    for (let i = 0; i < 11; i++) p = walk(p, { x: 1, y: 0, z: 0 });
    for (let i = 0; i < 12; i++) p = walk(p, { x: 0, y: 0, z: -1 });
    expect(p.z).toBe(-33.5);
    expect(block(32, 74, -34)).toBe(11);
  });
  it("contains pool water, exit steps and a supported pier", () => {
    expect(block(50, 67, -20)).toBe(23);
    expect(block(55, 65, -20)).toBe(23);
    expect(block(51, 67, -14)).toBe(23);
    expect(block(51, 68, -13)).toBe(23);
    expect(block(32, 64, -60)).toBe(11);
    expect(block(30, 60, -55)).toBe(7);
    expect(block(32, 65, -60)).toBe(0);
  });
  it("climbs the staircase and exits the pool with normal survival movement", () => {
    const port: WorldPort = {
      ...world,
      setBlock() {},
      getSurface: (x, z) => surfaceHeight(seed, x, z, 7),
      getChanges: () => [],
    };
    for (const [position, forward, reached] of [
      [{ x: 21.5, y: 69, z: -13.5 }, 1, (p: Vec3) => p.y >= 75 && p.z < -21],
      [{ x: 52.5, y: 66, z: -17.5 }, -1, (p: Vec3) => p.y >= 69 && p.z > -13],
    ] as const) {
      const save = createNewSave("行走验收", seed, "survival");
      save.player.position = { ...position };
      save.player.yaw = 0;
      const sim = new Simulation(port, save);
      for (let frame = 0; frame < 600 && !reached(sim.player.position); frame++)
        sim.step(1 / 60, {
          forward,
          right: 0,
          jump: true,
          sprint: false,
          sneak: false,
        });
      expect(
        reached(sim.player.position),
        JSON.stringify(sim.player.position),
      ).toBe(true);
      expect(sim.player.dead).toBe(false);
    }
  });
  it("retains old generator selection when saving an existing world", () => {
    const save = createNewSave("旧世界", seed, "survival");
    save.manifest.generatorVersion = 6;
    const port: WorldPort = {
      ...world,
      setBlock() {},
      getSurface: () => 68,
      getChanges: () => [],
    };
    const sim = new Simulation(port, save);
    sim.equipRifle();
    const restored = validateSave(sim.snapshot());
    expect(restored.manifest.generatorVersion).toBe(6);
    expect(restored.player.inventory[0]?.id).toBe("rifle");
  });
});
