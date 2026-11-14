/**
 * COCONUT PALM — F2 (see ISLAND_ASSETS.md §2.1).
 *
 * An 8.5 m coconut palm for the island beach and the light gaps in the jungle. Rebuilt
 * with 2 seeded variants (the map alternates them), real saw-tooth *geometry* leaf scars
 * instead of painted V-bands, a crown of 14-18 lush drooping fronds (painted ribbon card
 * + geometric leaflets), a visible coconut cluster and 2 dead fronds still hanging off
 * the bole.
 *
 * Collision contract (NOT to change — `formats/v2.js#coconutPalmFootprint` mirrors it):
 *   - trunk centre line = `trunkDx/trunkDz` (the beach sweep towards +X);
 *   - trunk radius = `trunkR` (0.31 at the litter, 0.20 under the crown), two collision
 *     bands 0-2 m and 2-6.6 s. Both are kept byte-identical to the shipped palm.
 *
 * Rules honoured here: metres, +Y up, base on y=0 within ±0.05, fronds on the
 * `frondLush` material (`tropicalFrond` texture, legacy palm UV layout), bark on
 * `barkTrop`, nuts on `barkMoss`, all randomness from one fixed-seed `makeRNG()`.
 */
import * as THREE from 'three';
import { makeInstanced, mergeGeometries, transformed, bakeVertexAO, TAU } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { isPreview, cylGeo, latheGeo, plateGeo, sphereGeo } from '../detail.js';

export const meta = { id: 'coconut-palm', kind: 'world', group: 'flora', label: '椰子树 · COCONUT PALM' };

/** Preview builder (stage/WebUI): one hero palm (variant 0) on a sample layout. */
export function build(ctx) {
  // ry 0: the stage reports an axis-aligned extent, and a yaw-rotated palm would
  // report a much wider footprint than the crown actually has.
  island(ctx).coconutPalms = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildCoconutPalms(ctx, true);
}

/** Map assembly builder: instances every palm from ctx.data.layout. */
export function buildWorld(ctx) {
  buildCoconutPalms(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

// ---------------------------------------------------------------------------
// measurements / skeleton (mirrored by the collision format: do not retune)
// ---------------------------------------------------------------------------

const TRUNK_H = 7.46; // trunk length before the crown collar (m)
const CROWN_Y = 7.34; // where the fronds fan out
const HEIGHT_LIMIT = 7.92; // tallest leaf tip (stage size target is 8.5 m)

/** Trunk centre-line: the classic beach palm sweep (leans out over the water). */
function trunkDx(y) {
  const t = Math.max(0, y) / TRUNK_H;
  return 1.24 * Math.pow(t, 1.62) + 0.04 * t;
}
function trunkDz(y) {
  const t = Math.max(0, y) / TRUNK_H;
  return 0.22 * Math.pow(t, 2.2);
}

/** Trunk radius: slightly swollen base, slim shaft under the crown. */
function trunkR(y) {
  const t = Math.max(0, y) / TRUNK_H;
  return (0.25 - 0.085 * t) * (1 + 0.24 * Math.pow(1 - t, 6));
}

// ---------------------------------------------------------------------------
// variants
// ---------------------------------------------------------------------------

/**
 * Two palms that share the collision-critical skeleton but read differently: frond
 * count / sweep, leaf-scar spacing, boot beard, coconut load and crown tilt.
 */
const PALM_VARIANTS = [
  {
    id: 'palm-a',
    seed: 0x9e11,
    fronds: 17,
    bandGap: 0.235, // leaf scars every ~23 cm
    bandShade: 0.16,
    boots: 9,
    trunkTags: 6,
    nuts: 7,
    dead: 2,
    crownTilt: 0.06,
    frondReach: 1.0,
    frondK: 1.0,
  },
  {
    id: 'palm-b',
    seed: 0x3fa5,
    fronds: 18,
    bandGap: 0.265,
    bandShade: 0.2,
    boots: 11,
    trunkTags: 4,
    nuts: 8,
    dead: 2,
    crownTilt: -0.08,
    frondReach: 1.06,
    frondK: 1.12,
  },
];

const FROND_ORDER = [0, 9, 4, 13, 2, 11, 6, 15, 1, 8, 5, 14, 3, 12, 7, 10, 17, 16];

// ---------------------------------------------------------------------------
// local geometry kit (kept inside the model file: one model = one file)
// ---------------------------------------------------------------------------

const _m4 = new THREE.Matrix4();

/** Append a transformed copy of `geo` to a build list and release the source. */
function pushGeo(list, geo, matrix) {
  list.push(transformed(geo, matrix ?? _m4.identity()));
  geo.dispose();
}

/** Merge a build list into one geometry and release the temporary parts. */
function mergeList(list) {
  const merged = mergeGeometries(list);
  for (const g of list) g.dispose();
  list.length = 0;
  return merged;
}

/**
 * Sweep a stack of circular rings (bottom -> top) into a tube.
 * Normals follow the ring slope, so the scar lips shade as real ridges.
 */
function ringSweep(rings, { radial = 12, tile = 1.6, capTop = false, capBottom = false } = {}) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const stride = radial + 1;
  let vAcc = 0;
  let prev = rings[0];
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    const dy = ring.y - prev.y;
    const dr = ring.r - prev.r;
    const slope = dr / Math.max(1e-4, Math.abs(dy));
    const nl = Math.hypot(1, slope);
    if (i > 0) vAcc += Math.hypot(dy, dr);
    const circ = TAU * ring.r;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pos.push(ring.dx + ca * ring.r, ring.y, ring.dz + sa * ring.r);
      nor.push(ca / nl, -slope / nl, sa / nl);
      uv.push(((j / radial) * circ) / tile, vAcc / tile);
    }
    prev = ring;
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a0 = i * stride + j;
      const a1 = a0 + 1;
      const b0 = a0 + stride;
      const b1 = b0 + 1;
      idx.push(a0, b1, a1, a0, b0, b1);
    }
  }
  const cap = (i, up) => {
    const ring = rings[i];
    const base = i * stride;
    const c = pos.length / 3;
    pos.push(ring.dx, ring.y, ring.dz);
    nor.push(0, up ? 1 : -1, 0);
    uv.push(0.1, 0.1);
    for (let j = 0; j < radial; j++) {
      const a0 = base + j;
      const a1 = base + j + 1;
      if (up) idx.push(c, a1, a0);
      else idx.push(c, a0, a1);
    }
  };
  if (capTop) cap(rings.length - 1, true);
  if (capBottom) cap(0, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

// ---------------------------------------------------------------------------
// trunk with real leaf-scar geometry
// ---------------------------------------------------------------------------

/**
 * Coconut trunk skeleton: a stack of rings whose radius carries a saw-tooth
 * "leaf-base lip" every `bandGap` metres. Each scar is a 4-ring profile:
 * quiet bark -> protruding lip (6-9 cm tall) -> recessed groove -> quiet bark.
 * This is real geometry (normals shade it), not the old painted horizontal bands
 * that produced the V-shaped smears.
 */
function trunkGeo(hi, variant) {
  const radial = hi ? 12 : 9;
  const gap = variant.bandGap;
  const rings = [{ y: -0.04, r: trunkR(0) * 1.05, dx: 0, dz: 0 }];
  const steps = Math.max(9, Math.round((TRUNK_H - 0.1) / gap));
  for (let b = 0; b < steps; b++) {
    const y0 = 0.02 + b * gap;
    const y1 = Math.min(TRUNK_H - 0.06, y0 + gap);
    if (y1 <= y0) break;
    const span = y1 - y0;
    const rt = (y) => trunkR(y);
    const dx = (y) => trunkDx(y);
    const dz = (y) => trunkDz(y);
    const lipH = Math.min(0.085, span * 0.36);
    // 1) bark of the band (slight taper)
    rings.push({ y: y0, r: rt(y0), dx: dx(y0), dz: dz(y0) });
    // 2) lip rises: overhanging crown of the old leaf base
    rings.push({ y: y0 + lipH * 0.55, r: rt(y0) * 1.055, dx: dx(y0 + lipH * 0.55), dz: dz(y0 + lipH * 0.55) });
    rings.push({ y: y0 + lipH, r: rt(y0 + lipH) * 1.028, dx: dx(y0 + lipH), dz: dz(y0 + lipH) });
    // 3) tucked groove above the lip
    rings.push({ y: y0 + lipH * 1.5, r: rt(y0 + lipH * 1.5) * 0.982, dx: dx(y0 + lipH * 1.5), dz: dz(y0 + lipH * 1.5) });
    // 4) back to bark just below the next scar
    if (y1 < TRUNK_H - 0.08) rings.push({ y: y1, r: rt(y1), dx: dx(y1), dz: dz(y1) });
  }
  rings.push({ y: TRUNK_H, r: trunkR(TRUNK_H) * 0.86, dx: trunkDx(TRUNK_H), dz: trunkDz(TRUNK_H) });
  return ringSweep(rings, { radial, tile: 1.35 });
}

/** Dry leaf-base boots: the hanging "beard" under the crown collar. */
function addBoots(bark, rng, variant) {
  const count = variant.boots;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rng() * 0.35;
    const y = TRUNK_H - 0.3 - rng() * 0.16;
    const r = trunkR(y);
    const drop = 0.3 + rng() * 0.22;
    const out = new THREE.Vector3(Math.cos(a) * 0.72, -1, Math.sin(a) * 0.72).normalize();
    const tan = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const nrm = new THREE.Vector3().crossVectors(out, tan).normalize();
    const m = new THREE.Matrix4().makeBasis(out, tan, nrm);
    m.setPosition(
      trunkDx(y) + Math.cos(a) * (r * 0.9 + 0.02),
      y - drop * 0.18,
      trunkDz(y) + Math.sin(a) * (r * 0.9 + 0.02)
    );
    pushGeo(bark, plateGeo(0.2 + rng() * 0.1, drop, 0.02, { bevel: 0.005, tile: 0.9 }), m);
  }
  // older boot scars lower down the trunk: small fibrous tags hugging the bark
  for (let i = 0; i < variant.trunkTags; i++) {
    const f = i / Math.max(1, variant.trunkTags - 1);
    const y = 1.2 + f * 5.0 + rng() * 0.1;
    const a = f * TAU * 2.2 + rng() * 0.6;
    const r = trunkR(y);
    const out = new THREE.Vector3(Math.cos(a) * 0.97, -0.24, Math.sin(a) * 0.97).normalize();
    const tan = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const nrm = new THREE.Vector3().crossVectors(out, tan).normalize();
    const m = new THREE.Matrix4().makeBasis(out, tan, nrm);
    m.setPosition(trunkDx(y) + Math.cos(a) * r * 0.98, y, trunkDz(y) + Math.sin(a) * r * 0.98);
    pushGeo(bark, plateGeo(0.11 + rng() * 0.05, 0.065, 0.013, { bevel: 0.004, tile: 0.9 }), m);
  }
}

/** Crown collar: the fibrous mass the frond bases erupt from. */
function addCollar(bark, rng, variant) {
  const cx = trunkDx(CROWN_Y);
  const cz = trunkDz(CROWN_Y);
  pushGeo(
    bark,
    latheGeo(
      [
        [0.02, -0.14],
        [0.16, -0.11],
        [0.22, -0.02],
        [0.24, 0.11],
        [0.2, 0.24],
        [0.12, 0.33],
        [0.04, 0.38],
      ],
      { segments: 12, tile: 1.1 }
    ),
    new THREE.Matrix4().makeTranslation(cx, CROWN_Y - 0.07, cz)
  );
  // dry sheath flags poking out of the collar
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + rng() * 0.4;
    const y = CROWN_Y - 0.06 + rng() * 0.16;
    const out = new THREE.Vector3(Math.cos(a) * 0.9, 0.28, Math.sin(a) * 0.9).normalize();
    const tan = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const nrm = new THREE.Vector3().crossVectors(out, tan).normalize();
    const m = new THREE.Matrix4().makeBasis(out, tan, nrm);
    m.setPosition(cx + Math.cos(a) * 0.2, y, cz + Math.sin(a) * 0.2);
    pushGeo(bark, plateGeo(0.18, 0.09, 0.016, { bevel: 0.005, tile: 0.9 }), m);
  }
}

/** Coconut cluster tucked under the crown collar, hanging into view below the boots. */
function addCoconuts(nuts, rng, variant) {
  const cx = trunkDx(CROWN_Y);
  const cz = trunkDz(CROWN_Y);
  const count = variant.nuts;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rng() * 0.5;
    const ring = i < 4 ? 0.28 : 0.2;
    const rr = ring + rng() * 0.1;
    const y = CROWN_Y - 0.5 - (i < 4 ? 0 : 0.16) - rng() * 0.12;
    const r = 0.108 + rng() * 0.026;
    const nut = sphereGeo(r, { segW: 8, segH: 6, tile: 0.7 });
    nut.scale(1, 1.16, 1);
    pushGeo(nuts, nut, new THREE.Matrix4().makeTranslation(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr));
  }
  // a couple of older brown nuts hanging lower on the far side
  for (let i = 0; i < 2; i++) {
    const a = 2.4 + i * 0.5;
    const nut = sphereGeo(0.095, { segW: 7, segH: 5, tile: 0.7 });
    nut.scale(1, 1.1, 1);
    pushGeo(nuts, nut, new THREE.Matrix4().makeTranslation(cx + Math.cos(a) * 0.28, CROWN_Y - 0.74, cz + Math.sin(a) * 0.28));
  }
}

// ---------------------------------------------------------------------------
// fronds (legacy palm UV layout: painted ribbon card + opaque rib leaflets)
// ---------------------------------------------------------------------------

/**
 * Point on a frond arc at normalised distance t.
 * The midrib leaves the crown at elevation `th0` and curls by `k` radians over the
 * whole arc length `len`; +X is radial, +Y up.
 */
function arcPoint(th0, k, len, t) {
  const a = th0 - k * t;
  const sag = len / k;
  return { x: sag * (Math.sin(th0) - Math.sin(a)), y: sag * (Math.cos(a) - Math.cos(th0)), angle: a };
}

/** Matrix that places a frond (built in local XY) on the crown at `yaw`. */
function frondMatrix(yaw, tilt) {
  return new THREE.Matrix4()
    .makeTranslation(trunkDx(CROWN_Y), CROWN_Y, trunkDz(CROWN_Y))
    .multiply(new THREE.Matrix4().makeRotationY(yaw))
    .multiply(new THREE.Matrix4().makeRotationZ(tilt));
}

/** Tapered tube following the frond arc (the rachis / leaf stem). */
function rachisGeo(th0, k, len, r0, r1, { segments = 5, radial = 5 } = {}) {
  const stride = radial + 1;
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * 0.97;
    const p = arcPoint(th0, k, len, t);
    const N = { x: -Math.sin(p.angle), y: Math.cos(p.angle) };
    const r = r0 + (r1 - r0) * (i / segments);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const cx = N.x * Math.cos(a);
      const cy = N.y * Math.cos(a);
      const cz = Math.sin(a);
      pos.push(p.x + cx * r, p.y + cy * r, cz * r);
      nor.push(cx, cy, cz);
      uv.push((j / radial) * (TAU * r) / 1.2, (t * len) / 1.2);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a0 = i * stride + j;
      const a1 = a0 + 1;
      const b0 = a0 + stride;
      const b1 = b0 + 1;
      idx.push(a0, b1, a1, a0, b0, b1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * The painted frond ribbon: a leaf-shaped card following the arc.
 * U runs along the frond, V across it — the legacy palm UV layout, so the
 * `tropicalFrond` texture paints its leaflet fan onto the card.
 */
function frondCardGeo(th0, k, len, segs, rows) {
  const stride = rows + 1;
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = arcPoint(th0, k, len, t);
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    const wide = 0.16 + 0.7 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.04)), 0.8) + 0.05 * (1 - t);
    const bow = 0.05 + 0.05 * Math.sin(Math.PI * t);
    for (let j = 0; j <= rows; j++) {
      const s = j / rows - 0.5;
      pos.push(p.x + nx * s * wide, p.y + ny * s * wide, bow * s * 2);
      nor.push(0, 0, 1);
      uv.push(0.04 + 0.92 * t, j / rows);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < rows; j++) {
      const a0 = i * stride + j;
      const a1 = a0 + 1;
      const b0 = a0 + stride;
      const b1 = b0 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Map a leaflet strip onto the opaque central rib band of the frond texture.
 * Same trick as `src/models/world/palm.js`'s ribBandUV: leaflet plates are drawn
 * over the painted rib so alpha-testing never eats them.
 */
function leafletUV(geo, len, wid, u0, uSpan) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = u0 + (pos.getX(i) / len) * uSpan;
    const t = Math.max(0, Math.min(1, (u * 256 - 10) / 238));
    const v = 0.5 + 0.09375 * t * (1 - t) + (pos.getY(i) / wid) * 0.006;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Tapered, slightly arched leaflet blade in local XY (X = out along the leaflet). */
function leafletGeo(len, wid, { segs = 2, droop = 0.2 } = {}) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = wid * (1 - t * t * 0.92);
    const x = len * t;
    const z = -droop * len * t * t;
    pos.push(x, -w * 0.5, z, x, w * 0.5, z);
    nor.push(0, 0, 1, 0, 0, 1);
    uv.push(t, 0, t, 1);
  }
  for (let i = 0; i < segs; i++) {
    const a0 = i * 2;
    idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return leafletUV(geo, len, wid, 0.06, 0.86);
}

/** Age order so the crown mixes young upright and old drooping fronds. */
function frondSpecs(hi, variant) {
  const rng = makeRNG(variant.seed);
  const specs = [];
  for (let i = 0; i < variant.fronds; i++) {
    const age = FROND_ORDER[i % FROND_ORDER.length] / (FROND_ORDER.length - 1);
    const yaw = ((i + 0.5) / variant.fronds) * TAU + (rng() - 0.5) * 0.14;
    // young fronds stand up and reach short, old ones droop far over the beach
    const riseTarget = 0.46 - 2.25 * age + (rng() - 0.5) * 0.06;
    const reachTarget = (1.24 + 0.56 * Math.sin(Math.PI * (0.22 + 0.68 * (1 - age))) + (rng() - 0.5) * 0.08) * variant.frondReach;
    const k = (0.78 + 0.9 * age + (rng() - 0.5) * 0.1) * variant.frondK;
    const chord = Math.hypot(riseTarget, reachTarget);
    const m = Math.atan2(riseTarget, reachTarget);
    const radius = chord / (2 * Math.sin(k / 2));
    const len = radius * k;
    const th0 = m + k / 2;
    specs.push({
      yaw,
      th0,
      k,
      len,
      age,
      cardSegs: hi ? 11 : 7,
      cardRows: hi ? 2 : 2,
      stations: hi ? 9 : 5,
      leafLen: 0.42,
      leafW: 0.058,
    });
  }
  return specs;
}

/** One frond: rachis + painted card + two rows of geometric leaflets. */
function addFrond(wood, fronds, spec, rng, variant) {
  const { yaw, th0, k, len } = spec;
  const base = frondMatrix(yaw, variant.crownTilt);
  pushGeo(wood, rachisGeo(th0, k, len, 0.034, 0.007, { segments: 4, radial: 4 }), base);
  pushGeo(fronds, frondCardGeo(th0, k, len, spec.cardSegs, spec.cardRows), base);
  const B = new THREE.Vector3(0, 0, 1);
  for (let j = 0; j < spec.stations; j++) {
    const t = 0.12 + (j / (spec.stations - 1)) * 0.84;
    const p = arcPoint(th0, k, len, t);
    const T = new THREE.Vector3(Math.cos(p.angle), Math.sin(p.angle), 0);
    const N = new THREE.Vector3(-Math.sin(p.angle), Math.cos(p.angle), 0);
    const scale = 0.48 + 0.62 * Math.sin(Math.PI * Math.min(1, t + 0.06));
    for (const side of [-1, 1]) {
      const llen = spec.leafLen * scale * (0.9 + rng() * 0.2);
      const d = N.clone()
        .multiplyScalar(side * (0.88 + rng() * 0.1))
        .addScaledVector(T, 0.32 + rng() * 0.1)
        .addScaledVector(B, side * (0.06 + (j % 2) * 0.05));
      d.y -= 0.45; // leaflets hang below the frond plane
      d.normalize();
      const wAxis = new THREE.Vector3().crossVectors(B, d).normalize();
      const nAxis = new THREE.Vector3().crossVectors(d, wAxis).normalize();
      const partM = new THREE.Matrix4().makeBasis(d, wAxis, nAxis);
      partM.multiply(new THREE.Matrix4().makeRotationX((rng() - 0.5) * 0.4));
      const off = llen * 0.42;
      partM.setPosition(p.x + d.x * off, p.y + d.y * off, d.z * off);
      pushGeo(fronds, leafletGeo(llen * 0.8, spec.leafW * (0.9 + rng() * 0.3), { segs: 2, droop: 0.16 }), base.clone().multiply(partM));
    }
  }
}

// ---------------------------------------------------------------------------
// build one variant
// ---------------------------------------------------------------------------

function palmGeometry(hi, variant) {
  const rng = makeRNG(variant.seed ^ 0x5c0c);
  const wood = [];
  const fronds = [];
  const nuts = [];

  pushGeo(wood, trunkGeo(hi, variant));
  const trunkVerts = wood[0].attributes.position.count;
  addBoots(wood, rng, variant);
  addCollar(wood, rng, variant);
  addCoconuts(nuts, rng, variant);

  for (const spec of frondSpecs(hi, variant)) addFrond(wood, fronds, spec, rng, variant);

  // dead fronds still hanging off the trunk, collapsed against it
  const deadCount = hi ? variant.dead + 1 : variant.dead;
  for (let i = 0; i < deadCount; i++) {
    const yaw = 2.2 + i * 0.9;
    const th0 = -0.34 - i * 0.12;
    const k = 1.5;
    const len = 1.5 - i * 0.18;
    const base = frondMatrix(yaw, 0).multiply(new THREE.Matrix4().makeTranslation(0, -0.55 - i * 0.1, 0));
    pushGeo(wood, rachisGeo(th0, k, len, 0.026, 0.005, { segments: 3, radial: 3 }), base);
    pushGeo(fronds, frondCardGeo(th0, k, len, hi ? 7 : 4, 2), base);
  }

  // leaf-scar AO: darken the underside of every scar lip (build-time vertex colour)
  const bark = mergeList(wood);
  tintScarUnderside(bark, trunkVerts, variant);
  bakeVertexAO(bark, { ground: 4.2, floor: 0.94, noise: 0.03, seed: 21 });
  const coco = bakeVertexAO(mergeList(nuts), { ground: 5.0, floor: 0.82, noise: 0.06, seed: 23 });
  const frond = mergeList(fronds);

  // Rest the lowest point on the ground plane (dead-frond tips may touch the soil).
  const geos = [bark, coco, frond].filter(Boolean);
  let minY = Infinity;
  for (const g of geos) {
    const pos = g.attributes.position;
    for (let i = 1; i < pos.array.length; i += 3) if (pos.array[i] < minY) minY = pos.array[i];
  }
  if (Number.isFinite(minY) && Math.abs(minY) > 1e-4) {
    for (const g of geos) g.translate(0, -minY, 0);
  }
  return { bark, coco, frond };
}

/**
 * Paint the groove right above each scar lip darker (it is a geometric notch, but a
 * little baked contact shadow is what makes the rings read at 10 m).
 */
function tintScarUnderside(geo, trunkVerts, variant) {
  const color = geo.attributes.color;
  if (!color) return geo;
  const pos = geo.attributes.position;
  const gap = variant.bandGap;
  for (let i = 0; i < trunkVerts; i++) {
    const y = pos.getY(i);
    const phase = (((y - 0.02) % gap) + gap) % gap / gap;
    let f = 1;
    if (phase < 0.12) f = 0.93; // tucked groove above the previous lip
    else if (phase < 0.3) f = 0.98;
    if (f !== 1) {
      color.setXYZ(
        i,
        Math.min(1.2, color.getX(i) * f),
        Math.min(1.2, color.getY(i) * f),
        Math.min(1.2, color.getZ(i) * f)
      );
    }
  }
  color.needsUpdate = true;
  return geo;
}

// ---------------------------------------------------------------------------
// instancing
// ---------------------------------------------------------------------------

function buildCoconutPalms(ctx, preview) {
  const items = (island(ctx).coconutPalms || []).map((p) => ({
    x: p.x,
    z: p.z,
    y: p.y ?? 0,
    ry: p.ry ?? 0,
    s: p.s ?? 1,
  }));
  if (!items.length) return;
  const M = ctx.materials;
  const stage = preview || isPreview(ctx);
  const quality = ctx.quality || 'high';
  // low tiers keep one variant (draw calls), the higher tiers alternate two
  const variantCount = stage ? 1 : quality === 'lowest' || quality === 'low' ? 1 : 2;
  const lodHi = stage;

  for (let v = 0; v < variantCount; v++) {
    const variant = PALM_VARIANTS[v % PALM_VARIANTS.length];
    const geo = palmGeometry(lodHi, variant);
    const bucket = [];
    for (let i = v; i < items.length; i += variantCount) bucket.push(items[i]);
    if (!bucket.length) continue;
    const name = `coconut-palm-${v}`;
    const woodOpts = { seed: 47 + v * 17, castShadow: true };
    // the lowest tier drops the frond shadow map (matches the jungle-tree leaf policy)
    const frondOpts = { seed: 61 + v * 19, castShadow: quality !== 'lowest' };
    if (geo.bark) makeInstanced(ctx, geo.bark, M.barkTropLight || M.barkTrop, bucket, `${name}-trunk`, 'wood', woodOpts);
    if (geo.coco) makeInstanced(ctx, geo.coco, M.barkMoss, bucket, `${name}-nuts`, 'wood', woodOpts);
    if (geo.frond) makeInstanced(ctx, geo.frond, M.frondLush, bucket, `${name}-fronds`, 'fabric', frondOpts);
  }
}
