/**
 * VULTURE-3 — rifleman chassis (ROBOT_TYPES.rifleman).
 *
 * Split out of src/enemies.js by the model-split refactor.  `def` is the
 * original ROBOT_TYPES entry verbatim; the hooks below are the type-specific
 * branches that used to live in the if/else chains of buildTorso / buildHead /
 * buildArm / buildLeg / buildGun / buildRobotRig.  Primitive arguments and
 * emission order are unchanged — the generic builders in shared.js call the
 * hook at the exact position the old branch sat at.
 */

export const meta = { id: 'robot-rifleman', kind: 'robot', group: 'robots', label: 'VULTURE-3 · 步枪机', type: 'rifleman', defaultPose: 'base' };

/** The original ROBOT_TYPES entry (gameplay stats + model dimensions), verbatim. */
export const def = {
  key: 'rifleman',
  name: 'VULTURE-3',
  displayName: 'VULTURE-3 // 秃鹫步枪机',
  hp: 65,
  radius: 0.58,
  height: 2.55,
  speed: 3.6,
  stride: 1.35,
  score: 150,
  resist: 1.0,
  staggerResist: 0.1,
  eyeHeight: 2.33,
  ranges: { min: 5.5, ideal: 11, max: 22 },
  fire: { shots: 4, interval: 0.135, cooldown: 1.4, telegraph: 0.5, damage: 8, accuracy: 0.58, mag: 8, reload: 2.2 },
  gun: { scale: 1.0 },
  palette: { armor: 0x746049, dark: 0x2a2622, trim: 0xa9763f, gun: 0x332e28, visor: 0xffb44a, tracer: 0xffd28a },
  model: {
    hipY: 1.3, hipX: 0.2, pelvisW: 0.46, pelvisH: 0.3, pelvisD: 0.36,
    torsoPivotY: 0.12, chestW: 0.7, chestH: 0.76, chestD: 0.44, chestY: 0.38,
    neckY: 0.86, shoulderX: 0.43, shoulderY: 0.62,
    headW: 0.31, headH: 0.3, headD: 0.34, headY: 0.15,
    armUpper: 0.36, armFore: 0.4, armW: 0.13, armBendR: 1.3, armBendL: 1.02,
    legThigh: 0.58, legShin: 0.58, legW: 0.21, footL: 0.48, footW: 0.27, footH: 0.14,
  },
};

/** buildTorso() — ammo-drum backpack + chunkier shoulder plates. */
function torso(b, M, def, ctx) {
  const { cw, ch, cd, cy } = ctx;
  // ammo drum backpack + chunkier shoulder plates
  b.cyl('dark', cd * 0.26, cw * 0.36, 0, cy + ch * 0.04, cd * 0.72, 0, 0, Math.PI / 2);
  b.box('trim', cw * 0.18, ch * 0.1, cd * 0.2, 0, cy + ch * 0.22, cd * 0.68);
  for (const side of [-1, 1]) {
    b.box('armor', cw * 0.09, ch * 0.32, cd * 0.74, side * (M.shoulderX + cw * 0.16), M.shoulderY + ch * 0.02, 0, 0, 0, side * 0.18);
    b.box('core', cw * 0.12, 0.02, 0.02, side * (M.shoulderX + cw * 0.14), M.shoulderY + ch * 0.16, -cd * 0.42);
  }
}

/** buildHead() — sensor boom + rear antenna dish. */
function head(b, M, def, ctx) {
  const { w, h, d, y } = ctx;
  b.beam('trim', w * 0.4, y + h * 0.4, 0, w * 0.62, y + h * 1.0, d * 0.34, 0.014);
  b.sphere('core', 0.018, w * 0.62, y + h * 1.0, d * 0.34);
  b.cyl('dark', h * 0.14, 0.05, w * 0.3, y + h * 0.4, -d * 0.5, Math.PI / 2, 0, 0);
}

/** buildRobotRig() — backpack ammo-drum hitbox (sits outside the torso slab). */
function hitboxes(addHit, torso, M, def) {
  // backpack ammo drum: compact solid volume, torso zone like the backpack
  addHit('torso', torso,
    M.chestW * 0.4, M.chestH * 0.32, M.chestD * 0.55,
    0, M.chestY + M.chestH * 0.04, M.chestD * 0.72);
}

export const hooks = { torso, head, hitboxes };
