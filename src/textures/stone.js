/**
 * SANDSTRIKE // stone texture set  (lib.stone)
 *
 * Used by materials: stone / stoneDark / rock.
 *
 * Desert sandstone ashlar, drawn as a real coursed wall instead of a grid of
 * identical tiles:
 *   - irregular courses / block widths, staggered joints, everything wrapped so
 *     the ~2 m texture tile repeats seamlessly
 *   - per-block colour drift (pale cream -> ochre -> weathered brown), flat
 *     quarry faces with crisp bevel edges, wind pitting, broken corners,
 *     sedimentary bedding bands, salt bloom, dust and soot
 *   - recessed mortar joints with grit and contact AO
 *   - albedo, height and roughness all come from ONE shared block layout, so the
 *     normal map relief lines up exactly with the painted joints
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
import { TAU, ctxOf, el, fillCanvas, normalFromHeightCanvas, overlayGrain, overlayNoise, textureFromCanvas, wrapDraw } from './core.js';

// ---------------------------------------------------------------------------
// TUNING
// ---------------------------------------------------------------------------
const S = 1024;            // texture size in px (one tile = ~2 m in world space)
const COURSES = 5;         // ashlar courses per tile
const MORTAR = 8;          // nominal joint width (px) — actual joints vary
const HEIGHT_SIZE = 1024;  // resolution of the height canvas the normal map comes from
const NORMAL_STRENGTH = 3.2;

// warm desert sandstone; hue/sat/lightness drift is applied per block
const SANDSTONE = { hue: 35, sat: 26, light: 58 };

const CHIP_CHANCE = 0.5;    // fraction of blocks with a broken corner
const STRATA_CHANCE = 0.5;  // fraction of blocks with sedimentary bedding
const PIT_CHANCE = 0.7;     // fraction of blocks with surface pockmarks
const SALT_CHANCE = 0.12;   // fraction of blocks with pale salt/efflorescence bloom
const DIRTY_CHANCE = 0.32;  // fraction of blocks that are noticeably soot/dirt stained

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

/** Split `total` px into `parts` random integers that sum exactly to `total`. */
function partition(total, parts, rng, spread = 0.4) {
  const raw = [];
  let sum = 0;
  for (let i = 0; i < parts; i++) {
    const v = 1 - spread / 2 + rng() * spread;
    raw.push(v);
    sum += v;
  }
  const out = raw.map((v) => Math.max(24, Math.round((v / sum) * total)));
  let diff = total - out.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (diff !== 0 && guard++ < 4096) {
    for (let i = 0; i < out.length && diff !== 0; i++) {
      const step = diff > 0 ? 1 : -1;
      if (out[i] + step > 20) {
        out[i] += step;
        diff -= step;
      }
    }
  }
  return out;
}

/**
 * Build one tile worth of coursed ashlar. Every random property of a block is
 * decided here once and then reused by the albedo / height / roughness passes,
 * so the maps stay in register.
 */
function buildAshlar(rng) {
  const rowHeights = partition(S, COURSES, rng, 0.26);
  const blocks = [];
  let y = 0;
  for (let r = 0; r < rowHeights.length; r++) {
    const rh = rowHeights[r];
    const count = r === 0 ? 3 : 3 + Math.floor(rng() * 2);
    const widths = partition(S, count, rng, 0.65);
    // rows are staggered by a random amount; the row therefore starts before the
    // left edge and its last block wraps around to the left edge
    const offset = Math.round((rng() - 0.5) * widths[0] * 0.85);
    let x = offset;
    for (let i = 0; i < widths.length; i++) {
      const bw = widths[i];
      const joint = MORTAR * (0.7 + rng() * 0.9);
      blocks.push({
        x: x + joint * 0.5,
        y: y + joint * 0.5,
        w: bw - joint,
        h: rh - joint,
        seed: Math.floor(rng() * 1e9),
        hue: SANDSTONE.hue + (rng() - 0.5) * 4,
        sat: SANDSTONE.sat + (rng() - 0.5) * 6,
        light: SANDSTONE.light + (rng() - 0.5) * 8,
        worn: rng(),               // 0 = crisp quarried face, 1 = heavily eroded
        rough: 0.80 + rng() * 0.14,
        top: 0.66 + rng() * 0.16,  // height of the block face
        dirty: rng() < DIRTY_CHANCE ? 0.3 + rng() * 0.4 : 0,
        chip: rng() < CHIP_CHANCE ? { corner: Math.floor(rng() * 4), size: 0.06 + rng() * 0.11 } : null,
        strata: rng() < STRATA_CHANCE ? { count: 1 + Math.floor(rng() * 2), seed: Math.floor(rng() * 1e9) } : null,
        pits: rng() < PIT_CHANCE ? { count: 8 + Math.floor(rng() * 14), seed: Math.floor(rng() * 1e9) } : null,
        salt: rng() < SALT_CHANCE,
      });
      x += bw;
    }
    y += rh;
  }
  return blocks;
}

/** Rounded, slightly irregular block outline (deterministic per block). */
function blockPath(ctx, b) {
  const rng = makeRNG(b.seed + 1);
  const j = 1.4 + b.worn * 2.4; // edge irregularity grows with weathering
  const r = 2 + rng() * 4;      // corner radius
  const { x, y, w, h } = b;
  ctx.beginPath();
  ctx.moveTo(x + r, y + (rng() - 0.5) * j);
  ctx.lineTo(x + w * 0.5, y + (rng() - 0.5) * j);
  ctx.lineTo(x + w - r, y + (rng() - 0.5) * j);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w + (rng() - 0.5) * j, y + h * 0.5);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h + (rng() - 0.5) * j);
  ctx.lineTo(x + w * 0.5, y + h + (rng() - 0.5) * j);
  ctx.lineTo(x + r, y + h + (rng() - 0.5) * j);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x + (rng() - 0.5) * j, y + h * 0.5);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y + (rng() - 0.5) * j);
  ctx.closePath();
}

/** Chipped corner polygon painted in mortar colour. */
function chipPath(ctx, b, cx, cy, size) {
  const rng = makeRNG(b.seed + 7);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + size * (0.6 + rng() * 0.5), cy + (rng() - 0.3) * size * 0.4);
  ctx.lineTo(cx + size * (0.2 + rng() * 0.4), cy + size * (0.5 + rng() * 0.4));
  ctx.lineTo(cx + (rng() - 0.5) * size * 0.3, cy + size * (0.7 + rng() * 0.3));
  ctx.closePath();
}

function chipCorner(b) {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ][b.chip.corner];
}

/** Per-block sedimentary bedding: soft low-contrast bands + an occasional seam. */
function strataLines(ctx, b, rng) {
  const bands = b.strata.count;
  const step = b.h / (bands + 1);
  for (let i = 0; i < bands; i++) {
    const y0 = b.y + step * (i + 1) + (rng() - 0.5) * step * 0.55;
    const bh = 10 + rng() * 30;
    const dark = rng() > 0.42;
    // soft band (gradient fades at both edges so it does not read as a stripe)
    const g = ctx.createLinearGradient(0, y0 - bh, 0, y0 + bh);
    const a = 0.012 + rng() * 0.022;
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, dark ? `rgba(72,50,30,${a})` : `rgba(252,242,220,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(b.x, y0 - bh, b.w, bh * 2);
    // a thin wavy seam on the bedding plane
    if (rng() > 0.4) {
      const amp = 0.5 + rng() * 1.6;
      const freq = 1 + rng() * 1.8;
      const phase = rng() * TAU;
      ctx.beginPath();
      for (let px = b.x; px <= b.x + b.w; px += 12) {
        const t = (px - b.x) / b.w;
        const py = y0 + Math.sin(t * TAU * freq + phase) * amp;
        if (px === b.x) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineWidth = 0.7 + rng() * 1.3;
      ctx.strokeStyle = `rgba(48,32,18,${0.04 + rng() * 0.05})`;
      ctx.stroke();
    }
  }
}

/** Small wind pits: dark eye + lit lower lip. */
function drawPits(ctx, b, pitRng, alphaScale = 1) {
  for (let i = 0; i < b.pits.count; i++) {
    const px = b.x + 6 + pitRng() * (b.w - 12);
    const py = b.y + 6 + pitRng() * (b.h - 12);
    const r = 0.6 + pitRng() * 2.4;
    ctx.fillStyle = `rgba(48,32,18,${(0.15 + pitRng() * 0.25) * alphaScale})`;
    ctx.beginPath();
    ctx.ellipse(px, py, r, r * (0.5 + pitRng() * 0.6), pitRng() * TAU, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(250,240,220,${(0.10 + pitRng() * 0.16) * alphaScale})`;
    ctx.beginPath();
    ctx.arc(px + r * 0.2, py + r * 0.55, r * 0.45, 0, TAU);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// albedo
// ---------------------------------------------------------------------------
function drawBlockAlbedo(ctx, b) {
  const rng = makeRNG(b.seed + 3);
  const hsl = `hsl(${b.hue} ${b.sat}% ${b.light}%)`;
  ctx.save();
  blockPath(ctx, b);
  ctx.clip();

  // flat quarry face, only a faint top-lit / bottom-dust gradient
  ctx.fillStyle = hsl;
  ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
  const grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  grad.addColorStop(0, 'rgba(255,248,232,0.05)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(46,30,16,0.10)');
  ctx.fillStyle = grad;
  ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);

  // per-block stone grain: the same tileable noise, clipped and seeded per block
  overlayNoise(ctx, S, S, { tile: 256, seed: b.seed % 977, alpha: 0.17, scale: 1, mode: 'overlay' });

  // broad quarry-face mottling
  for (let i = 0; i < 3; i++) {
    const mx = b.x + rng() * b.w;
    const my = b.y + rng() * b.h;
    const mr = b.w * (0.25 + rng() * 0.45);
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
    const pale = rng() > 0.45;
    g.addColorStop(0, pale ? `rgba(246,236,214,${0.05 + rng() * 0.06})` : `rgba(84,60,38,${0.04 + rng() * 0.07})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  }

  if (b.pits) drawPits(ctx, b, makeRNG(b.pits.seed));

  // salt bloom / efflorescence
  if (b.salt) {
    const srng = makeRNG(b.seed + 11);
    for (let i = 0; i < 4; i++) {
      const sx = b.x + srng() * b.w;
      const sy = b.y + srng() * b.h;
      const sr = b.w * (0.15 + srng() * 0.25);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, `rgba(246,240,226,${0.08 + srng() * 0.07})`);
      g.addColorStop(1, 'rgba(246,240,226,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    }
  }

  if (b.strata) strataLines(ctx, b, makeRNG(b.strata.seed));

  // chipped corner: exposed inner stone, in shadow
  if (b.chip) {
    const [cx, cy] = chipCorner(b);
    const chipSize = b.w * b.chip.size;
    chipPath(ctx, b, cx, cy, chipSize);
    ctx.fillStyle = `hsl(${b.hue - 3} ${Math.max(6, b.sat - 8)}% ${Math.max(26, b.light - 17)}%)`;
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(20,13,8,0.30)';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,244,220,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // soot / dirt staining on some blocks
  if (b.dirty) {
    const drng = makeRNG(b.seed + 17);
    for (let i = 0; i < 5; i++) {
      const dx = b.x + drng() * b.w;
      const dy = b.y + drng() * b.h;
      const dr = b.w * (0.15 + drng() * 0.35);
      const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, dr);
      g.addColorStop(0, `rgba(52,38,22,${(0.03 + drng() * 0.05) * b.dirty})`);
      g.addColorStop(1, 'rgba(52,38,22,0)');
      ctx.fillStyle = g;
      ctx.fillRect(dx - dr, dy - dr, dr * 2, dr * 2);
    }
  }

  // wind-blown dust settling in the lower part of every block
  const dust = ctx.createLinearGradient(0, b.y + b.h * 0.62, 0, b.y + b.h);
  dust.addColorStop(0, 'rgba(92,70,44,0)');
  dust.addColorStop(1, 'rgba(92,70,44,0.15)');
  ctx.fillStyle = dust;
  ctx.fillRect(b.x, b.y + b.h * 0.62, b.w, b.h * 0.38);

  // fine grit speckle across the face
  for (let i = 0; i < 26; i++) {
    const gx = b.x + rng() * b.w;
    const gy = b.y + rng() * b.h;
    const gr = 0.4 + rng() * 1.1;
    ctx.fillStyle = rng() > 0.5 ? `rgba(250,240,220,${0.08 + rng() * 0.16})` : `rgba(60,42,24,${0.06 + rng() * 0.12})`;
    ctx.beginPath();
    ctx.arc(gx, gy, gr, 0, TAU);
    ctx.fill();
  }

  ctx.restore();

  // crisp bevel: lit top/left edge, shadowed bottom/right edge + contact AO
  const bevelLight = 1.2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(b.x + 3, b.y + 1.6);
  ctx.lineTo(b.x + b.w - 3, b.y + 1.6);
  ctx.moveTo(b.x + 1.6, b.y + 3);
  ctx.lineTo(b.x + 1.6, b.y + b.h - 3);
  ctx.lineWidth = bevelLight;
  ctx.strokeStyle = 'rgba(255,248,228,0.18)';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(b.x + 2, b.y + b.h - 1.8);
  ctx.lineTo(b.x + b.w - 2, b.y + b.h - 1.8);
  ctx.moveTo(b.x + b.w - 1.8, b.y + 2);
  ctx.lineTo(b.x + b.w - 1.8, b.y + b.h - 2);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = 'rgba(22,14,8,0.26)';
  ctx.stroke();
  ctx.restore();
}

/** Draw every block (plus the wrapped copies that cross the tile border). */
function drawMasonryBlocks(ctx, blocks) {
  for (const b of blocks) {
    wrapDraw(ctx, S, b.x, b.y, b.w + 14, (c) => drawBlockAlbedo(c, b));
  }
}

// ---------------------------------------------------------------------------
// height
// ---------------------------------------------------------------------------
function drawBlockHeight(ctx, b) {
  const rng = makeRNG(b.seed + 5);
  ctx.save();
  blockPath(ctx, b);
  ctx.clip();
  const cx = b.x + b.w * 0.5;
  const cy = b.y + b.h * 0.5;
  const rad = Math.max(b.w, b.h) * 0.9;
  const hi = Math.round(clamp(b.top, 0, 1) * 255);
  const lo = Math.round(clamp(b.top * 0.35, 0, 1) * 255);
  const g = ctx.createRadialGradient(cx, cy, rad * 0.55, cx, cy, rad);
  g.addColorStop(0, `rgb(${hi},${hi},${hi})`);
  g.addColorStop(0.8, `rgb(${Math.round(hi * 0.92)},${Math.round(hi * 0.92)},${Math.round(hi * 0.92)})`);
  g.addColorStop(1, `rgb(${lo},${lo},${lo})`);
  ctx.fillStyle = g;
  ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);

  overlayNoise(ctx, HEIGHT_SIZE, HEIGHT_SIZE, { tile: 256, seed: b.seed % 991, alpha: 0.14, scale: 1, mode: 'overlay' });

  if (b.pits) {
    const prng = makeRNG(b.pits.seed + 1);
    for (let i = 0; i < b.pits.count; i++) {
      const px = b.x + 6 + prng() * (b.w - 12);
      const py = b.y + 6 + prng() * (b.h - 12);
      const r = 0.6 + prng() * 2.2;
      ctx.fillStyle = 'rgba(18,18,18,0.8)';
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * (0.5 + prng() * 0.6), prng() * TAU, 0, TAU);
      ctx.fill();
    }
  }

  if (b.strata) {
    const srng = makeRNG(b.strata.seed + 1);
    const bands = b.strata.count;
    const step = b.h / (bands + 1);
    for (let i = 0; i < bands; i++) {
      const y0 = b.y + step * (i + 1) + (srng() - 0.5) * step * 0.55;
      const bh = 10 + srng() * 30;
      const g2 = ctx.createLinearGradient(0, y0 - bh, 0, y0 + bh);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(0.5, `rgba(18,18,18,${0.05 + srng() * 0.07})`);
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(b.x, y0 - bh, b.w, bh * 2);
      if (srng() > 0.4) {
        const amp = 0.5 + srng() * 1.6;
        const freq = 1 + srng() * 1.8;
        const phase = srng() * TAU;
        ctx.beginPath();
        for (let px = b.x; px <= b.x + b.w; px += 12) {
          const t = (px - b.x) / b.w;
          const py = y0 + Math.sin(t * TAU * freq + phase) * amp;
          if (px === b.x) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.lineWidth = 1.4 + srng() * 2.2;
        ctx.strokeStyle = 'rgba(8,8,8,0.6)';
        ctx.stroke();
      }
    }
  }

  // chipped corner sits below the block face
  if (b.chip) {
    const [ccx, ccy] = chipCorner(b);
    chipPath(ctx, b, ccx, ccy, b.w * b.chip.size);
    ctx.fillStyle = 'rgb(46,46,46)';
    ctx.fill();
  }
  ctx.restore();
  void rng;
}

// ---------------------------------------------------------------------------
// roughness
// ---------------------------------------------------------------------------
function drawBlockRough(ctx, b) {
  ctx.save();
  blockPath(ctx, b);
  ctx.clip();
  const v = Math.round(b.rough * 255);
  ctx.fillStyle = `rgb(${v},${v},${v})`;
  ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
  // eroded / dusty blocks are a touch rougher near the edges
  const cx = b.x + b.w * 0.5;
  const cy = b.y + b.h * 0.5;
  const rad = Math.max(b.w, b.h) * 0.7;
  const g = ctx.createRadialGradient(cx, cy, rad * 0.35, cx, cy, rad);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, `rgba(250,250,250,${0.08 + b.worn * 0.14})`);
  ctx.fillStyle = g;
  ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
  overlayNoise(ctx, S, S, { tile: 256, seed: b.seed % 983, alpha: 0.12, scale: 1, mode: 'overlay' });
  if (b.pits) {
    const prng = makeRNG(b.pits.seed + 3);
    for (let i = 0; i < b.pits.count; i++) {
      const px = b.x + 6 + prng() * (b.w - 12);
      const py = b.y + 6 + prng() * (b.h - 12);
      const r = 0.6 + prng() * 2.2;
      ctx.fillStyle = 'rgba(248,248,248,0.85)';
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * (0.5 + prng() * 0.6), prng() * TAU, 0, TAU);
      ctx.fill();
    }
  }
  if (b.chip) {
    const [ccx, ccy] = chipCorner(b);
    chipPath(ctx, b, ccx, ccy, b.w * b.chip.size);
    ctx.fillStyle = 'rgb(246,246,246)';
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------
export function makeStone(aniso, reg) {
  const rng = makeRNG(4242);
  const blocks = buildAshlar(rng);
  const mortar = '#655340';

  // ---- albedo -------------------------------------------------------------
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  fillCanvas(ctx, S, S, mortar);

  // mortar grit: pale sand grains caught in the joints
  {
    const grng = makeRNG(911);
    for (let i = 0; i < 1200; i++) {
      const px = grng() * S;
      const py = grng() * S;
      const r = 0.4 + grng() * 1.5;
      ctx.fillStyle = `rgba(${192 + grng() * 40},${170 + grng() * 34},${132 + grng() * 30},${0.18 + grng() * 0.3})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.fill();
    }
  }
  drawMasonryBlocks(ctx, blocks);

  // ---- large-scale weathering (seamless) ----------------------------------
  const wrng = makeRNG(2024);
  for (let i = 0; i < 16; i++) {
    const x = wrng() * S;
    const y = wrng() * S;
    const r = 80 + wrng() * 320;
    const dark = wrng() > 0.45;
    wrapDraw(ctx, S, x, y, r + 8, (c) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, dark ? `rgba(46,32,18,${0.05 + wrng() * 0.08})` : `rgba(250,240,218,${0.04 + wrng() * 0.07})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  // faint vertical rain streaks
  {
    const srng = makeRNG(77);
    for (let i = 0; i < 12; i++) {
      const x = srng() * S;
      const y0 = srng() * S * 0.4;
      const len = S * (0.3 + srng() * 0.5);
      wrapDraw(ctx, S, x, y0 + len * 0.5, len * 0.5 + 40, (c) => {
        const g = c.createLinearGradient(x, y0, x + (srng() - 0.5) * 30, y0 + len);
        g.addColorStop(0, 'rgba(44,32,20,0)');
        g.addColorStop(0.4, `rgba(44,32,20,${0.05 + srng() * 0.05})`);
        g.addColorStop(1, 'rgba(44,32,20,0)');
        c.strokeStyle = g;
        c.lineWidth = 3 + srng() * 10;
        c.beginPath();
        c.moveTo(x, y0);
        c.lineTo(x + (srng() - 0.5) * 30, y0 + len);
        c.stroke();
      });
    }
  }
  // fine airborne grit across the whole wall
  {
    const grng = makeRNG(1771);
    for (let i = 0; i < 5200; i++) {
      const px = grng() * S;
      const py = grng() * S;
      const r = 0.3 + grng() * 1.0;
      ctx.fillStyle = grng() > 0.5 ? `rgba(250,242,224,${0.05 + grng() * 0.13})` : `rgba(52,36,20,${0.04 + grng() * 0.11})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.fill();
    }
  }
  overlayNoise(ctx, S, S, { tile: 256, seed: 61, alpha: 0.12, scale: 1, mode: 'overlay' });
  overlayGrain(ctx, S, S, { alpha: 0.10, seed: 62 });

  // ---- height -------------------------------------------------------------
  const height = el(HEIGHT_SIZE, HEIGHT_SIZE);
  const hctx = ctxOf(height);
  fillCanvas(hctx, HEIGHT_SIZE, HEIGHT_SIZE, 'rgb(56,56,56)');
  for (const b of blocks) {
    wrapDraw(hctx, HEIGHT_SIZE, b.x, b.y, b.w + 14, (c) => drawBlockHeight(c, b));
  }
  overlayNoise(hctx, HEIGHT_SIZE, HEIGHT_SIZE, { tile: 256, seed: 63, alpha: 0.15, scale: 1, mode: 'overlay' });
  overlayGrain(hctx, HEIGHT_SIZE, HEIGHT_SIZE, { alpha: 0.08, seed: 64 });

  // ---- roughness ----------------------------------------------------------
  const rough = el(S, S);
  const rctx = ctxOf(rough);
  fillCanvas(rctx, S, S, 'rgb(247,247,247)'); // recessed joints stay dusty/rough
  for (const b of blocks) {
    wrapDraw(rctx, S, b.x, b.y, b.w + 14, (c) => drawBlockRough(c, b));
  }
  overlayNoise(rctx, S, S, { tile: 256, seed: 65, alpha: 0.10, scale: 1, mode: 'overlay' });
  overlayGrain(rctx, S, S, { alpha: 0.06, seed: 66 });

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, NORMAL_STRENGTH, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
