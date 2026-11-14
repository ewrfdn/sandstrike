/**
 * SANDSTRIKE // rubber texture set  (lib.rubber)
 *
 * Used by materials: rubber
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
import { el, fillCanvas, grayCanvas, overlayGrain, textureFromCanvas } from './core.js';

export function makeRubber(aniso, reg) {
  const S = 256;
  const c = el(S, S);
  const ctx = c.getContext('2d');
  fillCanvas(ctx, S, S, '#1d1c19');
  const rng = makeRNG(7711);
  for (let y = 0; y < S; y += 32) {
    ctx.fillStyle = 'rgba(58,56,50,0.35)';
    ctx.fillRect(0, y, S, 5);
    ctx.fillStyle = 'rgba(8,8,7,0.6)';
    ctx.fillRect(0, y + 16, S, 7);
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(${40 + rng() * 30},${38 + rng() * 26},${34 + rng() * 22},${0.15 + rng() * 0.3})`;
    ctx.fillRect(rng() * S, rng() * S, 2 + rng() * 8, 1 + rng() * 3);
  }
  overlayGrain(ctx, S, S, { alpha: 0.12, seed: 201 });
  const rough = grayCanvas(256, () => 0.94);
  return {
    map: reg(textureFromCanvas(c, { aniso })),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
