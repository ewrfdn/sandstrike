/**
 * SANDSTRIKE // map data layer.
 *
 * `loadMap(id)` is the single entry point the world builders use to obtain the
 * authoritative level data (formerly the hard-coded `buildWorldData()` return value):
 *
 *   { id, name, subtitle, description, format,
 *     collisionBoxes, playerSpawn, enemySpawns, mapBounds, landmarks, warnings,
 *     layout, terrain, environment, dressing }
 *
 * Output is plain structured-cloneable data (no functions, no three.js objects), so it
 * can be cached, diffed, dumped to JSON or cloned into per-build contexts.
 *
 * Map sources are registered in `src/config/maps/index.js`; each manifest declares its
 * `format`, and this module dispatches to the matching adapter in `./formats/`.
 * Pure data module: no `three`, no DOM — `node .scratch/maps-refactor/check-parity.mjs`
 * imports it directly.
 */
import { MAP_SOURCES, DEFAULT_MAP_ID } from '../../config/maps/index.js';
import { shoreProfile } from '../island-shore.js';
import {
  MAP_FORMAT,
  MAP_FORMATS,
  check,
  deepClone,
  findImpureData,
  isFiniteNumber,
  isPlainObject,
  requireArray,
  requireColor,
  requireNumbers,
  requireObject,
  requireStrings,
} from './schema.js';
import * as v1 from './formats/v1.js';
import * as v2 from './formats/v2.js';
import { ISLAND_LAYOUT_KEYS } from './formats/v2.js';

/** Registered adapters keyed by manifest `format`. Add a new format by importing its adapter. */
const ADAPTERS = Object.freeze({
  [v1.FORMAT]: v1.normalize,
  [v2.FORMAT]: v2.normalize,
});

export { MAP_FORMAT, MAP_FORMATS, DEFAULT_MAP_ID };

/**
 * List every registered map (cheap, manifest-level only).
 * @returns {Array<{id:string,name:string,subtitle:string,description:string,format:string,parts:string[]}>}
 */
export function listMaps() {
  return Object.keys(MAP_SOURCES).map((id) => {
    const source = MAP_SOURCES[id] ?? {};
    const manifest = isPlainObject(source.manifest) ? source.manifest : {};
    return {
      id,
      name: manifest.name ?? id,
      subtitle: manifest.subtitle ?? '',
      description: manifest.description ?? '',
      format: manifest.format ?? MAP_FORMAT,
      parts: Object.keys(source.parts ?? {}),
    };
  });
}

/**
 * Load and normalise one map by id.
 *
 * @param {string} [id] map id registered in `src/config/maps/index.js`
 * @returns {object} normalised map data (pure, structured-cloneable)
 * @throws {Error} when the id is unknown (message lists the available ids) or the map
 *                 is malformed / uses an unsupported `format`
 */
export function loadMap(id) {
  const requested = id === undefined || id === null || id === '' ? DEFAULT_MAP_ID : String(id);
  const source = MAP_SOURCES[requested];
  if (!source) {
    const available = Object.keys(MAP_SOURCES);
    throw new Error(`[maps] unknown map id "${requested}". Available maps: ${available.join(', ')}`);
  }
  const manifest = source.manifest;
  if (!isPlainObject(manifest)) {
    throw new Error(`[maps] map "${requested}" has no manifest object (expected a map.json import)`);
  }
  const manifestId = manifest.id ?? requested;
  if (manifestId !== requested) {
    throw new Error(`[maps] map "${requested}": manifest id "${manifestId}" must equal the folder/registry id`);
  }
  const format = manifest.format ?? MAP_FORMAT;
  const normalize = ADAPTERS[format];
  if (!normalize) {
    throw new Error(
      `[maps] map "${requested}" uses unsupported format "${format}". Supported formats: ${Object.keys(ADAPTERS).join(', ')}`,
    );
  }

  const data = normalize({ id: requested, manifest: deepClone(manifest), parts: source.parts });

  // Guard rails: pure data + well-formed normalised result.
  const impure = findImpureData(data);
  if (impure.length) {
    throw new Error(`[maps] map "${requested}" produced non-plain data:\n - ${impure.slice(0, 10).join('\n - ')}`);
  }
  const validation = validateMapData(data);
  if (!validation.ok) {
    throw new Error(`[maps] map "${requested}" failed validation:\n - ${validation.errors.join('\n - ')}`);
  }
  return data;
}

/**
 * Validate a *normalised* map data object (the `loadMap()` output shape).
 * Returns `{ ok, errors }` instead of throwing so tooling can report every problem at once.
 *
 * @param {unknown} data
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateMapData(data) {
  const errors = [];
  if (!check(errors, isPlainObject(data), 'data: expected an object')) return { ok: false, errors };

  requireStrings(errors, data, 'data', ['id', 'name', 'format']);
  check(errors, typeof data.description === 'string', 'data.description: expected a string');
  check(errors, typeof data.subtitle === 'string', 'data.subtitle: expected a string');
  check(errors, MAP_FORMATS.includes(data.format), `data.format: unknown format ${JSON.stringify(data.format)}`);

  // ------------------------------------------------------------ world metadata
  const spawn = requireObject(errors, data.playerSpawn, 'data.playerSpawn');
  requireNumbers(errors, spawn, 'data.playerSpawn', ['x', 'y', 'z', 'yaw']);
  const bounds = requireObject(errors, data.mapBounds, 'data.mapBounds');
  requireNumbers(errors, bounds, 'data.mapBounds', ['minX', 'maxX', 'minZ', 'maxZ']);

  // ------------------------------------------------------------------ collision
  const boxes = requireArray(errors, data.collisionBoxes, 'data.collisionBoxes');
  boxes.forEach((box, i) => {
    const path = `data.collisionBoxes[${i}]`;
    if (!isPlainObject(box)) {
      errors.push(`${path}: expected an object`);
      return;
    }
    requireNumbers(errors, box, path, ['minX', 'maxX', 'minZ', 'maxZ', 'minY', 'maxY']);
    check(errors, typeof box.surface === 'string', `${path}.surface: expected a string`);
  });

  // --------------------------------------------------------------------- spawns
  const spawns = requireArray(errors, data.enemySpawns, 'data.enemySpawns');
  spawns.forEach((entry, i) => {
    const path = `data.enemySpawns[${i}]`;
    requireNumbers(errors, entry, path, ['x', 'y', 'z']);
    check(errors, typeof entry?.label === 'string', `${path}.label: expected a string`);
  });
  const landmarks = requireArray(errors, data.landmarks, 'data.landmarks');
  landmarks.forEach((entry, i) => {
    const path = `data.landmarks[${i}]`;
    requireNumbers(errors, entry, path, ['x', 'z']);
    check(errors, typeof entry?.name === 'string', `${path}.name: expected a string`);
  });
  const warnings = requireArray(errors, data.warnings, 'data.warnings');
  warnings.forEach((entry, i) => check(errors, typeof entry === 'string', `data.warnings[${i}]: expected a string`));

  // --------------------------------------------------------------------- layout
  if (data.style === 'island') {
    return validateIslandMapData(data, errors);
  }

  const layout = requireObject(errors, data.layout, 'data.layout');
  for (const key of v1.LAYOUT_ARRAY_KEYS) requireArray(errors, layout[key], `data.layout.${key}`);
  const hero = requireObject(errors, layout.hero, 'data.layout.hero');
  for (const key of v1.HERO_KEYS) {
    if (key === 'flagpoles') requireArray(errors, hero[key], 'data.layout.hero.flagpoles');
    else requireObject(errors, hero[key], `data.layout.hero.${key}`);
  }

  (layout.barrels ?? []).forEach((barrel, i) => requireNumbers(errors, barrel, `data.layout.barrels[${i}]`, ['x', 'z', 'yaw']));
  (layout.palms ?? []).forEach((palm, i) => requireNumbers(errors, palm, `data.layout.palms[${i}]`, ['x', 'z', 's', 'ry']));
  (layout.crates ?? []).forEach((crate, i) => requireNumbers(errors, crate, `data.layout.crates[${i}]`, ['x', 'z', 's', 'ry', 'stack']));
  (layout.looseCrates ?? []).forEach((crate, i) => requireNumbers(errors, crate, `data.layout.looseCrates[${i}]`, ['x', 'z', 'ry', 's']));
  (layout.stalls ?? []).forEach((stall, i) => requireNumbers(errors, stall, `data.layout.stalls[${i}]`, ['x', 'z', 'ry']));
  (layout.tireStacks ?? []).forEach((stack, i) => requireArray(errors, stack, `data.layout.tireStacks[${i}]`));
  (layout.sackPiles ?? []).forEach((pile, i) => requireArray(errors, pile, `data.layout.sackPiles[${i}]`));
  (layout.lampPosts ?? []).forEach((post, i) => requireArray(errors, post, `data.layout.lampPosts[${i}]`));
  (layout.sandbagRuns ?? []).forEach((run, i) => requireArray(errors, run, `data.layout.sandbagRuns[${i}]`));

  // -------------------------------------------------- builder-consumed JSON parts
  const terrain = requireObject(errors, data.terrain, 'data.terrain');
  requireObject(errors, terrain.ground, 'data.terrain.ground');
  requireObject(errors, terrain.paving, 'data.terrain.paving');
  requireObject(errors, terrain.dunes, 'data.terrain.dunes');
  requireObject(errors, terrain.mesas, 'data.terrain.mesas');
  requireObject(errors, terrain.skyline, 'data.terrain.skyline');
  requireObject(errors, terrain.haze, 'data.terrain.haze');
  requireColor(errors, terrain.haze?.color, 'data.terrain.haze.color');

  const environment = requireObject(errors, data.environment, 'data.environment');
  const sky = requireObject(errors, environment.sky, 'data.environment.sky');
  requireColor(errors, sky.sunColor, 'data.environment.sky.sunColor');
  check(errors, isFiniteNumber(environment.fog?.density), 'data.environment.fog.density: expected a number');
  requireColor(errors, environment.fog?.color, 'data.environment.fog.color');
  requireColor(errors, environment.background, 'data.environment.background');
  requireObject(errors, environment.lights, 'data.environment.lights');
  requireObject(errors, environment.lights?.sun, 'data.environment.lights.sun');
  requireColor(errors, environment.lights?.sun?.color, 'data.environment.lights.sun.color');

  const dressing = requireObject(errors, data.dressing, 'data.dressing');
  requireArray(errors, dressing.decals, 'data.dressing.decals');
  requireArray(errors, dressing.posters, 'data.dressing.posters');
  requireArray(errors, dressing.banners, 'data.dressing.banners');
  requireArray(errors, dressing.smoke, 'data.dressing.smoke');
  const site = requireObject(errors, dressing.site, 'data.dressing.site');
  requireArray(errors, site.lanterns, 'data.dressing.site.lanterns');
  requireArray(errors, site.lights, 'data.dressing.site.lights');
  requireArray(errors, site.decals, 'data.dressing.site.decals');
  for (const [i, light] of (site.lights ?? []).entries()) {
    requireColor(errors, light?.color, `data.dressing.site.lights[${i}].color`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * `sandstrike/map@2` (tropical island) validation.
 *
 * The island world has no walls/gates/hero props: it places the 25 island models plus a
 * few reused desert props, derives its colliders (see `formats/v2.js`) and swaps the
 * desert terrain for an island + ocean. Everything that still applies (bounds, spawn
 * safety, landmark placement, normalised environment) is checked by the shared part of
 * `validateMapData()`; this adds the island-specific shape checks.
 */
function validateIslandMapData(data, errors) {
  const layout = requireObject(errors, data.layout, 'data.layout');
  const island = requireObject(errors, layout.island, 'data.layout.island');
  for (const keys of Object.values(ISLAND_LAYOUT_KEYS)) {
    for (const key of keys) requireArray(errors, island[key], `data.layout.island.${key}`);
  }
  for (const key of ['crates', 'barrels', 'lowWalls', 'stalls']) requireArray(errors, layout[key], `data.layout.${key}`);
  requireObject(errors, layout.hero?.campfire, 'data.layout.hero.campfire');

  const terrain = requireObject(errors, data.terrain, 'data.terrain');
  const islandShape = requireObject(errors, terrain.island, 'data.terrain.island');
  const sea = requireObject(errors, terrain.sea, 'data.terrain.sea');
  for (const [object, path, fields] of [
    [islandShape, 'data.terrain.island', ['grassRadius', 'beachInner', 'landRadius']],
    [sea, 'data.terrain.sea', ['level', 'bedOuter', 'bedDrop']],
  ]) {
    for (const field of fields) check(errors, isFiniteNumber(object?.[field]), `${path}.${field}: expected a number`);
  }

  const environment = requireObject(errors, data.environment, 'data.environment');
  const sky = requireObject(errors, environment.sky, 'data.environment.sky');
  requireColor(errors, sky.sunColor, 'data.environment.sky.sunColor');
  check(errors, isFiniteNumber(environment.fog?.density), 'data.environment.fog.density: expected a number');
  requireColor(errors, environment.fog?.color, 'data.environment.fog.color');
  requireColor(errors, environment.background, 'data.environment.background');
  requireObject(errors, environment.lights, 'data.environment.lights');
  requireObject(errors, environment.lights?.sun, 'data.environment.lights.sun');
  requireColor(errors, environment.lights?.sun?.color, 'data.environment.lights.sun.color');

  // Every placement must still land near the island (jetties legitimately reach into the
  // water, so they get a larger radius allowance than the rest). The reef-ring collider is
  // gone; the playable edge is the wading guard from the shared shoreline profile
  // (`island-shore.js`), which is the only radius that has to contain the layout.
  if (isFiniteNumber(islandShape?.landRadius)) {
    const guardRadius = shoreProfile(terrain).guardRadius;
    for (const [group, keys] of Object.entries(ISLAND_LAYOUT_KEYS)) {
      for (const key of keys) {
        const allowance = key === 'jetties' ? guardRadius + 14 : group === 'shore' ? guardRadius + 8 : guardRadius + 6;
        for (const [index, item] of (island[key] ?? []).entries()) {
          if (!isPlainObject(item)) continue;
          const r = Math.hypot(item.x, item.z);
          if (r > allowance) {
            errors.push(`data.layout.island.${key}[${index}]: (${item.x}, ${item.z}) is outside the playable shore (r=${r.toFixed(1)}, allowance=${allowance.toFixed(1)})`);
          }
        }
      }
    }
  }

  check(errors, data.style === 'island', 'data.style: expected "island"');
  return { ok: errors.length === 0, errors };
}
