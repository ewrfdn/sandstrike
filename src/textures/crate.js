/**
 * SANDSTRIKE // crate texture set  (lib.crate)
 *
 * Used by materials: crate
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
import { FONT_DISPLAY, FONT_MONO, TAU, ctxOf, el, grayCanvas, normalFromHeightCanvas, overlayGrain, overlayNoise, textureFromCanvas, tileFbm } from './core.js';

export function makeCrate(aniso, reg) {
  const S = 1024;
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const rng = makeRNG(6512);

  // horizontal planks
  const planks = 5;
  const ph = S / planks;
  for (let p = 0; p < planks; p++) {
    const y = p * ph;
    ctx.fillStyle = ['#8f6d48', '#9b7650', '#836040', '#946f4a'][p % 4];
    ctx.fillRect(0, y, S, ph);
    for (let i = 0; i < 40; i++) {
      const gy = y + rng() * ph;
      ctx.strokeStyle = rng() > 0.5 ? `rgba(40,26,14,${0.06 + rng() * 0.12})` : `rgba(212,182,138,${0.05 + rng() * 0.1})`;
      ctx.lineWidth = 0.7 + rng() * 1.8;
      ctx.beginPath();
      let cx = 0;
      let cy = gy;
      ctx.moveTo(cx, cy);
      while (cx < S) {
        cx += 20 + rng() * 40;
        cy += (rng() - 0.5) * 5;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(26,16,8,0.7)';
    ctx.fillRect(0, y + ph - 2.5, S, 3);
  }

  // dark perimeter frame (painted metal banding + timber edging)
  const F = 40;
  ctx.fillStyle = '#4d3f2d';
  ctx.fillRect(0, 0, S, F);
  ctx.fillRect(0, S - F, S, F);
  ctx.fillRect(0, 0, F, S);
  ctx.fillRect(S - F, 0, F, S);
  ctx.strokeStyle = 'rgba(180,164,132,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(F + 3, F + 3, S - F * 2 - 6, S - F * 2 - 6);

  // diagonal braces
  ctx.save();
  ctx.strokeStyle = 'rgba(84,62,40,0.8)';
  ctx.lineWidth = 15;
  ctx.beginPath();
  ctx.moveTo(F + 10, F + 10);
  ctx.lineTo(S - F - 10, S - F - 10);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(196,160,116,0.10)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(F + 10, F + 22);
  ctx.lineTo(S - F - 22, S - F - 10);
  ctx.stroke();
  ctx.restore();

  // corner brackets
  for (const [cx, cy] of [[F, F], [S - F, F], [F, S - F], [S - F, S - F]]) {
    ctx.fillStyle = '#544a3a';
    ctx.fillRect(cx - 26, cy - 26, 52, 52);
    ctx.fillStyle = 'rgba(230,220,196,0.30)';
    ctx.fillRect(cx - 22, cy - 22, 44, 3);
    for (const [dx, dy] of [[-16, -16], [16, -16], [-16, 16], [16, 16]]) {
      ctx.fillStyle = '#241c12';
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, 4.5, 0, TAU);
      ctx.fill();
    }
  }

  // olive stencil paint pass
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = '#2c3220';
  ctx.font = `900 62px ${FONT_DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SANDSTRIKE', S / 2, S * 0.31);
  ctx.font = `900 106px ${FONT_DISPLAY}`;
  ctx.fillText('7.62×51', S / 2, S * 0.49);
  ctx.font = `700 38px ${FONT_MONO}`;
  ctx.fillText('AMMUNITION · Λ-07', S / 2, S * 0.62);
  // up arrow
  ctx.beginPath();
  ctx.moveTo(S / 2, S * 0.70);
  ctx.lineTo(S / 2 - 34, S * 0.76);
  ctx.lineTo(S / 2 - 12, S * 0.76);
  ctx.lineTo(S / 2 - 12, S * 0.85);
  ctx.lineTo(S / 2 + 12, S * 0.85);
  ctx.lineTo(S / 2 + 12, S * 0.76);
  ctx.lineTo(S / 2 + 34, S * 0.76);
  ctx.closePath();
  ctx.fill();
  ctx.font = `700 30px ${FONT_MONO}`;
  ctx.fillText('SECTOR 7 · 军用物资', S / 2, S * 0.905);
  ctx.restore();

  // wear: punch and chip the stencil, add scratches and grime
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260; i++) {
    ctx.globalAlpha = 0.2 + rng() * 0.5;
    ctx.beginPath();
    ctx.arc(rng() * S, rng() * S, 0.6 + rng() * 3.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  for (let i = 0; i < 46; i++) {
    ctx.strokeStyle = `rgba(228,212,184,${0.05 + rng() * 0.12})`;
    ctx.lineWidth = 0.7 + rng() * 1.6;
    ctx.beginPath();
    const x = rng() * S;
    const y = rng() * S;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 60, y + (rng() - 0.5) * 30);
    ctx.stroke();
  }
  for (let i = 0; i < 30; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 4 + rng() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(30,20,10,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
  overlayNoise(ctx, S, S, { tile: 256, seed: 111, alpha: 0.14, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.09, seed: 112 });

  const height = grayCanvas(1024, (x, y, u, v) => {
    const F2 = 0.039;
    const edge = u < F2 || u > 1 - F2 || v < F2 || v > 1 - F2;
    const plankLine = Math.abs(((v * 5) % 1) - 0.98) < 0.02;
    const grain = tileFbm(u * 2, v * 2, 3, 31);
    return clamp((edge ? 0.72 : 0.5) + grain * 0.2 - (plankLine ? 0.24 : 0), 0, 1);
  });
  const rough = grayCanvas(512, (x, y, u, v) => clamp(0.74 + tileFbm(u, v, 3, 67) * 0.18, 0, 1));

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, 2.2, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
