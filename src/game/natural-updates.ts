import { isFluid } from "./fluid-blocks";
import { WORLD_MIN_Y, WORLD_MAX_Y } from "../engine/world-height";
import { BLOCKS } from "./registry";
import type { ItemStack, Vec3, WorldPort } from "./types";

export const NATURAL_MIN_Y = WORLD_MIN_Y;
export const NATURAL_MAX_Y = WORLD_MAX_Y;
export const NATURAL_WORLD_LIMIT = 30_000_000;
export const NATURAL_SCAN_INTERVAL = 0.1;
export const NATURAL_SCAN_RADIUS = 12;
export const NATURAL_SCAN_SIZE = (NATURAL_SCAN_RADIUS * 2 + 1) ** 3;
export const NATURAL_SCAN_BUDGET = 64;
export const NATURAL_UPDATE_BUDGET = 16;
export const NATURAL_ACTIVE_RADIUS = 48;
export const NATURAL_QUEUE_MAX = 4096;
export const NATURAL_FALLING_MAX = 128;
export const NATURAL_LEAF_DISTANCE = 6;
export const NATURAL_LEAF_DECAY_CHANCE = 0.1;
export const NATURAL_SAPLING_GROW_CHANCE = 0.002;
export const NATURAL_LEAVES = 8;
export const PERMANENT_LEAVES = 82;
export const OAK_SAPLING = 83;

export interface FallingNaturalBlock extends Vec3 {
  id: 4 | 5;
}
export interface NaturalState {
  version: 1;
  randomState: number;
  accumulator: number;
  scanCursor: number;
  queue: Vec3[];
  /** Only blocks removed from the world but not yet successfully placed. */
  falling: FallingNaturalBlock[];
}
export interface NaturalCallbacks {
  setBlock(x: number, y: number, z: number, id: number): boolean;
  dropItem(position: Vec3, item: ItemStack): void;
}

const directions = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;
const keyOf = (p: Vec3) => `${p.x},${p.y},${p.z}`;
const validPosition = (p: Vec3) =>
  p != null &&
  [p.x, p.y, p.z].every(Number.isInteger) &&
  Math.abs(p.x) <= NATURAL_WORLD_LIMIT &&
  Math.abs(p.z) <= NATURAL_WORLD_LIMIT &&
  p.y >= NATURAL_MIN_Y &&
  p.y <= NATURAL_MAX_Y;
const isLeaf = (id: number) => id === NATURAL_LEAVES || id === PERMANENT_LEAVES;
const isSand = (id: number): id is 4 | 5 => id === 4 || id === 5;
const isNatural = (id: number) =>
  isSand(id) || id === NATURAL_LEAVES || id === OAK_SAPLING;
const canDisplace = (id: number) => id === 0 || isFluid(id);
const isFullSupport = (id: number) =>
  !!BLOCKS[id]?.solid &&
  (!BLOCKS[id].shape || BLOCKS[id].shape === "cube") &&
  !(id >= 59 && id <= 67);
const blocksLight = (id: number) =>
  !!BLOCKS[id]?.opaque || id === 18 || id === 25;

/**
 * Bounded local updates, with no real-time/offline catch-up. Ordinary falling
 * blocks remain visible world voxels, moving one cell per scheduled update.
 * A failed destination write retains a saved cargo record, never a second voxel.
 * Callbacks are synchronous and may notify changes, but must not call step again.
 */
export class NaturalUpdatesSystem {
  private queue = new Map<string, Vec3>();
  private falling = new Map<string, FallingNaturalBlock>();
  private randomState: number;
  private accumulator = 0;
  private scanCursor = 0;
  private moved = new Set<string>();
  private writing = new Set<string>();

  constructor(
    private readonly world: WorldPort,
    seed: string,
    saved: NaturalState | undefined,
    private readonly callbacks: NaturalCallbacks,
  ) {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++)
      hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    this.randomState = hash >>> 0;
    if (!saved) return;
    if (
      saved.version !== 1 ||
      !Number.isInteger(saved.randomState) ||
      saved.randomState < 0 ||
      saved.randomState > 0xffffffff ||
      !Number.isFinite(saved.accumulator) ||
      saved.accumulator < 0 ||
      saved.accumulator >= NATURAL_SCAN_INTERVAL ||
      !Number.isInteger(saved.scanCursor) ||
      saved.scanCursor < 0 ||
      saved.scanCursor >= NATURAL_SCAN_SIZE ||
      !Array.isArray(saved.queue) ||
      saved.queue.length > NATURAL_QUEUE_MAX ||
      !Array.isArray(saved.falling) ||
      saved.falling.length > NATURAL_FALLING_MAX
    )
      throw new Error("无效的自然更新存档");
    this.randomState = saved.randomState;
    this.accumulator = saved.accumulator;
    this.scanCursor = saved.scanCursor;
    for (const p of saved.queue) {
      if (!validPosition(p) || this.queue.has(keyOf(p)))
        throw new Error("无效或重复的自然更新位置");
      this.queue.set(keyOf(p), { x: p.x, y: p.y, z: p.z });
    }
    for (const p of saved.falling) {
      if (!validPosition(p) || !isSand(p.id) || this.falling.has(keyOf(p)))
        throw new Error("无效或重复的下落方块");
      if (this.loaded(p) && this.get(p) === p.id)
        throw new Error("下落方块与世界方块重复");
      this.falling.set(keyOf(p), { x: p.x, y: p.y, z: p.z, id: p.id });
    }
  }

  private nextRandom(): number {
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let value = this.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  private get(p: Vec3): number {
    return this.world.getBlock(p.x, p.y, p.z);
  }
  private loaded(p: Vec3): boolean {
    return validPosition(p) && this.world.isReady(p.x, p.z, p.y);
  }
  private active(p: Vec3, player: Vec3): boolean {
    return (
      Math.abs(p.x - player.x) <= NATURAL_ACTIVE_RADIUS &&
      Math.abs(p.y - player.y) <= NATURAL_ACTIVE_RADIUS &&
      Math.abs(p.z - player.z) <= NATURAL_ACTIVE_RADIUS &&
      this.loaded(p)
    );
  }
  private enqueue(p: Vec3, urgent = false): void {
    if (!validPosition(p)) return;
    const key = keyOf(p);
    if (this.queue.has(key)) {
      if (!urgent) return;
      this.queue.delete(key);
    }
    if (this.queue.size >= NATURAL_QUEUE_MAX) {
      // This is a discovery queue, not block ownership: discarded positions are
      // rediscovered by the local scan. Never discard the separate falling map.
      const oldest = this.queue.keys().next().value!;
      this.queue.delete(oldest);
    }
    const position = { x: p.x, y: p.y, z: p.z };
    if (urgent) this.queue = new Map([[key, position], ...this.queue]);
    else this.queue.set(key, position);
  }
  /** Call after an external edit; repeated notifications do not duplicate work. */
  notifyBlockChanged(p: Vec3, oldId: number, newId: number): void {
    if (!validPosition(p) || oldId === newId) return;
    const cargo = this.falling.get(keyOf(p));
    if (
      cargo &&
      !this.writing.has(keyOf(p)) &&
      !canDisplace(newId) &&
      this.loaded(p)
    )
      this.dropSand(cargo);
    for (const [dx, dy, dz] of directions) {
      const next = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
      if (!validPosition(next)) continue;
      if (!this.loaded(next) || isNatural(this.get(next)))
        this.enqueue(next, dy === 1);
    }
    if (isNatural(newId)) this.enqueue(p, true);
  }
  private write(p: Vec3, id: number): boolean {
    if (!this.loaded(p)) return false;
    const oldId = this.get(p);
    if (oldId === id) return true;
    this.writing.add(keyOf(p));
    try {
      try {
        this.callbacks.setBlock(p.x, p.y, p.z, id);
      } catch {
        /* Verify actual ownership even when a callback throws after writing. */
      }
      if (this.get(p) !== id) return false;
      this.notifyBlockChanged(p, oldId, id);
      return true;
    } finally {
      this.writing.delete(keyOf(p));
    }
  }
  private drop(p: Vec3, stack: ItemStack): void {
    this.callbacks.dropItem(
      { x: p.x + 0.5, y: p.y + 0.1, z: p.z + 0.5 },
      stack,
    );
  }
  private dropSand(p: FallingNaturalBlock): void {
    this.falling.delete(keyOf(p));
    this.drop(p, { id: p.id === 4 ? "sand" : "gravel", count: 1 });
  }
  private continueFall(p: FallingNaturalBlock): void {
    // A previously unloaded malformed checkpoint must not turn one saved voxel
    // into two when its column finally becomes readable. Normal external edits
    // call notifyBlockChanged and already resolve cargo before this can happen.
    if (this.get(p) === p.id) {
      this.falling.delete(keyOf(p));
      this.enqueue(p);
      return;
    }
    const below = { x: p.x, y: p.y - 1, z: p.z };
    if (below.y < NATURAL_MIN_Y) {
      this.dropSand(p);
      return;
    }
    if (!this.loaded(below)) return;
    const beneath = this.get(below);
    if (canDisplace(beneath)) {
      if (this.falling.has(keyOf(below))) return;
      if (!this.write(below, p.id)) return;
      this.falling.delete(keyOf(p));
      this.moved.add(keyOf(below));
      this.enqueue(below);
      return;
    }
    if (isFullSupport(beneath) && canDisplace(this.get(p))) {
      if (!this.write(p, p.id)) return;
      this.falling.delete(keyOf(p));
      this.moved.add(keyOf(p));
      return;
    }
    // Slabs, farmland, beds, doors, plants and hollow composters are preserved.
    // A grid-aligned full voxel cannot rest on their partial collision surfaces.
    this.dropSand(p);
  }
  private sand(p: Vec3, id: 4 | 5): void {
    if (this.moved.has(keyOf(p))) {
      this.enqueue(p);
      return;
    }
    if (p.y > NATURAL_MIN_Y) {
      const below = { ...p, y: p.y - 1 };
      if (!this.loaded(below)) {
        this.enqueue(p);
        return;
      }
      if (isFullSupport(this.get(below))) return;
    }
    if (
      this.falling.size >= NATURAL_FALLING_MAX ||
      this.falling.has(keyOf(p))
    ) {
      this.enqueue(p);
      return;
    }
    if (!this.write(p, 0)) {
      this.enqueue(p);
      return;
    }
    const cargo = { ...p, id };
    this.falling.set(keyOf(p), cargo);
    this.continueFall(cargo);
  }
  private leafSupport(start: Vec3): "supported" | "unsupported" | "unloaded" {
    const positions = [{ ...start, distance: 0 }];
    const seen = new Set([keyOf(start)]);
    let incomplete = false;
    for (let head = 0; head < positions.length; head++) {
      const p = positions[head];
      if (p.distance >= NATURAL_LEAF_DISTANCE) continue;
      for (const [dx, dy, dz] of directions) {
        const next = {
          x: p.x + dx,
          y: p.y + dy,
          z: p.z + dz,
          distance: p.distance + 1,
        };
        if (!validPosition(next) || seen.has(keyOf(next))) continue;
        seen.add(keyOf(next));
        if (!this.loaded(next)) {
          incomplete = true;
          continue;
        }
        const id = this.get(next);
        if (id === 7) return "supported";
        if (isLeaf(id)) positions.push(next);
      }
    }
    return incomplete ? "unloaded" : "unsupported";
  }
  private leaf(p: Vec3): void {
    const support = this.leafSupport(p);
    if (support === "supported") return;
    this.enqueue(p);
    if (
      support === "unloaded" ||
      this.nextRandom() >= NATURAL_LEAF_DECAY_CHANCE ||
      !this.write(p, 0)
    )
      return;
    if (this.nextRandom() < 0.05) this.drop(p, { id: "oak_sapling", count: 1 });
    if (this.nextRandom() < 0.02)
      this.drop(p, { id: "stick", count: this.nextRandom() < 0.5 ? 1 : 2 });
    if (this.nextRandom() < 0.005) this.drop(p, { id: "apple", count: 1 });
  }
  private hasGrowthLight(start: Vec3, daylight: number): boolean {
    if (daylight >= 9) {
      let sky = this.world.hasSkyAccess?.(start.x, start.y, start.z) ?? true;
      if (!this.world.hasSkyAccess) {
        for (let y = start.y + 1; y <= NATURAL_MAX_Y; y++) {
          if (
            !this.world.isReady(start.x, start.z, y) ||
            blocksLight(this.world.getBlock(start.x, y, start.z))
          ) {
            sky = false;
            break;
          }
        }
      }
      if (sky) return true;
    }
    // Five steps from a torch still provides level 9. Opaque walls and closed
    // doors block propagation; unknown columns never supply presumed light.
    const positions = [{ ...start, distance: 0 }];
    const seen = new Set([keyOf(start)]);
    for (let head = 0; head < positions.length; head++) {
      const p = positions[head];
      if (this.get(p) === 16) return true;
      if (p.distance >= 5) continue;
      for (const [dx, dy, dz] of directions) {
        const next = {
          x: p.x + dx,
          y: p.y + dy,
          z: p.z + dz,
          distance: p.distance + 1,
        };
        if (!this.loaded(next) || seen.has(keyOf(next))) continue;
        seen.add(keyOf(next));
        if (!blocksLight(this.get(next))) positions.push(next);
      }
    }
    return false;
  }
  private grow(p: Vec3, daylight: number): boolean {
    if (
      !validPosition(p) ||
      p.y <= NATURAL_MIN_Y ||
      p.y + 5 > NATURAL_MAX_Y ||
      !this.loaded(p) ||
      !this.loaded({ ...p, y: p.y - 1 }) ||
      this.get(p) !== OAK_SAPLING ||
      !Number.isFinite(daylight)
    )
      return false;
    const soil = this.world.getBlock(p.x, p.y - 1, p.z);
    if (soil !== 1 && soil !== 2) return false;
    // Check the complete canopy footprint before reading or modifying any of it.
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        if (!this.loaded({ x: p.x + dx, y: p.y, z: p.z + dz })) return false;
      }
    const plan: Array<Vec3 & { id: number; oldId: number }> = [];
    for (let dy = 0; dy < 5; dy++)
      plan.push({
        x: p.x,
        y: p.y + dy,
        z: p.z,
        id: 7,
        oldId: dy ? 0 : OAK_SAPLING,
      });
    for (let dy = 3; dy <= 5; dy++) {
      const radius = dy === 5 ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx++)
        for (let dz = -radius; dz <= radius; dz++) {
          if (
            (!dx && !dz && dy < 5) ||
            (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2)
          )
            continue;
          plan.push({
            x: p.x + dx,
            y: p.y + dy,
            z: p.z + dz,
            id: NATURAL_LEAVES,
            oldId: 0,
          });
        }
    }
    if (
      plan.some((block) => !this.loaded(block)) ||
      plan.some((block) => this.get(block) !== block.oldId) ||
      !this.hasGrowthLight(p, daylight)
    )
      return false;
    const written: typeof plan = [];
    for (const block of plan) {
      if (this.get(block) !== block.oldId || !this.write(block, block.id)) {
        // Roll back a rejected batch. Restore the sapling last; if rollback is
        // itself refused, keep its consumed trunk so retrying cannot farm wood.
        let rolledBack = true;
        for (const previous of written.slice(1).reverse()) {
          if (
            this.get(previous) !== previous.id ||
            !this.write(previous, previous.oldId)
          )
            rolledBack = false;
        }
        if (!written.length) return false;
        return !rolledBack || !this.write(written[0], OAK_SAPLING);
      }
      written.push(block);
    }
    return true;
  }
  /** The caller consumes bone meal only on true. No random roll on rejection. */
  fertilize(position: Vec3, daylight: number): boolean {
    return this.grow(position, daylight);
  }

  private scan(player: Vec3): void {
    const side = NATURAL_SCAN_RADIUS * 2 + 1;
    const center = {
      x: Math.floor(player.x),
      y: Math.floor(player.y),
      z: Math.floor(player.z),
    };
    for (let i = 0; i < NATURAL_SCAN_BUDGET; i++) {
      const cursor = this.scanCursor;
      this.scanCursor = (cursor + 1) % NATURAL_SCAN_SIZE;
      const p = {
        x: center.x + (cursor % side) - NATURAL_SCAN_RADIUS,
        y: center.y + Math.floor(cursor / (side * side)) - NATURAL_SCAN_RADIUS,
        z: center.z + (Math.floor(cursor / side) % side) - NATURAL_SCAN_RADIUS,
      };
      if (this.loaded(p) && isNatural(this.get(p))) this.enqueue(p);
    }
  }
  step(dt: number, playerPosition: Vec3, daylight: number): void {
    if (
      !Number.isFinite(dt) ||
      dt <= 0 ||
      !Number.isFinite(daylight) ||
      !playerPosition ||
      ![playerPosition.x, playerPosition.y, playerPosition.z].every(
        Number.isFinite,
      )
    )
      return;
    this.accumulator += Math.min(dt, 1);
    if (this.accumulator < NATURAL_SCAN_INTERVAL) return;
    this.accumulator %= NATURAL_SCAN_INTERVAL;
    this.moved.clear();
    this.scan(playerPosition);
    const cargos = [...this.falling.values()].slice(0, NATURAL_UPDATE_BUDGET);
    for (const cargo of cargos) {
      if (this.active(cargo, playerPosition)) this.continueFall(cargo);
      if (this.falling.has(keyOf(cargo))) {
        this.falling.delete(keyOf(cargo));
        this.falling.set(keyOf(cargo), cargo);
      }
    }
    // Snapshot the batch: callbacks and falling voxels cannot schedule themselves
    // for a second move during this same tick.
    const batch = [...this.queue.values()].slice(0, NATURAL_UPDATE_BUDGET);
    for (const p of batch) {
      this.queue.delete(keyOf(p));
      if (!this.active(p, playerPosition)) {
        this.enqueue(p);
        continue;
      }
      const id = this.get(p);
      if (isSand(id)) this.sand(p, id);
      else if (id === NATURAL_LEAVES) this.leaf(p);
      else if (id === OAK_SAPLING) {
        if (p.y > NATURAL_MIN_Y && !this.loaded({ ...p, y: p.y - 1 })) {
          this.enqueue(p);
          continue;
        }
        const soil =
          p.y > NATURAL_MIN_Y ? this.world.getBlock(p.x, p.y - 1, p.z) : 0;
        if (soil !== 1 && soil !== 2) {
          if (this.write(p, 0)) this.drop(p, { id: "oak_sapling", count: 1 });
          else this.enqueue(p);
        } else if (
          this.nextRandom() >= NATURAL_SAPLING_GROW_CHANCE ||
          !this.grow(p, daylight)
        )
          this.enqueue(p);
      }
    }
  }
  snapshot(): NaturalState {
    return {
      version: 1,
      randomState: this.randomState,
      accumulator: this.accumulator,
      scanCursor: this.scanCursor,
      queue: [...this.queue.values()].map((p) => ({ ...p })),
      falling: [...this.falling.values()].map((p) => ({ ...p })),
    };
  }
}
