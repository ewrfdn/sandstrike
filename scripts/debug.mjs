import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:8080/?dev=1&world=dev&quality=medium', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__sandstrikeApp?.loaded === true, null, { timeout: 120000 });
await page.evaluate(() => window.__sandstrike.start());
await new Promise((r) => setTimeout(r, 2500));
const info = await page.evaluate(() => {
  const s = window.__sandstrike;
  const w = s.weapon;
  const v = w.viewScene;
  const box = new (s.camera.position.constructor)();
  w.gunRoot.getWorldPosition(box);
  let meshCount = 0;
  w.gunRoot.traverse((o) => { if (o.isMesh) meshCount++; });
  const camPos = new (s.camera.position.constructor)();
  s.camera.getWorldPosition(camPos);
  return {
    state: s.state,
    active: w.active,
    ads: w.ads,
    gunPos: w.gunRoot.position.toArray(),
    gunWorld: box.toArray(),
    gunScale: w.gunRoot.scale.toArray(),
    meshCount,
    viewChildren: v.children.length,
    viewCamera: { fov: w.viewCamera.fov, aspect: w.viewCamera.aspect, near: w.viewCamera.near },
    camera: { pos: camPos.toArray(), rot: [s.camera.rotation.x, s.camera.rotation.y, s.camera.rotation.z], fov: s.camera.fov },
    renderer: { autoClear: s.renderer.autoClear, target: s.renderer.getRenderTarget()?.texture?.name || null, pr: s.renderer.getPixelRatio() },
    sceneChildren: s.scene.children.length,
    renderDebug: window.__renderDebug,
    enemyWave: s.enemies.state,
    visibility: (() => { const c = new s.camera.position.constructor(); s.camera.getWorldDirection(c); return c.toArray(); })(),
  };
});
console.log(JSON.stringify(info, null, 2));
console.log(logs.slice(0, 40).join('\n'));
await page.screenshot({ path: 'shots/debug-01.png' });

// Ask for a manual rAF and wait for the next frame, then re-shoot.
await page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => {
    const s = window.__sandstrike;
    s.renderer.setRenderTarget(null);
    s.weapon.render(s.renderer);
    resolve();
  });
}));
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'shots/debug-manual-frame.png' });

// Render viewmodel only, then screenshot to isolate it.
await page.evaluate(() => {
  const s = window.__sandstrike;
  s.renderer.setRenderTarget(null);
  s.renderer.setClearColor(0x222222, 1);
  s.renderer.clear(true, true, true);
  s.renderer.render(s.weapon.viewScene, s.weapon.viewCamera);
});
await page.screenshot({ path: 'shots/debug-viewmodel.png' });
await browser.close();
