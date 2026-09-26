import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
      // Response and request types are shared with the Node web tier, as types only: nothing from it ships in the bundle.
      "@contract": path.resolve(here, "../services/billing/src"),
    },
  },
  server: {
    port: 5173,
    // In development the browser talks to Vite, which forwards /api to the Node web tier. The Host header is kept as is, so
    // the server's same-origin check (Origin host == Host) passes exactly as it does in production.
    proxy: { "/api": { target: process.env.API_URL ?? "http://127.0.0.1:8080", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    css: false,
    restoreMocks: true,
  },
});
