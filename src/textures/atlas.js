/**
 * SANDSTRIKE // atlas helpers for painted-paper materials.
 *
 * Cell addressing + per-cell weather passes used by posters.js and decals.js.
 */
import { makeRNG } from '../utils.js';
import { TAU } from './core.js';

export function atlasCell(size, cols, rows, col, row) {
  return {
    u0: col / cols,
    u1: (col + 1) / cols,
    v0: 1 - (row + 1) / rows,
    v1: 1 - row / rows,
  };
}

export function drawCell(ctx, size, cols, rows, col, row, fn) {
  const cw = size / cols;
  const ch = size / rows;
  ctx.save();
  ctx.translate(col * cw, row * ch);
  ctx.beginPath();
  ctx.rect(0, 0, cw, ch);
  ctx.clip();
  fn(ctx, cw, ch);
  ctx.restore();
}

export function weatherCell(ctx, w, h, seed, strength = 1) {
  const rng = makeRNG(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 170 * strength; i++) {
    ctx.globalAlpha = 0.12 + rng() * 0.4;
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * h, 0.5 + rng() * 2.6, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
