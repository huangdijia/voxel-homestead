import type {
  ArmorSlot,
  BlockChange,
  ContainerState,
  DropState,
  EntityKind,
  EntityState,
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
import { BLOCKS, ITEMS, ENTITIES } from "./registry";
import { addItem, clickInventorySlot, createInventory } from "./inventory";
import {
  RECIPES,
  canCraft,
  craftFromInventory,
  consumeRecipe,
  matchRecipe,
  SMELTING,
} from "./recipes";
import { intersectsWorld, moveBody, raycastVoxel } from "../engine/physics";
import { surfaceHeight } from "../engine/generator";

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
  const spawn = { x: 0.5, y: surfaceHeight(worldSeed, 0, 0) + 1.05, z: 0.5 };
  return {
    manifest: {
      version: 1,
      generatorVersion: 1,
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
      yaw: -0.62,
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
  craftSlots: Slot[] = Array(4).fill(null);
  cursor: Slot = null;
  station: "inventory" | "workbench" = "inventory";
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
  onOpen?: (kind: "workbench" | "chest" | "furnace") => void;
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
    if (!this.world.isReady(this.player.position.x, this.player.position.z))
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
    this.updateFurnaces(dt);
    this.updateDrops(dt);
    this.updateMobs(dt);
    this.dirty = true;
  }
  private move(dt: number, input: PlayerInput) {
    const p = this.player,
      body = p.position;
    const wet =
      this.world.getBlock(
        Math.floor(body.x),
        Math.floor(body.y + 0.6),
        Math.floor(body.z),
      ) === 6;
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
        ? 2.4
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
    if (!this.world.isReady(body.x + dx, body.z + dz)) {
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
    if (p.position.y < -60) {
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
    const underwater =
      this.world.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) ===
      6;
    p.oxygen = underwater
      ? Math.max(0, p.oxygen - dt * 2)
      : Math.min(20, p.oxygen + dt * 8);
    if (underwater && p.oxygen === 0) {
      this.drownTimer += dt;
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
          this.sound("eat");
          this.toast("吃饱一点，继续探索。");
        }
      }
    }
  }
  damage(amount: number, reason = "attack") {
    if (this.creative || this.player.dead || this.hurtCooldown > 0) return;
    const armor = Object.values(this.player.armor).reduce(
      (v, s) => v + (s ? ITEMS[s.id]?.armorPoints || 0 : 0),
      0,
    );
    const protectedHit = ["attack", "explosion"].includes(reason);
    const dealt = protectedHit
      ? amount * (1 - Math.min(0.8, armor * 0.04))
      : amount;
    this.player.health = Math.max(0, this.player.health - dealt);
    this.hurtCooldown = 0.45;
    this.sound("hurt");
    this.emit({ type: "damage" });
    if (protectedHit)
      for (const key of armorKeys) {
        const s = this.player.armor[key];
        if (s) {
          s.durability = (s.durability ?? ITEMS[s.id].maxDurability ?? 100) - 1;
          if (s.durability <= 0) this.player.armor[key] = null;
        }
      }
    if (this.player.health <= 0) this.die();
  }
  private die() {
    this.closeContainer();
    const p = this.player;
    p.dead = true;
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
        const safe = candidates.find((c) => !this.hasCollision(c));
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
    const safe = (p: Vec3) =>
      !this.hasCollision(p) &&
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
    for (let y = Math.floor(preferred.y) + 1; y < 94; y++) {
      const p = { x: preferred.x, y: y + 0.05, z: preferred.z };
      if (!this.hasCollision(p)) return p;
    }
    return { ...this.player.spawn, y: 95 };
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
  private updateDrops(dt: number) {
    this.drops = this.drops.filter((drop) => {
      if (!this.world.isReady(drop.position.x, drop.position.z)) return true;
      drop.age += dt;
      const ground = this.world.getBlock(
        Math.floor(drop.position.x),
        Math.floor(drop.position.y - 0.2),
        Math.floor(drop.position.z),
      );
      if (!BLOCKS[ground]?.solid && ground !== 6)
        drop.position.y -= Math.min(3 * dt, 0.15);
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
      return drop.age < 300 && drop.position.y > -64;
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
    held.durability = (held.durability ?? ITEMS[held.id].maxDurability!) - 1;
    if (held.durability <= 0) {
      this.player.inventory[this.player.selected] = null;
      this.sound("break");
      this.toast("工具损坏了");
    }
  }
  mine(dt: number): boolean {
    if (this.player.dead) return false;
    const target = this.target();
    if (!target) {
      this.mining = 0;
      this.miningKey = "";
      return false;
    }
    const def = BLOCKS[target.id];
    if (!def || target.id === 6 || (target.id === 24 && !this.creative))
      return false;
    const key = posKey(target.position);
    if (key !== this.miningKey) {
      this.miningKey = key;
      this.mining = 0;
    }
    const tool = this.held ? ITEMS[this.held.id] : null;
    const efficient = def.tool && tool?.tool === def.tool;
    const speed = efficient
      ? tool.tier === 3
        ? 6
        : tool.tier === 2
          ? 4
          : 2
      : 1;
    const duration = this.creative
      ? 0.14
      : Math.max(0.15, (def.hardness * (efficient ? 1 : 1.5)) / speed);
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
  ) {
    if (id === 0 || id === 6 || (id === 24 && (!this.creative || exploded)))
      return;
    const def = BLOCKS[id],
      tool = this.held ? ITEMS[this.held.id] : null;
    const eligible =
      !def?.tier || (tool?.tool === "pickaxe" && (tool.tier ?? 0) >= def.tier);
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
    this.world.setBlock(p.x, p.y, p.z, 0);
    if (id === 18 || id === 19) {
      this.world.setBlock(p.x, p.y + 1, p.z, 0);
      drop = "door";
    }
    if (id === 25 || id === 26) {
      this.world.setBlock(p.x, p.y - 1, p.z, 0);
      drop = "door";
    }
    if (id === 22) {
      this.world.setBlock(p.x, p.y, p.z + 1, 0);
      drop = "bed";
    }
    if (id === 27) {
      this.world.setBlock(p.x, p.y, p.z - 1, 0);
      drop = "bed";
    }
    const container = this.containers[posKey(p)];
    if (container) {
      container.slots.forEach((s) => {
        if (s) this.spawnDrop(s, { x: p.x + 0.5, y: p.y + 0.1, z: p.z + 0.5 });
      });
      delete this.containers[posKey(p)];
    }
    if (drop && !this.creative && (exploded || eligible))
      this.spawnDrop(
        { id: drop, count: 1 },
        { x: p.x + 0.5, y: p.y + 0.1, z: p.z + 0.5 },
      );
    if (!exploded) {
      this.wearTool();
      this.exhaustion += 0.025;
      this.sound("break");
    }
    this.dirty = true;
  }
  attack(): boolean {
    if (this.attackCooldown > 0 || this.player.dead) return false;
    const eye = this.eye(),
      dir = this.direction();
    const wall = this.target();
    let victim: EntityState | undefined;
    let nearest = 3.2;
    for (const e of this.entities) {
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
        (!wall || along < distance(eye, wall.position) + 0.6)
      ) {
        victim = e;
        nearest = along;
      }
    }
    if (!victim) return false;
    this.attackCooldown = 0.5;
    victim.health -= this.held ? (ITEMS[this.held.id]?.damage ?? 2) : 1;
    this.wearTool();
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
      ENTITIES[victim.kind].drops.forEach((s) =>
        this.spawnDrop(s, victim!.position),
      );
      this.entities = this.entities.filter((e) => e.id !== victim!.id);
      this.entityVel.delete(victim.id);
    }
    return true;
  }
  interact() {
    if (this.player.dead) return;
    const held = this.held,
      def = held ? ITEMS[held.id] : null;
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
    const target = this.target();
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
      this.world.setBlock(t.x, y, t.z, open ? 19 : 18);
      this.world.setBlock(t.x, y + 1, t.z, open ? 26 : 25);
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
    const p = {
      x: t.x + target.normal.x,
      y: t.y + target.normal.y,
      z: t.z + target.normal.z,
    };
    if (p.y < -16 || p.y >= 96 || !this.world.isReady(p.x, p.z)) return;
    if (![0, 6].includes(this.world.getBlock(p.x, p.y, p.z))) return;
    const boxes = [p];
    if (def.block === 18) boxes.push({ x: p.x, y: p.y + 1, z: p.z });
    if (def.block === 22) boxes.push({ x: p.x, y: p.y, z: p.z + 1 });
    for (const b of boxes) {
      if (b.y < -16 || b.y >= 96) {
        this.toast("这里超出了可建造高度");
        return;
      }
      if (!this.world.isReady(b.x, b.z)) {
        this.toast("请等待相邻地形加载完成");
        return;
      }
      if (![0, 6].includes(this.world.getBlock(b.x, b.y, b.z))) {
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
    this.world.setBlock(p.x, p.y, p.z, def.block);
    if (def.block === 18) this.world.setBlock(p.x, p.y + 1, p.z, 25);
    if (def.block === 22) this.world.setBlock(p.x, p.y, p.z + 1, 27);
    if (!this.creative) {
      held.count--;
      if (!held.count) this.player.inventory[this.player.selected] = null;
    }
    this.sound("place");
    this.dirty = true;
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
    this.containerKey = null;
  }
  get container() {
    return this.containerKey
      ? (this.containers[this.containerKey] ?? null)
      : null;
  }
  get craftOutput() {
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
      (this.cursor.id !== output.id ||
        this.cursor.count + output.count > max ||
        this.cursor.durability !== output.durability)
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
    if (!slots || i < 0 || i >= slots.length) return;
    if (source === "container" && this.container?.kind === "furnace") {
      if (i === 2 && this.cursor) {
        if (
          slots[2]?.id === this.cursor.id &&
          this.cursor.count + slots[2]!.count <= ITEMS[this.cursor.id].maxStack
        ) {
          this.cursor.count += slots[2]!.count;
          slots[2] = null;
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
      } else slots[i] = addItem(this.player.inventory, stack);
      return;
    }
    this.cursor = clickInventorySlot(slots, i, this.cursor, right);
    this.dirty = true;
  }
  private equipHeld(slot: ArmorSlot) {
    const old = this.player.armor[slot];
    this.player.armor[slot] = this.held;
    this.player.inventory[this.player.selected] = old;
    this.sound("equip");
  }
  giveItem(id: string) {
    if (!this.creative || !ITEMS[id]) return;
    const item = ITEMS[id];
    this.player.inventory[this.player.selected] = {
      id,
      count: item.maxStack,
      ...(item.maxDurability ? { durability: item.maxDurability } : {}),
    };
    this.sound("pickup");
  }
  private updateFurnaces(dt: number) {
    for (const [key, container] of Object.entries(this.containers)) {
      if (container.kind !== "furnace") continue;
      const [x, , z] = key.split(",").map(Number);
      if (!this.world.isReady(x, z)) continue;
      const input = container.slots[0],
        fuel = container.slots[1],
        output = container.slots[2];
      const recipe = input ? SMELTING[input.id] : null;
      const room =
        recipe &&
        (!output ||
          (output.id === recipe.output &&
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
        fuel.count--;
        if (!fuel.count) container.slots[1] = null;
      }
      if (recipe && room && container.burn > 0) {
        container.progress += dt;
        if (container.progress >= 10) {
          container.progress -= 10;
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
    if (!this.world.isReady(x, z)) return;
    const y = this.world.getSurface(Math.floor(x), Math.floor(z)) + 1.05;
    if (this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) !== 0)
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
          i % 2 ? "sheep" : "pig",
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
      if (!this.world.isReady(e.position.x, e.position.z)) continue;
      const def = ENTITIES[e.kind],
        dist = distance(e.position, this.player.position);
      if (dist > 96 && def.hostile) {
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
      if (!def.hostile) moving = e.timer > 2;
      if (!this.night && e.kind === "zombie" && this.skyVisible(e.position)) {
        e.health -= dt * 0.8;
      }
      const vel = (this.entityVel.get(e.id) ?? 0) - 20 * dt;
      const dx = moving ? Math.sin(e.yaw) * speed * dt : 0,
        dz = moving ? Math.cos(e.yaw) * speed * dt : 0;
      const h = def.hostile ? 1.75 : 1.2;
      const moved = moveBody(
        this.world,
        e.position,
        { x: dx, y: Math.max(-15, vel) * dt, z: dz },
        0.65,
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
          e.health = 0;
        }
      }
    }
    this.entities = this.entities.filter((e) => e.health > 0);
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
    );
  }
  private skyVisible(position: Vec3): boolean {
    const x = Math.floor(position.x),
      z = Math.floor(position.z);
    for (let y = Math.floor(position.y + 1.8); y < 96; y++)
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
          if (id && id !== 24 && id !== 6)
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
      manifest: { ...this.manifest, updatedAt: Date.now() },
      player: p,
      time: this.time,
      changes: this.world.getChanges(),
      containers: clone(this.containers),
      entities: clone(this.entities),
      drops,
    };
  }
}
