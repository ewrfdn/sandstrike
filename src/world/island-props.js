/**
 * SANDSTRIKE // tropical island prop assembly.
 *
 * The island map does not use the outpost builders (`buildArchitecture` / `buildProps` /
 * dressing): instead it instantiates the 25 island assets from `layout.island.*` and a
 * handful of reused desert props for the village set-dressing. Collision is already part
 * of `ctx.data.collisionBoxes` (derived by `formats/v2.js`), so nothing here registers
 * colliders — this pass is purely geometry.
 */
import { ISLAND_MODELS } from '../models/world/island/index.js';
import { buildWorld as buildCrates } from '../models/world/crate.js';
import { buildWorld as buildBarrels } from '../models/world/barrel.js';
import { buildWorld as buildLowWalls } from '../models/world/low-wall.js';
import { buildWorld as buildStalls } from '../models/world/stall.js';
import { buildWorld as buildCampfire } from '../models/world/campfire.js';

/** Reused outpost props that read the v1 layout keys the island adapter feeds them. */
const REUSED_PROPS = [
  ['crates', buildCrates],
  ['barrels', buildBarrels],
  ['lowWalls', buildLowWalls],
  ['stalls', buildStalls],
  ['campfire', buildCampfire],
];

/**
 * Build every static island prop.
 * @param {object} ctx world build context (see createWorld in src/world/index.js)
 */
export function buildIslandProps(ctx) {
  const layout = ctx.data?.layout ?? {};
  const island = layout.island ?? {};

  let models = 0;
  for (const entry of ISLAND_MODELS) {
    const builder = entry?.module?.buildWorld;
    if (typeof builder !== 'function') continue;
    try {
      builder(ctx);
      models++;
    } catch (error) {
      console.warn(`[world] island builder failed (${entry.module?.meta?.id ?? 'unknown'}):`, error);
    }
  }

  for (const [key, builder] of REUSED_PROPS) {
    const list = key === 'campfire' ? layout.hero?.campfire : layout[key];
    const hasItems = Array.isArray(list) && list.length > 0;
    if (!hasItems) continue;
    try {
      builder(ctx);
    } catch (error) {
      console.warn(`[world] reused prop builder failed (${key}):`, error);
    }
  }

  ctx.islandPropCount = Object.values(island).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  ctx.islandModelBuilders = models;
}

export default buildIslandProps;
