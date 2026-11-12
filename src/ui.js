/**
 * SANDSTRIKE // 沙暴协议 — Tactical UI
 * ---------------------------------------------------------------------------
 * Owns every pixel of DOM inside #ui. Three.js renders behind it on #scene, so
 * the HUD is built on opaque-enough dark glass plates with text shadows and is
 * tuned to stay legible over bright sand.
 *
 * Screens: loading -> menu -> playing (HUD) -> pause / dead / victory
 * Emits:   ui:start, ui:resume, ui:restart, ui:pause, ui:menu, ui:settings
 * Listens: every Game -> UI event in TEAM_SPEC.md
 */

import { emit, on } from './bus.js';

const SETTINGS_KEY = 'sandstrike.settings.v1';
const BEST_KEY = 'sandstrike.best.v1';
const QUALITIES = ['medium', 'high', 'ultra'];
const VALID_STATES = new Set(['menu', 'playing', 'paused', 'dead', 'victory']);

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const clamp01 = (value) => clamp(Number(value) || 0, 0, 1);
const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const rand = (low, high) => low + Math.random() * (high - low);
const pad2 = (value) => String(Math.max(0, Math.floor(value))).padStart(2, '0');
const fmtScore = (value) => String(Math.max(0, Math.round(num(value, 0)))).padStart(6, '0');
const fmtTime = (value) => {
  const total = Math.max(0, Math.floor(num(value, 0)));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}:${pad2(minutes % 60)}:${pad2(seconds)}`;
  return `${pad2(minutes)}:${pad2(seconds)}`;
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* private mode / quota — settings simply won't persist */
  }
}

const TIPS = [
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

const CONTROLS = [
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
const TOUCH_CONTROLS = [
  { glyph: '◉', en: 'LEFT STICK', cn: '移动' },
  { glyph: '↔', en: 'DRAG', cn: '视角' },
  { glyph: '◎', en: 'FIRE', cn: '开火' },
  { glyph: '+', en: 'ADS', cn: '机瞄' },
  { glyph: '⟲', en: 'RELOAD', cn: '换弹' },
  { glyph: '⌃', en: 'JUMP', cn: '跳跃' },
  { glyph: '⌄', en: 'CROUCH', cn: '蹲伏' },
  { glyph: 'II', en: 'PAUSE', cn: '暂停' },
];

const STAT_ROWS = [
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
const PERF_CAPACITY = 128;      // ring buffer of raw frame intervals
const PERF_WINDOW_MS = 500;     // rolling stats window
const PERF_MIN_SAMPLES = 4;     // below this the readout shows "--"
const PERF_TEXT_MS = 125;       // DOM text refresh: 8 Hz max
const PERF_GRAPH_MS = 70;       // canvas repaint: ~14.3 Hz max
const PERF_GRAPH_BARS = 72;     // intervals drawn in the sparkline
const PERF_GRAPH_MAX_MS = 50;   // bar height is clamped to 0..50 ms
const PERF_GOOD_FPS = 55;
const PERF_FAIR_FPS = 40;
const PERF_COLORS = {
  good: { bar: 'rgba(141, 255, 201, 0.9)' },
  fair: { bar: 'rgba(255, 196, 119, 0.9)' },
  low: { bar: 'rgba(255, 74, 52, 0.92)' },
};
const perfLevel = (fps) => (fps >= PERF_GOOD_FPS ? 'good' : fps >= PERF_FAIR_FPS ? 'fair' : 'low');

function settingsMarkup(scope) {
  return `
    <div class="panel-head">
      <span class="panel-kicker">SYSTEM CONFIG</span><em>系统设置</em>
      <span class="panel-corner"></span>
    </div>
    <div class="set-row">
      <label class="set-label" for="sens-${scope}">SENSITIVITY <em>灵敏度</em></label>
      <div class="set-control">
        <input id="sens-${scope}" type="range" min="0.25" max="3" step="0.05" value="1" data-set="sensitivity" aria-label="Mouse sensitivity" />
        <span class="set-value" data-value="sensitivity">1.00</span>
      </div>
    </div>
    <div class="set-row">
      <label class="set-label" for="vol-${scope}">MASTER VOLUME <em>音量</em></label>
      <div class="set-control">
        <input id="vol-${scope}" type="range" min="0" max="100" step="1" value="80" data-set="volume" aria-label="Master volume" />
        <span class="set-value" data-value="volume">80</span>
      </div>
    </div>
    <div class="set-row">
      <span class="set-label">RENDER QUALITY <em>画质</em></span>
      <div class="set-quality" data-quality role="group" aria-label="Render quality">
        <button type="button" data-quality-value="medium">MED</button>
        <button type="button" data-quality-value="high">HIGH</button>
        <button type="button" data-quality-value="ultra">ULTRA</button>
      </div>
    </div>
    <div class="set-row set-row--toggle">
      <span class="set-label">FRAME COUNTER <em>帧率显示</em></span>
      <button type="button" class="set-toggle" data-action="fps" aria-pressed="true">
        <span class="toggle-dot"></span><span data-fps-label>VISIBLE</span>
      </button>
    </div>
    <div class="set-row set-row--toggle">
      <span class="set-label">FULLSCREEN <em>全屏</em></span>
      <button type="button" class="set-toggle" data-action="fullscreen" aria-pressed="false">
        <span class="toggle-dot"></span><span data-fullscreen-label>OFF</span>
      </button>
    </div>
    <div class="set-row set-row--mute">
      <span class="set-label">AUDIO OUTPUT <em>音频输出</em></span>
      <button type="button" class="set-toggle" data-action="mute" aria-pressed="false">
        <span class="toggle-dot"></span><span data-mute-label>ENABLED</span>
      </button>
    </div>
    <div class="set-foot"><span>SETTINGS SAVE AUTOMATICALLY</span><em>设置自动保存</em></div>
  `;
}

export class UI {
  constructor({ audio = null, quality = 'high' } = {}) {
    this.audio = audio || null;
    this.disposed = false;
    this.built = false;
    this.ready = false;
    this.state = 'loading';
    this.root = null;
    this.el = null;
    this.refs = {};
    this.settings = this._loadSettings(quality);
    this.best = Math.max(0, num((loadJSON(BEST_KEY, {}) || {}).score, 0));

    this._offs = [];
    this._timers = new Set();
    this._raf = 0;
    this._lastFrame = 0;
    this._tickBound = (now) => this._tick(now);
    this._audioUnlockTried = false;
    this._lastHoverAt = 0;
    this._runTime = 0;
    this._shake = 0;
    this._wasShaking = false;
    this._lastRadarDraw = 0;
    this._lastClock = 0;
    this._tipIndex = Math.floor(Math.random() * TIPS.length);
    this._lastTipAt = 0;
    this._endTimer = 0;
    this._endVisible = false;
    this._pendingEnd = null;
    this._bannerTimer = 0;
    this._arcEls = [];
    this._arcIndex = 0;
    this._feedTimers = new Set();
    this._intermissionMax = 6;
    this._intermissionNext = 2;
    this._prevMag = null;
    this._wasPlaying = false;

    // Frame counter sampling state (see _samplePerf / _computePerf).
    this.perf = { fps: 0, frameMs: 0, worstMs: 0, samples: 0, level: 'low' };
    this._perfLast = 0;
    this._perfHead = 0;
    this._perfCount = 0;
    this._perfTotal = 0;
    this._perfStamps = new Float64Array(PERF_CAPACITY);
    this._perfIntervals = new Float32Array(PERF_CAPACITY);
    this._perfLastTextAt = 0;
    this._perfLastGraphAt = 0;
    this._perfCtx = null;
    this._perfHasReading = false;

    // Fullscreen toggle state (browser-session only — never persisted).
    this._fsPending = false;
    this._fsHandler = null;

    this._data = {
      loading: { progress: 0, label: 'INITIALIZING RENDERER' },
      stats: {
        health: 100, maxHealth: 100, armor: 100, maxArmor: 100,
        mag: 30, magSize: 30, reserve: 300, reloading: false, reloadProgress: 0,
        weaponName: 'VXR-7 突击步枪', ads: false, sprinting: false, alive: true,
        damageMultiplier: 1, magExtension: 0, reloadBonus: 0,
        damageReduction: 0, healthBonus: 0,
      },
      wave: { current: 1, total: 15, remaining: 0, label: '', count: 0, initialCount: 0, killed: 0, cleared: 0 },
      score: { score: 0, combo: 0, multiplier: 1 },
      kills: 0,
      radar: {
        player: { x: 0, z: 0, yaw: 0 },
        enemies: [],
        bounds: null,
        range: 42,
        landmarks: [],
      },
      end: null,
      worldReady: false,
    };

    this._applyAudioSettings();
    this._bindBus();
    this._bindGlobals();

    const boot = () => {
      if (this.disposed) return;
      try {
        this._build();
        this._bindDom();
        this._syncAll();
        this._setScreen(this.state);
        this._startLoop();
        if (typeof document !== 'undefined' && document.body) {
          document.body.classList.add('ui-ready');
        }
        if (this.ready) {
          this.root.classList.add('is-ready');
          this._setStartEnabled(true);
          if (this.state === 'loading') {
            this._later(() => {
              if (this.state === 'loading') this._setScreen('menu');
            }, 500);
          }
        }
        try {
          if (/[?&]dev=1/.test(location.search)) window.__devUI = this;
        } catch (_) { /* ignore */ }
      } catch (error) {
        console.error('[SANDSTRIKE ui] failed to build:', error);
      }
    };

    if (typeof document !== 'undefined') {
      if (document.body) boot();
      else document.addEventListener('DOMContentLoaded', boot, { once: true });
    }
  }

  // =========================================================================
  // Settings
  // =========================================================================

  _loadSettings(quality) {
    const stored = loadJSON(SETTINGS_KEY, {}) || {};
    const fallbackQuality = QUALITIES.includes(quality) ? quality : 'high';
    const storedQuality = QUALITIES.includes(stored.quality) ? stored.quality : fallbackQuality;
    return {
      sensitivity: clamp(num(stored.sensitivity, 1), 0.25, 3),
      volume: clamp(num(stored.volume, 0.8), 0, 1),
      quality: storedQuality,
      muted: !!stored.muted,
      showFps: stored.showFps !== false,
      difficulty: stored.difficulty === 'hardcore' ? 'hardcore' : 'standard',
    };
  }

  _saveSettings() {
    saveJSON(SETTINGS_KEY, {
      sensitivity: this.settings.sensitivity,
      volume: this.settings.volume,
      quality: this.settings.quality,
      muted: this.settings.muted,
      showFps: !!this.settings.showFps,
      difficulty: this.settings.difficulty,
    });
  }

  _applyAudioSettings() {
    if (!this.audio) return;
    try {
      this.audio.setVolume(this.settings.muted ? 0 : this.settings.volume);
      if (typeof this.audio.setMuted === 'function') this.audio.setMuted(this.settings.muted);
    } catch (_) { /* audio is decorative */ }
  }

  _emitSettings() {
    if (this.settings.muted) {
      // Muted means effective volume 0, but we still expose the raw handle so
      // the game can restore it if it persists settings itself.
      emit('ui:settings', {
        sensitivity: this.settings.sensitivity,
        volume: 0,
        volumeRaw: this.settings.volume,
        quality: this.settings.quality,
        muted: true,
        difficulty: this.settings.difficulty,
        showFps: !!this.settings.showFps,
      });
    } else {
      emit('ui:settings', {
        sensitivity: this.settings.sensitivity,
        volume: this.settings.volume,
        volumeRaw: this.settings.volume,
        quality: this.settings.quality,
        muted: false,
        difficulty: this.settings.difficulty,
        showFps: !!this.settings.showFps,
      });
    }
  }

  setQuality(quality) {
    if (!QUALITIES.includes(quality)) return;
    this.settings.quality = quality;
    this._saveSettings();
    if (this.built) this._syncSettingsInputs();
  }

  /** Public hook (QA / console): show or hide the frame counter, persisted. */
  setShowFps(enabled) {
    this._setShowFps(enabled !== false);
    return this.settings.showFps;
  }

  get showFps() {
    return !!this.settings.showFps;
  }

  _setShowFps(flag) {
    this.settings.showFps = !!flag;
    this._saveSettings();
    if (!this.built) return;
    this._applyFpsVisibility();
    this._syncSettingsInputs();
  }

  _applyFpsVisibility() {
    if (!this.built || !this.root) return;
    const visible = !!this.settings.showFps;
    this.root.classList.toggle('is-fps-off', !visible);
    if (!visible) return;
    // Freshly re-enabled: repaint right away instead of waiting for the next
    // rate-limited refresh slot.
    this._perfLastTextAt = 0;
    this._perfLastGraphAt = 0;
    this._renderPerf();
  }

  // --- Fullscreen (browser session state; intentionally NOT persisted) -----

  _toggleFullscreen() {
    if (this.disposed) return;
    const doc = document;
    if (doc.fullscreenEnabled === false) {
      if (this.built) this._notice({ text: '当前环境不支持全屏 // FULLSCREEN UNSUPPORTED', type: 'warn' });
      this._syncFullscreenInputs();
      return;
    }
    if (this._fsPending) return;
    this._fsPending = true;
    const finish = () => {
      this._fsPending = false;
      this._syncFullscreenInputs();
    };
    const fail = () => {
      finish();
      if (this.built) this._notice({ text: '全屏请求被浏览器拒绝 // FULLSCREEN DENIED', type: 'warn' });
    };
    let request;
    try {
      request = doc.fullscreenElement
        ? doc.exitFullscreen()
        : doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch (_) {
      fail();
      return;
    }
    if (request && typeof request.then === 'function') request.then(finish, fail);
    else finish();
  }

  _syncFullscreenInputs() {
    if (!this.built) return;
    const supported = document.fullscreenEnabled !== false;
    const active = supported && !!document.fullscreenElement;
    const label = supported ? (active ? 'ON' : 'OFF') : 'N/A';
    const title = supported
      ? (active ? '退出全屏 // Exit fullscreen' : '进入全屏 // Enter fullscreen')
      : '当前浏览器/环境不支持全屏 // Fullscreen unavailable';
    for (const button of this.refs.fullscreenToggles || []) {
      button.classList.toggle('is-on', active);
      button.classList.toggle('is-idle', !active && supported);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = !supported;
      button.title = title;
    }
    for (const el of this.refs.fullscreenLabels || []) el.textContent = label;
  }

  _setSensitivity(value) {
    this.settings.sensitivity = clamp(num(value, 1), 0.25, 3);
    this._saveSettings();
    if (this.built) this._syncSettingsInputs();
    this._emitSettings();
  }

  _setVolume(value) {
    this.settings.volume = clamp(num(value, 0), 0, 1);
    this._saveSettings();
    this._applyAudioSettings();
    if (this.built) this._syncSettingsInputs();
    this._emitSettings();
  }

  _setMuted(flag) {
    this.settings.muted = !!flag;
    this._saveSettings();
    this._applyAudioSettings();
    if (this.built) this._syncSettingsInputs();
    this._emitSettings();
  }

  _setQuality(quality) {
    if (!QUALITIES.includes(quality)) return;
    this.settings.quality = quality;
    this._saveSettings();
    this._syncSettingsInputs();
    this._emitSettings();
  }

  _setDifficulty(difficulty) {
    if (difficulty !== 'standard' && difficulty !== 'hardcore') return;
    this.settings.difficulty = difficulty;
    this._saveSettings();
    this._syncSettingsInputs();
    this._emitSettings();
  }

  _syncSettingsInputs() {
    if (!this.built) return;
    const { settings } = this;
    for (const input of this.refs.setInputs) {
      const key = input.dataset.set;
      if (key === 'sensitivity') input.value = String(settings.sensitivity);
      else if (key === 'volume') input.value = String(Math.round(settings.volume * 100));
    }
    for (const label of this.refs.setValues) {
      const key = label.dataset.value;
      if (key === 'sensitivity') label.textContent = settings.sensitivity.toFixed(2);
      else if (key === 'volume') label.textContent = String(Math.round(settings.volume * 100));
    }
    for (const button of this.refs.qualityButtons) {
      const active = button.dataset.qualityValue === settings.quality;
      button.classList.toggle('is-on', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const button of this.refs.difficultyButtons || []) {
      const active = button.dataset.difficultyValue === settings.difficulty;
      button.classList.toggle('is-on', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const label of this.refs.muteLabels) label.textContent = settings.muted ? 'MUTED' : 'ENABLED';
    for (const toggle of this.refs.muteToggles) {
      toggle.classList.toggle('is-muted', settings.muted);
      toggle.setAttribute('aria-pressed', String(settings.muted));
    }
    for (const label of this.refs.fpsLabels || []) label.textContent = settings.showFps ? 'VISIBLE' : 'HIDDEN';
    for (const toggle of this.refs.fpsToggles || []) {
      toggle.classList.toggle('is-off', !settings.showFps);
      toggle.setAttribute('aria-pressed', String(settings.showFps));
    }
  }

  // =========================================================================
  // DOM construction
  // =========================================================================

  _build() {
    if (this.built || this.disposed) return;
    let root = document.getElementById('ui');
    if (!root) {
      root = document.createElement('div');
      root.id = 'ui';
      this._ownsRoot = true;
      (document.body || document.documentElement).appendChild(root);
    }
    this.root = root;
    root.classList.add('ui-root');
    root.setAttribute('data-screen', 'loading');
    root.style.setProperty('--quality', this.settings.quality);
    root.style.setProperty('--sens', String(this.settings.sensitivity));
    root.style.setProperty('--vol', String(this.settings.volume));

    // Evaluate the touch flag exactly once per build (MOBILE_SPEC.md §7): main.js
    // sets `html.is-touch` before the UI is constructed, so desktop markup stays
    // byte-identical while touch devices get stick/drag/button rows.
    const touchLegend = document.documentElement.classList.contains('is-touch');
    const controls = (touchLegend
      ? TOUCH_CONTROLS.map((row) => `
      <li class="ctrl-row ctrl-row--touch">
        <span class="keys"><span class="ctrl-badge" aria-hidden="true">${row.glyph}</span></span>
        <span class="ctrl">${row.en} <em>${row.cn}</em></span>
      </li>`)
      : CONTROLS.map((row) => `
      <li>
        <span class="keys">${row.keys.map((key) => `<kbd>${key}</kbd>`).join('')}</span>
        <span class="ctrl">${row.en} <em>${row.cn}</em></span>
      </li>`)).join('');

    const statsMarkup = STAT_ROWS.map((row) => `
      <div class="stat">
        <span class="stat-k">${row.en} <em>${row.cn}</em></span>
        <b data-stat="${row.key}">—</b>
      </div>`).join('');

    const shell = document.createElement('div');
    shell.className = 'ui-shell';
    shell.innerHTML = `
      <div class="ui-fx" aria-hidden="true">
        <div class="fx-vignette"></div>
        <div class="fx-scanlines"></div>
        <div class="fx-grain"></div>
        <div class="fx-heat"></div>
        <div class="fx-letterbox fx-letterbox--top"></div>
        <div class="fx-letterbox fx-letterbox--bottom"></div>
        <div class="fx-flash" data-flash></div>
        <div class="fx-low-health" data-low-health></div>
        <div class="fx-arcs" data-arcs></div>
      </div>

      <div class="hud" data-hud aria-hidden="true">
        <div class="hud-corner hud-corner--tl"></div>
        <div class="hud-corner hud-corner--tr"></div>
        <div class="hud-corner hud-corner--bl"></div>
        <div class="hud-corner hud-corner--br"></div>

        <div class="hud-top-center">
          <div class="wave-panel">
            <div class="wave-kicker">
              <span class="dot"></span> ASSAULT WAVE <em>进攻波次</em>
              <span class="wave-mode" data-wave-mode>STANDARD</span>
              <span class="wave-state" data-wave-state>STANDBY</span>
            </div>
            <div class="wave-row">
              <span class="wave-current" data-wave-current>01</span>
              <span class="wave-slash">/</span>
              <span class="wave-total" data-wave-total>05</span>
              <span class="wave-divider"></span>
              <span class="wave-hostiles"><span class="wh-k">HOSTILES</span><span class="wh-v" data-wave-remaining>00</span></span>
            </div>
            <div class="wave-pips" data-wave-pips></div>
          </div>
        </div>

        <div class="hud-top-left">
          <div class="obj-panel">
            <div class="obj-kicker">PRIMARY OBJECTIVE // 主要目标</div>
            <div class="obj-text">ELIMINATE HOSTILES <em>歼灭全部敌方单位</em></div>
            <div class="obj-track"><i data-objective-fill></i><b data-objective-wave>WAVE 01</b></div>
          </div>
          <div class="score-panel">
            <div class="score-top">
              <span class="score-kicker">SCORE // 得分</span>
              <span class="score-best">BEST <b data-best>000000</b></span>
            </div>
            <div class="score-value" data-score>000000</div>
            <div class="score-meta">
              <span class="combo" data-combo>×1.0</span>
              <span class="multi">MULTIPLIER</span>
              <span class="kills">KILLS <b data-kills>0</b></span>
            </div>
          </div>
        </div>

        <div class="hud-top-right">
          <div class="radar-panel">
            <div class="radar-head">
              <span class="radar-kicker">RECON</span><em>侦察</em>
              <span class="radar-mode"><i></i>LIVE</span>
            </div>
            <div class="radar-screen">
              <canvas class="radar-canvas" width="512" height="512" aria-hidden="true"></canvas>
              <div class="radar-brackets"></div>
              <span class="radar-bearing" data-bearing>000°</span>
            </div>
            <div class="radar-foot">
              <span data-radar-hostiles>04</span><span class="rf-k">HOSTILES</span>
              <span class="rf-sep"></span><span class="rf-k">RANGE</span><span data-radar-range>42M</span>
            </div>
          </div>
          <div class="perf-panel" data-perf aria-hidden="true">
            <div class="perf-head">
              <span class="perf-kicker">FRAME <i>//</i> <em>帧率</em></span>
              <span class="perf-state" data-perf-state>SYNC</span>
            </div>
            <div class="perf-row">
              <span class="perf-fps" data-fps>--</span>
              <span class="perf-unit">FPS</span>
              <span class="perf-ms"><b data-frametime>--</b> MS</span>
            </div>
            <canvas class="perf-graph" data-perf-graph width="244" height="46" aria-hidden="true"></canvas>
          </div>
          <div class="killfeed" data-killfeed aria-live="polite"></div>
        </div>

        <div class="hud-bottom-left">
          <div class="vitals-panel">
            <div class="vital">
              <div class="vital-head">
                <span class="vital-ico">✚</span><span class="vital-name">VITALS</span><em>生命</em>
                <span class="vital-num" data-health>100</span><span class="vital-max" data-health-max>/100</span>
              </div>
              <div class="vital-seg" data-health-seg></div>
            </div>
            <div class="vital vital--armor">
              <div class="vital-head">
                <span class="vital-ico">◈</span><span class="vital-name">ARMOR</span><em>护甲</em>
                <span class="vital-num" data-armor>100</span><span class="vital-max" data-armor-max>/100</span>
              </div>
              <div class="vital-seg" data-armor-seg></div>
            </div>
            <div class="vital-status"><span class="status-dot"></span><span data-health-state>COMBAT READY</span><em>状态正常</em></div>
            <div class="vital-buffs" data-vital-buffs></div>
          </div>
        </div>

        <div class="hud-bottom-right">
          <div class="ammo-panel">
            <div class="ammo-head">
              <span class="ammo-weapon" data-weapon-name>VXR-7 突击步枪</span>
              <span class="ammo-mode">AUTO</span>
            </div>
            <div class="ammo-readout">
              <span class="ammo-mag" data-mag>30</span>
              <span class="ammo-div">/</span>
              <span class="ammo-reserve" data-reserve>300</span>
            </div>
            <div class="ammo-ticks" data-mag-ticks></div>
            <div class="ammo-loot" data-ammo-loot></div>
            <div class="ammo-reload" data-reload>
              <div class="reload-track"><i data-reload-fill></i></div>
              <span class="reload-text">RELOADING <em>换弹中</em></span>
            </div>
            <div class="ammo-hint">R — RELOAD <em>换弹</em></div>
          </div>
        </div>

        <div class="crosshair" data-crosshair aria-hidden="true">
          <i class="ch-dot"></i>
          <i class="ch-line ch-t"></i><i class="ch-line ch-b"></i>
          <i class="ch-line ch-l"></i><i class="ch-line ch-r"></i>
          <i class="ch-ring"></i>
          <div class="ch-hitmarker" data-hitmarker><i></i><i></i><i></i><i></i></div>
        </div>

        <div class="score-pops" data-score-pops></div>
        <div class="notices" data-notices></div>
        <div class="wave-banner" data-banner>
          <div class="banner-kicker" data-banner-kicker>WAVE INBOUND</div>
          <div class="banner-title" data-banner-title>WAVE 01</div>
          <div class="banner-sub" data-banner-sub>HOSTILES: 04 // 敌军接近</div>
        </div>
        <div class="intermission" data-intermission>
          <div class="int-kicker">NEXT WAVE IN <em>下一波</em></div>
          <div class="int-time" data-int-time>06</div>
          <div class="int-track"><i data-int-fill></i></div>
          <div class="int-label" data-int-label>WAVE 02 // 准备</div>
        </div>
        <div class="hud-watermark">SANDSTRIKE <b>//</b> 沙暴协议 <span>OPS-07</span></div>
      </div>

      <section class="screen screen--loading is-active" data-screen-panel="loading">
        <div class="loading-inner">
          <header class="loading-top">
            <div class="brand"><span class="brand-glyph">◤</span><span class="brand-text">SANDSTRIKE <b>//</b> 沙暴协议</span></div>
            <div class="loading-telemetry">
              <span>OPS-07 / DUST BASIN</span><span>34.2°N 69.1°E</span><span class="tel-live">UPLINK <i></i></span>
            </div>
          </header>
          <div class="loading-core">
            <div class="loading-kicker">SYSTEM BOOT // 系统启动</div>
            <div class="loading-percent"><span data-load-pct>000</span><i>%</i></div>
            <div class="loading-track"><div class="loading-fill" data-load-fill></div><div class="loading-ticks"></div></div>
            <div class="loading-row">
              <span data-load-label>INITIALIZING RENDERER</span>
              <span data-load-phase>BOOT 01/04</span>
            </div>
            <div class="loading-tip">
              <span class="tip-k">FIELD NOTE // 战术提示</span>
              <span class="tip-en" data-tip-en>${TIPS[this._tipIndex].en}</span>
              <span class="tip-cn" data-tip-cn>${TIPS[this._tipIndex].cn}</span>
            </div>
          </div>
          <footer class="loading-bottom">
            <div class="loading-spec">WEBGL2 · PROCEDURAL TEXTURES · SYNTHESIZED AUDIO · NO EXTERNAL ASSETS</div>
            <div class="loading-legal">BUILD 1.0.0 // SANDSTRIKE PROJECT</div>
          </footer>
        </div>
        <div class="screen-frame"></div>
      </section>

      <section class="screen screen--menu" data-screen-panel="menu">
        <div class="menu-scrim"></div>
        <div class="menu-topbar">
          <div class="tb-left"><span class="tb-dot"></span> UPLINK SECURE <em>链路正常</em></div>
          <div class="tb-mid">OPS-07 // DUST BASIN // 34.2°N 69.1°E</div>
          <div class="tb-right"><span class="tb-perf" data-menu-perf aria-hidden="true">FRAME <b data-menu-fps>--</b> FPS <i>·</i> <b data-menu-ms>--</b> MS</span>LOCAL <span data-menu-clock>--:--:--</span></div>
        </div>
        <div class="menu-body">
          <div class="menu-main">
            <div class="menu-eyebrow"><i></i> TACTICAL COMBAT SIMULATION <em>战术作战模拟</em></div>
            <h1 class="title">
              <span class="title-en">SANDSTRIKE</span>
              <span class="title-line"><span class="title-slash">//</span><span class="title-cn">沙暴协议</span></span>
            </h1>
            <div class="menu-sub">DUST BASIN OUTPOST <i>·</i> 15-WAVE SURVIVAL <i>·</i> VXR-7 ASSAULT RIFLE</div>
            <p class="menu-brief">
              <span class="brief-en">A compromised research outpost in the DUST BASIN. Hostile machine columns are inbound across fifteen escalating waves. Hold the sector, clear every contact.</span>
              <span class="brief-cn">沙暴协议已启动：十五波敌方机械单位正在逼近废弃前哨站。坚守阵地，肃清全部威胁。</span>
            </p>
            <div class="menu-actions">
              <button class="mbtn mbtn--primary" type="button" data-action="start" data-start disabled>
                <span class="mbtn-ico">▶</span>
                <span class="mbtn-copy"><b data-start-label>AWAITING UPLINK</b><em>链路建立中</em></span>
                <span class="mbtn-key">···</span>
              </button>
              <button class="mbtn mbtn--ghost" type="button" data-action="focus-settings">
                SYSTEM CONFIG <em>系统设置</em><span class="mbtn-key">+</span>
              </button>
            </div>
            <div class="menu-meta">
              <div class="meta"><span class="meta-k">THREAT LEVEL</span><span class="meta-v danger">SEVERE</span></div>
              <div class="meta"><span class="meta-k">BEST SCORE</span><span class="meta-v" data-menu-best>000000</span></div>
              <div class="meta"><span class="meta-k">HOSTILES</span><span class="meta-v">40 MAX</span></div>
              <div class="meta"><span class="meta-k">BUILD</span><span class="meta-v mono">1.0.0</span></div>
            </div>
          </div>
          <aside class="menu-side">
            <section class="panel panel--settings" data-settings-panel>
              ${settingsMarkup('menu')}
            </section>
            <section class="panel panel--controls">
              <div class="panel-head"><span class="panel-kicker">CONTROLS</span><em>操作说明</em><span class="panel-corner"></span></div>
              <ul class="controls-list">${controls}</ul>
            </section>
          </aside>
        </div>
        <div class="menu-bottombar">
          <div class="bb-left">SANDSTRIKE <b>//</b> 沙暴协议 <span>© PROJECT DUST BASIN</span></div>
          <div class="bb-right">LOCAL SESSION · BUILD 1.0.0</div>
        </div>
        <div class="screen-frame"></div>
      </section>

      <section class="screen screen--pause" data-screen-panel="paused">
        <div class="pause-scrim"></div>
        <div class="pause-shell">
          <header class="pause-head">
            <div class="pause-kicker">SIMULATION SUSPENDED // 模拟暂停</div>
            <h2 class="pause-title">PAUSED</h2>
            <div class="pause-sub">TACTICAL LINK HELD · 战术链路保持</div>
          </header>
          <div class="pause-body">
            <div class="pause-actions">
              <button class="mbtn mbtn--primary" type="button" data-action="resume">
                <span class="mbtn-ico">▶</span>
                <span class="mbtn-copy"><b>RESUME OPERATION</b><em>继续行动</em></span>
                <span class="mbtn-key">ESC</span>
              </button>
              <button class="mbtn" type="button" data-action="restart">
                <span class="mbtn-ico">⟳</span>
                <span class="mbtn-copy"><b>RESTART OPERATION</b><em>重新开始</em></span>
              </button>
              <button class="mbtn mbtn--danger" type="button" data-action="menu">
                <span class="mbtn-ico">◼</span>
                <span class="mbtn-copy"><b>ABANDON // MAIN MENU</b><em>放弃任务</em></span>
              </button>
            </div>
            <div class="pause-side">
              <section class="panel panel--settings">${settingsMarkup('pause')}</section>
              <div class="pause-runstats">
                <div class="rs"><span>WAVE <em>波次</em></span><b data-pause-wave>01 / 05</b></div>
                <div class="rs"><span>SCORE <em>得分</em></span><b data-pause-score>000000</b></div>
                <div class="rs"><span>KILLS <em>击杀</em></span><b data-pause-kills>0</b></div>
                <div class="rs"><span>TIME <em>用时</em></span><b data-pause-time>00:00</b></div>
              </div>
            </div>
          </div>
          <footer class="pause-foot">ESC TO RESUME · 按 ESC 继续</footer>
        </div>
        <div class="screen-frame"></div>
      </section>

      <section class="screen screen--death" data-screen-panel="dead">
        <div class="end-scrim end-scrim--death"></div>
        <div class="end-shell">
          <div class="end-kicker"><i></i> OPERATION TERMINATED // 行动终止</div>
          <h2 class="end-title end-title--death">SIGNAL <span>LOST</span></h2>
          <div class="end-sub">VITAL SIGNS ZERO · 生命体征归零</div>
          <div class="end-grid">${statsMarkup}</div>
          <div class="end-actions">
            <button class="mbtn mbtn--primary" type="button" data-action="restart">
              <span class="mbtn-ico">⟳</span>
              <span class="mbtn-copy"><b>REDEPLOY</b><em>重新部署</em></span>
              <span class="mbtn-key">ENTER</span>
            </button>
            <button class="mbtn" type="button" data-action="menu">
              <span class="mbtn-copy"><b>MAIN MENU</b><em>主菜单</em></span>
            </button>
          </div>
          <div class="end-foot">SANDSTRIKE <b>//</b> 沙暴协议 · OPS-07</div>
        </div>
        <div class="screen-frame"></div>
      </section>

      <section class="screen screen--victory" data-screen-panel="victory">
        <div class="end-scrim end-scrim--victory"></div>
        <div class="end-shell">
          <div class="end-kicker"><i></i> OPERATION COMPLETE // 行动完成</div>
          <h2 class="end-title end-title--victory">SECTOR <span>SECURED</span></h2>
          <div class="end-sub">AREA CONTROL CONFIRMED · 区域已控制</div>
          <div class="end-grid">${statsMarkup}</div>
          <div class="end-actions">
            <button class="mbtn mbtn--primary" type="button" data-action="restart">
              <span class="mbtn-ico">⟳</span>
              <span class="mbtn-copy"><b>RUN IT AGAIN</b><em>再次行动</em></span>
              <span class="mbtn-key">ENTER</span>
            </button>
            <button class="mbtn" type="button" data-action="menu">
              <span class="mbtn-copy"><b>MAIN MENU</b><em>主菜单</em></span>
            </button>
          </div>
          <div class="end-foot">SANDSTRIKE <b>//</b> 沙暴协议 · SECTOR CP-07</div>
        </div>
        <div class="screen-frame"></div>
      </section>

      <div class="deploy" data-deploy aria-hidden="true">
        <div class="deploy-scrim"></div>
        <div class="deploy-panel" role="dialog" aria-label="Deployment difficulty">
          <div class="deploy-kicker"><i></i> DEPLOYMENT // 部署简报</div>
          <h3 class="deploy-title">SELECT DIFFICULTY <span>选择难度</span></h3>
          <div class="deploy-options">
            <button class="deploy-card" type="button" data-deploy-value="standard">
              <span class="dc-top"><b>STANDARD</b><em>标准</em></span>
              <span class="dc-desc">死亡后保留已获得的强化<br><em>Loot upgrades persist after death</em></span>
              <span class="dc-tag">保留强化</span>
            </button>
            <button class="deploy-card deploy-card--hard" type="button" data-deploy-value="hardcore">
              <span class="dc-top"><b>HARDCORE</b><em>硬核</em></span>
              <span class="dc-desc">死亡后清空全部强化与护甲上限<br><em>All upgrades are lost on death</em></span>
              <span class="dc-tag">死亡不保留</span>
            </button>
          </div>
          <div class="deploy-foot">点击开始部署 · ENTER 使用上次难度</div>
        </div>
      </div>
    `;

    root.appendChild(shell);
    this.el = shell;
    this.built = true;

    const q = (selector) => shell.querySelector(selector);
    const qa = (selector) => Array.from(shell.querySelectorAll(selector));
    this.refs = {
      screens: qa('[data-screen-panel]'),
      hud: q('[data-hud]'),
      loadingPct: q('[data-load-pct]'),
      loadingFill: q('[data-load-fill]'),
      loadingLabel: q('[data-load-label]'),
      loadingPhase: q('[data-load-phase]'),
      tipEn: q('[data-tip-en]'),
      tipCn: q('[data-tip-cn]'),
      startBtn: q('[data-start]'),
      startLabel: q('[data-start-label]'),
      deploy: q('[data-deploy]'),
      menuClock: q('[data-menu-clock]'),
      menuBest: q('[data-menu-best]'),
      best: q('[data-best]'),
      score: q('[data-score]'),
      combo: q('[data-combo]'),
      kills: q('[data-kills]'),
      objectiveFill: q('[data-objective-fill]'),
      objectiveWave: q('[data-objective-wave]'),
      waveCurrent: q('[data-wave-current]'),
      waveTotal: q('[data-wave-total]'),
      waveRemaining: q('[data-wave-remaining]'),
      waveState: q('[data-wave-state]'),
      waveMode: q('[data-wave-mode]'),
      wavePips: q('[data-wave-pips]'),
      health: q('[data-health]'),
      armor: q('[data-armor]'),
      healthMax: q('[data-health-max]'),
      armorMax: q('[data-armor-max]'),
      healthSeg: q('[data-health-seg]'),
      armorSeg: q('[data-armor-seg]'),
      healthState: q('[data-health-state]'),
      vitalBuffs: q('[data-vital-buffs]'),
      bearing: q('[data-bearing]'),
      radarHostiles: q('[data-radar-hostiles]'),
      radarRange: q('[data-radar-range]'),
      radarCanvas: q('.radar-canvas'),
      weaponName: q('[data-weapon-name]'),
      mag: q('[data-mag]'),
      reserve: q('[data-reserve]'),
      magTicks: q('[data-mag-ticks]'),
      ammoLoot: q('[data-ammo-loot]'),
      reload: q('[data-reload]'),
      reloadFill: q('[data-reload-fill]'),
      crosshair: q('[data-crosshair]'),
      hitmarker: q('[data-hitmarker]'),
      killfeed: q('[data-killfeed]'),
      scorePops: q('[data-score-pops]'),
      notices: q('[data-notices]'),
      banner: q('[data-banner]'),
      bannerKicker: q('[data-banner-kicker]'),
      bannerTitle: q('[data-banner-title]'),
      bannerSub: q('[data-banner-sub]'),
      intermission: q('[data-intermission]'),
      intTime: q('[data-int-time]'),
      intFill: q('[data-int-fill]'),
      intLabel: q('[data-int-label]'),
      pauseWave: q('[data-pause-wave]'),
      pauseScore: q('[data-pause-score]'),
      pauseKills: q('[data-pause-kills]'),
      pauseTime: q('[data-pause-time]'),
      flash: q('[data-flash]'),
      lowHealth: q('[data-low-health]'),
      arcs: q('[data-arcs]'),
      settingsPanels: qa('[data-settings-panel], .panel--settings'),
      setInputs: qa('[data-set]'),
      setValues: qa('[data-value]'),
      qualityButtons: qa('[data-quality-value]'),
      difficultyButtons: qa('[data-difficulty-value]'),
      muteLabels: qa('[data-mute-label]'),
      muteToggles: qa('[data-action="mute"]'),
      fpsLabels: qa('[data-fps-label]'),
      fpsToggles: qa('[data-action="fps"]'),
      fullscreenLabels: qa('[data-fullscreen-label]'),
      fullscreenToggles: qa('[data-action="fullscreen"]'),
      perfPanel: q('[data-perf]'),
      perfState: q('[data-perf-state]'),
      perfFps: q('[data-fps]'),
      perfMs: q('[data-frametime]'),
      perfGraph: q('[data-perf-graph]'),
      menuPerf: q('[data-menu-perf]'),
      menuFps: q('[data-menu-fps]'),
      menuMs: q('[data-menu-ms]'),
      statNodes: {
        dead: qa('.screen--death [data-stat]'),
        victory: qa('.screen--victory [data-stat]'),
      },
    };

    // Build segmented meters, wave pips, ammo ticks and damage-arc pool in JS
    // so their counts follow the live config.
    this._buildSegments(this.refs.healthSeg, 20);
    this._buildSegments(this.refs.armorSeg, 20);
    this._buildPips(this._data.wave.total || 15);
    this._buildAmmoTicks(30);
    this._buildArcs(6);
    this._setStartEnabled(this.ready);
    this._applyFpsVisibility();
    this._syncFullscreenInputs();
  }

  _buildSegments(container, count) {
    if (!container) return;
    container.replaceChildren();
    for (let i = 0; i < count; i++) {
      const segment = document.createElement('i');
      container.appendChild(segment);
    }
  }

  _buildPips(total) {
    const container = this.refs.wavePips;
    if (!container) return;
    container.replaceChildren();
    container.classList.toggle('is-many', total > 8);
    for (let i = 0; i < total; i++) {
      const pip = document.createElement('i');
      pip.className = 'pip';
      container.appendChild(pip);
    }
    this._pipTotal = total;
  }

  _buildAmmoTicks(count) {
    const container = this.refs.magTicks;
    if (!container) return;
    container.replaceChildren();
    for (let i = 0; i < count; i++) {
      const tick = document.createElement('i');
      container.appendChild(tick);
    }
    this._ammoTickCount = count;
  }

  _buildArcs(count) {
    const container = this.refs.arcs;
    if (!container) return;
    container.replaceChildren();
    this._arcEls = [];
    for (let i = 0; i < count; i++) {
      const arc = document.createElement('i');
      arc.className = 'dmg-arc';
      container.appendChild(arc);
      this._arcEls.push(arc);
    }
  }

  _bindDom() {
    this.el.addEventListener('click', (event) => {
      const qualityButton = event.target.closest('[data-quality-value]');
      if (qualityButton) {
        this._clickSound();
        this._setQuality(qualityButton.dataset.qualityValue);
        return;
      }
      const deployButton = event.target.closest('[data-deploy-value]');
      if (deployButton) {
        this._clickSound();
        this._chooseDeploy(deployButton.dataset.deployValue);
        return;
      }
      const difficultyButton = event.target.closest('[data-difficulty-value]');
      if (difficultyButton) {
        this._clickSound();
        this._setDifficulty(difficultyButton.dataset.difficultyValue);
        return;
      }
      const button = event.target.closest('button[data-action]');
      if (!button || button.disabled) return;
      this._clickSound();
      this._handleAction(button.dataset.action);
    });

    this.el.addEventListener('pointerover', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (event.relatedTarget && button.contains(event.relatedTarget)) return;
      const now = performance.now();
      if (now - this._lastHoverAt < 45) return;
      this._lastHoverAt = now;
      try { this.audio?.hover?.(); } catch (_) { /* ignore */ }
    });

    this.el.addEventListener('input', (event) => {
      const input = event.target.closest('input[data-set]');
      if (!input) return;
      const key = input.dataset.set;
      const value = Number(input.value);
      if (key === 'sensitivity') this._setSensitivity(value);
      else if (key === 'volume') this._setVolume(value / 100);
    });
  }

  _clickSound() {
    try { this.audio?.click?.(); } catch (_) { /* ignore */ }
  }

  _handleAction(action) {
    switch (action) {
      case 'start': this._openDeploy('start'); break;
      case 'resume': this._resume(); break;
      case 'restart': this._openDeploy('restart'); break;
      case 'menu': this._toMenu(); break;
      case 'pause': this._pause(); break;
      case 'mute': this._setMuted(!this.settings.muted); break;
      case 'fps': this._setShowFps(!this.settings.showFps); break;
      case 'fullscreen': this._toggleFullscreen(); break;
      case 'focus-settings': {
        const panel = this.el.querySelector('.screen--menu .panel--settings');
        if (panel) {
          panel.classList.remove('is-highlight');
          void panel.offsetWidth;
          panel.classList.add('is-highlight');
          this._later(() => panel.classList.remove('is-highlight'), 1400);
          try { panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) { /* ignore */ }
        }
        break;
      }
      default: break;
    }
  }

  _bindGlobals() {
    const unlock = () => {
      this._unlockAudio();
    };
    this._unlockHandler = unlock;
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);

    this._keyHandler = (event) => {
      if (this.disposed) return;
      if (event.code === 'F3') {
        // Global frame-counter toggle (works on every screen), mirroring the
        // SYSTEM CONFIG switch. Ignore auto-repeat so holding F3 is one flip.
        event.preventDefault();
        if (event.repeat) return;
        this._clickSound();
        this._setShowFps(!this.settings.showFps);
        return;
      }
      if (event.code === 'Escape') {
        if (this.state === 'playing') {
          event.preventDefault();
          this._pause();
        } else if (this.state === 'paused') {
          event.preventDefault();
          this._resume();
        }
        return;
      }
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (this._deployOpen) {
          event.preventDefault();
          this._clickSound();
          this._chooseDeploy(this.settings.difficulty);
          return;
        }
        if (this.state === 'menu' && this.ready) {
          event.preventDefault();
          this._clickSound();
          this._start();
        } else if ((this.state === 'dead' || this.state === 'victory') && this._endVisible) {
          event.preventDefault();
          this._clickSound();
          this._restart();
        }
      }
    };
    window.addEventListener('keydown', this._keyHandler);

    // Fullscreen can change outside our buttons (browser UI / OS / script), so
    // mirror the real document state into both settings panels on every change.
    this._fsHandler = () => this._syncFullscreenInputs();
    document.addEventListener('fullscreenchange', this._fsHandler);
    document.addEventListener('fullscreenerror', this._fsHandler);
  }

  _unlockAudio() {
    if (!this.audio) return;
    try {
      if (this.audio.ready) {
        // Context already created: make sure a suspended context wakes up.
        this.audio.resume?.();
        return;
      }
      const result = this.audio.init?.();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) { /* audio is decorative */ }
  }

  _bindBus() {
    const bind = (type, handler) => {
      this._offs.push(on(type, (detail) => {
        if (this.disposed) return;
        try {
          handler(detail || {});
        } catch (error) {
          console.warn(`[SANDSTRIKE ui] ${type} handler failed:`, error);
        }
      }));
    };
    bind('loading:progress', (detail) => this._onLoading(detail));
    bind('game:ready', () => this._onReady());
    bind('game:state', (detail) => this._onState(detail));
    bind('game:difficulty', (detail) => {
      const diff = detail?.difficulty === 'hardcore' ? 'hardcore' : 'standard';
      this._data.stats.difficulty = diff;
      if (this.built) this._renderWave();
    });
    bind('game:world', (detail) => this._onWorld(detail));
    bind('player:stats', (detail) => this._onStats(detail));
    bind('player:hit', (detail) => this._onPlayerHit(detail));
    bind('player:heal', (detail) => this._onHeal(detail));
    bind('wave:start', (detail) => this._onWaveStart(detail));
    bind('wave:clear', (detail) => this._onWaveClear(detail));
    bind('wave:countdown', (detail) => this._onCountdown(detail));
    bind('enemy:killed', (detail) => this._onKilled(detail));
    bind('enemy:hitmarker', (detail) => this._onHitmarker(detail));
    bind('score:change', (detail) => this._onScore(detail));
    bind('radar:update', (detail) => this._onRadar(detail));
    bind('weapon:notice', (detail) => this._onNotice(detail));
    bind('weapon:fired', () => this._onWeaponFired());
    bind('game:death', (detail) => this._onDeath(detail));
    bind('game:victory', (detail) => this._onVictory(detail));
    bind('fx:shake', (detail) => this._onShake(detail));
    bind('fx:hitflash', (detail) => this._onHitflash(detail));
  }

  // =========================================================================
  // Event handlers
  // =========================================================================

  _onLoading(detail) {
    const progress = clamp01(detail.progress);
    const label = typeof detail.label === 'string' && detail.label.trim()
      ? detail.label.trim().toUpperCase()
      : '';
    this._data.loading.progress = progress;
    if (label) this._data.loading.label = label;
    if (this.built) this._renderLoading();
  }

  _onReady() {
    this.ready = true;
    this._data.loading.progress = 1;
    this._data.loading.label = 'SYSTEM READY // 系统就绪';
    if (this.built) {
      this._renderLoading();
      this._setStartEnabled(true);
      this.root.classList.add('is-ready');
      this._later(() => {
        if (this.state === 'loading') this._setScreen('menu');
      }, 620);
    }
  }

  _onState(detail) {
    const next = detail.state;
    if (!VALID_STATES.has(next)) return;
    if (next === this.state) return;
    this._pendingEnd = null;
    this._clearEndTimer();
    if (this.built) {
      this.root.classList.remove('is-dying', 'is-victorious');
    }
    if (next === 'menu') {
      this._setScreen('menu');
      this._renderBest();
      this._renderMenuClock();
      this._wasPlaying = false;
      return;
    }
    if (next === 'playing') {
      this._wasPlaying = true;
      this._setScreen('playing');
      this._renderPauseStats();
      return;
    }
    if (next === 'paused') {
      this._wasPlaying = false;
      this._renderPauseStats();
      this._setScreen('paused');
      return;
    }
    if (next === 'dead' || next === 'victory') {
      this._wasPlaying = false;
      // Adopt the state immediately (so Escape/Enter are inert) but keep the
      // HUD on screen for the impact beat before revealing the end screen.
      this.state = next;
      if (this.built) {
        this.root.classList.add(next === 'dead' ? 'is-dying' : 'is-victorious');
        this._renderWave();
        this._scheduleEnd(next === 'dead' ? 'death' : 'victory', next === 'dead' ? 1050 : 1000);
      }
    }
  }

  _onWorld(detail) {
    const radar = this._data.radar;
    if (detail.bounds && typeof detail.bounds === 'object') {
      const b = detail.bounds;
      const minX = num(b.minX, -34);
      const maxX = num(b.maxX, 34);
      const minZ = num(b.minZ, -34);
      const maxZ = num(b.maxZ, 34);
      radar.bounds = { minX, maxX, minZ, maxZ };
      radar.range = clamp(Math.max(maxX - minX, maxZ - minZ) / 2 + 8, 30, 60);
      if (this.refs.radarRange) this.refs.radarRange.textContent = `${Math.round(radar.range)}M`;
    }
    if (Array.isArray(detail.landmarks)) {
      radar.landmarks = detail.landmarks
        .filter((item) => item && Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.z)))
        .slice(0, 14)
        .map((item) => ({ x: Number(item.x), z: Number(item.z), name: String(item.name || '') }));
    }
    if (detail.playerSpawn && Number.isFinite(Number(detail.playerSpawn.x))) {
      if (!radar.player || (radar.player.x === 0 && radar.player.z === 0)) {
        radar.player = {
          x: Number(detail.playerSpawn.x),
          z: Number(detail.playerSpawn.z),
          yaw: num(detail.playerSpawn.yaw, 0),
        };
      }
    }
    this._data.worldReady = true;
  }

  _onStats(detail) {
    const stats = this._data.stats;
    const prevMag = stats.mag;
    // Merge defensively: events from different owners may be partial snapshots
    // (e.g. player.js emits heal stats without weapon fields).
    if (detail.maxHealth !== undefined) stats.maxHealth = clamp(num(detail.maxHealth, stats.maxHealth), 1, 10000);
    if (detail.maxArmor !== undefined) stats.maxArmor = clamp(num(detail.maxArmor, stats.maxArmor), 0, 10000);
    if (detail.health !== undefined) stats.health = clamp(num(detail.health, stats.health), 0, stats.maxHealth);
    if (detail.armor !== undefined) stats.armor = clamp(num(detail.armor, stats.armor), 0, stats.maxArmor);
    if (detail.magSize !== undefined) stats.magSize = clamp(num(detail.magSize, stats.magSize), 1, 999);
    if (detail.mag !== undefined) stats.mag = clamp(num(detail.mag, stats.mag), 0, stats.magSize);
    if (detail.reserve !== undefined) stats.reserve = Math.max(0, num(detail.reserve, stats.reserve));
    if (typeof detail.reloading === 'boolean') stats.reloading = detail.reloading;
    if (detail.reloadProgress !== undefined) stats.reloadProgress = clamp01(detail.reloadProgress);
    if (typeof detail.weaponName === 'string' && detail.weaponName.trim()) stats.weaponName = detail.weaponName.trim();
    if (typeof detail.ads === 'boolean') stats.ads = detail.ads;
    if (typeof detail.sprinting === 'boolean') stats.sprinting = detail.sprinting;
    if (typeof detail.alive === 'boolean') stats.alive = detail.alive;
    if (detail.damageMultiplier !== undefined) stats.damageMultiplier = clamp(num(detail.damageMultiplier, stats.damageMultiplier), 1, 8);
    if (detail.magExtension !== undefined) stats.magExtension = clamp(num(detail.magExtension, stats.magExtension), 0, 999);
    if (detail.reloadBonus !== undefined) stats.reloadBonus = clamp(num(detail.reloadBonus, stats.reloadBonus ?? 0), 0, 0.85);
    if (detail.difficulty === 'standard' || detail.difficulty === 'hardcore') stats.difficulty = detail.difficulty;
    if (detail.maxArmor !== undefined) stats.maxArmor = clamp(num(detail.maxArmor, stats.maxArmor), 1, 999);
    if (detail.damageReduction !== undefined) {
      stats.damageReduction = clamp(num(detail.damageReduction, stats.damageReduction ?? 0), 0, 0.9);
    }
    if (detail.healthBonus !== undefined) stats.healthBonus = clamp(num(detail.healthBonus, stats.healthBonus ?? 0), 0, 9999);
    if (this.built) {
      this._renderVitals();
      this._renderAmmo();
      this._renderCrosshairState();
      if (this._prevMag !== null && stats.mag < this._prevMag && this.state === 'playing') {
        this._crosshairKick((this._prevMag - stats.mag) * 3.2);
      }
      this._prevMag = stats.mag;
    } else {
      this._prevMag = stats.mag;
    }
  }

  _onPlayerHit(detail) {
    const amount = Math.max(0, num(detail.amount, 0));
    let angle = num(detail.angle, NaN);
    const dir = detail.direction || {};
    if (!Number.isFinite(angle)) {
      const x = num(dir.x, 0);
      const y = num(dir.y, 1);
      angle = Math.atan2(x, y || 0.0001);
    }
    if (this.built) {
      this._hurtArc(angle, clamp(amount / 35, 0.25, 1));
      if (amount > 6) this._flash('rgba(255,44,28,0.9)', clamp(0.12 + amount / 160, 0.12, 0.5), 320);
      if (detail.lowHealth) this._notice({ text: 'LOW HEALTH // 生命垂危', type: 'warn', kind: 'health' });
    }
  }

  _onHeal(detail) {
    const amount = Math.max(0, num(detail.amount, 0));
    if (!this.built) return;
    this._flash('rgba(94,255,196,0.9)', clamp(0.08 + amount / 220, 0.08, 0.3), 420);
    this._notice({ text: `+${Math.round(amount)} VITALS // 生命恢复`, type: 'info', kind: 'heal' });
  }

  _onWaveStart(detail) {
    const wave = clamp(num(detail.wave, 1), 1, 99);
    const total = clamp(num(detail.totalWaves, this._data.wave.total || 15), 1, 99);
    const count = Math.max(0, num(detail.count, 0));
    this._data.wave = {
      ...this._data.wave,
      current: wave,
      total,
      remaining: count,
      count,
      initialCount: count,
      killed: 0,
      cleared: Math.max(0, wave - 1),
      label: typeof detail.label === 'string' ? detail.label : '',
    };
    this._data.kills = this._data.kills || 0;
    if (!this.built) return;
    if (total !== this._pipTotal) this._buildPips(total);
    this._renderWave();
    this._renderObjective();
    this._hideIntermission();
    const label = this._data.wave.label ? ` · ${this._data.wave.label}` : '';
    this._showBanner({
      kicker: 'WAVE INBOUND // 敌军来袭',
      title: `WAVE ${pad2(wave)}`,
      sub: `${count} HOSTILES${label} // 敌军 ${count}`,
      kind: 'is-inbound',
      hold: 2600,
    });
  }

  _onWaveClear(detail) {
    const wave = clamp(num(detail.wave, this._data.wave.current), 1, 99);
    const total = clamp(num(detail.totalWaves, this._data.wave.total || 15), 1, 99);
    const nextIn = Math.max(0, num(detail.nextIn, 6));
    const bonus = Math.max(0, num(detail.bonus, 0));
    this._data.wave.current = wave;
    this._data.wave.total = total;
    this._data.wave.remaining = 0;
    this._data.wave.cleared = wave;
    if (this._data.wave.initialCount > 0) this._data.wave.killed = this._data.wave.initialCount;
    if (!this.built) return;
    this._renderWave();
    this._renderObjective();
    this._showBanner({
      kicker: 'AREA CLEAR // 区域肃清',
      title: `WAVE ${pad2(wave)} CLEARED`,
      sub: bonus > 0 ? `+${Math.round(bonus)} BONUS // 波次奖励` : 'SECTOR CLEAR // 区域安全',
      kind: 'is-clear',
      hold: 2300,
    });
    this._renderBest();
    if (wave < total) {
      this._intermissionMax = Math.max(1, nextIn);
      this._intermissionNext = wave + 1;
      this._later(() => {
        if (this._data.wave.current === wave) this._showIntermission(nextIn, wave + 1);
      }, 1100);
    }
  }

  _onCountdown(detail) {
    const seconds = Math.max(0, num(detail.seconds, 0));
    const nextWave = Math.max(1, num(detail.nextWave, this._data.wave.current + 1));
    this._intermissionNext = nextWave;
    if (!this.built) return;
    this._showIntermission(seconds, nextWave);
  }

  _onKilled(detail) {
    const headshot = !!detail.headshot;
    const points = Math.max(0, Math.round(num(detail.points, 0)));
    this._data.kills = Math.max(0, num(this._data.kills, 0)) + 1;
    const wave = this._data.wave;
    wave.killed = Math.min(wave.initialCount || wave.killed + 1, wave.killed + 1);
    if (wave.remaining > 0) wave.remaining = Math.max(0, wave.remaining - 1);
    if (!this.built) return;
    this._addKillFeed(detail, headshot);
    this._spawnScorePop(points, headshot);
    this._renderWave();
    this._renderScore();
    this._renderObjective();
  }

  _onHitmarker(detail) {
    const headshot = !!detail.headshot;
    const kill = !!detail.kill;
    if (!this.built || this.state !== 'playing') return;
    const marker = this.refs.hitmarker;
    if (!marker) return;
    marker.className = 'ch-hitmarker';
    void marker.offsetWidth;
    marker.classList.add('is-on');
    if (headshot) marker.classList.add('is-headshot');
    if (kill) marker.classList.add('is-kill');
    this._crosshairKick(headshot ? 9 : 5);
  }

  _onWeaponFired() {
    if (!this.built || this.state !== 'playing') return;
    this._crosshairKick(3.2);
  }

  _onScore(detail) {
    const score = Math.max(0, num(detail.score, this._data.score.score));
    this._data.score.score = score;
    this._data.score.combo = Math.max(0, num(detail.combo, this._data.score.combo));
    this._data.score.multiplier = clamp(num(detail.multiplier, this._data.score.multiplier), 0, 99);
    if (!this.built) return;
    this._renderScore();
  }

  _onRadar(detail) {
    const radar = this._data.radar;
    if (detail.player && typeof detail.player === 'object') {
      radar.player = {
        x: num(detail.player.x, radar.player.x),
        z: num(detail.player.z, radar.player.z),
        yaw: num(detail.player.yaw, radar.player.yaw),
      };
    }
    if (Array.isArray(detail.enemies)) {
      radar.enemies = detail.enemies
        .filter((enemy) => enemy && enemy.alive !== false && Number.isFinite(Number(enemy.x)) && Number.isFinite(Number(enemy.z)))
        .slice(0, 48)
        .map((enemy) => ({
          x: Number(enemy.x),
          z: Number(enemy.z),
          type: String(enemy.type || 'rifleman'),
          alive: true,
        }));
      if (this.built && this.refs.radarHostiles) {
        this.refs.radarHostiles.textContent = pad2(radar.enemies.length);
      }
      // NOTE: do not override wave.remaining from radar. Radar only knows about
      // materialised robots; the wave director's count includes the spawn queue.
    }
    if (detail.bounds && typeof detail.bounds === 'object') {
      const b = detail.bounds;
      radar.bounds = {
        minX: num(b.minX, -34), maxX: num(b.maxX, 34),
        minZ: num(b.minZ, -34), maxZ: num(b.maxZ, 34),
      };
    }
  }

  _onNotice(detail) {
    const text = typeof detail.text === 'string' ? detail.text.trim() : '';
    if (!text) return;
    if (!this.built) return;
    const type = detail.type === 'warn' ? 'warn' : 'info';
    this._notice({ text, type });
  }

  _onDeath(detail) {
    this._data.end = this._normalizeEnd(detail);
    this._data.kills = this._data.end.kills;
    this._recordBest(this._data.end.score);
    if (this.built) {
      this._renderBest();
      if (this.state === 'dead' && this._endVisible) this._renderEnd('death');
    }
  }

  _onVictory(detail) {
    this._data.end = this._normalizeEnd(detail);
    this._data.kills = this._data.end.kills;
    this._recordBest(this._data.end.score);
    if (this.built) {
      this._renderBest();
      if (this.state === 'victory' && this._endVisible) this._renderEnd('victory');
    }
  }

  _onShake(detail) {
    const intensity = clamp(num(detail.intensity, 0), 0, 2);
    if (intensity <= 0) return;
    this._shake = Math.min(26, Math.max(this._shake, intensity * 16));
  }

  _onHitflash(detail) {
    if (!this.built) return;
    let color = detail.color;
    if (typeof color === 'number') color = `#${Math.max(0, Math.min(0xffffff, color)).toString(16).padStart(6, '0')}`;
    if (typeof color !== 'string' || !color) color = 'rgba(255,196,128,0.85)';
    const strength = clamp(num(detail.strength, 0.25), 0, 1);
    this._flash(color, clamp(0.05 + strength * 0.35, 0.05, 0.55), 260);
  }

  // =========================================================================
  // Rendering — HUD
  // =========================================================================

  _syncAll() {
    if (!this.built) return;
    this._renderLoading();
    this._syncSettingsInputs();
    this._syncFullscreenInputs();
    this._renderVitals();
    this._renderAmmo();
    this._renderCrosshairState();
    this._renderScore();
    this._renderWave();
    this._renderObjective();
    this._renderBest();
    this._renderPauseStats();
    this._renderMenuClock();
    if (this.ready) this._setStartEnabled(true);
  }

  _renderLoading() {
    const { progress, label } = this._data.loading;
    const pct = Math.min(100, Math.round(progress * 100));
    if (this.refs.loadingPct) this.refs.loadingPct.textContent = String(pct).padStart(3, '0');
    if (this.refs.loadingFill) this.refs.loadingFill.style.width = `${Math.max(2, pct)}%`;
    if (this.refs.loadingLabel && label) this.refs.loadingLabel.textContent = label;
    if (this.refs.loadingPhase) {
      const phase = pct < 24 ? 'BOOT 01/04 · CORE'
        : pct < 52 ? 'BOOT 02/04 · WORLD'
          : pct < 86 ? 'BOOT 03/04 · ASSETS'
            : 'BOOT 04/04 · UPLINK';
      this.refs.loadingPhase.textContent = phase;
    }
  }

  _renderVitals() {
    const stats = this._data.stats;
    const healthPct = stats.maxHealth > 0 ? stats.health / stats.maxHealth : 0;
    const armorPct = stats.maxArmor > 0 ? stats.armor / stats.maxArmor : 0;
    if (this.refs.health) this.refs.health.textContent = String(Math.round(stats.health));
    if (this.refs.armor) this.refs.armor.textContent = String(Math.round(stats.armor));
    if (this.refs.healthMax) this.refs.healthMax.textContent = `/${Math.round(stats.maxHealth)}`;
    if (this.refs.armorMax) this.refs.armorMax.textContent = `/${Math.round(stats.maxArmor)}`;
    this._fillSegments(this.refs.healthSeg, healthPct);
    this._fillSegments(this.refs.armorSeg, armorPct);
    if (this.refs.vitalBuffs) {
      const parts = [];
      const dr = Math.round(clamp01(stats.damageReduction ?? 0) * 100);
      const hp = Math.round(stats.healthBonus ?? 0);
      if (dr > 0) parts.push(`DR -${dr}%`);
      if (hp > 0) parts.push(`HP +${hp}`);
      this.refs.vitalBuffs.textContent = parts.join('  //  ');
      this.refs.vitalBuffs.classList.toggle('is-on', parts.length > 0);
    }
    const low = stats.alive && healthPct <= 0.35;
    const critical = stats.alive && healthPct <= 0.18;
    const root = this.root;
    root.classList.toggle('is-low-health', low && this.state === 'playing');
    root.classList.toggle('is-critical', critical && this.state === 'playing');
    this.root.style.setProperty('--health-pct', healthPct.toFixed(3));
    if (this.refs.healthState) {
      let label = 'COMBAT READY';
      let cn = '状态正常';
      if (!stats.alive) { label = 'SIGNAL LOST'; cn = '生命体征归零'; }
      else if (critical) { label = 'CRITICAL'; cn = '危殆'; }
      else if (low) { label = 'WOUNDED'; cn = '受伤'; }
      this.refs.healthState.textContent = label;
      const holder = this.refs.healthState.parentElement;
      if (holder) {
        const em = holder.querySelector('em');
        if (em) em.textContent = cn;
      }
    }
  }

  _fillSegments(container, pct) {
    if (!container) return;
    const segments = container.children;
    const filled = Math.ceil(clamp01(pct) * segments.length - 0.0001);
    for (let i = 0; i < segments.length; i++) {
      segments[i].classList.toggle('on', i < filled);
    }
  }

  _renderAmmo() {
    const stats = this._data.stats;
    if (this.refs.mag) this.refs.mag.textContent = String(Math.round(stats.mag));
    if (this.refs.reserve) this.refs.reserve.textContent = String(Math.round(stats.reserve));
    if (this.refs.weaponName) this.refs.weaponName.textContent = stats.weaponName;
    if (this.refs.magTicks && this._ammoTickCount !== stats.magSize) this._buildAmmoTicks(stats.magSize);
    if (this.refs.magTicks) {
      const ticks = this.refs.magTicks.children;
      for (let i = 0; i < ticks.length; i++) ticks[i].classList.toggle('on', i < stats.mag);
    }
    const low = stats.mag <= stats.magSize * 0.25;
    const empty = stats.mag <= 0;
    this.root.classList.toggle('is-low-ammo', low);
    this.root.classList.toggle('is-empty', empty);
    if (this.refs.ammoLoot) {
      const dmg = Math.round(((stats.damageMultiplier ?? 1) - 1) * 100);
      const mag = Math.round(stats.magExtension ?? 0);
      const rld = Math.round((stats.reloadBonus ?? 0) * 100);
      const parts = [];
      if (mag > 0) parts.push(`MAG +${mag}`);
      if (dmg > 0) parts.push(`DMG +${dmg}%`);
      if (rld > 0) parts.push(`RLD -${rld}%`);
      const upgraded = parts.length > 0;
      this.refs.ammoLoot.textContent = upgraded ? parts.join('  //  ') : '';
      this.refs.ammoLoot.classList.toggle('is-on', upgraded);
    }
    if (this.refs.reload) {
      this.refs.reload.classList.toggle('is-on', !!stats.reloading);
      if (this.refs.reloadFill) {
        this.refs.reloadFill.style.width = `${Math.round(clamp01(stats.reloadProgress) * 100)}%`;
      }
    }
  }

  _renderCrosshairState() {
    if (!this.built) return;
    const stats = this._data.stats;
    const gap = stats.ads ? 5 : stats.sprinting ? 25 : stats.reloading ? 18 : 13;
    this.root.classList.toggle('is-ads', !!stats.ads);
    this.root.classList.toggle('is-sprint', !!stats.sprinting);
    this.root.style.setProperty('--ch-gap', `${gap}px`);
    this.root.style.setProperty('--ch-op', stats.ads ? '0.86' : '0.94');
  }

  _crosshairKick(amount = 6) {
    if (!this.built) return;
    this.root.style.setProperty('--ch-kick', `${clamp(amount, 2, 14).toFixed(1)}px`);
    this.root.classList.add('is-firing');
    if (this._kickTimer) clearTimeout(this._kickTimer);
    this._kickTimer = setTimeout(() => {
      if (this.disposed) return;
      this.root.style.setProperty('--ch-kick', '0px');
      this.root.classList.remove('is-firing');
    }, 110);
  }

  _renderScore() {
    const { score, multiplier } = this._data.score;
    if (this.refs.score) this.refs.score.textContent = fmtScore(score);
    if (this.refs.combo) this.refs.combo.textContent = `×${Number(multiplier || 1).toFixed(1)}`;
    if (this.refs.kills) this.refs.kills.textContent = String(Math.round(this._data.kills));
    this.root.classList.toggle('is-combo-hot', multiplier >= 2);
  }

  _renderWave() {
    const wave = this._data.wave;
    const current = clamp(wave.current || 1, 1, wave.total || 15);
    if (this.refs.waveCurrent) this.refs.waveCurrent.textContent = pad2(current);
    if (this.refs.waveTotal) this.refs.waveTotal.textContent = pad2(wave.total || 15);
    if (this.refs.waveRemaining) this.refs.waveRemaining.textContent = pad2(wave.remaining || 0);
    if (this.refs.waveState) {
      let state = 'STANDBY';
      if (this.state === 'playing') state = 'LIVE';
      else if (this.state === 'paused') state = 'HOLD';
      else if (this.state === 'dead') state = 'LOST';
      else if (this.state === 'victory') state = 'CLEAR';
      this.refs.waveState.textContent = state;
    }
    if (this.refs.wavePips) {
      const pips = this.refs.wavePips.children;
      for (let i = 0; i < pips.length; i++) {
        pips[i].classList.toggle('is-done', i < (wave.cleared || 0));
        pips[i].classList.toggle('is-current', i === current - 1 && this.state !== 'menu');
      }
    }
    if (this.refs.objectiveWave) this.refs.objectiveWave.textContent = `WAVE ${pad2(current)}`;
    if (this.refs.waveMode) {
      const hardcore = this._data.stats.difficulty === 'hardcore';
      this.refs.waveMode.textContent = hardcore ? 'HARDCORE 不保留' : 'STANDARD 保留';
      this.refs.waveMode.classList.toggle('is-hardcore', hardcore);
    }
  }

  _renderObjective() {
    if (!this.refs.objectiveFill) return;
    const wave = this._data.wave;
    const total = Math.max(1, wave.total || 15);
    const inWave = wave.initialCount > 0 ? clamp((wave.killed || 0) / wave.initialCount, 0, 1) : 0;
    const clearedWaves = wave.cleared || 0;
    const progress = clamp((clearedWaves + inWave) / total, 0, 1);
    this.refs.objectiveFill.style.width = `${(progress * 100).toFixed(1)}%`;
  }

  _renderBest() {
    if (this.refs.best) this.refs.best.textContent = fmtScore(this.best);
    if (this.refs.menuBest) this.refs.menuBest.textContent = fmtScore(this.best);
  }

  _renderPauseStats() {
    const wave = this._data.wave;
    if (this.refs.pauseWave) this.refs.pauseWave.textContent = `${pad2(wave.current || 1)} / ${pad2(wave.total || 15)}`;
    if (this.refs.pauseScore) this.refs.pauseScore.textContent = fmtScore(this._data.score.score);
    if (this.refs.pauseKills) this.refs.pauseKills.textContent = String(Math.round(this._data.kills));
    if (this.refs.pauseTime) this.refs.pauseTime.textContent = fmtTime(this._runTime);
  }

  _renderMenuClock() {
    if (!this.refs.menuClock) return;
    const now = new Date();
    this.refs.menuClock.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  }

  _setStartEnabled(enabled) {
    if (!this.refs.startBtn) return;
    this.refs.startBtn.disabled = !enabled;
    this.refs.startBtn.classList.toggle('is-locked', !enabled);
    const label = this.refs.startLabel;
    if (label) label.textContent = enabled ? 'START OPERATION' : 'AWAITING UPLINK';
    const cn = this.refs.startBtn.querySelector('.mbtn-copy em');
    if (cn) cn.textContent = enabled ? '开始行动' : '链路建立中';
    const key = this.refs.startBtn.querySelector('.mbtn-key');
    if (key) key.textContent = enabled ? 'ENTER' : '···';
  }

  _renderEnd(kind) {
    if (!this.built) return;
    const data = this._data.end || this._normalizeEnd({});
    const section = kind === 'death'
      ? this.el.querySelector('.screen--death')
      : this.el.querySelector('.screen--victory');
    if (!section) return;
    for (const node of section.querySelectorAll('[data-stat]')) {
      const key = node.dataset.stat;
      let value = '—';
      if (key === 'score') value = fmtScore(data.score);
      else if (key === 'wave') value = `${pad2(data.wave)} / ${pad2(this._data.wave.total || 15)}`;
      else if (key === 'kills') value = String(Math.round(data.kills));
      else if (key === 'accuracy') value = `${Math.round(clamp01(data.accuracy) * 100)}%`;
      else if (key === 'time') value = fmtTime(data.time);
      else if (key === 'combo') value = `×${Math.max(0, Math.round(data.bestCombo))}`;
      node.textContent = value;
    }
  }

  _normalizeEnd(detail) {
    const base = this._data.end || {};
    const accuracyRaw = num(detail.accuracy, num(base.accuracy, 0));
    return {
      score: Math.max(0, Math.round(num(detail.score, num(base.score, this._data.score.score)))),
      wave: clamp(num(detail.wave, num(base.wave, this._data.wave.current || 1)), 1, 99),
      kills: Math.max(0, Math.round(num(detail.kills, num(base.kills, this._data.kills)))),
      accuracy: clamp(accuracyRaw > 1 ? accuracyRaw / 100 : accuracyRaw, 0, 1),
      time: Math.max(0, num(detail.time, num(base.time, this._runTime))),
      bestCombo: Math.max(0, num(detail.bestCombo, num(base.bestCombo, 0))),
    };
  }

  _recordBest(score) {
    const value = Math.max(0, Math.round(num(score, 0)));
    if (value > this.best) {
      this.best = value;
      saveJSON(BEST_KEY, { score: value, at: Date.now() });
    }
  }

  // =========================================================================
  // Transient feedback elements
  // =========================================================================

  _addKillFeed(detail, headshot) {
    const feed = this.refs.killfeed;
    if (!feed) return;
    const name = String(detail.name || 'HOSTILE').slice(0, 42).toUpperCase();
    const points = Math.max(0, Math.round(num(detail.points, 0)));
    const combo = Math.max(0, num(detail.combo, 0));
    const row = document.createElement('div');
    row.className = `feed-row${headshot ? ' is-headshot' : ''}`;
    const ico = document.createElement('span');
    ico.className = 'feed-ico';
    ico.textContent = headshot ? '◈' : '✕';
    const weapon = document.createElement('span');
    weapon.className = 'feed-weapon';
    weapon.textContent = 'VXR-7';
    const arrow = document.createElement('span');
    arrow.className = 'feed-arrow';
    arrow.textContent = '▸';
    const target = document.createElement('span');
    target.className = 'feed-name';
    target.textContent = name;
    row.append(ico, weapon, arrow, target);
    if (headshot) {
      const tag = document.createElement('span');
      tag.className = 'feed-tag';
      tag.textContent = 'HEADSHOT';
      row.appendChild(tag);
    }
    if (points > 0) {
      const pts = document.createElement('span');
      pts.className = 'feed-points';
      pts.textContent = `+${points}`;
      row.appendChild(pts);
    }
    if (combo > 1) {
      const cb = document.createElement('span');
      cb.className = 'feed-combo';
      cb.textContent = `×${Math.round(combo)}`;
      row.appendChild(cb);
    }
    feed.prepend(row);
    while (feed.children.length > 5) feed.lastElementChild.remove();
    const timer = setTimeout(() => {
      this._feedTimers.delete(timer);
      row.classList.add('is-out');
      const removeTimer = setTimeout(() => {
        this._feedTimers.delete(removeTimer);
        row.remove();
      }, 260);
      this._feedTimers.add(removeTimer);
    }, 4600);
    this._feedTimers.add(timer);
  }

  _spawnScorePop(points, headshot) {
    const wrap = this.refs.scorePops;
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = `score-pop${headshot ? ' is-headshot' : ''}`;
    el.textContent = `${headshot ? '◈' : ''}+${Math.round(points)}`;
    el.style.left = `${57 + rand(0, 7)}%`;
    el.style.top = `${56 + rand(0, 7)}%`;
    wrap.appendChild(el);
    if (wrap.children.length > 7) wrap.firstElementChild.remove();
    this._later(() => el.remove(), 980);
  }

  _notice({ text, type = 'info', kind = '' }) {
    const wrap = this.refs.notices;
    if (!wrap) return;
    // Collapse duplicate consecutive notices (e.g. spammy pickups).
    const last = wrap.lastElementChild;
    if (last && last.dataset.text === text) {
      last.classList.remove('is-on');
      void last.offsetWidth;
      last.classList.add('is-on');
      return;
    }
    const row = document.createElement('div');
    row.className = `notice${type === 'warn' ? ' is-warn' : ''}${kind ? ` notice--${kind}` : ''}`;
    row.dataset.text = text;
    const tag = document.createElement('span');
    tag.className = 'notice-tag';
    tag.textContent = type === 'warn' ? '!' : '▸';
    const body = document.createElement('span');
    body.className = 'notice-text';
    body.textContent = text;
    row.append(tag, body);
    wrap.appendChild(row);
    while (wrap.children.length > 3) wrap.firstElementChild.remove();
    this._later(() => {
      row.classList.add('is-out');
      this._later(() => row.remove(), 280);
    }, 3300);
  }

  _showBanner({ kicker, title, sub, kind = '', hold = 2400 }) {
    if (!this.built) return;
    if (this._bannerTimer) {
      clearTimeout(this._bannerTimer);
      this._bannerTimer = 0;
    }
    const banner = this.refs.banner;
    if (!banner) return;
    this.refs.bannerKicker.textContent = kicker;
    this.refs.bannerTitle.textContent = title;
    this.refs.bannerSub.textContent = sub;
    banner.className = `wave-banner is-on ${kind}`.trim();
    this._bannerTimer = setTimeout(() => {
      this._bannerTimer = 0;
      if (!this.disposed && banner) banner.classList.remove('is-on');
    }, hold);
  }

  _showIntermission(seconds, nextWave) {
    if (!this.built) return;
    const panel = this.refs.intermission;
    if (!panel) return;
    this._intermissionMax = Math.max(this._intermissionMax, seconds, 1);
    this._intermissionNext = nextWave;
    this.refs.intTime.textContent = pad2(Math.ceil(seconds));
    this.refs.intLabel.textContent = `WAVE ${pad2(nextWave)} // 准备`;
    if (this.refs.intFill) {
      const pct = clamp(seconds / this._intermissionMax, 0, 1);
      this.refs.intFill.style.width = `${(pct * 100).toFixed(1)}%`;
    }
    panel.classList.add('is-on');
  }

  _hideIntermission() {
    if (this.built && this.refs.intermission) this.refs.intermission.classList.remove('is-on');
  }

  _hurtArc(angle, strength) {
    if (!this._arcEls.length) return;
    const arc = this._arcEls[this._arcIndex % this._arcEls.length];
    this._arcIndex += 1;
    const degrees = (angle * 180) / Math.PI;
    arc.style.setProperty('--a', `${degrees.toFixed(1)}deg`);
    arc.style.setProperty('--i', String(clamp(0.4 + strength, 0.35, 1)));
    arc.classList.remove('is-on');
    void arc.offsetWidth;
    arc.classList.add('is-on');
  }

  _flash(color, strength, duration = 300) {
    if (!this.built) return;
    const el = this.refs.flash;
    if (!el) return;
    el.style.setProperty('--flash-color', color);
    el.style.setProperty('--flash-i', String(clamp(strength, 0.02, 0.7)));
    el.style.setProperty('--flash-dur', `${duration}ms`);
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
  }

  // =========================================================================
  // Screens / actions
  // =========================================================================

  _setScreen(name) {
    this.state = name;
    if (!this.built) return;
    this.root.dataset.screen = name;
    for (const screen of this.refs.screens) {
      screen.classList.toggle('is-active', screen.dataset.screenPanel === name);
    }
    if (name !== 'loading') this.root.classList.add('is-booted');
    this._renderWave();
    if (name === 'menu') {
      this._renderBest();
      this._renderMenuClock();
      this._hideIntermission();
      this._pendingEnd = null;
      this._endVisible = false;
      this._clearEndTimer();
    }
    if (name === 'playing') {
      this.root.classList.remove('is-dying', 'is-victorious');
      this._endVisible = false;
      this._clearEndTimer();
      this._prevMag = this._data.stats.mag;
      this._renderVitals();
      this._renderAmmo();
      this._renderCrosshairState();
    }
    if (name === 'paused') {
      this._renderPauseStats();
    }
    if (name === 'dead' || name === 'victory') {
      this._endVisible = true;
      this._renderEnd(name === 'dead' ? 'death' : 'victory');
    }
    this._renderVitals();
    this._syncFullscreenInputs();
  }

  _scheduleEnd(kind, delay) {
    this._clearEndTimer();
    this._pendingEnd = kind;
    this._endTimer = this._later(() => {
      this._endTimer = 0;
      if (this.disposed) return;
      if (this._pendingEnd !== kind) return;
      if (this.state !== 'dead' && this.state !== 'victory') return;
      this._setScreen(kind === 'death' ? 'dead' : 'victory');
    }, delay);
  }

  _clearEndTimer() {
    if (this._endTimer) {
      clearTimeout(this._endTimer);
      this._endTimer = 0;
    }
  }

  _resetRun() {
    this._runTime = 0;
    this._prevMag = null;
    this._data.stats = {
      health: 100, maxHealth: 100, armor: 100, maxArmor: 100,
      mag: 30, magSize: 30, reserve: 300, reloading: false, reloadProgress: 0,
      weaponName: 'VXR-7 突击步枪', ads: false, sprinting: false, alive: true,
      damageMultiplier: 1, magExtension: 0, reloadBonus: 0,
      damageReduction: 0, healthBonus: 0,
    };
    this._data.wave = { current: 1, total: 15, remaining: 0, label: '', count: 0, initialCount: 0, killed: 0, cleared: 0 };
    this._data.score = { score: 0, combo: 0, multiplier: 1 };
    this._data.kills = 0;
    this._data.end = null;
    if (this.built) {
      this.refs.killfeed.replaceChildren();
      this.refs.notices.replaceChildren();
      this.refs.scorePops.replaceChildren();
      this.refs.banner.classList.remove('is-on');
      this._hideIntermission();
      this.root.classList.remove('is-low-health', 'is-critical', 'is-low-ammo', 'is-empty', 'is-ads', 'is-sprint', 'is-combo-hot', 'is-dying', 'is-victorious');
      this.root.style.setProperty('--ch-kick', '0px');
      this._renderVitals();
      this._renderAmmo();
      this._renderCrosshairState();
      this._renderScore();
      this._renderWave();
      this._renderObjective();
    }
  }

  _start() {
    if (this.disposed || !this.ready) return;
    if (this.state === 'playing') return;
    this._closeDeploy();
    this._unlockAudio();
    this._resetRun();
    this._setScreen('playing');
    // Synchronous emit: main requests pointer lock inside this gesture.
    emit('ui:start', {});
  }

  /** Deployment flow: pick the difficulty before a run starts. */
  _openDeploy(mode) {
    if (this.disposed || !this.built || !this.refs.deploy) return;
    if (mode === 'start' && (!this.ready || this.state === 'playing')) return;
    this._deployMode = mode === 'restart' ? 'restart' : 'start';
    this._deployOpen = true;
    this._syncSettingsInputs();
    this.refs.deploy.classList.add('is-open');
    this.refs.deploy.setAttribute('aria-hidden', 'false');
  }

  _closeDeploy() {
    this._deployOpen = false;
    if (this.refs?.deploy) {
      this.refs.deploy.classList.remove('is-open');
      this.refs.deploy.setAttribute('aria-hidden', 'true');
    }
  }

  _chooseDeploy(difficulty) {
    if (!this._deployOpen) return;
    const mode = this._deployMode === 'restart' ? 'restart' : 'start';
    this._closeDeploy();
    if (difficulty === 'standard' || difficulty === 'hardcore') this._setDifficulty(difficulty);
    if (mode === 'restart') this._restart();
    else this._start();
  }

  _resume() {
    if (this.disposed) return;
    this._unlockAudio();
    this._setScreen('playing');
    emit('ui:resume', {});
  }

  _restart() {
    if (this.disposed) return;
    this._closeDeploy();
    this._unlockAudio();
    this._resetRun();
    this._setScreen('playing');
    emit('ui:restart', {});
  }

  _toMenu() {
    if (this.disposed) return;
    this._clearEndTimer();
    this._hideIntermission();
    this._endVisible = false;
    this._setScreen('menu');
    emit('ui:menu', {});
  }

  _pause() {
    if (this.disposed) return;
    this._renderPauseStats();
    this._setScreen('paused');
    emit('ui:pause', {});
  }

  // =========================================================================
  // Frame counter (sampled on the UI rAF loop, painted at a low fixed rate)
  // =========================================================================

  _samplePerf(now) {
    const last = this._perfLast;
    this._perfLast = now;
    if (!last) return;
    const delta = now - last;
    if (!(delta > 0) || delta > 250) {
      // Hidden tab / GC pause / shader hitch: start a fresh window. The last
      // good reading stays on screen until PERF_MIN_SAMPLES clean frames land.
      this._resetPerfWindow();
      return;
    }
    const index = this._perfHead;
    this._perfStamps[index] = now;
    this._perfIntervals[index] = delta;
    this._perfHead = (index + 1) % PERF_CAPACITY;
    if (this._perfCount < PERF_CAPACITY) this._perfCount += 1;
    this._perfTotal += 1;
    // Stats are recomputed on the same ~8 Hz cadence as the DOM readout (see
    // _tick) so this.perf can never disagree with the displayed numbers.
  }

  _resetPerfWindow() {
    this._perfHead = 0;
    this._perfCount = 0;
    // NOTE: _perfTotal is intentionally NOT reset — `perf.samples` is a
    // monotonic count of accepted frames (useful for QA / diagnostics), while
    // the rolling stats above start empty again. A previously valid reading is
    // kept on screen through the hitch: only the *initial* state reads "--".
    if (!this._perfHasReading) {
      this.perf = { fps: 0, frameMs: 0, worstMs: 0, samples: this._perfTotal, level: 'low' };
    } else if (this.perf.samples !== this._perfTotal) {
      this.perf = { ...this.perf, samples: this._perfTotal };
    }
    if (this.built && this.settings.showFps) this._perfLastTextAt = 0;
  }

  _computePerf() {
    const count = this._perfCount;
    if (count < PERF_MIN_SAMPLES) {
      // Not enough clean frames yet: show "--" only until the very first valid
      // reading; afterwards keep the last good numbers (prevents flicker on a
      // single caught hitch).
      if (!this._perfHasReading) {
        this.perf = { fps: 0, frameMs: 0, worstMs: 0, samples: this._perfTotal, level: 'low' };
      }
      return;
    }
    // Walk backwards through the ring until the rolling window is covered.
    let index = (this._perfHead - 1 + PERF_CAPACITY) % PERF_CAPACITY;
    let frames = 0;
    let span = 0;
    let worst = 0;
    while (frames < count && span < PERF_WINDOW_MS) {
      const delta = this._perfIntervals[index];
      span += delta;
      if (delta > worst) worst = delta;
      frames += 1;
      index = (index - 1 + PERF_CAPACITY) % PERF_CAPACITY;
    }
    if (!(frames > 0) || !(span > 0)) return;
    // frames / real elapsed time is exact for the accumulated span (a 500 ms
    // window at 60 Hz reports ~59.9 fps, not a rounded 60).
    const fps = Math.round((frames / (span / 1000)) * 10) / 10;
    this.perf = {
      fps,
      frameMs: Math.round((span / frames) * 10) / 10,
      worstMs: Math.round(worst * 10) / 10,
      samples: this._perfTotal,
      level: perfLevel(fps),
    };
    this._perfHasReading = true;
  }

  _renderPerf() {
    if (!this.built || !this.settings.showFps) return;
    this._computePerf();
    this._renderPerfText();
    this._drawPerfGraph();
  }

  _renderPerfText() {
    const perf = this.perf;
    // "--" is only the initial / never-measured state (spec); afterwards the
    // last good reading stays visible through short hitches.
    const warm = this._perfHasReading && perf.fps > 0;
    const fpsText = warm ? String(Math.round(perf.fps)) : '--';
    const msText = warm ? perf.frameMs.toFixed(1) : '--';
    const stateText = warm ? (perf.level === 'good' ? 'GOOD' : perf.level === 'fair' ? 'FAIR' : 'LOW') : 'SYNC';
    const { refs } = this;
    if (refs.perfFps && refs.perfFps.textContent !== fpsText) refs.perfFps.textContent = fpsText;
    if (refs.perfMs && refs.perfMs.textContent !== msText) refs.perfMs.textContent = msText;
    if (refs.menuFps && refs.menuFps.textContent !== fpsText) refs.menuFps.textContent = fpsText;
    if (refs.menuMs && refs.menuMs.textContent !== msText) refs.menuMs.textContent = msText;
    if (refs.perfState && refs.perfState.textContent !== stateText) refs.perfState.textContent = stateText;
    for (const panel of [refs.perfPanel, refs.menuPerf]) {
      if (!panel) continue;
      if (warm) {
        if (panel.dataset.level !== perf.level) panel.dataset.level = perf.level;
      } else if (panel.dataset.level) {
        delete panel.dataset.level;
      }
    }
  }

  _drawPerfGraph() {
    const canvas = this.refs.perfGraph;
    if (!canvas) return;
    const ctx = this._perfCtx || (this._perfCtx = canvas.getContext('2d'));
    if (!ctx) return;
    const cssW = canvas.clientWidth || 0;
    const cssH = canvas.clientHeight || 0;
    if (!cssW || !cssH) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixelW = Math.max(1, Math.round(cssW * dpr));
    const pixelH = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // 16.7 ms reference line = the 60 fps budget (bar height caps at 50 ms).
    const refY = Math.round(cssH - (16.7 / PERF_GRAPH_MAX_MS) * cssH) + 0.5;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(238, 205, 158, 0.22)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, refY);
    ctx.lineTo(cssW, refY);
    ctx.stroke();
    ctx.setLineDash([]);

    const count = Math.min(this._perfCount, PERF_GRAPH_BARS);
    if (count > 0) {
      const palette = PERF_COLORS[this.perf.level] || PERF_COLORS.fair;
      const step = cssW / PERF_GRAPH_BARS;
      const barW = Math.max(1, step - 1);
      ctx.fillStyle = palette.bar;
      for (let i = 0; i < count; i++) {
        const index = (this._perfHead - count + i + PERF_CAPACITY) % PERF_CAPACITY;
        const ms = clamp(this._perfIntervals[index], 0, PERF_GRAPH_MAX_MS);
        const barH = Math.max(1, (ms / PERF_GRAPH_MAX_MS) * (cssH - 1));
        const x = Math.round(cssW - (count - i) * step);
        // Older samples fade out towards the left edge.
        ctx.globalAlpha = 0.3 + 0.7 * ((i + 1) / count);
        ctx.fillRect(x, cssH - barH, barW, barH);
      }
      ctx.globalAlpha = 1;
    }
  }

  // =========================================================================
  // Frame loop
  // =========================================================================

  _startLoop() {
    if (this._raf) return;
    this._lastFrame = performance.now();
    this._raf = requestAnimationFrame(this._tickBound);
  }

  _tick(now) {
    if (this.disposed) return;
    this._raf = requestAnimationFrame(this._tickBound);
    // Raw frame delta (before clamping) feeds the FPS meter; stalls > 250 ms
    // reset the window so tab-switches / shader hitches never poison the stats.
    this._samplePerf(now);
    const dt = clamp((now - (this._lastFrame || now)) / 1000, 0, 0.05);
    this._lastFrame = now;

    if (this.state === 'playing') this._runTime += dt;

    // HUD shake decay.
    if (this._shake > 0.08) {
      this._shake *= Math.exp(-9 * dt);
      const hud = this.refs.hud;
      if (hud) {
        const x = rand(-1, 1) * this._shake;
        const y = rand(-1, 1) * this._shake * 0.7;
        const r = rand(-1, 1) * this._shake * 0.03;
        hud.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${r.toFixed(2)}deg)`;
        this._wasShaking = true;
      }
    } else if (this._wasShaking) {
      this._shake = 0;
      this._wasShaking = false;
      const hud = this.refs.hud;
      if (hud) hud.style.transform = '';
    }

    // Radar ~30 Hz only while the HUD is live.
    if (this.state === 'playing' && now - this._lastRadarDraw > 32) {
      this._lastRadarDraw = now;
      this._drawRadar(now);
    }

    // Loading tips rotate.
    if (this.state === 'loading' && this.built && now - this._lastTipAt > 4400) {
      this._lastTipAt = now;
      this._tipIndex = (this._tipIndex + 1) % TIPS.length;
      const tip = TIPS[this._tipIndex];
      if (this.refs.tipEn) this.refs.tipEn.textContent = tip.en;
      if (this.refs.tipCn) this.refs.tipCn.textContent = tip.cn;
    }

    // Menu clock once per second.
    if (now - this._lastClock > 1000) {
      this._lastClock = now;
      if (this.state === 'menu') this._renderMenuClock();
      if (this.state === 'paused') this._renderPauseStats();
    }

    // Frame counter readout: text <= 8 Hz, canvas <= 15 Hz. Sampling above keeps
    // running while hidden, but nothing is painted when the toggle is off.
    if (this.settings.showFps && this.built) {
      if (now - this._perfLastTextAt >= PERF_TEXT_MS) {
        this._perfLastTextAt = now;
        // Recompute on the display cadence: this.perf stays exactly in sync
        // with the DOM text for external readers (QA / devtools).
        this._computePerf();
        this._renderPerfText();
      }
      if (now - this._perfLastGraphAt >= PERF_GRAPH_MS) {
        this._perfLastGraphAt = now;
        this._drawPerfGraph();
      }
    }
  }

  // =========================================================================
  // Radar
  // =========================================================================

  _drawRadar(now) {
    const canvas = this.refs.radarCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const R = W / 2 - 10;
    const radar = this._data.radar;
    const yaw = num(radar.player.yaw, 0);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const range = clamp(num(radar.range, 42), 20, 80);
    const k = R / range;
    const px = num(radar.player.x, 0);
    const pz = num(radar.player.z, 0);

    const project = (x, z) => {
      const dx = x - px;
      const dz = z - pz;
      return { x: dx * cos - dz * sin, y: dx * sin + dz * cos, dist: Math.hypot(dx, dz) };
    };

    ctx.clearRect(0, 0, W, H);

    // Plate wash.
    const plate = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    plate.addColorStop(0, 'rgba(10, 18, 21, 0.72)');
    plate.addColorStop(0.72, 'rgba(7, 12, 14, 0.62)');
    plate.addColorStop(1, 'rgba(4, 7, 8, 0.78)');
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // Rings + crosshairs.
    ctx.save();
    ctx.strokeStyle = 'rgba(124, 231, 255, 0.16)';
    ctx.lineWidth = 1.2;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(124, 231, 255, 0.07)';
    ctx.setLineDash([4, 10]);
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Bearing ticks every 30 degrees.
    ctx.save();
    ctx.translate(cx, cy);
    for (let deg = 0; deg < 360; deg += 30) {
      ctx.save();
      ctx.rotate((deg * Math.PI) / 180 - yaw);
      ctx.strokeStyle = deg % 90 === 0 ? 'rgba(246, 226, 192, 0.42)' : 'rgba(246, 226, 192, 0.16)';
      ctx.beginPath();
      ctx.moveTo(0, -R + 3);
      ctx.lineTo(0, -R + (deg % 90 === 0 ? 13 : 8));
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // Landmarks.
    if (radar.landmarks && radar.landmarks.length) {
      ctx.save();
      ctx.font = '600 15px Bahnschrift, "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const mark of radar.landmarks) {
        const local = project(mark.x, mark.z);
        let x = local.x * k;
        let y = local.y * k;
        const len = Math.hypot(x, y);
        const clamped = len > R * 0.94;
        if (clamped) {
          const scale = (R * 0.94) / (len || 1);
          x *= scale; y *= scale;
        }
        const sx = cx + x;
        const sy = cy + y;
        ctx.fillStyle = clamped ? 'rgba(246, 226, 192, 0.25)' : 'rgba(246, 226, 192, 0.52)';
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-3, -3, 6, 6);
        ctx.restore();
        if (!clamped && mark.name) {
          const label = String(mark.name).slice(0, 12).toUpperCase();
          ctx.fillStyle = 'rgba(246, 226, 192, 0.42)';
          ctx.fillText(label, sx + 7, sy + 1);
        }
      }
      ctx.restore();
    }

    // Enemies.
    const enemyColor = (type) => {
      const t = String(type).toLowerCase();
      if (t.includes('heavy') || t.includes('warlord')) return 'rgba(255, 86, 66, 0.96)';
      if (t.includes('scout')) return 'rgba(124, 231, 255, 0.96)';
      return 'rgba(255, 158, 74, 0.96)';
    };
    for (const enemy of radar.enemies) {
      const local = project(enemy.x, enemy.z);
      let x = local.x * k;
      let y = local.y * k;
      const len = Math.hypot(x, y);
      const clamped = len > R * 0.95;
      if (clamped) {
        const scale = (R * 0.95) / (len || 1);
        x *= scale; y *= scale;
      }
      const sx = cx + x;
      const sy = cy + y;
      const color = enemyColor(enemy.type);
      ctx.save();
      if (clamped) {
        ctx.translate(sx, sy);
        ctx.rotate(Math.atan2(y, x) + Math.PI / 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -7);
        ctx.lineTo(5, 4);
        ctx.lineTo(-5, 4);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Sweep.
    const sweep = ((now * 0.00042) % 1) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sweep);
    if (typeof ctx.createConicGradient === 'function') {
      const cone = ctx.createConicGradient(-0.42, 0, 0);
      cone.addColorStop(0, 'rgba(124, 231, 255, 0)');
      cone.addColorStop(0.085, 'rgba(124, 231, 255, 0.20)');
      cone.addColorStop(0.12, 'rgba(124, 231, 255, 0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(124, 231, 255, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(R * 0.96, 0);
    ctx.stroke();
    ctx.restore();

    // Center player chevron.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(255, 232, 198, 0.96)';
    ctx.shadowColor = 'rgba(255, 158, 74, 0.9)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // North marker.
    const nx = cx + sin * R * 0.86;
    const ny = cy - cos * R * 0.86;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 158, 74, 0.92)';
    ctx.font = '700 16px Bahnschrift, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);
    ctx.restore();

    // Bearing readout.
    const heading = (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
    if (this.refs.bearing) this.refs.bearing.textContent = `${String(Math.round(heading)).padStart(3, '0')}°`;
  }

  // =========================================================================
  // Utility
  // =========================================================================

  _later(fn, delay) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      if (!this.disposed) {
        try { fn(); } catch (error) { console.warn('[SANDSTRIKE ui] timer failed:', error); }
      }
    }, delay);
    this._timers.add(id);
    return id;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    for (const off of this._offs) {
      try { off(); } catch (_) { /* ignore */ }
    }
    this._offs.length = 0;
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    for (const id of this._feedTimers) clearTimeout(id);
    this._feedTimers.clear();
    this._clearEndTimer();
    if (this._kickTimer) clearTimeout(this._kickTimer);
    if (this._bannerTimer) clearTimeout(this._bannerTimer);
    if (this._unlockHandler) {
      window.removeEventListener('pointerdown', this._unlockHandler);
      window.removeEventListener('keydown', this._unlockHandler);
    }
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    if (this._fsHandler) {
      document.removeEventListener('fullscreenchange', this._fsHandler);
      document.removeEventListener('fullscreenerror', this._fsHandler);
      this._fsHandler = null;
    }
    this._fsPending = false;
    try { document.body.classList.remove('ui-ready'); } catch (_) { /* ignore */ }
    if (this.el) this.el.remove();
    if (this.root) {
      this.root.classList.remove('ui-root');
      this.root.removeAttribute('data-screen');
      if (this._ownsRoot) this.root.remove();
    }
    this.refs = {};
    this.el = null;
    this.root = null;
    this.built = false;
  }
}

export default UI;

