/**
 * SANDSTRIKE // lush tropical frond texture set  (lib.tropicalFrond)
 *
 * Used by materials: frondLush (coconut palm / banana-ish leaf cards).
 *
 * This is the SAME painted-frond layout as src/textures/palm.js — a central rib
 * that bows from (10,128) to (248,128) through (128,116), with two rows of
 * leaflets fanning up / down — so the existing palm frond geometry (whose
 * `ribBandUV()` samples the rib band around v = 0.5) keeps working unchanged.
 * Only the palette is different: saturated rainforest green with wet highlights
 * and dew instead of the dusty desert olive.
 *
 * Texture set contract:
 *   map            albedo        sRGB (alpha-cut frond on transparent canvas)
 *   normalMap      tangent space  linear (soft leaflet relief)
 *   roughnessMap   linear         (wet leaves glossy, dry tips rough)
 *
 * Everything here is drawn with Canvas2D at load time.
 */
import { clamp, makeRNG } from '../utils.js';
import {
  TAU, ctxOf, el, normalFromHeightCanvas, textureFromCanvas,
} from './core.js';

const S = 256;
const N = 7; // spine samples per leaflet
const STRENGTH = 1.9;

/** Quadratic bezier component. */
function q(a, b, c, t) {
  const u = 1 - t;
  return u * u * a + 2 * u * t * b + t * t * c;
}

/**
 * Filled lanceolate leaflet hugging a quadratic spine (base -> control -> tip).
 * `w` is the half-width at the fattest point; silhouette tapers to a point at
 * both ends. Returns the sampled spine as well so callers can draw veins.
 */
function leafletPath(ctx, ax, ay, cx, cy, tx, ty, w) {
  const left = [];
  const right = [];
  const spine = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const px = q(ax, cx, tx, s);
    const py = q(ay, cy, ty, s);
    const dx = 2 * (1 - s) * (cx - ax) + 2 * s * (tx - cx);
    const dy = 2 * (1 - s) * (cy - ay) + 2 * s * (ty - cy);
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L;
    const ny = dx / L;
    const hw = w * Math.pow(Math.sin(Math.PI * s), 0.72) * (1 - 0.25 * s);
    left.push([px + nx * hw, py + ny * hw]);
    right.push([px - nx * hw, py - ny * hw]);
    spine.push([px, py]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i <= N; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = N; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  return spine;
}

/** Draw the rib (a thick, reliably opaque band the palm UVs sample). */
function ribStops() {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push([q(10, 128, 248, t), 128 - 24 * t * (1 - t)]);
  }
  return pts;
}

/** Build the deterministic leaflet layout (shared by the albedo + height passes). */
function buildLeaflets(rng) {
  const rib = ribStops();
  const out = [];
  for (let i = 0; i < 27; i++) {
    const t = i / 26;
    const x = 15 + t * 225;
    // rib height at this x: invert the x parameterisation well enough for a rib
    const tr = clamp((x - 10) / 238, 0, 1);
    const yRib = 128 - 24 * tr * (1 - tr);
    const len = 30 + Math.sin(t * Math.PI) * 78 + rng() * 10;
    for (const dir of [-1, 1]) {
      const tipY = clamp(yRib + dir * len, 8, 248);
      const tipX = Math.min(250, x + 16 + rng() * 14 + len * 0.10);
      out.push({
        ax: x,
        ay: yRib + dir * 2.6,
        cx: x + 9 + rng() * 4,
        cy: clamp(yRib + dir * len * 0.56, 6, 250),
        tx: tipX,
        ty: tipY,
        w: 4.2 + rng() * 2.6,
        hue: 92 + rng() * 24,
        sat: 30 + rng() * 24,
        light: 23 + rng() * 13,
        dry: rng(),
      });
    }
  }
  return { rib, leaflets: out };
}

export function makeTropicalFrond(aniso, reg) {
  const albedo = el(S, S);
  const ctx = ctxOf(albedo);
  const rng = makeRNG(8899); // palm.js seed: same station layout as the old frond
  const { rib, leaflets } = buildLeaflets(rng);

  // ---- leaves ------------------------------------------------------------
  // dark under-shadow first so overlapping leaflets separate
  for (const l of leaflets) {
    ctx.save();
    ctx.translate(1.1, 0.9);
    leafletPath(ctx, l.ax, l.ay, l.cx, l.cy, l.tx, l.ty, l.w);
    ctx.fillStyle = `hsla(${l.hue - 8}, ${l.sat + 6}%, ${Math.max(12, l.light - 10)}%, 0.55)`;
    ctx.fill();
    ctx.restore();
  }

  for (const l of leaflets) {
    ctx.save();
    leafletPath(ctx, l.ax, l.ay, l.cx, l.cy, l.tx, l.ty, l.w);
    const grad = ctx.createLinearGradient(l.ax, l.ay, l.tx, l.ty);
    grad.addColorStop(0, `hsl(${l.hue - 6}, ${l.sat + 4}%, ${Math.max(14, l.light - 7)}%)`);
    grad.addColorStop(0.45, `hsl(${l.hue}, ${l.sat}%, ${l.light + 4}%)`);
    grad.addColorStop(1, `hsl(${l.hue + 6}, ${l.sat + 8}%, ${l.light + 12}%)`);
    ctx.fillStyle = grad;
    ctx.fill();

    // darker rim inside the leaflet (keeps the alpha silhouette clean)
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = `hsla(${l.hue - 14}, ${l.sat}%, ${Math.max(10, l.light - 12)}%, 0.55)`;
    ctx.stroke();

    // spine vein: dark groove + light ridge
    ctx.beginPath();
    ctx.moveTo(l.ax, l.ay);
    ctx.quadraticCurveTo(l.cx, l.cy, l.tx, l.ty);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = `hsla(${l.hue + 4}, ${l.sat + 10}%, ${Math.max(10, l.light - 14)}%, 0.42)`;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(l.ax - 0.7, l.ay - 0.5);
    ctx.quadraticCurveTo(l.cx - 0.7, l.cy - 0.5, l.tx - 0.7, l.ty - 0.5);
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = `hsla(${l.hue + 12}, ${l.sat + 18}%, ${l.light + 20}%, 0.38)`;
    ctx.stroke();

    // dry / tattered tip on some older leaflets
    if (l.dry > 0.82) {
      ctx.save();
      leafletPath(ctx, l.ax, l.ay, l.cx, l.cy, l.tx, l.ty, l.w);
      ctx.clip();
      const g2 = ctx.createLinearGradient(l.tx - 26, l.ty - 26, l.tx, l.ty);
      g2.addColorStop(0, 'hsla(48, 30%, 40%, 0)');
      g2.addColorStop(1, 'hsla(46, 34%, 38%, 0.55)');
      ctx.fillStyle = g2;
      ctx.fillRect(l.tx - 34, l.ty - 34, 68, 68);
      ctx.restore();
    }
    ctx.restore();
  }

  // ---- central rib (the opaque band the palm UVs sample) -------------------
  const ribGrad = ctx.createLinearGradient(8, 0, 250, 0);
  ribGrad.addColorStop(0, 'hsl(103, 34%, 26%)');
  ribGrad.addColorStop(0.35, 'hsl(98, 38%, 31%)');
  ribGrad.addColorStop(1, 'hsl(94, 40%, 34%)');
  ctx.strokeStyle = ribGrad;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(rib[0][0], rib[0][1]);
  for (let i = 1; i < rib.length; i++) ctx.lineTo(rib[i][0], rib[i][1]);
  ctx.stroke();
  // raised core + shadowed underside
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'hsl(96, 44%, 39%)';
  ctx.stroke();
  ctx.save();
  ctx.translate(0, 2.6);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'hsla(105, 40%, 15%, 0.5)';
  ctx.stroke();
  ctx.restore();
  // fine side veins running from rib to each leaflet base
  ctx.lineWidth = 0.7;
  for (const l of leaflets) {
    ctx.strokeStyle = `hsla(${l.hue + 16}, ${l.sat + 22}%, ${l.light + 26}%, 0.30)`;
    ctx.beginPath();
    ctx.moveTo(l.ax, l.ay);
    ctx.quadraticCurveTo(l.cx * 0.55 + l.ax * 0.45, l.cy, l.tx * 0.2 + l.ax * 0.8, l.ty * 0.2 + l.ay * 0.8);
    ctx.stroke();
  }

  // ---- wet highlights & dew (source-atop: never paints into empty space) ---
  // one shared dew layout for albedo + roughness so the specular spots line up
  const dewRng = makeRNG(8823);
  const dew = [];
  for (let i = 0; i < 26; i++) {
    dew.push({ x: 20 + dewRng() * 216, y: 22 + dewRng() * 212, r: 0.9 + dewRng() * 2.3 });
  }
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  // broad wet sheen along the crown of the frond
  for (let i = 0; i < 9; i++) {
    const x = 40 + rng() * 190;
    const y = 40 + rng() * 176;
    const r = 18 + rng() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const pale = rng() > 0.45;
    g.addColorStop(0, pale ? 'rgba(204,240,168,0.13)' : 'rgba(20,46,18,0.15)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // dew droplets: soft bloom + hot specular dot + dark contact edge
  for (const drop of dew) {
    const { x, y, r } = drop;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
    g.addColorStop(0, 'rgba(226,248,206,0.42)');
    g.addColorStop(0.45, 'rgba(190,230,164,0.16)');
    g.addColorStop(1, 'rgba(190,230,164,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    ctx.fillStyle = 'rgba(20,34,14,0.22)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.35, y + r * 0.5, r * 0.8, r * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(248,255,240,0.85)';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.42, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // ---- height (soft leaflet relief for the normal map) ---------------------
  const height = el(S, S);
  const hctx = ctxOf(height);
  // mid-grey base: transparent background, so only the silhouette edge matters
  const hasFilter = typeof hctx.filter === 'string';
  hctx.fillStyle = 'rgb(150,150,150)';
  hctx.fillRect(0, 0, S, S);
  hctx.lineCap = 'round';
  hctx.strokeStyle = 'rgb(206,206,206)';
  hctx.lineWidth = 7;
  hctx.beginPath();
  hctx.moveTo(rib[0][0], rib[0][1]);
  for (let i = 1; i < rib.length; i++) hctx.lineTo(rib[i][0], rib[i][1]);
  hctx.stroke();
  if (hasFilter) hctx.filter = 'blur(0.8px)';
  for (const l of leaflets) {
    leafletPath(hctx, l.ax, l.ay, l.cx, l.cy, l.tx, l.ty, l.w);
    hctx.fillStyle = 'rgb(194,194,194)';
    hctx.fill();
    // raised spine ridge
    hctx.beginPath();
    hctx.moveTo(l.ax, l.ay);
    hctx.quadraticCurveTo(l.cx, l.cy, l.tx, l.ty);
    hctx.lineWidth = 1.4;
    hctx.strokeStyle = 'rgb(216,216,216)';
    hctx.stroke();
  }
  if (hasFilter) hctx.filter = 'none';

  // ---- roughness (wet leaves glossy, dry tips matte) ----------------------
  const rough = el(S, S);
  const rctx = ctxOf(rough);
  rctx.fillStyle = 'rgb(160,160,160)';
  rctx.fillRect(0, 0, S, S);
  for (const l of leaflets) {
    leafletPath(rctx, l.ax, l.ay, l.cx, l.cy, l.tx, l.ty, l.w);
    const dry = l.dry > 0.82;
    rctx.fillStyle = dry ? 'rgb(214,214,214)' : 'rgb(118,118,118)';
    rctx.fill();
  }
  rctx.strokeStyle = 'rgb(104,104,104)';
  rctx.lineWidth = 7;
  rctx.beginPath();
  rctx.moveTo(rib[0][0], rib[0][1]);
  for (let i = 1; i < rib.length; i++) rctx.lineTo(rib[i][0], rib[i][1]);
  rctx.stroke();
  // dew droplets read as tight glossy beads (same layout as the albedo dew)
  rctx.fillStyle = 'rgb(58,58,58)';
  for (const drop of dew) {
    const r = drop.r;
    rctx.beginPath();
    rctx.ellipse(drop.x, drop.y, r, r * 0.8, 0, 0, TAU);
    rctx.fill();
  }

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, STRENGTH, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
