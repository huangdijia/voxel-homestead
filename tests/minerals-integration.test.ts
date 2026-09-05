import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNewSave, Simulation } from "../src/game/Simulation";
import { countItem } from "../src/game/inventory";
import {
  canHarvest,
  damageAfterArmor,
  miningDuration,
} from "../src/game/equipment";
import { BLOCKS, ITEMS } from "../src/game/registry";
import {
  loadMigrationBackup,
  loadWorld,
  saveWorld,
  validateSave,
} from "../src/game/storage";
import type {
  ArmorSlot,
  BlockChange,
  SaveData,
  Vec3,
  WorldPort,
} from "../src/game/types";

class MineralWorld implements WorldPort {
  blocks = new Map<string, BlockChange>();
  constructor(changes: BlockChange[] = []) {
    changes.forEach((c) => this.setBlock(c.x, c.y, c.z, c.id));
  }
  getBlock(x: number, y: number, z: number) {
    return (
      this.blocks.get(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`)
        ?.id ?? (y <= 0 ? 3 : 0)
    );
  }
  setBlock(x: number, y: number, z: number, id: number) {
    this.blocks.set(`${x},${y},${z}`, { x, y, z, id });
  }
  isReady() {
    return true;
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
  const world = new MineralWorld(),
    save = createNewSave("矿物规则验收", "minerals-test", "survival");
  save.player.position = { x: 0.5, y: 1, z: 3.5 };
  save.player.spawn = { ...save.player.position };
  save.player.hunger = 10;
  return { world, sim: new Simulation(world, save) };
}
function aim(sim: Simulation, point: Vec3) {
  const e = sim.eye(),
    dx = point.x - e.x,
    dy = point.y - e.y,
    dz = point.z - e.z;
  sim.player.yaw = Math.atan2(-dx, -dz);
  sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
function step(sim: Simulation, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.step(1 / 60, idle);
}
function total(sim: Simulation, id: string) {
  return (
    countItem(sim.player.inventory, id) +
    sim.drops.reduce((n, d) => n + (d.stack.id === id ? d.stack.count : 0), 0)
  );
}
function tool(sim: Simulation, id: string) {
  sim.player.selected = 0;
  sim.player.inventory[0] = {
    id,
    count: 1,
    durability: ITEMS[id].maxDurability,
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("mineral harvest and progression", () => {
  it.each(["wood_pickaxe", "stone_pickaxe", "gold_pickaxe"])(
    "%s breaks diamond ore without obtaining diamonds",
    (id) => {
      const { world, sim } = fixture();
      tool(sim, id);
      world.setBlock(0, 1, 0, 88);
      aim(sim, { x: 0.5, y: 1.5, z: 0.5 });
      expect(sim.target()?.id).toBe(88);
      expect(canHarvest(BLOCKS[88], ITEMS[id])).toBe(false);
      expect(sim.mine(miningDuration(BLOCKS[88], ITEMS[id]) + 0.001)).toBe(
        true,
      );
      expect(world.getBlock(0, 1, 0)).toBe(0);
      expect(total(sim, "diamond")).toBe(0);
      expect(sim.held?.durability).toBe(ITEMS[id].maxDurability! - 1);
    },
  );
  it.each([88, 98])(
    "iron harvests diamond from block %i once and reloads the picked-up item",
    (id) => {
      const { world, sim } = fixture();
      tool(sim, "iron_pickaxe");
      world.setBlock(0, 1, 0, id);
      aim(sim, { x: 0.5, y: 1.5, z: 0.5 });
      expect(
        sim.mine(miningDuration(BLOCKS[id], ITEMS.iron_pickaxe) - 0.05),
      ).toBe(false);
      expect(total(sim, "diamond")).toBe(0);
      expect(sim.mine(0.051)).toBe(true);
      expect(total(sim, "diamond")).toBe(1);
      sim.breakBlock({ x: 0, y: 1, z: 0 }, id);
      expect(total(sim, "diamond")).toBe(1);
      sim.player.position = { x: 0.5, y: 1, z: 0.5 };
      step(sim, 1);
      expect(countItem(sim.player.inventory, "diamond")).toBe(1);
      const saved = validateSave(sim.snapshot()),
        copy = new Simulation(new MineralWorld(saved.changes), saved);
      expect(total(copy, "diamond")).toBe(1);
      expect(copy.held?.durability).toBe(249);
    },
  );
  it("gold is fast on stone but has no diamond harvest eligibility", () => {
    expect(miningDuration(BLOCKS[3], ITEMS.gold_pickaxe)).toBeLessThan(
      miningDuration(BLOCKS[3], ITEMS.diamond_pickaxe),
    );
    expect(canHarvest(BLOCKS[88], ITEMS.gold_pickaxe)).toBe(false);
    expect(canHarvest(BLOCKS[88], ITEMS.iron_pickaxe)).toBe(true);
    expect(miningDuration(BLOCKS[24], ITEMS.diamond_pickaxe)).toBe(Infinity);
  });
  it.each(["iron_pickaxe", "diamond_pickaxe"])(
    "%s enforces the obsidian gate through mining progress",
    (id) => {
      const { world, sim } = fixture();
      tool(sim, id);
      world.setBlock(0, 1, 0, 81);
      aim(sim, { x: 0.5, y: 1.5, z: 0.5 });
      expect(sim.mine(1)).toBe(false);
      expect(world.getBlock(0, 1, 0)).toBe(81);
      expect(sim.mine(miningDuration(BLOCKS[81], ITEMS[id]))).toBe(true);
      expect(total(sim, "obsidian")).toBe(id === "diamond_pickaxe" ? 1 : 0);
    },
  );
  it.each([
    [84, "raw_copper", 2, 5],
    [94, "raw_copper", 2, 5],
    [86, "redstone", 4, 5],
    [96, "redstone", 4, 5],
    [87, "lapis_lazuli", 4, 9],
    [97, "lapis_lazuli", 4, 9],
  ] as const)(
    "block %i has bounded, repeatable material drops",
    (id, drop, min, max) => {
      const { world, sim } = fixture();
      tool(sim, "iron_pickaxe");
      const checkpoint = sim.snapshot();
      const results: number[] = [];
      for (let i = 0; i < 24; i++) {
        world.setBlock(i, 1, 0, id);
        const before = total(sim, drop);
        sim.breakBlock({ x: i, y: 1, z: 0 });
        results.push(total(sim, drop) - before);
      }
      expect(
        results.every((n) => n >= min && n <= max && Number.isInteger(n)),
      ).toBe(true);
      expect(new Set(results).size).toBeGreaterThan(1);
      const resumedWorld = new MineralWorld(),
        resumed = new Simulation(resumedWorld, checkpoint),
        repeated: number[] = [];
      for (let i = 0; i < 24; i++) {
        resumedWorld.setBlock(i, 1, 0, id);
        const before = total(resumed, drop);
        resumed.breakBlock({ x: i, y: 1, z: 0 });
        repeated.push(total(resumed, drop) - before);
      }
      expect(repeated).toEqual(results);
    },
  );
  it("uses three mined diamonds and two sticks to craft a durable pickaxe only at a workbench", () => {
    const { world, sim } = fixture();
    tool(sim, "iron_pickaxe");
    for (let x = 0; x < 3; x++) {
      world.setBlock(x, 1, 0, 88);
      sim.breakBlock({ x, y: 1, z: 0 });
    }
    sim.player.position = { x: 1.5, y: 1, z: 0.5 };
    step(sim, 1);
    sim.player.inventory[5] = { id: "stick", count: 2 };
    expect(countItem(sim.player.inventory, "diamond")).toBe(3);
    sim.craft("diamond_pickaxe");
    expect(countItem(sim.player.inventory, "diamond")).toBe(3);
    sim.station = "workbench";
    sim.craft("diamond_pickaxe");
    expect(countItem(sim.player.inventory, "diamond")).toBe(0);
    expect(countItem(sim.player.inventory, "stick")).toBe(0);
    expect(
      sim.player.inventory.find((s) => s?.id === "diamond_pickaxe"),
    ).toEqual({ id: "diamond_pickaxe", count: 1, durability: 1561 });
  });
});

describe("diamond toughness and equipment conservation", () => {
  function armor(sim: Simulation, material: "gold" | "diamond") {
    for (const [slot, suffix] of [
      ["head", "helmet"],
      ["chest", "chestplate"],
      ["legs", "leggings"],
      ["feet", "boots"],
    ] as [ArmorSlot, string][]) {
      const id = `${material}_${suffix}`;
      sim.player.inventory[0] = { id, count: 1, durability: 20 };
      sim.clickSlot("inventory", 0, false, true);
      expect(sim.player.armor[slot]?.id).toBe(id);
    }
  }
  it("diamond toughness reduces a heavy hit while wear follows incoming damage", () => {
    const { sim } = fixture();
    armor(sim, "diamond");
    sim.damage(20, "attack");
    expect(sim.player.health).toBeCloseTo(12);
    expect(damageAfterArmor(20, 20, 0)).toBe(12);
    expect(Object.values(sim.player.armor).map((s) => s?.durability)).toEqual([
      15, 15, 15, 15,
    ]);
    sim.damage(20, "attack");
    expect(sim.player.health).toBeCloseTo(12);
  });
  it.each(["fall", "drown"])(
    "diamond armor does not protect or wear against %s",
    (reason) => {
      const { sim } = fixture();
      armor(sim, "diamond");
      sim.damage(10, reason);
      expect(sim.player.health).toBe(10);
      expect(
        Object.values(sim.player.armor).every((s) => s?.durability === 20),
      ).toBe(true);
    },
  );
  it("gold armor has its own lower protection", () => {
    const { sim } = fixture();
    armor(sim, "gold");
    sim.damage(10);
    expect(sim.player.health).toBeCloseTo(12.4);
  });
  it("death, checkpoint, respawn and pickup preserve each diamond armor item and tool once", () => {
    const { sim } = fixture();
    armor(sim, "diamond");
    tool(sim, "diamond_pickaxe");
    sim.held!.durability = 41;
    sim.damage(100, "void");
    expect(sim.player.dead).toBe(true);
    expect(sim.drops).toHaveLength(5);
    expect(Object.values(sim.player.armor).every((s) => s === null)).toBe(true);
    const saved = validateSave(sim.snapshot()),
      resumed = new Simulation(new MineralWorld(saved.changes), saved);
    resumed.respawn();
    step(resumed, 1);
    expect(resumed.player.dead).toBe(false);
    expect(resumed.drops).toHaveLength(0);
    for (const suffix of ["helmet", "chestplate", "leggings", "boots"]) {
      expect(total(resumed, `diamond_${suffix}`)).toBe(1);
      expect(
        resumed.player.inventory.find((s) => s?.id === `diamond_${suffix}`)
          ?.durability,
      ).toBe(20);
    }
    expect(total(resumed, "diamond_pickaxe")).toBe(1);
    expect(
      resumed.player.inventory.find((s) => s?.id === "diamond_pickaxe")
        ?.durability,
    ).toBe(41);
  });
});

describe("version four checkpoints", () => {
  it("preserves the version-three backup and generator during upgrade", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const { sim } = fixture(),
      old = sim.snapshot();
    old.manifest.version = 3;
    old.manifest.generatorVersion = 3;
    delete old.progression;
    delete old.sugarCane;
    old.player.inventory[0] = { id: "iron_pickaxe", count: 1, durability: 125 };
    await saveWorld(old);
    const upgraded = new Simulation(
      new MineralWorld(old.changes),
      old,
    ).snapshot();
    expect(upgraded.manifest.version).toBe(7);
    expect(upgraded.manifest.generatorVersion).toBe(3);
    await saveWorld(upgraded);
    expect(await loadMigrationBackup(old.manifest.id, 3)).toEqual(old);
    expect((await loadWorld(old.manifest.id))?.player.inventory).toEqual(
      old.player.inventory,
    );
  });
  it.each(["inventory", "armor", "chest", "furnace", "drop", "block"])(
    "rejects version-four %s data disguised as a version-three save",
    (kind) => {
      const { sim } = fixture(),
        save = sim.snapshot();
      save.manifest.version = 3;
      save.manifest.generatorVersion = 3;
      delete save.progression;
      delete save.sugarCane;
      expect(() => validateSave(save)).not.toThrow();
      if (kind === "inventory")
        save.player.inventory[0] = { id: "diamond", count: 1 };
      if (kind === "armor")
        save.player.armor.head = {
          id: "gold_helmet",
          count: 1,
          durability: 77,
        };
      if (kind === "chest") {
        save.changes.push({ x: 1, y: 1, z: 0, id: 15 });
        save.containers["1,1,0"] = {
          kind: "chest",
          slots: Array.from({ length: 27 }, (_, i) =>
            i === 0 ? { id: "emerald", count: 1 } : null,
          ),
        };
      }
      if (kind === "furnace") {
        save.changes.push({ x: 1, y: 1, z: 0, id: 14 });
        save.containers["1,1,0"] = {
          kind: "furnace",
          slots: [{ id: "raw_gold", count: 1 }, null, null],
          burn: 0,
          burnTotal: 0,
          progress: 0,
        };
      }
      if (kind === "drop")
        save.drops.push({
          id: "diamond-drop",
          stack: { id: "diamond", count: 1 },
          position: { x: 0, y: 1, z: 0 },
          age: 0,
        });
      if (kind === "block") save.changes.push({ x: 0, y: 1, z: 0, id: 88 });
      expect(() => validateSave(save)).toThrow(
        kind === "block" ? "changes.id" : "物品超出存档版本",
      );
      save.manifest.version = 4;
      expect(() => validateSave(save)).not.toThrow();
    },
  );
  it.each([
    ["raw_copper", "copper_ingot"],
    ["raw_gold", "gold_ingot"],
  ])(
    "resumes smelting %s without consuming extra fuel or duplicating the output",
    async (input, output) => {
      vi.stubGlobal("indexedDB", new IDBFactory());
      const { sim } = fixture();
      sim.setBlock(3, 1, 0, 14);
      sim.containers["3,1,0"] = {
        kind: "furnace",
        slots: [{ id: input, count: 2 }, { id: "coal", count: 1 }, null],
        burn: 0,
        burnTotal: 0,
        progress: 0,
      };
      step(sim, 4);
      const checkpoint = sim.snapshot();
      await saveWorld(checkpoint);
      const saved = (await loadWorld(checkpoint.manifest.id))!;
      expect(saved).toEqual(validateSave(checkpoint));
      const resumed = new Simulation(new MineralWorld(saved.changes), saved);
      step(sim, 17);
      step(resumed, 17);
      expect(resumed.containers).toEqual(sim.containers);
      expect(resumed.containers["3,1,0"].slots).toEqual([
        null,
        null,
        { id: output, count: 2 },
      ]);
      expect(validateSave(resumed.snapshot()).manifest.version).toBe(7);
    },
  );
});
