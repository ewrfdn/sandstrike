/**
 * SANDSTRIKE // dev tools — Vite + React configuration.
 *
 * The dev tools are a standalone web app that lives beside `src/` and imports
 * the game's real builders directly (models, world, textures). Keeping them in
 * their own Vite app means the game itself never pays for React or the viewer
 * code — `src/main.js` and the shipping bundle are unchanged.
 *
 * Run from the repository root:
 *   npm run dev:tools      # http://127.0.0.1:5199/
 *   npm run build:tools    # static bundle -> dev_tools/ui/dist/
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const UI_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(UI_DIR, '../..');
const VENDOR_DIR = resolve(REPO_ROOT, 'vendor');
// Rollup's alias replacement is a plain string concatenation: the "three/addons/"
// match consumes the trailing slash, so the replacement must end with a separator
// or "three/addons/geometries/X.js" resolves to ".../addonsgeometries/X.js".
const THREE_ADDONS = `${resolve(VENDOR_DIR, 'three/addons')}/`;

export default defineConfig({
  root: UI_DIR,
  // Relative base so `dev_tools/ui/dist/` works when served from any sub-path
  // (e.g. a static file server or a future dev-tools server route).
  base: './',
  plugins: [react()],
  resolve: {
    // The repository vendors Three.js (no npm dependency) — point the bare
    // specifiers at the same files the game's import map uses.
    alias: [
      { find: /^three$/, replacement: resolve(VENDOR_DIR, 'three/three.module.js') },
      { find: /^three\/addons\//, replacement: THREE_ADDONS },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
    // The UI imports ../../../src and ../../../vendor at runtime.
    fs: { allow: [REPO_ROOT] },
    // `npm run qa:devtools` spawns this server itself and must not be reloaded
    // mid-run when another workstream saves a game source file it imports (a
    // full HMR reload disposes the viewer stages and invalidates the probe).
    ...(process.env.DEV_TOOLS_QA === '1' ? { hmr: false } : {}),
    // Editor / agent tooling writes files through short-lived atomic temp
    // directories next to the target (".App.jsx.<pid>.<uuid>.tmpdir/"). Watching
    // those races with their deletion and kills the whole dev server with EBUSY,
    // so ignore the pattern before chokidar subscribes.
    watch: {
      ignored: (filePath) => /\.tmpdir(?:[\\/]|$)/.test(filePath) || /\.tmp$/.test(filePath),
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
  },
  build: {
    outDir: resolve(UI_DIR, 'dist'),
    emptyOutDir: true,
    target: 'chrome100',
    sourcemap: true,
    // The dev-tools bundle legitimately includes the real Three.js + world/model
    // builders (~1.9 MB), so the default 500 kB warning is noise here.
    chunkSizeWarningLimit: 2500,
  },
});
