import { describe, expect, it } from "vitest";
import {
  NATURAL_FALLING_MAX,
  NATURAL_MIN_Y,
  NATURAL_MAX_Y,
  NATURAL_QUEUE_MAX,
  NATURAL_SCAN_BUDGET,
  NATURAL_SCAN_INTERVAL,
  NATURAL_SCAN_SIZE,
  NATURAL_UPDATE_BUDGET,
  NaturalUpdatesSystem,
} from "../src/game/natural-updates";
import type { NaturalState } from "../src/game/natural-updates";
import type {
  BlockChange,
  ItemStack,
  Vec3,
  WorldPort,
} from "../src/game/types";

class NaturalWorld implements WorldPort {
  blocks = new Map<string, BlockChange>();
  reads = 0;
  ground = 0;
  loaded = (_x: number, _z: number) => true;
  getBlock(x: number, y: number, z: number): number {
    if (!this.loaded(x, z)) throw new Error("Read from an unloaded column");
    this.reads++;
    return this.blocks.get(`${x},${y},${z}`)?.id ?? (y <= this.ground ? 3 : 0);
  }
  setBlock(x: number, y: number, z: number, id: number): void {
    this.blocks.set(`${x},${y},${z}`, { x, y, z, id });
  }
  isReady(x: number, z: number): boolean {
    return this.loaded(x, z);
  }
  getSurface(): number {
    return this.ground;
  }
  getChanges(): BlockChange[] {
    return [...this.blocks.values()].map((p) => ({ ...p }));
  }
  clone(): NaturalWorld {
    const other = new NaturalWorld();
    other.ground = this.ground;
    other.loaded = this.loaded;
    other.blocks = new Map(
      this.getChanges().map((p) => [`${p.x},${p.y},${p.z}`, p]),
    );
    return other;
  }
}
type Failure = "reject" | "throw" | "false-after" | "throw-after" | undefined;
function fixture(
  saved?: NaturalState,
  world = new NaturalWorld(),
  seed = "natural-test",
) {
  const drops: Array<{ position: Vec3; stack: ItemStack }> = [];
  const failure = {
    apply: (_x: number, _y: number, _z: number, _id: number): Failure =>
      undefined,
  };
  const system = new NaturalUpdatesSystem(world, seed, saved, {
    setBlock(x, y, z, id) {
      const action = failure.apply(x, y, z, id);
      if (action === "reject") return false;
      if (action === "throw") throw new Error("Injected failed write");
      const oldId = world.getBlock(x, y, z);
      world.setBlock(x, y, z, id);
      // Match the integration contract: callback writes notify synchronously.
      system.notifyBlockChanged({ x, y, z }, oldId, id);
      if (action === "throw-after")
        throw new Error("Injected failure after commit");
      return action !== "false-after";
    },
    dropItem: (position, stack) =>
      drops.push({ position: { ...position }, stack: { ...stack } }),
  });
  const edit = (x: number, y: number, z: number, id: number) => {
    const oldId = world.getBlock(x, y, z);
    world.setBlock(x, y, z, id);
    system.notifyBlockChanged({ x, y, z }, oldId, id);
  };
  const plant = (p: Vec3 = { x: 0, y: 1, z: 0 }) => {
    edit(p.x, p.y - 1, p.z, 2);
    edit(p.x, p.y, p.z, 83);
  };
  return { system, world, drops, edit, failure, plant };
}
const player = { x: 0.5, y: 1, z: 0.5 };
function advance(
  system: NaturalUpdatesSystem,
  ticks: number,
  position = player,
  daylight = 15,
) {
  for (let i = 0; i < ticks; i++)
    system.step(NATURAL_SCAN_INTERVAL, position, daylight);
}
function owned(f: ReturnType<typeof fixture>, id: 4 | 5): number {
  return (
    f.world.getChanges().filter((p) => p.id === id).length +
    f.system.snapshot().falling.filter((p) => p.id === id).length +
    f.drops
      .filter((p) => p.stack.id === (id === 4 ? "sand" : "gravel"))
      .reduce((sum, p) => sum + p.stack.count, 0)
  );
}

describe("falling blocks and ownership", () => {
  it.each([4, 5] as const)(
    "moves block %i by one cell per tick and lands with exactly one owner",
    (id) => {
      const f = fixture();
      f.edit(0, 4, 0, id);
      advance(f.system, 1);
      expect(f.world.getBlock(0, 4, 0)).toBe(0);
      expect(f.world.getBlock(0, 3, 0)).toBe(id);
      expect(owned(f, id)).toBe(1);
      expect(f.system.snapshot().falling).toEqual([]);
      advance(f.system, 20);
      expect(f.world.getBlock(0, 1, 0)).toBe(id);
      expect(owned(f, id)).toBe(1);
      expect(f.drops).toEqual([]);
    },
  );
  it("moves stacked sand and gravel at negative chunk coordinates without swapping or duplicating them", () => {
    const f = fixture();
    f.edit(-16, 2, -17, 4);
    f.edit(-16, 3, -17, 5);
    advance(f.system, 20, { x: -15.5, y: 1, z: -16.5 });
    expect(f.world.getBlock(-16, 1, -17)).toBe(4);
    expect(f.world.getBlock(-16, 2, -17)).toBe(5);
    expect(owned(f, 4)).toBe(1);
    expect(owned(f, 5)).toBe(1);
  });
  it.each([16, 18, 19, 20, 21, 22, 28, 59, 30, 83])(
    "preserves partial support %i and converts falling sand to one item",
    (support) => {
      const f = fixture();
      f.edit(0, -1, 0, 2);
      f.edit(0, 0, 0, support);
      f.edit(0, 1, 0, 4);
      advance(f.system, 2);
      expect(f.world.getBlock(0, 0, 0)).toBe(support);
      expect(f.world.getBlock(0, 1, 0)).toBe(0);
      expect(f.drops.filter((p) => p.stack.id === "sand")).toHaveLength(1);
      expect(owned(f, 4)).toBe(1);
    },
  );
  it.each([6, 68, 75, 76, 80])(
    "displaces fluid %i without losing the falling block",
    (fluid) => {
      const f = fixture();
      f.edit(0, 1, 0, fluid);
      f.edit(0, 2, 0, 5);
      advance(f.system, 3);
      expect(f.world.getBlock(0, 1, 0)).toBe(5);
      expect(owned(f, 5)).toBe(1);
    },
  );
  it("drops once at the bottom boundary and can start at the maximum world height", () => {
    const low = fixture();
    low.edit(0, NATURAL_MIN_Y, 0, 4);
    advance(low.system, 10, { ...player, y: NATURAL_MIN_Y + 1 });
    expect(low.world.getBlock(0, NATURAL_MIN_Y, 0)).toBe(0);
    expect(low.drops).toHaveLength(1);
    expect(owned(low, 4)).toBe(1);
    const high = fixture();
    high.edit(0, NATURAL_MAX_Y, 0, 5);
    advance(high.system, 1, { ...player, y: NATURAL_MAX_Y - 1 });
    expect(high.world.getBlock(0, NATURAL_MAX_Y - 1, 0)).toBe(5);
    expect(owned(high, 5)).toBe(1);
  });
  it.each(["reject", "throw"] as const)(
    "retains the source without cargo when source removal returns %s",
    (action) => {
      const f = fixture();
      f.edit(0, 3, 0, 4);
      f.failure.apply = (_x, y, _z, id) =>
        y === 3 && id === 0 ? action : undefined;
      advance(f.system, 5);
      expect(f.world.getBlock(0, 3, 0)).toBe(4);
      expect(f.system.snapshot().falling).toEqual([]);
      expect(f.drops).toEqual([]);
      expect(owned(f, 4)).toBe(1);
    },
  );
  it("persists the sole cargo after destination failure, then resumes after reload", () => {
    const f = fixture();
    f.edit(0, 3, 0, 4);
    f.failure.apply = (_x, y, _z, id) =>
      y === 2 && id === 4 ? "reject" : undefined;
    advance(f.system, 3);
    expect(f.world.getBlock(0, 3, 0)).toBe(0);
    expect(owned(f, 4)).toBe(1);
    expect(f.system.snapshot().falling).toEqual([{ x: 0, y: 3, z: 0, id: 4 }]);
    const restored = fixture(
      JSON.parse(JSON.stringify(f.system.snapshot())),
      f.world.clone(),
      "ignored",
    );
    advance(restored.system, 10);
    expect(restored.world.getBlock(0, 1, 0)).toBe(4);
    expect(restored.system.snapshot().falling).toEqual([]);
    expect(owned(restored, 4)).toBe(1);
  });
  it.each(["false-after", "throw-after"] as const)(
    "uses actual committed block state if callback reports %s",
    (action) => {
      const f = fixture();
      f.edit(0, 3, 0, 4);
      f.failure.apply = () => action;
      advance(f.system, 8);
      expect(f.world.getBlock(0, 1, 0)).toBe(4);
      expect(f.system.snapshot().falling).toEqual([]);
      expect(owned(f, 4)).toBe(1);
    },
  );
  it("rests saved cargo on newly built support without dropping a duplicate during callback notification", () => {
    const f = fixture();
    f.edit(0, 3, 0, 4);
    f.failure.apply = (_x, y, _z, id) =>
      y === 2 && id === 4 ? "reject" : undefined;
    advance(f.system, 1);
    f.edit(0, 2, 0, 3);
    f.failure.apply = () => undefined;
    advance(f.system, 3);
    expect(f.world.getBlock(0, 3, 0)).toBe(4);
    expect(f.drops).toEqual([]);
    expect(owned(f, 4)).toBe(1);
  });
  it("keeps both paid blocks if a player builds into a saved cargo's old source", () => {
    const f = fixture();
    f.edit(0, 3, 0, 4);
    f.failure.apply = (_x, y, _z, id) =>
      y === 2 && id === 4 ? "reject" : undefined;
    advance(f.system, 1);
    f.edit(0, 3, 0, 4);
    expect(f.system.snapshot().falling).toEqual([]);
    expect(f.drops).toHaveLength(1);
    expect(owned(f, 4)).toBe(2);
  });
  it("never places one cargo into another pending cargo's position", () => {
    const state = fixture().system.snapshot();
    state.falling = [
      { x: 0, y: 4, z: 0, id: 4 },
      { x: 0, y: 3, z: 0, id: 4 },
    ];
    const f = fixture(state);
    advance(f.system, 1);
    expect(owned(f, 4)).toBe(2);
    for (const cargo of f.system.snapshot().falling)
      expect(f.world.getBlock(cargo.x, cargo.y, cargo.z)).not.toBe(cargo.id);
    advance(f.system, 20);
    expect(owned(f, 4)).toBe(2);
    expect(f.system.snapshot().falling).toEqual([]);
  });
  it("does not let a failed first batch starve later saved cargo", () => {
    const state = fixture().system.snapshot();
    state.falling = Array.from(
      { length: NATURAL_UPDATE_BUDGET + 1 },
      (_, x) => ({ x, y: 3, z: 0, id: 4 }),
    );
    const f = fixture(state);
    f.failure.apply = (x, _y, _z, id) =>
      x < NATURAL_UPDATE_BUDGET && id === 4 ? "reject" : undefined;
    advance(f.system, 2);
    expect(f.world.getBlock(NATURAL_UPDATE_BUDGET, 2, 0)).toBe(4);
    expect(f.system.snapshot().falling).toHaveLength(NATURAL_UPDATE_BUDGET);
  });
  it("does not duplicate a malformed cargo when its previously unloaded source becomes readable", () => {
    const state = fixture().system.snapshot();
    state.falling = [{ x: 0, y: 3, z: 0, id: 4 }];
    const world = new NaturalWorld();
    world.setBlock(0, 3, 0, 4);
    world.loaded = () => false;
    const f = fixture(state, world);
    world.loaded = () => true;
    advance(f.system, 10);
    expect(owned(f, 4)).toBe(1);
    expect(f.system.snapshot().falling).toEqual([]);
  });
});

describe("leaf support and deterministic decay", () => {
  it("preserves leaves at six connected steps, decays the seventh, and never decays permanent leaves", () => {
    const f = fixture();
    f.edit(0, 5, 0, 7);
    for (let x = 1; x <= 7; x++) f.edit(x, 5, 0, 8);
    f.edit(0, 5, 4, 82);
    advance(f.system, 400);
    for (let x = 1; x <= 6; x++) expect(f.world.getBlock(x, 5, 0)).toBe(8);
    expect(f.world.getBlock(7, 5, 0)).toBe(0);
    expect(f.world.getBlock(0, 5, 4)).toBe(82);
  });
  it("requires a leaf connection rather than merely a nearby log, and accepts permanent leaves along a connection", () => {
    const f = fixture();
    f.edit(0, 5, 0, 7);
    f.edit(2, 5, 0, 8);
    f.edit(0, 5, 1, 82);
    f.edit(0, 5, 2, 8);
    advance(f.system, 150);
    expect(f.world.getBlock(2, 5, 0)).toBe(0);
    expect(f.world.getBlock(0, 5, 2)).toBe(8);
    f.edit(0, 5, 0, 0);
    advance(f.system, 150);
    expect(f.world.getBlock(0, 5, 2)).toBe(0);
    expect(f.world.getBlock(0, 5, 1)).toBe(82);
  });
  it("freezes a boundary leaf until all possible support paths are loaded", () => {
    const f = fixture();
    f.edit(15, 5, 0, 8);
    f.world.loaded = (x) => x < 16;
    const random = f.system.snapshot().randomState;
    advance(f.system, 100, { x: 15, y: 1, z: 0 });
    expect(f.world.getBlock(15, 5, 0)).toBe(8);
    expect(f.system.snapshot().randomState).toBe(random);
    f.world.loaded = () => true;
    advance(f.system, 200, { x: 15, y: 1, z: 0 });
    expect(f.world.getBlock(15, 5, 0)).toBe(0);
  });
  it("produces sapling, one or two sticks and apple only after successful removal, without repeat drops", () => {
    const f = fixture();
    f.edit(0, 5, 0, 8);
    const rolls = [0, 0, 0, 0.9, 0];
    Object.assign(f.system, { nextRandom: () => rolls.shift() ?? 0.99 });
    advance(f.system, 1);
    expect(f.drops.map((p) => p.stack)).toEqual([
      { id: "oak_sapling", count: 1 },
      { id: "stick", count: 2 },
      { id: "apple", count: 1 },
    ]);
    f.system.notifyBlockChanged({ x: 0, y: 5, z: 0 }, 8, 0);
    advance(f.system, 100);
    expect(f.drops).toHaveLength(3);
    const rejected = fixture();
    rejected.edit(0, 5, 0, 8);
    rejected.failure.apply = () => "reject";
    Object.assign(rejected.system, { nextRandom: () => 0 });
    advance(rejected.system, 10);
    expect(rejected.world.getBlock(0, 5, 0)).toBe(8);
    expect(rejected.drops).toEqual([]);
  });
});

describe("sapling growth, support and bone meal", () => {
  it("grows a complete oak using one successful fertilize operation at negative coordinates", () => {
    const f = fixture();
    const p = { x: -16, y: 1, z: -17 };
    f.plant(p);
    expect(f.system.fertilize(p, 15)).toBe(true);
    expect(f.world.getChanges().filter((b) => b.id === 7)).toHaveLength(5);
    expect(f.world.getChanges().filter((b) => b.id === 8)).toHaveLength(49);
    expect(f.world.getBlock(p.x, 0, p.z)).toBe(2);
    expect(f.system.fertilize(p, 15)).toBe(false);
  });
  it.each([3, 21, 28, 6])(
    "refuses unsupported soil %i without changing the world",
    (soil) => {
      const f = fixture();
      f.plant();
      f.edit(0, 0, 0, soil);
      const before = f.world.getChanges();
      expect(f.system.fertilize({ x: 0, y: 1, z: 0 }, 15)).toBe(false);
      expect(f.world.getChanges()).toEqual(before);
    },
  );
  it.each([15, 82, 8, 6])(
    "checks the entire canopy and never overwrites occupied leaf space %i",
    (obstacle) => {
      const f = fixture();
      f.plant();
      f.edit(-2, 4, 0, obstacle);
      const before = f.world.getChanges();
      expect(f.system.fertilize({ x: 0, y: 1, z: 0 }, 15)).toBe(false);
      expect(f.world.getChanges()).toEqual(before);
    },
  );
  it("requires daylight or unobstructed torch light, including for bone meal", () => {
    const f = fixture();
    f.plant();
    const p = { x: 0, y: 1, z: 0 };
    expect(f.system.fertilize(p, 8)).toBe(false);
    expect(f.system.fertilize(p, 0)).toBe(false);
    f.edit(5, 1, 0, 16);
    expect(f.system.fertilize(p, 0)).toBe(true);
    const dark = fixture();
    dark.plant();
    for (let x = -3; x <= 3; x++)
      for (let z = -3; z <= 3; z++) {
        dark.edit(x, 9, z, 3);
        if (Math.abs(x) === 3 || Math.abs(z) === 3)
          for (let y = 1; y < 9; y++) dark.edit(x, y, z, 3);
      }
    dark.edit(4, 1, 0, 16);
    expect(dark.system.fertilize(p, 15)).toBe(false);
  });
  it("checks full loaded footprint and vertical bounds before growing", () => {
    const f = fixture();
    f.plant({ x: 15, y: 1, z: 0 });
    f.world.loaded = (x) => x < 16;
    expect(f.system.fertilize({ x: 15, y: 1, z: 0 }, 15)).toBe(false);
    f.world.loaded = () => true;
    expect(f.system.fertilize({ x: 15, y: 1, z: 0 }, 15)).toBe(true);
    const high = fixture();
    high.plant({ x: 0, y: NATURAL_MAX_Y - 4, z: 0 });
    expect(high.system.fertilize({ x: 0, y: NATURAL_MAX_Y - 4, z: 0 }, 15)).toBe(false);
    const edge = fixture();
    edge.plant({ x: 0, y: NATURAL_MAX_Y - 5, z: 0 });
    expect(edge.system.fertilize({ x: 0, y: NATURAL_MAX_Y - 5, z: 0 }, 15)).toBe(true);
    expect(edge.world.getBlock(0, NATURAL_MAX_Y, 0)).toBe(8);
    const limit = fixture();
    limit.plant({ x: 30_000_000, y: 1, z: 0 });
    expect(limit.system.fertilize({ x: 30_000_000, y: 1, z: 0 }, 15)).toBe(
      false,
    );
  });
  it("rolls back a refused tree write before restoring its sapling", () => {
    const f = fixture();
    f.plant();
    f.failure.apply = (x, y, z, id) =>
      x === 1 && y === 4 && z === 0 && id === 8 ? "reject" : undefined;
    expect(f.system.fertilize({ x: 0, y: 1, z: 0 }, 15)).toBe(false);
    expect(f.world.getBlock(0, 1, 0)).toBe(83);
    expect(
      f.world.getChanges().filter((p) => p.id === 7 || p.id === 8),
    ).toEqual([]);
    expect(f.drops).toEqual([]);
  });
  it("does not leave a retryable sapling when even rollback is refused", () => {
    const f = fixture();
    f.plant();
    f.failure.apply = (x, y, z, id) =>
      (x === 1 && y === 4 && z === 0 && id === 8) || (y === 2 && id === 0)
        ? "reject"
        : undefined;
    expect(f.system.fertilize({ x: 0, y: 1, z: 0 }, 15)).toBe(true);
    expect(f.world.getBlock(0, 1, 0)).toBe(7);
    expect(f.system.fertilize({ x: 0, y: 1, z: 0 }, 15)).toBe(false);
  });
  it("grows by scheduled random ticks and drops an unsupported sapling once", () => {
    const f = fixture();
    f.plant();
    Object.assign(f.system, { nextRandom: () => 0 });
    advance(f.system, 1);
    expect(f.world.getBlock(0, 1, 0)).toBe(7);
    const unsupported = fixture();
    unsupported.edit(0, 2, 0, 83);
    advance(unsupported.system, 10);
    expect(unsupported.world.getBlock(0, 2, 0)).toBe(0);
    expect(unsupported.drops.map((p) => p.stack)).toEqual([
      { id: "oak_sapling", count: 1 },
    ]);
  });
});

describe("bounded scheduling and reload", () => {
  it("does not tick while paused or read and mutate unloaded positions", () => {
    const f = fixture();
    f.edit(0, 3, 0, 4);
    f.plant({ x: 2, y: 1, z: 0 });
    const before = f.system.snapshot();
    f.system.step(0, player, 15);
    f.system.step(Number.NaN, player, 15);
    expect(f.system.snapshot()).toEqual(before);
    f.world.loaded = () => false;
    f.world.reads = 0;
    advance(f.system, 100);
    expect(f.world.reads).toBe(0);
    expect(f.system.snapshot().randomState).toBe(before.randomState);
    expect(f.drops).toEqual([]);
    f.world.loaded = () => true;
    advance(f.system, 100, { x: 1000, y: 1, z: 1000 });
    expect(f.world.getBlock(0, 3, 0)).toBe(4);
    advance(f.system, 10);
    expect(f.world.getBlock(0, 1, 0)).toBe(4);
  });
  it("round trips RNG, scan cursor, queue and fractional time with identical continued results", () => {
    const a = fixture();
    a.edit(0, 5, 0, 8);
    a.edit(3, 5, 0, 8);
    a.plant({ x: 8, y: 1, z: 0 });
    a.edit(-3, 20, 0, 4);
    a.system.step(0.035, player, 15);
    const b = fixture(
      JSON.parse(JSON.stringify(a.system.snapshot())),
      a.world.clone(),
      "different-seed",
    );
    advance(a.system, 300);
    advance(b.system, 300);
    expect(a.system.snapshot()).toEqual(b.system.snapshot());
    expect(a.world.getChanges()).toEqual(b.world.getChanges());
    expect(a.drops).toEqual(b.drops);
  });
  it("discovers existing natural blocks without edit notifications", () => {
    const world = new NaturalWorld();
    world.ground = -16;
    world.setBlock(-12, -11, -12, 4);
    const f = fixture(undefined, world);
    advance(f.system, 10, { x: 0, y: 1, z: 0 });
    expect(world.getBlock(-12, -11, -12)).toBe(0);
    expect(world.getBlock(-12, -15, -12)).toBe(4);
  });
  it("bounds queue size and one-step work even with oversized deltas", () => {
    const f = fixture();
    for (let x = 0; x < NATURAL_QUEUE_MAX + 10; x++)
      f.system.notifyBlockChanged({ x: x + 1000, y: 2, z: 0 }, 0, 4);
    expect(f.system.snapshot().queue).toHaveLength(NATURAL_QUEUE_MAX);
    f.world.reads = 0;
    f.system.step(1e8, player, 15);
    expect(f.world.reads).toBeLessThanOrEqual(
      NATURAL_SCAN_BUDGET + NATURAL_UPDATE_BUDGET * 2,
    );
    expect(f.system.snapshot().scanCursor).toBe(NATURAL_SCAN_BUDGET);
    expect(f.system.snapshot().accumulator).toBeLessThan(NATURAL_SCAN_INTERVAL);
  });
  it("returns detached state and rejects invalid bounds, duplicate owners and future versions", () => {
    const f = fixture();
    f.edit(0, 3, 0, 4);
    const snapshot = f.system.snapshot();
    snapshot.queue[0].y = 90;
    expect(f.system.snapshot().queue[0].y).toBe(3);
    const base = f.system.snapshot();
    const invalid: NaturalState[] = [
      { ...base, version: 2 as 1 },
      { ...base, randomState: Infinity },
      { ...base, accumulator: 0.1 },
      { ...base, scanCursor: NATURAL_SCAN_SIZE },
      { ...base, queue: [{ x: 0.5, y: 2, z: 0 }] },
      { ...base, queue: [{ x: 0, y: NATURAL_MAX_Y + 1, z: 0 }] },
      { ...base, queue: [...base.queue, ...base.queue] },
      {
        ...base,
        falling: Array.from({ length: NATURAL_FALLING_MAX + 1 }, (_, x) => ({
          x,
          y: 4,
          z: 0,
          id: 4,
        })),
      },
      { ...base, falling: [{ x: 0, y: 3, z: 0, id: 4 }] },
    ];
    for (const saved of invalid)
      expect(() => fixture(saved, f.world.clone())).toThrow();
  });
});
