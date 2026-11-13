import * as THREE from 'three';
import { makeInstanced, mergeGeometries, transformed, matrixFor } from '../core.js';
import { makeRNG } from '../../utils.js';

export const meta = { id: 'sacks', kind: 'world', group: 'clutter', label: '楹昏鍫?路 SACK PILE' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildSackFamily(ctx, true);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildSackFamily(ctx, false);
}

// ---------------------------------------------------------------------------
// Burlap sack geometry
//
// One merged BufferGeometry (body + gathered neck + cinched rope tie + knot rope
// ends + floppy ears) so the whole sack instances with a single draw / material.
// Dimensions: 0.60 m wide, 0.41 m deep, ~1.06 m tall, flat weighted bottom.
// ---------------------------------------------------------------------------
const SACK = {
  halfX: 0.30,          // body half width  -> 0.60 m wide
  halfY: 0.41,          // body half height -> body 0.82 m, ~1.05 m with neck/ears
  halfZ: 0.205,         // body half depth  -> 0.41 m deep
  exp: 3.0,             // superellipsoid exponent (rounded rectangular body)
  tile: 0.55,           // metres per texture tile -> ~9 mm burlap weave
  uRep: 3.45,           // texture repeats around the body
};

/** The albedo's dark rope strand (one of the drawn sack "tied ends") for the cinch.
 *  v is flipped because CanvasTextures default to flipY = true. */
const ROPE_UV = { u: 0.1395, v0: 0.815, vSpan: 0.125 };

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Cylindrical UVs: u follows the geometry's own angular parametrisation, v is world y. */
function cylindricalUV(geo, { uRep = SACK.uRep, tile = SACK.tile, vOffset = 0 } = {}) {
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uRep, pos.getY(i) / tile + vOffset);
  uv.needsUpdate = true;
  return geo;
}

/** Rounded, slightly slumped burlap body with a flat weighted bottom. */
function makeSackBody() {
  const geo = new THREE.SphereGeometry(1, 22, 16);
  const pos = geo.attributes.position;
  const { halfX: HX, halfY: HY, halfZ: HZ, exp: N } = SACK;
  const bodyH = HY * 2;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i);
    const dy = pos.getY(i);
    const dz = pos.getZ(i);
    // map the unit sphere direction onto a superellipsoid (rounded box-ish silhouette)
    const t = Math.pow(
      Math.pow(Math.abs(dx) / HX, N) + Math.pow(Math.abs(dy) / HY, N) + Math.pow(Math.abs(dz) / HZ, N),
      -1 / N,
    );
    let x = dx * t;
    let z = dz * t;
    let y = Math.max(0, dy * t + HY); // 0 (bottom) to 0.82 (top)
    const ang = Math.atan2(z, x);
    // soft flat bottom: gather the lower cap onto the contact plane
    if (y < 0.12) y = 0.12 * Math.pow(y / 0.12, 2.4);
    // weighted belly just above the floor
    let hscale = 1 + 0.07 * Math.exp(-Math.pow((y - 0.24) / 0.18, 2));
    // gathered shoulders narrowing into the neck
    if (y > 0.60) hscale *= 1 - 0.70 * smooth01((y - 0.60) / (bodyH - 0.60));
    // low-frequency fabric folds + a little slump asymmetry
    hscale *= 1 + 0.026 * Math.sin(ang * 3 + y * 4.6 + 0.8) + 0.016 * Math.sin(ang * 5 - y * 4.1 + 2.1);
    hscale *= 1 + 0.012 * Math.sin(y * 6.1 + 1.3);
    x *= hscale;
    z *= hscale;
    // the sack settles onto one hip
    x += 0.030 * Math.pow(y / bodyH, 2);
    z += 0.018 * Math.pow(y / bodyH, 2);
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  cylindricalUV(geo);
  const out = transformed(geo, matrixFor(0, 0, 0));
  geo.dispose();
  return out;
}

/** Gathered neck: lathe profile from inside the shoulders up to the closed top. */
function makeSackNeck() {
  const profile = [
    [0.200, 0.555],
    [0.172, 0.660],
    [0.138, 0.750],
    [0.110, 0.820],
    [0.097, 0.866],
    [0.092, 0.898], // waist under the cinch band
    [0.108, 0.932],
    [0.124, 0.966], // soft gathered rim
    [0.120, 0.986],
    [0.070, 1.000],
    [0.004, 1.006],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(profile, 16);
  geo.computeVertexNormals();
  cylindricalUV(geo);
  const out = transformed(geo, matrixFor(0, 0, 0));
  geo.dispose();
  return out;
}

/** Cinched rope band around the neck + knot, UV-locked to the texture's dark rope strand. */
function makeSackTie() {
  const geos = [];
  const band = new THREE.TorusGeometry(0.098, 0.025, 6, 18);
  band.rotateX(Math.PI / 2);
  band.translate(0, 0.898, 0);
  const uv = band.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const around = uv.getX(i); // tubular direction -> runs along the dark strand
    const tube = uv.getY(i); // around the rope -> samples across the strand
    uv.setXY(i, ROPE_UV.u + (tube - 0.5) * 0.007, ROPE_UV.v0 + around * ROPE_UV.vSpan);
  }
  geos.push(transformed(band, matrixFor(0, 0, 0)));
  band.dispose();

  // knot at the front of the tie, plus the two rope ends that hang from it
  const knot = new THREE.SphereGeometry(0.038, 10, 8);
  knot.scale(1.15, 0.85, 0.95);
  const kuv = knot.attributes.uv;
  for (let i = 0; i < kuv.count; i++) {
    kuv.setXY(i, ROPE_UV.u + (kuv.getX(i) - 0.5) * 0.004, ROPE_UV.v0 + kuv.getY(i) * 0.05);
  }
  geos.push(transformed(knot, matrixFor(0.088, 0.898, 0.05)));
  knot.dispose();

  for (const [dx, dz, tilt] of [[-0.02, 0.012, 0.10], [0.028, -0.02, -0.16]]) {
    const g = new THREE.CylinderGeometry(0.014, 0.009, 0.15, 5, 1, true);
    const ruv = g.attributes.uv;
    for (let i = 0; i < ruv.count; i++) {
      ruv.setXY(i, ROPE_UV.u + (ruv.getX(i) - 0.5) * 0.006, ROPE_UV.v0 + ruv.getY(i) * ROPE_UV.vSpan * 0.45);
    }
    geos.push(transformed(g, matrixFor(0.092 + dx, 0.828, 0.052 + dz, tilt, 0.6, tilt * 0.6)));
    g.dispose();
  }
  return geos;
}

/** Floppy folded fabric ears draped over the gathered rim. */
function makeSackEars() {
  const geos = [];
  const ears = [
    { ang: 0.35, tilt: 2.15, sx: 0.104, sy: 0.185, sz: 0.036, roll: 0.18 },
    { ang: 2.30, tilt: 2.42, sx: 0.088, sy: 0.155, sz: 0.032, roll: -0.28 },
    { ang: 4.15, tilt: 1.95, sx: 0.096, sy: 0.170, sz: 0.034, roll: 0.45 },
  ];
  for (const ear of ears) {
    const g = new THREE.SphereGeometry(1, 10, 8);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vy = p.getY(i);
      // taper the free end into a soft rounded fold instead of a cone
      const taper = 1 - 0.28 * Math.max(0, vy);
      p.setXYZ(i, p.getX(i) * taper, p.getY(i), p.getZ(i) * taper);
    }
    g.scale(ear.sx, ear.sy, ear.sz);
    cylindricalUV(g, { uRep: 2.4 });
    // local +Y ear, tipped outwards/flat (tilt ~pi/2 = sticking out, floppy)
    const m = matrixFor(
      Math.cos(ear.ang) * 0.086, 0.988, Math.sin(ear.ang) * 0.086,
      0, Math.PI / 2 - ear.ang + ear.roll, 0,
      1, 1, 1,
    ).multiply(new THREE.Matrix4().makeRotationX(ear.tilt));
    geos.push(transformed(g, m));
    g.dispose();
  }
  return geos;
}

/** Build the single merged sack geometry, origin at the (flat) bottom centre. */
function makeSackGeometry() {
  const parts = [makeSackBody(), makeSackNeck(), ...makeSackTie(), ...makeSackEars()];
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  merged.computeBoundingBox();
  merged.translate(0, -merged.boundingBox.min.y, 0);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

// ---------------------------------------------------------------------------
// Pile layout
// ---------------------------------------------------------------------------

const _gv = new THREE.Vector3();
const _gq = new THREE.Quaternion();
const _ge = new THREE.Euler();

/**
 * Drop/raise every item so the lowest transformed sack vertex touches y = 0.
 * Items flagged `rest: true` sit on other sacks and are left alone.
 */
function groundItems(geo, items) {
  const pos = geo.attributes.position;
  const stride = 1;
  for (const it of items) {
    if (it.rest) continue;
    _ge.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0, 'YXZ');
    _gq.setFromEuler(_ge);
    const s = it.s ?? 1;
    let minY = Infinity;
    for (let i = 0; i < pos.count; i += stride) {
      _gv.set(pos.getX(i) * s, pos.getY(i) * s, pos.getZ(i) * s).applyQuaternion(_gq);
      if (_gv.y < minY) minY = _gv.y;
    }
    if (Number.isFinite(minY)) it.y = -minY;
  }
}

/**
 * A believable pile: a leaning base row of upright sacks with one or two sacks laid
 * across their shoulders on top. Every ground-contact sack sits on y = 0.
 * Returns makeInstanced items (x/y/z + rx/ry/rz/s).
 */
function pileItems(cx, cz, count, rng) {
  const items = [];
  const topCount = count >= 4 ? Math.max(2, Math.round(count * 0.34)) : 1;
  const baseCount = Math.max(1, count - topCount);
  const spacing = 0.66;
  for (let i = 0; i < baseCount; i++) {
    const t = baseCount === 1 ? 0 : i / (baseCount - 1) - 0.5;
    const s = 0.90 + rng() * 0.16;
    // lean the row inwards so the sacks prop each other up
    const lean = t * 0.34 + (rng() - 0.5) * 0.08;
    const rx = -0.09 - rng() * 0.06;
    const rz = lean;
    const tilt = Math.hypot(rx, rz);
    items.push({
      x: cx + t * spacing * Math.max(1, baseCount - 1) + (rng() - 0.5) * 0.05,
      y: 0.25 * s * Math.sin(tilt) + 0.004,
      z: cz + (rng() - 0.5) * 0.16 + (i % 2 === 0 ? 0.05 : -0.05),
      rx, ry: (rng() - 0.5) * 0.22, rz,
      s,
    });
  }
  for (let i = 0; i < topCount; i++) {
    const s = 0.88 + rng() * 0.12;
    // laid across the shoulders of the base row, roughly along the short axis
    const ry = Math.PI / 2 + (rng() - 0.5) * 0.55;
    const gy = 0.50 + i * 0.40;
    // offset the butt end so the sack's centre sits over the pile
    const dirX = Math.sin(ry);
    const dirZ = Math.cos(ry);
    items.push({
      x: cx - dirX * 0.50 * s + (rng() - 0.5) * 0.10,
      y: gy + 0.215 * s,
      z: cz - dirZ * 0.50 * s + (rng() - 0.5) * 0.10,
      rx: Math.PI / 2 + (rng() - 0.5) * 0.12, ry, rz: (rng() - 0.5) * 0.10,
      s,
      rest: true,
    });
  }
  return items;
}

/** Hand-composed 7-sack preview pile so the silhouette reads from every view. */
function previewPile() {
  const items = [];
  // leaning base row
  for (let i = 0; i < 3; i++) {
    const t = i - 1;
    const s = 0.92 + i * 0.05;
    const rz = t * 0.30;
    const rx = -0.10 - (i % 2) * 0.04;
    items.push({
      x: t * 0.62,
      y: 0.25 * s * Math.sin(Math.hypot(rx, rz)) + 0.004,
      z: 0.02 + (i % 2) * 0.06,
      rx, ry: -0.06 + i * 0.05, rz,
      s,
    });
  }
  // a sack laid across the shoulders
  items.push({ x: -Math.sin(Math.PI / 2 - 0.18) * 0.52, y: 0.50 + 0.215, z: -Math.cos(Math.PI / 2 - 0.18) * 0.52, rx: Math.PI / 2 + 0.06, ry: Math.PI / 2 - 0.18, rz: 0.04, s: 1.0, rest: true });
  items.push({ x: -Math.sin(Math.PI / 2 + 0.22) * 0.50, y: 0.50 + 0.215 + 0.42, z: -Math.cos(Math.PI / 2 + 0.22) * 0.50, rx: Math.PI / 2 - 0.05, ry: Math.PI / 2 + 0.22, rz: -0.05, s: 0.94, rest: true });
  // two more leaning sacks flanking the pile (show the standing silhouette)
  items.push({ x: -0.86, y: 0.02, z: -0.34, rx: -0.04, ry: 0.62, rz: -0.20, s: 0.9 });
  items.push({ x: 0.88, y: 0.02, z: -0.30, rx: -0.05, ry: -0.55, rz: 0.18, s: 0.93 });
  return items;
}

function buildSackFamily(ctx, preview) {
  const L = ctx.data.layout;
  const M = ctx.materials;
  const sackGeo = makeSackGeometry();
  const sackItems = [];
  const sackRng = makeRNG(881);
  if (preview) {
    sackItems.push(...previewPile());
  } else {
    // market / street piles: same four placements and counts as before
    for (const [cx, cz, n] of [[10.2, 14.2, 5], [-10.2, 14.2, 4], [10.2, 5.0, 3], [-10.2, 5.0, 5]]) {
      sackItems.push(...pileItems(cx, cz, n, sackRng));
    }
    // bomb-site piles (the tight heaps with matching small colliders)
    for (const [cx, cz] of L.sackPiles) {
      sackItems.push(...pileItems(cx, cz, 3, sackRng));
    }
  }
  groundItems(sackGeo, sackItems);
  makeInstanced(ctx, sackGeo, M.sandbag, sackItems, 'sacks', 'fabric', { seed: 48 });
}

