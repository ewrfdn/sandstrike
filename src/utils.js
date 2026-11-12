import * as THREE from 'three';

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential smoothing. */
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const rand = (min = 0, max = 1) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;

export function makeRNG(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function angleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export function dampAngle(current, target, lambda, dt) {
  return current + angleDelta(current, target) * (1 - Math.exp(-lambda * dt));
}

/**
 * Create a CanvasTexture with sensible defaults.
 * The draw callback receives a hybrid 2D-context/canvas object, so both
 * `(ctx) => ctx.fillRect(...)` and `(canvas) => canvas.getContext('2d')...`
 * callbacks work. width/height and canvas.getContext() are provided too.
 * @param {number} w
 * @param {number} h
 * @param {(ctx: CanvasRenderingContext2D & HTMLCanvasElement, w: number, h: number) => void} draw
 */
export function canvasTexture(w, h, draw, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // Seamless adapter for either calling convention (context-first is canonical).
  const hybrid = new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'getContext') return () => ctx;
      if (prop === 'width') return canvas.width;
      if (prop === 'height') return canvas.height;
      if (prop === 'canvas') return canvas;
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, prop, value) {
      if (prop === 'width' || prop === 'height') {
        canvas[prop] = value;
        return true;
      }
      target[prop] = value;
      return true;
    },
  });
  draw(hybrid, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = opts.wrap ?? THREE.RepeatWrapping;
  tex.repeat.set(opts.repeat?.[0] ?? 1, opts.repeat?.[1] ?? 1);
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy ?? 8;
  if (opts.needsUpdate !== false) tex.needsUpdate = true;
  return tex;
}

/** Paint per-pixel noise into a canvas via ImageData; used by texture generators. */
export function paintNoise(ctx, w, h, fn) {
  const img = ctx.createImageData(w, h);
  const data = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c = fn(x, y, x / w, y / h);
      if (c) {
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3] ?? 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Convert a height canvas to a normal map canvas (Sobel filtering). */
export function heightToNormal(sourceCanvas, strength = 2) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const src = sourceCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const at = (x, y) => {
    x = (x + w) % w; y = (y + h) % h;
    return src[(y * w + x) * 4] / 255;
  };
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      // tangent-space normal encoded in RGB
      const nx = dx, ny = dy, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      img.data[i++] = (nx / len * 0.5 + 0.5) * 255;
      img.data[i++] = (ny / len * 0.5 + 0.5) * 255;
      img.data[i++] = (nz / len * 0.5 + 0.5) * 255;
      img.data[i++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Create a normal map texture from a grayscale canvas. */
export function normalTextureFromCanvas(canvas, strength = 2, repeat = 1) {
  const normalCanvas = heightToNormal(canvas, strength);
  const tex = new THREE.CanvasTexture(normalCanvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Soft round particle sprite texture (white, alpha radial). */
let _softSprite = null;
export function softSpriteTexture() {
  if (_softSprite) return _softSprite;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _softSprite = new THREE.CanvasTexture(c);
  _softSprite.colorSpace = THREE.SRGBColorSpace;
  return _softSprite;
}

export function disposeObject(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const mat of mats) {
      for (const value of Object.values(mat)) {
        if (value && value.isTexture && value !== _softSprite) value.dispose();
      }
      mat.dispose();
    }
  });
  if (root.parent) root.parent.remove(root);
}
