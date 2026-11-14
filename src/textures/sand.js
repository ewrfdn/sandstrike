/**
 * SANDSTRIKE // sand texture set  (lib.sand)
 *
 * Used by materials: sand / sandDune / sandDark
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
import { clamp, lerp, makeRNG } from '../utils.js';
import { TAU, ctxOf, el, grayCanvas, hash2, normalFromHeightCanvas, overlayGrain, overlayNoise, textureFromCanvas, tileFbm } from './core.js';

export function makeSand(aniso, reg) {
  const SIZE = 1024;
  const HALF = 512;
  const albedo = el(SIZE, SIZE);
  const aCtx = ctxOf(albedo);

  // 512px base layer: ripple field + noise palette
  const base = el(HALF, HALF);
  const bCtx = ctxOf(base);
  const bImg = bCtx.createImageData(HALF, HALF);
  const bd = bImg.data;
  let bi = 0;
  for (let y = 0; y < HALF; y++) {
    const v = y / HALF;
    for (let x = 0; x < HALF; x++) {
      const u = x / HALF;
      const warp = Math.sin(u * TAU * 3 + Math.sin(v * TAU * 2) * 0.7) * 0.22 + Math.sin(v * TAU * 5 + u * TAU) * 0.06;
      const ripple = Math.sin((v * 48 + warp * 3.2 + u * 2) * TAU);
      const n = tileFbm(u, v, 4, 71);
      const grain = hash2(x, y, 913) - 0.5;
      const h = ripple * 0.5 + 0.5;
      // warm sand ramp: troughs darker/redder, crests pale gold
      const t = clamp(0.34 + n * 0.5 + (h - 0.5) * 0.44 + grain * 0.07, 0, 1);
      const r = lerp(176, 236, t);
      const g = lerp(140, 207, t);
      const b = lerp(101, 162, t);
      bd[bi++] = r;
      bd[bi++] = g;
      bd[bi++] = b;
      bd[bi++] = 255;
    }
  }
  bCtx.putImageData(bImg, 0, 0);
  aCtx.imageSmoothingEnabled = true;
  aCtx.drawImage(base, 0, 0, SIZE, SIZE);

  // macro tonal variation (sun-bleached patches / darker damp sand)
  const rng = makeRNG(3361);
  aCtx.save();
  for (let i = 0; i < 26; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    const r = 120 + rng() * 330;
    const g = aCtx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rng() > 0.5;
    g.addColorStop(0, dark ? 'rgba(104,70,42,0.10)' : 'rgba(255,236,204,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    aCtx.fillStyle = g;
    aCtx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  aCtx.restore();

  // crisp fine detail at 1024 (upscaled 512 reads slightly soft without it)
  overlayNoise(aCtx, SIZE, SIZE, { tile: 256, seed: 17, alpha: 0.16, scale: 2, mode: 'overlay' });
  overlayGrain(aCtx, SIZE, SIZE, { alpha: 0.10, seed: 21 });

  // pebbles / little rocks / dry twigs
  aCtx.save();
  for (let i = 0; i < 260; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    const r = 0.7 + rng() * 2.6;
    const shade = 60 + rng() * 90;
    aCtx.fillStyle = `rgba(${shade + 30},${shade + 5},${shade - 22},${0.25 + rng() * 0.35})`;
    aCtx.beginPath();
    aCtx.ellipse(x, y, r, r * (0.5 + rng() * 0.6), rng() * TAU, 0, TAU);
    aCtx.fill();
    aCtx.fillStyle = `rgba(255,244,214,${0.10 + rng() * 0.18})`;
    aCtx.beginPath();
    aCtx.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, TAU);
    aCtx.fill();
  }
  for (let i = 0; i < 40; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    aCtx.strokeStyle = `rgba(90,64,40,${0.12 + rng() * 0.16})`;
    aCtx.lineWidth = 0.7 + rng();
    aCtx.beginPath();
    aCtx.moveTo(x, y);
    aCtx.quadraticCurveTo(x + (rng() - 0.5) * 26, y + (rng() - 0.5) * 22, x + (rng() - 0.5) * 44, y + (rng() - 0.5) * 30);
    aCtx.stroke();
  }
  aCtx.restore();

  // ---- height / normal (512) ----
  const height = grayCanvas(HALF, (x, y, u, v) => {
    const warp = Math.sin(u * TAU * 3 + Math.sin(v * TAU * 2) * 0.7) * 0.22 + Math.sin(v * TAU * 5 + u * TAU) * 0.06;
    const ripple = Math.sin((v * 48 + warp * 3.2 + u * 2) * TAU);
    const n = tileFbm(u, v, 4, 71);
    return clamp(0.52 + ripple * 0.18 + (n - 0.5) * 0.55 + (hash2(x, y, 913) - 0.5) * 0.10, 0, 1);
  });

  // ---- roughness (512): dry sand is uniformly rough, crests slightly dusty ----
  const rough = grayCanvas(HALF, (x, y, u, v) => {
    const n = tileFbm(u, v, 3, 45);
    const ripple = Math.sin((v * 48 + u * 2) * TAU);
    return clamp(0.90 + n * 0.06 + ripple * 0.015, 0, 1);
  });

  return {
    map: reg(textureFromCanvas(albedo, { aniso, repeat: 1 })),
    normalMap: reg(normalFromHeightCanvas(height, 2.2, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
