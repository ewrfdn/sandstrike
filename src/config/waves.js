/**
 * Wave script + enemy appearance combos — ALL level combat content lives here.
 *
 * `STAGE_WAVES[stageId]` is the ordered wave list for one stage (see
 * `src/config/stages.js`). Each entry:
 *
 *   comp   spawn composition, keyed by ROBOT_TYPES chassis key
 *   label  banner text (EN // 中文)
 *
 * Boss rule (config driven, applied at runtime by EnemyManager):
 *   every `bossEvery`-th wave spawns `bossCount` × `bossType` chassis and strips
 *   `bossReplaces` chassis (warlord) from that wave's comp. Wave 5 / 10 / 15 are
 *   therefore SIEGE WARDEN fights by default — change these knobs to move or
 *   remove the boss without touching enemies.js.
 *
 * There is no code path that hardcodes a wave composition anymore: adding a
 * stage means adding one entry to STAGES and (optionally) one wave list here.
 */
export const WAVE_RULES = Object.freeze({
  total: 15,
  /** Every Nth wave is a boss wave. */
  bossEvery: 5,
  /** Chassis key from ROBOT_TYPES (src/models/robots/index.js). */
  bossType: 'boss',
  bossCount: 1,
  /** Chassis removed from the boss wave's composition (the boss replaces them). */
  bossReplaces: Object.freeze(['warlord']),
  /** Extra spawn delay (seconds) before the boss steps in after the escorts. */
  bossSpawnDelay: 1.4,
});

/** OUTPOST 07 — the current 15-wave assault. */
const OUTPOST_07_WAVES = Object.freeze([
  { comp: { scout: 4 }, label: 'SCOUT SWEEP // 侦察清扫' },
  { comp: { scout: 4, rifleman: 2 }, label: 'RIFLE TEAM // 步枪分队' },
  { comp: { scout: 3, rifleman: 3, heavy: 2 }, label: 'HEAVY CONTACT // 重装接触' },
  { comp: { scout: 2, rifleman: 4, heavy: 4 }, label: 'SIEGE LINE // 围攻阵线' },
  { comp: { scout: 3, rifleman: 4, heavy: 4, warlord: 1 }, label: 'SIEGE WARDEN // 攻城督军降临' },
  { comp: { scout: 4, rifleman: 4, heavy: 3 }, label: 'COUNTERATTACK // 敌军反扑' },
  { comp: { scout: 3, rifleman: 6, heavy: 4 }, label: 'SHOCK WAVE // 冲击波次' },
  { comp: { scout: 4, rifleman: 6, heavy: 4 }, label: 'ATTRITION // 消耗战' },
  { comp: { scout: 2, rifleman: 8, heavy: 6 }, label: 'SIEGE ESCALATION // 围攻升级' },
  { comp: { rifleman: 6, heavy: 6, warlord: 1 }, label: 'SIEGE WARDEN II // 攻城督军再临' },
  { comp: { scout: 4, rifleman: 6, heavy: 6 }, label: 'IRON RAIN // 钢铁弹雨' },
  { comp: { scout: 4, rifleman: 8, heavy: 6 }, label: 'DEAD GROUND // 死亡地带' },
  { comp: { scout: 3, rifleman: 8, heavy: 8 }, label: 'LAST LINE // 最后防线' },
  { comp: { scout: 4, rifleman: 8, heavy: 8 }, label: 'FINAL PUSH // 最终冲锋' },
  { comp: { rifleman: 8, heavy: 8, warlord: 1 }, label: 'OMEGA SIEGE WARDEN // 终焉攻城督军' },
].map((wave) => Object.freeze({
  comp: Object.freeze({ ...wave.comp }),
  label: wave.label,
})));

/** ATOLL 09 — the 15-wave tropical island assault (same pacing, island flavour). */
const ISLAND_01_WAVES = Object.freeze([
  { comp: { scout: 4 }, label: 'BEACH PROBE // 滩头试探' },
  { comp: { scout: 4, rifleman: 2 }, label: 'JUNGLE PATROL // 雨林巡逻' },
  { comp: { scout: 3, rifleman: 3, heavy: 2 }, label: 'THICKET CONTACT // 密林接触' },
  { comp: { scout: 2, rifleman: 4, heavy: 4 }, label: 'MANGROVE LINE // 红树林阵线' },
  { comp: { scout: 3, rifleman: 4, heavy: 4, warlord: 1 }, label: 'TIDAL WARDEN // 潮汐督军降临' },
  { comp: { scout: 4, rifleman: 4, heavy: 3 }, label: 'SURF COUNTER // 反扑登陆' },
  { comp: { scout: 3, rifleman: 6, heavy: 4 }, label: 'CANOPY SHOCK // 树冠突击' },
  { comp: { scout: 4, rifleman: 6, heavy: 4 }, label: 'ATTRITION TRAIL // 消耗小径' },
  { comp: { scout: 2, rifleman: 8, heavy: 6 }, label: 'RUIN ESCALATION // 遗迹升级' },
  { comp: { rifleman: 6, heavy: 6, warlord: 1 }, label: 'WARDEN OF THE ATOL // 环礁督军再临' },
  { comp: { scout: 4, rifleman: 6, heavy: 6 }, label: 'IRON MONSOON // 钢铁季风' },
  { comp: { scout: 4, rifleman: 8, heavy: 6 }, label: 'DEAD CALM // 死寂无风' },
  { comp: { scout: 3, rifleman: 8, heavy: 8 }, label: 'LAST SHORE // 最后海岸' },
  { comp: { scout: 4, rifleman: 8, heavy: 8 }, label: 'FINAL SWELL // 终末巨浪' },
  { comp: { rifleman: 8, heavy: 8, warlord: 1 }, label: 'OMEGA WARDEN // 终焉环礁督军' },
].map((wave) => Object.freeze({
  comp: Object.freeze({ ...wave.comp }),
  label: wave.label,
})));

export const STAGE_WAVES = Object.freeze({
  'outpost-07': OUTPOST_07_WAVES,
  'island-01': ISLAND_01_WAVES,
});

export const DEFAULT_WAVE_SET = 'outpost-07';

/**
 * Wave list for a stage id. Unknown stage ids fall back to the default wave set
 * so a newly registered map is still playable before its wave list is authored.
 */
export function wavesForStage(stageId) {
  return STAGE_WAVES[stageId] || STAGE_WAVES[DEFAULT_WAVE_SET] || OUTPOST_07_WAVES;
}

/** Number of waves in one stage's wave list. */
export function waveCountForStage(stageId) {
  return wavesForStage(stageId).length;
}

/**
 * Resolve the final wave composition (boss rule applied).
 *
 * @param {string} stageId
 * @param {number} wave 1-based wave index
 * @returns {{ comp: Record<string, number>, label: string, boss: boolean, bossType: string, bossCount: number }}
 */
export function resolveWave(stageId, wave) {
  const list = wavesForStage(stageId);
  const index = Math.max(1, Math.round(Number(wave) || 1)) - 1;
  const source = list[index] || list[list.length - 1] || { comp: {}, label: '' };
  const comp = { ...(source.comp || {}) };
  const isBossWave = WAVE_RULES.bossEvery > 0 && (index + 1) % WAVE_RULES.bossEvery === 0;
  if (isBossWave) {
    for (const key of WAVE_RULES.bossReplaces) delete comp[key];
    comp[WAVE_RULES.bossType] = (comp[WAVE_RULES.bossType] || 0) + WAVE_RULES.bossCount;
  }
  const label = source.label;
  return {
    comp,
    label,
    boss: isBossWave,
    bossType: WAVE_RULES.bossType,
    bossCount: isBossWave ? WAVE_RULES.bossCount : 0,
  };
}

/** Expand a composition into a flat chassis-key list (order handled by enemies.js). */
export function expandComposition(comp = {}) {
  const keys = [];
  for (const key of Object.keys(comp)) {
    const count = Math.max(0, Math.round(Number(comp[key]) || 0));
    for (let i = 0; i < count; i++) keys.push(key);
  }
  return keys;
}
