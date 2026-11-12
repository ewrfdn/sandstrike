import { chromium } from 'playwright-core';
const URL_BASE = process.argv[2] || 'http://127.0.0.1:8080';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${URL_BASE}/?dev=1&quality=medium`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__sandstrikeApp?.loaded === true, null, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 800));
const startBox = await page.evaluate(() => {
  const r = document.querySelector('[data-start]').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(startBox.x, startBox.y);
await new Promise((r) => setTimeout(r, 900));
const started = await page.evaluate(() => ({
  state: window.__sandstrike.state, lock: !!document.pointerLockElement,
  mag: window.__sandstrike.weapon.mag, reserve: window.__sandstrike.weapon.reserve,
}));
// Real keyboard W: verify the browser event + movement math agree with the view.
await page.keyboard.down('w');
await new Promise((r) => setTimeout(r, 120));
const move = await page.evaluate(() => {
  const s = window.__sandstrike;
  const p = s.player.position;
  const before = { x: p.x, z: p.z };
  const yaw = s.player.yaw;
  s.fastForward(0.45);
  const after = { x: p.x, z: p.z };
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return {
    yaw: +yaw.toFixed(3),
    dx: +(after.x - before.x).toFixed(3),
    dz: +(after.z - before.z).toFixed(3),
    forward: +((after.x - before.x) * fx + (after.z - before.z) * fz).toFixed(3),
    right: +((after.x - before.x) * Math.cos(yaw) + (after.z - before.z) * -Math.sin(yaw)).toFixed(3),
  };
});
await page.keyboard.up('w');
// ADS
await page.mouse.down({ button: 'right' });
await new Promise((r) => setTimeout(r, 700));
const ads = await page.evaluate(() => ({
  ads: window.__sandstrike.weapon.ads,
  fov: window.__sandstrike.weapon.viewCamera?.fov,
  active: window.__sandstrike.weapon.adsTarget ?? null,
}));
await page.mouse.up({ button: 'right' });
// Fire one round, then reload (reload is blocked at full magazine by design).
await page.mouse.click(640, 360);
await new Promise((r) => setTimeout(r, 300));
const afterShot = await page.evaluate(() => ({
  mag: window.__sandstrike.weapon.mag,
  shots: window.__sandstrike.weapon.shotsFired,
}));
await page.keyboard.press('r');
await new Promise((r) => setTimeout(r, 500));
const reloading = await page.evaluate(() => ({
  reloading: window.__sandstrike.weapon.reloading,
  progress: window.__sandstrike.weapon.reloadProgress,
}));
await new Promise((r) => setTimeout(r, 2800));
const reloaded = await page.evaluate(() => ({
  mag: window.__sandstrike.weapon.mag,
  reserve: window.__sandstrike.weapon.reserve,
  reloading: window.__sandstrike.weapon.reloading,
}));
// Pause / resume via Escape and UI button
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 500));
const paused = await page.evaluate(() => ({
  state: window.__sandstrike.state,
  screen: document.getElementById('ui')?.dataset?.screen,
  lock: !!document.pointerLockElement,
}));
const resumed = await page.evaluate(() => {
  const btn = document.querySelector('.screen--pause [data-action="resume"]');
  if (btn) { btn.click(); return true; }
  return false;
});
await new Promise((r) => setTimeout(r, 600));
const resumedState = await page.evaluate(() => ({
  state: window.__sandstrike.state,
  screen: document.getElementById('ui')?.dataset?.screen,
}));
console.log(JSON.stringify({ started, move, ads, afterShot, reloading, reloaded, paused, resumed, resumedState, errors }, null, 2));
await browser.close();
