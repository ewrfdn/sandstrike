/**
 * SANDSTRIKE boss / difficulty probe — `.scratch/features/CONTRACT.md` §2/§4/§7/§10.
 *
 *   node scripts/boss-probe.mjs            # BASE_URL from env (default 127.0.0.1:8080)
 *   BASE_URL=http://127.0.0.1:8095 node scripts/boss-probe.mjs
 *
 * Headless Playwright probe for the SIEGE WARDEN boss wave:
 *   1. wave 5 spawns exactly one `boss` chassis and ZERO warlords (boss replaces it),
 *      with `boss:spawn` / `boss:health` events and the HUD boss bar; boss maxHp equals
 *      ENEMY_STATS.boss.hp × waveMods(5).hp × difficulty.hpMul (verified for standard)
 *   2. boss health events + HUD fill track damage; killing it emits `boss:defeated`,
 *      empties then hides the bar (1.2 s) and drops the full care package
 *   3. the configured boss weapon drop roll: forced 100% (patched RNG) spawns a
 *      collectible weapon pickup, forced miss (95% branch) spawns none
 *   4. waves 6+ keep running after the boss dies and clearing wave 15 reaches victory
 *   5. nightmare (hpMul 4) scales the wave-5 boss to 8664 HP
 *   + 1600×900 screenshot of the boss on screen
 *
 * Writes `shots/boss-probe.json` + `shots/boss-01-siege-warden.png`, exits 1 on failure.
 * Dependencies: playwright-core + node stdlib only.
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASE_URL = (process.env.BASE_URL || process.argv[2] || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const QUERY = process.env.PROBE_QUERY || 'dev=1&quality=high';
const USE_GPU = process.env.PROBE_GPU === '1';
const OUT = resolve('shots');
// Logic runs at a small viewport; the one required boss screenshot is taken at
// 1600×900 (page.setViewportSize) so the capture still matches the desktop layout.
const VIEWPORT = { width: Number(process.env.PROBE_W) || 960, height: Number(process.env.PROBE_H) || 540 };
const SHOT_VIEWPORT = { width: 1600, height: 900 };
/** Mirrors src/config/enemies.js + the waveMods() curve in src/enemies.js (asserted, not imported). */
const BOSS_BASE_HP = 1900;
const WAVE5_MODS = 1 + 0.035 * 4;
const STANDARD_WAVE5_HP = Math.round(BOSS_BASE_HP * WAVE5_MODS);
const NIGHTMARE_WAVE5_HP = Math.round(BOSS_BASE_HP * WAVE5_MODS * 4);
const BOSS_DROP_CHANCE = 0.05;

const GPU_ARGS = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required'];
const SWIFTSHADER_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'];

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const STATUS = { ok: false, probe: 'boss', url: BASE_URL, query: QUERY, startedAt: new Date().toISOString(), finishedAt: null, durationMs: 0, groups: [], assertions: [], consoleErrors: [], screenshots: {}, notes: [], data: {}, fatal: null };
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
async function waitBoot() {
  await page.waitForFunction(() => {
    const menu = document.querySelector('.screen--menu');
    return window.__sandstrikeApp?.loaded === true && window.__sandstrike?.state === 'menu' && !!menu && menu.classList.contains('is-active');
  }, null, { timeout: Number(process.env.PROBE_BOOT_TIMEOUT) || 300_000, polling: 100 });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-start]');
    return !!button && !button.disabled;
  }, null, { timeout: 30_000, polling: 100 });
}
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
async function startCampaign(difficulty) {
  await click('[data-start]');
  await waitClass('[data-deploy]', 'is-open');
  await click(`[data-deploy-value="${difficulty}"]`);
  await waitState('playing');
  await page.waitForFunction(() => window.__sandstrike?.ui?.state === 'playing', null, { timeout: 20_000, polling: 100 });
}

/** Event recorder kept in the page (survives until reload). */
const installEvents = () => page.evaluate(() => {
  const s = window.__sandstrike;
  window.__bq = { events: [] };
  for (const name of ['boss:spawn', 'boss:health', 'boss:defeated', 'wave:start', 'wave:clear', 'pickup:weapon', 'weapon:notice', 'combat:all-waves-cleared']) {
    s.bus.addEventListener(name, (event) => window.__bq.events.push({ name, detail: event.detail }));
  }
});
const clearEvents = () => page.evaluate(() => { if (window.__bq) window.__bq.events.length = 0; });
const readEvents = (filter) => page.evaluate((prefix) => (window.__bq?.events || []).filter((event) => !prefix || event.name.startsWith(prefix)), filter || null);
const bossState = () => page.evaluate(() => {
  const s = window.__sandstrike;
  const robots = (s.enemies.robots || []).filter((robot) => robot.alive);
  const boss = robots.find((robot) => robot.def?.boss || robot.type === 'boss') || null;
  return {
    state: s.state,
    wave: s.enemies.state.wave,
    totalWaves: s.enemies.state.totalWaves,
    stageId: s.enemies.state.stageId,
    difficulty: s.enemies.state.difficulty,
    types: robots.map((robot) => robot.type),
    counts: robots.reduce((acc, robot) => { acc[robot.type] = (acc[robot.type] || 0) + 1; return acc; }, {}),
    boss: boss ? {
      type: boss.type,
      state: boss.state,
      hp: Math.round(boss.hp),
      maxHp: boss.maxHp,
      defHp: boss.def?.hp,
      modsHp: boss.mods?.hp,
      name: boss.def?.name,
      displayName: boss.def?.displayName,
    } : null,
    bossInfo: window.__devEnemies?.bossInfo?.() ?? null,
    hud: {
      barActive: document.querySelector('[data-boss-bar]')?.classList.contains('is-active'),
      barHidden: document.querySelector('[data-boss-bar]')?.getAttribute('aria-hidden'),
      name: document.querySelector('[data-boss-name]')?.textContent ?? '',
      hp: document.querySelector('[data-boss-hp]')?.textContent ?? '',
      fill: document.querySelector('[data-boss-fill]')?.style?.width ?? '',
      waveMode: document.querySelector('[data-wave-mode]')?.textContent ?? '',
    },
  };
});
/** Damage the live boss through the real EnemyManager.damage() entry point. */
const damageBoss = (amount) => page.evaluate((value) => {
  const s = window.__sandstrike;
  const boss = (s.enemies.robots || []).find((robot) => robot.alive && (robot.def?.boss || robot.type === 'boss'));
  if (!boss) return { hit: false };
  const target = (boss.hitboxes && boss.hitboxes[0]) || boss.root;
  s.enemies.damage(target, value, { headshot: false, weapon: 'probe', point: { x: boss.pos.x, y: boss.pos.y + 1.2, z: boss.pos.z }, direction: { x: 0, y: 0, z: -1 } });
  return { hit: true, hp: Math.round(boss.hp), maxHp: boss.maxHp };
}, amount);
/** Aim the player camera at the boss and hold the frame (screenshot helper). */
const frameBoss = () => page.evaluate(() => {
  const s = window.__sandstrike;
  const boss = (s.enemies.robots || []).find((robot) => robot.alive && (robot.def?.boss || robot.type === 'boss'));
  if (!boss) return { framed: false };
  const eye = s.player.eye;
  const bossPos = boss.root.position;
  const dx = bossPos.x - s.player.position.x;
  const dz = bossPos.z - s.player.position.z;
  const distance = Math.hypot(dx, dz) || 12;
  const stand = 14;
  s.player.position.set(bossPos.x - (dx / distance) * stand, s.player.position.y, bossPos.z - (dz / distance) * stand);
  s.fastForward(0.1);
  const eye2 = s.player.eye;
  s.player.yaw = Math.atan2(-(bossPos.x - eye2.x), -(bossPos.z - eye2.z));
  s.player.lookPitch = Math.atan2((bossPos.y + (boss.height || 3) * 0.5) - eye2.y, Math.hypot(bossPos.x - eye2.x, bossPos.z - eye2.z));
  s.player.update(0);
  s.fastForward(0.05);
  s.freeze?.(true);
  s.effects?.reset?.();
  s.renderOnce?.();
  return { framed: true, distance: Math.round(distance) };
});

try {
  // =========================================================================
  // Boot + standard campaign
  // =========================================================================
  await page.goto(`${BASE_URL}/?${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitBoot();
  await installEvents();
  await startCampaign('standard');

  // =========================================================================
  // 1. Wave 5: boss replaces warlord + HP formula + events + HUD bar
  // =========================================================================
  await group('1. wave 5 — SIEGE WARDEN spawn / HP / events / HUD', async () => {
    const config = await page.evaluate(async () => {
      const [{ ENEMY_STATS }, { WAVE_RULES, resolveWave }, game] = await Promise.all([
        import('/src/config/enemies.js'),
        import('/src/config/waves.js'),
        import('/src/config/game.js'),
      ]);
      const resolved = resolveWave('outpost-07', 5);
      return {
        bossBase: ENEMY_STATS.boss.hp,
        bossDamage: ENEMY_STATS.boss.damage,
        waveRules: { bossEvery: WAVE_RULES.bossEvery, bossType: WAVE_RULES.bossType, bossCount: WAVE_RULES.bossCount, bossReplaces: WAVE_RULES.bossReplaces },
        resolvedComp: resolved.comp,
        resolvedBoss: resolved.boss,
        label: resolved.label,
        dropChance: game.CONFIG?.loot?.bossWeaponDropChance ?? null,
        dropCount: game.CONFIG?.loot?.bossWeaponDropCount ?? null,
      };
    });
    STATUS.data.wave5Config = config;
    assert('1.1 wave rules: boss every 5th wave, type boss, replaces warlord', config.waveRules.bossEvery === 5 && config.waveRules.bossType === 'boss' && config.waveRules.bossCount === 1 && sameJson(config.waveRules.bossReplaces, ['warlord']), { actual: config.waveRules });
    assert('1.2 resolved wave-5 comp has 1 boss and 0 warlord', config.resolvedComp?.boss === 1 && !config.resolvedComp?.warlord && config.resolvedBoss === true, { actual: config.resolvedComp });
    assert('1.3 CONFIG.loot.bossWeaponDropChance is 0.05 (1 drop)', config.dropChance === BOSS_DROP_CHANCE && config.dropCount === 1, { actual: { chance: config.dropChance, count: config.dropCount } });

    await clearEvents();
    await page.evaluate(() => {
      const s = window.__sandstrike;
      s.player.godMode = true;
      s.jumpToWave(5);
      s.fastForward(7.5);
    });
    const wave5 = await bossState();
    const startEvent = (await readEvents('wave:start'))[0];
    const spawnEvents = await readEvents('boss:spawn');
    const healthEvents = await readEvents('boss:health');
    STATUS.data.wave5Standard = { wave5, startEvent: startEvent?.detail, spawnEvents: spawnEvents.map((event) => event.detail), healthEvents: healthEvents.map((event) => event.detail).slice(0, 3) };

    assert('1.4 wave 5 is live with 12 contacts (3 scout / 4 rifleman / 4 heavy / 1 boss)', wave5.wave === 5 && wave5.counts.scout === 3 && wave5.counts.rifleman === 4 && wave5.counts.heavy === 4 && wave5.counts.boss === 1 && Object.keys(wave5.counts).length === 4, { actual: { wave: wave5.wave, counts: wave5.counts } });
    assert('1.5 exactly ONE boss chassis spawned and ZERO warlords', wave5.counts.boss === 1 && !wave5.counts.warlord, { actual: wave5.counts });
    assert('1.6 boss is the SIEGE WARDEN chassis (boss flag + displayName)', wave5.boss && wave5.boss.type === 'boss' && /SIEGE WARDEN/i.test(wave5.boss.displayName || ''), { actual: wave5.boss });
    assert(`1.7 standard boss maxHp = 1900 × 1.14 × 1 = ${STANDARD_WAVE5_HP}`, wave5.boss.hp === STANDARD_WAVE5_HP && wave5.boss.maxHp === STANDARD_WAVE5_HP, { expected: STANDARD_WAVE5_HP, actual: wave5.boss && { hp: wave5.boss.hp, maxHp: wave5.boss.maxHp, defHp: wave5.boss.defHp, modsHp: wave5.boss.modsHp } });
    assert('1.8 bossInfo() dev hook reports the live boss', wave5.bossInfo && wave5.bossInfo.alive === true && wave5.bossInfo.maxHp === STANDARD_WAVE5_HP && /SIEGE WARDEN/i.test(wave5.bossInfo.displayName || ''), { actual: wave5.bossInfo });
    assert('1.9 wave:start label is the SIEGE WARDEN wave', /SIEGE WARDEN/i.test(startEvent?.detail?.label || ''), { actual: startEvent?.detail });
    assert('1.10 boss:spawn fired once with displayName + wave 5 + full hp', spawnEvents.length === 1 && spawnEvents[0].detail?.wave === 5 && spawnEvents[0].detail?.maxHp === STANDARD_WAVE5_HP && /SIEGE WARDEN/i.test(spawnEvents[0].detail?.displayName || ''), { actual: spawnEvents.map((event) => event.detail) });
    assert('1.11 boss:health fired at fraction 1 on spawn', healthEvents.length >= 1 && healthEvents[0].detail?.fraction === 1 && healthEvents[0].detail?.maxHp === STANDARD_WAVE5_HP, { actual: healthEvents.map((event) => event.detail) });
    assert('1.12 HUD boss bar is active and shows the WARDEN at full HP', wave5.hud.barActive === true && wave5.hud.barHidden === 'false' && /SIEGE WARDEN/i.test(wave5.hud.name) && wave5.hud.hp === `${STANDARD_WAVE5_HP} / ${STANDARD_WAVE5_HP}` && wave5.hud.fill === '100%', { actual: wave5.hud });
    assert('1.13 HUD difficulty chip shows STANDARD', /STANDARD/.test(wave5.hud.waveMode), { actual: wave5.hud.waveMode });
    assert('1.14 0 console errors during wave-5 spawn', STATUS.consoleErrors.length === 0, { actual: STATUS.consoleErrors.slice(0, 4) });

    // 1600×900 boss beauty shot
    await page.setViewportSize(SHOT_VIEWPORT);
    await sleep(600);
    const framed = await frameBoss();
    STATUS.data.bossFramed = framed;
    await sleep(400);
    await page.screenshot({ path: resolve(OUT, 'boss-01-siege-warden.png') });
    STATUS.screenshots['boss-01-siege-warden'] = 'shots/boss-01-siege-warden.png';
    await page.evaluate(() => window.__sandstrike.freeze?.(false));
    await page.setViewportSize(VIEWPORT);
    await sleep(300);
    assert('1.15 boss captured on screen at 1600×900 (shots/boss-01-siege-warden.png)', framed.framed === true);
  });

  // =========================================================================
  // 2. Damage → health events; kill → defeated + bar hides + care package
  // =========================================================================
  await group('2. kill — boss:defeated / bar hide / care package / drop roll', async () => {
    await clearEvents();
    const damaged = await damageBoss(Math.round(STANDARD_WAVE5_HP * 0.25));
    await page.evaluate(() => window.__sandstrike.fastForward(0.3));
    const damageEvents = await readEvents('boss:health');
    const afterDamage = await bossState();
    STATUS.data.bossDamage = { damaged, events: damageEvents.map((event) => event.detail), hud: afterDamage.hud, boss: afterDamage.boss };
    assert('2.1 damaging the boss emits boss:health with the new hp/fraction', damageEvents.length >= 1 && damageEvents[damageEvents.length - 1].detail?.hp < STANDARD_WAVE5_HP && damageEvents[damageEvents.length - 1].detail?.fraction < 1, { actual: damageEvents.map((event) => event.detail) });
    assert('2.2 boss hp actually dropped by ~25%', afterDamage.boss.hp <= Math.round(STANDARD_WAVE5_HP * 0.78), { actual: afterDamage.boss });
    assert('2.3 HUD boss fill/HP follow the damage', afterDamage.hud.fill !== '100%' && afterDamage.hud.hp !== `${STANDARD_WAVE5_HP} / ${STANDARD_WAVE5_HP}`, { actual: afterDamage.hud });

    // Force the 5% drop roll to succeed by pinning Math.random to 0 for the killing
    // blow (the configured chance has no dev setter — see the note at 2.10).
    await clearEvents();
    const kill = await page.evaluate((expected) => {
      const s = window.__sandstrike;
      const boss = (s.enemies.robots || []).find((robot) => robot.alive && (robot.def?.boss || robot.type === 'boss'));
      if (!boss) return { error: 'no boss' };
      const dropsBefore = (window.__devEnemies?.weaponDrops?.() || []).length;
      const originalRandom = Math.random;
      Math.random = () => 0; // weapon-drop roll < 0.05 → guaranteed drop
      try {
        s.enemies.damage((boss.hitboxes && boss.hitboxes[0]) || boss.root, 9_999_999, { headshot: false, weapon: 'probe' });
        s.fastForward(0.8);
      } finally {
        Math.random = originalRandom;
      }
      return {
        dropsBefore,
        dropsAfter: window.__devEnemies?.weaponDrops?.() || [],
        activePickups: (s.enemies._pickupPool || []).filter((item) => item.active).map((item) => item.kind),
        bossAlive: boss.alive,
        expected,
      };
    }, STANDARD_WAVE5_HP);
    const defeatedEvents = await readEvents('boss:defeated');
    const healthTail = (await readEvents('boss:health')).map((event) => event.detail);
    STATUS.data.bossKill = { kill, defeatedEvents: defeatedEvents.map((event) => event.detail), healthTail };
    assert('2.4 killing the boss emits boss:defeated exactly once', defeatedEvents.length === 1 && /SIEGE WARDEN/i.test(defeatedEvents[0].detail?.displayName || '') && defeatedEvents[0].detail?.wave === 5, { actual: defeatedEvents.map((event) => event.detail) });
    assert('2.5 final boss:health tick reports fraction 0', healthTail.some((detail) => detail && detail.hp === 0 && detail.fraction === 0), { actual: healthTail });
    assert('2.6 boss is dead after the kill', kill.bossAlive === false, { actual: kill });
    assert('2.7 boss death drops the full care package (health/ammo/mag/power/reload)', ['health', 'ammo', 'mag', 'power', 'reload'].every((kind) => kill.activePickups.includes(kind)), { actual: kill.activePickups });
    assert('2.8 forced (100%) boss weapon roll spawns a weapon pickup', kill.dropsAfter.length > kill.dropsBefore, { actual: { before: kill.dropsBefore, after: kill.dropsAfter } });

    await sleep(1_600); // HUD hides the boss bar 1.2 s after the death event
    const hidden = await page.evaluate(() => ({
      active: document.querySelector('[data-boss-bar]')?.classList.contains('is-active'),
      hidden: document.querySelector('[data-boss-bar]')?.getAttribute('aria-hidden'),
      fill: document.querySelector('[data-boss-fill]')?.style?.width,
    }));
    STATUS.data.bossBarHidden = hidden;
    assert('2.9 boss bar hides ~1.2 s after death', hidden.active === false && hidden.hidden === 'true', { actual: hidden });

    // The care-package weapon pickup is collectible through the normal player path.
    await clearEvents();
    const collected = await page.evaluate(() => {
      const s = window.__sandstrike;
      const drops = window.__devEnemies?.weaponDrops?.() || [];
      const target = drops[drops.length - 1];
      if (target) s.player.position.set(target.x, s.player.position.y, target.z);
      s.fastForward(0.8);
      return { drops, pickup: (window.__bq?.events || []).filter((event) => event.name === 'pickup:weapon').map((event) => event.detail), owned: s.weapon.getSlots().filter((slot) => slot.owned).map((slot) => slot.type) };
    });
    STATUS.data.bossDropCollected = collected;
    assert('2.10 the boss weapon drop is walk-collectible → pickup:weapon + owned', collected.drops.length >= 1 && collected.pickup.length >= 1 && collected.owned.length >= 2, { actual: collected });
    note('CONTRACT §7 suggested `__devEnemies.setDropChance(1)`; boss-waves did not expose that hook, so the 5% roll is forced deterministically by pinning Math.random during the real `_rollBossWeaponDrop()` call. The 95% miss branch is verified in group 3.');

    const dropChanceHook = await page.evaluate(() => typeof window.__devEnemies?.setDropChance);
    note(`__devEnemies.setDropChance: ${dropChanceHook} (absent → RNG pinning used instead)`);
  });

  // =========================================================================
  // 3. 95% branch — no weapon drop for an average boss death
  // =========================================================================
  await group('3. boss spawn hook + 95% no-drop branch', async () => {
    const spawned = await page.evaluate(() => {
      const s = window.__sandstrike;
      const robot = s.spawnBoss();
      s.fastForward(3.2);
      return { returned: robot ? { type: robot.type, hp: robot.hp, maxHp: robot.maxHp } : null, info: window.__devEnemies?.bossInfo?.() };
    });
    STATUS.data.spawnBossHook = spawned;
    assert('3.1 __sandstrike.spawnBoss() dev hook spawns a live boss', spawned.returned?.type === 'boss' && spawned.info?.alive === true, { actual: spawned });

    const miss = await page.evaluate(() => {
      const s = window.__sandstrike;
      const boss = (s.enemies.robots || []).find((robot) => robot.alive && (robot.def?.boss || robot.type === 'boss'));
      if (!boss) return { error: 'no boss' };
      const before = (window.__devEnemies?.weaponDrops?.() || []).length;
      const originalRandom = Math.random;
      Math.random = () => 0.9; // 0.9 !< 0.05 → the 95% case
      let roll = null;
      try {
        roll = s.enemies._rollBossWeaponDrop(new s.THREE.Vector3(boss.pos.x, 0, boss.pos.z));
        s.enemies.damage((boss.hitboxes && boss.hitboxes[0]) || boss.root, 9_999_999, { headshot: false, weapon: 'probe' });
        s.fastForward(0.8);
      } finally {
        Math.random = originalRandom;
      }
      return { before, after: (window.__devEnemies?.weaponDrops?.() || []).length, roll };
    });
    STATUS.data.bossDropMiss = miss;
    assert('3.2 a 95% miss roll spawns no weapon drop', miss.roll === 0 && miss.after === miss.before, { actual: miss });
  });

  // =========================================================================
  // 4. Waves 6+ continue normally; clearing wave 15 reaches victory
  // =========================================================================
  await group('4. waves 6+ continue / wave 15 victory', async () => {
    const nextWave = await page.evaluate(() => {
      const s = window.__sandstrike;
      s.player.godMode = true;
      s.enemies.debugKillAll?.();
      const trace = [];
      for (let i = 0; i < 12; i++) {
        s.fastForward(7.0);
        trace.push({ wave: s.enemies.state.wave, alive: s.enemies.state.alive });
        if (s.enemies.state.wave >= 6 && s.enemies.state.alive > 0) break;
        s.fastForward(2.0);
      }
      const robots = (s.enemies.robots || []).filter((robot) => robot.alive);
      return {
        wave: s.enemies.state.wave,
        trace,
        types: robots.map((robot) => robot.type),
        counts: robots.reduce((acc, robot) => { acc[robot.type] = (acc[robot.type] || 0) + 1; return acc; }, {}),
        bossBar: document.querySelector('[data-boss-bar]')?.classList.contains('is-active'),
      };
    });
    STATUS.data.wave6 = nextWave;
    assert('4.1 wave 6 starts normally after the boss wave', nextWave.wave === 6 && nextWave.types.length > 0, { actual: nextWave });
    assert('4.2 wave 6 has no boss and no warlord (normal comp)', !nextWave.types.includes('boss') && !nextWave.types.includes('warlord'), { actual: nextWave.counts });
    // The dev-spawned boss from group 3 died a moment ago; the HUD hides its bar
    // 1.2 s after `boss:defeated`, so wait for that timer before asserting.
    await page.waitForFunction(() => !document.querySelector('[data-boss-bar]')?.classList.contains('is-active'), null, { timeout: 5_000, polling: 100 }).catch(() => {});
    const barHiddenInWave6 = await page.evaluate(() => document.querySelector('[data-boss-bar]')?.classList.contains('is-active') === false);
    assert('4.3 boss bar stays hidden outside boss waves', barHiddenInWave6 === true, { actual: barHiddenInWave6 });

    const victory = await page.evaluate(() => {
      const s = window.__sandstrike;
      s.player.godMode = true;
      for (let i = 0; i < 90; i++) {
        s.fastForward(7.0);
        s.enemies.debugKillAll?.();
        if (s.state === 'victory' || s.state === 'dead') break;
        s.fastForward(1.0);
      }
      s.fastForward(4.5);
      const save = JSON.parse(localStorage.getItem('sandstrike.progress.v2') || 'null');
      return {
        state: s.state,
        wave: s.enemies.state.wave,
        save: save && save.stages && save.stages['outpost-07'] ? { cleared: save.stages['outpost-07'].cleared, end: !!save.stages['outpost-07'].end } : null,
      };
    });
    await page.waitForFunction(() => {
      const screen = document.querySelector('.screen--victory.is-active');
      return !!screen && parseFloat(getComputedStyle(screen).opacity) > 0.5;
    }, null, { timeout: 30_000, polling: 100 }).catch(() => {});
    const victoryDom = await page.evaluate(() => ({
      screenActive: document.querySelector('.screen--victory')?.classList.contains('is-active'),
      title: document.querySelector('[data-victory-title]')?.textContent ?? '',
      bossBarActive: document.querySelector('[data-boss-bar]')?.classList.contains('is-active'),
    }));
    STATUS.data.victory = { ...victory, dom: victoryDom };
    assert('4.4 clearing wave 15 still reaches state=victory', victory.state === 'victory' && victory.wave === 15, { actual: { state: victory.state, wave: victory.wave } });
    assert('4.5 victory screen is active with the stage-clear title', victoryDom.screenActive === true && /STAGE\s*CLEAR|CAMPAIGN\s*COMPLETE/i.test(victoryDom.title), { actual: victoryDom });
    assert('4.6 victory saved the end snapshot + cleared flag', victory.save?.cleared === true && victory.save?.end === true, { actual: victory.save });
    assert('4.7 boss bar is not left on screen at victory', victoryDom.bossBarActive === false, { actual: victoryDom.bossBarActive });
    assert('4.8 0 console errors across the boss fight + full run', STATUS.consoleErrors.length === 0, { actual: STATUS.consoleErrors.slice(0, 4) });
  });

  // =========================================================================
  // 5. Nightmare — hpMul 4 scales the wave-5 boss to 8664 HP
  // =========================================================================
  await group('5. nightmare difficulty scales the boss ×4', async () => {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitBoot();
    await installEvents();
    await startCampaign('nightmare');
    await page.evaluate(() => {
      const s = window.__sandstrike;
      s.player.godMode = true;
      s.jumpToWave(5);
      s.fastForward(8.0);
    });
    const nightmare = await bossState();
    const spawnEvents = await readEvents('boss:spawn');
    STATUS.data.wave5Nightmare = { boss: nightmare.boss, hud: nightmare.hud, spawn: spawnEvents.map((event) => event.detail) };
    assert(`5.1 nightmare boss maxHp = 1900 × 1.14 × 4 = ${NIGHTMARE_WAVE5_HP}`, nightmare.boss && nightmare.boss.maxHp === NIGHTMARE_WAVE5_HP && nightmare.boss.hp === NIGHTMARE_WAVE5_HP, { expected: NIGHTMARE_WAVE5_HP, actual: nightmare.boss });
    assert('5.2 nightmare is the active difficulty (hpMul 4 / dmgMul 2)', nightmare.difficulty === 'nightmare' && /NIGHTMARE/.test(nightmare.hud.waveMode), { actual: { difficulty: nightmare.difficulty, hud: nightmare.hud.waveMode } });
    assert('5.3 nightmare boss:spawn carries the scaled maxHp', spawnEvents.length === 1 && spawnEvents[0].detail?.maxHp === NIGHTMARE_WAVE5_HP && spawnEvents[0].detail?.hp === NIGHTMARE_WAVE5_HP, { actual: spawnEvents.map((event) => event.detail) });
    assert('5.4 nightmare boss HUD bar shows 8664 / 8664', nightmare.hud.barActive === true && nightmare.hud.hp === `${NIGHTMARE_WAVE5_HP} / ${NIGHTMARE_WAVE5_HP}`, { actual: nightmare.hud });
    assert('5.5 boss wave still replaces the warlord on nightmare', nightmare.counts.boss === 1 && !nightmare.counts.warlord, { actual: nightmare.counts });
    assert('5.6 nightmare/standard boss HP ratio is exactly 4', nightmare.boss && nightmare.boss.maxHp / STANDARD_WAVE5_HP === 4, { actual: nightmare.boss && nightmare.boss.maxHp });
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
  await writeFile(resolve(OUT, 'boss-probe.json'), JSON.stringify(STATUS, null, 2), 'utf8');
  await browser.close();
  console.log(`\nboss-probe: ${STATUS.ok ? 'PASS' : 'FAIL'} — ${STATUS.summary.assertions} assertions, ${failed.length} failed, ${STATUS.consoleErrors.length} console errors → shots/boss-probe.json`);
  for (const entry of failed.slice(0, 20)) console.log(`  ✗ [${entry.group}] ${entry.name}`, entry.actual !== undefined ? JSON.stringify(entry.actual) : '');
  if (STATUS.consoleErrors.length) console.log(STATUS.consoleErrors.slice(0, 10).join('\n'));
  if (!STATUS.ok) process.exitCode = 1;
}
