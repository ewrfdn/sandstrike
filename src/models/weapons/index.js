/**
 * Weapon type registry — the single place that knows which weapon models exist
 * and how to build/attach them.
 *
 * This is the foundation for weapon drops / pickups:
 *   - `WEAPON_MODELS` feeds the unified model catalog (dev viewer + stage shots).
 *   - `createWeaponPickup()` builds a bare weapon (no hands) that can be dropped
 *     into the world now; the pickup flow transfers the weapon root into the held
 *     frame and calls the runtime `WeaponSystem.equip()` binding point.
 *
 * The hands are deliberately NOT part of a weapon type's world instance: they
 * belong to the held rig and are built separately with `buildHands()`.
 *
 * Four weapons ship (CONTRACT §2 `WEAPON_ORDER`): vxr7 / rpg / gatling / shotgun.
 * Every type exposes the same CONTRACT §5 surface, so `preview.js`,
 * `createWeaponPickup()` and `WeaponSystem` treat them identically:
 *   { id, catalogId, label, heldScale, meta, createMaterials, buildWeapon, buildHands }
 */
import * as THREE from 'three';
import * as vxr7 from './vxr7.js';
import * as rpg7 from './rpg7.js';
import * as gatling from './gatling.js';
import * as shotgun from './shotgun.js';

export const WEAPON_TYPES = {
  vxr7: {
    id: 'vxr7',
    catalogId: 'weapon-vxr7',
    label: 'VXR-7 · 5.56 突击步枪',
    heldScale: 0.62,
    meta: vxr7.meta,
    createMaterials: vxr7.createVxr7Materials,
    buildWeapon: vxr7.buildVxr7Weapon,
    buildHands: vxr7.buildVxr7Hands,
    buildHeldRig: vxr7.buildVxr7Viewmodel,
  },
  rpg: {
    id: 'rpg',
    catalogId: 'weapon-rpg',
    label: rpg7.meta.label,
    heldScale: 0.62,
    meta: rpg7.meta,
    createMaterials: rpg7.createMaterials,
    buildWeapon: rpg7.buildWeapon,
    buildHands: rpg7.buildHands,
  },
  gatling: {
    id: 'gatling',
    catalogId: 'weapon-gatling',
    label: gatling.meta.label,
    heldScale: 0.60,
    meta: gatling.meta,
    createMaterials: gatling.createMaterials,
    buildWeapon: gatling.buildWeapon,
    buildHands: gatling.buildHands,
  },
  shotgun: {
    id: 'shotgun',
    catalogId: 'weapon-shotgun',
    label: shotgun.meta.label,
    heldScale: 0.62,
    meta: shotgun.meta,
    createMaterials: shotgun.createMaterials,
    buildWeapon: shotgun.buildWeapon,
    buildHands: shotgun.buildHands,
  },
};

/** Model-viewer catalog entries (src/models/index.js spreads these into MODEL_CATALOG). */
export const WEAPON_MODELS = [vxr7.meta, rpg7.meta, gatling.meta, shotgun.meta];

/**
 * Resolve a weapon type by registry id ('vxr7') or catalog id ('weapon-vxr7').
 * Throws on an unknown id so callers fail loudly instead of silently not
 * equipping anything.
 */
export function getWeaponType(id) {
  const type = Object.values(WEAPON_TYPES).find(
    (candidate) => candidate.id === id || candidate.catalogId === id || candidate.meta?.id === id,
  );
  if (!type) {
    throw new Error(`[weapons] unknown weapon type: ${id} (known: ${Object.keys(WEAPON_TYPES).join(', ')})`);
  }
  return type;
}

/** Collect the GPU resources owned by a weapon instance built by a weapon type. */
function collectDisposables(root, mats) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((obj) => {
    if (obj.geometry) geometries.add(obj.geometry);
    const list = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    for (const material of list) materials.add(material);
  });
  if (mats) for (const material of Object.values(mats)) if (material) materials.add(material);
  for (const material of materials) {
    for (const key of Object.keys(material)) {
      const value = material[key];
      if (value && value.isTexture) textures.add(value);
    }
  }
  return { geometries, materials, textures };
}

/**
 * Bare weapon instance for the world (a drop / pickup, no hands attached).
 *
 * Usage (pickup loop):
 *   const pickup = createWeaponPickup('vxr7');
 *   scene.add(pickup.root);                    // lies in the sand at the pickup spot
 *   ...player walks over it, then WeaponSystem.equip('vxr7') binds the type's
 *   held rig; pickup.dispose() frees this world instance.
 *
 * @param {string} typeId 'vxr7' | 'rpg' | 'gatling' | 'shotgun' (or catalog id)
 * @param {{ scale?: number }} [opts] root scale, defaults to the type's heldScale
 * @returns {{ type: object, root: THREE.Group, weaponRoot: THREE.Group, dispose: () => void }}
 */
export function createWeaponPickup(typeId, { scale = null } = {}) {
  const type = getWeaponType(typeId);
  const heldScale = scale == null ? type.heldScale : scale;
  const mats = type.createMaterials();
  const weapon = type.buildWeapon({ mats, muzzleLight: null });

  const root = new THREE.Group();
  root.name = `weapon-pickup:${type.id}`;
  root.scale.setScalar(heldScale);
  root.add(weapon.root);

  let disposed = false;
  return {
    type,
    root,
    weaponRoot: weapon.root,
    dispose() {
      if (disposed) return;
      disposed = true;
      const { geometries, materials, textures } = collectDisposables(root, mats);
      for (const geometry of geometries) geometry.dispose();
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      if (root.parent) root.parent.remove(root);
    },
  };
}
