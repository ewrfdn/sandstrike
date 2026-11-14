/**
 * SANDSTRIKE // level format adapter: `sandstrike/map@1`.
 *
 * A map folder is a manifest (`map.json`) plus composable parts (terrain / environment /
 * architecture / props / dressing / spawns). This adapter turns those raw JSON parts into
 * the normalised `ctx.data` object the world builders consume:
 *
 *   { id, name, subtitle, description, format,
 *     collisionBoxes, playerSpawn, enemySpawns, mapBounds, landmarks, warnings,
 *     layout, terrain, environment, dressing }
 *
 * The `layout` object is byte-for-byte identical (values and derived formulas) to the old
 * `buildWorldData().layout` so the existing model builders (`src/models/world/*`) keep
 * reading the same keys/element shapes. Defaults for every optional part equal the
 * historical hard-coded values, so a new map only needs to override what it changes.
 *
 * Pure data module: no `three`, no DOM.
 */
import { MAP_FORMAT, deepClone, withDefaults } from '../schema.js';
import { buildCollisionBoxes, buildWarnings, resolveEnemySpawns } from '../collision.js';

export const FORMAT = MAP_FORMAT;

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- terrain defaults
// Defaults mirror `buildGroundAndTerrain()` in the pre-refactor src/world.js exactly.
export const TERRAIN_DEFAULTS = Object.freeze({
  ground: {
    size: 69.5,
    segments: 40,
    uvTile: 2.7,
    color: { base: 0.82, spread: 0.32, min: 0.55, max: 1.08, warmth: { gBase: 0.98, gAmp: 0.03, gFreq: 0.9, b: 0.95 } },
  },
  paving: {
    color: [0.8, 0.72, 0.6],
    worldScale: 3.2,
    patches: [
      [0, 9.8, 11.5, 10.5, 0.02],
      [0, -4.6, 9.0, 4.2, 0.02],
      [0, -14.5, 12.0, 10.0, 0.02],
      [27.0, -14.2, 9.0, 8.0, 0.02],
      [17.6, -24.6, 10.0, 7.4, 0.02],
      [-18.0, -24.6, 10.0, 7.4, 0.02],
      [-27.0, -14.5, 11.4, 9.6, 0.02],
      [0, -26.6, 17.0, 5.6, 0.02],
      [25.5, 7.0, 4.0, 16.0, 0.02],
      [-25.5, 7.0, 4.0, 16.0, 0.02],
    ],
  },
  dunes: {
    size: 430,
    segments: 110,
    uvTile: 9.5,
    nearMask: [38, 82],
    farMask: [75, 190],
    baseHeight: -0.45,
    farLift: 9.0,
    heights: [2.2, 5.4, 3.1, 4.5],
    color: { base: 0.8, perHeight: 0.045, heightMid: 4, farDarken: 0.08, min: 0.55, max: 1.06, rgb: [1, 0.97, 0.92] },
  },
  mesas: {
    seed: 9182,
    specs: [
      [-150, -190, 46, 62, 7], [30, -240, 58, 44, 9], [168, -180, 38, 78, 6],
      [235, 20, 30, 92, 8], [180, 160, 44, 60, 6], [-60, 235, 52, 70, 9],
      [-230, 110, 40, 48, 7], [-250, -70, 34, 85, 6],
    ],
  },
  skyline: {
    seed: 4455,
    count: 34,
    distance: [44, 78],
    angleJitter: 0.11,
    // [min, max] intervals: old formula 4 + rng * 11
    width: [4, 15],
    depth: [4, 15],
    height: [4.5, 13.5],
    parapetEvery: 3,
    minaretEvery: 6,
  },
  haze: { radius: 900, segments: 32, color: [0.56, 0.36, 0.20], y: -1.1 },
});

// ------------------------------------------------------------ environment defaults
// Defaults mirror buildSky() / buildLights() / buildEnvironment() / buildDust().
export const ENVIRONMENT_DEFAULTS = Object.freeze({
  sky: {
    sunDirection: [-0.893, 0.305, 0.333],
    zenith: [0.10, 0.235, 0.52],
    horizon: [1.34, 0.78, 0.36],
    dust: [0.52, 0.29, 0.14],
    sunColor: [2.6, 1.7, 0.9],
    cloudColor: [1.5, 1.16, 0.88],
    groundColor: [0.26, 0.17, 0.10],
    domeRadius: 340,
  },
  fog: { color: '#d7a06c', density: 0.0104 },
  background: '#d8a877',
  lights: {
    sun: {
      color: '#ffd2a0',
      intensity: 3.55,
      distance: 130,
      target: [0, 0, -2],
      shadow: { ortho: [-46, 46, 46, -46], near: 30, far: 290, bias: -0.00045, normalBias: 0.055, radius: 2.2 },
    },
    hemisphere: { skyColor: '#8fb2d8', groundColor: '#cf9a60', intensity: 0.82 },
    ambient: { color: '#5b4130', intensity: 0.17 },
    bounce: { color: '#ffb27a', intensity: 0.58, position: [75, 18, -55], target: [0, 0, 0] },
    sunPulse: { amplitude: 0.08, speed: 0.05 },
  },
  environmentMap: {
    intensity: 0.55,
    groundColor: [0.24, 0.16, 0.095],
    cardColor: [1.4, 0.9, 0.55],
    cardDistance: 55,
    groundRadius: 120,
    sphereRadius: 80,
    blur: 0.03,
  },
  ambience: { lanternGlowScale: 620, dustSpread: 64, dustY: [0.2, 8.7] },
});

// --------------------------------------------------------------- dressing defaults
export const DRESSING_DEFAULTS = Object.freeze({
  decals: [],
  posters: [],
  site: { lanterns: [], lights: [], decals: [] },
  smoke: [],
  banners: [],
});

/** Spawn resolution tuning defaults (old hard-coded values in buildWorldData()). */
export const SPAWN_RESOLVE_DEFAULTS = Object.freeze({
  clearance: 1.45,
  playerMinDistance: 4.5,
  searchRadius: 8.0,
  step: 0.5,
  angleSteps: 24,
  validateClearance: 1.1,
  playerClearance: 0.9,
  minCount: 8,
});

/** Layout arrays that always exist after normalisation (old `buildWorldData` keys). */
export const LAYOUT_ARRAY_KEYS = Object.freeze([
  'walls', 'gatePiers', 'boundary', 'towers', 'buildings', 'blocks', 'lowWalls', 'pillars',
  'tunnelPiers', 'arches', 'tunnelArches', 'siteArches', 'stalls', 'crates', 'barrels',
  'sandbagRuns', 'palms', 'lampPosts', 'looseCrates', 'tireStacks', 'sackPiles',
]);

/** Hero prop keys every `sandstrike/map@1` map must provide (collision rules read them). */
export const HERO_KEYS = Object.freeze([
  'well', 'truck', 'campfire', 'flagpoles', 'windmill', 'watchtower', 'radar', 'monument',
  'aLongShade', 'aPlatform', 'bWreck', 'cartPlaza', 'aLongCart',
]);

function describeMissing(object, keys, path) {
  const missing = keys.filter((key) => !(key in (object ?? {})));
  return missing.length ? `${path} is missing required keys: ${missing.join(', ')}` : null;
}

function requireParts(parts, mapId) {
  for (const key of LAYOUT_ARRAY_KEYS) {
    if (!Array.isArray(parts.architecture?.[key]) && !Array.isArray(parts.props?.[key])) {
      throw new Error(`[maps] map "${mapId}": neither architecture.json nor props.json provides the "${key}" array`);
    }
  }
  const heroError = describeMissing(parts.props?.hero, HERO_KEYS, `[maps] map "${mapId}": props.hero`);
  if (heroError) throw new Error(heroError);
}

/**
 * `barrels` / `palms` only store x/z(/s) in JSON; the old buildWorldData() derived the
 * rotation from a stable hash of the position. Keep the exact formulas.
 */
function deriveBarrelYaw(barrel) {
  return { x: barrel.x, z: barrel.z, yaw: (barrel.x * 7.3 + barrel.z * 3.1) % TAU };
}
function derivePalmRotation(palm) {
  return { x: palm.x, z: palm.z, s: palm.s, ry: (palm.x * 13.7 + palm.z * 5.3) % TAU };
}

/**
 * Normalise one `sandstrike/map@1` source ({ manifest, parts }) into `ctx.data`.
 * @param {{ id?: string, manifest: object, parts: object }} source
 */
export function normalize(source) {
  const manifest = source?.manifest ?? {};
  const mapId = manifest.id ?? source?.id ?? 'unknown';
  const parts = {
    terrain: deepClone(source?.parts?.terrain ?? {}),
    environment: deepClone(source?.parts?.environment ?? {}),
    architecture: deepClone(source?.parts?.architecture ?? {}),
    props: deepClone(source?.parts?.props ?? {}),
    dressing: deepClone(source?.parts?.dressing ?? {}),
    spawns: deepClone(source?.parts?.spawns ?? {}),
  };
  requireParts(parts, mapId);

  const A = parts.architecture;
  const P = parts.props;

  // --------------------------------------------------------------------- layout
  // Key order mirrors the old buildWorldData() return object; element shapes are passed
  // through unchanged (extra style/label/door metadata is part of the format).
  const layout = {
    walls: A.walls,
    boundary: A.boundary,
    towers: A.towers,
    buildings: A.buildings,
    blocks: A.blocks,
    lowWalls: A.lowWalls,
    pillars: A.pillars,
    tunnelPiers: A.tunnelPiers,
    arches: A.arches,
    tunnelArches: A.tunnelArches,
    crates: P.crates,
    barrels: P.barrels.map(deriveBarrelYaw),
    sandbagRuns: P.sandbagRuns,
    palms: P.palms.map(derivePalmRotation),
    lampPosts: P.lampPosts,
    gatePiers: A.gatePiers,
    stalls: A.stalls,
    hero: P.hero,
    siteArches: A.siteArches,
    looseCrates: P.looseCrates,
    tireStacks: P.tireStacks,
    sackPiles: P.sackPiles,
  };

  // -------------------------------------------------------------- world metadata
  const playerSpawn = {
    x: manifest.playerSpawn?.x ?? 0,
    y: manifest.playerSpawn?.y ?? 0,
    z: manifest.playerSpawn?.z ?? 0,
    yaw: manifest.playerSpawn?.yaw ?? 0,
  };
  const mapBounds = {
    minX: manifest.bounds?.minX ?? -33,
    maxX: manifest.bounds?.maxX ?? 33,
    minZ: manifest.bounds?.minZ ?? -33,
    maxZ: manifest.bounds?.maxZ ?? 33,
  };

  // ---------------------------------------------------------- collision + spawns
  // Explicit blockers live next to the part that owns them (architecture / props) and
  // are appended after the rule-derived boxes, exactly like the contract describes.
  const explicitSolids = [...(A.solids ?? []), ...(P.solids ?? [])];
  const collisionBoxes = buildCollisionBoxes(layout, explicitSolids);

  const resolveConfig = withDefaults(parts.spawns.resolve ?? {}, SPAWN_RESOLVE_DEFAULTS);
  const candidates = Array.isArray(parts.spawns.candidates) ? parts.spawns.candidates : [];
  const enemySpawns = resolveEnemySpawns(candidates, collisionBoxes, playerSpawn, resolveConfig);
  const warnings = buildWarnings(collisionBoxes, enemySpawns, playerSpawn, resolveConfig);

  const landmarks = (Array.isArray(parts.spawns.landmarks) ? parts.spawns.landmarks : []).map((l) => ({
    x: l.x, z: l.z, name: l.name,
  }));

  // ------------------------------------------------------- builder-consumed parts
  const terrain = withDefaults(parts.terrain, TERRAIN_DEFAULTS);
  const environment = withDefaults(parts.environment, ENVIRONMENT_DEFAULTS);
  const dressing = withDefaults(parts.dressing, DRESSING_DEFAULTS);

  return {
    id: mapId,
    name: manifest.name ?? mapId,
    subtitle: manifest.subtitle ?? '',
    description: manifest.description ?? '',
    format: manifest.format ?? FORMAT,
    collisionBoxes,
    playerSpawn,
    enemySpawns,
    mapBounds,
    landmarks,
    warnings,
    layout,
    terrain,
    environment,
    dressing,
  };
}
