import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewSave, Simulation } from '../src/game/Simulation';
import {
  deleteWorld, exportMigrationBackup, exportWorld, importWorld, listWorlds,
  loadMigrationBackup, loadWorld, migrationBackupIds, saveWorld, validateSave,
} from '../src/game/storage';
import type { BlockChange, SaveData, WorldPort } from '../src/game/types';

class SavedWorld implements WorldPort {
  blocks: Map<string, BlockChange>;
  loaded = (_x: number, _z: number) => true;
  constructor(changes: BlockChange[]) { this.blocks = new Map(changes.map(change => [`${change.x},${change.y},${change.z}`, { ...change }])); }
  getBlock(x: number, y: number, z: number): number { return this.blocks.get(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`)?.id ?? (y <= 0 ? 2 : 0); }
  setBlock(x: number, y: number, z: number, id: number): void { this.blocks.set(`${x},${y},${z}`, { x, y, z, id }); }
  isReady(x: number, z: number): boolean { return this.loaded(x, z); }
  getSurface(): number { return 0; }
  getChanges(): BlockChange[] { return [...this.blocks.values()].map(change => ({ ...change })); }
}

function legacyFixture(): SaveData {
  const save = createNewSave('旧版农庄', 'old-farm-seed', 'survival');
  save.manifest.version = 1; save.manifest.generatorVersion = 1;
  save.manifest.createdAt = 1234; save.manifest.updatedAt = 5678; save.manifest.playedSeconds = 90;
  delete save.farming; delete save.composters; delete save.fluids; delete save.natural;
  save.player.position = { x: .5, y: 1, z: 3.5 };
  save.player.spawn = { ...save.player.position };
  save.player.inventory[0] = { id: 'iron_pickaxe', count: 1, durability: 107 };
  save.player.inventory[1] = { id: 'wool', count: 3 };
  save.player.bedSpawn = { x: -4, y: 1, z: -2 };
  save.changes = [{ x: 2, y: 1, z: 0, id: 14 }, { x: 3, y: 1, z: 0, id: 15 }, { x: 4, y: 1, z: 0, id: 0 }];
  save.containers = {
    '2,1,0': { kind: 'furnace', slots: [{ id: 'raw_iron', count: 2 }, { id: 'charcoal', count: 3 }, { id: 'iron_ingot', count: 1 }], burn: 51.5, burnTotal: 80, progress: 6.5 },
    '3,1,0': { kind: 'chest', slots: Array.from({ length: 27 }, (_, index) => index === 0 ? { id: 'torch', count: 15 } : null) },
  };
  save.entities = [{ id: 'old-sheep', kind: 'sheep', position: { x: 5.3, y: 1, z: -2.4 }, health: 8, yaw: .25, timer: -3.5 }];
  save.drops = [{ id: 'old-drop', stack: { id: 'log', count: 2 }, position: { x: 1.2, y: 1.1, z: -3.4 }, age: -.65 }];
  save.time = 17999.5;
  return save;
}

function agriculturalFixture(): SaveData {
  const save = legacyFixture();
  save.manifest.version = 2; save.manifest.generatorVersion = 2;
  save.manifest.name = '农牧保存验收';
  save.changes.push({ x: -17, y: 0, z: -1, id: 29 }, { x: -17, y: 1, z: -1, id: 33 }, { x: -16, y: 0, z: -1, id: 6 }, { x: 6, y: 1, z: 0, id: 66 });
  save.farming = {
    version: 1, randomState: 123456789, clock: 12.5, accumulator: .125, scanCursor: 0,
    plots: [{ x: -17, y: 0, z: -1, moisture: 7, drySeconds: .5, growthRemaining: 23.75, lastVisit: 12.25, active: true }],
  };
  save.composters = { '6,1,0': .65 };
  save.entities = [
    { id: 'baby-pig', kind: 'pig', position: { x: 5.4, y: 1, z: -3.5 }, health: 10, yaw: .3, timer: .5, age: -890.5, love: 0, breedCooldown: 0, courtship: 0 },
    { id: 'sheared-sheep', kind: 'sheep', position: { x: 6.4, y: 1, z: -3.5 }, health: 8, yaw: -.3, timer: -.5, age: 0, love: 0, breedCooldown: 201.25, courtship: 0, sheared: true, woolTimer: 17.5 },
  ];
  save.player.inventory[2] = { id: 'wheat_seeds', count: 12 };
  save.player.inventory[3] = { id: 'potato', count: 7 };
  save.player.inventory[4] = { id: 'poisonous_potato', count: 1 };
  save.drops.push({ id: 'beet-drop', stack: { id: 'beetroot', count: 3 }, position: { x: -16.5, y: 1.2, z: -.5 }, age: 2.25 });
  return save;
}

function upgrade(old: SaveData): SaveData { return new Simulation(new SavedWorld(old.changes), old).snapshot(); }

async function seedVersionOneDatabase(save: SaveData): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('voxel-homestead', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('worlds', { keyPath: 'manifest.id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('worlds', 'readwrite');
      tx.objectStore('worlds').add(save);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

function captureDownload() {
  const blobs: Blob[] = [];
  const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  const append = vi.fn();
  vi.stubGlobal('document', { createElement: vi.fn(() => link), body: { append } });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blobs.push(value as Blob); return `blob:test-${blobs.length}`; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return { blobs, link, append };
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('version 2 agriculture and livestock validation', () => {
  it('round trips crop growth, fractional breeding timers, wool regrowth and compost maturation', () => {
    const save = agriculturalFixture();
    expect(validateSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
    const detached = validateSave(save);
    detached.farming!.plots[0].growthRemaining = 1;
    detached.entities[0].age = 0;
    detached.composters!['6,1,0'] = 0;
    expect(save.farming!.plots[0].growthRemaining).toBe(23.75);
    expect(save.entities[0].age).toBe(-890.5);
    expect(save.composters!['6,1,0']).toBe(.65);
  });
  it.each([
    ['missing farming', (save: any) => { delete save.farming; }],
    ['unknown farm schema', (save: any) => { save.farming.version = 2; }],
    ['forged farming field', (save: any) => { save.farming.growthMultiplier = 100; }],
    ['forged plot field', (save: any) => { save.farming.plots[0].yield = 64; }],
    ['duplicate plot coordinates', (save: any) => { save.farming.plots.push({ ...save.farming.plots[0] }); }],
    ['fractional plot coordinate', (save: any) => { save.farming.plots[0].x += .5; }],
    ['plot without farmland', (save: any) => { save.changes[3].id = 2; }],
    ['farmland without plot', (save: any) => { save.farming.plots = []; }],
    ['negative random state', (save: any) => { save.farming.randomState = -1; }],
    ['out-of-range random state', (save: any) => { save.farming.randomState = 0x100000000; }],
    ['non-integer random state', (save: any) => { save.farming.randomState = 1.5; }],
    ['non-finite farming clock', (save: any) => { save.farming.clock = Infinity; }],
    ['negative farming clock', (save: any) => { save.farming.clock = -1; }],
    ['unprocessed scan accumulator', (save: any) => { save.farming.accumulator = .25; }],
    ['out-of-range scan cursor', (save: any) => { save.farming.scanCursor = 1; }],
    ['future plot visit', (save: any) => { save.farming.plots[0].lastVisit = 12.75; }],
    ['non-boolean active flag', (save: any) => { save.farming.plots[0].active = 1; }],
    ['excessive moisture', (save: any) => { save.farming.plots[0].moisture = 8; }],
    ['fractional moisture', (save: any) => { save.farming.plots[0].moisture = 6.5; }],
    ['negative growth time', (save: any) => { save.farming.plots[0].growthRemaining = -1; }],
    ['growth time over maximum', (save: any) => { save.farming.plots[0].growthRemaining = 60.1; }],
    ['unprocessed drought timer', (save: any) => { save.farming.plots[0].drySeconds = 10; }],
    ['missing composter timer', (save: any) => { delete save.composters['6,1,0']; }],
    ['timer without full composter', (save: any) => { save.changes[6].id = 65; }],
    ['timer on finished compost', (save: any) => { save.changes[6].id = 67; }],
    ['noncanonical composter coordinates', (save: any) => { save.composters['06,1,0'] = .5; }],
    ['negative compost timer', (save: any) => { save.composters['6,1,0'] = -.1; }],
    ['excessive compost timer', (save: any) => { save.composters['6,1,0'] = 1.1; }],
    ['non-finite compost timer', (save: any) => { save.composters['6,1,0'] = NaN; }],
    ['positive animal age', (save: any) => { save.entities[0].age = .01; }],
    ['baby age below birth age', (save: any) => { save.entities[0].age = -1200.01; }],
    ['non-finite animal age', (save: any) => { save.entities[0].age = Infinity; }],
    ['excessive love time', (save: any) => { save.entities[0].love = 60.1; }],
    ['negative breeding cooldown', (save: any) => { save.entities[0].breedCooldown = -.01; }],
    ['excessive breeding cooldown', (save: any) => { save.entities[0].breedCooldown = 300.1; }],
    ['excessive courtship time', (save: any) => { save.entities[0].courtship = 3.1; }],
    ['wool on pig', (save: any) => { save.entities[0].sheared = true; }],
    ['wool timer on pig', (save: any) => { save.entities[0].woolTimer = 12; }],
    ['numeric sheared flag', (save: any) => { save.entities[1].sheared = 1; }],
    ['excessive wool timer', (save: any) => { save.entities[1].woolTimer = 30.1; }],
    ['forged livestock field', (save: any) => { save.entities[0].offspring = 999; }],
    ['breeding hostile entity', (save: any) => { save.entities[0].kind = 'zombie'; }],
  ])('rejects %s', (_, mutate) => {
    const save = agriculturalFixture(); mutate(save);
    expect(() => validateSave(save)).toThrow('存档校验失败');
  });
  it.each([-16, 95])('accepts farmland at legal world height %i without a crop outside the world', y => {
    const save = agriculturalFixture();
    save.changes[3].y = y; save.farming!.plots[0].y = y;
    save.changes.splice(4, 1);
    expect(() => validateSave(save)).not.toThrow();
  });
  it('allows newborn/adult endpoints and an already-finished composter without a timer', () => {
    const save = agriculturalFixture();
    save.entities[0].age = -1200; save.entities[1].age = 0;
    save.entities[0].love = 60; save.entities[0].breedCooldown = 300; save.entities[0].courtship = 3;
    save.entities[1].woolTimer = 30;
    save.changes[6].id = 67; save.composters = {};
    expect(validateSave(save)).toEqual(save);
  });
  it('preserves a full composter and its save timer when an explosion reaches an unloaded column', () => {
    const save = agriculturalFixture(), world = new SavedWorld(save.changes);
    world.loaded = x => x < 5;
    const sim = new Simulation(world, save);
    sim.explode({ x: 4.5, y: 1.5, z: .5 });
    expect(world.getBlock(6, 1, 0)).toBe(66);
    expect(sim.composters['6,1,0']).toBe(.65);
    expect(() => validateSave(sim.snapshot())).not.toThrow();
  });
});

describe('legacy migration and original checkpoint backups', () => {
  it('loads an existing version-1 database unchanged and upgrades only a Simulation snapshot', async () => {
    const legacy = legacyFixture(); await seedVersionOneDatabase(legacy);
    const loaded = await loadWorld(legacy.manifest.id);
    expect(loaded).toEqual(legacy);
    expect(await loadMigrationBackup(legacy.manifest.id)).toBeNull();
    const next = upgrade(loaded!);
    expect(next.manifest.version).toBe(5); expect(next.manifest.generatorVersion).toBe(1);
    expect(next.farming!.plots).toEqual([]); expect(next.composters).toEqual({});
    expect(validateSave(next)).toEqual(next);
    expect(await loadWorld(legacy.manifest.id)).toEqual(legacy);
  });
  it('rejects agricultural state masquerading as a version-1 checkpoint', () => {
    const legacy = legacyFixture();
    legacy.entities[0].age = -100;
    expect(() => validateSave(legacy)).toThrow('存档校验失败');
    delete legacy.entities[0].age;
    legacy.farming = agriculturalFixture().farming;
    expect(() => validateSave(legacy)).toThrow('存档校验失败');
  });
  it('backs up the complete old checkpoint once, then keeps it through later saves', async () => {
    const legacy = legacyFixture(); await saveWorld(legacy);
    const next = upgrade(legacy); await saveWorld(next);
    expect(await loadWorld(legacy.manifest.id)).toEqual(next);
    expect(await loadMigrationBackup(legacy.manifest.id)).toEqual(legacy);
    expect(await migrationBackupIds()).toEqual([legacy.manifest.id]);
    next.player.inventory[1] = { id: 'wheat', count: 19 };
    const furnace = next.containers['2,1,0'];
    if (furnace.kind !== 'furnace') throw new Error('Fixture furnace missing');
    furnace.progress = 8.5;
    await saveWorld(next);
    expect(await loadWorld(legacy.manifest.id)).toEqual(next);
    expect(await loadMigrationBackup(legacy.manifest.id)).toEqual(legacy);
    expect(await migrationBackupIds()).toEqual([legacy.manifest.id]);
  });
  it.each(['put', 'add'] as const)('atomically rolls back both stores when migration %s throws', async operation => {
    const legacy = legacyFixture(); await saveWorld(legacy);
    const original = IDBObjectStore.prototype[operation];
    const failure = vi.spyOn(IDBObjectStore.prototype, operation).mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === (operation === 'put' ? 'worlds' : 'migration-backups')) throw new DOMException('Injected migration quota failure', 'QuotaExceededError');
      return original.call(this, value, key);
    });
    const next = upgrade(legacy);
    await expect(saveWorld(next)).rejects.toThrow('Injected migration quota failure');
    expect(await loadWorld(legacy.manifest.id)).toEqual(legacy);
    expect(await loadMigrationBackup(legacy.manifest.id)).toBeNull();
    expect(await migrationBackupIds()).toEqual([]);
    failure.mockRestore();
    await saveWorld(next);
    expect(await loadWorld(legacy.manifest.id)).toEqual(next);
    expect(await loadMigrationBackup(legacy.manifest.id)).toEqual(legacy);
  });
  it.each(['put', 'add'] as const)('does not report durable migration when %s succeeds but its transaction aborts', async operation => {
    const legacy = legacyFixture(); await saveWorld(legacy);
    const original = IDBObjectStore.prototype[operation];
    vi.spyOn(IDBObjectStore.prototype, operation).mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = original.call(this, value, key);
      if (this.name === (operation === 'put' ? 'worlds' : 'migration-backups')) request.addEventListener('success', () => this.transaction.abort(), { once: true });
      return request;
    });
    await expect(saveWorld(upgrade(legacy))).rejects.toThrow('中断');
    expect(await loadWorld(legacy.manifest.id)).toEqual(legacy);
    expect(await loadMigrationBackup(legacy.manifest.id)).toBeNull();
    expect(await migrationBackupIds()).toEqual([]);
  });
  it('preserves both the upgraded checkpoint and existing backup after a later save fails', async () => {
    const legacy = legacyFixture(); await saveWorld(legacy);
    const current = upgrade(legacy); await saveWorld(current);
    const next = structuredClone(current); next.player.inventory[1] = { id: 'carrot', count: 32 };
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new Error('Interrupted later save'); });
    await expect(saveWorld(next)).rejects.toThrow('Interrupted later save');
    expect(await loadWorld(legacy.manifest.id)).toEqual(current);
    expect(await loadMigrationBackup(legacy.manifest.id)).toEqual(legacy);
  });
  it('exports a usable old checkpoint without modifying its stored original', async () => {
    const legacy = legacyFixture(); await saveWorld(legacy); await saveWorld(upgrade(legacy));
    const download = captureDownload(); await exportMigrationBackup(legacy.manifest.id);
    expect(download.link.click).toHaveBeenCalledOnce(); expect(download.link.remove).toHaveBeenCalledOnce();
    expect(download.append).toHaveBeenCalledWith(download.link);
    const exported = validateSave(JSON.parse(await download.blobs[0].text()));
    expect(exported.manifest.version).toBe(1); expect(exported.manifest.generatorVersion).toBe(1);
    expect({ ...exported, manifest: { ...exported.manifest, name: legacy.manifest.name } }).toEqual(legacy);
    expect(await loadMigrationBackup(legacy.manifest.id)).toEqual(legacy);
    const imported = await importWorld(await download.blobs[0].text());
    expect(imported.id).not.toBe(legacy.manifest.id); expect(imported.version).toBe(1);
  });
  it('deletes a world and its backups while preserving another migrated world', async () => {
    const a = legacyFixture(), b = legacyFixture();
    await saveWorld(a); await saveWorld(upgrade(a)); await saveWorld(b); await saveWorld(upgrade(b));
    await deleteWorld(a.manifest.id);
    expect(await loadWorld(a.manifest.id)).toBeNull(); expect(await loadMigrationBackup(a.manifest.id)).toBeNull();
    expect(await migrationBackupIds()).toEqual([b.manifest.id]);
    expect(await loadMigrationBackup(b.manifest.id)).toEqual(b);
    await expect(exportMigrationBackup(a.manifest.id)).rejects.toThrow('没有找到升级前备份');
  });
});

describe('agricultural import and export', () => {
  it('exports and imports growing crops, baby animals, sheared sheep and compost as an independent world', async () => {
    const original = agriculturalFixture(); await saveWorld(original);
    const download = captureDownload(); await exportWorld(original.manifest.id);
    const text = await download.blobs[0].text();
    expect(JSON.parse(text)).toEqual(original);
    const manifest = await importWorld(text), imported = (await loadWorld(manifest.id))!;
    expect(manifest.id).not.toBe(original.manifest.id); expect(manifest.name).toContain('（导入）');
    expect({ ...imported, manifest: original.manifest }).toEqual(original);
    const restored = new Simulation(new SavedWorld(imported.changes), imported).snapshot();
    expect(restored.farming).toEqual(original.farming);
    expect(restored.entities).toEqual(original.entities); expect(restored.composters).toEqual(original.composters);
    imported.farming!.plots[0].growthRemaining = 2.5;
    imported.entities[0].age = -100;
    imported.composters!['6,1,0'] = .1;
    await saveWorld(imported);
    expect(await loadWorld(original.manifest.id)).toEqual(original);
    expect((await listWorlds()).map(world => world.id).sort()).toEqual([original.manifest.id, manifest.id].sort());
    expect(await migrationBackupIds()).toEqual([]);
  });
  it('rejects a corrupt agriculture import before creating any partial world', async () => {
    const original = agriculturalFixture(); await saveWorld(original);
    const corrupted = structuredClone(original); corrupted.farming!.plots[0].lastVisit = 999;
    await expect(importWorld(JSON.stringify(corrupted))).rejects.toThrow('存档校验失败');
    expect((await listWorlds()).map(world => world.id)).toEqual([original.manifest.id]);
    expect(await loadWorld(original.manifest.id)).toEqual(original);
  });
});
