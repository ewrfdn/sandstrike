/**
 * Vital core (max health) — dropped-item model (`loot-vital`).
 *
 * Geometry, material keys and mesh transforms are moved verbatim from
 * `EnemiesSystem._initPickups()` / `_createPickupItem()` in src/enemies.js.
 */
import * as THREE from 'three';
import { getLootMaterials } from './shared.js';

/** Model-viewer metadata (one entry in the unified catalog). */
export const meta = { id: 'loot-vital', kind: 'world', group: 'loot', label: '生命核心 · VITAL CORE', lift: true };

/** Vital-core geometries (verbatim from `_pickupGeos`). */
export function createGeometries() {
  return {
    // max-health vital core: green orb inside a cross frame
    vitalOrb: new THREE.SphereGeometry(0.15, 12, 10),
    vitalCrossA: new THREE.BoxGeometry(0.07, 0.34, 0.07),
    vitalCrossB: new THREE.BoxGeometry(0.34, 0.07, 0.07),
    vitalRing: new THREE.TorusGeometry(0.28, 0.02, 6, 20),
  };
}

/**
 * Build the vital-core meshes onto `parent` exactly like the vital block of
 * `_createPickupItem()` and return them in creation order.
 * @param {THREE.Object3D} parent
 * @param {{ geos: Object<string, THREE.BufferGeometry>, mats: Object<string, THREE.Material> }} lib
 * @returns {THREE.Mesh[]}
 */
export function buildItem(parent, { geos, mats }) {
  // --- max-health vital core: green cross frame around a glowing orb ---
  const vitalParts = [];
  const vitalOrb = new THREE.Mesh(geos.vitalOrb, mats.vitalFrame);
  parent.add(vitalOrb);
  vitalParts.push(vitalOrb);
  const vitalCrossA = new THREE.Mesh(geos.vitalCrossA, mats.vital);
  parent.add(vitalCrossA);
  vitalParts.push(vitalCrossA);
  const vitalCrossB = new THREE.Mesh(geos.vitalCrossB, mats.vital);
  vitalCrossB.rotation.z = Math.PI / 2;
  parent.add(vitalCrossB);
  vitalParts.push(vitalCrossB);
  const vitalRing = new THREE.Mesh(geos.vitalRing, mats.vital);
  vitalRing.rotation.x = Math.PI / 2.8;
  parent.add(vitalRing);
  vitalParts.push(vitalRing);
  return vitalParts;
}

/** Stage preview builder: fresh geometries + the shared material set. */
export function build(ctx) {
  return buildItem(ctx.scene, { geos: createGeometries(), mats: getLootMaterials() });
}
