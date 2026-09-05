import { RIFLE, traceRifle } from "./firearms";
import { WORLD_MIN_Y, WORLD_MAX_Y } from "../engine/world-height";
import { canHarvest, miningDuration, damageAfterArmor } from "./equipment";
import { FluidSystem } from "./fluids";
import { NaturalUpdatesSystem } from "./natural-updates";
import { SugarCaneSystem } from "./sugar-cane";
import {
  experienceStatus,
  deathExperience,
  miningExperience,
  mobExperience,
  SMELTING_EXPERIENCE,
  rollFractionalExperience,
  MAX_EXPERIENCE,
  spendLevels,
} from "./experience";
import {
  durabilityConsumed,
  fortuneDropCount,
  silkTouchDrop,
  sharpnessBonus,
  enchantmentDamageMultiplier,
  consumesOxygen,
  enchantability,
  ENCHANTMENTS,
} from "./enchantments";
import {
  countBookshelves,
  getEnchantingOffers,
  applyEnchantment,
} from "./enchanting";
import {
  getAnvilResult,
  getGrindstoneResult,
  normalizeItemName,
} from "./workshops";
import {
  fluidSurfaceHeights,
  workshopBlockState,
  grindstoneBlockId,
} from "../engine/shapes";
import { fluidInfo, isFluid, isWater, isLava } from "./fluid-blocks";
import type {
  ArmorSlot,
  BlockChange,
  ContainerState,
  DropState,
  EntityKind,
  EntityState,
  ProgressionState,
  EnchantingView,
  WorkshopView,
  GameMode,
  ItemStack,
  PlayerState,
  RecipeDefinition,
  SaveData,
  Slot,
  Vec3,
  WorldEvent,
  WorldPort,
} from "./types";
import { BLOCKS, ITEMS, ENTITIES, COW_DROP_RANGES } from "./registry";
import {
  addItem,
  clickInventorySlot,
  createInventory,
  compatibleStacks,
} from "./inventory";
import {
  RECIPES,
  canCraft,
  craftFromInventory,
  consumeRecipe,
  matchRecipe,
  SMELTING,
} from "./recipes";
import { intersectsWorld, moveBody, raycastVoxel } from "../engine/physics";
import { surfaceHeight, seedNumber } from "../engine/generator";
import {
  FarmingSystem,
  CROP_DEFINITIONS,
  cropAt,
  harvestCrop,
  FARMLAND,
} from "./farming";

const uid = () => crypto.randomUUID();
export const posKey = (p: Vec3) =>
  `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clone = <T>(x: T): T => structuredClone(x);
const armorKeys: ArmorSlot[] = ["head", "chest", "legs", "feet"];
export interface PlayerInput {
  forward: number;
  right: number;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
}
export function createNewSave(
  name: string,
  seed: string,
  mode: GameMode,
): SaveData {
  const worldSeed =
    seed.trim() || String(Math.floor(Math.random() * 2147483647));
  const spawn = { x: 0.5, y: surfaceHeight(worldSeed, 0, 0, 7) + 1.05, z: 0.5 };
  return {
    manifest: {
      version: 7,
      generatorVersion: 7,
      id: uid(),
      name: name.trim() || "新的世界",
      seed: worldSeed,
      mode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      playedSeconds: 0,
    },
    player: {
      position: { ...spawn },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: -1.05,
      pitch: -0.06,
      health: 20,
      hunger: 20,
      oxygen: 20,
      inventory: createInventory(),
      armor: { head: null, chest: null, legs: null, feet: null },
      selected: 0,
      spawn,
      dead: false,
      flying: mode === "creative",
    },
    changes: [],
    containers: {},
    entities: [],
    drops: [],
    time: 1000,
    progression: {
      points: 0,
      enchantmentSeed: seedNumber(worldSeed),
      orbs: [],
    },
    sugarCane: {
      version: 1,
      accumulator: 0,
      scanCursor: 0,
      queue: [],
      growth: [],
    },
    farming: {
      version: 1,
      randomState: seedNumber(worldSeed),
      clock: 0,
      accumulator: 0,
      scanCursor: 0,
      plots: [],
    },
    composters: {},
    fluids: { version: 1, clock: 0, scanCursor: 0, tasks: [] },
    natural: {
      version: 1,
      randomState: seedNumber(worldSeed),
      accumulator: 0,
      scanCursor: 0,
      queue: [],
      falling: [],
    },
  };
}

/** The authoritative local simulation. Rendering never owns inventory or terrain state. */
export class Simulation {
  manifest: SaveData["manifest"];
  player: PlayerState;
  time: number;
  entities: EntityState[];
  drops: DropState[];
  containers: Record<string, ContainerState>;
  readonly farming: FarmingSystem;
  readonly fluids: FluidSystem;
  readonly natural: NaturalUpdatesSystem;
  readonly sugarCane: SugarCaneSystem;
  progression: ProgressionState;
  composters: Record<string, number>;
  craftSlots: Slot[] = Array(4).fill(null);
  cursor: Slot = null;
  station: "inventory" | "workbench" | "enchanting" | "anvil" | "grindstone" =
    "inventory";
  enchantingPosition: Vec3 | null = null;
  workshopPosition: Vec3 | null = null;
  private workshopName = "";
  private workshopInput: Slot = null;
  containerKey: string | null = null;
  mining = 0;
  miningKey = "";
  lastMessage = "";
  dirty = true;
  private grounded = false;
  private fallDistance = 0;
  private attackCooldown = 0;
  private hurtCooldown = 0;
  private foodTimer = 0;
  private foodPending: { id: string; index: number } | null = null;
  private healTimer = 0;
  private drownTimer = 0;
  private spawnTimer = 0;
  private footstep = 0;
  private exhaustion = 0;
  private mobPulse = 0;
  private age = 0;
  private entityVel = new Map<string, number>();
  onOpen?: (
    kind:
      "workbench" | "chest" | "furnace" | "enchanting" | "anvil" | "grindstone",
  ) => void;
  constructor(
    public world: WorldPort,
    data: SaveData,
    private emit: (event: WorldEvent) => void = () => {},
  ) {
    this.manifest = clone(data.manifest);
    this.player = clone(data.player);
    this.time = data.time;
    this.entities = clone(data.entities);
    this.drops = clone(data.drops);
    this.containers = clone(data.containers);
    this.composters = clone(data.composters ?? {});
    this.progression = clone(
      data.progression ?? {
        points: 0,
        enchantmentSeed: seedNumber(data.manifest.seed),
        orbs: [],
      },
    );
    this.farming = new FarmingSystem(world, data.manifest.seed, data.farming, {
      dropItem: (stack, position) => this.spawnDrop(stack, position),
      changed: () => {
        this.dirty = true;
      },
    });
    const setBlock = (x: number, y: number, z: number, id: number) =>
      this.updateNaturalBlock(x, y, z, id);
    this.fluids = new FluidSystem(world, data.fluids, { setBlock });
    this.natural = new NaturalUpdatesSystem(
      world,
      data.manifest.seed,
      data.natural,
      {
        setBlock,
        dropItem: (position, stack) => this.spawnDrop(stack, position),
        anvilImpact: (position, distance) =>
          this.anvilImpact(position, distance),
      },
    );
    this.sugarCane = new SugarCaneSystem(
      world,
      data.manifest.seed,
      data.sugarCane,
      {
        setBlock,
        dropItem: (position, stack) => this.spawnDrop(stack, position),
      },
    );
    if (!data.fluids || !data.natural)
      for (const change of world.getChanges()) {
        if (!data.fluids) this.fluids.notifyBlockChanged(change, 0, change.id);
        if (!data.natural)
          this.natural.notifyBlockChanged(change, 0, change.id);
      }
    if (!data.farming)
      for (const change of world.getChanges())
        if (change.id === 28 || change.id === 29)
          this.farming.notifyBlockChanged(change, 0, change.id);
  }
  get creative() {
    return this.manifest.mode === "creative";
  }
  get held() {
    return this.player.inventory[this.player.selected];
  }
  get night() {
    return this.time >= 13000 && this.time < 23000;
  }
  toast(message: string) {
    this.lastMessage = message;
    this.emit({ type: "toast", message });
  }
  sound(sound: string) {
    this.emit({ type: "sound", sound });
  }
  /** Every authoritative edit wakes neighboring block rules after the write succeeds. */
  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (
      y < WORLD_MIN_Y ||
      y > WORLD_MAX_Y ||
      !this.world.isReady(x, z, y) ||
      !BLOCKS[id]
    )
      return false;
    const position = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
    const oldId = this.world.getBlock(position.x, position.y, position.z);
    if (oldId === id) return true;
    this.world.setBlock(position.x, position.y, position.z, id);
    if (this.world.getBlock(position.x, position.y, position.z) !== id)
      return false;
    this.farming.notifyBlockChanged(position, oldId, id);
    this.fluids?.notifyBlockChanged(position, oldId, id);
    this.natural?.notifyBlockChanged(position, oldId, id);
    this.sugarCane?.notifyBlockChanged(position, oldId, id);
    this.dirty = true;
    return true;
  }
  private updateNaturalBlock(
    x: number,
    y: number,
    z: number,
    id: number,
  ): boolean {
    const old = this.world.getBlock(x, y, z);
    if (!this.setBlock(x, y, z, id)) return false;
    if (old !== id && old !== 0 && isFluid(id)) {
      if (cropAt(old))
        for (const stack of harvestCrop(old, () => this.farming.nextRandom()))
          this.spawnDrop(stack, { x, y, z });
      else if (old === 58 && this.farming.nextRandom() < 0.125)
        this.spawnDrop({ id: "wheat_seeds", count: 1 }, { x, y, z });
      else if ([16, 20, 83, 111].includes(old)) {
        const drop = BLOCKS[old].drop;
        if (drop) this.spawnDrop({ id: drop, count: 1 }, { x, y, z });
      }
    }
    return true;
  }
  private fluidAt(position: Vec3) {
    const x = Math.floor(position.x),
      y = Math.floor(position.y),
      z = Math.floor(position.z);
    const id = this.world.getBlock(x, y, z);
    if (!isFluid(id)) return undefined;
    const [a, b, c, d] = fluidSurfaceHeights(id, x, y, z, (x, y, z) =>
      this.world.getBlock(x, y, z),
    );
    const u = position.x - x,
      v = position.z - z;
    const height =
      u >= v ? a + (b - a) * u + (d - b) * v : a + (d - c) * u + (c - a) * v;
    return position.y - y < height ? fluidInfo(id) : undefined;
  }
  eye(): Vec3 {
    return {
      x: this.player.position.x,
      y: this.player.position.y + 1.62,
      z: this.player.position.z,
    };
  }
  direction(): Vec3 {
    const p = this.player;
    return {
      x: -Math.sin(p.yaw) * Math.cos(p.pitch),
      y: Math.sin(p.pitch),
      z: -Math.cos(p.yaw) * Math.cos(p.pitch),
    };
  }
  target() {
    return raycastVoxel(
      this.world,
      this.eye(),
      this.direction(),
      this.creative ? 6 : 4.5,
    );
  }
  private hasCollision(p: Vec3, w = 0.6, h = 1.8) {
    return intersectsWorld(this.world, p, w, h);
  }
  step(dt: number, input: PlayerInput) {
    if (
      !this.world.isReady(
        this.player.position.x,
        this.player.position.z,
        this.player.position.y,
      )
    )
      return;
    this.age += dt;
    this.manifest.playedSeconds += dt;
    this.time = (this.time + dt * 20) % 24000;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    if (!this.player.dead) {
      this.move(dt, input);
      this.updateNeeds(dt, input);
    }
    this.fluids.step(dt, this.player.position);
    this.natural.step(dt, this.player.position, this.night ? 4 : 15);
    this.sugarCane.step(dt, this.player.position);
    this.updateFurnaces(dt);
    this.farming.step(dt, this.player.position, this.night ? 4 : 15);
    for (const [key, remaining] of Object.entries(this.composters)) {
      const [x, y, z] = key.split(",").map(Number);
      if (!this.world.isReady(x, z, y)) continue;
      if (this.world.getBlock(x, y, z) !== 66) {
        delete this.composters[key];
        continue;
      }
      this.composters[key] = remaining - dt;
      if (this.composters[key] <= 0) {
        this.setBlock(x, y, z, 67);
        delete this.composters[key];
      }
    }
    this.updateDrops(dt);
    this.updateExperience(dt);
    this.updateMobs(dt);
    this.dirty = true;
  }
  private move(dt: number, input: PlayerInput) {
    const p = this.player,
      body = p.position;
    const fluid = this.fluidAt({ ...body, y: body.y + 0.3 });
    const wet = !!fluid;
    const ladder =
      this.world.getBlock(
        Math.floor(body.x),
        Math.floor(body.y + 0.3),
        Math.floor(body.z),
      ) === 20 ||
      this.world.getBlock(
        Math.floor(body.x),
        Math.floor(body.y + 1.2),
        Math.floor(body.z),
      ) === 20;
    let speed = p.flying
      ? input.sprint
        ? 12
        : 7
      : wet
        ? fluid?.kind === "lava"
          ? 1.2
          : 2.4
        : input.sneak
          ? 1.6
          : input.sprint && p.hunger > 6
            ? 5.6
            : 4.3;
    const length = Math.hypot(input.forward, input.right) || 1,
      f = input.forward / length,
      r = input.right / length;
    p.velocity.x = (-Math.sin(p.yaw) * f + Math.cos(p.yaw) * r) * speed;
    p.velocity.z = (-Math.cos(p.yaw) * f - Math.sin(p.yaw) * r) * speed;
    if (p.flying) {
      p.velocity.y = (Number(input.jump) - Number(input.sneak)) * speed;
      this.fallDistance = 0;
    } else if (wet) {
      p.velocity.y = Math.max(-2.8, p.velocity.y - dt * 6);
      if (input.jump) p.velocity.y = 3.5;
      this.fallDistance = 0;
    } else if (ladder) {
      p.velocity.y =
        input.jump || input.forward > 0 ? 3 : input.sneak ? 0 : -1.5;
      this.fallDistance = 0;
    } else {
      if (input.jump && this.grounded) {
        p.velocity.y = 8.3;
        this.grounded = false;
        this.exhaustion += 0.15;
      }
      p.velocity.y = Math.max(-38, p.velocity.y - 25 * dt);
    }
    let dx = p.velocity.x * dt,
      dz = p.velocity.z * dt;
    if (input.sneak && this.grounded && !p.flying && !wet) {
      const support = (x: number, z: number) =>
        this.world.getBlock(
          Math.floor(x),
          Math.floor(body.y - 0.15),
          Math.floor(z),
        );
      if (!BLOCKS[support(body.x + dx, body.z)]?.solid) dx = 0;
      if (!BLOCKS[support(body.x, body.z + dz)]?.solid) dz = 0;
    }
    if (!this.world.isReady(body.x + dx, body.z + dz, body.y)) {
      dx = 0;
      dz = 0;
    }
    const moved = moveBody(
      this.world,
      body,
      { x: dx, y: p.velocity.y * dt, z: dz },
      0.6,
      1.8,
    );
    p.position = moved.position;
    if (p.position.y < body.y && !wet && !p.flying && !ladder)
      this.fallDistance += body.y - p.position.y;
    this.grounded = moved.grounded;
    if (moved.hitY) {
      if (p.velocity.y < 0 && this.fallDistance > 3)
        this.damage(Math.ceil(this.fallDistance - 3), "fall");
      p.velocity.y = 0;
      this.fallDistance = 0;
    }
    if (p.position.y < WORLD_MIN_Y - 64) {
      if (this.creative) {
        p.position = { ...p.spawn };
        p.velocity = { x: 0, y: 0, z: 0 };
      } else this.damage(100, "void");
    }
    const travel = Math.hypot(dx, dz);
    this.footstep += travel;
    if (this.footstep > 2.1 && this.grounded) {
      this.sound("step");
      this.footstep = 0;
    }
    if (!this.creative)
      this.exhaustion += travel * (input.sprint ? 0.06 : 0.012);
  }
  private updateNeeds(dt: number, input: PlayerInput) {
    if (this.creative) {
      this.player.health = 20;
      this.player.hunger = 20;
      this.player.oxygen = 20;
      return;
    }
    const p = this.player;
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      p.hunger = Math.max(0, p.hunger - 1);
    }
    this.healTimer += dt;
    if (this.healTimer >= 4) {
      this.healTimer = 0;
      if (p.hunger >= 18 && p.health < 20) {
        p.health = Math.min(20, p.health + 1);
        this.exhaustion += 1.2;
      } else if (p.hunger === 0 && p.health > 1) this.damage(1, "hunger");
    }
    const e = this.eye();
    const underwater = this.fluidAt(e)?.kind === "water";
    if (this.fluidAt({ ...p.position, y: p.position.y + 0.1 })?.kind === "lava")
      this.damage(4, "lava");
    const oxygenTick =
      underwater &&
      consumesOxygen(p.armor.head, () => this.farming.nextRandom());
    p.oxygen = underwater
      ? Math.max(0, p.oxygen - (oxygenTick ? dt * 2 : 0))
      : Math.min(20, p.oxygen + dt * 8);
    if (underwater && p.oxygen === 0) {
      this.drownTimer += oxygenTick ? dt : 0;
      if (this.drownTimer >= 1) {
        this.damage(2, "drown");
        this.drownTimer = 0;
      }
    } else this.drownTimer = 0;
    if (this.foodTimer > 0) {
      if (
        !this.foodPending ||
        this.player.selected !== this.foodPending.index ||
        this.held?.id !== this.foodPending.id
      ) {
        this.foodTimer = 0;
        this.foodPending = null;
        return;
      }
      this.foodTimer -= dt;
      if (this.foodTimer <= 0) {
        const item = this.held;
        this.foodPending = null;
        if (item && ITEMS[item.id]?.food) {
          p.hunger = Math.min(20, p.hunger + ITEMS[item.id].food!);
          item.count--;
          if (!item.count) p.inventory[p.selected] = null;
          const remainder = ITEMS[item.id].foodRemainder;
          if (remainder) {
            const left = addItem(p.inventory, { id: remainder, count: 1 });
            if (left) this.spawnDrop(left, p.position);
          }
          if (item.id === "poisonous_potato" && this.farming.nextRandom() < 0.6)
            this.damage(Math.min(4, Math.max(0, p.health - 1)), "poison");
          this.sound("eat");
          this.toast("吃饱一点，继续探索。");
        }
      }
    }
  }
  damage(amount: number, reason = "attack") {
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      this.creative ||
      this.player.dead ||
      this.hurtCooldown > 0
    )
      return;
    const armor = Object.values(this.player.armor).reduce(
      (v, s) => v + (s ? ITEMS[s.id]?.armorPoints || 0 : 0),
      0,
    );
    const toughness = Object.values(this.player.armor).reduce(
      (sum, stack) =>
        sum + (stack ? (ITEMS[stack.id]?.armorToughness ?? 0) : 0),
      0,
    );
    const protectedHit = ["attack", "explosion", "lava", "anvil"].includes(
      reason,
    );
    if (reason === "anvil" && this.player.armor.head) {
      const helmet = this.player.armor.head;
      helmet.durability =
        (helmet.durability ?? ITEMS[helmet.id].maxDurability!) -
        durabilityConsumed(helmet, Math.max(1, Math.floor(amount / 4)), () =>
          this.farming.nextRandom(),
        );
      if (helmet.durability <= 0) this.player.armor.head = null;
      amount *= 0.75;
    }
    const physical = protectedHit
      ? damageAfterArmor(amount, armor, toughness)
      : amount;
    const dealt =
      physical *
      enchantmentDamageMultiplier(
        Object.values(this.player.armor),
        reason === "fall"
          ? "fall"
          : ["hunger", "void"].includes(reason)
            ? "bypass"
            : "other",
      );
    this.player.health = Math.max(0, this.player.health - dealt);
    this.hurtCooldown = 0.45;
    this.sound("hurt");
    this.emit({ type: "damage" });
    if (protectedHit)
      for (const key of armorKeys) {
        const s = this.player.armor[key];
        if (s) {
          s.durability =
            (s.durability ?? ITEMS[s.id].maxDurability ?? 100) -
            durabilityConsumed(s, Math.max(1, Math.floor(amount / 4)), () =>
              this.farming.nextRandom(),
            );
          if (s.durability <= 0) this.player.armor[key] = null;
        }
      }
    if (this.player.health <= 0) this.die();
  }
  private anvilImpact(at: Vec3, fallen: number) {
    const amount = Math.min(40, Math.max(0, Math.ceil(fallen - 1) * 2));
    if (!amount) return;
    const touches = (position: Vec3, width: number, height: number) =>
      position.x + width / 2 > at.x &&
      position.x - width / 2 < at.x + 1 &&
      position.z + width / 2 > at.z &&
      position.z - width / 2 < at.z + 1 &&
      position.y < at.y + 1 &&
      position.y + height > at.y;
    if (touches(this.player.position, 0.6, 1.8)) this.damage(amount, "anvil");
    for (const entity of [...this.entities]) {
      const baby = (entity.age ?? 0) < 0;
      if (
        !this.world.isReady(
          entity.position.x,
          entity.position.z,
          entity.position.y,
        ) ||
        !touches(
          entity.position,
          baby ? 0.35 : 0.65,
          ENTITIES[entity.kind].hostile ? 1.75 : baby ? 0.6 : 1.2,
        )
      )
        continue;
      entity.health -= amount;
      if (entity.health > 0) continue;
      if ((entity.playerHitTimer ?? 0) > 0)
        this.spawnExperience(
          mobExperience(entity.kind, baby, () => this.farming.nextRandom()),
          entity.position,
        );
      if (!baby) {
        if (entity.kind === "cow") {
          for (const [id, range] of Object.entries(COW_DROP_RANGES)) {
            const count =
              range[0] +
              Math.floor(this.farming.nextRandom() * (range[1] - range[0] + 1));
            if (count) this.spawnDrop({ id, count }, entity.position);
          }
        } else
          ENTITIES[entity.kind].drops.forEach((stack) => {
            if (stack.id !== "wool" || !entity.sheared)
              this.spawnDrop(stack, entity.position);
          });
      }
      this.entities = this.entities.filter((e) => e.id !== entity.id);
      this.entityVel.delete(entity.id);
    }
    this.sound("hit");
  }
  private die() {
    this.closeContainer();
    const p = this.player;
    p.dead = true;
    this.spawnExperience(deathExperience(this.progression.points), p.position);
    this.progression.points = 0;
    p.velocity = { x: 0, y: 0, z: 0 };
    p.inventory.forEach((s) => {
      if (s) this.spawnDrop(s, p.position);
    });
    p.inventory = createInventory();
    armorKeys.forEach((k) => {
      const s = p.armor[k];
      if (s) this.spawnDrop(s, p.position);
      p.armor[k] = null;
    });
    this.toast("你倒下了。物品留在原地，可以回去找回。");
  }
  respawn() {
    const p = this.player;
    // A remote bed may not be resident yet. Only this destination search uses
    // authoritative voxels without the temporary barriers of normal movement.
    const spawnWorld = { getBlock: this.world.getBlock.bind(this.world) };
    let spawn = { ...p.spawn };
    if (p.bedSpawn) {
      const b = p.bedSpawn;
      const block = this.world.getBlock(
        Math.floor(b.x),
        Math.floor(b.y),
        Math.floor(b.z),
      );
      if (block === 22 || block === 27) {
        const candidates = [
          { x: b.x + 1.5, y: b.y + 0.1, z: b.z + 0.5 },
          { x: b.x - 0.5, y: b.y + 0.1, z: b.z + 0.5 },
          { x: b.x + 0.5, y: b.y + 1, z: b.z + 0.5 },
        ];
        const safe = candidates.find((c) => !intersectsWorld(spawnWorld, c));
        if (safe) spawn = safe;
      } else p.bedSpawn = undefined;
    }
    spawn = this.safeSpawn(spawn);
    p.position = spawn;
    p.velocity = { x: 0, y: 0, z: 0 };
    p.health = 20;
    p.hunger = 20;
    p.oxygen = 20;
    p.dead = false;
    this.fallDistance = 0;
    this.hurtCooldown = 2;
    this.toast("新的清晨，新的旅程。");
  }
  private safeSpawn(preferred: Vec3): Vec3 {
    const spawnWorld = { getBlock: this.world.getBlock.bind(this.world) };
    const safe = (p: Vec3) =>
      !intersectsWorld(spawnWorld, p) &&
      !this.fluidAt(p) &&
      !this.fluidAt({ ...p, y: p.y + 1.6 }) &&
      !!BLOCKS[
        this.world.getBlock(
          Math.floor(p.x),
          Math.floor(p.y - 0.1),
          Math.floor(p.z),
        )
      ]?.solid;
    if (safe(preferred)) return preferred;
    for (let radius = 0; radius <= 8; radius++)
      for (let dy = 0; dy <= 8; dy++)
        for (let dx = -radius; dx <= radius; dx++)
          for (let dz = -radius; dz <= radius; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
            const p = {
              x: Math.floor(preferred.x) + dx + 0.5,
              y: Math.floor(preferred.y) + dy + 0.05,
              z: Math.floor(preferred.z) + dz + 0.5,
            };
            if (safe(p)) return p;
          }
    for (
      let y = Math.max(WORLD_MIN_Y, Math.floor(preferred.y) + 1);
      y <= WORLD_MAX_Y + 1;
      y++
    ) {
      const p = { x: preferred.x, y: y + 0.05, z: preferred.z };
      if (
        !intersectsWorld(spawnWorld, p) &&
        !this.fluidAt(p) &&
        !this.fluidAt({ ...p, y: p.y + 1.6 })
      )
        return p;
    }
    return { ...preferred };
  }
  spawnDrop(stack: ItemStack, position: Vec3) {
    if (stack.count <= 0) return;
    this.drops.push({
      id: uid(),
      stack: clone(stack),
      position: {
        x: position.x + 0.16 * (Math.random() - 0.5),
        y: position.y + 0.35,
        z: position.z + 0.16 * (Math.random() - 0.5),
      },
      age: -0.65,
    });
  }
  /** XP remains separate from inventory and never consumes an item slot. */
  spawnExperience(value: number, position: Vec3) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_EXPERIENCE)
      return;
    const at = { x: position.x, y: position.y + 0.45, z: position.z };
    // Bound entity overhead by combining colocated orbs, retaining their total value.
    const candidates = this.progression.orbs.filter(
      (o) => o.value + value <= MAX_EXPERIENCE,
    );
    const nearby =
      candidates.find((o) => distance(o.position, at) < 1.5) ??
      (this.progression.orbs.length >= 4096
        ? candidates.reduce<ProgressionState["orbs"][number] | undefined>(
            (closest, orb) =>
              !closest ||
              distance(orb.position, at) < distance(closest.position, at)
                ? orb
                : closest,
            undefined,
          )
        : undefined);
    if (nearby) {
      nearby.value += value;
      nearby.age = Math.min(nearby.age, -0.5);
    } else if (this.progression.orbs.length < 4096)
      this.progression.orbs.push({ id: uid(), position: at, value, age: -0.5 });
    else this.toast("经验球已达到存档上限，新增经验未生成");
    this.dirty = true;
  }
  private updateExperience(dt: number) {
    const player = { ...this.player.position, y: this.player.position.y + 0.7 };
    this.progression.orbs = this.progression.orbs.filter((orb) => {
      if (!this.world.isReady(orb.position.x, orb.position.z, orb.position.y))
        return true;
      orb.age += dt;
      if (
        orb.age >= 300 ||
        orb.position.y < WORLD_MIN_Y - 64 ||
        this.fluidAt(orb.position)?.kind === "lava"
      )
        return false;
      const dist = distance(orb.position, player);
      if (!this.player.dead && orb.age >= 0 && dist < 1.3) {
        const collected = Math.min(
          orb.value,
          Math.floor(MAX_EXPERIENCE - this.progression.points),
        );
        this.progression.points += collected;
        orb.value -= collected;
        if (collected) this.sound("pickup");
        if (!orb.value) return false;
      }
      const attracted = !this.player.dead && orb.age >= 0 && dist < 8;
      const movement = attracted
        ? {
            x: (player.x - orb.position.x) * Math.min(1, dt * 3),
            y: (player.y - orb.position.y) * Math.min(1, dt * 3),
            z: (player.z - orb.position.z) * Math.min(1, dt * 3),
          }
        : { x: 0, y: -Math.min(dt * 3, 0.15), z: 0 };
      orb.position = moveBody(
        this.world,
        orb.position,
        movement,
        0.15,
        0.15,
      ).position;
      return true;
    });
  }
  private claimFurnaceExperience(
    container: ContainerState,
    position = this.player.position,
  ) {
    if (container.kind !== "furnace" || !container.experience) return;
    const points = rollFractionalExperience(container.experience, () =>
      this.farming.nextRandom(),
    );
    container.experience = 0;
    this.spawnExperience(points, position);
  }
  private updateDrops(dt: number) {
    this.drops = this.drops.filter((drop) => {
      if (
        !this.world.isReady(drop.position.x, drop.position.z, drop.position.y)
      )
        return true;
      if (this.fluidAt(drop.position)?.kind === "lava") return false;
      drop.age += dt;
      const groundY = Math.floor(drop.position.y - 0.2);
      const nextY = drop.position.y - Math.min(3 * dt, 0.15);
      if (
        this.world.isReady(drop.position.x, drop.position.z, groundY) &&
        this.world.isReady(drop.position.x, drop.position.z, nextY)
      ) {
        const ground = this.world.getBlock(
          Math.floor(drop.position.x),
          groundY,
          Math.floor(drop.position.z),
        );
        if (!BLOCKS[ground]?.solid && !isWater(ground)) drop.position.y = nextY;
      }
      if (
        !this.player.dead &&
        drop.age > 0 &&
        distance(drop.position, {
          ...this.player.position,
          y: this.player.position.y + 0.6,
        }) < 1.8
      ) {
        const remaining = addItem(this.player.inventory, drop.stack);
        if (!remaining) {
          this.sound("pickup");
          return false;
        }
        drop.stack = remaining;
      }
      return drop.age < 300 && drop.position.y > WORLD_MIN_Y - 64;
    });
  }
  dropSelected() {
    const s = this.held;
    if (!s) return;
    this.spawnDrop(
      { ...s, count: 1 },
      {
        x: this.player.position.x - Math.sin(this.player.yaw) * 1.2,
        y: this.player.position.y + 1,
        z: this.player.position.z - Math.cos(this.player.yaw) * 1.2,
      },
    );
    s.count--;
    if (!s.count) this.player.inventory[this.player.selected] = null;
  }
  private wearTool() {
    const held = this.held;
    if (this.creative || !held || !ITEMS[held.id]?.maxDurability) return;
    held.durability =
      (held.durability ?? ITEMS[held.id].maxDurability!) -
      durabilityConsumed(held, 1, () => this.farming.nextRandom());
    if (held.durability <= 0) {
      this.player.inventory[this.player.selected] = null;
      this.sound("break");
      this.toast("工具损坏了");
    }
  }
  mine(dt: number): boolean {
    if (this.held && ITEMS[this.held.id]?.firearm) {
      this.mining = 0;
      return false;
    }
    if (this.player.dead) return false;
    const target = this.target();
    if (!target) {
      this.mining = 0;
      this.miningKey = "";
      return false;
    }
    const def = BLOCKS[target.id];
    if (!def || isFluid(target.id) || (target.id === 24 && !this.creative))
      return false;
    const key = posKey(target.position);
    if (key !== this.miningKey) {
      this.miningKey = key;
      this.mining = 0;
    }
    const tool = this.held ? ITEMS[this.held.id] : null;
    const duration = this.creative
      ? 0.14
      : miningDuration(def, tool, this.held);
    const old = this.mining;
    this.mining = Math.min(1, this.mining + dt / duration);
    if (Math.floor(this.mining * 4) > Math.floor(old * 4)) this.sound("dig");
    if (this.mining >= 1) {
      this.breakBlock(target.position, target.id);
      this.mining = 0;
      this.miningKey = "";
      return true;
    }
    return false;
  }
  breakBlock(
    position: Vec3,
    id = this.world.getBlock(position.x, position.y, position.z),
    exploded = false,
    wear = true,
  ) {
    const blockX = Math.floor(position.x),
      blockY = Math.floor(position.y),
      blockZ = Math.floor(position.z);
    // Side effects must follow a successful authoritative edit, including explosion edges.
    if (
      !this.world.isReady(blockX, blockZ, blockY) ||
      this.world.getBlock(blockX, blockY, blockZ) !== id ||
      !BLOCKS[id]
    )
      return;
    const pairedZ = id === 22 ? blockZ + 1 : id === 27 ? blockZ - 1 : blockZ;
    const pairedY =
      id === 18 || id === 19
        ? blockY + 1
        : id === 25 || id === 26
          ? blockY - 1
          : blockY;
    if (!this.world.isReady(blockX, pairedZ, pairedY)) return;
    if (id === 0 || isFluid(id) || (id === 24 && (!this.creative || exploded)))
      return;
    const def = BLOCKS[id],
      tool = this.held ? ITEMS[this.held.id] : null;
    const eligible = canHarvest(def, tool);
    let drop = def?.drop;
    if (id === 3) drop = "cobblestone";
    if (id === 9) drop = "coal";
    if (id === 10) drop = "raw_iron";
    if (id === 17) drop = undefined;
    const p = {
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z),
    };
    this.setBlock(p.x, p.y, p.z, 0);
    if (this.world.getBlock(p.x, p.y, p.z) !== 0) return;
    delete this.composters[posKey(p)];
    if (id === 18 || id === 19) {
      this.setBlock(p.x, p.y + 1, p.z, 0);
      drop = "door";
    }
    if (id === 25 || id === 26) {
      this.setBlock(p.x, p.y - 1, p.z, 0);
      drop = "door";
    }
    if (id === 22) {
      this.setBlock(p.x, p.y, p.z + 1, 0);
      drop = "bed";
    }
    if (id === 27) {
      this.setBlock(p.x, p.y, p.z - 1, 0);
      drop = "bed";
    }
    const container = this.containers[posKey(p)];
    if (container) {
      this.claimFurnaceExperience(container, p);
      container.slots.forEach((s) => {
        if (s) this.spawnDrop(s, { x: p.x + 0.5, y: p.y + 0.1, z: p.z + 0.5 });
      });
      delete this.containers[posKey(p)];
    }
    const silk = !exploded && eligible ? silkTouchDrop(id, this.held) : null;
    if (!this.creative && silk) {
      this.spawnDrop(silk, p);
    } else if (!this.creative && cropAt(id)) {
      for (const stack of harvestCrop(id, () => this.farming.nextRandom()))
        this.spawnDrop(stack, { x: p.x + 0.5, y: p.y + 0.1, z: p.z + 0.5 });
    } else if (!this.creative && id === 58) {
      if (this.held?.id === "shears")
        this.spawnDrop({ id: "short_grass", count: 1 }, p);
      else if (this.farming.nextRandom() < 0.125)
        this.spawnDrop({ id: "wheat_seeds", count: 1 }, p);
    } else if (!this.creative && (id === 8 || id === 82)) {
      if (!exploded && this.held?.id === "shears")
        this.spawnDrop({ id: "leaves", count: 1 }, p);
      else {
        if (this.farming.nextRandom() < 0.05)
          this.spawnDrop({ id: "oak_sapling", count: 1 }, p);
        if (this.farming.nextRandom() < 0.02)
          this.spawnDrop({ id: "stick", count: 1 }, p);
        if (this.farming.nextRandom() < 0.005)
          this.spawnDrop({ id: "apple", count: 1 }, p);
      }
    } else if (drop && !this.creative && (exploded || eligible)) {
      const range = def.dropCount ?? [1, 1];
      const count =
        range[0] +
        (range[0] === range[1]
          ? 0
          : Math.floor(this.farming.nextRandom() * (range[1] - range[0] + 1)));
      this.spawnDrop(
        {
          id: drop,
          ...(container?.customName
            ? { customName: container.customName }
            : {}),
          count: exploded
            ? count
            : fortuneDropCount(id, count, this.held, () =>
                this.farming.nextRandom(),
              ),
        },
        { x: p.x + 0.5, y: p.y + 0.1, z: p.z + 0.5 },
      );
    }
    if (!exploded) {
      if (!this.creative && eligible)
        this.spawnExperience(
          miningExperience(id, !!silk, () => this.farming.nextRandom()),
          p,
        );
      if (wear) this.wearTool();
      this.exhaustion += 0.025;
      this.sound("break");
    }
    this.dirty = true;
  }
  equipRifle(): boolean {
    if (this.player.dead) return false;
    const slots = this.player.inventory;
    let index = slots.findIndex((slot) => slot?.id === "rifle");
    if (index < 0) {
      index = slots.findIndex((slot) => !slot);
      if (index < 0) {
        this.toast("背包已满，请先腾出一个位置领取步枪");
        return false;
      }
      slots[index] = { id: "rifle", count: 1 };
    }
    if (index > 8) {
      [slots[this.player.selected], slots[index]] = [
        slots[index],
        slots[this.player.selected],
      ];
    } else this.player.selected = index;
    this.mining = 0;
    this.dirty = true;
    this.sound("equip");
    this.toast("海岸步枪已装备 · 无限弹药 · 按住左键连射");
    return true;
  }
  attack(): boolean {
    if (this.attackCooldown > 0 || this.player.dead) return false;
    const eye = this.eye(),
      dir = this.direction();
    const firearm = !!(this.held && ITEMS[this.held.id]?.firearm);
    const shot = firearm
      ? traceRifle(this.world, this.entities, eye, dir)
      : null;
    const wall = firearm
      ? null
      : raycastVoxel(this.world, eye, dir, 3.2, false, true);
    let victim: EntityState | undefined = shot?.victim;
    let nearest = 3.2;
    for (const e of firearm ? [] : this.entities) {
      const center = {
        ...e.position,
        y: e.position.y + (ENTITIES[e.kind].hostile ? 0.9 : 0.55),
      };
      const dx = center.x - eye.x,
        dy = center.y - eye.y,
        dz = center.z - eye.z;
      const along = dx * dir.x + dy * dir.y + dz * dir.z;
      const side = Math.hypot(
        dx - along * dir.x,
        dy - along * dir.y,
        dz - along * dir.z,
      );
      if (
        along > 0 &&
        along < nearest &&
        side < 0.75 &&
        (!wall || along < wall.distance)
      ) {
        victim = e;
        nearest = along;
      }
    }
    if (shot) {
      this.attackCooldown = RIFLE.interval;
      this.mining = 0;
      this.emit({ type: "shot", sound: "shot", end: shot.end, hit: !!victim });
    }
    if (!victim) return firearm;
    this.attackCooldown = firearm ? RIFLE.interval : 0.5;
    victim.health -=
      (this.held ? (ITEMS[this.held.id]?.damage ?? 2) : 1) +
      sharpnessBonus(this.held);
    victim.playerHitTimer = 5;
    if (!firearm) this.wearTool();
    this.dirty = true;
    this.sound("hit");
    const knock = moveBody(
      this.world,
      victim.position,
      { x: dir.x * 0.5, y: 0.08, z: dir.z * 0.5 },
      0.65,
      1.2,
    );
    victim.position = knock.position;
    if (victim.health <= 0) {
      this.spawnExperience(
        mobExperience(victim.kind, (victim.age ?? 0) < 0, () =>
          this.farming.nextRandom(),
        ),
        victim.position,
      );
      if (victim.kind === "cow" && (victim.age ?? 0) >= 0) {
        for (const [id, range] of Object.entries(COW_DROP_RANGES)) {
          const count =
            range[0] +
            Math.floor(this.farming.nextRandom() * (range[1] - range[0] + 1));
          if (count) this.spawnDrop({ id, count }, victim.position);
        }
      } else if ((victim.age ?? 0) >= 0)
        ENTITIES[victim.kind].drops.forEach((s) => {
          if (s.id !== "wool" || !victim!.sheared)
            this.spawnDrop(s, victim!.position);
        });
      // Adult zombies provide the survival route to the two root crops.
      if (victim.kind === "zombie" && this.farming.nextRandom() < 0.025) {
        const rare = ["iron_ingot", "carrot", "potato"][
          Math.floor(this.farming.nextRandom() * 3)
        ];
        this.spawnDrop({ id: rare, count: 1 }, victim.position);
      }
      this.entities = this.entities.filter((e) => e.id !== victim!.id);
      this.entityVel.delete(victim.id);
    }
    return true;
  }
  interact() {
    if (this.player.dead) return;
    const held = this.held,
      def = held ? ITEMS[held.id] : null;
    const target = this.target();
    if (held && this.interactAnimal(held.id)) return;
    if (held?.id === "bucket") {
      this.interactFarm(held.id, null);
      return;
    }
    if (
      target &&
      !this.world.isReady(
        target.position.x,
        target.position.z,
        target.position.y,
      )
    ) {
      this.toast("请等待目标地形加载完成");
      return;
    }
    if (target && this.interactComposter(target)) return;
    if (held && this.interactFarm(held.id, target)) return;
    if (def?.food && !this.creative) {
      if (this.player.hunger >= 20) {
        this.toast("现在还不饿");
        return;
      }
      if (!this.foodTimer) {
        this.foodTimer = 1.6;
        this.foodPending = { id: held!.id, index: this.player.selected };
        this.sound("eat");
        this.toast("正在进食…");
      }
      return;
    }
    if (!target) {
      if (def?.armorSlot) this.equipHeld(def.armorSlot);
      return;
    }
    const t = target.position,
      id = target.id;
    if (id === 13) {
      this.startCraft("workbench");
      this.onOpen?.("workbench");
      return;
    }
    if (id === 112) {
      this.closeContainer();
      this.station = "enchanting";
      this.enchantingPosition = { ...t };
      this.craftSlots = [null, null];
      this.onOpen?.("enchanting");
      return;
    }
    const workshop = workshopBlockState(id);
    if (workshop) {
      this.closeContainer();
      this.station = workshop.kind;
      this.workshopPosition = { ...t };
      this.craftSlots = [null, null];
      this.onOpen?.(workshop.kind);
      return;
    }
    if (id === 14 || id === 15) {
      this.closeContainer();
      this.containerKey = posKey(t);
      if (!this.containers[this.containerKey])
        this.containers[this.containerKey] =
          id === 15
            ? { kind: "chest", slots: Array(27).fill(null) }
            : {
                kind: "furnace",
                slots: Array(3).fill(null),
                burn: 0,
                burnTotal: 0,
                progress: 0,
              };
      this.onOpen?.(id === 15 ? "chest" : "furnace");
      return;
    }
    if ([18, 19, 25, 26].includes(id)) {
      const y = t.y - (id === 25 || id === 26 ? 1 : 0),
        open = id === 18 || id === 25;
      if (
        y < WORLD_MIN_Y ||
        y + 1 > WORLD_MAX_Y ||
        !this.world.isReady(t.x, t.z, y) ||
        !this.world.isReady(t.x, t.z, y + 1)
      ) {
        this.toast("请等待整扇门的地形加载完成");
        return;
      }
      const bottom = this.world.getBlock(t.x, y, t.z);
      const top = this.world.getBlock(t.x, y + 1, t.z);
      if (![18, 19].includes(bottom) || ![25, 26].includes(top)) return;
      if (!this.setBlock(t.x, y, t.z, open ? 19 : 18)) return;
      if (!this.setBlock(t.x, y + 1, t.z, open ? 26 : 25)) {
        this.setBlock(t.x, y, t.z, bottom);
        return;
      }
      this.sound("door");
      return;
    }
    if (id === 22 || id === 27) {
      this.sleep({ ...t, z: t.z - (id === 27 ? 1 : 0) });
      return;
    }
    if (def?.armorSlot) {
      this.equipHeld(def.armorSlot);
      return;
    }
    if (!held || def?.block === undefined) {
      this.toast("选择一个方块，就可以开始建造");
      return;
    }
    const p =
      id === 58 || id === 83 || cropAt(id)
        ? { ...t }
        : {
            x: t.x + target.normal.x,
            y: t.y + target.normal.y,
            z: t.z + target.normal.z,
          };
    if (
      p.y < WORLD_MIN_Y ||
      p.y > WORLD_MAX_Y ||
      !this.world.isReady(p.x, p.z, p.y)
    )
      return;
    const replaceable = (id: number) =>
      [0, 58, 83].includes(id) || isFluid(id) || !!cropAt(id);
    let placedId = def.block;
    const hitY =
      this.eye().y + Math.sin(this.player.pitch) * target.distance - t.y;
    if (def.block === 132) {
      const mergeTarget =
        (id === 132 &&
          (target.normal.y > 0 || (!target.normal.y && hitY >= 0.5))) ||
        (id === 133 &&
          (target.normal.y < 0 || (!target.normal.y && hitY < 0.5)));
      if (mergeTarget) Object.assign(p, t);
      const existing = this.world.getBlock(p.x, p.y, p.z);
      placedId =
        existing === 132 || existing === 133
          ? 134
          : target.normal.y < 0 || (!target.normal.y && hitY > 0.5)
            ? 133
            : 132;
    }
    if (!replaceable(this.world.getBlock(p.x, p.y, p.z)) && placedId !== 134)
      return;
    const facing =
      (((2 - Math.round(this.player.yaw / (Math.PI / 2))) % 4) + 4) % 4;
    if (def.block >= 114 && def.block <= 119)
      placedId =
        114 +
        Math.floor((def.block - 114) / 2) * 2 +
        (facing % 2 === 0 ? 1 : 0);
    if (def.block === 120) {
      const attachment =
        target.normal.y > 0
          ? "floor"
          : target.normal.y < 0
            ? "ceiling"
            : "wall";
      const wallFacing =
        target.normal.z < 0
          ? 0
          : target.normal.x > 0
            ? 1
            : target.normal.z > 0
              ? 2
              : 3;
      placedId = grindstoneBlockId(
        attachment,
        attachment === "wall" ? wallFacing : facing,
      );
    }
    if (def.block === 111 && !this.sugarCane.canPlace(p)) {
      this.toast("甘蔗需种在水边的草地、泥土或沙上，最高三格");
      return;
    }
    const boxes = [p];
    if (def.block === 18) boxes.push({ x: p.x, y: p.y + 1, z: p.z });
    if (def.block === 22) boxes.push({ x: p.x, y: p.y, z: p.z + 1 });
    for (const b of boxes) {
      if (b.y < WORLD_MIN_Y || b.y > WORLD_MAX_Y) {
        this.toast("这里超出了可建造高度");
        return;
      }
      if (!this.world.isReady(b.x, b.z, b.y)) {
        this.toast("请等待相邻地形加载完成");
        return;
      }
      if (
        !replaceable(this.world.getBlock(b.x, b.y, b.z)) &&
        placedId !== 134
      ) {
        this.toast("这里没有足够的空间");
        return;
      }
      const a = this.player.position;
      if (
        b.x + 1 > a.x - 0.3 &&
        b.x < a.x + 0.3 &&
        b.y + 1 > a.y &&
        b.y < a.y + 1.8 &&
        b.z + 1 > a.z - 0.3 &&
        b.z < a.z + 0.3
      ) {
        this.toast("不能把方块放在自己身上");
        return;
      }
    }
    if (
      (def.block === 18 || def.block === 22) &&
      !BLOCKS[this.world.getBlock(p.x, p.y - 1, p.z)]?.solid
    ) {
      this.toast("需要放在稳固地面上");
      return;
    }
    if (
      def.block === 22 &&
      !BLOCKS[this.world.getBlock(p.x, p.y - 1, p.z + 1)]?.solid
    ) {
      this.toast("床的两端都需要地面支撑");
      return;
    }
    if (
      def.block === 83 &&
      ![1, 2].includes(this.world.getBlock(p.x, p.y - 1, p.z))
    ) {
      this.toast("树苗需要种在泥土或草方块上");
      return;
    }
    for (const b of boxes) {
      const old = this.world.getBlock(b.x, b.y, b.z);
      if (old === 58 || old === 83 || cropAt(old)) this.breakBlock(b, old);
    }
    if (!this.setBlock(p.x, p.y, p.z, placedId)) return;
    if (held.customName && (def.block === 14 || def.block === 15))
      this.containers[posKey(p)] =
        def.block === 15
          ? {
              kind: "chest",
              slots: Array(27).fill(null),
              customName: held.customName,
            }
          : {
              kind: "furnace",
              slots: [null, null, null],
              burn: 0,
              burnTotal: 0,
              progress: 0,
              customName: held.customName,
            };
    if (def.block === 18) this.setBlock(p.x, p.y + 1, p.z, 25);
    if (def.block === 22) this.setBlock(p.x, p.y, p.z + 1, 27);
    if (!this.creative) {
      held.count--;
      if (!held.count) this.player.inventory[this.player.selected] = null;
    }
    this.sound("place");
    this.dirty = true;
  }
  private useHeld(remainder?: string) {
    if (this.creative || !this.held) return;
    const slot = this.player.selected;
    this.held.count--;
    if (!this.held.count)
      this.player.inventory[slot] = remainder
        ? { id: remainder, count: 1 }
        : null;
    else if (remainder) {
      const left = addItem(this.player.inventory, { id: remainder, count: 1 });
      if (left) this.spawnDrop(left, this.player.position);
    }
  }
  private interactComposter(
    target: NonNullable<ReturnType<Simulation["target"]>>,
  ): boolean {
    if (target.id < 59 || target.id > 67) return false;
    const p = target.position;
    if (target.id === 67) {
      this.setBlock(p.x, p.y, p.z, 59);
      if (this.world.getBlock(p.x, p.y, p.z) !== 59) return true;
      this.spawnDrop(
        { id: "bone_meal", count: 1 },
        { x: p.x + 0.5, y: p.y + 0.7, z: p.z + 0.5 },
      );
      this.sound("pickup");
      this.toast("收取了骨粉，可以用来催熟作物或让草地长出草丛");
    } else if (target.id === 66) this.toast("堆肥正在熟成…");
    else {
      const chance: Record<string, number> = {
        wheat_seeds: 0.3,
        beetroot_seeds: 0.3,
        leaves: 0.3,
        oak_sapling: 0.3,
        short_grass: 0.3,
        wheat: 0.65,
        carrot: 0.65,
        potato: 0.65,
        beetroot: 0.65,
        bread: 0.85,
        baked_potato: 0.85,
      };
      const probability = this.held ? chance[this.held.id] : 0;
      if (!probability) {
        this.toast("放入种子、树叶或作物，装满后可获得骨粉");
        return true;
      }
      this.useHeld();
      if (target.id === 59 || this.farming.nextRandom() < probability) {
        this.setBlock(p.x, p.y, p.z, target.id + 1);
        if (target.id + 1 === 66) this.composters[posKey(p)] = 1;
        this.toast(`堆肥进度 ${target.id - 58}/7`);
      } else this.toast("加入了材料，这次没有增加堆肥层");
      this.sound("place");
    }
    return true;
  }
  private interactFarm(
    item: string,
    target: ReturnType<Simulation["target"]>,
  ): boolean {
    if (item === "bucket") {
      const water = raycastVoxel(
        this.world,
        this.eye(),
        this.direction(),
        this.creative ? 6 : 4.5,
        true,
      );
      if (
        water &&
        (water.id === 6 || water.id === 76) &&
        this.world.isReady(water.position.x, water.position.z, water.position.y)
      ) {
        if (
          !this.setBlock(
            water.position.x,
            water.position.y,
            water.position.z,
            0,
          )
        )
          return true;
        this.useHeld(water.id === 6 ? "water_bucket" : "lava_bucket");
        this.sound("place");
        this.toast(water.id === 6 ? "装了一桶水" : "装了一桶熔岩");
      } else this.toast("对着水源或熔岩源使用铁桶");
      return true;
    }
    if (!target) return false;
    const p = target.position,
      id = target.id;
    if (ITEMS[item]?.tool === "hoe" && (id === 1 || id === 2)) {
      if ((id === 1 || id === 2) && target.normal.y >= 0) {
        const above = this.world.getBlock(p.x, p.y + 1, p.z);
        if (above === 0 || above === 58) {
          if (above === 58)
            this.breakBlock({ ...p, y: p.y + 1 }, above, false, false);
          this.setBlock(p.x, p.y, p.z, FARMLAND.dry);
          this.wearTool();
          this.sound("dig");
          this.toast("翻好了耕地。附近的水可以保持湿润");
        } else this.toast("耕地上方需要留空");
      }
      return true;
    }
    const crop = Object.values(CROP_DEFINITIONS).find(
      (c) => c.seedItem === item,
    );
    if (
      crop &&
      (id === FARMLAND.dry || id === FARMLAND.wet) &&
      target.normal.y === 1
    ) {
      if (p.y < WORLD_MAX_Y && this.world.getBlock(p.x, p.y + 1, p.z) === 0) {
        this.setBlock(p.x, p.y + 1, p.z, crop.firstId);
        if (this.world.getBlock(p.x, p.y + 1, p.z) !== crop.firstId)
          return true;
        this.useHeld();
        this.sound("place");
        this.toast("种下了作物，保持水分和光照，等待它成熟");
      } else this.toast("耕地上方已经有东西了");
      return true;
    }
    if (item === "bone_meal" && id === 83) {
      if (this.natural.fertilize(p, this.night ? 4 : 15)) {
        this.useHeld();
        this.sound("place");
      } else this.toast("树苗需要充足光照和生长空间");
      return true;
    }
    if (item === "bone_meal" && (id === 1 || cropAt(id))) {
      if (this.farming.fertilize(p)) {
        this.useHeld();
        this.sound("place");
        this.toast("作物长大了一些");
      } else if (id === 1) {
        let planted = 0;
        // Natural, repeatable seed route also available in generator-1 worlds.
        for (let i = 0; i < 32; i++) {
          const x = p.x + Math.floor(this.farming.nextRandom() * 7) - 3;
          const z = p.z + Math.floor(this.farming.nextRandom() * 7) - 3;
          const y = p.y;
          if (
            this.world.isReady(x, z, y) &&
            y < WORLD_MAX_Y &&
            this.world.isReady(x, z, y + 1) &&
            this.world.getBlock(x, y, z) === 1 &&
            this.world.getBlock(x, y + 1, z) === 0
          ) {
            if (this.setBlock(x, y + 1, z, 58)) planted++;
          }
        }
        if (planted) {
          this.useHeld();
          this.sound("place");
          this.toast("草地上长出了新的草丛");
        }
      }
      return true;
    }
    if (item === "water_bucket" || item === "lava_bucket") {
      const at = {
        x: p.x + target.normal.x,
        y: p.y + target.normal.y,
        z: p.z + target.normal.z,
      };
      const old = this.world.getBlock(at.x, at.y, at.z);
      if (
        at.y >= WORLD_MIN_Y &&
        at.y <= WORLD_MAX_Y &&
        this.world.isReady(at.x, at.z, at.y) &&
        (old === 0 ||
          old === 58 ||
          old === 83 ||
          old === 111 ||
          isFluid(old) ||
          !!cropAt(old))
      ) {
        if (old && !isFluid(old)) this.breakBlock(at, old);
        const lava = item === "lava_bucket";
        const placed =
          lava && isWater(old)
            ? 3
            : !lava && isLava(old)
              ? old === 76
                ? 81
                : 12
              : lava
                ? 76
                : 6;
        if (!this.setBlock(at.x, at.y, at.z, placed)) return true;
        this.useHeld("bucket");
        this.sound("place");
      }
      return true;
    }
    return false;
  }
  private animalFood(kind: EntityKind, item: string) {
    return kind === "sheep" || kind === "cow"
      ? item === "wheat"
      : kind === "pig" && ["carrot", "potato", "beetroot"].includes(item);
  }
  private interactAnimal(item: string): boolean {
    const eye = this.eye(),
      dir = this.direction(),
      wall = raycastVoxel(this.world, eye, dir, 3.2, false, true);
    const max = wall ? Math.min(3.2, wall.distance) : 3.2;
    const animal = this.entities
      .filter(
        (e) =>
          !ENTITIES[e.kind].hostile &&
          e.health > 0 &&
          this.world.isReady(e.position.x, e.position.z, e.position.y),
      )
      .map((e) => {
        const height = (e.age ?? 0) < 0 ? 0.28 : 0.55;
        const dx = e.position.x - eye.x,
          dy = e.position.y + height - eye.y,
          dz = e.position.z - eye.z;
        const along = dx * dir.x + dy * dir.y + dz * dir.z;
        const side = Math.hypot(
          dx - dir.x * along,
          dy - dir.y * along,
          dz - dir.z * along,
        );
        return { e, along, side, height };
      })
      .filter(
        ({ along, side, height }) =>
          along > 0 && along < max && side < height + 0.12,
      )
      .sort((a, b) => a.along - b.along)[0]?.e;
    if (!animal) return false;
    if (item === "shears" && animal.kind === "sheep") {
      if (animal.sheared || (animal.age ?? 0) < 0) {
        this.toast("幼羊或刚剪过毛的羊现在不能剪毛");
        return true;
      }
      animal.sheared = true;
      animal.woolTimer = 0;
      this.spawnDrop(
        { id: "wool", count: 1 + Math.floor(this.farming.nextRandom() * 3) },
        animal.position,
      );
      this.wearTool();
      this.sound("dig");
      this.toast("剪下了羊毛，羊吃草后会重新长毛");
      return true;
    }
    if (!this.animalFood(animal.kind, item)) return false;
    if ((animal.age ?? 0) < 0) {
      animal.age = Math.min(0, animal.age! + Math.max(1, -animal.age! * 0.1));
      this.useHeld();
      this.sound("eat");
      this.toast("幼崽吃饱了，长大得更快");
    } else if ((animal.breedCooldown ?? 0) > 0 || (animal.love ?? 0) > 0)
      this.toast("它暂时不想再吃，等一会儿吧");
    else {
      animal.love = 60;
      animal.courtship = 0;
      this.useHeld();
      this.sound("eat");
      this.toast("它正在寻找同类伙伴，再喂一只成年动物吧");
    }
    return true;
  }
  private sleep(bed: Vec3) {
    this.player.bedSpawn = { ...bed };
    if (!this.night) {
      this.toast("已设置重生点。夜晚可以在这里休息。");
      return;
    }
    if (
      this.entities.some(
        (e) => ENTITIES[e.kind].hostile && distance(e.position, bed) < 8,
      )
    ) {
      this.toast("附近有怪物，现在无法入睡");
      return;
    }
    this.time = 1000;
    this.player.health = Math.min(20, this.player.health + 4);
    this.sound("sleep");
    this.toast("睡到天亮。又是充满可能的一天。");
  }
  startCraft(station: "inventory" | "workbench") {
    this.closeContainer();
    this.station = station;
    this.craftSlots = Array(station === "workbench" ? 9 : 4).fill(null);
  }
  closeContainer() {
    const returnStack = (s: Slot) => {
      if (s) {
        const left = addItem(this.player.inventory, s);
        if (left) this.spawnDrop(left, this.player.position);
      }
    };
    this.craftSlots.forEach(returnStack);
    returnStack(this.cursor);
    this.cursor = null;
    this.craftSlots = Array(4).fill(null);
    this.station = "inventory";
    this.enchantingPosition = null;
    this.workshopPosition = null;
    this.workshopName = "";
    this.workshopInput = null;
    this.containerKey = null;
  }
  get container() {
    return this.containerKey
      ? (this.containers[this.containerKey] ?? null)
      : null;
  }
  get craftOutput() {
    if (this.station !== "inventory" && this.station !== "workbench")
      return null;
    return (
      matchRecipe(this.craftSlots, this.station === "workbench" ? 3 : 2)
        ?.output ?? null
    );
  }
  takeCraftOutput() {
    const output = this.craftOutput;
    if (!output) return;
    const max = ITEMS[output.id].maxStack;
    if (
      this.cursor &&
      (!compatibleStacks(this.cursor, output) ||
        this.cursor.count + output.count > max)
    )
      return;
    const result = consumeRecipe(
      this.craftSlots,
      this.station === "workbench" ? 3 : 2,
    );
    if (!result) return;
    if (this.cursor) this.cursor.count += result.count;
    else this.cursor = clone(result);
    this.sound("craft");
  }
  craft(recipeId: string) {
    if (this.station !== "inventory" && this.station !== "workbench") return;
    const recipe = RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return;
    if (recipe.station === "workbench" && this.station !== "workbench") {
      this.toast("这个配方需要工作台");
      return;
    }
    if (craftFromInventory(recipe, this.player.inventory)) {
      this.sound("craft");
      this.toast(`制作了 ${ITEMS[recipe.output.id]?.name ?? recipe.name}`);
    } else this.toast("材料不足，或背包没有足够空间");
  }
  getEnchanting(): EnchantingView | null {
    const at = this.enchantingPosition;
    if (
      this.station !== "enchanting" ||
      !at ||
      this.player.dead ||
      distance(this.eye(), { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 }) >
        6 ||
      !this.world.isReady(at.x, at.z, at.y) ||
      this.world.getBlock(at.x, at.y, at.z) !== 112
    )
      return null;
    const bookshelves = countBookshelves(this.world, at);
    const status = experienceStatus(this.progression.points);
    return {
      bookshelves,
      level: status.level,
      progress: status.progress,
      offers: getEnchantingOffers(
        this.craftSlots[0],
        bookshelves,
        this.progression.enchantmentSeed,
        this.creative ? MAX_EXPERIENCE : this.progression.points,
        this.creative
          ? 3
          : this.craftSlots[1]?.id === "lapis_lazuli"
            ? this.craftSlots[1].count
            : 0,
      ).map((offer) =>
        this.creative ? { ...offer, levelCost: 0, lapisCost: 0 } : offer,
      ),
    };
  }
  enchant(option: 0 | 1 | 2) {
    const view = this.getEnchanting(),
      stack = this.craftSlots[0],
      lapis = this.craftSlots[1];
    if (
      !view ||
      !stack ||
      stack.count !== 1 ||
      (!this.creative && lapis?.id !== "lapis_lazuli")
    )
      return;
    const result = applyEnchantment(
      stack,
      view.bookshelves,
      this.progression.enchantmentSeed,
      this.creative ? MAX_EXPERIENCE : this.progression.points,
      this.creative ? 3 : lapis!.count,
      option,
    );
    if (!result) {
      this.toast("附魔条件不足，物品和经验未消耗");
      return;
    }
    this.craftSlots[0] = clone(result.stack);
    if (!this.creative) {
      lapis!.count -= result.lapisCost;
      if (!lapis!.count) this.craftSlots[1] = null;
      this.progression.points = result.points;
    }
    this.progression.enchantmentSeed = result.seed;
    this.dirty = true;
    this.sound("craft");
    this.toast("附魔完成，新的力量已注入装备");
  }
  getWorkshop(): WorkshopView | null {
    const at = this.workshopPosition;
    if (
      !at ||
      !["anvil", "grindstone"].includes(this.station) ||
      this.player.dead ||
      distance(this.eye(), { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 }) >
        6 ||
      !this.world.isReady(at.x, at.z, at.y) ||
      workshopBlockState(this.world.getBlock(at.x, at.y, at.z))?.kind !==
        this.station
    )
      return null;
    const left = this.craftSlots[0],
      right = this.craftSlots[1];
    if (left !== this.workshopInput) {
      this.workshopInput = left;
      this.workshopName = left ? (left.customName ?? ITEMS[left.id].name) : "";
    }
    return this.station === "anvil"
      ? getAnvilResult(
          left,
          right,
          this.workshopName,
          this.progression.points,
          this.creative,
        )
      : getGrindstoneResult(left, right);
  }
  setWorkshopName(name: string) {
    if (this.station !== "anvil" || !this.getWorkshop()) return;
    const normalized = normalizeItemName(name);
    if (normalized !== null) this.workshopName = normalized;
  }
  takeWorkshopOutput(shift = false) {
    const view = this.getWorkshop();
    if (!view?.available || !view.output) return;
    const output = clone(view.output);
    let inventory: Slot[] | null = null;
    if (shift) {
      inventory = clone(this.player.inventory);
      if (addItem(inventory, output)) {
        this.toast("背包已满，先腾出空间");
        return;
      }
    } else if (
      this.cursor &&
      (!compatibleStacks(this.cursor, output) ||
        this.cursor.count + output.count > ITEMS[output.id].maxStack)
    )
      return;
    const points =
      view.kind === "anvil" && !this.creative
        ? spendLevels(this.progression.points, view.levelCost)
        : this.progression.points;
    if (points === null) return;
    // Commit once only after station, payment and destination have all been checked.
    this.craftSlots[0] = null;
    const right = this.craftSlots[1];
    if (right) {
      right.count -= view.materialCost;
      if (right.count <= 0) this.craftSlots[1] = null;
    }
    if (inventory) this.player.inventory = inventory;
    else if (this.cursor) this.cursor.count += output.count;
    else this.cursor = output;
    this.progression.points = points;
    if (view.kind === "grindstone" && view.experienceMax > 0)
      this.spawnExperience(
        view.experienceMin +
          Math.floor(
            this.farming.nextRandom() *
              (view.experienceMax - view.experienceMin + 1),
          ),
        this.player.position,
      );
    if (
      view.kind === "anvil" &&
      !this.creative &&
      this.farming.nextRandom() < 0.12
    ) {
      const at = this.workshopPosition!;
      const id = this.world.getBlock(at.x, at.y, at.z);
      this.setBlock(at.x, at.y, at.z, id < 118 ? id + 2 : 0);
      if (id >= 118) this.toast("铁砧已经损坏，成品已取出");
    }
    this.workshopInput = null;
    this.workshopName = "";
    this.dirty = true;
    this.sound("craft");
  }
  clickSlot(
    source: "inventory" | "craft" | "container" | "armor",
    index: number | string,
    right = false,
    shift = false,
  ) {
    if (source === "armor") {
      const key =
        typeof index === "number" ? armorKeys[index] : (index as ArmorSlot);
      if (!armorKeys.includes(key)) return;
      if (this.cursor && ITEMS[this.cursor.id]?.armorSlot !== key) return;
      const prev = this.player.armor[key];
      this.player.armor[key] = this.cursor;
      this.cursor = prev;
      return;
    }
    const slots =
      source === "inventory"
        ? this.player.inventory
        : source === "craft"
          ? this.craftSlots
          : this.container?.slots;
    const i = Number(index);
    if (!slots || !Number.isInteger(i) || i < 0 || i >= slots.length) return;
    if (
      source === "craft" &&
      this.station === "enchanting" &&
      this.cursor &&
      (i === 1
        ? this.cursor.id !== "lapis_lazuli"
        : enchantability(this.cursor.id) <= 0 ||
          (this.cursor.count !== 1 && !right) ||
          (!!slots[i] && compatibleStacks(slots[i]!, this.cursor)))
    )
      return;
    if (
      source === "craft" &&
      this.station === "grindstone" &&
      this.cursor &&
      ((!ITEMS[this.cursor.id]?.maxDurability && !this.cursor.enchantments) ||
        (this.cursor.count !== 1 && !right) ||
        (!!slots[i] && compatibleStacks(slots[i]!, this.cursor)))
    )
      return;
    if (source === "container" && this.container?.kind === "furnace") {
      if (i === 2 && this.cursor) {
        if (
          slots[2] &&
          compatibleStacks(slots[2], this.cursor) &&
          this.cursor.count + slots[2]!.count <= ITEMS[this.cursor.id].maxStack
        ) {
          this.cursor.count += slots[2]!.count;
          slots[2] = null;
          this.claimFurnaceExperience(this.container);
        }
        return;
      }
      if (i === 1 && this.cursor && !ITEMS[this.cursor.id]?.fuel) return;
      if (i === 0 && this.cursor && !SMELTING[this.cursor.id]) return;
    }
    if (shift && !this.cursor) {
      const stack = slots[i];
      if (!stack) return;
      if (source === "inventory") {
        const item = ITEMS[stack.id];
        if (this.station === "enchanting") {
          const dest =
            stack.id === "lapis_lazuli"
              ? 1
              : enchantability(stack.id) > 0
                ? 0
                : -1;
          if (dest < 0) return;
          const subset = [this.craftSlots[dest]];
          if (dest === 0) {
            if (subset[0]) return;
            subset[0] = { ...clone(stack), count: 1 };
            stack.count--;
            if (!stack.count) slots[i] = null;
          } else slots[i] = addItem(subset, stack);
          this.craftSlots[dest] = subset[0];
          this.dirty = true;
          return;
        }
        if (this.station === "anvil" || this.station === "grindstone") {
          const dest = this.craftSlots[0] ? 1 : 0;
          if (this.craftSlots[dest]) return;
          if (
            this.station === "grindstone" &&
            !item.maxDurability &&
            !stack.enchantments
          )
            return;
          const moved = this.station === "grindstone" ? 1 : stack.count;
          this.craftSlots[dest] = { ...clone(stack), count: moved };
          stack.count -= moved;
          if (!stack.count) slots[i] = null;
          this.dirty = true;
          return;
        }
        if (item.armorSlot && !this.player.armor[item.armorSlot]) {
          this.player.armor[item.armorSlot] = stack;
          slots[i] = null;
          return;
        }
        if (this.container) {
          if (this.container.kind === "chest")
            slots[i] = addItem(this.container.slots, stack);
          else {
            const dest = SMELTING[stack.id] ? 0 : item.fuel ? 1 : -1;
            if (dest < 0) return;
            const subset = [this.container.slots[dest]];
            slots[i] = addItem(subset, stack);
            this.container.slots[dest] = subset[0];
          }
        } else {
          const start = i < 9 ? 9 : 0,
            end = i < 9 ? 36 : 9;
          const subset = slots.slice(start, end);
          const leftover = addItem(subset, stack);
          for (let j = start; j < end; j++) slots[j] = subset[j - start];
          slots[i] = leftover;
        }
      } else {
        const before = stack.count;
        slots[i] = addItem(this.player.inventory, stack);
        if (
          source === "container" &&
          i === 2 &&
          this.container?.kind === "furnace" &&
          (slots[i]?.count ?? 0) < before
        )
          this.claimFurnaceExperience(this.container);
      }
      return;
    }
    const before = slots[i]?.count ?? 0;
    this.cursor = clickInventorySlot(slots, i, this.cursor, right);
    if (
      source === "container" &&
      i === 2 &&
      this.container?.kind === "furnace" &&
      (slots[i]?.count ?? 0) < before
    )
      this.claimFurnaceExperience(this.container);
    this.dirty = true;
  }
  private equipHeld(slot: ArmorSlot) {
    const old = this.player.armor[slot];
    this.player.armor[slot] = this.held;
    this.player.inventory[this.player.selected] = old;
    this.sound("equip");
  }
  giveItem(id: string, enchantment?: string) {
    if (!this.creative || !ITEMS[id]) return;
    const item = ITEMS[id];
    this.player.inventory[this.player.selected] = {
      id,
      count: item.maxStack,
      ...(item.maxDurability ? { durability: item.maxDurability } : {}),
      ...(id === "enchanted_book"
        ? {
            enchantments: {
              [enchantment && Object.hasOwn(ENCHANTMENTS, enchantment)
                ? enchantment
                : "unbreaking"]:
                ENCHANTMENTS[
                  (enchantment && Object.hasOwn(ENCHANTMENTS, enchantment)
                    ? enchantment
                    : "unbreaking") as keyof typeof ENCHANTMENTS
                ].maxLevel,
            },
          }
        : {}),
    };
    this.sound("pickup");
  }
  private updateFurnaces(dt: number) {
    for (const [key, container] of Object.entries(this.containers)) {
      if (container.kind !== "furnace") continue;
      const [x, y, z] = key.split(",").map(Number);
      if (!this.world.isReady(x, z, y)) continue;
      const input = container.slots[0],
        fuel = container.slots[1],
        output = container.slots[2];
      const recipe = input ? SMELTING[input.id] : null;
      const room =
        recipe &&
        (!output ||
          (compatibleStacks(output, {
            id: recipe.output,
            count: recipe.count,
          }) &&
            output.count + recipe.count <= ITEMS[recipe.output].maxStack));
      container.burn = Math.max(0, container.burn - dt);
      if (
        recipe &&
        room &&
        container.burn <= 0 &&
        fuel &&
        ITEMS[fuel.id]?.fuel
      ) {
        container.burn = ITEMS[fuel.id].fuel!;
        container.burnTotal = container.burn;
        const remainder = ITEMS[fuel.id].fuelRemainder;
        fuel.count--;
        if (!fuel.count)
          container.slots[1] = remainder ? { id: remainder, count: 1 } : null;
      }
      if (recipe && room && container.burn > 0) {
        container.progress += dt;
        if (container.progress >= 10) {
          container.progress -= 10;
          container.experience = Math.min(
            MAX_EXPERIENCE,
            (container.experience ?? 0) + (SMELTING_EXPERIENCE[input!.id] ?? 0),
          );
          input!.count--;
          if (!input!.count) container.slots[0] = null;
          if (output) output.count += recipe.count;
          else container.slots[2] = { id: recipe.output, count: recipe.count };
        }
      } else if (!recipe) container.progress = 0;
    }
  }
  private lightAt(p: Vec3) {
    return (
      (
        this.world as WorldPort & {
          getLight?: (x: number, y: number, z: number) => number;
        }
      ).getLight?.(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) ?? 0
    );
  }
  private spawnEntity(kind: EntityKind, x: number, z: number) {
    const y = this.world.getSurface(Math.floor(x), Math.floor(z)) + 1.05;
    if (!this.world.isReady(x, z, y)) return;
    if (
      ![0, 58].includes(
        this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)),
      )
    )
      return;
    this.entities.push({
      id: uid(),
      kind,
      position: { x, y, z },
      health: ENTITIES[kind].health,
      yaw: Math.random() * Math.PI * 2,
      timer: Math.random() * 5,
    });
  }
  private updateMobs(dt: number) {
    this.spawnTimer += dt;
    if (
      this.entities.filter((e) => !ENTITIES[e.kind].hostile).length < 6 &&
      this.spawnTimer > 2
    ) {
      const p = this.player.position;
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 + 0.7;
        this.spawnEntity(
          (["pig", "sheep", "cow"] as const)[i % 3],
          p.x + Math.cos(angle) * 10,
          p.z + Math.sin(angle) * 10,
        );
      }
      this.spawnTimer = 0;
    }
    if (
      this.night &&
      this.spawnTimer > 8 &&
      this.entities.filter((e) => ENTITIES[e.kind].hostile).length < 12
    ) {
      const angle = Math.random() * Math.PI * 2,
        rad = 22 + Math.random() * 16;
      const p = {
        x: this.player.position.x + Math.cos(angle) * rad,
        y: 0,
        z: this.player.position.z + Math.sin(angle) * rad,
      };
      p.y = this.world.getSurface(Math.floor(p.x), Math.floor(p.z)) + 1;
      if (this.lightAt(p) < 1)
        this.spawnEntity(Math.random() < 0.7 ? "zombie" : "creeper", p.x, p.z);
      this.spawnTimer = 0;
    }
    for (const e of [...this.entities]) {
      if (!this.world.isReady(e.position.x, e.position.z, e.position.y))
        continue;
      if (e.playerHitTimer !== undefined)
        e.playerHitTimer = Math.max(0, e.playerHitTimer - dt);
      const def = ENTITIES[e.kind],
        dist = distance(e.position, this.player.position);
      if (!def.hostile) {
        e.age = Math.min(0, (e.age ?? 0) + dt);
        e.breedCooldown = Math.max(0, (e.breedCooldown ?? 0) - dt);
        e.love = Math.max(0, (e.love ?? 0) - dt);
        if (e.kind === "sheep" && e.sheared) {
          const at = {
            x: Math.floor(e.position.x),
            y: Math.floor(e.position.y - 0.1),
            z: Math.floor(e.position.z),
          };
          if (
            this.world.isReady(at.x, at.z, at.y) &&
            this.world.getBlock(at.x, at.y, at.z) === 1
          ) {
            e.woolTimer = Math.min(30, (e.woolTimer ?? 0) + dt);
            if (e.woolTimer >= 30 && this.setBlock(at.x, at.y, at.z, 2)) {
              e.sheared = false;
              e.woolTimer = 0;
            }
          }
        }
      }
      if (dist > 96 && def.hostile) {
        e.playerHitTimer = 0;
        e.health = 0;
        continue;
      }
      e.timer -= dt;
      let moving = false;
      let speed = def.speed;
      if (def.hostile && dist < 22 && !this.player.dead && !this.creative) {
        e.yaw = Math.atan2(
          this.player.position.x - e.position.x,
          this.player.position.z - e.position.z,
        );
        moving = dist > 1.1;
      } else if (e.timer <= 0) {
        e.timer = 2 + Math.random() * 4;
        e.yaw = Math.random() * Math.PI * 2;
      }
      if (!def.hostile) {
        moving = e.timer > 2;
        const partner =
          (e.love ?? 0) > 0 && (e.age ?? 0) >= 0 && (e.breedCooldown ?? 0) === 0
            ? this.entities.find(
                (other) =>
                  other.id !== e.id &&
                  other.kind === e.kind &&
                  other.health > 0 &&
                  (other.age ?? 0) >= 0 &&
                  (other.love ?? 0) > 0 &&
                  (other.breedCooldown ?? 0) === 0 &&
                  this.world.isReady(
                    other.position.x,
                    other.position.z,
                    other.position.y,
                  ) &&
                  distance(e.position, other.position) < 8 &&
                  this.animalsVisible(e, other),
              )
            : undefined;
        const lure =
          this.held &&
          this.animalFood(e.kind, this.held.id) &&
          dist < 8 &&
          !this.player.dead &&
          this.canSeePlayer(e.position);
        const follow =
          partner?.position ?? (lure ? this.player.position : undefined);
        if (follow) {
          e.yaw = Math.atan2(follow.x - e.position.x, follow.z - e.position.z);
          moving = distance(follow, e.position) > (partner ? 1.1 : 1.6);
          speed *= 1.2;
        }
        if (partner && distance(e.position, partner.position) < 2) {
          e.courtship = Math.min(3, (e.courtship ?? 0) + dt);
          if (e.courtship >= 3 && this.entities.length < 10_000) {
            const position = [
              { ...e.position },
              { ...partner.position },
              { ...e.position, x: e.position.x + 0.8 },
              { ...e.position, z: e.position.z + 0.8 },
            ].find(
              (p) =>
                this.world.isReady(p.x, p.z, p.y) &&
                !intersectsWorld(this.world, p, 0.35, 0.6),
            );
            if (position) {
              this.entities.push({
                id: uid(),
                kind: e.kind,
                position,
                health: def.health,
                yaw: e.yaw,
                timer: 2,
                age: -1200,
                love: 0,
                breedCooldown: 0,
              });
              for (const parent of [e, partner]) {
                parent.love = 0;
                parent.courtship = 0;
                parent.breedCooldown = 300;
              }
              this.sound("pickup");
              this.spawnExperience(
                1 + Math.floor(this.farming.nextRandom() * 7),
                position,
              );
              this.toast("一只幼崽出生了！");
            }
          }
        } else e.courtship = 0;
      }
      if (!this.night && e.kind === "zombie" && this.skyVisible(e.position)) {
        e.health -= dt * 0.8;
      }
      const fluid = this.fluidAt({ ...e.position, y: e.position.y + 0.2 });
      if (fluid?.kind === "lava") {
        e.health -= dt * 8;
        if (e.health <= 0) continue;
      }
      const vel = fluid
        ? Math.min(2, (this.entityVel.get(e.id) ?? 0) + dt * 6)
        : (this.entityVel.get(e.id) ?? 0) - 20 * dt;
      const dx = moving ? Math.sin(e.yaw) * speed * dt : 0,
        dz = moving ? Math.cos(e.yaw) * speed * dt : 0;
      const baby = (e.age ?? 0) < 0;
      const h = def.hostile ? 1.75 : baby ? 0.6 : 1.2;
      const moved = moveBody(
        this.world,
        e.position,
        { x: dx, y: Math.max(-15, vel) * dt, z: dz },
        baby ? 0.35 : 0.65,
        h,
      );
      e.position = moved.position;
      let nextVy = moved.hitY ? 0 : vel;
      if ((moved.hitX || moved.hitZ) && moved.grounded && moving) nextVy = 7.5;
      this.entityVel.set(e.id, nextVy);
      if (
        e.kind === "zombie" &&
        dist < 1.6 &&
        !this.creative &&
        !this.player.dead &&
        e.timer < 0 &&
        this.canSeePlayer(e.position)
      ) {
        this.damage(3);
        e.timer = 1.1;
      }
      if (e.kind === "creeper" && !this.creative && !this.player.dead) {
        if (dist < 2.8 && this.canSeePlayer(e.position))
          e.fuse = (e.fuse ?? 0) + dt;
        else e.fuse = Math.max(0, (e.fuse ?? 0) - dt * 2);
        if ((e.fuse ?? 0) > 1.5) {
          this.explode(e.position);
          e.playerHitTimer = 0;
          e.health = 0;
        }
      }
    }
    this.entities = this.entities.filter((e) => {
      if (e.health > 0) return true;
      if ((e.playerHitTimer ?? 0) > 0)
        this.spawnExperience(
          mobExperience(e.kind, (e.age ?? 0) < 0, () =>
            this.farming.nextRandom(),
          ),
          e.position,
        );
      return false;
    });
    const livingIds = new Set(this.entities.map((e) => e.id));
    for (const id of this.entityVel.keys())
      if (!livingIds.has(id)) this.entityVel.delete(id);
  }
  private canSeePlayer(position: Vec3): boolean {
    const from = { x: position.x, y: position.y + 1.4, z: position.z };
    const to = {
      x: this.player.position.x,
      y: this.player.position.y + 1.3,
      z: this.player.position.z,
    };
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z },
      length = Math.hypot(d.x, d.y, d.z);
    if (length < 0.01) return true;
    return !raycastVoxel(
      this.world,
      from,
      { x: d.x / length, y: d.y / length, z: d.z / length },
      Math.max(0, length - 0.15),
      false,
      true,
    );
  }
  private animalsVisible(a: EntityState, b: EntityState): boolean {
    const from = { ...a.position, y: a.position.y + 0.55 };
    const to = { ...b.position, y: b.position.y + 0.55 };
    const dir = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    return !raycastVoxel(
      this.world,
      from,
      dir,
      Math.max(0, distance(from, to) - 0.2),
      false,
      true,
    );
  }
  private skyVisible(position: Vec3): boolean {
    if (this.world.hasSkyAccess)
      return this.world.hasSkyAccess(
        position.x,
        Math.floor(position.y + 1.8) - 1,
        position.z,
      );
    const x = Math.floor(position.x),
      z = Math.floor(position.z);
    for (let y = Math.floor(position.y + 1.8); y <= WORLD_MAX_Y; y++)
      if (BLOCKS[this.world.getBlock(x, y, z)]?.opaque) return false;
    return true;
  }
  explode(center: Vec3) {
    const radius = 2.7;
    this.sound("explode");
    const dist = distance(center, this.player.position);
    if (dist < 6 && this.canSeePlayer(center))
      this.damage(Math.max(1, (6 - dist) * 3), "explosion");
    for (
      let x = Math.floor(center.x - radius);
      x <= Math.ceil(center.x + radius);
      x++
    )
      for (
        let y = Math.floor(center.y - radius);
        y <= Math.ceil(center.y + radius);
        y++
      )
        for (
          let z = Math.floor(center.z - radius);
          z <= Math.ceil(center.z + radius);
          z++
        ) {
          if (
            Math.hypot(
              x + 0.5 - center.x,
              y + 0.5 - center.y,
              z + 0.5 - center.z,
            ) > radius
          )
            continue;
          const id = this.world.getBlock(x, y, z);
          if (
            id &&
            id !== 24 &&
            id !== 81 &&
            !isFluid(id) &&
            (BLOCKS[id]?.blastResistance ?? 0) < 1200
          )
            this.breakBlock({ x, y, z }, id, true);
        }
  }
  snapshot(): SaveData {
    // Temporary crafting/cursor contents are folded into a copied inventory for checkpoints.
    const p = clone(this.player),
      drops = clone(this.drops);
    for (const stack of [...this.craftSlots, this.cursor])
      if (stack) {
        const remaining = addItem(p.inventory, clone(stack));
        if (remaining)
          drops.push({
            id: uid(),
            stack: remaining,
            position: { ...p.position },
            age: 0,
          });
      }
    return {
      manifest: { ...this.manifest, version: 7, updatedAt: Date.now() },
      player: p,
      time: this.time,
      changes: this.world.getChanges(),
      containers: clone(this.containers),
      entities: clone(this.entities),
      farming: this.farming.snapshot(),
      composters: clone(this.composters),
      fluids: this.fluids.snapshot(),
      natural: this.natural.snapshot(),
      sugarCane: this.sugarCane.snapshot(),
      progression: clone(this.progression),
      drops,
    };
  }
}
