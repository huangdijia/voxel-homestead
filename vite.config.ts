import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { pwaOptions } from "./pwa.config.ts";
export default defineConfig({
  base: "/",
  plugins: [react(), VitePWA(pwaOptions)],
  server: { host: "127.0.0.1" },
  build: { target: "es2022" },
});
