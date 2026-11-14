/**
 * SANDSTRIKE // leaf litter / forest floor texture set  (lib.leafLitter)
 *
 * Used by materials: leafLitter (jungle floor, tree bases) and mud (dark variant)
 *
 * A wet tropical litter layer, tiled at 1024 px = 4 m (ISLAND_ASSETS.md 3.1):
 *   - hundreds of fallen leaves in browns, ochres and yellow-greens, some curled or
 *     torn, each with a mid rib + side veins, a drop shadow and decay blotches
 *   - thin fallen twigs and leaf fragments
 *   - damp black humus with glossy puddle patches so it reads wet, not dusty
 *   - pale fungal threads + spores in the darkest pockets
 *
 * The full palette lives in LEAF_PALETTE below; tune there to re-grade the floor.
 *
 * Texture set contract:
 *   map            albedo        sRGB
 *   normalMap      tangent space  linear (Sobel from a 512px height canvas)
 *   roughnessMap   linear
 *
 * Everything here is drawn with Canvas2D at load time.
 */
import { clamp, makeRNG } from '../utils.js';
import {
  TAU, ctxOf, el, grayCanvas, hash2, normalFromHeightCanvas, overlayGrain, overlayNoise,
  textureFromCanvas, tileFbm, wrapDraw,
} from './core.js';

const S = 1024;
const BASE = 512;
const HS = 512;
const ROUGH = 512;
const STRENGTH = 2.3;

const LEAF_COUNT = 185;
const TWIG_COUNT = 42;
const FRAGMENT_COUNT = 300;

const SOIL_DARK = [38, 30, 19];
const SOIL_MID = [88, 69, 43];
const MOSS = [96, 108, 56];

/**
 * Fallen-leaf palette. [base, tip, vein] in sRGB.
 * Mix of wet browns, ochre, olive and yellow-green leaves from the island canopy.
 */
const LEAF_PALETTE = [
  { base: [84, 66, 38], tip: [138, 110, 62], vein: [46, 34, 17] },   // wet brown
  { base: [104, 80, 46], tip: [158, 126, 70], vein: [56, 40, 20] },  // ochre
  { base: [74, 64, 36], tip: [126, 118, 62], vein: [40, 33, 16] },   // olive
  { base: [94, 104, 54], tip: [150, 164, 88], vein: [48, 55, 24] },  // yellow-green
  { base: [70, 56, 34], tip: [116, 92, 50], vein: [38, 28, 14] },    // dark dead leaf
  { base: [122, 104, 58], tip: [170, 148, 88], vein: [72, 56, 26] }, // sun-bleached
  { base: [110, 70, 46], tip: [156, 104, 64], vein: [58, 34, 18] },  // rusty red-brown
  { base: [92, 96, 50], tip: [140, 150, 80], vein: [46, 48, 20] },   // fresh green
];

/** Build the deterministic litter layout (shared by albedo / height / roughness). */
function buildLitter(rng) {
  const leaves = [];
  for (let i = 0; i < LEAF_COUNT; i++) {
    const round = rng() > 0.62;
    leaves.push({
      x: rng() * S,
      y: rng() * S,
      len: 22 + rng() * 62,
      wid: (round ? 0.52 : 0.30) + rng() * (round ? 0.26 : 0.22),
      rot: rng() * TAU,
      curl: (rng() - 0.5) * 0.9,
      pal: Math.floor(rng() * LEAF_PALETTE.length),
      tone: rng(),
      round,
      decay: rng() > 0.42 ? 2 + Math.floor(rng() * 4) : 0,
      notches: rng() > 0.58 ? 1 + Math.floor(rng() * 2) : 0,
      notchSeed: Math.floor(rng() * 1e9),
      seed: Math.floor(rng() * 1e9),
    });
  }
  const twigs = [];
  for (let i = 0; i < TWIG_COUNT; i++) {
    twigs.push({
      x: rng() * S,
      y: rng() * S,
      len: 34 + rng() * 120,
      rot: rng() * TAU,
      bend: (rng() - 0.5) * 26,
      w: 1.0 + rng() * 2.6,
      tone: rng(),
      fork: rng() > 0.5,
    });
  }
  const fragments = [];
  for (let i = 0; i < FRAGMENT_COUNT; i++) {
    fragments.push({
      x: rng() * S,
      y: rng() * S,
      r: 1.2 + rng() * 4.4,
      rot: rng() * TAU,
      pal: Math.floor(rng() * LEAF_PALETTE.length),
      tone: rng(),
    });
  }
  const puddles = [];
  for (let i = 0; i < 7; i++) {
    puddles.push({
      x: rng() * S,
      y: rng() * S,
      r: 30 + rng() * 80,
      squash: 0.5 + rng() * 0.7,
      rot: rng() * TAU,
    });
  }
  return { leaves, twigs, fragments, puddles };
}

/** Outline samples of one leaf (spine bent by `curl`, width by `round`). */
function leafOutline(l) {
  const N = 14;
  const cos = Math.cos(l.rot);
  const sin = Math.sin(l.rot);
  const nx = -sin;
  const ny = cos;
  const half = l.len * 0.5;
  const widHalf = l.len * l.wid * 0.5;
  const notchSet = new Set();
  if (l.notches) {
    const nrng = makeRNG(l.notchSeed + 3);
    for (let i = 0; i < l.notches; i++) notchSet.add(2 + Math.floor(nrng() * 8));
  }
  const left = [];
  const right = [];
  const spine = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const u = (s - 0.5) * l.len;
    const bow = l.curl * l.len * 0.16 * Math.sin(Math.PI * s);
    const px = l.x + cos * u + nx * bow;
    const py = l.y + sin * u + ny * bow;
    let hw = widHalf * Math.pow(Math.sin(Math.PI * s), l.round ? 0.38 : 0.62);
    hw *= 0.78 + 0.3 * s; // base slightly narrower than the belly
    if (notchSet.has(i)) hw *= 0.18; // torn bite out of the edge
    left.push([px + nx * hw, py + ny * hw]);
    right.push([px - nx * hw, py - ny * hw]);
    spine.push([px, py]);
  }
  return { left, right, spine, cos, sin };
}

/** Trace (and fill) one leaf path in the current context. */
function traceLeaf(ctx, l, outline) {
  ctx.beginPath();
  ctx.moveTo(outline.left[0][0], outline.left[0][1]);
  for (let i = 1; i < outline.left.length; i++) ctx.lineTo(outline.left[i][0], outline.left[i][1]);
  for (let i = outline.right.length - 1; i >= 0; i--) ctx.lineTo(outline.right[i][0], outline.right[i][1]);
  ctx.closePath();
}

/** Fill one leaf with its gradient + curls + decay, used by albedo & height. */
function paintLeaf(ctx, l) {
  const outline = leafOutline(l);
  const pal = LEAF_PALETTE[l.pal];
  const rng = makeRNG(l.seed + 7);
  const { cos, sin } = outline;
  const half = l.len * 0.5;

  // contact shadow
  ctx.save();
  ctx.translate(cos * 2.5 + 1.6, sin * 2.5 + 2.2);
  traceLeaf(ctx, l, outline);
  ctx.fillStyle = 'rgba(12,8,4,0.34)';
  ctx.fill();
  ctx.restore();

  traceLeaf(ctx, l, outline);
  const gx0 = l.x - cos * half;
  const gy0 = l.y - sin * half;
  const gx1 = l.x + cos * half;
  const gy1 = l.y + sin * half;
  const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
  const dry = (l.tone - 0.5) * 16;
  grad.addColorStop(0, `rgb(${pal.base[0] + dry},${pal.base[1] + dry},${pal.base[2] + dry * 0.6})`);
  grad.addColorStop(0.55, `rgb(${pal.tip[0] * 0.82 + pal.base[0] * 0.18 + dry},${pal.tip[1] * 0.82 + pal.base[1] * 0.18 + dry},${pal.tip[2] * 0.82 + pal.base[2] * 0.18 + dry * 0.6})`);
  grad.addColorStop(1, `rgb(${pal.tip[0] + dry},${pal.tip[1] + dry},${pal.tip[2] + dry * 0.6})`);
  ctx.fillStyle = grad;
  ctx.fill();

  // inner rim: lit sun-catching edge + darker vein rim
  ctx.lineWidth = Math.max(1.4, l.len * 0.03);
  ctx.strokeStyle = `rgba(${Math.min(220, pal.tip[0] + 46)},${Math.min(225, pal.tip[1] + 46)},${Math.min(200, pal.tip[2] + 40)},0.26)`;
  ctx.stroke();
  ctx.lineWidth = Math.max(0.8, l.len * 0.016);
  ctx.strokeStyle = `rgba(${pal.vein[0]},${pal.vein[1]},${pal.vein[2]},0.58)`;
  ctx.stroke();
  ctx.save();
  traceLeaf(ctx, l, outline);
  ctx.clip();
  // fold / curled side: a soft dark band along one edge
  const foldW = l.len * (0.12 + Math.abs(l.curl) * 0.14);
  const fold = ctx.createLinearGradient(
    l.x + (-sin) * l.len * l.wid * 0.5, l.y + cos * l.len * l.wid * 0.5,
    l.x + (-sin) * (l.len * l.wid * 0.5 - foldW), l.y + cos * (l.len * l.wid * 0.5 - foldW)
  );
  fold.addColorStop(0, 'rgba(16,12,6,0.30)');
  fold.addColorStop(1, 'rgba(16,12,6,0)');
  ctx.fillStyle = fold;
  ctx.fillRect(l.x - half, l.y - half, l.len, l.len);
  // broad mottling
  for (let i = 0; i < 3; i++) {
    const mx = l.x + (rng() - 0.5) * l.len * 0.7;
    const my = l.y + (rng() - 0.5) * l.len * 0.7;
    const mr = l.len * (0.18 + rng() * 0.28);
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
    g.addColorStop(0, rng() > 0.5 ? 'rgba(24,18,8,0.16)' : 'rgba(204,184,130,0.13)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  }
  // decay blotches
  for (let i = 0; i < l.decay; i++) {
    const dx = l.x + (rng() * 2 - 1) * l.len * 0.34;
    const dy = l.y + (rng() * 2 - 1) * l.len * 0.30;
    const dr = 1.2 + rng() * l.len * 0.09;
    const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, dr);
    g.addColorStop(0, `rgba(${40 + rng() * 26},${30 + rng() * 22},${16 + rng() * 12},${0.35 + rng() * 0.3})`);
    g.addColorStop(1, 'rgba(40,30,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(dx - dr, dy - dr, dr * 2, dr * 2);
  }
  // mid rib + side veins
  const { spine } = outline;
  ctx.strokeStyle = `rgba(${pal.vein[0]},${pal.vein[1]},${pal.vein[2]},0.65)`;
  ctx.lineWidth = Math.max(0.7, l.len * 0.014);
  ctx.beginPath();
  ctx.moveTo(spine[0][0], spine[0][1]);
  for (let i = 1; i < spine.length; i++) ctx.lineTo(spine[i][0], spine[i][1]);
  ctx.stroke();
  ctx.strokeStyle = `rgba(${pal.tip[0] + 40},${pal.tip[1] + 40},${pal.tip[2] + 34},0.30)`;
  ctx.lineWidth = Math.max(0.5, l.len * 0.008);
  ctx.beginPath();
  ctx.moveTo(spine[0][0] + 0.6, spine[0][1] + 0.6);
  for (let i = 1; i < spine.length; i++) ctx.lineTo(spine[i][0] + 0.6, spine[i][1] + 0.6);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.45, l.len * 0.007);
  ctx.strokeStyle = `rgba(${pal.vein[0]},${pal.vein[1]},${pal.vein[2]},0.34)`;
  for (let vi = 3; vi < spine.length - 2; vi += 2) {
    const [sx, sy] = spine[vi];
    const off = (vi % 4 === 3 ? 1 : -1) * l.len * l.wid * 0.36;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + cos * l.len * 0.1, sy + sin * l.len * 0.1, sx + (-sin) * off, sy + cos * off);
    ctx.stroke();
  }
  ctx.restore();
}

export function makeLeafLitter(aniso, reg) {
  const rng = makeRNG(77031);
  const litter = buildLitter(rng);

  // ---- albedo -------------------------------------------------------------
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  ctx.imageSmoothingEnabled = true;

  // wet humus base field
  const base = el(BASE, BASE);
  {
    const bctx = ctxOf(base);
    const img = bctx.createImageData(BASE, BASE);
    const d = img.data;
    let i = 0;
    for (let y = 0; y < BASE; y++) {
      const v = y / BASE;
      for (let x = 0; x < BASE; x++) {
        const u = x / BASE;
        const tone = tileFbm(u, v, 4, 151);
        const wet = tileFbm(u, v, 3, 217);
        const mossM = tileFbm(u, v, 3, 313);
        const t = clamp(0.28 + tone * 0.62, 0, 1);
        let r = SOIL_DARK[0] + (SOIL_MID[0] - SOIL_DARK[0]) * t;
        let g = SOIL_DARK[1] + (SOIL_MID[1] - SOIL_DARK[1]) * t;
        let b = SOIL_DARK[2] + (SOIL_MID[2] - SOIL_DARK[2]) * t;
        // moss / decay film in a few pockets
        const mo = clamp((mossM - 0.52) * 3.2, 0, 1) * 0.5;
        r += (MOSS[0] - r) * mo;
        g += (MOSS[1] - g) * mo;
        b += (MOSS[2] - b) * mo;
        // damp = darker + slightly cooler
        const damp = clamp((0.52 - wet) * 1.7, 0, 1);
        r *= 1 - damp * 0.34;
        g *= 1 - damp * 0.30;
        b *= 1 - damp * 0.26;
        const grain = hash2(x, y, 8123) - 0.5;
        d[i++] = clamp(r + grain * 11, 0, 255);
        d[i++] = clamp(g + grain * 11, 0, 255);
        d[i++] = clamp(b + grain * 9, 0, 255);
        d[i++] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
  }
  ctx.drawImage(base, 0, 0, S, S);

  // glossy puddle patches in the low spots
  for (const p of litter.puddles) {
    wrapDraw(ctx, S, p.x, p.y, p.r + 6, (c) => {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.scale(1, p.squash);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, p.r);
      g.addColorStop(0, 'rgba(14,11,7,0.40)');
      g.addColorStop(0.7, 'rgba(18,14,9,0.20)');
      g.addColorStop(1, 'rgba(18,14,9,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, p.r, 0, TAU);
      c.fill();
      // wet sky reflection sliver
      c.fillStyle = 'rgba(150,180,170,0.11)';
      c.beginPath();
      c.ellipse(0, -p.r * 0.35, p.r * 0.5, p.r * 0.12, 0, 0, TAU);
      c.fill();
      c.restore();
    });
  }

  // leaves
  for (const l of litter.leaves) {
    wrapDraw(ctx, S, l.x, l.y, l.len, (c) => {
      c.save();
            paintLeaf(c, l);
      c.restore();
    });
  }

  // twigs
  for (const t of litter.twigs) {
    const cos = Math.cos(t.rot);
    const sin = Math.sin(t.rot);
    const nx = -sin;
    const ny = cos;
    const ex = t.x + cos * t.len;
    const ey = t.y + sin * t.len;
    const mx = (t.x + ex) / 2 + nx * t.bend;
    const my = (t.y + ey) / 2 + ny * t.bend;
    const v = 46 + t.tone * 34;
    wrapDraw(ctx, S, t.x, t.y, t.len + 10, (c) => {
      c.save();
            c.lineCap = 'round';
      // shadow
      c.strokeStyle = 'rgba(10,7,3,0.30)';
      c.lineWidth = t.w + 1.6;
      c.beginPath();
      c.moveTo(t.x + 1.6, t.y + 2.2);
      c.quadraticCurveTo(mx + 1.6, my + 2.2, ex + 1.6, ey + 2.2);
      c.stroke();
      // bark
      c.strokeStyle = `rgb(${v + 12},${v - 2},${v - 22})`;
      c.lineWidth = t.w;
      c.beginPath();
      c.moveTo(t.x, t.y);
      c.quadraticCurveTo(mx, my, ex, ey);
      c.stroke();
      // lit top edge
      c.strokeStyle = `rgba(${v + 66},${v + 48},${v + 26},0.5)`;
      c.lineWidth = Math.max(0.6, t.w * 0.4);
      c.beginPath();
      c.moveTo(t.x, t.y - t.w * 0.35);
      c.quadraticCurveTo(mx, my - t.w * 0.35, ex, ey - t.w * 0.35);
      c.stroke();
      // fork
      if (t.fork) {
        const fx = t.x + cos * t.len * 0.55;
        const fy = t.y + sin * t.len * 0.55;
        c.strokeStyle = `rgb(${v},${v - 8},${v - 26})`;
        c.lineWidth = Math.max(0.7, t.w * 0.7);
        c.beginPath();
        c.moveTo(fx, fy);
        c.lineTo(fx + cos * 18 - sin * 16, fy + sin * 18 + cos * 16);
        c.stroke();
      }
      // node bumps
      c.fillStyle = `rgba(${v + 26},${v + 8},${v - 16},0.75)`;
      for (let k = 1; k <= 3; k++) {
        const s = k / 4;
        const bx = t.x + (mx - t.x) * 2 * s * (1 - s) + (ex - t.x) * s * s;
        const by = t.y + (my - t.y) * 2 * s * (1 - s) + (ey - t.y) * s * s;
        c.beginPath();
        c.arc(bx, by, t.w * 0.6, 0, TAU);
        c.fill();
      }
      c.restore();
    });
  }

  // leaf fragments / crumbs
  for (const f of litter.fragments) {
    const pal = LEAF_PALETTE[f.pal];
    const col = `rgb(${pal.base[0] + f.tone * 26},${pal.base[1] + f.tone * 22},${pal.base[2] + f.tone * 12})`;
    wrapDraw(ctx, S, f.x, f.y, f.r + 3, (c) => {
      c.save();
      c.translate(f.x, f.y);
      c.rotate(f.rot);
      c.fillStyle = 'rgba(12,8,4,0.26)';
      c.beginPath();
      c.ellipse(0.7, 1.1, f.r, f.r * 0.5, 0, 0, TAU);
      c.fill();
      c.fillStyle = col;
      c.beginPath();
      c.ellipse(0, 0, f.r, f.r * 0.48, 0, 0, TAU);
      c.fill();
      c.restore();
    });
  }

  // fungal threads: very fine pale filaments over the darkest patches
  for (let i = 0; i < 70; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 18 + rng() * 70;
    const a = rng() * TAU;
    const bend = (rng() - 0.5) * 26;
    const alpha = 0.06 + rng() * 0.10;
    const lw = 0.5 + rng() * 0.5;
    wrapDraw(ctx, S, x, y, len + 4, (c) => {
      c.strokeStyle = `rgba(214,206,172,${alpha})`;
      c.lineWidth = lw;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + bend, y + Math.sin(a) * len * 0.5 - bend,
        x + Math.cos(a) * len, y + Math.sin(a) * len);
      c.stroke();
    });
  }

  // damp sheen + moisture macro variation
  for (let i = 0; i < 18; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 100 + rng() * 320;
    const dark = rng() > 0.45;
    wrapDraw(ctx, S, x, y, r + 6, (c) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, dark ? 'rgba(8,12,6,0.16)' : 'rgba(196,180,126,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  overlayNoise(ctx, S, S, { tile: 256, seed: 271, alpha: 0.13, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.09, seed: 272 });

  // ---- height -------------------------------------------------------------
  const hgt = el(HS, HS);
  const hctx = ctxOf(hgt);
  hctx.imageSmoothingEnabled = true;
  const k = HS / S;
  const baseHeight = grayCanvas(BASE, (x, y, u, v) => {
    const tone = tileFbm(u, v, 4, 151);
    const wet = tileFbm(u, v, 3, 217);
    return clamp(0.34 + tone * 0.20 - clamp((0.52 - wet) * 0.5, 0, 0.2), 0, 1);
  });
  hctx.drawImage(baseHeight, 0, 0, HS, HS);
  const hasFilter = typeof hctx.filter === 'string';
  hctx.save();
  hctx.scale(k, k);
  for (const l of litter.leaves) {
    wrapDraw(hctx, S, l.x, l.y, l.len, (c) => {
      c.save();
            const outline = leafOutline(l);
      if (hasFilter) c.filter = 'blur(1.2px)';
      traceLeaf(c, l, outline);
      c.fillStyle = 'rgb(206,206,206)';
      c.fill();
      c.filter = 'none';
      // raised rib
      const { spine } = outline;
      c.strokeStyle = 'rgb(232,232,232)';
      c.lineWidth = Math.max(1, l.len * 0.02);
      c.beginPath();
      c.moveTo(spine[0][0], spine[0][1]);
      for (let i = 1; i < spine.length; i++) c.lineTo(spine[i][0], spine[i][1]);
      c.stroke();
      c.restore();
    });
  }
  for (const t of litter.twigs) {
    const cos = Math.cos(t.rot);
    const sin = Math.sin(t.rot);
    const ex = t.x + cos * t.len;
    const ey = t.y + sin * t.len;
    const mx = (t.x + ex) / 2 - sin * t.bend;
    const my = (t.y + ey) / 2 + cos * t.bend;
    wrapDraw(hctx, S, t.x, t.y, t.len + 10, (c) => {
      c.save();
            c.lineCap = 'round';
      c.strokeStyle = 'rgb(220,220,220)';
      c.lineWidth = t.w + 1.2;
      c.beginPath();
      c.moveTo(t.x, t.y);
      c.quadraticCurveTo(mx, my, ex, ey);
      c.stroke();
      c.restore();
    });
  }
  hctx.restore();
  overlayNoise(hctx, HS, HS, { tile: 256, seed: 273, alpha: 0.11, scale: 1, mode: 'overlay' });
  overlayGrain(hctx, HS, HS, { alpha: 0.07, seed: 274 });

  // ---- roughness ----------------------------------------------------------
  const rough = el(ROUGH, ROUGH);
  const rctx = ctxOf(rough);
  rctx.imageSmoothingEnabled = true;
  const baseRough = grayCanvas(BASE, (x, y, u, v) => {
    const wet = tileFbm(u, v, 3, 217);
    const tone = tileFbm(u, v, 4, 151);
    const damp = clamp((0.52 - wet) * 1.7, 0, 1);
    // wet humus is fairly glossy; dry-ish leaf mould rougher
    return clamp(0.74 - damp * 0.20 + (tone - 0.5) * 0.16, 0, 1);
  });
  rctx.drawImage(baseRough, 0, 0, ROUGH, ROUGH);
  const kr = ROUGH / S;
  for (const l of litter.leaves) {
    const outline = leafOutline(l);
    const wetLeaf = l.round; // big round leaves read as waxy/wet, thin ones drier
    const val = wetLeaf ? 118 : 150 + (1 - l.tone) * 34;
    wrapDraw(rctx, ROUGH, l.x * kr, l.y * kr, l.len * kr, (c) => {
      c.save();
            c.scale(kr, kr);
      traceLeaf(c, l, outline);
      c.fillStyle = `rgb(${val},${val},${val})`;
      c.fill();
      c.restore();
    });
  }
  // puddle patches are mirror-like: repaint the wet spots (same layout as albedo)
  for (const p of litter.puddles) {
    const x = p.x * kr;
    const y = p.y * kr;
    const r = p.r * kr;
    wrapDraw(rctx, ROUGH, x, y, r + 4, (c) => {
      c.save();
      c.translate(x, y);
      c.rotate(p.rot);
      c.scale(1, p.squash);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(52,52,52,0.62)');
      g.addColorStop(1, 'rgba(52,52,52,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, r, 0, TAU);
      c.fill();
      c.restore();
    });
  }
  overlayNoise(rctx, ROUGH, ROUGH, { tile: 256, seed: 275, alpha: 0.10, scale: 1, mode: 'overlay' });

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(hgt, STRENGTH, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}

