import { describe, expect, it, vi } from "vitest";
import {
  MAX_EXPERIENCE,
  experienceForLevel,
  experienceStatus,
  experienceToNextLevel,
  spendLevels,
  deathExperience,
  miningExperience,
  mobExperience,
  rollFractionalExperience,
  SMELTING_EXPERIENCE,
} from "../src/game/experience";
import { SMELTING } from "../src/game/recipes";

describe("Java experience progression", () => {
  it.each([
    [0, 0],
    [1, 7],
    [15, 315],
    [16, 352],
    [17, 394],
    [27, 1089],
    [30, 1395],
    [31, 1507],
    [32, 1628],
    [40, 2920],
    [100, 30970],
  ])("level %i starts at %i points", (level, points) => {
    expect(experienceForLevel(level)).toBe(points);
    expect(experienceStatus(points)).toMatchObject({
      level,
      progress: 0,
      pointsIntoLevel: 0,
    });
    if (points > 0)
      expect(experienceStatus(points - 0.001).level).toBe(level - 1);
  });
  it("has continuous costs across both quadratic boundaries", () => {
    expect([15, 16, 30, 31, 32].map(experienceToNextLevel)).toEqual([
      37, 42, 112, 121, 130,
    ]);
    for (let level = 0; level < 1000; level++)
      expect(experienceForLevel(level + 1) - experienceForLevel(level)).toBe(
        experienceToNextLevel(level),
      );
  });
  it("spends 3 levels from level 30 while retaining the same fractional bar", () => {
    const points = 1395 + 56;
    expect(experienceStatus(points).progress).toBe(0.5);
    expect(spendLevels(points, 3)).toBe(1089 + 48.5);
    expect(experienceStatus(spendLevels(points, 3)!)).toMatchObject({
      level: 27,
      progress: 0.5,
    });
    expect(spendLevels(points, 31)).toBeNull();
    expect(spendLevels(points, 1.5)).toBeNull();
  });
  it("retains level-zero bar progress and survives serialized fractional XP", () => {
    const remaining = spendLevels(7 + 4.5, 1)!;
    expect(remaining).toBe(3.5);
    expect(
      experienceStatus(JSON.parse(JSON.stringify(remaining))).progress,
    ).toBe(0.5);
    expect(spendLevels(remaining, 1)).toBeNull();
    expect(spendLevels(remaining, 0)).toBe(remaining);
  });
  it("drops only capped level-based XP on death, ignoring bar progress", () => {
    expect(deathExperience(6.9)).toBe(0);
    expect(deathExperience(experienceForLevel(7) + 10)).toBe(49);
    expect(deathExperience(experienceForLevel(14))).toBe(98);
    expect(deathExperience(experienceForLevel(15))).toBe(100);
    expect(deathExperience(MAX_EXPERIENCE)).toBe(100);
  });
  it.each([NaN, Infinity, -1, MAX_EXPERIENCE + 1])(
    "rejects invalid points %s",
    (points) => {
      expect(() => experienceStatus(points)).toThrow(RangeError);
      expect(spendLevels(points, 1)).toBeNull();
    },
  );
  it("handles the bounded maximum without unbounded level iteration", () => {
    const status = experienceStatus(MAX_EXPERIENCE);
    expect(experienceForLevel(status.level)).toBeLessThanOrEqual(
      MAX_EXPERIENCE,
    );
    expect(experienceForLevel(status.level + 1)).toBeGreaterThan(
      MAX_EXPERIENCE,
    );
    expect(status.progress).toBeGreaterThanOrEqual(0);
    expect(status.progress).toBeLessThan(1);
  });
});
describe("experience sources", () => {
  it.each([
    [9, 92, 0, 2],
    [86, 96, 1, 5],
    [87, 97, 2, 5],
    [88, 98, 3, 7],
    [89, 99, 3, 7],
  ])(
    "normal ore %i and deep ore %i have matching XP ranges",
    (normal, deep, low, high) => {
      for (const block of [normal, deep]) {
        expect(miningExperience(block, false, () => 0)).toBe(low);
        expect(miningExperience(block, false, () => 0.99999)).toBe(high);
        const random = vi.fn(() => 0.5);
        expect(miningExperience(block, true, random)).toBe(0);
        expect(random).not.toHaveBeenCalled();
      }
    },
  );
  it("raw-metal mining and ordinary blocks do not create XP", () => {
    for (const id of [0, 1, 3, 10, 84, 85, 93, 94, 95, 100])
      expect(miningExperience(id, false, () => 0.99)).toBe(0);
  });
  it("passive adults drop 1–3, passive babies none, and hostile kills 5", () => {
    for (const kind of ["pig", "sheep", "cow"] as const) {
      expect(mobExperience(kind, false, () => 0)).toBe(1);
      expect(mobExperience(kind, false, () => 0.999)).toBe(3);
      expect(mobExperience(kind, true, () => 0.999)).toBe(0);
    }
    expect(mobExperience("zombie", false, () => 0)).toBe(5);
    expect(mobExperience("creeper", false, () => 0)).toBe(5);
  });
  it("covers every implemented smelting recipe, with fractional cooking and ore rewards", () => {
    expect(Object.keys(SMELTING_EXPERIENCE).sort()).toEqual(
      Object.keys(SMELTING).sort(),
    );
    expect(SMELTING_EXPERIENCE).toMatchObject({
      raw_iron: 0.7,
      raw_copper: 0.7,
      raw_gold: 1,
      log: 0.15,
      raw_pork: 0.35,
      potato: 0.35,
      sand: 0.1,
      lapis_ore: 0.2,
      redstone_ore: 0.7,
    });
  });
  it("rounds accumulated fractions once and never awards a fractional orb", () => {
    expect(rollFractionalExperience(2.8, () => 0.79)).toBe(3);
    expect(rollFractionalExperience(2.8, () => 0.81)).toBe(2);
    const random = vi.fn(() => 0);
    expect(rollFractionalExperience(7, random)).toBe(7);
    expect(rollFractionalExperience(0, random)).toBe(0);
    expect(random).not.toHaveBeenCalled();
    expect(() => rollFractionalExperience(-1, random)).toThrow();
  });
});
