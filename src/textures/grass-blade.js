/**
 * SANDSTRIKE // ground-cover blade atlas  (lib.grassBlade)
 *
 * Used by materials: grassBlade / grassBladeDry (alpha-tested ground-cover cards).
 *
 * WHY THIS ATLAS EXISTS
 * Audit pass-2 (D-08) put the ground read at "dark green noise + paper fans": the grass
 * tuft was built from 70+ individually warped single-leaf cards, and the terrain texture
 * alone carries no silhouette. One card here is a WHOLE TUFT — 15-24 tapered blades
 * fanning out of one root with real depth layering — so a handful of crossed cards reads
 * as a dense grass clump for ~2 triangles each.
 *
 * LAYOUT (fixed by src/models/world/island/leaf-atlas.js GRASS_CELLS — do not reorder):
 *
 *       u: 0            0.5           1
 *    v 0    +--------------+--------------+
 *          | tuft         | tuftTall     |   blades grow +V (root at cell bottom)
 *    v 0.5 +--------------+--------------+
 *          | tuftDry      | cover        |
 *    v 1    +--------------+--------------+
 *
 *    tuft     = dense short rainforest grass (12-18 cm blades)  -> main ground clump
 *    tuftTall = taller, finer, sparser blades (25-40 cm)        -> layering / pathsides
 *    tuftDry  = bleached straw tuft (thatch / dead grass)       -> litter accents
 *    cover    = low broadleaf ground cover (round leaves+moss)  -> bare-soil patches
 *
 * Authoring rules: same as canopy.js — transparent background, fully opaque blades,
 * >=6% cell margin (content is laid out relative to CELL so it never touches the guard),
 * RGB bled into the transparent ring, normal map baked from an alpha-blurred luminance.
 */
import { clamp, makeRNG } from '../utils.js';
import { TAU, ctxOf, el, normalFromHeightCanvas, textureFromCanvas } from './core.js';
import { bleedAlphaRgb, heightFromAlbedo } from './broadleaf.js';

const S = 1024;
const CELL = 512;
const PAD = 32; // ~6% of the cell
const NORMAL_STRENGTH = 2.2;

const GRASS_GREEN = { base: '#2f5226', mid: '#4d7a32', tip: '#7da34a', edge: '#22391b', high: '#93b25c' };
const GRASS_DEEP = { base: '#263f1e', mid: '#3d6329', tip: '#628a3b', edge: '#1a2c14', high: '#7d9c4e' };
const GRASS_DRY = { base: '#6a5a33', mid: '#8f7a45', tip: '#b8a066', edge: '#463a22', high: '#c9b478' };

function shiftHex(hex, mul) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * mul), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * mul), 0, 255);
  const b = clamp(Math.round((n & 255) * mul), 0, 255);
  return `rgb(${r},${g},${b})`;
}

/**
 * One tapered, bowed blade. Root at (x, y), grows towards `ang` (radians, -PI/2 = up),
 * bows by `bend` and tapers to a point.
 */
function drawBlade(ctx, { x, y, len, ang, bend, width, palette, rng, dryTip = 0, alpha = 1 }) {
  const segs = 9;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const nx = -dy; // blade-face normal in 2D (for width)
  const ny = dx;
  const left = [];
  const right = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const bow = bend * Math.sin(Math.PI * t);
    const cx = x + dx * len * t + nx * bow;
    const cy = y + dy * len * t + ny * bow;
    const w = width * 0.5 * Math.pow(1 - t, 0.7) * (0.75 + 0.25 * Math.min(1, t / 0.12));
    left.push([cx + nx * w, cy + ny * w]);
    right.push([cx - nx * w, cy - ny * w]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i <= segs; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = segs; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();

  const tipX = x + dx * len;
  const tipY = y + dy * len;
  const g = ctx.createLinearGradient(x, y, tipX, tipY);
  g.addColorStop(0, shiftHex(palette.base, 0.92 + rng() * 0.1));
  g.addColorStop(0.45, shiftHex(palette.mid, 0.94 + rng() * 0.12));
  g.addColorStop(1, shiftHex(palette.tip, 0.96 + rng() * 0.14));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fill();

  // a lighter ridge down one side, so a fan of blades still separates at distance
  ctx.strokeStyle = palette.high;
  ctx.globalAlpha = alpha * 0.12;
  ctx.lineWidth = Math.max(1, width * 0.16);
  ctx.beginPath();
  ctx.moveTo(x + nx * width * 0.16, y + ny * width * 0.16);
  ctx.quadraticCurveTo(
    x + dx * len * 0.5 + nx * (bend * 0.8 + width * 0.12),
    y + dy * len * 0.5 + ny * (bend * 0.8 + width * 0.12),
    tipX, tipY
  );
  ctx.stroke();

  // darker silhouette edge
  ctx.strokeStyle = palette.edge;
  ctx.globalAlpha = alpha * 0.36;
  ctx.lineWidth = Math.max(0.8, width * 0.1);
  ctx.stroke();

  // dry tip (old blades)
  if (dryTip > 0) {
    const dg = ctx.createLinearGradient(x + dx * len * 0.55, y + dy * len * 0.55, tipX, tipY);
    dg.addColorStop(0, 'rgba(150,120,60,0)');
    dg.addColorStop(1, `rgba(158,126,62,${0.5 * dryTip})`);
    ctx.fillStyle = dg;
    ctx.globalAlpha = alpha;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** A whole tuft: blades rooted in a small disc, fanned out, painted back-to-front. */
function drawTuft(ctx, { cx, cy, blades, lenMin, lenMax, width, palette, seed, spread = 0.55, dryTip = 0, tall = false }) {
  const rng = makeRNG(seed);
  const order = [];
  for (let i = 0; i < blades; i++) {
    const t = blades === 1 ? 0.5 : i / (blades - 1);
    const ang = -Math.PI / 2 + (t - 0.5) * 2 * spread + (rng() - 0.5) * 0.16;
    const len = (lenMin + rng() * (lenMax - lenMin)) * (tall ? 0.9 + 0.2 * rng() : 1);
    order.push({
      ang, len,
      x: cx + (rng() - 0.5) * CELL * 0.05,
      y: cy + (rng() - 0.5) * CELL * 0.02,
      bend: (rng() - 0.5) * len * 0.34,
      width: width * (0.72 + rng() * 0.55),
      palette: rng() < 0.22 ? GRASS_DEEP : palette,
      dryTip: dryTip * rng(),
      alpha: 0.9 + rng() * 0.1,
      z: rng(),
    });
  }
  // back (darker, slightly shorter) blades first, front bright ones last
  order.sort((a, b) => a.z - b.z);
  for (const b of order) {
    const p = b.z < 0.34 ? GRASS_DEEP : b.palette;
    drawBlade(ctx, { ...b, palette: p, rng });
  }
}

// ---------------------------------------------------------------------------
// cells (all coordinates are CELL-relative so the 6% mip guard is never touched)
// ---------------------------------------------------------------------------

function drawTuftCell(ctx) {
  drawTuft(ctx, {
    cx: CELL * 0.5, cy: CELL * 0.9, blades: 22,
    lenMin: CELL * 0.44, lenMax: CELL * 0.7, width: CELL * 0.058,
    palette: GRASS_GREEN, seed: 611, spread: 0.52,
  });
}

function drawTallCell(ctx) {
  drawTuft(ctx, {
    cx: CELL * 0.5, cy: CELL * 0.92, blades: 15,
    lenMin: CELL * 0.6, lenMax: CELL * 0.74, width: CELL * 0.042,
    palette: { ...GRASS_GREEN, mid: '#4a7630', tip: '#86ac52' },
    seed: 733, spread: 0.5, tall: true,
  });
}

function drawDryCell(ctx) {
  drawTuft(ctx, {
    cx: CELL * 0.5, cy: CELL * 0.9, blades: 16,
    lenMin: CELL * 0.42, lenMax: CELL * 0.66, width: CELL * 0.05,
    palette: GRASS_DRY, seed: 877, spread: 0.58, dryTip: 0.9,
  });
}

/** Low broadleaf ground cover: moss cushion + round leaves + a couple of blades. */
function drawCoverCell(ctx) {
  const rng = makeRNG(941);
  const cx = CELL * 0.5;
  const cy = CELL * 0.82;
  // moss cushion
  for (let i = 0; i < 26; i++) {
    const a = rng() * TAU;
    const rr = Math.pow(rng(), 0.6) * CELL * 0.22;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.42;
    const r = CELL * (0.026 + rng() * 0.055);
    const g = ctx.createRadialGradient(x, y - r * 0.3, 0, x, y, r);
    const tone = shiftHex(rng() < 0.4 ? '#3c5c2c' : '#547a35', 0.82 + rng() * 0.36);
    g.addColorStop(0, tone);
    g.addColorStop(1, 'rgba(30,48,22,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // round ground leaves
  for (let i = 0; i < 11; i++) {
    const a = rng() * TAU;
    const rr = CELL * (0.05 + Math.pow(rng(), 0.7) * 0.2);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.5;
    const len = CELL * (0.09 + rng() * 0.075);
    const wid = len * (0.62 + rng() * 0.16);
    const ang = rng() * TAU;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.ellipse(len * 0.5, 0, len * 0.5, wid * 0.5, 0, 0, TAU);
    const g = ctx.createLinearGradient(0, -wid * 0.5, len, wid * 0.5);
    g.addColorStop(0, '#3b5c28');
    g.addColorStop(0.6, '#5d8a38');
    g.addColorStop(1, '#7fa84e');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(34,55,22,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len * 0.9, 0);
    ctx.strokeStyle = 'rgba(196,220,140,0.28)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }
  // a few blades pushing through
  drawTuft(ctx, {
    cx, cy: cy + CELL * 0.03, blades: 6,
    lenMin: CELL * 0.24, lenMax: CELL * 0.4, width: CELL * 0.034,
    palette: GRASS_DEEP, seed: 977, spread: 0.75,
  });
}

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------

function withCell(ctx, ox, oy, fn) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, CELL, CELL);
  ctx.clip();
  ctx.translate(ox, oy);
  ctx.beginPath();
  ctx.rect(PAD, PAD, CELL - PAD * 2, CELL - PAD * 2);
  ctx.clip();
  fn(ctx);
  ctx.restore();
}

export function makeGrassBlade(aniso, reg) {
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  withCell(ctx, 0, 0, drawTuftCell);
  withCell(ctx, CELL, 0, drawTallCell);
  withCell(ctx, 0, CELL, drawDryCell);
  withCell(ctx, CELL, CELL, drawCoverCell);

  bleedAlphaRgb(albedo, 8);
  const height = heightFromAlbedo(albedo);

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, NORMAL_STRENGTH, aniso)),
  };
}

export default makeGrassBlade;
