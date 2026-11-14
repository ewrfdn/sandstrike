/**
 * Field repair (health) — dropped-item model (`loot-health`).
 *
 * Art pass: a blue battery (dark shell, metal end caps, + terminal nub, two
 * glowing charge bands and a glowing "+" on the front). Geometry/material keys
 * and mesh transforms are authored here; gameplay stays in src/enemies.js.
 */
import * as THREE from 'three';
import { getLootMaterials } from './shared.js';

/** Model-viewer metadata (one entry in the unified catalog). */
export const meta = { id: 'loot-health', kind: 'world', group: 'loot', label: '装甲修复 · FIELD REPAIR', lift: true };

const BODY_R = 0.135;
const BODY_H = 0.40;

/** Battery geometries: cell body, end caps, terminal nub, glow bands + "+". */
export function createGeometries() {
  return {
    healthBatteryBody: new THREE.CylinderGeometry(BODY_R, BODY_R, BODY_H, 20),
    healthBatteryCapTop: new THREE.CylinderGeometry(0.143, 0.143, 0.035, 20),
    healthBatteryCapBottom: new THREE.CylinderGeometry(0.143, 0.143, 0.03, 20),
    healthBatteryNub: new THREE.CylinderGeometry(0.048, 0.048, 0.05, 12),
    healthBatteryBand: new THREE.CylinderGeometry(0.142, 0.142, 0.03, 20),
    healthBatteryPlusH: new THREE.BoxGeometry(0.03, 0.115, 0.014),
    healthBatteryPlusV: new THREE.BoxGeometry(0.115, 0.03, 0.014),
  };
}

/**
 * Build the battery meshes onto `parent` and return them in creation order.
 * @param {THREE.Object3D} parent
 * @param {{ geos: Object<string, THREE.BufferGeometry>, mats: Object<string, THREE.Material> }} lib
 * @returns {THREE.Mesh[]}
 */
export function buildItem(parent, { geos, mats }) {
  const meshes = [];
  const add = (geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material);
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  // cell body: blue shell
  add(geos.healthBatteryBody, mats.batteryShell);

  // negative (bottom) and positive (top) end caps + the + terminal nub
  const capBottom = add(geos.healthBatteryCapBottom, mats.body);
  capBottom.position.y = -BODY_H / 2 - 0.005;
  const capTop = add(geos.healthBatteryCapTop, mats.body);
  capTop.position.y = BODY_H / 2 + 0.0175;
  const nub = add(geos.healthBatteryNub, mats.body);
  nub.position.y = BODY_H / 2 + 0.035 + 0.025;

  // two glowing charge bands around the cell
  for (const y of [0.085, -0.085]) {
    const band = add(geos.healthBatteryBand, mats.health);
    band.position.y = y;
  }

  // glowing "+" on BOTH faces (the pickup spins in game)
  for (const zsign of [-1, 1]) {
    const z = zsign * (BODY_R + 0.008);
    const plusH = add(geos.healthBatteryPlusH, mats.health);
    plusH.position.set(0, 0.04, z);
    const plusV = add(geos.healthBatteryPlusV, mats.health);
    plusV.position.set(0, 0.04, z);
  }

  return meshes;
}

/** Stage preview builder: fresh geometries + the shared material set. */
export function build(ctx) {
  return buildItem(ctx.scene, { geos: createGeometries(), mats: getLootMaterials() });
}
