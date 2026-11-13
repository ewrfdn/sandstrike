import * as THREE from 'three';
import { makeInstanced } from '../core.js';

export const meta = { id: 'barrel', kind: 'world', group: 'clutter', label: '油桶 · FUEL DRUMS' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.barrels = [{ x: -0.5, z: 0.1, yaw: 0.2 }, { x: 0.55, z: -0.1, yaw: 1.4 }];
  buildBarrelFamily(ctx, true);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildBarrelFamily(ctx, false);
}

/**
 * Barrel / fuel drum family.
 * Split out of world.js buildInstancedProps. `preview` is true only for the isolated
 * model-stage build, which uses the stage sample items instead of the map layout.
 */
function buildBarrelFamily(ctx, preview) {
  const L = ctx.data.layout;
  const M = ctx.materials;
  const barrelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.94, 12, 1, false);
  const barrelItems = L.barrels.map((b) => ({ x: b.x, y: 0.47, z: b.z, ry: b.yaw, s: 1 }));
  // second-row drums sit on real base drums (they used to hover 0.95 m over the sand)
  if (!preview) for (const [x, z] of [[-18.2, 28.6], [-19.3, 27.2], [-30.9, -24.8], [22.2, -28.1]]) {
    barrelItems.push({ x, y: 1.41, z, ry: 0.4, s: 1 });
  }
  makeInstanced(ctx, barrelGeo, M.rust, barrelItems, 'barrels', 'metal', { seed: 42 });
}
