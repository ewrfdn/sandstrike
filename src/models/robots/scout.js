/**
 * SCATTER-9 — scout chassis (ROBOT_TYPES.scout).
 *
 * Detailed lightweight reconnaissance chassis. All scout-only geometry stays
 * here; the shared rig still owns animation pivots, hitboxes and draw batching.
 */
import * as THREE from 'three';

export const meta = { id: 'robot-scout', kind: 'robot', group: 'robots', label: 'SCATTER-9 · 侦察机', type: 'scout', defaultPose: 'base' };

/** Model data and rig dimensions are preserved; combat stats live in src/config/enemies.js. */
export const def = {
  key: 'scout',
  name: 'SCATTER-9',
  displayName: 'SCATTER-9 // 散射侦察机',
  radius: 0.52,
  height: 2.2,
  speed: 4.35,
  stride: 1.2,
  score: 100,
  resist: 1.0,
  staggerResist: 0,
  eyeHeight: 2.0,
  ranges: { min: 4.5, ideal: 9, max: 17 },
  fire: { shots: 3, interval: 0.13, cooldown: 1.2, telegraph: 0.42, accuracy: 0.62, mag: 12, reload: 1.9 },
  gun: { scale: 0.8 },
  palette: { armor: 0x687f8b, dark: 0x19252d, trim: 0xb7814b, gun: 0x334852, visor: 0x6fe8ff, tracer: 0x9ff2ff },
  model: {
    hipY: 1.14, hipX: 0.17, pelvisW: 0.36, pelvisH: 0.26, pelvisD: 0.3,
    torsoPivotY: 0.1, chestW: 0.5, chestH: 0.64, chestD: 0.34, chestY: 0.34,
    neckY: 0.72, shoulderX: 0.31, shoulderY: 0.55,
    headW: 0.27, headH: 0.26, headD: 0.3, headY: 0.13,
    armUpper: 0.32, armFore: 0.34, armW: 0.1, armBendR: 1.32, armBendL: 1.05,
    legThigh: 0.5, legShin: 0.5, legW: 0.17, footL: 0.42, footW: 0.22, footH: 0.14,
  },
};

// Cache the two extra primitives on the rig's own library. The existing
// disposeUnitGeos lifecycle releases them, including when previews are switched.
function primitives(b) {
  if (b.geos.scoutHull) return;
  const outline = new THREE.Shape();
  outline.moveTo(-0.34, -0.46);
  for (const [x, y] of [[0.34, -0.46], [0.46, -0.34], [0.46, 0.34], [0.34, 0.46], [-0.34, 0.46], [-0.46, 0.34], [-0.46, -0.34]]) outline.lineTo(x, y);
  outline.closePath();
  const hull = new THREE.ExtrudeGeometry(outline, {
    depth: 0.92, steps: 1, bevelEnabled: true,
    bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1, curveSegments: 1,
  });
  hull.center();
  b.geos.scoutHull = hull;
  b.geos.scoutCylinder = new THREE.CylinderGeometry(1, 1, 1, 20, 1);
}

/** Bevelled armour, baked into the same body/glow buckets as shared primitives. */
function plate(b, key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  primitives(b);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d));
  b._push(key, b.geos.scoutHull, matrix);
}

// Cylinder axis points along Z; negative Z is the front of the chassis.
function disc(b, key, r, depth, x, y, z) {
  primitives(b);
  b.cyl(key, r, depth, x, y, z, Math.PI / 2, 0, 0, 'scoutCylinder');
}

function fastener(b, x, y, z, r = 0.008) {
  disc(b, 'dark', r * 1.45, 0.006, x, y, z);
  disc(b, 'trim', r, 0.009, x, y, z - 0.003);
  b.box('dark', r * 1.05, r * 0.22, 0.003, x, y, z - 0.009);
}

/** Layered hip block: waist bands, articulated bearings, tassets and a rear power pack. */
function pelvis(b, M, def, { pw, ph, pd }) {
  b.buckets.clear();
  // dark frame + stacked waist armour
  plate(b, 'dark', pw * 0.84, ph * 0.94, pd * 0.86, 0, 0, 0);
  plate(b, 'armor', pw * 1.0, ph * 0.44, pd * 0.97, 0, ph * 0.3, 0);
  plate(b, 'armor', pw * 0.92, ph * 0.4, pd * 0.94, 0, -ph * 0.24, 0);
  plate(b, 'trim', pw * 1.02, ph * 0.06, pd * 0.99, 0, ph * 0.08, 0);
  plate(b, 'trim', pw * 0.96, ph * 0.05, 0.03, 0, -ph * 0.02, -pd * 0.47);
  // crotch guard and the cyan hip power strip
  plate(b, 'armor', pw * 0.32, ph * 0.68, pd * 0.24, 0, -ph * 0.46, -pd * 0.4, -0.12);
  b.box('core', pw * 0.16, 0.008, 0.014, 0, ph * 0.06, -pd * 0.512);
  // front hip pouches with trim lids
  for (const side of [-1, 1]) {
    plate(b, 'dark', pw * 0.19, ph * 0.3, pd * 0.18, side * pw * 0.31, -ph * 0.3, -pd * 0.4, 0, side * 0.14);
    plate(b, 'trim', pw * 0.21, ph * 0.06, pd * 0.2, side * pw * 0.31, -ph * 0.15, -pd * 0.4, 0, side * 0.14);
  }
  // articulated hip bearings, outboard caps, tasset fins and service bolts
  for (const side of [-1, 1]) {
    const hx = side * M.hipX;
    const hy = -ph * 0.16;
    b.sphere('dark', M.hipX * 0.62, hx, hy, 0);
    b.cyl('dark', M.hipX * 0.5, 0.032, hx + side * M.hipX * 0.4, hy, 0, 0, 0, Math.PI / 2);
    b.cyl('trim', M.hipX * 0.32, 0.02, hx + side * M.hipX * 0.52, hy, 0, 0, 0, Math.PI / 2);
    plate(b, 'armor', pw * 0.22, ph * 0.74, pd * 0.8, side * pw * 0.48, -ph * 0.24, 0, 0, 0, side * -0.24);
    plate(b, 'trim', 0.02, ph * 0.52, pd * 0.34, side * pw * 0.6, -ph * 0.2, -pd * 0.1, 0, 0, side * -0.24);
    fastener(b, side * pw * 0.4, ph * 0.02, pd * 0.4, 0.005);
  }
  // rear power pack: armour lid, cooling louvres, warning lamp
  plate(b, 'dark', pw * 0.52, ph * 0.5, pd * 0.16, 0, -ph * 0.02, pd * 0.55);
  plate(b, 'armor', pw * 0.42, ph * 0.32, 0.035, 0, -ph * 0.02, pd * 0.63);
  for (let i = 0; i < 3; i++) b.box('dark', pw * 0.3, 0.011, 0.012, 0, ph * 0.16 - i * 0.032, pd * 0.655);
  b.box('accent', pw * 0.26, 0.018, 0.016, 0, ph * 0.2, pd * 0.6);
  // pelvis-top power collar that the torso pivot rides in
  b.cyl('dark', pw * 0.26, ph * 0.48, 0, ph * 0.52, 0);
  b.cyl('trim', pw * 0.3, 0.018, 0, ph * 0.62, 0);
  for (const side of [-1, 1]) {
    b.beam('dark', side * pw * 0.26, ph * 0.22, pd * 0.3, side * pw * 0.3, -ph * 0.1, pd * 0.42, 0.012);
  }
}

/** Split breastplate, exposed abdomen, shoulder outriggers and rear sensor pack. */
function torso(b, M, def, { cw, ch, cd, cy }) {
  // Hooks run after the generic builders. Replace only this scout part's
  // queued geometry, preserving its parent pivot and the shared batching path.
  b.buckets.clear();
  plate(b, 'dark', cw * 0.8, ch * 0.91, cd * 0.84, 0, cy, 0);
  plate(b, 'gun', cw * 0.94, ch * 0.26, cd * 0.97, 0, cy + ch * 0.32, 0, -0.08);

  for (const side of [-1, 1]) {
    // Separated pectoral shells expose a narrow central chassis spine.
    plate(b, 'armor', cw * 0.47, ch * 0.35, cd * 0.33, side * cw * 0.253, cy + ch * 0.22, -cd * 0.42, -0.09, side * -0.1, side * -0.06);
    plate(b, 'gun', cw * 0.39, ch * 0.12, 0.025, side * cw * 0.25, cy + ch * 0.365, -cd * 0.605, 0, 0, side * -0.06);
    b.box('core', cw * 0.27, 0.009, 0.008, side * cw * 0.25, cy + ch * 0.37, -cd * 0.65);
    fastener(b, side * cw * 0.39, cy + ch * 0.19, -cd * 0.615);
    plate(b, 'armor', cw * 0.29, ch * 0.24, cd * 0.86, side * cw * 0.35, cy - ch * 0.12, cd * 0.03, 0, 0, side * -0.12);
    for (let i = 0; i < 3; i++) {
      b.box('dark', cw * 0.17, 0.012, 0.014, side * cw * 0.345, cy - ch * 0.08 - i * 0.027, -cd * 0.425);
    }
    // Mechanical shoulder hubs stay within the original shoulder envelope.
    b.beam('dark', side * cw * 0.36, M.shoulderY, 0, side * M.shoulderX, M.shoulderY, 0, 0.064);
    b.cyl('gun', 0.077, 0.064, side * M.shoulderX, M.shoulderY, 0, 0, 0, Math.PI / 2);
    plate(b, 'armor', 0.16, 0.09, 0.24, side * (M.shoulderX + 0.015), M.shoulderY + 0.095, 0, 0, 0, side * 0.18);
    plate(b, 'trim', 0.025, 0.032, 0.17, side * (M.shoulderX + 0.069), M.shoulderY + 0.117, 0, 0, 0, side * 0.18);
    // Slim, anchored reconnaissance fins replace the old rectangular prongs.
    b.beam('gun', side * (M.shoulderX + 0.04), M.shoulderY + 0.1, 0.055, side * (M.shoulderX + 0.085), M.shoulderY + 0.225, 0.055, 0.018);
    plate(b, 'armor', 0.047, 0.235, 0.105, side * (M.shoulderX + 0.074), M.shoulderY + 0.185, 0.055, 0, 0, side * 0.38);
    plate(b, 'trim', 0.05, 0.034, 0.106, side * (M.shoulderX + 0.095), M.shoulderY + 0.262, 0.055, 0, 0, side * 0.38);
    // Two-stage abdominal actuator and its end mounts.
    b.beam('gun', side * 0.153, cy - 0.05, -0.085, side * 0.125, 0.025, -0.08, 0.024);
    b.beam('trim', side * 0.143, cy - 0.15, -0.085, side * 0.125, 0.015, -0.08, 0.011);
    disc(b, 'dark', 0.025, 0.026, side * 0.125, 0.023, -0.09);
  }

  // Reactor housing: concentric metal rings around a small recessed cyan lens.
  disc(b, 'dark', 0.077, 0.054, 0, cy + 0.012, -cd * 0.49);
  disc(b, 'trim', 0.061, 0.035, 0, cy + 0.012, -cd * 0.58);
  disc(b, 'gun', 0.048, 0.038, 0, cy + 0.012, -cd * 0.62);
  disc(b, 'core', 0.029, 0.012, 0, cy + 0.012, -cd * 0.687);
  b.box('dark', 0.012, 0.07, 0.014, 0, cy + 0.012, -cd * 0.71);
  for (let i = 0; i < 3; i++) {
    plate(b, 'gun', cw * (0.52 - i * 0.045), 0.042, 0.04, 0, cy - 0.1 - i * 0.052, -cd * 0.41, -0.13);
    b.box('trim', 0.035, 0.008, 0.008, 0, cy - 0.1 - i * 0.052, -cd * 0.48);
  }
  plate(b, 'armor', 0.27, 0.055, 0.07, 0, -0.01, -0.143);
  for (let i = 0; i < 4; i++) b.box('dark', 0.007, 0.02, 0.006, -0.095 + i * 0.012, -0.006, -0.18);

  b.cyl('dark', 0.068, 0.13, 0, M.neckY - 0.063, 0);
  for (let i = 0; i < 3; i++) b.cyl('gun', 0.076, 0.012, 0, M.neckY - 0.11 + i * 0.035, 0);
  b.beam('trim', -0.045, M.neckY - 0.12, -0.047, -0.045, M.neckY - 0.018, -0.047, 0.009);

  // Rear avionics pack, raised perimeter rails, recessed cooling louvres.
  plate(b, 'gun', cw * 0.68, ch * 0.65, cd * 0.43, 0, cy + 0.02, cd * 0.53);
  plate(b, 'armor', cw * 0.53, ch * 0.42, 0.042, 0, cy + 0.055, cd * 0.755);
  for (let i = 0; i < 6; i++) b.box('dark', cw * 0.37, 0.017, 0.016, 0, cy + 0.15 - i * 0.036, cd * 0.775, -0.2);
  for (const side of [-1, 1]) {
    plate(b, 'trim', 0.024, ch * 0.48, 0.028, side * cw * 0.29, cy + 0.04, cd * 0.78);
    disc(b, 'dark', 0.038, 0.026, side * 0.1, cy - 0.16, cd * 0.77);
    disc(b, 'gun', 0.026, 0.032, side * 0.1, cy - 0.16, cd * 0.8);
  }
  b.box('core', 0.07, 0.009, 0.014, 0, cy + 0.195, cd * 0.775);
  b.cyl('dark', 0.025, 0.042, -0.13, cy + 0.26, cd * 0.57);
  b.beam('gun', -0.13, cy + 0.26, cd * 0.57, -0.16, cy + 0.46, cd * 0.64, 0.008);
  b.beam('trim', -0.16, cy + 0.46, cd * 0.64, -0.17, cy + 0.52, cd * 0.66, 0.004);
}

/** Faceted helmet, brow visor, asymmetric multi-element optical sensor. */
function head(b, M, def, { w, h, d, y }) {
  b.buckets.clear();
  plate(b, 'dark', w * 0.94, h * 0.9, d * 0.93, 0, y, 0.012);
  plate(b, 'armor', w, h * 0.48, d, 0, y + h * 0.3, 0.008, 0.05);
  plate(b, 'gun', w * 0.38, h * 0.12, d * 0.77, 0, y + h * 0.57, 0.019);
  plate(b, 'dark', w * 0.94, h * 0.33, 0.053, 0, y + h * 0.04, -d * 0.5);
  plate(b, 'visor', w * 0.75, h * 0.075, 0.014, 0, y + h * 0.095, -d * 0.605);
  // A dark upper eyebrow keeps the glowing strip sharply framed.
  plate(b, 'armor', w * 1.02, h * 0.13, 0.067, 0, y + h * 0.25, -d * 0.49, -0.13);
  plate(b, 'armor', w * 0.72, h * 0.27, d * 0.8, 0, y - h * 0.36, -0.006, -0.1);
  plate(b, 'gun', w * 0.48, h * 0.18, 0.027, 0, y - h * 0.3, -d * 0.46);
  for (let i = -1; i <= 1; i++) b.box('dark', 0.009, 0.028, 0.013, i * 0.021, y - h * 0.3, -d * 0.515);

  for (const side of [-1, 1]) {
    plate(b, 'armor', w * 0.18, h * 0.35, d * 0.46, side * w * 0.44, y - h * 0.17, -d * 0.27, 0.04, side * 0.14, side * -0.16);
    b.cyl('dark', h * 0.22, w * 0.15, side * w * 0.52, y + h * 0.07, d * 0.1, 0, 0, Math.PI / 2);
    b.cyl('trim', h * 0.15, w * 0.17, side * w * 0.54, y + h * 0.07, d * 0.1, 0, 0, Math.PI / 2);
    b.cyl('gun', h * 0.09, w * 0.18, side * w * 0.55, y + h * 0.07, d * 0.1, 0, 0, Math.PI / 2);
    fastener(b, side * w * 0.34, y + h * 0.36, -d * 0.505, 0.005);
    for (let i = 0; i < 3; i++) b.box('dark', 0.018, 0.009, d * 0.26, side * w * 0.502, y + h * 0.34 - i * 0.018, d * 0.22);
  }
  // Right monocular with hood, dark lens surround and a tiny optical highlight.
  const lx = w * 0.27, ly = y + h * 0.02;
  disc(b, 'gun', 0.047, 0.06, lx, ly, -d * 0.6);
  disc(b, 'trim', 0.037, 0.024, lx, ly, -d * 0.715);
  disc(b, 'dark', 0.029, 0.027, lx, ly, -d * 0.735);
  disc(b, 'visor', 0.02, 0.009, lx, ly, -d * 0.79);
  disc(b, 'core', 0.006, 0.011, lx - 0.005, ly + 0.006, -d * 0.802);
  disc(b, 'dark', 0.017, 0.02, -w * 0.31, y - h * 0.05, -d * 0.61);
  disc(b, 'core', 0.008, 0.009, -w * 0.31, y - h * 0.05, -d * 0.655);

  // One tall communications aerial and a shorter opposite-side sensor probe.
  for (const side of [-1, 1]) {
    const x = side * w * 0.4;
    b.cyl('gun', 0.018, 0.045, x, y + h * 0.52, d * 0.27);
    const topY = y + h * (side < 0 ? 1.1 : 0.83);
    b.beam('gun', x, y + h * 0.54, d * 0.27, x + side * 0.025, topY, d * 0.35, 0.006);
    b.beam('trim', x + side * 0.02, topY - 0.027, d * 0.335, x + side * 0.025, topY, d * 0.35, 0.007);
  }
  plate(b, 'armor', w * 0.64, h * 0.4, 0.03, 0, y, d * 0.49);
  for (let i = 0; i < 3; i++) b.box('dark', w * 0.4, 0.009, 0.008, 0, y + 0.022 - i * 0.021, d * 0.552);
}

/** Servo shoulders, paired pistons, armoured forearms and segmented fingers. */
function arm(b, M, def, side, { aw, dirY, dirZ, elbowY, handY, handZ, midY, midZ }) {
  b.buckets.clear();
  b.sphere('dark', aw * 0.88, 0, 0, 0);
  b.cyl('gun', aw * 0.82, aw * 1.58, 0, -0.025, 0, 0, 0, Math.PI / 2);
  b.cyl('trim', aw * 0.49, 0.016, side * aw * 0.84, -0.025, 0, 0, 0, Math.PI / 2);
  plate(b, 'armor', aw * 1.17, M.armUpper * 0.64, aw * 1.28, 0, elbowY * 0.45, 0, 0, 0, side * 0.035);
  plate(b, 'gun', aw * 0.58, M.armUpper * 0.45, 0.018, 0, elbowY * 0.45, -aw * 0.68);
  b.box('trim', 0.013, M.armUpper * 0.26, 0.009, side * 0.025, elbowY * 0.42, -aw * 0.8);
  for (const z of [-aw * 0.38, aw * 0.38]) {
    b.beam('gun', side * aw * 0.52, -0.065, z, side * aw * 0.52, elbowY + 0.05, z, 0.014);
    b.beam('trim', side * aw * 0.52, elbowY + 0.13, z, side * aw * 0.52, elbowY + 0.015, z, 0.007);
  }
  b.cyl('dark', aw * 0.67, aw * 1.64, 0, elbowY, 0, 0, 0, Math.PI / 2);
  b.cyl('gun', aw * 0.48, aw * 1.78, 0, elbowY, 0, 0, 0, Math.PI / 2);
  b.cyl('trim', aw * 0.22, 0.012, side * aw * 0.92, elbowY, 0, 0, 0, Math.PI / 2);

  // The bevelled shell follows the exact forearm axis used by the shared rig.
  const bend = Math.atan2(dirZ, dirY);
  plate(b, 'gun', aw * 0.85, M.armFore * 0.88, aw * 1.05, 0, midY, midZ, bend);
  plate(b, 'armor', aw * 1.12, M.armFore * 0.66, aw * 1.27, 0, midY + dirY * 0.012, midZ + dirZ * 0.012, bend);
  plate(b, 'trim', 0.018, M.armFore * 0.38, aw * 1.29, side * aw * 0.41, midY, midZ, bend);
  for (let i = -1; i <= 1; i++) {
    const t = i * 0.035;
    b.box('dark', 0.012, 0.01, 0.065, side * aw * 0.565, midY + dirY * t, midZ + dirZ * t, bend);
  }
  if (side < 0) {
    // Left wrist reconnaissance terminal: raised bezel and divided screen.
    plate(b, 'dark', 0.018, 0.125, 0.075, -aw * 0.62, midY, midZ, bend);
    plate(b, 'accent', 0.008, 0.086, 0.048, -aw * 0.74, midY, midZ, bend);
    b.box('dark', 0.01, 0.008, 0.052, -aw * 0.79, midY, midZ, bend);
  }
  b.beam('dark', 0, handY + dirY * 0.04, handZ + dirZ * 0.04, 0, handY - dirY * 0.018, handZ - dirZ * 0.018, 0.038);
  plate(b, 'gun', 0.096, 0.073, 0.105, 0, handY - 0.025, handZ);
  plate(b, 'armor', 0.091, 0.035, 0.072, 0, handY - 0.012, handZ + 0.035);
  for (let i = 0; i < 3; i++) {
    const x = -0.031 + i * 0.031;
    plate(b, 'armor', 0.023, 0.04, 0.038, x, handY - 0.026, handZ - 0.048);
    plate(b, 'gun', 0.021, 0.031, 0.028, x, handY - 0.055, handZ - 0.039);
  }
  plate(b, 'gun', 0.032, 0.054, 0.042, -side * 0.055, handY - 0.035, handZ - 0.008, 0, 0, side * 0.35);
}

/** Floating thigh shells, knee bearings, shin actuators and articulated boots. */
function leg(b, M, def, side, { w, a1, a2, kneeY, kneeZ, ankleY, ankleZ, footY }) {
  b.buckets.clear();
  b.sphere('dark', w * 0.57, 0, 0, 0);
  b.cyl('gun', w * 0.39, w * 1.15, 0, -0.015, 0, 0, 0, Math.PI / 2);
  b.cyl('trim', w * 0.2, 0.016, side * w * 0.61, -0.015, 0, 0, 0, Math.PI / 2);
  plate(b, 'dark', w * 0.72, M.legThigh * 0.94, w * 0.89, 0, kneeY * 0.5, kneeZ * 0.5, a1);
  plate(b, 'armor', w * 1.05, M.legThigh * 0.68, w * 0.68, 0, kneeY * 0.46, kneeZ * 0.46 - w * 0.4, a1);
  plate(b, 'gun', w * 0.38, M.legThigh * 0.43, 0.018, side * w * 0.21, kneeY * 0.43, kneeZ * 0.43 - w * 0.76, a1);
  plate(b, 'trim', 0.017, M.legThigh * 0.25, 0.012, side * w * 0.39, kneeY * 0.4, kneeZ * 0.4 - w * 0.73, a1);
  for (const t of [0.27, 0.66]) fastener(b, -side * w * 0.28, kneeY * t, kneeZ * t - w * 0.77, 0.006);
  b.beam('gun', side * w * 0.44, -0.1, w * 0.23, side * w * 0.44, kneeY + 0.055, kneeZ + w * 0.23, 0.021);
  b.beam('trim', side * w * 0.44, kneeY + 0.19, kneeZ + w * 0.23, side * w * 0.44, kneeY + 0.025, kneeZ + w * 0.23, 0.01);

  b.cyl('dark', w * 0.4, w * 1.22, 0, kneeY, kneeZ, 0, 0, Math.PI / 2);
  b.cyl('gun', w * 0.29, w * 1.32, 0, kneeY, kneeZ, 0, 0, Math.PI / 2);
  b.cyl('trim', w * 0.14, 0.012, side * w * 0.69, kneeY, kneeZ, 0, 0, Math.PI / 2);
  plate(b, 'armor', w * 1.1, w * 0.7, w * 0.53, 0, kneeY + 0.016, kneeZ - w * 0.37, -0.18);
  plate(b, 'gun', w * 0.5, w * 0.34, 0.013, 0, kneeY + 0.02, kneeZ - w * 0.66, -0.18);
  b.box('core', w * 0.27, 0.008, 0.008, 0, kneeY + 0.025, kneeZ - w * 0.716);

  const sy = (kneeY + ankleY) * 0.5, sz = (kneeZ + ankleZ) * 0.5;
  plate(b, 'dark', w * 0.61, M.legShin * 0.9, w * 0.75, 0, sy, sz, a2);
  plate(b, 'armor', w * 0.86, M.legShin * 0.71, w * 0.56, 0, sy + 0.017, sz - w * 0.31, a2);
  plate(b, 'gun', w * 0.27, M.legShin * 0.48, 0.018, 0, sy + 0.02, sz - w * 0.61, a2);
  for (let i = 0; i < 3; i++) b.box('dark', w * 0.45, 0.013, 0.018, 0, sy + 0.105 - i * 0.032, sz - w * 0.59, a2);
  for (const x of [-w * 0.36, w * 0.36]) {
    b.beam('gun', x, kneeY - 0.065, kneeZ + w * 0.25, x, ankleY + 0.055, ankleZ + w * 0.25, 0.017);
    b.beam('trim', x, ankleY + 0.22, ankleZ + w * 0.25, x, ankleY + 0.018, ankleZ + w * 0.25, 0.008);
  }
  b.sphere('dark', w * 0.36, 0, ankleY, ankleZ);
  b.cyl('gun', w * 0.27, w * 0.96, 0, ankleY, ankleZ, 0, 0, Math.PI / 2);
  plate(b, 'armor', M.footW * 0.72, M.footH * 0.59, M.footL * 0.35, 0, ankleY - 0.025, ankleZ - 0.02);
  const fz = ankleZ - M.footL * 0.32;
  plate(b, 'dark', M.footW, M.footH * 0.4, M.footL, 0, footY - M.footH * 0.27, fz);
  plate(b, 'armor', M.footW * 0.95, M.footH * 0.66, M.footL * 0.7, 0, footY + 0.012, fz + 0.018, -0.06);
  for (const toe of [-1, 1]) {
    plate(b, 'gun', M.footW * 0.435, M.footH * 0.58, M.footL * 0.27, toe * M.footW * 0.235, footY - 0.004, fz - M.footL * 0.35);
    b.box('trim', M.footW * 0.31, 0.014, 0.01, toe * M.footW * 0.235, footY + 0.013, fz - M.footL * 0.49);
  }
  // Side tread blocks stop above the authored ground plane.
  for (let i = 0; i < 5; i++) {
    b.box('gun', M.footW * 1.02, 0.023, 0.024, 0, footY - M.footH * 0.35, fz - M.footL * 0.39 + i * M.footL * 0.19);
  }
  plate(b, 'gun', M.footW * 0.78, M.footH * 0.46, M.footL * 0.2, 0, footY, fz + M.footL * 0.43);
}

/** Compact scatter rifle: machined receiver, ribbed shroud and open reflex sight. */
function gun(b, M, def, { s, bodyW, bodyH, bodyL, bodyCenterZ, barrelCenterZ, barrelLen, tipZ }) {
  b.buckets.clear();
  plate(b, 'gun', bodyW, bodyH, bodyL, 0, 0.045 * s, bodyCenterZ);
  plate(b, 'armor', bodyW * 1.07, bodyH * 0.5, bodyL * 0.63, 0, 0.073 * s, bodyCenterZ - 0.018 * s);
  plate(b, 'dark', 0.077 * s, 0.095 * s, 0.23 * s, 0, 0.025 * s, 0.089 * s);
  plate(b, 'gun', 0.085 * s, 0.12 * s, 0.06 * s, 0, 0.028 * s, 0.21 * s);
  b.cyl('gun', 0.026 * s, barrelLen, 0, 0.05 * s, barrelCenterZ, Math.PI / 2);
  plate(b, 'gun', 0.099 * s, 0.09 * s, barrelLen * 0.62, 0, 0.05 * s, barrelCenterZ + barrelLen * 0.13);
  for (let i = 0; i < 5; i++) {
    const z = barrelCenterZ + 0.15 * s - i * 0.047 * s;
    b.box('dark', 0.105 * s, 0.032 * s, 0.017 * s, 0, 0.06 * s, z);
    b.box('trim', 0.053 * s, 0.008 * s, 0.012 * s, 0, 0.101 * s, z);
  }
  // Recessed muzzle, kept at the exact shared muzzle/flash location.
  disc(b, 'gun', 0.045 * s, 0.075 * s, 0, 0.05 * s, tipZ + 0.036 * s);
  disc(b, 'trim', 0.039 * s, 0.016 * s, 0, 0.05 * s, tipZ + 0.006 * s);
  disc(b, 'dark', 0.028 * s, 0.006 * s, 0, 0.05 * s, tipZ - 0.006 * s);
  disc(b, 'gun', 0.015 * s, 0.007 * s, 0, 0.05 * s, tipZ - 0.007 * s);
  plate(b, 'dark', 0.066 * s, 0.18 * s, 0.079 * s, 0, -0.107 * s, 0.024 * s, 0.22);
  plate(b, 'gun', 0.085 * s, 0.215 * s, 0.131 * s, 0, -0.17 * s, bodyCenterZ + 0.03 * s, 0.16);
  plate(b, 'dark', 0.092 * s, 0.03 * s, 0.14 * s, 0, -0.273 * s, bodyCenterZ + 0.015 * s, 0.16);
  for (let i = 0; i < 3; i++) b.box('dark', 0.089 * s, 0.009 * s, 0.085 * s, 0, (-0.11 - i * 0.045) * s, bodyCenterZ - 0.012 * s, 0.16);
  // Visible trigger guard, rather than a solid square below the receiver.
  b.beam('gun', 0, -0.035 * s, -0.025 * s, 0, -0.115 * s, -0.06 * s, 0.009 * s);
  b.beam('gun', 0, -0.115 * s, -0.06 * s, 0, -0.115 * s, 0.037 * s, 0.009 * s);
  b.beam('trim', 0, -0.04 * s, 0.006 * s, 0, -0.075 * s, -0.008 * s, 0.006 * s);
  b.box('dark', bodyW * 0.68, 0.025 * s, bodyL * 0.77, 0, 0.138 * s, bodyCenterZ);
  for (let i = 0; i < 6; i++) b.box('gun', bodyW * 0.84, 0.014 * s, 0.012 * s, 0, 0.155 * s, bodyCenterZ + (0.12 - i * 0.054) * s);
  const sightZ = bodyCenterZ + 0.02 * s;
  plate(b, 'gun', 0.078 * s, 0.022 * s, 0.11 * s, 0, 0.169 * s, sightZ);
  for (const side of [-1, 1]) plate(b, 'dark', 0.014 * s, 0.074 * s, 0.034 * s, side * 0.035 * s, 0.208 * s, sightZ);
  plate(b, 'gun', 0.078 * s, 0.014 * s, 0.034 * s, 0, 0.245 * s, sightZ);
  b.sphere('core', 0.006 * s, 0, 0.182 * s, sightZ);
  for (const side of [-1, 1]) {
    plate(b, 'dark', 0.012 * s, 0.044 * s, 0.13 * s, side * bodyW * 0.56, 0.06 * s, bodyCenterZ);
    b.box('accent', 0.005 * s, 0.008 * s, 0.075 * s, side * bodyW * 0.62, 0.062 * s, bodyCenterZ);
    b.cyl('dark', 0.012 * s, 0.03 * s, side * bodyW * 0.44, 0.093 * s, bodyCenterZ - bodyL * 0.31, 0, 0, Math.PI / 2, 'scoutCylinder');
  }
}

export const hooks = { pelvis, torso, head, arm, leg, gun };
