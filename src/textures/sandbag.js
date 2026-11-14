/**
 * SANDSTRIKE // sandbag texture set  (lib.sandbag)
 *
 * Used by materials: sandbag
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
import { TAU, ctxOf, el, fillCanvas, grayCanvas, normalFromHeightCanvas, overlayGrain, overlayNoise, textureFromCanvas, tileFbm } from './core.js';

export function makeSandbag(aniso, reg) {
  const S = 512;
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const rng = makeRNG(7723);
  fillCanvas(ctx, S, S, '#9c8763');

  // burlap weave
  ctx.save();
  ctx.globalAlpha = 0.20;
  for (let y = 0; y < S; y += 4) {
    ctx.fillStyle = y % 8 === 0 ? '#6d5c40' : '#c2ad84';
    ctx.fillRect(0, y, S, 1.6);
  }
  for (let x = 0; x < S; x += 4) {
    ctx.fillStyle = x % 8 === 0 ? '#75643f' : '#cbb68b';
    ctx.fillRect(x, 0, 1.6, S);
  }
  ctx.restore();

  // dirt & sand staining
  for (let i = 0; i < 70; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 6 + rng() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng() > 0.4 ? `rgba(112,88,54,${0.08 + rng() * 0.16})` : `rgba(196,170,122,${0.08 + rng() * 0.16})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // stitched seam along the top
  ctx.save();
  ctx.strokeStyle = 'rgba(70,54,34,0.55)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.moveTo(0, 54);
  ctx.lineTo(S, 54);
  ctx.stroke();
  ctx.restore();
  // tied ends
  for (const x of [70, S - 70]) {
    ctx.strokeStyle = 'rgba(60,46,28,0.7)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, 30);
    ctx.quadraticCurveTo(x + 6, 60, x + 2, 96);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 4, 50, 12, 0, TAU);
    ctx.stroke();
  }
  overlayNoise(ctx, S, S, { tile: 256, seed: 151, alpha: 0.18, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.1, seed: 152 });

  const height = grayCanvas(512, (x, y, u, v) => {
    const weave = (Math.sin(u * 512 * 0.78) + Math.sin(v * 512 * 0.78)) * 0.06;
    return clamp(0.5 + weave + (tileFbm(u, v, 4, 22) - 0.5) * 0.4, 0, 1);
  });
  const rough = grayCanvas(512, (x, y, u, v) => clamp(0.9 + tileFbm(u, v, 3, 23) * 0.08, 0, 1));
  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, 2.0, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
