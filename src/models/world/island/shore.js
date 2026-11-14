/**
 * ISLAND SHORE — model bucket (owner: shore).
 *
 * Delivered models (see ISLAND_ASSETS.md §2.4):
 *   S1 shore-rocks    岸礁石群  3k–7k tris
 *   S2 jetty          木栈桥    5k–9k tris
 *   S3 dugout-canoe   独木舟    2k–4k tris
 *   S4 driftwood      浮木      1.2k–2.5k tris   (P1)
 *   S5 wreck-boat     沉船残骸  5k–9k tris       (P1)
 *
 * Add one `import * as <name>` line per model file and one `{ module: <name> }` entry
 * to the array below when the file is delivered. No build code here.
 */
import * as shoreRocks from './shore-rocks.js';
import * as jetty from './jetty.js';
import * as dugoutCanoe from './dugout-canoe.js';
import * as driftwood from './driftwood.js';
import * as wreckBoat from './wreck-boat.js';

export const ISLAND_SHORE_MODELS = [
  { module: shoreRocks },
  { module: jetty },
  { module: dugoutCanoe },
  { module: driftwood },
  { module: wreckBoat },
];
