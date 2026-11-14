/**
 * SANDSTRIKE // island woven texture set  (lib.woven)
 *
 * Used by materials: woven / rope  (hut walls, mats, fences, nets, lashings)
 *
 * Coarse plain-weave mat of split bamboo/cane strips with coir rope cords
 * twisted in every few courses. Weft strips run along U, warp strips along V;
 * every crossing alternates over/under, so the surface gets real thickness
 * (lit top edge, shadowed lower edge, cast shadow of the strip on top).
 *
 * 1 tile = 1.5 m, 1024 px square. Both axes wrap; strip widths/heights are
 * irregular so the weave does not read as a perfect grid.
 *
 * Texture set contract:
 *   map            albedo        sRGB
 *   normalMap      tangent space  linear (Sobel height canvas)
 *   roughnessMap   linear
 *
 * Everything here is drawn with Canvas2D at load time; tune the TUNING block.
 */
import { clamp, makeRNG } from '../utils.js';
import { TAU, ctxOf, el, fillCanvas, normalFromHeightCanvas, overlayGrain, overlayNoise, textureFromCanvas } from './core.js';

// ---------------------------------------------------------------------------
// TUNING
// ---------------------------------------------------------------------------
const S = 1024;              // 1 tile = 1.5 m
const NORMAL_STRENGTH = 3.2;
const COLS = 8;              // warp strips across U
const ROWS = 10;             // weft strips down V
const GAP = 5;               // gap between strips (px)
const ROPE_ROWS = [2, 7];    // weft courses that are coir cord instead of bamboo
const GRAIN = 55;            // fibre strokes per strip

// palette (ISLAND_ASSETS.md §1.2: bamboo #a9a86a -> #8d8c55, rope/coir brown)
const BAMBOO_LIGHT = [186, 163, 108];
const BAMBOO_MID = [156, 133, 82];
const BAMBOO_DARK = [96, 78, 46];
const CANE_GREEN = [160, 152, 96];
const ROPE_LIGHT = [206, 175, 124];
const ROPE_MID = [166, 132, 86];
const ROPE_DARK = [86, 63, 36];
const GAP_COL = [44, 33, 20];
const DIRT = [66, 52, 32];

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

function partition(total, parts, rng, spread = 0.4) {
  const raw = [];
  let sum = 0;
  for (let i = 0; i < parts; i++) {
    const v = 1 - spread / 2 + rng() * spread;
    raw.push(v);
    sum += v;
  }
  const out = raw.map((v) => Math.max(28, Math.round((v / sum) * total)));
  let diff = total - out.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (diff !== 0 && guard++ < 4096) {
    for (let i = 0; i < out.length && diff !== 0; i++) {
      const step = diff > 0 ? 1 : -1;
      if (out[i] + step > 24) {
        out[i] += step;
        diff -= step;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------
function buildLayout() {
  const rng = makeRNG(3200);
  const colWidths = partition(S, COLS, rng, 0.44);
  const rowHeights = partition(S, ROWS, rng, 0.3);

  const cols = [];
  let x = 0;
  for (let c = 0; c < COLS; c++) {
    const r = makeRNG(7000 + c * 53);
    const green = r() < 0.3;
    cols.push({
      index: c,
      x,
      w: colWidths[c],
      tone: r(),
      green,
      split: r() < 0.4 ? { at: 0.25 + r() * 0.5, len: 0.2 + r() * 0.6, seed: Math.floor(r() * 1e9) } : null,
      seed: 7000 + c * 53,
    });
    x += colWidths[c];
  }

  const rows = [];
  let y = 0;
  for (let ri = 0; ri < ROWS; ri++) {
    const r = makeRNG(8000 + ri * 71);
    const rope = ROPE_ROWS.includes(ri);
    rows.push({
      index: ri,
      y,
      h: rowHeights[ri],
      rope,
      tone: r(),
      green: !rope && r() < 0.26,
      split: !rope && r() < 0.45 ? { at: 0.2 + r() * 0.6, len: 0.2 + r() * 0.7, seed: Math.floor(r() * 1e9) } : null,
      twist: rope ? Math.max(8, Math.round(S / (rowHeights[ri] * 0.62))) : 0,
      seed: 8000 + ri * 71,
    });
    y += rowHeights[ri];
  }
  return { cols, rows };
}

/** Physical band of a weft strip (clipped so strips meet the tile border). */
function rowBand(row, pad) {
  return { y0: row.y - pad, y1: row.y + row.h + pad };
}

function stripTone(strip, base) {
  return strip.green ? mix(base, CANE_GREEN, 0.55) : base;
}

// ---------------------------------------------------------------------------
// albedo
// ---------------------------------------------------------------------------
function drawGapBase(ctx) {
  fillCanvas(ctx, S, S, css(GAP_COL));
  const rng = makeRNG(4411);
  // loose fibre packed into the seams
  for (let i = 0; i < 900; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 6 + rng() * 30;
    const ang = rng() * TAU;
    const pale = rng() > 0.5;
    repeatDraw(ctx, S, S, x, y, 34, 34, (cx) => {
      cx.strokeStyle = pale ? `rgba(196,172,124,${0.05 + rng() * 0.1})` : `rgba(30,22,12,${0.08 + rng() * 0.16})`;
      cx.lineWidth = 0.5 + rng() * 1.4;
      cx.beginPath();
      cx.moveTo(x, y);
      cx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len * 0.7);
      cx.stroke();
    });
  }
}

function drawWeftStrip(ctx, row) {
  const rng = makeRNG(row.seed + 3);
  const band = rowBand(row, 1);
  const mid = row.h / 2;

  if (row.rope) {
    // ---- twisted coir cord --------------------------------------------------
    const base = mix(ROPE_DARK, ROPE_LIGHT, 0.45 + row.tone * 0.4);
    const g = ctx.createLinearGradient(0, row.y, 0, row.y + row.h);
    g.addColorStop(0, css(mix(base, ROPE_DARK, 0.45)));
    g.addColorStop(0.25, css(base));
    g.addColorStop(0.55, css(mix(base, ROPE_LIGHT, 0.35)));
    g.addColorStop(0.85, css(mix(base, ROPE_DARK, 0.5)));
    g.addColorStop(1, css(mix(base, ROPE_DARK, 0.72)));
    ctx.fillStyle = g;
    ctx.fillRect(0, band.y0, S, row.h + 2);

    // 3-ply twist: helical strands all leaning the same way along the cord
    const n = row.twist;
    for (let i = 0; i < n; i++) {
      const cx0 = i * (S / n);
      const x0 = cx0 - row.h * 0.62;
      const x1 = cx0 + row.h * 0.62;
      repeatDraw(ctx, S, S, cx0, row.y + mid, row.h, 0, (cx) => {
        cx.save();
        cx.beginPath();
        cx.rect(0, row.y + 1, S, row.h - 2);
        cx.clip();
        // shadowed groove between the strands
        cx.strokeStyle = `rgba(${Math.round(ROPE_DARK[0] * 0.9)},${Math.round(ROPE_DARK[1] * 0.9)},${Math.round(ROPE_DARK[2] * 0.9)},0.5)`;
        cx.lineWidth = row.h * 0.24;
        cx.beginPath();
        cx.moveTo(x0, row.y + 1);
        cx.lineTo(x1, row.y + row.h - 1);
        cx.stroke();
        // lit strand face
        cx.strokeStyle = css(mix(ROPE_MID, ROPE_LIGHT, 0.55), 0.4);
        cx.lineWidth = row.h * 0.16;
        cx.beginPath();
        cx.moveTo(x0 + row.h * 0.2, row.y + 1);
        cx.lineTo(x1 + row.h * 0.2, row.y + row.h - 1);
        cx.stroke();
        // crimped coir hairs along the strand
        cx.strokeStyle = `rgba(232,204,158,${0.08 + rng() * 0.14})`;
        cx.lineWidth = 0.8;
        cx.beginPath();
        cx.moveTo(x0 + row.h * 0.34, row.y + 1);
        cx.lineTo(x1 + row.h * 0.34, row.y + row.h - 1);
        cx.stroke();
        cx.restore();
      });
    }
    // frayed coir hairs running along the cord
    for (let i = 0; i < 90; i++) {
      const x = rng() * S;
      const yy = row.y + 1 + rng() * (row.h - 2);
      const len = 10 + rng() * 46;
      const v = rng() > 0.5;
      repeatDraw(ctx, S, S, x, yy, len + 6, 0, (cx) => {
        cx.strokeStyle = v ? `rgba(224,196,150,${0.06 + rng() * 0.16})` : `rgba(50,36,20,${0.08 + rng() * 0.18})`;
        cx.lineWidth = 0.5 + rng() * 1.2;
        cx.beginPath();
        cx.moveTo(x, yy);
        cx.quadraticCurveTo(x + len * 0.5, yy + (rng() - 0.5) * 4, x + len, yy + (rng() - 0.5) * 3);
        cx.stroke();
      });
    }
    // cord shadow cast on whatever is behind it
    const sh = ctx.createLinearGradient(0, row.y + row.h * 0.72, 0, row.y + row.h + GAP + 3);
    sh.addColorStop(0, 'rgba(12,8,3,0)');
    sh.addColorStop(1, 'rgba(12,8,3,0.5)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, row.y + row.h * 0.72, S, row.h * 0.4 + GAP + 3);
    // bottom edge is in shadow, top edge catches light
    ctx.fillStyle = 'rgba(18,12,5,0.55)';
    ctx.fillRect(0, row.y + row.h - 1.2, S, 1.6);
    ctx.fillStyle = 'rgba(240,214,170,0.2)';
    ctx.fillRect(0, row.y + 0.8, S, 1.4);
    return;
  }

  // ---- split bamboo / cane strip -------------------------------------------
  const base = stripTone(row, mix(BAMBOO_MID, BAMBOO_LIGHT, 0.26 + row.tone * 0.34));
  const g = ctx.createLinearGradient(0, row.y, 0, row.y + row.h);
  g.addColorStop(0, css(mix(base, BAMBOO_DARK, 0.5)));
  g.addColorStop(0.16, css(mix(base, BAMBOO_LIGHT, 0.18)));
  g.addColorStop(0.42, css(base));
  g.addColorStop(0.74, css(mix(base, BAMBOO_DARK, 0.28)));
  g.addColorStop(1, css(mix(base, BAMBOO_DARK, 0.6)));
  ctx.fillStyle = g;
  ctx.fillRect(0, band.y0, S, row.h + 2);

  // lengthwise fibre grain
  for (let i = 0; i < GRAIN; i++) {
    const fy = row.y + 1 + rng() * (row.h - 2);
    const k = 1 + Math.floor(rng() * 3);
    const ph = rng() * TAU;
    const amp = 0.4 + rng() * 1.6;
    const pale = rng() > 0.48;
    ctx.strokeStyle = pale
      ? `rgba(228,208,166,${0.05 + rng() * 0.13})`
      : `rgba(44,32,16,${0.05 + rng() * 0.14})`;
    ctx.lineWidth = 0.6 + rng() * 1.3;
    ctx.beginPath();
    for (let x = 0; x <= S; x += 16) {
      const yy = fy + Math.sin(TAU * ((x / S) * k) + ph) * amp;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  // split: a dark lengthwise wound exposing pale inner fibre
  if (row.split) {
    const r0 = makeRNG(row.split.seed);
    const y0 = row.y + row.split.at * row.h;
    const x0 = r0() * S;
    const len = row.split.len * S;
    const pad = len * 0.5 + 8;
    repeatDraw(ctx, S, S, x0 + len * 0.5, y0, pad, 2, (cx) => {
      cx.strokeStyle = 'rgba(56,40,20,0.7)';
      cx.lineWidth = 1.8;
      cx.beginPath();
      cx.moveTo(x0, y0);
      cx.lineTo(x0 + len, y0 + (r0() - 0.5) * 2);
      cx.stroke();
      cx.strokeStyle = 'rgba(232,212,170,0.35)';
      cx.lineWidth = 0.9;
      cx.beginPath();
      cx.moveTo(x0, y0 + 1.4);
      cx.lineTo(x0 + len, y0 + 1.4 + (r0() - 0.5) * 2);
      cx.stroke();
    });
  }

  // strip edges: shadow below, light above (thickness)
  ctx.fillStyle = 'rgba(18,12,5,0.5)';
  ctx.fillRect(0, row.y + row.h - 1.4, S, 1.8);
  ctx.fillStyle = 'rgba(236,214,170,0.16)';
  ctx.fillRect(0, row.y + 0.8, S, 1.4);
  // damp / dirty patches
  for (let i = 0; i < 3; i++) {
    const x = rng() * S;
    const yy = row.y + rng() * row.h;
    const r = 20 + rng() * 90;
    repeatDraw(ctx, S, S, x, yy, r + 8, 6, (cx) => {
      const rg = cx.createRadialGradient(x, yy, 0, x, yy, r);
      rg.addColorStop(0, `rgba(58,44,26,${0.04 + rng() * 0.07})`);
      rg.addColorStop(1, 'rgba(58,44,26,0)');
      cx.fillStyle = rg;
      cx.fillRect(x - r, yy - r, r * 2, r * 2);
    });
  }
}

function drawWarpSegments(ctx, cols, rows) {
  for (const col of cols) {
    const rng = makeRNG(col.seed + 5);
    const base = stripTone(col, mix(BAMBOO_MID, BAMBOO_LIGHT, 0.28 + col.tone * 0.34));
    for (const row of rows) {
      const over = (row.index + col.index) % 2 === 0;
      if (!over) continue;
      const y0 = row.y - 3;
      const y1 = row.y + row.h + 3;
      const pad = 12;
      // cast shadow of the warp strip onto the weft below
      ctx.fillStyle = 'rgba(14,9,3,0.3)';
      ctx.fillRect(col.x - pad + 2.5, y0 + 2.5, col.w + pad * 2, y1 - y0);
      // strip body: lit left edge, shadowed right edge
      const g = ctx.createLinearGradient(col.x - pad, 0, col.x + col.w + pad, 0);
      g.addColorStop(0, css(mix(base, BAMBOO_DARK, 0.5)));
      g.addColorStop(0.12, css(mix(base, BAMBOO_LIGHT, 0.18)));
      g.addColorStop(0.38, css(base));
      g.addColorStop(0.72, css(mix(base, BAMBOO_DARK, 0.26)));
      g.addColorStop(1, css(mix(base, BAMBOO_DARK, 0.55)));
      ctx.fillStyle = g;
      ctx.fillRect(col.x - pad, y0, col.w + pad * 2, y1 - y0);

      // longitudinal fibre grain (periodic in V so it wraps)
      for (let i = 0; i < GRAIN; i++) {
        const cx = col.x + 1 + rng() * (col.w - 2);
        const k = 1 + Math.floor(rng() * 3);
        const ph = rng() * TAU;
        const amp = 0.4 + rng() * 1.7;
        const pale = rng() > 0.48;
        ctx.strokeStyle = pale
          ? `rgba(230,210,168,${0.05 + rng() * 0.12})`
          : `rgba(44,32,16,${0.05 + rng() * 0.13})`;
        ctx.lineWidth = 0.6 + rng() * 1.3;
        ctx.beginPath();
        for (let y = 0; y <= S; y += 16) {
          const xx = cx + Math.sin(TAU * ((y / S) * k) + ph) * amp;
          if (y === 0) ctx.moveTo(xx, y);
          else ctx.lineTo(xx, y);
        }
        ctx.stroke();
      }

      // split in the warp strip
      if (col.split) {
        const sr = makeRNG(col.split.seed);
        const x0 = col.x + col.split.at * col.w;
        const yy0 = sr() * S;
        const len = col.split.len * S;
        const spad = len * 0.5 + 8;
        repeatDraw(ctx, S, S, x0, yy0 + len * 0.5, 4, spad, (cx) => {
          cx.strokeStyle = 'rgba(56,40,20,0.65)';
          cx.lineWidth = 1.7;
          cx.beginPath();
          cx.moveTo(x0, yy0);
          cx.lineTo(x0 + (sr() - 0.5) * 2, yy0 + len);
          cx.stroke();
          cx.strokeStyle = 'rgba(232,212,170,0.3)';
          cx.lineWidth = 0.8;
          cx.beginPath();
          cx.moveTo(x0 + 1.2, yy0);
          cx.lineTo(x0 + 1.2, yy0 + len);
          cx.stroke();
        });
      }

      // segment edges (thickness): top lip lit, bottom edge shadowed
      ctx.fillStyle = 'rgba(240,218,174,0.16)';
      ctx.fillRect(col.x - pad, y0, col.w + pad * 2, 1.6);
      ctx.fillStyle = 'rgba(14,9,3,0.5)';
      ctx.fillRect(col.x - pad, y1 - 2, col.w + pad * 2, 2.4);
    }
  }
}

function drawLooseFibres(ctx) {
  const rng = makeRNG(8811);
  for (let i = 0; i < 160; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 8 + rng() * 40;
    const ang = rng() * TAU;
    const pale = rng() > 0.4;
    repeatDraw(ctx, S, S, x, y, len + 8, len * 0.5 + 8, (cx) => {
      cx.strokeStyle = pale
        ? `rgba(226,200,152,${0.1 + rng() * 0.22})`
        : `rgba(52,38,20,${0.1 + rng() * 0.2})`;
      cx.lineWidth = 0.5 + rng() * 1.1;
      cx.beginPath();
      cx.moveTo(x, y);
      cx.quadraticCurveTo(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.6, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      cx.stroke();
    });
  }
}

function drawWeather(ctx) {
  const rng = makeRNG(5511);
  for (let i = 0; i < 10; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 90 + rng() * 260;
    const pale = rng() > 0.45;
    const a = 0.03 + rng() * 0.05;
    repeatDraw(ctx, S, S, x, y, r + 8, r + 8, (cx) => {
      const g = cx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, pale ? `rgba(236,214,168,${a})` : `rgba(70,52,30,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g;
      cx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  // dirt caught in the weave
  for (let i = 0; i < 700; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 0.4 + rng() * 1.8;
    ctx.fillStyle = rng() > 0.5 ? css(mix(DIRT, [150, 130, 96], rng()), 0.1 + rng() * 0.2) : `rgba(30,22,12,${0.08 + rng() * 0.14})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  overlayNoise(ctx, S, S, { tile: 256, seed: 831, alpha: 0.14, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.12, seed: 832 });
}

// ---------------------------------------------------------------------------
// height
// ---------------------------------------------------------------------------
function drawHeightBase(ctx) {
  fillCanvas(ctx, S, S, 'rgb(74,74,74)');
  const rng = makeRNG(4411);
  for (let i = 0; i < 700; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 6 + rng() * 26;
    const ang = rng() * TAU;
    const v = Math.round(58 + rng() * 40);
    repeatDraw(ctx, S, S, x, y, 34, 34, (cx) => {
      cx.strokeStyle = `rgba(${v},${v},${v},${0.2 + rng() * 0.3})`;
      cx.lineWidth = 0.6 + rng() * 1.4;
      cx.beginPath();
      cx.moveTo(x, y);
      cx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len * 0.7);
      cx.stroke();
    });
  }
}

function drawWeftHeight(ctx, row) {
  const rng = makeRNG(row.seed + 7);
  if (row.rope) {
    const g = ctx.createLinearGradient(0, row.y, 0, row.y + row.h);
    g.addColorStop(0, 'rgb(150,150,150)');
    g.addColorStop(0.3, 'rgb(238,238,238)');
    g.addColorStop(0.6, 'rgb(226,226,226)');
    g.addColorStop(1, 'rgb(138,138,138)');
    ctx.fillStyle = g;
    ctx.fillRect(0, row.y - 1, S, row.h + 2);
    // twist grooves carved into the cord
    const n = row.twist;
    for (let i = 0; i < n; i++) {
      const cx0 = i * (S / n);
      const dir = i % 2 === 0 ? 1 : -1;
      repeatDraw(ctx, S, S, cx0, row.y + row.h * 0.5, row.h, 0, (cx) => {
        cx.strokeStyle = 'rgba(120,120,120,0.6)';
        cx.lineWidth = 2.4;
        cx.beginPath();
        cx.moveTo(cx0 - row.h * 0.55, row.y + (dir > 0 ? 2 : row.h - 2));
        cx.lineTo(cx0 + row.h * 0.55, row.y + (dir > 0 ? row.h - 2 : 2));
        cx.stroke();
      });
    }
    return;
  }
  const g = ctx.createLinearGradient(0, row.y, 0, row.y + row.h);
  g.addColorStop(0, 'rgb(126,126,126)');
  g.addColorStop(0.2, 'rgb(200,200,200)');
  g.addColorStop(0.5, 'rgb(214,214,214)');
  g.addColorStop(0.85, 'rgb(176,176,176)');
  g.addColorStop(1, 'rgb(120,120,120)');
  ctx.fillStyle = g;
  ctx.fillRect(0, row.y - 1, S, row.h + 2);
  // fibre ridges
  for (let i = 0; i < GRAIN; i++) {
    const fy = row.y + 1 + rng() * (row.h - 2);
    const k = 1 + Math.floor(rng() * 3);
    const ph = rng() * TAU;
    const amp = 0.4 + rng() * 1.6;
    const v = Math.round(150 + rng() * 80);
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.2 + rng() * 0.25})`;
    ctx.lineWidth = 0.7 + rng() * 1.1;
    ctx.beginPath();
    for (let x = 0; x <= S; x += 16) {
      const yy = fy + Math.sin(TAU * ((x / S) * k) + ph) * amp;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  if (row.split) {
    const r0 = makeRNG(row.split.seed + 1);
    const y0 = row.y + row.split.at * row.h;
    const x0 = r0() * S;
    const len = row.split.len * S;
    repeatDraw(ctx, S, S, x0 + len * 0.5, y0, len * 0.5 + 8, 2, (cx) => {
      cx.strokeStyle = 'rgba(60,60,60,0.85)';
      cx.lineWidth = 2.2;
      cx.beginPath();
      cx.moveTo(x0, y0);
      cx.lineTo(x0 + len, y0);
      cx.stroke();
    });
  }
}

function drawWarpHeight(ctx, cols, rows) {
  for (const col of cols) {
    const rng = makeRNG(col.seed + 9);
    for (const row of rows) {
      const over = (row.index + col.index) % 2 === 0;
      if (!over) continue;
      const y0 = row.y - 3;
      const y1 = row.y + row.h + 3;
      const pad = 12;
      // drop shadow gap around the strip
      ctx.fillStyle = 'rgba(48,48,48,0.75)';
      ctx.fillRect(col.x - pad + 1.5, y0 + 1.5, col.w + pad * 2, y1 - y0);
      const g = ctx.createLinearGradient(col.x - pad, 0, col.x + col.w + pad, 0);
      g.addColorStop(0, 'rgb(140,140,140)');
      g.addColorStop(0.18, 'rgb(240,240,240)');
      g.addColorStop(0.42, 'rgb(224,224,224)');
      g.addColorStop(0.8, 'rgb(180,180,180)');
      g.addColorStop(1, 'rgb(132,132,132)');
      ctx.fillStyle = g;
      ctx.fillRect(col.x - pad, y0, col.w + pad * 2, y1 - y0);
      for (let i = 0; i < GRAIN; i++) {
        const cx = col.x + 1 + rng() * (col.w - 2);
        const k = 1 + Math.floor(rng() * 3);
        const ph = rng() * TAU;
        const amp = 0.4 + rng() * 1.6;
        const v = Math.round(150 + rng() * 80);
        ctx.strokeStyle = `rgba(${v},${v},${v},${0.2 + rng() * 0.24})`;
        ctx.lineWidth = 0.7 + rng() * 1.1;
        ctx.beginPath();
        for (let y = 0; y <= S; y += 16) {
          const xx = cx + Math.sin(TAU * ((y / S) * k) + ph) * amp;
          if (y === 0) ctx.moveTo(xx, y);
          else ctx.lineTo(xx, y);
        }
        ctx.stroke();
      }
      if (col.split) {
        const sr = makeRNG(col.split.seed + 1);
        const x0 = col.x + col.split.at * col.w;
        const yy0 = sr() * S;
        const len = col.split.len * S;
        repeatDraw(ctx, S, S, x0, yy0 + len * 0.5, 4, len * 0.5 + 8, (cx) => {
          cx.strokeStyle = 'rgba(60,60,60,0.8)';
          cx.lineWidth = 2;
          cx.beginPath();
          cx.moveTo(x0, yy0);
          cx.lineTo(x0, yy0 + len);
          cx.stroke();
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// roughness
// ---------------------------------------------------------------------------
function drawRough(ctx, cols, rows) {
  fillCanvas(ctx, S, S, 'rgb(246,246,246)'); // seams are dusty / matt
  const addStrip = (x, y, w, h, v, acrossIsVertical) => {
    const g = acrossIsVertical
      ? ctx.createLinearGradient(0, y, 0, y + h)
      : ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, `rgb(${v + 26},${v + 26},${v + 26})`);
    g.addColorStop(0.5, `rgb(${v},${v},${v})`);
    g.addColorStop(1, `rgb(${v + 22},${v + 22},${v + 22})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  for (const row of rows) {
    addStrip(0, row.y, S, row.h, row.rope ? 232 : 198, true);
  }
  for (const col of cols) {
    for (const row of rows) {
      const over = (row.index + col.index) % 2 === 0;
      if (!over) continue;
      addStrip(col.x - 12, row.y - 3, col.w + 24, row.h + 6, 204, false);
    }
  }
  // bleached / handled strips polish up a little
  const rng = makeRNG(6611);
  for (let i = 0; i < 26; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 40 + rng() * 130;
    repeatDraw(ctx, S, S, x, y, r + 8, r + 8, (cx) => {
      const g = cx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(150,150,150,${0.05 + rng() * 0.08})`);
      g.addColorStop(1, 'rgba(150,150,150,0)');
      cx.fillStyle = g;
      cx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  overlayNoise(ctx, S, S, { tile: 256, seed: 833, alpha: 0.09, scale: 1, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.07, seed: 834 });
}

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------
export function makeWoven(aniso, reg) {
  const { cols, rows } = buildLayout();

  // ---- albedo -------------------------------------------------------------
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  drawGapBase(ctx);
  for (const row of rows) drawWeftStrip(ctx, row);
  drawWarpSegments(ctx, cols, rows);
  drawLooseFibres(ctx);
  drawWeather(ctx);

  // ---- height -------------------------------------------------------------
  const height = el(S, S);
  const hctx = ctxOf(height);
  drawHeightBase(hctx);
  for (const row of rows) drawWeftHeight(hctx, row);
  drawWarpHeight(hctx, cols, rows);
  overlayNoise(hctx, S, S, { tile: 256, seed: 835, alpha: 0.13, scale: 1, mode: 'overlay' });
  overlayGrain(hctx, S, S, { alpha: 0.08, seed: 836 });

  // ---- roughness ----------------------------------------------------------
  const rough = el(S, S);
  drawRough(ctxOf(rough), cols, rows);

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, NORMAL_STRENGTH, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
