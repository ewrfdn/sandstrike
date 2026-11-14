/**
 * Config entry point — everything tunable lives under `src/config/`.
 *
 *   game.js        shared gameplay/renderer tunables (formerly src/config.js)
 *   enemies.js     robot combat stats (hp / per-shot damage)
 *   difficulty.js  the four campaign difficulty tiers (enemy hp/damage multipliers)
 *   waves.js       wave script + enemy appearance combos + boss-wave rule
 *   stages.js      stage/level catalog (one save slot + unlock per entry)
 *   weapons.js     weapon stat blocks (4 guns) + ammo-supply conversion
 *   maps/          one folder per playable map (composite JSON parts)
 */
export { CONFIG } from './game.js';
export { ENEMY_STATS } from './enemies.js';
export {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  DEFAULT_DIFFICULTY_ID,
  getDifficulty,
  isDifficultyId,
} from './difficulty.js';
export {
  WAVE_RULES,
  STAGE_WAVES,
  DEFAULT_WAVE_SET,
  wavesForStage,
  waveCountForStage,
  resolveWave,
  expandComposition,
} from './waves.js';
export {
  STAGES,
  STAGE_TOTAL,
  DEFAULT_STAGE_ID,
  getStage,
  getStageByIndex,
  nextStage,
  nextStageIdAfter,
  stageWaves,
  stageWaveCount,
  firstStage,
} from './stages.js';
export {
  WEAPON_STATS,
  WEAPON_ORDER,
  DEFAULT_WEAPON_ID,
  MAX_WEAPON_SLOTS,
  getWeaponStats,
  weaponSlotIndex,
  weaponStatsInOrder,
  convertSupplyAmmo,
} from './weapons.js';
