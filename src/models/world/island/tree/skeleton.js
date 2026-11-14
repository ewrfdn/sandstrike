/**
 * PROCEDURAL TREE KIT // skeleton (simplified Golden Temple port).
 *
 * Golden Temple grows a tree as a *curve* (not a random fork): every branch carries a
 * momentum-like `curl` that decays each step, so it wobbles smoothly instead of zig-
 * zagging (`vegetation-tree.js:73-110`). The branch is then clipped by an ellipsoid
 * "crown envelope" so it can never stab out of the silhouette (`fitInEnvelope:54-63`),
 * and finally its radius comes from the leaf area it carries (`setRadii:671-694`).
 * Those three ideas are what make a procedural tree read as grown instead of random;
 * this file is the real-time-sized version of them.
 *
 * Differences from GT (intentional):
 *  - no `kink`/`minY`/`maxY` params (we clip with the envelope + the species spec),
 *  - branches carry `pd` = distance to root along the skeleton: the leaf mesher uses it
 *    for the wind-flex vertex channel, exactly like GT's `flexFn` (`vegetation.js:857`),
 *  - radii are solved from a *load* number (sum of downstream leaf-card area) instead of
 *    GT's pad table, because our pads are generated after the skeleton.
 *
 * All positions are in tree-local space, metres, +Y up, base at y≈0.
 */
import * as THREE from 'three';
import { randUnit } from './rng-noise.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Golden angle: consecutive branches never line up. */
export const GOLD = 2.39996323;

// ---------------------------------------------------------------------------
// crown envelope: an axis-aligned ellipsoid the skeleton and the shells share
// ---------------------------------------------------------------------------

/** Squared normalised distance of `p` from the envelope centre (1 = on the surface). */
export function envRho(p, env) {
  const dx = (p.x - env.c.x) / env.r.x;
  const dy = (p.y - env.c.y) / env.r.y;
  const dz = (p.z - env.c.z) / env.r.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Outward ellipsoid normal at `p` (GT `envNormal`, `vegetation-tree.js:64-69`). */
export function envNormal(p, env, out = new THREE.Vector3()) {
  out.set(
    (p.x - env.c.x) / (env.r.x * env.r.x),
    (p.y - env.c.y) / (env.r.y * env.r.y),
    (p.z - env.c.z) / (env.r.z * env.r.z)
  );
  return out.normalize();
}

/**
 * How far a straight ray may travel inside the envelope (GT `fitInEnvelope:54-63`).
 * A branch that starts outside already is given a token length so it never explodes
 * the silhouette.
 */
export function fitInEnvelope(pos, dir, len, env) {
  const qx = (pos.x - env.c.x) / env.r.x;
  const qy = (pos.y - env.c.y) / env.r.y;
  const qz = (pos.z - env.c.z) / env.r.z;
  const dx = dir.x / env.r.x;
  const dy = dir.y / env.r.y;
  const dz = dir.z / env.r.z;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-8) return 0;
  const b = qx * dx + qy * dy + qz * dz;
  const c = qx * qx + qy * qy + qz * qz - 1;
  if (c > 0) return len * 0.3;
  const disc = b * b - a * c;
  if (disc <= 0) return len * 0.3;
  const s = (-b + Math.sqrt(disc)) / a;
  return Math.min(len, Math.max(s, len * 0.3));
}

// ---------------------------------------------------------------------------
// curve growth
// ---------------------------------------------------------------------------

const _rand = new THREE.Vector3();

/**
 * Grow one branch as a smooth curve.
 *
 * @param {() => number} rng deterministic stream
 * @param {THREE.Vector3} start first point (not mutated)
 * @param {THREE.Vector3} dir initial tangent (not mutated)
 * @param {number} length arc length target (m)
 * @param {number} r0 radius at the base (m)
 * @param {number} r1 radius at the tip (m)
 * @param {object} [P] growth params: `seg, wobble, curlDecay, up, droop, droopPow,
 *        flatten, outward, outPush, env, envMax, taper`
 * @returns {{pts: THREE.Vector3[], rads: number[]}}
 */
export function growCurve(rng, start, dir, length, r0, r1, P = {}) {
  const seg = P.seg ?? 0.24;
  const n = Math.max(2, Math.ceil(length / seg));
  const ds = length / n;
  const pts = [start.clone()];
  const rads = [r0];
  const d = dir.clone().normalize();
  const curl = new THREE.Vector3();
  const p = start.clone();
  const decay = P.curlDecay ?? 0.75;
  const wobble = P.wobble ?? 0.5;
  const up = P.up || 0;
  const droop = P.droop || 0;
  const droopPow = P.droopPow ?? 1;
  const flatten = P.flatten || 0;
  const outPush = P.outPush || 0;
  const outward = P.outward || null;
  const taper = P.taper ?? 1;
  const env = P.env || null;
  const envMax = P.envMax ?? 0.97;
  // A branch that attaches below the envelope (a low limb) must still be allowed to
  // grow: the limit relaxes to wherever it started instead of clipping it instantly.
  const envLimit = env ? Math.max(envMax, envRho(start, env) * 1.05) : envMax;

  for (let i = 1; i <= n; i++) {
    const t = i / n;
    // (1) curl is a decaying velocity: the curve is smooth and cantilevered.
    randUnit(rng, _rand);
    curl.multiplyScalar(decay).addScaledVector(_rand, wobble);
    curl.addScaledVector(d, -curl.dot(d)); // keep it perpendicular to the tangent
    d.addScaledVector(curl, ds);
    d.y += (up - droop * Math.pow(t, droopPow)) * ds;
    if (flatten) d.y *= Math.max(0, 1 - flatten * ds);
    if (outward && outPush) {
      d.x += outward.x * outPush * ds;
      d.z += outward.z * outPush * ds;
    }
    d.normalize();
    p.addScaledVector(d, ds);
    pts.push(p.clone());
    rads.push(r1 + (r0 - r1) * Math.pow(1 - t, taper));
    // (2) never leave the crown envelope — this is what keeps the silhouette clean.
    if (env && i >= 2 && envRho(p, env) > envLimit) {
      rads[rads.length - 1] = Math.min(rads[rads.length - 1], r1 + (r0 - r1) * 0.2);
      break;
    }
  }
  return { pts, rads };
}

// ---------------------------------------------------------------------------
// branch records
// ---------------------------------------------------------------------------

/**
 * Wrap a grown curve into a branch record with `pd` (distance to root) baked in.
 *
 * @param {{pts: THREE.Vector3[], rads: number[]}} curve
 * @param {{level?: number, parent?: object|null, attachIdx?: number,
 *          padArea?: number, kind?: string}} [opts]
 */
export function makeBranch(curve, opts = {}) {
  const { pts, rads } = curve;
  const parent = opts.parent || null;
  const attachIdx = opts.attachIdx ?? 0;
  const pdBase = parent ? parent.pd[Math.min(attachIdx, parent.pd.length - 1)] : 0;
  const pd = [pdBase];
  const arc = [0];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += pts[i].distanceTo(pts[i - 1]);
    pd.push(pdBase + acc);
    arc.push(acc);
  }
  const b = {
    pts,
    rads,
    pd,
    arc, // local arc length from this branch's own root (0..len) — used by sampling
    len: acc,
    level: opts.level ?? 1,
    parent,
    attachIdx,
    children: [],
    padArea: opts.padArea || 0,
    load: 0,
    kind: opts.kind || 'branch',
    pad: null,
  };
  if (parent) parent.children.push(b);
  return b;
}

/** Distance from the root of the skeleton to branch point `i`. */
export function branchPd(branch, i) {
  return branch.pd[Math.max(0, Math.min(branch.pd.length - 1, i))];
}

/** Index of the branch point at (or just past) `pd` metres from the root. */
export function indexAtPd(branch, pd) {
  const n = branch.pd.length;
  for (let i = 1; i < n; i++) if (branch.pd[i] >= pd) return i;
  return n - 1;
}

const _sp = new THREE.Vector3();
const _st = new THREE.Vector3();

/**
 * Sample a branch at normalised arc length `t` in [0,1].
 * @returns {{p: THREE.Vector3, T: THREE.Vector3, r: number, pd: number}}
 */
export function sampleBranch(branch, t, out = { p: new THREE.Vector3(), T: new THREE.Vector3(), r: 0, pd: 0 }) {
  const n = branch.pts.length;
  const arc = branch.arc;
  const target = Math.max(0, Math.min(1, t)) * branch.len;
  let i = 1;
  while (i < n - 1 && arc[i] < target) i++;
  const d0 = arc[i - 1];
  const d1 = arc[i];
  const f = d1 > d0 + 1e-6 ? (target - d0) / (d1 - d0) : 0;
  const a = branch.pts[i - 1];
  const b = branch.pts[i];
  out.p.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
  out.r = branch.rads[i - 1] + (branch.rads[i] - branch.rads[i - 1]) * f;
  out.pd = branch.pd[i - 1] + (branch.pd[i] - branch.pd[i - 1]) * f;
  // tangent from the local neighbourhood (endpoints use the one-sided segment)
  const i0 = Math.max(0, i - 1);
  const i1 = Math.min(n - 1, i);
  _st.subVectors(branch.pts[i1], branch.pts[i0]);
  if (_st.lengthSq() < 1e-10) _st.copy(UP);
  out.T.copy(_st).normalize();
  return out;
}

/** Midpoint + tip helpers used a lot by the species generator. */
export function branchTip(branch) {
  return branch.pts[branch.pts.length - 1].clone();
}

/** Point on a branch at arc length `d` metres from its base. */
export function sampleBranchAt(branch, d, out) {
  return sampleBranch(branch, branch.len > 1e-6 ? d / branch.len : 0, out);
}

// ---------------------------------------------------------------------------
// tube radii from carried leaf load (GT setRadii, simplified)
// ---------------------------------------------------------------------------

/**
 * Solve every branch radius from the leaf-card area it carries: thin twigs feed a few
 * cards, the limb that holds them all is thick. `rBase` is the wanted trunk radius just
 * above the ground, which fixes the global constant.
 *
 * Also enforces the GT rule that a child leaves its parent at 0.92 x the parent radius.
 *
 * @param {object} root trunk branch
 * @param {{rBase?: number, rMin?: number, rMax?: number}} [opts]
 */
export function pipeRadii(root, { rBase = 0.3, rMin = 0.007, rMax = 0.62 } = {}) {
  const loadOf = (b) => {
    let l = b.padArea || 0;
    for (const c of b.children) l += loadOf(c);
    b.load = l;
    return l;
  };
  loadOf(root);
  const k = rBase / Math.sqrt(Math.max(1e-3, root.load));

  const solve = (b, attachR) => {
    const n = b.pts.length;
    const last = Math.max(1, n - 1);
    for (let i = 0; i < n; i++) {
      // leaf area carried "downstream" of point i: own pads still ahead + every child
      // that attaches after point i
      let down = (b.padArea || 0) * (1 - i / last) * 0.62;
      for (const c of b.children) {
        if (c.attachIdx >= i) down += c.load;
      }
      b.rads[i] = Math.max(rMin, Math.min(rMax, k * Math.sqrt(Math.max(1e-4, down))));
    }
    if (attachR > 0) {
      const ratio = attachR / Math.max(1e-4, b.rads[0]);
      for (let i = 0; i < n; i++) b.rads[i] = Math.min(rMax, b.rads[i] * ratio);
    }
    // keep a believable taper even on child branches with no pads of their own
    for (let i = 1; i < n; i++) {
      const t = i / last;
      b.rads[i] = Math.min(b.rads[i] * (1 - 0.18 * t) + b.rads[0] * 0.08 * (1 - t), b.rads[i - 1]);
    }
    for (const c of b.children) {
      const ai = Math.min(c.attachIdx, b.rads.length - 1);
      solve(c, b.rads[ai] * 0.92);
    }
  };
  solve(root, 0);
  root.rads[0] = Math.max(root.rads[0], rBase * 0.92);
  return root;
}

// ---------------------------------------------------------------------------
// trunk displacement: buttress lobes + flutes + root flare (GT trunkDisp:223-236)
// ---------------------------------------------------------------------------

/**
 * Radial multiplier around a trunk ring.
 *
 * @param {number} theta angle around the trunk (rad)
 * @param {number} t normalised height above the root (0 at the litter, 1 at trunk top)
 * @param {{bump?: number, flare?: number, roots?: number, flareH?: number,
 *          flute?: number, fluteN?: number, seed?: number}} [P]
 */
export function trunkDisp(theta, t, P = {}) {
  const bump = P.bump ?? 0.05;
  const flare = P.flare ?? 0.95;
  const roots = P.roots ?? 4.5;
  const flareH = P.flareH ?? 0.14;
  const flute = P.flute ?? 0.038;
  const fluteN = P.fluteN ?? 7;
  const seed = P.seed ?? 1;
  const rootBand = Math.exp(-t / flareH);
  const lobeBand = Math.exp(-t / (flareH * 0.62));
  // buttress lobes: spend most of the flare on `roots` azimuths only
  const lobe = Math.max(0, Math.cos(theta * roots + seed * 2.13)) ** 1.7;
  let m = 1 + flare * rootBand * (0.34 + 0.66 * lobe) + 0.28 * flare * lobeBand * lobe;
  // vertical flutes + slow girth ripple
  m += flute * Math.sin(theta * fluteN + t * 3.1 + seed * 1.7);
  m += bump * Math.sin(theta * 2.0 - t * 4.3 + seed * 0.9) * (1 - t * 0.6);
  return m;
}

/** Recompute a branch's radii through the trunk displacement (used by the mesher). */
export function displacedRadius(branch, i, theta, spec) {
  return branch.rads[i] * trunkDisp(theta, Math.max(0, Math.min(1, branch.pd[i] / Math.max(1e-4, spec.trunkH))), spec.trunk);
}
