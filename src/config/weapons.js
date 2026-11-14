/**
 * Weapon stat blocks — the single source of truth for how every firearm in the
 * game shoots. Models live in `src/models/weapons/<id>.js`; `WeaponSystem`
 * (src/weapons.js) merges these numbers into the model handles at runtime.
 *
 * Four weapons ship today:
 *   vxr7     VXR-7 assault rifle   — the campaign starting weapon
 *   rpg      RPG-7 launcher        — explosive projectile + splash damage
 *   gatling  M-77 gatling          — spin-up, 1100 rpm suppression
 *   shotgun  SG-12 pump shotgun    — 8 pellets, distance falloff
 *
 * Only the boss drops weapons (5% by default — see CONFIG.loot in game.js), and
 * the player can carry at most MAX_WEAPON_SLOTS (4) at once.
 *
 * Common fields:
 *   mode            'auto' | 'rocket' | 'pump' | 'spinup'
 *   damage          per bullet / per pellet / direct rocket damage
 *   rpm             rounds per minute (automatic weapons)
 *   magSize         rounds in a full magazine
 *   reserveStart    starting reserve ammo
 *   reserveMax      reserve ammo ceiling
 *   reloadTime      seconds for a full reload
 *   spreadHip/Ads/Move/Max  radians (spreadMax caps accumulated bloom)
 *   adsFov          camera FOV while aiming down sights
 *   headshotMultiplier / limbMultiplier  zone damage multipliers
 *   ammoScale       supply conversion: pickups/wave bonuses are multiplied by this
 *                   (a base 40-round cache = 40 × ammoScale rounds of this weapon)
 *   recoil          { pitch, yaw, kick } camera/recoil impulses
 *   moveSpeedMul    player movement multiplier while equipped (default 1)
 *
 * Mode-specific:
 *   rocket   splashDamage / splashRadius / splashFalloff / projectileSpeed /
 *            projectileMaxRange / projectileGravity / selfDamage / selfDamageScale
 *   pump     pellets / pumpTime / range / falloffStart / falloffEnd / falloffMin
 *   spinup   spinUpTime / spinDownTime / spinFireThreshold
 *   auto     (none)
 */
export const DEFAULT_WEAPON_ID = 'vxr7';

/** Maximum weapons the player can carry at once (boss drops fill empty slots). */
export const MAX_WEAPON_SLOTS = 4;

/** Stable slot order = HUD key hints 1..4. */
export const WEAPON_ORDER = Object.freeze(['vxr7', 'rpg', 'gatling', 'shotgun']);

export const WEAPON_STATS = Object.freeze({
  vxr7: Object.freeze({
    id: 'vxr7',
    name: 'VXR-7 突击步枪',
    short: 'VXR-7',
    mode: 'auto',
    description: '全能自动步枪，爆头 2.3 倍伤害。',
    damage: 25,
    rpm: 640,
    magSize: 30,
    reserveStart: 300,
    reserveMax: 420,
    reloadTime: 2.05,
    spreadHip: 0.014,
    spreadAds: 0.0028,
    spreadMove: 0.018,
    spreadMax: 0.055,
    adsFov: 48,
    headshotMultiplier: 2.3,
    limbMultiplier: 0.72,
    recoil: Object.freeze({ pitch: 0.0075, yaw: 0.0032, kick: 0.045 }),
    ammoScale: 1,
    moveSpeedMul: 1,
    tracerColor: 0xffd58a,
  }),
  rpg: Object.freeze({
    id: 'rpg',
    name: 'RPG-7 火箭筒',
    short: 'RPG-7',
    mode: 'rocket',
    description: '单发火箭，命中点范围爆炸；对集群与 Boss 极为有效。',
    damage: 150,
    splashDamage: 90,
    splashRadius: 4.6,
    splashFalloff: 0.5,
    projectileSpeed: 62,
    projectileMaxRange: 120,
    projectileGravity: 0,
    selfDamage: false,
    selfDamageScale: 0.5,
    rpm: 45,
    magSize: 1,
    reserveStart: 3,
    reserveMax: 6,
    reloadTime: 3.1,
    spreadHip: 0.012,
    spreadAds: 0.004,
    spreadMove: 0.02,
    spreadMax: 0.05,
    adsFov: 55,
    headshotMultiplier: 1.0,
    limbMultiplier: 1.0,
    recoil: Object.freeze({ pitch: 0.034, yaw: 0.006, kick: 0.16 }),
    ammoScale: 0.025,
    moveSpeedMul: 0.94,
    tracerColor: 0xff9a55,
    // Bulky launcher: the rear venturi bell sits ~0.2 m from the eye at the shared
    // ADS anchor and fills the lower third. Pull it back and right so the bell
    // clears the centre of the frame and the support forearm is visible; hip keeps
    // the shared default pose.
    viewmodel: Object.freeze({
      ads: Object.freeze({ x: 0.18, y: -0.08, z: -0.72 }),
    }),
  }),
  gatling: Object.freeze({
    id: 'gatling',
    name: 'M-77 加特林机枪',
    short: 'M-77',
    mode: 'spinup',
    description: '转管机枪：按住扳机预转，随后 1150 RPM 持续压制。',
    damage: 18,
    rpm: 1150,
    spinUpTime: 0.55,
    spinDownTime: 0.9,
    spinFireThreshold: 0.45,
    magSize: 200,
    reserveStart: 600,
    reserveMax: 1200,
    reloadTime: 4.2,
    spreadHip: 0.026,
    spreadAds: 0.012,
    spreadMove: 0.03,
    spreadMax: 0.075,
    adsFov: 58,
    headshotMultiplier: 1.6,
    limbMultiplier: 0.8,
    recoil: Object.freeze({ pitch: 0.0042, yaw: 0.0042, kick: 0.03 }),
    ammoScale: 2,
    moveSpeedMul: 0.86,
    tracerColor: 0xffb45a,
    // Heavy cradle: hold it a little higher/further out and back so the forearm
    // no longer slices the right frame edge and the hands read as gripping.
    viewmodel: Object.freeze({
      hip: Object.freeze({ x: 0.19, y: -0.05, z: -0.66 }),
      ads: Object.freeze({ x: 0.03, y: -0.08, z: -0.64 }),
    }),
  }),
  shotgun: Object.freeze({
    id: 'shotgun',
    name: 'SG-12 战术霰弹枪',
    short: 'SG-12',
    mode: 'pump',
    description: '泵动霰弹：8 枚弹丸近距爆发，远距离伤害衰减。',
    damage: 13,
    pellets: 8,
    rpm: 75,
    pumpTime: 0.5,
    range: 45,
    falloffStart: 8,
    falloffEnd: 30,
    falloffMin: 0.35,
    magSize: 6,
    reserveStart: 48,
    reserveMax: 72,
    reloadTime: 2.6,
    spreadHip: 0.055,
    spreadAds: 0.038,
    spreadMove: 0.02,
    spreadMax: 0.09,
    adsFov: 55,
    headshotMultiplier: 1.8,
    limbMultiplier: 0.85,
    recoil: Object.freeze({ pitch: 0.022, yaw: 0.005, kick: 0.12 }),
    ammoScale: 0.2,
    moveSpeedMul: 0.97,
    tracerColor: 0xffd9a0,
    // Long pump gun: pull the stock slightly out/back/up in both poses so the
    // forearm enters from the frame corner instead of slicing the right edge.
    viewmodel: Object.freeze({
      hip: Object.freeze({ x: 0.18, y: -0.06, z: -0.68 }),
      ads: Object.freeze({ x: 0.03, y: -0.05, z: -0.66 }),
    }),
  }),
});

/** Resolve a weapon stat block; unknown / missing ids fall back to the VXR-7. */
export function getWeaponStats(id) {
  return WEAPON_STATS[id] || WEAPON_STATS[DEFAULT_WEAPON_ID];
}

/** 0-based stable slot index of a weapon id (-1 when unknown). */
export function weaponSlotIndex(id) {
  return WEAPON_ORDER.indexOf(id);
}

/** All stat blocks in HUD slot order. */
export function weaponStatsInOrder() {
  return WEAPON_ORDER.map((id) => WEAPON_STATS[id]).filter(Boolean);
}

/**
 * Supply conversion: base ammo amount (wave bonuses, ammo caches) → rounds for
 * this weapon type. Always at least 1 round when the base amount is positive.
 */
export function convertSupplyAmmo(id, baseAmount) {
  const stats = getWeaponStats(id);
  const raw = Math.max(0, Number(baseAmount) || 0) * (Number(stats.ammoScale) || 1);
  if (raw <= 0) return 0;
  return Math.max(1, Math.round(raw));
}
