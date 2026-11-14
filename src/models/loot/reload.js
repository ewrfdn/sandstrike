/**
 * Fast hands (reload speed) — dropped-item model (`loot-reload`).
 *
 * Geometry, material keys and mesh transforms are moved verbatim from
 * `EnemiesSystem._initPickups()` / `_createPickupItem()` in src/enemies.js.
 */
import * as THREE from 'three';
import { getLootMaterials } from './shared.js';

/** Model-viewer metadata (one entry in the unified catalog). */
export const meta = { id: 'loot-reload', kind: 'world', group: 'loot', label: '换弹加速 · FAST HANDS', lift: true };

/** Reload-upgrade geometries (verbatim from `_pickupGeos`). */
export function createGeometries() {
  return {
    // reload-speed upgrade: stopwatch bezel + bolt
    reloadDisc: new THREE.CylinderGeometry(0.17, 0.17, 0.06, 16),
    reloadRing: new THREE.TorusGeometry(0.2, 0.028, 8, 22),
    reloadBolt: new THREE.BoxGeometry(0.05, 0.2, 0.05),
  };
}

/**
 * Build the reload-upgrade meshes onto `parent` exactly like the reload block
 * of `_createPickupItem()` and return them in creation order.
 * @param {THREE.Object3D} parent
 * @param {{ geos: Object<string, THREE.BufferGeometry>, mats: Object<string, THREE.Material> }} lib
 * @returns {THREE.Mesh[]}
 */
export function buildItem(parent, { geos, mats }) {
  // --- reload speed loot: stopwatch dial with a bolt hand ---
  const reloadParts = [];
  const reloadDisc = new THREE.Mesh(geos.reloadDisc, mats.magMetal);
  reloadDisc.rotation.x = Math.PI / 2.2;
  parent.add(reloadDisc);
  reloadParts.push(reloadDisc);
  const reloadRing = new THREE.Mesh(geos.reloadRing, mats.reload);
  reloadRing.rotation.x = Math.PI / 2.2;
  parent.add(reloadRing);
  reloadParts.push(reloadRing);
  const reloadBolt = new THREE.Mesh(geos.reloadBolt, mats.reload);
  reloadBolt.position.set(0, 0.02, 0.06);
  reloadBolt.rotation.set(Math.PI / 2.2, 0, 0.5);
  parent.add(reloadBolt);
  reloadParts.push(reloadBolt);
  return reloadParts;
}

/** Stage preview builder: fresh geometries + the shared material set. */
export function build(ctx) {
  return buildItem(ctx.scene, { geos: createGeometries(), mats: getLootMaterials() });
}
