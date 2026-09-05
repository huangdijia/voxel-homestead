import * as THREE from "three";
import type { BlockChange, Vec3, WorldPort } from "../game/types";
import {
  CHUNK_SIZE,
  sampleBlock,
  surfaceHeight,
  WORLD_MIN_Y,
  WORLD_MAX_Y,
} from "./generator";
import type { ChunkRequest, ChunkResult } from "./protocol";
import { buildChunk } from "./mesher";
import { isOpaque } from "./shapes";

type Chunk = { voxels: Uint16Array; meshes: THREE.Mesh[] };
const keyOf = (x: number, y: number, z: number) => x + "," + y + "," + z;
const chunkKey = (x: number, y: number, z: number) =>
  keyOf(Math.floor(x / 16), Math.floor(y / 16), Math.floor(z / 16));
const positiveModulo = (n: number) => ((n % 16) + 16) % 16;

/** Owns chunk resources, while procedural data and changes remain independent of rendering. */
export class VoxelWorld implements WorldPort {
  private chunks = new Map<string, Chunk>();
  private changes = new Map<string, BlockChange>();
  private chunkChanges = new Map<string, Map<string, BlockChange>>();
  private torches = new Map<string, BlockChange>();
  private wanted = new Set<string>();
  private expected = new Map<string, number>();
  private queue = new Map<string, ChunkRequest>();
  private worker: Worker | null = null;
  private inFlight: ChunkRequest | null = null;
  private revision = 0;
  private disposed = false;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private center = { x: 0, y: 1, z: 0 };
  private currentRadius = -1;
  private currentVertical = -100;
  private texture: THREE.Texture;
  private materials: THREE.Material[];
  private torchLights: THREE.PointLight[] = [];
  private lastLights = "";
  private lastLightPosition = "";
  public ready = false;

  constructor(
    private scene: THREE.Scene,
    public readonly seed: string,
    changes: BlockChange[],
    public readonly worldId: string,
  ) {
    for (const change of changes) {
      if (
        !Number.isInteger(change.x) ||
        !Number.isInteger(change.y) ||
        !Number.isInteger(change.z)
      )
        continue;
      this.recordChange(change);
    }
    this.texture = new THREE.TextureLoader().load("/assets/terrain-atlas.png");
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.materials = [
      new THREE.MeshLambertMaterial({ map: this.texture, vertexColors: true }),
      new THREE.MeshLambertMaterial({
        map: this.texture,
        vertexColors: true,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
      }),
      new THREE.MeshLambertMaterial({
        map: this.texture,
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        vertexColors: true,
        toneMapped: false,
      }),
    ];
    if (typeof Worker !== "undefined") {
      try {
        this.worker = new Worker(
          new URL("./terrain.worker.ts", import.meta.url),
          { type: "module" },
        );
        this.worker.addEventListener(
          "message",
          (event: MessageEvent<ChunkResult>) => this.receive(event.data),
        );
        this.worker.addEventListener("error", () => this.workerFailed());
      } catch {
        this.worker = null;
      }
    }
  }

  get stats(): { chunks: number; pending: number } {
    return {
      chunks: this.chunks.size,
      pending: this.queue.size + (this.inFlight ? 1 : 0),
    };
  }
  getBlock(x: number, y: number, z: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < WORLD_MIN_Y) return 24;
    if (y > WORLD_MAX_Y) return 0;
    const change = this.changes.get(keyOf(x, y, z));
    if (change) return change.id;
    const chunk = this.chunks.get(chunkKey(x, y, z));
    if (chunk)
      return chunk.voxels[
        positiveModulo(y) * 256 + positiveModulo(z) * 16 + positiveModulo(x)
      ];
    return sampleBlock(this.seed, x, y, z);
  }
  setBlock(x: number, y: number, z: number, id: number): void {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (
      this.disposed ||
      y < WORLD_MIN_Y ||
      y > WORLD_MAX_Y ||
      !Number.isInteger(id) ||
      id < 0 ||
      id > 27
    )
      return;
    const previous = this.getBlock(x, y, z);
    if (previous === id) return;
    const key = keyOf(x, y, z),
      ckey = chunkKey(x, y, z);
    if (id === sampleBlock(this.seed, x, y, z)) {
      this.changes.delete(key);
      this.torches.delete(key);
      this.chunkChanges.get(ckey)?.delete(key);
      if (this.chunkChanges.get(ckey)?.size === 0)
        this.chunkChanges.delete(ckey);
    } else this.recordChange({ x, y, z, id });
    const resident = this.chunks.get(ckey);
    if (resident)
      resident.voxels[
        positiveModulo(y) * 256 + positiveModulo(z) * 16 + positiveModulo(x)
      ] = id;
    const affected = new Set([ckey]);
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ])
      affected.add(chunkKey(x + dx, y + dy, z + dz));
    if (isOpaque(previous) !== isOpaque(id)) {
      // Roof edits also invalidate the sky shading of already loaded sections below.
      const columns = new Set([
        keyOf(Math.floor(x / 16), 0, Math.floor(z / 16)),
      ]);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        columns.add(
          keyOf(Math.floor((x + dx) / 16), 0, Math.floor((z + dz) / 16)),
        );
      for (const column of columns) {
        const [columnX, , columnZ] = column.split(",").map(Number);
        for (let below = -1; below < Math.floor(y / 16); below++)
          affected.add(keyOf(columnX, below, columnZ));
      }
    }
    // Newly placed high-altitude blocks become part of the streamed column.
    const cx = Math.floor(x / 16),
      cz = Math.floor(z / 16);
    if (
      Math.abs(cx - this.center.x) <= this.currentRadius &&
      Math.abs(cz - this.center.z) <= this.currentRadius
    )
      this.wanted.add(ckey);
    for (const dirty of affected)
      if (this.wanted.has(dirty)) this.enqueue(dirty);
    this.lastLights = "";
    this.lastLightPosition = "";
    this.pump();
  }
  getSurface(x: number, z: number): number {
    return surfaceHeight(this.seed, x, z);
  }
  getChanges(): BlockChange[] {
    return Array.from(this.changes.values(), (c) => ({ ...c }));
  }
  isReady(x: number, z: number): boolean {
    const cx = Math.floor(x / 16),
      cz = Math.floor(z / 16);
    for (let cy = -1; cy <= 2; cy++)
      if (!this.chunks.has(keyOf(cx, cy, cz))) return false;
    return true;
  }
  /** Block light only. Sky light/daytime is managed by the game simulation. */
  getLight(x: number, y: number, z: number): number {
    let light = 0;
    for (const block of this.torches.values()) {
      const distance =
        Math.abs(x - block.x) + Math.abs(y - block.y) + Math.abs(z - block.z);
      if (distance < 14) light = Math.max(light, 14 - distance);
    }
    return Math.max(0, Math.floor(light));
  }

  update(position: Vec3, radius: number): void {
    if (this.disposed) return;
    const cx = Math.floor(position.x / 16),
      cy = Math.floor(position.y / 16),
      cz = Math.floor(position.z / 16);
    radius = Math.max(1, Math.min(6, Math.floor(radius)));
    if (
      cx !== this.center.x ||
      cz !== this.center.z ||
      radius !== this.currentRadius ||
      cy !== this.currentVertical
    ) {
      this.center = { x: cx, y: cy, z: cz };
      this.currentRadius = radius;
      this.currentVertical = cy;
      const wanted = new Set<string>();
      for (let z = cz - radius; z <= cz + radius; z++)
        for (let x = cx - radius; x <= cx + radius; x++) {
          for (let y = -1; y <= Math.max(2, Math.min(5, cy + 1)); y++)
            wanted.add(keyOf(x, y, z));
        }
      for (const key of this.chunkChanges.keys()) {
        const [x, , z] = key.split(",").map(Number);
        if (Math.abs(x - cx) <= radius && Math.abs(z - cz) <= radius)
          wanted.add(key);
      }
      this.wanted = wanted;
      for (const key of this.chunks.keys())
        if (!wanted.has(key)) this.removeChunk(key);
      for (const key of this.queue.keys())
        if (!wanted.has(key)) this.queue.delete(key);
      for (const key of this.expected.keys())
        if (!wanted.has(key)) this.expected.delete(key);
      const keys = [...wanted].sort(
        (a, b) => this.priority(a) - this.priority(b),
      );
      for (const key of keys)
        if (
          !this.chunks.has(key) &&
          !this.queue.has(key) &&
          this.inFlight?.key !== key
        )
          this.enqueue(key);
      this.pump();
    }
    this.updateLights(position);
    // Reloading a saved game far from origin must not wait for that unloaded origin.
    this.ready = this.isReady(position.x, position.z);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    if (this.fallbackTimer !== null) clearTimeout(this.fallbackTimer);
    for (const key of this.chunks.keys()) this.removeChunk(key);
    this.queue.clear();
    this.expected.clear();
    this.wanted.clear();
    this.inFlight = null;
    for (const light of this.torchLights) this.scene.remove(light);
    this.torchLights.length = 0;
    for (const material of this.materials) material.dispose();
    this.texture.dispose();
    this.ready = false;
  }
  private recordChange(change: BlockChange): void {
    const key = keyOf(change.x, change.y, change.z),
      ckey = chunkKey(change.x, change.y, change.z);
    this.changes.set(key, { ...change });
    if (change.id === 16) this.torches.set(key, { ...change });
    else this.torches.delete(key);
    let list = this.chunkChanges.get(ckey);
    if (!list) this.chunkChanges.set(ckey, (list = new Map()));
    list.set(key, { ...change });
  }
  private enqueue(key: string): void {
    if (!this.wanted.has(key)) return;
    const [cx, cy, cz] = key.split(",").map(Number),
      revision = ++this.revision;
    const changes: BlockChange[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (let y = -1; y <= 5; y++) {
          const list = this.chunkChanges.get(keyOf(cx + dx, y, cz + dz));
          if (list)
            for (const change of list.values()) {
              if (
                change.x >= cx * 16 - 1 &&
                change.x <= cx * 16 + 16 &&
                change.z >= cz * 16 - 1 &&
                change.z <= cz * 16 + 16
              )
                changes.push(change);
            }
        }
    this.expected.set(key, revision);
    this.queue.set(key, {
      worldId: this.worldId,
      seed: this.seed,
      key,
      cx,
      cy,
      cz,
      revision,
      changes,
    });
  }
  private priority(key: string): number {
    const [x, y, z] = key.split(",").map(Number);
    return (
      ((x - this.center.x) ** 2 + (z - this.center.z) ** 2) * 8 +
      Math.abs(y - this.center.y) * 0.3
    );
  }
  private pump(): void {
    if (this.disposed || this.inFlight || this.queue.size === 0) return;
    let best: ChunkRequest | undefined,
      priority = Infinity;
    for (const request of this.queue.values()) {
      const p =
        this.priority(request.key) - (this.chunks.has(request.key) ? 10000 : 0);
      if (p < priority) {
        best = request;
        priority = p;
      }
    }
    if (!best) return;
    this.queue.delete(best.key);
    this.inFlight = best;
    if (this.worker) this.worker.postMessage(best);
    else {
      const request = best;
      this.fallbackTimer = setTimeout(() => {
        this.fallbackTimer = null;
        if (!this.disposed) this.receive(buildChunk(request));
      }, 0);
    }
  }
  private receive(result: ChunkResult): void {
    if (this.disposed || result.worldId !== this.worldId) return;
    if (
      this.inFlight?.key === result.key &&
      this.inFlight.revision === result.revision
    )
      this.inFlight = null;
    if (result.error) {
      console.warn("Terrain generation failed:", result.error);
      this.pump();
      return;
    }
    if (
      this.wanted.has(result.key) &&
      this.expected.get(result.key) === result.revision
    ) {
      this.removeChunk(result.key);
      const [cx, cy, cz] = result.key.split(",").map(Number),
        meshes: THREE.Mesh[] = [];
      result.layers.forEach((layer, index) => {
        if (layer.indices.length === 0) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(layer.positions, 3),
        );
        geometry.setAttribute(
          "normal",
          new THREE.BufferAttribute(layer.normals, 3),
        );
        geometry.setAttribute("uv", new THREE.BufferAttribute(layer.uvs, 2));
        geometry.setAttribute(
          "color",
          new THREE.BufferAttribute(layer.colors, 3),
        );
        geometry.setIndex(new THREE.BufferAttribute(layer.indices, 1));
        geometry.boundingSphere = new THREE.Sphere(
          new THREE.Vector3(8, 8, 8),
          14,
        );
        geometry.boundingBox = new THREE.Box3(
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(16, 16, 16),
        );
        const mesh = new THREE.Mesh(geometry, this.materials[index]);
        mesh.position.set(cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE);
        mesh.receiveShadow = false;
        mesh.castShadow = false;
        mesh.renderOrder = index === 2 ? 2 : 0;
        this.scene.add(mesh);
        meshes.push(mesh);
      });
      this.chunks.set(result.key, { voxels: result.voxels, meshes });
    }
    this.pump();
  }
  private removeChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    for (const mesh of chunk.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunks.delete(key);
  }
  private workerFailed(): void {
    if (this.disposed) return;
    this.worker?.terminate();
    this.worker = null;
    const failed = this.inFlight;
    this.inFlight = null;
    if (failed && this.wanted.has(failed.key)) this.enqueue(failed.key);
    this.pump();
  }
  private updateLights(position: Vec3): void {
    const positionKey = keyOf(
      Math.floor(position.x),
      Math.floor(position.y),
      Math.floor(position.z),
    );
    if (positionKey === this.lastLightPosition) return;
    this.lastLightPosition = positionKey;
    const lights = [...this.torches.values()]
      .filter(
        (c) =>
          Math.hypot(c.x - position.x, c.y - position.y, c.z - position.z) < 22,
      )
      .sort(
        (a, b) =>
          (a.x - position.x) ** 2 +
          (a.z - position.z) ** 2 -
          ((b.x - position.x) ** 2 + (b.z - position.z) ** 2),
      )
      .slice(0, 8);
    const key = lights.map((l) => keyOf(l.x, l.y, l.z)).join(";");
    if (key === this.lastLights) return;
    this.lastLights = key;
    while (this.torchLights.length < lights.length) {
      const light = new THREE.PointLight(0xffba64, 20, 12, 1.25);
      this.torchLights.push(light);
      this.scene.add(light);
    }
    this.torchLights.forEach((light, i) => {
      light.visible = i < lights.length;
      if (lights[i])
        light.position.set(
          lights[i].x + 0.5,
          lights[i].y + 0.85,
          lights[i].z + 0.5,
        );
    });
  }
}
