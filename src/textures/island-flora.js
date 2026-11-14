/**
 * ISLAND FLORA TEXTURES — aggregate stage (owner: texture-flora).
 *
 * Registers the tropical vegetation texture sets on the shared texture library `lib`
 * (see ISLAND_ASSETS.md §3.1). Every per-material module stays in its own file:
 *
 *   jungle-grass.js    -> lib.jungleGrass    { map, normalMap, roughnessMap }
 *   leaf-litter.js     -> lib.leafLitter     { map, normalMap, roughnessMap }
 *   broadleaf.js       -> lib.broadleaf      { map, normalMap }   alpha atlas (2x2)
 *   canopy.js          -> lib.canopy         { map, normalMap }   cluster atlas (2x2, 2nd pass)
 *   tropical-frond.js  -> lib.tropicalFrond  { map, normalMap, roughnessMap }
 *   beach-sand.js      -> lib.beachSand      { map, normalMap, roughnessMap }
 *
 * `aniso` = anisotropy, `reg` = texture registration helper (dispose tracking).
 * Materials consume these keys via src/world/materials.js (M.jungleGrass, ...).
 */
import { makeJungleGrass } from './jungle-grass.js';
import { makeLeafLitter } from './leaf-litter.js';
import { makeBroadleaf } from './broadleaf.js';
import { makeCanopy } from './canopy.js';
import { makeGrassBlade } from './grass-blade.js';
import { makeTropicalFrond } from './tropical-frond.js';
import { makeBeachSand } from './beach-sand.js';

export function makeIslandFloraTextures(aniso, reg, lib) {
  lib.jungleGrass = makeJungleGrass(aniso, reg);
  lib.leafLitter = makeLeafLitter(aniso, reg);
  lib.broadleaf = makeBroadleaf(aniso, reg);
  lib.canopy = makeCanopy(aniso, reg);
  lib.grassBlade = makeGrassBlade(aniso, reg);
  lib.tropicalFrond = makeTropicalFrond(aniso, reg);
  lib.beachSand = makeBeachSand(aniso, reg);
}
