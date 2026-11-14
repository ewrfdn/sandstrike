/**
 * SANDSTRIKE // rust texture set  (lib.rust)
 *
 * Used by materials: rust (ORM packed)
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
import { TAU, ctxOf, el, fillCanvas, grayCanvas, normalFromHeightCanvas, overlayNoise, packORM, textureFromCanvas, tileFbm } from './core.js';

export function makeRust(aniso, reg) {
  const S = 512;
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const rng = makeRNG(9917);
  fillCanvas(ctx, S, S, '#7a4526');
  for (let i = 0; i < 90; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 6 + rng() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng() > 0.5 ? 'rgba(184,96,44,0.5)' : 'rgba(64,36,18,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // pitting
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = `rgba(${30 + rng() * 40},${18 + rng() * 24},${10 + rng() * 16},${0.3 + rng() * 0.4})`;
    ctx.beginPath();
    ctx.arc(rng() * S, rng() * S, 0.5 + rng() * 2.4, 0, TAU);
    ctx.fill();
  }
  // bare-metal patches
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = 'rgba(150,146,132,0.5)';
    ctx.beginPath();
    ctx.ellipse(rng() * S, rng() * S, 3 + rng() * 16, 2 + rng() * 8, rng() * TAU, 0, TAU);
    ctx.fill();
  }
  // drip streaks
  for (let i = 0; i < 40; i++) {
    const x = rng() * S;
    ctx.strokeStyle = `rgba(58,32,16,${0.08 + rng() * 0.16})`;
    ctx.lineWidth = 1.5 + rng() * 5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rng() - 0.5) * 30, S);
    ctx.stroke();
  }
  overlayNoise(ctx, S, S, { tile: 256, seed: 133, alpha: 0.2, scale: 2, mode: 'overlay' });

  const height = grayCanvas(512, (x, y, u, v) => clamp(0.5 + tileFbm(u, v, 4, 21) * 0.45, 0, 1));
  const rough = grayCanvas(512, (x, y, u, v) => clamp(0.78 + tileFbm(u, v, 3, 29) * 0.2, 0, 1));
  const metal = grayCanvas(512, (x, y, u, v) => clamp(0.55 - tileFbm(u, v, 3, 30) * 0.4, 0, 1));
  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, 2.4, aniso)),
    ormMap: reg(packORM(rough, metal, aniso)),
  };
}
