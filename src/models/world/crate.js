import * as THREE from 'three';
import { makeInstanced } from '../core.js';

export const meta = { id: 'crate', kind: 'world', group: 'clutter', label: '木箱堆 · CRATE STACK' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.crates = [{ x: 0, z: 0, s: 1.0, ry: 0.35, stack: 3 }];
  buildCrateFamily(ctx, true);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildCrateFamily(ctx, false);
}

/**
 * Crate stack family (wooden ammo crates & small boxes).
 * Split out of world.js buildInstancedProps. `preview` is true only for the isolated
 * model-stage build, which uses the stage sample items instead of the map layout.
 */
function buildCrateFamily(ctx, preview) {
  const L = ctx.data.layout;
  const M = ctx.materials;
  const crateGeo = new THREE.BoxGeometry(1, 1, 1);
  const crateItems = [];
  for (const c of L.crates) {
    for (let k = 0; k < c.stack; k++) {
      // crates are 0.82·s tall (matching the collider boxes) so the stack surfaces meet
      // instead of interpenetrating, and the bottom sits exactly on the sand
      crateItems.push({
        x: c.x + (k > 0 ? (k % 2 === 0 ? 0.06 : -0.05) : 0),
        y: c.s * 0.41 + k * c.s * 0.82,
        z: c.z + (k > 0 ? (k % 2 === 0 ? -0.05 : 0.04) : 0),
        ry: c.ry + k * 0.22,
        sx: c.s, sy: c.s * 0.82, sz: c.s,
      });
    }
  }
  // a few extra loose crates / ration boxes at waist height (positions/rotations come
  // from the layout so their collision boxes are registered in buildWorldData)
  if (!preview) for (const c of L.looseCrates) {
    crateItems.push({ x: c.x, y: c.s * 0.41, z: c.z, ry: c.ry, sx: c.s, sy: c.s * 0.82, sz: c.s });
  }
  const crateMesh = makeInstanced(ctx, crateGeo, M.crate, crateItems, 'crates', 'wood', { seed: 41 });
  ctx.instanced = { crates: crateMesh };
}
