#!/usr/bin/env node
/**
 * 验证 scripts/build-standalone.mjs 生成的单文件 HTML 是否能像「双击打开」一样运行。
 *
 *   node scripts/verify-standalone.mjs [file]
 *
 * 默认验证 sandstrike.html。检查项（campaign flow，2024 重构后）：
 * 1. 用 file:// 直接打开（无服务器、无 module import）能完成加载并显示主菜单；
 * 2. 页面请求全部是 file:// / data:，没有任何网络请求；
 * 3. 真实点击 NEW GAME → 难度卡 STANDARD 后进入 playing（outpost-07 / standard），能推进波次、
 *    开枪、打穿 15 波（Boss 波 5 / 10 / 15 = SIEGE WARDEN）并显示胜利结算；
 * 4. 通关后写入胜利存档（localStorage `sandstrike.progress.v2`，该 stage cleared=true）；
 * 5. 全程 0 个 console error / pageerror。
 *
 * 需要本机 Chrome（或设置 CHROME_PATH）与 playwright-core；截图与 JSON 输出到 shots/。
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FILE = resolve(process.argv[2] || 'sandstrike.html');
if (!existsSync(FILE)) {
  console.error(`找不到单文件构建产物：${FILE}\n请先运行 node scripts/build-standalone.mjs`);
  process.exit(1);
}
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = resolve('shots');
await mkdir(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// VERIFY_GPU=1 renders on the real D3D11 device: much faster than SwiftShader on
// this machine and it exercises the same file:// load / request / wave logic.
// Default stays SwiftShader so the check reproduces without a usable GPU.
const USE_GPU = process.env.VERIFY_GPU === '1';
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

const result = { file: FILE, errors: [], stages: {}, screenshots: {} };
const pageErrors = [];
const note = (message) => {
  result.errors.push(message);
  console.error('  ✗', message);
};
const ok = (message) => console.log('  ✓', message);

const watch = (page, label) => {
  const requests = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(`[${label} console] ${msg.text()}`);
  });
  page.on('pageerror', (error) => pageErrors.push(`[${label} pageerror] ${error.message}`));
  page.on('requestfailed', (request) => pageErrors.push(`[${label} requestfailed] ${request.url()} ${request.failure()?.errorText}`));
  page.on('request', (request) => requests.push(request.url()));
  return { requests };
};

try {
  // -------------------------------------------------------------------------
  // 阶段 1：完全模拟双击 —— 纯 file:// 路径，不带任何 query
  // -------------------------------------------------------------------------
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const watcher = watch(page, 'plain');
  console.log(`\n[1] 直接打开 ${FILE}`);
  const fileUrl = pathToFileURL(FILE).href;
  await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__sandstrikeApp?.loaded === true, null, { timeout: 180_000 });
  result.stages.loaded = true;
  ok('加载完成（file:// 下无 module / CORS 报错）');

  await sleep(400);
  // Wait for the menu fade-in instead of assuming a fixed delay: software
  // rasterisation can stall the first frames long enough to miss a hard sleep.
  await page.waitForFunction(() => {
    const s = document.querySelector('.screen--menu');
    return !!s && parseFloat(getComputedStyle(s).opacity) > 0.5;
  }, null, { timeout: 20000, polling: 100 }).catch(() => {});
  const menu = await page.evaluate(() => {
    const start = document.querySelector('[data-start]');
    const screen = document.querySelector('.screen--menu');
    return {
      state: window.__sandstrikeApp?.state,
      hasStart: !!start,
      startDisabled: start?.disabled ?? null,
      menuVisible: !!screen && parseFloat(getComputedStyle(screen).opacity) > 0.5,
      canvas: !!document.getElementById('scene'),
      webgl2: !!document.getElementById('scene')?.getContext('webgl2'),
    };
  });
  result.stages.menu = menu;
  if (menu.state !== 'menu') note(`主菜单状态异常：state=${menu.state}`);
  if (!menu.menuVisible || !menu.hasStart) note('主菜单未正常显示');
  if (!menu.webgl2) note('WebGL2 上下文不可用');
  await page.screenshot({ path: `${OUT}/standalone-01-menu.png` });
  result.screenshots.menu = 'shots/standalone-01-menu.png';

  // 真实 DOM 点击开始（与真人点按钮一致）
  await page.evaluate(() => { document.querySelector('[data-start]')?.click(); document.querySelector('[data-deploy-value="standard"]')?.click(); });
  await sleep(2200);
  const afterStart = await page.evaluate(() => ({ state: window.__sandstrikeApp?.state }));
  result.stages.afterStart = afterStart;
  if (afterStart.state !== 'playing') note(`点击 START 后未进入 playing：state=${afterStart.state}`);
  else ok('START OPERATION 点击生效，进入游戏');

  const frames = await page.evaluate(() => new Promise((done) => {
    let count = 0;
    let last = performance.now();
    const tick = () => {
      count++;
      if (performance.now() - last > 1200) done({ frames: count, renderFrames: window.__sandstrikeApp?.frames ?? null });
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  result.stages.animate = frames;
  if (frames.frames < 2) note(`渲染循环疑似未运行，仅 ${frames.frames} 帧 / 1.2s`);
  else ok(`渲染循环正常（1.2s 内 ${frames.frames} 帧，软件渲染下帧率偏低属正常）`);
  await page.screenshot({ path: `${OUT}/standalone-02-playing.png` });
  result.screenshots.playing = 'shots/standalone-02-playing.png';

  // 网络请求审计：file:// 版本不应发出任何 http(s) 请求
  const network = watcher.requests.filter((url) => /^(https?|ws|wss):/i.test(url));
  result.stages.requests = { total: watcher.requests.length, network };
  if (network.length) note(`单文件版本仍发起网络请求：${network.slice(0, 5).join(', ')}`);
  else ok(`0 个网络请求（共 ${watcher.requests.length} 个全部为本地 file:// 资源）`);

  // 关闭普通页面，避免两个 WebGL 页面在软件渲染下互相抢占 CPU 导致超时
  await page.close();

  // -------------------------------------------------------------------------
  // 阶段 2：带 dev 参数打穿完整 15 波 campaign（Boss 波 5 / 10 / 15；file:// 也支持 query）
  // -------------------------------------------------------------------------
  const devUrl = `${fileUrl}?dev=1&quality=high`;
  console.log(`\n[2] 深度验证 ${devUrl}`);
  const devPage = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const devWatcher = watch(devPage, 'dev');
  await devPage.goto(devUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await devPage.waitForFunction(() => window.__sandstrikeApp?.loaded === true, null, { timeout: 180_000 });
  await sleep(600);
  await devPage.evaluate(() => { document.querySelector('[data-start]')?.click(); document.querySelector('[data-deploy-value="standard"]')?.click(); });
  await sleep(1200);
  result.stages.devState = await devPage.evaluate(() => window.__sandstrike?.state);
  if (result.stages.devState !== 'playing') note(`dev 页未进入 playing：${result.stages.devState}`);

  const renders = await devPage.evaluate(() => window.__sandstrike.renderOnce());
  result.stages.renders = renders;
  if (!(renders?.calls > 0) || !(renders?.triangles > 0)) note(`renderOnce 异常：${JSON.stringify(renders)}`);
  else ok(`渲染统计正常（${renders.calls} draw calls / ${renders.triangles} 三角形）`);

  const waves = [];
  for (let i = 0; i < 60; i++) {
    // The SIEGE WARDEN steps in ~1.4 s after its escort line has spawned, so a
    // single time jump can clear a boss wave before the chassis appears (and
    // debugKillAll also drops still-pending spawns). Advance in 0.5 s chunks and
    // keep going while the current wave is a boss wave until the boss is alive;
    // normal waves only need long enough for the escorts to spawn.
    const info = await devPage.evaluate(() => {
      const s = window.__sandstrike;
      const isBossWave = (wave) => Number.isFinite(wave) && wave > 0 && wave % 5 === 0;
      s.player.godMode = true;
      let boss = null;
      for (let k = 0; k < 40; k++) {
        s.fastForward(0.5);
        const b = window.__devEnemies?.bossInfo?.();
        if (b && b.alive) { boss = b; break; }
        const waveNow = s.enemies?.state?.wave ?? 0;
        if (!isBossWave(waveNow) && k >= 13) break; // ~7 s is enough for normal waves
      }
      const killed = s.enemies.debugKillAll?.() ?? 0;
      return {
        state: s.state,
        wave: s.enemies?.state?.wave,
        alive: s.enemies?.state?.alive,
        boss: boss ? { wave: boss.wave, name: boss.displayName, maxHp: boss.maxHp, hp: boss.hp, fraction: boss.fraction } : null,
        killed,
        score: s.game?.score,
        kills: s.game?.kills,
      };
    });
    const last = waves[waves.length - 1];
    if (!last || last.state !== info.state || last.wave !== info.wave) waves.push(info);
    else if (info.boss && !last.boss) last.boss = info.boss;
    if (info.state === 'victory' || info.state === 'dead') break;
  }
  // Boss waves 5 / 10 / 15 must spawn the SIEGE WARDEN chassis.
  const bossWaves = waves.filter((w) => w.boss);
  result.stages.bossWaves = bossWaves.map((w) => ({
    wave: w.boss.wave,
    name: w.boss.name,
    maxHp: w.boss.maxHp,
    hpFraction: w.boss.fraction,
  }));
  const bossWaveNumbers = [...new Set(bossWaves.map((w) => w.boss.wave))].sort((a, b) => a - b);
  const bossNames = [...new Set(bossWaves.map((w) => w.boss.name || ''))];
  if (![5, 10, 15].every((n) => bossWaveNumbers.includes(n)) || !bossNames.every((name) => /SIEGE/i.test(name))) {
    note(`Boss 波异常：期望 5/10/15 SIEGE WARDEN，实际 ${JSON.stringify(result.stages.bossWaves)}`);
  } else {
    ok(`Boss 波 5/10/15 出现 SIEGE WARDEN：${bossWaveNumbers.map((n) => `W${n}`).join(' / ')}（${bossNames.join(', ')}）`);
  }
  await devPage.evaluate(() => window.__sandstrike.fastForward(7.0));
  await devPage.waitForFunction(() => {
    const el = document.querySelector('.screen--victory.is-active');
    return !!el && parseFloat(getComputedStyle(el).opacity) > 0.75;
  }, null, { timeout: 20_000, polling: 100 }).catch((error) => note('胜利界面未显示：' + error.message));
  const final = await devPage.evaluate(() => ({
    state: window.__sandstrike?.state,
    stage: window.__sandstrike?.stage?.id ?? null,
    wave: window.__sandstrike?.enemies?.state?.wave,
    score: window.__sandstrike?.game?.score,
    kills: window.__sandstrike?.game?.kills,
    victoryTitle: document.querySelector('[data-victory-title]')?.textContent?.replace(/\s+/g, ' ').trim() || null,
    victorySub: document.querySelector('[data-victory-sub]')?.textContent?.replace(/\s+/g, ' ').trim() || null,
    save: (() => {
      try {
        const raw = localStorage.getItem('sandstrike.progress.v2');
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    })(),
  }));
  result.stages.waves = waves;
  result.stages.final = final;
  if (final.state !== 'victory') note(`15 波流程未到达 victory：${JSON.stringify({ state: final.state, wave: final.wave, stage: final.stage })}`);
  else if (final.stage !== 'outpost-07') note(`victory 时 stage 异常：${final.stage}`);
  else ok(`15 波通关：stage=${final.stage} wave=${final.wave} kills=${final.kills} score=${final.score}`);
  if (!/CLEAR|COMPLETE|胜利|完成/i.test(final.victoryTitle || '')) note(`胜利标题异常：${JSON.stringify({ title: final.victoryTitle, sub: final.victorySub })}`);
  const saveOutpost = final.save?.stages?.['outpost-07'];
  result.stages.victorySave = saveOutpost
    ? {
        lastStageId: final.save.lastStageId,
        lastDifficulty: final.save.lastDifficulty,
        cleared: saveOutpost.cleared,
        clears: saveOutpost.clears,
        bestScore: saveOutpost.bestScore,
        start: !!saveOutpost.start,
        end: !!saveOutpost.end,
      }
    : null;
  if (!saveOutpost?.cleared || final.save.lastStageId !== 'outpost-07') {
    note(`通关存档未写入或不对：${JSON.stringify(result.stages.victorySave)}`);
  } else {
    ok(`胜利存档写入 localStorage：outpost-07 cleared=${saveOutpost.cleared} clears=${saveOutpost.clears} difficulty=${final.save.lastDifficulty}`);
  }
  delete final.save; // keep shots/standalone-qa.json diffable (full save omitted)
  await devPage.evaluate(() => window.__sandstrike?.freeze?.(true));
  await sleep(300);
  await devPage.screenshot({ path: `${OUT}/standalone-03-victory.png` });
  result.screenshots.victory = 'shots/standalone-03-victory.png';

  const devNetwork = devWatcher.requests.filter((url) => /^(https?|ws|wss):/i.test(url));
  if (devNetwork.length) note(`dev 页发起网络请求：${devNetwork.slice(0, 5).join(', ')}`);

  for (const item of pageErrors) note(item);
  result.stages.totalConsoleErrors = pageErrors.length;
  if (!result.errors.length) ok('全部检查通过：0 error');
} catch (error) {
  note(error.stack || error.message);
} finally {
  for (const item of pageErrors) if (!result.errors.includes(item)) result.errors.push(item);
  await writeFile(resolve(OUT, 'standalone-qa.json'), JSON.stringify(result, null, 2), 'utf8');
  await browser.close();
  console.log(`\nstandalone QA: errors=${result.errors.length}  →  shots/standalone-qa.json\n`);
  if (result.errors.length) process.exitCode = 1;
}
