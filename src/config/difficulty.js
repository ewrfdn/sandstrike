/**
 * Difficulty tiers — the single source of truth for how hard a stage runs.
 *
 * Difficulty only scales the ENEMIES (never the player):
 *   hpMul   multiplies every robot's health pool when it spawns
 *   dmgMul  multiplies every bullet a robot lands on the player
 *
 * The four tiers are picked when the player starts a new campaign or selects a
 * stage (never in SYSTEM CONFIG). Values are intentional and table-driven so a
 * balance pass only edits this file:
 *
 *   RECRUIT   hp ×0.5  dmg ×0.5   — sightseeing / first contact
 *   STANDARD  hp ×1.0  dmg ×0.75  — the intended first campaign
 *   VETERAN   hp ×2.0  dmg ×1.0   — loot matters, mistakes hurt
 *   NIGHTMARE hp ×4.0  dmg ×2.0   — four-stack boss health, brutal damage
 *
 * `id` is persisted in the stage save; `standard` is kept as an id so older
 * probes/links that used the pre-refactor label keep resolving to a real tier.
 */
export const DIFFICULTIES = Object.freeze([
  Object.freeze({
    id: 'recruit',
    label: 'RECRUIT',
    cn: '新兵',
    en: 'ENEMY HP ×0.5 // ENEMY DAMAGE ×0.5',
    desc: '敌人血量与伤害减半，适合熟悉地图与流程。',
    descEn: 'Enemy health and damage are halved.',
    hpMul: 0.5,
    dmgMul: 0.5,
    tone: 'easy',
    rank: 1,
  }),
  Object.freeze({
    id: 'standard',
    label: 'STANDARD',
    cn: '标准',
    en: 'ENEMY HP ×1.0 // ENEMY DAMAGE ×0.75',
    desc: '标准敌人血量，伤害略低于基准，推荐首次通关。',
    descEn: 'Normal enemy health, slightly reduced damage.',
    hpMul: 1,
    dmgMul: 0.75,
    tone: 'normal',
    rank: 2,
  }),
  Object.freeze({
    id: 'veteran',
    label: 'VETERAN',
    cn: '老兵',
    en: 'ENEMY HP ×2.0 // ENEMY DAMAGE ×1.0',
    desc: '敌人血量翻倍，满额伤害；需要善用掩体与强化。',
    descEn: 'Double enemy health at full damage.',
    hpMul: 2,
    dmgMul: 1,
    tone: 'hard',
    rank: 3,
  }),
  Object.freeze({
    id: 'nightmare',
    label: 'NIGHTMARE',
    cn: '噩梦',
    en: 'ENEMY HP ×4.0 // ENEMY DAMAGE ×2.0',
    desc: '四倍血量、双倍伤害；Boss 战极其漫长。',
    descEn: 'Quadruple enemy health at double damage.',
    hpMul: 4,
    dmgMul: 2,
    tone: 'nightmare',
    rank: 4,
  }),
]);

export const DEFAULT_DIFFICULTY_ID = 'standard';

/** True when `id` names one of DIFFICULTIES. */
export function isDifficultyId(id) {
  return DIFFICULTIES.some((tier) => tier.id === id);
}

/** Resolve a tier object; unknown / missing ids fall back to STANDARD. */
export function getDifficulty(id) {
  return DIFFICULTIES.find((tier) => tier.id === id) || DIFFICULTIES.find((tier) => tier.id === DEFAULT_DIFFICULTY_ID);
}

/** Stable list of valid ids (for save validation / UI loops). */
export const DIFFICULTY_IDS = Object.freeze(DIFFICULTIES.map((tier) => tier.id));
