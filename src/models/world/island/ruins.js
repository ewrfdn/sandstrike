/**
 * ISLAND RUINS — model bucket (owner: ruins).
 *
 * Delivered models (see ISLAND_ASSETS.md §2.3):
 *   R1 ruin-wall     遗迹残墙    4k–8k tris
 *   R2 ruin-arch     遗迹拱门    5k–9k tris
 *   R3 ruin-tower    崩塌石塔    10k–16k tris
 *   R4 ruin-idol     断裂石像    2.5k–5k tris
 *   R5 ruin-column   断裂石柱    2k–4k tris   (P1)
 *
 * Add one `import * as <name>` line per model file and one `{ module: <name> }` entry
 * to the array below when the file is delivered. No build code here.
 */
import * as ruinWall from './ruin-wall.js';
import * as ruinArch from './ruin-arch.js';
import * as ruinTower from './ruin-tower.js';
import * as ruinIdol from './ruin-idol.js';
import * as ruinColumn from './ruin-column.js';

export const ISLAND_RUINS_MODELS = [
  { module: ruinWall },
  { module: ruinArch },
  { module: ruinTower },
  { module: ruinIdol },
  { module: ruinColumn },
];
