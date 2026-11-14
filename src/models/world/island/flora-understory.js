/**
 * ISLAND FLORA / UNDERSTORY — model bucket (owner: flora-understory).
 *
 * Delivered models (see ISLAND_ASSETS.md §2.1):
 *   F3  banana-plant     芭蕉丛     2.5k–4.5k tris
 *   F4  fern-clump       蕨类丛     1.5k–3k tris
 *   F5  bamboo-clump     竹丛       3k–6k tris
 *   F6  broadleaf-bush   阔叶灌木   1.5k–3k tris
 *   F8  fallen-log       倒木       2.5k–5k tris
 *   F9  grass-tuft       雨林草簇   1k–1.8k tris   (P1)
 *
 * Add one `import * as <name>` line per model file and one `{ module: <name> }` entry
 * to the array below when the file is delivered. No build code here.
 */
import * as bananaPlant from './banana-plant.js';
import * as fernClump from './fern-clump.js';
import * as bambooClump from './bamboo-clump.js';
import * as broadleafBush from './broadleaf-bush.js';
import * as fallenLog from './fallen-log.js';
import * as grassTuft from './grass-tuft.js';

export const ISLAND_FLORA_UNDERSTORY_MODELS = [
  { module: bananaPlant },
  { module: fernClump },
  { module: bambooClump },
  { module: broadleafBush },
  { module: fallenLog },
  { module: grassTuft },
];
