import { describe, expect, it } from "vitest";
import { traceRifle, RIFLE } from "../src/game/firearms";
import { createNewSave, Simulation } from "../src/game/Simulation";
import { validateSave } from "../src/game/storage";
import type {
  BlockChange,
  EntityState,
  WorldEvent,
  WorldPort,
} from "../src/game/types";

class World implements WorldPort {
  changes: BlockChange[] = [];
  loaded = true;
  getBlock(x: number, y: number, z: number) {
    return (
      this.changes.find(
        (b) =>
          b.x === Math.floor(x) &&
          b.y === Math.floor(y) &&
          b.z === Math.floor(z),
      )?.id ?? (y < 0 ? 3 : 0)
    );
  }
  setBlock(x: number, y: number, z: number, id: number) {
    this.changes.push({ x, y, z, id });
  }
  getChanges() {
    return this.changes;
  }
  isReady(_x: number, z: number) {
    return this.loaded || z > -10;
  }
  getSurface() {
    return -1;
  }
}
const mob = (id: string, z: number, x = 0): EntityState => ({
  id,
  kind: "zombie",
  position: { x, y: 0, z },
  health: 20,
  yaw: 0,
  timer: 0,
});
const eye = { x: 0, y: 1, z: 0 },
  dir = { x: 0, y: 0, z: -1 };
const idle = { forward: 0, right: 0, jump: false, sprint: false, sneak: false };
function setup() {
  const world = new World(),
    events: WorldEvent[] = [];
  const save = createNewSave("枪械验收", "rifle", "survival");
  save.player.position = { x: 0, y: 0, z: 0 };
  save.player.yaw = 0;
  save.player.pitch = 0;
  const sim = new Simulation(world, save, (event) => events.push(event));
  sim.equipRifle();
  return { world, sim, events };
}
describe("infinite ammunition rifle", () => {
  it("hits the nearest body, misses off-axis bodies and respects maximum range", () => {
    const world = new World();
    expect(
      traceRifle(world, [mob("far", -40), mob("near", -20)], eye, dir).victim
        ?.id,
    ).toBe("near");
    expect(
      traceRifle(world, [mob("off", -20, 1), mob("beyond", -74)], eye, dir)
        .victim,
    ).toBeUndefined();
  });
  it.each([3, 17, 23])("stops at block %s without damaging terrain", (id) => {
    const world = new World();
    world.setBlock(0, 1, -10, id);
    const result = traceRifle(world, [mob("blocked", -20)], eye, dir);
    expect(result.victim).toBeUndefined();
    expect(result.end.z).toBe(-9);
    expect(world.getBlock(0, 1, -10)).toBe(id);
  });
  it("does not hit through unloaded sections", () => {
    const world = new World();
    world.loaded = false;
    expect(
      traceRifle(world, [mob("blocked", -20)], eye, dir).victim,
    ).toBeUndefined();
  });
  it("fires into empty space, enforces cooldown and never consumes ammo or durability", () => {
    const { sim, events } = setup();
    sim.player.pitch = 1.2;
    for (let i = 0; i < 100; i++) {
      expect(sim.attack()).toBe(true);
      expect(sim.attack()).toBe(false);
      for (let j = 0; j < 8; j++) sim.step(1 / 60, idle);
    }
    expect(events.filter((e) => e.type === "shot")).toHaveLength(100);
    expect(sim.held).toEqual({ id: "rifle", count: 1 });
    expect(validateSave(sim.snapshot()).player.inventory[0]).toEqual(sim.held);
  });
  it("damages distant mobs and awards experience on a kill", () => {
    const { sim } = setup();
    const victim = mob("target", -20);
    sim.entities = [victim];
    expect(sim.attack()).toBe(true);
    expect(victim.health).toBe(20 - RIFLE.damage);
    for (let shot = 0; shot < 2; shot++) {
      for (let j = 0; j < 8; j++) sim.step(1 / 60, idle);
      sim.attack();
    }
    expect(sim.entities.find((e) => e.id === "target")).toBeUndefined();
    expect(
      sim.progression.orbs.reduce((n, orb) => n + orb.value, 0),
    ).toBeGreaterThan(0);
  });
  it("never mines with a rifle, even during the shot cooldown", () => {
    const { sim, world } = setup();
    world.setBlock(0, 1, -2, 3);
    sim.attack();
    for (let i = 0; i < 100; i++) expect(sim.mine(1)).toBe(false);
    expect(world.getBlock(0, 1, -2)).toBe(3);
  });
  it("equips one rifle without deleting items, and rejects full inventory or death", () => {
    const { sim } = setup();
    sim.equipRifle();
    expect(sim.player.inventory.filter((s) => s?.id === "rifle")).toHaveLength(
      1,
    );
    sim.player.inventory[15] = sim.player.inventory[0];
    sim.player.inventory[0] = { id: "stone", count: 64 };
    sim.equipRifle();
    expect(sim.held?.id).toBe("rifle");
    expect(sim.player.inventory[15]).toEqual({ id: "stone", count: 64 });
    sim.player.inventory.fill({ id: "stone", count: 64 });
    const before = structuredClone(sim.player.inventory);
    expect(sim.equipRifle()).toBe(false);
    expect(sim.player.inventory).toEqual(before);
    sim.player.dead = true;
    expect(sim.attack()).toBe(false);
    expect(sim.equipRifle()).toBe(false);
  });
});
