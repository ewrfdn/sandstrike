/**
 * SANDSTRIKE // adobe texture set  (lib.adobe)
 *
 * Used by materials: adobe / adobeLight / adobeDark (all village walls, parapets,
 * shop facades and the warehouse masses).
 *
 * Hand-troweled desert mud plaster, drawn as a layered weathering story:
 *   - flat ochre ground + seamless large-scale colour drift (no tile seams)
 *   - trowel sweeps / float drags + fine sand grain + aggregate speckles + pores
 *   - crack network with AO halo and a lit lip (a single crack layout feeds the
 *     albedo, the height canvas that makes the normal map, and roughness)
 *   - patch repairs, chipped plaster exposing the straw mud core, damp stains
 *   - baked contact AO around cracks / patches / chips
 *
 * Texture set contract:
 *   map            albedo        sRGB
 *   normalMap      tangent space  linear (Sobel from a 1024px height canvas)
 *   roughnessMap   linear
 *
 * Everything here is drawn with Canvas2D at load time; tune the constants in the
 * TUNING block below to iterate on this material without touching the others.
 */
import { clamp, makeRNG } from '../utils.js';
import { TAU, ctxOf, el, fillCanvas, grayCanvas, normalFromHeightCanvas, overlayGrain, overlayNoise, textureFromCanvas, tileFbm, wrapDraw } from './core.js';

// ---------------------------------------------------------------------------
// TUNING
// ---------------------------------------------------------------------------
const S = 1024;            // texture size in px (one tile = ~2.5 m in world space)
const HEIGHT_SIZE = 1024;  // resolution of the height canvas the normal map comes from
const NORMAL_STRENGTH = 3.1;

// desert mud plaster: warm ochre / sand / dusty cream
const PLASTER = { hue: 36, sat: 34, light: 58 };
const MUD_CORE = '#8d6945';  // exposed mud below chipped plaster

const CRACKS = 13;         // main crack roots (each branches a couple of times)
const HAIRLINES = 22;      // short hairline cracks
const PATCHES = 3;         // troweled repair patches
const CHIPS = 2;           // chipped spots exposing the mud core
const TROWEL_SWEEPS = 90;  // broad trowel strokes
const AGGREGATE = 1500;    // sand grains in the plaster
const PORES = 380;         // pinholes

// ---------------------------------------------------------------------------
// layout (shared by albedo / height / roughness)
// ---------------------------------------------------------------------------

function makeCrack(rng) {
  const rootX = rng() * S;
  const rootY = rng() * S;
  const crackRng = makeRNG(Math.floor(rng() * 1e9));
  const segments = [];
  const walk = (x, y, angle, len, width, depth) => {
    const steps = Math.max(2, Math.round(len / 34));
    const pts = [[x, y]];
    let cx = x;
    let cy = y;
    let a = angle;
    for (let i = 0; i < steps; i++) {
      a += (crackRng() - 0.5) * 1.5;
      cx += Math.cos(a) * (len / steps);
      cy += Math.sin(a) * (len / steps);
      pts.push([cx, cy]);
    }
    segments.push({ pts, width });
    if (depth > 0 && crackRng() < 0.8) {
      const branches = crackRng() < 0.35 ? 2 : 1;
      for (let b = 0; b < branches; b++) {
        walk(cx, cy, a + (crackRng() < 0.5 ? -1 : 1) * (0.5 + crackRng() * 0.8), len * (0.35 + crackRng() * 0.3), Math.max(0.7, width * 0.62), depth - 1);
      }
    }
  };
  walk(rootX, rootY, rng() * TAU, 90 + rng() * 240, 1.2 + rng() * 2.2, 2);
  return segments;
}

function makePatches(rng) {
  const patches = [];
  for (let i = 0; i < PATCHES; i++) {
    const cx = rng() * S;
    const cy = rng() * S;
    const w = 150 + rng() * 300;
    const h = 110 + rng() * 240;
    const prng = makeRNG(Math.floor(rng() * 1e9));
    const pts = [];
    const n = 9 + Math.floor(prng() * 5);
    for (let p = 0; p < n; p++) {
      const a = (p / n) * TAU;
      const rad = 0.72 + prng() * 0.42;
      pts.push([cx + Math.cos(a) * w * 0.5 * rad, cy + Math.sin(a) * h * 0.5 * rad]);
    }
    patches.push({
      pts,
      pad: Math.max(w, h) * 0.75,
      tone: (prng() - 0.5) * 2, // -1 darker repair, +1 lighter repair
      seed: Math.floor(prng() * 1e9),
    });
  }
  return patches;
}

function makeChips(rng) {
  const chips = [];
  for (let i = 0; i < CHIPS; i++) {
    const cx = rng() * S;
    const cy = rng() * S;
    const r = 14 + rng() * 30;
    const crng = makeRNG(Math.floor(rng() * 1e9));
    const pts = [];
    const n = 7 + Math.floor(crng() * 4);
    for (let p = 0; p < n; p++) {
      const a = (p / n) * TAU;
      const rad = 0.55 + crng() * 0.6;
      pts.push([cx + Math.cos(a) * r * rad, cy + Math.sin(a) * r * rad]);
    }
    chips.push({ pts, r, pad: r * 1.4, seed: Math.floor(crng() * 1e9) });
  }
  return chips;
}

/** Trace a closed polygon path from absolute points. */
function polyPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** Trace an open polyline. */
function linePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

// ---------------------------------------------------------------------------
// albedo passes
// ---------------------------------------------------------------------------

function makeHairline(rng) {
  const x = rng() * S;
  const y = rng() * S;
  const len = 26 + rng() * 70;
  const pts = [[x, y]];
  let cx = x;
  let cy = y;
  let a = rng() * TAU;
  const steps = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < steps; i++) {
    a += (rng() - 0.5) * 1.2;
    cx += Math.cos(a) * (len / steps);
    cy += Math.sin(a) * (len / steps);
    pts.push([cx, cy]);
  }
  return { pts, width: 0.7 + rng() * 0.6 };
}

/** Stroke a polyline tapering from `width` down to ~45% along its length. */
function strokeTaper(c, pts, width, style) {
  const n = pts.length;
  const chunks = 3;
  for (let i = 0; i < chunks; i++) {
    const a = Math.floor((n - 1) * (i / chunks));
    const b = Math.min(n - 1, Math.floor((n - 1) * ((i + 1) / chunks)));
    if (b <= a) continue;
    c.beginPath();
    c.moveTo(pts[a][0], pts[a][1]);
    for (let k = a + 1; k <= b; k++) c.lineTo(pts[k][0], pts[k][1]);
    c.lineWidth = Math.max(0.55, width * (1 - i * 0.28));
    c.strokeStyle = style;
    c.stroke();
  }
}

function drawCracks(ctx, cracks) {
  for (const seg of cracks) {
    const pad = 12 + seg.width * 4;
    wrapDraw(ctx, S, seg.pts[0][0], seg.pts[0][1], pad + 900, (c) => {
      // soft AO halo in the plaster around the crack (dust piles up in the gap)
      strokeTaper(c, seg.pts, seg.width * 2.6, 'rgba(62,42,24,0.10)');
      // dark core: deep and shadowed, tapering with distance from the root
      strokeTaper(c, seg.pts, seg.width, `rgba(36,22,11,${0.42 + seg.width * 0.05})`);
      // sun-lit lip on one side of the groove
      c.save();
      c.translate(0.8, 1.1);
      strokeTaper(c, seg.pts, Math.max(0.8, seg.width * 0.5), 'rgba(252,238,206,0.07)');
      c.restore();
    });
  }
}

function drawPatches(ctx, patches) {
  for (const patch of patches) {
    wrapDraw(ctx, S, patch.pts[0][0], patch.pts[0][1], patch.pad, (c) => {
      const prng = makeRNG(patch.seed);
      c.save();
      polyPath(c, patch.pts);
      c.clip();
      const hsl = `hsl(${PLASTER.hue + (prng() - 0.5) * 6} ${PLASTER.sat + (prng() - 0.5) * 10}% ${PLASTER.light + patch.tone * 5 + (prng() - 0.5) * 4}%)`;
      c.globalAlpha = 0.30 + prng() * 0.12; // a repair is a thin skim coat, not paint
      c.fillStyle = hsl;
      c.fillRect(-S, -S, S * 3, S * 3);
      // trowel sweeps inside the patch follow a slightly different direction
      c.globalAlpha = 0.5;
      for (let i = 0; i < 8; i++) {
        const x = prng() * S;
        const y = prng() * S;
        c.strokeStyle = prng() > 0.5 ? 'rgba(255,246,222,0.10)' : 'rgba(110,78,48,0.10)';
        c.lineWidth = 3 + prng() * 9;
        c.beginPath();
        c.arc(x, y, 30 + prng() * 90, 0, TAU);
        c.stroke();
      }
      c.restore();
      // trowel rim: a pale lip on one side, shadow on the other
      c.save();
      polyPath(c, patch.pts);
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(60,42,26,0.12)';
      c.stroke();
      c.translate(-1.2, -1.2);
      polyPath(c, patch.pts);
      c.lineWidth = 1.3;
      c.strokeStyle = 'rgba(255,246,226,0.12)';
      c.stroke();
      c.restore();
    });
  }
}

function drawChips(ctx, chips) {
  for (const chip of chips) {
    wrapDraw(ctx, S, chip.pts[0][0], chip.pts[0][1], chip.pad, (c) => {
      c.save();
      polyPath(c, chip.pts);
      c.clip();
      c.fillStyle = MUD_CORE;
      c.fillRect(-S, -S, S * 3, S * 3);
      // a few straw fibres inside the exposed mud
      const prng = makeRNG(chip.seed);
      for (let i = 0; i < 26; i++) {
        const x = prng() * S;
        const y = prng() * S;
        const a = prng() * TAU;
        const l = 2 + prng() * 10;
        c.strokeStyle = prng() > 0.4 ? 'rgba(226,198,146,0.5)' : 'rgba(74,52,30,0.45)';
        c.lineWidth = 0.6 + prng() * 0.9;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        c.stroke();
      }
      // inner shadow: the chip is below the plaster surface
      const b = chip.pts.reduce((acc, p) => [Math.max(acc[0], p[0]), Math.max(acc[1], p[1])], [-Infinity, -Infinity]);
      const t = chip.pts.reduce((acc, p) => [Math.min(acc[0], p[0]), Math.min(acc[1], p[1])], [Infinity, Infinity]);
      const g = c.createLinearGradient(0, t[1], 0, b[1]);
      g.addColorStop(0, 'rgba(24,14,6,0.38)');
      g.addColorStop(0.55, 'rgba(24,14,6,0.06)');
      g.addColorStop(1, 'rgba(255,240,210,0.12)');
      c.fillStyle = g;
      c.fillRect(-S, -S, S * 3, S * 3);
      c.restore();
      // broken plaster lip: a pale edge on the lower/outer side of the chip
      c.save();
      c.translate(-0.8, 1.2);
      polyPath(c, chip.pts);
      c.lineWidth = 2.0;
      c.strokeStyle = 'rgba(255,242,214,0.20)';
      c.stroke();
      c.restore();
    });
  }
}

function drawAggregate(ctx, rng) {
  for (let i = 0; i < AGGREGATE; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 0.4 + rng() * 1.3;
    const light = rng() > 0.45;
    wrapDraw(ctx, S, x, y, 4, (c) => {
      c.fillStyle = light ? `rgba(${238 + rng() * 12},${224 + rng() * 12},${196 + rng() * 14},${0.12 + rng() * 0.26})` : `rgba(${112 + rng() * 30},${84 + rng() * 26},${56 + rng() * 20},${0.10 + rng() * 0.22})`;
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    });
  }
  for (let i = 0; i < PORES; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 0.6 + rng() * 1.8;
    wrapDraw(ctx, S, x, y, 6, (c) => {
      c.fillStyle = `rgba(82,58,34,${0.18 + rng() * 0.22})`;
      c.beginPath();
      c.ellipse(x, y, r, r * (0.6 + rng() * 0.5), rng() * TAU, 0, TAU);
      c.fill();
      c.fillStyle = `rgba(250,238,212,${0.10 + rng() * 0.15})`;
      c.beginPath();
      c.arc(x + r * 0.25, y + r * 0.6, r * 0.45, 0, TAU);
      c.fill();
    });
  }
}

function drawTrowel(ctx, rng) {
  // layered float bands: the horizontal passes of the plasterer's trowel
  for (let i = 0; i < 9; i++) {
    const y = rng() * S;
    const h = 24 + rng() * 80;
    const light = rng() > 0.5;
    const a = 0.02 + rng() * 0.035;
    wrapDraw(ctx, S, S * 0.5, y, h + 8, (c) => {
      const g = c.createLinearGradient(0, y - h, 0, y + h);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, light ? `rgba(255,246,222,${a})` : `rgba(112,78,46,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, y - h, S, h * 2);
    });
  }
  // broad sweeps left by the steel float: low-contrast light/dark crescents
  for (let i = 0; i < TROWEL_SWEEPS; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 26 + rng() * 120;
    const a0 = rng() * TAU;
    const sweep = 0.5 + rng() * 1.6;
    const light = rng() > 0.45;
    const alpha = 0.03 + rng() * 0.05;
    wrapDraw(ctx, S, x, y, r + 30, (c) => {
      c.strokeStyle = light ? `rgba(255,247,224,${alpha})` : `rgba(116,82,50,${alpha})`;
      c.lineWidth = 5 + rng() * 16;
      c.lineCap = 'round';
      c.beginPath();
      c.arc(x, y, r, a0, a0 + sweep);
      c.stroke();
    });
  }
  // a few long drag marks
  for (let i = 0; i < 16; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 120 + rng() * 300;
    const ang = (rng() - 0.5) * 0.5 + (rng() > 0.5 ? 0 : Math.PI * 0.5);
    const mx = x + Math.cos(ang) * len * 0.5;
    const my = y + Math.sin(ang) * len * 0.5;
    const light = rng() > 0.5;
    wrapDraw(ctx, S, mx, my, len * 0.5 + 60, (c) => {
      c.strokeStyle = light ? 'rgba(255,246,222,0.04)' : 'rgba(110,78,46,0.04)';
      c.lineWidth = 14 + rng() * 26;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      c.stroke();
    });
  }
}

function drawDamp(ctx, rng) {
  for (let i = 0; i < 10; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 70 + rng() * 220;
    wrapDraw(ctx, S, x, y, r + 8, (c) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(74,52,30,${0.04 + rng() * 0.06})`);
      g.addColorStop(1, 'rgba(74,52,30,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
}

// ---------------------------------------------------------------------------
// height
// ---------------------------------------------------------------------------
function drawHeightCracks(hctx, cracks) {
  for (const seg of cracks) {
    wrapDraw(hctx, HEIGHT_SIZE, seg.pts[0][0], seg.pts[0][1], 12 + seg.width * 4 + 900, (c) => {
      // the crack is carved in: dark groove with a raised lip on one side
      strokeTaper(c, seg.pts, seg.width * 2.8, 'rgba(12,12,12,0.8)');
      c.save();
      c.translate(0.8, 1.0);
      strokeTaper(c, seg.pts, Math.max(0.8, seg.width * 0.6), 'rgba(218,218,218,0.55)');
      c.restore();
    });
  }
}

function drawHeightPatches(hctx, patches) {
  for (const patch of patches) {
    wrapDraw(hctx, HEIGHT_SIZE, patch.pts[0][0], patch.pts[0][1], patch.pad, (c) => {
      // a repair sits ~2 mm proud of the surrounding wall
      c.save();
      polyPath(c, patch.pts);
      c.fillStyle = 'rgba(176,176,176,0.30)';
      c.fill();
      polyPath(c, patch.pts);
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(34,34,34,0.45)';
      c.stroke();
      c.restore();
    });
  }
}

function drawHeightChips(hctx, chips) {
  for (const chip of chips) {
    wrapDraw(hctx, HEIGHT_SIZE, chip.pts[0][0], chip.pts[0][1], chip.pad, (c) => {
      polyPath(c, chip.pts);
      c.fillStyle = 'rgba(70,70,70,0.9)';
      c.fill();
      polyPath(c, chip.pts);
      c.lineWidth = 2.5;
      c.strokeStyle = 'rgba(220,220,220,0.35)';
      c.stroke();
    });
  }
}

// ---------------------------------------------------------------------------
// roughness
// ---------------------------------------------------------------------------
function drawRoughPass(rctx, cracks, patches, chips, rng) {
  fillCanvas(rctx, S, S, 'rgb(233,233,233)'); // matte mud plaster
  // damp areas are smoother (wind-polished / slightly wet)
  for (let i = 0; i < 10; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 70 + rng() * 220;
    wrapDraw(rctx, S, x, y, r + 8, (c) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(196,196,196,0.5)');
      g.addColorStop(1, 'rgba(196,196,196,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  for (const patch of patches) {
    wrapDraw(rctx, S, patch.pts[0][0], patch.pts[0][1], patch.pad, (c) => {
      polyPath(c, patch.pts);
      c.fillStyle = 'rgb(222,222,222)';
      c.fill();
    });
  }
  for (const chip of chips) {
    wrapDraw(rctx, S, chip.pts[0][0], chip.pts[0][1], chip.pad, (c) => {
      polyPath(c, chip.pts);
      c.fillStyle = 'rgb(246,246,246)';
      c.fill();
    });
  }
  for (const seg of cracks) {
    wrapDraw(rctx, S, seg.pts[0][0], seg.pts[0][1], 12 + seg.width * 4 + 400, (c) => {
      linePath(c, seg.pts);
      c.lineWidth = seg.width * 1.8;
      c.strokeStyle = 'rgba(240,240,240,0.7)';
      c.stroke();
    });
  }
  overlayNoise(rctx, S, S, { tile: 256, seed: 96, alpha: 0.10, scale: 1, mode: 'overlay' });
  overlayGrain(rctx, S, S, { alpha: 0.06, seed: 97 });
}

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------
export function makeAdobe(aniso, reg) {
  const rng = makeRNG(1290);
  const cracks = [];
  for (let i = 0; i < CRACKS; i++) cracks.push(...makeCrack(rng));
  const hairlines = [];
  for (let i = 0; i < HAIRLINES; i++) hairlines.push(makeHairline(rng));
  const patches = makePatches(rng);
  const chips = makeChips(rng);
  const layoutRng = makeRNG(5150);

  // ---- albedo -------------------------------------------------------------
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const baseLight = PLASTER.light;
  fillCanvas(ctx, S, S, `hsl(${PLASTER.hue} ${PLASTER.sat}% ${baseLight}%)`);

  // broad sun-bleached / damp tonal regions that break up the repeat
  {
    const brng = makeRNG(321);
    for (let i = 0; i < 7; i++) {
      const x = brng() * S;
      const y = brng() * S;
      const r = 180 + brng() * 340;
      const kind = brng();
      wrapDraw(ctx, S, x, y, r + 8, (c) => {
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        if (kind < 0.38) g.addColorStop(0, `rgba(198,158,106,${0.055 + brng() * 0.05})`);
        else if (kind < 0.74) g.addColorStop(0, `rgba(238,214,172,${0.05 + brng() * 0.05})`);
        else g.addColorStop(0, `rgba(166,120,78,${0.04 + brng() * 0.04})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(x - r, y - r, r * 2, r * 2);
      });
    }
  }

  // seamless large-scale colour drift (mud mixes unevenly)
  overlayNoise(ctx, S, S, { tile: 256, seed: 31, alpha: 0.22, scale: 2, mode: 'overlay' });
  {
    const mrng = makeRNG(710);
    for (let i = 0; i < 26; i++) {
      const x = mrng() * S;
      const y = mrng() * S;
      const r = 90 + mrng() * 300;
      const kind = mrng();
      wrapDraw(ctx, S, x, y, r + 8, (c) => {
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        if (kind < 0.36) g.addColorStop(0, `rgba(232,208,164,${0.10 + mrng() * 0.10})`); // bleached cream
        else if (kind < 0.7) g.addColorStop(0, `rgba(186,146,94,${0.08 + mrng() * 0.10})`); // ochre
        else g.addColorStop(0, `rgba(158,116,78,${0.05 + mrng() * 0.08})`); // damp-ish
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(x - r, y - r, r * 2, r * 2);
      });
    }
  }

  drawTrowel(ctx, layoutRng);
  drawDamp(ctx, layoutRng);

  // fine sand grain baked into the pigment (per-pixel, cheap)
  {
    const img = ctx.getImageData(0, 0, S, S);
    const d = img.data;
    const gRng = makeRNG(882);
    let i = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = (gRng() - 0.5) * 12;
        d[i] = clamp(d[i] + n, 0, 255);
        d[i + 1] = clamp(d[i + 1] + n * 0.92, 0, 255);
        d[i + 2] = clamp(d[i + 2] + n * 0.78, 0, 255);
        i += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  drawAggregate(ctx, layoutRng);
  overlayNoise(ctx, S, S, { tile: 256, seed: 33, alpha: 0.12, scale: 1, mode: 'overlay' });
  drawPatches(ctx, patches);
  drawCracks(ctx, cracks);
  drawCracks(ctx, hairlines);
  drawChips(ctx, chips);
  // dust film
  overlayNoise(ctx, S, S, { tile: 256, seed: 35, alpha: 0.10, scale: 1, mode: 'soft-light' });
  overlayGrain(ctx, S, S, { alpha: 0.08, seed: 39 });

  // ---- height -------------------------------------------------------------
  const height = el(HEIGHT_SIZE, HEIGHT_SIZE);
  const hctx = ctxOf(height);
  // low-frequency plaster relief, upscaled from 512 so the per-pixel fbm stays cheap
  const relief = grayCanvas(512, (x, y, u, v) => {
    const n = tileFbm(u, v, 4, 19);
    const n2 = tileFbm(u, v, 2, 23);
    return clamp(0.52 + (n - 0.5) * 0.42 + (n2 - 0.5) * 0.18, 0, 1);
  });
  hctx.imageSmoothingEnabled = true;
  hctx.imageSmoothingQuality = 'high';
  hctx.drawImage(relief, 0, 0, 512, 512, 0, 0, HEIGHT_SIZE, HEIGHT_SIZE);
  // trowel ridges: shallow raised sweeps + horizontal float bands
  {
    const trng = makeRNG(424);
    for (let i = 0; i < 9; i++) {
      const y = trng() * S;
      const h = 24 + trng() * 80;
      const a = 0.10 + trng() * 0.08;
      wrapDraw(hctx, HEIGHT_SIZE, S * 0.5, y, h + 8, (c) => {
        const g = c.createLinearGradient(0, y - h, 0, y + h);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.5, `rgba(238,238,238,${a})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(0, y - h, S, h * 2);
      });
    }
    for (let i = 0; i < 60; i++) {
      const x = trng() * S;
      const y = trng() * S;
      const r = 30 + trng() * 130;
      const a0 = trng() * TAU;
      const sweep = 0.5 + trng() * 1.4;
      wrapDraw(hctx, HEIGHT_SIZE, x, y, r + 30, (c) => {
        c.strokeStyle = `rgba(214,214,214,${0.12 + trng() * 0.10})`;
        c.lineWidth = 8 + trng() * 16;
        c.lineCap = 'round';
        c.beginPath();
        c.arc(x, y, r, a0, a0 + sweep);
        c.stroke();
      });
    }
  }
  drawHeightPatches(hctx, patches);
  drawHeightCracks(hctx, cracks);
  drawHeightCracks(hctx, hairlines);
  drawHeightChips(hctx, chips);
  // pores
  {
    const prng = makeRNG(651);
    for (let i = 0; i < 500; i++) {
      const x = prng() * S;
      const y = prng() * S;
      const r = 0.7 + prng() * 2.2;
      wrapDraw(hctx, HEIGHT_SIZE, x, y, 6, (c) => {
        c.fillStyle = 'rgba(30,30,30,0.55)';
        c.beginPath();
        c.arc(x, y, r, 0, TAU);
        c.fill();
      });
    }
  }
  overlayNoise(hctx, HEIGHT_SIZE, HEIGHT_SIZE, { tile: 256, seed: 41, alpha: 0.15, scale: 1, mode: 'overlay' });
  overlayGrain(hctx, HEIGHT_SIZE, HEIGHT_SIZE, { alpha: 0.12, seed: 42 });

  // ---- roughness & normal -------------------------------------------------
  const rough = el(S, S);
  drawRoughPass(ctxOf(rough), cracks.concat(hairlines), patches, chips, makeRNG(517));

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, NORMAL_STRENGTH, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
