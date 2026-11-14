/**
 * Frame counter (FPS) meter.
 *
 * Split out of the old monolithic `src/ui.js`. Sampling piggybacks on the UI
 * rAF loop (`sample(now)` every frame); only the *display* is rate-limited
 * (text <= 8 Hz, graph <= 14.3 Hz), so the meter costs next to nothing. Stats
 * cover a ~500 ms rolling window of raw, unclamped frame deltas.
 *
 * The core exposes this instance as the QA hook `ui.perf` (fps / frameMs /
 * worstMs / samples / level) — `samples` stays monotonic across window resets
 * and the readout only shows "--" until the first valid reading.
 *
 * Module map: see `.scratch/ui-refactor-contract.md` § perf.js
 */
import {
  clamp,
  q,
  PERF_CAPACITY,
  PERF_WINDOW_MS,
  PERF_MIN_SAMPLES,
  PERF_TEXT_MS,
  PERF_GRAPH_MS,
  PERF_GRAPH_BARS,
  PERF_GRAPH_MAX_MS,
  PERF_COLORS,
  perfLevel,
} from './shared.js';

export class PerfMeter {
  constructor(ui, shell) {
    this.ui = ui;
    this.shell = shell;
    this.disposed = false;
    this.refs = {
      perfPanel: q(shell, '[data-perf]'),
      perfState: q(shell, '[data-perf-state]'),
      perfFps: q(shell, '[data-fps]'),
      perfMs: q(shell, '[data-frametime]'),
      perfGraph: q(shell, '[data-perf-graph]'),
      menuPerf: q(shell, '[data-menu-perf]'),
      menuFps: q(shell, '[data-menu-fps]'),
      menuMs: q(shell, '[data-menu-ms]'),
    };

    // Sampling state lives on the meter now (previously on the UI instance).
    this._perf = { fps: 0, frameMs: 0, worstMs: 0, samples: 0, level: 'low' };
    this._last = 0;
    this._head = 0;
    this._count = 0;
    this._total = 0;
    this._stamps = new Float64Array(PERF_CAPACITY);
    this._intervals = new Float32Array(PERF_CAPACITY);
    this._lastTextAt = 0;
    this._lastGraphAt = 0;
    this._ctx = null;
    this._hasReading = false;
    this._visible = true;
  }

  /** Latest computed reading; same object contract as the old `ui.perf`. */
  get perf() {
    return this._perf;
  }

  /** Raw frame delta, fed once per rAF tick before any clamping. */
  sample(now) {
    if (this.disposed) return;
    const last = this._last;
    this._last = now;
    if (!last) return;
    const delta = now - last;
    if (!(delta > 0) || delta > 250) {
      // Hidden tab / GC pause / shader hitch: start a fresh window. The last
      // good reading stays on screen until PERF_MIN_SAMPLES clean frames land.
      this._resetWindow();
      return;
    }
    const index = this._head;
    this._stamps[index] = now;
    this._intervals[index] = delta;
    this._head = (index + 1) % PERF_CAPACITY;
    if (this._count < PERF_CAPACITY) this._count += 1;
    this._total += 1;
    // Stats are recomputed on the same ~8 Hz cadence as the DOM readout (see
    // tick) so `this.perf` can never disagree with the displayed numbers.
  }

  /** Empty the rolling window but keep the monotonic `samples` counter. */
  _resetWindow() {
    this._head = 0;
    this._count = 0;
    // NOTE: _total is intentionally NOT reset — `perf.samples` is a monotonic
    // count of accepted frames (useful for QA / diagnostics), while the rolling
    // stats above start empty again. A previously valid reading is kept on
    // screen through the hitch: only the *initial* state reads "--".
    if (!this._hasReading) {
      this._perf = { fps: 0, frameMs: 0, worstMs: 0, samples: this._total, level: 'low' };
    } else if (this._perf.samples !== this._total) {
      this._perf = { ...this._perf, samples: this._total };
    }
    if (this.ui.built && this.ui.settings.showFps) this._lastTextAt = 0;
  }

  /** Recompute fps / frameMs / worstMs from the rolling window. */
  compute() {
    if (this.disposed) return;
    const count = this._count;
    if (count < PERF_MIN_SAMPLES) {
      // Not enough clean frames yet: show "--" only until the very first valid
      // reading; afterwards keep the last good numbers (prevents flicker on a
      // single caught hitch).
      if (!this._hasReading) {
        this._perf = { fps: 0, frameMs: 0, worstMs: 0, samples: this._total, level: 'low' };
      }
      return;
    }
    // Walk backwards through the ring until the rolling window is covered.
    let index = (this._head - 1 + PERF_CAPACITY) % PERF_CAPACITY;
    let frames = 0;
    let span = 0;
    let worst = 0;
    while (frames < count && span < PERF_WINDOW_MS) {
      const delta = this._intervals[index];
      span += delta;
      if (delta > worst) worst = delta;
      frames += 1;
      index = (index - 1 + PERF_CAPACITY) % PERF_CAPACITY;
    }
    if (!(frames > 0) || !(span > 0)) return;
    // frames / real elapsed time is exact for the accumulated span (a 500 ms
    // window at 60 Hz reports ~59.9 fps, not a rounded 60).
    const fps = Math.round((frames / (span / 1000)) * 10) / 10;
    this._perf = {
      fps,
      frameMs: Math.round((span / frames) * 10) / 10,
      worstMs: Math.round(worst * 10) / 10,
      samples: this._total,
      level: perfLevel(fps),
    };
    this._hasReading = true;
  }

  /** Full repaint (used on boot and when the toggle is re-enabled). */
  render() {
    if (this.disposed || !this.ui || !this.ui.built || !this.ui.settings.showFps) return;
    this.compute();
    this.renderText();
    this.drawGraph();
  }

  /** Text readout (HUD panel + menu topbar) at the caller's rate limit. */
  renderText() {
    if (this.disposed) return;
    const perf = this._perf;
    // "--" is only the initial / never-measured state (spec); afterwards the
    // last good reading stays visible through short hitches.
    const warm = this._hasReading && perf.fps > 0;
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

  /** Sparkline canvas: 72 bars, oldest fading in from the left edge. */
  drawGraph() {
    if (this.disposed) return;
    const canvas = this.refs.perfGraph;
    if (!canvas) return;
    const ctx = this._ctx || (this._ctx = canvas.getContext('2d'));
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

    const count = Math.min(this._count, PERF_GRAPH_BARS);
    if (count > 0) {
      const palette = PERF_COLORS[this._perf.level] || PERF_COLORS.fair;
      const step = cssW / PERF_GRAPH_BARS;
      const barW = Math.max(1, step - 1);
      ctx.fillStyle = palette.bar;
      for (let i = 0; i < count; i++) {
        const index = (this._head - count + i + PERF_CAPACITY) % PERF_CAPACITY;
        const ms = clamp(this._intervals[index], 0, PERF_GRAPH_MAX_MS);
        const barH = Math.max(1, (ms / PERF_GRAPH_MAX_MS) * (cssH - 1));
        const x = Math.round(cssW - (count - i) * step);
        // Older samples fade out towards the left edge.
        ctx.globalAlpha = 0.3 + 0.7 * ((i + 1) / count);
        ctx.fillRect(x, cssH - barH, barW, barH);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Rate-limited painting driven by the UI rAF loop (text <= 8 Hz, graph <= 14.3 Hz). */
  tick(now) {
    if (this.disposed || !this.ui) return;
    if (!this.ui.built || !this.ui.settings.showFps) return;
    if (now - this._lastTextAt >= PERF_TEXT_MS) {
      this._lastTextAt = now;
      // Recompute on the display cadence: this.perf stays exactly in sync with
      // the DOM text for external readers (QA / devtools).
      this.compute();
      this.renderText();
    }
    if (now - this._lastGraphAt >= PERF_GRAPH_MS) {
      this._lastGraphAt = now;
      this.drawGraph();
    }
  }

  /**
   * Called by the core's FPS visibility toggle. Re-enabling repaints right away
   * instead of waiting for the next rate-limited refresh slot.
   */
  setVisible(flag) {
    if (this.disposed) return;
    this._visible = flag !== false;
    if (!this._visible) return;
    this._lastTextAt = 0;
    this._lastGraphAt = 0;
    this.render();
  }

  /** Drop refs / canvas context; the core's rAF loop stops calling us. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._ctx = null;
    this.refs = {
      perfPanel: null,
      perfState: null,
      perfFps: null,
      perfMs: null,
      perfGraph: null,
      menuPerf: null,
      menuFps: null,
      menuMs: null,
    };
  }
}
