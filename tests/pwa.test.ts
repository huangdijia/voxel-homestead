import { afterEach, describe, expect, it, vi } from "vitest";
import { isStandalone, observeInstallation, registerOfflineShell } from "../src/pwa/client";
import { pwaOptions } from "../pwa.config";

function environment() {
  const media = Object.assign(new EventTarget(), { matches: false });
  const windowTarget = Object.assign(new EventTarget(), { isSecureContext: true, matchMedia: () => media });
  const worker = Object.assign(new EventTarget(), { state: "installing" });
  const registration = Object.assign(new EventTarget(), { installing: worker, active: null as unknown, waiting: null as unknown });
  const serviceWorker = { controller: null as unknown, register: vi.fn().mockResolvedValue(registration) };
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("navigator", { serviceWorker });
  return { media, windowTarget, worker, registration, serviceWorker };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("safe PWA registration and install lifecycle", () => {
  it("never registers or clears anything in development", () => {
    const env = environment(), status = vi.fn();
    registerOfflineShell(status, false)();
    expect(env.serviceWorker.register).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith("development");
    expect(pwaOptions.devOptions?.enabled).toBe(false);
  });
  it("reports unavailable without attempting SW registration in an insecure context", () => {
    const env = environment(), status = vi.fn(); env.windowTarget.isSecureContext = false;
    registerOfflineShell(status, true)();
    expect(env.serviceWorker.register).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith("unavailable");
  });
  it("registers the root shell and reports initial cache completion only when installed", async () => {
    const env = environment(), status = vi.fn(); const cleanup = registerOfflineShell(status, true);
    await Promise.resolve();
    expect(env.serviceWorker.register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
    expect(status).toHaveBeenLastCalledWith("preparing");
    env.worker.state = "installed"; env.worker.dispatchEvent(new Event("statechange"));
    expect(status).toHaveBeenLastCalledWith("ready");
    cleanup(); status.mockClear();
    env.worker.state = "redundant"; env.worker.dispatchEvent(new Event("statechange"));
    expect(status).not.toHaveBeenCalled();
  });
  it("leaves a waiting update alone and removes update listeners on cleanup", async () => {
    const env = environment(), status = vi.fn();
    const postMessage = vi.fn();
    env.serviceWorker.controller = { postMessage };
    env.registration.active = { postMessage };
    env.registration.waiting = { postMessage };
    env.registration.installing = null as never;
    const removed = vi.spyOn(env.registration, "removeEventListener");
    const cleanup = registerOfflineShell(status, true); await Promise.resolve();
    expect(status).toHaveBeenLastCalledWith("update-waiting");
    expect(postMessage).not.toHaveBeenCalled();
    cleanup(); expect(removed).toHaveBeenCalledWith("updatefound", expect.any(Function));
    expect(pwaOptions.workbox?.skipWaiting).toBe(false);
    expect(pwaOptions.workbox?.clientsClaim).toBe(false);
  });
  it("does not attach listeners after an asynchronous registration resolves following unmount", async () => {
    const env = environment(), status = vi.fn();
    let resolve!: (value: unknown) => void;
    env.serviceWorker.register.mockReturnValue(new Promise((done) => { resolve = done; }));
    const added = vi.spyOn(env.registration, "addEventListener");
    const cleanup = registerOfflineShell(status, true); cleanup(); status.mockClear();
    resolve(env.registration); await Promise.resolve();
    expect(added).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled();
  });
  it("cleans install, installed, and display-mode listeners without treating a prompt as success", () => {
    const env = environment();
    const handlers = { available: vi.fn(), installed: vi.fn(), displayChanged: vi.fn() };
    const cleanup = observeInstallation(handlers);
    const prompt = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: "accepted" }) });
    env.windowTarget.dispatchEvent(prompt);
    expect(prompt.defaultPrevented).toBe(true);
    expect(handlers.available).toHaveBeenCalledWith(prompt);
    expect(handlers.installed).not.toHaveBeenCalled();
    env.windowTarget.dispatchEvent(new Event("appinstalled")); expect(handlers.installed).toHaveBeenCalledOnce();
    env.media.matches = true; env.media.dispatchEvent(new Event("change"));
    expect(isStandalone()).toBe(true); expect(handlers.displayChanged).toHaveBeenCalledOnce();
    cleanup(); env.windowTarget.dispatchEvent(new Event("appinstalled")); env.media.dispatchEvent(new Event("change")); env.windowTarget.dispatchEvent(prompt);
    expect(handlers.installed).toHaveBeenCalledOnce(); expect(handlers.displayChanged).toHaveBeenCalledOnce(); expect(handlers.available).toHaveBeenCalledOnce();
  });
  it("does not intercept an unsupported install event", () => {
    const env = environment(); const available = vi.fn();
    const cleanup = observeInstallation({ available, installed: vi.fn(), displayChanged: vi.fn() });
    const event = new Event("beforeinstallprompt", { cancelable: true });
    env.windowTarget.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false); expect(available).not.toHaveBeenCalled(); cleanup();
  });
});
