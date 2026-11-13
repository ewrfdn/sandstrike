/**
 * BULWARK-7 — heavy chassis (ROBOT_TYPES.heavy).
 *
 * Split out of src/enemies.js by the model-split refactor.  `def` is the
 * original ROBOT_TYPES entry verbatim; the hooks below are the type-specific
 * branches that used to live in the if/else chains of buildTorso / buildHead /
 * buildArm / buildLeg / buildGun / buildRobotRig.  Primitive arguments and
 * emission order are unchanged — the generic builders in shared.js call the
 * hook at the exact position the old branch sat at.
 */

import { addHeavyGunExtras, addLeftArmCannon } from './shared.js';

export const meta = { id: 'robot-heavy', kind: 'robot', group: 'robots', label: 'BULWARK-7 · 重装机', type: 'heavy', defaultPose: 'base' };

/** The original ROBOT_TYPES entry (gameplay stats + model dimensions), verbatim. */
export const def = {
  key: 'heavy',
  name: 'BULWARK-7',
  displayName: 'BULWARK-7 // 壁垒重装机',
  hp: 120,
  radius: 0.78,
  height: 3.0,
  speed: 2.6,
  stride: 1.5,
  score: 300,
  resist: 0.9,
  staggerResist: 0.5,
  eyeHeight: 2.58,
  ranges: { min: 6, ideal: 12, max: 20 },
  fire: { shots: 6, interval: 0.12, cooldown: 2.0, telegraph: 0.72, damage: 9, accuracy: 0.5, mag: 12, reload: 2.6 },
  gun: { scale: 1.75 },
  palette: { armor: 0x5a3b32, dark: 0x241d1b, trim: 0x8c4a2c, gun: 0x2c2422, visor: 0xff5a2c, tracer: 0xff9a55 },
  model: {
    hipY: 1.42, hipX: 0.29, pelvisW: 0.64, pelvisH: 0.4, pelvisD: 0.5,
    torsoPivotY: 0.14, chestW: 1.04, chestH: 0.94, chestD: 0.66, chestY: 0.46,
    neckY: 1.0, shoulderX: 0.6, shoulderY: 0.74,
    headW: 0.3, headH: 0.27, headD: 0.32, headY: 0.12,
    armUpper: 0.4, armFore: 0.48, armW: 0.21, armBendR: 1.42, armBendL: 1.12,
    legThigh: 0.62, legShin: 0.66, legW: 0.3, footL: 0.6, footW: 0.4, footH: 0.14,
  },
};

/** buildTorso() — shoulder missile pods, exhaust stacks + chest grill. */
function torso(b, M, def, ctx) {
  const { cw, ch, cd, cy } = ctx;
  // shoulder missile pods + exhausts + chest grill
  for (const side of [-1, 1]) {
    b.box('dark', cw * 0.26, ch * 0.24, cd * 0.62, side * (M.shoulderX + cw * 0.1), M.shoulderY + ch * 0.3, 0.04, 0, 0, side * -0.12);
    b.box('armor', cw * 0.31, ch * 0.14, cd * 0.7, side * (M.shoulderX + cw * 0.12), M.shoulderY + ch * 0.4, 0.04, 0, 0, side * -0.12);
    for (let i = 0; i < 3; i++) {
      b.cyl('dark', cw * 0.022, 0.06, side * (M.shoulderX + cw * 0.02) + i * cw * 0.05, M.shoulderY + ch * 0.44, -cd * 0.28, Math.PI / 2, 0, 0);
    }
    b.box('core', cw * 0.16, 0.024, 0.02, side * (M.shoulderX + cw * 0.1), M.shoulderY + ch * 0.34, -cd * 0.34);
    b.cyl('dark', cw * 0.055, ch * 0.56, side * cw * 0.32, cy + ch * 0.28, cd * 0.68, 0.16, 0, 0);
    b.cyl('core', cw * 0.042, 0.05, side * cw * 0.34, cy + ch * 0.6, cd * 0.73, 0.16, 0, 0);
  }
  for (let i = -2; i <= 2; i++) {
    b.box('dark', cw * 0.035, ch * 0.3, 0.035, i * cw * 0.1, cy + ch * 0.08, -cd * 0.54);
  }
  b.box('trim', cw * 0.6, ch * 0.08, cd * 0.24, 0, cy - ch * 0.4, -cd * 0.28);
}

/** buildHead() — twin sensor booms + jaw grill. */
function head(b, M, def, ctx) {
  const { w, h, d, y } = ctx;
  for (const side of [-1, 1]) {
    b.beam('trim', side * w * 0.35, y + h * 0.4, d * 0.1, side * w * 0.46, y + h * 0.92, d * 0.3, 0.016);
  }
  // jaw grill
  for (let i = -1; i <= 1; i++) {
    b.box('dark', w * 0.06, h * 0.22, 0.03, i * w * 0.16, y - h * 0.42, -d * 0.5);
  }
}

/** buildArm() — left forearm armoured cannon / ram shield (shared with warlord). */
function arm(b, M, def, side, ctx) {
  if (side < 0) addLeftArmCannon(b, M, ctx);
}

/** buildGun() — twin extra barrels + heavier shroud (shared with warlord). */
function gun(b, M, def, metrics) {
  addHeavyGunExtras(b, metrics);
}

/** buildRobotRig() — shoulder missile-pod hitboxes (torso zone). */
function hitboxes(addHit, torso, M, def) {
  for (const side of [-1, 1]) {
    addHit('torso', torso,
      M.chestW * 0.34, M.chestH * 0.4, M.chestD * 0.78,
      side * (M.shoulderX + M.chestW * 0.1), M.shoulderY + M.chestH * 0.28, 0.04);
  }
}

export const hooks = { torso, head, arm, gun, hitboxes };
