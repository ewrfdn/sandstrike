/**
 * SANDSTRIKE // 沙暴协议 — src/effects.js
 *
 * Pooled, allocation-light combat VFX. Owned by fx-artist.
 *
 * Public API (frozen by TEAM_SPEC.md):
 *   new Effects(scene, camera, { quality: 'medium'|'high'|'ultra' })
 *   update(dt, elapsed)
 *   muzzleFlash(position, direction, { scale, color, viewmodel })
 *   tracer(from, to, { color, width, duration })
 *   impact(point, normal, { surface, scale })
 *   sparks(point, normal, { count, color, speed })
 *   dustBurst(position, { count, scale })
 *   explosion(position, { scale, color })
 *   teleport(position, { color, scale })
 *   shellCasing(position, velocity, { scale })
 *   dispose()
 *
 * Extra convenience methods (safe to ignore):
 *   setQuality(q), setCamera(camera), footstepDust(position, scale), reset(), stats()
 *
 * Implementation notes:
 *  - Every particle family is one InstancedBufferGeometry draw call with a custom
 *    ShaderMaterial. Particles are simulated on the CPU in tight typed-array loops,
 *    compacted in place, and only the live range is uploaded.
 *  - Colors are written in linear space and are allowed to exceed 1.0 (HDR) so the
 *    Lead's bloom/OutputPass stage picks them up. tone mapping + output colorspace
 *    chunks are included, so both "render directly with ACES" and "composer"
 *    pipelines are correct.
 *  - All transparent FX use depthWrite:false. Smoke uses normal blending, glows /
 *    tracers / rings / beams / flashes are additive. No renderer state is touched.
 *  - `viewmodel` muzzle flashes: the position is treated as world-space unless it
 *    clearly looks like camera-local coordinates (tiny vector far from the camera),
 *    in which case it is converted from camera space. This keeps integration
 *    painless whichever convention the weapon module uses.
 */

import * as THREE from 'three';
import {
  clamp,
  lerp,
  rand,
  randInt,
  makeRNG,
  softSpriteTexture,
  canvasTexture,
} from './utils.js';

// ---------------------------------------------------------------------------
// Constants / scratch
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const EMPTY = Object.freeze({});

/** Hard pool sizes. Pre-allocated once at the ultra size; the active budget is
 *  gated by the quality preset so quality can change live without reallocating. */
const MAX_DECALS = 96;
const MAX_TRACERS = 56;
const MAX_CASINGS = 48;
const MAX_DEBRIS = 56;

/** Particle-system capacities (instances). These are upper bounds, not budgets. */
const CAP_GLOW = 1000;
const CAP_FIRE = 480;
const CAP_SMOKE = 760;
const CAP_STAR = 64;
const CAP_STAR_VM = 32;
const CAP_CONE = 48;

const QUALITY_PRESETS = {
  medium: {
    density: 0.62,
    decals: 40,
    tracers: 22,
    casings: 22,
    debris: 28,
    rich: false,
  },
  high: {
    density: 1.0,
    decals: 72,
    tracers: 42,
    casings: 38,
    debris: 46,
    rich: true,
  },
  ultra: {
    density: 1.34,
    decals: MAX_DECALS,
    tracers: MAX_TRACERS,
    casings: MAX_CASINGS,
    debris: MAX_DEBRIS,
    rich: true,
  },
};

// Module-level scratch objects: all effect code is synchronous on the main
// thread, so reusing these avoids per-frame garbage.
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qC = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _col = new THREE.Color();
const _AXIS_X = new THREE.Vector3(1, 0, 0);
const _AXIS_Y = new THREE.Vector3(0, 1, 0);
const _AXIS_Z = new THREE.Vector3(0, 0, 1);

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const num = (value, fallback) => (isNum(value) ? value : fallback);
const isPoint = (v) => !!v && isNum(v.x) && isNum(v.y) && isNum(v.z);

/** Author colors as sRGB (like CSS) and convert for the linear-space renderer. */
const srgbToLinear = (c) =>
  c <= 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
const lin3 = (r, g, b) => [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];

// Normal-blended (unlit) particle colors, authored in sRGB and decoded once.
const DUST_SAND = lin3(0.72, 0.6, 0.43);
const DUST_SAND_DARK = lin3(0.46, 0.35, 0.21);
const DUST_STONE = lin3(0.64, 0.58, 0.49);
const SMOKE_DARK = lin3(0.37, 0.34, 0.3);
const CHUNK_CHAR = lin3(0.3, 0.29, 0.28);
const CHUNK_RUST = lin3(0.38, 0.28, 0.19);

function smoothStep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Paint a texture with a plain 2D-context callback, independently of whether the
 * Lead-owned `canvasTexture` helper hands the callback a context or the canvas
 * itself (that utility's contract changed once during the build; this adapter
 * supports both).
 */
function paintTexture(w, h, draw, opts) {
  return canvasTexture(
    w,
    h,
    (target, width, height) => {
      const ctx = target && typeof target.getContext === 'function' ? target.getContext('2d') : target;
      if (!ctx) return;
      draw(ctx, width, height);
    },
    opts,
  );
}

function normalizeQuality(value) {
  return value === 'medium' || value === 'ultra' ? value : 'high';
}

function hexToRgb(hex, out) {
  const value = isNum(hex) ? hex | 0 : 0xffffff;
  out[0] = ((value >> 16) & 0xff) / 255;
  out[1] = ((value >> 8) & 0xff) / 255;
  out[2] = (value & 0xff) / 255;
  return out;
}

// ---------------------------------------------------------------------------
// Procedural FX textures (white / alpha sprites, generated in code)
// ---------------------------------------------------------------------------

/** Deterministic value noise, used to break up fire/smoke/scorch textures. */
function hash2(x, y, seed) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

function noise2(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm(x, y, seed, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq, seed + i * 13.7) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Turbulent fireball sprite. RGB carries the hot gradient, alpha the silhouette. */
function makeFireTexture(size = 256, seed = 11) {
  return paintTexture(
    size,
    size,
    (ctx, w, h) => {
      const rng = makeRNG(seed);
      const cx = w * 0.5;
      const cy = h * 0.5;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.5);
      core.addColorStop(0.0, 'rgba(255, 253, 246, 1)');
      core.addColorStop(0.16, 'rgba(255, 236, 184, 0.98)');
      core.addColorStop(0.34, 'rgba(255, 174, 70, 0.86)');
      core.addColorStop(0.54, 'rgba(244, 96, 20, 0.54)');
      core.addColorStop(0.76, 'rgba(152, 38, 6, 0.22)');
      core.addColorStop(1.0, 'rgba(44, 8, 0, 0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, w * 0.5, 0, TAU);
      ctx.fill();

      // Rolling hot lobes so the billboard reads as turbulence, not a light bulb.
      for (let i = 0; i < 20; i++) {
        const ang = rng() * TAU;
        const dist = rng() * w * 0.3;
        const bx = cx + Math.cos(ang) * dist;
        const by = cy + Math.sin(ang) * dist;
        const rad = w * (0.05 + rng() * 0.16);
        const g = ctx.createRadialGradient(bx, by, rad * 0.05, bx, by, rad);
        const hot = rng();
        g.addColorStop(0, hot > 0.55 ? 'rgba(255, 252, 232, 0.5)' : 'rgba(255, 166, 60, 0.42)');
        g.addColorStop(0.55, hot > 0.55 ? 'rgba(255, 216, 140, 0.2)' : 'rgba(240, 92, 18, 0.2)');
        g.addColorStop(1, 'rgba(120, 24, 2, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, rad, 0, TAU);
        ctx.fill();
      }

      // Turbulence modulation (alpha) + soft circular falloff.
      const img = ctx.getImageData(0, 0, w, h);
      const data = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const u = x / w;
          const v = y / h;
          const dx = (u - 0.5) * 2;
          const dy = (v - 0.5) * 2;
          const r = Math.sqrt(dx * dx + dy * dy);
          const edge = 1 - smoothStep(0.55, 1.0, r);
          const n = 0.45 + fbm(u * 5.5 + 3.2, v * 5.5 - 1.7, seed, 3) * 0.95;
          const alpha = clamp((data[i + 3] / 255) * edge * n, 0, 1);
          data[i + 3] = Math.round(alpha * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    { srgb: true, wrap: THREE.ClampToEdgeWrapping, anisotropy: 4 },
  );
}

/** Soft turbulent smoke/dust puff. Neutral white RGB so it can be tinted per particle. */
function makeSmokeTexture(size = 256, seed = 5) {
  return paintTexture(
    size,
    size,
    (ctx, w, h) => {
      const rng = makeRNG(seed);
      const cx = w * 0.5;
      const cy = h * 0.5;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < 38; i++) {
        const ang = rng() * TAU;
        const dist = rng() * w * 0.24;
        const bx = cx + Math.cos(ang) * dist;
        const by = cy + Math.sin(ang) * dist * 0.9;
        const rad = w * (0.08 + rng() * 0.2);
        const a = 0.09 + rng() * 0.17;
        const g = ctx.createRadialGradient(bx, by, rad * 0.04, bx, by, rad);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(0.5, `rgba(252,252,252,${a * 0.45})`);
        g.addColorStop(1, 'rgba(246,246,246,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, rad, 0, TAU);
        ctx.fill();
      }

      const img = ctx.getImageData(0, 0, w, h);
      const data = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const u = x / w;
          const v = y / h;
          const dx = (u - 0.5) * 2;
          const dy = (v - 0.5) * 2;
          const r = Math.sqrt(dx * dx + dy * dy);
          const edge = 1 - smoothStep(0.46, 0.99, r);
          const n = 0.38 + fbm(u * 4.0 + 6.4, v * 4.0 + 2.9, seed, 3) * 1.1;
          const alpha = clamp((data[i + 3] / 255) * edge * n * 2.1, 0, 1);
          data[i] = 255;
          data[i + 1] = 252;
          data[i + 2] = 247;
          data[i + 3] = Math.round(alpha * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    { srgb: true, wrap: THREE.ClampToEdgeWrapping, anisotropy: 4 },
  );
}

/** Muzzle-flash star: hot core, halo and 4 + 4 tapered spikes. */
function makeStarTexture(size = 256, seed = 7) {
  return paintTexture(
    size,
    size,
    (ctx, w, h) => {
      const rng = makeRNG(seed);
      const cx = w * 0.5;
      const cy = h * 0.5;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      // Wide warm halo.
      let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.48);
      g.addColorStop(0, 'rgba(255,238,204,0.5)');
      g.addColorStop(0.42, 'rgba(255,196,128,0.18)');
      g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, w * 0.48, 0, TAU);
      ctx.fill();

      // Spikes (long cardinal + shorter diagonal + a couple of asymmetric ones).
      const spikes = [
        [0.0, 0.52, 0.05],
        [HALF_PI, 0.46, 0.044],
        [Math.PI * 0.25, 0.3, 0.03],
        [-Math.PI * 0.25, 0.3, 0.03],
        [Math.PI * 0.72, 0.24, 0.022],
        [-Math.PI * 0.62, 0.2, 0.02],
      ];
      for (let i = 0; i < spikes.length; i++) {
        const spike = spikes[i];
        const len = spike[1] * w * (0.9 + rng() * 0.22);
        const wid = spike[2] * w;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spike[0] + (rng() - 0.5) * 0.12);
        const grad = ctx.createLinearGradient(0, 0, 0, -len);
        grad.addColorStop(0, 'rgba(255,255,252,0.92)');
        grad.addColorStop(0.24, 'rgba(255,241,206,0.6)');
        grad.addColorStop(0.66, 'rgba(255,172,84,0.16)');
        grad.addColorStop(1, 'rgba(255,124,40,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-wid, 0);
        ctx.lineTo(0, -len);
        ctx.lineTo(wid, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Hot core.
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.34, 'rgba(255,250,236,0.9)');
      g.addColorStop(1, 'rgba(255,214,158,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, w * 0.2, 0, TAU);
      ctx.fill();

      // Tiny sparkle flecks around the core.
      for (let i = 0; i < 26; i++) {
        const ang = rng() * TAU;
        const dist = w * (0.06 + rng() * 0.26);
        const rad = 0.6 + rng() * 1.8;
        ctx.fillStyle = `rgba(255,238,200,${0.2 + rng() * 0.5})`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, rad, 0, TAU);
        ctx.fill();
      }
    },
    { srgb: true, wrap: THREE.ClampToEdgeWrapping, anisotropy: 4 },
  );
}

/** Forward-facing muzzle cone. Apex at the bottom (v=0), expanding towards +V. */
function makeConeTexture(size = 128) {
  return paintTexture(
    size,
    size,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = 'blur(2.5px)';
      const apexX = w * 0.5;
      const apexY = h * 0.9;

      const outer = ctx.createLinearGradient(0, apexY, 0, h * 0.08);
      outer.addColorStop(0, 'rgba(255,246,222,0.55)');
      outer.addColorStop(0.3, 'rgba(255,206,132,0.24)');
      outer.addColorStop(0.7, 'rgba(255,152,62,0.08)');
      outer.addColorStop(1, 'rgba(255,110,30,0)');
      ctx.fillStyle = outer;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(w * 0.08, h * 0.08);
      ctx.lineTo(w * 0.92, h * 0.08);
      ctx.closePath();
      ctx.fill();

      const inner = ctx.createLinearGradient(0, apexY, 0, h * 0.16);
      inner.addColorStop(0, 'rgba(255,255,250,0.95)');
      inner.addColorStop(0.34, 'rgba(255,238,188,0.5)');
      inner.addColorStop(1, 'rgba(255,190,104,0)');
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(w * 0.4, h * 0.16);
      ctx.lineTo(w * 0.6, h * 0.16);
      ctx.closePath();
      ctx.fill();

      const spot = ctx.createRadialGradient(apexX, apexY, 0, apexX, apexY, w * 0.15);
      spot.addColorStop(0, 'rgba(255,255,255,1)');
      spot.addColorStop(0.5, 'rgba(255,242,204,0.5)');
      spot.addColorStop(1, 'rgba(255,206,132,0)');
      ctx.fillStyle = spot;
      ctx.beginPath();
      ctx.arc(apexX, apexY, w * 0.15, 0, TAU);
      ctx.fill();
      ctx.filter = 'none';
    },
    { srgb: true, wrap: THREE.ClampToEdgeWrapping, anisotropy: 4 },
  );
}

/** Bullet-hole / impact decal. `kind` picks the surface language. */
function makeDecalTexture(kind, seed, size = 128) {
  return paintTexture(
    size,
    size,
    (ctx, w, h) => {
      const rng = makeRNG(seed);
      const cx = w * 0.5;
      const cy = h * 0.5;
      const R = w * 0.47;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      // Zoom the art so the puncture / fracture reads at gameplay scale; the
      // radial edge mask at the end keeps the quad border perfectly clean.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1.6, 1.6);
      ctx.translate(-cx, -cy);

      if (kind === 'sand') {
        // Displaced sand halo around a dark puncture.
        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, R);
        g.addColorStop(0.0, 'rgba(34,23,11,0.95)');
        g.addColorStop(0.22, 'rgba(50,34,16,0.9)');
        g.addColorStop(0.4, 'rgba(94,65,34,0.6)');
        g.addColorStop(0.5, 'rgba(164,130,88,0.4)');
        g.addColorStop(0.72, 'rgba(208,175,128,0.17)');
        g.addColorStop(1.0, 'rgba(216,184,140,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, TAU);
        ctx.fill();
        for (let i = 0; i < 100; i++) {
          const ang = rng() * TAU;
          const dist = 5 + rng() * R;
          const x = cx + Math.cos(ang) * dist;
          const y = cy + Math.sin(ang) * dist;
          const s = 0.7 + rng() * 2.4;
          ctx.fillStyle =
            rng() < 0.5
              ? `rgba(38,26,13,${0.22 + rng() * 0.42})`
              : `rgba(234,208,166,${0.18 + rng() * 0.4})`;
          ctx.fillRect(x, y, s, s);
        }
        ctx.fillStyle = 'rgba(14,9,4,0.94)';
        ctx.beginPath();
        ctx.ellipse(
          cx + (rng() - 0.5) * 3,
          cy + (rng() - 0.5) * 3,
          w * 0.062,
          w * 0.052,
          rng() * TAU,
          0,
          TAU,
        );
        ctx.fill();
      } else if (kind === 'stone') {
        // Star fracture lines first, then the dark crater on top of the middle.
        for (let i = 0; i < 11; i++) {
          const ang = rng() * TAU;
          const len = R * (0.36 + rng() * 0.66);
          const dark = rng() < 0.72;
          ctx.strokeStyle = dark
            ? `rgba(28,23,18,${0.5 + rng() * 0.4})`
            : `rgba(206,196,178,${0.16 + rng() * 0.3})`;
          ctx.lineWidth = 0.8 + rng() * 2.1;
          ctx.beginPath();
          let x = cx;
          let y = cy;
          ctx.moveTo(x, y);
          const steps = 3;
          for (let s = 1; s <= steps; s++) {
            const rr = (len * s) / steps;
            const jitter = (rng() - 0.5) * 0.35;
            x = cx + Math.cos(ang + jitter) * rr;
            y = cy + Math.sin(ang + jitter) * rr;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, R);
        g.addColorStop(0.0, 'rgba(9,8,7,0.97)');
        g.addColorStop(0.28, 'rgba(24,21,17,0.93)');
        g.addColorStop(0.48, 'rgba(88,82,72,0.46)');
        g.addColorStop(0.62, 'rgba(158,147,128,0.22)');
        g.addColorStop(1.0, 'rgba(186,174,152,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, TAU);
        ctx.fill();
        for (let i = 0; i < 34; i++) {
          const ang = rng() * TAU;
          const dist = 6 + rng() * R * 0.9;
          const s = 0.7 + rng() * 2.2;
          ctx.fillStyle = `rgba(224,214,196,${0.12 + rng() * 0.32})`;
          ctx.fillRect(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, s, s);
        }
        ctx.fillStyle = 'rgba(8,7,6,0.96)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * 0.058, w * 0.048, 0, 0, TAU);
        ctx.fill();
      } else if (kind === 'metal') {
        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, R * 0.9);
        g.addColorStop(0.0, 'rgba(10,10,11,0.96)');
        g.addColorStop(0.16, 'rgba(26,26,28,0.9)');
        g.addColorStop(0.27, 'rgba(92,94,98,0.52)');
        g.addColorStop(0.29, 'rgba(214,218,224,0.5)');
        g.addColorStop(0.44, 'rgba(118,118,122,0.24)');
        g.addColorStop(0.72, 'rgba(86,80,72,0.12)');
        g.addColorStop(1.0, 'rgba(70,66,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.9, 0, TAU);
        ctx.fill();
        for (let i = 0; i < 22; i++) {
          const ang = rng() * TAU;
          const r0 = R * (0.14 + rng() * 0.08);
          const r1 = R * (0.24 + rng() * 0.5);
          ctx.strokeStyle =
            rng() < 0.55
              ? `rgba(232,234,238,${0.18 + rng() * 0.4})`
              : `rgba(16,15,14,${0.3 + rng() * 0.4})`;
          ctx.lineWidth = 0.6 + rng() * 1.4;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
          ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(8,8,9,0.95)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * 0.052, w * 0.043, rng() * TAU, 0, TAU);
        ctx.fill();
      } else if (kind === 'wood') {
        // Splintered hole: radial tapered splinters and fresh pale wood.
        for (let i = 0; i < 26; i++) {
          const ang = rng() * TAU;
          const len = R * (0.35 + rng() * 0.6);
          const wid = 0.012 + rng() * 0.045;
          const light = rng() < 0.55;
          ctx.fillStyle = light
            ? `rgba(${150 + (rng() * 50) | 0},${108 + (rng() * 34) | 0},${62 + (rng() * 24) | 0},${0.2 + rng() * 0.45})`
            : `rgba(${58 + (rng() * 24) | 0},${38 + (rng() * 18) | 0},${20 + (rng() * 12) | 0},${0.3 + rng() * 0.4})`;
          const tx = cx + Math.cos(ang) * len;
          const ty = cy + Math.sin(ang) * len;
          const nx = Math.cos(ang + HALF_PI) * w * wid;
          const ny = Math.sin(ang + HALF_PI) * w * wid;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * w * 0.02, cy + Math.sin(ang) * w * 0.02);
          ctx.lineTo(tx + nx, ty + ny);
          ctx.lineTo(tx - nx, ty - ny);
          ctx.closePath();
          ctx.fill();
        }
        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, R * 0.8);
        g.addColorStop(0, 'rgba(12,8,5,0.96)');
        g.addColorStop(0.3, 'rgba(40,26,14,0.7)');
        g.addColorStop(0.65, 'rgba(120,88,52,0.25)');
        g.addColorStop(1, 'rgba(150,116,74,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.8, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(10,6,3,0.95)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * 0.065, w * 0.05, rng() * TAU, 0, TAU);
        ctx.fill();
      } else if (kind === 'fabric') {
        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, R * 0.85);
        g.addColorStop(0, 'rgba(20,16,11,0.9)');
        g.addColorStop(0.32, 'rgba(62,52,38,0.55)');
        g.addColorStop(0.7, 'rgba(140,124,96,0.16)');
        g.addColorStop(1, 'rgba(150,134,104,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.85, 0, TAU);
        ctx.fill();
        for (let i = 0; i < 44; i++) {
          const ang = rng() * TAU;
          const r0 = R * (0.05 + rng() * 0.08);
          const r1 = R * (0.16 + rng() * 0.42);
          ctx.strokeStyle = `rgba(${206 + (rng() * 40) | 0},${186 + (rng() * 34) | 0},${150 + (rng() * 30) | 0},${0.14 + rng() * 0.34})`;
          ctx.lineWidth = 0.7 + rng() * 1.2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
          ctx.lineTo(cx + Math.cos(ang + (rng() - 0.5) * 0.3) * r1, cy + Math.sin(ang + (rng() - 0.5) * 0.3) * r1);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(12,10,7,0.92)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * 0.05, w * 0.042, rng() * TAU, 0, TAU);
        ctx.fill();
      } else {
        // Fallback / 'stone' silhouette.
        ctx.fillStyle = 'rgba(20,16,12,0.9)';
        ctx.beginPath();
        ctx.arc(cx, cy, w * 0.36, 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      // Contrast boost + guarantee a soft circular silhouette at the quad edge.
      const img = ctx.getImageData(0, 0, w, h);
      const data = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const u = x / w;
          const v = y / h;
          const dx = (u - 0.5) * 2;
          const dy = (v - 0.5) * 2;
          const r = Math.sqrt(dx * dx + dy * dy);
          const edge = 1 - smoothStep(0.74, 0.99, r);
          const a = data[i + 3] / 255;
          data[i + 3] = Math.round(clamp(Math.pow(a, 0.86) * edge * 1.08, 0, 1) * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    { srgb: true, wrap: THREE.ClampToEdgeWrapping, anisotropy: 4 },
  );
}

/** Big irregular ground scorch for explosions. */
function makeScorchTexture(size = 256, seed = 23) {
  return paintTexture(
    size,
    size,
    (ctx, w, h) => {
      const rng = makeRNG(seed);
      const cx = w * 0.5;
      const cy = h * 0.5;
      ctx.clearRect(0, 0, w, h);

      // Irregular dark blotches build the outline.
      for (let i = 0; i < 22; i++) {
        const ang = rng() * TAU;
        const dist = rng() * w * 0.24;
        const bx = cx + Math.cos(ang) * dist;
        const by = cy + Math.sin(ang) * dist;
        const rad = w * (0.12 + rng() * 0.22);
        const g = ctx.createRadialGradient(bx, by, rad * 0.05, bx, by, rad);
        const a = 0.16 + rng() * 0.26;
        g.addColorStop(0, `rgba(22,15,9,${a})`);
        g.addColorStop(0.55, `rgba(38,26,16,${a * 0.55})`);
        g.addColorStop(1, 'rgba(52,36,22,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, rad, 0, TAU);
        ctx.fill();
      }
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.34);
      core.addColorStop(0, 'rgba(10,7,4,0.92)');
      core.addColorStop(0.45, 'rgba(26,18,11,0.6)');
      core.addColorStop(0.8, 'rgba(58,40,24,0.18)');
      core.addColorStop(1, 'rgba(70,50,30,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, w * 0.34, 0, TAU);
      ctx.fill();

      // Ash flecks + turbulent alpha modulation.
      const img = ctx.getImageData(0, 0, w, h);
      const data = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const u = x / w;
          const v = y / h;
          const dx = (u - 0.5) * 2;
          const dy = (v - 0.5) * 2;
          const r = Math.sqrt(dx * dx + dy * dy);
          const edge = 1 - smoothStep(0.5, 1.0, r);
          const n = 0.55 + fbm(u * 4.6 + 2.3, v * 4.6 + 5.1, seed, 3) * 0.8;
          data[i + 3] = Math.round(clamp((data[i + 3] / 255) * edge * n * 1.25, 0, 1) * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
      // Light ash flecks on top.
      for (let i = 0; i < 60; i++) {
        const ang = rng() * TAU;
        const dist = w * (0.1 + rng() * 0.32);
        const s = 0.7 + rng() * 2.6;
        ctx.fillStyle = `rgba(196,182,158,${0.08 + rng() * 0.2})`;
        ctx.fillRect(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, s, s);
      }
    },
    { srgb: true, wrap: THREE.ClampToEdgeWrapping, anisotropy: 4 },
  );
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const BILLBOARD_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iColor;
attribute float iRot;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main() {
  vUv = uv;
  vColor = iColor;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iRot);
  float s = sin(iRot);
  mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSize;
  float depth = mv.z;
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
  gl_Position = projectionMatrix * mv;
}
`;

const BILLBOARD_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float alpha = tex.a * vColor.a;
  if (alpha < 0.0025) discard;
  vec3 color = tex.rgb * vColor.rgb;
  #ifdef ADDITIVE_FX
    color *= (1.0 - vFog);
    if (max(color.r, max(color.g, color.b)) < 0.003) discard;
  #else
    color = mix(color, uFogColor, clamp(vFog * 0.9, 0.0, 1.0));
  #endif
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const TRACER_VERT = /* glsl */ `
attribute vec3 aColor;
uniform float uFogDensity;
varying vec2 vUv;
varying vec3 vColor;
varying float vFog;
void main() {
  vUv = uv;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * mv.z * mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const TRACER_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vFog;
void main() {
  // Clamp before any pow(): interpolated varyings can land a hair outside
  // [0,1], and pow(negative, fractional) is undefined and yields NaN on
  // D3D11. A single NaN texel here poisons the HDR buffer, the bloom mip
  // chain then smears it into a screen-wide black band.
  float across = clamp(abs(vUv.x * 2.0 - 1.0), 0.0, 1.0);
  float along = clamp(vUv.y, 0.0, 1.0);
  float core = pow(1.0 - across, 3.2);
  float soft = pow(1.0 - across, 1.15) * 0.24;
  float along2 = along * along;
  float shape = (core + soft) * pow(along, 1.12);
  float alpha = clamp(shape, 0.0, 1.0);
  if (!(alpha >= 0.004)) discard;
  vec3 color = vColor * (1.0 + 2.4 * core * along2);
  color *= (1.0 - clamp(vFog, 0.0, 1.0));
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAG = /* glsl */ `
uniform float uProgress;
uniform float uOpacity;
uniform float uSeed;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float radius = mix(0.16, 0.94, uProgress);
  float thick = mix(0.34, 0.05, uProgress);
  float d = (r - radius) / thick;
  float ring = exp(-d * d * 1.6);
  float ang = atan(p.y, p.x);
  float wobble = 0.82 + 0.18 * sin(ang * 6.0 + uSeed * 21.0 + uProgress * 9.0) * sin(ang * 3.0 - uSeed * 7.0);
  ring *= wobble;
  float dInner = (r - radius * 0.6) / (thick * 2.4);
  float inner = exp(-dInner * dInner) * 0.14 * (1.0 - uProgress);
  float alpha = clamp(ring + inner, 0.0, 1.0) * uOpacity;
  if (alpha < 0.003) discard;
  vec3 color = mix(uColor, vec3(1.0, 0.93, 0.82), clamp(ring * 0.55, 0.0, 1.0));
  color *= (1.0 + 2.1 * (1.0 - uProgress));
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
uniform float uProgress;
uniform float uOpacity;
uniform float uSeed;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float y = vUv.y;
  float core = exp(-x * x * 7.0);
  float edge = exp(-x * x * 2.1) * 0.34;
  float bands = 0.7 + 0.3 * sin(y * 26.0 - uProgress * 32.0 + uSeed * 17.0);
  float streak = 0.78 + 0.22 * sin(x * 17.0 + y * 3.0 + uSeed * 11.0);
  float scan = 0.78 + 0.22 * sin(y * 92.0 + uProgress * 3.0);
  float bottom = smoothstep(0.0, 0.1, y) * (0.4 + 0.6 * (1.0 - y));
  float reveal = smoothstep(0.0, 0.2, uProgress) * (1.0 - smoothstep(0.55, 1.0, uProgress));
  float alpha = (core * 0.8 + edge) * bands * streak * bottom * reveal * uOpacity;
  if (alpha < 0.003) discard;
  vec3 color = uColor * (0.8 + 1.05 * core) * scan;
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Instanced billboard particle system
// ---------------------------------------------------------------------------

class BillboardPool {
  constructor(root, options) {
    const capacity = options.capacity;
    this.capacity = capacity;
    this.count = 0;
    this.fadePow = num(options.fadePow, 1.25);
    this.windX = num(options.windX, 0);
    this.windZ = num(options.windZ, 0);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
    );
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aSize.setUsage(THREE.DynamicDrawUsage);
    this.aColor.setUsage(THREE.DynamicDrawUsage);
    this.aRot.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iSize', this.aSize);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iRot', this.aRot);
    geo.instanceCount = 0;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: options.texture },
        uFogColor: { value: new THREE.Color().copy(options.fogColor) },
        uFogDensity: { value: num(options.fogDensity, 0) },
      },
      vertexShader: BILLBOARD_VERT,
      fragmentShader: BILLBOARD_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: options.depthTest !== false,
      blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: options.additive ? { ADDITIVE_FX: '' } : {},
      side: THREE.DoubleSide,
      toneMapped: true,
      fog: false,
    });

    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = num(options.renderOrder, 20);
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    root.add(mesh);

    this.geo = geo;
    this.material = material;
    this.mesh = mesh;

    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.sx0 = new Float32Array(capacity);
    this.sx1 = new Float32Array(capacity);
    this.sy0 = new Float32Array(capacity);
    this.sy1 = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.r = new Float32Array(capacity);
    this.g = new Float32Array(capacity);
    this.b = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
  }

  /**
   * @param {number} px @param {number} py @param {number} pz
   * @param {number} vx @param {number} vy @param {number} vz
   * @param {number} sx0 @param {number} sx1  size across start/end (world units)
   * @param {number} sy0 @param {number} sy1  size along start/end (world units)
   * @param {number} life @param {number} r @param {number} g @param {number} b
   * @param {number} alpha @param {number} drag @param {number} grav
   * @param {number} rot @param {number} spin
   */
  spawn(px, py, pz, vx, vy, vz, sx0, sx1, sy0, sy1, life, r, g, b, alpha, drag, grav, rot, spin) {
    if (this.count >= this.capacity || !(life > 0)) return false;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = px;
    this.pos[i3 + 1] = py;
    this.pos[i3 + 2] = pz;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.sx0[i] = sx0;
    this.sx1[i] = sx1;
    this.sy0[i] = sy0;
    this.sy1[i] = sy1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.r[i] = r;
    this.g[i] = g;
    this.b[i] = b;
    this.alpha[i] = alpha;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.rot[i] = rot;
    this.spin[i] = spin;
    return true;
  }

  update(dt) {
    if (this.count === 0) {
      if (this.mesh.visible) {
        this.mesh.visible = false;
        this.geo.instanceCount = 0;
      }
      return;
    }
    const cap = this.capacity;
    const pos = this.pos;
    const vel = this.vel;
    const lifeArr = this.life;
    const maxLife = this.maxLife;
    const sx0 = this.sx0;
    const sx1 = this.sx1;
    const sy0 = this.sy0;
    const sy1 = this.sy1;
    const dragArr = this.drag;
    const gravArr = this.grav;
    const rotArr = this.rot;
    const spinArr = this.spin;
    const aPos = this.aPos.array;
    const aSize = this.aSize.array;
    const aColor = this.aColor.array;
    const aRot = this.aRot.array;
    const fadePow = this.fadePow;
    const windX = this.windX;
    const windZ = this.windZ;
    let w = 0;

    for (let i = 0; i < this.count; i++) {
      const lifeLeft = lifeArr[i] - dt;
      if (lifeLeft <= 0) continue;
      lifeArr[i] = lifeLeft;
      const i3 = i * 3;
      let px = pos[i3];
      let py = pos[i3 + 1];
      let pz = pos[i3 + 2];
      let vx = vel[i3];
      let vy = vel[i3 + 1];
      let vz = vel[i3 + 2];
      const drag = dragArr[i];
      if (drag > 0) {
        const damp = Math.max(0, 1 - drag * dt);
        vx *= damp;
        vy *= damp;
        vz *= damp;
      }
      vy -= gravArr[i] * dt;
      px += (vx + windX) * dt;
      py += vy * dt;
      pz += (vz + windZ) * dt;

      const t = 1 - lifeLeft / maxLife[i];
      const ease = t * t * (3 - 2 * t);
      const sizeX = sx0[i] + (sx1[i] - sx0[i]) * ease;
      const sizeY = sy0[i] + (sy1[i] - sy0[i]) * ease;
      let fadeIn = t < 0.07 ? t / 0.07 : 1;
      const fadeOut = Math.pow(1 - t, fadePow);
      const alpha = this.alpha[i] * fadeIn * fadeOut;
      const rot = rotArr[i] + spinArr[i] * dt;
      rotArr[i] = rot;

      // Compact in place: move live particle data to write cursor.
      if (w !== i) {
        const w3 = w * 3;
        pos[w3] = px;
        pos[w3 + 1] = py;
        pos[w3 + 2] = pz;
        vel[w3] = vx;
        vel[w3 + 1] = vy;
        vel[w3 + 2] = vz;
        sx0[w] = sx0[i];
        sx1[w] = sx1[i];
        sy0[w] = sy0[i];
        sy1[w] = sy1[i];
        lifeArr[w] = lifeLeft;
        maxLife[w] = maxLife[i];
        this.r[w] = this.r[i];
        this.g[w] = this.g[i];
        this.b[w] = this.b[i];
        this.alpha[w] = this.alpha[i];
        dragArr[w] = drag;
        gravArr[w] = gravArr[i];
        rotArr[w] = rot;
        spinArr[w] = spinArr[i];
      }
      const w3 = w * 3;
      const w4 = w * 4;
      aPos[w3] = px;
      aPos[w3 + 1] = py;
      aPos[w3 + 2] = pz;
      aSize[w * 2] = sizeX;
      aSize[w * 2 + 1] = sizeY;
      aColor[w4] = this.r[w];
      aColor[w4 + 1] = this.g[w];
      aColor[w4 + 2] = this.b[w];
      aColor[w4 + 3] = alpha;
      aRot[w] = rot;
      w++;
    }

    this.count = w;
    this.geo.instanceCount = w;
    this.mesh.visible = w > 0;
    if (w > 0) {
      this.aPos.clearUpdateRanges();
      this.aPos.addUpdateRange(0, w * 3);
      this.aPos.needsUpdate = true;
      this.aSize.clearUpdateRanges();
      this.aSize.addUpdateRange(0, w * 2);
      this.aSize.needsUpdate = true;
      this.aColor.clearUpdateRanges();
      this.aColor.addUpdateRange(0, w * 4);
      this.aColor.needsUpdate = true;
      this.aRot.clearUpdateRanges();
      this.aRot.addUpdateRange(0, w);
      this.aRot.needsUpdate = true;
    }
  }

  reset() {
    this.count = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Tracer pool (own quad geometry per tracer, world-space billboarded ribbon)
// ---------------------------------------------------------------------------

class TracerPool {
  constructor(root, capacity, fogColor, fogDensity) {
    this.capacity = capacity;
    this.cursor = 0;
    this.entries = [];

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uFogDensity: { value: fogDensity },
        uFogColor: { value: new THREE.Color().copy(fogColor) },
      },
      vertexShader: TRACER_VERT,
      fragmentShader: TRACER_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: true,
      fog: false,
    });

    const uv = new Float32Array(16);
    for (let q = 0; q < 2; q++) {
      const o = q * 8;
      uv[o] = 0; uv[o + 1] = 0;
      uv[o + 2] = 1; uv[o + 3] = 0;
      uv[o + 4] = 1; uv[o + 5] = 1;
      uv[o + 6] = 0; uv[o + 7] = 1;
    }
    const index = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);

    for (let i = 0; i < capacity; i++) {
      const geo = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(new Float32Array(24), 3);
      const colAttr = new THREE.BufferAttribute(new Float32Array(24), 3);
      posAttr.setUsage(THREE.DynamicDrawUsage);
      colAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', posAttr);
      geo.setAttribute('aColor', colAttr);
      geo.setAttribute('uv', new THREE.BufferAttribute(uv.slice(), 2));
      geo.setIndex(new THREE.BufferAttribute(index.slice(), 1));
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 30;
      mesh.visible = false;
      root.add(mesh);
      this.entries.push({
        active: false,
        mesh,
        geo,
        posAttr,
        colAttr,
        ax: 0, ay: 0, az: 0,
        dx: 0, dy: 0, dz: 0,
        dist: 0,
        t: 0,
        duration: 0.07,
        width: 0.035,
        trail: 2,
        r: 1, g: 1, b: 1,
      });
    }
  }

  spawn(ax, ay, az, bx, by, bz, dist, dx, dy, dz, r, g, b, width, duration, trailScale) {
    const entry = this.entries[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    entry.active = true;
    entry.ax = ax; entry.ay = ay; entry.az = az;
    entry.dx = dx; entry.dy = dy; entry.dz = dz;
    entry.dist = dist;
    entry.t = 0;
    entry.duration = duration;
    entry.width = width * 1.5;
    entry.trail = clamp(dist * trailScale, 1.2, 46);
    entry.r = r; entry.g = g; entry.b = b;
    entry.mesh.visible = true;
    // Full brightness at spawn; update() writes the moving ribbon.
    const col = entry.colAttr.array;
    for (let v = 0; v < 4; v++) {
      col[v * 3] = r;
      col[v * 3 + 1] = g;
      col[v * 3 + 2] = b;
    }
    for (let v = 4; v < 8; v++) {
      col[v * 3] = r * 0.36;
      col[v * 3 + 1] = g * 0.36;
      col[v * 3 + 2] = b * 0.36;
    }
    entry.colAttr.needsUpdate = true;
  }

  update(dt, camera) {
    const camX = camera ? camera.position.x : 0;
    const camY = camera ? camera.position.y : 0;
    const camZ = camera ? camera.position.z : 0;
    for (let i = 0; i < this.capacity; i++) {
      const entry = this.entries[i];
      if (!entry.active) continue;
      entry.t += dt;
      if (entry.t >= entry.duration + 0.055) {
        entry.active = false;
        entry.mesh.visible = false;
        continue;
      }
      const travel = Math.min(1, entry.t / entry.duration);
      const headD = entry.dist * travel;
      const tailD = Math.max(0, headD - entry.trail);
      const fade = entry.t > entry.duration ? 1 - (entry.t - entry.duration) / 0.055 : 1;
      const ax = entry.ax;
      const ay = entry.ay;
      const az = entry.az;
      const dx = entry.dx;
      const dy = entry.dy;
      const dz = entry.dz;
      const hx = ax + dx * headD;
      const hy = ay + dy * headD;
      const hz = az + dz * headD;
      const tx = ax + dx * tailD;
      const ty = ay + dy * tailD;
      const tz = az + dz * tailD;

      // Billboard the ribbon around its axis, facing the camera as much as possible.
      const mx = (hx + tx) * 0.5 - camX;
      const my = (hy + ty) * 0.5 - camY;
      const mz = (hz + tz) * 0.5 - camZ;
      let sxx = dy * mz - dz * my;
      let syy = dz * mx - dx * mz;
      let szz = dx * my - dy * mx;
      let sl = Math.hypot(sxx, syy, szz);
      if (sl < 1e-4) {
        // Axis ~parallel to view direction: any perpendicular works.
        sxx = -dz;
        syy = 0;
        szz = dx;
        sl = Math.hypot(sxx, syy, szz);
        if (sl < 1e-4) {
          sxx = 1;
          syy = 0;
          szz = 0;
          sl = 1;
        }
      }
      sxx /= sl;
      syy /= sl;
      szz /= sl;

      const width = entry.width * fade;
      const wTail = width * 0.32;
      const wHead = width;
      const hwTail = wTail * 5.5;
      const hwHead = wHead * 5.5;

      const pos = entry.posAttr.array;
      // core ribbon
      pos[0] = tx + sxx * wTail; pos[1] = ty + syy * wTail; pos[2] = tz + szz * wTail;
      pos[3] = tx - sxx * wTail; pos[4] = ty - syy * wTail; pos[5] = tz - szz * wTail;
      pos[6] = hx - sxx * wHead; pos[7] = hy - syy * wHead; pos[8] = hz - szz * wHead;
      pos[9] = hx + sxx * wHead; pos[10] = hy + syy * wHead; pos[11] = hz + szz * wHead;
      // halo ribbon
      pos[12] = tx + sxx * hwTail; pos[13] = ty + syy * hwTail; pos[14] = tz + szz * hwTail;
      pos[15] = tx - sxx * hwTail; pos[16] = ty - syy * hwTail; pos[17] = tz - szz * hwTail;
      pos[18] = hx - sxx * hwHead; pos[19] = hy - syy * hwHead; pos[20] = hz - szz * hwHead;
      pos[21] = hx + sxx * hwHead; pos[22] = hy + syy * hwHead; pos[23] = hz + szz * hwHead;
      entry.posAttr.needsUpdate = true;

      if (fade < 1) {
        const col = entry.colAttr.array;
        for (let v = 0; v < 4; v++) {
          col[v * 3] = entry.r * fade;
          col[v * 3 + 1] = entry.g * fade;
          col[v * 3 + 2] = entry.b * fade;
        }
        for (let v = 4; v < 8; v++) {
          col[v * 3] = entry.r * 0.36 * fade;
          col[v * 3 + 1] = entry.g * 0.36 * fade;
          col[v * 3 + 2] = entry.b * 0.36 * fade;
        }
        entry.colAttr.needsUpdate = true;
      }
    }
  }

  reset() {
    for (let i = 0; i < this.capacity; i++) {
      this.entries[i].active = false;
      this.entries[i].mesh.visible = false;
    }
  }

  dispose() {
    for (let i = 0; i < this.capacity; i++) this.entries[i].geo.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Decal pool (surface-aware bullet holes / scorch marks)
// ---------------------------------------------------------------------------

class DecalPool {
  constructor(root, geometry, materials, capacity) {
    this.capacity = capacity;
    this.cursor = 0;
    this.geometry = geometry;
    this.materials = materials;
    this.meshes = [];
    this.life = new Float32Array(capacity);
    this.baseX = new Float32Array(capacity);
    this.baseY = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      const mesh = new THREE.Mesh(geometry, materials.stone[0]);
      mesh.visible = false;
      mesh.matrixAutoUpdate = true;
      mesh.renderOrder = 5;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      root.add(mesh);
      this.meshes.push(mesh);
    }
  }

  place(x, y, z, nx, ny, nz, kind, size, roll, life, activeCap) {
    const cap = Math.max(8, Math.min(this.capacity, activeCap | 0));
    let slot = -1;
    for (let k = 0; k < cap; k++) {
      const idx = (this.cursor + k) % cap;
      if (this.life[idx] <= 0) {
        slot = idx;
        break;
      }
    }
    if (slot < 0) {
      // Pool saturated: recycle the oldest slot deterministically.
      slot = this.cursor;
      this.cursor = (this.cursor + 1) % cap;
    }
    const mesh = this.meshes[slot];
    const list = this.materials[kind] || this.materials.stone;
    mesh.material = list[randInt(0, list.length - 1)];
    const off = 0.012;
    mesh.position.set(x + nx * off, y + ny * off, z + nz * off);
    _vA.set(nx, ny, nz);
    _qA.setFromUnitVectors(_AXIS_Z, _vA);
    _qB.setFromAxisAngle(_vA, roll);
    mesh.quaternion.copy(_qA).multiply(_qB);
    const sx = size * rand(0.88, 1.12);
    const sy = size * rand(0.88, 1.12);
    mesh.scale.set(sx, sy, 1);
    mesh.visible = true;
    this.life[slot] = life;
    this.baseX[slot] = sx;
    this.baseY[slot] = sy;
  }

  update(dt) {
    for (let i = 0; i < this.capacity; i++) {
      const life = this.life[i];
      if (life <= 0) continue;
      const next = life - dt;
      if (next <= 0) {
        this.life[i] = 0;
        this.meshes[i].visible = false;
        continue;
      }
      this.life[i] = next;
      if (next < 1.1) {
        // Subtle shrink-out instead of a hard pop.
        const k = next / 1.1;
        this.meshes[i].scale.set(this.baseX[i] * k, this.baseY[i] * k, 1);
      }
    }
  }

  reset() {
    for (let i = 0; i < this.capacity; i++) {
      this.life[i] = 0;
      this.meshes[i].visible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Instanced chunk pool (debris + shell casings): gravity, floor bounce, tumble
// ---------------------------------------------------------------------------

class ChunkPool {
  constructor(root, options) {
    const capacity = options.capacity;
    this.capacity = capacity;
    this.count = 0;
    this.cursor = 0;
    this.gravity = num(options.gravity, 19);
    this.restitution = num(options.restitution, 0.34);
    this.friction = num(options.friction, 0.62);
    this.restRadius = num(options.restRadius, 0.075);
    this.floorY = num(options.floorY, 0);

    const mesh = new THREE.InstancedMesh(options.geometry, options.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = num(options.renderOrder, 1);
    root.add(mesh);

    this.mesh = mesh;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.quat = new Float32Array(capacity * 4);
    this.ang = new Float32Array(capacity * 3);
    this.scl = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.baseLife = new Float32Array(capacity);
  }

  spawn(px, py, pz, vx, vy, vz, sx, sy, sz, r, g, b, life, spin) {
    if (!(life > 0)) return false;
    // A full pool recycles its oldest entry instead of dropping the new one, so
    // things like shell casings always match the number of shots fired.
    let i;
    if (this.count < this.capacity) {
      i = this.count++;
    } else {
      i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
    }
    const i3 = i * 3;
    const i4 = i * 4;
    this.pos[i3] = px;
    this.pos[i3 + 1] = py;
    this.pos[i3 + 2] = pz;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    // Random unit quaternion for initial orientation.
    let qx = rand(-1, 1);
    let qy = rand(-1, 1);
    let qz = rand(-1, 1);
    let qw = rand(-1, 1);
    const ql = Math.hypot(qx, qy, qz, qw) || 1;
    this.quat[i4] = qw / ql;
    this.quat[i4 + 1] = qx / ql;
    this.quat[i4 + 2] = qy / ql;
    this.quat[i4 + 3] = qz / ql;
    const axisX = rand(-1, 1);
    const axisY = rand(-1, 1);
    const axisZ = rand(-1, 1);
    const al = Math.hypot(axisX, axisY, axisZ) || 1;
    this.ang[i3] = (axisX / al) * spin;
    this.ang[i3 + 1] = (axisY / al) * spin;
    this.ang[i3 + 2] = (axisZ / al) * spin;
    this.scl[i3] = sx;
    this.scl[i3 + 1] = sy;
    this.scl[i3 + 2] = sz;
    this.col[i3] = r;
    this.col[i3 + 1] = g;
    this.col[i3 + 2] = b;
    this.life[i] = life;
    this.baseLife[i] = life;
    return true;
  }

  update(dt) {
    if (this.count === 0) {
      if (this.mesh.visible) {
        this.mesh.visible = false;
        this.mesh.count = 0;
      }
      return;
    }
    const pos = this.pos;
    const vel = this.vel;
    const quat = this.quat;
    const ang = this.ang;
    const scl = this.scl;
    const col = this.col;
    const life = this.life;
    const gravity = this.gravity;
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      const lifeLeft = life[i] - dt;
      if (lifeLeft <= 0) continue;
      life[i] = lifeLeft;
      const i3 = i * 3;
      const i4 = i * 4;
      const sx = scl[i3];
      const sy = scl[i3 + 1];
      const sz = scl[i3 + 2];
      let px = pos[i3];
      let py = pos[i3 + 1];
      let pz = pos[i3 + 2];
      let vx = vel[i3];
      let vy = vel[i3 + 1];
      let vz = vel[i3 + 2];
      vy -= gravity * dt;
      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;

      const rest = this.floorY + this.restRadius * Math.max(sx, sy, sz);
      if (py < rest) {
        py = rest;
        if (vy < 0) {
          vy = -vy * this.restitution;
          if (vy < 0.65) vy = 0;
          vx *= this.friction;
          vz *= this.friction;
          ang[i3] *= 0.55;
          ang[i3 + 1] *= 0.55;
          ang[i3 + 2] *= 0.55;
        }
      }

      // Integrate orientation: q' = normalize(q + 0.5 * w * q * dt)
      let qw = quat[i4];
      let qx = quat[i4 + 1];
      let qy = quat[i4 + 2];
      let qz = quat[i4 + 3];
      const ax = ang[i3] * dt * 0.5;
      const ay = ang[i3 + 1] * dt * 0.5;
      const az = ang[i3 + 2] * dt * 0.5;
      if (ax !== 0 || ay !== 0 || az !== 0) {
        const dw = -(ax * qx + ay * qy + az * qz);
        const dqx = qw * ax + (ay * qz - az * qy);
        const dqy = qw * ay + (az * qx - ax * qz);
        const dqz = qw * az + (ax * qy - ay * qx);
        qw += dw;
        qx += dqx;
        qy += dqy;
        qz += dqz;
        const ql = Math.hypot(qw, qx, qy, qz) || 1;
        qw /= ql;
        qx /= ql;
        qy /= ql;
        qz /= ql;
      }

      let fade = 1;
      if (lifeLeft < 0.4) fade = Math.max(0.001, lifeLeft / 0.4);

      // Write the integrated state back to slot w (w === i when nothing died,
      // and this write is what actually advances the particle — skipping it
      // used to freeze casings and debris in mid-air).
      const w3 = w * 3;
      const w4 = w * 4;
      pos[w3] = px; pos[w3 + 1] = py; pos[w3 + 2] = pz;
      vel[w3] = vx; vel[w3 + 1] = vy; vel[w3 + 2] = vz;
      quat[w4] = qw; quat[w4 + 1] = qx; quat[w4 + 2] = qy; quat[w4 + 3] = qz;
      ang[w3] = ang[i3]; ang[w3 + 1] = ang[i3 + 1]; ang[w3 + 2] = ang[i3 + 2];
      scl[w3] = sx; scl[w3 + 1] = sy; scl[w3 + 2] = sz;
      col[w3] = col[i3]; col[w3 + 1] = col[i3 + 1]; col[w3 + 2] = col[i3 + 2];
      life[w] = lifeLeft;
      this.baseLife[w] = this.baseLife[i];
      _vA.set(px, py, pz);
      _qC.set(qx, qy, qz, qw);
      _vB.set(sx * fade, sy * fade, sz * fade);
      _m4.compose(_vA, _qC, _vB);
      this.mesh.setMatrixAt(w, _m4);
      _col.setRGB(col[w3], col[w3 + 1], col[w3 + 2]);
      this.mesh.setColorAt(w, _col);
      w++;
    }
    this.count = w;
    this.mesh.count = w;
    this.mesh.visible = w > 0;
    if (w > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  reset() {
    this.count = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose() {
    // Geometry/material are shared and disposed by Effects.
  }
}

// ---------------------------------------------------------------------------
// Shockwave ring pool (custom shader plane: air ring + ground dust ring)
// ---------------------------------------------------------------------------

class RingPool {
  constructor(root, geometry, capacity) {
    this.capacity = capacity;
    this.cursor = 0;
    this.entries = [];
    for (let i = 0; i < capacity; i++) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uProgress: { value: 0 },
          uOpacity: { value: 0 },
          uSeed: { value: 0 },
          uColor: { value: new THREE.Color(1, 1, 1) },
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: true,
        fog: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 25;
      root.add(mesh);
      this.entries.push({
        mesh,
        material,
        active: false,
        t: 0,
        dur: 1,
        r0: 0.2,
        r1: 2,
        opacity: 1,
        flat: false,
        roll: 0,
        quat: new THREE.Quaternion(),
      });
    }
  }

  spawn(x, y, z, r0, r1, dur, r, g, b, opacity, flat, roll) {
    const entry = this.entries[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    entry.active = true;
    entry.t = 0;
    entry.dur = dur;
    entry.r0 = r0;
    entry.r1 = r1;
    entry.opacity = opacity;
    entry.flat = flat;
    entry.roll = roll;
    entry.mesh.position.set(x, y, z);
    entry.mesh.visible = true;
    if (flat) {
      _qA.setFromAxisAngle(_AXIS_X, -HALF_PI);
      _qB.setFromAxisAngle(_AXIS_Y, roll);
      entry.quat.copy(_qA).multiply(_qB);
      entry.mesh.quaternion.copy(entry.quat);
    }
    entry.material.uniforms.uColor.value.setRGB(r, g, b);
    entry.material.uniforms.uSeed.value = rand(0, 10);
    entry.material.uniforms.uProgress.value = 0;
    entry.material.uniforms.uOpacity.value = 0;
  }

  update(dt, camera) {
    for (let i = 0; i < this.capacity; i++) {
      const entry = this.entries[i];
      if (!entry.active) continue;
      entry.t += dt;
      const p = entry.t / entry.dur;
      if (p >= 1) {
        entry.active = false;
        entry.mesh.visible = false;
        continue;
      }
      const ease = 1 - Math.pow(1 - p, 2.6);
      const size = Math.max(0.001, entry.r0 + (entry.r1 - entry.r0) * ease);
      entry.mesh.scale.set(size, size, 1);
      const fadeIn = p < 0.06 ? p / 0.06 : 1;
      entry.material.uniforms.uProgress.value = p;
      entry.material.uniforms.uOpacity.value = entry.opacity * fadeIn * Math.pow(1 - p, 1.45);
      if (!entry.flat) {
        if (camera) entry.mesh.quaternion.copy(camera.quaternion);
      }
    }
  }

  reset() {
    for (let i = 0; i < this.capacity; i++) {
      this.entries[i].active = false;
      this.entries[i].mesh.visible = false;
    }
  }

  dispose() {
    for (let i = 0; i < this.capacity; i++) this.entries[i].material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Teleport beam pool (cylindrical billboard with a scrolling energy shader)
// ---------------------------------------------------------------------------

class BeamPool {
  constructor(root, geometry, capacity) {
    this.capacity = capacity;
    this.cursor = 0;
    this.entries = [];
    for (let i = 0; i < capacity; i++) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uProgress: { value: 0 },
          uOpacity: { value: 0 },
          uSeed: { value: 0 },
          uColor: { value: new THREE.Color(1, 1, 1) },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: true,
        fog: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 24;
      root.add(mesh);
      this.entries.push({ mesh, material, active: false, t: 0, dur: 0.6 });
    }
  }

  spawn(x, feetY, z, width, height, dur, r, g, b, opacity) {
    const entry = this.entries[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    entry.active = true;
    entry.t = 0;
    entry.dur = dur;
    entry.mesh.position.set(x, feetY + height * 0.5, z);
    entry.mesh.scale.set(width, height, 1);
    entry.mesh.visible = true;
    entry.material.uniforms.uColor.value.setRGB(r, g, b);
    entry.material.uniforms.uSeed.value = rand(0, 10);
    entry.material.uniforms.uOpacity.value = opacity;
  }

  update(dt, camera) {
    const camX = camera ? camera.position.x : 0;
    const camZ = camera ? camera.position.z : 0;
    for (let i = 0; i < this.capacity; i++) {
      const entry = this.entries[i];
      if (!entry.active) continue;
      entry.t += dt;
      const p = entry.t / entry.dur;
      if (p >= 1) {
        entry.active = false;
        entry.mesh.visible = false;
        continue;
      }
      entry.material.uniforms.uProgress.value = p;
      const pos = entry.mesh.position;
      entry.mesh.rotation.set(0, Math.atan2(camX - pos.x, camZ - pos.z), 0);
    }
  }

  reset() {
    for (let i = 0; i < this.capacity; i++) {
      this.entries[i].active = false;
      this.entries[i].mesh.visible = false;
    }
  }

  dispose() {
    for (let i = 0; i < this.capacity; i++) this.entries[i].material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export class Effects {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {{ quality?: 'medium'|'high'|'ultra' }} [options]
   */
  constructor(scene, camera, options) {
    const opts = options || EMPTY;
    this.scene = scene || null;
    this.camera = camera || null;
    this.quality = normalizeQuality(opts.quality);
    this._q = QUALITY_PRESETS[this.quality];
    this._time = 0;
    this._disposed = false;

    /** Per-instance scratch color (set by _tint, read immediately). */
    this._tr = 1;
    this._tg = 1;
    this._tb = 1;

    const root = new THREE.Group();
    root.name = 'SANDSTRIKE_FX';
    if (this.scene) this.scene.add(root);
    this.root = root;

    this._geometries = [];
    this._materials = [];
    this._ownedTextures = [];

    // Fog state (kept in sync with scene.fog each frame).
    this._fogColor = new THREE.Color();
    this._fogColor.setHex(0xd6a877);
    this._fogDensity = 0.0125;
    this._applySceneFog();

    // --- textures -----------------------------------------------------------
    const soft = softSpriteTexture();
    const fireTex = makeFireTexture(256, 11);
    const smokeTex = makeSmokeTexture(256, 5);
    const starTex = makeStarTexture(256, 7);
    const coneTex = makeConeTexture(128);
    this._ownedTextures.push(fireTex, smokeTex, starTex, coneTex);

    // --- decal materials ----------------------------------------------------
    this._decalGeometry = new THREE.PlaneGeometry(1, 1);
    this._geometries.push(this._decalGeometry);
    this._decalMaterials = this._createDecalMaterials();

    // --- particle families --------------------------------------------------
    const poolOpts = {
      fogColor: this._fogColor,
      fogDensity: this._fogDensity,
    };
    this._glow = this._makePool(root, {
      ...poolOpts,
      texture: soft,
      capacity: CAP_GLOW,
      additive: true,
      renderOrder: 20,
      fadePow: 1.35,
      windX: 0.18,
      windZ: 0.1,
    });
    this._fire = this._makePool(root, {
      ...poolOpts,
      texture: fireTex,
      capacity: CAP_FIRE,
      additive: true,
      renderOrder: 21,
      fadePow: 1.1,
      windX: 0.3,
      windZ: 0.16,
    });
    this._smoke = this._makePool(root, {
      ...poolOpts,
      texture: smokeTex,
      capacity: CAP_SMOKE,
      additive: false,
      renderOrder: 10,
      fadePow: 0.82,
      windX: 0.45,
      windZ: 0.22,
    });
    this._star = this._makePool(root, {
      ...poolOpts,
      texture: starTex,
      capacity: CAP_STAR,
      additive: true,
      renderOrder: 22,
      fadePow: 1.6,
    });
    this._starVM = this._makePool(root, {
      ...poolOpts,
      texture: starTex,
      capacity: CAP_STAR_VM,
      additive: true,
      renderOrder: 999,
      depthTest: false,
      fadePow: 1.7,
    });
    this._cone = this._makePool(root, {
      ...poolOpts,
      texture: coneTex,
      capacity: CAP_CONE,
      additive: true,
      renderOrder: 23,
      fadePow: 1.4,
      windX: 0.2,
      windZ: 0.1,
    });

    // --- tracers / decals ---------------------------------------------------
    this._tracers = new TracerPool(root, MAX_TRACERS, this._fogColor, this._fogDensity);

    this._decals = new DecalPool(root, this._decalGeometry, this._decalMaterials, MAX_DECALS);

    // --- debris + casings ---------------------------------------------------
    this._debrisGeometry = new THREE.IcosahedronGeometry(0.072, 0);
    this._geometries.push(this._debrisGeometry);
    this._debrisMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.1,
    });
    this._materials.push(this._debrisMaterial);
    this._debris = new ChunkPool(root, {
      geometry: this._debrisGeometry,
      material: this._debrisMaterial,
      capacity: MAX_DEBRIS,
      gravity: 19,
      restitution: 0.32,
      friction: 0.6,
      restRadius: 0.062,
      renderOrder: 2,
    });

    this._casingGeometry = new THREE.CylinderGeometry(0.0115, 0.0105, 0.034, 8, 1);
    this._geometries.push(this._casingGeometry);
    this._casingMaterial = new THREE.MeshStandardMaterial({
      color: 0xcfae5a,
      roughness: 0.3,
      metalness: 0.82,
    });
    this._materials.push(this._casingMaterial);
    this._casings = new ChunkPool(root, {
      geometry: this._casingGeometry,
      material: this._casingMaterial,
      capacity: MAX_CASINGS,
      gravity: 21,
      restitution: 0.42,
      friction: 0.52,
      restRadius: 0.017,
      renderOrder: 3,
    });

    // --- rings / beams ------------------------------------------------------
    this._ringGeometry = new THREE.PlaneGeometry(1, 1);
    this._geometries.push(this._ringGeometry);
    this._rings = new RingPool(root, this._ringGeometry, 14);

    this._beamGeometry = new THREE.PlaneGeometry(1, 1);
    this._geometries.push(this._beamGeometry);
    this._beams = new BeamPool(root, this._beamGeometry, 16);

    // --- transient point lights (always mounted so shaders never recompile) --
    this._lights = [];
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xffb070, 0, 12, 2);
      light.castShadow = false;
      light.visible = true;
      root.add(light);
      this._lights.push({
        light,
        life: 0,
        dur: 1,
        peak: 0,
        x: 0,
        y: 0,
        z: 0,
        r: 1,
        g: 1,
        b: 1,
      });
    }

    // --- surface response tables -------------------------------------------
    this._surfaces = {
      sand: {
        dust: [0.7, 0.58, 0.41],
        dust2: [0.5, 0.39, 0.24],
        chip: [0.42, 0.3, 0.17],
        chips: 2,
        sparks: 0,
        puffs: 8,
        puffSize: 0.5,
        glint: false,
        decal: 'sand',
        decalSize: 0.34,
      },
      stone: {
        dust: [0.62, 0.56, 0.48],
        dust2: [0.43, 0.39, 0.33],
        chip: [0.36, 0.33, 0.29],
        chips: 4,
        sparks: 7,
        puffs: 6,
        puffSize: 0.44,
        glint: true,
        decal: 'stone',
        decalSize: 0.27,
      },
      metal: {
        dust: [0.5, 0.48, 0.45],
        dust2: [0.34, 0.33, 0.3],
        chip: [0.52, 0.52, 0.54],
        chips: 3,
        sparks: 15,
        puffs: 3,
        puffSize: 0.34,
        glint: true,
        decal: 'metal',
        decalSize: 0.17,
      },
      wood: {
        dust: [0.6, 0.48, 0.32],
        dust2: [0.43, 0.31, 0.19],
        chip: [0.36, 0.25, 0.14],
        chips: 5,
        sparks: 0,
        puffs: 4,
        puffSize: 0.4,
        glint: false,
        decal: 'wood',
        decalSize: 0.3,
      },
      fabric: {
        dust: [0.68, 0.62, 0.5],
        dust2: [0.5, 0.45, 0.36],
        chip: [0.48, 0.42, 0.31],
        chips: 0,
        sparks: 0,
        puffs: 3,
        puffSize: 0.36,
        glint: false,
        decal: 'fabric',
        decalSize: 0.26,
      },
    };

    this._surfaceAliases = {
      sand: 'sand',
      desert: 'sand',
      dirt: 'sand',
      stone: 'stone',
      concrete: 'stone',
      rock: 'stone',
      adobe: 'stone',
      metal: 'metal',
      steel: 'metal',
      wood: 'wood',
      crate: 'wood',
      fabric: 'fabric',
      cloth: 'fabric',
      canvas: 'fabric',
      robot: 'metal',
    };

    // Authored sRGB particle colors -> linear: the renderer is linear-space and
    // these particles are unlit, so decoding keeps dust/smoke physically plausible.
    for (const key in this._surfaces) {
      const s = this._surfaces[key];
      s.dust = s.dust.map(srgbToLinear);
      s.dust2 = s.dust2.map(srgbToLinear);
      s.chip = s.chip.map(srgbToLinear);
    }
  }

  // -- construction helpers -------------------------------------------------

  _makePool(root, options) {
    const pool = new BillboardPool(root, options);
    return pool;
  }

  _createDecalMaterials() {
    const kinds = ['sand', 'stone', 'metal', 'wood', 'fabric'];
    const out = {};
    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[k];
      const list = [];
      for (let v = 0; v < 4; v++) {
        const texture = makeDecalTexture(kind, 101 + k * 37 + v * 11, 128);
        this._ownedTextures.push(texture);
        const material = new THREE.MeshLambertMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          depthTest: true,
          alphaTest: 0.008,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -8,
          side: THREE.FrontSide,
        });
        this._materials.push(material);
        list.push(material);
      }
      out[kind] = list;
    }
    const scorchList = [];
    for (let v = 0; v < 2; v++) {
      const texture = makeScorchTexture(256, 61 + v * 29);
      this._ownedTextures.push(texture);
      const material = new THREE.MeshLambertMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        alphaTest: 0.008,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -8,
        side: THREE.FrontSide,
      });
      this._materials.push(material);
      scorchList.push(material);
    }
    out.scorch = scorchList;
    return out;
  }

  _applySceneFog() {
    const fog = this.scene ? this.scene.fog : null;
    if (fog && fog.color && fog.color.isColor) {
      this._fogColor.copy(fog.color);
      if (fog.isFogExp2 && isNum(fog.density)) {
        this._fogDensity = fog.density;
      } else if (isNum(fog.far)) {
        this._fogDensity = 1.1 / Math.max(1, fog.far);
      }
    }
  }

  _syncFogUniforms() {
    const density = this._fogDensity;
    const color = this._fogColor;
    const pools = [this._glow, this._fire, this._smoke, this._star, this._starVM, this._cone];
    for (let i = 0; i < pools.length; i++) {
      const uniforms = pools[i].material.uniforms;
      uniforms.uFogDensity.value = density;
      uniforms.uFogColor.value.copy(color);
    }
    if (this._tracers) {
      this._tracers.material.uniforms.uFogDensity.value = density;
      this._tracers.material.uniforms.uFogColor.value.copy(color);
    }
  }

  // -- tiny helpers ---------------------------------------------------------

  _tint(hex) {
    const value = isNum(hex) ? hex | 0 : 0xffffff;
    this._tr = ((value >> 16) & 0xff) / 255;
    this._tg = ((value >> 8) & 0xff) / 255;
    this._tb = (value & 0xff) / 255;
  }

  /** View-space angle of a direction, used to rotate elongated billboards. */
  _screenAngle(dx, dy, dz) {
    const camera = this.camera;
    if (!camera) return rand(0, TAU);
    const e = camera.matrixWorld.elements;
    const sx = dx * e[0] + dy * e[1] + dz * e[2];
    const sy = dx * e[4] + dy * e[5] + dz * e[6];
    const l2 = sx * sx + sy * sy;
    if (l2 < 1e-7) return rand(0, TAU);
    return Math.atan2(sy, sx) - HALF_PI;
  }

  _cameraForward(out) {
    const camera = this.camera;
    if (!camera) {
      out.set(0, 0, -1);
      return out;
    }
    const e = camera.matrixWorld.elements;
    out.set(-e[8], -e[9], -e[10]);
    if (out.lengthSq() < 1e-8) out.set(0, 0, -1);
    return out.normalize();
  }

  _flashAt(x, y, z, size, r, g, b, life, alpha) {
    const rot = rand(0, TAU);
    this._star.spawn(x, y, z, 0, 0, 0, size, size * 1.12, size, size * 1.12, life, r, g, b, alpha, 0, 0, rot, rand(-1.6, 1.6));
  }

  _flashLight(x, y, z, r, g, b, peak, distance, life) {
    let target = null;
    let shortest = Infinity;
    for (let i = 0; i < this._lights.length; i++) {
      const slot = this._lights[i];
      if (slot.life <= 0) {
        target = slot;
        break;
      }
      if (slot.life < shortest) {
        shortest = slot.life;
        target = slot;
      }
    }
    if (!target) return;
    target.life = life;
    target.dur = life;
    target.peak = peak;
    target.x = x;
    target.y = y;
    target.z = z;
    target.r = r;
    target.g = g;
    target.b = b;
    target.light.position.set(x, y, z);
    target.light.distance = distance;
    target.light.color.setRGB(r, g, b);
  }

  _updateLights(dt) {
    for (let i = 0; i < this._lights.length; i++) {
      const slot = this._lights[i];
      if (slot.life <= 0) {
        if (slot.light.intensity !== 0) slot.light.intensity = 0;
        continue;
      }
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.life = 0;
        slot.light.intensity = 0;
        continue;
      }
      const t = 1 - slot.life / slot.dur;
      const decay = (1 - t) * (1 - t);
      const flicker = 0.9 + 0.1 * Math.sin(this._time * 120 + i * 2.1);
      slot.light.intensity = slot.peak * decay * flicker;
    }
  }

  // -- update ---------------------------------------------------------------

  update(dt, elapsed) {
    if (this._disposed) return;
    let step = num(dt, 0);
    if (step < 0) step = 0;
    if (step > 0.1) step = 0.1;
    this._time = isNum(elapsed) ? elapsed : this._time + step;

    this._applySceneFog();
    this._syncFogUniforms();

    this._glow.update(step);
    this._fire.update(step);
    this._smoke.update(step);
    this._star.update(step);
    this._starVM.update(step);
    this._cone.update(step);
    this._tracers.update(step, this.camera);
    this._decals.update(step);
    this._debris.update(step);
    this._casings.update(step);
    this._rings.update(step, this.camera);
    this._beams.update(step, this.camera);
    this._updateLights(step);
  }

  // -- muzzle flash ---------------------------------------------------------

  muzzleFlash(position, direction, options) {
    const opts = options || EMPTY;
    if (!isPoint(position)) return;
    const scale = clamp(num(opts.scale, 1), 0.05, 8);
    this._tint(opts.color === undefined ? 0xffb45a : opts.color);
    const cr = this._tr;
    const cg = this._tg;
    const cb = this._tb;
    const viewmodel = opts.viewmodel === true;

    let px = position.x;
    let py = position.y;
    let pz = position.z;
    let dx = direction && isNum(direction.x) ? direction.x : 0;
    let dy = direction && isNum(direction.y) ? direction.y : 0;
    let dz = direction && isNum(direction.z) ? direction.z : 0;

    // Late-bound camera math so integration works even if the player module
    // hasn't refreshed the camera yet this frame.
    const camera = this.camera;
    if (viewmodel && camera) {
      const camPos = camera.position;
      const dist = Math.hypot(px - camPos.x, py - camPos.y, pz - camPos.z);
      const mag = Math.hypot(px, py, pz);
      if (mag < 2.5 && dist > 2.5) {
        // Clearly camera-local coordinates: convert to world space.
        _vA.set(px, py, pz).applyMatrix4(camera.matrixWorld);
        px = _vA.x;
        py = _vA.y;
        pz = _vA.z;
        _vB.set(dx, dy, dz).transformDirection(camera.matrixWorld);
        dx = _vB.x;
        dy = _vB.y;
        dz = _vB.z;
      }
    }

    let dl = Math.hypot(dx, dy, dz);
    if (!(dl > 1e-5)) {
      this._cameraForward(_vA);
      dx = _vA.x;
      dy = _vA.y;
      dz = _vA.z;
      dl = 1;
    }
    dx /= dl;
    dy /= dl;
    dz /= dl;

    const rich = this._q.rich;
    const density = this._q.density;

    // --- star layers --------------------------------------------------------
    const starSize = 0.38 * scale;
    this._starStar(px, py, pz, starSize, cr * 2.0, cg * 1.7, cb * 1.25, 0.86, 0.055, viewmodel);
    this._starStar(
      px + dx * 0.015,
      py + dy * 0.015,
      pz + dz * 0.015,
      starSize * 0.46,
      cr * 1.6 + 1.9,
      cg * 1.6 + 1.7,
      cb * 1.6 + 1.4,
      1,
      0.05,
      viewmodel,
    );
    if (rich) {
      this._starStar(
        px + dx * 0.02,
        py + dy * 0.02,
        pz + dz * 0.02,
        starSize * 1.5,
        cr * 0.9,
        cg * 0.82,
        cb * 0.72,
        0.24,
        0.09,
        viewmodel,
      );
    }

    // --- soft glow ----------------------------------------------------------
    const glowSize = (viewmodel ? 0.32 : 0.28) * scale;
    this._glow.spawn(
      px,
      py,
      pz,
      dx * 1.5,
      dy * 1.5,
      dz * 1.5,
      glowSize,
      glowSize * 1.4,
      glowSize,
      glowSize * 1.4,
      0.07,
      cr * 1.2,
      cg * 1.0,
      cb * 0.78,
      0.7,
      2,
      0,
      rand(0, TAU),
      0,
    );

    // --- forward cone -------------------------------------------------------
    const coneLen = (viewmodel ? 0.6 : 0.95) * scale;
    const coneWidth = (viewmodel ? 0.3 : 0.38) * scale;
    const coneRot = this._screenAngle(dx, dy, dz);
    this._cone.spawn(
      px + dx * coneLen * 0.5,
      py + dy * coneLen * 0.5,
      pz + dz * coneLen * 0.5,
      dx * 2.4,
      dy * 2.4,
      dz * 2.4,
      coneWidth,
      coneWidth * 1.25,
      coneLen,
      coneLen * 1.55,
      0.055,
      cr * 1.25,
      cg * 0.98,
      cb * 0.68,
      0.8,
      0,
      0,
      coneRot,
      0,
    );

    // --- burning powder plume ----------------------------------------------
    const plume = this._q.rich ? 3 : 2;
    for (let i = 0; i < plume; i++) {
      const sp = rand(1.6, 4.6) * scale;
      const sx = dx * sp + rand(-0.9, 0.9);
      const sy = dy * sp + rand(-0.4, 1.1);
      const sz = dz * sp + rand(-0.9, 0.9);
      const life = rand(0.05, 0.12);
      this._fire.spawn(
        px + dx * 0.12 * scale,
        py + dy * 0.12 * scale,
        pz + dz * 0.12 * scale,
        sx,
        sy,
        sz,
        rand(0.14, 0.26) * scale,
        rand(0.34, 0.62) * scale,
        rand(0.14, 0.26) * scale,
        rand(0.34, 0.62) * scale,
        life,
        cr * 2.2,
        cg * 1.7,
        cb * 1.1,
        0.95,
        3,
        -1,
        rand(0, TAU),
        rand(-2, 2),
      );
    }

    // --- wisp of smoke ------------------------------------------------------
    if (density > 0.55) {
      const wisp = rand(0.09, 0.15) * scale;
      this._smoke.spawn(
        px + dx * 0.1,
        py + dy * 0.1,
        pz + dz * 0.1,
        dx * 0.45 + rand(-0.15, 0.15),
        dy * 0.45 + rand(0.1, 0.4),
        dz * 0.45 + rand(-0.15, 0.15),
        wisp,
        wisp * 4.2,
        wisp,
        wisp * 4.2,
        rand(0.3, 0.55),
        0.55,
        0.5,
        0.42,
        0.24,
        1.6,
        -0.5,
        rand(0, TAU),
        rand(-0.9, 0.9),
      );
    }

    // --- light --------------------------------------------------------------
    if (!viewmodel && this.quality !== 'medium') {
      this._flashLight(px + dx * 0.1, py + dy * 0.1, pz + dz * 0.1, cr, cg * 0.92, cb * 0.8, 18 * scale, 7 * scale, 0.07);
    }
  }

  /** Muzzle star helper — routes to the viewmodel (depthTest-off) system when needed. */
  _starStar(x, y, z, size, r, g, b, alpha, life, viewmodel) {
    const pool = viewmodel ? this._starVM : this._star;
    const rot = rand(0, TAU);
    pool.spawn(
      x,
      y,
      z,
      0,
      0,
      0,
      size,
      size * 1.15,
      size,
      size * 1.15,
      life,
      r,
      g,
      b,
      alpha,
      0,
      0,
      rot,
      rand(-2.5, 2.5),
    );
  }

  // -- tracers --------------------------------------------------------------

  tracer(from, to, options) {
    const opts = options || EMPTY;
    if (!isPoint(from) || !isPoint(to)) return;
    let ax = from.x;
    let ay = from.y;
    let az = from.z;
    const bx = to.x;
    const by = to.y;
    const bz = to.z;
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    let dist = Math.hypot(dx, dy, dz);
    if (!(dist > 0.05) || !Number.isFinite(dist)) {
      // Degenerate trace (zero distance / invalid): still pop a tiny spark so the
      // shot has feedback instead of silently doing nothing.
      this._glow.spawn(ax, ay, az, 0, 0, 0, 0.09, 0.14, 0.09, 0.14, 0.06, 2.2, 1.8, 1.2, 0.8, 0, 0, rand(0, TAU), 0);
      return;
    }
    if (dist > 320) {
      // Clamp absurd shots (bad maths upstream) but keep the visual.
      const k = 320 / dist;
      dx *= k;
      dy *= k;
      dz *= k;
      dist = 320;
    }
    dx /= dist;
    dy /= dist;
    dz /= dist;
    const width = clamp(num(opts.width, 0.042), 0.004, 0.35);
    const duration = clamp(num(opts.duration, 0.07), 0.015, 0.5);
    this._tint(opts.color === undefined ? 0xffd28a : opts.color);
    const hdr = 2.7;
    const r = this._tr * hdr;
    const g = this._tg * hdr;
    const b = this._tb * hdr;
    this._tracers.spawn(ax, ay, az, bx, by, bz, dist, dx, dy, dz, r, g, b, width, duration, 0.62);

    // Hot halo at the impact end so body shots read even without an impact decal.
    this._glow.spawn(bx, by, bz, 0, 0, 0, 0.2, 0.36, 0.2, 0.36, 0.055, r * 1.1, g * 1.05, b * 0.95, 0.85, 0, 0, rand(0, TAU), 0);
  }

  // -- impacts --------------------------------------------------------------

  impact(point, normal, options) {
    const opts = options || EMPTY;
    if (!isPoint(point)) return;
    const px = point.x;
    const py = point.y;
    const pz = point.z;
    const scale = clamp(num(opts.scale, 1), 0.12, 6);

    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (normal && isNum(normal.x) && isNum(normal.y) && isNum(normal.z)) {
      const l = Math.hypot(normal.x, normal.y, normal.z);
      if (l > 1e-5) {
        nx = normal.x / l;
        ny = normal.y / l;
        nz = normal.z / l;
      }
    }

    let surface = typeof opts.surface === 'string' ? opts.surface.toLowerCase() : 'stone';
    surface = this._surfaceAliases[surface] || 'stone';
    const S = this._surfaces[surface];
    const density = this._q.density;
    const rich = this._q.rich;

    // Decal (world-space mark, oriented along the surface normal).
    if (opts.decal !== false) {
      // Robot combat calls impact() on moving hitboxes with surface 'metal'; a
      // world-space decal must not linger there, so metal marks are short-lived.
      const decalLife = surface === 'metal' ? 2.2 : 32;
      this._decals.place(
        px,
        py,
        pz,
        nx,
        ny,
        nz,
        S.decal,
        S.decalSize * scale,
        rand(0, TAU),
        decalLife,
        this._q.decals,
      );
    }

    // Dust / debris puffs.
    const puffs = Math.max(1, Math.round(S.puffs * density * (0.55 + 0.55 * scale)));
    for (let i = 0; i < puffs; i++) {
      let dx = rand(-1, 1);
      let dy = rand(-1, 1);
      let dz = rand(-1, 1);
      let l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      const dot = dx * nx + dy * ny + dz * nz;
      if (dot < 0) {
        dx -= 2 * dot * nx;
        dy -= 2 * dot * ny;
        dz -= 2 * dot * nz;
      }
      dx += nx * 0.5;
      dy += ny * 0.5 + 0.18;
      dz += nz * 0.5;
      l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      const sp = rand(0.6, 2.6) * scale;
      const size = rand(0.26, 0.56) * S.puffSize * scale;
      const warm = rand(0.85, 1.15);
      const useDust2 = i % 3 === 0;
      const cr = (useDust2 ? S.dust2[0] : S.dust[0]) * warm;
      const cg = (useDust2 ? S.dust2[1] : S.dust[1]) * warm;
      const cb = (useDust2 ? S.dust2[2] : S.dust[2]) * warm;
      this._smoke.spawn(
        px + nx * 0.03 + rand(-0.04, 0.04),
        py + ny * 0.03 + rand(-0.04, 0.04),
        pz + nz * 0.03 + rand(-0.04, 0.04),
        dx * sp,
        dy * sp,
        dz * sp,
        size,
        size * rand(2.8, 5.2),
        size,
        size * rand(2.8, 5.2),
        rand(0.45, 1.1),
        cr,
        cg,
        cb,
        rand(0.45, 0.8),
        rand(1.6, 3.2),
        -0.35,
        rand(0, TAU),
        rand(-1.1, 1.1),
      );
    }

    // Ground impacts get a low, horizontal dust wash so the hit is readable.
    if (ny > 0.55 && scale > 0.4) {
      for (let i = 0; i < 2; i++) {
        const ang = rand(0, TAU);
        const size = rand(0.3, 0.62) * scale;
        const warm = rand(0.9, 1.1);
        this._smoke.spawn(
          px + Math.cos(ang) * 0.1 * scale,
          py + 0.04,
          pz + Math.sin(ang) * 0.1 * scale,
          Math.cos(ang) * rand(0.9, 2.2) * scale,
          rand(0.1, 0.5) * scale,
          Math.sin(ang) * rand(0.9, 2.2) * scale,
          size,
          size * rand(3.0, 4.6),
          size,
          size * rand(3.0, 4.6),
          rand(0.6, 1.2),
          S.dust[0] * warm,
          S.dust[1] * warm,
          S.dust[2] * warm,
          rand(0.3, 0.5),
          1.8,
          -0.15,
          rand(0, TAU),
          rand(-0.6, 0.6),
        );
      }
    }

    // Hard-surface sparks + glint.
    if (S.sparks > 0) {
      const sparkColor = surface === 'metal' ? 0xffd48a : 0xffa648;
      this._sparksAt(px, py, pz, nx, ny, nz, Math.round(S.sparks * density), sparkColor, surface === 'metal' ? 8.5 : 5.5, scale);
    }
    if (S.glint) {
      this._flashAt(
        px + nx * 0.03,
        py + ny * 0.03,
        pz + nz * 0.03,
        0.2 * scale,
        2.5,
        2.0,
        1.5,
        0.05,
        0.85,
      );
    }

    // Chips / splinters.
    if (S.chips > 0 && (rich || Math.random() < 0.7)) {
      const count = Math.max(1, Math.round(S.chips * density * (0.6 + 0.4 * scale)));
      for (let i = 0; i < count; i++) {
        let dx = rand(-1, 1);
        let dy = rand(-1, 1);
        let dz = rand(-1, 1);
        let l = Math.hypot(dx, dy, dz) || 1;
        dx /= l;
        dy /= l;
        dz /= l;
        const dot = dx * nx + dy * ny + dz * nz;
        if (dot < 0) {
          dx -= 2 * dot * nx;
          dy -= 2 * dot * ny;
          dz -= 2 * dot * nz;
        }
        dx = dx * 0.65 + nx * 0.9;
        dy = dy * 0.65 + ny * 0.9 + 0.35;
        dz = dz * 0.65 + nz * 0.9;
        l = Math.hypot(dx, dy, dz) || 1;
        const sp = rand(1.4, 3.6) * scale;
        const s = rand(0.25, 0.75) * scale;
        const tint = rand(0.82, 1.2);
        let sx = s;
        let sy = s;
        let sz = s;
        if (surface === 'wood') {
          sx = s * rand(0.9, 1.5);
          sy = s * rand(0.35, 0.75);
          sz = s * rand(0.25, 0.5);
        } else if (surface === 'stone' || surface === 'sand') {
          sx = s * rand(0.6, 1.2);
          sy = s * rand(0.5, 1.1);
          sz = s * rand(0.6, 1.2);
        } else {
          sx = s * rand(0.5, 1.1);
          sy = s * rand(0.3, 0.7);
          sz = s * rand(0.5, 1.1);
        }
        this._debris.spawn(
          px + nx * 0.04 + rand(-0.03, 0.03),
          py + ny * 0.04 + rand(-0.03, 0.03),
          pz + nz * 0.04 + rand(-0.03, 0.03),
          (dx / l) * sp,
          (dy / l) * sp,
          (dz / l) * sp,
          sx,
          sy,
          sz,
          S.chip[0] * tint,
          S.chip[1] * tint,
          S.chip[2] * tint,
          rand(0.9, 1.8),
          rand(6, 18),
        );
      }
    }
  }

  // -- sparks ---------------------------------------------------------------

  sparks(point, normal, options) {
    const opts = options || EMPTY;
    if (!isPoint(point)) return;
    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (normal && isNum(normal.x) && isNum(normal.y) && isNum(normal.z)) {
      const l = Math.hypot(normal.x, normal.y, normal.z);
      if (l > 1e-5) {
        nx = normal.x / l;
        ny = normal.y / l;
        nz = normal.z / l;
      }
    }
    const count = clamp(num(opts.count, 12), 1, 80);
    const color = opts.color === undefined ? 0xffb040 : opts.color;
    const speed = clamp(num(opts.speed, 6), 0.4, 45);
    const scale = clamp(num(opts.scale, 1), 0.1, 6);
    this._sparksAt(point.x, point.y, point.z, nx, ny, nz, count, color, speed, scale);
  }

  _sparksAt(px, py, pz, nx, ny, nz, count, colorHex, speed, scale) {
    this._tint(colorHex);
    const cr = this._tr * 3.0;
    const cg = this._tg * 2.9;
    const cb = this._tb * 2.8;
    const density = this._q.density;
    const n = Math.max(1, Math.round(count * density));
    for (let i = 0; i < n; i++) {
      let dx = rand(-1, 1);
      let dy = rand(-1, 1);
      let dz = rand(-1, 1);
      let l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      const dot = dx * nx + dy * ny + dz * nz;
      if (dot < 0) {
        dx -= 2 * dot * nx;
        dy -= 2 * dot * ny;
        dz -= 2 * dot * nz;
      }
      dx += nx * 0.45;
      dy += ny * 0.45 + 0.3;
      dz += nz * 0.45;
      l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      const sp = rand(0.4, 1.25) * speed * (0.7 + 0.5 * scale);
      const vx = dx * sp;
      const vy = dy * sp;
      const vz = dz * sp;
      const life = rand(0.1, 0.34);
      const width = rand(0.016, 0.034) * (0.8 + 0.35 * scale);
      const length = clamp(sp * 0.055, 0.06, 0.85);
      const rot = this._screenAngle(vx, vy, vz);
      const warm = rand(0.85, 1.15);
      this._glow.spawn(
        px + nx * 0.02,
        py + ny * 0.02,
        pz + nz * 0.02,
        vx,
        vy,
        vz,
        width,
        width * 0.55,
        length,
        length * 0.7,
        life,
        cr * warm,
        cg * warm,
        cb * warm,
        1,
        1.15,
        14,
        rot,
        0,
      );
      // A couple of hot cores per burst for extra punch.
      if (i % 4 === 0) {
        this._glow.spawn(
          px,
          py,
          pz,
          vx * 0.25,
          vy * 0.25,
          vz * 0.25,
          0.05 * scale,
          0.11 * scale,
          0.05 * scale,
          0.11 * scale,
          rand(0.12, 0.3),
          cr * 1.2,
          cg * 1.15,
          cb * 1.1,
          0.9,
          2,
          6,
          rand(0, TAU),
          0,
        );
      }
    }
    if (n > 0) {
      this._flashAt(px + nx * 0.03, py + ny * 0.03, pz + nz * 0.03, 0.13 * scale, 2.6, 2.1, 1.5, 0.045, 0.8);
    }
  }

  // -- dust burst -----------------------------------------------------------

  dustBurst(position, options) {
    const opts = options || EMPTY;
    if (!isPoint(position)) return;
    const scale = clamp(num(opts.scale, 1), 0.1, 6);
    const count = clamp(Math.round(num(opts.count, 10)), 1, 40);
    const density = this._q.density;
    const n = Math.max(1, Math.round(count * density));
    const px = position.x;
    const py = position.y;
    const pz = position.z;
    for (let i = 0; i < n; i++) {
      const ang = rand(0, TAU);
      const rad = rand(0.05, 0.5) * scale;
      const ox = Math.cos(ang) * rad;
      const oz = Math.sin(ang) * rad;
      const out = rand(0.6, 2.4) * scale;
      const size = rand(0.24, 0.58) * scale;
      const warm = rand(0.85, 1.15);
      this._smoke.spawn(
        px + ox,
        py + rand(0.02, 0.16) * scale,
        pz + oz,
        Math.cos(ang) * out,
        rand(0.15, 0.9) * scale,
        Math.sin(ang) * out,
        size,
        size * rand(2.4, 4.4),
        size,
        size * rand(2.4, 4.4),
        rand(0.55, 1.3),
        DUST_SAND[0] * warm,
        DUST_SAND[1] * warm,
        DUST_SAND[2] * warm,
        rand(0.34, 0.6),
        rand(1.6, 2.8),
        -0.35,
        rand(0, TAU),
        rand(-0.8, 0.8),
      );
    }
    if (this._q.rich && scale > 0.6) {
      const chip = this._surfaces.sand.chip;
      for (let i = 0; i < 2; i++) {
        this._debris.spawn(
          px + rand(-0.25, 0.25) * scale,
          py + rand(0.02, 0.12),
          pz + rand(-0.25, 0.25) * scale,
          rand(-1.2, 1.2),
          rand(0.6, 1.8),
          rand(-1.2, 1.2),
          0.05 * scale,
          0.04 * scale,
          0.05 * scale,
          chip[0],
          chip[1],
          chip[2],
          rand(0.5, 0.9),
          rand(4, 10),
        );
      }
    }
  }

  /** Small dust kick for footsteps / landings (extra convenience API). */
  footstepDust(position, scale = 1) {
    if (!isPoint(position)) return;
    const s = clamp(num(scale, 1), 0.2, 3);
    const px = position.x;
    const py = position.y;
    const pz = position.z;
    const n = this.quality === 'medium' ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const ang = rand(0, TAU);
      const size = rand(0.09, 0.17) * s;
      this._smoke.spawn(
        px + Math.cos(ang) * rand(0.04, 0.2) * s,
        py + rand(0.01, 0.06),
        pz + Math.sin(ang) * rand(0.04, 0.2) * s,
        Math.cos(ang) * rand(0.25, 0.9) * s,
        rand(0.1, 0.45) * s,
        Math.sin(ang) * rand(0.25, 0.9) * s,
        size,
        size * rand(2.2, 3.4),
        size,
        size * rand(2.2, 3.4),
        rand(0.35, 0.7),
        DUST_SAND_DARK[0],
        DUST_SAND_DARK[1],
        DUST_SAND_DARK[2],
        0.32,
        2.2,
        -0.2,
        rand(0, TAU),
        rand(-0.6, 0.6),
      );
    }
  }

  // -- explosion ------------------------------------------------------------

  explosion(position, options) {
    const opts = options || EMPTY;
    if (!isPoint(position)) return;
    const scale = clamp(num(opts.scale, 1), 0.35, 5);
    this._tint(opts.color === undefined ? 0xff7a2f : opts.color);
    const cr = this._tr;
    const cg = this._tg;
    const cb = this._tb;
    const px = position.x;
    const py = position.y;
    const pz = position.z;
    const density = this._q.density;
    const rich = this._q.rich;

    // Enemies pass their chassis tint (cyan/orange) as the explosion color. Keep
    // the fireball readable as fire, using the tint mostly for rings / light.
    const fireR = cr * 0.28 + 0.72;
    const fireG = cg * 0.28 + 0.396;
    const fireB = cb * 0.28 + 0.144;

    // Core flash.
    this._flashAt(px, py + 0.25 * scale, pz, 1.6 * scale, fireR * 1.7, fireG * 1.45, fireB * 1.05, 0.075, 0.7);
    this._flashAt(px, py + 0.3 * scale, pz, 2.6 * scale, cr * 0.7, cg * 0.4, cb * 0.19, 0.12, 0.18);
    if (rich) {
      this._flashAt(px + rand(-0.4, 0.4) * scale, py + rand(0, 0.7) * scale, pz + rand(-0.4, 0.4) * scale, 1.4 * scale, 1.9, 1.2, 0.55, 0.17, 0.42);
    }

    // Fireball lobes.
    const fireCount = Math.max(6, Math.round(13 * scale * density));
    for (let i = 0; i < fireCount; i++) {
      const ang = rand(0, TAU);
      const up = rand(-0.25, 1);
      const horiz = Math.sqrt(Math.max(0, 1 - up * up));
      const dx = Math.cos(ang) * horiz;
      const dy = up;
      const dz = Math.sin(ang) * horiz;
      const sp = rand(1.4, 6.5) * scale;
      const s0 = rand(0.45, 1.15) * scale;
      const s1 = s0 * rand(1.8, 3.6);
      const hot = rand(0.72, 1.15);
      this._fire.spawn(
        px + dx * rand(0, 0.5) * scale,
        py + 0.25 * scale + dy * rand(0, 0.5) * scale,
        pz + dz * rand(0, 0.5) * scale,
        dx * sp,
        dy * sp + rand(0.4, 2.4) * scale,
        dz * sp,
        s0,
        s1,
        s0,
        s1,
        rand(0.3, 0.78),
        fireR * 0.92 * hot + 0.18,
        fireG * 0.66 * hot + 0.08,
        fireB * 0.46 * hot + 0.02,
        0.95,
        1.9,
        -2.2,
        rand(0, TAU),
        rand(-1.8, 1.8),
      );
    }

    // Ember shower.
    const emberCount = Math.max(8, Math.round(24 * scale * density));
    for (let i = 0; i < emberCount; i++) {
      const ang = rand(0, TAU);
      const up = rand(-0.15, 1);
      const horiz = Math.sqrt(Math.max(0, 1 - up * up));
      const dx = Math.cos(ang) * horiz;
      const dy = up;
      const dz = Math.sin(ang) * horiz;
      const sp = rand(3, 13) * scale;
      const life = rand(0.45, 1.5);
      const size = rand(0.04, 0.13) * scale;
      const rot = this._screenAngle(dx * sp, dy * sp, dz * sp);
      const warm = rand(0.75, 1.15);
      this._glow.spawn(
        px,
        py + 0.2 * scale,
        pz,
        dx * sp,
        dy * sp + rand(1, 4) * scale,
        dz * sp,
        size,
        size * 0.55,
        size * rand(1.2, 2.6),
        size * rand(0.7, 1.3),
        life,
        (fireR * 1.25 + 0.22) * warm,
        (fireG * 1.0 + 0.14) * warm,
        (fireB * 0.7 + 0.05) * warm,
        1,
        0.5,
        9.5,
        rot,
        0,
      );
    }

    // Smoke column.
    const smokeCount = Math.max(7, Math.round(16 * scale * density));
    for (let i = 0; i < smokeCount; i++) {
      const ang = rand(0, TAU);
      const rad = rand(0.1, 0.85) * scale;
      const shade = rand(0.55, 1.3);
      const warm = rand(0.95, 1.05);
      const s0 = rand(0.9, 2.0) * scale;
      const s1 = s0 * rand(1.9, 3.4);
      this._smoke.spawn(
        px + Math.cos(ang) * rad,
        py + rand(0.15, 1.2) * scale,
        pz + Math.sin(ang) * rad,
        Math.cos(ang) * rand(0.4, 2.4) * scale,
        rand(1.0, 3.2) * scale,
        Math.sin(ang) * rand(0.4, 2.4) * scale,
        s0,
        s1,
        s0,
        s1,
        rand(1.1, 2.6),
        SMOKE_DARK[0] * shade * warm,
        SMOKE_DARK[1] * shade * warm,
        SMOKE_DARK[2] * shade * warm,
        rand(0.62, 0.92),
        1.7,
        -0.85,
        rand(0, TAU),
        rand(-0.9, 0.9),
      );
    }

    // Low sand/dust wash near the ground.
    const wash = Math.max(3, Math.round(6 * scale * density));
    for (let i = 0; i < wash; i++) {
      const ang = rand(0, TAU);
      const rad = rand(0.3, 1.3) * scale;
      const size = rand(0.3, 0.75) * scale;
      this._smoke.spawn(
        px + Math.cos(ang) * rad,
        py + rand(0.02, 0.3) * scale,
        pz + Math.sin(ang) * rad,
        Math.cos(ang) * rand(1.4, 3.6) * scale,
        rand(0.2, 1.1) * scale,
        Math.sin(ang) * rand(1.4, 3.6) * scale,
        size,
        size * rand(2.6, 4.2),
        size,
        size * rand(2.6, 4.2),
        rand(0.6, 1.4),
        DUST_SAND[0] * 0.9,
        DUST_SAND[1] * 0.9,
        DUST_SAND[2] * 0.9,
        rand(0.42, 0.62),
        1.5,
        -0.2,
        rand(0, TAU),
        rand(-0.7, 0.7),
      );
    }

    // Debris chunks.
    const debrisCount = Math.max(4, Math.round(9 * scale * density));
    for (let i = 0; i < debrisCount; i++) {
      const ang = rand(0, TAU);
      const up = rand(0.2, 1);
      const horiz = Math.sqrt(Math.max(0, 1 - up * up));
      const sp = rand(3, 9) * scale;
      const s = rand(0.35, 1.1) * scale;
      const metal = Math.random() < 0.55;
      const tint = rand(0.85, 1.15);
      const base = metal ? CHUNK_CHAR : CHUNK_RUST;
      this._debris.spawn(
        px + rand(-0.2, 0.2) * scale,
        py + 0.3 * scale + rand(0, 0.5) * scale,
        pz + rand(-0.2, 0.2) * scale,
        Math.cos(ang) * horiz * sp,
        up * sp + rand(1, 3) * scale,
        Math.sin(ang) * horiz * sp,
        s * rand(0.7, 1.4),
        s * rand(0.4, 1.0),
        s * rand(0.7, 1.3),
        base[0] * tint,
        base[1] * tint,
        base[2] * tint,
        rand(2.2, 4.0),
        rand(6, 16),
      );
    }

    // Shockwaves: camera-facing air ring + flat ground dust ring.
    this._rings.spawn(px, py + 0.3 * scale, pz, 0.35 * scale, 4.4 * scale, 0.3, cr * 1.15, cg * 0.72, cb * 0.4, 0.7, false, rand(0, TAU));
    this._rings.spawn(px, 0.02, pz, 0.4 * scale, 5.6 * scale, 0.62, 0.5, 0.37, 0.21, 0.4, true, rand(0, TAU));
    if (rich) {
      this._rings.spawn(px, py + 0.1 * scale, pz, 0.2 * scale, 2.7 * scale, 0.2, 0.9, 0.66, 0.42, 0.36, false, rand(0, TAU));
    }

    // Scorch mark.
    this._decals.place(px, 0.025, pz, 0, 1, 0, 'scorch', rand(1.5, 2.1) * scale, rand(0, TAU), 55, this._q.decals);

    // Flash light.
    this._flashLight(px, py + 0.5 * scale, pz, cr * 1.15, cg * 0.95, cb * 0.8, 140 * scale * scale + 25, 18 * scale, 0.34);
  }

  // -- teleport / materialisation ------------------------------------------

  teleport(position, options) {
    const opts = options || EMPTY;
    if (!isPoint(position)) return;
    const scale = clamp(num(opts.scale, 1), 0.2, 4);
    this._tint(opts.color === undefined ? 0xff4d1f : opts.color);
    const cr = this._tr;
    const cg = this._tg;
    const cb = this._tb;
    const px = position.x;
    const py = position.y;
    const pz = position.z;
    const density = this._q.density;
    const rich = this._q.rich;

    const height = 3.3 * scale;
    const width = 1.05 * scale;

    // Energy column (two layers for depth).
    this._beams.spawn(px, py, pz, width, height, 0.62, cr * 1.15, cg * 1.0, cb * 0.9, 0.85);
    if (rich) {
      this._beams.spawn(px, py, pz, width * 0.45, height * 0.95, 0.52, Math.min(0.95, cr + 0.4), Math.min(0.95, cg + 0.45), Math.min(0.95, cb + 0.5), 0.4);
    }

    // Flash at the centre of mass.
    this._flashAt(px, py + height * 0.32, pz, 1.5 * scale, cr * 1.35 + 0.22, cg * 1.15 + 0.18, cb * 1.0 + 0.14, 0.16, 0.65);
    this._flashAt(px, py + 0.1, pz, 1.0 * scale, cr * 1.05, cg * 0.88, cb * 0.75, 0.28, 0.4);

    // Ground ring.
    this._rings.spawn(px, py + 0.03, pz, 0.2 * scale, 2.4 * scale, 0.55, cr * 1.25, cg * 0.95, cb * 0.78, 0.6, true, rand(0, TAU));
    if (rich) {
      this._rings.spawn(px, py + 0.9 * scale, pz, 0.3 * scale, 1.7 * scale, 0.42, cr * 1.2, cg * 0.92, cb * 0.78, 0.45, false, rand(0, TAU));
    }

    // Rising motes.
    const motes = Math.max(10, Math.round(26 * density * scale));
    for (let i = 0; i < motes; i++) {
      const ang = rand(0, TAU);
      const rad = rand(0.05, 0.62) * scale;
      const h = rand(0, height);
      const size = rand(0.05, 0.16) * scale;
      const warm = rand(0.75, 1.2);
      this._glow.spawn(
        px + Math.cos(ang) * rad,
        py + h,
        pz + Math.sin(ang) * rad,
        Math.cos(ang) * rand(-0.25, 0.25) * scale + rand(-0.2, 0.2),
        rand(0.9, 3.4) * scale,
        Math.sin(ang) * rand(-0.25, 0.25) * scale + rand(-0.2, 0.2),
        size,
        size * 0.4,
        size * rand(1.4, 3.0),
        size * rand(0.6, 1.2),
        rand(0.4, 1.1),
        (cr * 1.5 + 0.28) * warm,
        (cg * 1.2 + 0.2) * warm,
        (cb * 1.0 + 0.16) * warm,
        0.95,
        1.2,
        1.4,
        rand(0, TAU),
        0,
      );
    }

    // Base dust puff.
    const puffs = Math.max(2, Math.round(4 * density));
    for (let i = 0; i < puffs; i++) {
      const ang = rand(0, TAU);
      const size = rand(0.2, 0.5) * scale;
      this._smoke.spawn(
        px + Math.cos(ang) * rand(0.1, 0.7) * scale,
        py + rand(0.02, 0.3) * scale,
        pz + Math.sin(ang) * rand(0.1, 0.7) * scale,
        Math.cos(ang) * rand(0.5, 1.8) * scale,
        rand(0.4, 1.4) * scale,
        Math.sin(ang) * rand(0.5, 1.8) * scale,
        size,
        size * rand(2.4, 3.8),
        size,
        size * rand(2.4, 3.8),
        rand(0.6, 1.2),
        DUST_STONE[0] * 0.85,
        DUST_STONE[1] * 0.85,
        DUST_STONE[2] * 0.85,
        0.34,
        1.8,
        -0.3,
        rand(0, TAU),
        rand(-0.8, 0.8),
      );
    }

    this._flashLight(px, py + height * 0.35, pz, cr, cg * 0.85, cb * 0.8, 22 * scale, 8 * scale, 0.45);
  }

  // -- shell casings --------------------------------------------------------

  shellCasing(position, velocity, options) {
    const opts = options || EMPTY;
    if (!isPoint(position)) return;
    const scale = clamp(num(opts.scale, 1), 0.3, 3);
    let vx = velocity && isNum(velocity.x) ? velocity.x : 0;
    let vy = velocity && isNum(velocity.y) ? velocity.y : 0;
    let vz = velocity && isNum(velocity.z) ? velocity.z : 0;
    let speed = Math.hypot(vx, vy, vz);
    if (!(speed > 0.05) || !Number.isFinite(speed)) {
      // No useful ejection velocity: toss to the shooter's right and up.
      const camera = this.camera;
      if (camera) {
        const e = camera.matrixWorld.elements;
        vx = e[0] * rand(1.4, 3.1) + rand(-0.4, 0.4);
        vy = rand(1.4, 2.6);
        vz = e[2] * rand(1.4, 3.1) + rand(-0.4, 0.4);
      } else {
        vx = rand(1.2, 2.8);
        vy = rand(1.4, 2.6);
        vz = rand(-0.6, 0.6);
      }
      speed = Math.hypot(vx, vy, vz);
    }
    if (speed > 12) {
      const k = 12 / speed;
      vx *= k;
      vy *= k;
      vz *= k;
    }
    const px = position.x;
    const py = Math.max(position.y, 0.04);
    const pz = position.z;
    const s = scale * rand(0.92, 1.08);
    const tint = rand(0.92, 1.05);
    this._casings.spawn(
      px + rand(-0.01, 0.01),
      py,
      pz + rand(-0.01, 0.01),
      vx,
      vy,
      vz,
      s,
      s * rand(0.95, 1.08),
      s,
      1 * tint,
      0.94 * tint,
      0.78 * tint,
      rand(2.6, 3.4),
      rand(9, 22),
    );
  }

  // -- quality / camera / lifecycle ----------------------------------------

  setQuality(quality) {
    this.quality = normalizeQuality(quality);
    this._q = QUALITY_PRESETS[this.quality];
  }

  setCamera(camera) {
    this.camera = camera || null;
  }

  /** Clear every pool (e.g. on run restart). */
  reset() {
    this._glow.reset();
    this._fire.reset();
    this._smoke.reset();
    this._star.reset();
    this._starVM.reset();
    this._cone.reset();
    this._tracers.reset();
    this._decals.reset();
    this._debris.reset();
    this._casings.reset();
    this._rings.reset();
    this._beams.reset();
    for (let i = 0; i < this._lights.length; i++) {
      this._lights[i].life = 0;
      this._lights[i].light.intensity = 0;
    }
  }

  /** Debug helper: live counts per system (allocates; call from dev tools only). */
  stats() {
    return {
      quality: this.quality,
      glow: this._glow.count,
      fire: this._fire.count,
      smoke: this._smoke.count,
      star: this._star.count,
      starVM: this._starVM.count,
      cone: this._cone.count,
      tracers: this._tracers.entries.reduce((n, e) => n + (e.active ? 1 : 0), 0),
      decals: this._decals.life.reduce((n, v) => n + (v > 0 ? 1 : 0), 0),
      debris: this._debris.count,
      casings: this._casings.count,
      rings: this._rings.entries.reduce((n, e) => n + (e.active ? 1 : 0), 0),
      beams: this._beams.entries.reduce((n, e) => n + (e.active ? 1 : 0), 0),
    };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.reset();
    if (this.root && this.root.parent) this.root.parent.remove(this.root);
    this._glow.dispose();
    this._fire.dispose();
    this._smoke.dispose();
    this._star.dispose();
    this._starVM.dispose();
    this._cone.dispose();
    this._tracers.dispose();
    this._rings.dispose();
    this._beams.dispose();
    this._debris.dispose();
    this._casings.dispose();
    for (let i = 0; i < this._geometries.length; i++) this._geometries[i].dispose();
    for (let i = 0; i < this._materials.length; i++) this._materials[i].dispose();
    for (let i = 0; i < this._ownedTextures.length; i++) this._ownedTextures[i].dispose();
    this._geometries.length = 0;
    this._materials.length = 0;
    this._ownedTextures.length = 0;
    this._lights.length = 0;
    this.root = null;
    this.scene = null;
    this.camera = null;
  }
}

export default Effects;
