import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const manifest = JSON.parse(await fs.readFile(path.join(dist, "manifest.webmanifest"), "utf8"));
assert.equal(manifest.id, "/"); assert.equal(manifest.start_url, "/"); assert.equal(manifest.scope, "/"); assert.equal(manifest.display, "standalone");
for (const icon of manifest.icons) {
  const contents = await fs.readFile(path.join(dist, icon.src));
  assert.equal(contents.subarray(1, 4).toString(), "PNG");
  assert.equal(`${contents.readUInt32BE(16)}x${contents.readUInt32BE(20)}`, icon.sizes);
}
assert(manifest.icons.some((icon) => icon.purpose === "maskable" && icon.sizes === "512x512"));
const html = await fs.readFile(path.join(dist, "index.html"), "utf8");
assert(html.includes('rel="manifest"')); assert(html.includes("apple-touch-icon.png"));
const sw = await fs.readFile(path.join(dist, "sw.js"), "utf8");
let entries = [], fallback, cleanup = false, claimed = false, skipped = false, cachePrefix;
const events = new Map();
const workbox = {
  precacheAndRoute: (value) => { entries = value; },
  cleanupOutdatedCaches: () => { cleanup = true; },
  setCacheNameDetails: ({ prefix }) => { cachePrefix = prefix; },
  clientsClaim: () => { claimed = true; },
  registerRoute: () => {},
  createHandlerBoundToURL: (url) => { fallback = url; return () => {}; },
  NavigationRoute: function (_handler, options) { assert(options.allowlist.length > 0); },
};
const define = (_dependencies, factory) => factory(workbox);
vm.runInNewContext(sw, { define, self: { define, addEventListener: (name, handler) => events.set(name, handler), skipWaiting: () => { skipped = true; } } }, { timeout: 1000 });
assert.equal(skipped, false, "SW must not force immediate activation");
assert.equal(claimed, false, "SW must not seize an active game");
assert.equal(cachePrefix, "voxel-homestead-shell");
assert.equal(cleanup, true); assert.equal(fallback, "/index.html");
assert(!sw.includes("indexedDB"), "App-shell SW must not touch user saves");
const urls = new Set(entries.map((entry) => entry.url.replace(/^\//, "")));
for (const required of ["index.html", "assets/terrain-atlas.png", "assets/mob-atlas.png", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"]) assert(urls.has(required), `Missing precache: ${required}`);
assert([...urls].some((url) => /^assets\/terrain\.worker-.+\.js$/.test(url)), "Terrain Worker must work offline");
assert([...urls].some((url) => /^assets\/index-.+\.js$/.test(url)), "App JS missing");
assert([...urls].some((url) => /^assets\/index-.+\.css$/.test(url)), "App CSS missing");
let bytes = 0;
for (const url of urls) {
  assert(!url.includes("..") && !url.includes(":") && !url.endsWith(".voxel.json"), `Unsafe shell cache path: ${url}`);
  bytes += (await fs.stat(path.join(dist, url))).size;
}
console.log(JSON.stringify({ status: "passed", manifest: manifest.name, precacheEntries: urls.size, precacheBytes: bytes, terrainWorker: true, bothAtlases: true, forceActivation: skipped, clientsClaim: claimed, indexedDBAccess: false }, null, 2));
