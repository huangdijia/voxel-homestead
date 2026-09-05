import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulation, createNewSave, type PlayerInput } from "../src/game/Simulation";
import { exportMigrationBackup, saveWorld, validateSave } from "../src/game/storage";
import type { BlockChange, Vec3, WorldPort } from "../src/game/types";

class AuditWorld implements WorldPort {
  edits = new Map<string, BlockChange>();
  loaded = (_x: number, _z: number) => true;
  getBlock(x: number, y: number, z: number) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    return this.edits.get(`${x},${y},${z}`)?.id ?? (y < 0 ? 24 : y === 0 ? 1 : 0);
  }
  setBlock(x: number, y: number, z: number, id: number) {
    if (this.isReady(x, z)) this.edits.set(`${x},${y},${z}`, { x, y, z, id });
  }
  getChanges() { return [...this.edits.values()]; }
  isReady(x: number, z: number) { return this.loaded(x, z); }
  getSurface() { return 0; }
}
const idle: PlayerInput = { forward: 0, right: 0, jump: false, sprint: false, sneak: false };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup() {
  const world = new AuditWorld();
  const data = createNewSave("农业独立审查", "agriculture-audit", "survival");
  data.player.position = { x: .5, y: 1, z: 3.5 };
  data.player.spawn = { ...data.player.position };
  return { world, sim: new Simulation(world, data) };
}
function aim(sim: Simulation, target: Vec3) {
  const eye = sim.eye(), x = target.x - eye.x, y = target.y - eye.y, z = target.z - eye.z;
  sim.player.yaw = Math.atan2(-x, -z);
  sim.player.pitch = Math.atan2(y, Math.hypot(x, z));
}

describe("agriculture integration independent audit", () => {
  it("accepts snapshots at every 60 Hz simulation tick, including the first scan boundary", () => {
    const { sim } = setup();
    for (let tick = 1; tick <= 300; tick++) {
      sim.step(1 / 60, idle);
      expect(() => validateSave(sim.snapshot()), `tick=${tick}, accumulator=${sim.farming.snapshot().accumulator}`).not.toThrow();
    }
  });

  it("does not drop or remove a crop when an explosion reaches an unloaded column", () => {
    const { sim, world } = setup();
    sim.setBlock(2, 0, 0, 28);
    sim.setBlock(2, 1, 0, 37);
    world.loaded = (x) => x < 2;
    sim.explode({ x: 1, y: 1.5, z: .5 });
    expect(world.getBlock(2, 1, 0)).toBe(37);
    expect(sim.drops.filter((drop) => ["wheat", "wheat_seeds"].includes(drop.stack.id))).toEqual([]);
    expect(() => validateSave(sim.snapshot())).not.toThrow();
  });

  it("opens a chest while holding a hoe instead of swallowing the block interaction", () => {
    const { sim } = setup();
    sim.setBlock(0, 1, 0, 15);
    sim.player.inventory[0] = { id: "iron_hoe", count: 1, durability: 250 };
    aim(sim, { x: .5, y: 1.5, z: .5 });
    let opened: string | undefined;
    sim.onOpen = (kind) => { opened = kind; };
    sim.interact();
    expect(opened).toBe("chest");
    expect(sim.held?.durability).toBe(250);
  });

  it("does not consume breeding food for an animal in an unloaded column", () => {
    const { sim, world } = setup();
    sim.entities = [{ id: "unloaded-sheep", kind: "sheep", position: { x: .5, y: 1, z: 1 }, health: 8, yaw: 0, timer: 2 }];
    sim.player.inventory[0] = { id: "wheat", count: 2 };
    world.loaded = (_x, z) => z >= 2;
    aim(sim, { x: .5, y: 1.55, z: 1 });
    sim.interact();
    expect(sim.entities[0].love ?? 0).toBe(0);
    expect(sim.held?.count).toBe(2);
  });

  it("does not repeatedly collect bone meal from a composter in an unloaded column", () => {
    const { sim, world } = setup();
    sim.setBlock(0, 1, 0, 67);
    world.loaded = (_x, z) => z >= 2;
    aim(sim, { x: .5, y: 1.5, z: .5 });
    sim.interact(); sim.interact();
    expect(world.getBlock(0, 1, 0)).toBe(67);
    expect(sim.drops.filter((drop) => drop.stack.id === "bone_meal")).toEqual([]);
  });

  it("preserves seeds when the aimed farmland belongs to an unloaded column", () => {
    const { sim, world } = setup();
    sim.setBlock(0, 0, 0, 28);
    sim.player.inventory[0] = { id: "wheat_seeds", count: 2 };
    world.loaded = (_x, z) => z >= 2;
    aim(sim, { x: .5, y: .9, z: .5 });
    sim.interact();
    expect(world.getBlock(0, 1, 0)).toBe(0);
    expect(sim.held?.count).toBe(2);
  });

  it("does not feed an animal hidden behind the near corner of a solid wall", () => {
    const { sim } = setup();
    sim.player.position.x = .99;
    sim.entities = [{ id: "behind-wall", kind: "sheep", position: { x: .99, y: 1, z: .65 }, health: 8, yaw: 0, timer: 2 }];
    sim.setBlock(0, 1, 1, 3);
    sim.player.inventory[0] = { id: "wheat", count: 2 };
    aim(sim, { x: .99, y: 1.55, z: .65 });
    expect(sim.target()?.id).toBe(3);
    sim.interact();
    expect(sim.entities[0].love ?? 0).toBe(0);
    expect(sim.held?.count).toBe(2);
  });

  it("charges one hoe use when tilling grass with a plant above it", () => {
    const { sim, world } = setup();
    sim.player.position.x = .99;
    sim.setBlock(0, 1, 0, 58);
    sim.player.inventory[0] = { id: "iron_hoe", count: 1, durability: 250 };
    aim(sim, { x: .99, y: .9, z: .5 });
    expect(sim.target()?.id).toBe(1);
    sim.interact();
    expect(world.getBlock(0, 0, 0)).toBe(28);
    expect(sim.held?.durability).toBe(249);
  });

  it("exports a reimportable migration backup for a valid maximum-length world name", async () => {
    const legacy = createNewSave("旧".repeat(80), "long-name-backup", "survival");
    legacy.manifest.version = 1;
    legacy.manifest.generatorVersion = 1;
    delete legacy.farming;
    delete legacy.composters;
    delete legacy.fluids; delete legacy.natural;
    delete legacy.progression; delete legacy.sugarCane;
    await saveWorld(legacy);
    const upgraded = new Simulation(new AuditWorld(), legacy).snapshot();
    await saveWorld(upgraded);
    const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", { createElement: () => link, body: { append: vi.fn() } });
    let blob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => { blob = value as Blob; return "blob:agriculture-audit"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // Avoid leaving the download URL cleanup timer behind the audit test.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    await exportMigrationBackup(legacy.manifest.id);
    expect(blob).toBeDefined();
    const downloaded = JSON.parse(await blob!.text());
    expect(() => validateSave(downloaded)).not.toThrow();
  });
});
