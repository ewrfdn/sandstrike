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
await page.evaluate(() => document.querySelector('[data-start]').click());
await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('[data-deploy-value="standard"]')?.click());
await new Promise((r) => setTimeout(r, 500));
const result = await page.evaluate(() => {
  const s = window.__sandstrike;
  s.freeze(true);
  s.player.godMode = true;
  const spawn = s.player.position;
  const baseX = spawn.x;
  const baseZ = spawn.z;
  const run = (yaw, code) => {
    s.player.position.set(baseX, 0, baseZ);
    s.player.velocity.set(0, 0, 0);
    s.player.yaw = yaw;
    s.player._keys.clear();
    s.player._keys.add(code);
    for (let i = 0; i < 20; i++) s.player.update(1 / 60);
    s.player._keys.clear();
    const dx = s.player.position.x - baseX;
    const dz = s.player.position.z - baseZ;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    // forward/right components of the movement
    return {
      yaw: +(yaw * 180 / Math.PI).toFixed(1),
      code,
      dx: +dx.toFixed(3),
      dz: +dz.toFixed(3),
      forward: +(dx * fx + dz * fz).toFixed(3),
      right: +(dx * rx + dz * rz).toFixed(3),
    };
  };
  return {
    yaw0W: run(0, 'KeyW'),
    yaw0S: run(0, 'KeyS'),
    yaw0A: run(0, 'KeyA'),
    yaw0D: run(0, 'KeyD'),
    yaw90W: run(Math.PI / 2, 'KeyW'),
    yaw90A: run(Math.PI / 2, 'KeyA'),
    yaw90D: run(Math.PI / 2, 'KeyD'),
  };
});
console.log(JSON.stringify({ result, errors }, null, 2));
await browser.close();
