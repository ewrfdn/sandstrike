/**
 * SIEGE WARDEN — siege boss chassis (ROBOT_TYPES.boss).
 *
 * Split out of src/enemies.js by the model-split refactor.  `def` is the
 * original ROBOT_TYPES entry verbatim; the hooks below are the type-specific
 * branches that used to live in the if/else chains of buildTorso / buildHead /
 * buildArm / buildLeg / buildGun / buildRobotRig.  Primitive arguments and
 * emission order are unchanged — the generic builders in shared.js call the
 * hook at the exact position the old branch sat at.
 *
 * The chassis is spawned by the wave director on every 5th wave (see
 * WAVE_RULES in src/config/waves.js); it is no longer design-only, so it is
 * part of TYPE_KEYS (rig prewarm / wave spawning) while the model catalog
 * stays unchanged.
 */

// The SIEGE WARDEN is the wave-director boss: every 5th wave spawns it via
// WAVE_RULES (src/config/waves.js). It is part of TYPE_KEYS (spawn order + rig
// prewarm) and of the model catalog, so the dev viewer can still preview it.

export const meta = { id: 'robot-boss', kind: 'robot', group: 'robots', label: 'SIEGE WARDEN · 攻城督军', type: 'boss', defaultPose: 'base' };

/** The original ROBOT_TYPES entry minus combat stats, which live in src/config/enemies.js. */
export const def = {
  key: 'boss',
  name: 'SIEGE WARDEN',
  displayName: 'SIEGE WARDEN // 攻城督军',
  radius: 1.35,
  height: 5.35,
  speed: 1.75,
  stride: 2.0,
  score: 6000,
  // 0.6 keeps a full VXR-7 magazine (30 × 25 dmg) worth ~450 effective HP, so
  // the 1900 base pool lands in the 25-45 s sustained-fight window (see the
  // tuning note in src/config/enemies.js).
  resist: 0.6,
  staggerResist: 0.92,
  eyeHeight: 4.55,
  boss: true,
  ranges: { min: 12, ideal: 20, max: 36 },
  fire: { shots: 4, interval: 0.25, cooldown: 3.2, telegraph: 1.3, accuracy: 0.5, mag: 8, reload: 4.0 },
  gun: { scale: 2.7 },
  palette: { armor: 0x574a45, dark: 0x211c1d, trim: 0xd8a33c, gun: 0x2f282a, visor: 0xff3a1f, tracer: 0xff9a55 },
  model: {
    hipY: 2.47, hipX: 0.62, pelvisW: 1.16, pelvisH: 0.68, pelvisD: 0.9,
    torsoPivotY: 0.22, chestW: 1.95, chestH: 1.66, chestD: 1.12, chestY: 0.86,
    neckY: 1.78, shoulderX: 1.05, shoulderY: 1.26,
    headW: 0.54, headH: 0.48, headD: 0.58, headY: 0.24,
    armUpper: 0.68, armFore: 0.78, armW: 0.38, armBendR: 1.46, armBendL: 1.12,
    legThigh: 1.04, legShin: 1.1, legW: 0.56, footL: 1.06, footW: 0.78, footH: 0.32,
  },
};

/** buildTorso() — siege shoulder howitzer, layered pauldrons, rear ammo drums. */
function torso(b, M, def, ctx) {
  const { cw, ch, cd, cy } = ctx;
  // SIEGE WARDEN (model study): siege chassis with a shoulder-mounted heavy
  // howitzer on the left, layered pauldrons with hazard chevrons, twin ammo
  // drums + exhaust stacks on the back and a larger chest reactor ring.
  const sy = M.shoulderY;
  const hx = -M.shoulderX * 0.92;
  const hy = sy + ch * 0.55;
  const hz = -cd * 0.05;
  const pitch = 0.085;
  const dY = (dist) => hy + Math.sin(pitch) * dist;
  const dZ = (dist) => hz - Math.cos(pitch) * dist;

  // layered pauldrons with gold rims + hazard chevrons on the outboard face
  for (const side of [-1, 1]) {
    const px = side * (M.shoulderX + cw * 0.2);
    const pFace = side * (cw * 0.06 + 0.008);
    b.box('armor', cw * 0.12, ch * 0.56, cd * 0.94, px, sy + ch * 0.16, 0.02, 0, 0, side * 0.14);
    b.box('trim', cw * 0.14, ch * 0.05, cd * 0.96, px, sy + ch * 0.45, 0.02, 0, 0, side * 0.14);
    // outer face is a big plate: give it a frame, bolt heads, chevrons and a
    // raised centre boss so it does not read as a blank slab in profile
    b.box('trim', 0.02, ch * 0.04, cd * 0.9, px + pFace, sy + ch * 0.43, 0.02);
    b.box('trim', 0.02, ch * 0.04, cd * 0.9, px + pFace, sy - ch * 0.09, 0.02);
    b.box('trim', 0.02, ch * 0.48, 0.05, px + pFace, sy + ch * 0.16, 0.02 - cd * 0.44);
    b.box('trim', 0.02, ch * 0.48, 0.05, px + pFace, sy + ch * 0.16, 0.02 + cd * 0.44);
    for (const dz of [-cd * 0.3, cd * 0.3]) {
      for (const dy of [-ch * 0.06, ch * 0.36]) {
        b.sphere('trim', 0.028, px + pFace, sy + dy, 0.02 + dz);
      }
    }
    b.box('accent', 0.02, ch * 0.06, cd * 0.22, px + pFace, sy + ch * 0.06, 0.02 - cd * 0.14);
    b.box('accent', 0.02, ch * 0.06, cd * 0.22, px + pFace, sy + ch * 0.06, 0.02 + cd * 0.14);
    b.octa('trim', cd * 0.1, px + pFace + side * 0.015, sy + ch * 0.16, 0.02);
    b.box('dark', cw * 0.16, ch * 0.16, cd * 0.5, side * (M.shoulderX + cw * 0.16), sy + ch * 0.02, -cd * 0.2);
    for (let i = 0; i < 3; i++) {
      b.box('accent', cw * 0.07, ch * 0.035, 0.03, side * (M.shoulderX + cw * 0.12), sy + ch * 0.1 + i * ch * 0.1, -cd * 0.51);
    }
  }
  // shoulder howitzer: mantlet, breech, trunnion, twin recoil sleeves, barrel,
  // muzzle brake, gun shield and an ammunition feed chute from the drums
  b.box('armor', cw * 0.4, ch * 0.3, cd * 0.56, hx, hy - ch * 0.1, hz + cd * 0.16);
  b.box('dark', cw * 0.3, ch * 0.22, cd * 0.36, hx, hy + 0.02, dZ(0.1));
  b.box('trim', cw * 0.34, ch * 0.06, cd * 0.4, hx, hy + ch * 0.13, dZ(0.1));
  b.cyl('trim', 0.075, cw * 0.46, hx, hy, hz, 0, 0, Math.PI / 2);
  b.sphere('trim', 0.13, hx, hy, hz);
  b.cyl('gun', 0.14, 2.35, hx, dY(1.5), dZ(1.5), Math.PI / 2 + pitch, 0, 0);
  for (const dist of [1.05, 1.85]) {
    b.cyl('trim', 0.165, 0.1, hx, dY(dist), dZ(dist), Math.PI / 2 + pitch, 0, 0);
  }
  b.box('dark', 0.44, 0.4, 0.46, hx, dY(2.85), dZ(2.85), pitch, 0, 0);
  b.box('accent', 0.5, 0.06, 0.14, hx, dY(2.8), dZ(2.8), pitch, 0, 0);
  for (const off of [-0.24, 0.24]) {
    b.cyl('trim', 0.058, 0.9, hx + off, dY(0.62), dZ(0.62), Math.PI / 2 + pitch, 0, 0);
    b.cyl('dark', 0.034, 0.34, hx + off, dY(1.16), dZ(1.16), Math.PI / 2 + pitch, 0, 0);
  }
  // outboard recoil gearbox + cable bundle (kept compact instead of a flat
  // shield so the shoulder reads as a machined mount)
  b.box('dark', cw * 0.12, ch * 0.18, cd * 0.3, hx - cw * 0.19, hy - ch * 0.06, dZ(0.06));
  b.cyl('trim', 0.11, 0.055, hx - cw * 0.2, hy, hz, 0, 0, Math.PI / 2);
  b.sphere('trim', 0.055, hx - cw * 0.22, hy, hz);
  b.box('accent', cw * 0.1, ch * 0.03, cd * 0.16, hx - cw * 0.19, hy + ch * 0.09, dZ(0.06));
  b.beam('dark', hx - cw * 0.16, hy - ch * 0.14, dZ(0.1), -cw * 0.3, cy + ch * 0.2, cd * 0.4, 0.022);
  b.beam('dark', hx - cw * 0.14, hy - ch * 0.1, dZ(0.12), -cw * 0.26, cy + ch * 0.28, cd * 0.42, 0.018);
  // hydraulic recuperator strut from the backpack to the breech
  b.beam('trim', -cw * 0.12, cy + ch * 0.38, cd * 0.34, hx + 0.16, hy + 0.02, dZ(0.32), 0.035);
  b.beam('dark', -cw * 0.3, cy + ch * 0.3, cd * 0.5, hx + 0.12, hy - ch * 0.12, hz + cd * 0.2, 0.075);
  b.beam('trim', -cw * 0.3, cy + ch * 0.3, cd * 0.5, hx + 0.12, hy - ch * 0.12, hz + cd * 0.2, 0.012);
  b.beam('trim', hx + cw * 0.08, hy - ch * 0.3, hz + cd * 0.24, hx + cw * 0.02, hy - ch * 0.02, hz - cd * 0.5, 0.03);
  // rear ammo drums + exhaust stacks
  for (const side of [-1, 1]) {
    b.cyl('dark', cd * 0.3, cw * 0.26, side * cw * 0.3, cy + ch * 0.02, cd * 0.78, 0, 0, Math.PI / 2);
    b.cyl('trim', cd * 0.31, 0.03, side * (cw * 0.3 + cw * 0.13), cy + ch * 0.02, cd * 0.78, 0, 0, Math.PI / 2);
    b.cyl('dark', 0.09, ch * 0.55, side * cw * 0.38, cy + ch * 0.62, cd * 0.5, 0.12, 0, 0);
    b.cyl('core', 0.075, 0.06, side * cw * 0.38, cy + ch * 0.9, cd * 0.5, 0.12, 0, 0);
    b.box('accent', cw * 0.06, ch * 0.05, 0.03, side * (M.shoulderX + cw * 0.09), sy + ch * 0.52, -cd * 0.47);
  }
  // chest reactor ring + gold trim + hazard plate row
  b.cyl('trim', cw * 0.19, 0.06, 0, cy + ch * 0.1, -cd * 0.57, Math.PI / 2, 0, 0);
  b.cyl('dark', cw * 0.13, 0.03, 0, cy + ch * 0.1, -cd * 0.6, Math.PI / 2, 0, 0);
  b.sphere('core', cw * 0.075, 0, cy + ch * 0.1, -cd * 0.63);
  b.box('trim', cw * 0.98, 0.035, 0.03, 0, cy + ch * 0.42, -cd * 0.55);
  b.box('trim', cw * 0.92, 0.03, 0.03, 0, cy - ch * 0.36, -cd * 0.56);
  for (let i = -2; i <= 2; i++) {
    b.box('accent', cw * 0.05, ch * 0.055, 0.03, i * cw * 0.16, cy + ch * 0.22, -cd * 0.56);
  }
}

/** buildHead() — twin wide-band optics + targeting lens + rangefinder pod. */
function head(b, M, def, ctx) {
  const { w, h, d, y } = ctx;
  // twin wide-band optics + central targeting lens + rangefinder pod
  for (const side of [-1, 1]) {
    b.box('dark', w * 0.3, h * 0.11, 0.05, side * w * 0.2, y + h * 0.02, -d * 0.5);
    b.box('visor', w * 0.24, h * 0.07, 0.03, side * w * 0.2, y + h * 0.02, -d * 0.52 - 0.02);
  }
  b.cyl('trim', w * 0.09, 0.03, 0, y + h * 0.02, -d * 0.54, Math.PI / 2, 0, 0);
  b.sphere('core', w * 0.055, 0, y + h * 0.02, -d * 0.575);
  b.box('dark', w * 0.3, h * 0.24, d * 0.5, w * 0.6, y + h * 0.06, -d * 0.06);
  b.box('trim', w * 0.31, h * 0.06, d * 0.52, w * 0.6, y + h * 0.19, -d * 0.06);
  b.cyl('accent', w * 0.07, 0.02, w * 0.74, y + h * 0.06, -d * 0.06, 0, 0, Math.PI / 2);
  b.beam('trim', -w * 0.3, y + h * 0.5, d * 0.1, -w * 0.48, y + h * 1.16, d * 0.36, 0.018);
  b.sphere('core', 0.022, -w * 0.48, y + h * 1.16, d * 0.36);
  b.beam('trim', w * 0.35, y + h * 0.46, d * 0.08, w * 0.52, y + h * 0.92, d * 0.3, 0.014);
  b.sphere('core', 0.018, w * 0.52, y + h * 0.92, d * 0.3);
  for (const side of [-1, 1]) {
    b.box('armor', w * 0.22, h * 0.3, d * 0.5, side * w * 0.4, y - h * 0.22, -d * 0.16, 0, 0, side * 0.12);
  }
  for (let i = -2; i <= 2; i++) b.box('dark', w * 0.05, h * 0.22, 0.03, i * w * 0.11, y - h * 0.4, -d * 0.5);
  b.box('trim', w * 0.9, h * 0.05, d * 0.3, 0, y + h * 0.56, d * 0.02);
}

/** buildArm() — ammo arm (left) / armoured MG arm (right). */
function arm(b, M, def, side, ctx) {
  const { aw, dirY, dirZ, elbowY, handY, handZ, midY, midZ } = ctx;
  if (side < 0) {
    // left arm: ammo arm carrying a drum magazine for the shoulder howitzer;
    // the forearm wears a hazard-striped blast shield
    b.boxDir('armor', aw * 1.5, aw * 1.1, M.armFore * 0.85, side * aw * 0.55, midY, midZ, 0, -dirY, -dirZ);
    b.cyl('dark', aw * 0.62, aw * 1.0, side * aw * 0.95, midY + aw * 0.15, midZ + aw * 0.1, 0, 0, Math.PI / 2);
    b.cyl('trim', aw * 0.63, 0.03, side * (aw * 0.95 + aw * 0.5), midY + aw * 0.15, midZ + aw * 0.1, 0, 0, Math.PI / 2);
    b.box('accent', aw * 0.5, aw * 0.07, aw * 0.12, side * aw * 0.9, midY + aw * 0.28, midZ - aw * 0.42);
    b.box('armor', aw * 1.3, aw * 0.55, aw * 1.1, 0, handY - aw * 0.35, handZ - aw * 0.15);
    b.box('trim', aw * 1.36, aw * 0.1, aw * 0.24, 0, handY - aw * 0.68, handZ - aw * 0.15);
  } else {
    // right arm: armoured MG arm with an external belt housing and a brace
    b.boxDir('armor', aw * 1.45, aw * 1.3, M.armFore * 0.95, 0, midY, midZ - aw * 0.1, 0, -dirY, -dirZ);
    b.boxDir('dark', aw * 0.8, aw * 0.85, M.armFore * 0.6, side * aw * 0.1, midY - aw * 0.1, midZ - aw * 0.3, 0, -dirY, -dirZ);
    b.box('dark', aw * 0.62, aw * 0.5, aw * 0.95, side * aw * 0.8, handY + aw * 0.3, handZ + aw * 0.05);
    b.box('accent', aw * 0.66, aw * 0.08, aw * 0.12, side * aw * 0.8, handY + aw * 0.52, handZ + aw * 0.05);
    b.beam('trim', side * aw * 1.2, elbowY * 0.2, aw * 0.5, side * aw * 1.1, handY + aw * 0.35, handZ + aw * 0.1, 0.035);
    // outer-arm recognition detail: trim rail + hazard block
    b.box('trim', 0.035, aw * 0.07, M.armFore * 0.7, side * aw * 0.78, midY, midZ - aw * 0.05);
    b.box('accent', 0.04, aw * 0.1, aw * 0.3, side * aw * 0.8, midY - aw * 0.18, midZ + aw * 0.2);
  }
}

/** buildLeg() — siege knee hazard plate, shin rib + toe cap. */
function leg(b, M, def, side, ctx) {
  const { w, kneeY, kneeZ, ankleY, ankleZ, footY } = ctx;
  // siege leg: knee hazard plate, shin rib and an armoured toe cap
  b.box('dark', w * 1.35, w * 0.72, w * 0.12, 0, kneeY - w * 0.12, kneeZ + w * 0.5, 0.1, 0, 0);
  b.box('accent', w * 0.85, w * 0.1, 0.03, 0, kneeY - w * 0.2, kneeZ + w * 0.6);
  b.box('trim', M.footW * 0.82, M.footH * 0.24, M.footL * 0.22, 0, footY + M.footH * 0.06, ankleZ - M.footL * 0.78);
  b.box('dark', w * 0.5, w * 0.12, M.legShin * 0.55, 0, (kneeY + ankleY) * 0.5, (kneeZ + ankleZ) * 0.5 + w * 0.4);
}

/** buildGun() — heavy rotary machine gun. */
function gun(b, M, def, metrics) {
  const { s, bodyW, bodyH, bodyL, barrelLen, bodyCenterZ, barrelCenterZ, tipZ } = metrics;
  // heavy rotary machine gun: armoured shroud, three extra barrels, top-mounted
  // ammo drum, side belt box and a muzzle clamp (the howitzer stays on the
  // shoulder, this is the close-range weapon)
  b.box('dark', bodyW * 1.9, bodyH * 0.8, bodyL * 1.0, 0, 0.045 * s, bodyCenterZ - 0.02 * s);
  b.box('armor', bodyW * 2.0, bodyH * 1.0, bodyL * 0.5, 0, 0.05 * s, bodyCenterZ + 0.16 * s);
  b.box('dark', bodyW * 1.2, bodyH * 0.5, bodyL * 0.7, 0, 0.045 * s + bodyH * 0.55, bodyCenterZ - 0.08 * s);
  for (const off of [-1, 0, 1]) {
    b.cyl('gun', 0.032 * s, barrelLen * 1.05, off * 0.09 * s, 0.052 * s, barrelCenterZ - 0.03, Math.PI / 2, 0, 0);
    b.cyl('trim', 0.042 * s, 0.05 * s, off * 0.09 * s, 0.052 * s, tipZ + 0.02, Math.PI / 2, 0, 0);
  }
  b.box('dark', 0.2 * s, 0.22 * s, 0.12 * s, 0, 0.052 * s, tipZ + 0.05 * s);
  b.box('accent', 0.22 * s, 0.03 * s, 0.1 * s, 0, 0.052 * s + 0.13 * s, tipZ + 0.05 * s);
  b.cyl('dark', 0.17 * s, 0.12 * s, 0, 0.14 * s, bodyCenterZ + 0.12 * s, Math.PI / 2, 0, 0);
  b.cyl('trim', 0.175 * s, 0.03 * s, 0, 0.14 * s, bodyCenterZ + 0.2 * s, Math.PI / 2, 0, 0);
  b.box('dark', 0.12 * s, 0.2 * s, 0.3 * s, -0.14 * s, -0.02 * s, bodyCenterZ + 0.02 * s);
  b.box('accent', 0.05 * s, 0.12 * s, 0.3 * s, -0.16 * s, 0.08 * s, bodyCenterZ + 0.06 * s);
  b.box('trim', bodyW * 1.2, 0.02 * s, 0.15 * s, 0, 0.045 * s + bodyH * 0.55, bodyCenterZ - 0.06 * s);
  return { tipY: 0.052 * s, tipZ: tipZ - 0.06 * s };
}

/** buildRobotRig() — shoulder-howitzer + rear ammo-drum hitboxes (torso zone). */
function hitboxes(addHit, torso, M, def) {
  // shoulder howitzer + rear ammo drums sit outside the torso slab
  addHit('torso', torso,
    M.chestW * 0.38, M.chestH * 0.28, M.chestD * 2.3,
    -M.shoulderX * 0.92, M.shoulderY + M.chestH * 0.55, -M.chestD * 1.15);
  addHit('torso', torso,
    M.chestW * 0.62, M.chestH * 0.32, M.chestD * 0.45,
    0, M.chestY + M.chestH * 0.02, M.chestD * 0.8);
}

export const hooks = { torso, head, arm, leg, gun, hitboxes };
