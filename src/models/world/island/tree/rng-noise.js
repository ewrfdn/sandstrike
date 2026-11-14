/**
 * PROCEDURAL TREE KIT // deterministic RNG + value noise.
 *
 * Everything the tree generator decides at build time comes from a caller-owned
 * `makeRNG(seed)` stream (src/utils.js) so one seed always rebuilds exactly one tree.
 * This module only adds the handful of helpers the generator needs on top of that
 * stream, plus the seeded 3D value noise copied from Golden Temple's
 * `vegetation-tree.js:23-38` (the canopy gap / shell-window field and the trunk moss
 * blotches are driven by it).
 *
 * No `Math.random()` anywhere in tree/*.js: a QA re-build must be byte-identical.
 */
import { makeRNG } from '../../../../utils.js';

export { makeRNG };

const TAU = Math.PI * 2;

/** Uniform float in [a, b). */
export function range(rng, a, b) {
  return a + (b - a) * rng();
}

/** Integer in [a, b] (inclusive). */
export function intRange(rng, a, b) {
  return a + Math.floor((b - a + 1) * rng());
}

/** Random element of `list`. */
export function pick(rng, list) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/** True with probability p. */
export function chance(rng, p) {
  return rng() < p;
}

/** `out` = a uniformly distributed point on the unit sphere (deterministic). */
export function randUnit(rng, out) {
  const u = rng() * 2 - 1;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  const a = rng() * TAU;
  out.set(s * Math.cos(a), u, s * Math.sin(a));
  return out;
}

/** `out` = random point on the sphere pulled towards the unit vector `hint`. */
export function randUnitBiased(rng, out, hint, bias) {
  randUnit(rng, out);
  out.multiplyScalar(1 - bias).addScaledVector(hint, bias).normalize();
  return out;
}

/** Interpolate along `s` with a smootherstep knee. */
export function smoothstep01(s) {
  const t = Math.max(0, Math.min(1, s));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// integer hash -> [0,1): the lattice for the value noise below
// ---------------------------------------------------------------------------

function mix32(h) {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic hash of an integer lattice point -> [0,1). */
export function hash3(ix, iy, iz) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(iz | 0, 0x9e3779b1);
  h = mix32(h ^ 0x5bd1e995);
  return h / 4294967296;
}

/**
 * Seeded 3D value noise in [0,1), trilinear with smootherstep weights.
 * Two octaves (`fbm3`) is all the canopy generator needs — this is a build-time
 * "where are the holes" field, not a shader texture.
 */
export function vnoise3(x, y, z, seed = 0) {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const tx = smoothstep01(x - fx);
  const ty = smoothstep01(y - fy);
  const tz = smoothstep01(z - fz);
  const s = seed | 0;
  const c000 = hash3(fx, fy, fz + s);
  const c100 = hash3(fx + 1, fy, fz + s);
  const c010 = hash3(fx, fy + 1, fz + s);
  const c110 = hash3(fx + 1, fy + 1, fz + s);
  const c001 = hash3(fx, fy, fz + 1 + s);
  const c101 = hash3(fx + 1, fy, fz + 1 + s);
  const c011 = hash3(fx, fy + 1, fz + 1 + s);
  const c111 = hash3(fx + 1, fy + 1, fz + 1 + s);
  const x00 = c000 + (c100 - c000) * tx;
  const x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx;
  const x11 = c011 + (c111 - c011) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

/** Two-octave value noise in [0,1). `scale` is in metres^-1. */
export function fbm3(x, y, z, seed = 0, scale = 1, gain = 0.34) {
  const a = vnoise3(x * scale, y * scale, z * scale, seed);
  const b = vnoise3(x * scale * 2.17 + 13.1, y * scale * 2.17 - 7.3, z * scale * 2.17 + 4.7, seed + 101);
  return a * (1 - gain) + b * gain;
}
