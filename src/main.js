import * as THREE from 'three';
import {
  CONFIG,
  DEFAULT_DIFFICULTY_ID,
  DEFAULT_STAGE_ID,
  STAGE_TOTAL,
  getDifficulty,
  getStage,
  getStageByIndex,
  nextStage,
} from './config/index.js';
import * as Progress from './save.js';
import { bus, emit, on } from './bus.js';
import { Effects } from './effects.js';
import { EnemyManager } from './enemies.js';
import { WeaponSystem } from './weapons.js';
import { Player } from './player.js';
import { PostFX } from './postfx.js';
import { UI } from './ui/index.js';
import { GameAudio } from './audio.js';
import { TouchControls, detectTouchMode } from './touch.js';
import { GamepadControls, detectGamepadSupport } from './gamepad.js';

const canvas = document.getElementById('scene');
const params = new URLSearchParams(location.search);
const isDev = params.has('dev');
// Optional map selection: `?map=<id>` picks one folder from src/config/maps/.
// Unknown ids are ignored by createWorld(), which falls back to the default map.
const requestedMapId = params.get('map') || null;
// NOTE: dev tooling (model / map viewers) is a separate Vite app under
// `dev_tools/` and is no longer linked from the game — start it with
// `npm run dev:tools` (http://127.0.0.1:5199/). See dev_tools/README.md.

// ---------------------------------------------------------------------------
// Mobile mode: phones/tablets (or ?touch=1) get the touch control layer,
// a medium quality default and adaptive resolution. Desktop is unchanged.
// ---------------------------------------------------------------------------
const touchMode = detectTouchMode();
if (touchMode) document.documentElement.classList.add('is-touch');

// ---------------------------------------------------------------------------
// Settings (UI stores the same key; main mirrors it so a fresh boot is coherent)
// ---------------------------------------------------------------------------
/** Render-quality tiers, cheapest first. Keep in sync with src/ui.js QUALITIES. */
const QUALITY_IDS = ['lowest', 'low', 'medium', 'high', 'ultra'];
const DEFAULT_SETTINGS = { sensitivity: 1.0, volume: 0.8, quality: 'high', muted: false, vibrate: true };
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
if (QUALITY_IDS.includes(params.get('quality'))) settings.quality = params.get('quality');
let currentQuality = QUALITY_IDS.includes(settings.quality) ? settings.quality : 'high';

// ---------------------------------------------------------------------------
// Campaign progression (src/save.js) — one save slot per configured stage.
// The save is written ONLY when a stage is entered or cleared; death, pause,
// going back to the menu and page reloads mid-stage never write progression.
// ---------------------------------------------------------------------------
/** Last loaded campaign save (null = fresh install / no save). */
let progress = Progress.loadProgress();
/** Difficulty id of the run in progress (one of src/config/difficulty.js ids). */
let currentDifficultyId = (progress && progress.lastDifficulty) || DEFAULT_DIFFICULTY_ID;
if (params.get('difficulty')) {
  const requested = getDifficulty(params.get('difficulty'));
  if (requested && requested.id) currentDifficultyId = requested.id;
}
/** Stage config object of the run in progress (null before the first deploy). */
let currentStage = null;
/** Run-state snapshot the current stage started from (restart/inheritance). */
let stageRunState = Progress.emptyRunState(currentDifficultyId);
/** True once the stage-end snapshot has been written (guards double victory). */
let stageEndRecorded = false;

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
// Per-tier internal render scale. Tier LOWEST/LOW render below native on DPR-1
// displays (the canvas is CSS-upscaled), HIGH/ULTRA supersample on HiDPI.
const PIXEL_CAP_DESKTOP = { lowest: 0.55, low: 0.75, medium: 1.0, high: 1.65, ultra: 2.0 };
// Mobile render-scale caps: a phone at DPR 3 must not try to shade 2-3x screens.
const PIXEL_CAP_TOUCH = { lowest: 0.6, low: 0.8, medium: 1.0, high: 1.25, ultra: 1.5 };
/** Adaptive render scale (touch only): 1 = full quality cap, floor keeps the image readable. */
let adaptiveScale = 1;
const ADAPTIVE_MIN = 0.72;
/** Absolute pixel-ratio floor so the cheapest tier still renders (and stays readable). */
const PIXEL_RATIO_FLOOR = 0.5;
function basePixelRatio(q) {
  const caps = touchMode ? PIXEL_CAP_TOUCH : PIXEL_CAP_DESKTOP;
  return Math.min(window.devicePixelRatio || 1, caps[q] ?? 1.0);
}
function effectivePixelRatio(q) {
  return Math.max(PIXEL_RATIO_FLOOR, basePixelRatio(q) * adaptiveScale);
}
renderer.setPixelRatio(touchMode ? effectivePixelRatio(currentQuality) : basePixelRatio(currentQuality));
renderer.setSize(window.innerWidth, window.innerHeight, false);
// LOWEST skips the entire shadow pass; every other tier keeps the soft shadows.
renderer.shadowMap.enabled = currentQuality !== 'lowest';
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
  stageId: null,
  stageIndex: 0,
  stageTotal: STAGE_TOTAL,
  difficulty: currentDifficultyId,
};

let world = null;
let effects = null;
let enemies = null;
let weapon = null;
let player = null;
let postfx = null;
let touch = null;
let gamepad = null;
let loaded = false;
let defeated = false;
let victoryHandled = false;
let hasLockedOnce = false;
let ignoreResumeUntil = 0;
let resumeRetryTimer = 0;
let statsAccumulator = 0;
let lastFrame = performance.now();
let lowHealth = 0;
let menuAngle = 2.4;
let deathStartRoll = 0;
const renderDebug = { frames: 0, weaponRenders: 0, weaponActive: 0, errors: [] };
window.__renderDebug = renderDebug;
/** QA photo mode: render the scene straight to the canvas (no bloom/grade). */
let qaRawRender = false;
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
on('ui:start', (detail = {}) => {
  if (!loaded || game.state === 'playing') return;
  // Legacy bridge for older automation that dispatches ui:start directly after
  // the START click: continue an existing campaign, else start a new one.
  const requested = detail.difficulty ? getDifficulty(detail.difficulty) : null;
  if (progress) continueCampaign();
  else newCampaign(requested ? requested.id : currentDifficultyId);
});
on('ui:new-game', (detail = {}) => {
  if (!loaded) return;
  newCampaign(detail.difficulty || currentDifficultyId || DEFAULT_DIFFICULTY_ID);
});
on('ui:continue', () => {
  if (!loaded) return;
  continueCampaign();
});
on('ui:select-stage', (detail = {}) => {
  if (!loaded) return;
  selectStage(detail.stageId, detail.difficulty || currentDifficultyId);
});
on('ui:next-stage', () => {
  if (!loaded) return;
  nextStageRun();
});
on('ui:restart', (detail = {}) => {
  if (!loaded) return;
  if (currentStage) restartStage(detail.difficulty || currentDifficultyId);
  else if (progress) continueCampaign();
  else newCampaign(detail.difficulty || currentDifficultyId);
});
on('ui:resume', () => {
  if (game.state !== 'paused') return;
  // A resume that lands inside the pause settle window (fast START double-tap,
  // gamepad resume in the same frame as pause, ...) must not desync the UI
  // screen from the simulation: defer it instead of dropping it.
  const remaining = ignoreResumeUntil - performance.now();
  if (remaining <= 0) { resumeGame(); return; }
  if (resumeRetryTimer) clearTimeout(resumeRetryTimer);
  resumeRetryTimer = setTimeout(() => {
    resumeRetryTimer = 0;
    if (game.state === 'paused' && ui && ui.state === 'playing') resumeGame();
  }, remaining + 16);
});
on('ui:pause', () => pauseGame('ui'));
on('ui:menu', () => goMenu());
on('ui:settings', (detail = {}) => {
  if (Number.isFinite(detail.sensitivity) && player) {
    settings.sensitivity = THREE.MathUtils.clamp(detail.sensitivity, 0.25, 3.0);
    player.setSensitivity(CONFIG.player.mouseSensitivity * settings.sensitivity);
    gamepad?.setSensitivity?.(settings.sensitivity);
  }
  if (typeof detail.vibrate === 'boolean') {
    settings.vibrate = detail.vibrate;
    gamepad?.setVibrationEnabled?.(detail.vibrate);
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
  } else if (detail.kind === 'guard') {
    player?.addDamageReduction?.(detail.amount ?? CONFIG.loot?.guardReduction ?? 0.05);
  } else if (detail.kind === 'vital') {
    player?.grantMaxHealth?.(detail.amount ?? CONFIG.loot?.vitalHealthGain ?? 0.1);
  }
  emit('player:stats', buildStats());
});
// Boss weapon drop collected: equip it (or replace the active slot when full).
on('pickup:weapon', (detail = {}) => {
  if (game.state !== 'playing' || !weapon) return;
  const type = detail.type || 'vxr7';
  const result = (typeof weapon.addWeapon === 'function' ? weapon.addWeapon(type) : null) || {};
  if (result.added) {
    emit('weapon:notice', { text: `${detail.name || type} 已装备 // WEAPON ACQUIRED`, type: 'warn', kind: 'weapon' });
  } else if (result.replacedType) {
    emit('weapon:notice', { text: `武器槽已满 — 替换 ${result.replacedType} // SLOT SWAPPED`, type: 'warn', kind: 'weapon' });
  } else {
    emit('weapon:notice', { text: '已拥有该武器 // ALREADY OWNED', type: 'info', kind: 'weapon' });
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
// Controller unplugged mid-run: freeze the simulation instead of leaving the
// player standing still with no way to pause. The UI shows the warning notice.
on('gamepad:state', (detail = {}) => {
  if (detail.supported === false) return;
  if (!detail.connected && game.state === 'playing') pauseGame('gamepad');
});

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
// Campaign state transitions
// ---------------------------------------------------------------------------

/** Start a brand-new campaign: wipe the save, reload stage 1 at `difficultyId`. */
function newCampaign(difficultyId) {
  if (!loaded) return;
  const diff = getDifficulty(difficultyId);
  Progress.clearProgress();
  progress = Progress.createEmptyProgress();
  Progress.setLastDifficulty(progress, diff.id);
  const stage = getStageByIndex(1);
  if (!stage) return;
  currentDifficultyId = diff.id;
  startStage(stage.id, diff.id, Progress.stageStartState(progress, stage.id, diff.id));
}

/** CONTINUE: resume the last played / next uncleared stage with its inherited run state. */
function continueCampaign() {
  if (!loaded) return;
  if (!progress) progress = Progress.loadProgress();
  const target = Progress.continueTarget(progress);
  if (!target) {
    newCampaign(currentDifficultyId);
    return;
  }
  if (!progress) progress = Progress.createEmptyProgress();
  startStage(target.stageId, target.difficulty, target.runState);
}

/** SELECT STAGE: start an unlocked stage at the chosen difficulty. */
function selectStage(stageId, difficultyId) {
  if (!loaded) return;
  const stage = getStage(stageId) || getStageByIndex(1);
  if (!stage) return;
  const diff = getDifficulty(difficultyId);
  if (progress && progress.stages[stage.id] && !progress.stages[stage.id].unlocked) {
    emit('weapon:notice', { text: '关卡未解锁 // STAGE LOCKED', type: 'warn' });
    return;
  }
  if (!progress) progress = Progress.createEmptyProgress();
  currentDifficultyId = diff.id;
  startStage(stage.id, diff.id, Progress.stageStartState(progress, stage.id, diff.id));
}

/** Victory screen "NEXT STAGE" — advance to the unlocked next stage (inherits stats). */
function nextStageRun() {
  if (!loaded) return;
  if (!currentStage) {
    continueCampaign();
    return;
  }
  const next = nextStage(currentStage.id);
  if (!next) return;
  const diff = getDifficulty(currentDifficultyId);
  startStage(next.id, diff.id, Progress.stageStartState(progress, next.id, diff.id));
}

/** REDEPLOY / RESTART STAGE — restart the current stage from its starting snapshot. */
function restartStage(difficultyId) {
  if (!loaded || !currentStage) return;
  const diff = getDifficulty(difficultyId || currentDifficultyId);
  let run = stageRunState;
  if (!run || !run.weapons) {
    run = Progress.stageStartState(progress, currentStage.id, diff.id);
  }
  startStage(currentStage.id, diff.id, run);
}

/**
 * Enter a stage: reset the combat systems, apply the inherited run state,
 * persist the stage-start save (one of the two legal write moments) and start
 * the wave director. `runState` comes from src/save.js (inheritance/restart).
 */
function startStage(stageId, difficultyId, runState) {
  if (!loaded) return;
  const stage = getStage(stageId);
  if (!stage) return;
  const diff = getDifficulty(difficultyId);
  // Multi-map campaigns: if the stage lives on a different map than the one
  // currently built, reload the page with `?map=` so the correct world boots
  // (the boot path keeps the current stage/difficulty in the query).
  try {
    if (world && stage.mapId && world.mapId && stage.mapId !== world.mapId) {
      const query = new URLSearchParams(location.search);
      query.set('map', stage.mapId);
      query.set('stage', stage.id);
      query.set('difficulty', diff.id);
      location.search = query.toString();
      return;
    }
  } catch { /* non-fatal */ }

  currentStage = stage;
  currentDifficultyId = diff.id;
  stageRunState = Progress.sanitizeRunState({ ...(runState || {}), difficulty: diff.id });
  stageEndRecorded = false;
  game.stageId = stage.id;
  game.stageIndex = stage.index;
  game.stageTotal = STAGE_TOTAL;
  game.difficulty = diff.id;

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
  player.resetArmorCap?.(CONFIG.player.maxArmor);
  player.resetMaxHealthCap?.(CONFIG.player.maxHealth);
  player.resetDamageReduction?.();

  weapon.reset();
  weapon.resetUpgrades();
  if (weapon.importProgression) weapon.importProgression(stageRunState.weapons);
  player.applyArmorBonus?.(stageRunState.player.armorBonus, CONFIG.player.maxArmor);
  player.applyMaxHealthBonus?.(stageRunState.player.healthBonus, CONFIG.player.maxHealth);
  player.setDamageReduction?.(stageRunState.player.damageReduction);
  const hasCarry = (stageRunState.weapons.owned || []).length > 1
    || (stageRunState.player.armorBonus || 0) > 0
    || (stageRunState.player.healthBonus || 0) > 0
    || (stageRunState.player.damageReduction || 0) > 0;
  if (hasCarry) {
    emit('weapon:notice', { text: '已继承上一关装备与强化 // LOADOUT INHERITED', type: 'info' });
  }
  weapon.setActive(true);

  emit('game:stage', {
    stageId: stage.id,
    index: stage.index,
    total: STAGE_TOTAL,
    name: stage.name,
    subtitle: stage.subtitle || '',
    waveCount: stage.waveCount || (enemies?.state?.totalWaves ?? 0),
  });
  emit('game:difficulty', diff);

  if (enemies) {
    enemies.setStage?.(stage.id);
    enemies.setDifficulty?.(diff);
    enemies.reset();
    enemies.start();
  }
  camera.fov = CONFIG.renderer.fov;
  camera.updateProjectionMatrix();
  audio.setCombatIntensity?.(0.35);
  audio.startRun?.();
  emit('game:state', { state: 'playing' });
  emit('player:stats', buildStats());
  emit('score:change', { score: 0, combo: 0, multiplier: 1 });

  // ---- stage start = legal save moment #1 --------------------------------
  progress = Progress.recordStageStart(progress || Progress.createEmptyProgress(), {
    stageId: stage.id,
    difficulty: diff.id,
    run: stageRunState,
  });
  Progress.saveProgress(progress);
  try {
    // A gamepad button press is not a browser user activation, so requesting
    // pointer lock from a pad-driven start would fail; skip it when the player
    // is on a controller. Clicking the canvas later still locks the mouse.
    if (!(gamepad && gamepad.active)) player.requestPointerLock();
  } catch { /* non-fatal */ }
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
  try {
    // A gamepad button press is not a browser user activation, so requesting
    // pointer lock from a pad-driven start would fail; skip it when the player
    // is on a controller. Clicking the canvas later still locks the mouse.
    if (!(gamepad && gamepad.active)) player.requestPointerLock();
  } catch { /* non-fatal */ }
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

/** Snapshot the current run into the save-module run-state shape. */
function captureRunState() {
  const base = Progress.emptyRunState(currentDifficultyId);
  if (weapon?.exportProgression) {
    base.weapons = weapon.exportProgression();
  }
  base.player = {
    armorBonus: Math.max(0, Math.round((player?.maxArmor ?? CONFIG.player.maxArmor) - CONFIG.player.maxArmor)),
    healthBonus: Math.max(0, Math.round((player?.maxHealth ?? CONFIG.player.maxHealth) - CONFIG.player.maxHealth)),
    damageReduction: player?.damageReduction || 0,
  };
  base.score = game.score;
  base.difficulty = currentDifficultyId;
  return Progress.sanitizeRunState(base);
}

function die() {
  if (game.state !== 'playing') return;
  game.state = 'dead';
  defeated = true;
  game.deathTime = 0;
  deathStartRoll = camera.rotation.z;
  // Death is deliberately NOT a save moment: the stage-start snapshot stays as
  // it is, so REDEPLOY restarts from the state the stage was entered with.
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
  player.enabled = false;
  weapon.setActive(false);
  audio.victory?.();
  audio.setCombatIntensity?.(0.18);
  if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  emit('game:state', { state: 'victory' });
  const stats = buildRunStats();

  const next = currentStage ? nextStage(currentStage.id) : null;
  // ---- stage end = legal save moment #2 ----------------------------------
  if (currentStage && !stageEndRecorded) {
    stageEndRecorded = true;
    progress = Progress.recordStageEnd(progress || Progress.createEmptyProgress(), {
      stageId: currentStage.id,
      difficulty: currentDifficultyId,
      run: captureRunState(),
      stats,
    });
    Progress.saveProgress(progress);
  }
  emit('game:victory', {
    ...stats,
    stageId: currentStage?.id ?? null,
    stageName: currentStage?.name ?? '',
    stageIndex: currentStage?.index ?? 1,
    stageTotal: STAGE_TOTAL,
    difficulty: currentDifficultyId,
    difficultyLabel: getDifficulty(currentDifficultyId).label,
    cleared: true,
    unlockedNext: !!next,
    nextStageId: next ? next.id : null,
    campaignCleared: !next,
  });
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
    stageId: currentStage?.id ?? null,
    stageIndex: currentStage?.index ?? 1,
    stageTotal: STAGE_TOTAL,
    difficulty: currentDifficultyId,
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
    weaponType: w.weaponType || 'vxr7',
    weaponMode: w.weaponMode || 'auto',
    weaponShort: w.short || 'VXR-7',
    slotIndex: w.slotIndex ?? 0,
    ads: !!w.ads,
    sprinting: !!player?.sprinting,
    alive: !!player?.alive,
    damageMultiplier: w.damageMultiplier ?? 1,
    magExtension: w.magExtension ?? 0,
    reloadBonus: w.reloadBonus ?? 0,
    difficulty: currentDifficultyId,
    difficultyId: currentDifficultyId,
    stageId: currentStage?.id ?? null,
    stageIndex: currentStage?.index ?? 0,
    stageTotal: STAGE_TOTAL,
    stageName: currentStage?.name ?? '',
    healthBonus: Math.max(0, Math.round((player?.maxHealth ?? CONFIG.player.maxHealth) - CONFIG.player.maxHealth)),
    damageReduction: player?.damageReduction ?? 0,
  };
}

function applyQuality(quality) {
  if (!QUALITY_IDS.includes(quality)) return;
  currentQuality = quality;
  game.quality = quality;
  settings.quality = quality;
  // A manual quality change restarts adaptive scaling from the new cap.
  adaptiveScale = 1;
  // LOWEST skips the whole shadow pass — the biggest single win on weak GPUs.
  // Switching back up re-enables it and lets the world rebuild its shadow map.
  const shadows = quality !== 'lowest';
  if (renderer.shadowMap.enabled !== shadows) {
    renderer.shadowMap.enabled = shadows;
    if (shadows) renderer.shadowMap.needsUpdate = true;
  }
  postfx?.setQuality?.(quality);
  applyViewportSize();
  effects?.setQuality?.(quality);
  world?.setQuality?.(quality);
  enemies?.setQuality?.(quality);
}

// ---------------------------------------------------------------------------
// Viewport / adaptive resolution
// ---------------------------------------------------------------------------
let lastViewportWidth = 0;
let lastViewportHeight = 0;
/** Set by anything that invalidates the held canvas (resize / quality change). */
let overlayRedrawPending = true;

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
  // The held backdrop (see `canvasHeldForOverlay`) is now stale/wrong-sized:
  // draw exactly one fresh frame even if a second-level overlay is open.
  overlayRedrawPending = true;
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
/**
 * `true` while the second-level SYSTEM CONFIG overlay is open. That overlay
 * covers the viewport with a backdrop blur (`.settings-scrim` in styles.css), so
 * re-rendering the 3D scene underneath forces the compositor to blur a fresh
 * canvas every frame. Measured at 1600×900 / DPR2 / HIGH: paused frame ~25 ms
 * vs ~8.3 ms with the last frame held — at that cadence the 0.3 s overlay open
 * animation visibly stutters, which is what makes opening settings "slow".
 */
function canvasHeldForOverlay() {
  try {
    return !!(ui && typeof ui.isSettingsOpen === 'function' && ui.isSettingsOpen());
  } catch (_) {
    return false;
  }
}

function animate(now) {
  requestAnimationFrame(animate);
  if (!loaded) {
    return;
  }
  if (renderDebug.frozen) {
    // QA / photo mode: keep presenting the current frame without advancing
    // the simulation (transient VFX would otherwise smear across captures).
    lastFrame = now;
    if (qaRawRender) {
      try {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      } catch (error) { console.error('QA raw render error', error); }
    } else {
      try { postfx.render(0.016); } catch (error) { console.error('PostFX render error', error); }
      try { weapon.render(renderer); renderDebug.weaponRenders++; } catch (error) { renderDebug.errors.push(String(error)); }
    }
    renderDebug.frames++;
    return;
  }
  const rawDt = (now - lastFrame) / 1000;
  const dt = Math.min(0.05, Math.max(0, rawDt || 0.016));
  lastFrame = now;
  // SYSTEM CONFIG sits on a full-viewport backdrop blur: hold the last rendered
  // frame (and the scene state that produced it) instead of paying for a full
  // 3D + postfx render that the compositor then re-blurs every frame. The scene
  // resumes exactly where it stopped when the overlay closes.
  const holdCanvas = canvasHeldForOverlay() && !overlayRedrawPending;
  overlayRedrawPending = false;
  if (!holdCanvas) game.elapsed += dt;
  trackPerformance(rawDt);

  try {
    if (!holdCanvas) {
      world.update?.(dt, game.elapsed);
      effects.update?.(dt, game.elapsed);
    }
    // Controller polling + menu focus navigation runs in every UI state.
    gamepad?.update?.(dt);

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
      if (!holdCanvas) updateMenuCamera(dt);
      audio.setCombatIntensity?.(0.08);
    } else if (game.state === 'dead') {
      updateDeathCamera(dt);
    }

    camera.getWorldPosition(listenerPos);
    camera.getWorldDirection(listenerForward);
    audio.update?.(dt, { position: listenerPos, forward: listenerForward });
    if (!holdCanvas) postfx.update(dt);
  } catch (error) {
    console.error('Frame update error', error);
  }

  if (!holdCanvas) {
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
    const worldModule = await import('./world/index.js');
    createWorldFn = worldModule.createWorld;
    if (typeof createWorldFn !== 'function') throw new Error('world/index.js has no createWorld export yet');
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
    mapId: requestedMapId,
    onProgress: (progress, label) => {
      emit('loading:progress', {
        progress: 0.06 + THREE.MathUtils.clamp(progress, 0, 1) * 0.54,
        label: label || '构筑沙暴战区',
      });
    },
  });
  // Match the ambient audio bed to the map: desert wind for outpost-07, ocean /
  // leaf rustle / birds for the tropical island.
  try {
    audio.setWorldStyle?.(world?.style === 'island' ? 'island' : 'outpost');
  } catch (error) {
    console.warn('[SANDSTRIKE audio] world style switch skipped', error);
  }
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
    // Boss weapon drops only roll guns the player does not own yet.
    getOwnedWeapons: () => (
      weapon && typeof weapon.exportProgression === 'function'
        ? (weapon.exportProgression().owned || [])
        : ['vxr7']
    ),
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

  // Gamepad layer (Gamepad API + standard mapping; hot-pluggable). It is
  // independent of the mouse and of the touch layer: input is forwarded through
  // the pad-specific virtual API on Player plus the shared weapon setters.
  // ?gamepad=0 disables it for regression testing on a machine with a pad.
  if (detectGamepadSupport() && params.get('gamepad') !== '0') {
    try {
      gamepad = new GamepadControls({
        player,
        weapon,
        settings: {
          sensitivity: settings.sensitivity,
          vibrate: settings.vibrate !== false,
        },
      });
    } catch (error) {
      console.warn('[SANDSTRIKE] gamepad controls failed to initialise', error);
      gamepad = null;
    }
  }

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
    mapId: world.mapId ?? requestedMapId,
    mapName: world.mapName ?? null,
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

  // Deep link (also used when a multi-map campaign crosses maps): `?stage=<id>&difficulty=<id>`
  // boots straight into that stage after the menu frame has painted.
  try {
    const requestedStage = getStage(params.get('stage'));
    if (requestedStage) {
      const requestedDiff = getDifficulty(params.get('difficulty') || currentDifficultyId);
      progress = progress || Progress.loadProgress();
      setTimeout(() => {
        if (game.state !== 'menu') return;
        startStage(requestedStage.id, requestedDiff.id, Progress.stageStartState(progress, requestedStage.id, requestedDiff.id));
      }, 260);
    }
  } catch { /* non-fatal */ }

  if (isDev) {
    renderer.info.autoReset = false;
    window.__sandstrike = {
      game,
      player,
      enemies,
      weapon,
      world,
      // active map (folder under src/config/maps/), null for the dev greybox
      mapId: world.mapId ?? null,
      mapName: world.mapName ?? null,
      ui,
      audio,
      effects,
      camera,
      scene,
      renderer,
      postfx,
      touch,
      gamepad,
      // Campaign API (src/save.js + startStage above).
      save: Progress,
      get progress() { return progress; },
      get stage() { return currentStage; },
      get difficulty() { return getDifficulty(currentDifficultyId); },
      start: () => (progress ? continueCampaign() : newCampaign(currentDifficultyId)),
      newCampaign,
      continueCampaign,
      selectStage,
      nextStageRun,
      restartStage,
      startStage: (stageId = DEFAULT_STAGE_ID, difficulty = DEFAULT_DIFFICULTY_ID) => {
        startStage(stageId, difficulty, Progress.stageStartState(progress, stageId, difficulty));
      },
      forceWeapon(type = 'gatling') {
        // Convenience dev hook: add the gun if missing, then equip it (QA scripts
        // previously had to call weapon.switchWeapon() themselves).
        const result = weapon?.addWeapon?.(type) ?? null;
        if (weapon && typeof weapon.switchWeapon === 'function') weapon.switchWeapon(type);
        return result;
      },
      forceWeaponDrop(type = 'gatling') {
        enemies?.debugDropWeapon?.(type);
        return type;
      },
      spawnBoss() {
        return enemies?.debugSpawnBoss?.() ?? null;
      },
      pause: pauseGame,
      resume: resumeGame,
      menu: goMenu,
      get touchMode() { return touchMode; },
      get adaptiveScale() { return adaptiveScale; },
      setAdaptiveScale(value = 1) {
        setAdaptiveScale(THREE.MathUtils.clamp(Number(value) || 1, ADAPTIVE_MIN, 1));
        return adaptiveScale;
      },
      get quality() { return currentQuality; },
      setQuality(value) {
        applyQuality(value);
        return currentQuality;
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
          // QA hook: advance controller polling/focus so fastForward() can drive
          // stick look/movement and menu navigation deterministically.
          try { gamepad?.update?.(dt); } catch (error) { console.warn('ff gamepad', error); }
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
      /* ---- QA photo-mode helpers (model / map audits) ---- */
      THREE,
      setCamera({ pos = [0, 1.7, 0], target = [0, 1.7, -1], fov = 60, roll = 0 } = {}) {
        camera.position.set(pos[0], pos[1], pos[2]);
        camera.up.set(0, 1, 0);
        camera.lookAt(target[0], target[1], target[2]);
        camera.fov = fov;
        camera.rotation.z = roll;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        return { pos: camera.position.toArray(), fov: camera.fov };
      },
      renderFrame() {
        try {
          if (qaRawRender) {
            renderer.setRenderTarget(null);
            renderer.render(scene, camera);
          } else {
            postfx.render(0.016);
          }
        } catch (error) { console.error('QA renderFrame', error); }
        renderer.info.reset();
        renderDebug.frames++;
        return { frames: renderDebug.frames };
      },
      hideUI(hide = true) {
        const mount = document.getElementById('ui');
        const boot = document.getElementById('boot');
        if (mount) mount.style.display = hide ? 'none' : '';
        if (boot) boot.style.display = hide ? 'none' : '';
        return hide;
      },
      showUI() {
        const mount = document.getElementById('ui');
        const boot = document.getElementById('boot');
        if (mount) mount.style.display = '';
        if (boot) boot.style.display = '';
      },
      setPostfxEnabled(enabled = true) {
        qaRawRender = !enabled;
        return { postfx: !qaRawRender };
      },
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
  get gamepad() { return gamepad; },
  get adaptiveScale() { return adaptiveScale; },
  get quality() { return currentQuality; },
  get stageId() { return currentStage ? currentStage.id : null; },
  get difficulty() { return currentDifficultyId; },
};
