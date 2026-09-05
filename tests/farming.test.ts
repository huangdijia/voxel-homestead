import { describe, expect, it } from 'vitest';
import { CROP_DEFINITIONS, FARMLAND, FARM_SCAN_LIMIT, FarmingSystem, cropAt, harvestCrop } from '../src/game/farming';
import type { FarmState } from '../src/game/farming';
import type { BlockChange, ItemStack, Vec3, WorldPort } from '../src/game/types';

class FarmWorld implements WorldPort {
  blocks = new Map<string, BlockChange>();
  reads = 0;
  loaded = (_x: number, _z: number) => true;
  getBlock(x: number, y: number, z: number): number { this.reads++; return this.blocks.get(`${x},${y},${z}`)?.id ?? (y <= 0 ? 2 : 0); }
  setBlock(x: number, y: number, z: number, id: number): void { this.blocks.set(`${x},${y},${z}`, { x, y, z, id }); }
  isReady(x: number, z: number): boolean { return this.loaded(x, z); }
  getSurface(): number { return 0; }
  getChanges(): BlockChange[] { return [...this.blocks.values()].map(block => ({ ...block })); }
  clone(): FarmWorld { const other = new FarmWorld(); other.blocks = new Map(this.getChanges().map(block => [`${block.x},${block.y},${block.z}`, block])); other.loaded = this.loaded; return other; }
}
const player = { x: .5, y: 1, z: .5 };
function fixture(seed = 'crop-test', saved?: FarmState, world = new FarmWorld()) {
  const drops: Array<{ stack: ItemStack; position: Vec3 }> = [], changes: Array<{ position: Vec3; oldId: number; newId: number }> = [];
  const farm = new FarmingSystem(world, seed, saved, { dropItem: (stack, position) => drops.push({ stack, position }), changed: (position, oldId, newId) => changes.push({ position, oldId, newId }) });
  const edit = (x: number, y: number, z: number, id: number) => { const old = world.getBlock(x, y, z); world.setBlock(x, y, z, id); farm.notifyBlockChanged({ x, y, z }, old, id); };
  const plant = (id = 30, x = 0, z = 0, wet = false) => { edit(x, 0, z, wet ? FARMLAND.wet : FARMLAND.dry); edit(x, 1, z, id); };
  return { farm, world, drops, changes, edit, plant };
}
function advance(farm: FarmingSystem, seconds: number, daylight = 15, position = player) { for (let i = 0; i < seconds * 4; i++) farm.step(.25, position, daylight); }

describe('crop registry and harvest results', () => {
  it('maps only the complete agreed crop stage ranges', () => {
    for (const crop of Object.values(CROP_DEFINITIONS)) {
      expect(cropAt(crop.firstId)).toEqual({ definition: crop, stage: 0, mature: false });
      expect(cropAt(crop.matureId)).toEqual({ definition: crop, stage: crop.stages - 1, mature: true });
    }
    for (const id of [0, 28, 29, 58, 59, 30.5]) expect(cropAt(id)).toBeNull();
  });
  it.each(Object.values(CROP_DEFINITIONS))('returns just the planting item when immature: $kind', crop => {
    expect(harvestCrop(crop.firstId, () => .9)).toEqual([{ id: crop.seedItem, count: 1 }]);
  });
  it('returns mature produce and valid seed yields without zero-count items', () => {
    expect(harvestCrop(37, () => 0)).toEqual([{ id: 'wheat', count: 1 }]);
    expect(harvestCrop(37, () => .99)).toEqual([{ id: 'wheat', count: 1 }, { id: 'wheat_seeds', count: 3 }]);
    expect(harvestCrop(45, () => 0)).toEqual([{ id: 'carrot', count: 2 }]);
    expect(harvestCrop(53, () => .99)).toEqual([{ id: 'potato', count: 5 }]);
    expect(harvestCrop(57, () => .99)).toEqual([{ id: 'beetroot', count: 1 }, { id: 'beetroot_seeds', count: 4 }]);
    expect(harvestCrop(58)).toEqual([]);
  });
  it('adds one poisonous potato on an independent two-percent mature-potato roll', () => {
    for (const [chance, poisoned] of [[.019999, true], [.02, false], [.9, false]] as const) {
      const draws = [.75, chance];
      expect(harvestCrop(53, () => draws.shift()!)).toEqual([
        { id: 'potato', count: 5 }, ...(poisoned ? [{ id: 'poisonous_potato', count: 1 }] : []),
      ]);
      expect(draws).toHaveLength(0);
    }
    expect(harvestCrop(46, () => 0)).toEqual([{ id: 'potato', count: 1 }]);
  });
  it('preserves the potato harvest random sequence after saving and reloading', () => {
    const original = fixture('potato-harvest');
    for (let i = 0; i < 7; i++) harvestCrop(53, original.farm.nextRandom);
    const restored = fixture('ignored', original.farm.snapshot());
    const a = Array.from({ length: 1000 }, () => harvestCrop(53, original.farm.nextRandom));
    const b = Array.from({ length: 1000 }, () => harvestCrop(53, restored.farm.nextRandom));
    expect(a).toEqual(b);
    expect(a.some(stacks => stacks.some(stack => stack.id === 'poisonous_potato'))).toBe(true);
    expect(original.farm.snapshot()).toEqual(restored.farm.snapshot());
  });
});

describe('irrigation, drought and growth', () => {
  it.each([0, 1])('hydrates from water four blocks diagonally away at vertical offset %i', waterY => {
    const { farm, world, plant } = fixture(); plant(); world.setBlock(4, waterY, 4, 6);
    advance(farm, .25);
    expect(world.getBlock(0, 0, 0)).toBe(FARMLAND.wet);
    expect(farm.snapshot().plots[0].moisture).toBe(7);
  });
  it.each([{ x: 5, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 2, z: 0 }])('does not irrigate from out-of-range water at $x,$y,$z', water => {
    const { farm, world, plant } = fixture(); plant(); world.setBlock(water.x, water.y, water.z, 6);
    advance(farm, 20);
    expect(world.getBlock(0, 0, 0)).toBe(FARMLAND.dry);
    expect(farm.snapshot().plots[0].moisture).toBe(0);
    expect(cropAt(world.getBlock(0, 1, 0))).not.toBeNull();
  });
  it('returns empty dry farmland to dirt, while dry farmland with a crop stays usable', () => {
    const empty = fixture(), planted = fixture();
    empty.edit(0, 0, 0, FARMLAND.dry); planted.plant();
    advance(empty.farm, 10.25); advance(planted.farm, 100);
    expect(empty.world.getBlock(0, 0, 0)).toBe(2); expect(empty.farm.size).toBe(0);
    expect(planted.world.getBlock(0, 0, 0)).toBe(FARMLAND.dry); expect(planted.farm.size).toBe(1);
  });
  it('keeps legal height-95 farmland through reload, then dries it back to dirt', () => {
    const original = fixture(); original.edit(0, 95, 0, FARMLAND.dry);
    expect(original.farm.snapshot().plots).toHaveLength(1);
    const restored = fixture('ignored', original.farm.snapshot(), original.world.clone());
    advance(restored.farm, 10.25, 15, { x: .5, y: 95, z: .5 });
    expect(restored.world.getBlock(0, 95, 0)).toBe(2);
    expect(restored.farm.size).toBe(0);
  });
  it('gradually loses water after irrigation is removed and then reverts when bare', () => {
    const { farm, world, edit } = fixture(); edit(0, 0, 0, FARMLAND.dry); world.setBlock(1, 0, 0, 6);
    advance(farm, 1); world.setBlock(1, 0, 0, 2); advance(farm, 60);
    expect(farm.snapshot().plots[0].moisture).toBe(1); expect(world.getBlock(0, 0, 0)).toBe(FARMLAND.wet);
    advance(farm, 10); expect(world.getBlock(0, 0, 0)).toBe(2); expect(farm.size).toBe(0);
  });
  it.each(Object.values(CROP_DEFINITIONS))('grows $kind to maturity but never beyond its range', crop => {
    const { farm, world, plant } = fixture(crop.kind); plant(crop.firstId); world.setBlock(1, 0, 0, 6);
    advance(farm, 450); expect(world.getBlock(0, 1, 0)).toBe(crop.matureId);
    const matureRandom = farm.snapshot().randomState; advance(farm, 100);
    expect(world.getBlock(0, 1, 0)).toBe(crop.matureId); expect(farm.snapshot().randomState).toBe(matureRandom);
  });
  it('hydrated farmland grows faster than an otherwise identical dry crop', () => {
    const wet = fixture(), dry = fixture(); wet.plant(); dry.plant(); wet.world.setBlock(1, 0, 0, 6);
    advance(wet.farm, 120); advance(dry.farm, 120);
    expect(wet.world.getBlock(0, 1, 0)).toBeGreaterThan(dry.world.getBlock(0, 1, 0));
  });
  it('irrigates and grows correctly at negative chunk coordinates', () => {
    const { farm, world, plant } = fixture(); plant(30, -17, -1); world.setBlock(-13, 1, 3, 6);
    advance(farm, 65, 15, { x: -16.5, y: 1, z: -.5 });
    expect(world.getBlock(-17, 0, -1)).toBe(FARMLAND.wet); expect(world.getBlock(-17, 1, -1)).toBeGreaterThan(30);
  });
});

describe('light, obstruction and exactly-once removal', () => {
  it('does not grow in darkness and can grow by a nearby torch at night', () => {
    const { farm, world, plant } = fixture(); plant(); world.setBlock(1, 0, 0, 6);
    advance(farm, 100, 0); expect(world.getBlock(0, 1, 0)).toBe(30);
    world.setBlock(2, 1, 0, 16); advance(farm, 65, 0); expect(world.getBlock(0, 1, 0)).toBeGreaterThan(30);
  });
  it('does not grow in a closed opaque box by daylight or by a torch outside its wall', () => {
    const { farm, world, plant } = fixture(); plant(); world.setBlock(0, 0, -1, 6);
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = 1; y <= 3; y++) if (x !== 0 || z !== 0 || y === 3) world.setBlock(x, y, z, 3);
    world.setBlock(2, 1, 0, 16); advance(farm, 100, 15);
    expect(world.getBlock(0, 1, 0)).toBe(30);
  });
  it('drops a crop exactly once when farmland is removed', () => {
    const { farm, world, drops, plant, edit } = fixture(); plant(45);
    edit(0, 0, 0, 2); expect(world.getBlock(0, 1, 0)).toBe(0); expect(drops).toHaveLength(1); expect(drops[0].stack.id).toBe('carrot');
    farm.notifyBlockChanged({ x: 0, y: 0, z: 0 }, FARMLAND.dry, 2); advance(farm, 20);
    expect(drops).toHaveLength(1); expect(farm.size).toBe(0);
  });
  it('drops a covered crop once and does not repeat its drops on later scans', () => {
    const { farm, world, drops, plant, edit } = fixture(); plant(); world.setBlock(1, 0, 0, 6);
    edit(0, 2, 0, 3); expect(drops.map(drop => drop.stack)).toEqual([{ id: 'wheat_seeds', count: 1 }]);
    farm.notifyBlockChanged({ x: 0, y: 2, z: 0 }, 0, 3); advance(farm, 100);
    expect(world.getBlock(0, 1, 0)).toBe(0); expect(drops).toHaveLength(1);
  });
  it('does not duplicate drops when an external harvest already removed the crop', () => {
    const { farm, world, drops, plant, edit } = fixture(); plant(37);
    const harvested = harvestCrop(37, farm.nextRandom); edit(0, 1, 0, 0); advance(farm, .25);
    expect(harvested.find(item => item.id === 'wheat')?.count).toBe(1); expect(drops).toHaveLength(0); expect(world.getBlock(0, 1, 0)).toBe(0);
  });
});

describe('bone meal', () => {
  it.each(Object.values(CROP_DEFINITIONS))('advances $kind and reports false once mature', crop => {
    const { farm, world, plant } = fixture(); plant(crop.firstId);
    expect(farm.fertilize({ x: 0, y: 1, z: 0 })).toBe(true); expect(world.getBlock(0, 1, 0)).toBeGreaterThan(crop.firstId);
    for (let i = 0; i < 10; i++) farm.fertilize({ x: 0, y: 1, z: 0 });
    expect(world.getBlock(0, 1, 0)).toBe(crop.matureId);
    const random = farm.snapshot().randomState; expect(farm.fertilize({ x: 0, y: 1, z: 0 })).toBe(false); expect(farm.snapshot().randomState).toBe(random);
  });
  it('refuses bone meal on unsupported, obstructed or unloaded crops without consuming randomness', () => {
    const { farm, world, plant } = fixture(); plant();
    const before = farm.snapshot().randomState; world.loaded = () => false; expect(farm.fertilize({ x: 0, y: 1, z: 0 })).toBe(false);
    world.loaded = () => true; world.setBlock(0, 2, 0, 3); expect(farm.fertilize({ x: 0, y: 1, z: 0 })).toBe(false);
    world.setBlock(0, 2, 0, 0); world.setBlock(0, 0, 0, 2); expect(farm.fertilize({ x: 0, y: 1, z: 0 })).toBe(false);
    expect(farm.snapshot().randomState).toBe(before);
  });
});

describe('bounded scheduling and saved deterministic state', () => {
  it('does not read or progress plots in unloaded columns or outside the active range', () => {
    const { farm, world, plant } = fixture(); plant(); const initial = farm.snapshot().plots[0].growthRemaining;
    world.loaded = () => false; world.reads = 0; advance(farm, 100); expect(world.reads).toBe(0);
    world.loaded = () => true; world.reads = 0; advance(farm, 100, 15, { x: 1000, y: 1, z: 1000 }); expect(world.reads).toBe(0);
    expect(farm.snapshot().plots[0].growthRemaining).toBe(initial);
    world.setBlock(1, 0, 0, 6); advance(farm, .25); expect(initial - farm.snapshot().plots[0].growthRemaining).toBeLessThanOrEqual(.25);
  });
  it('does not dry or advance a boundary crop while its potential irrigation column is unloaded', () => {
    const { farm, world, plant } = fixture(); plant(30, 15, 0, true); world.setBlock(17, 0, 0, 6); world.loaded = x => x < 16;
    const remaining = farm.snapshot().plots[0].growthRemaining; advance(farm, 100, 15, { x: 15.5, y: 1, z: .5 });
    expect(world.getBlock(15, 0, 0)).toBe(FARMLAND.wet); expect(farm.snapshot().plots[0].growthRemaining).toBe(remaining);
    world.loaded = () => true; advance(farm, 65, 15, { x: 15.5, y: 1, z: .5 }); expect(world.getBlock(15, 1, 0)).toBeGreaterThan(30);
  });
  it('caps one step at eight plot visits even with thousands registered and a huge input delta', () => {
    const { farm, world, edit } = fixture();
    for (let i = 0; i < 2000; i++) edit(1000 + i, 0, 0, FARMLAND.dry);
    world.reads = 0; farm.step(100000, player, 15);
    expect(farm.snapshot().plots.filter(plot => plot.lastVisit > 0)).toHaveLength(FARM_SCAN_LIMIT);
    expect(world.reads).toBe(0); expect(farm.snapshot().clock).toBe(1);
  });
  it('preserves growth timers, hydration, scheduler and random state exactly across save/load', () => {
    const initial = fixture('persistent-crops'); initial.plant(30); initial.plant(38, 2); initial.plant(54, -2); initial.world.setBlock(0, 0, 2, 6);
    advance(initial.farm, 37.5);
    const saved = JSON.parse(JSON.stringify(initial.farm.snapshot()));
    const restored = fixture('a different seed must not replace saved RNG', saved, initial.world.clone());
    advance(initial.farm, 250); advance(restored.farm, 250);
    expect(restored.farm.snapshot()).toEqual(initial.farm.snapshot()); expect(restored.world.getChanges()).toEqual(initial.world.getChanges());
    expect(harvestCrop(37, restored.farm.nextRandom)).toEqual(harvestCrop(37, initial.farm.nextRandom));
  });
  it('returns detached snapshots and rejects malformed or duplicate plot state', () => {
    const { farm, plant } = fixture(); plant(); const saved = farm.snapshot(); saved.plots[0].moisture = 6;
    expect(farm.snapshot().plots[0].moisture).toBe(0);
    const duplicate = farm.snapshot(); duplicate.plots.push({ ...duplicate.plots[0] });
    expect(() => new FarmingSystem(new FarmWorld(), 'bad', duplicate)).toThrow();
    expect(() => new FarmingSystem(new FarmWorld(), 'bad', { ...farm.snapshot(), randomState: Infinity })).toThrow();
  });
});
