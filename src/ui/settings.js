/**
 * SYSTEM CONFIG — second-level settings overlay (settings + controls legend).
 *
 * Split out of the old monolithic `src/ui.js`. This module is presentation only:
 * the UI core owns the settings store, persistence, setters and the delegated
 * click/input listener (`[data-action]`, `input[data-set]`, `[data-quality-value]`,
 * …). Here we render the overlay markup, keep every copy in sync with `ui.settings`
 * and manage open/close + focus restore.
 *
 * Module map: see `.scratch/ui-refactor-contract.md` § settings.js
 *   markup: `.settings > .settings-scrim + .settings-card > head/body/foot`
 *   body:   `.panel--settings` (rows) + `.panel--controls` (legend)
 */
import {
  CONTROLS,
  TOUCH_CONTROLS,
  PAD_CONTROLS,
  padGlyphsFor,
  q,
  qa,
} from './shared.js';

/**
 * Markup for one SYSTEM CONFIG overlay. `scope` ('menu' | 'pause') only
 * disambiguates the duplicated input ids (`sens-menu` / `sens-pause`, …); the
 * `SettingsPanel` keeps both instances synchronized.
 */
export function settingsMarkup(scope) {
  return `
    <div class="settings" data-settings data-settings-scope="${scope}" aria-hidden="true">
      <div class="settings-scrim" data-action="settings-close"></div>
      <div class="settings-card" role="dialog" aria-modal="true" aria-label="System configuration">
        <header class="settings-head">
          <span class="settings-kicker">SYSTEM CONFIG // 系统设置</span>
          <button class="settings-close" type="button" data-action="settings-close" aria-label="关闭系统设置">✕</button>
        </header>
        <div class="settings-body">
          <section class="panel panel--settings">
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
                <button type="button" data-quality-value="lowest" title="最低画质：0.55× 渲染比例，关闭阴影与泛光 // Lowest">LOWEST</button>
                <button type="button" data-quality-value="low" title="低画质：0.75× 渲染比例 // Low">LOW</button>
                <button type="button" data-quality-value="medium" title="中等画质：1.0× 渲染比例 // Medium">MED</button>
                <button type="button" data-quality-value="high" title="高画质：1.65× 渲染比例，软阴影与泛光 // High">HIGH</button>
                <button type="button" data-quality-value="ultra" title="极高画质：2.0× 渲染比例，最高特效 // Ultra">ULTRA</button>
              </div>
            </div>
            <div class="set-row set-row--pad">
              <span class="set-label">CONTROLLER <em>手柄</em></span>
              <span class="set-pad" data-pad-status>NOT DETECTED</span>
            </div>
            <div class="set-row set-row--toggle">
              <span class="set-label">VIBRATION <em>震动反馈</em></span>
              <button type="button" class="set-toggle" data-action="vibrate" aria-pressed="true">
                <span class="toggle-dot"></span><span data-vibrate-label>ENABLED</span>
              </button>
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
          </section>
          <section class="panel panel--controls">
            <div class="panel-head"><span class="panel-kicker">CONTROLS</span><em>操作说明</em><span class="panel-corner"></span></div>
            <ul class="controls-list" data-controls-list></ul>
          </section>
        </div>
        <div class="settings-foot"><span>SETTINGS SAVE AUTOMATICALLY</span><em>ESC 关闭 · 设置自动保存</em></div>
      </div>
    </div>
  `;
}

/**
 * Presents every `[data-settings]` overlay: synchronized settings rows, the
 * controller status row, the controls legend and the open/close transition.
 *
 * The core delegates clicks (`[data-action="settings-close"]`, quality buttons,
 * range inputs, …) and calls the `sync*` methods whenever the underlying state
 * changes; this class never binds global listeners.
 */
export class SettingsPanel {
  constructor(ui, shell) {
    this.ui = ui;
    this.shell = shell;
    this.disposed = false;
    /** Every overlay instance in the shell (menu scope + pause scope). */
    this.overlays = qa(shell, '[data-settings]');
    this._open = null;
    this._lastFocus = null;
    this._legendMode = '';
    this.refs = {
      setInputs: qa(shell, '[data-set]'),
      setValues: qa(shell, '[data-value]'),
      qualityButtons: qa(shell, '[data-quality-value]'),
      muteLabels: qa(shell, '[data-mute-label]'),
      muteToggles: qa(shell, '[data-action="mute"]'),
      fpsLabels: qa(shell, '[data-fps-label]'),
      fpsToggles: qa(shell, '[data-action="fps"]'),
      fullscreenLabels: qa(shell, '[data-fullscreen-label]'),
      fullscreenToggles: qa(shell, '[data-action="fullscreen"]'),
      padStatuses: qa(shell, '[data-pad-status]'),
      vibrateLabels: qa(shell, '[data-vibrate-label]'),
      vibrateToggles: qa(shell, '[data-action="vibrate"]'),
      controlsLists: qa(shell, '[data-controls-list]'),
    };
  }

  get isOpen() {
    return !!this._open;
  }

  /** Overlay matching `scope`; undefined falls back to the first instance. */
  _overlayFor(scope) {
    if (!scope) return this.overlays[0] || null;
    return this.overlays.find((overlay) => overlay.dataset.settingsScope === scope) || null;
  }

  /** Open the secondary menu: `is-open` + aria + document-wide state + focus. */
  open(scope) {
    if (this.disposed || !this.ui || this.ui.disposed) return;
    const overlay = this._overlayFor(scope);
    if (!overlay) return;
    if (!this._open) {
      // Remember the trigger so ESC / ✕ returns focus where the user left it.
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      this._lastFocus = active && typeof active.focus === 'function' ? active : null;
    }
    for (const item of this.overlays) {
      const active = item === overlay;
      item.classList.toggle('is-open', active);
      item.setAttribute('aria-hidden', active ? 'false' : 'true');
    }
    this._open = overlay;
    if (this.ui.root) this.ui.root.classList.toggle('is-settings-open', true);
    this._focus(overlay);
  }

  /** Close whichever overlay is open and restore the previously focused node. */
  close() {
    if (this.disposed) return;
    const wasOpen = !!this._open;
    for (const overlay of this.overlays) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    this._open = null;
    if (this.ui && this.ui.root) this.ui.root.classList.toggle('is-settings-open', false);
    const previous = this._lastFocus;
    this._lastFocus = null;
    if (!wasOpen || !previous || previous.isConnected === false) return;
    try {
      previous.focus({ preventScroll: true });
    } catch (_) {
      try { previous.focus(); } catch (__) { /* element gone — nothing to restore */ }
    }
  }

  /** Move focus into the freshly opened card (its close button). */
  _focus(overlay) {
    const closeButton = q(overlay, '.settings-close');
    if (!closeButton) return;
    try {
      closeButton.focus({ preventScroll: true });
    } catch (_) {
      try { closeButton.focus(); } catch (__) { /* ignore */ }
    }
  }

  /** Mirror `ui.settings` into every settings row (both overlay instances). */
  syncInputs() {
    if (this.disposed || !this.ui) return;
    const { settings } = this.ui;
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
    for (const label of this.refs.muteLabels) label.textContent = settings.muted ? 'MUTED' : 'ENABLED';
    for (const toggle of this.refs.muteToggles) {
      toggle.classList.toggle('is-muted', settings.muted);
      toggle.setAttribute('aria-pressed', String(settings.muted));
    }
    for (const label of this.refs.fpsLabels) label.textContent = settings.showFps ? 'VISIBLE' : 'HIDDEN';
    for (const toggle of this.refs.fpsToggles) {
      toggle.classList.toggle('is-off', !settings.showFps);
      toggle.setAttribute('aria-pressed', String(settings.showFps));
    }
    for (const label of this.refs.vibrateLabels) label.textContent = settings.vibrate ? 'ENABLED' : 'DISABLED';
    for (const toggle of this.refs.vibrateToggles) {
      toggle.classList.toggle('is-off', !settings.vibrate);
      toggle.setAttribute('aria-pressed', String(settings.vibrate));
    }
    this.syncPadStatus();
  }

  /** Mirror real document fullscreen state into every panel (session-only). */
  syncFullscreen() {
    if (this.disposed) return;
    const supported = document.fullscreenEnabled !== false;
    const active = supported && !!document.fullscreenElement;
    const label = supported ? (active ? 'ON' : 'OFF') : 'N/A';
    const title = supported
      ? (active ? '退出全屏 // Exit fullscreen' : '进入全屏 // Enter fullscreen')
      : '当前浏览器/环境不支持全屏 // Fullscreen unavailable';
    for (const button of this.refs.fullscreenToggles) {
      button.classList.toggle('is-on', active);
      button.classList.toggle('is-idle', !active && supported);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = !supported;
      button.title = title;
    }
    for (const el of this.refs.fullscreenLabels) el.textContent = label;
  }

  /** Mirror the gamepad connection state into every panel (§6.1). */
  syncPadStatus() {
    if (this.disposed || !this.ui) return;
    const pad = this.ui.pad || {};
    const connected = !!pad.connected;
    const label = connected ? `${(pad.kind || 'generic').toUpperCase()} · CONNECTED` : 'NOT DETECTED';
    for (const el of this.refs.padStatuses) {
      if (el.textContent !== label) el.textContent = label;
      el.classList.toggle('is-on', connected);
      el.classList.toggle('is-off', !connected);
      el.title = connected && pad.id ? String(pad.id) : '';
    }
  }

  /** Re-render every `[data-controls-list]`; cheap no-op when the mode is unchanged. */
  renderControlsLegend() {
    if (this.disposed) return;
    const touch = typeof document !== 'undefined' && document.documentElement.classList.contains('is-touch');
    const pad = this.ui.pad || {};
    const mode = touch ? 'touch' : pad.connected ? `pad:${pad.kind || 'generic'}` : 'keyboard';
    if (mode === this._legendMode) return;
    this._legendMode = mode;
    const html = this._controlsMarkup();
    for (const list of this.refs.controlsLists) list.innerHTML = html;
  }

  /** Legend markup for the current mode: touch > gamepad > keyboard. */
  _controlsMarkup() {
    const touch = typeof document !== 'undefined' && document.documentElement.classList.contains('is-touch');
    if (touch) {
      return TOUCH_CONTROLS.map((row) => `
      <li class="ctrl-row ctrl-row--touch">
        <span class="keys"><span class="ctrl-badge" aria-hidden="true">${row.glyph}</span></span>
        <span class="ctrl">${row.en} <em>${row.cn}</em></span>
      </li>`).join('');
    }
    const pad = this.ui.pad || {};
    if (pad.connected) {
      const glyphs = padGlyphsFor(pad.kind);
      return PAD_CONTROLS.map((row) => {
        const keys = glyphs[row.slot] || [];
        return `
      <li class="ctrl-row ctrl-row--pad">
        <span class="keys">${keys.map((key) => `<kbd>${key}</kbd>`).join('')}</span>
        <span class="ctrl">${row.en} <em>${row.cn}</em></span>
      </li>`;
      }).join('');
    }
    return CONTROLS.map((row) => `
      <li>
        <span class="keys">${row.keys.map((key) => `<kbd>${key}</kbd>`).join('')}</span>
        <span class="ctrl">${row.en} <em>${row.cn}</em></span>
      </li>`).join('');
  }

  /** Drop references and make sure no overlay is left open / focus-trapped. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.ui && this.ui.root) this.ui.root.classList.remove('is-settings-open');
    for (const overlay of this.overlays) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    this._open = null;
    this._lastFocus = null;
    this.refs = {};
  }
}
