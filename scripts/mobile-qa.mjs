/**
 * SANDSTRIKE mobile QA harness — MOBILE_SPEC.md §8.
 *
 *   node scripts/mobile-qa.mjs [url]
 *
 * Emulates a touch phone and asserts the 14 groups from §8, writes
 * shots/mobile-qa.json + the seven shots/mobile-*.png screenshots and exits 1
 * on any failure.
 *
 * Rendering note: under SwiftShader a 844×390 @ DPR 3 page composites at
 * 2532×1170 in software, which drops the frame rate to ~0–1.5 fps and makes
 * any wall-clock "wait N ms then assert" flaky. So:
 *   - behaviour groups (1-11) run in a DPR 1 isMobile/hasTouch context and use
 *     the `__sandstrike.fastForward()` dev hook to advance the simulation
 *     deterministically, independent of frame rate;
 *   - the seven screenshots (and the portrait rotate-hint group) run in the
 *     spec-mandated DPR 3 contexts, where they only need CSS transitions and a
 *     few real touches.
 * Only one page/context is kept alive at a time (except while capturing).
 *
 * Requires the local server (`node serve.mjs`, default http://127.0.0.1:8080)
 * and a Chrome/Chromium install (SwiftShader args mirrored from scripts/qa.mjs).
 */
import { chromium } from 'playwright-core';
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const URL_BASE = (process.argv[2] || process.env.MOBILE_QA_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = resolve('shots');
const DPR = 3;
const BEHAVIOR_DPR = 1;
const LANDSCAPE = { width: 844, height: 390 };
const PORTRAIT = { width: 390, height: 844 };
const DESKTOP = { width: 1600, height: 900 };
const TOUCH_QUERY = 'dev=1&quality=medium&touch=1';
const DESKTOP_QUERY = 'dev=1&quality=medium';
const BOOT_TIMEOUT = 240_000;
const GROUP_TIMEOUT = 90_000;
/** Screenshots required by §8 item 13, in capture order. */
const SHOT_NAMES = [
  'mobile-01-menu-landscape.png',
  'mobile-02-playing-landscape.png',
  'mobile-03-fire.png',
  'mobile-04-paused.png',
  'mobile-05-menu-portrait.png',
  'mobile-06-portrait-rotate-hint.png',
  'mobile-07-end.png',
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
    landscape: LANDSCAPE,
    portrait: PORTRAIT,
    desktop: DESKTOP,
    screenshotDeviceScaleFactor: DPR,
    behaviorDeviceScaleFactor: BEHAVIOR_DPR,
    touchQuery: TOUCH_QUERY,
    desktopQuery: DESKTOP_QUERY,
    note: 'behaviour groups run at DPR 1 + fastForward (SwiftShader 0-1.5 fps at DPR 3); screenshots stay at spec DPR 3',
  },
  groups: [],
  screenshots: {},
  screenshotInfo: {},
  consoleErrors: { landscape: [], portrait: [], desktop: [] },
  consoleWarnings: { landscape: [], portrait: [], desktop: [] },
  errors: [],
  timings: {},
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
  try {
    return await Promise.race([
      promise,
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
  console.log(`\n── [${id}/14] ${title}`);
  try {
    await withTimeout(Promise.resolve().then(() => fn(g)), timeout, `group ${id}`);
    g.pass = true;
    const brief = g.checks.map((c) => `${c.name}=${fmt(c.actual)}`).join(' · ');
    console.log(`\x1b[32m✓\x1b[0m [${id}/14] ${title}${brief ? ` — ${brief}` : ''}`);
  } catch (error) {
    g.error = error instanceof Failure ? error.message : (error?.stack || error?.message || String(error));
    console.log(`\x1b[31m✗\x1b[0m [${id}/14] ${title} — ${g.error}`);
  }
  g.durationMs = elapsed() - g.startedAt;
  qa.timings[`group${id}`] = g.durationMs;
  return g.pass;
}

// ---------------------------------------------------------------------------
// In-page helpers
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

async function installPageHelpers(page) {
  await page.evaluate(() => {
    if (window.__qa) return;
    const rectOf = (element) => {
      const r = element.getBoundingClientRect();
      return {
        x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1),
        cx: +(r.x + r.width / 2).toFixed(1), cy: +(r.y + r.height / 2).toFixed(1),
      };
    };
    window.__qa = {
      /** Visibility once every ancestor's display/visibility/opacity is applied. */
      effective(selector) {
        const element = document.querySelector(selector);
        if (!element) return { found: false, visible: false, reason: 'missing', vw: innerWidth, vh: innerHeight };
        let opacity = 1;
        let node = element;
        let hiddenReason = null;
        while (node && node.nodeType === 1) {
          const cs = getComputedStyle(node);
          if (cs.display === 'none') { hiddenReason = 'display:none'; opacity = 0; break; }
          if (cs.visibility === 'hidden' || cs.visibility === 'collapse') {
            hiddenReason = 'visibility:hidden'; opacity = 0; break;
          }
          opacity *= parseFloat(cs.opacity || '1');
          node = node.parentElement;
        }
        const r = element.getBoundingClientRect();
        const base = {
          found: true,
          rect: rectOf(element),
          vw: innerWidth,
          vh: innerHeight,
          display: getComputedStyle(element).display,
        };
        if (hiddenReason) return { ...base, visible: false, reason: hiddenReason, opacity: 0, inViewport: false };
        const inViewport = r.width > 0 && r.height > 0
          && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
        return { ...base, visible: opacity > 0.05 && r.width > 0 && r.height > 0, opacity: +opacity.toFixed(3), inViewport };
      },
      hit(x, y) {
        const element = document.elementFromPoint(x, y);
        if (!element) return { tag: null, action: null, cls: '' };
        return {
          tag: element.tagName,
          cls: typeof element.className === 'string' ? element.className.slice(0, 60) : '',
          action: element.closest?.('[data-touch-action]')?.getAttribute('data-touch-action') || null,
        };
      },
      hitInside(selector, x, y) {
        const element = document.querySelector(selector);
        const hit = document.elementFromPoint(x, y);
        return !!element && !!hit && (hit === element || element.contains(hit));
      },
      /**
       * Deterministically pick a point inside `selector` that really hit-tests to
       * that element (so a covering layer/button cannot silently swallow input).
       * opts: preferX/preferY (0..1), avoidAction, minX/maxX/minY/maxY.
       */
      pick(selector, opts = {}) {
        const element = document.querySelector(selector);
        if (!element) return { ok: false, reason: 'missing ' + selector };
        const r = element.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return { ok: false, reason: 'zero-size ' + selector, rect: rectOf(element) };
        const preferX = opts.preferX ?? 0.5;
        const preferY = opts.preferY ?? 0.5;
        const avoidAction = opts.avoidAction !== false;
        const ownAction = !!element.closest('[data-touch-action]');
        const minX = opts.minX ?? 2;
        const maxX = opts.maxX ?? innerWidth - 2;
        const minY = opts.minY ?? 2;
        const maxY = opts.maxY ?? innerHeight - 2;
        const candidates = [];
        for (let iy = 1; iy <= 9; iy++) {
          for (let ix = 1; ix <= 9; ix++) {
            const fx = ix / 10;
            const fy = iy / 10;
            const x = r.left + r.width * fx;
            const y = r.top + r.height * fy;
            if (x < minX || y < minY || x > maxX || y > maxY) continue;
            const hit = document.elementFromPoint(x, y);
            if (!hit) continue;
            if (!(hit === element || element.contains(hit))) continue;
            if (avoidAction && !ownAction && hit.closest('[data-touch-action]')) continue;
            candidates.push({
              x: +x.toFixed(1),
              y: +y.toFixed(1),
              d: Math.hypot((fx - preferX) * r.width, (fy - preferY) * r.height),
            });
          }
        }
        if (!candidates.length) return { ok: false, reason: 'no hittable point inside ' + selector, rect: rectOf(element) };
        candidates.sort((a, b) => a.d - b.d);
        return { ok: true, x: candidates[0].x, y: candidates[0].y, rect: rectOf(element), candidates: candidates.length };
      },
      /** One-shot snapshot of the touch layer + pointer lock + is-touch state. */
      touchUiState() {
        const ui = document.querySelector('.touch-ui');
        const cs = ui ? getComputedStyle(ui) : null;
        const lock = document.pointerLockElement;
        return {
          found: !!ui,
          visibleClass: !!ui && ui.classList.contains('is-visible'),
          ariaHidden: ui?.getAttribute('aria-hidden') ?? null,
          opacity: cs ? +parseFloat(cs.opacity || '0').toFixed(2) : null,
          isTouchClass: document.documentElement.classList.contains('is-touch'),
          pointerLock: lock ? `${lock.tagName}#${lock.id || ''}` : null,
        };
      },
      /** One-shot snapshot of the deploy (difficulty) modal. */
      deployState() {
        const el = document.querySelector('[data-deploy]');
        const cs = el ? getComputedStyle(el) : null;
        return {
          found: !!el,
          isOpen: !!el && el.classList.contains('is-open'),
          ariaHidden: el?.getAttribute('aria-hidden') ?? null,
          opacity: cs ? +parseFloat(cs.opacity || '0').toFixed(2) : null,
          visibility: cs?.visibility ?? null,
          card: window.__qa.pick('[data-deploy-value="standard"]', { avoidAction: false }),
          hardcoreCard: window.__qa.pick('[data-deploy-value="hardcore"]', { avoidAction: false }),
        };
      },
      /** One-shot snapshot of menu / start button geometry + overflow. */
      menuState() {
        const menu = document.querySelector('.screen--menu');
        const menuCs = menu ? getComputedStyle(menu) : null;
        const start = window.__qa.effective('[data-start]');
        return {
          menuActive: !!menu && menu.classList.contains('is-active'),
          menuOpacity: menuCs ? +parseFloat(menuCs.opacity || '0').toFixed(2) : null,
          start,
          point: window.__qa.pick('[data-start]', { avoidAction: false }),
          overflow: {
            docScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            innerWidth,
            innerHeight,
          },
        };
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Waiting / capture / input helpers
// ---------------------------------------------------------------------------
/**
 * Poll for a page condition; returns true/false instead of throwing.
 * IMPORTANT: under SwiftShader a frame can take >700 ms, so CSS transitions and
 * class-driven visibility only advance when a frame is composited. Never assert
 * on computed opacity straight after a fixed sleep — poll instead.
 */
async function waitFor(page, fn, { timeout = 8000, polling = 200, label = '', arg = null } = {}) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling });
    return true;
  } catch {
    if (label) console.log(`    · waitFor "${label}" timed out after ${timeout}ms`);
    return false;
  }
}

/** Wait until the touch layer is actually visible (class + composited opacity). */
const waitUiVisible = (page, { timeout = 8000, minOpacity = 0.5 } = {}) => waitFor(page, (min) => {
  const ui = document.querySelector('.touch-ui');
  if (!ui || !ui.classList.contains('is-visible')) return false;
  return parseFloat(getComputedStyle(ui).opacity || '0') >= min;
}, { timeout, label: '.touch-ui visible', arg: minOpacity });

/** Wait until a control is really hit-testable, then return its point. */
async function pickWhenReady(page, selector, opts = {}, { timeout = 8000 } = {}) {
  await waitFor(page, (payload) => window.__qa.pick(payload.selector, payload.opts).ok, {
    timeout, label: `hittable ${selector}`, arg: { selector, opts },
  });
  return page.evaluate((payload) => window.__qa.pick(payload.selector, payload.opts), { selector, opts });
}

/** Wait until the deploy dialog is open, visible and its STANDARD card is hittable. */
const waitDeployOpen = (page, { timeout = 10000 } = {}) => waitFor(page, () => {
  const deploy = document.querySelector('[data-deploy]');
  if (!deploy || !deploy.classList.contains('is-open')) return false;
  if (deploy.getAttribute('aria-hidden') !== 'false') return false;
  const cs = getComputedStyle(deploy);
  if (cs.visibility === 'hidden' || parseFloat(cs.opacity || '0') < 0.5) return false;
  return window.__qa.pick('[data-deploy-value="standard"]', { avoidAction: false }).ok;
}, { timeout, label: 'deploy dialog visible' });

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

/** Create a touch context + page, navigate, wait for the app, install helpers. */
async function openTouchPage(context, page, bucket, label, query = TOUCH_QUERY) {
  const ready = await waitForAppReady(page, bucket);
  qa.timings[`${label}Boot`] = ready.ms;
  console.log(`  [boot] ${label} ready=${ready.ok} in ${(ready.ms / 1000).toFixed(1)}s${ready.reason ? ` (${ready.reason})` : ''}`);
  if (ready.ok) await installPageHelpers(page);
  return ready;
}

const freeze = (page, value = true) => page.evaluate((v) => window.__sandstrike?.freeze?.(v), value).catch(() => {});
/** Advance the simulation deterministically (dev hook) — independent of frame rate. */
const advance = (page, seconds) => page.evaluate((s) => window.__sandstrike?.fastForward?.(s) ?? null, seconds).catch(() => null);
/** Real touch tap on a button. State changes are synchronous / CSS-timed. */
async function tap(page, x, y) {
  await page.touchscreen.tap(x, y);
}

/**
 * Freeze + renderOnce + short settle, then capture (scripts/qa.mjs pattern).
 * Pins the mobile adaptive-resolution scale to 1.0 first so the shot is crisp,
 * then restores the previous scale.
 */
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
    console.log(`    ▸ captured shots/${name}${previousScale != null ? ` (adaptiveScale ${previousScale}->1)` : ''}`);
    await page.evaluate((previous) => {
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
 * Real-touch (or mouse) START -> DEPLOY modal -> STANDARD difficulty -> playing.
 * Every step is polled (CSS transitions need composited frames under SwiftShader).
 * Returns a diagnostic object; the caller asserts on it.
 */
async function startViaDeploy(page, { useMouse = false } = {}) {
  const start = await pickWhenReady(page, '[data-start]', { avoidAction: false });
  if (!start.ok) return { ok: false, reason: 'START not hittable: ' + JSON.stringify(start) };
  if (useMouse) await page.mouse.click(start.x, start.y);
  else await page.touchscreen.tap(start.x, start.y);
  const opened = await waitDeployOpen(page);
  const deploy = await page.evaluate(() => ({
    ...window.__qa.deployState(),
    state: window.__sandstrike?.state ?? null,
  }));
  if (!opened) return { ok: false, reason: 'deploy modal did not become visible/hittable', start, deploy };
  const card = await pickWhenReady(page, '[data-deploy-value="standard"]', { avoidAction: false });
  let cardClicked = false;
  let clickFallback = null;
  const pressCard = async () => {
    const point = card.ok ? card : await pickWhenReady(page, '[data-deploy-value="standard"]', { avoidAction: false });
    if (!point.ok) return false;
    if (useMouse) await page.mouse.click(point.x, point.y);
    else await page.touchscreen.tap(point.x, point.y);
    return true;
  };
  cardClicked = await pressCard();
  let playing = await waitFor(page, () => window.__sandstrike?.state === 'playing', { timeout: 8000, label: 'state playing' });
  if (!playing && cardClicked && !useMouse) {
    // A touch tap can be swallowed while a composited frame is late (busy
    // SwiftShader machine): retry the difficulty card exactly once.
    await pressCard();
    playing = await waitFor(page, () => window.__sandstrike?.state === 'playing', { timeout: 6000, label: 'state playing (retry)' });
  }
  if (!playing && useMouse) {
    // Desktop: fall back to Playwright's actionability-aware click, then to a
    // plain DOM click (matches scripts/qa.mjs behaviour).
    try {
      await page.locator('[data-deploy-value="standard"]').click({ timeout: 6000 });
      cardClicked = true;
    } catch (error) {
      clickFallback = 'locator.click: ' + error.message.split('\n')[0];
      cardClicked = await page.evaluate(() => {
        const el = document.querySelector('[data-deploy-value="standard"]');
        if (!el) return false;
        el.click();
        return true;
      });
    }
    playing = await waitFor(page, () => window.__sandstrike?.state === 'playing', { timeout: 5000, label: 'state playing (fallback)' });
  }
  return { ok: playing, playing, start, deploy, card, cardClicked, clickFallback };
}

/** Real touch drag: press, N incremental moves, release. */
async function touchDrag(cdp, from, to, { steps = 4, stepDelay = 0, id = 1, label = 'drag' } = {}) {
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id }] });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id }],
      });
      if (stepDelay) await sleep(stepDelay);
    }
    return true;
  } catch (error) {
    qa.errors.push(`[touch] ${label}: ${error.message}`);
    return false;
  }
}
const touchStart = (cdp, x, y, id = 1) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] });
const touchEnd = (cdp) => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

// --- state probes -----------------------------------------------------------
const playerState = (page) => page.evaluate(() => {
  const p = window.__sandstrike?.player;
  if (!p) return null;
  return {
    x: p.position.x, y: p.position.y, z: p.position.z,
    yaw: p.yaw,
    eyeHeight: +p.eyeHeight.toFixed(3),
    crouching: p.crouching, sprinting: p.sprinting, grounded: p.grounded,
    vy: +p.velocity.y.toFixed(3),
    speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(3),
    aiming: p.aiming, enabled: p.enabled, alive: p.alive,
    virtualMove: p.virtualMove ? { x: +p.virtualMove.x.toFixed(2), forward: +p.virtualMove.forward.toFixed(2) } : null,
  };
});
const weaponState = (page) => page.evaluate(() => {
  const w = window.__sandstrike?.weapon;
  if (!w) return null;
  return {
    mag: w.mag, magSize: w.magSize, reserve: w.reserve,
    reloading: w.reloading, reloadDuration: +w.reloadDuration.toFixed(2),
    aiming: w.aiming, ads: +w.ads.toFixed(3),
    triggerDown: w.triggerDown, active: w.active,
  };
});

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
console.log(`SANDSTRIKE mobile QA — ${URL_BASE}`);
console.log(`chrome: ${CHROME}`);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--disable-gpu-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

let behaviorCtx = null;
let behaviorPage = null;
let shotsCtx = null;
let shotsPage = null;
let shotsCdp = null;
let portraitCtx = null;
let portraitPage = null;
let desktopCtx = null;
let desktopPage = null;

try {
  // =========================================================================
  // 1. Load: 0 console/page errors, dev hooks present
  // =========================================================================
  await group(1, 'Loads with 0 console/page errors; __sandstrikeApp.loaded', async (g) => {
    behaviorCtx = await browser.newContext({
      viewport: LANDSCAPE,
      deviceScaleFactor: BEHAVIOR_DPR,
      isMobile: true,
      hasTouch: true,
    });
    behaviorPage = await behaviorCtx.newPage();
    trackConsole(behaviorPage, 'landscape');
    console.log(`  loading ${URL_BASE}/?${TOUCH_QUERY} (behaviour ctx, DPR ${BEHAVIOR_DPR})`);
    await behaviorPage.goto(`${URL_BASE}/?${TOUCH_QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const ready = await openTouchPage(behaviorCtx, behaviorPage, 'landscape', 'landscapeBehavior');
    chk(g, 'app.loaded', ready.ok, ready.ok, true);
    if (!ready.ok) {
      chk(g, 'load reason', false, ready.reason, 'no error');
      finish(g);
      return;
    }
    await sleep(900); // menu screen swaps 620 ms after game:ready
    const probe = await behaviorPage.evaluate(() => ({
      loaded: window.__sandstrikeApp?.loaded === true,
      hasDev: !!window.__sandstrike,
      hooks: window.__sandstrike ? Object.keys(window.__sandstrike).length : 0,
      missingHooks: ['player', 'weapon', 'enemies', 'freeze', 'renderOnce', 'fastForward', 'damagePlayer']
        .filter((key) => !window.__sandstrike?.[key]),
      state: window.__sandstrike?.state ?? null,
      viewport: {
        innerWidth, innerHeight, dpr: devicePixelRatio,
        coarse: matchMedia('(pointer: coarse)').matches,
        hoverNone: matchMedia('(hover: none)').matches,
        isTouchClass: document.documentElement.classList.contains('is-touch'),
        touchUi: !!document.querySelector('.touch-ui'),
        adaptiveScale: window.__sandstrike?.adaptiveScale ?? null,
      },
    }));
    chk(g, '__sandstrikeApp.loaded', probe.loaded, probe.loaded, true);
    chk(g, 'dev hooks complete', probe.hasDev && probe.missingHooks.length === 0, probe, { present: true, missing: [] });
    chk(g, 'state=menu after load', probe.state === 'menu', probe.state, 'menu');
    note(g, 'viewport', probe.viewport);
    chk(g, 'console/page errors', qa.consoleErrors.landscape.length === 0, qa.consoleErrors.landscape.slice(0, 3), []);
    if (qa.consoleWarnings.landscape.length) note(g, 'console warnings', qa.consoleWarnings.landscape.slice(0, 3));
    finish(g);
  }, { timeout: BOOT_TIMEOUT + 60_000 });

  // =========================================================================
  // 2. Menu: START visible, in viewport, >= 44 px tall, no horizontal overflow
  // =========================================================================
  await group(2, 'Menu: START visible/in viewport/height>=44, no horizontal overflow', async (g) => {
    const ready = await waitFor(behaviorPage, () => {
      const menu = document.querySelector('.screen--menu');
      const button = document.querySelector('[data-start]');
      return !!menu && menu.classList.contains('is-active') && parseFloat(getComputedStyle(menu).opacity || '0') > 0.6
        && !!button && !button.disabled;
    }, { timeout: 20000, label: 'menu ready' });
    const menu = await behaviorPage.evaluate(() => window.__qa.menuState());
    chk(g, 'menu active', ready && menu.menuActive && menu.menuOpacity > 0.6, { ready, active: menu.menuActive, opacity: menu.menuOpacity }, { active: true, opacity: '>0.6' });
    chk(g, 'START visible', menu.start.found && menu.start.visible, { found: menu.start.found, visible: menu.start.visible, reason: menu.start.reason ?? null }, true);
    chk(g, 'START in viewport', menu.start.inViewport === true, menu.start.rect, { within: `${menu.start.vw}x${menu.start.vh}` });
    chk(g, 'START height >= 44', !!menu.start.rect && menu.start.rect.h >= 44, menu.start.rect?.h, '>=44');
    chk(g, 'no horizontal overflow', menu.overflow.docScrollWidth <= menu.overflow.innerWidth + 1
      && menu.overflow.bodyScrollWidth <= menu.overflow.innerWidth + 1, menu.overflow, 'scrollWidth <= innerWidth+1');
    chk(g, 'START hittable (hidden touch layer must not intercept)', menu.point.ok, menu.point, { hittable: true });
    finish(g);
  });

  // =========================================================================
  // 3. Tap START -> DEPLOY difficulty modal -> STANDARD -> playing
  // =========================================================================
  await group(3, 'Tap START -> deploy modal -> STANDARD: playing, touch UI, no lock', async (g) => {
    const cdpSession = await behaviorCtx.newCDPSession(behaviorPage);
    const result = await startViaDeploy(behaviorPage);
    expect(result.start, `START not hittable: ${JSON.stringify(result.start ?? result.reason)}`);
    chk(g, 'deploy modal opened by START', result.deploy?.isOpen === true && result.deploy?.ariaHidden === 'false', {
      isOpen: result.deploy?.isOpen ?? null,
      ariaHidden: result.deploy?.ariaHidden ?? null,
      opacity: result.deploy?.opacity ?? null,
      cardHittable: result.deploy?.card?.ok ?? false,
      reason: result.reason ?? null,
    }, { isOpen: true, ariaHidden: 'false' });
    chk(g, 'run not started before difficulty pick', result.deploy?.state !== 'playing', { state: result.deploy?.state ?? null }, 'state != playing');
    chk(g, 'state=playing after STANDARD', result.playing === true, result.playing === true ? 'playing' : (result.reason ?? 'not playing'), 'playing');
    if (!(result.playing === true)) {
      finish(g);
      return;
    }
    const post = await behaviorPage.evaluate(() => ({
      state: window.__sandstrike?.state ?? null,
      deploy: window.__qa.deployState(),
      ui: window.__qa.touchUiState(),
    }));
    // §8 item 3 asserts the `.is-visible` class (plus aria-hidden from
    // setVisible) — the computed opacity is compositor-driven and can still be
    // mid-transition while a busy SwiftShader page has not presented a frame,
    // so it is recorded as a diagnostic note, not a gate.
    const uiShown = await waitFor(behaviorPage, () => {
      const ui = document.querySelector('.touch-ui');
      return !!ui && ui.classList.contains('is-visible') && ui.getAttribute('aria-hidden') === 'false';
    }, { timeout: 5000, label: '.touch-ui shown' });
    const uiNow = await behaviorPage.evaluate(() => window.__qa.touchUiState());
    chk(g, 'deploy modal closed', !post.deploy.isOpen && post.deploy.ariaHidden === 'true', { open: post.deploy.isOpen, aria: post.deploy.ariaHidden }, { open: false, aria: 'true' });
    chk(g, '.touch-ui.is-visible', uiShown && uiNow.visibleClass && uiNow.ariaHidden === 'false', { visibleClass: uiNow.visibleClass, ariaHidden: uiNow.ariaHidden, opacity: uiNow.opacity }, { visibleClass: true, ariaHidden: 'false' });
    note(g, '.touch-ui composited opacity', uiNow.opacity);
    chk(g, 'pointerLockElement === null', uiNow.pointerLock === null, uiNow.pointerLock, null);
    note(g, 'html.is-touch', uiNow.isTouchClass);
    // Keep the run alive for the rest of the suite: death is forced explicitly later.
    await behaviorPage.evaluate(() => {
      const s = window.__sandstrike;
      s.player.godMode = true;
      s.fastForward(0.5);
    }).catch(() => {});
    // Diagnostics: document the SwiftShader frame budget (headless software GL).
    const perf = await behaviorPage.evaluate(async () => {
      const f0 = window.__renderDebug?.frames ?? 0;
      const t0 = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 700));
      const frames = (window.__renderDebug?.frames ?? 0) - f0;
      const ms = Math.round(performance.now() - t0);
      return { frames, ms, fps: +((frames * 1000) / ms).toFixed(2), adaptiveScale: window.__sandstrike?.adaptiveScale ?? null };
    }).catch(() => null);
    if (perf) note(g, 'frame budget (SwiftShader, behaviour ctx DPR 1)', perf);
    behaviorPage.__cdp = cdpSession;
    finish(g);
  });

  // =========================================================================
  // 4. Stick: drag 55 px up moves the player; release stops it
  //    (sim advanced with fastForward — a DPR-3 page renders < 1 frame/s)
  // =========================================================================
  await group(4, 'Stick drag up 55px: moved > 0.4 m; release -> speed < 0.3 m/s', async (g) => {
    const cdpSession = behaviorPage.__cdp;
    expect(cdpSession, 'CDP session missing (group 3 failed)');
    const pre = await behaviorPage.evaluate(() => ({
      player: (() => {
        const p = window.__sandstrike?.player;
        return p ? { enabled: p.enabled, x: p.position.x, z: p.position.z } : null;
      })(),
    }));
    const point = await pickWhenReady(behaviorPage, '.touch-stick');
    expect(point.ok, `stick not hittable: ${JSON.stringify(point)}`);
    expect(pre.player, 'player missing');
    chk(g, 'player enabled', pre.player.enabled === true, pre.player.enabled, true);
    const from = { x: point.x, y: point.y };
    const to = { x: from.x, y: Math.max(6, from.y - 55) };
    await touchDrag(cdpSession, from, to, { steps: 3, label: 'stick' });
    const during = await behaviorPage.evaluate(() => {
      const s = window.__sandstrike;
      s.fastForward(0.7);
      const p = s.player;
      return {
        x: p.position.x, z: p.position.z,
        speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(3),
        move: p.virtualMove ? { x: +p.virtualMove.x.toFixed(2), forward: +p.virtualMove.forward.toFixed(2) } : null,
        sprinting: p.sprinting,
      };
    });
    const moved = Math.hypot(during.x - pre.player.x, during.z - pre.player.z);
    chk(g, 'moved > 0.4 m', moved > 0.4, +moved.toFixed(3), '>0.4');
    note(g, 'moveInput while holding', during.move);
    note(g, 'speed while holding', during.speed);
    await touchEnd(cdpSession);
    const after = await behaviorPage.evaluate(() => {
      const s = window.__sandstrike;
      s.fastForward(0.5);
      const p = s.player;
      return {
        speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(3),
        move: p.virtualMove ? { x: +p.virtualMove.x.toFixed(2), forward: +p.virtualMove.forward.toFixed(2) } : null,
      };
    });
    chk(g, 'speed < 0.3 m/s after release', after.speed < 0.3, { speed: after.speed, move: after.move }, '<0.3');
    finish(g);
  });

  // =========================================================================
  // 5. Look: horizontal drag on .touch-look turns the camera
  // =========================================================================
  await group(5, 'Look drag right->left 120px: |dyaw| > 0.25 rad', async (g) => {
    const cdpSession = behaviorPage.__cdp;
    expect(cdpSession, 'CDP session missing (group 3 failed)');
    const point = await pickWhenReady(behaviorPage, '.touch-look', { preferX: 0.35, preferY: 0.3, minX: 140 });
    expect(point.ok, `look surface not hittable: ${JSON.stringify(point)}`);
    const before = await behaviorPage.evaluate(() => ({
      yaw: window.__sandstrike?.player?.yaw ?? null,
    }));
    expect(typeof before.yaw === 'number', 'player.yaw missing');
    const hitAtStart = await behaviorPage.evaluate(([x, y]) => window.__qa.hit(x, y), [point.x, point.y]);
    await touchDrag(cdpSession, { x: point.x, y: point.y }, { x: point.x - 120, y: point.y }, { steps: 3, label: 'look' });
    await touchEnd(cdpSession);
    const post = await behaviorPage.evaluate(() => ({ yaw: window.__sandstrike?.player?.yaw ?? null }));
    const delta = Math.abs(post.yaw - before.yaw);
    chk(g, '|dyaw| > 0.25 rad', delta > 0.25, +delta.toFixed(3), '>0.25');
    note(g, 'drag start hit', hitAtStart);
    note(g, 'yaw', { before: +before.yaw.toFixed(3), after: +post.yaw.toFixed(3) });
    finish(g);
  });

  // =========================================================================
  // 6. Fire: press & hold consumes ammo; release stops it
  // =========================================================================
  await group(6, 'Fire hold 400ms: mag drops; stable after release', async (g) => {
    const cdpSession = behaviorPage.__cdp;
    expect(cdpSession, 'CDP session missing (group 3 failed)');
    const point = await pickWhenReady(behaviorPage, '[data-touch-action="fire"]');
    expect(point.ok, `fire button not hittable: ${JSON.stringify(point)}`);
    const mag0 = await behaviorPage.evaluate(() => window.__sandstrike?.weapon?.mag ?? null);
    expect(typeof mag0 === 'number', 'weapon.mag missing');
    await touchStart(cdpSession, point.x, point.y);
    const mid = await behaviorPage.evaluate(() => {
      const s = window.__sandstrike;
      s.fastForward(0.4);
      const w = s.weapon;
      return { mag: w.mag, triggerDown: w.triggerDown };
    });
    chk(g, 'mag decreased while holding', mid.mag < mag0, `${mag0}->${mid.mag}`, 'mag drops');
    note(g, 'triggerDown while holding', mid.triggerDown);
    await touchEnd(cdpSession);
    const after = await behaviorPage.evaluate(() => {
      const s = window.__sandstrike;
      const w = s.weapon;
      const magAtRelease = w.mag;
      const triggerDown = w.triggerDown;
      s.fastForward(0.4);
      return { magAtRelease, magAfter: w.mag, triggerDown };
    });
    chk(g, 'mag stable after release', after.magAfter === after.magAtRelease && after.triggerDown === false, after, { stable: true });
    finish(g);
  });

  // =========================================================================
  // 7. Reload: tap -> reloading, then magazine refilled after the reload time
  // =========================================================================
  await group(7, 'Reload tap: reloading=true then magazine refilled', async (g) => {
    const point = await pickWhenReady(behaviorPage, '[data-touch-action="reload"]');
    expect(point.ok, `reload button not hittable: ${JSON.stringify(point)}`);
    const pre = await behaviorPage.evaluate(() => {
      const w = window.__sandstrike?.weapon;
      return w ? { mag: w.mag, magSize: w.magSize, duration: w.reloadDuration } : null;
    });
    expect(pre, 'weapon missing');
    chk(g, 'mag not full before reload', pre.mag < pre.magSize, `${pre.mag}/${pre.magSize}`, 'mag < magSize');
    await tap(behaviorPage, point.x, point.y);
    const started = await waitFor(behaviorPage, () => window.__sandstrike?.weapon?.reloading === true, { timeout: 3000, label: 'reloading' });
    chk(g, 'reloading=true', started, started, true);
    const done = await behaviorPage.evaluate((seconds) => {
      const s = window.__sandstrike;
      s.fastForward(seconds);
      const w = s.weapon;
      return { mag: w.mag, magSize: w.magSize, reloading: w.reloading };
    }, Math.max(2.4, (pre.duration || 2.05) + 0.4));
    chk(g, 'mag refilled', done.reloading === false && done.mag === done.magSize, done, 'mag == magSize');
    finish(g);
  });

  // =========================================================================
  // 8. ADS: tap toggles aiming on, tap again turns it off
  // =========================================================================
  await group(8, 'ADS tap toggles aiming on/off', async (g) => {
    const point = await pickWhenReady(behaviorPage, '[data-touch-action="ads"]');
    expect(point.ok, `ADS button not hittable: ${JSON.stringify(point)}`);
    await tap(behaviorPage, point.x, point.y);
    await waitFor(behaviorPage, () => window.__sandstrike?.weapon?.aiming === true, { timeout: 3000, label: 'ADS toggle on' });
    const on = await behaviorPage.evaluate(() => {
      const s = window.__sandstrike;
      s.fastForward(0.35);
      const w = s.weapon;
      return {
        weapon: w.aiming, player: s.player.aiming, ads: +w.ads.toFixed(2),
        pressed: document.querySelector('[data-touch-action="ads"]')?.getAttribute('aria-pressed') ?? null,
      };
    });
    chk(g, 'aiming on', on.weapon === true && on.player === true, on, { weapon: true, player: true });
    note(g, 'aria-pressed after first tap', on.pressed);
    await tap(behaviorPage, point.x, point.y);
    await waitFor(behaviorPage, () => window.__sandstrike?.weapon?.aiming === false, { timeout: 3000, label: 'ADS toggle off' });
    const off = await behaviorPage.evaluate(() => {
      const s = window.__sandstrike;
      s.fastForward(0.35);
      const w = s.weapon;
      return { weapon: w.aiming, player: s.player.aiming, ads: +w.ads.toFixed(2) };
    });
    chk(g, 'aiming off', off.weapon === false && off.player === false, off, { weapon: false, player: false });
    finish(g);
  });

  // =========================================================================
  // 9. Jump: tap gives upward velocity / height within 300 ms
  // =========================================================================
  await group(9, 'Jump tap: vertical velocity or height increases', async (g) => {
    const pre = await behaviorPage.evaluate(() => {
      const s = window.__sandstrike;
      return {
        y: s?.player?.position?.y ?? null,
        grounded: s?.player?.grounded ?? null,
      };
    });
    const point = await pickWhenReady(behaviorPage, '[data-touch-action="jump"]');
    expect(point.ok, `jump button not hittable: ${JSON.stringify(point)}`);
    await tap(behaviorPage, point.x, point.y);
    // The jump is queued synchronously by the tap; consume it with the dev hook.
    await waitFor(behaviorPage, () => {
      const p = window.__sandstrike?.player;
      return !!p && (p._jumpQueued === true || p.velocity.y > 0 || p.grounded === false);
    }, { timeout: 3000, label: 'jump queued' });
    const after = await behaviorPage.evaluate(() => {
      const s = window.__sandstrike;
      s.fastForward(0.1); // < 300 ms of game time, frame-rate independent
      const p = s.player;
      return { vy: +p.velocity.y.toFixed(3), y: +p.position.y.toFixed(3), grounded: p.grounded };
    });
    chk(g, 'jump velocity/height', after.vy > 0.1 || (after.y - pre.y) > 0.05, { ...after, rise: +(after.y - pre.y).toFixed(3) }, { vy: '>0.1 or rise>0.05' });
    note(g, 'grounded before tap', pre.grounded);
    await advance(behaviorPage, 1.6); // land again
    finish(g);
  });

  // =========================================================================
  // 10. Crouch: tap toggles crouch + eye height
  // =========================================================================
  await group(10, 'Crouch tap: crouching=true and eye height < 1.5 m', async (g) => {
    const point = await pickWhenReady(behaviorPage, '[data-touch-action="crouch"]');
    expect(point.ok, `crouch button not hittable: ${JSON.stringify(point)}`);
    const before = await playerState(behaviorPage);
    await tap(behaviorPage, point.x, point.y);
    await waitFor(behaviorPage, () => window.__sandstrike?.player?.crouchHeld === true, { timeout: 3000, label: 'crouch held' });
    const during = await behaviorPage.evaluate(() => {
      const s = window.__sandstrike;
      s.fastForward(0.5);
      const p = s.player;
      return { crouching: p.crouching, eyeHeight: +p.eyeHeight.toFixed(3) };
    });
    chk(g, 'crouching=true', during.crouching === true, during.crouching, true);
    chk(g, 'eyeHeight < 1.5', during.eyeHeight < 1.5, during.eyeHeight, '<1.5');
    note(g, 'eyeHeight before', before?.eyeHeight);
    await tap(behaviorPage, point.x, point.y); // toggle back
    const restored = await behaviorPage.evaluate(() => {
      const s = window.__sandstrike;
      s.fastForward(0.6);
      return { crouching: s.player.crouching, eyeHeight: +s.player.eyeHeight.toFixed(3) };
    });
    note(g, 'restored after second tap', restored);
    finish(g);
  });

  // =========================================================================
  // 11. Pause: tap pauses + hides the touch layer; resume works
  // =========================================================================
  await group(11, 'Pause tap: paused + touch UI hidden; resume works', async (g) => {
    const point = await pickWhenReady(behaviorPage, '[data-touch-action="pause"]');
    expect(point.ok, `pause button not hittable: ${JSON.stringify(point)}`);
    await tap(behaviorPage, point.x, point.y);
    const pausedState = await waitFor(behaviorPage, () => window.__sandstrike?.state === 'paused', { timeout: 4000, label: 'state paused' });
    const uiHidden = await waitFor(behaviorPage, () => {
      const ui = document.querySelector('.touch-ui');
      return !!ui && !ui.classList.contains('is-visible') && ui.getAttribute('aria-hidden') === 'true';
    }, { timeout: 5000, label: '.touch-ui hidden' });
    const paused = await behaviorPage.evaluate(() => {
      const ui = window.__qa.touchUiState();
      const screen = document.querySelector('.screen--pause');
      const cs = screen ? getComputedStyle(screen) : null;
      return {
        state: window.__sandstrike?.state ?? null,
        ui,
        pauseScreen: screen ? { active: screen.classList.contains('is-active'), opacity: +parseFloat(cs.opacity || '0').toFixed(2) } : null,
      };
    });
    chk(g, 'state=paused', pausedState && paused.state === 'paused', paused.state, 'paused');
    chk(g, '.touch-ui not visible', uiHidden && paused.ui.visibleClass === false && paused.ui.ariaHidden === 'true', { visibleClass: paused.ui.visibleClass, ariaHidden: paused.ui.ariaHidden, opacity: paused.ui.opacity }, { visibleClass: false, ariaHidden: 'true' });
    note(g, 'pause screen', paused.pauseScreen);
    await sleep(520); // main.js ignores ui:resume for 420 ms after pauseGame()
    const resume = await pickWhenReady(behaviorPage, '.screen--pause [data-action="resume"]', { avoidAction: false });
    expect(resume.ok, `resume button not hittable: ${JSON.stringify(resume)}`);
    await tap(behaviorPage, resume.x, resume.y);
    const resumedState = await waitFor(behaviorPage, () => window.__sandstrike?.state === 'playing', { timeout: 6000, label: 'state playing (resume)' });
    const uiBack = await waitFor(behaviorPage, () => {
      const ui = document.querySelector('.touch-ui');
      return !!ui && ui.classList.contains('is-visible') && ui.getAttribute('aria-hidden') === 'false';
    }, { timeout: 5000, label: '.touch-ui shown after resume' });
    const resumed = await behaviorPage.evaluate(() => ({
      state: window.__sandstrike?.state ?? null,
      ui: window.__qa.touchUiState(),
    }));
    chk(g, 'resume -> playing', resumedState && resumed.state === 'playing', resumed.state, 'playing');
    chk(g, '.touch-ui visible after resume', uiBack && resumed.ui.visibleClass === true, { visibleClass: resumed.ui.visibleClass, ariaHidden: resumed.ui.ariaHidden, opacity: resumed.ui.opacity }, { visibleClass: true });
    finish(g);
  });

  // Behaviour context is done; free its GPU/CPU before the DPR-3 capture boots.
  if (behaviorCtx) {
    console.log('  [perf] closing behaviour context');
    await behaviorCtx.close().catch(() => {});
    behaviorCtx = null;
    behaviorPage = null;
  }

  // =========================================================================
  // Screenshot pass — spec-mandated DPR 3 landscape context (captures 01-04, 07)
  // =========================================================================
  shotsCtx = await browser.newContext({
    viewport: LANDSCAPE,
    deviceScaleFactor: DPR,
    isMobile: true,
    hasTouch: true,
  });
  shotsPage = await shotsCtx.newPage();
  trackConsole(shotsPage, 'landscape');
  await shotsPage.goto(`${URL_BASE}/?${TOUCH_QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const shotsReady = await openTouchPage(shotsCtx, shotsPage, 'landscape', 'landscapeShots');
  if (!shotsReady.ok) {
    qa.errors.push('[shots] landscape DPR-3 page failed to load: ' + shotsReady.reason);
    console.log(`    ! screenshot page not ready: ${shotsReady.reason}`);
  } else {
    await waitFor(shotsPage, () => {
      const menu = document.querySelector('.screen--menu');
      const button = document.querySelector('[data-start]');
      return !!menu && menu.classList.contains('is-active') && parseFloat(getComputedStyle(menu).opacity || '0') > 0.6
        && !!button && !button.disabled;
    }, { timeout: 20000, label: 'shots menu ready' });
    await capture(shotsPage, 'mobile-01-menu-landscape.png');
    await freeze(shotsPage, false);
    // The captures below only need coherent game states; §8 item 13 explicitly
    // allows dev hooks here. Real-touch input is asserted in groups 3-11, and
    // every CDP touch dispatch on this DPR-3 page costs several seconds.
    const playing = await shotsPage.evaluate(() => {
      window.__sandstrike?.start?.();
      return window.__sandstrike?.state === 'playing';
    }).catch(() => false);
    const uiVisible = await waitUiVisible(shotsPage, { timeout: 12000 });
    if (playing && uiVisible) {
      await capture(shotsPage, 'mobile-02-playing-landscape.png');
      await freeze(shotsPage, false);
      // fire: synthetic pointerdown on the FIRE button (touch.js sets
      // `is-firing` + weapon.setTrigger(true)), one real shot for the flash.
      const firing = await shotsPage.evaluate(() => {
        const button = document.querySelector('[data-touch-action="fire"]');
        if (!button) return false;
        const rect = button.getBoundingClientRect();
        button.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerId: 71, pointerType: 'touch', isPrimary: true,
          clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
        }));
        const s = window.__sandstrike;
        s.fastForward(0.35);
        const w = s.weapon;
        w.fireCooldown = 0;
        w.mag = Math.max(5, w.mag);
        w.tryFire();
        return !!window.__sandstrike?.weapon?.triggerDown;
      }).catch(() => false);
      if (firing) {
        await sleep(300);
        await capture(shotsPage, 'mobile-03-fire.png');
        await freeze(shotsPage, false);
        await shotsPage.evaluate(() => {
          document.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true, cancelable: true, pointerId: 71, pointerType: 'touch', isPrimary: true,
          }));
        }).catch(() => {});
      } else {
        qa.errors.push('[shots] FIRE button pointerdown did not set triggerDown for mobile-03-fire');
        console.log('    ! fire button pointerdown did not set triggerDown on screenshot page');
      }
      // paused
      const paused = await shotsPage.evaluate(() => {
        window.__sandstrike?.pause?.('shots');
        return window.__sandstrike?.state === 'paused';
      }).catch(() => false);
      if (paused) {
        await waitFor(shotsPage, () => {
          const screen = document.querySelector('.screen--pause.is-active');
          return !!screen && parseFloat(getComputedStyle(screen).opacity || '0') > 0.5;
        }, { timeout: 10000, label: 'pause screen visible' });
        await capture(shotsPage, 'mobile-04-paused.png');
        await freeze(shotsPage, false);
        // end / death screen: resume, force lethal damage, wait for the beat
        await sleep(520); // main.js ignores ui:resume for 420 ms after pauseGame()
        await shotsPage.evaluate(() => {
          window.__sandstrike?.resume?.();
        }).catch(() => {});
        await waitFor(shotsPage, () => window.__sandstrike?.state === 'playing', { timeout: 8000, label: 'shots resumed' });
        await shotsPage.evaluate(() => {
          const s = window.__sandstrike;
          s.player.godMode = false;
          s.damagePlayer(999);
        }).catch(() => {});
        await waitFor(shotsPage, () => window.__sandstrike?.state === 'dead', { timeout: 8000, label: 'shots dead' });
        await waitFor(shotsPage, () => {
          const screen = document.querySelector('.screen--death.is-active');
          return !!screen && parseFloat(getComputedStyle(screen).opacity || '0') > 0.6;
        }, { timeout: 12000, label: 'death screen visible' });
        await capture(shotsPage, 'mobile-07-end.png');
        await freeze(shotsPage, false);
      } else {
        qa.errors.push('[shots] could not enter paused state for mobile-04-paused');
        console.log('    ! could not enter paused state on screenshot page');
      }
    } else {
      qa.errors.push(`[shots] could not enter playing state on DPR-3 page (playing=${playing}, uiVisible=${uiVisible})`);
      console.log(`    ! could not enter playing state on screenshot page (playing=${playing}, uiVisible=${uiVisible})`);
    }
  }
  if (shotsCtx) {
    console.log('  [perf] closing screenshot landscape context');
    await shotsCtx.close().catch(() => {});
    shotsCtx = null;
    shotsPage = null;
    shotsCdp = null;
  }

  // =========================================================================
  // 12. Portrait 390x844 @ DPR 3: menu reachable, rotate hint during play
  // =========================================================================
  await group(12, 'Portrait 390x844: START reachable; rotate hint visible in play', async (g) => {
    portraitCtx = await browser.newContext({
      viewport: PORTRAIT,
      deviceScaleFactor: DPR,
      isMobile: true,
      hasTouch: true,
    });
    portraitPage = await portraitCtx.newPage();
    trackConsole(portraitPage, 'portrait');
    await portraitPage.goto(`${URL_BASE}/?${TOUCH_QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const ready = await openTouchPage(portraitCtx, portraitPage, 'portrait', 'portrait');
    chk(g, 'portrait app loaded', ready.ok, ready.ok, true);
    if (!ready.ok) {
      chk(g, 'portrait load reason', false, ready.reason, 'no error');
      finish(g);
      return;
    }
    const menuReady = await waitFor(portraitPage, () => {
      const menu = document.querySelector('.screen--menu');
      const button = document.querySelector('[data-start]');
      return !!menu && menu.classList.contains('is-active') && parseFloat(getComputedStyle(menu).opacity || '0') > 0.6
        && !!button && !button.disabled;
    }, { timeout: 20000, label: 'portrait menu ready' });
    const menu = await portraitPage.evaluate(() => window.__qa.menuState());
    chk(g, 'portrait menu active', menuReady && menu.menuActive, { ready: menuReady, active: menu.menuActive }, true);
    chk(g, 'portrait START visible', menu.start.found && menu.start.visible, { found: menu.start.found, visible: menu.start.visible, reason: menu.start.reason ?? null }, true);
    chk(g, 'portrait START in viewport', menu.start.inViewport === true, menu.start.rect, { within: `${menu.start.vw}x${menu.start.vh}` });
    chk(g, 'portrait no horizontal overflow', menu.overflow.docScrollWidth <= menu.overflow.innerWidth + 1
      && menu.overflow.bodyScrollWidth <= menu.overflow.innerWidth + 1, menu.overflow, 'innerWidth+1');
    await capture(portraitPage, 'mobile-05-menu-portrait.png');
    await freeze(portraitPage, false);
    const started = await startViaDeploy(portraitPage);
    expect(started.ok, `portrait deploy flow failed: ${started.reason ?? JSON.stringify(started)}`);
    const rotateVisible = await waitFor(portraitPage, () => {
      const ui = document.querySelector('.touch-ui');
      const rotate = document.querySelector('[data-touch-rotate]');
      if (!ui || !ui.classList.contains('is-visible') || !rotate) return false;
      if (parseFloat(getComputedStyle(ui).opacity || '0') < 0.5) return false;
      const cs = getComputedStyle(rotate);
      return cs.visibility !== 'hidden' && parseFloat(cs.opacity || '0') >= 0.5;
    }, { timeout: 12000, label: 'rotate hint visible' });
    const play = await portraitPage.evaluate(() => {
      const ui = window.__qa.touchUiState();
      const rotate = window.__qa.effective('[data-touch-rotate]');
      return {
        state: window.__sandstrike?.state ?? null,
        ui,
        rotate,
        viewport: { innerWidth, innerHeight, dpr: devicePixelRatio },
      };
    });
    chk(g, 'portrait state=playing', play.state === 'playing', play.state, 'playing');
    chk(g, 'rotate hint visible', rotateVisible && play.rotate.visible === true, {
      uiOpacity: play.ui.opacity, found: play.rotate.found, visible: play.rotate.visible,
      display: play.rotate.display, opacity: play.rotate.opacity,
    }, { visible: true });
    const cover = play.rotate.rect ? (play.rotate.rect.w * play.rotate.rect.h) / (play.viewport.innerWidth * play.viewport.innerHeight) : 0;
    chk(g, 'rotate hint covers viewport', cover >= 0.4, { cover: +cover.toFixed(2), rect: play.rotate.rect }, '>=0.4 of viewport');
    await capture(portraitPage, 'mobile-06-portrait-rotate-hint.png');
    await freeze(portraitPage, false);
    note(g, 'portrait viewport', play.viewport);
    note(g, 'portrait console errors', qa.consoleErrors.portrait.slice(0, 3));
    finish(g);
  }, { timeout: BOOT_TIMEOUT + 90_000 });

  if (portraitCtx) {
    console.log('  [perf] closing portrait context');
    await portraitCtx.close().catch(() => {});
    portraitCtx = null;
    portraitPage = null;
  }

  // =========================================================================
  // 13. Screenshots: all seven §8 captures exist in shots/
  // =========================================================================
  await group(13, 'Screenshots: 7 named mobile-* files in shots/', async (g) => {
    const info = {};
    for (const name of SHOT_NAMES) {
      const path = join(OUT, name);
      const file = await stat(path).catch(() => null);
      info[name] = file ? { bytes: file.size } : null;
      if (file?.size > 24) {
        const buffer = await readFile(path);
        if (buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47) {
          info[name].width = buffer.readUInt32BE(16);
          info[name].height = buffer.readUInt32BE(20);
        }
      }
    }
    qa.screenshotInfo = info;
    const missing = SHOT_NAMES.filter((name) => !info[name] || info[name].bytes < 20_000);
    chk(g, 'all 7 screenshots captured (>=20 KB)', missing.length === 0, { missing, captured: SHOT_NAMES.length - missing.length }, 7);
    note(g, 'landscape capture sizes (DPR 3 => 2532x1170)',
      SHOT_NAMES.filter((name) => !name.includes('portrait'))
        .map((name) => info[name] && `${name.replace('mobile-', '')}:${info[name].width}x${info[name].height}`));
    note(g, 'portrait capture sizes (DPR 3 => 1170x2532)',
      SHOT_NAMES.filter((name) => name.includes('portrait'))
        .map((name) => info[name] && `${name.replace('mobile-', '')}:${info[name].width}x${info[name].height}`));
    finish(g);
  });

  // =========================================================================
  // 14. Desktop regression smoke: 1600x900, no touch
  // =========================================================================
  await group(14, 'Desktop 1600x900 smoke: no touch UI, START works, 0 errors', async (g) => {
    desktopCtx = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });
    desktopPage = await desktopCtx.newPage();
    trackConsole(desktopPage, 'desktop');
    await desktopPage.goto(`${URL_BASE}/?${DESKTOP_QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const ready = await waitForAppReady(desktopPage, 'desktop');
    qa.timings.desktopBoot = ready.ms;
    console.log(`  [boot] desktop ready=${ready.ok} in ${(ready.ms / 1000).toFixed(1)}s${ready.reason ? ` (${ready.reason})` : ''}`);
    chk(g, 'desktop app loaded', ready.ok, ready.ok, true);
    if (!ready.ok) {
      chk(g, 'desktop load reason', false, ready.reason, 'no error');
      finish(g);
      return;
    }
    await installPageHelpers(desktopPage);
    const menuReady = await waitFor(desktopPage, () => {
      const menu = document.querySelector('.screen--menu');
      const button = document.querySelector('[data-start]');
      return !!menu && menu.classList.contains('is-active') && parseFloat(getComputedStyle(menu).opacity || '0') > 0.6
        && !!button && !button.disabled;
    }, { timeout: 20000, label: 'desktop menu ready' });
    const menu = await desktopPage.evaluate(() => ({
      menu: window.__qa.menuState(),
      touchUi: window.__qa.effective('.touch-ui'),
      detection: {
        isTouchClass: document.documentElement.classList.contains('is-touch'),
        coarse: matchMedia('(pointer: coarse)').matches,
        touchMode: window.__sandstrikeApp?.touchMode ?? null,
      },
    }));
    chk(g, 'desktop menu active', menuReady && menu.menu.menuActive, { ready: menuReady, active: menu.menu.menuActive }, true);
    chk(g, '.touch-ui not visible on desktop', !menu.touchUi.visible && (menu.touchUi.found ? menu.touchUi.opacity < 0.1 : true), {
      found: menu.touchUi.found ?? false, visible: menu.touchUi.visible, opacity: menu.touchUi.opacity ?? 0,
    }, { visible: false });
    note(g, 'desktop touch detection', menu.detection);
    expect(menu.menu.point.ok, `desktop START not hittable: ${JSON.stringify(menu.menu.point)}`);
    await desktopPage.mouse.click(menu.menu.point.x, menu.menu.point.y);
    const deployVisible = await waitDeployOpen(desktopPage);
    const deploy = await desktopPage.evaluate(() => window.__qa.deployState());
    chk(g, 'desktop START opens deploy modal', deployVisible && deploy.isOpen && deploy.ariaHidden === 'false', {
      visible: deployVisible, isOpen: deploy.isOpen, ariaHidden: deploy.ariaHidden, opacity: deploy.opacity, cardHittable: deploy.card.ok,
    }, { isOpen: true, ariaHidden: 'false' });
    let clicked = false;
    const card = await pickWhenReady(desktopPage, '[data-deploy-value="standard"]', { avoidAction: false });
    if (card.ok) {
      await desktopPage.mouse.click(card.x, card.y);
      clicked = true;
    }
    let playing = clicked
      ? await waitFor(desktopPage, () => window.__sandstrike?.state === 'playing', { timeout: 5000, label: 'desktop playing' })
      : false;
    if (!playing) {
      // Desktop fallback: Playwright actionability click, then a plain DOM click
      // (matches the behaviour scripts/qa.mjs relies on).
      try {
        await desktopPage.locator('[data-deploy-value="standard"]').click({ timeout: 8000 });
        clicked = true;
      } catch (error) {
        note(g, 'desktop locator click fallback', error.message.split('\n')[0]);
        clicked = await desktopPage.evaluate(() => {
          const element = document.querySelector('[data-deploy-value="standard"]');
          if (!element) return false;
          element.click();
          return true;
        });
      }
      playing = await waitFor(desktopPage, () => window.__sandstrike?.state === 'playing', { timeout: 6000, label: 'desktop playing (fallback)' });
    }
    chk(g, 'desktop deploy card clicked', clicked, clicked, true);
    const post = await desktopPage.evaluate(() => ({
      state: window.__sandstrike?.state ?? null,
      touchUi: window.__qa.effective('.touch-ui'),
    }));
    chk(g, 'desktop START click works', playing && post.state === 'playing', post.state, 'playing');
    chk(g, '.touch-ui stays hidden while playing on desktop', !post.touchUi.visible, { found: post.touchUi.found ?? false, visible: post.touchUi.visible }, { visible: false });
    await desktopPage.evaluate(() => window.__sandstrike?.pause?.('qa')).catch(() => {});
    await sleep(400);
    chk(g, 'desktop console/page errors', qa.consoleErrors.desktop.length === 0, qa.consoleErrors.desktop.slice(0, 3), []);
    finish(g);
  }, { timeout: BOOT_TIMEOUT + 60_000 });
} catch (error) {
  qa.fatal = error?.stack || error?.message || String(error);
  console.error('\nFATAL', qa.fatal);
  try {
    if (behaviorPage) await behaviorPage.screenshot({ path: join(OUT, 'mobile-00-fatal.png') });
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
  qa.total = 14;
  qa.failed = failed.map((entry) => entry.id);
  qa.notRun = Math.max(0, 14 - groups.length);
  qa.ok = !qa.fatal && failed.length === 0 && groups.length === 14;
  qa.consoleErrors = {
    landscape: qa.consoleErrors.landscape.slice(0, 40),
    portrait: qa.consoleErrors.portrait.slice(0, 40),
    desktop: qa.consoleErrors.desktop.slice(0, 40),
  };
  qa.consoleWarnings = {
    landscape: qa.consoleWarnings.landscape.slice(0, 20),
    portrait: qa.consoleWarnings.portrait.slice(0, 20),
    desktop: qa.consoleWarnings.desktop.slice(0, 20),
  };

  await writeFile(join(OUT, 'mobile-qa.json'), JSON.stringify(qa, null, 2), 'utf8').catch((error) => {
    console.error('could not write shots/mobile-qa.json', error);
  });

  console.log('\n────────── mobile-qa summary ──────────');
  for (const entry of groups) {
    const mark = entry.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${mark} [${entry.id}/14] ${entry.title}`);
    if (!entry.pass) console.log(`      ${entry.error}`);
  }
  if (qa.notRun > 0) console.log(`\x1b[31m✗\x1b[0m ${qa.notRun} groups never ran (fatal error)`);
  const shots = SHOT_NAMES.filter((name) => qa.screenshots[name]);
  console.log(`\nshots: ${shots.length}/7 — ${shots.join(', ')}`);
  console.log(`mobile-qa: ${passed}/14 groups passed — ${(qa.durationMs / 1000).toFixed(1)}s`);
  if (failed.length || qa.fatal) console.log(`failed: ${failed.map((entry) => '#' + entry.id).join(', ') || 'fatal'} — see shots/mobile-qa.json`);

  for (const context of [portraitCtx, desktopCtx, shotsCtx, behaviorCtx]) {
    if (context) await context.close().catch(() => {});
  }
  await browser.close().catch(() => {});

  if (!qa.ok) process.exitCode = 1;
}
