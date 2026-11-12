/**
 * SANDSTRIKE // 沙暴协议 — procedural texture library.
 *
 * Every texture in the game is drawn here at load time with Canvas2D.
 * No external assets, no network requests. Colour maps are sRGB, data maps
 * (normal / roughness / metalness / ORM) are linear (NoColorSpace) as required
 * by three.js r170.
 *
 * Public API:
 *   const lib = await createTextureLibrary(renderer, { quality, onProgress });
 *   lib.sand.map / lib.sand.normalMap / lib.sand.roughnessMap ... etc.
 *   lib.decalAtlas { texture, cells }
 *   lib.posterAtlas { texture, cells }
 *   lib.dispose()
 */
import * as THREE from 'three';
import { heightToNormal, makeRNG, clamp, lerp } from './utils.js';

const TAU = Math.PI * 2;
const FONT_DISPLAY = '"Bahnschrift Condensed", "DIN Alternate", "Arial Narrow", "Segoe UI", sans-serif';
const FONT_CJK = '"Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif';
const FONT_MONO = 'Consolas, "Cascadia Mono", "Courier New", monospace';

// ---------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------

function el(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctxOf(canvas) {
  return canvas.getContext('2d');
}

function fillCanvas(ctx, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

/** addressable seeded hash in [0,1) */
function hash2(x, y, seed = 0) {
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

function tileFbm(u, v, octaves, seed) {
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
function overlayNoise(ctx, w, h, { tile = 256, seed = 11, alpha = 0.18, scale = 2, mode = 'overlay' } = {}) {
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

function overlayGrain(ctx, w, h, { alpha = 0.14, seed = 5 } = {}) {
  const src = grainTile(256, seed, 0.75);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = alpha;
  for (let y = 0; y < h; y += 256) {
    for (let x = 0; x < w; x += 256) ctx.drawImage(src, x, y);
  }
  ctx.restore();
}

function textureFromCanvas(canvas, { srgb = true, aniso = 8, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}

function normalFromHeightCanvas(heightCanvas, strength, aniso) {
  const nCanvas = heightToNormal(heightCanvas, strength);
  // sharpen tiling: canvas is already seamless enough for our use
  return textureFromCanvas(nCanvas, { srgb: false, aniso });
}

/** Build an ORM texture (R=AO, G=roughness, B=metalness) from grayscale canvases. */
function packORM(roughCanvas, metalCanvas, aniso, aoCanvas = null) {
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
function grayCanvas(size, fn) {
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

/** Draw worn stencil text: paint, then punch small holes so it reads as weathered. */
function stencilText(ctx, text, x, y, { font = FONT_DISPLAY, size = 64, color = '#e9dcc0', align = 'center', alpha = 0.92, wear = 0.28, seed = 3 } = {}) {
  const rng = makeRNG(seed);
  ctx.save();
  ctx.font = `900 ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
  if (wear > 0) {
    // erase speckles for a sprayed, chipped look
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const w = ctx.canvas.width;
    const hh = ctx.canvas.height;
    for (let i = 0; i < 220 * wear; i++) {
      const px = rng() * w;
      const py = rng() * hh;
      ctx.globalAlpha = 0.25 + rng() * 0.5;
      ctx.beginPath();
      ctx.arc(px, py, 0.6 + rng() * 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Torn cloth silhouette punched out of an already drawn banner canvas. */
function tearClothEdges(canvas, { bottom = true, sides = true, seed = 9, depth = 26 } = {}) {
  const ctx = ctxOf(canvas);
  const w = canvas.width;
  const h = canvas.height;
  const rng = makeRNG(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  if (bottom) {
    ctx.beginPath();
    ctx.moveTo(0, h - 2);
    let x = 0;
    while (x < w) {
      const step = 6 + rng() * 16;
      const d = rng() * depth;
      ctx.lineTo(x + step * 0.5, h - d - 2);
      x += step;
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
  if (sides) {
    for (let s = 0; s < 2; s++) {
      ctx.beginPath();
      const x0 = s === 0 ? 0 : w;
      ctx.moveTo(x0, 0);
      let y = 0;
      while (y < h) {
        const step = 18 + rng() * 30;
        const d = rng() * 5;
        ctx.lineTo(s === 0 ? d : w - d, y + step * 0.5);
        y += step;
      }
      ctx.lineTo(x0, h);
      ctx.closePath();
      ctx.fill();
    }
  }
  // a few moth holes
  for (let i = 0; i < 10; i++) {
    ctx.globalAlpha = 0.5 + rng() * 0.5;
    ctx.beginPath();
    ctx.ellipse(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 2, rng() * TAU, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Soft cloth fold shading pass. */
function shadeFolds(ctx, w, h, { count = 8, vertical = true, alpha = 0.09, seed = 4 } = {}) {
  const rng = makeRNG(seed);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const p = rng();
    const g = vertical
      ? ctx.createLinearGradient(p * w, 0, p * w + 40 + rng() * 90, 0)
      : ctx.createLinearGradient(0, p * h, 0, p * h + 40 + rng() * 90);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, `rgba(0,0,0,${alpha + rng() * alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// SAND — wind rippled, warm, with pebbles and dust mottling
// ---------------------------------------------------------------------------

function makeSand(aniso, reg) {
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

// ---------------------------------------------------------------------------
// ADOBE — sun-baked mud plaster, straw flecks, deep cracks, grime
// ---------------------------------------------------------------------------

function makeAdobe(aniso, reg) {
  const S = 1024;
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const rng = makeRNG(1290);

  const bg = ctx.createLinearGradient(0, 0, S * 0.4, S);
  bg.addColorStop(0, '#c29a6d');
  bg.addColorStop(0.45, '#b98d5c');
  bg.addColorStop(1, '#a87a4c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  // broad mottling
  for (let i = 0; i < 80; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 40 + rng() * 260;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const warm = rng() > 0.45;
    g.addColorStop(0, warm ? `rgba(214,176,124,${0.05 + rng() * 0.1})` : `rgba(120,84,52,${0.04 + rng() * 0.09})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // horizontal tamping bands from the mud forms
  for (let i = 0; i < 18; i++) {
    const y = rng() * S;
    ctx.fillStyle = `rgba(${rng() > 0.5 ? '255,238,206' : '96,66,40'},${0.02 + rng() * 0.035})`;
    ctx.fillRect(0, y, S, 2 + rng() * 10);
  }

  // whitewashed patches (upper wall) with ragged edge
  for (let i = 0; i < 12; i++) {
    const x = rng() * S;
    const y = rng() * S * 0.7;
    const w = 90 + rng() * 300;
    const h = 60 + rng() * 220;
    ctx.save();
    ctx.globalAlpha = 0.06 + rng() * 0.14;
    ctx.fillStyle = '#f1e4cc';
    ctx.beginPath();
    ctx.moveTo(x, y);
    const pts = 10;
    for (let p = 1; p <= pts; p++) {
      const a = (p / pts) * TAU;
      ctx.lineTo(x + Math.cos(a) * w * (0.5 + rng() * 0.35), y + Math.sin(a) * h * (0.5 + rng() * 0.35));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // cracks: branching dark polylines with a lit lip
  function crack(x, y, len, angle, width, depth) {
    let cx = x;
    let cy = y;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const steps = Math.max(3, Math.floor(len / 18));
    for (let s = 0; s < steps; s++) {
      angle += (rng() - 0.5) * 0.9;
      cx += Math.cos(angle) * (len / steps);
      cy += Math.sin(angle) * (len / steps);
      ctx.lineTo(cx, cy);
    }
    ctx.strokeStyle = `rgba(48,30,16,${0.4 + rng() * 0.32})`;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.strokeStyle = `rgba(250,226,190,${0.07 + rng() * 0.10})`;
    ctx.lineWidth = Math.max(1, width * 0.45);
    ctx.stroke();
    if (depth > 0) {
      for (let b = 0; b < 2; b++) {
        crack(cx + (rng() - 0.5) * 20, cy + (rng() - 0.5) * 20, len * (0.25 + rng() * 0.3), angle + (rng() - 0.5) * 2, Math.max(0.7, width * 0.6), depth - 1);
      }
    }
  }
  for (let i = 0; i < 22; i++) {
    crack(rng() * S, rng() * S, 80 + rng() * 300, rng() * TAU, 1.4 + rng() * 3, 2);
  }

  // straw / fibre flecks
  for (let i = 0; i < 520; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const a = rng() * TAU;
    const l = 3 + rng() * 12;
    ctx.strokeStyle = rng() > 0.4 ? `rgba(233,208,160,${0.12 + rng() * 0.22})` : `rgba(86,60,36,${0.10 + rng() * 0.16})`;
    ctx.lineWidth = 0.6 + rng() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }

  // chipped pits exposing darker inner mud
  for (let i = 0; i < 70; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 1 + rng() * 5;
    ctx.fillStyle = `rgba(84,56,32,${0.16 + rng() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.4 + rng() * 0.8), rng() * TAU, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(250,228,192,${0.08 + rng() * 0.15})`;
    ctx.beginPath();
    ctx.arc(x - r * 0.2, y - r * 0.35, r * 0.55, 0, TAU);
    ctx.fill();
  }

  // dust that has settled on ledges & bottom grime
  overlayNoise(ctx, S, S, { tile: 256, seed: 6, alpha: 0.13, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.11, seed: 8 });
  const grime = ctx.createLinearGradient(0, S * 0.72, 0, S);
  grime.addColorStop(0, 'rgba(58,38,22,0)');
  grime.addColorStop(1, 'rgba(58,38,22,0.30)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, S, S);

  // height: plaster relief + cracks
  const height = grayCanvas(512, (x, y, u, v) => {
    const n = tileFbm(u, v, 4, 19);
    return clamp(0.56 + (n - 0.5) * 0.5 + (hash2(x, y, 22) - 0.5) * 0.16, 0, 1);
  });
  const hCtx = ctxOf(height);
  const hRng = makeRNG(777);
  hCtx.save();
  hCtx.strokeStyle = 'rgba(30,30,30,0.85)';
  for (let i = 0; i < 26; i++) {
    let cx = hRng() * 512;
    let cy = hRng() * 512;
    let ang = hRng() * TAU;
    hCtx.lineWidth = 1 + hRng() * 2;
    hCtx.beginPath();
    hCtx.moveTo(cx, cy);
    const steps = 10 + Math.floor(hRng() * 14);
    for (let s = 0; s < steps; s++) {
      ang += (hRng() - 0.5) * 1.0;
      cx += Math.cos(ang) * 10;
      cy += Math.sin(ang) * 10;
      hCtx.lineTo(cx, cy);
    }
    hCtx.stroke();
  }
  hCtx.restore();

  const rough = grayCanvas(512, (x, y, u, v) => {
    const n = tileFbm(u, v, 3, 91);
    return clamp(0.84 + n * 0.12 + (hash2(x, y, 51) - 0.5) * 0.05, 0, 1);
  });

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, 3.4, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}

// ---------------------------------------------------------------------------
// STONE — coursed ashlar blocks for gatehouses, arches, well, borders
// ---------------------------------------------------------------------------

function drawMasonryBlocks(ctx, w, h, {
  rows = 5,
  cols = 7,
  palette = ['#b0a088', '#c2b296', '#93836c', '#cbb99a', '#82735d', '#a3937a', '#8a7a63'],
  mortar = '#4f4436',
  seed = 42,
  jitter = 0.16,
  bevel = true,
  chip = true,
  crack = true,
} = {}) {
  const rng = makeRNG(seed);
  fillCanvas(ctx, w, h, mortar);
  const rh = h / rows;
  const cw = w / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * cw;
      const y0 = r * rh;
      const m = 3 + rng() * 3;
      const jx = (rng() - 0.5) * cw * jitter;
      const jy = (rng() - 0.5) * rh * jitter;
      const x = x0 + m + jx * 0.15;
      const y = y0 + m + jy;
      const bw = cw - m * 2 + jx * 0.3;
      const bh = rh - m * 2 - jy * 0.3;
      const col = palette[Math.floor(rng() * palette.length)];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + (rng() - 0.5) * 4, y);
      ctx.lineTo(x + bw + (rng() - 0.5) * 4, y + (rng() - 0.5) * 3);
      ctx.lineTo(x + bw, y + bh);
      ctx.lineTo(x + (rng() - 0.5) * 4, y + bh + (rng() - 0.5) * 3);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      // inner shading gradient
      const grad = ctx.createLinearGradient(x, y, x + bw * 0.7, y + bh);
      grad.addColorStop(0, 'rgba(255,246,224,0.14)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(40,28,16,0.20)');
      ctx.fillStyle = grad;
      ctx.fill();
      if (bevel) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,248,232,0.18)';
        ctx.beginPath();
        ctx.moveTo(x, y + bh);
        ctx.lineTo(x, y);
        ctx.lineTo(x + bw, y);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(34,24,14,0.28)';
        ctx.beginPath();
        ctx.moveTo(x + bw, y);
        ctx.lineTo(x + bw, y + bh);
        ctx.lineTo(x, y + bh);
        ctx.stroke();
      }
      if (chip) {
        for (let i = 0; i < 4; i++) {
          const px = x + (rng() > 0.5 ? 2 : bw - 2);
          const py = y + rng() * bh;
          ctx.fillStyle = mortar;
          ctx.beginPath();
          ctx.arc(px, py, 1 + rng() * 3, 0, TAU);
          ctx.fill();
        }
      }
      if (crack && rng() > 0.72) {
        let cx = x + rng() * bw;
        let cy = y;
        let ang = Math.PI * 0.5 + (rng() - 0.5) * 0.7;
        ctx.strokeStyle = 'rgba(46,32,18,0.32)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let s = 0; s < 5; s++) {
          ang += (rng() - 0.5) * 0.7;
          cx += Math.cos(ang) * bh * 0.2;
          cy += Math.sin(ang) * bh * 0.2;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
      // surface grain
      ctx.globalAlpha = 0.05 + rng() * 0.05;
      ctx.fillStyle = rng() > 0.5 ? '#fff3dc' : '#2e2014';
      ctx.fillRect(x + rng() * bw * 0.6, y + rng() * bh * 0.6, 2 + rng() * bw * 0.4, 1 + rng() * 3);
      ctx.restore();
    }
  }
  overlayNoise(ctx, w, h, { tile: 256, seed: 61, alpha: 0.16, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, w, h, { alpha: 0.12, seed: 62 });
}

function makeStone(aniso, reg) {
  const S = 1024;
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  drawMasonryBlocks(ctx, S, S, { rows: 5, cols: 6, seed: 4242, jitter: 0.2 });

  // soot / dust settling & sun-bleach pass
  const rng = makeRNG(8080);
  ctx.save();
  for (let i = 0; i < 52; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 30 + rng() * 180;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng() > 0.5 ? 'rgba(232,202,152,0.14)' : 'rgba(40,30,20,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // long vertical weathering streaks
  for (let i = 0; i < 34; i++) {
    const x = rng() * S;
    ctx.strokeStyle = `rgba(44,34,22,${0.04 + rng() * 0.1})`;
    ctx.lineWidth = 2 + rng() * 12;
    ctx.beginPath();
    ctx.moveTo(x, rng() * S * 0.5);
    ctx.lineTo(x + (rng() - 0.5) * 26, S);
    ctx.stroke();
  }
  ctx.restore();

  // height map from the same masonry logic (coarse, block relief + mortar recess)
  const height = grayCanvas(512, (x, y, u, v) => {
    const rows = 5;
    const cols = 6;
    const fx = u * cols;
    const fy = v * rows;
    const cx = Math.abs((fx % 1) - 0.5) * 2;
    const cy = Math.abs((fy % 1) - 0.5) * 2;
    const edge = Math.min(1 - cx, 1 - cy);
    const block = clamp(edge * 8, 0, 1);
    const grain = tileFbm(u, v, 3, 22);
    return clamp(0.2 + block * 0.68 + (grain - 0.5) * 0.16, 0, 1);
  });

  const rough = grayCanvas(512, (x, y, u, v) => {
    const n = tileFbm(u, v, 3, 33);
    return clamp(0.80 + n * 0.14, 0, 1);
  });

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, 2.8, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}

// ---------------------------------------------------------------------------
// PAVING — irregular flagstones, worn and dusty, for the plaza / sites
// ---------------------------------------------------------------------------

function makePaving(aniso, reg) {
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

// ---------------------------------------------------------------------------
// WOOD — weathered beams, door planks, market counters, poles
// ---------------------------------------------------------------------------

function makeWood(aniso, reg) {
  const S = 1024;
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const rng = makeRNG(3307);

  const planks = 4;
  const pw = S / planks;
  for (let p = 0; p < planks; p++) {
    const x = p * pw;
    const base = ['#6c4c32', '#775437', '#5f4229', '#71503a'][p % 4];
    ctx.fillStyle = base;
    ctx.fillRect(x, 0, pw, S);
    // long grain
    for (let i = 0; i < 70; i++) {
      const gx = x + rng() * pw;
      const alpha = 0.05 + rng() * 0.14;
      ctx.strokeStyle = rng() > 0.5 ? `rgba(38,24,12,${alpha})` : `rgba(210,176,128,${alpha * 0.8})`;
      ctx.lineWidth = 0.6 + rng() * 2.2;
      ctx.beginPath();
      let cx = gx;
      let cy = 0;
      ctx.moveTo(cx, cy);
      while (cy < S) {
        cy += 14 + rng() * 30;
        cx += (rng() - 0.5) * 7;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
    // knots
    for (let i = 0; i < 3; i++) {
      const kx = x + pw * (0.2 + rng() * 0.6);
      const ky = rng() * S;
      const kr = 4 + rng() * 12;
      for (let r = kr; r > 1; r -= 2) {
        ctx.strokeStyle = `rgba(40,24,12,${0.16 + rng() * 0.18})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(kx, ky, r, r * 0.55, rng() * 0.4, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(30,18,10,0.55)';
      ctx.beginPath();
      ctx.ellipse(kx, ky, kr * 0.35, kr * 0.22, 0, 0, TAU);
      ctx.fill();
    }
    // nails top & bottom
    for (let n = 0; n < 3; n++) {
      const nx = x + 14 + rng() * (pw - 28);
      const ny = 16 + rng() * 20;
      const ny2 = S - 16 - rng() * 20;
      for (const yy of [ny, ny2]) {
        ctx.fillStyle = '#3a3128';
        ctx.beginPath();
        ctx.arc(nx, yy, 3, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(220,210,190,0.35)';
        ctx.beginPath();
        ctx.arc(nx - 0.8, yy - 0.8, 1.2, 0, TAU);
        ctx.fill();
      }
    }
    // gap between planks
    ctx.fillStyle = 'rgba(24,15,8,0.75)';
    ctx.fillRect(x + pw - 2.2, 0, 2.6, S);
    ctx.fillStyle = 'rgba(220,190,150,0.10)';
    ctx.fillRect(x + pw - 4.2, 0, 1.2, S);
  }

  // sun bleaching, dust and water streaks
  const bleach = ctx.createLinearGradient(0, 0, 0, S);
  bleach.addColorStop(0, 'rgba(230,206,168,0.10)');
  bleach.addColorStop(0.6, 'rgba(0,0,0,0)');
  bleach.addColorStop(1, 'rgba(30,20,12,0.22)');
  ctx.fillStyle = bleach;
  ctx.fillRect(0, 0, S, S);
  ctx.save();
  for (let i = 0; i < 26; i++) {
    const x = rng() * S;
    ctx.strokeStyle = `rgba(70,52,34,${0.05 + rng() * 0.1})`;
    ctx.lineWidth = 2 + rng() * 8;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rng() - 0.5) * 20, S);
    ctx.stroke();
  }
  ctx.restore();
  overlayNoise(ctx, S, S, { tile: 256, seed: 93, alpha: 0.13, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.1, seed: 94 });

  const height = grayCanvas(512, (x, y, u, v) => {
    const planks2 = 4;
    const gap = Math.abs(((u * planks2) % 1) - 0.94);
    const recess = gap < 0.05 ? 0.2 : 0.7;
    const grain = tileFbm(u * 3, v * 0.35, 3, 12);
    return clamp(recess * 0.7 + grain * 0.3, 0, 1);
  });
  const rough = grayCanvas(512, (x, y, u, v) => clamp(0.72 + tileFbm(u, v, 3, 55) * 0.2, 0, 1));

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, 2.4, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}

// ---------------------------------------------------------------------------
// CRATE — banded wooden ammo crate with stencilled markings (fits a full face)
// ---------------------------------------------------------------------------

function makeCrate(aniso, reg) {
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

// ---------------------------------------------------------------------------
// METAL — painted olive steel with chipped paint, rivets, scratches (ORM pack)
// ---------------------------------------------------------------------------

function makeMetal(aniso, reg) {
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

// ---------------------------------------------------------------------------
// RUST — corroded steel drums / scrap (ORM pack)
// ---------------------------------------------------------------------------

function makeRust(aniso, reg) {
  const S = 512;
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const rng = makeRNG(9917);
  fillCanvas(ctx, S, S, '#7a4526');
  for (let i = 0; i < 90; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 6 + rng() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng() > 0.5 ? 'rgba(184,96,44,0.5)' : 'rgba(64,36,18,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // pitting
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = `rgba(${30 + rng() * 40},${18 + rng() * 24},${10 + rng() * 16},${0.3 + rng() * 0.4})`;
    ctx.beginPath();
    ctx.arc(rng() * S, rng() * S, 0.5 + rng() * 2.4, 0, TAU);
    ctx.fill();
  }
  // bare-metal patches
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = 'rgba(150,146,132,0.5)';
    ctx.beginPath();
    ctx.ellipse(rng() * S, rng() * S, 3 + rng() * 16, 2 + rng() * 8, rng() * TAU, 0, TAU);
    ctx.fill();
  }
  // drip streaks
  for (let i = 0; i < 40; i++) {
    const x = rng() * S;
    ctx.strokeStyle = `rgba(58,32,16,${0.08 + rng() * 0.16})`;
    ctx.lineWidth = 1.5 + rng() * 5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rng() - 0.5) * 30, S);
    ctx.stroke();
  }
  overlayNoise(ctx, S, S, { tile: 256, seed: 133, alpha: 0.2, scale: 2, mode: 'overlay' });

  const height = grayCanvas(512, (x, y, u, v) => clamp(0.5 + tileFbm(u, v, 4, 21) * 0.45, 0, 1));
  const rough = grayCanvas(512, (x, y, u, v) => clamp(0.78 + tileFbm(u, v, 3, 29) * 0.2, 0, 1));
  const metal = grayCanvas(512, (x, y, u, v) => clamp(0.55 - tileFbm(u, v, 3, 30) * 0.4, 0, 1));
  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, 2.4, aniso)),
    ormMap: reg(packORM(rough, metal, aniso)),
  };
}

// ---------------------------------------------------------------------------
// CORRUGATED SHEET — roofs and lean-to awnings
// ---------------------------------------------------------------------------

function makeSheetMetal(aniso, reg) {
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

// ---------------------------------------------------------------------------
// SANDBAG — burlap weave, dirt, stitched seams
// ---------------------------------------------------------------------------

function makeSandbag(aniso, reg) {
  const S = 512;
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const rng = makeRNG(7723);
  fillCanvas(ctx, S, S, '#9c8763');

  // burlap weave
  ctx.save();
  ctx.globalAlpha = 0.20;
  for (let y = 0; y < S; y += 4) {
    ctx.fillStyle = y % 8 === 0 ? '#6d5c40' : '#c2ad84';
    ctx.fillRect(0, y, S, 1.6);
  }
  for (let x = 0; x < S; x += 4) {
    ctx.fillStyle = x % 8 === 0 ? '#75643f' : '#cbb68b';
    ctx.fillRect(x, 0, 1.6, S);
  }
  ctx.restore();

  // dirt & sand staining
  for (let i = 0; i < 70; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 6 + rng() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng() > 0.4 ? `rgba(112,88,54,${0.08 + rng() * 0.16})` : `rgba(196,170,122,${0.08 + rng() * 0.16})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // stitched seam along the top
  ctx.save();
  ctx.strokeStyle = 'rgba(70,54,34,0.55)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.moveTo(0, 54);
  ctx.lineTo(S, 54);
  ctx.stroke();
  ctx.restore();
  // tied ends
  for (const x of [70, S - 70]) {
    ctx.strokeStyle = 'rgba(60,46,28,0.7)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, 30);
    ctx.quadraticCurveTo(x + 6, 60, x + 2, 96);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 4, 50, 12, 0, TAU);
    ctx.stroke();
  }
  overlayNoise(ctx, S, S, { tile: 256, seed: 151, alpha: 0.18, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.1, seed: 152 });

  const height = grayCanvas(512, (x, y, u, v) => {
    const weave = (Math.sin(u * 512 * 0.78) + Math.sin(v * 512 * 0.78)) * 0.06;
    return clamp(0.5 + weave + (tileFbm(u, v, 4, 22) - 0.5) * 0.4, 0, 1);
  });
  const rough = grayCanvas(512, (x, y, u, v) => clamp(0.9 + tileFbm(u, v, 3, 23) * 0.08, 0, 1));
  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, 2.0, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}

// ---------------------------------------------------------------------------
// CLOTH — striped awning, olive tarp, plain canvas (all share weave normals)
// ---------------------------------------------------------------------------

function makeCloth(aniso, reg) {
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

// ---------------------------------------------------------------------------
// BANNERS — painted cloth standards hung from poles and walls
// ---------------------------------------------------------------------------

function makeBanners(aniso, reg) {
  function bannerCloth(w, h, draw) {
    const c = el(w, h);
    const ctx = c.getContext('2d');
    draw(ctx, w, h);
    return c;
  }

  function baseCloth(ctx, w, h, top, bottom, seed) {
    const rng = makeRNG(seed);
    const g = ctx.createLinearGradient(0, 0, w * 0.2, h);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // woven texture
    ctx.save();
    ctx.globalAlpha = 0.1;
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = y % 6 === 0 ? '#000' : '#fff';
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();
    // stains and sun fade
    for (let i = 0; i < 30; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = 12 + rng() * 100;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rng() > 0.5 ? `rgba(255,236,200,${0.04 + rng() * 0.09})` : `rgba(24,14,8,${0.05 + rng() * 0.1})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    shadeFolds(ctx, w, h, { count: 9, vertical: true, alpha: 0.06, seed: seed + 1 });
  }

  function bannerStandard(letter, label, cjk, bgTop, bgBottom, ink, accent, seed) {
    const w = 512;
    const h = 1024;
    const c = bannerCloth(w, h, (ctx) => {
      baseCloth(ctx, w, h, bgTop, bgBottom, seed);
      // stitched border
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 9;
      ctx.strokeRect(26, 26, w - 52, h - 52);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 2;
      ctx.setLineDash([11, 9]);
      ctx.strokeRect(42, 42, w - 84, h - 84);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // ring + big letter
      ctx.strokeStyle = ink;
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.34, 158, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.34, 178, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink;
      ctx.font = `900 280px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, w / 2, h * 0.345 + 8);
      // labels
      ctx.fillStyle = ink;
      ctx.font = `900 82px ${FONT_DISPLAY}`;
      ctx.fillText(label, w / 2, h * 0.60);
      ctx.font = `700 46px ${FONT_CJK}`;
      ctx.globalAlpha = 0.9;
      ctx.fillText(cjk, w / 2, h * 0.675);
      ctx.globalAlpha = 0.78;
      ctx.font = `700 30px ${FONT_MONO}`;
      ctx.fillText('SANDSTRIKE // 沙暴协议', w / 2, h * 0.775);
      // tail stripes
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = accent;
      ctx.fillRect(w * 0.22, h * 0.845, w * 0.56, 10);
      ctx.fillRect(w * 0.28, h * 0.875, w * 0.44, 5);
      // weathering
      ctx.globalCompositeOperation = 'destination-out';
      const rng = makeRNG(seed + 99);
      for (let i = 0; i < 300; i++) {
        ctx.globalAlpha = 0.12 + rng() * 0.35;
        ctx.beginPath();
        ctx.arc(rng() * w, rng() * h, 0.6 + rng() * 2.6, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      tearClothEdges(ctx.canvas, { bottom: true, sides: true, seed: seed + 7, depth: 30 });
    });
    const tex = textureFromCanvas(c, { aniso });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return reg(tex);
  }

  const a = bannerStandard('A', 'ALPHA', 'A 点 · 阿尔法', '#7d2a1e', '#5a1a12', '#e9d8b4', '#d8b878', 4100);
  const b = bannerStandard('B', 'BRAVO', 'B 点 · 布拉沃', '#20424a', '#122a30', '#e2ddc4', '#8fd8d4', 4200);

  // wide title banner
  const tw = 1024;
  const th = 512;
  const title = bannerCloth(tw, th, (ctx) => {
    baseCloth(ctx, tw, th, '#221c15', '#14100b', 4300);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#ff8a3c';
    for (let i = -2; i < 8; i++) {
      ctx.save();
      ctx.translate(i * 180, 0);
      ctx.rotate(-0.35);
      ctx.fillRect(0, -200, 26, th + 400);
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = '#ff8a3c';
    ctx.lineWidth = 6;
    ctx.strokeRect(30, 30, tw - 60, th - 60);
    ctx.fillStyle = '#f2e4c6';
    ctx.font = `900 132px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SANDSTRIKE', tw / 2, th * 0.37, tw * 0.84);
    ctx.fillStyle = '#ff8a3c';
    ctx.font = `900 74px ${FONT_CJK}`;
    ctx.fillText('沙 暴 协 议', tw / 2, th * 0.56, tw * 0.7);
    ctx.fillStyle = '#bdb096';
    ctx.font = `700 30px ${FONT_MONO}`;
    ctx.fillText('OUTPOST 07 // SECTOR SEVEN // 07:41 LOCAL', tw / 2, th * 0.72);
    ctx.fillStyle = '#73e6ff';
    ctx.fillRect(tw * 0.35, th * 0.79, tw * 0.3, 4);
    ctx.globalCompositeOperation = 'destination-out';
    const rng = makeRNG(4301);
    for (let i = 0; i < 340; i++) {
      ctx.globalAlpha = 0.1 + rng() * 0.3;
      ctx.beginPath();
      ctx.arc(rng() * tw, rng() * th, 0.5 + rng() * 2.2, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    tearClothEdges(ctx.canvas, { bottom: false, sides: true, seed: 4302, depth: 12 });
    shadeFolds(ctx, tw, th, { count: 6, vertical: true, alpha: 0.05, seed: 4303 });
  });
  const titleTex = textureFromCanvas(title, { aniso });

  // hazard warning banner
  const warn = bannerCloth(1024, 512, (ctx) => {
    baseCloth(ctx, 1024, 512, '#c79a2c', '#a87c1c', 4400);
    // hazard bands top & bottom
    ctx.save();
    for (const y of [70, 390]) {
      ctx.save();
      ctx.translate(0, y);
      ctx.beginPath();
      ctx.rect(26, 0, 1024 - 52, 52);
      ctx.clip();
      ctx.fillStyle = '#16130d';
      for (let x = -80; x < 1120; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 40, 0);
        ctx.lineTo(x + 80, 52);
        ctx.lineTo(x + 40, 52);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = '#16130d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 88px ${FONT_DISPLAY}`;
    ctx.fillText('RESTRICTED AREA', 512, 205, 1024 * 0.82);
    ctx.font = `900 64px ${FONT_CJK}`;
    ctx.fillText('军 事 禁 区', 512, 290, 1024 * 0.6);
    ctx.font = `700 28px ${FONT_MONO}`;
    ctx.fillText('AUTHORIZED PERSONNEL ONLY · 07', 512, 348);
    ctx.globalCompositeOperation = 'destination-out';
    const rng = makeRNG(4401);
    for (let i = 0; i < 260; i++) {
      ctx.globalAlpha = 0.1 + rng() * 0.35;
      ctx.beginPath();
      ctx.arc(rng() * 1024, rng() * 512, 0.6 + rng() * 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    shadeFolds(ctx, 1024, 512, { count: 5, vertical: true, alpha: 0.05, seed: 4402 });
    tearClothEdges(ctx.canvas, { bottom: false, sides: true, seed: 4403, depth: 10 });
  });
  const warnTex = textureFromCanvas(warn, { aniso });

  return { a, b, title: reg(titleTex), warn: reg(warnTex) };
}

// ---------------------------------------------------------------------------
// ATLAS HELPERS
// ---------------------------------------------------------------------------

function atlasCell(size, cols, rows, col, row) {
  return {
    u0: col / cols,
    u1: (col + 1) / cols,
    v0: 1 - (row + 1) / rows,
    v1: 1 - row / rows,
  };
}

function drawCell(ctx, size, cols, rows, col, row, fn) {
  const cw = size / cols;
  const ch = size / rows;
  ctx.save();
  ctx.translate(col * cw, row * ch);
  ctx.beginPath();
  ctx.rect(0, 0, cw, ch);
  ctx.clip();
  fn(ctx, cw, ch);
  ctx.restore();
}

function weatherCell(ctx, w, h, seed, strength = 1) {
  const rng = makeRNG(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 170 * strength; i++) {
    ctx.globalAlpha = 0.12 + rng() * 0.4;
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * h, 0.5 + rng() * 2.6, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// POSTER ATLAS — 8 weathered paper posters / notices (4 × 2 cells)
// ---------------------------------------------------------------------------

function makePosterAtlas(aniso, reg) {
  const S = 1024;
  const cols = 4;
  const rows = 2;
  const c = el(S, S);
  const ctx = c.getContext('2d');

  function paper(w, h, tint = '#e2d3ae', seed = 1) {
    const rng = makeRNG(seed);
    ctx.fillStyle = tint;
    ctx.fillRect(2, 2, w - 4, h - 4);
    ctx.save();
    for (let i = 0; i < 46; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = 4 + rng() * 50;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rng() > 0.5 ? '120,92,52' : '250,240,214'},${0.04 + rng() * 0.1})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // torn / dog-eared corners
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(18 + rng() * 26, 0);
    ctx.lineTo(0, 18 + rng() * 26);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w, h);
    ctx.lineTo(w - 14 - rng() * 22, h);
    ctx.lineTo(w, h - 14 - rng() * 22);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  // cell 0 — water ration
  drawCell(ctx, S, cols, rows, 0, 0, (cx, cw, ch) => {
    paper(cw, ch, '#e6d9b8', 11);
    cx.fillStyle = '#2f4a58';
    cx.fillRect(14, 18, cw - 28, 92);
    cx.fillStyle = '#eee3c6';
    cx.font = `900 38px ${FONT_DISPLAY}`;
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText('WATER RATION', cw / 2, 50);
    cx.font = `700 22px ${FONT_CJK}`;
    cx.fillText('配 水 通 知', cw / 2, 86);
    // droplet icon
    cx.fillStyle = '#3f6d80';
    cx.beginPath();
    cx.moveTo(cw / 2, 140);
    cx.bezierCurveTo(cw / 2 + 38, 186, cw / 2 + 24, 228, cw / 2, 228);
    cx.bezierCurveTo(cw / 2 - 24, 228, cw / 2 - 38, 186, cw / 2, 140);
    cx.fill();
    cx.fillStyle = 'rgba(255,255,255,0.5)';
    cx.beginPath();
    cx.ellipse(cw / 2 - 9, 190, 7, 13, -0.4, 0, TAU);
    cx.fill();
    cx.fillStyle = '#3a2c1e';
    cx.font = `700 20px ${FONT_MONO}`;
    cx.fillText('06:00 – 09:00', cw / 2, 272);
    cx.fillText('SECTOR 7 ONLY', cw / 2, 300);
    cx.font = `700 34px ${FONT_MONO}`;
    cx.fillText('25 L / DAY', cw / 2, 352);
    cx.font = `700 16px ${FONT_MONO}`;
    cx.fillStyle = 'rgba(58,44,30,0.7)';
    cx.fillText('BY ORDER OF OUTPOST COMMAND', cw / 2, 430);
    weatherCell(cx, cw, ch, 1201, 0.7);
  });

  // cell 1 — sector 7 ID
  drawCell(ctx, S, cols, rows, 1, 0, (cx, cw, ch) => {
    paper(cw, ch, '#d9ccb0', 12);
    cx.fillStyle = '#8a2e22';
    cx.fillRect(0, 0, cw, 24);
    cx.fillStyle = '#2a2118';
    cx.textAlign = 'center';
    cx.font = `900 66px ${FONT_DISPLAY}`;
    cx.fillText('SECTOR 7', cw / 2, 100);
    cx.font = `700 20px ${FONT_MONO}`;
    cx.fillText('OUTPOST 07 // PERSONNEL', cw / 2, 130);
    cx.fillStyle = '#b7a488';
    cx.fillRect(38, 150, cw - 76, 190);
    cx.fillStyle = '#3a3128';
    // robot portrait
    cx.beginPath();
    cx.moveTo(cw / 2 - 46, 322);
    cx.lineTo(cw / 2 - 52, 226);
    cx.lineTo(cw / 2 - 26, 196);
    cx.lineTo(cw / 2 + 26, 196);
    cx.lineTo(cw / 2 + 52, 226);
    cx.lineTo(cw / 2 + 46, 322);
    cx.closePath();
    cx.fill();
    cx.fillStyle = '#73e6ff';
    cx.fillRect(cw / 2 - 34, 240, 68, 12);
    cx.fillStyle = '#2a2118';
    cx.font = `700 18px ${FONT_MONO}`;
    cx.fillText('UNIT Λ-07', cw / 2, 390);
    cx.font = `700 15px ${FONT_MONO}`;
    cx.fillText('CLEARANCE: GOLD', cw / 2, 416);
    cx.fillRect(34, 434, cw - 68, 4);
    cx.fillStyle = 'rgba(42,33,24,0.6)';
    cx.font = `700 13px ${FONT_MONO}`;
    cx.fillText('PROPERTY OF SANDSTRIKE DIVISION', cw / 2, 462);
    weatherCell(cx, cw, ch, 1202, 0.8);
  });

  // cell 2 — ammo inventory
  drawCell(ctx, S, cols, rows, 2, 0, (cx, cw, ch) => {
    paper(cw, ch, '#c9c3aa', 13);
    cx.fillStyle = '#3d4230';
    cx.fillRect(16, 18, cw - 32, 64);
    cx.fillStyle = '#ded6bc';
    cx.textAlign = 'center';
    cx.font = `900 30px ${FONT_DISPLAY}`;
    cx.fillText('AMMUNITION', cw / 2, 48);
    cx.font = `700 16px ${FONT_CJK}`;
    cx.fillText('弹药库存 · Λ-07', cw / 2, 70);
    cx.textAlign = 'left';
    cx.fillStyle = '#2e2a20';
    cx.font = `700 17px ${FONT_MONO}`;
    const rowsData = [['5.56 ×45', '2,400'], ['7.62 ×51', '1,850'], ['12.7 ×99', '320'], ['40mm HEDP', '48'], ['CELLS · TYPE C', '96']];
    rowsData.forEach((r, i) => {
      const y = 116 + i * 44;
      cx.fillText(r[0], 28, y);
      cx.fillText(r[1], cw - 92, y);
      cx.fillStyle = 'rgba(46,42,32,0.25)';
      cx.fillRect(24, y + 12, cw - 48, 1);
      cx.fillStyle = '#2e2a20';
    });
    cx.fillStyle = '#8a2e22';
    cx.font = `900 20px ${FONT_DISPLAY}`;
    cx.fillText('DO NOT REMOVE', 28, 372);
    cx.font = `700 13px ${FONT_MONO}`;
    cx.fillStyle = 'rgba(46,42,32,0.75)';
    cx.fillText('FORM 07-AMMO REV.C', 28, 400);
    cx.fillStyle = 'rgba(60,54,40,0.35)';
    cx.fillRect(24, 420, cw - 48, 3);
    cx.fillStyle = 'rgba(60,54,40,0.25)';
    for (let i = 0; i < 5; i++) cx.fillRect(24 + i * 44, 432, 26, 26);
    weatherCell(cx, cw, ch, 1203, 0.9);
  });

  // cell 3 — hostile units warning
  drawCell(ctx, S, cols, rows, 3, 0, (cx, cw, ch) => {
    paper(cw, ch, '#ddc9a4', 14);
    cx.fillStyle = '#8a2e1c';
    cx.textAlign = 'center';
    cx.font = `900 34px ${FONT_DISPLAY}`;
    cx.fillText('CAUTION', cw / 2, 54);
    cx.font = `900 26px ${FONT_CJK}`;
    cx.fillText('敌 对 单 位', cw / 2, 90);
    // warning triangle
    cx.save();
    cx.translate(cw / 2, 210);
    cx.fillStyle = '#d8b23c';
    cx.beginPath();
    cx.moveTo(0, -100);
    cx.lineTo(96, 82);
    cx.lineTo(-96, 82);
    cx.closePath();
    cx.fill();
    cx.strokeStyle = '#2a2016';
    cx.lineWidth = 9;
    cx.stroke();
    cx.fillStyle = '#2a2016';
    cx.font = `900 96px ${FONT_DISPLAY}`;
    cx.fillText('!', 0, 30);
    cx.restore();
    cx.fillStyle = '#2a2016';
    cx.font = `700 18px ${FONT_MONO}`;
    cx.fillText('AUTONOMOUS HOSTILES', cw / 2, 336);
    cx.fillText('ENGAGE ON SIGHT', cw / 2, 362);
    cx.fillStyle = '#8a2e1c';
    cx.fillRect(34, 386, cw - 68, 3);
    cx.fillStyle = 'rgba(42,32,22,0.6)';
    cx.font = `700 13px ${FONT_MONO}`;
    cx.fillText('SANDSTRIKE // 沙暴协议', cw / 2, 414);
    cx.fillText('07-ALPHA-9', cw / 2, 434);
    weatherCell(cx, cw, ch, 1204, 0.8);
  });

  // cell 4 — hand-painted A site arrow
  drawCell(ctx, S, cols, rows, 4, 1, (cx, cw, ch) => {
    cx.fillStyle = 'rgba(20,15,10,0.10)';
    cx.fillRect(0, 0, cw, ch);
    cx.strokeStyle = '#ece0c0';
    cx.lineWidth = 13;
    cx.lineCap = 'round';
    cx.globalAlpha = 0.86;
    cx.beginPath();
    cx.moveTo(cw / 2, 60);
    cx.lineTo(cw / 2, 300);
    cx.stroke();
    cx.beginPath();
    cx.moveTo(cw / 2 - 74, 236);
    cx.lineTo(cw / 2, 320);
    cx.lineTo(cw / 2 + 74, 236);
    cx.stroke();
    cx.font = `900 84px ${FONT_DISPLAY}`;
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText('A', cw / 2, 150);
    cx.font = `700 30px ${FONT_CJK}`;
    cx.fillText('A 点', cw / 2, 398);
    cx.font = `700 20px ${FONT_MONO}`;
    cx.fillText('ALPHA SITE', cw / 2, 442);
    cx.globalAlpha = 1;
    // rough streaks
    cx.strokeStyle = 'rgba(236,224,192,0.25)';
    cx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      cx.beginPath();
      cx.moveTo(30 + i * 28, 380 + (i % 3) * 8);
      cx.lineTo(20 + i * 28, 470);
      cx.stroke();
    }
    weatherCell(cx, cw, ch, 1205, 1.2);
  });

  // cell 5 — medevac
  drawCell(ctx, S, cols, rows, 5, 1, (cx, cw, ch) => {
    paper(cw, ch, '#e4dcc4', 16);
    cx.fillStyle = '#7d2620';
    cx.fillRect(0, 0, cw, 88);
    cx.fillStyle = '#f0e4c8';
    cx.textAlign = 'center';
    cx.font = `900 34px ${FONT_DISPLAY}`;
    cx.fillText('MEDEVAC', cw / 2, 52);
    cx.fillStyle = '#7d2620';
    cx.fillRect(cw / 2 - 60, 130, 120, 34);
    cx.fillRect(cw / 2 - 28, 102, 56, 90);
    cx.fillStyle = '#2f2a20';
    cx.font = `700 18px ${FONT_MONO}`;
    cx.fillText('LZ: SOUTH COURTYARD', cw / 2, 268);
    cx.fillText('FREQ 121.500', cw / 2, 296);
    cx.font = `700 16px ${FONT_CJK}`;
    cx.fillText('伤员优先 · 保持通道畅通', cw / 2, 334);
    cx.strokeStyle = 'rgba(47,42,32,0.4)';
    cx.lineWidth = 2;
    cx.setLineDash([8, 6]);
    cx.strokeRect(28, 356, cw - 56, 72);
    cx.setLineDash([]);
    cx.fillStyle = 'rgba(47,42,32,0.65)';
    cx.font = `700 13px ${FONT_MONO}`;
    cx.fillText('07 / MEDICAL CORPS', cw / 2, 396);
    weatherCell(cx, cw, ch, 1206, 0.9);
  });

  // cell 6 — faded travel poster
  drawCell(ctx, S, cols, rows, 6, 1, (cx, cw, ch) => {
    paper(cw, ch, '#d8c4a0', 18);
    const sky = cx.createLinearGradient(0, 0, 0, ch * 0.62);
    sky.addColorStop(0, '#c98a5a');
    sky.addColorStop(0.65, '#e8cfa0');
    sky.addColorStop(1, '#f2e2bc');
    cx.fillStyle = sky;
    cx.fillRect(10, 10, cw - 20, ch * 0.62);
    // sun
    cx.fillStyle = 'rgba(255,240,200,0.9)';
    cx.beginPath();
    cx.arc(cw * 0.66, ch * 0.33, 34, 0, TAU);
    cx.fill();
    // dunes
    cx.fillStyle = '#c2915a';
    cx.beginPath();
    cx.moveTo(0, ch * 0.52);
    cx.quadraticCurveTo(cw * 0.35, ch * 0.4, cw, ch * 0.55);
    cx.lineTo(cw, ch * 0.64);
    cx.lineTo(0, ch * 0.64);
    cx.fill();
    cx.fillStyle = '#a8743f';
    cx.beginPath();
    cx.moveTo(0, ch * 0.58);
    cx.quadraticCurveTo(cw * 0.55, ch * 0.5, cw, ch * 0.62);
    cx.lineTo(cw, ch * 0.66);
    cx.lineTo(0, ch * 0.66);
    cx.fill();
    // palm silhouette
    cx.strokeStyle = '#4a3420';
    cx.lineWidth = 7;
    cx.beginPath();
    cx.moveTo(cw * 0.22, ch * 0.63);
    cx.quadraticCurveTo(cw * 0.24, ch * 0.5, cw * 0.28, ch * 0.4);
    cx.stroke();
    cx.lineWidth = 4;
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI + (i / 5) * Math.PI;
      cx.beginPath();
      cx.moveTo(cw * 0.28, ch * 0.4);
      cx.quadraticCurveTo(cw * 0.28 + Math.cos(a) * 30, ch * 0.4 + Math.sin(a) * 10 - 6, cw * 0.28 + Math.cos(a) * 58, ch * 0.4 + Math.sin(a) * 26 + 4);
      cx.stroke();
    }
    cx.fillStyle = '#3a2c1c';
    cx.textAlign = 'center';
    cx.font = `900 44px ${FONT_DISPLAY}`;
    cx.fillText('SECTOR 7', cw / 2, ch * 0.76);
    cx.font = `700 20px ${FONT_CJK}`;
    cx.fillText('沙 漠 绿 洲 · 沙 暴 协 议', cw / 2, ch * 0.82);
    cx.font = `700 15px ${FONT_MONO}`;
    cx.fillStyle = 'rgba(58,44,28,0.7)';
    cx.fillText('TRAVEL BUREAU · 07', cw / 2, ch * 0.88);
    weatherCell(cx, cw, ch, 1207, 0.8);
  });

  // cell 7 — 沙暴 poster
  drawCell(ctx, S, cols, rows, 7, 1, (cx, cw, ch) => {
    paper(cw, ch, '#d6c8a8', 19);
    cx.fillStyle = '#7d2a20';
    cx.fillRect(24, 24, cw - 48, ch - 48);
    cx.strokeStyle = '#e8d8b2';
    cx.lineWidth = 4;
    cx.strokeRect(38, 38, cw - 76, ch - 76);
    cx.fillStyle = '#e8d8b2';
    cx.textAlign = 'center';
    cx.font = `900 86px ${FONT_CJK}`;
    cx.fillText('沙 暴', cw / 2, 190);
    cx.font = `700 40px ${FONT_CJK}`;
    cx.fillText('协 议', cw / 2, 254);
    cx.fillStyle = '#d8b878';
    cx.fillRect(cw * 0.3, 282, cw * 0.4, 4);
    cx.fillStyle = '#e8d8b2';
    cx.font = `900 26px ${FONT_DISPLAY}`;
    cx.fillText('SANDSTRIKE', cw / 2, 326);
    cx.font = `700 15px ${FONT_MONO}`;
    cx.fillText('OUTPOST 07 // 07:41', cw / 2, 356);
    // stamp
    cx.save();
    cx.translate(cw / 2, 414);
    cx.rotate(-0.12);
    cx.strokeStyle = 'rgba(232,216,178,0.75)';
    cx.lineWidth = 3;
    cx.beginPath();
    cx.arc(0, 0, 40, 0, TAU);
    cx.stroke();
    cx.font = `900 20px ${FONT_MONO}`;
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText('SECURED', 0, 0);
    cx.restore();
    weatherCell(cx, cw, ch, 1208, 0.7);
  });

  const texture = textureFromCanvas(c, { aniso });
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  reg(texture);
  const cells = {};
  const names = ['water', 'sector', 'ammo', 'hostile', 'aArrow', 'medevac', 'travel', 'shabao'];
  names.forEach((name, i) => {
    cells[name] = atlasCell(S, cols, rows, i % cols, Math.floor(i / cols));
  });
  return { texture, cells };
}

// ---------------------------------------------------------------------------
// DECAL ATLAS — 16 transparent stencils / stains / track decals (4 × 4)
// ---------------------------------------------------------------------------

function makeDecalAtlas(aniso, reg) {
  const S = 1024;
  const cols = 4;
  const rows = 4;
  const c = el(S, S);
  const ctx = c.getContext('2d');

  function paint(cx, cw, ch, fn) {
    cx.save();
    fn(cx, cw, ch);
    cx.restore();
  }

  // 0 — A site ground stencil
  drawCell(ctx, S, cols, rows, 0, 0, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.strokeStyle = '#efe3c4';
      c2.lineWidth = 17;
      c2.beginPath();
      c2.arc(cw / 2, ch / 2, 96, 0, TAU);
      c2.stroke();
      c2.lineWidth = 5;
      c2.beginPath();
      c2.arc(cw / 2, ch / 2, 116, 0, TAU);
      c2.stroke();
      c2.fillStyle = '#efe3c4';
      c2.font = `900 168px ${FONT_DISPLAY}`;
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.fillText('A', cw / 2, ch / 2 + 6);
    });
    weatherCell(cx, cw, ch, 2100, 1.4);
  });

  // 1 — B site ground stencil
  drawCell(ctx, S, cols, rows, 1, 0, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.strokeStyle = '#e6e1cc';
      c2.lineWidth = 17;
      c2.beginPath();
      c2.arc(cw / 2, ch / 2, 96, 0, TAU);
      c2.stroke();
      c2.lineWidth = 5;
      c2.beginPath();
      c2.arc(cw / 2, ch / 2, 116, 0, TAU);
      c2.stroke();
      c2.fillStyle = '#e6e1cc';
      c2.font = `900 168px ${FONT_DISPLAY}`;
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.fillText('B', cw / 2, ch / 2 + 6);
    });
    weatherCell(cx, cw, ch, 2101, 1.4);
  });

  // 2 — arrow (points +V i.e. up in cell; rotate plane as needed)
  drawCell(ctx, S, cols, rows, 2, 0, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.fillStyle = '#ece0c0';
      c2.beginPath();
      c2.moveTo(cw / 2, 26);
      c2.lineTo(cw - 34, 132);
      c2.lineTo(cw / 2 + 34, 132);
      c2.lineTo(cw / 2 + 34, ch - 26);
      c2.lineTo(cw / 2 - 34, ch - 26);
      c2.lineTo(cw / 2 - 34, 132);
      c2.lineTo(34, 132);
      c2.closePath();
      c2.fill();
    });
    weatherCell(cx, cw, ch, 2102, 1.2);
  });

  // 3 — hazard stripe band
  drawCell(ctx, S, cols, rows, 3, 0, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.save();
      c2.translate(0, ch * 0.32);
      c2.beginPath();
      c2.rect(0, 0, cw, ch * 0.36);
      c2.clip();
      c2.fillStyle = '#d8b23c';
      c2.fillRect(0, 0, cw, ch * 0.36);
      c2.fillStyle = '#2a2118';
      for (let x = -60; x < cw + 60; x += 64) {
        c2.beginPath();
        c2.moveTo(x, 0);
        c2.lineTo(x + 32, 0);
        c2.lineTo(x + 32 + ch * 0.36, ch * 0.36);
        c2.lineTo(x + ch * 0.36, ch * 0.36);
        c2.closePath();
        c2.fill();
      }
      c2.restore();
    });
    weatherCell(cx, cw, ch, 2103, 1.6);
  });

  // 4 — graffiti tag
  drawCell(ctx, S, cols, rows, 0, 1, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.strokeStyle = '#ff8a3c';
      c2.lineWidth = 11;
      c2.lineCap = 'round';
      c2.font = `900 74px ${FONT_DISPLAY}`;
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.save();
      c2.translate(cw / 2, ch / 2);
      c2.rotate(-0.12);
      c2.fillStyle = 'rgba(255,138,60,0.85)';
      c2.fillText('SNDSTK', 0, -26);
      c2.fillStyle = 'rgba(115,230,255,0.8)';
      c2.font = `900 54px ${FONT_DISPLAY}`;
      c2.fillText('Λ-07', 0, 40);
      c2.strokeStyle = 'rgba(255,138,60,0.4)';
      c2.lineWidth = 4;
      c2.beginPath();
      c2.moveTo(-cw * 0.36, 74);
      c2.lineTo(cw * 0.36, 60);
      c2.stroke();
      c2.restore();
      // overspray
      const rng = makeRNG(2104);
      c2.fillStyle = 'rgba(255,138,60,0.25)';
      for (let i = 0; i < 90; i++) {
        c2.beginPath();
        c2.arc(cw / 2 + (rng() - 0.5) * 190, ch / 2 + (rng() - 0.5) * 150, 0.5 + rng() * 1.8, 0, TAU);
        c2.fill();
      }
    });
    weatherCell(cx, cw, ch, 2105, 0.7);
  });

  // 5 — robot skull graffiti
  drawCell(ctx, S, cols, rows, 1, 1, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.strokeStyle = 'rgba(115,230,255,0.9)';
      c2.fillStyle = 'rgba(115,230,255,0.85)';
      c2.lineWidth = 8;
      c2.beginPath();
      c2.moveTo(cw / 2 - 56, ch / 2 + 30);
      c2.lineTo(cw / 2 - 54, ch / 2 - 34);
      c2.lineTo(cw / 2 - 26, ch / 2 - 66);
      c2.lineTo(cw / 2 + 26, ch / 2 - 66);
      c2.lineTo(cw / 2 + 54, ch / 2 - 34);
      c2.lineTo(cw / 2 + 56, ch / 2 + 30);
      c2.closePath();
      c2.stroke();
      c2.fillRect(cw / 2 - 34, ch / 2 - 34, 24, 12);
      c2.fillRect(cw / 2 + 10, ch / 2 - 34, 24, 12);
      c2.strokeStyle = 'rgba(115,230,255,0.5)';
      c2.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        c2.beginPath();
        c2.moveTo(cw / 2 - 32 + i * 32, ch / 2 + 6);
        c2.lineTo(cw / 2 - 32 + i * 32, ch / 2 + 26);
        c2.stroke();
      }
      c2.fillStyle = 'rgba(115,230,255,0.35)';
      c2.fillRect(cw / 2 - 74, ch / 2 + 62, 148, 6);
    });
    weatherCell(cx, cw, ch, 2106, 1.0);
  });

  // 6 — oil stain
  drawCell(ctx, S, cols, rows, 2, 1, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      const rng = makeRNG(2107);
      c2.fillStyle = 'rgba(24,18,12,0.62)';
      c2.beginPath();
      c2.ellipse(cw / 2, ch / 2, 92, 62, 0.2, 0, TAU);
      c2.fill();
      for (let i = 0; i < 9; i++) {
        c2.beginPath();
        c2.ellipse(cw / 2 + (rng() - 0.5) * 150, ch / 2 + (rng() - 0.5) * 100, 8 + rng() * 32, 5 + rng() * 18, rng() * TAU, 0, TAU);
        c2.fill();
      }
      c2.fillStyle = 'rgba(70,52,30,0.22)';
      c2.beginPath();
      c2.ellipse(cw / 2 + 20, ch / 2 - 6, 34, 22, 0.4, 0, TAU);
      c2.fill();
    });
    weatherCell(cx, cw, ch, 2108, 0.3);
  });

  // 7 — tire tracks
  drawCell(ctx, S, cols, rows, 3, 1, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.fillStyle = 'rgba(30,22,14,0.36)';
      for (const off of [-46, 46]) {
        c2.fillRect(cw / 2 + off - 24, 10, 48, ch - 20);
        // tread blocks
        c2.globalCompositeOperation = 'destination-out';
        c2.fillStyle = 'rgba(0,0,0,0.35)';
        for (let y = 10; y < ch - 20; y += 26) c2.fillRect(cw / 2 + off - 26, y, 52, 11);
        c2.globalCompositeOperation = 'source-over';
        c2.fillStyle = 'rgba(30,22,14,0.36)';
      }
    });
    weatherCell(cx, cw, ch, 2109, 0.6);
  });

  // 8 — paint splatter
  drawCell(ctx, S, cols, rows, 0, 2, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      const rng = makeRNG(2110);
      c2.fillStyle = 'rgba(232,220,192,0.85)';
      for (let i = 0; i < 34; i++) {
        const a = rng() * TAU;
        const r = rng() * 92;
        c2.beginPath();
        c2.ellipse(cw / 2 + Math.cos(a) * r, ch / 2 + Math.sin(a) * r, 1.5 + rng() * 13, 1 + rng() * 9, rng() * TAU, 0, TAU);
        c2.fill();
      }
    });
    weatherCell(cx, cw, ch, 2111, 0.8);
  });

  // 9 — "07" stencil
  drawCell(ctx, S, cols, rows, 1, 2, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.fillStyle = '#ece0c0';
      c2.font = `900 150px ${FONT_DISPLAY}`;
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.fillText('07', cw / 2, ch / 2 - 10);
      c2.fillStyle = 'rgba(236,224,192,0.8)';
      c2.fillRect(cw * 0.24, ch * 0.72, cw * 0.52, 8);
      c2.font = `700 26px ${FONT_MONO}`;
      c2.fillText('SECTOR', cw / 2, ch * 0.84);
    });
    weatherCell(cx, cw, ch, 2112, 1.1);
  });

  // 10 — X cross
  drawCell(ctx, S, cols, rows, 2, 2, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.strokeStyle = '#ece0c0';
      c2.lineWidth = 20;
      c2.lineCap = 'round';
      c2.beginPath();
      c2.moveTo(52, 52);
      c2.lineTo(cw - 52, ch - 52);
      c2.moveTo(cw - 52, 52);
      c2.lineTo(52, ch - 52);
      c2.stroke();
    });
    weatherCell(cx, cw, ch, 2113, 1.0);
  });

  // 11 — grime patch
  drawCell(ctx, S, cols, rows, 3, 2, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      const rng = makeRNG(2114);
      for (let i = 0; i < 40; i++) {
        const x = cw / 2 + (rng() - 0.5) * 170;
        const y = ch / 2 + (rng() - 0.5) * 170;
        const r = 10 + rng() * 70;
        const g = c2.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(26,18,10,${0.05 + rng() * 0.14})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c2.fillStyle = g;
        c2.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
  });

  // 12 — bullet pock cluster (pre-existing battle damage)
  drawCell(ctx, S, cols, rows, 0, 3, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      const rng = makeRNG(2115);
      for (let i = 0; i < 16; i++) {
        const x = 30 + rng() * (cw - 60);
        const y = 30 + rng() * (ch - 60);
        const r = 2 + rng() * 4.5;
        c2.fillStyle = 'rgba(24,18,12,0.85)';
        c2.beginPath();
        c2.arc(x, y, r, 0, TAU);
        c2.fill();
        c2.strokeStyle = 'rgba(226,216,196,0.5)';
        c2.lineWidth = 1.4;
        c2.beginPath();
        c2.arc(x, y, r + 1.4, 0, TAU);
        c2.stroke();
        c2.fillStyle = 'rgba(226,216,196,0.16)';
        c2.beginPath();
        c2.arc(x + r * 1.6, y + r * 1.4, r * 0.8, 0, TAU);
        c2.fill();
      }
    });
  });

  // 13 — warning triangle
  drawCell(ctx, S, cols, rows, 1, 3, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.fillStyle = 'rgba(216,178,60,0.9)';
      c2.beginPath();
      c2.moveTo(cw / 2, 30);
      c2.lineTo(cw - 20, ch - 34);
      c2.lineTo(20, ch - 34);
      c2.closePath();
      c2.fill();
      c2.strokeStyle = 'rgba(42,33,24,0.9)';
      c2.lineWidth = 9;
      c2.stroke();
      c2.fillStyle = '#2a2118';
      c2.font = `900 110px ${FONT_DISPLAY}`;
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.fillText('!', cw / 2, ch / 2 + 24);
    });
    weatherCell(cx, cw, ch, 2116, 1.0);
  });

  // 14 — footprints
  drawCell(ctx, S, cols, rows, 2, 3, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.fillStyle = 'rgba(40,30,18,0.30)';
      for (let i = 0; i < 8; i++) {
        const y = 24 + i * 28;
        const x = cw / 2 + (i % 2 === 0 ? -22 : 22);
        c2.save();
        c2.translate(x, y);
        c2.rotate((i % 2 === 0 ? 1 : -1) * 0.08);
        c2.beginPath();
        c2.ellipse(0, 0, 13, 20, 0, 0, TAU);
        c2.fill();
        c2.beginPath();
        c2.ellipse(0, 24, 8, 8, 0, 0, TAU);
        c2.fill();
        c2.restore();
      }
    });
    weatherCell(cx, cw, ch, 2117, 1.0);
  });

  // 15 — direction chevrons (double)
  drawCell(ctx, S, cols, rows, 3, 3, (cx, cw, ch) => {
    paint(cx, cw, ch, (c2) => {
      c2.strokeStyle = '#ece0c0';
      c2.lineWidth = 22;
      c2.lineCap = 'round';
      for (const oy of [-52, 34]) {
        c2.beginPath();
        c2.moveTo(52, ch / 2 + oy + 56);
        c2.lineTo(cw / 2, ch / 2 + oy - 26);
        c2.lineTo(cw - 52, ch / 2 + oy + 56);
        c2.stroke();
      }
    });
    weatherCell(cx, cw, ch, 2118, 1.0);
  });

  const texture = textureFromCanvas(c, { aniso });
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  reg(texture);
  const cells = {};
  const names = [
    'siteA', 'siteB', 'arrow', 'hazard',
    'tag', 'skull', 'oil', 'tracks',
    'splat', 'num07', 'cross', 'grime',
    'chips', 'warn', 'footprints', 'chevrons',
  ];
  names.forEach((name, i) => {
    cells[name] = atlasCell(S, cols, rows, i % cols, Math.floor(i / cols));
  });
  return { texture, cells };
}

// ---------------------------------------------------------------------------
// small utility maps: rubber, palm frond
// ---------------------------------------------------------------------------

function makeRubber(aniso, reg) {
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

function makeFrond(aniso, reg) {
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

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Build the full procedural texture library.
 * @param {THREE.WebGLRenderer} renderer used only to query max anisotropy
 * @param {{ quality?: 'medium'|'high'|'ultra', onProgress?: (p:number,label:string)=>void }} [options]
 */
export async function createTextureLibrary(renderer, { quality = 'high', onProgress } = {}) {
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 8;
  const aniso = Math.max(4, Math.min(maxAniso, quality === 'ultra' ? 16 : 8));

  const owned = [];
  const reg = (tex) => {
    if (tex) owned.push(tex);
    return tex;
  };
  const lib = { anisotropy: aniso, quality };
  lib.dispose = () => {
    for (const tex of owned) {
      try {
        tex.dispose();
      } catch (err) {
        /* ignore */
      }
    }
    owned.length = 0;
    _noiseCache.clear();
  };

  const stages = [
    ['Sifting sand & wind ripples', () => { lib.sand = makeSand(aniso, reg); }],
    ['Cracking adobe bricks', () => { lib.adobe = makeAdobe(aniso, reg); }],
    ['Cutting sandstone blocks', () => { lib.stone = makeStone(aniso, reg); }],
    ['Laying stone paving', () => { lib.paving = makePaving(aniso, reg); }],
    ['Milling timber', () => { lib.wood = makeWood(aniso, reg); }],
    ['Stencilling crates', () => { lib.crate = makeCrate(aniso, reg); }],
    ['Scratching painted steel', () => { lib.metal = makeMetal(aniso, reg); }],
    ['Weathering rusted drums', () => { lib.rust = makeRust(aniso, reg); }],
    ['Corrugating roof sheets', () => { lib.sheet = makeSheetMetal(aniso, reg); }],
    ['Sewing sandbags', () => { lib.sandbag = makeSandbag(aniso, reg); }],
    ['Weaving cloth & awnings', () => { lib.cloth = makeCloth(aniso, reg); }],
    ['Painting site banners', () => { lib.banners = makeBanners(aniso, reg); }],
    ['Printing posters & notices', () => { lib.posterAtlas = makePosterAtlas(aniso, reg); }],
    ['Spraying decals & stencils', () => { lib.decalAtlas = makeDecalAtlas(aniso, reg); }],
    ['Casting rubber & palms', () => {
      lib.rubber = makeRubber(aniso, reg);
      lib.frond = makeFrond(aniso, reg);
    }],
  ];

  for (let i = 0; i < stages.length; i++) {
    onProgress?.(i / stages.length, stages[i][0]);
    stages[i][1]();
    // yield so the loading screen can repaint between heavy stages
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  onProgress?.(1, 'Materials ready');
  return lib;
}

