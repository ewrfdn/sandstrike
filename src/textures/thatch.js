/**
 * SANDSTRIKE // island thatch texture set  (lib.thatch)
 *
 * Used by materials: thatch / thatchDark  (thatched hut roofs, ridge caps).
 *
 * Village thatch: sun-dried palm/grass straw laid in overlapping courses that
 * run down the roof slope. Direction convention (ISLAND_ASSETS.md §3.2):
 * **V = down-slope direction**, U = along the roof. Straw strands are therefore
 * near-vertical swaying strokes, every course frays over the one below, and a
 * split-bamboo batten lashed with coir rope presses the courses down.
 *
 * 1 tile = 2 m. U repeats seamlessly around the roof; V wraps too — the tile
 * border is itself a batten line, so the repeat reads as the next course down.
 *
 * Texture set contract:
 *   map            albedo        sRGB
 *   normalMap      tangent space  linear (Sobel from a 1024px height canvas)
 *   roughnessMap   linear
 *
 * Everything here is drawn with Canvas2D at load time; tune the TUNING block.
 */
import { clamp, makeRNG } from '../utils.js';
import { TAU, ctxOf, el, fillCanvas, normalFromHeightCanvas, overlayGrain, overlayNoise, textureFromCanvas, tileFbm } from './core.js';

// ---------------------------------------------------------------------------
// TUNING
// ---------------------------------------------------------------------------
const S = 1024;             // texture size (1 tile = 2 m)
const HEIGHT_SIZE = 1024;   // resolution of the height canvas the normal map comes from
const NORMAL_STRENGTH = 3.9;

const COURSES = 8;          // thatch courses stacked down the tile (V)
const STRAWS = 180;         // (superseded by per-bundle strand counts)
const LOOSE = 130;          // loose straw ends fraying over the course below
const STRAY = 130;          // stray straws laid over the whole tile
const LASHINGS = 5;         // rope lashings per batten (evenly spaced across U)

// sun-dried straw palette (ISLAND_ASSETS.md §1.2)
const NEW_STRAW = [201, 165, 95];   // #c9a55f
const OLD_STRAW = [138, 108, 58];   // #8a6c3a
const SUN_STRAW = [224, 192, 122];  // #e0c07a ridge / bleached tips
const DEEP_STRAW = [56, 41, 20];    // shadowed straw mass
const BATTEN = [148, 128, 86];      // old split bamboo
const BATTEN_DEEP = [58, 46, 26];
const ROPE = [146, 118, 74];
const ROPE_DEEP = [62, 48, 28];

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

// ---------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------

/** Split `total` px into `parts` random integers that sum exactly to `total`. */
function partition(total, parts, rng, spread = 0.4) {
  const raw = [];
  let sum = 0;
  for (let i = 0; i < parts; i++) {
    const v = 1 - spread / 2 + rng() * spread;
    raw.push(v);
    sum += v;
  }
  const out = raw.map((v) => Math.max(24, Math.round((v / sum) * total)));
  let diff = total - out.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (diff !== 0 && guard++ < 4096) {
    for (let i = 0; i < out.length && diff !== 0; i++) {
      const step = diff > 0 ? 1 : -1;
      if (out[i] + step > 20) {
        out[i] += step;
        diff -= step;
      }
    }
  }
  return out;
}

/** Draw once at (x,y) and again at the wrapped copies that cross the tile border. */
function repeatDraw(ctx, w, h, x, y, padX, padY, draw) {
  const xs = [0];
  if (x < padX) xs.push(w);
  if (x > w - padX) xs.push(-w);
  const ys = [0];
  if (padY > 0) {
    if (y < padY) ys.push(h);
    if (y > h - padY) ys.push(-h);
  }
  for (const dx of xs) {
    for (const dy of ys) {
      ctx.save();
      ctx.translate(dx, dy);
      draw(ctx);
      ctx.restore();
    }
  }
}

/**
 * Large-scale sun-bleach / weathering field. Periodic in both u and v (integer
 * harmonics + tileable fbm) so the tile border does not show a brightness step.
 */
function bleachField(u, v) {
  return clamp(
    0.5
      + Math.sin(TAU * (u + 0.13)) * 0.24
      + Math.sin(TAU * (v * 2 + 0.41)) * 0.18
      + Math.cos(TAU * (u * 2 - v + 0.7)) * 0.15
      + (tileFbm(u, v, 4, 611) - 0.5) * 0.36,
    0, 1
  );
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

/**
 * Build the course lattice, the individual straw strands, the fraying ends and
 * the lashed battens once; every map (albedo / height / roughness) replays the
 * same lists so the maps stay in register.
 */
function buildLayout() {
  const rng = makeRNG(8801);
  const heights = partition(S, COURSES, rng, 0.42);
  const courses = [];
  let y = 0;
  for (let i = 0; i < COURSES; i++) {
    const c = {
      index: i,
      y,
      h: heights[i],
      seed: Math.floor(rng() * 1e9),
      tone: clamp(0.42 + (rng() - 0.5) * 0.55, 0.12, 0.95),
      lean: (rng() - 0.5) * 0.05,
      strands: [],
      loose: [],
    };
    const r = makeRNG(c.seed);
    // straws are gathered in hand-sized bundles that fan out a little, so the
    // course does not read as a perfectly regular comb
    const BUNDLES = 18;
    const bundleW = S / BUNDLES;
    for (let bu = 0; bu < BUNDLES; bu++) {
      const bx = bu * bundleW + (r() - 0.5) * bundleW * 0.6;
      const count = 14 + Math.floor(r() * 13);
      const spread = bundleW * (0.95 + r() * 0.55);
      const lean = (r() - 0.5) * 16 + c.lean * c.h;
      const lotTone = r();
      for (let k = 0; k < count; k++) {
        const fx = count > 1 ? k / (count - 1) - 0.5 : 0;
        const broken = r() < 0.18;
        const len = c.h * (broken ? 0.2 + r() * 0.34 : 0.76 + r() * 0.38);
        c.strands.push({
          x: bx + fx * spread + (r() - 0.5) * 5,
          y0: c.y - 8 + r() * c.h * 0.12,
          len,
          sway: lean + fx * 9 + (r() - 0.5) * 10,
          width: 1.7 + r() * 4.2,
          tone: clamp(lotTone * 0.55 + r() * 0.6, 0, 1),
          alpha: 0.58 + r() * 0.42,
        });
      }
    }
    // filler straws so no bald patch shows between bundles
    for (let k = 0; k < 70; k++) {
      const broken = r() < 0.22;
      const len = c.h * (broken ? 0.18 + r() * 0.3 : 0.68 + r() * 0.42);
      c.strands.push({
        x: r() * S,
        y0: c.y - 8 + r() * c.h * 0.14,
        len,
        sway: (r() - 0.5) * 22 + c.lean * c.h,
        width: 1.6 + r() * 3.8,
        tone: r(),
        alpha: 0.5 + r() * 0.48,
      });
    }
    for (let k = 0; k < LOOSE; k++) {
      c.loose.push({
        x: r() * S,
        y0: c.y + c.h - 9 - r() * 5,
        len: 10 + r() * 44,
        sway: (r() - 0.5) * 34,
        width: 0.9 + r() * 2.1,
        tone: r(),
        alpha: 0.45 + r() * 0.55,
      });
    }
    courses.push(c);
    y += c.h;
  }

  // Battens sit on every other course boundary; the tile seam (y = 0) is one of
  // them, so a repeated tile reads as the next course down the slope.
  const boundaries = [0];
  for (const c of courses) boundaries.push(c.y + c.h);
  const battens = [];
  for (let i = 0; i < boundaries.length - 1; i += 2) {
    const brng = makeRNG(4499 + i * 131);
    const bh = 18 + brng() * 11;
    const lashings = [];
    for (let k = 0; k < LASHINGS; k++) {
      lashings.push({
        x: (k + 0.5) * (S / LASHINGS) + (brng() - 0.5) * 34,
        w: 9 + brng() * 7,
        tilt: (brng() - 0.5) * 0.3,
      });
    }
    battens.push({
      y: boundaries[i],
      h: bh,
      wave: 1.2 + brng() * 2.4,
      phase: brng() * TAU,
      seed: 4499 + i * 131,
      tone: brng(),
      lashings,
    });
  }

  // Stray straws: long pale strands lying diagonally over the courses.
  const stray = [];
  const srng = makeRNG(6613);
  for (let i = 0; i < STRAY; i++) {
    stray.push({
      x: srng() * S,
      y: srng() * S,
      len: 55 + srng() * 230,
      sway: (srng() - 0.5) * 60,
      width: 0.7 + srng() * 1.5,
      tone: srng(),
      alpha: 0.18 + srng() * 0.38,
    });
  }
  return { courses, battens, stray };
}

// ---------------------------------------------------------------------------
// shared stroke primitives
// ---------------------------------------------------------------------------

/** One straw strand: a slightly swaying, tapered stroke. */
function strokeStraw(ctx, x, y0, len, sway, width, style) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.bezierCurveTo(x + sway * 0.22, y0 + len * 0.34, x + sway * 0.72, y0 + len * 0.7, x + sway, y0 + len);
  ctx.stroke();
}

/** Rod shading profile for a split-bamboo batten, sampled column by column. */
function battenColumnY(b, x) {
  return b.y + Math.sin(TAU * ((x / S) * 2) + b.phase) * b.wave;
}

// ---------------------------------------------------------------------------
// albedo
// ---------------------------------------------------------------------------

function drawFibrousBase(ctx) {
  const rng = makeRNG(9121);
  fillCanvas(ctx, S, S, '#2b2112');
  for (let i = 0; i < 700; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 12 + rng() * 70;
    const sway = (rng() - 0.5) * 10;
    const pale = rng() > 0.42;
    const c = pale
      ? mix(OLD_STRAW, SUN_STRAW, rng() * 0.7)
      : mix(DEEP_STRAW, OLD_STRAW, rng() * 0.8);
    repeatDraw(ctx, S, S, x, y, 12, len + 12, (cx) => {
      strokeStraw(cx, x, y, len, sway, 0.6 + rng() * 1.7, css(c, 0.16 + rng() * 0.3));
    });
  }
}

function strawColor(tone, bleach, age) {
  let c = mix(OLD_STRAW, NEW_STRAW, tone);
  c = mix(c, SUN_STRAW, bleach * 0.6);
  // older courses baked a little darker, newer ones still pale
  return mix(c, DEEP_STRAW, clamp((0.55 - age) * 0.55, 0, 0.4));
}

function drawCourseAlbedo(ctx, c) {
  // compacted straw mass: shadowed under the course above, lit toward the eave
  const g = ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
  const tone = c.tone;
  g.addColorStop(0, css(mix(DEEP_STRAW, OLD_STRAW, 0.16 + tone * 0.2)));
  g.addColorStop(0.2, css(mix(OLD_STRAW, DEEP_STRAW, 0.22)));
  g.addColorStop(0.55, css(mix(OLD_STRAW, NEW_STRAW, 0.42 + tone * 0.42)));
  g.addColorStop(0.8, css(mix(NEW_STRAW, OLD_STRAW, 0.18 + tone * 0.3)));
  g.addColorStop(1, css(mix(OLD_STRAW, DEEP_STRAW, 0.42)));
  ctx.fillStyle = g;
  ctx.fillRect(0, c.y - 1, S, c.h + 2);

  // dark tuck-shadow under the course / batten above
  const sh = ctx.createLinearGradient(0, c.y - 2, 0, c.y + Math.min(44, c.h * 0.45));
  sh.addColorStop(0, 'rgba(16,10,3,0.42)');
  sh.addColorStop(0.45, 'rgba(16,10,3,0.16)');
  sh.addColorStop(1, 'rgba(16,10,3,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, c.y - 2, S, Math.min(52, c.h * 0.55));

  for (const st of c.strands) {
    const u = st.x / S;
    const v = (st.y0 + st.len * 0.5) / S;
    const bleach = bleachField(u, v);
    const base = strawColor(st.tone, bleach, c.tone);
    const dark = mix(DEEP_STRAW, base, 0.34);
    const lit = mix(base, SUN_STRAW, 0.6);
    const padX = st.width + Math.abs(st.sway) + 10;
    const padY = st.len + 20;
    repeatDraw(ctx, S, S, st.x, st.y0, padX, padY, (cx) => {
      strokeStraw(cx, st.x + 1.5, st.y0, st.len, st.sway, st.width + 1.6, css(dark, st.alpha * 0.78));
      strokeStraw(cx, st.x, st.y0, st.len, st.sway, st.width, css(base, st.alpha));
      if (st.width > 2.6) {
        strokeStraw(cx, st.x - 1.1, st.y0 + 1.5, st.len * 0.9, st.sway * 0.95, st.width * 0.36, css(lit, st.alpha * 0.9));
      }
    });
  }

  // frayed ends hanging over the next course: sun-bleached tips catch the light
  for (const lo of c.loose) {
    const bleach = bleachField(lo.x / S, (lo.y0 + lo.len) / S);
    const base = mix(mix(strawColor(lo.tone, bleach, c.tone), SUN_STRAW, 0.5), DEEP_STRAW, 0.1);
    repeatDraw(ctx, S, S, lo.x, lo.y0, lo.width + Math.abs(lo.sway) + 10, lo.len + 16, (cx) => {
      strokeStraw(cx, lo.x, lo.y0, lo.len, lo.sway, lo.width, css(base, lo.alpha));
    });
  }
}

function drawBattenAlbedo(ctx, b) {
  const rng = makeRNG(b.seed);
  // shadow the batten throws down onto the thatch
  const sg = ctx.createLinearGradient(0, b.y + b.h * 0.2, 0, b.y + b.h * 2.6);
  sg.addColorStop(0, 'rgba(18,12,4,0.34)');
  sg.addColorStop(0.45, 'rgba(18,12,4,0.12)');
  sg.addColorStop(1, 'rgba(18,12,4,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, b.y + b.h * 0.2, S, b.h * 2.4);

  // rod body: cross-section gradient, sampled column by column so the batten can
  // sway without breaking the U wrap
  const base = mix(BATTEN, [196, 178, 132], 0.3 + b.tone * 0.45);
  for (let x = 0; x < S; x += 16) {
    const yc = battenColumnY(b, x);
    const g = ctx.createLinearGradient(0, yc - b.h / 2, 0, yc + b.h / 2);
    g.addColorStop(0, css([222, 204, 156]));
    g.addColorStop(0.22, css(mix(base, [214, 196, 150], 0.35)));
    g.addColorStop(0.58, css(base));
    g.addColorStop(0.82, css(mix(base, BATTEN_DEEP, 0.5)));
    g.addColorStop(1, css(BATTEN_DEEP));
    ctx.fillStyle = g;
    ctx.fillRect(x, yc - b.h / 2, 16.6, b.h);
  }
  // thin specular line along the rounded top of the rod
  for (let x = 0; x < S; x += 16) {
    const yc = battenColumnY(b, x);
    ctx.fillStyle = 'rgba(248,236,200,0.24)';
    ctx.fillRect(x, yc - b.h * 0.3, 16.6, 1.6);
  }

  // lengthwise split-bamboo fibres
  for (let i = 0; i < 46; i++) {
    const fy = -b.h / 2 + rng() * b.h;
    const k = 1 + Math.floor(rng() * 3);
    const ph = rng() * TAU;
    const amp = 0.5 + rng() * 1.4;
    const light = rng() > 0.52;
    ctx.strokeStyle = light
      ? `rgba(226,208,166,${0.05 + rng() * 0.12})`
      : `rgba(34,25,12,${0.06 + rng() * 0.15})`;
    ctx.lineWidth = 0.6 + rng() * 1.3;
    ctx.beginPath();
    for (let x = 0; x <= S; x += 24) {
      const y = battenColumnY(b, x) + fy + Math.sin(TAU * ((x / S) * k) + ph) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // coir lashings: two crossing wraps plus a knot, all slightly tilted
  for (const l of b.lashings) {
    const yc = battenColumnY(b, l.x);
    const pad = l.w + 14;
    repeatDraw(ctx, S, S, l.x, yc, pad, pad, (cx) => {
      cx.save();
      cx.translate(l.x, yc);
      cx.rotate(l.tilt * 0.25);
      const rope = mix(ROPE_DEEP, ROPE, 0.55 + rng() * 0.3);
      // soft shadow the cord drops on the rod
      cx.strokeStyle = 'rgba(16,10,3,0.4)';
      cx.lineWidth = 7.5;
      cx.beginPath();
      cx.moveTo(-l.w + 1.5, -b.h * 0.8);
      cx.lineTo(l.w + 1.5, b.h * 0.8);
      cx.stroke();
      for (let k = 0; k < 2; k++) {
        cx.strokeStyle = css(mix(rope, k === 0 ? [232, 208, 160] : ROPE_DEEP, k === 0 ? 0.22 : 0.2), 0.95);
        cx.lineWidth = 3.2 + rng() * 1.8;
        cx.beginPath();
        cx.moveTo(-l.w + k * 3.2, -b.h * 0.78);
        cx.quadraticCurveTo(k * 3.2, 0, l.w - k * 3.2, b.h * 0.78);
        cx.stroke();
      }
      // tightening knot at the middle of the wrap
      cx.fillStyle = css(mix(rope, [236, 214, 168], 0.25), 0.96);
      cx.beginPath();
      cx.ellipse(l.w * 0.12, b.h * 0.06, 4.2, 3.2, 0.5, 0, TAU);
      cx.fill();
      cx.strokeStyle = 'rgba(28,18,8,0.45)';
      cx.lineWidth = 1.2;
      cx.beginPath();
      cx.ellipse(l.w * 0.12, b.h * 0.06, 4.2, 3.2, 0.5, 0, TAU);
      cx.stroke();
      cx.restore();
    });
  }
}

function drawStrayAlbedo(ctx, stray) {
  for (const s of stray) {
    const bleach = bleachField(s.x / S, s.y / S);
    const base = mix(strawColor(s.tone, bleach, 0.55), SUN_STRAW, 0.3);
    repeatDraw(ctx, S, S, s.x, s.y, s.width + Math.abs(s.sway) + 12, s.len + 24, (cx) => {
      strokeStraw(cx, s.x, s.y, s.len, s.sway, s.width, css(base, s.alpha));
    });
  }
}

function drawWeatherAlbedo(ctx) {
  const rng = makeRNG(3177);
  // sun-bleached ridges / thin patches
  for (let i = 0; i < 12; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 90 + rng() * 280;
    const a = 0.035 + rng() * 0.05;
    repeatDraw(ctx, S, S, x, y, r + 8, r + 8, (cx) => {
      const g = cx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(236,212,160,${a})`);
      g.addColorStop(1, 'rgba(236,212,160,0)');
      cx.fillStyle = g;
      cx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  // humid weather staining: soft dark streaks running down-slope (V)
  for (let i = 0; i < 14; i++) {
    const x = rng() * S;
    const y = rng() * S * 0.6;
    const len = 120 + rng() * 420;
    const w = 9 + rng() * 30;
    const a = 0.03 + rng() * 0.06;
    repeatDraw(ctx, S, S, x, y + len * 0.5, w + 20, len * 0.5 + 40, (cx) => {
      const g = cx.createLinearGradient(x, y, x, y + len);
      g.addColorStop(0, 'rgba(38,30,16,0)');
      g.addColorStop(0.35, `rgba(38,30,16,${a})`);
      g.addColorStop(1, 'rgba(38,30,16,0)');
      cx.strokeStyle = g;
      cx.lineWidth = w;
      cx.beginPath();
      cx.moveTo(x, y);
      cx.lineTo(x + (rng() - 0.5) * 10, y + len);
      cx.stroke();
    });
  }
  overlayNoise(ctx, S, S, { tile: 256, seed: 701, alpha: 0.15, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.12, seed: 702 });
}

// ---------------------------------------------------------------------------
// height
// ---------------------------------------------------------------------------

function drawFibrousBaseHeight(ctx) {
  const rng = makeRNG(9121);
  fillCanvas(ctx, S, S, 'rgb(58,58,58)');
  for (let i = 0; i < 700; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 12 + rng() * 70;
    const sway = (rng() - 0.5) * 10;
    const v = Math.round(52 + rng() * 54);
    repeatDraw(ctx, S, S, x, y, 12, len + 12, (cx) => {
      strokeStraw(cx, x, y, len, sway, 0.6 + rng() * 1.6, `rgba(${v},${v},${v},${0.3 + rng() * 0.4})`);
    });
  }
}

function drawCourseHeight(ctx, c) {
  const g = ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
  g.addColorStop(0, 'rgb(88,88,88)');
  g.addColorStop(0.25, 'rgb(120,120,120)');
  g.addColorStop(0.8, 'rgb(132,132,132)');
  g.addColorStop(1, 'rgb(96,96,96)');
  ctx.fillStyle = g;
  ctx.fillRect(0, c.y - 1, S, c.h + 2);

  for (const st of c.strands) {
    const hi = Math.round(176 + st.tone * 62);
    const padX = st.width + Math.abs(st.sway) + 10;
    const padY = st.len + 20;
    repeatDraw(ctx, S, S, st.x, st.y0, padX, padY, (cx) => {
      strokeStraw(cx, st.x, st.y0, st.len, st.sway, st.width + 0.7, `rgba(${hi},${hi},${hi},${0.55 + st.alpha * 0.4})`);
    });
  }
  for (const lo of c.loose) {
    const hi = Math.round(150 + lo.tone * 80);
    repeatDraw(ctx, S, S, lo.x, lo.y0, lo.width + Math.abs(lo.sway) + 10, lo.len + 16, (cx) => {
      strokeStraw(cx, lo.x, lo.y0, lo.len, lo.sway, lo.width, `rgba(${hi},${hi},${hi},${lo.alpha})`);
    });
  }
}

function drawBattenHeight(ctx, b) {
  // recessed shadow gap under the batten
  ctx.fillStyle = 'rgba(30,30,30,0.7)';
  for (let x = 0; x < S; x += 16) {
    const yc = battenColumnY(b, x);
    ctx.fillRect(x, yc + b.h * 0.42, 16.6, b.h * 1.15);
  }
  for (let x = 0; x < S; x += 16) {
    const yc = battenColumnY(b, x);
    const g = ctx.createLinearGradient(0, yc - b.h / 2, 0, yc + b.h / 2);
    g.addColorStop(0, 'rgb(168,168,168)');
    g.addColorStop(0.3, 'rgb(236,236,236)');
    g.addColorStop(0.55, 'rgb(214,214,214)');
    g.addColorStop(1, 'rgb(126,126,126)');
    ctx.fillStyle = g;
    ctx.fillRect(x, yc - b.h / 2, 16.6, b.h);
  }
  // lashings sit proud of the batten
  for (const l of b.lashings) {
    const yc = battenColumnY(b, l.x);
    const pad = l.w + 10;
    repeatDraw(ctx, S, S, l.x, yc, pad, pad, (cx) => {
      cx.strokeStyle = 'rgba(246,246,246,0.9)';
      cx.lineWidth = 3.2;
      cx.beginPath();
      cx.moveTo(l.x - l.w, yc - b.h * 0.75);
      cx.quadraticCurveTo(l.x + l.tilt * 6, yc, l.x + l.w, yc + b.h * 0.75);
      cx.stroke();
    });
  }
}

function drawStrayHeight(ctx, stray) {
  for (const s of stray) {
    const hi = Math.round(140 + s.tone * 90);
    repeatDraw(ctx, S, S, s.x, s.y, s.width + Math.abs(s.sway) + 12, s.len + 24, (cx) => {
      strokeStraw(cx, s.x, s.y, s.len, s.sway, s.width, `rgba(${hi},${hi},${hi},${s.alpha + 0.2})`);
    });
  }
}

// ---------------------------------------------------------------------------
// roughness
// ---------------------------------------------------------------------------

function drawCourseRough(ctx, c) {
  const v = Math.round(228 + (c.tone - 0.5) * 26);
  const g = ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
  g.addColorStop(0, `rgb(${v - 8},${v - 8},${v - 8})`);
  g.addColorStop(0.5, `rgb(${v},${v},${v})`);
  g.addColorStop(1, `rgb(${v - 4},${v - 4},${v - 4})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, c.y - 1, S, c.h + 2);
  // bleached / dusty straw catches light a little more smoothly
  const rng = makeRNG(c.seed + 21);
  for (let i = 0; i < 60; i++) {
    const x = rng() * S;
    const y = c.y + rng() * c.h;
    const r = 8 + rng() * 40;
    const a = 0.04 + rng() * 0.1;
    repeatDraw(ctx, S, S, x, y, r + 6, r + 6, (cx) => {
      const rg = cx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(120,120,120,${a})`);
      rg.addColorStop(1, 'rgba(120,120,120,0)');
      cx.fillStyle = rg;
      cx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
}

function drawBattenRough(ctx, b) {
  // old split bamboo is smoother than the straw around it
  for (let x = 0; x < S; x += 16) {
    const yc = battenColumnY(b, x);
    const g = ctx.createLinearGradient(0, yc - b.h / 2, 0, yc + b.h / 2);
    g.addColorStop(0, 'rgb(186,186,186)');
    g.addColorStop(0.45, 'rgb(204,204,204)');
    g.addColorStop(1, 'rgb(220,220,220)');
    ctx.fillStyle = g;
    ctx.fillRect(x, yc - b.h / 2, 16.6, b.h);
  }
}

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------
export function makeThatch(aniso, reg) {
  const { courses, battens, stray } = buildLayout();

  // ---- albedo -------------------------------------------------------------
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  drawFibrousBase(ctx);
  for (const c of courses) drawCourseAlbedo(ctx, c);
  for (const b of battens) drawBattenAlbedo(ctx, b);
  drawStrayAlbedo(ctx, stray);
  drawWeatherAlbedo(ctx);

  // ---- height -------------------------------------------------------------
  const height = el(HEIGHT_SIZE, HEIGHT_SIZE);
  const hctx = ctxOf(height);
  drawFibrousBaseHeight(hctx);
  for (const c of courses) drawCourseHeight(hctx, c);
  for (const b of battens) drawBattenHeight(hctx, b);
  drawStrayHeight(hctx, stray);
  overlayNoise(hctx, HEIGHT_SIZE, HEIGHT_SIZE, { tile: 256, seed: 703, alpha: 0.16, scale: 1, mode: 'overlay' });
  overlayGrain(hctx, HEIGHT_SIZE, HEIGHT_SIZE, { alpha: 0.1, seed: 704 });

  // ---- roughness ----------------------------------------------------------
  const rough = el(S, S);
  const rctx = ctxOf(rough);
  fillCanvas(rctx, S, S, 'rgb(236,236,236)');
  for (const c of courses) drawCourseRough(rctx, c);
  for (const b of battens) drawBattenRough(rctx, b);
  overlayNoise(rctx, S, S, { tile: 256, seed: 705, alpha: 0.1, scale: 1, mode: 'overlay' });
  overlayGrain(rctx, S, S, { alpha: 0.07, seed: 706 });

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, NORMAL_STRENGTH, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
