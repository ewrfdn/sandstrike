/**
 * SANDSTRIKE gamepad / controller QA harness — GAMEPAD_SPEC.md §8.
 *
 *   node scripts/gamepad-probe.mjs [url]
 *
 * Black-box Playwright probe against the already-running local server (default
 * http://127.0.0.1:8080). It injects a fake standard-mapping pad whose
 * vibrationActuator records every rumble pulse into `window.__rumbleLog` (exact
 * init script from §8), drives it through the gamepad dev hook and asserts the
 * 13 required groups, writes shots/gamepad-probe.json plus the seven fresh
 * shots/gamepad-*.png screenshots and exits 1 on any failure.
 *
 * Determinism note (recorded in the JSON): the page runs under SwiftShader,
 * where a 1600×900 frame can take ~1 s. Gameplay groups therefore advance the
 * simulation with the `window.__sandstrike.fastForward()` dev hook, which the
 * Lead wired to call `gamepad.update(dt)` on every 1/30 s tick (§5.5), and UI
 * transitions (CSS classes, pauses, notices) are polled for real time instead
 * of asserting immediately.
 *
 * Screenshots are captured in a DPR 1 context: the desktop HUD has no DPR-
 * dependent layout and the spec allows a lower-DPR capture context; a DPR 3
 * 1600×900 software composite would drop the probe to <1 fps (see
 * scripts/mobile-qa.mjs's note for the same trade-off).
 */
import { chromium } from 'playwright-core';
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const URL_BASE = (process.argv[2] || process.env.GAMEPAD_QA_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = resolve('shots');
const DESKTOP = { width: 1600, height: 900 };
const MOBILE = { width: 844, height: 390 };
const KEYBOARD_VIEW = { width: 1280, height: 720 };
const DPR = 1;
const QUERY = 'dev=1&quality=medium';
const TOUCH_QUERY = 'dev=1&quality=medium&touch=1';
const BOOT_TIMEOUT = 240_000;
const GROUP_TIMEOUT = 120_000;
const SHOT_NAMES = [
  'gamepad-01-menu.png',
  'gamepad-02-deploy.png',
  'gamepad-03-playing.png',
  'gamepad-04-ads.png',
  'gamepad-05-paused.png',
  'gamepad-06-settings.png',
  'gamepad-07-mobile-pad.png',
];
/** Constants mirrored from src/config.js / GAMEPAD_SPEC.md §3.4 (asserted, not imported). */
const WALK_SPEED = 4.7;
const SPRINT_SPEED = 7.3;
const MAX_PITCH = Math.PI / 2 - 0.03;
/** SwiftShader launch flags, copied verbatim from scripts/qa.mjs. */
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

await mkdir(OUT, { recursive: true });
// Drop stale captures from earlier runs so group 13 can only pass on fresh ones.
for (const name of SHOT_NAMES) await rm(join(OUT, name), { force: true }).catch(() => {});

const T0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const elapsed = () => Date.now() - T0;

const qa = {
  ok: false,
  url: URL_BASE,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  durationMs: 0,
  env: {
    chrome: CHROME,
    desktop: DESKTOP,
    mobile: MOBILE,
    keyboardReference: KEYBOARD_VIEW,
    deviceScaleFactor: DPR,
    padQuery: QUERY,
    touchPadQuery: TOUCH_QUERY,
    note: 'fake pad = GAMEPAD_SPEC.md §8 init script; gameplay advances via fastForward (gamepad.update wired in), UI waits are polled real time; screenshots captured at DPR 1 (spec allows a lower-DPR capture context).',
  },
  thresholds: {
    walkSpeed: WALK_SPEED,
    sprintSpeed: SPRINT_SPEED,
    distanceTolerance: 0.2,
    walkDeadzoneMaxMove: 0.05,
    adsOn: 0.8,
    adsOff: 0.2,
    adsLookRatioMax: 0.7,
    maxPitch: +MAX_PITCH.toFixed(4),
    note: 'all §8 numbers kept as written; tolerances exist only where SwiftShader/fake-pad quantisation is physically noisy',
  },
  groups: [],
  screenshots: {},
  screenshotInfo: {},
  consoleErrors: { pad: [], mobile: [], keyboard: [] },
  consoleWarnings: { pad: [], mobile: [], keyboard: [] },
  errors: [],
  timings: {},
  notes: [],
  fatal: null,
};

class Failure extends Error {}
const fail = (message) => { throw new Failure(message); };
const expect = (condition, message) => { if (!condition) fail(message); };

function fmt(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(+value.toFixed(3));
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 150 ? `${text.slice(0, 147)}…` : text;
  } catch {
    return String(value);
  }
}

async function withTimeout(promise, ms, label) {
  let timer = 0;
  // Guard the losing promise so a late rejection can never crash the process.
  const guarded = Promise.resolve(promise);
  guarded.catch(() => {});
  try {
    return await Promise.race([
      guarded,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Result recording
// ---------------------------------------------------------------------------
/** Record a §8 sub-assertion. Prints failing checks immediately. */
function chk(g, name, pass, actual, expected) {
  const ok = !!pass;
  g.checks.push({ name, pass: ok, actual, expected });
  if (!ok) console.log(`    \x1b[31m✗\x1b[0m ${name} — actual=${fmt(actual)} expected=${fmt(expected)}`);
  return ok;
}
/** Record a non-gating contract observation (does not fail the group). */
function note(g, name, actual) {
  g.notes.push({ name, actual });
  console.log(`    · ${name} = ${fmt(actual)}`);
}
function finish(g) {
  const bad = g.checks.filter((c) => !c.pass);
  if (bad.length) {
    fail(`${bad.length}/${g.checks.length} checks failed: ` + bad.map((c) => `${c.name} (actual ${fmt(c.actual)}, expected ${fmt(c.expected)})`).join('; '));
  }
}

async function group(id, title, fn, { timeout = GROUP_TIMEOUT } = {}) {
  const g = { id, title, pass: false, checks: [], notes: [], error: null, startedAt: elapsed(), durationMs: 0 };
  qa.groups.push(g);
  console.log(`\n── [${id}/13] ${title}`);
  try {
    await withTimeout(Promise.resolve().then(() => fn(g)), timeout, `group ${id}`);
    g.pass = true;
    const brief = g.checks.map((c) => `${c.name}=${fmt(c.actual)}`).join(' · ');
    console.log(`\x1b[32m✓\x1b[0m [${id}/13] ${title}${brief ? ` — ${brief}` : ''}`);
  } catch (error) {
    g.error = error instanceof Failure ? error.message : (error?.stack || error?.message || String(error));
    console.log(`\x1b[31m✗\x1b[0m [${id}/13] ${title} — ${g.error}`);
  }
  g.durationMs = elapsed() - g.startedAt;
  qa.timings[`group${id}`] = g.durationMs;
  return g.pass;
}

// ---------------------------------------------------------------------------
// Fake pad injection (exact script from GAMEPAD_SPEC.md §8) + input telemetry
// ---------------------------------------------------------------------------
const FAKE_PAD_INIT = () => {
  const pad = {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
    index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: {
      playEffect(type, params) {
        (window.__rumbleLog = window.__rumbleLog || []).push({ type, ...params });
        return Promise.resolve('complete');
      },
      reset() { return Promise.resolve('complete'); },
    },
  };
  window.__fakePad = pad;
  window.__setPadConnected = (on) => { pad.connected = !!on; };
  window.__setPadAxis = (i, v) => { pad.axes[i] = Number(v); };
  window.__setPadButton = (i, pressed, value) =>
    { pad.buttons[i] = { pressed: !!pressed, touched: !!pressed, value: value ?? (pressed ? 1 : 0) }; };
  window.__setPadId = (id) => { pad.id = String(id); };
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => (pad.connected ? [pad] : []),
  });
};
/** Extra init script (not part of the pad contract): counts real mouse/keyboard events. */
const INPUT_LOG_INIT = () => {
  window.__inputLog = { mouse: 0, keyboard: 0 };
  addEventListener('mousedown', () => { window.__inputLog.mouse += 1; }, true);
  addEventListener('pointerdown', () => { window.__inputLog.mouse += 1; }, true);
  addEventListener('keydown', () => { window.__inputLog.keyboard += 1; }, true);
};

// ---------------------------------------------------------------------------
// In-page helpers (installed after every boot/reload)
// ---------------------------------------------------------------------------
function installPageHelpers(page) {
  return page.evaluate(() => {
    if (window.__gpqa) return;
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const keyOf = (el) => (el ? [el.tagName, el.getAttribute('data-action') || '', el.getAttribute('data-deploy-value') || '', clean(el.textContent).slice(0, 48)].join('|') : '');
    const describe = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      let node = el;
      let hiddenReason = '';
      while (node && node.nodeType === 1) {
        const cs = getComputedStyle(node);
        if (cs.display === 'none') { hiddenReason = 'display:none'; break; }
        if (cs.visibility === 'hidden' || cs.visibility === 'collapse') { hiddenReason = 'visibility:hidden'; break; }
        node = node.parentElement;
      }
      return {
        tag: el.tagName,
        cls: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
        action: el.getAttribute('data-action'),
        deploy: el.getAttribute('data-deploy-value'),
        text: clean(el.textContent).slice(0, 90),
        key: keyOf(el),
        hiddenReason,
        rect: { x: +rect.x.toFixed(1), y: +rect.y.toFixed(1), w: +rect.width.toFixed(1), h: +rect.height.toFixed(1) },
        inView: !hiddenReason && rect.width > 2 && rect.height > 2
          && rect.top >= -2 && rect.bottom <= innerHeight + 2 && rect.left >= -2 && rect.right <= innerWidth + 2,
      };
    };
    window.__gpqa = {
      /** GAMEPAD_SPEC.md §3.8 snapshot: dev=1 hook first, always-on getter fallback. */
      gamepad() {
        const candidates = [window.__sandstrike?.gamepad, window.__sandstrikeApp?.gamepad];
        for (const gp of candidates) {
          if (!gp) continue;
          try {
            if (typeof gp.getState === 'function') return gp.getState();
          } catch (error) {
            return { error: String((error && error.message) || error) };
          }
        }
        return null;
      },
      dom() {
        const focus = document.querySelector('.gp-focus');
        const deployEl = document.querySelector('[data-deploy]');
        const textOf = (selector) => {
          const el = document.querySelector(selector);
          return el ? clean(el.textContent) : null;
        };
        return {
          isGamepad: document.documentElement.classList.contains('is-gamepad'),
          isTouch: document.documentElement.classList.contains('is-touch'),
          activeScreen: [...document.querySelectorAll('[data-screen-panel]')].find((s) => s.classList.contains('is-active'))?.getAttribute('data-screen-panel') ?? null,
          focus: describe(focus),
          focusKey: keyOf(focus),
          focusedAction: focus ? focus.getAttribute('data-action') : null,
          focusedDeploy: focus ? focus.getAttribute('data-deploy-value') : null,
          statuses: [...document.querySelectorAll('[data-pad-status]')].map((el) => ({
            text: clean(el.textContent),
            isOn: el.classList.contains('is-on'),
            panel: el.closest('[data-screen-panel]')?.getAttribute('data-screen-panel') ?? '',
            description: describe(el),
          })),
          vibrates: [...document.querySelectorAll('[data-action="vibrate"]')].map((el) => ({
            pressed: el.getAttribute('aria-pressed'),
            label: clean(el.querySelector('[data-vibrate-label]')?.textContent),
            panel: el.closest('[data-screen-panel]')?.getAttribute('data-screen-panel') ?? '',
            description: describe(el),
          })),
          lists: [...document.querySelectorAll('.controls-list')].map((list) => ({
            kbd: [...list.querySelectorAll('kbd')].map((k) => clean(k.textContent)),
            text: clean(list.textContent),
            visible: describe(list)?.inView ?? false,
          })),
          deploy: deployEl ? {
            open: deployEl.classList.contains('is-open'),
            ariaHidden: deployEl.getAttribute('aria-hidden'),
            defaultCard: document.querySelector('.deploy-card.is-default')?.getAttribute('data-deploy-value') ?? null,
          } : null,
          notices: [...document.querySelectorAll('[data-notices] .notice')].map((row) => ({
            text: row.getAttribute('data-text') || clean(row.textContent),
            warn: row.classList.contains('is-warn'),
          })),
          hints: {
            startKey: textOf('[data-start] .mbtn-key'),
            resumeKey: textOf('.screen--pause [data-action="resume"] .mbtn-key'),
            ammoHint: textOf('.ammo-hint'),
            pauseFoot: textOf('.pause-foot'),
          },
          state: window.__sandstrike?.state ?? window.__sandstrikeApp?.state ?? null,
          uiState: window.__sandstrike?.ui?.state ?? null,
          pointerLock: document.pointerLockElement
            ? `${document.pointerLockElement.tagName}#${document.pointerLockElement.id || ''}`
            : null,
          start: (() => {
            const button = document.querySelector('[data-start]');
            if (!button) return null;
            return { disabled: !!button.disabled, key: clean(button.querySelector('.mbtn-key')?.textContent), description: describe(button) };
          })(),
          inputLog: window.__inputLog ? { ...window.__inputLog } : null,
        };
      },
      player() {
        const p = window.__sandstrike?.player;
        if (!p) return null;
        return {
          x: p.position.x, y: p.position.y, z: p.position.z,
          yaw: p.yaw, lookPitch: p.lookPitch,
          eyeHeight: +p.eyeHeight.toFixed(3),
          crouching: p.crouching, sprinting: p.sprinting, grounded: p.grounded,
          vy: +p.velocity.y.toFixed(3),
          speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(3),
          aiming: p.aiming,
          padMove: { x: +p.padMove.x.toFixed(3), forward: +p.padMove.forward.toFixed(3) },
          padSprintHeld: p.padSprintHeld,
          padCrouchHeld: p.padCrouchHeld,
          enabled: p.enabled,
          alive: p.alive,
        };
      },
      weapon() {
        const w = window.__sandstrike?.weapon;
        if (!w) return null;
        return {
          mag: w.mag, magSize: w.magSize, reserve: w.reserve,
          reloading: w.reloading,
          aiming: w.aiming, ads: +(w.ads ?? 0).toFixed(3),
          triggerDown: w.triggerDown, active: w.active,
          shotsFired: w.shotsFired,
          fov: w.viewCamera ? +w.viewCamera.fov.toFixed(2) : null,
        };
      },
      rumbleLog() {
        return Array.isArray(window.__rumbleLog) ? window.__rumbleLog.slice(0, 10) : null;
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Waiting helpers
// ---------------------------------------------------------------------------
async function waitFor(page, fn, { timeout = 10000, polling = 200, label = '', arg = null } = {}) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling });
    return true;
  } catch {
    if (label) console.log(`    · waitFor "${label}" timed out after ${timeout}ms`);
    return false;
  }
}

const gpState = (page) => page.evaluate(() => window.__gpqa?.gamepad?.() ?? null);
const padDom = (page) => page.evaluate(() => window.__gpqa?.dom?.() ?? null);
const playerState = (page) => page.evaluate(() => window.__gpqa?.player?.() ?? null);
const weaponState = (page) => page.evaluate(() => window.__gpqa?.weapon?.() ?? null);
const rumbleLog = (page) => page.evaluate(() => window.__gpqa?.rumbleLog?.() ?? null);

const waitState = (page, wanted, timeout = 15000) => waitFor(
  page,
  (want) => (window.__sandstrike?.state ?? window.__sandstrikeApp?.state ?? null) === want,
  { timeout, label: `state ${wanted}`, arg: wanted },
);

/** Menu screen active, START enabled, game state menu. */
const waitMenuReady = (page, timeout = 40000) => waitFor(page, () => {
  const menu = document.querySelector('.screen--menu');
  const start = document.querySelector('[data-start]');
  return !!menu && menu.classList.contains('is-active')
    && parseFloat(getComputedStyle(menu).opacity || '0') > 0.6
    && !!start && !start.disabled
    && (window.__sandstrike?.state ?? null) === 'menu';
}, { timeout, label: 'menu ready' });

const waitDeployOpen = (page, timeout = 15000) => waitFor(page, () => {
  const el = document.querySelector('[data-deploy]');
  return !!el && el.classList.contains('is-open') && el.getAttribute('aria-hidden') === 'false';
}, { timeout, label: 'deploy open' });

// --- second-level SYSTEM CONFIG menu (settings + controls) -------------------
// The home/pause screens no longer embed the settings panel: a SYSTEM CONFIG
// button (`[data-action="focus-settings"]`) opens it on demand.
const waitSettingsOpen = (page, timeout = 12000) => waitFor(page, () => {
  const el = document.querySelector('.screen.is-active [data-settings]');
  return !!el && el.classList.contains('is-open') && el.getAttribute('aria-hidden') === 'false'
    && getComputedStyle(el).visibility !== 'hidden';
}, { timeout, label: 'settings overlay open' });

const openSettings = async (page) => {
  await page.evaluate(() => {
    const scope = document.querySelector('.screen.is-active [data-action="focus-settings"]');
    scope?.click();
  }).catch(() => {});
  return waitSettingsOpen(page);
};

const closeSettings = async (page) => {
  await page.evaluate(() => {
    const root = document.querySelector('.screen.is-active [data-settings].is-open');
    root?.querySelector('[data-action="settings-close"]')?.click();
  }).catch(() => {});
  return waitFor(page, () => {
    const el = document.querySelector('.screen.is-active [data-settings]');
    return !el || !el.classList.contains('is-open');
  }, { timeout: 8000, label: 'settings overlay closed' });
};

/** Computed-style snapshot of an overlay (used to prove a screenshot is not mid-transition). */
const overlaySnapshot = (page, selector) => page.evaluate((sel) => {
  const node = document.querySelector(sel);
  if (!node) return { found: false };
  const style = getComputedStyle(node);
  return {
    found: true,
    opacity: Number.parseFloat(style.opacity || '0'),
    visibility: style.visibility,
    display: style.display,
    cls: node.className,
    ariaHidden: node.getAttribute('aria-hidden'),
  };
}, selector).catch(() => ({ found: false }));

/**
 * Wait for a full-screen overlay to be actually painted. The SwiftShader
 * renderer can run at ~2 fps, so an `.is-active` / `.is-open` class change can
 * land several hundred ms before the CSS opacity transition has visibly
 * started — screenshots must not capture that in-between frame.
 */
const waitOverlayVisible = (page, selector, { timeout = 15000, minOpacity = 0.6, label = selector, allowAriaHidden = false } = {}) => waitFor(
  page,
  (arg) => {
    const node = document.querySelector(arg.selector);
    if (!node) return false;
    if (!arg.allowAriaHidden && node.hasAttribute('aria-hidden') && node.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return Number.parseFloat(style.opacity || '0') >= arg.minOpacity;
  },
  { timeout, polling: 150, label: `overlay visible (${label})`, arg: { selector, minOpacity, allowAriaHidden } },
);

/** Wait for the `.gp-focus` ring on `selector` (or anywhere when selector is ''). */
async function waitPadFocus(page, selector = '', { timeout = 15000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const hit = await page.evaluate((sel) => {
      const focus = document.querySelector('.gp-focus');
      if (!focus) return false;
      return !sel || focus.matches(sel);
    }, selector).catch(() => false);
    if (hit) return true;
    await padTick(page, 2).catch(() => {});
    await sleep(300);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fake-pad driving helpers
// ---------------------------------------------------------------------------
/** Atomically set the whole fake-pad state (axes + pressed buttons). */
const padSet = (page, spec = {}) => page.evaluate(({ axes = [], buttons = {} }) => {
  if (typeof window.__setPadAxis !== 'function' || typeof window.__setPadButton !== 'function') {
    return { ok: false, reason: 'fake-pad helpers missing' };
  }
  for (let i = 0; i < 4; i += 1) window.__setPadAxis(i, axes[i] ?? 0);
  for (let i = 0; i < 17; i += 1) window.__setPadButton(i, false, 0);
  for (const key of Object.keys(buttons)) window.__setPadButton(Number(key), true, buttons[key]);
  return { ok: true };
}, spec);

/** Pump `frames` gamepad.update() steps without advancing the game simulation. */
const padTick = (page, frames = 1) => page.evaluate((n) => {
  const gp = window.__sandstrike?.gamepad ?? window.__sandstrikeApp?.gamepad;
  if (!gp || typeof gp.update !== 'function') return { ok: false, state: null };
  for (let i = 0; i < n; i += 1) gp.update(1 / 60);
  let state = null;
  try { state = typeof gp.getState === 'function' ? gp.getState() : null; } catch { state = null; }
  return { ok: true, state };
}, frames).then((result) => (result?.ok ? result.state : null));

/** Tap a button (edge press + release) while pumping the pad module. */
const padTap = (page, index, { value = 1, ticks = 1 } = {}) => page.evaluate(([btn, val, n]) => {
  const gp = window.__sandstrike?.gamepad ?? window.__sandstrikeApp?.gamepad;
  if (typeof window.__setPadButton !== 'function') return null;
  window.__setPadButton(btn, true, val);
  for (let i = 0; i < n; i += 1) gp?.update?.(1 / 60);
  window.__setPadButton(btn, false, 0);
  for (let i = 0; i < n; i += 1) gp?.update?.(1 / 60);
  let state = null;
  try { state = gp?.getState?.() ?? null; } catch { state = null; }
  return state;
}, [index, value, ticks]);

/** Advance the game simulation deterministically through the dev hook. */
const advance = (page, seconds) => page.evaluate((s) => {
  const hook = window.__sandstrike?.fastForward;
  if (typeof hook !== 'function') return { ok: false, reason: 'fastForward dev hook missing' };
  return { ok: true, result: hook(s) };
}, seconds);

/**
 * Precondition guard for the gameplay groups. On a heavily loaded machine the
 * shared run can leave the `playing` state between groups (scene rebuilds,
 * unrelated concurrent probes sharing the box, or a restart racing the next
 * assertion). Restart deterministically through the documented dev hook — the
 * same path as `ui:start` — re-apply godMode and keep every assertion unchanged.
 */
async function ensurePlaying(page, label = 'gameplay group') {
  const current = await page.evaluate(() => ({
    state: window.__sandstrike?.state ?? window.__sandstrikeApp?.state ?? null,
    hasStart: typeof window.__sandstrike?.start === 'function',
  })).catch(() => ({ state: null, hasStart: false }));
  let restarted = false;
  if (current.state !== 'playing') {
    await page.evaluate(() => {
      const s = window.__sandstrike;
      if (typeof s?.start === 'function') s.start();
    }).catch(() => {});
    await sleep(180);
    await page.evaluate(() => window.__sandstrike?.fastForward?.(0.1)).catch(() => {});
    restarted = true;
    const info = { label, from: current.state, hasStart: current.hasStart };
    qa.notes.push({ name: 'precondition guard restarted the run', actual: info });
    console.log(`    · ensurePlaying(${label}): restarted run (state was ${current.state})`);
  }
  await page.evaluate(() => {
    const s = window.__sandstrike;
    if (s?.player) s.player.godMode = true;
  }).catch(() => {});
  if (!(await waitState(page, 'playing', 15000))) {
    const actual = await page.evaluate(() => ({
      state: window.__sandstrike?.state ?? window.__sandstrikeApp?.state ?? null,
      restarted,
    })).catch(() => ({ state: null, restarted }));
    fail(`run not playing after ensurePlaying (state=${actual.state}, restarted=${actual.restarted})`);
  }
  return { restarted, from: current.state };
}

const pointerLock = (page) => page.evaluate(() => (document.pointerLockElement
  ? `${document.pointerLockElement.tagName}#${document.pointerLockElement.id || ''}`
  : null));

// ---------------------------------------------------------------------------
// Console / boot tracking
// ---------------------------------------------------------------------------
function trackConsole(page, bucket) {
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') qa.consoleErrors[bucket].push(msg.text());
    else if (type === 'warning') qa.consoleWarnings[bucket].push(msg.text());
  });
  page.on('pageerror', (error) => {
    qa.consoleErrors[bucket].push('[pageerror] ' + (error?.message || String(error)));
  });
}

/** Boot watcher: resolves on app.loaded, fails fast on fatal screen or module errors. */
async function waitForAppReady(page, bucket, timeout = BOOT_TIMEOUT) {
  const started = Date.now();
  let probe = null;
  while (Date.now() - started < timeout) {
    probe = await page.evaluate(() => ({
      loaded: window.__sandstrikeApp?.loaded === true,
      fatal: !!document.querySelector('.fatal-screen'),
    })).catch((error) => ({ evalError: error.message }));
    if (probe?.loaded) return { ok: true, ms: Date.now() - started, probe };
    if (probe?.fatal) return { ok: false, reason: 'fatal screen shown', ms: Date.now() - started, probe };
    if (probe?.evalError) return { ok: false, reason: 'evaluate failed: ' + probe.evalError, ms: Date.now() - started, probe };
    const moduleError = qa.consoleErrors[bucket].find((entry) => /does not provide an export|Failed to fetch dynamically|Cannot find module|net::ERR|Failed to load resource|SyntaxError|Unexpected token/i.test(entry));
    if (moduleError) return { ok: false, reason: 'module load error: ' + moduleError, ms: Date.now() - started, probe };
    await sleep(300);
  }
  return { ok: false, reason: `timeout after ${timeout}ms`, ms: Date.now() - started, probe };
}

/** Navigate a page, wait for the app and install the in-page helpers. */
async function openPadPage(context, bucket, label, query = QUERY) {
  const page = await context.newPage();
  trackConsole(page, bucket);
  await page.goto(`${URL_BASE}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const ready = await waitForAppReady(page, bucket);
  qa.timings[`${label}Boot`] = ready.ms;
  console.log(`  [boot] ${label} ready=${ready.ok} in ${(ready.ms / 1000).toFixed(1)}s${ready.reason ? ` (${ready.reason})` : ''}`);
  if (ready.ok) await installPageHelpers(page);
  return { page, ready };
}

/**
 * Supplementary keyboard/mouse reference context WITHOUT the fake-pad init
 * script (§8 preamble). The machine runs SwiftShader next to other probes, so a
 * third renderer can take minutes to come up: every step is bounded and a
 * failure only skips this supplementary context instead of wedging the suite.
 * The gating keyboard-fallback checks already run in the pad page after the pad
 * is disconnected.
 */
async function openKeyboardReference() {
  const context = await withTimeout(
    browser.newContext({ viewport: KEYBOARD_VIEW, deviceScaleFactor: DPR }),
    30_000,
    'keyboard-reference newContext',
  );
  const page = await withTimeout(context.newPage(), 30_000, 'keyboard-reference newPage');
  trackConsole(page, 'keyboard');
  try {
    await withTimeout(
      page.goto(`${URL_BASE}/?${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 }),
      90_000,
      'keyboard-reference goto',
    );
    const ready = await withTimeout(waitForAppReady(page, 'keyboard'), 150_000, 'keyboard-reference app ready');
    qa.timings.keyboardReferenceBoot = ready.ms;
    console.log(`  [boot] keyboardReference ready=${ready.ok} in ${(ready.ms / 1000).toFixed(1)}s${ready.reason ? ` (${ready.reason})` : ''}`);
    if (!ready.ok) return { ok: false, reason: ready.reason, context, page };
    await installPageHelpers(page);
    const menuReady = await withTimeout(waitMenuReady(page, 40_000), 60_000, 'keyboard-reference menu ready');
    if (!menuReady) return { ok: false, reason: 'menu not ready', context, page };
    return { ok: true, context, page };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error), context, page };
  }
}

// ---------------------------------------------------------------------------
// Screenshot capture (freeze + renderOnce, scripts/qa.mjs pattern)
// ---------------------------------------------------------------------------
async function capture(page, name) {
  try {
    const previousScale = await page.evaluate(() => {
      const app = window.__sandstrike;
      const previous = typeof app?.adaptiveScale === 'number' ? app.adaptiveScale : null;
      app?.setAdaptiveScale?.(1);
      return previous;
    }).catch(() => null);
    await sleep(120);
    await page.evaluate(() => {
      window.__sandstrike?.freeze?.(true);
      window.__sandstrike?.renderOnce?.();
    }).catch(() => {});
    await sleep(260);
    await page.screenshot({ path: join(OUT, name) });
    qa.screenshots[name] = `shots/${name}`;
    console.log(`    ▸ captured shots/${name}`);
    await page.evaluate((previous) => {
      window.__sandstrike?.freeze?.(false);
      if (typeof previous === 'number') window.__sandstrike?.setAdaptiveScale?.(previous);
    }, previousScale).catch(() => {});
    return true;
  } catch (error) {
    const message = `[shot] ${name}: ${error.message}`;
    qa.errors.push(message);
    console.log(`    ! ${message}`);
    return false;
  }
}

/**
 * Make sure every selector is displayed inside the viewport, scrolling the
 * containing menu/pause panel when needed. Returns per-selector geometry.
 */
async function ensureVisible(page, selectors) {
  const read = () => page.evaluate((sels) => {
    const out = {};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = { found: false, inView: false }; continue; }
      let node = el;
      let hiddenReason = '';
      while (node && node.nodeType === 1) {
        const cs = getComputedStyle(node);
        if (cs.display === 'none') { hiddenReason = 'display:none'; break; }
        if (cs.visibility === 'hidden' || cs.visibility === 'collapse') { hiddenReason = 'visibility:hidden'; break; }
        node = node.parentElement;
      }
      const rect = el.getBoundingClientRect();
      out[sel] = {
        found: true,
        hiddenReason,
        w: +rect.width.toFixed(1),
        h: +rect.height.toFixed(1),
        top: +rect.top.toFixed(1),
        bottom: +rect.bottom.toFixed(1),
        inView: !hiddenReason && rect.width > 2 && rect.height > 2
          && rect.top >= -2 && rect.bottom <= innerHeight + 2 && rect.left >= -2 && rect.right <= innerWidth + 2,
        viewport: { w: innerWidth, h: innerHeight },
      };
    }
    return out;
  }, selectors);
  let info = await read();
  if (selectors.some((sel) => info[sel] && !info[sel].inView)) {
    await page.evaluate((sels) => {
      const target = sels.map((sel) => document.querySelector(sel)).find((el) => !!el);
      target?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }, selectors).catch(() => {});
    await sleep(450);
    info = await read();
  }
  return info;
}

/** start button centre (or null when missing/disabled). */
const startPoint = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-start]');
  if (!el || el.disabled) return null;
  const r = el.getBoundingClientRect();
  return { x: +(r.x + r.width / 2).toFixed(1), y: +(r.y + r.height / 2).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
});

/**
 * Mouse flow: real click on START -> real click on the STANDARD deploy card.
 * A mouse click on the menu also asks for pointer lock (pre-existing desktop
 * behaviour), which can swallow the card click; the card is therefore clicked
 * through the DOM when the real click does not reach it (same fallback the
 * other probes already rely on).
 */
async function startRunWithMouse(page) {
  const start = await startPoint(page);
  if (!start) return { ok: false, reason: 'START missing/disabled' };
  await page.mouse.click(start.x, start.y).catch(() => {});
  const opened = await waitDeployOpen(page, 20000);
  let card = { ok: false };
  if (opened) {
    card = await page.evaluate(() => {
      const el = document.querySelector('[data-deploy-value="standard"]');
      if (!el) return { ok: false, reason: 'STANDARD card missing' };
      el.click();
      return { ok: true, via: 'dom-click' };
    }).catch((error) => ({ ok: false, reason: error.message }));
  }
  const playing = await waitState(page, 'playing', 20000);
  return { ok: opened && playing, opened, playing, card, pointerLock: await pointerLock(page) };
}

/** Hold W for `seconds` of simulated time and project the displacement on the view basis. */
async function keyboardForwardCheck(page, seconds = 0.5) {
  const start = await page.evaluate(() => {
    const s = window.__sandstrike;
    const p = s?.player;
    if (!s || !p) return { error: 'dev hooks missing' };
    return { playing: s.state === 'playing', enabled: p.enabled, x: p.position.x, z: p.position.z, yaw: p.yaw };
  });
  if (!start.playing || !start.enabled) return { ...start, error: 'not playing/enabled' };
  await page.keyboard.down('w');
  await sleep(140);
  const move = await page.evaluate((sec) => {
    const s = window.__sandstrike;
    const p = s.player;
    const before = { x: p.position.x, z: p.position.z };
    const yaw = p.yaw;
    s.fastForward(sec);
    const dx = p.position.x - before.x;
    const dz = p.position.z - before.z;
    return {
      dx: +dx.toFixed(3),
      dz: +dz.toFixed(3),
      forward: +(dx * -Math.sin(yaw) + dz * -Math.cos(yaw)).toFixed(3),
      yaw: +yaw.toFixed(3),
    };
  }, seconds);
  await page.keyboard.up('w');
  return move;
}

/** Click the canvas centre twice (first click acquires pointer lock) and check that a round fires. */
async function mouseFireCheck(page) {
  const before = await page.evaluate(() => {
    const w = window.__sandstrike?.weapon;
    if (!w) return null;
    w.mag = 30;
    w.reloading = false;
    w.triggerDown = false;
    w.fireCooldown = 0;
    return { mag: w.mag, shots: w.shotsFired, state: window.__sandstrike.state };
  });
  if (!before) return { error: 'weapon dev hook missing' };
  await page.mouse.click(800, 450).catch(() => {});
  await sleep(220);
  const lock = await pointerLock(page);
  await page.mouse.click(800, 450).catch(() => {});
  await sleep(120);
  const after = await page.evaluate(() => {
    const s = window.__sandstrike;
    const w = s.weapon;
    s.fastForward(0.12);
    return { mag: w.mag, shots: w.shotsFired, triggerDown: w.triggerDown, state: s.state };
  });
  return {
    before,
    lock,
    after,
    delta: (after.shots - before.shots) + (before.mag - after.mag),
  };
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
console.log(`SANDSTRIKE gamepad QA — ${URL_BASE}`);
console.log(`chrome: ${CHROME}`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: SWIFTSHADER_ARGS });

let padCtx = null;
let padPage = null;
let keyboardCtx = null;
let keyboardPage = null;
let mobileCtx = null;
let mobilePage = null;

try {
  // =========================================================================
  // 1. API / detection
  // =========================================================================
  await group(1, 'API / detection: dev hooks, supported/connected/kind, is-gamepad, settings status', async (g) => {
    padCtx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: DPR, isMobile: false, hasTouch: false });
    await padCtx.addInitScript(FAKE_PAD_INIT);
    await padCtx.addInitScript(INPUT_LOG_INIT);
    const opened = await openPadPage(padCtx, 'pad', 'padMain');
    padPage = opened.page;
    chk(g, 'app.loaded', opened.ready.ok, opened.ready.ok ? 'loaded' : opened.ready.reason, 'loaded');
    if (!opened.ready.ok) {
      chk(g, 'boot reason', false, opened.ready.reason, 'no error');
      finish(g);
      return;
    }
    const api = await padPage.evaluate(() => ({
      loaded: window.__sandstrikeApp?.loaded === true,
      devHook: !!window.__sandstrike,
      devGamepad: !!window.__sandstrike?.gamepad,
      appGamepad: !!window.__sandstrikeApp?.gamepad,
      missingHooks: ['player', 'weapon', 'freeze', 'renderOnce', 'fastForward', 'gamepad'].filter((key) => !window.__sandstrike?.[key]),
      fakePadId: navigator.getGamepads?.()?.[0]?.id ?? null,
      padCount: navigator.getGamepads?.()?.length ?? 0,
      state: window.__sandstrike?.state ?? null,
    }));
    chk(g, 'dev hooks complete', api.missingHooks.length === 0, api.missingHooks, []);
    chk(g, 'fake pad visible to page', api.padCount === 1 && /Xbox/i.test(api.fakePadId || ''), { padCount: api.padCount, id: api.fakePadId }, '1 Xbox standard pad');
    chk(g, '__sandstrikeApp.gamepad getter', api.appGamepad || api.devGamepad, { devGamepad: api.devGamepad, appGamepad: api.appGamepad }, true);
    const menuReady = await waitMenuReady(padPage, 40000);
    chk(g, 'state=menu after load', menuReady && api.state === 'menu', { menuReady, state: api.state }, 'menu');
    // Pump the module once so the fake pad is polled even if rAF is very slow.
    await padTick(padPage, 4);
    const detected = await waitFor(padPage, () => {
      const gp = window.__sandstrike?.gamepad ?? window.__sandstrikeApp?.gamepad;
      let st = null;
      try { st = gp?.getState?.() ?? null; } catch { st = null; }
      if (!st || st.connected !== true || st.kind !== 'xbox') return false;
      const statuses = [...document.querySelectorAll('[data-pad-status]')];
      return document.documentElement.classList.contains('is-gamepad')
        && statuses.length >= 2
        && statuses.every((el) => /CONNECTED/i.test(el.textContent || ''));
    }, { timeout: 20000, label: 'controller detected in UI' });
    const st = await gpState(padPage);
    const dom = await padDom(padPage);
    chk(g, 'getState().supported', st?.supported === true, st?.supported, true);
    chk(g, 'getState().connected', st?.connected === true, st?.connected, true);
    chk(g, 'getState().kind === xbox', st?.kind === 'xbox', st?.kind, 'xbox');
    chk(g, 'getState().mapping === standard', st?.mapping === 'standard', st?.mapping, 'standard');
    chk(g, 'html.is-gamepad set', dom?.isGamepad === true, dom?.isGamepad, true);
    chk(g, 'settings row shows XBOX · CONNECTED', detected && dom.statuses.length >= 2
      && dom.statuses.every((row) => /XBOX/i.test(row.text) && /CONNECTED/i.test(row.text) && row.isOn),
    dom.statuses.map((row) => ({ text: row.text, isOn: row.isOn })), 'both rows XBOX · CONNECTED');
    chk(g, 'console/page errors (pad context)', qa.consoleErrors.pad.length === 0, qa.consoleErrors.pad.slice(0, 3), []);
    note(g, 'getState() snapshot', st);
    note(g, 'pad id', st?.id);
    finish(g);
  }, { timeout: BOOT_TIMEOUT + 90_000 });

  // =========================================================================
  // 2. Legend / status DOM
  // =========================================================================
  await group(2, 'Legend / status DOM: pad legend rows (no WASD/MOUSE/ESC), both status panels', async (g) => {
    expect(padPage, 'pad page missing (group 1 failed)');
    const menuReady = await waitMenuReady(padPage, 30000);
    chk(g, 'menu ready', menuReady, menuReady, true);
    await padTick(padPage, 3);
    const legendReady = await waitFor(padPage, () => {
      const list = document.querySelector('.screen--menu.is-active .controls-list');
      if (!list) return false;
      const kbd = [...list.querySelectorAll('kbd')].map((k) => (k.textContent || '').trim());
      return ['RT', 'LT', 'X', 'A', 'B'].every((key) => kbd.includes(key));
    }, { timeout: 20000, label: 'pad legend rendered' });
    const dom = await padDom(padPage);
    const visibleList = dom.lists.find((list) => list.visible) || dom.lists[0] || { kbd: [], text: '' };
    const kbd = visibleList.kbd || [];
    chk(g, 'legend shows pad rows RT/LT/X/A/B', legendReady && ['RT', 'LT', 'X', 'A', 'B'].every((key) => kbd.includes(key)), kbd, 'contains RT, LT, X, A, B');
    chk(g, 'legend is not the keyboard legend', !kbd.includes('MOUSE') && !kbd.includes('ESC') && !kbd.includes('SHIFT') && !kbd.includes('SPACE'),
      kbd, 'no MOUSE/ESC/SHIFT/SPACE');
    chk(g, 'both settings panels present', dom.statuses.length >= 2, dom.statuses.length, '>=2');
    chk(g, 'both panels show CONNECTED status', dom.statuses.length >= 2
      && dom.statuses.every((row) => /CONNECTED/i.test(row.text) && row.isOn), dom.statuses.map((row) => row.text), 'XBOX · CONNECTED');
    note(g, 'contextual pad hints', dom.hints);
    // gamepad-01: menu with the focus ring + pad legend.
    const focusReady = await waitPadFocus(padPage, '[data-start]', { timeout: 15000 });
    chk(g, 'START focused for the menu screenshot', focusReady, (await padDom(padPage)).focus, 'gp-focus on [data-start]');
    const menuPainted = await waitOverlayVisible(padPage, '.screen--menu.is-active', { label: 'menu before shot' });
    chk(g, 'menu overlay painted before the shot', menuPainted, await overlaySnapshot(padPage, '.screen--menu'), { opacity: '>=0.6', isActive: true });
    chk(g, 'captured gamepad-01-menu.png', await capture(padPage, 'gamepad-01-menu.png'), qa.screenshots['gamepad-01-menu.png'] ?? null, 'shots/gamepad-01-menu.png');
    finish(g);
  });

  // =========================================================================
  // 3. Menu navigation (d-pad, A, deploy default card, run start)
  // =========================================================================
  await group(3, 'Menu navigation: START focus, d-pad, A on SYSTEM CONFIG harmless, A opens deploy, default card, A starts', async (g) => {
    expect(padPage, 'pad page missing (group 1 failed)');
    await waitMenuReady(padPage, 30000);
    const startFocused = await waitPadFocus(padPage, '[data-start]', { timeout: 20000 });
    chk(g, 'START focused by default', startFocused, (await padDom(padPage)).focus, 'gp-focus on [data-start]');
    const dom0 = await padDom(padPage);
    await padTap(padPage, 13); // d-pad down
    await sleep(350);
    const dom1 = await padDom(padPage);
    chk(g, 'd-pad down moves the focus ring', !!dom1.focus && dom1.focusKey !== dom0.focusKey, { from: dom0.focusKey, to: dom1.focusKey }, 'different element');
    await padTap(padPage, 12); // d-pad up
    await sleep(350);
    const dom2 = await padDom(padPage);
    chk(g, 'd-pad up moves the focus ring again', !!dom2.focus && dom2.focusKey !== dom1.focusKey, { from: dom1.focusKey, to: dom2.focusKey }, 'different element');
    // Move onto the SYSTEM CONFIG button (d-pad down from START) and press A:
    // it must open the second-level SYSTEM CONFIG menu, not start the run.
    let preA = await padDom(padPage);
    for (let step = 0; step < 4 && preA.focusedAction !== 'focus-settings'; step += 1) {
      await padTap(padPage, 13);
      await sleep(300);
      preA = await padDom(padPage);
    }
    chk(g, 'SYSTEM CONFIG reachable with d-pad', preA.focusedAction === 'focus-settings', preA.focus, 'gp-focus on [data-action="focus-settings"]');
    await padTap(padPage, 0); // A
    const settingsOpened = await waitSettingsOpen(padPage, 12000);
    const afterA = await padDom(padPage);
    chk(g, 'A on SYSTEM CONFIG opens the second-level settings menu',
      settingsOpened && afterA.state === 'menu' && afterA.deploy?.open === false,
      { focus: preA.focusKey, state: afterA.state, settingsOpen: settingsOpened }, { state: 'menu', settingsOpen: true });
    await padTap(padPage, 1); // B closes the second-level menu
    const settingsClosed = await closeSettings(padPage);
    chk(g, 'B closes the second-level settings menu', settingsClosed, { settingsClosed }, true);
    // Back to START (spatial nav up), then A opens the deploy dialog.
    let preDeploy = afterA;
    for (let step = 0; step < 6 && preDeploy.focusedAction !== 'start'; step += 1) {
      await padTap(padPage, 12);
      await sleep(300);
      preDeploy = await padDom(padPage);
    }
    chk(g, 'START re-focused with the pad', preDeploy.focusedAction === 'start', preDeploy.focus, 'gp-focus on [data-start]');
    await padTap(padPage, 0); // A on START
    const deployOpen = await waitDeployOpen(padPage, 15000);
    const domDeploy = await padDom(padPage);
    chk(g, 'A on START opens the deploy panel', deployOpen && domDeploy.deploy?.open === true && domDeploy.deploy?.ariaHidden === 'false',
      { open: domDeploy.deploy?.open, ariaHidden: domDeploy.deploy?.ariaHidden }, { open: true, ariaHidden: 'false' });
    chk(g, 'run not started before the difficulty pick', domDeploy.state === 'menu', domDeploy.state, 'menu');
    const defaultFocused = await waitPadFocus(padPage, '.deploy-card.is-default', { timeout: 15000 });
    const domDeploy2 = await padDom(padPage);
    chk(g, '.deploy-card.is-default marked', domDeploy2.deploy?.defaultCard === 'standard', domDeploy2.deploy?.defaultCard, 'standard');
    chk(g, 'default deploy card focused', defaultFocused && domDeploy2.focusedDeploy === domDeploy2.deploy?.defaultCard,
      { focus: domDeploy2.focus, defaultCard: domDeploy2.deploy?.defaultCard }, 'gp-focus on .deploy-card.is-default');
    const deployPainted = await waitOverlayVisible(padPage, '.deploy.is-open', { label: 'deploy before shot' });
    chk(g, 'deploy overlay painted before the shot', deployPainted, await overlaySnapshot(padPage, '.deploy'), { opacity: '>=0.6', isOpen: true });
    chk(g, 'captured gamepad-02-deploy.png', await capture(padPage, 'gamepad-02-deploy.png'), qa.screenshots['gamepad-02-deploy.png'] ?? null, 'shots/gamepad-02-deploy.png');
    await padTap(padPage, 0); // A on the default card -> start run
    const playing = await waitState(padPage, 'playing', 20000);
    chk(g, 'A on the default card starts the run', playing, (await padDom(padPage)).state, 'playing');
    await padPage.evaluate(() => { const s = window.__sandstrike; if (s?.player) s.player.godMode = true; });
    finish(g);
  });

  // =========================================================================
  // 4. Pad-only start from a fresh page
  // =========================================================================
  await group(4, 'Pad-only start from a fresh page: A (menu) -> A (deploy) -> playing, no pointer lock, 0 errors', async (g) => {
    expect(padPage, 'pad page missing (group 1 failed)');
    const errorsBefore = qa.consoleErrors.pad.length;
    await padPage.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    const ready = await waitForAppReady(padPage, 'pad');
    qa.timings.padReload = ready.ms;
    console.log(`  [boot] padReload ready=${ready.ok} in ${(ready.ms / 1000).toFixed(1)}s${ready.reason ? ` (${ready.reason})` : ''}`);
    chk(g, 'fresh page loaded', ready.ok, ready.ok ? 'loaded' : ready.reason, 'loaded');
    if (!ready.ok) { finish(g); return; }
    await installPageHelpers(padPage);
    const menuReady = await waitMenuReady(padPage, 40000);
    chk(g, 'fresh menu ready', menuReady, menuReady, true);
    await padTick(padPage, 4);
    const startFocused = await waitPadFocus(padPage, '[data-start]', { timeout: 25000 });
    chk(g, 'START focused on the fresh boot', startFocused, (await padDom(padPage)).focus, 'gp-focus on [data-start]');
    const inputsAtMenu = await padDom(padPage);
    chk(g, 'no mouse/keyboard events so far', (inputsAtMenu.inputLog?.mouse ?? 0) === 0 && (inputsAtMenu.inputLog?.keyboard ?? 0) === 0,
      inputsAtMenu.inputLog, { mouse: 0, keyboard: 0 });
    await padTap(padPage, 0); // A
    const deployOpen = await waitDeployOpen(padPage, 20000);
    chk(g, 'A (menu) opens deploy without mouse/keyboard', deployOpen, (await padDom(padPage)).deploy, { open: true });
    await padTap(padPage, 0); // A (default card)
    const playing = await waitState(padPage, 'playing', 20000);
    const domPlaying = await padDom(padPage);
    chk(g, 'A (deploy) reaches playing', playing && domPlaying.state === 'playing', domPlaying.state, 'playing');
    chk(g, 'pointer lock not requested by a pad start', domPlaying.pointerLock === null, domPlaying.pointerLock, null);
    chk(g, 'no mouse/keyboard events used for the whole boot->play flow',
      (domPlaying.inputLog?.mouse ?? 0) === 0 && (domPlaying.inputLog?.keyboard ?? 0) === 0, domPlaying.inputLog, { mouse: 0, keyboard: 0 });
    chk(g, 'no console errors during the pad-only flow', qa.consoleErrors.pad.length === errorsBefore,
      qa.consoleErrors.pad.slice(errorsBefore, errorsBefore + 3), []);
    await padPage.evaluate(() => {
      const s = window.__sandstrike;
      if (s?.player) s.player.godMode = true;
      s?.fastForward?.(0.5);
    });
    await sleep(350);
    // The HUD is decorative and keeps aria-hidden="true" even while visible,
    // so its paint guard checks computed style only.
    const hudPainted = await waitOverlayVisible(padPage, '[data-hud]', { label: 'HUD before shot', allowAriaHidden: true });
    chk(g, 'HUD painted before the shot', hudPainted, await overlaySnapshot(padPage, '[data-hud]'), { opacity: '>=0.6', visibility: 'visible' });
    chk(g, 'captured gamepad-03-playing.png', await capture(padPage, 'gamepad-03-playing.png'), qa.screenshots['gamepad-03-playing.png'] ?? null, 'shots/gamepad-03-playing.png');
    finish(g);
  }, { timeout: BOOT_TIMEOUT + 120_000 });

  // =========================================================================
  // 5. Movement
  // =========================================================================
  await group(5, 'Movement: stick forward/right/diagonal camera-relative, distance ±20%, deadzone 0.10 < 0.05 m', async (g) => {
    expect(padPage, 'pad page missing');
    await ensurePlaying(padPage, `group ${g.id}`);
    const res = await padPage.evaluate(({ walkSpeed }) => {
      const s = window.__sandstrike;
      const p = s.player;
      const spawn = s.world.playerSpawn;
      const reset = () => {
        p.reset(spawn);
        p.yaw = 0;
        p.lookPitch = 0;
        p.godMode = true;
        window.__setPadAxis(0, 0); window.__setPadAxis(1, 0);
        s.fastForward(0.2);
      };
      const run = (ax, ay, seconds) => {
        reset();
        const start = { x: p.position.x, z: p.position.z };
        window.__setPadAxis(0, ax);
        window.__setPadAxis(1, ay);
        s.fastForward(seconds);
        window.__setPadAxis(0, 0);
        window.__setPadAxis(1, 0);
        const end = { x: p.position.x, z: p.position.z };
        const padMove = { x: p.padMove.x, forward: p.padMove.forward };
        s.fastForward(0.25);
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        // Facing yaw 0 => camera forward = (0, -1), camera right = (1, 0).
        return {
          dx: +dx.toFixed(3),
          dz: +dz.toFixed(3),
          forward: +(-dz).toFixed(3),
          right: +dx.toFixed(3),
          dist: +Math.hypot(dx, dz).toFixed(3),
          padMove,
          speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(3),
        };
      };
      const forward = run(0, -1, 0.6);
      const backward = run(0, 1, 0.4);
      const right = run(1, 0, 0.6);
      const diagonal = run(Math.SQRT1_2, -Math.SQRT1_2, 0.6);
      const tiny = run(0, -0.10, 1.0);
      reset();
      const idle = { padMove: { x: p.padMove.x, forward: p.padMove.forward } };
      return {
        forward, backward, right, diagonal, tiny, idle,
        expected: { forward: +(walkSpeed * 0.6).toFixed(3), right: +(walkSpeed * 0.6).toFixed(3) },
      };
    }, { walkSpeed: WALK_SPEED });
    const tolerance = 0.2;
    const forwardOk = Math.abs(res.forward.dist - res.expected.forward) <= res.expected.forward * tolerance;
    chk(g, 'left stick forward moves forward (camera-relative)', res.forward.forward > 0.8 * res.forward.dist, res.forward, 'forward component dominates');
    chk(g, 'forward distance within ±20% of walkSpeed*time', forwardOk,
      { dist: res.forward.dist, expected: res.expected.forward, ratio: +(res.forward.dist / res.expected.forward).toFixed(3) }, '±20%');
    chk(g, 'left stick right strafes right (camera-relative)', res.right.right > 0.8 * res.right.dist, res.right, 'right component dominates');
    chk(g, 'right distance within ±20% of walkSpeed*time',
      Math.abs(res.right.dist - res.expected.right) <= res.expected.right * tolerance,
      { dist: res.right.dist, expected: res.expected.right, ratio: +(res.right.dist / res.expected.right).toFixed(3) }, '±20%');
    chk(g, 'stick back moves backwards', res.backward.forward < -0.2, res.backward, 'forward < -0.2');
    chk(g, 'diagonal is not faster than forward', res.diagonal.dist <= res.forward.dist * 1.08,
      { diagonal: res.diagonal.dist, forward: res.forward.dist, ratio: +(res.diagonal.dist / (res.forward.dist || 1)).toFixed(3) }, '<= forward * 1.08');
    chk(g, 'diagonal moves both forward and right', res.diagonal.forward > 0.3 && res.diagonal.right > 0.3, res.diagonal, 'forward>0 and right>0');
    chk(g, '0.10 stick deflection (inside deadzone) moves < 0.05 m', res.tiny.dist < 0.05, { dist: res.tiny.dist }, '<0.05');
    chk(g, 'stick released -> pad move zeroed', res.idle.padMove.x === 0 && res.idle.padMove.forward === 0, res.idle, { x: 0, forward: 0 });
    finish(g);
  });

  // =========================================================================
  // 6. Sprint / jump / crouch
  // =========================================================================
  await group(6, 'Sprint / jump / crouch: LB + L3 sprint ≈7.3 m/s, A jump, B crouch toggle', async (g) => {
    expect(padPage, 'pad page missing');
    await ensurePlaying(padPage, `group ${g.id}`);
    const res = await padPage.evaluate(({ sprintSpeed }) => {
      const s = window.__sandstrike;
      const p = s.player;
      const spawn = s.world.playerSpawn;
      const reset = () => {
        p.reset(spawn);
        p.yaw = 0;
        p.lookPitch = 0;
        p.godMode = true;
        for (let i = 0; i < 17; i += 1) window.__setPadButton(i, false, 0);
        window.__setPadAxis(0, 0); window.__setPadAxis(1, 0);
        s.fastForward(0.2);
      };
      const sprintRun = (buttonIndex) => {
        reset();
        const start = { x: p.position.x, z: p.position.z };
        window.__setPadAxis(1, -1);
        window.__setPadButton(buttonIndex, true, 1);
        s.fastForward(0.8);
        const held = { sprinting: p.sprinting, speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(3) };
        window.__setPadAxis(1, 0);
        window.__setPadButton(buttonIndex, false, 0);
        const end = { x: p.position.x, z: p.position.z };
        s.fastForward(0.3);
        return { dist: +Math.hypot(end.x - start.x, end.z - start.z).toFixed(3), ...held, expected: +(sprintSpeed * 0.8).toFixed(3) };
      };
      const lb = sprintRun(4);
      const l3 = sprintRun(10);
      reset();
      const groundedBefore = p.grounded;
      window.__setPadButton(0, true, 1); // A
      s.fastForward(0.02);
      window.__setPadButton(0, false, 0);
      s.fastForward(0.12);
      const jump = { grounded: p.grounded, y: +p.position.y.toFixed(3), vy: +p.velocity.y.toFixed(3) };
      s.fastForward(1.6);
      const landed = { grounded: p.grounded, y: +p.position.y.toFixed(3) };
      reset();
      window.__setPadButton(1, true, 1); // B
      s.fastForward(0.02);
      window.__setPadButton(1, false, 0);
      s.fastForward(0.4);
      const crouchOn = { crouching: p.crouching, eyeHeight: +p.eyeHeight.toFixed(3), held: p.padCrouchHeld };
      window.__setPadButton(1, true, 1);
      s.fastForward(0.02);
      window.__setPadButton(1, false, 0);
      s.fastForward(0.4);
      const crouchOff = { crouching: p.crouching, eyeHeight: +p.eyeHeight.toFixed(3), held: p.padCrouchHeld };
      reset();
      return { lb, l3, jump, landed, groundedBefore, crouchOn, crouchOff };
    }, { sprintSpeed: SPRINT_SPEED });
    const tolerance = 0.2;
    const sprintOk = (measurement) => Math.abs(measurement.dist - measurement.expected) <= measurement.expected * tolerance;
    chk(g, 'LB + forward reaches sprint speed (±20% of 7.3 m/s)', sprintOk(res.lb) && res.lb.sprinting === true,
      { dist: res.lb.dist, expected: res.lb.expected, sprinting: res.lb.sprinting, speed: res.lb.speed }, '±20% and sprinting=true');
    chk(g, 'L3 also sprints', sprintOk(res.l3) && res.l3.sprinting === true,
      { dist: res.l3.dist, expected: res.l3.expected, sprinting: res.l3.sprinting, speed: res.l3.speed }, '±20% and sprinting=true');
    chk(g, 'A is grounded before the jump', res.groundedBefore === true, res.groundedBefore, true);
    chk(g, 'A leaves the ground and gains height', res.jump.grounded === false && res.jump.y > 0.05, res.jump, { grounded: false, y: '>0.05' });
    chk(g, 'player lands again', res.landed.grounded === true && Math.abs(res.landed.y) < 0.05, res.landed, { grounded: true, y: '≈0' });
    chk(g, 'B toggles crouch on', res.crouchOn.crouching === true, res.crouchOn, { crouching: true });
    chk(g, 'B toggles crouch off', res.crouchOff.crouching === false, res.crouchOff, { crouching: false });
    note(g, 'crouch eye height', { on: res.crouchOn.eyeHeight, off: res.crouchOff.eyeHeight });
    finish(g);
  });

  // =========================================================================
  // 7. Look
  // =========================================================================
  await group(7, 'Look: right stick right lowers yaw, up raises pitch, pitch clamps, 0.10 deflection ignored', async (g) => {
    expect(padPage, 'pad page missing');
    await ensurePlaying(padPage, `group ${g.id}`);
    const res = await padPage.evaluate(({ maxPitch }) => {
      const s = window.__sandstrike;
      const p = s.player;
      const look = (ax, ay, seconds) => {
        window.__setPadAxis(2, 0);
        window.__setPadAxis(3, 0);
        s.fastForward(0.35);
        p.yaw = 0;
        p.lookPitch = 0;
        const yaw0 = p.yaw;
        const pitch0 = p.lookPitch;
        window.__setPadAxis(2, ax);
        window.__setPadAxis(3, ay);
        s.fastForward(seconds);
        window.__setPadAxis(2, 0);
        window.__setPadAxis(3, 0);
        const out = {
          dyaw: +(p.yaw - yaw0).toFixed(4),
          dpitch: +(p.lookPitch - pitch0).toFixed(4),
          pitch: +p.lookPitch.toFixed(4),
          yaw: +p.yaw.toFixed(4),
        };
        s.fastForward(0.25);
        return out;
      };
      return {
        right: look(1, 0, 0.5),
        up: look(0, -1, 0.5),
        clampUp: look(0, -1, 2.5),
        clampDown: look(0, 1, 3.0),
        tiny: look(0.1, 0, 1.0),
        maxPitch,
      };
    }, { maxPitch: MAX_PITCH });
    chk(g, 'right stick right decreases yaw (look right)', res.right.dyaw < -0.2, res.right, 'dyaw < -0.2');
    chk(g, 'right stick up increases pitch (look up)', res.up.dpitch > 0.2, res.up, 'dpitch > 0.2');
    chk(g, 'pitch clamps at +maxPitch', res.clampUp.pitch <= res.maxPitch + 1e-3 && res.clampUp.pitch >= res.maxPitch - 0.02,
      { pitch: res.clampUp.pitch, maxPitch: +res.maxPitch.toFixed(4) }, '≈ +maxPitch');
    chk(g, 'pitch clamps at -maxPitch', res.clampDown.pitch >= -res.maxPitch - 1e-3 && res.clampDown.pitch <= -res.maxPitch + 0.02,
      { pitch: res.clampDown.pitch, maxPitch: +res.maxPitch.toFixed(4) }, '≈ -maxPitch');
    chk(g, '0.10 stick deflection (inside look deadzone) does not move the view', Math.abs(res.tiny.dyaw) < 0.02 && Math.abs(res.tiny.dpitch) < 0.02,
      res.tiny, '|dyaw|,|dpitch| < 0.02');
    finish(g);
  });

  // =========================================================================
  // 8. ADS / fire / reload
  // =========================================================================
  await group(8, 'ADS / fire / reload: LT hold ads>0.8 + FOV drop, RT tap 1 round, RT held ≥4, X reload refills', async (g) => {
    expect(padPage, 'pad page missing');
    await ensurePlaying(padPage, `group ${g.id}`);
    await padPage.evaluate(() => { const s = window.__sandstrike; if (s?.player) s.player.godMode = true; });
    await padSet(padPage, {});
    await advance(padPage, 0.4);
    const hip = await weaponState(padPage); // FOV baseline for the ADS comparison
    await padSet(padPage, { buttons: { 6: 1 } }); // LT
    await advance(padPage, 0.7);
    const adsOn = await weaponState(padPage);
    chk(g, 'LT hold drives weapon.ads > 0.8', adsOn.ads > 0.8, { ads: adsOn.ads }, '>0.8');
    chk(g, 'LT hold lowers the view FOV', adsOn.fov < hip.fov - 5, { fov: adsOn.fov, hipFov: hip.fov }, 'lower than hip FOV by >5');
    chk(g, 'weapon aiming true while LT held', adsOn.aiming === true, adsOn.aiming, true);
    await sleep(250);
    chk(g, 'captured gamepad-04-ads.png', await capture(padPage, 'gamepad-04-ads.png'), qa.screenshots['gamepad-04-ads.png'] ?? null, 'shots/gamepad-04-ads.png');
    await padSet(padPage, {});
    await advance(padPage, 0.7);
    const adsOff = await weaponState(padPage);
    chk(g, 'LT release returns ads < 0.2 and FOV restores', adsOff.ads < 0.2 && Math.abs(adsOff.fov - hip.fov) < 2,
      { ads: adsOff.ads, fov: adsOff.fov, hipFov: hip.fov }, { ads: '<0.2', fov: 'adjacent to hip FOV' });
    const tapFire = await padPage.evaluate(() => {
      const s = window.__sandstrike;
      const w = s.weapon;
      w.mag = 30;
      w.reloading = false;
      w.triggerDown = false;
      w.fireCooldown = 0;
      const before = { mag: w.mag, shots: w.shotsFired };
      window.__setPadButton(7, true, 1); // RT tap
      s.fastForward(0.02);
      window.__setPadButton(7, false, 0);
      s.fastForward(0.15);
      return { before, after: { mag: w.mag, shots: w.shotsFired }, triggerDown: w.triggerDown };
    });
    chk(g, 'RT tap fires exactly one round', tapFire.after.shots - tapFire.before.shots === 1 && tapFire.before.mag - tapFire.after.mag === 1,
      { shotsDelta: tapFire.after.shots - tapFire.before.shots, magDelta: tapFire.before.mag - tapFire.after.mag, triggerDown: tapFire.triggerDown }, { shotsDelta: 1, magDelta: 1 });
    const heldFire = await padPage.evaluate(() => {
      const s = window.__sandstrike;
      const w = s.weapon;
      w.mag = 30;
      w.reloading = false;
      w.triggerDown = false;
      w.fireCooldown = 0;
      const before = w.shotsFired;
      window.__setPadButton(7, true, 1); // RT held
      s.fastForward(0.5);
      const during = { shots: w.shotsFired, mag: w.mag, triggerDown: w.triggerDown };
      window.__setPadButton(7, false, 0);
      const atRelease = { shots: w.shotsFired, mag: w.mag };
      s.fastForward(0.2);
      return { before, during, atRelease, after: { shots: w.shotsFired, mag: w.mag }, triggerDown: w.triggerDown };
    });
    chk(g, 'RT held 0.5 s fires >= 4 rounds (640 rpm)', heldFire.during.shots - heldFire.before >= 4,
      { shots: heldFire.during.shots - heldFire.before, mag: heldFire.during.mag }, '>=4 rounds');
    chk(g, 'RT release stops automatic fire', heldFire.after.shots === heldFire.atRelease.shots && heldFire.triggerDown === false,
      { atRelease: heldFire.atRelease.shots, after: heldFire.after.shots, triggerDown: heldFire.triggerDown }, { stable: true, triggerDown: false });
    const reload = await padPage.evaluate(() => {
      const s = window.__sandstrike;
      const w = s.weapon;
      w.reloading = false;
      w.mag = 10;
      w.reserve = 300;
      w.triggerDown = false;
      const before = { mag: w.mag, magSize: w.magSize };
      window.__setPadButton(2, true, 1); // X
      s.fastForward(0.05);
      window.__setPadButton(2, false, 0);
      s.fastForward(0.1);
      const mid = { reloading: w.reloading };
      s.fastForward(2.6);
      return { before, mid, done: { mag: w.mag, magSize: w.magSize, reloading: w.reloading } };
    });
    chk(g, 'X starts a reload', reload.mid.reloading === true, reload.mid, { reloading: true });
    chk(g, 'magazine refilled after fastForward(2.6)', reload.done.mag === reload.done.magSize && reload.done.reloading === false,
      reload.done, 'mag === magSize');
    finish(g);
  });

  // =========================================================================
  // 9. Look slowdown while ADS
  // =========================================================================
  await group(9, 'ADS look slowdown: yaw delta with LT held <= 70% of the hip-fire delta', async (g) => {
    expect(padPage, 'pad page missing');
    await ensurePlaying(padPage, `group ${g.id}`);
    const res = await padPage.evaluate(() => {
      const s = window.__sandstrike;
      const p = s.player;
      const neutral = () => {
        window.__setPadAxis(2, 0);
        window.__setPadAxis(3, 0);
        window.__setPadButton(6, false, 0);
        s.fastForward(0.45);
      };
      neutral();
      p.yaw = 0;
      const hipStart = p.yaw;
      window.__setPadAxis(2, 1);
      s.fastForward(0.8);
      window.__setPadAxis(2, 0);
      const hipDelta = Math.abs(p.yaw - hipStart);
      s.fastForward(0.4);
      window.__setPadButton(6, true, 1); // LT ADS
      s.fastForward(0.6);
      const ads = s.weapon.ads;
      p.yaw = 0;
      s.fastForward(0.2);
      const adsStart = p.yaw;
      window.__setPadAxis(2, 1);
      s.fastForward(0.8);
      window.__setPadAxis(2, 0);
      const adsDelta = Math.abs(p.yaw - adsStart);
      s.fastForward(0.25);
      window.__setPadButton(6, false, 0);
      s.fastForward(0.6);
      return {
        hipDelta: +hipDelta.toFixed(3),
        adsDelta: +adsDelta.toFixed(3),
        ads: +ads.toFixed(3),
        ratio: +(adsDelta / (hipDelta || 1)).toFixed(3),
      };
    });
    chk(g, 'ADS engaged for the comparison', res.ads > 0.5, res.ads, '>0.5');
    chk(g, 'ADS yaw delta <= 70% of hip-fire yaw delta', res.adsDelta <= res.hipDelta * 0.7,
      { hipDelta: res.hipDelta, adsDelta: res.adsDelta, ratio: res.ratio }, '<= 0.70');
    note(g, 'ADS look ratio', res.ratio);
    finish(g);
  });

  // =========================================================================
  // 10. Pause / resume / hot-plug
  // =========================================================================
  await group(10, 'Pause/resume/hot-plug: START pause+RESUME focus, START/B resume, disconnect auto-pauses + notice, reconnect, nothing stuck', async (g) => {
    expect(padPage, 'pad page missing');
    await ensurePlaying(padPage, `group ${g.id}`);
    await padSet(padPage, {});
    await padTap(padPage, 9); // START
    const paused = await waitState(padPage, 'paused', 12000);
    const pauseScreen = paused && await waitFor(padPage, () => !!document.querySelector('.screen--pause.is-active'), { timeout: 12000, label: 'pause screen active' });
    const resumeFocused = await waitPadFocus(padPage, '[data-action="resume"]', { timeout: 15000 });
    const domPaused = await padDom(padPage);
    chk(g, 'START pauses the run', paused && domPaused.state === 'paused' && domPaused.activeScreen === 'paused',
      { state: domPaused.state, screen: domPaused.activeScreen }, { state: 'paused', screen: 'paused' });
    chk(g, 'pause screen is active', pauseScreen, domPaused.activeScreen, 'paused');
    chk(g, 'RESUME focused with gp-focus', resumeFocused && domPaused.focusedAction === 'resume',
      { focus: domPaused.focus, action: domPaused.focusedAction }, 'gp-focus on [data-action="resume"]');
    note(g, 'pause hints', { resumeKey: domPaused.hints.resumeKey, pauseFoot: domPaused.hints.pauseFoot });
    const pausePainted = await waitOverlayVisible(padPage, '.screen--pause.is-active', { label: 'pause overlay before shot' });
    chk(g, 'pause overlay painted before the shot', pausePainted, await overlaySnapshot(padPage, '.screen--pause'), { opacity: '>=0.6', isActive: true });
    chk(g, 'captured gamepad-05-paused.png', await capture(padPage, 'gamepad-05-paused.png'), qa.screenshots['gamepad-05-paused.png'] ?? null, 'shots/gamepad-05-paused.png');
    await sleep(600); // main.js ignores ui:resume for 420 ms after pauseGame()
    await padTap(padPage, 9); // START resumes
    chk(g, 'START resumes from pause', await waitState(padPage, 'playing', 15000), (await padDom(padPage)).state, 'playing');
    // B in pause resumes.
    await padTap(padPage, 9);
    expect(await waitState(padPage, 'paused', 12000), 'second START did not pause');
    await sleep(650);
    await padTap(padPage, 1); // B
    chk(g, 'B resumes from pause', await waitState(padPage, 'playing', 15000), (await padDom(padPage)).state, 'playing');
    // Hot-plug: hold RT + stick, then unplug.
    await padSet(padPage, { axes: [0, -1, 0, 0], buttons: { 7: 1 } });
    await padTick(padPage, 3);
    const heldInput = await padPage.evaluate(() => {
      const s = window.__sandstrike;
      let st = null;
      try { st = s?.gamepad?.getState?.() ?? null; } catch { st = null; }
      return {
        trigger: s?.weapon?.triggerDown === true,
        triggerSent: st?.triggerSent ?? null,
        move: s?.player ? { x: s.player.padMove.x, forward: s.player.padMove.forward } : null,
      };
    });
    chk(g, 'held RT during the unplug', heldInput.trigger === true, heldInput, { trigger: true });
    await padPage.evaluate(() => window.__setPadConnected(false));
    await padTick(padPage, 6);
    const autoPaused = await waitState(padPage, 'paused', 15000);
    const lostNotice = await waitFor(padPage, () => {
      const rows = [...document.querySelectorAll('[data-notices] .notice')];
      return rows.some((row) => /CONTROLLER LOST/.test(row.getAttribute('data-text') || row.textContent || ''));
    }, { timeout: 12000, label: 'CONTROLLER LOST notice' });
    const lostWarn = await padPage.evaluate(() => [...document.querySelectorAll('[data-notices] .notice')]
      .some((row) => /CONTROLLER LOST/.test(row.getAttribute('data-text') || '') && row.classList.contains('is-warn')));
    const stuckState = await gpState(padPage);
    const stuckWeapon = await weaponState(padPage);
    const stuckPlayer = await playerState(padPage);
    chk(g, 'unplug while playing auto-pauses', autoPaused, (await padDom(padPage)).state, 'paused');
    chk(g, 'warning notice CONTROLLER LOST shown', lostNotice && lostWarn, { shown: lostNotice, warn: lostWarn }, { shown: true, warn: true });
    chk(g, 'nothing stuck: trigger released', stuckWeapon?.triggerDown === false, stuckWeapon?.triggerDown ?? null, false);
    chk(g, 'nothing stuck: sticks zeroed', stuckPlayer?.padMove?.x === 0 && stuckPlayer?.padMove?.forward === 0,
      stuckPlayer?.padMove ?? null, { x: 0, forward: 0 });
    chk(g, 'nothing stuck: sprint released', stuckPlayer?.padSprintHeld === false, stuckPlayer?.padSprintHeld ?? null, false);
    chk(g, 'getState().connected false after unplug', stuckState?.connected === false, stuckState?.connected ?? null, false);
    // Reconnect restores the html class + state.
    await padPage.evaluate(() => window.__setPadConnected(true));
    await padTick(padPage, 6);
    const restoredClass = await waitFor(padPage, () => document.documentElement.classList.contains('is-gamepad'), { timeout: 12000, label: 'is-gamepad restored' });
    const reconnected = await gpState(padPage);
    chk(g, 'reconnect restores html.is-gamepad', restoredClass, restoredClass, true);
    chk(g, 'reconnect restores getState().connected', reconnected?.connected === true, reconnected?.connected ?? null, true);
    await padSet(padPage, {});
    await sleep(650);
    await padTap(padPage, 9); // START resumes the auto-paused run
    chk(g, 'run resumes after reconnecting the pad', await waitState(padPage, 'playing', 15000), (await padDom(padPage)).state, 'playing');
    note(g, 'held input before unplug', heldInput);
    finish(g);
  });

  // =========================================================================
  // 11. Rumble + setting persistence
  // =========================================================================
  await group(11, 'Rumble + persistence: framework log grows on fire, VIBRATION off stops rumble and survives reload', async (g) => {
    expect(padPage, 'pad page missing');
    await ensurePlaying(padPage, `group ${g.id}`);
    await padSet(padPage, {});
    const initial = await gpState(padPage);
    chk(g, 'vibration defaults ON', initial?.vibrationEnabled === true, initial?.vibrationEnabled ?? null, true);
    const fireRumble = await padPage.evaluate(() => {
      const s = window.__sandstrike;
      const w = s.weapon;
      w.mag = 30;
      w.reloading = false;
      w.triggerDown = false;
      w.fireCooldown = 0;
      window.__rumbleLog = [];
      window.__setPadButton(7, true, 1); // RT
      s.fastForward(0.35);
      window.__setPadButton(7, false, 0);
      s.fastForward(0.2);
      const log = window.__rumbleLog || [];
      return { count: log.length, first: log[0] ?? null, shots: w.shotsFired, vibrationEnabled: s.gamepad?.getState?.()?.vibrationEnabled ?? null };
    });
    chk(g, 'window.__rumbleLog grows after firing', fireRumble.count > 0, { count: fireRumble.count, first: fireRumble.first }, '>0');
    chk(g, 'rumble pulse uses the vibrationActuator API shape', !!fireRumble.first && typeof fireRumble.first.type === 'string',
      fireRumble.first, 'playEffect(type, params)');
    note(g, 'rumble entries after firing', fireRumble.count);
    // Pause -> open the second-level SYSTEM CONFIG menu -> VIBRATION off.
    await padTap(padPage, 9);
    expect(await waitState(padPage, 'paused', 12000), 'could not pause for the vibration toggle');
    await sleep(500);
    const pauseSettingsOpened = await openSettings(padPage);
    chk(g, 'pause SYSTEM CONFIG second-level menu opens', pauseSettingsOpened, { pauseSettingsOpened }, true);
    const toggled = await padPage.evaluate(() => {
      const btn = document.querySelector('.screen--pause.is-active [data-action="vibrate"]')
        || document.querySelector('.screen--pause [data-action="vibrate"]');
      if (!btn) return { ok: false, reason: 'VIBRATION toggle missing from the pause settings panel' };
      btn.click();
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem('sandstrike.settings.v1') || '{}'); } catch { stored = null; }
      return {
        ok: true,
        pressed: btn.getAttribute('aria-pressed'),
        label: (btn.querySelector('[data-vibrate-label]')?.textContent || '').trim(),
        storedVibrate: stored ? stored.vibrate : null,
      };
    });
    chk(g, 'VIBRATION toggle exists in the pause settings', toggled.ok, toggled.reason ?? 'clicked', true);
    const disabled = toggled.ok && await waitFor(padPage, () => {
      const gp = window.__sandstrike?.gamepad ?? window.__sandstrikeApp?.gamepad;
      let st = null;
      try { st = gp?.getState?.() ?? null; } catch { st = null; }
      return st?.vibrationEnabled === false;
    }, { timeout: 12000, label: 'vibrationEnabled false' });
    chk(g, 'VIBRATION off updates the UI label', toggled.label === 'DISABLED' && toggled.pressed === 'false',
      { label: toggled.label, pressed: toggled.pressed }, { label: 'DISABLED', pressed: 'false' });
    chk(g, "localStorage['sandstrike.settings.v1'].vibrate === false", toggled.storedVibrate === false, toggled.storedVibrate, false);
    chk(g, 'getState().vibrationEnabled === false', disabled === true, disabled, true);
    await closeSettings(padPage);
    await sleep(650);
    await padTap(padPage, 9); // resume
    expect(await waitState(padPage, 'playing', 12000), 'could not resume after the vibration toggle');
    const fireMuted = await padPage.evaluate(() => {
      const s = window.__sandstrike;
      const w = s.weapon;
      w.mag = 30;
      w.reloading = false;
      w.triggerDown = false;
      w.fireCooldown = 0;
      const before = Array.isArray(window.__rumbleLog) ? window.__rumbleLog.length : -1;
      window.__setPadButton(7, true, 1);
      s.fastForward(0.35);
      window.__setPadButton(7, false, 0);
      s.fastForward(0.15);
      const after = Array.isArray(window.__rumbleLog) ? window.__rumbleLog.length : -1;
      return { before, after, shots: w.shotsFired };
    });
    chk(g, 'no rumble pulses while VIBRATION is off', fireMuted.after === fireMuted.before,
      { before: fireMuted.before, after: fireMuted.after, shots: fireMuted.shots }, 'unchanged');
    // Reload: the setting must persist and the module must boot with it off.
    const errorsBefore = qa.consoleErrors.pad.length;
    await padPage.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    const ready = await waitForAppReady(padPage, 'pad');
    qa.timings.padReload2 = ready.ms;
    console.log(`  [boot] padReload2 ready=${ready.ok} in ${(ready.ms / 1000).toFixed(1)}s${ready.reason ? ` (${ready.reason})` : ''}`);
    chk(g, 'reload after the settings change', ready.ok, ready.ok ? 'loaded' : ready.reason, 'loaded');
    if (!ready.ok) { finish(g); return; }
    await installPageHelpers(padPage);
    const menuReady = await waitMenuReady(padPage, 40000);
    chk(g, 'menu ready after reload', menuReady, menuReady, true);
    await padTick(padPage, 4);
    const persisted = await padPage.evaluate(() => {
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem('sandstrike.settings.v1') || '{}'); } catch { stored = null; }
      const gp = window.__sandstrike?.gamepad ?? window.__sandstrikeApp?.gamepad;
      let st = null;
      try { st = gp?.getState?.() ?? null; } catch { st = null; }
      return {
        storedVibrate: stored ? stored.vibrate : null,
        vibrationEnabled: st?.vibrationEnabled ?? null,
        connected: st?.connected ?? null,
        toggles: [...document.querySelectorAll('[data-action="vibrate"]')].map((el) => ({
          pressed: el.getAttribute('aria-pressed'),
          label: (el.querySelector('[data-vibrate-label]')?.textContent || '').trim(),
        })),
      };
    });
    chk(g, 'reload keeps vibrate=false in localStorage', persisted.storedVibrate === false, persisted.storedVibrate, false);
    chk(g, 'reloaded module starts with vibrationEnabled=false', persisted.vibrationEnabled === false, persisted.vibrationEnabled, false);
    chk(g, 'reloaded settings toggle shows DISABLED', persisted.toggles.length >= 2
      && persisted.toggles.every((toggle) => toggle.pressed === 'false' && /DISABLED/i.test(toggle.label)),
    persisted.toggles, 'both DISABLED/aria-pressed=false');
    chk(g, 'pad still connected after reload', persisted.connected === true, persisted.connected, true);
    chk(g, 'no console errors after reload', qa.consoleErrors.pad.length === errorsBefore, qa.consoleErrors.pad.slice(errorsBefore), []);
    // gamepad-06: the second-level SYSTEM CONFIG menu with the controller +
    // vibration rows visible together.
    const settingsForShot = await openSettings(padPage);
    chk(g, 'SYSTEM CONFIG second-level menu open for the settings shot', settingsForShot, { settingsForShot }, true);
    const rows = await ensureVisible(padPage, [
      '.screen--menu.is-active [data-settings].is-open [data-pad-status]',
      '.screen--menu.is-active [data-settings].is-open [data-action="vibrate"]',
    ]);
    const bothVisible = Object.values(rows).every((entry) => entry?.inView === true);
    chk(g, 'controller + vibration rows visible for the settings shot', bothVisible, rows, 'both in viewport');
    const settingsPainted = await waitOverlayVisible(padPage, '.screen--menu.is-active [data-settings].is-open', { label: 'settings overlay before shot' });
    chk(g, 'settings overlay painted before the settings shot', settingsPainted,
      await overlaySnapshot(padPage, '.screen--menu [data-settings].is-open'), { opacity: '>=0.6', isOpen: true });
    chk(g, 'captured gamepad-06-settings.png', await capture(padPage, 'gamepad-06-settings.png'), qa.screenshots['gamepad-06-settings.png'] ?? null, 'shots/gamepad-06-settings.png');
    await closeSettings(padPage).catch(() => false);
    finish(g);
  }, { timeout: BOOT_TIMEOUT + 120_000 });

  // =========================================================================
  // 12. PlayStation + keyboard fallback
  // =========================================================================
  await group(12, 'PlayStation id -> PLAYSTATION status + ✕/○ legend; disconnect restores keyboard; W moves, mouse fires', async (g) => {
    expect(padPage, 'pad page missing');
    await waitMenuReady(padPage, 30000).catch(() => false);
    // PlayStation id, reconnect so the module re-detects the family.
    await padPage.evaluate(() => {
      window.__setPadId('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)');
      window.__setPadConnected(false);
    });
    await padTick(padPage, 4);
    await padPage.evaluate(() => window.__setPadConnected(true));
    await padTick(padPage, 6);
    const psReady = await waitFor(padPage, () => {
      const gp = window.__sandstrike?.gamepad ?? window.__sandstrikeApp?.gamepad;
      let st = null;
      try { st = gp?.getState?.() ?? null; } catch { st = null; }
      const status = [...document.querySelectorAll('[data-pad-status]')].map((el) => el.textContent || '').join(' | ');
      return st?.kind === 'playstation' && /PLAYSTATION/.test(status);
    }, { timeout: 20000, label: 'PlayStation detected' });
    const ps = await gpState(padPage);
    const psDom = await padDom(padPage);
    const psStatuses = psDom?.statuses ?? [];
    chk(g, 'PlayStation pad id -> kind playstation', psReady && ps?.kind === 'playstation', { kind: ps?.kind ?? null, id: ps?.id ?? null }, 'playstation');
    chk(g, 'status shows PLAYSTATION · CONNECTED', psStatuses.length >= 2
      && psStatuses.every((row) => /PLAYSTATION/i.test(row.text) && /CONNECTED/i.test(row.text)),
    psStatuses.map((row) => row.text), 'PLAYSTATION · CONNECTED');
    const psLegendReady = await waitFor(padPage, () => {
      const list = document.querySelector('.controls-list');
      if (!list) return false;
      const kbd = [...list.querySelectorAll('kbd')].map((k) => (k.textContent || '').trim());
      return kbd.includes('✕') && kbd.includes('○');
    }, { timeout: 20000, label: 'PlayStation legend glyphs' });
    const psLegendDom = await padDom(padPage);
    const psKbd = (psLegendDom?.lists?.find((list) => list.visible) || psLegendDom?.lists?.[0] || { kbd: [] }).kbd;
    chk(g, 'legend shows PlayStation glyphs ✕/○', psLegendReady && psKbd.includes('✕') && psKbd.includes('○'), psKbd, 'contains ✕ and ○');
    note(g, 'PlayStation legend badges', psKbd);
    // Disconnect -> keyboard legend returns.
    await padPage.evaluate(() => window.__setPadConnected(false));
    await padTick(padPage, 6);
    const kbLegendReady = await waitFor(padPage, () => {
      const list = document.querySelector('.controls-list');
      if (!list) return false;
      const text = (list.textContent || '').replace(/\s+/g, ' ');
      const kbd = [...list.querySelectorAll('kbd')].map((k) => (k.textContent || '').trim());
      return /WASD/.test(text) && /MOUSE/.test(text) && !kbd.includes('RT');
    }, { timeout: 20000, label: 'keyboard legend restored' });
    const kbLegendDom = await padDom(padPage);
    const kbKbd = (kbLegendDom?.lists?.find((list) => list.visible) || kbLegendDom?.lists?.[0] || { kbd: [] }).kbd;
    chk(g, 'disconnect restores the keyboard legend (WASD/MOUSE/ESC)', kbLegendReady && kbKbd.includes('MOUSE') && kbKbd.includes('ESC'),
      kbKbd, 'keyboard legend');
    chk(g, 'html.is-gamepad removed after disconnect', kbLegendDom?.isGamepad === false, kbLegendDom?.isGamepad ?? null, false);
    // Keyboard + mouse fallback: start the run with the mouse, move with W, fire with a click.
    const mouseStart = await startRunWithMouse(padPage);
    chk(g, 'mouse click START + deploy still starts a run', mouseStart.ok, mouseStart, true);
    const kbMove = await keyboardForwardCheck(padPage, 0.5);
    chk(g, 'keyboard W still moves the player', (kbMove.forward ?? 0) > 0.4, kbMove, 'forward > 0.4 m');
    const mouseFire = await mouseFireCheck(padPage);
    chk(g, 'mouse click still fires after the pointer-lock click', (mouseFire?.delta ?? 0) > 0, mouseFire, 'mag/shots drop');
    note(g, 'pointerLockElement after the canvas click', mouseFire.lock);
    // Supplementary keyboard/mouse reference context WITHOUT the fake-pad init
    // script (§8 preamble). Free the heavy 1600×900 software renderer first.
    if (padCtx) {
      await padCtx.close().catch(() => {});
      padCtx = null;
      padPage = null;
    }
    const reference = await openKeyboardReference();
    if (!reference.ok) {
      note(g, 'keyboard-reference context skipped (supplementary)', reference.reason);
    } else {
      keyboardCtx = reference.context;
      keyboardPage = reference.page;
      chk(g, 'keyboard-reference context boots without the init script', true, 'loaded', 'loaded');
      const refGp = await gpState(keyboardPage);
      chk(g, 'keyboard-reference context has no connected pad', !!refGp && refGp.connected === false,
        { hasGamepad: !!refGp, connected: refGp?.connected ?? null }, { connected: false });
      const refStart = await startRunWithMouse(keyboardPage);
      chk(g, 'keyboard-reference mouse START+deploy works', refStart.ok, refStart, true);
      if (refStart.ok) {
        const refMove = await keyboardForwardCheck(keyboardPage, 0.5);
        chk(g, 'keyboard-reference W moves the player', (refMove.forward ?? 0) > 0.4, refMove, 'forward > 0.4 m');
        const refFire = await mouseFireCheck(keyboardPage);
        chk(g, 'keyboard-reference mouse click fires', refFire.delta > 0, refFire, 'mag/shots drop');
      }
      chk(g, 'keyboard-reference context 0 console errors', qa.consoleErrors.keyboard.length === 0, qa.consoleErrors.keyboard.slice(0, 3), []);
    }
    if (keyboardCtx) {
      await keyboardCtx.close().catch(() => {});
      keyboardCtx = null;
      keyboardPage = null;
    }
    finish(g);
  }, { timeout: BOOT_TIMEOUT + 150_000 });

  // =========================================================================
  // 13. Console + fresh screenshots
  // =========================================================================
  await group(13, 'Console + screenshots: 0 console/page errors, 7 fresh gamepad-*.png (1600×900 + 844×390)', async (g) => {
    // Mobile screenshot pass: 844×390, touch=1, fake pad connected.
    mobileCtx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
    await mobileCtx.addInitScript(FAKE_PAD_INIT);
    const opened = await withTimeout(openPadPage(mobileCtx, 'mobile', 'mobilePad', TOUCH_QUERY), 180_000, 'mobile boot')
      .catch((error) => ({ page: null, ready: { ok: false, reason: error?.message || String(error) } }));
    mobilePage = opened.page;
    chk(g, 'mobile (touch) page loaded', opened.ready.ok, opened.ready.ok ? 'loaded' : opened.ready.reason, 'loaded');
    if (opened.ready.ok) {
      const menuReady = await waitMenuReady(mobilePage, 40000);
      chk(g, 'mobile menu ready', menuReady, menuReady, true);
      await padTick(mobilePage, 4);
      const mobileDom = await padDom(mobilePage);
      chk(g, 'touch layout intact: html.is-touch set', mobileDom.isTouch === true, mobileDom.isTouch, true);
      chk(g, 'pad status visible on the touch layout', mobileDom.statuses.length >= 2
        && mobileDom.statuses.every((row) => /CONNECTED/i.test(row.text)), mobileDom.statuses.map((row) => row.text), 'XBOX · CONNECTED');
      const layout = await mobilePage.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        bodyW: document.body.scrollWidth,
        innerW: innerWidth,
        touchUi: !!document.querySelector('.touch-ui'),
        start: (() => { const el = document.querySelector('[data-start]'); return el ? { disabled: !!el.disabled, w: +el.getBoundingClientRect().width.toFixed(1) } : null; })(),
        touchLegend: (() => { const list = document.querySelector('.controls-list'); return list ? { kbd: [...list.querySelectorAll('kbd')].map((k) => k.textContent.trim()), badges: [...list.querySelectorAll('.ctrl-badge')].map((b) => b.textContent.trim()) } : null; })(),
      }));
      chk(g, 'touch layout intact: no horizontal overflow', layout.scrollW <= layout.innerW + 1 && layout.bodyW <= layout.innerW + 1,
        { scrollW: layout.scrollW, bodyW: layout.bodyW, innerW: layout.innerW }, '<= innerWidth+1');
      chk(g, 'touch layout intact: touch layer + START present', layout.touchUi && !!layout.start && !layout.start.disabled,
        { touchUi: layout.touchUi, start: layout.start }, { touchUi: true, startEnabled: true });
      note(g, 'mobile legend stays touch-first', layout.touchLegend);
      const mobileSettingsOpen = await openSettings(mobilePage);
      chk(g, 'mobile SYSTEM CONFIG second-level menu opens', mobileSettingsOpen, { mobileSettingsOpen }, true);
      const rows = await ensureVisible(mobilePage, ['.screen--menu.is-active [data-settings].is-open [data-pad-status]']);
      chk(g, 'mobile pad status row in viewport for the shot', rows['.screen--menu.is-active [data-settings].is-open [data-pad-status]']?.inView === true, rows, true);
      const mobilePainted = await waitOverlayVisible(mobilePage, '.screen--menu.is-active [data-settings].is-open', { label: 'mobile settings overlay before shot' });
      chk(g, 'mobile settings overlay painted before the shot', mobilePainted,
        await overlaySnapshot(mobilePage, '.screen--menu [data-settings].is-open'), { opacity: '>=0.6', isOpen: true });
      chk(g, 'captured gamepad-07-mobile-pad.png', await capture(mobilePage, 'gamepad-07-mobile-pad.png'), qa.screenshots['gamepad-07-mobile-pad.png'] ?? null, 'shots/gamepad-07-mobile-pad.png');
      chk(g, 'mobile context 0 console errors', qa.consoleErrors.mobile.length === 0, qa.consoleErrors.mobile.slice(0, 3), []);
    }
    // Free the renderer before validating the capture files.
    if (mobileCtx) {
      await mobileCtx.close().catch(() => {});
      mobileCtx = null;
      mobilePage = null;
    }
    // Fresh screenshot files: existence, PNG magic + expected dimensions.
    const info = {};
    for (const name of SHOT_NAMES) {
      const path = join(OUT, name);
      const file = await stat(path).catch(() => null);
      if (!file) { info[name] = null; continue; }
      const buffer = await readFile(path);
      const isPng = buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47;
      info[name] = {
        bytes: buffer.length,
        width: isPng ? buffer.readUInt32BE(16) : null,
        height: isPng ? buffer.readUInt32BE(20) : null,
      };
    }
    qa.screenshotInfo = info;
    const missing = SHOT_NAMES.filter((name) => !info[name] || info[name].bytes < 20_000);
    chk(g, 'all 7 fresh screenshots captured (>=20 KB)', missing.length === 0, { missing, captured: SHOT_NAMES.length - missing.length }, 7);
    const desktopShots = SHOT_NAMES.slice(0, 6);
    chk(g, 'desktop screenshots are 1600×900', desktopShots.every((name) => info[name]?.width === 1600 && info[name]?.height === 900),
      desktopShots.map((name) => info[name] && `${name.replace('gamepad-', '')}:${info[name].width}x${info[name].height}`), '1600x900');
    chk(g, 'mobile screenshot is 844×390', info['gamepad-07-mobile-pad.png']?.width === 844 && info['gamepad-07-mobile-pad.png']?.height === 390,
      info['gamepad-07-mobile-pad.png'], '844x390');
    note(g, 'screenshot sizes', Object.fromEntries(Object.entries(info).map(([name, entry]) => [name, entry && `${entry.width}x${entry.height} ${Math.round(entry.bytes / 1024)}KB`])));
    // §8 group 13: zero console errors and pageerrors in the pad context (and the others).
    chk(g, 'zero console/page errors (pad context)', qa.consoleErrors.pad.length === 0, qa.consoleErrors.pad.slice(0, 5), []);
    chk(g, 'zero console/page errors (mobile context)', qa.consoleErrors.mobile.length === 0, qa.consoleErrors.mobile.slice(0, 5), []);
    chk(g, 'zero console/page errors (keyboard-reference context)', qa.consoleErrors.keyboard.length === 0, qa.consoleErrors.keyboard.slice(0, 5), []);
    note(g, 'console warnings', {
      pad: qa.consoleWarnings.pad.slice(0, 3),
      mobile: qa.consoleWarnings.mobile.slice(0, 3),
      keyboard: qa.consoleWarnings.keyboard.slice(0, 3),
    });
    finish(g);
  }, { timeout: BOOT_TIMEOUT + 150_000 });
} catch (error) {
  qa.fatal = error?.stack || error?.message || String(error);
  console.error('\nFATAL', qa.fatal);
  try {
    if (padPage) await padPage.screenshot({ path: join(OUT, 'gamepad-00-fatal.png') });
  } catch { /* ignore */ }
} finally {
  // -------------------------------------------------------------------------
  // Summary + JSON + clean shutdown
  // -------------------------------------------------------------------------
  qa.finishedAt = new Date().toISOString();
  qa.durationMs = elapsed();
  const groups = qa.groups;
  const passed = groups.filter((entry) => entry.pass).length;
  const failed = groups.filter((entry) => !entry.pass);
  qa.passed = passed;
  qa.total = 13;
  qa.failed = failed.map((entry) => entry.id);
  qa.notRun = Math.max(0, 13 - groups.length);
  qa.ok = !qa.fatal && failed.length === 0 && groups.length === 13;
  for (const bucket of Object.keys(qa.consoleErrors)) {
    qa.consoleErrors[bucket] = qa.consoleErrors[bucket].slice(0, 40);
    qa.consoleWarnings[bucket] = qa.consoleWarnings[bucket].slice(0, 20);
  }
  await writeFile(join(OUT, 'gamepad-probe.json'), JSON.stringify(qa, null, 2), 'utf8').catch((error) => {
    console.error('could not write shots/gamepad-probe.json', error);
  });

  console.log('\n────────── gamepad-probe summary ──────────');
  for (const entry of groups) {
    const mark = entry.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const timing = `(${(entry.durationMs / 1000).toFixed(1)}s)`;
    console.log(`${mark} [${entry.id}/13] ${entry.title} ${timing}`);
    if (!entry.pass) console.log(`      ${entry.error}`);
  }
  if (qa.notRun > 0) console.log(`\x1b[31m✗\x1b[0m ${qa.notRun} groups never ran (fatal error)`);
  const shots = SHOT_NAMES.filter((name) => qa.screenshots[name]);
  console.log(`\nshots: ${shots.length}/7 — ${shots.join(', ')}`);
  console.log(`json: shots/gamepad-probe.json`);
  console.log(`gamepad-probe: ${passed}/13 groups passed — ${(qa.durationMs / 1000).toFixed(1)}s`);
  if (failed.length || qa.fatal) {
    console.log(`failed: ${failed.map((entry) => '#' + entry.id).join(', ') || 'fatal'} — see shots/gamepad-probe.json`);
    if (qa.consoleErrors.pad.length) console.log('pad console errors:', qa.consoleErrors.pad.slice(0, 8).join('\n'));
  }

  for (const context of [mobileCtx, keyboardCtx, padCtx]) {
    if (context) await context.close().catch(() => {});
  }
  await browser.close().catch(() => {});

  if (!qa.ok) process.exitCode = 1;
}
