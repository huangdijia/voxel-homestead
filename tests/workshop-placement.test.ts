import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { Simulation, createNewSave } from "../src/game/Simulation";
import { validateSave } from "../src/game/storage";
import { workshopBlockState } from "../src/engine/shapes";
import type {
  BlockChange,
  ItemStack,
  Vec3,
  WorldPort,
} from "../src/game/types";

class PlacementWorld implements WorldPort {
  blocks = new Map<string, BlockChange>();
  constructor(changes: BlockChange[] = []) {
    changes.forEach((p) => this.setBlock(p.x, p.y, p.z, p.id));
  }
  getBlock(x: number, y: number, z: number) {
    const [bx, by, bz] = [Math.floor(x), Math.floor(y), Math.floor(z)];
    return this.blocks.get(`${bx},${by},${bz}`)?.id ?? (by <= 0 ? 3 : 0);
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
const stand = [
  { x: 0.5, y: 1, z: -2.5 },
  { x: 3.5, y: 1, z: 0.5 },
  { x: 0.5, y: 1, z: 3.5 },
  { x: -2.5, y: 1, z: 0.5 },
];
function setup(stack: ItemStack, facing = 2) {
  const world = new PlacementWorld();
  const save = createNewSave(
    "工作站放置验收",
    "workshop-placement",
    "survival",
  );
  save.player.position = { ...stand[facing] };
  save.player.spawn = { ...save.player.position };
  save.player.inventory[0] = structuredClone(stack);
  save.player.inventory[8] = { id: "iron_pickaxe", count: 1, durability: 250 };
  return { sim: new Simulation(world, save), world };
}
function aim(sim: Simulation, point: Vec3) {
  const eye = sim.eye(),
    dx = point.x - eye.x,
    dy = point.y - eye.y,
    dz = point.z - eye.z;
  sim.player.yaw = Math.atan2(-dx, -dz);
  sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
function placeOnGround(sim: Simulation) {
  aim(sim, { x: 0.5, y: 1, z: 0.5 });
  expect(sim.target()).toMatchObject({
    id: 3,
    position: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
  });
  sim.interact();
}
function breakWithPick(sim: Simulation, at: Vec3) {
  sim.closeContainer();
  sim.player.selected = 8;
  sim.breakBlock(at);
}

describe("actual anvil placement follows player orientation", () => {
  it.each([
    ["anvil", 0, 115],
    ["anvil", 1, 114],
    ["chipped_anvil", 2, 117],
    ["chipped_anvil", 3, 116],
    ["damaged_anvil", 0, 119],
    ["damaged_anvil", 1, 118],
  ] as const)(
    "places %s from facing %i as state %i and opens the placed block",
    (item, facing, id) => {
      const { sim, world } = setup({ id: item, count: 1 }, facing);
      placeOnGround(sim);
      expect(world.getBlock(0, 1, 0)).toBe(id);
      expect(sim.held).toBeNull();
      aim(sim, { x: 0.5, y: 1.8, z: 0.5 });
      expect(sim.target()?.id).toBe(id);
      sim.interact();
      expect(sim.station).toBe("anvil");
      expect(sim.getWorkshop()?.kind).toBe("anvil");
      expect(workshopBlockState(id)).toMatchObject({
        kind: "anvil",
        axis: facing % 2 === 0 ? 1 : 0,
      });
    },
  );
});

describe("actual grindstone placement preserves all twelve attachment states", () => {
  for (const attachment of ["floor", "wall", "ceiling"] as const)
    it.each([0, 1, 2, 3])(
      `places ${attachment} facing %i, opens it and reloads the same state`,
      (facing) => {
        const { sim, world } = setup({ id: "grindstone", count: 1 }, facing);
        let at: Vec3;
        if (attachment === "floor") {
          placeOnGround(sim);
          at = { x: 0, y: 1, z: 0 };
        } else if (attachment === "ceiling") {
          sim.setBlock(0, 4, 0, 3);
          aim(sim, { x: 0.5, y: 4, z: 0.5 });
          expect(sim.target()).toMatchObject({
            position: { x: 0, y: 4, z: 0 },
            normal: { x: 0, y: -1, z: 0 },
          });
          sim.interact();
          at = { x: 0, y: 3, z: 0 };
        } else {
          sim.setBlock(0, 2, 0, 3);
          aim(sim, { x: 0.5, y: 2.5, z: 0.5 });
          const normal = [
            { x: 0, y: 0, z: -1 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: -1, y: 0, z: 0 },
          ][facing];
          expect(sim.target()).toMatchObject({
            position: { x: 0, y: 2, z: 0 },
            normal,
          });
          sim.interact();
          at = { x: normal.x, y: 2, z: normal.z };
        }
        const id = world.getBlock(at.x, at.y, at.z);
        expect(workshopBlockState(id)).toEqual({
          kind: "grindstone",
          attachment,
          facing,
        });
        expect(sim.held).toBeNull();
        aim(sim, { x: at.x + 0.5, y: at.y + 0.53, z: at.z + 0.5 });
        expect(sim.target()?.id).toBe(id);
        sim.interact();
        expect(sim.station).toBe("grindstone");
        const checkpoint = validateSave(sim.snapshot());
        const reloaded = new Simulation(
          new PlacementWorld(checkpoint.changes),
          checkpoint,
        );
        expect(reloaded.world.getBlock(at.x, at.y, at.z)).toBe(id);
        aim(reloaded, { x: at.x + 0.5, y: at.y + 0.53, z: at.z + 0.5 });
        reloaded.interact();
        expect(reloaded.station).toBe("grindstone");
      },
    );
});

describe("actual stone slab placement and harvesting conserve both halves", () => {
  it.each(["bottom", "top"] as const)(
    "places the %s half, fills it with a second slab and drops exactly two",
    (half) => {
      const { sim, world } = setup({ id: "stone_slab", count: 2 });
      const at = { x: 0, y: half === "bottom" ? 1 : 3, z: 0 };
      if (half === "bottom") placeOnGround(sim);
      else {
        sim.setBlock(0, 4, 0, 3);
        aim(sim, { x: 0.5, y: 4, z: 0.5 });
        expect(sim.target()?.normal.y).toBe(-1);
        sim.interact();
      }
      const single = half === "bottom" ? 132 : 133;
      expect(world.getBlock(at.x, at.y, at.z)).toBe(single);
      expect(sim.held?.count).toBe(1);
      aim(sim, { x: 0.5, y: at.y + 0.5, z: 0.5 });
      expect(sim.target()).toMatchObject({
        id: single,
        position: at,
        normal: { x: 0, y: half === "bottom" ? 1 : -1, z: 0 },
      });
      sim.interact();
      expect(world.getBlock(at.x, at.y, at.z)).toBe(134);
      expect(sim.held).toBeNull();
      const checkpoint = validateSave(sim.snapshot());
      const reload = new Simulation(
        new PlacementWorld(checkpoint.changes),
        checkpoint,
      );
      breakWithPick(reload, at);
      expect(reload.drops.map((drop) => drop.stack)).toEqual([
        { id: "stone_slab", count: 2 },
      ]);
      expect(reload.world.getBlock(at.x, at.y, at.z)).toBe(0);
      expect(reload.held?.durability).toBe(249);
      reload.breakBlock(at);
      expect(reload.drops).toHaveLength(1);
      expect(validateSave(reload.snapshot()).drops[0].stack.count).toBe(2);
    },
  );
  it.each([
    [1.25, 132],
    [1.75, 133],
  ])("uses side-hit height %s for a new slab state %s", (height, expected) => {
    const { sim, world } = setup({ id: "stone_slab", count: 1 });
    sim.setBlock(0, 1, 0, 3);
    aim(sim, { x: 0.5, y: height, z: 0.9999 });
    expect(sim.target()).toMatchObject({
      position: { x: 0, y: 1, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
    });
    sim.interact();
    expect(world.getBlock(0, 1, 1)).toBe(expected);
    expect(sim.held).toBeNull();
  });
});

describe("named containers keep identity and contents through real placement and checkpoint reload", () => {
  it.each([
    ["chest", 15, "山谷藏书"],
    ["furnace", 14, "山谷熔炉"],
  ] as const)(
    "places and opens %s, then preserves name and contents when harvested after reload",
    (id, block, name) => {
      const { sim, world } = setup({ id, count: 1, customName: name });
      const onOpen = vi.fn();
      sim.onOpen = onOpen;
      placeOnGround(sim);
      expect(world.getBlock(0, 1, 0)).toBe(block);
      expect(sim.held).toBeNull();
      aim(sim, { x: 0.5, y: 1.5, z: 0.5 });
      sim.interact();
      expect(onOpen).toHaveBeenCalledWith(id);
      expect(sim.container).toMatchObject({ kind: id, customName: name });
      const contents: ItemStack[] =
        id === "chest"
          ? [
              { id: "book", count: 4, customName: "藏书" },
              {
                id: "diamond_pickaxe",
                count: 1,
                durability: 1500,
                customName: "远山",
                repairCost: 3,
                enchantments: { efficiency: 4 },
              },
            ]
          : [
              { id: "raw_iron", count: 3, customName: "山脉粗铁" },
              { id: "coal", count: 2 },
            ];
      contents.forEach((stack, index) => {
        sim.player.inventory[index + 1] = structuredClone(stack);
        sim.clickSlot("inventory", index + 1);
        sim.clickSlot("container", index);
        expect(sim.cursor).toBeNull();
      });
      expect(sim.container?.slots.filter(Boolean)).toEqual(contents);
      const saved = validateSave(sim.snapshot());
      expect(saved.containers["0,1,0"]).toMatchObject({
        kind: id,
        customName: name,
      });
      expect(saved.containers["0,1,0"].slots.filter(Boolean)).toEqual(contents);
      const reload = new Simulation(new PlacementWorld(saved.changes), saved);
      aim(reload, { x: 0.5, y: 1.5, z: 0.5 });
      reload.interact();
      expect(reload.container).toMatchObject({ kind: id, customName: name });
      expect(reload.container?.slots.filter(Boolean)).toEqual(contents);
      breakWithPick(reload, { x: 0, y: 1, z: 0 });
      expect(reload.world.getBlock(0, 1, 0)).toBe(0);
      expect(reload.containers["0,1,0"]).toBeUndefined();
      expect(reload.drops.map((drop) => drop.stack)).toEqual([
        ...contents,
        { id, count: 1, customName: name },
      ]);
      const broken = validateSave(reload.snapshot());
      expect(broken.containers).toEqual({});
      expect(broken.drops.map((drop) => drop.stack)).toEqual([
        ...contents,
        { id, count: 1, customName: name },
      ]);
      reload.breakBlock({ x: 0, y: 1, z: 0 });
      expect(reload.drops).toHaveLength(contents.length + 1);
    },
  );
});
