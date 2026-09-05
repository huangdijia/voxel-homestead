import type {
  BlockDefinition,
  EntityDefinition,
  EntityKind,
  ItemDefinition,
} from "./types";

export const BLOCKS: Record<number, BlockDefinition> = {};
function block(
  id: number,
  key: string,
  name: string,
  texture: number,
  options: Partial<BlockDefinition> = {},
) {
  BLOCKS[id] = {
    id,
    key,
    name,
    texture,
    solid: true,
    opaque: true,
    hardness: 1.5,
    drop: key,
    ...options,
  };
}
block(0, "air", "空气", 0, {
  solid: false,
  opaque: false,
  hardness: 0,
  drop: undefined,
});
block(1, "grass", "草方块", 1, {
  topTexture: 0,
  bottomTexture: 2,
  hardness: 0.6,
  drop: "dirt",
  tool: "shovel",
});
block(2, "dirt", "泥土", 2, { hardness: 0.5, tool: "shovel" });
block(3, "stone", "石头", 3, { drop: "cobblestone", tool: "pickaxe", tier: 1 });
block(4, "sand", "沙子", 4, { hardness: 0.5, tool: "shovel" });
block(5, "gravel", "砂砾", 5, { hardness: 0.6, tool: "shovel" });
block(6, "water", "水", 4, {
  solid: false,
  opaque: false,
  hardness: Infinity,
  drop: undefined,
});
block(7, "log", "橡木原木", 6, {
  topTexture: 7,
  bottomTexture: 7,
  hardness: 2,
  tool: "axe",
});
block(8, "leaves", "橡树树叶", 8, { opaque: false, hardness: 0.2 });
block(9, "coal_ore", "煤矿石", 9, {
  hardness: 3,
  drop: "coal",
  tool: "pickaxe",
  tier: 1,
});
block(10, "iron_ore", "铁矿石", 10, {
  hardness: 3,
  drop: "raw_iron",
  tool: "pickaxe",
  tier: 2,
});
block(11, "planks", "橡木木板", 11, { hardness: 2, tool: "axe" });
block(12, "cobblestone", "圆石", 12, { hardness: 2, tool: "pickaxe", tier: 1 });
block(13, "workbench", "工作台", 11, {
  topTexture: 13,
  hardness: 2.5,
  tool: "axe",
});
block(14, "furnace", "熔炉", 14, {
  topTexture: 12,
  bottomTexture: 12,
  hardness: 3.5,
  tool: "pickaxe",
  tier: 1,
});
block(15, "chest", "箱子", 11, { topTexture: 7, hardness: 2.5, tool: "axe" });
block(16, "torch", "火把", 7, {
  solid: false,
  opaque: false,
  hardness: 0,
  shape: "torch",
});
block(17, "glass", "玻璃", 3, {
  opaque: false,
  hardness: 0.3,
  drop: undefined,
});
block(18, "door", "橡木门", 11, {
  opaque: false,
  hardness: 3,
  tool: "axe",
  shape: "door",
});
block(19, "door_open", "橡木门（开启）", 11, {
  solid: false,
  opaque: false,
  hardness: 3,
  tool: "axe",
  shape: "door",
  drop: "door",
});
block(20, "ladder", "梯子", 11, {
  solid: false,
  opaque: false,
  hardness: 0.4,
  tool: "axe",
  shape: "ladder",
});
block(21, "slab", "橡木台阶", 11, {
  opaque: false,
  hardness: 2,
  tool: "axe",
  shape: "slab",
});
block(22, "bed", "白色床", 15, { opaque: false, hardness: 0.2, shape: "bed" });
block(23, "wool", "白色羊毛", 15, { hardness: 0.8 });
block(24, "bedrock", "基岩", 12, { hardness: Infinity, drop: undefined });
block(25, "door_top", "橡木门（上半）", 11, {
  opaque: false,
  hardness: 3,
  tool: "axe",
  shape: "door",
  drop: undefined,
});
block(26, "door_top_open", "橡木门（上半开启）", 11, {
  solid: false,
  opaque: false,
  hardness: 3,
  tool: "axe",
  shape: "door",
  drop: undefined,
});
block(27, "bed_head", "白色床（床头）", 15, {
  opaque: false,
  hardness: 0.2,
  shape: "bed",
  drop: undefined,
});

block(28, "farmland", "耕地", 2, { hardness: 0.6, opaque: false, tool: "shovel", shape: "farmland", drop: "dirt" });
block(29, "wet_farmland", "湿润耕地", 2, { hardness: 0.6, opaque: false, tool: "shovel", shape: "farmland", drop: "dirt" });
for (const [first, stages, key, name] of [[30, 8, "wheat", "小麦"], [38, 8, "carrot", "胡萝卜"], [46, 8, "potato", "马铃薯"], [54, 4, "beetroot", "甜菜"]] as const)
  for (let stage = 0; stage < stages; stage++) block(first + stage, `${key}_crop_${stage}`, `${name}（${stage === stages - 1 ? "成熟" : `生长 ${stage + 1}/${stages}`}）`, 0, { solid: false, opaque: false, hardness: 0, drop: undefined, shape: "crop" });
block(58, "short_grass", "草丛", 0, { solid: false, opaque: false, hardness: 0, drop: undefined, shape: "crop" });

export const ITEMS: Record<string, ItemDefinition> = {};
for (const definition of Object.values(BLOCKS)) {
  if (!definition.id || [19, 25, 26, 27, 29].includes(definition.id) || (definition.id >= 30 && definition.id <= 57)) continue;
  ITEMS[definition.key] = {
    id: definition.key,
    name: definition.name,
    category: "building",
    maxStack: 64,
    block: definition.id,
    texture: definition.topTexture ?? definition.texture,
  };
}
Object.assign(ITEMS.log, { fuel: 15 });
Object.assign(ITEMS.planks, { fuel: 15 });
Object.assign(ITEMS.slab, { fuel: 7.5 });
Object.assign(ITEMS.workbench, { fuel: 15 });
Object.assign(ITEMS.chest, { fuel: 15 });
Object.assign(ITEMS.door, { fuel: 10 });
Object.assign(ITEMS.ladder, { fuel: 15 });
Object.assign(ITEMS.bed, { maxStack: 1 });
function item(
  id: string,
  name: string,
  color: string,
  options: Partial<ItemDefinition> = {},
) {
  ITEMS[id] = {
    id,
    name,
    color,
    category: "materials",
    maxStack: 64,
    ...options,
  };
}
item("stick", "木棍", "#9d7042", { fuel: 5 });
item("coal", "煤炭", "#333842", { fuel: 80 });
item("charcoal", "木炭", "#51473a", { fuel: 80 });
item("raw_iron", "粗铁", "#c89976");
item("iron_ingot", "铁锭", "#c4d0d5");
item("raw_pork", "生猪肉", "#ee9d9e", { category: "food", food: 3 });
item("cooked_pork", "熟猪排", "#b97747", { category: "food", food: 8 });
item("raw_mutton", "生羊肉", "#c44c56", { category: "food", food: 2 });
item("cooked_mutton", "熟羊肉", "#88472d", { category: "food", food: 6 });
item("wheat_seeds", "小麦种子", "#7c9a40");
item("wheat", "小麦", "#d2b655");
item("carrot", "胡萝卜", "#ee872d", { category: "food", food: 3 });
item("potato", "马铃薯", "#b99154", { category: "food", food: 1 });
item("poisonous_potato", "毒马铃薯", "#9b9f43", { category: "food", food: 2 });
item("beetroot_seeds", "甜菜种子", "#81523c");
item("beetroot", "甜菜根", "#a03952", { category: "food", food: 1 });
item("bread", "面包", "#cc943e", { category: "food", food: 5 });
item("baked_potato", "烤马铃薯", "#d0a358", { category: "food", food: 5 });
item("bowl", "碗", "#916741");
item("beetroot_soup", "甜菜汤", "#a54359", { category: "food", food: 6, foodRemainder: "bowl", maxStack: 1 });
item("bone_meal", "骨粉", "#dbe0cd");
item("shears", "剪刀", "#bdc5c2", { category: "tools", maxStack: 1, maxDurability: 238 });
item("bucket", "铁桶", "#b8c6ce", { category: "tools", maxStack: 16 });
item("water_bucket", "水桶", "#5898ce", { category: "tools", maxStack: 1 });
for (const [material, title, tier, maxDurability, color] of [
  ["wood", "木", 1, 59, "#ad7d45"],
  ["stone", "石", 2, 131, "#858b8d"],
  ["iron", "铁", 3, 250, "#d4dfe3"],
] as const) {
  for (const [tool, name, baseDamage] of [
    ["pickaxe", "镐", 1],
    ["axe", "斧", 3],
    ["shovel", "锹", 1],
    ["sword", "剑", 3],
    ["hoe", "锄", 0],
  ] as const) {
    item(`${material}_${tool}`, `${title}${name}`, color, {
      category: "tools",
      maxStack: 1,
      tool,
      tier,
      maxDurability,
      damage: baseDamage + tier,
      fuel: material === "wood" ? 10 : undefined,
    });
  }
}
for (const [id, name, armorSlot, armorPoints, maxDurability] of [
  ["helmet", "铁头盔", "head", 2, 165],
  ["chestplate", "铁胸甲", "chest", 6, 240],
  ["leggings", "铁护腿", "legs", 5, 225],
  ["boots", "铁靴子", "feet", 2, 195],
] as const)
  item(`iron_${id}`, name, "#c4d0d5", {
    category: "tools",
    maxStack: 1,
    armorSlot,
    armorPoints,
    maxDurability,
  });

export const ENTITIES: Record<EntityKind, EntityDefinition> = {
  pig: {
    kind: "pig",
    name: "猪",
    health: 10,
    speed: 1.1,
    hostile: false,
    drops: [{ id: "raw_pork", count: 2 }],
  },
  sheep: {
    kind: "sheep",
    name: "白羊",
    health: 8,
    speed: 1,
    hostile: false,
    drops: [
      { id: "raw_mutton", count: 2 },
      { id: "wool", count: 1 },
    ],
  },
  zombie: {
    kind: "zombie",
    name: "僵尸",
    health: 20,
    speed: 1.7,
    hostile: true,
    drops: [],
  },
  creeper: {
    kind: "creeper",
    name: "爬行者",
    health: 20,
    speed: 1.5,
    hostile: true,
    drops: [],
  },
};
