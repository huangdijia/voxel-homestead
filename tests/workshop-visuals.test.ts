import { createElement, isValidElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BLOCKS, ITEMS } from "../src/game/registry";
import { RECIPES, recipeIngredients } from "../src/game/recipes";
import {
  collisionBoxes,
  selectionBoxes,
  progressionBlockParts,
  isOpaque,
  workshopBlockState,
  grindstoneBlockId,
} from "../src/engine/shapes";
import { buildChunk } from "../src/engine/mesher";
import { raycastVoxel } from "../src/engine/physics";
import { WorkshopWorkspace } from "../src/ui/Workshop";
import { EnchantingWorkspace } from "../src/ui/Enchanting";
import { ItemIcon, StackView } from "../src/ui/Icons";
import { Inventory } from "../src/ui/Inventory";
import { itemDescription } from "../src/ui/item-details";
import { Game } from "../src/game/Game";
import type {
  GameSnapshot,
  GameUIBridge,
  ItemStack,
  WorkshopView,
} from "../src/game/types";

const collect = (
  tree: ReactNode,
  type: string,
): Array<Record<string, unknown>> => {
  const found: Array<Record<string, unknown>> = [];
  const walk = (node: ReactNode): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (node.type === type) found.push(props);
      walk(props.children as ReactNode);
    }
  };
  walk(tree);
  return found;
};
const sword: ItemStack = {
  id: "diamond_sword",
  count: 1,
  durability: 1000,
  enchantments: { sharpness: 5 },
  customName: "晨光",
  repairCost: 3,
};
const offer: WorkshopView = {
  kind: "anvil",
  output: sword,
  available: true,
  name: "晨光",
  levelCost: 7,
  materialCost: 1,
  experienceMin: 0,
  experienceMax: 0,
};
const renderSlot = (_stack: unknown, index: number, label: string) =>
  createElement("span", { "data-slot": index }, label);

describe("workshop block definitions and production recipes", () => {
  it("exposes canonical items without leaking facing or attachment states into creative inventory", () => {
    const ids = Object.values(ITEMS)
      .filter((item) => item.block !== undefined && item.block >= 114)
      .map((item) => item.block);
    expect(ids).toEqual([114, 116, 118, 120, 132]);
    for (let id = 114; id <= 134; id++) expect(BLOCKS[id]).toBeDefined();
    expect(ITEMS.enchanted_book).toMatchObject({
      introducedVersion: 7,
      maxStack: 1,
    });
    for (const id of ids)
      expect(
        Object.values(ITEMS).find((item) => item.block === id)
          ?.introducedVersion,
      ).toBe(7);
    expect(BLOCKS[134]).toMatchObject({
      drop: "stone_slab",
      dropCount: [2, 2],
    });
  });
  it("requires iron blocks for the anvil and a real stone slab for the grindstone", () => {
    const recipe = (id: string) => RECIPES.find((entry) => entry.id === id)!;
    expect(recipeIngredients(recipe("anvil"))).toEqual({
      iron_block: 3,
      iron_ingot: 4,
    });
    expect(recipeIngredients(recipe("grindstone"))).toEqual({
      stick: 2,
      stone_slab: 1,
      planks: 2,
    });
    expect(recipe("stone_slab").output).toEqual({ id: "stone_slab", count: 6 });
    expect(recipeIngredients(recipe("stone_slab"))).toEqual({ stone: 3 });
    expect(recipe("grindstone").station).toBe("workbench");
  });
  it("retains all damage axes and twelve mounting states as stable numeric world data", () => {
    for (let damage = 0; damage < 3; damage++)
      for (let axis = 0; axis < 2; axis++)
        expect(workshopBlockState(114 + damage * 2 + axis)).toEqual({
          kind: "anvil",
          damage,
          axis,
        });
    for (const attachment of ["floor", "wall", "ceiling"] as const)
      for (let facing = 0; facing < 4; facing++) {
        const id = grindstoneBlockId(attachment, facing);
        expect(workshopBlockState(id)).toEqual({
          kind: "grindstone",
          attachment,
          facing,
        });
        expect(BLOCKS[id].drop).toBe("grindstone");
      }
    expect(grindstoneBlockId("floor", -1)).toBe(123);
    expect(workshopBlockState(113)).toBeNull();
    expect(workshopBlockState(132)).toBeNull();
  });
});

describe("workshop world geometry, collision and selection", () => {
  it("allows rays through the empty corners of a detailed anvil", () => {
    const world = {
      getBlock: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 0 ? 114 : 0,
    };
    expect(
      raycastVoxel(world, { x: 0.5, y: 0.5, z: -1 }, { x: 0, y: 0, z: 1 })?.id,
    ).toBe(114);
    expect(
      raycastVoxel(world, { x: 0.2, y: 0.5, z: -1 }, { x: 0, y: 0, z: 1 }),
    ).toBeNull();
    expect(collisionBoxes(114)).toHaveLength(4);
    expect(selectionBoxes(114)).toEqual(collisionBoxes(114));
    expect(collisionBoxes(115)[3]).toEqual([0, 0.625, 0.1875, 1, 1, 0.8125]);
  });
  it("preserves equal collision at all three anvil wear levels while showing different cracks", () => {
    expect(collisionBoxes(114)).toEqual(collisionBoxes(116));
    expect(collisionBoxes(116)).toEqual(collisionBoxes(118));
    expect(progressionBlockParts(114).length).toBeLessThan(
      progressionBlockParts(116).length,
    );
    expect(progressionBlockParts(116).length).toBeLessThan(
      progressionBlockParts(118).length,
    );
  });
  it("moves support feet to the actual floor, rear wall and ceiling for every facing", () => {
    const floor = collisionBoxes(120),
      northWall = collisionBoxes(124),
      eastWall = collisionBoxes(125),
      ceiling = collisionBoxes(128);
    expect(Math.min(...floor.map((box) => box[1]))).toBe(0);
    expect(Math.max(...floor.map((box) => box[4]))).toBe(0.875);
    expect(Math.max(...northWall.map((box) => box[5]))).toBe(1);
    expect(Math.min(...eastWall.map((box) => box[0]))).toBe(0);
    expect(Math.max(...ceiling.map((box) => box[4]))).toBe(1);
    expect(Math.min(...ceiling.map((box) => box[1]))).toBe(0.125);
    for (let id = 120; id < 132; id++) {
      expect(collisionBoxes(id)).toHaveLength(8);
      expect(selectionBoxes(id)).toEqual(collisionBoxes(id));
    }
  });
  it("respects bottom, top and double stone slab heights for raycasting and face occlusion", () => {
    expect(collisionBoxes(132)).toEqual([[0, 0, 0, 1, 0.5, 1]]);
    expect(collisionBoxes(133)).toEqual([[0, 0.5, 0, 1, 1, 1]]);
    expect(collisionBoxes(134)).toEqual([[0, 0, 0, 1, 1, 1]]);
    expect(isOpaque(132)).toBe(false);
    expect(isOpaque(133)).toBe(false);
    expect(isOpaque(134)).toBe(true);
  });
  it("emits bounded finite opaque meshes for all twenty-one new block states", () => {
    for (let id = 114; id <= 134; id++) {
      const parts = progressionBlockParts(id);
      expect(parts.length).toBeGreaterThan(0);
      expect(parts.length).toBeLessThanOrEqual(10);
      expect(progressionBlockParts(id)).toBe(parts);
      for (const { box } of parts) {
        expect(box.every((n) => n >= 0 && n <= 1)).toBe(true);
        expect(box[0]).toBeLessThan(box[3]);
        expect(box[1]).toBeLessThan(box[4]);
        expect(box[2]).toBeLessThan(box[5]);
      }
      const mesh = buildChunk({
        worldId: "workshop-visuals",
        seed: "workshop-visuals",
        generatorVersion: 6,
        key: "0,18,0",
        cx: 0,
        cy: 18,
        cz: 0,
        revision: 1,
        changes: [{ x: 15, y: 289, z: 1, id }],
      });
      expect(mesh.layers[0].indices.length).toBeGreaterThanOrEqual(36);
      expect(mesh.layers[0].indices.length).toBeLessThanOrEqual(360);
      for (const layer of mesh.layers)
        expect(
          [...layer.positions, ...layer.colors, ...layer.normals].every(
            Number.isFinite,
          ),
        ).toBe(true);
      expect(
        mesh.layers.slice(1).every((layer) => layer.indices.length === 0),
      ).toBe(true);
    }
  });
});

describe("workshop interface", () => {
  it("provides distinct original pixel icons for all six new items and shows book glint", () => {
    const ids = [
      "anvil",
      "chipped_anvil",
      "damaged_anvil",
      "grindstone",
      "stone_slab",
      "enchanted_book",
    ];
    const icons = ids.map((id) =>
      renderToStaticMarkup(createElement(ItemIcon, { id })),
    );
    expect(new Set(icons).size).toBe(6);
    for (const icon of icons) {
      expect(icon).toContain('viewBox="0 0 16 16"');
      expect(icon).toContain('shape-rendering="crispEdges"');
      expect(icon).not.toContain("item-cube");
    }
    expect(
      renderToStaticMarkup(
        createElement(StackView, {
          stack: {
            id: "enchanted_book",
            count: 1,
            enchantments: { fortune: 3 },
          },
        }),
      ),
    ).toContain("enchantment-glint");
    expect(
      renderToStaticMarkup(
        createElement(StackView, { stack: { id: "book", count: 1 } }),
      ),
    ).not.toContain("enchantment-glint");
  });
  it("preserves a custom name, original identity, enchantments and durability in the tooltip", () => {
    expect(itemDescription(sword)).toBe(
      "晨光\n钻石剑\n锋利 V\n耐久 1000 / 1561",
    );
    expect(itemDescription({ id: "stone", count: 1 })).toBe("石头");
  });
  it("shows the real name and prices and dispatches rename and normal/shift output commands", () => {
    const command = vi.fn();
    const tree = WorkshopWorkspace({
      kind: "anvil",
      view: offer,
      slots: [sword, { id: "diamond", count: 1 }],
      game: { command },
      renderSlot,
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('maxLength="50"');
    expect(html).toContain('value="晨光"');
    expect(html).toContain("消耗 7 级经验 · 右侧物品 × 1");
    expect(html).toContain("锋利 V");
    const input = collect(tree, "input")[0];
    (input.onChange as (e: unknown) => void)({ target: { value: "星河" } });
    const button = collect(tree, "button")[0];
    (button.onClick as (e: unknown) => void)({ shiftKey: false });
    (button.onClick as (e: unknown) => void)({ shiftKey: true });
    expect(command.mock.calls).toEqual([
      [{ type: "workshopName", name: "星河" }],
      [{ type: "takeWorkshopOutput", shift: false }],
      [{ type: "takeWorkshopOutput", shift: true }],
    ]);
  });
  it("disables unavailable output and shows too-expensive or station-invalid reasons without hiding preview metadata", () => {
    for (const reason of ["过于昂贵", "铁砧已不在原处"]) {
      const tree = WorkshopWorkspace({
        kind: "anvil",
        view: { ...offer, available: false, reason, levelCost: 40 },
        slots: [sword, null],
        game: { command: vi.fn() },
        renderSlot,
      });
      const html = renderToStaticMarkup(tree);
      expect(collect(tree, "button")[0].disabled).toBe(true);
      expect(html).toContain(reason);
      expect(html).toContain("晨光");
    }
  });
  it("keeps an empty anvil name disabled and escapes user names as text", () => {
    const empty = WorkshopWorkspace({
      kind: "anvil",
      view: null,
      slots: [null, null],
      game: { command: vi.fn() },
      renderSlot,
    });
    expect(collect(empty, "input")[0].disabled).toBe(true);
    expect(collect(empty, "button")[0].disabled).toBe(true);
    const name = '<img src="x" onerror="alert(1)">';
    const html = renderToStaticMarkup(
      createElement(WorkshopWorkspace, {
        kind: "anvil",
        view: { ...offer, name, output: { ...sword, customName: name } },
        slots: [sword, null],
        game: { command: vi.fn() },
        renderSlot,
      }),
    );
    expect(html).not.toContain('<img src="x"');
    expect(html).toContain("&lt;img");
  });
  it("shows grindstone XP ranges and no rename field, with zero XP clearly identified", () => {
    const view: WorkshopView = {
      ...offer,
      kind: "grindstone",
      levelCost: 0,
      experienceMin: 5,
      experienceMax: 10,
    };
    const tree = WorkshopWorkspace({
      kind: "grindstone",
      view,
      slots: [sword, null],
      game: { command: vi.fn() },
      renderSlot,
    });
    expect(collect(tree, "input")).toHaveLength(0);
    expect(renderToStaticMarkup(tree)).toContain("5–10 点经验");
    expect(
      renderToStaticMarkup(
        createElement(WorkshopWorkspace, {
          kind: "grindstone",
          view: { ...view, experienceMin: 0, experienceMax: 0 },
          slots: [sword, null],
          game: { command: vi.fn() },
          renderSlot,
        }),
      ),
    ).toContain("无经验返还");
  });
  it("explains table book input and preserves the visible book slot", () => {
    const html = renderToStaticMarkup(
      createElement(EnchantingWorkspace, {
        view: null,
        slots: [{ id: "book", count: 1 }, null],
        game: { command: vi.fn() },
        renderSlot,
      }),
    );
    expect(html).toContain("装备 / 书");
    expect(html).toContain("一本书");
  });
  it("shows named containers in the dialog title", () => {
    const game = {
      getCursor: () => null,
      getContainer: () => ({
        kind: "chest",
        slots: Array(27).fill(null),
        customName: "山谷藏书",
      }),
      getCraftSlots: () => [],
      getCraftOutput: () => null,
      getRecipes: () => [],
    } as unknown as GameUIBridge;
    const snapshot = {
      manifest: { mode: "survival" },
      player: { inventory: Array(36).fill(null), selected: 0, armor: {} },
    } as unknown as GameSnapshot;
    const html = renderToStaticMarkup(
      createElement(Inventory, {
        game,
        snapshot,
        overlay: "chest",
        close: () => {},
      }),
    );
    expect(html).toContain('aria-label="山谷藏书"');
    expect(html).toContain("<h2>山谷藏书</h2>");
  });
});

describe("workshop presentation bridge", () => {
  it("delegates commands and creative variants while blocking ordinary crafting at either workshop", () => {
    const simulation = {
      station: "anvil",
      setWorkshopName: vi.fn(),
      takeWorkshopOutput: vi.fn(),
      takeCraftOutput: vi.fn(),
      giveItem: vi.fn(),
      getWorkshop: () => offer,
    };
    const game = Object.assign(Object.create(Game.prototype), {
      simulation,
      publish: vi.fn(),
    }) as Game;
    game.command({ type: "workshopName", name: "新的名字" });
    game.command({ type: "takeWorkshopOutput", shift: true });
    game.giveItem("enchanted_book", "silk_touch");
    expect(simulation.setWorkshopName).toHaveBeenCalledWith("新的名字");
    expect(simulation.takeWorkshopOutput).toHaveBeenCalledWith(true);
    expect(simulation.giveItem).toHaveBeenCalledWith(
      "enchanted_book",
      "silk_touch",
    );
    expect(game.getWorkshop()).toBe(offer);
    for (const station of ["anvil", "grindstone"]) {
      simulation.station = station;
      game.takeCraftOutput();
      expect(game.getCraftOutput()).toBeNull();
      expect(game.getRecipes()).toEqual([]);
    }
    expect(simulation.takeCraftOutput).not.toHaveBeenCalled();
  });
});
