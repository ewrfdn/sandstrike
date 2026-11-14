/**
 * Enemy combat stats — the single source of truth for how much damage a robot
 * deals and soaks, kept OUT of the chassis model modules in
 * `src/models/robots/`.
 *
 * A model module owns geometry, rig dimensions, palette, AI ranges and the fire
 * pattern (shots / interval / cooldown / telegraph / accuracy / mag / reload).
 * Everything that directly decides combat numbers lives here, so balance passes
 * touch one file instead of five:
 *
 *   hp      base health pool before the per-wave growth in
 *           `src/enemies.js` waveMods() (`1 + 0.035 × waveIndex`).
 *   damage  per-bullet damage dealt to the player, before the per-wave damage
 *           growth (`1 + 0.032 × waveIndex`).
 *
 * The chassis registry (`src/models/robots/index.js`) merges these values into
 * each `def`, so runtime code keeps using `def.hp` / `def.fire.damage`.
 *
 * Values are keyed by the chassis `def.key` and must cover every ROBOT_TYPES
 * entry — a missing key throws at module load.
 */
export const ENEMY_STATS = Object.freeze({
  // base hp was 40 / 65 / 120 / 320 / 1400; tripled by the balance pass.
  scout: Object.freeze({ hp: 120, damage: 6 }),
  rifleman: Object.freeze({ hp: 195, damage: 8 }),
  heavy: Object.freeze({ hp: 360, damage: 9 }),
  warlord: Object.freeze({ hp: 960, damage: 10 }),
  /**
   * SIEGE WARDEN (ROBOT_TYPES.boss) — spawns on every 5th wave (5 / 10 / 15)
   * and replaces the warlord. Tuned for a STANDARD-difficulty VXR-7 fight:
   *
   *   wave 5  hp = 1900 × waveMods(5) 1.14 × difficulty 1.0  = 2166
   *   wave 10 hp = 1900 × 1.315                             = 2499
   *   wave 15 hp = 1900 × 1.49                              = 2831
   *
   * The boss chassis soaks 0.6 × body-shot damage (see resist in
   * src/models/robots/boss.js), i.e. 15 per VXR-7 round. Body-shot TTK at
   * 640 rpm with 30-round mags / 2.05 s reloads (see
   * .scratch/features/boss-waves/ttk.mjs):
   *
   *   wave 5 boss only            ≈ 22 s   (145 rounds, 4 reloads)
   *   wave 5 boss + escorts       ≈ 44 s   (275 rounds, 9 reloads)  ← target window
   *   wave 10 boss + escorts      ≈ 59 s
   *   wave 15 boss + escorts      ≈ 76 s
   *
   * Headshots (×2.3, ignore resist) and the RPG shorten those times; missed
   * shots stretch them, so the intended 25-45 s opening boss fight lands for a
   * player who keeps most of their magazine on the torso. Nightmare (hp ×4) is
   * deliberately a long siege.
   */
  boss: Object.freeze({ hp: 1900, damage: 26 }),
});
