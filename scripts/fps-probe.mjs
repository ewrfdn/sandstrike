/**
 * SANDSTRIKE // 沙暴协议 — Frame-counter (FPS HUD) independent black-box probe.
 * ---------------------------------------------------------------------------
 * Independent verification for TEAM task-2: accuracy, default visibility,
 * toggle + localStorage persistence, labels/a11y, layout, stability/regression
 * and main-loop health of the newly added frame-counter readouts.
 *
 * Black box only: everything is asserted through real DOM/UI interaction and
 * the documented window.__sandstrike / window.__devUI dev hooks. Product code
 * is never imported or modified.
 *
 * Usage:   node scripts/fps-probe.mjs [baseUrl]
 * Default: http://127.0.0.1:8099/?dev=1&quality=high&touch=0
 * Output:  shots/fps-probe.json  +  shots/fps-*.png
 *
 * Env knobs:
 *   FPS_PROBE_URL, FPS_PROBE_QUERY, CHROME_PATH,
 *   FPS_PROBE_TOL (default 0.15), FPS_PROBE_STABILITY_MS (default 15000),
 *   FPS_PROBE_RETRY_DELAYS (default "45000,60000")
 *
 * Notes:
 *  - Headless Chrome MUST run with hardware GPU (ANGLE/D3D11): SwiftShader is
 *    far too slow for meaningful FPS numbers.
 *  - The workspace is shared with a parallel mobile/touch workstream, so page
 *    load failures are retried once or twice and console errors referencing
 *    touch/mobile code are annotated "[unrelated concurrent change]".
 *  - Writable scope: this script, shots/fps-probe.json, shots/fps-*.png only.
 */

import { chromium } from 'playwright-core';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = (process.argv[2] || process.env.FPS_PROBE_URL || 'http://127.0.0.1:8099').replace(/\/+$/, '');
const QUERY = process.env.FPS_PROBE_QUERY || 'dev=1&quality=high&touch=0';
const PAGE_URL = `${BASE_URL}/?${QUERY}`;
const OUT_DIR = resolve('shots');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEW_BIG = { width: 1600, height: 900 };
const VIEW_SMALL = { width: 1280, height: 720 };
const FPS_TOL = Number(process.env.FPS_PROBE_TOL || 0.15);
const STABILITY_MS = Math.max(5000, Number(process.env.FPS_PROBE_STABILITY_MS || 15000));
const RETRY_DELAYS = (process.env.FPS_PROBE_RETRY_DELAYS || '45000,60000')
  .split(',')
  .map((n) => Number(n))
  .filter((n) => Number.isFinite(n) && n >= 0);
const SETTINGS_KEY = 'sandstrike.settings.v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 1) => (Number.isFinite(v) ? +v.toFixed(d) : v);
const pct = (v, d = 1) => (Number.isFinite(v) ? +(v * 100).toFixed(d) : v);

await mkdir(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Expected check registry — anything not recorded by the end is a FAIL that
// says "not reached" (probe aborted / dependency missing).
// ---------------------------------------------------------------------------
const EXPECTED = [
  ['contract-dom-hud', '契约：HUD 面板 [data-perf] 含 fps/frametime/state/graph 且 data-level 合法'],
  ['contract-dom-menu', '契约：菜单读数 [data-menu-perf] 含 fps/ms'],
  ['contract-settings-buttons', '契约：menu 与 pause 各一份 [data-action="fps"]，含 label 与 aria-pressed'],
  ['contract-devui', '契约：window.__devUI.perf 可读且 setShowFps 可调用'],
  ['contract-set-show-fps', '契约：__devUI.setShowFps(bool) 生效并可恢复'],

  ['acc-menu-value', '准确性（菜单）：独立 rAF 实测帧率 vs [data-menu-fps]，容差 ±15%'],
  ['acc-game-value', '准确性（游戏内）：独立 rAF 实测帧率 vs [data-fps]，容差 ±15%'],
  ['acc-fps-ms-ratio', '准确性：fps × frameMs ≈ 1000（±20%）'],
  ['acc-perf-dom-sync', '准确性：__devUI.perf 与 DOM 读数一致且样本持续累积'],

  ['default-menu-visible', '默认可见：清空 localStorage 后菜单 [data-menu-perf] 可见且读数在 [5,300]'],
  ['default-hud-visible', '默认可见：进入游戏后 [data-perf] 在 HUD 中可见'],
  ['default-hud-refresh', '默认刷新：1.5s 内 [data-fps] 文本变化 / 采样累积'],

  ['toggle-menu-off', '开关：菜单 SYSTEM CONFIG 关闭后读数隐藏、class/aria/label/localStorage 正确'],
  ['toggle-persist-click-reload', '持久化：点击关闭后 reload 仍保持关闭'],
  ['toggle-hud-hidden', '开关：关闭状态下进入游戏，[data-perf] 实际隐藏（HUD 本身可见）'],
  ['toggle-f3-on', '开关：F3 重新打开，HUD 读数可见且状态同步'],
  ['toggle-pause-off', '开关：pause 面板可关闭，HUD 读数隐藏且菜单按钮同步'],
  ['toggle-pause-on', '开关：pause 面板可重新打开，读数恢复'],
  ['toggle-f3-off', '开关：pause 中按 F3 可关闭并持久化 false'],
  ['toggle-persist-f3-off-reload', '持久化：F3 关闭后 reload 仍保持隐藏'],
  ['toggle-f3-on-menu', '开关：菜单中 F3 重新打开，菜单读数可见'],
  ['toggle-persist-f3-on-reload', '持久化：F3 打开后 reload 仍保持可见'],

  ['layout-menu-1600x900', '布局 1600×900 菜单：读数在视口内、无横向溢出、截图生成'],
  ['layout-game-1600x900', '布局 1600×900 游戏：面板在视口内、不与雷达/准星/击杀播报重叠、无溢出、截图生成'],
  ['layout-menu-1280x720', '布局 1280×720 菜单：读数在视口内、无横向溢出、截图生成'],
  ['layout-game-1280x720', '布局 1280×720 游戏：面板在视口内、不与雷达重叠、无溢出、截图生成'],

  ['stab-actions', '稳定性：15s 内开枪/暂停恢复/fastForward/freeze 动作均执行成功'],
  ['stab-numeric', '稳定性：[data-fps] 始终为有效数字（无 NaN/Infinity/0 卡死 >2s）'],
  ['stab-mutation-rate', '稳定性：MutationObserver 任意 1s 内 [data-fps] 文本变更 ≤30 次'],
  ['stab-hud-nodes', '稳定性：雷达/波次/血量/护甲/弹药/得分/准星等原有 HUD 节点仍存在且可见'],
  ['stab-console-clean', '稳定性：15s 内无新增 console error / pageerror'],

  ['loop-frames-growth', '回归：__renderDebug.frames 持续增长（主循环仍运行）'],
  ['loop-render-once', '回归：renderOnce() 返回 calls>0（渲染管线正常）'],

  ['no-console-errors', '全程零 console error / pageerror'],
];

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------
const results = [];
const recordedIds = new Set();
const failures = [];
const screenshots = [];
const stageErrors = [];
const notes = [];
const stages = {};
const measurements = {};
const consoleErrors = [];
const consoleLog = [];
let page = null;
let context = null;
let browser = null;
let perfWarmState = null;
const t0 = Date.now();

function record(id, name, pass, detail = {}, note = '') {
  if (recordedIds.has(id)) return results.find((r) => r.id === id);
  recordedIds.add(id);
  const known = EXPECTED.find(([key]) => key === id);
  const row = {
    id,
    name: known ? known[1] : name,
    pass: !!pass,
    detail,
    ...(note ? { note } : {}),
  };
  results.push(row);
  if (!pass) failures.push(row);
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id}${note ? ' :: ' + note : ''}`);
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

/** Run a page.evaluate, never throw. */
async function evalPage(fn, arg) {
  try {
    const result = await page.evaluate(fn, arg);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/** Error text that looks like it comes from the concurrent mobile/touch workstream. */
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
// Self-contained functions executed inside the page (must not close over
// outer variables — all inputs arrive as arguments).
// ---------------------------------------------------------------------------
function pageVisibility(selector) {
  const el = document.querySelector(selector);
  if (!el) return { selector, exists: false, hidden: true, reason: 'missing' };
  let node = el;
  let opacity = 1;
  let hiddenReason = null;
  while (node && node !== document.documentElement) {
    const cs = getComputedStyle(node);
    if (cs.display === 'none') { hiddenReason = 'display:none'; break; }
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') {
      hiddenReason = 'visibility:' + cs.visibility;
      break;
    }
    const o = parseFloat(cs.opacity);
    if (Number.isFinite(o)) opacity *= o;
    node = node.parentElement;
  }
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  if (!hiddenReason && opacity <= 0.02) hiddenReason = 'opacity<=0.02';
  if (!hiddenReason && (r.width < 1 || r.height < 1)) hiddenReason = 'zero-size';
  return {
    selector,
    exists: true,
    hidden: !!hiddenReason,
    reason: hiddenReason,
    display: cs.display,
    visibility: cs.visibility,
    effectiveOpacity: Math.round(opacity * 1000) / 1000,
    rect: {
      x: Math.round(r.x * 10) / 10,
      y: Math.round(r.y * 10) / 10,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      right: Math.round(r.right * 10) / 10,
      bottom: Math.round(r.bottom * 10) / 10,
    },
  };
}

function pageContract() {
  const q = (s) => document.querySelector(s);
  const txt = (s) => {
    const el = q(s);
    return el ? el.textContent.trim() : null;
  };
  const perfEl = q('[data-perf]');
  const graph = q('canvas[data-perf-graph]');
  const menuEl = q('[data-menu-perf]');
  const devPerf = window.__devUI && window.__devUI.perf;
  const buttons = Array.from(document.querySelectorAll('button[data-action="fps"]'));
  const readStorage = () => {
    try {
      const raw = localStorage.getItem('sandstrike.settings.v1');
      if (!raw) return { has: false, showFps: null };
      const parsed = JSON.parse(raw);
      return { has: true, showFps: parsed && typeof parsed.showFps === 'boolean' ? parsed.showFps : null };
    } catch (error) {
      return { error: String(error) };
    }
  };
  return {
    state: (window.__sandstrike && window.__sandstrike.state) || (window.__sandstrikeApp && window.__sandstrikeApp.state) || null,
    screen: document.getElementById('ui') ? document.getElementById('ui').getAttribute('data-screen') : null,
    hudPanel: !!perfEl,
    hudLevel: perfEl ? perfEl.getAttribute('data-level') : null,
    hudGet: {
      fps: !!q('[data-fps]'),
      frameTime: !!q('[data-frametime]'),
      state: !!q('[data-perf-state]'),
      graph: !!graph,
    },
    graph: graph
      ? {
          width: graph.width,
          height: graph.height,
          clientW: Math.round(graph.clientWidth * 10) / 10,
          clientH: Math.round(graph.clientHeight * 10) / 10,
        }
      : null,
    hudTexts: { fps: txt('[data-fps]'), frameTime: txt('[data-frametime]'), state: txt('[data-perf-state]') },
    menuPanel: !!menuEl,
    menuGet: { fps: !!q('[data-menu-fps]'), ms: !!q('[data-menu-ms]') },
    menuTexts: { fps: txt('[data-menu-fps]'), ms: txt('[data-menu-ms]') },
    menuLevel: menuEl ? menuEl.getAttribute('data-level') : null,
    fpsButtons: buttons.map((b) => ({
      scope: b.closest('.screen--pause') ? 'pause' : b.closest('.screen--menu') ? 'menu' : 'other',
      pressed: b.getAttribute('aria-pressed'),
      label: b.querySelector('[data-fps-label]') ? b.querySelector('[data-fps-label]').textContent.trim() : null,
      disabled: !!b.disabled,
      text: b.textContent.replace(/\s+/g, ' ').trim().slice(0, 80),
    })),
    devUI: !!window.__devUI,
    devPerf: devPerf
      ? {
          fps: devPerf.fps,
          frameMs: devPerf.frameMs,
          worstMs: devPerf.worstMs,
          samples: devPerf.samples,
          level: devPerf.level,
        }
      : null,
    devSetShowFps: typeof (window.__devUI && window.__devUI.setShowFps),
    uiRootIsFpsOff: document.getElementById('ui')
      ? document.getElementById('ui').classList.contains('is-fps-off')
      : null,
    storage: readStorage(),
  };
}

function pageToggleSnapshot() {
  const ui = document.getElementById('ui');
  const buttons = Array.from(document.querySelectorAll('button[data-action="fps"]')).map((b) => ({
    scope: b.closest('.screen--pause') ? 'pause' : b.closest('.screen--menu') ? 'menu' : 'other',
    pressed: b.getAttribute('aria-pressed'),
    label: b.querySelector('[data-fps-label]') ? b.querySelector('[data-fps-label]').textContent.trim() : null,
    text: b.textContent.replace(/\s+/g, ' ').trim().slice(0, 80),
  }));
  let storage = null;
  try {
    const raw = localStorage.getItem('sandstrike.settings.v1');
    if (!raw) storage = { has: false, showFps: null };
    else {
      const parsed = JSON.parse(raw);
      storage = { has: true, showFps: parsed && typeof parsed.showFps === 'boolean' ? parsed.showFps : null };
    }
  } catch (error) {
    storage = { error: String(error) };
  }
  return {
    isFpsOff: ui ? ui.classList.contains('is-fps-off') : null,
    screen: ui ? ui.getAttribute('data-screen') : null,
    buttons,
    storage,
  };
}

function pageCurrentState() {
  return {
    state: (window.__sandstrike && window.__sandstrike.state) || (window.__sandstrikeApp && window.__sandstrikeApp.state) || null,
    screen: document.getElementById('ui') ? document.getElementById('ui').getAttribute('data-screen') : null,
    pointerLock: !!document.pointerLockElement,
    isFpsOff: document.getElementById('ui') ? document.getElementById('ui').classList.contains('is-fps-off') : null,
    visibility: document.visibilityState,
    startDisabled: document.querySelector('[data-start]') ? !!document.querySelector('[data-start]').disabled : null,
  };
}

function pageLayoutReport() {
  const rect = (sel) => {
    const el = document.querySelector(sel);
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
  const perf = rect('[data-perf]');
  const menuPerf = rect('[data-menu-perf]');
  const radar = rect('.radar-panel');
  const crosshair = rect('.crosshair');
  const killfeed = rect('[data-killfeed]');
  const killfeedItems = document.querySelectorAll('[data-killfeed] > *').length;
  const topbar = rect('.menu-topbar');
  const startBtn = rect('[data-start]');
  const doc = document.documentElement;
  return {
    state: (window.__sandstrike && window.__sandstrike.state) || (window.__sandstrikeApp && window.__sandstrikeApp.state) || null,
    screen: document.getElementById('ui') ? document.getElementById('ui').getAttribute('data-screen') : null,
    viewport: { w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio },
    perf,
    menuPerf,
    radar,
    crosshair,
    killfeed,
    killfeedItems,
    topbar,
    startBtn,
    perfInView: inView(perf),
    menuPerfInView: inView(menuPerf),
    radarInView: inView(radar),
    perfRadarOverlap: area(perf, radar),
    perfCrosshairOverlap: area(perf, crosshair),
    perfKillfeedOverlap: killfeedItems > 0 ? area(perf, killfeed) : null,
    radarWidthDelta: perf && radar ? Math.round((perf.w - radar.w) * 10) / 10 : null,
    overflowX: {
      docScrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body ? document.body.scrollWidth : null,
      innerWidth,
      ok: doc.scrollWidth <= innerWidth + 1,
    },
    hudTopRight: rect('.hud-top-right'),
  };
}

function pageHudNodes() {
  const list = [
    ['radar', '.radar-panel'],
    ['radarCanvas', '.radar-canvas'],
    ['wave', '.wave-panel'],
    ['waveCurrent', '[data-wave-current]'],
    ['health', '[data-health]'],
    ['armor', '[data-armor]'],
    ['ammo', '[data-mag]'],
    ['score', '[data-score]'],
    ['crosshair', '.crosshair'],
    ['vitals', '.vitals-panel'],
    ['ammoPanel', '.ammo-panel'],
  ];
  const out = {};
  for (const pair of list) {
    const key = pair[0];
    const sel = pair[1];
    const el = document.querySelector(sel);
    if (!el) {
      out[key] = { selector: sel, exists: false, visible: false };
      continue;
    }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // The crosshair wrapper is intentionally 0×0 (its lines are absolutely
    // positioned children), so visibility for it is display/visibility only.
    const rectVisible = key === 'crosshair' ? true : r.width > 1 && r.height > 1;
    out[key] = {
      selector: sel,
      exists: true,
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && rectVisible,
      display: cs.display,
      visibility: cs.visibility,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
    };
  }
  return { nodes: out, state: document.getElementById('ui') ? document.getElementById('ui').getAttribute('data-screen') : null };
}

function pageStartSampler() {
  const qa = (window.__fpsQA = {
    start: performance.now(),
    samples: [],
    changes: [],
    errors: [],
    observer: null,
    sampler: 0,
    hasTarget: !!document.querySelector('[data-fps]'),
  });
  const read = () => {
    const el = document.querySelector('[data-fps]');
    const text = el ? el.textContent.trim() : null;
    const parsed = text === null ? null : Number.parseFloat(text);
    const perf = window.__devUI && window.__devUI.perf;
    return {
      t: Math.round((performance.now() - qa.start) * 10) / 10,
      text,
      value: Number.isFinite(parsed) ? parsed : null,
      perf: perf
        ? { fps: perf.fps, frameMs: perf.frameMs, worstMs: perf.worstMs, samples: perf.samples }
        : null,
    };
  };
  qa.sampler = setInterval(() => {
    try {
      qa.samples.push(read());
    } catch (error) {
      qa.errors.push(String(error));
    }
  }, 100);
  const target = document.querySelector('[data-fps]');
  if (target) {
    let last = target.textContent;
    qa.observer = new MutationObserver(() => {
      const text = target.textContent.trim();
      if (text !== last) {
        last = text;
        qa.changes.push(Math.round((performance.now() - qa.start) * 10) / 10);
      }
    });
    qa.observer.observe(target, { characterData: true, childList: true, subtree: true });
  }
  qa.frames0 = window.__renderDebug ? window.__renderDebug.frames : null;
  return { hasTarget: qa.hasTarget };
}

function pageStopSampler() {
  const qa = window.__fpsQA || { samples: [], changes: [], errors: [] };
  if (qa.sampler) clearInterval(qa.sampler);
  if (qa.observer) qa.observer.disconnect();
  return {
    hasTarget: !!qa.hasTarget,
    samples: qa.samples || [],
    changes: qa.changes || [],
    errors: qa.errors || [],
    frames0: qa.frames0 ?? null,
    frames1: window.__renderDebug ? window.__renderDebug.frames : null,
    durationMs: qa.start ? Math.round(performance.now() - qa.start) : null,
  };
}

function pageRefreshProbe(durationMs) {
  return new Promise((done) => {
    const el = document.querySelector('[data-fps]');
    if (!el) {
      done({ target: false });
      return;
    }
    const initial = el.textContent.trim();
    const perf0 = window.__devUI && window.__devUI.perf ? window.__devUI.perf.samples : null;
    let mutations = 0;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
    });
    observer.observe(el, { characterData: true, childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      const final = el.textContent.trim();
      const perf1 = window.__devUI && window.__devUI.perf ? window.__devUI.perf.samples : null;
      done({
        target: true,
        initial,
        final,
        changed: initial !== final,
        mutations,
        perfSamples0: perf0,
        perfSamples1: perf1,
        perfDelta: Number.isFinite(perf0) && Number.isFinite(perf1) ? perf1 - perf0 : null,
      });
    }, durationMs);
  });
}

/**
 * Independent rAF cadence measurement (3 s window) plus a per-frame sample of
 * the DOM reading. The DOM reading is sampled at the end of each frame to avoid
 * reading during an update (black-box friendly).
 *
 * Two fps figures are returned so accuracy can be compared on an *aligned*
 * window: `fps` covers the whole window, `tailFps` covers only the same last
 * 1.5 s that the DOM averaging uses. This keeps the comparison fair when the
 * machine is under load (frame time spikes skew a short UI sampling window).
 */
function pageMeasure(options) {
  const durationMs = options.durationMs;
  const domSelector = options.domSelector;
  const tailMs = options.tailMs || 1500;
  return new Promise((done) => {
    const readDom = () => {
      const el = document.querySelector(domSelector);
      if (!el) return null;
      const value = Number.parseFloat(el.textContent.trim());
      return Number.isFinite(value) ? value : null;
    };
    const entries = [];
    const samples = [];
    let last = performance.now();
    const start = last;
    const perf0 = window.__devUI && window.__devUI.perf ? window.__devUI.perf.samples : null;
    const tick = (now) => {
      entries.push({ dt: now - last, t: now - start });
      last = now;
      samples.push({ t: now - start, value: readDom() });
      if (now - start < durationMs) {
        requestAnimationFrame(tick);
        return;
      }
      const perf1 = window.__devUI && window.__devUI.perf ? window.__devUI.perf.samples : null;
      const intervals = entries.map((entry) => entry.dt);
      const frames = intervals.length;
      const span = last - start;
      const sorted = intervals.slice().sort((a, b) => a - b);
      const quant = (p) => {
        if (!sorted.length) return null;
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
        return Math.round(sorted[idx] * 100) / 100;
      };
      const tail = samples.filter((s) => s.t >= durationMs - tailMs && s.value !== null);
      const avgDom = tail.length ? tail.reduce((acc, s) => acc + s.value, 0) / tail.length : null;
      const allDom = samples.filter((s) => s.value !== null);
      const avgDomAll = allDom.length ? allDom.reduce((acc, s) => acc + s.value, 0) / allDom.length : null;
      const lastDom = samples.length ? samples[samples.length - 1].value : null;
      const tailEntries = entries.filter((entry) => entry.t >= durationMs - tailMs);
      const tailFrames = tailEntries.length;
      const tailSpanMs = tailEntries.reduce((acc, entry) => acc + entry.dt, 0);
      const tailFps = tailFrames && tailSpanMs > 0 ? (tailFrames / (tailSpanMs / 1000)) : null;
      done({
        frames,
        spanMs: Math.round(span * 10) / 10,
        fps: Math.round((frames / (span / 1000)) * 10) / 10,
        tailFrames,
        tailSpanMs: Math.round(tailSpanMs * 10) / 10,
        tailFps: tailFps === null ? null : Math.round(tailFps * 10) / 10,
        avgMs: Math.round((span / frames) * 100) / 100,
        p50Ms: quant(0.5),
        p95Ms: quant(0.95),
        maxMs: sorted.length ? Math.round(sorted[sorted.length - 1] * 100) / 100 : null,
        domSamples: tail.length,
        domAvg: avgDom === null ? null : Math.round(avgDom * 10) / 10,
        domAvgAllFps: avgDomAll === null ? null : Math.round(avgDomAll * 10) / 10,
        domAllSamples: allDom.length,
        domLast: lastDom,
        domValues: tail.slice(-6).map((s) => s.value),
        perfSamples: { before: perf0, after: perf1, delta: Number.isFinite(perf0) && Number.isFinite(perf1) ? perf1 - perf0 : null },
        windowStable: Number.isFinite(perf0) && Number.isFinite(perf1) ? perf1 - perf0 >= frames * 0.8 : null,
      });
    };
    requestAnimationFrame(tick);
  });
}

/** Short rAF pulse used to estimate whether the machine is currently contended. */
function pagePulse(durationMs) {
  return new Promise((done) => {
    const intervals = [];
    let last = performance.now();
    const start = last;
    const tick = (now) => {
      intervals.push(now - last);
      last = now;
      if (now - start < durationMs) {
        requestAnimationFrame(tick);
        return;
      }
      const sorted = intervals.slice().sort((a, b) => a - b);
      const quant = (p) => {
        if (!sorted.length) return null;
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
        return Math.round(sorted[idx] * 100) / 100;
      };
      const span = last - start;
      done({
        frames: intervals.length,
        spanMs: Math.round(span * 10) / 10,
        fps: Math.round((intervals.length / (span / 1000)) * 10) / 10,
        p50Ms: quant(0.5),
        p95Ms: quant(0.95),
        maxMs: sorted.length ? Math.round(sorted[sorted.length - 1] * 100) / 100 : null,
      });
    };
    requestAnimationFrame(tick);
  });
}

// ---------------------------------------------------------------------------
// High-level page helpers
// ---------------------------------------------------------------------------
async function currentState() {
  const r = await evalPage(pageCurrentState);
  return r.ok ? r.result : { state: null, error: r.error };
}

async function waitStateValue(target, timeout = 20000) {
  const ok = await page
    .waitForFunction(
      (want) =>
        ((window.__sandstrike && window.__sandstrike.state) ||
          (window.__sandstrikeApp && window.__sandstrikeApp.state)) === want,
      target,
      { timeout, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);
  return ok;
}

async function waitMenu(timeout = 45000) {
  const ok = await page
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
  if (ok) await sleep(700); // let the screen fade-in finish before measuring layout
  return ok;
}

/**
 * Wait until the app reports loaded. Fails fast on uncaught page errors (e.g. a
 * transient syntax error from the parallel mobile workstream writing files)
 * instead of burning the whole timeout.
 */
async function waitLoaded(timeoutMs = 150000) {
  const start = Date.now();
  let polls = 0;
  while (Date.now() - start < timeoutMs) {
    polls++;
    const r = await evalPage(() => ({
      loaded: !!(window.__sandstrikeApp && window.__sandstrikeApp.loaded),
      fatalScreen: !!document.querySelector('.fatal-screen'),
      hasUi: !!document.getElementById('ui'),
      hasStart: !!document.querySelector('[data-start]'),
      readyState: document.readyState,
    }));
    const v = r.ok ? r.result : {};
    if (v.loaded) return { loaded: true, ...v, tookMs: Date.now() - start, polls };
    // Early out: a brand-new pageerror almost certainly means the module graph
    // did not evaluate (syntax error / missing export from concurrent edits).
    const recentPageError = consoleErrors.filter(
      (entry) => entry.type === 'pageerror' && Date.now() - t0 - entry.atMs < 3000
    );
    if (v.fatalScreen || recentPageError.length) {
      return {
        loaded: false,
        ...v,
        tookMs: Date.now() - start,
        polls,
        earlyFailure: (recentPageError[0] && recentPageError[0].text.slice(0, 400)) || 'fatal screen',
      };
    }
    await sleep(500);
  }
  return { loaded: false, timeoutMs, polls };
}

async function bootToMenu() {
  const attempts = [];
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1] ?? 60000;
      console.log(`[probe] load failed; retry #${attempt} in ${Math.round(delay / 1000)}s (waiting for concurrent edits to settle)`);
      await sleep(delay);
    }
    const startedAt = Date.now();
    try {
      await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
      const loadResult = await waitLoaded(150000);
      const loaded = !!loadResult.loaded;
      const menu = loaded ? await waitMenu(60000) : false;
      const diag = await evalPage(() => ({
        readyState: document.readyState,
        fatalScreen: document.querySelector('.fatal-screen')
          ? document.querySelector('.fatal-screen').textContent.slice(0, 400)
          : null,
        hasStart: !!document.querySelector('[data-start]'),
        hasUi: !!document.getElementById('ui'),
        visibility: document.visibilityState,
        webgl2: (() => {
          try {
            return !!document.createElement('canvas').getContext('webgl2');
          } catch (_) {
            return false;
          }
        })(),
      }));
      const info = {
        attempt: attempt + 1,
        url: PAGE_URL,
        loaded,
        menu,
        tookMs: Date.now() - startedAt,
        earlyFailure: loadResult.earlyFailure || null,
        diagnostics: diag.ok ? diag.result : { error: diag.error },
        recentErrors: annotateErrors(consoleErrors.slice(-6)),
      };
      attempts.push(info);
      console.log(`[probe] boot attempt ${attempt + 1}: loaded=${loaded} menu=${menu} (${info.tookMs}ms)`);
      if (loaded && menu) return { ok: true, attempts, info };
    } catch (error) {
      const info = { attempt: attempt + 1, error: String(error?.message || error), recentErrors: annotateErrors(consoleErrors.slice(-6)) };
      attempts.push(info);
      console.log(`[probe] boot attempt ${attempt + 1} threw: ${info.error}`);
    }
  }
  return { ok: false, attempts };
}

async function reloadAndWait() {
  const attempts = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      console.log('[probe] reload failed; retrying once in 30s (concurrent edits may be in flight)');
      await sleep(30000);
    }
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    } catch (error) {
      attempts.push({ attempt: attempt + 1, stage: 'reload', error: String(error?.message || error) });
      continue;
    }
    const loadResult = await waitLoaded(150000);
    if (!loadResult.loaded) {
      attempts.push({
        attempt: attempt + 1,
        stage: 'loaded',
        earlyFailure: loadResult.earlyFailure || null,
        recentErrors: annotateErrors(consoleErrors.slice(-6)),
      });
      continue;
    }
    const menu = await waitMenu(60000);
    const info = {
      attempt: attempt + 1,
      ok: menu,
      stage: menu ? 'menu' : 'menu-screen',
      recentErrors: annotateErrors(consoleErrors.slice(-6)),
    };
    attempts.push(info);
    if (menu) return { ...info, attempts };
  }
  return { ok: false, stage: 'reload-retries-exhausted', attempts, recentErrors: annotateErrors(consoleErrors.slice(-6)) };
}

async function ensurePaused(tries = 3) {
  const methods = [];
  const st0 = await currentState();
  if (st0.state === 'paused') return { ok: true, method: 'already', state: st0.state };
  if (st0.state !== 'playing') return { ok: false, method: 'n/a', state: st0.state };
  // Preferred path per Lead: the shared workspace's START/RESTART now gates on a
  // deployment dialog and headless pointer-lock makes synthetic Escape flaky, so
  // the documented dev hooks are the stable black-box control surface.
  const hook = await evalPage(() => {
    const s = window.__sandstrike;
    if (!s || typeof s.pause !== 'function') return { supported: false };
    try {
      s.pause();
      return { supported: true };
    } catch (error) {
      return { supported: true, error: String(error) };
    }
  });
  if (hook.ok && hook.result && hook.result.supported) {
    methods.push('dev-hook-pause');
    await sleep(600);
    const st = await currentState();
    if (st.state === 'paused') return { ok: true, method: methods.join('+'), state: st.state };
  }
  for (let i = 0; i < tries; i++) {
    const st = await currentState();
    if (st.state === 'paused') return { ok: true, method: methods.join('+') || 'already', state: st.state };
    if (st.state !== 'playing') return { ok: false, method: 'n/a', state: st.state };
    await page.keyboard.press('Escape').catch(() => {});
    methods.push('Escape-key');
    await sleep(500);
    if ((await currentState()).state === 'paused') return { ok: true, method: methods.join('+'), state: 'paused' };
  }
  await evalPage(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }))
  );
  methods.push('synthetic-Escape');
  await sleep(600);
  const st = await currentState();
  return { ok: st.state === 'paused', method: methods.join('+'), state: st.state };
}

async function ensurePlaying(tries = 3) {
  const methods = [];
  const st0 = await currentState();
  if (st0.state === 'playing') return { ok: true, method: 'already', state: st0.state };
  if (st0.state !== 'paused') return { ok: false, method: 'n/a', state: st0.state };
  const hook = await evalPage(() => {
    const s = window.__sandstrike;
    if (!s || typeof s.resume !== 'function') return { supported: false };
    try {
      s.resume();
      return { supported: true };
    } catch (error) {
      return { supported: true, error: String(error) };
    }
  });
  if (hook.ok && hook.result && hook.result.supported) {
    methods.push('dev-hook-resume');
    await sleep(600);
    const st = await currentState();
    if (st.state === 'playing') return { ok: true, method: methods.join('+'), state: st.state };
  }
  for (let i = 0; i < tries; i++) {
    const st = await currentState();
    if (st.state === 'playing') return { ok: true, method: methods.join('+') || 'already', state: st.state };
    if (st.state !== 'paused') return { ok: false, method: 'n/a', state: st.state };
    await sleep(250); // main.js guards ui:resume for ~420 ms after pause
    await page.keyboard.press('Escape').catch(() => {});
    methods.push('Escape-key');
    await sleep(500);
    if ((await currentState()).state === 'playing') return { ok: true, method: methods.join('+'), state: 'playing' };
  }
  await evalPage(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }))
  );
  methods.push('synthetic-Escape');
  await sleep(700);
  const st = await currentState();
  return { ok: st.state === 'playing', method: methods.join('+'), state: st.state };
}

/**
 * Enter a run. Per Lead (shared workspace changed START to open a deployment
 * difficulty dialog), the documented dev hook is the stable control surface;
 * the real-UI path is kept as a fallback and its outcome recorded.
 */
async function realStart() {
  const result = { method: 'dev-hook', ok: false, steps: [] };
  const already = await currentState();
  if (already.state === 'playing') {
    result.method = 'already';
    result.ok = true;
    result.state = already.state;
    return result;
  }
  const dev = await evalPage(() => {
    const s = window.__sandstrike;
    if (!s || typeof s.start !== 'function') return { supported: false };
    try {
      s.start();
      return { supported: true };
    } catch (error) {
      return { supported: true, error: String(error) };
    }
  });
  result.steps.push({ step: 'dev-hook start', result: dev.ok ? dev.result : { error: dev.error } });
  if (await waitStateValue('playing', 20000)) {
    result.ok = true;
    result.state = (await currentState()).state;
    result.pointerLock = (await currentState()).pointerLock;
    return result;
  }

  // Fallback: real DOM click on START, then the deployment difficulty card if
  // the shared workspace opened that dialog.
  result.method = 'real-click-fallback';
  const start = page.locator('[data-start]');
  try {
    await start.waitFor({ state: 'visible', timeout: 15000 });
    await start.click({ timeout: 15000 });
    result.steps.push({ step: 'real-click [data-start]', ok: true });
  } catch (error) {
    result.steps.push({ step: 'real-click [data-start]', ok: false, error: String(error?.message || error) });
  }
  await sleep(450);
  const deploy = await evalPage(() => {
    const el = document.querySelector('[data-deploy]');
    if (!el) return { supported: false, open: false };
    const cs = getComputedStyle(el);
    const open =
      el.classList.contains('is-open') ||
      el.getAttribute('aria-hidden') === 'false' ||
      (cs.display !== 'none' && cs.visibility !== 'hidden' && Number.parseFloat(cs.opacity || '1') > 0.01);
    return { supported: true, open };
  });
  result.deploy = deploy.ok ? deploy.result : { error: deploy.error };
  if (result.deploy && result.deploy.open) {
    const choice = page.locator('[data-deploy-value="standard"]').first();
    const count = await choice.count().catch(() => 0);
    if (count) {
      try {
        await choice.click({ timeout: 10000 });
        result.steps.push({ step: 'deploy standard click', ok: true });
      } catch (error) {
        await evalPage(() => {
          const el = document.querySelector('[data-deploy-value="standard"]');
          if (el) el.click();
        });
        result.steps.push({ step: 'deploy standard dom-click', ok: false, error: String(error?.message || error) });
      }
    } else {
      await page.keyboard.press('Enter').catch(() => {});
      result.steps.push({ step: 'deploy ENTER', ok: true });
    }
    await sleep(550);
  }
  result.ok = await waitStateValue('playing', 20000);
  const st = await currentState();
  result.state = st.state;
  result.pointerLock = st.pointerLock;
  return result;
}

async function goToMenu() {
  const actions = [];
  let st = await currentState();
  if (st.state === 'menu') return { ok: true, via: 'already', actions };
  if (st.state === 'playing') {
    const paused = await ensurePaused();
    actions.push({ pause: paused });
    st = await currentState();
  }
  if (st.state === 'paused') {
    const btn = page.locator('.screen--pause [data-action="menu"]').first();
    const count = await btn.count().catch(() => 0);
    if (count) {
      try {
        await btn.click({ timeout: 10000 });
        actions.push({ menuClick: true });
      } catch (error) {
        actions.push({ menuClickError: String(error?.message || error) });
      }
      const ok = await waitMenu(25000);
      if (ok) return { ok: true, via: 'pause-abandon-click', actions };
    }
  }
  const dev = await evalPage(() => {
    const s = window.__sandstrike;
    if (!s || typeof s.menu !== 'function') return { supported: false };
    s.menu();
    return { supported: true };
  });
  actions.push({ devMenu: dev.ok ? dev.result : dev.error });
  const ok = await waitMenu(25000);
  return { ok, via: 'dev-menu-fallback', actions };
}

async function visibilityOf(selector) {
  const r = await evalPage(pageVisibility, selector);
  if (r.ok) return r.result;
  return { selector, exists: false, hidden: true, reason: 'evaluate-error:' + r.error };
}

/** Wait for an element to become effectively visible (e.g. HUD fade-in). */
async function waitVisible(selector, timeout = 4000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeout) {
    last = await visibilityOf(selector);
    if (last.exists && !last.hidden) return { ok: true, waitedMs: Date.now() - startedAt, visibility: last };
    await sleep(100);
  }
  return { ok: false, waitedMs: Date.now() - startedAt, visibility: last };
}

async function contractSnapshot() {
  const r = await evalPage(pageContract);
  if (r.ok) return r.result;
  return { error: r.error };
}

async function toggleSnapshot() {
  const r = await evalPage(pageToggleSnapshot);
  if (r.ok) return r.result;
  return { error: r.error, buttons: [], storage: null };
}

async function clickFpsButton(scopeSelector) {
  const selector = `${scopeSelector} button[data-action="fps"]`;
  const locator = page.locator(selector).first();
  const count = await page.locator(selector).count().catch(() => 0);
  if (!count) return { ok: false, method: 'missing', selector };
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await locator.hover({ timeout: 5000 }).catch(() => {});
    await locator.click({ timeout: 10000 });
    await sleep(700);
    return { ok: true, method: 'real-click' };
  } catch (error) {
    await evalPage((sel) => {
      const el = document.querySelector(sel);
      if (el) el.click();
    }, selector);
    await sleep(700);
    return { ok: true, method: 'dom-click-fallback', clickError: String(error?.message || error) };
  }
}

async function toggleF3() {
  const before = await currentState();
  await page.keyboard.press('F3').catch(() => {});
  await sleep(700);
  let after = await currentState();
  let method = 'keyboard';
  if (after.isFpsOff === before.isFpsOff) {
    await evalPage(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F3', key: 'F3', bubbles: true, cancelable: true }))
    );
    method = 'synthetic-fallback';
    await sleep(700);
    after = await currentState();
  }
  return { before: before.isFpsOff, after: after.isFpsOff, method, changed: after.isFpsOff !== before.isFpsOff };
}

/** Wait until a readout shows a sane numeric value (avoids capturing "--"). */
async function waitReadoutNumeric(selector, timeout = 3000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeout) {
    const r = await evalPage((sel) => {
      const el = document.querySelector(sel);
      const text = el ? el.textContent.trim() : null;
      const value = Number.parseFloat(text === null ? '' : text);
      return { text, numeric: Number.isFinite(value) && value > 0 };
    }, selector);
    last = r.ok ? r.result : { error: r.error };
    if (last && last.numeric) return { ok: true, text: last.text, waitedMs: Date.now() - startedAt };
    await sleep(120);
  }
  return { ok: false, last, waitedMs: Date.now() - startedAt };
}

async function captureLayout(filename, readoutSelector) {
  const prep = await evalPage(() => {
    const s = window.__sandstrike;
    if (!s) return { supported: false };
    try {
      s.freeze(true);
      if (typeof s.renderOnce === 'function') s.renderOnce();
      return { supported: true };
    } catch (error) {
      return { supported: true, error: String(error) };
    }
  });
  await sleep(220);
  const readout = readoutSelector ? await waitReadoutNumeric(readoutSelector) : null;
  const file = await shot(filename);
  const report = await evalPage(pageLayoutReport);
  await evalPage(() => window.__sandstrike && window.__sandstrike.freeze && window.__sandstrike.freeze(false));
  return {
    file,
    readout,
    prep: prep.ok ? prep.result : { error: prep.error },
    report: report.ok ? report.result : { error: report.error },
  };
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------
function checkLayout(report, kind, file, viewportLabel, readout = null) {
  const detail = { viewport: viewportLabel, file: file.name, bytes: file.bytes, readout, report };
  if (!report || report.error) return { pass: false, detail: { ...detail, error: report ? report.error : 'no report' } };
  if (kind === 'menu') {
    const pass =
      !!file.bytes &&
      file.bytes > 1000 &&
      report.screen === 'menu' &&
      report.menuPerfInView &&
      report.overflowX.ok;
    return { pass, detail };
  }
  const killfeedOk = report.perfKillfeedOverlap === null || report.perfKillfeedOverlap <= 0.5;
  const pass =
    !!file.bytes &&
    file.bytes > 1000 &&
    report.screen === 'playing' &&
    report.perfInView &&
    (report.perfRadarOverlap === null || report.perfRadarOverlap <= 0.5) &&
    (report.perfCrosshairOverlap === null || report.perfCrosshairOverlap <= 0.5) &&
    killfeedOk &&
    report.overflowX.ok;
  return { pass, detail };
}

function checkAccuracy(measured, tolerance) {
  if (!measured) return { pass: false, detail: { reason: 'no measurement' } };
  if (!(measured.fps > 0)) return { pass: false, detail: { measured, reason: 'independent rAF measurement invalid' } };
  const reference = Number.isFinite(measured.domAvgAllFps)
    ? measured.domAvgAllFps
    : Number.isFinite(measured.domAvg)
    ? measured.domAvg
    : measured.domLast;
  if (!Number.isFinite(reference)) return { pass: false, detail: { measured, reason: 'DOM reading not numeric' } };
  // Primary comparison: whole 3 s independent rAF cadence vs the mean of the
  // DOM readings sampled across the SAME 3 s window. Secondary: the aligned
  // last-1.5 s window (kept for transparency when the machine has stall bursts
  // — a time-weighted tail fps and a per-frame reading mean diverge there).
  const wholeDelta = Math.abs(measured.fps - reference) / measured.fps;
  const alignedFps = Number.isFinite(measured.tailFps) && measured.tailFps > 0 ? measured.tailFps : measured.fps;
  const tailReference = Number.isFinite(measured.domAvg) ? measured.domAvg : reference;
  const alignedDelta = Math.abs(alignedFps - tailReference) / alignedFps;
  return {
    pass: wholeDelta <= tolerance || alignedDelta <= tolerance,
    detail: {
      independentRafFps: measured.fps,
      domAvgAllFps: measured.domAvgAllFps,
      domAllSamples: measured.domAllSamples,
      wholeWindowMs: measured.spanMs,
      wholeWindowFrames: measured.frames,
      wholeWindowDeltaPct: pct(wholeDelta),
      independentRafTailFps: measured.tailFps,
      domAvgFps: measured.domAvg,
      alignedTailWindowMs: measured.tailSpanMs,
      alignedTailFrames: measured.tailFrames,
      alignedDeltaPct: pct(alignedDelta),
      domLastFps: measured.domLast,
      tolerancePct: pct(tolerance),
      p50Ms: measured.p50Ms,
      p95Ms: measured.p95Ms,
      maxMs: measured.maxMs,
      perfSamples: measured.perfSamples,
      windowStable: measured.windowStable,
      method:
        '主判据：独立 rAF 计数 3s vs 同一 3s 窗口内 [data-fps] 采样均值（±15%）；' +
        '辅判据：对齐最后 1.5s 窗口。任一达标即 PASS，两项偏差都记录以便区分环境突发卡顿。',
    },
  };
}

/** Accuracy with one automatic retry, so a one-off stall from other agents'
 *  browsers doesn't turn a good reading into a failed verification. */
async function measureAccuracyWithRetry(readoutSelector, attempts = 2) {
  const runs = [];
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      console.log('[probe] accuracy retry #' + i + ' (environment noise from concurrent browser tests?)');
      notes.push('[environment] 准确性第一次未达标，已按 Lead 指示等待后重试一次（JSON 记录两轮数据）。');
      await sleep(2200);
    }
    const env = await waitQuietEnvironment(readoutSelector, 8000);
    const measured = await evalPage(pageMeasure, { durationMs: 3000, domSelector: readoutSelector, tailMs: 1500 }).then((r) =>
      r.ok ? r.result : null
    );
    const acc = checkAccuracy(measured, FPS_TOL);
    acc.detail.environment = env;
    runs.push({ attempt: i + 1, pass: acc.pass, measured, env, detail: acc.detail });
    if (acc.pass) break;
  }
  const winner = runs.find((r) => r.pass) || runs[runs.length - 1];
  const summary = runs.map((r) => ({
    attempt: r.attempt,
    pass: r.pass,
    independentRafFps: r.measured ? r.measured.fps : null,
    domAvgAllFps: r.measured ? r.measured.domAvgAllFps : null,
    wholeWindowDeltaPct: r.detail.wholeWindowDeltaPct,
    alignedDeltaPct: r.detail.alignedDeltaPct,
    p95Ms: r.measured ? r.measured.p95Ms : null,
    maxMs: r.measured ? r.measured.maxMs : null,
    envQuiet: r.env ? r.env.quiet : null,
  }));
  return {
    pass: winner.pass,
    detail: winner.detail,
    attempts: summary,
    attemptsUsed: runs.length,
    noiseAnnotated: runs.length > 1,
    measured: winner.measured,
  };
}

/**
 * Wait for a quiet sampling window before accuracy measurements. Three agents
 * sharing one GPU inflate frame-time variance; this pre-check records whether
 * the environment is contended so a >15% accuracy gap can be attributed.
 */
async function waitQuietEnvironment(pulseSelector, timeoutMs = 12000) {
  const startedAt = Date.now();
  const attempts = [];
  let best = null;
  while (Date.now() - startedAt < timeoutMs) {
    const pulse = await evalPage(pagePulse, 1200).then((r) => (r.ok ? r.result : null));
    if (!pulse) break;
    attempts.push(pulse);
    if (!best || (pulse.p95Ms ?? 9999) < (best.p95Ms ?? 9999)) best = pulse;
    const quiet = (pulse.p95Ms ?? 9999) <= 80 && (pulse.maxMs ?? 9999) <= 200 && pulse.fps >= 24;
    if (quiet) {
      stages.lastQuietCheck = { selector: pulseSelector, quiet: true, attempts, waitedMs: Date.now() - startedAt };
      return { quiet: true, pulse, best, attempts, waitedMs: Date.now() - startedAt };
    }
    await sleep(800);
  }
  const result = { quiet: false, pulse: best, best, attempts, waitedMs: Date.now() - startedAt };
  stages.lastQuietCheck = { selector: pulseSelector, ...result };
  notes.push(
    '[environment] 精度测量前未等到安静窗口：' +
      JSON.stringify({ fps: best ? best.fps : null, p50Ms: best ? best.p50Ms : null, p95Ms: best ? best.p95Ms : null, maxMs: best ? best.maxMs : null }) +
      '（三个 agent 共用 GPU 时可复现，读数/独立测速偏差会被放大）'
  );
  return result;
}

/** Wait until the frame-counter readout paints a sane number (warm-up). */
async function waitPerfWarm(readoutSelector, timeoutMs = 15000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    const r = await evalPage((sel) => {
      const el = document.querySelector(sel);
      const text = el ? el.textContent.trim() : null;
      const value = Number.parseFloat(text === null ? '' : text);
      const perf = window.__devUI && window.__devUI.perf;
      return {
        text,
        numeric: Number.isFinite(value) && value > 0,
        samples: perf ? perf.samples : null,
        fps: perf ? perf.fps : null,
        level: perf ? perf.level : null,
      };
    }, readoutSelector);
    last = r.ok ? r.result : { error: r.error };
    if (last && last.numeric && Number.isFinite(last.samples) && last.samples >= 8) {
      return { ok: true, ...last, waitedMs: Date.now() - startedAt };
    }
    await sleep(250);
  }
  return { ok: false, last, waitedMs: Date.now() - startedAt };
}

function analyseStability(raw, durationMs) {
  const samples = (raw && raw.samples) || [];
  const changes = (raw && raw.changes) || [];
  const classify = (sample) => {
    if (!sample || sample.text === null) return 'missing';
    const text = sample.text.trim();
    if (text === '' || text === '--' || text === '—' || text === '-') return 'placeholder';
    if (!Number.isFinite(sample.value)) return 'invalid';
    if (sample.value === 0) return 'zero';
    return 'numeric';
  };
  const codes = samples.map(classify);
  const runs = {};
  let run = null;
  for (let i = 0; i < samples.length; i++) {
    const code = codes[i];
    const t = samples[i].t;
    if (!run || run.code !== code) {
      if (run) runs[run.code] = runs[run.code] || [];
      run = { code, start: t, end: t, count: 1 };
      (runs[code] = runs[code] || []).push(run);
    } else {
      run.end = t;
      run.count++;
    }
  }
  const maxRunMs = (code) => {
    const list = runs[code] || [];
    return list.length ? Math.round(Math.max(...list.map((r) => r.end - r.start + 100))) : 0;
  };
  const counts = {};
  for (const code of ['numeric', 'placeholder', 'zero', 'invalid', 'missing']) {
    counts[code] = codes.filter((c) => c === code).length;
  }
  // perf.samples should keep growing during the whole stage.
  let perfFirst = null;
  let perfLast = null;
  for (const s of samples) {
    if (s.perf && Number.isFinite(s.perf.samples)) {
      if (perfFirst === null) perfFirst = s.perf.samples;
      perfLast = s.perf.samples;
    }
  }
  // Max [data-fps] text mutations in any sliding 1 s window.
  let maxChangesPerSecond = 0;
  for (let i = 0; i < changes.length; i++) {
    let j = i;
    while (j < changes.length && changes[j] - changes[i] < 1000) j++;
    maxChangesPerSecond = Math.max(maxChangesPerSecond, j - i);
  }
  // Environment sanity: if the render loop itself barely advanced during the
  // stage, long placeholder runs are machine contention (three agents sharing
  // one GPU) rather than a frame-counter defect.
  const stageDuration = Number.isFinite(durationMs) ? durationMs : raw ? raw.durationMs : null;
  const framesDelta =
    raw && Number.isFinite(raw.frames0) && Number.isFinite(raw.frames1) ? raw.frames1 - raw.frames0 : null;
  const avgFps = framesDelta !== null && stageDuration ? Math.round((framesDelta / (stageDuration / 1000)) * 10) / 10 : null;
  const environment = {
    framesDelta,
    durationMs: stageDuration,
    avgFpsFromRenderDebug: avgFps,
    suspectedContention: avgFps !== null && avgFps < 20,
  };
  return {
    durationMs: stageDuration,
    sampleCount: samples.length,
    counts,
    maxRunsMs: {
      placeholder: maxRunMs('placeholder'),
      zero: maxRunMs('zero'),
      invalid: maxRunMs('invalid'),
      missing: maxRunMs('missing'),
    },
    coverage: samples.length ? Math.round((counts.numeric / samples.length) * 1000) / 1000 : 0,
    perfSamples: { first: perfFirst, last: perfLast, delta: perfFirst !== null && perfLast !== null ? perfLast - perfFirst : null },
    environment,
    mutations: {
      totalChanges: changes.length,
      maxChangesPerSecond,
      windowMs: 1000,
      hardLimit: 30,
      firstChangeAtMs: changes.length ? changes[0] : null,
      lastChangeAtMs: changes.length ? changes[changes.length - 1] : null,
    },
    sampleErrors: (raw && raw.errors) || [],
    frames: { first: raw ? raw.frames0 : null, last: raw ? raw.frames1 : null },
    valuesTail: samples.slice(-8).map((s) => ({ t: s.t, text: s.text })),
  };
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------
async function stageContract() {
  const c = await contractSnapshot();
  stages.contract = c;
  if (c.error) {
    for (const id of ['contract-dom-hud', 'contract-dom-menu', 'contract-settings-buttons', 'contract-devui']) {
      record(id, '', false, { error: c.error });
    }
    return c;
  }

  const hudOk =
    c.hudPanel &&
    c.hudGet.fps &&
    c.hudGet.frameTime &&
    c.hudGet.state &&
    c.hudGet.graph &&
    ['good', 'fair', 'low'].includes(c.hudLevel);
  record('contract-dom-hud', '', hudOk, {
    hudPanel: c.hudPanel,
    hudGet: c.hudGet,
    hudLevel: c.hudLevel,
    hudTexts: c.hudTexts,
    graph: c.graph,
    warmup: perfWarmState,
  });

  const menuOk = c.menuPanel && c.menuGet.fps && c.menuGet.ms;
  record('contract-dom-menu', '', menuOk, { menuPanel: c.menuPanel, menuGet: c.menuGet, menuTexts: c.menuTexts, menuLevel: c.menuLevel });

  const scopes = c.fpsButtons.map((b) => b.scope);
  const buttonsOk =
    c.fpsButtons.length === 2 &&
    scopes.includes('menu') &&
    scopes.includes('pause') &&
    c.fpsButtons.every((b) => b.label !== null && b.pressed !== null);
  record('contract-settings-buttons', '', buttonsOk, {
    count: c.fpsButtons.length,
    buttons: c.fpsButtons,
    expectedCount: 2,
  });

  const p = c.devPerf;
  const devOk =
    c.devUI &&
    !!p &&
    Number.isFinite(p.fps) &&
    Number.isFinite(p.frameMs) &&
    Number.isFinite(p.worstMs) &&
    Number.isFinite(p.samples) &&
    ['good', 'fair', 'low'].includes(p.level) &&
    c.devSetShowFps === 'function';
  record('contract-devui', '', devOk, {
    devUI: c.devUI,
    devPerf: p,
    setShowFpsType: c.devSetShowFps,
    expectedPerfKeys: ['fps', 'frameMs', 'worstMs', 'samples', 'level'],
  });
  return c;
}

async function stageMenu() {
  const st = await currentState();
  const vis = await visibilityOf('[data-menu-perf]');
  const c = await contractSnapshot();
  const menuFps = Number.parseFloat(c.menuTexts ? c.menuTexts.fps : '');
  const visibleOk = !vis.hidden && Number.isFinite(menuFps) && menuFps >= 5 && menuFps <= 300;
  record('default-menu-visible', '', visibleOk, {
    state: st.state,
    visibility: vis,
    menuTexts: c.menuTexts,
    menuLevel: c.menuLevel,
    devPerf: c.devPerf,
    range: [5, 300],
  });

  if (!c.menuPanel) {
    record('acc-menu-value', '', false, { reason: '[data-menu-perf] missing' });
  } else {
    const acc = await measureAccuracyWithRetry('[data-menu-fps]', 2);
    measurements.menuAccuracy = acc.measured;
    measurements.menuAccuracyAttempts = acc.attempts;
    record('acc-menu-value', '', acc.pass, {
      ...acc.detail,
      attempts: acc.attempts,
      attemptsUsed: acc.attemptsUsed,
      noiseAnnotated: acc.noiseAnnotated,
    });
  }

  const layout = await captureLayout('fps-menu-1600x900.png', '[data-menu-fps]');
  const check = checkLayout(layout.report, 'menu', layout.file, '1600x900', layout.readout);
  record('layout-menu-1600x900', '', check.pass, check.detail);
  measurements.menuLayout = layout;
  return { vis, layout };
}

async function stageGameplay() {
  const started = await realStart();
  stages.start = started;
  if (!started.ok) {
    record('default-hud-visible', '', false, { reason: 'failed to enter playing state', started });
    record('default-hud-refresh', '', false, { reason: 'failed to enter playing state', started });
    record('acc-game-value', '', false, { reason: 'failed to enter playing state', started });
    record('acc-fps-ms-ratio', '', false, { reason: 'failed to enter playing state', started });
    record('acc-perf-dom-sync', '', false, { reason: 'failed to enter playing state', started });
    record('loop-frames-growth', '', false, { reason: 'failed to enter playing state', started });
    record('loop-render-once', '', false, { reason: 'failed to enter playing state', started });
    return { started };
  }

  // Spawn wave 1 so the measurement / screenshot happen in real gameplay.
  await evalPage(() => {
    const s = window.__sandstrike;
    if (!s) return { supported: false };
    s.player.godMode = true;
    try {
      s.fastForward(4.2);
    } catch (error) {
      return { supported: true, error: String(error) };
    }
    return { supported: true };
  });
  await sleep(1200);

  // Accuracy is checked first (before screenshots / heavy interaction) on a
  // freshly started run, in the same order the Lead requested.
  const acc = await measureAccuracyWithRetry('[data-fps]', 2);
  measurements.gameAccuracy = acc.measured;
  measurements.gameAccuracyAttempts = acc.attempts;
  record('acc-game-value', '', acc.pass, {
    ...acc.detail,
    attempts: acc.attempts,
    attemptsUsed: acc.attemptsUsed,
    noiseAnnotated: acc.noiseAnnotated,
  });

  const hudVis = await visibilityOf('[data-perf]');
  const hudRootVis = await visibilityOf('.hud');
  record('default-hud-visible', '', !hudVis.hidden && hudRootVis.hidden === false, {
    perfVisibility: hudVis,
    hudVisibility: hudRootVis,
    state: (await currentState()).state,
  });

  const refresh = await evalPage(pageRefreshProbe, 1500);
  const refreshData = refresh.ok ? refresh.result : { target: false, error: refresh.error };
  const refreshOk =
    refreshData.target &&
    (refreshData.changed === true ||
      (Number.isFinite(refreshData.mutations) && refreshData.mutations > 0) ||
      (Number.isFinite(refreshData.perfDelta) && refreshData.perfDelta > 0));
  record('default-hud-refresh', '', refreshOk, refreshData);

  const ratioWarm = await waitPerfWarm('[data-fps]', 10000);
  if (!ratioWarm.ok) notes.push('[environment] 游戏内读数在 10s 内未预热到数字，ratio/perf-dom 检查记录现场值。');
  const c = await contractSnapshot();
  const domFps = Number.parseFloat(c.hudTexts ? c.hudTexts.fps : '');
  const domMs = Number.parseFloat(c.hudTexts ? c.hudTexts.frameTime : '');
  const product = domFps * domMs;
  const ratioDelta = Number.isFinite(product) ? Math.abs(product / 1000 - 1) : null;
  record('acc-fps-ms-ratio', '', Number.isFinite(product) && ratioDelta <= 0.2, {
    domFps,
    domFrameMs: domMs,
    fpsTimesFrameMs: Number.isFinite(product) ? Math.round(product * 10) / 10 : null,
    target: 1000,
    deltaPct: pct(ratioDelta),
    tolerancePct: 20,
    perf: c.devPerf,
  });

  const p = c.devPerf;
  const syncOk =
    !!p &&
    Number.isFinite(p.fps) &&
    Number.isFinite(p.frameMs) &&
    Number.isFinite(p.samples) &&
    p.samples > 0 &&
    Number.isFinite(domFps) &&
    Number.isFinite(domMs) &&
    Math.abs(p.fps - domFps) <= Math.max(3, domFps * 0.12) &&
    Math.abs(p.frameMs - domMs) <= Math.max(1.5, domMs * 0.12);
  const samplesGrowing = Number.isFinite(p && p.samples) && p.samples > 10;
  record('acc-perf-dom-sync', '', syncOk && samplesGrowing, {
    devPerf: p,
    domFps,
    domMs,
    hudLevel: c.hudLevel,
    perfLevel: p ? p.level : null,
    samplesGrowing,
    tolerances: { fpsAbsOrPct: 'max(3, 12%)', frameMsAbsOrPct: 'max(1.5, 12%)' },
  });

  // Layout + screenshot in gameplay at 1600×900.
  const layout = await captureLayout('fps-game-1600x900.png', '[data-fps]');
  const check = checkLayout(layout.report, 'game', layout.file, '1600x900', layout.readout);
  record('layout-game-1600x900', '', check.pass, check.detail);
  measurements.gameLayout = layout;

  // Panel width should match the radar panel (contract: width var(--radar)).
  const widthDelta = layout.report ? layout.report.radarWidthDelta : null;
  notes.push(
    Number.isFinite(widthDelta)
      ? `[layout] [data-perf] 宽度与雷达宽度差 ${widthDelta}px（契约要求一致，仅供参考）`
      : '[layout] 无法比较 [data-perf] 与雷达宽度'
  );
  return { started, accuracy: acc };
}

async function stageStability() {
  const playing = await ensurePlaying();
  stages.stabilityHarness = playing;
  if (!playing.ok) {
    for (const id of ['stab-actions', 'stab-numeric', 'stab-mutation-rate', 'stab-hud-nodes', 'stab-console-clean']) {
      record(id, '', false, { reason: 'not in playing state', state: playing });
    }
    return { skipped: true, reason: playing };
  }

  const target = await evalPage(() => !!document.querySelector('[data-fps]'));
  if (!target.ok || !target.result) {
    for (const id of ['stab-actions', 'stab-numeric', 'stab-mutation-rate', 'stab-hud-nodes', 'stab-console-clean']) {
      record(id, '', false, { reason: '[data-fps] missing — cannot run 15s stability stage' });
    }
    measurements.stability = { skipped: true, reason: '[data-fps] missing' };
    return { skipped: true };
  }

  await evalPage(() => {
    const s = window.__sandstrike;
    if (!s) return { supported: false };
    s.player.godMode = true;
    try {
      s.fastForward(3.0);
    } catch (_) { /* best effort */ }
    return { supported: true };
  });
  await sleep(1300); // warm up samples so the display is numeric before we start

  await evalPage(pageStartSampler);
  const errorsBefore = consoleErrors.length;
  const actions = [];
  const startedAt = Date.now();
  const action = async (label, fn) => {
    try {
      const value = await fn();
      actions.push({ label, atMs: Date.now() - startedAt, ok: true, value });
    } catch (error) {
      actions.push({ label, atMs: Date.now() - startedAt, ok: false, error: String(error?.message || error) });
    }
  };
  const fire = (count) =>
    evalPage((n) => {
      const s = window.__sandstrike;
      if (!s || !s.weapon) return { supported: false };
      let fired = 0;
      for (let i = 0; i < n; i++) {
        s.weapon.fireCooldown = 0;
        s.weapon.mag = Math.max(6, s.weapon.mag);
        try {
          s.weapon.tryFire();
          fired++;
        } catch (error) {
          return { supported: true, fired, error: String(error) };
        }
        try {
          s.fastForward(0.06);
        } catch (_) { /* best effort */ }
      }
      return { supported: true, fired, shotsFired: s.weapon.shotsFired };
    }, count).then((r) => (r.ok ? r.result : { error: r.error }));

  await action('fire-burst-1', () => fire(10));
  await sleep(1100);
  await action('fire-burst-2', () => fire(10));
  await sleep(1100);
  await action('pause', () => ensurePaused());
  await sleep(1200);
  await action('resume', () => ensurePlaying());
  await sleep(1100);
  await action('fastForward-10', () =>
    evalPage(() => {
      const s = window.__sandstrike;
      if (!s || typeof s.fastForward !== 'function') return { supported: false };
      s.player.godMode = true;
      return { supported: true, result: s.fastForward(10) };
    }).then((r) => (r.ok ? r.result : { error: r.error }))
  );
  await sleep(1600);
  await action('freeze', () => evalPage(() => window.__sandstrike && window.__sandstrike.freeze && window.__sandstrike.freeze(true)));
  await sleep(1000);
  await action('unfreeze', () => evalPage(() => window.__sandstrike && window.__sandstrike.freeze && window.__sandstrike.freeze(false)));
  await sleep(900);
  await action('fire-burst-3', () => fire(12));
  await sleep(1100);
  await action('kill-all', () =>
    evalPage(() => {
      const s = window.__sandstrike;
      if (!s) return { supported: false };
      const killed = typeof s.killAll === 'function' ? s.killAll() : 0;
      try {
        s.fastForward(0.5);
      } catch (_) { /* best effort */ }
      return { supported: true, killed };
    }).then((r) => (r.ok ? r.result : { error: r.error }))
  );
  while (Date.now() - startedAt < STABILITY_MS) await sleep(350);
  const durationMs = Date.now() - startedAt;

  const raw = await evalPage(pageStopSampler);
  const data = raw.ok ? raw.result : { error: raw.error, samples: [], changes: [] };
  const analysis = analyseStability(data, durationMs);
  const errorsDuring = annotateErrors(consoleErrors.slice(errorsBefore));
  analysis.newConsoleErrors = errorsDuring;
  measurements.stability = analysis;
  measurements.stabilityActions = actions;

  const actionsOk =
    actions.length >= 8 &&
    actions.every((a) => a.ok) &&
    actions.some((a) => a.label.startsWith('fire') && a.value && Number(a.value.fired) > 0) &&
    actions.some((a) => a.label === 'pause' && a.value && a.value.ok) &&
    actions.some((a) => a.label === 'resume' && a.value && a.value.ok);
  record('stab-actions', '', actionsOk, {
    durationMs,
    actionCount: actions.length,
    actions,
    note: 'fire 走 weapon.tryFire()（真实鼠标开火在 headless pointer-lock 下不稳定，影响面等价于 HUD/反馈路径）',
  });

  const numericOk =
    analysis.sampleCount > 0 &&
    analysis.counts.invalid === 0 &&
    analysis.counts.missing === 0 &&
    analysis.counts.numeric >= analysis.sampleCount * 0.8 &&
    analysis.maxRunsMs.placeholder <= 1500 &&
    analysis.maxRunsMs.zero <= 2000;
  record('stab-numeric', '', numericOk, {
    counts: analysis.counts,
    coverage: analysis.coverage,
    maxRunsMs: analysis.maxRunsMs,
    limits: { placeholdersMaxRunMs: 1500, zeroMaxRunMs: 2000 },
    perfSamples: analysis.perfSamples,
    valuesTail: analysis.valuesTail,
    environment: analysis.environment,
  }, numericOk ? '' : analysis.environment.suspectedContention ? '环境争用嫌疑：该 15s 内渲染循环自身仅约 ' + analysis.environment.avgFpsFromRenderDebug + ' fps' : '');

  const mutationOk = analysis.mutations.totalChanges > 0 && analysis.mutations.maxChangesPerSecond <= 30;
  record('stab-mutation-rate', '', mutationOk, { ...analysis.mutations, environment: analysis.environment });

  const hudNodes = await evalPage(pageHudNodes);
  const nodes = hudNodes.ok ? hudNodes.result : { nodes: {}, error: hudNodes.error };
  const required = ['radar', 'radarCanvas', 'wave', 'waveCurrent', 'health', 'armor', 'ammo', 'score', 'crosshair'];
  const missing = required.filter((key) => !nodes.nodes[key] || !nodes.nodes[key].exists);
  const invisible = required.filter((key) => nodes.nodes[key] && nodes.nodes[key].exists && !nodes.nodes[key].visible);
  record('stab-hud-nodes', '', missing.length === 0 && invisible.length === 0, {
    state: nodes.state,
    missing,
    invisible,
    nodes: nodes.nodes,
  });

  record('stab-console-clean', '', errorsDuring.length === 0, {
    newErrors: errorsDuring,
    totalErrors: consoleErrors.length,
  });

  return { analysis };
}

async function stageLoop() {
  const playing = await ensurePlaying();
  // Sample two consecutive windows: the main rAF loop must keep advancing even
  // when the machine is loaded (a single short window can be distorted by a GC
  // or compositor stall from other agents sharing the GPU).
  const f0 = await evalPage(() => (window.__renderDebug ? window.__renderDebug.frames : null));
  await sleep(800);
  const f1 = await evalPage(() => (window.__renderDebug ? window.__renderDebug.frames : null));
  await sleep(800);
  const f2 = await evalPage(() => (window.__renderDebug ? window.__renderDebug.frames : null));
  const a = f0.ok ? f0.result : null;
  const b = f1.ok ? f1.result : null;
  const c = f2.ok ? f2.result : null;
  const monotonic = Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && b > a && c > b;
  const totalDelta = Number.isFinite(a) && Number.isFinite(c) ? c - a : null;
  record('loop-frames-growth', '', monotonic && Number.isFinite(totalDelta) && totalDelta >= 5, {
    state: playing.state,
    frames0: a,
    frames1: b,
    frames2: c,
    totalDelta,
    windowMs: 1600,
    minimumTotalDelta: 5,
    monotonic,
  });

  const render = await evalPage(() => {
    const s = window.__sandstrike;
    if (!s || typeof s.renderOnce !== 'function') return { supported: false };
    try {
      const out = s.renderOnce();
      return {
        supported: true,
        calls: out ? out.calls : null,
        triangles: out ? out.triangles : null,
        weaponActive: out ? out.weaponActive : null,
      };
    } catch (error) {
      return { supported: true, error: String(error) };
    }
  });
  const r = render.ok ? render.result : { supported: false, error: render.error };
  const loopOk = r.supported && !r.error && Number.isFinite(r.calls) && r.calls > 0;
  record('loop-render-once', '', loopOk, r);
  measurements.loop = { frames: { frames0: a, frames1: b, frames2: c, totalDelta, monotonic }, renderOnce: r };
  stages.loop = { playing, render: r };
}

async function stageToggles() {
  const back = await goToMenu();
  stages.toggles = { back };
  if (!back.ok) {
    record('toggle-menu-off', '', false, { reason: 'failed to reach menu', back });
    return { failed: true, back };
  }

  const buttons = await evalPage(() => Array.from(document.querySelectorAll('button[data-action="fps"]')).length);
  if (!buttons.ok || buttons.result < 2) {
    for (const id of [
      'toggle-menu-off',
      'toggle-persist-click-reload',
      'toggle-hud-hidden',
      'toggle-f3-on',
      'toggle-pause-off',
      'toggle-pause-on',
      'toggle-f3-off',
      'toggle-persist-f3-off-reload',
      'toggle-f3-on-menu',
      'toggle-persist-f3-on-reload',
      'contract-set-show-fps',
    ]) {
      record(id, '', false, { reason: `expected 2 [data-action="fps"] buttons, found ${buttons.ok ? buttons.result : 0}` });
    }
    return { failed: true, reason: 'fps buttons missing' };
  }

  // ---- 1) Menu SYSTEM CONFIG -> FRAME COUNTER off -------------------------
  const initialSnap = await toggleSnapshot();
  const clickOff = await clickFpsButton('.screen--menu');
  const snapOff = await toggleSnapshot();
  const visMenuOff = await visibilityOf('[data-menu-perf]');
  const menuBtnOff = snapOff.buttons.find((b) => b.scope === 'menu');
  const pauseBtnOff = snapOff.buttons.find((b) => b.scope === 'pause');
  const offOk =
    clickOff.ok &&
    snapOff.isFpsOff === true &&
    !!menuBtnOff &&
    menuBtnOff.pressed === 'false' &&
    menuBtnOff.label === 'HIDDEN' &&
    !!pauseBtnOff &&
    pauseBtnOff.pressed === 'false' &&
    pauseBtnOff.label === 'HIDDEN' &&
    snapOff.storage &&
    snapOff.storage.showFps === false &&
    visMenuOff.hidden === true;
  record('toggle-menu-off', '', offOk, {
    initial: { isFpsOff: initialSnap.isFpsOff, buttons: initialSnap.buttons, storage: initialSnap.storage },
    click: clickOff,
    snapshot: snapOff,
    menuReadout: visMenuOff,
    checks: {
      uiRootIsFpsOff: snapOff.isFpsOff === true,
      bothButtonsPressedFalse: [menuBtnOff, pauseBtnOff].every((b) => b && b.pressed === 'false'),
      labelsHidden: [menuBtnOff, pauseBtnOff].every((b) => b && b.label === 'HIDDEN'),
      storageShowFpsFalse: snapOff.storage && snapOff.storage.showFps === false,
      menuReadoutHidden: visMenuOff.hidden === true,
    },
  });
  measurements.toggleOff = { snapOff, visMenuOff, clickOff };

  // ---- 2) Reload persistence of the click toggle --------------------------
  const reload1 = await reloadAndWait();
  const snapReloadOff = await toggleSnapshot();
  const visReloadMenuOff = await visibilityOf('[data-menu-perf]');
  const reloadOffOk =
    reload1.ok &&
    snapReloadOff.isFpsOff === true &&
    snapReloadOff.buttons.length === 2 &&
    snapReloadOff.buttons.every((b) => b.pressed === 'false' && b.label === 'HIDDEN') &&
    snapReloadOff.storage &&
    snapReloadOff.storage.showFps === false &&
    visReloadMenuOff.hidden === true;
  record('toggle-persist-click-reload', '', reloadOffOk, { reload: reload1, snapshot: snapReloadOff, menuReadout: visReloadMenuOff });

  // ---- 3) Off state -> start game -> HUD readout must stay hidden ---------
  const offStart = await realStart();
  const hudReveal = await waitVisible('.hud', 4000);
  const hudVisOff = await visibilityOf('.hud');
  const perfVisOff = await visibilityOf('[data-perf]');
  const cOff = await contractSnapshot();
  record('toggle-hud-hidden', '', offStart.ok && hudReveal.ok && hudVisOff.hidden === false && perfVisOff.hidden === true, {
    start: offStart,
    hudReveal,
    hudVisibility: hudVisOff,
    perfVisibility: perfVisOff,
    classIsFpsOff: cOff.uiRootIsFpsOff,
    state: cOff.state,
  });

  // ---- 4) F3 -> on while playing -----------------------------------------
  const f3On = await toggleF3();
  const snapOn = await toggleSnapshot();
  const visPerfOn = await visibilityOf('[data-perf]');
  const cOn = await contractSnapshot();
  const onBtnOk = snapOn.buttons.length === 2 && snapOn.buttons.every((b) => b.pressed === 'true' && b.label === 'VISIBLE');
  const f3OnOk =
    f3On.changed === true &&
    snapOn.isFpsOff === false &&
    onBtnOk &&
    snapOn.storage &&
    snapOn.storage.showFps === true &&
    visPerfOn.hidden === false &&
    Number.isFinite(Number.parseFloat(cOn.hudTexts.fps));
  record('toggle-f3-on', '', f3OnOk, {
    f3: f3On,
    snapshot: snapOn,
    hudReadout: visPerfOn,
    hudTexts: cOn.hudTexts,
    checks: { buttonsVisibleLabels: onBtnOk, storageTrue: snapOn.storage && snapOn.storage.showFps === true },
  });
  measurements.toggleOn = { f3On, snapOn, visPerfOn };

  // ---- 5) Pause panel: toggle off / on + cross-panel sync ----------------
  const paused = await ensurePaused();
  await sleep(600);
  const snapPausedBefore = await toggleSnapshot();
  const clickPauseOff = await clickFpsButton('.screen--pause');
  const snapPauseOff = await toggleSnapshot();
  const hudVisPaused = await visibilityOf('.hud');
  const perfVisPausedOff = await visibilityOf('[data-perf]');
  const pauseBtnAfterOff = snapPauseOff.buttons.find((b) => b.scope === 'pause');
  const menuBtnAfterOff = snapPauseOff.buttons.find((b) => b.scope === 'menu');
  const pauseOffOk =
    paused.ok &&
    clickPauseOff.ok &&
    snapPauseOff.isFpsOff === true &&
    pauseBtnAfterOff &&
    pauseBtnAfterOff.pressed === 'false' &&
    snapPauseOff.buttons.every((b) => b.pressed === 'false' && b.label === 'HIDDEN') &&
    snapPauseOff.storage &&
    snapPauseOff.storage.showFps === false &&
    hudVisPaused.hidden === false &&
    perfVisPausedOff.hidden === true &&
    menuBtnAfterOff &&
    menuBtnAfterOff.pressed === 'false';
  record('toggle-pause-off', '', pauseOffOk, {
    pause: paused,
    click: clickPauseOff,
    snapshotBefore: snapPausedBefore,
    snapshot: snapPauseOff,
    hudVisibility: hudVisPaused,
    perfVisibility: perfVisPausedOff,
    crossPanelSync: { pause: pauseBtnAfterOff, menu: menuBtnAfterOff },
  });

  const clickPauseOn = await clickFpsButton('.screen--pause');
  const snapPauseOn = await toggleSnapshot();
  const perfVisPausedOn = await visibilityOf('[data-perf]');
  const pauseOnOk =
    clickPauseOn.ok &&
    snapPauseOn.isFpsOff === false &&
    snapPauseOn.buttons.length === 2 &&
    snapPauseOn.buttons.every((b) => b.pressed === 'true' && b.label === 'VISIBLE') &&
    snapPauseOn.storage &&
    snapPauseOn.storage.showFps === true &&
    perfVisPausedOn.hidden === false;
  record('toggle-pause-on', '', pauseOnOk, {
    click: clickPauseOn,
    snapshot: snapPauseOn,
    perfVisibility: perfVisPausedOn,
  });

  // ---- 6) F3 off while paused + reload persistence ----------------------
  const f3Off = await toggleF3();
  const snapF3Off = await toggleSnapshot();
  const perfVisF3Off = await visibilityOf('[data-perf]');
  record('toggle-f3-off', '', f3Off.changed && snapF3Off.isFpsOff === true && perfVisF3Off.hidden === true && snapF3Off.storage && snapF3Off.storage.showFps === false, {
    f3: f3Off,
    snapshot: snapF3Off,
    perfVisibility: perfVisF3Off,
  });

  const reload2 = await reloadAndWait();
  const snapReload2 = await toggleSnapshot();
  const visMenuAfterReload2 = await visibilityOf('[data-menu-perf]');
  record(
    'toggle-persist-f3-off-reload',
    '',
    reload2.ok &&
      snapReload2.isFpsOff === true &&
      snapReload2.buttons.length === 2 &&
      snapReload2.buttons.every((b) => b.pressed === 'false' && b.label === 'HIDDEN') &&
      snapReload2.storage &&
      snapReload2.storage.showFps === false &&
      visMenuAfterReload2.hidden === true,
    { reload: reload2, snapshot: snapReload2, menuReadout: visMenuAfterReload2 }
  );

  // ---- 7) F3 on in menu, visible + reload persistence -------------------
  const f3OnMenu = await toggleF3();
  const snapMenuOn = await toggleSnapshot();
  const visMenuOn = await visibilityOf('[data-menu-perf]');
  const menuFpsAfterF3 = Number.parseFloat((await contractSnapshot()).menuTexts.fps);
  record(
    'toggle-f3-on-menu',
    '',
    f3OnMenu.changed &&
      snapMenuOn.isFpsOff === false &&
      snapMenuOn.buttons.length === 2 &&
      snapMenuOn.buttons.every((b) => b.pressed === 'true' && b.label === 'VISIBLE') &&
      snapMenuOn.storage &&
      snapMenuOn.storage.showFps === true &&
      visMenuOn.hidden === false &&
      Number.isFinite(menuFpsAfterF3),
    { f3: f3OnMenu, snapshot: snapMenuOn, menuReadout: visMenuOn, menuFps: menuFpsAfterF3 }
  );

  const reload3 = await reloadAndWait();
  const snapReload3 = await toggleSnapshot();
  const visMenuAfterReload3 = await visibilityOf('[data-menu-perf]');
  const menuFpsAfterReload3 = Number.parseFloat((await contractSnapshot()).menuTexts.fps);
  record(
    'toggle-persist-f3-on-reload',
    '',
    reload3.ok &&
      snapReload3.isFpsOff === false &&
      snapReload3.buttons.length === 2 &&
      snapReload3.buttons.every((b) => b.pressed === 'true' && b.label === 'VISIBLE') &&
      snapReload3.storage &&
      snapReload3.storage.showFps === true &&
      visMenuAfterReload3.hidden === false &&
      Number.isFinite(menuFpsAfterReload3),
    { reload: reload3, snapshot: snapReload3, menuReadout: visMenuAfterReload3, menuFps: menuFpsAfterReload3 }
  );

  // ---- 8) Programmatic __devUI.setShowFps(bool) -------------------------
  const setProg = await evalPage(() => {
    const ui = window.__devUI;
    const root = document.getElementById('ui');
    if (!ui || typeof ui.setShowFps !== 'function') return { supported: false };
    ui.setShowFps(false);
    const offClass = root.classList.contains('is-fps-off');
    const menuEl = document.querySelector('[data-menu-perf]');
    const offDisplay = menuEl ? getComputedStyle(menuEl).display : null;
    const offVisibility = menuEl ? getComputedStyle(menuEl).visibility : null;
    ui.setShowFps(true);
    const onClass = root.classList.contains('is-fps-off');
    const onDisplay = menuEl ? getComputedStyle(menuEl).display : null;
    return { supported: true, offClass, offDisplay, offVisibility, onClass, onDisplay };
  });
  const prog = setProg.ok ? setProg.result : { supported: false, error: setProg.error };
  record('contract-set-show-fps', '', prog.supported && prog.offClass === true && prog.onClass === false, prog);
  measurements.setShowFps = prog;

  stages.toggles.done = true;
  return { ok: true };
}

async function stageSmallLayout() {
  try {
    await page.setViewportSize(VIEW_SMALL);
  } catch (error) {
    stageErrors.push({ kind: 'setViewportSize', error: String(error?.message || error) });
  }
  await sleep(1000);
  let st = await currentState();
  if (st.state !== 'menu') {
    const back = await goToMenu();
    stages.smallLayoutMenuFallback = back;
  }
  await waitMenu(30000).catch(() => false);
  await sleep(500);

  const menu = await captureLayout('fps-menu-1280x720.png', '[data-menu-fps]');
  const menuCheck = checkLayout(menu.report, 'menu', menu.file, '1280x720', menu.readout);
  record('layout-menu-1280x720', '', menuCheck.pass, menuCheck.detail);
  measurements.smallMenuLayout = menu;

  const started = await realStart();
  if (!started.ok) {
    record('layout-game-1280x720', '', false, { reason: 'failed to start at 1280x720', started, menu: menuCheck.detail });
    return;
  }
  await evalPage(() => {
    const s = window.__sandstrike;
    if (!s) return;
    s.player.godMode = true;
    try {
      s.fastForward(3.5);
    } catch (_) { /* best effort */ }
  });
  await sleep(1100);
  const game = await captureLayout('fps-game-1280x720.png', '[data-fps]');
  const gameCheck = checkLayout(game.report, 'game', game.file, '1280x720', game.readout);
  record('layout-game-1280x720', '', gameCheck.pass, gameCheck.detail);
  measurements.smallGameLayout = game;
  stages.smallLayout = { started };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let bootInfo = null;
try {
  console.log(`[probe] SANDSTRIKE FPS black-box probe`);
  console.log(`[probe] url=${PAGE_URL}`);
  console.log(`[probe] stabilityMs=${STABILITY_MS} tolerance=±${Math.round(FPS_TOL * 100)}%`);

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
  // Clear settings exactly once (first navigation) so the default-on state can
  // be asserted while still allowing later navigations to test persistence.
  await context.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('__fpsProbeInit')) {
        localStorage.clear();
        sessionStorage.setItem('__fpsProbeInit', '1');
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

  bootInfo = await bootToMenu();
  stages.boot = bootInfo;
  if (!bootInfo.ok) {
    notes.push(
      '[blocker] 页面未能加载到菜单；可能是并发移动端改动造成的临时语法错误（已按 Lead 指示重试）。' +
        ' 该失败不能归因于 FPS 功能。'
    );
  } else {
    perfWarmState = await waitPerfWarm('[data-menu-fps]', 15000);
    stages.perfWarm = perfWarmState;
    if (!perfWarmState.ok) notes.push('[environment] 菜单读数在 15s 内未预热到数字（争用或实现问题），契约/准确性检查将记录现场值。');
    await stageContract();
    const menuStage = await stageMenu();
    const gameStage = await stageGameplay();
    await stageStability();
    await stageLoop();
    await stageToggles();
    await stageSmallLayout();
    stages.menuStage = menuStage;
    stages.gameStage = gameStage;
  }
} catch (error) {
  const message = String(error?.stack || error?.message || error);
  stageErrors.push({ kind: 'fatal', error: message });
  console.error('[probe] FATAL:', message);
} finally {
  // Record the global console-error check before finalizing.
  const annotated = annotateErrors(consoleErrors);
  record('no-console-errors', '', consoleErrors.length === 0, {
    count: consoleErrors.length,
    errors: annotated.slice(0, 30),
    note:
      consoleErrors.length > 0
        ? '若错误来自并发移动端改动，请在归因时标注 [unrelated concurrent change]'
        : '零 console error / pageerror',
  });

  // Any expected check that was never reached is a FAIL.
  for (const [id, name] of EXPECTED) {
    if (!recordedIds.has(id)) record(id, name, false, { reason: '未执行（探针提前结束或依赖缺失）' });
  }

  const failIds = results.filter((r) => !r.pass).map((r) => r.id);
  const payload = {
    probe: 'sandstrike-fps-probe',
    version: 1,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    url: PAGE_URL,
    query: QUERY,
    environment: {
      chrome: CHROME,
      headless: true,
      gpuArgs: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
      viewports: [VIEW_BIG, VIEW_SMALL],
      tolerancePct: Math.round(FPS_TOL * 100),
      stabilityMs: STABILITY_MS,
      note: 'query 强制 touch=0 以隔离并发移动端改动对桌面布局断言的影响',
    },
    summary: {
      total: results.length,
      pass: results.length - failIds.length,
      fail: failIds.length,
      verdict: failIds.length === 0 ? 'PASS' : 'FAIL',
      failIds,
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
    await writeFile(`${OUT_DIR}/fps-probe.json`, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`\n[probe] wrote shots/fps-probe.json (${results.length} checks, ${failIds.length} FAIL)`);
  } catch (error) {
    console.error('[probe] failed to write JSON:', error);
  }
  if (failures.length) {
    console.log('[probe] FAILED checks:');
    for (const row of failures) console.log(`  - ${row.id}: ${row.name}`);
  } else {
    console.log('[probe] ALL CHECKS PASSED');
  }
  if (browser) await browser.close().catch(() => {});
  process.exitCode = failures.length ? 1 : 0;
}
