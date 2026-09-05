import type { ReactNode } from "react";
import type { EnchantingView, GameUIBridge, Slot } from "../game/types";
import { experienceStatus } from "../game/experience";
import { enchantmentLabel } from "./item-details";
import { Icon, ItemIcon } from "./Icons";

export function ExperienceBar({ points }: { points: number }) {
  const status = experienceStatus(points);
  return (
    <div
      className="experience-meter"
      role="progressbar"
      aria-label={`经验等级 ${status.level}`}
      aria-valuemin={0}
      aria-valuemax={status.pointsToNextLevel}
      aria-valuenow={status.pointsIntoLevel}
      aria-valuetext={`${status.level} 级，距下一级还需 ${Math.ceil(status.pointsToNextLevel - status.pointsIntoLevel)} 经验`}
      title={`${status.level} 级 · ${Math.floor(status.pointsIntoLevel)} / ${status.pointsToNextLevel} 经验`}
    >
      <strong className="experience-level">{status.level}</strong>
      <span className="experience-track">
        <i style={{ width: `${status.progress * 100}%` }} />
      </span>
    </div>
  );
}

export function EnchantingWorkspace({
  view,
  slots,
  game,
  renderSlot,
}: {
  view: EnchantingView | null;
  slots: Slot[];
  game: Pick<GameUIBridge, "command">;
  renderSlot: (stack: Slot, index: number, label: string) => ReactNode;
}) {
  const freeEnchanting =
    !!view?.offers.length &&
    view.offers.every(
      (offer) => offer.levelCost === 0 && offer.lapisCost === 0,
    );
  return (
    <div className="enchanting-workspace">
      <div className="enchanting-summary">
        <span className="enchanting-emblem">
          <ItemIcon id="enchanting_table" size={44} />
        </span>
        <div>
          <h3>让装备拥有新的力量</h3>
          <p>
            {freeEnchanting
              ? "放入装备即可附魔，无需经验或青金石；也可放入一本书。"
              : "放入装备或书与青金石，再选择一项附魔。"}
          </p>
        </div>
      </div>
      <div className="enchanting-layout">
        <div className="enchanting-inputs">
          <label>
            <span>装备 / 书</span>
            {renderSlot(slots[0] ?? null, 0, "装备或书")}
          </label>
          <span className="enchanting-join">
            <Icon name="plus" size={14} />
          </span>
          <label>
            <span>{freeEnchanting ? "青金石（可留空）" : "青金石"}</span>
            {renderSlot(slots[1] ?? null, 1, "青金石")}
          </label>
          <small>附魔后，点击物品取回。</small>
        </div>
        <div className="enchanting-offers" aria-label="可选附魔">
          {view?.offers.length
            ? view.offers.map((offer) => (
                <button
                  key={offer.option}
                  className={`enchanting-offer ${offer.available ? "available" : "unavailable"}`}
                  disabled={!offer.available}
                  title={offer.reason}
                  onClick={() =>
                    game.command({ type: "enchant", option: offer.option })
                  }
                >
                  <span className="enchanting-option">
                    {["I", "II", "III"][offer.option]}
                  </span>
                  <span className="enchanting-offer-copy">
                    <strong>
                      {offer.hint
                        ? enchantmentLabel(offer.hint.id, offer.hint.level)
                        : "等待合适的装备"}
                    </strong>
                    <span>
                      {freeEnchanting ? "强度参考" : "需达到"}{" "}
                      <b>{offer.requiredLevel} 级</b>
                    </span>
                    <small>
                      {freeEnchanting
                        ? "创造模式 · 不消耗经验或青金石"
                        : `实际消耗 ${offer.levelCost} 级经验 · ${offer.lapisCost} 个青金石`}
                    </small>
                    {offer.reason && <em>{offer.reason}</em>}
                  </span>
                  <Icon name={offer.available ? "spark" : "info"} size={18} />
                </button>
              ))
            : [0, 1, 2].map((option) => (
                <button
                  className="enchanting-offer unavailable"
                  key={option}
                  disabled
                >
                  <span className="enchanting-option">
                    {["I", "II", "III"][option]}
                  </span>
                  <span className="enchanting-offer-copy">
                    <strong>等待合适的装备</strong>
                    <small>放入一件尚未附魔的装备或一本书</small>
                  </span>
                </button>
              ))}
        </div>
      </div>
      <div className="enchanting-status">
        <span>
          {freeEnchanting ? (
            <>
              创造模式 <b>无需等级</b>
            </>
          ) : (
            <>
              当前经验 <b>{view?.level ?? 0} 级</b>
            </>
          )}
        </span>
        <span>
          有效书架 <b>{view?.bookshelves ?? 0} / 15</b>
        </span>
      </div>
      <p className="enchanting-note">
        书架与附魔台之间留出一格空隙。提示展示其中一项附魔，完成后可查看全部效果。
      </p>
    </div>
  );
}
