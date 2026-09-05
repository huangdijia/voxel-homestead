import { describe, expect, it } from "vitest";
import {
  Simulation,
  createNewSave,
  type PlayerInput,
} from "../src/game/Simulation";
import { validateSave } from "../src/game/storage";
import { countItem } from "../src/game/inventory";
import { sampleBlock, surfaceHeight } from "../src/engine/generator";
import type {
  BlockChange,
  EntityState,
  Vec3,
  WorldPort,
} from "../src/game/types";

class FarmWorld implements WorldPort {
  edits = new Map<string, BlockChange>();
  ready = true;
  getBlock(x: number, y: number, z: number) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    return (
      this.edits.get(`${x},${y},${z}`)?.id ?? (y < 0 ? 24 : y === 0 ? 1 : 0)
    );
  }
  setBlock(x: number, y: number, z: number, id: number) {
    this.edits.set(`${x},${y},${z}`, { x, y, z, id });
  }
  getChanges() {
    return [...this.edits.values()];
  }
  isReady(x: number, z: number) {
    return this.ready && Math.hypot(x - 0.5, z - 3.5) < 8;
  }
  getSurface() {
    return 0;
  }
}
const idle: PlayerInput = {
  forward: 0,
  right: 0,
  jump: false,
  sprint: false,
  sneak: false,
};
function setup() {
  const world = new FarmWorld(),
    save = createNewSave("农牧测试", "farming-integration", "survival");
  save.player.position = { x: 0.5, y: 1, z: 3.5 };
  save.player.spawn = { ...save.player.position };
  save.player.hunger = 10;
  return { world, sim: new Simulation(world, save) };
}
function advance(sim: Simulation, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 20); i++) sim.step(0.05, idle);
}
function aim(sim: Simulation, target: Vec3) {
  const eye = sim.eye(),
    x = target.x - eye.x,
    y = target.y - eye.y,
    z = target.z - eye.z;
  sim.player.yaw = Math.atan2(-x, -z);
  sim.player.pitch = Math.atan2(y, Math.hypot(x, z));
}
function hold(sim: Simulation, id: string, count = 1, durability?: number) {
  sim.player.selected = 0;
  sim.player.inventory[0] = {
    id,
    count,
    ...(durability ? { durability } : {}),
  };
}
function tally(sim: Simulation, id: string) {
  return (
    countItem(sim.player.inventory, id) +
    sim.drops.reduce(
      (sum, d) => sum + (d.stack.id === id ? d.stack.count : 0),
      0,
    )
  );
}
function sheep(
  id: string,
  x: number,
  kind: "sheep" | "pig" = "sheep",
): EntityState {
  return {
    id,
    kind,
    position: { x, y: 1, z: 1 },
    health: kind === "sheep" ? 8 : 10,
    yaw: 0,
    timer: 100,
  };
}

describe("agriculture commands, acquisition and durable progression", () => {
  it("creates grass only for generator 2, leaving all version-1 terrain unchanged", () => {
    let grass = 0;
    for (let x = -16; x < 16; x++)
      for (let z = -16; z < 16; z++) {
        const y = surfaceHeight("versioned", x, z) + 1;
        const old = sampleBlock("versioned", x, y, z, 1),
          next = sampleBlock("versioned", x, y, z, 2);
        expect(sampleBlock("versioned", x, y, z)).toBe(old);
        if (next === 58) {
          grass++;
          expect(old).toBe(0);
        } else expect(next).toBe(old);
      }
    expect(grass).toBeGreaterThan(50);
  });
  it("tills, plants, irrigates, fertilizes and harvests through actual interaction commands", () => {
    const { sim, world } = setup();
    hold(sim, "wood_hoe", 1, 59);
    aim(sim, { x: 0.5, y: 0.9, z: 0.5 });
    sim.interact();
    expect(world.getBlock(0, 0, 0)).toBe(28);
    expect(sim.held?.durability).toBe(58);
    hold(sim, "wheat_seeds", 3);
    sim.interact();
    expect(world.getBlock(0, 1, 0)).toBe(30);
    expect(sim.held?.count).toBe(2);
    sim.setBlock(2, 0, 0, 6);
    advance(sim, 1);
    expect(world.getBlock(0, 0, 0)).toBe(29);
    hold(sim, "bone_meal", 10);
    aim(sim, { x: 0.5, y: 1.08, z: 0.5 });
    for (let i = 0; i < 6; i++) sim.interact();
    expect(world.getBlock(0, 1, 0)).toBe(37);
    const remaining = sim.held!.count;
    sim.interact();
    expect(sim.held!.count).toBe(remaining);
    sim.breakBlock({ x: 0, y: 1, z: 0 });
    expect(tally(sim, "wheat")).toBe(1);
    expect(world.getBlock(0, 1, 0)).toBe(0);
    expect(() => validateSave(sim.snapshot())).not.toThrow();
  });
  it("transfers a source into a stacked bucket and places it without creating extra buckets", () => {
    const { sim, world } = setup();
    sim.setBlock(0, 1, 0, 6);
    hold(sim, "bucket", 16);
    aim(sim, { x: 0.5, y: 1.3, z: 0.5 });
    sim.interact();
    expect(world.getBlock(0, 1, 0)).toBe(0);
    expect(tally(sim, "bucket")).toBe(15);
    expect(tally(sim, "water_bucket")).toBe(1);
    sim.player.selected = sim.player.inventory.findIndex(
      (s) => s?.id === "water_bucket",
    );
    aim(sim, { x: 0.5, y: 0.9, z: 0.5 });
    sim.interact();
    expect(world.getBlock(0, 1, 0)).toBe(6);
    expect(tally(sim, "bucket")).toBe(16);
    expect(tally(sim, "water_bucket")).toBe(0);
  });
  it("blocks water collection through a wall and preserves buckets in unloaded land", () => {
    const { sim, world } = setup();
    sim.setBlock(0, 1, 0, 6);
    sim.setBlock(0, 1, 1, 3);
    sim.setBlock(0, 2, 1, 3);
    hold(sim, "bucket");
    aim(sim, { x: 0.5, y: 1.3, z: 0.5 });
    sim.interact();
    expect(tally(sim, "water_bucket")).toBe(0);
    expect(world.getBlock(0, 1, 0)).toBe(6);
    world.ready = false;
    sim.interact();
    expect(sim.held?.id).toBe("bucket");
  });
  it("replaces a crop with a building block and returns its harvest exactly once", () => {
    const { sim, world } = setup();
    sim.setBlock(0, 0, 0, 29);
    sim.setBlock(0, 1, 0, 37);
    hold(sim, "planks", 3);
    aim(sim, { x: 0.5, y: 1.4, z: 0.5 });
    sim.interact();
    expect(world.getBlock(0, 1, 0)).toBe(11);
    expect(sim.held?.count).toBe(2);
    expect(tally(sim, "wheat")).toBe(1);
    expect(() => validateSave(sim.snapshot())).not.toThrow();
  });
  it("composts gathered leaves, resumes maturation after save, and uses the bone meal on grass", () => {
    const { sim, world } = setup();
    sim.setBlock(0, 1, 0, 59);
    hold(sim, "leaves", 64);
    aim(sim, { x: 0.5, y: 1.5, z: 0.5 });
    for (let i = 0; i < 64 && world.getBlock(0, 1, 0) < 66; i++) sim.interact();
    expect(world.getBlock(0, 1, 0)).toBe(66);
    advance(sim, 0.5);
    const data = validateSave(sim.snapshot()),
      resumed = new Simulation(world, data);
    advance(resumed, 0.55);
    expect(world.getBlock(0, 1, 0)).toBe(67);
    resumed.interact();
    expect(world.getBlock(0, 1, 0)).toBe(59);
    expect(tally(resumed, "bone_meal")).toBe(1);
    const drop = resumed.drops.find((d) => d.stack.id === "bone_meal")!;
    resumed.player.position = {
      x: drop.position.x,
      y: 1,
      z: drop.position.z + 0.9,
    };
    advance(resumed, 1);
    resumed.player.selected = resumed.player.inventory.findIndex(
      (s) => s?.id === "bone_meal",
    );
    expect(resumed.player.selected).toBeGreaterThanOrEqual(0);
    aim(resumed, { x: 2.5, y: 0.9, z: 1.5 });
    resumed.interact();
    expect(
      world.getChanges().filter((c) => c.id === 58).length,
    ).toBeGreaterThan(0);
    expect(tally(resumed, "bone_meal")).toBe(0);
    expect(() => validateSave(resumed.snapshot())).not.toThrow();
  });
  it("returns an empty bowl after eating soup, including with a full inventory", () => {
    const { sim } = setup();
    sim.player.inventory.fill(null);
    for (let i = 1; i < 36; i++)
      sim.player.inventory[i] = { id: "dirt", count: 64 };
    hold(sim, "beetroot_soup");
    aim(sim, { x: 0.5, y: 8, z: 0.5 });
    sim.interact();
    advance(sim, 1.7);
    expect(tally(sim, "bowl")).toBe(1);
    expect(tally(sim, "beetroot_soup")).toBe(0);
    expect(sim.player.hunger).toBe(16);
  });
});

describe("animal husbandry in the authoritative simulation", () => {
  it("feeds a pair, creates exactly one baby, persists cooldowns, and accelerates baby growth", () => {
    const { sim } = setup();
    sim.entities = [sheep("a", 0), sheep("b", 1.3)];
    hold(sim, "wheat", 8);
    for (const e of sim.entities) {
      aim(sim, { ...e.position, y: 1.55 });
      sim.interact();
    }
    expect(sim.held?.count).toBe(6);
    expect(sim.entities.every((e) => e.love === 60)).toBe(true);
    advance(sim, 4);
    expect(sim.entities).toHaveLength(3);
    const child = sim.entities.find((e) => (e.age ?? 0) < 0)!;
    expect(child).toBeDefined();
    expect(
      sim.entities.filter((e) => (e.breedCooldown ?? 0) > 295),
    ).toHaveLength(2);
    const resumed = new Simulation(sim.world, validateSave(sim.snapshot()));
    advance(resumed, 4);
    expect(resumed.entities).toHaveLength(3);
    const baby = resumed.entities.find((e) => (e.age ?? 0) < 0)!;
    // Separate overlapping family members to exercise the baby hit volume.
    resumed.entities
      .filter((e) => e.id !== baby.id)
      .forEach((e) => (e.position = { x: 6, y: 1, z: 6 }));
    baby.position = { x: 0.5, y: 1, z: 1 };
    resumed.player.position = { x: 0.5, y: 1, z: 3 };
    const before = baby.age!;
    aim(resumed, { ...baby.position, y: 1.28 });
    resumed.interact();
    expect(baby.age).toBeGreaterThan(before + 100);
    expect(resumed.held?.count).toBe(5);
  });
  it("does not feed through walls or breed across species", () => {
    const { sim } = setup();
    sim.entities = [sheep("a", 0.5), sheep("b", 1.5, "pig")];
    hold(sim, "wheat", 5);
    sim.setBlock(0, 1, 2, 3);
    sim.setBlock(0, 2, 2, 3);
    aim(sim, { x: 0.5, y: 1.55, z: 1 });
    sim.interact();
    expect(sim.entities[0].love).toBeUndefined();
    expect(sim.held?.count).toBe(5);
    sim.entities.forEach((e) => (e.love = 60));
    advance(sim, 5);
    expect(sim.entities).toHaveLength(2);
  });
  it("allows feeding through non-solid grass while still selecting grass for harvesting", () => {
    const { sim } = setup();
    sim.entities = [sheep("a", 0.5)];
    sim.setBlock(0, 1, 2, 58);
    hold(sim, "wheat", 3);
    aim(sim, { x: 0.5, y: 1.55, z: 1 });
    sim.interact();
    expect(sim.entities[0].love).toBe(60);
    expect(sim.held?.count).toBe(2);
  });
  it("shears only once, regrows wool after grazing, and drops no adult resources from babies", () => {
    const { sim } = setup();
    const adult = sheep("adult", 0.5);
    sim.entities = [adult];
    hold(sim, "shears", 1, 238);
    aim(sim, { ...adult.position, y: 1.55 });
    sim.interact();
    const wool = tally(sim, "wool");
    expect(wool).toBeGreaterThan(0);
    expect(sim.held?.durability).toBe(237);
    sim.interact();
    expect(tally(sim, "wool")).toBe(wool);
    expect(sim.held?.durability).toBe(237);
    hold(sim, "wheat", 1);
    advance(sim, 31);
    expect(adult.sheared).toBe(false);
    expect(sim.world.getChanges().some((c) => c.id === 2)).toBe(true);
    sim.entities = [
      { ...sheep("baby", 0.5), position: { x: 0.5, y: 1, z: 1 }, age: -900 },
    ];
    sim.player.position = { x: 0.5, y: 1, z: 3 };
    hold(sim, "iron_sword", 1, 250);
    aim(sim, { x: 0.5, y: 1.3, z: 1 });
    for (let i = 0; i < 3; i++) {
      const victim = sim.entities.find((e) => e.id === "baby");
      if (!victim) break;
      sim.player.position = { ...victim.position, z: victim.position.z + 2 };
      aim(sim, { ...victim.position, y: victim.position.y + 0.3 });
      sim.attack();
      advance(sim, 0.6);
    }
    expect(sim.entities.find((e) => e.id === "baby")).toBeUndefined();
    expect(tally(sim, "raw_mutton")).toBe(0);
  });
});
