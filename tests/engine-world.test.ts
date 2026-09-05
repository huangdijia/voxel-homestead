import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoxelWorld } from "../src/engine/world";
import type { ChunkRequest, ChunkResult } from "../src/engine/protocol";

class WorkerDouble {
  static latest: WorkerDouble;
  requests: ChunkRequest[] = [];
  listeners = new Map<string, (event: { data: ChunkResult }) => void>();
  terminated = false;
  constructor() {
    WorkerDouble.latest = this;
  }
  addEventListener(
    type: string,
    listener: (event: { data: ChunkResult }) => void,
  ) {
    this.listeners.set(type, listener);
  }
  postMessage(request: ChunkRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  respond(request = this.requests[this.requests.length - 1]) {
    this.listeners.get("message")?.({
      data: {
        worldId: request.worldId,
        key: request.key,
        revision: request.revision,
        layers: [],
        voxels: new Uint16Array(4096),
      },
    });
  }
}
beforeEach(() => {
  vi.stubGlobal("Worker", WorkerDouble);
  vi.spyOn(THREE.TextureLoader.prototype, "load").mockReturnValue(
    new THREE.Texture(),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("chunk job ownership", () => {
  it("rejects stale worker geometry after an edit and applies only the new revision", () => {
    const world = new VoxelWorld(new THREE.Scene(), "test", [], "world-a");
    world.update({ x: 0.5, y: 23, z: 0.5 }, 1);
    const worker = WorkerDouble.latest,
      first = worker.requests[0];
    world.setBlock(1, 23, 1, 11);
    worker.respond(first);
    expect(world.stats.chunks).toBe(0);
    const latest = worker.requests[worker.requests.length - 1];
    expect(latest.key).toBe(first.key);
    expect(latest.revision).not.toBe(first.revision);
    expect(latest.changes).toContainEqual({ x: 1, y: 23, z: 1, id: 11 });
    worker.respond(latest);
    expect(world.stats.chunks).toBe(1);
    expect(world.getBlock(1, 23, 1)).toBe(11);
    world.dispose();
  });
  it("refreshes all eight sections sharing an edited fluid corner", () => {
    const world = new VoxelWorld(
      new THREE.Scene(),
      "corner-fluid",
      [],
      "corner-fluid",
    );
    world.update({ x: -0.5, y: 16, z: -0.5 }, 1);
    const worker = WorkerDouble.latest;
    while (world.stats.pending) worker.respond();
    const before = worker.requests.length;
    world.setBlock(-1, 15, -1, 6);
    while (world.stats.pending) worker.respond();
    const keys = new Set(worker.requests.slice(before).map((r) => r.key));
    for (const cx of [-1, 0])
      for (const cy of [0, 1])
        for (const cz of [-1, 0])
          expect(keys.has(`${cx},${cy},${cz}`)).toBe(true);
    world.dispose();
  });
  it("bounds queued chunks during fast exploration and ignores unloaded results", () => {
    const world = new VoxelWorld(new THREE.Scene(), "test", [], "world-a");
    world.update({ x: 0, y: 23, z: 0 }, 1);
    const worker = WorkerDouble.latest,
      old = worker.requests[0];
    for (let i = 1; i <= 20; i++) world.update({ x: i * 64, y: 23, z: 0 }, 1);
    expect(world.stats.pending).toBeLessThanOrEqual(37);
    worker.respond(old);
    expect(world.stats.chunks).toBe(0);
    expect(world.stats.pending).toBeLessThanOrEqual(36);
    world.dispose();
    expect(worker.terminated).toBe(true);
    expect(world.stats).toEqual({ chunks: 0, pending: 0 });
  });
  it("preserves independent changes and torch light across construction and cleanup", () => {
    const input = [{ x: -1, y: 24, z: -1, id: 16 }];
    const world = new VoxelWorld(new THREE.Scene(), "test", input, "world-b");
    input[0].id = 3;
    expect(world.getBlock(-1, 24, -1)).toBe(16);
    expect(world.getLight(-1, 24, -1)).toBe(14);
    expect(world.getLight(1, 24, -1)).toBe(12);
    const exported = world.getChanges();
    exported[0].id = 3;
    expect(world.getBlock(-1, 24, -1)).toBe(16);
    world.setBlock(-1, 24, -1, 0);
    expect(world.getLight(-1, 24, -1)).toBe(0);
    world.dispose();
  });
  it("prioritizes a nearby edit over distant initial loading after the current job completes", () => {
    const world = new VoxelWorld(
      new THREE.Scene(),
      "test",
      [],
      "world-edit-priority",
    );
    world.update({ x: 0.5, y: 23, z: 0.5 }, 6);
    const worker = WorkerDouble.latest;
    for (let i = 0; i < 4; i++) worker.respond();
    expect(world.stats.pending).toBeGreaterThan(600);
    world.setBlock(1, 23, 1, 11);
    worker.respond();
    expect(worker.requests[worker.requests.length - 1].key).toBe("0,1,0");
    expect(worker.requests[worker.requests.length - 1].changes).toContainEqual({
      x: 1,
      y: 23,
      z: 1,
      id: 11,
    });
    world.dispose();
  });
  it("keeps a bounded loaded set across a simulated 15-minute walk with all jobs completing", () => {
    const world = new VoxelWorld(new THREE.Scene(), "test", [], "world-walk");
    const worker = WorkerDouble.latest;
    let maxChunks = 0,
      maxPending = 0;
    for (let second = 0; second < 900; second++) {
      world.update(
        { x: second * 4.3, y: 23, z: Math.sin(second / 90) * 20 },
        6,
      );
      maxPending = Math.max(maxPending, world.stats.pending);
      let jobs = 0;
      while (world.stats.pending > 0 && jobs++ < 1000) worker.respond();
      maxChunks = Math.max(maxChunks, world.stats.chunks);
      expect(world.stats.chunks).toBeLessThanOrEqual(676);
    }
    expect(maxChunks).toBe(676);
    expect(maxPending).toBeLessThanOrEqual(676);
    expect(worker.requests.length).toBeGreaterThan(10000);
    world.dispose();
  }, 15000);
});
