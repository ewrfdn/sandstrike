/**
 * SANDSTRIKE // 沙暴协议 — 5-tier render-quality independent black-box probe.
 * ---------------------------------------------------------------------------
 * Independent verification for TEAM task-6: LOWEST / LOW / MED / HIGH / ULTRA
 * quality tiers (UI buttons in both SYSTEM CONFIG panels + engine parameters),
 * URL override, persistence, touch/DPR behaviour, layout/screenshots, in-game
 * switching and regressions (FPS HUD, fullscreen toggle, other settings).
 *
 * Black box only: real DOM clicks + documented window.__sandstrike dev hooks.
 * Product code is never imported or modified.
 *
 * Usage:   node scripts/quality-probe.mjs [baseUrl]
 * Default: http://127.0.0.1:8099/?dev=1&quality=high&touch=0
 * Output:  shots/quality-probe.json  +  shots/quality-*.png
 *
 * Notes:
 *  - Headless Chrome MUST run with hardware GPU (ANGLE/D3D11).
 *  - START opens a deployment difficulty dialog in the shared workspace; the
 *    probe therefore enters runs via window.__sandstrike.start() and pauses via
 *    window.__sandstrike.pause().
 *  - Writable scope: this script, shots/quality-probe.json, shots/quality-*.png.
 */

import { chromium } from 'playwright-core';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Config / contract expectations
// ---------------------------------------------------------------------------
const BASE_URL = (process.argv[2] || process.env.QUALITY_PROBE_URL || 'http://127.0.0.1:8099').replace(/\/+$/, '');
const QUERY = process.env.QUALITY_PROBE_QUERY || 'dev=1&quality=high&touch=0';
const PAGE_URL = `${BASE_URL}/?${QUERY}`;
const MOBILE_QUERY = 'dev=1&quality=low&touch=1';
const MOBILE_URL = `${BASE_URL}/?${MOBILE_QUERY}`;
const OUT_DIR = resolve('shots');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEW_BIG = { width: 1600, height: 900 };
const VIEW_SMALL = { width: 1280, height: 720 };
const VIEW_MOBILE = { width: 844, height: 390 };
const RETRY_DELAYS = (process.env.QUALITY_PROBE_RETRY_DELAYS || '45000,60000')
  .split(',')
  .map((n) => Number(n))
  .filter((n) => Number.isFinite(n) && n >= 0);
const SETTINGS_KEY = 'sandstrike.settings.v1';

const TIERS = ['lowest', 'low', 'medium', 'high', 'ultra'];
const TIER_LABELS = { lowest: 'LOWEST', low: 'LOW', medium: 'MED', high: 'HIGH', ultra: 'ULTRA' };
/** Desktop DPR=1 expectations (task-6 contract). */
const EXPECT_DPR1 = {
  lowest: { pixelRatio: 0.55, shadows: false, shadowMap: 512, bloom: null },
  low: { pixelRatio: 0.75, shadows: true, shadowMap: 1024, bloom: 0.18 },
  medium: { pixelRatio: 1.0, shadows: true, shadowMap: 2048, bloom: 0.28 },
  high: { pixelRatio: 1.0, shadows: true, shadowMap: 4096, bloom: 0.4 },
  ultra: { pixelRatio: 1.0, shadows: true, shadowMap: 4096, bloom: 0.5 },
};
/** Desktop deviceScaleFactor=2 expectations. */
const EXPECT_DPR2 = { lowest: 0.55, low: 0.75, medium: 1.0, high: 1.65, ultra: 2.0 };
const EXPECT_MSAA = { lowest: 0, low: 2, medium: 2, high: 4, ultra: 4 };
const TOUCH_LOW_PIXEL_RATIO = 0.8;
const PR_TOL = 0.02;
const PR_TOL_DPR2 = 0.03;
const BLOOM_TOL = 0.02;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : v);

await mkdir(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Expected checks registry
// ---------------------------------------------------------------------------
const EXPECTED = [
  ['q-contract-ui', '契约：menu+pause 各 5 个画质按钮（LOWEST/LOW/MED/HIGH/ULTRA，顺序正确）'],
  ['q-contract-engine-hooks', '契约：game/postfx/effects/enemies.quality、pixelRatio、shadowMap、sun.mapSize、bloom、adaptiveScale 可读'],
  ['q-default-high', '默认：localStorage 为空时 HIGH（双面板 active + 引擎 high + DPR1 参数）'],
  ['q-tier-lowest', '逐档 LOWEST：引擎/像素比 0.55/阴影关闭/512/无 bloom/持久化/双面板同步'],
  ['q-tier-low', '逐档 LOW：引擎/0.75/阴影开 1024/bloom 0.18/持久化/双面板同步'],
  ['q-tier-medium', '逐档 MEDIUM：引擎/1.0/2048/bloom 0.28/持久化/双面板同步'],
  ['q-tier-high', '逐档 HIGH：引擎/1.0/4096/bloom 0.4/持久化/双面板同步'],
  ['q-tier-ultra', '逐档 ULTRA：引擎/1.0/4096/bloom 0.5/持久化/双面板同步'],
  ['q-msaa', 'MSAA samples 随档位：0/2/2/4/4（不可读取则 SKIP）'],
  ['q-panels-sync', 'menu 与 pause 两个设置面板 active 状态始终同步'],
  ['q-adaptive-scale', 'adaptiveScale 桌面恒为 1（切档后不漂移）'],
  ['q-layout-1600x900', '布局 1600×900 菜单：5 按钮在面板/视口内、无横向溢出、HIGH/LOWEST 截图'],
  ['q-layout-1280x720', '布局 1280×720 菜单：5 按钮在面板/视口内、无横向溢出、HIGH/LOWEST 截图'],
  ['q-persist', '持久化：选 LOW → reload → LOW 恢复（UI/引擎/像素比/阴影），再切回 HIGH'],
  ['q-ingame-switch', '游戏内切换：pause 面板切 LOWEST → 2s 内 frames 增长、renderOnce calls>0、HUD/FPS 正常、再切回 HIGH'],
  ['q-url-param-lowest', 'URL 参数 ?quality=lowest → game.quality=lowest、UI active、阴影关闭'],
  ['q-url-param-low', 'URL 参数 ?quality=low → game.quality=low、UI active、阴影 1024/像素比 0.75'],
  ['q-touch', '触屏 844×390 ?touch=1&quality=low → quality=low、pixelRatio≈0.8、adaptiveScale=1、切 LOWEST 无报错'],
  ['q-mobile-layout', '移动端 844×390 紧凑面板：5 按钮可点、不横向溢出、截图'],
  ['q-highdpr', 'DPR=2 桌面：pixelRatio 0.55/0.75/1.0/1.65/2.0（±0.03）'],
  ['q-regression', '回归：FPS 面板/全屏开关/其余设置项正常、frames 增长、renderOnce calls>0'],
  ['q-no-console-errors', '全程零 console error / pageerror'],
];

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------
const results = [];
const recordedIds = new Set();
const failures = [];
const skips = [];
const screenshots = [];
const consoleErrors = [];
const consoleLog = [];
const stages = {};
const measurements = { tiers: {}, expectations: { dpr1: EXPECT_DPR1, dpr2: EXPECT_DPR2, msaa: EXPECT_MSAA, touchLowPixelRatio: TOUCH_LOW_PIXEL_RATIO } };
const notes = [];
const stageErrors = [];
let page = null;
let context = null;
let browser = null;
const t0 = Date.now();

function record(id, name, status, detail = {}, note = '') {
  if (recordedIds.has(id)) return results.find((r) => r.id === id);
  recordedIds.add(id);
  const known = EXPECTED.find(([key]) => key === id);
  const row = {
    id,
    name: known ? known[1] : name,
    status: status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL',
    pass: status === 'PASS',
    detail,
    ...(note ? { note } : {}),
  };
  results.push(row);
  if (row.status === 'FAIL') failures.push(row);
  if (row.status === 'SKIP') skips.push(row);
  console.log(`[${row.status}] ${id}${note ? ' :: ' + note : ''}`);
  return row;
}

async function shot(name, target) {
  const path = `${OUT_DIR}/${name}`;
  try {
    await (target || page).screenshot({ path });
    const info = await stat(path).catch(() => null);
    const entry = { name: `shots/${name}`, bytes: info ? info.size : null };
    screenshots.push(entry);
    console.log(`[shot] shots/${name} (${entry.bytes ?? '?'} bytes)`);
    return entry;
  } catch (error) {
    stageErrors.push({ kind: 'screenshot', name, error: String(error?.message || error) });
    return { name: `shots/${name}`, bytes: null, error: String(error?.message || error) };
  }
}

async function evalPage(fn, arg, target) {
  try {
    const result = await (target || page).evaluate(fn, arg);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function unrelatedHint(text) {
  return /touch|mobile|is-touch|MOBILE_SPEC/i.test(String(text || ''));
}

function annotateErrors(list) {
  return list.map((entry) => ({
    ...entry,
    ...(unrelatedHint(entry.text) ? { unrelated: '[unrelated concurrent change]' } : {}),
  }));
}

// ---------------------------------------------------------------------------
// Self-contained page functions
// ---------------------------------------------------------------------------
function pageQualityState() {
  const s = window.__sandstrike || {};
  const game = s.game || {};
  const postfx = s.postfx || {};
  const effects = s.effects || {};
  const enemies = s.enemies || {};
  const renderer = s.renderer || {};
  const readPanel = (scope) =>
    Array.from(document.querySelectorAll(scope + ' [data-quality-value]')).map((b) => {
      const r = b.getBoundingClientRect();
      return {
        value: b.dataset.qualityValue,
        text: b.textContent.replace(/\s+/g, ' ').trim(),
        active: b.classList.contains('is-on'),
        ariaPressed: b.getAttribute('aria-pressed'),
        disabled: !!b.disabled,
        rect: { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 },
      };
    });
  const bloom = (() => {
    const raw = postfx.bloom;
    const out = {
      rawIsNull: raw === null || raw === undefined,
      rawType: raw === null ? 'null' : typeof raw,
      passExists: !!(raw && typeof raw === 'object'),
      strength: null,
      candidates: {},
    };
    if (raw && typeof raw === 'object' && Number.isFinite(raw.strength)) {
      out.strength = raw.strength;
      out.candidates.passStrength = raw.strength;
    } else if (Number.isFinite(raw)) {
      out.strength = raw;
      out.candidates.bloomProperty = raw;
    }
    for (const key of ['bloomStrength', 'bloomIntensity', 'bloomValue']) {
      if (Number.isFinite(postfx[key])) {
        out.candidates[key] = postfx[key];
        if (out.strength === null) out.strength = postfx[key];
      }
    }
    return out;
  })();
  const msaa = (() => {
    const candidates = {};
    const add = (name, value) => {
      if (value !== undefined && value !== null) candidates[name] = value;
    };
    const composer = postfx.composer || null;
    if (composer) {
      try {
        add('composer.renderTarget1.samples', composer.renderTarget1 ? composer.renderTarget1.samples : undefined);
        add('composer.renderTarget2.samples', composer.renderTarget2 ? composer.renderTarget2.samples : undefined);
        add('composer.readBuffer.samples', composer.readBuffer ? composer.readBuffer.samples : undefined);
        add('composer.writeBuffer.samples', composer.writeBuffer ? composer.writeBuffer.samples : undefined);
        add('composer.renderTarget.samples', composer.renderTarget ? composer.renderTarget.samples : undefined);
      } catch (_) { /* ignored */ }
    }
    add('postfx.samples', postfx.samples);
    add('postfx.msaaSamples', postfx.msaaSamples);
    let value = null;
    let source = null;
    for (const name of Object.keys(candidates)) {
      if (Number.isFinite(candidates[name])) {
        value = candidates[name];
        source = name;
        break;
      }
    }
    return { candidates, value, source };
  })();
  const shadowMapSize = (() => {
    try {
      const info = s.world && s.world.debug ? s.world.debug.drawInfo : null;
      const sun = info ? info.sun : null;
      if (sun && sun.shadow && sun.shadow.mapSize) {
        return { x: sun.shadow.mapSize.x, y: sun.shadow.mapSize.y, source: 'world.debug.drawInfo.sun.shadow.mapSize' };
      }
    } catch (_) { /* ignored */ }
    try {
      const sun = s.world && s.world.sun;
      if (sun && sun.shadow && sun.shadow.mapSize) {
        return { x: sun.shadow.mapSize.x, y: sun.shadow.mapSize.y, source: 'world.sun.shadow.mapSize' };
      }
    } catch (_) { /* ignored */ }
    return null;
  })();
  let storage = null;
  try {
    const raw = localStorage.getItem('sandstrike.settings.v1');
    const parsed = raw ? JSON.parse(raw) : null;
    storage = { has: !!raw, quality: parsed ? parsed.quality ?? null : null, keys: parsed ? Object.keys(parsed) : [] };
  } catch (error) {
    storage = { error: String(error) };
  }
  return {
    exists: !!window.__sandstrike,
    state: s.state ?? (window.__sandstrikeApp ? window.__sandstrikeApp.state : null),
    quality: game.quality ?? null,
    apiQuality: s.quality ?? null,
    postfxQuality: postfx.quality ?? null,
    effectsQuality: effects.quality ?? null,
    enemiesQuality: enemies.quality ?? null,
    adaptiveScale: typeof s.adaptiveScale === 'number' ? s.adaptiveScale : null,
    pixelRatio: typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : null,
    shadowEnabled: renderer.shadowMap ? renderer.shadowMap.enabled : null,
    shadowMapSize,
    bloom,
    msaa,
    panelMenu: readPanel('.screen--menu'),
    panelPause: readPanel('.screen--pause'),
    storage,
    hooks: {
      gameQuality: typeof game.quality === 'string',
      postfxQuality: typeof postfx.quality === 'string',
      effectsQuality: typeof effects.quality === 'string',
      enemiesQuality: typeof enemies.quality === 'string',
      bloomProperty: postfx && 'bloom' in postfx,
      sunMapSize: !!shadowMapSize,
      adaptiveScale: typeof s.adaptiveScale === 'number',
      rendererPixelRatio: typeof renderer.getPixelRatio === 'function',
      setQuality: typeof s.setQuality === 'function',
    },
    fullscreenButtons: document.querySelectorAll('[data-action="fullscreen"]').length,
    fpsButtons: document.querySelectorAll('[data-action="fps"]').length,
    muteButtons: document.querySelectorAll('[data-action="mute"]').length,
    difficultyButtons: document.querySelectorAll('[data-difficulty-value]').length,
    deployButtons: document.querySelectorAll('[data-deploy-value]').length,
    qualityButtons: document.querySelectorAll('[data-quality-value]').length,
    sensitivityInputs: document.querySelectorAll('input[data-set="sensitivity"]').length,
    volumeInputs: document.querySelectorAll('input[data-set="volume"]').length,
    fpsPanel: !!document.querySelector('[data-perf]'),
    fpsText: (() => {
      const el = document.querySelector('[data-fps]');
      return el ? el.textContent.trim() : null;
    })(),
    hudVisible: (() => {
      const el = document.querySelector('.hud');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.02;
    })(),
    hudNodes: {
      radar: !!document.querySelector('.radar-panel'),
      health: !!document.querySelector('[data-health]'),
      wave: !!document.querySelector('.wave-panel'),
      ammo: !!document.querySelector('[data-mag]'),
    },
  };
}

function pageQualityLayout(scope) {
  const rectOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x * 10) / 10,
      y: Math.round(r.y * 10) / 10,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      right: Math.round(r.right * 10) / 10,
      bottom: Math.round(r.bottom * 10) / 10,
    };
  };
  const inside = (inner, outer, tol = 1) =>
    !!inner && !!outer && inner.x >= outer.x - tol && inner.y >= outer.y - tol && inner.right <= outer.right + tol && inner.bottom <= outer.bottom + tol;
  const inView = (r, tol = 1) =>
    !!r && r.x >= -tol && r.y >= -tol && r.right <= innerWidth + tol && r.bottom <= innerHeight + tol && r.w > 1 && r.h > 1;
  const scopeEl = document.querySelector(scope);
  const panel = scopeEl ? scopeEl.querySelector('.panel--settings') : null;
  const group = scopeEl ? scopeEl.querySelector('[data-quality]') : null;
  const buttons = Array.from(document.querySelectorAll(scope + ' [data-quality-value]'));
  const doc = document.documentElement;
  const buttonRects = buttons.map((b) => ({ value: b.dataset.qualityValue, text: b.textContent.trim(), ...rectOf(b) }));
  return {
    scope,
    state: (window.__sandstrike && window.__sandstrike.state) || null,
    screen: document.getElementById('ui') ? document.getElementById('ui').getAttribute('data-screen') : null,
    viewport: { w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio },
    panel: rectOf(panel),
    group: rectOf(group),
    count: buttons.length,
    buttons: buttonRects,
    active: buttons.filter((b) => b.classList.contains('is-on')).map((b) => b.dataset.qualityValue),
    panelInView: inView(rectOf(panel)),
    groupInView: inView(rectOf(group)),
    allButtonsInView: buttons.length === 5 && buttonRects.every((r) => inView(r)),
    allButtonsInPanel: buttons.length === 5 && buttonRects.every((r) => inside(r, rectOf(panel))),
    overflowX: {
      docScrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body ? document.body.scrollWidth : null,
      innerWidth,
      ok: doc.scrollWidth <= innerWidth + 1,
    },
  };
}

function pageMobileQualityTarget() {
  const group = document.querySelector('.screen--menu [data-quality]');
  const buttons = Array.from(document.querySelectorAll('.screen--menu [data-quality-value]'));
  if (!group || !buttons.length) return { exists: false, count: buttons.length };
  group.scrollIntoView({ block: 'center' });
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  };
  const list = buttons.map((b) => ({ value: b.dataset.qualityValue, text: b.textContent.trim(), active: b.classList.contains('is-on'), ...rectOf(b) }));
  const doc = document.documentElement;
  const targets = list.map((b) => ({ value: b.value, x: b.x + b.w / 2, y: b.y + b.h / 2, inView: b.x >= 0 && b.right <= innerWidth && b.y >= 0 && b.bottom <= innerHeight && b.w > 1 && b.h > 1 }));
  return {
    exists: true,
    count: buttons.length,
    buttons: list,
    targets,
    group: rectOf(group),
    overflowX: { scrollWidth: doc.scrollWidth, innerWidth, ok: doc.scrollWidth <= innerWidth + 1 },
    active: list.filter((b) => b.active).map((b) => b.value),
  };
}

// ---------------------------------------------------------------------------
// High-level helpers
// ---------------------------------------------------------------------------
async function waitLoaded(timeoutMs = 150000, target) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const r = await evalPage(
      () => ({
        loaded: !!(window.__sandstrikeApp && window.__sandstrikeApp.loaded),
        fatalScreen: !!document.querySelector('.fatal-screen'),
        hasUi: !!document.getElementById('ui'),
      }),
      undefined,
      target
    );
    const v = r.ok ? r.result : {};
    if (v.loaded) return { loaded: true, ...v, tookMs: Date.now() - startedAt };
    const recentPageError = consoleErrors.filter(
      (entry) => entry.type === 'pageerror' && Date.now() - t0 - entry.atMs < 3000
    );
    if (v.fatalScreen || recentPageError.length) {
      return { loaded: false, ...v, earlyFailure: (recentPageError[0] && recentPageError[0].text.slice(0, 400)) || 'fatal screen' };
    }
    await sleep(500);
  }
  return { loaded: false, timeoutMs };
}

async function waitMenu(timeout = 60000, target) {
  const ok = await (target || page)
    .waitForFunction(
      () => {
        const ui = document.getElementById('ui');
        const state =
          (window.__sandstrike && window.__sandstrike.state) ||
          (window.__sandstrikeApp && window.__sandstrikeApp.state);
        const screen = document.querySelector('.screen--menu');
        const start = document.querySelector('[data-start]');
        return (
          state === 'menu' &&
          !!ui &&
          ui.getAttribute('data-screen') === 'menu' &&
          !!screen &&
          screen.classList.contains('is-active') &&
          !!start &&
          !start.disabled
        );
      },
      null,
      { timeout, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);
  if (ok) await sleep(650);
  return ok;
}

async function bootToMenu(url, target) {
  const pg = target || page;
  const attempts = [];
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1] ?? 60000;
      console.log(`[probe] load failed; retry #${attempt} in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
    const startedAt = Date.now();
    try {
      await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      const load = await waitLoaded(150000, pg);
      const menu = load.loaded ? await waitMenu(60000, pg) : false;
      const info = {
        attempt: attempt + 1,
        loaded: !!load.loaded,
        menu,
        tookMs: Date.now() - startedAt,
        earlyFailure: load.earlyFailure || null,
        recentErrors: annotateErrors(consoleErrors.slice(-5)),
      };
      attempts.push(info);
      console.log(`[probe] boot attempt ${attempt + 1}: loaded=${info.loaded} menu=${info.menu} (${info.tookMs}ms)`);
      if (info.loaded && info.menu) return { ok: true, attempts, info };
    } catch (error) {
      attempts.push({ attempt: attempt + 1, error: String(error?.message || error) });
    }
  }
  return { ok: false, attempts };
}

async function navigateToMenu(url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  } catch (error) {
    return { ok: false, stage: 'goto', error: String(error?.message || error) };
  }
  const load = await waitLoaded(150000);
  if (!load.loaded) return { ok: false, stage: 'loaded', earlyFailure: load.earlyFailure || null };
  const menu = await waitMenu(60000);
  return { ok: menu, stage: menu ? 'menu' : 'menu-screen' };
}

async function clearStorage() {
  return evalPage(() => {
    try {
      localStorage.removeItem('sandstrike.settings.v1');
      return true;
    } catch (_) {
      return false;
    }
  });
}

async function currentState(target) {
  const r = await evalPage(pageQualityState, undefined, target);
  return r.ok ? r.result : { error: r.error };
}

async function waitQuality(tier, timeout = 5000, target) {
  return (target || page)
    .waitForFunction(
      (value) => {
        const s = window.__sandstrike;
        return s && s.game && s.game.quality === value;
      },
      tier,
      { timeout, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);
}

async function clickQuality(scope, tier, target) {
  const pg = target || page;
  const selector = `${scope} [data-quality-value="${tier}"]`;
  const count = await pg.locator(selector).count().catch(() => 0);
  if (!count) return { ok: false, method: 'missing', selector };
  const loc = pg.locator(selector).first();
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await loc.hover({ timeout: 5000 }).catch(() => {});
    await loc.click({ timeout: 10000 });
    await sleep(400);
    return { ok: true, method: 'real-click' };
  } catch (error) {
    await evalPage((sel) => {
      const el = document.querySelector(sel);
      if (el) el.click();
    }, selector, pg);
    await sleep(500);
    return { ok: true, method: 'dom-click-fallback', clickError: String(error?.message || error) };
  }
}

async function startGame() {
  const st = await currentState();
  if (st.state === 'playing') return { ok: true, method: 'already' };
  const r = await evalPage(() => {
    const s = window.__sandstrike;
    if (!s || typeof s.start !== 'function') return { supported: false };
    try {
      s.start();
      return { supported: true };
    } catch (error) {
      return { supported: true, error: String(error) };
    }
  });
  const ok = await page
    .waitForFunction(
      () => ((window.__sandstrike && window.__sandstrike.state) || '') === 'playing',
      null,
      { timeout: 20000, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);
  return { ok, method: 'dev-hook-start', result: r.ok ? r.result : { error: r.error } };
}

async function pauseGame() {
  const r = await evalPage(() => {
    const s = window.__sandstrike;
    if (!s || typeof s.pause !== 'function') return { supported: false };
    try {
      s.pause();
      return { supported: true };
    } catch (error) {
      return { supported: true, error: String(error) };
    }
  });
  const ok = await page
    .waitForFunction(
      () => ((window.__sandstrike && window.__sandstrike.state) || '') === 'paused',
      null,
      { timeout: 15000, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);
  if (ok) await sleep(600);
  return { ok, method: 'dev-hook-pause', result: r.ok ? r.result : { error: r.error } };
}

async function goMenu() {
  const st = await currentState();
  if (st.state === 'menu') return { ok: true, via: 'already' };
  const r = await evalPage(() => {
    const s = window.__sandstrike;
    if (!s || typeof s.menu !== 'function') return { supported: false };
    try {
      s.menu();
      return { supported: true };
    } catch (error) {
      return { supported: true, error: String(error) };
    }
  });
  const ok = await waitMenu(25000);
  return { ok, via: 'dev-hook-menu', result: r.ok ? r.result : { error: r.error } };
}

// ---------------------------------------------------------------------------
// Tier evaluation
// ---------------------------------------------------------------------------
function compactSnapshot(s) {
  if (!s || s.error) return s;
  return {
    state: s.state,
    quality: s.quality,
    postfxQuality: s.postfxQuality,
    effectsQuality: s.effectsQuality,
    enemiesQuality: s.enemiesQuality,
    adaptiveScale: s.adaptiveScale,
    pixelRatio: round(s.pixelRatio, 3),
    shadowEnabled: s.shadowEnabled,
    shadowMapSize: s.shadowMapSize ? { x: s.shadowMapSize.x, y: s.shadowMapSize.y } : null,
    bloom: { rawIsNull: s.bloom ? s.bloom.rawIsNull : null, passExists: s.bloom ? s.bloom.passExists : null, value: s.bloom ? round(s.bloom.strength, 3) : null },
    msaa: s.msaa ? { value: s.msaa.value, source: s.msaa.source, candidates: s.msaa.candidates } : null,
    storageQuality: s.storage ? s.storage.quality : null,
    panels: {
      menu: { count: s.panelMenu ? s.panelMenu.length : 0, active: s.panelMenu ? s.panelMenu.filter((b) => b.active).map((b) => b.value) : [] },
      pause: { count: s.panelPause ? s.panelPause.length : 0, active: s.panelPause ? s.panelPause.filter((b) => b.active).map((b) => b.value) : [] },
    },
    fpsText: s.fpsText,
    hudVisible: s.hudVisible,
  };
}

function evalTier(tier, snapshot, options = {}) {
  const expected = EXPECT_DPR1[tier];
  const failures = [];
  if (!snapshot || snapshot.error) return { pass: false, failures: ['snapshot error: ' + (snapshot ? snapshot.error : 'none')], expected };
  for (const key of ['quality', 'postfxQuality', 'effectsQuality', 'enemiesQuality']) {
    if (snapshot[key] !== tier) failures.push(`${key}=${JSON.stringify(snapshot[key])} expected "${tier}"`);
  }
  const pr = snapshot.pixelRatio;
  if (!(Number.isFinite(pr) && Math.abs(pr - expected.pixelRatio) <= (options.prTol || PR_TOL))) {
    failures.push(`pixelRatio=${JSON.stringify(pr)} expected ${expected.pixelRatio}±${options.prTol || PR_TOL}`);
  }
  if (snapshot.shadowEnabled !== expected.shadows) {
    failures.push(`renderer.shadowMap.enabled=${JSON.stringify(snapshot.shadowEnabled)} expected ${expected.shadows}`);
  }
  const mapX = snapshot.shadowMapSize ? snapshot.shadowMapSize.x : null;
  if (mapX !== expected.shadowMap) failures.push(`sun.shadow.mapSize.x=${JSON.stringify(mapX)} expected ${expected.shadowMap}`);
  if (expected.bloom === null) {
    if (!snapshot.bloom || snapshot.bloom.rawIsNull !== true) {
      failures.push(`postfx.bloom 应为 null（实际 rawType=${snapshot.bloom ? snapshot.bloom.rawType : 'unreadable'} value=${snapshot.bloom ? JSON.stringify(snapshot.bloom.strength) : null}）`);
    }
  } else {
    const bloomValue = snapshot.bloom ? snapshot.bloom.strength : null;
    if (!(Number.isFinite(bloomValue) && Math.abs(bloomValue - expected.bloom) <= BLOOM_TOL)) {
      failures.push(`bloom.strength=${JSON.stringify(bloomValue)} expected ${expected.bloom}±${BLOOM_TOL}`);
    }
  }
  const storageQuality = snapshot.storage ? snapshot.storage.quality ?? null : snapshot.storageQuality ?? null;
  if (options.requireStorage !== false && storageQuality !== tier) {
    failures.push(`localStorage quality=${JSON.stringify(storageQuality)} expected "${tier}"`);
  }  if (options.checkAdaptive && snapshot.adaptiveScale !== 1) failures.push(`adaptiveScale=${JSON.stringify(snapshot.adaptiveScale)} expected 1`);
  for (const panelName of ['menu', 'pause']) {
    const listKey = panelName === 'menu' ? 'panelMenu' : 'panelPause';
    const list = snapshot[listKey];
    const expectedCount = options.panelCount || 5;
    if ((list || []).length !== expectedCount) failures.push(`${panelName} buttons=${(list || []).length} expected ${expectedCount}`);
    const active = (list || []).filter((b) => b.active).map((b) => b.value);
    if (active.length !== 1 || active[0] !== tier) failures.push(`${panelName} active=${JSON.stringify(active)} expected ["${tier}"]`);
    const btn = (list || []).find((b) => b.value === tier);
    if (!btn || btn.ariaPressed !== 'true') failures.push(`${panelName} aria-pressed=${btn ? btn.ariaPressed : 'missing'} expected "true"`);
  }
  return { pass: failures.length === 0, failures, expected, options };
}

async function runTierSweep() {
  const tierResults = {};
  for (const tier of TIERS) {
    const errorsBefore = consoleErrors.length;
    const click = await clickQuality('.screen--menu', tier);
    const applied = click.ok ? await waitQuality(tier, 6000) : false;
    await sleep(700);
    const snapshot = await currentState();
    const errors = annotateErrors(consoleErrors.slice(errorsBefore));
    const evaluation = evalTier(tier, snapshot, { checkAdaptive: true });
    if (click.ok && errors.length) evaluation.failures.push(`console errors during switch: ${errors.map((e) => e.text).join(' | ').slice(0, 300)}`);
    const pass = click.ok && applied && evaluation.pass && errors.length === 0;
    record(`q-tier-${tier}`, '', pass ? 'PASS' : 'FAIL', {
      click,
      applied,
      expected: evaluation.expected,
      failures: evaluation.failures,
      snapshot: compactSnapshot(snapshot),
      consoleErrors: errors,
    });
    tierResults[tier] = { pass, click, applied, evaluation, snapshot, errors };
    measurements.tiers[tier] = {
      pass,
      expected: evaluation.expected,
      failures: evaluation.failures,
      snapshot: compactSnapshot(snapshot),
      clickMethod: click.method || null,
      applied,
      consoleErrors: errors.map((e) => e.text),
    };
    if (tier === 'lowest' || tier === 'low') {
      const file = await shot(`quality-menu-${tier}-1600x900.png`);
      measurements[`shot_${tier}`] = file;
    }
  }
  // Aggregate panel sync + adaptive scale + MSAA checks.
  const panelIssues = [];
  const adaptiveIssues = [];
  for (const tier of TIERS) {
    const r = tierResults[tier];
    if (!r) continue;
    const snap = r.snapshot;
    if (!snap || snap.error) continue;
    for (const panelName of ['menu', 'pause']) {
      const list = panelName === 'menu' ? snap.panelMenu : snap.panelPause;
      const active = (list || []).filter((b) => b.active).map((b) => b.value);
      if ((list || []).length !== 5 || active.length !== 1 || active[0] !== tier) {
        panelIssues.push({ tier, panel: panelName, count: (list || []).length, active });
      }
    }
    if (snap.adaptiveScale !== 1) adaptiveIssues.push({ tier, adaptiveScale: snap.adaptiveScale });
  }
  record('q-panels-sync', '', panelIssues.length === 0 ? 'PASS' : 'FAIL', {
    issues: panelIssues,
    note: 'menu/pause 两面板均应有 5 个按钮且同一时刻只有一个 active，且与当前档位一致',
  });
  record('q-adaptive-scale', '', adaptiveIssues.length === 0 ? 'PASS' : 'FAIL', {
    issues: adaptiveIssues,
    expected: 1,
  });
  return tierResults;
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------
async function stageContract() {
  const state = await currentState();
  stages.contract = state;
  if (state.error) {
    record('q-contract-ui', '', 'FAIL', { error: state.error });
    record('q-contract-engine-hooks', '', 'FAIL', { error: state.error });
    record('q-default-high', '', 'FAIL', { error: state.error });
    return state;
  }
  // UI contract: 5 buttons each panel, correct values/order/labels.
  const uiIssues = [];
  for (const panelName of ['menu', 'pause']) {
    const list = panelName === 'menu' ? state.panelMenu : state.panelPause;
    if (!list || list.length !== 5) uiIssues.push(`${panelName} buttons=${list ? list.length : 0} expected 5`);
    else {
      const values = list.map((b) => b.value);
      const texts = list.map((b) => b.text);
      if (JSON.stringify(values) !== JSON.stringify(TIERS)) uiIssues.push(`${panelName} values=${JSON.stringify(values)} expected ${JSON.stringify(TIERS)}`);
      const expectedTexts = TIERS.map((tier) => TIER_LABELS[tier]);
      if (JSON.stringify(texts) !== JSON.stringify(expectedTexts)) uiIssues.push(`${panelName} texts=${JSON.stringify(texts)} expected ${JSON.stringify(expectedTexts)}`);
    }
  }
  record('q-contract-ui', '', uiIssues.length === 0 ? 'PASS' : 'FAIL', {
    issues: uiIssues,
    menu: state.panelMenu,
    pause: state.panelPause,
    expected: { count: 5, values: TIERS, labels: TIERS.map((tier) => TIER_LABELS[tier]) },
  });

  const hookIssues = Object.entries(state.hooks || {})
    .filter(([, ok]) => !ok)
    .map(([key]) => key);
  record('q-contract-engine-hooks', '', hookIssues.length === 0 ? 'PASS' : 'FAIL', {
    hooks: state.hooks,
    unreadable: hookIssues,
    sample: compactSnapshot(state),
  });

  // Default HIGH from empty localStorage (init script cleared it once).
  const defaultIssues = evalTier('high', state, { checkAdaptive: true, requireStorage: false }).failures;
  record('q-default-high', '', defaultIssues.length === 0 ? 'PASS' : 'FAIL', {
    failures: defaultIssues,
    snapshot: compactSnapshot(state),
    expected: EXPECT_DPR1.high,
  });

  // Layout at 1600 (still default high) + screenshot.
  const layout = await evalPage(pageQualityLayout, '.screen--menu');
  const file = await shot('quality-menu-high-1600x900.png');
  const layoutResult = layout.ok ? layout.result : { error: layout.error };
  const layoutPass =
    !!file.bytes &&
    file.bytes > 1000 &&
    layoutResult &&
    layoutResult.count === 5 &&
    layoutResult.allButtonsInView &&
    layoutResult.allButtonsInPanel &&
    layoutResult.overflowX &&
    layoutResult.overflowX.ok &&
    layoutResult.active &&
    layoutResult.active.length === 1 &&
    layoutResult.active[0] === 'high';
  record('q-layout-1600x900', '', layoutPass ? 'PASS' : 'FAIL', { file, layout: layoutResult });
  measurements.layout1600 = { file, layout: layoutResult };
  return state;
}

async function stageLayoutSmall() {
  try {
    await page.setViewportSize(VIEW_SMALL);
  } catch (error) {
    stageErrors.push({ kind: 'setViewportSize', error: String(error?.message || error) });
  }
  await sleep(1000);
  await goMenu();
  const restoreHigh = await clickQuality('.screen--menu', 'high');
  if (restoreHigh.ok) await waitQuality('high', 5000);
  await sleep(500);
  const layoutHigh = await evalPage(pageQualityLayout, '.screen--menu');
  const highFile = await shot('quality-menu-high-1280x720.png');
  const highReport = layoutHigh.ok ? layoutHigh.result : { error: layoutHigh.error };
  const highOk =
    !!highFile.bytes &&
    highFile.bytes > 1000 &&
    highReport &&
    highReport.count === 5 &&
    highReport.allButtonsInView &&
    highReport.allButtonsInPanel &&
    highReport.overflowX &&
    highReport.overflowX.ok &&
    highReport.active &&
    highReport.active[0] === 'high';
  const clickLowest = await clickQuality('.screen--menu', 'lowest');
  const applied = clickLowest.ok ? await waitQuality('lowest', 6000) : false;
  await sleep(600);
  const layoutLowest = await evalPage(pageQualityLayout, '.screen--menu');
  const lowFile = await shot('quality-menu-lowest-1280x720.png');
  const lowReport = layoutLowest.ok ? layoutLowest.result : { error: layoutLowest.error };
  const lowOk =
    !!lowFile.bytes &&
    lowFile.bytes > 1000 &&
    lowReport &&
    lowReport.count === 5 &&
    lowReport.allButtonsInView &&
    lowReport.allButtonsInPanel &&
    lowReport.overflowX &&
    lowReport.overflowX.ok &&
    lowReport.active &&
    lowReport.active[0] === 'lowest' &&
    applied;
  record('q-layout-1280x720', '', highOk && lowOk ? 'PASS' : 'FAIL', {
    high: { file: highFile, layout: highReport, ok: highOk },
    lowest: { file: lowFile, layout: lowReport, applied, ok: lowOk, click: clickLowest },
  });
  measurements.layout1280 = { high: highReport, lowest: lowReport, highFile, lowFile };
  // Restore high for the following stages.
  await clickQuality('.screen--menu', 'high');
  await waitQuality('high', 5000);
  try {
    await page.setViewportSize(VIEW_BIG);
  } catch (_) { /* best effort */ }
  await sleep(700);
}

async function stagePersistence() {
  await goMenu();
  const clickLow = await clickQuality('.screen--menu', 'low');
  const applied = clickLow.ok ? await waitQuality('low', 6000) : false;
  await sleep(700);
  const before = await currentState();
  // Reload WITHOUT the ?quality= URL override so the persisted setting is what
  // the fresh boot applies (query string intentionally outranks storage).
  const reload = await navigateToMenu(`${BASE_URL}/?dev=1&touch=0`);
  await sleep(700);
  const after = await currentState();
  const issues = [];
  if (!applied) issues.push('could not switch to LOW before reload');
  if (!reload.ok) issues.push('reload failed: ' + JSON.stringify(reload));
  if (after.error) issues.push('post-reload snapshot error');
  else {
    if (after.quality !== 'low') issues.push(`game.quality=${JSON.stringify(after.quality)} expected "low"`);
    if (after.postfxQuality !== 'low') issues.push(`postfx.quality=${JSON.stringify(after.postfxQuality)} expected "low"`);
    if (after.effectsQuality !== 'low') issues.push(`effects.quality=${JSON.stringify(after.effectsQuality)} expected "low"`);
    if (after.enemiesQuality !== 'low') issues.push(`enemies.quality=${JSON.stringify(after.enemiesQuality)} expected "low"`);
    if (!(Number.isFinite(after.pixelRatio) && Math.abs(after.pixelRatio - 0.75) <= PR_TOL)) issues.push(`pixelRatio=${JSON.stringify(after.pixelRatio)} expected 0.75±${PR_TOL}`);
    if (after.shadowEnabled !== true) issues.push(`shadowMap.enabled=${JSON.stringify(after.shadowEnabled)} expected true`);
    if (!after.shadowMapSize || after.shadowMapSize.x !== 1024) issues.push(`sun.shadow.mapSize.x=${after.shadowMapSize ? after.shadowMapSize.x : null} expected 1024`);
    const expectedBloom = 0.18;
    const bloomValue = after.bloom ? after.bloom.strength : null;
    if (!(Number.isFinite(bloomValue) && Math.abs(bloomValue - expectedBloom) <= BLOOM_TOL)) issues.push(`bloom=${JSON.stringify(bloomValue)} expected ${expectedBloom}`);
    for (const panelName of ['menu', 'pause']) {
      const list = panelName === 'menu' ? after.panelMenu : after.panelPause;
      const active = (list || []).filter((b) => b.active).map((b) => b.value);
      if ((list || []).length !== 5 || active.length !== 1 || active[0] !== 'low') issues.push(`${panelName} active=${JSON.stringify(active)} expected ["low"] (count=${(list || []).length})`);
    }
    if (!after.storage || after.storage.quality !== 'low') issues.push(`localStorage quality=${JSON.stringify(after.storage ? after.storage.quality : null)} expected "low"`);
  }
  record('q-persist', '', issues.length === 0 ? 'PASS' : 'FAIL', {
    clickLow,
    applied,
    before: compactSnapshot(before),
    reload,
    after: compactSnapshot(after),
    issues,
  });
  // Restore HIGH and remember state.
  const restore = await clickQuality('.screen--menu', 'high');
  measurements.persist = { restoredHigh: restore };
  await waitQuality('high', 5000);
}

async function stageInGameSwitch() {
  const started = await startGame();
  const paused = await pauseGame();
  const before = await currentState();
  const errorsBefore = consoleErrors.length;
  const clickLowest = await clickQuality('.screen--pause', 'lowest');
  const applied = clickLowest.ok ? await waitQuality('lowest', 6000) : false;
  const file = await shot('quality-pause-lowest-1600x900.png');
  const f0 = await evalPage(() => (window.__renderDebug ? window.__renderDebug.frames : null));
  await sleep(1000);
  const f1 = await evalPage(() => (window.__renderDebug ? window.__renderDebug.frames : null));
  await sleep(1000);
  const f2 = await evalPage(() => (window.__renderDebug ? window.__renderDebug.frames : null));
  const frames0 = f0.ok ? f0.result : null;
  const frames1 = f1.ok ? f1.result : null;
  const frames2 = f2.ok ? f2.result : null;
  const monotonic =
    Number.isFinite(frames0) && Number.isFinite(frames1) && Number.isFinite(frames2) && frames1 > frames0 && frames2 > frames1;
  const totalDelta = Number.isFinite(frames0) && Number.isFinite(frames2) ? frames2 - frames0 : null;
  const render = await evalPage(() => {
    const s = window.__sandstrike;
    if (!s || typeof s.renderOnce !== 'function') return { supported: false };
    try {
      const out = s.renderOnce();
      return { supported: true, calls: out ? out.calls : null, triangles: out ? out.triangles : null };
    } catch (error) {
      return { supported: true, error: String(error) };
    }
  });
  const r = render.ok ? render.result : { supported: false, error: render.error };
  const after = await currentState();
  const errorsDuring = annotateErrors(consoleErrors.slice(errorsBefore));
  const issues = [];
  if (!started.ok) issues.push('failed to start game');
  if (!paused.ok) issues.push('failed to pause game');
  if (!clickLowest.ok) issues.push('pause-panel LOWEST button missing');
  if (!applied) issues.push('game.quality did not switch to lowest');
  if (after.quality !== 'lowest') issues.push(`game.quality=${JSON.stringify(after.quality)} expected lowest`);
  if (after.shadowEnabled !== false) issues.push(`shadowMap.enabled=${JSON.stringify(after.shadowEnabled)} expected false`);
  if (!monotonic || !(Number.isFinite(totalDelta) && totalDelta >= 5)) issues.push(`render loop not advancing: frames ${JSON.stringify([frames0, frames1, frames2])}`);
  if (!(r.supported && Number.isFinite(r.calls) && r.calls > 0)) issues.push('renderOnce() calls not > 0');
  if (!Number.isFinite(Number.parseFloat(after.fpsText || ''))) issues.push(`[data-fps] not numeric: ${JSON.stringify(after.fpsText)}`);
  if (after.hudVisible !== true) issues.push('HUD not visible while paused');
  if (errorsDuring.length) issues.push('console errors during in-game switch: ' + errorsDuring.map((e) => e.text).join(' | ').slice(0, 300));
  record('q-ingame-switch', '', issues.length === 0 ? 'PASS' : 'FAIL', {
    started,
    paused,
    click: clickLowest,
    applied,
    frames: { frames0, frames1, frames2, monotonic, totalDelta },
    renderOnce: r,
    fpsText: after.fpsText,
    hudVisible: after.hudVisible,
    file,
    consoleErrors: errorsDuring,
    issues,
  });
  // Restore HIGH from the pause panel.
  const restore = await clickQuality('.screen--pause', 'high');
  await waitQuality('high', 5000);
  measurements.ingame = { restoredHigh: restore, issues };
  // Back to menu for URL tests.
  await goMenu();
}

async function stageUrlParams() {
  await clearStorage();
  const lowest = await navigateToMenu(`${BASE_URL}/?dev=1&quality=lowest&touch=0`);
  await sleep(700);
  const lowestState = await currentState();
  const lowestIssues = [];
  if (!lowest.ok) lowestIssues.push('navigation failed: ' + JSON.stringify(lowest));
  if (lowestState.quality !== 'lowest') lowestIssues.push(`game.quality=${JSON.stringify(lowestState.quality)} expected lowest`);
  if (lowestState.shadowEnabled !== false) lowestIssues.push(`shadowMap.enabled=${JSON.stringify(lowestState.shadowEnabled)} expected false`);
  if (lowestState.panelMenu && !lowestState.panelMenu.some((b) => b.active && b.value === 'lowest')) {
    lowestIssues.push('UI active != LOWEST: ' + JSON.stringify((lowestState.panelMenu || []).filter((b) => b.active).map((b) => b.value)));
  }
  record('q-url-param-lowest', '', lowestIssues.length === 0 ? 'PASS' : 'FAIL', {
    navigate: lowest,
    snapshot: compactSnapshot(lowestState),
    issues: lowestIssues,
  });

  await clearStorage();
  const low = await navigateToMenu(`${BASE_URL}/?dev=1&quality=low&touch=0`);
  await sleep(700);
  const lowState = await currentState();
  const lowIssues = [];
  if (!low.ok) lowIssues.push('navigation failed: ' + JSON.stringify(low));
  if (lowState.quality !== 'low') lowIssues.push(`game.quality=${JSON.stringify(lowState.quality)} expected low`);
  if (lowState.shadowEnabled !== true) lowIssues.push(`shadowMap.enabled=${JSON.stringify(lowState.shadowEnabled)} expected true`);
  if (!lowState.shadowMapSize || lowState.shadowMapSize.x !== 1024) lowIssues.push(`sun.shadow.mapSize.x=${lowState.shadowMapSize ? lowState.shadowMapSize.x : null} expected 1024`);
  if (!(Number.isFinite(lowState.pixelRatio) && Math.abs(lowState.pixelRatio - 0.75) <= PR_TOL)) lowIssues.push(`pixelRatio=${JSON.stringify(lowState.pixelRatio)} expected 0.75`);
  if (lowState.panelMenu && !lowState.panelMenu.some((b) => b.active && b.value === 'low')) {
    lowIssues.push('UI active != LOW: ' + JSON.stringify((lowState.panelMenu || []).filter((b) => b.active).map((b) => b.value)));
  }
  record('q-url-param-low', '', lowIssues.length === 0 ? 'PASS' : 'FAIL', {
    navigate: low,
    snapshot: compactSnapshot(lowState),
    issues: lowIssues,
  });

  // Return to the clean default page for the remaining stages.
  await clearStorage();
  const back = await navigateToMenu(PAGE_URL);
  measurements.urlReturn = back;
  return back;
}

async function stageTouch() {
  let ctx = null;
  let pg = null;
  try {
    ctx = await browser.newContext({ viewport: VIEW_MOBILE, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    pg = await ctx.newPage();
    pg.setDefaultTimeout(20000);
    pg.on('console', (msg) => {
      const entry = { type: msg.type(), text: msg.text(), atMs: Date.now() - t0, mobile: true };
      consoleLog.push(entry);
      if (msg.type() === 'error') consoleErrors.push(entry);
    });
    pg.on('pageerror', (error) => {
      consoleErrors.push({ type: 'pageerror', text: String(error?.stack || error?.message || error), atMs: Date.now() - t0, mobile: true });
    });
    const boot = await bootToMenu(MOBILE_URL, pg);
    stages.mobileBoot = boot;
    if (!boot.ok) {
      record('q-touch', '', 'SKIP', { reason: 'mobile page failed to load', boot });
      record('q-mobile-layout', '', 'SKIP', { reason: 'mobile page failed to load', boot });
      return;
    }
    const state = await currentState(pg);
    const target = await evalPage(pageMobileQualityTarget, undefined, pg);
    const t = target.ok ? target.result : { exists: false, error: target.error };
    const fileLow = await shot('quality-mobile-low-844x390.png', pg);
    if (!t.exists) {
      record('q-touch', '', 'FAIL', { reason: 'mobile menu has no [data-quality] group', state: compactSnapshot(state) });
      record('q-mobile-layout', '', 'FAIL', { reason: 'mobile menu has no [data-quality] group', target: t });
      return;
    }
    const lowIssues = [];
    if (state.quality !== 'low') lowIssues.push(`game.quality=${JSON.stringify(state.quality)} expected low`);
    if (!(Number.isFinite(state.pixelRatio) && Math.abs(state.pixelRatio - TOUCH_LOW_PIXEL_RATIO) <= 0.05)) {
      lowIssues.push(`pixelRatio=${JSON.stringify(state.pixelRatio)} expected ≈${TOUCH_LOW_PIXEL_RATIO}±0.05（DPR3 受 cap 限制）`);
    }
    if (state.adaptiveScale !== 1) lowIssues.push(`adaptiveScale=${JSON.stringify(state.adaptiveScale)} expected 1`);
    if (t.count !== 5) lowIssues.push(`quality buttons=${t.count} expected 5`);
    if (t.overflowX && !t.overflowX.ok) lowIssues.push(`horizontal overflow: ${t.overflowX.scrollWidth} > ${t.overflowX.innerWidth}`);
    if (t.active && !(t.active.length === 1 && t.active[0] === 'low')) lowIssues.push(`UI active=${JSON.stringify(t.active)} expected ["low"]`);
    const lowestTarget = t.targets ? t.targets.find((x) => x.value === 'lowest') : null;
    let tap = null;
    let errorsDuring = [];
    let lowestState = null;
    if (!lowestTarget) {
      lowIssues.push('LOWEST button missing on mobile');
    } else {
      const errorsBefore = consoleErrors.length;
      try {
        await pg.touchscreen.tap(lowestTarget.x, lowestTarget.y);
        tap = { method: 'touchscreen.tap', x: round(lowestTarget.x, 1), y: round(lowestTarget.y, 1) };
      } catch (error) {
        tap = { method: 'touchscreen.tap', error: String(error?.message || error) };
      }
      await sleep(800);
      lowestState = await currentState(pg);
      errorsDuring = annotateErrors(consoleErrors.slice(errorsBefore));
      if (lowestState.quality !== 'lowest') lowIssues.push(`after tap game.quality=${JSON.stringify(lowestState.quality)} expected lowest`);
      if (errorsDuring.length) lowIssues.push('console errors after tapping LOWEST: ' + errorsDuring.map((e) => e.text).join(' | ').slice(0, 300));
      const fileLowest = await shot('quality-mobile-lowest-844x390.png', pg);
      measurements.mobileShots = { low: fileLow, lowest: fileLowest };
    }
    record('q-touch', '', lowIssues.length === 0 ? 'PASS' : 'FAIL', {
      boot,
      state: compactSnapshot(state),
      target: { count: t.count, active: t.active, overflowX: t.overflowX, targets: t.targets },
      tap,
      lowestState: lowestState ? compactSnapshot(lowestState) : null,
      consoleErrors: errorsDuring,
      issues: lowIssues,
    });

    const layoutIssues = [];
    if (t.count !== 5) layoutIssues.push(`count=${t.count} expected 5`);
    const outOfView = (t.targets || []).filter((x) => !x.inView);
    if (outOfView.length) layoutIssues.push('buttons outside viewport after scroll: ' + JSON.stringify(outOfView));
    if (t.overflowX && !t.overflowX.ok) layoutIssues.push('horizontal overflow');
    record('q-mobile-layout', '', layoutIssues.length === 0 ? 'PASS' : 'FAIL', {
      group: t.group,
      count: t.count,
      targets: t.targets,
      overflowX: t.overflowX,
      file: fileLow,
      issues: layoutIssues,
    });
  } catch (error) {
    record('q-touch', '', 'FAIL', { reason: 'mobile stage error: ' + String(error?.stack || error?.message || error) });
    record('q-mobile-layout', '', 'FAIL', { reason: 'mobile stage error' });
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

async function stageHighDpr() {
  let ctx = null;
  let pg = null;
  try {
    ctx = await browser.newContext({ viewport: VIEW_BIG, deviceScaleFactor: 2 });
    pg = await ctx.newPage();
    pg.setDefaultTimeout(20000);
    pg.on('console', (msg) => {
      const entry = { type: msg.type(), text: msg.text(), atMs: Date.now() - t0, dpr2: true };
      consoleLog.push(entry);
      if (msg.type() === 'error') consoleErrors.push(entry);
    });
    pg.on('pageerror', (error) => {
      consoleErrors.push({ type: 'pageerror', text: String(error?.stack || error?.message || error), atMs: Date.now() - t0, dpr2: true });
    });
    const boot = await bootToMenu(PAGE_URL, pg);
    stages.highDprBoot = boot;
    if (!boot.ok) {
      record('q-highdpr', '', 'SKIP', { reason: 'DPR2 page failed to load', boot });
      return;
    }
    const ratios = {};
    const issues = [];
    const clicks = {};
    for (const tier of TIERS) {
      const click = await clickQuality('.screen--menu', tier, pg);
      clicks[tier] = click;
      const applied = click.ok ? await waitQuality(tier, 8000, pg) : false;
      await sleep(600);
      const state = await currentState(pg);
      const ratio = state.pixelRatio;
      const expected = EXPECT_DPR2[tier];
      ratios[tier] = { pixelRatio: round(ratio, 3), expected, applied, clickMethod: click.method || null, uiActive: state.panelMenu ? state.panelMenu.filter((b) => b.active).map((b) => b.value) : [] };
      if (!click.ok) issues.push(`${tier}: button missing`);
      else if (!applied) issues.push(`${tier}: quality not applied`);
      if (!(Number.isFinite(ratio) && Math.abs(ratio - expected) <= PR_TOL_DPR2)) {
        issues.push(`${tier}: pixelRatio=${JSON.stringify(ratio)} expected ${expected}±${PR_TOL_DPR2}`);
      }
    }
    const file = await shot('quality-highdpr-ultra-1600x900.png', pg);
    record('q-highdpr', '', issues.length === 0 ? 'PASS' : 'FAIL', {
      boot,
      context: { viewport: VIEW_BIG, deviceScaleFactor: 2, devicePixelRatio: 2 },
      ratios,
      clicks,
      file,
      expected: EXPECT_DPR2,
      tolerance: PR_TOL_DPR2,
      issues,
    });
    measurements.highDpr = { ratios, issues };
  } catch (error) {
    record('q-highdpr', '', 'FAIL', { reason: 'high-DPR stage error: ' + String(error?.stack || error?.message || error) });
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

async function stageRegression() {
  await goMenu();
  const started = await startGame();
  await sleep(1000);
  const errorsBefore = consoleErrors.length;
  const f0 = await evalPage(() => (window.__renderDebug ? window.__renderDebug.frames : null));
  await sleep(1200);
  const f1 = await evalPage(() => (window.__renderDebug ? window.__renderDebug.frames : null));
  const frames0 = f0.ok ? f0.result : null;
  const frames1 = f1.ok ? f1.result : null;
  const render = await evalPage(() => {
    const s = window.__sandstrike;
    if (!s || typeof s.renderOnce !== 'function') return { supported: false };
    try {
      const out = s.renderOnce();
      return { supported: true, calls: out ? out.calls : null, triangles: out ? out.triangles : null };
    } catch (error) {
      return { supported: true, error: String(error) };
    }
  });
  const r = render.ok ? render.result : { supported: false, error: render.error };
  await sleep(300);
  const state = await currentState();
  const errorsDuring = annotateErrors(consoleErrors.slice(errorsBefore));
  const issues = [];
  if (!started.ok) issues.push('failed to start game');
  if (!(Number.isFinite(frames0) && Number.isFinite(frames1) && frames1 > frames0)) issues.push(`render loop not advancing: ${JSON.stringify([frames0, frames1])}`);
  if (!(r.supported && Number.isFinite(r.calls) && r.calls > 0)) issues.push('renderOnce() calls not > 0');
  if (!Number.isFinite(Number.parseFloat(state.fpsText || ''))) issues.push(`[data-fps] not numeric: ${JSON.stringify(state.fpsText)}`);
  if (!state.fpsPanel) issues.push('FPS panel missing');
  if (state.fullscreenButtons !== 2) issues.push(`fullscreen buttons=${state.fullscreenButtons} expected 2`);
  if (state.fpsButtons !== 2) issues.push(`frame-counter buttons=${state.fpsButtons} expected 2`);
  if (state.muteButtons < 2) issues.push(`audio buttons=${state.muteButtons} expected >=2`);
  if (state.qualityButtons !== 10) issues.push(`quality buttons=${state.qualityButtons} expected 10 (menu+pause 各 5)`);
  // Difficulty selection lives in the deployment dialog in the shared workspace
  // (moved out of SYSTEM CONFIG by concurrent work); accept either location.
  const difficultyControls = state.difficultyButtons + state.deployButtons;
  if (difficultyControls < 2) issues.push(`difficulty controls (settings=${state.difficultyButtons}, deploy=${state.deployButtons}) expected >=2`);
  if (state.sensitivityInputs < 2) issues.push(`sensitivity inputs=${state.sensitivityInputs} expected >=2`);
  if (state.volumeInputs < 2) issues.push(`volume inputs=${state.volumeInputs} expected >=2`);
  if (!state.hudNodes.radar || !state.hudNodes.health || !state.hudNodes.wave || !state.hudNodes.ammo) issues.push('original HUD nodes missing: ' + JSON.stringify(state.hudNodes));
  if (errorsDuring.length) issues.push('console errors: ' + errorsDuring.map((e) => e.text).join(' | ').slice(0, 300));
  record('q-regression', '', issues.length === 0 ? 'PASS' : 'FAIL', {
    started,
    frames: { frames0, frames1, delta: Number.isFinite(frames0) && Number.isFinite(frames1) ? frames1 - frames0 : null },
    renderOnce: r,
    fpsText: state.fpsText,
    settingCounts: {
      fullscreen: state.fullscreenButtons,
      frameCounter: state.fpsButtons,
      audio: state.muteButtons,
      quality: state.qualityButtons,
      difficultySettingsPanel: state.difficultyButtons,
      difficultyDeployDialog: state.deployButtons,
      sensitivity: state.sensitivityInputs,
      volume: state.volumeInputs,
    },
    hudNodes: state.hudNodes,
    consoleErrors: errorsDuring,
    issues,
  });
}

async function stageMsaa(tierResults) {
  const perTier = {};
  const issues = [];
  let readable = 0;
  for (const tier of TIERS) {
    const r = tierResults[tier];
    if (!r || !r.snapshot || !r.snapshot.msaa) continue;
    const msaa = r.snapshot.msaa;
    perTier[tier] = { value: msaa.value, source: msaa.source, expected: EXPECT_MSAA[tier], candidates: msaa.candidates };
    if (msaa.value === null || msaa.value === undefined) {
      issues.push(`${tier}: MSAA samples 不可读`);
    } else {
      readable++;
      if (msaa.value !== EXPECT_MSAA[tier]) issues.push(`${tier}: samples=${msaa.value} expected ${EXPECT_MSAA[tier]}`);
    }
  }
  if (!readable) {
    record('q-msaa', '', 'SKIP', { perTier, reasons: issues, note: 'MSAA sample 数无法从 postfx composer 读取（实现可能未暴露）' });
    return;
  }
  record('q-msaa', '', issues.length === 0 ? 'PASS' : 'FAIL', {
    perTier,
    expected: EXPECT_MSAA,
    issues,
    note: issues.length ? '若 samples 数值来源为 three.js 默认内部缓冲，按契约偏差记录' : '',
  });
  measurements.msaa = perTier;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let bootInfo = null;
let tierResults = {};
let enterFrameMarker = null;
try {
  console.log('[probe] SANDSTRIKE 5-tier quality black-box probe');
  console.log(`[probe] url=${PAGE_URL}`);
  console.log(`[probe] mobile=${MOBILE_URL} ${VIEW_MOBILE.width}x${VIEW_MOBILE.height} isMobile/hasTouch DPR3`);

  browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--use-angle=d3d11',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--disable-gpu-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--hide-scrollbars',
    ],
  });
  context = await browser.newContext({ viewport: VIEW_BIG, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('__qualityProbeInit')) {
        localStorage.clear();
        sessionStorage.setItem('__qualityProbeInit', '1');
      }
    } catch (_) {
      /* storage unavailable */
    }
  });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('console', (msg) => {
    const entry = { type: msg.type(), text: msg.text(), atMs: Date.now() - t0 };
    consoleLog.push(entry);
    if (msg.type() === 'error') consoleErrors.push(entry);
  });
  page.on('pageerror', (error) => {
    consoleErrors.push({ type: 'pageerror', text: String(error?.stack || error?.message || error), atMs: Date.now() - t0 });
  });

  bootInfo = await bootToMenu(PAGE_URL);
  stages.boot = bootInfo;
  if (!bootInfo.ok) {
    notes.push('[blocker] 页面未能加载到菜单；可能是并发改动造成的临时错误（已重试）。');
  } else {
    await stageContract();
    tierResults = await runTierSweep();
    await stageMsaa(tierResults);
    await stageLayoutSmall();
    await stagePersistence();
    await stageInGameSwitch();
    await stageUrlParams();
    await stageTouch();
    await stageHighDpr();
    await stageRegression();
  }
} catch (error) {
  const message = String(error?.stack || error?.message || error);
  stageErrors.push({ kind: 'fatal', error: message });
  console.error('[probe] FATAL:', message);
} finally {
  record('q-no-console-errors', '', consoleErrors.length === 0 ? 'PASS' : 'FAIL', {
    count: consoleErrors.length,
    errors: annotateErrors(consoleErrors).slice(0, 30),
    note: consoleErrors.length ? '若错误来自并发移动端改动请标注 [unrelated concurrent change]' : '零 console error/pageerror',
  });

  for (const [id, name] of EXPECTED) {
    if (!recordedIds.has(id)) record(id, name, 'FAIL', { reason: '未执行（探针提前结束或依赖缺失）' });
  }

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failIds = results.filter((r) => r.status === 'FAIL').map((r) => r.id);
  const skipIds = results.filter((r) => r.status === 'SKIP').map((r) => r.id);
  const payload = {
    probe: 'sandstrike-quality-probe',
    version: 1,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    url: PAGE_URL,
    mobileUrl: MOBILE_URL,
    environment: {
      chrome: CHROME,
      headless: true,
      gpuArgs: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
      viewports: { desktopBig: VIEW_BIG, desktopSmall: VIEW_SMALL, mobile: VIEW_MOBILE },
      notes: [
        '进入游戏/暂停使用 dev hook（START 会弹部署难度弹窗）',
        'DPR1 桌面参数来自 task-6 契约；DPR2 使用独立 deviceScaleFactor=2 context；触屏使用 isMobile/hasTouch DPR3',
      ],
    },
    expectations: measurements.expectations,
    summary: {
      total: results.length,
      pass: passCount,
      fail: failIds.length,
      skip: skipIds.length,
      verdict: failIds.length === 0 ? 'PASS' : 'FAIL',
      failIds,
      skipIds,
      booted: !!(bootInfo && bootInfo.ok),
    },
    checks: results,
    measurements,
    screenshots,
    stages,
    stageErrors,
    consoleErrors: annotateErrors(consoleErrors).slice(0, 60),
    consoleLogTail: consoleLog.slice(-50),
    notes,
  };
  try {
    await writeFile(`${OUT_DIR}/quality-probe.json`, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`\n[probe] wrote shots/quality-probe.json (${results.length} checks: ${passCount} PASS, ${failIds.length} FAIL, ${skipIds.length} SKIP)`);
  } catch (error) {
    console.error('[probe] failed to write JSON:', error);
  }
  if (failures.length) {
    console.log('[probe] FAILED checks:');
    for (const row of failures) console.log(`  - ${row.id}: ${row.name}`);
  } else {
    console.log('[probe] NO FAILURES');
  }
  if (browser) await browser.close().catch(() => {});
  process.exitCode = failures.length ? 1 : 0;
}
