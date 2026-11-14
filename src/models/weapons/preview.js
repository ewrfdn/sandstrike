/**
 * DEV-ONLY weapon preview for the model stage / model viewer.
 *
 * Builds a weapon type's held rig without touching `WeaponSystem` (which used
 * to drag the whole game weapon system into the dev harness): bare weapon and
 * gloved hands are built separately from the same material set and composed
 * under one held frame.
 *
 *   root (stage adds this)
 *   └─ frame            scale = heldScale (0.62)
 *      ├─ weaponRoot    bare weapon            (always visible)
 *      └─ handsRoot     gloved hands+forearms  (visible only in pose 'held')
 *
 * The default pose is 'bare' — the isolated preview shows the weapon model
 * without arms, which is the whole point of the split.
 */
import * as THREE from 'three';
import { getWeaponType } from './index.js';

/** Collect the GPU resources owned by a preview build (shared geos deduped by Set). */
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
 * @param {string} typeId weapon type id ('vxr7') or catalog id ('weapon-vxr7')
 * @returns {{
 *   type: object,
 *   poses: string[],
 *   pose: string,
 *   root: THREE.Group,
 *   frame: THREE.Group,
 *   weaponRoot: THREE.Group,
 *   handsRoot: THREE.Group,
 *   applyPose: (name: string) => string,
 *   dispose: () => void,
 * }}
 */
export function createWeaponPreview(typeId) {
  const type = getWeaponType(typeId);
  const poses = [...(type.meta?.poses || [])];
  if (poses.length === 0) throw new Error(`[weapons] weapon type has no poses: ${type.id}`);

  const mats = type.createMaterials();
  const weapon = type.buildWeapon({ mats, muzzleLight: null });
  const hands = type.buildHands({ mats });

  const root = new THREE.Group();
  root.name = `weapon-preview:${type.id}`;
  // Frozen hip snapshot of the held rig.  The old dev stage reused the live
  // `WeaponSystem.gunRoot`, which had gone through `_setHipTransform(0)` before
  // being previewed; reproducing that transform here keeps the HELD pose (and
  // its stage stats/bbox) pixel-identical to the pre-split baseline.  The stage
  // only adds its own `group.rotation.y = PI` framing rotation on top.
  // DEV-STAGE-ONLY: never reuse this preview root as a world/dropped model — a
  // world instance must stay at identity and use createWeaponPickup() instead.
  root.position.set(0.166, -0.124, -0.640);
  root.rotation.set(0, -0.045, -0.02);
  const frame = new THREE.Group();
  frame.name = 'heldFrame';
  frame.scale.setScalar(type.heldScale);
  root.add(frame);

  const weaponRoot = weapon.root;
  const handsRoot = hands.root;
  frame.add(weaponRoot);
  frame.add(handsRoot);

  let pose = null;
  const applyPose = (name = type.meta?.defaultPose || poses[0]) => {
    if (!poses.includes(name)) {
      throw new Error(`[weapons] unknown pose '${name}' for ${type.id} (known: ${poses.join(', ')})`);
    }
    // 'bare' = weapon only, 'held' = weapon + hands; the held rig always keeps
    // the hands under the same frame as the weapon so they never drift apart.
    handsRoot.visible = name === 'held';
    pose = name;
    root.updateMatrixWorld(true);
    return pose;
  };
  applyPose(type.meta?.defaultPose || poses[0]);

  let disposed = false;
  return {
    type,
    poses,
    get pose() { return pose; },
    root,
    frame,
    weaponRoot,
    handsRoot,
    applyPose,
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
