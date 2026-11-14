/**
 * Model stage screenshot matrix — renders every catalog model on an isolated
 * platform and saves a labelled 2×2 contact sheet plus a geometry-stats index.
 *
 * Usage:
 *   node scripts/model-shots.mjs                       # full matrix -> shots/models
 *   node scripts/model-shots.mjs --only=truck,well     # subset
 *   node scripts/model-shots.mjs --quality=medium      # faster textures
 *   node scripts/model-shots.mjs --single=truck,side,base   # one close-up
 *
 * Requires the dev server (node serve.mjs) on BASE_URL (default :8080).
 * Set GPU=1 to use the real D3D11 GPU instead of SwiftShader.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const QUALITY = flag('quality', 'high');
const OUT_DIR = flag('out', 'shots/models');
const VIEWPORT = Number(flag('viewport', '1200')) || 1200;
const ONLY = (flag('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const SINGLE = flag('single', '');

fs.mkdirSync(OUT_DIR, { recursive: true });

const args = process.env.GPU === '1'
  ? ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-gpu-sandbox']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'];

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args });
const page = await browser.newPage({ viewport: { width: VIEWPORT, height: VIEWPORT } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const t0 = Date.now();
await page.goto(`${BASE}/stage.html?quality=${QUALITY}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__stage?.ready === true || window.__stage?.bootError, null, { timeout: 240000 });
const bootError = await page.evaluate(() => window.__stage?.bootError || null);
if (bootError) {
  console.error('stage boot failed:', bootError);
  process.exit(1);
}
console.log(`stage ready in ${((Date.now() - t0) / 1000).toFixed(1)}s (quality=${QUALITY})`);

const models = await page.evaluate(() => window.__stage.models);

function defaultSheet(model) {
  if (model.kind === 'robot') {
    return [
      { view: 'front', pose: 'base' },
      { view: 'three-quarter', pose: 'aim' },
      { view: 'side', pose: 'walk' },
      { view: 'top', pose: 'base' },
    ];
  }
  const poses = Array.isArray(model.poses) ? model.poses : [];
  if (poses.length) {
    // Weapon / held-prop sheet: BARE top row, HELD bottom row, so the contact
    // sheet itself proves the arm model is only attached when equipped.
    const cells = [
      { view: 'three-quarter', pose: 'bare' },
      { view: 'side', pose: 'bare' },
      { view: 'three-quarter', pose: 'held' },
      { view: 'front', pose: 'held' },
    ].filter((cell) => poses.includes(cell.pose));
    if (cells.length) return cells;
  }
  return [
    { view: 'three-quarter' },
    { view: 'front' },
    { view: 'side' },
    { view: 'back' },
  ];
}

async function shootSingle(spec) {
  const [id, view = 'three-quarter', pose = '', distScale = '1', outName = ''] = spec.split(',');
  const stats = await page.evaluate(async ({ modelId, viewName, poseName, ds }) => {
    const s = await window.__stage.show(modelId);
    const model = (window.__stage.models || []).find((m) => m.id === modelId);
    const poses = (model && model.poses) || [];
    if (poseName && poses.includes(poseName)) window.__stage.setPose(poseName);
    window.__stage.setView(viewName, { distScale: Number(ds) || 1 });
    window.__stage.render();
    return window.__stage.current();
  }, { modelId: id, viewName: view, poseName: pose, ds: distScale });
  const file = path.join(OUT_DIR, outName || `closeup-${id}-${view}${pose ? '-' + pose : ''}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
  console.log('saved', file, JSON.stringify({ size: stats.size, minY: stats.minY }));
  return stats;
}

if (SINGLE) {
  await shootSingle(SINGLE);
  await browser.close();
  process.exit(0);
}

const index = { quality: QUALITY, viewport: VIEWPORT, generatedAt: new Date().toISOString(), models: [], errors: [] };
const wanted = ONLY.length ? models.filter((m) => ONLY.includes(m.id)) : models;

for (let i = 0; i < wanted.length; i++) {
  const model = wanted[i];
  const t = Date.now();
  try {
    const stats = await page.evaluate(async (modelId) => {
      await window.__stage.show(modelId);
      return window.__stage.current();
    }, model.id);
    const sheet = defaultSheet(model);
    const info = await page.evaluate((items) => {
      const out = window.__stage.renderSheet(items);
      return out;
    }, sheet);
    const file = path.join(OUT_DIR, `${model.id}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    index.models.push({
      id: model.id,
      label: model.label,
      group: model.group,
      kind: model.kind,
      poses: model.poses || null,
      defaultPose: model.defaultPose || null,
      sheet: info?.labels || [],
      file: file.replace(/\\/g, '/'),
      stats,
      renderMs: Date.now() - t,
    });
    console.log(`[${i + 1}/${wanted.length}] ${model.id} (${((Date.now() - t) / 1000).toFixed(2)}s)`);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    index.errors.push({ id: model.id, message });
    console.error(`[${i + 1}/${wanted.length}] ${model.id} FAILED: ${message}`);
  }
}

index.bootMs = Date.now() - t0;
index.missingMaterials = await page.evaluate(() => window.__stage.missingMaterials());
index.consoleErrors = logs.slice(0, 40);
index.totalMs = Date.now() - t0;
const indexPath = path.join(OUT_DIR, 'index.json');
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(`\nwrote ${indexPath} — ${index.models.length} models, ${index.errors.length} failures, ${(index.totalMs / 1000).toFixed(1)}s`);

await browser.close();
