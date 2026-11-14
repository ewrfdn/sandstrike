/**
 * ISLAND VILLAGE — V6 SPIRIT TOTEM (木雕图腾) — P1.
 *
 * The village guardian post: a three-tier carved hardwood totem on a volcanic
 * stone plinth. Every feature is cut with real geometry (brow ridges, bulging
 * eyes, fangs, chevron and diamond bands, a bird-spirit head with a beak) rather
 * than painted on, so the carvings keep their depth in raking dawn light. Moss
 * has moved onto the shoulders and the base, and peeled bark / old offerings sit
 * on the small altar shelf at the front.
 *
 * Conventions: metres, +Y up, the face looks toward -Z; model bottom on y = 0.
 * Triangle budget (stage): 2,000–4,000.
 */
import * as THREE from 'three';
import { matrixFor } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { cylGeo, latheGeo, plateGeo, rockGeo, rodGeo, sphereGeo, torusGeo, tubeGeo } from '../detail.js';

// ---------------------------------------------------------------------------
// vertex-colour tinting
// ---------------------------------------------------------------------------
// The shared stone / soil / timber materials are declared `vertexColors: true`.
// The stage batcher merges every piece of one material key into a single merged
// geometry; a merged geometry WITHOUT a `color` attribute feeds the shader a
// black default, which is why the isolated model stage showed the ruins as
// burnt-black blocks. Every geometry handed to one of these keys therefore gets
// an explicit colour attribute -- a flat per-piece tint that also breaks the
// "one block cloned N times" look. (In-game the batcher re-bakes the attribute
// into its own ground AO, so the geometry-side tint is the stage/authoring fix.)
const VC_KEYS = new Set([
  'mossStone', 'ruinStone', 'ruinStoneDark', 'stone', 'mud', 'leafLitter',
  'beachSand', 'barkMoss', 'barkTrop', 'wood', 'woodDark', 'driftWood',
  'jungleGrass', 'sand', 'sandDark', 'shoreRock',
]);

function vcHash(n, salt = 0) {
  const v = Math.sin(n * 91.7 + salt * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}

/** Flat RGB tint written into a geometry's vertex-colour attribute. */
function paintTint(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Per-vertex tint from a callback `(x, y, z, i) => [r, g, b]` (wet bands, cracks). */
function gradientTint(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Deterministic per-piece albedo jitter: 0.90...1.08 value + a warm/cool bias. */
function tintAt(x, y, z, key) {
  const n = vcHash(x * 12.7 + y * 7.3 + z * 5.1, 41);
  const w = vcHash(z * 9.3 + x * 3.7 + y * 1.3, 42) - 0.5;
  const base = key === 'mossStone' ? 0.93 : key === 'ruinStoneDark' ? 0.97 : 1.0;
  const v = base * (0.9 + n * 0.18);
  const warm = w * 0.06;
  return [v * (1 + warm), v * (1 - warm * 0.2), v * (1 - warm)];
}

/** Ensure a vertex-tinted material key carries a colour attribute. */
function prepareTint(geo, x = 0, y = 0, z = 0, key = '', tint = null) {
  if (!VC_KEYS.has(key) || geo.attributes.color) return geo;
  if (tint) {
    if (typeof tint === 'function') gradientTint(geo, tint);
    else paintTint(geo, tint[0], tint[1], tint[2]);
  } else {
    paintTint(geo, ...tintAt(x, y, z, key));
  }
  return geo;
}

export const meta = { id: 'spirit-totem', kind: 'world', group: 'village', label: '木雕图腾 · SPIRIT TOTEM' };

// ---------------------------------------------------------------------------
// Local batcher helper
// ---------------------------------------------------------------------------
function gfx(ctx, base) {
  const add = (key, geo, mx) => {
    // per-piece colour tint: a merged vertex-coloured batch without a `color`
    // attribute renders black in the stage preview; the tint also breaks up the
    // "same board repeated" look of the walls and roofs.
    prepareTint(geo, mx ? mx.elements[12] : 0, mx ? mx.elements[13] : 0, mx ? mx.elements[14] : 0, key);
    ctx.batcher.add(key, geo, mx ? base.clone().multiply(mx) : base);
    geo.dispose();
  };
  return {
    frame(x, y, z, ry = 0) {
      return gfx(ctx, base.clone().multiply(matrixFor(x, y, z, 0, ry, 0)));
    },
    plate(key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, opts) {
      add(key, plateGeo(w, h, d, opts), matrixFor(x, y, z, rx, ry, rz));
    },
    cyl(key, rTop, rBottom, h, x, y, z, rx = 0, ry = 0, rz = 0, opts) {
      add(key, cylGeo(rTop, rBottom, h, opts), matrixFor(x, y, z, rx, ry, rz));
    },
    lathe(key, profile, x, y, z, rx = 0, ry = 0, rz = 0, opts) {
      add(key, latheGeo(profile, opts), matrixFor(x, y, z, rx, ry, rz));
    },
    rod(key, ax, ay, az, bx, by, bz, r, opts) {
      add(key, rodGeo(ax, ay, az, bx, by, bz, r, opts));
    },
    ring(key, R, r, x, y, z, rx = 0, ry = 0, rz = 0, opts) {
      add(key, torusGeo(R, r, opts), matrixFor(x, y, z, rx, ry, rz));
    },
    ball(key, r, x, y, z, rx = 0, ry = 0, rz = 0, opts = {}) {
      add(key, sphereGeo(r, opts), matrixFor(x, y, z, rx, ry, rz, opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1));
    },
    rock(key, r, x, y, z, opts) {
      add(key, rockGeo(r, opts), matrixFor(x, y, z));
    },
  };
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------
export function build(ctx) {
  island(ctx).totems = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildTotems(ctx);
}

export function buildWorld(ctx) {
  buildTotems(ctx);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildTotems(ctx) {
  const items = island(ctx).totems || [];
  if (!items.length) return;
  const hi = ctx.stage === true;
  items.forEach((item, i) => buildTotem(ctx, item, hi, 9310 + i * 61));
}

// ---------------------------------------------------------------------------
// One totem
// ---------------------------------------------------------------------------
function buildTotem(ctx, item, hi, seed) {
  const s = item.s ?? 1;
  const g = gfx(ctx, matrixFor(item.x ?? 0, item.y ?? 0, item.z ?? 0, 0, item.ry ?? 0, 0, s, s, s));
  const rng = makeRNG(seed);
  const j = (a) => (rng() * 2 - 1) * a;

  buildPlinth(g, hi, rng, j);
  buildTier1(g, hi, rng, j);   // 0.62 – 1.62  (bestial face)
  buildTier2(g, hi, rng, j);   // 1.62 – 2.45  (geometric band)
  buildTier3(g, hi, rng, j);   // 2.45 – 3.36  (bird-spirit head)
  buildMossAndRope(g, hi, rng, j);
  buildAltar(g, hi, rng, j);
}

// ---------------------------------------------------------------------------
// Stone plinth
// ---------------------------------------------------------------------------
function buildPlinth(g, hi, rng, j) {
  // two dry-stone slabs, the lower one slightly askew
  g.plate('mossStone', 0.98, 0.26, 0.9, 0, 0.13, 0, 0, 0.05, 0.008, { bevel: 0.02, tile: 1.7 });
  g.plate('mossStone', 0.82, 0.2, 0.78, 0, 0.36, 0.01, 0, -0.06, -0.006, { bevel: 0.02, tile: 1.6 });
  g.plate('ruinStoneDark', 0.72, 0.12, 0.7, 0, 0.52, 0.01, 0, 0.02, 0, { bevel: 0.014, tile: 1.4 });
  // corner blocks and wedges
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.plate('mossStone', 0.2, 0.16, 0.2, sx * 0.44, 0.2, sz * 0.4, 0, sx * sz * 0.2, j(0.05), {
      bevel: 0.014,
      tile: 1.4,
    });
  }
  if (hi) {
    // chipped flakes and a wedge stone at the base
    g.plate('ruinStoneDark', 0.16, 0.06, 0.2, 0.46, 0.04, 0.22, 0, 0.7, 0.1, { bevel: 0.008, tile: 1.2 });
    g.plate('ruinStoneDark', 0.22, 0.09, 0.14, -0.38, 0.05, -0.34, 0, -0.4, 0.06, { bevel: 0.008, tile: 1.2 });
  }
}

// ---------------------------------------------------------------------------
// Tier 1 — broad carved face (brow, eyes, nose, fanged mouth)
// ---------------------------------------------------------------------------
function buildTier1(g, hi, rng, j) {
  const y0 = 0.62;
  const h = 1.0;
  const cy = y0 + h / 2;
  // carved trunk block
  g.plate('woodDark', 0.54, h, 0.46, 0, cy, 0, 0, 0, 0.008, { bevel: 0.02, tile: 1.3 });
  // side cheeks / jowls
  for (const sx of [-1, 1]) {
    g.plate('wood', 0.12, 0.78, 0.34, sx * 0.31, cy - 0.06, -0.04, 0, 0, sx * 0.03, { bevel: 0.016, tile: 1.2 });
    // ear tabs
    g.plate('woodDark', 0.14, 0.2, 0.12, sx * 0.3, cy + 0.4, 0.02, 0.2, 0, sx * 0.3, { bevel: 0.01, tile: 1.0 });
  }
  // heavy brow ridge over the eyes
  g.plate('wood', 0.5, 0.13, 0.16, 0, cy + 0.28, -0.26, 0.12, 0, 0, { bevel: 0.014, tile: 1.2 });
  for (const sx of [-1, 1]) {
    // bulging eye socket and eyeball
    g.plate('wood', 0.2, 0.2, 0.1, sx * 0.13, cy + 0.16, -0.25, 0, 0, 0, { bevel: 0.02, tile: 1.0 });
    g.ball('wood', 0.085, sx * 0.13, cy + 0.16, -0.31, 0, 0, 0, { segW: 10, segH: 7, tile: 0.7 });
    // sunken socket ring behind the eyeball so the eye reads as carved-in shadow
    g.plate('dark', 0.22, 0.22, 0.02, sx * 0.13, cy + 0.16, -0.245, 0, 0, 0, { bevel: 0.004, tile: 0.8 });
    // carved pupil: a small dark disc set into the eyeball
    g.cyl('dark', 0.034, 0.034, 0.03, sx * 0.13, cy + 0.16, -0.365, Math.PI / 2, 0, 0, { radial: 8, tile: 0.5 });
  }
  // nose bridge + flared nostrils
  g.plate('wood', 0.13, 0.34, 0.14, 0, cy - 0.05, -0.31, 0.08, 0, 0, { bevel: 0.012, tile: 1.0 });
  for (const sx of [-1, 1]) {
    g.plate('woodDark', 0.1, 0.08, 0.08, sx * 0.09, cy - 0.2, -0.32, 0, 0, sx * 0.2, { bevel: 0.01, tile: 0.9 });
  }
  // mouth: recessed dark slot with a lip and four fangs
  g.plate('dark', 0.4, 0.16, 0.04, 0, cy - 0.34, -0.3, 0, 0, 0, { bevel: 0.006, tile: 1.0 });
  g.plate('wood', 0.44, 0.06, 0.1, 0, cy - 0.43, -0.28, 0, 0, 0, { bevel: 0.01, tile: 1.0 });
  for (const sx of [-1, 1]) {
    for (const dx of [0.07, 0.16]) {
      g.cyl('stone', 0.028, 0.012, 0.13, sx * dx, cy - 0.34, -0.33, Math.PI, 0, sx * 0.12, { radial: 5, tile: 0.6 });
    }
  }
  // chin / jaw shelf
  g.plate('woodDark', 0.34, 0.12, 0.14, 0, cy - 0.52, -0.24, 0.1, 0, 0, { bevel: 0.012, tile: 1.1 });
  // BACK of tier 1 is not a blank board any more: a shallower second carving
  // (60 % of the front relief depth) with a brow, two sunken eyes and a chevron
  // band (audit D-22).
  g.plate('wood', 0.44, 0.09, 0.1, 0, cy + 0.28, 0.24, -0.1, 0, 0, { bevel: 0.01, tile: 1.1 });
  for (const sx of [-1, 1]) {
    g.plate('dark', 0.17, 0.13, 0.03, sx * 0.13, cy + 0.16, 0.235, 0, 0, 0, { bevel: 0.005, tile: 0.9 });
    g.plate('wood', 0.12, 0.06, 0.06, sx * 0.13, cy + 0.08, 0.225, 0.12, 0, sx * 0.2, { bevel: 0.006, tile: 0.9 });
  }
  for (let i = 0; i < 4; i++) {
    g.plate('woodDark', 0.05, 0.13, 0.04, -0.16 + i * 0.105, cy - 0.22, 0.225, 0, 0, i % 2 ? 0.6 : -0.6, {
      bevel: 0.005,
      tile: 0.8,
    });
  }
  // carved vertical grooves on the sides of the trunk
  if (hi) {
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        g.plate('woodDark', 0.03, 0.7, 0.06, sx * 0.28, cy - 0.1, -0.1 + i * 0.2, 0, 0, 0, { bevel: 0.004, tile: 0.8 });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tier 2 — geometric carved band (chevrons, diamonds, grooves)
// ---------------------------------------------------------------------------
function buildTier2(g, hi, rng, j) {
  const y0 = 1.66;
  const h = 0.8;
  const cy = y0 + h / 2;
  g.plate('woodDark', 0.44, h, 0.38, 0, cy, 0.01, 0, 0.02, -0.006, { bevel: 0.018, tile: 1.2 });
  // horizontal separating collars
  g.plate('wood', 0.5, 0.09, 0.44, 0, y0 + 0.02, 0, 0, 0.01, 0, { bevel: 0.014, tile: 1.1 });
  g.plate('wood', 0.48, 0.08, 0.42, 0, y0 + h - 0.01, 0.01, 0, -0.01, 0, { bevel: 0.014, tile: 1.1 });
  // chevron band across the front
  for (let i = 0; i < 5; i++) {
    const cxi = -0.16 + i * 0.08;
    g.plate('wood', 0.055, 0.16, 0.05, cxi, cy + 0.1, -0.2, 0, 0, i < 2 ? 0.7 : i > 2 ? -0.7 : 0, { bevel: 0.006, tile: 0.8 });
  }
  // diamond studs on the sides
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      g.plate('wood', 0.1, 0.1, 0.05, sx * 0.22, cy - 0.18 + i * 0.32, -0.05, 0, 0, Math.PI / 4, { bevel: 0.008, tile: 0.7 });
    }
  }
  // back: the same geometric band carried round in shallow relief, plus the deep
  // binding slot (audit D-22: the BACK view used to be a plain board)
  g.plate('dark', 0.16, 0.34, 0.03, 0, cy, 0.2, 0, 0, 0, { bevel: 0.005, tile: 0.9 });
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      g.plate(i === 1 ? 'woodDark' : 'wood', 0.1, 0.1, 0.035,
        sx * 0.17, cy - 0.2 + i * 0.2, 0.205, 0, 0, Math.PI / 4, { bevel: 0.006, tile: 0.7 });
    }
  }
  for (let i = 0; i < 3; i++) {
    g.plate('woodDark', 0.05, 0.13, 0.03, -0.1 + i * 0.1, cy + 0.22, 0.205, 0, 0, i === 1 ? 0 : 0.7, {
      bevel: 0.004,
      tile: 0.7,
    });
  }
  if (hi) {
    // pegs / plugs left in the carving
    for (const [px, py] of [[-0.14, cy + 0.28], [0.15, cy - 0.26]]) {
      g.cyl('woodDark', 0.03, 0.034, 0.04, px, py, 0.18, Math.PI / 2, 0, 0, { radial: 6, tile: 0.5 });
    }
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — bird-spirit head with a beak and crest
// ---------------------------------------------------------------------------
function buildTier3(g, hi, rng, j) {
  const y0 = 2.46;
  const h = 0.72;
  const cy = y0 + h / 2;
  // head block, tapering slightly
  g.plate('woodDark', 0.42, h, 0.36, 0, cy, 0, 0, 0, 0.004, { bevel: 0.018, tile: 1.2 });
  // brow and slanted eyes
  g.plate('wood', 0.4, 0.09, 0.1, 0, cy + 0.2, -0.19, 0.1, 0, 0, { bevel: 0.012, tile: 1.0 });
  for (const sx of [-1, 1]) {
    g.plate('wood', 0.14, 0.09, 0.05, sx * 0.1, cy + 0.12, -0.2, 0, 0, sx * -0.28, { bevel: 0.008, tile: 0.8 });
    g.cyl('dark', 0.022, 0.022, 0.02, sx * 0.1, cy + 0.12, -0.226, Math.PI / 2, 0, 0, { radial: 6, tile: 0.4 });
  }
  // beak: stacked tapering blocks hooking down toward -Z
  g.plate('wood', 0.2, 0.16, 0.18, 0, cy - 0.02, -0.26, 0.16, 0, 0, { bevel: 0.014, tile: 1.0 });
  g.cyl('wood', 0.015, 0.1, 0.3, 0, cy - 0.16, -0.36, 1.25, 0, 0, { radial: 6, tile: 0.9 });
  // crest feathers: fanned plates on top
  for (let i = 0; i < 5; i++) {
    const a = -0.7 + i * 0.35;
    g.plate(i % 2 ? 'wood' : 'woodDark', 0.06, 0.34 + (i === 2 ? 0.1 : 0), 0.03,
      0, cy + h / 2 + 0.12, 0.02, 0.15, 0, a, { bevel: 0.006, tile: 0.8 });
  }
  // side feathers: instead of one long "cross" arm per side (the silhouette read
  // as a scarecrow / crucifix) each side is a short fan of three carved feather
  // blades, 30 % narrower, so the top of the totem reads as a bird crest (D-22)
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const fan = -0.34 + i * 0.34;
      g.plate(i === 1 ? 'woodDark' : 'wood', 0.17 - Math.abs(i - 1) * 0.03, 0.075, 0.12,
        sx * (0.27 + i * 0.05), cy + 0.1 + fan * 0.06, 0.03 + i * 0.02,
        0, 0, sx * (0.18 + fan * 0.5), { bevel: 0.008, tile: 0.9 });
    }
    // carved tail feathers hanging below the crest
    for (let i = 0; i < 2; i++) {
      g.plate('wood', 0.05, 0.32, 0.03, sx * 0.34, cy - 0.26, 0.1 + i * 0.06, 0.1, 0, sx * (0.28 + i * 0.1), {
        bevel: 0.005,
        tile: 0.8,
      });
    }
  }
  // small jaw with fangs under the beak
  g.plate('woodDark', 0.2, 0.09, 0.14, 0, cy - 0.26, -0.16, 0.1, 0, 0, { bevel: 0.01, tile: 1.0 });
  for (const sx of [-1, 1]) {
    g.cyl('stone', 0.018, 0.008, 0.08, sx * 0.06, cy - 0.32, -0.2, Math.PI, 0, 0, { radial: 4, tile: 0.5 });
  }
}

// ---------------------------------------------------------------------------
// Moss, lashings and a rope collar with feathers
// ---------------------------------------------------------------------------
function buildMossAndRope(g, hi, rng, j) {
  // rope collar wedged between tiers 1 and 2
  g.ring('rope', 0.24, 0.028, 0, 1.63, 0, Math.PI / 2, 0, 0.05, { radialSeg: 5, tubularSeg: 12, tile: 0.8 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    // knotted rope ends hanging down
    g.cyl('rope', 0.012, 0.008, 0.16 + rng() * 0.1, Math.sin(a) * 0.24, 1.54, Math.cos(a) * 0.24, 0.1, a, 0.12, {
      radial: 4,
      tile: 0.5,
    });
  }
  // feathers tucked into the collar
  for (let i = 0; i < 3; i++) {
    const a = -0.9 + i * 0.55;
    g.plate(i % 2 ? 'wood' : 'thatchDark', 0.06, 0.26, 0.02, Math.sin(a) * 0.22, 1.5, -Math.cos(a) * 0.22, 0.4, a, 0.2, {
      bevel: 0.004,
      tile: 0.6,
    });
  }
  // moss islands on the shoulders and the plinth
  const mossSpots = [
    [-0.3, 1.64, 0.06, 0.16],
    [0.34, 1.68, 0.02, 0.12],
    [0.0, 2.46, -0.1, 0.14],
    [-0.42, 0.54, 0.2, 0.13],
    [0.36, 0.5, -0.26, 0.11],
    [-0.2, 0.2, -0.38, 0.12],
  ];
  for (let i = 0; i < mossSpots.length; i++) {
    const [mx, my, mz, mr] = mossSpots[i];
    g.rock('mossStone', mr, mx, my, mz, { detail: 0, seed: 50 + i * 3, flatten: 0.35, tile: 1.0 });
  }
  if (hi) {
    // a vine creeping up the back of the post (leaf cards)
    g.plate('woodDark', 0.02, 1.1, 0.02, 0.12, 1.1, 0.2, 0, 0, 0.1, { bevel: 0.003, tile: 0.6 });
  }
}

// ---------------------------------------------------------------------------
// Altar shelf with offerings (shells, coconut husks, a little bowl)
// ---------------------------------------------------------------------------
function buildAltar(g, hi, rng, j) {
  const ax = 0;
  const az = -0.66;
  // low wooden shelf in front of the plinth
  g.plate('wood', 0.8, 0.07, 0.4, ax, 0.42, az, 0, 0.03, 0.008, { bevel: 0.012, tile: 1.1 });
  for (const sx of [-1, 1]) {
    g.plate('woodDark', 0.08, 0.4, 0.08, ax + sx * 0.32, 0.2, az, 0, 0, sx * 0.06, { bevel: 0.008, tile: 0.9 });
  }
  // woven mat under the offerings
  g.plate('woven', 0.7, 0.012, 0.34, ax, 0.462, az, 0, 0.03, 0, { bevel: 0.004, tile: 1.0 });
  // shells: small flared lathe cups
  const shells = [
    [-0.22, 0.5, az - 0.06, 0.09, 0.5],
    [0.13, 0.5, az - 0.09, 0.075, -0.4],
    [0.04, 0.5, az + 0.08, 0.06, 1.1],
  ];
  for (const [sx, sy, sz, sc, ry] of shells) {
    // warm bone / shell tone instead of the chalky white "eggs" (audit D-22)
    g.lathe('ruinStoneDark', [
      [0.02, 0],
      [0.07 * sc / 0.08, 0.01],
      [0.1 * sc / 0.08, 0.05],
      [0.08 * sc / 0.08, 0.09],
      [0.03, 0.1],
      [0.01, 0.1],
    ], sx, sy, sz, 0.12, ry, 0, { segments: 7, tile: 0.5 });
  }
  // coconut husks: squashed spheres with a small stem
  g.ball('woodDark', 0.085, -0.03, 0.55, az + 0.06, 0, 0.3, 0, { segW: 8, segH: 6, sy: 0.82, tile: 0.6 });
  g.cyl('woodDark', 0.012, 0.012, 0.05, -0.03, 0.63, az + 0.06, 0, 0, 0, { radial: 4, tile: 0.4 });
  g.ball('wood', 0.07, 0.27, 0.53, az + 0.02, 0, -0.6, 0, { segW: 8, segH: 6, sy: 0.8, tile: 0.6 });
  // small offering bowl
  g.lathe('thatchDark', [
    [0.02, 0],
    [0.06, 0],
    [0.1, 0.03],
    [0.115, 0.08],
    [0.1, 0.09],
    [0.08, 0.085],
  ], 0.28, 0.5, az + 0.1, 0, 0.6, 0, { segments: 9, tile: 0.5 });
  // a bundle of dried leaves / feathers tied to the shelf post
  g.plate('thatchDark', 0.06, 0.22, 0.02, -0.34, 0.6, az - 0.02, 0.2, 0.4, 0.25, { bevel: 0.004, tile: 0.6 });
  g.ring('rope', 0.05, 0.012, -0.32, 0.66, az, Math.PI / 2, 0, 0, { radialSeg: 4, tubularSeg: 5, tile: 0.4 });
  // ground offerings: leaf litter + two small stones
  for (let i = 0; i < (hi ? 3 : 2); i++) {
    g.plate('leafLitter', 0.14 + rng() * 0.1, 0.012, 0.11 + rng() * 0.07,
      -0.5 + rng() * 1.0, 0.02, -0.75 + rng() * 0.4, 0, rng() * Math.PI, j(0.04), { bevel: 0.003, tile: 0.9 });
  }
  g.rock('mossStone', 0.1, 0.42, 0.09, -0.62, { detail: 0, seed: 77, flatten: 0.5, tile: 1.1 });
  void rodGeo;
  void tubeGeo;
  void j;
}
