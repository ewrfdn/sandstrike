import * as THREE from 'three';
import { TAU, makeInstanced, mergeGeometries, transformed } from '../core.js';
import { makeRNG } from '../../utils.js';
import {
  isPreview,
  plateGeo,
  cylGeo,
  latheGeo,
  sphereGeo,
  torusGeo,
} from './detail.js';

export const meta = { id: 'palm', kind: 'world', group: 'clutter', label: '棕榈树 · PALM' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.palms = [{ x: 0, z: 0, s: 1.05, ry: 0.4 }];
  buildPalmFamily(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildPalmFamily(ctx);
}

// ---------------------------------------------------------------------------
// Palm skeleton constants (shared by both levels of detail).
// The trunk is the same 2.8 m tapered column as before, bent +0.28 m in X at
// the crown by the original `(y / 2.8)^2 * 0.28` formula, with the frond crown
// fanning out of a point just below the trunk top.
// ---------------------------------------------------------------------------
const TRUNK_H = 2.8;
const TRUNK_BEND = 0.28;
const TRUNK_R_BOTTOM = 0.2;
const TRUNK_R_TOP = 0.107;
const CROWN_X = 0.2;
const CROWN_Y = 2.72;

/** Trunk radius at height y (slight taper). */
function trunkRadius(y) {
  const t = Math.max(0, Math.min(1, y / TRUNK_H));
  return TRUNK_R_BOTTOM + (TRUNK_R_TOP - TRUNK_R_BOTTOM) * Math.pow(t, 0.8);
}

/** Trunk centre-line X offset at height y (the same formula as the low-poly trunk). */
function trunkX(y) {
  return Math.pow(Math.max(0, y) / TRUNK_H, 2) * TRUNK_BEND;
}

/** Bend a geometry with the trunk centre-line formula and refresh the normals. */
function bendTrunk(geo) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + trunkX(p.getY(i)));
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Frond maths. Every frond is a single arch: it starts at the crown, leaves the
// centre with elevation `th0` and curls over at rate `k` over arc length `len`.
// In the frond's local frame +X is radial, +Y is up and +Z is the transverse
// (horizontal) normal of the feather plane.
// ---------------------------------------------------------------------------

/** Point on the frond arc at normalised distance t (0 = crown, 1 = tip). */
function arcPoint(th0, k, len, t) {
  const a = th0 - k * t;
  return {
    x: (len / k) * (Math.sin(th0) - Math.sin(a)),
    y: (len / k) * (Math.cos(a) - Math.cos(th0)),
    angle: a,
  };
}

/** Transform matrix that lifts a frond-local part onto the palm. */
function frondM(yaw, baseY) {
  return new THREE.Matrix4()
    .makeTranslation(CROWN_X, baseY, 0)
    .multiply(new THREE.Matrix4().makeRotationY(yaw));
}

/** Add a transformed temporary geometry to a build list and dispose the source. */
function pushGeo(list, geo, matrix) {
  list.push(transformed(geo, matrix));
  geo.dispose();
}

/** Merge a build list into one geometry and release the parts. */
function mergeList(list) {
  const merged = mergeGeometries(list);
  for (const g of list) g.dispose();
  return merged;
}

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();

/** Tapered rachis: a few short open cylinders following the frond arc. */
function rachisGeo(woodGeos, th0, k, len, baseY, yaw, r0, r1, segments) {
  const base = frondM(yaw, baseY);
  let prev = arcPoint(th0, k, len, 0);
  for (let s = 1; s <= segments; s++) {
    const t = (s / segments) * 0.96;
    const cur = arcPoint(th0, k, len, t);
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-4) continue;
    const rA = r0 + (r1 - r0) * ((s - 1) / segments);
    const rB = r0 + (r1 - r0) * (s / segments);
    const geo = cylGeo(rB, rA, segLen, { radial: 5, tile: 1.2, open: true });
    _dir.set(dx, dy, 0).normalize();
    _quat.setFromUnitVectors(_up, _dir);
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3((prev.x + cur.x) / 2, (prev.y + cur.y) / 2, 0),
      _quat,
      new THREE.Vector3(1, 1, 1)
    );
    pushGeo(woodGeos, geo, base.clone().multiply(local));
    prev = cur;
  }
}

/**
 * The frond texture is a whole painted frond on a transparent canvas, so the
 * reliably opaque texels are the painted central rib (a 6 px stroke that bows
 * to v≈0.523 in the middle). Leaflet plates are mapped onto that rib band so
 * the alpha-tested material keeps them solid, while the wider curved frond
 * "card" still carries the painted leaflet fan.
 */
function ribBandUV(geo, len, wid, u0, uSpan) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = u0 + (pos.getX(i) / len + 0.5) * uSpan;
    const t = Math.max(0, Math.min(1, (u * 256 - 10) / 238));
    const v = 0.5 + 0.09375 * t * (1 - t) + (pos.getY(i) / wid) * 0.006;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Leaflet plate: a lanceolate bevelled blade, tapering towards the tip. */
function leafletGeo(len, wid, thick) {
  const geo = plateGeo(len, wid, thick, { bevel: 0.004, tile: 1.2 });
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = Math.max(0, Math.min(1, p.getX(i) / len + 0.5));
    p.setY(i, p.getY(i) * (1.0 - 0.68 * s));
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Curved frond card carrying the painted leaflet fan. */
function cardGeo(th0, k, len, cols, rows) {
  const card = new THREE.PlaneGeometry(1, 1, cols, rows);
  const cp = card.attributes.position;
  const cuv = card.attributes.uv;
  for (let i = 0; i < cp.count; i++) {
    const s = cp.getX(i) + 0.5; // 0 .. 1 across the frond
    const t = cp.getY(i) + 0.5; // 0 .. 1 along the frond
    const p = arcPoint(th0, k, len, t);
    const wide = 0.30 + 0.36 * Math.sin(Math.PI * t) + 0.10 * (1 - t);
    const bow = (0.045 + 0.05 * Math.sin(Math.PI * t)) * (s - 0.5);
    cp.setXYZ(
      i,
      p.x - Math.sin(p.angle) * (s - 0.5) * wide,
      p.y + Math.cos(p.angle) * (s - 0.5) * wide,
      bow
    );
    cuv.setXY(i, 0.04 + 0.92 * t, s);
  }
  card.translate(0, 0, 0.05);
  card.computeVertexNormals();
  return card;
}

/** One detailed frond: rachis + curved painted card + two rows of leaflets. */
function buildFrondDetailed(frondGeos, woodGeos, spec, rng) {
  const { yaw, th0, k, len, baseY, cardCols, cardRows, stations, leafLen, leafW } = spec;
  const m = frondM(yaw, baseY);
  rachisGeo(woodGeos, th0, k, len, baseY, yaw, 0.03, 0.005, 4);
  pushGeo(frondGeos, cardGeo(th0, k, len, cardCols, cardRows), m);

  for (let j = 0; j < stations; j++) {
    const t = 0.1 + (j / (stations - 1)) * 0.86;
    const p = arcPoint(th0, k, len, t);
    const T = new THREE.Vector3(Math.cos(p.angle), Math.sin(p.angle), 0);
    const N = new THREE.Vector3(-Math.sin(p.angle), Math.cos(p.angle), 0);
    const B = new THREE.Vector3(0, 0, 1);
    const scale = 0.52 + 0.68 * Math.sin(Math.PI * Math.min(1, t + 0.05));
    for (const side of [-1, 1]) {
      const llen = leafLen * scale * (0.9 + rng() * 0.2);
      const d = N.clone().multiplyScalar(side * (0.90 + rng() * 0.08))
        .addScaledVector(T, 0.26 + rng() * 0.12)
        .addScaledVector(B, side * (0.10 + (j % 2) * 0.05));
      d.y -= 0.26; // leaflets droop towards the ground
      d.normalize();
      const wAxis = new THREE.Vector3().crossVectors(B, d).normalize();
      const nAxis = new THREE.Vector3().crossVectors(d, wAxis).normalize();
      const partM = new THREE.Matrix4().makeBasis(d, wAxis, nAxis);
      partM.multiply(new THREE.Matrix4().makeRotationX((rng() - 0.5) * 0.5));
      const off = llen * 0.5 - 0.012;
      partM.setPosition(p.x + d.x * off, p.y + d.y * off, d.z * off);
      const leaf = leafletGeo(llen, leafW, spec.leafThick);
      ribBandUV(leaf, llen, leafW, 0.06 + rng() * 0.6, 0.3);
      pushGeo(frondGeos, leaf, m.clone().multiply(partM));
    }
  }
}

// ---------------------------------------------------------------------------
// Detailed (model-stage) palm.
// ---------------------------------------------------------------------------

/**
 * Stage crown envelope of the old 11-plane crown, measured in palm-local metres
 * with `node .scratch/model-detail/inspect.mjs palm`. The detailed crown is
 * fitted back into this box so the stage HUD SIZE (and therefore the map scale)
 * is unchanged instead of the realistic crown silently growing the tree.
 */
const CROWN_BOX = { x: [-1.276, 1.595], y: [1.257, 3.997], z: [-1.274, 1.273] };

/** Fit a set of palm-local geometries into the CROWN_BOX envelope. */
function fitCrown(geos, box) {
  const bounds = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const g of geos) {
    g.computeBoundingBox();
    bounds.union(tmp.copy(g.boundingBox));
  }
  const sx = (box.x[1] - box.x[0]) / Math.max(1e-4, bounds.max.x - bounds.min.x);
  const sy = (box.y[1] - box.y[0]) / Math.max(1e-4, bounds.max.y - bounds.min.y);
  const sz = (box.z[1] - box.z[0]) / Math.max(1e-4, bounds.max.z - bounds.min.z);
  const m = new THREE.Matrix4().makeScale(sx, sy, sz);
  m.setPosition(
    box.x[0] - sx * bounds.min.x,
    box.y[0] - sy * bounds.min.y,
    box.z[0] - sz * bounds.min.z
  );
  for (const g of geos) g.applyMatrix4(m);
}

/** Ring-banded trunk built as one bent lathe (26 raised boot rings). */
function trunkGeoDetailed() {
  const RINGS = 26;
  const profile = [[0, 0], [trunkRadius(0), 0]];
  for (let i = 0; i <= RINGS; i++) {
    const y = (i / RINGS) * TRUNK_H;
    const r = trunkRadius(y);
    profile.push([r, y]);
    if (i < RINGS) {
      const rb = r * 1.075;
      profile.push([rb, y + 0.014]);
      profile.push([rb, y + 0.042]);
    }
  }
  profile.push([0, TRUNK_H]); // closed top (the crown collar sits over it)
  return latheGeo(profile, { segments: 12, tile: 1.1 });
}

/** Dried frond bases / boot scars hugging the trunk. */
function addBootStubs(woodGeos, rng) {
  const count = 18;
  for (let i = 0; i < count; i++) {
    const f = i / (count - 1);
    const y = 0.6 + f * 2.1 + rng() * 0.05;
    const a = f * TAU * 2.35 + rng() * 0.55;
    const r = trunkRadius(y);
    const out = new THREE.Vector3(Math.cos(a) * 0.82, -0.72, Math.sin(a) * 0.82).normalize();
    const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const normal = new THREE.Vector3().crossVectors(out, tangent).normalize();
    const m = new THREE.Matrix4().makeBasis(out, tangent, normal);
    m.setPosition(trunkX(y) + Math.cos(a) * r * 0.72, y, Math.sin(a) * r * 0.72);
    pushGeo(woodGeos, plateGeo(0.16 + rng() * 0.09, 0.085, 0.02, { bevel: 0.006, tile: 1.0 }), m);
  }
}

/** Coconuts tucked under the crown. */
function addCoconuts(woodGeos, rng) {
  const count = 7;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rng() * 0.7;
    const rr = 0.13 + rng() * 0.07;
    const y = CROWN_Y - 0.26 - rng() * 0.12;
    pushGeo(
      woodGeos,
      sphereGeo(0.072 + rng() * 0.016, { segW: 10, segH: 8, tile: 0.8 }),
      new THREE.Matrix4().makeTranslation(trunkX(y) + Math.cos(a) * rr, y, Math.sin(a) * rr)
    );
  }
}

/** A lumpy collar that hides the frond / rachis bases. */
function addCrownCollar(woodGeos) {
  pushGeo(
    woodGeos,
    latheGeo(
      [
        [0, 2.5], [0.08, 2.52], [0.135, 2.58],
        [0.16, 2.66], [0.155, 2.75], [0.115, 2.83], [0.05, 2.9], [0, 2.93],
      ],
      { segments: 12, tile: 0.9 }
    ),
    new THREE.Matrix4().makeTranslation(CROWN_X, 0, 0)
  );
}

/** Random-ish age order so the fronds around the crown mix young / old. */
const FROND_AGE_ORDER = [0, 9, 3, 12, 6, 15, 1, 10, 4, 13, 7, 2, 14, 8, 11, 5];

/**
 * Horizontal crown envelope (palm-local metres). The old crown box is slightly
 * wider in X than in Z, so the fountain is laid out on an ellipse of the same
 * proportions; that keeps the final envelope fit near 1:1 instead of squeezing
 * every frond along one axis.
 */
const CROWN_AX = 1.537;
const CROWN_AZ = 1.349;

/** Radius of the crown envelope along a horizontal yaw direction. */
function crownEnvelope(yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (CROWN_AX * CROWN_AZ) / Math.hypot(CROWN_AZ * c, CROWN_AX * s);
}

/**
 * Frond fountain: young upright fronds in the middle, mature arches that give
 * the crown its width and old drooping fronds underneath. Each frond is solved
 * from its wanted tip position (rise / reach on the crown envelope) and curl,
 * so the raw crown lands within a few cm of CROWN_BOX.
 */
function frondSpecsDetailed(rng) {
  const specs = [];
  const count = FROND_AGE_ORDER.length;
  for (let i = 0; i < count; i++) {
    const age = FROND_AGE_ORDER[i] / (count - 1);
    const yaw = ((i + 0.5) / count) * TAU + (rng() - 0.5) * 0.1;
    const steep = Math.abs(Math.cos(Math.PI * age));
    // the card is a ribbon: on a steep frond its width sticks out sideways, so
    // shorten the arch by that much to keep the overall crown envelope round
    const reach = (crownEnvelope(yaw) - 0.12 - 0.2 * steep) * (0.98 + rng() * 0.05);
    const rise = 1.12 - 2.38 * age + (rng() - 0.5) * 0.06;
    const k = 0.78 + 0.77 * age + (rng() - 0.5) * 0.08;
    // solve the arch: chord D at average elevation m, curvature k
    const chord = Math.hypot(rise, reach);
    const m = Math.atan2(rise, reach);
    const a = chord / (2 * Math.sin(k / 2));
    specs.push({
      yaw,
      th0: m + k / 2,
      k,
      len: a * k,
      baseY: 2.78 - 0.15 * age + (rng() - 0.5) * 0.03,
      cardCols: 12,
      cardRows: 4,
      stations: 16,
      leafLen: 0.36,
      leafW: 0.042,
      leafThick: 0.008,
    });
  }
  return specs;
}

function palmDetailed() {
  const rng = makeRNG(321);
  const frondGeos = [];
  const crownWoodGeos = [];
  const trunkGeos = [];
  pushGeo(trunkGeos, bendTrunk(trunkGeoDetailed()), new THREE.Matrix4());

  addBootStubs(trunkGeos, rng);
  addCoconuts(crownWoodGeos, rng);
  addCrownCollar(crownWoodGeos);

  for (const spec of frondSpecsDetailed(rng)) buildFrondDetailed(frondGeos, crownWoodGeos, spec, rng);

  // The collar and coconuts belong to the crown, so they ride the same fit.
  fitCrown([...frondGeos, ...crownWoodGeos], CROWN_BOX);
  return {
    trunk: mergeList([...trunkGeos, ...crownWoodGeos]),
    crown: mergeList(frondGeos),
  };
}

// ---------------------------------------------------------------------------
// In-game (map) palm: the same silhouette at a fraction of the triangles.
// ---------------------------------------------------------------------------

/** Cheap frond: one curved card, a thin rachis and a sparse row of blades. */
function buildFrondCheap(frondGeos, woodGeos, spec, rng) {
  const { yaw, th0, k, len, baseY, stations } = spec;
  rachisGeo(woodGeos, th0, k, len, baseY, yaw, 0.026, 0.006, 2);
  pushGeo(frondGeos, cardGeo(th0, k, len, 5, 2), frondM(yaw, baseY));

  for (let j = 0; j < stations; j++) {
    const t = 0.16 + (j / (stations - 1)) * 0.8;
    const p = arcPoint(th0, k, len, t);
    const T = new THREE.Vector3(Math.cos(p.angle), Math.sin(p.angle), 0);
    const N = new THREE.Vector3(-Math.sin(p.angle), Math.cos(p.angle), 0);
    const B = new THREE.Vector3(0, 0, 1);
    const llen = 0.3 * (0.62 + 0.58 * Math.sin(Math.PI * Math.min(1, t + 0.06)));
    for (const side of [-1, 1]) {
      const d = N.clone().multiplyScalar(side * 0.95).addScaledVector(T, 0.30);
      d.y -= 0.26;
      d.normalize();
      const wAxis = new THREE.Vector3().crossVectors(B, d).normalize();
      const nAxis = new THREE.Vector3().crossVectors(d, wAxis).normalize();
      const partM = new THREE.Matrix4().makeBasis(d, wAxis, nAxis);
      partM.setPosition(p.x + d.x * (llen * 0.5 - 0.01), p.y + d.y * (llen * 0.5 - 0.01), d.z * (llen * 0.5 - 0.01));
      const blade = new THREE.PlaneGeometry(llen, 0.05);
      ribBandUV(blade, llen, 0.05, 0.1 + rng() * 0.5, 0.3);
      pushGeo(frondGeos, blade, frondM(yaw, baseY).multiply(partM));
    }
  }
}

function palmCheap() {
  const rng = makeRNG(321);
  const frondGeos = [];
  const crownWoodGeos = [];
  const trunkGeos = [];
  pushGeo(
    trunkGeos,
    bendTrunk(new THREE.CylinderGeometry(TRUNK_R_TOP, TRUNK_R_BOTTOM, TRUNK_H, 10, 4).translate(0, TRUNK_H / 2, 0)),
    new THREE.Matrix4()
  );

  // a few proud ring bands so the in-game trunk still reads as a palm
  for (let i = 0; i < 6; i++) {
    const y = 0.35 + i * 0.4;
    pushGeo(
      trunkGeos,
      torusGeo(trunkRadius(y) * 1.02, 0.013, { radialSeg: 4, tubularSeg: 12, tile: 1.1 }),
      new THREE.Matrix4()
        .makeTranslation(trunkX(y), y, 0)
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    );
  }
  for (let i = 0; i < 4; i++) {
    const a = i * 2.1 + 0.4;
    const y = CROWN_Y - 0.16 - (i % 2) * 0.05;
    pushGeo(
      crownWoodGeos,
      sphereGeo(0.07, { segW: 8, segH: 6, tile: 0.8 }),
      new THREE.Matrix4().makeTranslation(trunkX(y) + Math.cos(a) * 0.14, y, Math.sin(a) * 0.14)
    );
  }
  for (const spec of frondSpecsDetailed(rng)) {
    buildFrondCheap(
      frondGeos,
      crownWoodGeos,
      { ...spec, stations: 5 },
      rng
    );
  }
  return {
    trunk: mergeList([...trunkGeos, ...crownWoodGeos]),
    crown: mergeList(frondGeos),
  };
}

/**
 * Palm tree family (bent trunk + frond crown).
 * Split out of world.js buildInstancedProps.
 */
function buildPalmFamily(ctx) {
  const L = ctx.data.layout;
  const M = ctx.materials;
  const palmItems = L.palms;
  const { trunk, crown } = isPreview(ctx) ? palmDetailed() : palmCheap();
  const items = palmItems.map((p) => ({ x: p.x, z: p.z, y: 0, ry: p.ry, s: p.s }));
  makeInstanced(ctx, trunk, M.palmTrunk ?? M.bark, items, 'palm-trunks', 'wood', { seed: 44 });
  makeInstanced(ctx, crown, M.frond, items, 'palm-crowns', 'wood', { seed: 45 });
}
