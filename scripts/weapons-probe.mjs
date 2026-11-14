/**
 * SANDSTRIKE weapon-runtime probe — `.scratch/features/CONTRACT.md` §4/§6/§10.
 *
 *   node scripts/weapons-probe.mjs          # BASE_URL from env (default 127.0.0.1:8080)
 *   BASE_URL=http://127.0.0.1:8095 node scripts/weapons-probe.mjs
 *
 * Headless Playwright probe for the 4-weapon inventory (`WeaponSystem`):
 *   1. starts with exactly ONE weapon (vxr7) in 4 stable HUD slots
 *   2. boss weapon drop (`__sandstrike.forceWeaponDrop`) → ground pickup → `pickup:weapon`
 *      → the weapon is owned and the HUD slot lights up
 *   3. add the remaining weapons, switch via API + cycleWeapon + REAL Digit1-4 key
 *      events, compare per-type mag/magSize/reserve/mode and the HUD slot strip
 *   4. fire every mode at live wave-1 enemies: auto (1 round/shot), shotgun (1 shell,
 *      multiple pellets), gatling (spin-up gate then >1 round in 0.5 s), RPG (projectile
 *      + explosion damage)
 *   5. full inventory is capped at 4 (duplicates refill, white-box replace branch)
 *   6. exportProgression/importProgression round-trip restores owned + active + per-weapon
 *      upgrades
 *
 * Writes `shots/weapons-probe.json` + HUD screenshots, exits 1 on any failure.
 * Dependencies: playwright-core + node stdlib only.
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASE_URL = (process.env.BASE_URL || process.argv[2] || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const QUERY = process.env.PROBE_QUERY || 'dev=1&quality=medium';
const USE_GPU = process.env.PROBE_GPU === '1';
const OUT = resolve('shots');
// Logic + HUD probe: small viewport keeps SwiftShader fast (visual layout is qa.mjs' job).
const VIEWPORT = { width: Number(process.env.PROBE_W) || 960, height: Number(process.env.PROBE_H) || 540 };
const WEAPON_ORDER = ['vxr7', 'rpg', 'gatling', 'shotgun'];
/** Mirrors src/config/weapons.js — asserted, not imported (probe stays black-box). */
const SPEC = {
  vxr7: { mode: 'auto', magSize: 30, reserveStart: 300, reserveMax: 420 },
  rpg: { mode: 'rocket', magSize: 1, reserveStart: 3, reserveMax: 6 },
  gatling: { mode: 'spinup', magSize: 200, reserveStart: 600, reserveMax: 1200 },
  shotgun: { mode: 'pump', magSize: 6, reserveStart: 48, reserveMax: 72 },
};
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

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const STATUS = { ok: false, probe: 'weapons', url: BASE_URL, query: QUERY, startedAt: new Date().toISOString(), finishedAt: null, durationMs: 0, groups: [], assertions: [], consoleErrors: [], screenshots: {}, notes: [], data: {}, fatal: null };
let currentGroup = null;

function assert(name, condition, extra = {}) {
  const entry = { group: currentGroup ? currentGroup.name : '(setup)', name, pass: !!condition };
  if (extra.expected !== undefined) entry.expected = extra.expected;
  if (extra.actual !== undefined) entry.actual = extra.actual;
  if (extra.note) entry.note = extra.note;
  if (extra.skipped) entry.skipped = true;
  STATUS.assertions.push(entry);
  if (currentGroup) currentGroup.assertions.push(entry);
  console.log(condition ? '  ✓' : '  ✗', name, condition ? '' : JSON.stringify(extra.actual ?? ''));
  return !!condition;
}
const note = (text) => { STATUS.notes.push(text); console.log('  ·', text); };
const sameJson = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };

async function group(name, fn) {
  currentGroup = { name, assertions: [] };
  STATUS.groups.push(currentGroup);
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
  } catch (error) {
    assert(`${name}: finished without an uncaught exception`, false, { actual: String((error && error.stack) || error) });
  }
  currentGroup.pass = currentGroup.assertions.every((entry) => entry.pass);
  currentGroup = null;
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: USE_GPU ? GPU_ARGS : SWIFTSHADER_ARGS });
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('console', (msg) => { if (msg.type() === 'error') STATUS.consoleErrors.push(`[console] ${msg.text()}`); });
page.on('pageerror', (error) => STATUS.consoleErrors.push(`[pageerror] ${error.message}`));

const waitState = (state, timeout = 30_000) => page.waitForFunction(
  (wanted) => window.__sandstrike?.state === wanted,
  state,
  { timeout, polling: 100 },
);
const waitClass = (selector, className, timeout = 20_000) => page.waitForFunction(
  ([sel, cls]) => !!document.querySelector(sel)?.classList.contains(cls),
  [selector, className],
  { timeout, polling: 100 },
);
async function click(selector) {
  const result = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: 'missing' };
    if (el.disabled) return { ok: false, reason: 'disabled' };
    el.click();
    return { ok: true };
  }, selector);
  if (!result.ok) throw new Error(`click(${selector}) failed: ${result.reason}`);
}
async function shot(name) {
  await page.evaluate(() => { window.__sandstrike?.freeze?.(true); window.__sandstrike?.renderOnce?.(); });
  await sleep(300);
  await page.screenshot({ path: resolve(OUT, name) });
  STATUS.screenshots[name.replace(/\.png$/, '')] = `shots/${name}`;
  await page.evaluate(() => window.__sandstrike?.freeze?.(false));
}

/** Inventory + current-weapon snapshot used by most assertions. */
const weaponSnapshot = () => page.evaluate(() => {
  const weapon = window.__sandstrike?.weapon;
  const state = weapon?.getState?.() || {};
  return {
    slots: weapon?.getSlots?.() || [],
    owned: (weapon?.getSlots?.() || []).filter((slot) => slot.owned).map((slot) => slot.type),
    size: weapon?._slots?.size ?? null,
    state: {
      weaponType: state.weaponType,
      weaponMode: state.weaponMode,
      mag: state.mag,
      magSize: state.magSize,
      reserve: state.reserve,
      slotIndex: state.slotIndex,
      maxSlots: state.maxSlots,
      damageMultiplier: state.damageMultiplier,
      reloadTime: state.reloadTime,
    },
    hud: {
      slots: [...document.querySelectorAll('[data-weapon-slots] .wslot')].map((node) => ({
        slot: Number(node.dataset.slot),
        type: node.dataset.slotType ?? null,
        active: node.classList.contains('is-active'),
        empty: node.classList.contains('is-empty'),
        name: node.querySelector('.wslot-name')?.textContent ?? '',
        ammo: node.querySelector('.wslot-ammo b')?.textContent ?? '',
        reserve: node.querySelector('.wslot-ammo span')?.textContent ?? '',
      })),
    },
  };
});

try {
  // =========================================================================
  // 0. boot + stage entry through real UI
  // =========================================================================
  await page.goto(`${BASE_URL}/?${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__sandstrikeApp?.loaded === true && window.__sandstrike?.state === 'menu', null, { timeout: 180_000, polling: 100 });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-start]');
    return !!button && !button.disabled;
  }, null, { timeout: 30_000, polling: 100 });
  await click('[data-start]');
  await waitClass('[data-deploy]', 'is-open');
  await click('[data-deploy-value="standard"]');
  await waitState('playing');
  await page.waitForFunction(() => window.__sandstrike?.ui?.state === 'playing', null, { timeout: 20_000, polling: 100 });

  // Page-side QA helpers (aim / teleport / damage bookkeeping) kept in the page.
  await page.evaluate(() => {
    window.__wq = {
      events: { pickup: [], switched: [], slots: [], fired: 0 },
      install() {
        const s = window.__sandstrike;
        if (this._installed) return;
        this._installed = true;
        s.bus.addEventListener('pickup:weapon', (event) => this.events.pickup.push(event.detail));
        s.bus.addEventListener('weapon:switched', (event) => this.events.switched.push(event.detail));
        s.bus.addEventListener('weapon:slots', (event) => this.events.slots.push(event.detail));
        s.bus.addEventListener('weapon:fired', () => { this.events.fired++; });
      },
      clear() { this.events = { pickup: [], switched: [], slots: [], fired: 0 }; },
      robots() {
        return (window.__sandstrike.enemies.robots || [])
          .filter((robot) => robot.alive && robot.state !== 'dead' && robot.state !== 'dying' && robot.root);
      },
      aimAt(distance = 0) {
        const s = window.__sandstrike;
        const robots = this.robots();
        if (!robots.length) return null;
        let best = robots[0];
        let bestDist = Infinity;
        for (const robot of robots) {
          const dist = robot.root.position.distanceTo(s.player.position);
          if (dist < bestDist) { bestDist = dist; best = robot; }
        }
        if (distance > 0) {
          const dx = s.player.position.x - best.root.position.x;
          const dz = s.player.position.z - best.root.position.z;
          const len = Math.hypot(dx, dz) || 1;
          s.player.position.set(best.root.position.x + (dx / len) * distance, s.player.position.y, best.root.position.z + (dz / len) * distance);
          s.fastForward(0.05);
        }
        const point = new s.THREE.Vector3();
        best.root.getWorldPosition(point);
        const eye = s.player.eye;
        s.player.yaw = Math.atan2(-(point.x - eye.x), -(point.z - eye.z));
        const aimHeight = (best.height ?? 1.2) * 0.55;
        s.player.lookPitch = Math.atan2(point.y + aimHeight - eye.y, Math.hypot(point.x - eye.x, point.z - eye.z));
        s.fastForward(0.05);
        this.target = best;
        return {
          type: best.type,
          hp: Math.round(best.hp),
          maxHp: best.maxHp,
          alive: best.alive,
          distance: +best.root.position.distanceTo(s.player.position).toFixed(2),
        };
      },
      targetHp() { return this.target ? Math.round(this.target.hp) : null; },
      targetAlive() { return this.target ? !!this.target.alive : null; },
      enemyHpSum() {
        return (window.__sandstrike.enemies.robots || []).reduce((sum, robot) => sum + (robot.alive ? robot.hp : 0), 0);
      },
      nearest() { const robots = this.robots(); return robots.length ? { type: robots[0].type } : null; },
      switchTo(type) {
        const s = window.__sandstrike;
        s.weapon.switchWeapon(type);
        s.fastForward(0.4);
        return s.weapon.getState().weaponType;
      },
    };
    window.__wq.install();
  });

  // =========================================================================
  // 1. Starting loadout — exactly one weapon
  // =========================================================================
  await group('1. starting loadout — only vxr7', async () => {
    const snap = await weaponSnapshot();
    STATUS.data.start = snap;
    assert('1.1 getSlots() returns the 4 stable slots', snap.slots.length === 4 && sameJson(snap.slots.map((slot) => slot.type), WEAPON_ORDER), { actual: snap.slots.map((slot) => slot.type) });
    assert('1.2 only ONE starting weapon is owned (vxr7)', sameJson(snap.owned, ['vxr7']), { actual: snap.owned });
    assert('1.3 vxr7 is the active slot (slot 0)', snap.state.weaponType === 'vxr7' && snap.state.slotIndex === 0 && snap.slots[0].active === true, { actual: { type: snap.state.weaponType, index: snap.state.slotIndex } });
    assert('1.4 vxr7 starts with a full 30/30 mag + 300+ reserve in auto mode', snap.state.mag === 30 && snap.state.magSize === 30 && snap.state.reserve >= 300 && snap.state.reserve <= 420 && snap.state.weaponMode === 'auto', { actual: snap.state });
    assert('1.5 maxSlots = 4', snap.state.maxSlots === 4 && snap.size === 1, { actual: { maxSlots: snap.state.maxSlots, size: snap.size } });
    assert('1.6 HUD slot strip shows 4 slots, 1 owned + 3 EMPTY', snap.hud.slots.length === 4 && snap.hud.slots[0].type === 'vxr7' && snap.hud.slots[0].active && !snap.hud.slots[0].empty && snap.hud.slots.slice(1).every((slot) => slot.empty && slot.name === 'EMPTY'), { actual: snap.hud.slots });
    assert('1.7 HUD vxr7 slot ammo text = 30 / 300+', snap.hud.slots[0].ammo === '30' && /^\/?3\d\d$/.test(snap.hud.slots[0].reserve.replace(/\s+/g, '')), { actual: { ammo: snap.hud.slots[0].ammo, reserve: snap.hud.slots[0].reserve } });
    assert('1.8 0 console errors during boot + stage entry', STATUS.consoleErrors.length === 0, { actual: STATUS.consoleErrors.slice(0, 4) });
  });

  // =========================================================================
  // 2. Boss weapon drop → ground pickup → pickup:weapon → owned + HUD
  // =========================================================================
  await group('2. boss weapon drop pickup', async () => {
    const drop = await page.evaluate(() => {
      window.__wq.clear();
      const s = window.__sandstrike;
      s.player.godMode = true;
      const forced = s.forceWeaponDrop('gatling');
      const drops = window.__devEnemies?.weaponDrops?.() || [];
      const target = drops[drops.length - 1];
      if (target) s.player.position.set(target.x, s.player.position.y, target.z);
      s.fastForward(0.8);
      return {
        forced,
        drops,
        pickup: window.__wq.events.pickup,
        switched: window.__wq.events.switched,
        slots: s.weapon.getSlots(),
        state: s.weapon.getState(),
      };
    });
    STATUS.data.drop = { forced: drop.forced, drops: drop.drops, pickup: drop.pickup, owned: drop.slots.filter((slot) => slot.owned).map((slot) => slot.type) };
    assert('2.1 forceWeaponDrop("gatling") spawns a ground weapon drop', drop.forced === 'gatling' && drop.drops.some((entry) => entry.type === 'gatling'), { actual: { forced: drop.forced, drops: drop.drops } });
    assert('2.2 walking onto the drop emits pickup:weapon { type:gatling }', drop.pickup.some((detail) => detail && detail.type === 'gatling'), { actual: drop.pickup });
    assert('2.3 gatling becomes owned (inventory = vxr7 + gatling)', sameJson(drop.slots.filter((slot) => slot.owned).map((slot) => slot.type), ['vxr7', 'gatling']), { actual: drop.slots.filter((slot) => slot.owned).map((slot) => slot.type) });
    assert('2.4 picking up does not auto-switch the active weapon', drop.state.weaponType === 'vxr7', { actual: drop.state.weaponType });
    await sleep(250);
    const hud = await page.evaluate(() => [...document.querySelectorAll('[data-weapon-slots] .wslot')].map((node) => ({ type: node.dataset.slotType, empty: node.classList.contains('is-empty'), name: node.querySelector('.wslot-name')?.textContent })));
    assert('2.5 HUD slot 3 lights up as M-77 after pickup', hud[2] && hud[2].type === 'gatling' && hud[2].empty === false && hud[2].name === 'M-77', { actual: hud });
  });

  // =========================================================================
  // 3. Add remaining weapons + switching (API, cycle, real Digit keys) + HUD
  // =========================================================================
  await group('3. inventory switching + HUD slots', async () => {
    const added = await page.evaluate(() => {
      const s = window.__sandstrike;
      return {
        rpg: s.weapon.addWeapon('rpg'),
        shotgun: s.weapon.addWeapon('shotgun'),
        duplicate: s.weapon.addWeapon('gatling'),
        owned: s.weapon.getSlots().filter((slot) => slot.owned).map((slot) => slot.type),
        size: s.weapon._slots.size,
      };
    });
    STATUS.data.added = added;
    assert('3.1 addWeapon(rpg) + addWeapon(shotgun) fill the inventory to 4', added.rpg.added === true && added.shotgun.added === true && sameJson(added.owned, WEAPON_ORDER) && added.size === 4, { actual: added });
    assert('3.2 adding an owned weapon reports added:false', added.duplicate.added === false, { actual: added.duplicate });

    const perType = {};
    for (const type of WEAPON_ORDER) {
      perType[type] = await page.evaluate((weaponType) => {
        const s = window.__sandstrike;
        s.weapon.switchWeapon(weaponType);
        s.fastForward(0.4);
        const state = s.weapon.getState();
        return { weaponType: state.weaponType, weaponMode: state.weaponMode, mag: state.mag, magSize: state.magSize, reserve: state.reserve, slotIndex: state.slotIndex };
      }, type);
    }
    STATUS.data.perType = perType;
    for (const type of WEAPON_ORDER) {
      const expected = SPEC[type];
      const actual = perType[type];
      assert(`3.3 ${type}: mag=magSize=${expected.magSize}, reserve in [${expected.reserveStart},${expected.reserveMax}], mode=${expected.mode}`, actual.weaponType === type && actual.weaponMode === expected.mode && actual.mag === expected.magSize && actual.magSize === expected.magSize && actual.reserve >= expected.reserveStart && actual.reserve <= expected.reserveMax && actual.slotIndex === WEAPON_ORDER.indexOf(type), { expected: { ...expected, slotIndex: WEAPON_ORDER.indexOf(type) }, actual });
    }
    const distinct = new Set(WEAPON_ORDER.map((type) => `${perType[type].magSize}/${perType[type].weaponMode}`));
    assert('3.4 each weapon has a distinct magSize/mode fingerprint', distinct.size === 4, { actual: [...distinct] });

    const cycled = await page.evaluate(() => {
      const s = window.__sandstrike;
      s.weapon.switchWeapon('vxr7'); s.fastForward(0.4);
      s.weapon.cycleWeapon(1); s.fastForward(0.4);
      const forward = s.weapon.getState().weaponType;
      s.weapon.cycleWeapon(-1); s.fastForward(0.4);
      return { forward, back: s.weapon.getState().weaponType };
    });
    assert('3.5 cycleWeapon(+1/-1) moves through the owned slot order', cycled.forward === 'rpg' && cycled.back === 'vxr7', { actual: cycled });

    // Real keyboard events (Digit1..Digit4) — not just the API.
    const keyResults = [];
    for (const [code, expectedType] of [['Digit2', 'rpg'], ['Digit4', 'shotgun'], ['Digit3', 'gatling'], ['Digit1', 'vxr7']]) {
      await page.keyboard.press(code);
      await page.evaluate(() => window.__sandstrike.fastForward(0.4));
      const actual = await page.evaluate(() => window.__sandstrike.weapon.getState().weaponType);
      keyResults.push({ code, expectedType, actual });
    }
    STATUS.data.keys = keyResults;
    assert('3.6 real Digit1-4 key events switch weapons', keyResults.every((entry) => entry.actual === entry.expectedType), { actual: keyResults });

    // HUD strip after switching to each weapon (render is coalesced at 100 ms).
    await page.keyboard.press('Digit4');
    await page.evaluate(() => window.__sandstrike.fastForward(0.4));
    await sleep(300);
    const hudShotgun = await weaponSnapshot();
    STATUS.data.hudShotgun = hudShotgun.hud;
    assert('3.7 HUD marks the active slot (SG-12 slot 4) and keeps 4 non-empty slots', hudShotgun.hud.slots.length === 4 && hudShotgun.hud.slots.filter((slot) => !slot.empty).length === 4 && hudShotgun.hud.slots[3].active === true && hudShotgun.hud.slots[3].type === 'shotgun' && hudShotgun.hud.slots.filter((slot) => slot.active).length === 1, { actual: hudShotgun.hud.slots });

    const slotsEvent = await page.evaluate(() => {
      const list = window.__wq.events.slots;
      return list.length ? list[list.length - 1] : null;
    });
    STATUS.data.slotsEvent = slotsEvent;
    assert('3.8 weapon:slots payload = 4 slots + activeIndex + maxSlots 4', !!slotsEvent && Array.isArray(slotsEvent.slots) && slotsEvent.slots.length === 4 && slotsEvent.activeIndex === 3 && slotsEvent.maxSlots === 4, { actual: slotsEvent });
    assert('3.9 weapon:switched fired for every key switch', await page.evaluate(() => window.__wq.events.switched.length >= 5));
    await shot('weapons-probe-01-slots.png');
  });

  // =========================================================================
  // 4. Fire modes against live wave-1 enemies
  // =========================================================================
  await group('4. firing modes on live enemies', async () => {
    await page.evaluate(() => {
      const s = window.__sandstrike;
      s.player.godMode = true;
      s.enemies.debugKillAll?.();
      s.enemies.debugJumpToWave ? s.enemies.debugJumpToWave(1) : s.jumpToWave(1);
      s.fastForward(4.5);
    });
    const spawned = await page.evaluate(() => window.__wq.robots().length);
    assert('4.1 wave 1 robots spawned for the fire tests', spawned > 0, { actual: spawned });

    // --- auto (VXR-7): 1 ammo per shot -------------------------------------
    const auto = await page.evaluate(() => {
      const s = window.__sandstrike;
      const aim = window.__wq.aimAt();
      s.weapon.switchWeapon('vxr7'); s.fastForward(0.5);
      s.weapon.fireCooldown = 0;
      const before = { mag: s.weapon.getState().mag, shotsFired: s.weapon.shotsFired, shotsHit: s.weapon.shotsHit };
      const fired = s.weapon.tryFire();
      s.fastForward(0.05);
      const after = { mag: s.weapon.getState().mag, shotsFired: s.weapon.shotsFired, shotsHit: s.weapon.shotsHit };
      // held trigger: 0.5 s at 640 rpm ≈ 5 rounds
      s.weapon.fireCooldown = 0;
      const magHold = s.weapon.getState().mag;
      s.weapon.triggerDown = true;
      s.fastForward(0.5);
      s.weapon.triggerDown = false;
      s.fastForward(0.1);
      return { aim, fired, before, after, held: { mag0: magHold, mag1: s.weapon.getState().mag } };
    });
    STATUS.data.modeAuto = auto;
    assert('4.2 auto hitscan fires and consumes exactly 1 round', auto.fired === true && auto.after.mag === auto.before.mag - 1 && auto.after.shotsFired === auto.before.shotsFired + 1, { actual: auto });
    assert('4.3 held auto trigger consumes >1 round in 0.5 s', auto.held.mag0 - auto.held.mag1 > 1, { actual: auto.held });

    // --- shotgun: 1 shell, multiple pellets --------------------------------
    let shotgun = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      shotgun = await page.evaluate(() => {
        const s = window.__sandstrike;
        s.weapon.switchWeapon('shotgun'); s.fastForward(0.5);
        const aim = window.__wq.aimAt(4);
        if (!aim) return { error: 'no target' };
        s.weapon.fireCooldown = 0;
        const magBefore = s.weapon.getState().mag;
        const hpBefore = window.__wq.targetHp();
        const hitBefore = s.weapon.shotsHit;
        const fired = s.weapon.tryFire();
        s.fastForward(0.1);
        return {
          aim, fired,
          magBefore, magAfter: s.weapon.getState().mag,
          hpBefore, hpAfter: window.__wq.targetHp(),
          damage: hpBefore - window.__wq.targetHp(),
          hitDelta: s.weapon.shotsHit - hitBefore,
          dead: window.__wq.targetAlive() === false,
        };
      });
      if (shotgun.damage > 0 || shotgun.dead) break;
      await page.evaluate(() => window.__sandstrike.fastForward(0.6));
    }
    STATUS.data.modeShotgun = shotgun;
    assert('4.4 shotgun consumes exactly 1 shell per shot', shotgun.fired === true && shotgun.magAfter === shotgun.magBefore - 1, { actual: shotgun });
    assert('4.5 shotgun lands multiple pellets (damage > single-pellet 13 / target dies)', !!shotgun && (shotgun.damage > 13 || shotgun.dead === true), { actual: shotgun });

    // --- gatling: spin-up gate then >1 round in 0.5 s ----------------------
    const gatling = await page.evaluate(() => {
      const s = window.__sandstrike;
      s.weapon.switchWeapon('gatling'); s.fastForward(0.6);
      window.__wq.aimAt();
      s.weapon.fireCooldown = 0;
      const mag0 = s.weapon.getState().mag;
      const shots0 = s.weapon.shotsFired;
      s.weapon.triggerDown = true;
      s.fastForward(0.2); // spin-up below the fire threshold
      const early = { spin: s.weapon.spin, mag: s.weapon.getState().mag, shots: s.weapon.shotsFired, threshold: s.weapon._stats?.spinFireThreshold };
      s.fastForward(0.5); // past the threshold → sustained fire
      const later = { spin: s.weapon.spin, mag: s.weapon.getState().mag, shots: s.weapon.shotsFired };
      s.weapon.triggerDown = false;
      s.fastForward(1.4); // spin-down
      return { mag0, shots0, early, later, afterRelease: { spin: s.weapon.spin, mag: s.weapon.getState().mag } };
    });
    STATUS.data.modeGatling = gatling;
    assert('4.6 gatling does not fire before spin-up threshold', gatling.early.spin < (gatling.early.threshold ?? 0.45) && gatling.early.mag === gatling.mag0 && gatling.early.shots === gatling.shots0, { actual: gatling.early });
    assert('4.7 gatling consumes >1 round in 0.5 s once spun up', gatling.mag0 - gatling.later.mag > 1 && gatling.later.shots - gatling.shots0 > 1, { actual: gatling.later });
    assert('4.8 gatling spins down after the trigger is released', gatling.afterRelease.spin < 0.1, { actual: gatling.afterRelease });

    // --- RPG: projectile + explosion damage --------------------------------
    // The rocket flies a real trajectory and can clip world geometry, so retry
    // up to 3 times from different stand-off distances (reloading between shots).
    const rpg = await page.evaluate(() => {
      const s = window.__sandstrike;
      s.weapon.switchWeapon('rpg'); s.fastForward(0.6);
      const hpSumBefore = window.__wq.enemyHpSum();
      const attempts = [];
      let last = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (s.weapon.getState().mag < 1) {
          s.weapon.startReload?.();
          s.fastForward(3.6);
        }
        const aim = window.__wq.aimAt(4 + attempt * 2);
        s.weapon.fireCooldown = 0;
        const magBefore = s.weapon.getState().mag;
        const fired = s.weapon.tryFire();
        const activeAfterFire = (s.weapon._rockets || []).filter((projectile) => projectile.active).length;
        const magAfterFire = s.weapon.getState().mag;
        let steps = 0;
        while ((s.weapon._rockets || []).some((projectile) => projectile.active) && steps < 60) {
          s.fastForward(0.05);
          steps++;
        }
        last = {
          attempt,
          aim,
          fired,
          magBefore,
          magAfterFire,
          activeAfterFire,
          activeAfterDetonation: (s.weapon._rockets || []).filter((projectile) => projectile.active).length,
          damage: hpSumBefore - window.__wq.enemyHpSum(),
          steps,
        };
        attempts.push(last);
        if (last.damage > 0) break;
      }
      return {
        ...last,
        attempts,
        hpSumBefore,
        hpSumAfter: window.__wq.enemyHpSum(),
        damage: hpSumBefore - window.__wq.enemyHpSum(),
        mode: s.weapon.getState().weaponMode,
      };
    });
    STATUS.data.modeRpg = rpg;
    assert('4.9 RPG spawns a real projectile and consumes its 1 loaded rocket', rpg.fired === true && rpg.mode === 'rocket' && rpg.activeAfterFire >= 1 && rpg.magAfterFire === rpg.magBefore - 1, { actual: rpg });
    assert('4.10 RPG projectile detonates and damages enemies (direct or splash)', rpg.activeAfterDetonation === 0 && rpg.damage > 0, { actual: { damage: rpg.damage, attempts: rpg.attempts } });
    assert('4.11 no console errors from any firing mode', STATUS.consoleErrors.length === 0, { actual: STATUS.consoleErrors.slice(0, 4) });
    await page.evaluate(() => { window.__sandstrike.weapon.switchWeapon('rpg'); window.__sandstrike.fastForward(0.4); });
    await shot('weapons-probe-02-rpg.png');
  });

  // =========================================================================
  // 5. Inventory cap — duplicates refill, replace branch stays bounded at 4
  // =========================================================================
  await group('5. inventory cap = 4', async () => {
    const duplicate = await page.evaluate(() => {
      const s = window.__sandstrike;
      const before = s.weapon.getSlots().find((slot) => slot.type === 'gatling');
      s.weapon.switchWeapon('gatling'); s.fastForward(0.4);
      s.weapon.addAmmo(-99999); // drain reserve through the real API
      const drained = s.weapon.getState().reserve;
      const result = s.weapon.addWeapon('gatling');
      return { before, drained, result, after: s.weapon.getState().reserve, owned: s.weapon.getSlots().filter((slot) => slot.owned).map((slot) => slot.type) };
    });
    STATUS.data.capDuplicate = duplicate;
    assert('5.1 duplicate addWeapon returns added:false and refills the reserve', duplicate.result.added === false && duplicate.after === 1200 && duplicate.owned.length === 4, { actual: duplicate });

    const forcedDrop = await page.evaluate(() => {
      window.__wq.clear();
      const s = window.__sandstrike;
      const type = s.forceWeaponDrop('rpg');
      const drops = window.__devEnemies?.weaponDrops?.() || [];
      const target = drops[drops.length - 1];
      if (target) s.player.position.set(target.x, s.player.position.y, target.z);
      s.fastForward(0.8);
      return { type, drops, pickup: window.__wq.events.pickup, owned: s.weapon.getSlots().filter((slot) => slot.owned).map((slot) => slot.type), size: s.weapon._slots.size };
    });
    STATUS.data.capDrop = forcedDrop;
    assert('5.2 collecting a drop for an already-owned weapon refills instead of overflowing', forcedDrop.pickup.length >= 1 && forcedDrop.owned.length === 4 && forcedDrop.size === 4, { actual: forcedDrop });

    // The replace path only triggers when an UNOWNED type is added while the
    // inventory is full. With exactly 4 configured weapons that state is
    // unreachable in normal play, so exercise the bounded branch white-box.
    const replace = await page.evaluate(() => {
      const s = window.__sandstrike;
      const slots = s.weapon._slots;
      const shotgunSlot = slots.get('shotgun');
      slots.delete('shotgun');
      slots.set('dummy', shotgunSlot); // size stays 4, one non-canonical key
      const before = { size: slots.size, active: s.weapon.getState().weaponType };
      const result = s.weapon.addWeapon('shotgun');
      const after = { size: slots.size, owned: s.weapon.getSlots().filter((slot) => slot.owned).map((slot) => slot.type) };
      // restore the canonical inventory through the real import API
      s.weapon.importProgression({ owned: ['vxr7', 'rpg', 'gatling', 'shotgun'], active: 'vxr7', perWeapon: {} });
      s.fastForward(0.4);
      return {
        before, result, after,
        restored: { owned: s.weapon.getSlots().filter((slot) => slot.owned).map((slot) => slot.type), size: slots.size, hasDummy: slots.has('dummy'), active: s.weapon.getState().weaponType },
      };
    });
    STATUS.data.capReplace = replace;
    assert('5.3 white-box full-inventory add replaces the ACTIVE slot and stays at 4', replace.result.added === true && replace.result.replacedType === replace.before.active && replace.after.size === 4 && replace.after.owned.includes('shotgun'), { actual: replace });
    assert('5.4 importProgression restores the canonical 4-weapon inventory', sameJson(replace.restored.owned, WEAPON_ORDER) && replace.restored.size === 4 && replace.restored.hasDummy === false && replace.restored.active === 'vxr7', { actual: replace.restored });

    note('With 4 configured weapons the "add a 5th type" branch is unreachable through gameplay; 5.3 drives it white-box to prove the inventory never exceeds MAX_WEAPON_SLOTS.');
  });

  // =========================================================================
  // 6. exportProgression / importProgression round-trip
  // =========================================================================
  await group('6. progression round-trip', async () => {
    const upgraded = await page.evaluate(() => {
      const s = window.__sandstrike;
      for (const type of ['vxr7', 'rpg', 'gatling', 'shotgun']) {
        s.weapon.switchWeapon(type);
        s.fastForward(0.35);
        s.weapon.addMagCapacity(4);
        s.weapon.addDamageBoost(0.05);
        s.weapon.addReloadSpeed(0.1);
      }
      s.weapon.switchWeapon('gatling');
      s.fastForward(0.35);
      return { exported: s.weapon.exportProgression(), state: s.weapon.getState() };
    });
    STATUS.data.progressionUpgraded = upgraded;
    const perWeapon = upgraded.exported?.perWeapon || {};
    assert('6.1 every owned weapon has per-weapon upgrades recorded', ['vxr7', 'rpg', 'gatling', 'shotgun'].every((type) => perWeapon[type] && perWeapon[type].magExtension > 0 && perWeapon[type].damageMultiplier > 1 && perWeapon[type].reloadSpeedMul < 1), { actual: perWeapon });
    assert('6.2 exported active weapon = gatling', upgraded.exported.active === 'gatling' && sameJson(upgraded.exported.owned, WEAPON_ORDER), { actual: { active: upgraded.exported.active, owned: upgraded.exported.owned } });
    assert('6.3 active gatling reflects the upgrades (magExtension 4, dmg ×1.05)', upgraded.state.magExtension === 4 && Math.abs(upgraded.state.damageMultiplier - 1.05) < 1e-6, { actual: upgraded.state });

    const roundTrip = await page.evaluate(() => {
      const s = window.__sandstrike;
      const exported = s.weapon.exportProgression();
      s.weapon.resetUpgrades();
      s.fastForward(0.2);
      const afterReset = s.weapon.exportProgression();
      const imported = s.weapon.importProgression(exported);
      s.fastForward(0.2);
      const afterImport = s.weapon.exportProgression();
      const state = s.weapon.getState();
      const legacy = s.weapon.exportUpgrades();
      return { exported, afterReset, imported, afterImport, state, legacy };
    });
    STATUS.data.progressionRoundTrip = roundTrip;
    assert('6.4 resetUpgrades clears every weapon upgrade', Object.values(roundTrip.afterReset.perWeapon).every((entry) => entry.magExtension === 0 && entry.damageMultiplier === 1 && entry.reloadSpeedMul === 1), { actual: roundTrip.afterReset });
    assert('6.5 importProgression reports success', roundTrip.imported === true, { actual: roundTrip.imported });
    assert('6.6 round-trip restores owned + active + per-weapon upgrades exactly', sameJson(roundTrip.afterImport, roundTrip.exported), { expected: roundTrip.exported, actual: roundTrip.afterImport });
    assert('6.7 restored upgrades are live in getState (gatling magExt 4 / dmg ×1.05)', roundTrip.state.magExtension === 4 && Math.abs(roundTrip.state.damageMultiplier - 1.05) < 1e-6 && roundTrip.state.weaponType === 'gatling', { actual: roundTrip.state });
    assert('6.8 BUG: gatling magSize must not shrink below its 200-round belt after upgrades', roundTrip.state.magSize >= 200, { expected: '>= 200 (200 base + 4 extension)', actual: roundTrip.state.magSize, note: 'src/weapons.js `_recomputeMagSize()` clamps every weapon to UPGRADE.magSizeMax=120; gatling base magSize is 200.' });
    assert('6.9 legacy exportUpgrades/importUpgrades alias still readable', roundTrip.legacy && Number.isFinite(roundTrip.legacy.magExtension) && Number.isFinite(roundTrip.legacy.damageMultiplier) && Number.isFinite(roundTrip.legacy.reloadSpeedMul), { actual: roundTrip.legacy });
    assert('6.10 0 console errors for the whole probe', STATUS.consoleErrors.length === 0, { actual: STATUS.consoleErrors.slice(0, 4) });
  });
} catch (error) {
  STATUS.fatal = String((error && error.stack) || error);
  console.error('\nFATAL', STATUS.fatal);
} finally {
  const failed = STATUS.assertions.filter((entry) => !entry.pass);
  STATUS.ok = failed.length === 0 && STATUS.consoleErrors.length === 0 && !STATUS.fatal;
  STATUS.finishedAt = new Date().toISOString();
  STATUS.durationMs = Date.now() - T0;
  STATUS.summary = { groups: STATUS.groups.length, assertions: STATUS.assertions.length, failed: failed.length, skipped: STATUS.assertions.filter((entry) => entry.skipped).length, consoleErrors: STATUS.consoleErrors.length };
  await writeFile(resolve(OUT, 'weapons-probe.json'), JSON.stringify(STATUS, null, 2), 'utf8');
  await browser.close();
  console.log(`\nweapons-probe: ${STATUS.ok ? 'PASS' : 'FAIL'} — ${STATUS.summary.assertions} assertions, ${failed.length} failed, ${STATUS.consoleErrors.length} console errors → shots/weapons-probe.json`);
  for (const entry of failed.slice(0, 20)) console.log(`  ✗ [${entry.group}] ${entry.name}`, entry.actual !== undefined ? JSON.stringify(entry.actual) : '');
  if (STATUS.consoleErrors.length) console.log(STATUS.consoleErrors.slice(0, 10).join('\n'));
  if (!STATUS.ok) process.exitCode = 1;
}
