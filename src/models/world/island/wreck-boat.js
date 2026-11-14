/**
 * S5 · WRECK BOAT — half-sunk old fishing boat (P1, see ISLAND_ASSETS.md §2.4).
 *
 * A small timber fishing boat that was driven onto the shore and left to rot: it has
 * settled onto its starboard bilge (heeled ~20°), the port side is stove in amidships with
 * the hull planks missing, so you look straight through the hole at the exposed grown ribs,
 * the rusted single-cylinder engine, the broken deck beams and the snapped mast. The stern
 * transom is stove, the keel is broken and a section of it lies in the sand. Torn netting
 * hangs out of the hole, barnacles crust the wet hull and sand has banked up over the low
 * side (the model is authored on y = 0; the map raises it to the shoreline).
 *
 * Local space: bow towards -Z, boat heeled to starboard (+X), y = 0 at the sand line.
 */
import * as THREE from 'three';
import { TAU, matrixFor } from '../../core.js';
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
  'mossStone', 'ruinStone', 'ruinStoneDark', 'ruinStone', 'mud', 'leafLitter',
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

export const meta = { id: 'wreck-boat', kind: 'world', group: 'shore', label: '沉船残骸 · WRECK BOAT' };

// Boat section tables (15 stations from bow to transom). Kept explicit so sheer / beam
// can be tuned by eye without touching the lofting code.
const N = 15;
const ROWS = 5;
const Z_BOW = -3.1;
const Z_STERN = 2.9;
const HEEL = -0.34; // roll to starboard
const B = [0.1, 0.34, 0.58, 0.8, 0.96, 1.06, 1.12, 1.14, 1.12, 1.08, 1.03, 0.98, 0.94, 0.9, 0.86];
const TOP = [1.52, 1.4, 1.32, 1.27, 1.24, 1.22, 1.22, 1.24, 1.26, 1.29, 1.32, 1.34, 1.36, 1.37, 1.38];
const KEEL = [0.42, 0.3, 0.22, 0.17, 0.15, 0.14, 0.14, 0.14, 0.15, 0.16, 0.17, 0.18, 0.2, 0.22, 0.24];

const zAt = (t) => Z_BOW + t * (Z_STERN - Z_BOW);
const HEEL_C = Math.cos(HEEL);
const HEEL_S = Math.sin(HEEL);

/** Linear sample of one of the section tables at continuous station position `t`. */
function sample(table, t) {
  const f = Math.max(0, Math.min(1, t)) * (N - 1);
  const i = Math.floor(f);
  const j = Math.min(N - 1, i + 1);
  const w = f - i;
  return table[i] * (1 - w) + table[j] * w;
}

/** One hull section, upright boat space: ring of ROWS*2-1 points from port gunwale to
 *  starboard gunwale via the keel. `inset` gives the inner shell / rib line. */
function sectionUp(t, inset = 0) {
  const b = Math.max(0.02, sample(B, t) - inset);
  const top = sample(TOP, t) - inset * 0.5;
  const keel = sample(KEEL, t) + inset * 1.15;
  const pts = [];
  for (let j = 0; j < ROWS; j++) {
    const phi = (1 - j / (ROWS - 1)) * Math.PI * 0.5;
    pts.push([-b * Math.sin(phi), top - (top - keel) * Math.pow(Math.cos(phi), 0.8)]);
  }
  for (let j = ROWS - 2; j >= 0; j--) {
    const phi = (1 - j / (ROWS - 1)) * Math.PI * 0.5;
    pts.push([b * Math.sin(phi), top - (top - keel) * Math.pow(Math.cos(phi), 0.8)]);
  }
  return pts;
}

/** Heel the section over and clamp it to the sand line (the buried starboard side). */
function heelPoint(x, y) {
  return {
    x: HEEL_C * x - HEEL_S * y,
    y: Math.max(0.02, HEEL_S * x + HEEL_C * y),
  };
}

/** Heeled ring in world space — used for the hull shell and for placing hull fittings. */
function sectionHeeled(t, inset = 0) {
  return sectionUp(t, inset).map(([x, y]) => {
    const h = heelPoint(x, y);
    return [h.x, h.y, zAt(t)];
  });
}

// holes in the port shell: station index + ring column (0 = upper strake)
const holes = new Set();
for (let i = 4; i <= 8; i++) { holes.add(`${i}:0`); holes.add(`${i}:1`); }
for (let i = 11; i <= 12; i++) holes.add(`${i}:0`);

/** Stage preview: sample layout, then one hero wreck. */
export function build(ctx) {
  island(ctx).wrecks = [{ x: 0, y: 0, z: 0, ry: 0.12, s: 1 }];
  buildWrecks(ctx);
}

/** Map assembly: one wreck per `layout.island.wrecks` entry, no-op when absent. */
export function buildWorld(ctx) {
  buildWrecks(ctx);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildWrecks(ctx) {
  const items = island(ctx).wrecks || [];
  if (!items.length) return;
  for (let i = 0; i < items.length; i++) buildWreck(ctx, items[i], i);
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

/** Indexed grid helper for the hull shells (keeps smooth normals through the loft). */
function shellGeometry(inner) {
  const pos = [];
  const uv = [];
  const idx = [];
  const rings = [];
  for (let i = 0; i < N; i++) {
    rings.push(sectionHeeled(i / (N - 1), inner ? 0.05 : 0));
  }
  const K = ROWS * 2 - 1;
  for (const ring of rings) {
    for (let k = 0; k < K; k++) {
      pos.push(ring[k][0], ring[k][1], ring[k][2]);
      uv.push(ring[k][2] / 1.5, (k / (K - 1)) * 0.6);
    }
  }
  for (let i = 0; i < N - 1; i++) {
    for (let k = 0; k < K - 1; k++) {
      if (!inner && holes.has(`${i}:${k}`)) continue;
      const a = i * K + k;
      const b = a + 1;
      const c = a + K + 1;
      const d = a + K;
      if (inner) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    }
  }
  if (!inner) {
    // bow cap: fan the first ring onto a tip point on the centre line
    const tipX = heelPoint(0, TOP[0]).x;
    const tipY = Math.max(0.05, heelPoint(0, TOP[0]).y - 0.04);
    const tip = pos.length / 3;
    pos.push(tipX, tipY, Z_BOW - 0.12);
    uv.push(0.5, 0.5);
    for (let k = 0; k < K - 1; k++) idx.push(tip, k + 1, k);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Cap strip joining outer and inner shells along the gunwales (heeled, world space). */
function gunwaleRimGeometry() {
  const pos = [];
  const uv = [];
  const idx = [];
  const sides = [
    { k: 0, innerK: 0 },
    { k: ROWS * 2 - 2, innerK: ROWS * 2 - 2 },
  ];
  for (const side of sides) {
    const off = pos.length / 3;
    for (let i = 0; i < N; i++) {
      const outer = sectionHeeled(i / (N - 1), 0)[side.k];
      const innerP = sectionHeeled(i / (N - 1), 0.05)[side.innerK];
      pos.push(outer[0], outer[1], outer[2], innerP[0], innerP[1], innerP[2]);
      uv.push(outer[2] / 1.5, 0, outer[2] / 1.5, 0.06);
    }
    for (let i = 0; i < N - 1; i++) {
      // the port rim is torn away over the big hole
      if (side.k === 0 && i >= 4 && i <= 8) continue;
      const a = off + i * 2;
      const b = a + 1;
      const c = a + 3;
      const d = a + 2;
      if (side.k === 0) idx.push(a, d, c, a, c, b);
      else idx.push(a, c, d, a, b, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function buildWreck(ctx, item, index) {
  const base = matrixFor(item.x, item.y ?? 0, item.z, 0, item.ry ?? 0, 0, item.s ?? 1);
  const add = placer(ctx, base);
  // boat-space placement: everything built upright is heeled onto the settled pose
  const boatMat = matrixFor(0, 0, 0, 0, 0, HEEL);
  const addBoat = placer(ctx, base.clone().multiply(boatMat));
  const rng = makeRNG(8300 + index * 61);

  const bbox = (key, x, y, z, w, h, d) => addBoat(key, new THREE.BoxGeometry(w, h, d), x, y, z);

  // ------------------------------------------------------------------- hull
  add('woodDark', shellGeometry(false), 0, 0, 0);
  add('wood', shellGeometry(true), 0, 0, 0);
  add('woodDark', gunwaleRimGeometry(), 0, 0, 0);

  // --------------------------------------------------------------- transom
  for (let i = 0; i < 4; i++) {
    const y = 0.52 + i * 0.26;
    const w = i === 3 ? 1.5 : 1.66;
    addBoat(i === 2 ? 'wood' : 'woodDark', plateGeo(w, 0.25, 0.05, { bevel: 0.012, tile: 1.2 }),
      0, y, Z_STERN - 0.02, -0.02, 0, 0);
  }
  addBoat('woodDark', new THREE.BoxGeometry(0.12, 1.0, 0.12), -0.72, 0.8, Z_STERN + 0.03);
  // transom knee + a broken plank hanging off the corner
  addBoat('woodDark', plateGeo(0.3, 0.6, 0.16, { bevel: 0.02, tile: 1.0 }), 0.2, 0.6, Z_STERN - 0.1, 0.05, 0, 0.1);
  addBoat('woodDark', plateGeo(0.22, 0.7, 0.05, { bevel: 0.01, tile: 1.0 }), 0.85, 0.78, Z_STERN + 0.1, 0.2, 0.4, 0.3);

  // ---------------------------------------------------------- grown ribs
  // seven grown frames left standing where the planking tore away
  for (const i of [1, 3, 5, 7, 9, 11, 13]) {
    const pts = sectionUp(i / (N - 1), 0.07).map(([x, y], k) =>
      new THREE.Vector3(x, y, zAt(i / (N - 1)) + (k % 2 ? 0.01 : -0.01)));
    addBoat('wood', tubeGeo(pts, 0.036, { tubularSeg: 14, radialSeg: 4, tile: 1.2 }), 0, 0, 0);
  }

  // ----------------------------------------------------- deck beams & remains
  for (const i of [2, 5, 8, 11]) {
    const t = i / (N - 1);
    addBoat('woodDark', new THREE.BoxGeometry(B[i] * 1.85, 0.1, 0.14), 0, TOP[i] - 0.22, zAt(t));
  }
  // a few remaining deck planks forward + the fish-hold coaming
  for (let i = 0; i < 3; i++) {
    addBoat('wood', plateGeo(0.9, 0.05, 0.2, { bevel: 0.008, tile: 1.2 }),
      -0.5 + i * 0.5, TOP[2] - 0.14, zAt(0.16 + i * 0.04), -Math.PI / 2, 0, 0.02);
  }
  for (const [dx, dz, w, d] of [[0, -0.3, 1.1, 0.08], [0, 0.3, 1.1, 0.08], [-0.55, 0, 0.08, 0.6], [0.55, 0, 0.08, 0.6]]) {
    addBoat('woodDark', new THREE.BoxGeometry(w, 0.16, d), dx, TOP[6] - 0.1, zAt(0.42) + dz);
  }

  // -------------------------------------------------------------- engine
  // a rusted single-cylinder inboard, still bolted to its beds amidships
  const EX = 0.08;
  const EZ = zAt(0.55);
  bbox('rust', EX, 0.42, EZ, 0.62, 0.44, 0.5);
  bbox('metalDark', EX, 0.7, EZ + 0.04, 0.4, 0.16, 0.38);
  bbox('rust', EX, 0.44, EZ + 0.42, 0.3, 0.22, 0.26);
  for (const sx of [-0.36, 0.36]) {
    for (const sz of [-0.2, 0.2]) {
      addBoat('rust', new THREE.BoxGeometry(0.12, 0.1, 0.14), EX + sx, 0.24, EZ + sz);
    }
  }
  addBoat('rust', torusGeo(0.19, 0.035, { radialSeg: 4, tubularSeg: 10, tile: 0.7 }), EX, 0.44, EZ - 0.3, 0, 0, 0);
  addBoat('metalDark', cylGeo(0.05, 0.05, 0.26, { radial: 6 }), EX, 0.44, EZ - 0.3, Math.PI / 2, 0, 0);
  // exhaust elbow + cooling pipe
  addBoat('rust', tubeGeo([
    new THREE.Vector3(EX - 0.1, 0.72, EZ + 0.1),
    new THREE.Vector3(EX - 0.18, 0.92, EZ + 0.12),
    new THREE.Vector3(EX - 0.16, 1.0, EZ + 0.34),
  ], 0.035, { tubularSeg: 10, radialSeg: 4, tile: 0.8 }), 0, 0, 0);
  addBoat('metalDark', rodGeo(EX + 0.3, 0.5, EZ, EX + 0.62, 0.32, EZ + 0.4, 0.022, { radial: 4, tile: 0.8 }), 0, 0, 0);
  addBoat('rust', cylGeo(0.1, 0.1, 0.34, { radial: 8 }), EX - 0.32, 0.26, EZ - 0.34, 0, 0, Math.PI / 2);

  // --------------------------------------------------- snapped mast & rigging
  const mastBase = new THREE.Vector3(0.05, 0.2, -0.35);
  const mastTip = new THREE.Vector3(0.42, 2.42, 0.05);
  addBoat('woodDark', rodGeo(mastBase.x, mastBase.y, mastBase.z, mastTip.x, mastTip.y, mastTip.z, 0.075, { radial: 6, tile: 1.4 }), 0, 0, 0);
  // mast step in the bilge + the deck partner block it passes through
  addBoat('woodDark', new THREE.BoxGeometry(0.34, 0.12, 0.34), mastBase.x, 0.14, mastBase.z);
  addBoat('woodDark', plateGeo(0.34, 0.14, 0.3, { bevel: 0.014, tile: 1.1 }),
    mastBase.x + 0.05, 0.56, mastBase.z + 0.02, 0.02, 0.15, 0.02);
  addBoat('wood', cylGeo(0.02, 0.09, 0.3, { radial: 5 }), mastTip.x + 0.02, mastTip.y + 0.12, mastTip.z, 0.2, 0, 0.15);
  // dangling shrouds
  addBoat('rope', tubeGeo([
    new THREE.Vector3(0.1, 1.5, -0.32),
    new THREE.Vector3(-0.28, 1.35, -0.5),
    new THREE.Vector3(-0.55, 1.0, -0.85),
  ], 0.016, { tubularSeg: 10, radialSeg: 4, tile: 1.0 }), 0, 0, 0);
  addBoat('rope', tubeGeo([
    new THREE.Vector3(0.2, 1.9, -0.1),
    new THREE.Vector3(0.6, 1.5, 0.25),
    new THREE.Vector3(0.85, 1.0, 0.55),
  ], 0.014, { tubularSeg: 10, radialSeg: 4, tile: 1.0 }), 0, 0, 0);

  // -------------------------------------------------- hold clutter (D-26)
  // folded net bundle in the bilge
  for (let i = 0; i < 3; i++) {
    addBoat('woven', plateGeo(0.52, 0.05, 0.4, { bevel: 0.012, tile: 0.8 }),
      EX + 0.5 + i * 0.03, 0.3 + i * 0.06, EZ + 0.55 + i * 0.04, 0, 0.2 + i * 0.3, 0.05);
  }
  // coiled mooring rope on a deck beam
  for (let i = 0; i < 3; i++) {
    addBoat('rope', torusGeo(0.14 + i * 0.012, 0.016, { radialSeg: 3, tubularSeg: 9, tile: 0.8 }),
      0.18, 0.42 + i * 0.035, zAt(0.66), Math.PI / 2, 0.1, 0);
  }
  // two soaked planks thrown into the hold
  addBoat('wood', plateGeo(0.7, 0.045, 0.2, { bevel: 0.008, tile: 1.0 }),
    -0.42, 0.34, EZ + 0.15, 0.08, 0.5, 0.06);
  addBoat('woodDark', plateGeo(0.55, 0.04, 0.18, { bevel: 0.008, tile: 1.0 }),
    0.38, 0.3, EZ - 0.4, -0.1, -0.35, 0.12);
  // rusted fuel can rolling against the engine bed
  addBoat('rust', cylGeo(0.09, 0.09, 0.2, { radial: 7 }), EX - 0.42, 0.28, EZ + 0.5, Math.PI / 2, 0.4, 0.3);

  // ------------------------------------------------------- helm wheel remnant
  addBoat('woodDark', cylGeo(0.05, 0.06, 0.7, { radial: 5 }), 0.2, TOP[11] - 0.55, zAt(0.8));
  addBoat('rust', torusGeo(0.26, 0.03, { radialSeg: 4, tubularSeg: 10, tile: 0.8 }), 0.2, TOP[11] - 0.2, zAt(0.8), 0, 0, 0.15);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    addBoat('wood', plateGeo(0.42, 0.035, 0.025, { bevel: 0.005, tile: 0.7 }),
      0.2 + Math.cos(a) * 0.11, TOP[11] - 0.2 + Math.sin(a) * 0.11, zAt(0.8), 0, 0, a);
  }

  // -------------------------------------------- torn planking around the hole
  // the port shell is stove in amidships: jagged plank ends stick out of the wound
  const holeStations = [4, 8, 6, 5, 7];
  for (let n = 0; n < holeStations.length; n++) {
    const i = holeStations[n];
    const ring = sectionHeeled(i / (N - 1), 0);
    const p = ring[1];
    const dir = n % 2 ? 1 : -1;
    add('woodDark', plateGeo(0.34 + rng() * 0.2, 0.2 + rng() * 0.1, 0.04, { bevel: 0.01, tile: 1.0 }),
      p[0] + dir * 0.12, p[1] + 0.03 * dir + 0.06, p[2],
      0.15 * dir, 0.5 + rng(), 0.35 * dir);
  }
  // two broken planks hanging from the damaged gunwale
  for (const [i, dir] of [[6, 1], [7, -1]]) {
    const ring = sectionHeeled(i / (N - 1), 0);
    const p = ring[0];
    add('woodDark', plateGeo(0.8, 0.22, 0.05, { bevel: 0.01, tile: 1.1 }),
      p[0] + 0.1, p[1] - 0.28, p[2] + 0.1 * dir, 0.4, 0.3 * dir, 0.4);
  }

  // ------------------------------------------------------------- torn net
  // ragged netting spilling out of the hole and over the transom
  for (let i = 0; i < 7; i++) {
    const z = zAt(0.36) + i * 0.22;
    const ring = sectionHeeled(0.36 + i * 0.006, 0);
    const top = ring[0];
    const len = 0.5 + rng() * 0.5;
    add('rope', tubeGeo([
      new THREE.Vector3(top[0], top[1], z),
      new THREE.Vector3(top[0] + 0.12, top[1] - len * 0.5, z + 0.1 * (rng() - 0.5)),
      new THREE.Vector3(top[0] + 0.22, top[1] - len, z + 0.2 * (rng() - 0.5)),
    ], 0.011, { tubularSeg: 3, radialSeg: 3, tile: 0.9 }), 0, 0, 0);
  }
  for (let i = 0; i < 3; i++) {
    const z = zAt(0.36) + 0.15 + i * 0.3;
    const ring = sectionHeeled(0.4, 0);
    add('rope', tubeGeo([
      new THREE.Vector3(ring[0][0], ring[0][1] + 0.02, z),
      new THREE.Vector3(ring[0][0] + 0.3, ring[0][1] - 0.35, z + 0.2),
      new THREE.Vector3(ring[0][0] + 0.55, ring[0][1] - 0.62, z + 0.4),
    ], 0.012, { tubularSeg: 8, radialSeg: 3, tile: 0.9 }), 0, 0, 0);
  }
  // net bundle over the transom
  for (let i = 0; i < 3; i++) {
    add('rope', torusGeo(0.16, 0.014, { radialSeg: 3, tubularSeg: 8, tile: 0.9 }),
      -0.5 + i * 0.3, 0.35, Z_STERN + 0.16, 0.5, 0.4, 0.2, 1, 1.4, 1);
  }

  // --------------------------------------------------------- broken keel & spar
  // snapped keel piece protruding under the bow + the rest lying in the sand
  add('woodDark', rodGeo(0.1, 0.2, Z_BOW + 0.5, 0.24, 0.16, Z_BOW - 0.5, 0.07, { radial: 5, tile: 1.2 }), 0, 0, 0);
  add('woodDark', plateGeo(0.16, 1.7, 0.09, { bevel: 0.02, tile: 1.4 }),
    1.9, 0.13, 1.5, -Math.PI / 2, 0.5, 0.05);
  add('woodDark', plateGeo(0.14, 0.6, 0.08, { bevel: 0.02, tile: 1.2 }),
    2.55, 0.12, 2.35, -Math.PI / 2, 0.9, 0.12);
  // fallen spar / boom lying beside the wreck
  add('woodDark', rodGeo(0.9, 0.12, 2.6, 2.85, 0.1, 1.9, 0.06, { radial: 5, tile: 1.2 }), 0, 0, 0);

  // ---------------------------------------------------------- propeller
  add('rust', torusGeo(0.1, 0.03, { radialSeg: 4, tubularSeg: 8, tile: 0.6 }), 1.15, 0.08, Z_BOW - 0.05, 0.3, 0.4, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    add('rust', plateGeo(0.22, 0.1, 0.02, { bevel: 0.006, tile: 0.6 }),
      1.15 + Math.cos(a) * 0.1, 0.09, Z_BOW - 0.05 + Math.sin(a) * 0.1, 0.3, a, 0.9);
  }
  add('rust', rodGeo(1.15, 0.08, Z_BOW - 0.05, 0.3, 0.15, Z_BOW + 0.7, 0.03, { radial: 4, tile: 0.8 }), 0, 0, 0);

  // ------------------------------------------------------- hull fittings
  // rub rail along the surviving port sheer, rusted iron drifts
  {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const ring = sectionHeeled(i / (N - 1), 0);
      pts.push(new THREE.Vector3(ring[0][0], ring[0][1] + 0.01, ring[0][2]));
    }
    add('woodDark', tubeGeo(pts, 0.035, { tubularSeg: 18, radialSeg: 4, tile: 1.4 }), 0, 0, 0);
  }
  for (const i of [1, 2, 10, 12, 13]) {
    const ring = sectionHeeled(i / (N - 1), 0);
    const p = ring[8];
    add('rust', new THREE.BoxGeometry(0.07, 0.1, 0.16), p[0] - 0.05, p[1] - 0.08, p[2]);
  }
  // barnacle crust along the wet hull near the sand line
  for (let i = 0; i < 26; i++) {
    const st = 0.1 + rng() * 0.82;
    const ring = sectionHeeled(st, 0);
    const k = rng() < 0.5 ? 7 : 8;
    const p = ring[k];
    add('ruinStone', cylGeo(0.008, 0.03, 0.022, { radial: 4 }),
      p[0] + (rng() - 0.5) * 0.12, Math.max(0.04, p[1] - 0.12 * rng()), p[2] + (rng() - 0.5) * 0.1,
      Math.PI / 2, rng() * TAU, 0);
  }

  // ------------------------------------------------------- sand / shoreline
  const mound = (key, x, z, r, halfH, ry = 0, sx = 1, sz = 1) => {
    add(key, sphereGeo(r, { segW: 10, segH: 8, tile: 2.2 }), x, halfH - 0.02, z, 0, ry, 0, sx, halfH / r, sz);
  };
  // sand banked high over the submerged starboard side (fakes the half-sunk pose)
  mound('beachSand', 1.45, 0.6, 1.15, 0.2, 0.3, 0.95, 1.7);
  mound('beachSand', 1.1, -1.9, 0.9, 0.16, 1.1, 0.9, 1.1);
  mound('beachSand', 1.15, 2.0, 0.85, 0.14, 0.6, 0.95, 1.0);
  mound('mud', 1.35, 0.4, 0.95, 0.13, 0.8, 0.9, 1.6);
  mound('mud', 0.95, -2.2, 0.7, 0.09, 1.4, 0.9, 0.9);
  mound('mud', 0.6, 2.6, 0.6, 0.08, 0.2, 0.9, 0.8);
  // a dark wet sand puddle under the hole
  add('mud', new THREE.CircleGeometry(0.4, 16), 0.1, 0.03, 0.1, -Math.PI / 2, 0, 0, 1, 1, 0.7);
  // sea-rounded pebbles and shells around the wreck
  for (let i = 0; i < 8; i++) {
    const a = rng() * TAU;
    const rr = 0.7 + rng() * 1.6;
    const s = 0.06 + rng() * 0.1;
    add(i % 2 ? 'ruinStoneDark' : 'ruinStone', rockGeo(s, { detail: 0, flatten: 0.55, seed: 310 + i }),
      Math.cos(a) * rr, s * 0.42, 0.4 + Math.sin(a) * rr, 0, rng() * TAU, 0);
  }
  for (let i = 0; i < 4; i++) {
    add('beachSand', cylGeo(0.004, 0.03, 0.018, { radial: 5 }),
      -0.6 + rng() * 2.2, 0.03, -1.6 + rng() * 3.4, 1.25, rng() * TAU, 0);
  }
  // dark weed washed against the hull
  for (let i = 0; i < 6; i++) {
    add('broadleafDark', leafQuad(0.3 + rng() * 0.25, 0.08 + rng() * 0.05, 'vine'),
      -0.5 + rng() * 1.6, 0.035, -2.4 + rng() * 4.6, -Math.PI / 2 + (rng() - 0.5) * 0.3, rng() * TAU, 0);
  }
  // a small clump of sea-rounded reef stones near the bow (these used to be the
  // black "garbage bags" of audit D-26: dark stone keys on a bright beach)
  for (let i = 0; i < 4; i++) {
    const rr = 0.1 + rng() * 0.13;
    // ground each stone so its lowest vertex sits on the sand (minY budget)
    add(i === 2 ? 'ruinStoneDark' : 'shoreRock', rockGeo(rr, { detail: 1, flatten: 0.55, seed: 330 + i }),
      -0.95 + Math.cos(i * 1.9) * 0.3, rr * 0.55 + 0.008, -2.35 + Math.sin(i * 1.9) * 0.28, 0, rng() * TAU, 0);
  }
  // one loose rib leaning against the transom
  add('wood', tubeGeo([
    new THREE.Vector3(0.9, 0.08, 2.4),
    new THREE.Vector3(1.05, 0.5, 2.35),
    new THREE.Vector3(1.12, 0.95, 2.28),
  ], 0.035, { tubularSeg: 8, radialSeg: 4, tile: 1.2 }), 0, 0, 0);

  // foreground prop: half-buried rusted fuel drum beside the wreck
  add('rust', cylGeo(0.2, 0.2, 0.55, { radial: 10 }), -1.25, 0.17, -0.6, Math.PI / 2, 0.3, 0.2);
  add('metalDark', cylGeo(0.04, 0.04, 0.12, { radial: 5 }), -1.28, 0.32, -0.55, 0, 0, 0.4);
}
