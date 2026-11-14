/**
 * ISLAND VILLAGE — V5 VILLAGE WALKWAY (村中栈道).
 *
 * A raised bamboo-and-plank walkway that keeps the villagers' feet out of the
 * wet ground: two timber stringers on three pairs of posts, a plank deck with a
 * solid sub-floor (no light leaks between boards), a single handrail down one
 * side with lashed joints, and three steps at the -X end.
 *
 * Conventions: metres, +Y up, front (-Z) is the open side of the walkway;
 * model bottom on y = 0. Triangle budget (stage): 3,000–6,000.
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

export const meta = { id: 'village-walkway', kind: 'world', group: 'village', label: '村中栈道 · WALKWAY' };

const DECK_Y = 0.95;      // walking surface
const HALF_W = 0.9;       // half deck width (z)
const X_DECK0 = -2.45;    // deck start (-X)
const X_DECK1 = 2.85;     // deck end (+X)
const RAIL_Z = 0.86;      // railing sits on the +Z edge

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
  island(ctx).walkways = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildWalkways(ctx);
}

export function buildWorld(ctx) {
  buildWalkways(ctx);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildWalkways(ctx) {
  const items = island(ctx).walkways || [];
  if (!items.length) return;
  const hi = ctx.stage === true;
  items.forEach((item, i) => buildWalkway(ctx, item, hi, 8210 + i * 47));
}

// ---------------------------------------------------------------------------
// One walkway
// ---------------------------------------------------------------------------
function buildWalkway(ctx, item, hi, seed) {
  const s = item.s ?? 1;
  const g = gfx(ctx, matrixFor(item.x ?? 0, item.y ?? 0, item.z ?? 0, 0, item.ry ?? 0, 0, s, s, s));
  const rng = makeRNG(seed);
  const j = (a) => (rng() * 2 - 1) * a;
  const deckLen = X_DECK1 - X_DECK0;
  const deckMidX = (X_DECK0 + X_DECK1) / 2;

  // ------------------------------------------------------- posts and supports
  const postXs = [X_DECK0 + 0.12, deckMidX, X_DECK1 - 0.12];
  for (const px of postXs) {
    for (const sz of [-1, 1]) {
      const pz = sz * 0.66;
      // footing stone
      g.rock('mossStone', 0.14, px, 0.1, pz, { detail: 1, seed: 15 + Math.round(px * 3) + sz, flatten: 0.5, tile: 1.3 });
      // post
      g.plate('wood', 0.14, DECK_Y - 0.16, 0.14, px, 0.12 + (DECK_Y - 0.16) / 2, pz, 0, j(0.03), j(0.01), {
        bevel: 0.012,
        tile: 1.2,
      });
      // rope lashing at the top of the post
      g.ring('rope', 0.1, 0.019, px, DECK_Y - 0.2, pz, Math.PI / 2, 0, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.6 });
      // diagonal brace from the post foot up to the cross beam at the deck centre:
      // both ends land on timber (before it floated in the gap under the deck)
      g.rod('woodDark', px, 0.18, pz, px, DECK_Y - 0.2, 0, 0.04, { radial: 4, tile: 1.0 });
    }
    // cross beam carried by the pair
    g.plate('wood', 0.16, 0.14, HALF_W * 2 - 0.02, px, DECK_Y - 0.2, 0, 0, j(0.02), 0, { bevel: 0.012, tile: 1.2 });
  }

  // ------------------------------------------------------------- deck framing
  for (const sz of [-1, 1]) {
    g.plate('wood', deckLen + 0.16, 0.17, 0.16, deckMidX, DECK_Y - 0.15, sz * (HALF_W - 0.12), 0, 0, 0.004, {
      bevel: 0.014,
      tile: 1.3,
    });
  }
  // solid sub-floor so the board gaps never show daylight underneath
  g.plate('woodDark', deckLen + 0.1, 0.03, HALF_W * 2, deckMidX, DECK_Y - 0.075, 0, 0, 0, 0, { bevel: 0.006, tile: 1.8 });
  // extra joists between the beams
  for (let i = 0; i < (hi ? 5 : 3); i++) {
    const x = X_DECK0 + 0.5 + i * (deckLen - 1.0) / (hi ? 4 : 2);
    g.plate('woodDark', 0.09, 0.1, HALF_W * 2 - 0.1, x, DECK_Y - 0.07, 0, 0, j(0.03), 0, { bevel: 0.008, tile: 1.1 });
  }

  // ------------------------------------------------------------- deck planks
  const planks = hi ? 20 : 12;
  for (let i = 0; i < planks; i++) {
    const x = X_DECK0 + 0.09 + (i / (planks - 1)) * (deckLen - 0.18) + j(0.008);
    g.plate('wood', 0.235, 0.055, HALF_W * 2 - 0.02, x, DECK_Y - 0.03 + j(0.004), j(0.006), j(0.003), j(0.004), j(0.004), {
      bevel: 0.008,
      tile: 1.0,
    });
  }
  // edge trim along both sides
  for (const sz of [-1, 1]) {
    g.plate('woodDark', deckLen, 0.09, 0.1, deckMidX, DECK_Y - 0.02, sz * (HALF_W - 0.03), 0, 0, 0, { bevel: 0.008, tile: 1.2 });
  }

  // ------------------------------------------------------------------ railing
  const railTop = DECK_Y + 1.02;
  const railXs = [X_DECK0 + 0.1, X_DECK0 + 1.4, deckMidX, X_DECK1 - 1.4, X_DECK1 - 0.1];
  for (const rx of railXs) {
    g.plate('wood', 0.09, 1.06, 0.09, rx, DECK_Y + 0.5, RAIL_Z, 0, j(0.02), j(0.012), { bevel: 0.01, tile: 1.0 });
    // rope lashings at both rails
    for (const ry of [railTop, DECK_Y + 0.52]) {
      g.ring('rope', 0.062, 0.015, rx, ry, RAIL_Z, Math.PI / 2, 0, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.5 });
    }
  }
  g.cyl('bamboo', 0.045, 0.045, deckLen, deckMidX, railTop, RAIL_Z, 0, 0, Math.PI / 2, { radial: 6, tile: 1.2 });
  g.cyl('bamboo', 0.032, 0.032, deckLen, deckMidX, DECK_Y + 0.52, RAIL_Z, 0, 0, Math.PI / 2, { radial: 5, tile: 1.0 });
  // diagonal X-braces in the end bays
  for (const rx of [X_DECK0 + 0.75, X_DECK1 - 0.75]) {
    g.rod('bamboo', rx - 0.62, DECK_Y + 0.06, RAIL_Z, rx + 0.62, DECK_Y + 0.98, RAIL_Z, 0.022, { radial: 4, tile: 0.9 });
    g.rod('bamboo', rx - 0.62, DECK_Y + 0.98, RAIL_Z, rx + 0.62, DECK_Y + 0.06, RAIL_Z, 0.022, { radial: 4, tile: 0.9 });
  }
  // end caps on the handrail
  for (const sx of [-1, 1]) {
    const ex = sx < 0 ? X_DECK0 + 0.05 : X_DECK1 - 0.05;
    g.cyl('woodDark', 0.055, 0.05, 0.1, ex, railTop + 0.02, RAIL_Z, 0, 0, Math.PI / 2, { radial: 6, tile: 0.8 });
  }

  // ------------------------------------------------------------------- steps
  // three steps down from the -X end, with a stone landing pad
  const stepZ = 0;
  const stepW = HALF_W * 2 - 0.1;
  for (let i = 0; i < 3; i++) {
    const sx = X_DECK0 - 0.17 - i * 0.3;
    const sy = DECK_Y - 0.24 - i * 0.26;
    g.plate('wood', 0.34, 0.07, stepW, sx, sy, stepZ, 0, j(0.02), 0, { bevel: 0.008, tile: 1.1 });
    // riser support, cut to whatever gap is left above the ground
    const rh = Math.max(0.12, sy - 0.06);
    g.plate('woodDark', 0.1, rh, stepW - 0.1, sx - 0.1, 0.03 + rh / 2, stepZ, 0, 0, 0, { bevel: 0.008, tile: 1.0 });
    // small rope / peg detail on the outer edge
    if (hi) {
      g.ring('rope', 0.04, 0.012, sx + 0.05, sy, stepZ + stepW / 2 - 0.08, 0, 0, 0, { radialSeg: 4, tubularSeg: 5, tile: 0.4 });
    }
  }
  // step side stringers: run from the deck edge down onto the lowest step tread
  for (const sz of [-1, 1]) {
    const szz = stepZ + sz * (stepW / 2 - 0.03);
    g.rod('wood', X_DECK0 - 0.03, DECK_Y - 0.2, szz, X_DECK0 - 0.82, 0.12, szz, 0.055, { radial: 5, tile: 1.0 });
    // lashing where the stringer meets the deck frame
    g.ring('rope', 0.06, 0.014, X_DECK0 - 0.05, DECK_Y - 0.21, szz, 0, Math.PI / 2, 0, {
      radialSeg: 4,
      tubularSeg: 5,
      tile: 0.05,
    });
  }
  // tread board over the deck / step seam (the gap used to read as a missing piece)
  g.plate('wood', 0.26, 0.07, stepW + 0.06, X_DECK0 - 0.09, DECK_Y - 0.14, stepZ, 0, j(0.02), 0, {
    bevel: 0.008,
    tile: 1.1,
  });
  g.cyl('stone', 0.24, 0.28, 0.1, X_DECK0 - 0.82, 0.05, 0.02, 0, 0.2, 0, { radial: 8, tile: 1.4 });

  // ------------------------------------------------------- life on the walkway
  // a basket and a folded mat left on the deck
  const bx = 1.55;
  g.lathe('bamboo', [
    [0.02, 0],
    [0.14, 0],
    [0.17, 0.08],
    [0.175, 0.2],
    [0.16, 0.26],
    [0.14, 0.26],
  ], bx, DECK_Y, 0.5, 0, 0.4, 0, { segments: hi ? 11 : 8, tile: 0.8 });
  g.ring('bamboo', 0.172, 0.014, bx, DECK_Y + 0.21, 0.5, Math.PI / 2, 0, 0, { radialSeg: 4, tubularSeg: 8, tile: 0.6 });
  g.ring('rope', 0.14, 0.011, bx, DECK_Y + 0.28, 0.5, Math.PI / 2, 0, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.5 });
  // rolled sleeping mat lashed to the handrail
  g.cyl('thatchDark', 0.06, 0.06, 0.62, -1.05, DECK_Y + 0.62, RAIL_Z - 0.12, 0, 0.25, 0, { radial: 6, tile: 0.8 });
  for (const t of [-0.22, 0.22]) {
    g.ring('rope', 0.07, 0.013, -1.05 + t, DECK_Y + 0.62, RAIL_Z - 0.12, 0, 0.25, Math.PI / 2, {
      radialSeg: 4,
      tubularSeg: 5,
      tile: 0.4,
    });
  }
  // mossy litter caught in the deck corners
  for (let i = 0; i < (hi ? 5 : 2); i++) {
    g.plate('leafLitter', 0.14 + rng() * 0.1, 0.012, 0.1 + rng() * 0.08,
      X_DECK0 + 0.4 + rng() * (deckLen - 0.8), DECK_Y + 0.005, -HALF_W + 0.15 + rng() * (HALF_W * 2 - 0.3),
      0, rng() * Math.PI, j(0.04), { bevel: 0.003, tile: 0.9 });
  }
  // spare bamboo poles stashed under the deck (resting on the ground, not floating)
  g.cyl('bamboo', 0.03, 0.03, 2.6, 0.4, 0.04, 0.34, 0, 0.12, Math.PI / 2, { radial: 5, tile: 1.1 });
  g.cyl('bamboo', 0.026, 0.026, 2.2, -1.3, 0.035, -0.08, 0, -0.08, Math.PI / 2 + 0.03, { radial: 4, tile: 1.0 });
  void THREE;
}
