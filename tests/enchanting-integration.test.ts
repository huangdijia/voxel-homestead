import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNewSave, Simulation } from "../src/game/Simulation";
import { addItem, clickInventorySlot, countItem } from "../src/game/inventory";
import {
  MAX_EXPERIENCE,
  experienceForLevel,
  experienceStatus,
  spendLevels,
} from "../src/game/experience";
import { BOOKSHELF_OFFSETS } from "../src/game/enchanting";
import { BLOCKS, ITEMS } from "../src/game/registry";
import { miningDuration } from "../src/game/equipment";
import {
  validateSave,
  saveWorld,
  loadWorld,
  loadMigrationBackup,
  importWorld,
} from "../src/game/storage";
import type {
  BlockChange,
  ItemStack,
  SaveData,
  Slot,
  Vec3,
  WorldPort,
} from "../src/game/types";

class TestWorld implements WorldPort {
  blocks = new Map<string, BlockChange>();
  unloaded = new Set<string>();
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
  isReady(x: number, z: number, y = 1) {
    return !this.unloaded.has(
      `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`,
    );
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
  const world = new TestWorld(),
    save = createNewSave("附魔存档测试", "M2-enchanting", "survival");
  save.player.position = { x: 0.5, y: 1, z: 3.5 };
  save.player.spawn = { ...save.player.position };
  save.player.hunger = 10;
  return { world, sim: new Simulation(world, save) };
}
function step(sim: Simulation, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.step(1 / 60, idle);
}
function aim(sim: Simulation, point: Vec3) {
  const e = sim.eye(),
    dx = point.x - e.x,
    dy = point.y - e.y,
    dz = point.z - e.z;
  sim.player.yaw = Math.atan2(-dx, -dz);
  sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
function tool(
  id = "diamond_pickaxe",
  enchantments?: Record<string, number>,
): ItemStack {
  return {
    id,
    count: 1,
    durability: ITEMS[id].maxDurability,
    ...(enchantments ? { enchantments } : {}),
  };
}
function totalXP(sim: Simulation) {
  return (
    sim.progression.points +
    sim.progression.orbs.reduce((n, o) => n + o.value, 0)
  );
}
function openTable(sim: Simulation, world: TestWorld, shelves = 15) {
  world.setBlock(0, 1, 0, 112);
  BOOKSHELF_OFFSETS.slice(0, shelves).forEach((p) =>
    world.setBlock(p.x, p.y + 1, p.z, 113),
  );
  aim(sim, { x: 0.5, y: 1.4, z: 0.5 });
  sim.interact();
  expect(sim.station).toBe("enchanting");
}
function loadedCopy(sim: Simulation) {
  const data = validateSave(JSON.parse(JSON.stringify(sim.snapshot())));
  return new Simulation(new TestWorld(data.changes), data);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("experience survives real rule transitions", () => {
  it("starts v7 empty and keeps experience out of item inventory", () => {
    const save = createNewSave("空世界", "xp", "survival");
    expect(save.manifest).toMatchObject({ version: 7, generatorVersion: 6 });
    expect(validateSave(save)).toEqual(save);
    expect(save.player.inventory.every((s) => s === null)).toBe(true);
    expect(save.progression?.points).toBe(0);
  });
  it("valid mineral harvesting emits XP once, wrong tools, silk and explosions do not", () => {
    const { world, sim } = fixture();
    vi.spyOn(sim.farming, "nextRandom").mockReturnValue(0.5);
    sim.player.inventory[0] = tool("iron_pickaxe");
    world.setBlock(0, 1, 0, 88);
    sim.breakBlock({ x: 0, y: 1, z: 0 });
    expect(totalXP(sim)).toBe(5);
    sim.breakBlock({ x: 0, y: 1, z: 0 }, 88);
    expect(totalXP(sim)).toBe(5);
    sim.player.inventory[0] = tool("wood_pickaxe");
    world.setBlock(1, 1, 0, 88);
    sim.breakBlock({ x: 1, y: 1, z: 0 });
    expect(totalXP(sim)).toBe(5);
    sim.player.inventory[0] = tool("diamond_pickaxe", { silk_touch: 1 });
    world.setBlock(2, 1, 0, 88);
    sim.breakBlock({ x: 2, y: 1, z: 0 });
    expect(totalXP(sim)).toBe(5);
    expect(sim.drops.some((d) => d.stack.id === "diamond_ore")).toBe(true);
    world.setBlock(3, 1, 0, 88);
    sim.breakBlock({ x: 3, y: 1, z: 0 }, 88, true);
    expect(totalXP(sim)).toBe(5);
  });
  it("collects an orb only once across checkpoint reload and keeps unloaded orbs frozen", () => {
    const { sim, world } = fixture();
    sim.spawnExperience(13, sim.player.position);
    const orb = sim.progression.orbs[0];
    world.unloaded.add(
      `${Math.floor(orb.position.x)},${Math.floor(orb.position.y)},${Math.floor(orb.position.z)}`,
    );
    step(sim, 1);
    expect(sim.progression.points).toBe(0);
    expect(orb.age).toBe(-0.5);
    world.unloaded.clear();
    step(sim, 1);
    expect(sim.progression.points).toBe(13);
    expect(sim.progression.orbs).toEqual([]);
    const copy = loadedCopy(sim);
    step(copy, 1);
    expect(copy.progression.points).toBe(13);
  });
  it("death drops capped XP and enchanted equipment, respawn can recover each once", () => {
    const { sim } = fixture();
    sim.progression.points = experienceForLevel(30) + 10;
    sim.player.inventory[0] = tool("diamond_pickaxe", { efficiency: 3 });
    sim.player.armor.feet = tool("diamond_boots", { feather_falling: 4 });
    sim.damage(1000, "void");
    expect(sim.player.dead).toBe(true);
    expect(totalXP(sim)).toBe(100);
    expect(sim.drops.map((d) => d.stack.enchantments)).toEqual([
      { efficiency: 3 },
      { feather_falling: 4 },
    ]);
    const copy = loadedCopy(sim);
    copy.respawn();
    step(copy, 1);
    expect(copy.progression.points).toBe(100);
    expect(countItem(copy.player.inventory, "diamond_pickaxe")).toBe(1);
    expect(countItem(copy.player.inventory, "diamond_boots")).toBe(1);
    step(copy, 1);
    expect(totalXP(copy)).toBe(100);
  });
  it.each(["pig", "sheep", "cow", "zombie"] as const)(
    "player killing %s yields XP, baby passive kills do not",
    (kind) => {
      const { sim } = fixture();
      sim.entities = [
        {
          id: "victim",
          kind,
          position: { x: 0.5, y: 1, z: 1.5 },
          health: 1,
          yaw: 0,
          timer: 5,
        },
      ];
      sim.player.inventory[0] = tool("diamond_sword");
      aim(sim, { x: 0.5, y: 1 + (kind === "zombie" ? 0.9 : 0.55), z: 1.5 });
      expect(sim.attack()).toBe(true);
      expect(totalXP(sim)).toBeGreaterThan(0);
      if (kind === "cow")
        expect(
          sim.drops
            .filter((d) => d.stack.id === "raw_beef")
            .reduce((n, d) => n + d.stack.count, 0),
        ).toBeGreaterThanOrEqual(1);
      if (kind !== "zombie") {
        const second = fixture().sim;
        second.entities = [
          {
            id: "baby",
            kind,
            position: { x: 0.5, y: 1, z: 1.5 },
            health: 1,
            yaw: 0,
            timer: 5,
            age: -100,
          },
        ];
        second.player.inventory[0] = tool("diamond_sword");
        aim(second, { x: 0.5, y: 1.55, z: 1.5 });
        expect(second.attack()).toBe(true);
        expect(totalXP(second)).toBe(0);
        expect(second.drops).toEqual([]);
      }
    },
  );
  it("credits a recent player hit followed by environmental death but not unrelated sun death", () => {
    const { sim } = fixture();
    sim.entities = [
      {
        id: "hit",
        kind: "zombie",
        position: { x: 0.5, y: 1, z: 1.5 },
        health: 0.001,
        yaw: 0,
        timer: 5,
        playerHitTimer: 5,
      },
      {
        id: "sun",
        kind: "zombie",
        position: { x: 4, y: 1, z: 0 },
        health: 0.001,
        yaw: 0,
        timer: 5,
      },
    ];
    step(sim, 0.1);
    expect(totalXP(sim)).toBe(5);
    expect(sim.entities).toEqual([]);
  });
});

describe("cane integrates with existing fluid displacement", () => {
  it("water flowing into valid cane removes it and returns each segment once", () => {
    const { sim, world } = fixture();
    world.setBlock(0, 0, 0, 1);
    world.setBlock(1, 0, 0, 6);
    sim.setBlock(0, 1, 0, 111);
    sim.setBlock(0, 2, 0, 111);
    sim.setBlock(0, 4, 0, 6);
    step(sim, 3);
    expect(world.getBlock(0, 1, 0)).not.toBe(111);
    expect(world.getBlock(0, 2, 0)).not.toBe(111);
    expect(
      countItem(sim.player.inventory, "sugar_cane") +
        sim.drops.reduce(
          (n, d) => n + (d.stack.id === "sugar_cane" ? d.stack.count : 0),
          0,
        ),
    ).toBe(2);
    expect(() => validateSave(sim.snapshot())).not.toThrow();
  });
});

describe("creative enchanting and finite XP limits", () => {
  it("creative enchants without XP or lapis and only advances the offer seed", () => {
    const { sim, world } = fixture();
    sim.manifest.mode = "creative";
    openTable(sim, world);
    sim.craftSlots = [tool(), null];
    const seed = sim.progression.enchantmentSeed;
    expect(sim.getEnchanting()!.offers[2]).toMatchObject({
      available: true,
      levelCost: 0,
      lapisCost: 0,
    });
    sim.enchant(2);
    expect(sim.craftSlots[0]?.enchantments).toBeTruthy();
    expect(sim.craftSlots[1]).toBeNull();
    expect(sim.progression.points).toBe(0);
    expect(sim.progression.enchantmentSeed).not.toBe(seed);
  });
  it("saturated legal XP state remains saveable after another reward or smelt", () => {
    const { sim, world } = fixture();
    sim.progression.points = MAX_EXPERIENCE;
    sim.progression.orbs = Array.from({ length: 4096 }, (_, i) => ({
      id: `orb-${i}`,
      position: { x: 1000 + i, y: 10, z: 1000 },
      age: 0,
      value: MAX_EXPERIENCE,
    }));
    sim.spawnExperience(1, sim.player.position);
    expect(sim.progression.orbs.length).toBe(4096);
    expect(sim.lastMessage).toContain("上限");
    world.setBlock(0, 1, 0, 14);
    sim.containers["0,1,0"] = {
      kind: "furnace",
      slots: [{ id: "raw_gold", count: 1 }, null, null],
      burn: 10,
      burnTotal: 10,
      progress: 9.99,
      experience: MAX_EXPERIENCE,
    };
    sim.step(1 / 60, idle);
    expect(sim.containers["0,1,0"]).toMatchObject({
      experience: MAX_EXPERIENCE,
    });
    expect(() => validateSave(sim.snapshot())).not.toThrow();
  });
});

describe("furnace experience has a single claim", () => {
  function furnace() {
    const { sim, world } = fixture();
    world.setBlock(0, 1, 0, 14);
    sim.containers["0,1,0"] = {
      kind: "furnace",
      slots: [{ id: "raw_gold", count: 2 }, { id: "coal", count: 1 }, null],
      burn: 0,
      burnTotal: 0,
      progress: 9.99,
    };
    sim.containerKey = "0,1,0";
    step(sim, 0.05);
    return { sim, world };
  }
  it("persists fractional bank through smelting reload, and claims it on first output extraction", () => {
    const { sim } = furnace();
    const state = sim.containers["0,1,0"];
    expect(state).toMatchObject({ experience: 1 });
    expect(totalXP(sim)).toBe(0);
    const copy = loadedCopy(sim);
    copy.containerKey = "0,1,0";
    copy.clickSlot("container", 2);
    expect(copy.cursor).toEqual({ id: "gold_ingot", count: 1 });
    expect(totalXP(copy)).toBe(1);
    expect(copy.container).toMatchObject({ experience: 0 });
    copy.clickSlot("container", 2);
    expect(totalXP(copy)).toBe(1);
  });
  it.each(["shift", "right", "cursor", "break"])(
    "%s extraction cannot pay the same bank twice",
    (method) => {
      const { sim } = furnace();
      const c = sim.containers["0,1,0"];
      if (c.kind !== "furnace") throw Error();
      c.slots[2] = { id: "gold_ingot", count: 4 };
      c.experience = 4;
      if (method === "break") sim.breakBlock({ x: 0, y: 1, z: 0 });
      else {
        if (method === "cursor") sim.cursor = { id: "gold_ingot", count: 2 };
        sim.clickSlot("container", 2, method === "right", method === "shift");
      }
      expect(totalXP(sim)).toBe(4);
      sim.breakBlock({ x: 0, y: 1, z: 0 });
      expect(totalXP(sim)).toBe(4);
    },
  );
  it("full output inventory leaves both output and XP bank untouched", () => {
    const { sim } = furnace();
    sim.player.inventory = Array.from({ length: 36 }, () => ({
      id: "dirt",
      count: 64,
    }));
    sim.clickSlot("container", 2, false, true);
    expect(sim.container?.slots[2]?.count).toBe(1);
    expect(sim.container).toMatchObject({ experience: 1 });
    expect(totalXP(sim)).toBe(0);
  });
});

describe("enchanting commands and item conservation", () => {
  it("offers are stable on reopen and a successful purchase spends exactly the displayed levels and lapis", () => {
    const { sim, world } = fixture();
    openTable(sim, world);
    sim.progression.points = experienceForLevel(30) + 10;
    sim.player.inventory[0] = tool();
    sim.player.inventory[1] = { id: "lapis_lazuli", count: 6 };
    sim.clickSlot("inventory", 0, false, true);
    sim.clickSlot("inventory", 1, false, true);
    const view = sim.getEnchanting()!;
    expect(view.bookshelves).toBe(15);
    expect(view.offers[2].requiredLevel).toBe(30);
    const seed = sim.progression.enchantmentSeed;
    const points = sim.progression.points;
    sim.enchant(2);
    expect(sim.craftSlots[0]?.enchantments).toBeTruthy();
    expect(sim.craftSlots[1]?.count).toBe(3);
    expect(sim.progression.points).toBe(spendLevels(points, 3));
    expect(sim.progression.enchantmentSeed).not.toBe(seed);
    const saved = sim.snapshot();
    expect(countItem(saved.player.inventory, "diamond_pickaxe")).toBe(1);
    expect(countItem(saved.player.inventory, "lapis_lazuli")).toBe(3);
    expect(sim.craftSlots[0]?.count).toBe(1);
    sim.enchant(2);
    expect(sim.craftSlots[1]?.count).toBe(3);
    sim.closeContainer();
    expect(countItem(sim.player.inventory, "diamond_pickaxe")).toBe(1);
    expect(countItem(sim.player.inventory, "lapis_lazuli")).toBe(3);
    expect(validateSave(saved).progression).toEqual(sim.progression);
  });
  it("reopening without purchase cannot reroll the equipment clue", () => {
    const { sim, world } = fixture();
    openTable(sim, world);
    sim.progression.points = experienceForLevel(30);
    sim.craftSlots = [tool(), { id: "lapis_lazuli", count: 3 }];
    const offers = sim.getEnchanting()!.offers;
    sim.closeContainer();
    aim(sim, { x: 0.5, y: 1.4, z: 0.5 });
    sim.interact();
    sim.clickSlot("inventory", 0, false, true);
    sim.clickSlot("inventory", 1, false, true);
    expect(sim.getEnchanting()!.offers).toEqual(offers);
  });
  it.each(["no-level", "no-lapis", "broken-table", "too-far", "unloaded"])(
    "rejects %s without consuming anything",
    (reason) => {
      const { sim, world } = fixture();
      openTable(sim, world);
      sim.progression.points = experienceForLevel(30);
      sim.craftSlots = [tool(), { id: "lapis_lazuli", count: 3 }];
      if (reason === "no-level") sim.progression.points = 0;
      if (reason === "no-lapis") sim.craftSlots[1]!.count = 1;
      if (reason === "broken-table") world.setBlock(0, 1, 0, 0);
      if (reason === "too-far") sim.player.position.x = 50;
      if (reason === "unloaded") world.unloaded.add("0,1,0");
      const before = structuredClone({ p: sim.progression, s: sim.craftSlots });
      sim.enchant(2);
      expect({ p: sim.progression, s: sim.craftSlots }).toEqual(before);
    },
  );
  it("rejects the wrong material in either enchanting slot and cannot output a crafting recipe", () => {
    const { sim, world } = fixture();
    openTable(sim, world);
    sim.cursor = { id: "dirt", count: 1 };
    sim.clickSlot("craft", 0);
    sim.clickSlot("craft", 1);
    expect(sim.craftSlots).toEqual([null, null]);
    expect(sim.cursor.id).toBe("dirt");
    sim.craftSlots = [{ id: "log", count: 1 }, null];
    expect(sim.craftOutput).toBe(null);
    sim.takeCraftOutput();
    expect(sim.craftSlots[0]?.count).toBe(1);
  });
  it("clones enchantment metadata when moving and checkpointing items", () => {
    const source = tool("diamond_pickaxe", { efficiency: 3 }),
      slots: Slot[] = Array(3).fill(null);
    addItem(slots, source);
    source.enchantments!.efficiency = 5;
    expect(slots[0]?.enchantments).toEqual({ efficiency: 3 });
    const taken = clickInventorySlot(slots, 0, null, false)!;
    expect(taken.enchantments).toEqual({ efficiency: 3 });
    const { sim } = fixture();
    sim.player.inventory[0] = taken;
    const saved = sim.snapshot();
    saved.player.inventory[0]!.enchantments!.efficiency = 4;
    expect(sim.held?.enchantments).toEqual({ efficiency: 3 });
  });
});

describe("equipment effects are consumed by Simulation", () => {
  it("efficiency accelerates valid mining and fortune changes mineral yield", () => {
    const { sim, world } = fixture();
    sim.player.inventory[0] = tool("diamond_pickaxe", {
      efficiency: 5,
      fortune: 3,
    });
    vi.spyOn(sim.farming, "nextRandom").mockReturnValue(0.99);
    world.setBlock(0, 1, 0, 88);
    aim(sim, { x: 0.5, y: 1.5, z: 0.5 });
    expect(
      sim.mine(miningDuration(BLOCKS[88], ITEMS.diamond_pickaxe, sim.held)),
    ).toBe(true);
    expect(sim.drops.find((d) => d.stack.id === "diamond")?.stack.count).toBe(
      4,
    );
    expect(totalXP(sim)).toBe(7);
  });
  it("unbreaking can spare a tool use", () => {
    const { sim, world } = fixture();
    sim.player.inventory[0] = tool("diamond_pickaxe", { unbreaking: 3 });
    vi.spyOn(sim.farming, "nextRandom").mockReturnValue(0.99);
    world.setBlock(0, 1, 0, 3);
    sim.breakBlock({ x: 0, y: 1, z: 0 });
    expect(sim.held?.durability).toBe(1561);
  });
  it("sharpness increases real melee damage", () => {
    const { sim } = fixture();
    sim.player.inventory[0] = tool("iron_sword", { sharpness: 5 });
    sim.entities = [
      {
        id: "z",
        kind: "zombie",
        position: { x: 0.5, y: 1, z: 1.5 },
        health: 20,
        yaw: 0,
        timer: 5,
      },
    ];
    aim(sim, { x: 0.5, y: 1.9, z: 1.5 });
    sim.attack();
    expect(sim.entities[0].health).toBe(20 - ITEMS.iron_sword.damage! - 3);
  });
  it("feather falling and protection reduce falling damage while void bypasses enchantments", () => {
    const { sim } = fixture();
    sim.player.armor.feet = tool("diamond_boots", {
      feather_falling: 4,
      protection: 4,
    });
    sim.damage(10, "fall");
    expect(sim.player.health).toBeCloseTo(16.4);
    const copy = fixture().sim;
    copy.player.armor.feet = tool("diamond_boots", {
      feather_falling: 4,
      protection: 4,
    });
    copy.damage(10, "void");
    expect(copy.player.health).toBe(10);
  });
  it("respiration saves oxygen during submerged simulation", () => {
    const { sim, world } = fixture();
    world.setBlock(0, 1, 3, 6);
    world.setBlock(0, 2, 3, 6);
    sim.player.armor.head = tool("diamond_helmet", { respiration: 3 });
    vi.spyOn(sim.farming, "nextRandom").mockReturnValue(0.99);
    sim.step(1 / 60, idle);
    expect(sim.player.oxygen).toBe(20);
  });
});

describe("current save validation and migration of the version six gameplay extension", () => {
  it("round trips fractional levels, orbs, enchantments, cane and furnace bank as an independent import", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const { sim, world } = fixture();
    sim.progression.points = spendLevels(experienceForLevel(30) + 10, 3)!;
    sim.spawnExperience(23, { x: 9, y: 1, z: 9 });
    sim.player.inventory[0] = tool("diamond_pickaxe", {
      efficiency: 4,
      unbreaking: 3,
    });
    world.setBlock(1, 1, 1, 14);
    sim.containers["1,1,1"] = {
      kind: "furnace",
      slots: [null, null, { id: "cooked_beef", count: 2 }],
      burn: 4,
      burnTotal: 80,
      progress: 2,
      experience: 0.7,
    };
    const snapshot = sim.snapshot();
    await saveWorld(snapshot);
    expect(await loadWorld(snapshot.manifest.id)).toEqual(snapshot);
    const imported = await importWorld(JSON.stringify(snapshot));
    const copy = await loadWorld(imported.id);
    expect(copy?.manifest.id).not.toBe(snapshot.manifest.id);
    expect(copy?.player).toEqual(snapshot.player);
    expect(copy?.progression).toEqual(snapshot.progression);
    expect(copy?.containers).toEqual(snapshot.containers);
  });
  it("upgrades a v5 checkpoint atomically with its full backup and unchanged generator", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const old = createNewSave("v5", "old-height", "survival");
    old.manifest.version = 5;
    old.manifest.generatorVersion = 5;
    delete old.progression;
    delete old.sugarCane;
    await saveWorld(old);
    const sim = new Simulation(new TestWorld(), old);
    await saveWorld(sim.snapshot());
    expect(await loadMigrationBackup(old.manifest.id, 5)).toEqual(old);
    expect((await loadWorld(old.manifest.id))?.manifest).toMatchObject({
      version: 7,
      generatorVersion: 5,
    });
  });
  it.each([
    [
      "unknown enchantment",
      (s: SaveData) => {
        s.player.inventory[0] = tool("iron_pickaxe", { mending: 1 });
      },
    ],
    [
      "incompatible",
      (s: SaveData) => {
        s.player.inventory[0] = tool("iron_pickaxe", {
          fortune: 3,
          silk_touch: 1,
        });
      },
    ],
    [
      "over-level",
      (s: SaveData) => {
        s.player.inventory[0] = tool("iron_pickaxe", { efficiency: 6 });
      },
    ],
    [
      "wrong-item in old v6 schema",
      (s: SaveData) => {
        s.manifest.version = 6;
        s.player.inventory[0] = {
          id: "dirt",
          count: 1,
          enchantments: { efficiency: 1 },
        };
      },
    ],
    [
      "negative-xp",
      (s: SaveData) => {
        s.progression!.points = -1;
      },
    ],
    [
      "duplicate-orb",
      (s: SaveData) => {
        s.progression!.orbs = Array.from({ length: 2 }, () => ({
          id: "same",
          position: { x: 0, y: 1, z: 0 },
          age: 0,
          value: 1,
        }));
      },
    ],
    [
      "fractional-orb",
      (s: SaveData) => {
        s.progression!.orbs = [
          { id: "orb", position: { x: 0, y: 1, z: 0 }, age: 0, value: 0.5 },
        ];
      },
    ],
    [
      "negative-bank",
      (s: SaveData) => {
        s.changes = [{ x: 0, y: 1, z: 0, id: 14 }];
        s.containers["0,1,0"] = {
          kind: "furnace",
          slots: [null, null, null],
          burn: 0,
          burnTotal: 0,
          progress: 0,
          experience: -1,
        };
      },
    ],
    [
      "old-schema",
      (s: SaveData) => {
        s.manifest.version = 5;
        s.manifest.generatorVersion = 5;
      },
    ],
    [
      "over-age-cane",
      (s: SaveData) => {
        s.sugarCane!.growth = [{ x: 0, y: 1, z: 0, age: 121 }];
      },
    ],
  ] as const)("rejects %s", (_name, mutate) => {
    const s = createNewSave("坏数据", "bad", "survival");
    mutate(s);
    expect(() => validateSave(s)).toThrow();
  });
});
