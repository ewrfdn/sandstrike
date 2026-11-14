/**
 * SANDSTRIKE // sandstorm protocol — golden-hour lighting rig.
 *
 * Split out of src/world.js (buildLights). Every fog/background/sun/hemisphere/
 * ambient/bounce value now comes from `ctx.data.environment` (map data); the
 * fallbacks below are the pre-refactor literals, so a ctx without data (the
 * isolated model stage) is lit exactly like the old code.
 */
import * as THREE from 'three';
import { QUALITY_SETTINGS } from './quality.js';
import { getSunDirection } from './sky.js';

// Pre-refactor world.js defaults (contract.md environment.json defaults).
const DEFAULT_FOG = Object.freeze({ color: 0xd7a06c, density: 0.0104 });
const DEFAULT_BACKGROUND = 0xd8a877;
const DEFAULT_LIGHTS = Object.freeze({
  sun: Object.freeze({
    color: 0xffd2a0,
    intensity: 3.55,
    distance: 130,
    target: Object.freeze([0, 0, -2]),
    shadow: Object.freeze({
      ortho: Object.freeze([-46, 46, 46, -46]),
      near: 30,
      far: 290,
      bias: -0.00045,
      normalBias: 0.055,
      radius: 2.2,
    }),
  }),
  hemisphere: Object.freeze({ skyColor: 0x8fb2d8, groundColor: 0xcf9a60, intensity: 0.82 }),
  ambient: Object.freeze({ color: 0x5b4130, intensity: 0.17 }),
  bounce: Object.freeze({ color: 0xffb27a, intensity: 0.58, position: Object.freeze([75, 18, -55]), target: Object.freeze([0, 0, 0]) }),
});

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const vec = (value, fallback) => (Array.isArray(value) && value.length >= (fallback.length ?? 3) ? value : fallback);
const color = (value, fallback) => (value ?? fallback);

/**
 * The lighting rig is shared between the shipping world and the model stage, so
 * `environment` may be undefined; this resolver fills every missing field with
 * the identical pre-refactor value.
 */
export function resolveLightSettings(environment) {
  const env = environment ?? {};
  const lights = env.lights ?? {};
  const sun = lights.sun ?? {};
  const shadow = sun.shadow ?? {};
  const hemi = lights.hemisphere ?? {};
  const ambient = lights.ambient ?? {};
  const bounce = lights.bounce ?? {};
  return {
    fog: {
      color: color(env.fog?.color, DEFAULT_FOG.color),
      density: num(env.fog?.density, DEFAULT_FOG.density),
    },
    background: color(env.background, DEFAULT_BACKGROUND),
    sun: {
      color: color(sun.color, DEFAULT_LIGHTS.sun.color),
      intensity: num(sun.intensity, DEFAULT_LIGHTS.sun.intensity),
      distance: num(sun.distance, DEFAULT_LIGHTS.sun.distance),
      target: vec(sun.target, DEFAULT_LIGHTS.sun.target),
      shadow: {
        ortho: vec(shadow.ortho, DEFAULT_LIGHTS.sun.shadow.ortho),
        near: num(shadow.near, DEFAULT_LIGHTS.sun.shadow.near),
        far: num(shadow.far, DEFAULT_LIGHTS.sun.shadow.far),
        bias: num(shadow.bias, DEFAULT_LIGHTS.sun.shadow.bias),
        normalBias: num(shadow.normalBias, DEFAULT_LIGHTS.sun.shadow.normalBias),
        radius: num(shadow.radius, DEFAULT_LIGHTS.sun.shadow.radius),
      },
    },
    hemi: {
      skyColor: color(hemi.skyColor, DEFAULT_LIGHTS.hemisphere.skyColor),
      groundColor: color(hemi.groundColor, DEFAULT_LIGHTS.hemisphere.groundColor),
      intensity: num(hemi.intensity, DEFAULT_LIGHTS.hemisphere.intensity),
    },
    ambient: {
      color: color(ambient.color, DEFAULT_LIGHTS.ambient.color),
      intensity: num(ambient.intensity, DEFAULT_LIGHTS.ambient.intensity),
    },
    bounce: {
      color: color(bounce.color, DEFAULT_LIGHTS.bounce.color),
      intensity: num(bounce.intensity, DEFAULT_LIGHTS.bounce.intensity),
      position: vec(bounce.position, DEFAULT_LIGHTS.bounce.position),
      target: vec(bounce.target, DEFAULT_LIGHTS.bounce.target),
    },
  };
}

function buildLights(ctx) {
  const scene = ctx.scene;
  const q = QUALITY_SETTINGS[ctx.quality] ?? QUALITY_SETTINGS.high;
  const settings = resolveLightSettings(ctx.data?.environment);

  scene.fog = new THREE.FogExp2(settings.fog.color, settings.fog.density);
  scene.background = new THREE.Color(settings.background);

  // low western sun — long shadows fall to the north-east
  const sunSettings = settings.sun;
  const sun = new THREE.DirectionalLight(sunSettings.color, sunSettings.intensity);
  sun.name = 'sun';
  const sunDir = getSunDirection(ctx.data?.environment);
  sun.position.set(sunDir.x * sunSettings.distance, sunDir.y * sunSettings.distance, sunDir.z * sunSettings.distance);
  sun.target.position.set(sunSettings.target[0], sunSettings.target[1], sunSettings.target[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  const ortho = sunSettings.shadow.ortho;
  sun.shadow.camera.left = ortho[0];
  sun.shadow.camera.right = ortho[1];
  sun.shadow.camera.top = ortho[2];
  sun.shadow.camera.bottom = ortho[3];
  sun.shadow.camera.near = sunSettings.shadow.near;
  sun.shadow.camera.far = sunSettings.shadow.far;
  sun.shadow.bias = sunSettings.shadow.bias;
  sun.shadow.normalBias = sunSettings.shadow.normalBias;
  sun.shadow.radius = sunSettings.shadow.radius;
  scene.add(sun, sun.target);
  ctx.sun = sun;

  // sky / ground fill
  const hemi = new THREE.HemisphereLight(settings.hemi.skyColor, settings.hemi.groundColor, settings.hemi.intensity);
  hemi.name = 'hemi';
  scene.add(hemi);
  ctx.hemi = hemi;

  const ambient = new THREE.AmbientLight(settings.ambient.color, settings.ambient.intensity);
  scene.add(ambient);

  // warm bounce from the lit adobe walls on the east side
  const bounce = new THREE.DirectionalLight(settings.bounce.color, settings.bounce.intensity);
  bounce.position.set(settings.bounce.position[0], settings.bounce.position[1], settings.bounce.position[2]);
  bounce.target.position.set(settings.bounce.target[0], settings.bounce.target[1], settings.bounce.target[2]);
  scene.add(bounce, bounce.target);

  ctx.lights = [sun, hemi, ambient, bounce];
  return sun;
}

export { buildLights };
export default buildLights;
