/**
 * S4 · DRIFTWOOD — bleached storm-tossed log (P1, see ISLAND_ASSETS.md §2.4).
 *
 * A silver-grey log that has been in the sea for a long time: the salt water has worn the
 * bark and the soft grain away, so the surface is smooth and rounded with raised hard grain
 * ridges, the sun-bleached end has cracked open into radiating splits and the root end is a
 * ball of blunt, sea-rounded root fingers. A few strands of dark seaweed have caught on it
 * and it lies half settled into the damp sand.
 *
 * Local space: log length along X, y = 0 at the sand line, front / camera side is -Z.
 */
import * as THREE from 'three';
import { TAU, matrixFor } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import {
  cylGeo,
  rockGeo,
  rodGeo,
  tubeGeo,
  plateGeo,
  sphereGeo,
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

export const meta = { id: 'driftwood', kind: 'world', group: 'shore', label: '浮木 · DRIFTWOOD' };

/** Stage preview: sample layout, then one hero log. */
export function build(ctx) {
  island(ctx).driftwood = [{ x: 0, y: 0, z: 0, ry: 0.2, s: 1 }];
  buildDriftwood(ctx);
}

/** Map assembly: one log per `layout.island.driftwood` entry, no-op when absent. */
export function buildWorld(ctx) {
  buildDriftwood(ctx);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildDriftwood(ctx) {
  const items = island(ctx).driftwood || [];
  if (!items.length) return;
  for (let i = 0; i < items.length; i++) buildLog(ctx, items[i], i);
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

/** Parameters of the main log (metres). */
const LOG = { L: 2.95, bend: 0.18, r0: 0.24, taper: 0.55, seed: 5 };

/** Cross-section parameters at station `u` (0 = root end, 1 = broken tip). */
function stationAt(u, log) {
  const x = -log.L / 2 + u * log.L;
  const cz = log.bend * Math.sin(u * Math.PI * 0.85);
  let r = log.r0 * (1 - log.taper * u) + 0.018 * Math.sin(u * 11 + log.seed) + 0.01 * Math.sin(u * 27 + log.seed * 2);
  if (u < 0.14) r += 0.11 * (1 - u / 0.14); // root swell
  // the thin tip has settled into the sand, so the axis gently slopes down along the log
  const cy = r * 0.78 - 0.015 + 0.02 * Math.sin(u * 3.4 + 0.7);
  return { x, cy, cz, r };
}

/**
 * Lofted driftwood log: a bent, tapered cylinder with a root swell at the -X end, an
 * elliptical section (flattened on the sand side) and a jagged broken tip at +X.
 */
function logGeometry({ L = 2.95, bend = 0.18, r0 = 0.24, taper = 0.55, seed = 5, stations = 17, radial = 10 } = {}) {
  const log = { L, bend, r0, taper, seed };
  const rings = [];
  for (let i = 0; i < stations; i++) {
    const u = i / (stations - 1);
    const s = stationAt(u, log);
    const pts = [];
    let arc = 0;
    const arcs = [0];
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * TAU;
      const rr = s.r * (0.9 + 0.2 * Math.sin(a * 3 + u * 6 + seed));
      const py = s.cy + Math.cos(a) * rr * 0.75;
      const pz = s.cz + Math.sin(a) * rr;
      if (k > 0) arc += Math.hypot(py - pts[k - 1][1], pz - pts[k - 1][2]);
      arcs.push(arc);
      pts.push([s.x, py, pz]);
    }
    rings.push({ x: s.x, cy: s.cy, cz: s.cz, r: s.r, pts, arcs });
  }
  const pos = [];
  const uv = [];
  const idx = [];
  for (const ring of rings) {
    for (let k = 0; k < radial; k++) {
      pos.push(ring.pts[k][0], ring.pts[k][1], ring.pts[k][2]);
      uv.push(ring.x / 1.3, ring.arcs[k] / 1.3);
    }
  }
  for (let i = 0; i < stations - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      const c = (i + 1) * radial + ((k + 1) % radial);
      const d = (i + 1) * radial + k;
      idx.push(a, b, c, a, c, d);
    }
  }
  // root end cap (buried under the root ball) and jagged broken tip cap
  const first = 0;
  const last = (stations - 1) * radial;
  const rootTip = pos.length / 3;
  pos.push(rings[0].x - 0.03, rings[0].cy, rings[0].cz);
  uv.push(0.5, 0.5);
  const brokenTip = pos.length / 3;
  pos.push(rings[stations - 1].x + 0.05, rings[stations - 1].cy + 0.02, rings[stations - 1].cz);
  uv.push(0.5, 0.5);
  for (let k = 0; k < radial; k++) {
    const a = first + k;
    const b = first + ((k + 1) % radial);
    idx.push(rootTip, b, a);
    const c = last + k;
    const d = last + ((k + 1) % radial);
    idx.push(brokenTip, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Surface point of the main log at station `u` / angle `a`, usable for roots and seaweed. */
function logPoint(u, a, log = LOG) {
  const s = stationAt(u, log);
  const rr = s.r * (0.9 + 0.2 * Math.sin(a * 3 + u * 6 + log.seed));
  return new THREE.Vector3(s.x, s.cy + Math.cos(a) * rr * 0.75, s.cz + Math.sin(a) * rr);
}

function buildLog(ctx, item, index) {
  const base = matrixFor(item.x, item.y ?? 0, item.z, 0, item.ry ?? 0, 0, item.s ?? 1);
  const add = placer(ctx, base);
  const rng = makeRNG(6100 + index * 53);

  // ------------------------------------------------------------------ main log
  // salt-bleached driftwood: pale ash-grey on the sun-facing top, darker damp
  // timber where it sits in the sand (the old flat tint read as near-black, D-10)
  {
    const logGeo = logGeometry(LOG);
    gradientTint(logGeo, (gx, gy, gz) => {
      const top = Math.max(0, Math.min(1, (gy + 0.05) / 0.55));
      const grain = 1 + Math.sin(gx * 9.7 + gz * 3.1) * 0.025;
      const s = (0.74 + top * 0.36) * grain;
      return [s * 1.02, s * 1.005, s * 0.97];
    });
    add('driftWood', logGeo, 0, 0, 0);
  }

  // --------------------------------------------------------- sea-rounded roots
  // Two thick, tapered root butts worn round by the surf (six thin radiating
  // fingers used to read as dead-spider legs, audit D-10).
  for (let i = 0; i < 2; i++) {
    const a = i === 0 ? 1.15 : 4.1;
    const root = logPoint(0.04, a, LOG);
    root.y = Math.max(0.12, root.y);
    const mid = root.clone().add(new THREE.Vector3(-0.22, -0.03 + i * 0.03, Math.cos(a) * 0.14));
    mid.y = Math.max(0.12, mid.y);
    // thick butt to mid, then a shorter run that ends in a rounded, worn disc
    add('driftWood', cylGeo(0.075, 0.11, 0.3, { radial: 6, tile: 1.0 }), root.x - 0.1, root.y - 0.02, root.z,
      0, 0, Math.PI / 2 + a * 0.06);
    add('driftWood', cylGeo(0.055, 0.075, 0.26, { radial: 6, tile: 1.0 }), mid.x - 0.1, mid.y - 0.05, mid.z,
      0, a * 0.2, Math.PI / 2 + 0.08);
    add('driftWood', rockGeo(0.075, { detail: 1, flatten: 0.7, seed: 92 + i, tile: 1.1 }),
      mid.x - 0.24, Math.max(0.08, mid.y - 0.1), mid.z, 0, a, 0.2);
  }
  // the weathered root ball itself
  add('driftWood', rockGeo(0.24, { detail: 1, flatten: 0.85, seed: 91 }), -LOG.L / 2 + 0.12, 0.24, 0.02, 0.2, 0.6, 0.1);

  // -------------------------------------------------------- broken branch stubs
  for (const [u, a, len, tilt] of [[0.36, 0.55, 0.34, -0.85], [0.58, 4.9, 0.26, 0.7], [0.22, 2.6, 0.3, -1.2]]) {
    const p = logPoint(u, a, LOG);
    const dir = new THREE.Vector3(Math.cos(a) * 0.6, 0.72, Math.sin(a) * 0.5 - 0.25).normalize();
    const tip = p.clone().addScaledVector(dir, len);
    add('driftWood', rodGeo(p.x, p.y, p.z, tip.x, tip.y, tip.z, 0.045, { radial: 4, tile: 1.0 }), 0, 0, 0);
    // sawn / snapped end: a pale disc and a couple of splinter shards
    const rx = tilt * 0.5;
    add('driftWood', cylGeo(0.04, 0.045, 0.012, { radial: 5, tile: 0.6 }), tip.x, tip.y, tip.z, rx, 0, tilt);
    add('driftWood', plateGeo(0.05, 0.09, 0.012, { bevel: 0.004, tile: 0.6 }), tip.x, tip.y + 0.03, tip.z, tilt, rng() * TAU, 0);
  }

  // ---------------------------------------------------- grain ridges / long wear
  // the hard grain survives the salt water: raised silver ridges along the log
  for (const a of [0.35, 2.75, 4.5]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const u = 0.06 + (i / 10) * 0.86;
      const p = logPoint(u, a + 0.05 * Math.sin(i * 1.7), LOG);
      pts.push(new THREE.Vector3(p.x, p.y + 0.008, p.z + 0.008));
    }
    add('driftWood', tubeGeo(pts, 0.009, { tubularSeg: 10, radialSeg: 4, tile: 1.1 }), 0, 0, 0);
  }
  // two long sun-cracks opening along the top of the log
  for (const [a, u0, u1] of [[5.2, 0.2, 0.8], [1.9, 0.3, 0.72], [3.5, 0.45, 0.9]]) {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const u = u0 + (u1 - u0) * (i / 6);
      const p = logPoint(u, a + 0.12 * Math.sin(i * 2.1), LOG);
      pts.push(new THREE.Vector3(p.x, p.y - 0.006, p.z - 0.006));
    }
    add('woodDark', tubeGeo(pts, 0.014, { tubularSeg: 8, radialSeg: 4, tile: 0.9 }), 0, 0, 0);
  }

  // ------------------------------------------------------------- cracked end
  // the broken +X end splits into radiating cracks and a splintered shard
  const sEnd = stationAt(1, LOG);
  const endX = sEnd.x + 0.045;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.4;
    const inner = new THREE.Vector3(endX + 0.005,
      Math.max(0.05, sEnd.cy + Math.cos(a) * 0.035), sEnd.cz + Math.sin(a) * 0.035);
    const outer = inner.clone().add(new THREE.Vector3(-0.02, Math.cos(a) * 0.13, Math.sin(a) * 0.13));
    outer.y = Math.max(0.05, outer.y);
    add('woodDark', tubeGeo([inner, outer], 0.009, { tubularSeg: 4, radialSeg: 3, tile: 0.6 }), 0, 0, 0);
  }
  // the broken end has been rolled by the surf: a rounded worn cap, plus one
  // splinter left instead of two flat cardboard shards
  add('driftWood', cylGeo(sEnd.r * 0.82, sEnd.r * 0.62, 0.09, { radial: 8, tile: 0.9 }),
    endX + 0.02, sEnd.cy + 0.01, sEnd.cz, 0, rng() * TAU, Math.PI / 2);
  add('driftWood', plateGeo(0.05, 0.16, 0.018, { bevel: 0.006, tile: 0.8 }), endX - 0.05, Math.max(0.12, sEnd.cy - 0.06), sEnd.cz - 0.07, -0.3, -0.5, 0.3);

  // -------------------------------------------------------------- seaweed
  // dark weed strands caught over the log (kept above the sand line)
  for (let i = 0; i < 7; i++) {
    const u = 0.16 + rng() * 0.7;
    const a = rng() * TAU;
    const p = logPoint(u, a, LOG);
    const py = Math.max(0.13, p.y + 0.012);
    add('broadleafDark', leafQuad(0.26 + rng() * 0.24, 0.06 + rng() * 0.04, rng() < 0.5 ? 'banana' : 'vine'),
      p.x, py, p.z,
      -Math.PI / 2 + (rng() - 0.5) * 0.5,
      rng() * TAU, (rng() - 0.5) * 0.4);
  }
  // dried kelp holdfast hanging off the underside
  add('broadleafDark', leafQuad(0.34, 0.16, 'broad'), sEnd.x - 0.5, 0.16, sEnd.cz + 0.18, -0.3, 1.2, 1.1);

  // ------------------------------------------------------------ barnacle scars
  for (let i = 0; i < 4; i++) {
    const u = 0.15 + rng() * 0.6;
    const a = 2.2 + rng() * 2.0;
    const p = logPoint(u, a, LOG);
    add('ruinStone', cylGeo(0.006, 0.026, 0.016, { radial: 4 }), p.x, p.y, p.z, Math.PI / 2, rng() * TAU, 0);
  }

  // -------------------------------------------------- second, smaller log piece
  const L2 = 1.25;
  add('driftWood', logGeometry({ L: L2, stations: 9, radial: 7, r0: 0.13, taper: 0.4, bend: 0.06, seed: 17, axisY: 0.14 }),
    0.32, 0.02, 0.78, 0, 1.25, 0.06);
  add('woodDark', plateGeo(0.2, 0.05, 0.02, { bevel: 0.005, tile: 0.7 }), 0.75, 0.05, 0.95, 0.1, 0.9, 0.2);

  // ------------------------------------------------------------- sand contact
  const patch = (key, x, z, rx, rz, ry, seed) =>
    add(key, rockGeo(1, { detail: 1, flatten: 0.03, seed }), x, 0.008, z, 0, ry, 0, rx, 0.5, rz);
  patch('beachSand', 0.05, 0.1, 0.55, 0.85, 0.15, 201);
  patch('mud', 0.1, -0.1, 0.42, 0.7, 0.4, 203);
  // a few pebbles and shell bits washed up beside the log
  for (let i = 0; i < 8; i++) {
    const a = rng() * TAU;
    const rr = 0.55 + rng() * 1.15;
    const s = 0.05 + rng() * 0.07;
    add(i % 2 ? 'ruinStoneDark' : 'ruinStone', rockGeo(s, { detail: 0, flatten: 0.55, seed: 210 + i }),
      Math.cos(a) * rr, s * 0.42, 0.35 + Math.sin(a) * rr, 0, rng() * TAU, 0);
  }
  for (let i = 0; i < 3; i++) {
    add('beachSand', cylGeo(0.004, 0.028, 0.016, { radial: 5 }),
      -0.4 + rng() * 1.6, 0.03, -0.4 + rng() * 1.1, 1.25, rng() * TAU, 0);
  }
  // wet drag trail where the log was pushed up the beach
  add('mud', sphereGeo(0.2, { segW: 8, segH: 6, tile: 1.6 }), -1.35, 0.012, -0.55, 0, 0.5, 0, 1.6, 0.05, 0.9);
}
