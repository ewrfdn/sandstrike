/**
 * SANDSTRIKE // paving texture set  (lib.paving)
 *
 * Used by materials: paving
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

export function makePaving(aniso, reg) {
  const S = 1024;
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const rng = makeRNG(5150);

  fillCanvas(ctx, S, S, '#6b5c49');

  const cells = 5;
  const cw = S / cells;
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (rng() < 0.14) {
        // missing stone → packed sand and rubble
        ctx.fillStyle = `rgb(${168 + rng() * 24},${136 + rng() * 20},${96 + rng() * 18})`;
        ctx.fillRect(c * cw + 2, r * cw + 2, cw - 4, cw - 4);
        continue;
      }
      const x = c * cw;
      const y = r * cw;
      const m = 5 + rng() * 7;
      const col = ['#9a8b73', '#ab9a80', '#82755f', '#b3a287', '#8f8069', '#bcab8d', '#776b57'][Math.floor(rng() * 7)];
      ctx.save();
      ctx.beginPath();
      const j = 10 + rng() * 22;
      ctx.moveTo(x + m + (rng() - 0.5) * j, y + m);
      ctx.lineTo(x + cw - m + (rng() - 0.5) * j, y + m + (rng() - 0.5) * j);
      ctx.lineTo(x + cw - m, y + cw - m + (rng() - 0.5) * j);
      ctx.lineTo(x + m + (rng() - 0.5) * j, y + cw - m);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      const g = ctx.createLinearGradient(x, y, x + cw * 0.8, y + cw);
      g.addColorStop(0, 'rgba(255,248,230,0.15)');
      g.addColorStop(0.6, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(46,32,18,0.22)');
      ctx.fillStyle = g;
      ctx.fill();
      // worn, dusty centre
      if (rng() > 0.35) {
        const dust = ctx.createRadialGradient(x + cw / 2, y + cw / 2, 0, x + cw / 2, y + cw / 2, cw * 0.55);
        dust.addColorStop(0, `rgba(196,168,120,${0.06 + rng() * 0.12})`);
        dust.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = dust;
        ctx.fillRect(x, y, cw, cw);
      }
      // hairline cracks
      if (rng() > 0.55) {
        let cx = x + rng() * cw;
        let cy = y + rng() * cw;
        let ang = rng() * TAU;
        ctx.strokeStyle = 'rgba(48,34,20,0.35)';
        ctx.lineWidth = 0.8 + rng();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let s = 0; s < 6; s++) {
          ang += (rng() - 0.5) * 0.9;
          cx += Math.cos(ang) * cw * 0.12;
          cy += Math.sin(ang) * cw * 0.12;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // sand between stones + dust drifts + weeds
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 120; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 2 + rng() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(214,178,124,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
  overlayNoise(ctx, S, S, { tile: 256, seed: 71, alpha: 0.15, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.1, seed: 72 });

  const height = grayCanvas(512, (x, y, u, v) => {
    const cells2 = 5;
    const fx = u * cells2;
    const fy = v * cells2;
    const edge = Math.min(Math.abs((fx % 1) - 0.5) * 2, Math.abs((fy % 1) - 0.5) * 2);
    const block = clamp((1 - edge) * 7, 0, 1);
    const n = tileFbm(u, v, 3, 17);
    return clamp(0.2 + block * 0.66 + (n - 0.5) * 0.12, 0, 1);
  });
  const rough = grayCanvas(512, (x, y, u, v) => clamp(0.78 + tileFbm(u, v, 3, 88) * 0.2, 0, 1));

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, 2.6, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
