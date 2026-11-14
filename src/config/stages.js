/**
 * Stage (level) catalog — the progression unit of the campaign.
 *
 * One stage = one playthrough of one map's wave script. The save system creates
 * one save slot + one unlock flag PER ENTRY here, so adding a stage is purely a
 * config change:
 *
 *   1. (optional) author a map folder under src/config/maps/ and register it in
 *      src/config/maps/index.js
 *   2. add a wave list under src/config/waves.js → STAGE_WAVES[<waveSet>]
 *   3. append one entry below
 *
 * Stage order is `index` (1-based). The first stage is unlocked from the start;
 * clearing stage N unlocks stage N+1. Selecting a stage later inherits the
 * previous stage's ending run state (weapons + upgrades + player bonuses).
 *
 * The current build ships exactly ONE stage: OUTPOST 07 (the existing 15-wave
 * assault). The save framework already supports N stages; no code change is
 * needed to grow the campaign.
 */
import { STAGE_WAVES, DEFAULT_WAVE_SET, waveCountForStage } from './waves.js';

/** @typedef {{ id: string, index: number, name: string, subtitle: string, mapId: string, waveSet: string, unlockedByDefault: boolean, brief: string, threat: string, enemy: string }} StageDef */

/** @type {ReadonlyArray<StageDef>} */
export const STAGES = Object.freeze([
  Object.freeze({
    id: 'outpost-07',
    index: 1,
    name: 'OUTPOST 07',
    subtitle: '沙暴前哨 · 第七区',
    mapId: 'outpost-07',
    waveSet: 'outpost-07',
    unlockedByDefault: true,
    brief: 'DUST BASIN 前哨站遭遇机械军团突袭。坚守十五波，击破每五波降临的攻城督军。',
    threat: 'SEVERE',
    enemy: 'MACHINE LEGION',
  }),
  Object.freeze({
    id: 'island-01',
    index: 2,
    name: 'ATOLL 09',
    subtitle: '碧潮环礁 · 第九区',
    mapId: 'island-01',
    waveSet: 'island-01',
    // Playable straight from the menu while the campaign flow is being tuned; set to
    // false to make it unlock only after OUTPOST 07 is cleared.
    unlockedByDefault: true,
    brief: '碧潮环礁的雨林深处信号失联。跨过环礁岩脊，守住南滩营地、草村与遗迹，击破十五波机械军团。',
    threat: 'EXTREME',
    enemy: 'MACHINE LEGION',
  }),
]);

export const DEFAULT_STAGE_ID = 'outpost-07';

/** 1-based stage index → stage definition (or null). */
export function getStageByIndex(index) {
  const n = Math.max(1, Math.round(Number(index) || 1));
  return STAGES.find((stage) => stage.index === n) || null;
}

/** Stage id → stage definition (or null). */
export function getStage(stageId) {
  if (!stageId) return null;
  return STAGES.find((stage) => stage.id === stageId) || null;
}

/** The stage after `stageId` (by index), or null at the end of the campaign. */
export function nextStage(stageId) {
  const stage = getStage(stageId);
  if (!stage) return null;
  return getStageByIndex(stage.index + 1);
}

export function nextStageIdAfter(stageId) {
  const stage = nextStage(stageId);
  return stage ? stage.id : null;
}

/** Total number of configured stages. */
export const STAGE_TOTAL = STAGES.length;

/**
 * Wave list of a stage (accepts the stage def or its id).
 * Falls back to the stage's mapId / default wave set when the stage has no
 * dedicated wave list yet.
 */
export function stageWaves(stageOrId) {
  const stage = typeof stageOrId === 'string' ? getStage(stageOrId) : stageOrId;
  if (!stage) return STAGE_WAVES[DEFAULT_WAVE_SET] || [];
  return STAGE_WAVES[stage.waveSet || stage.mapId] || STAGE_WAVES[DEFAULT_WAVE_SET] || [];
}

/** Number of waves in a stage (accepts id or def). */
export function stageWaveCount(stageOrId) {
  const stage = typeof stageOrId === 'string' ? getStage(stageOrId) : stageOrId;
  if (stage && stage.waveSet) return waveCountForStage(stage.waveSet);
  return stageWaves(stageOrId).length;
}

/** First stage of the campaign (index 1). */
export function firstStage() {
  return getStageByIndex(1);
}
