import { describe, expect, it } from "vitest";
import { WORLD_MAX_Y, WORLD_MIN_Y } from "../src/engine/world-height";
import { FarmingSystem, FARMLAND, type FarmState } from "../src/game/farming";
import {
  FluidSystem,
  FLUID_QUEUE_LIMIT,
  type FluidState,
} from "../src/game/fluids";
import { fluidInfo } from "../src/game/fluid-blocks";
import {
  NaturalUpdatesSystem,
  NATURAL_QUEUE_MAX,
  type NaturalState,
} from "../src/game/natural-updates";
import type {
  BlockChange,
  ItemStack,
  Vec3,
  WorldPort,
} from "../src/game/types";

const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
class HeightWorld implements WorldPort {
  blocks = new Map<string, BlockChange>();
  writes: BlockChange[] = [];
  ready = (_x: number, _y: number, _z: number) => true;
  base = (_x: number, _y: number, _z: number): number => 0;
  hasSkyAccess?: (x: number, y: number, z: number) => boolean;
  isReady(x: number, z: number, y?: number): boolean {
    if (y === undefined)
      throw new Error("A rule omitted the height of its readiness check");
    return y >= WORLD_MIN_Y && y <= WORLD_MAX_Y && this.ready(x, y, z);
  }
  getBlock(x: number, y: number, z: number): number {
    if (!this.isReady(x, z, y))
      throw new Error(`Read from unavailable voxel ${x},${y},${z}`);
    return this.blocks.get(`${x},${y},${z}`)?.id ?? this.base(x, y, z);
  }
  setBlock(x: number, y: number, z: number, id: number): void {
    if (!this.isReady(x, z, y))
      throw new Error(`Write to unavailable voxel ${x},${y},${z}`);
    this.put({ x, y, z }, id);
    this.writes.push({ x, y, z, id });
  }
  put(p: Vec3, id: number): void {
    this.blocks.set(key(p), { ...p, id });
  }
  getSurface(): number {
    return 63;
  }
  getChanges(): BlockChange[] {
    return [...this.blocks.values()].map((p) => ({ ...p }));
  }
  clone(): HeightWorld {
    const copy = new HeightWorld();
    copy.blocks = new Map(this.getChanges().map((p) => [key(p), p]));
    copy.base = this.base;
    copy.ready = this.ready;
    copy.hasSkyAccess = this.hasSkyAccess;
    return copy;
  }
}
const playerAt = (y: number): Vec3 => ({ x: -0.5, y, z: -0.5 });
function fluids(world = new HeightWorld(), saved?: FluidState) {
  const system = new FluidSystem(world, saved, {
    setBlock(x, y, z, id) {
      world.setBlock(x, y, z, id);
      return true;
    },
  });
  const edit = (p: Vec3, id: number) => {
    const old = world.getBlock(p.x, p.y, p.z);
    world.setBlock(p.x, p.y, p.z, id);
    system.notifyBlockChanged(p, old, id);
  };
  return { world, system, edit };
}
function natural(world = new HeightWorld(), saved?: NaturalState) {
  const drops: Array<{ position: Vec3; stack: ItemStack }> = [];
  const system = new NaturalUpdatesSystem(world, "height-natural", saved, {
    setBlock(x, y, z, id) {
      world.setBlock(x, y, z, id);
      return true;
    },
    dropItem(position, stack) {
      drops.push({ position, stack });
    },
  });
  const edit = (p: Vec3, id: number) => {
    const old = world.getBlock(p.x, p.y, p.z);
    world.setBlock(p.x, p.y, p.z, id);
    system.notifyBlockChanged(p, old, id);
  };
  const plant = (p: Vec3) => {
    edit({ ...p, y: p.y - 1 }, 2);
    edit(p, 83);
  };
  return { world, system, edit, plant, drops };
}
function farming(world = new HeightWorld(), saved?: FarmState) {
  const drops: Array<{ stack: ItemStack; position: Vec3 }> = [];
  const system = new FarmingSystem(world, "height-farm", saved, {
    dropItem(stack, position) {
      drops.push({ stack, position });
    },
  });
  const edit = (p: Vec3, id: number) => {
    const old = world.getBlock(p.x, p.y, p.z);
    world.setBlock(p.x, p.y, p.z, id);
    system.notifyBlockChanged(p, old, id);
  };
  const plant = (y: number) => {
    edit({ x: -1, y, z: -1 }, FARMLAND.dry);
    edit({ x: -1, y: y + 1, z: -1 }, 30);
    edit({ x: 0, y, z: -1 }, 6);
  };
  return { world, system, edit, plant, drops };
}
function advance(
  system: { step(dt: number, p: Vec3, daylight: number): void },
  seconds: number,
  y: number,
  daylight = 15,
) {
  for (let i = 0; i < Math.round(seconds / 0.05); i++)
    system.step(0.05, playerAt(y), daylight);
}
function at(y: number): Vec3 {
  return { x: -1, y, z: -1 };
}

describe("water and lava throughout the expanded world", () => {
  it.each([
    [6, -64],
    [6, 319],
    [76, -64],
    [76, 319],
  ])(
    "source %i spreads at the legal height %i without touching outside voxels",
    (id, y) => {
      const world = new HeightWorld();
      world.base = (_x, by) => (by < y ? 3 : 0);
      const f = fluids(world);
      f.edit(at(y), id);
      advance(f.system, 2, y);
      expect(fluidInfo(world.getBlock(0, y, -1))?.kind).toBe(
        id === 6 ? "water" : "lava",
      );
      expect(
        world.writes.every((p) => p.y >= WORLD_MIN_Y && p.y <= WORLD_MAX_Y),
      ).toBe(true);
      expect(f.system.pendingCount).toBeLessThanOrEqual(FLUID_QUEUE_LIMIT);
    },
  );

  it.each([
    [6, -61],
    [6, 319],
    [76, -61],
    [76, 319],
  ])("source %i descends in a new vertical region starting at %i", (id, y) => {
    const world = new HeightWorld();
    world.base = (x, by, z) => (by < y - 2 || x !== -1 || z !== -1 ? 3 : 0);
    const f = fluids(world);
    f.edit(at(y), id);
    advance(f.system, 5, y);
    expect(world.getBlock(-1, y - 2, -1)).toBe(id === 6 ? 75 : 80);
  });

  it("preserves an existing flow whose supply is in an unloaded vertical section", () => {
    const world = new HeightWorld();
    world.base = (x, y, z) => (x !== -1 || z !== -1 || y < 126 ? 3 : 0);
    world.put(at(128), 6);
    world.put(at(127), 75);
    world.ready = (_x, y) => y < 128;
    const f = fluids(world);
    advance(f.system, 3, 127);
    expect(world.getBlock(-1, 127, -1)).toBe(75);
    // The known loaded flow can feed another loaded cell; it must not be erased
    // merely because its own upstream source is currently outside residence.
    expect(world.getBlock(-1, 126, -1)).toBe(75);
    expect(f.system.pendingCount).toBeGreaterThan(0);
    world.ready = () => true;
    advance(f.system, 3, 127);
    expect(world.getBlock(-1, 126, -1)).toBe(75);
  });

  it("waits before descending or spreading when the source's lower section is unavailable", () => {
    const world = new HeightWorld();
    world.base = (_x, y) => (y < 126 ? 3 : 0);
    const f = fluids(world);
    f.edit(at(128), 6);
    world.ready = (_x, y) => y >= 128;
    advance(f.system, 2, 128);
    expect(world.getBlock(-1, 128, -1)).toBe(6);
    expect(world.getBlock(0, 128, -1)).toBe(0);
    expect(world.writes.every((p) => p.y >= 128)).toBe(true);
    world.ready = () => true;
    advance(f.system, 2, 128);
    expect(world.getBlock(-1, 126, -1)).toBe(75);
  });

  it.each([-60, 300])(
    "replays a saved flowing world and its source withdrawal at height %i",
    (y) => {
      const world = new HeightWorld();
      world.base = (_x, by) => (by < y ? 3 : 0);
      const a = fluids(world);
      a.edit(at(y), 6);
      advance(a.system, 0.55, y);
      const b = fluids(
        world.clone(),
        JSON.parse(JSON.stringify(a.system.snapshot())),
      );
      a.edit(at(y), 0);
      b.edit(at(y), 0);
      advance(a.system, 10, y);
      advance(b.system, 10, y);
      expect(b.system.snapshot()).toEqual(a.system.snapshot());
      expect(b.world.getChanges()).toEqual(a.world.getChanges());
      expect(a.world.getChanges().filter((p) => fluidInfo(p.id))).toEqual([]);
    },
  );
});

describe("falling blocks and trees respect vertical loading", () => {
  it.each([-61, 319])(
    "restores pending falling ownership at height %i without duplicating its voxel",
    (y) => {
      const world = new HeightWorld();
      world.base = (_x, by) => (by < y - 1 ? 3 : 0);
      world.ready = () => false;
      const state: NaturalState = {
        version: 1,
        randomState: 123,
        accumulator: 0,
        scanCursor: 0,
        queue: [],
        falling: [{ ...at(y), id: 5 }],
      };
      const a = natural(world, state);
      advance(a.system, 1, y);
      expect(a.system.snapshot().falling).toEqual(state.falling);
      expect(world.writes).toEqual([]);
      const b = natural(
        world.clone(),
        JSON.parse(JSON.stringify(a.system.snapshot())),
      );
      world.ready = () => true;
      b.world.ready = () => true;
      advance(a.system, 2, y);
      advance(b.system, 2, y);
      expect(world.getBlock(-1, y - 1, -1)).toBe(5);
      expect(world.getChanges().filter((p) => p.id === 5)).toHaveLength(1);
      expect(a.system.snapshot().falling).toEqual([]);
      expect(b.world.getChanges()).toEqual(world.getChanges());
      expect(b.system.snapshot()).toEqual(a.system.snapshot());
      expect(a.drops).toEqual([]);
    },
  );

  it.each([-61, 319])(
    "drops sand through the new height %i and preserves one owner after reload",
    (y) => {
      const world = new HeightWorld();
      world.base = (_x, by) => (by < y - 2 ? 3 : 0);
      const a = natural(world);
      a.edit(at(y), 4);
      advance(a.system, 0.1, y);
      const b = natural(world.clone(), a.system.snapshot());
      advance(a.system, 2, y);
      advance(b.system, 2, y);
      expect(world.getBlock(-1, y - 2, -1)).toBe(4);
      expect(b.world.getChanges()).toEqual(world.getChanges());
      expect(b.system.snapshot()).toEqual(a.system.snapshot());
      expect(world.getChanges().filter((p) => p.id === 4)).toHaveLength(1);
      expect(a.drops).toHaveLength(0);
    },
  );

  it("retains gravel in its original voxel while the lower section is absent", () => {
    const world = new HeightWorld();
    world.base = (_x, y) => (y < 126 ? 3 : 0);
    const f = natural(world);
    f.edit(at(128), 5);
    world.ready = (_x, y) => y >= 128;
    advance(f.system, 1, 128);
    expect(world.getBlock(-1, 128, -1)).toBe(5);
    expect(f.system.snapshot().falling).toEqual([]);
    expect(f.drops).toHaveLength(0);
    world.ready = () => true;
    advance(f.system, 2, 128);
    expect(world.getBlock(-1, 126, -1)).toBe(5);
  });

  it("emits exactly one sand item at the lower edge and never writes below -64", () => {
    const f = natural();
    f.edit(at(WORLD_MIN_Y), 4);
    advance(f.system, 2, WORLD_MIN_Y);
    expect(f.world.getBlock(-1, WORLD_MIN_Y, -1)).toBe(0);
    expect(f.drops.map((drop) => drop.stack)).toEqual([
      { id: "sand", count: 1 },
    ]);
    expect(f.world.writes.every((p) => p.y >= WORLD_MIN_Y)).toBe(true);
  });

  it.each([-63, 314])(
    "grows a complete tree at height %i with valid soil and crown",
    (y) => {
      const f = natural();
      f.plant(at(y));
      expect(f.system.fertilize(at(y), 15)).toBe(true);
      expect(f.world.getBlock(-1, y, -1)).toBe(7);
      expect(f.world.getBlock(-1, y + 5, -1)).toBe(8);
      expect(f.world.getChanges().filter((p) => p.id === 7)).toHaveLength(5);
    },
  );

  it("refuses a crown outside 319 or inside an unloaded layer without consuming a sapling", () => {
    const high = natural();
    high.plant(at(315));
    const before = high.world.getChanges();
    expect(high.system.fertilize(at(315), 15)).toBe(false);
    expect(high.world.getChanges()).toEqual(before);
    const f = natural();
    f.plant(at(125));
    f.world.ready = (_x, y) => y !== 128;
    expect(f.system.fertilize(at(125), 15)).toBe(false);
    expect(f.world.getBlock(-1, 125, -1)).toBe(83);
    expect(f.world.getChanges().filter((p) => p.id === 7)).toHaveLength(0);
    f.world.ready = () => true;
    expect(f.system.fertilize(at(125), 15)).toBe(true);
  });

  it("waits for a leaf support path and a sapling's soil in unloaded vertical sections", () => {
    const f = natural();
    f.edit(at(127), 8);
    f.edit(at(128), 7);
    f.world.ready = (_x, y) => y < 128;
    const rng = f.system.snapshot().randomState;
    advance(f.system, 4, 127);
    expect(f.world.getBlock(-1, 127, -1)).toBe(8);
    expect(f.system.snapshot().randomState).toBe(rng);
    const p = natural();
    p.plant(at(128));
    p.world.ready = (_x, y) => y >= 128;
    advance(p.system, 4, 128);
    expect(p.world.getBlock(-1, 128, -1)).toBe(83);
    expect(p.drops).toHaveLength(0);
  });
});

describe("farming spans deep and high builds", () => {
  it.each([-64, 318])(
    "irrigates and grows a crop above farmland %i, retaining timers over reload",
    (y) => {
      const a = farming();
      a.plant(y);
      advance(a.system, 4, y + 1);
      const b = farming(
        a.world.clone(),
        JSON.parse(JSON.stringify(a.system.snapshot())),
      );
      advance(a.system, 65, y + 1);
      advance(b.system, 65, y + 1);
      expect(a.world.getBlock(-1, y, -1)).toBe(FARMLAND.wet);
      expect(a.world.getBlock(-1, y + 1, -1)).toBeGreaterThan(30);
      expect(b.system.snapshot()).toEqual(a.system.snapshot());
      expect(b.world.getChanges()).toEqual(a.world.getChanges());
      expect(a.drops).toHaveLength(0);
    },
  );

  it("keeps top farmland legal with known air above and dries it without an out-of-world read", () => {
    const f = farming();
    f.edit(at(319), FARMLAND.dry);
    const restored = farming(f.world.clone(), f.system.snapshot());
    advance(restored.system, 11, 319);
    expect(restored.world.getBlock(-1, 319, -1)).toBe(2);
    expect(restored.system.size).toBe(0);
    expect(restored.drops).toHaveLength(0);
  });

  it("does not advance irrigation or growth when a neighboring crop layer is unloaded", () => {
    const f = farming();
    f.plant(127);
    f.world.ready = (_x, y) => y < 128;
    const initial = f.system.snapshot().plots[0];
    advance(f.system, 80, 127);
    expect(f.system.snapshot().plots[0]).toMatchObject({
      moisture: initial.moisture,
      growthRemaining: initial.growthRemaining,
      drySeconds: initial.drySeconds,
      active: false,
    });
    expect(f.world.getBlock(-1, 127, -1)).toBe(FARMLAND.dry);
    f.world.ready = () => true;
    advance(f.system, 65, 128);
    expect(f.world.getBlock(-1, 128, -1)).toBeGreaterThan(30);
  });

  it("preserves an orphan crop until its section loads then drops it once", () => {
    const f = farming();
    f.plant(127);
    f.world.ready = (_x, y) => y < 128;
    f.edit(at(127), 2);
    advance(f.system, 2, 127);
    expect(f.system.size).toBe(1);
    expect(f.drops).toHaveLength(0);
    f.world.ready = () => true;
    advance(f.system, 2, 128);
    expect(f.world.getBlock(-1, 128, -1)).toBe(0);
    expect(f.drops.map((drop) => drop.stack)).toEqual([
      { id: "wheat_seeds", count: 1 },
    ]);
    expect(f.system.size).toBe(0);
  });

  it("fertilizes a crop at 319 but refuses missing soil or an unavailable cover layer", () => {
    const high = farming();
    high.plant(318);
    expect(high.system.fertilize(at(319))).toBe(true);
    expect(high.world.getBlock(-1, 319, -1)).toBeGreaterThan(30);
    const f = farming();
    f.plant(126);
    f.world.ready = (_x, y) => y !== 128;
    const before = f.system.snapshot();
    expect(f.system.fertilize(at(127))).toBe(false);
    expect(f.system.snapshot()).toEqual(before);
    f.world.ready = (_x, y) => y !== 126;
    expect(f.system.fertilize(at(127))).toBe(false);
  });
});

describe("full-height light and state boundaries", () => {
  it("detects a roof at 300 above crops and trees below the former ceiling", () => {
    const f = farming();
    f.plant(90);
    f.edit(at(300), 3);
    advance(f.system, 80, 91);
    expect(f.world.getBlock(-1, 91, -1)).toBe(30);
    const n = natural();
    n.plant(at(90));
    n.edit(at(300), 3);
    expect(n.system.fertilize(at(90), 15)).toBe(false);
  });

  it("uses authoritative sky access without requiring every high section to be resident", () => {
    const f = farming();
    f.plant(63);
    f.world.ready = (_x, y) => y >= 48 && y < 80;
    f.world.hasSkyAccess = () => true;
    advance(f.system, 65, 64);
    expect(f.world.getBlock(-1, 64, -1)).toBeGreaterThan(30);
    const n = natural();
    n.plant(at(64));
    n.world.ready = (_x, y) => y >= 48 && y < 80;
    n.world.hasSkyAccess = () => true;
    expect(n.system.fertilize(at(64), 15)).toBe(true);
  });

  it("does not presume daylight through an unknown vertical layer in a world without sky access", () => {
    const f = farming();
    f.plant(63);
    f.world.ready = (_x, y) => y < 128;
    advance(f.system, 80, 64);
    expect(f.world.getBlock(-1, 64, -1)).toBe(30);
    const n = natural();
    n.plant(at(64));
    n.world.ready = (_x, y) => y < 128;
    expect(n.system.fertilize(at(64), 15)).toBe(false);
  });

  it.each([-65, 320])(
    "ignores external out-of-world height %i and rejects it in saved rule state",
    (y) => {
      const f = fluids();
      f.system.notifyBlockChanged(at(y), 0, 6);
      expect(f.system.pendingCount).toBe(0);
      expect(() =>
        fluids(new HeightWorld(), {
          version: 1,
          clock: 0,
          scanCursor: 0,
          tasks: [{ ...at(y), kind: "water", due: 0.25 }],
        }),
      ).toThrow();
      const n = natural();
      n.system.notifyBlockChanged(at(y), 0, 4);
      expect(n.system.snapshot().queue).toEqual([]);
      expect(n.system.fertilize(at(y), 15)).toBe(false);
      expect(() =>
        natural(new HeightWorld(), { ...n.system.snapshot(), queue: [at(y)] }),
      ).toThrow();
      const a = farming();
      a.system.notifyBlockChanged(at(y), 0, FARMLAND.dry);
      expect(a.system.size).toBe(0);
      expect(a.system.fertilize(at(y))).toBe(false);
      a.plant(0);
      const saved = a.system.snapshot();
      saved.plots[0].y = y;
      expect(() => farming(new HeightWorld(), saved)).toThrow();
      expect(n.world.writes).toEqual([]);
    },
  );

  it("keeps discovery queues bounded when notifications span the complete vertical range", () => {
    const f = fluids(),
      n = natural();
    for (let index = 0; index < FLUID_QUEUE_LIMIT + 20; index++) {
      const p = { x: 1000 + index, y: WORLD_MIN_Y + (index % 384), z: -1 };
      f.system.notifyBlockChanged(p, 0, 6);
      n.system.notifyBlockChanged(p, 0, 4);
    }
    expect(f.system.pendingCount).toBeLessThanOrEqual(FLUID_QUEUE_LIMIT);
    expect(n.system.snapshot().queue.length).toBeLessThanOrEqual(
      NATURAL_QUEUE_MAX,
    );
  });
});
