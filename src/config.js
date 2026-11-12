/** Shared tunables. Keep numbers in one place where practical. */
export const CONFIG = Object.freeze({
  renderer: {
    maxPixelRatio: 1.75,
    fov: 74,
    near: 0.04,
    far: 420,
  },
  world: {
    bounds: { minX: -34, maxX: 34, minZ: -34, maxZ: 34 },
    fogColor: 0xd6a877,
    fogDensity: 0.0125,
  },
  player: {
    radius: 0.38,
    eyeHeight: 1.68,
    crouchEyeHeight: 1.18,
    standHeight: 1.82,
    crouchHeight: 1.32,
    walkSpeed: 4.7,
    sprintSpeed: 7.3,
    crouchSpeed: 2.5,
    adsSpeed: 2.7,
    accel: 42,
    airAccel: 9,
    jumpSpeed: 6.2,
    gravity: 21,
    maxHealth: 100,
    maxArmor: 100,
    healthRegenDelay: 6.5,
    healthRegenRate: 7,
    fallDamage: false,
    mouseSensitivity: 0.0022,
    maxPitch: Math.PI / 2 - 0.03,
  },
  weapon: {
    name: 'VXR-7 突击步枪',
    magSize: 30,
    reserveStart: 300,
    reserveMax: 420,
    rpm: 640,
    damage: 25,
    headshotMultiplier: 2.3,
    limbMultiplier: 0.72,
    penetration: 0,
    spreadHip: 0.014,
    spreadAds: 0.0028,
    spreadMove: 0.018,
    spreadMax: 0.055,
    recoil: { pitch: 0.0075, yaw: 0.0032, kick: 0.045 },
    reloadTime: 2.05,
    adsFov: 48,
    ammoPerKill: 0,
  },
  waves: {
    betweenTime: 6.5,
    firstDelay: 2.2,
    total: 15,
  },
  /**
   * Loot rolls are independent of the regular ammo/health drop table:
   * every destroyed robot rolls each chance once.
   */
  loot: {
    relicChance: 0.01,          // golden relic: full health+armor, +50 armor cap (rare)
    guardChance: 0.10,          // shield module: +5% incoming-damage reduction per pickup
    vitalChance: 0.05,          // vital core: +10% max health per pickup
    guardReduction: 0.05,
    vitalHealthGain: 0.10,
    damageReductionCap: 0.60,
    maxHealthCap: 500,
    maxHealthBonusCap: 300,     // persistence clamp (standard mode redeploy)
  },
  colors: {
    sand: 0xc99a62,
    accent: 0xff8a3c,
    cyan: 0x73e6ff,
    danger: 0xff4433,
  },
});
