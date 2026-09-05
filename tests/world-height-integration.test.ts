import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNewSave, Simulation } from "../src/game/Simulation";
import { countItem } from "../src/game/inventory";
import { WORLD_MIN_Y, WORLD_MAX_Y } from "../src/engine/world-height";
import {
  validateSave,
  loadWorld,
  saveWorld,
  loadMigrationBackup,
} from "../src/game/storage";
import type { BlockChange, SaveData, Vec3, WorldPort } from "../src/game/types";

class HeightWorld implements WorldPort {
  changes = new Map<string, BlockChange>();
  ready = (y: number) => true;
  constructor(
    readonly floor = 0,
    changes: BlockChange[] = [],
  ) {
    changes.forEach((c) => this.setBlock(c.x, c.y, c.z, c.id));
  }
  getBlock(x: number, y: number, z: number) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) return 0;
    return this.changes.get(`${x},${y},${z}`)?.id ?? (y <= this.floor ? 3 : 0);
  }
  setBlock(x: number, y: number, z: number, id: number) {
    if (y >= WORLD_MIN_Y && y <= WORLD_MAX_Y)
      this.changes.set(`${x},${y},${z}`, { x, y, z, id });
  }
  isReady(_x: number, _z: number, y = 1) {
    return this.ready(y);
  }
  getSurface() {
    return this.floor;
  }
  getChanges() {
    return [...this.changes.values()];
  }
}
const idle = { forward: 0, right: 0, jump: false, sprint: false, sneak: false };
function fixture(floor = 0) {
  const world = new HeightWorld(floor),
    save = createNewSave("完整高度验收", "world-height", "survival");
  save.player.position = { x: 0.5, y: floor + 1, z: 3.5 };
  save.player.spawn = { ...save.player.position };
  save.player.hunger = 10;
  return { world, sim: new Simulation(world, save) };
}
function advance(sim: Simulation, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.step(1 / 60, idle);
}
function aim(sim: Simulation, p: Vec3) {
  const e = sim.eye(),
    dx = p.x - e.x,
    dy = p.y - e.y,
    dz = p.z - e.z;
  sim.player.yaw = Math.atan2(-dx, -dz);
  sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
afterEach(() => vi.unstubAllGlobals());

describe("full-height simulation", () => {
  it.each([-64, -63, 95, 96, 255, 318, 319])(
    "allows block edits throughout the buildable range y=%i",
    (y) => {
      const { sim, world } = fixture();
      expect(sim.setBlock(2, y, 2, 11)).toBe(true);
      expect(world.getBlock(2, y, 2)).toBe(11);
      expect(validateSave(sim.snapshot()).changes).toContainEqual({
        x: 2,
        y,
        z: 2,
        id: 11,
      });
    },
  );
  it.each([-65, 320])(
    "rejects edits outside y=%i without side effects",
    (y) => {
      const { sim, world } = fixture();
      const before = sim.snapshot();
      expect(sim.setBlock(2, y, 2, 11)).toBe(false);
      expect(world.getChanges()).toEqual(before.changes);
      expect(sim.fluids.snapshot()).toEqual(before.fluids);
      expect(sim.natural.snapshot()).toEqual(before.natural);
    },
  );
  it("survives the old void threshold at -63 and retains deep item drops", () => {
    const { sim } = fixture(-64);
    sim.spawnDrop({ id: "diamond", count: 1 }, { x: 5, y: -63, z: 5 });
    advance(sim, 0.5);
    expect(sim.player.dead).toBe(false);
    expect(sim.player.health).toBe(20);
    expect(sim.drops).toHaveLength(1);
    expect(sim.drops[0].stack.id).toBe("diamond");
  });
  it("allows empty space below bedrock and applies the new void threshold", () => {
    const { sim } = fixture(-64);
    sim.player.position = { x: 0.5, y: -90, z: 3.5 };
    advance(sim, 0.1);
    expect(sim.player.dead).toBe(false);
    sim.player.position.y = -129;
    advance(sim, 0.1);
    expect(sim.player.dead).toBe(true);
  });
  it("keeps a falling item below y=-64 until it reaches the void cleanup threshold", () => {
    const { sim } = fixture();
    sim.spawnDrop({ id: "diamond", count: 1 }, { x: 8, y: -70, z: 8 });
    advance(sim, 0.5);
    expect(sim.drops).toHaveLength(1);
    sim.drops[0].position.y = -129;
    advance(sim, 0.1);
    expect(sim.drops).toHaveLength(0);
  });
  it("mines and picks up deep diamond at -50 with tool wear and no legacy-height rejection", () => {
    const { sim, world } = fixture(-51);
    world.setBlock(0, -50, 0, 98);
    sim.player.inventory[0] = { id: "iron_pickaxe", count: 1, durability: 250 };
    aim(sim, { x: 0.5, y: -49.5, z: 0.5 });
    expect(sim.target()?.id).toBe(98);
    expect(sim.mine(1)).toBe(false);
    expect(sim.mine(0.126)).toBe(true);
    sim.player.position = { x: 0.5, y: -50, z: 0.5 };
    advance(sim, 1);
    expect(countItem(sim.player.inventory, "diamond")).toBe(1);
    expect(sim.player.inventory[0]?.durability).toBe(249);
  });
  it("does not break either half of a door across an unloaded vertical boundary", () => {
    const { sim, world } = fixture();
    world.setBlock(0, 15, 0, 18);
    world.setBlock(0, 16, 0, 25);
    world.ready = (y) => y < 16;
    const before = world.getChanges();
    sim.breakBlock({ x: 0, y: 15, z: 0 });
    expect(world.getChanges()).toEqual(before);
    expect(sim.drops).toHaveLength(0);
    world.ready = () => true;
    sim.breakBlock({ x: 0, y: 15, z: 0 });
    expect(world.getBlock(0, 15, 0)).toBe(0);
    expect(world.getBlock(0, 16, 0)).toBe(0);
    expect(sim.drops.filter((d) => d.stack.id === "door")).toHaveLength(1);
  });
  it.each(["bottom", "top"] as const)(
    "does not toggle only the loaded %s half of a door",
    (half) => {
      const { sim, world } = fixture(125);
      world.setBlock(0, 127, 0, 18);
      world.setBlock(0, 128, 0, 25);
      sim.player.position.y = half === "bottom" ? 126 : 128;
      aim(sim, { x: 0.5, y: half === "bottom" ? 127.5 : 128.5, z: 0.1 });
      world.ready = (y) => (half === "bottom" ? y < 128 : y >= 128);
      expect(sim.target()?.id).toBe(half === "bottom" ? 18 : 25);
      const before = structuredClone(world.getChanges());
      sim.interact();
      expect(world.getChanges()).toEqual(before);
      expect(sim.drops).toHaveLength(0);
      world.ready = () => true;
      sim.interact();
      expect(world.getBlock(0, 127, 0)).toBe(19);
      expect(world.getBlock(0, 128, 0)).toBe(26);
    },
  );
  it("restores the lower door half if its upper write is refused", () => {
    const { sim, world } = fixture(125);
    world.setBlock(0, 127, 0, 18);
    world.setBlock(0, 128, 0, 25);
    sim.player.position.y = 126;
    aim(sim, { x: 0.5, y: 127.5, z: 0.1 });
    const before = structuredClone(world.getChanges());
    const write = world.setBlock.bind(world);
    world.setBlock = (x, y, z, id) => {
      if (y === 128 && id === 26) return;
      write(x, y, z, id);
    };
    sim.interact();
    expect(world.getChanges()).toEqual(before);
    expect(sim.drops).toHaveLength(0);
  });
  it("keeps a falling drop in its loaded section until the lower section becomes ready", () => {
    const { sim, world } = fixture(125);
    sim.player.position = { x: 10, y: 130, z: 10 };
    sim.drops = [
      {
        id: "edge-diamond",
        stack: { id: "diamond", count: 1 },
        position: { x: 0, y: 128.01, z: 0 },
        age: 1,
      },
    ];
    world.ready = (y) => y >= 128;
    advance(sim, 1);
    expect(sim.drops).toHaveLength(1);
    expect(sim.drops[0].position.y).toBe(128.01);
    world.ready = () => true;
    advance(sim, 0.1);
    expect(sim.drops[0].position.y).toBeLessThan(128);
    expect(sim.drops[0].stack).toEqual({ id: "diamond", count: 1 });
  });
  it("does not regrow sheep wool from grass in an unloaded lower section", () => {
    const { sim, world } = fixture(125);
    world.setBlock(0, 127, 0, 1);
    sim.player.position = { x: 10, y: 130, z: 10 };
    const sheep = {
      id: "edge-sheep",
      kind: "sheep" as const,
      position: { x: 0.5, y: 128, z: 0.5 },
      health: 8,
      yaw: 0,
      timer: 1.8,
      age: 0,
      sheared: true,
      woolTimer: 29.99,
    };
    sim.entities = [sheep];
    world.ready = (y) => y >= 128;
    advance(sim, 0.05);
    expect(sheep.sheared).toBe(true);
    expect(sheep.woolTimer).toBe(29.99);
    expect(world.getBlock(0, 127, 0)).toBe(1);
    world.ready = () => true;
    advance(sim, 0.05);
    expect(sheep.sheared).toBe(false);
    expect(sheep.woolTimer).toBe(0);
    expect(world.getBlock(0, 127, 0)).toBe(2);
  });
  it("keeps sheep sheared and its checkpoint valid when consuming grass is refused", () => {
    const { sim, world } = fixture(127);
    world.setBlock(0, 127, 0, 1);
    const sheep = {
      id: "retry-sheep",
      kind: "sheep" as const,
      position: { x: 0.5, y: 128, z: 0.5 },
      health: 8,
      yaw: 0,
      timer: 1.8,
      age: 0,
      sheared: true,
      woolTimer: 29.99,
    };
    sim.entities = [sheep];
    const write = world.setBlock.bind(world);
    world.setBlock = (x, y, z, id) => {
      if (x === 0 && y === 127 && z === 0 && id === 2) return;
      write(x, y, z, id);
    };
    advance(sim, 0.1);
    expect(sheep.sheared).toBe(true);
    expect(sheep.woolTimer).toBe(30);
    expect(world.getBlock(0, 127, 0)).toBe(1);
    expect(() => validateSave(sim.snapshot())).not.toThrow();
    world.setBlock = write;
    advance(sim, 0.05);
    expect(sheep.sheared).toBe(false);
    expect(sheep.woolTimer).toBe(0);
    expect(world.getBlock(0, 127, 0)).toBe(2);
  });
  it.each(["unloaded", "refused"] as const)(
    "does not consume bone meal when the upper grass writes are %s",
    (failure) => {
      const { sim, world } = fixture(125);
      for (let x = -3; x <= 3; x++)
        for (let z = -3; z <= 3; z++) world.setBlock(x, 127, z, 1);
      sim.player.position = { x: 0.5, y: 126, z: 5.5 };
      sim.player.inventory[0] = { id: "bone_meal", count: 2 };
      aim(sim, { x: 0.5, y: 127.5, z: 2.5 });
      expect(sim.target()?.id).toBe(1);
      const before = structuredClone(world.getChanges());
      const write = world.setBlock.bind(world);
      if (failure === "unloaded") world.ready = (y) => y < 128;
      else
        world.setBlock = (x, y, z, id) => {
          if (y === 128 && id === 58) return;
          write(x, y, z, id);
        };
      sim.interact();
      expect(sim.player.inventory[0]).toEqual({ id: "bone_meal", count: 2 });
      expect(world.getChanges()).toEqual(before);
      world.ready = () => true;
      world.setBlock = write;
      sim.interact();
      expect(sim.player.inventory[0]).toEqual({ id: "bone_meal", count: 1 });
      expect(
        world.getChanges().some((block) => block.y === 128 && block.id === 58),
      ).toBe(true);
    },
  );
  it("leaves a high furnace untouched until its own section loads", () => {
    const { sim, world } = fixture();
    world.setBlock(0, 300, 0, 14);
    sim.containers["0,300,0"] = {
      kind: "furnace",
      slots: [{ id: "raw_iron", count: 1 }, { id: "coal", count: 1 }, null],
      burn: 0,
      burnTotal: 0,
      progress: 0,
    };
    world.ready = (y) => y < 16;
    const before = structuredClone(sim.containers);
    advance(sim, 12);
    expect(sim.containers).toEqual(before);
    world.ready = () => true;
    advance(sim, 10.1);
    expect(sim.containers["0,300,0"].slots[2]).toEqual({
      id: "iron_ingot",
      count: 1,
    });
  });
  it("freezes a player in a vertical section that is not ready", () => {
    const { sim, world } = fixture();
    sim.player.position.y = 300;
    world.ready = (y) => y < 16;
    const before = sim.snapshot();
    advance(sim, 1);
    expect(sim.player).toEqual(before.player);
    expect(sim.time).toBe(before.time);
    expect(sim.manifest.playedSeconds).toBe(before.manifest.playedSeconds);
  });
  it("respawns at a valid bed above the old height ceiling", () => {
    const { sim, world } = fixture(200);
    world.setBlock(0, 201, 0, 22);
    world.setBlock(0, 201, 1, 27);
    sim.player.bedSpawn = { x: 0, y: 201, z: 0 };
    sim.damage(100, "void");
    expect(sim.player.dead).toBe(true);
    sim.respawn();
    expect(sim.player.position.y).toBeGreaterThanOrEqual(201);
    expect(sim.player.position.y).toBeLessThan(203);
    expect(sim.player.dead).toBe(false);
  });
  it("chooses a real high bed after a deep death before its section is resident", () => {
    const { sim, world } = fixture(63);
    for (let x = -1; x <= 1; x++)
      for (let z = -1; z <= 2; z++) world.setBlock(x, 299, z, 3);
    world.setBlock(0, 300, 0, 22);
    world.setBlock(0, 300, 1, 27);
    sim.player.bedSpawn = { x: 0, y: 300, z: 0 };
    sim.player.position = { x: 10, y: -50, z: 10 };
    world.ready = (y) => y >= -64 && y < -32;
    sim.damage(100, "void");
    sim.respawn();
    expect(sim.player.bedSpawn).toEqual({ x: 0, y: 300, z: 0 });
    expect(sim.player.position.y).toBeGreaterThanOrEqual(300);
    expect(sim.player.position.y).toBeLessThan(302);
    expect(sim.player.dead).toBe(false);
    const before = structuredClone(sim.player),
      time = sim.time;
    advance(sim, 0.2);
    expect(sim.player).toEqual(before);
    expect(sim.time).toBe(time);
  });
  it.each([false, true])(
    "uses the original unloaded spawn after deep death (broken bed: %s)",
    (brokenBed) => {
      const { sim, world } = fixture(63);
      const expected = { ...sim.player.spawn };
      if (brokenBed) sim.player.bedSpawn = { x: 0, y: 300, z: 0 };
      sim.player.position = { x: 10, y: -50, z: 10 };
      world.ready = (y) => y >= -64 && y < -32;
      sim.damage(100, "void");
      sim.respawn();
      expect(sim.player.position).toEqual(expected);
      expect(sim.player.position.y).not.toBe(319);
      expect(sim.player.bedSpawn).toBeUndefined();
      const before = structuredClone(sim.player);
      advance(sim, 0.2);
      expect(sim.player).toEqual(before);
    },
  );
});

describe("height-aware save format", () => {
  function v4(): SaveData {
    const { sim } = fixture();
    const save = sim.snapshot();
    save.manifest.version = 4;
    save.manifest.generatorVersion = 4;
    delete save.progression;
    delete save.sugarCane;
    save.player.inventory[0] = {
      id: "diamond_pickaxe",
      count: 1,
      durability: 1240,
    };
    save.changes = [{ x: 1, y: 90, z: 2, id: 104 }];
    return save;
  }
  it("upgrades v4 with an immutable backup while preserving generator4 and inventory", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const old = v4();
    await saveWorld(old);
    const next = new Simulation(
      new HeightWorld(0, old.changes),
      old,
    ).snapshot();
    expect(next.manifest.version).toBe(7);
    expect(next.manifest.generatorVersion).toBe(4);
    expect(next.player).toEqual(old.player);
    await saveWorld(next);
    expect(await loadMigrationBackup(old.manifest.id, 4)).toEqual(old);
    expect(await loadWorld(old.manifest.id)).toEqual(validateSave(next));
  });
  it.each([-65, 320])("rejects v5 block changes beyond y=%i", (y) => {
    const save = fixture().sim.snapshot();
    save.manifest.version = 5;
    save.manifest.generatorVersion = 5;
    delete save.progression;
    delete save.sugarCane;
    expect(() => validateSave(save)).not.toThrow();
    save.changes = [{ x: 0, y, z: 0, id: 11 }];
    expect(() => validateSave(save)).toThrow("世界高度");
  });
  it.each([-64, 96, 319])(
    "keeps version4's own historical block-height validation at y=%i",
    (y) => {
      const save = v4();
      save.changes = [{ x: 0, y, z: 0, id: 11 }];
      expect(() => validateSave(save)).toThrow("世界高度");
      save.manifest.version = 5;
      expect(() => validateSave(save)).not.toThrow();
    },
  );
  it("round trips deep and high chests/furnaces with equipment and fluid/natural state", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const { world, sim } = fixture();
    world.setBlock(-17, -50, -1, 15);
    world.setBlock(16, 300, 16, 14);
    sim.containers["-17,-50,-1"] = {
      kind: "chest",
      slots: Array.from({ length: 27 }, (_, i) =>
        i === 0 ? { id: "diamond_pickaxe", count: 1, durability: 911 } : null,
      ),
    };
    sim.containers["16,300,16"] = {
      kind: "furnace",
      slots: [
        { id: "raw_gold", count: 3 },
        { id: "coal", count: 2 },
        { id: "gold_ingot", count: 1 },
      ],
      burn: 40,
      burnTotal: 80,
      progress: 4.5,
    };
    const before = validateSave(sim.snapshot());
    await saveWorld(before);
    const after = (await loadWorld(before.manifest.id))!;
    expect(after).toEqual(before);
    const copy = new Simulation(new HeightWorld(0, after.changes), after);
    expect(copy.containers).toEqual(sim.containers);
    expect(validateSave(copy.snapshot()).changes).toEqual(before.changes);
  });
  it("accepts deep/high queues only under v5, without weakening the old validator", () => {
    const { sim } = fixture();
    sim.setBlock(0, 300, 0, 6);
    sim.setBlock(0, -50, 0, 4);
    const save = sim.snapshot();
    save.manifest.version = 5;
    save.manifest.generatorVersion = 5;
    delete save.progression;
    delete save.sugarCane;
    expect(save.fluids!.tasks.some((t) => t.y > 95)).toBe(true);
    expect(save.natural!.queue.some((t) => t.y < -16)).toBe(true);
    expect(() => validateSave(save)).not.toThrow();
    save.manifest.version = 4;
    save.manifest.generatorVersion = 4;
    expect(() => validateSave(save)).toThrow("世界高度");
  });
});
