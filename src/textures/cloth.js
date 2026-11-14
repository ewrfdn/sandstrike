/**
 * SANDSTRIKE // cloth texture set  (lib.cloth)
 *
 * Used by materials: awning / tarp / shade
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
import { TAU, ctxOf, el, fillCanvas, grayCanvas, normalFromHeightCanvas, overlayNoise, textureFromCanvas, tileFbm } from './core.js';
import { shadeFolds, stencilText } from './cloth-common.js';

export function makeCloth(aniso, reg) {
  function weaveNormal() {
    const h = grayCanvas(256, (x, y, u, v) => {
      const weave = Math.sin(u * 256 * 1.55) * Math.sin(v * 256 * 1.55) * 0.5 + 0.5;
      return clamp(0.35 + weave * 0.3 + (tileFbm(u, v, 3, 3) - 0.5) * 0.2, 0, 1);
    });
    return reg(normalFromHeightCanvas(h, 1.4, aniso));
  }
  const weaveNorm = weaveNormal();

  // ---- striped awning ----
  const A = 512;
  const awning = el(A, A);
  let c = ctxOf(awning);
  const rng = makeRNG(4821);
  fillCanvas(c, A, A, '#dfcba4');
  const stripe = 64;
  for (let x = 0; x < A; x += stripe) {
    c.fillStyle = '#a34a34';
    c.fillRect(x, 0, stripe / 2, A);
  }
  // sun-bleached, dusty, stained
  for (let i = 0; i < 60; i++) {
    const x = rng() * A;
    const y = rng() * A;
    const r = 10 + rng() * 90;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng() > 0.55 ? `rgba(244,226,190,${0.1 + rng() * 0.2})` : `rgba(96,68,40,${0.06 + rng() * 0.14})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // seams
  c.strokeStyle = 'rgba(90,60,40,0.35)';
  c.lineWidth = 2;
  for (let y = 128; y < A; y += 128) {
    c.setLineDash([10, 8]);
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(A, y);
    c.stroke();
  }
  c.setLineDash([]);
  // small stencil mark
  c.save();
  c.globalAlpha = 0.5;
  stencilText(c, 'Λ 07', A * 0.5, A * 0.72, { size: 54, color: '#3c3526', wear: 0.6, seed: 12 });
  c.restore();
  shadeFolds(c, A, A, { count: 10, vertical: true, alpha: 0.05, seed: 2 });
  overlayNoise(c, A, A, { tile: 256, seed: 161, alpha: 0.12, scale: 2, mode: 'overlay' });
  const awningMap = reg(textureFromCanvas(awning, { aniso }));

  // ---- olive tarp ----
  const B = 512;
  const tarp = el(B, B);
  c = ctxOf(tarp);
  fillCanvas(c, B, B, '#55583d');
  const trng = makeRNG(5566);
  for (let i = 0; i < 50; i++) {
    const x = trng() * B;
    const y = trng() * B;
    const r = 12 + trng() * 110;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, trng() > 0.5 ? 'rgba(112,112,74,0.14)' : 'rgba(40,40,24,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // seams + grommets
  c.strokeStyle = 'rgba(28,30,18,0.5)';
  c.lineWidth = 3;
  c.setLineDash([14, 6]);
  for (let x = 96; x < B; x += 128) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, B);
    c.stroke();
  }
  c.setLineDash([]);
  for (let x = 40; x < B; x += 108) {
    for (const y of [26, B - 26]) {
      c.fillStyle = '#3a3a2a';
      c.beginPath();
      c.arc(x, y, 7, 0, TAU);
      c.fill();
      c.strokeStyle = 'rgba(200,200,170,0.35)';
      c.lineWidth = 2;
      c.stroke();
    }
  }
  // patches
  for (let i = 0; i < 5; i++) {
    c.save();
    c.translate(trng() * B, trng() * B);
    c.rotate((trng() - 0.5) * 0.4);
    c.fillStyle = 'rgba(88,90,60,0.7)';
    c.fillRect(-30, -20, 60, 40);
    c.strokeStyle = 'rgba(30,32,18,0.6)';
    c.lineWidth = 1.6;
    c.setLineDash([5, 5]);
    c.strokeRect(-27, -17, 54, 34);
    c.restore();
  }
  c.setLineDash([]);
  shadeFolds(c, B, B, { count: 12, vertical: false, alpha: 0.05, seed: 5 });
  overlayNoise(c, B, B, { tile: 256, seed: 171, alpha: 0.14, scale: 2, mode: 'overlay' });
  const tarpMap = reg(textureFromCanvas(tarp, { aniso }));

  // ---- pale shade canvas ----
  const C = 512;
  const canvas = el(C, C);
  c = ctxOf(canvas);
  fillCanvas(c, C, C, '#cdbb94');
  const srng = makeRNG(8811);
  for (let i = 0; i < 40; i++) {
    const x = srng() * C;
    const y = srng() * C;
    const r = 20 + srng() * 120;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(240,226,196,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  c.strokeStyle = 'rgba(120,98,66,0.3)';
  c.lineWidth = 2;
  for (let x = 0; x < C; x += 170) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, C);
    c.stroke();
  }
  shadeFolds(c, C, C, { count: 8, vertical: false, alpha: 0.04, seed: 8 });
  overlayNoise(c, C, C, { tile: 256, seed: 181, alpha: 0.1, scale: 2, mode: 'overlay' });
  const shadeMap = reg(textureFromCanvas(canvas, { aniso }));

  return {
    awning: { map: awningMap, normalMap: weaveNorm },
    tarp: { map: tarpMap, normalMap: weaveNorm },
    shade: { map: shadeMap, normalMap: weaveNorm },
  };
}
