/**
 * SANDSTRIKE // jungle ground cover texture set  (lib.jungleGrass)
 *
 * Used by materials: jungleGrass (island undergrowth / forest floor)
 *
 * Wet rainforest ground cover, drawn as a real tiled patch of vegetation instead
 * of a green noise field:
 *   - thousands of fine curved grass blades in tufts, with per-cluster tone drift
 *     (so the tile does not read as a repeating grid)
 *   - moss patches (yellow-green) over damp soil, wet dark seams / mud gaps
 *   - small broadleaf weed plants and a few twigs / brown fragments
 *   - morning dew: tiny pale beads on the blades + glossier roughness spots
 *
 * 1024 px = 4 m of ground (ISLAND_ASSETS.md 3.1); palette from 1.2 of the brief
 * (#3f6b32 / #5f8c3e foliage, #7f8f3c moss, #2f2619 / #241d14 mud).
 *
 * Texture set contract:
 *   map            albedo        sRGB
 *   normalMap      tangent space  linear (Sobel from a 1024px height canvas)
 *   roughnessMap   linear
 *
 * Everything here is drawn with Canvas2D at load time.
 */
import { clamp, makeRNG } from '../utils.js';
import {
  TAU, ctxOf, el, grayCanvas, hash2, normalFromHeightCanvas, overlayGrain, overlayNoise,
  textureFromCanvas, tileFbm, wrapDraw,
} from './core.js';

const S = 1024;
const BASE = 512;
const HS = 1024;
const ROUGH = 512;
const STRENGTH = 2.8;

const BLADE_COUNT = 2400;
const TUFT_COUNT = 52;
const GROUND_LEAF_COUNT = 46;
const MOSS_BLOB_COUNT = 110;
const GRASS_SEGMENTS = 6;

/** grass/cluster palette: deep saturated green -> moss yellow-green (sRGB) */
const MOSS = [127, 143, 60];
const SOIL_DARK = [30, 24, 15];
const SOIL_MID = [68, 53, 33];

/** Build every blade once so albedo / height / roughness passes stay in register. */
function buildBlades(rng) {
  const blades = [];
  for (let i = 0; i < BLADE_COUNT; i++) {
    // clumped distribution: each cluster has its own tone + longer blades
    const cx = rng() * S;
    const cy = rng() * S;
    const scatter = 10 + rng() * 42;
    const x = cx + (rng() - 0.5) * scatter * 2;
    const y = cy + (rng() - 0.5) * scatter * 2;
    const len = 13 + rng() * 42;
    const lean = (rng() - 0.5) * 1.1;
    const curve = (rng() - 0.5) * 0.5;
    // low-frequency cluster tone (breaks up tile repetition)
    const cluster = tileFbm((x / S + 1) % 1, (y / S + 1) % 1, 2, 55);
    const yellow = clamp(cluster * 0.55 + rng() * 0.35, 0, 1);
    const hue = 78 + yellow * 26 + rng() * 8;
    const sat = 28 + rng() * 26;
    const light = 17 + rng() * 18 + cluster * 7;
    blades.push({
      x,
      y,
      len,
      lean,
      curve,
      w: 1.1 + rng() * 1.7,
      hue,
      sat,
      light,
      fresh: rng() > 0.78,
      dry: rng() > 0.9,
      dew: rng() > 0.75,
      rng: rng(),
    });
  }
  return blades;
}

/** Sample a blade's spine (base -> tip) and half width along it. */
function bladeSpine(b) {
  const pts = [];
  for (let i = 0; i <= GRASS_SEGMENTS; i++) {
    const s = i / GRASS_SEGMENTS;
    const sx = b.x + b.lean * b.len * s + b.curve * b.len * 0.5 * Math.sin(Math.PI * s);
    const sy = b.y - b.len * s;
    const hw = Math.max(0.18, b.w * (1 - Math.pow(s, 1.7) * 0.92));
    pts.push([sx, sy, hw]);
  }
  return pts;
}

/** Filled tapered blade polygon at (possibly wrapped) coordinates. */
function bladePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0] - pts[0][2], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] - pts[i][2], pts[i][1]);
  for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0] + pts[i][2], pts[i][1]);
  ctx.closePath();
}

/** Small broadleaf weed: 3-6 pointed leaves around a short stem. */
function buildTufts(rng) {
  const tufts = [];
  for (let i = 0; i < TUFT_COUNT; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const leaves = [];
    const count = 4 + Math.floor(rng() * 4);
    for (let j = 0; j < count; j++) {
      const a = (j / count) * TAU + rng() * 0.9;
      leaves.push({
        a,
        len: 11 + rng() * 18,
        wid: 4 + rng() * 5.5,
        tone: rng(),
      });
    }
    tufts.push({ x, y, leaves });
  }
  return tufts;
}

/** A few fallen brown leaves lying on the cover (colour break for the floor). */
function buildGroundLeaves(rng) {
  const leaves = [];
  for (let i = 0; i < GROUND_LEAF_COUNT; i++) {
    leaves.push({
      x: rng() * S,
      y: rng() * S,
      len: 10 + rng() * 20,
      wid: 0.34 + rng() * 0.2,
      rot: rng() * TAU,
      tone: rng(),
      green: rng() > 0.78,
    });
  }
  return leaves;
}

/** Pointed leaf polygon (used for the broadleaf weeds). */
function leafPath(ctx, x, y, angle, len, wid) {
  const tx = x + Math.cos(angle) * len;
  const ty = y + Math.sin(angle) * len;
  const nx = Math.cos(angle + Math.PI / 2) * wid;
  const ny = Math.sin(angle + Math.PI / 2) * wid;
  const mx = x + Math.cos(angle) * len * 0.45;
  const my = y + Math.sin(angle) * len * 0.45;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx + nx, my + ny, tx, ty);
  ctx.quadraticCurveTo(mx - nx, my - ny, x, y);
  ctx.closePath();
}

export function makeJungleGrass(aniso, reg) {
  const rng = makeRNG(60617);
  const blades = buildBlades(rng);
  const tufts = buildTufts(rng);
  const groundLeaves = buildGroundLeaves(rng);

  // ---- albedo -------------------------------------------------------------
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  ctx.imageSmoothingEnabled = true;

  // wet humus + moss base field (low res, upscaled, then covered by blades)
  const base = el(BASE, BASE);
  {
    const bctx = ctxOf(base);
    const img = bctx.createImageData(BASE, BASE);
    const d = img.data;
    let i = 0;
    for (let y = 0; y < BASE; y++) {
      const v = y / BASE;
      for (let x = 0; x < BASE; x++) {
        const u = x / BASE;
        const cover = tileFbm(u, v, 4, 7);       // vegetation density
        const mossM = tileFbm(u, v, 3, 23);      // moss vs bare mould
        const wet = tileFbm(u, v, 3, 91);        // damp darkening
        const t = clamp(cover * 1.15, 0, 1);
        let r = SOIL_DARK[0] + (SOIL_MID[0] - SOIL_DARK[0]) * t;
        let g = SOIL_DARK[1] + (SOIL_MID[1] - SOIL_DARK[1]) * t;
        let b = SOIL_DARK[2] + (SOIL_MID[2] - SOIL_DARK[2]) * t;
        // moss carpet in the wetter pockets
        const mo = clamp((mossM - 0.42) * 2.6, 0, 1) * 0.75;
        r = r + (MOSS[0] * 0.72 - r) * mo;
        g = g + (MOSS[1] * 0.78 - g) * mo;
        b = b + (MOSS[2] * 0.6 - b) * mo;
        // damp darkening
        const damp = clamp((0.55 - wet) * 1.4, 0, 1);
        r *= 1 - damp * 0.30;
        g *= 1 - damp * 0.24;
        b *= 1 - damp * 0.24;
        const grain = hash2(x, y, 4711) - 0.5;
        d[i++] = clamp(r + grain * 12, 0, 255);
        d[i++] = clamp(g + grain * 12, 0, 255);
        d[i++] = clamp(b + grain * 9, 0, 255);
        d[i++] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
  }
  ctx.drawImage(base, 0, 0, S, S);

  // moss blobs / damp seams on top of the base
  for (let i = 0; i < MOSS_BLOB_COUNT; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 14 + rng() * 64;
    const a = 0.16 + rng() * 0.20;
    wrapDraw(ctx, S, x, y, r + 4, (c) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${MOSS[0]},${MOSS[1]},${MOSS[2]},${a})`);
      g.addColorStop(0.6, `rgba(${MOSS[0] - 20},${MOSS[1] - 18},${MOSS[2] - 26},${a * 0.4})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  // dark mud gaps / seams showing through the cover
  for (let i = 0; i < 26; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 60 + rng() * 190;
    const a = rng() * TAU;
    const bend = (rng() - 0.5) * 70;
    const lw = 4 + rng() * 14;
    const alpha = 0.16 + rng() * 0.18;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    wrapDraw(ctx, S, x, y, len, (c) => {
      c.strokeStyle = `rgba(20,15,9,${alpha})`;
      c.lineWidth = lw;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo((x + ex) / 2 + bend, (y + ey) / 2 - bend * 0.6, ex, ey);
      c.stroke();
    });
  }

  // grass blades
  for (const b of blades) {
    const pts = bladeSpine(b);
    const pad = b.len * 0.8 + b.w + 6;
    const cx = b.x + (pts[pts.length - 1][0] - b.x) * 0.5;
    const cy = b.y - b.len * 0.5;
    wrapDraw(ctx, S, cx, cy, pad, (c) => {
      c.save();
      bladePath(c, pts);
      const g = c.createLinearGradient(b.x, b.y, pts[pts.length - 1][0], pts[pts.length - 1][1]);
      if (b.dry) {
        g.addColorStop(0, `hsl(${b.hue - 16}, ${b.sat * 0.6}%, ${b.light - 3}%)`);
        g.addColorStop(1, `hsl(52, ${b.sat * 0.8}%, ${b.light + 14}%)`);
      } else {
        g.addColorStop(0, `hsl(${b.hue - 8}, ${b.sat}%, ${b.light - 5}%)`);
        g.addColorStop(0.55, `hsl(${b.hue}, ${b.sat + 6}%, ${b.light + 2}%)`);
        g.addColorStop(1, `hsl(${b.hue + 10}, ${b.sat + (b.fresh ? 18 : 10)}%, ${b.light + (b.fresh ? 20 : 12)}%)`);
      }
      c.fillStyle = g;
      c.fill();
      // tiny dew bead on the lit side of the blade
      if (b.dew) {
        const tip = pts[pts.length - 2];
        c.fillStyle = 'rgba(228,246,208,0.55)';
        c.beginPath();
        c.arc(tip[0] - tip[2] * 0.2, tip[1] + 1.2, 0.7 + b.rng * 0.8, 0, TAU);
        c.fill();
      }
      c.restore();
    });
  }

  // broadleaf weeds
  for (const t of tufts) {
    wrapDraw(ctx, S, t.x, t.y, 26, (c) => {
      c.save();
      // stem
      c.strokeStyle = 'rgba(58,84,36,0.85)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(t.x, t.y);
      c.lineTo(t.x + 1.5, t.y - 6);
      c.stroke();
      for (const l of t.leaves) {
        leafPath(c, t.x, t.y - 5, l.a, l.len, l.wid);
        const g = c.createLinearGradient(t.x, t.y, t.x + Math.cos(l.a) * l.len, t.y + Math.sin(l.a) * l.len);
        const li = 24 + l.tone * 12;
        g.addColorStop(0, `hsl(96, 34%, ${li - 4}%)`);
        g.addColorStop(1, `hsl(${88 + l.tone * 14}, 46%, ${li + 12}%)`);
        c.fillStyle = g;
        c.fill();
        c.strokeStyle = 'rgba(26,44,18,0.5)';
        c.lineWidth = 0.8;
        c.stroke();
        // mid vein
        c.strokeStyle = 'rgba(150,190,100,0.35)';
        c.lineWidth = 0.7;
        c.beginPath();
        c.moveTo(t.x, t.y - 5);
        c.quadraticCurveTo(
          t.x + Math.cos(l.a) * l.len * 0.45,
          t.y - 5 + Math.sin(l.a) * l.len * 0.45,
          t.x + Math.cos(l.a) * l.len * 0.9,
          t.y - 5 + Math.sin(l.a) * l.len * 0.9
        );
        c.stroke();
      }
      c.restore();
    });
  }

  // fallen brown / olive leaves on the cover
  for (const l of groundLeaves) {
    const cos = Math.cos(l.rot);
    const sin = Math.sin(l.rot);
    const half = l.len * 0.5;
    const bx = l.x - cos * half;
    const by = l.y - sin * half;
    const wid = l.len * l.wid;
    wrapDraw(ctx, S, l.x, l.y, l.len + 6, (c) => {
      c.save();
      // contact shadow
      c.save();
      c.translate(1.4, 2.0);
      leafPath(c, bx, by, l.rot, l.len, wid);
      c.fillStyle = 'rgba(10,7,3,0.30)';
      c.fill();
      c.restore();
      leafPath(c, bx, by, l.rot, l.len, wid);
      if (l.green) {
        c.fillStyle = `hsl(${84 + l.tone * 18}, ${32 + l.tone * 14}%, ${22 + l.tone * 8}%)`;
      } else {
        c.fillStyle = `hsl(${28 + l.tone * 18}, ${26 + l.tone * 16}%, ${17 + l.tone * 13}%)`;
      }
      c.fill();
      c.strokeStyle = 'rgba(18,14,6,0.4)';
      c.lineWidth = 0.8;
      c.stroke();
      // mid vein
      c.strokeStyle = l.green ? 'rgba(170,204,120,0.28)' : 'rgba(120,96,52,0.45)';
      c.lineWidth = 0.7;
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(bx + cos * l.len, by + sin * l.len);
      c.stroke();
      c.restore();
    });
  }

  // twigs / dead fragments
  for (let i = 0; i < 30; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 16 + rng() * 46;
    const a = rng() * TAU;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    const tw = 0.9 + rng() * 1.2;
    const col = `rgba(${70 + rng() * 30},${56 + rng() * 24},${36 + rng() * 18},0.55)`;
    wrapDraw(ctx, S, x, y, len + 4, (c) => {
      c.strokeStyle = col;
      c.lineWidth = tw;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo((x + ex) / 2, (y + ey) / 2 + 5, ex, ey);
      c.stroke();
    });
  }

  // dew beads across the cover (the main read at grazing light)
  for (let i = 0; i < 420; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 0.6 + rng() * 1.4;
    const a = 0.25 + rng() * 0.45;
    wrapDraw(ctx, S, x, y, 4, (c) => {
      c.fillStyle = `rgba(232,248,214,${a * 0.35})`;
      c.beginPath();
      c.arc(x + 0.4, y + 0.6, r * 1.9, 0, TAU);
      c.fill();
      c.fillStyle = `rgba(245,255,236,${a})`;
      c.beginPath();
      c.arc(x - r * 0.2, y - r * 0.3, r * 0.62, 0, TAU);
      c.fill();
    });
  }

  // macro moisture variation so the 4 m tile does not read flat
  for (let i = 0; i < 22; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 90 + rng() * 300;
    const dark = rng() > 0.42;
    wrapDraw(ctx, S, x, y, r + 6, (c) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, dark ? 'rgba(10,20,8,0.14)' : 'rgba(180,214,128,0.10)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  overlayNoise(ctx, S, S, { tile: 256, seed: 171, alpha: 0.13, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.10, seed: 172 });

  // ---- height -------------------------------------------------------------
  const hgt = el(HS, HS);
  const hctx = ctxOf(hgt);
  hctx.imageSmoothingEnabled = true;
  const baseHeight = grayCanvas(BASE, (x, y, u, v) => {
    const cover = tileFbm(u, v, 4, 7);
    const mossM = tileFbm(u, v, 3, 23);
    const lumps = tileFbm(u, v, 2, 61);
    return clamp(0.30 + cover * 0.10 + mossM * 0.12 + lumps * 0.10, 0, 1);
  });
  hctx.drawImage(baseHeight, 0, 0, HS, HS);
  for (const b of blades) {
    const pts = bladeSpine(b);
    const pad = b.len * 0.8 + b.w + 6;
    const cx = b.x + (pts[pts.length - 1][0] - b.x) * 0.5;
    const cy = b.y - b.len * 0.5;
    wrapDraw(hctx, HS, cx, cy, pad, (c) => {
      c.save();
      bladePath(c, pts);
      c.fillStyle = b.dry ? 'rgb(186,186,186)' : 'rgb(228,228,228)';
      c.fill();
      c.restore();
    });
  }
  for (const t of tufts) {
    wrapDraw(hctx, HS, t.x, t.y, 26, (c) => {
      c.save();
      for (const l of t.leaves) {
        leafPath(c, t.x, t.y - 5, l.a, l.len, l.wid);
        c.fillStyle = 'rgb(206,206,206)';
        c.fill();
      }
      c.restore();
    });
  }
  for (const l of groundLeaves) {
    const bx = l.x - Math.cos(l.rot) * l.len * 0.5;
    const by = l.y - Math.sin(l.rot) * l.len * 0.5;
    wrapDraw(hctx, HS, l.x, l.y, l.len + 6, (c) => {
      c.save();
      leafPath(c, bx, by, l.rot, l.len, l.len * l.wid);
      c.fillStyle = 'rgb(192,192,192)';
      c.fill();
      c.restore();
    });
  }
  overlayNoise(hctx, HS, HS, { tile: 256, seed: 173, alpha: 0.12, scale: 1, mode: 'overlay' });
  overlayGrain(hctx, HS, HS, { alpha: 0.08, seed: 174 });

  // ---- roughness ----------------------------------------------------------
  const rough = el(ROUGH, ROUGH);
  const rctx = ctxOf(rough);
  rctx.imageSmoothingEnabled = true;
  const k = ROUGH / S;
  const baseRough = grayCanvas(BASE, (x, y, u, v) => {
    const wet = tileFbm(u, v, 3, 91);
    const mossM = tileFbm(u, v, 3, 23);
    // damp soil is still matte but the moss film is a little glossier
    return clamp(0.94 - wet * 0.14 - mossM * 0.10, 0, 1);
  });
  rctx.drawImage(baseRough, 0, 0, ROUGH, ROUGH);
  // wet foliage is noticeably glossier: stamp the blades darker (smoother)
  for (const b of blades) {
    const pts = bladeSpine(b).map(([x, y, hw]) => [x * k, y * k, Math.max(0.3, hw * k)]);
    const pad = (b.len * 0.8 + b.w + 6) * k;
    wrapDraw(rctx, ROUGH, b.x * k, (b.y - b.len * 0.5) * k, pad, (c) => {
      c.save();
      bladePath(c, pts);
      c.fillStyle = 'rgb(122,122,122)';
      c.fill();
      c.restore();
    });
  }
  for (const t of tufts) {
    wrapDraw(rctx, ROUGH, t.x * k, t.y * k, 14, (c) => {
      c.save();
      for (const l of t.leaves) {
        leafPath(c, t.x * k, (t.y - 5) * k, l.a, l.len * k, l.wid * k);
        c.fillStyle = 'rgb(116,116,116)';
        c.fill();
      }
      c.restore();
    });
  }
  // dew beads: tight glossy spots
  for (let i = 0; i < 260; i++) {
    const x = rng() * S * k;
    const y = rng() * S * k;
    const r = (0.7 + rng() * 1.5) * k * 1.6;
    wrapDraw(rctx, ROUGH, x, y, 6, (c) => {
      c.fillStyle = 'rgb(48,48,48)';
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    });
  }
  overlayNoise(rctx, ROUGH, ROUGH, { tile: 256, seed: 175, alpha: 0.10, scale: 1, mode: 'overlay' });

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(hgt, STRENGTH, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
