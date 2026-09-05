import { BLOCKS } from './registry';
import { fluidBlock, fluidInfo, isFluid, isLava, isWater } from './fluid-blocks';
import type { FluidKind } from './fluid-blocks';
import type { Vec3, WorldPort } from './types';

export interface FluidTask extends Vec3 {
  kind: FluidKind;
  /** Absolute simulation time. Overdue tasks may be waiting for a loaded column. */
  due: number;
}
export interface FluidState {
  version: 1;
  clock: number;
  scanCursor: number;
  /** In scheduling order, unique by x,y,z,kind. */
  tasks: FluidTask[];
}
export interface FluidCallbacks {
  /** Owns the actual edit and plant drops. May synchronously call notifyBlockChanged. */
  setBlock(x: number, y: number, z: number, id: number): boolean;
}
export const FLUID_QUEUE_LIMIT = 8192;
export const FLUID_TASK_BUDGET = 64;
export const FLUID_INSPECTION_BUDGET = 128;
export const FLUID_SCAN_BUDGET = 32;
export const FLUID_SCAN_RADIUS = 8;
export const FLUID_SCAN_HEIGHT_RADIUS = 4;
export const FLUID_SCAN_SIZE = 17 * 17 * 9;
export const FLUID_ACTIVE_RADIUS = 64;
export const FLUID_WATER_INTERVAL = .25;
export const FLUID_LAVA_INTERVAL = 1.5;

const MIN_Y = -16, MAX_Y = 95;
const horizontal = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const;
const neighbors = [[0, -1, 0], ...horizontal, [0, 1, 0]] as const;
const delay = (kind: FluidKind) => kind === 'water' ? FLUID_WATER_INTERVAL : FLUID_LAVA_INTERVAL;
const keyOf = (p: Vec3, kind: FluidKind) => `${p.x},${p.y},${p.z},${kind}`;
const offset = (p: Vec3, d: readonly number[]): Vec3 => ({ x: p.x + d[0], y: p.y + d[1], z: p.z + d[2] });
const finitePosition = (p: Vec3) => [p.x, p.y, p.z].every(Number.isFinite) && Math.abs(p.x) <= 30_000_000 && Math.abs(p.z) <= 30_000_000;
const validBlock = (p: Vec3) => finitePosition(p) && p.y >= MIN_Y && p.y <= MAX_Y && [p.x, p.y, p.z].every(Number.isInteger);
const replaceable = (id: number) => id === 0 || id === 16 || id === 20 || (id >= 30 && id <= 58) || id === 83;

/**
 * Deterministic local relaxation of fluid levels. Downward edges take priority;
 * horizontal levels strictly increase away from their supply, so unsupported
 * flows drain instead of becoming new sources. Only water's two-source rule
 * deliberately creates an independent source.
 */
export class FluidSystem {
  private clock = 0;
  private scanCursor = 0;
  private tasks = new Map<string, FluidTask>();

  constructor(private readonly world: WorldPort, saved: FluidState | undefined, private readonly callbacks: FluidCallbacks) {
    if (saved) {
      if (saved.version !== 1 || !Number.isFinite(saved.clock) || saved.clock < 0 || !Number.isInteger(saved.scanCursor) || saved.scanCursor < 0 || saved.scanCursor >= FLUID_SCAN_SIZE || !Array.isArray(saved.tasks) || saved.tasks.length > FLUID_QUEUE_LIMIT) throw new Error('无效的流体存档');
      this.clock = saved.clock; this.scanCursor = saved.scanCursor;
      for (const task of saved.tasks) {
        if (!validBlock(task) || (task.kind !== 'water' && task.kind !== 'lava') || !Number.isFinite(task.due) || task.due < 0 || task.due > saved.clock + FLUID_LAVA_INTERVAL || this.tasks.has(keyOf(task, task.kind))) throw new Error('无效或重复的流体任务');
        this.tasks.set(keyOf(task, task.kind), { ...task });
      }
    } else {
      // Existing edits are finite save data; untouched natural terrain is only
      // sampled in the small moving window below, never scanned globally.
      for (const change of world.getChanges()) {
        if (isFluid(change.id)) this.notifyBlockChanged(change, 0, change.id);
        if (this.tasks.size >= FLUID_QUEUE_LIMIT) break;
      }
    }
  }
  get pendingCount(): number { return this.tasks.size; }
  private enqueue(position: Vec3, kind: FluidKind, due = this.clock + delay(kind)): void {
    if (!validBlock(position)) return;
    const key = keyOf(position, kind), existing = this.tasks.get(key);
    if (existing) { existing.due = Math.min(existing.due, due); return; }
    if (this.tasks.size >= FLUID_QUEUE_LIMIT) return;
    this.tasks.set(key, { ...position, kind, due });
  }
  /** External and callback-originated notifications may safely be repeated. */
  notifyBlockChanged(position: Vec3, oldId: number, newId: number): void {
    if (!finitePosition(position)) return;
    const p = { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) };
    if (!validBlock(p)) return;
    const kinds = new Set<FluidKind>();
    const oldFluid = fluidInfo(oldId), newFluid = fluidInfo(newId);
    if (oldFluid) kinds.add(oldFluid.kind);
    if (newFluid) kinds.add(newFluid.kind);
    for (const d of neighbors) {
      const id = this.read(offset(p, d));
      const info = id === undefined ? undefined : fluidInfo(id);
      if (info) kinds.add(info.kind);
    }
    for (const kind of kinds) {
      this.enqueue(p, kind);
      for (const d of neighbors) this.enqueue(offset(p, d), kind);
    }
  }
  private read(position: Vec3): number | undefined {
    // Above the world is known air, below it known bedrock, not an unloaded cell.
    if (position.y > MAX_Y) return 0;
    if (position.y < MIN_Y) return 24;
    if (!finitePosition(position) || !this.world.isReady(position.x, position.z)) return undefined;
    return this.world.getBlock(position.x, position.y, position.z);
  }
  private write(position: Vec3, id: number): boolean {
    if (!validBlock(position) || !this.world.isReady(position.x, position.z)) return false;
    const old = this.world.getBlock(position.x, position.y, position.z);
    if (old === id || !this.callbacks.setBlock(position.x, position.y, position.z, id)) return false;
    if (this.world.getBlock(position.x, position.y, position.z) !== id) return false;
    // A callback can already have notified us; enqueue deduplication makes both
    // callback contracts safe without recursively running a simulation step.
    this.notifyBlockChanged(position, old, id);
    return true;
  }
  private solid(id: number): boolean { return !isFluid(id) && !!BLOCKS[id]?.solid; }
  private downwardOpen(position: Vec3, kind: FluidKind): boolean {
    const below = this.read({ ...position, y: position.y - 1 });
    if (below === undefined) return false;
    const info = fluidInfo(below);
    return replaceable(below) || (!!info && info.kind === kind && !info.source);
  }
  /** Contact conversion writes each affected block once through the owner. */
  private react(position: Vec3, id: number): boolean {
    const above = this.read({ ...position, y: position.y + 1 });
    if (isWater(id)) {
      if (above !== undefined && isLava(above)) return this.write(position, 3);
      for (const d of [[0, -1, 0], ...horizontal]) {
        const p = offset(position, d), neighborId = this.read(p);
        if (neighborId !== undefined && isLava(neighborId)) this.write(p, fluidInfo(neighborId)!.source ? 81 : 12);
      }
    } else if (isLava(id)) {
      if ((above !== undefined && isWater(above)) || horizontal.some(d => { const value = this.read(offset(position, d)); return value !== undefined && isWater(value); })) return this.write(position, fluidInfo(id)!.source ? 81 : 12);
      const belowPosition = { ...position, y: position.y - 1 }, below = this.read(belowPosition);
      if (below !== undefined && isWater(below)) this.write(belowPosition, 3);
    }
    return false;
  }
  private process(task: FluidTask): void {
    const current = this.read(task);
    if (current === undefined) return;
    // A missing horizontal neighbor could be the supply of an existing flow.
    // Retain the task and its fluid until those columns are available.
    if (horizontal.some(d => this.read(offset(task, d)) === undefined)) {
      this.enqueue(task, task.kind); return;
    }
    if (this.react(task, current)) return;
    const info = fluidInfo(current);
    if (info?.kind !== task.kind && !replaceable(current)) return;
    if (info?.source) return;
    const above = this.read({ ...task, y: task.y + 1 }), aboveFluid = above === undefined ? undefined : fluidInfo(above);
    let desired = 0;
    if (task.kind === 'water') {
      const sources = horizontal.filter(d => this.read(offset(task, d)) === 6).length;
      const below = this.read({ ...task, y: task.y - 1 });
      if (sources >= 2 && below !== undefined && (below === 6 || this.solid(below))) desired = 6;
    }
    if (!desired && aboveFluid?.kind === task.kind) desired = fluidBlock(task.kind, 0, true);
    if (!desired) {
      let best = Infinity;
      for (const d of horizontal) {
        const p = offset(task, d), id = this.read(p), neighbor = id === undefined ? undefined : fluidInfo(id);
        if (!neighbor || neighbor.kind !== task.kind || this.downwardOpen(p, task.kind)) continue;
        best = Math.min(best, neighbor.level + (task.kind === 'water' ? 1 : 2));
      }
      if (Number.isFinite(best)) desired = fluidBlock(task.kind, best);
    }
    if (desired) this.write(task, desired);
    else if (info?.kind === task.kind) this.write(task, 0);
  }
  private scan(player: Vec3): void {
    const base = { x: Math.floor(player.x), y: Math.floor(player.y), z: Math.floor(player.z) };
    for (let i = 0; i < FLUID_SCAN_BUDGET; i++) {
      const index = this.scanCursor;
      this.scanCursor = (this.scanCursor + 1) % FLUID_SCAN_SIZE;
      const p = { x: base.x + index % 17 - FLUID_SCAN_RADIUS, z: base.z + Math.floor(index / 17) % 17 - FLUID_SCAN_RADIUS, y: base.y + Math.floor(index / (17 * 17)) - FLUID_SCAN_HEIGHT_RADIUS };
      if (!validBlock(p)) continue;
      const id = this.read(p), info = id === undefined ? undefined : fluidInfo(id);
      if (!info) continue;
      const exposed = !info.source || neighbors.some(d => {
        const at = offset(p, d), other = this.read(at), otherFluid = other === undefined ? undefined : fluidInfo(other);
        return other !== undefined && (replaceable(other) || (!!otherFluid && (otherFluid.kind !== info.kind || !otherFluid.source)));
      });
      if (exposed) this.notifyBlockChanged(p, id!, id!);
    }
  }
  step(dt: number, playerPosition: Vec3): void {
    if (!Number.isFinite(dt) || dt <= 0 || !finitePosition(playerPosition)) return;
    this.clock += Math.min(dt, 1);
    this.scan(playerPosition);
    const candidates: FluidTask[] = [];
    for (const task of this.tasks.values()) { candidates.push(task); if (candidates.length >= FLUID_INSPECTION_BUDGET) break; }
    let processed = 0;
    for (const task of candidates) {
      if (processed >= FLUID_TASK_BUDGET) break;
      const key = keyOf(task, task.kind);
      if (this.tasks.get(key) !== task) continue;
      this.tasks.delete(key);
      if (task.due > this.clock || Math.abs(task.x - playerPosition.x) > FLUID_ACTIVE_RADIUS || Math.abs(task.z - playerPosition.z) > FLUID_ACTIVE_RADIUS || Math.abs(task.y - playerPosition.y) > 128 || !this.world.isReady(task.x, task.z)) {
        this.tasks.set(key, task); continue;
      }
      processed++;
      this.process(task);
    }
  }
  snapshot(): FluidState {
    return { version: 1, clock: this.clock, scanCursor: this.scanCursor, tasks: Array.from(this.tasks.values(), task => ({ ...task })) };
  }
}
