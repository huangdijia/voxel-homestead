import { describe, expect, it } from "vitest";
import {
  applyEnchantment,
  BOOKSHELF_OFFSETS,
  countBookshelves,
  getEnchantingOffers,
} from "../src/game/enchanting";
import { validateEnchantments } from "../src/game/enchantments";
import { experienceForLevel, experienceStatus } from "../src/game/experience";
import { WORLD_MIN_Y, WORLD_MAX_Y } from "../src/engine/world-height";
import type {
  BlockChange,
  ItemStack,
  Vec3,
  WorldPort,
} from "../src/game/types";

class Library implements WorldPort {
  blocks = new Map<string, number>();
  unavailable = new Set<string>();
  reads = 0;
  isReady(x: number, z: number, y?: number) {
    if (y === undefined) throw new Error("missing vertical readiness check");
    return (
      y >= WORLD_MIN_Y &&
      y <= WORLD_MAX_Y &&
      !this.unavailable.has(`${x},${y},${z}`)
    );
  }
  getBlock(x: number, y: number, z: number) {
    if (!this.isReady(x, z, y)) throw new Error("read unloaded block");
    this.reads++;
    return this.blocks.get(`${x},${y},${z}`) ?? 0;
  }
  setBlock(x: number, y: number, z: number, id: number) {
    this.blocks.set(`${x},${y},${z}`, id);
  }
  getSurface() {
    return 0;
  }
  getChanges(): BlockChange[] {
    return [];
  }
}
const pick: ItemStack = { id: "diamond_pickaxe", count: 1, durability: 1111 };
const highXP = experienceForLevel(50);
describe("bookshelf power geometry", () => {
  it("uses 32 unique two-layer positions, capped at 15, with bounded reads", () => {
    const world = new Library(),
      at = { x: 0, y: 100, z: 0 };
    world.setBlock(0, 100, 0, 112);
    expect(BOOKSHELF_OFFSETS).toHaveLength(32);
    expect(new Set(BOOKSHELF_OFFSETS.map((p) => JSON.stringify(p))).size).toBe(
      32,
    );
    for (const p of BOOKSHELF_OFFSETS)
      world.setBlock(p.x, p.y + at.y, p.z, 113);
    expect(countBookshelves(world, at)).toBe(15);
    expect(world.reads).toBeLessThanOrEqual(65);
  });
  it("handles negative coordinates and true diagonals without requiring both adjacent side gaps", () => {
    const world = new Library(),
      at = { x: -16, y: -32, z: -16 };
    world.setBlock(at.x, at.y, at.z, 112);
    world.setBlock(-18, -32, -18, 113);
    world.setBlock(-17, -32, -16, 3);
    world.setBlock(-16, -32, -17, 3);
    expect(countBookshelves(world, at)).toBe(1);
    world.setBlock(-17, -32, -17, 16);
    expect(countBookshelves(world, at)).toBe(0);
  });
  it("halves non-corner offsets toward zero, and checks gaps at each shelf height", () => {
    const world = new Library(),
      at = { x: 0, y: 0, z: 0 };
    world.setBlock(0, 0, 0, 112);
    world.setBlock(-2, 0, -1, 113);
    world.setBlock(-2, 1, -1, 113);
    world.setBlock(-1, 0, 0, 16);
    world.setBlock(-1, 1, -1, 3);
    expect(countBookshelves(world, at)).toBe(1);
    world.setBlock(-1, 1, 0, 3);
    expect(countBookshelves(world, at)).toBe(0);
  });
  it("allows Java replaceable short grass and fluids, while torches and crops obstruct", () => {
    const world = new Library(),
      at = { x: 0, y: 0, z: 0 };
    world.setBlock(0, 0, 0, 112);
    world.setBlock(2, 0, 0, 113);
    for (const id of [0, 58, 6, 68, 75, 76, 79, 80]) {
      world.setBlock(1, 0, 0, id);
      expect(countBookshelves(world, at)).toBe(1);
    }
    for (const id of [16, 30, 83]) {
      world.setBlock(1, 0, 0, id);
      expect(countBookshelves(world, at)).toBe(0);
    }
  });
  it("never counts or reads unloaded shelves, unloaded gaps, or upper-world overflow", () => {
    const world = new Library(),
      at: Vec3 = { x: 15, y: 319, z: 0 };
    world.setBlock(15, 319, 0, 112);
    world.setBlock(17, 319, 0, 113);
    expect(countBookshelves(world, at)).toBe(1);
    world.unavailable.add("17,319,0");
    expect(countBookshelves(world, at)).toBe(0);
    world.unavailable.clear();
    world.unavailable.add("16,319,0");
    expect(countBookshelves(world, at)).toBe(0);
    world.unavailable.clear();
    world.unavailable.add("15,319,0");
    expect(countBookshelves(world, at)).toBe(0);
  });
  it("requires the real table and rejects non-integer/out-of-height positions", () => {
    const world = new Library();
    expect(countBookshelves(world, { x: 0, y: 0, z: 0 })).toBe(0);
    expect(countBookshelves(world, { x: 0, y: 320, z: 0 })).toBe(0);
    expect(countBookshelves(world, { x: 0.5, y: 0, z: 0 })).toBe(0);
  });
});
describe("deterministic enchantment table offers", () => {
  it("provides a reproducible seed-zero fixture with one truthful hint per offer", () => {
    const offers = getEnchantingOffers(pick, 15, 0, highXP, 64);
    expect(offers).toMatchInlineSnapshot(`
      [
        {
          "available": true,
          "hint": {
            "id": "unbreaking",
            "level": 1,
          },
          "lapisCost": 1,
          "levelCost": 1,
          "option": 0,
          "requiredLevel": 8,
        },
        {
          "available": true,
          "hint": {
            "id": "silk_touch",
            "level": 1,
          },
          "lapisCost": 2,
          "levelCost": 2,
          "option": 1,
          "requiredLevel": 13,
        },
        {
          "available": true,
          "hint": {
            "id": "efficiency",
            "level": 4,
          },
          "lapisCost": 3,
          "levelCost": 3,
          "option": 2,
          "requiredLevel": 30,
        },
      ]
    `);
    for (const offer of offers) {
      const result = applyEnchantment(pick, 15, 0, highXP, 64, offer.option)!;
      expect(result.stack.enchantments?.[offer.hint!.id]).toBe(
        offer.hint!.level,
      );
      expect(Object.keys(offer)).not.toContain("enchantments");
    }
  });
  it("opening, closing, serializing, and trying another item cannot advance the quote seed", () => {
    const first = getEnchantingOffers(pick, 15, 12345, highXP, 64);
    getEnchantingOffers({ id: "gold_helmet", count: 1 }, 15, 12345, highXP, 64);
    expect(
      getEnchantingOffers(
        JSON.parse(JSON.stringify(pick)),
        15,
        12345,
        highXP,
        64,
      ),
    ).toEqual(first);
    const a = applyEnchantment(pick, 15, 12345, highXP, 64, 2)!;
    const b = applyEnchantment(pick, 15, 12345, highXP, 64, 2)!;
    expect(a).toEqual(b);
    expect(a.seed).not.toBe(12345);
    expect(a.seed).toBeGreaterThanOrEqual(0);
    expect(a.seed).toBeLessThanOrEqual(0xffff_ffff);
  });
  it("separates the level-30 gate from 3 levels and 3 lapis actually spent", () => {
    const before = experienceForLevel(30) + 56;
    const offer = getEnchantingOffers(pick, 15, 42, before, 3)[2]!;
    expect(offer).toMatchObject({
      requiredLevel: 30,
      levelCost: 3,
      lapisCost: 3,
      available: true,
    });
    const result = applyEnchantment(pick, 15, 42, before, 3, 2)!;
    expect(experienceStatus(result.points)).toMatchObject({
      level: 27,
      progress: 0.5,
    });
    expect(result.lapisCost).toBe(3);
    expect(result.stack).toMatchObject({
      id: pick.id,
      count: 1,
      durability: 1111,
    });
    expect(pick.enchantments).toBeUndefined();
    expect(
      applyEnchantment(pick, 15, 42, experienceForLevel(29), 3, 2),
    ).toBeNull();
    expect(applyEnchantment(pick, 15, 42, before, 2, 2)).toBeNull();
  });
  it("costs one or two levels/lapis for the first two options", () => {
    for (const option of [0, 1]) {
      const result = applyEnchantment(pick, 15, 42, highXP, 64, option)!;
      expect(experienceStatus(result.points).level).toBe(50 - option - 1);
      expect(result.lapisCost).toBe(option + 1);
    }
  });
  it("caps shelves, preserves a level-30 bottom offer, and limits unassisted costs to 8", () => {
    for (let seed = 0; seed < 64; seed++) {
      expect(
        getEnchantingOffers(pick, 15, seed, highXP, 64)[2]!.requiredLevel,
      ).toBe(30);
      expect(getEnchantingOffers(pick, 99, seed, highXP, 64)).toEqual(
        getEnchantingOffers(pick, 15, seed, highXP, 64),
      );
      expect(
        getEnchantingOffers(pick, 0, seed, highXP, 64).every(
          (offer) => offer.requiredLevel <= 8,
        ),
      ).toBe(true);
    }
  });
  it("rejects enchanted/stacked/non-equipment input and malformed choices without mutations", () => {
    for (const input of [
      { ...pick, enchantments: { fortune: 3 } },
      { ...pick, count: 2 },
      { id: "book", count: 1 },
      { id: "shears", count: 1 },
      { id: "stone", count: 1 },
    ]) {
      expect(
        getEnchantingOffers(input, 15, 1, highXP, 64).every(
          (offer) => !offer.available,
        ),
      ).toBe(true);
      expect(applyEnchantment(input, 15, 1, highXP, 64, 2)).toBeNull();
    }
    for (const option of [-1, 3, 1.5, NaN])
      expect(applyEnchantment(pick, 15, 1, highXP, 64, option)).toBeNull();
    expect(getEnchantingOffers(null, 15, 1, highXP, 64)).toHaveLength(3);
    expect(
      getEnchantingOffers(pick, 15, -1, highXP, 64).every(
        (offer) => !offer.available,
      ),
    ).toBe(true);
  });
  it("all sampled material/slot outcomes are legal, conflict-free, and deterministically reloadable", () => {
    for (const id of [
      "wood_pickaxe",
      "stone_axe",
      "iron_shovel",
      "gold_hoe",
      "diamond_sword",
      "iron_helmet",
      "gold_chestplate",
      "diamond_leggings",
      "diamond_boots",
    ]) {
      for (let seed = 0; seed < 48; seed++) {
        const input = { id, count: 1 };
        for (const option of [0, 1, 2]) {
          const result = applyEnchantment(input, 15, seed, highXP, 64, option);
          if (!result) continue;
          expect(validateEnchantments(id, result.stack.enchantments)).toBe(
            true,
          );
          expect(
            result.stack.enchantments?.fortune &&
              result.stack.enchantments?.silk_touch,
          ).toBeFalsy();
          if (id.endsWith("_axe"))
            expect(result.stack.enchantments?.sharpness).toBeUndefined();
          expect(
            getEnchantingOffers(
              result.stack,
              15,
              result.seed,
              result.points,
              64,
            ).every((offer) => !offer.available),
          ).toBe(true);
        }
      }
    }
  });
});
