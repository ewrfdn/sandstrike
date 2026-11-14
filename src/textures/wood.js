/**
 * SANDSTRIKE // wood texture set  (lib.wood)
 *
 * Used by materials: wood / woodDark / bark
 *
 * Texture set contract:
 *   map            albedo        sRGB
 *   normalMap      tangent space  linear (Sobel from a 512px height canvas)
 *   roughnessMap   linear         (packed ORM for metal/rust/sheet)
 *   ormMap         R=AO G=rough B=metal  (metal surfaces only)
 *
 * Everything here is drawn with Canvas2D at load time; tune the constants in
 * this file to iterate on this material without touching the others.
 */
import { clamp, makeRNG } from '../utils.js';
import { TAU, ctxOf, el, grayCanvas, normalFromHeightCanvas, overlayGrain, overlayNoise, textureFromCanvas, tileFbm } from './core.js';

export function makeWood(aniso, reg) {
  const S = 1024;
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const rng = makeRNG(3307);

  const planks = 4;
  const pw = S / planks;
  for (let p = 0; p < planks; p++) {
    const x = p * pw;
    const base = ['#6c4c32', '#775437', '#5f4229', '#71503a'][p % 4];
    ctx.fillStyle = base;
    ctx.fillRect(x, 0, pw, S);
    // long grain
    for (let i = 0; i < 70; i++) {
      const gx = x + rng() * pw;
      const alpha = 0.05 + rng() * 0.14;
      ctx.strokeStyle = rng() > 0.5 ? `rgba(38,24,12,${alpha})` : `rgba(210,176,128,${alpha * 0.8})`;
      ctx.lineWidth = 0.6 + rng() * 2.2;
      ctx.beginPath();
      let cx = gx;
      let cy = 0;
      ctx.moveTo(cx, cy);
      while (cy < S) {
        cy += 14 + rng() * 30;
        cx += (rng() - 0.5) * 7;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
    // knots
    for (let i = 0; i < 3; i++) {
      const kx = x + pw * (0.2 + rng() * 0.6);
      const ky = rng() * S;
      const kr = 4 + rng() * 12;
      for (let r = kr; r > 1; r -= 2) {
        ctx.strokeStyle = `rgba(40,24,12,${0.16 + rng() * 0.18})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(kx, ky, r, r * 0.55, rng() * 0.4, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(30,18,10,0.55)';
      ctx.beginPath();
      ctx.ellipse(kx, ky, kr * 0.35, kr * 0.22, 0, 0, TAU);
      ctx.fill();
    }
    // nails top & bottom
    for (let n = 0; n < 3; n++) {
      const nx = x + 14 + rng() * (pw - 28);
      const ny = 16 + rng() * 20;
      const ny2 = S - 16 - rng() * 20;
      for (const yy of [ny, ny2]) {
        ctx.fillStyle = '#3a3128';
        ctx.beginPath();
        ctx.arc(nx, yy, 3, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(220,210,190,0.35)';
        ctx.beginPath();
        ctx.arc(nx - 0.8, yy - 0.8, 1.2, 0, TAU);
        ctx.fill();
      }
    }
    // gap between planks
    ctx.fillStyle = 'rgba(24,15,8,0.75)';
    ctx.fillRect(x + pw - 2.2, 0, 2.6, S);
    ctx.fillStyle = 'rgba(220,190,150,0.10)';
    ctx.fillRect(x + pw - 4.2, 0, 1.2, S);
  }

  // sun bleaching, dust and water streaks
  const bleach = ctx.createLinearGradient(0, 0, 0, S);
  bleach.addColorStop(0, 'rgba(230,206,168,0.10)');
  bleach.addColorStop(0.6, 'rgba(0,0,0,0)');
  bleach.addColorStop(1, 'rgba(30,20,12,0.22)');
  ctx.fillStyle = bleach;
  ctx.fillRect(0, 0, S, S);
  ctx.save();
  for (let i = 0; i < 26; i++) {
    const x = rng() * S;
    ctx.strokeStyle = `rgba(70,52,34,${0.05 + rng() * 0.1})`;
    ctx.lineWidth = 2 + rng() * 8;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rng() - 0.5) * 20, S);
    ctx.stroke();
  }
  ctx.restore();
  overlayNoise(ctx, S, S, { tile: 256, seed: 93, alpha: 0.13, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.1, seed: 94 });

  const height = grayCanvas(512, (x, y, u, v) => {
    const planks2 = 4;
    const gap = Math.abs(((u * planks2) % 1) - 0.94);
    const recess = gap < 0.05 ? 0.2 : 0.7;
    const grain = tileFbm(u * 3, v * 0.35, 3, 12);
    return clamp(recess * 0.7 + grain * 0.3, 0, 1);
  });
  const rough = grayCanvas(512, (x, y, u, v) => clamp(0.72 + tileFbm(u, v, 3, 55) * 0.2, 0, 1));

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, 2.4, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
