import { WORLD_MIN_Y, WORLD_MAX_Y } from "../engine/world-height";
import { isWater } from "./fluid-blocks";
import type { ItemStack, Vec3, WorldPort } from "./types";

export const SUGAR_CANE_BLOCK = 111;
export const SUGAR_CANE_MAX_HEIGHT = 3;
export const SUGAR_CANE_SCAN_INTERVAL = 0.25;
export const SUGAR_CANE_SCAN_RADIUS = 12;
export const SUGAR_CANE_SCAN_SIZE = (SUGAR_CANE_SCAN_RADIUS * 2 + 1) ** 3;
export const SUGAR_CANE_SCAN_BUDGET = 128;
export const SUGAR_CANE_UPDATE_BUDGET = 32;
export const SUGAR_CANE_ACTIVE_RADIUS = 48;
export const SUGAR_CANE_QUEUE_MAX = 4096;
export const SUGAR_CANE_GROWTH_MAX = 4096;
export const SUGAR_CANE_GROW_MIN_SECONDS = 60;
export const SUGAR_CANE_GROW_MAX_SECONDS = 120;
export const SUGAR_CANE_WORLD_LIMIT = 30_000_000;

export interface SugarCaneGrowth extends Vec3 {
  /** Loaded, unpaused growth seconds; position is the bottom cane segment. */
  age: number;
}
export interface SugarCaneState {
  version: 1;
  accumulator: number;
  scanCursor: number;
  /** Discovery jobs only: these records never own extra blocks or items. */
  queue: Vec3[];
  growth: SugarCaneGrowth[];
}
export interface SugarCaneCallbacks {
  setBlock(x: number, y: number, z: number, id: number): boolean;
  dropItem(position: Vec3, stack: ItemStack): void;
}

const sides = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const keyOf = (p: Vec3): string => `${p.x},${p.y},${p.z}`;
const copy = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
const validPosition = (p: Vec3): boolean =>
  p != null &&
  [p.x, p.y, p.z].every(Number.isInteger) &&
  Math.abs(p.x) <= SUGAR_CANE_WORLD_LIMIT &&
  Math.abs(p.z) <= SUGAR_CANE_WORLD_LIMIT &&
  p.y >= WORLD_MIN_Y &&
  p.y <= WORLD_MAX_Y;
type Support =
  | { status: "valid"; root: Vec3; height: number }
  | { status: "invalid" }
  | { status: "unknown" };

/**
 * Local cane survival and growth. No lighting or bone-meal requirement is used.
 * Growth takes 60–120 active seconds per segment, a deliberate game-scale
 * approximation rather than Java's random-tick timing. Paused/unloaded time is
 * never caught up. Callbacks may notify synchronously, but must not call step.
 */
export class SugarCaneSystem {
  private queue = new Map<string, Vec3>();
  private growth = new Map<string, SugarCaneGrowth>();
  private accumulator = 0;
  private scanCursor = 0;
  private readonly seed: number;

  constructor(
    private readonly world: WorldPort,
    seed: string,
    saved: SugarCaneState | undefined,
    private readonly callbacks: SugarCaneCallbacks,
  ) {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++)
      hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    this.seed = hash >>> 0;
    if (!saved) return;
    if (
      saved.version !== 1 ||
      !Number.isFinite(saved.accumulator) ||
      saved.accumulator < 0 ||
      saved.accumulator >= SUGAR_CANE_SCAN_INTERVAL ||
      !Number.isInteger(saved.scanCursor) ||
      saved.scanCursor < 0 ||
      saved.scanCursor >= SUGAR_CANE_SCAN_SIZE ||
      !Array.isArray(saved.queue) ||
      saved.queue.length > SUGAR_CANE_QUEUE_MAX ||
      !Array.isArray(saved.growth) ||
      saved.growth.length > SUGAR_CANE_GROWTH_MAX
    )
      throw new Error("无效的甘蔗更新存档");
    this.accumulator = saved.accumulator;
    this.scanCursor = saved.scanCursor;
    for (const p of saved.queue) {
      if (!validPosition(p) || this.queue.has(keyOf(p)))
        throw new Error("无效或重复的甘蔗更新位置");
      this.queue.set(keyOf(p), copy(p));
    }
    for (const p of saved.growth) {
      if (
        !validPosition(p) ||
        this.growth.has(keyOf(p)) ||
        !Number.isFinite(p.age) ||
        p.age < 0 ||
        p.age > SUGAR_CANE_GROW_MAX_SECONDS
      )
        throw new Error("无效或重复的甘蔗生长位置");
      this.growth.set(keyOf(p), { ...copy(p), age: p.age });
    }
  }

  private loaded(p: Vec3): boolean {
    return validPosition(p) && this.world.isReady(p.x, p.z, p.y);
  }
  private get(p: Vec3): number {
    return this.world.getBlock(p.x, p.y, p.z);
  }
  private active(p: Vec3, player: Vec3): boolean {
    return (
      Math.abs(p.x - player.x) <= SUGAR_CANE_ACTIVE_RADIUS &&
      Math.abs(p.y - player.y) <= SUGAR_CANE_ACTIVE_RADIUS &&
      Math.abs(p.z - player.z) <= SUGAR_CANE_ACTIVE_RADIUS &&
      this.loaded(p)
    );
  }
  private enqueue(p: Vec3): void {
    if (!validPosition(p) || this.queue.has(keyOf(p))) return;
    if (this.queue.size >= SUGAR_CANE_QUEUE_MAX)
      this.queue.delete(this.queue.keys().next().value!);
    this.queue.set(keyOf(p), copy(p));
  }
  private support(p: Vec3): Support {
    let root = copy(p),
      height = 1;
    while (true) {
      const below = { ...root, y: root.y - 1 };
      if (below.y < WORLD_MIN_Y) return { status: "invalid" };
      if (!this.loaded(below)) return { status: "unknown" };
      const ground = this.get(below);
      if (ground === SUGAR_CANE_BLOCK) {
        if (++height > SUGAR_CANE_MAX_HEIGHT) return { status: "invalid" };
        root = below;
        continue;
      }
      if (![1, 2, 4].includes(ground)) return { status: "invalid" };
      let missing = false;
      for (const [dx, dz] of sides) {
        const water = { x: below.x + dx, y: below.y, z: below.z + dz };
        if (!this.loaded(water)) {
          missing = true;
          continue;
        }
        if (isWater(this.get(water))) return { status: "valid", root, height };
      }
      return { status: missing ? "unknown" : "invalid" };
    }
  }

  /** Check immediately before a player placement; this does not consume items. */
  canPlace(p: Vec3): boolean {
    return (
      this.loaded(p) && this.get(p) === 0 && this.support(p).status === "valid"
    );
  }

  notifyBlockChanged(p: Vec3, oldId: number, newId: number): void {
    if (!validPosition(p) || oldId === newId) return;
    if (oldId === SUGAR_CANE_BLOCK && newId !== SUGAR_CANE_BLOCK)
      this.growth.delete(keyOf(p));
    // Soil/water edits affect cane one cell above and the rest of its stalk.
    // Queueing coordinates is safe at a streaming boundary; reads happen later.
    if (newId === SUGAR_CANE_BLOCK) this.enqueue(p);
    for (let dy = 0; dy <= SUGAR_CANE_MAX_HEIGHT; dy++) {
      this.enqueue({ ...p, y: p.y + dy });
      for (const [dx, dz] of sides)
        this.enqueue({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
    }
  }

  private write(p: Vec3, id: number): boolean {
    if (!this.loaded(p)) return false;
    const oldId = this.get(p);
    if (oldId === id) return true;
    try {
      this.callbacks.setBlock(p.x, p.y, p.z, id);
    } catch {
      /* A callback may have committed before reporting an error. */
    }
    if (this.get(p) !== id) return false;
    this.notifyBlockChanged(p, oldId, id);
    return true;
  }
  private breakCane(p: Vec3): void {
    if (!this.loaded(p) || this.get(p) !== SUGAR_CANE_BLOCK) return;
    if (!this.write(p, 0)) {
      this.enqueue(p);
      return;
    }
    this.growth.delete(keyOf(p));
    this.callbacks.dropItem(
      { x: p.x + 0.5, y: p.y + 0.1, z: p.z + 0.5 },
      { id: "sugar_cane", count: 1 },
    );
  }
  private track(root: Vec3): void {
    if (
      !this.growth.has(keyOf(root)) &&
      this.growth.size < SUGAR_CANE_GROWTH_MAX
    )
      this.growth.set(keyOf(root), { ...copy(root), age: 0 });
  }
  private growthSeconds(root: Vec3, height: number): number {
    let h =
      this.seed ^
      Math.imul(root.x, 374761393) ^
      Math.imul(root.y, 668265263) ^
      Math.imul(root.z, 1274126177) ^
      Math.imul(height, 1597334677);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (
      SUGAR_CANE_GROW_MIN_SECONDS +
      (((h ^ (h >>> 16)) >>> 0) / 4294967296) *
        (SUGAR_CANE_GROW_MAX_SECONDS - SUGAR_CANE_GROW_MIN_SECONDS)
    );
  }
  private tick(player: Vec3): void {
    const size = SUGAR_CANE_SCAN_RADIUS * 2 + 1;
    for (let n = 0; n < SUGAR_CANE_SCAN_BUDGET; n++) {
      const index = this.scanCursor;
      this.scanCursor = (this.scanCursor + 1) % SUGAR_CANE_SCAN_SIZE;
      const p = {
        x: Math.floor(player.x) + (index % size) - SUGAR_CANE_SCAN_RADIUS,
        y:
          Math.floor(player.y) +
          Math.floor(index / (size * size)) -
          SUGAR_CANE_SCAN_RADIUS,
        z:
          Math.floor(player.z) +
          (Math.floor(index / size) % size) -
          SUGAR_CANE_SCAN_RADIUS,
      };
      if (this.loaded(p) && this.get(p) === SUGAR_CANE_BLOCK) this.enqueue(p);
    }
    const jobs = [...this.queue.values()].slice(0, SUGAR_CANE_UPDATE_BUDGET);
    for (const p of jobs) {
      this.queue.delete(keyOf(p));
      if (!this.active(p, player)) {
        this.enqueue(p);
        continue;
      }
      if (this.get(p) !== SUGAR_CANE_BLOCK) continue;
      const support = this.support(p);
      if (support.status === "unknown") this.enqueue(p);
      else if (support.status === "invalid") this.breakCane(p);
      else this.track(support.root);
    }
    for (const [key, state] of this.growth) {
      if (!this.active(state, player)) continue;
      if (this.get(state) !== SUGAR_CANE_BLOCK) {
        this.growth.delete(key);
        continue;
      }
      const support = this.support(state);
      if (support.status === "unknown") continue;
      if (support.status === "invalid") {
        this.breakCane(state);
        continue;
      }
      if (keyOf(support.root) !== key) {
        this.growth.delete(key);
        this.track(support.root);
        continue;
      }
      let height = 1;
      let above = { x: state.x, y: state.y + height, z: state.z };
      while (
        height < SUGAR_CANE_MAX_HEIGHT &&
        this.loaded(above) &&
        this.get(above) === SUGAR_CANE_BLOCK
      ) {
        height++;
        above = { ...above, y: state.y + height };
      }
      if (height >= SUGAR_CANE_MAX_HEIGHT) {
        state.age = 0;
        continue;
      }
      if (!this.loaded(above) || this.get(above) !== 0) continue;
      state.age = Math.min(
        SUGAR_CANE_GROW_MAX_SECONDS,
        state.age + SUGAR_CANE_SCAN_INTERVAL,
      );
      if (
        state.age >= this.growthSeconds(state, height) &&
        this.write(above, SUGAR_CANE_BLOCK)
      )
        state.age = 0;
    }
  }

  step(dt: number, playerPosition: Vec3): void {
    if (
      !Number.isFinite(dt) ||
      dt <= 0 ||
      ![playerPosition.x, playerPosition.y, playerPosition.z].every(
        Number.isFinite,
      )
    )
      return;
    this.accumulator += Math.min(dt, 1);
    while (this.accumulator >= SUGAR_CANE_SCAN_INTERVAL) {
      this.accumulator -= SUGAR_CANE_SCAN_INTERVAL;
      this.tick(playerPosition);
    }
  }

  snapshot(): SugarCaneState {
    return {
      version: 1,
      accumulator: this.accumulator,
      scanCursor: this.scanCursor,
      queue: [...this.queue.values()].map(copy),
      growth: [...this.growth.values()].map((p) => ({
        ...copy(p),
        age: p.age,
      })),
    };
  }
}
