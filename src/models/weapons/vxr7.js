/**
 * VXR-7 first-person viewmodel — pure model module.
 *
 * Everything that makes the gun look like the gun lives here: the primitive
 * helpers, the procedural steel/polymer/label/flash canvas textures, the
 * receiver / optic / magazine / reload-animation parts, the gloved hands and arms
 * and the muzzle-flash rig. This is the geometry from the legacy
 * `WeaponSystem._buildWeapon()` / `WeaponSystem._buildHands()` in src/weapons.js,
 * moved out verbatim.
 *
 * `WeaponSystem` keeps every behavioural concern (input, ADS/hip transform,
 * sway, firing, reload timing, recoil, audio, raycasts) and just parents the
 * returned `gunRoot` into its own view scene.
 *
 * Usage:
 *   import { buildVxr7Viewmodel } from './models/weapons/vxr7.js';
 *   Object.assign(this, buildVxr7Viewmodel({
 *     scene: this.viewScene,          // THREE.Scene the viewmodel root is added to
 *     muzzleLight: this.muzzleLight,  // THREE.PointLight, re-parented under the flash
 *   }));
 *
 * Signature: buildVxr7Viewmodel({ scene, muzzleLight }) -> flat handle object.
 *
 * Every returned key matches the field name the legacy code assigned on the
 * WeaponSystem instance, so callers can `Object.assign()` it with no other
 * changes:
 *   gunRoot, gun, bolt, charging, magazine, spareMagazine, trigger, reticle,
 *   sightLocal, flashGroup, flashMats, muzzleLocal, muzzleLight, smokePuffs,
 *   matSteel, matSteelDark, matBlack, matPolymer, matRubber, matAccent,
 *   matBrass, matGlass, matGlove, matGlovePalm, matGloveDark, matSleeve.
 *
 * The viewmodel has no collision/raycast data and is never added to the world
 * scene: it is rendered by WeaponSystem.render() with the view camera only.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rand } from '../../utils.js';

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

function rounded(w, h, d, mat, r = Math.min(w, h, d) * 0.16, segments = 2) {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, segments, Math.max(0.002, r)), mat);
}
function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}
function cyl(rTop, rBottom, h, mat, seg = 20) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, false), mat);
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

// ---------------------------------------------------------------------------
// Procedural textures (canvas based, generated once per WeaponSystem build)
// ---------------------------------------------------------------------------

function makeSteelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#35393d';
  ctx.fillRect(0, 0, 512, 512);
  const img = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // brushed streaks
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? '210,220,228' : '8,10,12'},${rand(0.015, 0.07)})`;
    ctx.lineWidth = rand(0.4, 1.4);
    const y = rand(0, 512);
    const x = rand(0, 512);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rand(20, 160), y + rand(-2, 2));
    ctx.stroke();
  }
  // edge wear and oil smudges
  for (let i = 0; i < 22; i++) {
    const g = ctx.createRadialGradient(rand(0, 512), rand(0, 512), 0, rand(0, 512), rand(0, 512), rand(20, 80));
    g.addColorStop(0, 'rgba(14,16,17,.20)');
    g.addColorStop(1, 'rgba(14,16,17,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  }
  for (let i = 0; i < 150; i++) {
    ctx.fillStyle = `rgba(225,230,232,${rand(0.03, 0.15)})`;
    ctx.fillRect(rand(0, 512), rand(0, 512), rand(1, 5), rand(0.6, 2));
  }
  return canvas;
}

function makePolymerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#202326';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const l = Math.random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${l},${l},${l},${rand(0.02, 0.07)})`;
    ctx.fillRect(rand(0, 256), rand(0, 256), rand(0.5, 2), rand(0.5, 2));
  }
  for (let i = 0; i < 12; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${rand(0.02, 0.06)})`;
    ctx.beginPath();
    ctx.moveTo(rand(0, 256), rand(0, 256));
    ctx.lineTo(rand(0, 256), rand(0, 256));
    ctx.stroke();
  }
  return canvas;
}

function makeLabelTexture(text = 'VXR-7', sub = 'SANDSTRIKE // 5.56') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = 'rgba(220,220,210,.82)';
  ctx.font = '700 52px "Segoe UI", sans-serif';
  ctx.fillText(text, 14, 62);
  ctx.fillStyle = 'rgba(255,138,60,.9)';
  ctx.fillRect(14, 76, 210, 5);
  ctx.fillStyle = 'rgba(190,190,180,.55)';
  ctx.font = '400 21px "Segoe UI", sans-serif';
  ctx.fillText(sub, 14, 110);
  ctx.strokeStyle = 'rgba(220,220,210,.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, 500, 116);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.translate(128, 128);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.12, 'rgba(255,236,180,1)');
  g.addColorStop(0.3, 'rgba(255,165,72,.9)');
  g.addColorStop(0.6, 'rgba(255,100,30,.28)');
  g.addColorStop(1, 'rgba(255,70,10,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -128);
  ctx.lineTo(15, -24); ctx.lineTo(112, -32); ctx.lineTo(30, 0);
  ctx.lineTo(96, 44); ctx.lineTo(16, 24); ctx.lineTo(0, 128);
  ctx.lineTo(-14, 24); ctx.lineTo(-96, 50); ctx.lineTo(-26, 0);
  ctx.lineTo(-108, -30); ctx.lineTo(-16, -22);
  ctx.closePath();
  ctx.fill();
  // hot core
  ctx.fillStyle = 'rgba(255,255,255,.95)';
  ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Hands / arms
// ---------------------------------------------------------------------------

/**
 * Both gloved hands and forearm sleeves, parented to the gun group.
 * Geometry and joint positions are unchanged from the legacy builder.
 */
function buildHands(gun, mats) {
  const { glove, dark, sleeve, palmMat, accent } = mats;

  /**
   * Forearm / sleeve run from a wrist point outward.  Points are in gun space
   * (both hand groups are fixed gun-space children).  Tapered cylinder
   * segments are left open-ended so no flat cap faces the lens (a wrist tube
   * pointing at the camera reads as a dark peg, which is why the old sleeve
   * tubes were removed instead of replaced); the far end gets a rounded cap
   * and sits outside the near frame.
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
      gun.add(mesh);
    }
    // cuff ring hides the rounded glove wrist cap where the sleeve starts
    const cuffDir = new THREE.Vector3().subVectors(points[1], points[0]).normalize();
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(rWrist * 1.12, rWrist * 1.18, 0.034, 12), sleeve);
    cuff.position.copy(points[0]).addScaledVector(cuffDir, 0.004);
    cuff.quaternion.setFromUnitVectors(up, cuffDir);
    gun.add(cuff);
    // rounded end cap: the open tube end never faces the player camera (it is
    // outside the near frame), but the isolated model stage can see it
    const cap = new THREE.Mesh(new THREE.SphereGeometry(rElbow * 0.98, 10, 8), sleeve);
    cap.position.copy(points[points.length - 1]);
    gun.add(cap);
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
  const right = new THREE.Group();
  right.position.set(0.030, -0.098, 0.138);
  right.rotation.set(0.12, 0.34, 0.06);
  gun.add(right);

  // back of the hand: smaller, angled away from the lens, with a visible
  // knuckle ridge and glove strap so it reads as a hand rather than a blob
  add(right, rounded(0.056, 0.066, 0.064, palmMat, 0.016, 3), 0, 0, 0);
  add(right, rounded(0.050, 0.018, 0.050, dark, 0.008, 2), 0.000, 0.032, -0.004, 0.06);
  // four knuckles across the back of the hand
  for (let i = 0; i < 4; i++) {
    add(right, new THREE.Mesh(new THREE.SphereGeometry(0.0092, 10, 8), glove),
      0.020 - i * 0.0135, 0.030, -0.026, 0, 0, 0);
  }
  // glove strap + buckle
  add(right, box(0.052, 0.010, 0.024, dark), 0.002, -0.010, 0.020, 0.1);
  add(right, box(0.012, 0.014, 0.012, accent), 0.016, -0.008, 0.020, 0.1);
  // four fingers wrapping the front strap of the grip
  for (let i = 0; i < 4; i++) {
    const y = 0.026 - i * 0.0215;
    chain(right, [
      new THREE.Vector3(-0.010, y, -0.016),
      new THREE.Vector3(-0.026, y - 0.002, -0.034),
      new THREE.Vector3(-0.042, y - 0.004, -0.028),
      new THREE.Vector3(-0.046, y - 0.006, -0.010),
    ], 0.0092 - i * 0.0004, glove);
    add(right, rounded(0.013, 0.014, 0.014, dark, 0.004, 1),
      -0.030, y + 0.008, -0.030, 0.1, 0, 0.1);
  }
  // thumb over the top of the grip
  chain(right, [
    new THREE.Vector3(0.028, 0.028, 0.004),
    new THREE.Vector3(0.030, 0.046, -0.022),
    new THREE.Vector3(0.014, 0.050, -0.040),
  ], 0.0112, glove);
  // right forearm: leaves the wrist down/back and out of the bottom of frame
  sleeveRun([
    new THREE.Vector3(0.038, -0.132, 0.152),
    new THREE.Vector3(0.075, -0.225, 0.300),
    new THREE.Vector3(0.135, -0.345, 0.500),
    new THREE.Vector3(0.185, -0.460, 0.720),
  ], 0.042, 0.055);

  /* ---------------------------------------------------------------------
   * LEFT HAND — "C-clamp" support grip on the handguard. The palm presses
   * against the left flank of the handguard and the fingers curl OVER the top
   * so they are actually visible from the player camera (a hand tucked under
   * the handguard just disappears inside the mesh and looks like it floats).
   * Joints are given in gun space, which keeps the grip alignment honest.
   * ------------------------------------------------------------------- */
  const left = new THREE.Group();
  // sits flush against the left flank of the handguard (no air gap, which is
  // what made the support hand look like it was floating under the gun)
  left.position.set(-0.046, 0.004, -0.330);
  left.rotation.set(0.02, 0.04, 0.12);
  gun.add(left);

  // palm / heel of the hand against the left flank
  add(left, rounded(0.040, 0.062, 0.078, glove, 0.014, 3), 0, 0, 0);
  add(left, rounded(0.030, 0.020, 0.056, dark, 0.008, 2), -0.008, -0.022, 0.002, 0.06);
  // four fingers curling up and over the top of the handguard.  The curl sits
  // a few mm higher than before so the finger undersides rest on the handguard
  // rail plate instead of interpenetrating it (visible from the top view).
  for (let i = 0; i < 4; i++) {
    const z = -0.052 + i * 0.021;
    chain(left, [
      new THREE.Vector3(0.006, 0.026, z),
      new THREE.Vector3(0.022, 0.056, z - 0.002),
      new THREE.Vector3(0.048, 0.066, z - 0.004),
      new THREE.Vector3(0.070, 0.056, z - 0.006),
    ], 0.0092 - i * 0.0004, glove);
    // knuckle pad on the back of the finger, facing the camera
    add(left, rounded(0.013, 0.012, 0.014, dark, 0.004, 1),
      0.028, 0.068, z - 0.002, 0.1, 0, -0.2);
  }
  // thumb along the left flank, pointing toward the muzzle
  chain(left, [
    new THREE.Vector3(-0.012, 0.010, -0.026),
    new THREE.Vector3(-0.010, 0.016, -0.054),
    new THREE.Vector3(-0.002, 0.018, -0.078),
  ], 0.0106, glove);
  // left forearm: leaves the support wrist down/left/back out of the frame
  sleeveRun([
    new THREE.Vector3(-0.066, -0.026, -0.300),
    new THREE.Vector3(-0.140, -0.160, -0.175),
    new THREE.Vector3(-0.230, -0.330, 0.020),
    new THREE.Vector3(-0.300, -0.520, 0.230),
  ], 0.042, 0.055);
}

// ---------------------------------------------------------------------------
// Viewmodel builder
// ---------------------------------------------------------------------------

export function buildVxr7Viewmodel({ scene, muzzleLight }) {
  if (!scene) throw new Error('[vxr7] buildVxr7Viewmodel requires a scene');
  if (!muzzleLight) throw new Error('[vxr7] buildVxr7Viewmodel requires a muzzleLight');

  // ---- materials ----
  const steelCanvas = makeSteelTexture();
  const steelMap = new THREE.CanvasTexture(steelCanvas);
  steelMap.colorSpace = THREE.SRGBColorSpace;
  steelMap.wrapS = steelMap.wrapT = THREE.RepeatWrapping;
  steelMap.repeat.set(2, 1);
  steelMap.anisotropy = 8;

  const polymerCanvas = makePolymerTexture();
  const polymerMap = new THREE.CanvasTexture(polymerCanvas);
  polymerMap.colorSpace = THREE.SRGBColorSpace;
  polymerMap.wrapS = polymerMap.wrapT = THREE.RepeatWrapping;
  polymerMap.repeat.set(2, 2);
  polymerMap.anisotropy = 8;

  const matSteel = new THREE.MeshStandardMaterial({
    color: 0xc2c8cc, map: steelMap, metalness: 0.82, roughness: 0.32, envMapIntensity: 1.15,
  });
  const matSteelDark = new THREE.MeshStandardMaterial({
    color: 0x8c9297, map: steelMap, metalness: 0.85, roughness: 0.38, envMapIntensity: 1.05,
  });
  const matBlack = new THREE.MeshStandardMaterial({
    color: 0x474d50, map: polymerMap, metalness: 0.70, roughness: 0.47, envMapIntensity: 0.95,
  });
  const matPolymer = new THREE.MeshStandardMaterial({
    color: 0x7a7e80, map: polymerMap, metalness: 0.18, roughness: 0.7, envMapIntensity: 0.7,
  });
  const matRubber = new THREE.MeshStandardMaterial({ color: 0x151718, metalness: 0.05, roughness: 0.95 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0xd46b26, metalness: 0.55, roughness: 0.4 });
  const matBrass = new THREE.MeshStandardMaterial({ color: 0xd8a14c, metalness: 1.0, roughness: 0.25 });
  const matGlass = new THREE.MeshPhysicalMaterial({
    color: 0x7fb8c9, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.24,
    transmission: 0.2, clearcoat: 1,
  });
  const matGlove = new THREE.MeshStandardMaterial({
    color: 0x46392b, roughness: 0.9, metalness: 0.03,
  });
  const matGlovePalm = new THREE.MeshStandardMaterial({
    color: 0x544635, roughness: 0.86, metalness: 0.035,
  });
  const matGloveDark = new THREE.MeshStandardMaterial({
    color: 0x25251f, roughness: 0.86, metalness: 0.1,
  });
  const matSleeve = new THREE.MeshStandardMaterial({
    color: 0x2a2b23, roughness: 0.96, metalness: 0,
  });

  const root = new THREE.Group();
  scene.add(root);

  const gun = new THREE.Group();
  gun.scale.setScalar(0.62);
  root.add(gun);

  // ---- receiver / body ----
  add(gun, rounded(0.105, 0.11, 0.30, matSteel, 0.012, 2), 0, 0.005, -0.01);
  add(gun, rounded(0.096, 0.064, 0.31, matSteelDark, 0.014, 2), 0, 0.081, -0.015);
  add(gun, rounded(0.084, 0.072, 0.22, matBlack, 0.01, 2), 0, -0.048, 0.035);
  // ejection port
  add(gun, box(0.012, 0.034, 0.085, matBlack), 0.051, 0.055, -0.01);
  const bolt = add(gun, box(0.010, 0.026, 0.06, matSteel), 0.055, 0.062, -0.005);
  add(gun, rounded(0.024, 0.022, 0.038, matSteelDark, 0.004, 2), 0.058, 0.084, 0.035);
  // safety / selector
  add(gun, cyl(0.012, 0.012, 0.008, matAccent, 16), 0.058, 0.018, 0.058, 0, 0, Math.PI / 2);
  // warning band near receiver
  add(gun, box(0.104, 0.008, 0.102, matAccent), 0, 0.0, -0.12);

  // ---- full-length top rail ----
  const railCount = 15;
  const railGeo = new RoundedBoxGeometry(0.046, 0.018, 0.031, 1, 0.003);
  for (let i = 0; i < railCount; i++) {
    const m = new THREE.Mesh(railGeo, matSteelDark);
    add(gun, m, 0, 0.132, 0.075 - i * 0.039);
  }
  add(gun, box(0.052, 0.01, 0.56, matBlack), 0, 0.12, -0.19);

  // ---- handguard ----
  const hg = add(gun, rounded(0.084, 0.082, 0.30, matPolymer, 0.016, 2), 0, 0.012, -0.34);
  hg.rotation.z = 0.0;
  // rail segments under handguard
  add(gun, box(0.05, 0.01, 0.28, matBlack), 0, 0.059, -0.35);
  // vent slots (recessed dark) both sides + bottom
  for (let i = 0; i < 5; i++) {
    add(gun, box(0.004, 0.016, 0.032, matBlack), 0.043, 0.01, -0.25 - i * 0.05, 0, 0, 0.0);
    add(gun, box(0.004, 0.016, 0.032, matBlack), -0.043, 0.01, -0.25 - i * 0.05, 0, 0, 0.0);
    add(gun, box(0.022, 0.004, 0.034, matBlack), 0, -0.032, -0.25 - i * 0.05);
  }
  // side rail (M-LOK / picatinny accent)
  for (let i = 0; i < 4; i++) {
    add(gun, box(0.008, 0.012, 0.032, matAccent), 0.045, -0.01, -0.27 - i * 0.06);
  }
  // hand stop
  add(gun, rounded(0.022, 0.052, 0.03, matBlack, 0.006, 2), 0, -0.052, -0.43, -0.2);
  // gas block
  add(gun, rounded(0.048, 0.052, 0.06, matSteelDark, 0.006, 2), 0, 0.042, -0.53);
  // barrel
  const barrel = cyl(0.015, 0.018, 0.30, matBlack, 18);
  add(gun, barrel, 0, 0.03, -0.67, Math.PI / 2);
  // muzzle brake
  const brake = rounded(0.036, 0.036, 0.085, matSteel, 0.008, 2);
  add(gun, brake, 0, 0.03, -0.845);
  for (let i = 0; i < 3; i++) {
    add(gun, box(0.038, 0.007, 0.012, matBlack), 0, 0.03 + 0.009, -0.83 - i * 0.018);
  }
  add(gun, cyl(0.011, 0.013, 0.012, matBlack, 16), 0, 0.03, -0.89, Math.PI / 2);
  // front sight folded
  add(gun, box(0.02, 0.036, 0.02, matSteelDark), 0, 0.085, -0.53);
  add(gun, box(0.008, 0.018, 0.006, matSteel), 0, 0.105, -0.53);

  // ---- optic (open-hood holographic sight, deliberately skeletal) ----
  const optic = new THREE.Group();
  // sits directly on the top rail (rail top = 0.141) so it never looks like it
  // is floating above the receiver
  optic.position.set(0, 0.142, -0.005);
  gun.add(optic);
  // clamp block straddling the picatinny rail + cross bolt
  add(optic, rounded(0.064, 0.030, 0.086, matSteelDark, 0.006, 2), 0, -0.004, 0.002);
  add(optic, cyl(0.009, 0.009, 0.072, matSteel, 10), 0, -0.012, 0.0, 0, 0, Math.PI / 2);
  add(optic, box(0.016, 0.020, 0.024, matBlack), 0.040, -0.008, 0.018);
  // mount + body
  add(optic, rounded(0.060, 0.014, 0.092, matSteelDark, 0.004, 2), 0, 0.014, 0);
  add(optic, rounded(0.056, 0.020, 0.088, matBlack, 0.005, 2), 0, 0.030, 0.004);
  add(optic, rounded(0.050, 0.012, 0.072, matSteelDark, 0.004, 2), 0, 0.045, 0.004);
  // four slim uprights + open top hood, so the sand world stays visible through it
  for (const z of [-0.035, 0.035]) {
    add(optic, rounded(0.006, 0.052, 0.007, matSteelDark, 0.002, 1), -0.027, 0.072, z);
    add(optic, rounded(0.006, 0.052, 0.007, matSteelDark, 0.002, 1), 0.027, 0.072, z);
  }
  add(optic, rounded(0.064, 0.009, 0.086, matSteelDark, 0.003, 2), 0, 0.099, 0.0);
  add(optic, box(0.052, 0.003, 0.07, matSteel), 0, 0.105, 0.0);
  // glass + tiny bright holographic reticle
  const lens = add(optic, new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.045), matGlass), 0, 0.072, 0.048);
  lens.renderOrder = 2;
  const reticle = add(optic, new THREE.Mesh(
    new THREE.CircleGeometry(0.0055, 20),
    new THREE.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  ), 0, 0.072, 0.05);
  add(optic, new THREE.Mesh(
    new THREE.RingGeometry(0.0085, 0.0095, 24),
    new THREE.MeshBasicMaterial({ color: 0xff9a4a, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  ), 0, 0.072, 0.0502);
  // crosshair tick marks
  const tickMat = new THREE.MeshBasicMaterial({ color: 0xffb06a, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  add(optic, new THREE.Mesh(new THREE.PlaneGeometry(0.003, 0.012), tickMat), 0, 0.088, 0.0496);
  add(optic, new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.003), tickMat), 0, 0.056, 0.0496);
  // Reticle centre in gun space — the ADS pose is solved from this so the
  // holographic dot lands exactly on the screen crosshair (and therefore on
  // the bullet ray).
  const sightLocal = new THREE.Vector3(0, 0.142 + 0.072, -0.005 + 0.05);
  // adjustment knob, battery cap, qd lever
  add(optic, cyl(0.007, 0.007, 0.012, matSteel, 12), 0.032, 0.052, 0.0, 0, 0, Math.PI / 2);
  add(optic, cyl(0.006, 0.006, 0.009, matSteelDark, 12), 0, 0.034, 0.04);
  add(optic, box(0.014, 0.008, 0.026, matAccent), 0.038, 0.022, 0.0, 0, 0, 0.1);

  // ---- charging handle & bolt release ----
  const charge = new THREE.Group();
  charge.position.set(0, 0.105, 0.145);
  gun.add(charge);
  add(charge, box(0.045, 0.012, 0.018, matSteel), 0, 0, 0);
  add(charge, box(0.012, 0.018, 0.016, matSteelDark), -0.023, 0, 0.002);

  // ---- magazine ----
  const magGroup = new THREE.Group();
  magGroup.position.set(0, -0.096, 0.035);
  magGroup.rotation.x = -0.12;
  gun.add(magGroup);
  const magMesh = add(magGroup, rounded(0.062, 0.155, 0.095, matPolymer, 0.01, 2), 0, -0.07, 0.02);
  magMesh.rotation.x = -0.13;
  add(magGroup, rounded(0.068, 0.016, 0.10, matBlack, 0.005, 2), 0, -0.148, 0.03, -0.13);
  // witness strip of rounds
  for (let i = 0; i < 3; i++) {
    add(magGroup, cyl(0.005, 0.005, 0.056, matBrass, 10), 0, -0.02 - i * 0.018, 0.038, Math.PI / 2);
  }

  // ---- spare magazine (reload animation) ----
  const spare = new THREE.Group();
  const spareMesh = add(spare, rounded(0.062, 0.155, 0.095, matPolymer, 0.01, 2), 0, -0.07, 0.02);
  spareMesh.rotation.x = -0.13;
  add(spare, rounded(0.068, 0.016, 0.10, matBlack, 0.005, 2), 0, -0.148, 0.03, -0.13);
  spare.visible = false;
  gun.add(spare);

  // ---- pistol grip / trigger guard / trigger ----
  add(gun, rounded(0.056, 0.16, 0.075, matPolymer, 0.012, 2), 0, -0.115, 0.13, 0.21);
  add(gun, box(0.045, 0.012, 0.16, matBlack), 0, -0.074, 0.06, 0.08);
  add(gun, rounded(0.038, 0.008, 0.12, matBlack, 0.004, 2), 0, -0.098, 0.105);
  const trigger = add(gun, box(0.008, 0.032, 0.012, matSteelDark), 0, -0.087, 0.085, 0.2);
  // grip texture panels
  add(gun, box(0.005, 0.085, 0.06, matRubber), 0.03, -0.12, 0.14, 0.21);
  add(gun, box(0.005, 0.085, 0.06, matRubber), -0.03, -0.12, 0.14, 0.21);

  // ---- rear receiver cap (stock/butt is behind the camera and never shown,
  // which keeps the viewmodel silhouette clean) ----
  add(gun, rounded(0.085, 0.09, 0.02, matSteelDark, 0.006, 2), 0, 0.012, 0.152);
  add(gun, box(0.052, 0.016, 0.012, matBlack), 0, 0.062, 0.158);
  add(gun, cyl(0.012, 0.012, 0.014, matBrass, 12), 0.03, -0.02, 0.16, 0, 0, Math.PI / 2);
  // qd sling point on the left rear of the receiver
  add(gun, new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.003, 6, 12), matSteelDark), -0.052, -0.02, 0.155, 0, Math.PI / 2);

  // ---- rail light / laser module ----
  const lightMod = new THREE.Group();
  lightMod.position.set(0, -0.015, -0.32);
  gun.add(lightMod);
  add(lightMod, rounded(0.045, 0.034, 0.09, matBlack, 0.006, 2), 0.052, 0.0, 0);
  add(lightMod, cyl(0.012, 0.012, 0.015, matSteelDark, 14), 0.052, 0.0, -0.052, Math.PI / 2);
  add(lightMod, cyl(0.008, 0.008, 0.006, new THREE.MeshBasicMaterial({ color: 0x8fe8ff }), 14), 0.052, 0.0, -0.061, Math.PI / 2);
  // cable — both ends must terminate INSIDE geometry: the front end inside the
  // light-module body, the rear end inside the lower receiver (was floating in
  // mid-air ~5 mm behind the light and ~25 mm in front of the receiver).
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.052, -0.020, -0.300),
    new THREE.Vector3(0.06, -0.06, -0.20),
    new THREE.Vector3(0.030, -0.050, -0.055),
  ]);
  add(gun, new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.0035, 5), matRubber));

  // sling omitted from the viewmodel: a loose strap this close to the camera
  // reads as a floating stick and breaks the silhouette.

  // ---- markings / side plates ----
  const labelMat = new THREE.MeshBasicMaterial({
    map: makeLabelTexture(), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.92,
  });
  const label = add(gun, new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.033), labelMat), -0.0545, 0.008, 0.026, 0, -Math.PI / 2);
  label.renderOrder = 3;
  // recessed receiver side plate breaks up the silhouette and catches rim light
  add(gun, rounded(0.006, 0.072, 0.19, matSteelDark, 0.002, 1), -0.052, 0.002, -0.015);
  for (let i = 0; i < 3; i++) {
    add(gun, cyl(0.006, 0.006, 0.005, matSteel, 10), -0.056, 0.031, -0.085 + i * 0.062, 0, 0, Math.PI / 2);
    add(gun, cyl(0.0045, 0.0045, 0.004, matSteel, 10), -0.056, -0.028, -0.06 + i * 0.062, 0, 0, Math.PI / 2);
  }
  // ambi selector + glowing status bar + low-profile QD point
  add(gun, cyl(0.011, 0.011, 0.009, matAccent, 14), -0.058, -0.04, 0.075, 0, 0, Math.PI / 2);
  const statusMat = new THREE.MeshBasicMaterial({ color: 0x73e6ff, toneMapped: false });
  add(gun, new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.028), statusMat), -0.0575, 0.034, 0.078, 0, -Math.PI / 2);
  add(gun, new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0028, 6, 14), matSteelDark), -0.062, -0.005, 0.17, 0, Math.PI / 2);
  // stencilled warning stripe on the upper receiver
  add(gun, box(0.006, 0.014, 0.036, matAccent), -0.052, 0.052, 0.13, 0, 0, 0.06);
  // long accent rail + fire-mode pictogram break up the black slab
  add(gun, box(0.003, 0.006, 0.12, matAccent), -0.053, -0.008, 0.09);
  const modeTex = makeLabelTexture('SEMI // AUTO', '07-421');
  add(gun, new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.021),
    new THREE.MeshBasicMaterial({ map: modeTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.55 })),
    -0.054, 0.038, 0.075, 0, -Math.PI / 2);
  // small hex bolts around the side plate
  for (let i = 0; i < 4; i++) {
    add(gun, cyl(0.0045, 0.0045, 0.004, matSteel, 6), -0.0555, -0.045 + (i % 2) * 0.078, -0.02 + Math.floor(i / 2) * 0.055, 0, 0, Math.PI / 2);
  }
  // small serial plate on right side
  const serialTex = makeLabelTexture('SN 07-421', 'VXR // 5.56×45');
  const serialMat = new THREE.MeshBasicMaterial({ map: serialTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.62 });
  add(gun, new THREE.Mesh(new THREE.PlaneGeometry(0.10, 0.024), serialMat), 0.0535, -0.035, 0.06, 0, Math.PI / 2, 0);

  // ---- hands / arms ----
  buildHands(gun, { glove: matGlove, dark: matGloveDark, sleeve: matSleeve, palmMat: matGlovePalm, accent: matAccent });

  // ---- muzzle flash assembly ----
  const flashGroup = new THREE.Group();
  flashGroup.position.set(0, 0.03, -0.92);
  gun.add(flashGroup);
  const flashTex = makeFlashTexture();
  const flashMats = [];
  // Sprite-based flash: always camera-facing, additive (a black texel adds
  // nothing), and deliberately small so it can never fill the screen.
  const flashSpriteMat = new THREE.SpriteMaterial({
    map: flashTex, color: 0xffb45a, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false, toneMapped: false, opacity: 0,
  });
  flashMats.push(flashSpriteMat);
  const flashSprite = new THREE.Sprite(flashSpriteMat);
  flashSprite.scale.set(0.26, 0.26, 1);
  flashSprite.renderOrder = 5;
  flashSprite.frustumCulled = false;
  flashGroup.add(flashSprite);
  const coreMat = new THREE.SpriteMaterial({
    map: flashTex, color: 0xfff0c0, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false, toneMapped: false, opacity: 0,
  });
  flashMats.push(coreMat);
  const core = new THREE.Sprite(coreMat);
  core.scale.set(0.13, 0.13, 1);
  core.position.z = 0.01;
  core.renderOrder = 6;
  core.frustumCulled = false;
  flashGroup.add(core);
  // short forward cone gives the flash a physical volume from oblique angles
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xffa14a, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false, opacity: 0,
  });
  flashMats.push(coneMat);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.14, 8, 1, true), coneMat);
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = -0.07;
  cone.renderOrder = 5;
  flashGroup.add(cone);
  // muzzle position in gun space (also the smoke spawn point) and the flash light
  const muzzleLocal = new THREE.Vector3(0, 0.03, -0.95);
  muzzleLight.position.set(0, 0, -0.02);
  flashGroup.add(muzzleLight);

  // No square smoke cards in the viewmodel: they can catch a bad blend state
  // on some GPUs and read as a black panel. World-space smoke covers the mood.
  const smokePuffs = [];

  return {
    gunRoot: root,
    gun,
    matSteel,
    matSteelDark,
    matBlack,
    matPolymer,
    matRubber,
    matAccent,
    matBrass,
    matGlass,
    matGlove,
    matGlovePalm,
    matGloveDark,
    matSleeve,
    bolt,
    reticle,
    sightLocal,
    charging: charge,
    magazine: magGroup,
    spareMagazine: spare,
    trigger,
    flashGroup,
    flashMats,
    muzzleLocal,
    muzzleLight,
    smokePuffs,
  };
}
