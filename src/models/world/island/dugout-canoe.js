/**
 * S3 · DUGOUT CANOE — a carved single-log canoe pulled up on the sand (ISLAND_ASSETS.md §2.4).
 *
 * The hull is a real carved shell: a lofted U-section with a pointed bow / stern, visible
 * thickness at the sheer, a darker inner liner (wet, shadowed bilge), raised gunwale rails,
 * five grown-in ribs, three thwarts (seats) with cleats, two floor stringers and tooled
 * grain ridges running the length of the outside. It lies on damp sand (minY ≈ 0).
 *
 * Why a paddle and not an outrigger: an outrigger float would push the footprint well past
 * the 1.2 m width budget and read as a different boat class, while a paddle lying across the
 * thwarts tells the same "someone was just here" story for ~100 triangles.
 *
 * Local space: bow towards -Z, centred on the origin, y = 0 at the sand line.
 */
import * as THREE from 'three';
import { TAU, matrixFor } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import {
  cylGeo,
  latheGeo,
  plateGeo,
  rodGeo,
  rockGeo,
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

export const meta = { id: 'dugout-canoe', kind: 'world', group: 'shore', label: '独木舟 · DUGOUT CANOE' };

// Hull section constants (metres).
const HULL = {
  L: 4.7,     // overall length
  W: 0.5,     // half width amidships
  T: 0.034,   // shell thickness at the sheer
  K: 11,      // profile samples across the U
  N: 19,      // stations along the length
  mid: 0.022, // keel height amidships (ground contact ≈ 0)
};

/** Section parameters at normalised station `t` (0 = bow, 1 = stern). */
function stationParams(t) {
  const tc = Math.max(0.004, Math.min(0.996, t));
  const s = Math.abs(2 * tc - 1); // 0 amidships, 1 at either end
  return {
    z: -HULL.L / 2 + t * HULL.L,
    w: HULL.W * Math.pow(Math.sin(Math.PI * tc), 0.52),
    top: 0.62 + 0.12 * Math.pow(s, 1.7),       // sheer line rises at bow / stern
    keel: HULL.mid + 0.26 * Math.pow(s, 1.9),  // rocker
  };
}

/** One point of the U-section, `inset` metres inwards from the outer skin. */
function sectionPoint(p, k, inset) {
  const phi = (k / (HULL.K - 1) - 0.5) * Math.PI;
  const w = Math.max(0.0015, p.w - inset);
  const top = p.top - (inset > 0 ? 0.007 : 0);
  const keel = p.keel + inset * 1.2;
  return {
    x: w * Math.sin(phi),
    y: top - (top - keel) * Math.pow(Math.cos(phi), 0.8),
  };
}

const tOf = (z) => (z + HULL.L / 2) / HULL.L;
const paramsAt = (z) => stationParams(tOf(z));
const gunwaleY = (z) => paramsAt(z).top;
const innerKeelY = (z) => paramsAt(z).keel + HULL.T * 1.25;
const innerHalfW = (z) => Math.max(0.03, paramsAt(z).w - HULL.T);

/** Which side of the stage the camera sees: bow is -Z. */
export function build(ctx) {
  island(ctx).canoes = [{ x: 0, y: 0, z: 0, ry: 0.24, s: 1 }];
  buildCanoes(ctx);
}

/** Map assembly: one canoe per `layout.island.canoes` entry, no-op when absent. */
export function buildWorld(ctx) {
  buildCanoes(ctx);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildCanoes(ctx) {
  const items = island(ctx).canoes || [];
  if (!items.length) return;
  for (let i = 0; i < items.length; i++) buildCanoe(ctx, items[i], i);
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

// ---------------------------------------------------------------------------
// carvel-free carved shell
// ---------------------------------------------------------------------------

/**
 * Lofted U-shell as an indexed BufferGeometry (smooth normals).
 * `inner` builds the darker liner slightly inboard, with reversed winding so its faces
 * point into the boat interior.
 */
function hullGeometry(inner) {
  const K = HULL.K;
  const N = HULL.N;
  const pos = [];
  const uv = [];
  const idx = [];
  const rings = [];
  for (let i = 0; i < N; i++) {
    const t = 0.008 + (i / (N - 1)) * 0.984;
    const p = stationParams(t);
    const pts = [];
    let arc = 0;
    const arcs = [0];
    for (let k = 0; k < K; k++) {
      const q = sectionPoint(p, k, inner ? HULL.T : 0);
      pts.push(q);
      if (k > 0) arc += Math.hypot(q.x - pts[k - 1].x, q.y - pts[k - 1].y);
      arcs.push(arc);
    }
    rings.push({ p, pts, arcs });
  }
  for (const ring of rings) {
    for (let k = 0; k < K; k++) {
      pos.push(ring.pts[k].x, ring.pts[k].y, ring.p.z);
      uv.push(ring.p.z / 3.4, ring.arcs[k] / 2.2);
    }
  }
  for (let i = 0; i < N - 1; i++) {
    for (let k = 0; k < K - 1; k++) {
      const a = i * K + k;
      const b = a + 1;
      const c = a + K + 1;
      const d = a + K;
      if (inner) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    }
  }
  // pointed ends: fan the terminal ring onto a tip vertex on the centre line
  for (const end of [0, 1]) {
    const ring = rings[end === 0 ? 0 : N - 1];
    const tipZ = end === 0 ? -HULL.L / 2 : HULL.L / 2;
    const tipY = ring.p.top - (inner ? 0.035 : 0.018);
    const tip = pos.length / 3;
    pos.push(0, tipY, tipZ);
    uv.push(0.5, 0.5);
    const base = (end === 0 ? 0 : (N - 1)) * K;
    for (let k = 0; k < K - 1; k++) {
      const p0 = base + k;
      const p1 = p0 + 1;
      if (inner) {
        if (end === 0) idx.push(tip, p0, p1);
        else idx.push(tip, p1, p0);
      } else if (end === 0) idx.push(tip, p1, p0);
      else idx.push(tip, p0, p1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Narrow strip joining the outer skin to the inner liner at the sheer (both sides). */
function rimGeometry() {
  const K = HULL.K;
  const N = HULL.N;
  const pos = [];
  const uv = [];
  const idx = [];
  const rings = [];
  for (let i = 0; i < N; i++) {
    const t = 0.008 + (i / (N - 1)) * 0.984;
    const p = stationParams(t);
    const outerL = sectionPoint(p, 0, 0);
    const innerL = sectionPoint(p, 0, HULL.T);
    const outerR = sectionPoint(p, K - 1, 0);
    const innerR = sectionPoint(p, K - 1, HULL.T);
    rings.push({ z: p.z, outerL, innerL, outerR, innerR });
  }
  for (const side of [0, 1]) {
    const off = pos.length / 3;
    for (const r of rings) {
      const a = side === 0 ? r.outerL : r.outerR;
      const b = side === 0 ? r.innerL : r.innerR;
      pos.push(a.x, a.y, r.z, b.x, b.y, r.z);
      uv.push(r.z / 2.6, 0, r.z / 2.6, 0.05);
    }
    for (let i = 0; i < N - 1; i++) {
      const a = off + i * 2;
      const b = a + 1;
      const c = a + 3;
      const d = a + 2;
      if (side === 0) idx.push(a, d, c, a, c, b);
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

function buildCanoe(ctx, item, index) {
  const base = matrixFor(item.x, item.y ?? 0, item.z, 0, item.ry ?? 0, 0, item.s ?? 1);
  const add = placer(ctx, base);
  const rng = makeRNG(5200 + index * 71);

  // --------------------------------------------------------------- hull shell
  // carved seams + adze facets come from the geometry vertex colours: three dark
  // transverse section lines where the log was worked down, and a soft irregular
  // tooling pattern along the flanks (audit D-25)
  {
    const outer = hullGeometry(false);
    gradientTint(outer, (hx, hy, hz) => {
      let seam = 9;
      for (const sz of [-1.35, 0.1, 1.55]) seam = Math.min(seam, Math.abs(hz - sz));
      const seamK = seam < 0.028 ? 0.6 : seam < 0.06 ? 0.82 : 1.0;
      const adze = 0.94 + 0.06 * Math.sin(hx * 71 + hz * 23 + hy * 19);
      const up = 0.9 + 0.1 * Math.max(0, Math.min(1, (hy + 0.2) / 0.8));
      const v = seamK * adze * up;
      return [v, v * 0.99, v * 0.95];
    });
    add('wood', outer, 0, 0, 0);
    const inner = hullGeometry(true);
    gradientTint(inner, (hx, hy, hz) => {
      const v = 0.8 + 0.14 * Math.max(0, Math.min(1, (hy + 0.1) / 0.6));
      return [v * 0.96, v * 0.95, v * 0.92];
    });
    add('woodDark', inner, 0, 0, 0);
  }
  add('woodDark', rimGeometry(), 0, 0, 0);

  // ------------------------------------------------------------ gunwale rails
  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i < HULL.N; i++) {
      const t = 0.008 + (i / (HULL.N - 1)) * 0.984;
      const p = stationParams(t);
      const q = sectionPoint(p, side < 0 ? 0 : HULL.K - 1, 0);
      pts.push(new THREE.Vector3(q.x + side * 0.006, q.y + 0.012, p.z));
    }
    add('woodDark', tubeGeo(pts, 0.029, { tubularSeg: 22, radialSeg: 4, tile: 1.4 }), 0, 0, 0);
  }

  // four mooring holes bored through the sheer (worn lip + dark bore)
  for (const [hz, side] of [[-1.62, -1], [-1.62, 1], [1.82, -1], [1.82, 1]]) {
    const q = sectionPoint(paramsAt(hz), side < 0 ? 0 : HULL.K - 1, 0);
    add('dark', cylGeo(0.028, 0.028, 0.05, { radial: 6 }), q.x - side * 0.012, q.y + 0.01, hz,
      0, 0, Math.PI / 2);
    add('woodDark', cylGeo(0.04, 0.036, 0.016, { radial: 6 }), q.x - side * 0.033, q.y + 0.01, hz,
      0, 0, Math.PI / 2);
  }

  // --------------------------------------------------- exterior grain / wear
  // tooled ridges follow the grain along the outside of the log
  for (const k of [2, 8]) {
    const pts = [];
    for (let i = 0; i < HULL.N; i++) {
      const t = 0.008 + (i / (HULL.N - 1)) * 0.984;
      const p = stationParams(t);
      const q = sectionPoint(p, k, -0.012);
      pts.push(new THREE.Vector3(q.x, q.y, p.z));
    }
    add('wood', tubeGeo(pts, 0.012, { tubularSeg: 20, radialSeg: 4, tile: 1.2 }), 0, 0, 0);
  }
  // keel ridge down the belly
  {
    const pts = [];
    for (let i = 0; i < HULL.N; i++) {
      const t = 0.008 + (i / (HULL.N - 1)) * 0.984;
      const p = stationParams(t);
      pts.push(new THREE.Vector3(0, p.keel - 0.004, p.z));
    }
    add('woodDark', tubeGeo(pts, 0.017, { tubularSeg: 20, radialSeg: 4, tile: 1.4 }), 0, 0, 0);
  }
  // a long scrape mark where it was dragged over the sand, plus short adze facets
  {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const z = -1.3 + 2.2 * (i / 6);
      const p = paramsAt(z);
      const q = sectionPoint(p, 2, -0.006);
      pts.push(new THREE.Vector3(q.x, q.y, z));
    }
    add('woodDark', tubeGeo(pts, 0.008, { tubularSeg: 12, radialSeg: 4, tile: 1.0 }), 0, 0, 0);
  }
  for (const [k, z0, len] of [[3, -1.05, 0.36], [7, 0.35, 0.4], [3, 1.5, 0.3]]) {
    const pts = [];
    for (let i = 0; i <= 3; i++) {
      const z = z0 + len * (i / 3);
      const p = paramsAt(z);
      const q = sectionPoint(p, k, -0.008);
      pts.push(new THREE.Vector3(q.x, q.y, z));
    }
    add('woodDark', tubeGeo(pts, 0.009, { tubularSeg: 6, radialSeg: 4, tile: 0.8 }), 0, 0, 0);
  }

  // ------------------------------------------------------------- grown ribs
  // five ribs left standing proud on the inside of the carved hull
  for (const rz of [-1.55, -1.0, -0.4, 0.35, 1.15]) {
    const p = paramsAt(rz);
    const pts = [];
    for (let k = 1; k < HULL.K - 1; k++) {
      const q = sectionPoint(p, k, HULL.T + 0.004);
      pts.push(new THREE.Vector3(q.x, q.y, rz));
    }
    add('wood', tubeGeo(pts, 0.013, { tubularSeg: 10, radialSeg: 4, tile: 1.2 }), 0, 0, 0);
  }

  // ---------------------------------------------------------------- thwarts
  for (const tz of [-0.95, 0.15, 1.16]) {
    const hw = innerHalfW(tz);
    const wy = gunwaleY(tz) - 0.075;
    add('wood', plateGeo(hw * 2 - 0.04, 0.17, 0.04, { bevel: 0.01, tile: 1.2 }),
      0, wy, tz, -Math.PI / 2, (rng() - 0.5) * 0.02, 0);
    for (const side of [-1, 1]) {
      add('woodDark', cylGeo(0.022, 0.026, 0.055, { radial: 5 }),
        side * (hw - 0.07), wy - 0.035, tz);
    }
  }
  // two loose floorboards lie along the bilge (the lighter worn wood of the original log)
  for (const side of [-1, 1]) {
    add('wood', plateGeo(0.3, 1.35, 0.032, { bevel: 0.01, tile: 1.2 }),
      side * 0.17, innerKeelY(0.1) + 0.045, 0.05, -Math.PI / 2, side * 0.02, 0);
  }

  // -------------------------------------------------------- floor stringers
  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i < 9; i++) {
      const z = -1.35 + i * 0.34;
      const p = paramsAt(z);
      pts.push(new THREE.Vector3(side * (p.w * 0.42), innerKeelY(z) + 0.016, z));
    }
    add('woodDark', tubeGeo(pts, 0.019, { tubularSeg: 10, radialSeg: 4, tile: 1.2 }), 0, 0, 0);
  }

  // ------------------------------------------------------------ coiled rope
  {
    const ry = innerKeelY(1.28) + 0.03;
    for (let i = 0; i < 3; i++) {
      add('rope', torusGeo(0.16 - i * 0.02, 0.018, { radialSeg: 4, tubularSeg: 10, tile: 1.0 }),
        0.06 + i * 0.012, ry + i * 0.028, 1.28, -Math.PI / 2, 0, i * 0.3);
    }
    add('rope', tubeGeo([
      new THREE.Vector3(0.08, ry + 0.06, 1.12),
      new THREE.Vector3(0.2, ry + 0.05, 0.92),
      new THREE.Vector3(0.42, ry + 0.04, 0.78),
    ], 0.016, { tubularSeg: 10, radialSeg: 4, tile: 1.0 }), 0, 0, 0);
  }

  // --------------------------------------------------------------- bow rope
  {
    const tipY = (gunwaleY(-2.0) + paramsAt(-2.0).keel) * 0.5 + 0.1;
    add('rope', torusGeo(0.07, 0.016, { radialSeg: 4, tubularSeg: 10, tile: 1.0 }),
      0, tipY - 0.02, -2.26, 0.25, 0, 0.1);
    for (const side of [-1, 1]) {
      add('rope', rodGeo(side * 0.09, tipY + 0.14, -2.06, 0, tipY + 0.03, -2.24, 0.014, { radial: 4, tile: 1.0 }),
        0, 0, 0);
    }
    // rope tail running back along the gunwale to the first thwart
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const z = -2.0 + i * 0.22;
      pts.push(new THREE.Vector3(innerHalfW(z) - 0.045, gunwaleY(z) + 0.03, z));
    }
    add('rope', tubeGeo(pts, 0.013, { tubularSeg: 12, radialSeg: 4, tile: 1.0 }), 0, 0, 0);
  }

  // ------------------------------------------------------------------ paddle
  {
    // stowed leaning against the port sheer: handle butt on the floorboards, blade resting
    // up on the gunwale — reads as a paddle put down in a hurry, not a plank on the ground
    const A = new THREE.Vector3(0.04, innerKeelY(0.25) + 0.03, 0.3);    // handle butt on the floor
    const B = new THREE.Vector3(-0.26, gunwaleY(0.15) - 0.045, 0.15);   // shaft bridged over the mid thwart
    const f = new THREE.Vector3().subVectors(B, A).normalize();
    add('wood', rodGeo(A.x, A.y, A.z, B.x, B.y, B.z, 0.023, { radial: 5, tile: 1.6 }), 0, 0, 0);
    // flat blade aligned with the shaft, lying against the hull side
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(f, -f.y).normalize();
    const side = new THREE.Vector3().crossVectors(f, up).normalize();
    const blade = plateGeo(0.46, 0.19, 0.032, { bevel: 0.012, tile: 0.9 });
    blade.rotateX(-Math.PI / 2);
    const m = new THREE.Matrix4().makeBasis(f, up, side);
    m.setPosition(B.clone().addScaledVector(f, -0.14));
    m.premultiply(base);
    prepareTint(blade, B.x - f.x * 0.14, B.y - f.y * 0.14, B.z - f.z * 0.14, 'wood');
    ctx.batcher.add('wood', blade, m);
    blade.dispose();
    // grip knob at the handle end
    const grip = new THREE.Matrix4().makeBasis(up, f, side);
    grip.setPosition(A.clone().addScaledVector(f, 0.02));
    grip.premultiply(base);
    const gripGeo = cylGeo(0.03, 0.028, 0.11, { radial: 6 });
    prepareTint(gripGeo, A.x, A.y, A.z, 'woodDark');
    ctx.batcher.add('woodDark', gripGeo, grip);
    gripGeo.dispose();
  }

  // ------------------------------------------------------------------ bailer
  add('woodDark', cylGeo(0.075, 0.055, 0.1, { radial: 8, open: true }), 0.2, innerKeelY(0.55) + 0.06, 0.5, 0.35, 0.6, 0.2);
  add('wood', plateGeo(0.16, 0.03, 0.028, { bevel: 0.008, tile: 0.8 }), 0.2, innerKeelY(0.55) + 0.115, 0.42,
    0, 0.6, 0.9);

  // ------------------------------------------------------ burls & sand contact
  for (const [z, k, s] of [[-0.2, 2, 0.055], [0.7, 8, 0.05], [1.55, 3, 0.045], [-1.35, 7, 0.04]]) {
    const p = paramsAt(z);
    const q = sectionPoint(p, k, 0.008);
    add('woodDark', rockGeo(s, { detail: 0, flatten: 1, seed: 640 + k }), q.x, q.y, z, 0, rng() * TAU, 0);
  }
  // damp sand banked under the hull: kept strictly inside the hull footprint so the model
  // bbox stays the canoe itself (the beach around it is supplied by the island terrain)
  const patch = (key, x, z, rx, rz, ry, seed) =>
    add(key, rockGeo(1, { detail: 1, flatten: 0.05, seed }), x, 0.034, z, 0, ry, 0, rx, 1, rz);
  patch('beachSand', 0.0, 0.15, 0.38, 0.62, 0.06, 701);
  patch('beachSand', -0.08, -0.72, 0.3, 0.5, 0.12, 702);
  patch('mud', 0.02, 0.1, 0.3, 0.55, 0.05, 704);
  patch('mud', 0.06, 1.28, 0.24, 0.4, 0.1, 705);
}
