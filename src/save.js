/**
 * SANDSTRIKE // 沙暴协议 — campaign save / progression system.
 *
 * Pure data module (no THREE, no DOM): `src/main.js` is the only WRITER, the UI
 * panels read it to render the campaign / stage-select screens.
 *
 * Design rules (user-approved):
 *   - ONE independent save slot PER configured stage (`src/config/stages.js`),
 *     i.e. 5 stages = 5 save slots + 5 unlock flags, generated automatically.
 *   - The save is written ONLY when a stage is entered (`recordStageStart`) or
 *     when a stage ends / is cleared (`recordStageEnd`). Death, pause, going back
 *     to the menu and mid-stage abandonment never touch localStorage.
 *   - Stage N's starting run state inherits the END state of stage N-1 (guns,
 *     per-weapon upgrades, armor/health bonuses, damage reduction). The first
 *     stage starts from the base loadout.
 *   - A stage in progress keeps its own start snapshot, so "REDEPLOY" / a page
 *     reload resumes from exactly the state the stage started with (no stacking).
 *
 * localStorage: `sandstrike.progress.v2`.
 */
import {
  STAGES,
  getStage,
  getStageByIndex,
  nextStage,
} from './config/stages.js';
import { DEFAULT_DIFFICULTY_ID, isDifficultyId } from './config/difficulty.js';
import {
  DEFAULT_WEAPON_ID,
  MAX_WEAPON_SLOTS,
  WEAPON_ORDER,
  convertSupplyAmmo,
} from './config/weapons.js';

export const SAVE_KEY = 'sandstrike.progress.v2';
export const SAVE_VERSION = 2;

/** Clamp a number into [min, max], using `fallback` for non-finite input. */
function clampNum(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizePerWeapon(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    magExtension: Math.round(clampNum(raw.magExtension, 0, 90, 0)),
    damageMultiplier: clampNum(raw.damageMultiplier, 1, 4, 1),
    reloadSpeedMul: clampNum(raw.reloadSpeedMul, 0.35, 1, 1),
  };
}

/** Fresh starting run state for a stage (base loadout). */
export function emptyRunState(difficultyId = DEFAULT_DIFFICULTY_ID) {
  return {
    difficulty: isDifficultyId(difficultyId) ? difficultyId : DEFAULT_DIFFICULTY_ID,
    weapons: {
      owned: [DEFAULT_WEAPON_ID],
      active: DEFAULT_WEAPON_ID,
      perWeapon: {},
    },
    player: { armorBonus: 0, healthBonus: 0, damageReduction: 0 },
    score: 0,
  };
}

/** Validate + clamp a run-state snapshot coming from a save or from gameplay. */
export function sanitizeRunState(raw) {
  const base = emptyRunState(raw && raw.difficulty);
  if (!raw || typeof raw !== 'object') return base;
  base.difficulty = isDifficultyId(raw.difficulty) ? raw.difficulty : DEFAULT_DIFFICULTY_ID;

  const weapons = raw.weapons && typeof raw.weapons === 'object' ? raw.weapons : {};
  const owned = [];
  if (Array.isArray(weapons.owned)) {
    for (const id of weapons.owned) {
      if (typeof id !== 'string' || !WEAPON_ORDER.includes(id) || owned.includes(id)) continue;
      owned.push(id);
      if (owned.length >= MAX_WEAPON_SLOTS) break;
    }
  }
  if (!owned.includes(DEFAULT_WEAPON_ID)) owned.unshift(DEFAULT_WEAPON_ID);
  base.weapons.owned = owned.slice(0, MAX_WEAPON_SLOTS);
  base.weapons.active = owned.includes(weapons.active) ? weapons.active : base.weapons.owned[0];
  const perWeapon = weapons.perWeapon && typeof weapons.perWeapon === 'object' ? weapons.perWeapon : {};
  for (const id of base.weapons.owned) {
    const entry = sanitizePerWeapon(perWeapon[id]);
    if (entry) base.weapons.perWeapon[id] = entry;
  }

  const player = raw.player && typeof raw.player === 'object' ? raw.player : {};
  base.player.armorBonus = Math.round(clampNum(player.armorBonus, 0, 300, 0));
  base.player.healthBonus = Math.round(clampNum(player.healthBonus, 0, 300, 0));
  base.player.damageReduction = clampNum(player.damageReduction, 0, 0.6, 0);
  base.score = Math.max(0, Math.round(clampNum(raw.score, 0, 1e9, 0)));
  return base;
}

function sanitizeStats(raw) {
  const stats = raw && typeof raw === 'object' ? raw : {};
  return {
    score: Math.max(0, Math.round(clampNum(stats.score, 0, 1e9, 0))),
    wave: Math.max(1, Math.round(clampNum(stats.wave, 1, 999, 1))),
    kills: Math.max(0, Math.round(clampNum(stats.kills, 0, 1e6, 0))),
    headshots: Math.max(0, Math.round(clampNum(stats.headshots, 0, 1e6, 0))),
    accuracy: clampNum(stats.accuracy, 0, 1, 0),
    time: Math.max(0, clampNum(stats.time, 0, 1e7, 0)),
    bestCombo: Math.max(0, Math.round(clampNum(stats.bestCombo, 0, 1e6, 0))),
    difficulty: isDifficultyId(stats.difficulty) ? stats.difficulty : DEFAULT_DIFFICULTY_ID,
    completedAt: Number.isFinite(Number(stats.completedAt)) ? Number(stats.completedAt) : Date.now(),
  };
}

function makeStageRecord(stage) {
  return {
    id: stage.id,
    index: stage.index,
    mapId: stage.mapId,
    name: stage.name,
    subtitle: stage.subtitle || '',
    unlocked: !!stage.unlockedByDefault,
    cleared: false,
    clears: 0,
    bestScore: 0,
    difficulty: null,
    createdAt: null,
    clearedAt: null,
    /** Snapshot of the run state this stage was entered with. */
    start: null,
    /** Snapshot of the run state the stage ended with (cleared runs only). */
    end: null,
  };
}

/** A brand-new campaign with every configured stage registered (all locked but the first). */
export function createEmptyProgress() {
  const now = Date.now();
  const stages = {};
  for (const stage of STAGES) stages[stage.id] = makeStageRecord(stage);
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    lastStageId: null,
    lastDifficulty: DEFAULT_DIFFICULTY_ID,
    stages,
  };
}

function sanitizeProgress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version !== SAVE_VERSION) return null;
  if (!raw.stages || typeof raw.stages !== 'object') return null;
  const progress = createEmptyProgress();
  progress.createdAt = clampNum(raw.createdAt, 0, Number.MAX_SAFE_INTEGER, progress.createdAt);
  progress.updatedAt = clampNum(raw.updatedAt, 0, Number.MAX_SAFE_INTEGER, progress.updatedAt);
  progress.lastStageId = typeof raw.lastStageId === 'string' ? raw.lastStageId : null;
  progress.lastDifficulty = isDifficultyId(raw.lastDifficulty) ? raw.lastDifficulty : DEFAULT_DIFFICULTY_ID;

  for (const stage of STAGES) {
    const source = raw.stages[stage.id];
    if (!source || typeof source !== 'object') continue; // new stage added by a config update
    const record = progress.stages[stage.id];
    record.unlocked = record.unlocked || !!source.unlocked;
    record.cleared = !!source.cleared;
    record.clears = Math.max(0, Math.round(clampNum(source.clears, 0, 9999, 0)));
    record.bestScore = Math.max(0, Math.round(clampNum(source.bestScore, 0, 1e9, 0)));
    record.difficulty = isDifficultyId(source.difficulty) ? source.difficulty : null;
    record.createdAt = Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : null;
    record.clearedAt = Number.isFinite(Number(source.clearedAt)) ? Number(source.clearedAt) : null;
    if (source.start && typeof source.start === 'object' && source.start.run) {
      record.start = {
        savedAt: clampNum(source.start.savedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        difficulty: isDifficultyId(source.start.difficulty) ? source.start.difficulty : DEFAULT_DIFFICULTY_ID,
        run: sanitizeRunState(source.start.run),
      };
    }
    if (source.end && typeof source.end === 'object' && source.end.run) {
      record.end = {
        savedAt: clampNum(source.end.savedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        difficulty: isDifficultyId(source.end.difficulty) ? source.end.difficulty : DEFAULT_DIFFICULTY_ID,
        run: sanitizeRunState(source.end.run),
        stats: sanitizeStats(source.end.stats),
      };
    }
  }
  // A cleared stage must stay unlocked even if a hand-edited save says otherwise.
  for (const stage of STAGES) {
    if (progress.stages[stage.id].cleared) progress.stages[stage.id].unlocked = true;
  }
  return progress;
}

/** Read the campaign save. Returns null when there is no (valid) save. */
export function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return sanitizeProgress(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The ONLY localStorage writer for progression. */
export function saveProgress(progress) {
  if (!progress) return null;
  progress.updatedAt = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
  } catch {
    /* private mode / quota — the session still works, it just cannot persist */
  }
  return progress;
}

/** Wipe the campaign save (new game). */
export function clearProgress() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/** True when a stage has any progression data (start or end snapshot). */
export function hasStageSave(progress, stageId) {
  const record = progress && progress.stages ? progress.stages[stageId] : null;
  return !!(record && (record.start || record.end || record.cleared));
}

/** UI-friendly stage list (sorted by index). Always returns every configured stage. */
export function stageRecords(progress) {
  const source = progress || createEmptyProgress();
  return STAGES.map((stage) => {
    const record = source.stages[stage.id] || makeStageRecord(stage);
    return {
      id: stage.id,
      index: stage.index,
      name: stage.name,
      subtitle: stage.subtitle || '',
      mapId: stage.mapId,
      threat: stage.threat || '',
      unlocked: !!record.unlocked,
      cleared: !!record.cleared,
      clears: record.clears || 0,
      bestScore: record.bestScore || 0,
      difficulty: record.difficulty || null,
      hasSave: !!(record.start || record.end),
      lastClearedAt: record.clearedAt || null,
    };
  });
}

/** The stage that "CONTINUE" should resume: last played, or the next uncleared one. */
export function continueTarget(progress) {
  if (!progress) return null;
  let stage = getStage(progress.lastStageId);
  if (!stage) {
    stage = stageRecords(progress).find((record) => record.unlocked && !record.cleared) ? getStage(
      stageRecords(progress).find((record) => record.unlocked && !record.cleared).id
    ) : null;
  }
  if (!stage) return null;
  const record = progress.stages[stage.id];
  // A cleared last stage rolls over to the next unlocked stage (campaign flow).
  if (record && record.cleared) {
    const next = nextStage(stage.id);
    if (next && progress.stages[next.id] && progress.stages[next.id].unlocked) stage = next;
  }
  const difficulty = (progress.stages[stage.id] && progress.stages[stage.id].difficulty) || progress.lastDifficulty;
  return {
    stageId: stage.id,
    stage,
    difficulty: isDifficultyId(difficulty) ? difficulty : DEFAULT_DIFFICULTY_ID,
    runState: stageStartState(progress, stage.id, difficulty),
  };
}

/**
 * Resolve the run state a stage starts with:
 *   1. the stage's own start snapshot (stage in progress — restart/redeploy is stable)
 *   2. the END snapshot of the previous stage (attribute inheritance)
 *   3. the base loadout (first stage / no previous clear)
 */
export function stageStartState(progress, stageId, difficultyId) {
  const stage = getStage(stageId);
  const difficulty = isDifficultyId(difficultyId) ? difficultyId : DEFAULT_DIFFICULTY_ID;
  if (!stage) return emptyRunState(difficulty);
  const record = progress && progress.stages ? progress.stages[stage.id] : null;
  if (record && record.start && record.start.run && !record.cleared) {
    const run = sanitizeRunState(record.start.run);
    run.difficulty = difficulty;
    return run;
  }
  const previous = getStageByIndex(stage.index - 1);
  const previousRecord = previous && progress && progress.stages ? progress.stages[previous.id] : null;
  if (previousRecord && previousRecord.cleared && previousRecord.end && previousRecord.end.run) {
    const run = sanitizeRunState(previousRecord.end.run);
    run.difficulty = difficulty;
    return run;
  }
  return emptyRunState(difficulty);
}

function ensureRecord(progress, stage) {
  if (!progress.stages[stage.id]) progress.stages[stage.id] = makeStageRecord(stage);
  return progress.stages[stage.id];
}

/**
 * Stage entry: write the stage's start snapshot + remember the current stage.
 * Caller then `saveProgress(progress)` — this is one of the two legal write moments.
 */
export function recordStageStart(progress, { stageId, difficulty, run } = {}) {
  const stage = getStage(stageId);
  if (!stage) return progress;
  const target = progress || createEmptyProgress();
  const diff = isDifficultyId(difficulty) ? difficulty : DEFAULT_DIFFICULTY_ID;
  const record = ensureRecord(target, stage);
  const runState = sanitizeRunState({ ...(run || {}), difficulty: diff });
  record.unlocked = true;
  record.difficulty = diff;
  record.start = { savedAt: Date.now(), difficulty: diff, run: runState };
  record.createdAt = record.createdAt || Date.now();
  target.lastStageId = stage.id;
  target.lastDifficulty = diff;
  return target;
}

/**
 * Stage end (cleared): write the ending snapshot, mark the stage cleared, bump
 * the best score and unlock the next configured stage.
 * Caller then `saveProgress(progress)` — the other legal write moment.
 */
export function recordStageEnd(progress, { stageId, difficulty, run, stats } = {}) {
  const stage = getStage(stageId);
  if (!stage) return progress;
  const target = progress || createEmptyProgress();
  const diff = isDifficultyId(difficulty) ? difficulty : DEFAULT_DIFFICULTY_ID;
  const record = ensureRecord(target, stage);
  const runState = sanitizeRunState({ ...(run || {}), difficulty: diff });
  const statBlock = sanitizeStats({ ...(stats || {}), difficulty: diff });
  record.unlocked = true;
  record.cleared = true;
  record.clears = (record.clears || 0) + 1;
  record.clearedAt = Date.now();
  record.bestScore = Math.max(record.bestScore || 0, statBlock.score);
  record.difficulty = diff;
  record.end = { savedAt: Date.now(), difficulty: diff, run: runState, stats: statBlock };
  target.lastStageId = stage.id;
  target.lastDifficulty = diff;
  const next = nextStage(stage.id);
  if (next) target.stages[next.id].unlocked = true;
  return target;
}

/** Persist only the last-used difficulty (used by the difficulty chooser highlight). */
export function setLastDifficulty(progress, difficultyId) {
  const target = progress || createEmptyProgress();
  target.lastDifficulty = isDifficultyId(difficultyId) ? difficultyId : DEFAULT_DIFFICULTY_ID;
  return target;
}

/**
 * Campaign summary for the main menu / stage select.
 * `hasProgress` is false for a fresh install (CONTINUE disabled, SELECT STAGE
 * still opens but locks everything but the first stage).
 */
export function summary(progress) {
  const records = stageRecords(progress);
  const hasProgress = !!progress;
  const target = hasProgress ? continueTarget(progress) : null;
  const clearedCount = records.filter((record) => record.cleared).length;
  return {
    hasProgress,
    stages: records,
    totalStages: records.length,
    clearedCount,
    lastStageId: progress ? progress.lastStageId : null,
    lastDifficulty: progress ? progress.lastDifficulty : DEFAULT_DIFFICULTY_ID,
    canContinue: !!target,
    continueStageId: target ? target.stageId : null,
    continueDifficulty: target ? target.difficulty : null,
    nextStageId: progress
      ? (() => {
        const last = getStage(progress.lastStageId);
        const next = last ? nextStage(last.id) : null;
        return next && progress.stages[next.id].unlocked ? next.id : null;
      })()
      : null,
    campaignCleared: records.length > 0 && records.every((record) => record.cleared),
    saveKey: SAVE_KEY,
  };
}

/**
 * Award ammo while converting a base supply amount into the requested weapon's
 * rounds (kept here so save/inheritance code can reason about supply scaling).
 */
export function supplyAmmoFor(weaponId, baseAmount) {
  return convertSupplyAmmo(weaponId, baseAmount);
}
