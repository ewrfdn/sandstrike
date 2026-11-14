/**
 * FALLEN LOG 鈥?F8 (see ISLAND_ASSETS.md 搂2.1).
 *
 * A mossy rainforest tree trunk that came down across the understory: bowed log
 * body with raised bark ridges, a jagged broken end with splinters, an upright
 * buttress root plate, snapped branch stumps, wet moss patches, shelf fungi, a vine
 * creeping over one section and rotten leaf litter banked along the ground contact.
 *
 * Rules honoured here: metres, +Y up, front is -Z, the log rests on the soil; all
 * randomness comes from one fixed-seed `makeRNG()`; the stage build is one hero log,
 * the map build reads `layout.island.fallenLogs` (missing key = no-op).
 */
import * as THREE from 'three';
import {
  makeInstanced,
  matrixFor,
  transformed,
  mergeGeometries,
  bakeVertexAO,
  TAU,
} from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { cylGeo, latheGeo, rockGeo, sphereGeo } from '../detail.js';
import { leafCellUV, canopyQuad, grassQuad } from './leaf-atlas.js';

export const meta = { id: 'fallen-log', kind: 'world', group: 'flora', label: '鍊掓湪 路 FALLEN LOG' };

/** Preview builder (stage/WebUI): one-item sample layout + hero log. */
export function build(ctx) {
  island(ctx).fallenLogs = [{ x: 0, z: 0, ry: 0.1, s: 1 }];
  buildFallenLogs(ctx, true);
}

/** Map assembly builder: instantiates every log from ctx.data.layout. */
export function buildWorld(ctx) {
  buildFallenLogs(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

// ---------------------------------------------------------------------------
// local geometry helpers (self-contained model file 鈥?see the bucket contract)
// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _mid = new THREE.Vector3();

function push(list, geo, matrix) {
  list.push(transformed(geo, matrix));
  geo.dispose();
}

function merge(list) {
  const merged = mergeGeometries(list);
  for (const g of list) g.dispose();
  return merged;
}

const REF = new THREE.Vector3(1, 0, 0);
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _nrm = new THREE.Vector3();

/**
 * Matrix that lays a flat object (flattened moss pad: its local +Y is the flatten axis)
 * onto the trunk surface at `p`, so the pad follows the cylinder curvature instead of
 * floating above it. `roll` spins it in the surface plane, `lift` pushes it out.
 */
function discMatrix(p, roll = 0, lift = 0) {
  _nrm.set(p.dx, p.dy, p.dz).normalize();
  _a.copy(REF);
  if (Math.abs(_nrm.dot(_a)) > 0.95) _a.set(0, 0, 1);
  _bx.crossVectors(_nrm, _a).normalize();
  _by.crossVectors(_nrm, _bx).normalize();
  // local X = bx, local Y = surface normal, local Z = by  -> the pad lies on the bark
  const m = new THREE.Matrix4().makeBasis(_bx, _nrm.clone(), _by.clone());
  m.setPosition(p.x + _nrm.x * lift, p.y + _nrm.y * lift, p.z + _nrm.z * lift);
  if (roll) m.multiply(new THREE.Matrix4().makeRotationY(roll));
  return m;
}

/** Matrix that stands a +Z-facing card upright on the trunk surface (grass/leaf cards). */
function surfaceMatrix(p, roll = 0, lift = 0) {
  _nrm.set(p.dx, p.dy, p.dz).normalize();
  _b.set(0, 1, 0).addScaledVector(_nrm, -_nrm.y);
  if (_b.lengthSq() < 1e-5) _b.set(1, 0, 0);
  _b.normalize(); // "up" along the surface
  _bx.crossVectors(_b, _nrm).normalize();
  _by.crossVectors(_nrm, _bx).normalize();
  const m = new THREE.Matrix4().makeBasis(_bx.clone(), _by.clone(), _nrm.clone());
  m.setPosition(p.x + _nrm.x * lift, p.y + _nrm.y * lift, p.z + _nrm.z * lift);
  if (roll) m.multiply(new THREE.Matrix4().makeRotationZ(roll));
  return m;
}

/** Re-map a wrapped geometry to planar world XZ UVs (soil no longer reads as stripes). */
function planarUV(geo, tile = 1.3) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
  uv.needsUpdate = true;
  return geo;
}

/** Card-count multiplier per quality tier (topology stays identical). */
function cardScale(ctx) {
  const q = ctx.quality || 'high';
  if (q === 'lowest') return 0.6;
  if (q === 'low') return 0.75;
  return 1;
}

/** Tapered open cylinder between two points (roots, splinters, branch stumps). */
function rod(list, ax, ay, az, bx, by, bz, r0, r1 = r0, radial = 4) {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  _dir.subVectors(_b, _a);
  const len = _dir.length();
  if (len < 1e-4) return;
  _dir.multiplyScalar(1 / len);
  _q.setFromUnitVectors(UP, _dir);
  _mid.copy(_a).add(_b).multiplyScalar(0.5);
  push(list, cylGeo(r1, r0, len, { radial, tile: 1.6, open: true }), new THREE.Matrix4().compose(_mid, _q, ONE));
}

/** Arched alpha leaf card (base at the origin, +X out, +Y up, width along +Z). */
function leafCard(len, width, cell, {
  th0 = 0.8, k = 1.1, segs = 3, cols = 2, roll = 0, fold = 0.14,
} = {}) {
  const { u0, v0, u1, v1 } = leafCellUV(cell, 0.02);
  const vcount = (segs + 1) * cols;
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const uv = new Float32Array(vcount * 2);
  const cw = Math.cos(roll);
  const sw = Math.sin(roll);
  const sag = len / k;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = th0 - k * t;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    const px = sag * (Math.sin(th0) - sa);
    const py = sag * (ca - Math.cos(th0));
    const wx = -sa * sw;
    const wy = ca * sw;
    const wz = cw;
    const nx = -sa * cw;
    const ny = ca * cw;
    const nz = -sw;
    const ramp = Math.min(1, t / 0.12);
    const halfW = width * 0.5 * (0.35 + 0.65 * ramp) * (t <= 0.85 ? 1 : 1 - 0.4 * ((t - 0.85) / 0.15));
    for (let j = 0; j < cols; j++) {
      const u = cols > 1 ? j / (cols - 1) - 0.5 : 0;
      const lat = halfW * 2 * u;
      const droop = -fold * Math.abs(u) * 2 * width * 0.5;
      const vi = i * cols + j;
      pos[vi * 3] = px + wx * lat + nx * droop;
      pos[vi * 3 + 1] = py + wy * lat + ny * droop;
      pos[vi * 3 + 2] = wz * lat + nz * droop;
      nor[vi * 3] = nx;
      nor[vi * 3 + 1] = ny;
      nor[vi * 3 + 2] = nz;
      uv[vi * 2] = u0 + (u1 - u0) * t;
      uv[vi * 2 + 1] = v0 + (v1 - v0) * (cols > 1 ? j / (cols - 1) : 0.5);
    }
  }
  const index = [];
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a0 = i * cols + j;
      const b0 = a0 + cols;
      index.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/** Flat diamond dead leaf lying on the ground (2 triangles, leaf-litter material). */
function deadLeafGeo(len, width) {
  const pos = new Float32Array([
    0, 0, 0, len * 0.45, 0, width * 0.5, len, 0, 0,
    0, 0, 0, len, 0, 0, len * 0.45, 0, -width * 0.5,
  ]);
  const nor = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uv = new Float32Array([0, 0, 0.5, 0.5, 1, 0, 0, 1, 1, 1, 0.5, 0.5]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ---------------------------------------------------------------------------
// log skeleton
// ---------------------------------------------------------------------------

const LOG = {
  x0: -2.3, // broken end (-X)
  x1: 2.3, // root-plate end (+X)
  r0: 0.24, // radius at the broken end
  r1: 0.345, // radius at the butt
  yMid: 0.28, // centre-line height at the thin end
  rise: 0.1, // the butt end rides a little higher on its root plate
  sag: 0.03, // gentle upward bow of the middle
  curve: 0.13, // sideways bow of the centre line
};

/** Centre line of the log at normalised length t (0 = broken end, 1 = root). */
function logCenter(t) {
  const x = LOG.x0 + (LOG.x1 - LOG.x0) * t;
  const y = LOG.yMid + LOG.rise * t + LOG.sag * Math.sin(Math.PI * t);
  const z = LOG.curve * Math.sin(Math.PI * t * 0.9);
  return { x, y, z };
}

/** Log radius at normalised length t. */
function logRadius(t) {
  return LOG.r0 + (LOG.r1 - LOG.r0) * Math.pow(t, 0.8);
}

/** Orthonormal frame at t: tangent along the log, side/up across it. */
function logFrame(t) {
  const a = logCenter(Math.max(0, t - 0.01));
  const b = logCenter(Math.min(1, t + 0.01));
  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const tz = b.z - a.z;
  const tl = Math.hypot(tx, ty, tz) || 1;
  const T = [tx / tl, ty / tl, tz / tl];
  // side = up x tangent, up2 = tangent x side
  let sx = UP.y * T[2] - UP.z * T[1];
  let sy = UP.z * T[0] - UP.x * T[2];
  let sz = UP.x * T[1] - UP.y * T[0];
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl; sy /= sl; sz /= sl;
  const ux = T[1] * sz - T[2] * sy;
  const uy = T[2] * sx - T[0] * sz;
  const uz = T[0] * sy - T[1] * sx;
  return { T, S: [sx, sy, sz], U: [ux, uy, uz] };
}

/** Surface point + outward direction on the log at (t, angle). */
function logSurface(t, a) {
  const c = logCenter(t);
  const f = logFrame(t);
  const r = logRadius(t);
  const cl = Math.cos(a);
  const sl = Math.sin(a);
  const dx = f.S[0] * cl + f.U[0] * sl;
  const dy = f.S[1] * cl + f.U[1] * sl;
  const dz = f.S[2] * cl + f.U[2] * sl;
  return { x: c.x + dx * r, y: c.y + dy * r, z: c.z + dz * r, dx, dy, dz, r };
}

/**
 * The trunk body as one ring-swept tube (the bark texture supplies the cracks).
 * The radius wobbles slightly with angle so the silhouette is not a perfect
 * cylinder; the ring UVs keep the bark tile at ~2 m.
 */
function logBodyGeometry() {
  const RADIAL = 18;
  const SEGS = 16;
  const tile = 2.0;
  const pos = [];
  const uv = [];
  const index = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    const c = logCenter(t);
    const f = logFrame(t);
    const r = logRadius(t);
    for (let j = 0; j <= RADIAL; j++) {
      const a = (j / RADIAL) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const wob = 1 + 0.05 * Math.sin(a * 5 + t * 9) + 0.03 * Math.sin(a * 11 - t * 4) + 0.018 * Math.sin(t * 31);
      const rr = r * wob;
      pos.push(
        c.x + (f.S[0] * ca + f.U[0] * sa) * rr,
        c.y + (f.S[1] * ca + f.U[1] * sa) * rr,
        c.z + (f.S[2] * ca + f.U[2] * sa) * rr
      );
      uv.push(((j / RADIAL) * (TAU * r)) / tile, (t * (LOG.x1 - LOG.x0) * 1.04) / tile);
    }
  }
  for (let i = 0; i < SEGS; i++) {
    for (let j = 0; j < RADIAL; j++) {
      const a0 = i * (RADIAL + 1) + j;
      const b0 = a0 + RADIAL + 1;
      index.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Raised bark ridges running along the log (thin strips following the surface). */
function addBarkRidges(parts, rng) {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + rng() * 0.5;
    const t0 = 0.05 + rng() * 0.12;
    const t1 = 0.8 + rng() * 0.14;
    const STEPS = 3;
    let prev = null;
    for (let s = 0; s <= STEPS; s++) {
      const t = t0 + (t1 - t0) * (s / STEPS);
      const c = logCenter(t);
      const p = logSurface(t, a);
      // keep the ridge hugging the surface: offset radially by 1.5 cm
      const cur = {
        x: c.x + p.dx * (p.r + 0.015),
        y: c.y + p.dy * (p.r + 0.015),
        z: c.z + p.dz * (p.r + 0.015),
      };
      if (prev) rod(parts.bark, prev.x, prev.y, prev.z, cur.x, cur.y, cur.z, 0.015, 0.019, 3);
      prev = cur;
    }
  }
}

/**
 * Upright buttress root plate at the +X end: a thin soil/root disc standing at the butt
 * with root spokes fanning out of its rim. This is what makes the shape read as a
 * *fallen* trunk instead of a lying log. The first pass used a 34 cm thick cylinder,
 * which read as an upright wooden coin; it is now 10 cm thick and tipped 15 degrees,
 * with soil/root clumps banked against the ground contact.
 */
function addRootPlate(parts, rng) {
  const c = logCenter(1);
  const px = c.x + 0.12;
  const py = 0.56;
  const pz = c.z + 0.02;
  // the plate itself: a thin disc standing across the trunk axis, tilted 15 degrees
  const plate = cylGeo(0.48, 0.4, 0.1, { radial: 18, tile: 1.7 });
  push(parts.wood, plate, matrixFor(px, py, pz, 0, 0, Math.PI / 2));
  push(parts.wood, cylGeo(0.46, 0.44, 0.035, { radial: 16, tile: 1.4 }),
    matrixFor(px - 0.055, py, pz, 0.26, 0, Math.PI / 2 + 0.26));
  // soil/root clumps stuck to the plate faces
  for (let i = 0; i < 4; i++) {
    const blob = rockGeo(0.12 + rng() * 0.06, { detail: 1, seed: 200 + i, flatten: 0.75 });
    push(parts.mud, blob, matrixFor(px + 0.07, py + (rng() - 0.5) * 0.42, pz + (rng() - 0.5) * 0.42, rng(), rng() * TAU, rng()));
  }
  // radial root ridges across the plate face: a plain smooth disc reads as a wooden
  // coin from the side, the ridges make it read as a torn-out root plate
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.4 + rng() * 0.3;
    const rr = 0.12 + rng() * 0.1;
    const len = 0.24 + rng() * 0.16;
    rod(parts.wood,
      px + 0.05 + (rng() - 0.5) * 0.04, py + Math.sin(a) * rr, pz + Math.cos(a) * rr,
      px + 0.05 + (rng() - 0.5) * 0.04, py + Math.sin(a) * (rr + len), pz + Math.cos(a) * (rr + len),
      0.028, 0.012, 3);
  }
  // soil banked up where the plate meets the floor (kills the "floating disc" gap)
  const skirt = sphereGeo(0.42, { segW: 12, segH: 6, tile: 1.3 });
  skirt.scale(0.9, 0.16, 1.05);
  skirt.computeVertexNormals();
  push(parts.mud, skirt, matrixFor(px + 0.16, 0.06, pz, 0, 0.4, 0));
  // root spokes fanning out of the rim in the plate plane (YZ)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.25 + rng() * 0.2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const r0 = 0.38;
    const r1 = 0.54 + rng() * 0.12;
    const sx = px + 0.02;
    const sy = py + sa * r0;
    const sz = pz + ca * r0;
    const mx = px - 0.04;
    // roots pointing down stop at the soil line instead of spearing the floor
    const my = Math.max(0.16, py + sa * r1);
    const mz = pz + ca * r1;
    // roots bend towards the ground at their outer end
    rod(parts.wood, sx, sy, sz, mx, my, mz, 0.085, 0.048, 4);
    rod(parts.wood, mx, my, mz, px - 0.14, Math.max(0.045, my * 0.5), mz + ca * 0.1, 0.048, 0.012, 4);
    // fibrous rootlets fraying off each spoke
    if (i % 2 === 0) {
      rod(parts.wood, (sx + mx) * 0.5, (sy + my) * 0.5, (sz + mz) * 0.5,
        (sx + mx) * 0.5 + ca * 0.12, Math.max(0.04, (sy + my) * 0.5 - 0.1), (sz + mz) * 0.5 + sa * 0.1,
        0.02, 0.004, 3);
    }
  }
}

/** Jagged broken end at -X: splinters around a recessed dark core. */
function addBrokenEnd(parts, rng) {
  const c = logCenter(0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + rng() * 0.4;
    const rr = LOG.r0 * (0.5 + rng() * 0.42);
    const len = 0.1 + rng() * 0.18;
    rod(parts.bark,
      c.x + 0.05, c.y + Math.cos(a) * rr, c.z + Math.sin(a) * rr,
      c.x - len, c.y + Math.cos(a) * rr * 1.2, c.z + Math.sin(a) * rr * 1.2,
      0.04 + rng() * 0.02, 0.004, 3);
  }
  // torn longitudinal splinters bridging the break
  for (let i = 0; i < 6; i++) {
    const a = rng() * TAU;
    const rr = LOG.r0 * (0.2 + rng() * 0.55);
    rod(parts.bark,
      c.x + 0.04, c.y + Math.cos(a) * rr, c.z + Math.sin(a) * rr,
      c.x - 0.14 - rng() * 0.16, c.y + Math.cos(a) * rr * 1.1, c.z + Math.sin(a) * rr * 1.1,
      0.014, 0.003, 3);
  }
  // recessed pale heartwood disc
  const core = new THREE.CircleGeometry(LOG.r0 * 0.76, 10);
  push(parts.inner, core, matrixFor(c.x + 0.04, c.y, c.z, 0, -Math.PI / 2, 0));
}

/** Snapped-off branch stumps: 2-3 sticking up/out of the trunk. */
function addBranchStumps(parts, rng, count) {
  const specs = [
    { t: 0.62, a: Math.PI * 0.52, up: 0.72 },
    { t: 0.4, a: Math.PI * 0.2, up: 0.42 },
    { t: 0.5, a: -Math.PI * 0.42, up: 0.3 },
  ];
  for (let i = 0; i < count; i++) {
    const spec = specs[i % specs.length];
    const t = spec.t + (rng() - 0.5) * 0.06;
    const p = logSurface(t, spec.a);
    const out = 0.14 + rng() * 0.16;
    const tipX = p.x + p.dx * out;
    const tipY = p.y + spec.up * (0.8 + rng() * 0.4);
    const tipZ = p.z + p.dz * out;
    // a knee halfway up so the stump is not a straight stick
    rod(parts.bark, p.x, p.y, p.z, (p.x + tipX) / 2 + 0.03, (p.y + tipY) / 2, (p.z + tipZ) / 2, 0.075, 0.05, 5);
    rod(parts.bark, (p.x + tipX) / 2 + 0.03, (p.y + tipY) / 2, (p.z + tipZ) / 2, tipX, tipY, tipZ, 0.05, 0.028, 5);
    // snapped splinter teeth at the stump end
    for (let s = 0; s < 4; s++) {
      const sa = (s / 4) * TAU + rng() * 0.5;
      rod(parts.bark,
        tipX, tipY - 0.01, tipZ,
        tipX + Math.cos(sa) * 0.035, tipY + 0.05 + rng() * 0.07, tipZ + Math.sin(sa) * 0.035,
        0.016, 0.002, 3);
    }
  }
}

/**
 * Wet moss carpet. The first pass pressed six 0.4-0.8 m green plates onto the trunk,
 * which read as flat boards with lifted rims; this version builds the carpet from
 * THREE layers of small pads (0.15-0.35 m) oriented along the trunk's surface frame,
 * so every pad follows the cylinder curvature 鈥?plus leafy epiphytes and a low
 * ground-cover card layer ('cover' cell of lib.grassBlade paints moss + round leaves).
 */
function addMoss(parts, rng, count, qs) {
  // --- layer 1: broad flattened pads hugging the top of the bole
  for (let i = 0; i < count; i++) {
    const t = 0.05 + (i / count) * 0.88 + rng() * 0.03;
    const a = Math.PI / 2 + (rng() - 0.5) * 1.4; // upper half of the log
    const p = logSurface(t, a);
    const r = 0.085 + rng() * 0.06;
    const blob = rockGeo(r, { detail: 0, seed: 60 + i * 7, flatten: 0.4 });
    blob.scale(1.35 + rng() * 0.4, 0.5, 1.0 + rng() * 0.3);
    blob.computeVertexNormals();
    // local +Y (the flatten axis) follows the surface normal -> the pad lies ON the bark
    push(parts.moss, blob, discMatrix(p, rng() * TAU, 0.012));
  }
  // --- layer 2: smaller pads offset around the first ones (breaks the outline)
  const n2 = Math.max(6, Math.round(18 * qs));
  for (let i = 0; i < n2; i++) {
    const t = 0.08 + rng() * 0.84;
    const a = Math.PI / 2 + (rng() - 0.5) * 2.4;
    const p = logSurface(t, a);
    const r = 0.06 + rng() * 0.045;
    const blob = rockGeo(r, { detail: 0, seed: 310 + i * 11, flatten: 0.55 });
    blob.scale(1.2 + rng() * 0.3, 0.7, 1.0 + rng() * 0.25);
    blob.computeVertexNormals();
    push(parts.moss, blob, discMatrix(p, rng() * TAU, 0.01));
  }
  // --- layer 3: 'cover' ground-cover cards lying on the bark (moss + round leaves)
  const n3 = Math.max(6, Math.round(16 * qs));
  for (let i = 0; i < n3; i++) {
    const t = 0.06 + rng() * 0.88;
    const a = Math.PI / 2 + (rng() - 0.5) * 1.9;
    const p = logSurface(t, a);
    push(parts.grass, grassQuad(0.2 + rng() * 0.12, 0.16 + rng() * 0.1, 'cover', {
      bend: 0.01 + rng() * 0.015,
    }), surfaceMatrix(p, rng() * TAU, 0.008));
  }
  // --- layer 4: leafy moss tufts / epiphytes sprouting out of the carpet
  const n4 = Math.max(8, Math.round(26 * qs));
  for (let i = 0; i < n4; i++) {
    const t = 0.05 + rng() * 0.9;
    const a = Math.PI / 2 + (rng() - 0.5) * 2.2;
    const p = logSurface(t, a);
    push(parts.leafDark, leafCard(0.13 + rng() * 0.1, 0.24 + rng() * 0.08, 'broad', {
      th0: 0.4 + rng() * 0.7, k: 1.2, segs: 2, cols: 2, roll: (rng() - 0.5) * 1.2,
      fold: 0.18,
    }), matrixFor(p.x, p.y, p.z, 0, rng() * TAU, 0));
  }
  // --- canopy twig cards as larger epiphytes (2 tris each): a few ferns/broadleaf
  //     sprouts hanging on the damp side of the trunk
  const n5 = Math.max(4, Math.round(14 * qs));
  for (let i = 0; i < n5; i++) {
    const t = 0.16 + rng() * 0.66;
    const a = Math.PI / 2 + (rng() - 0.5) * 1.5;
    const p = logSurface(t, a);
    const size = 0.24 + rng() * 0.14;
    push(rng() < 0.35 ? parts.canopy : parts.canopyDark, canopyQuad(size, size * (0.8 + rng() * 0.3), rng() < 0.5 ? 'sprig' : 'spray', {
      cols: 1, rows: 1, bend: 0.02 + rng() * 0.03, droop: 0.02 + rng() * 0.02,
    }), surfaceMatrix(p, rng() * TAU, 0.03));
  }
  // --- a few real fern/broadleaf epiphytes growing out of the moss (dark tints keep
  //     them from reading as pale yellow cards against the bark)
  for (let i = 0; i < 5; i++) {
    const t = 0.2 + rng() * 0.55;
    const a = Math.PI / 2 + (rng() - 0.5) * 1.2;
    const p = logSurface(t, a);
    push(i % 3 === 2 ? parts.leaf : parts.leafDark, leafCard(0.28 + rng() * 0.14, 0.46 + rng() * 0.1, 'broad', {
      th0: 0.55 + rng() * 0.4, k: 1.25, segs: 3, cols: 3, roll: (rng() - 0.5) * 0.8, fold: 0.2,
    }), matrixFor(p.x, p.y, p.z, 0, rng() * TAU, 0));
  }
}

/** Shelf fungi on the damp side: TWO tight clumps, sizes/angles random (an even row of
 *  identical caps was the first pass's "row of eggs"). */
function addFungi(parts, rng, count) {
  const clumps = [
    { t: 0.2, a: -0.62, n: 3 },
    { t: 0.52, a: 0.34, n: 2 },
  ];
  let idx = 0;
  for (const clump of clumps) {
    for (let k = 0; k < clump.n && idx < count; k++, idx++) {
      const t = clump.t + (rng() - 0.5) * 0.06;
      const a = clump.a + (rng() - 0.5) * 0.34;
      const p = logSurface(t, a);
      const stemLen = 0.025 + rng() * 0.03;
      const sx = p.x + p.dx * stemLen;
      const sy = p.y + p.dy * stemLen;
      const sz = p.z + p.dz * stemLen;
      rod(parts.fungus, p.x, p.y, p.z, sx, sy, sz, 0.011, 0.006, 4);
      // cap size varies a lot inside a clump: one big shelf + smaller ones around it
      const capR = 0.026 + rng() * 0.03 + (k === 0 ? 0.012 : 0);
      const cap = latheGeo([[0, 0], [capR, 0.006], [capR * 0.78, 0.026 + capR * 0.2], [0, 0.03 + capR * 0.3]], { segments: 7, tile: 0.5 });
      _a.set(p.dx, p.dy + 0.35 + rng() * 0.3, p.dz).normalize();
      _q.setFromUnitVectors(UP, _a);
      _mid.set(sx, sy, sz);
      push(parts.fungus, cap, new THREE.Matrix4().compose(_mid, _q, ONE));
    }
  }
}

/** A woody vine creeping over one section of the log, with a few leaves. */
function addVine(parts, rng) {
  const STEPS = 18;
  const t0 = 0.32;
  const t1 = 0.76;
  let prev = null;
  for (let s = 0; s <= STEPS; s++) {
    const t = t0 + (t1 - t0) * (s / STEPS);
    const a = Math.PI * 0.35 + t * 9.2;
    const p = logSurface(t, a);
    const r = p.r + 0.02;
    const c = logCenter(t);
    const cur = { x: c.x + p.dx * r, y: c.y + p.dy * r, z: c.z + p.dz * r };
    if (prev) rod(parts.wood, prev.x, prev.y, prev.z, cur.x, cur.y, cur.z, 0.022, 0.024, 3);
    if (s % 5 === 2) {
      push(parts.leaf, leafCard(0.16, 0.26, 'vine', { th0: 0.6, k: 1.1, segs: 2, cols: 2, roll: rng() * 0.8 }),
        matrixFor(cur.x, cur.y + 0.02, cur.z, 0, a + 0.6 + rng(), 0));
    }
    prev = cur;
  }
}

/** Rotten leaf litter / soil banked up against the log on the ground. */
function addGround(parts, rng) {
  const mound = sphereGeo(0.9, { segW: 10, segH: 6, tile: 1.4 });
  mound.scale(1.05, 0.045, 0.45);
  mound.computeVertexNormals();
  // planar world-XZ UVs: the sphere UVs smeared the leaf-litter map into stripes
  push(parts.mud, planarUV(mound, 1.2), matrixFor(0.15, 0.006, 0.03, 0, 0.3, 0));
  // flat brown dead leaves sunk into the litter (never floating paper)
  for (let i = 0; i < 14; i++) {
    const x = -1.9 + rng() * 3.8;
    const z = (rng() - 0.5) * 1.1;
    push(parts.litter, deadLeafGeo(0.16 + rng() * 0.14, 0.075 + rng() * 0.05),
      matrixFor(x, 0.005 + rng() * 0.006, z, 0, rng() * TAU, 0));
  }
  // a couple of loose stones pressed into the litter
  for (let i = 0; i < 3; i++) {
    const r = 0.09 + rng() * 0.07;
    push(parts.moss, rockGeo(r, { detail: 0, seed: 120 + i, flatten: 0.55 }),
      matrixFor(-1.5 + rng() * 3.2, r * 0.72, (rng() - 0.5) * 1.1, (rng() - 0.5) * 0.5, rng() * TAU, (rng() - 0.5) * 0.5));
  }
  // ground-cover tufts along the foot of the log (ties it into the forest floor)
  for (let i = 0; i < 5; i++) {
    const x = -1.7 + rng() * 3.4;
    const z = (rng() - 0.5) * 1.3;
    push(parts.grass, grassQuad(0.26 + rng() * 0.14, 0.18 + rng() * 0.1, i === 0 ? 'cover' : 'tuft', {
      bend: 0.02 + rng() * 0.02, lean: (rng() - 0.5) * 0.04,
    }), matrixFor(x, -0.02, z, 0, rng() * TAU, 0));
  }
}

// ---------------------------------------------------------------------------
// family builder
// ---------------------------------------------------------------------------

function fallenLogGeometry(hi, rng, qs) {
  const parts = {
    bark: [], wood: [], inner: [], moss: [], leaf: [], leafDark: [], canopy: [], canopyDark: [],
    grass: [], fungus: [], mud: [], litter: [],
  };
  push(parts.bark, logBodyGeometry(), new THREE.Matrix4());
  addBarkRidges(parts, rng);
  addBrokenEnd(parts, rng);
  addRootPlate(parts, rng);
  addBranchStumps(parts, rng, hi ? 3 : 2);
  addMoss(parts, rng, hi ? 16 : 9, qs);
  addFungi(parts, rng, hi ? 5 : 4);
  addVine(parts, rng);
  addGround(parts, rng);
  return {
    // barkTrop / barkMoss / mossStone / mud / leafLitter are vertex-colour
    // materials: bake a height AO attribute into each merged batch.
    bark: bakeVertexAO(merge(parts.bark), { ground: 1.0, floor: 0.74, noise: 0.06, seed: 47 }),
    wood: bakeVertexAO(merge(parts.wood), { ground: 1.3, floor: 0.6, noise: 0.08, seed: 49 }),
    inner: merge(parts.inner),
    moss: bakeVertexAO(merge(parts.moss), { ground: 0.9, floor: 0.62, noise: 0.1, seed: 53 }),
    leaf: merge(parts.leaf),
    leafDark: merge(parts.leafDark),
    canopy: merge(parts.canopy),
    canopyDark: merge(parts.canopyDark),
    grass: merge(parts.grass),
    fungus: merge(parts.fungus),
    mud: bakeVertexAO(merge(parts.mud), { ground: 0.8, floor: 0.55, noise: 0.1, seed: 59 }),
    litter: bakeVertexAO(merge(parts.litter), { ground: 0.6, floor: 0.6, noise: 0.08, seed: 61 }),
  };
}

function buildFallenLogs(ctx, preview) {
  const items = (island(ctx).fallenLogs || []).map((p) => ({
    x: p.x, z: p.z, y: p.y ?? 0, ry: p.ry ?? 0, rx: p.rx ?? 0, rz: p.rz ?? 0, s: p.s ?? 1,
  }));
  if (!items.length) return;
  const M = ctx.materials;
  const hi = preview || ctx.stage === true;
  const qs = cardScale(ctx);
  const rng = makeRNG(5231);
  const geo = fallenLogGeometry(hi, rng, qs);
  const opts = { seed: 711, castShadow: true };
  makeInstanced(ctx, geo.bark, M.barkTrop, items, 'fallen-log-bole', 'wood', opts);
  makeInstanced(ctx, geo.wood, M.barkMoss, items, 'fallen-log-roots', 'wood', opts);
  makeInstanced(ctx, geo.inner, M.woodDark, items, 'fallen-log-broken-core', 'wood', opts);
  makeInstanced(ctx, geo.moss, M.mossStone, items, 'fallen-log-moss', 'stone', opts);
  makeInstanced(ctx, geo.leaf, M.broadleaf, items, 'fallen-log-epiphytes', 'fabric', opts);
  makeInstanced(ctx, geo.leafDark, M.broadleafDark, items, 'fallen-log-moss-tufts', 'fabric', opts);
  makeInstanced(ctx, geo.canopy, M.canopy, items, 'fallen-log-epiphyte-clumps', 'fabric', opts);
  makeInstanced(ctx, geo.canopyDark, M.canopyDark, items, 'fallen-log-epiphyte-shade', 'fabric', opts);
  makeInstanced(ctx, geo.grass, M.grassBlade, items, 'fallen-log-moss-cover', 'fabric', opts);
  makeInstanced(ctx, geo.fungus, M.bamboo, items, 'fallen-log-fungi', 'wood', opts);
  makeInstanced(ctx, geo.mud, M.mud, items, 'fallen-log-soil', 'sand', opts);
  makeInstanced(ctx, geo.litter, M.leafLitter, items, 'fallen-log-litter', 'sand', opts);
}
