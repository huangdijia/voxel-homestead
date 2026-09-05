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

block(28, "farmland", "耕地", 2, {
  hardness: 0.6,
  opaque: false,
  tool: "shovel",
  shape: "farmland",
  drop: "dirt",
});
block(29, "wet_farmland", "湿润耕地", 2, {
  hardness: 0.6,
  opaque: false,
  tool: "shovel",
  shape: "farmland",
  drop: "dirt",
});
for (const [first, stages, key, name] of [
  [30, 8, "wheat", "小麦"],
  [38, 8, "carrot", "胡萝卜"],
  [46, 8, "potato", "马铃薯"],
  [54, 4, "beetroot", "甜菜"],
] as const)
  for (let stage = 0; stage < stages; stage++)
    block(
      first + stage,
      `${key}_crop_${stage}`,
      `${name}（${stage === stages - 1 ? "成熟" : `生长 ${stage + 1}/${stages}`}）`,
      0,
      {
        solid: false,
        opaque: false,
        hardness: 0,
        drop: undefined,
        shape: "crop",
      },
    );
block(58, "short_grass", "草丛", 0, {
  solid: false,
  opaque: false,
  hardness: 0,
  drop: undefined,
  shape: "crop",
});
for (let level = 0; level <= 8; level++)
  block(
    59 + level,
    level ? `composter_${level}` : "composter",
    `堆肥桶${level === 8 ? "（可收取骨粉）" : level ? `（${level}/7）` : ""}`,
    11,
    { opaque: false, hardness: 0.6, tool: "axe", drop: "composter" },
  );

// Dynamic fluid states are world data; only sources appear in the creative catalog.
for (let id = 68; id <= 80; id++) {
  const lava = id >= 76;
  block(id, id === 76 ? "lava" : `fluid_${id}`, lava ? "熔岩" : "流动的水", 4, {
    solid: false,
    opaque: false,
    hardness: Infinity,
    drop: undefined,
  });
}
block(81, "obsidian", "黑曜石", 3, { hardness: 50, tool: "pickaxe", tier: 4 });
block(82, "persistent_leaves", "橡树树叶", 8, {
  opaque: false,
  hardness: 0.2,
  drop: "leaves",
});
block(83, "oak_sapling", "橡树树苗", 8, {
  solid: false,
  opaque: false,
  hardness: 0,
  shape: "crop",
});

// Harvest tiers describe what a pickaxe can collect, independently of its speed.
const minerals = [
  ["coal", "煤", "coal", 1, 1, 1, 9],
  ["iron", "铁", "raw_iron", 2, 1, 1, 10],
  ["copper", "铜", "raw_copper", 2, 2, 5, 10],
  ["gold", "金", "raw_gold", 3, 1, 1, 10],
  ["redstone", "红石", "redstone", 3, 4, 5, 9],
  ["lapis", "青金石", "lapis_lazuli", 2, 4, 9, 9],
  ["diamond", "钻石", "diamond", 3, 1, 1, 10],
  ["emerald", "绿宝石", "emerald", 3, 1, 1, 10],
] as const;
for (let index = 0; index < minerals.length; index++) {
  const [key, name, drop, tier, minimum, maximum, texture] = minerals[index];
  const ore = {
    drop,
    tier,
    dropCount: [minimum, maximum] as const,
    tool: "pickaxe" as const,
  };
  if (index >= 2)
    block(82 + index, `${key}_ore`, `${name}矿石`, texture, {
      ...ore,
      hardness: 3,
    });
  block(92 + index, `deepslate_${key}_ore`, `深层${name}矿石`, texture, {
    ...ore,
    hardness: 4.5,
  });
}
block(90, "deepslate", "深板岩", 3, {
  hardness: 3,
  drop: "cobbled_deepslate",
  tool: "pickaxe",
  tier: 1,
});
block(91, "cobbled_deepslate", "深板岩圆石", 12, {
  hardness: 3.5,
  tool: "pickaxe",
  tier: 1,
});
for (const [id, key, name, tier, hardness] of [
  [100, "copper_block", "铜块", 2, 3],
  [101, "gold_block", "金块", 3, 3],
  [102, "redstone_block", "红石块", 1, 5],
  [103, "lapis_block", "青金石块", 2, 3],
  [104, "diamond_block", "钻石块", 3, 5],
  [105, "emerald_block", "绿宝石块", 3, 5],
  [106, "iron_block", "铁块", 2, 5],
  [107, "coal_block", "煤炭块", 1, 5],
  [108, "raw_iron_block", "粗铁块", 2, 5],
  [109, "raw_copper_block", "粗铜块", 2, 5],
  [110, "raw_gold_block", "粗金块", 3, 5],
] as const)
  block(id, key, name, 15, { hardness, tool: "pickaxe", tier });

block(111, "sugar_cane", "甘蔗", 0, {
  solid: false,
  opaque: false,
  hardness: 0,
  shape: "crop",
});
block(112, "enchanting_table", "附魔台", 3, {
  opaque: false,
  shape: "enchanting_table",
  hardness: 5,
  blastResistance: 1200,
  tool: "pickaxe",
  tier: 1,
});
block(113, "bookshelf", "书架", 11, {
  hardness: 1.5,
  tool: "axe",
  drop: "book",
  dropCount: [3, 3],
});
for (let damage = 0; damage < 3; damage++)
  for (let axis = 0; axis < 2; axis++) {
    const key = ["anvil", "chipped_anvil", "damaged_anvil"][damage];
    block(
      114 + damage * 2 + axis,
      `${key}${axis ? "_east_west" : ""}`,
      ["铁砧", "开裂的铁砧", "损坏的铁砧"][damage],
      15,
      {
        opaque: false,
        shape: "anvil",
        hardness: 5,
        blastResistance: 1200,
        tool: "pickaxe",
        tier: 1,
        drop: key,
      },
    );
  }
for (let state = 0; state < 12; state++)
  block(120 + state, state ? `grindstone_${state}` : "grindstone", "砂轮", 3, {
    opaque: false,
    shape: "grindstone",
    hardness: 2,
    tool: "pickaxe",
    tier: 1,
    drop: "grindstone",
  });
block(132, "stone_slab", "石台阶", 3, {
  opaque: false,
  shape: "slab",
  hardness: 2,
  tool: "pickaxe",
  tier: 1,
});
block(133, "stone_slab_upper", "石台阶（上半）", 3, {
  opaque: false,
  shape: "slab",
  hardness: 2,
  tool: "pickaxe",
  tier: 1,
  drop: "stone_slab",
});
block(134, "stone_slab_double", "双层石台阶", 3, {
  hardness: 2,
  tool: "pickaxe",
  tier: 1,
  drop: "stone_slab",
  dropCount: [2, 2],
});

export const ITEMS: Record<string, ItemDefinition> = {};
for (const definition of Object.values(BLOCKS)) {
  if (
    !definition.id ||
    [19, 25, 26, 27, 29].includes(definition.id) ||
    (definition.id >= 30 && definition.id <= 57) ||
    (definition.id >= 60 && definition.id <= 75) ||
    [77, 78, 79, 80, 82, 115, 117, 119, 133, 134].includes(definition.id) ||
    (definition.id >= 121 && definition.id <= 131)
  )
    continue;
  ITEMS[definition.key] = {
    id: definition.key,
    name: definition.name,
    category: "building",
    maxStack: 64,
    block: definition.id,
    texture: definition.topTexture ?? definition.texture,
    ...(definition.id >= 114
      ? { introducedVersion: 7 as const }
      : definition.id >= 111
        ? { introducedVersion: 6 as const }
        : definition.id >= 84
          ? { introducedVersion: 4 as const }
          : {}),
  };
}
Object.assign(ITEMS.leaves, { block: 82 });
Object.assign(ITEMS.oak_sapling, { fuel: 5 });
Object.assign(ITEMS.obsidian, { color: "#39284d" });
Object.assign(ITEMS.lava, { color: "#ff6b16" });
Object.assign(ITEMS.log, { fuel: 15 });
Object.assign(ITEMS.planks, { fuel: 15 });
Object.assign(ITEMS.slab, { fuel: 7.5 });
Object.assign(ITEMS.workbench, { fuel: 15 });
Object.assign(ITEMS.chest, { fuel: 15 });
Object.assign(ITEMS.door, { fuel: 10 });
Object.assign(ITEMS.ladder, { fuel: 15 });
Object.assign(ITEMS.bed, { maxStack: 1 });
Object.assign(ITEMS.coal_block, { fuel: 800 });
Object.assign(ITEMS.bookshelf, { fuel: 15 });
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
item("enchanted_book", "附魔书", "#9673bb", {
  maxStack: 1,
  introducedVersion: 7,
});
for (const [id, name, color] of [
  ["raw_copper", "粗铜", "#c17a52"],
  ["raw_gold", "粗金", "#d4a844"],
  ["copper_ingot", "铜锭", "#da875c"],
  ["gold_ingot", "金锭", "#f4ce53"],
  ["redstone", "红石粉", "#c43436"],
  ["lapis_lazuli", "青金石", "#416bc8"],
  ["diamond", "钻石", "#61e1d9"],
  ["emerald", "绿宝石", "#42c975"],
  ["gold_nugget", "金粒", "#e6bf4c"],
  ["iron_nugget", "铁粒", "#bfc9cc"],
] as const)
  item(id, name, color, { introducedVersion: 4 });
item("raw_pork", "生猪肉", "#ee9d9e", { category: "food", food: 3 });
item("cooked_pork", "熟猪排", "#b97747", { category: "food", food: 8 });
item("raw_mutton", "生羊肉", "#c44c56", { category: "food", food: 2 });
item("cooked_mutton", "熟羊肉", "#88472d", { category: "food", food: 6 });
item("raw_beef", "生牛肉", "#b84c45", {
  introducedVersion: 6,
  category: "food",
  food: 3,
});
item("cooked_beef", "牛排", "#87442a", {
  introducedVersion: 6,
  category: "food",
  food: 8,
});
item("paper", "纸", "#efe8d3", { introducedVersion: 6 });
item("leather", "皮革", "#a56c40", { introducedVersion: 6 });
item("book", "书", "#9a6940", { introducedVersion: 6 });
item("wheat_seeds", "小麦种子", "#7c9a40");
item("wheat", "小麦", "#d2b655");
item("carrot", "胡萝卜", "#ee872d", { category: "food", food: 3 });
item("potato", "马铃薯", "#b99154", { category: "food", food: 1 });
item("poisonous_potato", "毒马铃薯", "#9b9f43", { category: "food", food: 2 });
item("beetroot_seeds", "甜菜种子", "#81523c");
item("beetroot", "甜菜根", "#a03952", { category: "food", food: 1 });
item("apple", "苹果", "#c54838", { category: "food", food: 4 });
item("bread", "面包", "#cc943e", { category: "food", food: 5 });
item("baked_potato", "烤马铃薯", "#d0a358", { category: "food", food: 5 });
item("bowl", "碗", "#916741");
item("beetroot_soup", "甜菜汤", "#a54359", {
  category: "food",
  food: 6,
  foodRemainder: "bowl",
  maxStack: 1,
});
item("bone_meal", "骨粉", "#dbe0cd");
item("shears", "剪刀", "#bdc5c2", {
  category: "tools",
  maxStack: 1,
  maxDurability: 238,
});
item("bucket", "铁桶", "#b8c6ce", { category: "tools", maxStack: 16 });
item("water_bucket", "水桶", "#5898ce", { category: "tools", maxStack: 1 });
for (const [material, title, tier, miningSpeed, maxDurability, color] of [
  ["wood", "木", 1, 2, 59, "#ad7d45"],
  ["stone", "石", 2, 4, 131, "#858b8d"],
  ["iron", "铁", 3, 6, 250, "#d4dfe3"],
  ["gold", "金", 1, 12, 32, "#f4ce53"],
  ["diamond", "钻石", 4, 8, 1561, "#61e1d9"],
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
      miningSpeed,
      maxDurability,
      damage: baseDamage + tier,
      fuel: material === "wood" ? 10 : undefined,
      ...(["gold", "diamond"].includes(material)
        ? { introducedVersion: 4 as const }
        : {}),
    });
  }
}
for (const [material, title, color, toughness, protection, durability] of [
  ["iron", "铁", "#c4d0d5", 0, [2, 6, 5, 2], [165, 240, 225, 195]],
  ["gold", "金", "#f4ce53", 0, [2, 5, 3, 1], [77, 112, 105, 91]],
  ["diamond", "钻石", "#61e1d9", 2, [3, 8, 6, 3], [363, 528, 495, 429]],
] as const) {
  const pieces = [
    ["helmet", "头盔", "head"],
    ["chestplate", "胸甲", "chest"],
    ["leggings", "护腿", "legs"],
    ["boots", "靴子", "feet"],
  ] as const;
  pieces.forEach(([id, name, armorSlot], index) =>
    item(`${material}_${id}`, `${title}${name}`, color, {
      category: "tools",
      maxStack: 1,
      armorSlot,
      armorPoints: protection[index],
      maxDurability: durability[index],
      ...(toughness ? { armorToughness: toughness } : {}),
      ...(material !== "iron" ? { introducedVersion: 4 as const } : {}),
    }),
  );
}

/** Adult cow base drops, before Looting; consumed by the entity kill rules. */
export const COW_DROP_RANGES = {
  raw_beef: [1, 3],
  leather: [0, 2],
} as const;

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
  cow: {
    kind: "cow",
    name: "牛",
    health: 10,
    speed: 1,
    hostile: false,
    drops: [
      { id: "raw_beef", count: 2 },
      { id: "leather", count: 1 },
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

ITEMS.lava_bucket = {
  id: "lava_bucket",
  name: "熔岩桶",
  category: "tools",
  maxStack: 1,
  color: "#ef722e",
  fuel: 1000,
  fuelRemainder: "bucket",
};
