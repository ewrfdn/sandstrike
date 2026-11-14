/**
 * FERN CLUMP 鈥?F4 (see ISLAND_ASSETS.md 搂2.1).
 *
 * A wet understory fern patch: a dense ground rosette of pinnate fronds (atlas 'fern'),
 * one small tree fern with a hairy/scaly thin trunk and a full crown of larger fronds,
 * curled fiddleheads, broadleaf weeds pushing up between the fronds and a `lib.canopy`
 * understory layer so the clump has depth instead of reading as a flat star of cards.
 *
 * Rules honoured here: metres, +Y up, front is -Z, base sits a couple of cm into the
 * soil; every card samples the shared atlases via `leafCellUV()` / `canopyQuad()`;
 * all randomness comes from one fixed-seed `makeRNG()`; the stage build is one hero
 * clump, the map build reads `layout.island.fernClumps`.
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
import { cylGeo, sphereGeo } from '../detail.js';
import { leafCellUV, canopyQuad, grassQuad } from './leaf-atlas.js';

export const meta = { id: 'fern-clump', kind: 'world', group: 'flora', label: '钑ㄧ被涓?路 FERN CLUMP' };

/** Preview builder (stage/WebUI): one-item sample layout + hero clump. */
export function build(ctx) {
  island(ctx).fernClumps = [{ x: 0, z: 0, ry: 0.55, s: 1 }];
  buildFernClumps(ctx, true);
}

/** Map assembly builder: instantiates every clump from ctx.data.layout. */
export function buildWorld(ctx) {
  buildFernClumps(ctx, false);
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
const ZAXIS = new THREE.Vector3(0, 0, 1);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _mid = new THREE.Vector3();
const _pos = new THREE.Vector3();

function push(list, geo, matrix) {
  list.push(transformed(geo, matrix));
  geo.dispose();
}

function merge(list) {
  const merged = mergeGeometries(list);
  for (const g of list) g.dispose();
  return merged;
}

/** Tapered open cylinder between two points (frond rachis, trunk, crozier). */
function rod(list, ax, ay, az, bx, by, bz, r0, r1 = r0, radial = 4) {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  _dir.subVectors(_b, _a);
  const len = _dir.length();
  if (len < 1e-4) return;
  _dir.multiplyScalar(1 / len);
  _q.setFromUnitVectors(UP, _dir);
  _mid.copy(_a).add(_b).multiplyScalar(0.5);
  push(list, cylGeo(r1, r0, len, { radial, tile: 1.1, open: true }), new THREE.Matrix4().compose(_mid, _q, ONE));
}

/**
 * Arched alpha leaf card (same contract as the banana leaves): base at the local
 * origin, +X out along the blade, +Y up, blade width along +Z. `th0` is the
 * departure elevation and `k` the total bend of the midrib arc.
 */
function leafCard(len, width, cell, {
  th0 = 0.8, k = 1.2, segs = 5, cols = 3, roll = 0, fold = 0.12, baseW = 0.3, tipW = 0.45,
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
    const taper = t <= 0.84 ? 1 : 1 - (1 - tipW) * ((t - 0.84) / 0.16);
    const halfW = width * 0.5 * (baseW + (1 - baseW) * ramp) * taper;
    for (let j = 0; j < cols; j++) {
      const u = cols > 1 ? j / (cols - 1) - 0.5 : 0;
      const lat = halfW * 2 * u;
      // cross-section curvature: the frond is a shallow V along the rachis, which is
      // what keeps it from reading as a flat plate under a moving sun
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

/** Matrix that turns a +Z-facing card so it faces `n` (with optional roll about n). */
function cardMatrix(x, y, z, nx, ny, nz, roll = 0) {
  _n.set(nx, ny, nz);
  if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0);
  _n.normalize();
  _q.setFromUnitVectors(ZAXIS, _n);
  if (roll) _q.multiply(_q2.setFromAxisAngle(ZAXIS, roll));
  _pos.set(x, y, z);
  return new THREE.Matrix4().compose(_pos, _q, ONE);
}

/** A `lib.canopy` twig card facing `n` (2 triangles, 6-18 painted leaves). */
function canopyAt(list, rng, x, y, z, n, size, { cell = 'sprig', dark = false, pale = false } = {}) {
  const w = size * (0.85 + rng() * 0.3);
  const h = size * (0.78 + rng() * 0.3);
  push(list, canopyQuad(w, h, cell, {
    cols: 1, rows: 1, bend: 0.02 + rng() * 0.04, droop: 0.015 + rng() * 0.03, twist: (rng() - 0.5) * 0.05,
  }), cardMatrix(x, y, z, n[0], n[1], n[2], (rng() - 0.5) * 2.2));
  return dark || pale;
}

/** Re-map a wrapped geometry to planar world XZ UVs (mud no longer reads as stripes). */
function planarUV(geo, tile = 1.2) {
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

/** A frond: arched 'fern' card plus its thin geometric rachis. */
function addFrond(parts, rng, x, y, z, yaw, {
  len, width, th0, k, dark = false, roll = (rng() - 0.5) * 0.5, segs = 5, cols = 4,
  rachis = true, fold = 0.2,
}) {
  push(dark ? parts.leafDark : parts.leaf, leafCard(len, width, 'fern', {
    th0, k, roll, segs, cols, fold, baseW: 0.5, tipW: 0.4,
  }), matrixFor(x, y, z, 0, yaw, 0));
  if (!rachis) return;
  // rachis: two slim segments under the frond centre line
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const sag = len / k;
  for (let s = 0; s < 2; s++) {
    const t0 = s * 0.5;
    const t1 = (s + 1) * 0.5;
    const a0 = th0 - k * t0;
    const a1 = th0 - k * t1;
    const r0 = sag * (Math.sin(th0) - Math.sin(a0));
    const r1 = sag * (Math.sin(th0) - Math.sin(a1));
    const h0 = sag * (Math.cos(a0) - Math.cos(th0));
    const h1 = sag * (Math.cos(a1) - Math.cos(th0));
    rod(parts.wood,
      x + ca * r0, y + h0, z - sa * r0,
      x + ca * r1, y + h1, z - sa * r1,
      0.01 - s * 0.004, 0.006 - s * 0.003, 3);
  }
}

/** The rosette of ground fronds fanning out of the clump centre. */
function addRosette(parts, rng, count, mul, qs) {
  const n = Math.max(4, Math.round(count * qs));
  for (let i = 0; i < n; i++) {
    const p = n > 1 ? i / (n - 1) : 0; // 0 = outer flat, 1 = centre upright
    const yaw = (i / n) * TAU * 1.03 + (rng() - 0.5) * 0.4 + 0.2;
    const th0 = 0.5 + 0.6 * p + (rng() - 0.5) * 0.16;
    const k = 1.05 + 0.45 * p + (rng() - 0.5) * 0.14;
    // smaller cards packed denser: large sparsely-placed fronds read as stacked plates
    const len = (0.58 + 0.44 * (1 - p) + rng() * 0.12) * mul * 0.76;
    // the atlas 'fern' cell paints the pinnate frond inside a ~55% tall band
    const width = (0.59 + 0.06 * p) * (0.9 + rng() * 0.2);
    const y = 0.09 + 0.05 * p;
    // the painted frond already carries a rachis, so only the outer fronds get a
    // geometric one (silhouette read); this is what frees the triangle budget for
    // the extra fronds + the understory layer.
    addFrond(parts, rng, Math.cos(yaw) * 0.06, y, -Math.sin(yaw) * 0.06, yaw, {
      len, width, th0, k, dark: p < 0.14 && i % 2 === 0, segs: 4, cols: 4,
      rachis: i % 3 === 0, fold: 0.22,
    });
  }
  // inner ring of young upright fronds: the lush "crown" of the rosette
  const inner = Math.max(3, Math.round(count * 0.34 * qs));
  for (let i = 0; i < inner; i++) {
    const yaw = (i / inner) * TAU + rng() * 0.5;
    addFrond(parts, rng, Math.cos(yaw) * 0.05, 0.15, -Math.sin(yaw) * 0.05, yaw, {
      len: (0.32 + rng() * 0.16) * mul * 0.7,
      width: 0.38,
      th0: 1.0 + rng() * 0.25,
      k: 0.8 + rng() * 0.24,
      dark: i % 4 === 0,
      segs: 3,
      cols: 3,
      rachis: false,
      fold: 0.24,
    });
  }
  // a low ring of small "filler" fronds right at the soil line, so the rosette has a
  // soft edge instead of a visible row of card bases. Kept shallow-arched: a steeply
  // drooping card rooted at ground level would punch 15 cm below the soil plane.
  const skirt = Math.max(4, Math.round(10 * qs));
  for (let i = 0; i < skirt; i++) {
    const yaw = (i / skirt) * TAU + rng() * 0.6;
    addFrond(parts, rng, Math.cos(yaw) * 0.1, 0.15, -Math.sin(yaw) * 0.1, yaw, {
      len: 0.26 + rng() * 0.13,
      width: 0.3 + rng() * 0.08,
      th0: 0.34 + rng() * 0.24,
      k: 0.85 + rng() * 0.3,
      segs: 2,
      cols: 3,
      rachis: false,
      dark: i % 3 === 0,
      fold: 0.2,
    });
  }
}

/** Understory mix between the fronds: canopy twig cards + low grass cover. */
function addUnderstory(parts, rng, qs) {
  const n = Math.max(6, Math.round(40 * qs));
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU;
    const rr = 0.12 + rng() * 0.62;
    const y = 0.12 + rng() * 0.42;
    const nrm = [Math.cos(a) * 0.7, 0.7 + rng() * 0.7, -Math.sin(a) * 0.7];
    canopyAt(rng() < 0.34 ? parts.canopyDark : parts.canopy, rng, Math.cos(a) * rr, y, -Math.sin(a) * rr, nrm,
      0.2 + rng() * 0.16, { cell: rng() < 0.6 ? 'spray' : 'sprig' });
  }
  // young pale flush: a few bright cards in the middle of the rosette
  const np = Math.max(2, Math.round(8 * qs));
  for (let i = 0; i < np; i++) {
    const a = rng() * TAU;
    const rr = rng() * 0.2;
    canopyAt(parts.canopyPale, rng, Math.cos(a) * rr, 0.22 + rng() * 0.16, -Math.sin(a) * rr,
      [Math.cos(a) * 0.4, 1.2, -Math.sin(a) * 0.4], 0.16 + rng() * 0.1, { cell: 'pale', pale: true });
  }
  // low ground cover at the foot of the clump
  const ng = Math.max(3, Math.round(7 * qs));
  for (let i = 0; i < ng; i++) {
    const a = (i / ng) * TAU + rng() * 0.9;
    const rr = 0.24 + rng() * 0.36;
    push(parts.grass, grassQuad(0.3 + rng() * 0.14, 0.2 + rng() * 0.12, i === 0 ? 'cover' : 'tuft', {
      bend: 0.02 + rng() * 0.02, lean: (rng() - 0.5) * 0.04,
    }), matrixFor(Math.cos(a) * rr, -0.02, Math.sin(a) * rr, 0, rng() * TAU, 0));
  }
}

/** Small tree fern: fibrous thin trunk + a crown of larger fronds. */
function addTreeFern(parts, rng, x, z, yaw, hi, qs) {
  const h = 1.16;
  const lean = 0.12;
  const trunk = 4;
  const px = (t) => x + Math.cos(yaw) * lean * t * t;
  const pz = (t) => z - Math.sin(yaw) * lean * t * t;
  const py = (t) => -0.03 + h * t;
  for (let i = 0; i < trunk; i++) {
    const t0 = i / trunk;
    const t1 = (i + 1) / trunk;
    const r0 = 0.058 - 0.016 * t0;
    const r1 = 0.058 - 0.016 * t1;
    rod(parts.wood, px(t0), py(t0), pz(t0), px(t1), py(t1), pz(t1), r0, r1, 6);
    // fibrous root mantle: short spikes flaring down and out of the trunk (the hairy
    // stem that makes a tree fern read as a tree fern, not a palm)
    for (let s = 0; s < 3; s++) {
      const a = rng() * TAU;
      const yy = Math.max(0.1, py(t0) + 0.04 + rng() * (h / trunk - 0.02));
      const rr = r0 + 0.005;
      const l = 0.05 + rng() * 0.09;
      rod(parts.wood,
        px(t0) + Math.cos(a) * rr, yy, pz(t0) + Math.sin(a) * rr,
        px(t0) + Math.cos(a) * (rr + l * 0.8), Math.max(0.03, yy - l * 0.75), pz(t0) + Math.sin(a) * (rr + l * 0.8),
        0.011, 0.0015, 3);
    }
  }
  // crown knot where the fronds burst out
  const knot = sphereGeo(0.07, { segW: 6, segH: 4, tile: 1.0 });
  knot.scale(1.4, 0.62, 1.4);
  push(parts.wood, knot, matrixFor(px(1), py(1), pz(1), 0, yaw, 0));
  // crown fronds: a full fountain, longer and flatter than a palm's
  const crown = Math.max(6, Math.round((hi ? 16 : 10) * qs));
  for (let i = 0; i < crown; i++) {
    const a = (i / crown) * TAU + (rng() - 0.5) * 0.35 + yaw * 0.2;
    const young = 1 - Math.abs((i % 3) - 1) / 3;
    const th0 = 0.35 + 0.62 * young + (rng() - 0.5) * 0.16;
    const k = 1.25 + 0.5 * (1 - young) + (rng() - 0.5) * 0.14;
    addFrond(parts, rng, px(1) + Math.cos(a) * 0.05, py(1) + 0.05, pz(1) - Math.sin(a) * 0.05, a, {
      len: (0.64 + 0.22 * young + rng() * 0.12) * 0.86,
      width: (0.7 + rng() * 0.1) * 0.8,
      th0,
      k,
      dark: i % 5 === 0,
      segs: 4,
      cols: 4,
      rachis: i % 2 === 0,
      fold: 0.22,
    });
  }
  // a crozier still unrolling in the middle of the crown
  const crozier = 4;
  let cp = null;
  for (let s = 0; s <= crozier; s++) {
    const t = s / crozier;
    const ang = t * 3.0;
    const cur = {
      x: px(1) + 0.13 + Math.sin(ang) * 0.06 * (1 - t * 0.4),
      y: py(1) + 0.18 + t * 0.12,
      z: pz(1) + 0.04 + Math.cos(ang) * 0.04,
    };
    if (cp) rod(parts.wood, cp.x, cp.y, cp.z, cur.x, cur.y, cur.z, 0.016 - t * 0.01, 0.018 - t * 0.012, 3);
    cp = cur;
  }
}

/** Curled fiddleheads: a tapering spiral of short rods. */
function addFiddlehead(parts, rng, x, z, yaw, h, size) {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const STEPS = 6;
  let prev = null;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const ang = t * 3.6;
    const rad = size * (1 - t * 0.82);
    const px = ca * (rad * Math.sin(ang) * 0.85);
    const pz = -sa * (rad * Math.sin(ang) * 0.85);
    const py = h * t + size * (1 - Math.cos(ang)) * 0.35;
    const cur = { x: x + px, y: py, z: z + pz };
    if (prev) {
      // solid tapered rods: they belong to the bark material, not the alpha cards
      rod(parts.wood, prev.x, prev.y, prev.z, cur.x, cur.y, cur.z, 0.026 - t * 0.015, 0.03 - t * 0.019, 3);
    }
    prev = cur;
  }
}

/** Broadleaf weeds / saplings poking through the fern patch. */
function addWeeds(parts, rng, mul, qs) {
  const n = Math.max(2, Math.round(7 * qs));
  for (let i = 0; i < n; i++) {
    const yaw = rng() * TAU;
    const rr = 0.16 + rng() * 0.5;
    const x = Math.cos(yaw) * rr;
    const z = Math.sin(yaw) * rr;
    const hh = 0.3 + rng() * 0.28;
    rod(parts.wood, x, 0.02, z, x + Math.cos(yaw) * 0.08, hh, z - Math.sin(yaw) * 0.08, 0.012, 0.007, 3);
    for (let j = 0; j < 2; j++) {
      const a = yaw + j * 2.4 + rng() * 0.4;
      push(parts.leaf, leafCard(0.24 * mul, 0.28 * mul, 'broad', {
        th0: 0.75 + j * 0.2, k: 1.3, roll: (rng() - 0.5) * 0.6, segs: 2, cols: 2, fold: 0.16,
      }), matrixFor(x + Math.cos(yaw) * 0.08, hh, z - Math.sin(yaw) * 0.08, 0, a, 0));
    }
  }
}

/** Wet soil mound + rotting leaf-litter plates under the rosette. */
function addGroundMound(parts, rng) {
  const mound = sphereGeo(0.5, { segW: 10, segH: 6, tile: 1.2 });
  mound.scale(1, 0.065, 1);
  mound.computeVertexNormals();
  push(parts.mud, planarUV(mound, 1.1), matrixFor(0, 0.005, 0, 0, 0.6, 0));
  for (let i = 0; i < 6; i++) {
    const a = rng() * TAU;
    const rr = 0.22 + rng() * 0.52;
    const geo = new THREE.PlaneGeometry(0.1 + rng() * 0.1, 0.055 + rng() * 0.04);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let v = 0; v < pos.count; v++) uv.setXY(v, (pos.getX(v) + 0.1) / 1.1, (pos.getY(v) + 0.05) / 1.1);
    push(parts.litter, geo, matrixFor(Math.cos(a) * rr, 0.006 + rng() * 0.005, Math.sin(a) * rr, -1.53, rng() * TAU, 0));
  }
}

// ---------------------------------------------------------------------------
// family builder
// ---------------------------------------------------------------------------

function fernClumpGeometry(hi, rng, qs) {
  const parts = {
    wood: [], leaf: [], leafDark: [], canopy: [], canopyDark: [], canopyPale: [], grass: [], mud: [], litter: [],
  };
  addGroundMound(parts, rng);
  addRosette(parts, rng, hi ? 36 : 20, hi ? 1 : 0.9, qs);
  addUnderstory(parts, rng, qs);
  addTreeFern(parts, rng, 0.22, -0.16, 4.1, hi, qs);
  addFiddlehead(parts, rng, -0.26, 0.3, 0.7, 0.42, 0.18);
  addFiddlehead(parts, rng, 0.34, 0.22, 3.9, 0.32, 0.14);
  if (qs > 0.45) addFiddlehead(parts, rng, 0.02, -0.36, 2.1, 0.38, 0.16);
  addWeeds(parts, rng, hi ? 1 : 0.9, qs);
  return {
    // barkMoss is a vertex-colour material: bake a height AO attribute into it.
    wood: bakeVertexAO(merge(parts.wood), { ground: 1.3, floor: 0.55, noise: 0.08, seed: 13 }),
    leaf: merge(parts.leaf),
    leafDark: merge(parts.leafDark),
    canopy: merge(parts.canopy),
    canopyDark: merge(parts.canopyDark),
    canopyPale: merge(parts.canopyPale),
    grass: merge(parts.grass),
    mud: bakeVertexAO(merge(parts.mud), { ground: 0.8, floor: 0.58, noise: 0.1, seed: 17 }),
    litter: bakeVertexAO(merge(parts.litter), { ground: 0.6, floor: 0.6, noise: 0.08, seed: 19 }),
  };
}

function buildFernClumps(ctx, preview) {
  const items = (island(ctx).fernClumps || []).map((p) => ({
    x: p.x, z: p.z, y: p.y ?? 0, ry: p.ry ?? 0, rx: p.rx ?? 0, rz: p.rz ?? 0, s: p.s ?? 1,
  }));
  if (!items.length) return;
  const M = ctx.materials;
  const hi = preview || ctx.stage === true;
  const qs = cardScale(ctx);
  const rng = makeRNG(6123);
  const geo = fernClumpGeometry(hi, rng, qs);
  const opts = { seed: 421, castShadow: true };
  makeInstanced(ctx, geo.wood, M.barkMoss, items, 'fern-clump-treefern', 'wood', opts);
  makeInstanced(ctx, geo.leaf, M.broadleaf, items, 'fern-clump-fronds', 'fabric', opts);
  makeInstanced(ctx, geo.leafDark, M.broadleafDark, items, 'fern-clump-old-fronds', 'fabric', opts);
  makeInstanced(ctx, geo.canopy, M.canopy, items, 'fern-clump-understory', 'fabric', opts);
  makeInstanced(ctx, geo.canopyDark, M.canopyDark, items, 'fern-clump-shaded-understory', 'fabric', opts);
  makeInstanced(ctx, geo.canopyPale, M.canopyPale, items, 'fern-clump-young-flush', 'fabric', opts);
  makeInstanced(ctx, geo.grass, M.grassBlade, items, 'fern-clump-ground-cover', 'fabric', opts);
  makeInstanced(ctx, geo.mud, M.mud, items, 'fern-clump-mound', 'sand', opts);
  makeInstanced(ctx, geo.litter, M.leafLitter, items, 'fern-clump-litter', 'sand', opts);
}
