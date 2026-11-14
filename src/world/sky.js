/**
 * SANDSTRIKE // sandstorm protocol — procedural sky dome + IBL environment.
 *
 * Split out of src/world.js (SKY_VERT / SKY_FRAG / createSkyMaterial / buildSky /
 * buildEnvironment). The shaders are unchanged; only the tunable sky colours,
 * sun direction and environment-card/PMREM parameters now come from
 * `ctx.data.environment` (map data) instead of hard-coded literals.
 *
 * All fallbacks equal the pre-refactor world.js literals, so a missing
 * `ctx.data` (e.g. the isolated model stage passes a light-only ctx) renders
 * exactly like the old code.
 */
import * as THREE from 'three';

export const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w;
  }
`;

export const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uDust;
  uniform vec3 uSunColor;
  uniform vec3 uCloudColor;
  uniform vec3 uGround;
  // 1.0 = the original desert look; maps that want a cleaner sky can fade the cloud
  // sheets without touching the shared shader defaults.
  uniform float uCloudOpacity;

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
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + 17.13;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float sunDot = clamp(dot(d, uSunDir), 0.0, 1.0);
    vec2 sunH = normalize(uSunDir.xz + vec2(0.0001));
    float towardSun = clamp(dot(normalize(d.xz + vec2(0.0001)), sunH), 0.0, 1.0);

    // vertical gradient
    float t = pow(clamp(h, 0.0, 1.0), 0.62);
    vec3 sky = mix(uHorizon, uZenith, t);

    // warm dust band hugging the horizon, biased toward the sun
    float band = exp(-max(h, 0.0) * 10.5) * (0.5 + 0.5 * towardSun);
    sky = mix(sky, uDust, clamp(band, 0.0, 1.0) * 0.55);

    // sun halo + disc (HDR so the bloom pass catches it)
    sky += uSunColor * pow(sunDot, 6.0) * 0.16;
    sky += uSunColor * pow(sunDot, 42.0) * 0.5;
    sky += uSunColor * pow(sunDot, 900.0) * 1.4;
    float disc = smoothstep(0.99955, 0.99985, sunDot);
    sky += uSunColor * disc * 5.0;

    // golden-hour cloud sheets on a virtual dome
    if (h > -0.05) {
      vec2 cuv = d.xz / (max(h, 0.02) + 0.22);
      cuv *= 0.5;
      float tt = uTime * 0.0045;
      float c1 = fbm(cuv * 1.15 + vec2(tt * 0.7, tt * 0.12));
      float c2 = fbm(cuv * 2.9 + vec2(-tt * 0.42, tt * 0.25));
      float cloud = smoothstep(0.5, 0.76, c1 * 0.68 + c2 * 0.44);
      cloud *= smoothstep(-0.02, 0.16, h) * (1.0 - smoothstep(0.5, 0.98, h) * 0.65);
      vec3 cloudCol = mix(uCloudColor * 0.72, uCloudColor, smoothstep(0.0, 0.65, sunDot));
      cloudCol += uSunColor * pow(sunDot, 14.0) * 0.35;
      sky = mix(sky, cloudCol, clamp(cloud, 0.0, 1.0) * 0.72 * uCloudOpacity);

      // thin high cirrus
      float ci = fbm(cuv * 5.5 + vec2(tt * 1.2, 0.0));
      float cirrus = smoothstep(0.56, 0.8, ci) * smoothstep(0.22, 0.55, h) * 0.15;
      sky = mix(sky, uCloudColor * 1.05, cirrus * uCloudOpacity);
    }

    // ground / haze below the horizon
    sky = mix(sky, uGround, smoothstep(0.02, -0.16, h));
    gl_FragColor = vec4(sky, 1.0);
  }
`;

// Pre-refactor world.js defaults. Used verbatim when map data omits a field.
const DEFAULT_SKY = Object.freeze({
  sunDirection: [-0.893, 0.305, 0.333],
  zenith: [0.10, 0.235, 0.52],
  horizon: [1.34, 0.78, 0.36],
  dust: [0.52, 0.29, 0.14],
  sunColor: [2.6, 1.7, 0.9],
  cloudColor: [1.5, 1.16, 0.88],
  groundColor: [0.26, 0.17, 0.10],
  domeRadius: 340,
});

const DEFAULT_ENVIRONMENT_MAP = Object.freeze({
  intensity: 0.55,
  groundColor: [0.24, 0.16, 0.095],
  cardColor: [1.4, 0.9, 0.55],
  cardDistance: 55,
  groundRadius: 120,
  sphereRadius: 80,
  blur: 0.03,
});

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const vec3 = (value, fallback) => (Array.isArray(value) && value.length >= 3 ? value : fallback);

/** Resolve `environment.sky` against the pre-refactor defaults. */
function skySettings(environment) {
  const s = environment?.sky ?? {};
  return {
    sunDirection: vec3(s.sunDirection, DEFAULT_SKY.sunDirection),
    zenith: vec3(s.zenith, DEFAULT_SKY.zenith),
    horizon: vec3(s.horizon, DEFAULT_SKY.horizon),
    dust: vec3(s.dust, DEFAULT_SKY.dust),
    sunColor: vec3(s.sunColor, DEFAULT_SKY.sunColor),
    cloudColor: vec3(s.cloudColor, DEFAULT_SKY.cloudColor),
    cloudOpacity: num(s.cloudOpacity, 1),
    groundColor: vec3(s.groundColor, DEFAULT_SKY.groundColor),
    domeRadius: num(s.domeRadius, DEFAULT_SKY.domeRadius),
  };
}

/** Resolve `environment.environmentMap` against the pre-refactor defaults. */
function environmentMapSettings(environment) {
  const e = environment?.environmentMap ?? {};
  return {
    intensity: num(e.intensity, DEFAULT_ENVIRONMENT_MAP.intensity),
    groundColor: vec3(e.groundColor, DEFAULT_ENVIRONMENT_MAP.groundColor),
    cardColor: vec3(e.cardColor, DEFAULT_ENVIRONMENT_MAP.cardColor),
    cardDistance: num(e.cardDistance, DEFAULT_ENVIRONMENT_MAP.cardDistance),
    groundRadius: num(e.groundRadius, DEFAULT_ENVIRONMENT_MAP.groundRadius),
    sphereRadius: num(e.sphereRadius, DEFAULT_ENVIRONMENT_MAP.sphereRadius),
    blur: num(e.blur, DEFAULT_ENVIRONMENT_MAP.blur),
  };
}

/** Normalized sun direction (old module const SUN_DIR). */
export function getSunDirection(environment) {
  const dir = skySettings(environment).sunDirection;
  return new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
}

export function createSkyMaterial(environment = null) {
  const sky = skySettings(environment);
  return new THREE.ShaderMaterial({
    name: 'sky',
    uniforms: {
      uSunDir: { value: getSunDirection(environment) },
      uTime: { value: 0 },
      uZenith: { value: new THREE.Color().setRGB(sky.zenith[0], sky.zenith[1], sky.zenith[2]) },
      uHorizon: { value: new THREE.Color().setRGB(sky.horizon[0], sky.horizon[1], sky.horizon[2]) },
      uDust: { value: new THREE.Color().setRGB(sky.dust[0], sky.dust[1], sky.dust[2]) },
      uSunColor: { value: new THREE.Color().setRGB(sky.sunColor[0], sky.sunColor[1], sky.sunColor[2]) },
      uCloudColor: { value: new THREE.Color().setRGB(sky.cloudColor[0], sky.cloudColor[1], sky.cloudColor[2]) },
      uCloudOpacity: { value: sky.cloudOpacity },
      uGround: { value: new THREE.Color().setRGB(sky.groundColor[0], sky.groundColor[1], sky.groundColor[2]) },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    toneMapped: true,
    fog: false,
  });
}

export function buildSky(ctx) {
  const geo = new THREE.SphereGeometry(skySettings(ctx.data?.environment).domeRadius, 48, 24);
  const mat = createSkyMaterial(ctx.data?.environment);
  const sky = new THREE.Mesh(geo, mat);
  sky.name = 'sky-dome';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  sky.matrixAutoUpdate = false;
  sky.updateMatrix();
  ctx.scene.add(sky);
  ctx.sky = sky;
  ctx.skyMaterial = mat;
  ctx.disposables.push(geo, mat);
  return sky;
}

export function buildEnvironment(ctx) {
  const cfg = environmentMapSettings(ctx.data?.environment);
  const scene = new THREE.Scene();
  const mat = createSkyMaterial(ctx.data?.environment);
  // simpler env: strip cloud uniforms cost by using the same shader (fine, done once)
  mat.uniforms.uTime.value = 0;
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(cfg.sphereRadius, 32, 16), mat);
  scene.add(sphere);
  const groundMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(cfg.groundColor[0], cfg.groundColor[1], cfg.groundColor[2]) });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(cfg.groundRadius, 24), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  scene.add(ground);
  // warm bounce card for metal highlights
  const cardMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(cfg.cardColor[0], cfg.cardColor[1], cfg.cardColor[2]) });
  const card = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), cardMat);
  card.position.copy(getSunDirection(ctx.data?.environment)).multiplyScalar(cfg.cardDistance);
  scene.add(card);

  const pmrem = new THREE.PMREMGenerator(ctx.renderer);
  pmrem.compileCubemapShader();
  const rt = pmrem.fromScene(scene, cfg.blur, 0.1, 200);
  ctx.pmremTarget = rt;
  ctx.scene.environment = rt.texture;
  ctx.scene.environmentIntensity = cfg.intensity;
  pmrem.dispose();
  for (const m of [groundMat, cardMat]) m.dispose();
  sphere.geometry.dispose();
  ground.geometry.dispose();
  card.geometry.dispose();
  mat.dispose();
  return rt;
}
