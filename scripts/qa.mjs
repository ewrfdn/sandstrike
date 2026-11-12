/**
 * Headless smoke + screenshot harness for SANDSTRIKE.
 * Usage: node scripts/qa.mjs [url]
 * Requires local server (node serve.mjs) and a Chrome/Chromium install.
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:8080';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const QUERY = process.env.QA_QUERY || 'dev=1&quality=high';
// QA_GPU=1 renders on the real D3D11 device instead of SwiftShader: far faster,
// and it makes the on-screen frame counter in the captured screenshots read a
// realistic value (SwiftShader reports single digits). Default stays SwiftShader
// so this harness keeps reproducing on machines without a usable GPU.
const USE_GPU = process.env.QA_GPU === '1';
const OUT = resolve('shots');
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

const qa = { errors: [], logs: [], screenshots: {}, stages: {} };
const renderAndShot = async (name, wait = 250) => {
  await page.evaluate(() => window.__sandstrike?.renderOnce?.());
  await sleep(wait);
  await page.screenshot({ path: `${OUT}/${name}` });
  qa.screenshots[name.replace(/\.png$/, '')] = `shots/${name}`;
};

try {
  console.log('loading', URL_BASE);
  await page.goto(`${URL_BASE}/?${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  await page.waitForFunction(() => window.__sandstrikeApp?.loaded === true, null, { timeout: 180_000 });
  await sleep(900);
  await renderAndShot('01-menu.png');
  console.log('menu captured');

  // Prefer a real DOM click so the menu→run handler is exercised.
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('[data-start]');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  qa.stages.clicked = clicked;
  if (!clicked) await page.evaluate(() => window.__sandstrike?.start?.());
  else {
    // DEPLOY now opens a difficulty chooser; pick standard to begin.
    await sleep(350);
    const picked = await page.evaluate(() => {
      const card = document.querySelector('[data-deploy-value="standard"]');
      if (!card) return false;
      card.click();
      return true;
    });
    qa.stages.deployPicked = picked;
  }
  await sleep(1200);

  const state0 = await page.evaluate(() => ({
    state: window.__sandstrike?.state,
    wave: window.__sandstrike?.enemies?.state?.wave,
    ammo: window.__sandstrike?.weapon?.mag,
  }));
  qa.stages.start = state0;
  console.log('state after start', JSON.stringify(state0));

  // Regression: WASD must follow the camera basis (a stale yaw-rotation sign
  // used to mirror forward/strafe for every yaw except 0).
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
  if (!(movement.w.forward > 0.5)) qa.errors.push('[qa] W does not move forward: ' + JSON.stringify(movement.w));
  if (!(movement.s.forward < -0.5)) qa.errors.push('[qa] S does not move backward: ' + JSON.stringify(movement.s));
  if (!(movement.a.right < -0.5)) qa.errors.push('[qa] A does not strafe left: ' + JSON.stringify(movement.a));
  if (!(movement.d.right > 0.5)) qa.errors.push('[qa] D does not strafe right: ' + JSON.stringify(movement.d));
  if (!(movement.wQuarter.forward > 0.5)) qa.errors.push('[qa] W is wrong after a 90° turn: ' + JSON.stringify(movement.wQuarter));
  if (!(movement.dQuarter.right > 0.5)) qa.errors.push('[qa] D is wrong after a 90° turn: ' + JSON.stringify(movement.dQuarter));
  console.log('movement', JSON.stringify(movement));

  // Advance simulation past the first countdown so wave 1 robots are on the field.
  const spawned = await page.evaluate(() => {
    const s = window.__sandstrike;
    s.player.godMode = true;
    return s.fastForward(4.2);
  });
  qa.stages.spawned = spawned;
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
  // Regression: the viewmodel muzzle flash must stay a small additive sprite
  // set. Earlier versions used two crossed camera-space quads plus untextured
  // square smoke cards, which could rasterise as a screen-filling dark panel.
  const flash = await page.evaluate(() => {
    const s = window.__sandstrike;
    s.weapon.fireCooldown = 0;
    s.weapon.mag = Math.max(10, s.weapon.mag);
    s.weapon.tryFire();
    const group = s.weapon.flashGroup;
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
    return { parts, maxWorldSize: +maxSize.toFixed(3), smokePuffs: s.weapon.smokePuffs.length };
  });
  qa.stages.flash = flash;
  if (flash.maxWorldSize > 0.34) qa.errors.push('[qa] muzzle flash too large: ' + flash.maxWorldSize);
  if (flash.smokePuffs !== 0) qa.errors.push('[qa] untextured smoke cards are back');
  if (flash.parts.some((p) => p.type === 'mesh:PlaneGeometry')) qa.errors.push('[qa] crossed-plane muzzle flash is back');
  if (flash.parts.some((p) => p.type === 'sprite' && p.blending !== 2)) qa.errors.push('[qa] muzzle flash is not additive');
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

  const waves = [];
  for (let i = 0; i < 48; i++) {
    const info = await page.evaluate(() => {
      const s = window.__sandstrike;
      s.player.godMode = true;
      const pre = s.fastForward(7.0);
      const killed = s.enemies.debugKillAll?.() ?? 0;
      return {
        state: s.state,
        wave: s.enemies?.state?.wave,
        alive: s.enemies?.state?.alive,
        between: s.enemies?.state?.betweenWaves,
        killed,
        score: s.game.score,
        kills: s.game.kills,
      };
    });
    const last = waves[waves.length - 1];
    if (!last || last.state !== info.state || last.wave !== info.wave) waves.push(info);
    if (info.state === 'victory') break;
    if (info.state === 'dead') break;
  }
  // Final wave-clear victory is announced ~2.2 s after the clear.
  await page.evaluate(() => window.__sandstrike.fastForward(4.5));
  await page.waitForFunction(() => {
    const el = document.querySelector('.screen--victory.is-active');
    return !!el && parseFloat(getComputedStyle(el).opacity) > 0.75;
  }, null, { timeout: 20000, polling: 100 }).catch((error) => {
    qa.errors.push('[qa] victory screen did not reveal: ' + error.message);
  });
  qa.stages.waves = waves;
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

  if (final.state !== 'victory') {
    qa.errors.push(`[qa] expected victory, got state=${final.state}`);
  }
  await page.evaluate(() => window.__sandstrike.freeze(false));


  // Loot + difficulty pass: upgrades, rare relic, death persistence.
  const loot = await page.evaluate(() => {
    const s = window.__sandstrike;
    // Fresh run first (the wave loop ended in victory).
    s.bus.dispatchEvent(new CustomEvent('ui:restart', {}));
    s.fastForward(0.5);
    if (s.state !== 'playing') s.bus.dispatchEvent(new CustomEvent('ui:resume', {}));
    s.player.godMode = true;
    s.player.health = s.player.maxHealth;
    s.player.armor = s.player.maxArmor;
    const px = s.player.position.x;
    const pz = s.player.position.z;
    const out = { before: { magSize: s.weapon.magSize, dmg: s.weapon.damageMultiplier, reload: s.weapon.reloadDuration, maxArmor: s.player.maxArmor } };
    s.enemies._spawnPickup('mag', px, pz);
    s.fastForward(0.25);
    s.enemies._spawnPickup('power', px, pz);
    s.fastForward(0.25);
    s.enemies._spawnPickup('reload', px, pz);
    s.fastForward(0.25);
    out.upgraded = {
      magSize: s.weapon.magSize,
      dmg: +s.weapon.damageMultiplier.toFixed(3),
      reload: +s.weapon.reloadDuration.toFixed(3),
      hud: document.querySelector('[data-ammo-loot]')?.textContent ?? '',
    };
    // rare relic: full restore + +50 max armor
    s.player.health = 30;
    s.player.armor = 12;
    s.enemies._spawnPickup('relic', px, pz);
    s.fastForward(0.25);
    out.relic = {
      health: Math.round(s.player.health),
      armor: Math.round(s.player.armor),
      maxArmor: s.player.maxArmor,
    };

    const snapshot = () => ({
      magSize: s.weapon.magSize,
      dmg: +s.weapon.damageMultiplier.toFixed(3),
      reload: +s.weapon.reloadDuration.toFixed(3),
      maxArmor: s.player.maxArmor,
    });
    const dieAndRedeploy = (difficulty) => {
      s.bus.dispatchEvent(new CustomEvent('ui:settings', { detail: { difficulty } }));
      s.player.godMode = false;
      s.damagePlayer(9999);
      s.fastForward(0.4);
      s.bus.dispatchEvent(new CustomEvent('ui:restart', {}));
      s.fastForward(0.4);
      if (s.state !== 'playing') s.bus.dispatchEvent(new CustomEvent('ui:resume', {}));
      s.player.godMode = true;
      return snapshot();
    };

    // standard: upgrades survive death + redeploy
    out.standardAfterDeath = dieAndRedeploy('standard');
    // hardcore: death wipes them back to the base rifle / armor cap
    out.hardcoreAfterDeath = dieAndRedeploy('hardcore');
    s.bus.dispatchEvent(new CustomEvent('ui:settings', { detail: { difficulty: 'standard' } }));
    return out;
  });
  qa.stages.loot = loot;
  if (loot.upgraded.magSize <= loot.before.magSize) qa.errors.push('[qa] magazine loot did not apply');
  if (!(loot.upgraded.dmg > 1)) qa.errors.push('[qa] damage loot did not apply');
  if (!(loot.upgraded.reload < loot.before.reload)) qa.errors.push('[qa] reload loot did not apply');
  if (loot.relic.maxArmor < loot.before.maxArmor + 50) qa.errors.push('[qa] relic did not raise armor cap');
  if (loot.relic.health < 100) qa.errors.push('[qa] relic did not restore health');
  if (loot.relic.armor !== loot.relic.maxArmor) qa.errors.push('[qa] relic did not fill armor');
  if (loot.standardAfterDeath.magSize < loot.upgraded.magSize) qa.errors.push('[qa] standard mode lost upgrades after death');
  if (!(loot.standardAfterDeath.maxArmor > 100)) qa.errors.push('[qa] standard mode lost armor cap after death');
  if (loot.hardcoreAfterDeath.magSize !== 30 || loot.hardcoreAfterDeath.dmg !== 1) qa.errors.push('[qa] hardcore did not reset upgrades after death');
  if (loot.hardcoreAfterDeath.maxArmor !== 100) qa.errors.push('[qa] hardcore did not reset armor cap after death');
  console.log('loot', JSON.stringify(loot));

  // Death-screen pass: the loot test left a fresh run, so just take lethal damage.
  const deathState = await page.evaluate(() => {
    const s = window.__sandstrike;
    if (s.state === 'paused') s.bus.dispatchEvent(new CustomEvent('ui:resume', {}));
    s.player.godMode = false;
    s.damagePlayer(500);
    return { state: s.state, uiState: s.ui?.state };
  });
  const restarted = true;
  qa.stages.death = { restarted, ...deathState };
  await page.waitForFunction(() => {
    const el = document.querySelector('.screen--death.is-active');
    return !!el && parseFloat(getComputedStyle(el).opacity) > 0.6;
  }, null, { timeout: 20000, polling: 100 }).catch((error) => {
    qa.errors.push('[qa] death screen did not reveal: ' + error.message);
  });
  await page.evaluate(() => window.__sandstrike.freeze(true));
  await page.evaluate(() => window.__sandstrike?.renderOnce?.());
  await sleep(200);
  await page.screenshot({ path: `${OUT}/05-death.png` });
  qa.screenshots.death = 'shots/05-death.png';
  if (deathState.state !== 'dead') qa.errors.push(`[qa] expected death, got ${deathState.state}`);
} catch (error) {
  errors.push('[qa] ' + (error.stack || error.message));
  try { await page.screenshot({ path: `${OUT}/error.png` }); } catch { /* noop */ }
  qa.screenshots.error = 'shots/error.png';
} finally {
  qa.errors = errors;
  qa.logs = logs;
  await writeFile(`${OUT}/qa.json`, JSON.stringify(qa, null, 2), 'utf8');
  await writeFile(`${OUT}/console.log`, logs.join('\n'), 'utf8');
  await browser.close();
  console.log(`\nQA done. errors=${errors.length} screenshots in shots/`);
  if (errors.length) {
    console.log(errors.slice(0, 12).join('\n'));
    process.exitCode = 1;
  }
}
