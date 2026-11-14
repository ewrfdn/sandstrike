/**
 * ISLAND FLORA / CANOPY — model bucket (owner: flora-canopy).
 *
 * Delivered models (see ISLAND_ASSETS.md §2.1):
 *   F1 jungle-tree    巨冠乔木  12k–16k tris
 *   F2 coconut-palm   椰子树     6k–9k tris
 *   F7 vine-drape     藤蔓垂帘   1.2k–2.5k tris
 *
 * Add one `import * as <name>` line per model file and one `{ module: <name> }` entry
 * to the array below when the file is delivered. Do not put build code here: every
 * model stays in its own `./<id>.js` file.
 */
import * as jungleTree from './jungle-tree.js';
import * as coconutPalm from './coconut-palm.js';
import * as vineDrape from './vine-drape.js';

export const ISLAND_FLORA_CANOPY_MODELS = [
  { module: jungleTree },
  { module: coconutPalm },
  { module: vineDrape },
];
