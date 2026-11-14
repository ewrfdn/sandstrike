/**
 * Ammo cache — dropped-item model (`loot-ammo`).
 *
 * Art pass: a brass stripper-clip plate carrying a row of five standing rifle
 * cartridges (case + pointed bullet), with two orange glow rails marking it as
 * loot. Geometry/material keys and mesh transforms are authored here; gameplay
 * (drop table, pooling, pickup radius) stays in src/enemies.js.
 */
import * as THREE from 'three';
import { getLootMaterials } from './shared.js';

/** Model-viewer metadata (one entry in the unified catalog). */
export const meta = { id: 'loot-ammo', kind: 'world', group: 'loot', label: '弹药储备 · AMMO CACHE', lift: true };

const BULLET_COUNT = 5;
const BULLET_SPACING = 0.082;
const BULLET_X0 = -((BULLET_COUNT - 1) * BULLET_SPACING) / 2;

/** Ammo-cache geometries: clip plate + rim + cartridge parts + glow rails. */
export function createGeometries() {
  return {
    ammoClipPlate: new THREE.BoxGeometry(0.44, 0.026, 0.16),
    ammoClipRim: new THREE.BoxGeometry(0.47, 0.018, 0.185),
    ammoClipTab: new THREE.BoxGeometry(0.03, 0.055, 0.13),
    ammoCase: new THREE.CylinderGeometry(0.026, 0.026, 0.125, 10),
    ammoBulletTip: new THREE.ConeGeometry(0.026, 0.062, 10),
    ammoGlowRail: new THREE.BoxGeometry(0.40, 0.012, 0.012),
  };
}

/**
 * Build the ammo-cache meshes onto `parent` and return them in creation order.
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

  // dark backing rim + brass clip plate (the "plate" of the ammo plate)
  const rim = add(geos.ammoClipRim, mats.body);
  rim.position.y = -0.016;
  const plate = add(geos.ammoClipPlate, mats.brassDark);
  plate.position.y = 0.004;

  // clip end tabs: stamped steel lips that hold the rounds in place
  for (const sx of [-0.215, 0.215]) {
    const tab = add(geos.ammoClipTab, mats.body);
    tab.position.set(sx, 0.032, 0);
  }

  // five standing cartridges along the clip, tips up
  for (let i = 0; i < BULLET_COUNT; i++) {
    const x = BULLET_X0 + i * BULLET_SPACING;
    const cartridge = add(geos.ammoCase, mats.brass);
    cartridge.position.set(x, 0.079, 0);
    const tip = add(geos.ammoBulletTip, mats.brassDark);
    tip.position.set(x, 0.173, 0);
  }

  // glowing edges along the top of the plate (loot readability)
  for (const sz of [-0.062, 0.062]) {
    const rail = add(geos.ammoGlowRail, mats.ammo);
    rail.position.set(0, 0.021, sz);
  }

  return meshes;
}

/** Stage preview builder: fresh geometries + the shared material set. */
export function build(ctx) {
  return buildItem(ctx.scene, { geos: createGeometries(), mats: getLootMaterials() });
}
