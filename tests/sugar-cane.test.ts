import { describe, expect, it } from "vitest";
import { WORLD_MIN_Y, WORLD_MAX_Y } from "../src/engine/world-height";
import {
  SugarCaneSystem,
  SUGAR_CANE_SCAN_INTERVAL,
  SUGAR_CANE_SCAN_SIZE,
  SUGAR_CANE_QUEUE_MAX,
  SUGAR_CANE_GROWTH_MAX,
  SUGAR_CANE_GROW_MAX_SECONDS,
  type SugarCaneState,
} from "../src/game/sugar-cane";
import type {
  BlockChange,
  ItemStack,
  Vec3,
  WorldPort,
} from "../src/game/types";

const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
class CaneWorld implements WorldPort {
  blocks = new Map<string, BlockChange>();
  ready = (_x: number, _z: number, _y?: number) => true;
  getBlock(x: number, y: number, z: number): number {
    if (!this.ready(x, z, y)) throw new Error("unloaded read");
    return this.blocks.get(`${x},${y},${z}`)?.id ?? 0;
  }
  setBlock(x: number, y: number, z: number, id: number): void {
    this.blocks.set(`${x},${y},${z}`, { x, y, z, id });
  }
  isReady(x: number, z: number, y?: number): boolean {
    return this.ready(x, z, y);
  }
  getSurface(): number {
    return 0;
  }
  getChanges(): BlockChange[] {
    return [...this.blocks.values()].map((p) => ({ ...p }));
  }
  clone(): CaneWorld {
    const result = new CaneWorld();
    result.ready = this.ready;
    result.blocks = new Map(this.getChanges().map((p) => [key(p), p]));
    return result;
  }
}
type Failure = "reject" | "throw" | "false-after" | "throw-after" | undefined;
function fixture(saved?: SugarCaneState, world = new CaneWorld()) {
  const drops: ItemStack[] = [];
  const failure = {
    action: (_x: number, _y: number, _z: number, _id: number): Failure =>
      undefined,
  };
  const system = new SugarCaneSystem(world, "cane-test", saved, {
    setBlock(x, y, z, id) {
      const action = failure.action(x, y, z, id);
      if (action === "reject") return false;
      if (action === "throw") throw new Error("failed before commit");
      const oldId = world.getBlock(x, y, z);
      world.setBlock(x, y, z, id);
      system.notifyBlockChanged({ x, y, z }, oldId, id);
      if (action === "throw-after") throw new Error("failed after commit");
      return action !== "false-after";
    },
    dropItem: (_p, stack) => drops.push({ ...stack }),
  });
  const edit = (x: number, y: number, z: number, id: number) => {
    const oldId = world.getBlock(x, y, z);
    world.setBlock(x, y, z, id);
    system.notifyBlockChanged({ x, y, z }, oldId, id);
  };
  const plant = (p = { x: 0, y: 1, z: 0 }, height = 1, soil = 2, water = 6) => {
    edit(p.x, p.y - 1, p.z, soil);
    edit(p.x + 1, p.y - 1, p.z, water);
    for (let dy = 0; dy < height; dy++) edit(p.x, p.y + dy, p.z, 111);
  };
  return { world, system, drops, edit, plant, failure };
}
function advance(
  system: SugarCaneSystem,
  seconds: number,
  player = { x: 0, y: 1, z: 0 },
) {
  for (let t = 0; t < seconds; t += SUGAR_CANE_SCAN_INTERVAL)
    system.step(SUGAR_CANE_SCAN_INTERVAL, player);
}
const emptyState = (): SugarCaneState => ({
  version: 1,
  accumulator: 0,
  scanCursor: 0,
  queue: [],
  growth: [],
});

describe("sugar cane planting and support", () => {
  it.each([1, 2, 4])(
    "accepts ground %i beside source/flowing water",
    (ground) => {
      for (const water of [6, 68, 74, 75]) {
        const f = fixture();
        f.edit(0, 0, 0, ground);
        f.edit(1, 0, 0, water);
        expect(f.system.canPlace({ x: 0, y: 1, z: 0 })).toBe(true);
      }
    },
  );
  it.each([3, 5, 28, 29, 81, 111])(
    "rejects ground %i without a valid rooted stalk",
    (ground) => {
      const f = fixture();
      f.edit(0, 0, 0, ground);
      f.edit(1, 0, 0, 6);
      expect(f.system.canPlace({ x: 0, y: 1, z: 0 })).toBe(false);
    },
  );
  it("requires water touching the soil side, not a diagonal, above it, or lava", () => {
    for (const p of [
      [1, 0, 1, 6],
      [1, 1, 0, 6],
      [1, -1, 0, 6],
      [1, 0, 0, 76],
    ]) {
      const f = fixture();
      f.edit(0, 0, 0, 2);
      f.edit(p[0], p[1], p[2], p[3]);
      expect(f.system.canPlace({ x: 0, y: 1, z: 0 })).toBe(false);
    }
  });
  it("stacks up to three, preserves occupied blocks, and rejects fractional coordinates", () => {
    const f = fixture();
    f.plant(undefined, 2);
    expect(f.system.canPlace({ x: 0, y: 3, z: 0 })).toBe(true);
    f.edit(0, 3, 0, 111);
    expect(f.system.canPlace({ x: 0, y: 4, z: 0 })).toBe(false);
    expect(f.system.canPlace({ x: 0, y: 3, z: 0 })).toBe(false);
    expect(f.system.canPlace({ x: 0.5, y: 1, z: 0 })).toBe(false);
  });
  it("freezes ambiguous support at a negative chunk boundary until its water loads", () => {
    const f = fixture();
    f.plant({ x: -17, y: 16, z: -16 }, 3);
    f.world.ready = (x) => x !== -16;
    advance(f.system, 4, { x: -17, y: 16, z: -16 });
    expect(f.drops).toEqual([]);
    expect(f.system.canPlace({ x: -17, y: 19, z: -16 })).toBe(false);
    f.world.ready = () => true;
    f.edit(-16, 15, -16, 0);
    advance(f.system, 2, { x: -17, y: 16, z: -16 });
    expect(f.drops).toEqual(
      Array.from({ length: 3 }, () => ({ id: "sugar_cane", count: 1 })),
    );
  });
});

describe("sugar cane conservation and growth", () => {
  it("cascades each segment once when soil is removed", () => {
    const f = fixture();
    f.plant(undefined, 3);
    f.edit(0, 0, 0, 0);
    advance(f.system, 4);
    for (let y = 1; y <= 3; y++) expect(f.world.getBlock(0, y, 0)).toBe(0);
    expect(f.drops).toHaveLength(3);
    advance(f.system, 4);
    expect(f.drops).toHaveLength(3);
    expect(f.system.snapshot().growth).toEqual([]);
  });
  it("only removes the unsupported upper stalk when the middle is harvested", () => {
    const f = fixture();
    f.plant(undefined, 3);
    advance(f.system, 1);
    f.edit(0, 2, 0, 0); // The caller owns the player's harvested middle drop.
    advance(f.system, 3);
    expect(f.world.getBlock(0, 1, 0)).toBe(111);
    expect(f.world.getBlock(0, 3, 0)).toBe(0);
    expect(f.drops).toEqual([{ id: "sugar_cane", count: 1 }]);
  });
  it.each(["reject", "throw"] as const)(
    "does not drop or delete a source when removal %s",
    (action) => {
      const f = fixture();
      f.plant(undefined, 3);
      f.failure.action = (_x, _y, _z, id) => (id === 0 ? action : undefined);
      f.edit(1, 0, 0, 0);
      advance(f.system, 2);
      expect(f.world.getBlock(0, 1, 0)).toBe(111);
      expect(f.drops).toEqual([]);
      f.failure.action = () => undefined;
      advance(f.system, 4);
      expect(f.drops).toHaveLength(3);
    },
  );
  it.each(["false-after", "throw-after"] as const)(
    "uses committed state when a write reports %s",
    (action) => {
      const f = fixture();
      f.plant(undefined, 3);
      f.failure.action = () => action;
      f.edit(1, 0, 0, 0);
      advance(f.system, 4);
      expect(f.drops).toHaveLength(3);
      expect(f.world.getBlock(0, 1, 0)).toBe(0);
    },
  );
  it("naturally grows to three without light, and never overwrites a roof", () => {
    const f = fixture();
    f.plant();
    advance(f.system, 245);
    expect([1, 2, 3].map((y) => f.world.getBlock(0, y, 0))).toEqual([
      111, 111, 111,
    ]);
    expect(f.world.getBlock(0, 4, 0)).toBe(0);
    expect(f.drops).toEqual([]);
    const roof = fixture();
    roof.plant();
    roof.edit(0, 2, 0, 3);
    advance(roof.system, 245);
    expect(roof.world.getBlock(0, 2, 0)).toBe(3);
    expect(roof.system.snapshot().growth[0].age).toBe(0);
  });
  it("retains matured progress on failed growth and succeeds once after reload", () => {
    const f = fixture();
    f.plant();
    f.failure.action = (_x, _y, _z, id) => (id === 111 ? "reject" : undefined);
    advance(f.system, 125);
    expect(f.world.getBlock(0, 2, 0)).toBe(0);
    expect(f.system.snapshot().growth[0].age).toBe(SUGAR_CANE_GROW_MAX_SECONDS);
    const next = fixture(f.system.snapshot(), f.world.clone());
    advance(next.system, 0.25);
    expect(next.world.getBlock(0, 2, 0)).toBe(111);
    expect(next.world.getBlock(0, 3, 0)).toBe(0);
    expect(next.system.snapshot().growth[0].age).toBe(0);
  });
  it("keeps growth ages frozen when far away or a vertical segment is unloaded", () => {
    const f = fixture();
    f.plant({ x: 0, y: 15, z: 0 });
    const near = { x: 0, y: 15, z: 0 };
    advance(f.system, 10, near);
    const age = f.system.snapshot().growth[0].age;
    advance(f.system, 20, { x: 100, y: 15, z: 0 });
    expect(f.system.snapshot().growth[0].age).toBe(age);
    f.world.ready = (_x, _z, y) => y !== 16;
    advance(f.system, 20, near);
    expect(f.system.snapshot().growth[0].age).toBe(age);
    f.world.ready = () => true;
    advance(f.system, 1, near);
    expect(f.system.snapshot().growth[0].age).toBe(age + 1);
  });
  it("resumes a pending cascade only when the upper vertical chunk loads", () => {
    const f = fixture();
    f.plant({ x: -16, y: 15, z: -17 }, 3);
    f.world.ready = (_x, _z, y) => y === undefined || y < 16;
    f.edit(-16, 14, -17, 0);
    advance(f.system, 2, { x: -16, y: 15, z: -17 });
    expect(f.drops).toHaveLength(1);
    const saved = JSON.parse(
      JSON.stringify(f.system.snapshot()),
    ) as SugarCaneState;
    const world = f.world.clone();
    world.ready = () => true;
    const restored = fixture(saved, world);
    advance(restored.system, 3, { x: -16, y: 15, z: -17 });
    expect(restored.drops).toHaveLength(2);
    expect(restored.world.getBlock(-16, 16, -17)).toBe(0);
  });
  it("save/reload preserves timers, queue order and future growth exactly", () => {
    const a = fixture();
    a.plant();
    advance(a.system, 23.5);
    a.system.step(0.1, { x: 0, y: 1, z: 0 });
    const b = fixture(
      JSON.parse(JSON.stringify(a.system.snapshot())),
      a.world.clone(),
    );
    advance(a.system, 130);
    advance(b.system, 130);
    expect(b.world.getChanges()).toEqual(a.world.getChanges());
    expect(b.system.snapshot()).toEqual(a.system.snapshot());
    expect(b.drops).toEqual(a.drops);
  });
  it("handles world-height edges without reading beyond the allowed range", () => {
    for (const y of [WORLD_MIN_Y + 1, WORLD_MAX_Y]) {
      const f = fixture();
      f.plant({ x: 0, y, z: 0 });
      f.world.ready = (_x, _z, queryY) =>
        queryY !== undefined && queryY >= WORLD_MIN_Y && queryY <= WORLD_MAX_Y;
      advance(f.system, 125, { x: 0, y, z: 0 });
      expect(f.world.getBlock(0, y, 0)).toBe(111);
      expect(f.drops).toEqual([]);
    }
  });
});

describe("bounded cane save state", () => {
  it("does not mutate exported snapshots and caps discovery work", () => {
    const f = fixture();
    f.plant();
    advance(f.system, 1);
    const state = f.system.snapshot();
    state.growth[0].age = 120;
    expect(f.system.snapshot().growth[0].age).not.toBe(120);
    for (let x = 0; x < SUGAR_CANE_QUEUE_MAX * 2; x++)
      f.system.notifyBlockChanged({ x, y: 0, z: 0 }, 6, 0);
    expect(f.system.snapshot().queue.length).toBeLessThanOrEqual(
      SUGAR_CANE_QUEUE_MAX,
    );
    const before = f.system.snapshot();
    f.system.step(-1, { x: 0, y: 1, z: 0 });
    f.system.step(NaN, { x: 0, y: 1, z: 0 });
    expect(f.system.snapshot()).toEqual(before);
  });
  it.each([
    { accumulator: 0.25 },
    { accumulator: NaN },
    { scanCursor: SUGAR_CANE_SCAN_SIZE },
    { growth: [{ x: 0, y: 1, z: 0, age: 121 }] },
    { growth: [{ x: 0, y: 1, z: 0, age: -1 }] },
    {
      queue: [
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
    },
    {
      growth: [
        { x: 0, y: 1, z: 0, age: 1 },
        { x: 0, y: 1, z: 0, age: 2 },
      ],
    },
    { queue: [{ x: 0, y: WORLD_MAX_Y + 1, z: 0 }] },
    {
      queue: Array.from({ length: SUGAR_CANE_QUEUE_MAX + 1 }, (_, x) => ({
        x,
        y: 1,
        z: 0,
      })),
    },
    {
      growth: Array.from({ length: SUGAR_CANE_GROWTH_MAX + 1 }, (_, x) => ({
        x,
        y: 1,
        z: 0,
        age: 0,
      })),
    },
  ])("rejects malformed or oversized state %j", (change) => {
    expect(() => fixture({ ...emptyState(), ...change })).toThrow();
  });
});
