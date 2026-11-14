/**
 * Unified model catalog for the dev model viewer / automation harness.
 *
 * Every model is defined in its own module under src/models/<group>/<id>.js;
 * this file only assembles metadata + preview builders into one array.
 */
import { WORLD_MODELS } from './world/index.js';
import { ROBOT_MODELS } from './robots/index.js';
import { WEAPON_MODELS } from './weapons/index.js';
import { LOOT_MODELS } from './loot/index.js';

export const MODEL_CATALOG = [
  ...WORLD_MODELS.map(({ module, stage }) => ({
    ...module.meta,
    ...(stage || {}),
    build: module.build,
  })),
  ...ROBOT_MODELS.map((entry) => ({ ...entry.meta })),
  // Weapon models live in their own registry (src/models/weapons/index.js):
  // the entry carries `weaponId` so the stage can build a weapon preview
  // without pulling the gameplay WeaponSystem in. weapon-vxr7 stays last.
  ...WEAPON_MODELS.map((meta) => ({ ...meta })),
  // Dropped-item / pickup models (src/models/loot/): one file per drop kind,
  // the same builders the EnemyManager uses for in-world loot. Appended last
  // so the existing world/robot/weapon catalog indices stay stable.
  ...LOOT_MODELS.map((module) => ({ ...module.meta, build: module.build })),
];

export function getModelEntry(id) {
  return MODEL_CATALOG.find((entry) => entry.id === id) || null;
}
