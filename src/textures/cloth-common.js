/**
 * SANDSTRIKE // cloth & banner drawing helpers.
 *
 * Shared by cloth.js (awnings / tarps / shade cloth) and banners.js so fold
 * shading, torn edges and worn stencils stay consistent across fabric types.
 */
import { makeRNG } from '../utils.js';
import { FONT_DISPLAY, TAU, ctxOf } from './core.js';

/** Draw worn stencil text: paint, then punch small holes so it reads as weathered. */
export function stencilText(ctx, text, x, y, { font = FONT_DISPLAY, size = 64, color = '#e9dcc0', align = 'center', alpha = 0.92, wear = 0.28, seed = 3 } = {}) {
  const rng = makeRNG(seed);
  ctx.save();
  ctx.font = `900 ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
  if (wear > 0) {
    // erase speckles for a sprayed, chipped look
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const w = ctx.canvas.width;
    const hh = ctx.canvas.height;
    for (let i = 0; i < 220 * wear; i++) {
      const px = rng() * w;
      const py = rng() * hh;
      ctx.globalAlpha = 0.25 + rng() * 0.5;
      ctx.beginPath();
      ctx.arc(px, py, 0.6 + rng() * 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Torn cloth silhouette punched out of an already drawn banner canvas. */
export function tearClothEdges(canvas, { bottom = true, sides = true, seed = 9, depth = 26 } = {}) {
  const ctx = ctxOf(canvas);
  const w = canvas.width;
  const h = canvas.height;
  const rng = makeRNG(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  if (bottom) {
    ctx.beginPath();
    ctx.moveTo(0, h - 2);
    let x = 0;
    while (x < w) {
      const step = 6 + rng() * 16;
      const d = rng() * depth;
      ctx.lineTo(x + step * 0.5, h - d - 2);
      x += step;
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
  if (sides) {
    for (let s = 0; s < 2; s++) {
      ctx.beginPath();
      const x0 = s === 0 ? 0 : w;
      ctx.moveTo(x0, 0);
      let y = 0;
      while (y < h) {
        const step = 18 + rng() * 30;
        const d = rng() * 5;
        ctx.lineTo(s === 0 ? d : w - d, y + step * 0.5);
        y += step;
      }
      ctx.lineTo(x0, h);
      ctx.closePath();
      ctx.fill();
    }
  }
  // a few moth holes
  for (let i = 0; i < 10; i++) {
    ctx.globalAlpha = 0.5 + rng() * 0.5;
    ctx.beginPath();
    ctx.ellipse(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 2, rng() * TAU, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Soft cloth fold shading pass. */
export function shadeFolds(ctx, w, h, { count = 8, vertical = true, alpha = 0.09, seed = 4 } = {}) {
  const rng = makeRNG(seed);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const p = rng();
    const g = vertical
      ? ctx.createLinearGradient(p * w, 0, p * w + 40 + rng() * 90, 0)
      : ctx.createLinearGradient(0, p * h, 0, p * h + 40 + rng() * 90);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, `rgba(0,0,0,${alpha + rng() * alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}
