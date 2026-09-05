import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Simulation, createNewSave } from "../src/game/Simulation";
import { ITEMS } from "../src/game/registry";
import { experienceForLevel, experienceStatus } from "../src/game/experience";
import { validateSave } from "../src/game/storage";
import { NaturalUpdatesSystem } from "../src/game/natural-updates";
import type {
  BlockChange,
  ItemStack,
  Vec3,
  WorldPort,
} from "../src/game/types";

class World implements WorldPort {
  blocks = new Map<string, BlockChange>();
  unavailable = new Set<string>();
  constructor(changes: BlockChange[] = []) {
    changes.forEach((p) => this.setBlock(p.x, p.y, p.z, p.id));
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
    return !this.unavailable.has(
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
function setup(kind: "anvil" | "grindstone" = "anvil") {
  const world = new World(),
    save = createNewSave("铁砧验收", "workshops", "survival");
  save.player.position = { x: 0.5, y: 1, z: 3.5 };
  save.player.spawn = { ...save.player.position };
  const sim = new Simulation(world, save);
  sim.setBlock(0, 1, 0, kind === "anvil" ? 114 : 120);
  aim(sim, { x: 0.5, y: 1.8, z: 0.5 });
  sim.interact();
  expect(sim.station).toBe(kind);
  sim.progression.points = experienceForLevel(30);
  vi.spyOn(sim.farming, "nextRandom").mockReturnValue(0.5);
  return { sim, world };
}
function aim(sim: Simulation, p: Vec3) {
  const e = sim.eye(),
    dx = p.x - e.x,
    dy = p.y - e.y,
    dz = p.z - e.z;
  sim.player.yaw = Math.atan2(-dx, -dz);
  sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
function tool(durability = 100): ItemStack {
  return {
    id: "diamond_pickaxe",
    count: 1,
    durability,
    enchantments: { efficiency: 3 },
  };
}
function totalXp(sim: Simulation) {
  return (
    sim.progression.points +
    sim.progression.orbs.reduce((n, orb) => n + orb.value, 0)
  );
}
afterEach(() => vi.restoreAllMocks());

describe("workstation actions conserve equipment, materials and experience", () => {
  it("repairs with only required material, charges levels once and checkpoints the cursor", () => {
    const { sim } = setup();
    sim.craftSlots = [tool(1500), { id: "diamond", count: 5 }];
    const view = sim.getWorkshop()!;
    expect(view).toMatchObject({
      available: true,
      levelCost: 1,
      materialCost: 1,
    });
    sim.takeWorkshopOutput();
    expect(sim.cursor).toMatchObject({
      durability: 1561,
      repairCost: 1,
      enchantments: { efficiency: 3 },
    });
    expect(sim.craftSlots).toEqual([null, { id: "diamond", count: 4 }]);
    expect(experienceStatus(sim.progression.points).level).toBe(29);
    const after = structuredClone(sim.snapshot());
    sim.takeWorkshopOutput();
    expect(sim.snapshot().player).toEqual(after.player);
    expect(sim.progression).toEqual(after.progression);
    const restored = validateSave(after);
    expect(
      restored.player.inventory.some(
        (s) => s?.repairCost === 1 && s.durability === 1561,
      ),
    ).toBe(true);
    sim.closeContainer();
    expect(sim.player.inventory).toEqual(restored.player.inventory);
  });
  it("keeps inputs, XP and random state unchanged when output destination is full", () => {
    const { sim } = setup();
    sim.craftSlots = [tool(), { id: "diamond", count: 4 }];
    sim.player.inventory.fill({ id: "dirt", count: 64 });
    sim.cursor = { id: "stone", count: 64 };
    const slots = structuredClone(sim.craftSlots),
      points = sim.progression.points;
    sim.takeWorkshopOutput();
    sim.takeWorkshopOutput(true);
    expect(sim.craftSlots).toEqual(slots);
    expect(sim.progression.points).toBe(points);
    expect(sim.farming.nextRandom).not.toHaveBeenCalled();
  });
  it.each(["removed", "unloaded", "distant", "dead"])(
    "rejects %s station without spending quoted ingredients",
    (condition) => {
      const { sim, world } = setup();
      sim.craftSlots = [tool(), { id: "diamond", count: 4 }];
      expect(sim.getWorkshop()?.available).toBe(true);
      if (condition === "removed") sim.setBlock(0, 1, 0, 0);
      if (condition === "unloaded") world.unavailable.add("0,1,0");
      if (condition === "distant") sim.player.position.x = 100;
      if (condition === "dead") sim.player.dead = true;
      sim.takeWorkshopOutput();
      expect(sim.craftSlots[1]?.count).toBe(4);
      expect(sim.cursor).toBeNull();
      expect(experienceStatus(sim.progression.points).level).toBe(30);
    },
  );
  it("resets name on new left input, supports removal and rejects stale rename after closing", () => {
    const { sim } = setup();
    sim.craftSlots[0] = { ...tool(), customName: "旧镐" };
    sim.setWorkshopName("远山");
    expect(sim.getWorkshop()?.output?.customName).toBe("远山");
    sim.craftSlots[0] = {
      id: "iron_sword",
      count: 1,
      durability: 100,
      customName: "旧剑",
    };
    expect(sim.getWorkshop()?.name).toBe("旧剑");
    sim.setWorkshopName("");
    sim.takeWorkshopOutput();
    expect(sim.cursor?.customName).toBeUndefined();
    sim.closeContainer();
    sim.setWorkshopName("不会串入下一次");
    expect(sim.getWorkshop()).toBeNull();
  });
  it("combines a book into equipment and degrades the anvil only after a successful take", () => {
    const { sim } = setup();
    vi.mocked(sim.farming.nextRandom).mockReturnValue(0);
    sim.craftSlots = [
      tool(),
      { id: "enchanted_book", count: 1, enchantments: { efficiency: 3 } },
    ];
    const quote = sim.getWorkshop()!;
    expect(quote.output?.enchantments).toEqual({ efficiency: 4 });
    expect(sim.world.getBlock(0, 1, 0)).toBe(114);
    sim.takeWorkshopOutput(true);
    expect(sim.world.getBlock(0, 1, 0)).toBe(116);
    expect(sim.player.inventory[0]?.enchantments).toEqual({ efficiency: 4 });
    expect(sim.craftSlots).toEqual([null, null]);
    expect(experienceStatus(sim.progression.points).level).toBe(
      30 - quote.levelCost,
    );
  });
  it("returns finished item even when the last damaged anvil breaks", () => {
    const { sim } = setup();
    sim.setBlock(0, 1, 0, 118);
    vi.mocked(sim.farming.nextRandom).mockReturnValue(0);
    sim.craftSlots[0] = { id: "dirt", count: 64 };
    sim.setWorkshopName("建筑用土");
    sim.takeWorkshopOutput();
    expect(sim.world.getBlock(0, 1, 0)).toBe(0);
    expect(sim.cursor).toMatchObject({
      id: "dirt",
      count: 64,
      customName: "建筑用土",
    });
    expect(sim.getWorkshop()).toBeNull();
    expect(validateSave(sim.snapshot()).player.inventory[0]?.customName).toBe(
      "建筑用土",
    );
  });
  it("creative work costs no levels and preserves anvil; all eight creative books are legal", () => {
    const { sim } = setup();
    sim.manifest.mode = "creative";
    sim.progression.points = 0;
    vi.mocked(sim.farming.nextRandom).mockReturnValue(0);
    sim.craftSlots = [
      tool(),
      { id: "enchanted_book", count: 1, enchantments: { unbreaking: 3 } },
    ];
    sim.takeWorkshopOutput();
    expect(sim.cursor?.enchantments?.unbreaking).toBe(3);
    expect(sim.progression.points).toBe(0);
    expect(sim.world.getBlock(0, 1, 0)).toBe(114);
    sim.closeContainer();
    for (const id of [
      "efficiency",
      "unbreaking",
      "fortune",
      "silk_touch",
      "sharpness",
      "protection",
      "feather_falling",
      "respiration",
    ]) {
      sim.giveItem("enchanted_book", id);
      expect(
        validateSave(sim.snapshot()).player.inventory[0]?.enchantments?.[id],
      ).toBeGreaterThan(0);
    }
  });
  it("splits one book into the table through shift and right-click without overfilling", () => {
    const { sim } = setup();
    sim.closeContainer();
    sim.setBlock(0, 1, 0, 112);
    aim(sim, { x: 0.5, y: 1.5, z: 0.5 });
    sim.interact();
    sim.player.inventory[0] = { id: "book", count: 12 };
    sim.clickSlot("inventory", 0, false, true);
    expect(sim.craftSlots[0]?.count).toBe(1);
    expect(sim.player.inventory[0]?.count).toBe(11);
    sim.clickSlot("craft", 0, false, true);
    sim.clickSlot("inventory", 0);
    sim.clickSlot("craft", 0, true);
    sim.clickSlot("craft", 0, true);
    expect(sim.craftSlots[0]?.count).toBe(1);
    expect(sim.cursor?.count).toBe(11);
    sim.closeContainer();
    expect(sim.player.inventory[0]?.count).toBe(12);
  });
  it("grinds only on take, preserves name and damage, resets work cost and yields XP once", () => {
    const { sim } = setup("grindstone");
    sim.craftSlots[0] = { ...tool(), customName: "远山", repairCost: 31 };
    const before = totalXp(sim),
      quote = sim.getWorkshop()!;
    expect(quote.available).toBe(true);
    sim.getWorkshop();
    expect(totalXp(sim)).toBe(before);
    sim.takeWorkshopOutput();
    expect(sim.cursor).toMatchObject({ customName: "远山", durability: 100 });
    expect(sim.cursor?.enchantments).toBeUndefined();
    expect(sim.cursor?.repairCost ?? 0).toBe(0);
    expect(totalXp(sim)).toBeGreaterThanOrEqual(before + quote.experienceMin);
    const earned = totalXp(sim);
    sim.takeWorkshopOutput();
    expect(totalXp(sim)).toBe(earned);
    expect(validateSave(sim.snapshot()).progression?.orbs).toEqual(
      sim.progression.orbs,
    );
  });
  it("grinds a right-slot book back into one ordinary book without duplicating it", () => {
    const { sim } = setup("grindstone");
    sim.craftSlots[1] = {
      id: "enchanted_book",
      count: 1,
      enchantments: { silk_touch: 1 },
      customName: "旧知识",
    };
    sim.takeWorkshopOutput(true);
    expect(sim.craftSlots).toEqual([null, null]);
    expect(sim.player.inventory[0]).toMatchObject({
      id: "book",
      count: 1,
      customName: "旧知识",
    });
  });
  it("keeps named furnace output separate from unnamed new products", () => {
    const { sim } = setup();
    sim.closeContainer();
    sim.setBlock(0, 1, 0, 14);
    sim.containers["0,1,0"] = {
      kind: "furnace",
      slots: [
        { id: "raw_iron", count: 1 },
        { id: "coal", count: 1 },
        { id: "iron_ingot", count: 1, customName: "纪念铁" },
      ],
      burn: 0,
      burnTotal: 0,
      progress: 0,
    };
    const idle = {
      forward: 0,
      right: 0,
      jump: false,
      sprint: false,
      sneak: false,
    };
    for (let n = 0; n < 660; n++) sim.step(1 / 60, idle);
    expect(sim.containers["0,1,0"].slots.map((s) => s?.count)).toEqual([
      1, 1, 1,
    ]);
  });
});

describe("anvil falling persists one owner and one impact", () => {
  it("keeps anvils and enchanting tables intact in a creeper blast", () => {
    const { sim } = setup();
    sim.closeContainer();
    sim.setBlock(0, 1, 0, 112);
    sim.setBlock(1, 1, 0, 114);
    sim.setBlock(-1, 1, 0, 117);
    sim.setBlock(0, 1, 1, 118);
    sim.setBlock(0, 1, -1, 11);
    sim.explode({ x: 0.5, y: 1.5, z: 0.5 });
    expect(sim.world.getBlock(0, 1, 0)).toBe(112);
    expect(sim.world.getBlock(1, 1, 0)).toBe(114);
    expect(sim.world.getBlock(-1, 1, 0)).toBe(117);
    expect(sim.world.getBlock(0, 1, 1)).toBe(118);
    expect(sim.world.getBlock(0, 1, -1)).toBe(0);
  });
  it("applies the version 1.21.1 extra helmet wear and break handling", () => {
    const { sim } = setup();
    sim.player.armor.head = { id: "iron_helmet", count: 1, durability: 100 };
    sim.damage(8, "anvil");
    expect(sim.player.armor.head?.durability).toBe(97);
    const { sim: fragile } = setup();
    fragile.player.armor.head = {
      id: "iron_helmet",
      count: 1,
      durability: 1,
      enchantments: { protection: 4 },
    };
    fragile.damage(8, "anvil");
    expect(fragile.player.armor.head).toBeNull();
    expect(fragile.player.health).toBeCloseTo(14.096);
  });
  it("supports stacked anvils instead of dropping the upper anvil as an item", () => {
    const { sim } = setup();
    sim.closeContainer();
    sim.setBlock(3, 1, 0, 114);
    sim.setBlock(3, 2, 0, 116);
    for (let n = 0; n < 10; n++) sim.natural.step(0.1, sim.player.position, 1);
    expect(sim.world.getBlock(3, 2, 0)).toBe(116);
    expect(sim.drops).toEqual([]);
  });
  it("resumes a moving anvil checkpoint with its original fall distance", () => {
    const { sim, world } = setup();
    sim.closeContainer();
    sim.setBlock(3, 7, 0, 115);
    sim.natural.step(0.1, sim.player.position, 1);
    expect(world.getBlock(3, 6, 0)).toBe(115);
    const saved = validateSave(sim.snapshot());
    expect(saved.natural?.anvilFalls).toContainEqual({
      x: 3,
      y: 6,
      z: 0,
      distance: 1,
    });
    const copyWorld = new World(saved.changes),
      impacts: number[] = [];
    const natural = new NaturalUpdatesSystem(
      copyWorld,
      "workshops",
      saved.natural,
      {
        setBlock: (x, y, z, id) => {
          copyWorld.setBlock(x, y, z, id);
          return true;
        },
        dropItem: () => {
          throw new Error("unexpected drop");
        },
        anvilImpact: (_p, distance) => impacts.push(distance),
      },
    );
    for (let n = 0; n < 30; n++) natural.step(0.1, { x: 3, y: 2, z: 0 }, 1);
    expect(impacts).toEqual([6]);
    expect([115, 117]).toContain(copyWorld.getBlock(3, 1, 0));
    expect(natural.snapshot().anvilFalls).toBeUndefined();
    expect(natural.snapshot().falling).toEqual([]);
  });
  it("waits at unloaded boundary and external removal cannot leave ghost fall records", () => {
    const { sim, world } = setup();
    sim.closeContainer();
    sim.setBlock(3, 5, 0, 114);
    sim.natural.step(0.1, sim.player.position, 1);
    world.unavailable.add("3,3,0");
    for (let n = 0; n < 10; n++) sim.natural.step(0.1, sim.player.position, 1);
    expect(world.getBlock(3, 4, 0)).toBe(114);
    expect(sim.natural.snapshot().anvilFalls?.[0].distance).toBe(1);
    sim.setBlock(3, 4, 0, 0);
    expect(sim.natural.snapshot().anvilFalls).toBeUndefined();
    expect(validateSave(sim.snapshot()).natural?.falling).toEqual([]);
  });
  it("damages a player and an animal under a falling anvil, with no passive XP farming", () => {
    const { sim } = setup();
    sim.closeContainer();
    sim.player.position = { x: 3.5, y: 1, z: 0.5 };
    sim.entities = [
      {
        id: "cow-under-anvil",
        kind: "cow",
        position: { ...sim.player.position },
        health: 10,
        yaw: 0,
        timer: 10,
      },
    ];
    sim.setBlock(3, 7, 0, 114);
    const xp = totalXp(sim);
    for (let n = 0; n < 20; n++) sim.natural.step(0.1, sim.player.position, 1);
    expect(sim.player.health).toBe(10);
    expect(sim.entities).toEqual([]);
    expect(sim.drops.some((d) => d.stack.id === "raw_beef")).toBe(true);
    expect(totalXp(sim)).toBe(xp);
    for (let n = 0; n < 10; n++) sim.natural.step(0.1, sim.player.position, 1);
    expect(sim.player.health).toBe(10);
  });
});
