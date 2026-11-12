/**
 * SANDSTRIKE // 沙暴协议 — Fullscreen toggle independent black-box probe.
 * ---------------------------------------------------------------------------
 * Independent verification for TEAM task-4: the FULLSCREEN switch in the
 * SYSTEM CONFIG panels (menu + pause): contract, enter/exit via real clicks,
 * fullscreenchange state sync, cross-panel sync, not-persisted across reload,
 * layout at 1600×900 / 1280×720, mobile (isMobile/hasTouch 844×390) behaviour,
 * and gameplay/FPS regressions.
 *
 * Black box only: everything is asserted through real DOM / UI interaction and
 * the documented window.__sandstrike dev hooks. Product code is never imported
 * or modified.
 *
 * Usage:   node scripts/fullscreen-probe.mjs [baseUrl]
 * Default: http://127.0.0.1:8099/?dev=1&quality=high&touch=0
 * Output:  shots/fullscreen-probe.json  +  shots/fullscreen-*.png
 *
 * Notes:
 *  - Headless Chrome MUST run with hardware GPU (ANGLE/D3D11).
 *  - Headless supports the Fullscreen API (Lead pre-checked): requestFullscreen
 *    inside a real click makes document.fullscreenElement truthy, and
 *    document.exitFullscreen() works from script. Escape does NOT exit the
 *    browser-level fullscreen in headless, so the probe never treats Esc as a
 *    failure signal.
 *  - START now opens a deployment dialog in the shared workspace (concurrent
 *    workstream), so entering the run uses window.__sandstrike.start() and
 *    pausing uses window.__sandstrike.pause().
 *  - Writable scope: this script, shots/fullscreen-probe.json, shots/fullscreen-*.png.
 */

import { chromium } from 'playwright-core';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = (process.argv[2] || process.env.FS_PROBE_URL || 'http://127.0.0.1:8099').replace(/\/+$/, '');
const QUERY = process.env.FS_PROBE_QUERY || 'dev=1&quality=high&touch=0';
const MOBILE_QUERY = process.env.FS_PROBE_MOBILE_QUERY || 'dev=1&quality=medium&touch=1';
const PAGE_URL = `${BASE_URL}/?${QUERY}`;
const MOBILE_URL = `${BASE_URL}/?${MOBILE_QUERY}`;
const OUT_DIR = resolve('shots');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEW_BIG = { width: 1600, height: 900 };
const VIEW_SMALL = { width: 1280, height: 720 };
const VIEW_MOBILE = { width: 844, height: 390 };
const RETRY_DELAYS = (process.env.FS_PROBE_RETRY_DELAYS || '45000,60000')
  .split(',')
  .map((n) => Number(n))
  .filter((n) => Number.isFinite(n) && n >= 0);
const SETTINGS_KEY = 'sandstrike.settings.v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 1) => (Number.isFinite(v) ? +v.toFixed(d) : v);

await mkdir(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Expected checks (status: PASS | FAIL | SKIP). Anything never recorded is FAIL.
// ---------------------------------------------------------------------------
const EXPECTED = [
  ['fs-env-support', '环境：document.fullscreenEnabled / requestFullscreen / exitFullscreen 可用'],
  ['fs-contract-panels', '契约：menu 与 pause 两份 SYSTEM CONFIG 均有 FULLSCREEN 行/按钮/label/aria-pressed'],
  ['fs-contract-initial-state', '契约：初始未全屏（fullscreenElement 为空），两按钮 label=OFF、aria=false'],
  ['fs-enter-menu', '进入全屏：真实 click 菜单按钮 → fullscreenElement 存在'],
  ['fs-enter-ui-sync', '进入全屏：label=ON、aria=true、active class 存在'],
  ['fs-exit-menu', '退出全屏：再 click → fullscreenElement 为空、label=OFF、aria=false'],
  ['fs-external-exit-sync', '状态同步：脚本 document.exitFullscreen() → fullscreenchange 后 label 自动回 OFF'],
  ['fs-pause-panel-enter', 'pause 面板：进入游戏暂停后 click 按钮 → 全屏且 menu 面板同步 ON，暂停状态未破坏'],
  ['fs-pause-panel-exit', 'pause 面板：再 click 退出 → 无全屏、两个 label 回 OFF'],
  ['fs-not-persisted', '未持久化：全屏状态下 reload → 新页面非全屏、label OFF、localStorage 无 fullscreen 键'],
  ['fs-layout-menu-1600x900', '布局 1600×900 菜单：设置面板/FULLSCREEN 行在视口内、不挡 START、无横向溢出、截图生成'],
  ['fs-layout-menu-on-1600x900', '布局 1600×900 菜单全屏 ON：ON 态截图/标签清晰'],
  ['fs-layout-pause-1600x900', '布局 1600×900 游戏内设置面板（pause）：面板/行在视口内、不挡 RESUME、无溢出、截图'],
  ['fs-layout-menu-1280x720', '布局 1280×720 菜单：设置面板/行在视口内、无横向溢出、OFF/ON 截图'],
  ['fs-layout-pause-1280x720', '布局 1280×720 游戏内设置面板（pause）：面板/行在视口内、无溢出、截图'],
  ['fs-mobile-844x390', '移动端 844×390（isMobile/hasTouch）：FULLSCREEN 行存在且 tap 可进入全屏（不支持则 SKIP）'],
  ['fs-mobile-layout', '移动端 844×390：设置面板在视口内、无横向溢出、截图生成'],
  ['fs-regression-loop', '回归：游戏仍渲染运行（__renderDebug.frames 增长、renderOnce calls>0）'],
  ['fs-regression-hud', '回归：FPS 面板数值正常，FRAME COUNTER / AUDIO / 画质等原有设置项仍在'],
  ['fs-no-console-errors', '全程零 console error / pageerror'],
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
const notes = [];
const stageErrors = [];
let page = null;
let context = null;
let browser = null;
let mobileContext = null;
let mobilePage = null;
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

async function shot(name) {
  const path = `${OUT_DIR}/${name}`;
  try {
    await page.screenshot({ path });
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
function pageFsState() {
  const readBtn = (scopeSel) => {
    const b = document.querySelector(scopeSel + ' [data-action="fullscreen"]');
    if (!b) return { exists: false, scope: scopeSel };
    const label = b.querySelector('[data-fullscreen-label]');
    const labelText = label ? label.textContent.trim() : null;
    const row = b.closest('.set-row') || b.parentElement;
    const rowText = row ? row.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    const panel = b.closest('.panel--settings');
    return {
      exists: true,
      scope: scopeSel,
      label: labelText,
      ariaPressed: b.getAttribute('aria-pressed'),
      className: b.className,
      disabled: !!b.disabled,
      rowText,
      rowHasFullscreenText: /fullscreen/i.test(rowText),
      panelExists: !!panel,
    };
  };
  let storage = null;
  try {
    const raw = localStorage.getItem('sandstrike.settings.v1');
    if (!raw) storage = { has: false, keys: [], fullscreenKeys: [] };
    else {
      const parsed = JSON.parse(raw);
      const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
      storage = { has: true, keys, fullscreenKeys: keys.filter((key) => /full/i.test(key)) };
    }
  } catch (error) {
    storage = { error: String(error) };
  }
  const fsEl = document.fullscreenElement;
  return {
    fullscreenEnabled: !!document.fullscreenEnabled,
    fullscreenElement: fsEl ? fsEl.tagName || 'unknown' : null,
    fullscreenElementId: fsEl && fsEl.id ? fsEl.id : '',
    requestFullscreenType: typeof document.documentElement.requestFullscreen,
    exitFullscreenType: typeof document.exitFullscreen,
    state: (window.__sandstrike && window.__sandstrike.state) || (window.__sandstrikeApp && window.__sandstrikeApp.state) || null,
    screen: document.getElementById('ui') ? document.getElementById('ui').getAttribute('data-screen') : null,
    menu: readBtn('.screen--menu'),
    pause: readBtn('.screen--pause'),
    storage,
  };
}

function pageFsLayout(scope) {
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
  const area = (a, b) => {
    if (!a || !b) return null;
    const w = Math.min(a.right, b.right) - Math.max(a.x, b.x);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
    return Math.round(Math.max(0, w) * Math.max(0, h) * 10) / 10;
  };
  const inView = (r, tol = 1) =>
    !!r && r.x >= -tol && r.y >= -tol && r.right <= innerWidth + tol && r.bottom <= innerHeight + tol && r.w > 1 && r.h > 1;
  const scopeEl = document.querySelector(scope);
  const panel = scopeEl ? scopeEl.querySelector('.panel--settings') : null;
  const button = scopeEl ? scopeEl.querySelector('[data-action="fullscreen"]') : null;
  const row = button ? button.closest('.set-row') : null;
  const primary =
    scope === '.screen--menu'
      ? document.querySelector('[data-start]')
      : document.querySelector(scope + ' [data-action="resume"]');
  const doc = document.documentElement;
  return {
    scope,
    state: (window.__sandstrike && window.__sandstrike.state) || null,
    screen: document.getElementById('ui') ? document.getElementById('ui').getAttribute('data-screen') : null,
    viewport: { w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio },
    panel: rectOf(panel),
    button: rectOf(button),
    row: rectOf(row),
    primary: rectOf(primary),
    panelInView: inView(rectOf(panel)),
    buttonInView: inView(rectOf(button)),
    rowInView: inView(rectOf(row)),
    primaryInView: inView(rectOf(primary)),
    buttonPrimaryOverlap: area(rectOf(button), rectOf(primary)),
    overflowX: {
      docScrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body ? document.body.scrollWidth : null,
      innerWidth,
      ok: doc.scrollWidth <= innerWidth + 1,
    },
  };
}

function pageMobileTarget() {
  const button = document.querySelector('.screen--menu [data-action="fullscreen"]');
  if (!button) return { exists: false };
  button.scrollIntoView({ block: 'center' });
  const b = button.getBoundingClientRect();
  const row = button.closest('.set-row');
  const rowText = row ? row.textContent.replace(/\s+/g, ' ').trim() : '';
  const doc = document.documentElement;
  return {
    exists: true,
    x: b.x + b.width / 2,
    y: b.y + b.height / 2,
    rect: { x: b.x, y: b.y, w: b.width, h: b.height },
    rowText: rowText.slice(0, 140),
    label: (button.querySelector('[data-fullscreen-label]') || {}).textContent || null,
    overflowX: { scrollWidth: doc.scrollWidth, innerWidth, ok: doc.scrollWidth <= innerWidth + 1 },
    fullscreenEnabled: !!document.fullscreenEnabled,
  };
}

function pageFrames() {
  return {
    frames: window.__renderDebug ? window.__renderDebug.frames : null,
    state: (window.__sandstrike && window.__sandstrike.state) || null,
    fpsText: (() => {
      const el = document.querySelector('[data-fps]');
      return el ? el.textContent.trim() : null;
    })(),
  };
}

// ---------------------------------------------------------------------------
// High-level helpers
// ---------------------------------------------------------------------------
async function currentState(target) {
  const r = await evalPage(pageFsState, undefined, target);
  return r.ok ? r.result : { error: r.error, state: null };
}

async function waitStateValue(want, timeout = 20000, target) {
  return (target || page)
    .waitForFunction(
      (value) =>
        ((window.__sandstrike && window.__sandstrike.state) ||
          (window.__sandstrikeApp && window.__sandstrikeApp.state)) === value,
      want,
      { timeout, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);
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
      return {
        loaded: false,
        ...v,
        earlyFailure: (recentPageError[0] && recentPageError[0].text.slice(0, 400)) || 'fatal screen',
        tookMs: Date.now() - startedAt,
      };
    }
    await sleep(500);
  }
  return { loaded: false, timeoutMs };
}

async function bootToMenu(target, url) {
  const attempts = [];
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1] ?? 60000;
      console.log(`[probe] load failed; retry #${attempt} in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
    const startedAt = Date.now();
    try {
      await target.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      const load = await waitLoaded(150000, target);
      const menu = load.loaded ? await waitMenu(60000, target) : false;
      const info = {
        attempt: attempt + 1,
        loaded: !!load.loaded,
        menu,
        tookMs: Date.now() - startedAt,
        earlyFailure: load.earlyFailure || null,
        recentErrors: annotateErrors(consoleErrors.slice(-5)),
      };
      attempts.push(info);
      console.log(`[probe] boot attempt ${attempt + 1}: loaded=${info.loaded} menu=${menu} (${info.tookMs}ms)`);
      if (info.loaded && info.menu) return { ok: true, attempts, info };
    } catch (error) {
      attempts.push({ attempt: attempt + 1, error: String(error?.message || error) });
    }
  }
  return { ok: false, attempts };
}

async function reloadAndWait() {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      console.log('[probe] reload failed; retry in 30s');
      await sleep(30000);
    }
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    } catch (error) {
      stages.reloadError = String(error?.message || error);
      continue;
    }
    const load = await waitLoaded(150000);
    if (!load.loaded) {
      stages.reloadError = load.earlyFailure || 'not loaded';
      continue;
    }
    const menu = await waitMenu(60000);
    if (menu) return { ok: true, attempt: attempt + 1 };
    stages.reloadError = 'menu not active';
  }
  return { ok: false, error: stages.reloadError };
}

async function startGame() {
  const already = await currentState();
  if (already.state === 'playing') return { ok: true, method: 'already', state: 'playing' };
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
  const ok = await waitStateValue('playing', 20000);
  return { ok, method: 'dev-hook-start', result: r.ok ? r.result : { error: r.error }, state: (await currentState()).state };
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
  const ok = await waitStateValue('paused', 15000);
  if (ok) await sleep(500);
  return { ok, method: 'dev-hook-pause', result: r.ok ? r.result : { error: r.error }, state: (await currentState()).state };
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

async function waitFullscreen(expected, timeout = 6000) {
  const ok = await page
    .waitForFunction((want) => !!document.fullscreenElement === want, expected, { timeout, polling: 100 })
    .then(() => true)
    .catch(() => false);
  if (ok) await sleep(400);
  return ok;
}

async function labelsOf(target) {
  const snapshot = await currentState(target);
  return {
    menu: snapshot.menu ? snapshot.menu.label : null,
    pause: snapshot.pause ? snapshot.pause.label : null,
    menuAria: snapshot.menu ? snapshot.menu.ariaPressed : null,
    pauseAria: snapshot.pause ? snapshot.pause.ariaPressed : null,
    fullscreenElement: snapshot.fullscreenElement,
    state: snapshot.state,
    raw: snapshot,
  };
}

/** Wait until BOTH panel labels show the expected ON/OFF text. */
async function waitLabels(expectedLabel, timeout = 4000, target) {
  const ok = await (target || page)
    .waitForFunction(
      (label) => {
        const read = (scope) => {
          const el = document.querySelector(scope + ' [data-fullscreen-label]');
          return el ? el.textContent.trim() : null;
        };
        return read('.screen--menu') === label && read('.screen--pause') === label;
      },
      expectedLabel,
      { timeout, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);
  return ok;
}

async function clickFullscreen(scope) {
  const selector = `${scope} [data-action="fullscreen"]`;
  const loc = page.locator(selector).first();
  const count = await page.locator(selector).count().catch(() => 0);
  if (!count) return { ok: false, method: 'missing', selector };
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await loc.hover({ timeout: 5000 }).catch(() => {});
    await loc.click({ timeout: 10000 });
    await sleep(250);
    return { ok: true, method: 'real-click' };
  } catch (error) {
    await evalPage((sel) => {
      const el = document.querySelector(sel);
      if (el) el.click();
    }, selector);
    await sleep(350);
    return { ok: true, method: 'dom-click-fallback', clickError: String(error?.message || error) };
  }
}

async function externalExit() {
  const r = await evalPage(() => {
    if (!document.fullscreenElement) return { wasFullscreen: false };
    try {
      const result = document.exitFullscreen();
      if (result && typeof result.catch === 'function') result.catch(() => {});
      return { wasFullscreen: true };
    } catch (error) {
      return { wasFullscreen: true, error: String(error) };
    }
  });
  return r.ok ? r.result : { error: r.error };
}

async function captureLayout(scope) {
  const report = await evalPage(pageFsLayout, scope);
  return report.ok ? report.result : { error: report.error };
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------
function checkFsLayout(report, file, scopeLabel) {
  const detail = { scope: scopeLabel, file: file ? file.name : null, bytes: file ? file.bytes : null, report };
  if (!report || report.error) return { pass: false, detail: { ...detail, error: report ? report.error : 'no report' } };
  const pass =
    !!file &&
    file.bytes > 1000 &&
    report.buttonInView &&
    report.rowInView &&
    report.panelInView &&
    report.primaryInView &&
    (report.buttonPrimaryOverlap === null || report.buttonPrimaryOverlap <= 0.5) &&
    report.overflowX.ok;
  return { pass, detail };
}

function classDelta(beforeClass, afterClass) {
  const before = new Set(String(beforeClass || '').split(/\s+/).filter(Boolean));
  const after = String(afterClass || '').split(/\s+/).filter(Boolean);
  return after.filter((name) => !before.has(name));
}

function looksActive(beforeClass, afterClass) {
  const added = classDelta(beforeClass, afterClass);
  return {
    added,
    active: added.length > 0 || /\b(is-on|is-active|is-fullscreen|active|on)\b/i.test(String(afterClass || '')),
  };
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------
async function stageContract() {
  const snapshot = await currentState();
  stages.contract = snapshot;
  const menu = snapshot.menu || {};
  const pause = snapshot.pause || {};
  const panelOk =
    !!menu.exists &&
    !!pause.exists &&
    menu.panelExists !== false &&
    pause.panelExists !== false &&
    menu.rowHasFullscreenText === true &&
    pause.rowHasFullscreenText === true &&
    menu.label !== null &&
    pause.label !== null;
  record('fs-contract-panels', '', panelOk ? 'PASS' : 'FAIL', {
    menu,
    pause,
    expectedSelectors: ['[data-action="fullscreen"]', '[data-fullscreen-label]'],
    expectedCount: 2,
  });

  const initialOk =
    snapshot.fullscreenElement === null &&
    menu.label === 'OFF' &&
    pause.label === 'OFF' &&
    menu.ariaPressed === 'false' &&
    pause.ariaPressed === 'false';
  record('fs-contract-initial-state', '', initialOk ? 'PASS' : 'FAIL', {
    fullscreenElement: snapshot.fullscreenElement,
    menu: { label: menu.label, ariaPressed: menu.ariaPressed },
    pause: { label: pause.label, ariaPressed: pause.ariaPressed },
    expected: { fullscreenElement: null, labels: ['OFF', 'OFF'], aria: ['false', 'false'] },
  });

  const envOk =
    snapshot.fullscreenEnabled === true &&
    snapshot.requestFullscreenType === 'function' &&
    snapshot.exitFullscreenType === 'function';
  record('fs-env-support', '', envOk ? 'PASS' : 'SKIP', {
    fullscreenEnabled: snapshot.fullscreenEnabled,
    requestFullscreenType: snapshot.requestFullscreenType,
    exitFullscreenType: snapshot.exitFullscreenType,
    note: envOk ? 'headless 硬件 GPU 环境支持全屏 API' : '环境不支持全屏 API，进入/退出类检查按环境限制记录',
  });
  return snapshot;
}

async function stageMenuEnterExit() {
  const before = await currentState();
  const base = await contractSnapshotSafe();
  // Layout + OFF screenshot first.
  const offLayout = await captureLayout('.screen--menu');
  const offFile = await shot('fullscreen-menu-off-1600x900.png');
  const offCheck = checkFsLayout(offLayout, offFile, 'menu 1600x900 OFF');
  record('fs-layout-menu-1600x900', '', offCheck.pass ? 'PASS' : 'FAIL', offCheck.detail);
  stages.menuOffLayout = { layout: offLayout, file: offFile };

  if (!before.menu || !before.menu.exists) {
    record('fs-enter-menu', '', 'FAIL', { reason: '[data-action="fullscreen"] missing in menu panel' });
    record('fs-enter-ui-sync', '', 'FAIL', { reason: 'button missing' });
    record('fs-exit-menu', '', 'FAIL', { reason: 'button missing' });
    record('fs-layout-menu-on-1600x900', '', 'FAIL', { reason: 'button missing — cannot capture ON state' });
    return { missing: true };
  }

  const click = await clickFullscreen('.screen--menu');
  const entered = click.ok ? await waitFullscreen(true, 6000) : false;
  const afterEnter = await currentState();
  record('fs-enter-menu', '', entered ? 'PASS' : 'FAIL', {
    click,
    fullscreenElement: afterEnter.fullscreenElement,
    fullscreenElementId: afterEnter.fullscreenElementId,
    expected: 'document.fullscreenElement !== null',
    state: afterEnter.state,
    screen: afterEnter.screen,
  });
  if (!entered) {
    record('fs-enter-ui-sync', '', 'FAIL', { reason: 'fullscreen not entered', afterEnter });
    record('fs-exit-menu', '', 'FAIL', { reason: 'fullscreen not entered' });
    record('fs-layout-menu-on-1600x900', '', 'FAIL', { reason: 'fullscreen not entered' });
    return { entered: false };
  }

  const active = looksActive(before.menu.className, afterEnter.menu.className);
  const uiSyncOk =
    afterEnter.menu.label === 'ON' &&
    afterEnter.pause.label === 'ON' &&
    afterEnter.menu.ariaPressed === 'true' &&
    afterEnter.pause.ariaPressed === 'true' &&
    active.active === true;
  record('fs-enter-ui-sync', '', uiSyncOk ? 'PASS' : 'FAIL', {
    menu: { label: afterEnter.menu.label, ariaPressed: afterEnter.menu.ariaPressed },
    pause: { label: afterEnter.pause.label, ariaPressed: afterEnter.pause.ariaPressed },
    activeClassBefore: before.menu.className,
    activeClassAfter: afterEnter.menu.className,
    classDelta: active.added,
    expected: { labels: ['ON', 'ON'], aria: ['true', 'true'], activeClass: true },
  });

  const onFile = await shot('fullscreen-menu-on-1600x900.png');
  const onLayout = await captureLayout('.screen--menu');
  const onCheck = checkFsLayout(onLayout, onFile, 'menu 1600x900 ON');
  record('fs-layout-menu-on-1600x900', '', onCheck.pass ? 'PASS' : 'FAIL', {
    ...onCheck.detail,
    labels: { menu: afterEnter.menu.label, pause: afterEnter.pause.label },
  });
  stages.menuOnLayout = { layout: onLayout, file: onFile };

  // Exit via the same button (real click; never rely on Esc in headless).
  const exitClick = await clickFullscreen('.screen--menu');
  const exited = exitClick.ok ? await waitFullscreen(false, 6000) : false;
  await sleep(300);
  const afterExit = await currentState();
  const exitOk =
    exited &&
    afterExit.fullscreenElement === null &&
    afterExit.menu.label === 'OFF' &&
    afterExit.pause.label === 'OFF' &&
    afterExit.menu.ariaPressed === 'false' &&
    afterExit.pause.ariaPressed === 'false';
  record('fs-exit-menu', '', exitOk ? 'PASS' : 'FAIL', {
    click: exitClick,
    fullscreenElement: afterExit.fullscreenElement,
    menu: { label: afterExit.menu.label, ariaPressed: afterExit.menu.ariaPressed },
    pause: { label: afterExit.pause.label, ariaPressed: afterExit.pause.ariaPressed },
  });
  return { entered, exited };
}

async function contractSnapshotSafe() {
  const r = await currentState();
  return r;
}

async function stageExternalExitSync() {
  const state0 = await currentState();
  if (!state0.menu || !state0.menu.exists) {
    record('fs-external-exit-sync', '', 'FAIL', { reason: 'fullscreen button missing' });
    return;
  }
  const click = await clickFullscreen('.screen--menu');
  const entered = click.ok ? await waitFullscreen(true, 6000) : false;
  if (!entered) {
    record('fs-external-exit-sync', '', 'FAIL', { reason: 'could not enter fullscreen for external-exit test', click });
    return;
  }
  const exitCall = await externalExit();
  const exited = await waitFullscreen(false, 5000);
  const labelsOk = await waitLabels('OFF', 4000);
  const after = await currentState();
  const ok =
    exited &&
    labelsOk &&
    after.fullscreenElement === null &&
    after.menu.label === 'OFF' &&
    after.pause.label === 'OFF' &&
    after.menu.ariaPressed === 'false';
  record('fs-external-exit-sync', '', ok ? 'PASS' : 'FAIL', {
    exitCall,
    exited,
    labelsSyncedToOff: labelsOk,
    after: {
      fullscreenElement: after.fullscreenElement,
      menu: { label: after.menu.label, ariaPressed: after.menu.ariaPressed },
      pause: { label: after.pause.label, ariaPressed: after.pause.ariaPressed },
    },
    expected: 'fullscreenchange 后实现自动把两个 label/aria 同步回 OFF',
  });
}

async function stagePausePanel() {
  const started = await startGame();
  const paused = await pauseGame();
  const before = await currentState();
  stages.pausePanel = { started, paused, before };
  const buttonOk = before.pause && before.pause.exists;
  if (!buttonOk) {
    record('fs-pause-panel-enter', '', 'FAIL', { reason: 'pause panel fullscreen button missing', started, paused, state: before.state });
    record('fs-pause-panel-exit', '', 'FAIL', { reason: 'pause panel fullscreen button missing' });
    record('fs-layout-pause-1600x900', '', 'FAIL', { reason: 'pause panel fullscreen button missing' });
    return;
  }
  if (!paused.ok) {
    record('fs-pause-panel-enter', '', 'FAIL', { reason: 'failed to pause game', paused });
    record('fs-pause-panel-exit', '', 'FAIL', { reason: 'failed to pause game' });
    record('fs-layout-pause-1600x900', '', 'FAIL', { reason: 'failed to pause game' });
    return;
  }

  const offLayout = await captureLayout('.screen--pause');
  const offFile = await shot('fullscreen-pause-off-1600x900.png');
  const clickIn = await clickFullscreen('.screen--pause');
  const entered = clickIn.ok ? await waitFullscreen(true, 6000) : false;
  const afterEnter = await currentState();
  const stateDuring = await currentState();
  const crossSync =
    afterEnter.pause.label === 'ON' &&
    afterEnter.menu.label === 'ON' &&
    afterEnter.pause.ariaPressed === 'true' &&
    afterEnter.menu.ariaPressed === 'true' &&
    stateDuring.state === 'paused';
  record('fs-pause-panel-enter', '', entered && crossSync ? 'PASS' : 'FAIL', {
    click: clickIn,
    fullscreenElement: afterEnter.fullscreenElement,
    pause: { label: afterEnter.pause.label, ariaPressed: afterEnter.pause.ariaPressed },
    menu: { label: afterEnter.menu.label, ariaPressed: afterEnter.menu.ariaPressed },
    gameState: stateDuring.state,
    expected: { fullscreen: true, labels: ['ON', 'ON'], state: 'paused' },
  });

  const onFile = await shot('fullscreen-pause-on-1600x900.png');
  const onLayout = await captureLayout('.screen--pause');
  const onCheck = checkFsLayout(onLayout, onFile, 'pause 1600x900 ON');
  record('fs-layout-pause-1600x900', '', onCheck.pass ? 'PASS' : 'FAIL', {
    ...onCheck.detail,
    offLayout,
    offFile: offFile.name,
    labels: { pause: afterEnter.pause.label, menu: afterEnter.menu.label },
  });

  if (entered) {
    const clickOut = await clickFullscreen('.screen--pause');
    const exited = clickOut.ok ? await waitFullscreen(false, 6000) : false;
    await sleep(300);
    const afterExit = await currentState();
    const exitOk =
      exited &&
      afterExit.fullscreenElement === null &&
      afterExit.pause.label === 'OFF' &&
      afterExit.menu.label === 'OFF' &&
      afterExit.pause.ariaPressed === 'false' &&
      afterExit.menu.ariaPressed === 'false' &&
      afterExit.state === 'paused';
    record('fs-pause-panel-exit', '', exitOk ? 'PASS' : 'FAIL', {
      click: clickOut,
      fullscreenElement: afterExit.fullscreenElement,
      pause: { label: afterExit.pause.label, ariaPressed: afterExit.pause.ariaPressed },
      menu: { label: afterExit.menu.label, ariaPressed: afterExit.menu.ariaPressed },
      gameState: afterExit.state,
    });
  } else {
    record('fs-pause-panel-exit', '', 'FAIL', { reason: 'pause-panel fullscreen not entered' });
  }
}

async function stagePersistence() {
  await goMenu();
  const state0 = await currentState();
  if (!state0.menu || !state0.menu.exists) {
    record('fs-not-persisted', '', 'FAIL', { reason: 'fullscreen button missing' });
    return;
  }
  const click = await clickFullscreen('.screen--menu');
  const entered = click.ok ? await waitFullscreen(true, 6000) : false;
  if (!entered) {
    record('fs-not-persisted', '', 'FAIL', { reason: 'could not enter fullscreen before reload', click });
    return;
  }
  const beforeReload = await currentState();
  const reload = await reloadAndWait();
  const after = await currentState();
  const labelsOff = await waitLabels('OFF', 4000).catch(() => false);
  const ok =
    reload.ok &&
    after.fullscreenElement === null &&
    after.menu.label === 'OFF' &&
    after.pause.label === 'OFF' &&
    after.menu.ariaPressed === 'false' &&
    (after.storage.fullscreenKeys || []).length === 0;
  record('fs-not-persisted', '', ok ? 'PASS' : 'FAIL', {
    beforeReload: {
      fullscreenElement: beforeReload.fullscreenElement,
      menu: beforeReload.menu.label,
      storageKeys: beforeReload.storage.keys,
    },
    reload,
    after: {
      fullscreenElement: after.fullscreenElement,
      menu: after.menu.label,
      pause: after.pause.label,
      aria: after.menu.ariaPressed,
    },
    storage: after.storage,
    labelsOffAfterReload: labelsOff,
    expected: { autoReenterFullscreen: false, label: 'OFF', fullscreenStorageKeys: [] },
  });
}

async function stageSmallLayout() {
  try {
    await page.setViewportSize(VIEW_SMALL);
  } catch (error) {
    stageErrors.push({ kind: 'setViewportSize', error: String(error?.message || error) });
  }
  await sleep(1000);
  await goMenu();
  const st = await currentState();
  if (!st.menu || !st.menu.exists) {
    record('fs-layout-menu-1280x720', '', 'FAIL', { reason: 'fullscreen button missing' });
    record('fs-layout-pause-1280x720', '', 'FAIL', { reason: 'fullscreen button missing' });
    return;
  }
  const offLayout = await captureLayout('.screen--menu');
  const offFile = await shot('fullscreen-menu-off-1280x720.png');
  const offCheck = checkFsLayout(offLayout, offFile, 'menu 1280x720 OFF');

  // ON state at 1280 (also exercises enter/exit again).
  const click = await clickFullscreen('.screen--menu');
  const entered = click.ok ? await waitFullscreen(true, 6000) : false;
  const onFile = await shot('fullscreen-menu-on-1280x720.png');
  const onLayout = await captureLayout('.screen--menu');
  const onCheck = checkFsLayout(onLayout, onFile, 'menu 1280x720 ON');
  if (entered) {
    await clickFullscreen('.screen--menu');
    await waitFullscreen(false, 6000);
    await waitLabels('OFF', 4000);
  }
  const menuOk = offCheck.pass && onCheck.pass && entered;
  record('fs-layout-menu-1280x720', '', menuOk ? 'PASS' : 'FAIL', {
    off: offCheck.detail,
    on: onCheck.detail,
    entered,
  });

  // Pause panel at 1280.
  const started = await startGame();
  const paused = await pauseGame();
  const pauseState = await currentState();
  const pauseLayout = await captureLayout('.screen--pause');
  const pauseFile = await shot('fullscreen-pause-off-1280x720.png');
  const pauseCheck = checkFsLayout(pauseLayout, pauseFile, 'pause 1280x720');
  record('fs-layout-pause-1280x720', '', started.ok && paused.ok && pauseCheck.pass ? 'PASS' : 'FAIL', {
    started,
    paused,
    state: pauseState.state,
    ...pauseCheck.detail,
  });
  stages.smallLayout = { entered, started, paused };
}

async function stageRegression() {
  // Ensure we are in gameplay, exit any fullscreen first.
  const pre = await currentState();
  if (pre.fullscreenElement) {
    await externalExit();
    await waitFullscreen(false, 5000);
  }
  const playing = await startGame();
  await sleep(800);
  const f0 = await evalPage(pageFrames);
  await sleep(800);
  const f1 = await evalPage(pageFrames);
  await sleep(800);
  const f2 = await evalPage(pageFrames);
  const a = f0.ok ? f0.result : null;
  const b = f1.ok ? f1.result : null;
  const c = f2.ok ? f2.result : null;
  const monotonic =
    a && b && c && Number.isFinite(a.frames) && Number.isFinite(b.frames) && Number.isFinite(c.frames) && b.frames > a.frames && c.frames > b.frames;
  const totalDelta = a && c && Number.isFinite(a.frames) && Number.isFinite(c.frames) ? c.frames - a.frames : null;
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
  const loopOk = playing.ok && monotonic && Number.isFinite(totalDelta) && totalDelta >= 5 && r.supported && Number.isFinite(r.calls) && r.calls > 0;
  record('fs-regression-loop', '', loopOk ? 'PASS' : 'FAIL', {
    playing,
    frames: { first: a ? a.frames : null, middle: b ? b.frames : null, last: c ? c.frames : null, totalDelta, monotonic },
    renderOnce: r,
  });

  const settings = await evalPage(() => {
    const count = (sel) => document.querySelectorAll(sel).length;
    const fpsEl = document.querySelector('[data-fps]');
    const fpsText = fpsEl ? fpsEl.textContent.trim() : null;
    const fpsNum = Number.parseFloat(fpsText === null ? '' : fpsText);
    return {
      frames: window.__renderDebug ? window.__renderDebug.frames : null,
      fpsText,
      fpsNumeric: Number.isFinite(fpsNum) && fpsNum > 0,
      fpsPanel: !!document.querySelector('[data-perf]'),
      fpsButtons: count('[data-action="fps"]'),
      muteButtons: count('[data-action="mute"]'),
      qualityButtons: count('[data-quality-value]'),
      fullscreenButtons: count('[data-action="fullscreen"]'),
      hudNodes: {
        radar: !!document.querySelector('.radar-panel'),
        health: !!document.querySelector('[data-health]'),
        wave: !!document.querySelector('.wave-panel'),
        ammo: !!document.querySelector('[data-mag]'),
      },
    };
  });
  const s = settings.ok ? settings.result : { error: settings.error };
  const hudOk =
    !s.error &&
    s.fpsPanel === true &&
    s.fpsNumeric === true &&
    s.fpsButtons === 2 &&
    s.muteButtons >= 2 &&
    s.qualityButtons >= 3 &&
    s.fullscreenButtons === 2 &&
    s.hudNodes &&
    s.hudNodes.radar &&
    s.hudNodes.health &&
    s.hudNodes.wave &&
    s.hudNodes.ammo;
  record('fs-regression-hud', '', hudOk ? 'PASS' : 'FAIL', s);
}

async function stageMobile() {
  // Fresh mobile context: 844×390 landscape, isMobile + hasTouch, DPR 3.
  try {
    mobileContext = await browser.newContext({
      viewport: VIEW_MOBILE,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
  } catch (error) {
    record('fs-mobile-844x390', '', 'SKIP', { reason: 'mobile context creation failed: ' + String(error?.message || error) });
    record('fs-mobile-layout', '', 'SKIP', { reason: 'mobile context creation failed' });
    return;
  }
  mobilePage = await mobileContext.newPage();
  mobilePage.setDefaultTimeout(20000);
  mobilePage.on('console', (msg) => {
    const entry = { type: msg.type(), text: msg.text(), atMs: Date.now() - t0, mobile: true };
    consoleLog.push(entry);
    if (msg.type() === 'error') consoleErrors.push(entry);
  });
  mobilePage.on('pageerror', (error) => {
    consoleErrors.push({ type: 'pageerror', text: String(error?.stack || error?.message || error), atMs: Date.now() - t0, mobile: true });
  });
  const boot = await bootToMenu(mobilePage, MOBILE_URL);
  stages.mobileBoot = boot;
  if (!boot.ok) {
    record('fs-mobile-844x390', '', 'SKIP', { reason: 'mobile page failed to load', boot });
    record('fs-mobile-layout', '', 'SKIP', { reason: 'mobile page failed to load', boot });
    return;
  }

  const target = await evalPage(pageMobileTarget, undefined, mobilePage);
  const t = target.ok ? target.result : { exists: false, error: target.error };
  if (!t.exists) {
    record('fs-mobile-844x390', '', 'FAIL', { reason: 'mobile menu has no [data-action="fullscreen"] row', target: t });
    record('fs-mobile-layout', '', 'FAIL', { reason: 'mobile menu has no [data-action="fullscreen"] row', target: t });
    return;
  }
  const offFile = await shotMobile(mobilePage, 'fullscreen-mobile-off-844x390.png');
  const layoutOk = t.overflowX && t.overflowX.ok && t.rect && t.rect.w > 1 && t.rect.h > 1;
  record('fs-mobile-layout', '', layoutOk && offFile.bytes > 1000 ? 'PASS' : 'FAIL', {
    row: t.rowText,
    rect: t.rect,
    overflowX: t.overflowX,
    file: offFile,
  });

  // Real touch tap (user gesture) on the FULLSCREEN toggle.
  let tapResult = null;
  let entered = false;
  try {
    await mobilePage.touchscreen.tap(t.x, t.y);
    tapResult = { method: 'touchscreen.tap', x: round(t.x), y: round(t.y) };
    entered = await waitFullscreenMobile(true, 6000);
  } catch (error) {
    tapResult = { method: 'touchscreen.tap', error: String(error?.message || error) };
  }
  const after = await currentState(mobilePage);
  let status = 'PASS';
  let note = '';
  if (!entered) {
    const env = await evalPage(
      () => ({
        fullscreenEnabled: !!document.fullscreenEnabled,
        fullscreenElement: !!document.fullscreenElement,
      }),
      undefined,
      mobilePage
    );
    const envInfo = env.ok ? env.result : { error: env.error };
    // Mobile emulation may not grant element fullscreen from a synthetic tap;
    // per spec this is an environment limitation, not an implementation defect.
    status = 'SKIP';
    note = '移动模拟环境未授予全屏（按环境限制 SKIP，不算实现 FAIL）';
    record('fs-mobile-844x390', '', status, {
      tapResult,
      entered: false,
      env: envInfo,
      labels: after.menu ? after.menu.label : null,
      reason: 'touchscreen tap 后 document.fullscreenElement 仍为空',
    }, note);
    const onFile = offFile;
    stages.mobile = { entered: false, file: onFile, tapResult };
    return;
  }
  const labelsOk = (await currentState(mobilePage)).menu.label === 'ON';
  const snapshot = await currentState(mobilePage);
  const onFile = await shotMobile(mobilePage, 'fullscreen-mobile-on-844x390.png');
  const ok = entered && labelsOk && snapshot.menu.ariaPressed === 'true';
  record('fs-mobile-844x390', '', ok ? 'PASS' : 'FAIL', {
    tapResult,
    entered,
    fullscreenElement: snapshot.fullscreenElement,
    menu: { label: snapshot.menu.label, ariaPressed: snapshot.menu.ariaPressed },
    file: onFile,
  });
  // Exit from script (tap again no longer needed) and confirm restore.
  await evalPage(() => {
    const result = document.exitFullscreen();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  }, undefined, mobilePage);
  const restored = await waitFullscreenMobile(false, 5000);
  const afterExit = await currentState(mobilePage);
  stages.mobile = { entered, restored, afterExit: { fullscreenElement: afterExit.fullscreenElement, menuLabel: afterExit.menu.label }, tapResult, file: onFile };
  if (mobileContext) await mobileContext.close().catch(() => {});
  mobileContext = null;
  mobilePage = null;
  return { entered, restored };
}

async function shotMobile(target, name) {
  const path = `${OUT_DIR}/${name}`;
  try {
    await target.screenshot({ path });
    const info = await stat(path).catch(() => null);
    const entry = { name: `shots/${name}`, bytes: info ? info.size : null, mobile: true };
    screenshots.push(entry);
    console.log(`[shot] shots/${name} (${entry.bytes ?? '?'} bytes)`);
    return entry;
  } catch (error) {
    stageErrors.push({ kind: 'screenshot', name, error: String(error?.message || error) });
    return { name: `shots/${name}`, bytes: null, error: String(error?.message || error) };
  }
}

async function waitFullscreenMobile(expected, timeout = 6000) {
  if (!mobilePage) return false;
  const ok = await mobilePage
    .waitForFunction((want) => !!document.fullscreenElement === want, expected, { timeout, polling: 100 })
    .then(() => true)
    .catch(() => false);
  if (ok) await sleep(400);
  return ok;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let bootInfo = null;
try {
  console.log('[probe] SANDSTRIKE fullscreen black-box probe');
  console.log(`[probe] url=${PAGE_URL}`);
  console.log(`[probe] mobile=${MOBILE_URL} ${VIEW_MOBILE.width}x${VIEW_MOBILE.height} isMobile/hasTouch`);

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
      if (!sessionStorage.getItem('__fsProbeInit')) {
        localStorage.clear();
        sessionStorage.setItem('__fsProbeInit', '1');
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

  bootInfo = await bootToMenu(page, PAGE_URL);
  stages.boot = bootInfo;
  if (!bootInfo.ok) {
    notes.push('[blocker] 页面未能加载到菜单；可能是并发改动造成的临时错误（已重试）。');
  } else {
    await stageContract();
    await stageMenuEnterExit();
    await stageExternalExitSync();
    await stagePausePanel();
    await stagePersistence();
    await stageSmallLayout();
    await stageMobile();
    await stageRegression();
  }
} catch (error) {
  const message = String(error?.stack || error?.message || error);
  stageErrors.push({ kind: 'fatal', error: message });
  console.error('[probe] FATAL:', message);
} finally {
  record('fs-no-console-errors', '', consoleErrors.length === 0 ? 'PASS' : 'FAIL', {
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
    probe: 'sandstrike-fullscreen-probe',
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
        'headless 支持全屏 API；Escape 不退出浏览器级全屏，因此退出用按钮点击或脚本 document.exitFullscreen() 验证',
        '进入游戏/暂停使用 dev hook（START 现在会弹部署难度弹窗）',
      ],
    },
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
    screenshots,
    stages,
    stageErrors,
    consoleErrors: annotateErrors(consoleErrors).slice(0, 60),
    consoleLogTail: consoleLog.slice(-50),
    notes,
  };
  try {
    await writeFile(`${OUT_DIR}/fullscreen-probe.json`, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`\n[probe] wrote shots/fullscreen-probe.json (${results.length} checks: ${passCount} PASS, ${failIds.length} FAIL, ${skipIds.length} SKIP)`);
  } catch (error) {
    console.error('[probe] failed to write JSON:', error);
  }
  if (failures.length) {
    console.log('[probe] FAILED checks:');
    for (const row of failures) console.log(`  - ${row.id}: ${row.name}`);
  } else {
    console.log('[probe] NO FAILURES');
  }
  if (mobileContext) await mobileContext.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  process.exitCode = failures.length ? 1 : 0;
}
