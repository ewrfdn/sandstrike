/**
 * SCATTER-9 — scout chassis (ROBOT_TYPES.scout).
 *
 * Split out of src/enemies.js by the model-split refactor.  `def` is the
 * original ROBOT_TYPES entry verbatim; the hooks below are the type-specific
 * branches that used to live in the if/else chains of buildTorso / buildHead /
 * buildArm / buildLeg / buildGun / buildRobotRig.  Primitive arguments and
 * emission order are unchanged — the generic builders in shared.js call the
 * hook at the exact position the old branch sat at.
 */

export const meta = { id: 'robot-scout', kind: 'robot', group: 'robots', label: 'SCATTER-9 · 侦察机', type: 'scout', defaultPose: 'base' };

/** The original ROBOT_TYPES entry (gameplay stats + model dimensions), verbatim. */
export const def = {
  key: 'scout',
  name: 'SCATTER-9',
  displayName: 'SCATTER-9 // 散射侦察机',
  hp: 40,
  radius: 0.52,
  height: 2.2,
  speed: 4.35,
  stride: 1.2,
  score: 100,
  resist: 1.0,
  staggerResist: 0,
  eyeHeight: 2.0,
  ranges: { min: 4.5, ideal: 9, max: 17 },
  fire: { shots: 3, interval: 0.13, cooldown: 1.2, telegraph: 0.42, damage: 6, accuracy: 0.62, mag: 12, reload: 1.9 },
  gun: { scale: 0.8 },
  palette: { armor: 0x59656d, dark: 0x24292d, trim: 0x8d5b34, gun: 0x2d3338, visor: 0x6fe8ff, tracer: 0x9ff2ff },
  model: {
    hipY: 1.14, hipX: 0.17, pelvisW: 0.36, pelvisH: 0.26, pelvisD: 0.3,
    torsoPivotY: 0.1, chestW: 0.5, chestH: 0.64, chestD: 0.34, chestY: 0.34,
    neckY: 0.72, shoulderX: 0.31, shoulderY: 0.55,
    headW: 0.27, headH: 0.26, headD: 0.3, headY: 0.13,
    armUpper: 0.32, armFore: 0.34, armW: 0.1, armBendR: 1.32, armBendL: 1.05,
    legThigh: 0.5, legShin: 0.5, legW: 0.17, footL: 0.42, footW: 0.22, footH: 0.14,
  },
};

/** buildTorso() — high angular shoulder fins on dark mounting brackets. */
function torso(b, M, def, ctx) {
  const { cw, ch, cd, cy } = ctx;
  // high angular shoulder fins, single-boom sensor mast.  The fins lean
  // outboard-down and their lower end used to hang in the air ~4 cm outboard
  // of the shoulder plate (blue-backdrop pass showed the gap); they are
  // pulled 0.04cw inboard and mounted on a small dark bracket that bridges the
  // shoulder armour to the fin root.
  for (const side of [-1, 1]) {
    b.box('armor', 0.035, ch * 0.36, cd * 0.36, side * (M.shoulderX + cw * 0.16), M.shoulderY + ch * 0.34, 0.02, 0, 0, side * 0.55);
    b.box('trim', 0.02, ch * 0.2, cd * 0.2, side * (M.shoulderX + cw * 0.22), M.shoulderY + ch * 0.5, 0.02, 0, 0, side * 0.55);
    b.box('dark', cw * 0.16, ch * 0.2, cd * 0.36, side * (M.shoulderX + cw * 0.25), M.shoulderY + ch * 0.16, 0.02);
  }
  b.beam('trim', cw * 0.22, cy + ch * 0.34, cd * 0.4, cw * 0.3, cy + ch * 0.56, cd * 0.62, 0.014);
  b.sphere('core', 0.022, cw * 0.3, cy + ch * 0.56, cd * 0.62);
}

/** buildHead() — twin sensor booms + brow fin. */
function head(b, M, def, ctx) {
  const { w, h, d, y } = ctx;
  b.beam('trim', -w * 0.3, y + h * 0.5, d * 0.1, -w * 0.52, y + h * 1.15, d * 0.4, 0.012);
  b.sphere('core', 0.016, -w * 0.52, y + h * 1.15, d * 0.4);
  b.beam('trim', w * 0.34, y + h * 0.36, d * 0.06, w * 0.6, y + h * 0.82, d * 0.3, 0.01);
  b.sphere('core', 0.013, w * 0.6, y + h * 0.82, d * 0.3);
  // sensor fin on brow
  b.box('trim', 0.02, h * 0.3, d * 0.36, 0, y + h * 0.72, d * 0.02, 0, 0, 0);
}

/** buildArm() — forearm trim fin. */
function arm(b, M, def, side, ctx) {
  const { aw, dirY, dirZ, elbowY, handY, handZ, midY, midZ } = ctx;
  b.box('trim', aw * 0.28, aw * 0.5, aw * 0.2, side * (aw * 0.75), midY, midZ, 0, 0, side * 0.3);
}

export const hooks = { torso, head, arm };
