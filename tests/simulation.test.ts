import { describe, expect, it } from "vitest";
import { Simulation, createNewSave } from "../src/game/Simulation";
import { addItem, countItem } from "../src/game/inventory";
import { ITEMS } from "../src/game/registry";
import { validateSave } from "../src/game/storage";
import { intersectsWorld } from "../src/engine/physics";
import type {
  BlockChange,
  ContainerState,
  GameMode,
  SaveData,
  Slot,
  Vec3,
  WorldPort,
} from "../src/game/types";

class MemoryWorld implements WorldPort {
  private blocks = new Map<string, BlockChange>();
  ready = true;
  constructor(changes: BlockChange[] = []) {
    changes.forEach((b) => this.setBlock(b.x, b.y, b.z, b.id));
  }
  getBlock(x: number, y: number, z: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    return (
      this.blocks.get(`${x},${y},${z}`)?.id ?? (y < 0 ? 24 : y === 0 ? 1 : 0)
    );
  }
  setBlock(x: number, y: number, z: number, id: number): void {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    this.blocks.set(`${x},${y},${z}`, { x, y, z, id });
  }
  isReady(): boolean {
    return this.ready;
  }
  getSurface(x: number, z: number): number {
    for (let y = 95; y >= 0; y--) if (this.getBlock(x, y, z)) return y;
    return 0;
  }
  getChanges(): BlockChange[] {
    return [...this.blocks.values()].map((b) => ({ ...b }));
  }
  getLight(): number {
    return 0;
  }
}
const idle = { forward: 0, right: 0, jump: false, sneak: false, sprint: false };
function setup(mode: GameMode = "survival") {
  const world = new MemoryWorld();
  const data = createNewSave("试验林地", "test-seed", mode);
  data.player.position = { x: 0.5, y: 1, z: 0.5 };
  data.player.spawn = { x: 0.5, y: 1, z: 0.5 };
  data.player.yaw = 0;
  data.player.pitch = 0;
  return { world, sim: new Simulation(world, data) };
}
function advance(sim: Simulation, seconds: number) {
  for (let time = 0; time < seconds - 1e-8; time += 0.05) sim.step(0.05, idle);
}
function select(sim: Simulation, id: string) {
  const index = sim.player.inventory.findIndex((slot) => slot?.id === id);
  expect(index).toBeGreaterThanOrEqual(0);
  if (index > 8)
    [sim.player.inventory[0], sim.player.inventory[index]] = [
      sim.player.inventory[index],
      sim.player.inventory[0],
    ];
  sim.player.selected = index > 8 ? 0 : index;
}
function gather(sim: Simulation, world: MemoryWorld, id: number, count = 1) {
  for (let i = 0; i < count; i++) {
    world.setBlock(0, 1, -1, id);
    sim.breakBlock({ x: 0, y: 1, z: -1 });
    advance(sim, 0.7);
  }
}
function addFurnace(
  sim: Simulation,
  world: MemoryWorld,
): Extract<ContainerState, { kind: "furnace" }> {
  world.setBlock(3, 1, 0, 14);
  const furnace: Extract<ContainerState, { kind: "furnace" }> = {
    kind: "furnace",
    slots: [null, null, null],
    burn: 0,
    burnTotal: 0,
    progress: 0,
  };
  sim.containers["3,1,0"] = furnace;
  return furnace;
}
function aim(sim: Simulation, point: Vec3) {
  const eye = sim.eye(),
    dx = point.x - eye.x,
    dy = point.y - eye.y,
    dz = point.z - eye.z;
  sim.player.yaw = Math.atan2(-dx, -dz);
  sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
function total(data: SaveData, id: string): number {
  return (
    countItem(data.player.inventory, id) +
    Object.values(data.player.armor).reduce(
      (n, slot) => n + (slot?.id === id ? slot.count : 0),
      0,
    ) +
    data.drops.reduce(
      (n, d) => n + (d.stack.id === id ? d.stack.count : 0),
      0,
    ) +
    Object.values(data.containers).reduce(
      (n, c) => n + countItem(c.slots, id),
      0,
    )
  );
}

describe("empty-inventory survival progression", () => {
  it("harvests wood, crafts a workbench, mines stone, makes charcoal light, smelts ore and crafts an iron tool", () => {
    const { sim, world } = setup();
    expect(sim.player.inventory.every((slot) => !slot)).toBe(true);
    gather(sim, world, 7, 7);
    expect(countItem(sim.player.inventory, "log")).toBe(7);
    for (let i = 0; i < 4; i++) sim.craft("planks");
    sim.craft("workbench");
    sim.craft("stick");
    sim.craft("stick");
    sim.startCraft("workbench");
    sim.craft("wood_pickaxe");
    select(sim, "wood_pickaxe");
    gather(sim, world, 3, 12);
    expect(countItem(sim.player.inventory, "cobblestone")).toBe(12);
    sim.craft("stone_pickaxe");
    sim.craft("furnace");
    select(sim, "stone_pickaxe");
    const furnace = addFurnace(sim, world);
    const fromBag = (id: string, count: number) => {
      const slot = sim.player.inventory.find((slot) => slot?.id === id)!;
      expect(slot?.count).toBeGreaterThanOrEqual(count);
      slot.count -= count;
      if (!slot.count)
        sim.player.inventory[sim.player.inventory.indexOf(slot)] = null;
      return { id, count };
    };
    furnace.slots[0] = fromBag("log", 1);
    furnace.slots[1] = fromBag("planks", 1);
    advance(sim, 10.1);
    expect(furnace.slots[2]).toEqual({ id: "charcoal", count: 1 });
    addItem(sim.player.inventory, furnace.slots[2]!);
    furnace.slots[2] = null;
    sim.craft("torch_charcoal");
    expect(countItem(sim.player.inventory, "torch")).toBe(4);
    expect(countItem(sim.player.inventory, "coal")).toBe(0);
    furnace.slots[0] = fromBag("log", 1);
    furnace.slots[1] = fromBag("planks", 1);
    advance(sim, 10.1);
    expect((furnace.slots[2] as Slot)?.id).toBe("charcoal");
    const charcoal = furnace.slots[2];
    furnace.slots[2] = null;
    gather(sim, world, 10, 3);
    expect(countItem(sim.player.inventory, "raw_iron")).toBe(3);
    furnace.slots[0] = fromBag("raw_iron", 3);
    furnace.slots[1] = charcoal;
    advance(sim, 30.1);
    expect(furnace.slots[2]).toEqual({ id: "iron_ingot", count: 3 });
    addItem(sim.player.inventory, furnace.slots[2]!);
    furnace.slots[2] = null;
    sim.craft("iron_pickaxe");
    expect(
      sim.player.inventory.some(
        (slot) => slot?.id === "iron_pickaxe" && slot.durability === 250,
      ),
    ).toBe(true);
    expect(() => validateSave(sim.snapshot())).not.toThrow();
  });
  it("requires the correct pickaxe tier for ore drops", () => {
    const { sim, world } = setup();
    gather(sim, world, 3);
    gather(sim, world, 10);
    expect(countItem(sim.player.inventory, "cobblestone")).toBe(0);
    expect(countItem(sim.player.inventory, "raw_iron")).toBe(0);
    addItem(sim.player.inventory, { id: "wood_pickaxe", count: 1 });
    select(sim, "wood_pickaxe");
    gather(sim, world, 10);
    expect(countItem(sim.player.inventory, "raw_iron")).toBe(0);
    addItem(sim.player.inventory, { id: "stone_pickaxe", count: 1 });
    select(sim, "stone_pickaxe");
    gather(sim, world, 10);
    expect(countItem(sim.player.inventory, "raw_iron")).toBe(1);
  });
  it("refuses a workbench recipe from a personal crafting grid", () => {
    const { sim } = setup();
    addItem(sim.player.inventory, { id: "planks", count: 3 });
    addItem(sim.player.inventory, { id: "stick", count: 2 });
    const before = structuredClone(sim.player.inventory);
    sim.craft("wood_pickaxe");
    expect(sim.player.inventory).toEqual(before);
    expect(sim.lastMessage).toContain("工作台");
  });
});

describe("furnace and item transfers", () => {
  it("finishes one iron after ten seconds and retains progress across save/load", () => {
    const { sim, world } = setup();
    const furnace = addFurnace(sim, world);
    furnace.slots = [
      { id: "raw_iron", count: 2 },
      { id: "coal", count: 1 },
      null,
    ];
    advance(sim, 5);
    expect(furnace.slots[2]).toBeNull();
    expect(furnace.progress).toBeCloseTo(5);
    const save = validateSave(sim.snapshot());
    const restored = new Simulation(new MemoryWorld(save.changes), save);
    advance(restored, 5.1);
    expect(restored.containers["3,1,0"].slots[2]).toEqual({
      id: "iron_ingot",
      count: 1,
    });
    expect(restored.containers["3,1,0"].slots[0]?.count).toBe(1);
  });
  it("stops consuming input and fuel when the output cannot accept the product", () => {
    const { sim, world } = setup();
    const furnace = addFurnace(sim, world);
    furnace.slots = [
      { id: "raw_iron", count: 2 },
      { id: "coal", count: 2 },
      { id: "iron_ingot", count: 64 },
    ];
    advance(sim, 20);
    expect(furnace.slots.map((slot) => slot?.count)).toEqual([2, 2, 64]);
    expect(furnace.progress).toBe(0);
  });
  it("never permits placing a carried item into the output slot", () => {
    const { sim, world } = setup();
    const furnace = addFurnace(sim, world);
    sim.containerKey = "3,1,0";
    sim.cursor = { id: "iron_ingot", count: 3 };
    sim.clickSlot("container", 2);
    expect(furnace.slots[2]).toBeNull();
    expect(sim.cursor?.count).toBe(3);
    furnace.slots[2] = { id: "iron_ingot", count: 2 };
    sim.clickSlot("container", 2);
    expect(furnace.slots[2]).toBeNull();
    expect(sim.cursor?.count).toBe(5);
  });
  it("moves stacks between hotbar, bag and chest without duplication", () => {
    const { sim, world } = setup();
    sim.player.inventory[0] = { id: "dirt", count: 60 };
    sim.player.inventory[9] = { id: "dirt", count: 63 };
    sim.clickSlot("inventory", 0, false, true);
    expect(countItem(sim.player.inventory, "dirt")).toBe(123);
    expect(sim.player.inventory[0]).toBeNull();
    expect(sim.player.inventory[9]?.count).toBe(64);
    world.setBlock(3, 1, 0, 15);
    sim.containers["3,1,0"] = { kind: "chest", slots: Array(27).fill(null) };
    sim.containerKey = "3,1,0";
    sim.clickSlot("inventory", 9, false, true);
    sim.clickSlot("inventory", 10, false, true);
    expect(countItem(sim.player.inventory, "dirt")).toBe(0);
    expect(countItem(sim.container!.slots, "dirt")).toBe(123);
    sim.clickSlot("container", 0, false, true);
    sim.clickSlot("container", 1, false, true);
    expect(countItem(sim.player.inventory, "dirt")).toBe(123);
    expect(countItem(sim.container!.slots, "dirt")).toBe(0);
  });
  it("routes shift transfers only into matching furnace input/fuel slots", () => {
    const { sim, world } = setup();
    const furnace = addFurnace(sim, world);
    sim.containerKey = "3,1,0";
    sim.player.inventory[0] = { id: "raw_iron", count: 4 };
    sim.player.inventory[1] = { id: "coal", count: 2 };
    sim.player.inventory[2] = { id: "dirt", count: 3 };
    sim.clickSlot("inventory", 0, false, true);
    sim.clickSlot("inventory", 1, false, true);
    sim.clickSlot("inventory", 2, false, true);
    expect(furnace.slots).toEqual([
      { id: "raw_iron", count: 4 },
      { id: "coal", count: 2 },
      null,
    ]);
    expect(sim.player.inventory[2]?.count).toBe(3);
  });
});

describe("temporary inventory and save conservation", () => {
  it("returns crafting materials and cursor contents when the inventory closes", () => {
    const { sim } = setup();
    sim.craftSlots[0] = { id: "log", count: 3 };
    sim.cursor = { id: "stick", count: 7 };
    sim.closeContainer();
    expect(countItem(sim.player.inventory, "log")).toBe(3);
    expect(countItem(sim.player.inventory, "stick")).toBe(7);
    expect(sim.cursor).toBeNull();
    expect(sim.craftSlots.every((slot) => !slot)).toBe(true);
    sim.closeContainer();
    expect(countItem(sim.player.inventory, "log")).toBe(3);
  });
  it("takes crafting output only once and preserves source stack counts", () => {
    const { sim } = setup();
    sim.craftSlots[3] = { id: "log", count: 2 };
    sim.takeCraftOutput();
    expect(sim.cursor).toEqual({ id: "planks", count: 4 });
    expect(sim.craftSlots[3]?.count).toBe(1);
    sim.takeCraftOutput();
    expect(sim.cursor).toEqual({ id: "planks", count: 8 });
    expect(sim.craftSlots[3]).toBeNull();
    sim.takeCraftOutput();
    expect(sim.cursor?.count).toBe(8);
  });
  it("folds crafting/cursor into each detached checkpoint without changing the live inventory", () => {
    const { sim } = setup();
    sim.player.inventory[0] = { id: "log", count: 2 };
    sim.craftSlots[1] = { id: "log", count: 3 };
    sim.cursor = { id: "log", count: 4 };
    const a = validateSave(sim.snapshot()),
      b = validateSave(sim.snapshot());
    expect(total(a, "log")).toBe(9);
    expect(total(b, "log")).toBe(9);
    expect(countItem(sim.player.inventory, "log")).toBe(2);
    expect(sim.cursor?.count).toBe(4);
    const restored = new Simulation(new MemoryWorld(a.changes), a);
    expect(total(restored.snapshot(), "log")).toBe(9);
    expect(restored.cursor).toBeNull();
    sim.closeContainer();
    expect(total(sim.snapshot(), "log")).toBe(9);
  });
  it("folds overflowing temporary items into save-only drops and never loses them on reload", () => {
    const { sim } = setup();
    sim.player.inventory.fill(null);
    for (let i = 0; i < 36; i++)
      sim.player.inventory[i] = { id: "dirt", count: 64 };
    sim.craftSlots[0] = { id: "log", count: 3 };
    sim.cursor = { id: "stick", count: 4 };
    const save = validateSave(sim.snapshot());
    expect(total(save, "log")).toBe(3);
    expect(total(save, "stick")).toBe(4);
    expect(sim.drops).toHaveLength(0);
    const restored = new Simulation(new MemoryWorld(), save);
    expect(total(restored.snapshot(), "log")).toBe(3);
  });
});

describe("death, beds, construction and explosions", () => {
  it("drops bag, cursor, crafting and armor exactly once on death and permits pickup after respawn", () => {
    const { sim } = setup();
    sim.player.inventory[0] = { id: "log", count: 7 };
    sim.player.armor.head = { id: "iron_helmet", count: 1, durability: 40 };
    sim.cursor = { id: "stick", count: 3 };
    sim.craftSlots[0] = { id: "planks", count: 5 };
    sim.damage(100, "void");
    expect(sim.player.dead).toBe(true);
    const dead = validateSave(sim.snapshot());
    expect(total(dead, "log")).toBe(7);
    expect(total(dead, "iron_helmet")).toBe(1);
    expect(total(dead, "stick")).toBe(3);
    expect(total(dead, "planks")).toBe(5);
    sim.damage(100, "void");
    expect(sim.drops).toHaveLength(4);
    sim.respawn();
    advance(sim, 1);
    expect(sim.player.health).toBe(20);
    expect(countItem(sim.player.inventory, "log")).toBe(7);
    expect(countItem(sim.player.inventory, "iron_helmet")).toBe(1);
    expect(sim.drops).toHaveLength(0);
  });
  it("places both halves of a bed, sleeps, then removes both halves with one drop", () => {
    const { sim, world } = setup();
    sim.player.inventory[0] = { id: "bed", count: 1 };
    aim(sim, { x: 0.5, y: 0.5, z: -1.5 });
    sim.interact();
    expect(world.getBlock(0, 1, -2)).toBe(22);
    expect(world.getBlock(0, 1, -1)).toBe(27);
    expect(sim.player.inventory[0]).toBeNull();
    sim.time = 14000;
    aim(sim, { x: 0.5, y: 1.3, z: -1.5 });
    sim.interact();
    expect(sim.time).toBe(1000);
    expect(sim.player.bedSpawn).toEqual({ x: 0, y: 1, z: -2 });
    sim.breakBlock({ x: 0, y: 1, z: -1 });
    expect(world.getBlock(0, 1, -2)).toBe(0);
    expect(world.getBlock(0, 1, -1)).toBe(0);
    expect(sim.drops.filter((drop) => drop.stack.id === "bed")).toHaveLength(1);
    sim.damage(100, "void");
    sim.respawn();
    expect(sim.player.position).toEqual(sim.player.spawn);
    expect(sim.player.bedSpawn).toBeUndefined();
    expect(() => validateSave(sim.snapshot())).not.toThrow();
  });
  it("refuses sleep while a nearby hostile is alive", () => {
    const { sim, world } = setup();
    world.setBlock(0, 1, -2, 22);
    world.setBlock(0, 1, -1, 27);
    sim.time = 15000;
    sim.entities = [
      {
        id: "z",
        kind: "zombie",
        position: { x: 3, y: 1, z: -2 },
        health: 20,
        yaw: 0,
        timer: 1,
      },
    ];
    aim(sim, { x: 0.5, y: 1.3, z: -1.5 });
    sim.interact();
    expect(sim.time).toBe(15000);
    expect(sim.lastMessage).toContain("怪物");
  });
  it("places a door as two halves and toggles them together", () => {
    const { sim, world } = setup();
    sim.player.inventory[0] = { id: "door", count: 3 };
    aim(sim, { x: 0.5, y: 0.5, z: -1.5 });
    sim.interact();
    expect(world.getBlock(0, 1, -2)).toBe(18);
    expect(world.getBlock(0, 2, -2)).toBe(25);
    aim(sim, { x: 0.5, y: 2.5, z: -1.9 });
    sim.interact();
    expect(world.getBlock(0, 1, -2)).toBe(19);
    expect(world.getBlock(0, 2, -2)).toBe(26);
    expect(sim.player.inventory[0]?.count).toBe(2);
  });
  it("explodes blocks and a filled container without duplicating content or destroying bedrock", () => {
    const { sim, world } = setup();
    sim.player.position = { x: 20, y: 1, z: 20 };
    world.setBlock(3, 1, 0, 15);
    sim.containers["3,1,0"] = {
      kind: "chest",
      slots: Array.from({ length: 27 }, (_, i) =>
        i === 0 ? { id: "iron_ingot", count: 8 } : null,
      ),
    };
    world.setBlock(4, 1, 0, 3);
    world.setBlock(3, 0, 0, 24);
    sim.explode({ x: 3.5, y: 1.5, z: 0.5 });
    expect(world.getBlock(3, 1, 0)).toBe(0);
    expect(world.getBlock(4, 1, 0)).toBe(0);
    expect(world.getBlock(3, 0, 0)).toBe(24);
    expect(sim.containers["3,1,0"]).toBeUndefined();
    expect(total(sim.snapshot(), "iron_ingot")).toBe(8);
    expect(sim.drops.filter((d) => d.stack.id === "chest")).toHaveLength(1);
    expect(() => validateSave(sim.snapshot())).not.toThrow();
  });
  it("creative gives every implemented item with legal stack count and durability", () => {
    const { sim } = setup("creative");
    for (const id of Object.keys(ITEMS)) {
      sim.giveItem(id);
      expect(sim.held?.id).toBe(id);
      expect(sim.held?.count).toBe(ITEMS[id].maxStack);
      expect(() => validateSave(sim.snapshot())).not.toThrow();
    }
    sim.damage(100);
    expect(sim.player.health).toBe(20);
    expect(sim.player.flying).toBe(true);
    const survival = setup().sim;
    survival.giveItem("iron_ingot");
    expect(survival.held).toBeNull();
  });
});

describe("regressions discovered during integration review", () => {
  it("equips a held armor item when aiming into empty sky", () => {
    const { sim } = setup();
    sim.player.pitch = 1.4;
    sim.player.inventory[0] = { id: "iron_helmet", count: 1, durability: 73 };
    expect(sim.target()).toBeNull();
    sim.interact();
    expect(sim.player.armor.head).toEqual({
      id: "iron_helmet",
      count: 1,
      durability: 73,
    });
    expect(sim.player.inventory[0]).toBeNull();
  });
  it("lets creative players remove a placed bedrock block while survival cannot mine it", () => {
    const { sim, world } = setup("creative");
    world.setBlock(0, 2, -2, 24);
    aim(sim, { x: 0.5, y: 2.5, z: -1.5 });
    expect(sim.target()?.id).toBe(24);
    expect(sim.mine(0.2)).toBe(true);
    expect(world.getBlock(0, 2, -2)).toBe(0);
    expect(sim.drops).toHaveLength(0);
    const survival = setup();
    survival.world.setBlock(0, 2, -2, 24);
    aim(survival.sim, { x: 0.5, y: 2.5, z: -1.5 });
    expect(survival.sim.mine(10)).toBe(false);
    expect(survival.world.getBlock(0, 2, -2)).toBe(24);
  });
  it("finds a safe nearby spawn if construction has obstructed the original spawn", () => {
    const { sim, world } = setup();
    sim.player.position = { x: 5.5, y: 1, z: 5.5 };
    world.setBlock(0, 1, 0, 3);
    world.setBlock(0, 2, 0, 3);
    sim.damage(100, "void");
    sim.respawn();
    expect(intersectsWorld(world, sim.player.position)).toBe(false);
    expect(
      Math.hypot(sim.player.position.x - 0.5, sim.player.position.z - 0.5),
    ).toBeLessThan(16);
    expect(() => validateSave(sim.snapshot())).not.toThrow();
  });
});

describe("shelter blocks hostile interactions", () => {
  it("still permits an unobstructed zombie attack and creeper ignition", () => {
    const zombie = setup();
    zombie.sim.time = 15000;
    zombie.sim.entities = [
      {
        id: "zombie-open",
        kind: "zombie",
        position: { x: 0.5, y: 1, z: -0.5 },
        health: 20,
        yaw: 0,
        timer: 0,
      },
    ];
    advance(zombie.sim, 0.1);
    expect(zombie.sim.player.health).toBeLessThan(20);
    const creeper = setup();
    creeper.sim.time = 15000;
    creeper.sim.entities = [
      {
        id: "creeper-open",
        kind: "creeper",
        position: { x: 2.5, y: 1, z: 0.5 },
        health: 20,
        yaw: 0,
        timer: 1,
      },
    ];
    advance(creeper.sim, 0.5);
    expect(creeper.sim.entities[0]?.fuse).toBeGreaterThan(0);
  });
  it("does not ignite a creeper through a solid shelter wall", () => {
    const { sim, world } = setup();
    sim.time = 15000;
    for (let y = 1; y <= 4; y++)
      for (let z = -2; z <= 2; z++) world.setBlock(1, y, z, 3);
    sim.entities = [
      {
        id: "creeper-wall",
        kind: "creeper",
        position: { x: 2.5, y: 1, z: 0.5 },
        health: 20,
        yaw: 0,
        timer: 1,
      },
    ];
    advance(sim, 0.5);
    expect(sim.entities[0]?.fuse ?? 0).toBe(0);
    expect(sim.player.health).toBe(20);
    expect(world.getBlock(1, 1, 0)).toBe(3);
  });
  it("does not let zombies hit through a closed door", () => {
    const { sim, world } = setup();
    sim.time = 15000;
    world.setBlock(0, 1, -1, 18);
    world.setBlock(0, 2, -1, 25);
    sim.entities = [
      {
        id: "zombie-door",
        kind: "zombie",
        position: { x: 0.5, y: 1, z: -0.5 },
        health: 20,
        yaw: 0,
        timer: 0,
      },
    ];
    advance(sim, 0.1);
    expect(sim.player.health).toBe(20);
  });
});

describe("eating continuity", () => {
  it("consumes the selected food after finishing the eating action", () => {
    const { sim } = setup();
    sim.player.hunger = 5;
    sim.player.inventory[0] = { id: "cooked_pork", count: 2 };
    sim.interact();
    advance(sim, 1);
    expect(sim.player.hunger).toBe(5);
    expect(sim.player.inventory[0]?.count).toBe(2);
    advance(sim, 0.7);
    expect(sim.player.hunger).toBe(13);
    expect(sim.player.inventory[0]?.count).toBe(1);
    expect(() => validateSave(sim.snapshot())).not.toThrow();
  });
  it("cancels eating on changing selected food, preserving both stacks", () => {
    const { sim } = setup();
    sim.player.hunger = 5;
    sim.player.inventory[0] = { id: "raw_pork", count: 1 };
    sim.player.inventory[1] = { id: "cooked_pork", count: 1 };
    sim.interact();
    advance(sim, 0.5);
    sim.player.selected = 1;
    advance(sim, 1.3);
    expect(sim.player.hunger).toBe(5);
    expect(sim.player.inventory[0]?.count).toBe(1);
    expect(sim.player.inventory[1]?.count).toBe(1);
  });
});
