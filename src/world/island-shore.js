/**
 * SANDSTRIKE // island shoreline — the single source of truth for "where does sand meet sea".
 *
 * The tropical map used to close its play ring with a reef-rock belt at `terrain.boundary.radius`
 * (collision ring + visible boulders). That belt is gone: the player now walks the whole beach
 * down to the water and wades a few metres into the shallows. Three different modules have to
 * agree about that shoreline, so all of its numbers live here:
 *
 *   - `island-terrain.js` builds the sand/beach/lagoon geometry with `shoreY()` / `warpRadius()`
 *   - `island-water.js` places the surf, the wave run-up and the shallow/deep colouring with the
 *     same profile (uploaded as the 1-D LUT described below, plus the shared GLSL snippet)
 *   - `formats/v2.js` (collision) and `player.js` (walkable ground) use `guardRadius` / `Y()`
 *
 * This module is intentionally `three`-free (it is imported by the Node map checker), so the
 * texture / uniform plumbing for the GPU side lives in `island-water.js`; everything it needs
 * (`createShoreLut()`, `SHORE_GLSL_*`, uniform names) is exported from here.
 *
 * ## Profile
 *
 * Radial height field `y(r)` (metres, sea level = `terrain.sea.level`), authored as a few control
 * knots and interpolated with a monotone cubic (Fritsch–Carlson) so the result is C1, never
 * overshoots and never creates a step where the beach folds under the water:
 *
 *   flat plateau (y≈0) ── dry apron ── beach face ── waterline ── wading shelf ── lagoon slope ── open sea
 *
 * The radius is warped by a 3-harmonic sine field of the **bearing** so the waterline is a natural
 * undulating curve instead of a perfect circle. `bearing` follows the map convention used
 * everywhere else: `x = sin(a) * r`, `z = cos(a) * r` → `a = atan2(x, z)`.
 *
 * ## LUT
 *
 * `createShoreLut(profile)` samples `y(r)` on a uniform grid `[0, SHORE_LUT_MAX]` (SHORE_LUT_SIZE
 * texels). The GPU samples the same array as a nearest-filtered 1-D texture and lerps manually, so
 * the shader and the geometry can never disagree by more than the LUT resolution.
 */

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Texel count of the 1-D shore height lookup table (pot: nearest-filter friendly). */
export const SHORE_LUT_SIZE = 512;

/** Radius (m) covered by the LUT. Beyond it the profile is extrapolated with its last slope. */
export const SHORE_LUT_MAX = 128;

/** Water depth (m) at which the wade guard ring stops the player. */
export const WADE_DEPTH = 0.62;

/**
 * Radial warp harmonics `[amplitude(m), frequency, phase]` applied to the bearing.
 * Amplitudes sum to ~2.5 m, i.e. the waterline breathes ±2.5 m around the mean radius —
 * enough to read as a natural shore from the beach, small enough to keep the surf band tight.
 */
export const SHORE_WARP_HARMONICS = Object.freeze([
  Object.freeze([1.30, 3, 0.70]),
  Object.freeze([0.80, 7, 2.05]),
  Object.freeze([0.34, 13, 4.30]),
]);

/** Signed radial offset (m) of the shoreline at `bearing` (radians, `atan2(x, z)`). */
export function warpRadius(bearing) {
  const a = Number.isFinite(bearing) ? bearing : 0;
  let sum = 0;
  for (let i = 0; i < SHORE_WARP_HARMONICS.length; i++) {
    const h = SHORE_WARP_HARMONICS[i];
    sum += h[0] * Math.sin(h[1] * a + h[2]);
  }
  return sum;
}

// ---------------------------------------------------------------------------
// profile authoring
// ---------------------------------------------------------------------------

/**
 * Control knots of the radial profile, derived from the map's `terrain` part so the beach width
 * scales with `island.landRadius` instead of being hard-coded.
 *
 * `dryTo`   flat-to-slope break (the dry sand apron ends, the beach face starts)
 * `waterline` radius where the beach face crosses sea level
 * `wade`    radius at `WADE_DEPTH` (the guard ring sits just outside it)
 *
 * @returns {Array<[number, number]>} [radius, height] pairs, radius ascending, height descending
 */
export function shoreKnots({ landRadius, level, bedOuter, bedDrop }) {
  const dryTo = landRadius - 7.5;
  const waterline = landRadius - 3.5;
  return [
    [0, 0],
    [Math.max(2, dryTo - 3.5), -0.004],
    [dryTo, -0.008],
    [dryTo + 1.6, -0.10],
    [waterline - 0.9, level * 0.62],
    [waterline, level],
    [waterline + 1.5, level - 0.26],
    [waterline + 3.2, level - 0.50],
    [waterline + 5.4, level - 0.88],
    [waterline + 8.2, level - 1.45],
    [waterline + 12.5, level - 2.35],
    [waterline + 18.5, level - 3.55],
    [bedOuter - 6, level - 5.35],
    [bedOuter, bedDrop],
    [bedOuter + 20, bedDrop - 0.9],
    [SHORE_LUT_MAX, bedDrop - 1.5],
  ];
}

/**
 * Monotone cubic Hermite (Fritsch–Carlson) interpolation of ascending `xs`.
 * Returns a sampler `(x) => y`. Outside the range the end slopes are extrapolated.
 */
function monotoneSampler(xs, ys) {
  const n = xs.length;
  const h = new Array(n - 1);
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = Math.max(1e-6, xs[i + 1] - xs[i]);
    d[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  // tangents: average of the neighbouring secants, flattened at local extrema
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) * 0.5;
  }
  // Fritsch–Carlson monotonicity clamp
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  const firstSlope = d[0];
  const lastIndex = n - 1;
  return function sample(x) {
    if (x <= xs[0]) return ys[0] + (x - xs[0]) * firstSlope;
    if (x >= xs[lastIndex]) return ys[lastIndex] + (x - xs[lastIndex]) * d[lastIndex - 1];
    let lo = 0;
    let hi = lastIndex;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const t = (x - xs[lo]) / h[lo];
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * ys[lo] + h10 * h[lo] * m[lo] + h01 * ys[lo + 1] + h11 * h[lo] * m[lo + 1];
  };
}

/**
 * Bake the radial profile into the uniform LUT the GPU samples.
 * @param {(r:number)=>number} yAt
 * @returns {Float32Array} SHORE_LUT_SIZE heights, `data[i] = yAt(i * SHORE_LUT_MAX / (SIZE-1))`
 */
export function createShoreLut(yAt) {
  const data = new Float32Array(SHORE_LUT_SIZE);
  const step = SHORE_LUT_MAX / (SHORE_LUT_SIZE - 1);
  for (let i = 0; i < SHORE_LUT_SIZE; i++) data[i] = yAt(i * step);
  return data;
}

/** CPU-side evaluation of the baked LUT (identical to the GPU's manual lerp). */
export function readShoreLut(data, r) {
  const step = SHORE_LUT_MAX / (SHORE_LUT_SIZE - 1);
  const x = clamp(r / step, 0, SHORE_LUT_SIZE - 1.001);
  const i = Math.floor(x);
  const f = x - i;
  const a = data[i];
  const b = data[Math.min(SHORE_LUT_SIZE - 1, i + 1)];
  return a + (b - a) * f;
}

// ---------------------------------------------------------------------------
// the profile object
// ---------------------------------------------------------------------------

/**
 * Resolve the whole shoreline description from the map's `terrain` part.
 *
 * @param {object} terrain normalised `data.terrain` (island + sea + legacy boundary)
 * @returns {object} shoreline profile (see properties below); all radii in metres, all angles in radians
 */
export function shoreProfile(terrain = {}) {
  const island = terrain?.island ?? {};
  const sea = terrain?.sea ?? {};
  const landRadius = num(island?.landRadius, 57);
  const level = num(sea?.level, -0.38);
  const bedOuter = Math.max(landRadius + 18, num(sea?.bedOuter, 96));
  const bedDrop = num(sea?.bedDrop, -7.5);
  const grassRadius = num(island?.grassRadius, landRadius - 13);
  const beachInner = num(island?.beachInner, grassRadius - 3);
  const segments = Math.max(96, Math.round(num(island?.segments, 168)));
  const seed = num(island?.seed, 7712);

  const dryTo = landRadius - 7.5;
  const waterline = landRadius - 3.5;
  const knots = shoreKnots({ landRadius, level, bedOuter, bedDrop });
  const yAt = monotoneSampler(
    knots.map((k) => k[0]),
    knots.map((k) => k[1]),
  );

  /** Flat (un-warped) radial height. */
  const height = (r) => yAt(Math.max(0, r));
  /** Warped shoreline height at a world position. */
  const Y = (x, z) => {
    const r = Math.hypot(x, z);
    if (r < 1e-4) return height(0);
    return yAt(Math.max(0, r - warpRadius(Math.atan2(x, z))));
  };
  const depthAt = (x, z) => level - Y(x, z);
  /** Water depth of the (flat) profile at a radius, used for the lagoon colouring. */
  const depthOfRadius = (r) => level - height(r);

  // solve the wade radius (depth == WADE_DEPTH) on the unwarped profile, outward of the waterline
  let wadeRadius = waterline;
  {
    let lo = waterline;
    let hi = landRadius + 14;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) * 0.5;
      if (depthOfRadius(mid) < WADE_DEPTH) lo = mid;
      else hi = mid;
    }
    wadeRadius = (lo + hi) * 0.5;
  }
  // The collision guard follows the warped waterline; the flat version is kept for tooling and
  // for the map validator's "is this placement inside the playable ring" allowance.
  const warpMin = -SHORE_WARP_HARMONICS.reduce((sum, h) => sum + Math.abs(h[0]), 0);
  const guardOffset = 0.35;
  const guardRadius = wadeRadius + guardOffset;
  const guardRadiusAt = (bearing) => guardRadius + warpRadius(bearing);

  const lut = createShoreLut(yAt);

  return {
    terrain,
    landRadius,
    level,
    bedOuter,
    bedDrop,
    grassRadius,
    beachInner,
    segments,
    seed,
    dryTo,
    waterline,
    wadeDepth: WADE_DEPTH,
    wadeRadius,
    guardRadius,
    guardRadiusAt,
    warpMin,
    warpMax: -warpMin,
    knots,
    lut,
    lutSize: SHORE_LUT_SIZE,
    lutMax: SHORE_LUT_MAX,
    /** flat radial height (ignores the bearing warp) */
    height,
    /** world-position shoreline height (beach slope + seabed) */
    Y,
    /** world-position water depth, negative above the waterline */
    depthAt,
    /** warped waterline radius at a bearing */
    waterlineAt: (bearing) => waterline + warpRadius(bearing),
    /** warped radius of a given flat radius at a bearing */
    withWarp: (radius, bearing) => radius + warpRadius(bearing),
  };
}

// ---------------------------------------------------------------------------
// walkable ground + the wading guard
// ---------------------------------------------------------------------------

/**
 * The reef-rock belt that used to close the play ring is gone, so the only thing that stops the
 * player is the water itself. Rather than a ring of invisible collision boxes (which the AABB
 * approximation would bulge 1.2 m into the shallows and which `map-audit` would flag as air
 * walls), the guard is an **exact radial clamp**: `clampToGuard()` in the player controller and
 * in the enemy steering. It follows the warped waterline, so the player wades to the same depth
 * on every bearing and then slides along the shore instead of hitting a wall.
 *
 * @param {object} profile result of `shoreProfile()`
 * @param {{x:number,z:number}} position  mutable position (y untouched)
 * @param {number} [offset] extra metres of allowed wading
 * @returns {boolean} true when the position was pulled back
 */
export function clampToGuard(profile, position, offset = 0) {
  if (!profile || !position) return false;
  const x = Number(position.x);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const r = Math.hypot(x, z);
  if (r < 1e-4) return false;
  const limit = profile.guardRadiusAt(Math.atan2(x, z)) + offset;
  if (r <= limit) return false;
  const k = limit / r;
  position.x = x * k;
  position.z = z * k;
  return true;
}

// ---------------------------------------------------------------------------
// GPU side: shared GLSL + uniform names
// ---------------------------------------------------------------------------

/** Uniform declarations the shoreline snippet expects. */
export const SHORE_GLSL_UNIFORMS = /* glsl */ `
  uniform sampler2D uShoreLut;   // 1-D height LUT (nearest filtered, manual lerp)
  uniform float uShoreLutStep;   // metres between texels
  uniform vec3 uShoreWarpAmp;    // warp harmonic amplitudes
  uniform vec3 uShoreWarpFreq;   // warp harmonic frequencies
  uniform vec3 uShoreWarpPhase;  // warp harmonic phases
  uniform float uShoreLevel;     // sea level (m)
`;

/**
 * Shared shoreline GLSL: the bearing warp, the LUT height sampler and the water depth.
 * Must stay in lock-step with `warpRadius()` / `createShoreLut()` above.
 */
export const SHORE_GLSL = /* glsl */ `
  float shoreWarp(float bearing) {
    vec3 s = sin(uShoreWarpFreq * bearing + uShoreWarpPhase);
    return dot(uShoreWarpAmp, s);
  }

  float shoreHeight(float radius) {
    float x = clamp(radius / uShoreLutStep, 0.0, ${SHORE_LUT_SIZE - 1}.0 - 1.001);
    float i = floor(x);
    float f = x - i;
    float u0 = (i + 0.5) / ${SHORE_LUT_SIZE}.0;
    float u1 = (min(i + 1.0, ${SHORE_LUT_SIZE - 1}.0) + 0.5) / ${SHORE_LUT_SIZE}.0;
    float y0 = texture2D(uShoreLut, vec2(u0, 0.5)).r;
    float y1 = texture2D(uShoreLut, vec2(u1, 0.5)).r;
    return mix(y0, y1, f);
  }

  /** Beach / seabed height at a world XZ position (bearing = atan2(x, z)). */
  float shoreGroundY(vec2 worldXZ) {
    float radius = length(worldXZ);
    if (radius < 1e-4) return shoreHeight(0.0);
    float bearing = atan(worldXZ.x, worldXZ.y);   // atan2(x, z)
    return shoreHeight(max(0.0, radius - shoreWarp(bearing)));
  }

  /** Water depth at a world XZ position (positive under water, negative on dry sand). */
  float shoreWaterDepth(vec2 worldXZ, float surfaceY) {
    return surfaceY - shoreGroundY(worldXZ);
  }
`;

/**
 * `THREE.DataTexture`-ready LUT payload (RGBA float, nearest filtered).
 * `island-water.js` wraps this in a `DataTexture`; the alpha/duplicate channels are unused.
 * @param {Float32Array} lut result of `createShoreLut` / `profile.lut`
 */
export function shoreLutTextureData(lut) {
  const out = new Float32Array(SHORE_LUT_SIZE * 4);
  for (let i = 0; i < SHORE_LUT_SIZE; i++) {
    const y = lut[i];
    out[i * 4] = y;
    out[i * 4 + 1] = y;
    out[i * 4 + 2] = y;
    out[i * 4 + 3] = 1;
  }
  return out;
}

/** Uniform values (three-free descriptors; the water builder turns them into THREE.Vector3). */
export function shoreUniformValues(profile) {
  const harmonics = SHORE_WARP_HARMONICS;
  const pad = (i, k) => (harmonics[i] ? harmonics[i][k] : 0);
  return {
    lutStep: profile.lutMax / (profile.lutSize - 1),
    warpAmp: [pad(0, 0), pad(1, 0), pad(2, 0)],
    warpFreq: [pad(0, 1), pad(1, 1), pad(2, 1)],
    warpPhase: [pad(0, 2), pad(1, 2), pad(2, 2)],
    level: profile.level,
  };
}

export default shoreProfile;
