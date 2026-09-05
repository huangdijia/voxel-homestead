import { describe, expect, it } from "vitest";
import { Simulation, createNewSave } from "../src/game/Simulation";
import { countItem } from "../src/game/inventory";
import { validateSave } from "../src/game/storage";
import type { PlayerInput } from "../src/game/Simulation";
import type {
  ArmorSlot,
  BlockChange,
  EntityKind,
  EntityState,
  GameMode,
  Vec3,
  WorldPort,
} from "../src/game/types";

/** A flat floor, optionally covered by a still pool; uses the real collision rules. */
class SurvivalWorld implements WorldPort {
  constructor(readonly waterTop = 0) {}
  getBlock(_x: number, y: number, _z: number): number {
    const row = Math.floor(y);
    return row < 0 ? 24 : row === 0 ? 1 : row <= this.waterTop ? 6 : 0;
  }
  setBlock(): void {
    throw new Error("These survival scenarios must not edit terrain.");
  }
  isReady(): boolean {
    return true;
  }
  getSurface(): number {
    return 0;
  }
  getChanges(): BlockChange[] {
    return [];
  }
}
const idle: PlayerInput = {
  forward: 0,
  right: 0,
  jump: false,
  sneak: false,
  sprint: false,
};
function setup(waterTop = 0, mode: GameMode = "survival") {
  const data = createNewSave("生存机制试验", "survival-systems", mode);
  data.player.position = { x: 0.5, y: 1, z: 0.5 };
  data.player.spawn = { ...data.player.position };
  data.player.yaw = 0;
  data.player.pitch = 0;
  return new Simulation(new SurvivalWorld(waterTop), data);
}
function advance(
  sim: Simulation,
  seconds: number,
  input: PlayerInput = idle,
): void {
  const steps = Math.round(seconds / 0.05);
  for (let step = 0; step < steps; step++) sim.step(0.05, input);
}
function ironArmor(sim: Simulation, durability = 20): void {
  for (const [slot, id] of [
    ["head", "iron_helmet"],
    ["chest", "iron_chestplate"],
    ["legs", "iron_leggings"],
    ["feet", "iron_boots"],
  ] as [ArmorSlot, string][])
    sim.player.armor[slot] = { id, count: 1, durability };
}
function allItemCount(sim: Simulation, id: string): number {
  return (
    countItem(sim.player.inventory, id) +
    sim.drops.reduce(
      (sum, drop) => sum + (drop.stack.id === id ? drop.stack.count : 0),
      0,
    )
  );
}
function lookAt(sim: Simulation, target: Vec3): void {
  const eye = sim.eye(),
    dx = target.x - eye.x,
    dy = target.y - eye.y,
    dz = target.z - eye.z;
  sim.player.yaw = Math.atan2(-dx, -dz);
  sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

describe("water, breathing and swimming", () => {
  it("uses the available air before periodic drowning damage begins", () => {
    const sim = setup(5);
    sim.player.hunger = 10; // Keep natural regeneration independent of this oxygen scenario.
    advance(sim, 9.5);
    expect(sim.player.oxygen).toBeCloseTo(1, 5);
    expect(sim.player.health).toBe(20);
    advance(sim, 1.8);
    expect(sim.player.oxygen).toBe(0);
    expect(sim.player.health).toBe(18);
    advance(sim, 1);
    expect(sim.player.health).toBe(16);
    expect(sim.player.dead).toBe(false);
    expect(() => validateSave(sim.snapshot())).not.toThrow();
  });

  it("allows jump input to swim up through water and recover breath above the surface", () => {
    const sim = setup(5);
    sim.player.hunger = 10;
    sim.player.oxygen = 8;
    const swim = { ...idle, jump: true };
    advance(sim, 1.2, swim);
    expect(sim.player.position.y).toBeGreaterThan(4.38);
    expect(sim.eye().y).toBeGreaterThan(6);
    const surfacedAir = sim.player.oxygen;
    advance(sim, 0.5, swim);
    expect(sim.player.oxygen).toBeGreaterThan(surfacedAir);
    expect(sim.player.health).toBe(20);
    expect(sim.player.flying).toBe(false);
  });

  it("does not consume breath when only the body is in shallow water", () => {
    const sim = setup(1);
    advance(sim, 12);
    expect(sim.player.position.y).toBeCloseTo(1);
    expect(sim.player.oxygen).toBe(20);
    expect(sim.player.health).toBe(20);
  });

  it("recovers air to its cap and stops drowning damage after surfacing", () => {
    const sim = setup(5);
    sim.player.hunger = 10;
    advance(sim, 11.3);
    expect(sim.player.health).toBe(18);
    advance(sim, 1.2, { ...idle, jump: true });
    const healthAtSurface = sim.player.health;
    // Stand on a dry ledge supplied by the test world, with the same player state.
    const saved = sim.snapshot();
    saved.player.position = { x: 0.5, y: 1, z: 0.5 };
    saved.player.velocity = { x: 0, y: 0, z: 0 };
    const ashore = new Simulation(new SurvivalWorld(), saved);
    advance(ashore, 4);
    expect(ashore.player.oxygen).toBe(20);
    expect(ashore.player.health).toBe(healthAtSurface);
    expect(allItemCount(ashore, "iron_ingot")).toBe(0);
  });

  it("does not apply underwater survival penalties in creative mode", () => {
    const sim = setup(5, "creative");
    advance(sim, 20);
    expect(sim.player.health).toBe(20);
    expect(sim.player.hunger).toBe(20);
    expect(sim.player.oxygen).toBe(20);
    expect(sim.player.dead).toBe(false);
  });
});

describe("hunger, regeneration and exertion", () => {
  it("regenerates gradually with sufficient food and never exceeds maximum health", () => {
    const sim = setup();
    sim.player.health = 18;
    advance(sim, 3.9);
    expect(sim.player.health).toBe(18);
    advance(sim, 0.2);
    expect(sim.player.health).toBe(19);
    advance(sim, 4.1);
    expect(sim.player.health).toBe(20);
    advance(sim, 12);
    expect(sim.player.health).toBe(20);
    expect(sim.player.hunger).toBeLessThanOrEqual(20);
  });

  it("does not regenerate while underfed", () => {
    const sim = setup();
    sim.player.health = 12;
    sim.player.hunger = 17;
    advance(sim, 12);
    expect(sim.player.health).toBe(12);
    expect(sim.player.hunger).toBe(17);
  });

  it("starvation periodically hurts but leaves one health point on normal difficulty", () => {
    const sim = setup();
    sim.player.health = 3;
    sim.player.hunger = 0;
    sim.player.inventory[0] = { id: "log", count: 5 };
    advance(sim, 4.1);
    expect(sim.player.health).toBe(2);
    advance(sim, 4.1);
    expect(sim.player.health).toBe(1);
    advance(sim, 20);
    expect(sim.player.health).toBe(1);
    expect(sim.player.dead).toBe(false);
    expect(sim.player.hunger).toBe(0);
    expect(countItem(sim.player.inventory, "log")).toBe(5);
    expect(sim.drops).toHaveLength(0);
  });

  it("sprinting travels farther and consumes food sooner than ordinary walking or resting", () => {
    const runner = setup(),
      walker = setup(),
      resting = setup();
    advance(runner, 13, { ...idle, forward: 1, sprint: true });
    advance(walker, 13, { ...idle, forward: 1 });
    advance(resting, 13);
    expect(Math.abs(runner.player.position.z - 0.5)).toBeGreaterThan(
      Math.abs(walker.player.position.z - 0.5),
    );
    expect(runner.player.hunger).toBeLessThan(walker.player.hunger);
    expect(walker.player.hunger).toBe(20);
    expect(resting.player.hunger).toBe(20);
    expect(runner.player.health).toBe(20);
  });
});

describe("armor protection and wear", () => {
  it("a full iron suit reduces a ten-point attack to six damage and wears each piece by two", () => {
    const bare = setup(),
      armored = setup();
    ironArmor(armored);
    bare.damage(10, "attack");
    armored.damage(10, "attack");
    expect(bare.player.health).toBe(10);
    expect(armored.player.health).toBe(14);
    expect(
      Object.values(armored.player.armor).map((slot) => slot?.durability),
    ).toEqual([18, 18, 18, 18]);
    armored.damage(10, "attack"); // Same contact during the invulnerability interval.
    expect(armored.player.health).toBe(14);
    expect(
      Object.values(armored.player.armor).map((slot) => slot?.durability),
    ).toEqual([18, 18, 18, 18]);
    advance(armored, 0.5);
    armored.damage(10, "attack");
    expect(armored.player.health).toBe(8);
    expect(
      Object.values(armored.player.armor).map((slot) => slot?.durability),
    ).toEqual([16, 16, 16, 16]);
    expect(() => validateSave(armored.snapshot())).not.toThrow();
  });

  it("also protects from explosion damage, without reducing fall damage", () => {
    const explosion = setup(),
      falling = setup();
    ironArmor(explosion);
    ironArmor(falling);
    explosion.damage(10, "explosion");
    falling.damage(10, "fall");
    expect(explosion.player.health).toBe(14);
    expect(falling.player.health).toBe(10);
    expect(
      Object.values(falling.player.armor).map((slot) => slot?.durability),
    ).toEqual([20, 20, 20, 20]);
  });

  it("does not absorb drowning damage or wear armor while underwater", () => {
    const sim = setup(5);
    ironArmor(sim);
    sim.player.hunger = 10;
    advance(sim, 11.3);
    expect(sim.player.health).toBe(18);
    expect(
      Object.values(sim.player.armor).map((slot) => slot?.durability),
    ).toEqual([20, 20, 20, 20]);
  });

  it("removes a worn-out armor piece rather than duplicating it as a drop", () => {
    const sim = setup();
    sim.player.armor.chest = { id: "iron_chestplate", count: 1, durability: 1 };
    sim.damage(4, "attack");
    expect(sim.player.armor.chest).toBeNull();
    expect(allItemCount(sim, "iron_chestplate")).toBe(0);
    expect(sim.player.health).toBeGreaterThan(16);
    advance(sim, 0.5);
    const before = sim.player.health;
    sim.damage(4, "attack");
    expect(sim.player.health).toBeCloseTo(before - 4);
  });
});

describe("hunting and item conservation", () => {
  it.each([
    { kind: "pig" as EntityKind, health: 10, loot: { raw_pork: 2 } },
    {
      kind: "sheep" as EntityKind,
      health: 8,
      loot: { raw_mutton: 2, wool: 1 },
    },
  ])(
    "killing a $kind produces its meat/materials exactly once, then preserves them through pickup and save",
    ({ kind, health, loot }) => {
      const sim = setup();
      sim.player.inventory[0] = { id: "iron_sword", count: 1, durability: 250 };
      const animal: EntityState = {
        id: `hunting-${kind}`,
        kind,
        position: { x: 0.5, y: 1, z: -1 },
        health,
        yaw: 0,
        timer: 1,
      };
      sim.entities = [animal];
      const aimAtAnimal = () =>
        lookAt(sim, { ...animal.position, y: animal.position.y + 0.55 });
      aimAtAnimal();
      expect(sim.attack()).toBe(true);
      expect(sim.entities.some((entity) => entity.id === animal.id)).toBe(true);
      expect(sim.drops).toHaveLength(0);
      expect(sim.attack()).toBe(false); // Holding attack cannot skip the cooldown.
      advance(sim, 0.55);
      aimAtAnimal();
      expect(sim.attack()).toBe(true);
      expect(sim.entities.some((entity) => entity.id === animal.id)).toBe(
        false,
      );
      expect(sim.held?.durability).toBe(248);
      for (const [id, count] of Object.entries(loot)) {
        expect(allItemCount(sim, id)).toBe(count);
        expect(countItem(sim.player.inventory, id)).toBe(0);
      }
      const deathCheckpoint = validateSave(sim.snapshot());
      expect(deathCheckpoint.drops.every((drop) => drop.age < 0)).toBe(true);
      sim.player.position = { ...animal.position };
      sim.player.velocity = { x: 0, y: 0, z: 0 };
      advance(sim, 0.5);
      for (const [id, count] of Object.entries(loot)) {
        expect(countItem(sim.player.inventory, id)).toBe(0);
        expect(allItemCount(sim, id)).toBe(count);
      }
      advance(sim, 0.3);
      expect(sim.drops).toHaveLength(0);
      for (const [id, count] of Object.entries(loot))
        expect(countItem(sim.player.inventory, id)).toBe(count);
      expect(sim.attack()).toBe(false);
      const reloaded = new Simulation(
        new SurvivalWorld(),
        validateSave(sim.snapshot()),
      );
      for (const [id, count] of Object.entries(loot))
        expect(allItemCount(reloaded, id)).toBe(count);
      expect(
        reloaded.player.inventory.find((slot) => slot?.id === "iron_sword")
          ?.durability,
      ).toBe(248);
    },
  );
});
