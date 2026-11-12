import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:8080/?dev=1&quality=medium', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__sandstrikeApp?.loaded === true, null, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 900));
const layout = await page.evaluate(() => {
  const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }; };
  const side = document.querySelector('.menu-side');
  const controls = document.querySelector('.screen--menu .panel--controls');
  const start = document.querySelector('[data-start]');
  return {
    viewport: [innerWidth, innerHeight],
    side: { client: side?.clientHeight, scroll: side?.scrollHeight },
    controls: rect('.screen--menu .panel--controls'),
    controlsClipped: controls ? controls.getBoundingClientRect().bottom > innerHeight : null,
    start: rect('[data-start]'),
    startBox: start ? (() => { const r = start.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })() : null,
    objective: (() => { const el = document.querySelector('.obj-text'); return el ? { client: el.clientWidth, scroll: el.scrollWidth, text: el.textContent.trim() } : null; })(),
  };
});
console.log('layout', JSON.stringify(layout, null, 2));
await page.screenshot({ path: 'shots/06-menu-720.png' });

let lock = false;
let pointerLock = null;
if (layout.startBox) {
  await page.mouse.click(layout.startBox.x, layout.startBox.y);
  await new Promise((r) => setTimeout(r, 1000));
  const state = await page.evaluate(() => ({
    state: window.__sandstrike?.state,
    screen: document.getElementById('ui')?.dataset?.screen,
    pointerLock: !!document.pointerLockElement,
    hud: !!document.querySelector('.ui-root')?.classList?.contains('is-playing'),
  }));
  console.log('after real click', JSON.stringify(state));
  lock = state.state === 'playing';
  pointerLock = state.pointerLock;
  await page.evaluate(() => { const s = window.__sandstrike; s.freeze(true); s.renderOnce(); });
  await page.screenshot({ path: 'shots/07-gameplay-720.png' });
}
console.log('errors', JSON.stringify(errors));
await browser.close();
