/**
 * Robot model registry — one module per chassis under this folder.
 *
 * Exposes the chassis definitions exactly as src/enemies.js used to define them
 * (ROBOT_TYPES / TYPE_KEYS / buildRobotRig) plus the stage metadata that the dev
 * model viewer and scripts/model-shots.mjs consume.  Gameplay (Robot, waves,
 * AI) stays in src/enemies.js and imports from this module.
 *
 * Combat stats (hp / per-shot damage) are NOT owned by the chassis model
 * modules: they live in src/config/enemies.js and are merged into each def here,
 * so runtime code keeps reading `def.hp` / `def.fire.damage` from one complete
 * entry while balance numbers stay in the config file.
 *
 * The createRobotPreview re-export below closes an intentional module cycle with
 * preview.js (see the note there); it is safe because both modules only touch
 * each other's bindings from inside functions, never while evaluating.
 */
import { ENEMY_STATS } from '../../config/enemies.js';
import { createRobotPreview } from './preview.js';
import {
  buildRobotRig as assembleRobotRig,
  createRobotBaseMaterials,
  createRigMaterialSet,
  createUnitGeos,
  disposeUnitGeos,
} from './shared.js';
import { def as scoutDef, hooks as scoutHooks, meta as scoutMeta } from './scout.js';
import { def as riflemanDef, hooks as riflemanHooks, meta as riflemanMeta } from './rifleman.js';
import { def as heavyDef, hooks as heavyHooks, meta as heavyMeta } from './heavy.js';
import { def as warlordDef, hooks as warlordHooks, meta as warlordMeta } from './warlord.js';
import { def as bossDef, hooks as bossHooks, meta as bossMeta } from './boss.js';

/** Merge the combat stats owned by src/config/enemies.js into a chassis def. */
function withCombatStats(def) {
  const stats = ENEMY_STATS[def.key];
  if (!stats) {
    throw new Error(`[robots] no ENEMY_STATS entry for chassis "${def.key}" — add it in src/config/enemies.js`);
  }
  return { ...def, hp: stats.hp, fire: { ...def.fire, damage: stats.damage } };
}

export const ROBOT_TYPES = {
  scout: withCombatStats(scoutDef),
  rifleman: withCombatStats(riflemanDef),
  heavy: withCombatStats(heavyDef),
  warlord: withCombatStats(warlordDef),
  boss: withCombatStats(bossDef),
};

// Chassis keys the wave director may spawn / prewarm. The SIEGE WARDEN is a
// real boss chassis now (every 5th wave), so it belongs here; the model catalog
// (ROBOT_MODELS above) is unchanged. A chassis can still opt out with
// `designOnly: true` (kept as an escape hatch for pure model studies).
export const TYPE_KEYS = Object.keys(ROBOT_TYPES).filter((key) => !ROBOT_TYPES[key].designOnly);

const HOOKS = {
  scout: scoutHooks,
  rifleman: riflemanHooks,
  heavy: heavyHooks,
  warlord: warlordHooks,
  boss: bossHooks,
};

/** Build one chassis rig (same signature as the old src/enemies.js helper). */
export function buildRobotRig(def, rigMats, geos, hitGeo, hitMat) {
  return assembleRobotRig(def, rigMats, geos, hitGeo, hitMat, HOOKS[def.key] || {});
}

export { createUnitGeos, disposeUnitGeos, createRobotBaseMaterials, createRigMaterialSet, createRobotPreview };

/** Stage entries (id / kind / group / label / type / defaultPose) for the five chassis. */
export const ROBOT_MODELS = [
  { meta: scoutMeta },
  { meta: riflemanMeta },
  { meta: heavyMeta },
  { meta: warlordMeta },
  { meta: bossMeta },
];
