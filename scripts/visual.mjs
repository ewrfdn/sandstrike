import { chromium } from 'playwright-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') console.log(logs[logs.length - 1]); });
page.on('pageerror', (e) => { logs.push('[pageerror] ' + e.message); console.log(logs[logs.length - 1]); });
await page.goto('http://127.0.0.1:8080/?dev=1&quality=high', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__sandstrikeApp?.loaded === true, null, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: 'shots/real-menu.png' });
console.log('menu shot');
const btn = page.locator('[data-action="start"]').first();
await btn.click({ timeout: 5000 }).catch(async (e) => {
  console.log('click failed', e.message);
  await page.evaluate(() => window.__sandstrike.start());
});
await new Promise((r) => setTimeout(r, 6000));
const info = await page.evaluate(() => {
  const s = window.__sandstrike;
  return {
    state: s.state,
    wave: s.enemies.state,
    frames: window.__renderDebug,
    render: { calls: s.renderer.info.render.calls, tris: s.renderer.info.render.triangles, textures: s.renderer.info.memory.textures },
    player: s.player.position.toArray(),
    health: s.player.health,
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: 'shots/real-gameplay.png' });
// hide UI for a pure 3D composition shot
await page.evaluate(() => { document.getElementById('ui').style.display = 'none'; });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'shots/real-clean.png' });
console.log(logs.slice(0, 80).join('\n'));
await browser.close();
