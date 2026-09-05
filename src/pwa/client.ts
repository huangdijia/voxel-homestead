export interface InstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" } | void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export type OfflineState = "preparing" | "ready" | "update-waiting" | "unavailable" | "development";

/** Subscribe only; no skipWaiting, reload, cache deletion, or IndexedDB access. */
export function registerOfflineShell(
  onState: (state: OfflineState) => void,
  production = import.meta.env.PROD,
): () => void {
  let disposed = false;
  const cleanups: Array<() => void> = [];
  const publish = (state: OfflineState) => { if (!disposed) onState(state); };
  if (!production) { publish("development"); return () => { disposed = true; }; }
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    publish("unavailable"); return () => { disposed = true; };
  }
  publish("preparing");
  const base = import.meta.env.BASE_URL;
  void navigator.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: "none" }).then((registration) => {
    if (disposed) return;
    const observed = new Set<ServiceWorker>();
    const check = () => {
      if (registration.waiting && navigator.serviceWorker.controller) publish("update-waiting");
      else if (registration.active) publish("ready");
    };
    const observe = () => {
      const worker = registration.installing;
      if (!worker || observed.has(worker)) { check(); return; }
      observed.add(worker);
      const stateChanged = () => {
        if (worker.state === "installed") publish(navigator.serviceWorker.controller ? "update-waiting" : "ready");
        else if (worker.state === "activated") check();
        else if (worker.state === "redundant" && !registration.active) publish("unavailable");
      };
      worker.addEventListener("statechange", stateChanged);
      cleanups.push(() => worker.removeEventListener("statechange", stateChanged));
      stateChanged();
    };
    registration.addEventListener("updatefound", observe);
    cleanups.push(() => registration.removeEventListener("updatefound", observe));
    observe(); check();
  }).catch(() => publish("unavailable"));
  return () => { disposed = true; for (const cleanup of cleanups) cleanup(); };
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** An accepted prompt is not installation success; only appinstalled confirms it. */
export function observeInstallation(handlers: {
  available: (event: InstallPromptEvent) => void;
  installed: () => void;
  displayChanged: () => void;
}): () => void {
  const beforeInstall = (event: Event) => {
    const prompt = event as InstallPromptEvent;
    if (typeof prompt.prompt !== "function") return;
    event.preventDefault(); handlers.available(prompt);
  };
  const installed = () => handlers.installed();
  const changed = () => handlers.displayChanged();
  const media = window.matchMedia("(display-mode: standalone)");
  window.addEventListener("beforeinstallprompt", beforeInstall);
  window.addEventListener("appinstalled", installed);
  media.addEventListener("change", changed);
  return () => {
    window.removeEventListener("beforeinstallprompt", beforeInstall);
    window.removeEventListener("appinstalled", installed);
    media.removeEventListener("change", changed);
  };
}
