import * as THREE from 'three';
import { CONFIG } from './config.js';
import { bus, emit, on } from './bus.js';
import { Effects } from './effects.js';
import { EnemyManager } from './enemies.js';
import { WeaponSystem } from './weapons.js';
import { Player } from './player.js';
import { PostFX } from './postfx.js';
import { UI } from './ui.js';
import { GameAudio } from './audio.js';
import { TouchControls, detectTouchMode } from './touch.js';

const canvas = document.getElementById('scene');
const params = new URLSearchParams(location.search);
const isDev = params.has('dev');

// ---------------------------------------------------------------------------
// Mobile mode: phones/tablets (or ?touch=1) get the touch control layer,
// a medium quality default and adaptive resolution. Desktop is unchanged.
// ---------------------------------------------------------------------------
const touchMode = detectTouchMode();
if (touchMode) document.documentElement.classList.add('is-touch');

// ---------------------------------------------------------------------------
// Settings (UI stores the same key; main mirrors it so a fresh boot is coherent)
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = { sensitivity: 1.0, volume: 0.8, quality: 'high', muted: false, difficulty: 'standard' };
function loadSettings() {
  let stored = false;
  try {
    const raw = localStorage.getItem('sandstrike.settings.v1');
    if (!raw) return { ...DEFAULT_SETTINGS, __stored: false };
    stored = true;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), __stored: stored };
  } catch {
    return { ...DEFAULT_SETTINGS, __stored: false };
  }
}
const settings = loadSettings();
// Touch devices boot at medium quality: full DPR + high/ultra post FX is the
// main mobile frame-time risk. An explicit ?quality= or a previously saved
// choice by the player still wins (only first-touch-device visits are forced).
if (touchMode && !params.has('quality') && !settings.__stored) settings.quality = 'medium';
if (params.get('quality') === 'medium' || params.get('quality') === 'ultra') settings.quality = params.get('quality');
if (params.get('difficulty') === 'hardcore' || params.get('difficulty') === 'standard') settings.difficulty = params.get('difficulty');
let currentQuality = ['medium', 'high', 'ultra'].includes(settings.quality) ? settings.quality : 'high';
/** 'standard' keeps loot upgrades after death, 'hardcore' wipes them. */
let currentDifficulty = settings.difficulty === 'hardcore' ? 'hardcore' : 'standard';

// ---------------------------------------------------------------------------
// Carried upgrades (standard mode keeps loot after death)
// ---------------------------------------------------------------------------
const CARRIED_KEY = 'sandstrike.carried.v1';
function loadCarried() {
  try {
    const raw = localStorage.getItem(CARRIED_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      weapon: data.weapon && typeof data.weapon === 'object' ? data.weapon : null,
      armorBonus: Number.isFinite(data.armorBonus) ? Math.max(0, Math.min(300, data.armorBonus)) : 0,
    };
  } catch {
    return null;
  }
}
function saveCarried(data) {
  try {
    if (!data) localStorage.removeItem(CARRIED_KEY);
    else localStorage.setItem(CARRIED_KEY, JSON.stringify(data));
  } catch { /* private mode */ }
}
let carriedUpgrades = loadCarried();

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
    alpha: false,
  });
} catch (error) {
  showFatal('无法初始化 WebGL2。请使用最新版 Chrome/Edge 并开启硬件加速。', error);
  throw error;
}
const qualityPixelRatio = (q) => Math.min(window.devicePixelRatio || 1, q === 'ultra' ? 2.0 : q === 'high' ? 1.65 : 1.0);
// Mobile render-scale caps: a phone at DPR 3 must not try to shade 2-3x screens.
const PIXEL_CAP_TOUCH = { medium: 1.0, high: 1.25, ultra: 1.5 };
const PIXEL_CAP_DESKTOP = { medium: 1.0, high: 1.65, ultra: 2.0 };
/** Adaptive render scale (touch only): 1 = full quality cap, floor keeps the image readable. */
let adaptiveScale = 1;
const ADAPTIVE_MIN = 0.72;
function basePixelRatio(q) {
  const caps = touchMode ? PIXEL_CAP_TOUCH : PIXEL_CAP_DESKTOP;
  return Math.min(window.devicePixelRatio || 1, caps[q] ?? 1.0);
}
function effectivePixelRatio(q) {
  return Math.max(0.65, basePixelRatio(q) * adaptiveScale);
}
renderer.setPixelRatio(touchMode ? effectivePixelRatio(currentQuality) : qualityPixelRatio(currentQuality));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = true;
canvas.style.width = '100%';
canvas.style.height = '100%';
canvas.style.display = 'block';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  CONFIG.renderer.fov,
  window.innerWidth / window.innerHeight,
  CONFIG.renderer.near,
  CONFIG.renderer.far
);
camera.rotation.order = 'YXZ';

// ---------------------------------------------------------------------------
// Boot systems
// ---------------------------------------------------------------------------
const audio = new GameAudio();
let ui;
try {
  ui = new UI({ audio, quality: currentQuality });
} catch (error) {
  console.error('UI failed to construct', error);
  ui = null;
}
audio.setVolume?.(settings.muted ? 0 : settings.volume);
audio.setMuted?.(settings.muted);

const game = {
  state: 'boot',
  quality: currentQuality,
  touchMode,
  score: 0,
  kills: 0,
  headshots: 0,
  bestCombo: 0,
  elapsed: 0,
  playTime: 0,
  startedAt: 0,
  deathTime: 0,
  pausedAt: 0,
};

let world = null;
let effects = null;
let enemies = null;
let weapon = null;
let player = null;
let postfx = null;
let touch = null;
let loaded = false;
let defeated = false;
let victoryHandled = false;
let hasLockedOnce = false;
let ignoreResumeUntil = 0;
let statsAccumulator = 0;
let lastFrame = performance.now();
let lowHealth = 0;
let menuAngle = 2.4;
let deathStartRoll = 0;
const renderDebug = { frames: 0, weaponRenders: 0, weaponActive: 0, errors: [] };
window.__renderDebug = renderDebug;
const menuLook = new THREE.Vector3(-1, 2.2, -6);
const listenerPos = new THREE.Vector3();
const listenerForward = new THREE.Vector3();
const tempVec = new THREE.Vector3();

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function showFatal(message, error) {
  console.error(message, error);
  const el = document.createElement('div');
  el.className = 'fatal-screen';
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#100b07;color:#f0d9bd;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font:500 16px/1.6 Bahnschrift,Segoe UI,sans-serif;padding:32px;text-align:center;';
  const h = document.createElement('div');
  h.style.cssText = 'font-size:28px;letter-spacing:.18em;color:#ff8a3c;font-weight:700;';
  h.textContent = 'SANDSTRIKE // SIGNAL LOST';
  const p = document.createElement('div');
  p.style.cssText = 'max-width:680px;opacity:.8;';
  p.textContent = message;
  const detail = document.createElement('pre');
  detail.style.cssText = 'max-width:760px;white-space:pre-wrap;opacity:.4;font-size:11px;';
  detail.textContent = String(error?.stack || error || '');
  const btn = document.createElement('button');
  btn.textContent = '重新载入 / RELOAD';
  btn.style.cssText = 'cursor:pointer;padding:12px 26px;background:#ff8a3c;border:0;color:#180f08;font:700 14px Bahnschrift,sans-serif;letter-spacing:.12em;';
  btn.onclick = () => location.reload();
  el.append(h, p, detail, btn);
  document.body.appendChild(el);
}

// ---------------------------------------------------------------------------
// UI / gameplay events
// ---------------------------------------------------------------------------
on('ui:start', () => {
  if (!loaded || game.state === 'playing') return;
  startRun();
});
on('ui:restart', () => {
  if (!loaded) return;
  startRun();
});
on('ui:resume', () => {
  if (performance.now() < ignoreResumeUntil) return;
  resumeGame();
});
on('ui:pause', () => pauseGame('ui'));
on('ui:menu', () => goMenu());
on('ui:settings', (detail = {}) => {
  if (Number.isFinite(detail.sensitivity) && player) {
    settings.sensitivity = THREE.MathUtils.clamp(detail.sensitivity, 0.25, 3.0);
    player.setSensitivity(CONFIG.player.mouseSensitivity * settings.sensitivity);
  }
  const rawVolume = Number.isFinite(detail.volumeRaw) ? detail.volumeRaw : detail.volume;
  if (Number.isFinite(rawVolume)) {
    settings.volume = THREE.MathUtils.clamp(rawVolume, 0, 1);
    audio.setVolume?.(detail.muted ? 0 : settings.volume);
  }
  if (typeof detail.muted === 'boolean') {
    settings.muted = detail.muted;
    audio.setMuted?.(detail.muted);
  }
  if (detail.quality && detail.quality !== currentQuality) applyQuality(detail.quality);
  if (detail.difficulty === 'standard' || detail.difficulty === 'hardcore') {
    currentDifficulty = detail.difficulty;
    settings.difficulty = detail.difficulty;
    game.difficulty = currentDifficulty;
    emit('game:difficulty', { difficulty: currentDifficulty });
    emit('player:stats', buildStats());
  }
});

on('wave:start', (detail = {}) => {
  if (game.state !== 'playing' || !weapon) return;
  weapon.addAmmo(80);
  if (player && player.alive) {
    player.addArmor(12);
    player.heal(15);
  }
  emit('player:stats', buildStats());
});
on('wave:clear', (detail = {}) => {
  if (game.state !== 'playing' || !weapon) return;
  weapon.addAmmo(55);
  if (weapon.mag < weapon.magSize * 0.6 && !weapon.reloading) weapon.startReload();
  if (player && player.alive) {
    player.addArmor(16);
    player.health = Math.min(player.maxHealth, player.health + 25);
  }
  emit('player:stats', buildStats());
});
on('combat:player-hit', (detail = {}) => {
  if (game.state !== 'playing' || !player || !player.alive) return;
  player.takeDamage(detail.amount ?? 8, detail.from || null, detail.source || 'robot');
});
on('player:hit', (detail = {}) => {
  if (game.state !== 'playing') return;
  postfx?.setDamage?.(THREE.MathUtils.clamp((detail.amount || 10) / 55 + 0.22, 0.18, 0.8));
  audio.setCombatIntensity?.(1);
});
on('player:died', () => {
  if (game.state === 'playing') die();
});
on('player:heal', (detail = {}) => {
  if (game.state !== 'playing' || !player) return;
  player.heal(detail.amount ?? 20);
  emit('player:stats', buildStats());
});
on('pickup:collected', (detail = {}) => {
  if (game.state !== 'playing') return;
  if (!weapon) return;
  if (detail.kind === 'ammo') {
    weapon.addAmmo(detail.amount ?? 40);
  } else if (detail.kind === 'mag') {
    weapon.addMagCapacity(detail.amount ?? 5);
  } else if (detail.kind === 'power') {
    weapon.addDamageBoost(detail.amount ?? 0.05);
  } else if (detail.kind === 'reload') {
    weapon.addReloadSpeed(detail.amount ?? 0.12);
  } else if (detail.kind === 'relic') {
    player?.grantRelic?.(detail.amount ?? 50);
    weapon.addAmmo(120);
    emit('weapon:notice', { text: '生命与护甲已回满 // FULLY RESTORED', type: 'info' });
  }
  emit('player:stats', buildStats());
});
on('enemy:killed', (detail = {}) => {
  game.kills++;
  if (detail.headshot) game.headshots++;
  if (Number.isFinite(detail.combo)) game.bestCombo = Math.max(game.bestCombo, detail.combo);
  // EnemyManager is the authoritative score source and emits score:change itself.
});
on('score:change', (detail = {}) => {
  if (Number.isFinite(detail.score)) game.score = detail.score;
  if (Number.isFinite(detail.combo)) game.bestCombo = Math.max(game.bestCombo, detail.combo);
});
on('fx:shake', (detail = {}) => {
  player?.addShake?.(detail.intensity ?? 0.3);
});
on('fx:hitflash', (detail = {}) => {
  postfx?.setDamage?.(detail.strength ?? 0.35);
});
on('combat:all-waves-cleared', () => handleVictory());
// compatibility if an older EnemyManager build still emits game:victory
on('game:victory', () => handleVictory());

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    hasLockedOnce = true;
  } else if (game.state === 'playing' && hasLockedOnce) {
    hasLockedOnce = false;
    pauseGame('pointerlock');
  }
});
document.addEventListener('pointerlockerror', () => {
  emit('weapon:notice', { text: '鼠标锁定失败 — 点击画面重试', type: 'info' });
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') pauseGame('visibility');
});
// Mobile housekeeping: iOS long-press callouts, pinch-zoom and double-tap zoom
// would otherwise fight the touch control layer.
if (touchMode) {
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });
  document.addEventListener('dblclick', (event) => event.preventDefault(), { passive: false });
  window.addEventListener('pagehide', () => { if (game.state === 'playing') pauseGame('pagehide'); });
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------
function startRun() {
  if (!loaded) return;
  audio.init?.();
  audio.resume?.();
  game.state = 'playing';
  defeated = false;
  victoryHandled = false;
  game.score = 0;
  game.kills = 0;
  game.headshots = 0;
  game.bestCombo = 0;
  game.playTime = 0;
  game.startedAt = performance.now();
  postfx?.setDamage?.(0);
  postfx?.setLowHealth?.(0);
  lowHealth = 0;
  player.reset(world.playerSpawn);
  player.setSensitivity(CONFIG.player.mouseSensitivity * THREE.MathUtils.clamp(settings.sensitivity, 0.25, 3.0));
  weapon.reset();
  weapon.resetUpgrades();
  player.resetArmorCap?.(CONFIG.player.maxArmor);
  // Standard mode: loot earned in a previous run survives death.
  if (currentDifficulty === 'standard' && carriedUpgrades) {
    weapon.importUpgrades(carriedUpgrades.weapon);
    player.applyArmorBonus?.(carriedUpgrades.armorBonus, CONFIG.player.maxArmor);
    const hasBonus = (carriedUpgrades.weapon?.magExtension || 0) > 0
      || (carriedUpgrades.weapon?.damageMultiplier || 1) > 1
      || (carriedUpgrades.weapon?.reloadSpeedMul || 1) < 1
      || (carriedUpgrades.armorBonus || 0) > 0;
    if (hasBonus) emit('weapon:notice', { text: '标准模式：已有强化保留 // UPGRADES CARRIED', type: 'info' });
  }
  weapon.setActive(true);
  game.difficulty = currentDifficulty;
  emit('game:difficulty', { difficulty: currentDifficulty });
  enemies.reset();
  enemies.start();
  camera.fov = CONFIG.renderer.fov;
  camera.updateProjectionMatrix();
  audio.setCombatIntensity?.(0.35);
  audio.startRun?.();
  emit('game:state', { state: 'playing' });
  emit('player:stats', buildStats());
  emit('score:change', { score: 0, combo: 0, multiplier: 1 });
  try { player.requestPointerLock(); } catch { /* non-fatal */ }
}

function pauseGame(reason = 'ui') {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  game.pausedAt = performance.now();
  ignoreResumeUntil = performance.now() + 420;
  player.enabled = false;
  weapon.setActive(false);
  audio.setCombatIntensity?.(0.12);
  if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  emit('game:state', { state: 'paused', reason });
}

function resumeGame() {
  if (game.state !== 'paused') return;
  game.state = 'playing';
  player.enabled = true;
  weapon.setActive(true);
  audio.resume?.();
  audio.setCombatIntensity?.(0.65);
  emit('game:state', { state: 'playing' });
  try { player.requestPointerLock(); } catch { /* non-fatal */ }
}

function goMenu() {
  if (!loaded) return;
  game.state = 'menu';
  player.enabled = false;
  weapon.setActive(false);
  if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  enemies.reset();
  weapon.reset();
  audio.setCombatIntensity?.(0.08);
  emit('game:state', { state: 'menu' });
}

/** Capture the run's loot so a standard-mode redeploy can keep it. */
function captureCarriedUpgrades() {
  if (!weapon || !player) return;
  if (currentDifficulty !== 'standard') {
    carriedUpgrades = null;
    saveCarried(null);
    return;
  }
  carriedUpgrades = {
    weapon: weapon.exportUpgrades(),
    armorBonus: Math.max(0, Math.round((player.maxArmor ?? CONFIG.player.maxArmor) - CONFIG.player.maxArmor)),
  };
  saveCarried(carriedUpgrades);
}

function die() {
  if (game.state !== 'playing') return;
  game.state = 'dead';
  defeated = true;
  game.deathTime = 0;
  deathStartRoll = camera.rotation.z;
  captureCarriedUpgrades();
  player.enabled = false;
  weapon.setActive(false);
  audio.playerDeath?.();
  audio.setCombatIntensity?.(0.15);
  if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  emit('game:state', { state: 'dead' });
  emit('game:death', buildRunStats());
}

function handleVictory() {
  if (game.state !== 'playing' || victoryHandled) return;
  victoryHandled = true;
  game.state = 'victory';
  captureCarriedUpgrades();
  player.enabled = false;
  weapon.setActive(false);
  audio.victory?.();
  audio.setCombatIntensity?.(0.18);
  if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  emit('game:state', { state: 'victory' });
  emit('game:victory', buildRunStats());
}

function buildRunStats() {
  const shots = weapon?.shotsFired || 0;
  const hits = weapon?.shotsHit || 0;
  return {
    score: game.score,
    wave: enemies?.state?.wave ?? 1,
    kills: game.kills,
    headshots: game.headshots,
    accuracy: shots > 0 ? Math.min(1, hits / shots) : 0,
    time: game.playTime,
    bestCombo: game.bestCombo,
  };
}

function buildStats() {
  const w = weapon?.getState?.() || {};
  return {
    health: Math.ceil(player?.health ?? CONFIG.player.maxHealth),
    maxHealth: player?.maxHealth ?? CONFIG.player.maxHealth,
    armor: Math.ceil(player?.armor ?? 0),
    maxArmor: player?.maxArmor ?? CONFIG.player.maxArmor,
    mag: w.mag ?? 0,
    magSize: w.magSize ?? CONFIG.weapon.magSize,
    reserve: w.reserve ?? 0,
    reloading: !!w.reloading,
    reloadProgress: w.reloadProgress ?? 0,
    weaponName: w.weapon || 'VXR-7',
    ads: !!w.ads,
    sprinting: !!player?.sprinting,
    alive: !!player?.alive,
    damageMultiplier: w.damageMultiplier ?? 1,
    magExtension: w.magExtension ?? 0,
    reloadBonus: w.reloadBonus ?? 0,
    difficulty: currentDifficulty,
    maxArmor: Math.ceil(player?.maxArmor ?? CONFIG.player.maxArmor),
  };
}

function applyQuality(quality) {
  if (!['medium', 'high', 'ultra'].includes(quality)) return;
  currentQuality = quality;
  game.quality = quality;
  settings.quality = quality;
  // A manual quality change restarts adaptive scaling from the new cap.
  adaptiveScale = 1;
  if (postfx) {
    postfx.setQuality(quality);
    applyViewportSize();
  } else {
    applyViewportSize();
  }
  effects?.setQuality?.(quality);
  world?.setQuality?.(quality);
}

// ---------------------------------------------------------------------------
// Viewport / adaptive resolution
// ---------------------------------------------------------------------------
let lastViewportWidth = 0;
let lastViewportHeight = 0;

/** Single source of truth for renderer size + pixel ratio (quality cap × adaptive scale). */
function applyViewportSize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(effectivePixelRatio(currentQuality));
  renderer.setSize(width, height, false);
  postfx?.setSize(width, height);
  weapon?.setAspect?.(camera.aspect);
  lastViewportWidth = width;
  lastViewportHeight = height;
}

/** Touch-only dynamic resolution: keeps close to 60 fps on weaker phone GPUs. */
function setAdaptiveScale(value) {
  const next = THREE.MathUtils.clamp(value, ADAPTIVE_MIN, 1);
  if (Math.abs(next - adaptiveScale) < 0.001) return;
  adaptiveScale = next;
  applyViewportSize();
}

const perfMonitor = { time: 0, frames: 0, settleUntil: 0 };
function trackPerformance(rawDt) {
  if (!touchMode || game.state !== 'playing') return;
  if (!(rawDt > 0) || rawDt > 0.5) return; // ignore tab-outs / long hitches
  const now = performance.now();
  if (now < perfMonitor.settleUntil) return;
  perfMonitor.time += rawDt;
  perfMonitor.frames++;
  if (perfMonitor.time < 1.6) return;
  const average = perfMonitor.time / perfMonitor.frames;
  perfMonitor.time = 0;
  perfMonitor.frames = 0;
  perfMonitor.settleUntil = now + 900;
  if (average > 0.026 && adaptiveScale > ADAPTIVE_MIN + 0.001) {
    setAdaptiveScale(adaptiveScale - 0.1);
  } else if (average < 0.0175 && adaptiveScale < 0.999) {
    setAdaptiveScale(adaptiveScale + 0.06);
  }
}

// ---------------------------------------------------------------------------
// Menu / death camera
// ---------------------------------------------------------------------------
function updateMenuCamera(dt) {
  menuAngle += dt * 0.045;
  const radius = 22.5;
  const bob = Math.sin(game.elapsed * 0.35) * 0.35;
  camera.position.set(
    Math.sin(menuAngle) * radius + Math.sin(game.elapsed * 0.21) * 0.4,
    7.2 + bob,
    Math.cos(menuAngle) * radius + 2.5
  );
  camera.fov = 59;
  camera.updateProjectionMatrix();
  camera.lookAt(menuLook);
  camera.rotation.z = Math.sin(game.elapsed * 0.17) * 0.012;
}

function updateDeathCamera(dt) {
  game.deathTime += dt;
  const fall = Math.min(1, game.deathTime / 1.35);
  const ease = 1 - Math.pow(1 - fall, 3);
  camera.position.y = Math.max(0.48, player.position.y + player.eyeHeight - ease * 1.15);
  camera.rotation.z = deathStartRoll + ease * 0.24;
  camera.rotation.x = THREE.MathUtils.damp(camera.rotation.x, -0.24, 2.5, dt);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function animate(now) {
  requestAnimationFrame(animate);
  if (!loaded) {
    return;
  }
  if (renderDebug.frozen) {
    // QA / photo mode: keep presenting the current frame without advancing
    // the simulation (transient VFX would otherwise smear across captures).
    lastFrame = now;
    try { postfx.render(0.016); } catch (error) { console.error('PostFX render error', error); }
    try { weapon.render(renderer); renderDebug.weaponRenders++; } catch (error) { renderDebug.errors.push(String(error)); }
    renderDebug.frames++;
    return;
  }
  const rawDt = (now - lastFrame) / 1000;
  const dt = Math.min(0.05, Math.max(0, rawDt || 0.016));
  lastFrame = now;
  game.elapsed += dt;
  trackPerformance(rawDt);

  try {
    world.update?.(dt, game.elapsed);
    effects.update?.(dt, game.elapsed);

    if (game.state === 'playing') {
      game.playTime += dt;
      player.update(dt);
      weapon.update(dt);
      enemies.update(dt, game.elapsed);
      postfx.setLowHealth(THREE.MathUtils.clamp(1 - player.health / 38, 0, 1));
      const alive = enemies.state?.alive ?? 0;
      const wave = enemies.state?.wave ?? 1;
      audio.setCombatIntensity?.(THREE.MathUtils.clamp(0.18 + alive * 0.075 + wave * 0.05, 0, 1));
      statsAccumulator += dt;
      if (statsAccumulator >= 0.066) {
        statsAccumulator = 0;
        emit('player:stats', buildStats());
      }
    } else if (game.state === 'menu') {
      updateMenuCamera(dt);
      audio.setCombatIntensity?.(0.08);
    } else if (game.state === 'dead') {
      updateDeathCamera(dt);
    }

    camera.getWorldPosition(listenerPos);
    camera.getWorldDirection(listenerForward);
    audio.update?.(dt, { position: listenerPos, forward: listenerForward });
    postfx.update(dt);
  } catch (error) {
    console.error('Frame update error', error);
  }

  try {
    postfx.render(dt);
  } catch (error) {
    console.error('PostFX render error', error);
  }
  try {
    weapon.render(renderer);
    renderDebug.weaponRenders++;
    if (weapon.active) renderDebug.weaponActive++;
  } catch (error) {
    renderDebug.errors.push(String(error));
    console.error('Viewmodel render error', error);
  }
  renderDebug.frames++;
}

function onResize() {
  if (window.innerWidth === lastViewportWidth && window.innerHeight === lastViewportHeight) return;
  applyViewportSize();
}
window.addEventListener('resize', onResize);
// Mobile browsers report stale innerWidth/innerHeight during orientation flips,
// so re-measure once immediately and once after the transition settles.
window.addEventListener('orientationchange', () => {
  onResize();
  setTimeout(onResize, 260);
});
try {
  window.screen?.orientation?.addEventListener?.('change', () => setTimeout(onResize, 120));
} catch { /* not supported */ }
try {
  window.visualViewport?.addEventListener?.('resize', () => onResize());
} catch { /* not supported */ }


// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  emit('loading:progress', { progress: 0.04, label: '初始化战术终端' });
  await nextFrame();

  let createWorldFn = null;
  try {
    if (params.get('world') === 'dev') throw new Error('forced dev world');
    const worldModule = await import('./world.js');
    createWorldFn = worldModule.createWorld;
    if (typeof createWorldFn !== 'function') throw new Error('world.js has no createWorld export yet');
  } catch (error) {
    if (params.has('fallback') || params.get('world') === 'dev') {
      console.warn('[SANDSTRIKE] real world unavailable — using dev greybox:', error.message);
      const fallback = await import('./dev-world.js');
      createWorldFn = fallback.createWorld;
    } else {
      throw error;
    }
  }
  if (typeof createWorldFn !== 'function') throw new Error('world.js did not export createWorld');

  world = await createWorldFn(scene, renderer, {
    quality: currentQuality,
    onProgress: (progress, label) => {
      emit('loading:progress', {
        progress: 0.06 + THREE.MathUtils.clamp(progress, 0, 1) * 0.54,
        label: label || '构筑沙暴战区',
      });
    },
  });
  // Integration polish: the close-up sand normal tiling reads as corduroy at
  // grazing angles; soften it hard while keeping the fine wind texture.
  try {
    scene.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of materials) {
        if (!material?.normalMap || !material.name) continue;
        if (/^sand(Dune|Dark)?$/.test(material.name) && material.normalScale) {
          material.normalScale.setScalar(0.06);
          material.needsUpdate = true;
        }
      }
    });
  } catch (error) {
    console.warn('sand material polish skipped', error);
  }
  emit('loading:progress', { progress: 0.62, label: '预热光追材质' });
  await nextFrame();

  effects = new Effects(scene, camera, { quality: currentQuality });
  player = new Player({ camera, canvas, world, audio });
  if (params.get('dev') === '1') player.allowUnlockedLook = false;
  emit('loading:progress', { progress: 0.7, label: '部署敌方机械单位' });
  await nextFrame();

  enemies = new EnemyManager({
    scene,
    world,
    effects,
    audio,
    quality: currentQuality,
    getPlayer: () => ({
      position: player.position,
      eye: player.eye,
      alive: player.alive,
      yaw: player.yaw,
      health: player.health,
      armor: player.armor,
      accuracy: weapon && weapon.shotsFired > 0 ? weapon.shotsHit / weapon.shotsFired : 0,
      score: game.score,
      kills: game.kills,
    }),
  });
  emit('loading:progress', { progress: 0.8, label: '校准 VXR-7 突击步枪' });
  await nextFrame();

  weapon = new WeaponSystem({
    camera,
    canvas,
    world,
    enemies,
    effects,
    audio,
    player,
    renderer,
    environment: scene.environment || null,
  });
  weapon.setAspect(camera.aspect);
  emit('loading:progress', { progress: 0.9, label: '编译电影级后期管线' });
  await nextFrame();

  postfx = new PostFX(renderer, scene, camera, { quality: currentQuality });
  player.setSensitivity(CONFIG.player.mouseSensitivity * THREE.MathUtils.clamp(settings.sensitivity, 0.25, 3.0));

  // Touch layer (phones / tablets, or ?touch=1 for desktop emulation). On touch
  // devices pointer lock is never requested: the canvas is driven by the stick
  // and drag-to-look surfaces instead.
  player.setTouchMode(touchMode);
  weapon.setTouchMode(touchMode);
  if (touchMode) {
    try {
      touch = new TouchControls({
        player,
        weapon,
        canvas,
        mount: document.getElementById('ui'),
        onPause: () => pauseGame('touch'),
      });
    } catch (error) {
      console.warn('[SANDSTRIKE] touch controls failed to initialise', error);
      touch = null;
    }
  }

  // menu camera / first frame compile
  game.state = 'menu';
  menuAngle = 2.4;
  updateMenuCamera(0.016);
  world.update(0, 0.016);
  effectFirstFrame();
  postfx.render(0.016);
  weapon.render(renderer);

  emit('game:world', {
    bounds: world.mapBounds,
    landmarks: world.landmarks || [],
    playerSpawn: world.playerSpawn,
  });
  emit('loading:progress', { progress: 1, label: '战区就绪' });
  await nextFrame();
  emit('game:ready');
  emit('game:state', { state: 'menu' });
  loaded = true;
  lastFrame = performance.now();
  requestAnimationFrame(animate);

  const bootEl = document.getElementById('boot');
  if (bootEl) {
    bootEl.classList.add('is-hidden');
    setTimeout(() => bootEl.remove(), 900);
  }

  if (isDev) {
    renderer.info.autoReset = false;
    window.__sandstrike = {
      game,
      player,
      enemies,
      weapon,
      world,
      ui,
      audio,
      effects,
      camera,
      scene,
      renderer,
      postfx,
      touch,
      start: startRun,
      pause: pauseGame,
      resume: resumeGame,
      menu: goMenu,
      get touchMode() { return touchMode; },
      get adaptiveScale() { return adaptiveScale; },
      setAdaptiveScale(value = 1) {
        setAdaptiveScale(THREE.MathUtils.clamp(Number(value) || 1, ADAPTIVE_MIN, 1));
        return adaptiveScale;
      },
      killAll() {
        if (!enemies) return 0;
        const roots = new Set();
        for (const t of enemies.raycastTargets || []) {
          let node = t;
          while (node && !node.userData?.robot) node = node.parent;
          if (node?.userData?.robot && !node.userData.robot.dead) roots.add(node);
        }
        let count = 0;
        for (const node of roots) {
          try {
            enemies.damage(node, 99999, { point: node.position.clone(), direction: new THREE.Vector3(0, 0, -1), headshot: false, weapon: 'dev' });
            count++;
          } catch (error) { console.warn(error); }
        }
        return count;
      },
      look(dx, dy) { player.look(dx, dy); },
      fastForward(seconds = 1) {
        const total = Math.min(300, Math.max(0, seconds));
        let remaining = total;
        let steps = 0;
        const step = 1 / 30;
        while (remaining > 1e-4 && steps < 9000) {
          const dt = Math.min(step, remaining);
          game.elapsed += dt;
          try { world.update?.(dt, game.elapsed); } catch { /* dev */ }
          try { effects.update?.(dt, game.elapsed); } catch { /* dev */ }
          if (game.state === 'playing') {
            game.playTime += dt;
            try { player.update(dt); } catch (error) { console.warn('ff player', error); }
            try { weapon.update(dt); } catch (error) { console.warn('ff weapon', error); }
            try { enemies.update(dt, game.elapsed); } catch (error) { console.warn('ff enemies', error); }
          }
          remaining -= dt;
          steps++;
        }
        statsAccumulator = 1;
        lastFrame = performance.now();
        postfx?.setLowHealth?.(THREE.MathUtils.clamp(1 - player.health / 38, 0, 1));
        emit('player:stats', buildStats());
        return { state: game.state, wave: enemies?.state?.wave, alive: enemies?.state?.alive, time: game.playTime };
      },
      killAll() { return enemies?.debugKillAll?.() ?? 0; },
      jumpToWave(n) { enemies?.debugJumpToWave?.(n); },
      damagePlayer(amount = 20) { player.takeDamage(amount, new THREE.Vector3(0, 1.6, 20), 'dev'); },
      renderOnce() {
        renderer.info.reset();
        postfx.render(0.016);
        weapon.render(renderer);
        renderDebug.frames++;
        return {
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          textures: renderer.info.memory.textures,
          geometries: renderer.info.memory.geometries,
          weaponActive: this.weapon?.active ?? false,
        };
      },
      bus,
      freeze(value = true) {
        renderDebug.frozen = value !== false;
        lastFrame = performance.now();
        return renderDebug.frozen;
      },
      get frozen() { return renderDebug.frozen; },
      get state() { return game.state; },
    };
    window.__sandstrike.godMode = (enabled = true) => { player.godMode = enabled; };
    console.info('[SANDSTRIKE] dev hooks ready: window.__sandstrike');
  }
}

function effectFirstFrame() {
  // Warm up shader compiles without showing warnings for missing optional systems.
  try {
    renderer.compile(scene, camera);
    renderer.compile(weapon.viewScene, weapon.viewCamera);
  } catch (error) {
    console.warn('Shader precompile skipped', error);
  }
}

boot().catch((error) => {
  showFatal('战区初始化失败。请刷新重试。', error);
});

// expose a small always-on debug handle for automated QA even without ?dev=1
window.__sandstrikeApp = {
  get state() { return game.state; },
  get loaded() { return loaded; },
  get touchMode() { return touchMode; },
  get touchControls() { return touch; },
  get adaptiveScale() { return adaptiveScale; },
};
