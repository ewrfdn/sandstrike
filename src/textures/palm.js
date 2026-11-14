/**
 * SANDSTRIKE // palm texture set  (lib.frond)
 *
 * Used by materials: frond
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
import { makeRNG } from '../utils.js';
import { el, textureFromCanvas } from './core.js';

export function makeFrond(aniso, reg) {
  const S = 256;
  const c = el(S, S);
  const ctx = c.getContext('2d');
  const rng = makeRNG(8899);
  // central rib
  ctx.strokeStyle = '#6d6434';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(10, 128);
  ctx.quadraticCurveTo(128, 116, 248, 128);
  ctx.stroke();
  // leaflets fanning up/down
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const x = 14 + t * 228;
    const len = 30 + Math.sin(t * Math.PI) * 88 + rng() * 12;
    for (const dir of [-1, 1]) {
      const hue = 44 + rng() * 16;
      const light = 26 + rng() * 20;
      ctx.strokeStyle = `hsl(${hue}, ${22 + rng() * 22}%, ${light}%)`;
      ctx.lineWidth = 2.4 + rng() * 2.2;
      ctx.beginPath();
      ctx.moveTo(x, 128 + dir * 4);
      ctx.quadraticCurveTo(x + 8, 128 + dir * len * 0.55, x + 18 + rng() * 12, 128 + dir * len);
      ctx.stroke();
    }
  }
  // dust on the frond
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 16; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 8 + rng() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(196,168,116,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
  return { map: reg(textureFromCanvas(c, { aniso })) };
}
