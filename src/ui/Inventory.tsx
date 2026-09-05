import { useEffect, useState } from "react";
import type {
  GameUIBridge,
  GameSnapshot,
  Overlay,
  RecipeDefinition,
  Slot,
} from "../game/types";
import { ITEMS } from "../game/registry";
import { Icon, ItemIcon, StackView } from "./Icons";

const categories = [
  { id: "all", name: "全部物品" },
  { id: "building", name: "建筑方块" },
  { id: "tools", name: "工具装备" },
  { id: "materials", name: "材料" },
  { id: "food", name: "食物" },
];
const armorNames = { head: "头盔", chest: "胸甲", legs: "护腿", feet: "靴子" };
export function Inventory({
  game,
  snapshot,
  overlay,
  close,
}: {
  game: GameUIBridge;
  snapshot: GameSnapshot;
  overlay: Overlay;
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [activeTab, setActiveTab] = useState<"recipes" | "creative">("recipes");
  const cursor = game.getCursor();
  const container = game.getContainer();
  const craft = game.getCraftSlots();
  const output = game.getCraftOutput();
  const isCreative = snapshot.manifest.mode === "creative";
  const crafting = overlay === "inventory" || overlay === "workbench";
  const title =
    overlay === "workbench"
      ? "工作台"
      : overlay === "chest"
        ? "储物箱"
        : overlay === "furnace"
          ? "熔炉"
          : "背包与合成";
  useEffect(() => {
    const fn = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", fn);
    return () => window.removeEventListener("mousemove", fn);
  }, []);
  const slot = (
    stack: Slot,
    index: number | string,
    source: "inventory" | "craft" | "container" | "armor",
    label?: string,
  ) => (
    <button
      type="button"
      key={`${source}-${index}`}
      className={`item-slot ${source === "inventory" && Number(index) === snapshot.player.selected ? "equipped" : ""}`}
      title={
        stack
          ? `${ITEMS[stack.id]?.name || stack.id}${stack.durability !== undefined ? ` · 耐久 ${stack.durability}` : ""}`
          : label || "空物品栏"
      }
      aria-label={`${label || source + " " + index}${stack ? "：" + (ITEMS[stack.id]?.name || stack.id) + " × " + stack.count : "：空"}`}
      onClick={(e) => game.clickSlot(source, index, false, e.shiftKey)}
      onContextMenu={(e) => {
        e.preventDefault();
        game.clickSlot(source, index, true, e.shiftKey);
      }}
    >
      {stack ? (
        <StackView stack={stack} />
      ) : (
        label && <span className="empty-slot-label">{label}</span>
      )}
    </button>
  );
  const ingredients = (recipe: RecipeDefinition) =>
    recipe.ingredients ||
    Object.fromEntries(
      [
        ...new Set(
          (recipe.pattern || [])
            .join("")
            .split("")
            .filter((x) => x !== " "),
        ),
      ].map((key) => [
        recipe.keys?.[key] || key,
        (recipe.pattern || [])
          .join("")
          .split("")
          .filter((x) => x === key).length,
      ]),
    );
  const available = (recipe: RecipeDefinition) =>
    Object.entries(ingredients(recipe)).every(
      ([id, n]) =>
        snapshot.player.inventory.reduce(
          (sum, s) => sum + (s?.id === id ? s.count : 0),
          0,
        ) >= n,
    );
  const recipeList = game
    .getRecipes()
    .filter(
      (r) => r.name.includes(query) || ITEMS[r.output.id]?.name.includes(query),
    );
  return (
    <div
      className="overlay inventory-overlay"
      onContextMenu={(e) => e.preventDefault()}
    >
      <section
        className="inventory-window"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="window-header">
          <div>
            <span className="eyebrow dark">物品与制作</span>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button dark-icon"
            onClick={close}
            title="返回游戏（E）"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className={`inventory-body ${crafting ? "" : "no-recipes"}`}>
          <div className="inventory-main">
            {crafting && (
              <div className="crafting-workspace">
                <div className="armor-column">
                  <span className="section-label">装备</span>
                  {Object.entries(armorNames).map(([key, name]) =>
                    slot(
                      snapshot.player.armor[key as keyof typeof armorNames],
                      key,
                      "armor",
                      name,
                    ),
                  )}
                </div>
                <div className="crafting-area">
                  <div className="section-heading">
                    <h3>
                      {overlay === "workbench" ? "工作台合成" : "便携合成"}
                    </h3>
                    <span>{overlay === "workbench" ? "3 × 3" : "2 × 2"}</span>
                  </div>
                  <div className="crafting-flow">
                    <div
                      className={`craft-grid ${overlay === "workbench" ? "three" : "two"}`}
                    >
                      {craft.map((s, i) => slot(s, i, "craft"))}
                    </div>
                    <Icon name="arrow" size={28} />
                    <button
                      className="item-slot output-slot"
                      onClick={() => game.takeCraftOutput()}
                      title={
                        output
                          ? `取出${ITEMS[output.id]?.name || output.id}`
                          : "将材料按配方排列"
                      }
                      aria-label="合成结果"
                    >
                      {output ? (
                        <StackView stack={output} />
                      ) : (
                        <Icon name="spark" size={25} />
                      )}
                    </button>
                  </div>
                  <p className="craft-note">排列材料，点击右侧取出成品。</p>
                </div>
              </div>
            )}
            {overlay === "chest" && container?.kind === "chest" && (
              <div className="container-area">
                <div className="section-heading">
                  <h3>箱内物品</h3>
                  <span>
                    {container.slots.filter(Boolean).length} /{" "}
                    {container.slots.length}
                  </span>
                </div>
                <div className="inventory-grid">
                  {container.slots.map((s, i) => slot(s, i, "container"))}
                </div>
              </div>
            )}
            {overlay === "furnace" && container?.kind === "furnace" && (
              <div className="furnace-area">
                <div className="furnace-input">
                  <span className="section-label">原料</span>
                  {slot(container.slots[0], 0, "container")}
                  <div className="flame-meter">
                    <svg
                      width="24"
                      height="31"
                      viewBox="0 0 16 20"
                      shapeRendering="crispEdges"
                    >
                      <path
                        d="M7 0h2v5h3v3h2v8h-2v3H4v-3H2v-6h2V6h2V3h1V0Z"
                        fill={container.burn > 0 ? "#d98b39" : "#c1bbaa"}
                      />
                      <path
                        d="M7 9h2v3h2v4H9v2H6v-2H5v-4h2V9Z"
                        fill={container.burn > 0 ? "#ffe2a0" : "#e0dbcd"}
                      />
                    </svg>
                    <span>{container.burn > 0 ? "燃烧中" : "等待燃料"}</span>
                  </div>
                  {slot(container.slots[1], 1, "container")}
                  <span className="section-label">燃料</span>
                </div>
                <div className="smelt-progress">
                  <span>熔炼进度</span>
                  <div>
                    <i
                      style={{
                        width: `${Math.min(100, (container.progress / 10) * 100)}%`,
                      }}
                    />
                  </div>
                  <Icon name="arrow" size={28} />
                </div>
                <div className="furnace-result">
                  <span className="section-label">成品</span>
                  {slot(container.slots[2], 2, "container")}
                  <span className="muted">
                    {Math.min(100, Math.floor((container.progress / 10) * 100))}
                    %
                  </span>
                </div>
              </div>
            )}
            <div className="inventory-items">
              <div className="section-heading">
                <h3>随身物品</h3>
                <span>27 个储物格</span>
              </div>
              <div className="inventory-grid">
                {snapshot.player.inventory
                  .slice(9, 36)
                  .map((s, i) => slot(s, i + 9, "inventory"))}
              </div>
              <div className="section-heading hotbar-heading">
                <h3>快捷栏</h3>
                <span>1 — 9</span>
              </div>
              <div className="inventory-grid hotbar-inventory">
                {snapshot.player.inventory
                  .slice(0, 9)
                  .map((s, i) => slot(s, i, "inventory"))}
              </div>
            </div>
          </div>
          {crafting && (
            <aside className="recipe-panel">
              <div className="recipe-tabs">
                <button
                  className={activeTab === "recipes" ? "active" : ""}
                  onClick={() => setActiveTab("recipes")}
                >
                  配方手册
                </button>
                {isCreative && (
                  <button
                    className={activeTab === "creative" ? "active" : ""}
                    onClick={() => setActiveTab("creative")}
                  >
                    创造物品
                  </button>
                )}
              </div>
              <label className="search-box">
                <Icon name="search" size={16} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    activeTab === "recipes" ? "搜索配方" : "搜索物品"
                  }
                  aria-label="搜索物品或配方"
                />
              </label>
              {activeTab === "creative" && isCreative ? (
                <>
                  <select
                    className="category-select"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    aria-label="物品分类"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <div className="creative-grid">
                    {Object.values(ITEMS)
                      .filter(
                        (item) =>
                          (category === "all" || item.category === category) &&
                          item.name.includes(query),
                      )
                      .map((item) => (
                        <button
                          key={item.id}
                          className="item-slot"
                          title={`${item.name} · 点击获取`}
                          onClick={() => game.giveItem(item.id)}
                        >
                          <ItemIcon id={item.id} />
                        </button>
                      ))}
                  </div>
                  <p className="recipe-hint">点击物品，将一组物品放入背包。</p>
                </>
              ) : (
                <>
                  <div className="recipe-list">
                    {recipeList.map((recipe) => (
                      <button
                        className={`recipe ${available(recipe) ? "can-craft" : ""}`}
                        key={recipe.id}
                        disabled={!available(recipe)}
                        title={Object.entries(ingredients(recipe))
                          .map(([id, n]) => `${ITEMS[id]?.name || id} × ${n}`)
                          .join("、")}
                        onClick={() =>
                          game.command({ type: "craft", recipeId: recipe.id })
                        }
                      >
                        <span className="recipe-icon">
                          <ItemIcon id={recipe.output.id} size={30} />
                        </span>
                        <span className="recipe-copy">
                          <strong>
                            {recipe.name || ITEMS[recipe.output.id]?.name}
                          </strong>
                          <small>
                            {Object.entries(ingredients(recipe))
                              .map(([id, n]) => `${ITEMS[id]?.name || id} ${n}`)
                              .join(" · ")}
                          </small>
                        </span>
                        <span className="recipe-yield">
                          ×{recipe.output.count}
                        </span>
                      </button>
                    ))}
                    {recipeList.length === 0 && (
                      <p className="no-results">没有匹配的配方</p>
                    )}
                  </div>
                  <p className="recipe-hint">
                    <span className="status-dot" />
                    材料充足时，点击配方直接制作。
                    {overlay === "inventory" ? "更多配方需要工作台。" : ""}
                  </p>
                </>
              )}
            </aside>
          )}
        </div>
        <footer className="inventory-footer">
          <span>
            <kbd>左键</kbd> 拿起 / 放下
          </span>
          <span>
            <kbd>右键</kbd> 拆分 / 放一个
          </span>
          <span>
            <kbd>Shift</kbd> + 点击快速移动
          </span>
          <button className="text-button" onClick={close}>
            返回游戏 <kbd>E</kbd>
          </button>
        </footer>
      </section>
      {cursor && (
        <div
          className="cursor-stack"
          style={{ left: mouse.x + 12, top: mouse.y + 12 }}
        >
          <StackView stack={cursor} />
        </div>
      )}
    </div>
  );
}
