/**
 * PROCEDURAL TREE KIT // meshers.
 *
 * Two accumulators, exactly two material buckets per tree (wood + leaves):
 *
 *  - {@link BarkAccum}: tree bark as swept ring meshes around every skeleton branch
 *    (parallel-transported frames, GT `BarkAccum.addBranch:130-220`), plus buttress
 *    plates, root paws and liana tubes. Vertex colour carries baked AO / moss tint and
 *    is consumed by `M.barkTrop` (`vertexColors:true`).
 *
 *  - {@link LeafAccum}: alpha cards, **two triangles each** (GT `leafCardGeo`-style flat
 *    card; the bend/droop geometry of the old `leafQuad` costs 4-6x the triangles and
 *    the shader sells the volume instead). `M.vegLeaf` reads the vertex colour as
 *    `r = canopy AO, g = wind flex, b = hue jitter` (see gt-techniques §3.3).
 *
 * Both outputs are ordinary BufferGeometries with `position/normal/uv/color`, so they
 * survive `makeInstanced` and the foliage customDepthMaterial unchanged.
 */
import * as THREE from 'three';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// small vector scratch
// ---------------------------------------------------------------------------
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _prev = new THREE.Vector3();

/** Parallel-transported frames along a polyline (no Frenet flips on straight runs). */
function framesOf(points) {
  const count = points.length;
  const T = new Array(count);
  const N = new Array(count);
  const B = new Array(count);
  for (let i = 0; i < count; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(count - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a);
    if (t.lengthSq() < 1e-12) t.copy(UP);
    T[i] = t.normalize();
  }
  const n0 = Math.abs(T[0].dot(UP)) > 0.92 ? new THREE.Vector3(1, 0, 0) : UP.clone();
  n0.addScaledVector(T[0], -n0.dot(T[0])).normalize();
  N[0] = n0;
  for (let i = 1; i < count; i++) {
    const n = N[i - 1].clone();
    n.addScaledVector(T[i], -n.dot(T[i]));
    if (n.lengthSq() < 1e-8) {
      n.set(0, 1, 0).addScaledVector(T[i], -T[i].y);
      if (n.lengthSq() < 1e-8) n.set(1, 0, 0);
    }
    N[i] = n.normalize();
  }
  for (let i = 0; i < count; i++) B[i] = new THREE.Vector3().crossVectors(T[i], N[i]).normalize();
  return { T, N, B };
}

/** Indexed accumulator that keeps positions/normals/uvs/colours in flat arrays. */
class IndexedAccum {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  vertex(x, y, z, nx, ny, nz, u, v, cr, cg, cb) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(cr, cg, cb);
    return this.pos.length / 3 - 1;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  build(name = 'accum') {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.idx.length) geo.setIndex(this.idx);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.name = name;
    return geo;
  }
}

// ---------------------------------------------------------------------------
// wood
// ---------------------------------------------------------------------------

const _col = [1, 1, 1];

/**
 * Wood accumulator.
 *
 * @param {(p: THREE.Vector3, pd: number, n: THREE.Vector3, out: number[]) => void} colorFn
 *        per-vertex colour writer; use it to bake AO / moss (see build-variant.js).
 */
export class BarkAccum {
  constructor(colorFn) {
    this.acc = new IndexedAccum();
    this.colorFn = colorFn || null;
  }

  _paint(p, pd, nx, ny, nz) {
    _col[0] = 1;
    _col[1] = 1;
    _col[2] = 1;
    if (this.colorFn) {
      _n.set(nx, ny, nz);
      this.colorFn(p, pd, _n, _col);
    }
    return _col;
  }

  /**
   * Sweep one branch.
   *
   * @param {object} branch skeleton branch (`pts`, `rads`, `pd`)
   * @param {object} [opts]
   *   - `radial` ring segments (default: auto from radius, GT `clamp(4+48r,3,16)`)
   *   - `tile` bark texture tile in metres (default 1.35)
   *   - `stride` take every Nth skeleton point (map LOD)
   *   - `disp` trunk displacement params (only for the trunk)
   *   - `dispLen` trunk length for normalising `disp` height
   *   - `tipR` clamp the final radius (twigs can end in a point)
   */
  addBranch(branch, opts = {}) {
    const pts = branch.pts;
    const last = pts.length - 1;
    const stride = Math.max(1, opts.stride || 1);
    const rings = [];
    for (let i = 0; i <= last; i += stride) rings.push(i);
    if (rings[rings.length - 1] !== last) rings.push(last);
    if (rings.length < 2) return;

    const sub = rings.map((i) => pts[i]);
    const { T, N, B } = framesOf(sub);
    const radial = opts.radial || Math.max(3, Math.min(16, Math.round(4 + branch.rads[0] * 48)));
    const tile = opts.tile ?? 1.35;
    const disp = opts.disp || null;
    const dispLen = Math.max(0.001, opts.dispLen || 1);
    const tipR = opts.tipR ?? 0;
    const rMean = Math.max(0.01, branch.rads[0] * 0.7);
    const uSpan = (TAU * rMean) / tile;
    const base = this.acc.vertexCount;
    const ringRadii = [];

    for (let k = 0; k < rings.length; k++) {
      const i = rings[k];
      const p = pts[i];
      const t01 = Math.max(0, Math.min(1, branch.pd[i] / dispLen));
      const rad = Math.max(opts.minR ?? 0.004, (branch.rads[i] || tipR) * (disp ? 1 : 1));
      ringRadii.push(rad);
    }

    for (let k = 0; k < rings.length; k++) {
      const i = rings[k];
      const p = pts[i];
      const t01 = Math.max(0, Math.min(1, branch.pd[i] / dispLen));
      const rBase = ringRadii[k];
      // radius slope for the normal (cylinder-ish around the tangent)
      const rPrev = k > 0 ? ringRadii[k - 1] : rBase;
      const rNext = k < rings.length - 1 ? ringRadii[k + 1] : rBase;
      const ds = Math.max(0.02, (k > 0 ? p.distanceTo(pts[rings[k - 1]]) : p.distanceTo(pts[rings[1]])));
      const slope = (rNext - rPrev) / (2 * ds);
      const vAcc = branch.pd[i] / tile;
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        _dir.copy(N[k]).multiplyScalar(ca).addScaledVector(B[k], sa);
        const rr = disp ? rBase * trunkMul(disp, dispLen, branch.pd[i], a) : rBase;
        const x = p.x + _dir.x * rr;
        const y = p.y + _dir.y * rr;
        const z = p.z + _dir.z * rr;
        _n.copy(_dir).addScaledVector(T[k], -slope).normalize();
        const c = this._paint(p, branch.pd[i], _n.x, _n.y, _n.z);
        this.acc.vertex(x, y, z, _n.x, _n.y, _n.z, (j / radial) * uSpan, vAcc, c[0], c[1], c[2]);
      }
    }
    const stride1 = radial + 1;
    for (let k = 0; k < rings.length - 1; k++) {
      for (let j = 0; j < radial; j++) {
        const a0 = base + k * stride1 + j;
        const a1 = a0 + 1;
        const b0 = a0 + stride1;
        const b1 = b0 + 1;
        this.acc.tri(a0, b0, a1);
        this.acc.tri(a1, b0, b1);
      }
    }
  }

  /**
   * Simple tube along a free polyline (lianas, aerial roots, coiled creepers).
   * @param {THREE.Vector3[]} points
   * @param {number|((t:number)=>number)} radius base radius or radius(t01)
   * @param {{radial?: number, tile?: number, pd0?: number}} [opts]
   */
  addTube(points, radius, opts = {}) {
    const n = points.length;
    if (n < 2) return;
    const pd = [opts.pd0 || 0];
    let acc = pd[0];
    for (let i = 1; i < n; i++) {
      acc += points[i].distanceTo(points[i - 1]);
      pd.push(acc);
    }
    const rads = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      rads.push(typeof radius === 'function' ? radius(t) : radius);
    }
    this.addBranch({ pts: points, rads, pd }, opts);
  }

  /**
   * One buttress plate: a blade from the trunk to the litter, thick at the bole and
   * narrowing to a rounded ridge (same silhouette as the shipped jungle-tree).
   *
   * @param {{az:number,out:number,h:number,thick:number,curve:number,seed?:number}} spec
   */
  addButtress(spec, { sections = 12, tile = 1.2, wobble = 0.1 } = {}) {
    const S = Math.max(4, sections);
    const rows = [];
    let acc = 0;
    let prev = null;
    const seed = spec.seed ?? 1;
    for (let s = 0; s <= S; s++) {
      const t = s / S;
      const ang = spec.az + spec.curve * t * t + Math.sin(t * 4.1 + seed) * 0.05 * t;
      const dist = 0.24 + (spec.out - 0.24) * Math.pow(t, 1.08);
      // the plate hugs the bole then dives into the litter: top edge never > ~1.2 m
      const top = spec.h * (1 - Math.pow(t, 1.6)) + 0.03;
      const half = (spec.thick * (1 - Math.pow(t, 1.55)) + 0.03) * 0.5;
      if (prev) acc += Math.hypot(dist - prev.dist, top - prev.top);
      rows.push({
        cx: Math.cos(ang) * dist,
        cz: Math.sin(ang) * dist,
        tx: -Math.sin(ang),
        tz: Math.cos(ang),
        top,
        half,
        dist,
        acc,
        ang,
      });
      prev = rows[s];
    }
    const base = this.acc.vertexCount;
    for (const s of rows) {
      const yb = -0.05;
      const halfBase = s.half * 1.6;
      const halfTop = s.half * 0.5;
      const jab = 1 + Math.sin(s.acc * 7.3 + seed) * wobble;
      const pts = [
        [s.cx - s.tx * halfBase, yb, s.cz - s.tz * halfBase],
        [s.cx - s.tx * halfTop, s.top, s.cz - s.tz * halfTop],
        [s.cx + s.tx * halfTop, s.top, s.cz + s.tz * halfTop],
        [s.cx + s.tx * halfBase, yb, s.cz + s.tz * halfBase],
      ];
      const faces = [
        [-s.tx, 0.08, -s.tz],
        [-s.tx * 0.5, 1, -s.tz * 0.5],
        [s.tx * 0.5, 1, s.tz * 0.5],
        [s.tx, 0.08, s.tz],
      ];
      for (let k = 0; k < 4; k++) {
        const nx = faces[k][0];
        const ny = faces[k][1];
        const nz = faces[k][2];
        const len = Math.hypot(nx, ny, nz) || 1;
        const u = (s.acc / tile) * jab;
        const p = new THREE.Vector3(pts[k][0], pts[k][1], pts[k][2]);
        const c = this._paint(p, p.y, nx / len, ny / len, nz / len);
        this.acc.vertex(p.x, p.y, p.z, nx / len, ny / len, nz / len, u, p.y / tile, c[0], c[1], c[2]);
      }
    }
    for (let s = 0; s < S; s++) {
      const b = base + s * 4;
      const n = b + 4;
      this.acc.tri(b, b + 1, n + 1);
      this.acc.tri(b, n + 1, n);
      this.acc.tri(b + 1, b + 2, n + 2);
      this.acc.tri(b + 1, n + 2, n + 1);
      this.acc.tri(b + 2, b + 3, n + 3);
      this.acc.tri(b + 2, n + 3, n + 2);
    }
    // outer end cap so the plate reads as a cut blade, not a paper edge
    const e = base + S * 4;
    this.acc.tri(e, e + 2, e + 1);
    this.acc.tri(e, e + 3, e + 2);
    return rows[rows.length - 1];
  }

  /** Mossy root paw / boulder: jittered icosahedron, flat shaded. */
  addRock(center, radius, { seed = 1, flatten = 0.62, tile = 1.5, detail = 0 } = {}) {
    const geo = new THREE.IcosahedronGeometry(radius, detail);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = Math.sin(v.x * 37.1 + v.y * 17.7 + v.z * 11.3 + seed * 7.3) * 43758.5453;
      const j = 0.76 + (n - Math.floor(n)) * 0.46;
      v.multiplyScalar(j);
      v.y *= flatten;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const p = geo.attributes.position;
    const nr = geo.attributes.normal;
    const base = this.acc.vertexCount;
    for (let i = 0; i < p.count; i++) {
      const x = center.x + p.getX(i);
      const y = center.y + p.getY(i);
      const z = center.z + p.getZ(i);
      const nx = nr.getX(i);
      const ny = nr.getY(i);
      const nz = nr.getZ(i);
      const u = (Math.atan2(p.getZ(i), p.getX(i)) / TAU + 0.5) * ((radius * TAU) / tile);
      const vv = ((p.getY(i) / (radius || 1)) * 0.5 + 0.5) * ((radius * 2) / tile);
      const pp = new THREE.Vector3(x, y, z);
      const c = this._paint(pp, y, nx, ny, nz);
      this.acc.vertex(x, y, z, nx, ny, nz, u, vv, c[0], c[1], c[2]);
    }
    for (let i = 0; i < p.count; i += 3) this.acc.tri(base + i, base + i + 1, base + i + 2);
    geo.dispose();
  }

  build(name = 'tree-wood') {
    return this.acc.build(name);
  }
}

/** Height normalised trunk displacement (kept out of skeleton.js' public API). */
function trunkMul(disp, dispLen, pd, theta) {
  const t = Math.max(0, Math.min(1, pd / dispLen));
  const { bump = 0.05, flare = 0.95, roots = 4.5, flareH = 0.14, flute = 0.038, fluteN = 7, seed = 1 } = disp;
  const rootBand = Math.exp(-t / flareH);
  const lobeBand = Math.exp(-t / (flareH * 0.62));
  const lobe = Math.max(0, Math.cos(theta * roots + seed * 2.13)) ** 1.7;
  let m = 1 + flare * rootBand * (0.34 + 0.66 * lobe) + 0.28 * flare * lobeBand * lobe;
  m += flute * Math.sin(theta * fluteN + t * 3.1 + seed * 1.7);
  m += bump * Math.sin(theta * 2.0 - t * 4.3 + seed * 0.9) * (1 - t * 0.6);
  return m;
}

// ---------------------------------------------------------------------------
// leaves
// ---------------------------------------------------------------------------

/**
 * Alpha-card accumulator. Every card is exactly two triangles (6 vertices).
 *
 * Colour contract (read by M.vegLeaf's shader patch):
 *   r = canopy AO (0.25..1), g = wind flex (0..1), b = hue jitter (0..1).
 */
export class LeafAccum {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.cards = 0;
  }

  /**
   * Add one card.
   *
   * @param {THREE.Vector3} base centre of the card
   * @param {THREE.Vector3} X half-length axis (base -> tip is +X)
   * @param {THREE.Vector3} Y half-width axis
   * @param {THREE.Vector3} Z card normal
   * @param {number} w full length (m)
   * @param {number} h full width (m)
   * @param {{u0:number,v0:number,u1:number,v1:number}} rect atlas cell
   * @param {number} ao canopy ambient occlusion 0.25..1
   * @param {number} flex wind flex 0..1
   * @param {number} hue colour jitter 0..1
   * @param {{aoTop?:number, aoBottom?:number, bow?:number}} [opts]
   */
  card(base, X, Y, Z, w, h, rect, ao, flex, hue, opts = {}) {
    const hx = w * 0.5;
    const hy = h * 0.5;
    const aoTop = ao * (opts.aoTop ?? 1.055);
    const aoBottom = ao * (opts.aoBottom ?? 0.955);
    const bow = opts.bow || 0;
    const { u0, u1, v0, v1 } = rect;
    const px = base.x;
    const py = base.y;
    const pz = base.z;
    const Xx = X.x, Xy = X.y, Xz = X.z;
    const Yx = Y.x, Yy = Y.y, Yz = Y.z;
    const Zx = Z.x, Zy = Z.y, Zz = Z.z;

    // The card is two triangles: 0 = base/bottom, 1 = tip/bottom, 2 = tip/top,
    // 3 = base/top; triangle list 0-1-2 / 0-2-3. Positions are written once per
    // triangle corner (no index buffer — merge/instancing path stays trivial).
    const csx = [-hx, hx, hx, -hx];
    const csy = [-hy, -hy, hy, hy];
    for (let k = 0; k < 6; k++) {
      const src = [0, 1, 2, 0, 2, 3][k];
      const sx = csx[src];
      const sy = csy[src];
      // a shallow bow across the card width (cheap fake curl; 0 extra triangles)
      const bz = bow * (1 - (sy / (hy || 1)) ** 2) * (sx / (hx || 1));
      this.pos.push(
        px + Xx * sx + Yx * sy + Zx * bz,
        py + Xy * sx + Yy * sy + Zy * bz,
        pz + Xz * sx + Yz * sy + Zz * bz
      );
      this.nor.push(Zx, Zy, Zz);
      this.uv.push(u0 + (u1 - u0) * (sx / w + 0.5), v0 + (v1 - v0) * (sy / h + 0.5));
      this.col.push(sy > 0 ? aoTop : aoBottom, flex, hue);
    }
    this.cards++;
  }

  build(name = 'tree-leaves') {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.name = name;
    return geo;
  }
}
