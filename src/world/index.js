/**
 * SANDSTRIKE // sandstorm protocol — world entry point.
 *
 * `src/world.js` was split into this directory (see
 * `.scratch/maps-refactor/CONTRACT.md`). This module keeps the public API of the
 * old monolith, owns the build order / progress reporting / context object, and
 * loads the authoritative map data from `src/world/data/` (map-agnostic layer).
 *
 * Public API (see TEAM_SPEC.md):
 *   const world = await createWorld(scene, renderer, { quality, onProgress, mapId });
 *   world.collideMeshes, world.collisionBoxes, world.playerSpawn, world.enemySpawns,
 *   world.mapBounds, world.landmarks, world.mapId, world.mapName,
 *   world.update(dt, time), world.dispose()
 */
import { clamp } from '../utils.js';
import { createTextureLibrary } from '../textures.js';
import { QUALITY_SETTINGS } from './quality.js';
import { StaticBatcher } from './batcher.js';
import { createMaterials } from './materials.js';
import { buildSky, buildEnvironment } from './sky.js';
import { buildLights } from './lights.js';
import { buildGroundAndTerrain } from './terrain.js';
import { buildIslandTerrain } from './island-terrain.js';
import { buildIslandWater } from './island-water.js';
import { buildIslandAmbience } from './island-ambience.js';
import { buildIslandProps } from './island-props.js';
import { ensureBatches, buildArchitecture } from './architecture.js';
import { buildProps } from './props.js';
import {
  buildCloths,
  buildDecalsAndPosters,
  buildLanterns,
  buildPracticalLights,
  buildSiteDressing,
} from './dressing.js';
import { buildDust, buildSmoke } from './ambience.js';
import { updateWorld, disposeWorld } from './update.js';
import { setFoliageWindScale } from './foliage-fx.js';
import { loadMap, listMaps, DEFAULT_MAP_ID } from './data/index.js';

/** Format identifier of the map JSON parts consumed by the data layer. */
export const MAP_FORMAT = 'sandstrike/map@1';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Deep-clone plain map data (model stage requires an unshared, THREE-free object). */
function clonePlainData(data) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(data);
    } catch (error) {
      /* fall through to the JSON copy */
    }
  }
  return JSON.parse(JSON.stringify(data));
}

/** Resolve a requested map id, falling back to DEFAULT_MAP_ID when unknown. */
function resolveMapData(requestedMapId) {
  const requested = typeof requestedMapId === 'string' && requestedMapId.trim() ? requestedMapId.trim() : DEFAULT_MAP_ID;
  let mapId = requested;
  if (requested !== DEFAULT_MAP_ID) {
    let known = null;
    try {
      known = listMaps();
    } catch (error) {
      known = null; // registry unavailable — let loadMap decide below
    }
    if (Array.isArray(known) && known.length) {
      const ids = known
        .map((entry) => (typeof entry === 'string' ? entry : entry && typeof entry.id === 'string' ? entry.id : null))
        .filter((id) => typeof id === 'string' && id.length > 0);
      if (ids.length && !ids.includes(requested)) {
        console.warn(`[world] unknown map id "${requested}" — falling back to "${DEFAULT_MAP_ID}"`);
        mapId = DEFAULT_MAP_ID;
      }
    }
  }
  let data;
  try {
    data = loadMap(mapId);
  } catch (error) {
    if (mapId === DEFAULT_MAP_ID) throw error;
    console.warn(`[world] failed to load map "${mapId}" — falling back to "${DEFAULT_MAP_ID}"`, error);
    mapId = DEFAULT_MAP_ID;
    data = loadMap(mapId);
  }
  return {
    mapId: data && typeof data.id === 'string' && data.id ? data.id : mapId,
    data,
  };
}

/**
 * Compatibility export kept for the isolated model stage: the authoritative map
 * data of the default map, freshly cloned so callers may structuredClone() it.
 */
function buildWorldData() {
  return clonePlainData(loadMap(DEFAULT_MAP_ID));
}

// ===========================================================================
// PUBLIC API — createWorld()
// ===========================================================================

/**
 * Build the complete outpost.
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ quality?: 'medium'|'high'|'ultra', onProgress?: (progress:number, label:string)=>void, mapId?: string }} [options]
 */
export async function createWorld(scene, renderer, { quality = 'high', onProgress, mapId } = {}) {
  const q = QUALITY_SETTINGS[quality] ? quality : 'high';
  const report = (p, label) => {
    if (typeof onProgress === 'function') {
      try {
        onProgress(clamp(p, 0, 1), label);
      } catch (err) {
        /* UI errors must never break world generation */
      }
    }
  };

  const childrenBefore = new Set(scene.children);
  const textures = [];
  const objects = [];
  const disposables = [];
  const materialsCustom = [];
  const collideMeshes = [];
  const lights = [];
  const flickers = [];
  const cloths = [];
  const animated = [];
  const req = { banners: [], awnings: [], sails: [], flags: [], decals: [], posters: [], lanterns: [], lights: [], smoke: [] };

  const ctx = {
    scene,
    renderer,
    quality: q,
    data: null,
    tex: null,
    materials: null,
    textures,
    objects,
    disposables,
    materialsCustom,
    collideMeshes,
    lights,
    flickers,
    cloths,
    animated,
    req,
    batcher: new StaticBatcher(),
    sky: null,
    skyMaterial: null,
    sun: null,
    hemi: null,
    glowPoints: null,
    dust: null,
    smoke: null,
    pmremTarget: null,
    worldObjects: [],
    disposed: false,
  };

  const loaded = resolveMapData(mapId);
  const mapData = loaded.data;
  ctx.data = mapData;
  const islandStyle = mapData?.style === 'island';
  report(0.02, islandStyle ? 'SURVEYING ATOLL 09' : 'SURVEYING SECTOR 7');
  if (mapData.warnings && mapData.warnings.length) {
    console.warn('[world] layout warnings:', mapData.warnings);
  }

  report(0.04, 'GENERATING MATERIALS');
  ctx.tex = await createTextureLibrary(renderer, {
    quality: q,
    onProgress: (p, label) => report(0.04 + p * 0.46, label),
  });
  ctx.materials = createMaterials(ctx.tex);
  // Low tiers get a calmer canopy (cheaper vertex work is unaffected, but the look is
  // consistent with the reduced leaf density those tiers build).
  setFoliageWindScale({ lowest: 0.35, low: 0.6, medium: 0.85, high: 1, ultra: 1.1 }[q] ?? 1);
  for (const m of Object.values(ctx.materials)) materialsCustom.push(m);
  await nextFrame();

  report(0.52, islandStyle ? 'LIGHTING THE TROPICAL DAWN' : 'LIGHTING THE GOLDEN HOUR');
  buildSky(ctx);
  buildLights(ctx);
  buildEnvironment(ctx);
  await nextFrame();

  if (islandStyle) {
    // ---------------------------------------------------------- tropical island
    report(0.6, 'SHAPING THE ATOLL');
    buildIslandTerrain(ctx);
    await nextFrame();

    report(0.69, 'RAISING THE VILLAGE & RUINS');
    ensureBatches(ctx);
    buildIslandProps(ctx);
    await nextFrame();

    report(0.8, 'FILLING THE LAGOON');
    buildIslandWater(ctx);
    buildIslandAmbience(ctx);
    await nextFrame();

    report(0.87, 'LIGHTING THE CAMPFIRES');
    buildSiteDressing(ctx);
    buildLanterns(ctx);
    buildPracticalLights(ctx);
    buildSmoke(ctx);
    await nextFrame();
  } else {
    report(0.6, 'SCULPTING DUNES');
    buildGroundAndTerrain(ctx);
    await nextFrame();

    report(0.68, 'RAISING WALLS & GATES');
    buildArchitecture(ctx);
    await nextFrame();

    report(0.77, 'DRESSING THE OUTPOST');
    buildProps(ctx);
    buildSiteDressing(ctx);
    await nextFrame();

    report(0.85, 'HANGING CLOTH & STENCILS');
    buildCloths(ctx);
    buildDecalsAndPosters(ctx);
    buildLanterns(ctx);
    buildPracticalLights(ctx);
    buildDust(ctx);
    buildSmoke(ctx);
    await nextFrame();
  }

  report(0.93, 'FLUSHING GEOMETRY');
  const batchMeshes = ctx.batcher.flush(scene, ctx.materials, ctx.collideMeshes);
  for (const m of batchMeshes) objects.push(m);
  // world objects are exactly what this builder added to the scene
  ctx.worldObjects = scene.children.filter((child) => !childrenBefore.has(child));
  // Rebuild the raycast target list: exactly one entry per solid visual mesh. Skip
  // batches flagged collide:false (dark recess planes, glass, glow, coals) and drop
  // the duplicate instanced entries the old two-pass rebuild produced.
  ctx.collideMeshes.length = 0;
  const seenCollide = new Set();
  for (const obj of ctx.worldObjects) {
    if (!obj || !obj.isObject3D || seenCollide.has(obj)) continue;
    const surface = obj.userData && obj.userData.surface;
    if (!surface && !obj.isInstancedMesh) continue;
    if (obj.userData && obj.userData.collide === false) continue;
    seenCollide.add(obj);
    ctx.collideMeshes.push(obj);
  }
  // make sure the ground counts for raycasts even without a surface on batch registration
  if (ctx.ground && !ctx.collideMeshes.includes(ctx.ground)) ctx.collideMeshes.push(ctx.ground);
  ctx.collideMeshes = ctx.collideMeshes.filter((o) => o && o.isObject3D);

  report(1, islandStyle ? 'ATOLL SECURED' : 'SECTOR SECURED');

  if (typeof window !== 'undefined') {
    window.__worldBuilt = ctx;
  }

  const world = {
    collideMeshes: ctx.collideMeshes,
    collisionBoxes: ctx.data.collisionBoxes,
    playerSpawn: ctx.data.playerSpawn,
    enemySpawns: ctx.data.enemySpawns,
    mapBounds: ctx.data.mapBounds,
    landmarks: ctx.data.landmarks,
    mapId: loaded.mapId,
    mapName: (ctx.data && typeof ctx.data.name === 'string' && ctx.data.name) || loaded.mapId,
    /** 'island' for tropical maps, 'outpost' for the desert / range maps (audio bed switch). */
    style: islandStyle ? 'island' : 'outpost',
    update(dt, time) {
      updateWorld(ctx, dt ?? 0.016, time ?? performance.now() / 1000);
    },
    dispose() {
      disposeWorld(ctx);
    },
    /** Optional live quality switch (shadows only; materials stay intact). */
    setQuality(nextQuality) {
      if (!QUALITY_SETTINGS[nextQuality]) return;
      ctx.quality = nextQuality;
      const settings = QUALITY_SETTINGS[nextQuality];
      if (ctx.sun) {
        if (ctx.sun.shadow.map) {
          ctx.sun.shadow.map.dispose();
          ctx.sun.shadow.map = null;
        }
        ctx.sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
        ctx.sun.shadow.needsUpdate = true;
      }
      const envIntensity = { lowest: 0.35, low: 0.4, medium: 0.45, high: 0.55, ultra: 0.55 };
      ctx.scene.environmentIntensity = envIntensity[nextQuality] ?? 0.55;
      setFoliageWindScale({ lowest: 0.35, low: 0.6, medium: 0.85, high: 1, ultra: 1.1 }[nextQuality] ?? 1);
    },
    /** Debug info (dev tools). */
    debug: {
      get drawInfo() {
        return { sun: ctx.sun, lights: ctx.lights.length, cloths: ctx.cloths.length, batches: batchMeshes.length };
      },
    },
  };

  return world;
}

export {
  buildWorldData,
  createMaterials,
  StaticBatcher,
  ensureBatches,
  buildEnvironment,
  buildLights,
  buildCloths,
  buildDecalsAndPosters,
  buildLanterns,
  buildPracticalLights,
  loadMap,
  listMaps,
  DEFAULT_MAP_ID,
};
