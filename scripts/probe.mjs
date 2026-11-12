import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:8080/?dev=1&quality=medium', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const state = await page.evaluate(() => ({
    state: window.__sandstrikeApp?.state,
    loaded: window.__sandstrikeApp?.loaded,
    body: document.body.className,
    hasFatal: !!document.querySelector('.fatal-screen'),
    renderDebug: window.__renderDebug,
  })).catch((e) => ({ err: e.message }));
  console.log(i, JSON.stringify(state));
  if (state.loaded || state.hasFatal) break;
}
await page.screenshot({ path: 'shots/probe.png' });
await browser.close();
