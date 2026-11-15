/**
 * SANDSTRIKE // tropical ocean: transparent, refracting water with live shoreline surf.
 *
 * Contract (ISLAND_MAP_SPEC.md §4.2):
 *   buildIslandWater(ctx) -> { mesh, foam, level, update(time) }
 *
 * The visual is assembled from four pieces, all driven by the shared shoreline contract in
 * `island-shore.js` so the water, the surf and the sand agree to the millimetre:
 *
 *   1. `ocean/seabed-capture.js` — one-time orthographic top-down render of the seabed
 *      (beach / lagoon / coral meshes) into a linear HalfFloat target. This is the
 *      "what is under the water" lookup for the refraction.
 *   2. `ocean/water.js` — one draw call: a radial tessellated surface (dense near the
 *      shore, coarse to a 470 m horizon) displaced by the swell + shore run-up, shaded
 *      with refracted bottom, Beer-Lambert absorption/in-scatter, caustics, fresnel sky
 *      reflection, HDR sun glitter and horizon haze.
 *   3. `ocean/surf.js` (surf) — foam that hugs the *displaced* waterline (lace edge, wash
 *      band, whitecaps), same displacement as the water, so it can never lag behind.
 *   4. `ocean/surf.js` (wet sand) — dark damp-sand band with a short wetness memory that
 *      advances on the run-up and drains back with the backwash.
 *
 * Budgets live in `ocean/quality.js` (`ctx.quality`); LOWEST skips the capture and uses the
 * procedural bed. Draw calls added: 3 steady-state (water, surf, wet sand) + the one-time
 * capture. The water is visual-only: no collision, no raycast surface.
 */
import * as THREE from 'three';
import {
  shoreProfile,
  shoreLutTextureData,
  shoreUniformValues,
  SHORE_LUT_SIZE,
} from './island-shore.js';
import { oceanTier } from './ocean/quality.js';
import { buildOceanDefines, buildWaveUniforms } from './ocean/glsl.js';
import { captureSeabed } from './ocean/seabed-capture.js';
import { createWaterSurface } from './ocean/water.js';
import { createSurf, createWetSand } from './ocean/surf.js';

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const vec3 = (value, fallback) => (Array.isArray(value) && value.length >= 3 ? value : fallback);
const clamp = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);

/** Nearest-filtered RGBA-float DataTexture of the shared shoreline height LUT. */
function createShoreLutTexture(profile) {
  const data = shoreLutTextureData(profile.lut);
  const texture = new THREE.DataTexture(data, SHORE_LUT_SIZE, 1, THREE.RGBAFormat, THREE.FloatType);
  texture.name = 'Sandstrike.ShoreLut';
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** 1x1 dark-teal stand-in so the sampler is always bound when the capture is off. */
function createFallbackSeabedTexture() {
  const data = new Uint8Array([14, 52, 58, 255]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'Sandstrike.SeabedFallback';
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Sunrise palette: sky dome values drive the reflection/haze, sea values the body. */
function buildPalette(ctx) {
  const sea = ctx.data?.terrain?.sea ?? {};
  const sky = ctx.data?.environment?.sky ?? {};
  const shallow = vec3(sea.shallow, [0.10, 0.34, 0.32]);
  const deep = vec3(sea.deep, [0.02, 0.09, 0.13]);
  const sunDir = vec3(sky.sunDirection, [0.80, 0.26, 0.52]);
  const horizon = vec3(sky.horizon, [0.74, 0.71, 0.66]);
  const zenith = vec3(sky.zenith, [0.14, 0.40, 0.76]);
  const dust = vec3(sky.dust, [0.46, 0.52, 0.56]);
  const sunColor = vec3(sky.sunColor, [1.12, 0.94, 0.74]);
  return {
    sun: new THREE.Vector3(sunDir[0], sunDir[1], sunDir[2]).normalize(),
    sunColor: new THREE.Vector3(sunColor[0], sunColor[1], sunColor[2]),
    horizon: new THREE.Vector3(horizon[0], horizon[1], horizon[2]),
    zenith: new THREE.Vector3(zenith[0], zenith[1], zenith[2]),
    dust: new THREE.Vector3(dust[0], dust[1], dust[2]),
    // saturated tropical turquoise, derived from the map's sea palette
    shallow: new THREE.Vector3(
      shallow[0] * 0.35 + 0.052 * 0.65,
      shallow[1] * 0.35 + 0.300 * 0.65,
      shallow[2] * 0.35 + 0.315 * 0.65
    ),
    deep: new THREE.Vector3(
      deep[0] * 0.30 + 0.010 * 0.70,
      deep[1] * 0.30 + 0.062 * 0.70,
      deep[2] * 0.30 + 0.135 * 0.70
    ),
  };
}

/** Assemble the uniform object shared by all three ocean materials. */
function createOceanUniforms(ctx, profile, tier, capture) {
  const palette = buildPalette(ctx);
  const env = ctx.data?.environment ?? {};
  const fogDensity = clamp(num(env.fog?.density, 0.0076), 0.0004, 0.05);
  const shore = shoreUniformValues(profile);
  const lutTexture = createShoreLutTexture(profile);
  const seabedTexture = capture?.texture ?? createFallbackSeabedTexture();
  const extent = Math.max(16, num(capture?.extent, tier.captureExtent));
  const waveUniforms = buildWaveUniforms(tier, THREE);

  // Beer-Lambert absorption coefficients (1/m): red dies first, exactly what makes a
  // tropical lagoon read turquoise at 30 cm and blue-teal at 8 m. Values are for very
  // clear lagoon water (the terrain's submerged vertex colours are pale sand; the tint
  // must come from here, not from a pre-darkened bed).
  const absorb = new THREE.Vector3(1.00, 0.220, 0.160);

  const uniforms = {
    uTime: { value: 0 },
    uDebug: { value: 0 },
    uSunDir: { value: palette.sun },
    uSunColor: { value: palette.sunColor },
    uHorizon: { value: palette.horizon },
    uZenith: { value: palette.zenith },
    uDust: { value: palette.dust },
    uFogDensity: { value: fogDensity },
    // water body
    uShallow: { value: palette.shallow },
    uDeep: { value: palette.deep },
    uAbsorb: { value: absorb },
    // in-scattered radiance of the water column: bright turquoise in the shallows,
    // dark blue-teal once the column is deep (see the depth blend in the shader)
    uScatterShallow: { value: new THREE.Vector3(0.048, 0.275, 0.360) },
    uScatterDeep: { value: new THREE.Vector3(0.007, 0.042, 0.110) },
    // the ortho capture is mip-averaged (150 m away), which reads a little dark; a small
    // gain puts the baked bed on the same luminance as the live sand without double-tinting
    uSeabedGain: { value: 1.30 },
    // procedural fallback bed (LOWEST / outside the capture)
    uSandShallow: { value: new THREE.Vector3(0.44, 0.39, 0.28) },
    uSandDeep: { value: new THREE.Vector3(0.10, 0.145, 0.135) },
    // surf / foam tint (warm-white, catches the low sun)
    uFoamColor: { value: new THREE.Vector3(0.88, 0.93, 0.95) },
    // refraction capture
    uSeabed: { value: seabedTexture },
    uSeabedRect: { value: new THREE.Vector4(0, 0, 1 / (2 * extent), capture ? 1 : 0) },
    // shared shoreline LUT (see island-shore.js)
    uShoreLut: { value: lutTexture },
    uShoreLutStep: { value: shore.lutStep },
    uShoreWarpAmp: { value: new THREE.Vector3(shore.warpAmp[0], shore.warpAmp[1], shore.warpAmp[2]) },
    uShoreWarpFreq: { value: new THREE.Vector3(shore.warpFreq[0], shore.warpFreq[1], shore.warpFreq[2]) },
    uShoreWarpPhase: { value: new THREE.Vector3(shore.warpPhase[0], shore.warpPhase[1], shore.warpPhase[2]) },
    uShoreLevel: { value: shore.level },
    ...waveUniforms,
  };

  return { uniforms, palette, lutTexture, seabedTexture };
}

/**
 * Build the ocean + surf.
 * @param {object} ctx world context from createWorld()
 * @returns {{ mesh: (THREE.Mesh|null), foam: (THREE.Mesh|null), level: number, update: (time:number)=>void }}
 */
export function buildIslandWater(ctx) {
  const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const terrain = ctx?.data?.terrain ?? {};
  const sea = terrain.sea ?? {};
  const level = num(sea.level, -0.38);
  const tier = oceanTier(ctx?.quality);

  try {
    const profile = shoreProfile(terrain);
    const capture = captureSeabed(ctx, { resolution: tier.capture, extent: tier.captureExtent });
    const { uniforms, lutTexture, seabedTexture } = createOceanUniforms(ctx, profile, tier, capture);

    const surface = createWaterSurface(ctx, { profile, tier, uniforms });
    const surf = createSurf(ctx, { profile, tier, uniforms, lift: 0.022 });
    const wetSand = createWetSand(ctx, { profile, tier, uniforms, lift: 0.018 });

    // ---- bookkeeping: expose stats, register GPU resources for disposal
    const stats = {
      tier: ctx?.quality ?? 'medium',
      capture: capture ? { resolution: capture.resolution, extent: capture.extent, meshes: capture.meshes } : null,
      drawCalls: 3,
      triangles: surface.stats.triangles + surf.stats.triangles + wetSand.stats.triangles,
      waterTriangles: surface.stats.triangles,
      surfTriangles: surf.stats.triangles,
      wetSandTriangles: wetSand.stats.triangles,
      vertices: surface.stats.vertices + surf.stats.vertices + wetSand.stats.vertices,
      buildMs: Math.round((typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - startedAt),
      defines: buildOceanDefines(tier),
    };
    ctx.disposables.push(lutTexture, seabedTexture);
    if (capture) ctx.disposables.push({ dispose: () => capture.target.dispose() });
    for (const t of [lutTexture, seabedTexture]) if (Array.isArray(ctx.textures)) ctx.textures.push(t);

    let disposed = false;
    const water = {
      mesh: surface.mesh,
      foam: surf.mesh,
      level: profile.level,
      /** Called by updateWorld() every frame; only touches uniforms (zero allocations). */
      update(time) {
        uniforms.uTime.value = typeof time === 'number' && Number.isFinite(time) ? time : 0;
      },
      // ---- extras (debug / QA / world dispose) ----
      surf: surf.mesh,
      wetSand: wetSand.mesh,
      profile,
      tier: tier,
      stats,
      uniforms,
      capture,
      materials: [surface.material, surf.material, wetSand.material],
      dispose() {
        if (disposed) return;
        disposed = true;
        try {
          surface.material.dispose();
          surf.material.dispose();
          wetSand.material.dispose();
          surface.geometry.dispose();
          surf.geometry.dispose();
          wetSand.geometry.dispose();
          capture?.target?.dispose();
          lutTexture.dispose();
          if (seabedTexture !== capture?.texture) seabedTexture.dispose();
        } catch (error) {
          /* never throw from dispose */
        }
      },
    };
    ctx.water = water;
    // Debug handle (QA probes can read tier/capture/triangle counts without a build-time log).
    ctx.ocean = {
      profile,
      tier,
      capture,
      uniforms,
      stats,
      meshes: { surface, surf, wetSand },
      /** Debug-only: re-bake the seabed capture (e.g. after adding a test marker mesh). */
      recapture: () => captureSeabed(ctx, { resolution: tier.capture, extent: tier.captureExtent }),
    };
    if (typeof console !== 'undefined' && console.info) {
      console.info(
        `[ocean] tier=${stats.tier} tris=${stats.triangles} (water ${stats.waterTriangles} / surf ${stats.surfTriangles} / wet ${stats.wetSandTriangles}) ` +
          `capture=${capture ? `${capture.resolution}px x${capture.meshes} meshes` : 'procedural'} build=${stats.buildMs}ms`,
      );
    }
    return water;
  } catch (error) {
    // A broken ocean must never break world generation: fall back to an inert water stub.
    console.warn('[ocean] island water build failed — ocean disabled for this world', error);
    const stub = {
      mesh: null,
      foam: null,
      level,
      update() {},
      stats: { tier: ctx?.quality ?? 'medium', drawCalls: 0, triangles: 0, failed: true },
      dispose() {},
    };
    ctx.water = stub;
    return stub;
  }
}

export default buildIslandWater;
