/**
 * SANDSTRIKE // island mossy stone texture set  (lib.mossStone)
 *
 * Used by materials: mossStone / ruinStone / shoreRock  (ruin walls, arches,
 * towers, shore boulders — the most seen structure texture of the island map)
 *
 * Volcanic/andesite ashlar ruins swallowed by the rainforest: chunky grey blocks
 * with staggered joints, chipped corners, hairline cracks and pale lichen crust,
 * then dense moss colonies with real light/dark layering, rain streaks and damp
 * water staining. Drawn so the block joints + moss patches still read at 2-6 m.
 *
 * 1 tile = 2 m.
 *
 * Texture set contract:
 *   map            albedo        sRGB
 *   normalMap      tangent space  linear (Sobel from a 1024px height canvas)
 *   roughnessMap   linear        (wet stone glossier, moss/lichen matt)
 *
 * Everything here is drawn with Canvas2D at load time; tune the TUNING block.
 */
import { clamp, makeRNG, smoothstep } from '../utils.js';
import { TAU, ctxOf, el, fillCanvas, normalFromHeightCanvas, overlayGrain, overlayNoise, textureFromCanvas, tileFbm, wrapDraw } from './core.js';

// ---------------------------------------------------------------------------
// TUNING
// ---------------------------------------------------------------------------
const S = 1024;             // texture size (1 tile = 2 m)
const HEIGHT_SIZE = 1024;
const NORMAL_STRENGTH = 3.5;
const MASK_SIZE = 768;      // moss mask resolution (upscaled for soft moss edges)

const COURSES = 5;          // ashlar courses per tile
const MORTAR = 7;           // nominal joint width (px)

const CHIP_CHANCE = 0.5;
const CRACK_CHANCE = 0.4;
const PIT_CHANCE = 0.8;
const LICHEN_CHANCE = 0.45;
const WET_CHANCE = 0.28;
const JOINT_MOSS_CHANCE = 0.62;

// colour script (ISLAND_ASSETS.md §1.2: volcanic grey #5f5a52, moss #4c6b3a,
// water stain #3c3a34)
const STONE_DARK = [62, 58, 52];
const STONE_MID = [95, 90, 82];
const STONE_LIGHT = [126, 120, 110];
const BLUE_GREY = [88, 93, 98];
const WARM_GREY = [110, 101, 89];
const MORTAR_COL = [44, 40, 33];
const MORTAR_GRAIN = [124, 116, 96];
const WET_STONE = [48, 46, 41];
const RAIN_STAIN = [50, 48, 43];
const LICHEN = [146, 150, 138];
const LICHEN_COOL = [130, 138, 134];

const MOSS_SHADOW = [30, 42, 24];
const MOSS_TONES = [
  { dark: [40, 57, 30], mid: [72, 104, 56], light: [112, 134, 62], pale: [148, 156, 86] },
  { dark: [49, 60, 29], mid: [86, 104, 48], light: [128, 138, 60], pale: [162, 166, 92] },
  { dark: [34, 50, 31], mid: [62, 88, 52], light: [98, 122, 64], pale: [138, 150, 88] },
];

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const gray = (v) => `rgb(${Math.round(v)},${Math.round(v)},${Math.round(v)})`;

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------
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

function buildAshlar(rng) {
  const rowHeights = partition(S, COURSES, rng, 0.3);
  const blocks = [];
  let y = 0;
  for (let r = 0; r < rowHeights.length; r++) {
    const rh = rowHeights[r];
    const count = r === 0 ? 3 : 3 + Math.floor(rng() * 2);
    const widths = partition(S, count, rng, 0.66);
    const offset = Math.round((rng() - 0.5) * widths[0] * 0.9);
    let x = offset;
    for (let i = 0; i < widths.length; i++) {
      const bw = widths[i];
      const joint = MORTAR * (0.75 + rng() * 0.85);
      const seed = Math.floor(rng() * 1e9);
      const tone = rng();
      const worn = rng();
      const block = {
        x: x + joint * 0.5,
        y: y + joint * 0.5,
        w: bw - joint,
        h: rh - joint,
        seed,
        tone,
        worn,
        cool: rng(),
        rough: 0.74 + rng() * 0.2,
        top: 0.64 + rng() * 0.18,
        wet: rng() < WET_CHANCE,
        chip: rng() < CHIP_CHANCE ? { corner: Math.floor(rng() * 4), size: 0.06 + rng() * 0.12, seed: Math.floor(rng() * 1e9) } : null,
        cracked: rng() < CRACK_CHANCE ? { count: 1 + Math.floor(rng() * 3), seed: Math.floor(rng() * 1e9) } : null,
        pits: rng() < PIT_CHANCE ? { count: 7 + Math.floor(rng() * 15), seed: Math.floor(rng() * 1e9) } : null,
        lichen: rng() < LICHEN_CHANCE ? { count: 3 + Math.floor(rng() * 7), seed: Math.floor(rng() * 1e9), cool: rng() > 0.5 } : null,
        jointMoss: [],
      };
      // moss packed into the bottom joint / chipped corner of the block
      const mrng = makeRNG(seed + 41);
      if (mrng() < JOINT_MOSS_CHANCE) {
        const toneIdx = Math.floor(mrng() * MOSS_TONES.length);
        const n = 5 + Math.floor(mrng() * 8);
        for (let k = 0; k < n; k++) {
          block.jointMoss.push({
            x: block.x + block.w * (0.03 + mrng() * 0.94),
            y: block.y + block.h - mrng() * block.h * 0.13,
            r: 2.5 + mrng() * 9,
            tone: MOSS_TONES[toneIdx],
            seed: Math.floor(mrng() * 1e9),
          });
        }
      }
      blocks.push(block);
      x += bw;
    }
    y += rh;
  }
  return blocks;
}

/** Moss coverage field (tileable): broken colonies, ragged edges, small holes. */
function mossValue(u, v) {
  const patch =
    0.5
    + 0.26 * Math.sin(TAU * (u * 2 + 0.11))
    + 0.18 * Math.cos(TAU * (v + 0.37))
    + 0.2 * Math.sin(TAU * (u * 3 - v * 2 + 0.23))
    + 0.13 * Math.cos(TAU * (u * 5 + v * 3 + 0.61));
  const f = tileFbm(u, v, 5, 933);
  const fine = tileFbm(u, v, 3, 2911);
  return patch * 0.34 + f * 0.9 - fine * 0.17;
}

/** Moss coverage mask (white RGB + moss amount in alpha), tileable, soft edges. */
function buildMossMask() {
  const c = el(MASK_SIZE, MASK_SIZE);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(MASK_SIZE, MASK_SIZE);
  const d = img.data;
  let i = 0;
  for (let y = 0; y < MASK_SIZE; y++) {
    const v = y / MASK_SIZE;
    for (let x = 0; x < MASK_SIZE; x++) {
      const u = x / MASK_SIZE;
      const m = smoothstep(0.45, 0.6, mossValue(u, v)) * 255;
      d[i++] = 255;
      d[i++] = 255;
      d[i++] = 255;
      d[i++] = m;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Sample the same moss field on the CPU so details are only drawn where moss has coverage. */
function mossFieldAt(u, v) {
  return mossValue(u, v);
}

/** Moss colony detail: clumps, fibre hairs, fuzzy edge fringe and specks. */
function buildMossDetail() {
  const rng = makeRNG(3131);
  const clumps = [];
  const hairs = [];
  const fringe = [];
  const specks = [];
  let guard = 0;
  while (clumps.length < 1900 && guard++ < 30000) {
    const x = rng() * S;
    const y = rng() * S;
    if (mossFieldAt(x / S, y / S) < 0.53) continue;
    const toneIdx = Math.floor(rng() * MOSS_TONES.length);
    clumps.push({
      x,
      y,
      rx: 2.5 + rng() * 17,
      ry: 2.2 + rng() * 14,
      rot: rng() * TAU,
      tone: MOSS_TONES[toneIdx],
      shade: rng(),
      seed: Math.floor(rng() * 1e9),
    });
  }
  guard = 0;
  while (hairs.length < 2600 && guard++ < 40000) {
    const x = rng() * S;
    const y = rng() * S;
    if (mossFieldAt(x / S, y / S) < 0.58) continue;
    hairs.push({ x, y, len: 3 + rng() * 13, ang: rng() * TAU, tone: rng(), alpha: 0.1 + rng() * 0.3 });
  }
  // ragged fringe: short fibres sticking out along the colony boundary
  guard = 0;
  while (fringe.length < 1900 && guard++ < 80000) {
    const x = rng() * S;
    const y = rng() * S;
    const val = mossFieldAt(x / S, y / S);
    if (val < 0.455 || val > 0.63) continue;
    fringe.push({ x, y, len: 4 + rng() * 17, ang: rng() * TAU, tone: rng(), alpha: 0.2 + rng() * 0.4 });
  }
  guard = 0;
  while (specks.length < 1500 && guard++ < 30000) {
    const x = rng() * S;
    const y = rng() * S;
    if (mossFieldAt(x / S, y / S) < 0.56) continue;
    specks.push({ x, y, r: 0.5 + rng() * 2.6, tone: rng(), bright: rng() > 0.45 });
  }
  return { clumps, hairs, fringe, specks };
}

/** Moss albedo layer: dark damp bed, lit cushion crowns, fibre fuzz, specks. */
function drawMossLayer(size) {
  const layer = el(size, size);
  const ctx = ctxOf(layer);
  const rng = makeRNG(7710);
  fillCanvas(ctx, size, size, css(mix(MOSS_TONES[0].dark, MOSS_TONES[0].mid, 0.35)));

  // broad light/dark structure so the moss is not a flat green sheet
  for (let i = 0; i < 52; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = size * (0.04 + rng() * 0.17);
    const dark = rng() > 0.4;
    const a = (dark ? 0.2 : 0.13) + rng() * 0.24;
    wrapDraw(ctx, size, x, y, r + 8, (c) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, dark ? css(MOSS_TONES[2].dark, a) : css(MOSS_TONES[1].light, a * 0.8));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  const scale = size / S;
  const { clumps, hairs, fringe, specks } = buildMossDetail();
  // clump bodies: shadowed base + lit crown, giving the moss real relief
  for (const cl of clumps) {
    const x = cl.x * scale;
    const y = cl.y * scale;
    const rx = cl.rx * scale;
    const ry = cl.ry * scale;
    const tone = cl.tone;
    const body = cl.shade < 0.34 ? mix(tone.dark, tone.mid, cl.shade * 2.6)
      : cl.shade < 0.88 ? mix(tone.mid, tone.light, (cl.shade - 0.34) * 1.75)
        : mix(tone.light, tone.pale, (cl.shade - 0.88) * 2.2);
    wrapDraw(ctx, size, x, y, Math.max(rx, ry) + 6, (c) => {
      c.fillStyle = css(mix(body, MOSS_SHADOW, 0.55), 0.7);
      c.beginPath();
      c.ellipse(x + rx * 0.18, y + ry * 0.22, rx, ry, cl.rot, 0, TAU);
      c.fill();
      c.fillStyle = css(body, 0.78);
      c.beginPath();
      c.ellipse(x, y, rx, ry, cl.rot, 0, TAU);
      c.fill();
      c.fillStyle = css(mix(body, tone.light, 0.32), 0.34);
      c.beginPath();
      c.ellipse(x - rx * 0.2, y - ry * 0.24, rx * 0.42, ry * 0.32, cl.rot, 0, TAU);
      c.fill();
    });
  }
  // dark interstitial gaps keep the cushions from fusing into flat paint
  const irng = makeRNG(9182);
  for (let i = 0; i < 420; i++) {
    const x = irng() * size;
    const y = irng() * size;
    const r = 1.5 + irng() * 7;
    wrapDraw(ctx, size, x, y, r + 4, (c) => {
      c.fillStyle = css(MOSS_SHADOW, 0.12 + irng() * 0.24);
      c.beginPath();
      c.ellipse(x, y, r, r * (0.5 + irng() * 0.6), irng() * TAU, 0, TAU);
      c.fill();
    });
  }
  // fibre hairs give the velvety texture
  for (const h of hairs) {
    const x = h.x * scale;
    const y = h.y * scale;
    const len = h.len * scale;
    const col = h.tone > 0.6 ? MOSS_TONES[1].light : h.tone > 0.3 ? MOSS_TONES[0].mid : MOSS_TONES[0].dark;
    const ca = Math.cos(h.ang);
    const sa = Math.sin(h.ang);
    wrapDraw(ctx, size, x, y, len + 4, (c) => {
      c.strokeStyle = css(col, h.alpha);
      c.lineWidth = 0.8;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + ca * len, y + sa * len);
      c.stroke();
    });
  }
  // fuzzy fringe: pale fibres curling over the edge of each colony
  for (const f of fringe) {
    const x = f.x * scale;
    const y = f.y * scale;
    const len = f.len * scale;
    const ca = Math.cos(f.ang);
    const sa = Math.sin(f.ang);
    const col = f.tone > 0.5 ? MOSS_TONES[1].light : MOSS_TONES[0].mid;
    wrapDraw(ctx, size, x, y, len + 4, (c) => {
      c.strokeStyle = css(col, f.alpha * 0.7);
      c.lineWidth = 0.9;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + ca * len * 0.5, y + sa * len * 0.5 + 1.5, x + ca * len, y + sa * len);
      c.stroke();
    });
  }
  for (const sp of specks) {
    const x = sp.x * scale;
    const y = sp.y * scale;
    const r = Math.max(0.5, sp.r * scale);
    const col = sp.bright ? MOSS_TONES[1].light : MOSS_TONES[2].dark;
    wrapDraw(ctx, size, x, y, r + 3, (c) => {
      c.fillStyle = css(col, sp.bright ? 0.2 + sp.tone * 0.3 : 0.25 + sp.tone * 0.35);
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    });
  }
  // rainforest moss is damp and grey-green, not lime: knock the saturation and
  // value back a touch so it does not blow out under the warm dawn key light
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(46, 54, 42, 0.2)';
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
  return layer;
}

/** Knock a canvas down to the alpha of the moss mask. */
function maskLayer(layer, mask, size) {
  const ctx = ctxOf(layer);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0, size, size);
  ctx.restore();
  return layer;
}

/** Tint a masked layer to one flat colour (used for the moss cast shadow). */
function tintLayer(layer, size, color) {
  const out = el(size, size);
  const ctx = ctxOf(out);
  ctx.drawImage(layer, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  return out;
}

// ---------------------------------------------------------------------------
// block outlines
// ---------------------------------------------------------------------------
function blockPath(ctx, b) {
  const rng = makeRNG(b.seed + 1);
  const j = 2.2 + b.worn * 3.4;
  const r = 2 + rng() * 5;
  const { x, y, w, h } = b;
  ctx.beginPath();
  ctx.moveTo(x + r, y + (rng() - 0.5) * j);
  ctx.lineTo(x + w * 0.5, y + (rng() - 0.5) * j);
  ctx.lineTo(x + w - r, y + (rng() - 0.5) * j);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w + (rng() - 0.5) * j, y + h * 0.5);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h + (rng() - 0.5) * j);
  ctx.lineTo(x + w * 0.5, y + h + (rng() - 0.5) * j);
  ctx.lineTo(x + r, y + h + (rng() - 0.5) * j);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x + (rng() - 0.5) * j, y + h * 0.5);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y + (rng() - 0.5) * j);
  ctx.closePath();
}

function chipPath(ctx, b, cx, cy, size) {
  const rng = makeRNG(b.chip.seed);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + size * (0.6 + rng() * 0.5), cy + (rng() - 0.3) * size * 0.4);
  ctx.lineTo(cx + size * (0.2 + rng() * 0.4), cy + size * (0.5 + rng() * 0.4));
  ctx.lineTo(cx + (rng() - 0.5) * size * 0.3, cy + size * (0.7 + rng() * 0.3));
  ctx.closePath();
}

function chipCorner(b) {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ][b.chip.corner];
}

function blockBaseColor(b) {
  const grey = mix(mix(STONE_DARK, STONE_LIGHT, 0.22 + b.tone * 0.72), STONE_MID, 0.24);
  return mix(grey, b.cool > 0.5 ? BLUE_GREY : WARM_GREY, 0.16 + b.cool * 0.3);
}

// ---------------------------------------------------------------------------
// albedo: blocks
// ---------------------------------------------------------------------------
function drawPits(ctx, b, pits, scale = 1) {
  for (let i = 0; i < pits.count; i++) {
    const px = b.x + 5 + pits.rng() * (b.w - 10);
    const py = b.y + 5 + pits.rng() * (b.h - 10);
    const r = (0.5 + pits.rng() * 2.0) * Math.min(1.3, b.w / 140);
    ctx.fillStyle = `rgba(26,24,20,${(0.18 + pits.rng() * 0.24) * scale})`;
    ctx.beginPath();
    ctx.ellipse(px, py, r, r * (0.5 + pits.rng() * 0.6), pits.rng() * TAU, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(198,192,178,${(0.04 + pits.rng() * 0.08) * scale})`;
    ctx.beginPath();
    ctx.arc(px + r * 0.2, py + r * 0.6, r * 0.42, 0, TAU);
    ctx.fill();
  }
}

function drawBlockAlbedo(ctx, b) {
  const rng = makeRNG(b.seed + 3);
  const base = blockBaseColor(b);
  ctx.save();
  blockPath(ctx, b);
  ctx.clip();

  ctx.fillStyle = css(base);
  ctx.fillRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10);
  // top-lit / bottom-shadowed face
  const grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  grad.addColorStop(0, 'rgba(240,238,228,0.06)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(12,10,8,0.16)');
  ctx.fillStyle = grad;
  ctx.fillRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10);

  // per-block stone grain + broad mottling
  overlayNoise(ctx, S, S, { tile: 256, seed: b.seed % 977, alpha: 0.2, scale: 2, mode: 'overlay' });
  overlayNoise(ctx, S, S, { tile: 256, seed: b.seed % 881, alpha: 0.15, scale: 1, mode: 'overlay' });
  for (let i = 0; i < 4; i++) {
    const mx = b.x + rng() * b.w;
    const my = b.y + rng() * b.h;
    const mr = Math.max(b.w, b.h) * (0.25 + rng() * 0.5);
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
    const pale = rng() > 0.42;
    g.addColorStop(0, pale ? css(mix(base, STONE_LIGHT, 0.55), 0.07 + rng() * 0.08) : css(mix(base, WET_STONE, 0.75), 0.07 + rng() * 0.1));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  }

  // water staining: faint vertical runs down the face
  for (let i = 0; i < 2; i++) {
    if (rng() > 0.55) continue;
    const sx = b.x + b.w * (0.15 + rng() * 0.7);
    const sw = 4 + rng() * 16;
    const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    g.addColorStop(0, 'rgba(28,28,24,0.14)');
    g.addColorStop(0.7, 'rgba(28,28,24,0.06)');
    g.addColorStop(1, 'rgba(28,28,24,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - sw * 0.5, b.y, sw, b.h);
  }

  // recessed edge: the face sinks into the joint (contact AO on the inside)
  ctx.strokeStyle = 'rgba(14,12,9,0.34)';
  ctx.lineWidth = 12;
  blockPath(ctx, b);
  ctx.stroke();

  if (b.pits) {
    const prng = makeRNG(b.pits.seed);
    drawPits(ctx, b, { count: b.pits.count, rng: prng });
  }

  // hairline cracks through the block
  if (b.cracked) {
    const crng = makeRNG(b.cracked.seed);
    for (let i = 0; i < b.cracked.count; i++) {
      const x0 = b.x + b.w * (0.1 + crng() * 0.8);
      const y0 = b.y + crng() * b.h * 0.25;
      const len = b.h * (0.4 + crng() * 0.7);
      const drift = (crng() - 0.5) * b.w * 0.5;
      ctx.strokeStyle = `rgba(22,20,16,${0.4 + crng() * 0.3})`;
      ctx.lineWidth = 0.8 + crng() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + drift * 0.5, y0 + len * 0.5, x0 + drift, y0 + len);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(196,190,176,0.16)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x0 + 1.2, y0);
      ctx.quadraticCurveTo(x0 + drift * 0.5 + 1.2, y0 + len * 0.5, x0 + drift + 1.2, y0 + len);
      ctx.stroke();
    }
  }

  // pale lichen crust: flat, slightly chalky colonies
  if (b.lichen) {
    const lrng = makeRNG(b.lichen.seed);
    const col = b.lichen.cool ? LICHEN_COOL : LICHEN;
    for (let i = 0; i < b.lichen.count; i++) {
      const lx = b.x + 6 + lrng() * (b.w - 12);
      const ly = b.y + 6 + lrng() * (b.h - 12);
      const lr = Math.max(3, Math.min(b.w, b.h) * (0.04 + lrng() * 0.13));
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
      g.addColorStop(0, css(col, 0.16 + lrng() * 0.14));
      g.addColorStop(0.7, css(col, 0.09 + lrng() * 0.08));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(lx - lr, ly - lr, lr * 2, lr * 2);
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = css(col, 0.1 + lrng() * 0.18);
        ctx.beginPath();
        ctx.arc(lx + (lrng() - 0.5) * lr * 1.6, ly + (lrng() - 0.5) * lr * 1.6, 0.6 + lrng() * 1.6, 0, TAU);
        ctx.fill();
      }
    }
  }

  // damp stone: darker, greener base
  if (b.wet) {
    const wg = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    wg.addColorStop(0, 'rgba(20,24,18,0)');
    wg.addColorStop(1, 'rgba(20,26,18,0.26)');
    ctx.fillStyle = wg;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }

  // chipped corner: exposed inner rock in shadow
  if (b.chip) {
    const [cx, cy] = chipCorner(b);
    chipPath(ctx, b, cx, cy, b.w * b.chip.size);
    ctx.fillStyle = css(mix(WET_STONE, [24, 22, 18], 0.45));
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(12,10,8,0.4)';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200,194,178,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // weathering: dirt / water gathering in the lower part of the face
  const dust = ctx.createLinearGradient(0, b.y + b.h * 0.55, 0, b.y + b.h);
  dust.addColorStop(0, 'rgba(30,30,24,0)');
  dust.addColorStop(1, 'rgba(30,32,24,0.22)');
  ctx.fillStyle = dust;
  ctx.fillRect(b.x, b.y + b.h * 0.55, b.w, b.h * 0.45);

  // fine grit speckle
  for (let i = 0; i < 30; i++) {
    const gx = b.x + rng() * b.w;
    const gy = b.y + rng() * b.h;
    const gr = 0.4 + rng() * 1.2;
    ctx.fillStyle = rng() > 0.5
      ? `rgba(206,200,186,${0.05 + rng() * 0.15})`
      : `rgba(24,22,18,${0.05 + rng() * 0.14})`;
    ctx.beginPath();
    ctx.arc(gx, gy, gr, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // crisp bevel: lit top/left edge, shadowed bottom/right edge + contact AO
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(b.x + 3, b.y + 1.6);
  ctx.lineTo(b.x + b.w - 3, b.y + 1.6);
  ctx.moveTo(b.x + 1.6, b.y + 3);
  ctx.lineTo(b.x + 1.6, b.y + b.h - 3);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = 'rgba(240,238,226,0.2)';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x + 2, b.y + b.h - 1.8);
  ctx.lineTo(b.x + b.w - 2, b.y + b.h - 1.8);
  ctx.moveTo(b.x + b.w - 1.8, b.y + 2);
  ctx.lineTo(b.x + b.w - 1.8, b.y + b.h - 2);
  ctx.lineWidth = 2.8;
  ctx.strokeStyle = 'rgba(10,9,7,0.34)';
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// albedo: joints, weather, rain
// ---------------------------------------------------------------------------
function drawMortar(ctx) {
  fillCanvas(ctx, S, S, css(MORTAR_COL));
  const rng = makeRNG(911);
  for (let i = 0; i < 1600; i++) {
    const px = rng() * S;
    const py = rng() * S;
    const r = 0.4 + rng() * 1.5;
    ctx.fillStyle = css(mix(MORTAR_GRAIN, [60, 62, 44], rng()), 0.16 + rng() * 0.28);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    ctx.fill();
  }
}

function drawLargeWeather(ctx) {
  const rng = makeRNG(2024);
  for (let i = 0; i < 18; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 70 + rng() * 300;
    const dark = rng() > 0.38;
    wrapDraw(ctx, S, x, y, r + 8, (c) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, dark ? `rgba(28,30,23,${0.06 + rng() * 0.11})` : `rgba(196,190,172,${0.02 + rng() * 0.04})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  // rain streaks running down the wall
  const srng = makeRNG(77);
  for (let i = 0; i < 16; i++) {
    const x = srng() * S;
    const y0 = srng() * S * 0.35;
    const len = S * (0.28 + srng() * 0.5);
    const drift = (srng() - 0.5) * 26;
    const a = 0.05 + srng() * 0.07;
    wrapDraw(ctx, S, x, y0 + len * 0.5, len * 0.5 + 40, (c) => {
      const g = c.createLinearGradient(x, y0, x + drift, y0 + len);
      g.addColorStop(0, 'rgba(40,40,34,0)');
      g.addColorStop(0.35, `rgba(40,40,34,${a})`);
      g.addColorStop(1, 'rgba(40,40,34,0)');
      c.strokeStyle = g;
      c.lineWidth = 4 + srng() * 12;
      c.beginPath();
      c.moveTo(x, y0);
      c.lineTo(x + drift, y0 + len);
      c.stroke();
      // narrow sheen where the water runs
      c.strokeStyle = `rgba(150,160,152,${a * 0.55})`;
      c.lineWidth = 1.1;
      c.beginPath();
      c.moveTo(x - 1.5, y0 + len * 0.1);
      c.lineTo(x + drift - 1.5, y0 + len * 0.85);
      c.stroke();
    });
  }
  // airborne grit / mineral bloom
  const grng = makeRNG(1771);
  for (let i = 0; i < 4800; i++) {
    const px = grng() * S;
    const py = grng() * S;
    const r = 0.3 + grng() * 1.0;
    ctx.fillStyle = grng() > 0.52 ? `rgba(206,200,184,${0.04 + grng() * 0.11})` : `rgba(24,22,18,${0.04 + grng() * 0.1})`;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    ctx.fill();
  }
}

function drawJointMoss(ctx, blocks) {
  for (const b of blocks) {
    for (const m of b.jointMoss) {
      const rng = makeRNG(m.seed);
      wrapDraw(ctx, S, m.x, m.y, m.r + 8, (c) => {
        const g = c.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
        g.addColorStop(0, css(m.tone.mid, 0.42 + rng() * 0.2));
        g.addColorStop(0.65, css(m.tone.dark, 0.24));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
        c.fillStyle = css(m.tone.light, 0.2 + rng() * 0.2);
        c.beginPath();
        c.arc(m.x - m.r * 0.2, m.y - m.r * 0.35, m.r * 0.42, 0, TAU);
        c.fill();
      });
    }
  }
}

function drawRainOverMoss(ctx) {
  const rng = makeRNG(6122);
  for (let i = 0; i < 12; i++) {
    const x = rng() * S;
    const y0 = rng() * S;
    const len = 120 + rng() * 380;
    const a = 0.04 + rng() * 0.07;
    wrapDraw(ctx, S, x, y0 + len * 0.5, len * 0.5 + 30, (c) => {
      const g = c.createLinearGradient(x, y0, x + (rng() - 0.5) * 18, y0 + len);
      g.addColorStop(0, 'rgba(34,36,28,0)');
      g.addColorStop(0.4, `rgba(34,36,28,${a})`);
      g.addColorStop(1, 'rgba(34,36,28,0)');
      c.strokeStyle = g;
      c.lineWidth = 3 + rng() * 9;
      c.beginPath();
      c.moveTo(x, y0);
      c.lineTo(x + (rng() - 0.5) * 18, y0 + len);
      c.stroke();
    });
  }
}

// ---------------------------------------------------------------------------
// height
// ---------------------------------------------------------------------------
function drawBlockHeight(ctx, b) {
  const rng = makeRNG(b.seed + 5);
  ctx.save();
  blockPath(ctx, b);
  ctx.clip();
  const cx = b.x + b.w * 0.5;
  const cy = b.y + b.h * 0.5;
  const rad = Math.max(b.w, b.h) * 0.9;
  const hi = Math.round(clamp(b.top, 0, 1) * 255);
  const lo = Math.round(clamp(b.top * 0.3, 0, 1) * 255);
  const g = ctx.createRadialGradient(cx, cy, rad * 0.5, cx, cy, rad);
  g.addColorStop(0, gray(hi));
  g.addColorStop(0.78, gray(hi * 0.93));
  g.addColorStop(1, gray(lo));
  ctx.fillStyle = g;
  ctx.fillRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10);

  overlayNoise(ctx, HEIGHT_SIZE, HEIGHT_SIZE, { tile: 256, seed: b.seed % 991, alpha: 0.16, scale: 2, mode: 'overlay' });

  if (b.pits) {
    const prng = makeRNG(b.pits.seed + 1);
    for (let i = 0; i < b.pits.count; i++) {
      const px = b.x + 5 + prng() * (b.w - 10);
      const py = b.y + 5 + prng() * (b.h - 10);
      const r = (0.6 + prng() * 2.4) * Math.min(1.6, b.w / 120);
      ctx.fillStyle = 'rgba(16,16,16,0.8)';
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * (0.5 + prng() * 0.6), prng() * TAU, 0, TAU);
      ctx.fill();
    }
  }
  if (b.cracked) {
    const crng = makeRNG(b.cracked.seed + 1);
    for (let i = 0; i < b.cracked.count; i++) {
      const x0 = b.x + b.w * (0.1 + crng() * 0.8);
      const y0 = b.y + crng() * b.h * 0.25;
      const len = b.h * (0.4 + crng() * 0.7);
      const drift = (crng() - 0.5) * b.w * 0.5;
      ctx.strokeStyle = 'rgba(30,30,30,0.9)';
      ctx.lineWidth = 1.4 + crng() * 1.8;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + drift * 0.5, y0 + len * 0.5, x0 + drift, y0 + len);
      ctx.stroke();
    }
  }
  if (b.chip) {
    const [ccx, ccy] = chipCorner(b);
    chipPath(ctx, b, ccx, ccy, b.w * b.chip.size);
    ctx.fillStyle = gray(48);
    ctx.fill();
  }
  ctx.restore();
  void rng;
}

// ---------------------------------------------------------------------------
// roughness
// ---------------------------------------------------------------------------
function drawBlockRough(ctx, b) {
  ctx.save();
  blockPath(ctx, b);
  ctx.clip();
  let v = Math.round((b.wet ? 0.55 : 0.8 + b.worn * 0.12) * 255);
  v = Math.max(120, Math.min(240, v + Math.round((b.cool - 0.5) * 18)));
  ctx.fillStyle = gray(v);
  ctx.fillRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10);
  const cx = b.x + b.w * 0.5;
  const cy = b.y + b.h * 0.5;
  const rad = Math.max(b.w, b.h) * 0.75;
  const g = ctx.createRadialGradient(cx, cy, rad * 0.3, cx, cy, rad);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, `rgba(250,250,250,${0.06 + b.worn * 0.12})`);
  ctx.fillStyle = g;
  ctx.fillRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10);
  overlayNoise(ctx, S, S, { tile: 256, seed: b.seed % 983, alpha: 0.1, scale: 2, mode: 'overlay' });
  if (b.lichen) {
    const lrng = makeRNG(b.lichen.seed + 2);
    for (let i = 0; i < b.lichen.count; i++) {
      const lx = b.x + 6 + lrng() * (b.w - 12);
      const ly = b.y + 6 + lrng() * (b.h - 12);
      const lr = Math.max(3, Math.min(b.w, b.h) * (0.04 + lrng() * 0.13));
      const g2 = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
      g2.addColorStop(0, `rgba(244,244,244,${0.1 + lrng() * 0.14})`);
      g2.addColorStop(1, 'rgba(244,244,244,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(lx - lr, ly - lr, lr * 2, lr * 2);
    }
  }
  if (b.chip) {
    const [ccx, ccy] = chipCorner(b);
    chipPath(ctx, b, ccx, ccy, b.w * b.chip.size);
    ctx.fillStyle = gray(236);
    ctx.fill();
  }
  ctx.restore();
}

function drawRoughMossMask(rctx, mask) {
  // moss is matt: replace the stone roughness wherever moss grows
  const mossRough = el(S, S);
  const mctx = ctxOf(mossRough);
  fillCanvas(mctx, S, S, gray(238));
  mctx.globalCompositeOperation = 'destination-in';
  mctx.drawImage(mask, 0, 0, S, S);
  rctx.drawImage(mossRough, 0, 0);
}

function drawRoughWet(ctx) {
  const rng = makeRNG(6122);
  for (let i = 0; i < 14; i++) {
    const x = rng() * S;
    const y0 = rng() * S;
    const len = 140 + rng() * 380;
    const a = 0.3 + rng() * 0.3;
    wrapDraw(ctx, S, x, y0 + len * 0.5, len * 0.5 + 30, (c) => {
      const g = c.createLinearGradient(x, y0, x + (rng() - 0.5) * 18, y0 + len);
      g.addColorStop(0, 'rgba(110,110,110,0)');
      g.addColorStop(0.4, `rgba(110,110,110,${a})`);
      g.addColorStop(1, 'rgba(110,110,110,0)');
      c.strokeStyle = g;
      c.lineWidth = 4 + rng() * 10;
      c.beginPath();
      c.moveTo(x, y0);
      c.lineTo(x + (rng() - 0.5) * 18, y0 + len);
      c.stroke();
    });
  }
}

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------
export function makeMossStone(aniso, reg) {
  const rng = makeRNG(4242);
  const blocks = buildAshlar(rng);
  const mask = buildMossMask();
  const mossLayerRaw = drawMossLayer(S);
  const mossLayer = maskLayer(mossLayerRaw, mask, S);
  const mossShadow = tintLayer(mossLayer, S, css(MOSS_SHADOW));

  // ---- albedo -------------------------------------------------------------
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  drawMortar(ctx);
  for (const b of blocks) wrapDraw(ctx, S, b.x, b.y, b.w + 16, (c) => drawBlockAlbedo(c, b));
  drawLargeWeather(ctx);
  drawJointMoss(ctx, blocks);

  // dense moss colonies (masked, with a soft cast shadow onto the stone)
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.drawImage(mossShadow, 3, 4.5);
  ctx.restore();
  ctx.drawImage(mossLayer, 0, 0);
  drawRainOverMoss(ctx);
  overlayNoise(ctx, S, S, { tile: 256, seed: 861, alpha: 0.1, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.09, seed: 862 });

  // ---- height -------------------------------------------------------------
  const height = el(HEIGHT_SIZE, HEIGHT_SIZE);
  const hctx = ctxOf(height);
  fillCanvas(hctx, HEIGHT_SIZE, HEIGHT_SIZE, gray(54));
  for (const b of blocks) wrapDraw(hctx, HEIGHT_SIZE, b.x, b.y, b.w + 16, (c) => drawBlockHeight(c, b));
  // moss mounds: additive soft relief from the same mask
  hctx.save();
  hctx.globalCompositeOperation = 'lighter';
  hctx.globalAlpha = 0.22;
  hctx.drawImage(mask, 0, 0, HEIGHT_SIZE, HEIGHT_SIZE);
  hctx.restore();
  // and the joint moss clumps sit proud of the joints
  for (const b of blocks) {
    for (const m of b.jointMoss) {
      const mrng = makeRNG(m.seed + 3);
      wrapDraw(hctx, HEIGHT_SIZE, m.x, m.y, m.r + 6, (c) => {
        const g = c.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
        g.addColorStop(0, gray(150 + mrng() * 60));
        g.addColorStop(1, 'rgba(90,90,90,0)');
        c.fillStyle = g;
        c.fillRect(m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
      });
    }
  }
  overlayNoise(hctx, HEIGHT_SIZE, HEIGHT_SIZE, { tile: 256, seed: 863, alpha: 0.14, scale: 1, mode: 'overlay' });
  overlayGrain(hctx, HEIGHT_SIZE, HEIGHT_SIZE, { alpha: 0.09, seed: 864 });

  // ---- roughness ----------------------------------------------------------
  const rough = el(S, S);
  const rctx = ctxOf(rough);
  fillCanvas(rctx, S, S, gray(248)); // recessed joints stay dusty / matt
  for (const b of blocks) wrapDraw(rctx, S, b.x, b.y, b.w + 16, (c) => drawBlockRough(c, b));
  drawRoughMossMask(rctx, mask);
  for (const b of blocks) {
    for (const m of b.jointMoss) {
      wrapDraw(rctx, S, m.x, m.y, m.r + 6, (c) => {
        const g = c.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
        g.addColorStop(0, 'rgba(244,244,244,0.85)');
        g.addColorStop(0.7, 'rgba(244,244,244,0.5)');
        g.addColorStop(1, 'rgba(244,244,244,0)');
        c.fillStyle = g;
        c.fillRect(m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
      });
    }
  }
  drawRoughWet(rctx);
  overlayNoise(rctx, S, S, { tile: 256, seed: 865, alpha: 0.08, scale: 1, mode: 'overlay' });
  overlayGrain(rctx, S, S, { alpha: 0.06, seed: 866 });

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, NORMAL_STRENGTH, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
