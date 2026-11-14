/**
 * Damage guard — dropped-item model (`loot-guard`).
 *
 * Art pass: a heater-shield plate (extruded rounded shield outline) with a
 * glowing cyan silhouette rim behind it, a floating energy core and a halo
 * ring. Geometry/material keys and mesh transforms are authored here; gameplay
 * stays in src/enemies.js.
 */
import * as THREE from 'three';
import { getLootMaterials } from './shared.js';

/** Model-viewer metadata (one entry in the unified catalog). */
export const meta = { id: 'loot-guard', kind: 'world', group: 'loot', label: '护盾模块 · DAMAGE GUARD', lift: true };

/** Heater-shield outline in the XY plane (front face looks toward -Z). */
function shieldShape() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.20, 0.15);
  shape.quadraticCurveTo(-0.20, 0.215, -0.135, 0.215);
  shape.lineTo(0.135, 0.215);
  shape.quadraticCurveTo(0.20, 0.215, 0.20, 0.15);
  shape.lineTo(0.20, 0.02);
  shape.quadraticCurveTo(0.20, -0.12, 0.0, -0.26);
  shape.quadraticCurveTo(-0.20, -0.12, -0.20, 0.02);
  shape.closePath();
  return shape;
}

/** Shield geometries: extruded plate (also reused for the glow rim), core, halo. */
export function createGeometries() {
  const plate = new THREE.ExtrudeGeometry(shieldShape(), {
    depth: 0.055,
    bevelEnabled: true,
    bevelThickness: 0.014,
    bevelSize: 0.014,
    bevelSegments: 2,
    curveSegments: 8,
  });
  plate.translate(0, 0, -0.0275);
  return {
    guardShieldPlate: plate,
    guardCore: new THREE.IcosahedronGeometry(0.105, 0),
    guardHalo: new THREE.TorusGeometry(0.33, 0.014, 8, 32),
  };
}

/**
 * Build the shield meshes onto `parent` and return them in creation order.
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

  // glowing silhouette rim, centred in the plate so the plate stays in front
  // from BOTH faces (the pickup spins in game)
  const rim = add(geos.guardShieldPlate, mats.guard);
  rim.scale.set(1.06, 1.06, 0.32);

  // dark armored shield plate
  add(geos.guardShieldPlate, mats.guardPlate);

  // energy cores floating in front of BOTH shield faces (the pickup spins in game)
  for (const zsign of [-1, 1]) {
    const core = add(geos.guardCore, mats.guard);
    core.position.z = zsign * 0.062;
  }

  // halo ring around the shield
  const halo = add(geos.guardHalo, mats.guard);
  halo.position.z = 0.055;

  return meshes;
}

/** Stage preview builder: fresh geometries + the shared material set. */
export function build(ctx) {
  return buildItem(ctx.scene, { geos: createGeometries(), mats: getLootMaterials() });
}
