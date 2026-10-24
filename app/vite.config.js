import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "@sveltejs/adapter-static";
import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const host = process.env.TAURI_DEV_HOST;

// pdf.js data files (CMaps, standard fonts, wasm image decoders, ICC profiles) served
// from /pdfjs/ — bundled with the app, never fetched from the network.
const PDFJS = "node_modules/pdfjs-dist";
const PDFJS_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];
const skip = (/** @type {string} */ name) => name.startsWith("quickjs") || name.startsWith("LICENSE");

/** @param {string} dir @returns {Generator<string>} */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (!skip(name)) yield p;
  }
}

/** @returns {import("vite").Plugin} */
function pdfjsAssets() {
  return {
    name: "pratex-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
        const top = rel.split("/")[0];
        if (!PDFJS_DIRS.includes(top) || rel.includes("..")) return next();
        const file = join(PDFJS, rel);
        try {
          statSync(file);
        } catch {
          return next();
        }
        if (file.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
        createReadStream(file).pipe(res);
      });
    },
    generateBundle(options) {
      if (this.environment?.name && this.environment.name !== "client") return;
      if (options.dir && /server/.test(options.dir)) return;
      for (const d of PDFJS_DIRS) {
        for (const file of walk(join(PDFJS, d))) {
          this.emitFile({ type: "asset", fileName: `pdfjs/${relative(PDFJS, file)}`, source: readFileSync(file) });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    // SvelteKit 3: config lives here (svelte.config.js is no longer read).
    // Tauri has no Node server → static adapter with SPA fallback, SSR off in +layout.ts.
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter({ fallback: "index.html" }),
    }),
    pdfjsAssets(),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // WebView2 / WKWebView / WebKitGTK (Ubuntu 22.04) all support ES2022.
    target: "es2022",
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
