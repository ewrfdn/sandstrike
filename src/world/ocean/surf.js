/**
 * SANDSTRIKE // tropical ocean — shoreline surf and the wet-sand band.
 *
 * Both meshes are *thin bands that follow the warped waterline*, built in profile space:
 * every vertex sits at `profile.waterlineAt(bearing) + offset`, so the geometry hugs the
 * real (wavy, non-circular) shoreline with ~0.3-1.2 m rings instead of covering the whole
 * lagoon shelf. The surf vertex shader then displaces the band with the exact same
 * `oceanSurface()` function as the water surface, so the foam rides the moving waterline.
 *
 * Foam shading (fragment):
 *   - the breakup fields are ANALYTIC travelling trig trains (warped by one another), not
 *     low-frequency value noise: no hash-cell borders, so the old axis-aligned white quilt
 *     cannot come back;
 *   - three layers: a thin lace line right on the swash edge, a narrow broken wash band
 *     behind it (alpha <= 0.35) and occasional small whitecaps (alpha <= 0.3);
 *   - alpha is smooth everywhere (no hard threshold/discard), and fades to zero with
 *     distance so the horizon never shimmers.
 *
 * The wet sand band uses a short wetness memory (surface height at t, t-1.6s, t-3.4s) so
 * the dark damp band advances with the run-up and drains back with the backwash.
 */
import * as THREE from 'three';
import { SHORE_GLSL, SHORE_GLSL_UNIFORMS } from '../island-shore.js';
import {
  OCEAN_MATH_GLSL,
  OCEAN_PALETTE_UNIFORMS,
  OCEAN_WAVE_GLSL,
  OCEAN_WAVE_UNIFORMS,
} from './glsl.js';

// --------------------------------------------------------------------------- surf foam

const SURF_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSurfLift;

  ${SHORE_GLSL_UNIFORMS}
  ${OCEAN_WAVE_UNIFORMS}
  ${SHORE_GLSL}
  ${OCEAN_WAVE_GLSL}

  varying vec3 vWorld;
  varying float vSurfaceY;
  varying float vBand;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec2 grad;
    float height = oceanSurface(world.xz, uTime, grad);
    float surfaceY = uShoreLevel + height;
    world.y = surfaceY + uSurfLift;
    vWorld = world.xyz;
    vSurfaceY = surfaceY;
    vBand = uv.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SURF_FRAG = /* glsl */ `
  precision highp float;

  varying vec3 vWorld;
  varying float vSurfaceY;
  varying float vBand;

  uniform float uTime;
  uniform vec3 uFoamColor;

  ${OCEAN_PALETTE_UNIFORMS}
  ${SHORE_GLSL_UNIFORMS}
  ${OCEAN_WAVE_UNIFORMS}

  ${OCEAN_MATH_GLSL}
  ${SHORE_GLSL}
  ${OCEAN_WAVE_GLSL}

  /**
   * Analytic "lace": two high-frequency travelling trains crossing each other, each
   * phase-warped by the other. Continuous in space and time (no hash cells, no seams),
   * and the warp keeps the interference from reading as a regular grid.
   */
  float laceField(vec2 p, float t, vec2 dirA, vec2 dirB, float freq) {
    float a = dot(p, dirA) * freq + t * 0.85 + sin(dot(p, dirB) * freq * 0.37 - t * 0.6) * 1.9;
    float b = dot(p, dirB) * freq * 1.13 - t * 1.05 + sin(dot(p, dirA) * freq * 0.41 + t * 0.7) * 1.7;
    return 0.5 + 0.5 * sin(a) * sin(b);
  }

  void main() {
    vec2 p = vWorld.xz;
    // per-fragment depth against the shared shore LUT: the waterline is resolved at pixel
    // precision, not at the (0.3-1.2 m) vertex rate
    float depth = vSurfaceY - shoreGroundY(p);
    float dist = length(cameraPosition - vWorld);
    float t = uTime;

    // ---------------------------------------------------- thin bright lace on the edge
    // the foam line is a *continuous* ribbon whose alpha + position wobble with an analytic
    // breakup field, so it reads as an irregular swash edge rather than a row of blobs
    float strokes = laceField(p, t, vec2(0.94, 0.34), vec2(-0.34, 0.94), 9.00);
    float strokes2 = laceField(p + vec2(3.7, -8.2), t * 1.31, vec2(0.61, -0.79), vec2(0.85, 0.53), 13.5);
    float breakup = smoothstep(0.24, 0.76, strokes * 0.62 + strokes2 * 0.38);
    float wobble = (breakup - 0.5) * 0.055; // +/-2.7 cm: the line advances and retreats
    float edgeDepth = max(depth + wobble, 0.0);
    float edgeBand = smoothstep(-0.004, 0.010, depth + wobble) * exp(-pow(edgeDepth / 0.026, 2.0));
    float edgeFoam = edgeBand * (0.42 + 0.58 * breakup);

    // ------------------------------------------------ narrow broken wash behind the edge
    float washBand = smoothstep(0.012, 0.05, depth) * (1.0 - smoothstep(0.10, 0.24, depth));
    float washLace = laceField(p + vec2(7.3, -3.1), t * 1.17, vec2(0.72, -0.69), vec2(0.98, 0.20), 6.80);
    float wash = washBand * smoothstep(0.50, 0.86, washLace) * 0.16;

    // ------------------------------------------------------------- occasional whitecaps
    vec2 crestGrad;
    float crestHeight = oceanSurface(p, t, crestGrad);
    float crestBand = smoothstep(0.30, 0.80, depth) * (1.0 - smoothstep(1.10, 2.60, depth));
    float capLace = laceField(p + vec2(-4.7, 9.2), t * 0.83, vec2(0.34, 0.94), vec2(-0.88, 0.47), 2.60);
    float crest = crestBand * smoothstep(0.22, 0.36, crestHeight) * smoothstep(0.62, 0.90, capLace) * 0.18;

    float foam = edgeFoam + wash + crest;
    // smooth distance fade (no thresholding/discard: nothing pops) + band-edge fade so the
    // rim of the band geometry can never draw a hard line
    foam *= 1.0 - smoothstep(120.0, 300.0, dist);
    foam *= smoothstep(0.02, 0.16, vBand) * (1.0 - smoothstep(0.80, 0.99, vBand));
    foam = clamp(foam, 0.0, 0.86);

    vec3 col = uFoamColor * (0.74 + 0.18 * strokes) * vec3(0.94, 0.98, 1.0);
    // foam catches the low sun (warmer toward the sunward shore)
    vec3 flatSun = normalize(vec3(uSunDir.x, 0.0001, uSunDir.z));
    vec3 flatPos = normalize(vec3(p.x, 0.0001, p.y));
    float toward = clamp(dot(flatPos, flatSun) * 0.5 + 0.5, 0.0, 1.0);
    col += uSunColor * 0.10 * toward;
    gl_FragColor = vec4(col, foam);
  }
`;

// ------------------------------------------------------------------------- wet sand

const WET_VERT = /* glsl */ `
  uniform float uWetLift;

  varying vec3 vWorld;
  varying float vGroundY;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vGroundY = position.y - uWetLift;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WET_FRAG = /* glsl */ `
  precision highp float;

  varying vec3 vWorld;
  varying float vGroundY;

  uniform float uTime;
  uniform vec3 uWetColor;

  ${OCEAN_PALETTE_UNIFORMS}
  ${SHORE_GLSL_UNIFORMS}
  ${OCEAN_WAVE_UNIFORMS}

  ${OCEAN_MATH_GLSL}
  ${SHORE_GLSL}
  ${OCEAN_WAVE_GLSL}

  float surfaceAt(vec2 p, float t) {
    vec2 grad;
    return uShoreLevel + oceanSurface(p, t, grad);
  }

  void main() {
    vec2 p = vWorld.xz;
    float groundY = vGroundY;
    float dist = length(cameraPosition - vWorld);
    float t = uTime;

    // wetness memory: the sand stays dark for a few seconds after the swash drains
    float now = surfaceAt(p, t) - groundY;
    float lag1 = surfaceAt(p, t - 1.6) - groundY;
    float lag2 = surfaceAt(p, t - 3.4) - groundY;
    float wet = max(smoothstep(-0.035, 0.10, now),
               max(smoothstep(-0.035, 0.10, lag1) * 0.70,
                   smoothstep(-0.035, 0.10, lag2) * 0.40));
    // Wet sand is an overlay on the *dry* beach: kill it as soon as real water covers it
    // (the water pass owns the colour there). This is what used to leave a dark band with a
    // hard geometry edge across the shallow shelf.
    wet *= 1.0 - smoothstep(0.02, 0.16, now);
    // patchiness + a soft ripple edge
    float n = fbm2(p * 0.55 + 2.7);
    wet *= 0.72 + 0.28 * n;
    wet *= 1.0 - smoothstep(160.0, 320.0, dist);

    // damp sand: darker, warmer, plus a low-sun sheen off the beach slope
    vec3 col = uWetColor * (0.82 + 0.28 * n);
    float e = 0.7;
    vec3 gn = normalize(vec3((shoreGroundY(p) - shoreGroundY(p + vec2(e, 0.0))) / e, 1.0,
                             (shoreGroundY(p) - shoreGroundY(p + vec2(0.0, e))) / e));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 halfV = normalize(normalize(uSunDir) + viewDir);
    col += uSunColor * pow(max(dot(gn, halfV), 0.0), 22.0) * 0.30;

    gl_FragColor = vec4(col, clamp(wet, 0.0, 0.55));
  }
`;

/**
 * Build a thin closed band that follows the warped waterline.
 *
 * Vertices are placed at `profile.waterlineAt(bearing) + offset`, so the band tracks the
 * real (non-circular, warped) shoreline instead of a radius ring. `offset` may be a
 * function of `(bearing, x, z)` for the wet-sand band which needs a height.
 *
 * @param {object} profile shore profile
 * @param {{ innerOffset:number, outerOffset:number, spacing:number, segments:number, y?:(x:number,z:number,offset:number)=>number }} options
 */
export function buildShoreBand(profile, { innerOffset, outerOffset, spacing, segments, y }) {
  const seg = Math.max(24, Math.round(segments));
  const rings = Math.max(3, Math.min(64, Math.ceil((outerOffset - innerOffset) / Math.max(0.15, spacing)) + 1));
  const vertexCount = rings * seg;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  let o = 0;
  let uo = 0;
  for (let ri = 0; ri < rings; ri++) {
    const t = ri / (rings - 1);
    const offset = innerOffset + (outerOffset - innerOffset) * t;
    for (let si = 0; si < seg; si++) {
      const bearing = (si / seg) * Math.PI * 2;
      const radius = profile.waterlineAt(bearing) + offset;
      const x = Math.sin(bearing) * radius;
      const z = Math.cos(bearing) * radius;
      positions[o++] = x;
      positions[o++] = typeof y === 'function' ? y(x, z, offset) : 0;
      positions[o++] = z;
      uvs[uo++] = si / seg;
      uvs[uo++] = t;
    }
  }
  const triangles = (rings - 1) * seg * 2;
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(triangles * 3);
  let k = 0;
  for (let ri = 0; ri < rings - 1; ri++) {
    const row = ri * seg;
    const next = (ri + 1) * seg;
    for (let si = 0; si < seg; si++) {
      const si1 = (si + 1) % seg;
      const a = row + si;
      const b = row + si1;
      const c = next + si;
      const d = next + si1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return { geometry, rings, segments: seg, vertices: vertexCount, triangles };
}

/**
 * Create the displaced surf/foam band (thin, follows the warped waterline).
 * @param {object} ctx world context
 * @param {{ profile: object, tier: object, uniforms: object, lift: number }} options
 */
export function createSurf(ctx, { profile, tier, uniforms, lift = 0.02 }) {
  const band = buildShoreBand(profile, {
    // the swash line moves a couple of metres in/out; a ~10 m band covers the run-up,
    // the backwash and the small breakers just outside it
    innerOffset: -2.6,
    outerOffset: 8.0,
    spacing: tier.surfSpacing,
    segments: tier.surfSegments,
  });
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uSurfLift: { value: lift },
    },
    defines: {
      OCEAN_WAVES: Math.max(1, tier.waveTrains | 0),
      OCEAN_CHOP: Math.max(1, tier.chopTrains | 0),
    },
    vertexShader: SURF_VERT,
    fragmentShader: SURF_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
  });
  material.name = 'ocean-surf';
  const mesh = new THREE.Mesh(band.geometry, material);
  mesh.name = 'island-surf';
  // The vertex shader writes absolute world Y from the shore LUT (`uShoreLevel`), so the
  // mesh itself stays at the origin.
  mesh.renderOrder = 3;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  ctx.disposables.push(band.geometry, material);
  return { mesh, material, geometry: band.geometry, stats: { triangles: band.triangles, vertices: band.vertices } };
}

/**
 * Create the wet-sand darkening band (thin, follows the warped waterline).
 * @param {object} ctx world context
 * @param {{ profile: object, tier: object, uniforms: object, lift: number }} options
 */
export function createWetSand(ctx, { profile, tier, uniforms, lift = 0.018 }) {
  const band = buildShoreBand(profile, {
    innerOffset: -4.5,
    outerOffset: 1.4,
    spacing: tier.wetSpacing,
    segments: tier.wetSegments,
    y: (x, z) => profile.Y(x, z) + lift,
  });
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uWetLift: { value: lift },
      uWetColor: { value: new THREE.Vector3(0.16, 0.135, 0.10) },
    },
    defines: {
      OCEAN_WAVES: Math.max(1, tier.waveTrains | 0),
      OCEAN_CHOP: Math.max(1, tier.chopTrains | 0),
    },
    vertexShader: WET_VERT,
    fragmentShader: WET_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  material.name = 'ocean-wet-sand';
  const mesh = new THREE.Mesh(band.geometry, material);
  mesh.name = 'island-wet-sand';
  // geometry Y is the absolute profile height (+lift), mesh stays at the origin
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  ctx.disposables.push(band.geometry, material);
  return { mesh, material, geometry: band.geometry, stats: { triangles: band.triangles, vertices: band.vertices } };
}

export default createSurf;
