/**
 * Loot (dropped-item / pickup) model barrel: one module per pickup kind.
 *
 * Every kind module exports `meta`, `createGeometries()`, `buildItem()` and
 * `build()`; this barrel assembles the viewer catalog list plus the flat
 * geometry map that gameplay (src/enemies.js) owns and disposes.
 */
import * as ammo from './ammo.js';
import * as health from './health.js';
import * as mag from './mag.js';
import * as power from './power.js';
import * as reload from './reload.js';
import * as relic from './relic.js';
import * as guard from './guard.js';
import * as vital from './vital.js';

export { createLootMaterials, getLootMaterials, disposeLootMaterials } from './shared.js';

/** Model-viewer catalog list (src/models/index.js spreads the metas into MODEL_CATALOG). */
export const LOOT_MODELS = [ammo, health, mag, power, reload, relic, guard, vital];

/** Lookup of kind id -> module, for gameplay / tooling. */
export const LOOT_KIND_MODULES = { ammo, health, mag, power, reload, relic, guard, vital };

export const LOOT_KINDS = Object.keys(LOOT_KIND_MODULES);

/**
 * Fresh flat `{ key: geometry }` map of every loot geometry (the caller owns
 * and disposes the returned geometries; a new map is built on every call).
 */
export function createLootGeometries() {
  const geos = {};
  for (let i = 0; i < LOOT_MODELS.length; i++) Object.assign(geos, LOOT_MODELS[i].createGeometries());
  return geos;
}
