/**
 * SANDSTRIKE // palm trunk texture set  (lib.palmTrunk)
 *
 * Used by materials: palmTrunk (palm tree trunks).
 *
 * Date-palm trunk: the trunk is not bark but a column of persistent leaf bases
 * ("boots") that spiral up the stem. Each boot is a rough, wedge-shaped plate of
 * dried leaf-stalk fibre with a raised central ridge, ragged torn edges and a
 * frayed, straw-like fringe; the gaps between boots are deep, dark and packed
 * with loose fibre. Upper (newer) boots overlap the ones below, so the texture
 * is drawn bottom-up.
 *
 * For a CylinderGeometry(…, 7, 3) the UVs run u=0..1 once around the trunk and
 * v=0..1 bottom-to-top, so:
 *   - the pattern tiles seamlessly around the trunk (all draws wrap in X)
 *   - one texture height covers the whole trunk (~2.8 m → 12 boot rows)
 *
 * Texture set contract:
 *   map            albedo        sRGB
 *   normalMap      tangent space  linear (Sobel from a 1024px height canvas)
 *   roughnessMap   linear         (dry fibre ≈ 0.95, plate faces ≈ 0.8)
 *
 * Everything is drawn with Canvas2D at load time; tune the TUNING block below.
 */
import { makeRNG } from '../utils.js';
import { ctxOf, el, fillCanvas, normalFromHeightCanvas, overlayGrain, overlayNoise, textureFromCanvas } from './core.js';

// ---------------------------------------------------------------------------
// TUNING
// ---------------------------------------------------------------------------
const S = 1024;             // texture size (u = full circumference, v = full trunk height)
const HEIGHT_SIZE = 1024;
const NORMAL_STRENGTH = 2.7;

const COLS = 7;             // boot columns around the trunk
const ROWS = 11;            // boot rows over the trunk height

// weathered date-palm boot colours (warm straw / brown fibre)
const BOOT = { hue: 33, sat: 26, light: 40 };
const GAP = '#31241a';      // dried fibre / shadow deep between boots
const DRY_CHANCE = 0.3;     // pale, sun-bleached boots
const DARK_CHANCE = 0.26;   // older, dark fibre boots
const TORN_CHANCE = 0.35;   // boots with a chunk missing / deep notch
const MISSING_CHANCE = 0.03; // hollow where a boot has fallen away
const STRAY_FIBRES = 26;    // long loose fibres hanging over the seams

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

/** Run `fn(cx)` at x, and again shifted ±S when the plate crosses a seam. */
function atX(x, pad, fn) {
  fn(x);
  if (x < pad) fn(x + S);
  if (x > S - pad) fn(x - S);
}

/** Build the boot lattice, ordered bottom row → top row (top overlaps bottom). */
function buildBoots() {
  const rng = makeRNG(7311);
  const colW = S / COLS;
  const rowH = S / ROWS;
  const boots = [];
  for (let r = ROWS + 1; r >= -1; r--) {
    const y = (r + 0.5) * rowH + (rng() - 0.5) * rowH * 0.14;
    const shift = (Math.abs(r) % 2 ? colW * 0.5 : 0) + (rng() - 0.5) * colW * 0.16;
    for (let c = -1; c <= COLS; c++) {
      const x = c * colW + shift + (rng() - 0.5) * colW * 0.14;
      const hw = colW * (0.46 + rng() * 0.18);
      const h = rowH * (1.28 + rng() * 0.2);
      const dry = rng() < DRY_CHANCE;
      const dark = !dry && rng() < DARK_CHANCE;
      const missing = rng() < MISSING_CHANCE;
      boots.push({
        x,
        y,
        hw,
        h,
        seed: Math.floor(rng() * 1e9),
        row: r,
        dry,
        dark,
        missing,
        torn: rng() < TORN_CHANCE,
        tornSide: rng() > 0.5 ? 1 : -1,
        light: BOOT.light + (rng() - 0.5) * 14 + (dry ? 15 : 0) - (dark ? 13 : 0),
        sat: BOOT.sat + (rng() - 0.5) * 9 - (dry ? 8 : 0),
        hue: BOOT.hue + (rng() - 0.5) * 10,
        tilt: (rng() - 0.5) * 0.1,
      });
    }
  }
  return boots;
}

/**
 * Ragged boot outline: a wedge that is wide and flat-ish at the top (tucked
 * under the boot above), bulging at the shoulders and tapering to a torn tip.
 */
function bootPath(ctx, b) {
  const rng = makeRNG(b.seed + 1);
  const { x, hw, h } = b;
  const top = b.y - b.h * 0.22;
  const tilt = b.tilt;
  const N = 9;
  const left = [];
  const right = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // width profile: flat near the top, widest at the shoulders, tapering tip
    const prof = t < 0.18 ? 0.66 + (t / 0.18) * 0.28 : t < 0.55 ? 0.94 + ((t - 0.18) / 0.37) * 0.06 : 1.0 - ((t - 0.55) / 0.45) * 0.6;
    const w = hw * Math.max(0.1, prof) + (rng() - 0.5) * 3.4;
    const yy = top + h * t + (i === 0 || i === N ? 0 : (rng() - 0.5) * 4);
    const xx = x + yy * 0 + yy * 0 + tilt * h * t; // slight lean
    left.push([xx - w, yy]);
    right.push([xx + w, yy]);
  }
  // torn chunk: pull the outline inwards on one side
  if (b.torn) {
    const k = 3 + Math.floor(rng() * (N - 4));
    const side = b.tornSide > 0 ? right : left;
    const depth = (0.2 + rng() * 0.35) * hw * (side === right ? -1 : 1);
    side[k] = [side[k][0] + depth, side[k][1] + (rng() - 0.5) * 6];
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i <= N; i++) ctx.lineTo(left[i][0], left[i][1]);
  // torn bottom tip: a couple of jagged points
  ctx.lineTo(x + (rng() - 0.5) * hw * 0.5, top + h + 3 + rng() * 7);
  ctx.lineTo(x + (rng() - 0.5) * hw * 0.5, top + h * 0.98);
  for (let i = N; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// albedo
// ---------------------------------------------------------------------------
function drawBackground(ctx) {
  fillCanvas(ctx, S, S, GAP);
  const rng = makeRNG(5122);
  // packed dried fibre: short crinkly strokes in every direction
  for (let i = 0; i < 1100; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 8 + rng() * 40;
    const ang = (rng() - 0.5) * 1.1 + (rng() > 0.72 ? Math.PI * 0.5 : 0);
    const pale = rng() > 0.5;
    ctx.strokeStyle = pale
      ? `rgba(${168 + rng() * 54},${142 + rng() * 44},${100 + rng() * 36},${0.06 + rng() * 0.18})`
      : `rgba(${24 + rng() * 26},${16 + rng() * 18},${9 + rng() * 11},${0.14 + rng() * 0.24})`;
    ctx.lineWidth = 0.5 + rng() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(ang) * len * 0.5 + (rng() - 0.5) * 10,
      y + Math.sin(ang) * len * 0.5,
      x + Math.cos(ang) * len,
      y + Math.sin(ang) * len
    );
    ctx.stroke();
  }
  // a few pale dry tufts poking out of the mass
  for (let i = 0; i < 90; i++) {
    const x = rng() * S;
    const y = rng() * S;
    for (let k = 0; k < 5; k++) {
      const ang = rng() * Math.PI * 2;
      const len = 5 + rng() * 16;
      ctx.strokeStyle = `rgba(${196 + rng() * 46},${174 + rng() * 40},${132 + rng() * 36},${0.12 + rng() * 0.22})`;
      ctx.lineWidth = 0.5 + rng() * 0.9;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len * 0.8);
      ctx.stroke();
    }
  }
  overlayNoise(ctx, S, S, { tile: 256, seed: 21, alpha: 0.16, scale: 1, mode: 'overlay' });
}

function drawBootAlbedo(ctx, b) {
  const rng = makeRNG(b.seed + 3);
  const top = b.y - b.h * 0.22;
  const base = `hsl(${b.hue} ${b.sat}% ${b.light}%)`;

  if (b.missing) {
    // hollow boot: just a pile of exposed fibre where the plate fell away
    ctx.save();
    bootPath(ctx, b);
    ctx.clip();
    ctx.fillStyle = 'rgba(20,14,8,0.4)';
    ctx.fillRect(b.x - b.hw * 1.4, top - 8, b.hw * 2.8, b.h + 20);
    for (let i = 0; i < 26; i++) {
      const sx = b.x + (rng() - 0.5) * b.hw * 1.8;
      const sy = top + rng() * b.h;
      ctx.strokeStyle = `rgba(${150 + rng() * 60},${126 + rng() * 52},${88 + rng() * 40},${0.1 + rng() * 0.2})`;
      ctx.lineWidth = 0.5 + rng() * 1.4;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (rng() - 0.5) * 16, sy + (rng() - 0.5) * 22);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // the plate casts a soft shadow into the fibre gap below it (drawn first, so
  // the darker rim shows around the lower edge of the plate)
  ctx.save();
  bootPath(ctx, b);
  ctx.translate(2.4, 3.6);
  ctx.fillStyle = 'rgba(16,10,5,0.32)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  bootPath(ctx, b);
  ctx.clip();

  // vertical tone: shadowed under the boot above → lit mid → dusty lower tip
  const g = ctx.createLinearGradient(0, top, 0, top + b.h);  g.addColorStop(0, `hsl(${b.hue - 3} ${b.sat}% ${Math.max(12, b.light - 22)}%)`);
  g.addColorStop(0.18, base);
  g.addColorStop(0.6, `hsl(${b.hue} ${b.sat}% ${b.light + 5}%)`);
  g.addColorStop(1, `hsl(${b.hue - 2} ${b.sat + 2}% ${Math.max(16, b.light - 10)}%)`);
  ctx.fillStyle = g;
  ctx.fillRect(b.x - b.hw * 1.4, top - 8, b.hw * 2.8, b.h + 20);

  // longitudinal fibre grooves (along the leaf-stalk direction)
  for (let i = 0; i < 22; i++) {
    const sx = b.x + (rng() - 0.5) * b.hw * 0.8;
    const sy = top + b.h * (0.06 + rng() * 0.16);
    const ex = b.x + (rng() - 0.5) * b.hw * 2.2;
    const ey = top + b.h * (0.4 + rng() * 0.68);
    const lighter = rng() > 0.46;
    ctx.strokeStyle = lighter
      ? `rgba(${224 + rng() * 26},${202 + rng() * 28},${156 + rng() * 32},${0.06 + rng() * 0.14})`
      : `rgba(50,35,18,${0.06 + rng() * 0.16})`;
    ctx.lineWidth = 0.5 + rng() * 1.8;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo((sx + ex) * 0.5 + (rng() - 0.5) * 6, sy + (ey - sy) * 0.55, ex, ey);
    ctx.stroke();
  }
  // shorter cross fibres, so the plate is not cleanly striated
  for (let i = 0; i < 10; i++) {
    const sx = b.x + (rng() - 0.5) * b.hw * 1.7;
    const sy = top + b.h * (0.12 + rng() * 0.8);
    const len = 3 + rng() * 12;
    const down = rng() > 0.5 ? 1 : -1;
    ctx.strokeStyle = rng() > 0.5 ? `rgba(236,216,176,${0.04 + rng() * 0.09})` : `rgba(44,30,15,${0.04 + rng() * 0.1})`;
    ctx.lineWidth = 0.4 + rng() * 1.1;
    ctx.beginPath();
    ctx.moveTo(sx - len, sy - down * 2);
    ctx.lineTo(sx + len, sy + down * 2);
    ctx.stroke();
  }

  // raised central stalk ridge (remaining leaf-stalk), with a groove beside it
  const ridgeX = b.x + (rng() - 0.5) * b.hw * 0.3;
  ctx.strokeStyle = `rgba(226,200,158,${0.14 + rng() * 0.12})`;
  ctx.lineWidth = b.hw * (0.09 + rng() * 0.06);
  ctx.beginPath();
  ctx.moveTo(ridgeX, top + b.h * 0.05);
  ctx.quadraticCurveTo(ridgeX + (rng() - 0.5) * 10, top + b.h * 0.55, ridgeX + (rng() - 0.5) * 14, top + b.h * 0.92);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(44,30,16,0.22)';
  ctx.lineWidth = b.hw * 0.055;
  ctx.beginPath();
  ctx.moveTo(ridgeX + b.hw * 0.17, top + b.h * 0.1);
  ctx.lineTo(ridgeX + b.hw * 0.1, top + b.h * 0.86);
  ctx.stroke();

  // torn boot: a chunk ripped out showing the dark fibre underneath
  if (b.torn) {
    const tx = b.x + b.tornSide * b.hw * (0.6 + rng() * 0.2);
    const ty = top + b.h * (0.45 + rng() * 0.3);
    const tr = b.hw * (0.2 + rng() * 0.22);
    ctx.beginPath();
    ctx.moveTo(tx - tr, ty - tr * 0.8);
    ctx.lineTo(tx + tr * 0.8, ty - tr * 0.25);
    ctx.lineTo(tx + tr * 0.3, ty + tr * 0.9);
    ctx.lineTo(tx - tr * 0.9, ty + tr * 0.3);
    ctx.closePath();
    ctx.fillStyle = 'rgba(34,23,13,0.7)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(228,204,162,0.16)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  // freshly exposed pale fibre along the torn lower edge
  {
    const fb = ctx.createLinearGradient(0, top + b.h * 0.7, 0, top + b.h);
    fb.addColorStop(0, 'rgba(0,0,0,0)');
    fb.addColorStop(1, `rgba(${212 + rng() * 32},${190 + rng() * 26},${146 + rng() * 30},${0.15 + rng() * 0.12})`);
    ctx.fillStyle = fb;
    ctx.fillRect(b.x - b.hw * 1.4, top + b.h * 0.7, b.hw * 2.8, b.h * 0.36);
  }

  ctx.restore();

  // edge shading: dark under-lip (shadow onto the boot below), lit upper rim
  ctx.save();
  bootPath(ctx, b);
  ctx.translate(1.1, 2.2);
  ctx.strokeStyle = 'rgba(22,14,8,0.52)';
  ctx.lineWidth = 4.2;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  bootPath(ctx, b);
  ctx.strokeStyle = b.dry ? 'rgba(198,184,158,0.2)' : 'rgba(226,204,168,0.14)';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.restore();

  // frayed lower fringe: straw fibres hanging over the seam below
  const fy = top + b.h * 0.94;
  for (let i = 0; i < 26; i++) {
    const sx = b.x + (rng() - 0.5) * b.hw * 1.8;
    const len = 10 + rng() * 42;
    const ang = (rng() - 0.5) * 1.25 + Math.PI * 0.5;
    const pale = rng() > 0.3;
    ctx.strokeStyle = pale
      ? `rgba(${208 + rng() * 40},${184 + rng() * 34},${136 + rng() * 34},${0.32 + rng() * 0.5})`
      : `rgba(56,40,21,${0.32 + rng() * 0.42})`;
    ctx.lineWidth = 0.6 + rng() * 2.0;
    ctx.beginPath();
    ctx.moveTo(sx, fy + (rng() - 0.5) * 10);
    ctx.quadraticCurveTo(
      sx + Math.cos(ang) * len * 0.55 + (rng() - 0.5) * 9,
      fy + Math.sin(ang) * len * 0.5,
      sx + Math.cos(ang) * len,
      fy + Math.sin(ang) * len
    );
    ctx.stroke();
  }
}

/** Long loose fibres hanging over the seams, drawn after the boots. */
function drawStrayFibres(ctx) {
  const rng = makeRNG(9182);
  for (let i = 0; i < STRAY_FIBRES; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 60 + rng() * 230;
    const sway = (rng() - 0.5) * 70;
    const pale = rng() > 0.38;
    ctx.strokeStyle = pale
      ? `rgba(${196 + rng() * 46},${170 + rng() * 38},${122 + rng() * 36},${0.10 + rng() * 0.24})`
      : `rgba(38,26,14,${0.10 + rng() * 0.2})`;
    ctx.lineWidth = 0.5 + rng() * 1.2;
    atX(x, 140, (cx) => {
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.quadraticCurveTo(cx + sway * 0.5, y + len * 0.55, cx + sway, y + len);
      ctx.stroke();
    });
  }
}

// ---------------------------------------------------------------------------
// height
// ---------------------------------------------------------------------------
function drawBootHeight(ctx, b) {
  const rng = makeRNG(b.seed + 5);
  const top = b.y - b.h * 0.22;
  const hi = 198 + (b.dry ? 16 : 0) + (rng() - 0.5) * 28;
  const lo = 70 + rng() * 24;
  const mid = hi - 24;
  const g = ctx.createRadialGradient(
    b.x, top + b.h * 0.5, b.hw * 0.1,
    b.x, top + b.h * 0.5, Math.max(b.hw * 1.05, b.h * 0.62)
  );
  g.addColorStop(0, `rgb(${Math.round(hi)},${Math.round(hi)},${Math.round(hi)})`);
  g.addColorStop(0.55, `rgb(${Math.round(mid)},${Math.round(mid)},${Math.round(mid)})`);
  g.addColorStop(1, `rgb(${Math.round(lo)},${Math.round(lo)},${Math.round(lo)})`);
  ctx.save();
  bootPath(ctx, b);
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(b.x - b.hw * 1.4, top - 8, b.hw * 2.8, b.h + 20);

  // fibre grooves carved into the plate
  for (let i = 0; i < 26; i++) {
    const sx = b.x + (rng() - 0.5) * b.hw * 0.9;
    const sy = top + b.h * (0.05 + rng() * 0.18);
    const ex = b.x + (rng() - 0.5) * b.hw * 2.1;
    const ey = top + b.h * (0.4 + rng() * 0.66);
    ctx.strokeStyle = `rgba(22,22,22,${0.1 + rng() * 0.2})`;
    ctx.lineWidth = 1 + rng() * 2.6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo((sx + ex) * 0.5, sy + (ey - sy) * 0.55, ex, ey);
    ctx.stroke();
  }
  // raised stalk ridge
  ctx.strokeStyle = 'rgba(238,238,238,0.6)';
  ctx.lineWidth = b.hw * 0.13;
  ctx.beginPath();
  ctx.moveTo(b.x, top + b.h * 0.05);
  ctx.lineTo(b.x + b.tilt * b.h, top + b.h * 0.92);
  ctx.stroke();
  ctx.restore();

  // rounded edge falloff
  ctx.save();
  bootPath(ctx, b);
  ctx.strokeStyle = `rgba(42,42,42,${0.5 + rng() * 0.2})`;
  ctx.lineWidth = 5.5;
  ctx.stroke();
  ctx.restore();
}

function drawFringeHeight(ctx, b) {
  const rng = makeRNG(b.seed + 7);
  const top = b.y - b.h * 0.22;
  const fy = top + b.h * 0.94;
  for (let i = 0; i < 16; i++) {
    const sx = b.x + (rng() - 0.5) * b.hw * 1.7;
    const len = 8 + rng() * 30;
    const ang = (rng() - 0.5) * 1.2 + Math.PI * 0.5;
    const v = Math.round(110 + rng() * 70);
    ctx.strokeStyle = `rgb(${v},${v},${v})`;
    ctx.lineWidth = 1 + rng() * 1.7;
    ctx.beginPath();
    ctx.moveTo(sx, fy);
    ctx.quadraticCurveTo(sx + Math.cos(ang) * len * 0.5, fy + Math.sin(ang) * len * 0.5, sx + Math.cos(ang) * len, fy + Math.sin(ang) * len);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// roughness
// ---------------------------------------------------------------------------
function drawBootRough(ctx, b) {
  const rng = makeRNG(b.seed + 9);
  const top = b.y - b.h * 0.22;
  // dry boots are rougher, waxy/dark ones a little smoother
  const face = Math.round((b.dry ? 222 : b.dark ? 202 : 210) + (rng() - 0.5) * 22);
  const edge = Math.min(250, face + 24);
  const g = ctx.createRadialGradient(
    b.x, top + b.h * 0.5, b.hw * 0.1,
    b.x, top + b.h * 0.5, Math.max(b.hw * 1.05, b.h * 0.62)
  );
  g.addColorStop(0, `rgb(${face},${face},${face})`);
  g.addColorStop(1, `rgb(${edge},${edge},${edge})`);
  ctx.save();
  bootPath(ctx, b);
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(b.x - b.hw * 1.4, top - 8, b.hw * 2.8, b.h + 20);
  for (let i = 0; i < 16; i++) {
    const sx = b.x + (rng() - 0.5) * b.hw * 0.8;
    const sy = top + b.h * (0.1 + rng() * 0.2);
    const ex = b.x + (rng() - 0.5) * b.hw * 2;
    const ey = top + b.h * (0.5 + rng() * 0.55);
    const v = Math.round(face + (rng() - 0.5) * 36);
    ctx.strokeStyle = `rgba(${v},${v},${v},0.5)`;
    ctx.lineWidth = 1.4 + rng() * 2.6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------
export function makePalmTrunk(aniso, reg) {
  const boots = buildBoots();

  // ---- albedo -------------------------------------------------------------
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  drawBackground(ctx);
  for (const b of boots) atX(b.x, b.hw + 40, () => drawBootAlbedo(ctx, b));
  drawStrayFibres(ctx);
  // dust at the base of the trunk, sun-bleach at the top
  {
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, 'rgba(250,240,216,0.05)');
    g.addColorStop(0.82, 'rgba(92,70,44,0)');
    g.addColorStop(1, 'rgba(66,48,30,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  overlayNoise(ctx, S, S, { tile: 256, seed: 22, alpha: 0.13, scale: 1, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.13, seed: 23 });

  // ---- height -------------------------------------------------------------
  const height = el(HEIGHT_SIZE, HEIGHT_SIZE);
  const hctx = ctxOf(height);
  fillCanvas(hctx, HEIGHT_SIZE, HEIGHT_SIZE, 'rgb(40,40,40)');
  // loose fibre floor between the boots
  {
    const rng = makeRNG(6061);
    for (let i = 0; i < 1500; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const len = 8 + rng() * 30;
      const v = Math.round(36 + rng() * 46);
      hctx.strokeStyle = `rgb(${v},${v},${v})`;
      hctx.lineWidth = 1 + rng() * 2;
      hctx.beginPath();
      hctx.moveTo(x, y);
      hctx.lineTo(x + (rng() - 0.5) * len, y + len * 0.8);
      hctx.stroke();
    }
  }
  for (const b of boots) atX(b.x, b.hw + 40, () => drawBootHeight(hctx, b));
  for (const b of boots) atX(b.x, b.hw + 40, () => drawFringeHeight(hctx, b));
  overlayNoise(hctx, HEIGHT_SIZE, HEIGHT_SIZE, { tile: 256, seed: 24, alpha: 0.14, scale: 1, mode: 'overlay' });
  overlayGrain(hctx, HEIGHT_SIZE, HEIGHT_SIZE, { alpha: 0.10, seed: 25 });

  // ---- roughness ----------------------------------------------------------
  const rough = el(S, S);
  const rctx = ctxOf(rough);
  fillCanvas(rctx, S, S, 'rgb(244,244,244)'); // dry fibre gaps are rough
  for (const b of boots) atX(b.x, b.hw + 40, () => drawBootRough(rctx, b));
  overlayNoise(rctx, S, S, { tile: 256, seed: 26, alpha: 0.09, scale: 1, mode: 'overlay' });
  overlayGrain(rctx, S, S, { alpha: 0.07, seed: 27 });

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, NORMAL_STRENGTH, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
