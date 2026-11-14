/**
 * SANDSTRIKE // island bamboo texture set  (lib.bamboo)
 *
 * Used by materials: bamboo  (fence poles, drying racks, walkway frames, walls)
 *
 * Sun-bleached village bamboo. Direction convention (ISLAND_ASSETS.md §3.2):
 * **V = culm length**, so the node rings run across U (they wrap around the
 * pole) and the fibre grain runs along V. 512 x 1024 px, 1 tile = 1.2 m, i.e.
 * four internodes (~30 cm each) per tile. U wraps seamlessly around the culm;
 * V wraps too (the tile border cuts a node ring in half, so the repeat reads as
 * the next internode).
 *
 * Weathering per the colour script: dry yellow-green #a9a86a -> #8d8c55 with a
 * grey cast, brown speckles, soot/smoke smudges from village fires.
 *
 * Texture set contract:
 *   map            albedo        sRGB
 *   normalMap      tangent space  linear (Sobel height canvas)
 *   roughnessMap   linear        (waxy culm is smoother than the nodes)
 *
 * Everything here is drawn with Canvas2D at load time; tune the TUNING block.
 */
import { clamp, makeRNG } from '../utils.js';
import { TAU, ctxOf, el, fillCanvas, normalFromHeightCanvas, overlayGrain, overlayNoise, textureFromCanvas } from './core.js';

// ---------------------------------------------------------------------------
// TUNING
// ---------------------------------------------------------------------------
const W = 512;              // U = around the culm
const H = 1024;             // V = along the culm (1 tile = 1.2 m)
const NORMAL_STRENGTH = 3.0;

const NODES = 4;            // node rings per tile (0.3 m internodes)
const FIBRES = 620;         // longitudinal fibre strokes
const SPOTS = 90;           // brown speckles
const SMOKE = 3;            // soot / smoke smudges
const SOOT_STREAKS = 10;

// palette (ISLAND_ASSETS.md §1.2)
const BAMBOO = [169, 168, 106];   // #a9a86a
const BAMBOO_GREY = [141, 140, 85]; // #8d8c55
const BAMBOO_PALE = [207, 203, 142];
const BAMBOO_DARK = [104, 102, 58];
const NODE_PALE = [214, 208, 150];
const NODE_DARK = [74, 71, 40];
const SPOT = [106, 84, 52];
const SMOKE_COL = [26, 25, 22];

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

// ---------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------
function repeatDraw(ctx, w, h, x, y, padX, padY, draw) {
  const xs = [0];
  if (x < padX) xs.push(w);
  if (x > w - padX) xs.push(-w);
  const ys = [0];
  if (padY > 0) {
    if (y < padY) ys.push(h);
    if (y > h - padY) ys.push(-h);
  }
  for (const dx of xs) {
    for (const dy of ys) {
      ctx.save();
      ctx.translate(dx, dy);
      draw(ctx);
      ctx.restore();
    }
  }
}

/** Gentle horizontal wobble of a node ring; integral harmonics keep U seamless. */
function ringWave(node, x) {
  const u = x / W;
  return Math.sin(TAU * (u * node.k1) + node.p1) * node.a1 + Math.sin(TAU * (u * node.k2) + node.p2) * node.a2;
}

/** Band with a wavy centre line, filled as one polygon (no seam at x=0/W). */
function waveBandPath(ctx, node, y, half) {
  ctx.beginPath();
  for (let x = 0; x <= W; x += 8) {
    const yy = y + ringWave(node, x) - half;
    if (x === 0) ctx.moveTo(x, yy);
    else ctx.lineTo(x, yy);
  }
  for (let x = W; x >= 0; x -= 8) {
    const yy = y + ringWave(node, x) + half;
    ctx.lineTo(x, yy);
  }
  ctx.closePath();
}

/** Stroke a wavy horizontal line across the full width. */
function waveLine(ctx, node, y, dx = 0) {
  ctx.beginPath();
  for (let x = 0; x <= W; x += 8) {
    const yy = y + ringWave(node, x) + dx;
    if (x === 0) ctx.moveTo(x, yy);
    else ctx.lineTo(x, yy);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

/** Node rings at every internode boundary, including both tile edges (0 and H)
 *  so a full ring is formed when the tile repeats in V. */
function buildLayout() {
  const rng = makeRNG(6120);
  const nodes = [];
  for (let k = 0; k <= NODES; k++) {
    nodes.push({
      y: (k * H) / NODES,
      index: k % NODES,
      a1: 0.8 + rng() * 1.8,
      k1: 1 + Math.floor(rng() * 2),
      p1: rng() * TAU,
      a2: 0.4 + rng() * 1.1,
      k2: 3 + Math.floor(rng() * 3),
      p2: rng() * TAU,
      h: 7.5 + rng() * 3,
      seed: Math.floor(rng() * 1e9),
    });
  }

  // internode colour drift (period repeats with NODES so the tile matches)
  const internodes = [];
  for (let k = 0; k < NODES; k++) {
    const r = makeRNG(9000 + k * 97);
    internodes.push({
      index: k,
      y0: (k * H) / NODES,
      y1: ((k + 1) * H) / NODES,
      pale: r(),
      green: r(),
      mottle: r(),
    });
  }

  const fibres = [];
  const frng = makeRNG(3311);
  for (let i = 0; i < FIBRES; i++) {
    const len = 70 + frng() * 420;
    fibres.push({
      x: frng() * W,
      y: frng() * H,
      len,
      amp: (frng() - 0.5) * 3.4,
      k: 1 + Math.floor(frng() * 3),
      ph: frng() * TAU,
      width: 0.5 + frng() * 1.6,
      tone: frng(),
      alpha: 0.12 + frng() * 0.32,
    });
  }

  const spots = [];
  const srng = makeRNG(5511);
  for (let i = 0; i < SPOTS; i++) {
    const nearNode = srng() < 0.5;
    const node = nodes[1 + Math.floor(srng() * (NODES - 1))];
    spots.push({
      x: srng() * W,
      y: nearNode ? node.y + (srng() - 0.5) * 90 : srng() * H,
      rx: 1.2 + srng() * 3.4,
      ry: 3 + srng() * 13,
      tilt: (srng() - 0.5) * 0.5,
      tone: srng(),
      seed: Math.floor(srng() * 1e9),
    });
  }

  const smoke = [];
  const mrng = makeRNG(7711);
  for (let i = 0; i < SMOKE; i++) {
    smoke.push({
      x: mrng() * W,
      y: mrng() * H,
      rx: 50 + mrng() * 130,
      ry: 70 + mrng() * 260,
      a: 0.045 + mrng() * 0.075,
      seed: Math.floor(mrng() * 1e9),
    });
  }

  const soot = [];
  for (let i = 0; i < SOOT_STREAKS; i++) {
    soot.push({
      x: mrng() * W,
      y: mrng() * H,
      len: 40 + mrng() * 180,
      w: 3 + mrng() * 14,
      a: 0.05 + mrng() * 0.1,
    });
  }

  return { nodes, internodes, fibres, spots, smoke, soot };
}

// ---------------------------------------------------------------------------
// albedo
// ---------------------------------------------------------------------------
function internodeBase(c) {
  // dry yellow-green with a grey cast; internodes drift in value so the culm is
  // not one flat colour
  const g = mix(BAMBOO, BAMBOO_GREY, c.green);
  return mix(g, c.pale > 0.5 ? BAMBOO_PALE : BAMBOO_DARK, Math.abs(c.pale - 0.5) * 0.72);
}

function drawInternodeAlbedo(ctx, c) {
  const base = internodeBase(c);
  const g = ctx.createLinearGradient(0, c.y0, 0, c.y1);
  g.addColorStop(0, css(mix(base, BAMBOO_DARK, 0.28)));
  g.addColorStop(0.18, css(base));
  g.addColorStop(0.55, css(mix(base, BAMBOO_PALE, 0.2)));
  g.addColorStop(0.9, css(mix(base, BAMBOO_GREY, 0.28)));
  g.addColorStop(1, css(mix(base, BAMBOO_DARK, 0.32)));
  ctx.fillStyle = g;
  ctx.fillRect(0, c.y0, W, c.y1 - c.y0);

  // broad vertical mottling: sun-bleached streaks and damp green patches
  const r = makeRNG(4200 + c.index * 31);
  for (let i = 0; i < 40; i++) {
    const x = r() * W;
    const y = c.y0 + r() * (c.y1 - c.y0);
    const rx = 10 + r() * 70;
    const ry = (c.y1 - c.y0) * (0.15 + r() * 0.55);
    const pale = r() > 0.5;
    const a = pale ? 0.06 + r() * 0.1 : 0.05 + r() * 0.09;
    const col = pale ? BAMBOO_PALE : mix(BAMBOO_GREY, BAMBOO_DARK, 0.5);
    repeatDraw(ctx, W, H, x, y, rx + 10, ry + 10, (cx) => {
      cx.save();
      cx.translate(x, y);
      cx.scale(1, ry / Math.max(rx, 1));
      const g2 = cx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g2.addColorStop(0, css(col, a));
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g2;
      cx.fillRect(-rx, -rx, rx * 2, rx * 2);
      cx.restore();
    });
  }
}

function drawFibresAlbedo(ctx, fibres) {
  for (const f of fibres) {
    const light = f.tone > 0.5;
    const col = light ? mix(BAMBOO_PALE, [236, 232, 186], f.tone - 0.5) : mix(BAMBOO_DARK, BAMBOO_GREY, f.tone * 2);
    const padX = Math.abs(f.amp) * 2 + 8;
    repeatDraw(ctx, W, H, f.x, f.y, padX, f.len * 0.5 + 12, (cx) => {
      cx.strokeStyle = css(col, f.alpha);
      cx.lineWidth = f.width;
      cx.beginPath();
      cx.moveTo(f.x, f.y - f.len * 0.5);
      for (let s = 1; s <= 8; s++) {
        const t = s / 8;
        const yy = f.y - f.len * 0.5 + f.len * t;
        cx.lineTo(f.x + Math.sin(TAU * (t * f.k) + f.ph) * f.amp, yy);
      }
      cx.stroke();
    });
  }
}

function drawSpotsAlbedo(ctx, spots) {
  for (const s of spots) {
    const rng = makeRNG(s.seed);
    const base = mix(SPOT, BAMBOO_DARK, s.tone * 0.7);
    repeatDraw(ctx, W, H, s.x, s.y, s.rx + 10, s.ry + 10, (cx) => {
      cx.save();
      cx.translate(s.x, s.y);
      cx.rotate(s.tilt);
      cx.fillStyle = css(base, 0.42 + rng() * 0.38);
      cx.beginPath();
      cx.ellipse(0, 0, s.rx, s.ry, 0, 0, TAU);
      cx.fill();
      cx.fillStyle = css(mix(base, BAMBOO_DARK, 0.5), 0.3 + rng() * 0.2);
      cx.beginPath();
      cx.ellipse(0, 0, s.rx * 0.5, s.ry * 0.6, 0, 0, TAU);
      cx.fill();
      cx.strokeStyle = css(BAMBOO_PALE, 0.18 + rng() * 0.16);
      cx.lineWidth = 0.8;
      cx.beginPath();
      cx.ellipse(0.4, 0.6, s.rx * 1.12, s.ry * 1.06, 0, 0, TAU);
      cx.stroke();
      cx.restore();
    });
  }
}

function drawSmokeAlbedo(ctx, smoke, sootStreaks) {
  for (const s of smoke) {
    const rng = makeRNG(s.seed);
    repeatDraw(ctx, W, H, s.x, s.y, s.rx + 12, s.ry + 12, (cx) => {
      for (let i = 0; i < 5; i++) {
        const ox = (rng() - 0.5) * s.rx * 0.8;
        const oy = (rng() - 0.5) * s.ry * 0.6;
        const rr = s.rx * (0.45 + rng() * 0.7);
        const a1 = s.a * (0.7 + rng() * 0.6);
        cx.save();
        cx.translate(s.x + ox, s.y + oy);
        cx.scale(1, s.ry / s.rx);
        const g = cx.createRadialGradient(0, 0, 0, 0, 0, rr);
        g.addColorStop(0, css(SMOKE_COL, a1));
        g.addColorStop(0.7, css(SMOKE_COL, a1 * 0.45));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        cx.fillStyle = g;
        cx.fillRect(-rr, -rr, rr * 2, rr * 2);
        cx.restore();
      }
    });
  }
  // soot streaks running down the culm
  const srng = makeRNG(3312);
  for (const st of sootStreaks) {
    const drift = (srng() - 0.5) * 4;
    repeatDraw(ctx, W, H, st.x, st.y + st.len * 0.5, st.w + 16, st.len * 0.5 + 20, (cx) => {
      const g = cx.createLinearGradient(st.x, st.y, st.x, st.y + st.len);
      g.addColorStop(0, 'rgba(30,28,24,0)');
      g.addColorStop(0.4, `rgba(30,28,24,${st.a})`);
      g.addColorStop(1, 'rgba(30,28,24,0)');
      cx.strokeStyle = g;
      cx.lineWidth = st.w;
      cx.beginPath();
      cx.moveTo(st.x, st.y);
      cx.lineTo(st.x + drift, st.y + st.len);
      cx.stroke();
    });
  }
}

function drawNodeAlbedo(ctx, node) {
  const rng = makeRNG(node.seed);
  // shadow the node ring throws down the culm
  ctx.save();
  ctx.fillStyle = 'rgba(24,22,10,0.42)';
  waveBandPath(ctx, node, node.y + node.h * 1.1, node.h * 1.5);
  ctx.fill();
  ctx.restore();

  // sheath scar: dark groove just above the ring
  ctx.fillStyle = 'rgba(44,40,18,0.7)';
  waveBandPath(ctx, node, node.y - node.h * 1.5, 2 + rng() * 1.4);
  ctx.fill();

  // the ring itself: pale, slightly glossy collar
  const g = ctx.createLinearGradient(0, node.y - node.h * 1.3, 0, node.y + node.h * 1.3);
  g.addColorStop(0, css(mix(NODE_DARK, BAMBOO, 0.4), 0.95));
  g.addColorStop(0.35, css(NODE_PALE, 0.95));
  g.addColorStop(0.6, css(mix(NODE_PALE, BAMBOO_PALE, 0.35), 0.95));
  g.addColorStop(1, css(mix(NODE_DARK, BAMBOO_DARK, 0.5), 0.9));
  ctx.save();
  waveBandPath(ctx, node, node.y, node.h);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  // dark hairline in the middle of the ring
  ctx.strokeStyle = 'rgba(66,62,32,0.5)';
  ctx.lineWidth = 1.1;
  waveLine(ctx, node, node.y + node.h * 0.05);
  // lit upper lip
  ctx.strokeStyle = css(mix(NODE_PALE, [244, 240, 198], 0.6), 0.5);
  ctx.lineWidth = 1.4;
  waveLine(ctx, node, node.y - node.h * 0.72);
  // ragged wax flecks around the ring
  for (let i = 0; i < 26; i++) {
    const x = rng() * W;
    const yy = node.y + (rng() - 0.5) * node.h * 2.6;
    const rr = 1 + rng() * 3.6;
    ctx.fillStyle = rng() > 0.5 ? css(NODE_PALE, 0.2 + rng() * 0.3) : `rgba(60,56,28,${0.14 + rng() * 0.22})`;
    ctx.beginPath();
    ctx.arc(x, yy, rr, 0, TAU);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// height
// ---------------------------------------------------------------------------
function drawNodeHeight(ctx, node) {
  const rng = makeRNG(node.seed + 3);
  // shadowed culm right under the ring
  ctx.fillStyle = 'rgba(44,44,44,0.55)';
  waveBandPath(ctx, node, node.y + node.h * 1.4, node.h * 1.4);
  ctx.fill();

  // groove above
  ctx.fillStyle = 'rgba(38,38,38,0.7)';
  waveBandPath(ctx, node, node.y - node.h * 1.6, 1.6 + rng() * 1.2);
  ctx.fill();

  // ring: rounded ridge
  const g = ctx.createLinearGradient(0, node.y - node.h * 1.4, 0, node.y + node.h * 1.4);
  g.addColorStop(0, 'rgb(120,120,120)');
  g.addColorStop(0.3, 'rgb(238,238,238)');
  g.addColorStop(0.55, 'rgb(226,226,226)');
  g.addColorStop(1, 'rgb(96,96,96)');
  ctx.save();
  waveBandPath(ctx, node, node.y, node.h);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

function drawFibresHeight(ctx, fibres) {
  for (const f of fibres) {
    const v = Math.round(f.tone > 0.5 ? 176 + f.tone * 60 : 96 + f.tone * 50);
    const padX = Math.abs(f.amp) * 2 + 8;
    repeatDraw(ctx, W, H, f.x, f.y, padX, f.len * 0.5 + 12, (cx) => {
      cx.strokeStyle = `rgba(${v},${v},${v},${f.alpha + 0.14})`;
      cx.lineWidth = f.width;
      cx.beginPath();
      cx.moveTo(f.x, f.y - f.len * 0.5);
      for (let s = 1; s <= 8; s++) {
        const t = s / 8;
        const yy = f.y - f.len * 0.5 + f.len * t;
        cx.lineTo(f.x + Math.sin(TAU * (t * f.k) + f.ph) * f.amp, yy);
      }
      cx.stroke();
    });
  }
}

function drawSpotsHeight(ctx, spots) {
  for (const s of spots) {
    repeatDraw(ctx, W, H, s.x, s.y, s.rx + 10, s.ry + 10, (cx) => {
      cx.save();
      cx.translate(s.x, s.y);
      cx.rotate(s.tilt);
      cx.fillStyle = 'rgba(70,70,70,0.6)';
      cx.beginPath();
      cx.ellipse(0, 0, s.rx, s.ry, 0, 0, TAU);
      cx.fill();
      cx.strokeStyle = 'rgba(214,214,214,0.35)';
      cx.lineWidth = 1;
      cx.beginPath();
      cx.ellipse(0.5, 0.7, s.rx * 1.15, s.ry * 0.7, 0, 0, TAU);
      cx.stroke();
      cx.restore();
    });
  }
}

// ---------------------------------------------------------------------------
// roughness
// ---------------------------------------------------------------------------
function drawNodeRough(ctx, node) {
  ctx.fillStyle = 'rgb(196,196,196)';
  waveBandPath(ctx, node, node.y, node.h * 1.15);
  ctx.fill();
  ctx.fillStyle = 'rgb(224,224,224)';
  waveBandPath(ctx, node, node.y - node.h * 1.5, node.h * 0.5);
  ctx.fill();
}

function drawSmokeRough(ctx, smoke) {
  for (const s of smoke) {
    repeatDraw(ctx, W, H, s.x, s.y, s.rx + 12, s.ry + 12, (cx) => {
      const g = cx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.rx);
      g.addColorStop(0, `rgba(214,214,214,${s.a * 2.2})`);
      g.addColorStop(1, 'rgba(214,214,214,0)');
      cx.save();
      cx.translate(s.x, s.y);
      cx.scale(1, s.ry / s.rx);
      cx.fillStyle = g;
      cx.fillRect(-s.rx, -s.rx, s.rx * 2, s.rx * 2);
      cx.restore();
    });
  }
}

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------
export function makeBamboo(aniso, reg) {
  const { nodes, internodes, fibres, spots, smoke, soot } = buildLayout();

  // ---- albedo -------------------------------------------------------------
  const albedo = el(W, H);
  const ctx = ctxOf(albedo);
  fillCanvas(ctx, W, H, css(BAMBOO));
  for (const c of internodes) drawInternodeAlbedo(ctx, c);
  drawFibresAlbedo(ctx, fibres);
  drawSpotsAlbedo(ctx, spots);
  for (const n of nodes) drawNodeAlbedo(ctx, n);
  drawSmokeAlbedo(ctx, smoke, soot);
  overlayNoise(ctx, W, H, { tile: 256, seed: 821, alpha: 0.14, scale: 1, mode: 'overlay' });
  overlayGrain(ctx, W, H, { alpha: 0.11, seed: 822 });

  // ---- height -------------------------------------------------------------
  const height = el(W, H);
  const hctx = ctxOf(height);
  fillCanvas(hctx, W, H, 'rgb(150,150,150)');
  // subtle culm curvature: brighter middle of every internode
  for (const c of internodes) {
    const g = hctx.createLinearGradient(0, c.y0, 0, c.y1);
    g.addColorStop(0, 'rgba(30,30,30,0.45)');
    g.addColorStop(0.25, 'rgba(30,30,30,0)');
    g.addColorStop(0.75, 'rgba(30,30,30,0)');
    g.addColorStop(1, 'rgba(30,30,30,0.45)');
    hctx.fillStyle = g;
    hctx.fillRect(0, c.y0, W, c.y1 - c.y0);
  }
  for (const n of nodes) drawNodeHeight(hctx, n);
  drawFibresHeight(hctx, fibres);
  drawSpotsHeight(hctx, spots);
  overlayNoise(hctx, W, H, { tile: 256, seed: 823, alpha: 0.14, scale: 1, mode: 'overlay' });
  overlayGrain(hctx, W, H, { alpha: 0.09, seed: 824 });

  // ---- roughness ----------------------------------------------------------
  const rough = el(W, H);
  const rctx = ctxOf(rough);
  fillCanvas(rctx, W, H, 'rgb(138,138,138)'); // waxy culm
  for (const n of nodes) drawNodeRough(rctx, n);
  for (const s of spots) {
    repeatDraw(rctx, W, H, s.x, s.y, s.rx + 10, s.ry + 10, (cx) => {
      cx.save();
      cx.translate(s.x, s.y);
      cx.rotate(s.tilt);
      cx.fillStyle = 'rgba(186,186,186,0.7)';
      cx.beginPath();
      cx.ellipse(0, 0, s.rx, s.ry, 0, 0, TAU);
      cx.fill();
      cx.restore();
    });
  }
  drawSmokeRough(rctx, smoke);
  // broad damp patches a touch glossier
  {
    const rng = makeRNG(1919);
    for (let i = 0; i < 10; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const rr = 40 + rng() * 120;
      repeatDraw(rctx, W, H, x, y, rr + 8, rr + 8, (cx) => {
        const g = cx.createRadialGradient(x, y, 0, x, y, rr);
        g.addColorStop(0, `rgba(96,96,96,${0.1 + rng() * 0.14})`);
        g.addColorStop(1, 'rgba(96,96,96,0)');
        cx.fillStyle = g;
        cx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      });
    }
  }
  overlayNoise(rctx, W, H, { tile: 256, seed: 825, alpha: 0.09, scale: 1, mode: 'overlay' });
  overlayGrain(rctx, W, H, { alpha: 0.07, seed: 826 });

  return {
    map: reg(textureFromCanvas(albedo, { aniso })),
    normalMap: reg(normalFromHeightCanvas(height, NORMAL_STRENGTH, aniso)),
    roughnessMap: reg(textureFromCanvas(rough, { srgb: false, aniso })),
  };
}
