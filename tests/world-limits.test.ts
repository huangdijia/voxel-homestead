import { describe, expect, it } from "vitest";
import { Simulation, createNewSave } from "../src/game/Simulation";
import { countItem } from "../src/game/inventory";
import { validateSave } from "../src/game/storage";
import { WORLD_MAX_Y, WORLD_MIN_Y } from "../src/engine/generator";
import type { BlockChange, Vec3, WorldPort } from "../src/game/types";

/** Mirrors real world height rejection while keeping procedural floor data readable in unloaded columns. */
class BoundedWorld implements WorldPort {
  private changes = new Map<string, BlockChange>();
  constructor(
    private readonly groundY: number,
    private readonly readyThroughZ = Infinity,
  ) {}
  getBlock(x: number, y: number, z: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < WORLD_MIN_Y) return 24;
    if (y > WORLD_MAX_Y) return 0;
    return (
      this.changes.get(`${x},${y},${z}`)?.id ?? (y <= this.groundY ? 3 : 0)
    );
  }
  setBlock(x: number, y: number, z: number, id: number): void {
    // VoxelWorld rejects out-of-height writes, but accepts edits to unloaded chunks.
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) return;
    this.changes.set(`${x},${y},${z}`, { x, y, z, id });
  }
  isReady(_x: number, z: number): boolean {
    return z < this.readyThroughZ;
  }
  getSurface(): number {
    return this.groundY;
  }
  getChanges(): BlockChange[] {
    return [...this.changes.values()];
  }
}
function makeSim(
  world: BoundedWorld,
  position: Vec3,
  item: "bed" | "door",
): Simulation {
  const save = createNewSave("边界验收", "world-limits", "survival");
  save.player.position = { ...position };
  save.player.spawn = { ...position };
  save.player.velocity = { x: 0, y: 0, z: 0 };
  save.player.inventory[0] = { id: item, count: 1 };
  return new Simulation(world, save);
}
function aim(sim: Simulation, point: Vec3): void {
  const eye = sim.eye(),
    dx = point.x - eye.x,
    dy = point.y - eye.y,
    dz = point.z - eye.z;
  sim.player.yaw = Math.atan2(-dx, -dz);
  sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

describe("multi-block placement is atomic across world boundaries", () => {
  it("rejects a door with its foot at y=95 and head outside the world, preserving the item and both positions", () => {
    const world = new BoundedWorld(94);
    const sim = makeSim(world, { x: 0.5, y: 95, z: 0.5 }, "door");
    aim(sim, { x: 0.5, y: 94.999, z: -1.5 });
    expect(sim.target()?.position).toEqual({ x: 0, y: 94, z: -2 });
    sim.interact();
    expect({
      doors: countItem(sim.player.inventory, "door"),
      foot: world.getBlock(0, 95, -2),
      head: world.getBlock(0, 96, -2),
      changes: world.getChanges(),
    }).toEqual({ doors: 1, foot: 0, head: 0, changes: [] });
  });

  it("still places a door whose head is exactly at the valid upper limit y=95", () => {
    const world = new BoundedWorld(93);
    const sim = makeSim(world, { x: 0.5, y: 94, z: 0.5 }, "door");
    aim(sim, { x: 0.5, y: 93.999, z: -1.5 });
    sim.interact();
    expect(world.getBlock(0, 94, -2)).toBe(18);
    expect(world.getBlock(0, 95, -2)).toBe(25);
    expect(countItem(sim.player.inventory, "door")).toBe(0);
  });

  it("rejects a bed crossing from a loaded column into an unloaded column without consuming it", () => {
    const world = new BoundedWorld(0, 16);
    const sim = makeSim(world, { x: 0.5, y: 1, z: 12.5 }, "bed");
    expect(world.isReady(0, 15)).toBe(true);
    expect(world.isReady(0, 16)).toBe(false);
    aim(sim, { x: 0.5, y: 0.999, z: 15.5 });
    expect(sim.target()?.position).toEqual({ x: 0, y: 0, z: 15 });
    sim.interact();
    expect({
      beds: countItem(sim.player.inventory, "bed"),
      foot: world.getBlock(0, 1, 15),
      head: world.getBlock(0, 1, 16),
      changes: world.getChanges(),
    }).toEqual({ beds: 1, foot: 0, head: 0, changes: [] });
  });

  it("places the same cross-column bed when both columns are loaded", () => {
    const world = new BoundedWorld(0);
    const sim = makeSim(world, { x: 0.5, y: 1, z: 12.5 }, "bed");
    aim(sim, { x: 0.5, y: 0.999, z: 15.5 });
    sim.interact();
    expect(world.getBlock(0, 1, 15)).toBe(22);
    expect(world.getBlock(0, 1, 16)).toBe(27);
    expect(countItem(sim.player.inventory, "bed")).toBe(0);
  });
});

describe("imported block modifications respect the playable world height", () => {
  it.each([-17, 96])("rejects a modification at out-of-world y=%i", (y) => {
    const save = createNewSave("无效高度导入", "world-limits", "survival");
    save.changes = [{ x: 0, y, z: 0, id: 3 }];
    const imported = JSON.parse(JSON.stringify(save));
    expect(() => validateSave(imported)).toThrow();
  });

  it.each([-16, 95])("accepts a modification exactly at boundary y=%i", (y) => {
    const save = createNewSave("有效高度导入", "world-limits", "survival");
    save.changes = [{ x: -1, y, z: 16, id: y === -16 ? 24 : 11 }];
    expect(validateSave(JSON.parse(JSON.stringify(save))).changes).toEqual(
      save.changes,
    );
  });
});
