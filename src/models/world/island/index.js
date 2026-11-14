/**
 * ISLAND MODEL BARREL — tropical island assets (one map, one asset family).
 *
 * The island map (closed water-ringed island + thatch village + overgrown ruins) adds a
 * new set of world models under `src/models/world/island/`. They follow exactly the same
 * contract as the outpost models (`meta` / `build(ctx)` / `buildWorld(ctx)`), so the dev
 * model viewer and `scripts/model-shots.mjs` pick them up automatically.
 *
 * Each family bucket below is owned by ONE author (see ISLAND_ASSETS.md §9) so parallel
 * work never edits the same file; this file only concatenates them, keeping the tropical
 * entries after every legacy entry (stable catalog indices).
 */
import { ISLAND_FLORA_CANOPY_MODELS } from './flora-canopy.js';
import { ISLAND_FLORA_UNDERSTORY_MODELS } from './flora-understory.js';
import { ISLAND_VILLAGE_MODELS } from './village.js';
import { ISLAND_RUINS_MODELS } from './ruins.js';
import { ISLAND_SHORE_MODELS } from './shore.js';

export const ISLAND_MODELS = [
  ...ISLAND_FLORA_CANOPY_MODELS,
  ...ISLAND_FLORA_UNDERSTORY_MODELS,
  ...ISLAND_VILLAGE_MODELS,
  ...ISLAND_RUINS_MODELS,
  ...ISLAND_SHORE_MODELS,
];

export default ISLAND_MODELS;
