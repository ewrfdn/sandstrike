/**
 * SANDSTRIKE // broadleaf alpha atlas  (lib.broadleaf)
 *
 * Used by materials: broadleaf / broadleafDark (alpha-tested leaf cards)
 *
 * ONE 1024x1024 atlas shared by every island flora leaf card. The cell layout is
 * fixed by src/models/world/island/leaf-atlas.js (and ISLAND_ASSETS.md 3.1):
 *
 *       u: 0            0.5           1
 *    v 0    +--------------+--------------+
 *          | broad        | banana       |   leaf blades point +U (tip on the right)
 *    v 0.5 +--------------+--------------+
 *          | fern         | vine         |
 *    v 1    +--------------+--------------+
 *
 * Authoring rules honoured here:
 *   - background is fully transparent, leaf pixels are fully opaque (alphaTest 0.4);
 *     every cell keeps a ~5% empty margin so mip filtering never bleeds a
 *     neighbouring cell into the silhouette;
 *   - RGB is bled a few pixels out into the transparent ring (alpha stays 0) so
 *     mip filtering / MSAA cannot produce dark halos along the leaf edge;
 *   - veins are painted as a dark groove + a light raised ridge, plus insect holes
 *     and dew beads;
 *   - normalMap comes from an alpha-blurred + luminance height bake of the finished
 *     albedo, so relief and painted veins are always in register and the silhouette
 *     edge fades smoothly (no hard normal rim).
 *
 * Everything here is drawn with Canvas2D at load time.
 */
import { clamp, makeRNG } from '../utils.js';
import { TAU, ctxOf, el, normalFromHeightCanvas, textureFromCanvas } from './core.js';

const S = 1024;
const CELL = 512;
const NORMAL_STRENGTH = 3.0;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function withCell(ctx, ox, oy, fn) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, CELL, CELL);
  ctx.clip();
  ctx.translate(ox, oy);
  fn(ctx);
  ctx.restore();
}

/** Dew bead: soft wet bloom, dark contact edge + hot specular pixel. */
export function drawDew(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.1);
  g.addColorStop(0, 'rgba(236,250,222,0.34)');
  g.addColorStop(0.45, 'rgba(206,236,186,0.13)');
  g.addColorStop(1, 'rgba(206,236,186,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
  ctx.fillStyle = 'rgba(18,30,14,0.24)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.3, y + r * 0.5, r * 0.78, r * 0.55, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(248,255,240,0.9)';
  ctx.beginPath();
  ctx.arc(x - r * 0.32, y - r * 0.34, Math.max(0.7, r * 0.4), 0, TAU);
  ctx.fill();
}

/** Irregular insect hole: necrotic brown rim, then a truly transparent bite. */
export function punchHole(ctx, x, y, r, seed) {
  const rng = makeRNG(seed);
  const pts = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = r * (0.62 + rng() * 0.55);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * (0.75 + rng() * 0.35)]);
  }
  // necrotic ring in the leaf around the bite
  const grad = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.9);
  grad.addColorStop(0, 'rgba(88,68,30,0.55)');
  grad.addColorStop(0.55, 'rgba(116,96,44,0.30)');
  grad.addColorStop(1, 'rgba(116,96,44,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.9, 0, TAU);
  ctx.fill();
  // punch the hole itself (alpha = 0)
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
}

/**
 * Bleed albedo RGB outwards into the transparent ring (alpha stays 0) so mip
 * filtering never drags black air into the leaf edge. Frontier BFS, cheap.
 */
export function bleedAlphaRgb(canvas, maxPasses = 7) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = ctxOf(canvas);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const state = new Uint8Array(w * h); // 0 = opaque, 1 = transparent, 2 = bled
  const alphaOf = (i) => d[i * 4 + 3];
  for (let i = 0; i < w * h; i++) state[i] = alphaOf(i) > 8 ? 0 : 1;

  let frontier = [];
  const pushNeighbors = (idx, out) => {
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) out.push(idx - 1);
    if (x < w - 1) out.push(idx + 1);
    if (y > 0) out.push(idx - w);
    if (y < h - 1) out.push(idx + w);
  };
  const isSource = (idx) => state[idx] === 0 || state[idx] === 2;

  // seed: transparent pixels touching opaque ones
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (state[idx] !== 1) continue;
      let touch = false;
      if (x > 0 && state[idx - 1] === 0) touch = true;
      else if (x < w - 1 && state[idx + 1] === 0) touch = true;
      else if (y > 0 && state[idx - w] === 0) touch = true;
      else if (y < h - 1 && state[idx + w] === 0) touch = true;
      if (touch) frontier.push(idx);
    }
  }

  for (let pass = 0; pass < maxPasses && frontier.length; pass++) {
    const next = [];
    for (const idx of frontier) {
      if (state[idx] !== 1) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const x = idx % w;
      const y = (idx - x) / w;
      if (x > 0 && isSource(idx - 1)) { r += d[(idx - 1) * 4]; g += d[(idx - 1) * 4 + 1]; b += d[(idx - 1) * 4 + 2]; n++; }
      if (x < w - 1 && isSource(idx + 1)) { r += d[(idx + 1) * 4]; g += d[(idx + 1) * 4 + 1]; b += d[(idx + 1) * 4 + 2]; n++; }
      if (y > 0 && isSource(idx - w)) { r += d[(idx - w) * 4]; g += d[(idx - w) * 4 + 1]; b += d[(idx - w) * 4 + 2]; n++; }
      if (y < h - 1 && isSource(idx + w)) { r += d[(idx + w) * 4]; g += d[(idx + w) * 4 + 1]; b += d[(idx + w) * 4 + 2]; n++; }
      if (!n) continue;
      d[idx * 4] = r / n;
      d[idx * 4 + 1] = g / n;
      d[idx * 4 + 2] = b / n;
      state[idx] = 2;
      pushNeighbors(idx, next);
    }
    frontier = next.filter((idx) => state[idx] === 1);
  }
  ctx.putImageData(img, 0, 0);
}

/** Alpha-blurred + luminance height bake (feathered silhouette, veins as grooves). */
export function heightFromAlbedo(albedo) {
  const w = albedo.width;
  const h = albedo.height;
  const src = ctxOf(albedo).getImageData(0, 0, w, h).data;
  const n = w * h;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = src[i * 4 + 3] / 255;
  // separable box blur (radius 2) so the silhouette edge has no hard normal step
  const tmp = new Float32Array(n);
  const R = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let k = -R; k <= R; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w) continue;
        sum += alpha[y * w + xx];
        count++;
      }
      tmp[y * w + x] = sum / count;
    }
  }
  const out = el(w, h);
  const octx = ctxOf(out);
  const img = octx.createImageData(w, h);
  const d = img.data;
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let k = -R; k <= R; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        sum += tmp[yy * w + x];
        count++;
      }
      const a = sum / count;
      const j = (y * w + x) * 4;
      const lum = (src[j] * 0.299 + src[j + 1] * 0.587 + src[j + 2] * 0.114) / 255;
      // silhouette lifted, painted luminance (veins / mottling) as fine relief
      const hv = 0.30 + 0.44 * Math.pow(a, 0.72) + (lum - 0.5) * 0.62 * a;
      const g = clamp(hv, 0, 1) * 255;
      d[i++] = g;
      d[i++] = g;
      d[i++] = g;
      d[i++] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------
// cell 1: broad — rounded jungle broadleaf (tip at +U)
// ---------------------------------------------------------------------------

/** half width of the broad blade at parameter s (0 base .. 1 tip) */
function broadHalf(s) {
  const H = 186;
  let hw = H * Math.pow(Math.sin(Math.PI * s), 0.60);
  hw *= 1 + 0.055 * Math.sin(s * Math.PI * 7 + 0.6) + 0.028 * Math.sin(s * Math.PI * 16 + 2.2);
  hw *= 1 - 0.16 * s;
  if (s > 0.9) hw *= Math.pow((1 - s) / 0.1, 0.85);
  if (s < 0.05) hw *= Math.pow(s / 0.05, 0.42);
  return hw;
}

function drawBroadCell(ctx) {
  const x0 = 44;
  const x1 = 478;
  const cy = 252;
  const N = 46;
  const left = [];
  const right = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const x = x0 + (x1 - x0) * s;
    const hw = broadHalf(s);
    left.push([x, cy - hw]);
    right.push([x, cy + hw]);
  }
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
  };

  // petiole stub (inside the cell margin)
  ctx.strokeStyle = '#42592c';
  ctx.lineWidth = 6.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(30, cy + 8);
  ctx.quadraticCurveTo(38, cy + 4, 48, cy);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150,178,96,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // blade base colour (deep saturated jungle green, lighter toward the tip)
  path();
  const grad = ctx.createLinearGradient(x0, cy, x1, cy);
  grad.addColorStop(0, '#2d5f2e');
  grad.addColorStop(0.35, '#387036');
  grad.addColorStop(0.72, '#43813b');
  grad.addColorStop(1, '#52913f');
  ctx.fillStyle = grad;
  ctx.fill();

  // everything below is painted inside the silhouette only
  ctx.save();
  path();
  ctx.clip();

  // waxy sheen along the belly of the leaf
  {
    const g = ctx.createRadialGradient(x0 + 150, cy - 60, 10, x0 + 200, cy - 30, 290);
    g.addColorStop(0, 'rgba(150,196,110,0.20)');
    g.addColorStop(0.6, 'rgba(120,170,92,0.06)');
    g.addColorStop(1, 'rgba(20,44,18,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CELL, CELL);
  }
  // mottled variegation
  const mrng = makeRNG(4101);
  for (let i = 0; i < 16; i++) {
    const mx = x0 + mrng() * (x1 - x0);
    const my = cy + (mrng() * 2 - 1) * 150;
    const mr = 24 + mrng() * 70;
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
    g.addColorStop(0, mrng() > 0.5 ? 'rgba(164,208,118,0.11)' : 'rgba(16,42,16,0.13)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  }
  // dry / weathered edge near the tip
  {
    const g = ctx.createLinearGradient(x1 - 130, 0, x1, 0);
    g.addColorStop(0, 'rgba(148,134,74,0)');
    g.addColorStop(1, 'rgba(148,134,74,0.20)');
    ctx.fillStyle = g;
    ctx.fillRect(x1 - 130, 0, 130, CELL);
  }

  // mid rib: dark groove + lit ridge
  const midY = (x) => cy - 11 * Math.sin(Math.PI * clamp((x - x0) / (x1 - x0), 0, 1));
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(18,46,18,0.55)';
  ctx.lineWidth = 5.5;
  ctx.beginPath();
  ctx.moveTo(x0 - 2, cy);
  for (let x = x0 + 10; x <= x1; x += 10) ctx.lineTo(x, midY(x));
  ctx.stroke();
  ctx.strokeStyle = 'rgba(176,212,126,0.5)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x0, cy - 2);
  for (let x = x0 + 10; x <= x1; x += 10) ctx.lineTo(x, midY(x) - 2);
  ctx.stroke();

  // lateral veins: dark groove + offset light ridge, fanning toward the tip
  const vrng = makeRNG(4127);
  for (let v = 0; v < 12; v++) {
    const s = 0.10 + (v / 11) * 0.74;
    const x = x0 + (x1 - x0) * s;
    const hw = broadHalf(s);
    if (hw < 14) continue;
    for (const dir of [-1, 1]) {
      const ex = x + hw * (0.55 + vrng() * 0.22) + 26;
      const ey = cy + dir * hw * (0.80 + vrng() * 0.12);
      const cxv = x + (ex - x) * 0.52;
      const cyv = midY(x) + dir * hw * (0.26 + vrng() * 0.12);
      ctx.strokeStyle = 'rgba(16,44,16,0.36)';
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.moveTo(x, midY(x));
      ctx.quadraticCurveTo(cxv, cyv, ex, ey);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(178,214,130,0.26)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(x, midY(x) - 1.2);
      ctx.quadraticCurveTo(cxv, cyv - 1.2, ex, ey - 1.2);
      ctx.stroke();
    }
  }
  // fine tertiary network (barely there, kills the "flat gradient" look)
  const trng = makeRNG(4159);
  ctx.strokeStyle = 'rgba(22,54,20,0.13)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 90; i++) {
    const x = x0 + 40 + trng() * (x1 - x0 - 70);
    const y = cy + (trng() * 2 - 1) * 150;
    const a = trng() * TAU;
    const len = 8 + trng() * 22;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }

  // inner rim: shadowed edge + a thin lit sun-catching rim on the top edge
  path();
  ctx.strokeStyle = 'rgba(14,34,12,0.45)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(196,226,148,0.22)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // insect holes
  punchHole(ctx, 206, cy - 74, 9, 5501);
  punchHole(ctx, 312, cy + 68, 11, 5502);
  punchHole(ctx, 388, cy - 34, 6, 5503);
  punchHole(ctx, 158, cy + 52, 5, 5504);

  // dew beads
  drawDew(ctx, 250, cy - 118, 3.4);
  drawDew(ctx, 268, cy - 108, 2.1);
  drawDew(ctx, 352, cy + 96, 3.0);
  drawDew(ctx, 180, cy + 20, 2.6);
  drawDew(ctx, 430, cy - 60, 2.4);
  drawDew(ctx, 300, cy + 40, 1.8);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// cell 2: banana — long paddle leaf with torn slits (tip at +U)
// ---------------------------------------------------------------------------

function bananaHalf(s) {
  const H = 122;
  let hw = H * Math.pow(Math.sin(Math.PI * s), 0.46);
  hw *= 1 - 0.10 * s;
  if (s > 0.93) hw *= Math.pow((1 - s) / 0.07, 0.9);
  if (s < 0.05) hw *= Math.pow(s / 0.05, 0.36);
  return hw;
}

function drawBananaCell(ctx) {
  const x0 = 42;
  const x1 = 482;
  const cy = 256;
  const N = 52;
  const left = [];
  const right = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const x = x0 + (x1 - x0) * s;
    const hw = bananaHalf(s);
    left.push([x, cy - hw]);
    right.push([x, cy + hw]);
  }
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
  };

  // thick petiole at the base
  ctx.strokeStyle = '#5d7038';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(30, cy + 4);
  ctx.lineTo(48, cy + 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(178,196,112,0.5)';
  ctx.lineWidth = 2.4;
  ctx.stroke();

  // blade: brighter, yellower green than the broad leaf
  path();
  const grad = ctx.createLinearGradient(x0, cy, x1, cy);
  grad.addColorStop(0, '#3c7433');
  grad.addColorStop(0.45, '#4a873a');
  grad.addColorStop(1, '#66a044');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.save();
  path();
  ctx.clip();

  // long parallel light / dark striations along the blade
  for (let i = 0; i < 22; i++) {
    const y = cy + ((clamp(i / 21, 0, 1) * 2 - 1) * 112);
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(196,224,140,0.10)' : 'rgba(22,50,16,0.09)';
    ctx.lineWidth = 2 + (i % 4);
    ctx.beginPath();
    ctx.moveTo(x0 + 20, y);
    ctx.quadraticCurveTo((x0 + x1) / 2, y * 0.98, x1 - 10, y * 0.9);
    ctx.stroke();
  }

  // mid rib, strong and pale
  ctx.strokeStyle = 'rgba(28,58,20,0.5)';
  ctx.lineWidth = 6.5;
  ctx.beginPath();
  ctx.moveTo(x0 - 2, cy + 2);
  ctx.quadraticCurveTo((x0 + x1) / 2, cy - 8, x1, cy + 4);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(198,222,146,0.55)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x0, cy - 1.4);
  ctx.quadraticCurveTo((x0 + x1) / 2, cy - 11.4, x1, cy + 0.6);
  ctx.stroke();

  // parallel lateral veins: from the rib diagonally toward the tip
  for (let i = 0; i < 30; i++) {
    const s = 0.06 + (i / 29) * 0.88;
    const x = x0 + (x1 - x0) * s;
    const hw = bananaHalf(s);
    if (hw < 8) continue;
    for (const dir of [-1, 1]) {
      ctx.strokeStyle = 'rgba(20,48,16,0.24)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, cy + dir * 4);
      ctx.quadraticCurveTo(x + 18, cy + dir * hw * 0.55, x + 34, cy + dir * hw * 0.98);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(190,222,140,0.16)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + 1.2, cy + dir * 4 - 1.2);
      ctx.quadraticCurveTo(x + 19, cy + dir * hw * 0.55 - 1.2, x + 35, cy + dir * hw * 0.98 - 1.2);
      ctx.stroke();
    }
  }

  // brown, sun-dried patches around the tears
  const trng = makeRNG(6601);
  for (const t of [{ s: 0.15, dir: -1 }, { s: 0.36, dir: 1 }, { s: 0.55, dir: -1 }, { s: 0.75, dir: 1 }]) {
    const x = x0 + (x1 - x0) * t.s;
    const hw = bananaHalf(t.s);
    const g = ctx.createRadialGradient(x, cy + t.dir * hw * 0.8, 0, x, cy + t.dir * hw * 0.8, 24 + trng() * 22);
    g.addColorStop(0, 'rgba(150,132,66,0.42)');
    g.addColorStop(0.6, 'rgba(138,120,58,0.18)');
    g.addColorStop(1, 'rgba(138,120,58,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 50, cy - 140, 100, 280);
  }

  // inner edges
  path();
  ctx.strokeStyle = 'rgba(16,36,12,0.45)';
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(206,232,158,0.20)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // real torn slits: cut thin wedges from the margin toward the rib (banana leaves
  // split along their veins), plus a couple of nibbled edge bites
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const tears = [
    { s: 0.15, dir: -1, deep: 0.84 },
    { s: 0.36, dir: 1, deep: 0.78 },
    { s: 0.55, dir: -1, deep: 0.88 },
    { s: 0.75, dir: 1, deep: 0.72 },
  ];
  for (const t of tears) {
    const x = x0 + (x1 - x0) * t.s;
    const hw = bananaHalf(t.s);
    const edgeY = cy + t.dir * hw;
    const deepY = cy + t.dir * hw * (1 - t.deep);
    ctx.beginPath();
    ctx.moveTo(x - 3.2, edgeY + t.dir * 4);
    ctx.lineTo(x + 2.6, edgeY - t.dir * 1);
    ctx.lineTo(x + 11 + t.deep * 8, deepY);
    ctx.closePath();
    ctx.fillStyle = '#000';
    ctx.fill();
  }
  // nibbled bites out of the margin
  for (const b of [{ s: 0.25, dir: 1, r: 9 }, { s: 0.44, dir: -1, r: 7 }, { s: 0.66, dir: 1, r: 8 }]) {
    const x = x0 + (x1 - x0) * b.s;
    const hw = bananaHalf(b.s);
    ctx.beginPath();
    ctx.arc(x, cy + b.dir * hw, b.r, 0, TAU);
    ctx.fillStyle = '#000';
    ctx.fill();
  }
  ctx.restore();

  punchHole(ctx, 288, cy - 46, 6, 6701);
  punchHole(ctx, 380, cy + 40, 7, 6702);

  drawDew(ctx, 200, cy - 78, 3.2);
  drawDew(ctx, 214, cy - 66, 1.9);
  drawDew(ctx, 330, cy + 74, 2.7);
  drawDew(ctx, 420, cy - 40, 2.3);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// cell 3: fern — pinnate frond, rachis left->right, tip at +U
// ---------------------------------------------------------------------------

function drawFernCell(ctx) {
  const P0 = [34, 302];
  const C = [252, 296];
  const P1 = [462, 220];
  const rachis = [];
  const RN = 40;
  for (let i = 0; i <= RN; i++) {
    const t = i / RN;
    const u = 1 - t;
    rachis.push([
      u * u * P0[0] + 2 * u * t * C[0] + t * t * P1[0],
      u * u * P0[1] + 2 * u * t * C[1] + t * t * P1[1],
    ]);
  }
  const tangentAt = (t) => {
    const i = Math.max(1, Math.min(RN - 1, Math.round(t * RN)));
    const a = rachis[i - 1];
    const b = rachis[i + 1];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  const pointAt = (t) => {
    const i = Math.max(0, Math.min(RN, Math.round(t * RN)));
    return rachis[i];
  };

  // rachis
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#3c5e26';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(rachis[0][0], rachis[0][1]);
  for (let i = 1; i < rachis.length; i++) ctx.lineTo(rachis[i][0], rachis[i][1]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(164,196,108,0.42)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(rachis[0][0], rachis[0][1] - 1.4);
  for (let i = 1; i < rachis.length; i++) ctx.lineTo(rachis[i][0], rachis[i][1] - 1.4);
  ctx.stroke();

  // pinnae: 16 pairs shrinking toward the tip
  const pairs = 16;
  const prng = makeRNG(8801);
  for (let i = 0; i < pairs; i++) {
    const t = 0.055 + (i / (pairs - 1)) * 0.90;
    const [bx, by] = pointAt(t);
    const th = tangentAt(t);
    const shrink = Math.pow(Math.sin(Math.PI * Math.min(1, t + 0.04)), 0.62) * (1 - 0.16 * t);
    const len = 20 + 92 * shrink;
    const wid = Math.max(3.6, len * 0.19);
    for (const dir of [-1, 1]) {
      const ang = th + dir * (0.92 + 0.16 * Math.sin(t * Math.PI * 1.7 + (dir > 0 ? 0 : 1.1)));
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const nx = -sin;
      const ny = cos;
      // pinna blade polygon (lobed outline suggests the pinnules)
      const step = 12;
      const A = [];
      const B = [];
      for (let k = 0; k <= step; k++) {
        const s = k / step;
        let hw = wid * Math.pow(Math.sin(Math.PI * s), 0.55);
        hw *= 1 + 0.28 * Math.sin(s * Math.PI * 7 + (i % 2) * 0.5);
        hw = Math.max(0.35, hw);
        const px = bx + cos * len * s;
        const py = by + sin * len * s;
        A.push([px + nx * hw, py + ny * hw]);
        B.push([px - nx * hw, py - ny * hw]);
      }
      ctx.beginPath();
      ctx.moveTo(A[0][0], A[0][1]);
      for (let k = 1; k < A.length; k++) ctx.lineTo(A[k][0], A[k][1]);
      for (let k = B.length - 1; k >= 0; k--) ctx.lineTo(B[k][0], B[k][1]);
      ctx.closePath();
      const hue = 96 + prng() * 18 + (1 - t) * 8;
      const sat = 34 + prng() * 16;
      const lit = 20 + (1 - t) * 8 + prng() * 8;
      const g = ctx.createLinearGradient(bx, by, bx + cos * len, by + sin * len);
      g.addColorStop(0, `hsl(${hue - 6}, ${sat}%, ${Math.max(14, lit - 5)}%)`);
      g.addColorStop(0.6, `hsl(${hue}, ${sat + 6}%, ${lit + 4}%)`);
      g.addColorStop(1, `hsl(${hue + 10}, ${sat + 10}%, ${lit + 12}%)`);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(18,38,12,0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // pinna mid vein
      ctx.strokeStyle = 'rgba(182,212,126,0.30)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + cos * len * 0.92, by + sin * len * 0.92);
      ctx.stroke();
      // a few pinnule shadow grooves across the pinna
      ctx.strokeStyle = 'rgba(18,38,12,0.22)';
      ctx.lineWidth = 0.8;
      for (let k = 2; k < step - 1; k += 2) {
        const s = k / step;
        const px = bx + cos * len * s;
        const py = by + sin * len * s;
        const hw = wid * Math.pow(Math.sin(Math.PI * s), 0.55);
        ctx.beginPath();
        ctx.moveTo(px - nx * hw * 0.9, py - ny * hw * 0.9);
        ctx.lineTo(px + nx * hw * 0.55, py + ny * hw * 0.55);
        ctx.stroke();
      }
    }
  }
  // terminal pinna at the frond tip
  {
    const [bx, by] = rachis[rachis.length - 1];
    const len = 21;
    const wid = 6;
    ctx.beginPath();
    ctx.moveTo(bx - 2, by);
    ctx.quadraticCurveTo(bx + len * 0.5, by - wid, bx + len * 0.72, by - 1);
    ctx.quadraticCurveTo(bx + len * 0.5, by + wid, bx - 2, by);
    ctx.closePath();
    ctx.fillStyle = 'hsl(108, 42%, 34%)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(18,38,12,0.35)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  // young coiled crozier hinted at the base (small curl)
  ctx.strokeStyle = 'rgba(126,170,82,0.75)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let i = 0; i <= 22; i++) {
    const a = (i / 22) * Math.PI * 2.1 + Math.PI * 0.6;
    const r = 13 * (1 - i / 26);
    const px = 52 + Math.cos(a) * r;
    const py = 318 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// cell 4: vine — leafy sprig on a curling stem (tips biased +U)
// ---------------------------------------------------------------------------

function drawVineCell(ctx) {
  const nodes = 9;
  const stem = [];
  for (let i = 0; i <= 36; i++) {
    const t = i / 36;
    const x = 38 + t * 404;
    const y = 318 - t * 74 + Math.sin(t * Math.PI * 2.1 + 0.5) * 24;
    stem.push([x, y]);
  }
  // main stem
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(24,18,10,0.22)';
  ctx.lineWidth = 7.5;
  ctx.beginPath();
  ctx.moveTo(stem[0][0] + 1.4, stem[0][1] + 2.2);
  for (let i = 1; i < stem.length; i++) ctx.lineTo(stem[i][0] + 1.4, stem[i][1] + 2.2);
  ctx.stroke();
  ctx.strokeStyle = '#5c6a32';
  ctx.lineWidth = 4.6;
  ctx.beginPath();
  ctx.moveTo(stem[0][0], stem[0][1]);
  for (let i = 1; i < stem.length; i++) ctx.lineTo(stem[i][0], stem[i][1]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(178,196,120,0.5)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(stem[0][0], stem[0][1] - 1.5);
  for (let i = 1; i < stem.length; i++) ctx.lineTo(stem[i][0], stem[i][1] - 1.5);
  ctx.stroke();

  const rng = makeRNG(9701);
  for (let n = 0; n < nodes; n++) {
    const t = 0.06 + (n / (nodes - 1)) * 0.84;
    const idx = Math.round(t * 36);
    const p = stem[idx];
    const q = stem[Math.min(35, idx + 1)];
    const th = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const side = n % 2 === 0 ? -1 : 1;
    const swing = side * (0.95 + rng() * 0.45);
    const ang = th + swing;
    const len = 23 + rng() * 16;
    const wid = len * (0.34 + rng() * 0.12);
    const bx = p[0] + Math.cos(ang) * 8;
    const by = p[1] + Math.sin(ang) * 8;
    // petiole
    ctx.strokeStyle = 'rgba(96,116,54,0.9)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(bx, by);
    ctx.stroke();
    // leaf
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const nx = -sin;
    const ny = cos;
    const step = 10;
    const A = [];
    const B = [];
    for (let k = 0; k <= step; k++) {
      const s = k / step;
      const hw = wid * Math.pow(Math.sin(Math.PI * s), 0.62);
      const px = bx + cos * len * s;
      const py = by + sin * len * s;
      A.push([px + nx * hw, py + ny * hw]);
      B.push([px - nx * hw, py - ny * hw]);
    }
    ctx.beginPath();
    ctx.moveTo(A[0][0], A[0][1]);
    for (let k = 1; k < A.length; k++) ctx.lineTo(A[k][0], A[k][1]);
    for (let k = B.length - 1; k >= 0; k--) ctx.lineTo(B[k][0], B[k][1]);
    ctx.closePath();
    const young = t > 0.62;
    const hue = young ? 88 : 104;
    const g = ctx.createLinearGradient(bx, by, bx + cos * len, by + sin * len);
    g.addColorStop(0, `hsl(${hue}, 36%, ${young ? 27 : 22}%)`);
    g.addColorStop(0.7, `hsl(${hue + 4}, 44%, ${young ? 36 : 30}%)`);
    g.addColorStop(1, `hsl(${hue + 10}, 50%, ${young ? 45 : 37}%)`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(18,36,12,0.38)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // mid vein + 3 side veins
    ctx.strokeStyle = 'rgba(190,218,132,0.32)';
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + cos * len * 0.9, by + sin * len * 0.9);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(20,40,14,0.20)';
    ctx.lineWidth = 0.65;
    for (let k = 2; k <= 6; k += 2) {
      const s = k / step;
      const px = bx + cos * len * s;
      const py = by + sin * len * s;
      const hw = wid * Math.pow(Math.sin(Math.PI * s), 0.62);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + cos * len * 0.12 + nx * hw * 0.8, py + sin * len * 0.12 + ny * hw * 0.8);
      ctx.stroke();
    }
  }

  // curly tendril at the tip
  {
    const [bx, by] = stem[stem.length - 1];
    ctx.strokeStyle = 'rgba(122,156,76,0.85)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const a = Math.PI * 0.2 + t * Math.PI * 3.4;
      const r = 15 * (1 - t) + 2.2;
      const px = bx - 10 + Math.cos(a) * r;
      const py = by - 12 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(198,222,142,0.4)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // a few dew beads on the small leaves
  drawDew(ctx, 150, 268, 2.4);
  drawDew(ctx, 262, 240, 2.7);
  drawDew(ctx, 352, 214, 2.1);
  drawDew(ctx, 452, 246, 2.0);
  drawDew(ctx, 402, 306, 1.8);
}

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------

/**
 * Re-frame each atlas cell's artwork at `scale` around the cell centre.
 *
 * QA pass 1 flagged that the broad/banana/fern cells paint almost to the cell edge
 * (some pixels <5% margin). At mip level 2 the neighbouring cell would then start to
 * bleed into the silhouette. Re-framing keeps the brushwork untouched but guarantees
 * the >=5-6% empty border the atlas contract asks for (ISLAND_ASSETS.md §3.1).
 */
function insetCells(canvas, scale = 0.92) {
  const ctx = ctxOf(canvas);
  const size = CELL * scale;
  const off = (CELL - size) / 2;
  for (let oy = 0; oy < 2; oy++) {
    for (let ox = 0; ox < 2; ox++) {
      const x = ox * CELL;
      const y = oy * CELL;
      const tmp = el(CELL, CELL);
      ctxOf(tmp).drawImage(canvas, x, y, CELL, CELL, 0, 0, CELL, CELL);
      ctx.clearRect(x, y, CELL, CELL);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, x + off, y + off, size, size);
    }
  }
}

export function makeBroadleaf(aniso, reg) {
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  ctx.lineJoin = 'round';

  withCell(ctx, 0, 0, drawBroadCell);
  withCell(ctx, CELL, 0, drawBananaCell);
  withCell(ctx, 0, CELL, drawFernCell);
  withCell(ctx, CELL, CELL, drawVineCell);

  // keep every cell's artwork inside the mip-safe border
  insetCells(albedo, 0.92);

  // clean alpha: bleed RGB outward into the transparent ring (alpha stays 0)
  bleedAlphaRgb(albedo, 10);

  const height = heightFromAlbedo(albedo);

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, NORMAL_STRENGTH, aniso)),
  };
}
