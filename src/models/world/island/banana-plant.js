/**
 * BANANA PLANT — F3 (see ISLAND_ASSETS.md §2.1).
 *
 * A clump of 3-5 banana pseudostems 1.5-2.6 m tall with big arched paddle leaves,
 * a hanging flower heart, a small green fruit bunch, old drooping leaves and a few
 * young suckers pushing through the leaf-litter mound.
 *
 * Rules honoured here:
 *  - metres, +Y up, front is -Z, authored base sits within a few cm of y = 0;
 *  - the leaf blades sample the shared leaf atlas through `leafCellUV()` (the
 *    'banana' cell), the painted texture supplies the tips, midvein and the torn
 *    wind-shredded edges — the geometry only supplies the arch;
 *  - all randomness comes from one fixed-seed `makeRNG()` (deterministic builds);
 *  - the stage build (`ctx.stage === true`) is one hero clump, the map build reads
 *    `layout.island.bananaPlants` and instances a slightly cheaper clump.
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
import { cylGeo, latheGeo, sphereGeo } from '../detail.js';
import { leafCellUV, canopyQuad } from './leaf-atlas.js';

export const meta = { id: 'banana-plant', kind: 'world', group: 'flora', label: '芭蕉丛 · BANANA PLANT' };

/** Preview builder (stage/WebUI): applies a one-item sample layout, then builds the hero clump. */
export function build(ctx) {
  island(ctx).bananaPlants = [{ x: 0, z: 0, ry: 0.35, s: 1 }];
  buildBananaPlants(ctx, true);
}

/** Map assembly builder: instantiates every clump from ctx.data.layout. */
export function buildWorld(ctx) {
  buildBananaPlants(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

// ---------------------------------------------------------------------------
// small local geometry helpers (self-contained on purpose: one model file per
// delivery, no build code in the family bucket)
// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _mid = new THREE.Vector3();

/** Append a transformed copy of `geo` to a build list and release the source. */
function push(list, geo, matrix) {
  list.push(transformed(geo, matrix));
  geo.dispose();
}

/** Merge a build list into one geometry and release the temporary parts. */
function merge(list) {
  const merged = mergeGeometries(list);
  for (const g of list) g.dispose();
  return merged;
}

/** Tapered open cylinder spanning two points (pseudostem, petiole, midrib). */
function rod(list, ax, ay, az, bx, by, bz, r0, r1 = r0, radial = 5) {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  _dir.subVectors(_b, _a);
  const len = _dir.length();
  if (len < 1e-4) return;
  _dir.multiplyScalar(1 / len);
  _q.setFromUnitVectors(UP, _dir);
  _mid.copy(_a).add(_b).multiplyScalar(0.5);
  const geo = cylGeo(r1, r0, len, { radial, tile: 1.2, open: true });
  push(list, geo, new THREE.Matrix4().compose(_mid, _q, ONE));
}

/**
 * Curved alpha leaf blade sampled from the shared leaf atlas.
 *
 * Local frame: base at the origin, +X = out along the leaf, +Y = up, +Z = the
 * transverse (width) axis. The midrib follows a circular arc: it leaves the base
 * at elevation `th0` and bends by `k` radians over the whole blade, so the same
 * helper covers upright young paddles and drooping old ones.
 *
 * @param {number} len blade length (m)
 * @param {number} width blade width at its widest (m)
 * @param {'banana'|'broad'|'fern'|'vine'} cell atlas cell
 */
function leafCard(len, width, cell, {
  th0 = 0.9, k = 1.2, segs = 6, cols = 4, roll = 0, fold = 0.1, baseW = 0.3, tipW = 0.5,
} = {}) {
  const { u0, v0, u1, v1 } = leafCellUV(cell, 0.02);
  const vcount = (segs + 1) * cols;
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const uv = new Float32Array(vcount * 2);
  const cw = Math.cos(roll);
  const sw = Math.sin(roll);
  const sag = len / k; // arc radius of the midrib
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = th0 - k * t;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    // midrib point (arc in the XY plane) and its frame
    const px = sag * (Math.sin(th0) - sa);
    const py = sag * (ca - Math.cos(th0));
    // width axis = horizontal transverse, rolled around the midrib tangent
    const wx = -sa * sw;
    const wy = ca * sw;
    const wz = cw;
    // surface normal (up when roll = 0)
    const nx = -sa * cw;
    const ny = ca * cw;
    const nz = -sw;
    // width profile: narrow petiole base, full paddle, half-width tip
    const ramp = Math.min(1, t / 0.12);
    const taper = t <= 0.84 ? 1 : 1 - (1 - tipW) * ((t - 0.84) / 0.16);
    const halfW = width * 0.5 * (baseW + (1 - baseW) * ramp) * taper;
    for (let j = 0; j < cols; j++) {
      const u = cols > 1 ? j / (cols - 1) - 0.5 : 0; // -0.5 .. 0.5 across
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

/** Point on the midrib arc of `leafCard` in leaf-local space. */
function arcPoint(len, th0, k, t) {
  const a = th0 - k * t;
  const sag = len / k;
  return { x: sag * (Math.sin(th0) - Math.sin(a)), y: sag * (Math.cos(a) - Math.cos(th0)) };
}

/** Re-map a wrapped geometry to planar world XZ UVs (mud no longer reads as stripes). */
function planarUV(geo, tile = 1.4) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
  uv.needsUpdate = true;
  return geo;
}

/** A `lib.canopy` twig card (2 tris) — used for the dry/yellowing old leaves and the
 *  pale young flush; a banana leaf card is far too expensive to spend on dead foliage. */
function canopyCard(parts, rng, x, y, z, yaw, {
  size = 0.32, cell = 'dry', pale = false, tilt = null, roll = (rng() - 0.5) * 0.8,
} = {}) {
  const w = size * (0.86 + rng() * 0.28);
  const h = size * (0.8 + rng() * 0.3);
  const rx = tilt === null ? -(0.9 + rng() * 0.9) : tilt;
  push(pale ? parts.canopyPale : parts.canopyDark, canopyQuad(w, h, cell, {
    cols: 1, rows: 1, bend: 0.02 + rng() * 0.03, droop: 0.02 + rng() * 0.02,
  }), matrixFor(x, y, z, rx, yaw, roll));
}

/** Card-count multiplier per quality tier (topology stays identical). */
function cardScale(ctx) {
  const q = ctx.quality || 'high';
  if (q === 'lowest') return 0.6;
  if (q === 'low') return 0.75;
  return 1;
}

/** Blade + its raised midrib, already placed in clump space. */
function addLeaf(parts, yaw, baseX, baseY, baseZ, {
  len, width, th0, k, roll = 0, cell = 'banana', dark = false, segs = 6, cols = 4, fold = 0.18,
}) {
  const mat = matrixFor(baseX, baseY, baseZ, 0, yaw, 0);
  push(dark ? parts.leafDark : parts.leaf, leafCard(len, width, cell, {
    th0, k, roll, segs, cols, fold,
  }), mat);
  // midrib: two short tapered segments under the blade. The painted banana leaf tapers
  // away before the card tip, so the rib stops well short of it (RIB_END) AND shrinks
  // to a needle-thin tip — otherwise the dark rachis reads as a spike past the leaf tip
  // (QA P1). It also sits 4 mm below the blade centre line so it stays on the underside
  // instead of poking through the painted surface.
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const RIB_END = 0.74;
  const DROP = 0.004;
  for (let s = 0; s < 2; s++) {
    const t0 = (s * RIB_END) / 2;
    const t1 = ((s + 1) * RIB_END) / 2;
    const p0 = arcPoint(len, th0, k, t0);
    const p1 = arcPoint(len, th0, k, t1);
    rod(parts.wood,
      baseX + ca * p0.x, baseY + p0.y - DROP, baseZ - sa * p0.x,
      baseX + ca * p1.x, baseY + p1.y - DROP, baseZ - sa * p1.x,
      s === 0 ? 0.013 : 0.006, s === 0 ? 0.006 : 0.0012, 4);
  }
}

// ---------------------------------------------------------------------------
// clump builders
// ---------------------------------------------------------------------------

/** A stacked-sheath pseudostem. Returns its centre-line accessor for leaf placement. */
function addPseudostem(parts, spec) {
  const { x, z, h, lean, yaw, rBase, segs } = spec;
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const cx = (t) => x + ca * lean * t * t;
  const cz = (t) => z - sa * lean * t * t;
  const cy = (t) => -0.03 + h * t;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    // every sheath steps a little proud of the one below it
    const r0 = rBase * (1 - 0.6 * t0) * (i ? 1.05 : 1);
    const r1 = rBase * (1 - 0.6 * t1);
    rod(parts.wood, cx(t0), cy(t0), cz(t0), cx(t1), cy(t1), cz(t1), r0, r1, 7);
    if (i > 0) {
      const lip = cylGeo(r0 * 1.14, r0 * 1.2, 0.055, { radial: 7, tile: 1.2, open: true });
      push(parts.wood, lip, matrixFor(cx(t0), cy(t0) + 0.025, cz(t0)));
    }
  }
  // fibrous crown where the newest leaf bases bunch up
  const crown = latheGeo(
    [[0, 0], [rBase * 0.5, 0], [rBase * 0.62, h * 0.05], [rBase * 0.4, h * 0.1], [0, h * 0.1]],
    { segments: 7, tile: 1.0 }
  );
  push(parts.wood, crown, matrixFor(cx(1), cy(1), cz(1)));
  return { cx, cz, cy };
}

/** One arching leaf attached to a pseudostem: sheath collar + petiole + blade + midrib. */
function addStemLeaf(parts, stem, rng, { p, yaw, len, width, th0, k, roll, dark, cell, segs = 6, fold = 0.2 }) {
  const t = 0.4 + 0.58 * p;
  const sx = stem.cx(t);
  const sy = stem.cy(t);
  const sz = stem.cz(t);
  const dirX = Math.cos(yaw);
  const dirZ = -Math.sin(yaw);
  const out = 0.14 + 0.09 * rng() + 0.1 * (1 - p);
  const rise = 0.06 + 0.16 * p;
  const bx = sx + dirX * out;
  const by = sy + rise;
  const bz = sz + dirZ * out;
  // petiole: a flattened stalk from inside the sheath out to the blade base
  rod(parts.wood, sx + dirX * 0.02, sy + rise * 0.2, sz + dirZ * 0.02, bx, by, bz, 0.032, 0.016, 4);
  // sheath collar: the wrapped leaf-base that clasps the pseudostem, only on the
  // upper leaves where the crown needs the density (a full set would cost 400 tris)
  if (p > 0.5) {
    const collar = cylGeo(0.05 + rng() * 0.012, 0.042, 0.07 + rng() * 0.03, { radial: 5, tile: 1.1, open: true });
    push(parts.wood, collar, matrixFor(sx + dirX * 0.03, sy + rise * 0.1, sz + dirZ * 0.03, (rng() - 0.5) * 0.2, yaw, 0.16));
  }
  addLeaf(parts, yaw, bx, by, bz, { len, width, th0, k, roll, cell, dark, segs, fold });
}

/** Hanging flower heart with a small green fruit hand above it. */
function addFlowerAndFruit(parts, stem, rng) {
  const topX = stem.cx(0.8);
  const topY = stem.cy(0.8);
  const topZ = stem.cz(0.8);
  const yaw = -1.15; // hangs towards the front (-Z) so the FRONT view reads the heart
  const dx = Math.cos(yaw);
  const dz = -Math.sin(yaw);
  const ax = topX + dx * 0.3;
  const az = topZ + dz * 0.3;
  // peduncle dropping out of the crown
  rod(parts.wood, topX, topY, topZ, ax, topY - 0.1, az, 0.026, 0.02, 4);
  // fruit hand: two staggered rings of small green fingers
  for (let row = 0; row < 2; row++) {
    const y = topY - 0.2 - row * 0.1;
    const n = 5 - row;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + row * 0.4 + rng() * 0.15;
      const rr = 0.045 + row * 0.012;
      const fx = ax + Math.cos(a) * rr;
      const fz = az - Math.sin(a) * rr;
      const fy = y - 0.06;
      // finger: a thin tapered capsule hanging down and splaying out. Keep the two
      // radii small (top thinner than base) — an oversized base turns the hand into
      // a pale crumpled fan.
      const finger = cylGeo(0.007, 0.016, 0.16, { radial: 4, tile: 0.7, open: true });
      push(parts.fruit, finger, matrixFor(fx, fy, fz, 0.32, -a, 0.35));
    }
  }
  // flower heart: a dark tear-drop bud wrapped in bracts (solid lathe: the alpha
  // leaf material would cut it apart, so the bud rides the bark batch instead)
  const heartY = topY - 0.52;
  const bud = latheGeo(
    [[0, 0], [0.05, 0.015], [0.085, 0.07], [0.075, 0.15], [0.04, 0.22], [0.012, 0.27]],
    { segments: 7, tile: 0.8 }
  );
  push(parts.wood, bud, matrixFor(ax, heartY, az, 0.12, yaw, 0));
  for (let i = 0; i < 2; i++) {
    const a = yaw + i * 2.3;
    const bract = leafCard(0.18, 0.16, 'banana', { th0: -0.7, k: 0.5, segs: 2, cols: 2, fold: 0.2 });
    push(parts.leafDark, bract, matrixFor(ax, heartY + 0.1, az, -0.5, a, 0.2));
  }
}

/** A young sucker shoot at the base of the clump. */
function addSucker(parts, rng, x, z, yaw, h) {
  const lean = 0.12 + rng() * 0.08;
  const dx = Math.cos(yaw);
  const dz = -Math.sin(yaw);
  const tx = x + dx * lean * h;
  const tz = z + dz * lean * h;
  rod(parts.wood, x, -0.03, z, tx, h, tz, 0.05, 0.028, 5);
  for (let i = 0; i < 2; i++) {
    const a = yaw + i * 2.6 + rng() * 0.3;
    addLeaf(parts, a, tx, h - 0.06, tz, {
      len: 0.42 + rng() * 0.16,
      width: 0.2,
      th0: 0.95 + i * 0.2,
      k: 1.15,
      roll: (rng() - 0.5) * 0.5,
      segs: 3,
      cols: 3,
    });
  }
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

/** Wet leaf-litter mound the clump grows out of. */
function addGroundMound(parts, rng) {
  const mound = sphereGeo(0.58, { segW: 10, segH: 6, tile: 1.4 });
  mound.scale(1, 0.06, 0.92);
  mound.computeVertexNormals();
  // planar world-XZ UVs: the old sphere UVs smeared the litter map into "tiger stripes"
  push(parts.mud, planarUV(mound, 1.2), matrixFor(0, 0.005, 0, 0, 0.4, 0));
  for (let i = 0; i < 2; i++) {
    const r = 0.12 + rng() * 0.08;
    const blob = sphereGeo(r, { segW: 8, segH: 6, tile: 1.2 });
    blob.scale(1, 0.22, 0.85);
    blob.computeVertexNormals();
    push(parts.mud, planarUV(blob, 1.1), matrixFor((rng() - 0.5) * 0.9, 0.008, (rng() - 0.5) * 0.9, 0, rng() * TAU, 0));
  }
  // brown banana leaves rotting on the ground around the clump (sunk into the soil so
  // they read as debris, not as floating cards)
  for (let i = 0; i < 7; i++) {
    const a = rng() * TAU;
    const rr = 0.45 + rng() * 0.55;
    push(parts.litter, deadLeafGeo(0.22 + rng() * 0.14, 0.09 + rng() * 0.05),
      matrixFor(Math.cos(a) * rr, 0.005 + rng() * 0.005, Math.sin(a) * rr, 0, rng() * TAU, 0));
  }
}

// ---------------------------------------------------------------------------
// family builder
// ---------------------------------------------------------------------------

/**
 * One banana clump as three merged material groups (stems+petioles, leaves,
 * dark leaves/fruit/ground) so the map build can instance it.
 */
function bananaClumpGeometry(hi, rng, qs) {
  const parts = { wood: [], leaf: [], leafDark: [], canopyDark: [], canopyPale: [], fruit: [], mud: [], litter: [] };

  /** Pseudostem specs: [x, z, h, lean, yaw, rBase]. Tallest one carries the fruit. */
  const stems = hi
    ? [
        { x: -0.34, z: 0.1, h: 1.92, lean: 0.13, yaw: 0.5, rBase: 0.125, segs: 4 },
        { x: 0.26, z: 0.24, h: 2.26, lean: 0.18, yaw: 2.3, rBase: 0.142, segs: 4 },
        { x: 0.13, z: -0.36, h: 2.06, lean: 0.22, yaw: 4.2, rBase: 0.13, segs: 4 },
        { x: -0.26, z: -0.24, h: 1.46, lean: 0.1, yaw: 5.3, rBase: 0.1, segs: 3 },
      ]
    : [
        { x: 0.24, z: 0.2, h: 2.16, lean: 0.16, yaw: 2.3, rBase: 0.142, segs: 3 },
        { x: 0.1, z: -0.32, h: 1.92, lean: 0.2, yaw: 4.2, rBase: 0.125, segs: 3 },
        { x: -0.3, z: 0.1, h: 1.6, lean: 0.11, yaw: 0.6, rBase: 0.105, segs: 3 },
      ];

  const leafCount = hi ? 9 : 6;
  const built = stems.map((spec, si) => {
    const stem = addPseudostem(parts, spec);
    for (let i = 0; i < leafCount; i++) {
      const p = i / (leafCount - 1); // 0 = oldest, lowest; 1 = youngest, top
      const yaw = spec.yaw + i * 2.399 + (rng() - 0.5) * 0.35;
      // Age drives the arch: the younger leaves start higher but every blade curls
      // over and hangs, so the clump reads as broad drooping paddles rather than a
      // set of flat discs facing the sky.
      const th0 = 0.5 + 0.62 * p + (rng() - 0.5) * 0.14;
      const k = 1.75 - 0.5 * p + (rng() - 0.5) * 0.14;
      const len = (hi ? 0.83 : 0.75) * (0.82 + 0.3 * Math.sin(Math.PI * (0.15 + 0.7 * p))) + rng() * 0.1;
      // The atlas 'banana' cell paints a long paddle inside a ~57% tall band; the
      // card is wider than the painted blade so the whole silhouette is used.
      const width = 0.72 + 0.16 * p + rng() * 0.08;
      // strong roll: the outer blades show their edge to the sky and their face
      // to the camera, which keeps the frond colour from washing out
      const roll = (rng() - 0.5) * 1.5;
      // only the genuinely oldest blades go on the dark material — the first pass put
      // 78% of the leaves there and the whole plant read senescent (10 bright vs 30
      // dark cards). Now it is roughly 2/3 fresh green, 1/3 older/darker.
      addStemLeaf(parts, stem, rng, {
        p, yaw, len, width, th0, k, roll, dark: p < 0.18 || i === 2, segs: 6, fold: 0.2,
      });
    }
    // an unopened cigar leaf poking out of the crown
    const crownY = stem.cy(1) + 0.08;
    addLeaf(parts, spec.yaw + 1.2, stem.cx(1), crownY, stem.cz(1), {
      len: 0.52, width: 0.3, th0: 1.35, k: 0.35, roll: 0.2, segs: 3, cols: 3, fold: 0.24,
    });
    // bright young flush card beside the cigar leaf: the last leaf that just unrolled
    if (qs > 0.5) {
      canopyCard(parts, rng, stem.cx(0.94) + Math.cos(spec.yaw + 2.0) * 0.1,
        stem.cy(0.94) + 0.16, stem.cz(0.94) - Math.sin(spec.yaw + 2.0) * 0.1,
        spec.yaw + 2.0, { size: 0.24 + rng() * 0.1, cell: 'pale', pale: true, tilt: -0.4 - rng() * 0.5 });
    }
    // one or two dry leaves slumped against the pseudostem, plus a skirt of brown
    // dead leaves at the base (the yellowing old foliage a banana clump always has)
    if (hi || si === 0) {
      addLeaf(parts, spec.yaw + 3.1, stem.cx(0.55), stem.cy(0.55), stem.cz(0.55), {
        len: 0.78, width: 0.62, th0: -0.15, k: 0.95, roll: 0.1, dark: true, segs: 4, cols: 3, fold: 0.26,
      });
      canopyCard(parts, rng, stem.cx(0.32) + Math.cos(spec.yaw + 2.4) * 0.16,
        stem.cy(0.32) + 0.05, stem.cz(0.32) - Math.sin(spec.yaw + 2.4) * 0.16,
        spec.yaw + 2.4, { size: 0.34 + rng() * 0.12, cell: 'dry', tilt: -0.55 - rng() * 0.5 });
      canopyCard(parts, rng, stem.cx(0.2) + Math.cos(spec.yaw + 5.1) * 0.14,
        stem.cy(0.2) + 0.04, stem.cz(0.2) - Math.sin(spec.yaw + 5.1) * 0.14,
        spec.yaw + 5.1, { size: 0.28 + rng() * 0.1, cell: 'dry', tilt: -0.75 - rng() * 0.4 });
    }
    return stem;
  });

  // fruit + flower on the tallest stem
  addFlowerAndFruit(parts, built[hi ? 1 : 0], rng);

  // young suckers
  addSucker(parts, rng, -0.5, -0.36, 1.1, 0.62);
  if (hi) addSucker(parts, rng, 0.52, -0.1, 4.4, 0.48);

  addGroundMound(parts, rng);

  return {
    // barkMoss is a vertex-colour material (ground AO), so the merged stem batch
    // gets a baked height/gradient AO attribute; the leaf cards use plain atlas UVs.
    wood: bakeVertexAO(merge(parts.wood), { ground: 2.3, floor: 0.6, noise: 0.06, seed: 7 }),
    leaf: merge(parts.leaf),
    leafDark: merge(parts.leafDark),
    canopyDark: merge(parts.canopyDark),
    canopyPale: merge(parts.canopyPale),
    fruit: merge(parts.fruit),
    mud: bakeVertexAO(merge(parts.mud), { ground: 0.9, floor: 0.55, noise: 0.1, seed: 3 }),
    litter: bakeVertexAO(merge(parts.litter), { ground: 0.6, floor: 0.62, noise: 0.08, seed: 5 }),
  };
}

function buildBananaPlants(ctx, preview) {
  // layout items only require x/z; normalise the optional fields so the instance
  // matrices never contain undefined (NaN) components.
  const items = (island(ctx).bananaPlants || []).map((p) => ({
    x: p.x, z: p.z, y: p.y ?? 0, ry: p.ry ?? 0, rx: p.rx ?? 0, rz: p.rz ?? 0, s: p.s ?? 1,
  }));
  if (!items.length) return;
  const M = ctx.materials;
  // The map build only needs a slightly lighter clump; the silhouette must match.
  const hi = preview || ctx.stage === true;
  const qs = cardScale(ctx);
  const rng = makeRNG(4177);
  const geo = bananaClumpGeometry(hi, rng, qs);
  const opts = { seed: 311, castShadow: true };
  makeInstanced(ctx, geo.wood, M.barkMoss, items, 'banana-plant-stems', 'wood', opts);
  makeInstanced(ctx, geo.leaf, M.broadleaf, items, 'banana-plant-leaves', 'fabric', opts);
  makeInstanced(ctx, geo.leafDark, M.broadleafDark, items, 'banana-plant-old-leaves', 'fabric', opts);
  makeInstanced(ctx, geo.canopyDark, M.canopyDark, items, 'banana-plant-dry-skirt', 'fabric', opts);
  makeInstanced(ctx, geo.canopyPale, M.canopyPale, items, 'banana-plant-young-flush', 'fabric', opts);
  makeInstanced(ctx, geo.fruit, M.bamboo, items, 'banana-plant-fruit', 'wood', opts);
  makeInstanced(ctx, geo.mud, M.mud, items, 'banana-plant-mound', 'sand', opts);
  makeInstanced(ctx, geo.litter, M.leafLitter, items, 'banana-plant-litter', 'sand', opts);
}
