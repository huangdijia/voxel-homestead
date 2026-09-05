import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Game, createPreview, DEFAULT_SETTINGS } from "./game/Game";
import { createNewSave } from "./game/Simulation";
import {
  deleteWorld,
  exportWorld,
  importWorld,
  listWorlds,
  loadWorld,
  saveWorld,
  migrationBackupIds,
  exportMigrationBackup,
} from "./game/storage";
import { ITEMS } from "./game/registry";
import type {
  GameMode,
  GameSnapshot,
  GameUIBridge,
  Overlay,
  SaveData,
  SaveManifest,
  Settings,
} from "./game/types";
import { Icon, ItemIcon, StackView } from "./ui/Icons";
import { Inventory } from "./ui/Inventory";
import "./styles.css";

const settingsKey = "block-journey-settings-v1";
function readSettings(): Settings {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(localStorage.getItem(settingsKey) || "{}"),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function worldDate(time: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);
}
function playedTime(seconds: number) {
  return seconds < 60
    ? "新的开始"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} 分钟`
      : `${(seconds / 3600).toFixed(1)} 小时`;
}
function downloadStatus(snapshot: GameSnapshot) {
  return snapshot.saveStatus === "saving"
    ? "正在保存…"
    : snapshot.saveStatus === "error"
      ? "保存失败，请重试"
      : snapshot.saveStatus === "dirty"
        ? "等待保存"
        : "进度已保存";
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewDispose = useRef<null | (() => void)>(null);
  const [game, setGame] = useState<GameUIBridge | null>(null);
  const [worlds, setWorlds] = useState<SaveManifest[]>([]);
  const [backupIds, setBackupIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [modal, setModal] = useState<"create" | "settings" | "help" | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<SaveManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const reloadWorlds = useCallback(async () => {
    setListLoading(true);
    try {
      const [worldList, backups] = await Promise.all([
        listWorlds(),
        migrationBackupIds(),
      ]);
      setWorlds(worldList);
      setBackupIds(backups);
    } catch (e) {
      setError(String(e));
    } finally {
      setListLoading(false);
    }
  }, []);
  useEffect(() => {
    void reloadWorlds();
  }, [reloadWorlds]);
  useEffect(() => {
    if (game || !canvasRef.current) return;
    try {
      previewDispose.current = createPreview(canvasRef.current);
    } catch (e) {
      setError(
        `世界预览暂不可用：${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return () => {
      previewDispose.current?.();
      previewDispose.current = null;
    };
  }, [game]);
  const updateSettings = (next: Settings) => {
    setSettings(next);
    try {
      localStorage.setItem(settingsKey, JSON.stringify(next));
    } catch {}
    game?.updateSettings(next);
  };
  const launch = async (save: SaveData) => {
    previewDispose.current?.();
    previewDispose.current = null;
    if (!canvasRef.current) throw new Error("游戏画布尚未准备好");
    const instance = new Game(canvasRef.current, save, settings);
    setGame(instance);
    setModal(null);
  };
  const enter = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const save = await loadWorld(id);
      if (!save) throw new Error("这个世界的存档不存在");
      await launch(save);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const create = async (name: string, seed: string, mode: GameMode) => {
    setBusy(true);
    setError("");
    try {
      const save = createNewSave(
        name.trim() || "新的世界",
        seed.trim() || String(Math.floor(Math.random() * 999999999)),
        mode,
      );
      await saveWorld(save);
      await launch(save);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const quit = async () => {
    if (!game) return;
    await game.save();
    game.dispose();
    setGame(null);
    await reloadWorlds();
  };
  const doImport = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      await importWorld(await file.text());
      await reloadWorlds();
    } catch (e) {
      setError(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={`app ${game ? "in-game" : "in-menu"}`}>
      <canvas
        ref={canvasRef}
        className="world-canvas"
        aria-label="三维方块世界"
      />
      {!game ? (
        <div className="home-screen">
          <header className="home-header">
            <a
              className="brand"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setModal(null);
              }}
              aria-label="方块纪行首页"
            >
              <span className="brand-mark">
                <Icon name="cube" size={25} />
              </span>
              <span>
                方块纪行
                <span className="brand-divider" />
                BLOCK JOURNEY
              </span>
            </a>
            <div className="home-header-actions">
              <span className="single-player">
                <i />
                单人世界
              </span>
              <button
                className="header-button"
                onClick={() => setModal("settings")}
              >
                <Icon name="settings" size={18} />
                设置
              </button>
            </div>
          </header>
          <div className="home-content">
            <section className="home-intro">
              <div className="chapter-label">
                <span />
                从一块方块，开始一场冒险
              </div>
              <h1>
                我的世界<span className="logo-period">.</span>
              </h1>
              <div className="home-subtitle">方块纪行</div>
              <p className="intro-copy">
                走进森林，向山野出发。
                <br />
                采集、创造、生存，亲手建造属于你的世界。
              </p>
              <button
                className="button primary hero-button"
                onClick={() => setModal("create")}
                disabled={busy}
              >
                <Icon name="plus" size={22} />
                创建新世界
                <Icon name="arrow" size={20} />
              </button>
              <div className="intro-details">
                <span>
                  <Icon name="world" size={15} />
                  种子生成 · 自由探索
                </span>
                <span>
                  <Icon name="cube" size={15} />
                  生存 / 创造
                </span>
              </div>
            </section>
            <section className="world-library">
              <div className="library-header">
                <div>
                  <span className="eyebrow">继续你的旅程</span>
                  <h2>
                    你的世界
                    <span>{worlds.length.toString().padStart(2, "0")}</span>
                  </h2>
                </div>
                <button
                  className="icon-button library-add"
                  onClick={() => setModal("create")}
                  title="创建新世界"
                  disabled={busy}
                >
                  <Icon name="plus" />
                </button>
              </div>
              <div className="world-list">
                {listLoading ? (
                  <div className="world-list-loading">
                    <span className="loader-small" />
                    正在读取世界…
                  </div>
                ) : worlds.length === 0 ? (
                  <div className="world-empty">
                    <span className="empty-cube">
                      <Icon name="cube" size={56} />
                    </span>
                    <h3>这里，等着你的第一个世界</h3>
                    <p>
                      为世界取个名字，
                      <br />
                      从一片未经探索的原野开始。
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setModal("create")}
                    >
                      开启第一场冒险 <Icon name="arrow" size={17} />
                    </button>
                  </div>
                ) : (
                  worlds.map((world) => (
                    <article className="world-card" key={world.id}>
                      <button
                        className="world-card-main"
                        onClick={() => void enter(world.id)}
                        disabled={busy}
                      >
                        <div className="world-thumbnail">
                          <ItemIcon id="grass" size={53} />
                          <span className="thumbnail-sun" />
                        </div>
                        <div className="world-card-copy">
                          <div>
                            <h3>{world.name}</h3>
                            <span className={`mode-badge ${world.mode}`}>
                              {world.mode === "creative" ? "创造" : "生存"}
                            </span>
                          </div>
                          <p>种子 {world.seed}</p>
                          <small>
                            {worldDate(world.updatedAt)}
                            <span>·</span>
                            {playedTime(world.playedSeconds)}
                          </small>
                        </div>
                        <span className="world-enter">
                          <Icon name="arrow" size={20} />
                        </span>
                      </button>
                      <div className="world-card-bottom">
                        <span>
                          <span className="status-dot" />
                          本机存档
                        </span>
                        <div>
                          {backupIds.includes(world.id) && (
                            <button
                              title={`导出 ${world.name} 升级前备份`}
                              onClick={() => {
                                void exportMigrationBackup(world.id).catch(
                                  (e) => setError(String(e)),
                                );
                              }}
                            >
                              <Icon name="download" size={14} />
                              升级前备份
                            </button>
                          )}
                          <button
                            title={`导出 ${world.name}`}
                            onClick={() => {
                              void exportWorld(world.id).catch((e) =>
                                setError(String(e)),
                              );
                            }}
                          >
                            <Icon name="download" size={14} />
                            导出
                          </button>
                          <button
                            className="delete-world-button"
                            title={`删除 ${world.name}`}
                            onClick={() => setDeleteTarget(world)}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
              <div className="library-footer">
                <span>旅程会自动保存在此浏览器</span>
                <button
                  className="text-button"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                >
                  <Icon name="upload" size={15} />
                  导入世界
                </button>
              </div>
            </section>
          </div>
          <footer className="home-footer">
            <span>每一块，都有新的可能。</span>
            <div>
              <span className="version">耕作与牧场</span>
              <button onClick={() => setModal("help")}>
                操作指南
                <Icon name="info" size={15} />
              </button>
            </div>
          </footer>
        </div>
      ) : (
        <GameInterface
          game={game}
          settings={settings}
          updateSettings={updateSettings}
          quit={quit}
        />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        aria-label="导入世界存档"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void doImport(file);
          e.target.value = "";
        }}
      />
      {modal === "create" && (
        <CreateWorld
          busy={busy}
          onClose={() => setModal(null)}
          onCreate={create}
        />
      )}
      {modal === "settings" && (
        <SettingsDialog
          settings={settings}
          update={updateSettings}
          close={() => setModal(null)}
        />
      )}
      {modal === "help" && <HelpDialog close={() => setModal(null)} />}
      {deleteTarget && (
        <div className="overlay">
          <section
            className="dialog confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="删除世界"
          >
            <span className="dialog-icon">
              <Icon name="trash" size={26} />
            </span>
            <h2>删除这个世界？</h2>
            <p>
              “{deleteTarget.name}”
              的建筑、物品和探索进度都会被删除。你可以先在世界列表中导出备份。
            </p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => setDeleteTarget(null)}
              >
                保留世界
              </button>
              <button
                className="button danger"
                onClick={async () => {
                  try {
                    await deleteWorld(deleteTarget.id);
                    setDeleteTarget(null);
                    await reloadWorlds();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                删除世界
              </button>
            </div>
          </section>
        </div>
      )}
      {busy && !modal && !game && (
        <div className="global-busy">
          <span className="loader-small" />
          正在准备世界…
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <Icon name="info" />
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="关闭提示">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </main>
  );
}

function GameInterface({
  game,
  settings,
  updateSettings,
  quit,
}: {
  game: GameUIBridge;
  settings: Settings;
  updateSettings: (s: Settings) => void;
  quit: () => Promise<void>;
}) {
  const snapshot = useSyncExternalStore(
    game.subscribe.bind(game),
    game.getSnapshot.bind(game),
  );
  const [overlay, setOverlay] = useState<Overlay>("pause");
  const [quitting, setQuitting] = useState(false);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [debug, setDebug] = useState(false);
  const [help, setHelp] = useState(false);
  const [firstEntry, setFirstEntry] = useState(true);
  const attachedGame = useRef<GameUIBridge | null>(null);
  useEffect(() => {
    game.onOverlay = setOverlay;
    if (attachedGame.current !== game) {
      attachedGame.current = game;
      game.setPaused(true);
      setOverlay("pause");
    }
    return () => {
      game.onOverlay = undefined;
    };
  }, [game]);
  const resume = useCallback(async () => {
    setError("");
    try {
      await game.requestPointerLock();
      game.setPaused(false);
      setOverlay(null);
      setFirstEntry(false);
    } catch {
      setError(
        "浏览器未能锁定鼠标。请重试，或在 Chrome、Edge、Safari 中打开游戏。",
      );
      setOverlay("pause");
      game.setPaused(true);
    }
  }, [game]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (help) {
        if (e.code === "Escape") {
          e.preventDefault();
          setHelp(false);
        }
        return;
      }
      if ((e.target as HTMLElement)?.matches("input,select,textarea")) return;
      if (e.code === "F3") {
        e.preventDefault();
        setDebug((v) => !v);
      }
      if (
        overlay &&
        (e.code === "Escape" || e.code === "KeyE") &&
        overlay !== "death"
      ) {
        e.preventDefault();
        if (overlay === "settings") setOverlay("pause");
        else void resume();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [overlay, resume, help]);
  const openSettings = () => {
    game.setPaused(true);
    setOverlay("settings");
  };
  const exportCurrent = () => {
    setExportError("");
    try {
      game.exportCheckpoint();
    } catch (e) {
      setExportError(
        `导出失败：${e instanceof Error ? e.message : String(e)}。当前游戏仍保留在内存中，请重试。`,
      );
    }
  };
  const doQuit = async () => {
    setQuitting(true);
    setError("");
    try {
      await quit();
    } catch (e) {
      setError(
        `保存失败，尚未退出：${e instanceof Error ? e.message : String(e)}`,
      );
      setQuitting(false);
    }
  };
  return (
    <>
      <HUD
        snapshot={snapshot}
        game={game}
        debug={debug}
        toggleDebug={() => setDebug((v) => !v)}
      />
      {!snapshot.ready && (
        <div className="overlay loading-overlay">
          <section className="loading-panel">
            <div className="loading-cube">
              <Icon name="cube" size={58} />
            </div>
            <span className="eyebrow">新的风景正在展开</span>
            <h2>正在生成你的世界</h2>
            <p>种子 {snapshot.manifest.seed}</p>
            <div className="loading-track">
              <i />
            </div>
            <small>整理地形、种下树木，点亮第一缕晨光。</small>
          </section>
        </div>
      )}
      {snapshot.ready && overlay === "pause" && (
        <div className="overlay pause-overlay">
          <section
            className="pause-window"
            role="dialog"
            aria-modal="true"
            aria-label="暂停菜单"
          >
            <span className="eyebrow">
              {firstEntry ? "旅程准备就绪" : "让世界等你片刻"}
            </span>
            <h2>{firstEntry ? "出发，去创造。" : "游戏已暂停"}</h2>
            <p className="pause-world">
              {snapshot.manifest.name}
              <span>·</span>
              {snapshot.manifest.mode === "creative" ? "创造模式" : "生存模式"}
            </p>
            <button
              className="button primary pause-primary"
              onClick={() => void resume()}
              disabled={quitting}
            >
              <Icon name={firstEntry ? "arrow" : "play"} size={19} />
              {firstEntry ? "进入世界" : "继续游戏"}
              <kbd>Esc</kbd>
            </button>
            <div className="pause-secondary-actions">
              <button
                className="button glass"
                onClick={openSettings}
                disabled={quitting}
              >
                <Icon name="settings" size={17} />
                游戏设置
              </button>
              <button
                className="button glass"
                onClick={() => setHelp(true)}
                disabled={quitting}
              >
                <Icon name="info" size={17} />
                操作指南
              </button>
            </div>
            <div className="pause-secondary-actions">
              <button
                className="button glass"
                onClick={exportCurrent}
                title="下载内存中的最新进度，即使本机存储写入失败也可备份"
              >
                <Icon name="download" size={17} />
                导出当前进度
              </button>
            </div>
            {exportError && (
              <p className="inline-error" role="alert">
                {exportError}
              </p>
            )}
            <button
              className="pause-quit"
              onClick={() => void doQuit()}
              disabled={quitting}
            >
              {quitting ? "正在保存并退出…" : "保存并返回世界列表"}
              <Icon name="back" size={16} />
            </button>
            <div className={`save-indicator ${snapshot.saveStatus}`}>
              <span className="status-dot" />
              {downloadStatus(snapshot)}
            </div>
            {error && (
              <>
                <p className="inline-error" role="alert">
                  {error}
                </p>
                <button
                  className="button glass full-button"
                  onClick={() => {
                    game.startMouseFallback();
                    setOverlay(null);
                    setFirstEntry(false);
                    setError("");
                  }}
                >
                  使用拖动视角模式
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {snapshot.ready &&
        ["inventory", "workbench", "chest", "furnace"].includes(
          overlay || "",
        ) && (
          <Inventory
            game={game}
            snapshot={snapshot}
            overlay={overlay}
            close={() => void resume()}
          />
        )}
      {overlay === "settings" && (
        <SettingsDialog
          settings={settings}
          update={updateSettings}
          close={() => setOverlay("pause")}
        />
      )}
      {snapshot.ready && (overlay === "death" || snapshot.player.dead) && (
        <div className="overlay death-overlay">
          <section
            className="pause-window death-window"
            role="dialog"
            aria-modal="true"
            aria-label="死亡"
          >
            <span className="eyebrow">冒险，总有新的开始</span>
            <h2>你倒下了。</h2>
            <p>
              物品留在了倒下的地方。
              <br />
              重新出发，还可以把它们找回来。
            </p>
            <button
              className="button primary"
              onClick={() => {
                game.command({ type: "respawn" });
                void resume();
              }}
            >
              重新出发
              <Icon name="arrow" />
            </button>
            <button
              className="pause-quit"
              onClick={() => void doQuit()}
              disabled={quitting}
            >
              {quitting ? "正在保存…" : "保存并返回世界列表"}
            </button>
            {error && <p className="inline-error">{error}</p>}
          </section>
        </div>
      )}
      {help && <HelpDialog close={() => setHelp(false)} />}
    </>
  );
}

function HUD({
  snapshot,
  game,
  debug,
  toggleDebug,
}: {
  snapshot: GameSnapshot;
  game: GameUIBridge;
  debug: boolean;
  toggleDebug: () => void;
}) {
  const player = snapshot.player;
  const hour = Math.floor((snapshot.time / 1000 + 6) % 24);
  const minute = Math.floor(((snapshot.time % 1000) / 1000) * 60);
  const daytime = snapshot.time < 12500 || snapshot.time > 23500;
  const current = player.inventory[player.selected];
  const [welcome, setWelcome] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setWelcome(false), 18000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="hud">
      <div className="hud-top">
        <div className="world-status">
          <Icon name={daytime ? "sun" : "moon"} size={20} />
          <div>
            <strong>{daytime ? "原野漫游" : "静谧夜色"}</strong>
            <span>
              第 {Math.floor(snapshot.manifest.playedSeconds / 1200) + 1} 天
              <span className="hud-divider">/</span>
              {String(hour).padStart(2, "0")}:{String(minute).padStart(2, "0")}
            </span>
          </div>
        </div>
        <button
          className={`debug-toggle ${debug ? "expanded" : ""}`}
          onClick={toggleDebug}
          title="显示坐标（F3）"
        >
          <Icon name="world" size={16} />
          {debug ? (
            <span>
              X {player.position.x.toFixed(1)}
              <b />Y {player.position.y.toFixed(1)}
              <b />Z {player.position.z.toFixed(1)}
              <br />
              {snapshot.fps.toFixed(0)} FPS · {snapshot.chunks} 区块
            </span>
          ) : (
            <span>F3</span>
          )}
        </button>
      </div>
      <div className="crosshair">
        <i />
        <i />
      </div>
      {snapshot.target && (
        <div className="target-label">{snapshot.target.name}</div>
      )}
      {snapshot.mining > 0 && (
        <div className="mining-progress">
          <i style={{ width: `${snapshot.mining * 100}%` }} />
        </div>
      )}
      {snapshot.message && (
        <div className="game-toast" role="status">
          {snapshot.message}
        </div>
      )}
      <div className="hud-bottom">
        {welcome && (
          <div className="welcome-hint">
            <kbd>W A S D</kbd> 移动
            <span /> <kbd>左键</kbd> 挖掘
            <span />
            <kbd>E</kbd> 背包
          </div>
        )}
        <div className="selected-item-name">
          {current ? ITEMS[current.id]?.name || current.id : "空手"}
        </div>
        {player.oxygen < 20 && snapshot.manifest.mode === "survival" && (
          <div className="oxygen-row">
            {Array.from({ length: 10 }, (_, i) => (
              <svg
                key={i}
                width="16"
                height="18"
                viewBox="0 0 10 12"
                fill={player.oxygen > i * 2 ? "#a8dce3" : "#254f5d"}
              >
                <path d="M4 0h2v2h2v2h1v5H8v2H2V9H1V4h1V2h2V0Z" />
              </svg>
            ))}
          </div>
        )}
        {snapshot.manifest.mode === "survival" ? (
          <div className="survival-bars">
            <div
              className="hearts"
              title={`生命 ${Math.ceil(player.health)} / 20`}
              aria-label={`生命 ${Math.ceil(player.health)} / 20`}
            >
              {Array.from({ length: 10 }, (_, i) => (
                <svg
                  key={i}
                  width="22"
                  height="21"
                  viewBox="0 0 11 11"
                  shapeRendering="crispEdges"
                >
                  <path
                    d="M1 1h3v1h2V1h3v1h1v4H9v1H8v1H7v1H6v1H4V9H3V8H2V7H1V6H0V2h1V1Z"
                    fill="#28312b"
                  />
                  <path
                    d="M1 2h3v1h2V2h3v4H8v1H7v1H6v1H4V8H3V7H2V6H1V2Z"
                    fill={
                      player.health > i * 2 + 1
                        ? "#d86a5b"
                        : player.health > i * 2
                          ? "#ae6353"
                          : "#4d5149"
                    }
                  />
                  {player.health > i * 2 && (
                    <path d="M2 2h2v1H2V2Z" fill="#f2aaa0" />
                  )}
                </svg>
              ))}
            </div>
            <div
              className="hunger"
              title={`饥饿 ${Math.ceil(player.hunger)} / 20`}
              aria-label={`饥饿 ${Math.ceil(player.hunger)} / 20`}
            >
              {Array.from({ length: 10 }, (_, i) => (
                <svg
                  key={i}
                  width="22"
                  height="21"
                  viewBox="0 0 11 11"
                  shapeRendering="crispEdges"
                >
                  <path
                    d="M5 0h4v1h1v1h1v4h-1v2H7V7H6v1H5v2H4v1H1v-1H0V7h2V6h1V5H2V3h1V1h2V0Z"
                    fill="#30312a"
                  />
                  <path
                    d="M5 1h4v1h1v4H9v1H7V6H6V5H4V3h1V1Z"
                    fill={player.hunger > i * 2 ? "#c39358" : "#555348"}
                  />
                  <path
                    d="M2 7h2V6h1v2H4v2H2V9H1V8h1V7Z"
                    fill={player.hunger > i * 2 ? "#e4d4a6" : "#555348"}
                  />
                  <path
                    d="M6 2h2v1H6V2Z"
                    fill={player.hunger > i * 2 ? "#e7ba79" : "#555348"}
                  />
                </svg>
              ))}
            </div>
          </div>
        ) : (
          <div className="creative-status">
            <Icon name="spark" size={13} />
            创造模式<span>双击空格飞行 · Shift 下降</span>
          </div>
        )}
        <div className="game-hotbar">
          {Array.from({ length: 9 }, (_, i) => (
            <button
              className={`hotbar-slot ${player.selected === i ? "selected" : ""}`}
              key={i}
              title={`${i + 1} · ${player.inventory[i] ? ITEMS[player.inventory[i]!.id]?.name : "空物品栏"}`}
              onClick={() => game.command({ type: "select", index: i })}
            >
              <span className="hotbar-number">{i + 1}</span>
              {player.inventory[i] && (
                <StackView stack={player.inventory[i]!} />
              )}
            </button>
          ))}
        </div>
        <div className="hotbar-under">
          <span>
            <kbd>滚轮</kbd> 切换物品
          </span>
          <span>
            <kbd>E</kbd> 背包与合成
          </span>
        </div>
      </div>
      <div className={`hud-save ${snapshot.saveStatus}`}>
        {snapshot.saveStatus === "error" ? (
          <>
            <Icon name="info" size={13} />
            自动保存失败，请暂停后重试
          </>
        ) : snapshot.saveStatus === "saving" ? (
          "正在保存…"
        ) : (
          ""
        )}
      </div>
    </div>
  );
}

function CreateWorld({
  busy,
  onClose,
  onCreate,
}: {
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, seed: string, mode: GameMode) => Promise<void>;
}) {
  const [name, setName] = useState("新的世界");
  const [seed, setSeed] = useState("");
  const [mode, setMode] = useState<GameMode>("survival");
  return (
    <div className="overlay">
      <section
        className="dialog create-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="创建新世界"
      >
        <header className="window-header">
          <div>
            <span className="eyebrow dark">一切从这里开始</span>
            <h2>创建新世界</h2>
          </div>
          <button
            className="icon-button dark-icon"
            onClick={onClose}
            disabled={busy}
            title="关闭"
          >
            <Icon name="close" />
          </button>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate(name, seed, mode);
          }}
        >
          <label className="field-label">
            世界名称
            <input
              autoFocus
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="为你的世界取个名字"
            />
          </label>
          <label className="field-label">
            世界种子<span className="optional-label">可选</span>
            <div className="seed-input">
              <input
                value={seed}
                maxLength={80}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="留空，邂逅一片未知的风景"
              />
              <button
                type="button"
                onClick={() =>
                  setSeed(String(Math.floor(Math.random() * 999999999)))
                }
                title="随机种子"
              >
                <Icon name="spark" size={18} />
              </button>
            </div>
            <small>相同的种子，会生长出相同的山川与森林。</small>
          </label>
          <fieldset className="mode-selector">
            <legend>选择你的玩法</legend>
            <div>
              <button
                type="button"
                className={`mode-option ${mode === "survival" ? "chosen" : ""}`}
                onClick={() => setMode("survival")}
              >
                <span className="mode-option-icon">
                  <Icon name="world" size={23} />
                </span>
                <span>
                  <strong>生存模式</strong>
                  <small>采集、制作，在昼夜中生存。</small>
                </span>
                <span className="mode-radio">
                  {mode === "survival" && <i />}
                </span>
              </button>
              <button
                type="button"
                className={`mode-option ${mode === "creative" ? "chosen" : ""}`}
                onClick={() => setMode("creative")}
              >
                <span className="mode-option-icon">
                  <Icon name="cube" size={23} />
                </span>
                <span>
                  <strong>创造模式</strong>
                  <small>自由飞行，用无限资源建造。</small>
                </span>
                <span className="mode-radio">
                  {mode === "creative" && <i />}
                </span>
              </button>
            </div>
          </fieldset>
          <div className="creation-summary">
            <Icon name="info" size={17} />
            <span>
              {mode === "survival"
                ? "普通难度 · 从空背包开始 · 死亡掉落物品"
                : "无限方块 · 自由飞行 · 无生命与饥饿限制"}
            </span>
          </div>
          <button
            className="button forest full-button"
            type="submit"
            disabled={busy}
          >
            {busy ? (
              <>
                <span className="loader-small" />
                正在准备世界…
              </>
            ) : (
              <>
                生成世界，开始旅程
                <Icon name="arrow" size={18} />
              </>
            )}
          </button>
        </form>
      </section>
    </div>
  );
}

function SettingsDialog({
  settings,
  update,
  close,
}: {
  settings: Settings;
  update: (s: Settings) => void;
  close: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const sliders: [keyof Settings, string, number, number, number, string][] = [
    ["renderDistance", "视距", 2, 6, 1, "区块"],
    ["fov", "视野", 55, 100, 1, "°"],
    ["sensitivity", "鼠标灵敏度", 0.2, 2, 0.05, ""],
    ["volume", "声音音量", 0, 1, 0.01, ""],
  ];
  return (
    <div className="overlay">
      <section
        className="dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="游戏设置"
      >
        <header className="window-header">
          <div>
            <span className="eyebrow dark">调整你的游玩体验</span>
            <h2>游戏设置</h2>
          </div>
          <button
            className="icon-button dark-icon"
            onClick={close}
            title="关闭设置"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="settings-fields">
          {sliders.map(([key, label, min, max, step, suffix]) => (
            <label className="range-setting" key={key}>
              <span>
                {label}
                <output>
                  {key === "volume"
                    ? `${Math.round(Number(draft[key]) * 100)}%`
                    : key === "sensitivity"
                      ? Number(draft[key]).toFixed(2)
                      : `${draft[key]}${suffix}`}
                </output>
              </span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={Number(draft[key])}
                onChange={(e) =>
                  setDraft({ ...draft, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
          <label className="field-label quality-select">
            画面质量
            <select
              value={draft.quality}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  quality: e.target.value as Settings["quality"],
                })
              }
            >
              <option value="low">流畅 · 低</option>
              <option value="medium">均衡 · 中</option>
              <option value="high">精细 · 高</option>
            </select>
          </label>
          <p className="settings-note">
            较大的视距和较高的画质会增加设备负载。设置仅保存在本机。
          </p>
        </div>
        <div className="dialog-actions">
          <button
            className="text-button"
            onClick={() => setDraft({ ...DEFAULT_SETTINGS })}
          >
            恢复默认
          </button>
          <button
            className="button forest"
            onClick={() => {
              update(draft);
              close();
            }}
          >
            保存设置
            <Icon name="check" size={17} />
          </button>
        </div>
      </section>
    </div>
  );
}

function HelpDialog({ close }: { close: () => void }) {
  return (
    <div className="overlay">
      <section
        className="dialog help-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="操作指南"
      >
        <header className="window-header">
          <div>
            <span className="eyebrow dark">慢慢探索，自由创造</span>
            <h2>操作指南</h2>
          </div>
          <button
            className="icon-button dark-icon"
            onClick={close}
            title="关闭操作指南"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="controls-grid">
          {[
            ["W A S D", "移动"],
            ["鼠标", "环顾四周"],
            ["空格", "跳跃 / 游泳上浮"],
            ["Ctrl", "疾跑"],
            ["Shift", "潜行 / 飞行下降"],
            ["左键", "长按挖掘 / 攻击"],
            ["右键", "放置 / 使用 / 进食"],
            ["1 — 9 / 滚轮", "切换快捷栏"],
            ["E", "背包与合成"],
            ["Q", "丢弃手持物品"],
            ["Esc", "暂停游戏"],
            ["双击空格", "创造模式切换飞行"],
          ].map(([key, label]) => (
            <div key={key}>
              <kbd>{key}</kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="first-steps">
          <span className="section-label">生存的第一天</span>
          <p>
            先砍树获得原木，在背包里制作木板和工作台。做一把木镐，采集石头升级工具，再寻找煤和铁。天黑前，记得搭建庇护所、放置火把。
            <br />
            割草获得小麦种子，用锄头翻耕泥土，再向耕地播种。水能滋润四格内的耕地；成熟小麦可做面包、喂羊。用胡萝卜、马铃薯或甜菜喂猪，同类成年动物吃饱后会繁殖。剪刀可以采羊毛，羊吃草后重新长毛。
            <br />
            用七个木台阶制作堆肥桶，投入树叶或种子，装满后收取骨粉。骨粉可催熟作物，也可让草地长出草丛。铁桶能搬运水源；甜菜种子目前可在创造物品栏获得。
          </p>
        </div>
        <button className="button forest full-button" onClick={close}>
          明白了，出发
          <Icon name="arrow" size={17} />
        </button>
      </section>
    </div>
  );
}
