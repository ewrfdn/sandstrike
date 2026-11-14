/**
 * JUNGLE TREE — F1 (see ISLAND_ASSETS.md §2.1).
 *
 * The 14 m emergent giant of the island canopy, rebuilt on the procedural tree kit
 * (`./tree/*`): a curved fluted bole braced by buttress plates, five arching limbs that
 * split into second-order limbs and twig tufts, a two-storey leaf canopy plus a
 * shell-filled crown silhouette, low drooping shade fans, hanging lianas / vines,
 * epiphyte fern copses and a litter ring — the same design as the shipped hand-authored
 * tree, but generated from a seed so the 63 map trees become 4 distinct variants.
 *
 * Rendering contract (per variant, 2 draw calls):
 *   wood  -> M.barkTrop (vertexColors: baked AO + moss tint), 1 InstancedMesh
 *   leaves-> M.vegLeaf  (vertexColors r=AO g=flex b=hue, atlas lib.canopy), 1 InstancedMesh
 * `makeInstanced` attaches the wind-synced customDepthMaterial to the leaf mesh.
 *
 * Quality tiers (map build): ultra/high = 4 variants, medium = 3, low = 2, lowest = 1
 * (variant 0, ~800 cards, leaf shadows off). Card density scales per tier.
 *
 * Stage build: one hero instance of variant 0 at full density, 12k-16k triangles.
 *
 * Rules honoured here: metres, +Y up, base on y=0 within ±0.05, the trunk's near-ground
 * radius stays under 0.66 m (collision box 1.32 x 1.32 is fixed map data), every random
 * decision comes from a per-variant seeded makeRNG().
 */
import { makeInstanced } from '../../core.js';
import { clamp } from '../../../utils.js';
import { isPreview } from '../detail.js';
import { TREE_VARIANTS } from './tree/variants.js';
import { buildTreeVariant } from './tree/build-variant.js';

export const meta = { id: 'jungle-tree', kind: 'world', group: 'flora', label: '雨林巨树 · JUNGLE TREE' };

/** Variants built per quality tier (draw calls = 2 per variant). */
const VARIANT_COUNT = { ultra: 4, high: 4, medium: 3, low: 2, lowest: 1 };

/**
 * Card-count multiplier per tier. Variant 0's full-density stage build is the
 * reference (≈4,300 cards): 0.63 => ≈2,700 cards, the map LOD asked for in
 * ISLAND_ASSETS §2.1 / gt-techniques §3.8.
 */
const CARD_SCALE = { ultra: 0.63, high: 0.63, medium: 0.42, low: 0.28, lowest: 0.19 };

/** Preview builder (stage/WebUI): one hero instance, full density, variant 0 only. */
export function build(ctx) {
  // ry 0 on purpose: the stage reports the axis-aligned extent of the instance, and a
  // rotated tree would report a crown ~30% wider than it actually is.
  island(ctx).jungleTrees = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildJungleTrees(ctx, true);
}

/** Map assembly builder: instances every tree from ctx.data.layout. */
export function buildWorld(ctx) {
  buildJungleTrees(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildJungleTrees(ctx, preview) {
  const items = (island(ctx).jungleTrees || []).map((t) => ({
    x: t.x,
    z: t.z,
    y: t.y ?? 0,
    // the collision footprint is authored around 0.85-1.15 scale; never exceed it
    ry: t.ry ?? 0,
    s: clamp(t.s ?? 1, 0.85, 1.15),
  }));
  if (!items.length) return;

  const M = ctx.materials;
  if (preview || isPreview(ctx)) {
    // stage hero: one variant, full density, two buckets
    const { wood, leaves } = buildTreeVariant(TREE_VARIANTS[0], { lod: 'stage', density: 1 });
    // Lead may expose an island-tuned, lighter bark material (`M.barkTropLight`);
    // fall back to the shared one so the model builds either way.
    const barkMat = M.barkTropLight || M.barkTrop;
    makeInstanced(ctx, wood, barkMat, items, 'jungle-tree-bark', 'wood', { seed: 73, castShadow: true });
    makeInstanced(ctx, leaves, M.vegLeaf, items, 'jungle-tree-leaves', 'fabric', { seed: 71, castShadow: true });
    return;
  }

  const quality = ctx.quality || 'high';
  const count = Math.min(VARIANT_COUNT[quality] ?? 4, TREE_VARIANTS.length);
  const density = CARD_SCALE[quality] ?? CARD_SCALE.high;
  // leaf shadows are the cheapest thing to drop on the lowest tier (keeps the main
  // pass identical, just removes 1 variant from the shadow pass)
  const leafShadow = quality !== 'lowest';

  for (let v = 0; v < count; v++) {
    const spec = TREE_VARIANTS[v];
    // cardMul evens the four variants out to the same card budget (they have different
    // pad/twig counts by design); without it the six-limbed variant would overshoot.
    const { wood, leaves } = buildTreeVariant(spec, { lod: 'map', density: density * (spec.cardMul ?? 1) });
    // stable index%variant split: neighbouring trees in the layout always differ
    const bucket = [];
    for (let i = v; i < items.length; i += count) bucket.push(items[i]);
    if (!bucket.length) continue;
    const name = `jungle-tree-${v}`;
    makeInstanced(ctx, wood, M.barkTrop, bucket, `${name}-bark`, 'wood', { seed: 1103 + v * 37, castShadow: true });
    makeInstanced(ctx, leaves, M.vegLeaf, bucket, `${name}-leaves`, 'fabric', {
      seed: 2003 + v * 53,
      castShadow: leafShadow,
    });
  }
}
