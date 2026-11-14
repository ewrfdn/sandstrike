/**
 * KHARON-Ω — warlord chassis (ROBOT_TYPES.warlord).
 *
 * Elite, regal chassis rebuilt at high detail for the model-stage pass.  The
 * silhouette and gameplay data are unchanged: the tower shoulder blocks keep
 * their golden caps, reactor windows and glowing horn tips, the head keeps its
 * crown of three horns, gold brow bar and red visor slit, the chest keeps the
 * gold ring collar around the central core sphere, the left forearm is still a
 * handless ram-cannon and the right arm still carries the huge rifle.
 *
 * The detail comes from a small local kit of cached primitives on the rig's
 * shared geo library (bevelled gem-cut armour plates, higher-resolution
 * cylinders / spheres / a torus ring) plus massed armour layering: bevelled
 * pectoral shells, tiered pauldron lames, tasset skirts, cape plates, cooling
 * slats, pistons, hoses and bolt rows.  Every cached key is prefixed `warlord`
 * because the game shares ONE unit-geometry cache across all chassis rigs.
 *
 * `meta` / `def` are the original entries verbatim (pivots, hitboxes and the
 * muzzle offset depend on them) and the shared rig in ./shared.js still owns
 * animation pivots, hitboxes, draw batching and the primitive lifecycle.
 */
import * as THREE from 'three';

export const meta = { id: 'robot-warlord', kind: 'robot', group: 'robots', label: 'KHARON-Ω · 监军', type: 'warlord', defaultPose: 'base' };

/** The original ROBOT_TYPES entry minus combat stats, which live in src/config/enemies.js. */
export const def = {
  key: 'warlord',
  name: 'KHARON-Ω',
  displayName: 'KHARON-Ω // 卡戎监军',
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
  fire: { shots: 8, interval: 0.11, cooldown: 2.2, telegraph: 0.9, accuracy: 0.55, mag: 16, reload: 3.0 },
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

/* ================================================================== *
 *  Detail kit — bevelled plates + higher-resolution primitives.
 *
 *  Everything is cached on the rig's shared geo library (`b.geos`) exactly like
 *  the other chassis, so disposeUnitGeos() releases it with the stock set.  The
 *  `warlord` prefixes are mandatory: the game shares one geometry cache across
 *  every chassis rig and colliding names would corrupt other robots.
 * ================================================================== */
const HALF = Math.PI / 2;
const UP = new THREE.Vector3(0, 1, 0);

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _dir = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();
const _az = new THREE.Vector3();

// Plate outlines in a unit [-0.5, 0.5] box; the bevel grows them back to 1.0.
const PLATE_RECT = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
// Chamfered armour plate: rectangle with clipped corners (gem-cut look).
const PLATE_HEX = [
  [-0.38, -0.5], [0.38, -0.5], [0.5, -0.24], [0.5, 0.24],
  [0.38, 0.5], [-0.38, 0.5], [-0.5, 0.24], [-0.5, -0.24],
];
// Trapezoid: wider at the bottom, used for chest / shin / cape shells.
const PLATE_TRAP = [[-0.5, -0.5], [0.5, -0.5], [0.32, 0.5], [-0.32, 0.5]];

/** Extrude a bevel-edged plate that fits exactly in a 1 x 1 x 1 box. */
function bevelPlate(points, bevel = 0.04) {
  const k = 1 - bevel * 2;
  const shape = new THREE.Shape();
  for (let i = 0; i < points.length; i++) {
    const x = points[i][0] * k;
    const y = points[i][1] * k;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: k, steps: 1, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

function primitives(b) {
  if (b.geos.warlordPlate) return;
  const g = b.geos;
  g.warlordPlate = bevelPlate(PLATE_RECT, 0.04);
  g.warlordPlateHex = bevelPlate(PLATE_HEX, 0.05);
  g.warlordPlateTra = bevelPlate(PLATE_TRAP, 0.04);
  g.warlordCyl8 = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  g.warlordCyl12 = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
  g.warlordCyl16 = new THREE.CylinderGeometry(1, 1, 1, 16, 1);
  g.warlordCyl20 = new THREE.CylinderGeometry(1, 1, 1, 20, 1);
  g.warlordSphere10 = new THREE.SphereGeometry(1, 10, 8);
  g.warlordSphere12 = new THREE.SphereGeometry(1, 12, 10);
  g.warlordRing = new THREE.TorusGeometry(1, 0.14, 6, 12);
}

/** Push a custom geometry through the builder's bucket without cloning it. */
function emit(b, key, geoKey, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  _euler.set(rx, ry, rz);
  _quat.setFromEuler(_euler);
  _mat4.compose(_pos.set(x, y, z), _quat, _scl.set(w, h, d));
  b._push(key, b.geos[geoKey], _mat4.clone());
}

/**
 * Push a plate oriented by an explicit surface frame: local +Y runs along the
 * limb/edge it sits on, local +Z is the outward surface normal.
 */
function emitFrame(b, key, geoKey, w, len, thick, x, y, z, yAx, normal) {
  _ay.copy(yAx).normalize();
  _az.copy(normal).normalize();
  _ax.crossVectors(_ay, _az);
  _mat4.makeBasis(
    _scl.set(_ax.x * w, _ax.y * w, _ax.z * w),
    _pos.set(_ay.x * len, _ay.y * len, _ay.z * len),
    _dir.set(_az.x * thick, _az.y * thick, _az.z * thick),
  );
  _mat4.setPosition(x, y, z);
  b._push(key, b.geos[geoKey], _mat4.clone());
}

/** Bevelled armour plate (rect / hex / trapezoid outlines). */
function plate(b, key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, geoKey = 'warlordPlate') {
  primitives(b);
  emit(b, key, geoKey, w, h, d, x, y, z, rx, ry, rz);
}

function hexPlate(b, key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  plate(b, key, w, h, d, x, y, z, rx, ry, rz, 'warlordPlateHex');
}

function trapPlate(b, key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  plate(b, key, w, h, d, x, y, z, rx, ry, rz, 'warlordPlateTra');
}

/** Higher-resolution cylinder (axis = local Y before rotation). */
function cylN(b, key, seg, r, h, x, y, z, rx = 0, ry = 0, rz = 0) {
  primitives(b);
  b.cyl(key, r, h, x, y, z, rx, ry, rz, 'warlordCyl' + seg);
}

/** Higher-resolution sphere / ellipsoid. */
function ballN(b, key, seg, r, x, y, z, sx = 1, sy = 1, sz = 1) {
  primitives(b);
  emit(b, key, 'warlordSphere' + seg, r * sx, r * sy, r * sz, x, y, z);
}

/** Torus ring in the local XY plane (hole along Z). */
function torus(b, key, r, x, y, z, rx = 0, ry = 0, rz = 0) {
  primitives(b);
  emit(b, key, 'warlordRing', r, r, r, x, y, z, rx, ry, rz);
}

/** Cylinder spanning two points (pistons, cables, rods). */
function rod(b, key, seg, r, x1, y1, z1, x2, y2, z2) {
  primitives(b);
  _dir.set(x2 - x1, y2 - y1, z2 - z1);
  const len = _dir.length();
  if (len < 1e-4) return;
  _dir.divideScalar(len);
  _quat.setFromUnitVectors(UP, _dir);
  _mat4.compose(_pos.set((x1 + x2) * 0.5, (y1 + y2) * 0.5, (z1 + z2) * 0.5), _quat, _scl.set(r, len, r));
  b._push(key, b.geos['warlordCyl' + seg], _mat4.clone());
}

/** Hex bolt head with a slot across it. */
function bolt(b, key, r, depth, x, y, z, rx = 0, ry = 0, rz = 0) {
  primitives(b);
  b.cyl(key, r, depth, x, y, z, rx, ry, rz, 'warlordCyl8');
  _euler.set(rx, ry, rz);
  _quat.setFromEuler(_euler);
  _dir.set(0, 1, 0).applyQuaternion(_quat);
  _mat4.compose(
    _pos.set(x + _dir.x * depth * 0.22, y + _dir.y * depth * 0.22, z + _dir.z * depth * 0.22),
    _quat,
    _scl.set(r * 1.9, depth * 0.5, r * 0.42),
  );
  b._push('trim', b.geos.box, _mat4.clone());
}

/** Row of small slats (cooling vents, grilles, rails) stepping along a direction. */
function slatRow(b, key, n, w, h, d, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  _euler.set(rx, ry, rz);
  _quat.setFromEuler(_euler);
  for (let i = 0; i < n; i++) {
    const off = i - (n - 1) * 0.5;
    _mat4.compose(_pos.set(x + sx * off, y + sy * off, z + sz * off), _quat, _scl.set(w, h, d));
    b._push(key, b.geos.box, _mat4.clone());
  }
}

/** Plate placed at an offset in a rotated plate's local frame (for capes / skirts). */
function framePlate(b, key, w, h, d, cx, cy, cz, rx, ly, lz, geoKey = 'warlordPlate') {
  plate(b, key, w, h, d,
    cx, cy + ly * Math.cos(rx) - lz * Math.sin(rx), cz + ly * Math.sin(rx) + lz * Math.cos(rx), rx, 0, 0, geoKey);
}

/* ================================================================== *
 *  Chassis hooks
 * ================================================================== */

/** buildPelvis() — throne hip block: belt, tassets, crotch guard, rear power pack. */
function pelvis(b, M, def, { pw, ph, pd }) {
  b.buckets.clear();
  primitives(b);
  const hx = M.hipX;

  // massed hip block: dark frame, upper belt, lower skirt seal, gold belt band
  plate(b, 'dark', pw * 0.86, ph * 0.98, pd * 0.88, 0, 0, 0);
  plate(b, 'armor', pw * 1.0, ph * 0.42, pd * 1.0, 0, ph * 0.16, 0);
  plate(b, 'armor', pw * 0.88, ph * 0.4, pd * 0.94, 0, -ph * 0.28, 0);
  plate(b, 'trim', pw * 1.02, ph * 0.07, pd * 1.02, 0, -ph * 0.04, 0);
  // front belt seam plate + gold rivets, flanked by belt pouches
  plate(b, 'armor', pw * 0.52, ph * 0.3, pd * 0.14, 0, ph * 0.1, -pd * 0.46);
  for (const side of [-1, 1]) {
    bolt(b, 'trim', 0.013, 0.011, side * pw * 0.2, ph * 0.1, -pd * 0.536);
    plate(b, 'dark', pw * 0.16, ph * 0.3, pd * 0.14, side * pw * 0.34, -ph * 0.2, -pd * 0.42);
    plate(b, 'trim', pw * 0.18, ph * 0.06, pd * 0.16, side * pw * 0.34, -ph * 0.1, -pd * 0.43);
    // front hip actuator pistons
    rod(b, 'dark', 12, 0.013, side * pw * 0.34, -ph * 0.02, -pd * 0.4, side * pw * 0.4, -ph * 0.34, -pd * 0.3);
    rod(b, 'trim', 12, 0.007, side * pw * 0.28, ph * 0.02, -pd * 0.44, side * pw * 0.3, -ph * 0.26, -pd * 0.42);
  }
  // crotch guard + gold buckle + reactor slit
  trapPlate(b, 'armor', pw * 0.34, ph * 0.64, pd * 0.22, 0, -ph * 0.44, -pd * 0.42, -0.1);
  hexPlate(b, 'trim', pw * 0.18, ph * 0.16, 0.045, 0, -ph * 0.02, -pd * 0.49);
  b.box('core', pw * 0.1, 0.014, 0.02, 0, -ph * 0.02, -pd * 0.49 - 0.0325);

  // hip bearings: axle, outboard cap, bolt — plus the tasset skirt
  for (const side of [-1, 1]) {
    cylN(b, 'dark', 16, hx * 0.42, hx * 1.5, side * hx, -ph * 0.16, 0, 0, 0, HALF);
    cylN(b, 'trim', 12, hx * 0.3, 0.024, side * (hx * 1.75 - 0.004), -ph * 0.16, 0, 0, 0, HALF);
    bolt(b, 'trim', 0.013, 0.012, side * (hx * 1.75 + 0.008), -ph * 0.16, 0, 0, 0, HALF);
    hexPlate(b, 'armor', pw * 0.3, ph * 0.82, pd * 0.92, side * pw * 0.52, -ph * 0.22, 0, 0, 0, side * -0.24);
    plate(b, 'trim', pw * 0.06, ph * 0.66, pd * 0.44, side * pw * 0.62, -ph * 0.24, -pd * 0.14, 0, 0, side * -0.24);
    plate(b, 'dark', pw * 0.12, ph * 0.34, pd * 0.32, side * pw * 0.5, -ph * 0.36, pd * 0.18, 0, 0, side * -0.16);
    bolt(b, 'trim', 0.012, 0.011, side * pw * 0.5, -ph * 0.22, -pd * 0.48, HALF, 0, 0);
    // tasset gold stud + hip actuator cover
    plate(b, 'trim', 0.024, ph * 0.28, pd * 0.34, side * pw * 0.58, -ph * 0.06, -pd * 0.2, 0, 0, side * -0.24);
  }

  // rear power pack, armour face, cooling slats, warning light
  plate(b, 'dark', pw * 0.56, ph * 0.6, pd * 0.16, 0, -ph * 0.06, pd * 0.5);
  plate(b, 'armor', pw * 0.44, ph * 0.44, 0.05, 0, -ph * 0.06, pd * 0.56);
  slatRow(b, 'trim', 3, pw * 0.34, 0.014, 0.02, 0, -ph * 0.06, pd * 0.59, 0, 0.04, 0);
  b.box('accent', pw * 0.24, 0.022, 0.02, 0, ph * 0.36, pd * 0.453);
  plate(b, 'trim', pw * 0.5, 0.026, 0.05, 0, ph * 0.2, pd * 0.42);
  // pelvis-top power collar (the torso pivot rides inside it)
  cylN(b, 'dark', 16, pw * 0.26, ph * 0.24, 0, ph * 0.5, 0);
  cylN(b, 'trim', 20, pw * 0.3, 0.024, 0, ph * 0.52, 0);
  cylN(b, 'dark', 20, pw * 0.22, 0.03, 0, ph * 0.6, 0);
}

/** buildTorso() — layered chest, gold ring collar, tower shoulders + cape plates. */
function torso(b, M, def, { cw, ch, cd, cy }) {
  b.buckets.clear();
  primitives(b);
  const sy = M.shoulderY;
  const tx = M.shoulderX + cw * 0.06;
  const coreY = cy + ch * 0.08;

  // ---- core chassis: dark frame, upper chest, abdomen, waist seal ----
  plate(b, 'dark', cw * 0.88, ch * 0.96, cd * 0.88, 0, cy, 0);
  plate(b, 'armor', cw * 1.02, ch * 0.5, cd * 1.0, 0, cy + ch * 0.17, 0);
  plate(b, 'armor', cw * 0.9, ch * 0.24, cd * 0.92, 0, cy - ch * 0.3, 0);
  plate(b, 'dark', cw * 0.76, ch * 0.14, cd * 0.84, 0, cy - ch * 0.45, 0);
  // gold waist seam + flank rivets
  plate(b, 'trim', cw * 0.94, 0.026, cd * 0.96, 0, cy - ch * 0.37, 0);
  for (const side of [-1, 1]) {
    bolt(b, 'trim', 0.012, 0.011, side * cw * 0.36, cy - ch * 0.44, -cd * 0.44);
    plate(b, 'trim', 0.03, ch * 0.42, 0.04, side * cw * 0.46, cy - ch * 0.1, -cd * 0.41);
  }

  // ---- layered pectorals: trap shells, hex wings, sternum ridge, vents ----
  for (const side of [-1, 1]) {
    trapPlate(b, 'armor', cw * 0.46, ch * 0.34, cd * 0.18, side * cw * 0.23, cy + ch * 0.25, -cd * 0.47, -0.06, 0, side * 0.04);
    hexPlate(b, 'armor', cw * 0.3, ch * 0.2, cd * 0.14, side * cw * 0.32, cy + ch * 0.36, -cd * 0.42, -0.1, 0, side * 0.1);
    plate(b, 'trim', cw * 0.4, 0.026, 0.04, side * cw * 0.23, cy + ch * 0.12, -cd * 0.5);
    bolt(b, 'trim', 0.014, 0.012, side * cw * 0.3, cy + ch * 0.3, -cd * 0.47, HALF, 0, 0);
    slatRow(b, 'dark', 3, cw * 0.16, 0.014, 0.02, side * cw * 0.34, cy + ch * 0.44, -cd * 0.51, 0, 0.045, 0);
    // waist flank armour + gold rib
    plate(b, 'armor', cw * 0.1, ch * 0.44, cd * 0.76, side * cw * 0.455, cy - ch * 0.05, 0, 0, 0, side * 0.1);
    plate(b, 'trim', 0.024, ch * 0.3, cd * 0.5, side * cw * 0.51, cy - ch * 0.05, 0, 0, 0, side * 0.1);
    // abdomen rib vents
    slatRow(b, 'trim', 1, cw * 0.3, 0.014, 0.02, side * cw * 0.2, cy - ch * 0.28, -cd * 0.47, 0, 0.045, 0);
  }
  plate(b, 'trim', cw * 0.05, ch * 0.22, 0.05, 0, cy + ch * 0.38, -cd * 0.47);
  plate(b, 'trim', cw * 0.34, ch * 0.04, cd * 0.14, 0, cy - ch * 0.13, -cd * 0.5);
  plate(b, 'core', cw * 0.16, 0.012, 0.02, 0, cy - ch * 0.13, -cd * 0.52);

  // ---- reactor core: gold ring collar proud of the pectorals ----
  cylN(b, 'dark', 16, cw * 0.2, cd * 0.14, 0, coreY, -cd * 0.5, HALF, 0, 0);
  cylN(b, 'trim', 12, cw * 0.155, cd * 0.06, 0, coreY, -cd * 0.575, HALF, 0, 0);
  cylN(b, 'dark', 12, cw * 0.13, 0.03, 0, coreY, -cd * 0.62, HALF, 0, 0);
  torus(b, 'trim', cw * 0.165, 0, coreY, -cd * 0.585);
  ballN(b, 'core', 12, cw * 0.095, 0, coreY, -cd * 0.64);
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI + Math.PI / 2;
    b.box('core', 0.05, 0.016, 0.02, Math.cos(a) * cw * 0.118, coreY + Math.sin(a) * cw * 0.118, -cd * 0.64);
  }

  // ---- collar / neck column ----
  cylN(b, 'dark', 16, cw * 0.155, ch * 0.12, 0, cy + ch * 0.5, 0);
  cylN(b, 'trim', 20, cw * 0.22, 0.026, 0, cy + ch * 0.52, 0);
  cylN(b, 'dark', 12, cw * 0.1, ch * 0.2, 0, cy + ch * 0.62, 0);

  // ---- tower-like shoulder blocks: layered faces, caps, reactors, horns ----
  for (const side of [-1, 1]) {
    const tX = side * tx;
    plate(b, 'armor', cw * 0.3, ch * 0.46, cd * 0.72, tX, sy + ch * 0.36, 0.06, 0, 0, side * -0.1);
    plate(b, 'dark', cw * 0.24, ch * 0.36, cd * 0.28, tX, sy + ch * 0.36, -cd * 0.3, 0, 0, side * -0.1);
    plate(b, 'trim', cw * 0.32, ch * 0.09, cd * 0.76, tX, sy + ch * 0.62, 0.06, 0, 0, side * -0.1);
    plate(b, 'trim', cw * 0.26, ch * 0.06, cd * 0.6, tX, sy + ch * 0.695, 0.05, 0, 0, side * -0.1);
    // tower gusset into the chest
    plate(b, 'dark', cw * 0.16, ch * 0.34, cd * 0.5, side * (M.shoulderX + cw * 0.01), sy + ch * 0.15, 0.02, 0, 0, side * -0.1);
    // reactor window on the tower face
    cylN(b, 'dark', 12, ch * 0.1, 0.024, tX, sy + ch * 0.42, -cd * 0.44, HALF, 0, 0);
    cylN(b, 'core', 12, ch * 0.06, 0.03, tX, sy + ch * 0.42, -cd * 0.455, HALF, 0, 0);
    // golden horn beam + glowing tip (exact shared span keeps the silhouette height)
    rod(b, 'trim', 12, 0.022, tX, sy + ch * 0.64, -cd * 0.1, tX + side * cw * 0.1, sy + ch * 0.94, -cd * 0.24);
    ballN(b, 'core', 10, 0.035, tX + side * cw * 0.1, sy + ch * 0.94, -cd * 0.24);
    // outer gold rib + vent slats + service bolt
    plate(b, 'trim', 0.022, ch * 0.4, cd * 0.5, tX + side * cw * 0.14, sy + ch * 0.36, 0.04, 0, 0, side * -0.1);
    slatRow(b, 'dark', 2, 0.016, ch * 0.1, 0.02, tX + side * cw * 0.16, sy + ch * 0.34, 0.1, 0, 0.08, 0);
    bolt(b, 'trim', 0.014, 0.012, tX, sy + ch * 0.52, -cd * 0.46, HALF, 0, 0);
  }

  // ---- tiered pauldron wings (kept inside the original chest-width envelope) ----
  for (const side of [-1, 1]) {
    plate(b, 'armor', cw * 0.22, ch * 0.1, cd * 0.7, side * (M.shoulderX + cw * 0.14), sy + ch * 0.05, 0, 0, 0, side * 0.38);
    plate(b, 'trim', cw * 0.05, ch * 0.06, cd * 0.6, side * (M.shoulderX + cw * 0.2), sy + ch * 0.12, 0, 0, 0, side * 0.3);
    plate(b, 'armor', cw * 0.3, ch * 0.16, cd * 0.86, side * (M.shoulderX + cw * 0.04), sy + ch * 0.12, 0, 0, 0, side * 0.2);
    bolt(b, 'trim', 0.015, 0.013, side * (M.shoulderX + cw * 0.12), sy + ch * 0.1, -cd * 0.28, HALF, 0, 0);
    rod(b, 'trim', 12, 0.014, side * (M.shoulderX + cw * 0.12), sy + ch * 0.02, cd * 0.16, side * (M.shoulderX + cw * 0.14), sy - ch * 0.28, cd * 0.02);
  }

  // ---- back: shell, yoke, power pack, exhaust stacks, radiator grille ----
  plate(b, 'armor', cw * 0.78, ch * 0.34, cd * 0.12, 0, cy + ch * 0.16, cd * 0.44, 0.05);
  plate(b, 'trim', cw * 0.9, 0.03, cd * 0.3, 0, cy + ch * 0.47, 0);
  for (const side of [-1, 1]) {
    bolt(b, 'trim', 0.015, 0.013, side * cw * 0.3, cy + ch * 0.4, cd * 0.47, HALF, 0, 0);
    plate(b, 'trim', cw * 0.3, 0.03, 0.05, side * cw * 0.28, cy + ch * 0.34, cd * 0.44);
  }
  plate(b, 'dark', cw * 0.5, ch * 0.4, cd * 0.34, 0, cy + ch * 0.05, cd * 0.45);
  plate(b, 'armor', cw * 0.4, ch * 0.28, 0.05, 0, cy + ch * 0.05, cd * 0.62);
  plate(b, 'dark', cw * 0.34, ch * 0.16, 0.03, 0, cy + ch * 0.2, cd * 0.63);
  slatRow(b, 'trim', 5, cw * 0.26, 0.016, 0.02, 0, cy + ch * 0.2, cd * 0.65, 0, 0.038, 0);
  for (const side of [-1, 1]) {
    cylN(b, 'dark', 12, cw * 0.035, ch * 0.26, side * cw * 0.32, cy + ch * 0.22, cd * 0.42);
    cylN(b, 'trim', 8, cw * 0.045, 0.02, side * cw * 0.32, cy + ch * 0.357, cd * 0.42);
    cylN(b, 'core', 8, cw * 0.026, 0.022, side * cw * 0.32, cy + ch * 0.373, cd * 0.42);
  }

  // ---- three rear cape plates (signature; centre plate sets the rear envelope) ----
  for (let i = -1; i <= 1; i++) {
    const cx = i * cw * 0.3;
    const cz = i === 0 ? cd * 0.594 : cd * 0.57;
    const rx = i === 0 ? 0.25 : 0.2;
    const cyc = cy - ch * 0.12;
    plate(b, 'armor', cw * 0.26, ch * 0.58, 0.05, cx, cyc, cz, rx);
    // gold spine bar + hem band on the outward face
    framePlate(b, 'trim', cw * 0.06, ch * 0.4, 0.026, cx, cyc, cz, rx, -ch * 0.02, 0.037);
    framePlate(b, 'trim', cw * 0.24, 0.032, 0.02, cx, cyc, cz, rx, -ch * 0.24, 0.034);
    framePlate(b, 'dark', cw * 0.3, 0.04, 0.04, cx, cyc, cz, rx, ch * 0.24, 0.018);
    bolt(b, 'trim', 0.013, 0.011, cx, cy - ch * 0.02, cz + 0.02, HALF, 0, 0);
  }
}

/** buildHead() — crown helmet: three glowing horns, gold brow, visor slit, halo. */
function head(b, M, def, { w, h, d, y }) {
  b.buckets.clear();
  primitives(b);

  // helmet mass: dark shell, armour face, crown block, jaw
  plate(b, 'dark', w * 0.9, h * 0.86, d * 0.9, 0, y, 0.01);
  plate(b, 'armor', w * 0.94, h * 0.5, d * 0.78, 0, y + h * 0.1, -d * 0.1);
  trapPlate(b, 'armor', w * 0.98, h * 0.26, d * 0.56, 0, y + h * 0.4, 0.01, -0.05);
  plate(b, 'armor', w * 0.82, h * 0.28, d * 0.82, 0, y - h * 0.38, 0, -0.04);
  plate(b, 'trim', w * 0.5, h * 0.08, d * 0.2, 0, y - h * 0.5, -d * 0.4);
  // gold brow bar + centre ornament + angled brow tips
  plate(b, 'trim', w * 1.0, h * 0.085, d * 0.36, 0, y + h * 0.27, -d * 0.36, -0.16);
  hexPlate(b, 'trim', w * 0.16, h * 0.14, 0.03, 0, y + h * 0.23, -d * 0.555);
  for (const side of [-1, 1]) {
    plate(b, 'trim', w * 0.11, h * 0.13, d * 0.2, side * w * 0.42, y + h * 0.2, -d * 0.4, 0, side * 0.3, side * -0.22);
  }
  // visor recess + twin red slits split by a gold nose bridge
  plate(b, 'dark', w * 0.84, h * 0.22, 0.05, 0, y + h * 0.06, -d * 0.44);
  b.box('visor', w * 0.62, h * 0.085, 0.024, 0, y + h * 0.06, -d * 0.44 - 0.036);
  plate(b, 'trim', 0.02, h * 0.14, 0.05, 0, y + h * 0.06, -d * 0.44 - 0.034);
  for (const side of [-1, 1]) {
    b.box('accent', w * 0.045, h * 0.04, 0.02, side * w * 0.37, y + h * 0.06, -d * 0.475);
  }

  // crown of three horns with glowing tips
  for (let i = -1; i <= 1; i++) {
    const centre = i === 0;
    const x0 = i * w * 0.3;
    const x1 = i * w * (centre ? 0.08 : 0.52);
    const r = centre ? 0.034 : 0.026;
    const tipY = y + h * (centre ? 1.12 : 1.02);
    const tipZ = d * (centre ? 0.22 : 0.26);
    rod(b, 'trim', 12, r, x0, y + h * (centre ? 0.44 : 0.4), d * 0.06, x1, tipY, tipZ);
    ballN(b, 'core', 10, centre ? 0.042 : 0.032, x1, tipY, tipZ);
    // horn socket collar
    cylN(b, 'trim', 12, r * 1.7, 0.024, x0, y + h * 0.44, d * 0.06);
  }
  // regal gold halo ring mounted behind the crown
  torus(b, 'trim', w * 0.36, 0, y + h * 0.86, d * 0.28);
  plate(b, 'trim', w * 0.1, h * 0.14, 0.03, 0, y + h * 0.4, d * 0.28);

  // cheek guards, ear pods, jaw grille, gold chin bar, temple plates
  for (const side of [-1, 1]) {
    hexPlate(b, 'armor', w * 0.16, h * 0.34, d * 0.5, side * w * 0.45, y - h * 0.12, -d * 0.32, 0.04, side * 0.2, side * -0.12);
    cylN(b, 'dark', 16, h * 0.26, 0.05, side * w * 0.52, y + h * 0.06, 0.02, 0, 0, HALF);
    cylN(b, 'trim', 12, h * 0.155, 0.024, side * (w * 0.52 + 0.032), y + h * 0.06, 0.02, 0, 0, HALF);
    cylN(b, 'core', 8, h * 0.06, 0.014, side * (w * 0.52 + 0.036), y + h * 0.06, 0.02, 0, 0, HALF);
    bolt(b, 'trim', 0.011, 0.01, side * w * 0.34, y + h * 0.34, -d * 0.48);
    plate(b, 'trim', 0.02, h * 0.24, d * 0.22, side * w * 0.515, y + h * 0.12, -d * 0.16);
    slatRow(b, 'trim', 2, w * 0.05, 0.008, 0.016, side * w * 0.43, y - h * 0.3, -d * 0.4, 0, 0.028, 0);
  }
  plate(b, 'trim', w * 0.56, h * 0.07, d * 0.16, 0, y - h * 0.34, -d * 0.4);
  plate(b, 'dark', w * 0.62, h * 0.14, d * 0.24, 0, y - h * 0.42, -d * 0.28);
  slatRow(b, 'trim', 2, w * 0.44, 0.012, 0.018, 0, y - h * 0.42, -d * 0.4, 0, 0.028, 0);

  // rear helmet plate, crest fin, neck gorget
  plate(b, 'armor', w * 0.7, h * 0.26, 0.05, 0, y + h * 0.05, d * 0.44);
  plate(b, 'trim', w * 0.1, h * 0.5, d * 0.3, 0, y + h * 0.4, d * 0.18);
  plate(b, 'trim', w * 0.6, h * 0.08, d * 0.3, 0, y - h * 0.5, d * 0.1, 0.2);
  slatRow(b, 'trim', 2, w * 0.4, 0.012, 0.02, 0, y + h * 0.02, d * 0.49, 0, 0.034, 0);
  bolt(b, 'trim', 0.012, 0.011, w * 0.24, y - h * 0.06, d * 0.47, HALF, 0, 0);
}

/** buildArm() — right: fist + rifle grip; left: handless ram cannon. */
function arm(b, M, def, side, { bend, dirY, dirZ, elbowY, handY, handZ, midY, midZ, aw }) {
  b.buckets.clear();
  primitives(b);
  const upper = M.armUpper;
  const fore = M.armFore;
  const left = side < 0;
  const foreAx = new THREE.Vector3(0, -dirY, -dirZ); // elbow -> hand
  const foreFront = new THREE.Vector3(0, dirZ, -dirY); // forearm front normal
  const dirX = new THREE.Vector3(side, 0, 0);

  // shoulder: articulated ball + trim hub
  ballN(b, 'armor', 12, aw * (left ? 1.26 : 1.16), 0, 0, 0);
  cylN(b, 'dark', 16, aw * 0.62, aw * 0.9, 0, -aw * 0.06, 0);
  cylN(b, 'trim', 16, aw * 0.66, 0.022, 0, -aw * 0.04, 0);
  b.octa('trim', aw * 0.34, side * aw * 0.6, -aw * 0.04, 0);
  cylN(b, 'dark', 12, aw * 0.2, aw * 0.34, side * aw * 0.62, aw * 0.1, 0, 0, 0, HALF);  // shoulder cap lame over the ball
  emitFrame(b, 'armor', 'warlordPlate', aw * 1.3, aw * 0.62, aw * 0.2,
    0, aw * 0.12, -aw * 0.14, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));

  // upper arm: dark frame + front / outer armour shells + gold seam
  plate(b, 'dark', aw * 1.0, upper * 0.94, aw * 1.02, 0, elbowY * 0.5, 0);
  emitFrame(b, 'armor', 'warlordPlate', aw * 1.14, upper * 0.8, aw * 0.3,
    0, elbowY * 0.5, -aw * 0.44, new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1));
  emitFrame(b, 'armor', 'warlordPlate', aw * (left ? 0.38 : 0.34), upper * 0.78, aw * 1.08,
    side * aw * 0.52, elbowY * 0.5, 0, new THREE.Vector3(0, -1, 0), dirX);
  emitFrame(b, 'trim', 'warlordPlate', aw * 0.86, 0.022, aw * 0.9,
    0, elbowY * 0.82, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
  plate(b, 'dark', aw * 0.36, upper * 0.3, aw * 0.36, 0, elbowY * 0.35, aw * 0.44);
  // twin pistons + cable on the outer face
  rod(b, 'trim', 12, 0.013, side * aw * 0.46, -aw * 0.1, aw * 0.5, side * aw * 0.46, elbowY + 0.05, aw * 0.34);
  rod(b, 'dark', 12, 0.01, side * aw * 0.3, -aw * 0.16, aw * 0.52, side * aw * 0.32, elbowY + 0.02, aw * 0.28);
  rod(b, 'dark', 8, 0.007, -side * aw * 0.28, -aw * 0.1, -aw * 0.46, -side * aw * 0.28, elbowY + 0.06, -aw * 0.3);
  hexPlate(b, 'armor', aw * 0.6, upper * 0.24, aw * 0.24, 0, elbowY * 0.7, -aw * 0.55, 0.1);
  bolt(b, 'trim', 0.012, 0.011, side * aw * 0.66, elbowY * 0.6, 0, 0, 0, HALF);
  bolt(b, 'trim', 0.011, 0.01, side * aw * 0.56, midY, midZ, 0, 0, HALF);

  // elbow bearing + cap + guard
  cylN(b, 'dark', 16, aw * (left ? 0.66 : 0.6), aw * 1.3, 0, elbowY, 0, 0, 0, HALF);
  cylN(b, 'trim', 12, aw * 0.32, 0.022, side * aw * 0.66, elbowY, 0, 0, 0, HALF);
  b.octa('trim', aw * 0.17, side * aw * 0.72, elbowY, 0);
  plate(b, 'armor', aw * 0.55, aw * 0.4, aw * 0.5, 0, elbowY + aw * 0.14, -aw * 0.36, 0.18);
  b.box('accent', aw * 0.16, aw * 0.1, 0.02, 0, elbowY + aw * 0.06, -aw * 0.62);

  if (left) {
    /* ---- left forearm: handless ram cannon / siege shield ---- */
    plate(b, 'dark', aw * 1.0, fore * 0.98, aw * 0.98, 0, midY, midZ, bend);
    // ram shield slab on the outer face, with a gold boss
    emitFrame(b, 'armor', 'warlordPlate', aw * 1.35, fore * 1.02, aw * 0.42,
      -aw * 0.6, midY, midZ, foreAx, new THREE.Vector3(-1, 0, 0));
    emitFrame(b, 'armor', 'warlordPlateHex', aw * 1.12, fore * 0.78, aw * 0.26,
      0, midY, midZ, foreAx, foreFront);
    hexPlate(b, 'trim', aw * 0.62, aw * 0.62, 0.04, -aw * 0.885, midY, midZ, 0, HALF, 0);
    b.box('accent', aw * 0.3, aw * 0.3, 0.02, -aw * 1.0, midY, midZ, 0, HALF, 0);
    bolt(b, 'trim', 0.012, 0.011, -aw * 0.6, midY + dirY * fore * 0.28, midZ + dirZ * fore * 0.28, 0, 0, HALF);
    // handguard cuff + wrist collar
    cylN(b, 'dark', 12, aw * 0.48, 0.05, 0, handY + dirY * 0.1, handZ + dirZ * 0.1, bend);
    cylN(b, 'trim', 12, aw * 0.52, 0.022, 0, handY + dirY * 0.15, handZ + dirZ * 0.15, bend);
    // cannon cluster: central barrel + twins, coil rings, muzzle brake
    const c1y = handY + foreAx.y * aw * 1.5;
    const c1z = handZ + foreAx.z * aw * 1.5;
    rod(b, 'gun', 12, aw * 0.26, 0, midY + foreAx.y * aw * 0.4, midZ + foreAx.z * aw * 0.4, 0, c1y, c1z);
    for (const t of [-1, 1]) {
      rod(b, 'gun', 8, aw * 0.14,
        t * aw * 0.42, midY + foreAx.y * aw * 0.5, midZ + foreAx.z * aw * 0.5,
        t * aw * 0.42, c1y + foreAx.y * aw * 0.2, c1z + foreAx.z * aw * 0.2);
      cylN(b, 'trim', 8, aw * 0.18, 0.03,
        t * aw * 0.42, c1y + foreAx.y * aw * 0.1, c1z + foreAx.z * aw * 0.1, bend);
    }
    for (let i = 0; i < 2; i++) {
      const t = 0.16 + i * 0.17;
      cylN(b, 'trim', 12, aw * 0.3, 0.026, 0, midY + foreAx.y * fore * t * 0.6, midZ + foreAx.z * fore * t * 0.6, bend);
    }
    cylN(b, 'dark', 12, aw * 0.3, 0.07, 0, c1y, c1z, bend);
    cylN(b, 'trim', 12, aw * 0.32, 0.026, 0, c1y + foreAx.y * aw * 0.28, c1z + foreAx.z * aw * 0.28, bend);
    cylN(b, 'dark', 12, aw * 0.2, 0.02, 0, c1y + foreAx.y * aw * 0.34, c1z + foreAx.z * aw * 0.34, bend);
    b.octa('core', aw * 0.13, 0, c1y + foreAx.y * aw * 0.35, c1z + foreAx.z * aw * 0.35);
    return;
  }

  /* ---- right forearm: armoured bracer, wrist cuff, fist on the grip ---- */
  plate(b, 'dark', aw * 0.94, fore * 0.98, aw * 0.96, 0, midY, midZ, bend);
  emitFrame(b, 'armor', 'warlordPlate', aw * 1.16, fore * 0.86, aw * 0.3,
    0, midY + foreFront.y * aw * 0.5, midZ + foreFront.z * aw * 0.5, foreAx, foreFront);
  emitFrame(b, 'armor', 'warlordPlate', aw * 0.3, fore * 0.8, aw * 1.08,
    side * aw * 0.5, midY, midZ, foreAx, dirX);
  emitFrame(b, 'trim', 'warlordPlate', aw * 1.0, fore * 0.09, aw * 0.34,
    0, midY + foreFront.y * aw * 0.52, midZ + foreFront.z * aw * 0.52, foreAx, foreFront);
  for (let i = -1; i <= 1; i++) {
    const t = i * 0.035;
    b.box('dark', aw * 0.3, 0.012, 0.018,
      side * aw * 0.4,
      midY + dirY * t + foreFront.y * aw * 0.44,
      midZ + dirZ * t + foreFront.z * aw * 0.44,
      bend);
  }
  cylN(b, 'dark', 12, aw * 0.44, 0.05, 0, handY + dirY * 0.08, handZ + dirZ * 0.08, bend);
  cylN(b, 'trim', 12, aw * 0.5, 0.02, 0, handY + dirY * 0.13, handZ + dirZ * 0.13, bend);
  // right wrist ammo counter
  plate(b, 'dark', 0.018, aw * 0.32, aw * 0.38, aw * 0.6, midY + dirY * 0.1, midZ + dirZ * 0.1, bend);
  b.box('core', 0.007, 0.011, 0.028, aw * 0.64, midY + dirY * 0.12, midZ + dirZ * 0.12, bend);

  // hand: compact fist (palm + knuckle plate + fingers + thumb)
  plate(b, 'dark', aw * 1.0, aw * 1.1, aw * 1.15, 0, handY - dirY * aw * 0.5, handZ - dirZ * aw * 0.5, bend);
  emitFrame(b, 'armor', 'warlordPlate', aw * 0.9, aw * 0.85, aw * 0.22,
    0, handY - dirY * aw * 0.5 + foreFront.y * aw * 0.494, handZ - dirZ * aw * 0.5 + foreFront.z * aw * 0.494, foreAx, foreFront);
  for (let i = 0; i < 3; i++) {
    const fx = (i - 1) * aw * 0.27;
    b.box('dark', aw * 0.22, aw * 0.6, aw * 0.3, fx, handY - dirY * aw * 0.99, handZ - dirZ * aw * 0.99 - aw * 0.112, bend);
    b.box('trim', aw * 0.2, aw * 0.16, aw * 0.24, fx, handY - dirY * aw * 1.08, handZ - dirZ * aw * 1.08 - aw * 0.112, bend);
  }
  b.box('dark', aw * 0.24, aw * 0.4, aw * 0.36, side * aw * 0.46, handY - dirY * aw * 0.8, handZ - dirZ * aw * 0.8 - aw * 0.08, bend);
  bolt(b, 'trim', 0.012, 0.011, 0, handY - dirY * aw * 0.5 + foreFront.y * aw * 0.52, handZ - dirZ * aw * 0.5 + foreFront.z * aw * 0.52, bend);
}

/** buildLeg() — hip bearing, layered thigh, knee guard, greave, armoured boot. */
function leg(b, M, def, side, { w, a1, a2, kneeY, kneeZ, ankleY, ankleZ, thighDirY, thighDirZ, shinDirY, shinDirZ, footY }) {
  b.buckets.clear();
  primitives(b);
  const thigh = M.legThigh;
  const shin = M.legShin;
  const thighAx = new THREE.Vector3(0, -thighDirY, -thighDirZ);
  const shinAx = new THREE.Vector3(0, -shinDirY, -shinDirZ);
  const thighFront = new THREE.Vector3(0, thighDirZ, -thighDirY);
  const shinFront = new THREE.Vector3(0, shinDirZ, -shinDirY);
  const dirX = new THREE.Vector3(side, 0, 0);
  const kneeMidY = kneeY * 0.5;
  const kneeMidZ = kneeZ * 0.5;
  const sy = (kneeY + ankleY) * 0.5;
  const sz = (kneeZ + ankleZ) * 0.5;

  // hip bearing + outboard caps
  ballN(b, 'dark', 10, w * 0.62, 0, 0, 0);
  cylN(b, 'dark', 16, w * 0.46, w * 1.25, 0, 0, 0, 0, 0, HALF);
  cylN(b, 'trim', 12, w * 0.3, 0.022, side * w * 0.68, 0, 0, 0, 0, HALF);
  bolt(b, 'trim', 0.013, 0.012, side * w * 0.72, 0, 0, 0, 0, HALF);

  // thigh: dark frame + front shell + outer shell + gold seam + rear actuator
  plate(b, 'dark', w * 0.84, thigh * 0.94, w * 0.86, 0, kneeMidY, kneeMidZ, a1);
  emitFrame(b, 'armor', 'warlordPlate', w * 1.14, thigh * 0.86, w * 0.26,
    thighFront.x * w * 0.45, kneeMidY + thighFront.y * w * 0.45, kneeMidZ + thighFront.z * w * 0.45, thighAx, thighFront);
  emitFrame(b, 'armor', 'warlordPlate', w * 0.28, thigh * 0.82, w * 1.14, side * w * 0.48, kneeMidY, kneeMidZ, thighAx, dirX);
  emitFrame(b, 'trim', 'warlordPlate', w * 0.9, 0.024, w * 0.96, 0, kneeY * 0.7, kneeZ * 0.7,
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
  plate(b, 'dark', w * 0.58, thigh * 0.5, w * 0.3, 0, kneeMidY, kneeMidZ + w * 0.5, a1);
  bolt(b, 'trim', 0.013, 0.012, side * w * 0.3, kneeY * 0.32, kneeZ * 0.32 - w * 0.72, a1);
  // knee piston pair on the front groove
  for (const t of [-1, 1]) {
    rod(b, 'trim', 12, 0.013,
      side * w * 0.3, kneeMidY + thighFront.y * w * 0.3, kneeMidZ + thighFront.z * w * 0.3,
      side * w * 0.26, kneeY + w * 0.08, kneeZ - w * 0.34);
  }
  plate(b, 'trim', w * 0.16, thigh * 0.3, w * 0.24, 0, kneeMidY, kneeMidZ - w * 0.52, a1);

  // knee: bearing axle, cap, kneecap guard, gold horn fin, glow slit
  cylN(b, 'dark', 16, w * 0.48, w * 1.24, 0, kneeY, kneeZ, 0, 0, HALF);
  cylN(b, 'trim', 12, w * 0.28, 0.022, side * w * 0.64, kneeY, kneeZ, 0, 0, HALF);
  hexPlate(b, 'armor', w * 0.86, w * 0.66, w * 0.5, 0, kneeY + w * 0.08, kneeZ - w * 0.42, -0.22);
  plate(b, 'trim', w * 0.46, w * 0.14, 0.04, 0, kneeY + w * 0.2, kneeZ - w * 0.62, -0.22);
  trapPlate(b, 'trim', w * 0.26, w * 0.36, 0.05, 0, kneeY + w * 0.3, kneeZ - w * 0.4, 0.32);
  b.box('dark', w * 0.5, w * 0.12, w * 0.14, 0, kneeY - w * 0.06, kneeZ - w * 0.55);
  b.box('core', w * 0.24, 0.012, 0.02, 0, kneeY + w * 0.26, kneeZ - w * 0.66);
  bolt(b, 'trim', 0.012, 0.011, side * w * 0.42, kneeY, kneeZ, 0, 0, HALF);

  // shin: frame + front greave + outer shell + gold ridge + vents + pistons
  plate(b, 'dark', w * 0.78, shin * 0.94, w * 0.8, 0, sy, sz, a2);
  emitFrame(b, 'armor', 'warlordPlate', w * 1.0, shin * 0.88, w * 0.24,
    0, sy + shinFront.y * w * 0.42, sz + shinFront.z * w * 0.42, shinAx, shinFront);
  emitFrame(b, 'armor', 'warlordPlate', w * 0.24, shin * 0.84, w * 1.06, side * w * 0.44, sy, sz, shinAx, dirX);
  emitFrame(b, 'trim', 'warlordPlate', w * 0.8, 0.026, w * 0.2,
    0, sy + shinFront.y * w * 0.45, sz + shinFront.z * w * 0.45, shinAx, shinFront);
  // shin cooling vents, seated on the greave face (1 mm sink so they read as slots)
  const greaveY = sy + shinFront.y * w * 0.42;
  const greaveZ = sz + shinFront.z * w * 0.42;
  const ventOff = w * 0.12 + 0.024;
  for (let i = -1; i <= 1; i++) {
    b.box('dark', w * 0.4, 0.012, 0.05,
      0,
      greaveY + shinAx.y * i * 0.07 + shinFront.y * ventOff,
      greaveZ + shinAx.z * i * 0.07 + shinFront.z * ventOff,
      a2);
  }
  for (const sx of [-w * 0.3, w * 0.3]) {
    rod(b, 'trim', 12, 0.012, sx, kneeY - w * 0.06, kneeZ + w * 0.24, sx, ankleY + w * 0.12, ankleZ + w * 0.24);
  }
  cylN(b, 'dark', 12, w * 0.4, 0.03, 0, ankleY + w * 0.3, ankleZ);
  cylN(b, 'trim', 12, w * 0.34, 0.02, 0, ankleY + w * 0.2, ankleZ);

  // ankle joint
  ballN(b, 'dark', 12, w * 0.44, 0, ankleY, ankleZ);
  cylN(b, 'trim', 16, w * 0.28, 0.03, side * w * 0.34, ankleY, ankleZ, 0, 0, HALF);
  bolt(b, 'trim', 0.011, 0.01, side * w * 0.4, ankleY, ankleZ, 0, 0, HALF);

  // boot: sole, body, split toe caps, heel, ankle collar, treads, gold trim.
  // The sole bottom is authored 7 mm below the ground plane like the stock foot.
  const fz = ankleZ - M.footL * 0.32;
  const ground = footY - M.footH * 0.5 - 0.007;
  b.box('dark', M.footW * 1.04, 0.05, M.footL * 1.04, 0, ground + 0.025, fz);
  plate(b, 'dark', M.footW * 0.94, M.footH * 0.72, M.footL * 0.94, 0, footY + 0.01, fz);
  trapPlate(b, 'armor', M.footW * 0.9, M.footH * 0.56, M.footL * 0.42, 0, footY + 0.04, fz - M.footL * 0.34, -0.06);
  plate(b, 'armor', M.footW * 0.84, M.footH * 0.6, M.footL * 0.3, 0, footY + M.footH * 0.42, fz + M.footL * 0.3);
  plate(b, 'trim', M.footW * 0.78, M.footH * 0.24, M.footL * 0.16, 0, footY + M.footH * 0.11, fz - M.footL * 0.5, 0.1);
  plate(b, 'dark', M.footW * 0.68, M.footH * 0.46, M.footL * 0.14, 0, footY + M.footH * 0.12, fz + M.footL * 0.46);
  for (const toe of [-1, 1]) {
    b.box('gun', M.footW * 0.4, M.footH * 0.3, M.footL * 0.16, toe * M.footW * 0.24, footY + M.footH * 0.2, fz - M.footL * 0.42);
    b.box('trim', M.footW * 0.28, 0.012, 0.014, toe * M.footW * 0.24, footY + M.footH * 0.32, fz - M.footL * 0.42);
  }
  for (let i = 0; i < 5; i++) {
    b.box('dark', M.footW * 1.04, 0.022, M.footL * 0.08, 0, ground + 0.011, fz - M.footL * 0.34 + i * M.footL * 0.17);
  }
  for (const sx of [-1, 1]) {
    b.box('dark', 0.014, M.footH * 0.24, M.footL * 0.16, sx * M.footW * 0.49, footY + M.footH * 0.16, fz - M.footL * 0.1);
    b.box('trim', 0.012, 0.014, M.footL * 0.12, sx * M.footW * 0.5, footY + M.footH * 0.3, fz - M.footL * 0.12);
  }
  b.box('accent', M.footW * 0.18, 0.012, 0.014, 0, footY + M.footH * 0.36, fz - M.footL * 0.44);
  bolt(b, 'trim', 0.013, 0.012, side * M.footW * 0.28, footY + M.footH * 0.1, fz - M.footL * 0.3);
}

/** buildGun() — KHARON-Ω heavy rifle: shroud, rails, optic, brake, twin barrels. */
function gun(b, M, def, { s, bodyW, bodyH, bodyL, barrelLen, bodyCenterZ, barrelCenterZ, tipZ }) {
  b.buckets.clear();
  primitives(b);
  const boreY = 0.05 * s;

  // receiver: main body, upper/lower shells, side panels, gold inlay, ejection port
  plate(b, 'gun', bodyW * 1.06, bodyH * 0.96, bodyL * 0.8, 0, boreY, bodyCenterZ);
  plate(b, 'dark', bodyW * 0.98, bodyH * 0.28, bodyL * 0.72, 0, boreY + bodyH * 0.42, bodyCenterZ);
  plate(b, 'dark', bodyW * 0.9, bodyH * 0.26, bodyL * 0.5, 0, boreY - bodyH * 0.4, bodyCenterZ - 0.02 * s);
  for (const side of [-1, 1]) {
    plate(b, 'gun', 0.012, bodyH * 0.5, bodyL * 0.6, side * bodyW * 0.55, boreY, bodyCenterZ - 0.02 * s);
    plate(b, 'trim', 0.008, 0.02 * s, bodyL * 0.44, side * bodyW * 0.57, boreY + bodyH * 0.18, bodyCenterZ - 0.02 * s);
  }
  b.box('dark', 0.03 * s, 0.06 * s, 0.12 * s, bodyW * 0.5, boreY + bodyH * 0.12, bodyCenterZ + 0.1 * s);
  // top rail + gold rail cap + slots
  plate(b, 'dark', bodyW * 0.7, 0.02 * s, bodyL * 0.9, 0, boreY + bodyH * 0.54, bodyCenterZ);
  plate(b, 'trim', bodyW * 0.55, 0.035 * s, bodyL * 0.86, 0, boreY + bodyH * 0.62, bodyCenterZ);
  slatRow(b, 'gun', 5, bodyW * 0.4, 0.012 * s, 0.02 * s, 0, boreY + bodyH * 0.62 + 0.028 * s, bodyCenterZ, 0, 0, 0.05 * s);
  // rail sag: accent sphere ornament (signature) on a gold mount
  cylN(b, 'trim', 12, 0.03 * s, 0.02 * s, 0, boreY + bodyH * 0.72, bodyCenterZ - 0.1 * s);
  ballN(b, 'accent', 10, 0.05 * s, 0, boreY + bodyH * 0.77, bodyCenterZ - 0.1 * s);

  // stock: buffer tube, cheek rest, butt plate, hinge
  cylN(b, 'dark', 16, 0.03 * s, 0.14 * s, 0, boreY + bodyH * 0.18, bodyCenterZ + bodyL * 0.5 + 0.05 * s, HALF, 0, 0);
  plate(b, 'gun', 0.06 * s, 0.12 * s, 0.22 * s, 0, boreY + 0.006 * s, bodyCenterZ + bodyL * 0.5 + 0.16 * s);
  plate(b, 'trim', 0.07 * s, 0.14 * s, 0.03 * s, 0, boreY + 0.006 * s, bodyCenterZ + bodyL * 0.5 + 0.28 * s);
  plate(b, 'dark', 0.05 * s, 0.04 * s, 0.16 * s, 0, boreY + bodyH * 0.36, bodyCenterZ + bodyL * 0.5 + 0.14 * s);
  bolt(b, 'trim', 0.012 * s, 0.012 * s, 0, boreY - bodyH * 0.1, bodyCenterZ + bodyL * 0.5 + 0.1 * s, HALF, 0, 0);

  // pistol grip + trigger guard + trigger
  plate(b, 'dark', 0.06 * s, 0.2 * s, 0.09 * s, 0, -0.1 * s, bodyCenterZ + 0.06 * s, 0.24);
  b.box('dark', 0.06 * s, 0.02 * s, 0.08 * s, 0, -0.2 * s, bodyCenterZ + 0.09 * s, 0.24);
  for (let i = 0; i < 2; i++) {
    b.box('trim', 0.056 * s, 0.01 * s, 0.07 * s, 0, (-0.1 - i * 0.045) * s, bodyCenterZ + (0.05 + i * 0.02) * s, 0.24);
  }
  b.beam('gun', 0, -0.035 * s, -0.025 * s, 0, -0.115 * s, -0.06 * s, 0.009 * s);
  b.beam('gun', 0, -0.115 * s, -0.06 * s, 0, -0.115 * s, 0.037 * s, 0.009 * s);
  b.box('trim', 0.014 * s, 0.05 * s, 0.014 * s, 0, -0.075 * s, -0.02 * s, 0.2);

  // magazine: two-stage curved body + ribs + gold base plate
  plate(b, 'dark', 0.07 * s, 0.16 * s, 0.1 * s, 0, -0.1 * s, bodyCenterZ + 0.02 * s, 0.16);
  plate(b, 'gun', 0.065 * s, 0.12 * s, 0.09 * s, 0, -0.21 * s, bodyCenterZ + 0.05 * s, 0.3);
  plate(b, 'trim', 0.07 * s, 0.02 * s, 0.09 * s, 0, -0.27 * s, bodyCenterZ + 0.06 * s, 0.3);
  for (let i = 0; i < 2; i++) {
    b.box('trim', 0.068 * s, 0.008 * s, 0.07 * s, 0, (-0.13 - i * 0.035) * s, bodyCenterZ + (0.03 + i * 0.012) * s, 0.24);
  }

  // heavy shroud around the receiver front + side panels + gold trims
  plate(b, 'armor', bodyW * 1.68, bodyH * 1.24, bodyL * 0.56, 0, boreY, bodyCenterZ - 0.02 * s);
  for (const side of [-1, 1]) {
    plate(b, 'dark', 0.014, bodyH * 0.86, bodyL * 0.4, side * bodyW * 0.86, boreY, bodyCenterZ - 0.04 * s);
    slatRow(b, 'trim', 3, 0.016, bodyH * 0.5, 0.02, side * bodyW * 0.88, boreY, bodyCenterZ - 0.04 * s, 0, 0, 0.05 * s);
  }
  slatRow(b, 'gun', 2, bodyW * 0.9, 0.02 * s, 0.03 * s, 0, boreY + bodyH * 0.66, bodyCenterZ + 0.1 * s, 0, 0, 0.06 * s);

  // handguard: shell, side panels, vent slots, gold collar
  plate(b, 'gun', bodyW * 1.1, bodyH * 0.92, 0.42 * s, 0, boreY, bodyCenterZ - 0.36 * s);
  for (const side of [-1, 1]) {
    plate(b, 'dark', 0.012, bodyH * 0.52, 0.34 * s, side * bodyW * 0.57, boreY, bodyCenterZ - 0.36 * s);
  }
  plate(b, 'dark', 0.04 * s, 0.012 * s, 0.34 * s, 0, boreY + bodyH * 0.52, bodyCenterZ - 0.36 * s);
  slatRow(b, 'dark', 4, 0.05 * s, 0.008 * s, 0.02 * s, 0, boreY + bodyH * 0.53, bodyCenterZ - 0.36 * s, 0, 0, 0.045 * s);
  for (let i = 0; i < 2; i++) {
    b.box('dark', bodyW * 0.72, 0.026 * s, 0.014 * s, 0, boreY - bodyH * 0.16, bodyCenterZ - 0.28 * s - i * 0.045 * s);
  }
  cylN(b, 'trim', 16, 0.048 * s, 0.026 * s, 0, boreY, bodyCenterZ - 0.49 * s, HALF, 0, 0);
  plate(b, 'dark', 0.03 * s, 0.1 * s, 0.06 * s, 0, boreY - 0.06 * s, bodyCenterZ - 0.37 * s, 0.1);

  // barrel cluster: central barrel, twin extra barrels, gas block, shroud rings
  cylN(b, 'gun', 12, 0.026 * s, barrelLen, 0, boreY, barrelCenterZ, HALF, 0, 0);
  for (const side of [-1, 1]) {
    cylN(b, 'dark', 8, 0.018 * s, barrelLen * 0.88, side * 0.075 * s, boreY - 0.005 * s, barrelCenterZ + 0.03 * s, HALF, 0, 0);
    cylN(b, 'trim', 8, 0.026 * s, 0.03 * s, side * 0.075 * s, boreY - 0.005 * s, tipZ + 0.05 * s, HALF, 0, 0);
  }
  for (let i = 0; i < 2; i++) {
    cylN(b, 'dark', 12, 0.05 * s, 0.022 * s, 0, boreY, barrelCenterZ + barrelLen * (0.22 - i * 0.24), HALF, 0, 0);
  }
  plate(b, 'dark', 0.06 * s, 0.06 * s, 0.06 * s, 0, boreY + 0.03 * s, barrelCenterZ + barrelLen * 0.26);
  plate(b, 'gun', 0.03 * s, 0.014 * s, 0.07 * s, 0, boreY + 0.048 * s, barrelCenterZ - barrelLen * 0.06);
  b.box('gun', 0.012 * s, 0.034 * s, 0.014 * s, 0, boreY + 0.0715 * s, barrelCenterZ - barrelLen * 0.06);

  // muzzle brake: exact shared bore front (gameplay flash origin is on the muzzle)
  cylN(b, 'dark', 16, 0.062 * s, 0.09 * s, 0, boreY, tipZ + 0.02, HALF, 0, 0);
  cylN(b, 'trim', 12, 0.068 * s, 0.016 * s, 0, boreY, tipZ + 0.085, HALF, 0, 0);
  cylN(b, 'gun', 12, 0.03 * s, 0.02 * s, 0, boreY, tipZ + 0.02, HALF, 0, 0);
  for (const side of [-1, 1]) {
    b.box('dark', 0.014 * s, 0.034 * s, 0.016 * s, side * 0.052 * s, boreY, tipZ + 0.02);
  }

  // reflex optic on the rail
  plate(b, 'dark', 0.05 * s, 0.016 * s, 0.13 * s, 0, boreY + bodyH * 0.8, bodyCenterZ + 0.04 * s);
  for (const side of [-1, 1]) {
    plate(b, 'dark', 0.014 * s, 0.06 * s, 0.04 * s, side * 0.024 * s, boreY + bodyH * 0.92, bodyCenterZ + 0.04 * s);
  }
  cylN(b, 'gun', 12, 0.026 * s, 0.1 * s, 0, boreY + bodyH * 1.02, bodyCenterZ + 0.04 * s, HALF, 0, 0);
  cylN(b, 'trim', 12, 0.03 * s, 0.014 * s, 0, boreY + bodyH * 1.02, bodyCenterZ - 0.01 * s, HALF, 0, 0);
  b.octa('core', 0.012 * s, 0, boreY + bodyH * 1.02, bodyCenterZ + 0.09 * s);
  // charging handle, sling loop, bolt
  b.box('dark', 0.022 * s, 0.022 * s, 0.05 * s, bodyW * 0.62, boreY + bodyH * 0.3, bodyCenterZ + 0.12 * s);
  plate(b, 'trim', 0.014 * s, 0.05 * s, 0.03 * s, -bodyW * 0.58, boreY - bodyH * 0.2, bodyCenterZ + bodyL * 0.3);
  bolt(b, 'trim', 0.012 * s, 0.012 * s, bodyW * 0.6, boreY, bodyCenterZ - 0.14 * s, 0, 0, HALF);

  // keep the exact shared muzzle offset (flash / tracer origin)
  return { tipY: boreY, tipZ };
}

/** buildRobotRig() — shoulder-tower hitboxes (torso zone, unchanged gameplay volumes). */
function hitboxes(addHit, torso, M, def) {
  for (const side of [-1, 1]) {
    addHit('torso', torso,
      M.chestW * 0.34, M.chestH * 0.54, M.chestD * 0.8,
      side * (M.shoulderX + M.chestW * 0.06), M.shoulderY + M.chestH * 0.44, 0.03);
  }
}

export const hooks = { pelvis, torso, head, arm, leg, gun, hitboxes };
