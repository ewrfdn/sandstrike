/**
 * Rare relic — dropped-item model (`loot-relic`).
 *
 * Geometry, material keys and mesh transforms are moved verbatim from
 * `EnemiesSystem._initPickups()` / `_createPickupItem()` in src/enemies.js.
 */
import * as THREE from 'three';
import { getLootMaterials } from './shared.js';

/** Model-viewer metadata (one entry in the unified catalog). */
export const meta = { id: 'loot-relic', kind: 'world', group: 'loot', label: '金色圣物 · RELIC', lift: true };

/** Relic geometries (verbatim from `_pickupGeos`). */
export function createGeometries() {
  return {
    // rare relic: tall golden prism inside two rings
    relicCore: new THREE.OctahedronGeometry(0.22, 0),
    relicRingA: new THREE.TorusGeometry(0.3, 0.022, 8, 24),
    relicRingB: new THREE.TorusGeometry(0.24, 0.016, 8, 20),
    relicBeam: new THREE.CylinderGeometry(0.05, 0.16, 1.6, 10, 1, true),
  };
}

/**
 * Build the relic meshes onto `parent` exactly like the relic block of
 * `_createPickupItem()` and return them in creation order.
 * @param {THREE.Object3D} parent
 * @param {{ geos: Object<string, THREE.BufferGeometry>, mats: Object<string, THREE.Material> }} lib
 * @returns {THREE.Mesh[]}
 */
export function buildItem(parent, { geos, mats }) {
  // --- rare relic: golden prism + rotating rings + light column ---
  const relicParts = [];
  const relicCore = new THREE.Mesh(geos.relicCore, mats.relic);
  relicCore.scale.set(1, 1.35, 1);
  parent.add(relicCore);
  relicParts.push(relicCore);
  const relicRingA = new THREE.Mesh(geos.relicRingA, mats.relic);
  relicRingA.rotation.x = Math.PI / 2.4;
  parent.add(relicRingA);
  relicParts.push(relicRingA);
  const relicRingB = new THREE.Mesh(geos.relicRingB, mats.relic);
  relicRingB.rotation.set(Math.PI / 2, 0, 0.6);
  parent.add(relicRingB);
  relicParts.push(relicRingB);
  const relicBeam = new THREE.Mesh(geos.relicBeam, mats.relicBeam);
  relicBeam.position.y = 0.55;
  parent.add(relicBeam);
  relicParts.push(relicBeam);
  return relicParts;
}

/** Stage preview builder: fresh geometries + the shared material set. */
export function build(ctx) {
  return buildItem(ctx.scene, { geos: createGeometries(), mats: getLootMaterials() });
}
