// The online demo: a static build of the page for Vercel (npm run build:demo → dist-demo/). No
// server: the page's API runs in the browser (lib/demo-backend.ts). Only the public files the demo
// uses are copied; the local recognition models (public/vision, 81 MB) stay out.
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, "dist-demo");
const PUBLIC = ["catalog", "demo", "favicon.svg"];

function publicFiles(): Plugin {
  return {
    name: "demo-public-files",
    apply: "build",
    closeBundle() {
      for (const name of PUBLIC) {
        mkdirSync(out, { recursive: true });
        cpSync(resolve(root, "public", name), resolve(out, name), { recursive: true });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  root: resolve(root, "demo"),
  // While developing the demo locally, the whole public folder is served; the build copies only PUBLIC.
  publicDir: command === "serve" ? resolve(root, "public") : false,
  plugins: [react(), publicFiles()],
  resolve: {
    alias: [
      { find: /^next\/dynamic$/, replacement: resolve(root, "demo/next-dynamic.tsx") },
      { find: /^@\//, replacement: root + "/" },
    ],
  },
  server: { port: 5190, strictPort: true },
  preview: { port: 5191, strictPort: true },
  build: { outDir: out, emptyOutDir: true, chunkSizeWarningLimit: 4000 },
}));
