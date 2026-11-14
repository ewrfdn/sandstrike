/**
 * Generic gloved-hand rig for first-person weapon models.
 *
 * The hand/forearm geometry is moved verbatim out of the legacy VXR-7
 * `buildHands()` in `vxr7.js`; only the two mounts (position + rotation of the
 * hand groups) and the two sleeve runs (world-space points in the held frame,
 * wrist/elbow radii) are passed in, so the same hand models can be bound to any
 * weapon that shares the held frame.
 *
 * - Right hand = firing hand (wraps the pistol grip).
 * - Left hand  = C-clamp support hand on the handguard.
 *
 * The returned `root` is meant to sit directly under the held frame (already
 * scaled by the weapon's held scale) — it never scales by itself, never creates
 * textures and never touches the scene or any weapon module.
 *
 * Usage:
 *   const hands = buildGlovedHands({
 *     mats: { glove, glovePalm, gloveDark, sleeve, accent },
 *     right: { position: [...], rotation: [...], sleeve: { points, rWrist, rElbow } },
 *     left:  { ...same... },
 *   });
 *   heldFrame.add(hands.root);
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------------
// Primitive helpers (verbatim from the legacy weapon builder)
// ---------------------------------------------------------------------------

function rounded(w, h, d, mat, r = Math.min(w, h, d) * 0.16, segments = 2) {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, segments, Math.max(0.002, r)), mat);
}
function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}
function place(mesh, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}
function add(parent, mesh, x, y, z, rx = 0, ry = 0, rz = 0) {
  place(mesh, x, y, z, rx, ry, rz);
  parent.add(mesh);
  return mesh;
}
function cylinderBetween(a, b, radius, mat, seg = 12) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.92, len, seg), mat);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

const _toVec3 = (p) => (p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]));

/**
 * Build both gloved hands and forearm sleeves.
 *
 * @param {object} opts
 * @param {object} opts.mats  { glove, glovePalm, gloveDark, sleeve, accent } materials
 * @param {object} opts.right { position, rotation, sleeve: { points, rWrist, rElbow } }
 * @param {object} opts.left  { position, rotation, sleeve: { points, rWrist, rElbow } }
 * @returns {{ root: THREE.Group, rightHand: THREE.Group, leftHand: THREE.Group }}
 */
export function buildGlovedHands({ mats, right, left }) {
  if (!mats) throw new Error('[hands] buildGlovedHands requires mats');
  if (!right || !left) throw new Error('[hands] buildGlovedHands requires right and left mounts');
  const { glove, glovePalm, sleeve, accent } = mats;
  const dark = mats.gloveDark;

  const root = new THREE.Group();
  root.name = 'handsRoot';

  /**
   * Forearm / sleeve run from a wrist point outward.  Points are in held-frame
   * space (both hand groups are fixed held-frame children).  Tapered cylinder
   * segments are left open-ended so no flat cap faces the lens (a wrist tube
   * pointing at the camera reads as a dark peg, which is why the old sleeve
   * tubes were removed instead of replaced); the far end gets a rounded cap and
   * sits outside the near frame.
   */
  const sleeveRun = (points, rWrist, rElbow) => {
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      if (len < 1e-5) continue;
      const t0 = i / (points.length - 1);
      const t1 = (i + 1) / (points.length - 1);
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(
          rWrist + (rElbow - rWrist) * t1,
          rWrist + (rElbow - rWrist) * t0,
          len, 12, 1, true,
        ),
        sleeve,
      );
      mesh.position.copy(a).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(up, dir.normalize());
      root.add(mesh);
    }
    // cuff ring hides the rounded glove wrist cap where the sleeve starts
    const cuffDir = new THREE.Vector3().subVectors(points[1], points[0]).normalize();
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(rWrist * 1.12, rWrist * 1.18, 0.034, 12), sleeve);
    cuff.position.copy(points[0]).addScaledVector(cuffDir, 0.004);
    cuff.quaternion.setFromUnitVectors(up, cuffDir);
    root.add(cuff);
    // rounded end cap: the open tube end never faces the player camera (it is
    // outside the near frame), but the isolated model stage can see it
    const cap = new THREE.Mesh(new THREE.SphereGeometry(rElbow * 0.98, 10, 8), sleeve);
    cap.position.copy(points[points.length - 1]);
    root.add(cap);
  };

  /** Chain of capsules through a list of joint points (hand-local space). */
  const chain = (parent, points, radius, mat, jointRadius = radius * 1.06) => {
    for (let i = 0; i < points.length - 1; i++) {
      parent.add(cylinderBetween(points[i], points[i + 1], radius, mat));
      // knuckle/joint blob keeps the silhouette soft instead of piping-like
      const blob = new THREE.Mesh(new THREE.SphereGeometry(jointRadius, 10, 8), mat);
      blob.position.copy(points[i]);
      parent.add(blob);
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.92, 10, 8), mat);
    tip.position.copy(points[points.length - 1]);
    parent.add(tip);
  };

  /* ---------------------------------------------------------------------
   * RIGHT HAND — firing hand on the pistol grip.
   * Palm on the right flank of the grip, fingers wrap the front strap and
   * curl back toward the left, thumb rides the left side.
   * ------------------------------------------------------------------- */
  const rightHand = new THREE.Group();
  rightHand.name = 'rightHand';
  rightHand.position.fromArray(right.position);
  rightHand.rotation.set(right.rotation[0], right.rotation[1], right.rotation[2]);
  root.add(rightHand);

  // back of the hand: smaller, angled away from the lens, with a visible
  // knuckle ridge and glove strap so it reads as a hand rather than a blob
  add(rightHand, rounded(0.056, 0.066, 0.064, glovePalm, 0.016, 3), 0, 0, 0);
  add(rightHand, rounded(0.050, 0.018, 0.050, dark, 0.008, 2), 0.000, 0.032, -0.004, 0.06);
  // four knuckles across the back of the hand
  for (let i = 0; i < 4; i++) {
    add(rightHand, new THREE.Mesh(new THREE.SphereGeometry(0.0092, 10, 8), glove),
      0.020 - i * 0.0135, 0.030, -0.026, 0, 0, 0);
  }
  // glove strap + buckle
  add(rightHand, box(0.052, 0.010, 0.024, dark), 0.002, -0.010, 0.020, 0.1);
  add(rightHand, box(0.012, 0.014, 0.012, accent), 0.016, -0.008, 0.020, 0.1);
  // four fingers wrapping the front strap of the grip
  for (let i = 0; i < 4; i++) {
    const y = 0.026 - i * 0.0215;
    chain(rightHand, [
      new THREE.Vector3(-0.010, y, -0.016),
      new THREE.Vector3(-0.026, y - 0.002, -0.034),
      new THREE.Vector3(-0.042, y - 0.004, -0.028),
      new THREE.Vector3(-0.046, y - 0.006, -0.010),
    ], 0.0092 - i * 0.0004, glove);
    add(rightHand, rounded(0.013, 0.014, 0.014, dark, 0.004, 1),
      -0.030, y + 0.008, -0.030, 0.1, 0, 0.1);
  }
  // thumb over the top of the grip
  chain(rightHand, [
    new THREE.Vector3(0.028, 0.028, 0.004),
    new THREE.Vector3(0.030, 0.046, -0.022),
    new THREE.Vector3(0.014, 0.050, -0.040),
  ], 0.0112, glove);
  // right forearm: leaves the wrist down/back and out of the bottom of frame
  sleeveRun(right.sleeve.points.map(_toVec3), right.sleeve.rWrist, right.sleeve.rElbow);

  /* ---------------------------------------------------------------------
   * LEFT HAND — "C-clamp" support grip on the handguard. The palm presses
   * against the left flank of the handguard and the fingers curl OVER the top
   * so they are actually visible from the player camera (a hand tucked under
   * the handguard just disappears inside the mesh and looks like it floats).
   * Joints are given in held-frame space, which keeps the grip alignment honest.
   * ------------------------------------------------------------------- */
  const leftHand = new THREE.Group();
  leftHand.name = 'leftHand';
  // sits flush against the left flank of the handguard (no air gap, which is
  // what made the support hand look like it was floating under the gun)
  leftHand.position.fromArray(left.position);
  leftHand.rotation.set(left.rotation[0], left.rotation[1], left.rotation[2]);
  root.add(leftHand);

  // palm / heel of the hand against the left flank
  add(leftHand, rounded(0.040, 0.062, 0.078, glove, 0.014, 3), 0, 0, 0);
  add(leftHand, rounded(0.030, 0.020, 0.056, dark, 0.008, 2), -0.008, -0.022, 0.002, 0.06);
  // four fingers curling up and over the top of the handguard.  The curl sits
  // a few mm higher than before so the finger undersides rest on the handguard
  // rail plate instead of interpenetrating it (visible from the top view).
  for (let i = 0; i < 4; i++) {
    const z = -0.052 + i * 0.021;
    chain(leftHand, [
      new THREE.Vector3(0.006, 0.026, z),
      new THREE.Vector3(0.022, 0.056, z - 0.002),
      new THREE.Vector3(0.048, 0.066, z - 0.004),
      new THREE.Vector3(0.070, 0.056, z - 0.006),
    ], 0.0092 - i * 0.0004, glove);
    // knuckle pad on the back of the finger, facing the camera
    add(leftHand, rounded(0.013, 0.012, 0.014, dark, 0.004, 1),
      0.028, 0.068, z - 0.002, 0.1, 0, -0.2);
  }
  // thumb along the left flank, pointing toward the muzzle
  chain(leftHand, [
    new THREE.Vector3(-0.012, 0.010, -0.026),
    new THREE.Vector3(-0.010, 0.016, -0.054),
    new THREE.Vector3(-0.002, 0.018, -0.078),
  ], 0.0106, glove);
  // left forearm: leaves the support wrist down/left/back out of the frame
  sleeveRun(left.sleeve.points.map(_toVec3), left.sleeve.rWrist, left.sleeve.rElbow);

  return { root, rightHand, leftHand };
}
