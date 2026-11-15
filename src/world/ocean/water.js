/**
 * SANDSTRIKE // tropical ocean — the water surface.
 *
 * One draw call: a tessellated radial grid (dense ring spacing near the shore, geometric
 * growth out to a 470 m horizon) whose vertices are displaced by the shared wave model.
 *
 * Fragment shading is a small physically-motivated water model:
 *   1. refraction — the view ray is refracted into the water with the wave normal and
 *      marched onto the analytically-known sea bed (shared shore LUT) in 1-2 steps, then
 *      the build-time seabed capture is sampled at that world XZ (uSeabedRect). The
 *      sample is perturbed by the wave normal so the bottom image wobbles with the surface.
 *   2. Beer–Lambert absorption per channel (red dies first) + depth-dependent in-scatter
 *      => clear shallow sand, saturated turquoise mid-lagoon, deep blue-teal open sea.
 *   3. animated caustics on the refracted bed colour, shallow only.
 *   4. fresnel sky reflection using the same `skyColor()` gradient as the dome, HDR sun
 *      glitter / sun road, horizon haze that dissolves into the sky at the far plane.
 *
 * Alpha is < 1 only where it helps the real scene compositing through: very shallow water
 * and the thin swash film running over the sand (there the real terrain mesh is crisper
 * than the captured bed, so it is left to show through).
 */
import * as THREE from 'three';
import { SHORE_GLSL, SHORE_GLSL_UNIFORMS } from '../island-shore.js';
import {
  OCEAN_BOTTOM_GLSL,
  OCEAN_BOTTOM_UNIFORMS,
  OCEAN_CAUSTIC_GLSL,
  OCEAN_HAZE_GLSL,
  OCEAN_HAZE_UNIFORMS,
  OCEAN_MATH_GLSL,
  OCEAN_PALETTE_UNIFORMS,
  OCEAN_SKY_GLSL,
  OCEAN_WAVE_GLSL,
  OCEAN_WAVE_UNIFORMS,
  buildOceanDefines,
} from './glsl.js';

const WATER_VERT = /* glsl */ `
  uniform float uTime;

  ${SHORE_GLSL_UNIFORMS}
  ${OCEAN_WAVE_UNIFORMS}
  ${SHORE_GLSL}
  ${OCEAN_WAVE_GLSL}

  varying vec3 vWorld;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec2 grad;
    float height = oceanSurface(world.xz, uTime, grad);
    world.y += height;
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAG = /* glsl */ `
  precision highp float;

  varying vec3 vWorld;

  uniform float uTime;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uAbsorb;
  uniform vec3 uScatterShallow;
  uniform vec3 uScatterDeep;
  uniform float uDebug; // dev-only visualisation switch (0 = normal shading)
  uniform float uSeabedGain;

  ${OCEAN_PALETTE_UNIFORMS}
  ${OCEAN_BOTTOM_UNIFORMS}
  ${OCEAN_HAZE_UNIFORMS}
  ${SHORE_GLSL_UNIFORMS}
  ${OCEAN_WAVE_UNIFORMS}

  ${OCEAN_MATH_GLSL}
  ${SHORE_GLSL}
  ${OCEAN_SKY_GLSL}
  ${OCEAN_WAVE_GLSL}
  ${OCEAN_BOTTOM_GLSL}
  ${OCEAN_CAUSTIC_GLSL}
  ${OCEAN_HAZE_GLSL}

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 viewDir = toCam / max(dist, 0.0001);
    vec2 p = vWorld.xz;
    float surfaceY = vWorld.y;

    // fine chop fades with distance; swell survives (it moves the geometry)
    float lod = exp(-dist * 0.028);

    // ---- surface normal: exactly the gradient of the displaced surface + fine chop
    vec2 swellGrad;
    oceanSurface(p, uTime, swellGrad);
    vec2 grad = swellGrad + oceanChop(p, uTime, lod);
    vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));

    // ---- water depth (negative above the waterline: thin swash film over the sand)
    float groundY = shoreGroundY(p);
    float depth = surfaceY - groundY;
    float d = max(depth, 0.03);

    // ---- 1. refraction: march the refracted view ray onto the analytic sea bed
    vec3 incident = -viewDir;
    vec3 refracted = refract(incident, n, 0.75188); // 1.0 / 1.333
    float down = max(-refracted.y, 0.18);
    vec2 Q = p;
    float dq = d;
    for (int i = 0; i < OCEAN_REFRACT_STEPS; i++) {
      Q = p + refracted.xz * (dq / down);
      dq = max(surfaceY - shoreGroundY(Q), 0.03);
    }
    // wave-normal perturbation: the bottom image slides with the swell
    Q += n.xz * (0.06 + 0.35 * d);

    // path length of the refracted ray inside the water (for Beer-Lambert)
    vec3 transmittance = exp(-uAbsorb * clamp(max(d, dq) / down, 0.0, 48.0));

    // ---- sampled sea bed (capture) blended with the procedural fallback bed.
    // The capture is a *render* of the terrain's authored underwater palette: it carries the
    // structure (coral heads, seagrass, shells, shadows) but its albedo is authored for an
    // opaque sea. Rebuild a pale, sand-like albedo from the capture luminance and keep only a
    // little of the baked colour, so the turquoise tint comes from absorption/scatter here.
    float captureFade = 1.0 - smoothstep(90.0, 180.0, dist);
    vec3 det = seabedSample(Q);
    float dl = clamp(dot(det, vec3(0.299, 0.587, 0.114)) * uSeabedGain, 0.0, 1.0);
    float lit = 0.34 + 1.32 * dl;
    vec3 sand = vec3(0.560, 0.548, 0.512) * lit;
    sand = mix(sand, det * uSeabedGain, 0.28);
    vec3 bed = mix(proceduralBottom(Q, dq), sand, seabedMask(Q) * captureFade);

    // ---- 3. caustics on the shallow bed (small, soft, gone by ~4 m depth; only visible
    //         when looking down into the water, not at grazing angles)
    #if OCEAN_CAUSTICS
      float causticMask = smoothstep(0.03, 0.30, d) * (1.0 - smoothstep(1.2, 3.8, d));
      causticMask *= smoothstep(0.06, 0.38, clamp(dot(n, viewDir), 0.0, 1.0));
      float caustic = oceanCaustic(Q + n.xz * 0.4, uTime);
      bed *= 1.0 + caustic * 0.16 * causticMask;
    #endif

    // ---- 2. water body: per-channel absorption + depth in-scatter
    vec3 scatter = mix(uScatterShallow, uScatterDeep, smoothstep(0.7, 11.0, d));
    vec3 body = bed * transmittance + scatter * (1.0 - transmittance);
    // shallow ambient floor: the top 1.5 m of turquoise water must never read darker than
    // the dry sand next to it (keeps the transparent shallows luminous)
    body += uShallow * 0.12 * exp(-d * 0.55);

    vec3 reflDir = reflect(incident, n);
    reflDir.y = max(reflDir.y, 0.015);

    // dev-only visualisation of the water terms (uDebug = 0 in normal play)
    if (uDebug > 0.5) {
      vec3 dbg = body;
      if (uDebug < 1.5) dbg = bed;
      else if (uDebug < 2.5) dbg = transmittance;
      else if (uDebug < 3.5) dbg = n * 0.5 + 0.5;
      else if (uDebug < 4.5) dbg = vec3(clamp(d / 8.0, 0.0, 1.0));
      else if (uDebug < 5.5) dbg = body;
      else if (uDebug < 6.5) dbg = scatter;
      else if (uDebug < 7.5) dbg = skyColor(reflDir);
      else if (uDebug < 8.5) dbg = vec3(clamp(Q.x / 130.0 * 0.5 + 0.5, 0.0, 1.0), clamp(Q.y / 130.0 * 0.5 + 0.5, 0.0, 1.0), 0.0);
      gl_FragColor = vec4(dbg, 1.0);
      return;
    }

    // ---- 4. fresnel sky reflection (slightly damped + tinted so the tropical body
    //         colour survives at the grazing angles most beach views are shot from)
    float fresnel = 0.02 + 0.80 * pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 5.0);
    vec3 skyReflection = skyColor(reflDir) * vec3(0.82, 0.93, 1.0);
    vec3 col = mix(body, skyReflection, clamp(fresnel, 0.0, 0.86));

    // ---- sun glitter / sun road (HDR so the bloom picks it up)
    vec3 sunDir = normalize(uSunDir);
    vec3 halfV = normalize(sunDir + viewDir);
    float nh = max(dot(n, halfV), 0.0);
    vec2 flatView = normalize(viewDir.xz + vec2(1e-4));
    vec2 flatSun = normalize(sunDir.xz + vec2(1e-4));
    float toward = pow(max(dot(flatView, flatSun), 0.0), 6.0);
    float shimmer = 0.55 + 0.45 * sin(uTime * 1.7 + dot(p, vec2(0.62, 0.83)) * 1.3 + 0.5);
    float glint = pow(nh, 620.0) * 2.4 + pow(nh, 1600.0) * 8.0;
    col += uSunColor * glint * (0.6 + toward * 4.6) * shimmer;
    col += uSunColor * pow(nh, 48.0) * 0.020;
    // broad warm sheen on the water toward the sun (the "sun road")
    col += uSunColor * toward * pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 6.0) * 0.05;

    // ---- horizon haze: dissolve into the morning sky before the camera far plane
    col = applyOceanHaze(col, dist, viewDir);

    // ---- coverage: the surface exists only where there is water over the sea bed.
    // cover kills the sheet on dry sand (the mesh spans the whole island footprint, so
    // without this the transparent film would tint the entire beach), while a translucent
    // film is kept for the last few centimetres of the swash where the sand is still wet.
    float cover = smoothstep(-0.015, 0.045, depth);
    float alpha = mix(0.55, 1.0, smoothstep(0.05, 1.20, depth));
    float filmAlpha = 0.42 * smoothstep(-0.045, -0.005, depth) * (1.0 - smoothstep(0.03, 0.13, depth));
    alpha = max(alpha * cover, filmAlpha);
    alpha = mix(alpha, 1.0, smoothstep(60.0, 200.0, dist));
    if (alpha < 0.004) discard;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

/**
 * Ring radii of the radial surface grid: uniform spacing over the shelf, then quadratic
 * spacing growth up to the horizon (constant number of rings regardless of radius).
 * @returns {number[]}
 */
function ringRadii(tier) {
  const radii = [];
  const inner = Math.max(2, tier.gridInner);
  const denseOuter = Math.max(inner + tier.spacing * 2, tier.denseOuter);
  for (let r = inner; r < denseOuter - 1e-3; r += tier.spacing) radii.push(r);
  const span = Math.max(1, tier.horizonRadius - denseOuter);
  let r = denseOuter;
  while (r < tier.horizonRadius - 0.5) {
    radii.push(r);
    const t = (r - denseOuter) / span;
    r += tier.spacing + span * tier.growth * t * t;
  }
  radii.push(tier.horizonRadius);
  return radii;
}

/**
 * Build the radial water grid geometry (y = 0 plane; the vertex shader displaces it, the
 * mesh itself sits at sea level).
 * @param {object} tier ocean tier
 * @returns {{ geometry: THREE.BufferGeometry, rings: number, segments: number, triangles: number }}
 */
export function buildWaterGrid(tier) {
  const radii = ringRadii(tier);
  const segments = Math.max(24, tier.segments | 0);
  const rings = radii.length;
  const vertexCount = rings * segments;
  const positions = new Float32Array(vertexCount * 3);
  let o = 0;
  for (let ri = 0; ri < rings; ri++) {
    const radius = radii[ri];
    for (let si = 0; si < segments; si++) {
      const angle = (si / segments) * Math.PI * 2;
      // map convention: x = sin(a) * r, z = cos(a) * r
      positions[o++] = Math.sin(angle) * radius;
      positions[o++] = 0;
      positions[o++] = Math.cos(angle) * radius;
    }
  }
  const quadCount = (rings - 1) * segments * 2;
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(quadCount * 3);
  let k = 0;
  for (let ri = 0; ri < rings - 1; ri++) {
    const row = ri * segments;
    const next = (ri + 1) * segments;
    for (let si = 0; si < segments; si++) {
      const si1 = (si + 1) % segments;
      const a = row + si;
      const b = row + si1;
      const c = next + si;
      const d = next + si1;
      // counter-clockwise seen from above (+Y)
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
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), tier.horizonRadius * 1.05);
  return { geometry, rings, segments, triangles: quadCount, vertices: vertexCount };
}

/**
 * Create the water surface mesh + material.
 * @param {object} ctx world context
 * @param {{ profile: object, tier: object, uniforms: object }} options
 * @returns {{ mesh: THREE.Mesh, material: THREE.ShaderMaterial, geometry: THREE.BufferGeometry, stats: object }}
 */
export function createWaterSurface(ctx, { profile, tier, uniforms }) {
  const grid = buildWaterGrid(tier);
  const material = new THREE.ShaderMaterial({
    uniforms,
    defines: buildOceanDefines(tier),
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
  });
  material.name = 'ocean-water';
  const mesh = new THREE.Mesh(grid.geometry, material);
  mesh.name = 'island-water';
  mesh.position.y = profile.level;
  mesh.renderOrder = 2;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  ctx.disposables.push(grid.geometry, material);
  return {
    mesh,
    material,
    geometry: grid.geometry,
    stats: { triangles: grid.triangles, vertices: grid.vertices, rings: grid.rings, segments: grid.segments },
  };
}

export default createWaterSurface;
