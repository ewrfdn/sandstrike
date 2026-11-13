import * as THREE from 'three';
import { TAU, makeInstanced } from '../core.js';
import { makeRNG } from '../../utils.js';

export const meta = { id: 'sacks', kind: 'world', group: 'clutter', label: '麻袋堆 · SACK PILE' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildSackFamily(ctx, true);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildSackFamily(ctx, false);
}

/**
 * Sack pile / market goods family.
 * Split out of world.js buildInstancedProps. `preview` is true only for the isolated
 * model-stage build, which uses the stage sample items instead of the map layout.
 */
function buildSackFamily(ctx, preview) {
  const L = ctx.data.layout;
  const M = ctx.materials;
  const sackGeo = new THREE.SphereGeometry(0.42, 7, 5);
  sackGeo.scale(1.0, 0.8, 0.75);
  const sackItems = [];
  const sackRng = makeRNG(881);
  if (preview) {
    for (let i = 0; i < 6; i++) {
      sackItems.push({ x: ((i % 3) - 1) * 0.5, y: 0.28 + (i > 2 ? 0.34 : 0), z: (Math.floor(i / 3) - 0.5) * 0.6, ry: i * 1.7, s: 0.85 + (i % 3) * 0.08 });
    }
  } else {
    for (const [cx, cz, n] of [[10.2, 14.2, 5], [-10.2, 14.2, 4], [10.2, 5.0, 3], [-10.2, 5.0, 5]]) {
      for (let i = 0; i < n; i++) {
        sackItems.push({
          x: cx + (sackRng() - 0.5) * 1.6,
          y: 0.28 + (i % 2) * 0.34,
          z: cz + (sackRng() - 0.5) * 1.1,
          ry: sackRng() * TAU,
          s: 0.8 + sackRng() * 0.3,
        });
      }
    }
    // bomb-site piles are a tight heap — they now have matching small colliders
    for (const [cx, cz] of L.sackPiles) {
      for (let i = 0; i < 3; i++) {
        sackItems.push({
          x: cx + (i - 1) * 0.5 + (sackRng() - 0.5) * 0.18,
          y: 0.26 + (i === 1 ? 0.34 : 0),
          z: cz + (i % 2 ? 0.28 : -0.28) + (sackRng() - 0.5) * 0.18,
          ry: sackRng() * TAU,
          s: 0.82 + sackRng() * 0.08,
        });
      }
    }
  }
  makeInstanced(ctx, sackGeo, M.sandbag, sackItems, 'sacks', 'fabric', { seed: 48 });
}
