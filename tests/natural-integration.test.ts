import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNewSave, Simulation } from "../src/game/Simulation";
import {
  validateSave,
  saveWorld,
  loadWorld,
  loadMigrationBackup,
  migrationBackupVersions,
} from "../src/game/storage";
import { sampleBlock } from "../src/engine/generator";
import type { BlockChange, Vec3, WorldPort } from "../src/game/types";
class World implements WorldPort {
  blocks = new Map<string, BlockChange>();
  loaded = true;
  getBlock(x: number, y: number, z: number) {
    return (
      this.blocks.get(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`)
        ?.id ?? (y <= 0 ? 3 : 0)
    );
  }
  setBlock(x: number, y: number, z: number, id: number) {
    this.blocks.set(`${x},${y},${z}`, { x, y, z, id });
  }
  isReady(_x?: number, _z?: number) {
    return this.loaded;
  }
  getSurface() {
    return 0;
  }
  getChanges() {
    return [...this.blocks.values()];
  }
}
const idle = { forward: 0, right: 0, jump: false, sprint: false, sneak: false };
function fixture() {
  const world = new World(),
    save = createNewSave("自然更新测试", "natural", "survival");
  save.player.position = { x: 0.5, y: 1, z: 5.5 };
  save.player.spawn = { ...save.player.position };
  return { world, sim: new Simulation(world, save) };
}
function step(sim: Simulation, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) sim.step(1 / 60, idle);
}
function aim(sim: Simulation, point: Vec3) {
  const eye = sim.eye(),
    dx = point.x - eye.x,
    dy = point.y - eye.y,
    dz = point.z - eye.z;
  sim.player.yaw = Math.atan2(-dx, -dz);
  sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
afterEach(() => vi.unstubAllGlobals());
describe("natural world integration and checkpoints", () => {
  it("starts version 3 with valid detached natural state", () => {
    const save = createNewSave("新世界", "version-three", "survival");
    expect(save.manifest.generatorVersion).toBe(3);
    expect(validateSave(save)).toEqual(save);
  });
  it("keeps old terrain generators unchanged while new deep caves contain lava", () => {
    let pools = 0;
    for (let x = -40; x <= 40; x += 2)
      for (let z = -40; z <= 40; z += 2) {
        const old = sampleBlock("natural", x, -6, z, 2),
          next = sampleBlock("natural", x, -6, z, 3);
        if (next === 76) {
          expect(old).toBe(0);
          pools++;
        } else expect(next).toBe(old);
      }
    expect(pools).toBeGreaterThan(0);
  });
  it("continues spreading water from an IndexedDB checkpoint without losing queued updates", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const { world, sim } = fixture();
    sim.setBlock(-17, 1, -1, 6);
    sim.player.position = { x: -13, y: 1, z: 5 };
    step(sim, 0.5);
    const checkpoint = sim.snapshot();
    expect(checkpoint.fluids!.tasks.length).toBeGreaterThan(0);
    await saveWorld(checkpoint);
    const loaded = (await loadWorld(checkpoint.manifest.id))!;
    expect(loaded.fluids).toEqual(checkpoint.fluids);
    const copy = new World();
    for (const c of loaded.changes) copy.setBlock(c.x, c.y, c.z, c.id);
    const resumed = new Simulation(copy, loaded);
    step(sim, 2);
    step(resumed, 2);
    const fluidCells = (w: World) =>
      w
        .getChanges()
        .filter((c) => c.id === 6 || (c.id >= 68 && c.id <= 75))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(fluidCells(copy)).toEqual(fluidCells(world));
    expect(validateSave(resumed.snapshot()).fluids).toEqual(
      resumed.fluids.snapshot(),
    );
  });
  it("keeps independent v1 and v2 pre-migration backups", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const { sim } = fixture(),
      one = sim.snapshot();
    one.manifest.version = 1;
    one.manifest.generatorVersion = 1;
    delete one.farming;
    delete one.composters;
    delete one.fluids;
    delete one.natural;
    await saveWorld(one);
    const two = sim.snapshot();
    two.manifest.version = 2;
    two.manifest.generatorVersion = 1;
    delete two.fluids;
    delete two.natural;
    await saveWorld(two);
    await saveWorld(sim.snapshot());
    expect(await loadMigrationBackup(one.manifest.id, 1)).toEqual(one);
    expect(await loadMigrationBackup(one.manifest.id, 2)).toEqual(two);
    expect(await loadMigrationBackup(one.manifest.id)).toEqual(two);
    expect((await migrationBackupVersions())[one.manifest.id]).toEqual([1, 2]);
  });
  it("drops a sand column once and reloads its settled blocks", () => {
    const { sim, world } = fixture();
    sim.setBlock(5, 5, 0, 4);
    sim.setBlock(5, 6, 0, 5);
    step(sim, 2);
    expect(world.getBlock(5, 1, 0)).toBe(4);
    expect(world.getBlock(5, 2, 0)).toBe(5);
    expect(
      world.getChanges().filter((c) => c.id === 4 || c.id === 5),
    ).toHaveLength(2);
    expect(validateSave(sim.snapshot()).natural).toEqual(
      sim.natural.snapshot(),
    );
  });
  it("lava injures survival players, burns dropped items and ignores creative health", () => {
    const { sim } = fixture();
    sim.setBlock(0, 1, 5, 76);
    sim.spawnDrop({ id: "log", count: 1 }, { x: 0.5, y: 1, z: 5.5 });
    sim.step(1 / 60, idle);
    expect(sim.player.health).toBeLessThan(20);
    expect(sim.drops).toHaveLength(0);
    sim.manifest.mode = "creative";
    sim.step(1 / 60, idle);
    expect(sim.player.health).toBe(20);
  });
  it("a lava fuel bucket leaves exactly one reusable bucket", () => {
    const { sim } = fixture();
    sim.setBlock(3, 1, 0, 14);
    sim.containers["3,1,0"] = {
      kind: "furnace",
      slots: [
        { id: "raw_iron", count: 2 },
        { id: "lava_bucket", count: 1 },
        null,
      ],
      burn: 0,
      burnTotal: 0,
      progress: 0,
    };
    step(sim, 10.1);
    const furnace = sim.containers["3,1,0"];
    expect(furnace.slots[1]).toEqual({ id: "bucket", count: 1 });
    expect(furnace.slots[2]).toEqual({ id: "iron_ingot", count: 1 });
    expect(validateSave(sim.snapshot()).containers).toEqual(sim.containers);
  });
  it("rejects a cargo record that duplicates unchanged generated gravel", () => {
    const save = createNewSave("下落校验", "natural", "survival");
    let found = false;
    for (let x = -40; x < 40 && !found; x++)
      for (let z = -40; z < 40 && !found; z++) {
        if (sampleBlock(save.manifest.seed, x, 10, z, 3) !== 5) continue;
        save.natural!.falling = [{ x, y: 10, z, id: 5 }];
        expect(() => validateSave(save)).toThrow("下落方块与世界方块重复");
        save.changes = [{ x, y: 10, z, id: 0 }];
        expect(() => validateSave(save)).not.toThrow();
        found = true;
      }
    expect(found).toBe(true);
  });
  it("freezes all natural state when the player column is unavailable", () => {
    const { sim, world } = fixture();
    sim.setBlock(2, 2, 2, 6);
    const state = sim.snapshot();
    world.loaded = false;
    step(sim, 2);
    expect(sim.fluids.snapshot()).toEqual(state.fluids);
    expect(sim.natural.snapshot()).toEqual(state.natural);
  });
  it("rejects a sapling on farmland without harvesting the existing crop or consuming inventory", () => {
    const { sim, world } = fixture();
    sim.setBlock(0, 0, 0, 28);
    sim.setBlock(0, 1, 0, 37);
    sim.player.position = { x: 0.5, y: 1, z: 3 };
    sim.player.inventory[0] = { id: "oak_sapling", count: 2 };
    sim.player.selected = 0;
    aim(sim, { x: 0.5, y: 1.5, z: 0.5 });
    expect(sim.target()?.id).toBe(37);
    const before = sim.snapshot();
    sim.interact();
    expect(world.getBlock(0, 1, 0)).toBe(37);
    expect(world.getChanges()).toEqual(before.changes);
    expect(sim.player.inventory).toEqual(before.player.inventory);
    expect(sim.drops).toEqual(before.drops);
    expect(sim.lastMessage).toContain("树苗需要种在泥土或草方块上");
  });
  it("grows a fertilized sapling into one tree without dropping or refunding another sapling", () => {
    const { sim, world } = fixture();
    sim.setBlock(0, 0, 0, 2);
    sim.setBlock(0, 1, 0, 83);
    sim.player.position = { x: 0.5, y: 1, z: 3 };
    sim.player.inventory[0] = { id: "bone_meal", count: 2 };
    sim.player.selected = 0;
    aim(sim, { x: 0.5, y: 1.4, z: 0.5 });
    expect(sim.target()?.id).toBe(83);
    sim.interact();
    expect(world.getBlock(0, 1, 0)).toBe(7);
    expect(world.getChanges().filter((block) => block.id === 7)).toHaveLength(
      5,
    );
    expect(
      world.getChanges().filter((block) => block.id === 8).length,
    ).toBeGreaterThan(0);
    expect(world.getChanges().some((block) => block.id === 83)).toBe(false);
    expect(sim.held).toEqual({ id: "bone_meal", count: 1 });
    expect(sim.drops).toEqual([]);
    expect(
      sim.player.inventory.some((stack) => stack?.id === "oak_sapling"),
    ).toBe(false);
    expect(validateSave(sim.snapshot()).drops).toEqual([]);
  });
  it("collects a loaded source before an unloaded solid target without losing a stacked bucket", () => {
    const { sim, world } = fixture();
    world.setBlock(15, 1, 0, 6);
    world.setBlock(16, 1, 0, 3);
    vi.spyOn(world, "isReady").mockImplementation((x = 0) => x < 16);
    sim.player.position = { x: 14, y: 0, z: 0.5 };
    sim.player.inventory[0] = { id: "bucket", count: 2 };
    sim.player.selected = 0;
    aim(sim, { x: 15.5, y: 1.62, z: 0.5 });
    expect(sim.target()?.position).toEqual({ x: 16, y: 1, z: 0 });
    sim.interact();
    expect(world.getBlock(15, 1, 0)).toBe(0);
    expect(world.getBlock(16, 1, 0)).toBe(3);
    expect(sim.held).toEqual({ id: "bucket", count: 1 });
    expect(
      sim.player.inventory.filter((stack) => stack?.id === "water_bucket"),
    ).toEqual([{ id: "water_bucket", count: 1 }]);
    expect(sim.drops).toEqual([]);
    expect(sim.lastMessage).toBe("装了一桶水");
  });
  for (const [name, corrupt] of [
    [
      "duplicate fluid task",
      (s: any) => {
        const task = { x: 0, y: 1, z: 0, kind: "water", due: 0 };
        s.fluids.tasks = [task, task];
      },
    ],
    [
      "fluid due outside clock",
      (s: any) => {
        s.fluids.tasks = [{ x: 0, y: 1, z: 0, kind: "water", due: 100 }];
      },
    ],
    [
      "invalid falling block",
      (s: any) => {
        s.natural.falling = [{ x: 0, y: 1, z: 0, id: 81 }];
      },
    ],
    [
      "out of bounds cursor",
      (s: any) => {
        s.natural.scanCursor = 1e9;
      },
    ],
    [
      "old version with future blocks",
      (s: any) => {
        s.manifest.version = 2;
        s.manifest.generatorVersion = 2;
        delete s.natural;
        delete s.fluids;
        s.changes = [{ x: 0, y: 1, z: 0, id: 76 }];
      },
    ],
  ] as const)
    it(`rejects ${name}`, () => {
      const s = createNewSave("测试", "schema", "survival");
      corrupt(s);
      expect(() => validateSave(s)).toThrow();
    });
});
