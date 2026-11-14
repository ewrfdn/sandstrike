/**
 * SANDSTRIKE // sandstorm protocol — props & hero set pieces assembly.
 *
 * Split verbatim out of src/world.js (buildInstancedProps / buildLooseProps /
 * buildProps). Each prop family is its own model module under src/models/world/
 * and reads its placement from `ctx.data.layout`; the loose lumber/scrap visuals
 * in buildLooseProps are procedural dressing that mirrors fixed map solids, so
 * they stay hard-coded here exactly as before.
 */
import { boxBatch, rodBetween } from '../models/core.js';
import { buildWorld as buildCrateFamily } from '../models/world/crate.js';
import { buildWorld as buildBarrelFamily } from '../models/world/barrel.js';
import { buildWorld as buildSandbagFamily } from '../models/world/sandbag.js';
import { buildWorld as buildPalmFamily } from '../models/world/palm.js';
import { buildWorld as buildRubbleFamily } from '../models/world/rubble.js';
import { buildWorld as buildTireFamily } from '../models/world/tires.js';
import { buildWorld as buildSackFamily } from '../models/world/sacks.js';
import { buildWorld as buildLampPosts } from '../models/world/lamp-post.js';
import { buildWorld as buildFlagpoles } from '../models/world/flagpole.js';
import { buildWorld as buildALongShade } from '../models/world/a-long-shade.js';
import { buildWorld as buildWell } from '../models/world/well.js';
import { buildWorld as buildTruck } from '../models/world/truck.js';
import { buildWorld as buildStalls } from '../models/world/stall.js';
import { buildWorld as buildWindmill } from '../models/world/windmill.js';
import { buildWorld as buildRadar } from '../models/world/radar.js';
import { buildWorld as buildCarts } from '../models/world/cart.js';
import { buildWorld as buildCampfire } from '../models/world/campfire.js';
import { buildWorld as buildAPlatform } from '../models/world/a-platform.js';
import { buildWorld as buildBWreck } from '../models/world/b-wreck.js';
import { buildWorld as buildPipeline } from '../models/world/pipeline.js';

function buildInstancedProps(ctx) {
  // Each clutter family is its own model module; the call order below is part of the
  // visual contract (identical registration order to the original monolithic builder).
  buildCrateFamily(ctx);    // also publishes ctx.instanced.crates
  buildBarrelFamily(ctx);
  buildSandbagFamily(ctx);
  buildPalmFamily(ctx);
  buildRubbleFamily(ctx);
  buildTireFamily(ctx);
  buildSackFamily(ctx);
}

/**
 * Loose dressing that previously only existed as bare collision boxes: the two
 * staging lumber stacks and the two site scrap heaps. Each matches its solid.
 */
function buildLooseProps(ctx) {
  // staging lumber / plank stacks (solids: 1.1×0.7×0.8 and 1.2×0.7×0.75 wood)
  for (const [x, z, w, d, h] of [[-19.5, 30.8, 1.1, 0.7, 0.8], [19.6, 30.6, 1.2, 0.7, 0.75]]) {
    const rows = 4;
    for (let i = 0; i < rows; i++) {
      boxBatch(ctx, 'wood', x + (i % 2 ? 0.03 : -0.02), (i + 0.5) * (h / rows), z, w - 0.02, (h / rows) * 0.86, d, { tile: 1.2, ry: i % 2 ? 0.05 : -0.04 });
    }
    boxBatch(ctx, 'woodDark', x, h + 0.03, z, w * 0.5, 0.06, d * 0.9, { tile: 1.0 });
  }
  // site scrap heaps (solids: 1.0×1.0×0.7 metal at both bomb sites)
  for (const [x, z] of [[-15.2, -24.8], [15.4, -24.6]]) {
    boxBatch(ctx, 'rust', x, 0.12, z, 0.94, 0.24, 0.7, { tile: 1.2 });
    boxBatch(ctx, 'rust', x - 0.03, 0.33, z + 0.04, 0.82, 0.18, 0.6, { tile: 1.2, ry: 0.18 });
    boxBatch(ctx, 'rust', x + 0.05, 0.5, z - 0.03, 0.66, 0.16, 0.5, { tile: 1.2, ry: -0.24 });
    boxBatch(ctx, 'metalDark', x, 0.64, z, 0.5, 0.14, 0.4, { tile: 1.2, ry: 0.4 });
    rodBetween(ctx, 'metalDark', x + 0.32, 0.05, z + 0.3, x + 0.05, 0.95, z + 0.02, 0.035, 5);
  }
}

function buildProps(ctx) {
  buildInstancedProps(ctx);
  buildLampPosts(ctx);
  buildFlagpoles(ctx);
  buildALongShade(ctx);
  buildLooseProps(ctx);
  buildWell(ctx);
  buildTruck(ctx);
  buildStalls(ctx);
  buildWindmill(ctx);
  buildRadar(ctx);
  buildCarts(ctx);
  buildCampfire(ctx);
  buildAPlatform(ctx);
  buildBWreck(ctx);
  buildPipeline(ctx);
}

export { buildInstancedProps, buildLooseProps, buildProps };
export default buildProps;
