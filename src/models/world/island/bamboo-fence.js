/**
 * ISLAND VILLAGE — V3 BAMBOO FENCE (竹篱).
 *
 * A split-bamboo fence of the village edge: five posts lashed to two horizontal
 * rails, flattened bamboo pickets pushed in at slightly different angles, rope
 * bindings at every joint, and a small gate frame with a half-open bamboo door
 * at one end.
 *
 * Conventions: metres, +Y up, the fence line runs along X, front (-Z) faces the
 * path; model bottom on y = 0. Triangle budget (stage): 2,000–4,000.
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

/** Shift a geometry's UVs by a whole-tile offset so neighbouring pickets do not
 *  show the same bamboo node / smoke stain at the same height (audit D-19). */
function shiftUV(geo, [du, dv]) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
  uv.needsUpdate = true;
  return geo;
}

export const meta = { id: 'bamboo-fence', kind: 'world', group: 'village', label: '竹篱 · BAMBOO FENCE' };

// ---------------------------------------------------------------------------
// Dimensions (metres)
// ---------------------------------------------------------------------------
const X0 = -2.0;       // fence start
const X1 = 2.0;        // fence end
const POST_Y = 1.42;   // post height above ground
const RAIL_TOP = 1.24;
const RAIL_MID = 0.72;
const GATE_X = 1.08;   // left post of the gate frame

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
      const geo = plateGeo(w, h, d, opts);
      if (opts && opts.uvOffset) shiftUV(geo, opts.uvOffset);
      if (opts && opts.tint) prepareTint(geo, x, y, z, key, opts.tint);
      add(key, geo, matrixFor(x, y, z, rx, ry, rz));
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
    tube(key, pts, r, opts) {
      add(key, tubeGeo(pts, r, opts));
    },
  };
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------
export function build(ctx) {
  island(ctx).fences = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildFences(ctx);
}

export function buildWorld(ctx) {
  buildFences(ctx);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildFences(ctx) {
  const items = island(ctx).fences || [];
  if (!items.length) return;
  const hi = ctx.stage === true;
  items.forEach((item, i) => buildFence(ctx, item, hi, 5170 + i * 31));
}

// ---------------------------------------------------------------------------
// One fence
// ---------------------------------------------------------------------------
function buildFence(ctx, item, hi, seed) {
  const s = item.s ?? 1;
  const g = gfx(ctx, matrixFor(item.x ?? 0, item.y ?? 0, item.z ?? 0, 0, item.ry ?? 0, 0, s, s, s));
  const rng = makeRNG(seed);
  const j = (a) => (rng() * 2 - 1) * a;

  // ------------------------------------------------------------------ posts
  const postXs = [X0, -1.24, -0.46, 0.32, GATE_X];
  for (let i = 0; i < postXs.length; i++) {
    const px = postXs[i];
    const lean = j(0.02);
    // footing stone
    g.rock('mossStone', 0.15, px + j(0.02), 0.1, j(0.02), { detail: 1, seed: 11 + i, flatten: 0.5, tile: 1.3 });
    // round post with an angled cut on top
    g.cyl('wood', 0.055, 0.062, POST_Y, px, POST_Y / 2 + 0.02, 0, lean, 0, j(0.015), { radial: 7, tile: 1.2 });
    g.cyl('woodDark', 0.058, 0.05, 0.09, px + 0.006, POST_Y + 0.02, 0.004, 0.18 + j(0.1), 0.4, lean, {
      radial: 6,
      tile: 1.0,
    });
    // rope collar where the rails are tied on
    for (const ry of [RAIL_TOP, RAIL_MID]) {
      g.ring('rope', 0.075, 0.017, px + Math.sin(lean) * ry, ry, -Math.sin(lean) * ry, Math.PI / 2, 0, 0, {
        radialSeg: 4,
        tubularSeg: 6,
        tile: 0.5,
      });
      // dangling knot / tie ends
      g.cyl('rope', 0.014, 0.008, 0.09, px + 0.07, ry - 0.05, -0.05, 0.2, 0, 0.3, { radial: 4, tile: 0.4 });
    }
    if (i === 0 && hi) {
      // a short stub of bamboo tied vertically to the end post
      g.cyl('bamboo', 0.03, 0.03, 0.6, px + 0.09, 0.5, 0.05, 0.1, 0, -0.06, { radial: 5, tile: 0.8 });
    }
  }

  // ------------------------------------------------------------------ rails
  for (const ry of [RAIL_TOP, RAIL_MID]) {
    g.rod('bamboo', X0 - 0.04, ry, 0, GATE_X + 0.05, ry + 0.01, 0.002, 0.042, { radial: 6, tile: 1.1 });
    // thin rail behind the pickets to clamp them
    if (hi) {
      g.rod('bamboo', X0 + 0.05, ry - 0.1, 0.07, GATE_X - 0.05, ry - 0.09, 0.07, 0.026, { radial: 4, tile: 0.9 });
    }
  }

  // ---------------------------------------------------------------- pickets
  // Split-bamboo pickets, driven in at slightly different angles and heights.
  const count = hi ? 26 : 16;
  // 2-3 sun-bleached / dry-bamboo pickets break the uniform pale row (audit D-19)
  const dryIdx = new Set([2, 11, 20]);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const px = X0 + 0.1 + t * (GATE_X - X0 - 0.2) + j(0.02);
    // burnt / broken / dry pickets are a little shorter, ±17 %
    const h = 0.98 + rng() * 0.4;
    const tilt = j(0.09);
    const w = 0.062 + rng() * 0.045;
    const back = i % 2 === 0 ? -1 : 1; // alternate in front of / behind the rails
    const dry = dryIdx.has(i);
    const key = dry ? 'wood' : i % 9 === 0 ? 'woodDark' : 'bamboo';
    g.plate(key, w, h, 0.022,
      px, 0.02 + h / 2 + (rng() - 0.5) * 0.03, back * (0.032 + rng() * 0.01),
      0, j(0.05), tilt, {
        bevel: 0.005,
        tile: 0.9,
        // every picket samples its own bamboo node band
        uvOffset: [rng(), rng()],
        tint: dry ? [1.04, 0.95, 0.72] : null,
      });
    // pointed / split top of the picket
    if (i % 3 === 0) {
      g.plate('bamboo', w * 0.8, 0.12, 0.02, px + Math.sin(tilt) * h * 0.1, 0.02 + h + 0.02, back * 0.035, 0.3, 0, tilt * 0.5, {
        bevel: 0.004,
        tile: 0.7,
        uvOffset: [rng(), rng()],
      });
    }
    // rope knot where the picket crosses the rails (every 4th picket, cheap)
    if (hi && i % 4 === 1) {
      const ry = i % 8 === 1 ? RAIL_TOP : RAIL_MID;
      g.ring('rope', 0.046, 0.013, px, ry, back * 0.036, Math.PI / 2, 0, 0, {
        radialSeg: 4,
        tubularSeg: 5,
        tile: 0.05,
      });
    }
  }
  // two pickets have fallen out: they now lean with the lower end on the ground and
  // the upper end lashed against the top rail (no more floating "loose sticks")
  for (const [fx, tiltZ, key, ww] of [[-1.52, 0.16, 'bamboo', 0.085], [0.62, -0.14, 'wood', 0.072]]) {
    const bh = 1.32;
    const rx = 0.42;
    const cy = 0.03 + (bh / 2) * Math.cos(rx);
    const cz = 0.07 - (bh / 2) * Math.sin(rx);
    g.plate(key, ww, bh, 0.022, fx, cy, cz, rx, 0, tiltZ, { bevel: 0.005, tile: 0.9, uvOffset: [rng(), rng()] });
    // lashing at the top-rail contact
    g.ring('rope', 0.048, 0.014, fx, RAIL_TOP, 0.07, Math.PI / 2, 0, 0, {
      radialSeg: 4,
      tubularSeg: 6,
      tile: 0.5,
    });
  }

  // ------------------------------------------------------------- gate frame
  // taller gate posts with a lintel and a half-open bamboo door
  for (const gx of [GATE_X, X1]) {
    g.rock('mossStone', 0.17, gx, 0.11, 0, { detail: 1, seed: 60 + Math.round(gx), flatten: 0.5, tile: 1.3 });
    g.cyl('wood', 0.06, 0.068, 1.46, gx, 0.75, 0, 0, 0, 0, { radial: 7, tile: 1.2 });
    g.cyl('woodDark', 0.064, 0.05, 0.08, gx, 1.5, 0, 0.12, 0.4, 0, { radial: 6, tile: 1.0 });
    for (const ry of [1.0, 1.4]) {
      g.ring('rope', 0.08, 0.017, gx, ry, 0, Math.PI / 2, 0, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.5 });
    }
  }
  g.rod('bamboo', GATE_X - 0.06, 1.4, 0, X1 + 0.06, 1.41, 0.01, 0.045, { radial: 6, tile: 1.1 });
  // latch post and a small rope loop
  g.ring('rope', 0.05, 0.014, X1 - 0.1, 1.08, -0.04, 0, Math.PI / 2, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.4 });

  // half-open door: five pickets on two battens, hinged on the left gate post
  // (swings out toward the path so the doorway reads from the front view)
  const door = g.frame(GATE_X + 0.05, 0, 0, 0.5);
  for (let i = 0; i < 5; i++) {
    const dx = 0.09 + i * 0.17;
    g.plate(i % 2 ? 'bamboo' : 'wood', 0.075, 1.06 + (i % 2) * 0.05, 0.02, dx, 0.6, 0, 0, 0, 0.02, {
      bevel: 0.005,
      tile: 0.9,
    });
  }
  for (const dy of [0.28, 1.0]) {
    g.plate('woodDark', 0.86, 0.055, 0.026, 0.48, dy, 0.03, 0, 0, 0.01, { bevel: 0.006, tile: 0.9 });
  }
  // hinge lashings
  for (const dy of [0.34, 1.0]) {
    door.ring('rope', 0.045, 0.014, 0.04, dy, 0, Math.PI / 2, 0, 0, { radialSeg: 4, tubularSeg: 6, tile: 0.4 });
  }
  // loose latch rope hanging off the free edge of the door
  g.cyl('rope', 0.012, 0.008, 0.22, 1.95, 0.78, -0.24, 0.1, 0, 0.2, { radial: 4, tile: 0.4 });

  // -------------------------------------------------------------- ground bits
  // trodden litter and a couple of stones along the fence line
  for (let i = 0; i < (hi ? 5 : 2); i++) {
    g.plate('leafLitter', 0.16 + rng() * 0.1, 0.014, 0.12 + rng() * 0.08,
      X0 + 0.3 + rng() * 3.4, 0.02, -0.2 + rng() * 0.4, 0, rng() * Math.PI, j(0.04), { bevel: 0.003, tile: 0.9 });
  }
  g.rock('ruinStoneDark', 0.13, -1.6, 0.1, -0.18, { detail: 1, seed: 71, flatten: 0.45, tile: 1.2 });
  g.rock('mossStone', 0.1, 0.55, 0.09, 0.2, { detail: 1, seed: 72, flatten: 0.5, tile: 1.2 });
  // bamboo offcuts leaning against the right-hand gate post: butt on the ground,
  // top resting against the post (they used to float in mid-air, audit D-19)
  for (const [ox, oz, oh, orx, ory] of [[1.9, -0.24, 1.12, 0.34, 0.12], [1.78, -0.32, 0.94, 0.4, -0.1]]) {
    const topX = 2.0 + (ox - 2.0) * 0.12;
    const topY = oh * Math.cos(orx);
    g.rod('bamboo', ox, 0.02, oz, topX, Math.min(topY, 1.3), 0.02, 0.026, { radial: 4, tile: 0.9 });
  }
  void THREE;
}
