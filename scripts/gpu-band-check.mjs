/**
 * Real-GPU regression: no NaN "black band" while firing.
 *
 * A tracer whose fragment shader evaluated pow() on a slightly-negative
 * interpolated varying produced NaN on D3D11. The bloom mip chain smeared that
 * single texel into a screen-wide black band (only visible on real GPUs, not on
 * SwiftShader), so this check must run with hardware acceleration enabled.
 *
 * Usage: node scripts/gpu-band-check.mjs [url] [width] [height]
 */
import { chromium } from 'playwright-core';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:8080';
const W = Number(process.argv[3] || 2476);
const H = Number(process.argv[4] || 1208);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

let failed = false;
try {
  await page.goto(`${URL_BASE}/?dev=1&quality=high`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__sandstrikeApp?.loaded === true, null, { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => document.querySelector('[data-start]').click());
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelector('[data-deploy-value="standard"]')?.click());
  await new Promise((r) => setTimeout(r, 1200));

  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });

  const report = await page.evaluate(async () => {
    const s = window.__sandstrike;
    const gl = s.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    const grab = () => gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const columns = () => {
      const xs = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((f) => Math.floor(w * f));
      const out = [];
      for (const x of xs) {
        let dark = 0;
        let n = 0;
        for (let y = Math.floor(h * 0.08); y < h * 0.92; y += 8) {
          const i = (y * w + x) * 4;
          if (buf[i] + buf[i + 1] + buf[i + 2] < 30) dark++;
          n++;
        }
        out.push(+(dark / n).toFixed(2));
      }
      return out;
    };
    const samples = [];
    let worst = 0;
    s.player.godMode = true;
    s.player.yaw = 0;
    s.player.lookPitch = 0;
    s.weapon.triggerDown = true;
    for (let i = 0; i < 60; i++) {
      s.weapon.fireCooldown = 0;
      s.weapon.mag = 30;
      await new Promise((r) => setTimeout(r, 55));
      s.postfx.render(0.016);
      grab();
      const p = columns();
      const m = Math.max(...p);
      if (m > worst) worst = m;
      if (m > 0.75) samples.push({ i, p });
      if (i === 20) s.enemies.debugKillAll(); // explosives + debris + enemy tracers
      if (i === 40) s.enemies.debugJumpToWave(3);
    }
    s.weapon.triggerDown = false;
    return { worst, hits: samples.length, samples: samples.slice(0, 4) };
  });

  console.log('gpu:', gpu);
  console.log('band check:', JSON.stringify(report));
  if (report.worst > 0.75) {
    failed = true;
    console.log('FAIL: black band detected while firing');
  } else {
    console.log('PASS: no black band');
  }
  console.log('console errors:', errors.length);
  if (errors.length) failed = true;
} catch (error) {
  failed = true;
  console.log('ERROR', error.stack || error.message);
} finally {
  await browser.close();
  if (failed) process.exitCode = 1;
}
