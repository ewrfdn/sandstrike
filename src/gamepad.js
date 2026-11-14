/**
 * SANDSTRIKE — gamepad / controller input layer.
 *
 * Contract: GAMEPAD_SPEC.md §2 + §3 (+ §4 player virtual API, §5 main wiring).
 *
 * - detectGamepadSupport(): feature detection for the browser Gamepad API.
 * - GamepadControls: polls navigator.getGamepads() once per animation frame and
 *   forwards controller input through the *virtual input* API (player pad fields,
 *   WeaponSystem setters) — never synthetic DOM keyboard events. It also owns the
 *   controller-only DOM focus ring for the menus (`.gp-focus`), rumble and the
 *   hot-plug / controller-status bus events.
 *
 * Plain ES module: no build step, no external assets, no Three.js imports. Every
 * player/weapon/DOM call is feature-detected so a partially wired build can never
 * throw. The constructor keeps zero per-frame work until update() is called.
 */
import { on, emit } from './bus.js';
import { clamp, damp } from './utils.js';

// --- Gameplay feel constants (GAMEPAD_SPEC.md §3.4) ------------------------
const PAD_MOVE_DEADZONE = 0.16;
const PAD_LOOK_DEADZONE = 0.20;
const PAD_LOOK_SPEED = 2.9; // rad/s at full deflection, sensitivity = 1
const PAD_LOOK_CURVE = 1.55;
const PAD_LOOK_ADS_SCALE = 0.55; // multiplier while weapon.ads > 0.5
const PAD_LOOK_DAMP = 22; // velocity smoothing lambda (utils.damp)
const PAD_TRIGGER_THRESHOLD = 0.32;
const PAD_MENU_REPEAT_DELAY = 0.42; // s before first auto-repeat
const PAD_MENU_REPEAT_RATE = 0.13; // s between repeats
const PAD_RUMBLE_MIN_INTERVAL = 0.05; // s throttle
const PAD_ACTIVE_TIMEOUT = 2.0; // s, for `active`

// --- Standard mapping indices (GAMEPAD_SPEC.md §3.3) ----------------------
const BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11,
  DUP: 12, DDOWN: 13, DLEFT: 14, DRIGHT: 15,
};
const PAD_BUTTON_COUNT = 17;

/** Stick magnitudes above this count as a menu navigation direction. */
const PAD_STICK_NAV_THRESHOLD = 0.55;
/** Analog trigger/button "pressed" hysteresis for snapshot tracking. */
const PAD_BUTTON_VALUE_EPSILON = 0.05;

const VALID_STATES = new Set(['menu', 'playing', 'paused', 'dead', 'victory', 'boot']);

const CONNECT_NOTICE = 'CONTROLLER ONLINE // 手柄已连接';
const DISCONNECT_NOTICE = 'CONTROLLER LOST // 手柄已断开';

/** Trigger → rumble pulse table (GAMEPAD_SPEC.md §3.4). */
const RUMBLE_PULSES = [
  ['weapon:fired', 0.18, 0.05, 55],
  ['enemy:hitmarker', 0.25, 0.12, 60],
  ['enemy:killed', 0.50, 0.35, 110],
  ['player:hit', 0.85, 0.65, 150],
];

/** Shared empty inputs so the poll loop never allocates fallback arrays. */
const EMPTY_AXES = [0, 0, 0, 0];
const EMPTY_BUTTONS = [];
const NO_CANDIDATES = [];

/** True when this browser exposes the Gamepad API (feature detection only). */
export function detectGamepadSupport() {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  } catch {
    return false;
  }
}

/** Map a raw Gamepad.id to the controller family used by the UI legend. */
function detectPadKind(id) {
  const text = String(id || '').toLowerCase();
  if (!text) return 'generic';
  if (/(xbox|xinput|045e|microsoft)/.test(text)) return 'xbox';
  if (/(playstation|dualshock|dualsense|sony|054c|wireless controller)/.test(text)) return 'playstation';
  if (/(switch|nintendo|joy-con|joycon|057e|pro controller)/.test(text)) return 'switch';
  return 'generic';
}

export class GamepadControls {
  /**
   * @param {object} [options]
   * @param {object|null} [options.player]   Player instance (GAMEPAD_SPEC.md §4 API).
   * @param {object|null} [options.weapon]   WeaponSystem instance (setTrigger/setAiming/startReload).
   * @param {object} [options.settings]      { sensitivity = 1, vibrate = true }.
   */
  constructor({ player = null, weapon = null, settings = {} } = {}) {
    this.player = player || null;
    this.weapon = weapon || null;

    const opts = settings && typeof settings === 'object' ? settings : {};
    const sensitivity = Number(opts.sensitivity);
    this._sensitivity = clamp(Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1, 0.25, 3);
    this._vibrationEnabled = opts.vibrate !== false;

    this._supported = detectGamepadSupport();
    this._disposed = false;
    this._gameState = 'boot';

    // --- pad / connection state -------------------------------------------
    this._pad = null;
    this._padCount = 0;
    this._connected = false;
    this._id = '';
    this._kind = '';
    this._mapping = '';
    this._polledOnce = false;
    this._activeTimer = PAD_ACTIVE_TIMEOUT + 1; // inactive until the first input
    // Set by gamepadconnected/gamepaddisconnected between polls; forces the next
    // poll to re-baseline button edges so a device swap cannot emit phantom edges.
    this._hotplugDirty = false;

    // --- polled snapshot (muted arrays: no per-frame allocation) ----------
    this._axes = [0, 0, 0, 0];
    this._buttonValues = new Array(PAD_BUTTON_COUNT).fill(0);
    this._curDown = new Array(PAD_BUTTON_COUNT).fill(0);
    this._prevDown = new Array(PAD_BUTTON_COUNT).fill(0);
    this._edge = new Array(PAD_BUTTON_COUNT).fill(0);
    this._syncButtonsOnNextPoll = false;

    // --- virtual input state (changed values are forwarded only on change) -
    this._moveX = 0;
    this._moveF = 0;
    this._sprintOn = false;
    this._crouchOn = false; // toggle owned by this module (B edge)
    this._triggerSent = false; // last boolean handed to weapon.setTrigger
    this._aimSent = false; // last boolean handed to weapon.setAiming
    this._lookYawVel = 0;
    this._lookPitchVel = 0;
    this._rumbleCount = 0;
    this._lastRumble = null;
    this._lastRumbleAt = -Infinity;

    // --- menu focus ring ---------------------------------------------------
    this._focusEl = null;
    this._suspendFocus = false; // mouse/pointer user takes over until pad nav
    this._focusDirty = true;
    this._focusRetryFrames = 0; // first focus can land mid visibility transition
    this._deployEl = null; // cached [data-deploy] root
    this._settingsEl = null; // cached [data-settings] overlay of the active screen
    this._activeScreen = null; // cached .screen.is-active
    this._startEl = null; // cached [data-start] (enable watcher)
    this._lastSigState = '';
    this._lastDeployOpen = false;
    this._lastSettingsOpen = false;
    this._lastScreen = null;
    this._lastStartDisabled = null;
    this._navKey = 0;
    this._navRepeatAccum = 0;
    this._navNextDelay = PAD_MENU_REPEAT_DELAY;
    this._navDirX = 0;
    this._navDirY = 0;

    // --- listeners (stored so dispose() removes every one) ----------------
    this._offs = [];
    this._onWindowBlur = () => this.releaseAll();
    this._onVisibilityChange = () => {
      try {
        if (typeof document !== 'undefined' && document.hidden) this.releaseAll();
      } catch {
        /* ignore */
      }
    };
    this._onPointerDown = () => this._suspendFocusRing();
    this._onPadConnected = () => { this._hotplugDirty = true; };
    this._onPadDisconnected = () => { this._hotplugDirty = true; };

    try {
      // Game state drives reset/release policy (§3.7).
      this._offs.push(on('game:state', (detail) => this._onGameState(detail)));
      // Rumble mirror of combat events (§3.4).
      for (let i = 0; i < RUMBLE_PULSES.length; i++) {
        const pulse = RUMBLE_PULSES[i];
        this._offs.push(on(pulse[0], () => this._rumble(pulse[1], pulse[2], pulse[3])));
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('blur', this._onWindowBlur);
        window.addEventListener('gamepadconnected', this._onPadConnected);
        window.addEventListener('gamepaddisconnected', this._onPadDisconnected);
      }
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', this._onVisibilityChange);
        document.addEventListener('pointerdown', this._onPointerDown, { passive: true, capture: true });
      }
    } catch {
      /* construction must never throw — a missing DOM just means no focus ring */
    }
  }

  // =========================================================================
  // Public API (§3.2)
  // =========================================================================

  get supported() { return this._supported; }
  get connected() { return this._connected; }
  get active() { return this._connected && this._activeTimer <= PAD_ACTIVE_TIMEOUT; }
  get id() { return this._id; }
  get kind() { return this._kind; }
  get mapping() { return this._mapping; }
  get vibrationEnabled() { return this._vibrationEnabled; }
  get gameState() { return this._gameState; }

  /** Look sensitivity multiplier from settings (0.25..3). */
  setSensitivity(mult) {
    const value = Number(mult);
    this._sensitivity = clamp(Number.isFinite(value) && value > 0 ? value : 1, 0.25, 3);
  }

  /** Rumble on/off (the UI persists the setting; this module only stores it). */
  setVibrationEnabled(on) {
    this._vibrationEnabled = !!on;
  }

  /**
   * One polling + input step. Safe in every game state (menus navigate here).
   * @param {number} [dt] seconds since the last update (clamped to 0..0.1)
   */
  update(dt = 1 / 60) {
    if (this._disposed) return;
    let step = Number(dt);
    if (!Number.isFinite(step)) step = 1 / 60;
    step = clamp(step, 0, 0.1);

    // `active` = any pad input within the last PAD_ACTIVE_TIMEOUT seconds.
    if (this._activeTimer <= PAD_ACTIVE_TIMEOUT) {
      this._activeTimer = Math.min(PAD_ACTIVE_TIMEOUT + 1, this._activeTimer + step);
    }

    this._pollPad();
    if (!this._pad) {
      if (this._focusEl) this._clearFocusRing();
      return;
    }

    this._readSnapshot();

    if (this._gameState === 'playing') {
      if (this._focusEl) this._clearFocusRing();
      this._updateGameplay(step, this._edge);
      // START toggles pause/resume through the bus; UI owns the actual state.
      if (this._edge[BTN.START] && this._gameState === 'playing') {
        this._emitAction('pause');
        emit('gamepad:toggle-pause', {});
      }
      this._copyEdges();
      return;
    }

    this._updateFocus(step);
    this._updateMenuInput(step, this._edge);
    this._copyEdges();
  }

  /**
   * Release every virtual input this module owns. Safe to call at any time:
   * zeroes the player pad axes/sprint/crouch and only clears the weapon
   * trigger/aiming if this module was the one holding them.
   */
  releaseAll() {
    try {
      this._moveX = 0;
      this._moveF = 0;
      this._sprintOn = false;
      this._crouchOn = false;
      this._lookYawVel = 0;
      this._lookPitchVel = 0;
      this._navKey = 0;
      this._navRepeatAccum = 0;
      this._resetPolledSnapshot();
      this._invoke(this.player, 'setPadMoveInput', 0, 0);
      this._invoke(this.player, 'setPadSprintHeld', false);
      this._invoke(this.player, 'setPadCrouchHeld', false);
      if (this._triggerSent) {
        this._triggerSent = false;
        this._invoke(this.weapon, 'setTrigger', false);
      }
      if (this._aimSent) {
        this._aimSent = false;
        this._invoke(this.weapon, 'setAiming', false);
      }
    } catch {
      /* release must never throw */
    }
  }

  /** Remove every listener, release inputs and drop the controller styling. Idempotent. */
  dispose() {
    if (this._disposed) return;
    try { this.releaseAll(); } catch { /* ignore */ }
    this._disposed = true;

    for (let i = 0; i < this._offs.length; i++) {
      try { this._offs[i](); } catch { /* ignore */ }
    }
    this._offs.length = 0;

    try {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('blur', this._onWindowBlur);
        window.removeEventListener('gamepadconnected', this._onPadConnected);
        window.removeEventListener('gamepaddisconnected', this._onPadDisconnected);
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
        document.removeEventListener('pointerdown', this._onPointerDown, true);
      }
    } catch {
      /* ignore */
    }

    this._clearFocusRing();
    this._setHtmlClass(false);
    this._pad = null;
    this._padCount = 0;
    this._connected = false;
    this._id = '';
    this._kind = '';
    this._mapping = '';
    this.player = null;
    this.weapon = null;
    this._focusDirty = false;
  }

  /** QA snapshot (§3.8). Allocates, but only when explicitly asked for. */
  getState() {
    const axes = this._axes;
    const buttonsDown = [];
    for (let i = 0; i < PAD_BUTTON_COUNT; i++) {
      if (this._curDown[i] || this._buttonValues[i] > PAD_BUTTON_VALUE_EPSILON) buttonsDown.push(i);
    }
    const lastRumble = this._lastRumble
      ? { weak: this._lastRumble.weak, strong: this._lastRumble.strong, ms: this._lastRumble.ms, at: this._lastRumble.at }
      : null;
    return {
      supported: this._supported,
      connected: this._connected,
      active: this.active,
      id: this._id,
      kind: this._kind,
      mapping: this._mapping,
      axes: [
        Math.round(axes[0] * 1000) / 1000,
        Math.round(axes[1] * 1000) / 1000,
        Math.round(axes[2] * 1000) / 1000,
        Math.round(axes[3] * 1000) / 1000,
      ],
      buttonsDown,
      focused: this._describeFocus(),
      gameState: this._gameState,
      vibrationEnabled: this._vibrationEnabled,
      rumbleCount: this._rumbleCount,
      lastRumble,
      triggerSent: this._triggerSent,
      aimSent: this._aimSent,
      padCount: this._padCount,
    };
  }

  // =========================================================================
  // Game state / lifecycle (§3.7)
  // =========================================================================

  _onGameState(detail) {
    if (this._disposed) return;
    const state = detail && typeof detail.state === 'string' ? detail.state : '';
    if (!VALID_STATES.has(state) || state === this._gameState) return;
    this._gameState = state;

    if (state === 'playing') {
      // Fresh run / resume: per-run toggles reset, menu ring goes away.
      this._crouchOn = false;
      this._invoke(this.player, 'setPadCrouchHeld', false);
      this._clearFocusRing();
      this._suspendFocus = false;
      this._navKey = 0;
      this._navRepeatAccum = 0;
      this._syncButtonsOnNextPoll = true;
      return;
    }

    this.releaseAll();
    // Focus policy for the screen we are about to show is applied next update.
    this._focusDirty = true;
  }

  // =========================================================================
  // Polling / connection state (§2, §3.6, §3.7)
  // =========================================================================

  /** Poll the Gamepad API, keep the first connected pad and emit state changes. */
  _pollPad() {
    let list = null;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
        list = navigator.getGamepads();
      }
    } catch {
      list = null;
    }

    let pad = null;
    let count = 0;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const candidate = list[i];
        if (!candidate || candidate.connected === false) continue;
        count += 1;
        if (!pad) pad = candidate; // first connected non-null wins
      }
    }

    // A hot-plug event landed between polls: the device list/identity may have
    // swapped without an id/kind difference, so re-baseline button edges below.
    if (this._hotplugDirty) {
      this._hotplugDirty = false;
      this._syncButtonsOnNextPoll = true;
    }

    if (!pad) {
      const wasConnected = this._connected;
      this._pad = null;
      this._padCount = 0;
      this._connected = false;
      if (wasConnected) {
        this._id = '';
        this._kind = '';
        this._mapping = '';
        // A quick unplug/replug must not keep `active` warm (pointer-lock skip).
        this._activeTimer = PAD_ACTIVE_TIMEOUT + 1;
        this._setHtmlClass(false);
        this.releaseAll();
        this._emitState('disconnect');
        emit('gamepad:notice', { text: DISCONNECT_NOTICE, type: 'warn' });
      }
      this._polledOnce = true;
      return;
    }

    const nextId = typeof pad.id === 'string' ? pad.id : '';
    const nextMapping = typeof pad.mapping === 'string' ? pad.mapping : '';
    const nextKind = detectPadKind(nextId);
    const wasConnected = this._connected;
    const changed = !wasConnected
      || nextId !== this._id
      || nextKind !== this._kind
      || nextMapping !== this._mapping;

    this._pad = pad;
    this._padCount = count;
    this._connected = true;
    this._id = nextId;
    this._kind = nextKind;
    this._mapping = nextMapping;

    if (!wasConnected) {
      this._setHtmlClass(true);
      this._emitState('connect');
      // The very first poll after boot must not flash a notice (UI §6.4); a real
      // hot-plug afterwards is announced.
      if (this._polledOnce) emit('gamepad:notice', { text: CONNECT_NOTICE, type: 'info' });
      this._syncButtonsOnNextPoll = true;
      this._focusDirty = true;
    } else if (changed) {
      // The winning pad changed (multi-pad switch / a pad re-reporting a new id):
      // start from a clean edge baseline so a held button cannot fire a phantom edge.
      this._syncButtonsOnNextPoll = true;
      this._emitState('poll');
    }
    this._polledOnce = true;
  }

  /** Copy axes/buttons/edges out of the pad into reusable scratch arrays. */
  _readSnapshot() {
    const pad = this._pad;
    const axes = (pad && pad.axes) || EMPTY_AXES;
    const ax = this._axes;
    ax[0] = Number(axes[0]) || 0;
    ax[1] = Number(axes[1]) || 0;
    ax[2] = Number(axes[2]) || 0;
    ax[3] = Number(axes[3]) || 0;

    const buttons = (pad && pad.buttons) || EMPTY_BUTTONS;
    const cur = this._curDown;
    const values = this._buttonValues;
    let input = false;
    for (let i = 0; i < PAD_BUTTON_COUNT; i++) {
      const button = buttons[i];
      let value = 0;
      let down = 0;
      if (button) {
        const raw = button.value;
        value = typeof raw === 'number' && Number.isFinite(raw) ? raw : (button.pressed ? 1 : 0);
        down = button.pressed || value > 0.5 ? 1 : 0;
      }
      values[i] = value;
      cur[i] = down;
      if (down || value > PAD_BUTTON_VALUE_EPSILON) input = true;
    }
    if (!input) {
      if (Math.hypot(ax[0], ax[1]) > PAD_MOVE_DEADZONE) input = true;
      else if (Math.hypot(ax[2], ax[3]) > PAD_LOOK_DEADZONE) input = true;
    }
    if (input) this._activeTimer = 0;

    const prev = this._prevDown;
    const edge = this._edge;
    if (this._syncButtonsOnNextPoll) {
      // A button held across a state transition must not re-fire its edge.
      this._syncButtonsOnNextPoll = false;
      for (let i = 0; i < PAD_BUTTON_COUNT; i++) {
        prev[i] = cur[i];
        edge[i] = 0;
      }
    } else {
      for (let i = 0; i < PAD_BUTTON_COUNT; i++) edge[i] = cur[i] && !prev[i] ? 1 : 0;
    }
  }

  _copyEdges() {
    const prev = this._prevDown;
    const cur = this._curDown;
    for (let i = 0; i < PAD_BUTTON_COUNT; i++) prev[i] = cur[i];
  }

  _resetPolledSnapshot() {
    const ax = this._axes;
    ax[0] = 0; ax[1] = 0; ax[2] = 0; ax[3] = 0;
    for (let i = 0; i < PAD_BUTTON_COUNT; i++) {
      this._buttonValues[i] = 0;
      this._curDown[i] = 0;
      this._prevDown[i] = 0;
      this._edge[i] = 0;
    }
    this._syncButtonsOnNextPoll = true;
  }

  _emitState(source) {
    emit('gamepad:state', {
      supported: this._supported,
      connected: this._connected,
      id: this._id,
      kind: this._kind,
      mapping: this._mapping,
      active: this.active,
      source,
    });
  }

  _setHtmlClass(on) {
    try {
      if (typeof document === 'undefined' || !document.documentElement) return;
      document.documentElement.classList.toggle('is-gamepad', !!on);
    } catch {
      /* ignore */
    }
  }

  // =========================================================================
  // Gameplay forwarding (§3.2, §3.4)
  // =========================================================================

  _updateGameplay(step, edge) {
    const ax = this._axes;
    const values = this._buttonValues;
    const cur = this._curDown;

    // --- left stick: move (radial deadzone + rescale; Player normalises) --
    this._applyDeadzone(ax[0], ax[1], PAD_MOVE_DEADZONE);
    const moveX = this._dzX;
    const moveF = -this._dzY; // stick up (negative axis y) => forward positive
    this._moveX = moveX;
    this._moveF = moveF;
    this._invoke(this.player, 'setPadMoveInput', moveX, moveF);

    // --- LB / L3: sprint hold --------------------------------------------
    const sprint = cur[BTN.LB] === 1 || cur[BTN.L3] === 1;
    if (sprint !== this._sprintOn) {
      this._sprintOn = sprint;
      this._invoke(this.player, 'setPadSprintHeld', sprint);
    }

    // --- B: crouch toggle ------------------------------------------------
    if (edge[BTN.B]) {
      this._crouchOn = !this._crouchOn;
      this._invoke(this.player, 'setPadCrouchHeld', this._crouchOn);
      this._emitAction('crouch');
    }

    // --- A: jump ---------------------------------------------------------
    if (edge[BTN.A]) {
      this._invoke(this.player, 'queueJump');
      this._emitAction('jump');
    }

    // --- X: reload -------------------------------------------------------
    if (edge[BTN.X]) {
      this._invoke(this.weapon, 'startReload');
      this._emitAction('reload');
    }

    // --- RB / D-PAD left-right: cycle carried weapons --------------------
    if (edge[BTN.RB] || edge[BTN.DRIGHT]) {
      this._invoke(this.weapon, 'cycleWeapon', 1);
      this._emitAction('weapon-next');
    }
    if (edge[BTN.DLEFT]) {
      this._invoke(this.weapon, 'cycleWeapon', -1);
      this._emitAction('weapon-prev');
    }

    // --- RT: fire (analog, full-auto while held) — edge-only forwarding ---
    const fire = values[BTN.RT] > PAD_TRIGGER_THRESHOLD;
    if (fire !== this._triggerSent) {
      this._triggerSent = fire;
      this._invoke(this.weapon, 'setTrigger', fire);
      if (fire) this._emitAction('fire');
    }

    // --- LT: ADS (hold) — edge-only forwarding ---------------------------
    const aim = values[BTN.LT] > PAD_TRIGGER_THRESHOLD;
    if (aim !== this._aimSent) {
      this._aimSent = aim;
      this._invoke(this.weapon, 'setAiming', aim);
      if (aim) this._emitAction('ads');
    }

    // --- right stick: look (curve + damped velocity) ---------------------
    const lookMag = this._applyDeadzone(ax[2], ax[3], PAD_LOOK_DEADZONE);
    const ads = !!(this.weapon && typeof this.weapon.ads === 'number' && this.weapon.ads > 0.5);
    const lookSpeed = PAD_LOOK_SPEED * this._sensitivity * (ads ? PAD_LOOK_ADS_SCALE : 1);
    let yawTarget = 0;
    let pitchTarget = 0;
    if (lookMag > 0) {
      // response curve applied to the rescaled magnitude, direction preserved
      const curve = Math.pow(lookMag, PAD_LOOK_CURVE) / lookMag;
      yawTarget = -this._dzX * curve * lookSpeed; // stick right => yaw decreases (look right)
      pitchTarget = -this._dzY * curve * lookSpeed; // stick up => pitch increases
    }
    this._lookYawVel = damp(this._lookYawVel, yawTarget, PAD_LOOK_DAMP, step);
    this._lookPitchVel = damp(this._lookPitchVel, pitchTarget, PAD_LOOK_DAMP, step);
    if (this._lookYawVel !== 0 || this._lookPitchVel !== 0) {
      this._invoke(this.player, 'addLook', this._lookYawVel * step, this._lookPitchVel * step);
    }
  }

  // =========================================================================
  // Menu focus navigation (§3.5)
  // =========================================================================

  _updateMenuInput(step, edge) {
    // A mouse user took over: the first D-pad/stick press brings the ring back.
    const hasNav = this._readNavDirection();
    if (this._suspendFocus && hasNav) {
      this._suspendFocus = false;
      this._focusDirty = false;
      this._refreshDefaultFocus();
    }

    // B / Back: leave the current overlay/screen (UI owns the meaning).
    if (edge[BTN.B] || edge[BTN.BACK]) {
      this._emitAction('back');
      emit('gamepad:back', {});
      this._navKey = 0;
      return;
    }

    // START in pause toggles resume; everywhere else it confirms like A.
    if (edge[BTN.START] && this._gameState === 'paused') {
      this._emitAction('pause');
      emit('gamepad:toggle-pause', {});
      return;
    }
    if (edge[BTN.A] || edge[BTN.START]) {
      this._activateFocused();
      if (this._gameState === 'playing') return; // activation started the run
    }

    // D-pad / stick navigation with edge + auto-repeat timing.
    if (!hasNav) {
      this._navKey = 0;
      this._navRepeatAccum = 0;
      this._navNextDelay = PAD_MENU_REPEAT_DELAY;
      return;
    }
    const key = this._navDirX + this._navDirY * 3;
    if (key !== this._navKey) {
      this._navKey = key;
      this._navRepeatAccum = 0;
      this._navNextDelay = PAD_MENU_REPEAT_DELAY;
      this._applyNav(this._navDirX, this._navDirY);
      return;
    }
    this._navRepeatAccum += step;
    if (this._navRepeatAccum >= this._navNextDelay) {
      this._navRepeatAccum = 0;
      this._navNextDelay = PAD_MENU_REPEAT_RATE;
      this._applyNav(this._navDirX, this._navDirY);
    }
  }

  /** Read the menu navigation direction (D-pad or either stick) without allocating. */
  _readNavDirection() {
    const cur = this._curDown;
    const ax = this._axes;
    let nx = 0;
    let ny = 0;
    if (cur[BTN.DRIGHT]) nx += 1;
    if (cur[BTN.DLEFT]) nx -= 1;
    if (cur[BTN.DDOWN]) ny += 1;
    if (cur[BTN.DUP]) ny -= 1;

    const lx = ax[0];
    const ly = ax[1];
    if (Math.abs(lx) > PAD_STICK_NAV_THRESHOLD || Math.abs(ly) > PAD_STICK_NAV_THRESHOLD) {
      if (Math.abs(lx) >= Math.abs(ly)) nx += lx > 0 ? 1 : -1;
      else ny += ly > 0 ? 1 : -1;
    }
    const rx = ax[2];
    const ry = ax[3];
    if (Math.abs(rx) > PAD_STICK_NAV_THRESHOLD || Math.abs(ry) > PAD_STICK_NAV_THRESHOLD) {
      if (Math.abs(rx) >= Math.abs(ry)) nx += rx > 0 ? 1 : -1;
      else ny += ry > 0 ? 1 : -1;
    }

    if (nx === 0 && ny === 0) {
      this._navDirX = 0;
      this._navDirY = 0;
      return false;
    }
    if (Math.abs(nx) >= Math.abs(ny)) {
      this._navDirX = nx > 0 ? 1 : -1;
      this._navDirY = 0;
    } else {
      this._navDirX = 0;
      this._navDirY = ny > 0 ? 1 : -1;
    }
    return true;
  }

  _applyNav(dirX, dirY) {
    const el = this._focusEl;
    if (el && el.tagName === 'INPUT' && el.type === 'range') {
      // Left/right tweak the focused range input instead of moving the ring.
      if (dirX !== 0) {
        this._adjustRange(dirX);
        return;
      }
    }
    this._navigateSpatial(dirX, dirY);
  }

  _navigateSpatial(dirX, dirY) {
    const candidates = this._collectCandidates();
    if (!this._focusEl || candidates.indexOf(this._focusEl) < 0) {
      this._focusDefault(candidates);
      if (!this._focusEl) return;
    }
    const current = this._focusEl.getBoundingClientRect();
    const cx = current.left + current.width / 2;
    const cy = current.top + current.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el === this._focusEl || el.disabled) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const dx = rect.left + rect.width / 2 - cx;
      const dy = rect.top + rect.height / 2 - cy;
      const forward = dx * dirX + dy * dirY;
      if (forward <= 2) continue;
      const lateral = Math.abs(dy * dirX - dx * dirY);
      const score = forward + 2.2 * lateral;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) this._setFocus(best);
  }

  _activateFocused() {
    if (this._gameState === 'playing') return;
    if (!this._focusEl || !this._focusEl.isConnected) {
      this._focusDirty = false;
      this._refreshDefaultFocus();
    }
    const el = this._focusEl;
    if (!el) return;
    // Range inputs are adjusted with left/right; A does nothing on them (§3.5).
    if (el.tagName === 'INPUT') return;
    if (el.disabled) return;
    try {
      el.click();
    } catch {
      /* synthetic click must never break input */
    }
    this._emitAction('confirm');
  }

  _adjustRange(direction) {
    const el = this._focusEl;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'range') return;
    const set = el.getAttribute('data-set');
    const fallbackStep = set === 'volume' ? 1 : 0.05;
    const parsedStep = Number.parseFloat(el.step);
    const stepSize = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : fallbackStep;
    const min = Number.parseFloat(el.min);
    const max = Number.parseFloat(el.max);
    const current = Number.parseFloat(el.value);
    if (!Number.isFinite(current)) return;
    let next = current + direction * stepSize;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max)) next = Math.min(max, next);
    next = Math.round(next * 10000) / 10000;
    if (!Number.isFinite(next) || next === current) return;
    el.value = String(next);
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      /* ignore */
    }
  }

  // =========================================================================
  // Focus ring bookkeeping (DOM reads only when something changed)
  // =========================================================================

  _updateFocus(step) {
    if (typeof document === 'undefined') return;

    const deploy = this._deployEl || (this._deployEl = document.querySelector('[data-deploy]'));
    const deployOpen = !!(deploy && deploy.classList.contains('is-open'));
    let screen = this._activeScreen;
    if (!screen || !screen.classList.contains('is-active')) {
      screen = document.querySelector('.screen.is-active');
      this._activeScreen = screen;
    }

    // The SYSTEM CONFIG overlay exists once per screen (menu / pause); cache the
    // one belonging to the active screen so open/close can retarget the ring.
    if (!this._settingsEl || !this._settingsEl.isConnected || this._settingsEl.closest('.screen') !== screen) {
      this._settingsEl = screen ? screen.querySelector('[data-settings]') : null;
    }
    const settingsOpen = !!(this._settingsEl && this._settingsEl.classList.contains('is-open'));

    const stateChanged = this._gameState !== this._lastSigState;
    const changed = stateChanged || deployOpen !== this._lastDeployOpen
      || settingsOpen !== this._lastSettingsOpen || screen !== this._lastScreen;
    if (changed) {
      this._lastSigState = this._gameState;
      this._lastDeployOpen = deployOpen;
      this._lastSettingsOpen = settingsOpen;
      this._lastScreen = screen;
      if (!this._suspendFocus) this._focusDirty = true;
    }

    // The focused element can vanish with a UI rebuild; recover next refresh.
    if (this._focusEl && !this._focusEl.isConnected) {
      this._focusEl = null;
      if (!this._suspendFocus) this._focusDirty = true;
    }

    // The menu deploy button starts disabled at boot and is enabled on ready.
    if (this._gameState === 'menu' && !deployOpen) {
      const start = this._startEl || (this._startEl = document.querySelector('[data-start]'));
      if (start) {
        const disabled = !!start.disabled;
        if (this._lastStartDisabled !== disabled) {
          this._lastStartDisabled = disabled;
          if (!this._suspendFocus) this._focusDirty = true;
        }
      }
    }

    if (this._focusDirty && !this._suspendFocus) {
      this._focusDirty = false;
      this._refreshDefaultFocus();
    }

    // The first focus() can land on the very frame a screen starts its CSS
    // visibility transition (`.screen` transitions visibility), where the
    // element is still visibility:hidden and focus() silently fails. Retry on
    // the next few frames until the ring element actually owns DOM focus.
    if (this._focusEl) {
      if (typeof document !== 'undefined' && document.activeElement === this._focusEl) {
        this._focusRetryFrames = 0;
      } else if (!this._suspendFocus && this._focusRetryFrames < 10) {
        this._focusRetryFrames += 1;
        this._attemptFocus(this._focusEl);
      }
    }
  }

  _refreshDefaultFocus() {
    const candidates = this._collectCandidates();
    if (candidates.length === 0) {
      this._clearFocusRing();
      return;
    }
    this._focusDefault(candidates);
  }

  _focusDefault(candidates) {
    const settings = this._settingsEl;
    if (settings && settings.classList.contains('is-open') && candidates.length > 0) {
      const close = settings.querySelector('[data-action="settings-close"]');
      this._setFocus(close || candidates[0]);
      return;
    }
    const deploy = this._deployEl;
    if (deploy && deploy.classList.contains('is-open') && candidates.length > 0) {
      let fallback = null;
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        if (!el.matches('[data-deploy-value]')) continue;
        if (el.classList.contains('is-default')) {
          this._setFocus(el);
          return;
        }
        if (!fallback) fallback = el;
      }
      if (fallback) {
        this._setFocus(fallback);
        return;
      }
    }
    // Priority list: menu START > pause RESUME > end-screen RESTART > first.
    const selectors = ['[data-start]:not([disabled])', '[data-action="resume"]', '[data-action="restart"]'];
    for (let s = 0; s < selectors.length; s++) {
      for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].matches(selectors[s])) {
          this._setFocus(candidates[i]);
          return;
        }
      }
    }
    this._setFocus(candidates[0]);
  }

  _setFocus(el) {
    if (this._focusEl === el || !el) return;
    this._clearFocusRing();
    this._focusEl = el;
    this._focusRetryFrames = 0;
    try {
      el.classList.add('gp-focus');
    } catch {
      /* ignore */
    }
    this._attemptFocus(el);
  }

  /** Focus without scrolling; never throws, callers verify activeElement. */
  _attemptFocus(el) {
    try {
      el.focus({ preventScroll: true });
    } catch {
      try { el.focus(); } catch { /* detached/inert element */ }
    }
  }

  _clearFocusRing() {
    const el = this._focusEl;
    this._focusEl = null;
    this._focusRetryFrames = 0;
    if (!el) return;
    try {
      el.classList.remove('gp-focus');
    } catch {
      /* ignore */
    }
    try {
      if (typeof document !== 'undefined' && document.activeElement === el && typeof el.blur === 'function') {
        el.blur();
      }
    } catch {
      /* ignore */
    }
  }

  /** Mouse/pointer user takes over: drop the ring until the next pad nav press. */
  _suspendFocusRing() {
    this._suspendFocus = true;
    this._navKey = 0;
    this._navRepeatAccum = 0;
    this._clearFocusRing();
  }

  /** Visible, hittable focus candidates for the current UI (§3.5). */
  _collectCandidates() {
    if (typeof document === 'undefined') return NO_CANDIDATES;
    // Second-level SYSTEM CONFIG overlay wins over everything it covers.
    const settings = document.querySelector('.screen.is-active [data-settings].is-open');
    const deploy = this._deployEl || (this._deployEl = document.querySelector('[data-deploy]'));
    let nodes;
    if (settings) {
      nodes = settings.querySelectorAll('button:not([disabled]), input[type="range"]');
    } else if (deploy && deploy.classList.contains('is-open')) {
      nodes = deploy.querySelectorAll('[data-deploy-value]');
    } else {
      const screen = document.querySelector('.screen.is-active');
      if (!screen) return NO_CANDIDATES;
      nodes = screen.querySelectorAll('button:not([disabled]), input[type="range"]');
    }
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      if (this._isVisibleCandidate(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  _isVisibleCandidate(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    let node = el;
    while (node && node !== document.body) {
      if (node.hidden) return false;
      if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return false;
      node = node.parentElement;
    }
    // Hidden by CSS (display:none, detached, or inside a collapsed panel).
    if (el.offsetParent === null) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  _describeFocus() {
    const el = this._focusEl;
    if (!el || typeof el.tagName !== 'string') return '';
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + '#' + el.id;
    let out = tag;
    if (tag === 'input' && el.type) out += '[type="' + el.type + '"]';
    let matched = false;
    const attrs = ['data-action', 'data-deploy-value', 'data-set', 'data-quality-value', 'data-difficulty-value'];
    for (let i = 0; i < attrs.length; i++) {
      const value = el.getAttribute(attrs[i]);
      if (value !== null && value !== '') {
        out += '[' + attrs[i] + '="' + value + '"]';
        matched = true;
      }
    }
    if (el.hasAttribute('data-start')) out += '[data-start]';
    if (!matched) {
      const className = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
      if (className) out += '.' + className;
    }
    return out;
  }

  // =========================================================================
  // Rumble (§3.4)
  // =========================================================================

  _rumble(weak, strong, ms) {
    if (!this._vibrationEnabled || !this._connected || !this._pad) return;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (now - this._lastRumbleAt < PAD_RUMBLE_MIN_INTERVAL * 1000) return;
    const actuator = this._pad.vibrationActuator;
    if (!actuator || typeof actuator.playEffect !== 'function') return;

    this._lastRumbleAt = now;
    this._rumbleCount += 1;
    this._lastRumble = { weak, strong, ms, at: now };
    try {
      const result = actuator.playEffect('dual-rumble', {
        duration: ms,
        weakMagnitude: weak,
        strongMagnitude: strong,
      });
      if (result && typeof result.catch === 'function') result.catch(() => { /* rejected rumble is non-fatal */ });
    } catch {
      /* some actuators throw synchronously — input must survive */
    }
  }

  // =========================================================================
  // Small helpers
  // =========================================================================

  /** Radial deadzone + rescale; result in `_dzX/_dzY`, returns the magnitude. */
  _applyDeadzone(x, y, deadzone) {
    const magnitude = Math.hypot(x, y);
    if (!(magnitude > deadzone)) {
      this._dzX = 0;
      this._dzY = 0;
      return 0;
    }
    const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
    const inv = scaled / magnitude;
    this._dzX = x * inv;
    this._dzY = y * inv;
    return scaled;
  }

  _emitAction(action) {
    emit('gamepad:action', { action, source: 'gamepad' });
  }

  /** Call an optional method with fixed arity; never throws when the API is missing. */
  _invoke(target, method, a, b) {
    if (!target) return undefined;
    const fn = target[method];
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.call(target, a, b);
    } catch {
      return undefined;
    }
  }
}
