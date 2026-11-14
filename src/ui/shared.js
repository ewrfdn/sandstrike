/**
 * Shared constants + tiny helpers for the modular UI under `src/ui/`.
 *
 * Moved out of the old monolithic `src/ui.js`; this file owns NO DOM, NO state
 * and NO rendering — only the data tables and pure helpers every panel shares.
 *
 * Module map (see `.scratch/ui-refactor-contract.md` for the full contract):
 *   index.js      UI core: lifecycle, state machine, settings store, actions, loop
 *   shared.js     this file
 *   hud.js        combat HUD (vitals / ammo / wave / radar / feedback)
 *   home.js       loading screen + main menu
 *   settings.js   secondary "SYSTEM CONFIG" overlay (settings + controls legend)
 *   overlays.js   pause / death / victory / deploy
 *   perf.js       frame counter meter
 */
import { on } from '../bus.js';

// --- persistence / validation keys -----------------------------------------
export const SETTINGS_KEY = 'sandstrike.settings.v1';
export const BEST_KEY = 'sandstrike.best.v1';
export const QUALITIES = ['lowest', 'low', 'medium', 'high', 'ultra'];
export const VALID_STATES = new Set(['menu', 'playing', 'paused', 'dead', 'victory']);

// --- math / formatting ------------------------------------------------------
export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
export const clamp01 = (value) => clamp(Number(value) || 0, 0, 1);
export const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
export const rand = (low, high) => low + Math.random() * (high - low);
export const pad2 = (value) => String(Math.max(0, Math.floor(value))).padStart(2, '0');
export const fmtScore = (value) => String(Math.max(0, Math.round(num(value, 0)))).padStart(6, '0');
export const fmtTime = (value) => {
  const total = Math.max(0, Math.floor(num(value, 0)));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}:${pad2(minutes % 60)}:${pad2(seconds)}`;
  return `${pad2(minutes)}:${pad2(seconds)}`;
};

// --- localStorage -----------------------------------------------------------
export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* private mode / quota — settings simply won't persist */
  }
}

// --- loading tips -----------------------------------------------------------
export const TIPS = [
  {
    en: 'Headshots deal 2.3× damage. Aim for the glowing sensor core.',
    cn: '爆头造成 2.3 倍伤害，瞄准发光传感器核心。',
  },
  {
    en: 'Reload behind cover. The VXR-7 holds 30 rounds.',
    cn: '在掩体后换弹，VXR-7 弹匣容量 30 发。',
  },
  {
    en: 'Listen for the telegraph whine before a robot fires.',
    cn: '开火前机器人会发出预警蜂鸣，注意聆听。',
  },
  {
    en: 'Chain kills quickly to raise your score multiplier.',
    cn: '快速连续击杀可提高得分倍率。',
  },
  {
    en: 'Use A-long and B-tunnel to flank entrenched heavies.',
    cn: '利用 A 大通道和 B 隧道包抄重装单位。',
  },
  {
    en: 'Between waves, count your ammo and re-position.',
    cn: '波次间歇时检查弹药并重新选位。',
  },
];

// --- control legend tables --------------------------------------------------
export const CONTROLS = [
  { keys: ['W', 'A', 'S', 'D'], en: 'MOVE', cn: '移动' },
  { keys: ['MOUSE'], en: 'LOOK', cn: '视角' },
  { keys: ['LMB'], en: 'FIRE', cn: '射击' },
  { keys: ['RMB'], en: 'ADS', cn: '机瞄' },
  { keys: ['R'], en: 'RELOAD', cn: '换弹' },
  { keys: ['SHIFT'], en: 'SPRINT', cn: '冲刺' },
  { keys: ['SPACE'], en: 'JUMP', cn: '跳跃' },
  { keys: ['C'], en: 'CROUCH', cn: '蹲伏' },
  { keys: ['ESC'], en: 'PAUSE', cn: '暂停' },
];

/**
 * Touch control legend (MOBILE_SPEC.md §7). Rendered instead of CONTROLS when the
 * document carries `html.is-touch` at build time; the rows mirror the touch layer
 * from src/touch.js so the menu never advertises a keyboard on a phone.
 */
export const TOUCH_CONTROLS = [
  { glyph: '◉', en: 'LEFT STICK', cn: '移动' },
  { glyph: '↔', en: 'DRAG', cn: '视角' },
  { glyph: '◎', en: 'FIRE', cn: '开火' },
  { glyph: '+', en: 'ADS', cn: '机瞄' },
  { glyph: '⟲', en: 'RELOAD', cn: '换弹' },
  { glyph: '⌃', en: 'JUMP', cn: '跳跃' },
  { glyph: '⌄', en: 'CROUCH', cn: '蹲伏' },
  { glyph: 'II', en: 'PAUSE', cn: '暂停' },
];

/**
 * Gamepad control legend (GAMEPAD_SPEC.md §6.2). Rendered instead of CONTROLS
 * when a pad is connected; `html.is-touch` still wins on phones/tablets so the
 * mobile legend keeps priority. Glyphs differ per controller family: Xbox is
 * the default, PlayStation and Switch get their native labels.
 */
export const PAD_CONTROLS = [
  { slot: 'move', en: 'MOVE', cn: '移动' },
  { slot: 'look', en: 'LOOK', cn: '视角' },
  { slot: 'fire', en: 'FIRE', cn: '射击' },
  { slot: 'ads', en: 'ADS', cn: '机瞄' },
  { slot: 'reload', en: 'RELOAD', cn: '换弹' },
  { slot: 'sprint', en: 'SPRINT', cn: '冲刺' },
  { slot: 'jump', en: 'JUMP', cn: '跳跃' },
  { slot: 'crouch', en: 'CROUCH', cn: '蹲伏' },
  { slot: 'pause', en: 'PAUSE', cn: '暂停' },
  { slot: 'menus', en: 'MENUS', cn: '菜单导航' },
];

export const PAD_GLYPHS = {
  xbox: {
    move: ['LSTICK'], look: ['RSTICK'], fire: ['RT'], ads: ['LT'], reload: ['X'],
    sprint: ['LB/L3'], jump: ['A'], crouch: ['B'], pause: ['START'], menus: ['D-PAD'],
  },
  playstation: {
    move: ['LSTICK'], look: ['RSTICK'], fire: ['R2'], ads: ['L2'], reload: ['□'],
    sprint: ['L1/L3'], jump: ['✕'], crouch: ['○'], pause: ['OPTIONS'], menus: ['D-PAD'],
  },
  // Standard mapping is positional: index 0 is the bottom face button (B on a
  // Switch pad, A on Xbox), so the labels shift with the hardware family.
  switch: {
    move: ['LSTICK'], look: ['RSTICK'], fire: ['ZR'], ads: ['ZL'], reload: ['Y'],
    sprint: ['L/L3'], jump: ['B'], crouch: ['A'], pause: ['+'], menus: ['D-PAD'],
  },
  generic: {
    move: ['LSTICK'], look: ['RSTICK'], fire: ['RT'], ads: ['LT'], reload: ['X'],
    sprint: ['LB/L3'], jump: ['A'], crouch: ['B'], pause: ['START'], menus: ['D-PAD'],
  },
};

export const padGlyphsFor = (kind) => PAD_GLYPHS[kind] || PAD_GLYPHS.xbox;

/** Contextual key hints swapped in while a pad is connected (§6.3). */
export const HINTS_KEYBOARD = {
  menuStart: 'ENTER',
  resume: 'ESC',
  redeploy: 'ENTER',
  pauseFoot: 'ESC TO RESUME · 按 ESC 继续',
  ammo: 'R — RELOAD <em>换弹</em> · 1-4 — SWITCH <em>切枪</em>',
};
export const HINTS_GAMEPAD = {
  menuStart: 'A',
  resume: 'START',
  redeploy: 'A',
  pauseFoot: 'START TO RESUME · 按 START 继续',
  ammo: 'X — RELOAD <em>换弹</em> · RB — SWITCH <em>切枪</em>',
};

// --- campaign formatting helpers -------------------------------------------
/** "01/01" style stage counter. */
export const fmtStageCounter = (index, total) => `${pad2(index || 1)}/${pad2(total || 1)}`;

/** Difficulty tone → the CSS modifier appended to badges (safe fallback). */
export const DIFF_TONES = ['easy', 'normal', 'hard', 'nightmare'];
export const diffTone = (tone) => (DIFF_TONES.includes(tone) ? tone : 'normal');

/** Difficulty multiplier text: 0.75 → "0.75", 1 → "1.0", 4 → "4.0". */
export function fmtMul(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '1.0';
  const out = n.toFixed(2).replace(/0+$/, '');
  return out.endsWith('.') ? `${out}0` : out;
}

/** Weapon fire mode → short HUD label. */
export const WEAPON_MODE_LABELS = {
  auto: 'AUTO',
  rocket: 'ROCKET',
  spinup: 'SPIN-UP',
  pump: 'PUMP',
};
export const weaponModeLabel = (mode) => WEAPON_MODE_LABELS[mode] || String(mode || 'AUTO').toUpperCase();

// --- end-of-run stat rows ---------------------------------------------------
export const STAT_ROWS = [
  { key: 'score', en: 'SCORE', cn: '得分' },
  { key: 'wave', en: 'WAVE REACHED', cn: '到达波次' },
  { key: 'kills', en: 'KILLS', cn: '击杀' },
  { key: 'accuracy', en: 'ACCURACY', cn: '命中率' },
  { key: 'time', en: 'DURATION', cn: '用时' },
  { key: 'combo', en: 'BEST COMBO', cn: '最高连杀' },
];

// --- Frame counter (FPS) ------------------------------------------------------
// Sampling piggybacks on the existing UI rAF loop; only the *display* is
// rate-limited (text <= 8 Hz, graph <= 15 Hz), so the meter costs next to
// nothing. Stats cover a ~500 ms rolling window of raw, unclamped frame deltas.
export const PERF_CAPACITY = 128;      // ring buffer of raw frame intervals
export const PERF_WINDOW_MS = 500;     // rolling stats window
export const PERF_MIN_SAMPLES = 4;     // below this the readout shows "--"
export const PERF_TEXT_MS = 125;       // DOM text refresh: 8 Hz max
export const PERF_GRAPH_MS = 70;       // canvas repaint: ~14.3 Hz max
export const PERF_GRAPH_BARS = 72;     // intervals drawn in the sparkline
export const PERF_GRAPH_MAX_MS = 50;   // bar height is clamped to 0..50 ms
export const PERF_GOOD_FPS = 55;
export const PERF_FAIR_FPS = 40;
export const PERF_COLORS = {
  good: { bar: 'rgba(141, 255, 201, 0.9)' },
  fair: { bar: 'rgba(255, 196, 119, 0.9)' },
  low: { bar: 'rgba(255, 74, 52, 0.92)' },
};
export const perfLevel = (fps) => (fps >= PERF_GOOD_FPS ? 'good' : fps >= PERF_FAIR_FPS ? 'fair' : 'low');

// --- DOM query helpers ------------------------------------------------------
export const q = (scope, selector) => (scope ? scope.querySelector(selector) : null);
export const qa = (scope, selector) => (scope ? Array.from(scope.querySelectorAll(selector)) : []);

/**
 * Subscribe a panel to a map of bus events with per-event error isolation.
 * `owner.ui` must expose `disposed`; the returned function unsubscribes all.
 */
export function bindBus(owner, handlers) {
  const offs = [];
  for (const type in handlers) {
    offs.push(on(type, (detail) => {
      const ui = owner.ui;
      if (!ui || ui.disposed) return;
      try {
        handlers[type](detail || {});
      } catch (error) {
        console.warn(`[SANDSTRIKE ui] ${type} handler failed:`, error);
      }
    }));
  }
  return () => {
    for (const off of offs) {
      try { off(); } catch (_) { /* ignore */ }
    }
    offs.length = 0;
  };
}
