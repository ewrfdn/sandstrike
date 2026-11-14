/**
 * SANDSTRIKE // sandstorm protocol — dust motes & smoke systems.
 *
 * Split verbatim out of src/world.js (buildDust / buildSmoke). Mote budgets come
 * from QUALITY_SETTINGS; the wind-box extent and height band come from
 * `ctx.data.environment.ambience` (map data), with the pre-refactor constants as
 * fallbacks. Smoke consumes the `ctx.req.smoke` request list (model smoke plus
 * map-level dressing.smoke).
 */
import * as THREE from 'three';
import { makeRNG } from '../utils.js';
import { QUALITY_SETTINGS } from './quality.js';

// Pre-refactor world.js defaults (contract.md environment.json ambience defaults).
const DEFAULT_AMBIENCE = Object.freeze({ lanternGlowScale: 620, dustSpread: 64, dustY: Object.freeze([0.2, 8.7]) });

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const pair = (value, fallback) => (
  Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) ? value : fallback
);

/** Resolve `environment.ambience` against the pre-refactor defaults. */
export function resolveAmbience(environment) {
  const ambience = environment?.ambience ?? {};
  return {
    lanternGlowScale: num(ambience.lanternGlowScale, DEFAULT_AMBIENCE.lanternGlowScale),
    dustSpread: num(ambience.dustSpread, DEFAULT_AMBIENCE.dustSpread),
    dustY: pair(ambience.dustY, DEFAULT_AMBIENCE.dustY),
  };
}

function buildDust(ctx) {
  const q = QUALITY_SETTINGS[ctx.quality] ?? QUALITY_SETTINGS.high;
  const count = q.dust;
  const ambience = resolveAmbience(ctx.data?.environment);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const rng = makeRNG(3535);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rng() - 0.5) * ambience.dustSpread;
    positions[i * 3 + 1] = ambience.dustY[0] + rng() * (ambience.dustY[1] - ambience.dustY[0]);
    positions[i * 3 + 2] = (rng() - 0.5) * ambience.dustSpread;
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
      void main() {
        vec3 p = position;
        float t = uTime * 0.06;
        p.x += sin(t * 2.1 + aSeed * 21.0) * 2.4;
        p.z += cos(t * 1.7 + aSeed * 17.0) * 2.4;
        p.y += sin(t * 3.4 + aSeed * 9.0) * 0.7 + fract(uTime * 0.015 + aSeed) * 0.8;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp((0.9 + aSeed * 1.8) * (13.0 / max(2.0, -mv.z)), 1.0, 7.0);
        gl_Position = projectionMatrix * mv;
        vAlpha = 0.10 + 0.22 * aSeed;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float d = dot(uv, uv);
        if (d > 1.0) discard;
        float a = (1.0 - d) * (1.0 - d) * vAlpha;
        gl_FragColor = vec4(vec3(1.0, 0.84, 0.62) * 1.2, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'dust-motes';
  ctx.scene.add(points);
  ctx.objects.push(points);
  ctx.disposables.push(geo, mat);
  ctx.dust = points;
}

function buildSmoke(ctx) {
  const systems = ctx.req.smoke;
  if (!systems.length) return;
  let total = 0;
  for (const s of systems) total += s.count;
  const positions = new Float32Array(total * 3);
  const seeds = new Float32Array(total);
  const colors = new Float32Array(total * 3);
  const rates = new Float32Array(total);
  const rises = new Float32Array(total);
  const spreads = new Float32Array(total);
  const rng = makeRNG(2626);
  let i = 0;
  for (const s of systems) {
    const col = new THREE.Color(s.color ?? 0x8a8074);
    for (let k = 0; k < s.count; k++) {
      positions[i * 3] = s.x + (rng() - 0.5) * s.spread;
      positions[i * 3 + 1] = s.y;
      positions[i * 3 + 2] = s.z + (rng() - 0.5) * s.spread;
      seeds[i] = rng();
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
      rates[i] = (s.rate ?? 0.4) * (0.7 + rng() * 0.6);
      rises[i] = s.rise ?? 2.2;
      spreads[i] = s.spread ?? 0.4;
      i++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aRate', new THREE.BufferAttribute(rates, 1));
  geo.setAttribute('aRise', new THREE.BufferAttribute(rises, 1));
  geo.setAttribute('aSpread', new THREE.BufferAttribute(spreads, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 560 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; attribute vec3 aColor; attribute float aRate; attribute float aRise; attribute float aSpread;
      uniform float uTime; uniform float uScale;
      varying float vAlpha; varying vec3 vColor;
      void main() {
        float life = fract(uTime * aRate + aSeed * 7.13);
        vec3 p = position;
        p.y += life * aRise;
        p.x += sin(life * 5.1 + aSeed * 13.0) * aSpread * (0.4 + life);
        p.z += cos(life * 4.3 + aSeed * 9.0) * aSpread * (0.4 + life);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.55 + life * 2.4) * uScale / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
        vAlpha = sin(life * 3.1415) * 0.22;
        vColor = aColor;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha; varying vec3 vColor;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float d = dot(uv, uv);
        if (d > 1.0) discard;
        gl_FragColor = vec4(vColor, (1.0 - d) * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'smoke';
  ctx.scene.add(points);
  ctx.objects.push(points);
  ctx.disposables.push(geo, mat);
  ctx.smoke = points;
}

export { buildDust, buildSmoke };
