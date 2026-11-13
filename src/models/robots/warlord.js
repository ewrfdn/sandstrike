/**
 * KHARON-Ω — warlord chassis (ROBOT_TYPES.warlord).
 *
 * Split out of src/enemies.js by the model-split refactor.  `def` is the
 * original ROBOT_TYPES entry verbatim; the hooks below are the type-specific
 * branches that used to live in the if/else chains of buildTorso / buildHead /
 * buildArm / buildLeg / buildGun / buildRobotRig.  Primitive arguments and
 * emission order are unchanged — the generic builders in shared.js call the
 * hook at the exact position the old branch sat at.
 */

import { addHeavyGunExtras, addLeftArmCannon } from './shared.js';

export const meta = { id: 'robot-warlord', kind: 'robot', group: 'robots', label: 'KHARON-Ω · 监军', type: 'warlord', defaultPose: 'base' };

/** The original ROBOT_TYPES entry (gameplay stats + model dimensions), verbatim. */
export const def = {
  key: 'warlord',
  name: 'KHARON-Ω',
  displayName: 'KHARON-Ω // 卡戎监军',
  hp: 320,
  radius: 0.95,
  height: 4.05,
  speed: 2.35,
  stride: 1.7,
  score: 1500,
  resist: 0.85,
  staggerResist: 0.72,
  eyeHeight: 3.35,
  boss: true,
  ranges: { min: 8, ideal: 14, max: 26 },
  fire: { shots: 8, interval: 0.11, cooldown: 2.2, telegraph: 0.9, damage: 10, accuracy: 0.55, mag: 16, reload: 3.0 },
  gun: { scale: 1.95 },
  palette: { armor: 0x3a3436, dark: 0x1b181a, trim: 0xd8a33c, gun: 0x2b2627, visor: 0xff2f26, tracer: 0xff7a4a },
  model: {
    hipY: 1.8, hipX: 0.37, pelvisW: 0.8, pelvisH: 0.5, pelvisD: 0.6,
    torsoPivotY: 0.16, chestW: 1.32, chestH: 1.24, chestD: 0.8, chestY: 0.64,
    neckY: 1.32, shoulderX: 0.8, shoulderY: 0.96,
    headW: 0.4, headH: 0.36, headD: 0.42, headY: 0.18,
    armUpper: 0.52, armFore: 0.58, armW: 0.25, armBendR: 1.4, armBendL: 1.1,
    legThigh: 0.76, legShin: 0.82, legW: 0.38, footL: 0.74, footW: 0.5, footH: 0.22,
  },
};

/** buildTorso() — shoulder towers with reactor lights, gold trim + rear cape plates. */
function torso(b, M, def, ctx) {
  const { cw, ch, cd, cy } = ctx;
  // shoulder towers with reactor lights, gold trim, rear cape plates.
  // The towers used to sit at +0.46ch, which left their underside ~3.5 cm
  // above the chest top plate / shoulder armour and fully outboard of both
  // (blue-backdrop test showed the scene through the gap).  They are lowered
  // by 0.06ch so the tower underside is embedded in the shoulder mass; the
  // cap / core light / horn beams move down with them so the assembly stays
  // rigid.
  for (const side of [-1, 1]) {
    b.box('armor', cw * 0.3, ch * 0.44, cd * 0.72, side * (M.shoulderX + cw * 0.06), M.shoulderY + ch * 0.4, 0.03, 0, 0, side * -0.1);
    b.box('trim', cw * 0.32, ch * 0.08, cd * 0.76, side * (M.shoulderX + cw * 0.06), M.shoulderY + ch * 0.63, 0.03);
    b.box('core', cw * 0.12, ch * 0.12, 0.03, side * (M.shoulderX + cw * 0.06), M.shoulderY + ch * 0.44, -cd * 0.4);
    b.beam('trim', side * (M.shoulderX + cw * 0.06), M.shoulderY + ch * 0.64, -cd * 0.1, side * (M.shoulderX + cw * 0.16), M.shoulderY + ch * 0.94, -cd * 0.24, 0.022);
    b.sphere('core', 0.035, side * (M.shoulderX + cw * 0.16), M.shoulderY + ch * 0.94, -cd * 0.24);
  }
  b.cyl('trim', cw * 0.21, 0.05, 0, cy + ch * 0.08, -cd * 0.57, Math.PI / 2, 0, 0);
  b.sphere('core', cw * 0.11, 0, cy + ch * 0.08, -cd * 0.61);
  b.box('trim', cw * 0.96, 0.03, 0.026, 0, cy + ch * 0.35, -cd * 0.54);
  b.box('trim', cw * 0.9, 0.026, 0.026, 0, cy - ch * 0.3, -cd * 0.55);
  for (let i = -1; i <= 1; i++) {
    b.box('armor', cw * 0.26, ch * 0.62, 0.045, i * cw * 0.3, cy - ch * 0.2, cd * 0.63, 0.16, 0, 0);
  }
  b.beam('trim', 0, cy + ch * 0.52, cd * 0.4, 0, cy + ch * 0.88, cd * 0.58, 0.032);
}

/** buildHead() — crown of horns + gold brow bar. */
function head(b, M, def, ctx) {
  const { w, h, d, y } = ctx;
  // crown of horns
  for (let i = -1; i <= 1; i++) {
    b.beam('trim', i * w * 0.3, y + h * 0.5, d * 0.05, i * w * 0.5, y + h * 1.18, d * 0.3, 0.026);
    b.sphere('core', 0.028, i * w * 0.5, y + h * 1.18, d * 0.3);
  }
  b.box('trim', w * 1.06, h * 0.12, d * 0.6, 0, y + h * 0.34, -d * 0.3, 0.1, 0, 0);
  b.box('core', w * 0.86, h * 0.035, 0.02, 0, y + h * 0.08, -d * 0.585);
}

/** buildArm() — left forearm armoured cannon / ram shield (shared with heavy). */
function arm(b, M, def, side, ctx) {
  if (side < 0) addLeftArmCannon(b, M, ctx);
}

/** buildGun() — extra barrels + heavier shroud (shared with heavy) and a top rail. */
function gun(b, M, def, metrics) {
  addHeavyGunExtras(b, metrics);

  const { s, bodyW, bodyH, bodyL, barrelLen, bodyCenterZ, barrelCenterZ, tipZ } = metrics;
  b.box('trim', bodyW * 1.7, 0.03 * s, bodyL * 0.8, 0, 0.045 * s + bodyH * 0.62, bodyCenterZ);
  b.sphere('accent', 0.05 * s, 0, 0.045 * s + bodyH * 0.72, bodyCenterZ - 0.1 * s);
}

/** buildRobotRig() — shoulder-tower hitboxes (torso zone). */
function hitboxes(addHit, torso, M, def) {
  for (const side of [-1, 1]) {
    addHit('torso', torso,
      M.chestW * 0.34, M.chestH * 0.54, M.chestD * 0.8,
      side * (M.shoulderX + M.chestW * 0.06), M.shoulderY + M.chestH * 0.44, 0.03);
  }
}

export const hooks = { torso, head, arm, gun, hitboxes };
