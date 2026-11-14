/**
 * SANDSTRIKE // procedural texture core.
 *
 * Shared canvas helpers, tiling noise and texture-conversion utilities used by
 * every material module in this folder. No material-specific drawing lives here.
 *
 * Public (per material module) helpers:
 *   el / ctxOf / grayCanvas            canvas allocation
 *   hash2 / tileFbm                    tileable noise
 *   overlayNoise / overlayGrain        surface grain passes
 *   textureFromCanvas                  CanvasTexture with correct color space
 *   normalFromHeightCanvas             height -> tangent-space normal map (Sobel)
 *   packORM                            ORM pack: R=AO, G=roughness, B=metalness
 */
import * as THREE from 'three';
import { clamp, heightToNormal, lerp } from '../utils.js';

export const TAU = Math.PI * 2;
export const FONT_DISPLAY = '"Bahnschrift Condensed", "DIN Alternate", "Arial Narrow", "Segoe UI", sans-serif';
export const FONT_CJK = '"Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif';
export const FONT_MONO = 'Consolas, "Cascadia Mono", "Courier New", monospace';

// ---------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------

export function el(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function ctxOf(canvas) {
  return canvas.getContext('2d');
}

export function fillCanvas(ctx, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

/** addressable seeded hash in [0,1) */
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** tileable value noise, u/v in [0,1), period = lattice cells per tile */
function tileValue(u, v, period, seed) {
  const x = u * period;
  const y = v * period;
  let xi = Math.floor(x);
  let yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

export function tileFbm(u, v, octaves, seed) {
  let n = 0;
  let amp = 0.55;
  let total = 0;
  let period = 4;
  for (let o = 0; o < octaves; o++) {
    n += tileValue(u, v, period, seed + o * 137) * amp;
    total += amp;
    amp *= 0.5;
    period *= 2;
  }
  return n / total;
}

const _noiseCache = new Map();

/** square tileable grayscale noise canvas (cached) */
function noiseTile(size, seed, octaves = 4, contrast = 1.35) {
  const key = `${size}|${seed}|${octaves}|${contrast}`;
  const hit = _noiseCache.get(key);
  if (hit) return hit;
  const c = el(size, size);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  let i = 0;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let n = tileFbm(u, v, octaves, seed);
      n = clamp(0.5 + (n - 0.5) * contrast, 0, 1);
      const g = n * 255;
      d[i++] = g;
      d[i++] = g;
      d[i++] = g;
      d[i++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _noiseCache.set(key, c);
  return c;
}

/** white-ish fine grain tile (cached) */
function grainTile(size, seed, contrast = 0.55) {
  const key = `grain|${size}|${seed}|${contrast}`;
  const hit = _noiseCache.get(key);
  if (hit) return hit;
  const c = el(size, size);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  let i = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = hash2(x, y, seed);
      const g = clamp(0.5 + (r - 0.5) * contrast * 2, 0, 1) * 255;
      d[i++] = g;
      d[i++] = g;
      d[i++] = g;
      d[i++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _noiseCache.set(key, c);
  return c;
}

/**
 * Overlay a noise tile across a canvas with a blend mode.
 * @param {CanvasRenderingContext2D} ctx
 */
export function overlayNoise(ctx, w, h, { tile = 256, seed = 11, alpha = 0.18, scale = 2, mode = 'overlay' } = {}) {
  const src = noiseTile(tile, seed, 3, 1.2);
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  const step = tile * scale;
  // cover with a slight random offset so tiles do not line up
  const ox = -((seed * 97) % step);
  const oy = -((seed * 53) % step);
  for (let y = oy; y < h + step; y += step) {
    for (let x = ox; x < w + step; x += step) {
      ctx.drawImage(src, x, y, step, step);
    }
  }
  ctx.restore();
}

export function overlayGrain(ctx, w, h, { alpha = 0.14, seed = 5 } = {}) {
  const src = grainTile(256, seed, 0.75);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = alpha;
  for (let y = 0; y < h; y += 256) {
    for (let x = 0; x < w; x += 256) ctx.drawImage(src, x, y);
  }
  ctx.restore();
}

export function textureFromCanvas(canvas, { srgb = true, aniso = 8, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}

export function normalFromHeightCanvas(heightCanvas, strength, aniso) {
  const nCanvas = heightToNormal(heightCanvas, strength);
  // sharpen tiling: canvas is already seamless enough for our use
  return textureFromCanvas(nCanvas, { srgb: false, aniso });
}

/** Build an ORM texture (R=AO, G=roughness, B=metalness) from grayscale canvases. */
export function packORM(roughCanvas, metalCanvas, aniso, aoCanvas = null) {
  const w = roughCanvas.width;
  const h = roughCanvas.height;
  const rg = ctxOf(roughCanvas).getImageData(0, 0, w, h).data;
  const mg = metalCanvas ? ctxOf(metalCanvas).getImageData(0, 0, w, h).data : null;
  const ag = aoCanvas ? ctxOf(aoCanvas).getImageData(0, 0, w, h).data : null;
  const out = el(w, h);
  const octx = ctxOf(out);
  const img = octx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    d[j] = ag ? ag[j] : 255;
    d[j + 1] = rg[j];
    d[j + 2] = mg ? mg[j] : 0;
    d[j + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return textureFromCanvas(out, { srgb: false, aniso });
}

/** grayscale canvas from a per-pixel callback returning 0..1 */
export function grayCanvas(size, fn) {
  const c = el(size, size);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  let i = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const g = clamp(fn(x, y, x / size, y / size), 0, 1) * 255;
      d[i++] = g;
      d[i++] = g;
      d[i++] = g;
      d[i++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Drop cached noise tiles (called by createTextureLibrary().dispose()). */
export function clearNoiseCache() {
  _noiseCache.clear();
}

/**
 * Draw something up to 2x2 extra times so it wraps seamlessly across the
 * texture border. `draw` receives a 2d context translated by (dx, dy); draw at
 * the same absolute coordinates you would normally use.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} size   square texture size
 * @param {number} x      anchor x of the element in canvas pixels
 * @param {number} y      anchor y of the element
 * @param {number} pad    element radius (how far it can reach from the anchor)
 * @param {(ctx:CanvasRenderingContext2D, dx:number, dy:number) => void} draw
 */
export function wrapDraw(ctx, size, x, y, pad, draw) {
  const xs = [0];
  if (x < pad) xs.push(size);
  if (x > size - pad) xs.push(-size);
  const ys = [0];
  if (y < pad) ys.push(size);
  if (y > size - pad) ys.push(-size);
  for (const dx of xs) {
    for (const dy of ys) {
      ctx.save();
      ctx.translate(dx, dy);
      draw(ctx, dx, dy);
      ctx.restore();
    }
  }
}

