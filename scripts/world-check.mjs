#!/usr/bin/env node
/**
 * SANDSTRIKE // MAP / LEVEL DATA VALIDATION
 *
 * Walks `src/config/maps/*` (one folder per playable map, each a composite of JSON parts),
 * checks the on-disk wiring, then loads every registered map through the real data layer
 * (`src/world/data/index.js` -> `loadMap`) and validates the normalised result.
 *
 * Hard requirements (see `src/config/maps/README.md`):
 *   1. folder name == manifest id == registry id; format is known; every referenced part
 *      file exists (and every expected part is referenced);
 *   2. `MAP_SOURCES` (src/config/maps/index.js) and the folders on disk agree both ways;
 *   3. `loadMap(id)` succeeds, `validateMapData()` passes, `warnings` is empty;
 *   4. collisionBoxes > 0, no degenerate / non-finite boxes, nothing far outside bounds;
 *   5. enemySpawns >= that map's `resolve.minCount` (default 8), every spawn unblocked;
 *   6. playerSpawn inside bounds and not embedded in a collider;
 *   7. DEFAULT_MAP_ID is registered.
 *
 * This module is imported by `scripts/check.mjs` (so `npm run check` covers level data too)
 * and is runnable standalone: `node scripts/world-check.mjs` (`npm run check:maps`).
 *
 * KNOWN LIMITATION (not checkable from the data layer): a few site decorations in the
 * model builders are still hardcoded to outpost-07 absolute coordinates (boundary
 * crenellations, B-tunnel roof/lanterns/signs, pipeline run, loose staging props,
 * site banners). A map is only fully free of those when its bounds / placements keep them
 * outside the playable box, as `test-range` does (bounds +-21 m, gate/colonnade aligned
 * with the legacy hardcoded anchors). Moving them into JSON is the real multi-map fix.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SCRIPT_DIR);
const MAPS_ROOT = join(ROOT, 'src/config/maps');
const REQUIRED_PARTS = ['terrain', 'environment', 'architecture', 'props', 'dressing', 'spawns'];
const KNOWN_SURFACES = new Set(['adobe', 'stone', 'wood', 'metal', 'fabric']);

/** Collision boxes may legitimately poke this far outside `mapBounds` (boundary walls). */
const OUTSIDE_BOUNDS_MARGIN = 6;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Point-vs-collision-box test shared by player spawn / enemy spawn validation. */
function makePointBlocked(boxes, clearance) {
  return (x, z) => boxes.some((box) => (
    box.maxY - box.minY >= 0.35
    && x > box.minX - clearance && x < box.maxX + clearance
    && z > box.minZ - clearance && z < box.maxZ + clearance
  ));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/**
 * Island vegetation collision contract (`sandstrike/map@2`, derived by `formats/v2.js`).
 *
 * Rigid flora (jungle trees / coconut palms / bamboo clumps / fallen logs) must derive at
 * least one collider per placement, otherwise the player is back to walking through
 * trunks. Soft understory (bushes, banana leaves, ferns, grass, hanging vines) is
 * deliberately walk-through alpha-card foliage and must NOT emit colliders; canopy-sized
 * boxes are what `scripts/map-audit.mjs` reports as air walls. Boxes also have to stay
 * tight to the trunk: a wide box around the bole would be an invisible wall, so each
 * vegetation box may not be much larger than the model's solid core at s = 1.
 */
const ISLAND_RIGID_VEGETATION = Object.freeze(['jungleTrees', 'coconutPalms', 'bambooClumps', 'fallenLogs']);
const ISLAND_SOFT_VEGETATION = Object.freeze(['bananaPlants', 'bushes', 'fernClumps', 'grassTufts', 'vineDrapes']);
/** Largest allowed horizontal box extent (metres) per rigid kind, before `s` scaling. */
const ISLAND_VEGETATION_MAX_BOX = Object.freeze({
  jungleTrees: 1.8,
  coconutPalms: 2.2,
  bambooClumps: 2.3,
  fallenLogs: 3.6,
});

function checkIslandVegetationColliders(label, data, boxes, fail, pass) {
  const island = isPlainObject(data.layout?.island) ? data.layout.island : {};
  const byKind = {};
  for (const box of boxes) {
    if (!box || typeof box.kind !== 'string') continue;
    (byKind[box.kind] ??= []).push(box);
  }

  const missing = [];
  const oversized = [];
  for (const key of ISLAND_RIGID_VEGETATION) {
    const placements = Array.isArray(island[key]) ? island[key] : [];
    const derived = byKind[key] ?? [];
    if (placements.length > 0 && derived.length < placements.length) {
      missing.push(`${key}: ${placements.length} placement(s), ${derived.length} collider(s)`);
    }
    const maxWidth = ISLAND_VEGETATION_MAX_BOX[key] ?? 3.6;
    for (const hot of derived) {
      const widest = Math.max(hot.maxX - hot.minX, hot.maxZ - hot.minZ);
      if (!(widest <= maxWidth * 1.6)) oversized.push(`${key}: ${widest.toFixed(2)} m wide at (${hot.minX}, ${hot.minZ})`);
    }
  }
  const softBoxes = [];
  for (const key of ISLAND_SOFT_VEGETATION) {
    const count = (byKind[key] ?? []).length;
    if (count > 0) softBoxes.push(`${key}: ${count}`);
  }

  if (missing.length) fail(`${label}: island rigid vegetation missing colliders (${missing.join('; ')})`);
  if (oversized.length) fail(`${label}: island vegetation collider too wide for its trunk (${oversized.slice(0, 4).join('; ')})`);
  if (softBoxes.length) fail(`${label}: island soft vegetation must stay walk-through, got colliders (${softBoxes.join('; ')})`);
  if (!missing.length && !oversized.length && !softBoxes.length) {
    const rigid = ISLAND_RIGID_VEGETATION.reduce((sum, key) => sum + (byKind[key] ?? []).length, 0);
    pass(`${label}: island vegetation colliders ${rigid} (rigid flora blocked, soft understory walk-through)`);
  }
}

/**
 * Run every map check.
 * @param {{ log?: Function, error?: Function, quiet?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, failures: number, warnings: number, maps: object[] }>}
 */
export async function checkMaps({ log = console.log, error = console.error, quiet = false } = {}) {
  const emit = (...args) => { if (!quiet) log(...args); };
  const problems = [];
  const warn = (message) => { problems.push({ level: 'warn', message }); emit(`⚠ ${message}`); };
  const fail = (message) => { problems.push({ level: 'fail', message }); error(`✗ ${message}`); };
  const pass = (message) => emit(`✓ ${message}`);

  // ------------------------------------------------------------ data layer import
  let loadMap;
  let listMaps;
  let validateMapData;
  let DEFAULT_MAP_ID;
  let knownFormats;
  let MAP_SOURCES;
  try {
    const dataLayer = await import(pathToFileURL(join(ROOT, 'src/world/data/index.js')).href);
    ({ loadMap, listMaps, validateMapData, DEFAULT_MAP_ID } = dataLayer);
    knownFormats = dataLayer.MAP_FORMATS ?? [dataLayer.MAP_FORMAT];
    if (typeof loadMap !== 'function' || typeof listMaps !== 'function' || typeof validateMapData !== 'function') {
      throw new Error('src/world/data/index.js must export loadMap, listMaps and validateMapData');
    }
    const registry = await import(pathToFileURL(join(ROOT, 'src/config/maps/index.js')).href);
    MAP_SOURCES = registry.MAP_SOURCES;
    if (!isPlainObject(MAP_SOURCES)) throw new Error('src/config/maps/index.js must export MAP_SOURCES');
    pass('data layer + map registry imported');
  } catch (cause) {
    fail(`cannot import map data layer / registry: ${cause && cause.message ? cause.message : cause}`);
    return { ok: false, failures: problems.filter((p) => p.level === 'fail').length, warnings: 0, maps: [] };
  }

  // ------------------------------------------------------- folders on disk
  let entries = [];
  try {
    entries = await readdir(MAPS_ROOT, { withFileTypes: true });
  } catch (cause) {
    fail(`cannot read ${MAPS_ROOT}: ${cause.message}`);
  }
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (folders.length === 0) fail('no map folders found under src/config/maps/');
  else pass(`map folders on disk: ${folders.join(', ')}`);

  // --------------------------------------------- registry <-> disk both ways
  const registered = Object.keys(MAP_SOURCES).sort();
  for (const folder of folders) {
    if (!(folder in MAP_SOURCES)) fail(`map folder "${folder}" exists on disk but is NOT registered in src/config/maps/index.js`);
  }
  for (const id of registered) {
    if (!folders.includes(id)) fail(`registry entry "${id}" has no folder src/config/maps/${id}/`);
  }
  if (!(DEFAULT_MAP_ID in MAP_SOURCES)) fail(`DEFAULT_MAP_ID "${DEFAULT_MAP_ID}" is not registered`);
  else pass(`registry entries: ${registered.join(', ')} (DEFAULT_MAP_ID=${DEFAULT_MAP_ID})`);

  const listed = listMaps().map((map) => map.id).sort();
  if (JSON.stringify(listed) !== JSON.stringify(registered)) {
    fail(`listMaps() [${listed.join(', ')}] does not match registry [${registered.join(', ')}]`);
  } else {
    pass('listMaps() matches the registry');
  }

  // -------------------------------------------------------------- per-folder wiring
  const maps = [];
  for (const folder of folders) {
    const dir = join(MAPS_ROOT, folder);
    const manifestPath = join(dir, 'map.json');
    if (!existsSync(manifestPath)) { fail(`map folder "${folder}" has no map.json`); continue; }
    let manifest;
    try {
      manifest = await readJson(manifestPath);
    } catch (cause) {
      fail(`map "${folder}": map.json is not valid JSON (${cause.message})`);
      continue;
    }
    if (manifest.id !== folder) fail(`map "${folder}": map.json id ${JSON.stringify(manifest.id)} must equal the folder name`);
    if (!knownFormats.includes(manifest.format)) {
      fail(`map "${folder}": unknown format ${JSON.stringify(manifest.format)} (known: ${knownFormats.join(', ')})`);
    }

    const refs = isPlainObject(manifest.parts) ? manifest.parts : null;
    if (!refs) {
      fail(`map "${folder}": map.json has no "parts" object`);
    } else {
      for (const part of REQUIRED_PARTS) {
        if (!refs[part]) { fail(`map "${folder}": parts.${part} is not declared in map.json`); continue; }
        const partPath = join(dir, refs[part]);
        const info = await stat(partPath).catch(() => null);
        if (!info) { fail(`map "${folder}": declared part "${part}" file is missing (${refs[part]})`); continue; }
        try {
          await readJson(partPath);
        } catch (cause) {
          fail(`map "${folder}": part "${part}" is not valid JSON (${cause.message})`);
        }
      }
      for (const key of Object.keys(refs)) {
        if (!REQUIRED_PARTS.includes(key)) warn(`map "${folder}": unknown part key "${key}" in map.json`);
      }
    }

    // unexpected loose JSON files at the map root (typos / leftovers)
    const loose = (await readdir(dir)).filter((name) => name.endsWith('.json') && !Object.values(refs ?? {}).includes(name) && name !== 'map.json');
    if (loose.length) warn(`map "${folder}": unreferenced JSON file(s): ${loose.join(', ')}`);

    // consistency between registry entry and manifest
    const source = MAP_SOURCES[folder];
    if (source) {
      if (source.manifest?.id !== manifest.id) fail(`map "${folder}": registry manifest id ${JSON.stringify(source.manifest?.id)} != map.json id`);
      const sourceParts = Object.keys(source.parts ?? {}).sort();
      if (JSON.stringify(sourceParts) !== JSON.stringify([...REQUIRED_PARTS].sort())) {
        fail(`map "${folder}": registry parts [${sourceParts.join(', ')}] must be [${[...REQUIRED_PARTS].sort().join(', ')}]`);
      }
    }
    maps.push({ folder, manifest, dir });
  }
  if (maps.length) pass('map folder wiring (id / format / parts files / registry) checked');

  // -------------------------------------------------------- load + validate each map
  for (const id of registered) {
    const source = MAP_SOURCES[id];
    let data;
    try {
      data = loadMap(id);
    } catch (cause) {
      fail(`loadMap("${id}") threw: ${cause && cause.message ? cause.message : cause}`);
      continue;
    }
    const label = `map "${id}"`;
    const mapErrorsStart = problems.length;

    if (data.id !== id) fail(`${label}: loadMap returned id ${JSON.stringify(data.id)}`);
    if (!knownFormats.includes(data.format)) fail(`${label}: normalised format ${JSON.stringify(data.format)} is not known`);
    if (!isPlainObject(data.layout)) fail(`${label}: normalised data has no layout object`);

    const validation = validateMapData(data);
    if (!validation.ok) {
      for (const message of validation.errors.slice(0, 12)) fail(`${label}: validateMapData: ${message}`);
    }

    // warnings are a hard contract: a shipped map must not resolve with warnings
    if (!Array.isArray(data.warnings)) fail(`${label}: warnings is not an array`);
    else if (data.warnings.length) fail(`${label}: warnings must be empty, got ${JSON.stringify(data.warnings)}`);

    // ------------------------------------------------------------ collision boxes
    const boxes = data.collisionBoxes;
    if (!Array.isArray(boxes) || boxes.length === 0) {
      fail(`${label}: collisionBoxes must be a non-empty array`);
    } else {
      let degenerate = 0;
      let nonFinite = 0;
      let badSurface = 0;
      for (const box of boxes) {
        for (const key of ['minX', 'maxX', 'minZ', 'maxZ', 'minY', 'maxY']) {
          if (!isFiniteNumber(box?.[key])) nonFinite++;
        }
        if (!(box?.maxX > box?.minX && box?.maxZ > box?.minZ && box?.maxY > box?.minY)) degenerate++;
        if (typeof box?.surface !== 'string' || !box.surface) badSurface++;
      }
      if (nonFinite) fail(`${label}: ${nonFinite} non-finite collision box value(s)`);
      if (degenerate) fail(`${label}: ${degenerate} degenerate collision box(es)`);
      if (badSurface) fail(`${label}: ${badSurface} collision box(es) without a surface string`);
      if (!nonFinite && !degenerate && !badSurface) pass(`${label}: collisionBoxes ${boxes.length}, all healthy`);

      // ------------------------------------------------- island vegetation colliders
      // island maps derive vegetation collision from the placement JSON (formats/v2.js).
      // Rigid flora must block movement again, while soft alpha-card understory is meant
      // to stay walk-through; a handful of re-proportioned models should not be able to
      // silently bring back "walk through every tree".
      if (data.style === 'island') {
        checkIslandVegetationColliders(label, data, boxes, fail, pass);
      }
    }

    // ---------------------------------------------------------------- bounds
    const bounds = data.mapBounds;
    const boundsOk = isPlainObject(bounds)
      && ['minX', 'maxX', 'minZ', 'maxZ'].every((key) => isFiniteNumber(bounds[key]))
      && bounds.maxX > bounds.minX && bounds.maxZ > bounds.minZ;
    if (!boundsOk) {
      fail(`${label}: mapBounds is not a sane finite rectangle`);
    } else {
      const width = bounds.maxX - bounds.minX;
      const depth = bounds.maxZ - bounds.minZ;
      if (width < 10 || depth < 10) fail(`${label}: mapBounds too small (${width}x${depth} m)`);
      else if (width > 400 || depth > 400) fail(`${label}: mapBounds unreasonably large (${width}x${depth} m)`);
      else pass(`${label}: bounds ${width}x${depth} m`);
      const farOutside = (boxes ?? []).filter((box) => (
        box.maxX < bounds.minX - OUTSIDE_BOUNDS_MARGIN || box.minX > bounds.maxX + OUTSIDE_BOUNDS_MARGIN
        || box.maxZ < bounds.minZ - OUTSIDE_BOUNDS_MARGIN || box.minZ > bounds.maxZ + OUTSIDE_BOUNDS_MARGIN
      ));
      if (farOutside.length) fail(`${label}: ${farOutside.length} collision box(es) far outside mapBounds`);
    }

    const resolveConfig = isPlainObject(source?.parts?.spawns?.resolve) ? source.parts.spawns.resolve : {};
    const playerClearance = resolveConfig.playerClearance ?? 0.9;
    const validateClearance = resolveConfig.validateClearance ?? 1.1;
    const minCount = resolveConfig.minCount ?? 8;

    // --------------------------------------------------------------- player spawn
    const spawn = data.playerSpawn;
    const spawnOk = isPlainObject(spawn) && isFiniteNumber(spawn.x) && isFiniteNumber(spawn.z);
    if (!spawnOk) {
      fail(`${label}: playerSpawn is missing finite x/z`);
    } else if (boundsOk && (spawn.x < bounds.minX || spawn.x > bounds.maxX || spawn.z < bounds.minZ || spawn.z > bounds.maxZ)) {
      fail(`${label}: playerSpawn (${spawn.x}, ${spawn.z}) is outside mapBounds`);
    } else if (Array.isArray(boxes) && makePointBlocked(boxes, playerClearance)(spawn.x, spawn.z)) {
      fail(`${label}: playerSpawn (${spawn.x}, ${spawn.z}) is embedded in a collider`);
    } else {
      pass(`${label}: playerSpawn (${spawn.x}, ${spawn.z}) clear`);
    }

    // --------------------------------------------------------------- enemy spawns
    const spawns = data.enemySpawns;
    if (!Array.isArray(spawns)) {
      fail(`${label}: enemySpawns is not an array`);
    } else {
      if (spawns.length < minCount) {
        fail(`${label}: enemySpawns ${spawns.length} < minCount ${minCount} (resolve.minCount)`);
      }
      let badSpawn = 0;
      for (const entry of spawns) {
        if (!isFiniteNumber(entry?.x) || !isFiniteNumber(entry?.z)) { badSpawn++; continue; }
        if (boundsOk && (entry.x < bounds.minX || entry.x > bounds.maxX || entry.z < bounds.minZ || entry.z > bounds.maxZ)) {
          fail(`${label}: enemy spawn "${entry.label}" outside mapBounds`);
        }
        if (Array.isArray(boxes) && makePointBlocked(boxes, validateClearance)(entry.x, entry.z)) {
          fail(`${label}: enemy spawn "${entry.label}" at (${entry.x}, ${entry.z}) is blocked`);
        }
      }
      if (badSpawn) fail(`${label}: ${badSpawn} enemy spawn(s) missing finite x/z`);
      if (spawns.length >= minCount && !badSpawn) pass(`${label}: enemySpawns ${spawns.length} (>= minCount ${minCount}), all clear`);
    }

    // -------------------------------------------------------------- landmarks
    const landmarks = data.landmarks;
    if (!Array.isArray(landmarks)) fail(`${label}: landmarks is not an array`);
    else if (boundsOk) {
      const outside = landmarks.filter((entry) => (
        !isFiniteNumber(entry?.x) || !isFiniteNumber(entry?.z)
        || entry.x < bounds.minX || entry.x > bounds.maxX || entry.z < bounds.minZ || entry.z > bounds.maxZ
      ));
      if (outside.length) fail(`${label}: ${outside.length} landmark(s) outside mapBounds: ${outside.map((entry) => entry.name).join(', ')}`);
    }

    if (problems.length === mapErrorsStart) pass(`${label}: fully valid`);
  }

  // ------------------------------------------------------------------ summary
  const failures = problems.filter((point) => point.level === 'fail').length;
  const warnings = problems.filter((point) => point.level === 'warn').length;
  if (!quiet) {
    emit('');
    if (failures) error(`Map checks: ${failures} failure(s), ${warnings} warning(s).`);
    else log(`Map checks: OK (${registered.length} map(s)${warnings ? `, ${warnings} warning(s)` : ''}).`);
  }
  return { ok: failures === 0, failures, warnings, maps: registered };
}

// ------------------------------------------------------------------- CLI entry
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const result = await checkMaps();
  process.exit(result.ok ? 0 : 1);
}
