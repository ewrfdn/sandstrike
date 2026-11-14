/**
 * Shared material set for the dropped-item (loot) models.
 *
 * The original 14 materials were moved verbatim from
 * `EnemiesSystem._initPickups()` (`this._pickupMats`) in src/enemies.js.
 * Gameplay owns its own set; the dev model stage reuses the memoized singleton
 * below so every loot preview shares a single material set per page.
 *
 * Art pass: the health pickup is a blue battery now (the old teal glow moved to
 * 0x4fc3ff) and brass/brassDark were added for the bullet/magazine models.
 */
import * as THREE from 'three';

/** Create a fresh set of the loot materials (same keys/values as the game). */
export function createLootMaterials() {
  return {
    body: new THREE.MeshStandardMaterial({ color: 0x2c2b27, metalness: 0.72, roughness: 0.48 }),
    magMetal: new THREE.MeshStandardMaterial({ color: 0x384049, metalness: 0.85, roughness: 0.32 }),
    // gunmetal shell with a slight blue cast (curved magazine pickup)
    magShell: new THREE.MeshStandardMaterial({ color: 0x4a555f, metalness: 0.3, roughness: 0.48 }),
    // blue battery shell (field-repair pickup)
    batteryShell: new THREE.MeshStandardMaterial({ color: 0x2f6693, metalness: 0.45, roughness: 0.42 }),
    // brass for cartridge cases / stripper-clip plate; darker brass for bullet tips
    brass: new THREE.MeshStandardMaterial({ color: 0xd0a84a, metalness: 0.9, roughness: 0.3 }),
    brassDark: new THREE.MeshStandardMaterial({ color: 0x8a6624, metalness: 0.86, roughness: 0.38 }),
    ammo: new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false }),
    health: new THREE.MeshBasicMaterial({ color: 0x4fc3ff, toneMapped: false }),
    mag: new THREE.MeshBasicMaterial({ color: 0x7cc8ff, toneMapped: false }),
    power: new THREE.MeshBasicMaterial({ color: 0xff5a3c, toneMapped: false }),
    reload: new THREE.MeshBasicMaterial({ color: 0xc084ff, toneMapped: false }),
    relic: new THREE.MeshBasicMaterial({ color: 0xffe27a, toneMapped: false }),
    relicBeam: new THREE.MeshBasicMaterial({
      color: 0xffd062, transparent: true, opacity: 0.28, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }),
    guard: new THREE.MeshBasicMaterial({ color: 0x66e2ff, toneMapped: false }),
    guardPlate: new THREE.MeshStandardMaterial({ color: 0x3a4a56, metalness: 0.35, roughness: 0.45 }),
    vital: new THREE.MeshBasicMaterial({ color: 0xa6ff5e, toneMapped: false }),
    vitalFrame: new THREE.MeshStandardMaterial({ color: 0x2d3a24, metalness: 0.78, roughness: 0.36 }),
    powerCage: new THREE.MeshStandardMaterial({
      color: 0x40464e, metalness: 0.8, roughness: 0.35, transparent: true, opacity: 0.55,
    }),
  };
}

let _sharedMaterials = null;

/** Memoized material set shared by stage previews (one set per dev page). */
export function getLootMaterials() {
  if (!_sharedMaterials) _sharedMaterials = createLootMaterials();
  return _sharedMaterials;
}

/** Dispose the shared singleton and reset it to null (safe to call repeatedly). */
export function disposeLootMaterials() {
  if (!_sharedMaterials) return;
  for (const key in _sharedMaterials) _sharedMaterials[key].dispose();
  _sharedMaterials = null;
}
