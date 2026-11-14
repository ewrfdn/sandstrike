/**
 * ISLAND STRUCTURE TEXTURES — aggregate stage (owner: texture-structure).
 *
 * Registers the tropical structure texture sets on the shared texture library `lib`
 * (see ISLAND_ASSETS.md §3.2). Every per-material module stays in its own file:
 *
 *   thatch.js          -> lib.thatch          { map, normalMap, roughnessMap }
 *   tropical-bark.js   -> lib.tropicalBark    { map, normalMap, roughnessMap }
 *   bamboo.js          -> lib.bamboo          { map, normalMap, roughnessMap }
 *   moss-stone.js      -> lib.mossStone       { map, normalMap, roughnessMap }
 *   woven-wall.js      -> lib.woven           { map, normalMap, roughnessMap }
 *
 * Texture direction conventions (models rely on these):
 *   thatch        V = straw down-slope (U repeats around the roof)
 *   bamboo        V = culm length, node rings across U (512x1024)
 *   tropicalBark  V = up the trunk
 *   mossStone     generic ashlar wall tile (1 tile = 2 m)
 *   woven         plain weave, weft along U, warp along V (1 tile = 1.5 m)
 *
 * `aniso` = anisotropy, `reg` = texture registration helper (dispose tracking).
 */
import { makeThatch } from './thatch.js';
import { makeTropicalBark } from './tropical-bark.js';
import { makeBamboo } from './bamboo.js';
import { makeMossStone } from './moss-stone.js';
import { makeWoven } from './woven-wall.js';

export function makeIslandStructureTextures(aniso, reg, lib) {
  lib.thatch = makeThatch(aniso, reg);
  lib.tropicalBark = makeTropicalBark(aniso, reg);
  lib.bamboo = makeBamboo(aniso, reg);
  lib.mossStone = makeMossStone(aniso, reg);
  lib.woven = makeWoven(aniso, reg);
}
