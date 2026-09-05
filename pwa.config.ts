import type { VitePWAOptions } from "vite-plugin-pwa";

/** The game currently loads /assets/... and is deployed at the origin root. */
export const pwaOptions: Partial<VitePWAOptions> = {
  strategies: "generateSW",
  registerType: "prompt",
  injectRegister: false,
  filename: "sw.js",
  manifestFilename: "manifest.webmanifest",
  scope: "/",
  base: "/",
  includeAssets: ["icons/*.png", "icons/*.svg"],
  manifest: {
    id: "/",
    name: "方块纪行 · 耕作与牧场",
    short_name: "方块纪行",
    description: "自由探索、耕作与建造的原创方块沙盒游戏，支持本地存档与离线游玩。",
    lang: "zh-CN",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#172722",
    theme_color: "#172722",
    categories: ["games", "entertainment"],
    icons: [
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  devOptions: { enabled: false },
  workbox: {
    cacheId: "voxel-homestead-shell",
    globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
    // The original terrain atlas is 2.33 MB, above Workbox's default 2 MiB.
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    navigateFallback: "/index.html",
    navigateFallbackAllowlist: [/^\/(?:index\.html)?(?:\?.*)?$/],
    cleanupOutdatedCaches: true,
    // Never activate over an existing game or reload any page automatically.
    skipWaiting: false,
    clientsClaim: false,
    runtimeCaching: [],
  },
};
