import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoxelWorld } from "../src/engine/world";
import { buildChunk } from "../src/engine/mesher";
import { moveBody, raycastVoxel } from "../src/engine/physics";
import { sampleBlock, surfaceHeight } from "../src/engine/generator";
import { WORLD_MIN_Y, WORLD_MAX_Y } from "../src/engine/world-height";
import type { GeneratorVersion } from "../src/engine/world-height";
import type {
  ChunkRequest,
  ChunkResult,
  MeshArrays,
} from "../src/engine/protocol";
import type { BlockChange } from "../src/game/types";

class SectionWorker {
  static latest: SectionWorker;
  requests: ChunkRequest[] = [];
  listener?: (event: { data: ChunkResult }) => void;
  terminated = false;
  constructor() {
    SectionWorker.latest = this;
  }
  addEventListener(
    type: string,
    listener: (event: { data: ChunkResult }) => void,
  ) {
    if (type === "message") this.listener = listener;
  }
  postMessage(request: ChunkRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  respond(request = this.requests.at(-1)!, layers: MeshArrays[] = []) {
    const voxels = new Uint16Array(4096);
    for (const change of request.changes) {
      const x = change.x - request.cx * 16,
        y = change.y - request.cy * 16,
        z = change.z - request.cz * 16;
      if (x >= 0 && x < 16 && y >= 0 && y < 16 && z >= 0 && z < 16)
        voxels[y * 256 + z * 16 + x] = change.id;
    }
    this.listener?.({
      data: {
        worldId: request.worldId,
        key: request.key,
        revision: request.revision,
        voxels,
        layers,
      },
    });
  }
  flush(world: VoxelWorld) {
    let remaining = 2200;
    while (world.stats.pending && remaining-- > 0) this.respond();
    expect(world.stats.pending).toBe(0);
  }
}
const worlds: VoxelWorld[] = [];
const createWorld = (
  changes: BlockChange[] = [],
  version: GeneratorVersion = 5,
) => {
  const scene = new THREE.Scene(),
    world = new VoxelWorld(
      scene,
      "height-streaming",
      changes,
      "height-test",
      version,
    );
  worlds.push(world);
  return { world, scene, worker: SectionWorker.latest };
};
const triangle: MeshArrays = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  colors: new Float32Array(9).fill(1),
  indices: new Uint32Array([0, 1, 2]),
};
beforeEach(() => {
  vi.stubGlobal("Worker", SectionWorker);
  vi.spyOn(THREE.TextureLoader.prototype, "load").mockReturnValue(
    new THREE.Texture(),
  );
});
afterEach(() => {
  for (const world of worlds.splice(0)) world.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("bounded full-height residency", () => {
  it("covers the full vertical view radius without pinning distant edits", () => {
    const changes = Array.from({ length: 24 }, (_, i) => ({
      x: 2,
      y: -64 + i * 16,
      z: 2,
      id: 11,
    }));
    const { world, worker } = createWorld(changes);
    world.update({ x: 0.5, y: 128, z: 0.5 }, 6);
    expect(world.stats.pending).toBe(13 ** 3);
    worker.flush(world);
    expect(world.stats.chunks).toBe(13 ** 3);
    expect(new Set(worker.requests.map((request) => request.cy))).toEqual(
      new Set(Array.from({ length: 13 }, (_, i) => i + 2)),
    );
    expect(
      worker.requests.every((request) => request.generatorVersion === 5),
    ).toBe(true);
    expect(world.isReady(0, 0, -64)).toBe(false);
    world.setBlock(0, 319, 0, 11);
    expect(world.stats.chunks).toBe(2197);
    expect(world.getChanges()).toContainEqual({ x: 0, y: 319, z: 0, id: 11 });
    world.update({ x: 0.5, y: 319, z: 0.5 }, 6);
    expect(world.stats.pending).toBeLessThanOrEqual(2198);
    worker.flush(world);
    expect(world.stats.chunks).toBe(13 * 13 * 7);
    expect(world.isReady(0, 0, 319)).toBe(true);
    expect(world.isReady(0, 0, 128)).toBe(false);
  });

  it("uses global build bounds for all generators while retaining versioned surfaces", () => {
    for (const version of [1, 2, 3, 4, 5] as const) {
      const { world, worker } = createWorld([], version);
      expect(world.getSurface(0, 0)).toBe(
        surfaceHeight("height-streaming", 0, 0, version),
      );
      world.setBlock(-1, WORLD_MIN_Y, -1, 11);
      world.setBlock(-1, WORLD_MAX_Y, -1, 11);
      world.setBlock(-1, WORLD_MIN_Y - 1, -1, 11);
      world.setBlock(-1, WORLD_MAX_Y + 1, -1, 11);
      expect(world.getChanges()).toHaveLength(2);
      expect(world.getBlock(-1, WORLD_MIN_Y, -1)).toBe(11);
      expect(world.getBlock(-1, WORLD_MAX_Y, -1)).toBe(11);
      expect(world.getBlock(-1, WORLD_MIN_Y - 1, -1)).toBe(0);
      expect(world.getBlock(-1, WORLD_MAX_Y + 1, -1)).toBe(0);
      world.update({ x: -0.5, y: -64, z: -0.5 }, 1);
      worker.flush(world);
      expect(world.stats.chunks).toBe(18);
      expect(world.isReady(-1, -1, -64)).toBe(true);
      expect(
        worker.requests.every(
          (request) => request.cy >= -4 && request.cy <= 19,
        ),
      ).toBe(true);
    }
  });

  it("permits flight above and falling below build bounds without inventing sections", () => {
    const { world, worker } = createWorld();
    for (const y of [500, -200]) {
      world.update({ x: 0, y, z: 0 }, 6);
      expect(world.stats).toEqual({ chunks: 0, pending: 0 });
      expect(world.ready).toBe(true);
      expect(world.isReady(0, 0, y)).toBe(true);
      const move = moveBody(world, { x: 0, y, z: 0 }, { x: 1, y: -3, z: 2 });
      expect(move.position).toEqual({ x: 1, y: y - 3, z: 2 });
    }
    expect(worker.requests).toHaveLength(0);
  });

  it("disposes departed geometry and restores edits on a vertical return", () => {
    const change = { x: 1, y: -48, z: 1, id: 11 };
    const { world, worker, scene } = createWorld([change]);
    const low = { x: 0.5, y: -47, z: 0.5 },
      high = { x: 0.5, y: 300, z: 0.5 };
    world.update(low, 1);
    worker.respond(worker.requests[0], [triangle]);
    const mesh = scene.children.find(
      (child) => child instanceof THREE.Mesh,
    ) as THREE.Mesh;
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose"),
      materialDispose = vi.spyOn(mesh.material as THREE.Material, "dispose");
    worker.flush(world);
    world.update(high, 1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).not.toHaveBeenCalled();
    expect(scene.children).not.toContain(mesh);
    expect(world.isReady(1, 1, -48)).toBe(false);
    expect(world.getChanges()).toContainEqual(change);
    worker.flush(world);
    const beforeReturn = worker.requests.length;
    world.update(low, 1);
    worker.flush(world);
    expect(
      worker.requests
        .slice(beforeReturn)
        .some(
          (request) =>
            request.key === "0,-3,0" &&
            request.changes.some((entry) => entry.y === -48 && entry.id === 11),
        ),
    ).toBe(true);
    expect(world.getBlock(1, -48, 1)).toBe(11);
    world.dispose();
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(true);
    expect(world.stats).toEqual({ chunks: 0, pending: 0 });
  });

  it("discards a previous vertical window result and bounds outstanding work", () => {
    const { world, worker } = createWorld();
    world.update({ x: 0.5, y: -48, z: 0.5 }, 1);
    const old = worker.requests[0];
    for (const y of [300, -32, 240, 0, 280]) {
      world.update({ x: 0.5, y, z: 0.5 }, 1);
      expect(world.stats.pending).toBeLessThanOrEqual(28);
    }
    worker.respond(old);
    expect(world.stats.chunks).toBe(0);
    worker.flush(world);
    expect(world.isReady(0, 0, 280)).toBe(true);
    expect(world.isReady(0, 0, -48)).toBe(false);
  });

  it("requeues a section if the player returns before its obsolete job finishes", () => {
    const { world, worker } = createWorld();
    const low = { x: 0.5, y: -47, z: 0.5 };
    world.update(low, 1);
    const obsolete = worker.requests[0];
    world.update({ ...low, y: 300 }, 1);
    world.update(low, 1);
    worker.respond(obsolete);
    expect(world.stats.chunks).toBe(0);
    expect(worker.requests.at(-1)?.key).toBe(obsolete.key);
    expect(worker.requests.at(-1)?.revision).not.toBe(obsolete.revision);
    worker.flush(world);
    world.update(low, 1);
    expect(world.ready).toBe(true);
    expect(world.isReady(low.x, low.z, low.y)).toBe(true);
  });

  it("requires every section touched by the player's feet, head and horizontal corners", () => {
    const { world, worker } = createWorld();
    const position = { x: 16, y: 15, z: 16 };
    world.update(position, 1);
    worker.respond();
    world.update(position, 1);
    expect(world.isReady(16, 16, 15)).toBe(true);
    expect(world.isReady(16, 16)).toBe(false);
    expect(world.ready).toBe(false);
    worker.flush(world);
    world.update(position, 1);
    for (const x of [15, 16])
      for (const z of [15, 16])
        for (const y of [15, 16]) expect(world.isReady(x, z, y)).toBe(true);
    expect(world.ready).toBe(true);
    expect(world.isReady(16, 16, 64)).toBe(false);
  });
});

describe("height-aware collision and selection", () => {
  it("blocks all three movement directions at nonresident sections without reading fallback terrain", () => {
    const readUnknown: number[][] = [],
      queriedHeights: number[] = [];
    const isReady = (x: number, z: number, y?: number) => {
      if (y !== undefined) queriedHeights.push(y);
      return x < 16 && z < 16 && y !== undefined && y >= 0 && y < 16;
    };
    const world = {
      isReady,
      getBlock(x: number, y: number, z: number) {
        if (!isReady(x, z, y)) readUnknown.push([x, y, z]);
        return 0;
      },
    };
    const across = moveBody(
      world,
      { x: 15, y: 8, z: 15 },
      { x: 5, y: 0, z: 5 },
    );
    expect(across.position.x).toBeCloseTo(15.7);
    expect(across.position.z).toBeCloseTo(15.7);
    const up = moveBody(world, { x: 1, y: 13, z: 1 }, { x: 0, y: 5, z: 0 });
    expect(up.position.y).toBeCloseTo(14.2);
    expect(up.hitY).toBe(true);
    const down = moveBody(world, { x: 1, y: 1, z: 1 }, { x: 0, y: -5, z: 0 });
    expect(down.position.y).toBe(0);
    expect(down.grounded).toBe(true);
    expect(readUnknown).toEqual([]);
    expect(queriedHeights).toContain(-1);
    expect(queriedHeights).toContain(16);
  });

  it("does not select a procedural block through an unloaded vertical boundary", () => {
    const getBlock = vi.fn((_x: number, y: number) => (y === 17 ? 11 : 0));
    const world = {
      getBlock,
      isReady: (_x: number, _z: number, y?: number) =>
        y !== undefined && y < 16,
    };
    expect(
      raycastVoxel(world, { x: 0.5, y: 14, z: 0.5 }, { x: 0, y: 1, z: 0 }, 6),
    ).toBeNull();
    expect(getBlock.mock.calls.every(([, y]) => y < 16)).toBe(true);
  });
});

describe("complete-column sky and height boundary geometry", () => {
  it("honors unstreamed high roofs, invalidates edits and includes natural tree trunks", () => {
    const { world } = createWorld([{ x: 1, y: 319, z: 1, id: 11 }]);
    world.update({ x: 1, y: 70, z: 1 }, 1);
    expect(world.isReady(1, 1, 319)).toBe(false);
    expect(world.hasSkyAccess(1, 100, 1)).toBe(false);
    expect(world.hasSkyAccess(1, 318, 1)).toBe(false);
    expect(world.hasSkyAccess(1, 319, 1)).toBe(true);
    world.setBlock(1, 319, 1, 0);
    expect(world.hasSkyAccess(1, 100, 1)).toBe(true);
    world.setBlock(1, 250, 1, 17); // Glass and leaves are not opaque sky roofs.
    world.setBlock(1, 249, 1, 82);
    expect(world.hasSkyAccess(1, 100, 1)).toBe(true);
    world.setBlock(1, 250, 1, 11);
    expect(world.hasSkyAccess(1, 100, 1)).toBe(false);
    const treeSurface = world.getSurface(-6, 5);
    expect(sampleBlock(world.seed, -6, treeSurface + 1, 5, 5)).toBe(7);
    expect(world.hasSkyAccess(-6, treeSurface, 5)).toBe(false);
    expect(world.hasSkyAccess(-6, treeSurface + 10, 5)).toBe(true);
    const clearedColumn = Array.from({ length: 384 }, (_, offset) => ({
      x: 2,
      y: WORLD_MIN_Y + offset,
      z: 2,
      id: 0,
    }));
    const empty = createWorld(clearedColumn).world;
    expect(empty.hasSkyAccess(2, WORLD_MIN_Y - 10, 2)).toBe(true);
  });

  it("bounds sky-column caching and releases it on horizontal departure and disposal", () => {
    const changes = Array.from({ length: 4097 }, (_, x) => ({
      x,
      y: 319,
      z: 0,
      id: 11,
    }));
    const { world } = createWorld(changes);
    for (let x = 0; x < 4097; x++)
      expect(world.hasSkyAccess(x, 300, 0)).toBe(false);
    // Inspect resource ownership, not the cached algorithm: long walks cannot accumulate columns.
    const resources = world as unknown as { skyRoofs: Map<string, unknown> };
    expect(resources.skyRoofs.size).toBeLessThanOrEqual(4096);
    world.update({ x: -10000, y: 300, z: 0 }, 1);
    expect(resources.skyRoofs.size).toBe(0);
    world.hasSkyAccess(0, 300, 0);
    world.dispose();
    expect(resources.skyRoofs.size).toBe(0);
  });

  const request = (
    cy: number,
    changes: BlockChange[],
    version: GeneratorVersion = 5,
  ): ChunkRequest => ({
    worldId: "height-mesh",
    seed: "height-mesh",
    generatorVersion: version,
    key: `0,${cy},0`,
    cx: 0,
    cy,
    cz: 0,
    revision: 1,
    changes,
  });
  it("draws exposed top/bottom faces at the global bounds and culls vertical section seams", () => {
    const top = buildChunk(
      request(19, [
        { x: 1, y: 319, z: 1, id: 11 },
        { x: 1, y: 320, z: 1, id: 11 },
      ]),
    );
    expect(top.layers[0].indices.length).toBe(36);
    expect([...top.layers[0].normals].filter((_, i) => i % 3 === 1)).toContain(
      1,
    );
    const cleared: BlockChange[] = [];
    for (let y = -64; y <= -48; y++)
      for (let z = -1; z <= 16; z++)
        for (let x = -1; x <= 16; x++) cleared.push({ x, y, z, id: 0 });
    cleared.push({ x: 1, y: -64, z: 1, id: 11 });
    const bottom = buildChunk(request(-4, cleared));
    expect(bottom.layers[0].indices.length).toBe(36);
    expect(
      [...bottom.layers[0].normals].filter((_, i) => i % 3 === 1),
    ).toContain(-1);
    const pair = [
      { x: 1, y: 287, z: 1, id: 11 },
      { x: 1, y: 288, z: 1, id: 11 },
    ];
    const lower = buildChunk(request(17, pair)).layers[0],
      upper = buildChunk(request(18, pair)).layers[0];
    expect(lower.indices.length).toBe(30);
    expect(upper.indices.length).toBe(30);
    expect([...lower.normals].filter((_, i) => i % 3 === 1)).not.toContain(1);
    expect([...upper.normals].filter((_, i) => i % 3 === 1)).not.toContain(-1);
  });

  it("shades from an opaque roof at 319 and restores sunlight after removing a cached roof", () => {
    const block = { x: 1, y: 200, z: 1, id: 11 };
    const topColor = (layer: MeshArrays) => {
      for (let i = 0; i < layer.normals.length; i += 3)
        if (layer.normals[i + 1] === 1) return layer.colors[i];
      throw new Error("Expected an exposed upper face");
    };
    for (const version of [1, 5] as const) {
      const open = topColor(
        buildChunk(request(12, [block], version)).layers[0],
      );
      const roof = topColor(
        buildChunk(request(12, [block, { x: 1, y: 319, z: 1, id: 3 }], version))
          .layers[0],
      );
      expect(roof).toBeLessThan(open * 0.25);
      const reopened = topColor(
        buildChunk(request(12, [block, { x: 1, y: 319, z: 1, id: 0 }], version))
          .layers[0],
      );
      expect(reopened).toBe(open);
    }
  });
});
