import "fake-indexeddb/auto";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNewSave, Simulation } from "../src/game/Simulation";
import {
  addItem,
  clickInventorySlot,
  compatibleStacks,
} from "../src/game/inventory";
import {
  ENCHANTMENTS,
  canOfferEnchantment,
  enchantability,
  enchantmentLevel,
  validateEnchantments,
} from "../src/game/enchantments";
import { applyEnchantment, getEnchantingOffers } from "../src/game/enchanting";
import { experienceForLevel } from "../src/game/experience";
import { ITEMS } from "../src/game/registry";
import {
  importWorld,
  loadMigrationBackup,
  loadWorld,
  saveWorld,
  validateSave,
} from "../src/game/storage";
import type { ItemStack, SaveData, Slot, WorldPort } from "../src/game/types";

const book = (enchantments = { efficiency: 3 }): ItemStack => ({
  id: "enchanted_book",
  count: 1,
  enchantments,
  customName: "矿工的手记",
  repairCost: 3,
});
function fresh(): SaveData {
  const save = createNewSave("工坊元数据", "workshop-metadata", "survival");
  save.manifest.version = 7;
  return save;
}
const emptyWorld: WorldPort = {
  getBlock: () => 0,
  setBlock: () => {},
  isReady: () => true,
  getSurface: () => 63,
  getChanges: () => [],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("enchanted books store enchantments without applying effects", () => {
  it("makes every implemented enchantment eligible for ordinary books, not enchanted books", () => {
    expect(ITEMS.enchanted_book).toMatchObject({
      maxStack: 1,
      introducedVersion: 7,
    });
    expect(enchantability("book")).toBe(1);
    expect(enchantability("enchanted_book")).toBe(0);
    for (const id of Object.keys(ENCHANTMENTS)) {
      expect(canOfferEnchantment("book", id)).toBe(true);
      expect(canOfferEnchantment("enchanted_book", id)).toBe(false);
    }
    expect(canOfferEnchantment("book", "unknown")).toBe(false);
  });
  it("keeps truthful deterministic book clues, consumes one book, and preserves its custom metadata", () => {
    const input: ItemStack = {
      id: "book",
      count: 1,
      customName: "  山林手册  ",
      repairCost: 7,
    };
    const original = structuredClone(input),
      points = experienceForLevel(30);
    const seen = new Set<string>();
    for (let seed = 0; seed < 128; seed++) {
      const offers = getEnchantingOffers(input, 15, seed, points, 3);
      expect(getEnchantingOffers(input, 15, seed, points, 3)).toEqual(offers);
      for (const offer of offers) {
        if (!offer.available) continue;
        const result = applyEnchantment(
          input,
          15,
          seed,
          points,
          3,
          offer.option,
        )!;
        expect(result.stack).toMatchObject({
          id: "enchanted_book",
          count: 1,
          customName: input.customName,
          repairCost: 7,
        });
        expect(result.lapisCost).toBe(offer.lapisCost);
        expect(result.points).toBeLessThan(points);
        expect(result.seed).not.toBe(seed);
        expect(
          validateEnchantments("enchanted_book", result.stack.enchantments),
        ).toBe(true);
        expect(result.stack.enchantments![offer.hint!.id]).toBe(
          offer.hint!.level,
        );
        Object.keys(result.stack.enchantments!).forEach((id) => seen.add(id));
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(ENCHANTMENTS).sort());
    expect(input).toEqual(original);
  });
  it("refuses book stacks and re-enchanting stored books without any cost or mutation", () => {
    for (const input of [
      { id: "book", count: 2 },
      book(),
      { id: "book", count: 1, enchantments: { efficiency: 1 } },
    ]) {
      const original = structuredClone(input);
      expect(
        applyEnchantment(input, 15, 10, experienceForLevel(30), 3, 2),
      ).toBeNull();
      expect(input).toEqual(original);
    }
  });
  it("allows compatible mixed-use book metadata but never activates it in either book kind", () => {
    const enchantments = {
      sharpness: 5,
      protection: 4,
      efficiency: 5,
      respiration: 3,
      unbreaking: 3,
      feather_falling: 4,
      fortune: 3,
    };
    expect(validateEnchantments("enchanted_book", enchantments)).toBe(true);
    expect(
      validateEnchantments("enchanted_book", { fortune: 3, silk_touch: 1 }),
    ).toBe(false);
    for (const id of ["book", "enchanted_book"])
      for (const enchantment of Object.keys(
        ENCHANTMENTS,
      ) as (keyof typeof ENCHANTMENTS)[])
        expect(
          enchantmentLevel({ id, count: 1, enchantments }, enchantment),
        ).toBe(0);
  });
});

describe("stack metadata follows inventory operations", () => {
  it("distinguishes names and prior-work costs, while missing and zero repair cost are equivalent", () => {
    const stone: ItemStack = {
      id: "stone",
      count: 1,
      customName: "门牌",
      repairCost: 3,
    };
    expect(compatibleStacks(stone, { ...stone, count: 20 })).toBe(true);
    expect(compatibleStacks(stone, { ...stone, customName: "路标" })).toBe(
      false,
    );
    expect(compatibleStacks(stone, { ...stone, customName: undefined })).toBe(
      false,
    );
    expect(compatibleStacks(stone, { ...stone, repairCost: 7 })).toBe(false);
    expect(
      compatibleStacks(
        { id: "stone", count: 1 },
        { id: "stone", count: 1, repairCost: 0 },
      ),
    ).toBe(true);
  });
  it("splits, moves, swaps and adds stacks with detached enchantment maps and intact metadata", () => {
    const original: ItemStack = {
      id: "stone",
      count: 10,
      customName: "微光路标",
      repairCost: 1,
      enchantments: { sharpness: 2 },
    };
    const slots: Slot[] = [structuredClone(original), null, book()];
    let cursor = clickInventorySlot(slots, 0, null, true)!;
    expect(cursor).toEqual({ ...original, count: 5 });
    expect(cursor.enchantments).not.toBe(slots[0]!.enchantments);
    cursor = clickInventorySlot(slots, 1, cursor, true)!;
    expect(slots[1]).toEqual({ ...original, count: 1 });
    expect(slots[1]!.enchantments).not.toBe(cursor.enchantments);
    const previous = structuredClone(slots[2]);
    cursor = clickInventorySlot(slots, 2, cursor, false)!;
    expect(cursor).toEqual(previous);
    expect(slots[2]).toEqual({ ...original, count: 4 });
    const destination: Slot[] = [null, null];
    expect(addItem(destination, cursor)).toBeNull();
    expect(destination[0]).toEqual(cursor);
    cursor.enchantments!.efficiency = 1;
    expect(destination[0]!.enchantments).toEqual({ efficiency: 3 });
    const remainder = addItem([], original)!;
    expect(remainder).toEqual(original);
    expect(remainder.enchantments).not.toBe(original.enchantments);
  });
  it("never merges incompatible names or work histories during pickup", () => {
    const slots: Slot[] = [
      { id: "stone", count: 60, customName: "甲", repairCost: 1 },
      null,
      null,
    ];
    addItem(slots, { id: "stone", count: 4, customName: "乙", repairCost: 1 });
    addItem(slots, { id: "stone", count: 2, customName: "甲", repairCost: 3 });
    expect(slots.map((s) => s!.count)).toEqual([60, 4, 2]);
  });
});

const locations: [string, (save: SaveData, value: ItemStack) => void][] = [
  [
    "inventory",
    (save, value) => {
      save.player.inventory[0] = value;
    },
  ],
  [
    "armor",
    (save, value) => {
      save.player.armor.head = {
        ...value,
        id: "iron_helmet",
        durability: ITEMS.iron_helmet.maxDurability,
      };
    },
  ],
  [
    "chest",
    (save, value) => {
      save.changes.push({ x: 0, y: 64, z: 0, id: 15 });
      save.containers["0,64,0"] = {
        kind: "chest",
        slots: [value, ...Array(26).fill(null)],
      };
    },
  ],
  [
    "furnace",
    (save, value) => {
      save.changes.push({ x: 0, y: 64, z: 0, id: 14 });
      save.containers["0,64,0"] = {
        kind: "furnace",
        slots: [value, null, null],
        burn: 0,
        burnTotal: 0,
        progress: 0,
      };
    },
  ],
  [
    "drop",
    (save, value) => {
      save.drops.push({
        id: "book-drop",
        stack: value,
        position: { x: 0.5, y: 64, z: 0.5 },
        age: 0,
      });
    },
  ],
];
describe("version seven storage metadata", () => {
  it("preserves separate in-world anvil distances and removed-block cargo through validation", () => {
    const save = fresh();
    save.changes.push(
      { x: 0, y: 64, z: 0, id: 0 },
      { x: 2, y: 64, z: 0, id: 119 },
    );
    save.natural!.falling = [{ x: 0, y: 64, z: 0, id: 114, distance: 0 }];
    save.natural!.anvilFalls = [{ x: 2, y: 64, z: 0, distance: 384 }];
    const detached = validateSave(save);
    expect(detached.natural).toEqual(save.natural);
    expect(detached.natural!.anvilFalls).not.toBe(save.natural!.anvilFalls);
    save.natural!.anvilFalls[0].distance = 1;
    expect(detached.natural!.anvilFalls![0].distance).toBe(384);
  });
  it("rejects invalid anvil distances, missing voxels, duplicate records and legacy fall metadata", () => {
    const mutations: ((save: SaveData) => void)[] = [
      (s) => {
        s.natural!.anvilFalls = [{ x: 2, y: 64, z: 0, distance: 0 }];
      },
      (s) => {
        s.natural!.anvilFalls = [{ x: 2, y: 64, z: 0, distance: 385 }];
      },
      (s) => {
        s.natural!.anvilFalls = [{ x: 2, y: 64, z: 0, distance: 1.5 }];
      },
      (s) => {
        s.natural!.anvilFalls = [{ x: 2, y: 64, z: 1, distance: 1 }];
      },
      (s) => {
        s.natural!.anvilFalls = Array(2).fill({
          x: 2,
          y: 64,
          z: 0,
          distance: 1,
        });
      },
      (s) => {
        s.natural!.anvilFalls = [{ x: 2, y: 64, z: 0, distance: 1 }];
        s.natural!.falling = [{ x: 2, y: 64, z: 0, id: 114 }];
      },
      (s) => {
        s.natural!.falling = [{ x: 0, y: 64, z: 0, id: 4, distance: 1 }];
      },
      (s) => {
        s.natural!.falling = [{ x: 0, y: 64, z: 0, id: 114, distance: -1 }];
      },
      (s) => {
        s.natural!.falling = [{ x: 0, y: 64, z: 0, id: 114, distance: 385 }];
      },
      (s) => {
        s.natural!.falling = [{ x: 0, y: 64, z: 0, id: 114, distance: 1.5 }];
      },
      (s) => {
        s.natural!.falling = [{ x: 2, y: 64, z: 0, id: 115, distance: 1 }];
      },
      (s) => {
        s.changes.pop();
        s.manifest.version = 6;
        s.manifest.generatorVersion = 6;
        s.natural!.falling = [{ x: 0, y: 64, z: 0, id: 114 }];
      },
      (s) => {
        s.changes.pop();
        s.manifest.version = 6;
        s.manifest.generatorVersion = 6;
        s.natural!.anvilFalls = [];
      },
    ];
    for (const mutate of mutations) {
      const save = fresh();
      save.changes.push(
        { x: 0, y: 64, z: 0, id: 0 },
        { x: 2, y: 64, z: 0, id: 115 },
      );
      mutate(save);
      expect(() => validateSave(save)).toThrow(/存档校验失败/);
    }
  });
  it.each(["chest", "furnace"] as const)(
    "round trips placed %s names and rejects invalid or legacy names",
    (kind) => {
      const save = fresh();
      locations.find(([name]) => name === kind)![1](save, book());
      const container = save.containers["0,64,0"];
      container.customName = "山里的工坊";
      expect(validateSave(save).containers["0,64,0"].customName).toBe(
        "山里的工坊",
      );
      for (const name of ["", " ", "a".repeat(51), "a\n", "a\u0085", "a§"]) {
        container.customName = name;
        expect(() => validateSave(save)).toThrow();
      }
      container.customName = "旧版名称";
      container.slots.fill(null);
      save.manifest.version = 6;
      save.manifest.generatorVersion = 6;
      expect(() => validateSave(save)).toThrow(/自定义名称/);
    },
  );
  it.each(locations)(
    "validates and detaches metadata in %s",
    (_name, insert) => {
      const save = fresh();
      insert(save, book());
      const detached = validateSave(save);
      expect(detached).toEqual(save);
      expect(detached).not.toBe(save);
      // All inserted stacks share a known property, even when an armor slot changes their item type.
      expect(JSON.stringify(detached)).toContain("矿工的手记");
      const before = structuredClone(detached);
      const value =
        save.player.inventory[0] ??
        save.player.armor.head ??
        Object.values(save.containers)[0]?.slots[0] ??
        save.drops[0]?.stack;
      value!.enchantments!.efficiency = 1;
      expect(detached).toEqual(before);
    },
  );
  it.each(locations)("rejects invalid metadata in %s", (_name, insert) => {
    for (const metadata of [
      { customName: "" },
      { customName: "   " },
      { customName: "a".repeat(51) },
      { customName: "a\n" },
      { customName: "a\u0085" },
      { customName: "a§" },
      { repairCost: -1 },
      { repairCost: 0.5 },
      { repairCost: 2147483648 },
      { repairCost: NaN },
      { enchantments: { mending: 1 } },
      { enchantments: {} },
      { enchantments: { efficiency: 6 } },
      { enchantments: { fortune: 3, silk_touch: 1 } },
    ]) {
      const save = fresh();
      insert(save, { ...book(), ...metadata } as ItemStack);
      expect(() => validateSave(save)).toThrow(/存档校验失败/);
    }
  });
  it("retains UTF-16 name bounds and maximum integer work cost", () => {
    const save = fresh();
    save.player.inventory[0] = {
      ...book(),
      customName: "🌲".repeat(25),
      repairCost: 2147483647,
    };
    expect(validateSave(save).player.inventory[0]).toEqual(
      save.player.inventory[0],
    );
    save.player.inventory[0].customName += "a";
    expect(() => validateSave(save)).toThrow();
  });
  it("preserves creative enchantments on arbitrary items in v7 without granting incompatible active effects", () => {
    const save = fresh();
    save.player.inventory[0] = {
      id: "stone",
      count: 64,
      enchantments: { sharpness: 5 },
    };
    save.player.inventory[1] = {
      id: "book",
      count: 1,
      enchantments: { protection: 4 },
    };
    expect(validateSave(save)).toEqual(save);
    expect(enchantmentLevel(save.player.inventory[0], "sharpness")).toBe(0);
    save.manifest.version = 6;
    save.manifest.generatorVersion = 6;
    expect(() => validateSave(save)).toThrow();
  });
  it("rejects empty enchanted books and schema 7 items or blocks in older schemas", () => {
    for (const change of [
      (s: SaveData) => {
        s.player.inventory[0] = { id: "enchanted_book", count: 1 };
      },
      (s: SaveData) => {
        s.manifest.version = 6;
        s.manifest.generatorVersion = 6;
        s.player.inventory[0] = book();
      },
      (s: SaveData) => {
        s.manifest.version = 6;
        s.manifest.generatorVersion = 6;
        s.player.inventory[0] = { id: "anvil", count: 1 };
      },
      (s: SaveData) => {
        s.manifest.version = 6;
        s.manifest.generatorVersion = 6;
        s.changes.push({ x: 0, y: 64, z: 0, id: 114 });
      },
      (s: SaveData) => {
        s.manifest.version = 6;
        s.manifest.generatorVersion = 6;
        s.player.inventory[0] = {
          id: "stone",
          count: 1,
          customName: "旧版名称",
        };
      },
      (s: SaveData) => {
        s.manifest.version = 6;
        s.manifest.generatorVersion = 6;
        s.player.inventory[0] = { id: "stone", count: 1, repairCost: 0 };
      },
    ]) {
      const save = fresh();
      change(save);
      expect(() => validateSave(save)).toThrow();
    }
    const save = fresh();
    save.manifest.generatorVersion = 8 as never;
    expect(() => validateSave(save)).toThrow(/生成器版本/);
  });
  it("backs up an actual v6 checkpoint before the v7 write and preserves generator 6", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const old = fresh();
    old.manifest.version = 6;
    old.manifest.generatorVersion = 6;
    old.player.inventory[0] = {
      id: "iron_pickaxe",
      count: 1,
      durability: 52,
      enchantments: { efficiency: 3 },
    };
    old.progression!.points = 37.5;
    await saveWorld(old);
    const current = new Simulation(
      emptyWorld,
      (await loadWorld(old.manifest.id))!,
    ).snapshot();
    expect(current.manifest).toMatchObject({ version: 7, generatorVersion: 6 });
    current.player.inventory[1] = book();
    await saveWorld(current);
    expect(await loadMigrationBackup(old.manifest.id, 6)).toEqual(old);
    expect(await loadWorld(old.manifest.id)).toEqual(current);
    current.player.inventory[1]!.customName = "第二次存档";
    await saveWorld(current);
    expect(await loadMigrationBackup(old.manifest.id, 6)).toEqual(old);
    const imported = await importWorld(JSON.stringify(current));
    expect(imported.id).not.toBe(old.manifest.id);
    expect((await loadWorld(imported.id))!.player).toEqual(current.player);
  });
  it("keeps the original v6 checkpoint and no partial backup when its v7 transaction aborts", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const old = fresh();
    old.manifest.version = 6;
    old.manifest.generatorVersion = 6;
    await saveWorld(old);
    const next = structuredClone(old);
    next.manifest.version = 7;
    next.player.inventory[0] = book();
    const put = IDBObjectStore.prototype.put;
    const interception = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (this: IDBObjectStore, value, key) {
        const request = put.call(this, value, key);
        if (this.name === "worlds") this.transaction.abort();
        return request;
      });
    await expect(saveWorld(next)).rejects.toThrow();
    interception.mockRestore();
    expect(await loadWorld(old.manifest.id)).toEqual(old);
    expect(await loadMigrationBackup(old.manifest.id, 6)).toBeNull();
    await saveWorld(next);
    expect(await loadMigrationBackup(old.manifest.id, 6)).toEqual(old);
  });
});
