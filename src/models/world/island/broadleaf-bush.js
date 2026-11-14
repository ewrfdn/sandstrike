/**
 * BROADLEAF BUSH — F6 (see ISLAND_ASSETS.md §2.1).
 *
 * A wet understory broadleaf shrub. The first pass hung 0.5-0.8 m single-leaf cards in
 * rings, which read as "stacked plates"; this pass builds the crown the way a real shrub
 * grows (see gt-techniques §2.2):
 *
 *   - a woody skeleton: trunk, five leaning limbs and a fan of fine twigs that reach
 *     out to the crown envelope;
 *   - OUTER SHELL: `lib.canopy` sprig/spray cards sampled on the crown ellipsoid with a
 *     deterministic "sky window" (a share of the samples is skipped, so the silhouette
 *     is clumps + gaps instead of a solid ball), normals pointing out of the crown;
 *   - INNER LAYER: the same shell at 0.6 radius on `M.canopyDark` (the shaded mass that
 *     makes the bush read hollow-free without lighting up);
 *   - young pale flush on the crown top (`M.canopyPale`) and a few real single leaves on
 *     the silhouette so the bush still has readable individual leaves at 2 m;
 *   - dry brown leaves in the litter and a low ground-cover tuft at the foot.
 *
 * Rules honoured here: metres, +Y up, front is -Z, base sits on the soil; leaf cards
 * sample the shared atlases through `canopyQuad()` / `leafQuad()`; all randomness comes
 * from one fixed-seed `makeRNG()`; the stage build is one hero bush, the map build
 * reads `layout.island.bushes`.
 */
import * as THREE from 'three';
import {
  makeInstanced,
  matrixFor,
  transformed,
  mergeGeometries,
  bakeVertexAO,
  planeGeometry,
  TAU,
} from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { cylGeo, sphereGeo } from '../detail.js';
import { leafCellUV, canopyQuad, grassQuad } from './leaf-atlas.js';

export const meta = { id: 'broadleaf-bush', kind: 'world', group: 'flora', label: '阔叶灌木 · BROADLEAF BUSH' };

/** Preview builder (stage/WebUI): one-item sample layout + hero bush. */
export function build(ctx) {
  island(ctx).bushes = [{ x: 0, z: 0, ry: 0.22, s: 1 }];
  buildBroadleafBushes(ctx, true);
}

/** Map assembly builder: instantiates every bush from ctx.data.layout. */
export function buildWorld(ctx) {
  buildBroadleafBushes(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

// ---------------------------------------------------------------------------
// local geometry helpers (self-contained model file — see the bucket contract)
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

/** Tapered open cylinder between two points (twig / branch). */
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

/** Arched alpha leaf card (base at the origin, +X out, +Y up, width along +Z). */
function leafCard(len, width, cell, {
  th0 = 0.8, k = 1.0, segs = 3, cols = 3, roll = 0, fold = 0.14, baseW = 0.36, tipW = 0.42,
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

/** Small sunken ground-litter scrap: 2x2 bent quad with world-scale UVs. */
function litterCard(w, h, { tile = 1.3, bend = 0.02 } = {}) {
  const geo = new THREE.PlaneGeometry(w, h, 2, 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const hw = w * 0.5;
  const hh = h * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, bend * (1 - (x / hw) * (x / hw)) * (1 - (y / hh) * (y / hh)) - bend * 0.55);
    uv.setXY(i, (x + hw) / tile, (y + hh) / tile);
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Re-map a wrapped geometry to planar world XZ UVs (mud no longer reads as stripes). */
function planarUV(geo, tile = 1.3) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
  uv.needsUpdate = true;
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

/** Card-count multiplier per quality tier (topology stays identical). */
function cardScale(ctx) {
  const q = ctx.quality || 'high';
  if (q === 'lowest') return 0.6;
  if (q === 'low') return 0.75;
  return 1;
}

// crown envelope (metres): a squat dome that the leaf shell wraps around. The dome
// reaches down to 0.34 m so the bush reads as a low understory shrub, not a lollipop
// tree with a bare trunk.
const CROWN = { rx: 1.0, rz: 0.92, ry: 0.62, cy: 1.06, top: 1.62, bottom: 0.32 };

/** Outward ellipsoid normal at a crown-envelope point. */
function crownNormal(x, y, z) {
  return [x / (CROWN.rx * CROWN.rx), (y - CROWN.cy) / (CROWN.ry * CROWN.ry), z / (CROWN.rz * CROWN.rz)];
}

/** One canopy card facing `n` (a sprig/spray of 6-18 leaves). */
function canopyAt(list, rng, x, y, z, n, size, { cell = null, dark = false, pale = false, droop = 0.02, cols = 1 } = {}) {
  const w = size * (0.85 + rng() * 0.32);
  const h = size * (0.74 + rng() * 0.34);
  const c = cell || (rng() < 0.5 ? 'sprig' : 'spray');
  push(list, canopyQuad(w, h, c, {
    cols, rows: 1, bend: 0.02 + rng() * 0.04, droop: droop * (0.4 + rng()), twist: (rng() - 0.5) * 0.05,
  }), cardMatrix(x, y, z, n[0], n[1], n[2], (rng() - 0.5) * 2.0));
}

// ---------------------------------------------------------------------------
// bush builder
// ---------------------------------------------------------------------------

function broadleafBushGeometry(hi, rng, qs) {
  const parts = {
    wood: [], canopy: [], canopyDark: [], canopyPale: [], leaf: [], leafDark: [],
    dead: [], litter: [], grass: [],
  };

  // --- woody skeleton: short trunk, five leaning limbs, and fine twigs that fan out
  //     into the crown envelope (the leaf shell hangs on these, not in mid air).
  const trunkH = 0.46;
  rod(parts.wood, 0, -0.02, 0, 0.05, trunkH, -0.03, 0.055, 0.042, 5);
  const limbs = [];
  const LIMBS = 5;
  for (let l = 0; l < LIMBS; l++) {
    const yaw = (l / LIMBS) * TAU + 0.4 + (rng() - 0.5) * 0.3;
    const reach = 0.42 + rng() * 0.2;
    const rise = 0.72 + rng() * 0.34;
    const dx = Math.cos(yaw);
    const dz = -Math.sin(yaw);
    const mx = dx * reach * 0.45;
    const mz = dz * reach * 0.45;
    const my = trunkH + rise * 0.42;
    const ex = dx * reach;
    const ez = dz * reach;
    const ey = trunkH + rise;
    rod(parts.wood, 0.03, trunkH * 0.6, -0.02, mx, my, mz, 0.04, 0.028, 4);
    rod(parts.wood, mx, my, mz, ex, ey, ez, 0.028, 0.014, 4);
    limbs.push({ x: ex, y: ey, z: ez, yaw });
    // two side twigs from each limb, angled up and out (kept inside the leaf envelope
    // so no bare stick pokes out of the crown)
    for (let t = 0; t < 2; t++) {
      const f = 0.38 + t * 0.32;
      const sx = mx + (ex - mx) * f;
      const sy = my + (ey - my) * f;
      const sz = mz + (ez - mz) * f;
      const ta = yaw + (t ? 1.05 : -0.95) + (rng() - 0.5) * 0.4;
      const tr = 0.14 + rng() * 0.12;
      rod(parts.wood, sx, sy, sz,
        sx + Math.cos(ta) * tr, sy + 0.14 + rng() * 0.12, sz - Math.sin(ta) * tr,
        0.013, 0.006, 3);
    }
  }
  // a crown spur at the top so the dome has a centre
  rod(parts.wood, 0.03, trunkH * 0.9, -0.02, 0.06, CROWN.top - 0.12, 0.02, 0.024, 0.01, 3);

  // --- OUTER SHELL: golden-angle samples on the crown ellipsoid, with a deterministic
  //     "sky window" so the crown is clumps + gaps (gt-techniques §2.2 step 2). The cards
  //     are 2 quads across (cols=2) so the droop bends them instead of reading flat.
  const nOuter = Math.round((hi ? 230 : 128) * qs);
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < nOuter; i++) {
    const v = 1 - (i / Math.max(1, nOuter - 1)) * 1.72; // 1 .. -0.72
    const rho = Math.sqrt(Math.max(0, 1 - v * v));
    const a = i * GOLD + 0.7;
    // ~18% of the samples are dropped: the gaps read as daylight through the crown
    if (rng() < 0.18) continue;
    const x = Math.cos(a) * rho * CROWN.rx * (0.8 + rng() * 0.3);
    const z = -Math.sin(a) * rho * CROWN.rz * (0.8 + rng() * 0.3);
    const y = CROWN.cy + v * CROWN.ry * (0.86 + rng() * 0.24);
    if (y < CROWN.bottom || y > CROWN.top) continue;
    const n = crownNormal(x, y, z);
    n[1] += 0.28; // bias the card faces towards the sky so top light grazes them
    n[0] += (rng() - 0.5) * 0.3;
    n[2] += (rng() - 0.5) * 0.3;
    canopyAt(parts.canopy, rng, x, y, z, n, 0.4 + rng() * 0.2, { cols: 2 });
  }

  // --- MID SHELL: a half-radius-thick band between the outer cards and the shaded
  //     interior, so the crown has visible depth instead of one shell of cards.
  const nMid = Math.round((hi ? 96 : 52) * qs);
  for (let i = 0; i < nMid; i++) {
    const v = 1 - (i / Math.max(1, nMid - 1)) * 1.66;
    const rho = Math.sqrt(Math.max(0, 1 - v * v));
    const a = i * GOLD + 1.4;
    if (rng() < 0.16) continue;
    const x = Math.cos(a) * rho * CROWN.rx * 0.74;
    const z = -Math.sin(a) * rho * CROWN.rz * 0.74;
    const y = CROWN.cy + v * CROWN.ry * 0.78;
    const n = crownNormal(x, y, z);
    n[1] += 0.2;
    canopyAt(rng() < 0.35 ? parts.canopyDark : parts.canopy, rng, x, y, z, n, 0.34 + rng() * 0.18, {});
  }

  // --- INNER LAYER: same envelope at 0.5 radius, always on `canopyDark`. This is the
  //     shaded interior that stops the bush reading hollow from below without lighting
  //     up (it sits in the shadow of the outer shell).
  const nInner = Math.round((hi ? 118 : 64) * qs);
  for (let i = 0; i < nInner; i++) {
    const v = 1 - (i / Math.max(1, nInner - 1)) * 1.6;
    const rho = Math.sqrt(Math.max(0, 1 - v * v));
    const a = i * GOLD + 2.2;
    if (rng() < 0.12) continue;
    const x = Math.cos(a) * rho * CROWN.rx * 0.5;
    const z = -Math.sin(a) * rho * CROWN.rz * 0.5;
    const y = CROWN.cy + v * CROWN.ry * 0.52;
    const n = crownNormal(x, y, z);
    n[1] += 0.1;
    canopyAt(parts.canopyDark, rng, x, y, z, n, 0.32 + rng() * 0.16, { dark: true });
  }

  // --- young pale flush on the crown top (bright yellow-green growing tips)
  if (qs > 0.5) {
    const nPale = Math.round((hi ? 24 : 14) * qs);
    for (let i = 0; i < nPale; i++) {
      const a = rng() * TAU;
      const y = CROWN.top - 0.08 - rng() * 0.3;
      const v = (y - CROWN.cy) / CROWN.ry;
      const rho = Math.sqrt(Math.max(0, 1 - v * v)) * 0.68;
      const x = Math.cos(a) * rho * CROWN.rx;
      const z = Math.sin(a) * rho * CROWN.rz;
      canopyAt(parts.canopyPale, rng, x, y, z, [x * 0.8, 1.4 + rng() * 0.6, z * 0.8], 0.2 + rng() * 0.14, { pale: true, cell: 'pale' });
    }
  }

  // --- real single leaves on the silhouette: sampled ON the crown shell (the first
  //     version scattered them at a flat radius, so the high ones floated outside the
  //     dome as detached tan "butterflies"), plus a handful of old dark ones underneath
  const nLeaf = Math.round((hi ? 54 : 26) * qs);
  for (let i = 0; i < nLeaf; i++) {
    const a = rng() * TAU;
    const y = 0.42 + rng() * 1.02;
    const v = (y - CROWN.cy) / CROWN.ry;
    const rho = Math.sqrt(Math.max(0.05, 1 - v * v));
    const rr = rho * (0.72 + rng() * 0.3);
    const x = Math.cos(a) * rr * CROWN.rx;
    const z = -Math.sin(a) * rr * CROWN.rz;
    const dark = rng() < 0.16;
    push(dark ? parts.leafDark : parts.leaf, leafCard(0.2 + rng() * 0.1, 0.26 + rng() * 0.1, 'broad', {
      th0: 0.35 + rng() * 0.8, k: 1.0 + rng() * 0.5, roll: (rng() - 0.5) * 1.1, segs: 2, cols: 2, fold: 0.16,
    }), matrixFor(x, y, z, 0, a, 0));
  }
  // dead brown leaves caught in the inner bottom of the bush
  if (qs > 0.5) {
    for (let i = 0; i < 4; i++) {
      const a = rng() * TAU;
      const rr = 0.16 + rng() * 0.4;
      canopyAt(parts.canopyDark, rng, Math.cos(a) * rr, 0.24 + rng() * 0.2, -Math.sin(a) * rr,
        [0, 1, 0], 0.2 + rng() * 0.1, { cell: 'dry', dark: true });
    }
  }

  // --- dead leaves on the ground: small brown diamonds mostly tucked under the bush
  //     (big ones at the rim read as floating paper confetti)
  for (let i = 0; i < 5; i++) {
    const a = rng() * TAU;
    const rr = 0.1 + rng() * 0.3;
    push(parts.dead, deadLeafGeo(0.085 + rng() * 0.05, 0.045 + rng() * 0.03),
      matrixFor(Math.cos(a) * rr, 0.006 + rng() * 0.005, Math.sin(a) * rr, 0, rng() * TAU, 0));
  }

  // --- wet litter under the bush: planar-UV mound + small sunken scraps
  const mound = sphereGeo(0.5, { segW: 10, segH: 6, tile: 1.2 });
  mound.scale(1, 0.055, 1);
  mound.computeVertexNormals();
  push(parts.litter, planarUV(mound, 1.15), matrixFor(0, 0.005, 0, 0, 0.5, 0));
  for (let i = 0; i < 7; i++) {
    const a = rng() * TAU;
    const rr = 0.26 + rng() * 0.42;
    push(parts.litter, litterCard(0.1 + rng() * 0.1, 0.06 + rng() * 0.04, { tile: 1.1 }),
      matrixFor(Math.cos(a) * rr, 0.006 + rng() * 0.005, Math.sin(a) * rr, -1.53, rng() * TAU, 0));
  }

  // --- ground-cover tuft at the foot: ties the bush into the forest floor
  const nGrass = Math.round(4 * qs);
  for (let i = 0; i < nGrass; i++) {
    const a = (i / nGrass) * TAU + rng() * 0.8;
    const rr = 0.3 + rng() * 0.28;
    push(parts.grass, grassQuad(0.34 + rng() * 0.16, 0.24 + rng() * 0.14, i === 0 ? 'cover' : 'tuft', {
      bend: 0.02 + rng() * 0.02, lean: (rng() - 0.5) * 0.05,
    }), matrixFor(Math.cos(a) * rr, -0.02, Math.sin(a) * rr, 0, rng() * TAU, 0));
  }

  return {
    // barkTrop is a vertex-colour material: bake a height AO attribute for it
    wood: bakeVertexAO(merge(parts.wood), { ground: 1.7, floor: 0.55, noise: 0.08, seed: 37 }),
    canopy: merge(parts.canopy),
    canopyDark: merge(parts.canopyDark),
    canopyPale: merge(parts.canopyPale),
    leaf: merge(parts.leaf),
    leafDark: merge(parts.leafDark),
    // leafLitter is a vertex-colour material as well
    dead: bakeVertexAO(merge(parts.dead), { ground: 0.5, floor: 0.66, noise: 0.08, seed: 41 }),
    litter: bakeVertexAO(merge(parts.litter), { ground: 0.8, floor: 0.56, noise: 0.1, seed: 43 }),
    grass: merge(parts.grass),
  };
}

function buildBroadleafBushes(ctx, preview) {
  const items = (island(ctx).bushes || []).map((p) => ({
    x: p.x, z: p.z, y: p.y ?? 0, ry: p.ry ?? 0, rx: p.rx ?? 0, rz: p.rz ?? 0, s: p.s ?? 1,
  }));
  if (!items.length) return;
  const M = ctx.materials;
  const hi = preview || ctx.stage === true;
  const qs = cardScale(ctx);
  const rng = makeRNG(7717);
  const geo = broadleafBushGeometry(hi, rng, qs);
  const opts = { seed: 611, castShadow: true };
  makeInstanced(ctx, geo.wood, M.barkTrop, items, 'broadleaf-bush-twigs', 'wood', opts);
  makeInstanced(ctx, geo.canopy, M.canopy, items, 'broadleaf-bush-canopy', 'fabric', opts);
  makeInstanced(ctx, geo.canopyDark, M.canopyDark, items, 'broadleaf-bush-inner-canopy', 'fabric', opts);
  makeInstanced(ctx, geo.canopyPale, M.canopyPale, items, 'broadleaf-bush-young-flush', 'fabric', opts);
  makeInstanced(ctx, geo.leaf, M.broadleaf, items, 'broadleaf-bush-leaves', 'fabric', opts);
  makeInstanced(ctx, geo.leafDark, M.broadleafDark, items, 'broadleaf-bush-old-leaves', 'fabric', opts);
  makeInstanced(ctx, geo.dead, M.leafLitter, items, 'broadleaf-bush-dead-leaves', 'sand', opts);
  makeInstanced(ctx, geo.litter, M.leafLitter, items, 'broadleaf-bush-litter', 'sand', opts);
  makeInstanced(ctx, geo.grass, M.grassBlade, items, 'broadleaf-bush-ground-cover', 'fabric', opts);
}
