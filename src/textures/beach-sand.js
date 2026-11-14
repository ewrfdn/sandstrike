/**
 * SANDSTRIKE // beach sand texture set  (lib.beachSand)
 *
 * Used by materials: beachSand (island shoreline / shallow beach strips)
 *
 * Coral-white to pale-gold tropical beach sand, NOT the desert dune set:
 *   - much finer grain (per-pixel speckle + only faint water-lain ripples)
 *   - damp / wet tonal bands driven by a low-frequency moisture field, with the
 *     wet patches glossier in the roughness map
 *   - crushed shell hash: tiny arced shell rims, chips and a few small scallops
 *   - a handful of small rounded pebbles and coral bits
 *
 * 1024 px = 3 m of shoreline (ISLAND_ASSETS.md 3.1).
 *
 * Texture set contract:
 *   map            albedo        sRGB
 *   normalMap      tangent space  linear (Sobel from a 512px height canvas)
 *   roughnessMap   linear
 *
 * Everything here is drawn with Canvas2D at load time.
 */
import { clamp, lerp, makeRNG } from '../utils.js';
import {
  TAU, ctxOf, el, grayCanvas, hash2, normalFromHeightCanvas, overlayGrain, overlayNoise,
  textureFromCanvas, tileFbm, wrapDraw,
} from './core.js';

const S = 1024;         // albedo size
const BASE = 512;       // low-frequency field resolution (upscaled, then detailed)
const HS = 512;         // height / normal source size
const ROUGH = 512;      // roughness map size
const STRENGTH = 1.8;

const PEBBLE_COUNT = 95;
const SHELL_COUNT = 300;
const BIG_SHELL_COUNT = 9;

/** coral-white -> pale gold -> damp sand -> wet sand ramps (sRGB) */
const DRY_HI = [247, 239, 219];
const DRY_LO = [201, 183, 147];
const DAMP_HI = [176, 160, 122];
const WET_LO = [114, 106, 80];

/** shared decoration layout so albedo / height / roughness stay in register */
function buildDetail(rng) {
  const pebbles = [];
  for (let i = 0; i < PEBBLE_COUNT; i++) {
    pebbles.push({
      x: rng() * S,
      y: rng() * S,
      r: 1.6 + rng() * 4.0,
      squash: 0.55 + rng() * 0.5,
      rot: rng() * TAU,
      tone: rng(),
      coral: rng() > 0.72,
    });
  }
  const shells = [];
  for (let i = 0; i < SHELL_COUNT; i++) {
    shells.push({
      x: rng() * S,
      y: rng() * S,
      r: 2.1 + rng() * 6.6,
      rot: rng() * TAU,
      kind: rng() < 0.5 ? 'arc' : rng() < 0.78 ? 'chip' : 'rim',
      pink: rng() > 0.6,
      tone: rng(),
    });
  }
  const big = [];
  for (let i = 0; i < BIG_SHELL_COUNT; i++) {
    big.push({
      x: 60 + rng() * (S - 120),
      y: 60 + rng() * (S - 120),
      r: 10 + rng() * 17,
      rot: rng() * TAU,
      tone: rng(),
    });
  }
  // a handful of larger, readable shell flakes
  const flakes = [];
  for (let i = 0; i < 26; i++) {
    flakes.push({
      x: 40 + rng() * (S - 80),
      y: 40 + rng() * (S - 80),
      r: 6 + rng() * 7,
      rot: rng() * TAU,
      pink: rng() > 0.55,
      tone: rng(),
    });
  }
  return { pebbles, shells, big, flakes };
  return { pebbles, shells, big };
}

/** Fine per-pixel sand field + moisture mask. Painted at BASE, upscaled to S. */
function drawBase() {
  const c = el(BASE, BASE);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(BASE, BASE);
  const d = img.data;
  let i = 0;
  for (let y = 0; y < BASE; y++) {
    const v = y / BASE;
    for (let x = 0; x < BASE; x++) {
      const u = x / BASE;
      const moisture = tileFbm(u, v, 3, 511);            // low freq damp patches
      const tone = tileFbm(u, v, 4, 133);                // general tonal drift
      const coral = tileFbm(u, v, 3, 907);               // coral/shelly patches
      const wet = clamp((moisture - 0.47) * 2.5, 0, 1);  // 0 dry .. 1 wet
      const t = clamp(0.38 + (tone - 0.5) * 0.8, 0, 1);
      // dry ramp
      let r = lerp(DRY_LO[0], DRY_HI[0], t);
      let g = lerp(DRY_LO[1], DRY_HI[1], t);
      let b = lerp(DRY_LO[2], DRY_HI[2], t);
      // damp ramp pulled darker + greyer
      const dm = clamp((1 - t) * 0.7, 0, 1) * 0.9 + wet * 0.1;
      const dr = lerp(DAMP_HI[0], WET_LO[0], dm);
      const dg = lerp(DAMP_HI[1], WET_LO[1], dm);
      const db = lerp(DAMP_HI[2], WET_LO[2], dm);
      const w = wet * 0.9;
      r = lerp(r, dr, w);
      g = lerp(g, dg, w);
      b = lerp(b, db, w);
      // pinkish coral patches, only where the sand is dry
      const pink = clamp((coral - 0.62) * 3.0, 0, 1) * (1 - wet) * 0.55;
      r = lerp(r, 228, pink);
      g = lerp(g, 203, pink);
      b = lerp(b, 179, pink);
      // very fine grain (much finer than the dune set)
      const grain = hash2(x, y, 1201) - 0.5;
      r += grain * 13;
      g += grain * 12;
      b += grain * 10;
      d[i++] = clamp(r, 0, 255);
      d[i++] = clamp(g, 0, 255);
      d[i++] = clamp(b, 0, 255);
      d[i++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Damp / wet bands + thin wet-film sheen lines, wrapped across the tile border. */
function drawMoistureBands(ctx, rng) {
  for (let i = 0; i < 14; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 90 + rng() * 260;
    const sx = 0.5 + rng() * 1.3;
    const wet = rng() > 0.35;
    const alpha = wet ? 0.19 + rng() * 0.13 : 0.08 + rng() * 0.07;
    wrapDraw(ctx, S, x, y, r * sx + 12, (c) => {
      c.save();
      c.translate(x, y);
      c.scale(sx, 1);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
      if (wet) {
        g.addColorStop(0, `rgba(74,72,54,${alpha})`);
        g.addColorStop(0.6, `rgba(80,78,58,${alpha * 0.45})`);
        g.addColorStop(1, 'rgba(80,78,58,0)');
      } else {
        g.addColorStop(0, `rgba(255,246,224,${alpha})`);
        g.addColorStop(1, 'rgba(255,246,224,0)');
      }
      c.fillStyle = g;
      c.fillRect(-r * 1.05, -r * 1.05, r * 2.1, r * 2.1);
      c.restore();
    });
  }
  for (let i = 0; i < 16; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 90 + rng() * 260;
    const a = (rng() - 0.5) * 1.1;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    const alpha = 0.05 + rng() * 0.06;
    const lw = 5 + rng() * 16;
    const bend = (rng() - 0.5) * 30;
    wrapDraw(ctx, S, x, y, len, (c) => {
      const g = c.createLinearGradient(x, y, ex, ey);
      g.addColorStop(0, 'rgba(88,78,58,0)');
      g.addColorStop(0.45, `rgba(88,78,58,${alpha})`);
      g.addColorStop(1, 'rgba(88,78,58,0)');
      c.strokeStyle = g;
      c.lineWidth = lw;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo((x + ex) / 2 + bend, (y + ey) / 2 + bend, ex, ey);
      c.stroke();
    });
  }
}

/** Crushed shell hash: arced rims, chips and a few small scallops. */
function drawShells(ctx, detail) {
  for (const s of detail.shells) {
    const rim = s.pink ? [248, 226, 213] : [250, 244, 226];
    const dark = s.pink ? [186, 150, 132] : [188, 172, 142];
    const shade = s.tone;
    wrapDraw(ctx, S, s.x, s.y, s.r + 6, (c) => {
      c.save();
      c.translate(s.x, s.y);
      c.rotate(s.rot);
      if (s.kind === 'arc') {
        // broken shell rim: pale arc with a dark underside
        c.lineCap = 'round';
        c.beginPath();
        c.arc(0, 0, s.r, 0.25 * Math.PI, 0.95 * Math.PI);
        c.lineWidth = 1.2 + s.r * 0.16;
        c.strokeStyle = `rgba(${dark[0]},${dark[1]},${dark[2]},${0.28 + shade * 0.22})`;
        c.stroke();
        c.beginPath();
        c.arc(-0.7, -0.8, s.r, 0.25 * Math.PI, 0.95 * Math.PI);
        c.lineWidth = 1.1 + s.r * 0.14;
        c.strokeStyle = `rgba(${rim[0]},${rim[1]},${rim[2]},${0.66 + shade * 0.28})`;
        c.stroke();
      } else if (s.kind === 'chip') {
        // flat pale flake
        c.beginPath();
        c.moveTo(-s.r, s.r * 0.2);
        c.lineTo(-s.r * 0.2 + s.r * 0.5, -s.r * (0.4 + shade * 0.4));
        c.lineTo(s.r, -s.r * 0.05);
        c.lineTo(s.r * 0.25, s.r * 0.5);
        c.closePath();
        c.fillStyle = `rgba(${rim[0]},${rim[1]},${rim[2]},${0.48 + shade * 0.3})`;
        c.fill();
        c.strokeStyle = `rgba(${dark[0]},${dark[1]},${dark[2]},0.32)`;
        c.lineWidth = 0.8;
        c.stroke();
      } else {
        // fine shell ridge
        c.beginPath();
        c.ellipse(0, 0, s.r * 0.9, s.r * 0.34, 0, 0, TAU);
        c.lineWidth = 0.9;
        c.strokeStyle = `rgba(${rim[0]},${rim[1]},${rim[2]},${0.42 + shade * 0.25})`;
        c.stroke();
        c.strokeStyle = `rgba(${dark[0]},${dark[1]},${dark[2]},0.2)`;
        c.lineWidth = 1.2;
        c.beginPath();
        c.ellipse(0.4, 0.8, s.r * 0.9, s.r * 0.34, 0, 0, TAU);
        c.stroke();
      }
      c.restore();
    });
  }
  // a few readable scallop shells (they still stay small: 3 cm-ish)
  for (const s of detail.big) {
    const pale = s.tone > 0.5;
    wrapDraw(ctx, S, s.x, s.y, s.r + 8, (c) => {
      c.save();
      c.translate(s.x, s.y);
      c.rotate(s.rot);
      c.beginPath();
      c.moveTo(0, s.r * 0.9);
      c.quadraticCurveTo(-s.r * 1.05, s.r * 0.2, -s.r * 0.95, -s.r * 0.35);
      c.quadraticCurveTo(0, -s.r * 0.95, s.r * 0.95, -s.r * 0.35);
      c.quadraticCurveTo(s.r * 1.05, s.r * 0.2, 0, s.r * 0.9);
      c.closePath();
      const g = c.createLinearGradient(0, -s.r, 0, s.r);
      g.addColorStop(0, pale ? 'rgba(250,242,225,0.92)' : 'rgba(246,222,208,0.9)');
      g.addColorStop(1, pale ? 'rgba(214,196,164,0.9)' : 'rgba(222,184,168,0.9)');
      c.fillStyle = g;
      c.fill();
      c.strokeStyle = 'rgba(150,126,104,0.45)';
      c.lineWidth = 0.9;
      c.stroke();
      // radial ribs
      c.strokeStyle = 'rgba(164,140,116,0.28)';
      c.lineWidth = 0.7;
      for (let k = 0; k < 6; k++) {
        const a = -0.44 * Math.PI + (k / 5) * 0.88 * Math.PI;
        c.beginPath();
        c.moveTo(0, s.r * 0.8);
        c.lineTo(Math.cos(a) * s.r * 0.86, Math.sin(a) * s.r * 0.82 - s.r * 0.06);
        c.stroke();
      }
      c.restore();
    });
  }
  // a handful of larger, readable shell flakes
  for (const s of detail.flakes) {
    const rim = s.pink ? [250, 224, 210] : [252, 247, 232];
    const dark = s.pink ? [176, 140, 122] : [180, 164, 136];
    wrapDraw(ctx, S, s.x, s.y, s.r + 5, (c) => {
      c.save();
      c.translate(s.x, s.y);
      c.rotate(s.rot);
      c.fillStyle = 'rgba(24,16,8,0.20)';
      c.beginPath();
      c.ellipse(1, 1.8, s.r, s.r * 0.62, 0, 0, TAU);
      c.fill();
      c.beginPath();
      c.moveTo(-s.r, s.r * 0.15);
      c.quadraticCurveTo(-s.r * 0.35, -s.r * (0.55 + s.tone * 0.3), s.r * 0.9, -s.r * 0.1);
      c.quadraticCurveTo(s.r * 0.45, s.r * 0.35, -s.r * 0.2, s.r * 0.5);
      c.closePath();
      c.fillStyle = `rgba(${rim[0]},${rim[1]},${rim[2]},0.9)`;
      c.fill();
      c.strokeStyle = `rgba(${dark[0]},${dark[1]},${dark[2]},0.45)`;
      c.lineWidth = 0.9;
      c.stroke();
      c.strokeStyle = `rgba(${rim[0] - 26},${rim[1] - 30},${rim[2] - 34},0.32)`;
      c.lineWidth = 0.7;
      c.beginPath();
      c.moveTo(-s.r * 0.7, s.r * 0.1);
      c.quadraticCurveTo(0, -s.r * 0.22, s.r * 0.7, -s.r * 0.06);
      c.stroke();
      c.restore();
    });
  }
}
/** Small rounded pebbles / coral bits with a lit top and a shadow. */
function drawPebbles(ctx, detail) {
  for (const p of detail.pebbles) {
    wrapDraw(ctx, S, p.x, p.y, p.r + 4, (c) => {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      const rx = p.r;
      const ry = p.r * p.squash;
      if (p.coral) {
        c.fillStyle = 'rgba(20,14,8,0.28)';
        c.beginPath();
        c.ellipse(0.5, 0.7, rx, ry, 0, 0, TAU);
        c.fill();
        c.fillStyle = p.tone > 0.5 ? '#d9c3a8' : '#cbb493';
        c.beginPath();
        c.ellipse(0, 0, rx, ry, 0, 0, TAU);
        c.fill();
        c.fillStyle = 'rgba(255,246,230,0.42)';
        c.beginPath();
        c.ellipse(-rx * 0.25, -ry * 0.3, rx * 0.45, ry * 0.4, 0, 0, TAU);
        c.fill();
      } else {
        const v = 78 + p.tone * 84;
        c.fillStyle = 'rgba(20,14,8,0.30)';
        c.beginPath();
        c.ellipse(0.6, 0.8, rx, ry, 0, 0, TAU);
        c.fill();
        c.fillStyle = `rgb(${v + 18},${v + 6},${v - 14})`;
        c.beginPath();
        c.ellipse(0, 0, rx, ry, 0, 0, TAU);
        c.fill();
        c.fillStyle = `rgba(250,242,224,${0.30 + p.tone * 0.24})`;
        c.beginPath();
        c.ellipse(-rx * 0.28, -ry * 0.32, rx * 0.42, ry * 0.38, 0, 0, TAU);
        c.fill();
      }
      c.restore();
    });
  }
}

/** Faint water-lain ripples: much finer and softer than the desert dune set. */
function rippleAt(u, v) {
  const warp = Math.sin(u * TAU * 4 + Math.sin(v * TAU * 3) * 0.5) * 0.12;
  return Math.sin((v * 42 + warp * 2.6 + u * 3) * TAU);
}

export function makeBeachSand(aniso, reg) {
  const rng = makeRNG(20250611);
  const detail = buildDetail(rng);

  // ---- albedo -------------------------------------------------------------
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(drawBase(), 0, 0, S, S);

  // faint ripples read in the albedo too (crest slightly paler) + crisp fine grain
  {
    const rimg = ctx.getImageData(0, 0, S, S);
    const d = rimg.data;
    let i = 0;
    for (let y = 0; y < S; y++) {
      const v = y / S;
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const k2 = rippleAt(u, v) * 1.5;
        const g2 = (hash2(x, y, 7331) - 0.5) * 17 + (hash2(x, y, 9173) - 0.5) * 8;
        d[i] = clamp(d[i] + k2 + g2, 0, 255);
        d[i + 1] = clamp(d[i + 1] + k2 + g2 * 0.95, 0, 255);
        d[i + 2] = clamp(d[i + 2] + k2 * 0.8 + g2 * 0.8, 0, 255);
        i += 4;
      }
    }
    ctx.putImageData(rimg, 0, 0);
  }

  drawMoistureBands(ctx, rng);
  drawShells(ctx, detail);
  drawPebbles(ctx, detail);

  // coral-white shell glints
  for (let i = 0; i < 170; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 0.6 + rng() * 1.7;
    const a = 0.32 + rng() * 0.42;
    wrapDraw(ctx, S, x, y, 3, (c) => {
      c.fillStyle = `rgba(252,247,234,${a})`;
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    });
  }

  overlayNoise(ctx, S, S, { tile: 256, seed: 311, alpha: 0.11, scale: 2, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.09, seed: 312 });

  // ---- height -------------------------------------------------------------
  const k = HS / S;
  const height = grayCanvas(HS, (x, y, u, v) => {
    const moisture = tileFbm(u, v, 3, 511);
    const wet = clamp((moisture - 0.47) * 2.5, 0, 1);
    const rip = rippleAt(u, v);
    const grain = hash2(x, y, 1201) - 0.5;
    const n = tileFbm(u, v, 4, 133);
    return clamp(0.5 + rip * (0.034 - wet * 0.026) + (n - 0.5) * 0.12 + grain * 0.10, 0, 1);
  });
  const hctx = ctxOf(height);
  for (const s of detail.shells) {
    hctx.fillStyle = 'rgba(206,206,206,0.5)';
    wrapDraw(hctx, HS, s.x * k, s.y * k, s.r * k + 3, (c) => {
      c.beginPath();
      c.ellipse(s.x * k, s.y * k, s.r * k * 0.9, s.r * k * 0.5, s.rot, 0, TAU);
      c.fill();
    });
  }
  for (const s of detail.big) {
    hctx.fillStyle = 'rgba(228,228,228,0.6)';
    wrapDraw(hctx, HS, s.x * k, s.y * k, s.r * k + 4, (c) => {
      c.beginPath();
      c.ellipse(s.x * k, s.y * k, s.r * k, s.r * k * 0.85, s.rot, 0, TAU);
      c.fill();
    });
  }
  for (const s of detail.flakes) {
    hctx.fillStyle = 'rgba(216,216,216,0.55)';
    wrapDraw(hctx, HS, s.x * k, s.y * k, s.r * k + 4, (c) => {
      c.beginPath();
      c.ellipse(s.x * k, s.y * k, s.r * k * 0.9, s.r * k * 0.55, s.rot, 0, TAU);
      c.fill();
    });
  }
  for (const p of detail.pebbles) {
    const v = 190 + p.tone * 45;
    hctx.fillStyle = `rgba(${v},${v},${v},0.85)`;
    wrapDraw(hctx, HS, p.x * k, p.y * k, p.r * k + 3, (c) => {
      c.beginPath();
      c.ellipse(p.x * k, p.y * k, p.r * k, p.r * k * p.squash, p.rot, 0, TAU);
      c.fill();
    });
  }
  overlayNoise(hctx, HS, HS, { tile: 256, seed: 313, alpha: 0.10, scale: 1, mode: 'overlay' });
  overlayGrain(hctx, HS, HS, { alpha: 0.08, seed: 314 });

  // ---- roughness ----------------------------------------------------------
  const rough = grayCanvas(ROUGH, (x, y, u, v) => {
    const moisture = tileFbm(u, v, 3, 511);
    const wet = clamp((moisture - 0.47) * 2.8, 0, 1);
    const n = tileFbm(u, v, 3, 733);
    // dry sand is uniformly matte; wet bands go glossy; shell hash is smoother
    return clamp(0.93 - wet * 0.33 + (n - 0.5) * 0.07, 0, 1);
  });
  const rctx = ctxOf(rough);
  const kr = ROUGH / S;
  for (const p of detail.pebbles) {
    const pv = Math.round((0.5 + p.tone * 0.16) * 255);
    rctx.fillStyle = `rgba(${pv},${pv},${pv},0.9)`;
    wrapDraw(rctx, ROUGH, p.x * kr, p.y * kr, p.r * kr + 3, (c) => {
      c.beginPath();
      c.ellipse(p.x * kr, p.y * kr, p.r * kr, p.r * kr * p.squash, p.rot, 0, TAU);
      c.fill();
    });
  }
  for (const s of detail.shells) {
    rctx.fillStyle = 'rgba(120,120,120,0.45)';
    wrapDraw(rctx, ROUGH, s.x * kr, s.y * kr, s.r * kr + 3, (c) => {
      c.beginPath();
      c.ellipse(s.x * kr, s.y * kr, s.r * kr, s.r * kr * 0.5, s.rot, 0, TAU);
      c.fill();
    });
  }
  for (const s of detail.flakes) {
    rctx.fillStyle = 'rgba(112,112,112,0.5)';
    wrapDraw(rctx, ROUGH, s.x * kr, s.y * kr, s.r * kr + 3, (c) => {
      c.beginPath();
      c.ellipse(s.x * kr, s.y * kr, s.r * kr * 0.9, s.r * kr * 0.55, s.rot, 0, TAU);
      c.fill();
    });
  }
  overlayNoise(rctx, ROUGH, ROUGH, { tile: 256, seed: 315, alpha: 0.10, scale: 1, mode: 'overlay' });

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, STRENGTH, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}

