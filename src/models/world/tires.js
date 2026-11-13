import * as THREE from 'three';
import { makeInstanced } from '../core.js';

export const meta = { id: 'tires', kind: 'world', group: 'clutter', label: '轮胎堆 · TIRE STACK' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildTireFamily(ctx, true);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildTireFamily(ctx, false);
}

/**
 * Tire stack family.
 * Split out of world.js buildInstancedProps. `preview` is true only for the isolated
 * model-stage build, which uses the stage sample items instead of the map layout.
 */
function buildTireFamily(ctx, preview) {
  const L = ctx.data.layout;
  const M = ctx.materials;
  const tireGeo = new THREE.TorusGeometry(0.4, 0.15, 8, 16);
  const tireItems = [];
  if (preview) {
    for (let i = 0; i < 4; i++) tireItems.push({ x: 0, y: 0.16 + i * 0.3, z: 0, rx: Math.PI / 2, s: 1 });
  } else for (const [x, z, n] of L.tireStacks) {
    for (let i = 0; i < n; i++) tireItems.push({ x, y: 0.16 + i * 0.3, z, rx: Math.PI / 2, s: 1 });
  }
  makeInstanced(ctx, tireGeo, M.rubber, tireItems, 'tires', 'metal', { seed: 47 });
}
