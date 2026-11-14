/**
 * SANDSTRIKE // shared high-detail geometry kit for the world props.
 *
 * The map props under `src/models/world/` are cheap low-poly shapes (a whole crate
 * stack used to be three untextured boxes).  This kit supplies the small set of
 * bevelled / rounded / lathed primitives the isolated model stage uses to build the
 * "showcase" version of a prop at roughly 18k-22k triangles, while the in-game map
 * keeps a cheaper level of detail: every builder is handed `ctx` and `ctx.stage` is
 * true only inside the model stage, so builders can branch on it.
 *
 * Conventions
 *  - metres, geometry centred on its local origin, +Y up (use the rotate args),
 *  - front of a prop is -Z in the stage previews,
 *  - all primitives return a BufferGeometry; `put()` / `emit()` add it to a material
 *    batch (`ctx.batcher`) and dispose the source geometry,
 *  - UVs are scaled to the world texture tile size so wood/stone/rust textures keep
 *    their scale instead of stretching.
 *
 * Measured triangle costs (use these to budget):
 *   box                                 12
 *   plate / plank (bevelled)            28
 *   cylinder radial 6/8/12/16/20/24/32  24/32/48/64/80/96/128
 *   lathe  segments 16 / 24             ~ 2*segments*(profilePoints-1)
 *   torus  tubular x radial             2*tubular*radial   (8x4=64, 16x6=192, 24x8=384)
 *   tube   tubular x radial             2*tubular*radial   (16x6=192, 32x8=512)
 *   sphere 10x8 / 12x10 / 16x12         140 / 216 / 352
 *   icosahedron detail 0/1/2/3          20 / 80 / 180 / 320
 *   hex bolt head                       24
 */
import * as THREE from 'three';
import { cylinderWorldUV, matrixFor } from '../core.js';

/** Triangle count of a geometry (index and non-indexed aware). */
export function triCount(geo) {
  return (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
}

/** True only for the isolated model-stage preview build. */
export function isPreview(ctx) {
  return ctx.stage === true;
}

/** Pick a value for preview vs map: `pick(ctx, 2, 1)` => 2 in the stage, 1 in game. */
export function pick(ctx, previewValue, mapValue) {
  return isPreview(ctx) ? previewValue : mapValue;
}

function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

/** Add a geometry to a material batch, then dispose the temporary geometry. */
export function emit(ctx, key, geo, matrix, opts) {
  ctx.batcher.add(key, geo, matrix, opts);
  geo.dispose();
}

/** Add a geometry at a position / rotation (metres, radians) to a material batch. */
export function put(ctx, key, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, opts) {
  emit(ctx, key, geo, matrixFor(x, y, z, rx, ry, rz), opts);
}

/**
 * Bevelled rectangular board / plate / stone slab.
 * This is the workhorse: every plank, panel, cap stone, shingle and metal plate.
 */
export function plateGeo(w, h, d, { bevel = 0.02, tile = 1.4 } = {}) {
  const b = Math.max(0.0015, Math.min(bevel, w * 0.32, h * 0.32, d * 0.32));
  const shape = new THREE.Shape();
  const hw = Math.max(0.001, w / 2 - b * 0.0);
  const hh = Math.max(0.001, h / 2 - b * 0.0);
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();
  const depth = Math.max(0.002, d - 2 * b);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.translate(0, 0, -depth / 2);
  scaleUV(geo, 1 / tile, 1 / tile);
  return geo;
}

/** Cylinder with world-scaled UVs. `rTop` may differ from `rBottom` (tapered). */
export function cylGeo(rTop, rBottom, h, { radial = 16, tile = 1.8, open = false } = {}) {
  return cylinderWorldUV(rTop, rBottom, h, radial, tile, open);
}

/** Lathe (turned) profile: `profile` is [[radius, y], ...] in metres. */
export function latheGeo(profile, { segments = 24, tile = 1.6 } = {}) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  let maxR = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [r, y] of profile) {
    maxR = Math.max(maxR, r);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const geo = new THREE.LatheGeometry(pts, segments);
  scaleUV(geo, (Math.PI * 2 * maxR) / tile, (maxY - minY) / tile);
  return geo;
}

/** Torus ring (hoops, ropes, collars, wheel rims). */
export function torusGeo(R, r, { radialSeg = 8, tubularSeg = 16, tile = 1.2 } = {}) {
  const geo = new THREE.TorusGeometry(R, r, radialSeg, tubularSeg);
  scaleUV(geo, (Math.PI * 2 * r) / tile, (Math.PI * 2 * R) / tile);
  return geo;
}

/** Tube along a polyline / smooth curve (ropes, cables, welds, bent bars). */
export function tubeGeo(points, r, { tubularSeg = 16, radialSeg = 6, tile = 1.2, closed = false } = {}) {
  const curve = points.length > 2
    ? new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.35)
    : new THREE.LineCurve3(points[0], points[points.length - 1]);
  const len = curve.getLength();
  const geo = new THREE.TubeGeometry(curve, tubularSeg, r, radialSeg, closed);
  scaleUV(geo, len / tile, (Math.PI * 2 * r) / tile);
  return geo;
}

/** Sphere / rounded ball. */
export function sphereGeo(r, { segW = 12, segH = 10, tile = 1.6 } = {}) {
  const geo = new THREE.SphereGeometry(r, segW, segH);
  scaleUV(geo, (Math.PI * 2 * r) / tile, (Math.PI * r) / tile);
  return geo;
}

/**
 * Natural stone / rock: jittered icosahedron, flattened on Y so it can sit on the
 * ground. Deterministic per `seed`.
 */
export function rockGeo(r, { detail = 1, seed = 1, flatten = 0.72, tile = 1.4 } = {}) {
  const geo = new THREE.IcosahedronGeometry(r, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 37.1 + v.y * 17.7 + v.z * 11.3 + seed * 7.3) * 43758.5453;
    const jitter = 0.78 + (n - Math.floor(n)) * 0.44;
    v.multiplyScalar(jitter);
    v.y *= flatten;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  scaleUV(geo, (Math.PI * 2 * r) / tile, (Math.PI * r) / tile);
  return geo;
}

/** Hex bolt head (+ optionally a proud washer disc underneath). */
export function boltGeo(r = 0.02, h = 0.014, { washer = false, tile = 0.6 } = {}) {
  if (!washer) {
    const head = new THREE.CylinderGeometry(r, r * 1.06, h, 6, 1);
    scaleUV(head, (Math.PI * 2 * r) / tile, h / tile);
    return head;
  }
  const a = new THREE.CylinderGeometry(r * 1.35, r * 1.35, h * 0.45, 8, 1);
  scaleUV(a, (Math.PI * 2 * r) / tile, (h * 0.45) / tile);
  a.translate(0, -h * 0.3, 0);
  const b = new THREE.CylinderGeometry(r, r * 1.06, h, 6, 1);
  scaleUV(b, (Math.PI * 2 * r) / tile, h / tile);
  b.translate(0, h * 0.5, 0);
  const merged = mergeSimple([a, b]);
  a.dispose();
  b.dispose();
  return merged;
}

/** Minimal non-indexed merge (keeps position/normal/uv) for the kit's compounds. */
export function mergeSimple(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let off = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, off * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, off * 2);
    off += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Ring of bolts around an axis (`,count` heads in a circle of radius R). */
export function boltRing(ctx, key, cx, cy, cz, R, count, {
  r = 0.02, h = 0.012, axis = 'y', phase = 0, facing = 1, washer = false,
} = {}) {
  const geo = boltGeo(r, h, { washer });
  const build = () => geo.clone();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + phase;
    let x = cx;
    let y = cy;
    let z = cz;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    if (axis === 'y') {
      x += Math.cos(a) * R;
      z += Math.sin(a) * R;
      e.set(0, 0, 0, 'YXZ');
    } else if (axis === 'x') {
      y += Math.cos(a) * R;
      z += Math.sin(a) * R;
      e.set(0, 0, Math.PI / 2 * facing, 'YXZ');
    } else {
      x += Math.cos(a) * R;
      y += Math.sin(a) * R;
      e.set(Math.PI / 2 * facing, 0, 0, 'YXZ');
    }
    q.setFromEuler(e);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    ctx.batcher.add(key, build(), m);
  }
  geo.dispose();
}

/** Straight bar spanning two points (struts, rails, cross braces). */
export function rodGeo(ax, ay, az, bx, by, bz, r, { radial = 6, tile = 1.4 } = {}) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  const geo = cylinderWorldUV(r, r, Math.max(0.01, len), radial, tile);
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(ax + dx / 2, ay + dy / 2, az + dz / 2),
    q,
    new THREE.Vector3(1, 1, 1)
  );
  geo.applyMatrix4(m);
  return geo;
}
