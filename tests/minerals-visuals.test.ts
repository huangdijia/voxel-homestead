import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildChunk } from "../src/engine/mesher";
import { mineralAppearance } from "../src/game/mineral-appearance";
import { BLOCKS, ITEMS } from "../src/game/registry";
import { Game } from "../src/game/Game";
import { ItemIcon } from "../src/ui/Icons";
import type { ChunkRequest, MeshArrays } from "../src/engine/protocol";

const request: ChunkRequest = {
  worldId: "mineral-visuals",
  seed: "crystal",
  key: "0,5,0",
  cx: 0,
  cy: 5,
  cz: 0,
  revision: 1,
  changes: [],
};
const mesh = (id: number, extras: ChunkRequest["changes"] = []) =>
  buildChunk({ ...request, changes: [{ x: 1, y: 81, z: 1, id }, ...extras] });
const topColors = (layer: MeshArrays) => {
  const colors: number[][] = [];
  for (let i = 0; i < layer.normals.length; i += 3)
    if (layer.normals[i + 1] === 1)
      colors.push([...layer.colors.slice(i, i + 3)]);
  return colors;
};
const containsColor = (colors: number[][], expected: number[]) =>
  colors.some((color) =>
    color.every((value, index) => Math.abs(value - expected[index]) < 1e-6),
  );
const markup = (id: string) =>
  renderToStaticMarkup(createElement(ItemIcon, { id }));

describe("mineral faces and shared palettes", () => {
  it("keeps stone and colored grains as separate visible surfaces for every new ore", () => {
    for (const id of [84, 85, 86, 87, 88, 89, 92, 93, 94, 95, 96, 97, 98, 99]) {
      const appearance = mineralAppearance(id)!,
        result = mesh(id),
        layer = result.layers[0],
        colors = topColors(layer);
      expect(appearance.kind).toBe("ore");
      expect(containsColor(colors, appearance.base)).toBe(true);
      expect(containsColor(colors, appearance.grain)).toBe(true);
      expect(containsColor(colors, appearance.highlight)).toBe(true);
      expect(layer.indices.length).toBe(6 * 9 * 6);
      expect(
        result.layers.slice(1).every((other) => other.indices.length === 0),
      ).toBe(true);
      expect([...layer.positions].every(Number.isFinite)).toBe(true);
      expect(Math.min(...layer.positions)).toBeGreaterThan(0.997);
      expect(Math.max(...layer.positions)).toBeLessThan(2.003);
      // The base retains the original stone tile; only crystal patches use tile 15.
      expect([...layer.uvs.slice(0, 48)].some((value) => value > 0.75)).toBe(
        true,
      );
    }
  });

  it("preserves each ore color in deep layers while darkening only the rock base", () => {
    for (let surface = 84; surface <= 89; surface++) {
      const light = mineralAppearance(surface)!,
        deep = mineralAppearance(surface + 10)!;
      expect(deep.grain).toEqual(light.grain);
      expect(deep.highlight).toEqual(light.highlight);
      expect(
        deep.base.every((value, axis) => value < light.base[axis] * 0.5),
      ).toBe(true);
      const lightColors = topColors(mesh(surface).layers[0]),
        deepColors = topColors(mesh(surface + 10).layers[0]);
      expect(containsColor(lightColors, light.grain)).toBe(true);
      expect(containsColor(deepColors, light.grain)).toBe(true);
      expect(containsColor(deepColors, [1, 1, 1])).toBe(false);
    }
    expect(
      new Set(
        Array.from({ length: 8 }, (_, index) =>
          JSON.stringify(mineralAppearance(92 + index)!.grain),
        ),
      ).size,
    ).toBe(8);
  });

  it("culls the rock face and all crystal geometry against an opaque neighboring chunk", () => {
    const result = buildChunk({
      ...request,
      changes: [
        { x: 15, y: 81, z: 1, id: 88 },
        { x: 16, y: 81, z: 1, id: 98 },
      ],
    });
    const layer = result.layers[0];
    expect(layer.indices.length).toBe(5 * 9 * 6);
    for (let i = 0; i < layer.normals.length; i += 3)
      expect(layer.normals[i]).not.toBe(1);
    const enclosed = mesh(88, [
      { x: 2, y: 81, z: 1, id: 3 },
      { x: 0, y: 81, z: 1, id: 3 },
      { x: 1, y: 82, z: 1, id: 3 },
      { x: 1, y: 80, z: 1, id: 3 },
      { x: 1, y: 81, z: 2, id: 3 },
      { x: 1, y: 81, z: 0, id: 3 },
    ]).layers[0];
    expect(enclosed.indices.length).toBe(6 * 5 * 6);
  });

  it("keeps all mineral details dark under a roof instead of making ores emissive", () => {
    for (const id of [85, 86, 88, 98, 104]) {
      const open = topColors(mesh(id).layers[0]);
      const covered = mesh(id, [{ x: 1, y: 87, z: 1, id: 3 }]).layers[0];
      const oreTop: number[] = [];
      for (let i = 0; i < covered.positions.length; i += 3)
        if (covered.positions[i + 1] < 2.003 && covered.normals[i + 1] === 1)
          oreTop.push(covered.colors[i]);
      expect(Math.max(...oreTop)).toBeLessThan(
        Math.max(...open.map((c) => c[0])) * 0.5,
      );
    }
  });

  it("distinguishes sediment bands, fractured deep cobble, polished blocks and raw metal chunks", () => {
    expect(mineralAppearance(90)!.tile).toBe(3);
    expect(mineralAppearance(91)!.tile).toBe(12);
    expect(mesh(90).layers[0].uvs).not.toEqual(mesh(91).layers[0].uvs);
    expect(mesh(90).layers[0].indices.length).toBe(6 * 3 * 6);
    for (let id = 100; id <= 110; id++) {
      const appearance = mineralAppearance(id)!,
        layer = mesh(id).layers[0];
      expect(layer.indices.length).toBe(6 * (id < 108 ? 5 : 9) * 6);
      expect(containsColor(topColors(layer), appearance.grain)).toBe(true);
      expect(appearance.kind).toBe(id < 108 ? "block" : "raw");
    }
    expect(mineralAppearance(3)).toBeUndefined();
    expect(mineralAppearance(9)).toBeUndefined();
    expect(mesh(3).layers[0].indices.length).toBe(36);
    expect(mesh(9).layers[0].indices.length).toBe(36);
    expect(mesh(10).layers[0].indices.length).toBe(36);
  });
});

describe("mineral item and equipment icons", () => {
  it("gives all 27 new blocks distinct pixel icons including their colored ore grains", () => {
    const icons: string[] = [];
    for (let id = 84; id <= 110; id++) {
      const icon = markup(BLOCKS[id].key);
      expect(icon).toContain("<svg");
      expect(icon).toContain('shape-rendering="crispEdges"');
      expect(icon).not.toContain("item-cube");
      icons.push(icon);
    }
    expect(new Set(icons).size).toBe(27);
  });

  it("draws distinct raw metals, ingots, gems, powder and nuggets from item metadata", () => {
    const ids = [
      "raw_copper",
      "raw_gold",
      "copper_ingot",
      "gold_ingot",
      "redstone",
      "lapis_lazuli",
      "diamond",
      "emerald",
      "gold_nugget",
      "iron_nugget",
    ];
    const icons = ids.map((id) => markup(id));
    expect(new Set(icons).size).toBe(ids.length);
    for (const [index, icon] of icons.entries()) {
      expect(icon).toContain("<svg");
      expect(icon).toContain(ITEMS[ids[index]].color);
    }
  });

  it("shows material colors on every gold and diamond tool and armor shape", () => {
    for (const material of ["gold", "diamond", "iron"]) {
      const icons: string[] = [];
      for (const tool of [
        "pickaxe",
        "axe",
        "shovel",
        "sword",
        "hoe",
        "helmet",
        "chestplate",
        "leggings",
        "boots",
      ]) {
        const id = `${material}_${tool}`,
          icon = markup(id);
        expect(icon).toContain(ITEMS[id].color);
        expect(icon).toContain("<svg");
        icons.push(icon);
      }
      expect(new Set(icons).size).toBe(9);
    }
    // Gold intentionally has wood's harvest tier; its material must still be gold.
    expect(ITEMS.gold_pickaxe.tier).toBe(ITEMS.wood_pickaxe.tier);
    expect(markup("gold_pickaxe")).not.toBe(markup("wood_pickaxe"));
  });

  it("colors actual hand meshes from item metadata and disposes old tool materials on switching", () => {
    const game = Object.assign(Object.create(Game.prototype), {
      hand: new THREE.Group(),
      handId: "",
      handMaterials: [],
      handGeometry: new THREE.BoxGeometry(1, 1, 1),
      handSwing: 0,
      paused: false,
      elapsed: 0,
      simulation: {
        held: { id: "gold_pickaxe", count: 1 },
        player: { velocity: { x: 0, z: 0 }, dead: false },
      },
    });
    let disposals = 0;
    try {
      for (const material of ["gold", "diamond"])
        for (const tool of ["pickaxe", "axe", "shovel", "sword", "hoe"]) {
          const id = `${material}_${tool}`;
          game.simulation.held = { id, count: 1 };
          const previousMaterials = game.handMaterials.length;
          game.handMaterials.forEach((old: THREE.Material) =>
            old.addEventListener("dispose", () => disposals++),
          );
          const before = disposals;
          game.updateHand(0);
          expect(disposals - before).toBe(previousMaterials);
          const metalMeshes = game.hand.children.slice(1) as THREE.Mesh<
            THREE.BoxGeometry,
            THREE.MeshLambertMaterial
          >[];
          expect(metalMeshes.length).toBeGreaterThan(0);
          for (const mesh of metalMeshes)
            expect(mesh.material.color.getHexString()).toBe(
              ITEMS[id].color!.slice(1),
            );
          const identities = game.hand.children.map(
            (child: THREE.Object3D) => child.uuid,
          );
          game.updateHand(1 / 60);
          expect(
            game.hand.children.map((child: THREE.Object3D) => child.uuid),
          ).toEqual(identities);
        }
    } finally {
      game.handGeometry.dispose();
      game.handMaterials.forEach((material: THREE.Material) =>
        material.dispose(),
      );
    }
  });

  it("gives every held mineral a matching stone base and front-facing colored crystal geometry", () => {
    const textures = vi
      .spyOn(THREE.TextureLoader.prototype, "load")
      .mockImplementation(() => new THREE.Texture());
    const game = Object.assign(Object.create(Game.prototype), {
      hand: new THREE.Group(),
      handId: "",
      handMaterials: [],
      handGeometry: new THREE.BoxGeometry(1, 1, 1),
      handSwing: 0,
      paused: false,
      elapsed: 0,
      simulation: {
        held: null,
        player: { velocity: { x: 0, z: 0 }, dead: false },
      },
    });
    try {
      const signatures = new Set<string>();
      for (let id = 84; id <= 110; id++) {
        const appearance = mineralAppearance(id)!;
        game.simulation.held = { id: BLOCKS[id].key, count: 1 };
        game.updateHand(0);
        expect(game.hand.children).toHaveLength(2);
        const base = game.hand.children[0] as THREE.Mesh<
          THREE.BoxGeometry,
          THREE.MeshLambertMaterial
        >;
        const details = game.hand.children[1] as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshLambertMaterial
        >;
        expect(base.geometry).toBe(game.handGeometry);
        expect(base.material.color.toArray()).toEqual(appearance.base);
        expect(base.material.map!.offset.x).toBeCloseTo(
          (appearance.tile % 4) / 4 + 0.0005,
        );
        expect(base.scale.x).toBe(0.25);
        expect(details.scale.x).toBe(0.25);
        expect(details.material.vertexColors).toBe(true);
        expect(details.material.side).toBe(THREE.FrontSide);
        const color = details.geometry.getAttribute("color"),
          positions = details.geometry.getAttribute("position"),
          normal = details.geometry.getAttribute("normal"),
          index = details.geometry.index!;
        const palette = Array.from({ length: color.count }, (_, i) => [
          color.getX(i),
          color.getY(i),
          color.getZ(i),
        ]);
        expect(containsColor(palette, appearance.grain)).toBe(true);
        if (appearance.kind !== "slate")
          expect(containsColor(palette, appearance.highlight)).toBe(true);
        expect(index.count).toBeLessThanOrEqual(6 * 8 * 6);
        for (let i = 0; i < index.count; i += 3) {
          const a = new THREE.Vector3().fromBufferAttribute(
              positions,
              index.getX(i),
            ),
            b = new THREE.Vector3().fromBufferAttribute(
              positions,
              index.getX(i + 1),
            ),
            c = new THREE.Vector3().fromBufferAttribute(
              positions,
              index.getX(i + 2),
            );
          const face = new THREE.Vector3().fromBufferAttribute(
            normal,
            index.getX(i),
          );
          expect(b.sub(a).cross(c.sub(a)).dot(face)).toBeGreaterThan(0);
        }
        const identities = game.hand.children.map(
          (child: THREE.Object3D) => child.uuid,
        );
        game.updateHand(1 / 60);
        expect(
          game.hand.children.map((child: THREE.Object3D) => child.uuid),
        ).toEqual(identities);
        if ([100, 101, 104, 105].includes(id))
          signatures.add(
            JSON.stringify({
              base: base.material.color.toArray(),
              colors: palette,
            }),
          );
      }
      expect(signatures.size).toBe(4);
    } finally {
      game.handMaterials.forEach((material: THREE.Material) =>
        material.dispose(),
      );
      game.handGeometry.dispose();
      textures.mockRestore();
    }
  });

  it("releases owned mineral detail geometry through the existing hand material cleanup", () => {
    const textures = vi
      .spyOn(THREE.TextureLoader.prototype, "load")
      .mockImplementation(() => new THREE.Texture());
    const game = Object.assign(Object.create(Game.prototype), {
      hand: new THREE.Group(),
      handId: "",
      handMaterials: [],
      handGeometry: new THREE.BoxGeometry(1, 1, 1),
      handSwing: 0,
      paused: false,
      elapsed: 0,
      simulation: {
        held: { id: "gold_block", count: 1 },
        player: { velocity: { x: 0, z: 0 }, dead: false },
      },
    });
    try {
      game.updateHand(0);
      const oldDetails = game.hand.children[1] as THREE.Mesh;
      const oldDisposed = vi.spyOn(oldDetails.geometry, "dispose"),
        sharedDisposed = vi.spyOn(game.handGeometry, "dispose");
      game.simulation.held.id = "deepslate_diamond_ore";
      game.updateHand(0);
      expect(oldDisposed).toHaveBeenCalledTimes(1);
      expect(sharedDisposed).not.toHaveBeenCalled();
      const finalDetails = game.hand.children[1] as THREE.Mesh;
      const finalDisposed = vi.spyOn(finalDetails.geometry, "dispose");
      // This is the existing Game.dispose hand-material path, also used for switching.
      game.handMaterials.forEach((material: THREE.Material) =>
        material.dispose(),
      );
      expect(finalDisposed).toHaveBeenCalledTimes(1);
      game.handMaterials = [];
      expect(oldDisposed).toHaveBeenCalledTimes(1);
      expect(sharedDisposed).not.toHaveBeenCalled();
    } finally {
      game.handMaterials.forEach((material: THREE.Material) =>
        material.dispose(),
      );
      game.handGeometry.dispose();
      textures.mockRestore();
    }
  });
});
