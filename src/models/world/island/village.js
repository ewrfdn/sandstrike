/**
 * ISLAND VILLAGE — model bucket (owner: village). "草村" = thatch/stilt village.
 *
 * Delivered models (see ISLAND_ASSETS.md §2.2):
 *   V1 thatch-hut       茅草干栏屋  12k–18k tris
 *   V2 hut-ruin         破败茅屋    6k–10k tris
 *   V3 bamboo-fence     竹篱        2k–4k tris
 *   V4 drying-rack      晾晒架      1.5k–3.5k tris
 *   V5 village-walkway  村中栈道    3k–6k tris
 *   V6 spirit-totem     木雕图腾    2k–4k tris   (P1)
 *
 * Add one `import * as <name>` line per model file and one `{ module: <name> }` entry
 * to the array below when the file is delivered. No build code here.
 */
import * as thatchHut from './thatch-hut.js';
import * as hutRuin from './hut-ruin.js';
import * as bambooFence from './bamboo-fence.js';
import * as dryingRack from './drying-rack.js';
import * as villageWalkway from './village-walkway.js';
import * as spiritTotem from './spirit-totem.js';

export const ISLAND_VILLAGE_MODELS = [
  { module: thatchHut },
  { module: hutRuin },
  { module: bambooFence },
  { module: dryingRack },
  { module: villageWalkway },
  { module: spiritTotem },
];
