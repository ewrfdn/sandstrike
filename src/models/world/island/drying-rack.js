/**
 * ISLAND VILLAGE — V4 DRYING RACK (晾晒架).
 *
 * Bamboo-and-timber drying rack: two A-frame legs tied to a ridge pole, three
 * bamboo hanging poles, a sagging rope net, strings of dried fish and seaweed,
 * stone weights holding the net down and two woven baskets underneath.
 *
 * Conventions: metres, +Y up, front faces -Z; model bottom on y = 0.
 * Triangle budget (stage): 1,500–3,500.
 */
import * as THREE from 'three';
import { matrixFor } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { cylGeo, latheGeo, plateGeo, rockGeo, rodGeo, sphereGeo, torusGeo, tubeGeo } from '../detail.js';
import { leafQuad } from './leaf-atlas.js';

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

export const meta = { id: 'drying-rack', kind: 'world', group: 'village', label: '晾晒架 · DRYING RACK' };

const TOP_Y = 2.2;       // bamboo hanging poles
const HALF_X = 1.25;     // half span along the poles
const APEX_Y = 2.42;     // ridge pole height
const FOOT_Z = 0.72;     // A-frame foot spread

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
    tube(key, pts, r, opts) {
      add(key, tubeGeo(pts, r, opts));
    },
    /** Alpha leaf card (kelp strips use the long banana cell). */
    leaf(key, w, h, cell, x, y, z, rx = 0, ry = 0, rz = 0, opts) {
      add(key, leafQuad(w, h, cell, opts), matrixFor(x, y, z, rx, ry, rz));
    },
  };
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------
export function build(ctx) {
  island(ctx).dryingRacks = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildRacks(ctx);
}

export function buildWorld(ctx) {
  buildRacks(ctx);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildRacks(ctx) {
  const items = island(ctx).dryingRacks || [];
  if (!items.length) return;
  const hi = ctx.stage === true;
  items.forEach((item, i) => buildRack(ctx, item, hi, 6310 + i * 43));
}

// ---------------------------------------------------------------------------
// One rack
// ---------------------------------------------------------------------------
function buildRack(ctx, item, hi, seed) {
  const s = item.s ?? 1;
  const g = gfx(ctx, matrixFor(item.x ?? 0, item.y ?? 0, item.z ?? 0, 0, item.ry ?? 0, 0, s, s, s));
  const rng = makeRNG(seed);
  const j = (a) => (rng() * 2 - 1) * a;

  // ------------------------------------------------------------- A-frame legs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lx = sx * HALF_X;
      const footX = lx + sx * 0.16;
      const footZ = sz * FOOT_Z;
      // leaning timber leg
      g.rod('wood', footX, 0.02, footZ, lx, APEX_Y, 0, 0.055, { radial: 5, tile: 1.2 });
      // foot stone
      g.rock('mossStone', 0.14, footX, 0.11, footZ, { detail: 1, seed: 9 + Math.round(footX * 10 + footZ), flatten: 0.5, tile: 1.3 });
      // short cross-foot sill on the ground
      if (sz < 0) {
        g.plate('woodDark', 0.1, 0.1, FOOT_Z * 2, sx * HALF_X, 0.06, 0, 0, 0, 0, { bevel: 0.008, tile: 1.1 });
      }
      // rope lashing where the leg meets the ridge pole
      g.ring('rope', 0.07, 0.016, lx, APEX_Y - 0.08, sz * 0.06, Math.PI / 2, 0, 0, {
        radialSeg: 4,
        tubularSeg: 6,
        tile: 0.5,
      });
      // knee brace
      g.rod('woodDark', lx, APEX_Y - 0.06, 0, footX, APEX_Y * 0.62, footZ * 0.62, 0.035, { radial: 4, tile: 1.0 });
    }
  }
  // ridge pole + lower cross rail
  g.cyl('bamboo', 0.045, 0.045, HALF_X * 2 + 0.22, 0, APEX_Y, 0, 0, 0, Math.PI / 2, { radial: 7, tile: 1.2 });
  g.cyl('bamboo', 0.035, 0.035, HALF_X * 2 + 0.1, 0, APEX_Y - 0.34, 0, 0, 0, Math.PI / 2, { radial: 6, tile: 1.1 });
  // ends of the ridge pole lashed down
  for (const sx of [-1, 1]) {
    g.ring('rope', 0.065, 0.016, sx * (HALF_X + 0.06), APEX_Y, 0, 0, Math.PI / 2, 0, {
      radialSeg: 4,
      tubularSeg: 6,
      tile: 0.5,
    });
  }
  // horizontal stretchers between the legs of each A-frame hold the rack square.
  // The old rail floated between the two frames and read as passing through the
  // legs; now it spans the actual leg surfaces at that height (audit D-20).
  for (const sx of [-1, 1]) {
    const lx = sx * HALF_X;
    const y = 1.04;
    const legX = lx + sx * 0.16 * (1 - y / APEX_Y);
    const legZ = FOOT_Z * (1 - y / APEX_Y);
    g.rod('bamboo', legX, y, -legZ, legX, y, legZ, 0.03, { radial: 5, tile: 1.0 });
    // rope lashing at both ends
    for (const sz of [-1, 1]) {
      g.ring('rope', 0.045, 0.013, legX, y, sz * legZ, 0, 0, Math.PI / 2, {
        radialSeg: 4,
        tubularSeg: 5,
        tile: 0.05,
      });
    }
  }

  // ------------------------------------------------------- hanging poles + net
  const poleZ = [-0.42, -0.14, 0.14, 0.42];
  for (const pz of poleZ) {
    g.cyl('bamboo', 0.028, 0.028, HALF_X * 2, 0, TOP_Y, pz, 0, 0, Math.PI / 2, { radial: 5, tile: 1.0 });
    // short vertical ties up to the ridge pole
    for (const sx of [-1, 1]) {
      g.cyl('rope', 0.011, 0.011, 0.24, sx * (HALF_X - 0.1), TOP_Y + 0.12, pz, 0, 0, 0, { radial: 4, tile: 0.6 });
    }
  }
  // sagging rope net between the outer poles
  const netZ = [-0.46, -0.22, 0.02, 0.26, 0.5];
  const netX = [-1.05, -0.35, 0.35, 1.05];
  for (const pz of poleZ) {
    g.tube('rope', [
      new THREE.Vector3(-HALF_X + 0.1, TOP_Y - 0.03, pz),
      new THREE.Vector3(0, TOP_Y - 0.12, pz + 0.01),
      new THREE.Vector3(HALF_X - 0.1, TOP_Y - 0.03, pz),
    ], 0.009, { tubularSeg: 5, radialSeg: 3, tile: 0.6 });
  }
  for (const nx of netX) {
    // cross cords follow the sag between neighbouring poles
    g.tube('rope', [
      new THREE.Vector3(nx, TOP_Y - 0.035, -0.46),
      new THREE.Vector3(nx, TOP_Y - 0.1, 0.02),
      new THREE.Vector3(nx, TOP_Y - 0.035, 0.5),
    ], 0.008, { tubularSeg: 5, radialSeg: 3, tile: 0.5 });
  }
  void netZ;

  // ------------------------------------------------------ fish + seaweed
  // 2-3 dried fish: silver-grey spindle body, forked tail fin, dark eye, hanging
  // cord over the net. The old "flat paper fish" read as bamboo slips (audit D-20).
  const fish = hi ? 2 : 2;
  for (let i = 0; i < fish; i++) {
    const fx = -0.95 + i * 0.62 + j(0.05);
    const fy = TOP_Y - 0.24 - (i % 2) * 0.05;
    const fz = -0.26 + (i % 3) * 0.26 + j(0.03);
    const yaw = 0.25 + j(0.4);
    // body: spindle (squashed sphere) hanging nose-down
    g.ball('metalDark', 0.085, fx, fy, fz, 0.12, yaw, 0, {
      segW: 8, segH: 5, sx: 0.34, sy: 1.5, sz: 0.5, tile: 0.4,
    });
    // forked tail fin: two small plates fanned out at the top
    for (const sd of [-1, 1]) {
      g.plate('metalDark', 0.1, 0.075, 0.012, fx + Math.sin(yaw) * 0.01 + sd * 0.035, fy + 0.1, fz,
        0.1, yaw, sd * 0.55, { bevel: 0.003, tile: 0.3 });
    }
    // eye dot + gill line
    g.ball('dark', 0.013, fx - Math.cos(yaw) * 0.03, fy - 0.03, fz - Math.sin(yaw) * 0.05 - 0.03, 0, 0, 0, {
      segW: 6, segH: 4, tile: 0.2,
    });
    g.plate('metalDark', 0.05, 0.012, 0.008, fx, fy - 0.02, fz - 0.04, 0, yaw, 0.9, { bevel: 0.002, tile: 0.2 });
    // hanging cord up to the net
    g.cyl('rope', 0.008, 0.008, 0.2, fx, fy + 0.32, fz, 0, 0, 0, { radial: 4, tile: 0.4 });
  }
  // 4 kelp strips: dark-green wavy ribbons (alpha leaves from the banana cell) hung
  // over the poles — these replace the pale bamboo-slat "seaweed" (audit D-20)
  const strips = hi ? 5 : 4;
  for (let i = 0; i < strips; i++) {
    const sx2 = -1.02 + i * 0.5 + j(0.05);
    const z2 = poleZ[i % poleZ.length] + j(0.03);
    const len = 0.5 + rng() * 0.32;
    g.leaf(i % 3 === 0 ? 'broadleafDark' : 'broadleaf', 0.12 + rng() * 0.05, len, 'banana',
      sx2, TOP_Y - 0.06 - len / 2, z2 + 0.015,
      Math.PI + 0.16 + j(0.12), Math.PI / 2 + j(0.25), j(0.25), { bend: 0.03, droop: 0.05 });
    // rope peg holding the strip over the pole
    g.cyl('rope', 0.007, 0.007, 0.06, sx2, TOP_Y - 0.02, z2, Math.PI / 2, 0, 0, { radial: 4, tile: 0.3 });
  }
  // stone weights pinning the net edges
  g.rock('ruinStoneDark', 0.11, -HALF_X + 0.16, TOP_Y - 0.05, 0.5, { detail: 1, seed: 21, flatten: 0.6, tile: 1.1 });
  g.rock('ruinStoneDark', 0.09, HALF_X - 0.14, TOP_Y - 0.05, -0.46, { detail: 1, seed: 22, flatten: 0.6, tile: 1.1 });
  // small shell / gourd hanging as a weight on a cord
  g.ball('thatchDark', 0.06, 0.55, TOP_Y - 0.5, 0.5, 0, 0, 0, { segW: 7, segH: 5, sy: 1.2, tile: 0.5 });
  g.cyl('rope', 0.008, 0.008, 0.4, 0.55, TOP_Y - 0.28, 0.5, 0, 0, 0, { radial: 4, tile: 0.4 });

  // --------------------------------------------------------------- baskets
  const basketX = [-0.62, 0.78];
  for (let i = 0; i < basketX.length; i++) {
    const bx = basketX[i];
    const bz = i === 0 ? 0.12 : -0.28;
    const sc = 0.92 + i * 0.06;
    const baseY = 0.03;
    const rimY = baseY + 0.3 * sc;
    // woven basket body (the old smooth bamboo lathe read as a thermos flask)
    g.lathe('woven', [
      [0.02, 0],
      [0.15 * sc, 0],
      [0.19 * sc, 0.09 * sc],
      [0.205 * sc, 0.24 * sc],
      [0.19 * sc, 0.32 * sc],
      [0.165 * sc, 0.32 * sc],
    ], bx, baseY, bz, 0, j(0.5), 0, { segments: hi ? 10 : 8, tile: 0.7 });
    // rim roll + horizontal weave bands
    g.ring('rope', 0.205 * sc, 0.016, bx, baseY + 0.27 * sc, bz, Math.PI / 2, 0, 0, {
      radialSeg: 4,
      tubularSeg: 9,
      tile: 0.5,
    });
    for (const by of [0.1, 0.19]) {
      g.ring('rope', (0.19 + by * 0.06) * sc, 0.01, bx, baseY + by * sc, bz, Math.PI / 2, 0, 0, {
        radialSeg: 3,
        tubularSeg: 9,
        tile: 0.4,
      });
    }
    // vertical splints suggest the woven stakes
    for (let k = 0; k < 4; k++) {
      const a = (k / 5) * Math.PI * 2 + j(0.2);
      g.cyl('bamboo', 0.009, 0.009, 0.3 * sc, bx + Math.cos(a) * 0.2 * sc, baseY + 0.15 * sc,
        bz + Math.sin(a) * 0.2 * sc, 0, 0, 0, { radial: 4, tile: 0.6 });
    }
    // two crossed bamboo strips as the carrying handle (replaces the plain rope arc)
    g.rod('bamboo', bx - 0.17 * sc, rimY, bz, bx, baseY + 0.46 * sc, bz, 0.012, { radial: 4, tile: 0.6 });
    g.rod('bamboo', bx + 0.17 * sc, rimY, bz, bx, baseY + 0.46 * sc, bz, 0.012, { radial: 4, tile: 0.6 });
    g.ring('rope', 0.03, 0.008, bx, baseY + 0.46 * sc, bz, 0, 0, Math.PI / 2, {
      radialSeg: 3,
      tubularSeg: 5,
      tile: 0.05,
    });
    // one dried fish inside the basket
    g.ball('thatchDark', 0.05, bx + j(0.08), 0.03 + 0.3 * sc, bz + j(0.08), 0, j(0.6), 0, {
      segW: 7,
      segH: 5,
      sx: 1.2,
      sy: 0.6,
      tile: 0.4,
    });
  }

  // ---------------------------------------------------------- ground dressing
  for (let i = 0; i < (hi ? 6 : 3); i++) {
    g.plate('leafLitter', 0.16 + rng() * 0.1, 0.014, 0.13 + rng() * 0.07,
      -1.3 + rng() * 2.6, 0.02, -0.5 + rng() * 1.2, 0, rng() * Math.PI, j(0.04), { bevel: 0.003, tile: 0.9 });
  }
  g.rock('mossStone', 0.13, -1.35, 0.1, -0.45, { detail: 1, seed: 31, flatten: 0.5, tile: 1.2 });
  // spare bamboo leaning on the A-frame
  g.cyl('bamboo', 0.026, 0.026, 1.3, -1.5, 0.6, -0.2, 0.1, 0.2, 0.22, { radial: 4, tile: 0.9 });
}
