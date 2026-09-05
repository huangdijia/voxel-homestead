import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildChunk, plantVisualParts } from "../src/engine/mesher";
import {
  collisionBoxes,
  isOpaque,
  plantHeight,
  plantStage,
  selectionBoxes,
} from "../src/engine/shapes";
import { intersectsWorld, moveBody, raycastVoxel } from "../src/engine/physics";
import { sampleBlock } from "../src/engine/generator";
import type { ChunkRequest } from "../src/engine/protocol";
import { EntityRenderer } from "../src/game/EntityRenderer";
import type { EntityState } from "../src/game/types";
import { ItemIcon } from "../src/ui/Icons";

const request: ChunkRequest = {
  worldId: "agriculture-visuals",
  seed: "garden",
  key: "0,5,0",
  cx: 0,
  cy: 5,
  cz: 0,
  revision: 1,
  changes: [],
};
const mesh = (id: number) =>
  buildChunk({ ...request, changes: [{ x: 1, y: 81, z: 1, id }] });
const reader = (id: number) => ({
  getBlock: (x: number, y: number, z: number) =>
    x === 0 && y === 0 && z === 0 ? id : 0,
});

describe("agricultural block geometry", () => {
  it("gives every growth stage bounded volumetric leaves, nonzero boxes and a matching selection volume", () => {
    for (let id = 30; id <= 58; id++) {
      const parts = plantVisualParts(id),
        selected = selectionBoxes(id)[0];
      expect(parts.length).toBeGreaterThanOrEqual(5);
      expect(parts.length).toBeLessThanOrEqual(21);
      expect(plantVisualParts(id)).toBe(parts);
      expect(collisionBoxes(id)).toEqual([]);
      expect(isOpaque(id)).toBe(false);
      for (const part of parts) {
        expect(part.tile).toBe(15);
        for (let axis = 0; axis < 3; axis++) {
          expect(part.box[axis + 3]).toBeGreaterThan(part.box[axis]);
          expect(part.box[axis]).toBeGreaterThanOrEqual(selected[axis]);
          expect(part.box[axis + 3]).toBeLessThanOrEqual(
            selected[axis + 3] + 1e-10,
          );
          expect(Number.isFinite(part.tint[axis])).toBe(true);
          expect(part.tint[axis]).toBeGreaterThanOrEqual(0);
          expect(part.tint[axis]).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(plantVisualParts(3)).toEqual([]);
    expect(plantStage(29)).toBeNull();
  });

  it("makes all stages progressively taller and mature species distinguishable", () => {
    for (const [first, stages] of [
      [30, 8],
      [38, 8],
      [46, 8],
      [54, 4],
    ]) {
      for (let stage = 1; stage < stages; stage++) {
        expect(plantHeight(first + stage)).toBeGreaterThan(
          plantHeight(first + stage - 1),
        );
        expect(plantVisualParts(first + stage)).not.toEqual(
          plantVisualParts(first + stage - 1),
        );
      }
    }
    const mature = [37, 45, 53, 57].map((id) =>
      JSON.stringify(plantVisualParts(id)),
    );
    expect(new Set(mature).size).toBe(4);
    expect(plantVisualParts(58)).toHaveLength(6);
    expect(plantVisualParts(37)).toHaveLength(21);
  });

  it("emits plants into one cutout layer with real growth height and no solid cube", () => {
    for (const id of [30, 37, 38, 45, 46, 53, 54, 57, 58]) {
      const result = mesh(id),
        cutout = result.layers[1];
      expect(result.layers[0].positions.length).toBe(0);
      expect(result.layers[2].positions.length).toBe(0);
      expect(result.layers[3].positions.length).toBe(0);
      expect(cutout.indices.length).toBeGreaterThan(0);
      expect(cutout.indices.length).toBeLessThanOrEqual(21 * 36);
      const ys = [...cutout.positions].filter((_, index) => index % 3 === 1);
      expect(Math.max(...ys)).toBeCloseTo(1 + plantHeight(id));
      expect(result.voxels[1 * 256 + 1 * 16 + 1]).toBe(id);
    }
  });

  it("lets players cross crops and select the crop rather than blocks behind it", () => {
    for (const id of [30, 37, 45, 53, 57, 58]) {
      const world = reader(id);
      expect(intersectsWorld(world, { x: 0.5, y: 0, z: 0.5 })).toBe(false);
      const result = moveBody(
        world,
        { x: -0.5, y: 0, z: 0.5 },
        { x: 1.5, y: 0, z: 0 },
      );
      expect(result.position.x).toBeCloseTo(1);
      expect(
        raycastVoxel(
          world,
          { x: 0.5, y: plantHeight(id) * 0.5, z: -1 },
          { x: 0, y: 0, z: 1 },
        )?.id,
      ).toBe(id);
      expect(
        raycastVoxel(
          world,
          { x: 0.5, y: plantHeight(id) + 0.04, z: -1 },
          { x: 0, y: 0, z: 1 },
        ),
      ).toBeNull();
    }
  });

  it("renders dry and wet furrows at 15/16 and collision lands on the same top", () => {
    const dry = mesh(28).layers[0],
      wet = mesh(29).layers[0];
    const ys = [...dry.positions].filter((_, index) => index % 3 === 1);
    expect(Math.max(...ys)).toBe(1 + 15 / 16);
    expect(ys).toContain(1 + 14 / 16);
    expect(wet.positions).toEqual(dry.positions);
    expect(wet.colors.every((value, index) => value < dry.colors[index])).toBe(
      true,
    );
    for (const id of [28, 29]) {
      expect(collisionBoxes(id)).toEqual([[0, 0, 0, 1, 15 / 16, 1]]);
      const landing = moveBody(
        reader(id),
        { x: 0.5, y: 2, z: 0.5 },
        { x: 0, y: -3, z: 0 },
      );
      expect(landing.grounded).toBe(true);
      expect(landing.position.y).toBeCloseTo(15 / 16);
    }
  });

  it("keeps composters hollow visually, raises fill each level and uses a safe solid collision top", () => {
    let lastFill = 0;
    for (let id = 59; id <= 67; id++) {
      const layer = mesh(id).layers[0];
      expect(collisionBoxes(id)).toEqual([[0, 0, 0, 1, 0.875, 1]]);
      expect(selectionBoxes(id)).toEqual(collisionBoxes(id));
      const ys = [...layer.positions].filter((_, index) => index % 3 === 1);
      expect(Math.max(...ys)).toBe(1.875);
      expect(layer.indices.length).toBeLessThanOrEqual(10 * 36);
      if (id === 59) {
        expect(layer.indices.length).toBe(5 * 36);
      } else {
        const interiorTops: number[] = [];
        for (let i = 0; i < layer.positions.length; i += 3) {
          const [x, y, z] = layer.positions.slice(i, i + 3);
          if (
            x > 1.15 &&
            x < 1.85 &&
            z > 1.15 &&
            z < 1.85 &&
            layer.normals[i + 1] === 1 &&
            y < 1.875
          )
            interiorTops.push(y - 1);
        }
        const fill = Math.max(...interiorTops);
        expect(fill).toBeGreaterThan(lastFill);
        lastFill = fill;
      }
      const landing = moveBody(
        reader(id),
        { x: 0.5, y: 2, z: 0.5 },
        { x: 0, y: -3, z: 0 },
      );
      expect(landing.position.y).toBeCloseTo(0.875);
    }
  });

  it("uses generator 2 vegetation in worker meshes while keeping omitted versions identical to version 1", () => {
    const terrain = { ...request, cy: 1, key: "0,1,0", changes: [] };
    const legacy = buildChunk(terrain),
      explicit = buildChunk({ ...terrain, generatorVersion: 1 });
    expect(legacy.voxels).toEqual(explicit.voxels);
    const current = buildChunk({ ...terrain, generatorVersion: 2 });
    let grass = 0;
    for (let y = 0; y < 16; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const id = current.voxels[y * 256 + z * 16 + x];
          expect(id).toBe(sampleBlock(terrain.seed, x, 16 + y, z, 2));
          if (id === 58) grass++;
        }
    expect(grass).toBeGreaterThan(0);
    expect(current.layers[1].indices.length).toBeGreaterThan(
      legacy.layers[1].indices.length,
    );
  });
});

describe("agricultural entity appearance", () => {
  afterEach(() => vi.restoreAllMocks());
  const sheep = (options: Partial<EntityState> = {}): EntityState => ({
    id: "sheep",
    kind: "sheep",
    position: { x: 0, y: 0, z: 0 },
    health: 8,
    yaw: 0,
    timer: 0,
    ...options,
  });
  const setup = () => {
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(
      () => new THREE.Texture(),
    );
    const scene = new THREE.Scene(),
      renderer = new EntityRenderer(scene);
    return {
      scene,
      renderer,
      update: (e: EntityState[], time = 0) =>
        renderer.update(e, [], { x: 2, y: 0, z: 2 }, time),
    };
  };

  it("shows half-size babies, then restores adult size without recreating geometry", () => {
    const { scene, renderer, update } = setup();
    update([sheep({ age: -600 })]);
    const mob = scene.getObjectByName("mob:sheep")!;
    expect(mob.scale.x).toBe(0.5);
    expect(mob.getObjectByName("head")!.scale.x).toBeGreaterThan(1);
    const identities: string[] = [];
    mob.traverse((node) => identities.push(node.uuid));
    update([sheep({ age: 0 })], 2);
    expect(mob.scale.x).toBe(1);
    expect(mob.getObjectByName("head")!.scale.x).toBe(1);
    const after: string[] = [];
    mob.traverse((node) => after.push(node.uuid));
    expect(after).toEqual(identities);
    renderer.dispose();
  });

  it("toggles sheep fleece and courtship hearts on existing meshes and disposes shared body material once", () => {
    const { scene, renderer, update } = setup();
    update([sheep()]);
    const mob = scene.getObjectByName("mob:sheep")!,
      fleece = mob.getObjectByName("fleece")!;
    const heart = mob.getObjectByName("love-marker")!;
    const tracked = new Map<THREE.Material, ReturnType<typeof vi.fn>>();
    mob.traverse((node) => {
      if (node instanceof THREE.Mesh)
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material]) {
          if (!tracked.has(material))
            tracked.set(material, vi.spyOn(material, "dispose"));
        }
    });
    expect(fleece.visible).toBe(true);
    expect(heart.visible).toBe(false);
    for (let i = 0; i < 20; i++)
      update([sheep({ sheared: true, love: 30 })], i);
    expect(fleece.visible).toBe(false);
    expect(heart.visible).toBe(true);
    update([sheep({ sheared: false, love: 0 })], 21);
    expect(fleece.visible).toBe(true);
    expect(heart.visible).toBe(false);
    update([]);
    expect(scene.getObjectByName("mob:sheep")).toBeUndefined();
    for (const [material, spy] of tracked) {
      const sharedFace =
        material instanceof THREE.MeshLambertMaterial && material.map;
      expect(spy).toHaveBeenCalledTimes(sharedFace ? 0 : 1);
    }
    renderer.dispose();
    for (const spy of tracked.values()) expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("agricultural inventory icons", () => {
  it("gives each new item a distinct pixel SVG, including tools, foods and open containers", () => {
    const ids = [
      "wheat_seeds",
      "wheat",
      "carrot",
      "potato",
      "poisonous_potato",
      "beetroot_seeds",
      "beetroot",
      "bread",
      "baked_potato",
      "beetroot_soup",
      "bowl",
      "bone_meal",
      "wood_hoe",
      "stone_hoe",
      "iron_hoe",
      "shears",
      "bucket",
      "water_bucket",
      "composter",
      "short_grass",
    ];
    const icons = ids.map((id) =>
      renderToStaticMarkup(createElement(ItemIcon, { id })),
    );
    for (const markup of icons) {
      expect(markup).toContain("<svg");
      expect(markup).toContain('viewBox="0 0 16 16"');
      expect(markup).toContain('shape-rendering="crispEdges"');
      expect(markup).not.toContain("item-cube");
    }
    expect(new Set(icons).size).toBe(ids.length);
  });
});
