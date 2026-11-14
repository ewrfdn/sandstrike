/**
 * SANDSTRIKE // tropical island ambience: pollen, low mist bands, seabirds, humid haze.
 *
 * The desert map's dust motes are warm embers; a humid dawn island needs floating
 * pollen/spores drifting in the first light, thin low mist over the clearings and the
 * lagoon and a handful of distant seabirds. Everything here is visual-only (no
 * collideMeshes, no shadow casting, no fog interaction) and animates through one
 * `update(time)` contract.
 *
 * Contract (ISLAND_MAP_SPEC.md §4.3):
 *   buildIslandAmbience(ctx) -> { update(time) }
 *
 * Draw calls: pollen (1) + mist bands (N) + birds (1).
 */
import * as THREE from 'three';
import { makeRNG } from '../utils.js';
import { QUALITY_SETTINGS } from './quality.js';

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

const HASH_GLSL = /* glsl */ `
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
    return vnoise(p) * 0.62 + vnoise(p * 2.17 + 5.1) * 0.38;
  }
`;

// ---------------------------------------------------------------------------
// pollen / spores
// ---------------------------------------------------------------------------
function buildPollen(ctx, count, spread, yBand, seed) {
  const rng = makeRNG(seed);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // bias the swarm toward the jungle interior, not the open sea
    const r = Math.sqrt(rng()) * spread * 0.78;
    const a = rng() * Math.PI * 2;
    positions[i * 3] = Math.sin(a) * r;
    positions[i * 3 + 1] = yBand[0] + rng() * (yBand[1] - yBand[0]);
    positions[i * 3 + 2] = Math.cos(a) * r;
    seeds[i] = rng();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      varying float vAlpha;
      varying float vWarm;
      void main() {
        vec3 p = position;
        float t = uTime * 0.045;
        // slow humid drift + a lazy updraft
        p.x += sin(t * 1.55 + aSeed * 23.0) * 1.9 + sin(t * 0.41 + aSeed * 7.0) * 2.6;
        p.z += cos(t * 1.21 + aSeed * 19.0) * 1.9 + cos(t * 0.33 + aSeed * 3.0) * 2.1;
        p.y += sin(t * 2.1 + aSeed * 11.0) * 0.5 + fract(uTime * 0.010 + aSeed) * 0.7;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp((0.9 + aSeed * 1.5) * (13.0 / max(2.0, -mv.z)), 1.0, 7.0);
        gl_Position = projectionMatrix * mv;
        vAlpha = 0.07 + 0.22 * aSeed;
        vWarm = 0.5 + 0.5 * sin(aSeed * 31.0 + uTime * 0.05);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying float vWarm;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float d = dot(uv, uv);
        if (d > 1.0) discard;
        float a = (1.0 - d) * (1.0 - d) * vAlpha;
        // humid green-white spores, a few catching the warm sun
        vec3 cool = vec3(0.86, 1.02, 0.74);
        vec3 warm = vec3(1.24, 1.04, 0.70);
        gl_FragColor = vec4(mix(cool, warm, vWarm * 0.7) * 1.05, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'island-pollen';
  points.frustumCulled = false;
  points.renderOrder = 5;
  ctx.scene.add(points);
  ctx.objects.push(points);
  ctx.disposables.push(geo, mat);
  return points;
}

// ---------------------------------------------------------------------------
// low mist bands
// ---------------------------------------------------------------------------
function buildMistBand(ctx, { x, y, z, width, depth, opacity, seed, driftX, driftZ }) {
  const geo = new THREE.PlaneGeometry(width, depth, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uOpacity: { value: opacity },
      uDrift: { value: new THREE.Vector2(driftX, driftZ) },
      uSunDir: { value: new THREE.Vector3(0.82, 0.3, 0.49).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      varying vec3 vWorld;
      uniform float uTime;
      uniform float uSeed;
      uniform float uOpacity;
      uniform vec2 uDrift;
      uniform vec3 uSunDir;
      ${HASH_GLSL}
      void main() {
        vec2 p = vUv * vec2(2.6, 1.7) + vec2(uSeed, uSeed * 0.63);
        p += vec2(uTime * uDrift.x, uTime * uDrift.y);
        float n = fbm2(p) * 0.7 + fbm2(p * 2.4 + 3.7) * 0.3;
        // soft edged slab: fade the plane borders so the mesh is never visible
        vec2 edge = smoothstep(0.0, 0.26, vUv) * smoothstep(1.0, 0.74, vUv);
        float edgeFade = edge.x * edge.y;
        float alpha = smoothstep(0.34, 0.78, n) * edgeFade * uOpacity;
        if (alpha < 0.004) discard;
        // warm the mist where it faces the risen sun
        vec3 flatPos = normalize(vec3(vWorld.x - cameraPosition.x, 0.0001, vWorld.z - cameraPosition.z));
        vec3 flatSun = normalize(vec3(uSunDir.x, 0.0001, uSunDir.z));
        float toward = max(dot(flatPos, flatSun), 0.0);
        vec3 cool = vec3(0.80, 0.93, 0.82);
        vec3 warm = vec3(1.26, 1.02, 0.74);
        vec3 col = mix(cool, warm, toward * 0.55);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.name = 'island-mist-band';
  mesh.renderOrder = 4;
  mesh.frustumCulled = true;
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  ctx.disposables.push(geo, mat);
  return mesh;
}

// ---------------------------------------------------------------------------
// seabirds (one draw call for the whole flock, wings flap in the vertex shader)
// ---------------------------------------------------------------------------
function buildBirds(ctx, count) {
  const rng = makeRNG(5521);
  const birds = [];
  for (let i = 0; i < count; i++) {
    birds.push({
      radius: 40 + rng() * 46,
      height: 15 + rng() * 13,
      speed: 0.045 + rng() * 0.045,
      phase: rng() * Math.PI * 2,
      scale: 0.75 + rng() * 0.6,
      flap: 4.2 + rng() * 2.2,
    });
  }

  // Per bird: two swept wing triangles. Attributes drive the vertex animation.
  const positions = [];
  const birdIdx = [];
  const sideAttr = [];
  const tipAttr = [];
  const shape = [
    // [x, z, tip]
    [0.0, 0.30, 0],
    [-1.05, -0.16, 1],
    [-0.26, -0.34, 0.45],
    [0.0, 0.30, 0],
    [0.26, -0.34, 0.45],
    [1.05, -0.16, 1],
  ];
  for (let b = 0; b < birds.length; b++) {
    for (const [x, z, tip] of shape) {
      positions.push(x, 0, z);
      birdIdx.push(b);
      sideAttr.push(Math.sign(x));
      tipAttr.push(tip);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aBird', new THREE.Float32BufferAttribute(birdIdx, 1));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(sideAttr, 1));
  geo.setAttribute('aTip', new THREE.Float32BufferAttribute(tipAttr, 1));

  const uBirds = birds.map((b) => new THREE.Vector4(b.radius, b.height, b.speed, b.phase));
  const uScale = birds.map((b) => b.scale);
  const uFlap = birds.map((b) => b.flap);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBirds: { value: uBirds },
      uScale: { value: uScale },
      uFlap: { value: uFlap },
      uColor: { value: new THREE.Vector3(0.055, 0.06, 0.062) },
    },
    vertexShader: /* glsl */ `
      attribute float aBird;
      attribute float aSide;
      attribute float aTip;
      uniform float uTime;
      uniform vec4 uBirds[${birds.length}];
      uniform float uScale[${birds.length}];
      uniform float uFlap[${birds.length}];
      varying float vShade;
      void main() {
        int i = int(aBird + 0.5);
        vec4 cfg = uBirds[i];
        float radius = cfg.x;
        float height = cfg.y;
        float speed = cfg.z;
        float phase = cfg.w;
        float scale = uScale[i];
        float flapHz = uFlap[i];

        float ang = uTime * speed + phase;
        float bob = sin(uTime * 0.55 + phase * 3.1) * 1.1;
        vec3 center = vec3(sin(ang) * radius, height + bob, cos(ang) * radius);

        // flight frame: forward = orbit tangent, right = outward radial
        vec3 forward = normalize(vec3(cos(ang), 0.0, -sin(ang)));
        vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));

        // wing flap + a lazy banking roll
        float flap = sin(uTime * flapHz + phase * 5.7);
        float roll = sin(uTime * 0.45 + phase * 2.3) * 0.35;
        vec3 p = position;
        p.y += aTip * flap * 0.85;
        // roll the body around the flight axis
        float cr = cos(roll);
        float sr = sin(roll);
        float x1 = p.x * cr - p.y * sr;
        float y1 = p.x * sr + p.y * cr;
        p.x = x1;
        p.y = y1;
        p *= scale;
        // keep the flock in a tight line-of-sight sweep across the dawn sky
        vec3 world = center + right * p.x + vec3(0.0, 1.0, 0.0) * p.y + forward * p.z;
        vec4 mv = viewMatrix * vec4(world, 1.0);
        vShade = 0.55 + 0.45 * aTip;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      varying float vShade;
      void main() {
        gl_FragColor = vec4(uColor * (0.65 + vShade * 0.35), 0.86);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'island-birds';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  ctx.disposables.push(geo, mat);

  return {
    mesh,
    update(time) {
      mat.uniforms.uTime.value = time;
    },
  };
}

/**
 * Build the island atmosphere.
 * @param {object} ctx world context
 * @returns {{ update: (time:number)=>void }}
 */
export function buildIslandAmbience(ctx) {
  const q = QUALITY_SETTINGS[ctx.quality] ?? QUALITY_SETTINGS.high;
  const env = ctx.data?.environment ?? {};
  const ambience = env.ambience ?? {};
  const sky = env.sky ?? {};
  const pollenCount = Math.max(0, Math.round(num(ambience.pollen, q.dust)));
  const mistBands = Math.max(0, Math.round(num(ambience.mist, 3)));
  const birds = Math.max(0, Math.round(num(ambience.birds, 4)));
  const wind = num(ambience.wind, 0.5);
  const sunDir = new THREE.Vector3(
    Array.isArray(sky.sunDirection) ? sky.sunDirection[0] : 0.82,
    Array.isArray(sky.sunDirection) ? sky.sunDirection[1] : 0.3,
    Array.isArray(sky.sunDirection) ? sky.sunDirection[2] : 0.49
  ).normalize();

  const updaters = [];

  if (pollenCount > 0) {
    const pollen = buildPollen(ctx, pollenCount, 54, [0.35, 8.5], 4409);
    updaters.push((time) => { pollen.material.uniforms.uTime.value = time; });
  }

  // Low mist: drifting bands over the lagoon, the jungle interior and the temple
  // clearing. The user asked for heavy humid air, so we carry up to five faint layers;
  // all of them are thin and low so they read as ground fog, never as sky bands.
  const rng = makeRNG(8123);
  const mistLayout = [
    { x: -8, y: 1.5, z: -4, width: 360, depth: 320, opacity: 0.042, driftX: 0.004, driftZ: 0.0015 },
    { x: 4, y: 2.4, z: 2, width: 330, depth: 300, opacity: 0.038, driftX: -0.003, driftZ: 0.002 },
    { x: 0, y: 3.4, z: 0, width: 300, depth: 270, opacity: 0.032, driftX: 0.0025, driftZ: -0.0018 },
    { x: -2, y: 0.9, z: 0, width: 380, depth: 340, opacity: 0.034, driftX: 0.0021, driftZ: -0.0012 },
    { x: 2, y: 4.6, z: -6, width: 320, depth: 280, opacity: 0.026, driftX: -0.0018, driftZ: 0.0016 },
  ];
  for (let i = 0; i < Math.min(mistBands, mistLayout.length); i++) {
    const cfg = mistLayout[i];
    const mesh = buildMistBand(ctx, { ...cfg, seed: rng() * 9.0, driftX: cfg.driftX * (0.6 + wind), driftZ: cfg.driftZ * (0.6 + wind) });
    mesh.material.uniforms.uSunDir.value.copy(sunDir);
    updaters.push((time) => { mesh.material.uniforms.uTime.value = time; });
  }

  if (birds > 0) {
    const flock = buildBirds(ctx, Math.min(6, birds));
    updaters.push((time) => flock.update(time));
  }

  const ambienceSystem = {
    update(time) {
      for (const fn of updaters) fn(time);
    },
  };
  ctx.islandAmbience = ambienceSystem;
  return ambienceSystem;
}

export default buildIslandAmbience;
