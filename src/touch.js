/**
 * SANDSTRIKE — mobile touch layer.
 *
 * Contract: MOBILE_SPEC.md §2 + §3.
 * - detectTouchMode(): phones/tablets or forced with ?touch=1 / ?desktop=1.
 * - TouchControls: virtual stick + look surface + action buttons, driven purely
 *   by Pointer Events and forwarded through the virtual input API of Player
 *   (§4) and WeaponSystem (§5). Everything is feature-detected so a partially
 *   wired build can never throw.
 *
 * Plain ES module: no build step, no external assets, no per-frame work.
 */
import { on } from './bus.js';

const STICK_DEAD_ZONE = 0.12;
const LOOK_SCALE_HIP = 2.2;
const LOOK_SCALE_ADS = 1.45;
const SPRINT_MAG = 0.9;
const SPRINT_FORWARD = 0.7;
const MOVE_EPSILON = 1e-4;

/** Small DOM helper (keeps the §3.1 markup readable). */
function el(tag, className, attrs, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) {
    for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * True on phones/tablets or when forced with ?touch=1. ?touch=0 forces desktop.
 * Rules, in order (MOBILE_SPEC.md §2):
 *   1. ?touch=1 / ?touch=true            -> true
 *   2. ?touch=0 / ?touch=false / ?desktop=1 -> false
 *   3. (pointer: coarse)                 -> true
 *   4. (hover: none) && maxTouchPoints>0 -> true
 *   5. otherwise                         -> false
 */
export function detectTouchMode(search = typeof location !== 'undefined' ? location.search : '') {
  let params;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    params = new URLSearchParams();
  }
  const touch = String(params.get('touch') || '').toLowerCase();
  if (touch === '1' || touch === 'true') return true;
  if (touch === '0' || touch === 'false') return false;
  if (params.get('desktop') === '1') return false;

  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(pointer: coarse)').matches) return true;
      if (window.matchMedia('(hover: none)').matches
        && (typeof navigator === 'undefined' || navigator.maxTouchPoints > 0)) return true;
    }
  } catch {
    /* matchMedia unavailable — treat as desktop */
  }
  return false;
}

export class TouchControls {
  /**
   * @param {object} options
   * @param {object} options.player   Player instance (§4 API, feature-detected).
   * @param {object} options.weapon   WeaponSystem instance (§5 API, feature-detected).
   * @param {HTMLCanvasElement} [options.canvas]
   * @param {HTMLElement} [options.mount]  Container for the touch layer (defaults to #ui).
   * @param {Function} [options.onPause]   Pause-button callback (Lead wires pauseGame('touch')).
   */
  constructor({ player, weapon, canvas = null, mount = null, onPause = null } = {}) {
    this.player = player || null;
    this.weapon = weapon || null;
    this.canvas = canvas || null;
    this.mount = mount || (typeof document !== 'undefined' ? document.getElementById('ui') : null) || (typeof document !== 'undefined' ? document.body : null);
    this.onPause = typeof onPause === 'function' ? onPause : null;

    this._disposed = false;
    this._visible = false;

    // input state (muted objects: no per-frame allocation)
    this._active = new Map(); // pointerId -> { kind: 'stick'|'look'|'fire', el }
    this._stick = { id: null, el: null, ox: 0, oy: 0, maxR: 1 };
    this._look = { id: null, el: null, lastX: 0, lastY: 0 };
    // Multi-pointer fire: any number of fingers may hold a fire button (primary
    // FIRE or secondary FIRE); the virtual trigger stays down while >= 1 remains.
    this._fireIds = new Set();
    this._moveX = 0;
    this._moveF = 0;
    this._sprintOn = false;
    this._moving = false;
    this._firing = false;
    this._adsOn = false;
    this._crouchOn = false;

    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.add('is-touch');
    }

    this._buildDom();

    // bound handlers (stable identities for dispose)
    this._onPointerDown = (event) => this._handlePointerDown(event);
    this._onPointerMove = (event) => this._handlePointerMove(event);
    this._onPointerUp = (event) => this._handlePointerUp(event);
    this._onPointerCancel = () => this.releaseAll();
    this._onWindowBlur = () => this.releaseAll();
    this._onVisibilityChange = () => {
      if (document.hidden) this.releaseAll();
    };

    this.root.addEventListener('pointerdown', this._onPointerDown, { passive: false });
    document.addEventListener('pointermove', this._onPointerMove, { passive: false });
    document.addEventListener('pointerup', this._onPointerUp, { passive: false });
    document.addEventListener('pointercancel', this._onPointerCancel, { passive: false });
    window.addEventListener('blur', this._onWindowBlur);
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    // The layer subscribes to the run state on its own (MOBILE_SPEC §3).
    this._offState = on('game:state', (detail = {}) => {
      if (detail?.state === 'playing') {
        this.setVisible(true);
      } else {
        this.setVisible(false);
        this.releaseAll();
      }
    });

    // Contract: visible by default once constructed; main hides it on menu/pause.
    this.setVisible(true);
  }

  // -------------------------------------------------------------------------
  // DOM (§3.1)
  // -------------------------------------------------------------------------
  _buildDom() {
    const root = el('div', 'touch-ui', { 'data-touch-ui': '', 'aria-hidden': 'true' });
    this.root = root;

    const look = el('div', 'touch-look', { 'data-touch-look': '' });

    const stick = el('div', 'touch-stick', { 'data-touch-stick': '' });
    stick.append(
      el('div', 'touch-stick-ring'),
      el('div', 'touch-stick-knob', { 'data-touch-knob': '' })
    );
    this.stickEl = stick;
    this.knobEl = stick.lastElementChild;
    // `style.translate` composes with any centering `transform` mobile-hud styles,
    // so moving the knob never fights the CSS.
    this._knobTranslate = typeof this.knobEl.style.translate === 'string';

    const buttons = el('div', 'touch-buttons');
    const defs = [
      ['crouch', 'Crouch / 蹲伏', '⌄', 'CROUCH'],
      ['jump', 'Jump / 跳跃', '⌃', 'JUMP'],
      ['reload', 'Reload / 换弹', '⟲', 'RELOAD'],
      ['switch', 'Switch weapon / 切换武器', '⇄', 'SWITCH'],
      ['ads', 'Aim down sight / 机瞄', '+', 'ADS'],
      ['fire', 'Fire / 射击', '◎', 'FIRE'],
    ];
    this.buttons = {};
    for (const def of defs) {
      const action = def[0];
      const button = el('button', 'touch-btn touch-btn--' + action, {
        type: 'button',
        'data-touch-action': action,
        'aria-label': def[1],
      });
      if (action === 'ads' || action === 'crouch') button.setAttribute('aria-pressed', 'false');
      button.append(
        el('span', 'tb-glyph', null, def[2]),
        el('span', 'tb-label', null, def[3])
      );
      this.buttons[action] = button;
      buttons.append(button);
    }
    this.fireEl = this.buttons.fire;

    // Secondary FIRE button (CODM-style mirrored layout). Appended AFTER the
    // primary so `querySelector('[data-touch-action="fire"]')` keeps returning
    // the primary (right-hand) button; both buttons drive the same virtual
    // trigger and are tracked per pointer id in `_fireIds`.
    const fire2 = el('button', 'touch-btn touch-btn--fire2', {
      type: 'button',
      'data-touch-action': 'fire',
      'aria-label': 'Fire / 开火（副）',
    });
    fire2.append(
      el('span', 'tb-glyph', null, '◎'),
      el('span', 'tb-label', null, 'FIRE')
    );
    this.buttons.fire2 = fire2;
    buttons.append(fire2);

    const pause = el('button', 'touch-pause', {
      type: 'button',
      'data-touch-action': 'pause',
      'aria-label': 'Pause / 暂停',
    });
    pause.append(el('span', 'tb-glyph', null, 'II'));
    this.pauseEl = pause;

    const rotate = el('div', 'touch-rotate', { 'data-touch-rotate': '', 'aria-hidden': 'true' });
    rotate.append(
      el('div', 'rotate-glyph', null, '▭'),
      el('div', 'rotate-title', null, 'ROTATE DEVICE'),
      el('div', 'rotate-cn', null, '请横屏握持设备以投入战斗')
    );

    root.append(look, stick, buttons, pause, rotate);
    this.lookEl = look;

    if (this.mount) this.mount.appendChild(root);
  }

  // -------------------------------------------------------------------------
  // Visibility / lifecycle
  // -------------------------------------------------------------------------
  /** Show/hide the layer. Hiding always releases every held input (§3). */
  setVisible(visible) {
    const next = !!visible;
    this._visible = next;
    if (!this.root) return next;
    this.root.classList.toggle('is-visible', next);
    this.root.setAttribute('aria-hidden', next ? 'false' : 'true');
    if (!next) this.releaseAll();
    return next;
  }

  /** Alias kept for callers that think in "enabled" terms. */
  setEnabled(enabled) {
    return this.setVisible(enabled);
  }

  get visible() {
    return this._visible;
  }

  /**
   * Release every held virtual input: movement/sprint, trigger, ADS, crouch,
   * and all captured pointer ids. Safe to call at any time.
   */
  releaseAll() {
    if (this._disposed) return;
    for (const id of Array.from(this._active.keys())) this._endPointer(id);

    // defensive resets (also covers state that was never pointer-tracked)
    this._stick.id = null;
    this._stick.el = null;
    this._look.id = null;
    this._look.el = null;
    this._fireIds.clear();

    if (this._moveX !== 0 || this._moveF !== 0) this._setMoveInput(0, 0);
    else this._moveX = 0;
    this._setSprint(false);
    this._setKnob(0, 0);
    this._setMoving(false);
    if (this._firing) this._setTrigger(false);

    if (this._adsOn) {
      this._adsOn = false;
      this._syncToggle('ads', false);
      this.root?.classList.remove('is-ads');
      this._invoke(this.weapon, 'setAiming', false);
    }
    if (this._crouchOn) {
      this._crouchOn = false;
      this._syncToggle('crouch', false);
      this._invoke(this.player, 'setCrouchHeld', false);
    }
  }

  /** Remove all listeners, release inputs and drop the touch layer node. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.releaseAll();
    try { this._offState?.(); } catch { /* ignore */ }
    this._offState = null;
    this.root?.removeEventListener('pointerdown', this._onPointerDown);
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
    document.removeEventListener('pointercancel', this._onPointerCancel);
    window.removeEventListener('blur', this._onWindowBlur);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    this.root?.remove();
    this.root = null;
    this.stickEl = null;
    this.lookEl = null;
    this.knobEl = null;
    this.fireEl = null;
    this.pauseEl = null;
    this.mount = null;
  }

  // -------------------------------------------------------------------------
  // Pointer input (§3.2)
  // -------------------------------------------------------------------------
  _handlePointerDown(event) {
    if (!this._visible || this._disposed) return;
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    const actionEl = target.closest('[data-touch-action]');
    if (actionEl) {
      event.preventDefault();
      const action = actionEl.getAttribute('data-touch-action');
      if (action === 'pause') {
        if (this.onPause) this.onPause();
        return;
      }
      if (!this._canAct()) return;
      switch (action) {
        case 'fire':
          this._beginFire(event, actionEl);
          break;
        case 'ads':
          this._toggleAds();
          break;
        case 'crouch':
          this._toggleCrouch();
          break;
        case 'reload':
          this._invoke(this.weapon, 'startReload');
          break;
        case 'switch':
          this._invoke(this.weapon, 'cycleWeapon', 1);
          break;
        case 'jump':
          this._invoke(this.player, 'queueJump');
          break;
        default:
          break;
      }
      return;
    }

    if (target.closest('[data-touch-stick]')) {
      event.preventDefault();
      this._beginStick(event);
      return;
    }
    if (target.closest('[data-touch-look]')) {
      event.preventDefault();
      this._beginLook(event);
    }
  }

  _handlePointerMove(event) {
    const info = this._active.get(event.pointerId);
    if (!info) return;
    event.preventDefault();
    if (info.kind === 'stick') this._updateStick(event.clientX, event.clientY);
    else if (info.kind === 'look') this._updateLook(event.clientX, event.clientY);
  }

  _handlePointerUp(event) {
    if (!this._active.has(event.pointerId)) return;
    event.preventDefault();
    this._endPointer(event.pointerId);
  }

  _beginStick(event) {
    if (this._stick.id !== null) return;
    const target = event.target.closest('[data-touch-stick]');
    const rect = target.getBoundingClientRect();
    this._stick.id = event.pointerId;
    this._stick.el = target;
    this._stick.ox = rect.left + rect.width / 2;
    this._stick.oy = rect.top + rect.height / 2;
    this._stick.maxR = Math.max(24, Math.min(rect.width, rect.height) * 0.5);
    this._active.set(event.pointerId, { kind: 'stick', el: target });
    this._capture(target, event.pointerId);
  }

  _updateStick(clientX, clientY) {
    const maxR = this._stick.maxR;
    let dx = clientX - this._stick.ox;
    let dy = clientY - this._stick.oy;
    const length = Math.hypot(dx, dy);
    if (length > maxR) {
      const scale = maxR / length;
      dx *= scale;
      dy *= scale;
    }
    const nx = dx / maxR;
    const nf = -dy / maxR;
    const mag = Math.hypot(nx, nf);

    if (mag < STICK_DEAD_ZONE) {
      this._setMoveInput(0, 0);
      this._setSprint(false);
      this._setMoving(false);
    } else {
      this._setMoveInput(nx, nf);
      this._setSprint(mag > SPRINT_MAG && nf > SPRINT_FORWARD);
      this._setMoving(true);
    }
    this._setKnob(dx, dy);
  }

  _beginLook(event) {
    if (this._look.id !== null) return;
    const target = event.target.closest('[data-touch-look]');
    this._look.id = event.pointerId;
    this._look.el = target;
    this._look.lastX = event.clientX;
    this._look.lastY = event.clientY;
    this._active.set(event.pointerId, { kind: 'look', el: target });
    this._capture(target, event.pointerId);
  }

  _updateLook(clientX, clientY) {
    const dx = clientX - this._look.lastX;
    const dy = clientY - this._look.lastY;
    this._look.lastX = clientX;
    this._look.lastY = clientY;
    if (dx === 0 && dy === 0) return;
    const ads = this.weapon && typeof this.weapon.ads === 'number' ? this.weapon.ads : 0;
    const scale = ads > 0.5 ? LOOK_SCALE_ADS : LOOK_SCALE_HIP;
    this._invoke(this.player, 'look', dx * scale, dy * scale);
  }

  _beginFire(event, element) {
    const pointerId = event.pointerId;
    if (this._fireIds.has(pointerId)) return;
    this._fireIds.add(pointerId);
    this._active.set(pointerId, { kind: 'fire', el: element });
    this._capture(element, pointerId);
    // Only the first held fire pointer changes the trigger; extra fingers on
    // the other fire button are tracked so releasing one keeps firing.
    if (this._fireIds.size === 1) this._setTrigger(true);
  }

  /** Drop one fire pointer; release the virtual trigger only when none remain. */
  _releaseFirePointer(pointerId) {
    if (!this._fireIds.delete(pointerId)) return;
    if (this._fireIds.size === 0) this._setTrigger(false);
  }

  _endPointer(pointerId) {
    const info = this._active.get(pointerId);
    if (!info) return;
    this._active.delete(pointerId);
    if (info.kind === 'stick' && this._stick.id === pointerId) {
      this._stick.id = null;
      this._stick.el = null;
      this._setMoveInput(0, 0);
      this._setSprint(false);
      this._setMoving(false);
      this._setKnob(0, 0);
    } else if (info.kind === 'look' && this._look.id === pointerId) {
      this._look.id = null;
      this._look.el = null;
    } else if (info.kind === 'fire') {
      this._releaseFirePointer(pointerId);
    }
    this._releaseCapture(info.el, pointerId);
  }

  _capture(element, pointerId) {
    try {
      element.setPointerCapture?.(pointerId);
    } catch {
      /* synthetic QA events throw NotFoundError — never break input */
    }
  }

  _releaseCapture(element, pointerId) {
    if (!element) return;
    try {
      if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  _toggleAds() {
    this._adsOn = !this._adsOn;
    this._syncToggle('ads', this._adsOn);
    this.root?.classList.toggle('is-ads', this._adsOn);
    this._invoke(this.weapon, 'setAiming', this._adsOn);
  }

  _toggleCrouch() {
    this._crouchOn = !this._crouchOn;
    this._syncToggle('crouch', this._crouchOn);
    this._invoke(this.player, 'setCrouchHeld', this._crouchOn);
  }

  _setTrigger(down) {
    this._firing = !!down;
    this.root?.classList.toggle('is-firing', this._firing);
    this._invoke(this.weapon, 'setTrigger', this._firing);
  }

  // -------------------------------------------------------------------------
  // State helpers / feature detection
  // -------------------------------------------------------------------------
  _canAct() {
    return !this.player || this.player.enabled !== false;
  }

  /** Call an optional method on player/weapon; never throws when the API is missing. */
  _invoke(target, method) {
    const fn = target && target[method];
    if (typeof fn !== 'function') return undefined;
    return fn.apply(target, Array.prototype.slice.call(arguments, 2));
  }

  _setMoveInput(x, forward) {
    if (Math.abs(x - this._moveX) < MOVE_EPSILON && Math.abs(forward - this._moveF) < MOVE_EPSILON) return;
    this._moveX = x;
    this._moveF = forward;
    this._invoke(this.player, 'setMoveInput', x, forward);
  }

  _setSprint(on) {
    if (this._sprintOn === on) return;
    this._sprintOn = on;
    this._invoke(this.player, 'setSprintHeld', on);
  }

  _setMoving(on) {
    if (this._moving === on) return;
    this._moving = on;
    this.root?.classList.toggle('is-moving', on);
  }

  _setKnob(dx, dy) {
    if (!this.knobEl) return;
    const x = Math.round(dx * 10) / 10;
    const y = Math.round(dy * 10) / 10;
    if (this._knobTranslate) this.knobEl.style.translate = x + 'px ' + y + 'px';
    else this.knobEl.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
  }

  _syncToggle(action, on) {
    const button = this.buttons?.[action];
    if (!button) return;
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}
