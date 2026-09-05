import {
  ENCHANTMENTS,
  canApplyEnchantment,
  validateEnchantments,
  type EnchantmentId,
} from "./enchantments";
import { experienceStatus, MAX_EXPERIENCE } from "./experience";
import { ITEMS } from "./registry";
import type { ItemStack, Slot, WorkshopView } from "./types";

export const MAX_REPAIR_COST = 2_147_483_647;
export const ANVIL_TOO_EXPENSIVE = 40;
/** Java 1.21.1 enchantment data's anvil_cost, before the enchanted-book discount. */
export const ANVIL_ENCHANTMENT_COST: Readonly<Record<EnchantmentId, number>> =
  Object.freeze({
    efficiency: 1,
    unbreaking: 2,
    fortune: 4,
    silk_touch: 8,
    sharpness: 1,
    protection: 1,
    feather_falling: 2,
    respiration: 4,
  });

/** UTF-16 length matches the Java limit. C1 controls are additionally excluded from this save format. */
export function normalizeItemName(name: string): string | null {
  if (typeof name !== "string") return null;
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f\u00a7]/g, "");
  if (clean.length > 50) return null;
  // Also treat a BOM-only string as blank, matching the save format's nonblank requirement.
  return clean.trim().length ? clean : "";
}

export function nextRepairCost(prior: number): number {
  if (!Number.isInteger(prior) || prior < 0 || prior > MAX_REPAIR_COST)
    throw new RangeError("Invalid prior repair cost");
  return Math.min(MAX_REPAIR_COST, prior * 2 + 1);
}

function copy(stack: ItemStack): ItemStack {
  return {
    ...stack,
    ...(stack.enchantments ? { enchantments: { ...stack.enchantments } } : {}),
  };
}

function validStack(stack: Slot): boolean {
  if (stack === null) return true;
  const item = ITEMS[stack.id];
  return (
    !!item &&
    Number.isInteger(stack.count) &&
    stack.count >= 1 &&
    stack.count <= item.maxStack &&
    (stack.durability === undefined ||
      (!!item.maxDurability &&
        Number.isInteger(stack.durability) &&
        stack.durability >= 1 &&
        stack.durability <= item.maxDurability)) &&
    (stack.repairCost === undefined ||
      (Number.isInteger(stack.repairCost) &&
        stack.repairCost >= 0 &&
        stack.repairCost <= MAX_REPAIR_COST)) &&
    (stack.customName === undefined ||
      (normalizeItemName(stack.customName) === stack.customName &&
        stack.customName.length > 0)) &&
    (stack.enchantments === undefined ||
      validateEnchantments(stack.id, stack.enchantments, true)) &&
    (stack.id !== "enchanted_book" || stack.enchantments !== undefined)
  );
}

function view(
  kind: WorkshopView["kind"],
  name = "",
  reason?: string,
): WorkshopView {
  return {
    kind,
    output: null,
    levelCost: 0,
    materialCost: 0,
    experienceMin: 0,
    experienceMax: 0,
    available: false,
    name,
    ...(reason ? { reason } : {}),
  };
}

/** Material repair excludes shears: Java's ShearsItem inherits Item's non-repairable material rule. */
export function isRepairMaterial(itemId: string, materialId: string): boolean {
  const item = ITEMS[itemId];
  if (!item?.maxDurability || (!item.tool && !item.armorSlot)) return false;
  const material = itemId.split("_")[0];
  switch (material) {
    case "wood":
      return materialId === "planks";
    case "stone":
      return materialId === "cobblestone" || materialId === "cobbled_deepslate";
    case "iron":
      return materialId === "iron_ingot";
    case "gold":
      return materialId === "gold_ingot";
    case "diamond":
      return materialId === "diamond";
    default:
      return false;
  }
}

/**
 * A side-effect-free quote. Taking the result must revalidate inputs, spend levels,
 * clear the entire left stack, and consume materialCost units from the right.
 * The output remains visible when level-gated, unlike Java's hidden expensive slot.
 */
export function getAnvilResult(
  left: Slot,
  right: Slot,
  name: string,
  points: number,
  creative: boolean,
): WorkshopView {
  const normalized = normalizeItemName(name);
  const result = view("anvil", normalized ?? name);
  const reject = (reason: string) => ({ ...result, reason });
  if (normalized === null) return reject("名称不能超过 50 个字符");
  if (!validStack(left) || !validStack(right)) return reject("物品数据无效");
  if (!left) return reject("放入要修复、合并或命名的物品");
  if (!Number.isFinite(points) || points < 0 || points > MAX_EXPERIENCE)
    return reject("经验数据无效");
  const output = copy(left);
  const max = ITEMS[left.id].maxDurability ?? 0;
  const remaining = left.durability ?? max;
  let work = 0;
  let rename = 0;
  let materialCost = right?.count ?? 0;
  if (right) {
    const book = right.id === "enchanted_book";
    if (max > 0 && isRepairMaterial(left.id, right.id)) {
      const perMaterial = Math.floor(max / 4);
      if (remaining >= max || perMaterial === 0)
        return reject("这件装备无需材料修复");
      materialCost = Math.min(
        right.count,
        Math.ceil((max - remaining) / perMaterial),
      );
      output.durability = Math.min(max, remaining + materialCost * perMaterial);
      work += materialCost;
    } else {
      if (!book && (left.id !== right.id || !max))
        return reject("需要同种装备、修复材料或附魔书");
      if (max > 0 && !book) {
        const durability = Math.min(
          max,
          remaining + (right.durability ?? max) + Math.floor(max * 0.12),
        );
        if (durability > remaining) {
          output.durability = durability;
          work += 2;
        }
      }
      const enchantments = { ...left.enchantments };
      let accepted = false;
      let rejected = false;
      for (const [key, donorLevel] of Object.entries(
        right.enchantments ?? {},
      )) {
        const id = key as EnchantmentId;
        const definition = ENCHANTMENTS[id];
        // An ordinary book's normal enchantments are not a survival book target.
        let compatible =
          creative ||
          left.id === "enchanted_book" ||
          (left.id !== "book" && canApplyEnchantment(left.id, id));
        for (const existing of Object.keys(enchantments) as EnchantmentId[]) {
          if (existing !== id && definition.incompatible.includes(existing)) {
            compatible = false;
            work++;
          }
        }
        if (!compatible) {
          rejected = true;
          continue;
        }
        accepted = true;
        const current = enchantments[id] ?? 0;
        const level = Math.min(
          definition.maxLevel,
          current === donorLevel
            ? donorLevel + 1
            : Math.max(current, donorLevel),
        );
        enchantments[id] = level;
        const cost = ANVIL_ENCHANTMENT_COST[id];
        work += (book ? Math.max(1, Math.floor(cost / 2)) : cost) * level;
        if (left.count > 1) work = ANVIL_TOO_EXPENSIVE;
      }
      if (rejected && !accepted) return reject("附魔与目标物品不兼容");
      if (Object.keys(enchantments).length) output.enchantments = enchantments;
    }
  }
  const previousName = left.customName ?? ITEMS[left.id].name;
  if (normalized) {
    if (normalized !== previousName) {
      output.customName = normalized;
      rename = 1;
    }
  } else if (left.customName !== undefined) {
    delete output.customName;
    rename = 1;
  }
  work += rename;
  if (work <= 0) return reject("没有可执行的修复、合并或命名");
  const prior = left.repairCost ?? 0;
  const donorPrior = right?.repairCost ?? 0;
  let levelCost = Math.min(MAX_REPAIR_COST, prior + donorPrior + work);
  const renameOnly = rename === work;
  if (renameOnly && levelCost >= ANVIL_TOO_EXPENSIVE) levelCost = 39;
  const next = renameOnly
    ? Math.max(prior, donorPrior)
    : nextRepairCost(Math.max(prior, donorPrior));
  if (next) output.repairCost = next;
  else delete output.repairCost;
  const reason =
    !creative && levelCost >= ANVIL_TOO_EXPENSIVE
      ? "过于昂贵！生存模式最多消耗 39 级"
      : !creative && experienceStatus(points).level < levelCost
        ? `需要 ${levelCost} 级经验`
        : undefined;
  return {
    ...result,
    output,
    levelCost,
    materialCost,
    available: !reason,
    ...(reason ? { reason } : {}),
  };
}

function sameComponents(a: ItemStack, b: ItemStack) {
  return (
    a.id === b.id &&
    a.customName === b.customName &&
    (a.repairCost ?? 0) === (b.repairCost ?? 0) &&
    a.durability === b.durability &&
    Object.keys(a.enchantments ?? {}).length ===
      Object.keys(b.enchantments ?? {}).length &&
    Object.entries(a.enchantments ?? {}).every(
      ([key, value]) => b.enchantments?.[key] === value,
    )
  );
}

/** Both occupied slots are consumed on collection; experience is rolled only at collection time. */
export function getGrindstoneResult(left: Slot, right: Slot): WorkshopView {
  const result = view("grindstone");
  const reject = (reason: string) => ({ ...result, reason });
  if (!validStack(left) || !validStack(right)) return reject("物品数据无效");
  if (!left && !right) return reject("放入附魔物品，或两件同种装备");
  if ((left?.count ?? 0) > 1 || (right?.count ?? 0) > 1)
    return reject("每个输入格只能放入一件物品");
  const first = left ?? right!;
  const hasEnchantments = (stack: ItemStack) =>
    Object.keys(stack.enchantments ?? {}).length > 0;
  let output = copy(first);
  if (!left || !right) {
    if (!hasEnchantments(first)) return reject("单件物品需要带有附魔");
  } else {
    if (left.id !== right.id) return reject("修复需要两件同种物品");
    const item = ITEMS[left.id];
    if (item.maxDurability) {
      const max = item.maxDurability;
      output.durability = Math.min(
        max,
        (left.durability ?? max) +
          (right.durability ?? max) +
          Math.floor(max * 0.05),
      );
    } else {
      // Only creative-enchanted stackable items can reach this branch via legal slots.
      if (
        item.maxStack < 2 ||
        !sameComponents(left, right) ||
        !hasEnchantments(left)
      )
        return reject("这两件物品不能在砂轮中合并");
      output.count = 2;
    }
  }
  // None of the eight implemented enchantments is a curse. Future curse support
  // must retain curse metadata and rebuild its prior-work penalty before release.
  delete output.enchantments;
  delete output.repairCost;
  if (output.id === "enchanted_book") output.id = "book";
  const sum = [left, right].reduce(
    (total, stack) =>
      total +
      Object.entries(stack?.enchantments ?? {}).reduce(
        (subtotal, [key, level]) => {
          const cost = ENCHANTMENTS[key as EnchantmentId].minCost;
          return subtotal + cost.a * level + cost.b;
        },
        0,
      ),
    0,
  );
  const experienceMin = Math.ceil(sum / 2);
  return {
    ...result,
    output,
    materialCost: right?.count ?? 0,
    experienceMin,
    experienceMax: sum > 0 ? experienceMin * 2 - 1 : 0,
    available: true,
    name: output.customName ?? ITEMS[output.id].name,
  };
}
