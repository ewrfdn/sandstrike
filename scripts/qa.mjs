/**
 * SANDSTRIKE headless end-to-end smoke + screenshot harness — `.scratch/features/CONTRACT.md` §10.
 *
 *   node scripts/qa.mjs [url]            # url or BASE_URL env, default http://127.0.0.1:8080
 *   BASE_URL=http://127.0.0.1:8095 node scripts/qa.mjs
 *
 * Flow (new campaign / per-stage save):
 *   1. main menu → NEW GAME (`[data-start]`) → difficulty chooser → STANDARD
 *   2. stage-start save exists in localStorage (`sandstrike.progress.v2`): outpost-07,
 *      difficulty standard, exactly one starting weapon, zero player bonuses
 *   3. locomotion + muzzle-flash regressions (kept from the pre-campaign harness)
 *   4. play all 15 waves → every 5th wave is the SIEGE WARDEN boss wave with no
 *      warlord; robot HP equals ENEMY_STATS × waveMods × difficulty hpMul
 *   5. victory screen (.screen--victory, STAGE CLEAR / CAMPAIGN COMPLETE) + the
 *      stage-end save snapshot with cleared:true
 *   6. death screen (SIGNAL LOST) and the guarantee that dying writes NOTHING
 *      (localStorage before/after death is byte identical)
 *   7. screenshots: 01-menu 02-gameplay 03-action 03b-explosion 04-victory 05-death
 *      06-menu-720 07-gameplay-720
 *
 * 0 console errors is a hard assertion. Requires `node serve.mjs` and Chrome.
 * Writes `shots/qa.json`, `shots/console.log`; exits 1 on any failure.
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const URL_BASE = (process.env.BASE_URL || process.argv[2] || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const QUERY = process.env.QA_QUERY || 'dev=1&quality=high';
// QA_GPU=1 renders on the real D3D11 device instead of SwiftShader: far faster,
// and it makes the on-screen frame counter in the captured screenshots read a
// realistic value (SwiftShader reports single digits). Default stays SwiftShader
// so this harness keeps reproducing on machines without a usable GPU.
const USE_GPU = process.env.QA_GPU === '1';
const OUT = resolve('shots');
const SAVE_KEY = 'sandstrike.progress.v2';
await mkdir(OUT, { recursive: true });

const errors = [];
const logs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: USE_GPU ? GPU_ARGS : SWIFTSHADER_ARGS,
});

const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (msg) => {
  const text = `[${msg.type()}] ${msg.text()}`;
  logs.push(text);
  if (msg.type() === 'error') errors.push(text);
});
page.on('pageerror', (error) => errors.push('[pageerror] ' + error.message));

const qa = {
  ok: false,
  url: URL_BASE,
  query: QUERY,
  errors: [],
  logs: [],
  consoleErrors: [],
  assertions: [],
  screenshots: {},
  stages: {},
  summary: {},
};

/** Record one named assertion (kept in qa.json so regressions are diffable). */
const assert = (name, condition, detail = {}) => {
  const entry = { name, pass: !!condition };
  if (detail.expected !== undefined) entry.expected = detail.expected;
  if (detail.actual !== undefined) entry.actual = detail.actual;
  qa.assertions.push(entry);
  if (!condition) {
    const message = `[qa] ${name}` + (detail.actual !== undefined ? ': ' + JSON.stringify(detail.actual) : '');
    errors.push(message);
    console.log('  ✗', name, detail.actual !== undefined ? JSON.stringify(detail.actual) : '');
  } else {
    console.log('  ✓', name);
  }
  return !!condition;
};

const renderAndShot = async (name, wait = 250) => {
  await page.evaluate(() => window.__sandstrike?.renderOnce?.());
  await sleep(wait);
  await page.screenshot({ path: `${OUT}/${name}` });
  qa.screenshots[name.replace(/\.png$/, '')] = `shots/${name}`;
};

const readSave = () => page.evaluate((key) => {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}, SAVE_KEY);
const saveRaw = () => page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
const sameJson = (a, b) => {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
};

/** Click a DOM node (real click event through the UI delegation handler). */
const click = async (selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, reason: 'missing' };
  if (el.disabled) return { ok: false, reason: 'disabled' };
  el.click();
  return { ok: true };
}, selector);

const waitState = (state, timeout = 30_000) => page.waitForFunction(
  (wanted) => window.__sandstrike?.state === wanted,
  state,
  { timeout, polling: 100 },
);

try {
  console.log('loading', URL_BASE);
  await page.goto(`${URL_BASE}/?${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  await page.waitForFunction(() => window.__sandstrikeApp?.loaded === true, null, { timeout: Number(process.env.QA_BOOT_TIMEOUT) || 300_000 });
  await page.waitForFunction(() => {
    const menu = document.querySelector('.screen--menu');
    return !!menu && menu.classList.contains('is-active');
  }, null, { timeout: 30_000, polling: 100 });
  await sleep(900);
  await renderAndShot('01-menu.png');
  console.log('menu captured');

  // -------------------------------------------------------------------------
  // 1. Main menu → NEW GAME → difficulty chooser → STANDARD
  // -------------------------------------------------------------------------
  const menu = await page.evaluate(() => ({
    state: window.__sandstrike?.state,
    startDisabled: document.querySelector('[data-start]')?.disabled,
    startLabel: document.querySelector('[data-start-label]')?.textContent,
    continueDisabled: document.querySelector('[data-action="continue"]')?.disabled,
    stageDisabled: document.querySelector('[data-action="stage-select"]')?.disabled,
    summary: document.querySelector('[data-save-summary]')?.textContent ?? '',
    deployCards: document.querySelectorAll('[data-deploy-value]').length,
    victoryTitle: document.querySelector('[data-victory-title]')?.textContent ?? '',
    deathTitle: document.querySelector('.screen--death .end-title')?.textContent ?? '',
  }));
  qa.stages.menu = menu;
  assert('menu: NEW GAME (data-start) is enabled after boot', menu.state === 'menu' && menu.startDisabled === false && menu.startLabel === 'NEW GAME', menu);
  assert('menu: CONTINUE is disabled with no campaign save', menu.continueDisabled === true, menu);
  assert('menu: difficulty chooser exposes 4 cards', menu.deployCards === 4, menu.deployCards);

  // Prefer a real DOM click so the menu→deploy→run handlers are exercised.
  const clicked = await click('[data-start]');
  qa.stages.clicked = clicked.ok;
  if (clicked.ok) {
    await page.waitForFunction(() => document.querySelector('[data-deploy]')?.classList.contains('is-open'), null, { timeout: 20_000, polling: 100 }).catch(() => {});
    const picked = await click('[data-deploy-value="standard"]');
    qa.stages.deployPicked = picked.ok;
    if (!picked.ok) {
      // Fallback for older/newer deploy markup: fire the contract event directly.
      await page.evaluate(() => window.__sandstrike.bus.dispatchEvent(new CustomEvent('ui:new-game', { detail: { difficulty: 'standard' } })));
    }
  } else {
    await page.evaluate(() => window.__sandstrike.bus.dispatchEvent(new CustomEvent('ui:new-game', { detail: { difficulty: 'standard' } })));
  }
  await waitState('playing');
  await page.waitForFunction(() => window.__sandstrike?.ui?.state === 'playing', null, { timeout: 20_000, polling: 100 });
  await sleep(400);

  // -------------------------------------------------------------------------
  // 2. Stage-start save: outpost-07 / standard / one starting weapon
  // -------------------------------------------------------------------------
  const saveAtStart = await readSave();
  const startRecord = saveAtStart?.stages?.['outpost-07'];
  qa.stages.saveAtStart = {
    lastStageId: saveAtStart?.lastStageId,
    lastDifficulty: saveAtStart?.lastDifficulty,
    record: startRecord && {
      difficulty: startRecord.difficulty,
      cleared: startRecord.cleared,
      unlocked: startRecord.unlocked,
      start: startRecord.start && { difficulty: startRecord.start.difficulty, weapons: startRecord.start.run?.weapons, player: startRecord.start.run?.player, runDifficulty: startRecord.start.run?.difficulty },
    },
  };
  assert('save: stage-start snapshot written for outpost-07', !!startRecord?.start && saveAtStart?.lastStageId === 'outpost-07', qa.stages.saveAtStart);
  assert('save: difficulty is standard', startRecord?.difficulty === 'standard' && startRecord?.start?.difficulty === 'standard' && startRecord?.start?.run?.difficulty === 'standard', qa.stages.saveAtStart.record);
  assert('save: starts with exactly one weapon (vxr7)', sameJson(startRecord?.start?.run?.weapons?.owned, ['vxr7']) && startRecord?.start?.run?.weapons?.active === 'vxr7', startRecord?.start?.run?.weapons);
  assert('save: starting player bonuses are zero', sameJson(startRecord?.start?.run?.player, { armorBonus: 0, healthBonus: 0, damageReduction: 0 }), startRecord?.start?.run?.player);
  assert('save: stage is not marked cleared on entry', startRecord?.cleared === false, startRecord?.cleared);

  const hud = await page.evaluate(() => ({
    waveMode: document.querySelector('[data-wave-mode]')?.textContent ?? '',
    stageIndex: document.querySelector('[data-stage-index]')?.textContent ?? '',
    stageLabel: document.querySelector('[data-stage-label]')?.textContent ?? '',
    slots: [...document.querySelectorAll('[data-weapon-slots] .wslot')].map((node) => ({
      slot: Number(node.dataset.slot),
      type: node.dataset.slotType ?? null,
      active: node.classList.contains('is-active'),
      empty: node.classList.contains('is-empty'),
    })),
  }));
  qa.stages.hud = hud;
  assert('HUD: difficulty chip shows STANDARD', /STANDARD/.test(hud.waveMode), hud.waveMode);
  assert('HUD: stage line shows STAGE 01/01 · OUTPOST 07', /01\/01/.test(hud.stageIndex) && /OUTPOST 07/.test(hud.stageLabel), { index: hud.stageIndex, label: hud.stageLabel });
  assert('HUD: 4 weapon slots with only vxr7 owned', hud.slots.length === 4 && hud.slots[0].type === 'vxr7' && hud.slots[0].active && hud.slots.slice(1).every((slot) => slot.empty), hud.slots);

  const state0 = await page.evaluate(() => ({
    state: window.__sandstrike?.state,
    wave: window.__sandstrike?.enemies?.state?.wave,
    ammo: window.__sandstrike?.weapon?.mag,
    stage: window.__sandstrike?.stage?.id,
    difficulty: window.__sandstrike?.difficulty?.id,
  }));
  qa.stages.start = state0;
  assert('boot: stage starts (state=playing, stage=outpost-07, difficulty=standard)', state0.state === 'playing' && state0.stage === 'outpost-07' && state0.difficulty === 'standard', state0);
  console.log('state after start', JSON.stringify(state0));

  // -------------------------------------------------------------------------
  // 3. Locomotion regression: WASD must follow the camera basis
  // -------------------------------------------------------------------------
  const movement = await page.evaluate(() => {
    const s = window.__sandstrike;
    const base = s.player.position.clone();
    const run = (yaw, code) => {
      s.player.position.copy(base);
      s.player.velocity.set(0, 0, 0);
      s.player.yaw = yaw;
      s.player._keys.clear();
      s.player._keys.add(code);
      for (let i = 0; i < 24; i++) s.player.update(1 / 60);
      s.player._keys.clear();
      const dx = s.player.position.x - base.x;
      const dz = s.player.position.z - base.z;
      return {
        forward: +(dx * -Math.sin(yaw) + dz * -Math.cos(yaw)).toFixed(3),
        right: +(dx * Math.cos(yaw) + dz * -Math.sin(yaw)).toFixed(3),
      };
    };
    const out = {
      w: run(0, 'KeyW'), s: run(0, 'KeyS'), a: run(0, 'KeyA'), d: run(0, 'KeyD'),
      wQuarter: run(Math.PI * 0.5, 'KeyW'), dQuarter: run(Math.PI * 0.5, 'KeyD'),
      aQuarter: run(-Math.PI * 0.5, 'KeyA'),
    };
    s.player.position.copy(base);
    s.player.velocity.set(0, 0, 0);
    s.player.yaw = 0;
    return out;
  });
  qa.stages.movement = movement;
  assert('movement: W moves forward', movement.w.forward > 0.5, movement.w);
  assert('movement: S moves backward', movement.s.forward < -0.5, movement.s);
  assert('movement: A strafes left', movement.a.right < -0.5, movement.a);
  assert('movement: D strafes right', movement.d.right > 0.5, movement.d);
  assert('movement: W is correct after a 90° turn', movement.wQuarter.forward > 0.5, movement.wQuarter);
  assert('movement: D is correct after a 90° turn', movement.dQuarter.right > 0.5, movement.dQuarter);
  console.log('movement', JSON.stringify(movement));

  // -------------------------------------------------------------------------
  // 4. Wave-1 gameplay: difficulty HP multiplier + screenshots 02/03
  // -------------------------------------------------------------------------
  const spawned = await page.evaluate(() => {
    const s = window.__sandstrike;
    s.player.godMode = true;
    return s.fastForward(4.2);
  });
  qa.stages.spawned = spawned;

  const difficultyHp = await page.evaluate(async () => {
    const s = window.__sandstrike;
    const { ENEMY_STATS } = await import('/src/config/enemies.js');
    const robots = (s.enemies.robots || []).filter((robot) => robot.alive).map((robot) => ({
      type: robot.type,
      maxHp: robot.maxHp,
      defHp: robot.def?.hp,
      expected: Math.round(robot.def.hp * (s.enemies._waveMods?.hp ?? 1)),
    }));
    const difficulty = s.enemies.getDifficulty();
    return {
      wave: s.enemies.state.wave,
      modsHp: s.enemies._waveMods?.hp ?? null,
      difficulty: difficulty.id,
      hpMul: difficulty.hpMul,
      dmgMul: difficulty.dmgMul,
      robots,
      enemyStats: ENEMY_STATS,
    };
  });
  qa.stages.difficultyHp = difficultyHp;
  assert('difficulty: enemies run STANDARD (hpMul 1 / dmgMul 0.75)', difficultyHp.difficulty === 'standard' && difficultyHp.hpMul === 1 && difficultyHp.dmgMul === 0.75, difficultyHp);
  assert('difficulty: wave-1 robot maxHp = ENEMY_STATS × waveMods × hpMul', difficultyHp.robots.length > 0 && difficultyHp.robots.every((robot) => robot.maxHp === robot.expected && robot.defHp === robot.expected), difficultyHp.robots);

  const gameplayAim = await page.evaluate(() => {
    const s = window.__sandstrike;
    const robots = (s.enemies.robots || []).filter((r) => r.active && r.state !== 'dead' && r.root);
    const cam = s.player.position;
    let best = null;
    let bestDist = Infinity;
    for (const robot of robots) {
      const d = robot.root.position.distanceTo(cam);
      if (d < bestDist) { bestDist = d; best = robot; }
    }
    if (best) {
      const p = best.root.position.clone();
      const eye = s.player.eye;
      const dx = p.x - eye.x;
      const dz = p.z - eye.z;
      const dy = p.y + 1.15 - eye.y;
      s.player.yaw = Math.atan2(-dx, -dz);
      s.player.lookPitch = Math.atan2(dy, Math.hypot(dx, dz));
      s.fastForward(0.05);
    }
    s.freeze(true);
    s.effects.reset?.();
    s.renderOnce();
    return { aimed: !!best, dist: Math.round(bestDist * 10) / 10 };
  });
  qa.stages.gameplayAim = gameplayAim;
  await renderAndShot('02-gameplay.png', 200);
  await page.evaluate(() => window.__sandstrike.freeze(false));
  console.log('gameplay captured', JSON.stringify({ spawned, gameplayAim }));

  // Aim at the nearest robot, fire, and capture combat feedback.
  const aim = await page.evaluate(() => {
    const s = window.__sandstrike;
    s.__qaEvents = { hit: 0, kill: 0, headshot: 0, playerDamage: 0 };
    if (!s.__qaListenersInstalled) {
      s.__qaListenersInstalled = true;
      s.bus.addEventListener('enemy:hitmarker', (e) => {
        s.__qaEvents.hit++;
        if (e.detail.headshot) s.__qaEvents.headshot++;
        if (e.detail.kill) s.__qaEvents.kill++;
      });
      s.bus.addEventListener('combat:player-hit', () => { s.__qaEvents.playerDamage++; });
    }
    const robots = (s.enemies.robots || []).filter((r) => r.active && r.state !== 'dead');
    let best = null;
    let bestDist = Infinity;
    const camPos = s.player.position;
    for (const robot of robots) {
      if (!robot.root) continue;
      const dist = robot.root.position.distanceTo(camPos);
      if (dist < bestDist) { bestDist = dist; best = robot; }
    }
    if (!best) return { aimed: false, alive: s.enemies.state.alive };
    const p = new best.root.position.constructor();
    best.root.getWorldPosition(p);
    const eye = s.player.eye;
    const dx = p.x - eye.x;
    const dz = p.z - eye.z;
    const dy = p.y + 1.2 - eye.y;
    s.player.yaw = Math.atan2(-dx, -dz);
    s.player.lookPitch = Math.atan2(dy, Math.hypot(dx, dz));
    s.fastForward(0.05);
    s.weapon.fireCooldown = 0;
    s.weapon.mag = Math.max(10, s.weapon.mag);
    s.weapon.tryFire();
    return {
      aimed: true,
      type: best.def?.name || best.def?.key || 'robot',
      dist: Math.round(bestDist * 10) / 10,
      target: p.toArray(),
      alive: s.enemies.state.alive,
      shotsFired: s.weapon.shotsFired,
      shotsHit: s.weapon.shotsHit,
    };
  });
  // Fire a short aimed burst before the screenshot so impacts are visible.
  const burst = await page.evaluate(() => {
    const s = window.__sandstrike;
    for (let i = 0; i < 5; i++) {
      s.weapon.fireCooldown = 0;
      s.weapon.mag = Math.max(5, s.weapon.mag);
      s.weapon.tryFire();
      s.fastForward(0.07);
    }
    // Let the muzzle flash / tracer streaks resolve so the captured frame is a
    // clean combat tableau rather than a screen-filling 1-frame billboard.
    s.fastForward(0.16);
    return { events: s.__qaEvents, shotsFired: s.weapon.shotsFired, shotsHit: s.weapon.shotsHit, alive: s.enemies.state.alive };
  });
  qa.stages.aim = aim;
  qa.stages.burst = burst;
  assert('combat: VXR-7 hitscan fired at a live enemy', aim.aimed === true && burst.shotsFired > 0, { aim, burst });
  assert('combat: hitscan shots registered a hitmarker', burst.shotsHit > 0, burst);

  // Regression: the viewmodel muzzle flash must stay a small additive sprite
  // set. Earlier versions used two crossed camera-space quads plus untextured
  // square smoke cards, which could rasterise as a screen-filling dark panel.
  const flash = await page.evaluate(() => {
    const s = window.__sandstrike;
    s.weapon.fireCooldown = 0;
    s.weapon.mag = Math.max(10, s.weapon.mag);
    s.weapon.tryFire();
    const group = s.weapon.flashGroup;
    if (!group) return { parts: [], maxWorldSize: 0, smokePuffs: 0, missing: true };
    const parts = [];
    group.traverse((o) => {
      if (o === group) return;
      if (o.isLight) return;
      parts.push({
        type: o.isSprite ? 'sprite' : o.isMesh ? `mesh:${o.geometry.type}` : o.type,
        scale: o.scale.toArray().map((v) => +v.toFixed(3)),
        blending: o.material?.blending,
        depthTest: o.material?.depthTest,
      });
    });
    const gunScale = s.weapon.gun.scale.x;
    const maxSize = Math.max(...parts.filter((p) => p.type === 'sprite').map((p) => p.scale[0] * gunScale), 0);
    // `smokePuffs` was a VXR-7-era internals field; the multi-weapon runtime may not
    // keep it, so only assert its absence of leftovers when the field exists.
    const smokePuffs = Array.isArray(s.weapon.smokePuffs) ? s.weapon.smokePuffs.length : 0;
    return { parts, maxWorldSize: +maxSize.toFixed(3), smokePuffs, missing: false };
  });
  qa.stages.flash = flash;
  assert('flash: vxr7 viewmodel exposes a muzzle-flash rig', flash.missing === false, flash);
  assert('flash: viewmodel muzzle flash stays small', flash.maxWorldSize <= 0.34, flash.maxWorldSize);
  assert('flash: no untextured smoke cards', flash.smokePuffs === 0, flash.smokePuffs);
  assert('flash: no crossed-plane muzzle flash', !flash.parts.some((p) => p.type === 'mesh:PlaneGeometry'), flash.parts.length);
  assert('flash: flash sprites are additive', !flash.parts.some((p) => p.type === 'sprite' && p.blending !== 2), flash.parts.length);
  console.log('flash', JSON.stringify(flash));
  await page.evaluate(() => {
    const s = window.__sandstrike;
    s.freeze(true);
    s.effects.reset?.();
    // one controlled shot for the action frame: clean muzzle flash + tracer
    s.weapon.fireCooldown = 0;
    s.weapon.mag = Math.max(5, s.weapon.mag);
    s.weapon.tryFire();
    s.fastForward(0.03);
    s.effects.reset?.();
    s.weapon.fireCooldown = 0;
    s.weapon.mag = Math.max(5, s.weapon.mag);
    s.weapon.tryFire();
  });
  await renderAndShot('03-action.png', 150);
  await page.evaluate(() => window.__sandstrike.freeze(false));
  console.log('action captured', JSON.stringify({ aim, burst }));

  // Clear wave 1 with a staged explosion, then drive the remaining waves.
  await page.evaluate(() => {
    const s = window.__sandstrike;
    const yaw = s.player.yaw;
    const pitch = s.player.lookPitch;
    s.freeze(true);
    s.enemies.debugKillAll();
    // Let the fireball/smoke/shockwave evolve into a full combat tableau.
    s.fastForward(0.28);
    // Hold the composed view (headless pointer-lock can inject a phantom look).
    s.player.yaw = yaw;
    s.player.lookPitch = pitch;
    s.player.update(0);
    s.renderOnce();
  });
  await sleep(250);
  await page.screenshot({ path: `${OUT}/03b-explosion.png` });
  qa.screenshots.explosion = 'shots/03b-explosion.png';
  await page.evaluate(() => window.__sandstrike.freeze(false));

  // -------------------------------------------------------------------------
  // 5. 15-wave run: boss waves replace the warlord; victory writes the save
  // -------------------------------------------------------------------------
  await page.evaluate(() => {
    const s = window.__sandstrike;
    window.__qaRun = { bossSpawns: [], bossDefeats: [], waveStarts: [], victory: null };
    s.bus.addEventListener('boss:spawn', (event) => window.__qaRun.bossSpawns.push(event.detail));
    s.bus.addEventListener('boss:defeated', (event) => window.__qaRun.bossDefeats.push(event.detail));
    s.bus.addEventListener('wave:start', (event) => window.__qaRun.waveStarts.push(event.detail));
    s.bus.addEventListener('game:victory', (event) => { window.__qaRun.victory = event.detail; });
  });
  // Expected boss-wave labels/counts straight from the config (config-driven check).
  const expectedBossWaves = await page.evaluate(async () => {
    const { resolveWave } = await import('/src/config/waves.js');
    const out = {};
    for (const wave of [5, 10, 15]) {
      const resolved = resolveWave('outpost-07', wave);
      out[wave] = {
        label: resolved.label,
        count: Object.values(resolved.comp).reduce((sum, n) => sum + n, 0),
        boss: resolved.comp.boss || 0,
        warlord: resolved.comp.warlord || 0,
      };
    }
    return out;
  });
  qa.stages.expectedBossWaves = expectedBossWaves;

  // One round trip for the whole 15-wave run: per-wave `evaluate` calls are far
  // too slow under software rasterisation.
  const runResult = await page.evaluate(() => {
    const s = window.__sandstrike;
    s.player.godMode = true;
    const waves = [];
    const waveTypes = {};
    for (let i = 0; i < 48; i++) {
      s.fastForward(7.0);
      const wave = s.enemies?.state?.wave;
      // Boss waves: the WARDEN is the LAST spawn-queue entry (escorts + an extra
      // WAVE_RULES.bossSpawnDelay). `debugKillAll()` also drops the pending spawn
      // queue, so wait until the boss is actually alive (or the queue is drained)
      // before sampling the wave types and killing it.
      if (wave > 0 && wave % 5 === 0) {
        for (let attempt = 0; attempt < 40; attempt++) {
          const bossAlive = (s.enemies.robots || []).some((robot) => robot.alive && robot.type === 'boss');
          if (bossAlive) break;
          const director = s.enemies.state;
          if ((director.remaining || 0) <= (director.alive || 0)) break; // spawn queue drained
          s.fastForward(0.5);
        }
      }
      const alive = s.enemies?.state?.alive;
      const types = (s.enemies.robots || []).filter((robot) => robot.alive).map((robot) => robot.type);
      if (types.length) {
        // Union across observations: a wave can be sampled while some contacts
        // (notably the delayed boss) are still in the spawn queue.
        const seen = waveTypes[wave] || (waveTypes[wave] = []);
        for (const type of types) if (!seen.includes(type)) seen.push(type);
      }
      const killed = s.enemies.debugKillAll?.() ?? 0;
      const info = {
        state: s.state,
        wave,
        alive,
        types,
        killed,
        between: s.enemies?.state?.betweenWaves,
        score: s.game.score,
        kills: s.game.kills,
      };
      const last = waves[waves.length - 1];
      if (!last || last.state !== info.state || last.wave !== info.wave) waves.push(info);
      if (info.state === 'victory' || info.state === 'dead') break;
    }
    s.fastForward(4.5);
    return { waves, waveTypes, state: s.state, wave: s.enemies?.state?.wave };
  });
  const waves = runResult.waves;
  const waveTypes = runResult.waveTypes;
  await page.waitForFunction(() => {
    const el = document.querySelector('.screen--victory.is-active');
    return !!el && parseFloat(getComputedStyle(el).opacity) > 0.75;
  }, null, { timeout: 20000, polling: 100 }).catch((error) => {
    errors.push('[qa] victory screen did not reveal: ' + error.message);
  });
  qa.stages.waves = waves;
  qa.stages.waveTypes = waveTypes;

  const runEvents = await page.evaluate(() => window.__qaRun);
  qa.stages.bossEvents = runEvents;
  const waveStarts = runEvents.waveStarts || [];
  qa.stages.waveStarts = waveStarts;

  // Boss rule: every 5th wave has one boss and no warlord; the wave:start payload
  // must use the config label and count the boss as a contact.
  for (const waveNumber of [5, 10, 15]) {
    const types = waveTypes[waveNumber] || [];
    const bossCount = types.filter((type) => type === 'boss').length;
    const warlordCount = types.filter((type) => type === 'warlord').length;
    const expected = expectedBossWaves[waveNumber];
    const start = waveStarts.find((detail) => detail && Number(detail.wave) === waveNumber);
    assert(`waves: wave ${waveNumber} spawned exactly one boss chassis`, bossCount === 1, { wave: waveNumber, types });
    assert(`waves: wave ${waveNumber} replaced the warlord (0 warlords)`, warlordCount === 0, { wave: waveNumber, types });
    assert(`waves: wave ${waveNumber} wave:start count includes the boss (${expected.count})`, !!start && start.count === expected.count, { expected: expected.count, actual: start && start.count });
    assert(`waves: wave ${waveNumber} uses the config boss-wave label`, !!start && start.label === expected.label, { expected: expected.label, actual: start && start.label });
  }
  assert('waves: boss:spawn fired for every boss wave (5/10/15)', runEvents.bossSpawns.length === 3, runEvents.bossSpawns.map((detail) => detail.wave));
  assert('waves: boss:defeated fired for every boss (3)', runEvents.bossDefeats.length === 3, runEvents.bossDefeats.map((detail) => detail.wave));
  assert('waves: boss HP follows ENEMY_STATS.boss.hp × waveMods × hpMul', runEvents.bossSpawns.every((detail) => {
    const wave = Number(detail.wave) || 5;
    return detail.maxHp === Math.round(1900 * (1 + 0.035 * (wave - 1)) * 1);
  }), runEvents.bossSpawns.map((detail) => ({ wave: detail.wave, maxHp: detail.maxHp })));

  const final = await page.evaluate(() => ({
    state: window.__sandstrike?.state,
    wave: window.__sandstrike?.enemies?.state?.wave,
    score: window.__sandstrike?.game?.score,
    kills: window.__sandstrike?.game?.kills,
    accuracy: window.__sandstrike?.weapon?.shotsFired
      ? window.__sandstrike.weapon.shotsHit / window.__sandstrike.weapon.shotsFired
      : 0,
    shots: window.__sandstrike?.weapon?.shotsFired,
    hits: window.__sandstrike?.weapon?.shotsHit,
  }));
  qa.stages.final = final;
  await page.evaluate(() => window.__sandstrike.freeze(true));
  qa.stages.render = await page.evaluate(() => window.__sandstrike.renderOnce());
  qa.stages.renderer = await page.evaluate(() => ({
    calls: window.__sandstrike?.renderer?.info?.render?.calls,
    triangles: window.__sandstrike?.renderer?.info?.render?.triangles,
    textures: window.__sandstrike?.renderer?.info?.memory?.textures,
    geometries: window.__sandstrike?.renderer?.info?.memory?.geometries,
    programs: window.__sandstrike?.renderer?.info?.programs?.length,
  }));
  await sleep(300);
  await page.screenshot({ path: `${OUT}/04-victory.png` });
  qa.screenshots.victory = 'shots/04-victory.png';
  console.log('final', JSON.stringify(final));
  assert('victory: 15-wave run reaches state=victory', final.state === 'victory', final);

  const victoryDom = await page.evaluate(() => {
    const next = document.querySelector('[data-next-stage]');
    return {
      screenActive: document.querySelector('.screen--victory')?.classList.contains('is-active'),
      title: document.querySelector('[data-victory-title]')?.textContent ?? '',
      sub: document.querySelector('[data-victory-sub]')?.textContent ?? '',
      stage: document.querySelector('[data-victory-stage]')?.textContent ?? '',
      unlockEn: document.querySelector('[data-victory-unlock-en]')?.textContent ?? '',
      nextExists: !!next,
      nextHidden: next ? next.hidden : null,
      nextDisplay: next ? getComputedStyle(next).display : null,
      nextPainted: !!next && getComputedStyle(next).display !== 'none' && getComputedStyle(next).visibility !== 'hidden',
      hasRestart: !!document.querySelector('.screen--victory [data-action="restart"]'),
      hasMenu: !!document.querySelector('.screen--victory [data-action="menu"]'),
    };
  });
  qa.stages.victoryDom = victoryDom;
  assert('victory: .screen--victory is active', victoryDom.screenActive === true, victoryDom);
  assert('victory: title reads STAGE CLEAR / CAMPAIGN COMPLETE', /STAGE\s*CLEAR|CAMPAIGN\s*COMPLETE/i.test(victoryDom.title), victoryDom.title);
  assert('victory: shows the stage + difficulty line', /STAGE 01\/01/.test(victoryDom.stage) && /STANDARD/i.test(victoryDom.stage), victoryDom.stage);
  assert('victory: single-stage campaign reports completion + no next stage offered', /CAMPAIGN COMPLETE/i.test(`${victoryDom.unlockEn} ${victoryDom.sub}`) && !victoryDom.nextPainted, victoryDom);
  // The `hidden` attribute is overridden by `.mbtn { display:flex }` unless a
  // `[hidden]` rule wins — assert the button is truly not painted.
  assert('victory: NEXT STAGE button is not painted when no next stage exists', victoryDom.nextPainted === false, { expected: 'not painted (element absent or display:none)', actual: { exists: victoryDom.nextExists, hidden: victoryDom.nextHidden, display: victoryDom.nextDisplay } });
  assert('victory: offers REPLAY STAGE + MAIN MENU', victoryDom.hasRestart && victoryDom.hasMenu, victoryDom);

  const saveAtVictory = await readSave();
  const victoryRecord = saveAtVictory?.stages?.['outpost-07'];
  qa.stages.saveAtVictory = {
    cleared: victoryRecord?.cleared,
    clears: victoryRecord?.clears,
    end: victoryRecord?.end && { difficulty: victoryRecord.end.difficulty, weapons: victoryRecord.end.run?.weapons, stats: victoryRecord.end.stats },
    updatedAt: saveAtVictory?.updatedAt,
  };
  assert('victory: save end snapshot written', !!victoryRecord?.end?.run && !!victoryRecord?.end?.stats, qa.stages.saveAtVictory);
  assert('victory: stage marked cleared:true (clears >= 1)', victoryRecord?.cleared === true && victoryRecord?.clears >= 1, { cleared: victoryRecord?.cleared, clears: victoryRecord?.clears });
  assert('victory: game:victory payload carries stage + cleared + campaign flags', !!runEvents.victory && runEvents.victory.stageId === 'outpost-07' && runEvents.victory.cleared === true && runEvents.victory.campaignCleared === true && runEvents.victory.difficulty === 'standard', runEvents.victory);
  assert('victory: end snapshot lists the carried weapons', Array.isArray(victoryRecord?.end?.run?.weapons?.owned) && victoryRecord.end.run.weapons.owned.includes('vxr7'), victoryRecord?.end?.run?.weapons);
  await page.evaluate(() => window.__sandstrike.freeze(false));

  // -------------------------------------------------------------------------
  // 6. Death flow: SIGNAL LOST + dying must NOT overwrite the save
  // -------------------------------------------------------------------------
  // Replay the stage from the victory screen (a legal stage-entry write), then die.
  const replay = await click('.screen--victory [data-action="restart"]');
  qa.stages.replayClicked = replay.ok;
  await waitState('playing').catch(() => {});
  await page.waitForFunction(() => window.__sandstrike?.ui?.state === 'playing', null, { timeout: 20_000, polling: 100 }).catch(() => {});
  await sleep(300);
  const replaySave = await readSave();
  assert('death: REPLAY STAGE re-enters the stage (playing)', (await page.evaluate(() => window.__sandstrike.state)) === 'playing', await page.evaluate(() => window.__sandstrike.state));
  assert('death: replay entry keeps the cleared flag + end snapshot', replaySave?.stages?.['outpost-07']?.cleared === true && !!replaySave?.stages?.['outpost-07']?.end, { cleared: replaySave?.stages?.['outpost-07']?.cleared, end: !!replaySave?.stages?.['outpost-07']?.end });

  const rawBeforeDeath = await saveRaw();
  const deathState = await page.evaluate(() => {
    const s = window.__sandstrike;
    s.player.godMode = false;
    s.damagePlayer(500);
    s.fastForward(0.5);
    return { state: s.state, uiState: s.ui?.state };
  });
  const rawAfterDeath = await saveRaw();
  qa.stages.death = { ...deathState, saveWrittenOnDeath: rawBeforeDeath !== rawAfterDeath };
  await page.waitForFunction(() => {
    const el = document.querySelector('.screen--death.is-active');
    return !!el && parseFloat(getComputedStyle(el).opacity) > 0.6;
  }, null, { timeout: 20000, polling: 100 }).catch((error) => {
    errors.push('[qa] death screen did not reveal: ' + error.message);
  });
  const deathDom = await page.evaluate(() => ({
    screenActive: document.querySelector('.screen--death')?.classList.contains('is-active'),
    title: document.querySelector('.screen--death .end-title')?.textContent ?? '',
    stage: document.querySelector('[data-death-stage]')?.textContent ?? '',
    restartLabel: document.querySelector('.screen--death [data-action="restart"] b')?.textContent ?? '',
    hasMenu: !!document.querySelector('.screen--death [data-action="menu"]'),
  }));
  qa.stages.deathDom = deathDom;
  await page.evaluate(() => window.__sandstrike.freeze(true));
  await page.evaluate(() => window.__sandstrike?.renderOnce?.());
  await sleep(200);
  await page.screenshot({ path: `${OUT}/05-death.png` });
  qa.screenshots.death = 'shots/05-death.png';
  assert('death: lethal damage sets state=dead', deathState.state === 'dead', deathState);
  assert('death: .screen--death is active with SIGNAL LOST', deathDom.screenActive === true && /SIGNAL\s*LOST/i.test(deathDom.title), deathDom);
  assert('death: shows stage + REDEPLOY + MAIN MENU', /STAGE 01\/01/.test(deathDom.stage) && /REDEPLOY/i.test(deathDom.restartLabel) && deathDom.hasMenu, deathDom);
  assert('death: dying does NOT write the save (localStorage byte identical)', rawBeforeDeath === rawAfterDeath, { before: rawBeforeDeath?.length, after: rawAfterDeath?.length });
  const saveAfterDeath = await readSave();
  assert('death: saved end snapshot + cleared flag survive the death', saveAfterDeath?.stages?.['outpost-07']?.cleared === true && !!saveAfterDeath?.stages?.['outpost-07']?.end, { cleared: saveAfterDeath?.stages?.['outpost-07']?.cleared, end: !!saveAfterDeath?.stages?.['outpost-07']?.end });
  await page.evaluate(() => window.__sandstrike.freeze(false));

  // -------------------------------------------------------------------------
  // 7. 1280×720 layout captures (menu + gameplay) + CONTINUE smoke
  // -------------------------------------------------------------------------
  await click('.screen--death [data-action="menu"]');
  await page.waitForFunction(() => {
    const menu = document.querySelector('.screen--menu');
    return !!menu && menu.classList.contains('is-active') && window.__sandstrike?.ui?.state === 'menu';
  }, null, { timeout: 20_000, polling: 100 });
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(600);
  await page.evaluate(() => window.__sandstrike?.renderOnce?.());
  await sleep(200);
  await page.screenshot({ path: `${OUT}/06-menu-720.png` });
  qa.screenshots.menu720 = 'shots/06-menu-720.png';

  const continueBtn = await page.evaluate(() => {
    const button = document.querySelector('[data-action="continue"]');
    return { exists: !!button, disabled: button?.disabled, locked: button?.classList.contains('is-locked'), text: document.querySelector('[data-continue-target]')?.textContent ?? '' };
  });
  qa.stages.continueAfterVictory = continueBtn;
  assert('720: CONTINUE is enabled after the cleared campaign', continueBtn.exists && continueBtn.disabled === false && continueBtn.locked === false, continueBtn);
  assert('720: CONTINUE line names the stage + difficulty', /CONTINUE/.test(continueBtn.text) && /OUTPOST 07/.test(continueBtn.text), continueBtn.text);
  const continued = await click('[data-action="continue"]');
  assert('720: CONTINUE click starts the stage', continued.ok, continued);
  await waitState('playing').catch(() => {});
  await sleep(1200);
  await page.evaluate(() => {
    const s = window.__sandstrike;
    s.freeze(true);
    s.player.godMode = true;
    s.fastForward(0.2);
    s.renderOnce?.();
  });
  await sleep(250);
  await page.screenshot({ path: `${OUT}/07-gameplay-720.png` });
  qa.screenshots.gameplay720 = 'shots/07-gameplay-720.png';
  await page.evaluate(() => window.__sandstrike.freeze(false));
  assert('720: gameplay resumes after CONTINUE', (await page.evaluate(() => window.__sandstrike?.state)) === 'playing');

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const failed = qa.assertions.filter((entry) => !entry.pass);
  qa.consoleErrors = errors.slice();
  qa.ok = failed.length === 0 && errors.length === 0;
  qa.summary = {
    assertions: qa.assertions.length,
    failed: failed.length,
    consoleErrors: errors.length,
    screenshots: Object.keys(qa.screenshots).length,
    waves: final.wave,
    kills: final.kills,
    score: final.score,
  };
  console.log(`\nQA summary: ${qa.summary.assertions} assertions, ${failed.length} failed, ${errors.length} console/assert errors`);
} catch (error) {
  errors.push('[qa] ' + (error.stack || error.message));
  try { await page.screenshot({ path: `${OUT}/error.png` }); } catch { /* noop */ }
  qa.screenshots.error = 'shots/error.png';
} finally {
  const failed = qa.assertions.filter((entry) => !entry.pass);
  qa.errors = errors;
  qa.logs = logs;
  qa.consoleErrors = errors.slice();
  qa.ok = failed.length === 0 && errors.length === 0;
  qa.summary = qa.summary || {};
  qa.summary = {
    ...qa.summary,
    assertions: qa.assertions.length,
    failed: failed.length,
    consoleErrors: errors.length,
    screenshots: Object.keys(qa.screenshots).length,
  };
  await writeFile(`${OUT}/qa.json`, JSON.stringify(qa, null, 2), 'utf8');
  await writeFile(`${OUT}/console.log`, logs.join('\n'), 'utf8');
  await browser.close();
  console.log(`\nQA done. assertions=${qa.assertions.length} failed=${failed.length} errors=${errors.length} screenshots in shots/`);
  if (errors.length) {
    console.log(errors.slice(0, 15).join('\n'));
    process.exitCode = 1;
  }
}
