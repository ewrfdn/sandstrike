/**
 * ISLAND VILLAGE — V1 THATCH HUT (茅草干栏屋).
 *
 * A stilt house of the kind the islanders build: six lashed timber posts on
 * stone footings lift a plank deck 1.5 m off the wet ground, woven split-bamboo
 * walls wrap a dark interior, and a big layered thatch gable roof (with a rope-
 * lashed ridge cap and a ragged straw fringe) overhangs a small front veranda
 * that is reached by a leaning timber ladder.
 *
 * Conventions: metres, +Y up, front (door + ladder + veranda) faces -Z, model
 * bottom rests on y = 0. Every count is fixed by `makeRNG()` seeds so the build
 * is identical on every run.
 *
 * Triangle budget (stage): 12,000–18,000. The map build (`hi = false`) keeps the
 * same silhouette with fewer roof courses / wall slats / lashings.
 */
import * as THREE from 'three';
import { matrixFor } from '../../core.js';
import { makeRNG } from '../../../utils.js';
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

/** Shift a geometry's UVs by a whole-tile offset (kills the "same straw patch
 *  repeated 3.5x across the roof" read, audit D-17). */
function shiftUV(geo, [du, dv]) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
  uv.needsUpdate = true;
  return geo;
}

/** Flat 2-triangle straw blade (wide at the root, tapered tip, slight bend):
 *  the cheap element for the eave / ridge fringe. The thatch material is opaque,
 *  so a bevelled plate is not needed and this keeps the fringe inside budget. */
function bladeGeo(w, h, { tip = 0.35, bend = 0.015, tile = 0.8 } = {}) {
  const hw = w / 2;
  const tw = (w * tip) / 2;
  const pos = new Float32Array([
    -hw, 0, 0, hw, 0, 0, tw + bend, -h, 0,
    -hw, 0, 0, tw + bend, -h, 0, -tw + bend, -h, 0,
  ]);
  const uv = new Float32Array([
    0, 0, w / tile, 0, w / tile, h / tile,
    0, 0, w / tile, h / tile, 0, h / tile,
  ]);
  const nor = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return geo;
}

export const meta = { id: 'thatch-hut', kind: 'world', group: 'village', label: '茅草干栏屋 · THATCH HUT' };

// ---------------------------------------------------------------------------
// Dimensions (metres). The front of the hut faces -Z.
// ---------------------------------------------------------------------------
const FLOOR = 1.52;        // walking surface of the deck
const DECK_X = 2.72;       // deck half width
const DECK_FRONT = -3.05;  // veranda front edge
const DECK_BACK = 1.95;
const WALL_FRONT = -2.0;   // front wall plane
const WALL_BACK = 1.85;
const WALL_X = 2.68;
const WALL_TOP = 3.95;     // wall plate height
const EAVE_Y = 4.02;
const RIDGE_Y = 6.12;
const RIDGE_Z = -0.12;
const ROOF_X = 3.42;
const EAVE_ZF = -3.25;
const EAVE_ZB = 2.82;

/** Six stilt posts: [x, z, post top y]. Slightly different heights on purpose. */
const STILTS = [
  [-2.0, -1.45, 1.44],
  [0.0, -1.45, 1.405],
  [2.0, -1.45, 1.455],
  [-2.0, 1.36, 1.42],
  [0.0, 1.36, 1.45],
  [2.0, 1.36, 1.395],
];

// ---------------------------------------------------------------------------
// Small local geometry helper: everything is emitted into ctx.batcher under a
// per-instance base matrix, so one builder can place N huts with x/z/ry/s.
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
    /** Beveled board / panel / slab. `opts.uvOffset` shifts the texture per panel. */
    plate(key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, opts) {
      const geo = plateGeo(w, h, d, opts);
      if (opts && opts.uvOffset) shiftUV(geo, opts.uvOffset);
      add(key, geo, matrixFor(x, y, z, rx, ry, rz));
    },
    /** 2-triangle straw blade for the eave / ridge fringe. */
    blade(key, w, h, x, y, z, rx = 0, ry = 0, rz = 0, opts) {
      add(key, bladeGeo(w, h, opts), matrixFor(x, y, z, rx, ry, rz));
    },
    /** Flat quad card (canopy leaf clusters). */
    quad(key, w, h, x, y, z, rx = 0, ry = 0, rz = 0) {
      add(key, new THREE.PlaneGeometry(w, h), matrixFor(x, y, z, rx, ry, rz));
    },
    /** Tapered cylinder (posts, pots, bamboo sections). */
    cyl(key, rTop, rBottom, h, x, y, z, rx = 0, ry = 0, rz = 0, opts) {
      add(key, cylGeo(rTop, rBottom, h, opts), matrixFor(x, y, z, rx, ry, rz));
    },
    /** Turned lathe profile [[r, y], ...]. */
    lathe(key, profile, x, y, z, rx = 0, ry = 0, rz = 0, opts) {
      add(key, latheGeo(profile, opts), matrixFor(x, y, z, rx, ry, rz));
    },
    /** Sphere, optionally squashed (`sx/sy/sz`) for fish bodies / knots. */
    ball(key, r, x, y, z, rx = 0, ry = 0, rz = 0, opts = {}) {
      const sx = opts.sx ?? 1;
      const sy = opts.sy ?? 1;
      const sz = opts.sz ?? 1;
      add(key, sphereGeo(r, opts), matrixFor(x, y, z, rx, ry, rz, sx, sy, sz));
    },
    /** Torus: rope wraps, pot rims, basket hoops. */
    ring(key, R, r, x, y, z, rx = 0, ry = 0, rz = 0, opts) {
      add(key, torusGeo(R, r, opts), matrixFor(x, y, z, rx, ry, rz));
    },
    /** Cylinder spanning two local points (braces, ladder stakes, cords). */
    rod(key, ax, ay, az, bx, by, bz, r, opts) {
      add(key, rodGeo(ax, ay, az, bx, by, bz, r, opts));
    },
    /** Tube along a polyline (sagging ropes / net lines). */
    tube(key, pts, r, opts) {
      add(key, tubeGeo(pts, r, opts));
    },
    /** Natural stone (footings, step stones). */
    rock(key, r, x, y, z, opts) {
      add(key, rockGeo(r, opts), matrixFor(x, y, z));
    },
  };
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/** Stage preview: one hero hut at the origin, then the shared build path. */
export function build(ctx) {
  island(ctx).huts = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildHuts(ctx);
}

/** Map assembly: reads layout.island.huts; no data = nothing built. */
export function buildWorld(ctx) {
  buildHuts(ctx);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildHuts(ctx) {
  const items = island(ctx).huts || [];
  if (!items.length) return;
  const hi = ctx.stage === true;
  items.forEach((item, i) => buildHut(ctx, item, hi, 4210 + i * 37));
}

// ---------------------------------------------------------------------------
// One hut
// ---------------------------------------------------------------------------
function buildHut(ctx, item, hi, seed) {
  const s = item.s ?? 1;
  const g = gfx(ctx, matrixFor(item.x ?? 0, item.y ?? 0, item.z ?? 0, 0, item.ry ?? 0, 0, s, s, s));
  const rng = makeRNG(seed);
  /** Symmetric random in [-a, a]. */
  const j = (a) => (rng() * 2 - 1) * a;

  buildStilts(g, hi, rng);
  buildDeck(g, hi, rng, j);
  buildWalls(g, hi, rng, j);
  buildRoof(g, hi, rng, j);
  buildDoorAndWindows(g, hi, rng, j);
  buildLadder(g, hi, rng, j);
  buildVerandaRail(g, hi, rng);
  buildHangingProps(g, hi, rng, j);
  buildGroundDressing(g, hi, rng, j);
}

// ---------------------------------------------------------------------------
// Stilts: stone footing, timber post, top pad, rope lashings, wedges
// ---------------------------------------------------------------------------
function buildStilts(g, hi, rng) {
  const j = (a) => (rng() * 2 - 1) * a;
  let i = 0;
  for (const [px, pz, topY] of STILTS) {
    const seed = 7 + i;
    i++;
    // flattened footing stone, slightly buried in the wet ground
    g.rock('mossStone', 0.21, px + j(0.02), 0.13, pz + j(0.02), {
      detail: 1,
      seed,
      flatten: 0.55,
      tile: 1.4,
    });
    // main post, one face slightly offset so the six posts are not identical
    const postH = topY - 0.12;
    g.plate('wood', 0.21, postH, 0.21, px, 0.12 + postH / 2, pz, 0, j(0.05), j(0.025), { bevel: 0.014, tile: 1.2 });
    // flat bearing stone + timber pad under the deck beam
    g.plate('stone', 0.31, 0.07, 0.31, px, topY + 0.035, pz, 0, j(0.12), 0, { bevel: 0.01, tile: 1.5 });
    g.plate('woodDark', 0.34, 0.12, 0.34, px, topY + 0.13, pz, 0, j(0.16), j(0.04), { bevel: 0.012, tile: 1.1 });
    // rope lashing at the post head where the floor beam is tied down
    g.ring('rope', 0.155, 0.024, px, topY - 0.04, pz, Math.PI / 2, 0, 0, {
      radialSeg: 4,
      tubularSeg: 5,
      tile: 0.7,
    });
    if (hi) {
      g.ring('rope', 0.15, 0.02, px, topY - 0.62, pz, Math.PI / 2, 0, 0, {
        radialSeg: 4,
        tubularSeg: 5,
        tile: 0.7,
      });
    }
    // wedge stone kicked against the foot
    if (hi) {
      g.plate('ruinStoneDark', 0.09, 0.1, 0.2, px + j(0.15) + 0.14, 0.13, pz + j(0.1), 0, j(0.6), j(0.12), {
        bevel: 0.008,
        tile: 1.2,
      });
    }
  }
  // diagonal braces from the two front stilts up to the veranda edge
  for (const sx of [-1, 1]) {
    g.rod('woodDark', sx * 2.0, 1.22, -1.45, sx * 2.45, 1.34, -2.92, 0.055, { radial: 5, tile: 1.1 });
    g.rod('woodDark', sx * 2.0, 0.55, -1.42, sx * 2.4, 1.3, -2.86, 0.045, { radial: 5, tile: 1.1 });
  }
}

// ---------------------------------------------------------------------------
// Deck: girders, joists, pitched plank floor, nosing, dark underside
// ---------------------------------------------------------------------------
function buildDeck(g, hi, rng, j) {
  // two girders running along X, carried by the six posts
  for (const z of [-1.42, 1.34]) {
    g.plate('wood', 5.4, 0.2, 0.18, 0, 1.31, z, 0, 0, j(0.01), { bevel: 0.016, tile: 1.3 });
  }
  // cross beams along Z
  for (const x of [-2.0, 0, 2.0]) {
    g.plate('wood', 0.18, 0.19, 3.85, x, 1.29, -0.075, 0, j(0.04), 0, { bevel: 0.014, tile: 1.3 });
  }
  // joists across the full deck (veranda included)
  const joistCount = hi ? 9 : 6;
  for (let i = 0; i < joistCount; i++) {
    const x = -2.5 + (i / (joistCount - 1)) * 5.0;
    g.plate('woodDark', 0.085, 0.13, 4.98, x, 1.43, -0.55, 0, j(0.03), 0, { bevel: 0.008, tile: 1.1 });
  }
  // plank floor: individual boards with a hair of gap, uneven by a few mm
  const boards = hi ? 14 : 9;
  for (let i = 0; i < boards; i++) {
    const x = -2.53 + (i / (boards - 1)) * 5.06 + j(0.012);
    g.plate('wood', 0.345, 0.06, 4.92, x, FLOOR - 0.03 + j(0.006), -0.55, j(0.004), j(0.006), j(0.006), {
      bevel: 0.008,
      tile: 1.0,
    });
  }
  // veranda front nosing + fascia boards
  g.plate('woodDark', 5.42, 0.11, 0.14, 0, FLOOR - 0.06, DECK_FRONT + 0.02, 0, 0, 0.006, { bevel: 0.01, tile: 1.2 });
  g.plate('woodDark', 0.14, 0.14, 0.9, -DECK_X + 0.02, FLOOR - 0.07, DECK_FRONT + 0.5, 0, 0, 0, { bevel: 0.01, tile: 1.2 });
  g.plate('woodDark', 0.14, 0.14, 0.9, DECK_X - 0.02, FLOOR - 0.07, DECK_FRONT + 0.5, 0, 0, 0, { bevel: 0.01, tile: 1.2 });
  // dark underside so the deck reads as a solid floor from below
  g.plate('dark', 5.0, 0.02, 3.65, 0, 1.38, -0.45, 0, 0, 0, { bevel: 0.006, tile: 1.6 });
}

// ---------------------------------------------------------------------------
// Woven walls
// ---------------------------------------------------------------------------

/** Local outward face factor: strips/battens are pushed along local +Z * face. */
function wovenPanel(gf, hi, rng, x0, x1, y0, y1, face, opts = {}) {
  const w = x1 - x0;
  const h = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  // woven mat backing (the opaque wall body): per-panel tile offset so the same
  // Z-weave repeat does not line up across neighbouring panels (audit D-17)
  gf.plate('woven', w, h, 0.04, cx, cy, face * -0.004, 0, 0, 0, {
    bevel: 0.01,
    tile: 1.65,
    uvOffset: [rng(), rng()],
  });
  // vertical split-bamboo slats on the outer face
  const step = hi ? 0.235 : 0.4;
  const n = Math.max(2, Math.round(w / step));
  for (let i = 0; i < n; i++) {
    const sx = x0 + ((i + 0.5) / n) * w + (rng() - 0.5) * 0.009;
    const sw = 0.062 + rng() * 0.026;
    const sh = h * (0.96 + rng() * 0.035);
    // bone-dry bamboo, weathered timber and a few dark replacements mix on the wall
    const key = i % 3 === 0 ? 'woodDark' : i % 3 === 1 ? 'wood' : 'bamboo';
    gf.plate(key, sw, sh, 0.022, sx, cy + (rng() - 0.5) * 0.014, face * 0.03, 0, 0, (rng() - 0.5) * 0.02, {
      bevel: 0.005,
      tile: 1.0,
    });
  }
  // horizontal pressure battens lashing the slats down
  const nb = h > 1.6 ? 2 : 1;
  for (let i = 0; i < nb; i++) {
    const by = y0 + h * (nb === 1 ? 0.5 : 0.26 + i * 0.48);
    gf.plate(i % 2 ? 'bamboo' : 'woodDark', w + 0.05, 0.048, 0.028, cx, by, face * 0.055, 0, 0, (rng() - 0.5) * 0.012, {
      bevel: 0.006,
      tile: 1.1,
    });
  }
  // a couple of rope ties at the panel edges
  if (hi && w > 0.8) {
    for (const t of [0.12, 0.88]) {
      gf.ring('rope', 0.05, 0.014, x0 + t * w, y0 + h * 0.32, face * 0.058, Math.PI / 2, 0, 0, {
        radialSeg: 4,
        tubularSeg: 6,
        tile: 0.5,
      });
    }
  }
  void opts;
}

function buildWalls(g, hi, rng, j) {
  // ---- front wall (faces -Z): door opening [-0.58, 0.58], window [1.15, 1.85]
  const front = g.frame(0, 0, WALL_FRONT, 0);
  const F = -1; // local outward face is -Z
  wovenPanel(front, hi, rng, -WALL_X, -0.58, FLOOR + 0.03, WALL_TOP, F);
  wovenPanel(front, hi, rng, 0.58, 1.15, FLOOR + 0.03, WALL_TOP, F);
  wovenPanel(front, hi, rng, 1.15, 1.85, FLOOR + 0.03, 2.6, F);
  wovenPanel(front, hi, rng, 1.15, 1.85, 3.2, WALL_TOP, F);
  wovenPanel(front, hi, rng, 1.85, WALL_X, FLOOR + 0.03, WALL_TOP, F);
  // above the door
  wovenPanel(front, hi, rng, -0.58, 0.58, 3.4, WALL_TOP, F);

  // ---- back wall (faces +Z)
  const back = g.frame(0, 0, WALL_BACK, 0);
  wovenPanel(back, hi, rng, -WALL_X, WALL_X, FLOOR + 0.03, WALL_TOP, 1);
  // small louver vent high on the back wall
  back.plate('dark', 0.34, 0.3, 0.02, 0.2, 3.55, 0.03, 0, 0, 0, { bevel: 0.005, tile: 1.0 });
  for (let i = 0; i < 3; i++) {
    back.rod('bamboo', -0.0 + 0.06, 3.44 + i * 0.1, 0.05, 0.42, 3.44 + i * 0.1, 0.05, 0.012, { radial: 4, tile: 0.6 });
  }

  // ---- right-hand wall (+X, faces +X): window near the front
  const right = g.frame(WALL_X, 0, 0, Math.PI / 2);
  // local +X runs toward world -Z, so local x = -world z
  wovenPanel(right, hi, rng, -1.85, 0.35, FLOOR + 0.03, WALL_TOP, 1);
  wovenPanel(right, hi, rng, 0.95, 2.0, FLOOR + 0.03, WALL_TOP, 1);
  wovenPanel(right, hi, rng, 0.35, 0.95, FLOOR + 0.03, 2.66, 1);
  wovenPanel(right, hi, rng, 0.35, 0.95, 3.2, WALL_TOP, 1);

  // ---- left-hand wall (-X, faces -X)
  const left = g.frame(-WALL_X, 0, 0, -Math.PI / 2);
  wovenPanel(left, hi, rng, -2.0, 1.85, FLOOR + 0.03, WALL_TOP, 1);

  // ---- corner posts, sill beams and top wall plates
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * WALL_X;
      const pz = sz < 0 ? WALL_FRONT : WALL_BACK;
      g.plate('wood', 0.16, WALL_TOP - FLOOR + 0.12, 0.16, px, (FLOOR + WALL_TOP) / 2 + 0.02, pz, 0, j(0.03), 0, {
        bevel: 0.014,
        tile: 1.2,
      });
      g.ring('rope', 0.12, 0.02, px, FLOOR + 0.2, pz, Math.PI / 2, 0, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.6 });
    }
  }
  for (const z of [WALL_FRONT - 0.02, WALL_BACK + 0.02]) {
    g.plate('woodDark', 5.54, 0.13, 0.15, 0, WALL_TOP + 0.04, z, 0, 0, j(0.006), { bevel: 0.012, tile: 1.3 });
  }
  // left/right plates that actually span the walls along Z
  for (const x of [-WALL_X, WALL_X]) {
    g.plate('wood', 0.15, 0.12, 3.92, x, WALL_TOP + 0.04, -0.075, 0, 0, j(0.008), { bevel: 0.01, tile: 1.3 });
    g.plate('wood', 0.16, 0.12, 3.92, x, FLOOR + 0.02, -0.075, 0, 0, 0, { bevel: 0.01, tile: 1.3 });
  }
  // front / back sill beams
  for (const z of [WALL_FRONT, WALL_BACK]) {
    g.plate('wood', 5.42, 0.12, 0.16, 0, FLOOR + 0.02, z, 0, 0, j(0.006), { bevel: 0.01, tile: 1.3 });
  }

  // ---- rafters + purlins over the veranda (visible ceiling from below)
  if (hi) {
    for (let i = 0; i < 6; i++) {
      const x = -2.75 + i * 1.1;
      g.rod('woodDark', x, 4.0, -3.28, x, 4.97, -1.86, 0.045, { radial: 5, tile: 1.1 });
    }
    g.plate('woodDark', 5.4, 0.09, 0.1, 0, 4.14, -2.86, 0.34, 0, 0, { bevel: 0.008, tile: 1.2 });
    g.plate('woodDark', 5.4, 0.09, 0.1, 0, 4.52, -2.15, 0.34, 0, 0, { bevel: 0.008, tile: 1.2 });
  }
}

// ---------------------------------------------------------------------------
// Thatch roof
// ---------------------------------------------------------------------------
/** Ridge line sags slightly and wobbles along X so the roof is not machine-straight. */
function ridgeYAt(x) {
  const t = x / ROOF_X;
  return RIDGE_Y + t * 0.06 - 0.045 * (1 - t * t) + 0.016 * Math.sin(x * 0.87 + 0.4);
}
function ridgeZAt(x) {
  return RIDGE_Z + 0.045 * Math.sin(x * 1.73 + 0.6);
}
/** Eave line is not perfectly level either — old thatch settles unevenly. */
function eaveYAt(x) {
  return EAVE_Y + 0.03 * Math.sin(x * 1.9 + 1.1) + 0.016 * Math.sin(x * 4.3 + 0.4);
}

/** Plane data for the slope that ends at eave z `zEave`, evaluated at x. */
function slopeAt(x, zEave) {
  const ry = ridgeYAt(x);
  const rz = ridgeZAt(x);
  const dy = eaveYAt(x) - ry;
  const dz = zEave - rz;
  const len = Math.hypot(dy, dz);
  return {
    dy,
    dz,
    len,
    theta: Math.atan2(dz, dy), // rotX that lays a plate on the slope
    ny: Math.abs(dz) / len,
    nz: (-Math.sign(dz) * dy) / len,
  };
}

function buildRoof(g, hi, rng, j) {
  const slopes = [
    { zEave: EAVE_ZF, sign: -1 },
    { zEave: EAVE_ZB, sign: 1 },
  ];
  const courses = hi ? 5 : 3;
  const perRow = hi ? 7 : 5;
  const rowStep = (2 * ROOF_X) / perRow;

  for (const sl of slopes) {
    // ---- dark substrate so gaps between the straw courses never show sky
    for (let i = 0; i < 2; i++) {
      const x = -ROOF_X / 2 + i * ROOF_X;
      const s = slopeAt(x, sl.zEave);
      g.plate('thatchDark', ROOF_X + 0.08, s.len * 1.02, 0.035,
        x, ridgeYAt(x) + s.dy * 0.5 - s.ny * 0.05, ridgeZAt(x) + s.dz * 0.5 - s.nz * 0.05,
        s.theta, 0, 0, { bevel: 0.012, tile: 2.6, uvOffset: [i * 0.37, i * 0.61] });
    }
    // ---- purlins + rafters under the substrate
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const s = slopeAt(0, sl.zEave);
      g.rod('woodDark', -ROOF_X, ridgeYAt(0) + s.dy * t - s.ny * 0.09, ridgeZAt(0) + s.dz * t - s.nz * 0.09,
        ROOF_X, ridgeYAt(0) + s.dy * t - s.ny * 0.09, ridgeZAt(0) + s.dz * t - s.nz * 0.09,
        0.05, { radial: 5, tile: 1.2 });
    }
    for (let i = 0; i < 6; i++) {
      const x = -ROOF_X + 0.3 + i * ((2 * ROOF_X - 0.6) / 5);
      const s = slopeAt(x, sl.zEave);
      g.rod('woodDark', x, ridgeYAt(x) - s.ny * 0.1, ridgeZAt(x) - s.nz * 0.1,
        x, eaveYAt(x) - s.ny * 0.1, sl.zEave - s.nz * 0.1, 0.045, { radial: 4, tile: 1.2 });
    }

    // ---- layered straw courses. Each course is a row of overlapping bundles that
    // sits progressively prouder towards the eave, so the roof reads as thick,
    // stepped thatch instead of one smooth plane.
    const courseH = (slopeAt(0, sl.zEave).len / courses) * 1.5;
    for (let c = 0; c < courses; c++) {
      const t = 1 - ((c + 0.5) / courses) * 0.98; // 1 = eave, 0 = ridge
      const lift = 0.02 + 0.30 * Math.pow(t, 1.4);
      for (let i = 0; i < perRow; i++) {
        const x = -ROOF_X + (i + 0.5) * rowStep + j(0.03);
        const s = slopeAt(x, sl.zEave);
        const w = rowStep * (1.1 + rng() * 0.3);
        const hh = courseH * (0.9 + rng() * 0.2);
        const lf = lift + j(0.012);
        g.plate(rng() < 0.14 ? 'thatchDark' : 'thatch', w, hh, 0.05 + rng() * 0.022,
          x, ridgeYAt(x) + s.dy * t + lf * s.ny, ridgeZAt(x) + s.dz * t + lf * s.nz,
          s.theta + j(0.035), 0, j(0.09), {
            bevel: 0.012,
            // 2.4 m tile (~1.45x the old 1.65 m) + a per-bundle UV offset: the
            // rectangular "patch seams" of the 2 m straw tile stop repeating.
            tile: 2.4,
            uvOffset: [rng(), rng()],
          });
      }
    }

    // ---- bamboo lashing rails running down the slope, tied at two points
    if (hi) {
      for (const rx of [-1.75, 1.62]) {
        const s0 = slopeAt(rx, sl.zEave);
        const t0 = 0.16;
        const t1 = 0.94;
        const l0 = 0.02 + 0.3 * Math.pow(t0, 1.4) + 0.05;
        const l1 = 0.02 + 0.3 * Math.pow(t1, 1.4) + 0.05;
        const ax = rx;
        const ay = ridgeYAt(rx) + s0.dy * t0 + l0 * s0.ny;
        const az = ridgeZAt(rx) + s0.dz * t0 + l0 * s0.nz;
        const bx = rx;
        const by = ridgeYAt(rx) + s0.dy * t1 + l1 * s0.ny;
        const bz = ridgeZAt(rx) + s0.dz * t1 + l1 * s0.nz;
        g.rod('rope', ax, ay, az, bx, by, bz, 0.024, { radial: 4, tile: 0.8 });
        for (const tt of [0.5]) {
          const yy = ay + (by - ay) * tt;
          const zz = az + (bz - az) * tt;
          g.ring('rope', 0.05, 0.015, rx, yy, zz, s0.theta - Math.PI / 2, 0, 0, {
            radialSeg: 4,
            tubularSeg: 6,
            tile: 0.6,
          });
        }
      }
    }

    // ---- ragged straw fringe hanging from the real eave edge. Two layers of
    // cheap 2-triangle blades (wide outer veil + shorter inner tufts) break the old
    // straight cut edge of the roof. Audit D-17: 宽 0.10-0.30 m, ±6°, 下垂 0.08-0.25 m.
    const fringeSets = hi
      ? [{ n: 30, drop: [0.13, 0.25], wide: [0.14, 0.26], lift: 0.34, inset: 0.0 },
        { n: 20, drop: [0.08, 0.16], wide: [0.10, 0.2], lift: 0.3, inset: 0.12 }]
      : [{ n: 16, drop: [0.12, 0.22], wide: [0.12, 0.24], lift: 0.34, inset: 0.0 }];
    for (const fs of fringeSets) {
      for (let i = 0; i < fs.n; i++) {
        const x = -ROOF_X + 0.06 + (i / (fs.n - 1)) * (2 * ROOF_X - 0.12) + j(0.05);
        const s = slopeAt(x, sl.zEave);
        const ey = ridgeYAt(x) + s.dy + fs.lift * s.ny;
        const ez = ridgeZAt(x) + s.dz + fs.lift * s.nz;
        const drop = fs.drop[0] + rng() * (fs.drop[1] - fs.drop[0]);
        const wid = fs.wide[0] + rng() * (fs.wide[1] - fs.wide[0]);
        g.blade(i % 3 === 0 ? 'thatchDark' : 'thatch', wid, drop,
          x, ey - 0.015 - drop * 0.5, ez + sl.sign * (0.015 + fs.inset + rng() * 0.04),
          j(0.105), sl.sign * j(0.28), j(0.16), { tip: 0.3 + rng() * 0.3, bend: 0.02 });
      }
    }
    // ---- loose straw poking out horizontally at the eave line
    const tufts = hi ? 5 : 3;
    for (let i = 0; i < tufts; i++) {
      const x = -ROOF_X + 0.2 + (i / (tufts - 1)) * (2 * ROOF_X - 0.4) + j(0.08);
      const s = slopeAt(x, sl.zEave);
      const ey = ridgeYAt(x) + s.dy + 0.32 * s.ny;
      const ez = ridgeZAt(x) + s.dz + 0.32 * s.nz;
      g.plate('thatch', 0.032, 0.15 + rng() * 0.08, 0.018,
        x, ey - 0.02 - rng() * 0.03, ez + sl.sign * (0.03 + rng() * 0.04),
        sl.sign * (1.25 + rng() * 0.2), j(0.5), j(0.2), { bevel: 0.004, tile: 0.8 });
    }
  }

  // ---- ridge: bamboo pole, thatch cap, rope wraps + knots
  const poleA = [-ROOF_X - 0.06, ridgeYAt(-ROOF_X) + 0.06, ridgeZAt(-ROOF_X)];
  const poleB = [ROOF_X + 0.06, ridgeYAt(ROOF_X) + 0.06, ridgeZAt(ROOF_X)];
  g.rod('bamboo', poleA[0], poleA[1], poleA[2], poleB[0], poleB[1], poleB[2], 0.075, { radial: 8, tile: 1.3 });
  // cap bundles laid over the ridge, split in two so they follow the sag
  for (const sl of [{ zEave: EAVE_ZF, sign: -1 }, { zEave: EAVE_ZB, sign: 1 }]) {
    const s = slopeAt(0, sl.zEave);
    for (const cx of [-1.7, 1.7]) {
      g.plate('thatchDark', 3.5, 0.58, 0.07,
        cx, ridgeYAt(cx) + s.dy * 0.02 + s.ny * 0.1, ridgeZAt(cx) + s.dz * 0.02 + s.nz * 0.1,
        s.theta, 0, 0.008, { bevel: 0.015, tile: 1.6 });
    }
  }
  // saddle strip along the very top
  for (const cx of [-1.72, 1.72]) {
    g.plate('thatch', 3.46, 0.28, 0.32, cx, ridgeYAt(cx) + 0.13, ridgeZAt(cx) + 0.005, 0, 0, 0.015, {
      bevel: 0.02,
      tile: 1.4,
    });
  }
  // loose straw shedding off both sides of the ridge cap
  for (const sl of [{ zEave: EAVE_ZF, sign: -1 }, { zEave: EAVE_ZB, sign: 1 }]) {
    for (let i = 0; i < (hi ? 15 : 9); i++) {
      const x = -ROOF_X + 0.15 + (i / (hi ? 14 : 8)) * (2 * ROOF_X - 0.3) + j(0.06);
      const s = slopeAt(x, sl.zEave);
      const drop = 0.1 + rng() * 0.13;
      g.blade(i % 2 ? 'thatch' : 'thatchDark', 0.09 + rng() * 0.11, drop,
        x, ridgeYAt(x) + 0.1, ridgeZAt(x) + sl.sign * (0.16 + rng() * 0.05),
        sl.sign * (0.9 + rng() * 0.25), j(0.35), j(0.2), { tip: 0.35, bend: 0.015 });
    }
  }
  const wraps = hi ? 5 : 3;
  for (let i = 0; i < wraps; i++) {
    const x = -2.9 + (i / (wraps - 1)) * 5.8;
    g.ring('rope', 0.135, 0.023, x, ridgeYAt(x) + 0.09, ridgeZAt(x), 0, Math.PI / 2, 0, {
      radialSeg: 4,
      tubularSeg: 7,
      tile: 0.7,
    });
    if (i % 3 === 0) {
      g.ball('rope', 0.045, x + 0.02, ridgeYAt(x) + 0.24, ridgeZAt(x) + 0.02, 0, 0, 0, {
        segW: 7,
        segH: 5,
        tile: 0.5,
        sy: 0.8,
      });
    }
  }
  // ridge finial: short crossed bamboo poles sticking up at both ends
  for (const sx of [-1, 1]) {
    g.rod('bamboo', sx * (ROOF_X + 0.02), ridgeYAt(sx * ROOF_X) + 0.1, ridgeZAt(sx * ROOF_X),
      sx * (ROOF_X + 0.02), ridgeYAt(sx * ROOF_X) + 0.34, ridgeZAt(sx * ROOF_X), 0.03, { radial: 5, tile: 0.8 });
    g.rod('thatchDark', sx * (ROOF_X + 0.02) - 0.08, ridgeYAt(sx * ROOF_X) + 0.24, ridgeZAt(sx * ROOF_X) + 0.06,
      sx * (ROOF_X + 0.02) + 0.08, ridgeYAt(sx * ROOF_X) + 0.24, ridgeZAt(sx * ROOF_X) - 0.06, 0.03, { radial: 4, tile: 0.6 });
  }

  // ---- gable ends: barge boards, triangular woven infill, king post, braces
  for (const sx of [-1, 1]) {
    const gx = sx * (ROOF_X - 0.02);
    // barge boards follow the two roof slopes
    for (const zEave of [EAVE_ZF, EAVE_ZB]) {
      const s = slopeAt(0, zEave);
      const cz = ridgeZAt(0) + s.dz * 0.5;
      const cy = ridgeYAt(0) + s.dy * 0.5;
      g.plate('woodDark', 0.12, s.len, 0.18, gx, cy - s.ny * 0.02, cz - s.nz * 0.02, s.theta, 0, 0, {
        bevel: 0.01,
        tile: 1.3,
      });
    }
    // woven infill slats filling the gable triangle above the wall plate
    const wallX = sx * (WALL_X + 0.01);
    for (let i = 0; i < (hi ? 4 : 3); i++) {
      const yy = WALL_TOP + 0.2 + i * 0.5;
      // roof height half-span at this y on both slopes
      const fr = (yy - EAVE_Y) / (RIDGE_Y - EAVE_Y); // 0 at eave, 1 at ridge
      const zf = EAVE_ZF + fr * (RIDGE_Z - EAVE_ZF);
      const zb = EAVE_ZB + fr * (RIDGE_Z - EAVE_ZB);
      const span = zb - zf - 0.1;
      if (span < 0.25) continue;
      g.plate('woven', 0.035, 0.3, span,
        wallX, yy, (zf + zb) / 2, 0, 0, j(0.02), { bevel: 0.006, tile: 1.0 });
      // horizontal slat framing
      g.plate('woodDark', 0.06, 0.05, span + 0.06, wallX + sx * 0.03, yy + 0.18, (zf + zb) / 2, 0, 0, 0, {
        bevel: 0.005,
        tile: 1.0,
      });
    }
    // king post + diagonal braces
    g.plate('woodDark', 0.12, RIDGE_Y - WALL_TOP - 0.1, 0.12, wallX, (WALL_TOP + RIDGE_Y) / 2, RIDGE_Z, 0, 0, 0, {
      bevel: 0.01,
      tile: 1.2,
    });
    g.rod('woodDark', wallX, WALL_TOP + 0.1, -1.1, wallX, RIDGE_Y - 0.35, RIDGE_Z, 0.045, { radial: 4, tile: 1.0 });
    g.rod('woodDark', wallX, WALL_TOP + 0.1, 1.0, wallX, RIDGE_Y - 0.35, RIDGE_Z, 0.045, { radial: 4, tile: 1.0 });
  }
}

// ---------------------------------------------------------------------------
// Door + windows
// ---------------------------------------------------------------------------
function buildDoorAndWindows(g, hi, rng, j) {
  // dark interior volume seen through the openings (cheap box of `dark`)
  g.plate('dark', 4.2, 2.05, 3.0, 0, 2.76, 0.12, 0, 0, 0, { bevel: 0.008, tile: 1.8 });
  g.plate('dark', 4.2, 0.03, 3.0, 0, FLOOR + 0.015, 0.12, 0, 0, 0, { bevel: 0.008, tile: 1.8 });
  // deeper shadow board just behind the door opening keeps the doorway reading black
  g.plate('dark', 1.18, 1.9, 0.02, 0, 2.44, WALL_FRONT + 0.34, 0, 0, 0, { bevel: 0.005, tile: 1.2 });

  // ---- door opening on the front wall
  for (const sx of [-1, 1]) {
    g.plate('woodDark', 0.13, 1.95, 0.19, sx * 0.63, 2.46, WALL_FRONT + 0.02, 0, j(0.02), 0, { bevel: 0.012, tile: 1.1 });
    g.ring('rope', 0.105, 0.02, sx * 0.63, FLOOR + 0.28, WALL_FRONT, Math.PI / 2, 0, 0, {
      radialSeg: 4,
      tubularSeg: 6,
      tile: 0.6,
    });
  }
  g.plate('wood', 1.55, 0.17, 0.22, 0, 3.44, WALL_FRONT - 0.03, 0, 0, 0.004, { bevel: 0.014, tile: 1.2 });
  g.plate('woodDark', 1.6, 0.09, 0.34, 0, FLOOR + 0.05, WALL_FRONT - 0.12, 0, 0, 0, { bevel: 0.01, tile: 1.3 });
  g.plate('ruinStoneDark', 0.7, 0.1, 0.42, 0, FLOOR - 0.02, WALL_FRONT - 0.42, 0, 0, 0, { bevel: 0.01, tile: 1.3 });

  // pair of woven/bamboo door leaves swung fully open flat against the front wall
  for (const sx of [-1, 1]) {
    const leaf = g.frame(sx * 0.56, 0, WALL_FRONT - 0.12, sx > 0 ? 0 : Math.PI);
    leaf.plate('woven', 0.52, 1.8, 0.035, 0.26, 2.46, 0, 0, 0, 0, { bevel: 0.008, tile: 1.3 });
    for (let i = 0; i < 2; i++) {
      leaf.plate(i ? 'woodDark' : 'bamboo', 0.05, 1.72, 0.02, 0.12 + i * 0.26, 2.46, -0.028, 0, 0, 0, {
        bevel: 0.005,
        tile: 0.9,
      });
    }
    for (const yy of [1.98, 2.96]) {
      leaf.ring('rope', 0.05, 0.013, 0.03, yy, 0, Math.PI / 2, 0, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.5 });
    }
  }
  // woven sitting mat left out on the veranda
  g.plate('woven', 1.5, 0.03, 1.0, -0.75, FLOOR + 0.02, -2.6, 0, 0.18, 0, { bevel: 0.006, tile: 1.4 });
  // rolled-up mat blind above the door + two rope ties
  g.cyl('bamboo', 0.075, 0.075, 1.16, 0, 3.62, WALL_FRONT - 0.13, 0, 0, Math.PI / 2, { radial: 8, tile: 1.0 });
  for (const sx of [-1, 1]) {
    g.ring('rope', 0.085, 0.014, sx * 0.44, 3.62, WALL_FRONT - 0.13, 0, 0, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.5 });
    g.rod('rope', sx * 0.44, 3.66, WALL_FRONT - 0.13, sx * 0.44, 3.9, WALL_FRONT - 0.16, 0.01, { radial: 4, tile: 0.5 });
  }

  // ---- front window (right of the door)
  const wx = 1.5;
  const wy = 2.9;
  g.plate('dark', 0.7, 0.62, 0.02, wx, wy, WALL_FRONT + 0.005, 0, 0, 0, { bevel: 0.005, tile: 1.0 });
  g.plate('woodDark', 0.86, 0.08, 0.2, wx, wy - 0.36, WALL_FRONT - 0.02, 0, 0, 0, { bevel: 0.008, tile: 1.1 });
  g.plate('woodDark', 0.86, 0.08, 0.2, wx, wy + 0.36, WALL_FRONT - 0.02, 0, 0, 0, { bevel: 0.008, tile: 1.1 });
  for (const sx of [-1, 1]) {
    g.plate('woodDark', 0.08, 0.8, 0.18, wx + sx * 0.46, wy, WALL_FRONT - 0.02, 0, 0, 0, { bevel: 0.008, tile: 1.1 });
  }
  // bamboo bars + a half-open woven shutter
  for (let i = 0; i < 3; i++) {
    g.rod('bamboo', wx - 0.38, wy - 0.2 + i * 0.2, WALL_FRONT - 0.08, wx + 0.38, wy - 0.2 + i * 0.2, WALL_FRONT - 0.08, 0.016, {
      radial: 4,
      tile: 0.6,
    });
  }
  const shutter = g.frame(wx + 0.47, wy, WALL_FRONT - 0.05, -0.9);
  shutter.plate('woven', 0.42, 0.68, 0.03, -0.21, 0, 0, 0, 0, 0, { bevel: 0.006, tile: 1.1 });
  for (let i = 0; i < 3; i++) {
    shutter.plate('bamboo', 0.4, 0.05, 0.018, -0.21, -0.22 + i * 0.22, -0.024, 0, 0, 0, { bevel: 0.004, tile: 0.8 });
  }

  // ---- side window on the +X wall
  const sy = 2.92;
  g.plate('dark', 0.56, 0.5, 0.02, WALL_X - 0.005, sy, -0.6, 0, Math.PI / 2, 0, { bevel: 0.005, tile: 1.0 });
  for (const dz of [-0.36, 0.36]) {
    g.plate('woodDark', 0.18, 0.07, 0.72, WALL_X + 0.02, sy + dz, -0.6, 0, 0, 0, { bevel: 0.007, tile: 1.1 });
  }
  for (const dz of [-0.35, 0.35]) {
    g.plate('woodDark', 0.18, 0.66, 0.07, WALL_X + 0.02, sy, -0.6 + dz, 0, 0, 0, { bevel: 0.007, tile: 1.1 });
  }
  if (hi) {
    for (let i = 0; i < 4; i++) {
      g.rod('bamboo', WALL_X + 0.05, sy - 0.18 + i * 0.12, -0.92, WALL_X + 0.05, sy - 0.18 + i * 0.12, -0.28, 0.013, {
        radial: 4,
        tile: 0.6,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Front ladder
// ---------------------------------------------------------------------------
function buildLadder(g, hi, rng, j) {
  const base = { x: 0, y: 0.02, z: -3.48 };
  const top = { x: 0, y: FLOOR + 0.05, z: -3.04 };
  const lean = Math.atan2(top.z - base.z, top.y - base.y);
  const len = Math.hypot(top.z - base.z, top.y - base.y);
  const mid = { y: (base.y + top.y) / 2, z: (base.z + top.z) / 2 };
  for (const sx of [-1, 1]) {
    g.plate('wood', 0.1, len, 0.13, base.x + sx * 0.34, mid.y, mid.z, lean, j(0.02), j(0.02), {
      bevel: 0.012,
      tile: 1.2,
    });
    // small stake at the foot
    g.rod('woodDark', base.x + sx * 0.34, 0.0, base.z - 0.03, base.x + sx * 0.34, 0.3, base.z + 0.06, 0.04, { radial: 4, tile: 0.9 });
  }
  const steps = hi ? 6 : 4;
  for (let i = 0; i < steps; i++) {
    const t = 0.13 + (i / (steps - 1)) * 0.8;
    const y = base.y + (top.y - base.y) * t;
    const z = base.z + (top.z - base.z) * t;
    g.plate('woodDark', 0.7, 0.055, 0.17, base.x + j(0.012), y, z, lean, j(0.03), j(0.02), {
      bevel: 0.008,
      tile: 1.0,
    });
    if (hi && i % 3 === 0) {
      for (const sx of [-1, 1]) {
        g.ring('rope', 0.055, 0.014, base.x + sx * 0.33, y + 0.02, z, 0, Math.PI / 2, 0, {
          radialSeg: 4,
          tubularSeg: 5,
          tile: 0.5,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Veranda railing
// ---------------------------------------------------------------------------
function buildVerandaRail(g, hi, rng) {
  const railTop = FLOOR + 1.0;
  // front railing leaves a gap in the middle for the ladder
  for (const seg of [[-2.62, -1.12], [1.12, 2.62]]) {
    const [x0, x1] = seg;
    for (const x of [x0, x1]) {
      g.plate('wood', 0.085, 1.04, 0.085, x, FLOOR + 0.5, DECK_FRONT + 0.04, 0, 0.0, 0, { bevel: 0.01, tile: 1.0 });
      g.ring('rope', 0.06, 0.014, x, FLOOR + 0.07, DECK_FRONT + 0.04, Math.PI / 2, 0, 0, {
        radialSeg: 4,
        tubularSeg: 6,
        tile: 0.5,
      });
    }
    g.plate('bamboo', x1 - x0 + 0.06, 0.075, 0.075, (x0 + x1) / 2, railTop, DECK_FRONT + 0.04, 0, 0, 0.004, {
      bevel: 0.008,
      tile: 1.0,
    });
    g.plate('bamboo', x1 - x0 + 0.02, 0.055, 0.055, (x0 + x1) / 2, FLOOR + 0.48, DECK_FRONT + 0.04, 0, 0, 0.004, {
      bevel: 0.006,
      tile: 0.9,
    });
    for (let i = 1; i <= 2; i++) {
      const x = x0 + (i / 3) * (x1 - x0);
      g.rod('bamboo', x, FLOOR + 0.02, DECK_FRONT + 0.04, x, railTop - 0.02, DECK_FRONT + 0.04, 0.025, { radial: 4, tile: 0.8 });
    }
  }
  // side railings
  if (hi) {
    for (const sx of [-1, 1]) {
      const x = sx * (DECK_X - 0.04);
      for (const z of [DECK_FRONT + 0.03, -2.02]) {
        g.plate('wood', 0.08, 1.0, 0.08, x, FLOOR + 0.48, z, 0, 0, 0, { bevel: 0.009, tile: 1.0 });
      }
      g.plate('bamboo', 0.07, 0.07, 1.06, x, railTop, (DECK_FRONT + -2.02) / 2, 0, 0, 0, { bevel: 0.008, tile: 1.0 });
      g.rod('bamboo', x, FLOOR + 0.03, -2.6, x, railTop - 0.03, -2.6, 0.024, { radial: 4, tile: 0.7 });
    }
  }
}

// ---------------------------------------------------------------------------
// Hanging props under the eave: pots, dried fish, herbs, net, rope, baskets
// ---------------------------------------------------------------------------
function clayPot(g, x, y, z, scale, segments, ry = 0, rim = true) {
  const p = [
    [0.02, 0],
    [0.1 * scale, 0],
    [0.15 * scale, 0.07 * scale],
    [0.145 * scale, 0.16 * scale],
    [0.11 * scale, 0.24 * scale],
    [0.088 * scale, 0.27 * scale],
    [0.105 * scale, 0.295 * scale],
    [0.02, 0.3 * scale],
  ];
  g.lathe('thatchDark', p, x, y, z, 0, ry, 0, { segments, tile: 0.8 });
  if (rim) {
    g.ring('rope', 0.1 * scale, 0.013, x, y + 0.285 * scale, z, Math.PI / 2, 0, 0, {
      radialSeg: 4,
      tubularSeg: 8,
      tile: 0.5,
    });
  }
}

function driedFish(g, x, y, z, ry) {
  g.ball('thatchDark', 0.075, x, y, z, 0, ry, 0, { segW: 8, segH: 5, sx: 1.0, sy: 0.34, sz: 0.46, tile: 0.6 });
  g.plate('thatchDark', 0.09, 0.065, 0.012, x + Math.sin(ry) * 0.08, y, z + Math.cos(ry) * 0.08, 0, ry, 0.5, {
    bevel: 0.003,
    tile: 0.4,
  });
}

function buildHangingProps(g, hi, rng, j) {
  // bamboo pole slung under the veranda eave
  const poleY = 3.58;
  const poleZ = -2.6;
  g.rod('bamboo', -2.35, poleY, poleZ, 2.35, poleY, poleZ + 0.05, 0.035, { radial: 6, tile: 1.2 });
  for (const sx of [-1, 1]) {
    g.rod('rope', sx * 2.25, poleY, poleZ, sx * 2.5, 3.86, -2.42, 0.012, { radial: 4, tile: 0.6 });
  }

  // two clay water jars hanging from the pole
  for (const [px, sc] of [[-1.55, 1.2], [1.34, 1.05]]) {
    clayPot(g, px, poleY - 0.78, poleZ, sc, hi ? 10 : 8, j(0.3));
    const topY = poleY - 0.78 + 0.3 * sc;
    for (const dx of [-0.09, 0.09]) {
      g.rod('rope', px + dx, poleY, poleZ, px + dx * 1.1, topY, poleZ, 0.009, { radial: 4, tile: 0.5 });
    }
  }
  // two coconut-shell cups hung beside the jars
  for (const cx of [-0.35, 0.02]) {
    g.ball('woodDark', 0.085, cx, poleY - 0.5, poleZ + 0.03, 0, j(0.4), 0, {
      segW: 8,
      segH: 5,
      sy: 0.8,
      tile: 0.5,
    });
    g.rod('rope', cx, poleY, poleZ, cx, poleY - 0.42, poleZ + 0.03, 0.008, { radial: 4, tile: 0.5 });
  }

  // strings of dried fish
  const strings = hi ? 2 : 1;
  for (let s = 0; s < strings; s++) {
    const fx = -0.85 + s * 0.8;
    const len = 0.5 + s * 0.06;
    g.rod('rope', fx, poleY, poleZ + 0.02, fx, poleY - len, poleZ + 0.02, 0.008, { radial: 4, tile: 0.5 });
    for (let k = 0; k < 2; k++) {
      const fy = poleY - 0.16 - k * 0.22;
      driedFish(g, fx, fy, poleZ + 0.02, j(0.25));
    }
  }

  // bundle of drying herbs
  const hx = 0.62;
  for (let i = 0; i < 4; i++) {
    g.plate('thatchDark', 0.05, 0.36 + rng() * 0.1, 0.015, hx + j(0.05), poleY - 0.3, poleZ + j(0.04), j(0.12), j(0.6), j(0.15), {
      bevel: 0.003,
      tile: 0.6,
    });
  }
  g.ring('rope', 0.045, 0.014, hx, poleY - 0.1, poleZ, Math.PI / 2, 0, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.5 });

  if (!hi) return;

  // fishing net draped over the right-hand railing
  for (let i = 0; i < 4; i++) {
    const x = 1.3 + i * 0.22;
    g.rod('rope', x, FLOOR + 1.0, DECK_FRONT + 0.02, x + 0.05, FLOOR + 0.35, DECK_FRONT - 0.03, 0.009, { radial: 4, tile: 0.5 });
  }
  g.tube('rope', [
    new THREE.Vector3(1.28, FLOOR + 0.62, DECK_FRONT - 0.02),
    new THREE.Vector3(1.72, FLOOR + 0.46, DECK_FRONT - 0.02),
    new THREE.Vector3(2.14, FLOOR + 0.66, DECK_FRONT - 0.02),
  ], 0.012, { tubularSeg: 10, radialSeg: 4, tile: 0.6 });
  for (const fx of [1.32, 1.86]) {
    g.ball('thatchDark', 0.04, fx, FLOOR + 0.74, DECK_FRONT + 0.04, 0, 0, 0, { segW: 7, segH: 5, tile: 0.4 });
  }

  // coil of spare rope on the deck
  g.ring('rope', 0.17, 0.022, -1.9, FLOOR + 0.04, -2.55, Math.PI / 2, 0, 0, {
    radialSeg: 4,
    tubularSeg: 10,
    tile: 0.7,
  });
  // water jar standing on the veranda next to the door
  clayPot(g, -1.92, FLOOR + 0.02, -2.35, 0.92, hi ? 10 : 7, 0.7);

  // woven bamboo basket on the veranda
  const bx = 1.86;
  const bz = -2.42;
  const prof = [
    [0.02, 0],
    [0.16, 0],
    [0.19, 0.09],
    [0.205, 0.22],
    [0.19, 0.3],
    [0.165, 0.3],
  ];
  g.lathe('bamboo', prof, bx, FLOOR + 0.02, bz, 0, 0.3, 0, { segments: 12, tile: 0.8 });
  g.ring('bamboo', 0.205, 0.016, bx, FLOOR + 0.24, bz, Math.PI / 2, 0.3, 0, { radialSeg: 4, tubularSeg: 10, tile: 0.6 });
  g.ring('rope', 0.17, 0.012, bx, FLOOR + 0.34, bz, Math.PI / 2, 0.3, 0, { radialSeg: 4, tubularSeg: 8, tile: 0.5 });
  g.tube('rope', [
    new THREE.Vector3(bx - 0.16, FLOOR + 0.33, bz),
    new THREE.Vector3(bx, FLOOR + 0.46, bz + 0.03),
    new THREE.Vector3(bx + 0.16, FLOOR + 0.33, bz),
  ], 0.014, { tubularSeg: 8, radialSeg: 4, tile: 0.5 });
}

// ---------------------------------------------------------------------------
// Ground dressing: step stones, storage under the deck, litter
// ---------------------------------------------------------------------------
function buildGroundDressing(g, hi, rng, j) {
  // step stones at the foot of the ladder
  const stones = [
    [-0.42, 0.14, -3.62, 0.22],
    [0.28, 0.12, -3.7, 0.19],
  ];
  for (const [sx, sy, sz, r] of stones) {
    g.rock('mossStone', r, sx, sy, sz, { detail: 1, seed: 31 + Math.round(sx * 10), flatten: 0.5, tile: 1.3 });
  }
  // trampled litter under the hut
  if (hi) {
    for (let i = 0; i < 3; i++) {
      g.plate('leafLitter', 0.22 + rng() * 0.12, 0.014, 0.17 + rng() * 0.09,
        j(1.4) + 0.2, 0.02, j(1.0) + 0.3, 0, rng() * Math.PI, j(0.05), { bevel: 0.003, tile: 0.9 });
    }
  }
  // firewood stacked between the back posts
  if (hi) {
    for (let i = 0; i < 5; i++) {
      const y = 0.09 + (i % 3) * 0.09;
      g.rod('woodDark', -1.5 + i * 0.06, y, 0.6 + i * 0.02, -1.5 + i * 0.06, y, 1.5 + i * 0.02, 0.05, { radial: 5, tile: 1.0 });
    }
    g.plate('woodDark', 0.06, 0.44, 1.0, -1.72, 0.22, 1.05, 0, 0, 0, { bevel: 0.006, tile: 1.0 });
    g.plate('woodDark', 0.06, 0.44, 1.0, -1.28, 0.22, 1.05, 0, 0, 0, { bevel: 0.006, tile: 1.0 });
  }
  // storage jar under the hut
  clayPot(g, 1.42, 0.02, 0.72, 1.15, hi ? 10 : 8, 0.4, false);
  g.lathe('thatchDark', [
    [0.02, 0],
    [0.11, 0],
    [0.15, 0.06],
    [0.14, 0.2],
    [0.1, 0.28],
    [0.11, 0.3],
    [0.02, 0.3],
  ], 1.72, 0.09, 1.05, 0.5, 0.9, 0, { segments: hi ? 9 : 7, tile: 0.8 });
  g.rod('bamboo', 2.05, 0.02, 1.35, 1.9, 1.55, 1.52, 0.035, { radial: 5, tile: 1.1 });
  // scattered leaf litter near the footings
  if (hi) {
    for (let i = 0; i < 4; i++) {
      g.plate('leafLitter', 0.16 + rng() * 0.08, 0.014, 0.13 + rng() * 0.06,
        j(1.6), 0.02, j(1.3) - 0.3, 0, rng() * Math.PI, j(0.05), { bevel: 0.003, tile: 0.9 });
    }
  }
}
