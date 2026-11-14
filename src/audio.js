/**
 * SANDSTRIKE // 沙暴协议 — GameAudio
 * ---------------------------------------------------------------------------
 * 100% synthesized Web Audio. No audio files, no base64, no network.
 *
 * Signal flow:
 *   voices -> (stereo panner) -> bus -> master -> limiter -> destination
 *   voices -> reverb send -> convolution tail -> master
 *
 * Design goals: punchy but never fatiguing, adaptive industrial combat score,
 * desert wind bed, readable mechanical foley, safe to call before init().
 *
 * The class intentionally never creates an AudioContext until init() is called
 * from a user gesture. Every public method is a no-op until then.
 */

const clamp = (value, low, high) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return low;
  return n < low ? low : n > high ? high : n;
};
const rand = (low, high) => low + Math.random() * (high - low);
const chance = (p) => Math.random() < p;

/** Small leaky integrator used to make natural-looking brown-ish noise. */
function fillBrownNoise(data) {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.2;
  }
  return data;
}

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.disposed = false;
    this.muted = false;
    this.volume = 0.8;

    /** Target + smoothed combat intensity (0 = calm, 1 = full assault). */
    this.combatTarget = 0;
    this.combat = 0;

    this._noiseBuf = null;
    this._brownBuf = null;
    this._masterGainValue = 0;

    // Music transport
    this._musicOn = false;
    this._nextStepAt = 0;
    this._step = 0;

    // Ambience random-event countdowns (seconds).
    this._ambientIn = { creak: 5.5, static: 10, gust: 17 };
    this._ambientSeed = Math.random() * 1000;

    // Tropical island ambience (ocean, leaf rustle, birds) selected by the map's
    // style tag. `setWorldStyle()` may be called before or after init().
    this.worldStyle = 'outpost';
    this._islandAmbientIn = { bird: 1.8, wave: 3.2, leaves: 5.2, flock: 15 };
    this._desertNodes = null;
    this._islandNodes = null;
    this._islandGains = null;
    this._islandStartedAt = 0;

    // Misc state
    this._lastShot = 0;
    this._shotFlip = 0;
    this._listener = null;
    this._lfoNodes = [];
    this._loopNodes = [];
    this._lastWarn = 0;

    // Gatling spin-up whir: a single lazily-created loop, started only while the
    // M-77 is spinning and stopped on weapon switch / reset / dispose. The wanted
    // flag sticky so a loop requested before init() can start once the context is
    // live.
    this._spinLoop = null;
    this._spinWanted = false;
    this._spinRate = 0;

    const AC = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext)
      : null;
    this.supported = !!AC;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Create the graph. Async signature, but everything up to the resume() call
   * runs synchronously so gameplay sounds requested immediately after init()
   * (still inside the same user gesture) have a live context to schedule on.
   */
  async init() {
    if (this.disposed) return false;
    if (!this.supported) return false;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this._buildGraph();
        this._startAmbience();
        this.ready = true;
      }
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume().catch(() => {});
      }
      this._applyVolume(0.02);
      // A spin loop requested before the context existed (e.g. held trigger while
      // the stage was still booting) starts as soon as audio is live.
      if (this._spinWanted) this._startSpinLoop();
      return true;
    } catch (error) {
      // Audio is decorative: never break the game because a browser refused it.
      console.warn('[SANDSTRIKE audio] init failed:', error);
      this.ready = false;
      return false;
    }
  }

  suspend() {
    if (!this.ctx || this.disposed) return;
    if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (!this.ctx || this.disposed) return;
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
      this._nextStepAt = this.ctx.currentTime + 0.12;
    }
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1);
    this._applyVolume(0.05);
  }

  setMuted(flag) {
    this.muted = !!flag;
    this._applyVolume(0.08);
  }

  _applyVolume(smoothing = 0.05) {
    if (!this.ctx || !this.master) return;
    const target = this.muted ? 0 : this.volume;
    this._masterGainValue = target;
    const now = this.ctx.currentTime;
    try {
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(target, now, Math.max(0.005, smoothing));
    } catch (_) {
      this.master.gain.value = target;
    }
  }

  setCombatIntensity(value) {
    this.combatTarget = clamp(value, 0, 1);
    // Main drives intensity every frame: >= 0.2 means a live fight (startRun
    // also raises it), < 0.09 is menu/intermission quiet and parks the score.
    // Death (0.15) and victory (0.18) sit in the hysteresis band so the sting
    // cues are never buried under a restarted pulse.
    if (this.ctx && this.ready) {
      if (this.combatTarget >= 0.2) this._musicOn = true;
      else if (this.combatTarget < 0.09) this._musicOn = false;
    }
    if (!this.ctx) return;
    // Immediate-ish layer response without waiting for update().
    this._updateLayerGains();
  }

  _updateLayerGains() {
    if (!this.ctx || !this._layerGains) return;
    const now = this.ctx.currentTime;
    const i = this.combat;
    const set = (node, value) => {
      const param = node && node.gain ? node.gain : node;
      if (!param) return;
      try {
        param.setTargetAtTime(value, now, 0.25);
      } catch (_) {
        try { param.value = value; } catch (__) { /* ignore */ }
      }
    };
    set(this._layerGains.pulse, this._musicOn ? 0.55 + 0.45 * i : 0);
    set(this._layerGains.bass, this._musicOn ? 0.35 + 0.65 * i : 0);
    set(this._layerGains.air, this._musicOn ? 0.15 + 0.85 * i : 0);
    set(this._layerGains.drone, this._musicOn ? 0.5 : 0);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this._spinWanted = false;
    this._spinLoop = null;
    for (const node of this._loopNodes) {
      try { node.stop(); } catch (_) { /* already stopped */ }
    }
    for (const node of this._lfoNodes) {
      try { node.stop(); } catch (_) { /* already stopped */ }
    }
    this._loopNodes.length = 0;
    this._lfoNodes.length = 0;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) {
      try { ctx.close(); } catch (_) { /* already closed */ }
    }
    this._noiseBuf = null;
    this._brownBuf = null;
  }

  // =========================================================================
  // Graph construction
  // =========================================================================

  _buildGraph() {
    const ctx = this.ctx;

    // Master safety chain: gentle low cut -> master -> limiter -> out.
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -9;
    this.limiter.knee.value = 10;
    this.limiter.ratio.value = 9;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.24;
    this.dcCut = ctx.createBiquadFilter();
    this.dcCut.type = 'highpass';
    this.dcCut.frequency.value = 24;
    this.dcCut.Q.value = 0.5;

    this.master.connect(this.limiter);
    this.limiter.connect(this.dcCut);
    // Final soft clipper: the limiter controls musical dynamics, but stacked
    // transients can still overshoot full scale (and the 24 Hz high-pass can
    // ring slightly). A gentle cubic-top curve caps the true output below
    // 0 dBFS without audibly squashing normal levels.
    this.softClip = ctx.createWaveShaper();
    const curveSize = 1024;
    const clipCurve = new Float32Array(curveSize);
    for (let i = 0; i < curveSize; i++) {
      const x = (i / (curveSize - 1)) * 2 - 1;
      const magnitude = Math.abs(x);
      const shaped = x * (1 - 0.08 * magnitude * magnitude * magnitude * magnitude);
      clipCurve[i] = Math.max(-0.95, Math.min(0.95, shaped));
    }
    this.softClip.curve = clipCurve;
    // 'none' keeps the shaper's output strictly inside the curve bounds; 2x
    // oversampling can ring slightly past them on stacked transients.
    this.softClip.oversample = 'none';
    this.dcCut.connect(this.softClip);
    this.softClip.connect(ctx.destination);

    const bus = (gainValue) => {
      const g = ctx.createGain();
      g.gain.value = gainValue;
      g.connect(this.master);
      return g;
    };
    this.sfxBus = bus(0.95);
    this.uiBus = bus(0.5);
    this.ambBus = bus(0.85);
    this.musicBus = bus(0.8);

    // Per-layer music gainers (crossfaded by combat intensity).
    const layer = (target) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.musicBus);
      if (target) g.connect(target);
      return g;
    };
    this._layerGains = {
      drone: layer(),
      pulse: layer(),
      bass: layer(),
      air: layer(),
    };
    // Always-on sub drone layer is routed through drone gain.
    this._droneIn = this._layerGains.drone;

    // Convolution tail, procedurally generated. Adds the "outdoor distance".
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.7, 3.4);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.55;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    this._noiseBuf = this._makeNoise(2.0, false);
    this._brownBuf = this._makeNoise(3.0, true);

    this._startDrone();
    this._musicOn = false;
    this._applyVolume(0.02);
  }

  _makeNoise(seconds, brown) {
    const ctx = this.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    if (brown) fillBrownNoise(data);
    else {
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  _makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      let smoothed = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const envelope = Math.pow(1 - t, decay);
        // Slight smoothing removes the "hiss" of pure white noise tails.
        smoothed = smoothed * 0.32 + (Math.random() * 2 - 1) * 0.68;
        data[i] = smoothed * envelope;
      }
    }
    return impulse;
  }

  _dest(bus) {
    if (bus === 'ui') return this.uiBus;
    if (bus === 'ambient') return this.ambBus;
    if (bus === 'music') return this.musicBus;
    return this.sfxBus;
  }

  _out(node, { pan = 0, bus = 'sfx', send = 0 } = {}) {
    const ctx = this.ctx;
    let tail = node;
    if (pan && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      tail.connect(panner);
      tail = panner;
    }
    tail.connect(this._dest(bus));
    if (send > 0) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = clamp(send, 0, 1);
      tail.connect(sendGain);
      sendGain.connect(this.reverb);
    }
    return tail;
  }

  _canPlay() {
    return !!(this.ctx && this.ready && !this.disposed && this.ctx.state === 'running');
  }

  // =========================================================================
  // Tiny synth primitives
  // =========================================================================

  _osc(type, freq, t0, stopAt) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(8, freq), t0);
    osc.start(t0);
    osc.stop(Math.max(t0 + 0.02, stopAt));
    return osc;
  }

  _filter(type, freq, q = 0.7) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = Math.max(20, freq);
    filter.Q.value = q;
    return filter;
  }

  _gain(value = 1) {
    const gain = this.ctx.createGain();
    gain.gain.value = value;
    return gain;
  }

  /** Percussive envelope (click -> decay). */
  _hit(gainNode, t0, peak, attack, decay) {
    const param = gainNode.gain;
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.max(0.0005, attack));
    param.exponentialRampToValueAtTime(0.0001, t0 + Math.max(attack + 0.01, attack + decay));
  }

  /** Swelling envelope used by pads / risers. */
  _swell(gainNode, t0, peak, attack, hold, release) {
    const param = gainNode.gain;
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    if (hold > 0) param.setValueAtTime(Math.max(0.0002, peak), t0 + attack + hold);
    param.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  }

  _noiseSource(t0, duration) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = duration > (this._noiseBuf ? this._noiseBuf.duration : 1);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
    return src;
  }

  _brownSource(t0, duration) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._brownBuf;
    src.loop = true;
    src.start(t0);
    src.stop(t0 + duration + 0.05);
    return src;
  }

  /**
   * Filtered noise burst — the workhorse for impacts, sand, wind and debris.
   * Returns the source so callers can stop it early.
   */
  _noiseBurst({
    t = 0,
    duration = 0.12,
    peak = 0.2,
    attack = 0.002,
    type = 'lowpass',
    freq = 1800,
    freqEnd = 0,
    q = 0.8,
    pan = 0,
    bus = 'sfx',
    send = 0.08,
    brown = false,
  } = {}) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + Math.max(0, t);
    const src = brown ? this._brownSource(t0, duration) : this._noiseSource(t0, duration);
    const filter = this._filter(type, freq, q);
    if (freqEnd > 0) {
      try {
        filter.frequency.setValueAtTime(Math.max(20, freq), t0);
        filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration);
      } catch (_) { /* ignore */ }
    }
    const env = this._gain(0);
    this._hit(env, t0, peak, attack, duration);
    src.connect(filter);
    filter.connect(env);
    this._out(env, { pan, bus, send });
    return { src, filter, env, t0 };
  }

  _tone({
    type = 'sine',
    freq = 440,
    freqEnd = 0,
    t = 0,
    duration = 0.2,
    peak = 0.15,
    attack = 0.004,
    pan = 0,
    bus = 'sfx',
    send = 0.08,
  } = {}) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + Math.max(0, t);
    const osc = this._osc(type, freq, t0, t0 + duration + 0.05);
    if (freqEnd > 0) {
      try {
        osc.frequency.exponentialRampToValueAtTime(Math.max(8, freqEnd), t0 + duration);
      } catch (_) { /* ignore */ }
    }
    const env = this._gain(0);
    this._hit(env, t0, peak, attack, duration);
    osc.connect(env);
    this._out(env, { pan, bus, send });
    return { osc, env, t0 };
  }

  /** Metallic inharmonic partial stack for robots / machinery. */
  _metal({
    t = 0,
    base = 240,
    duration = 0.25,
    peak = 0.1,
    spread = 1.7,
    pan = 0,
    send = 0.22,
    bus = 'sfx',
  } = {}) {
    const ratios = [1, spread, 2.41, 3.17, 4.53];
    const ctx = this.ctx;
    const t0 = ctx.currentTime + Math.max(0, t);
    const sum = this._gain(0);
    this._hit(sum, t0, peak, 0.002, duration);
    ratios.forEach((ratio, index) => {
      const osc = this._osc('triangle', base * ratio, t0, t0 + duration + 0.05);
      const partGain = this._gain(0.6 / (index + 1));
      osc.connect(partGain);
      partGain.connect(sum);
    });
    const click = this._noiseSource(t0, 0.03);
    const clickFilter = this._filter('bandpass', base * 6, 1.4);
    const clickGain = this._gain(0);
    this._hit(clickGain, t0, peak * 0.5, 0.001, 0.03);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(sum);
    this._out(sum, { pan, send, bus });
    void ctx;
    return sum;
  }

  // =========================================================================
  // Ambience — desert wind bed vs tropical island bed
  // =========================================================================

  /**
   * Pick the ambience bed for the current map. `outpost`/`test-range` keep the
   * desert wind layers; `island` swaps them for ocean, surf, leaf rustle and
   * birds. Safe to call before init() (the style is applied when the graph is
   * built) and after init() (the beds crossfade).
   */
  setWorldStyle(style) {
    const next = style === 'island' ? 'island' : 'outpost';
    if (next === this.worldStyle) return;
    this.worldStyle = next;
    if (!this.ctx || !this.ready || this.disposed) return;
    this._switchAmbience();
  }

  _switchAmbience() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const fadeGain = (gain) => {
      if (!gain) return;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0.0001, now, 0.3);
      } catch (_) { /* ignore */ }
    };
    const stopNodes = (nodes) => {
      if (!nodes) return;
      for (const node of nodes) {
        try { node.stop(now + 0.9); } catch (_) { /* already stopped */ }
        const loopIndex = this._loopNodes.indexOf(node);
        if (loopIndex >= 0) this._loopNodes.splice(loopIndex, 1);
        const lfoIndex = this._lfoNodes.indexOf(node);
        if (lfoIndex >= 0) this._lfoNodes.splice(lfoIndex, 1);
      }
    };
    stopNodes(this._desertNodes);
    stopNodes(this._islandNodes);
    Object.values(this._islandGains ?? {}).forEach(fadeGain);
    fadeGain(this._windGain);
    fadeGain(this._airGain);
    this._desertNodes = null;
    this._islandNodes = null;
    this._islandGains = null;
    if (this.worldStyle === 'island') this._startIslandAmbience();
    else this._startDesertAmbience();
  }

  _startAmbience() {
    if (this.worldStyle === 'island') this._startIslandAmbience();
    else this._startDesertAmbience();
  }

  _startDesertAmbience() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const nodes = [];
    this._desertNodes = nodes;

    // Layer 1: low desert wind rumble.
    const gust = this._brownSource(now, 1e9);
    this._loopNodes.push(gust);
    const gustFilter = this._filter('lowpass', 320, 0.7);
    const gustHigh = this._filter('highpass', 42, 0.5);
    const gustGain = this._gain(0);
    gust.connect(gustHigh);
    gustHigh.connect(gustFilter);
    gustFilter.connect(gustGain);
    this._out(gustGain, { bus: 'ambient', send: 0.05 });
    gustGain.gain.setValueAtTime(0.0001, now);
    gustGain.gain.linearRampToValueAtTime(0.22, now + 3.2);

    // Slow LFOs keep the wind from sounding like static.
    const gustLfo = ctx.createOscillator();
    gustLfo.type = 'sine';
    gustLfo.frequency.value = 0.061;
    const gustLfoGain = this._gain(150);
    gustLfo.connect(gustLfoGain);
    gustLfoGain.connect(gustFilter.frequency);
    gustLfo.start(now);
    this._lfoNodes.push(gustLfo);

    const gainLfo = ctx.createOscillator();
    gainLfo.type = 'sine';
    gainLfo.frequency.value = 0.043;
    const gainLfoDepth = this._gain(0.075);
    gainLfo.connect(gainLfoDepth);
    gainLfoDepth.connect(gustGain.gain);
    gainLfo.start(now);
    this._lfoNodes.push(gainLfo);

    // Layer 2: thin airy hiss, gently panned by a very slow oscillator.
    const air = this._brownSource(now + 0.02, 1e9);
    this._loopNodes.push(air);
    const airFilter = this._filter('bandpass', 880, 0.5);
    const airGain = this._gain(0);
    air.connect(airFilter);
    airFilter.connect(airGain);
    this._out(airGain, { bus: 'ambient', pan: 0.12, send: 0.1 });
    airGain.gain.setValueAtTime(0.0001, now);
    airGain.gain.linearRampToValueAtTime(0.028, now + 4.5);

    const airLfo = ctx.createOscillator();
    airLfo.frequency.value = 0.017;
    const airLfoGain = this._gain(0.018);
    airLfo.connect(airLfoGain);
    airLfoGain.connect(airGain.gain);
    airLfo.start(now);
    this._lfoNodes.push(airLfo);

    this._windGain = gustGain;
    this._airGain = airGain;
    nodes.push(gust, gustLfo, gainLfo, air, airLfo);
  }

  // -------------------------------------------------------------------------
  // Tropical island bed: ocean swell, surf wash, shallow lapping, leaf rustle,
  // cicada hush and a few procedural bird phrases.
  // -------------------------------------------------------------------------

  _startIslandAmbience() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const nodes = [];
    const gains = {};
    this._islandNodes = nodes;
    this._islandGains = gains;
    this._islandStartedAt = now;

    // Layer 1: deep ocean bed — brown noise under a slow filter sweep.
    const ocean = this._brownSource(now, 1e9);
    nodes.push(ocean);
    this._loopNodes.push(ocean);
    const oceanFilter = this._filter('lowpass', 430, 0.55);
    const oceanGain = this._gain(0);
    gains.ocean = oceanGain;
    ocean.connect(oceanFilter);
    oceanFilter.connect(oceanGain);
    this._out(oceanGain, { bus: 'ambient', pan: 0.04, send: 0.05 });
    oceanGain.gain.setValueAtTime(0.0001, now);
    oceanGain.gain.linearRampToValueAtTime(0.17, now + 4.0);

    const oceanLfo = ctx.createOscillator();
    oceanLfo.frequency.value = 0.052;
    const oceanLfoGain = this._gain(0.05);
    oceanLfo.connect(oceanLfoGain);
    oceanLfoGain.connect(oceanGain.gain);
    oceanLfo.start(now);
    nodes.push(oceanLfo);
    this._lfoNodes.push(oceanLfo);

    const oceanSweep = ctx.createOscillator();
    oceanSweep.frequency.value = 0.071;
    const oceanSweepGain = this._gain(110);
    oceanSweep.connect(oceanSweepGain);
    oceanSweepGain.connect(oceanFilter.frequency);
    oceanSweep.start(now);
    nodes.push(oceanSweep);
    this._lfoNodes.push(oceanSweep);

    // Layer 2: rolling surf wash — band-passed noise with a ~7 s wave cycle.
    const surf = this._brownSource(now + 0.03, 1e9);
    nodes.push(surf);
    this._loopNodes.push(surf);
    const surfFilter = this._filter('bandpass', 820, 0.75);
    const surfGain = this._gain(0);
    gains.surf = surfGain;
    surf.connect(surfFilter);
    surfFilter.connect(surfGain);
    this._out(surfGain, { bus: 'ambient', pan: 0.1, send: 0.07 });
    surfGain.gain.setValueAtTime(0.0001, now);
    surfGain.gain.linearRampToValueAtTime(0.15, now + 4.5);

    const surfLfo = ctx.createOscillator();
    surfLfo.frequency.value = 0.117;
    const surfLfoGain = this._gain(0.026);
    surfLfo.connect(surfLfoGain);
    surfLfoGain.connect(surfGain.gain);
    surfLfo.start(now);
    nodes.push(surfLfo);
    this._lfoNodes.push(surfLfo);

    // Layer 3: shallow lapping at the waterline — bright, fast, panned left.
    const lap = this._noiseSource(now + 0.05, 1e9);
    nodes.push(lap);
    this._loopNodes.push(lap);
    const lapFilter = this._filter('highpass', 1500, 0.5);
    const lapGain = this._gain(0);
    gains.lap = lapGain;
    lap.connect(lapFilter);
    lapFilter.connect(lapGain);
    this._out(lapGain, { bus: 'ambient', pan: -0.28, send: 0.04 });
    lapGain.gain.setValueAtTime(0.0001, now);
    lapGain.gain.linearRampToValueAtTime(0.03, now + 5.0);

    const lapLfo = ctx.createOscillator();
    lapLfo.frequency.value = 0.33;
    const lapLfoGain = this._gain(0.006);
    lapLfo.connect(lapLfoGain);
    lapLfoGain.connect(lapGain.gain);
    lapLfo.start(now);
    nodes.push(lapLfo);
    this._lfoNodes.push(lapLfo);

    // Layer 4: leaf canopy rustle, driven by a very slow wind LFO.
    const leaves = this._noiseSource(now + 0.07, 1e9);
    nodes.push(leaves);
    this._loopNodes.push(leaves);
    const leafFilter = this._filter('bandpass', 3300, 0.6);
    const leafGain = this._gain(0);
    gains.leaves = leafGain;
    leaves.connect(leafFilter);
    leafFilter.connect(leafGain);
    this._out(leafGain, { bus: 'ambient', pan: 0.16, send: 0.1 });
    leafGain.gain.setValueAtTime(0.0001, now);
    leafGain.gain.linearRampToValueAtTime(0.028, now + 6.0);

    const leafLfo = ctx.createOscillator();
    leafLfo.frequency.value = 0.061;
    const leafLfoGain = this._gain(0.004);
    leafLfo.connect(leafLfoGain);
    leafLfoGain.connect(leafGain.gain);
    leafLfo.start(now);
    nodes.push(leafLfo);
    this._lfoNodes.push(leafLfo);

    // Layer 5: humid cicada hush — a very quiet 5.6 kHz band pulsing at ~6 Hz.
    const hush = this._noiseSource(now + 0.09, 1e9);
    nodes.push(hush);
    this._loopNodes.push(hush);
    const hushFilter = this._filter('bandpass', 5600, 1.6);
    const hushGain = this._gain(0);
    gains.hush = hushGain;
    hush.connect(hushFilter);
    hushFilter.connect(hushGain);
    this._out(hushGain, { bus: 'ambient', pan: 0.34, send: 0.02 });
    hushGain.gain.setValueAtTime(0.0001, now);
    hushGain.gain.linearRampToValueAtTime(0.007, now + 7.0);

    const hushLfo = ctx.createOscillator();
    hushLfo.frequency.value = 5.7;
    const hushLfoGain = this._gain(0.0022);
    hushLfo.connect(hushLfoGain);
    hushLfoGain.connect(hushGain.gain);
    hushLfo.start(now);
    nodes.push(hushLfo);
    this._lfoNodes.push(hushLfo);
  }

  _advanceIslandAmbience(dt) {
    if (!this._canPlay()) return;
    for (const key of Object.keys(this._islandAmbientIn)) {
      this._islandAmbientIn[key] -= dt;
      if (this._islandAmbientIn[key] > 0) continue;
      if (key === 'bird') {
        this._islandBird();
        this._islandAmbientIn.bird = rand(3.0, 7.5);
      } else if (key === 'wave') {
        this._islandWave();
        this._islandAmbientIn.wave = rand(4.5, 10.5);
      } else if (key === 'leaves') {
        this._islandLeafGust();
        this._islandAmbientIn.leaves = rand(5.0, 12.0);
      } else if (key === 'flock') {
        this._islandFlock();
        this._islandAmbientIn.flock = rand(12, 26);
      }
    }
  }

  /** One bird phrase. Three simple species: chirp cluster, falling trill, two-note call. */
  _islandBird(panOverride = null) {
    if (!this._canPlay()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + rand(0.05, 1.1);
    const pan = panOverride ?? rand(-0.85, 0.85);
    const near = Math.random();
    const peak = near > 0.45 ? 0.02 : 0.012;
    const send = near > 0.45 ? 0.35 : 0.6;
    const species = Math.floor(Math.random() * 3);

    if (species === 0) {
      // Bright chirp cluster, 2–4 descending notes.
      const notes = 2 + Math.floor(Math.random() * 3);
      let when = t0;
      for (let i = 0; i < notes; i++) {
        const freq = rand(2500, 4200) * (1 - i * 0.07);
        this._tone({
          type: 'sine', freq, freqEnd: freq * rand(0.82, 0.94),
          t: when - ctx.currentTime, duration: rand(0.05, 0.1),
          peak, attack: 0.006, pan, bus: 'ambient', send,
        });
        when += rand(0.09, 0.2);
      }
    } else if (species === 1) {
      // Falling trill: 6–9 very short notes.
      const notes = 6 + Math.floor(Math.random() * 4);
      const base = rand(3000, 4000);
      for (let i = 0; i < notes; i++) {
        const freq = base * (1 - i * 0.05);
        this._tone({
          type: 'triangle', freq, freqEnd: freq * 0.86,
          t: t0 - ctx.currentTime + i * rand(0.045, 0.06), duration: 0.05,
          peak: peak * 0.8, attack: 0.003, pan, bus: 'ambient', send,
        });
      }
    } else {
      // Two-note call ("koo-koo"), reads as a distant jungle bird.
      this._tone({
        type: 'triangle', freq: rand(760, 980), freqEnd: rand(640, 760),
        t: t0 - ctx.currentTime, duration: rand(0.16, 0.24),
        peak: peak * 0.85, attack: 0.02, pan, bus: 'ambient', send: Math.max(send, 0.6),
      });
      this._tone({
        type: 'triangle', freq: rand(700, 880), freqEnd: rand(560, 680),
        t: t0 - ctx.currentTime + rand(0.26, 0.4), duration: rand(0.14, 0.22),
        peak: peak * 0.7, attack: 0.02, pan, bus: 'ambient', send: Math.max(send, 0.6),
      });
    }
  }

  /** A small far flock: three chirps spread across the stereo field. */
  _islandFlock() {
    const count = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      this._islandBird(clamp(rand(-0.95, 0.95), -0.95, 0.95));
    }
  }

  /** Rolling wave that arrives on the reef: low swell + foam hiss. */
  _islandWave() {
    if (!this._canPlay()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + rand(0.1, 1.4);
    const duration = rand(1.8, 3.2);
    const src = this._brownSource(t0, duration);
    const filter = this._filter('bandpass', rand(360, 460), 0.9);
    try {
      filter.frequency.linearRampToValueAtTime(rand(700, 980), t0 + duration * 0.45);
      filter.frequency.linearRampToValueAtTime(rand(300, 420), t0 + duration);
    } catch (_) { /* ignore */ }
    const env = this._gain(0);
    this._swell(env, t0, rand(0.028, 0.055), duration * 0.42, duration * 0.08, duration * 0.5);
    src.connect(filter);
    filter.connect(env);
    this._out(env, { bus: 'ambient', pan: rand(-0.7, 0.7), send: 0.18 });

    // Foam hiss riding the back of the wave.
    this._noiseBurst({
      t: t0 - ctx.currentTime + duration * 0.45,
      duration: duration * 0.5,
      peak: rand(0.008, 0.016),
      attack: duration * 0.25,
      type: 'highpass',
      freq: rand(1500, 2200),
      pan: rand(-0.8, 0.8),
      bus: 'ambient',
      send: 0.12,
    });
  }

  /** Wind moving through the canopy: bright noise swell with a filter sweep. */
  _islandLeafGust() {
    if (!this._canPlay()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + rand(0, 1.0);
    const duration = rand(1.0, 2.4);
    const src = this._noiseSource(t0, duration);
    const filter = this._filter('bandpass', rand(2200, 3000), 0.9);
    try {
      filter.frequency.linearRampToValueAtTime(rand(3800, 5200), t0 + duration * 0.5);
      filter.frequency.linearRampToValueAtTime(rand(1900, 2800), t0 + duration);
    } catch (_) { /* ignore */ }
    const env = this._gain(0);
    this._swell(env, t0, rand(0.013, 0.026), duration * 0.35, duration * 0.15, duration * 0.5);
    src.connect(filter);
    filter.connect(env);
    this._out(env, { bus: 'ambient', pan: rand(-0.9, 0.9), send: 0.22 });
  }

  _startDrone() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Sub drone bed: three detuned low voices under a slow filter. It is gated
    // by _layerGains.drone, which stays silent until a run is live.
    const drone = this._gain(0);
    const filter = this._filter('lowpass', 190, 1.1);
    [41.2, 55, 82.4].forEach((freq, index) => {
      const osc = this._osc(index === 2 ? 'triangle' : 'sawtooth', freq, now, now + 1e9);
      const part = this._gain(index === 0 ? 0.5 : index === 1 ? 0.32 : 0.18);
      osc.connect(part);
      part.connect(filter);
      this._loopNodes.push(osc);
    });
    filter.connect(drone);
    drone.connect(this._layerGains.drone);
    const send = this._gain(0.18);
    this._layerGains.drone.connect(send);
    send.connect(this.reverb);
    drone.gain.setValueAtTime(0.0001, now);
    drone.gain.linearRampToValueAtTime(0.11, now + 6);
    this._droneBus = drone;
  }

  _advanceAmbience(dt) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.worldStyle === 'island') {
      this._advanceIslandAmbience(dt);
      return;
    }
    for (const key of Object.keys(this._ambientIn)) {
      this._ambientIn[key] -= dt;
      if (this._ambientIn[key] > 0) continue;
      if (key === 'creak') {
        this._creak();
        this._ambientIn.creak = rand(9, 22);
      } else if (key === 'static') {
        this._radioStatic();
        this._ambientIn.static = rand(14, 32);
      } else if (key === 'gust') {
        this._distantGust();
        this._ambientIn.gust = rand(16, 34);
      }
    }
  }

  _creak() {
    if (!this._canPlay()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + rand(0, 0.8);
    const osc = this._osc('sawtooth', rand(120, 190), t0, t0 + 2.6);
    try {
      osc.frequency.linearRampToValueAtTime(rand(90, 130), t0 + 2.2);
    } catch (_) { /* ignore */ }
    const filter = this._filter('bandpass', rand(180, 340), 7);
    const env = this._gain(0);
    this._swell(env, t0, 0.018, 0.7, 0.4, 1.5);
    osc.connect(filter);
    filter.connect(env);
    this._out(env, { bus: 'ambient', pan: rand(-0.8, 0.8), send: 0.6 });
  }

  _radioStatic() {
    if (!this._canPlay()) return;
    const t0 = this.ctx.currentTime + rand(0.1, 1.2);
    const duration = rand(0.7, 1.8);
    const burst = this._noiseBurst({
      t: t0 - this.ctx.currentTime,
      duration,
      peak: 0.022,
      attack: 0.03,
      type: 'bandpass',
      freq: rand(1900, 2800),
      q: 1.6,
      pan: rand(-0.9, 0.9),
      bus: 'ambient',
      send: 0.35,
    });
    // Crackle: a few random micro-clicks inside the static.
    const clicks = 2 + Math.floor(Math.random() * 5);
    for (let i = 0; i < clicks; i++) {
      this._noiseBurst({
        t: t0 - this.ctx.currentTime + rand(0, duration * 0.8),
        duration: 0.014,
        peak: 0.02,
        attack: 0.0008,
        type: 'highpass',
        freq: rand(2200, 4800),
        pan: rand(-0.95, 0.95),
        bus: 'ambient',
        send: 0.15,
      });
    }
    void burst;
  }

  _distantGust() {
    if (!this._canPlay()) return;
    const t0 = this.ctx.currentTime + rand(0, 0.6);
    const duration = rand(2.4, 4.6);
    const src = this._brownSource(t0, duration);
    const filter = this._filter('bandpass', rand(280, 460), 1.1);
    try {
      filter.frequency.linearRampToValueAtTime(rand(700, 1100), t0 + duration * 0.55);
      filter.frequency.linearRampToValueAtTime(rand(260, 420), t0 + duration);
    } catch (_) { /* ignore */ }
    const env = this._gain(0);
    this._swell(env, t0, rand(0.02, 0.045), duration * 0.4, duration * 0.1, duration * 0.5);
    src.connect(filter);
    filter.connect(env);
    this._out(env, { bus: 'ambient', pan: rand(-0.9, 0.9), send: 0.3 });
  }

  // =========================================================================
  // Adaptive industrial combat score
  // =========================================================================

  startRun() {
    this._musicOn = true;
    this.combatTarget = Math.max(this.combatTarget, 0.35);
    if (!this._canPlay()) return;
    this._nextStepAt = this.ctx.currentTime + 0.1;
    this._updateLayerGains();

    // Cinematic deployment: sub boom, rising dust, radio chirp.
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this._tone({ type: 'sine', freq: 110, freqEnd: 32, t: 0, duration: 0.9, peak: 0.3, send: 0.25 });
    const riser = this._noiseBurst({
      t: 0,
      duration: 1.35,
      peak: 0.09,
      attack: 0.25,
      type: 'bandpass',
      freq: 320,
      freqEnd: 2600,
      q: 1.2,
      send: 0.3,
    });
    void riser;
    this._metal({ t: 0.02, base: 180, duration: 0.4, peak: 0.06, send: 0.4 });
    this._noiseBurst({ t: 1.28, duration: 0.05, peak: 0.12, type: 'highpass', freq: 2000, send: 0.1 });
    this._tone({ type: 'square', freq: 1480, t: 1.28, duration: 0.045, peak: 0.028, bus: 'ui' });
    void now;
  }

  update(dt = 0.016, listener = null) {
    if (!this.ctx || this.disposed) return;
    if (listener) this._listener = listener;
    const step = clamp(dt, 0, 0.1);
    const smoothing = 1 - Math.exp(-2.2 * step);
    this.combat += (this.combatTarget - this.combat) * smoothing;
    this._advanceMusic();
    this._advanceAmbience(step);
    this._updateLayerGains();
  }

  _advanceMusic() {
    const ctx = this.ctx;
    if (!this._musicOn || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (this._nextStepAt < now - 0.35) this._nextStepAt = now + 0.06;
    const lookahead = 0.22;
    let guard = 0;
    while (this._nextStepAt < now + lookahead && guard++ < 24) {
      this._scheduleMusicStep(this._step, this._nextStepAt);
      this._step = (this._step + 1) % 64;
      const bpm = 84 + 46 * this.combat;
      this._nextStepAt += 60 / bpm / 4;
    }
  }

  _scheduleMusicStep(step, t) {
    const intensity = this.combat;
    if (intensity < 0.015) return;
    const ctx = this.ctx;
    const rel = Math.max(0, t - ctx.currentTime);
    const pulseLayer = this._layerGains ? this._layerGains.pulse : this.musicBus;
    const bassLayer = this._layerGains ? this._layerGains.bass : this.musicBus;
    const airLayer = this._layerGains ? this._layerGains.air : this.musicBus;

    // Kick / sub pulse on quarters.
    if (step % 4 === 0) {
      const osc = this._osc('sine', 120, t, t + 0.24);
      try {
        osc.frequency.exponentialRampToValueAtTime(41, t + 0.16);
      } catch (_) { /* ignore */ }
      const env = this._gain(0);
      this._hit(env, t, 0.24 + 0.26 * intensity, 0.002, 0.22);
      osc.connect(env);
      env.connect(pulseLayer);
    }

    // Industrial metallic tick on the off-beats.
    if (step % 4 === 2) {
      const src = this._noiseSource(t, 0.06);
      const filter = this._filter('bandpass', 2600 + 900 * intensity, 2.2);
      const env = this._gain(0);
      this._hit(env, t, 0.02 + 0.05 * intensity, 0.001, 0.055);
      src.connect(filter);
      filter.connect(env);
      env.connect(pulseLayer);
    }

    // Sparse hats once the fight is hot.
    if (intensity > 0.42 && step % 2 === 1) {
      const src = this._noiseSource(t, 0.035);
      const filter = this._filter('highpass', 5200, 0.8);
      const env = this._gain(0);
      this._hit(env, t, 0.006 + 0.014 * intensity, 0.001, 0.03);
      src.connect(filter);
      filter.connect(env);
      env.connect(airLayer);
    }

    // Bass ostinato, 8th notes. A minor-ish industrial riff.
    if (step % 2 === 0) {
      const pattern = [0, 0, 7, 0, 0, 5, 0, 3];
      const note = pattern[Math.floor(step / 2) % pattern.length];
      const freq = 55 * Math.pow(2, note / 12);
      const osc = this._osc('sawtooth', freq, t, t + 0.3);
      const filter = this._filter('lowpass', 220 + 260 * intensity, 3.2);
      const env = this._gain(0);
      this._hit(env, t, 0.028 + 0.055 * intensity, 0.008, 0.24);
      osc.connect(filter);
      filter.connect(env);
      env.connect(bassLayer);
    }

    // Wide pad swell each bar.
    if (step % 16 === 0) {
      const root = 110;
      const chord = [1, 1.5, 2, 2.378];
      const t0 = t;
      const duration = 2.6;
      const padEnv = this._gain(0);
      this._swell(padEnv, t0, 0.012 + 0.03 * intensity, 0.7, 0.6, 1.6);
      chord.forEach((ratio, index) => {
        const osc = this._osc(index < 2 ? 'sine' : 'triangle', root * ratio, t0, t0 + duration);
        osc.detune.value = rand(-6, 6);
        const g = this._gain(0.8 / (index + 1));
        osc.connect(g);
        g.connect(padEnv);
      });
      padEnv.connect(airLayer);
    }

    // Distant alarm motif at peak intensity.
    if (intensity > 0.72 && step % 32 === 12) {
      const base = 392;
      [1, 1.5].forEach((ratio, index) => {
        const osc = this._osc('square', base * ratio, t + index * 0.18, t + index * 0.18 + 0.16);
        const filter = this._filter('lowpass', 1100, 1.5);
        const env = this._gain(0);
        this._hit(env, t + index * 0.18, 0.012 + 0.014 * intensity, 0.004, 0.15);
        osc.connect(filter);
        filter.connect(env);
        env.connect(this.musicBus);
      });
    }
    void rel;
  }

  // =========================================================================
  // Player weapon + foley
  // =========================================================================

  /**
   * Player weapon report. `kind` selects the weapon family; the default 'rifle'
   * keeps the original VXR-7 synthesis byte-for-byte so existing call sites
   * (`shot()`) are unchanged:
   *   'rifle' | 'gatling' (higher/tighter/quieter) | 'shotgun' (low boom, longer
   *   tail) | 'rocket' (igniter thump + launch whoosh; explosion stays separate).
   */
  shot(kind = 'rifle') {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime;
    if (now - this._lastShot < 0.028) return; // hard safety for double-taps
    this._lastShot = now;
    this._shotFlip = (this._shotFlip + 1) % 3;
    const flip = this._shotFlip;
    if (kind === 'gatling') this._shotGatling(flip);
    else if (kind === 'shotgun') this._shotShotgun(flip);
    else if (kind === 'rocket') this._shotRocket(flip);
    else this._shotRifle(flip);
  }

  _shotRifle(flip) {
    const punch = 0.94 + Math.random() * 0.12;
    const pan = rand(-0.05, 0.05);

    // Transient crack.
    this._noiseBurst({
      duration: 0.055, peak: 0.62 * punch, attack: 0.001,
      type: 'highpass', freq: 1350, freqEnd: 3200, q: 0.7,
      pan, send: 0.18,
    });
    // Mid body of the report.
    this._noiseBurst({
      duration: 0.16 + flip * 0.01, peak: 0.4 * punch, attack: 0.002,
      type: 'bandpass', freq: 780 + flip * 90, freqEnd: 340, q: 0.9,
      pan, send: 0.28,
    });
    // Sub thump (the chest punch).
    this._tone({
      type: 'sine', freq: 150 + flip * 8, freqEnd: 46, duration: 0.17,
      peak: 0.42 * punch, attack: 0.001, pan, send: 0.16,
    });
    // Mechanical action / casing tick.
    this._noiseBurst({
      t: 0.035, duration: 0.02, peak: 0.09, attack: 0.001,
      type: 'bandpass', freq: 3200, q: 2.5, pan, send: 0.1,
    });
    // Outdoor tail / slap-back.
    this._noiseBurst({
      t: 0.02, duration: 0.34, peak: 0.09, attack: 0.02,
      type: 'lowpass', freq: 900, freqEnd: 260, q: 0.6,
      pan: pan * 2, send: 0.5,
    });
    if (flip === 0) {
      this._metal({ t: 0.01, base: 2400, duration: 0.06, peak: 0.025, send: 0.2 });
    }
  }

  /** Gatling: high, mechanical, tight; ~0.8x the rifle level so 19 rps do not fatigue. */
  _shotGatling(flip) {
    const punch = 0.78 + Math.random() * 0.12;
    const pan = rand(-0.04, 0.04);

    // Hard mechanical crack (higher + narrower than the rifle).
    this._noiseBurst({
      duration: 0.032, peak: 0.44 * punch, attack: 0.001,
      type: 'highpass', freq: 2350, freqEnd: 5200, q: 0.85,
      pan, send: 0.12,
    });
    // Tight mid body.
    this._noiseBurst({
      duration: 0.075, peak: 0.3 * punch, attack: 0.001,
      type: 'bandpass', freq: 1250 + flip * 45, freqEnd: 620, q: 1.1,
      pan, send: 0.16,
    });
    // Higher motor pulse instead of the rifle's deep sub thump.
    this._tone({
      type: 'triangle', freq: 205 + flip * 6, freqEnd: 82, duration: 0.08,
      peak: 0.22 * punch, attack: 0.001, pan, send: 0.1,
    });
    // Feed / bolt tick.
    this._noiseBurst({
      t: 0.012, duration: 0.016, peak: 0.07, attack: 0.001,
      type: 'bandpass', freq: 4200, q: 2.6, pan, send: 0.08,
    });
    // Short tail (the barrels mask the outdoor slap).
    this._noiseBurst({
      t: 0.015, duration: 0.16, peak: 0.055, attack: 0.012,
      type: 'lowpass', freq: 700, freqEnd: 240, q: 0.6,
      pan: pan * 2, send: 0.26,
    });
    if (flip === 0) {
      this._metal({ t: 0.004, base: 1900, duration: 0.045, peak: 0.02, spread: 2.1, send: 0.16 });
    }
  }

  /** Shotgun: low boom + noise slap with a long outdoor tail. */
  _shotShotgun(flip) {
    const punch = 1.0 + Math.random() * 0.1;
    const pan = rand(-0.07, 0.07);

    // Deep sub boom.
    this._tone({
      type: 'sine', freq: 76 + flip * 3, freqEnd: 33, duration: 0.34,
      peak: 0.56 * punch, attack: 0.002, pan, send: 0.2,
    });
    // Broad low body.
    this._noiseBurst({
      duration: 0.26, peak: 0.46 * punch, attack: 0.002,
      type: 'lowpass', freq: 920, freqEnd: 180, q: 0.6,
      pan, send: 0.3,
    });
    // Pellet slap / pressure crack.
    this._noiseBurst({
      duration: 0.055, peak: 0.3 * punch, attack: 0.001,
      type: 'highpass', freq: 1100, freqEnd: 3000, q: 0.7,
      pan, send: 0.22,
    });
    // Mid punch.
    this._noiseBurst({
      t: 0.006, duration: 0.12, peak: 0.24 * punch, attack: 0.002,
      type: 'bandpass', freq: 520, freqEnd: 240, q: 0.9,
      pan, send: 0.24,
    });
    // Long outdoor tail.
    this._noiseBurst({
      t: 0.03, duration: 0.62, peak: 0.12 * punch, attack: 0.03,
      type: 'lowpass', freq: 520, freqEnd: 130, q: 0.5,
      pan: pan * 2, send: 0.6,
    });
    if (flip === 0) {
      this._metal({ t: 0.02, base: 340, duration: 0.12, peak: 0.035, spread: 2.4, send: 0.3 });
    }
  }

  /** RPG launch: igniter thump + rising whoosh + tube resonance (explosion is separate). */
  _shotRocket(flip) {
    const punch = 0.95 + Math.random() * 0.1;
    const pan = rand(-0.08, 0.08);

    // Igniter thump.
    this._tone({
      type: 'sine', freq: 108, freqEnd: 27, duration: 0.4,
      peak: 0.48 * punch, attack: 0.003, pan, send: 0.18,
    });
    // Launch whoosh: rising band-passed noise.
    this._noiseBurst({
      duration: 0.6, peak: 0.28 * punch, attack: 0.02,
      type: 'bandpass', freq: 380, freqEnd: 2200, q: 0.9,
      pan, send: 0.35,
    });
    // Ignition crackle slap.
    this._noiseBurst({
      t: 0.01, duration: 0.09, peak: 0.24 * punch, attack: 0.001,
      type: 'highpass', freq: 900, freqEnd: 2600, q: 0.7,
      pan, send: 0.25,
    });
    // Launcher / tube resonance.
    this._metal({ t: 0.012, base: 260 + flip * 20, duration: 0.16, peak: 0.05, spread: 2.2, send: 0.3 });
    // Exhaust tail.
    this._noiseBurst({
      t: 0.12, duration: 0.8, peak: 0.09 * punch, attack: 0.08,
      type: 'lowpass', freq: 700, freqEnd: 180, q: 0.5,
      pan: pan * 2, send: 0.55,
    });
  }

  // -------------------------------------------------------------------------
  // Gatling spin-up whir
  // -------------------------------------------------------------------------

  /**
   * Start/stop the M-77 mechanical whir. Safe before init() (state is remembered
   * and the loop starts once the context is live) and safe to call redundantly.
   * WeaponSystem stops it on weapon switch, reset, setActive(false) and dispose.
   */
  gatlingSpin(active) {
    const on = !!active;
    this._spinWanted = on;
    if (!this._canPlay()) return;
    if (on) this._startSpinLoop();
    else this._stopSpinLoop();
  }

  /** Spin amount 0..1 → whir pitch / level (cheap param ramps, no new nodes). */
  gatlingSpinRate(rate) {
    const value = clamp(rate, 0, 1);
    this._spinRate = value;
    const loop = this._spinLoop;
    if (!loop || !this.ctx || this.disposed) return;
    const now = this.ctx.currentTime;
    try { loop.hum.frequency.setTargetAtTime(46 + 34 * value, now, 0.02); } catch (_) { /* ignore */ }
    try { loop.band.frequency.setTargetAtTime(170 + 310 * value, now, 0.03); } catch (_) { /* ignore */ }
    if (loop.spinning) {
      try { loop.gain.gain.setTargetAtTime(0.02 + 0.045 * value, now, 0.06); } catch (_) { /* ignore */ }
    }
  }

  _startSpinLoop() {
    if (this._spinLoop || !this._canPlay() || !this._brownBuf) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Air / rotor wash: looping brown noise through a narrow band.
    const src = this._brownSource(now, 1e9);
    const band = this._filter('bandpass', 170 + 310 * this._spinRate, 1.5);
    const gain = this._gain(0.0001);
    src.connect(band);
    band.connect(gain);
    this._out(gain, { send: 0.05 });
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.02 + 0.045 * this._spinRate, now + 0.09);
    // Motor hum: saw through a low-pass.
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.setValueAtTime(46 + 34 * this._spinRate, now);
    const humFilter = this._filter('lowpass', 260, 1.1);
    const humGain = this._gain(0.028);
    hum.connect(humFilter);
    humFilter.connect(humGain);
    this._out(humGain, { send: 0.03 });
    hum.start(now);
    this._loopNodes.push(src, hum);
    this._spinLoop = { src, band, gain, hum, humFilter, humGain, spinning: true };
  }

  _stopSpinLoop() {
    const loop = this._spinLoop;
    if (!loop) return;
    this._spinLoop = null;
    loop.spinning = false;
    const idxSrc = this._loopNodes.indexOf(loop.src);
    if (idxSrc >= 0) this._loopNodes.splice(idxSrc, 1);
    const idxHum = this._loopNodes.indexOf(loop.hum);
    if (idxHum >= 0) this._loopNodes.splice(idxHum, 1);
    if (!this.ctx || this.disposed) return;
    const now = this.ctx.currentTime;
    // Short fade so switching / releasing never clicks.
    try { loop.gain.gain.cancelScheduledValues(now); } catch (_) { /* ignore */ }
    try { loop.gain.gain.setTargetAtTime(0.0001, now, 0.035); } catch (_) { /* ignore */ }
    try { loop.humGain.gain.setTargetAtTime(0.0001, now, 0.035); } catch (_) { /* ignore */ }
    const stopAt = now + 0.22;
    try { loop.src.stop(stopAt); } catch (_) { /* already scheduled */ }
    try { loop.hum.stop(stopAt); } catch (_) { /* already scheduled */ }
  }

  dryFire() {
    if (!this._canPlay()) return;
    this._noiseBurst({
      duration: 0.03, peak: 0.16, attack: 0.001,
      type: 'bandpass', freq: 2100, q: 2.4, send: 0.1,
    });
    this._tone({ type: 'square', freq: 1180, freqEnd: 640, duration: 0.045, peak: 0.035, send: 0.08 });
  }

  reloadStart() {
    if (!this._canPlay()) return;
    // Mag release + cloth.
    this._noiseBurst({ duration: 0.045, peak: 0.16, type: 'bandpass', freq: 1500, q: 1.6, send: 0.1 });
    this._metal({ t: 0.015, base: 760, duration: 0.12, peak: 0.05, spread: 2.2, send: 0.15 });
    this._noiseBurst({ t: 0.03, duration: 0.16, peak: 0.05, type: 'lowpass', freq: 1100, send: 0.06 });
  }

  reloadMagIn() {
    if (!this._canPlay()) return;
    this._noiseBurst({ duration: 0.05, peak: 0.2, type: 'bandpass', freq: 1100, q: 1.1, send: 0.12 });
    this._tone({ type: 'sine', freq: 120, freqEnd: 62, duration: 0.11, peak: 0.2, send: 0.12 });
    this._metal({ t: 0.05, base: 520, duration: 0.16, peak: 0.06, spread: 2.7, send: 0.18 });
    this._noiseBurst({ t: 0.09, duration: 0.025, peak: 0.09, type: 'highpass', freq: 2800, send: 0.1 });
  }

  reloadBolt() {
    if (!this._canPlay()) return;
    const clicks = [0, 0.055, 0.11];
    clicks.forEach((offset, index) => {
      this._noiseBurst({
        t: offset, duration: 0.022, peak: 0.11 + index * 0.015,
        type: 'bandpass', freq: 2300 + index * 320, q: 2.2, send: 0.1,
      });
      this._metal({ t: offset, base: 900 + index * 180, duration: 0.05, peak: 0.03, send: 0.12 });
    });
    this._noiseBurst({ t: 0.15, duration: 0.06, peak: 0.18, type: 'bandpass', freq: 1300, q: 1.2, send: 0.15 });
    this._metal({ t: 0.16, base: 430, duration: 0.2, peak: 0.07, spread: 2.4, send: 0.2 });
  }

  footstep(sprinting = false) {
    if (!this._canPlay()) return;
    const heavy = sprinting ? 1.45 : 1;
    const variant = Math.random();
    const pan = rand(-0.16, 0.16);
    this._noiseBurst({
      duration: 0.075 + variant * 0.03, peak: 0.075 * heavy * rand(0.85, 1.15),
      attack: 0.002, type: 'bandpass', freq: 950 + rand(-220, 320), q: 0.7,
      pan, send: 0.06,
    });
    this._tone({
      type: 'sine', freq: 105 + rand(-12, 16), freqEnd: 62,
      duration: 0.06, peak: 0.055 * heavy, attack: 0.001, pan, send: 0.04,
    });
    if (sprinting && chance(0.4)) {
      this._noiseBurst({ t: 0.01, duration: 0.14, peak: 0.03, type: 'highpass', freq: 1900, pan: -pan, send: 0.1 });
    }
  }

  jump() {
    if (!this._canPlay()) return;
    this._noiseBurst({ duration: 0.18, peak: 0.05, attack: 0.02, type: 'highpass', freq: 1200, freqEnd: 2400, send: 0.1 });
    this._noiseBurst({ duration: 0.12, peak: 0.05, type: 'lowpass', freq: 500, send: 0.06 });
  }

  land() {
    if (!this._canPlay()) return;
    this._noiseBurst({ duration: 0.14, peak: 0.2, type: 'lowpass', freq: 700, freqEnd: 220, send: 0.14 });
    this._tone({ type: 'sine', freq: 92, freqEnd: 44, duration: 0.15, peak: 0.22, send: 0.1 });
    this._noiseBurst({ t: 0.02, duration: 0.1, peak: 0.06, type: 'highpass', freq: 1500, send: 0.1 });
  }

  // =========================================================================
  // Combat feedback
  // =========================================================================

  hitmarker(headshot = false) {
    if (!this._canPlay()) return;
    const base = headshot ? 1720 : 1180;
    this._tone({
      type: 'sine', freq: base, freqEnd: headshot ? base * 1.42 : base * 0.94,
      duration: headshot ? 0.11 : 0.065, peak: headshot ? 0.16 : 0.1, send: 0.12,
    });
    this._noiseBurst({ duration: 0.02, peak: headshot ? 0.12 : 0.07, type: 'highpass', freq: 3800, send: 0.1 });
    if (headshot) {
      this._tone({ type: 'triangle', freq: 2600, duration: 0.14, peak: 0.07, t: 0.012, send: 0.2 });
      this._tone({ type: 'sine', freq: 520, freqEnd: 380, duration: 0.16, peak: 0.09, t: 0.01, send: 0.12 });
    }
  }

  enemyHit() {
    if (!this._canPlay()) return;
    this._noiseBurst({ duration: 0.05, peak: 0.2, type: 'bandpass', freq: 1500, q: 1.3, send: 0.15 });
    this._metal({ base: 320 + rand(0, 90), duration: 0.16, peak: 0.11, spread: 1.9, send: 0.25 });
    this._tone({ type: 'square', freq: 720 + rand(0, 160), freqEnd: 300, duration: 0.09, peak: 0.035, send: 0.1 });
  }

  kill() {
    if (!this._canPlay()) return;
    this._tone({ type: 'sine', freq: 880, freqEnd: 1180, duration: 0.09, peak: 0.12, send: 0.2 });
    this._tone({ type: 'sine', freq: 1320, freqEnd: 1760, duration: 0.16, peak: 0.09, t: 0.07, send: 0.25 });
    this._tone({ type: 'sine', freq: 150, freqEnd: 60, duration: 0.18, peak: 0.16, send: 0.12 });
    this._metal({ t: 0.01, base: 620, duration: 0.24, peak: 0.05, send: 0.3 });
  }

  explosion(scale = 1) {
    if (!this._canPlay()) return;
    const s = clamp(scale, 0.35, 2.6);
    const pan = rand(-0.25, 0.25);
    // Core sub.
    const sub = this._osc('sine', 88 * (1 / Math.sqrt(s)), this._now(), this._now() + 1.1);
    try {
      sub.frequency.exponentialRampToValueAtTime(26, this._now() + 0.75);
    } catch (_) { /* ignore */ }
    const shaper = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.6);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    const subEnv = this._gain(0);
    this._hit(subEnv, this._now(), 0.5 * s, 0.004, 0.8);
    sub.connect(shaper);
    shaper.connect(subEnv);
    this._out(subEnv, { pan, send: 0.35 });

    // Body / fireball.
    this._noiseBurst({
      duration: 0.55 * s, peak: 0.4 * s, attack: 0.004,
      type: 'lowpass', freq: 1300, freqEnd: 160, q: 0.6,
      pan, send: 0.45,
    });
    // Debris crackle.
    this._noiseBurst({
      t: 0.03, duration: 0.3 * s, peak: 0.22 * s, attack: 0.002,
      type: 'highpass', freq: 1400, freqEnd: 600, q: 0.7,
      pan: -pan, send: 0.4,
    });
    // Distant tail.
    this._noiseBurst({
      t: 0.08, duration: 1.2 * s, peak: 0.13 * s, attack: 0.06,
      type: 'lowpass', freq: 420, freqEnd: 120, q: 0.5,
      pan, send: 0.7,
    });
    if (chance(0.6)) this._metal({ t: 0.02, base: 180, duration: 0.4, peak: 0.06 * s, send: 0.5 });
  }

  enemyShot(distance = 20, pan = 0) {
    if (!this._canPlay()) return;
    const d = clamp(distance, 0, 90);
    const delay = d / 343;
    const gain = 0.46 / (1 + d * 0.055);
    const cutoff = clamp(5200 / (1 + d * 0.13), 420, 5200);
    const p = clamp(pan, -1, 1) * (0.55 + Math.min(0.45, d / 80));
    this._noiseBurst({
      t: delay, duration: 0.06, peak: 0.55 * gain, attack: 0.001,
      type: 'highpass', freq: cutoff * 0.9, q: 0.7, pan: p, send: 0.25,
    });
    this._noiseBurst({
      t: delay + 0.005, duration: 0.16, peak: 0.3 * gain, attack: 0.003,
      type: 'lowpass', freq: cutoff, freqEnd: 240, q: 0.8, pan: p, send: 0.4,
    });
    this._tone({
      type: 'sine', freq: 120, freqEnd: 48, t: delay, duration: 0.16,
      peak: 0.3 * gain, pan: p, send: 0.25,
    });
  }

  /**
   * Bullet impact on world geometry. Called by WeaponSystem as
   * `audio.impact(surface, distance)`. Surface-aware, distance-attenuated.
   */
  impact(surface = 'stone', distance = 20) {
    if (!this._canPlay()) return;
    const d = clamp(distance, 0, 120);
    const gain = 0.55 / (1 + d * 0.075);
    const pan = rand(-0.22, 0.22);
    const send = clamp(0.14 + d / 160, 0.14, 0.55);
    switch (String(surface).toLowerCase()) {
      case 'sand':
        this._noiseBurst({
          duration: 0.11, peak: 0.16 * gain, attack: 0.002,
          type: 'lowpass', freq: 780, freqEnd: 220, q: 0.7, pan, send,
        });
        this._tone({ type: 'sine', freq: 88, freqEnd: 52, duration: 0.08, peak: 0.06 * gain, pan, send: 0.06 });
        break;
      case 'metal':
        this._noiseBurst({
          duration: 0.045, peak: 0.2 * gain, attack: 0.001,
          type: 'highpass', freq: 2400, freqEnd: 1200, q: 0.7, pan, send,
        });
        this._metal({ base: 640 + rand(-120, 180), duration: 0.22, peak: 0.075 * gain, spread: 2.1, pan, send: 0.35 });
        break;
      case 'wood':
        this._noiseBurst({
          duration: 0.07, peak: 0.18 * gain, attack: 0.001,
          type: 'bandpass', freq: 620, q: 2.6, pan, send,
        });
        this._tone({ type: 'triangle', freq: 240, freqEnd: 130, duration: 0.09, peak: 0.06 * gain, pan, send: 0.08 });
        break;
      case 'fabric':
        this._noiseBurst({
          duration: 0.09, peak: 0.1 * gain, attack: 0.003,
          type: 'lowpass', freq: 520, freqEnd: 180, q: 0.8, pan, send: 0.08,
        });
        break;
      default:
        this._noiseBurst({
          duration: 0.055, peak: 0.22 * gain, attack: 0.001,
          type: 'bandpass', freq: 1650, q: 1.1, pan, send,
        });
        this._noiseBurst({
          t: 0.008, duration: 0.13, peak: 0.09 * gain, attack: 0.004,
          type: 'lowpass', freq: 700, freqEnd: 240, q: 0.6, pan: -pan, send,
        });
        break;
    }
    // Tiny debris/ricochet sparkle for nearby impacts.
    if (d < 18 && chance(0.5)) {
      this._noiseBurst({
        t: 0.02, duration: 0.035, peak: 0.035 * gain,
        type: 'highpass', freq: 4800, pan: rand(-0.4, 0.4), send: 0.2,
      });
    }
  }

  robotStep(distance = 10) {
    if (!this._canPlay()) return;
    const d = clamp(distance, 0, 60);
    const gain = 0.5 / (1 + d * 0.09);
    const pan = rand(-0.55, 0.55);
    this._tone({
      type: 'sine', freq: 72, freqEnd: 44, duration: 0.1,
      peak: 0.2 * gain, pan, send: 0.12,
    });
    this._noiseBurst({
      duration: 0.055, peak: 0.1 * gain, type: 'bandpass',
      freq: 900, q: 1.4, pan, send: 0.16,
    });
    this._metal({ base: 340, duration: 0.07, peak: 0.025 * gain, pan, send: 0.2 });
  }

  teleport() {
    if (!this._canPlay()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const duration = 0.9;
    const carrier = this._osc('sawtooth', 90, t0, t0 + duration + 0.1);
    try {
      carrier.frequency.exponentialRampToValueAtTime(1400, t0 + duration * 0.62);
      carrier.frequency.exponentialRampToValueAtTime(120, t0 + duration);
    } catch (_) { /* ignore */ }
    const band = this._filter('bandpass', 300, 3.5);
    try {
      band.frequency.linearRampToValueAtTime(3200, t0 + duration * 0.6);
      band.frequency.linearRampToValueAtTime(500, t0 + duration);
    } catch (_) { /* ignore */ }
    const env = this._gain(0);
    this._swell(env, t0, 0.12, 0.18, 0.15, 0.55);
    carrier.connect(band);
    band.connect(env);
    this._out(env, { pan: rand(-0.3, 0.3), send: 0.5 });
    this._noiseBurst({
      t: 0, duration: 0.7, peak: 0.08, attack: 0.12,
      type: 'highpass', freq: 800, freqEnd: 4200, q: 0.7, send: 0.5,
    });
    this._tone({ type: 'sine', freq: 70, freqEnd: 30, t: duration * 0.55, duration: 0.4, peak: 0.22, send: 0.25 });
  }

  playerHurt() {
    if (!this._canPlay()) return;
    this._noiseBurst({
      duration: 0.16, peak: 0.3, attack: 0.002,
      type: 'lowpass', freq: 900, freqEnd: 180, q: 1.1, send: 0.2,
    });
    this._tone({ type: 'sine', freq: 125, freqEnd: 52, duration: 0.25, peak: 0.3, send: 0.16 });
    this._tone({ type: 'triangle', freq: 70, freqEnd: 46, duration: 0.14, peak: 0.14, t: 0.06, send: 0.1 });
    this._noiseBurst({ t: 0.02, duration: 0.045, peak: 0.1, type: 'bandpass', freq: 2600, q: 2, send: 0.1 });
  }

  playerDeath() {
    if (!this._canPlay()) return;
    this._musicOn = false;
    this._updateLayerGains();
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    // Collapsing drone + heartbeat + radio noise wash.
    const drone = this._osc('sawtooth', 180, t0, t0 + 3.4);
    try {
      drone.frequency.exponentialRampToValueAtTime(32, t0 + 2.8);
    } catch (_) { /* ignore */ }
    const filter = this._filter('lowpass', 900, 2);
    try {
      filter.frequency.exponentialRampToValueAtTime(90, t0 + 2.6);
    } catch (_) { /* ignore */ }
    const env = this._gain(0);
    this._swell(env, t0, 0.16, 0.05, 0.5, 2.6);
    drone.connect(filter);
    filter.connect(env);
    this._out(env, { send: 0.55 });

    [0, 0.34, 0.78].forEach((offset, index) => {
      const beat = this._osc('sine', 58, t0 + offset, t0 + offset + 0.5);
      const gain = this._gain(0);
      this._hit(gain, t0 + offset, 0.24 / (index + 1), 0.01, 0.4);
      beat.connect(gain);
      this._out(gain, { send: 0.2 });
    });
    this._noiseBurst({
      t: 0.15, duration: 2.4, peak: 0.07, attack: 0.3,
      type: 'bandpass', freq: 700, freqEnd: 260, q: 0.9, send: 0.6,
    });
    this._noiseBurst({ t: 0.2, duration: 0.5, peak: 0.12, type: 'highpass', freq: 2000, send: 0.3 });
  }

  // =========================================================================
  // Director / UI stingers
  // =========================================================================

  waveStart(wave = 1) {
    if (!this._canPlay()) return;
    const index = clamp(wave, 1, 9) - 1;
    const base = 430 + index * 26;
    // Three accelerating alarm pulses.
    [0, 0.42, 0.78].forEach((offset, i) => {
      const freq = base + (i % 2 === 0 ? 0 : 130);
      const osc = this._osc('square', freq, this._now() + offset, this._now() + offset + 0.24);
      const filter = this._filter('lowpass', 1900, 1.4);
      const env = this._gain(0);
      this._hit(env, this._now() + offset, 0.045 + i * 0.006, 0.01, 0.2);
      osc.connect(filter);
      filter.connect(env);
      this._out(env, { pan: i === 1 ? 0.2 : -0.2, send: 0.35 });
    });
    // Tension riser.
    this._noiseBurst({
      t: 0.1, duration: 1.25, peak: 0.08, attack: 0.5,
      type: 'bandpass', freq: 260, freqEnd: 2400, q: 1.4, send: 0.45,
    });
    // Sub drop under the last pulse.
    this._tone({ type: 'sine', freq: 95, freqEnd: 34, t: 0.72, duration: 0.8, peak: 0.24, send: 0.25 });
  }

  waveClear() {
    if (!this._canPlay()) return;
    const t = this._now();
    // Rising bright chord + confirmation pings.
    [0, 0.09, 0.18].forEach((offset, index) => {
      this._tone({
        type: 'sine', freq: 660 * Math.pow(2, index / 4), duration: 0.35,
        peak: 0.09, t: offset, send: 0.4,
      });
    });
    [1, 1.5, 2].forEach((ratio, index) => {
      const osc = this._osc('triangle', 220 * ratio, t + 0.02, t + 1.5);
      const env = this._gain(0);
      this._swell(env, t + 0.02, 0.028 / (index + 1), 0.25, 0.3, 1.0);
      osc.connect(env);
      this._out(env, { send: 0.5 });
    });
    this._tone({ type: 'sine', freq: 110, freqEnd: 55, duration: 0.5, peak: 0.14, t: 0.02, send: 0.2 });
  }

  victory() {
    if (!this._canPlay()) return;
    this._musicOn = false;
    this._updateLayerGains();
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const chord = [146.83, 220, 293.66, 369.99, 440];
    chord.forEach((freq, index) => {
      const osc = this._osc(index % 2 === 0 ? 'triangle' : 'sine', freq, t0, t0 + 4);
      const filter = this._filter('lowpass', 2200, 0.8);
      const env = this._gain(0);
      this._swell(env, t0, 0.05 / (1 + index * 0.25), 0.35 + index * 0.05, 1.1, 2.2);
      osc.connect(filter);
      filter.connect(env);
      this._out(env, { pan: (index - 2) * 0.12, send: 0.55 });
    });
    // Bells.
    [587.33, 739.99, 880, 1174.66].forEach((freq, index) => {
      this._tone({
        type: 'sine', freq, duration: 1.1, peak: 0.07 - index * 0.008,
        t: 0.35 + index * 0.16, send: 0.6,
      });
    });
    // Low hero boom.
    this._tone({ type: 'sine', freq: 82, freqEnd: 34, duration: 1.4, peak: 0.3, t: 0, send: 0.35 });
    this._noiseBurst({ t: 0, duration: 2.6, peak: 0.045, attack: 0.5, type: 'bandpass', freq: 1200, freqEnd: 400, q: 0.7, send: 0.6 });
  }

  pickup(kind = 'ammo') {
    if (!this._canPlay()) return;
    const bright = kind === 'health' ? 1
      : kind === 'vital' ? 1.32
        : kind === 'armor' || kind === 'guard' ? 1.16
          : kind === 'relic' ? 1.4 : 0.82;
    [880, 1174.66, 1567.98].forEach((freq, index) => {
      this._tone({
        type: 'sine', freq: freq * bright, duration: 0.16,
        peak: 0.07 - index * 0.012, t: index * 0.055, send: 0.3,
      });
    });
    this._noiseBurst({ duration: 0.025, peak: 0.035, type: 'highpass', freq: 5200, send: 0.15 });
  }

  melee() {
    if (!this._canPlay()) return;
    this._noiseBurst({
      duration: 0.2, peak: 0.08, attack: 0.03,
      type: 'bandpass', freq: 500, freqEnd: 1500, q: 1.8, pan: rand(-0.2, 0.2), send: 0.15,
    });
    this._tone({ type: 'sine', freq: 140, freqEnd: 60, duration: 0.16, peak: 0.18, t: 0.1, send: 0.12 });
    this._noiseBurst({ t: 0.1, duration: 0.08, peak: 0.12, type: 'lowpass', freq: 900, send: 0.15 });
  }

  // =========================================================================
  // UI
  // =========================================================================

  hover() {
    if (!this._canPlay()) return;
    this._tone({ type: 'sine', freq: 2100, duration: 0.022, peak: 0.018, bus: 'ui', send: 0.03 });
    this._noiseBurst({ duration: 0.012, peak: 0.012, type: 'highpass', freq: 5200, bus: 'ui', send: 0.02 });
  }

  click() {
    if (!this._canPlay()) return;
    this._tone({ type: 'square', freq: 1450, freqEnd: 940, duration: 0.035, peak: 0.035, bus: 'ui', send: 0.04 });
    this._noiseBurst({ duration: 0.018, peak: 0.045, type: 'bandpass', freq: 3200, q: 1.4, bus: 'ui', send: 0.03 });
    this._tone({ type: 'sine', freq: 220, freqEnd: 150, duration: 0.04, peak: 0.03, t: 0.01, bus: 'ui', send: 0.02 });
  }

  // =========================================================================
  // Internal compatibility helpers
  // =========================================================================

  _now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }
}

export default GameAudio;
