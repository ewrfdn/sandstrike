/**
 * SANDSTRIKE // tropical bark texture set  (lib.tropicalBark)
 *
 * Used by materials: barkTrop / barkMoss  (jungle tree trunks, mossy logs)
 *
 * Wet lowland rainforest bark: tall vertical fissures split the trunk into
 * bulging plates, horizontal lenticels (breathing pores) band the plates, and
 * moss colonises the damp fissures and the shaded side. The morning humidity is
 * painted in as vertical wet streaks that stay glossier (lower roughness) than
 * the dry bark.
 *
 * 1 tile = 2.5 m. UV convention: V runs up the trunk, U around it, both wrap.
 *
 * Texture set contract:
 *   map            albedo        sRGB
 *   normalMap      tangent space  linear (Sobel from a 1024px height canvas)
 *   roughnessMap   linear
 *
 * Everything here is drawn with Canvas2D at load time; tune the TUNING block.
 */
import { clamp, makeRNG } from '../utils.js';
import { TAU, ctxOf, el, fillCanvas, normalFromHeightCanvas, overlayGrain, overlayNoise, textureFromCanvas } from './core.js';

// ---------------------------------------------------------------------------
// TUNING
// ---------------------------------------------------------------------------
const S = 1024;             // texture size (1 tile = 2.5 m)
const HEIGHT_SIZE = 1024;
const NORMAL_STRENGTH = 3.1;

const FISSURES = 15;        // major vertical cracks across the tile
const GRAIN_STROKES = 1250; // fine vertical bark fibre
const CROSS_CRACKS = 190;   // short horizontal checks inside each plate
const LENTICELS = 150;      // breathing pores
const MOSS_PATCHES = 11;
const WET_STREAKS = 14;

// colour script (ISLAND_ASSETS.md §1.2: trunk #4a3f30 + moss #5b6b3a)
const BARK = [74, 63, 48];
const BARK_DARK = [38, 31, 22];
const BARK_LIGHT = [118, 100, 74];
const CRACK = [15, 11, 7];
const LENTICEL = [132, 116, 90];
const WET = [32, 28, 22];
const BLEACH = [140, 124, 96];

const MOSS_TONES = [
  { dark: [34, 48, 26], mid: [62, 88, 46], light: [94, 120, 56] }, // deep damp moss
  { dark: [48, 58, 28], mid: [84, 100, 46], light: [122, 132, 58] }, // yellow-green moss
  { dark: [30, 45, 30], mid: [56, 80, 50], light: [84, 108, 62] }, // cool shaded moss
];

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

// ---------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------
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

/** Horizontal position of a fissure at height t in [0,1]. */
function fissureX(c, t, dx = 0) {
  return c.x
    + Math.sin(TAU * (c.k1 * t + c.p1)) * c.a1
    + Math.sin(TAU * (c.k2 * t + c.p2)) * c.a2
    + dx;
}

/** Trace a fissure as a smooth polyline; the harmonics are integral in t so the
 *  crack is continuous across the V tile border. */
function fissurePath(ctx, c, dx = 0, step = 12) {
  ctx.beginPath();
  for (let y = 0; y <= S; y += step) {
    const x = fissureX(c, y / S, dx);
    if (y === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------
function buildLayout() {
  const rng = makeRNG(5150);
  const fissures = [];
  const colW = S / FISSURES;
  for (let i = 0; i < FISSURES; i++) {
    const r = makeRNG(Math.floor(rng() * 1e9) + 17);
    fissures.push({
      x: (i + 0.16 + rng() * 0.68) * colW,
      a1: 3 + r() * 9,
      k1: 1 + Math.floor(r() * 2),
      p1: r() * TAU,
      a2: 1.2 + r() * 3.6,
      k2: 3 + Math.floor(r() * 4),
      p2: r() * TAU,
      width: 2.2 + r() * 8.5,
      dark: 0.62 + r() * 0.34,
      side: r() > 0.5 ? 1 : -1,
      lip: 0.16 + r() * 0.3,
      mossy: r() < 0.55,
      seed: Math.floor(r() * 1e9),
    });
  }
  fissures.sort((a, b) => a.x - b.x);

  // bulging bark plates between neighbouring fissures
  const plates = [];
  for (let i = 0; i < fissures.length; i++) {
    const x0 = fissures[i].x;
    const a = fissures[i];
    const bFiss = fissures[(i + 1) % fissures.length];
    const x1 = i === fissures.length - 1 ? bFiss.x + S : bFiss.x;
    const gap = Math.max(20, x1 - x0);
    const pr = makeRNG(Math.floor(rng() * 1e9) + 31);
    const count = 2 + Math.floor(pr() * 2);
    for (let k = 0; k < count; k++) {
      plates.push({
        x: ((x0 + x1) * 0.5 + (pr() - 0.5) * gap * 0.55 + S) % S,
        y: pr() * S,
        rx: gap * (0.42 + pr() * 0.34),
        ry: 80 + pr() * 150,
        tone: pr(),
        seed: Math.floor(pr() * 1e9),
      });
    }
    void a;
  }

  // short side cracks branching off the fissures
  const branches = [];
  for (const f of fissures) {
    const br = makeRNG(f.seed + 5);
    const n = br() < 0.6 ? 1 + Math.floor(br() * 3) : 0;
    for (let k = 0; k < n; k++) {
      const t = br();
      branches.push({
        x: fissureX(f, t),
        y: t * S,
        len: 18 + br() * 70,
        dir: br() > 0.5 ? 1 : -1,
        drop: 12 + br() * 60,
        width: 0.8 + br() * 2.2,
        seed: Math.floor(br() * 1e9),
      });
    }
  }

  // horizontal lenticels, loosely banded
  const lenticels = [];
  const lrng = makeRNG(7332);
  let ly = lrng() * 90;
  while (ly < S) {
    const count = 2 + Math.floor(lrng() * 4);
    for (let k = 0; k < count; k++) {
      lenticels.push({
        x: lrng() * S,
        y: ly + (lrng() - 0.5) * 26,
        w: 5 + lrng() * 17,
        h: 1.5 + lrng() * 3.1,
        tilt: (lrng() - 0.5) * 0.5,
        tone: lrng(),
      });
    }
    ly += 56 + lrng() * 112;
  }

  // moss colonies
  const patches = [];
  const mrng = makeRNG(8841);
  for (let i = 0; i < MOSS_PATCHES; i++) {
    const tone = MOSS_TONES[Math.floor(mrng() * MOSS_TONES.length)];
    patches.push({
      x: mrng() * S,
      y: mrng() * S,
      r: 75 + mrng() * 185,
      tone,
      clumps: 90 + Math.floor(mrng() * 90),
      seed: Math.floor(mrng() * 1e9),
      glow: mrng(),
    });
  }

  // wet streaks
  const streaks = [];
  const wrng = makeRNG(9911);
  for (let i = 0; i < WET_STREAKS; i++) {
    streaks.push({
      x: wrng() * S,
      y: wrng() * S * 0.7,
      len: 140 + wrng() * 460,
      w: 8 + wrng() * 34,
      a: 0.05 + wrng() * 0.11,
      seed: Math.floor(wrng() * 1e9),
    });
  }

  return { fissures, plates, branches, lenticels, patches, streaks };
}

// ---------------------------------------------------------------------------
// albedo
// ---------------------------------------------------------------------------
function drawPlateLumps(ctx, plates) {
  for (const p of plates) {
    const rng = makeRNG(p.seed);
    const light = mix(mix(BARK, BARK_LIGHT, 0.55), [152, 134, 102], p.tone * 0.4);
    repeatDraw(ctx, S, S, p.x, p.y, p.rx + 10, p.ry + 10, (cx) => {
      // lit crown of the bark plate
      const g = cx.createRadialGradient(p.x - p.rx * 0.1, p.y - p.ry * 0.1, 0, p.x, p.y, Math.max(p.rx, p.ry));
      g.addColorStop(0, css(light, 0.2 + rng() * 0.14));
      g.addColorStop(0.65, css(light, 0.08));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.save();
      cx.translate(p.x, p.y);
      cx.scale(1, p.ry / Math.max(p.rx, 1));
      cx.translate(-p.x, -p.y);
      cx.fillStyle = g;
      cx.fillRect(p.x - p.rx, p.y - p.rx, p.rx * 2, p.rx * 2);
      cx.restore();
      // shadow gathers in the lower half of the plate
      const g2 = cx.createRadialGradient(p.x + p.rx * 0.15, p.y + p.ry * 0.55, 0, p.x, p.y + p.ry * 0.55, p.rx * 1.05);
      g2.addColorStop(0, `rgba(20,15,9,${0.1 + rng() * 0.12})`);
      g2.addColorStop(1, 'rgba(20,15,9,0)');
      cx.save();
      cx.translate(p.x, p.y);
      cx.scale(1, p.ry / Math.max(p.rx, 1));
      cx.translate(-p.x, -p.y);
      cx.fillStyle = g2;
      cx.fillRect(p.x - p.rx, p.y - p.rx, p.rx * 2, p.rx * 2);
      cx.restore();
    });
  }
}

function drawBarkGrain(ctx) {
  const rng = makeRNG(2216);
  for (let i = 0; i < GRAIN_STROKES; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 16 + rng() * 110;
    const sway = (rng() - 0.5) * 7;
    const light = rng() > 0.5;
    const c = light ? mix(BARK, BARK_LIGHT, 0.4 + rng() * 0.6) : mix(BARK, BARK_DARK, 0.35 + rng() * 0.65);
    const width = 0.5 + rng() * 1.9;
    const a = 0.13 + rng() * 0.34;
    repeatDraw(ctx, S, S, x, y, 8, len + 10, (cx) => {
      cx.strokeStyle = css(c, a);
      cx.lineWidth = width;
      cx.lineCap = 'round';
      cx.beginPath();
      cx.moveTo(x, y);
      cx.quadraticCurveTo(x + sway, y + len * 0.5, x + sway * 1.6, y + len);
      cx.stroke();
    });
  }
  // vertical fibre bundles: long faint ridges
  for (let i = 0; i < 70; i++) {
    const x = rng() * S;
    const k = 1 + Math.floor(rng() * 3);
    const ph = rng() * TAU;
    const amp = 2 + rng() * 7;
    const light = rng() > 0.45;
    ctx.strokeStyle = light
      ? `rgba(150,130,100,${0.04 + rng() * 0.07})`
      : `rgba(28,22,14,${0.05 + rng() * 0.08})`;
    ctx.lineWidth = 2 + rng() * 7;
    ctx.beginPath();
    for (let y = 0; y <= S; y += 16) {
      const xx = x + Math.sin(TAU * ((y / S) * k) + ph) * amp;
      if (y === 0) ctx.moveTo(xx, y);
      else ctx.lineTo(xx, y);
    }
    ctx.stroke();
  }
}

function drawCrossCracks(ctx) {
  const rng = makeRNG(3921);
  for (let i = 0; i < CROSS_CRACKS; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 6 + rng() * 46;
    const drop = (rng() - 0.5) * 14;
    const a = 0.12 + rng() * 0.3;
    repeatDraw(ctx, S, S, x, y, len + 4, 14, (cx) => {
      cx.strokeStyle = `rgba(20,15,9,${a})`;
      cx.lineWidth = 0.7 + rng() * 1.5;
      cx.beginPath();
      cx.moveTo(x - len * 0.5, y);
      cx.quadraticCurveTo(x, y + drop, x + len * 0.5, y + drop * 0.4);
      cx.stroke();
      cx.strokeStyle = `rgba(140,122,94,${a * 0.6})`;
      cx.lineWidth = 0.7;
      cx.beginPath();
      cx.moveTo(x - len * 0.5, y + 1.1);
      cx.lineTo(x + len * 0.5, y + drop * 0.4 + 1.1);
      cx.stroke();
    });
  }
}

function drawFissures(ctx, fissures, branches) {
  for (const f of fissures) {
    const pad = f.a1 + f.a2 + f.width * 2 + 12;
    repeatDraw(ctx, S, S, f.x, S * 0.5, pad, 0, (cx) => {
      // broad soft shadow in the crack mouth
      cx.lineJoin = 'round';
      cx.lineCap = 'round';
      cx.strokeStyle = `rgba(24,18,11,0.22)`;
      cx.lineWidth = f.width * 2.4;
      fissurePath(cx, f);
      cx.stroke();
      // dark core
      cx.strokeStyle = css(CRACK, 0.55 + f.dark * 0.4);
      cx.lineWidth = f.width;
      fissurePath(cx, f);
      cx.stroke();
      // lit lip on one side of the split plate
      cx.strokeStyle = css(mix(BARK_LIGHT, BLEACH, 0.3), f.lip);
      cx.lineWidth = 1.2 + f.width * 0.22;
      fissurePath(cx, f, f.side * (f.width * 0.5 + 1.6));
      cx.stroke();
      // opposite side falls into shadow
      cx.strokeStyle = 'rgba(20,14,8,0.3)';
      cx.lineWidth = 2.4;
      fissurePath(cx, f, -f.side * (f.width * 0.5 + 1.2));
      cx.stroke();
    });
  }

  // branches
  const rng = makeRNG(6161);
  for (const b of branches) {
    repeatDraw(ctx, S, S, b.x, b.y, b.len + 8, 8, (cx) => {
      cx.strokeStyle = `rgba(23,17,10,${0.3 + rng() * 0.3})`;
      cx.lineWidth = b.width;
      cx.beginPath();
      cx.moveTo(b.x, b.y);
      cx.quadraticCurveTo(b.x + b.dir * b.len * 0.5, b.y + b.drop * 0.25, b.x + b.dir * b.len, b.y + b.drop * 0.6);
      cx.stroke();
      cx.strokeStyle = `rgba(140,120,92,0.14)`;
      cx.lineWidth = 1;
      cx.beginPath();
      cx.moveTo(b.x, b.y + 1.4);
      cx.quadraticCurveTo(b.x + b.dir * b.len * 0.5, b.y + b.drop * 0.25 + 1.4, b.x + b.dir * b.len, b.y + b.drop * 0.6 + 1.4);
      cx.stroke();
    });
  }
}

function drawLenticels(ctx, lenticels) {
  for (const l of lenticels) {
    const base = mix(LENTICEL, [166, 148, 116], l.tone);
    repeatDraw(ctx, S, S, l.x, l.y, l.w + 8, l.h + 8, (cx) => {
      cx.save();
      cx.translate(l.x, l.y);
      cx.rotate(l.tilt);
      cx.fillStyle = css(mix(base, BARK_DARK, 0.18), 0.82);
      cx.beginPath();
      cx.ellipse(0, 0, l.w * 0.5, l.h * 0.5, 0, 0, TAU);
      cx.fill();
      cx.fillStyle = css(mix(base, BLEACH, 0.45), 0.55);
      cx.beginPath();
      cx.ellipse(-0.5, -0.6, l.w * 0.38, l.h * 0.3, 0, 0, TAU);
      cx.fill();
      cx.strokeStyle = 'rgba(22,16,10,0.5)';
      cx.lineWidth = 1.1;
      cx.beginPath();
      cx.ellipse(0, 1.1, l.w * 0.5, l.h * 0.5, 0, 0.15, Math.PI - 0.15);
      cx.stroke();
      cx.restore();
    });
  }
}

function drawMossPatches(ctx, patches) {
  for (const p of patches) {
    const rng = makeRNG(p.seed);
    const pad = p.r * 1.3 + 12;
    repeatDraw(ctx, S, S, p.x, p.y, pad, pad, (cx) => {
      // dark damp base the moss sits in
      const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 1.15);
      g.addColorStop(0, css(mix(p.tone.dark, BARK_DARK, 0.35), 0.42));
      g.addColorStop(0.6, css(p.tone.dark, 0.22));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g;
      cx.fillRect(p.x - p.r * 1.2, p.y - p.r * 1.2, p.r * 2.4, p.r * 2.4);

      // clumps: dense core of tiny overlapping cushions
      for (let i = 0; i < p.clumps; i++) {
        const rad = p.r * Math.sqrt(rng()) * 1.02;
        const ang = rng() * TAU;
        const x = p.x + Math.cos(ang) * rad;
        const y = p.y + Math.sin(ang) * rad * 0.86;
        const size = (2.5 + rng() * 19) * (1 - (rad / p.r) * 0.3);
        const t = clamp(0.3 + rng() * 0.8 - (rad / p.r) * 0.3, 0, 1);
        const col = t < 0.45
          ? mix(p.tone.dark, p.tone.mid, t * 2.2)
          : mix(p.tone.mid, p.tone.light, (t - 0.45) * 1.8);
        cx.fillStyle = css(mix(col, BARK_DARK, 0.25), 0.24 + rng() * 0.38);
        cx.beginPath();
        cx.ellipse(x, y, size, size * (0.55 + rng() * 0.5), rng() * TAU, 0, TAU);
        cx.fill();
        cx.fillStyle = css(mix(col, BARK_DARK, 0.2), 0.1 + rng() * 0.2);
        cx.beginPath();
        cx.ellipse(x - size * 0.18, y - size * 0.18, size * 0.55, size * 0.3, rng() * TAU, 0, TAU);
        cx.fill();
      }
      // fine velvety fibre around the cushions
      for (let i = 0; i < 90; i++) {
        const rad = p.r * Math.sqrt(rng()) * 1.05;
        const ang = rng() * TAU;
        const x = p.x + Math.cos(ang) * rad;
        const y = p.y + Math.sin(ang) * rad * 0.86;
        const len = 2 + rng() * 9;
        const a2 = rng() * TAU;
        const col = rng() > 0.4 ? p.tone.light : p.tone.dark;
        cx.strokeStyle = css(col, 0.12 + rng() * 0.26);
        cx.lineWidth = 0.7;
        cx.beginPath();
        cx.moveTo(x, y);
        cx.lineTo(x + Math.cos(a2) * len, y + Math.sin(a2) * len);
        cx.stroke();
      }
      // lit crown / bright moss tips
      for (let i = 0; i < Math.round(p.clumps * 0.4); i++) {
        const rad = p.r * Math.sqrt(rng()) * 0.9;
        const ang = rng() * TAU;
        const x = p.x + Math.cos(ang) * rad;
        const y = p.y + Math.sin(ang) * rad * 0.86;
        const size = 0.7 + rng() * 2.6;
        cx.fillStyle = css(mix(p.tone.light, BLEACH, rng() * 0.5), 0.08 + rng() * 0.24);
        cx.beginPath();
        cx.arc(x, y, size, 0, TAU);
        cx.fill();
      }
      // dark gaps between cushions
      for (let i = 0; i < 30; i++) {
        const rad = p.r * Math.sqrt(rng()) * 0.9;
        const ang = rng() * TAU;
        cx.fillStyle = `rgba(12,18,8,${0.12 + rng() * 0.26})`;
        cx.beginPath();
        cx.arc(p.x + Math.cos(ang) * rad, p.y + Math.sin(ang) * rad * 0.86, 1.2 + rng() * 5, 0, TAU);
        cx.fill();
      }
    });
  }
}

function drawMossInCracks(ctx, fissures) {
  const rng = makeRNG(4770);
  for (const f of fissures) {
    if (!f.mossy) continue;
    const n = 3 + Math.floor(rng() * 5);
    for (let k = 0; k < n; k++) {
      const t = rng();
      const x = fissureX(f, t) + (rng() - 0.5) * f.width * 2.2;
      const y = t * S;
      const tone = MOSS_TONES[Math.floor(rng() * MOSS_TONES.length)];
      const r = 4 + rng() * 13;
      repeatDraw(ctx, S, S, x, y, r + 6, 0, (cx) => {
        const g = cx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, css(tone.mid, 0.5));
        g.addColorStop(0.7, css(tone.dark, 0.3));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        cx.fillStyle = g;
        cx.fillRect(x - r, y - r, r * 2, r * 2);
      });
    }
  }
}

function drawWet(ctx, streaks) {
  const rng = makeRNG(3170);
  for (const s of streaks) {
    repeatDraw(ctx, S, S, s.x, s.y + s.len * 0.5, s.w + 20, s.len * 0.5 + 40, (cx) => {
      const g = cx.createLinearGradient(s.x, s.y, s.x, s.y + s.len);
      g.addColorStop(0, 'rgba(26,23,18,0)');
      g.addColorStop(0.3, `rgba(26,23,18,${s.a})`);
      g.addColorStop(0.8, `rgba(26,23,18,${s.a * 0.7})`);
      g.addColorStop(1, 'rgba(26,23,18,0)');
      cx.strokeStyle = g;
      cx.lineWidth = s.w;
      cx.beginPath();
      cx.moveTo(s.x, s.y);
      cx.lineTo(s.x + (rng() - 0.5) * 14, s.y + s.len);
      cx.stroke();
      // thin specular sheen inside the wet band
      cx.strokeStyle = `rgba(150,160,150,${s.a * 0.5})`;
      cx.lineWidth = 1.1;
      cx.beginPath();
      cx.moveTo(s.x - s.w * 0.22, s.y + s.len * 0.15);
      cx.lineTo(s.x - s.w * 0.22 + (rng() - 0.5) * 8, s.y + s.len * 0.8);
      cx.stroke();
    });
  }
}

function drawBleach(ctx) {
  const rng = makeRNG(1501);
  for (let i = 0; i < 9; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 100 + rng() * 260;
    const a = 0.03 + rng() * 0.05;
    repeatDraw(ctx, S, S, x, y, r + 8, r + 8, (cx) => {
      const g = cx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, css(BLEACH, a));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g;
      cx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
}

// ---------------------------------------------------------------------------
// height
// ---------------------------------------------------------------------------
function drawHeightPlates(ctx, plates) {
  for (const p of plates) {
    const hi = Math.round(148 + p.tone * 46);
    repeatDraw(ctx, S, S, p.x, p.y, p.rx + 10, p.ry + 10, (cx) => {
      cx.save();
      cx.translate(p.x, p.y);
      cx.scale(1, p.ry / Math.max(p.rx, 1));
      const g = cx.createRadialGradient(0, 0, 0, 0, 0, p.rx);
      g.addColorStop(0, `rgb(${hi},${hi},${hi})`);
      g.addColorStop(0.7, `rgb(${hi - 14},${hi - 14},${hi - 14})`);
      g.addColorStop(1, 'rgba(110,110,110,0)');
      cx.fillStyle = g;
      cx.fillRect(-p.rx, -p.rx, p.rx * 2, p.rx * 2);
      cx.restore();
    });
  }
}

function drawHeightGrain(ctx) {
  const rng = makeRNG(2216);
  for (let i = 0; i < 600; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 16 + rng() * 110;
    const sway = (rng() - 0.5) * 7;
    const v = Math.round(112 + rng() * 70);
    repeatDraw(ctx, S, S, x, y, 8, len + 10, (cx) => {
      cx.strokeStyle = `rgba(${v},${v},${v},${0.16 + rng() * 0.24})`;
      cx.lineWidth = 0.7 + rng() * 2;
      cx.lineCap = 'round';
      cx.beginPath();
      cx.moveTo(x, y);
      cx.quadraticCurveTo(x + sway, y + len * 0.5, x + sway * 1.6, y + len);
      cx.stroke();
    });
  }
  for (let i = 0; i < 70; i++) {
    const x = rng() * S;
    const k = 1 + Math.floor(rng() * 3);
    const ph = rng() * TAU;
    const amp = 2 + rng() * 7;
    const light = rng() > 0.45;
    ctx.strokeStyle = light ? `rgba(210,210,210,${0.06 + rng() * 0.1})` : `rgba(70,70,70,${0.08 + rng() * 0.12})`;
    ctx.lineWidth = 2 + rng() * 7;
    ctx.beginPath();
    for (let y = 0; y <= S; y += 16) {
      const xx = x + Math.sin(TAU * ((y / S) * k) + ph) * amp;
      if (y === 0) ctx.moveTo(xx, y);
      else ctx.lineTo(xx, y);
    }
    ctx.stroke();
  }
}

function drawHeightFissures(ctx, fissures, branches) {
  for (const f of fissures) {
    const pad = f.a1 + f.a2 + f.width * 2 + 12;
    repeatDraw(ctx, S, S, f.x, S * 0.5, pad, 0, (cx) => {
      cx.lineJoin = 'round';
      cx.lineCap = 'round';
      cx.strokeStyle = 'rgba(40,40,40,0.35)';
      cx.lineWidth = f.width * 2.6;
      fissurePath(cx, f);
      cx.stroke();
      cx.strokeStyle = `rgba(22,22,22,${0.75 + f.dark * 0.25})`;
      cx.lineWidth = f.width;
      fissurePath(cx, f);
      cx.stroke();
      cx.strokeStyle = 'rgba(226,226,226,0.5)';
      cx.lineWidth = 1.4 + f.width * 0.2;
      fissurePath(cx, f, f.side * (f.width * 0.5 + 1.8));
      cx.stroke();
    });
  }
  const rng = makeRNG(6161);
  for (const b of branches) {
    repeatDraw(ctx, S, S, b.x, b.y, b.len + 8, 8, (cx) => {
      cx.strokeStyle = `rgba(60,60,60,${0.4 + rng() * 0.25})`;
      cx.lineWidth = Math.max(1, b.width);
      cx.beginPath();
      cx.moveTo(b.x, b.y);
      cx.quadraticCurveTo(b.x + b.dir * b.len * 0.5, b.y + b.drop * 0.25, b.x + b.dir * b.len, b.y + b.drop * 0.6);
      cx.stroke();
    });
  }
}

function drawHeightLenticels(ctx, lenticels) {
  for (const l of lenticels) {
    repeatDraw(ctx, S, S, l.x, l.y, l.w + 8, l.h + 8, (cx) => {
      cx.save();
      cx.translate(l.x, l.y);
      cx.rotate(l.tilt);
      cx.fillStyle = `rgba(236,236,236,0.72)`;
      cx.beginPath();
      cx.ellipse(0, 0, l.w * 0.5, l.h * 0.5, 0, 0, TAU);
      cx.fill();
      cx.strokeStyle = 'rgba(70,70,70,0.4)';
      cx.lineWidth = 1;
      cx.beginPath();
      cx.ellipse(0, 1.1, l.w * 0.5, l.h * 0.5, 0, 0.15, Math.PI - 0.15);
      cx.stroke();
      cx.restore();
    });
  }
}

function drawHeightMoss(ctx, patches, fissures) {
  for (const p of patches) {
    const rng = makeRNG(p.seed + 3);
    const pad = p.r * 1.3 + 12;
    repeatDraw(ctx, S, S, p.x, p.y, pad, pad, (cx) => {
      for (let i = 0; i < Math.round(p.clumps * 0.8); i++) {
        const rad = p.r * Math.sqrt(rng()) * 1.0;
        const ang = rng() * TAU;
        const x = p.x + Math.cos(ang) * rad;
        const y = p.y + Math.sin(ang) * rad * 0.86;
        const size = (2.5 + rng() * 14) * (1 - (rad / p.r) * 0.3);
        const v = Math.round(150 + rng() * 46);
        cx.fillStyle = `rgba(${v},${v},${v},${0.3 + rng() * 0.3})`;
        cx.beginPath();
        cx.ellipse(x, y, size, size * (0.6 + rng() * 0.45), rng() * TAU, 0, TAU);
        cx.fill();
      }
    });
  }
  const rng = makeRNG(4770);
  for (const f of fissures) {
    if (!f.mossy) continue;
    const n = 3 + Math.floor(rng() * 5);
    for (let k = 0; k < n; k++) {
      const t = rng();
      const x = fissureX(f, t) + (rng() - 0.5) * f.width * 2.2;
      const y = t * S;
      const r = 4 + rng() * 13;
      repeatDraw(ctx, S, S, x, y, r + 6, 0, (cx) => {
        const g = cx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(200,200,200,0.4)');
        g.addColorStop(1, 'rgba(200,200,200,0)');
        cx.fillStyle = g;
        cx.fillRect(x - r, y - r, r * 2, r * 2);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// roughness
// ---------------------------------------------------------------------------
function drawRoughPlates(ctx, plates) {
  for (const p of plates) {
    const v = Math.round(224 + (p.tone - 0.5) * 30);
    repeatDraw(ctx, S, S, p.x, p.y, p.rx + 10, p.ry + 10, (cx) => {
      cx.save();
      cx.translate(p.x, p.y);
      cx.scale(1, p.ry / Math.max(p.rx, 1));
      const g = cx.createRadialGradient(0, 0, 0, 0, 0, p.rx);
      g.addColorStop(0, `rgb(${v},${v},${v})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g;
      cx.fillRect(-p.rx, -p.rx, p.rx * 2, p.rx * 2);
      cx.restore();
    });
  }
}

function drawRoughMoss(ctx, patches) {
  for (const p of patches) {
    const pad = p.r * 1.25 + 10;
    repeatDraw(ctx, S, S, p.x, p.y, pad, pad, (cx) => {
      const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, 'rgba(252,252,252,0.9)');
      g.addColorStop(0.7, 'rgba(252,252,252,0.6)');
      g.addColorStop(1, 'rgba(252,252,252,0)');
      cx.fillStyle = g;
      cx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    });
  }
}

function drawRoughWet(ctx, streaks) {
  const rng = makeRNG(3170);
  for (const s of streaks) {
    repeatDraw(ctx, S, S, s.x, s.y + s.len * 0.5, s.w + 20, s.len * 0.5 + 40, (cx) => {
      const g = cx.createLinearGradient(s.x, s.y, s.x, s.y + s.len);
      g.addColorStop(0, 'rgba(110,110,110,0)');
      g.addColorStop(0.35, `rgba(110,110,110,${0.5 + s.a * 2})`);
      g.addColorStop(0.8, `rgba(110,110,110,${0.4 + s.a})`);
      g.addColorStop(1, 'rgba(110,110,110,0)');
      cx.strokeStyle = g;
      cx.lineWidth = s.w * 0.8;
      cx.beginPath();
      cx.moveTo(s.x, s.y);
      cx.lineTo(s.x + (rng() - 0.5) * 14, s.y + s.len);
      cx.stroke();
    });
  }
}

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------
export function makeTropicalBark(aniso, reg) {
  const { fissures, plates, branches, lenticels, patches, streaks } = buildLayout();

  // ---- albedo -------------------------------------------------------------
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  fillCanvas(ctx, S, S, css(mix(BARK, BARK_LIGHT, 0.18)));
  // broad trunk shading: shaded side vs. lit side (periodic, no seam)
  {
    const g = ctx.createLinearGradient(0, 0, S, 0);
    g.addColorStop(0, 'rgba(16,12,7,0.28)');
    g.addColorStop(0.35, 'rgba(16,12,7,0.05)');
    g.addColorStop(0.7, css(BARK_LIGHT, 0.1));
    g.addColorStop(1, 'rgba(16,12,7,0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  drawPlateLumps(ctx, plates);
  drawBarkGrain(ctx);
  drawCrossCracks(ctx);
  drawFissures(ctx, fissures, branches);
  drawLenticels(ctx, lenticels);
  drawMossPatches(ctx, patches);
  drawMossInCracks(ctx, fissures);
  drawWet(ctx, streaks);
  drawBleach(ctx);
  overlayNoise(ctx, S, S, { tile: 256, seed: 811, alpha: 0.16, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.12, seed: 812 });

  // ---- height -------------------------------------------------------------
  const height = el(HEIGHT_SIZE, HEIGHT_SIZE);
  const hctx = ctxOf(height);
  fillCanvas(hctx, HEIGHT_SIZE, HEIGHT_SIZE, 'rgb(120,120,120)');
  drawHeightPlates(hctx, plates);
  drawHeightGrain(hctx);
  drawHeightFissures(hctx, fissures, branches);
  drawHeightLenticels(hctx, lenticels);
  drawHeightMoss(hctx, patches, fissures);
  overlayNoise(hctx, HEIGHT_SIZE, HEIGHT_SIZE, { tile: 256, seed: 813, alpha: 0.15, scale: 1, mode: 'overlay' });
  overlayGrain(hctx, HEIGHT_SIZE, HEIGHT_SIZE, { alpha: 0.1, seed: 814 });

  // ---- roughness ----------------------------------------------------------
  const rough = el(S, S);
  const rctx = ctxOf(rough);
  fillCanvas(rctx, S, S, 'rgb(232,232,232)');
  drawRoughPlates(rctx, plates);
  drawRoughMoss(rctx, patches);
  drawRoughWet(rctx, streaks);
  overlayNoise(rctx, S, S, { tile: 256, seed: 815, alpha: 0.1, scale: 1, mode: 'overlay' });
  overlayGrain(rctx, S, S, { alpha: 0.07, seed: 816 });

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, NORMAL_STRENGTH, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
