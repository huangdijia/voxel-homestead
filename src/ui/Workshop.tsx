import type { ReactNode } from "react";
import type { GameUIBridge, Slot, WorkshopView } from "../game/types";
import { Icon, ItemIcon, StackView } from "./Icons";
import { itemDescription } from "./item-details";

export function WorkshopWorkspace({
  view,
  kind,
  slots,
  game,
  renderSlot,
}: {
  view: WorkshopView | null;
  kind: "anvil" | "grindstone";
  slots: Slot[];
  game: Pick<GameUIBridge, "command">;
  renderSlot: (stack: Slot, index: number, label: string) => ReactNode;
}) {
  const anvil = kind === "anvil";
  const experience = view?.experienceMax
    ? view.experienceMin === view.experienceMax
      ? `${view.experienceMin} 点经验`
      : `${view.experienceMin}–${view.experienceMax} 点经验`
    : "无经验返还";
  return (
    <div className={`workshop-workspace ${kind}-workspace`}>
      <div className="enchanting-summary">
        <span className="enchanting-emblem">
          <ItemIcon id={kind} size={44} />
        </span>
        <div>
          <h3>{anvil ? "修复、合并与命名" : "修复装备，卸下附魔"}</h3>
          <p>
            {anvil
              ? "用材料修复耐久，或把附魔书与装备合并。"
              : "放入附魔物品以移除附魔，或合并两件同类装备。"}
          </p>
        </div>
      </div>
      {anvil && (
        <label className="workshop-name">
          <span>
            物品名称 <small>最多 50 个字符</small>
          </span>
          <input
            value={view?.name ?? ""}
            disabled={!slots[0]}
            maxLength={50}
            placeholder="放入左侧物品后命名"
            aria-label="物品名称"
            onChange={(event) =>
              game.command({ type: "workshopName", name: event.target.value })
            }
          />
        </label>
      )}
      <div className="workshop-flow">
        <div className="workshop-input">
          <span>{anvil ? "要修复的物品" : "物品一"}</span>
          {renderSlot(slots[0] ?? null, 0, anvil ? "要修复的物品" : "物品一")}
        </div>
        <Icon name="plus" size={18} />
        <div className="workshop-input">
          <span>{anvil ? "材料 / 同类物品 / 附魔书" : "物品二（可留空）"}</span>
          {renderSlot(slots[1] ?? null, 1, anvil ? "材料或附魔书" : "物品二")}
        </div>
        <Icon name="arrow" size={24} />
        <div className="workshop-input workshop-result">
          <span>结果</span>
          <button
            type="button"
            className="item-slot output-slot"
            disabled={!view?.available || !view.output}
            title={
              view?.output
                ? `${itemDescription(view.output)}${view.reason ? `\n${view.reason}` : "\n点击取出；Shift + 点击放入背包"}`
                : (view?.reason ?? "放入物品查看结果")
            }
            aria-label={
              view?.output
                ? `取出${itemDescription(view.output)}`
                : "加工结果为空"
            }
            onClick={(event) =>
              game.command({
                type: "takeWorkshopOutput",
                shift: event.shiftKey,
              })
            }
          >
            {view?.output ? (
              <StackView stack={view.output} />
            ) : (
              <Icon name="spark" size={25} />
            )}
          </button>
        </div>
      </div>
      <div
        className={`workshop-status ${view?.available ? "available" : "unavailable"}`}
        role="status"
        aria-live="polite"
      >
        {anvil ? (
          <span>
            {view?.output
              ? `消耗 ${view.levelCost} 级经验${view.materialCost > 0 ? ` · 右侧物品 × ${view.materialCost}` : ""}`
              : "等待可加工的物品"}
          </span>
        ) : (
          <span>{experience}</span>
        )}
        {view?.reason && <strong>{view.reason}</strong>}
      </div>
      <p className="workshop-note">
        {anvil
          ? "反复加工会增加经验花费。更名时可将名称清空以恢复原名。"
          : "移除附魔后经验以光球返还。两件同类装备可合并耐久，无需经验。"}
        <span>点击结果完成操作；Shift + 点击直接放入背包。</span>
      </p>
    </div>
  );
}
