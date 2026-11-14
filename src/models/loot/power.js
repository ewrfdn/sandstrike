/**
 * Damage boost (power core) — dropped-item model (`loot-power`).
 *
 * Geometry, material keys and mesh transforms are moved verbatim from
 * `EnemiesSystem._initPickups()` / `_createPickupItem()` in src/enemies.js.
 */
import * as THREE from 'three';
import { getLootMaterials } from './shared.js';

/** Model-viewer metadata (one entry in the unified catalog). */
export const meta = { id: 'loot-power', kind: 'world', group: 'loot', label: '子弹威力 · DAMAGE BOOST', lift: true };

/** Damage-upgrade geometries (verbatim from `_pickupGeos`). */
export function createGeometries() {
  return {
    // damage upgrade: a glowing core in a caged frame
    powerCore: new THREE.OctahedronGeometry(0.15, 0),
    powerCage: new THREE.IcosahedronGeometry(0.24, 0),
    powerRing: new THREE.TorusGeometry(0.26, 0.02, 6, 18),
  };
}

/**
 * Build the damage-boost meshes onto `parent` exactly like the power block of
 * `_createPickupItem()` and return them in creation order.
 * @param {THREE.Object3D} parent
 * @param {{ geos: Object<string, THREE.BufferGeometry>, mats: Object<string, THREE.Material> }} lib
 * @returns {THREE.Mesh[]}
 */
export function buildItem(parent, { geos, mats }) {
  // --- damage loot: glowing core inside a wireframe cage ---
  const powerParts = [];
  const powerCore = new THREE.Mesh(geos.powerCore, mats.power);
  parent.add(powerCore);
  powerParts.push(powerCore);
  const powerCage = new THREE.Mesh(geos.powerCage, mats.powerCage);
  powerCage.scale.setScalar(1.1);
  parent.add(powerCage);
  powerParts.push(powerCage);
  const powerRing = new THREE.Mesh(geos.powerRing, mats.power);
  powerRing.rotation.x = Math.PI / 2.4;
  parent.add(powerRing);
  powerParts.push(powerRing);
  return powerParts;
}

/** Stage preview builder: fresh geometries + the shared material set. */
export function build(ctx) {
  return buildItem(ctx.scene, { geos: createGeometries(), mats: getLootMaterials() });
}
