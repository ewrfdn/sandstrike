/**
 * BAMBOO CLUMP — F5 (see ISLAND_ASSETS.md §2.1).
 *
 * A wet tropical bamboo clump: 5-9 slightly bowed culms with raised node rings and
 * clean angled cut tops, branch whorls from 40% height upwards carrying drooping
 * clumps of lanceolate blades AND `lib.canopy` twig cards (a canopy card paints 6-18
 * small leaves, so the foliage finally reads as a leaf mass instead of a bare pole),
 * dry papery root sheaths at the base, one broken dead culm and one bleached culm
 * lying across the litter.
 *
 * Rules honoured here: metres, +Y up, front is -Z, base sits just into the soil;
 * leaf cards sample the shared atlas through `leafCellUV()` / `canopyQuad()`; all
 * randomness comes from one fixed-seed `makeRNG()`; the stage build is one hero
 * clump, the map build reads `layout.island.bambooClumps`.
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
import { leafCellUV, canopyQuad } from './leaf-atlas.js';

export const meta = { id: 'bamboo-clump', kind: 'world', group: 'flora', label: '竹丛 · BAMBOO CLUMP' };

/** Preview builder (stage/WebUI): one-item sample layout + hero clump. */
export function build(ctx) {
  island(ctx).bambooClumps = [{ x: 0, z: 0, ry: 0.4, s: 1 }];
  buildBambooClumps(ctx, true);
}

/** Map assembly builder: instantiates every clump from ctx.data.layout. */
export function buildWorld(ctx) {
  buildBambooClumps(ctx, false);
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

/** Tapered open cylinder between two points (internode, branch, node band). */
function rod(list, ax, ay, az, bx, by, bz, r0, r1 = r0, radial = 6) {
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
  th0 = 0.8, k = 1.1, segs = 3, cols = 2, roll = 0, fold = 0.12, baseW = 0.4, tipW = 0.4,
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

/**
 * One `lib.canopy` twig card (2 triangles, 6-18 painted leaves): the cheap way to add
 * real foliage mass. `tilt` is the elevation from "face up" (-PI/2) towards vertical.
 */
function canopyCard(parts, rng, x, y, z, {
  size = 0.3, cell = 'spray', dark = false, pale = false, tilt = null, yaw = rng() * TAU,
  roll = (rng() - 0.5) * 1.5, bend = 0.02, droop = 0.02,
} = {}) {
  const w = size * (0.86 + rng() * 0.3);
  const h = size * (0.72 + rng() * 0.34);
  const rx = tilt === null ? -(0.55 + rng() * 1.2) : tilt;
  push(pale ? parts.canopyPale : dark ? parts.canopyDark : parts.canopy,
    canopyQuad(w, h, cell, { cols: 1, rows: 1, bend: bend * (0.6 + rng() * 0.8), droop: droop * (0.4 + rng()) }),
    matrixFor(x, y, z, rx, yaw, roll));
}

/** Small sunken ground-litter scrap: 2x2 bent quad with world-scale UVs. */
function litterCard(w, h, { tile = 1.2, bend = 0.022 } = {}) {
  const geo = new THREE.PlaneGeometry(w, h, 2, 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const hw = w * 0.5;
  const hh = h * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // dish the sheet down at the rim so the edge always sinks under the soil
    pos.setZ(i, bend * (1 - (x / hw) * (x / hw)) * (1 - (y / hh) * (y / hh)) - bend * 0.55);
    uv.setXY(i, (x + hw) / tile, (y + hh) / tile);
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Re-map a wrapped geometry to planar world XZ UVs (stops the mud "tiger stripe"). */
function planarUV(geo, tile = 1.4) {
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

/**
 * A hanging foliage node at the end of a twig: a few lanceolate blade cards for the
 * read-at-2m detail, wrapped in canopy twig cards for the dense leaf mass that was
 * missing (the clump used to look like bare poles).
 */
function addLeafCluster(parts, rng, x, y, z, yaw, {
  blades = 3, sprays = 4, mul = 1, qs = 1,
} = {}) {
  const nb = Math.max(1, Math.round(blades * qs));
  for (let k = 0; k < nb; k++) {
    const a = yaw + (k / Math.max(1, nb - 1) - 0.5) * 2.9 + (rng() - 0.5) * 0.3;
    // bamboo leaf blades hang well below horizontal, the ones at the back stay lifted
    const th0 = -0.3 + rng() * 0.82;
    const len = (0.22 + rng() * 0.13) * mul;
    const wide = rng() < 0.72;
    const cell = wide ? 'broad' : 'vine';
    const width = wide ? 0.25 + rng() * 0.07 : 0.32 + rng() * 0.06;
    push(k % 5 === 0 ? parts.leafDark : parts.leaf, leafCard(len, width, cell, {
      th0,
      k: 1.25 + rng() * 0.85,
      segs: 2,
      cols: 2,
      roll: (rng() - 0.5) * 0.9,
      fold: 0.15,
    }), matrixFor(x, y, z, 0, a, 0));
  }
  const ns = Math.max(1, Math.round(sprays * qs));
  for (let k = 0; k < ns; k++) {
    const a = yaw + (rng() - 0.5) * 3.4;
    const rr = 0.03 + rng() * 0.26;
    canopyCard(parts, rng, x + Math.cos(a) * rr, y + (rng() - 0.5) * 0.24 - 0.05, z - Math.sin(a) * rr, {
      size: (0.3 + rng() * 0.22) * mul,
      cell: rng() < 0.55 ? 'spray' : 'sprig',
      dark: rng() < 0.3,
      yaw: a,
    });
  }
}

/** One culm: bowed internodes, node bands, cut / broken top, branch whorls. */
function addCulm(parts, rng, spec, qs) {
  const { x, z, h, yaw, bow, rBase, nodes, broken } = spec;
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const cx = (t) => x + ca * bow * t * t;
  const cz = (t) => z - sa * bow * t * t;
  const cy = (t) => -0.02 + h * t;
  const rad = (t) => rBase * (1 - 0.55 * t);
  // internode segments
  for (let i = 0; i < nodes; i++) {
    const t0 = i / nodes;
    const t1 = (i + 1) / nodes;
    rod(parts.bamboo, cx(t0), cy(t0), cz(t0), cx(t1), cy(t1), cz(t1), rad(t0), rad(t1), 6);
    // raised node ring at every joint
    if (i > 0) {
      const nr = rad(t0) * 1.18;
      rod(parts.bamboo, cx(t0), cy(t0) - 0.018, cz(t0), cx(t0), cy(t0) + 0.018, cz(t0), nr, nr * 0.92, 6);
    }
  }
  // --- top: most culms are cut at an angle, one or two are snapped/broken
  const topX = cx(1);
  const topY = cy(1);
  const topZ = cz(1);
  const rTop = rad(1);
  if (broken) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + rng() * 0.4;
      rod(parts.bamboo,
        topX + Math.cos(a) * rTop * 0.8, topY - 0.02, topZ + Math.sin(a) * rTop * 0.8,
        topX + Math.cos(a) * rTop * 1.2, topY + 0.06 + rng() * 0.09, topZ + Math.sin(a) * rTop * 1.2,
        rTop * 0.4, 0.001, 3);
    }
  } else {
    // mouth rim + an obliquely cut pale disc
    rod(parts.bamboo, topX, topY - 0.035, topZ, topX, topY, topZ, rTop * 1.05, rTop, 6);
    const disc = new THREE.CircleGeometry(rTop * 0.92, 7);
    push(parts.dry, disc, matrixFor(topX, topY + 0.004, topZ, -Math.PI / 2 + 0.42, yaw, 0));
  }
  // --- branch whorls: thin twigs over the whole upper 60% of the culm (they used to
  // start at 50% and stop at 94%, leaving the crown as the only foliage). Each twig
  // carries a leaf cluster at its middle and one at its tip.
  const whorls = spec.branches ?? 4;
  for (let b = 0; b < whorls; b++) {
    const t = 0.36 + (b / Math.max(1, whorls - 1)) * 0.62 + (rng() - 0.5) * 0.05;
    const a = yaw + (b / whorls) * TAU + rng() * 1.2;
    const ax = cx(t);
    const ay = cy(t);
    const az = cz(t);
    const dirX = Math.cos(a);
    const dirZ = -Math.sin(a);
    const reach = 0.34 + rng() * 0.32;
    const rise = 0.04 + rng() * 0.14;
    const mx = ax + dirX * reach * 0.52;
    const my = ay + rise;
    const mz = az + dirZ * reach * 0.52;
    const tx = ax + dirX * reach;
    const ty = ay + rise + rng() * 0.1;
    const tz = az + dirZ * reach;
    rod(parts.bamboo, ax + dirX * rad(t) * 0.5, ay, az + dirZ * rad(t) * 0.5, mx, my, mz, 0.014, 0.01, 3);
    rod(parts.bamboo, mx, my, mz, tx, ty, tz, 0.01, 0.005, 3);
    addLeafCluster(parts, rng, mx, my, mz, a, { blades: 1, sprays: 5, mul: 0.94, qs });
    addLeafCluster(parts, rng, tx, ty, tz, a + (rng() - 0.5) * 0.8, { blades: 2, sprays: 7, mul: 1, qs });
    // a secondary drooping cluster just behind the tip fills the leaf mass out
    addLeafCluster(parts, rng, tx - dirX * 0.14, ty - 0.12, tz - dirZ * 0.14, a + 0.6, { blades: 1, sprays: 3, mul: 0.88, qs });
  }
  // crown: drooping sprays straight out of the cut top so the silhouette stays full
  addLeafCluster(parts, rng, cx(0.94), cy(0.94) + 0.05, cz(0.94), yaw + 1.2, { blades: 2, sprays: 5, mul: 0.95, qs });
  addLeafCluster(parts, rng, cx(0.99), cy(0.99) + 0.1, cz(0.99), yaw + 3.4, { blades: 2, sprays: 5, mul: 0.9, qs });
  addLeafCluster(parts, rng, cx(0.88), cy(0.88), cz(0.88), yaw + 5.1, { blades: 2, sprays: 4, mul: 0.85, qs });
  // young flush: a couple of pale cards at the very top of every other culm
  // (keep one card even on the lowest tier: an empty bucket would drop the whole
  //  young-flush InstancedMesh, and the sunlit tips are what sells the bamboo crown)
  if (qs > 0.45) {
    for (let i = 0; i < (qs > 0.7 ? 2 : 1); i++) {
      const a = yaw + rng() * TAU;
      canopyCard(parts, rng, cx(0.99) + Math.cos(a) * 0.08, cy(0.99) + 0.06 + rng() * 0.12, cz(0.99) - Math.sin(a) * 0.08, {
        size: 0.2 + rng() * 0.08,
        cell: 'pale',
        pale: true,
        yaw: a,
        tilt: -(0.5 + rng() * 0.7),
      });
    }
  }
}

/** Papery dry root sheaths flaring out where each culm meets the soil. */
function addRootSheaths(parts, rng, x, z, yaw) {
  const a = yaw + rng() * 0.6;
  const dx = Math.cos(a);
  const dz = -Math.sin(a);
  const flare = cylGeo(0.075 + rng() * 0.02, 0.035, 0.1 + rng() * 0.04, { radial: 5, tile: 0.9, open: true });
  push(parts.dry, flare, matrixFor(x + dx * 0.06, 0.085, z + dz * 0.06, dx * 0.26, a, dz * 0.26));
  // a couple of spent, dark dry sheaths slumped against the cane (dead-bamboo brown).
  // Keep them upright-ish and clear of the soil so the silhouette never dips below y=0
  // (the card height axis is half a metre wide; a near-horizontal card at knee height
  // would poke under the ground plane).
  for (let i = 0; i < 2; i++) {
    const b = rng() * TAU;
    canopyCard(parts, rng, x + Math.cos(b) * 0.1, 0.2 + rng() * 0.08, z - Math.sin(b) * 0.1, {
      size: 0.22 + rng() * 0.08,
      cell: 'dry',
      dark: true,
      yaw: b,
      tilt: -(1.15 + rng() * 0.5),
      bend: 0.03,
    });
  }
}

/** Bleached dead culm snapped off at chest height. */
function addDeadStump(parts, rng, x, z, yaw, h) {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  rod(parts.dead, x, -0.02, z, x + ca * 0.1, h, z - sa * 0.1, 0.06, 0.045, 6);
  // jagged break
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + rng() * 0.5;
    rod(parts.dead,
      x + ca * 0.1 + Math.cos(a) * 0.04, h - 0.02, z - sa * 0.1 + Math.sin(a) * 0.04,
      x + ca * 0.1 + Math.cos(a) * 0.055, h + 0.05 + rng() * 0.07, z - sa * 0.1 + Math.sin(a) * 0.055,
      0.02, 0.001, 3);
  }
  // dry leaf litter clinging to the dead stem
  for (let i = 0; i < 3; i++) {
    const t = 0.25 + i * 0.24;
    canopyCard(parts, rng, x + ca * t * 0.1, 0.1 + h * (0.35 + i * 0.2), z - sa * t * 0.1, {
      size: 0.2 + rng() * 0.08,
      cell: 'dry',
      yaw: rng() * TAU,
      dark: i % 2 === 0,
    });
  }
}

/** A dead culm lying across the litter at the foot of the clump. */
function addFallenCulm(parts, rng, x, z, yaw, len) {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const ax = x - ca * len * 0.5;
  const az = z + sa * len * 0.5;
  const bx = x + ca * len * 0.5;
  const bz = z - sa * len * 0.5;
  const SEG = 4;
  for (let i = 0; i < SEG; i++) {
    const t0 = i / SEG;
    const t1 = (i + 1) / SEG;
    const y0 = 0.055 + Math.sin(t0 * Math.PI) * 0.03;
    const y1 = 0.055 + Math.sin(t1 * Math.PI) * 0.03;
    rod(parts.dead, ax + (bx - ax) * t0, y0, az + (bz - az) * t0, ax + (bx - ax) * t1, y1, az + (bz - az) * t1,
      0.055 - 0.006 * t0, 0.055 - 0.006 * t1, 6);
    if (i > 0) {
      rod(parts.dead, ax + (bx - ax) * t0, y0 - 0.012, az + (bz - az) * t0,
        ax + (bx - ax) * t0, y0 + 0.012, az + (bz - az) * t0, 0.064 - 0.006 * t0, 0.06 - 0.006 * t0, 6);
    }
  }
  // a couple of dry leaves still clinging to the dead stem
  for (let i = 0; i < 3; i++) {
    const t = 0.24 + i * 0.26;
    push(parts.leafDark, leafCard(0.22, 0.1, 'vine', {
      th0: 0.3, k: 0.8, segs: 2, cols: 2, roll: 0.4,
    }), matrixFor(ax + (bx - ax) * t, 0.16, az + (bz - az) * t, 0, yaw + 1.2 + i, 0));
  }
}

/** Wet leaf-litter floor + a few bamboo shoots pushing up. */
function addGround(parts, rng, shoots) {
  const mound = sphereGeo(0.62, { segW: 10, segH: 6, tile: 1.2 });
  mound.scale(1.05, 0.05, 1.05);
  mound.computeVertexNormals();
  // planar world-XZ UVs: the old sphere UVs stretched the leaf-litter map into stripes
  push(parts.mud, planarUV(mound, 1.25), matrixFor(0, 0.005, 0, 0, 0.3, 0));
  // dry bamboo leaves shed around the clump: brown `dry` canopy cards lying on the soil
  // (this is what replaces the old over-saturated orange litter discs)
  for (let i = 0; i < 10; i++) {
    const a = rng() * TAU;
    const rr = 0.22 + rng() * 0.72;
    canopyCard(parts, rng, Math.cos(a) * rr, 0.03 + rng() * 0.03, Math.sin(a) * rr, {
      size: 0.16 + rng() * 0.1,
      cell: 'dry',
      dark: true,
      yaw: rng() * TAU,
      tilt: -(1.35 + rng() * 0.3),
      roll: (rng() - 0.5) * 2.4,
      bend: 0.03,
    });
  }
  for (let i = 0; i < 8; i++) {
    const a = rng() * TAU;
    const rr = 0.2 + rng() * 0.7;
    push(parts.litter, litterCard(0.1 + rng() * 0.1, 0.055 + rng() * 0.04, { tile: 1.1 }),
      matrixFor(Math.cos(a) * rr, 0.006 + rng() * 0.005, Math.sin(a) * rr, -1.52, rng() * TAU, 0));
  }
  // young bamboo shoots (竹笋): dark papery cones
  for (let i = 0; i < shoots; i++) {
    const a = rng() * TAU;
    const rr = 0.28 + rng() * 0.4;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const hh = 0.18 + rng() * 0.16;
    push(parts.dry, cylGeo(0.002, 0.055, hh, { radial: 5, tile: 0.8 }), matrixFor(x, hh * 0.5, z, (rng() - 0.5) * 0.3, rng() * TAU, (rng() - 0.5) * 0.3));
  }
}

// ---------------------------------------------------------------------------
// family builder
// ---------------------------------------------------------------------------

function bambooClumpGeometry(hi, rng, qs) {
  const parts = {
    bamboo: [], leaf: [], leafDark: [], canopy: [], canopyDark: [], canopyPale: [],
    dry: [], dead: [], mud: [], litter: [],
  };

  // Culm layout: a tight arc of canes, the middle ones the tallest.
  const culms = hi
    ? [
        { x: -0.62, z: 0.34, h: 4.8, yaw: 0.35, bow: 0.25, rBase: 0.062, nodes: 8, branches: 5 },
        { x: -0.22, z: -0.5, h: 5.4, yaw: 1.2, bow: 0.21, rBase: 0.07, nodes: 9, branches: 5 },
        { x: 0.27, z: -0.34, h: 5.7, yaw: 2.1, bow: 0.3, rBase: 0.075, nodes: 9, branches: 5 },
        { x: 0.63, z: 0.14, h: 5.1, yaw: 3.0, bow: 0.27, rBase: 0.065, nodes: 8, branches: 5 },
        { x: 0.18, z: 0.56, h: 4.4, yaw: 4.0, bow: 0.24, rBase: 0.06, nodes: 7, branches: 4, broken: true },
        { x: -0.43, z: -0.18, h: 3.8, yaw: 4.9, bow: 0.21, rBase: 0.052, nodes: 6, branches: 4, broken: true },
        { x: 0.78, z: 0.52, h: 3.1, yaw: 5.6, bow: 0.19, rBase: 0.045, nodes: 5, branches: 3 },
        { x: -0.14, z: 0.18, h: 5.9, yaw: 0.9, bow: 0.14, rBase: 0.072, nodes: 9, branches: 5 },
      ]
    : [
        { x: -0.47, z: 0.27, h: 4.6, yaw: 0.4, bow: 0.21, rBase: 0.06, nodes: 6, branches: 3 },
        { x: 0.11, z: -0.38, h: 5.2, yaw: 2.0, bow: 0.25, rBase: 0.07, nodes: 6, branches: 3 },
        { x: 0.51, z: 0.22, h: 4.0, yaw: 3.4, bow: 0.21, rBase: 0.055, nodes: 5, branches: 3, broken: true },
        { x: -0.22, z: -0.11, h: 5.6, yaw: 1.0, bow: 0.16, rBase: 0.068, nodes: 6, branches: 3 },
      ];

  for (const spec of culms) {
    addCulm(parts, rng, spec, qs);
    addRootSheaths(parts, rng, spec.x, spec.z, spec.yaw);
  }
  addDeadStump(parts, rng, -0.66, -0.5, 2.4, 1.15);
  addFallenCulm(parts, rng, 0.1, -0.75, 0.35, 2.3);
  addGround(parts, rng, hi ? 3 : 2);

  return {
    bamboo: merge(parts.bamboo),
    leaf: merge(parts.leaf),
    leafDark: merge(parts.leafDark),
    canopy: merge(parts.canopy),
    canopyDark: merge(parts.canopyDark),
    canopyPale: merge(parts.canopyPale),
    dry: merge(parts.dry),
    // driftWood is a vertex-colour material: bake the AO attribute for it
    dead: bakeVertexAO(merge(parts.dead), { ground: 1.2, floor: 0.6, noise: 0.07, seed: 23 }),
    mud: bakeVertexAO(merge(parts.mud), { ground: 0.8, floor: 0.58, noise: 0.1, seed: 29 }),
    litter: bakeVertexAO(merge(parts.litter), { ground: 0.6, floor: 0.6, noise: 0.08, seed: 31 }),
  };
}

function buildBambooClumps(ctx, preview) {
  const items = (island(ctx).bambooClumps || []).map((p) => ({
    x: p.x, z: p.z, y: p.y ?? 0, ry: p.ry ?? 0, rx: p.rx ?? 0, rz: p.rz ?? 0, s: p.s ?? 1,
  }));
  if (!items.length) return;
  const M = ctx.materials;
  const hi = preview || ctx.stage === true;
  const qs = cardScale(ctx);
  const rng = makeRNG(9137);
  const geo = bambooClumpGeometry(hi, rng, qs);
  const opts = { seed: 511, castShadow: true };
  makeInstanced(ctx, geo.bamboo, M.bamboo, items, 'bamboo-clump-culms', 'wood', opts);
  makeInstanced(ctx, geo.leaf, M.broadleaf, items, 'bamboo-clump-leaves', 'fabric', opts);
  makeInstanced(ctx, geo.leafDark, M.broadleafDark, items, 'bamboo-clump-old-leaves', 'fabric', opts);
  makeInstanced(ctx, geo.canopy, M.canopy, items, 'bamboo-clump-canopy', 'fabric', opts);
  makeInstanced(ctx, geo.canopyDark, M.canopyDark, items, 'bamboo-clump-shaded-canopy', 'fabric', opts);
  makeInstanced(ctx, geo.canopyPale, M.canopyPale, items, 'bamboo-clump-young-flush', 'fabric', opts);
  makeInstanced(ctx, geo.dry, M.thatchDark, items, 'bamboo-clump-dry-sheaths', 'fabric', opts);
  makeInstanced(ctx, geo.dead, M.driftWood, items, 'bamboo-clump-dead-culms', 'wood', opts);
  makeInstanced(ctx, geo.mud, M.mud, items, 'bamboo-clump-mound', 'sand', opts);
  makeInstanced(ctx, geo.litter, M.leafLitter, items, 'bamboo-clump-litter', 'sand', opts);
}
