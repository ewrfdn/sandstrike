#!/usr/bin/env node
/**
 * SANDSTRIKE world/map equivalence verifier (map-refactor QA tool).
 *
 * Two modes:
 *
 *   capture  (--tag=<name>)
 *     Opens the running game at `?dev=1&quality=<q>[&map=<id>]`, waits for the world to be
 *     ready, then dumps the authoritative world data (`window.__worldBuilt.data`), renderer
 *     statistics, and a fixed set of deterministic raw-geometry screenshots (6 cameras).
 *     Output: <out>/<tag>/{data.json, stats.json, report.json, *.png}
 *
 *   compare  (--compare=<a>,<b>)
 *     Normalised deep comparison of two captures (collision boxes as sorted multisets; layout
 *     / spawns / bounds / landmarks / warnings deep-equal), plus per-shot pixel diff computed
 *     in a blank Chromium page via canvas ImageData (no extra dependencies).
 *     Output: <out>/compare-<a>-<b>.json ; exit code 1 when anything FAILs.
 *
 * Contract (see src/config/maps/README.md):
 *   - layout / collisionBoxes / playerSpawn / enemySpawns / mapBounds / landmarks / warnings
 *     must be equivalent to the pre-refactor baseline; newly added data fields (terrain,
 *     environment, dressing, id/name/format, ...) are reported but do not fail the compare.
 *   - mean absolute pixel difference for every screenshot must stay below 1.5 %.
 *
 * Usage:
 *   node scripts/world-verify.mjs --tag=baseline
 *   node scripts/world-verify.mjs --tag=after
 *   node scripts/world-verify.mjs --compare=baseline,after
 *   node scripts/world-verify.mjs --tag=test-range --map=test-range
 *   QA_GPU=0 node scripts/world-verify.mjs --tag=baseline      # force SwiftShader
 *   node scripts/world-verify.mjs --compare=baseline,baseline  # tool self-check (must PASS)
 *
 * Flags: --tag= --compare= --url= --map= --quality= --out= --gpu=0|1 --help
 * Env:   QA_GPU=0 (fallback to SwiftShader), CHROME_PATH (Chrome executable).
 *
 * Output defaults to `.scratch/maps-refactor/verify/` (gitignored). READ-ONLY on src/.
 */
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TOOL = 'scripts/world-verify.mjs';
const ROOT = process.cwd();
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEWPORT = { width: 1600, height: 900 };
const DEFAULT_URL = 'http://127.0.0.1:8080';
const DEFAULT_QUALITY = 'medium';
const DEFAULT_OUT = '.scratch/maps-refactor/verify';

/** Fixed deterministic camera table (same as the original baseline dump). */
const CAMERAS = [
  { name: 'plan-top', pos: [0, 96, 0.01], target: [0, 0, 0], fov: 60 },
  { name: 'eye-spawn', pos: [0, 1.7, 26], target: [0, 2.2, 9.5], fov: 74 },
  { name: 'eye-midgate', pos: [0, 1.7, -1.5], target: [0, 2.4, -16], fov: 74 },
  { name: 'eye-a-site', pos: [27.5, 1.7, -10.5], target: [17, 2.2, -26], fov: 74 },
  { name: 'eye-b-tunnel', pos: [-18.5, 1.7, -8.0], target: [-27, 2.2, -17], fov: 74 },
  { name: 'eye-plaza', pos: [10, 1.7, 20], target: [0, 2.0, 6], fov: 74 },
];

/** Screenshot mean absolute difference thresholds (per contract: <1.5 % required). */
const MEAN_DIFF_FAIL_PCT = 1.5;
const MEAN_DIFF_WARN_PCT = 0.5;

/** Fields whose equivalence is a hard requirement. */
const REQUIRED_DATA_FIELDS = ['collisionBoxes', 'playerSpawn', 'enemySpawns', 'mapBounds', 'landmarks', 'warnings', 'layout'];
const REPORT_ONLY_FIELDS = ['id', 'name', 'subtitle', 'description', 'format', 'terrain', 'environment', 'dressing'];

const GPU_ARGS = [
  '--use-angle=d3d11',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--disable-gpu-sandbox',
  '--autoplay-policy=no-user-gesture-required',
];
const SWIFTSHADER_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--disable-gpu-sandbox',
  '--disable-dev-shm-usage',
  '--autoplay-policy=no-user-gesture-required',
];

const USAGE = `
SANDSTRIKE world/map equivalence verifier

  node ${TOOL} --tag=<name>                 capture a tagged baseline/candidate snapshot
  node ${TOOL} --compare=<a>,<b>            compare two captured tags (exit 1 on FAIL)

Flags:
  --tag=<name>        capture tag (output dir <out>/<name>)
  --compare=<a>,<b>   compare two captures, writing <out>/compare-<a>-<b>.json
  --url=<base>        dev server base url (default ${DEFAULT_URL})
  --map=<id>          optional map id, appended as &map=<id>
  --quality=<q>       renderer quality bucket (default ${DEFAULT_QUALITY})
  --out=<dir>         output root (default ${DEFAULT_OUT})
  --gpu=0|1           force SwiftShader (0) or D3D11 GPU (1); QA_GPU=0 also forces SwiftShader
  --help              show this help

Env:
  QA_GPU=0            fall back to SwiftShader rendering
  CHROME_PATH         Chrome/Chromium executable
`.trim();

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name, fallback = null) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) {
      const next = argv[i + 1];
      return next && !next.startsWith('--') ? next : true;
    }
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}
const hasFlag = (name) => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const asBool = (value, fallback) => (value === null || value === undefined ? fallback : value !== '0' && value !== 'false');

if (hasFlag('help') || argv.length === 0) {
  console.log(USAGE);
  process.exit(0);
}

const OUT_ROOT = path.resolve(ROOT, String(flag('out', DEFAULT_OUT)));
const BASE_URL = String(flag('url', DEFAULT_URL)).replace(/\/+$/, '');
const MAP_ID = flag('map', null) ? String(flag('map', null)) : null;
const QUALITY = String(flag('quality', DEFAULT_QUALITY));
const TAG = flag('tag', null) ? String(flag('tag', null)) : null;
const COMPARE = flag('compare', null) ? String(flag('compare', null)) : null;
const WANT_GPU = process.env.QA_GPU !== '0' && asBool(flag('gpu', null), true);

/** Normalise a tag into a filesystem-friendly path fragment. */
function tagPath(tag) {
  return tag.replace(/[^A-Za-z0-9._-]+/g, '_');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function listPngs(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map((entry) => entry.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------
async function openGame(useGpu) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: useGpu ? GPU_ARGS : SWIFTSHADER_ARGS,
  });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    else if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`[pageerror] ${error.message}`));
  return { browser, page, consoleErrors, consoleWarnings, mode: useGpu ? 'd3d11' : 'swiftshader' };
}

async function launchGame(wantGpu) {
  const order = wantGpu ? [true, false] : [false];
  let lastError = null;
  for (const gpu of order) {
    const t0 = Date.now();
    try {
      const session = await openGame(gpu);
      console.log(`[load] ${session.mode} launched in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return session;
    } catch (error) {
      lastError = error;
      console.warn(`[load] ${gpu ? 'd3d11' : 'swiftshader'} failed: ${String(error && error.message ? error.message : error).slice(0, 300)}`);
    }
  }
  throw lastError || new Error('could not launch Chromium');
}

function gameUrl() {
  const params = new URLSearchParams({ dev: '1', quality: QUALITY });
  if (MAP_ID) params.set('map', MAP_ID);
  return `${BASE_URL}/?${params.toString()}`;
}

/**
 * Wait until the world is built. Polls instead of `waitForFunction` so a fatal boot
 * overlay fails fast with the real error instead of burning the whole timeout.
 */
async function waitForWorldReady(page, consoleErrors, timeoutMs = 200_000) {
  const started = Date.now();
  let lastState = null;
  while (Date.now() - started < timeoutMs) {
    const state = await page.evaluate(() => {
      const app = window.__sandstrikeApp;
      const fatal = document.querySelector('.fatal-screen');
      return {
        loaded: app?.loaded === true,
        hasWorld: !!window.__sandstrike?.world?.collisionBoxes?.length,
        hasData: !!window.__worldBuilt?.data,
        state: (() => { try { return app?.state ?? null; } catch { return null; } })(),
        fatal: fatal ? (fatal.textContent || '').slice(0, 500) : null,
      };
    }).catch(() => null);
    lastState = state;
    if (state?.fatal) {
      throw new Error(`page fatal screen: ${state.fatal}`);
    }
    if (state?.loaded && state.hasWorld && state.hasData) return state;
    await sleep(1000);
  }
  const tail = consoleErrors.slice(-8).join('\n');
  throw new Error(
    `timed out after ${Math.round((Date.now() - started) / 1000)}s waiting for world ready; `
    + `last state=${JSON.stringify(lastState)}`
    + (tail ? `\nrecent console errors:\n${tail}` : ''),
  );
}

/** Render one fixed camera twice and screenshot it (deterministic raw-geometry capture). */
async function takeCameraShot(page, tagDir, camera, shots) {
  const info = await page.evaluate((cam) => {
    const S = window.__sandstrike;
    const applied = S.setCamera({ pos: cam.pos, target: cam.target, fov: cam.fov });
    // Render twice: first frame warms/allocates, second one is the deterministic capture.
    S.renderFrame();
    S.renderFrame();
    return applied;
  }, camera);
  await sleep(120);
  await page.screenshot({ path: path.join(tagDir, `${camera.name}.png`) });
  shots.push({ name: camera.name, file: `${camera.name}.png`, pos: info?.pos ?? camera.pos, fov: camera.fov });
  console.log(`[shot] ${camera.name}.png`);
}

/**
 * Extra map-generic views for non-default maps: the fixed camera table above is tuned to
 * outpost-07, so a differently shaped map (e.g. the 42x42 training range) gets its own
 * bounds-derived angles. Names are `map-` prefixed so same-map captures stay comparable.
 */
function buildGenericCameras(data) {
  const bounds = data?.mapBounds;
  if (!bounds || data.id === 'outpost-07') return [];
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const spawn = data.playerSpawn ?? { x: cx, z: cz };
  return [
    { name: 'map-overview', pos: [cx, Math.max(70, Math.max(width, depth) * 2.6), cz + 0.01], target: [cx, 0, cz], fov: 60 },
    { name: 'map-spawn-view', pos: [spawn.x, 1.7, spawn.z], target: [cx, 2.2, cz], fov: 74 },
    { name: 'map-center-view', pos: [cx, 1.7, cz + Math.min(14, depth * 0.3)], target: [cx, 2.4, cz - 6], fov: 74 },
  ];
}

async function capturePage(page, tagDir, consoleErrors) {
  const url = gameUrl();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const ready = await waitForWorldReady(page, consoleErrors);
  console.log(`[load] world ready (state=${ready.state ?? 'n/a'})`);
  // Let the first menu frames settle so the world/GPU state is stable before dumping.
  await sleep(900);

  // 1. Authoritative world data (structured-clone plain JSON, exactly as the contract requires).
  const data = await page.evaluate(() => JSON.parse(JSON.stringify(window.__worldBuilt.data)));

  // 2. Render + scene statistics (after a controlled render, mirrors dump-baseline.mjs).
  const stats = await page.evaluate(() => {
    const S = window.__sandstrike;
    const info = S.renderOnce();
    let objects = 0;
    let meshes = 0;
    let instanced = 0;
    let points = 0;
    let lights = 0;
    let sprites = 0;
    S.scene.traverse((object) => {
      objects++;
      if (object.isMesh) meshes++;
      if (object.isInstancedMesh) instanced++;
      if (object.isPoints) points++;
      if (object.isLight) lights++;
      if (object.isSprite) sprites++;
    });
    const d = window.__worldBuilt?.data ?? {};
    return {
      render: info,
      scene: { objects, meshes, instanced, points, lights, sprites, children: S.scene.children.length },
      world: {
        mapId: S.world?.mapId ?? null,
        mapName: S.world?.mapName ?? null,
        collideMeshes: S.world?.collideMeshes?.length ?? 0,
        collisionBoxes: S.world?.collisionBoxes?.length ?? 0,
        enemySpawns: S.world?.enemySpawns?.length ?? 0,
        landmarks: S.world?.landmarks?.length ?? 0,
        warnings: Array.isArray(d.warnings) ? d.warnings.length : 0,
        dataKeys: Object.keys(d).sort(),
        dataId: d.id ?? null,
        format: d.format ?? null,
      },
    };
  });

  const dataText = JSON.stringify(data);
  const dataHash = createHash('sha256').update(dataText).digest('hex').slice(0, 16);

  // 3. Fixed raw-geometry screenshots: freeze simulation, hide UI, disable post FX,
  //    pin adaptive resolution so the presentation is deterministic.
  await page.evaluate(() => {
    const S = window.__sandstrike;
    S.freeze(true);
    S.hideUI(true);
    S.setPostfxEnabled(false);
    if (typeof S.setAdaptiveScale === 'function') S.setAdaptiveScale(1);
  });
  await sleep(150);

  const shots = [];
  for (const camera of CAMERAS) await takeCameraShot(page, tagDir, camera, shots);
  const generic = buildGenericCameras(data);
  if (generic.length) {
    console.log(`[shots] extra map-generic views for "${data.id}": ${generic.map((camera) => camera.name).join(', ')}`);
    for (const camera of generic) await takeCameraShot(page, tagDir, camera, shots);
  }

  return { url, data, dataHash, dataText, stats, shots, tagDir };
}

async function runCapture() {
  if (!TAG || TAG === 'true') {
    console.error('capture mode requires --tag=<name>');
    process.exit(2);
  }
  const tagDir = path.join(OUT_ROOT, tagPath(TAG));
  await mkdir(tagDir, { recursive: true });
  const session = await launchGame(WANT_GPU);
  const { browser, page, consoleErrors, consoleWarnings, mode } = session;
  const report = {
    mode: 'capture',
    tool: TOOL,
    generatedAt: new Date().toISOString(),
    tag: TAG,
    url: null,
    map: MAP_ID,
    quality: QUALITY,
    gpu: mode,
    viewport: VIEWPORT,
    consoleErrors,
    consoleWarnings,
    fatal: null,
    shots: [],
    stats: null,
    data: null,
  };
  let exitCode = 0;
  try {
    const result = await capturePage(page, tagDir, consoleErrors);
    report.url = result.url;
    report.shots = result.shots;
    report.stats = result.stats;
    report.data = {
      hash: result.dataHash,
      bytes: Buffer.byteLength(result.dataText, 'utf8'),
      keys: Object.keys(result.data).sort(),
      collisionBoxes: Array.isArray(result.data.collisionBoxes) ? result.data.collisionBoxes.length : 0,
      enemySpawns: Array.isArray(result.data.enemySpawns) ? result.data.enemySpawns.length : 0,
      landmarks: Array.isArray(result.data.landmarks) ? result.data.landmarks.length : 0,
      warnings: Array.isArray(result.data.warnings) ? result.data.warnings.length : 0,
    };

    await writeFile(path.join(result.tagDir, 'data.json'), JSON.stringify(result.data, null, 1) + '\n', 'utf8');
    await writeFile(
      path.join(result.tagDir, 'stats.json'),
      JSON.stringify({
        capture: {
          tag: TAG,
          url: result.url,
          map: MAP_ID,
          quality: QUALITY,
          gpu: mode,
          viewport: VIEWPORT,
          generatedAt: report.generatedAt,
        },
        ...result.stats,
      }, null, 2) + '\n',
      'utf8',
    );

    if (consoleErrors.length) {
      exitCode = 1;
      console.error(`[fail] ${consoleErrors.length} console error(s) during capture:`);
      for (const error of consoleErrors.slice(0, 15)) console.error('  -', error);
    } else {
      console.log('[ok] no console errors');
    }
    const summary = {
      collisionBoxes: report.data.collisionBoxes,
      enemySpawns: report.data.enemySpawns,
      landmarks: report.data.landmarks,
      warnings: report.data.warnings,
      renderCalls: result.stats.render.calls,
      triangles: result.stats.render.triangles,
      textures: result.stats.render.textures,
      geometries: result.stats.render.geometries,
    };
    console.log(`[capture] ${TAG}: ${JSON.stringify(summary)}`);
    report.summary = summary;
    report.pass = consoleErrors.length === 0;
  } catch (error) {
    exitCode = 1;
    report.fatal = String(error && error.stack ? error.stack : error);
    console.error('[fatal]', report.fatal);
  } finally {
    await writeFile(path.join(OUT_ROOT, tagPath(TAG), 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
    await browser.close();
  }
  console.log(`[out] ${path.join(OUT_ROOT, tagPath(TAG))}`);
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Compare helpers
// ---------------------------------------------------------------------------
const BOX_FIELDS = ['minX', 'maxX', 'minZ', 'maxZ', 'minY', 'maxY', 'surface'];

/** Normalise a collision box to the contract shape (minY defaults to 0). */
function normalizeBox(box) {
  const out = {};
  for (const field of BOX_FIELDS) {
    if (field === 'surface') out[field] = box?.surface ?? 'unknown';
    else out[field] = Number(box?.[field] ?? (field === 'minY' ? 0 : NaN));
  }
  return out;
}
function boxSignature(box) {
  return BOX_FIELDS.map((field) => `${field}=${box[field]}`).join('|');
}
function sortedBoxes(list) {
  if (!Array.isArray(list)) return null;
  return list.map(normalizeBox).sort((a, b) => {
    const sa = boxSignature(a);
    const sb = boxSignature(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
function describeValue(value) {
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

/** Exact deep equality; collects path-tagged diffs (capped). */
function deepEqual(a, b, pathName, diffs, limit = 60) {
  const push = (diff) => {
    if (diffs.length < limit) diffs.push(diff);
    return false;
  };
  if (Object.is(a, b)) return true;
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) return push({ path: pathName, kind: 'type', a: ta, b: tb });
  if (ta === 'array') {
    if (a.length !== b.length) {
      return push({ path: pathName, kind: 'length', a: a.length, b: b.length });
    }
    let ok = true;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], `${pathName}[${i}]`, diffs, limit)) ok = false;
    }
    return ok;
  }
  if (ta === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    let ok = true;
    for (const key of keysA) {
      if (!(key in b)) {
        push({ path: pathName ? `${pathName}.${key}` : key, kind: 'missing', a: describeValue(a[key]) });
        ok = false;
        continue;
      }
      if (!deepEqual(a[key], b[key], pathName ? `${pathName}.${key}` : key, diffs, limit)) ok = false;
    }
    for (const key of keysB) {
      if (!(key in a)) {
        push({ path: pathName ? `${pathName}.${key}` : key, kind: 'extra', b: describeValue(b[key]) });
        ok = false;
      }
    }
    return ok;
  }
  return push({ path: pathName, kind: 'value', a: describeValue(a), b: describeValue(b) });
}

function check(id, label, ok, extra = {}) {
  return { id, label, status: ok ? 'PASS' : 'FAIL', ...extra };
}

function compareCollisionBoxes(a, b) {
  const boxesA = sortedBoxes(a);
  const boxesB = sortedBoxes(b);
  if (!boxesA || !boxesB) {
    return {
      id: 'data.collisionBoxes',
      label: 'collisionBoxes (sorted multiset)',
      status: 'FAIL',
      detail: 'missing or non-array collisionBoxes',
      diffs: [{ path: 'collisionBoxes', kind: 'missing', a: Array.isArray(a), b: Array.isArray(b) }],
    };
  }
  const sigA = boxesA.map(boxSignature);
  const sigB = boxesB.map(boxSignature);
  const same = sigA.length === sigB.length && sigA.every((sig, i) => sig === sigB[i]);
  if (same) {
    return {
      id: 'data.collisionBoxes',
      label: 'collisionBoxes (sorted multiset)',
      status: 'PASS',
      detail: `${boxesA.length} boxes, surface/minY/maxY identical`,
    };
  }
  // Multiset difference for a readable report.
  const countsB = new Map();
  for (const sig of sigB) countsB.set(sig, (countsB.get(sig) || 0) + 1);
  const missing = [];
  for (const sig of sigA) {
    const left = countsB.get(sig) || 0;
    if (left > 0) countsB.set(sig, left - 1);
    else if (missing.length < 40) missing.push(sig);
  }
  const countsA = new Map();
  for (const sig of sigA) countsA.set(sig, (countsA.get(sig) || 0) + 1);
  const extra = [];
  for (const sig of sigB) {
    const left = countsA.get(sig) || 0;
    if (left > 0) countsA.set(sig, left - 1);
    else if (extra.length < 40) extra.push(sig);
  }
  return {
    id: 'data.collisionBoxes',
    label: 'collisionBoxes (sorted multiset)',
    status: 'FAIL',
    detail: `a=${boxesA.length} boxes, b=${boxesB.length} boxes, ${missing.length} missing, ${extra.length} extra`,
    diffs: [
      ...missing.map((sig) => ({ kind: 'missing-in-b', box: sig })),
      ...extra.map((sig) => ({ kind: 'extra-in-b', box: sig })),
    ].slice(0, 60),
  };
}

function compareLayout(a, b) {
  const layoutA = a?.layout;
  const layoutB = b?.layout;
  if (!layoutA || !layoutB || typeOf(layoutA) !== 'object' || typeOf(layoutB) !== 'object') {
    return {
      id: 'data.layout',
      label: 'layout (every key deep-equal)',
      status: 'FAIL',
      detail: 'missing layout object on one side',
      diffs: [],
    };
  }
  const keysA = Object.keys(layoutA);
  const missingKeys = keysA.filter((key) => !(key in layoutB));
  const extraKeys = Object.keys(layoutB).filter((key) => !(key in layoutA));
  const diffs = [];
  const badKeys = [];
  for (const key of keysA) {
    if (!(key in layoutB)) continue;
    const keyDiffs = [];
    if (!deepEqual(layoutA[key], layoutB[key], `layout.${key}`, keyDiffs)) {
      badKeys.push(key);
      diffs.push(...keyDiffs);
    }
  }
  const ok = missingKeys.length === 0 && badKeys.length === 0;
  const status = ok ? (extraKeys.length ? 'WARN' : 'PASS') : 'FAIL';
  return {
    id: 'data.layout',
    label: 'layout (every key deep-equal)',
    status,
    detail: ok
      ? `${keysA.length} keys equal${extraKeys.length ? `, extra keys in b: ${extraKeys.join(', ')}` : ''}`
      : `missing keys: ${missingKeys.join(', ') || '-'}; mismatched keys: ${badKeys.join(', ') || '-'}`,
    diffs: diffs.slice(0, 60),
    missingKeys,
    extraKeys,
  };
}

function compareData(a, b) {
  const checks = [];

  checks.push(compareCollisionBoxes(a?.collisionBoxes, b?.collisionBoxes));

  for (const field of ['playerSpawn', 'enemySpawns', 'mapBounds', 'landmarks', 'warnings']) {
    const diffs = [];
    const ok = deepEqual(a?.[field], b?.[field], field, diffs);
    const count = Array.isArray(a?.[field]) ? a[field].length : undefined;
    checks.push(check(
      `data.${field}`,
      `${field} (deep-equal, order-sensitive)`,
      ok,
      { detail: ok ? (count !== undefined ? `${count} entries equal` : 'equal') : 'differs', diffs: diffs.slice(0, 60) },
    ));
  }

  const layoutCheck = compareLayout(a, b);
  layoutCheck.id = 'data.layout';
  layoutCheck.label = 'layout (every key deep-equal)';
  checks.push(layoutCheck);

  // Added fields are allowed by the contract — report only, never fail.
  const presentA = REQUIRED_DATA_FIELDS.filter((field) => field in (a || {}));
  const presentB = REQUIRED_DATA_FIELDS.filter((field) => field in (b || {}));
  const onlyB = Object.keys(b || {}).filter((key) => !(key in (a || {})));
  const onlyA = Object.keys(a || {}).filter((key) => !(key in (b || {})));
  checks.push({
    id: 'data.addedFields',
    label: 'added fields (report-only, terrain/environment/dressing allowed)',
    status: 'INFO',
    detail: {
      requiredFieldsPresent: { a: presentA.length, b: presentB.length, missingInB: REQUIRED_DATA_FIELDS.filter((f) => !presentB.includes(f)) },
      onlyInA: onlyA,
      onlyInB: onlyB,
      reportOnly: onlyB.filter((key) => REPORT_ONLY_FIELDS.includes(key)),
      unknownNewFields: onlyB.filter((key) => !REPORT_ONLY_FIELDS.includes(key)),
    },
  });

  return checks;
}

function compareCaptureMeta(reportA, statsA, reportB, statsB) {
  const checks = [];
  const errorsA = Array.isArray(reportA?.consoleErrors) ? reportA.consoleErrors : [];
  const errorsB = Array.isArray(reportB?.consoleErrors) ? reportB.consoleErrors : [];
  checks.push({
    id: 'capture.consoleErrors',
    label: 'console errors (a and b)',
    status: errorsA.length === 0 && errorsB.length === 0 ? 'PASS' : 'FAIL',
    detail: { a: errorsA.slice(0, 10), b: errorsB.slice(0, 10) },
  });

  const metaA = statsA?.capture || {};
  const metaB = statsB?.capture || {};
  const modeA = metaA.gpu ?? reportA?.gpu ?? null;
  const modeB = metaB.gpu ?? reportB?.gpu ?? null;
  const qualityA = metaA.quality ?? null;
  const qualityB = metaB.quality ?? null;
  const mapA = metaA.map ?? null;
  const mapB = metaB.map ?? null;
  const sameRenderMode = modeA === modeB && qualityA === qualityB;
  const sameMap = mapA === mapB;
  checks.push({
    id: 'capture.renderMode',
    label: 'capture render mode / quality / map identical',
    status: !sameMap ? 'FAIL' : sameRenderMode ? 'PASS' : 'WARN',
    detail: { a: { gpu: modeA, quality: qualityA, map: mapA }, b: { gpu: modeB, quality: qualityB, map: mapB } },
  });
  return checks;
}

function compareStats(statsA, statsB) {
  const rows = [];
  const pick = (obj, key) => {
    if (!obj || typeof obj !== 'object') return undefined;
    let current = obj;
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') return undefined;
      current = current[part];
    }
    return current;
  };
  const watched = [
    ['render.calls', 'draw calls'],
    ['render.triangles', 'triangles'],
    ['render.textures', 'textures'],
    ['render.geometries', 'geometries'],
    ['scene.objects', 'scene objects'],
    ['scene.meshes', 'meshes'],
    ['scene.instanced', 'instanced meshes'],
    ['scene.points', 'point clouds'],
    ['scene.lights', 'lights'],
    ['scene.children', 'scene children'],
    ['world.collideMeshes', 'collideMeshes'],
    ['world.collisionBoxes', 'collisionBoxes'],
    ['world.enemySpawns', 'enemySpawns'],
    ['world.landmarks', 'landmarks'],
  ];
  for (const [key, label] of watched) {
    const valueA = pick(statsA, key);
    const valueB = pick(statsB, key);
    if (valueA === undefined && valueB === undefined) continue;
    rows.push({
      id: `stats.${key}`,
      label: `${label} (${key})`,
      status: valueA === valueB ? 'PASS' : 'WARN',
      a: valueA ?? null,
      b: valueB ?? null,
    });
  }
  // Map identity is informational (a map swap is expected to change everything).
  const mapIdA = pick(statsA, 'world.mapId');
  const mapIdB = pick(statsB, 'world.mapId');
  if (mapIdA !== undefined || mapIdB !== undefined) {
    rows.push({ id: 'stats.world.mapId', label: 'mapId (info)', status: 'INFO', a: mapIdA ?? null, b: mapIdB ?? null });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Pixel diff (Chromium canvas, no extra dependencies)
// ---------------------------------------------------------------------------
async function openDiffPage(browser) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  return page;
}

/** Mean absolute RGB difference (%) between two PNG files, decoded in the page. */
async function pixelDiff(page, fileA, fileB) {
  const [bufferA, bufferB] = await Promise.all([readFile(fileA), readFile(fileB)]);
  const dataUrlA = `data:image/png;base64,${bufferA.toString('base64')}`;
  const dataUrlB = `data:image/png;base64,${bufferB.toString('base64')}`;
  return page.evaluate(async ({ a, b }) => {
    const load = (url) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image decode failed'));
      image.src = url;
    });
    const [imageA, imageB] = await Promise.all([load(a), load(b)]);
    if (imageA.width !== imageB.width || imageA.height !== imageB.height) {
      return { sizeMismatch: true, a: [imageA.width, imageA.height], b: [imageB.width, imageB.height] };
    }
    const width = imageA.width;
    const height = imageB.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const pixelsOf = (image) => {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, width, height).data;
    };
    const pixelsA = pixelsOf(imageA);
    const pixelsB = pixelsOf(imageB);
    const count = width * height;
    let sum = 0;
    let changed = 0;
    let max = 0;
    for (let i = 0; i < count; i++) {
      const offset = i * 4;
      const d0 = Math.abs(pixelsA[offset] - pixelsB[offset]);
      const d1 = Math.abs(pixelsA[offset + 1] - pixelsB[offset + 1]);
      const d2 = Math.abs(pixelsA[offset + 2] - pixelsB[offset + 2]);
      sum += d0 + d1 + d2;
      const worst = d0 > d1 ? (d0 > d2 ? d0 : d2) : (d1 > d2 ? d1 : d2);
      if (worst > max) max = worst;
      if (worst > 2) changed++;
    }
    return {
      width,
      height,
      meanAbsDiffPct: +((sum / (count * 3) / 255) * 100).toFixed(4),
      changedPct: +((changed / count) * 100).toFixed(3),
      maxChannelDiff: max,
    };
  }, { a: dataUrlA, b: dataUrlB });
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------
async function runCompare() {
  const [tagA, tagB] = COMPARE.split(',').map((part) => part.trim()).filter(Boolean);
  if (!tagA || !tagB) {
    console.error('compare mode requires --compare=<a>,<b>');
    process.exit(2);
  }
  const dirA = path.join(OUT_ROOT, tagPath(tagA));
  const dirB = path.join(OUT_ROOT, tagPath(tagB));
  const report = {
    mode: 'compare',
    tool: TOOL,
    generatedAt: new Date().toISOString(),
    a: { tag: tagA, dir: dirA },
    b: { tag: tagB, dir: dirB },
    checks: [],
    screenshots: [],
    statsDiagnostics: [],
    summary: { pass: 0, fail: 0, warn: 0, info: 0 },
    pass: false,
    fatal: null,
  };
  let browser = null;
  try {
    const [dataA, dataB, statsA, statsB, reportA, reportB] = await Promise.all([
      readJson(path.join(dirA, 'data.json')),
      readJson(path.join(dirB, 'data.json')),
      readJson(path.join(dirA, 'stats.json')),
      readJson(path.join(dirB, 'stats.json')),
      readJson(path.join(dirA, 'report.json')),
      readJson(path.join(dirB, 'report.json')),
    ]);
    report.a.present = { data: !!dataA, stats: !!statsA, report: !!reportA };
    report.b.present = { data: !!dataB, stats: !!statsB, report: !!reportB };

    if (!dataA || !dataB) {
      const diffs = [];
      if (!dataA) diffs.push({ kind: 'missing-capture', path: dirA });
      if (!dataB) diffs.push({ kind: 'missing-capture', path: dirB });
      report.checks.push({ id: 'capture.data', label: 'data.json present for both captures', status: 'FAIL', detail: diffs });
    } else {
      report.checks.push(...compareData(dataA, dataB));
    }
    report.checks.push(...compareCaptureMeta(reportA, statsA, reportB, statsB));
    report.statsDiagnostics = compareStats(statsA, statsB);

    // Screenshot pixel diff.
    const [shotsA, shotsB] = await Promise.all([listPngs(dirA), listPngs(dirB)]);
    const names = [...new Set([...shotsA, ...shotsB])].sort();
    if (names.length === 0) {
      report.screenshots.push({ id: 'screenshots', name: '(none)', status: 'FAIL', detail: 'no PNG screenshots found in either capture' });
    } else {
      browser = await chromium.launch({ executablePath: CHROME, headless: true });
      const diffPage = await openDiffPage(browser);
      for (const name of names) {
        const hasA = shotsA.includes(name);
        const hasB = shotsB.includes(name);
        if (!hasA || !hasB) {
          report.screenshots.push({
            name,
            status: 'FAIL',
            detail: `missing in ${!hasA ? `a (${tagA})` : `b (${tagB})`}`,
          });
          continue;
        }
        const result = await pixelDiff(diffPage, path.join(dirA, name), path.join(dirB, name));
        const mean = result.meanAbsDiffPct;
        let status = 'PASS';
        if (result.sizeMismatch) status = 'FAIL';
        else if (mean > MEAN_DIFF_FAIL_PCT) status = 'FAIL';
        else if (mean > MEAN_DIFF_WARN_PCT) status = 'WARN';
        report.screenshots.push({ name, status, ...result });
      }
      await diffPage.close();
    }
  } catch (error) {
    report.fatal = String(error && error.stack ? error.stack : error);
  } finally {
    if (browser) await browser.close();
    await mkdir(OUT_ROOT, { recursive: true });
    const fileName = `compare-${tagPath(tagA)}-${tagPath(tagB)}.json`;
    const checks = [...report.checks, ...report.screenshots.map((shot) => ({ id: `screenshot.${shot.name}`, label: `${shot.name} pixel diff`, status: shot.status }))];
    const countable = checks.filter((entry) => ['PASS', 'FAIL', 'WARN'].includes(entry.status));
    report.summary.pass = countable.filter((entry) => entry.status === 'PASS').length;
    report.summary.warn = countable.filter((entry) => entry.status === 'WARN').length;
    report.summary.fail = countable.filter((entry) => entry.status === 'FAIL').length;
    report.summary.info = report.checks.filter((entry) => entry.status === 'INFO').length;
    report.pass = !report.fatal && report.summary.fail === 0;
    await writeFile(path.join(OUT_ROOT, fileName), JSON.stringify(report, null, 2) + '\n', 'utf8');

    // Console summary.
    console.log(`\n=== world-verify compare: ${tagA} -> ${tagB} ===`);
    for (const entry of report.checks) {
      const detail = typeof entry.detail === 'object' ? JSON.stringify(entry.detail) : entry.detail;
      console.log(`${entry.status.padEnd(4)} ${entry.id.padEnd(30)} ${detail ?? ''}`);
    }
    for (const shot of report.screenshots) {
      const numbers = shot.meanAbsDiffPct !== undefined
        ? `mean ${shot.meanAbsDiffPct.toFixed(4)}%  changed ${shot.changedPct}%  max ${shot.maxChannelDiff}/255`
        : (shot.detail || '');
      console.log(`${shot.status.padEnd(4)} screenshot.${String(shot.name).padEnd(18)} ${numbers}`);
    }
    if (report.statsDiagnostics.length) {
      const changed = report.statsDiagnostics.filter((row) => row.status === 'WARN');
      console.log(`\nstats diagnostics: ${changed.length ? `${changed.length} changed (WARN only)` : 'all identical'}`);
      for (const row of changed) console.log(`WARN ${row.id.padEnd(26)} a=${row.a} b=${row.b}`);
    }
    if (report.fatal) console.error('\n[fatal]', report.fatal);
    console.log(`\nRESULT: ${report.pass ? 'PASS' : 'FAIL'} (${report.summary.fail} fail, ${report.summary.warn} warn)`);
    console.log(`[out] ${path.join(OUT_ROOT, fileName)}`);
  }
  process.exit(report.pass ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
if (COMPARE) await runCompare();
else await runCapture();
