import { BLOCKS, ENTITIES, ITEMS } from "./registry";
import type { FarmState } from "./farming";
import type {
  ArmorSlot,
  ContainerState,
  EntityKind,
  GameMode,
  ItemStack,
  SaveData,
  SaveManifest,
  Slot,
  Vec3,
} from "./types";

const DB_NAME = "voxel-homestead";
const STORE = "worlds";
const BACKUPS = "migration-backups";
const MAX_CHANGES = 2_000_000;
const bad = (message: string): never => {
  throw new Error(`存档校验失败：${message}`);
};
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return bad(`${path} 必须是对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return bad(`${path} 对象类型不正确`);
  return value as Record<string, unknown>;
}
function fields(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    bad(`${path} 包含未知字段`);
}
function number(
  value: unknown,
  path: string,
  min = -Infinity,
  max = Infinity,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    return bad(`${path} 数值无效`);
  return value;
}
function below(value: unknown, path: string, upperExclusive: number): number {
  const result = number(value, path, 0, upperExclusive);
  if (result >= upperExclusive) return bad(`${path} 数值无效`);
  return result;
}
function string(value: unknown, path: string, max = 128): string {
  if (typeof value !== "string" || !value.trim().length || value.length > max)
    return bad(`${path} 文本无效`);
  return value;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return bad(`${path} 必须为布尔值`);
  return value;
}
function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    return bad(`${path} 列表无效或过大`);
  return value;
}
function vector(value: unknown, path: string, integer = false): Vec3 {
  const v = record(value, path);
  fields(v, ["x", "y", "z"], path);
  return {
    x: number(v.x, `${path}.x`, -30_000_000, 30_000_000, integer),
    y: number(v.y, `${path}.y`, -30_000_000, 30_000_000, integer),
    z: number(v.z, `${path}.z`, -30_000_000, 30_000_000, integer),
  };
}
function stack(value: unknown, path: string): Slot {
  if (value === null) return null;
  const v = record(value, path);
  fields(v, ["id", "count", "durability"], path);
  const id = string(v.id, `${path}.id`);
  const item = ITEMS[id];
  if (!item || !Object.hasOwn(ITEMS, id)) return bad(`${path} 物品不存在`);
  const result: ItemStack = {
    id,
    count: number(v.count, `${path}.count`, 1, item.maxStack, true),
  };
  if (v.durability !== undefined) {
    if (!item.maxDurability) return bad(`${path} 物品不应包含耐久`);
    result.durability = number(
      v.durability,
      `${path}.durability`,
      1,
      item.maxDurability,
      true,
    );
  } else if (item.maxDurability) result.durability = item.maxDurability;
  return result;
}
function slots(value: unknown, count: number, path: string): Slot[] {
  const values = array(value, path, count);
  if (values.length !== count) return bad(`${path} 必须有 ${count} 格`);
  return Array.from(values, (value, index) =>
    stack(value, `${path}[${index}]`),
  );
}
/** Validate before any database transaction and return a detached, known-schema value. */
export function validateSave(value: unknown): SaveData {
  const data = record(value, "根对象");
  fields(
    data,
    [
      "manifest",
      "player",
      "changes",
      "containers",
      "entities",
      "drops",
      "time",
      "farming",
      "composters",
    ],
    "根对象",
  );
  const manifest = record(data.manifest, "manifest");
  fields(
    manifest,
    [
      "version",
      "generatorVersion",
      "id",
      "name",
      "seed",
      "mode",
      "createdAt",
      "updatedAt",
      "playedSeconds",
    ],
    "manifest",
  );
  if (
    ![1, 2].includes(manifest.version as number) ||
    ![1, 2].includes(manifest.generatorVersion as number)
  )
    return bad("不支持此存档或地形生成器版本；原始文件未被修改");
  if (
    manifest.version === 1 &&
    (manifest.generatorVersion !== 1 ||
      data.farming !== undefined ||
      data.composters !== undefined)
  )
    return bad("版本 1 不支持农业扩展");
  if (manifest.mode !== "survival" && manifest.mode !== "creative")
    return bad("游戏模式无效");
  const validatedManifest: SaveManifest = {
    version: manifest.version as 1 | 2,
    generatorVersion: manifest.generatorVersion as 1 | 2,
    id: string(manifest.id, "manifest.id"),
    name: string(manifest.name, "manifest.name", 80),
    seed: string(manifest.seed, "manifest.seed", 128),
    mode: manifest.mode as GameMode,
    createdAt: number(manifest.createdAt, "manifest.createdAt", 0),
    updatedAt: number(manifest.updatedAt, "manifest.updatedAt", 0),
    playedSeconds: number(manifest.playedSeconds, "manifest.playedSeconds", 0),
  };
  const player = record(data.player, "player");
  fields(
    player,
    [
      "position",
      "velocity",
      "yaw",
      "pitch",
      "health",
      "hunger",
      "oxygen",
      "inventory",
      "armor",
      "selected",
      "spawn",
      "bedSpawn",
      "dead",
      "flying",
    ],
    "player",
  );
  const armorInput = record(player.armor, "player.armor");
  fields(armorInput, ["head", "chest", "legs", "feet"], "player.armor");
  const armor = {} as Record<ArmorSlot, Slot>;
  for (const key of ["head", "chest", "legs", "feet"] as const) {
    armor[key] = stack(armorInput[key], `player.armor.${key}`);
    if (armor[key] && ITEMS[armor[key]!.id].armorSlot !== key)
      bad(`player.armor.${key} 装备位置错误`);
  }
  const occupied = new Map<string, number>();
  const changes = array(data.changes, "changes", MAX_CHANGES).map(
    (value, index) => {
      const change = record(value, `changes[${index}]`);
      fields(change, ["x", "y", "z", "id"], "changes");
      const position = vector(
        { x: change.x, y: change.y, z: change.z },
        "changes",
        true,
      );
      if (position.y < -16 || position.y >= 96)
        bad("方块修改超出当前生成器的世界高度");
      const id = number(
        change.id,
        "changes.id",
        0,
        manifest.version === 1 ? 27 : 65535,
        true,
      );
      if (!BLOCKS[id]) bad("未知方块");
      const key = `${position.x},${position.y},${position.z}`;
      if (occupied.has(key)) bad("同一位置存在重复方块修改");
      occupied.set(key, id);
      return { ...position, id };
    },
  );
  const containersInput = record(data.containers, "containers");
  if (Object.keys(containersInput).length > 50_000) bad("容器数量过大");
  const containers: Record<string, ContainerState> = {};
  for (const [key, value] of Object.entries(containersInput)) {
    const coords = key.split(",").map(Number);
    if (
      coords.length !== 3 ||
      coords.some(
        (v) => !Number.isSafeInteger(v) || Math.abs(v) > 30_000_000,
      ) ||
      coords.join(",") !== key
    )
      bad("容器坐标无效");
    const container = record(value, `containers.${key}`);
    if (container.kind === "chest") {
      fields(container, ["kind", "slots"], "chest");
      if (occupied.get(key) !== 15) bad("箱子数据没有对应箱子方块");
      containers[key] = {
        kind: "chest",
        slots: slots(container.slots, 27, "chest.slots"),
      };
    } else if (container.kind === "furnace") {
      fields(
        container,
        ["kind", "slots", "burn", "burnTotal", "progress"],
        "furnace",
      );
      if (occupied.get(key) !== 14) bad("熔炉数据没有对应熔炉方块");
      const burnTotal = number(
        container.burnTotal,
        "furnace.burnTotal",
        0,
        1_000_000,
      );
      containers[key] = {
        kind: "furnace",
        slots: slots(container.slots, 3, "furnace.slots"),
        burn: number(container.burn, "furnace.burn", 0, burnTotal),
        burnTotal,
        progress: number(container.progress, "furnace.progress", 0, 1_000_000),
      };
    } else bad("未知容器类型");
  }
  const entityIds = new Set<string>();
  const entities = array(data.entities, "entities", 10_000).map(
    (value, index) => {
      const entity = record(value, `entities[${index}]`);
      fields(
        entity,
        [
          "id",
          "kind",
          "position",
          "health",
          "yaw",
          "timer",
          "fuse",
          "age",
          "love",
          "breedCooldown",
          "courtship",
          "sheared",
          "woolTimer",
        ],
        "entity",
      );
      const kind = string(entity.kind, "entity.kind") as EntityKind;
      if (!Object.hasOwn(ENTITIES, kind)) return bad("未知生物种类");
      const breedingFields = [
        "age",
        "love",
        "breedCooldown",
        "courtship",
        "sheared",
        "woolTimer",
      ];
      if (
        breedingFields.some((key) => entity[key] !== undefined) &&
        (manifest.version === 1 || ENTITIES[kind].hostile)
      )
        bad("此版本或生物类型不支持繁殖状态");
      if (
        kind !== "sheep" &&
        (entity.sheared !== undefined || entity.woolTimer !== undefined)
      )
        bad("仅羊拥有羊毛状态");
      const id = string(entity.id, "entity.id");
      if (entityIds.has(id)) bad("生物标识重复");
      entityIds.add(id);
      return {
        id,
        kind,
        position: vector(entity.position, "entity.position"),
        health: number(
          entity.health,
          "entity.health",
          0,
          ENTITIES[kind].health,
        ),
        yaw: number(entity.yaw, "entity.yaw"),
        timer: number(entity.timer, "entity.timer"),
        ...(entity.age === undefined
          ? {}
          : { age: number(entity.age, "entity.age", -1200, 0) }),
        ...(entity.love === undefined
          ? {}
          : { love: number(entity.love, "entity.love", 0, 60) }),
        ...(entity.breedCooldown === undefined
          ? {}
          : {
              breedCooldown: number(
                entity.breedCooldown,
                "entity.breedCooldown",
                0,
                300,
              ),
            }),
        ...(entity.courtship === undefined
          ? {}
          : { courtship: number(entity.courtship, "entity.courtship", 0, 3) }),
        ...(entity.sheared === undefined
          ? {}
          : { sheared: boolean(entity.sheared, "entity.sheared") }),
        ...(entity.woolTimer === undefined
          ? {}
          : { woolTimer: number(entity.woolTimer, "entity.woolTimer", 0, 30) }),
        ...(entity.fuse === undefined
          ? {}
          : { fuse: number(entity.fuse, "entity.fuse", 0) }),
      };
    },
  );
  const dropIds = new Set<string>();
  const drops = array(data.drops, "drops", 50_000).map((value, index) => {
    const drop = record(value, `drops[${index}]`);
    fields(drop, ["id", "stack", "position", "age"], "drop");
    const id = string(drop.id, "drop.id");
    if (dropIds.has(id)) bad("掉落标识重复");
    dropIds.add(id);
    const item = stack(drop.stack, "drop.stack");
    if (!item) return bad("掉落物不能为空");
    return {
      id,
      stack: item,
      position: vector(drop.position, "drop.position"),
      age: number(drop.age, "drop.age", -1),
    };
  });
  let farming: FarmState | undefined;
  if (manifest.version === 2) {
    const farm = record(data.farming, "farming");
    fields(
      farm,
      ["version", "randomState", "clock", "accumulator", "scanCursor", "plots"],
      "farming",
    );
    if (farm.version !== 1) bad("农业存档版本无效");
    const clock = number(farm.clock, "farming.clock", 0);
    const seen = new Set<string>();
    const plots = array(farm.plots, "farming.plots", 100_000).map((entry) => {
      const plot = record(entry, "farming.plot");
      fields(
        plot,
        [
          "x",
          "y",
          "z",
          "moisture",
          "drySeconds",
          "growthRemaining",
          "lastVisit",
          "active",
        ],
        "farming.plot",
      );
      const at = vector(
        { x: plot.x, y: plot.y, z: plot.z },
        "farming.plot",
        true,
      );
      if (at.y < -16 || at.y > 95) bad("耕地高度无效");
      const key = `${at.x},${at.y},${at.z}`;
      if (seen.has(key)) bad("耕地记录重复");
      seen.add(key);
      if (![28, 29].includes(occupied.get(key) ?? 0))
        bad("耕地记录没有对应方块");
      return {
        ...at,
        moisture: number(plot.moisture, "farming.moisture", 0, 7, true),
        drySeconds: below(plot.drySeconds, "farming.drySeconds", 10),
        growthRemaining: number(
          plot.growthRemaining,
          "farming.growthRemaining",
          0,
          60,
        ),
        lastVisit: number(plot.lastVisit, "farming.lastVisit", 0, clock),
        active: boolean(plot.active, "farming.active"),
      };
    });
    for (const [key, id] of occupied)
      if ((id === 28 || id === 29) && !seen.has(key))
        bad("耕地方块缺少生长记录");
    farming = {
      version: 1,
      randomState: number(
        farm.randomState,
        "farming.randomState",
        0,
        0xffffffff,
        true,
      ),
      clock,
      accumulator: below(farm.accumulator, "farming.accumulator", 0.25),
      scanCursor: number(
        farm.scanCursor,
        "farming.scanCursor",
        0,
        Math.max(0, plots.length - 1),
        true,
      ),
      plots,
    };
  }
  const composters: Record<string, number> = {};
  if (manifest.version === 2) {
    const timers = record(data.composters ?? {}, "composters");
    if (Object.keys(timers).length > 50_000) bad("堆肥桶数量过大");
    for (const [key, timer] of Object.entries(timers)) {
      if (occupied.get(key) !== 66) bad("堆肥计时没有对应满桶");
      composters[key] = number(timer, "composter.timer", 0, 1);
    }
    for (const [key, id] of occupied)
      if (id === 66 && !Object.hasOwn(composters, key))
        bad("堆肥桶缺少熟成记录");
  }
  return {
    manifest: validatedManifest,
    player: {
      position: vector(player.position, "player.position"),
      velocity: vector(player.velocity, "player.velocity"),
      yaw: number(player.yaw, "player.yaw"),
      pitch: number(player.pitch, "player.pitch"),
      health: number(player.health, "player.health", 0, 20),
      hunger: number(player.hunger, "player.hunger", 0, 20),
      oxygen: number(player.oxygen, "player.oxygen", 0, 20),
      inventory: slots(player.inventory, 36, "player.inventory"),
      armor,
      selected: number(player.selected, "player.selected", 0, 8, true),
      spawn: vector(player.spawn, "player.spawn"),
      ...(player.bedSpawn === undefined
        ? {}
        : { bedSpawn: vector(player.bedSpawn, "player.bedSpawn") }),
      dead: boolean(player.dead, "player.dead"),
      flying: boolean(player.flying, "player.flying"),
    },
    changes,
    containers,
    entities,
    drops,
    time: number(data.time, "time", 0),
    ...(farming ? { farming, composters } : {}),
  };
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("浏览器不支持 IndexedDB，无法保存世界"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: "manifest.id" });
      if (!request.result.objectStoreNames.contains(BACKUPS)) {
        const backups = request.result.createObjectStore(BACKUPS, {
          keyPath: "id",
        });
        backups.createIndex("worldId", "worldId");
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开存档数据库"));
    request.onblocked = () =>
      reject(new Error("存档数据库被其他窗口占用，请关闭旧窗口后重试"));
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, tx: IDBTransaction) => IDBRequest<T>,
  extraStores: string[] = [],
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([STORE, ...extraStores], mode);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    let result: T;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      /* The abort event determines failure; completion alone means durable success. */
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("保存事务中断，上一份完整存档已保留"));
    };
    try {
      const request = operation(tx.objectStore(STORE), tx);
      request.onsuccess = () => {
        result = request.result;
      };
    } catch (error) {
      tx.abort();
      db.close();
      reject(error);
    }
  });
}
export async function listWorlds(): Promise<SaveManifest[]> {
  const values = await transaction<SaveData[]>("readonly", (store) =>
    store.getAll(),
  );
  return values
    .map((value) => value.manifest)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function saveWorld(data: SaveData): Promise<void> {
  const checkpoint = validateSave(data);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, BACKUPS], "readwrite");
    const worlds = tx.objectStore(STORE),
      backups = tx.objectStore(BACKUPS);
    let cause: unknown;
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {};
    tx.onabort = () => {
      db.close();
      reject(
        cause ??
          tx.error ??
          new Error("保存事务中断，旧存档和升级备份均未修改"),
      );
    };
    const attempt = (operation: () => void) => {
      try {
        operation();
      } catch (error) {
        cause = error;
        tx.abort();
      }
    };
    attempt(() => {
      const read = worlds.get(checkpoint.manifest.id);
      read.onsuccess = () =>
        attempt(() => {
          const old = read.result as SaveData | undefined;
          if (old && old.manifest.version < checkpoint.manifest.version) {
            const id = `${old.manifest.id}:v${old.manifest.version}`;
            const existing = backups.get(id);
            existing.onsuccess = () =>
              attempt(() => {
                if (!existing.result)
                  backups.add({
                    id,
                    worldId: old.manifest.id,
                    version: old.manifest.version,
                    data: old,
                  });
                worlds.put(checkpoint);
              });
          } else worlds.put(checkpoint);
        });
    });
  });
}
export async function loadWorld(id: string): Promise<SaveData | null> {
  const value = await transaction<SaveData | undefined>("readonly", (store) =>
    store.get(id),
  );
  return value ? validateSave(value) : null;
}
export async function deleteWorld(id: string): Promise<void> {
  await transaction(
    "readwrite",
    (store, tx) => {
      const cursor = tx
        .objectStore(BACKUPS)
        .index("worldId")
        .openCursor(IDBKeyRange.only(id));
      cursor.onsuccess = () => {
        if (cursor.result) {
          cursor.result.delete();
          cursor.result.continue();
        }
      };
      return store.delete(id);
    },
    [BACKUPS],
  );
}
export async function loadMigrationBackup(
  id: string,
): Promise<SaveData | null> {
  const result = await transaction<{ data: SaveData } | undefined>(
    "readonly",
    (_store, tx) => tx.objectStore(BACKUPS).get(`${id}:v1`),
    [BACKUPS],
  );
  return result ? validateSave(result.data) : null;
}
export async function migrationBackupIds(): Promise<string[]> {
  const result = await transaction<{ worldId: string }[]>(
    "readonly",
    (_store, tx) => tx.objectStore(BACKUPS).getAll(),
    [BACKUPS],
  );
  return [...new Set(result.map((b) => b.worldId))];
}
export async function exportMigrationBackup(id: string): Promise<void> {
  const backup = await loadMigrationBackup(id);
  if (!backup) throw new Error("没有找到升级前备份");
  downloadSave(backup, `${backup.manifest.name}（升级前备份）`);
}
// Download a detached live checkpoint without reading or writing IndexedDB.
export function downloadSave(
  data: SaveData,
  filename = data.manifest.name,
): void {
  const contents = JSON.stringify(data);
  const link = document.createElement("a");
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json" }),
  );
  try {
    link.href = url;
    link.download = `${filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")}.voxel.json`;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export async function exportWorld(id: string): Promise<void> {
  const world = await loadWorld(id);
  if (!world) throw new Error("找不到要导出的世界");
  downloadSave(world);
}
export async function importWorld(text: string): Promise<SaveManifest> {
  if (text.length > 160_000_000) throw new Error("存档文件过大（上限 160 MB）");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("存档文件不是有效的 JSON");
  }
  const world = validateSave(input);
  world.manifest = {
    ...world.manifest,
    id: crypto.randomUUID(),
    name: `${world.manifest.name.slice(0, 75)}（导入）`,
    updatedAt: Date.now(),
  };
  // add, rather than put, protects even against an unexpected identifier collision.
  await transaction("readwrite", (store) => store.add(world));
  return { ...world.manifest };
}
