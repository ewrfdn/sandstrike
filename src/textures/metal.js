/**
 * SANDSTRIKE // metal texture set  (lib.metal)
 *
 * Used by materials: metal / metalDark (ORM packed)
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

export function makeMetal(aniso, reg) {
  const S = 512;
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const rng = makeRNG(2210);
  fillCanvas(ctx, S, S, '#5d6244');
  // paint variation
  for (let i = 0; i < 50; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 8 + rng() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng() > 0.5 ? 'rgba(120,124,92,0.14)' : 'rgba(44,46,32,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // paint chips → bright metal + rust rim
  for (let i = 0; i < 58; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 1.5 + rng() * 10;
    ctx.fillStyle = `rgba(${132 + rng() * 40},${126 + rng() * 36},${112 + rng() * 30},0.85)`;
    ctx.beginPath();
    const pts = 6;
    for (let p = 0; p < pts; p++) {
      const a = (p / pts) * TAU;
      const rr = r * (0.5 + rng() * 0.8);
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(124,64,34,0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  // rivet grid
  ctx.save();
  for (let y = 48; y < S; y += 108) {
    for (let x = 34; x < S; x += 108) {
      ctx.fillStyle = 'rgba(28,28,20,0.55)';
      ctx.beginPath();
      ctx.arc(x + 1, y + 2, 4.2, 0, TAU);
      ctx.fill();
      const g = ctx.createRadialGradient(x - 1, y - 1.5, 0, x, y, 4.6);
      g.addColorStop(0, 'rgba(206,204,190,0.85)');
      g.addColorStop(0.7, 'rgba(126,124,110,0.7)');
      g.addColorStop(1, 'rgba(50,50,42,0.6)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
  // scratches
  for (let i = 0; i < 80; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const l = 8 + rng() * 90;
    const a = rng() * TAU;
    ctx.strokeStyle = `rgba(${rng() > 0.45 ? '206,204,188' : '212,190,150'},${0.06 + rng() * 0.2})`;
    ctx.lineWidth = 0.5 + rng() * 1.3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  // grime streaks
  for (let i = 0; i < 30; i++) {
    const x = rng() * S;
    ctx.strokeStyle = `rgba(50,40,26,${0.04 + rng() * 0.12})`;
    ctx.lineWidth = 2 + rng() * 9;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rng() - 0.5) * 30, S);
    ctx.stroke();
  }
  overlayNoise(ctx, S, S, { tile: 256, seed: 123, alpha: 0.14, scale: 2, mode: 'overlay' });

  const height = grayCanvas(512, (x, y, u, v) => {
    const n = tileFbm(u, v, 3, 41);
    const rivet = Math.exp(-(((u * 512 - 34) % 108) ** 2 + ((v * 512 - 48) % 108) ** 2) / 90);
    return clamp(0.55 + (n - 0.5) * 0.25 + rivet * 0.25, 0, 1);
  });
  const rough = grayCanvas(512, (x, y, u, v) => {
    const n = tileFbm(u, v, 3, 77);
    return clamp(0.62 + n * 0.22, 0, 1);
  });
  const metal = grayCanvas(512, (x, y, u, v) => {
    const n = tileFbm(u, v, 3, 78);
    return clamp(0.10 + (n > 0.68 ? 0.72 : 0), 0, 1);
  });
  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, 1.8, aniso)),
    ormMap: reg(packORM(rough, metal, aniso)),
  };
}
