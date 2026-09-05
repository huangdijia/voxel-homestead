import * as THREE from "three";
import { createElement, isValidElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemIcon, StackView } from "../src/ui/Icons";
import { ExperienceBar, EnchantingWorkspace } from "../src/ui/Enchanting";
import { itemDescription } from "../src/ui/item-details";
import {
  collisionBoxes,
  selectionBoxes,
  isOpaque,
  progressionBlockParts,
} from "../src/engine/shapes";
import { buildChunk } from "../src/engine/mesher";
import { intersectsWorld, raycastVoxel } from "../src/engine/physics";
import { EntityRenderer } from "../src/game/EntityRenderer";
import { Game } from "../src/game/Game";
import type { EnchantingView, EntityState, ItemStack } from "../src/game/types";

afterEach(() => vi.restoreAllMocks());
const mesh = (id: number, neighbor = false) =>
  buildChunk({
    worldId: "enchanting-shapes",
    seed: "enchanting-shapes",
    generatorVersion: 5,
    key: "0,18,0",
    cx: 0,
    cy: 18,
    cz: 0,
    revision: 1,
    changes: [
      { x: 15, y: 289, z: 1, id },
      ...(neighbor ? [{ x: 16, y: 289, z: 1, id: 3 }] : []),
    ],
  });

describe("enchanting-era block models", () => {
  it("makes cane selectable without collision and keeps the table collision at three quarters height", () => {
    expect(collisionBoxes(111)).toEqual([]);
    expect(selectionBoxes(111)[0][4]).toBe(1);
    expect(isOpaque(111)).toBe(false);
    const world = {
      getBlock: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 0 ? 111 : 0,
    };
    expect(intersectsWorld(world, { x: 0.5, y: 0, z: 0.5 })).toBe(false);
    expect(
      raycastVoxel(world, { x: 0.5, y: 0.5, z: -1 }, { x: 0, y: 0, z: 1 })?.id,
    ).toBe(111);
    expect(collisionBoxes(112)).toEqual([[0, 0, 0, 1, 0.75, 1]]);
    expect(isOpaque(112)).toBe(false);
    expect(collisionBoxes(113)).toEqual([[0, 0, 0, 1, 1, 1]]);
    expect(isOpaque(113)).toBe(true);
  });

  it("renders a segmented plant, a raised open book and colored book spines with bounded geometry", () => {
    const cane = mesh(111),
      table = mesh(112),
      shelf = mesh(113);
    expect(cane.layers[1].indices.length).toBeGreaterThan(72);
    expect(cane.layers[0].indices.length).toBe(0);
    expect(table.layers[0].indices.length).toBeGreaterThan(36);
    const parts = progressionBlockParts(112);
    expect(parts.some((p) => p.box[1] > 0.75 && p.tint[0] > 0.9)).toBe(true);
    expect(Math.max(...parts.map((p) => p.box[4]))).toBeLessThanOrEqual(1);
    const colors = new Set(
      progressionBlockParts(113).map((p) => p.tint.join(",")),
    );
    expect(colors.size).toBeGreaterThanOrEqual(6);
    expect(shelf.layers[0].indices.length).toBeLessThanOrEqual(2500);
    expect(progressionBlockParts(113)).toBe(progressionBlockParts(113));
    for (const result of [cane, table, shelf])
      for (const layer of result.layers)
        expect(
          [...layer.positions, ...layer.colors].every(Number.isFinite),
        ).toBe(true);
  });

  it("omits the entire decorated shelf side against an opaque adjacent section", () => {
    const open = mesh(113).layers[0],
      closed = mesh(113, true).layers[0];
    expect(closed.indices.length).toBeLessThan(open.indices.length - 500);
    expect(
      Math.max(...[...closed.positions].filter((_, i) => i % 3 === 0)),
    ).toBeLessThanOrEqual(16);
  });
});

describe("experience and enchanting interface", () => {
  const enchanted: ItemStack = {
    id: "diamond_pickaxe",
    count: 1,
    durability: 1500,
    enchantments: { efficiency: 4, unbreaking: 3 },
  };
  it("gives all eight new objects distinct original pixel icons", () => {
    const ids = [
      "sugar_cane",
      "paper",
      "leather",
      "book",
      "enchanting_table",
      "bookshelf",
      "raw_beef",
      "cooked_beef",
    ];
    const icons = ids.map((id) =>
      renderToStaticMarkup(createElement(ItemIcon, { id })),
    );
    for (const icon of icons) {
      expect(icon).toContain('viewBox="0 0 16 16"');
      expect(icon).toContain('shape-rendering="crispEdges"');
      expect(icon).not.toContain("item-cube");
    }
    expect(new Set(icons).size).toBe(ids.length);
  });

  it("shows real enchantment names, Roman levels and durability without changing plain items", () => {
    const description = itemDescription(enchanted);
    expect(description).toContain("钻石镐");
    expect(description).toContain("效率 IV");
    expect(description).toContain("耐久 III");
    expect(description).toContain("耐久 1500 / 1561");
    expect(
      renderToStaticMarkup(createElement(StackView, { stack: enchanted })),
    ).toContain('class="enchantment-glint" aria-hidden="true"');
    expect(
      renderToStaticMarkup(
        createElement(StackView, {
          stack: { id: "diamond_pickaxe", count: 1 },
        }),
      ),
    ).not.toContain("enchantment-glint");
  });

  it("displays the current level and fractional experience bar from points", () => {
    const html = renderToStaticMarkup(
      createElement(ExperienceBar, { points: 1451 }),
    );
    expect(html).toContain('aria-label="经验等级 30"');
    expect(html).toContain('aria-valuemax="112"');
    expect(html).toContain('aria-valuenow="56"');
    expect(html).toContain("width:50%");
    expect(html).toContain("还需 56 经验");
  });

  it("separates threshold from costs, reports blocked choices and sends the selected option", () => {
    const view: EnchantingView = {
      bookshelves: 15,
      level: 30,
      progress: 0.5,
      offers: [
        {
          option: 0,
          requiredLevel: 6,
          levelCost: 1,
          lapisCost: 1,
          hint: null,
          available: false,
          reason: "装备不能接受此项附魔",
        },
        {
          option: 1,
          requiredLevel: 17,
          levelCost: 2,
          lapisCost: 2,
          hint: { id: "efficiency", level: 2 },
          available: true,
        },
        {
          option: 2,
          requiredLevel: 30,
          levelCost: 3,
          lapisCost: 3,
          hint: { id: "fortune", level: 3 },
          available: true,
        },
      ],
    };
    const command = vi.fn(),
      renderSlot = vi.fn((_stack, index, label) =>
        createElement("span", { "data-slot": index }, label),
      );
    const tree = EnchantingWorkspace({
      view,
      slots: [enchanted, { id: "lapis_lazuli", count: 3 }],
      game: { command },
      renderSlot,
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("需达到 <b>30 级</b>");
    expect(html).toContain("实际消耗 3 级经验 · 3 个青金石");
    expect(html).toContain("时运 III");
    expect(html).toContain("装备不能接受此项附魔");
    expect(html).not.toContain("铁砧");
    const buttons: Array<Record<string, unknown>> = [];
    const visit = (node: ReactNode): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!isValidElement<{ children?: ReactNode }>(node)) return;
      if (node.type === "button")
        buttons.push(node.props as Record<string, unknown>);
      visit(node.props.children);
    };
    visit(tree);
    expect(buttons).toHaveLength(3);
    expect(buttons[0].disabled).toBe(true);
    (buttons[2].onClick as () => void)();
    expect(command).toHaveBeenCalledExactlyOnceWith({
      type: "enchant",
      option: 2,
    });
    expect(renderSlot.mock.calls.map((call) => call[1])).toEqual([0, 1]);
  });

  it("shows creative offers as free at level zero while retaining strength references", () => {
    const view: EnchantingView = {
      bookshelves: 15,
      level: 0,
      progress: 0,
      offers: ([0, 1, 2] as const).map((option) => ({
        option,
        requiredLevel: [4, 15, 30][option],
        levelCost: 0,
        lapisCost: 0,
        hint: { id: "efficiency", level: option + 1 },
        available: true,
      })),
    };
    const html = renderToStaticMarkup(
      createElement(EnchantingWorkspace, {
        view,
        slots: [{ id: "diamond_pickaxe", count: 1 }, null],
        game: { command: vi.fn() },
        renderSlot: (_stack, index) =>
          createElement("span", { "data-slot": index }),
      }),
    );
    expect(html).toContain("放入装备即可附魔，无需经验或青金石");
    expect(html).toContain("青金石（可留空）");
    expect(html).toContain("强度参考 <b>30 级</b>");
    expect(html).toContain("创造模式 · 不消耗经验或青金石");
    expect(html).toContain("无需等级");
    expect(html).not.toContain("需达到");
    expect(html).not.toContain("实际消耗");
    expect(html).not.toContain("disabled=");
  });

  it("delegates enchanting through the real bridge and keeps orb arrays out of HUD snapshots", () => {
    const enchant = vi.fn(),
      takeCraftOutput = vi.fn();
    const progression = {
      points: 1451,
      enchantmentSeed: 42,
      orbs: [{ id: "orb", position: { x: 0, y: 0, z: 0 }, value: 3, age: 0 }],
    };
    const game = Object.assign(Object.create(Game.prototype), {
      simulation: {
        enchant,
        progression,
        station: "enchanting",
        takeCraftOutput,
        getEnchanting: () => ({ level: 30, offers: [] }),
        craftSlots: [enchanted, { id: "lapis_lazuli", count: 3 }],
        manifest: {},
        player: {},
        target: () => null,
        time: 0,
        mining: 0,
      },
      world: { stats: { chunks: 1 }, ready: true },
      publish: vi.fn(),
      elapsed: 0,
      messageExpiry: 0,
      message: "",
      fps: 60,
    });
    game.command({ type: "enchant", option: 2 });
    expect(enchant).toHaveBeenCalledExactlyOnceWith(2);
    expect(game.getEnchanting().level).toBe(30);
    expect(game.getCraftSlots()).toHaveLength(2);
    expect(game.getCraftOutput()).toBeNull();
    expect(game.getRecipes()).toEqual([]);
    game.takeCraftOutput();
    expect(takeCraftOutput).not.toHaveBeenCalled();
    expect(game.buildSnapshot().progression).toEqual({ points: 1451 });
  });
});

describe("cow and experience orb renderer", () => {
  const setup = () => {
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(
      () => new THREE.Texture(),
    );
    const scene = new THREE.Scene(),
      renderer = new EntityRenderer(scene);
    return { scene, renderer };
  };
  it("renders a spotted four-legged cow with horns, muzzle, babies and courtship", () => {
    const { scene, renderer } = setup();
    const cow: EntityState = {
      id: "cow",
      kind: "cow",
      position: { x: 0, y: 70, z: 0 },
      health: 10,
      yaw: 0,
      timer: 0,
      age: -100,
      love: 20,
    };
    try {
      renderer.update([cow], [], cow.position, 0);
      const model = scene.getObjectByName("mob:cow")!;
      expect(model.scale.x).toBe(0.5);
      expect(model.getObjectByName("cow-horn")).toBeDefined();
      expect(model.getObjectByName("cow-muzzle")).toBeDefined();
      expect(model.getObjectByName("cow-patch")).toBeDefined();
      expect(model.getObjectByName("love-marker")?.visible).toBe(true);
      const identities: string[] = [];
      model.traverse((node) => identities.push(node.uuid));
      renderer.update([{ ...cow, age: 0, love: 0 }], [], cow.position, 1);
      expect(model.scale.x).toBe(1);
      expect(model.getObjectByName("love-marker")?.visible).toBe(false);
      const after: string[] = [];
      model.traverse((node) => after.push(node.uuid));
      expect(after).toEqual(identities);
    } finally {
      renderer.dispose();
    }
  });

  it("reuses shared glowing orb geometry/materials and releases removed orbs without altering state", () => {
    const { scene, renderer } = setup();
    const orb = {
      id: "test-orb",
      value: 7,
      age: 0.4,
      position: { x: 0, y: 70, z: 0 },
    };
    const before = structuredClone(orb);
    renderer.update([], [], orb.position, 0, [orb]);
    const group = scene.getObjectByName("xp:test-orb")!;
    const core = group.children[0] as THREE.Mesh;
    const geometry = vi.spyOn(core.geometry, "dispose"),
      material = vi.spyOn(core.material as THREE.Material, "dispose");
    expect(core.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    for (let i = 1; i <= 20; i++)
      renderer.update([], [], orb.position, i, [orb]);
    expect(scene.getObjectByName("xp:test-orb")).toBe(group);
    expect(orb).toEqual(before);
    renderer.update([], [], orb.position, 21, []);
    expect(scene.getObjectByName("xp:test-orb")).toBeUndefined();
    expect(geometry).not.toHaveBeenCalled();
    expect(material).not.toHaveBeenCalled();
    renderer.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
  });

  it("uses the same new block forms in the hand and adds glint only to enchanted equipment", () => {
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(
      () => new THREE.Texture(),
    );
    const game = Object.assign(Object.create(Game.prototype), {
      hand: new THREE.Group(),
      handId: "",
      handMaterials: [],
      handGeometry: new THREE.BoxGeometry(1, 1, 1),
      handSwing: 0,
      paused: false,
      elapsed: 1,
      simulation: {
        held: { id: "enchanting_table", count: 1 },
        player: { velocity: { x: 0, z: 0 }, dead: false },
      },
    });
    try {
      game.updateHand(0);
      expect(game.hand.children).toHaveLength(
        progressionBlockParts(112).length,
      );
      game.simulation.held = { id: "bookshelf", count: 1 };
      game.updateHand(0);
      expect(game.hand.children).toHaveLength(
        progressionBlockParts(113).length,
      );
      game.simulation.held = {
        id: "diamond_pickaxe",
        count: 1,
        enchantments: { efficiency: 3 },
      };
      game.updateHand(0);
      expect(game.hand.rotation.x).toBe(0);
      expect(game.hand.rotation.y).toBe(0);
      expect(
        game.handMaterials.every(
          (m: THREE.MeshLambertMaterial) =>
            m.emissiveIntensity > 0 && m.emissive.getHex() !== 0,
        ),
      ).toBe(true);
      game.simulation.held = { id: "diamond_pickaxe", count: 1 };
      game.updateHand(0);
      expect(
        game.handMaterials.every(
          (m: THREE.MeshLambertMaterial) => m.emissiveIntensity === 0,
        ),
      ).toBe(true);
    } finally {
      game.handMaterials.forEach((m: THREE.Material) => m.dispose());
      game.handGeometry.dispose();
    }
  });
});
