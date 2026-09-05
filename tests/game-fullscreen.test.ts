import { afterEach, describe, expect, it, vi } from "vitest";
import { Game } from "../src/game/Game";

// Exercise Game's presentation lifecycle without constructing WebGL or workers.
// The DOM stub dispatches real EventTarget events; browser UI is validated separately.
function setup() {
  const events: string[] = [];
  const document = Object.assign(new EventTarget(), {
    fullscreenElement: null as unknown,
    pointerLockElement: null as unknown,
    documentElement: null as unknown,
    exitFullscreen: vi.fn(async () => {
      document.fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    }),
    exitPointerLock: vi.fn(() => {
      document.pointerLockElement = null;
    }),
  });
  const app = {
    requestFullscreen: vi.fn(async () => {
      events.push("fullscreen");
      document.fullscreenElement = app;
      document.dispatchEvent(new Event("fullscreenchange"));
    }),
  };
  const canvas = {
    closest: vi.fn(() => app),
    requestPointerLock: vi.fn((): Promise<void> | void => {
      events.push("pointer");
      document.pointerLockElement = canvas;
      document.dispatchEvent(new Event("pointerlockchange"));
      return Promise.resolve();
    }),
  };
  document.documentElement = app;
  vi.stubGlobal("document", document);
  const game = Object.assign(Object.create(Game.prototype), {
    canvas,
    paused: true,
    overlay: "pause",
    disposed: false,
    controlEpoch: 0,
    fullscreenTarget: null,
    fullscreenOwned: false,
    fullscreenWanted: false,
    mouseFallback: false,
    audio: { unlock: vi.fn() },
    keys: new Set(),
    elapsed: 0,
    simulation: { closeContainer: vi.fn(), startCraft: vi.fn(), mining: 0 },
    publish: vi.fn(),
    onOverlay: vi.fn(),
  });
  document.addEventListener("fullscreenchange", () => game.fullscreenChanged());
  return { game, app, canvas, document, events };
}

describe("fullscreen and game presentation lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("requests pointer lock before fullscreen within the original synchronous user gesture", async () => {
    const { game, events, app, canvas, document } = setup();
    const entered = game.requestPointerLock();
    expect(events).toEqual(["pointer", "fullscreen"]);
    expect(canvas.closest).toHaveBeenCalledWith(".app");
    await entered;
    expect(document.fullscreenElement).toBe(app);
    expect(game.paused).toBe(false);
    expect(game.onOverlay).toHaveBeenLastCalledWith(null);
  });

  it("continues windowed when fullscreen is rejected without losing pointer lock", async () => {
    const { game, app, canvas, document } = setup();
    app.requestFullscreen.mockRejectedValue(new Error("Fullscreen denied"));
    await expect(game.requestPointerLock()).resolves.toBeUndefined();
    expect(game.paused).toBe(false);
    expect(document.pointerLockElement).toBe(canvas);
    expect(game.message).toContain("窗口模式");
  });

  it("supports event-only pointer lock results instead of assuming every browser returns a promise", async () => {
    const { game, canvas, document } = setup();
    canvas.requestPointerLock.mockImplementation(() => undefined);
    const entered = game.requestPointerLock();
    await Promise.resolve();
    expect(game.paused).toBe(true);
    document.pointerLockElement = canvas;
    document.dispatchEvent(new Event("pointerlockchange"));
    await entered;
    expect(game.paused).toBe(false);
  });

  it("pauses on native fullscreen exit even when the browser consumes Escape", async () => {
    const { game, document } = setup();
    await game.requestPointerLock();
    document.fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(game.paused).toBe(true);
    expect(game.overlay).toBe("pause");
    expect(document.pointerLockElement).toBeNull();
    expect(game.onOverlay).toHaveBeenLastCalledWith("pause");
  });

  it("retains fullscreen while opening inventory and exits it when pausing", async () => {
    const { game, app, document } = setup();
    await game.requestPointerLock();
    game.openInventory();
    expect(document.fullscreenElement).toBe(app);
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    await game.requestPointerLock();
    expect(app.requestFullscreen).toHaveBeenCalledTimes(1);
    game.setPaused(true);
    expect(document.fullscreenElement).toBeNull();
    expect(game.paused).toBe(true);
  });

  it("requests fullscreen for drag-look fallback without requesting pointer lock", async () => {
    const { game, app, canvas, document } = setup();
    game.startMouseFallback();
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    expect(app.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(game.paused).toBe(false);
    await Promise.resolve();
    document.fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(game.paused).toBe(true);
  });

  it("does not resume or retain late fullscreen/pointer-lock results after a pause", async () => {
    const { game, app, canvas, document } = setup();
    let finishFullscreen!: () => void, finishPointer!: () => void;
    app.requestFullscreen.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishFullscreen = () => {
            document.fullscreenElement = app;
            document.dispatchEvent(new Event("fullscreenchange"));
            resolve();
          };
        }),
    );
    canvas.requestPointerLock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishPointer = () => {
            document.pointerLockElement = canvas;
            document.dispatchEvent(new Event("pointerlockchange"));
            resolve();
          };
        }),
    );
    const entered = game.requestPointerLock();
    const rejected = expect(entered).rejects.toMatchObject({
      name: "AbortError",
    });
    game.setPaused(true);
    finishFullscreen();
    finishPointer();
    await rejected;
    expect(game.paused).toBe(true);
    expect(document.fullscreenElement).toBeNull();
    expect(document.pointerLockElement).toBeNull();
    expect(game.onOverlay).not.toHaveBeenCalledWith(null);
  });

  it("releases fullscreen when pointer lock fails, preserving the normal fallback path", async () => {
    const { game, canvas, document } = setup();
    canvas.requestPointerLock.mockRejectedValue(
      new Error("Pointer lock denied"),
    );
    await expect(game.requestPointerLock()).rejects.toThrow(
      "Pointer lock denied",
    );
    expect(document.fullscreenElement).toBeNull();
    expect(game.paused).toBe(true);
    expect(game.overlay).toBe("pause");
  });

  it("releases owned fullscreen and pointer lock when the Game is disposed", async () => {
    const { game, document } = setup();
    const resource = () => ({ dispose: vi.fn() });
    Object.assign(game, {
      raf: 0,
      cleanup: [],
      resizeObserver: { disconnect: vi.fn() },
      listeners: new Set(),
      world: resource(),
      entityRenderer: resource(),
      sky: resource(),
      selection: { geometry: resource(), material: resource() },
      handGeometry: resource(),
      handMaterials: [],
      renderer: resource(),
    });
    game.audio.dispose = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("window", {});
    await game.requestPointerLock();
    game.dispose();
    expect(game.disposed).toBe(true);
    expect(document.fullscreenElement).toBeNull();
    expect(document.pointerLockElement).toBeNull();
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    game.dispose();
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("bounds event-only pointer lock waits and does not exit unrelated fullscreen elements", async () => {
    vi.useFakeTimers();
    const { game, canvas, document } = setup();
    const unrelated = {};
    document.fullscreenElement = unrelated;
    canvas.requestPointerLock.mockImplementation(() => undefined);
    const rejected = expect(game.requestPointerLock()).rejects.toThrow(
      "鼠标锁定请求超时",
    );
    await vi.advanceTimersByTimeAsync(8000);
    await rejected;
    expect(document.fullscreenElement).toBe(unrelated);
    expect(document.exitFullscreen).not.toHaveBeenCalled();
  });
});
