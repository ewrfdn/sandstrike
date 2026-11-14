/**
 * S2 · JETTY — hand-built timber pier reaching out along +X (see ISLAND_ASSETS.md §2.4).
 *
 * Weathered tropical landing stage: ten pile posts standing in the shallows (dark, soaked
 * lower third with barnacles), cross beams + two stringers, a plank deck with visible gaps
 * and a dark under-deck shadow board, a single hand rail on the seaward side lashed with
 * rope at every post, a mooring bollard with a coiled hawser, a small wooden lamp post at
 * the head (frame only — no light source, it is dawn and the lamp is out) and a cork float
 * hanging off the rail. Everything is held together by rope lashings and rusted bolts so it
 * reads as repaired by hand for decades.
 *
 * Local space: x = 0..9 out to sea, z = ±1 deck width, y = 0 at the sand / waterline.
 * The map places the jetty on the beach line; the model itself never dips under y = 0.
 */
import * as THREE from 'three';
import { TAU, matrixFor, boxGeometryWorldUV } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { cylGeo, latheGeo, plateGeo, torusGeo, tubeGeo, rockGeo, sphereGeo } from '../detail.js';

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

/** Shift a geometry's UVs by a whole-tile offset (deck planks must not repeat the
 *  same grain knots in a row — audit D-27). */
function shiftUV(geo, [du, dv]) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
  uv.needsUpdate = true;
  return geo;
}

export const meta = { id: 'jetty', kind: 'world', group: 'shore', label: '木栈桥 · JETTY' };

const DECK_Y = 1.4;      // plank centre height (top surface ≈ 1.44)
const POST_TOP = 1.16;   // pile top, hidden under the beams
const RAIL_Z = -1.16;    // seaward rail line (front of the stage view is -Z)
const POST_Z = 1.02;     // pile rows
const POST_X = [0.7, 2.55, 4.4, 6.25, 8.1];

/** Stage preview: sample layout, then one hero jetty. */
export function build(ctx) {
  island(ctx).jetties = [{ x: 0, y: 0, z: 0, ry: 0, s: 1 }];
  buildJetties(ctx);
}

/** Map assembly: one jetty per `layout.island.jetties` entry, no-op when absent. */
export function buildWorld(ctx) {
  buildJetties(ctx);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildJetties(ctx) {
  const items = island(ctx).jetties || [];
  if (!items.length) return;
  for (let i = 0; i < items.length; i++) buildJetty(ctx, items[i], i);
}

/** Local-space placement helper: T * R * S, pre-multiplied by the instance transform. */
function placer(ctx, base) {
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const m = new THREE.Matrix4();
  return function add(key, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    e.set(rx, ry, rz, 'YXZ');
    q.setFromEuler(e);
    v.set(x, y, z);
    s.set(sx, sy, sz);
    m.compose(v, q, s);
    m.premultiply(base);
    prepareTint(geo, x, y, z, key);
    ctx.batcher.add(key, geo, m);
    geo.dispose();
  };
}

function buildJetty(ctx, item, index) {
  const base = matrixFor(item.x, item.y ?? 0, item.z, 0, item.ry ?? 0, 0, item.s ?? 1);
  const add = placer(ctx, base);
  const rng = makeRNG(7300 + index * 89);

  const box = (key, x, y, z, w, h, d, tile = 1.5) =>
    add(key, boxGeometryWorldUV(w, h, d, tile), x, y, z);
  const rod = (key, ax, ay, az, bx, by, bz, r, radial = 5) => {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const g = cylGeo(r, r, len, { radial, tile: 1.4 });
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx / len, dy / len, dz / len));
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1));
    m.premultiply(base);
    prepareTint(g, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, key);
    ctx.batcher.add(key, g, m);
    g.dispose();
  };

  // ------------------------------------------------------------------ piles
  // Two rows of hand-set piles. The lower third is the soaked / barnacle band.
  for (const px of POST_X) {
    for (const pz of [-POST_Z, POST_Z]) {
      add('woodDark', cylGeo(0.155, 0.172, 0.56, { radial: 8 }), px, 0.28, pz);
      add('wood', cylGeo(0.128, 0.155, POST_TOP - 0.56, { radial: 8 }), px, 0.56 + (POST_TOP - 0.56) / 2, pz, 0, rng() * TAU, 0);
      // soaked mud collar at the sand line
      add('mud', sphereGeo(0.2, { segW: 8, segH: 6, tile: 1.6 }), px, 0.012, pz, 0, 0, 0, 1, 0.16, 1);
      // barnacle crust on the wet band
      for (let b = 0; b < 3; b++) {
        const a = rng() * TAU;
        add('stone', cylGeo(0.008, 0.036, 0.024, { radial: 4 }),
          px + Math.cos(a) * 0.165, 0.1 + rng() * 0.34, pz + Math.sin(a) * 0.165,
          Math.PI / 2, a + Math.PI / 2, 0);
      }
    }
  }
  // cross beams (pile caps) across the width at every pile bent
  for (const px of POST_X) {
    box('woodDark', px, POST_TOP - 0.02, 0, 0.2, 0.17, 2.5, 1.2);
    for (const pz of [-POST_Z, POST_Z]) {
      // rope lashing + rusted through-bolt where the beam sits on the pile
      add('rope', torusGeo(0.09, 0.017, { radialSeg: 4, tubularSeg: 6, tile: 0.8 }),
        px, POST_TOP + 0.1, pz, Math.PI / 2, Math.PI / 2, 0);
      box('rust', px + 0.11, POST_TOP + 0.02, pz, 0.04, 0.05, 0.09, 0.6);
    }
    // knee braces from pile to beam (both rows)
    for (const pz of [-POST_Z, POST_Z]) {
      rod('woodDark', px, 0.62, pz, px + 0.62, POST_TOP - 0.04, pz, 0.05, 5);
      rod('woodDark', px, 0.62, pz, px - 0.42, POST_TOP - 0.04, pz, 0.045, 5);
    }
  }
  // X bracing between the two pile rows (two bays) — the side view used to be a
  // row of unsupported "table legs"
  for (const bx of [0.7, 4.4]) {
    const nx = bx + 1.85;
    rod('woodDark', bx, 0.55, -POST_Z, nx, 1.0, POST_Z, 0.042, 3);
    rod('woodDark', bx, 0.55, POST_Z, nx, 1.0, -POST_Z, 0.042, 3);
    add('rope', torusGeo(0.05, 0.014, { radialSeg: 3, tubularSeg: 5, tile: 0.05 }),
      bx, 0.62, -POST_Z, Math.PI / 2, 0, 0);
    add('rope', torusGeo(0.05, 0.014, { radialSeg: 3, tubularSeg: 5, tile: 0.05 }),
      nx, 1.02, POST_Z, Math.PI / 2, 0, 0);
  }
  // two stringers running the length of the deck under the planks
  for (const sz of [-0.66, 0.66]) {
    box('woodDark', 4.55, 1.12, sz, 8.35, 0.16, 0.14, 2.0);
  }
  // dark shadow board: the gaps between the planks must read as dark joints, not sky
  box('woodDark', 4.55, 1.27, 0, 8.3, 0.05, 2.26, 2.4);

  // ------------------------------------------------------------------- deck
  const PLAK_N = 35;
  let x = 0.32;
  for (let i = 0; i < PLAK_N; i++) {
    // two planks amidships have rotted out: the dark shadow board below reads through
    if (i === 16 || i === 17) {
      x += 0.25;
      continue;
    }
    const key = i < 5 && i % 2 === 0 ? 'woodDark' : i % 9 === 4 ? 'driftWood' : i % 5 === 3 || i % 7 === 0 ? 'woodDark' : i % 6 === 2 ? 'woodDark' : 'wood';
    const jitter = (rng() - 0.5) * 0.012;
    if (i % 4 === 3) {
      // a repaired plank: two short boards butted over a joist
      add(key, shiftUV(plateGeo(0.225, 1.1, 0.07, { bevel: 0.012, tile: 2.6 }), [rng(), rng()]),
        x, DECK_Y, -0.6 + jitter, -Math.PI / 2, 0, 0);
      add(i % 8 === 3 ? 'wood' : 'woodDark',
        shiftUV(plateGeo(0.225, 1.16, 0.07, { bevel: 0.012, tile: 2.6 }), [rng(), rng()]),
        x, DECK_Y - 0.004, 0.58 + jitter, -Math.PI / 2, 0, 0);
      box('metalDark', x, 1.44, -0.04, 0.03, 0.012, 0.05, 0.5);
    } else {
      const len = 2.3 + (rng() - 0.5) * 0.1;
      // 2.6 m world tile (the old 1.2 m tile repeated the grain 3.5x over the
      // 9.6 m deck and read as printed flooring) + random per-plank offset
      add(key, shiftUV(plateGeo(0.225, len, 0.07, { bevel: 0.012, tile: 2.6 }), [rng(), rng()]),
        x, DECK_Y, jitter, -Math.PI / 2, (rng() - 0.5) * 0.006, (rng() - 0.5) * 0.008);
    }
    // two hand-set nails per plank + rust bleed streaks down the plank face
    for (const nz of [-0.84, 0.84]) {
      box('metalDark', x, 1.448, nz, 0.028, 0.012, 0.028, 0.4);
    }
    if (i % 6 === 1) {
      box('rust', x, 1.405, 0.66, 0.02, 0.05, 0.014, 0.4);
    }
    x += 0.25;
  }
  // fascia boards covering the deck edge
  for (const fz of [-1.19, 1.19]) {
    box('woodDark', 4.55, 1.37, fz, 8.55, 0.2, 0.055, 2.0);
    box('wood', 4.55, 1.5, fz, 8.55, 0.05, 0.075, 1.6);
  }
  // algae stain on the soaked shore-end piles instead of the "spilled green paint"
  // patches that used to sit on top of the deck (audit D-27)
  for (const pz of [-POST_Z, POST_Z]) {
    add('mud', boxGeometryWorldUV(0.34, 0.5, 0.34, 1.2), 0.7, 0.55, pz, 0, rng() * TAU, 0);
  }
  add('mossStone', boxGeometryWorldUV(0.3, 0.22, 0.3, 1.0), 0.7, 0.28, POST_Z, 0, 0.7, 0);

  // ------------------------------------------------------------ seaward rail
  const RAIL_X = [0.55, 2.25, 3.95, 5.65, 7.35, 8.7];
  for (const rx of RAIL_X) {
    const lean = (rng() - 0.5) * 0.02;
    add('woodDark', cylGeo(0.048, 0.06, 0.9, { radial: 6 }), rx, 1.885, RAIL_Z, lean, rng() * TAU, lean * 0.6);
    box('woodDark', rx + 0.09, 1.5, RAIL_Z, 0.16, 0.14, 0.13, 1.0); // cleat block
    // lashings where the post meets the deck and the rails
    add('rope', torusGeo(0.068, 0.017, { radialSeg: 4, tubularSeg: 8, tile: 0.8 }), rx, 1.47, RAIL_Z, 0, Math.PI / 2, 0);
    add('rope', torusGeo(0.078, 0.018, { radialSeg: 4, tubularSeg: 8, tile: 0.8 }), rx, 2.31, RAIL_Z, 0, Math.PI / 2, 0.4);
    add('rope', torusGeo(0.075, 0.018, { radialSeg: 4, tubularSeg: 8, tile: 0.8 }), rx, 1.95, RAIL_Z, 0, Math.PI / 2, -0.3);
  }
  // top + mid rail, slightly out of true (hand-fitted)
  for (const [ry, rr] of [[2.31, 0.05], [1.95, 0.042]]) {
    add('wood', cylGeo(rr, rr, 8.45, { radial: 6, tile: 2.0 }), 4.62, ry, RAIL_Z, 0, 0, Math.PI / 2);
  }
  // a rope lifeline zig-zagging through the rail posts as extra safety
  const lifeline = [];
  for (let i = 0; i < RAIL_X.length; i++) {
    const rx = RAIL_X[i];
    if (i > 0) lifeline.push(new THREE.Vector3(rx - 0.42, 2.12, RAIL_Z + 0.02));
    lifeline.push(new THREE.Vector3(rx, 2.08, RAIL_Z + 0.02));
    if (i < RAIL_X.length - 1) lifeline.push(new THREE.Vector3(rx + 0.42, 2.12, RAIL_Z + 0.02));
  }
  add('rope', tubeGeo(lifeline, 0.012, { tubularSeg: 36, radialSeg: 4, tile: 1.2 }), 0, 0, 0);

  // -------------------------------------------------------- mooring bollard
  const BX = 8.28;
  const BZ = 0.5;
  add('woodDark', latheGeo([
    [0.115, 0], [0.14, 0.05], [0.105, 0.14], [0.075, 0.32], [0.1, 0.37], [0.052, 0.42],
  ], { segments: 12, tile: 0.8 }), BX, 1.44, BZ);
  // steel hoop over the bollard head
  add('rust', torusGeo(0.055, 0.014, { radialSeg: 4, tubularSeg: 8, tile: 0.6 }), BX, 1.86, BZ, 0, 0, Math.PI / 2);
  // coiled hawser around the bollard
  for (let i = 0; i < 3; i++) {
    add('rope', torusGeo(0.19 - i * 0.008, 0.021, { radialSeg: 4, tubularSeg: 12, tile: 1.2 }),
      BX + (rng() - 0.5) * 0.01, 1.5 + i * 0.062, BZ + (rng() - 0.5) * 0.01, -Math.PI / 2, 0, (rng() - 0.5) * 0.1);
  }
  // the loose end of the hawser droops over the deck edge towards the water
  add('rope', tubeGeo([
    new THREE.Vector3(BX + 0.2, 1.55, BZ + 0.1),
    new THREE.Vector3(BX + 0.42, 1.48, BZ + 0.3),
    new THREE.Vector3(BX + 0.4, 1.44, BZ + 0.58),
    new THREE.Vector3(BX + 0.18, 1.42, BZ + 0.78),
    new THREE.Vector3(BX - 0.1, 1.4, BZ + 0.95),
  ], 0.019, { tubularSeg: 16, radialSeg: 4, tile: 1.2 }), 0, 0, 0);
  // a spare rope hank lying on the deck beside the rail
  for (let i = 0; i < 2; i++) {
    add('rope', torusGeo(0.2 - i * 0.03, 0.018, { radialSeg: 4, tubularSeg: 10, tile: 1.2 }),
      6.9 + i * 0.04, 1.465, -0.72, -Math.PI / 2, rng() * TAU, 0, 1, 1, 0.7);
  }

  // -------------------------------------------------------------- lamp post
  const LX = 8.62;
  const LZ = -0.92;
  add('woodDark', cylGeo(0.048, 0.065, 0.94, { radial: 6 }), LX, 1.45 + 0.47, LZ, 0.01, 0, 0.02);
  box('woodDark', LX, 1.47, LZ, 0.2, 0.08, 0.2, 0.8);            // timber base block
  box('woodDark', LX, 2.34, LZ + 0.17, 0.055, 0.05, 0.44, 0.8);  // head arm out over the deck
  rod('woodDark', LX, 2.16, LZ, LX, 2.34, LZ + 0.1, 0.024, 4);   // arm support
  // rusted iron lamp frame — empty cage, the lamp has been out since before dawn
  const LY = 2.2;
  add('rust', torusGeo(0.038, 0.009, { radialSeg: 4, tubularSeg: 6, tile: 0.5 }), LX, 2.3, LZ + 0.34, 0, 0, 0);
  box('rust', LX, 2.26, LZ + 0.34, 0.2, 0.02, 0.2, 0.6);
  box('rust', LX, LY - 0.16, LZ + 0.34, 0.17, 0.02, 0.17, 0.6);
  add('rust', cylGeo(0.016, 0.12, 0.07, { radial: 4 }), LX, 2.245, LZ + 0.34);
  for (const [ox, oz] of [[-0.075, -0.075], [-0.075, 0.075], [0.075, -0.075], [0.075, 0.075]]) {
    add('rust', cylGeo(0.007, 0.007, 0.17, { radial: 4 }), LX + ox, LY - 0.075, LZ + 0.34 + oz);
  }
  box('metalDark', LX, LY - 0.075, LZ + 0.34, 0.105, 0.15, 0.105, 0.6); // dark, dusty glass volume

  // ----------------------------------------------------- cork float on a rope
  add('rope', tubeGeo([
    new THREE.Vector3(2.62, 2.3, RAIL_Z),
    new THREE.Vector3(2.66, 2.05, RAIL_Z - 0.08),
    new THREE.Vector3(2.62, 1.78, RAIL_Z - 0.1),
  ], 0.011, { tubularSeg: 10, radialSeg: 4, tile: 1.0 }), 0, 0, 0);
  add('wood', latheGeo([[0.001, 0], [0.075, 0.02], [0.065, 0.11], [0.03, 0.15], [0.001, 0.16]],
    { segments: 10, tile: 0.6 }), 2.62, 1.62, RAIL_Z - 0.1, 0, 0, 0.08);

  // --------------------------------------------- shore end: sand & loose stones
  add('beachSand', sphereGeo(1.0, { segW: 10, segH: 8, tile: 2.2 }), 0.62, 0.045, 0.35, 0, 0, 0, 0.82, 0.06, 0.9);
  add('mud', sphereGeo(0.8, { segW: 10, segH: 8, tile: 2.0 }), 1.05, 0.03, -0.22, 0, 0.4, 0, 0.75, 0.05, 0.8);
  for (let i = 0; i < 5; i++) {
    const a = rng() * TAU;
    add(i % 2 ? 'ruinStoneDark' : 'shoreRock', rockGeo(0.1 + rng() * 0.1, { detail: 0, flatten: 0.5, seed: 900 + i }),
      0.5 + Math.cos(a) * (0.5 + rng() * 0.6), 0.05, Math.sin(a) * (0.4 + rng() * 0.5), 0, rng() * TAU, 0);
  }

  // ---------------------------------------- landing ladder down the inboard side
  for (const [ax, az] of [[0.34, 1.2], [0.34, 1.34]]) {
    rod('woodDark', ax, 1.44, az, ax + 0.16, 0.03, az + 0.3, 0.032, 4);
  }
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const y = 1.36 - t * 1.12;
    const z = 1.24 + t * 0.27;
    const rx = 0.34 + t * 0.16;
    add('woodDark', cylGeo(0.026, 0.026, 0.2, { radial: 4, tile: 0.8 }), rx, y, z, Math.PI / 2, 0, 0);
  }

  // ------------------------------------------------- loose kit on the deck
  // rope wound twice around the two pile tops just under the deck edge
  for (const wx of [2.55, 6.25]) {
    add('rope', torusGeo(0.185, 0.021, { radialSeg: 4, tubularSeg: 10, tile: 1.0 }),
      wx, 0.86, -POST_Z, -Math.PI / 2, 0, 0.1);
  }
  // rusted strap plates bolted over the beam / stringer joints
  for (const sx of [0.7, 4.4, 8.1]) {
    box('rust', sx, 1.185, 0.98, 0.1, 0.06, 0.16, 0.6);
    box('rust', sx, 1.185, -0.98, 0.1, 0.06, 0.16, 0.6);
  }
  // a small fish crate by the lamp post
  box('wood', 7.9, 1.56, -0.42, 0.42, 0.24, 0.3, 1.0);
  box('woodDark', 7.9, 1.685, -0.42, 0.46, 0.03, 0.34, 0.8);
  box('woodDark', 7.9, 1.55, -0.42, 0.44, 0.02, 0.32, 0.8);

  // one loose plank leaning against the deck edge at the shore end
  add('woodDark', plateGeo(0.2, 0.9, 0.06, { bevel: 0.01, tile: 1.2 }), 0.42, 0.86, 0.95,
    0.28, 0.15, -Math.PI / 2 + 0.17);
}
