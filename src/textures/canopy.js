/**
 * SANDSTRIKE // canopy leaf-cluster alpha atlas  (lib.canopy)
 *
 * Used by materials: canopy / canopyDark / canopyPale (alpha-tested leaf cards) and by
 * the procedural tree generator through the vertex-colour variants vegLeaf*.
 *
 * WHY THIS ATLAS EXISTS
 * The `broadleaf` atlas paints ONE leaf per cell. Every canopy card therefore reads as
 * a single big leaf, so a tree needs thousands of cards to look dense — and at 63 trees
 * on the island that is an unaffordable triangle and fill-rate bill. This atlas paints
 * CLUSTERS instead: one card carries a twig with 6-18 small leaves, so the same triangle
 * count buys ~6-18x the apparent leaf count and a much finer canopy silhouette.
 *
 * LAYOUT (fixed by src/models/world/island/leaf-atlas.js CANOPY_CELLS — do not reorder):
 *
 *       u: 0            0.5           1
 *    v 0    +--------------+--------------+
 *          | sprig        | spray        |   cluster leaves point +U (tip on the right)
 *    v 0.5 +--------------+--------------+
 *          | pale         | dry          |
 *    v 1    +--------------+--------------+
 *
 *    sprig = broadleaf twig, 9-12 medium leaves -> jungle-tree canopy mass
 *    spray = two fine twigs, 14-18 small leaves -> distant canopy, bushes, bamboo
 *    pale  = young yellow-green flush           -> sunlit crown tops (tint via material)
 *    dry   = sparse olive/brown dead leaves     -> under-canopy accents, dying fronds
 *
 * Painting approach (what makes it read as "real foliage" instead of clip-art):
 *   - every blade is drawn with a *soft cast shadow* onto the leaves already painted
 *     (`source-atop` stroke before the fill) => cheap per-leaf depth separation;
 *   - each blade picks its own slightly-shifted palette + serrated margin + rim light,
 *     so no two leaves in a cluster are identical;
 *   - veins are a dark groove + light ridge, plus a soft gloss streak and a warm
 *     backlit tip gradient;
 *   - insect holes are true alpha punches with a necrotic rim; dew beads sit on the
 *     broad cells;
 *   - every cell keeps a >=6% empty margin (mip bleed guard), RGB is bled into the
 *     transparent ring, and the normal map is baked from an alpha-blurred luminance
 *     height so relief stays in register with no hard silhouette normal.
 *
 * All of it is Canvas2D at load time (no external images).
 */
import { clamp, makeRNG } from '../utils.js';
import { TAU, ctxOf, el, normalFromHeightCanvas, textureFromCanvas } from './core.js';
import { bleedAlphaRgb, drawDew, heightFromAlbedo, punchHole } from './broadleaf.js';

const S = 1024;
const CELL = 512;
const PAD = 32; // ~6% empty margin inside every cell
const NORMAL_STRENGTH = 2.8;

// ---------------------------------------------------------------------------
// palettes (ISLAND_ASSETS.md §1.2 colour script; painted bright because material tint
// and the morning key light darken these cards in situ)
// ---------------------------------------------------------------------------

const GREEN = {
  base: '#31532a', dark: '#263f20', mid: '#4b7a36', light: '#6f9c46',
  ridge: '#93b95f', edge: '#22391b', vein: '#213c19', gloss: '#d6eaa6',
};

const DEEP = {
  base: '#274423', dark: '#1d341b', mid: '#3d662e', light: '#568339',
  ridge: '#74a04c', edge: '#1a2f16', vein: '#193014', gloss: '#b6d488',
};

const PALE = {
  base: '#6f8f3e', dark: '#5a7836', mid: '#93b25a', light: '#b7cc78',
  ridge: '#d3e294', edge: '#5c7733', vein: '#617d36', gloss: '#f2f7c0',
};

const DRY = {
  base: '#6d5c30', dark: '#4e4124', mid: '#8a7742', light: '#a58e50',
  ridge: '#c2a967', edge: '#3d331f', vein: '#493b21', gloss: '#e2d29a',
};

/** Multiply a #rrggbb colour by `mul` (and optionally add a per-channel offset). */
function shiftHex(hex, mul, add = [0, 0, 0]) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * mul + add[0]), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * mul + add[1]), 0, 255);
  const b = clamp(Math.round((n & 255) * mul + add[2]), 0, 255);
  return `rgb(${r},${g},${b})`;
}

/** Give one leaf its own slightly different palette (luma + a touch of hue drift). */
function jitterPalette(pal, rng, amt = 0.12) {
  const mul = 1 - amt * 0.6 + rng() * amt * 1.2;
  const warm = (rng() - 0.5) * amt * 34; // +red/-blue drift
  const add = [warm, warm * 0.3, -warm * 0.45];
  const out = {};
  for (const k of Object.keys(pal)) out[k] = shiftHex(pal[k], mul, add);
  return out;
}

// ---------------------------------------------------------------------------
// blade outline + painter
// ---------------------------------------------------------------------------

/**
 * Half width profile of one blade at s in [0,1] (0 = petiole, 1 = tip).
 * `shape` > 1 makes a narrower (lanceolate) leaf, < 1 a rounder one.
 */
function bladeHalf(s, halfW, shape = 0.7, baseSharp = 0.55, serrate = 0.08, phase = 0) {
  const t = clamp(s, 0, 1);
  let w = halfW * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.78)), shape);
  w *= 1 + 0.035 * Math.sin(t * Math.PI * 5.1 + 0.7); // organic ripple
  if (serrate) w *= 1 + serrate * 0.5 * Math.sin(t * Math.PI * 21 + phase); // fine teeth
  if (t < 0.14) w *= Math.pow(t / 0.14, baseSharp); // petiole shoulder
  if (t > 0.9) w *= Math.pow((1 - t) / 0.1, 0.62); // pointed tip
  return w;
}

/** Build the closed blade path in local space (base at 0,0, tip at len,0, +y down). */
function bladePath(ctx, len, wid, shape, lean = 0, serrate = 0.08, phase = 0) {
  const halfW = wid * 0.5;
  const N = 26;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 1; i <= N; i++) {
    const s = i / N;
    ctx.lineTo(len * s, -bladeHalf(s, halfW, shape, 0.55, serrate, phase) + lean * Math.sin(Math.PI * s));
  }
  for (let i = N - 1; i >= 0; i--) {
    const s = i / N;
    ctx.lineTo(len * s, bladeHalf(s, halfW, shape, 0.55, serrate, phase) + lean * Math.sin(Math.PI * s));
  }
  ctx.closePath();
}

/**
 * Paint one leaf blade along local +X, base at the current transform origin.
 * Draws its cast shadow onto previously painted blades first, so a cluster gains
 * real depth without a second texture pass.
 */
function paintBlade(ctx, { len, wid, palette, rng, shape = 0.7, lean = 0, mottling = 1, holes = 0, dew = 0, dryTip = 0 }) {
  const halfW = wid * 0.5;
  const serrate = 0.04 + rng() * 0.07;
  const phase = rng() * TAU;
  const pal = jitterPalette(palette, rng, 0.14);

  // ---- cast shadow onto everything already painted (clipped to opaque pixels only)
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  bladePath(ctx, len, wid, shape, lean, serrate, phase);
  ctx.strokeStyle = 'rgba(10,20,6,0.30)';
  ctx.lineWidth = Math.max(4, len * 0.075);
  ctx.stroke();
  ctx.restore();

  // ---- blade fill: dark petiole -> bright tip, with a lateral sheen
  bladePath(ctx, len, wid, shape, lean, serrate, phase);
  const g = ctx.createLinearGradient(-len * 0.05, 0, len * 1.02, 0);
  g.addColorStop(0, pal.base);
  g.addColorStop(0.26, pal.mid);
  g.addColorStop(0.7, pal.light);
  g.addColorStop(1, pal.ridge);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  bladePath(ctx, len, wid, shape, lean, serrate, phase);
  ctx.clip();

  // one side catches sky, the other falls away
  const lat = ctx.createLinearGradient(0, -halfW, 0, halfW);
  lat.addColorStop(0, 'rgba(18,30,14,0.00)');
  lat.addColorStop(0.44, 'rgba(255,255,235,0.055)');
  lat.addColorStop(0.62, 'rgba(20,34,16,0.17)');
  lat.addColorStop(1, 'rgba(8,18,6,0.34)');
  ctx.fillStyle = lat;
  ctx.fillRect(-len * 0.1, -halfW * 1.4, len * 1.2, halfW * 2.8);

  // soft mottling / wet patches / sun freckles
  for (let i = 0; i < Math.round(4 * mottling); i++) {
    const s = 0.1 + rng() * 0.82;
    const yy = (rng() * 2 - 1) * bladeHalf(s, halfW, shape) * 0.7;
    const rr = (0.05 + rng() * 0.12) * len;
    const mg = ctx.createRadialGradient(len * s, yy, 0, len * s, yy, rr);
    const dark = rng() < 0.52;
    mg.addColorStop(0, dark ? 'rgba(24,40,16,0.22)' : 'rgba(222,242,168,0.15)');
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(len * s - rr, yy - rr, rr * 2, rr * 2);
  }

  // warm backlit tip: light bleeding through the thinnest part of the blade
  const tip = ctx.createLinearGradient(len * 0.5, 0, len, 0);
  tip.addColorStop(0, 'rgba(232,255,168,0)');
  tip.addColorStop(1, 'rgba(236,255,180,0.20)');
  ctx.fillStyle = tip;
  ctx.fillRect(len * 0.5, -halfW, len * 0.5, halfW * 2);

  // secondary veins: dark groove + light ridge, angled towards the tip
  const pairs = Math.max(5, Math.round(len / 24));
  for (const side of [-1, 1]) {
    for (let i = 1; i <= pairs; i++) {
      const s = 0.08 + (i / (pairs + 1)) * 0.84;
      const hw = bladeHalf(s, halfW, shape, 0.55, serrate, phase);
      const reach = 0.72 + rng() * 0.22;
      const y0 = lean * Math.sin(Math.PI * s) * 0.9;
      const y1 = side * hw * reach + lean * Math.sin(Math.PI * s) * 0.9;
      const x1 = len * Math.min(0.995, s + 0.15);
      ctx.beginPath();
      ctx.moveTo(len * s, y0);
      ctx.quadraticCurveTo(len * (s + 0.03), side * hw * 0.4, x1, y1);
      ctx.strokeStyle = pal.vein;
      ctx.globalAlpha = 0.30;
      ctx.lineWidth = Math.max(1, len * 0.0075);
      ctx.stroke();
      ctx.strokeStyle = pal.ridge;
      ctx.globalAlpha = 0.20;
      ctx.lineWidth = Math.max(0.8, len * 0.0055);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // midrib: dark groove + light ridge
  ctx.beginPath();
  ctx.moveTo(len * 0.012, 0);
  ctx.quadraticCurveTo(len * 0.5, lean * 0.8, len * 0.988, lean * 0.06);
  ctx.strokeStyle = pal.vein;
  ctx.globalAlpha = 0.52;
  ctx.lineWidth = Math.max(1.4, len * 0.015);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(len * 0.018, -Math.max(1, len * 0.012));
  ctx.quadraticCurveTo(len * 0.5, lean * 0.8 - Math.max(1, len * 0.012), len * 0.985, lean * 0.06 - 1);
  ctx.strokeStyle = pal.ridge;
  ctx.globalAlpha = 0.34;
  ctx.lineWidth = Math.max(1, len * 0.0085);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // gloss streak: a narrow specular band along the upper third of the blade
  ctx.beginPath();
  ctx.moveTo(len * 0.1, -halfW * 0.34);
  ctx.quadraticCurveTo(len * 0.5, -halfW * 0.46 + lean * 0.7, len * 0.9, -halfW * 0.14 + lean * 0.1);
  ctx.strokeStyle = pal.gloss;
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = Math.max(1.4, len * 0.02);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // dry margin creeping in from the tip on old leaves
  if (dryTip > 0) {
    const dg = ctx.createLinearGradient(len * 0.5, 0, len, 0);
    dg.addColorStop(0, 'rgba(120,92,42,0)');
    dg.addColorStop(1, `rgba(134,102,45,${0.38 * dryTip})`);
    ctx.fillStyle = dg;
    ctx.fillRect(len * 0.5, -halfW, len * 0.5, halfW * 2);
  }
  ctx.restore();

  // crisp silhouette + a rim light on the sun side keeps alphaTest edges readable
  bladePath(ctx, len, wid, shape, lean, serrate, phase);
  ctx.strokeStyle = pal.edge;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(1.2, len * 0.007);
  ctx.stroke();
  ctx.globalAlpha = 0.30;
  ctx.strokeStyle = pal.gloss;
  ctx.lineWidth = Math.max(0.9, len * 0.005);
  ctx.stroke();
  ctx.globalAlpha = 1;

  for (let i = 0; i < holes; i++) {
    punchHole(ctx, len * (0.25 + rng() * 0.55), (rng() * 2 - 1) * halfW * 0.5, len * (0.03 + rng() * 0.05), 300 + i * 37 + Math.round(rng() * 1e4));
  }
  for (let i = 0; i < dew; i++) {
    drawDew(ctx, len * (0.25 + rng() * 0.5), (rng() * 2 - 1) * halfW * 0.45, 1.6 + rng() * 1.6);
  }
}

/**
 * Draw a leafy twig: a curved stem plus leaves on alternating sides (and optional side
 * branchlets). Leaves are placed in cell space so the cluster can be laid out inside
 * the cell margins.
 */
function drawTwig(ctx, o) {
  const {
    x0, y0, x1, y1, curve = 0, leaves = 7, lenMin = 90, lenMax = 140, widRatio = 0.52,
    palette = GREEN, seed = 1, shape = 0.7, holes = 0, dew = 0, dryTip = 0, mottling = 1,
    branchlets = 0, stemW = 3.2, spread = 1.06, depthLeaves = 0,
  } = o;
  const rng = makeRNG(seed);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stemAt = (t) => ({
    x: x0 + dx * t,
    y: y0 + dy * t + curve * Math.sin(Math.PI * t),
    a: Math.atan2(dy + curve * Math.PI * Math.cos(Math.PI * t), dx),
  });

  // stem, drawn first so leaves overlap it
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let i = 1; i <= 14; i++) {
    const p = stemAt(i / 14);
    ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = '#4a3a24';
  ctx.lineWidth = stemW;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150,132,88,0.35)';
  ctx.lineWidth = Math.max(0.8, stemW * 0.34);
  ctx.stroke();

  // back layer: darker leaves peeking out behind the front ones
  for (let i = 0; i < depthLeaves; i++) {
    const t = 0.16 + rng() * 0.7;
    const p = stemAt(t);
    const ang = p.a + (rng() < 0.5 ? 1 : -1) * (1.35 + rng() * 0.5);
    const len = (lenMin + rng() * (lenMax - lenMin)) * 0.82;
    ctx.save();
    ctx.translate(p.x + (rng() - 0.5) * 14, p.y + (rng() - 0.5) * 14);
    ctx.rotate(ang);
    paintBlade(ctx, { len, wid: len * widRatio * 0.94, palette: DEEP, rng, shape: shape * 1.05, mottling: 0.6 });
    ctx.restore();
  }

  const slots = [];
  for (let b = 0; b < branchlets; b++) {
    const t = 0.3 + (b / Math.max(1, branchlets)) * 0.48 + rng() * 0.06;
    const p = stemAt(t);
    const side = b % 2 ? 1 : -1;
    const ang = p.a + side * (0.9 + rng() * 0.34);
    const bl = (lenMin + lenMax) * (0.4 + rng() * 0.22);
    const bx = p.x + Math.cos(ang) * bl;
    const by = p.y + Math.sin(ang) * bl;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(p.x + Math.cos(ang) * bl * 0.5, p.y + Math.sin(ang) * bl * 0.5 + 6, bx, by);
    ctx.strokeStyle = '#4a3a24';
    ctx.lineWidth = stemW * 0.58;
    ctx.stroke();
    slots.push({ x: bx, y: by, ang: ang + (rng() - 0.5) * 0.55, falloff: 0.82 });
    slots.push({ x: bx, y: by, ang: ang + (rng() - 0.5) * 0.55 + 0.6, falloff: 0.75 });
  }

  for (let i = 0; i < leaves; i++) {
    const t = 0.09 + (i / Math.max(1, leaves - 1)) * 0.84;
    const p = stemAt(t);
    const side = i % 2 ? 1 : -1;
    const ang = p.a + side * (spread + rng() * 0.4) + (rng() - 0.5) * 0.26;
    slots.push({ x: p.x, y: p.y, ang, falloff: 1 - 0.32 * t });
  }

  for (const slot of slots) {
    const falloff = slot.falloff ?? 0.85;
    const len = (lenMin + rng() * (lenMax - lenMin)) * falloff;
    const wid = len * widRatio * (0.9 + rng() * 0.2);
    ctx.save();
    ctx.translate(slot.x, slot.y);
    ctx.rotate(slot.ang);
    paintBlade(ctx, {
      len, wid, palette, rng,
      shape: shape * (0.9 + rng() * 0.2),
      lean: (rng() - 0.5) * len * 0.1,
      mottling,
      holes: rng() < 0.18 ? holes : 0,
      dew: rng() < 0.5 ? dew : 0,
      dryTip: dryTip * (0.6 + rng() * 0.6),
    });
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// cells
// ---------------------------------------------------------------------------

/** Sprig: the main jungle-canopy cluster — ~11 broad leaves on a bowing twig. */
function drawSprigCell(ctx) {
  drawTwig(ctx, {
    x0: 78, y0: 438, x1: 404, y1: 148, curve: 30,
    leaves: 8, lenMin: 118, lenMax: 168, widRatio: 0.56, palette: GREEN, seed: 41,
    shape: 0.66, holes: 2, dew: 2, mottling: 1, branchlets: 1, stemW: 3.6, depthLeaves: 3,
  });
}

/** Spray: two crossing fine twigs, 16-18 small leaves — canopy mass at distance. */
function drawSprayCell(ctx) {
  drawTwig(ctx, {
    x0: 66, y0: 428, x1: 396, y1: 168, curve: -24,
    leaves: 9, lenMin: 62, lenMax: 96, widRatio: 0.5, palette: GREEN, seed: 83,
    shape: 0.88, branchlets: 2, stemW: 2.7, holes: 1, mottling: 0.8, depthLeaves: 4, spread: 1.0,
  });
  drawTwig(ctx, {
    x0: 236, y0: 448, x1: 416, y1: 206, curve: 16,
    leaves: 7, lenMin: 54, lenMax: 82, widRatio: 0.5, palette: DEEP, seed: 97,
    shape: 0.92, stemW: 2.2, mottling: 0.7, depthLeaves: 2,
  });
}

/** Pale: young yellow-green flush that catches the low morning sun. */
function drawPaleCell(ctx) {
  drawTwig(ctx, {
    x0: 88, y0: 424, x1: 400, y1: 152, curve: 20,
    leaves: 9, lenMin: 104, lenMax: 152, widRatio: 0.58, palette: PALE, seed: 131,
    shape: 0.6, dew: 3, mottling: 1.3, branchlets: 1, stemW: 3.2, depthLeaves: 2,
  });
}

/** Dry: sparse olive/brown dead leaves — under-canopy accents, broken crowns. */
function drawDryCell(ctx) {
  drawTwig(ctx, {
    x0: 96, y0: 410, x1: 386, y1: 188, curve: 18,
    leaves: 9, lenMin: 64, lenMax: 106, widRatio: 0.44, palette: DRY, seed: 211,
    shape: 0.95, branchlets: 1, stemW: 2.5, holes: 3, dryTip: 0.85, mottling: 1.4, depthLeaves: 2,
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
  // keep every painted pixel inside the cell margin (mip bleed guard)
  ctx.beginPath();
  ctx.rect(PAD - 6, PAD - 6, CELL - (PAD - 6) * 2, CELL - (PAD - 6) * 2);
  ctx.clip();
  fn(ctx);
  ctx.restore();
}

export function makeCanopy(aniso, reg) {
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  withCell(ctx, 0, 0, drawSprigCell);
  withCell(ctx, CELL, 0, drawSprayCell);
  withCell(ctx, 0, CELL, drawPaleCell);
  withCell(ctx, CELL, CELL, drawDryCell);

  // clean alpha: bleed RGB outward into the transparent ring (alpha stays 0)
  bleedAlphaRgb(albedo, 10);

  const height = heightFromAlbedo(albedo);

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, NORMAL_STRENGTH, aniso)),
  };
}

export default makeCanopy;
