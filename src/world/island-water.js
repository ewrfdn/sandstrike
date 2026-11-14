/**
 * SANDSTRIKE // tropical ocean: animated water plane + rolling surf foam ring.
 *
 * Visual only (no collision, no raycast surface): the playable ring is closed by the reef
 * ridge, so the player never walks into the sea. The shader fakes everything a humid
 * dawn lagoon needs:
 *   - turquoise shallows fading to deep blue ocean (noise-warped depth band)
 *   - fresnel sky reflection that reuses the same simplified sky gradient as the dome,
 *     so the sea and the sky meet without a seam
 *   - a long golden sun road / glitter path with sparkle (HDR, so bloom picks it up)
 *   - three cross-swells whose fine chop fades out with distance (no moire at the horizon)
 *   - translucent shallows that let the sand/seabed show through
 *   - exp2 fog toward the same sky colour, so the far sea dissolves into the morning haze
 *
 * Contract (ISLAND_MAP_SPEC.md §4.2):
 *   buildIslandWater(ctx) -> { mesh, foam, level, update(time) }
 *
 * Draw calls: 2 (water plane + surf ring).
 */
import * as THREE from 'three';
import { landRadius } from './island-shape.js';

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const vec3 = (value, fallback) => (Array.isArray(value) && value.length >= 3 ? value : fallback);

const WATER_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;

  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uDust;
  uniform vec3 uSunColor;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uFogDensity;
  uniform float uLandRadius;
  uniform float uFadeNear;
  uniform float uFadeFar;

  // Same simplified sky gradient the dome draws (minus the clouds), used for the
  // fresnel reflection and for the distance haze so the horizon has no seam.
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

  // Analytic cross-swell: writes the horizontal height gradient (slope, metres per metre)
  // and the wave height so the body colour can carry the ripple bands. Four wave trains
  // cross at >30 degrees and the lookup domain is warped, so the surface never reads as
  // the parallel "Venetian blind" bands of a single sine train. High-frequency terms fade
  // with the lod factor so distant water never aliases.
  void waveField(vec2 p, float t, float lod, out vec2 grad, out float height) {
    // smooth domain warp: the same sine train gets a slowly bending phase in space+time
    vec2 q = p + vec2(sin(p.y * 0.11 + t * 0.21) * 2.2, sin(p.x * 0.095 - t * 0.17) * 2.0);
    grad = vec2(0.0);
    height = 0.0;
    float ph;
    // A: 21 m swell, heading 12 deg
    ph = dot(vec2(0.978, 0.208), q) * 0.30 + t * 0.48;
    grad += vec2(0.978, 0.208) * 0.054 * cos(ph);
    height += 0.180 * sin(ph);
    // B: 13 m cross swell, heading -46 deg
    ph = dot(vec2(0.695, -0.719), q) * 0.48 + t * 0.66;
    grad += vec2(0.695, -0.719) * 0.048 * cos(ph);
    height += 0.100 * sin(ph);
    // C: 7.5 m chop, heading 63 deg (carries further out than D/E to keep the far field varied)
    ph = dot(vec2(0.454, 0.891), q) * 0.84 + t * 0.98;
    grad += vec2(0.454, 0.891) * (0.042 * sqrt(lod)) * cos(ph);
    height += (0.050 * sqrt(lod)) * sin(ph);
    // D: 4.2 m ripple, heading -18 deg
    ph = dot(vec2(0.951, -0.309), q) * 1.50 + t * 1.45;
    grad += vec2(0.951, -0.309) * (0.032 * lod * lod) * cos(ph);
    height += (0.021 * lod * lod) * sin(ph);
    // F: 11.4 m swell, heading 51 deg (breaks the two-train interference)
    ph = dot(vec2(0.62, 0.78), q) * 0.55 + t * 0.72;
    grad += vec2(0.62, 0.78) * (0.036 * sqrt(lod)) * cos(ph);
    height += (0.065 * sqrt(lod)) * sin(ph);
    // E: 2.6 m capillary chop, heading 88 deg
    ph = dot(vec2(0.035, 0.999), q) * 2.42 + t * 1.90;
    grad += vec2(0.035, 0.999) * (0.024 * lod * lod) * cos(ph);
    height += (0.010 * lod * lod) * sin(ph);
  }

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 viewDir = toCam / max(dist, 0.0001);
    vec2 p = vWorld.xz;
    float r = length(p);
    float azimuth = atan(p.y, p.x);

    // ---- swelling normal + wave body -------------------------------------
    float lod = exp(-dist * 0.016);
    float breathe = 0.84 + 0.16 * sin(uTime * 0.11 + r * 0.021);
    // slow gust field: breaks the regular interference pattern of the far swell trains
    float gust = 0.74 + 0.26 * sin(dot(p, vec2(0.021, 0.017)) + uTime * 0.11)
                      * cos(dot(p, vec2(-0.013, 0.024)) - uTime * 0.07);
    vec2 grad;
    float waveH;
    waveField(p, uTime, lod, grad, waveH);
    grad *= breathe * gust;
    waveH *= gust * 1.15;
    vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));

    // ---- water body: turquoise lagoon -> deep blue ocean ------------------
    float warp = 5.5 * sin(azimuth * 3.0 + 1.7) + 3.5 * sin(azimuth * 7.0 - 0.9);
    float deepT = smoothstep(uLandRadius - 0.5, uLandRadius + 36.0, r + warp);
    vec3 body = mix(uShallow, uDeep, pow(deepT, 0.68));
    // swell shading: crests catch light, troughs sink into the depth colour
    body *= 0.92 + 0.14 * clamp(waveH * 1.25 + 0.5, 0.0, 1.0);
    // sunlight glowing up through the shallows + a warm low-sun sheen
    body += uShallow * 0.22 * (1.0 - deepT);
    body += uSunColor * 0.008 * (1.0 - deepT);
    // caustic shimmer on the sand (only over the shallows)
    float c1 = sin(p.x * 0.85 + uTime * 0.62) * sin(p.y * 0.74 - uTime * 0.54);
    float c2 = sin(p.x * 1.63 - uTime * 0.41 + 1.7) * sin(p.y * 1.47 + uTime * 0.37);
    float cau = pow(clamp(c1 * 0.5 + 0.5, 0.0, 1.0), 9.0) + pow(clamp(c2 * 0.5 + 0.5, 0.0, 1.0), 13.0);
    body += uSunColor * 0.030 * cau * (1.0 - deepT);

    // ---- fresnel sky reflection -----------------------------------------
    vec3 refl = reflect(-viewDir, n);
    refl.y = max(refl.y, 0.012);
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 5.0);
    fres = clamp(fres * 1.08, 0.0, 1.0);
    vec3 col = mix(body, skyColor(refl), fres);

    // ---- golden sun road / glitter ---------------------------------------
    vec3 sunDir = normalize(uSunDir);
    vec3 halfV = normalize(sunDir + viewDir);
    float nh = max(dot(n, halfV), 0.0);
    vec2 flatView = normalize(viewDir.xz + vec2(1e-4));
    vec2 flatSun = normalize(sunDir.xz + vec2(1e-4));
    float toward = pow(max(dot(flatView, flatSun), 0.0), 6.0);
    float shimmer = 0.55 + 0.45 * sin(uTime * 1.7 + r * 2.3 + azimuth * 3.0);
    float glint = pow(nh, 480.0) * 3.0 + pow(nh, 1600.0) * 11.0;
    col += uSunColor * glint * (0.7 + toward * 4.5) * shimmer;
    // broad sheen so the swell also reads when the camera looks down at the shallows
    col += uSunColor * pow(nh, 42.0) * 0.055;
    // broad warm sheen on the water toward the sun (the "sun road")
    col += uSunColor * toward * pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 6.0) * 0.09;

    // ---- dissolve into the morning haze ---------------------------------
    float haze = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    vec3 hazeCol = skyColor(vec3(viewDir.x, 0.012, viewDir.z));
    col = mix(col, hazeCol, clamp(haze, 0.0, 1.0) * 0.97);

    // ---- translucent shallows, opaque deep water ------------------------
    // The lagoon bed already paints the turquoise-to-deep-blue gradient; the water only
    // needs to tint and veil it, so the bed's low-poly facets never read as pale blocks.
    float alpha = mix(0.93, 0.998, smoothstep(0.0, 0.25, deepT));
    alpha = mix(alpha, 0.997, fres * 0.9);
    alpha *= 1.0 - smoothstep(uFadeNear, uFadeFar, dist);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

const FOAM_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FOAM_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  uniform float uTime;
  uniform float uLandRadius;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uFoamColor;

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
    return vnoise(p) * 0.62 + vnoise(p * 2.15 + 7.3) * 0.38;
  }

  void main() {
    float r = length(vWorld.xz);
    float ang = atan(vWorld.z, vWorld.x);
    // Broad, continuous foam field: two value-noise octaves, no step/floor thresholds, so
    // the breaker never quantises into rectangles. Everything lives in the narrow band
    // r in [landRadius-2.5, landRadius+2] (see the ring geometry).
    vec2 q = vec2(ang * 17.0, r * 0.9 + uTime * 0.34);
    float n = fbm2(q);
    float n2 = fbm2(vec2(ang * 39.0 - uTime * 0.11, r * 2.1 - uTime * 0.72));

    // breaker line: a soft Gaussian around the waterline, broken up by the foam field
    float d = r - (uLandRadius + 0.2);
    float band = exp(-pow(d / 1.25, 2.0));
    float breaks = smoothstep(0.30, 0.78, n * 0.72 + n2 * 0.28 + 0.12);
    float foam = band * breaks;

    // a thin wash trailing just behind the breaker (still inside the narrow band)
    float d2 = r - (uLandRadius + 1.35);
    float wash = exp(-pow(d2 / 0.7, 2.0)) * smoothstep(0.35, 0.72, n2) * 0.5;
    foam += wash * 0.7;

    // wet sand just inside the waterline
    float wet = smoothstep(uLandRadius - 2.4, uLandRadius - 0.1, r) * smoothstep(uLandRadius + 0.1, uLandRadius - 0.5, r);
    vec3 wetColor = vec3(0.26, 0.21, 0.13);
    float a = clamp(foam, 0.0, 1.0) * 0.82;
    vec3 col = uFoamColor;
    // foam catches the low sun
    vec3 flatSun = normalize(vec3(uSunDir.x, 0.0001, uSunDir.z));
    vec3 flatPos = normalize(vec3(vWorld.x, 0.0001, vWorld.z));
    float toward = clamp(dot(flatPos, flatSun) * 0.5 + 0.5, 0.0, 1.0);
    col += uSunColor * 0.10 * toward;

    a = max(a, wet * 0.34);
    col = mix(wetColor, col, clamp(a * 1.7, 0.0, 1.0));
    a = clamp(a, 0.0, 0.9);
    if (a < 0.008) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * Build the ocean + surf.
 * @param {object} ctx world context
 * @returns {{ mesh: THREE.Mesh, foam: THREE.Mesh, level: number, update: (time:number)=>void }}
 */
export function buildIslandWater(ctx) {
  const terrain = ctx.data?.terrain ?? {};
  const sea = terrain.sea ?? {};
  const env = ctx.data?.environment ?? {};
  const sky = env.sky ?? {};

  const level = num(sea.level, -0.38);
  const radius = landRadius(terrain);
  // The sea has to run to the horizon: 900 m plane, faded out at ~380 m so the
  // camera far plane (420 m) and the sky dome never show a hard edge.
  const size = Math.max(900, num(sea.distance, 900));
  const fadeNear = Math.min(320, size * 0.34);
  const fadeFar = Math.min(400, size * 0.44);

  const sunDir = vec3(sky.sunDirection, [0.82, 0.3, 0.49]);
  const horizon = vec3(sky.horizon, [1.3, 0.56, 0.2]);
  const zenith = vec3(sky.zenith, [0.045, 0.145, 0.42]);
  const dust = vec3(sky.dust, [1.05, 0.6, 0.28]);
  const sunColor = vec3(sky.sunColor, [2.5, 1.45, 0.68]);
  const shallow = vec3(sea.shallow, [0.1, 0.34, 0.32]);
  const deep = vec3(sea.deep, [0.02, 0.09, 0.13]);
  const fogDensity = num(env.fog?.density, 0.0052);

  const sun = new THREE.Vector3(sunDir[0], sunDir[1], sunDir[2]).normalize();

  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: sun.clone() },
      uHorizon: { value: new THREE.Vector3(horizon[0], horizon[1], horizon[2]) },
      uZenith: { value: new THREE.Vector3(zenith[0], zenith[1], zenith[2]) },
      uDust: { value: new THREE.Vector3(dust[0], dust[1], dust[2]) },
      uSunColor: { value: new THREE.Vector3(sunColor[0], sunColor[1], sunColor[2]) },
      // lagoon turquoise: mix the terrain "shallow" value toward a saturated sunlit
      // turquoise so the lagoon reads as tropical water even at a grazing angle
      uShallow: {
        value: new THREE.Vector3(
          shallow[0] * 0.45 + 0.055 * 0.55,
          shallow[1] * 0.45 + 0.42 * 0.55,
          shallow[2] * 0.45 + 0.44 * 0.55
        ),
      },
      uDeep: {
        value: new THREE.Vector3(
          deep[0] * 0.3 + 0.012 * 0.7,
          deep[1] * 0.3 + 0.075 * 0.7,
          deep[2] * 0.3 + 0.17 * 0.7
        ),
      },
      uFogDensity: { value: fogDensity },
      uLandRadius: { value: radius },
      uFadeNear: { value: fadeNear },
      uFadeFar: { value: fadeFar },
    },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'island-water';
  mesh.position.y = level;
  mesh.renderOrder = 2;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  ctx.disposables.push(geo, material);

  // Surf foam: one ring mesh carrying the breaker line, the broken wash band and the
  // wet sand darkening — a single draw call for the whole shoreline.
  const foamGeo = new THREE.RingGeometry(radius - 2.5, radius + 2.0, 256, 1);
  foamGeo.rotateX(-Math.PI / 2);
  const foamMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLandRadius: { value: radius },
      uSunColor: { value: new THREE.Vector3(sunColor[0] * 0.35, sunColor[1] * 0.35, sunColor[2] * 0.35) },
      uSunDir: { value: sun.clone() },
      uFoamColor: { value: new THREE.Vector3(0.92, 0.96, 0.94) },
    },
    vertexShader: FOAM_VERT,
    fragmentShader: FOAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const foam = new THREE.Mesh(foamGeo, foamMat);
  foam.name = 'island-surf';
  foam.position.y = level + 0.02;
  foam.renderOrder = 3;
  foam.matrixAutoUpdate = false;
  foam.updateMatrix();
  ctx.scene.add(foam);
  ctx.objects.push(foam);
  ctx.disposables.push(foamGeo, foamMat);

  const water = {
    mesh,
    foam,
    level,
    update(time) {
      material.uniforms.uTime.value = time;
      foamMat.uniforms.uTime.value = time;
    },
  };
  ctx.water = water;
  return water;
}

export default buildIslandWater;
