/**
 * SANDSTRIKE // sheet-metal texture set  (lib.sheet)
 *
 * Used by materials: sheet (ORM packed)
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
import { TAU, ctxOf, el, fillCanvas, grayCanvas, normalFromHeightCanvas, overlayGrain, overlayNoise, packORM, textureFromCanvas, tileFbm } from './core.js';

export function makeSheetMetal(aniso, reg) {
  const S = 512;
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const rng = makeRNG(4451);
  fillCanvas(ctx, S, S, '#8a8374');
  const bands = 8;
  const bw = S / bands;
  for (let b = 0; b < bands; b++) {
    const x = b * bw;
    const g = ctx.createLinearGradient(x, 0, x + bw, 0);
    g.addColorStop(0, 'rgba(46,42,32,0.55)');
    g.addColorStop(0.18, 'rgba(226,220,198,0.28)');
    g.addColorStop(0.5, 'rgba(255,250,232,0.16)');
    g.addColorStop(0.82, 'rgba(60,54,42,0.35)');
    g.addColorStop(1, 'rgba(20,18,12,0.6)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, bw, S);
  }
  // rust blooms and streaks
  for (let i = 0; i < 46; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 4 + rng() * 48;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(142,74,34,${0.15 + rng() * 0.3})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 34; i++) {
    const x = rng() * S;
    ctx.strokeStyle = `rgba(120,60,28,${0.06 + rng() * 0.16})`;
    ctx.lineWidth = 1 + rng() * 4;
    ctx.beginPath();
    ctx.moveTo(x, rng() * S * 0.4);
    ctx.lineTo(x + (rng() - 0.5) * 16, S);
    ctx.stroke();
  }
  // dents / dings
  for (let i = 0; i < 26; i++) {
    const x = rng() * S;
    const y = rng() * S;
    ctx.strokeStyle = 'rgba(30,28,22,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + rng() * 10, 1 + rng() * 5, rng() * TAU, 0, TAU);
    ctx.stroke();
  }
  overlayNoise(ctx, S, S, { tile: 256, seed: 141, alpha: 0.16, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.08, seed: 142 });

  const height = grayCanvas(512, (x, y, u, v) => {
    const s = Math.sin((u * 8) * TAU);
    return clamp(0.5 + s * 0.34 + (tileFbm(u, v, 3, 13) - 0.5) * 0.12, 0, 1);
  });
  const rough = grayCanvas(512, (x, y, u, v) => clamp(0.5 + tileFbm(u, v, 3, 15) * 0.3, 0, 1));
  const metal = grayCanvas(512, (x, y, u, v) => clamp(0.72 - tileFbm(u, v, 3, 16) * 0.25, 0, 1));
  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, 2.8, aniso)),
    ormMap: reg(packORM(rough, metal, aniso)),
  };
}
