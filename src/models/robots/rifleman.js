/**
 * VULTURE-3 — rifleman chassis (ROBOT_TYPES.rifleman).
 *
 * Front-line rifleman of the VULTURE family: heavy layered armour, a drum-fed
 * rifle and a sensor-boom head.  The chassis is built at high detail: massed
 * armour volumes carry thin bevelled panel plates, joints are higher-resolution
 * bearings (12/16-segment cylinders, 12x10 spheres) and the silhouette is
 * broken up by bolts, cooling slats, cables, tiered pauldrons, the ammo-drum
 * backpack with its feed chute and a re-detailed rifle.
 *
 * Gameplay `def` (dimensions, pivots, hitboxes, muzzle) is unchanged: the shared
 * rig in ./shared.js still owns animation pivots, hitboxes and draw batching, and
 * gun() returns the exact shared default muzzle offset.
 */
import * as THREE from 'three';

export const meta = { id: 'robot-rifleman', kind: 'robot', group: 'robots', label: 'VULTURE-3 · 步枪机', type: 'rifleman', defaultPose: 'base' };

/** Model data and rig dimensions are preserved (hitboxes / muzzle depend on them); combat stats live in src/config/enemies.js. */
export const def = {
  key: 'rifleman',
  name: 'VULTURE-3',
  displayName: 'VULTURE-3 // 秃鹫步枪机',
  radius: 0.58,
  height: 2.55,
  speed: 3.6,
  stride: 1.35,
  score: 150,
  resist: 1.0,
  staggerResist: 0.1,
  eyeHeight: 2.33,
  ranges: { min: 5.5, ideal: 11, max: 22 },
  fire: { shots: 4, interval: 0.135, cooldown: 1.4, telegraph: 0.5, accuracy: 0.58, mag: 8, reload: 2.2 },
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

/* ================================================================== *
 *  Detail kit — bevelled plates + higher-resolution primitives.
 *
 *  Everything is cached on the rig's shared geo library (`b.geos`) exactly like
 *  the scout, so one set exists per rig pool / preview and disposeUnitGeos()
 *  releases it with the stock primitives.
 * ================================================================== */
const TAU = Math.PI * 2;
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
// Chamfered armour plate: rectangle with clipped corners.
const PLATE_HEX = [
  [-0.38, -0.5], [0.38, -0.5], [0.5, -0.24], [0.5, 0.24],
  [0.38, 0.5], [-0.38, 0.5], [-0.5, 0.24], [-0.5, -0.24],
];
// Trapezoid: wider at the bottom, used for chest / shin shells.
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

/** Ammo drum: cylinder with turned-down rims at both ends (lathe, 24 segments). */
function drumGeo(segments = 24) {
  const profile = [
    [0.0, -0.5], [0.8, -0.5], [0.96, -0.44], [1.0, -0.3],
    [1.0, 0.3], [0.96, 0.44], [0.8, 0.5], [0.0, 0.5],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(profile, segments);
}

function primitives(b) {
  if (b.geos.riflePlate) return;
  const g = b.geos;
  g.riflePlate = bevelPlate(PLATE_RECT, 0.04);
  g.riflePlateHex = bevelPlate(PLATE_HEX, 0.05);
  g.riflePlateTra = bevelPlate(PLATE_TRAP, 0.04);
  g.rifleCyl8 = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  g.rifleCyl12 = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
  g.rifleCyl16 = new THREE.CylinderGeometry(1, 1, 1, 16, 1);
  g.rifleCyl20 = new THREE.CylinderGeometry(1, 1, 1, 20, 1);
  g.rifleSphere12 = new THREE.SphereGeometry(1, 12, 10);
  g.rifleDrum = drumGeo(24);
  g.rifleRing = new THREE.TorusGeometry(1, 0.14, 6, 12);
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
function plate(b, key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, geoKey = 'riflePlate') {
  primitives(b);
  emit(b, key, geoKey, w, h, d, x, y, z, rx, ry, rz);
}

function hexPlate(b, key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  plate(b, key, w, h, d, x, y, z, rx, ry, rz, 'riflePlateHex');
}

function trapPlate(b, key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  plate(b, key, w, h, d, x, y, z, rx, ry, rz, 'riflePlateTra');
}

/** Higher-resolution cylinder (axis = local Y before rotation). */
function cylN(b, key, seg, r, h, x, y, z, rx = 0, ry = 0, rz = 0) {
  primitives(b);
  b.cyl(key, r, h, x, y, z, rx, ry, rz, 'rifleCyl' + seg);
}

/** Higher-resolution sphere / ellipsoid. */
function ballN(b, key, seg, r, x, y, z, sx = 1, sy = 1, sz = 1) {
  primitives(b);
  emit(b, key, 'rifleSphere' + seg, r * sx, r * sy, r * sz, x, y, z);
}

/** Torus ring in the local XY plane (hole along Z). */
function torus(b, key, r, x, y, z, rx = 0, ry = 0, rz = 0) {
  primitives(b);
  emit(b, key, 'rifleRing', r, r, r, x, y, z, rx, ry, rz);
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
  b._push(key, b.geos['rifleCyl' + seg], _mat4.clone());
}

/** Hex bolt head with a slot across it. */
function bolt(b, key, r, depth, x, y, z, rx = 0, ry = 0, rz = 0) {
  primitives(b);
  b.cyl(key, r, depth, x, y, z, rx, ry, rz, 'rifleCyl8');
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

/* ================================================================== *
 *  Chassis hooks
 * ================================================================== */

/** buildPelvis() — articulated hip block, belt, tassets, rear power pack. */
function pelvis(b, M, def, { pw, ph, pd }) {
  b.buckets.clear();
  primitives(b);

  // massed hip armour over the dark frame
  plate(b, 'dark', pw * 0.82, ph * 0.94, pd * 0.86, 0, 0, 0);
  plate(b, 'armor', pw * 1.0, ph * 0.5, pd * 0.98, 0, ph * 0.16, 0);
  plate(b, 'armor', pw * 0.9, ph * 0.46, pd * 0.94, 0, -ph * 0.26, 0);
  plate(b, 'trim', pw * 1.02, ph * 0.075, pd * 1.0, 0, -ph * 0.02, 0);
  // crotch guard + belt buckle + glow strip
  plate(b, 'armor', pw * 0.32, ph * 0.7, pd * 0.24, 0, -ph * 0.46, -pd * 0.4, -0.12);
  plate(b, 'trim', pw * 0.22, ph * 0.16, 0.045, 0, -ph * 0.14, -pd * 0.54);
  b.box('core', pw * 0.15, 0.013, 0.02, 0, -ph * 0.14, -pd * 0.575);
  // front belt pouches
  for (const side of [-1, 1]) {
    plate(b, 'dark', pw * 0.16, ph * 0.32, pd * 0.16, side * pw * 0.34, -ph * 0.3, -pd * 0.42, 0, side * 0.1);
    plate(b, 'trim', pw * 0.18, ph * 0.06, pd * 0.18, side * pw * 0.34, -ph * 0.18, -pd * 0.43, 0, side * 0.1);
  }
  // hip articulation: bearing sphere + outboard cap + tasset plates
  for (const side of [-1, 1]) {
    const hx = side * M.hipX;
    const hy = -ph * 0.16;
    ballN(b, 'dark', 12, M.hipX * 0.6, hx, hy, 0);
    cylN(b, 'dark', 16, M.hipX * 0.46, 0.03, hx + side * M.hipX * 0.44, hy, 0, 0, 0, HALF);
    cylN(b, 'trim', 12, M.hipX * 0.3, 0.022, hx + side * M.hipX * 0.6, hy, 0, 0, 0, HALF);
    bolt(b, 'trim', 0.013, 0.012, hx + side * M.hipX * 0.66, hy, 0, 0, 0, HALF);
    hexPlate(b, 'armor', pw * 0.24, ph * 0.74, pd * 0.86, side * pw * 0.5, -ph * 0.22, 0, 0, 0, side * -0.22);
    plate(b, 'trim', pw * 0.05, ph * 0.62, pd * 0.4, side * pw * 0.62, -ph * 0.2, -pd * 0.12, 0, 0, side * -0.22);
    plate(b, 'dark', pw * 0.11, ph * 0.3, pd * 0.3, side * pw * 0.52, -ph * 0.5, pd * 0.16, 0, 0, side * -0.16);
    rod(b, 'dark', 12, 0.011, side * pw * 0.4, -ph * 0.04, pd * 0.3, side * pw * 0.3, -ph * 0.4, pd * 0.4);
  }
  // rear power pack, cooling slats and warning stripe
  plate(b, 'dark', pw * 0.54, ph * 0.5, pd * 0.16, 0, -ph * 0.02, pd * 0.55);
  plate(b, 'armor', pw * 0.42, ph * 0.34, 0.05, 0, -ph * 0.02, pd * 0.65);
  slatRow(b, 'trim', 3, pw * 0.34, 0.014, 0.02, 0, -ph * 0.02, pd * 0.69, 0, 0.035, 0);
  b.box('accent', pw * 0.26, 0.022, 0.02, 0, ph * 0.2, pd * 0.55);
  // tasset service bolts + hip actuator cover
  for (const side of [-1, 1]) {
    bolt(b, 'trim', 0.012, 0.011, side * pw * 0.58, -ph * 0.2, -pd * 0.4, 0, 0, HALF);
    plate(b, 'trim', 0.02, ph * 0.26, pd * 0.3, side * pw * 0.54, -ph * 0.34, pd * 0.05, 0, 0, side * -0.2);
  }
  // pelvis-top power collar (the torso pivot rides inside it)
  cylN(b, 'dark', 16, pw * 0.28, ph * 0.22, 0, ph * 0.5, 0);
  cylN(b, 'trim', 16, pw * 0.32, 0.022, 0, ph * 0.6, 0);
}

/** buildTorso() — layered chest, tiered pauldrons, ammo-drum backpack + chute. */
function torso(b, M, def, { cw, ch, cd, cy }) {
  b.buckets.clear();
  primitives(b);

  // massed chassis: dark frame + upper chest + abdomen + waist seal
  plate(b, 'dark', cw * 0.86, ch * 0.94, cd * 0.86, 0, cy, 0);
  plate(b, 'armor', cw * 1.0, ch * 0.52, cd * 1.0, 0, cy + ch * 0.16, 0);
  plate(b, 'armor', cw * 0.9, ch * 0.26, cd * 0.94, 0, cy - ch * 0.27, 0);
  plate(b, 'dark', cw * 0.72, ch * 0.14, cd * 0.88, 0, cy - ch * 0.42, 0);
  // layered front armour: upper pectoral shell, pectoral wings, sternum ridge
  trapPlate(b, 'armor', cw * 0.92, ch * 0.3, cd * 0.16, 0, cy + ch * 0.25, -cd * 0.47, -0.05);
  for (const side of [-1, 1]) {
    hexPlate(b, 'armor', cw * 0.3, ch * 0.27, cd * 0.13, side * cw * 0.22, cy + ch * 0.2, -cd * 0.48, 0, side * 0.08);
    plate(b, 'trim', cw * 0.05, ch * 0.16, cd * 0.08, side * cw * 0.36, cy + ch * 0.2, -cd * 0.5);
    // waist flank armour + shoulder mount
    emitFrame(b, 'armor', 'riflePlate', cd * 0.7, ch * 0.44, cw * 0.09,
      side * cw * 0.475, cy - ch * 0.02, 0, new THREE.Vector3(0, 1, 0), new THREE.Vector3(side, 0, 0));
    plate(b, 'dark', cw * 0.16, ch * 0.2, cd * 0.46, side * M.shoulderX, M.shoulderY, 0);
    // chest vents
    slatRow(b, 'dark', 3, cw * 0.18, 0.014, 0.02, side * cw * 0.28, cy + ch * 0.36, -cd * 0.5, 0, 0.032, 0);
  }
  plate(b, 'trim', cw * 0.055, ch * 0.34, 0.05, 0, cy + ch * 0.16, -cd * 0.51);
  plate(b, 'dark', cw * 0.34, ch * 0.1, 0.04, 0, cy + ch * 0.05, -cd * 0.5);
  // reactor core: housing + trim ring + glow dome + team stripe
  cylN(b, 'dark', 16, cw * 0.11, cd * 0.1, 0, cy + ch * 0.02, -cd * 0.48, HALF, 0, 0);
  cylN(b, 'trim', 20, cw * 0.085, cd * 0.05, 0, cy + ch * 0.02, -cd * 0.52, HALF, 0, 0);
  torus(b, 'trim', cw * 0.125, 0, cy + ch * 0.02, -cd * 0.48);
  ballN(b, 'core', 12, cw * 0.046, 0, cy + ch * 0.02, -cd * 0.545);
  b.box('core', cw * 0.3, 0.012, 0.03, 0, cy + ch * 0.38, -cd * 0.44);
  // abdomen ribs
  slatRow(b, 'trim', 3, cw * 0.66, 0.016, 0.02, 0, cy - ch * 0.1, -cd * 0.48, 0, 0.045, 0);
  // collar + single neck column (head group rides on top)
  cylN(b, 'dark', 16, cw * 0.17, ch * 0.07, 0, cy + ch * 0.5, 0);
  cylN(b, 'trim', 20, cw * 0.2, 0.02, 0, cy + ch * 0.54, 0);
  cylN(b, 'dark', 12, cw * 0.075, ch * 0.2, 0, cy + ch * 0.62, 0);
  // back shell + shoulder yoke + bolts
  plate(b, 'armor', cw * 0.76, ch * 0.34, cd * 0.1, 0, cy + ch * 0.16, cd * 0.46, 0.05);
  plate(b, 'trim', cw * 0.88, 0.03, cd * 0.36, 0, cy + ch * 0.46, 0);
  for (const side of [-1, 1]) {
    bolt(b, 'trim', 0.015, 0.013, side * cw * 0.3, cy + ch * 0.4, -cd * 0.47);
    bolt(b, 'trim', 0.015, 0.013, side * cw * 0.24, cy - ch * 0.06, -cd * 0.47);
  }
  // tiered pauldrons: three stacked lames wrapping the shoulder ball + rivets
  for (const side of [-1, 1]) {
    const px = side * M.shoulderX;
    const py = M.shoulderY;
    cylN(b, 'trim', 16, cw * 0.1, 0.026, px + side * cw * 0.05, py - 0.03, 0);
    plate(b, 'armor', cw * 0.34, cd * 0.62, ch * 0.1, px, py + ch * 0.17, 0, HALF, 0, side * 0.16);
    plate(b, 'armor', cw * 0.36, cd * 0.7, ch * 0.11, px + side * cw * 0.03, py + ch * 0.07, 0, HALF, 0, side * 0.32);
    plate(b, 'armor', cw * 0.3, cd * 0.56, ch * 0.09, px + side * cw * 0.06, py - ch * 0.04, 0, HALF, 0, side * 0.5);
    plate(b, 'trim', cw * 0.36, cd * 0.62, 0.02, px + side * cw * 0.03, py + ch * 0.12, 0, HALF, 0, side * 0.28);
    plate(b, 'trim', 0.018, cd * 0.5, ch * 0.05, px + side * cw * 0.17, py - ch * 0.02, 0, HALF, 0, side * 0.42);
    b.box('accent', 0.03, 0.012, 0.014, px + side * cw * 0.02, py + ch * 0.2, -cd * 0.3);
    bolt(b, 'trim', 0.016, 0.014, px, py + ch * 0.21, -cd * 0.24, HALF, 0, 0);
    bolt(b, 'trim', 0.014, 0.012, px + side * cw * 0.08, py + ch * 0.1, cd * 0.26, HALF, 0, 0);
    // shoulder piston to the upper arm
    rod(b, 'trim', 12, 0.013, px + side * cw * 0.15, py - ch * 0.03, cd * 0.2, px + side * cw * 0.15, py - ch * 0.26, cd * 0.04);
  }

  /* --- backpack: signature ammo drum + feed chute + radiator --- */
  const drumR = cd * 0.29;
  const drumL = cw * 0.44;
  const drumY = cy + ch * 0.04;
  const drumZ = cd * 0.72;
  plate(b, 'dark', cw * 0.5, ch * 0.52, cd * 0.16, 0, drumY, cd * 0.55);
  emit(b, 'dark', 'rifleDrum', drumR, drumL, drumR, 0, drumY, drumZ, 0, 0, HALF);
  for (const side of [-1, 1]) {
    cylN(b, 'trim', 20, drumR * 1.02, 0.022, side * drumL * 0.26, drumY, drumZ, 0, 0, HALF);
    cylN(b, 'dark', 16, drumR * 0.95, 0.016, side * (drumL * 0.5 + 0.006), drumY, drumZ, 0, 0, HALF);
    cylN(b, 'trim', 12, drumR * 0.36, 0.03, side * (drumL * 0.5 + 0.016), drumY, drumZ, 0, 0, HALF);
    cylN(b, 'dark', 8, drumR * 0.15, 0.02, side * (drumL * 0.5 + 0.03), drumY, drumZ, 0, 0, HALF);
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3 + 0.5;
      b.box('trim', 0.02, 0.016, 0.014,
        side * (drumL * 0.5 + 0.012),
        drumY + Math.cos(a) * drumR * 0.64,
        drumZ + Math.sin(a) * drumR * 0.64);
    }
  }
  // feed chute: drum top -> right shoulder, three linked segments + hose
  plate(b, 'dark', 0.09, ch * 0.16, cd * 0.32, cw * 0.17, cy + ch * 0.22, cd * 0.5, 0.38, 0, -0.3);
  plate(b, 'dark', 0.075, ch * 0.11, cd * 0.26, cw * 0.3, cy + ch * 0.3, cd * 0.34, 0.22, 0, -0.5);
  plate(b, 'trim', 0.05, ch * 0.07, cd * 0.16, cw * 0.37, cy + ch * 0.34, cd * 0.24, 0.1, 0, -0.6);
  rod(b, 'dark', 12, 0.018, cw * 0.37, cy + ch * 0.33, cd * 0.22, cw * 0.43, cy + ch * 0.19, cd * 0.08);
  // rear radiator grille + warning stripes
  plate(b, 'dark', cw * 0.42, ch * 0.26, 0.03, 0, cy - ch * 0.32, cd * 0.55);
  slatRow(b, 'trim', 5, cw * 0.32, 0.016, 0.02, 0, cy - ch * 0.32, cd * 0.58, 0, 0.036, 0);
  for (const side of [-1, 1]) {
    b.box('accent', cw * 0.1, 0.024, 0.02, side * cw * 0.23, cy + ch * 0.02, cd * 0.54);
    rod(b, 'dark', 12, 0.011, side * cw * 0.3, cy + ch * 0.22, cd * 0.34, side * cw * 0.26, cy + ch * 0.42, cd * 0.14);
  }
  // rear armour layering + service bolts + intercostal hoses
  for (const side of [-1, 1]) {
    hexPlate(b, 'armor', cw * 0.2, ch * 0.16, cd * 0.1, side * cw * 0.3, cy - ch * 0.08, cd * 0.44, 0.1, side * 0.2);
    bolt(b, 'trim', 0.013, 0.012, side * cw * 0.34, cy + ch * 0.34, cd * 0.5, HALF, 0, 0);
    rod(b, 'dark', 12, 0.009, side * cw * 0.16, cy - ch * 0.4, cd * 0.36, side * cw * 0.4, cy - ch * 0.44, cd * 0.22);
  }
  plate(b, 'trim', cw * 0.5, ch * 0.045, cd * 0.05, 0, cy + ch * 0.3, cd * 0.52);
}

/** buildHead() — layered helmet, visor slit, sensor boom + rear antenna dish. */
function head(b, M, def, { w, h, d, y }) {
  b.buckets.clear();
  primitives(b);

  // helmet mass: dark shell, armour face, crown plate, jaw
  plate(b, 'dark', w * 0.88, h * 0.8, d * 0.9, 0, y, 0.01);
  plate(b, 'armor', w * 0.98, h * 0.54, d * 0.74, 0, y + h * 0.1, -d * 0.1);
  trapPlate(b, 'armor', w * 0.94, h * 0.26, d * 0.62, 0, y + h * 0.44, 0.01, -0.06);
  plate(b, 'dark', w * 0.8, h * 0.2, d * 0.8, 0, y - h * 0.4, 0.01);
  // brow ridge + crown crest
  plate(b, 'armor', w * 1.0, h * 0.16, d * 0.4, 0, y + h * 0.28, -d * 0.3, -0.18);
  plate(b, 'trim', w * 0.16, h * 0.24, d * 0.44, 0, y + h * 0.5, 0.03);
  b.box('core', w * 0.1, 0.01, 0.04, 0, y + h * 0.56, -d * 0.14);
  // visor recess + emissive slit + cheek lamps
  plate(b, 'dark', w * 0.86, h * 0.22, 0.05, 0, y + h * 0.04, -d * 0.44);
  b.box('visor', w * 0.7, h * 0.085, 0.03, 0, y + h * 0.04, -d * 0.44 - 0.012);
  for (const side of [-1, 1]) {
    b.box('accent', w * 0.045, h * 0.045, 0.02, side * w * 0.4, y + h * 0.04, -d * 0.48);
  }
  // cheek guards, ear pods, jaw grille, rear counterweight
  for (const side of [-1, 1]) {
    hexPlate(b, 'armor', w * 0.16, h * 0.34, d * 0.4, side * w * 0.44, y - h * 0.12, -d * 0.2, 0.04, side * 0.16, side * -0.1);
    cylN(b, 'dark', 12, w * 0.13, 0.045, side * w * 0.5, y, 0.02, 0, 0, HALF);
    cylN(b, 'trim', 8, w * 0.075, 0.022, side * w * 0.5, y, 0.02, 0, 0, HALF);
    cylN(b, 'dark', 8, w * 0.03, 0.03, side * w * 0.53, y - h * 0.12, -d * 0.1, 0, 0, HALF);
    bolt(b, 'trim', 0.012, 0.011, side * w * 0.36, y + h * 0.3, -d * 0.34);
    slatRow(b, 'trim', 2, w * 0.05, 0.008, 0.016, side * w * 0.45, y - h * 0.3, -d * 0.36, 0, 0.026, 0);
  }
  plate(b, 'dark', w * 0.62, h * 0.16, d * 0.26, 0, y - h * 0.4, -d * 0.24);
  slatRow(b, 'trim', 4, w * 0.46, 0.012, 0.018, 0, y - h * 0.4, -d * 0.37, 0, 0.022, 0);
  plate(b, 'armor', w * 0.72, h * 0.24, 0.05, 0, y, d * 0.46);
  slatRow(b, 'trim', 3, w * 0.44, 0.012, 0.02, 0, y + h * 0.04, d * 0.49, 0, 0.03, 0);
  ballN(b, 'trim', 12, w * 0.06, -w * 0.5, y + h * 0.02, d * 0.14);

  /* --- sensor boom: top-left mast, two segments, forward sensor pod --- */
  plate(b, 'trim', 0.07, 0.038, 0.07, -w * 0.3, y + h * 0.52, d * 0.05, -0.2);
  cylN(b, 'dark', 12, 0.014, 0.08, -w * 0.3, y + h * 0.58, d * 0.05);
  rod(b, 'trim', 12, 0.011, -w * 0.3, y + h * 0.62, d * 0.05, -w * 0.5, y + h * 0.84, -d * 0.08);
  ballN(b, 'dark', 12, 0.022, -w * 0.5, y + h * 0.84, -d * 0.08);
  rod(b, 'trim', 12, 0.009, -w * 0.5, y + h * 0.84, -d * 0.08, -w * 0.62, y + h * 0.7, -d * 0.52);
  cylN(b, 'dark', 16, 0.028, 0.05, -w * 0.62, y + h * 0.7, -d * 0.56, HALF, 0, 0);
  cylN(b, 'trim', 12, 0.02, 0.014, -w * 0.62, y + h * 0.7, -d * 0.59, HALF, 0, 0);
  ballN(b, 'core', 12, 0.012, -w * 0.62, y + h * 0.7, -d * 0.605);
  b.box('trim', 0.05, 0.01, 0.03, -w * 0.62, y + h * 0.7 + 0.026, -d * 0.55);

  /* --- rear antenna dish (right-rear) + straight whip antenna --- */
  cylN(b, 'dark', 12, 0.01, 0.06, w * 0.28, y + h * 0.4, d * 0.36);
  cylN(b, 'trim', 16, 0.04, 0.012, w * 0.28, y + h * 0.44, d * 0.37, -0.45, 0, 0);
  cylN(b, 'dark', 8, 0.014, 0.018, w * 0.28, y + h * 0.44, d * 0.39, -0.45, 0, 0);
  ballN(b, 'trim', 12, 0.01, w * 0.28, y + h * 0.44, d * 0.41);
  rod(b, 'trim', 8, 0.005, -w * 0.12, y + h * 0.52, d * 0.14, -w * 0.15, y + h * 0.98, d * 0.2);
  b.octa('accent', 0.01, -w * 0.15, y + h * 0.98, d * 0.2);
  // neck guard + helmet side ridges
  plate(b, 'trim', w * 0.5, h * 0.07, d * 0.26, 0, y - h * 0.52, d * 0.1, 0.2);
  for (const side of [-1, 1]) {
    emitFrame(b, 'armor', 'riflePlate', d * 0.5, h * 0.34, 0.022,
      side * w * 0.52, y + h * 0.04, 0,
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(side, 0, 0));
    b.box('trim', 0.012, 0.02, d * 0.2, side * w * 0.53, y + h * 0.2, -d * 0.16);
    bolt(b, 'trim', 0.009, 0.008, side * w * 0.3, y + h * 0.5, d * 0.16);
  }
}

/** buildArm() — servo shoulder, piston-linked upper arm, armoured forearm, hand. */
function arm(b, M, def, side, { bend, dirY, dirZ, elbowY, handY, handZ, midY, midZ, aw }) {
  b.buckets.clear();
  primitives(b);
  const upper = M.armUpper;
  const fore = M.armFore;
  const foreAx = new THREE.Vector3(0, -dirY, -dirZ); // elbow -> hand
  const foreFront = new THREE.Vector3(0, dirZ, -dirY); // forearm front/top normal
  const dirX = new THREE.Vector3(side, 0, 0);

  // shoulder: articulated ball + trim hub
  ballN(b, 'armor', 12, aw * 1.2, 0, 0, 0);
  cylN(b, 'dark', 16, aw * 0.62, aw * 0.9, 0, -aw * 0.06, 0);
  cylN(b, 'trim', 16, aw * 0.66, 0.022, 0, -aw * 0.04, 0);
  b.octa('trim', aw * 0.34, side * aw * 0.6, -aw * 0.04, 0);

  // upper arm: dark frame + front / outer armour shells + seam
  plate(b, 'dark', aw * 1.0, upper * 0.94, aw * 1.02, 0, elbowY * 0.5, 0);
  emitFrame(b, 'armor', 'riflePlate', aw * 1.12, upper * 0.8, aw * 0.3, 0, elbowY * 0.5, -aw * 0.44,
    new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1));
  emitFrame(b, 'armor', 'riflePlate', aw * 0.34, upper * 0.78, aw * 1.08, side * aw * 0.52, elbowY * 0.5, 0,
    new THREE.Vector3(0, -1, 0), dirX);
  emitFrame(b, 'trim', 'riflePlate', aw * 0.86, 0.02, aw * 0.9, 0, elbowY * 0.82, 0,
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
  plate(b, 'dark', aw * 0.36, upper * 0.3, aw * 0.36, 0, elbowY * 0.35, aw * 0.44);
  // twin pistons + cable on the outer face
  rod(b, 'trim', 12, 0.013, side * aw * 0.46, -aw * 0.1, aw * 0.5, side * aw * 0.46, elbowY + 0.05, aw * 0.34);
  rod(b, 'dark', 12, 0.01, side * aw * 0.3, -aw * 0.16, aw * 0.52, side * aw * 0.32, elbowY + 0.02, aw * 0.28);
  rod(b, 'dark', 8, 0.007, -side * aw * 0.28, -aw * 0.1, -aw * 0.46, -side * aw * 0.28, elbowY + 0.06, -aw * 0.3);
  // bicep service plate + bearing bolts
  hexPlate(b, 'armor', aw * 0.6, upper * 0.24, aw * 0.3, 0, elbowY * 0.7, -aw * 0.56, 0.1);
  bolt(b, 'trim', 0.012, 0.011, side * aw * 0.66, elbowY * 0.6, 0, 0, 0, HALF);
  bolt(b, 'trim', 0.011, 0.01, side * aw * 0.56, midY, midZ, 0, 0, HALF);

  // elbow bearing + cap + guard
  cylN(b, 'dark', 16, aw * 0.6, aw * 1.26, 0, elbowY, 0, 0, 0, HALF);
  cylN(b, 'trim', 12, aw * 0.32, 0.022, side * aw * 0.64, elbowY, 0, 0, 0, HALF);
  b.octa('trim', aw * 0.17, side * aw * 0.7, elbowY, 0);
  plate(b, 'armor', aw * 0.55, aw * 0.4, aw * 0.5, 0, elbowY + aw * 0.14, -aw * 0.36, 0.18);

  // forearm: frame + front bracer + outer shell + wrist cuff + vents
  plate(b, 'dark', aw * 0.94, fore * 0.98, aw * 0.96, 0, midY, midZ, bend);
  emitFrame(b, 'armor', 'riflePlate', aw * 1.16, fore * 0.86, aw * 0.3,
    0, midY + foreFront.y * aw * 0.5, midZ + foreFront.z * aw * 0.5, foreAx, foreFront);
  emitFrame(b, 'armor', 'riflePlate', aw * 0.3, fore * 0.8, aw * 1.08, side * aw * 0.5, midY, midZ, foreAx, dirX);
  emitFrame(b, 'trim', 'riflePlate', aw * 1.0, fore * 0.09, aw * 0.34,
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
  // left wrist terminal / right ammo counter
  if (side < 0) {
    plate(b, 'dark', 0.018, fore * 0.34, aw * 0.5, -aw * 0.6, midY, midZ, bend);
    plate(b, 'accent', 0.007, fore * 0.24, aw * 0.36, -aw * 0.65, midY, midZ, bend);
    b.box('dark', 0.009, 0.011, aw * 0.4, -aw * 0.69, midY, midZ, bend);
  } else {
    plate(b, 'dark', 0.018, aw * 0.32, aw * 0.38, aw * 0.6, midY + dirY * 0.1, midZ + dirZ * 0.1, bend);
    b.box('core', 0.007, 0.011, 0.028, aw * 0.64, midY + dirY * 0.12, midZ + dirZ * 0.12, bend);
  }

  // hand: compact fist (palm + knuckle plate + three fingers + thumb)
  plate(b, 'dark', aw * 1.0, aw * 1.1, aw * 1.15, 0, handY - dirY * aw * 0.5, handZ - dirZ * aw * 0.5, bend);
  emitFrame(b, 'armor', 'riflePlate', aw * 0.9, aw * 0.85, aw * 0.22,
    0, handY - dirY * aw * 0.5 + foreFront.y * aw * 0.5, handZ - dirZ * aw * 0.5 + foreFront.z * aw * 0.5, foreAx, foreFront);
  for (let i = 0; i < 3; i++) {
    const fx = (i - 1) * aw * 0.27;
    b.box('dark', aw * 0.22, aw * 0.6, aw * 0.3, fx, handY - dirY * aw * 1.0, handZ - dirZ * aw * 1.0 - aw * 0.12, bend);
    b.box('trim', aw * 0.2, aw * 0.16, aw * 0.24, fx, handY - dirY * aw * 1.1, handZ - dirZ * aw * 1.1 - aw * 0.12, bend);
  }
  b.box('dark', aw * 0.24, aw * 0.4, aw * 0.36, side * aw * 0.46, handY - dirY * aw * 0.8, handZ - dirZ * aw * 0.8 - aw * 0.08, bend);
  bolt(b, 'trim', 0.012, 0.011, 0, handY - dirY * aw * 0.5 + foreFront.y * aw * 0.52, handZ - dirZ * aw * 0.5 + foreFront.z * aw * 0.52, bend);
}

/** buildLeg() — hip bearing, layered thigh, knee guard, shin pistons, armoured boot. */
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

  // hip bearing + outboard caps
  ballN(b, 'dark', 12, w * 0.6, 0, 0, 0);
  cylN(b, 'dark', 16, w * 0.46, w * 1.25, 0, 0, 0, 0, 0, HALF);
  cylN(b, 'trim', 12, w * 0.3, 0.022, side * w * 0.68, 0, 0, 0, 0, HALF);
  bolt(b, 'trim', 0.013, 0.012, side * w * 0.72, 0, 0, 0, 0, HALF);

  // thigh: dark frame + front shell + outer shell + seam + rear actuator
  plate(b, 'dark', w * 0.84, thigh * 0.94, w * 0.86, 0, kneeMidY, kneeMidZ, a1);
  emitFrame(b, 'armor', 'riflePlate', w * 1.1, thigh * 0.86, w * 0.24,
    thighFront.x * w * 0.45 + 0, kneeMidY + thighFront.y * w * 0.45, kneeMidZ + thighFront.z * w * 0.45, thighAx, thighFront);
  emitFrame(b, 'armor', 'riflePlate', w * 0.26, thigh * 0.82, w * 1.14, side * w * 0.48, kneeMidY, kneeMidZ, thighAx, dirX);
  emitFrame(b, 'trim', 'riflePlate', w * 0.9, 0.02, w * 0.94, 0, kneeY * 0.7, kneeZ * 0.7, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
  plate(b, 'dark', w * 0.58, thigh * 0.5, w * 0.3, 0, kneeY * 0.5 - thighDirY * 0, kneeZ * 0.5 + w * 0.5, a1);
  rod(b, 'trim', 12, 0.013, side * w * 0.36, -w * 0.1, w * 0.46, side * w * 0.36, kneeY + 0.05, kneeZ + w * 0.4);
  rod(b, 'dark', 12, 0.01, side * w * 0.26, -w * 0.18, w * 0.5, side * w * 0.28, kneeY + 0.02, kneeZ + w * 0.28);
  bolt(b, 'trim', 0.013, 0.012, -side * w * 0.28, kneeY * 0.32, kneeZ * 0.32 - w * 0.6, a1);

  // knee: bearing axle, cap, kneecap guard
  cylN(b, 'dark', 16, w * 0.48, w * 1.24, 0, kneeY, kneeZ, 0, 0, HALF);
  cylN(b, 'trim', 12, w * 0.28, 0.02, side * w * 0.64, kneeY, kneeZ, 0, 0, HALF);
  hexPlate(b, 'armor', w * 0.86, w * 0.66, w * 0.5, 0, kneeY + w * 0.08, kneeZ - w * 0.42, -0.22);
  plate(b, 'trim', w * 0.46, w * 0.14, 0.04, 0, kneeY + w * 0.2, kneeZ - w * 0.62, -0.22);
  b.box('dark', w * 0.5, w * 0.12, w * 0.14, 0, kneeY - w * 0.06, kneeZ - w * 0.55);
  cylN(b, 'dark', 8, w * 0.2, 0.02, side * w * 0.74, kneeY, kneeZ);
  bolt(b, 'trim', 0.012, 0.011, side * w * 0.42, kneeY, kneeZ, 0, 0, HALF);
  plate(b, 'trim', w * 0.5, 0.03, 0.03, 0, kneeY + w * 0.2, kneeZ - w * 0.7, 0.15);

  // shin: frame + front guard + outer shell + vents + twin pistons + ankle collar
  plate(b, 'dark', w * 0.78, shin * 0.94, w * 0.8, 0, (kneeY + ankleY) * 0.5, (kneeZ + ankleZ) * 0.5, a2);
  emitFrame(b, 'armor', 'riflePlate', w * 0.96, shin * 0.88, w * 0.22,
    shinFront.x, (kneeY + ankleY) * 0.5 + shinFront.y * w * 0.42, (kneeZ + ankleZ) * 0.5 + shinFront.z * w * 0.42, shinAx, shinFront);
  emitFrame(b, 'armor', 'riflePlate', w * 0.22, shin * 0.84, w * 1.04, side * w * 0.44, (kneeY + ankleY) * 0.5, (kneeZ + ankleZ) * 0.5, shinAx, dirX);
  for (let i = 0; i < 3; i++) {
    b.box('dark', w * 0.4, 0.012, 0.05, 0, (kneeY + ankleY) * 0.5 + 0.1 - i * 0.034, (kneeZ + ankleZ) * 0.5 - w * 0.46, a2);
  }
  for (const sx of [-w * 0.3, w * 0.3]) {
    rod(b, 'trim', 12, 0.012, sx, kneeY - w * 0.06, kneeZ + w * 0.24, sx, ankleY + w * 0.08, ankleZ + w * 0.24);
    rod(b, 'dark', 8, 0.008, sx, ankleY + w * 0.26, ankleZ + w * 0.26, sx, ankleY + 0.02, ankleZ + w * 0.28);
  }
  emitFrame(b, 'trim', 'riflePlate', w * 0.8, 0.03, w * 0.2,
    0, (kneeY + ankleY) * 0.5 + shinFront.y * w * 0.44, (kneeZ + ankleZ) * 0.5 + shinFront.z * w * 0.44, shinAx, shinFront);
  cylN(b, 'dark', 12, w * 0.4, 0.03, 0, ankleY + w * 0.3, ankleZ);
  cylN(b, 'trim', 12, w * 0.34, 0.02, 0, ankleY + w * 0.2, ankleZ);

  // ankle joint
  ballN(b, 'dark', 12, w * 0.44, 0, ankleY, ankleZ);
  cylN(b, 'trim', 16, w * 0.28, 0.03, side * w * 0.34, ankleY, ankleZ, 0, 0, HALF);
  bolt(b, 'trim', 0.011, 0.01, side * w * 0.4, ankleY, ankleZ, 0, 0, HALF);

  // boot: sole, body, split toe caps, heel, ankle collar, treads, buckles
  const fz = ankleZ - M.footL * 0.32;
  b.box('dark', M.footW * 1.02, M.footH * 0.34, M.footL * 1.02, 0, footY - M.footH * 0.34, fz);
  plate(b, 'dark', M.footW * 0.94, M.footH * 0.7, M.footL * 0.92, 0, footY, fz);
  trapPlate(b, 'armor', M.footW * 0.9, M.footH * 0.56, M.footL * 0.42, 0, footY + M.footH * 0.04, fz - M.footL * 0.32, -0.06);
  plate(b, 'armor', M.footW * 0.84, M.footH * 0.56, M.footL * 0.3, 0, footY + M.footH * 0.4, fz + M.footL * 0.24);
  plate(b, 'trim', M.footW * 0.78, M.footH * 0.26, M.footL * 0.16, 0, footY + M.footH * 0.12, fz - M.footL * 0.5, 0.1);
  plate(b, 'dark', M.footW * 0.68, M.footH * 0.46, M.footL * 0.14, 0, footY + M.footH * 0.12, fz + M.footL * 0.46);
  for (const toe of [-1, 1]) {
    b.box('gun', M.footW * 0.4, M.footH * 0.3, M.footL * 0.16, toe * M.footW * 0.24, footY + M.footH * 0.2, fz - M.footL * 0.42);
    b.box('trim', M.footW * 0.28, 0.012, 0.014, toe * M.footW * 0.24, footY + M.footH * 0.32, fz - M.footL * 0.42);
  }
  for (let i = 0; i < 4; i++) {
    b.box('dark', M.footW * 1.04, M.footH * 0.2, M.footL * 0.09, 0, footY - M.footH * 0.36, fz - M.footL * 0.36 + i * M.footL * 0.24);
  }
  for (const sx of [-1, 1]) {
    b.box('dark', 0.014, M.footH * 0.24, M.footL * 0.16, sx * M.footW * 0.49, footY + M.footH * 0.16, fz - M.footL * 0.1);
    b.box('trim', 0.012, 0.014, M.footL * 0.12, sx * M.footW * 0.5, footY + M.footH * 0.3, fz - M.footL * 0.12);
  }
  b.box('accent', M.footW * 0.18, 0.012, 0.014, 0, footY + M.footH * 0.36, fz - M.footL * 0.44);
  bolt(b, 'trim', 0.013, 0.012, side * M.footW * 0.28, footY + M.footH * 0.1, fz - M.footL * 0.3);
}

/** buildGun() — drum-fed assault rifle: receiver, rail, optic, brake. */
function gun(b, M, def, { s, bodyW, bodyH, bodyL, barrelLen, bodyCenterZ, barrelCenterZ, tipZ }) {
  b.buckets.clear();
  primitives(b);
  const boreY = 0.05 * s;

  // receiver: main body + upper/lower + side panels + ejection port
  plate(b, 'gun', bodyW * 1.04, bodyH * 1.0, bodyL * 0.94, 0, 0.045 * s, bodyCenterZ);
  plate(b, 'dark', bodyW * 0.98, bodyH * 0.3, bodyL * 0.86, 0, 0.045 * s + bodyH * 0.5, bodyCenterZ);
  plate(b, 'dark', bodyW * 0.9, bodyH * 0.26, bodyL * 0.62, 0, 0.045 * s - bodyH * 0.44, bodyCenterZ - 0.02 * s);
  for (const side of [-1, 1]) {
    plate(b, 'gun', 0.008, bodyH * 0.56, bodyL * 0.66, side * bodyW * 0.55, 0.045 * s, bodyCenterZ);
    plate(b, 'trim', 0.006, 0.012, bodyL * 0.5, side * bodyW * 0.56, 0.045 * s + bodyH * 0.2, bodyCenterZ - 0.02 * s);
  }
  b.box('dark', 0.026 * s, 0.034 * s, 0.09 * s, bodyW * 0.5, 0.045 * s + bodyH * 0.18, bodyCenterZ + 0.03 * s);
  // top rail + slots
  plate(b, 'dark', 0.042 * s, 0.014 * s, bodyL * 0.86, 0, 0.045 * s + bodyH * 0.66, bodyCenterZ);
  slatRow(b, 'gun', 6, 0.05 * s, 0.008 * s, 0.016 * s, 0, 0.045 * s + bodyH * 0.72, bodyCenterZ, 0, 0, 0.05 * s);

  // stock: buffer tube + cheek + butt plate + hinge
  cylN(b, 'dark', 16, 0.026 * s, 0.16 * s, 0, 0.045 * s + bodyH * 0.22, bodyCenterZ + bodyL * 0.5 + 0.06 * s, HALF, 0, 0);
  plate(b, 'gun', 0.048 * s, 0.1 * s, 0.22 * s, 0, 0.045 * s + 0.006 * s, bodyCenterZ + bodyL * 0.5 + 0.17 * s);
  plate(b, 'trim', 0.056 * s, 0.115 * s, 0.026 * s, 0, 0.045 * s + 0.006 * s, bodyCenterZ + bodyL * 0.5 + 0.29 * s);
  plate(b, 'dark', 0.03 * s, 0.03 * s, 0.1 * s, 0, 0.045 * s + bodyH * 0.36, bodyCenterZ + bodyL * 0.5 + 0.16 * s);
  bolt(b, 'trim', 0.012 * s, 0.012 * s, 0, 0.045 * s - bodyH * 0.1, bodyCenterZ + bodyL * 0.5 + 0.1 * s, HALF, 0, 0);

  // pistol grip + trigger + guard
  plate(b, 'dark', 0.05 * s, 0.19 * s, 0.07 * s, 0, -0.11 * s, bodyCenterZ + 0.04 * s, 0.24);
  b.box('dark', 0.056 * s, 0.02 * s, 0.075 * s, 0, -0.2 * s, bodyCenterZ + 0.07 * s, 0.24);
  for (let i = 0; i < 2; i++) {
    b.box('trim', 0.052 * s, 0.01 * s, 0.06 * s, 0, (-0.1 - i * 0.045) * s, (bodyCenterZ + 0.03 + i * 0.02) * s, 0.24);
  }
  b.beam('gun', 0, -0.035 * s, -0.025 * s, 0, -0.115 * s, -0.06 * s, 0.009 * s);
  b.beam('gun', 0, -0.115 * s, -0.06 * s, 0, -0.115 * s, 0.037 * s, 0.009 * s);
  b.box('dark', 0.012 * s, 0.045 * s, 0.014 * s, 0, -0.075 * s, -0.02 * s, 0.2);

  // magazine: two-stage curved body + ribs + base plate
  plate(b, 'dark', 0.062 * s, 0.16 * s, 0.085 * s, 0, -0.1 * s, bodyCenterZ + 0.02 * s, 0.16);
  plate(b, 'gun', 0.058 * s, 0.1 * s, 0.075 * s, 0, -0.21 * s, bodyCenterZ + 0.05 * s, 0.3);
  plate(b, 'trim', 0.066 * s, 0.02 * s, 0.08 * s, 0, -0.265 * s, bodyCenterZ + 0.06 * s, 0.3);
  for (let i = 0; i < 3; i++) {
    b.box('trim', 0.064 * s, 0.008 * s, 0.06 * s, 0, (-0.13 - i * 0.035) * s, (bodyCenterZ + 0.03 + i * 0.012) * s, 0.24);
  }

  // handguard: shell + side panels + top rail + vent slots + front collar
  plate(b, 'gun', bodyW * 1.08, bodyH * 0.9, 0.28 * s, 0, 0.045 * s, bodyCenterZ - 0.34 * s);
  for (const side of [-1, 1]) {
    plate(b, 'dark', 0.01, bodyH * 0.52, 0.24 * s, side * bodyW * 0.56, 0.045 * s, bodyCenterZ - 0.34 * s);
  }
  plate(b, 'dark', 0.034 * s, 0.012 * s, 0.24 * s, 0, 0.045 * s + bodyH * 0.52, bodyCenterZ - 0.34 * s);
  slatRow(b, 'dark', 4, 0.05 * s, 0.007 * s, 0.018 * s, 0, 0.045 * s + bodyH * 0.53, bodyCenterZ - 0.34 * s, 0, 0, 0.045 * s);
  for (let i = 0; i < 4; i++) {
    b.box('dark', bodyW * 0.72, 0.024 * s, 0.012 * s, 0, 0.045 * s, bodyCenterZ - 0.26 * s - i * 0.045 * s);
  }
  cylN(b, 'trim', 16, 0.042 * s, 0.024 * s, 0, 0.045 * s, bodyCenterZ - 0.49 * s, HALF, 0, 0);
  // fore grip
  plate(b, 'dark', 0.03 * s, 0.09 * s, 0.05 * s, 0, -0.014 * s, bodyCenterZ - 0.36 * s, 0.1);

  // barrel + gas tube + gas block + front sight
  cylN(b, 'gun', 16, 0.021 * s, barrelLen, 0, boreY, barrelCenterZ, HALF, 0, 0);
  rod(b, 'dark', 12, 0.009 * s, 0, boreY + 0.03 * s, barrelCenterZ + barrelLen * 0.42, 0, boreY + 0.026 * s, barrelCenterZ - barrelLen * 0.3);
  plate(b, 'dark', 0.05 * s, 0.05 * s, 0.05 * s, 0, boreY + 0.028 * s, barrelCenterZ + barrelLen * 0.26);
  plate(b, 'gun', 0.028 * s, 0.012 * s, 0.06 * s, 0, boreY + 0.042 * s, barrelCenterZ - barrelLen * 0.06);
  b.box('gun', 0.012 * s, 0.03 * s, 0.014 * s, 0, boreY + 0.062 * s, barrelCenterZ - barrelLen * 0.06);
  for (const side of [-1, 1]) {
    b.box('dark', 0.008 * s, 0.022 * s, 0.03 * s, side * 0.012 * s, boreY + 0.042 * s, barrelCenterZ - barrelLen * 0.06);
  }
  cylN(b, 'trim', 12, 0.026 * s, 0.02 * s, 0, boreY, barrelCenterZ + barrelLen * 0.1, HALF, 0, 0);

  // muzzle brake
  cylN(b, 'dark', 20, 0.032 * s, 0.07 * s, 0, boreY, tipZ + 0.045 * s, HALF, 0, 0);
  cylN(b, 'trim', 16, 0.035 * s, 0.014 * s, 0, boreY, tipZ + 0.072 * s, HALF, 0, 0);
  cylN(b, 'gun', 12, 0.02 * s, 0.02 * s, 0, boreY, tipZ + 0.08 * s, HALF, 0, 0);
  for (const side of [-1, 1]) {
    b.box('dark', 0.012 * s, 0.03 * s, 0.014 * s, side * 0.026 * s, boreY, tipZ + 0.04 * s);
  }

  // reflex optic on the rail
  plate(b, 'dark', 0.042 * s, 0.014 * s, 0.11 * s, 0, 0.045 * s + bodyH * 0.82, bodyCenterZ + 0.04 * s);
  for (const side of [-1, 1]) {
    plate(b, 'dark', 0.012 * s, 0.05 * s, 0.03 * s, side * 0.02 * s, 0.045 * s + bodyH * 0.95, bodyCenterZ + 0.04 * s);
  }
  plate(b, 'gun', 0.046 * s, 0.012 * s, 0.1 * s, 0, 0.045 * s + bodyH * 1.1, bodyCenterZ + 0.04 * s);
  b.octa('core', 0.008 * s, 0, 0.045 * s + bodyH * 0.82, bodyCenterZ - 0.012 * s);
  // charging handle + sling loop + bolt
  b.box('dark', 0.02 * s, 0.02 * s, 0.04 * s, bodyW * 0.6, 0.045 * s + bodyH * 0.3, bodyCenterZ + 0.12 * s);
  torus(b, 'trim', 0.022 * s, -bodyW * 0.62, 0.045 * s - bodyH * 0.2, bodyCenterZ + bodyL * 0.3, HALF, 0, 0);
  bolt(b, 'trim', 0.012 * s, 0.012 * s, bodyW * 0.56, 0.045 * s, bodyCenterZ - 0.12 * s, 0, 0, HALF);

  // keep the exact shared muzzle offset (flash / tracer origin)
  return { tipY: boreY, tipZ };
}

/** buildRobotRig() — backpack ammo-drum hitbox (unchanged gameplay volume). */
function hitboxes(addHit, torso, M, def) {
  // backpack ammo drum: compact solid volume, torso zone like the backpack
  addHit('torso', torso,
    M.chestW * 0.4, M.chestH * 0.32, M.chestD * 0.55,
    0, M.chestY + M.chestH * 0.04, M.chestD * 0.72);
}

export const hooks = { pelvis, torso, head, arm, leg, gun, hitboxes };
