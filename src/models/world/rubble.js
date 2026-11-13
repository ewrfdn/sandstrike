import * as THREE from 'three';
import { TAU, makeInstanced } from '../core.js';
import { makeRNG } from '../../utils.js';

export const meta = { id: 'rubble', kind: 'world', group: 'clutter', label: '碎石堆 · RUBBLE' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildRubbleFamily(ctx, true);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildRubbleFamily(ctx, false);
}

/**
 * Rubble & loose stone family.
 * Split out of world.js buildInstancedProps. `preview` is true only for the isolated
 * model-stage build, which uses the stage sample items instead of the map layout.
 */
function buildRubbleFamily(ctx, preview) {
  const L = ctx.data.layout;
  const M = ctx.materials;
  const rockGeo = new THREE.IcosahedronGeometry(0.22, 0);
  const rockItems = [];
  const rockRng = makeRNG(551);
  const rubbleSpots = [
    [-31.5, 20.0, 8], [31.4, 12.0, 6], [-30.8, 6.0, 7], [30.6, 2.0, 5],
    [-16.0, -29.5, 10], [16.5, -29.8, 11], [-10.5, 19.5, 6], [11.5, 19.0, 6],
    [22.0, -20.5, 7], [-22.5, -20.8, 8], [-11.5, -25.5, 7], [12.0, -17.0, 6],
    [-28.0, -30.5, 9], [28.5, -30.4, 9], [-25.0, 22.0, 6], [25.0, -31.0, 6],
  ];
  if (preview) {
    for (let i = 0; i < 7; i++) {
      rockItems.push({ x: ((i % 3) - 1) * 0.42, y: 0.07 + (i % 2) * 0.05, z: (Math.floor(i / 3) - 1) * 0.36, ry: i * 1.13, rx: (i % 3) * 0.12 - 0.12, s: 0.55 + (i % 3) * 0.28 });
    }
  } else for (const [cx, cz, count] of rubbleSpots) {
    for (let i = 0; i < count; i++) {
      rockItems.push({
        x: cx + (rockRng() - 0.5) * 3.6,
        y: 0.07 + rockRng() * 0.06,
        z: cz + (rockRng() - 0.5) * 3.0,
        ry: rockRng() * TAU,
        rx: (rockRng() - 0.5) * 0.3,
        s: 0.4 + rockRng() * 1.2,
      });
    }
  }
  makeInstanced(ctx, rockGeo, M.stoneDark, rockItems, 'rubble', 'stone', { seed: 46, castShadow: false });
}
