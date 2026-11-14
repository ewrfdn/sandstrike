/**
 * SANDSTRIKE // map registry.
 *
 * One map = one folder under `src/config/maps/<id>/` containing a manifest (`map.json`)
 * plus composable JSON parts (terrain / environment / architecture / props / dressing /
 * spawns). This file statically imports every part so the game ships without a network
 * fetch, and exposes a registry keyed by map id.
 *
 * Loaded by `src/world/data/index.js`:
 *   loadMap(id)     -> normalised ctx.data (dispatches on manifest.format)
 *   listMaps()      -> manifest summary list
 *   DEFAULT_MAP_ID  -> fallback / `?map=` default
 *
 * To add a map:
 *   1. copy `outpost-07/` to `<new-id>/`, edit `map.json` (`id` must equal the folder name)
 *   2. import its parts below and add an entry to `MAP_SOURCES`
 *   3. optionally change `DEFAULT_MAP_ID`
 * A map can also be selected at runtime with `?map=<id>`; unknown ids fall back to the
 * default (the loader throws and the world layer catches + warns).
 *
 * NOTE: JSON modules are imported with `with { type: 'json' }` (ES2025 import attributes),
 * supported by the browser build (Chrome 123+), Node 20.10+ and esbuild (standalone HTML).
 */
import outpostMap from './outpost-07/map.json' with { type: 'json' };
import outpostTerrain from './outpost-07/terrain.json' with { type: 'json' };
import outpostEnvironment from './outpost-07/environment.json' with { type: 'json' };
import outpostArchitecture from './outpost-07/architecture.json' with { type: 'json' };
import outpostProps from './outpost-07/props.json' with { type: 'json' };
import outpostDressing from './outpost-07/dressing.json' with { type: 'json' };
import outpostSpawns from './outpost-07/spawns.json' with { type: 'json' };

import testRangeMap from './test-range/map.json' with { type: 'json' };
import testRangeTerrain from './test-range/terrain.json' with { type: 'json' };
import testRangeEnvironment from './test-range/environment.json' with { type: 'json' };
import testRangeArchitecture from './test-range/architecture.json' with { type: 'json' };
import testRangeProps from './test-range/props.json' with { type: 'json' };
import testRangeDressing from './test-range/dressing.json' with { type: 'json' };
import testRangeSpawns from './test-range/spawns.json' with { type: 'json' };

// Tropical island map (`sandstrike/map@2`) — see ISLAND_MAP_SPEC.md.
import islandMap from './island-01/map.json' with { type: 'json' };
import islandTerrain from './island-01/terrain.json' with { type: 'json' };
import islandEnvironment from './island-01/environment.json' with { type: 'json' };
import islandArchitecture from './island-01/architecture.json' with { type: 'json' };
import islandProps from './island-01/props.json' with { type: 'json' };
import islandDressing from './island-01/dressing.json' with { type: 'json' };
import islandSpawns from './island-01/spawns.json' with { type: 'json' };

/**
 * @typedef {object} MapSource
 * @property {object} manifest parsed `map.json`
 * @property {object} parts    parsed part JSON, keyed like `manifest.parts`
 */

/** @type {Readonly<Record<string, MapSource>>} */
export const MAP_SOURCES = Object.freeze({
  'outpost-07': Object.freeze({
    manifest: outpostMap,
    parts: Object.freeze({
      terrain: outpostTerrain,
      environment: outpostEnvironment,
      architecture: outpostArchitecture,
      props: outpostProps,
      dressing: outpostDressing,
      spawns: outpostSpawns,
    }),
  }),
  // Second map: demonstrates that one folder = one playable level. It reuses the same
  // builder modules/models but has its own composite JSON (terrain/env/layout/spawns).
  'test-range': Object.freeze({
    manifest: testRangeMap,
    parts: Object.freeze({
      terrain: testRangeTerrain,
      environment: testRangeEnvironment,
      architecture: testRangeArchitecture,
      props: testRangeProps,
      dressing: testRangeDressing,
      spawns: testRangeSpawns,
    }),
  }),
  // Tropical island campaign map: closed atoll, jungle + thatch village + ruins.
  'island-01': Object.freeze({
    manifest: islandMap,
    parts: Object.freeze({
      terrain: islandTerrain,
      environment: islandEnvironment,
      architecture: islandArchitecture,
      props: islandProps,
      dressing: islandDressing,
      spawns: islandSpawns,
    }),
  }),
});

/** Map used when no `?map=<id>` is given (or when the requested id is unknown). */
export const DEFAULT_MAP_ID = 'outpost-07';

export default MAP_SOURCES;
