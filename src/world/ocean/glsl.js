/**
 * SANDSTRIKE // tropical ocean — GLSL library shared by the water, surf and wet-sand
 * shaders.
 *
 * The three meshes have to agree about the displacement to the millimetre (the foam ring
 * used to be a separate radius guess, which is why it never hugged the moving waterline),
 * so the wave model lives here once and every shader includes the exact same functions:
 *
 *   oceanSwell()   low-frequency directional swell trains (displacement; no chop)
 *   oceanSurface() swell + shallow-water run-up ("swash") that runs up the beach
 *   oceanChop()    high-frequency ripple gradient, fragment normals only, LOD-faded
 *
 * `oceanSurface()` samples the shared shoreline LUT (`shoreGroundY()` from island-shore.js)
 * to know the local depth, so it must be included *after* `SHORE_GLSL`. That is the whole
 * trick behind the moving waterline: the swell fades out where the water gets shallow so
 * the bed can never be exposed, while the run-up term only pushes the surface *up* and is
 * clamped to stay at least 5 cm above the seabed — the surf mesh then looks for depth≈0.
 *
 * Colours are linear HDR throughout: the scene is rendered into a HalfFloat composer
 * target and ACES-tone-mapped by the OutputPass, exactly like the sky dome.
 */

/** Small helpers + procedural noise used by every ocean shader (no textures). */
export const OCEAN_MATH_GLSL = /* glsl */ `
  float sat(float x) { return clamp(x, 0.0, 1.0); }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm2(vec2 p) {
    return vnoise(p) * 0.62 + vnoise(p * 2.07 + 7.3) * 0.38;
  }

  float fbm3(vec2 p) {
    return vnoise(p) * 0.54 + vnoise(p * 2.11 + 4.7) * 0.29 + vnoise(p * 4.27 - 2.3) * 0.17;
  }

  mat2 rot2(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat2(c, -s, s, c);
  }

  // Rotated multi-octave value noise: rotating every octave breaks the axis-aligned
  // square blobs of plain 2-D value noise, which is what makes cheap foam look tiled.
  float fbm2r(vec2 p) {
    vec2 q = p;
    float sum = 0.0;
    float amp = 0.552;
    for (int i = 0; i < 3; i++) {
      sum += vnoise(q) * amp;
      q = rot2(1.13) * q * 2.07 + vec2(5.3, -2.7);
      amp *= 0.52;
    }
    return sum;
  }
`;

/** Directional palette uniforms: identical values drive the water body and the sky dome. */
export const OCEAN_PALETTE_UNIFORMS = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uDust;
`;

/**
 * The same simplified sunrise sky gradient the dome draws (minus the cloud cards), kept
 * byte-compatible with the old island-water shader so the sea and sky still meet cleanly.
 */
export const OCEAN_SKY_GLSL = /* glsl */ `
  vec3 skyColor(vec3 dir) {
    vec3 d = normalize(dir);
    float h = max(d.y, 0.0);
    float sunDot = clamp(dot(d, uSunDir), 0.0, 1.0);
    vec3 flatDir = normalize(vec3(d.x, 0.0001, d.z));
    vec3 flatSun = normalize(vec3(uSunDir.x, 0.0001, uSunDir.z));
    float towardSun = clamp(dot(flatDir, flatSun), 0.0, 1.0);
    vec3 c = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.62));
    float band = exp(-h * 10.5) * (0.5 + 0.5 * towardSun);
    c = mix(c, uDust, clamp(band, 0.0, 1.0) * 0.55);
    c += uSunColor * pow(sunDot, 6.0) * 0.16;
    c += uSunColor * pow(sunDot, 42.0) * 0.5;
    return c;
  }
`;

/** Swell trains of the low-frequency displacement (kept from the old waveField, refined). */
export const OCEAN_SWELL_TRAINS = Object.freeze([
  Object.freeze({ dir: Object.freeze([0.978, 0.208]), length: 21.0, amp: 0.185, speed: 0.48 }),
  Object.freeze({ dir: Object.freeze([0.695, -0.719]), length: 13.0, amp: 0.105, speed: 0.66 }),
  Object.freeze({ dir: Object.freeze([0.620, 0.780]), length: 11.4, amp: 0.070, speed: 0.72 }),
  Object.freeze({ dir: Object.freeze([0.454, 0.891]), length: 7.5, amp: 0.050, speed: 0.98 }),
  Object.freeze({ dir: Object.freeze([0.951, -0.309]), length: 5.2, amp: 0.030, speed: 1.25 }),
  Object.freeze({ dir: Object.freeze([0.035, 0.999]), length: 3.4, amp: 0.019, speed: 1.60 }),
]);

/** High-frequency trains that only bend the analytic normal (never the displacement). */
export const OCEAN_CHOP_TRAINS = Object.freeze([
  Object.freeze({ dir: Object.freeze([0.700, 0.714]), length: 4.2, amp: 0.022, speed: 1.45 }),
  Object.freeze({ dir: Object.freeze([-0.554, 0.832]), length: 2.6, amp: 0.014, speed: 1.90 }),
  Object.freeze({ dir: Object.freeze([0.951, -0.309]), length: 1.7, amp: 0.008, speed: 2.35 }),
  Object.freeze({ dir: Object.freeze([0.196, -0.981]), length: 1.15, amp: 0.005, speed: 2.80 }),
]);

const TAU = Math.PI * 2;
const freqOf = (train) => TAU / Math.max(0.5, train.length);

/** GLSL uniform declarations for the wave model (array sizes come from `defines`). */
export const OCEAN_WAVE_UNIFORMS = /* glsl */ `
  uniform vec2 uWaveDir[OCEAN_WAVES];
  uniform float uWaveFreq[OCEAN_WAVES];
  uniform float uWaveSpeed[OCEAN_WAVES];
  uniform float uWaveAmp[OCEAN_WAVES];
  uniform vec2 uChopDir[OCEAN_CHOP];
  uniform float uChopFreq[OCEAN_CHOP];
  uniform float uChopSpeed[OCEAN_CHOP];
  uniform float uChopAmp[OCEAN_CHOP];
  uniform float uSwashFreq;
  uniform float uSwashSpeed;
`;

/**
 * Wave model. Requires `shoreGroundY()` + `uShoreLevel` from island-shore.js and the
 * `OCEAN_WAVES` / `OCEAN_CHOP` defines (the quality tier injects them via material.defines).
 */
export const OCEAN_WAVE_GLSL = /* glsl */ `
  // Low-frequency swell: sum of directional trains, returns the height offset above the
  // still water level and writes the analytic horizontal gradient (dh/dx, dh/dz).
  float oceanSwell(vec2 p, float t, out vec2 grad) {
    // slowly bending phase domain: identical in the displacement and the normal so the
    // shading always matches the geometry that was actually moved
    vec2 q = p + vec2(sin(p.y * 0.11 + t * 0.21) * 2.2, sin(p.x * 0.095 - t * 0.17) * 2.0);
    grad = vec2(0.0);
    float height = 0.0;
    for (int i = 0; i < OCEAN_WAVES; i++) {
      float ph = dot(uWaveDir[i], q) * uWaveFreq[i] + t * uWaveSpeed[i];
      height += uWaveAmp[i] * sin(ph);
      grad += uWaveDir[i] * (uWaveAmp[i] * uWaveFreq[i] * cos(ph));
    }
    return height;
  }

  // Fine chop: fragment-only normal detail. lod fades the high frequencies with distance
  // so the far sea never aliases into moire.
  vec2 oceanChop(vec2 p, float t, float lod) {
    vec2 grad = vec2(0.0);
    float k = lod * lod;
    for (int i = 0; i < OCEAN_CHOP; i++) {
      float ph = dot(uChopDir[i], p) * uChopFreq[i] + t * uChopSpeed[i];
      grad += uChopDir[i] * (uChopAmp[i] * uChopFreq[i] * cos(ph) * k);
    }
    // slow gust field: breaks the regular interference pattern of the far swell trains
    float gust = 0.72 + 0.28 * sin(dot(p, vec2(0.021, 0.017)) + t * 0.11)
               * cos(dot(p, vec2(-0.013, 0.024)) - t * 0.07);
    return grad * gust;
  }

  // Complete displaced surface height offset for a world XZ position:
  //   open-sea swell (masked out over the shallow shelf so troughs cannot drain the bed)
  // + shore run-up / swash (positive-dominant bore that runs up the beach and drains back)
  float oceanSurface(vec2 p, float t, out vec2 grad) {
    float depth = uShoreLevel - shoreGroundY(p);
    float radius = length(p);
    vec2 radial = radius > 0.001 ? p / radius : vec2(0.0, 1.0);
    float bearing = atan(p.x, p.y);

    // ---- open-sea swell, faded in with depth so the lagoon stays stable
    vec2 swellGrad;
    float swell = oceanSwell(p, t, swellGrad);
    float swellMask = smoothstep(0.12, 2.4, depth);
    swell *= swellMask;
    swellGrad *= swellMask;

    // ---- shallow-water run-up: a bore that arrives at slightly different times around
    // the island (3 bearing harmonics) so the whole waterline never breathes in unison.
    float arrival = 1.05 * sin(bearing * 2.0 + 0.70)
                  + 0.72 * sin(bearing * 5.0 - 1.90)
                  + 0.42 * sin(bearing * 9.0 + 2.60);
    float runPh = radius * uSwashFreq + t * uSwashSpeed + arrival;
    float runAmp = (0.075 + 0.210 * exp(-max(depth, 0.0) * 0.70)) * smoothstep(-0.45, 0.22, depth);
    runAmp *= 0.60 + 0.40 * sin(t * 0.21 + bearing * 3.0 + 0.60);
    float run = sin(runPh) * runAmp;
    // keep at least 5 cm of water above the bed: the surface may never expose the seabed
    float floorH = -max(depth - 0.05, 0.0);
    run = max(run, floorH - swell);

    grad = swellGrad + radial * (cos(runPh) * runAmp * uSwashFreq);
    return swell + run;
  }
`;

/** Build-time seabed capture lookup + procedural fallback bed colour. */
export const OCEAN_BOTTOM_UNIFORMS = /* glsl */ `
  uniform sampler2D uSeabed;
  uniform vec4 uSeabedRect; // xy = capture centre XZ, z = 1/(2*extent), w = 0|1 enabled
  uniform vec3 uSandShallow;
  uniform vec3 uSandDeep;
`;

export const OCEAN_BOTTOM_GLSL = /* glsl */ `
  /** 1 when the capture exists and the world XZ maps inside it. */
  float seabedMask(vec2 xz) {
    if (uSeabedRect.w < 0.5) return 0.0;
    vec2 uv = vec2(0.5 + (xz.x - uSeabedRect.x) * uSeabedRect.z,
                   0.5 - (xz.y - uSeabedRect.y) * uSeabedRect.z);
    vec2 inside = step(vec2(0.002), uv) * step(uv, vec2(0.998));
    return inside.x * inside.y;
  }

  vec3 seabedSample(vec2 xz) {
    vec2 uv = vec2(0.5 + (xz.x - uSeabedRect.x) * uSeabedRect.z,
                   0.5 - (xz.y - uSeabedRect.y) * uSeabedRect.z);
    return texture2D(uSeabed, clamp(uv, vec2(0.002), vec2(0.998))).rgb;
  }

  /** Procedural sea bed used by LOWEST / outside the capture: sand, weed and depth tint. */
  vec3 proceduralBottom(vec2 xz, float depth) {
    // rotated octaves: plain value noise at this scale reads as ~7 m axis-aligned squares
    float n = fbm2r(xz * 0.14 + 3.1);
    float n2 = fbm2r(xz * 0.55 - 1.7);
    vec3 sand = mix(uSandShallow, uSandShallow * 1.35, n) * (0.82 + 0.30 * n2);
    float weed = smoothstep(0.52, 0.86, fbm2r(xz * 0.21 + 11.3));
    sand = mix(sand, uSandDeep, weed * 0.55);
    return mix(sand, uSandDeep * 0.7, smoothstep(3.0, 16.0, depth));
  }
`;

/** Animated caustic light pattern (procedural, no texture). */
export const OCEAN_CAUSTIC_GLSL = /* glsl */ `
  float oceanCaustic(vec2 p, float t) {
    // three crossing gratings with a slowly bending domain: their zero-crossing lines
    // weave the bright cellular web of sunlight refracted onto a shallow sea bed
    vec2 q = p * 3.20;
    vec2 warp = vec2(sin(q.y * 0.71 + t * 0.43), sin(q.x * 0.63 - t * 0.35));
    float s1 = sin(q.x * 1.11 + warp.y * 1.25 + t * 0.62);
    float s2 = sin(q.y * 0.97 + warp.x * 1.15 - t * 0.51);
    float s3 = sin((q.x + q.y) * 0.74 + warp.x * 0.9 + t * 0.37);
    float sum = (s1 + s2 + s3) * 0.3333;
    float web = pow(clamp(1.0 - abs(sum), 0.0, 1.0), 9.0);
    float sparkle = pow(clamp(1.0 - abs(s1 * s2), 0.0, 1.0), 12.0) * 0.35;
    return web * 1.15 + sparkle;
  }
`;

/** Horizon haze: dissolve the far sea into the sky before the camera far plane. */
export const OCEAN_HAZE_UNIFORMS = /* glsl */ `
  uniform float uFogDensity;
`;

export const OCEAN_HAZE_GLSL = /* glsl */ `
  vec3 applyOceanHaze(vec3 col, float dist, vec3 viewDir) {
    float haze = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    vec3 hazeCol = skyColor(vec3(viewDir.x, 0.012, viewDir.z));
    return mix(col, hazeCol, clamp(haze, 0.0, 1.0));
  }
`;

/**
 * Build the THREE uniform payload for the wave model (arrays are cut to the tier's train
 * count, which equals the `OCEAN_WAVES` / `OCEAN_CHOP` shader defines).
 */
export function buildWaveUniforms(tier, THREE) {
  const swell = OCEAN_SWELL_TRAINS.slice(0, Math.max(1, Math.min(OCEAN_SWELL_TRAINS.length, tier.waveTrains)));
  const chop = OCEAN_CHOP_TRAINS.slice(0, Math.max(1, Math.min(OCEAN_CHOP_TRAINS.length, tier.chopTrains)));
  const toDir = (train) => new THREE.Vector2(train.dir[0], train.dir[1]).normalize();
  return {
    uWaveDir: { value: swell.map(toDir) },
    uWaveFreq: { value: swell.map(freqOf) },
    uWaveSpeed: { value: swell.map((train) => train.speed) },
    uWaveAmp: { value: swell.map((train) => train.amp) },
    uChopDir: { value: chop.map(toDir) },
    uChopFreq: { value: chop.map(freqOf) },
    uChopSpeed: { value: chop.map((train) => train.speed) },
    uChopAmp: { value: chop.map((train) => train.amp) },
    // ~24 m between run-up crests, arriving at ~2.1 m/s
    uSwashFreq: { value: TAU / 24.0 },
    uSwashSpeed: { value: 0.55 },
  };
}

/** Material defines for a tier (`OCEAN_WAVES` etc. must be integer literals). */
export function buildOceanDefines(tier) {
  return {
    OCEAN_WAVES: Math.max(1, tier.waveTrains | 0),
    OCEAN_CHOP: Math.max(1, tier.chopTrains | 0),
    OCEAN_REFRACT_STEPS: Math.max(1, tier.refractSteps | 0),
    OCEAN_CAUSTICS: tier.caustics ? 1 : 0,
  };
}
