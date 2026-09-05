import { describe, expect, it } from 'vitest';
import { FluidSystem, FLUID_QUEUE_LIMIT, FLUID_SCAN_SIZE, FLUID_TASK_BUDGET } from '../src/game/fluids';
import type { FluidState } from '../src/game/fluids';
import { fluidInfo, isFluid, isWater, isLava } from '../src/game/fluid-blocks';
import type { BlockChange, Vec3, WorldPort } from '../src/game/types';
import { WORLD_MIN_Y, WORLD_MAX_Y } from '../src/engine/world-height';

class FluidWorld implements WorldPort {
  blocks = new Map<string, BlockChange>();
  base = (_x: number, y: number, _z: number): number => y <= 0 ? 3 : 0;
  loaded = (_x: number, _z: number) => true;
  reads = 0;
  getBlock(x: number, y: number, z: number): number {
    if (!this.loaded(x, z)) throw new Error(`Read from unloaded column ${x},${z}`);
    this.reads++;
    return this.blocks.get(`${x},${y},${z}`)?.id ?? this.base(x, y, z);
  }
  setBlock(x: number, y: number, z: number, id: number): void {
    if (!this.loaded(x, z) || y < WORLD_MIN_Y || y > WORLD_MAX_Y) throw new Error('Write outside loaded world');
    this.blocks.set(`${x},${y},${z}`, { x, y, z, id });
  }
  isReady(x: number, z: number): boolean { return this.loaded(x, z); }
  getSurface(): number { return 0; }
  getChanges(): BlockChange[] { return [...this.blocks.values()].map(block => ({ ...block })); }
  clone(): FluidWorld { const copy = new FluidWorld(); copy.blocks = new Map(this.getChanges().map(block => [`${block.x},${block.y},${block.z}`, block])); copy.base = this.base; copy.loaded = this.loaded; return copy; }
}

const player = { x: .5, y: 1, z: .5 };
function setup(world = new FluidWorld(), saved?: FluidState) {
  const writes: Array<BlockChange & { oldId: number }> = [];
  let rejectWrites = false;
  let system: FluidSystem;
  system = new FluidSystem(world, saved, {
    setBlock(x, y, z, id) {
      if (rejectWrites) return false;
      const oldId = world.getBlock(x, y, z);
      world.setBlock(x, y, z, id);
      writes.push({ x, y, z, id, oldId });
      system?.notifyBlockChanged({ x, y, z }, oldId, id);
      return true;
    },
  });
  const edit = (x: number, y: number, z: number, id: number) => {
    const oldId = world.getBlock(x, y, z); world.setBlock(x, y, z, id);
    system.notifyBlockChanged({ x, y, z }, oldId, id);
  };
  return { system, world, writes, edit, reject: (value: boolean) => { rejectWrites = value; } };
}
function advance(system: FluidSystem, seconds: number, position = player, dt = .05) {
  for (let i = 0; i < Math.round(seconds / dt); i++) system.step(dt, position);
}
function fluidCells(world: FluidWorld) { return world.getChanges().filter(block => isFluid(block.id)).sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z); }

describe('water propagation and retreat', () => {
  it('spreads seven horizontal levels on a supported plane and stops at the eighth cell', () => {
    const { system, world, edit } = setup(); edit(0, 1, 0, 6);
    advance(system, 8);
    expect(world.getBlock(0, 1, 0)).toBe(6);
    for (let level = 1; level <= 7; level++) {
      expect(world.getBlock(level, 1, 0)).toBe(67 + level);
      expect(world.getBlock(-level, 1, 0)).toBe(67 + level);
    }
    expect(world.getBlock(8, 1, 0)).toBe(0);
    expect(world.getBlock(4, 1, 3)).toBe(74);
    expect(world.getBlock(4, 1, 4)).toBe(0);
    expect(fluidCells(world)).toHaveLength(113);
    expect(fluidCells(world).filter(block => block.id === 6)).toHaveLength(1);
  });
  it('falls before spreading sideways and spreads only when the column reaches support', () => {
    const { system, world, edit } = setup(); edit(0, 4, 0, 6);
    advance(system, .3);
    expect(world.getBlock(0, 3, 0)).toBe(75);
    expect(world.getBlock(1, 4, 0)).toBe(0);
    advance(system, 8);
    for (let y = 1; y <= 3; y++) expect(world.getBlock(0, y, 0)).toBe(75);
    for (let y = 2; y <= 4; y++) expect(world.getBlock(1, y, 0)).toBe(0);
    expect(world.getBlock(7, 1, 0)).toBe(74);
  });
  it('drains all unsupported flow after its only source is removed', () => {
    const { system, world, edit } = setup(); edit(0, 4, 0, 6);
    advance(system, 8); expect(fluidCells(world).length).toBeGreaterThan(100);
    edit(0, 4, 0, 0); advance(system, 20);
    expect(fluidCells(world)).toEqual([]);
  });
  it('recomputes existing flow when a hole opens beneath its source', () => {
    const { system, world, edit } = setup(); edit(0, 1, 0, 6);
    advance(system, 8); expect(world.getBlock(1, 1, 0)).toBe(68);
    edit(0, 0, 0, 0); advance(system, 12);
    expect(world.getBlock(0, 0, 0)).toBe(75);
    expect(world.getBlock(0, 1, 0)).toBe(6);
    expect(world.getBlock(1, 1, 0)).toBe(0);
  });
  it('creates an independent water source only between two supported adjacent sources', () => {
    const { system, world, edit } = setup(); edit(-1, 1, 0, 6); edit(1, 1, 0, 6);
    advance(system, .3); expect(world.getBlock(0, 1, 0)).toBe(6);
    edit(-1, 1, 0, 0); edit(1, 1, 0, 0); advance(system, 5);
    expect(world.getBlock(0, 1, 0)).toBe(6);
    expect(world.getBlock(1, 1, 0)).toBe(68);
  });
  it('does not regenerate a source between two unsupported waterfalls', () => {
    const { system, world, edit } = setup(); edit(-1, 4, 0, 6); edit(1, 4, 0, 6);
    advance(system, 5);
    expect(world.getBlock(0, 4, 0)).toBe(0);
  });
  it('permits source regeneration supported by another water source', () => {
    const { system, world, edit } = setup(); edit(-1, 2, 0, 6); edit(1, 2, 0, 6); edit(0, 1, 0, 6);
    advance(system, .3); expect(world.getBlock(0, 2, 0)).toBe(6);
  });
  it('replaces a plant once through the owner callback and respects solid permanent leaves', () => {
    const { system, world, writes, edit } = setup(); edit(1, 1, 0, 30); edit(-1, 1, 0, 82); edit(0, 1, 1, 83); edit(0, 1, 0, 6);
    advance(system, 5);
    expect(isWater(world.getBlock(1, 1, 0))).toBe(true);
    expect(isWater(world.getBlock(0, 1, 1))).toBe(true);
    expect(world.getBlock(-1, 1, 0)).toBe(82);
    expect(writes.filter(write => write.oldId === 30)).toHaveLength(1);
    expect(writes.filter(write => write.oldId === 83)).toHaveLength(1);
  });
});

describe('lava pacing and contact conversion', () => {
  it('flows more slowly than water and attenuates to levels 2, 4, 6 over three blocks', () => {
    const water = setup(), lava = setup(); water.edit(0, 1, 0, 6); lava.edit(0, 1, 0, 76);
    advance(water.system, .3); advance(lava.system, .3);
    expect(water.world.getBlock(1, 1, 0)).toBe(68);
    expect(lava.world.getBlock(1, 1, 0)).toBe(0);
    advance(lava.system, 1.25); expect(lava.world.getBlock(1, 1, 0)).toBe(77);
    advance(lava.system, 8);
    for (let distance = 1; distance <= 3; distance++) expect(lava.world.getBlock(distance, 1, 0)).toBe(76 + distance);
    expect(lava.world.getBlock(4, 1, 0)).toBe(0);
    expect(fluidCells(lava.world).filter(block => block.id === 76)).toHaveLength(1);
  });
  it('falls before horizontal lava spread and drains after source removal', () => {
    const { system, world, edit } = setup(); edit(0, 3, 0, 76);
    advance(system, 1.55);
    expect(world.getBlock(0, 2, 0)).toBe(80); expect(world.getBlock(1, 3, 0)).toBe(0);
    advance(system, 12); expect(world.getBlock(3, 1, 0)).toBe(79);
    edit(0, 3, 0, 0); advance(system, 30);
    expect(fluidCells(world)).toEqual([]);
  });
  it('never turns the meeting of two lava sources into a third source', () => {
    const { system, world, edit } = setup(); edit(-1, 1, 0, 76); edit(1, 1, 0, 76);
    advance(system, 2); expect(world.getBlock(0, 1, 0)).toBe(77);
  });
  it.each([76, 77, 79, 80])('converts lava block %i touched horizontally by water to its correct solid', lavaId => {
    const { system, world, writes, edit } = setup(); edit(0, 1, 0, lavaId); edit(1, 1, 0, 6);
    advance(system, .3);
    const solid = lavaId === 76 ? 81 : 12;
    expect(world.getBlock(0, 1, 0)).toBe(solid);
    advance(system, 4);
    expect(writes.filter(write => write.x === 0 && write.y === 1 && write.z === 0 && write.id === solid)).toHaveLength(1);
  });
  it('turns a lava source into obsidian when water descends onto it', () => {
    const { system, world, edit } = setup(); edit(0, 1, 0, 76); edit(0, 2, 0, 6);
    advance(system, .3); expect(world.getBlock(0, 1, 0)).toBe(81);
    expect(world.getBlock(0, 2, 0)).toBe(6);
  });
  it('turns the lower water into stone when lava descends onto it', () => {
    const { system, world, edit } = setup(); edit(0, 1, 0, 6); edit(0, 2, 0, 76);
    advance(system, .3); expect(world.getBlock(0, 1, 0)).toBe(3);
    expect(world.getBlock(0, 2, 0)).toBe(76);
  });
});

describe('loaded boundaries, natural activation and bounded scheduling', () => {
  it('propagates across negative coordinates with the same levels', () => {
    const { system, world, edit } = setup(); edit(-17, 1, -1, 6);
    advance(system, 8, { x: -16.5, y: 1, z: -.5 });
    expect(world.getBlock(-18, 1, -1)).toBe(68);
    expect(world.getBlock(-24, 1, -1)).toBe(74);
    expect(world.getBlock(-25, 1, -1)).toBe(0);
  });
  it('never reads or writes unloaded columns and resumes when the edge loads', () => {
    const world = new FluidWorld(); world.loaded = x => x < 16;
    const { system, edit } = setup(world); edit(15, 1, 0, 6);
    const near = { x: 14.5, y: 1, z: .5 };
    expect(() => advance(system, 5, near)).not.toThrow();
    expect(world.getChanges().some(block => block.x >= 16)).toBe(false);
    expect(world.getBlock(14, 1, 0)).toBe(68);
    world.loaded = () => true; advance(system, 5, near);
    expect(world.getBlock(16, 1, 0)).toBe(68);
  });
  it('does not erase a loaded flow whose source is in an unloaded neighbor column', () => {
    const world = new FluidWorld(); world.setBlock(16, 1, 0, 6); world.setBlock(15, 1, 0, 68); world.loaded = x => x < 16;
    const { system } = setup(world);
    advance(system, 5, { x: 14.5, y: 1, z: .5 });
    expect(world.getBlock(15, 1, 0)).toBe(68);
    expect(system.pendingCount).toBeGreaterThan(0);
  });
  it.each([WORLD_MIN_Y, WORLD_MAX_Y])('handles world height %i without waiting forever on out-of-world neighbors', y => {
    const world = new FluidWorld(); world.base = (_x, blockY) => blockY < y ? 3 : 0;
    const { system, edit } = setup(world); edit(0, y, 0, 6);
    advance(system, .3, { x: .5, y: y + 1, z: .5 });
    expect(world.getBlock(1, y, 0)).toBe(68);
    expect(world.getChanges().every(block => block.y >= WORLD_MIN_Y && block.y <= WORLD_MAX_Y)).toBe(true);
  });
  it('wakes an exposed natural source without enumerating natural world blocks', () => {
    const world = new FluidWorld(); world.base = (x, y, z) => x === 0 && y === 1 && z === 0 ? 6 : y <= 0 ? 3 : 0;
    const { system } = setup(world);
    expect(system.pendingCount).toBe(0); expect(world.getChanges()).toEqual([]);
    advance(system, 6);
    expect(world.getBlock(1, 1, 0)).toBe(68);
  });
  it('keeps far loaded sources dormant until the player approaches', () => {
    const { system, world, edit } = setup(); edit(200, 1, 0, 6);
    advance(system, 3); expect(world.getBlock(201, 1, 0)).toBe(0);
    advance(system, 1, { x: 200.5, y: 1, z: .5 }); expect(world.getBlock(201, 1, 0)).toBe(68);
  });
  it('deduplicates repeated callback notifications and bounds even a saturated task queue', () => {
    const { system, world, writes } = setup();
    for (let i = 0; i < 20_000; i++) system.notifyBlockChanged({ x: i % 4000, y: 1, z: 0 }, 0, 6);
    const saved = system.snapshot();
    expect(saved.tasks.length).toBeLessThanOrEqual(FLUID_QUEUE_LIMIT);
    expect(new Set(saved.tasks.map(task => `${task.x},${task.y},${task.z},${task.kind}`)).size).toBe(saved.tasks.length);
    world.reads = 0;
    system.step(1_000_000, player);
    expect(system.pendingCount).toBeLessThanOrEqual(FLUID_QUEUE_LIMIT);
    expect(world.reads).toBeLessThan(6000);
    expect(writes.length).toBeLessThanOrEqual(FLUID_TASK_BUDGET * 6);
    expect(system.snapshot().scanCursor).toBeLessThan(FLUID_SCAN_SIZE);
  });
  it('keeps failed owner writes from creating phantom flow, and can retry later', () => {
    const { system, world, edit, reject } = setup(); edit(0, 1, 0, 6); reject(true);
    advance(system, 1); expect(world.getBlock(1, 1, 0)).toBe(0);
    reject(false); advance(system, 6); expect(world.getBlock(1, 1, 0)).toBe(68);
  });
});

describe('checkpoint continuation and pause', () => {
  it('continues pending slow lava identically after snapshot and reload', () => {
    const original = setup(); original.edit(0, 4, 0, 76); advance(original.system, .4);
    const saved = original.system.snapshot();
    expect(saved.tasks.some(task => task.kind === 'lava' && task.due > saved.clock)).toBe(true);
    const resumed = setup(original.world.clone(), saved);
    expect(resumed.system.snapshot()).toEqual(saved);
    advance(original.system, 13); advance(resumed.system, 13);
    expect(fluidCells(resumed.world)).toEqual(fluidCells(original.world));
    expect(resumed.system.snapshot()).toEqual(original.system.snapshot());
    expect(fluidCells(resumed.world).filter(block => fluidInfo(block.id)?.source)).toHaveLength(1);
    expect(resumed.writes.every(write => write.oldId !== write.id)).toBe(true);
  });
  it('resumes a source-removal checkpoint without resurrecting or duplicating water', () => {
    const original = setup(); original.edit(0, 1, 0, 6); advance(original.system, 8);
    original.edit(0, 1, 0, 0); advance(original.system, .4);
    const resumed = setup(original.world.clone(), original.system.snapshot());
    advance(original.system, 15); advance(resumed.system, 15);
    expect(fluidCells(resumed.world)).toEqual([]);
    expect(resumed.system.snapshot()).toEqual(original.system.snapshot());
  });
  it('has no autonomous timers and ignores zero, negative or invalid steps while paused', async () => {
    const { system, world, edit } = setup(); edit(0, 1, 0, 6);
    const before = system.snapshot(), blocks = world.getChanges();
    await Promise.resolve();
    for (const dt of [0, -1, NaN, Infinity]) system.step(dt, player);
    expect(system.snapshot()).toEqual(before); expect(world.getChanges()).toEqual(blocks);
  });
  it('returns a detached checkpoint whose mutation cannot change the live schedule', () => {
    const { system, edit } = setup(); edit(0, 1, 0, 6);
    const before = system.snapshot(), detached = system.snapshot();
    detached.tasks[0].due = 0; detached.tasks[0].x = 900; detached.tasks.length = 0; detached.clock = 100;
    expect(system.snapshot()).toEqual(before);
  });
  it.each([
    ['unknown version', (state: any) => { state.version = 2; }],
    ['invalid clock', (state: any) => { state.clock = Infinity; }],
    ['invalid scan index', (state: any) => { state.scanCursor = FLUID_SCAN_SIZE; }],
    ['duplicate task', (state: any) => { state.tasks.push({ ...state.tasks[0] }); }],
    ['unknown fluid kind', (state: any) => { state.tasks[0].kind = 'oil'; }],
    ['fractional coordinate', (state: any) => { state.tasks[0].x = .1; }],
    ['out-of-world height', (state: any) => { state.tasks[0].y = WORLD_MAX_Y + 1; }],
    ['unbounded deadline', (state: any) => { state.tasks[0].due = 2; }],
  ])('rejects %s when restoring its own state', (_, mutate) => {
    const state: FluidState = { version: 1, clock: 0, scanCursor: 0, tasks: [{ x: 0, y: 1, z: 0, kind: 'water', due: .25 }] };
    mutate(state);
    expect(() => new FluidSystem(new FluidWorld(), state, { setBlock: () => true })).toThrow('流体');
  });
});
