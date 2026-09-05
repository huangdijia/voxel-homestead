import { isWater, isLava } from "./fluid-blocks";
import { WORLD_MIN_Y, WORLD_MAX_Y } from "../engine/world-height";
import { BLOCKS } from "./registry";
import type { ItemStack, Vec3, WorldPort } from "./types";

export type CropKind = "wheat" | "carrot" | "potato" | "beetroot";
export interface CropDefinition {
  kind: CropKind;
  name: string;
  seedItem: string;
  harvestItem: string;
  firstId: number;
  matureId: number;
  stages: number;
}
export interface CropInfo {
  definition: CropDefinition;
  stage: number;
  mature: boolean;
}
export interface FarmPlot extends Vec3 {
  moisture: number;
  drySeconds: number;
  growthRemaining: number;
  lastVisit: number;
  active: boolean;
}
export interface FarmState {
  version: 1;
  randomState: number;
  clock: number;
  accumulator: number;
  scanCursor: number;
  plots: FarmPlot[];
}
export interface FarmingCallbacks {
  dropItem?: (stack: ItemStack, position: Vec3) => void;
  /** Called after this service has already written to WorldPort. Do not write again. */
  changed?: (position: Vec3, oldId: number, newId: number) => void;
}

export const FARMLAND = { dry: 28, wet: 29 } as const;
export const SHORT_GRASS = 58;
export const FARM_SCAN_LIMIT = 8;
export const FARM_SCAN_INTERVAL = 0.25;
export const FARM_ACTIVE_RADIUS = 48;
export const FARM_ACTIVE_VERTICAL_RANGE = 32;
export const CROP_DEFINITIONS: Record<CropKind, CropDefinition> = {
  wheat: {
    kind: "wheat",
    name: "小麦",
    seedItem: "wheat_seeds",
    harvestItem: "wheat",
    firstId: 30,
    matureId: 37,
    stages: 8,
  },
  carrot: {
    kind: "carrot",
    name: "胡萝卜",
    seedItem: "carrot",
    harvestItem: "carrot",
    firstId: 38,
    matureId: 45,
    stages: 8,
  },
  potato: {
    kind: "potato",
    name: "马铃薯",
    seedItem: "potato",
    harvestItem: "potato",
    firstId: 46,
    matureId: 53,
    stages: 8,
  },
  beetroot: {
    kind: "beetroot",
    name: "甜菜",
    seedItem: "beetroot_seeds",
    harvestItem: "beetroot",
    firstId: 54,
    matureId: 57,
    stages: 4,
  },
};
const crops = Object.values(CROP_DEFINITIONS);
export function cropAt(id: number): CropInfo | null {
  if (!Number.isInteger(id)) return null;
  const definition = crops.find(
    (crop) => id >= crop.firstId && id <= crop.matureId,
  );
  return definition
    ? {
        definition,
        stage: id - definition.firstId,
        mature: id === definition.matureId,
      }
    : null;
}
const isFarmland = (id: number) => id === FARMLAND.dry || id === FARMLAND.wet;
const keyOf = (p: Vec3) => `${p.x},${p.y},${p.z}`;
const validPosition = (p: Vec3) =>
  [p.x, p.y, p.z].every(Number.isFinite) &&
  Math.abs(p.x) <= 30_000_000 &&
  Math.abs(p.z) <= 30_000_000 &&
  p.y >= WORLD_MIN_Y &&
  p.y <= WORLD_MAX_Y;
const randomInt = (rng: () => number, maximum: number) =>
  Math.floor(Math.max(0, Math.min(0.999999999, rng())) * maximum);

/** Harvest results only; the caller removes the crop and adds/drops these items. */
export function harvestCrop(
  id: number,
  rng: () => number = Math.random,
): ItemStack[] {
  const info = cropAt(id);
  if (!info) return [];
  const { definition, mature } = info;
  if (!mature) return [{ id: definition.seedItem, count: 1 }];
  if (definition.kind === "carrot" || definition.kind === "potato") {
    const result = [
      { id: definition.harvestItem, count: 2 + randomInt(rng, 4) },
    ];
    if (definition.kind === "potato" && rng() < 0.02)
      result.push({ id: "poisonous_potato", count: 1 });
    return result;
  }
  if (definition.kind === "beetroot")
    return [
      { id: "beetroot", count: 1 },
      { id: "beetroot_seeds", count: 1 + randomInt(rng, 4) },
    ];
  const seeds = randomInt(rng, 4);
  return [
    { id: "wheat", count: 1 },
    ...(seeds ? [{ id: "wheat_seeds", count: seeds }] : []),
  ];
}

/**
 * Local, deterministic farming. Only registered plots are visited. One step
 * examines at most eight plots and never catches up an unbounded time backlog.
 * The world owns block IDs; saved plots contain only moisture and timers.
 */
export class FarmingSystem {
  private plots: FarmPlot[] = [];
  private indices = new Map<string, number>();
  private randomState: number;
  private clock = 0;
  private accumulator = 0;
  private scanCursor = 0;

  constructor(
    private readonly world: WorldPort,
    seed: string,
    saved?: FarmState,
    private readonly callbacks: FarmingCallbacks = {},
  ) {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++)
      hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    this.randomState = hash >>> 0;
    if (saved) {
      if (
        saved.version !== 1 ||
        !Number.isInteger(saved.randomState) ||
        saved.randomState < 0 ||
        saved.randomState > 0xffffffff ||
        !Number.isFinite(saved.clock) ||
        saved.clock < 0 ||
        !Number.isFinite(saved.accumulator) ||
        saved.accumulator < 0 ||
        saved.accumulator >= FARM_SCAN_INTERVAL ||
        !Array.isArray(saved.plots) ||
        saved.plots.length > 100_000 ||
        !Number.isInteger(saved.scanCursor) ||
        saved.scanCursor < 0 ||
        saved.scanCursor >= Math.max(1, saved.plots.length)
      )
        throw new Error("无效的农业存档");
      this.randomState = saved.randomState;
      this.clock = saved.clock;
      this.accumulator = saved.accumulator;
      this.scanCursor = saved.scanCursor;
      for (const plot of saved.plots) {
        if (
          !validPosition(plot) ||
          ![plot.x, plot.y, plot.z, plot.moisture].every(Number.isInteger) ||
          plot.moisture < 0 ||
          plot.moisture > 7 ||
          !Number.isFinite(plot.drySeconds) ||
          plot.drySeconds < 0 ||
          plot.drySeconds >= 10 ||
          !Number.isFinite(plot.growthRemaining) ||
          plot.growthRemaining < 0 ||
          plot.growthRemaining > 60 ||
          !Number.isFinite(plot.lastVisit) ||
          plot.lastVisit < 0 ||
          plot.lastVisit > saved.clock ||
          typeof plot.active !== "boolean" ||
          this.indices.has(keyOf(plot))
        )
          throw new Error("无效或重复的耕地记录");
        this.indices.set(keyOf(plot), this.plots.length);
        this.plots.push({ ...plot });
      }
    }
  }
  get size(): number {
    return this.plots.length;
  }
  /** Arrow binding allows harvestCrop(id, farming.nextRandom) without losing state. */
  nextRandom = (): number => {
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let value = this.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  private nextGrowth(): number {
    return 20 + this.nextRandom() * 40;
  }
  private loaded(position: Vec3): boolean {
    return (
      validPosition(position) &&
      this.world.isReady(position.x, position.z, position.y)
    );
  }
  private read(position: Vec3): number | undefined {
    if (position.y > WORLD_MAX_Y) return 0;
    if (position.y < WORLD_MIN_Y) return 24;
    return this.loaded(position)
      ? this.world.getBlock(position.x, position.y, position.z)
      : undefined;
  }
  private register(position: Vec3, knownId?: number): FarmPlot | null {
    if (!validPosition(position)) return null;
    const key = keyOf(position),
      existing = this.indices.get(key);
    if (existing !== undefined) return this.plots[existing];
    if (this.plots.length >= 100_000) return null;
    const plot: FarmPlot = {
      ...position,
      moisture: (knownId ?? this.read(position)) === FARMLAND.wet ? 7 : 0,
      drySeconds: 0,
      growthRemaining: this.nextGrowth(),
      lastVisit: this.clock,
      active: false,
    };
    this.indices.set(key, this.plots.length);
    this.plots.push(plot);
    return plot;
  }
  private remove(position: Vec3): void {
    const key = keyOf(position),
      index = this.indices.get(key);
    if (index === undefined) return;
    const last = this.plots.pop()!;
    this.indices.delete(key);
    if (index < this.plots.length) {
      this.plots[index] = last;
      this.indices.set(keyOf(last), index);
    }
    if (this.scanCursor >= this.plots.length) this.scanCursor = 0;
  }
  private write(position: Vec3, newId: number): boolean {
    if (!this.loaded(position)) return false;
    const oldId = this.world.getBlock(position.x, position.y, position.z);
    if (oldId === newId) return false;
    this.world.setBlock(position.x, position.y, position.z, newId);
    if (this.world.getBlock(position.x, position.y, position.z) !== newId)
      return false;
    this.callbacks.changed?.({ ...position }, oldId, newId);
    return true;
  }
  private dropCrop(position: Vec3): void {
    const id = this.read(position);
    if (id === undefined || !cropAt(id) || !this.write(position, 0)) return;
    for (const stack of harvestCrop(id, this.nextRandom))
      this.callbacks.dropItem?.(stack, {
        x: position.x + 0.5,
        y: position.y + 0.1,
        z: position.z + 0.5,
      });
  }
  /** Call after an EXTERNAL world edit. The external crop-harvest path owns its own drops. */
  notifyBlockChanged(position: Vec3, oldId: number, newId: number): void {
    if (!validPosition(position)) return;
    const p = {
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z),
    };
    if (isFarmland(newId)) this.register(p, newId);
    if (isFarmland(oldId) && !isFarmland(newId)) {
      if (this.read({ ...p, y: p.y + 1 }) !== undefined) {
        this.dropCrop({ ...p, y: p.y + 1 });
        this.remove(p);
      }
      // Retain an unloaded orphan until it can be checked without reading an unloaded column.
      else this.register(p, oldId);
    }
    if (cropAt(oldId) || cropAt(newId)) {
      const soil = { ...p, y: p.y - 1 };
      const plot = this.register(soil);
      if (
        plot &&
        (!cropAt(oldId) ||
          cropAt(oldId)?.definition.kind !== cropAt(newId)?.definition.kind ||
          !cropAt(newId))
      )
        plot.growthRemaining = this.nextGrowth();
    }
    const belowCrop = { ...p, y: p.y - 1 };
    if (
      this.loaded(belowCrop) &&
      this.blocksCrop(newId) &&
      cropAt(this.world.getBlock(belowCrop.x, belowCrop.y, belowCrop.z))
    )
      this.dropCrop(belowCrop);
  }
  private blocksCrop(id: number): boolean {
    return !cropAt(id) && id !== SHORT_GRASS && !!BLOCKS[id]?.solid;
  }
  private isOpaque(id: number): boolean {
    return !!BLOCKS[id]?.opaque;
  }
  private irrigation(plot: Vec3): { wet: boolean; complete: boolean } {
    let complete = true;
    for (let dx = -4; dx <= 4; dx++)
      for (let dz = -4; dz <= 4; dz++) {
        const x = plot.x + dx,
          z = plot.z + dz;
        for (const y of [plot.y, plot.y + 1]) {
          const id = this.read({ x, y, z });
          if (id === undefined) complete = false;
          else if (isWater(id)) return { wet: true, complete: true };
        }
      }
    return { wet: false, complete };
  }
  private lightAt(position: Vec3, daylight: number): number {
    if (daylight >= 9) {
      let visibleSky =
        this.world.hasSkyAccess?.(position.x, position.y, position.z) ?? true;
      if (!this.world.hasSkyAccess) {
        for (let y = position.y + 1; y <= WORLD_MAX_Y; y++) {
          const id = this.read({ ...position, y });
          if (id === undefined || this.isOpaque(id)) {
            visibleSky = false;
            break;
          }
        }
      }
      if (visibleSky) return daylight;
    }
    // Bounded reverse light propagation: walls block an outside torch, while
    // light may reach a crop around a transparent corner within five steps.
    const queue: Array<Vec3 & { distance: number }> = [
      { ...position, distance: 0 },
    ];
    const seen = new Set([keyOf(position)]);
    for (let head = 0; head < queue.length; head++) {
      const p = queue[head];
      const lightBlock = this.read(p);
      if (lightBlock === undefined) continue;
      if (lightBlock === 16 || isLava(lightBlock))
        return (isLava(lightBlock) ? 15 : 14) - p.distance;
      if (p.distance === 5) continue;
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const next = {
          x: p.x + dx,
          y: p.y + dy,
          z: p.z + dz,
          distance: p.distance + 1,
        };
        const key = keyOf(next);
        if (seen.has(key) || !this.loaded(next)) continue;
        seen.add(key);
        const id = this.world.getBlock(next.x, next.y, next.z);
        if (!this.isOpaque(id) && !isFarmland(id)) queue.push(next);
      }
    }
    return 0;
  }
  private visit(plot: FarmPlot, player: Vec3, daylight: number): void {
    const previous = plot.lastVisit;
    plot.lastVisit = this.clock;
    if (
      Math.abs(player.x - plot.x) > FARM_ACTIVE_RADIUS ||
      Math.abs(player.z - plot.z) > FARM_ACTIVE_RADIUS ||
      Math.abs(player.y - plot.y) > FARM_ACTIVE_VERTICAL_RANGE ||
      !this.loaded(plot)
    ) {
      plot.active = false;
      return;
    }
    const elapsed = Math.min(
      plot.active ? 5 : FARM_SCAN_INTERVAL,
      this.clock - previous,
    );
    const cropPosition = { x: plot.x, y: plot.y + 1, z: plot.z };
    const cropId = this.read(cropPosition);
    const cover = this.read({ ...cropPosition, y: cropPosition.y + 1 });
    if (cropId === undefined || (cropAt(cropId) && cover === undefined)) {
      plot.active = false;
      return;
    }
    plot.active = true;
    if (!isFarmland(this.world.getBlock(plot.x, plot.y, plot.z))) {
      this.dropCrop(cropPosition);
      this.remove(plot);
      return;
    }
    const crop = cropAt(cropId);
    if (this.blocksCrop(cropId)) {
      this.write(plot, 2);
      this.remove(plot);
      return;
    }
    if (crop && cover !== undefined && this.blocksCrop(cover)) {
      this.dropCrop(cropPosition);
      return;
    }
    const water = this.irrigation(plot);
    if (!water.complete) {
      plot.active = false;
      return;
    }
    if (water.wet) {
      plot.moisture = 7;
      plot.drySeconds = 0;
      this.write(plot, FARMLAND.wet);
    } else {
      plot.drySeconds += elapsed;
      if (plot.drySeconds >= 10) {
        plot.drySeconds %= 10;
        plot.moisture = Math.max(0, plot.moisture - 1);
        if (plot.moisture === 0 && !crop) {
          this.write(plot, 2);
          this.remove(plot);
          return;
        }
      }
      this.write(plot, plot.moisture ? FARMLAND.wet : FARMLAND.dry);
    }
    if (!crop || crop.mature || this.lightAt(cropPosition, daylight) < 9)
      return;
    plot.growthRemaining = Math.max(
      0,
      plot.growthRemaining - elapsed * (plot.moisture > 0 ? 1 : 0.35),
    );
    if (plot.growthRemaining === 0) {
      this.write(cropPosition, cropId + 1);
      plot.growthRemaining = this.nextGrowth();
    }
  }
  step(dt: number, playerPosition: Vec3, daylight: number): void {
    if (
      !Number.isFinite(dt) ||
      dt <= 0 ||
      !validPosition(playerPosition) ||
      !Number.isFinite(daylight)
    )
      return;
    const elapsed = Math.min(dt, 1);
    this.clock += elapsed;
    this.accumulator += elapsed;
    if (this.accumulator < FARM_SCAN_INTERVAL) return;
    this.accumulator %= FARM_SCAN_INTERVAL;
    const budget = Math.min(FARM_SCAN_LIMIT, this.plots.length);
    for (let scans = 0; scans < budget && this.plots.length; scans++) {
      if (this.scanCursor >= this.plots.length) this.scanCursor = 0;
      const plot = this.plots[this.scanCursor];
      this.scanCursor = (this.scanCursor + 1) % this.plots.length;
      this.visit(plot, playerPosition, Math.max(0, Math.min(15, daylight)));
    }
  }
  /** Does not consume bone meal. The caller consumes exactly one only on true. */
  fertilize(position: Vec3): boolean {
    if (
      !validPosition(position) ||
      position.y <= WORLD_MIN_Y ||
      !this.loaded(position)
    )
      return false;
    const p = {
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z),
    };
    const id = this.world.getBlock(p.x, p.y, p.z),
      crop = cropAt(id);
    const soil = this.read({ ...p, y: p.y - 1 });
    const above = this.read({ ...p, y: p.y + 1 });
    if (
      !crop ||
      crop.mature ||
      soil === undefined ||
      above === undefined ||
      !isFarmland(soil) ||
      this.blocksCrop(above)
    )
      return false;
    const growth =
      crop.definition.kind === "beetroot"
        ? 1
        : 2 + randomInt(this.nextRandom, 4);
    const target = Math.min(crop.definition.matureId, id + growth);
    if (!this.write(p, target)) return false;
    const plot = this.register({ ...p, y: p.y - 1 });
    if (plot) plot.growthRemaining = this.nextGrowth();
    return true;
  }
  snapshot(): FarmState {
    return {
      version: 1,
      randomState: this.randomState,
      clock: this.clock,
      accumulator: this.accumulator,
      scanCursor: this.scanCursor,
      plots: this.plots.map((plot) => ({ ...plot })),
    };
  }
}
