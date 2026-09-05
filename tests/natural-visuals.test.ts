import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildChunk, saplingVisualParts } from "../src/engine/mesher";
import {
  collisionBoxes,
  fluidSurfaceHeights,
  isOpaque,
  selectionBoxes,
} from "../src/engine/shapes";
import { intersectsWorld, moveBody, raycastVoxel } from "../src/engine/physics";
import { fluidHeight } from "../src/game/fluid-blocks";
import { ItemIcon } from "../src/ui/Icons";
import type { ChunkRequest, MeshArrays } from "../src/engine/protocol";

const request: ChunkRequest = {
  worldId: "natural-visuals",
  seed: "water",
  key: "0,5,0",
  cx: 0,
  cy: 5,
  cz: 0,
  revision: 1,
  changes: [],
};
const reader = (blocks: Record<string, number>) => ({
  getBlock: (x: number, y: number, z: number) => blocks[`${x},${y},${z}`] ?? 0,
});
const mesh = (
  changes: ChunkRequest["changes"],
  patch: Partial<ChunkRequest> = {},
) => buildChunk({ ...request, ...patch, changes });
const heights = (layer: MeshArrays) =>
  [...layer.positions].filter((_, i) => i % 3 === 1);
const fluidIds = [6, ...Array.from({ length: 13 }, (_, i) => 68 + i)];

describe("continuous fluid geometry", () => {
  it("renders every isolated level at its physical height in the correct material layer", () => {
    for (const id of fluidIds) {
      const result = mesh([{ x: 1, y: 81, z: 1, id }]),
        layerIndex = id >= 76 ? 3 : 2;
      expect(result.layers[layerIndex].indices.length).toBe(36);
      expect(Math.max(...heights(result.layers[layerIndex]))).toBeCloseTo(
        1 + fluidHeight(id),
      );
      for (const [index, layer] of result.layers.entries())
        if (index !== layerIndex) expect(layer.indices.length).toBe(0);
    }
  });

  it("shares exact corner heights between different levels, including negative chunk borders", () => {
    const world = reader({
      "-1,81,0": 6,
      "0,81,0": 74,
      "-1,81,1": 71,
      "0,81,1": 69,
    });
    const left = fluidSurfaceHeights(6, -1, 81, 0, world.getBlock),
      right = fluidSurfaceHeights(74, 0, 81, 0, world.getBlock);
    expect(left[1]).toBe(right[0]);
    expect(left[3]).toBe(right[2]);
    expect(left[1]).toBeLessThan(8 / 9);
    expect(left[1]).toBeGreaterThan(1 / 9);
    const changes = [
      { x: -1, y: 81, z: 0, id: 6 },
      { x: 0, y: 81, z: 0, id: 74 },
      { x: -1, y: 81, z: 1, id: 71 },
      { x: 0, y: 81, z: 1, id: 69 },
    ];
    const leftMesh = mesh(changes, { cx: -1, key: "-1,5,0" }).layers[2],
      rightMesh = mesh(changes).layers[2];
    const edge = (layer: MeshArrays, x: number) => {
      const result: string[] = [];
      for (let i = 0; i < layer.positions.length; i += 3)
        if (layer.positions[i] === x && layer.normals[i + 1] === 1)
          result.push(`${layer.positions[i + 1]},${layer.positions[i + 2]}`);
      return [...new Set(result)].sort();
    };
    expect(edge(leftMesh, 16)).toEqual(edge(rightMesh, 0));
    expect(edge(leftMesh, 16).length).toBeGreaterThan(0);
  });

  it("removes shared faces across different fluid levels and retains both exposed tops", () => {
    for (const pair of [
      [6, 74],
      [68, 73],
      [76, 79],
      [77, 78],
    ]) {
      const result = mesh([
        { x: 1, y: 81, z: 1, id: pair[0] },
        { x: 2, y: 81, z: 1, id: pair[1] },
      ]);
      const layer = result.layers[pair[0] >= 76 ? 3 : 2];
      expect(layer.indices.length).toBe(60);
      let topVertices = 0;
      for (let i = 0; i < layer.positions.length; i += 3) {
        if (layer.normals[i + 1] === 1) topVertices++;
        expect(
          layer.positions[i] === 2 && Math.abs(layer.normals[i]) === 1,
        ).toBe(false);
      }
      expect(topVertices).toBe(8);
    }
  });

  it("fills a falling column to the next cell with no internal horizontal surface", () => {
    for (const [bottom, top, layerId] of [
      [74, 75, 2],
      [79, 80, 3],
    ]) {
      const result = mesh([
        { x: 1, y: 81, z: 1, id: bottom },
        { x: 1, y: 82, z: 1, id: top },
      ]).layers[layerId];
      expect(result.indices.length).toBe(60);
      expect(Math.max(...heights(result))).toBe(3);
      for (let i = 0; i < result.positions.length; i += 3)
        if (Math.abs(result.normals[i + 1]) === 1)
          expect(result.positions[i + 1]).not.toBe(2);
    }
  });

  it("keeps a recessed liquid top under a solid roof and lava bright in darkness", () => {
    const water = mesh([
      { x: 1, y: 81, z: 1, id: 6 },
      { x: 1, y: 82, z: 1, id: 3 },
    ]).layers[2];
    expect(water.indices.length).toBe(36);
    const lava = mesh([
      { x: 1, y: 81, z: 1, id: 76 },
      { x: 1, y: 86, z: 1, id: 3 },
    ]).layers[3];
    for (let i = 0; i < lava.colors.length; i += 3) {
      expect(lava.colors[i]).toBe(1);
      expect(lava.colors[i + 1]).toBeGreaterThan(0.28);
      expect(lava.colors[i + 1]).toBeLessThan(0.53);
      expect(lava.colors[i + 2]).toBeLessThan(0.07);
    }
  });
});

describe("fluid and plant selection", () => {
  it("keeps every fluid noncolliding and transparent to normal and solid-only interaction rays", () => {
    for (const id of fluidIds) {
      const world = reader({ "0,0,0": id, "2,0,0": 81 });
      expect(collisionBoxes(id)).toEqual([]);
      expect(selectionBoxes(id)).toEqual([]);
      expect(isOpaque(id)).toBe(false);
      expect(intersectsWorld(world, { x: 0.5, y: 0, z: 0.5 })).toBe(false);
      expect(
        moveBody(world, { x: -0.5, y: 0, z: 0.5 }, { x: 1.5, y: 0, z: 0 })
          .position.x,
      ).toBe(1);
      for (const solidOnly of [false, true]) {
        const hit = raycastVoxel(
          world,
          { x: -1, y: 0.05, z: 0.5 },
          { x: 1, y: 0, z: 0 },
          5,
          false,
          solidOnly,
        );
        expect(hit?.id).toBe(81);
      }
    }
  });

  it("opts into all fluid levels and selects the real top, including low flows and lava", () => {
    for (const id of fluidIds) {
      const world = reader({ "-1,0,-1": id });
      const hit = raycastVoxel(
        world,
        { x: -0.5, y: 2, z: -0.5 },
        { x: 0, y: -1, z: 0 },
        4,
        true,
      );
      expect(hit?.id).toBe(id);
      expect(hit?.distance).toBeCloseTo(2 - fluidHeight(id));
      expect(hit?.normal).toEqual({ x: 0, y: 1, z: 0 });
      if (fluidHeight(id) < 1)
        expect(
          raycastVoxel(
            world,
            { x: -2, y: fluidHeight(id) + 0.03, z: -0.5 },
            { x: 1, y: 0, z: 0 },
            4,
            true,
          ),
        ).toBeNull();
      expect(
        raycastVoxel(
          world,
          { x: -0.5, y: 2, z: -0.5 },
          { x: 0, y: -1, z: 0 },
          0.5,
          true,
        ),
      ).toBeNull();
    }
  });

  it("matches the sloping top triangles rather than a flat source bounding box", () => {
    const world = reader({ "0,0,0": 6, "1,0,0": 74 });
    const h = fluidSurfaceHeights(6, 0, 0, 0, world.getBlock);
    for (const x of [0.1, 0.5, 0.9]) {
      const expected = h[0] * (1 - x) + h[1] * x;
      const hit = raycastVoxel(
        world,
        { x, y: 2, z: 0.5 },
        { x: 0, y: -1, z: 0 },
        4,
        true,
      );
      expect(hit?.id).toBe(6);
      expect(hit?.distance).toBeCloseTo(2 - expected);
    }
    expect(
      raycastVoxel(
        world,
        { x: 0.5, y: 0.1, z: 0.5 },
        { x: 1, y: 0, z: 0 },
        4,
        true,
      )?.distance,
    ).toBe(0);
  });
});

describe("natural block appearance", () => {
  it("gives permanent leaves the same texture and shared face culling as natural leaves", () => {
    const natural = mesh([{ x: 1, y: 81, z: 1, id: 8 }]).layers[1],
      permanent = mesh([{ x: 1, y: 81, z: 1, id: 82 }]).layers[1];
    expect(permanent).toEqual(natural);
    expect(isOpaque(82)).toBe(false);
    expect(collisionBoxes(82)).toEqual([[0, 0, 0, 1, 1, 1]]);
    const joined = mesh([
      { x: 1, y: 81, z: 1, id: 8 },
      { x: 2, y: 81, z: 1, id: 82 },
    ]).layers[1];
    expect(joined.indices.length).toBe(60);
  });

  it("renders obsidian as a solid purple-black stone and keeps its collision", () => {
    const obsidian = mesh([{ x: 1, y: 81, z: 1, id: 81 }]).layers[0],
      stone = mesh([{ x: 1, y: 81, z: 1, id: 3 }]).layers[0];
    expect(obsidian.uvs).toEqual(stone.uvs);
    expect(obsidian.indices.length).toBe(36);
    expect(isOpaque(81)).toBe(true);
    expect(collisionBoxes(81)).toEqual([[0, 0, 0, 1, 1, 1]]);
    for (let i = 0; i < obsidian.colors.length; i += 3) {
      expect(obsidian.colors[i + 2]).toBeGreaterThan(obsidian.colors[i]);
      expect(obsidian.colors[i]).toBeGreaterThan(obsidian.colors[i + 1]);
      expect(obsidian.colors[i + 2]).toBeLessThan(0.3);
    }
  });

  it("builds a bounded cutout sapling that players can cross and select", () => {
    const selected = selectionBoxes(83)[0];
    expect(saplingVisualParts.length).toBeLessThanOrEqual(8);
    for (const part of saplingVisualParts)
      for (let axis = 0; axis < 3; axis++) {
        expect(part.box[axis]).toBeGreaterThanOrEqual(selected[axis]);
        expect(part.box[axis + 3]).toBeLessThanOrEqual(selected[axis + 3]);
        expect(part.box[axis + 3]).toBeGreaterThan(part.box[axis]);
      }
    const result = mesh([{ x: 1, y: 81, z: 1, id: 83 }]);
    expect(result.layers[0].indices.length).toBe(0);
    expect(result.layers[1].indices.length).toBe(7 * 36);
    expect(collisionBoxes(83)).toEqual([]);
    expect(isOpaque(83)).toBe(false);
    const world = reader({ "0,0,0": 83 });
    expect(
      raycastVoxel(world, { x: 0.5, y: 0.5, z: -1 }, { x: 0, y: 0, z: 1 })?.id,
    ).toBe(83);
    expect(
      raycastVoxel(world, { x: 0.5, y: 0.9, z: -1 }, { x: 0, y: 0, z: 1 }),
    ).toBeNull();
  });

  it("provides distinct pixel icons for the lava bucket, sapling and obsidian", () => {
    const icons = [
      "bucket",
      "water_bucket",
      "lava_bucket",
      "oak_sapling",
      "obsidian",
    ].map((id) => renderToStaticMarkup(createElement(ItemIcon, { id })));
    expect(new Set(icons).size).toBe(icons.length);
    for (const markup of icons) {
      expect(markup).toContain("<svg");
      expect(markup).toContain('shape-rendering="crispEdges"');
      expect(markup).not.toContain("item-cube");
    }
  });
});
