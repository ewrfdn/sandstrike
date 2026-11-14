/**
 * SANDSTRIKE // 沙暴协议 — Tactical UI core
 * ---------------------------------------------------------------------------
 * Owns the `#ui` root, the screen state machine, the persisted settings store,
 * run actions (start / restart / pause / resume / menu), the global keyboard +
 * pointer bindings and the single rAF loop. Every pixel is delegated to the
 * functional-area panels under this folder:
 *
 *   hud.js        combat HUD (vitals / ammo / wave / radar / feedback)
 *   home.js       loading screen + main menu
 *   settings.js   secondary "SYSTEM CONFIG" overlay (settings + controls)
 *   overlays.js   pause / death / victory / deploy
 *   perf.js       frame counter
 *   shared.js     constants + helpers
 *
 * Screens: loading -> menu -> playing (HUD) -> paused / dead / victory
 * Emits:   ui:start, ui:resume, ui:restart, ui:pause, ui:menu, ui:settings
 * Listens: every Game -> UI event in TEAM_SPEC.md
 *
 * Settings changes go through the setters below (single writer); panels only
 * render `ui.settings`. The settings overlay is a second-level menu: the home
 * screen hides it, `data-action="focus-settings"` opens it on demand.
 */
import { emit, on } from '../bus.js';
import {
  BEST_KEY,
  SETTINGS_KEY,
  QUALITIES,
  VALID_STATES,
  clamp,
  num,
  loadJSON,
  saveJSON,
  qa,
  TIPS,
} from './shared.js';
import { DEFAULT_DIFFICULTY_ID, isDifficultyId } from '../config/difficulty.js';
import { getStage } from '../config/stages.js';
import { hudMarkup, HudPanel } from './hud.js';
import { loadingMarkup, homeMarkup, LoadingPanel, HomePanel } from './home.js';
import {
  pauseMarkup,
  endMarkup,
  deployMarkup,
  PausePanel,
  EndPanel,
  DeployPanel,
  StageSelectPanel,
} from './overlays.js';
import { SettingsPanel } from './settings.js';
import { PerfMeter } from './perf.js';

const FALLBACK_PERF = { fps: 0, frameMs: 0, worstMs: 0, samples: 0, level: 'low' };

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
    this.pad = { connected: false, id: '', kind: '', mapping: '' };

    this._padKnown = false;
    this._offs = [];
    this._timers = new Set();
    this._raf = 0;
    this._lastFrame = 0;
    this._tickBound = (now) => this._tick(now);
    this._unlockHandler = null;
    this._keyHandler = null;
    this._fsHandler = null;
    this._fsPending = false;
    this._lastHoverAt = 0;
    this._runTime = 0;
    this._endTimer = 0;
    this._endVisible = false;
    this._pendingEnd = null;
    this.tipIndex = Math.floor(Math.random() * TIPS.length);
    this._perfFallback = { ...FALLBACK_PERF };

    // Panel instances are created in _build().
    this.loading = null;
    this.home = null;
    this.hud = null;
    this.pause = null;
    this.end = null;
    this.deploy = null;
    this.stageSelect = null;
    this.settingsPanel = null;
    this.perfMeter = null;

    this.data = {
      loading: { progress: 0, label: 'INITIALIZING RENDERER' },
      stats: {
        health: 100, maxHealth: 100, armor: 100, maxArmor: 100,
        mag: 30, magSize: 30, reserve: 300, reloading: false, reloadProgress: 0,
        weaponName: 'VXR-7 突击步枪', weaponType: 'vxr7', weaponMode: 'auto', weaponShort: 'VXR-7', slotIndex: 0,
        ads: false, sprinting: false, alive: true,
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
      /** Campaign context painted by the HUD / overlays (`game:stage`). */
      stage: null,
      /** Current difficulty tier object (`game:difficulty`). */
      difficulty: null,
      /** Latest `weapon:slots` snapshot. */
      weaponSlots: null,
      /** Boss bar state (`boss:*`). */
      boss: null,
      /** Last `game:victory` / `game:death` campaign fields. */
      result: null,
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
          this.home.setStartEnabled(true);
          if (this.state === 'loading') {
            this.later(() => {
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
  // Public QA / panel surface
  // =========================================================================

  get perf() {
    return (this.perfMeter && this.perfMeter.perf) || this._perfFallback;
  }

  get showFps() {
    return !!this.settings.showFps;
  }

  /** Exposed for panels: run timer for the pause stats readout. */
  get runTime() {
    return this._runTime;
  }

  get deployOpen() {
    return !!(this.deploy && this.deploy.isOpen);
  }

  get stageSelectOpen() {
    return !!(this.stageSelect && this.stageSelect.isOpen);
  }

  isSettingsOpen() {
    return !!(this.settingsPanel && this.settingsPanel.isOpen);
  }

  /** Swap the keyboard hints for pad hints when a controller is active (§6.3). */
  padHintsActive() {
    return !!this.pad.connected
      && typeof document !== 'undefined'
      && !document.documentElement.classList.contains('is-touch');
  }

  later(fn, delay) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      if (!this.disposed) {
        try { fn(); } catch (error) { console.warn('[SANDSTRIKE ui] timer failed:', error); }
      }
    }, delay);
    this._timers.add(id);
    return id;
  }

  clickSound() {
    try { this.audio?.click?.(); } catch (_) { /* ignore */ }
  }

  notify({ text, type = 'info', kind = '' }) {
    if (!this.built || !this.hud) return;
    this.hud.notice({ text, type, kind });
  }

  recordBest(score) {
    const value = Math.max(0, Math.round(num(score, 0)));
    if (value <= this.best) return;
    this.best = value;
    saveJSON(BEST_KEY, { score: value, at: Date.now() });
    if (!this.built) return;
    this.hud.renderBest();
    this.home.renderBest();
  }

  // =========================================================================
  // Settings store (single writer — panels only render it)
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
      // Last-used deployment difficulty (one of src/config/difficulty.js ids);
      // the legacy `hardcore` value migrates to VETERAN.
      difficulty: isDifficultyId(stored.difficulty)
        ? stored.difficulty
        : (stored.difficulty === 'hardcore' ? 'veteran' : DEFAULT_DIFFICULTY_ID),
      // Rumble defaults ON: a controller that supports it should feel alive
      // without the player hunting for a switch.
      vibrate: stored.vibrate !== false,
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
      vibrate: this.settings.vibrate !== false,
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
    const raw = this.settings.volume;
    emit('ui:settings', {
      sensitivity: this.settings.sensitivity,
      // Muted means effective volume 0, but we still expose the raw handle so
      // the game can restore it if it persists settings itself.
      volume: this.settings.muted ? 0 : raw,
      volumeRaw: raw,
      quality: this.settings.quality,
      muted: !!this.settings.muted,
      difficulty: this.settings.difficulty,
      showFps: !!this.settings.showFps,
      vibrate: this.settings.vibrate !== false,
    });
  }

  _syncSettingsInputs() {
    if (this.built && this.settingsPanel) this.settingsPanel.syncInputs();
  }

  setQuality(quality) {
    if (!QUALITIES.includes(quality)) return;
    this.settings.quality = quality;
    this._saveSettings();
    if (this.root) this.root.style.setProperty('--quality', quality);
    this._syncSettingsInputs();
    this._emitSettings();
  }

  _setShowFps(flag) {
    this.settings.showFps = !!flag;
    this._saveSettings();
    if (!this.built) return;
    this.applyFpsVisibility();
    this._syncSettingsInputs();
  }

  /** Public hook (QA / console): show or hide the frame counter, persisted. */
  setShowFps(enabled) {
    this._setShowFps(enabled !== false);
    return this.settings.showFps;
  }

  applyFpsVisibility() {
    if (!this.built || !this.root) return;
    const visible = !!this.settings.showFps;
    this.root.classList.toggle('is-fps-off', !visible);
    if (!visible) return;
    // Freshly re-enabled: repaint right away instead of waiting for the next
    // rate-limited refresh slot.
    if (this.perfMeter) this.perfMeter.setVisible(true);
  }

  _setVibrate(flag) {
    this.settings.vibrate = flag !== false;
    this._saveSettings();
    if (!this.built) return;
    this._syncSettingsInputs();
    this._emitSettings();
  }

  setVibrate(flag) {
    this._setVibrate(flag);
  }

  _setSensitivity(value) {
    this.settings.sensitivity = clamp(num(value, 1), 0.25, 3);
    this._saveSettings();
    if (this.root) this.root.style.setProperty('--sens', String(this.settings.sensitivity));
    this._syncSettingsInputs();
    this._emitSettings();
  }

  setSensitivity(value) {
    this._setSensitivity(value);
  }

  _setVolume(value) {
    this.settings.volume = clamp(num(value, 0), 0, 1);
    this._saveSettings();
    this._applyAudioSettings();
    if (this.root) this.root.style.setProperty('--vol', String(this.settings.volume));
    this._syncSettingsInputs();
    this._emitSettings();
  }

  setVolume(value) {
    this._setVolume(value);
  }

  _setMuted(flag) {
    this.settings.muted = !!flag;
    this._saveSettings();
    this._applyAudioSettings();
    this._syncSettingsInputs();
    this._emitSettings();
  }

  setMuted(flag) {
    this._setMuted(flag);
  }

  _setDifficulty(difficulty) {
    if (!isDifficultyId(difficulty)) return;
    this.settings.difficulty = difficulty;
    this._saveSettings();
    this._syncSettingsInputs();
    if (this.deploy) this.deploy.syncDefault(difficulty);
    this._emitSettings();
  }

  setDifficulty(difficulty) {
    this._setDifficulty(difficulty);
  }

  // --- Fullscreen (browser session state; intentionally NOT persisted) -----

  toggleFullscreen() {
    if (this.disposed) return;
    const doc = document;
    if (doc.fullscreenEnabled === false) {
      if (this.built) this.notify({ text: '当前环境不支持全屏 // FULLSCREEN UNSUPPORTED', type: 'warn' });
      this.syncFullscreen();
      return;
    }
    if (this._fsPending) return;
    this._fsPending = true;
    const finish = () => {
      this._fsPending = false;
      this.syncFullscreen();
    };
    const fail = () => {
      finish();
      if (this.built) this.notify({ text: '全屏请求被浏览器拒绝 // FULLSCREEN DENIED', type: 'warn' });
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

  syncFullscreen() {
    if (this.built && this.settingsPanel) this.settingsPanel.syncFullscreen();
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

    const shell = document.createElement('div');
    shell.className = 'ui-shell';
    shell.innerHTML = [
      hudMarkup(this),
      loadingMarkup(this),
      homeMarkup(this),
      pauseMarkup(this),
      endMarkup(this),
      deployMarkup(this),
    ].join('');

    root.appendChild(shell);
    this.el = shell;
    this.built = true;
    this.refs = { screens: qa(shell, '[data-screen-panel]') };

    // Functional-area panels: each owns its markup subtree + refs + bus wiring.
    this.loading = new LoadingPanel(this, shell);
    this.home = new HomePanel(this, shell);
    this.hud = new HudPanel(this, shell);
    this.pause = new PausePanel(this, shell);
    this.end = new EndPanel(this, shell);
    this.deploy = new DeployPanel(this, shell);
    this.stageSelect = new StageSelectPanel(this, shell);
    this.perfMeter = new PerfMeter(this, shell);
    this.settingsPanel = new SettingsPanel(this, shell);

    this.applyFpsVisibility();
  }

  _bindDom() {
    this.el.addEventListener('click', (event) => {
      const qualityButton = event.target.closest('[data-quality-value]');
      if (qualityButton) {
        this.clickSound();
        this.setQuality(qualityButton.dataset.qualityValue);
        return;
      }
      const deployButton = event.target.closest('[data-deploy-value]');
      if (deployButton) {
        this.clickSound();
        if (this.deploy) this.deploy.choose(deployButton.dataset.deployValue);
        return;
      }
      const difficultyButton = event.target.closest('[data-difficulty-value]');
      if (difficultyButton) {
        this.clickSound();
        this.setDifficulty(difficultyButton.dataset.difficultyValue);
        return;
      }
      const stageButton = event.target.closest('[data-stage-value]');
      if (stageButton) {
        this.clickSound();
        if (stageButton.disabled) return;
        this.pickStage(stageButton.dataset.stageValue);
        return;
      }
      const actionEl = event.target.closest('[data-action]');
      if (!actionEl || actionEl.disabled) return;
      this.clickSound();
      this._handleAction(actionEl.dataset.action);
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
      if (key === 'sensitivity') this.setSensitivity(value);
      else if (key === 'volume') this.setVolume(value / 100);
    });
  }

  _handleAction(action) {
    switch (action) {
      case 'start': this.openDeploy('new'); break;
      case 'continue': this.continueCampaignRun(); break;
      case 'stage-select': this.openStageSelect(); break;
      case 'stage-back': this.closeStageSelect(); break;
      case 'pick-stage': break; // handled by the [data-stage-value] click delegation
      case 'deploy-back': this.deployBack(); break;
      case 'next-stage': this.nextStageRun(); break;
      case 'resume': this.resumeRun(); break;
      case 'restart':
        // Pause keeps the old difficulty chooser (restart mode); the end screens
        // restart instantly from the stage-start snapshot.
        if (this.state === 'paused') this.openDeploy('restart');
        else this.restartRun();
        break;
      case 'menu': this.goMenu(); break;
      case 'pause': this.pauseRun(); break;
      case 'mute': this.setMuted(!this.settings.muted); break;
      case 'fps': this.setShowFps(!this.settings.showFps); break;
      case 'vibrate': this.setVibrate(!this.settings.vibrate); break;
      case 'fullscreen': this.toggleFullscreen(); break;
      case 'focus-settings': this.openSettings(); break;
      case 'settings-close': this.closeSettings(); break;
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
        this.clickSound();
        this.setShowFps(!this.settings.showFps);
        return;
      }
      if (event.code === 'Escape') {
        // Second-level menus close before the screen-level pause/resume action.
        if (this.isSettingsOpen()) {
          event.preventDefault();
          this.closeSettings();
          return;
        }
        if (this.deployOpen) {
          event.preventDefault();
          this.deployBack();
          return;
        }
        if (this.stageSelectOpen) {
          event.preventDefault();
          this.closeStageSelect();
          return;
        }
        if (this.state === 'playing') {
          event.preventDefault();
          this.pauseRun();
        } else if (this.state === 'paused') {
          event.preventDefault();
          this.resumeRun();
        }
        return;
      }
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        // The second-level menu owns ENTER while it is open.
        if (this.isSettingsOpen()) return;
        if (this.deployOpen) {
          event.preventDefault();
          this.clickSound();
          if (this.deploy) this.deploy.chooseDefault();
          return;
        }
        if (this.stageSelectOpen) return;
        if (this.state === 'menu' && this.ready) {
          event.preventDefault();
          this.clickSound();
          this.openDeploy('new');
        } else if (this.state === 'dead' && this._endVisible) {
          event.preventDefault();
          this.clickSound();
          this.restartRun();
        } else if (this.state === 'victory' && this._endVisible) {
          event.preventDefault();
          this.clickSound();
          const result = this.data.result;
          if (result && result.unlockedNext && result.nextStageId) this.nextStageRun();
          else this.restartRun();
        }
      }
    };
    window.addEventListener('keydown', this._keyHandler);

    // Fullscreen can change outside our buttons (browser UI / OS / script), so
    // mirror the real document state into the settings panels on every change.
    this._fsHandler = () => this.syncFullscreen();
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
    bind('game:ready', () => this._onReady());
    bind('game:state', (detail) => this._onState(detail));
    // Controller layer (GAMEPAD_SPEC.md §6.4). The module owns polling; the UI
    // mirrors state and routes menu intents to the same actions the keyboard
    // and menu buttons use.
    bind('gamepad:state', (detail) => this._onGamepadState(detail));
    bind('gamepad:notice', (detail) => this.notify(detail));
    bind('gamepad:toggle-pause', () => {
      // While the second-level menu is open, START dismisses it first.
      if (this.isSettingsOpen()) { this.closeSettings(); return; }
      if (this.deployOpen) { this.deployBack(); return; }
      if (this.stageSelectOpen) { this.closeStageSelect(); return; }
      if (this.state === 'playing') this.pauseRun();
      else if (this.state === 'paused') this.resumeRun();
    });
    bind('gamepad:back', () => {
      if (this.isSettingsOpen()) { this.closeSettings(); return; }
      if (this.deployOpen) { this.deployBack(); return; }
      if (this.stageSelectOpen) { this.closeStageSelect(); return; }
      if (this.state === 'paused') { this.resumeRun(); return; }
      if ((this.state === 'dead' || this.state === 'victory') && this._endVisible) {
        this.goMenu();
      }
    });
  }

  // =========================================================================
  // Core event handlers
  // =========================================================================

  _onReady() {
    this.ready = true;
    this.data.loading.progress = 1;
    this.data.loading.label = 'SYSTEM READY // 系统就绪';
    if (this.built) {
      this.loading.render();
      this.home.setStartEnabled(true);
      this.root.classList.add('is-ready');
      this.later(() => {
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
      this.home.renderBest();
      this.home.renderClock();
      return;
    }
    if (next === 'playing') {
      this._setScreen('playing');
      this.pause.renderStats();
      return;
    }
    if (next === 'paused') {
      this.pause.renderStats();
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
        this.hud.renderWave();
        this._scheduleEnd(next === 'dead' ? 'death' : 'victory', next === 'dead' ? 1050 : 1000);
      }
    }
  }

  /**
   * Mirrors `gamepad:state` (§3.6) into the document class, the settings rows,
   * the control legend and the contextual key hints. Notices fire only on a
   * real transition — the first poll at boot must not flash a connect notice.
   */
  _onGamepadState(detail) {
    const connected = !!detail.connected;
    const rawKind = typeof detail.kind === 'string' ? detail.kind.toLowerCase() : '';
    const kind = ['xbox', 'playstation', 'switch', 'generic'].includes(rawKind) ? rawKind : '';
    const firstPoll = !this._padKnown;
    const changed = !firstPoll && connected !== !!this.pad.connected;
    this._padKnown = true;
    this.pad = {
      connected,
      id: typeof detail.id === 'string' ? detail.id : '',
      kind,
      mapping: typeof detail.mapping === 'string' ? detail.mapping : '',
    };
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('is-gamepad', connected);
    }
    if (!this.built) return;
    this.settingsPanel.syncPadStatus();
    this.settingsPanel.renderControlsLegend();
    this.hud.refreshHints();
    this.home.refreshHints();
    this.pause.refreshHints();
    this.end.refreshHints();
    if (changed) {
      this.notify(connected
        ? { text: 'CONTROLLER ONLINE // 手柄已连接', type: 'info' }
        : { text: 'CONTROLLER LOST // 手柄已断开', type: 'warn' });
    }
  }

  // =========================================================================
  // Screens / actions
  // =========================================================================

  _setScreen(name) {
    this.state = name;
    if (!this.built) return;
    if (this.isSettingsOpen()) this.closeSettings();
    if (this.deployOpen) this.closeDeploy();
    if (this.stageSelectOpen) this.closeStageSelect();
    this.root.dataset.screen = name;
    for (const screen of this.refs.screens) {
      screen.classList.toggle('is-active', screen.dataset.screenPanel === name);
    }
    if (name !== 'loading') this.root.classList.add('is-booted');

    this.hud.setScreen(name);
    this.home.setScreen(name);
    this.pause.setScreen(name);
    this.end.setScreen(name);

    if (name === 'menu') {
      this._pendingEnd = null;
      this._endVisible = false;
      this._clearEndTimer();
      this.home.renderBest();
      this.home.renderClock();
      // Re-read src/save.js: a cleared stage unlocks CONTINUE / stage-select
      // state the moment the player lands back on the menu.
      this.home.renderSaveState();
    } else if (name === 'playing') {
      this.root.classList.remove('is-dying', 'is-victorious');
      this._endVisible = false;
      this._clearEndTimer();
    } else if (name === 'paused') {
      this.pause.renderStats();
    } else if (name === 'dead' || name === 'victory') {
      this._endVisible = true;
      this.end.render();
    }
    this.hud.renderVitals();
    this.syncFullscreen();
  }

  _scheduleEnd(kind, delay) {
    this._clearEndTimer();
    this._pendingEnd = kind;
    this._endTimer = this.later(() => {
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
      this._timers.delete(this._endTimer);
      this._endTimer = 0;
    }
  }

  _resetRun() {
    this._runTime = 0;
    this.data.stats = {
      health: 100, maxHealth: 100, armor: 100, maxArmor: 100,
      mag: 30, magSize: 30, reserve: 300, reloading: false, reloadProgress: 0,
      weaponName: 'VXR-7 突击步枪', weaponType: 'vxr7', weaponMode: 'auto', weaponShort: 'VXR-7', slotIndex: 0,
      ads: false, sprinting: false, alive: true,
      damageMultiplier: 1, magExtension: 0, reloadBonus: 0,
      damageReduction: 0, healthBonus: 0,
    };
    this.data.wave = { current: 1, total: 15, remaining: 0, label: '', count: 0, initialCount: 0, killed: 0, cleared: 0 };
    this.data.score = { score: 0, combo: 0, multiplier: 1 };
    this.data.kills = 0;
    this.data.end = null;
    this.data.result = null;
    this.data.weaponSlots = null;
    this.data.boss = null;
    if (this.built) {
      this.hud.resetRun();
      this.pause.renderStats();
    }
  }

  _syncAll() {
    if (!this.built) return;
    this.loading.render();
    this.settingsPanel.syncInputs();
    this.settingsPanel.renderControlsLegend();
    this.settingsPanel.syncFullscreen();
    this.hud.renderAll();
    this.home.setStartEnabled(this.ready);
    this.home.renderBest();
    this.home.renderClock();
    this.pause.renderStats();
    this.hud.refreshHints();
    this.home.refreshHints();
    this.pause.refreshHints();
    this.end.refreshHints();
    this.applyFpsVisibility();
  }

  /**
   * Shared "leave the menu and show the HUD" half of every campaign entry:
   * clears the transient submenus, resets the run HUD data and switches the
   * screen *before* the synchronous `ui:*` emit so the game can start immediately
   * inside the click gesture (pointer lock). The game re-emits `game:stage` /
   * `game:difficulty` / `game:state`; UI data wins from there.
   */
  _beginRunScreen() {
    this.closeStageSelect();
    this.closeDeploy();
    this.closeSettings();
    this._unlockAudio();
    this._resetRun();
    this._setScreen('playing');
  }

  /**
   * Legacy entry point kept for QA / `ENTER`: main.js bridges `ui:start` to
   * "continue when a save exists, otherwise start a new campaign".
   */
  startRun() {
    if (this.disposed || !this.ready) return;
    if (this.state === 'playing') return;
    this._beginRunScreen();
    // Synchronous emit: main requests pointer lock inside this gesture.
    emit('ui:start', {});
  }

  /** NEW GAME difficulty pick → `ui:new-game { difficulty }` (CONTRACT §4). */
  startNewCampaign(difficulty) {
    if (this.disposed || !this.ready) return;
    const id = isDifficultyId(difficulty) ? difficulty : this.settings.difficulty;
    this._beginRunScreen();
    emit('ui:new-game', { difficulty: id });
  }

  /** CONTINUE → `ui:continue {}`; main resolves the target from src/save.js. */
  continueCampaignRun() {
    if (this.disposed || !this.ready) return;
    if (this.state === 'playing') return;
    this._beginRunScreen();
    emit('ui:continue', {});
  }

  /** Stage-select difficulty pick → `ui:select-stage { stageId, difficulty }`. */
  deployToStage(stageId, difficulty) {
    if (this.disposed || !this.ready) return;
    const id = isDifficultyId(difficulty) ? difficulty : this.settings.difficulty;
    this._beginRunScreen();
    emit('ui:select-stage', { stageId, difficulty: id });
  }

  /** Pause restart difficulty pick → `ui:restart { difficulty }`. */
  restartStageRun(difficulty) {
    if (this.disposed) return;
    const detail = isDifficultyId(difficulty) ? { difficulty } : {};
    this._beginRunScreen();
    emit('ui:restart', detail);
  }

  /** Victory "NEXT STAGE" → `ui:next-stage {}`; main advances the campaign. */
  nextStageRun() {
    if (this.disposed) return;
    this._beginRunScreen();
    emit('ui:next-stage', {});
  }

  /** Death / victory REDEPLOY+REPLAY STAGE: restart from the stage-start snapshot. */
  restartRun() {
    if (this.disposed) return;
    this.restartStageRun();
  }

  resumeRun() {
    if (this.disposed) return;
    this.closeSettings();
    this._unlockAudio();
    this._setScreen('playing');
    emit('ui:resume', {});
  }

  pauseRun() {
    if (this.disposed) return;
    if (this.state !== 'playing') return;
    this.closeSettings();
    this.pause.renderStats();
    this._setScreen('paused');
    emit('ui:pause', {});
  }

  goMenu() {
    if (this.disposed) return;
    this._clearEndTimer();
    this._endVisible = false;
    this._setScreen('menu');
    emit('ui:menu', {});
  }

  openSettings() {
    if (!this.built || !this.settingsPanel) return;
    if (this.state !== 'menu' && this.state !== 'paused') return;
    this.settingsPanel.open(this.state === 'paused' ? 'pause' : 'menu');
  }

  closeSettings() {
    if (this.built && this.settingsPanel) this.settingsPanel.close();
  }

  /**
   * Open the difficulty chooser.
   * @param {'new'|'start'|'stage'|'restart'} mode
   * @param {{stageId?: string}} [options]
   */
  openDeploy(mode, options) {
    if (this.disposed || !this.built || !this.deploy) return;
    const normalized = mode === 'stage' || mode === 'restart' ? mode : 'new';
    if (normalized === 'new' && (!this.ready || this.state === 'playing')) return;
    if (normalized === 'restart' && this.state !== 'paused' && this.state !== 'menu') return;
    this.closeStageSelect();
    this.settingsPanel.syncInputs();
    this.deploy.open(normalized, options || {});
  }

  closeDeploy() {
    if (this.deploy) this.deploy.close();
  }

  /** Back from the chooser: menu (new/restart) or the stage list (stage mode). */
  deployBack() {
    if (!this.deployOpen) return;
    const fromStage = this.deploy && this.deploy.mode === 'stage';
    this.closeDeploy();
    if (fromStage) this.openStageSelect();
  }

  /** Open the campaign stage list (menu only). */
  openStageSelect() {
    if (this.disposed || !this.built || !this.stageSelect) return;
    if (this.state !== 'menu') return;
    this.closeSettings();
    this.closeDeploy();
    this.stageSelect.open();
  }

  closeStageSelect() {
    if (this.stageSelect) this.stageSelect.close();
  }

  /** Unlocked stage card → difficulty chooser in `stage` mode (CONTRACT §8). */
  pickStage(stageId) {
    if (!getStage(stageId)) return;
    if (this.state !== 'menu') return;
    this.openDeploy('stage', { stageId });
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
    this.perfMeter.sample(now);
    const dt = clamp((now - (this._lastFrame || now)) / 1000, 0, 0.05);
    this._lastFrame = now;

    if (this.state === 'playing') this._runTime += dt;

    this.hud.tick(now, dt);
    this.loading.tick(now);
    this.home.tick(now);
    this.pause.tick(now);
    if (this.settings.showFps && this.built) this.perfMeter.tick(now);
  }

  // =========================================================================
  // Teardown
  // =========================================================================

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
    this._clearEndTimer();
    for (const panel of [this.hud, this.home, this.loading, this.pause, this.end, this.deploy, this.stageSelect, this.settingsPanel, this.perfMeter]) {
      try { panel?.dispose?.(); } catch (_) { /* ignore */ }
    }
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
    this.loading = null;
    this.home = null;
    this.hud = null;
    this.pause = null;
    this.end = null;
    this.deploy = null;
    this.stageSelect = null;
    this.settingsPanel = null;
    this.perfMeter = null;
    this.built = false;
  }
}

export default UI;
