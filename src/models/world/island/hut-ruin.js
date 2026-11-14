/**
 * ISLAND VILLAGE — V2 HUT RUIN (破败茅屋).
 *
 * The same stilt-hut family as `thatch-hut`, but one storm and a couple of
 * seasons later: two stilts are sheared off, the front half of the deck has
 * fallen in, the front slope of the thatch roof has caved, and ferns and vines
 * are already moving into the wreck. Charred beams and a few ember-red coals
 * mark an old fire in the collapse.
 *
 * Conventions: metres, +Y up, front faces -Z, model bottom on y = 0.
 * Triangle budget (stage): 6,000–10,000.
 */
import * as THREE from 'three';
import { matrixFor } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { leafQuad } from './leaf-atlas.js';
import {
  cylGeo,
  latheGeo,
  plateGeo,
  rockGeo,
  rodGeo,
  sphereGeo,
  torusGeo,
  tubeGeo,
} from '../detail.js';

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

export const meta = { id: 'hut-ruin', kind: 'world', group: 'village', label: '破败茅屋 · HUT RUIN' };

// ---------------------------------------------------------------------------
// Dimensions (metres)
// ---------------------------------------------------------------------------
const FLOOR = 1.12;
const DECK_X = 2.55;
const WALL_FRONT = -1.95;
const WALL_BACK = 1.75;
const WALL_X = 2.5;
const WALL_TOP = 3.05;
const EAVE_Y = 3.18;
const RIDGE_Y = 4.32;
const RIDGE_Z = -0.1;
const ROOF_X = 3.0;
const EAVE_ZF = -2.95;
const EAVE_ZB = 2.58;

/** [x, z, top y, broken] — two stilts are snapped, the rest still carry the deck. */
const POSTS = [
  [-2.15, -1.45, 1.1, false],
  [2.15, -1.45, 0.52, true],
  [-2.15, 1.45, 1.08, false],
  [2.15, 1.45, 0.72, true],
];

// ---------------------------------------------------------------------------
// Local batcher helper (same pattern as thatch-hut)
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
    base,
    frame(x, y, z, ry = 0) {
      return gfx(ctx, base.clone().multiply(matrixFor(x, y, z, 0, ry, 0)));
    },
    add(key, geo, mx) {
      add(key, geo, mx);
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
    /** Alpha leaf card from the shared broadleaf atlas (fern / broad / vine cells). */
    leaf(key, w, h, cell, x, y, z, rx = 0, ry = 0, rz = 0, opts) {
      add(key, leafQuad(w, h, cell, opts), matrixFor(x, y, z, rx, ry, rz));
    },
  };
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------
export function build(ctx) {
  island(ctx).hutRuins = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildHutRuins(ctx);
}

export function buildWorld(ctx) {
  buildHutRuins(ctx);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildHutRuins(ctx) {
  const items = island(ctx).hutRuins || [];
  if (!items.length) return;
  const hi = ctx.stage === true;
  items.forEach((item, i) => buildRuin(ctx, item, hi, 7710 + i * 53));
}

// ---------------------------------------------------------------------------
// One ruin
// ---------------------------------------------------------------------------
function buildRuin(ctx, item, hi, seed) {
  const s = item.s ?? 1;
  const g = gfx(ctx, matrixFor(item.x ?? 0, item.y ?? 0, item.z ?? 0, 0, item.ry ?? 0, 0, s, s, s));
  const rng = makeRNG(seed);
  const j = (a) => (rng() * 2 - 1) * a;

  buildStumps(g, hi, rng, j);
  buildDeckWreck(g, hi, rng, j);
  buildWalls(g, hi, rng, j);
  buildRoofWreck(g, hi, rng, j);
  buildCharredCollapse(g, hi, rng, j);
  buildBundles(g, hi, rng, j);
  buildUnderstory(g, hi, rng, j);
  buildGround(g, hi, rng, j);
}

// ---------------------------------------------------------------------------
// Stumps: footing stones, sheared posts, splinted stubs, one leaning post
// ---------------------------------------------------------------------------
function buildStumps(g, hi, rng, j) {
  let i = 0;
  for (const [px, pz, topY, broken] of POSTS) {
    const seed = 41 + i;
    i++;
    g.rock('mossStone', 0.21, px + j(0.03), 0.13, pz + j(0.03), { detail: 1, seed, flatten: 0.55, tile: 1.4 });
    if (broken) {
      // snapped post: a short splintered stump with jagged top shards
      g.plate('wood', 0.2, topY - 0.1, 0.2, px, 0.1 + (topY - 0.1) / 2, pz, j(0.03), j(0.06), j(0.05), {
        bevel: 0.014,
        tile: 1.2,
      });
      for (let k = 0; k < 3; k++) {
        g.plate('woodDark', 0.055, 0.2 + rng() * 0.16, 0.06, px + j(0.08), topY + 0.06, pz + j(0.08), j(0.3), j(0.4), j(0.25), {
          bevel: 0.006,
          tile: 0.9,
        });
      }
      // rope collar left hanging loose
      g.ring('rope', 0.14, 0.022, px, topY - 0.14, pz, Math.PI / 2 + j(0.2), j(0.3), 0, {
        radialSeg: 4,
        tubularSeg: 7,
        tile: 0.7,
      });
    } else {
      g.plate('wood', 0.22, topY - 0.08, 0.22, px, 0.08 + (topY - 0.08) / 2, pz, j(0.02), j(0.05), j(0.02), {
        bevel: 0.014,
        tile: 1.2,
      });
      g.plate('woodDark', 0.32, 0.1, 0.32, px, topY + 0.02, pz, 0, j(0.15), 0, { bevel: 0.01, tile: 1.1 });
      g.ring('rope', 0.15, 0.022, px, topY - 0.1, pz, Math.PI / 2, 0, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.7 });
    }
  }
  // one post has come completely out and lies in the grass
  g.cyl('wood', 0.11, 0.11, 1.5, 1.35, 0.13, -2.35, 1.52, 0.9, 0.08, { radial: 8, tile: 1.2 });
  g.ring('rope', 0.13, 0.02, 0.95, 0.17, -2.55, 1.52, 1.0, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.6 });
  // fallen diagonal braces
  g.rod('woodDark', -2.15, 0.9, -1.45, -0.9, 0.1, -2.5, 0.05, { radial: 5, tile: 1.1 });
  if (hi) g.rod('woodDark', 2.0, 0.5, 1.4, 2.2, 0.08, 2.35, 0.045, { radial: 5, tile: 1.1 });
}

// ---------------------------------------------------------------------------
// Deck wreck: one girder dropped, front boards have fallen through
// ---------------------------------------------------------------------------
function buildDeckWreck(g, hi, rng, j) {
  // back girder still holding
  g.plate('wood', 5.0, 0.18, 0.17, 0, 1.02, 1.4, 0, 0, -0.012, { bevel: 0.014, tile: 1.3 });
  // front girder has dropped and hangs at an angle
  g.plate('wood', 4.7, 0.17, 0.16, 0.15, 0.86, -1.42, 0.04, 0.05, -0.075, { bevel: 0.014, tile: 1.3 });
  // joists: two still in place, two tipped into the hole
  for (let i = 0; i < 5; i++) {
    const x = -2.15 + i * 1.1;
    if (i === 1 || i === 3) {
      g.plate('woodDark', 0.085, 0.12, 3.6, x, 0.72 + i * 0.02, 0.1, 0.3, j(0.3), 0.12, { bevel: 0.008, tile: 1.1 });
    } else {
      g.plate('woodDark', 0.085, 0.12, 3.9, x, 1.08, -0.05, j(0.02), j(0.05), j(0.02), { bevel: 0.008, tile: 1.1 });
    }
  }
  // surviving back boards
  for (let i = 0; i < 6; i++) {
    const x = -2.15 + i * 0.86;
    g.plate('wood', 0.72, 0.055, 1.9, x, FLOOR - 0.03 + j(0.012), 0.75, j(0.01), j(0.03), j(0.02), {
      bevel: 0.008,
      tile: 1.0,
    });
  }
  // boards that broke off at the front and now lean into the gap: each one is
  // split into two bent segments so it reads as splintered timber, not cardboard
  for (let i = 0; i < 4; i++) {
    const x = -1.9 + i * 1.05 + j(0.1);
    const pitch = -0.55 - i * 0.06;
    g.plate('wood', 0.74, 0.055, 0.8, x, 0.86 + i * 0.02, -0.92, pitch + 0.28, j(0.3), j(0.16), {
      bevel: 0.008,
      tile: 1.0,
    });
    g.plate(i % 2 ? 'woodDark' : 'wood', 0.7, 0.05, 0.7,
      x + j(0.06), 0.6 + i * 0.03, -1.62, pitch - 0.16, j(0.3), j(0.2),
      { bevel: 0.008, tile: 1.0 });
  }
  // two boards have slid all the way to the ground
  g.plate('wood', 0.8, 0.05, 1.6, 0.6, 0.055, -1.15, 0, 0.45, 0.04, { bevel: 0.008, tile: 1.0 });
  g.plate('woodDark', 0.7, 0.05, 1.2, 1.55, 0.06, 0.0, 0, -0.5, -0.03, { bevel: 0.008, tile: 1.0 });
  // dark gap under the surviving floor
  g.plate('dark', 4.6, 0.02, 1.7, 0, 0.93, 0.9, 0, 0, 0, { bevel: 0.006, tile: 1.6 });
}

// ---------------------------------------------------------------------------
// Walls: two leaning woven panels, one jagged half wall, a lone door frame
// ---------------------------------------------------------------------------
function wovenWreck(gf, hi, rng, x0, x1, y0, y1, face, opts = {}) {
  const w = x1 - x0;
  const h = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const r2 = opts.rng || rng;
  // backing mat, patched and sagging
  gf.plate('woven', w, h, 0.04, cx, cy, face * -0.004, 0, 0, (r2() - 0.5) * 0.03, { bevel: 0.01, tile: 1.5 });
  // vertical slats: some missing, some snapped short
  const step = hi ? 0.24 : 0.4;
  const n = Math.max(2, Math.round(w / step));
  for (let i = 0; i < n; i++) {
    if (r2() < 0.18) continue; // gone
    const sx = x0 + ((i + 0.5) / n) * w + (r2() - 0.5) * 0.02;
    const sh = h * (r2() < 0.22 ? 0.4 + r2() * 0.45 : 0.85 + r2() * 0.15);
    const key = r2() < 0.34 ? 'woodDark' : r2() < 0.6 ? 'wood' : 'bamboo';
    gf.plate(key, 0.06 + r2() * 0.03, sh, 0.02, sx, y0 + sh / 2 + 0.02, face * 0.03, 0, 0, (r2() - 0.5) * 0.06, {
      bevel: 0.005,
      tile: 1.0,
    });
  }
  // battens, one hanging loose
  gf.plate('woodDark', w + 0.05, 0.045, 0.026, cx, y0 + h * 0.32, face * 0.055, 0, 0, (r2() - 0.5) * 0.04, {
    bevel: 0.006,
    tile: 1.1,
  });
  if (h > 1.2) {
    gf.plate('woodDark', w * 0.8, 0.04, 0.024, cx - w * 0.1, y0 + h * 0.78, face * 0.06, 0, 0, 0.12, {
      bevel: 0.005,
      tile: 1.0,
    });
  }
}

function buildWalls(g, hi, rng, j) {
  // ---- back wall: leaning pair of panels, the right one has burned short
  const back = g.frame(0, 0, WALL_BACK, 0);
  wovenWreck(back, hi, rng, -WALL_X, -0.3, FLOOR - 0.06, WALL_TOP, 1);
  wovenWreck(back, hi, rng, -0.2, 1.5, FLOOR - 0.06, 2.35, 1);
  // jagged charred top of the burned panel
  for (let i = 0; i < 5; i++) {
    back.plate('woodDark', 0.16 + rng() * 0.12, 0.1 + rng() * 0.3, 0.09, -0.1 + i * 0.36, 2.35 + rng() * 0.12, 0.01, j(0.4), j(0.2), j(0.3), {
      bevel: 0.006,
      tile: 0.9,
    });
  }
  // right end of the back wall has fallen away entirely — a few floating slats
  for (let i = 0; i < 3; i++) {
    back.plate('wood', 0.07, 0.7 + rng() * 0.4, 0.022, 2.0 + i * 0.18, FLOOR + 0.5, 0.06, j(0.3), 0, 0.4 + j(0.2), {
      bevel: 0.005,
      tile: 1.0,
    });
  }

  // ---- right wall: front half collapsed, back half still standing
  const right = g.frame(WALL_X, 0, 0, Math.PI / 2);
  wovenWreck(right, hi, rng, -0.1, 2.0, FLOOR - 0.06, 2.6, 1);
  // jagged remains of the front half
  for (let i = 0; i < 4; i++) {
    right.plate('wood', 0.075, 0.45 + rng() * 0.55, 0.022, -0.35 - i * 0.3, FLOOR + 0.3, 0.05, j(0.35), 0, 0.25 + j(0.2), {
      bevel: 0.005,
      tile: 1.0,
    });
  }

  // ---- front wall: only a door frame and a wall stub on the left survive
  const front = g.frame(0, 0, WALL_FRONT, 0);
  wovenWreck(front, hi, rng, -WALL_X, -1.45, FLOOR - 0.06, 2.05, -1);
  // jagged top of the stub
  for (let i = 0; i < 3; i++) {
    front.plate('woodDark', 0.1, 0.12 + rng() * 0.22, 0.07, -2.2 + i * 0.35, 2.05 + rng() * 0.08, -0.01, j(0.4), 0, j(0.35), {
      bevel: 0.005,
      tile: 0.9,
    });
  }
  // the door frame, still standing but leaning
  g.plate('woodDark', 0.14, 2.0, 0.2, -1.02, FLOOR + 0.95, WALL_FRONT, 0.03, 0, -0.02, { bevel: 0.012, tile: 1.1 });
  g.plate('woodDark', 0.14, 1.85, 0.2, 0.12, FLOOR + 0.9, WALL_FRONT, -0.02, 0, 0.05, { bevel: 0.012, tile: 1.1 });
  g.plate('wood', 1.4, 0.16, 0.22, -0.45, 2.95, WALL_FRONT, 0, 0, 0.03, { bevel: 0.014, tile: 1.2 });
  g.plate('dark', 1.1, 1.8, 0.02, -0.45, FLOOR + 0.9, WALL_FRONT + 0.28, 0, 0, 0, { bevel: 0.005, tile: 1.2 });
  // collapsed front wall: a flat heap of woven matting and broken planks
  for (let i = 0; i < 5; i++) {
    g.plate(i % 2 ? 'wood' : 'woodDark', 0.7 + rng() * 0.4, 0.05, 0.32 + rng() * 0.18,
      0.55 + i * 0.3, 0.07 + i * 0.055, WALL_FRONT - 0.5 + i * 0.12,
      j(0.05), 0.15 + j(0.4), j(0.06), { bevel: 0.008, tile: 1.0 });
  }
  g.plate('woven', 1.1, 0.05, 0.7, 1.5, 0.3, WALL_FRONT - 0.2, 0.06, 0.4, 0.04, { bevel: 0.008, tile: 1.2 });
  g.plate('woven', 0.9, 0.04, 0.55, 1.2, 0.24, WALL_FRONT - 0.42, -0.04, 0.9, 0.03, { bevel: 0.008, tile: 1.2 });

  // ---- left wall is gone: only two charred stumps remain
  for (const [pz, hh] of [[-1.2, 0.75], [0.7, 0.45]]) {
    g.plate('woodDark', 0.17, hh, 0.17, -WALL_X + 0.05, 0.08 + hh / 2, pz, 0.05, 0, 0.08, { bevel: 0.01, tile: 1.1 });
    for (let i = 0; i < 2; i++) {
      g.plate('woodDark', 0.07, 0.12, 0.06, -WALL_X + j(0.1), hh + 0.06, pz + j(0.08), j(0.5), j(0.5), j(0.4), {
        bevel: 0.004,
        tile: 0.8,
      });
    }
  }
  // back corner posts still standing
  for (const sx of [-1, 1]) {
    g.plate('wood', 0.15, WALL_TOP - FLOOR + 0.1, 0.15, sx * WALL_X, (FLOOR + WALL_TOP) / 2, WALL_BACK, 0, 0, sx * 0.007, {
      bevel: 0.012,
      tile: 1.2,
    });
  }
  // top wall plate survived on the back only (sagging in the middle)
  g.plate('woodDark', 4.9, 0.12, 0.14, 0, WALL_TOP + 0.02, WALL_BACK, 0, 0, 0.012, { bevel: 0.01, tile: 1.3 });
}

// ---------------------------------------------------------------------------
// Roof: back slope still thatched, front slope caved in
// ---------------------------------------------------------------------------
function buildRoofWreck(g, hi, rng, j) {
  // back slope: three courses of thatch survive, sagging
  const backLen = Math.hypot(EAVE_Y - RIDGE_Y, EAVE_ZB - RIDGE_Z);
  const backTheta = Math.atan2(EAVE_ZB - RIDGE_Z, EAVE_Y - RIDGE_Y);
  // the backing mat is torn open over the right third: two pieces with a gap
  const backMid = (RIDGE_Y + EAVE_Y) / 2 - 0.02;
  const backZ = (RIDGE_Z + EAVE_ZB) / 2;
  g.plate('thatchDark', ROOF_X * 1.32, backLen, 0.04, -ROOF_X + ROOF_X * 0.66, backMid, backZ,
    backTheta, 0, 0, { bevel: 0.012, tile: 2.0 });
  g.plate('thatchDark', ROOF_X * 0.5, backLen * 0.8, 0.04, ROOF_X * 0.78, backMid + j(0.02), backZ + j(0.04),
    backTheta + j(0.05), 0, j(0.06), { bevel: 0.01, tile: 1.8 });
  for (let c = 0; c < (hi ? 3 : 2); c++) {
    const t = 0.28 + c * 0.31;
    for (let i = 0; i < 6; i++) {
      // tear the right third away in the upper courses: bare rafters show through
      if (i >= 4 && c >= 1 && rng() < 0.8) continue;
      const x = -ROOF_X + (i + 0.5) * (2 * ROOF_X / 6) + j(0.05);
      const w = (2 * ROOF_X / 6) * 1.22 + j(0.06);
      g.plate(c === 0 ? 'thatch' : 'thatchDark', w, backLen * 0.42, 0.055,
        x, RIDGE_Y + (EAVE_Y - RIDGE_Y) * t + j(0.03), RIDGE_Z + (EAVE_ZB - RIDGE_Z) * t + j(0.03),
        backTheta + j(0.05), 0, j(0.1), { bevel: 0.012, tile: 1.7 });
    }
  }
  // rafters exposed by the torn back slope (barkTrop: weathered, not clean gold)
  for (let i = 0; i < 4; i++) {
    const x = ROOF_X * 0.5 + 0.15 + i * 0.62;
    g.rod('barkTrop', x, RIDGE_Y - 0.12, RIDGE_Z + 0.02, x + j(0.1), EAVE_Y + 0.14, EAVE_ZB - 0.05, 0.042, {
      radial: 4,
      tile: 1.1,
    });
  }
  // a couple of torn thatch strips hanging through the gap
  for (let i = 0; i < 3; i++) {
    g.plate('thatchDark', 0.28 + rng() * 0.2, 0.5 + rng() * 0.3, 0.04,
      ROOF_X * 0.55 + i * 0.5 + j(0.1), EAVE_Y + 0.36 - rng() * 0.1, EAVE_ZB - 0.5 + j(0.2),
      backTheta, j(0.4), 1.2 + j(0.3), { bevel: 0.006, tile: 1.1 });
  }
  // back-eave fringe, thinning where it has rotted away
  for (let i = 0; i < 7; i++) {
    if (rng() < 0.3) continue;
    const x = -ROOF_X + 0.25 + i * 0.78 + j(0.1);
    const drop = 0.12 + rng() * 0.16;
    g.plate('thatch', 0.05, drop, 0.018, x, EAVE_Y - 0.02 - drop / 2, EAVE_ZB + 0.03, j(0.2), j(0.4), j(0.2), {
      bevel: 0.004,
      tile: 0.8,
    });
  }

  // ridge pole: solid over the back half, snapped and hanging over the front
  g.rod('bamboo', -ROOF_X, RIDGE_Y + 0.04, RIDGE_Z, 0.4, RIDGE_Y + 0.02, RIDGE_Z, 0.07, { radial: 6, tile: 1.2 });
  g.rod('bamboo', 0.4, RIDGE_Y + 0.02, RIDGE_Z, 1.5, RIDGE_Y - 0.3, RIDGE_Z - 0.15, 0.065, { radial: 5, tile: 1.2 });
  g.rod('bamboo', 1.5, RIDGE_Y - 0.3, RIDGE_Z - 0.15, 2.35, RIDGE_Y - 0.85, RIDGE_Z - 0.35, 0.06, { radial: 5, tile: 1.2 });
  for (let i = 0; i < 4; i++) {
    const x = -2.7 + i * 0.85;
    g.ring('rope', 0.11, 0.02, x, RIDGE_Y + 0.08, RIDGE_Z, 0, Math.PI / 2, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.6 });
  }
  // ridge cap only on the intact left half
  g.plate('thatchDark', 3.4, 0.5, 0.06, -1.35, RIDGE_Y - 0.16, RIDGE_Z, backTheta - Math.PI / 2, 0, 0.01, {
    bevel: 0.014,
    tile: 1.5,
  });

  // front slope: only a triangular remnant near the left gable survives
  const frontLen = Math.hypot(EAVE_Y - RIDGE_Y, EAVE_ZF - RIDGE_Z);
  const frontTheta = Math.atan2(EAVE_ZF - RIDGE_Z, EAVE_Y - RIDGE_Y);
  for (let c = 0; c < 2; c++) {
    const t = 0.3 + c * 0.34;
    for (let i = 0; i < 3; i++) {
      const x = -ROOF_X + 0.3 + i * 0.62 + j(0.06);
      g.plate(c === 1 ? 'thatch' : 'thatchDark', 0.86 + j(0.1), frontLen * 0.46, 0.055,
        x, RIDGE_Y + (EAVE_Y - RIDGE_Y) * t + j(0.04), RIDGE_Z + (EAVE_ZF - RIDGE_Z) * t + j(0.04),
        frontTheta + j(0.16), 0, j(0.3), { bevel: 0.012, tile: 1.7 });
    }
  }
  // exposed rafters + purlin stubs where the front slope tore away
  for (let i = 0; i < 6; i++) {
    const x = -2.55 + i * 0.98;
    g.rod('woodDark', x, RIDGE_Y - 0.16, RIDGE_Z - 0.02, x + j(0.1), RIDGE_Y - 1.0 - rng() * 0.4, RIDGE_Z - 1.5 - rng() * 0.7, 0.045, {
      radial: 4,
      tile: 1.1,
    });
  }
  // one rafter has hinged down and hangs into the room
  g.rod('woodDark', -1.2, RIDGE_Y - 0.2, RIDGE_Z - 0.05, -1.3, RIDGE_Y - 1.75, RIDGE_Z - 1.1, 0.04, { radial: 4, tile: 1.1 });
  // torn thatch strips hanging from the ridge
  for (let i = 0; i < 5; i++) {
    g.plate('thatchDark', 0.3 + rng() * 0.22, 0.45 + rng() * 0.3, 0.035,
      -0.5 + i * 0.62 + j(0.1), RIDGE_Y - 0.55 - rng() * 0.2, RIDGE_Z - 0.18 + j(0.05),
      j(0.15), j(0.5), 1.25 + j(0.25), { bevel: 0.006, tile: 1.1 });
  }
  // collapsed thatch heap on the ruined floor
  for (let i = 0; i < (hi ? 8 : 5); i++) {
    g.plate(i % 3 === 0 ? 'thatchDark' : 'thatch', 0.6 + rng() * 0.5, 0.42 + rng() * 0.2, 0.06,
      0.5 + rng() * 1.8, 0.72 + rng() * 0.5, -1.5 + rng() * 1.2,
      rng() * Math.PI, rng() * Math.PI, rng() * 0.6, { bevel: 0.012, tile: 1.6 });
  }
  // gable barge board survives on the left only
  g.plate('woodDark', 0.12, frontLen * 0.9, 0.16, -ROOF_X + 0.05, RIDGE_Y - 1.05, RIDGE_Z - 1.35, frontTheta, 0, 0.02, {
    bevel: 0.01,
    tile: 1.3,
  });
  g.plate('woodDark', 0.12, backLen * 0.95, 0.16, -ROOF_X + 0.05, RIDGE_Y - 1.0, RIDGE_Z + 1.25, backTheta, 0, -0.02, {
    bevel: 0.01,
    tile: 1.3,
  });
  // jagged gable infill remnant above the wall on the surviving left end
  for (let i = 0; i < 3; i++) {
    const yy = WALL_TOP - 0.05 + i * 0.4;
    const fr = Math.max(0, (yy - EAVE_Y) / (RIDGE_Y - EAVE_Y));
    const zf = EAVE_ZF + fr * (RIDGE_Z - EAVE_ZF);
    const zb = EAVE_ZB + fr * (RIDGE_Z - EAVE_ZB);
    const span = Math.max(0.3, (zb - zf) * (0.5 - i * 0.1));
    g.plate('woven', 0.035, 0.3, span, -WALL_X - 0.02, yy, RIDGE_Z + (i % 2 ? 0.4 : -0.3), 0, 0, j(0.05), {
      bevel: 0.006,
      tile: 1.0,
    });
  }
}

// ---------------------------------------------------------------------------
// Charred beams + residual coals in the collapse
// ---------------------------------------------------------------------------
function buildCharredCollapse(g, hi, rng, j) {
  // heavy beam that fell across the ruined wall — charred: near-black char crust
  // over the timber core, with flaked edges (audit D-18)
  g.plate('woodDark', 3.2, 0.2, 0.22, 0.9, 1.2, -1.05, 0.12, 0.5, 0.05, { bevel: 0.014, tile: 1.2 });
  g.plate('dark', 3.0, 0.09, 0.2, 0.9, 1.28, -1.03, 0.12, 0.5, 0.05, { bevel: 0.01, tile: 1.2 });
  for (let i = 0; i < 5; i++) {
    g.plate('dark', 0.16 + rng() * 0.2, 0.03, 0.1 + rng() * 0.12,
      0.05 + i * 0.62, 1.3 + rng() * 0.03, -1.28 + rng() * 0.3,
      j(0.4), j(0.6), j(0.4), { bevel: 0.004, tile: 0.8 });
  }
  g.plate('woodDark', 2.4, 0.16, 0.18, -1.1, 1.35, -0.65, -0.2, -0.7, -0.12, { bevel: 0.012, tile: 1.2 });
  g.plate('dark', 2.25, 0.07, 0.16, -1.1, 1.42, -0.63, -0.2, -0.7, -0.12, { bevel: 0.008, tile: 1.0 });
  for (let i = 0; i < 4; i++) {
    g.plate('dark', 0.14 + rng() * 0.16, 0.026, 0.09 + rng() * 0.1,
      -2.05 + i * 0.6, 1.43 + j(0.02), -0.68 + i * 0.02, j(0.4), j(0.6), j(0.4),
      { bevel: 0.004, tile: 0.8 });
  }
  // charcoal stubs and a couple of ember patches deep in the debris
  for (let i = 0; i < 4; i++) {
    g.plate('woodDark', 0.1 + rng() * 0.1, 0.5 + rng() * 0.4, 0.1, 0.4 + i * 0.5, 0.85 + i * 0.1, -0.9 + j(0.3), 0.6 + j(0.5), j(0.8), j(0.5), {
      bevel: 0.008,
      tile: 0.9,
    });
  }
  g.plate('coals', 0.5, 0.02, 0.36, 1.05, 0.94, -1.1, 0, 0.4, 0, { bevel: 0.006, tile: 0.8 });
  g.plate('coals', 0.26, 0.02, 0.2, -0.35, 1.06, -0.55, 0, 1.1, 0, { bevel: 0.005, tile: 0.8 });
  // charred ends of the two snapped stilts
  g.plate('woodDark', 0.26, 0.16, 0.26, 2.15, 0.52, -1.45, 0, 0, 0, { bevel: 0.01, tile: 1.0 });
  g.plate('woodDark', 0.26, 0.12, 0.26, 2.15, 0.7, 1.45, 0, 0.3, 0, { bevel: 0.01, tile: 1.0 });
}

// ---------------------------------------------------------------------------
// Fallen thatch bundles + broken bamboo
// ---------------------------------------------------------------------------
function thatchBundle(g, x, y, z, len, scale, ry, tilt) {
  g.cyl('thatch', 0.16 * scale, 0.17 * scale, len, x, y, z, tilt, ry, 0, { radial: 7, tile: 1.3 });
  for (const t of [-0.3, 0.28]) {
    g.ring('rope', 0.165 * scale, 0.018, x + Math.sin(ry) * len * t, y, z + Math.cos(ry) * len * t,
      tilt, ry, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.6 });
  }
}

function buildBundles(g, hi, rng, j) {
  thatchBundle(g, -0.55, 0.19, -2.4, 0.75, 1.0, 0.35, Math.PI / 2 + 0.05);
  thatchBundle(g, 0.25, 0.19, -2.62, 0.7, 0.9, 0.1, Math.PI / 2 - 0.06);
  thatchBundle(g, 1.35, 0.19, -2.15, 0.8, 1.05, 1.05, Math.PI / 2 + 0.1);
  if (hi) {
    thatchBundle(g, 2.1, 0.19, 1.9, 0.72, 0.95, 0.55, Math.PI / 2);
    thatchBundle(g, -1.95, 0.19, 2.25, 0.66, 0.85, 1.35, Math.PI / 2 + 0.08);
    // bundle propped against the ruin
    thatchBundle(g, -2.3, 0.5, -0.6, 0.9, 1.0, 0.2, 1.0);
    // loose straw scattered on the floor
    for (let i = 0; i < 5; i++) {
      g.plate('thatch', 0.08 + rng() * 0.1, 0.5 + rng() * 0.4, 0.02, -1.5 + rng() * 2.5, 1.02 + rng() * 0.05, -1.5 + rng() * 2.4,
        -1.5, rng() * Math.PI, j(0.3), { bevel: 0.004, tile: 0.8 });
    }
  }
  // broken bamboo poles
  g.cyl('bamboo', 0.03, 0.03, 1.7, 1.8, 0.1, -0.5, -1.5, 0.7, 0, { radial: 5, tile: 1.0 });
  g.cyl('bamboo', 0.028, 0.028, 1.2, -1.5, 0.08, 1.25, -1.52, -0.4, 0, { radial: 5, tile: 1.0 });
}

// ---------------------------------------------------------------------------
// Vegetation moving in: ferns at the footings, vines over the wall, a shrub
// growing through the broken roof
// ---------------------------------------------------------------------------
function buildUnderstory(g, hi, rng, j) {
  if (!hi) return;
  // fern rosettes at the base (cells: fern)
  for (const [fx, fz, sc] of [[-2.55, -1.9, 1.0], [2.4, -0.15, 0.85], [-1.6, 2.35, 0.9], [1.95, 2.4, 0.75]]) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rng();
      g.leaf(i % 2 ? 'broadleafDark' : 'broadleaf', 0.5 * sc, 0.78 * sc, 'fern',
        fx + Math.cos(a) * 0.12, 0.42, fz + Math.sin(a) * 0.12,
        -1.15 + rng() * 0.2, a, j(0.1), { bend: 0.1, droop: 0.2 });
    }
  }
  // vines creeping up the back wall and over the broken front wall
  for (let i = 0; i < 5; i++) {
    const vx = -2.2 + i * 1.0;
    g.leaf('broadleaf', 0.5, 0.62, 'vine', vx, 1.6 + (i % 3) * 0.45, WALL_BACK + 0.08,
      0.5 + rng() * 0.3, Math.PI, j(0.2), { bend: 0.1, droop: 0.2 });
  }
  // three strings of vine leaves draped down the broken walls (dense cluster cards)
  for (const [vx, vy, vz] of [[-2.05, 2.0, WALL_BACK + 0.1], [0.35, 2.2, WALL_BACK + 0.1], [1.65, 1.6, WALL_FRONT - 0.05]]) {
    const strand = [];
    for (let k = 0; k <= 4; k++) {
      strand.push(new THREE.Vector3(vx + j(0.08), vy - k * 0.3, vz + j(0.05)));
    }
    g.add('barkMoss', tubeGeo(strand, 0.014, { tubularSeg: 10, radialSeg: 3, tile: 0.9 }));
    for (let k = 0; k < 5; k++) {
      const pw = 0.34 + rng() * 0.16;
      g.add(k % 2 ? 'canopyDark' : 'canopy', new THREE.PlaneGeometry(pw, pw * 0.85),
        matrixFor(vx + j(0.14), vy - 0.15 - k * 0.3, vz + 0.06, 0, 0.5 + rng() * 2.4, 0));
    }
  }
  for (let i = 0; i < 4; i++) {
    const vx = -2.3 + i * 0.85;
    g.leaf('broadleafDark', 0.62, 0.7, 'broad', vx, 0.9 + rng() * 0.8, WALL_BACK + 0.06,
      1.1 + rng() * 0.4, Math.PI, j(0.35), { bend: 0.14, droop: 0.3 });
  }
  // broadleaf sapling pushing up through the caved roof hole
  g.leaf('broadleaf', 0.9, 1.15, 'broad', -0.7, 1.65, -0.5, 0.9, 0.4, 0.15, { bend: 0.2, droop: 0.18 });
  g.leaf('broadleafDark', 0.8, 1.0, 'broad', -0.35, 1.95, -0.75, 1.2, -0.6, -0.1, { bend: 0.18, droop: 0.22 });
  g.leaf('broadleaf', 0.7, 0.9, 'banana', 0.2, 1.7, -1.3, 1.35, 1.2, 0.4, { bend: 0.16, droop: 0.4 });
  // a few vines dangling from the surviving ridge end
  for (let i = 0; i < 3; i++) {
    g.leaf('broadleafDark', 0.45, 0.55, 'vine', -2.6 + i * 0.35, RIDGE_Y - 0.4, RIDGE_Z + 0.15,
      0.3, 0.8, 0, { bend: 0.06, droop: 0.1 });
  }
}

// ---------------------------------------------------------------------------
// Ground: rubble, litter, mud, stone step
// ---------------------------------------------------------------------------
function buildGround(g, hi, rng, j) {
  // mossy rubble from the collapsed wall
  for (let i = 0; i < (hi ? 5 : 2); i++) {
    g.rock('mossStone', 0.14 + rng() * 0.12, -0.8 + rng() * 3.4, 0.19, -2.0 + rng() * 3.4, {
      detail: 1,
      seed: 90 + i * 7,
      flatten: 0.55,
      tile: 1.3,
    });
  }
  // flat stone threshold under the surviving door frame
  g.rock('ruinStoneDark', 0.28, -0.45, 0.11, -2.15, { detail: 1, seed: 33, flatten: 0.42, tile: 1.4 });
  // wet mud + leaf litter
  g.plate('mud', 2.0, 0.02, 1.5, 0.15, 0.015, -1.2, 0, 0.35, 0, { bevel: 0.006, tile: 2.0 });
  for (let i = 0; i < (hi ? 8 : 3); i++) {
    g.plate('leafLitter', 0.16 + rng() * 0.14, 0.014, 0.14 + rng() * 0.1,
      -2.1 + rng() * 4.4, 0.02, -2.6 + rng() * 4.6, 0, rng() * Math.PI, j(0.05), { bevel: 0.003, tile: 0.9 });
  }
  // a couple of loose roof tiles / board shards leaning against the stump
  g.plate('woodDark', 0.5, 0.55, 0.04, 2.4, 0.3, -1.9, 0.9, 0.4, 0.1, { bevel: 0.006, tile: 1.0 });
}
