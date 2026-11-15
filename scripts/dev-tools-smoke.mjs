#!/usr/bin/env node
/**
 * DEV TOOLS smoke test — verifies both viewers in the standalone Vite+React app.
 *
 *   npm run qa:devtools
 *   node scripts/dev-tools-smoke.mjs --quality=medium
 *   GPU=1 node scripts/dev-tools-smoke.mjs        # real D3D11 GPU instead of SwiftShader
 *   TOOLS_URL=http://127.0.0.1:5199 node scripts/dev-tools-smoke.mjs   # reuse a running server
 *
 * What it proves:
 *   1. `dev_tools/ui` boots (React shell + model stage + map stage) with 0 console
 *      errors / pageerrors and the expected `window.__stage` / `window.__mapStage`
 *      automation handles (contract used by scripts/model-shots.mjs).
 *   2. Model viewer: catalog lists models, a model builds, pose + preset view +
 *      2x2 contact sheet (`renderSheet`) work, draw calls > 0.
 *   3. Map viewer: the real map builds from src/config/maps via createWorld
 *      (draw calls / triangles > 0), the free-fly camera moves on WASD input, and
 *      switching maps rebuilds the scene without errors.
 *   4. Screenshots + a machine-readable summary land in shots/.
 *
 * The script starts its own Vite dev server on 127.0.0.1:5199 unless TOOLS_URL is
 * set (then it reuses that server). Requires local Chrome + playwright-core.
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = argv.find((entry) => entry.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const QUALITY = flag('quality', 'medium');
const PORT = Number(flag('port', process.env.TOOLS_PORT || 5199)) || 5199;
const REUSE_SERVER = Boolean(process.env.TOOLS_URL);
const BASE = (process.env.TOOLS_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const OUT = resolve('shots');
const MODEL_TIMEOUT = Number(flag('model-timeout', 240000));
const MAP_TIMEOUT = Number(flag('map-timeout', 420000));

if (!existsSync(CHROME)) {
  console.error(`[qa:devtools] Chrome not found: ${CHROME}\nSet CHROME_PATH to a Chrome/Edge executable.`);
  process.exit(1);
}
await mkdir(OUT, { recursive: true });

const result = {
  base: BASE,
  quality: QUALITY,
  errors: [],
  checks: {},
  model: null,
  map: null,
  screenshots: {},
  startedAt: new Date().toISOString(),
};
const note = (message) => {
  result.errors.push(message);
  console.error('  ✗', message);
};
const ok = (message) => console.log('  ✓', message);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------
// Vite dev server lifecycle
// ---------------------------------------------------------------------------
let viteChild = null;

async function serverResponds() {
  try {
    const response = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function ensureServer() {
  if (await serverResponds()) {
    console.log(`  · reusing dev server at ${BASE}`);
    return;
  }
  if (REUSE_SERVER) {
    console.error(`[qa:devtools] TOOLS_URL=${BASE} is not reachable`);
    process.exit(1);
  }
  console.log(`  · starting Vite dev server on ${BASE}`);
  const viteBin = resolve('node_modules/vite/bin/vite.js');
  if (!existsSync(viteBin)) {
    console.error('[qa:devtools] vite is not installed — run `npm install` first');
    process.exit(1);
  }
  viteChild = spawn(process.execPath, [viteBin, 'dev_tools/ui', '--port', String(PORT)], {
    // DEV_TOOLS_QA disables Vite HMR in the spawned server: another workstream
    // saving an imported game source file must not reload the page mid-probe.
    env: { ...process.env, BROWSER: 'none', DEV_TOOLS_QA: '1' },
    stdio: 'ignore',
    windowsHide: true,
  });
  viteChild.on('error', (error) => console.error('[qa:devtools] vite spawn error', error));
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await serverResponds()) return;
    if (viteChild.exitCode !== null) throw new Error(`vite exited early with code ${viteChild.exitCode}`);
    await sleep(300);
  }
  throw new Error('vite dev server did not respond within 60s');
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
const USE_GPU = process.env.GPU === '1';
const GPU_ARGS = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-gpu-sandbox'];
const SWIFTSHADER_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--disable-gpu-sandbox',
  '--disable-dev-shm-usage',
];

let browser = null;
const pageErrors = [];
function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`[${label} console] ${message.text()}`);
  });
  page.on('pageerror', (error) => pageErrors.push(`[${label} pageerror] ${error.message}`));
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (/favicon\.ico$/.test(url)) return;
    pageErrors.push(`[${label} requestfailed] ${url} ${request.failure()?.errorText || ''}`);
  });
}

function check(name, condition, detail = '') {
  result.checks[name] = { ok: Boolean(condition), detail };
  if (condition) ok(`${name}${detail ? ` — ${detail}` : ''}`);
  else note(`${name}${detail ? ` — ${detail}` : ''}`);
  return Boolean(condition);
}

try {
  await ensureServer();
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: USE_GPU ? GPU_ARGS : SWIFTSHADER_ARGS,
  });

  // =========================================================================
  // 1) MODEL VIEWER (automation mode: canvas only + window.__stage)
  // =========================================================================
  console.log('\n[1] model viewer');
  const modelPage = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 });
  watch(modelPage, 'model');
  const modelStarted = Date.now();
  await modelPage.goto(`${BASE}/?automation=1&tab=models&quality=${QUALITY}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await modelPage.waitForFunction(
    () => window.__stage?.ready === true || window.__stage?.bootError,
    null,
    { timeout: MODEL_TIMEOUT },
  );
  const modelBoot = await modelPage.evaluate(() => ({
    ready: window.__stage?.ready === true,
    bootError: window.__stage?.bootError || null,
    models: (window.__stage?.models || []).length,
    views: window.__stage?.views || [],
    canvas: (() => {
      const canvas = document.querySelector('canvas');
      return canvas ? { width: canvas.width, height: canvas.height } : null;
    })(),
  }));
  result.model = { bootMs: Date.now() - modelStarted, ...modelBoot };
  check('model stage boots', modelBoot.ready && !modelBoot.bootError, modelBoot.bootError || `ready in ${((Date.now() - modelStarted) / 1000).toFixed(1)}s`);
  check('model catalog is non-empty', modelBoot.models > 10, `${modelBoot.models} models`);
  check('model canvas has pixels', !!modelBoot.canvas && modelBoot.canvas.width > 0 && modelBoot.canvas.height > 0, JSON.stringify(modelBoot.canvas));

  if (modelBoot.ready) {
    const modelCheck = await modelPage.evaluate(async () => {
      const stage = window.__stage;
      // Exercise robots (poses) first, then a world prop (no poses).
      const robot = stage.models.find((model) => model.kind === 'robot');
      const worldProp = stage.models.find((model) => model.id === 'truck') || stage.models.find((model) => model.kind === 'world');
      const defaultView = 'three-quarter';
      const robotStats = robot ? await stage.show(robot.id) : null;
      if (robot && robot.poses?.length) stage.setPose(robot.poses[robot.poses.length - 1]);
      stage.setView('front');
      stage.render();
      const renderStats = stage.render();
      const orbit = stage.orbitState();
      const sheet = stage.renderSheet([
        { view: 'three-quarter' },
        { view: 'front' },
        { view: 'side' },
        { view: 'top' },
      ]);
      const worldStats = worldProp ? await stage.show(worldProp.id) : null;
      if (worldStats) {
        stage.setView(defaultView);
        stage.render();
      }
      return {
        robot: robotStats && { id: robotStats.id, tris: robotStats.triangles, size: robotStats.size, pose: robotStats.pose },
        poses: robot?.poses || [],
        world: worldStats && { id: worldStats.id, meshes: worldStats.meshes },
        orbit,
        sheet: sheet && { cells: sheet.cells, labels: sheet.labels },
        calls: renderStats?.calls ?? 0,
        triangles: renderStats?.triangles ?? 0,
        missingMaterials: stage.missingMaterials(),
      };
    });
    result.model.render = modelCheck;
    check('model builds with geometry', !!modelCheck.robot && modelCheck.robot.tris > 0, `${modelCheck.robot?.id} ${modelCheck.robot?.tris} tris`);
    check('model draw calls > 0', modelCheck.calls > 0, `${modelCheck.calls} calls / ${modelCheck.triangles} tris`);
    check('preset view applies (front -> az 180)', Math.round(modelCheck.orbit?.az || -1) === 180, `az=${modelCheck.orbit?.az} el=${modelCheck.orbit?.el}`);
    check('2x2 contact sheet renders 4 cells', modelCheck.sheet?.cells === 4 && modelCheck.sheet?.labels?.length === 4, JSON.stringify(modelCheck.sheet?.labels));
    check('world prop builds', !modelCheck.world || modelCheck.world.meshes > 0, JSON.stringify(modelCheck.world));
    check('no missing stage materials', (modelCheck.missingMaterials || []).length === 0, (modelCheck.missingMaterials || []).join(','));
    const modelShot = `${OUT}/devtools-01-model.png`;
    await modelPage.screenshot({ path: modelShot });
    result.screenshots.model = modelShot.replace(/\\/g, '/');
  }
  await modelPage.close();

  // =========================================================================
  // 2) MAP VIEWER (automation mode: canvas only + window.__mapStage)
  // =========================================================================
  console.log('\n[2] map viewer');
  const mapPage = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watch(mapPage, 'map');
  const mapStarted = Date.now();
  await mapPage.goto(`${BASE}/?automation=1&tab=map&quality=${QUALITY}&map=outpost-07`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await mapPage.waitForFunction(
    () => window.__mapStage?.state?.().ready === true || window.__mapStage?.bootError,
    null,
    { timeout: MAP_TIMEOUT },
  );
  const mapBoot = await mapPage.evaluate(() => {
    const state = window.__mapStage?.state?.() || {};
    const canvas = document.querySelector('canvas');
    return {
      state,
      bootError: window.__mapStage?.bootError || null,
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      maps: (window.__mapStage?.maps || []).map((map) => map.id),
    };
  });
  result.map = { bootMs: Date.now() - mapStarted, ...mapBoot };
  check('map stage builds', !!mapBoot.state?.ready && !mapBoot.bootError, mapBoot.bootError || `${mapBoot.state?.mapId} in ${((Date.now() - mapStarted) / 1000).toFixed(1)}s`);
  check('map draw calls / triangles > 0', Number(mapBoot.state?.calls) > 0 && Number(mapBoot.state?.triangles) > 0, `${mapBoot.state?.calls} calls / ${mapBoot.state?.triangles} tris`);
  check('map registry available', (mapBoot.maps || []).length >= 2, (mapBoot.maps || []).join(','));
  check('map canvas has pixels', !!mapBoot.canvas && mapBoot.canvas.width > 0 && mapBoot.canvas.height > 0, JSON.stringify(mapBoot.canvas));

  if (mapBoot.state?.ready) {
    // Real keyboard input must move the free-fly camera. The full map is heavy
    // (300k+ triangles): on SwiftShader a single frame can take longer than a
    // short key hold, so hold the key until the camera actually moved instead of
    // sleeping a fixed amount.
    const before = await mapPage.evaluate(() => {
      const state = window.__mapStage.state();
      window.__moveBaseline = state.position;
      return state;
    });
    await mapPage.keyboard.down('w');
    let moved = false;
    try {
      await mapPage.waitForFunction(
        () => {
          const state = window.__mapStage?.state?.();
          const baseline = window.__moveBaseline;
          if (!state || !baseline) return false;
          const dx = state.position[0] - baseline[0];
          const dz = state.position[2] - baseline[2];
          return Math.hypot(dx, dz) > 0.05;
        },
        null,
        { timeout: 20000, polling: 250 },
      );
      moved = true;
    } catch (_) {
      /* asserted below */
    }
    await mapPage.keyboard.up('w');
    await sleep(150);
    const after = await mapPage.evaluate(() => window.__mapStage.state());
    const dx = after.position[0] - before.position[0];
    const dz = after.position[2] - before.position[2];
    const distance = Math.hypot(dx, dz);
    result.map.cameraMove = { before: before.position, after: after.position, moved: distance, observed: moved };
    check('free-fly camera moves on WASD', distance > 0.05, `moved ${distance.toFixed(2)} m`);

    // Look input: drag on the canvas changes yaw.
    const yawBefore = after.yaw;
    const box = await mapPage.locator('canvas').boundingBox();
    if (box) {
      await mapPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await mapPage.mouse.down();
      await mapPage.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 6 });
      await mapPage.mouse.up();
      await sleep(150);
    }
    const afterLook = await mapPage.evaluate(() => window.__mapStage.state());
    result.map.cameraLook = { yawBefore, yawAfter: afterLook.yaw, pitchAfter: afterLook.pitch };
    check('pointer drag looks around', Math.abs(afterLook.yaw - yawBefore) > 0.01, `yaw ${yawBefore.toFixed(3)} -> ${afterLook.yaw.toFixed(3)}`);

    const mapShot = `${OUT}/devtools-02-map.png`;
    await mapPage.screenshot({ path: mapShot });
    result.screenshots.map = mapShot.replace(/\\/g, '/');

    // Map switching: rebuild the world for a second map (dispose -> createWorld).
    const switchTarget = (mapBoot.maps || []).find((id) => id !== mapBoot.state.mapId);
    if (switchTarget) {
      const switchStarted = Date.now();
      await mapPage.evaluate(async (mapId) => {
        await window.__mapStage.loadMap(mapId);
      }, switchTarget);
      const switched = await mapPage.evaluate(() => window.__mapStage.state());
      result.map.switched = { mapId: switched.mapId, ms: Date.now() - switchStarted };
      check('map switch rebuilds the world', switched.mapId === switchTarget && Number(switched.triangles) > 0, `${switched.mapId} in ${((Date.now() - switchStarted) / 1000).toFixed(1)}s`);
      const switchShot = `${OUT}/devtools-03-map-${switchTarget}.png`;
      await mapPage.screenshot({ path: switchShot });
      result.screenshots.mapSwitch = switchShot.replace(/\\/g, '/');
    }
  }
  await mapPage.close();

  // =========================================================================
  // 3) Errors
  // =========================================================================
  console.log('\n[3] console / page errors');
  if (pageErrors.length) {
    for (const error of pageErrors.slice(0, 20)) note(error);
    if (pageErrors.length > 20) note(`… and ${pageErrors.length - 20} more`);
  } else if (!result.errors.length) {
    ok('0 console error / pageerror / requestfailed');
  }
  result.pageErrors = pageErrors;
} catch (error) {
  note(error.stack || error.message || String(error));
} finally {
  try {
    await browser?.close();
  } catch (_) {
    /* best effort */
  }
  if (viteChild) {
    try {
      viteChild.kill();
    } catch (_) {
      /* best effort */
    }
  }
  result.finishedAt = new Date().toISOString();
  result.ok = result.errors.length === 0;
  await writeFile(resolve(OUT, 'devtools-qa.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(`\ndev tools QA: ${result.ok ? 'PASS' : `FAIL (${result.errors.length} error${result.errors.length === 1 ? '' : 's'})`}  →  shots/devtools-qa.json\n`);
  if (!result.ok) process.exitCode = 1;
}
