/**
 * BULWARK-7 — heavy chassis (ROBOT_TYPES.heavy).
 *
 * Heavy siege trooper: a rust-brown walking bunker built around one huge chest,
 * shoulder missile pods, twin exhaust stacks and an over-sized rifle.  The
 * chassis is built at high detail: massed armour volumes carry thin bevelled
 * panel plates, the signature pods have recessed launch tubes with trim rims and
 * warning lights, the joints are higher-resolution bearings (12/16-segment
 * cylinders, 12x10 spheres) and the silhouette is broken up by bolts, cooling
 * slats, piston rods, tiered shoulder lames, armoured boots and a re-detailed
 * rifle.
 *
 * Gameplay `def` (dimensions, pivots, hitboxes, muzzle) is unchanged: the shared
 * rig in ./shared.js still owns animation pivots, hitboxes and draw batching, and
 * gun() returns the exact shared default muzzle offset.
 */
import * as THREE from 'three';

export const meta = { id: 'robot-heavy', kind: 'robot', group: 'robots', label: 'BULWARK-7 · 重装机', type: 'heavy', defaultPose: 'base' };

/** The original ROBOT_TYPES entry minus combat stats, which live in src/config/enemies.js. */
export const def = {
  key: 'heavy',
  name: 'BULWARK-7',
  displayName: 'BULWARK-7 // 壁垒重装机',
  radius: 0.78,
  height: 3.0,
  speed: 2.6,
  stride: 1.5,
  score: 300,
  resist: 0.9,
  staggerResist: 0.5,
  eyeHeight: 2.58,
  ranges: { min: 6, ideal: 12, max: 20 },
  fire: { shots: 6, interval: 0.12, cooldown: 2.0, telegraph: 0.72, accuracy: 0.5, mag: 12, reload: 2.6 },
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

/* ================================================================== *
 *  Detail kit — bevelled plates + higher-resolution primitives.
 *
 *  Everything is cached on the rig's shared geo library (`b.geos`) like the
 *  scout/rifleman, so one set exists per rig pool / preview and
 *  disposeUnitGeos() releases it with the stock primitives.  Every cached key
 *  is prefixed `heavy` because the unit-geometry library is shared by all
 *  chassis rigs.
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
// Shouldered pentagon: used for the pod cheek and ram-shield edges.
const PLATE_PENT = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.1], [0, 0.5], [-0.5, 0.1]];

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
  if (b.geos.heavyPlate) return;
  const g = b.geos;
  g.heavyPlate = bevelPlate(PLATE_RECT, 0.04);
  g.heavyPlateHex = bevelPlate(PLATE_HEX, 0.05);
  g.heavyPlateTra = bevelPlate(PLATE_TRAP, 0.04);
  g.heavyPlatePent = bevelPlate(PLATE_PENT, 0.04);
  g.heavyCyl8 = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  g.heavyCyl12 = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
  g.heavyCyl12Open = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  g.heavyCyl16 = new THREE.CylinderGeometry(1, 1, 1, 16, 1);
  g.heavyCyl20 = new THREE.CylinderGeometry(1, 1, 1, 20, 1);
  g.heavyCyl24 = new THREE.CylinderGeometry(1, 1, 1, 24, 1);
  g.heavySphere12 = new THREE.SphereGeometry(1, 12, 10);
  g.heavyDrum = drumGeo(24);
  g.heavyRing = new THREE.TorusGeometry(1, 0.14, 6, 12);
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

/** Bevelled armour plate (rect / hex / trapezoid / pentagon outlines). */
function plate(b, key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, geoKey = 'heavyPlate') {
  primitives(b);
  emit(b, key, geoKey, w, h, d, x, y, z, rx, ry, rz);
}

function hexPlate(b, key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  plate(b, key, w, h, d, x, y, z, rx, ry, rz, 'heavyPlateHex');
}

function trapPlate(b, key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  plate(b, key, w, h, d, x, y, z, rx, ry, rz, 'heavyPlateTra');
}

function pentPlate(b, key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  plate(b, key, w, h, d, x, y, z, rx, ry, rz, 'heavyPlatePent');
}

/** Higher-resolution cylinder (axis = local Y before rotation). */
function cylN(b, key, seg, r, h, x, y, z, rx = 0, ry = 0, rz = 0) {
  primitives(b);
  b.cyl(key, r, h, x, y, z, rx, ry, rz, 'heavyCyl' + seg);
}

/** Higher-resolution sphere / ellipsoid. */
function ballN(b, key, seg, r, x, y, z, sx = 1, sy = 1, sz = 1) {
  primitives(b);
  emit(b, key, 'heavySphere' + seg, r * sx, r * sy, r * sz, x, y, z);
}

/** Torus ring in the local XY plane (hole along Z). */
function ring(b, key, r, x, y, z, rx = 0, ry = 0, rz = 0) {
  primitives(b);
  emit(b, key, 'heavyRing', r, r, r, x, y, z, rx, ry, rz);
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
  b._push(key, b.geos['heavyCyl' + seg], _mat4.clone());
}

/** Hex bolt head with a slot across it. */
function bolt(b, key, r, depth, x, y, z, rx = 0, ry = 0, rz = 0) {
  primitives(b);
  b.cyl(key, r, depth, x, y, z, rx, ry, rz, 'heavyCyl8');
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

/** Flat disc facing forward (-Z): round hatches, tube mouths, bearing caps. */
function disc(b, key, seg, r, depth, x, y, z) {
  primitives(b);
  b.cyl(key, r, depth, x, y, z, HALF, 0, 0, 'heavyCyl' + seg);
}

/** Open-ended tube (local axis along Z): recessed launch-tube mouths. */
function openTube(b, key, r, len, x, y, z) {
  primitives(b);
  b.cyl(key, r, len, x, y, z, HALF, 0, 0, 'heavyCyl12Open');
}

/** Turned ammo / power drum (axis = local Y before rotation). */
function drum(b, key, r, len, x, y, z, rx = 0, ry = 0, rz = 0) {
  primitives(b);
  emit(b, key, 'heavyDrum', r, len, r, x, y, z, rx, ry, rz);
}

/* ================================================================== *
 *  Chassis hooks
 * ================================================================== */

/** buildPelvis() — hip block, belt pouches, tasset armour, rear power pack. */
function pelvis(b, M, def, { pw, ph, pd }) {
  b.buckets.clear();
  primitives(b);

  // hip block: dark frame, armour bands, trim belt, crotch guard
  plate(b, 'dark', pw * 0.86, ph * 0.96, pd * 0.84, 0, 0, 0);
  plate(b, 'armor', pw * 1.0, ph * 0.46, pd * 0.96, 0, ph * 0.18, 0);
  plate(b, 'armor', pw * 0.94, ph * 0.42, pd * 0.92, 0, -ph * 0.24, 0);
  plate(b, 'trim', pw * 1.02, ph * 0.08, pd * 1.0, 0, -ph * 0.02, 0);
  trapPlate(b, 'armor', pw * 0.42, ph * 0.6, pd * 0.2, 0, -ph * 0.5, -pd * 0.4, -0.14);
  plate(b, 'trim', pw * 0.24, ph * 0.1, 0.045, 0, -ph * 0.28, -pd * 0.5);
  b.box('core', pw * 0.16, 0.013, 0.02, 0, -ph * 0.28, -pd * 0.525);
  // layered belly guard under the belt
  plate(b, 'dark', pw * 0.6, ph * 0.16, pd * 0.1, 0, -ph * 0.42, -pd * 0.45, -0.1);

  // hip articulation + tassets + belt pouches
  for (const side of [-1, 1]) {
    const hx = side * M.hipX;
    const hy = -ph * 0.16;
    b.sphere('dark', M.hipX * 0.62, hx, hy, 0);
    cylN(b, 'dark', 12, M.hipX * 0.46, 0.03, hx + side * M.hipX * 0.44, hy, 0, 0, 0, HALF);
    cylN(b, 'trim', 12, M.hipX * 0.3, 0.022, hx + side * M.hipX * 0.6, hy, 0, 0, 0, HALF);
    plate(b, 'armor', pw * 0.2, ph * 0.78, pd * 0.8, side * pw * 0.52, -ph * 0.22, -pd * 0.02, 0, 0, side * -0.24);
    plate(b, 'trim', pw * 0.045, ph * 0.66, pd * 0.4, side * pw * 0.64, -ph * 0.2, -pd * 0.1, 0, 0, side * -0.24);
    plate(b, 'dark', pw * 0.1, ph * 0.28, pd * 0.26, side * pw * 0.56, -ph * 0.54, pd * 0.12);
    rod(b, 'dark', 12, 0.011, side * pw * 0.36, -ph * 0.04, pd * 0.3, side * pw * 0.26, -ph * 0.42, pd * 0.44);
    // belt pouches
    plate(b, 'dark', pw * 0.15, ph * 0.3, pd * 0.14, side * pw * 0.33, -ph * 0.34, -pd * 0.38, 0, side * 0.12);
    plate(b, 'trim', pw * 0.17, ph * 0.06, pd * 0.155, side * pw * 0.33, -ph * 0.23, -pd * 0.385, 0, side * 0.12);
    b.box('accent', pw * 0.06, 0.014, 0.02, side * pw * 0.33, -ph * 0.34, -pd * 0.46, 0, side * 0.12);
    // hip actuator cover + service bolts
    plate(b, 'trim', 0.02, ph * 0.24, pd * 0.28, side * pw * 0.55, -ph * 0.34, pd * 0.03, 0, 0, side * -0.2);
    bolt(b, 'trim', 0.012, 0.011, side * pw * 0.58, -ph * 0.2, -pd * 0.34, 0, 0, HALF);
  }

  // rear power pack: housing, radiator grille, warning stripe, power cells
  plate(b, 'dark', pw * 0.58, ph * 0.56, pd * 0.16, 0, -ph * 0.02, pd * 0.55);
  plate(b, 'armor', pw * 0.46, ph * 0.4, 0.05, 0, -ph * 0.02, pd * 0.63);
  slatRow(b, 'trim', 3, pw * 0.38, 0.014, 0.02, 0, -ph * 0.02, pd * 0.665, 0, 0.035, 0);
  b.box('accent', pw * 0.3, 0.024, 0.02, 0, ph * 0.22, pd * 0.55);
  for (const side of [-1, 1]) {
    cylN(b, 'dark', 12, pw * 0.075, ph * 0.16, side * pw * 0.19, ph * 0.3, pd * 0.5);
    rod(b, 'dark', 8, 0.009, side * pw * 0.34, ph * 0.28, pd * 0.48, side * pw * 0.42, ph * 0.06, pd * 0.4);
  }

  // pelvis-top power collar (the torso pivot rides inside it)
  cylN(b, 'dark', 16, pw * 0.3, ph * 0.2, 0, ph * 0.5, 0);
  cylN(b, 'trim', 16, pw * 0.34, 0.022, 0, ph * 0.58, 0);
  for (const side of [-1, 1]) {
    rod(b, 'trim', 12, 0.012, side * pw * 0.2, ph * 0.26, -pd * 0.34, side * pw * 0.26, ph * 0.06, -pd * 0.42);
  }
}

/** buildTorso() — layered chest, 5-slat grille, missile pods, exhaust stacks. */
function torso(b, M, def, { cw, ch, cd, cy }) {
  b.buckets.clear();
  primitives(b);

  // massed chassis: dark frame + upper chest + abdomen + waist seal
  plate(b, 'dark', cw * 0.86, ch * 0.92, cd * 0.84, 0, cy, 0);
  plate(b, 'armor', cw * 1.0, ch * 0.5, cd * 0.98, 0, cy + ch * 0.18, 0);
  plate(b, 'armor', cw * 0.9, ch * 0.26, cd * 0.94, 0, cy - ch * 0.26, 0);
  plate(b, 'dark', cw * 0.74, ch * 0.16, cd * 0.88, 0, cy - ch * 0.43, 0);

  // layered front armour: pectoral shell, pectoral wings, sternum ridge
  trapPlate(b, 'armor', cw * 0.9, ch * 0.3, cd * 0.14, 0, cy + ch * 0.26, -cd * 0.47, -0.05);
  for (const side of [-1, 1]) {
    hexPlate(b, 'armor', cw * 0.28, ch * 0.23, cd * 0.12, side * cw * 0.23, cy + ch * 0.2, -cd * 0.46, 0, side * 0.08);
    plate(b, 'trim', cw * 0.045, ch * 0.15, cd * 0.06, side * cw * 0.32, cy + ch * 0.2, -cd * 0.525);
    trapPlate(b, 'dark', cw * 0.4, ch * 0.16, cd * 0.08, side * cw * 0.2, cy - ch * 0.22, -cd * 0.46);
    // flank armour wrapping the ribs
    emitFrame(b, 'armor', 'heavyPlate', cd * 0.66, ch * 0.42, cw * 0.07,
      side * cw * 0.485, cy - ch * 0.02, 0, new THREE.Vector3(0, 1, 0), new THREE.Vector3(side, 0, 0));
    plate(b, 'trim', cw * 0.05, ch * 0.1, cd * 0.4, side * cw * 0.5, cy - ch * 0.16, -cd * 0.06);
    // glow slits on the lower chest flanks
    b.box('core', cw * 0.1, 0.018, 0.02, side * cw * 0.3, cy - ch * 0.1, -cd * 0.49);
  }
  plate(b, 'trim', cw * 0.05, ch * 0.32, 0.05, 0, cy + ch * 0.17, -cd * 0.5);
  b.box('core', cw * 0.34, 0.014, 0.025, 0, cy + ch * 0.4, -cd * 0.47);

  /* --- signature 5-slat vertical chest grille --- */
  const gy = cy + ch * 0.01;
  trapPlate(b, 'armor', cw * 0.44, ch * 0.4, cd * 0.08, 0, gy, -cd * 0.48);
  plate(b, 'dark', cw * 0.36, ch * 0.34, 0.05, 0, gy, -cd * 0.53);
  plate(b, 'core', cw * 0.3, ch * 0.28, 0.018, 0, gy, -cd * 0.548);
  slatRow(b, 'trim', 5, cw * 0.045, ch * 0.28, 0.04, 0, gy, -cd * 0.558, cw * 0.062, 0, 0);
  for (const side of [-1, 1]) {
    b.box('trim', cw * 0.03, ch * 0.34, 0.055, side * cw * 0.2, gy, -cd * 0.545);
  }
  b.box('trim', cw * 0.4, ch * 0.028, 0.06, 0, gy + ch * 0.19, -cd * 0.53);
  b.box('trim', cw * 0.4, ch * 0.028, 0.06, 0, gy - ch * 0.19, -cd * 0.53);
  // abdomen service ribs under the grille
  slatRow(b, 'trim', 3, cw * 0.62, 0.016, 0.022, 0, cy - ch * 0.14, -cd * 0.48, 0, 0.04, 0);

  // collar + neck column (head group rides on top)
  cylN(b, 'dark', 16, cw * 0.22, ch * 0.08, 0, cy + ch * 0.5, 0);
  cylN(b, 'trim', 16, cw * 0.24, 0.022, 0, cy + ch * 0.56, 0);
  cylN(b, 'dark', 12, cw * 0.09, ch * 0.16, 0, cy + ch * 0.61, 0);
  cylN(b, 'trim', 12, cw * 0.12, 0.02, 0, cy + ch * 0.68, 0);

  // back shell + shoulder yoke + service bolts
  plate(b, 'armor', cw * 0.76, ch * 0.32, cd * 0.1, 0, cy + ch * 0.16, cd * 0.46, 0.05);
  plate(b, 'trim', cw * 0.9, 0.03, cd * 0.36, 0, cy + ch * 0.44, 0);
  for (const side of [-1, 1]) {
    bolt(b, 'trim', 0.015, 0.013, side * cw * 0.3, cy + ch * 0.38, -cd * 0.46);
    // shoulder pistons down to the upper arms
    rod(b, 'trim', 12, 0.014, side * cw * 0.42, cy + ch * 0.3, cd * 0.16, side * cw * 0.48, cy + ch * 0.12, -cd * 0.08);
  }

  /* --- rear power pack / radiator block --- */
  plate(b, 'dark', cw * 0.58, ch * 0.5, cd * 0.28, 0, cy, cd * 0.56);
  plate(b, 'armor', cw * 0.46, ch * 0.34, 0.05, 0, cy + ch * 0.08, cd * 0.68);
  plate(b, 'trim', cw * 0.1, ch * 0.4, 0.04, 0, cy + ch * 0.08, cd * 0.7);
  slatRow(b, 'trim', 3, cw * 0.36, 0.016, 0.022, 0, cy - ch * 0.14, cd * 0.72, 0, 0.042, 0);
  for (const side of [-1, 1]) {
    b.box('accent', cw * 0.1, 0.022, 0.02, side * cw * 0.2, cy + ch * 0.2, cd * 0.64);
    // fuel lines from the pack to the exhaust stacks
    rod(b, 'dark', 12, 0.012, side * cw * 0.22, cy + ch * 0.16, cd * 0.62, side * cw * 0.3, cy + ch * 0.36, cd * 0.5);
  }

  /* --- signature shoulder missile pods (3 recessed tubes + trim rims) --- */
  for (const side of [-1, 1]) {
    const tilt = side * -0.12;
    const px = side * 0.69;
    const py = 1.012;
    const pz = 0.03;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    const PX = (ox, oy) => px + ox * cosT - oy * sinT;
    const PY = (ox, oy) => py + ox * sinT + oy * cosT;

    // shoulder mount + pylon up to the pod
    plate(b, 'dark', cw * 0.2, ch * 0.2, cd * 0.5, side * M.shoulderX, M.shoulderY, 0);
    plate(b, 'armor', cw * 0.22, ch * 0.12, cd * 0.34, side * (M.shoulderX + cw * 0.04), M.shoulderY + ch * 0.08, 0);
    plate(b, 'dark', 0.17, 0.15, 0.34, PX(-side * 0.13, -0.12), PY(-side * 0.13, -0.12), pz);
    cylN(b, 'trim', 16, 0.045, 0.05, side * (M.shoulderX + cw * 0.06), M.shoulderY - ch * 0.06, 0, 0, 0, HALF);
    // tiered pauldron lames over the shoulder joint
    plate(b, 'armor', cw * 0.4, cd * 0.6, ch * 0.11, side * M.shoulderX, M.shoulderY + ch * 0.2, 0, HALF, 0, side * 0.14);
    plate(b, 'armor', cw * 0.36, cd * 0.62, ch * 0.12, side * (M.shoulderX + cw * 0.03), M.shoulderY + ch * 0.08, 0, HALF, 0, side * 0.22);
    plate(b, 'armor', cw * 0.3, cd * 0.46, ch * 0.1, side * (M.shoulderX + cw * 0.06), M.shoulderY - ch * 0.04, 0, HALF, 0, side * 0.42);
    plate(b, 'armor', cw * 0.24, cd * 0.32, ch * 0.09, side * (M.shoulderX + cw * 0.08), M.shoulderY - ch * 0.17, 0, HALF, 0, side * 0.66);
    plate(b, 'trim', cw * 0.36, cd * 0.54, 0.02, side * (M.shoulderX + cw * 0.03), M.shoulderY + ch * 0.13, 0, HALF, 0, side * 0.24);
    bolt(b, 'trim', 0.016, 0.016, side * (M.shoulderX + cw * 0.02), M.shoulderY + ch * 0.25, -cd * 0.18);
    // shoulder skirt lames hanging over the joint
    plate(b, 'armor', cw * 0.22, ch * 0.24, cd * 0.4, side * (M.shoulderX + cw * 0.1), M.shoulderY - ch * 0.12, 0, 0, 0, side * 0.3);

    // pod housing: layered volumes + trim edges + rear service cap
    plate(b, 'dark', 0.32, 0.26, 0.46, px, py, pz, 0, 0, tilt);
    plate(b, 'armor', 0.36, 0.1, 0.47, PX(0, 0.15), PY(0, 0.15), pz, 0, 0, tilt);
    plate(b, 'armor', 0.3, 0.09, 0.44, PX(0, -0.155), PY(0, -0.155), pz, 0, 0, tilt);
    plate(b, 'armor', 0.05, 0.19, 0.34, PX(side * 0.172, 0), PY(side * 0.172, 0), pz, 0, 0, tilt);
    plate(b, 'dark', 0.26, 0.22, 0.08, px, py, pz + 0.235, 0, 0, tilt);
    pentPlate(b, 'armor', 0.11, 0.16, 0.05, PX(side * 0.12, 0.06), PY(side * 0.12, 0.06), pz - 0.2, 0, 0, tilt);
    // launch bay: proud rust frame bars with the tube mouths recessed inside
    plate(b, 'trim', 0.35, 0.034, 0.12, PX(0, 0.118), PY(0, 0.118), pz - 0.21, 0, 0, tilt);
    plate(b, 'trim', 0.33, 0.032, 0.12, PX(0, -0.112), PY(0, -0.112), pz - 0.21, 0, 0, tilt);
    for (const sx of [-1, 1]) {
      plate(b, 'trim', 0.038, 0.21, 0.12, PX(sx * 0.158, 0), PY(sx * 0.158, 0), pz - 0.21, 0, 0, tilt);
    }
    // three recessed launch tubes: open collars sunk into the housing face
    for (let i = 0; i < 3; i++) {
      const ox = (i - 1) * 0.092;
      openTube(b, 'trim', 0.05, 0.09, PX(ox, 0.012), PY(ox, 0.012), pz - 0.215);
      disc(b, 'trim', 8, 0.046, 0.024, PX(ox, 0.012), PY(ox, 0.012), pz - 0.225);
    }
    // warning lights + hinge lug + cable
    b.box('accent', 0.1, 0.014, 0.03, PX(0.07, 0.205), PY(0.07, 0.205), pz - 0.12, 0, 0, tilt);
    b.box('accent', 0.06, 0.012, 0.03, PX(-0.08, 0.205), PY(-0.08, 0.205), pz - 0.12, 0, 0, tilt);
    rod(b, 'dark', 8, 0.012, PX(-side * 0.13, -0.12), PY(-side * 0.13, -0.12), pz + 0.08,
      side * (M.shoulderX + cw * 0.02), M.shoulderY - ch * 0.04, cd * 0.2);
  }

  /* --- signature twin exhaust stacks behind the shoulders --- */
  for (const side of [-1, 1]) {
    const ex = side * cw * 0.34;
    const tilt = 0.14;
    // mount block tying the stack to the back armour
    plate(b, 'dark', 0.15, 0.18, 0.12, ex, cy + ch * 0.3, cd * 0.5);
    cylN(b, 'dark', 12, 0.085, 0.1, ex, cy + ch * 0.42, cd * 0.62, tilt, 0, 0);
    cylN(b, 'dark', 16, 0.065, 0.36, ex, cy + ch * 0.66, cd * 0.68, tilt, 0, 0);
    cylN(b, 'trim', 12, 0.072, 0.024, ex, cy + ch * 0.56, cd * 0.665, tilt, 0, 0);
    cylN(b, 'trim', 12, 0.072, 0.024, ex, cy + ch * 0.74, cd * 0.7, tilt, 0, 0);
    cylN(b, 'trim', 12, 0.078, 0.035, ex, cy + ch * 0.9, cd * 0.72, tilt, 0, 0);
    cylN(b, 'core', 12, 0.05, 0.055, ex, cy + ch * 0.945, cd * 0.727, tilt, 0, 0);
    rod(b, 'trim', 12, 0.012, ex, cy + ch * 0.44, cd * 0.52, ex, cy + ch * 0.74, cd * 0.6);
    slatRow(b, 'dark', 2, 0.09, 0.012, 0.016, ex, cy + ch * 0.5, cd * 0.6, 0, 0.028, 0);
  }
}

/** buildHead() — tiny helmet, visor slit, jaw grille, twin sensor booms. */
function head(b, M, def, { w, h, d, y }) {
  b.buckets.clear();
  primitives(b);

  // helmet mass: dark shell, armour face, crown, jaw
  plate(b, 'dark', w * 0.9, h * 0.82, d * 0.9, 0, y, 0.01);
  plate(b, 'armor', w * 1.0, h * 0.5, d * 0.72, 0, y + h * 0.1, -d * 0.09);
  trapPlate(b, 'armor', w * 0.92, h * 0.22, d * 0.6, 0, y + h * 0.42, -d * 0.02, -0.06);
  plate(b, 'armor', w * 1.02, h * 0.14, d * 0.34, 0, y + h * 0.3, -d * 0.32, -0.18);
  plate(b, 'dark', w * 0.8, h * 0.2, d * 0.8, 0, y - h * 0.4, 0.01);
  // crown crest + tiny status lamp
  plate(b, 'trim', w * 0.16, h * 0.2, d * 0.42, 0, y + h * 0.5, 0.03);
  b.box('core', w * 0.1, 0.01, 0.04, 0, y + h * 0.57, -d * 0.13);
  // visor recess + emissive slit + cheek lamps
  plate(b, 'dark', w * 0.9, h * 0.22, 0.05, 0, y + h * 0.03, -d * 0.45);
  b.box('visor', w * 0.72, h * 0.085, 0.03, 0, y + h * 0.03, -d * 0.45 - 0.012);
  for (const side of [-1, 1]) {
    b.box('accent', w * 0.05, h * 0.05, 0.02, side * w * 0.42, y + h * 0.03, -d * 0.5);
    // cheek guards, ear pods, service bolts
    plate(b, 'armor', w * 0.15, h * 0.34, d * 0.34, side * w * 0.44, y - h * 0.12, -d * 0.2, 0.04, side * 0.16, side * -0.1);
    cylN(b, 'dark', 12, w * 0.13, 0.045, side * w * 0.5, y, 0.02, 0, 0, HALF);
    cylN(b, 'trim', 8, w * 0.075, 0.024, side * (w * 0.5 + w * 0.09), y, 0.02, 0, 0, HALF);
    bolt(b, 'trim', 0.012, 0.011, side * w * 0.36, y + h * 0.3, -d * 0.34);
  }
  // jaw grille: recessed housing + three slats
  plate(b, 'dark', w * 0.5, h * 0.2, d * 0.24, 0, y - h * 0.42, -d * 0.24);
  slatRow(b, 'trim', 3, w * 0.055, h * 0.2, 0.026, 0, y - h * 0.42, -d * 0.38, w * 0.15, 0, 0);
  // rear counterweight
  plate(b, 'armor', w * 0.72, h * 0.24, 0.05, 0, y, d * 0.46);
  // neck guard
  plate(b, 'trim', w * 0.5, h * 0.07, d * 0.26, 0, y - h * 0.52, d * 0.1, 0.2);

  /* --- signature twin sensor booms: mast, angled arm, forward sensor pod --- */
  for (const side of [-1, 1]) {
    plate(b, 'trim', 0.06, 0.04, 0.06, side * w * 0.32, y + h * 0.5, d * 0.08, 0, 0, side * 0.16);
    cylN(b, 'dark', 12, 0.016, 0.09, side * w * 0.345, y + h * 0.57, d * 0.1);
    rod(b, 'trim', 12, 0.012, side * w * 0.345, y + h * 0.6, d * 0.1,
      side * w * 0.46, y + h * 0.88, d * 0.26);
    b.octa('trim', 0.03, side * w * 0.46, y + h * 0.88, d * 0.26);
    b.box('dark', 0.05, 0.045, 0.08, side * w * 0.46, y + h * 0.88, d * 0.2);
    disc(b, 'visor', 8, 0.017, 0.012, side * w * 0.46, y + h * 0.88, d * 0.2 - 0.048);
  }
}

/** buildArm() — servo shoulder, pistons, armoured forearm; left is the cannon. */
function arm(b, M, def, side, { bend, dirY, dirZ, elbowY, handY, handZ, midY, midZ, aw }) {
  b.buckets.clear();
  primitives(b);
  const upper = M.armUpper;
  const fore = M.armFore;
  const foreAx = new THREE.Vector3(0, -dirY, -dirZ); // elbow -> hand
  const foreFront = new THREE.Vector3(0, dirZ, -dirY); // forearm front/top normal
  const dirX = new THREE.Vector3(side, 0, 0);

  // shoulder: articulated ball + trim hub
  b.sphere('armor', aw * 0.95, 0, 0, 0);
  cylN(b, 'dark', 16, aw * 0.62, aw * 0.86, 0, -aw * 0.06, 0);
  cylN(b, 'trim', 16, aw * 0.66, 0.022, 0, -aw * 0.04, 0);
  b.octa('trim', aw * 0.34, side * aw * 0.62, -aw * 0.04, 0);
  bolt(b, 'trim', 0.014, 0.013, side * aw * 0.9, -aw * 0.04, 0, 0, 0, HALF);

  // upper arm: dark frame + front / outer armour shells + seam
  plate(b, 'dark', aw * 1.0, upper * 0.94, aw * 1.02, 0, elbowY * 0.5, 0);
  emitFrame(b, 'armor', 'heavyPlate', aw * 1.12, upper * 0.8, aw * 0.3, 0, elbowY * 0.5, -aw * 0.44,
    new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1));
  emitFrame(b, 'armor', 'heavyPlate', aw * 0.34, upper * 0.78, aw * 1.08, side * aw * 0.52, elbowY * 0.5, 0,
    new THREE.Vector3(0, -1, 0), dirX);
  emitFrame(b, 'trim', 'heavyPlate', aw * 0.86, 0.02, aw * 0.9, 0, elbowY * 0.82, 0,
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
  plate(b, 'dark', aw * 0.36, upper * 0.3, aw * 0.36, 0, elbowY * 0.35, aw * 0.44);
  hexPlate(b, 'armor', aw * 0.6, upper * 0.24, aw * 0.3, 0, elbowY * 0.7, -aw * 0.56, 0.1);
  // twin pistons + cable on the outer face
  rod(b, 'trim', 12, 0.014, side * aw * 0.46, -aw * 0.1, aw * 0.5, side * aw * 0.46, elbowY + 0.05, aw * 0.34);
  rod(b, 'dark', 12, 0.01, side * aw * 0.3, -aw * 0.16, aw * 0.52, side * aw * 0.32, elbowY + 0.02, aw * 0.28);
  rod(b, 'dark', 8, 0.007, -side * aw * 0.28, -aw * 0.1, -aw * 0.46, -side * aw * 0.28, elbowY + 0.06, -aw * 0.3);
  bolt(b, 'trim', 0.012, 0.011, side * aw * 0.66, elbowY * 0.6, 0, 0, 0, HALF);
  bolt(b, 'trim', 0.011, 0.01, side * aw * 0.56, midY, midZ, 0, 0, HALF);

  // elbow bearing + cap + guard
  cylN(b, 'dark', 16, aw * 0.6, aw * 1.24, 0, elbowY, 0, 0, 0, HALF);
  cylN(b, 'trim', 12, aw * 0.32, 0.022, side * aw * 0.64, elbowY, 0, 0, 0, HALF);
  b.octa('trim', aw * 0.17, side * aw * 0.7, elbowY, 0);
  plate(b, 'armor', aw * 0.55, aw * 0.4, aw * 0.5, 0, elbowY + aw * 0.14, -aw * 0.36, 0.18);

  // forearm: frame + front bracer + outer shell + wrist cuff + vents
  plate(b, 'dark', aw * 0.94, fore * 0.98, aw * 0.96, 0, midY, midZ, bend);
  emitFrame(b, 'armor', 'heavyPlate', aw * 1.14, fore * 0.86, aw * 0.3,
    0, midY + foreFront.y * aw * 0.5, midZ + foreFront.z * aw * 0.5, foreAx, foreFront);
  emitFrame(b, 'armor', 'heavyPlate', aw * 0.3, fore * 0.8, aw * 1.06, side * aw * 0.5, midY, midZ, foreAx, dirX);
  emitFrame(b, 'trim', 'heavyPlate', aw * 1.0, fore * 0.09, aw * 0.34,
    0, midY + foreFront.y * aw * 0.52, midZ + foreFront.z * aw * 0.52, foreAx, foreFront);
  for (let i = -1; i <= 1; i++) {
    const t = i * 0.04;
    b.box('dark', aw * 0.3, 0.014, 0.02,
      side * aw * 0.4,
      midY + dirY * t + foreFront.y * aw * 0.44,
      midZ + dirZ * t + foreFront.z * aw * 0.44,
      bend);
  }
  cylN(b, 'dark', 12, aw * 0.44, 0.05, 0, handY + dirY * 0.08, handZ + dirZ * 0.08, bend);
  cylN(b, 'trim', 12, aw * 0.5, 0.02, 0, handY + dirY * 0.13, handZ + dirZ * 0.13, bend);

  if (side < 0) {
    /* left forearm is an armoured cannon / ram shield (no hand) */
    const fwdY = handY + dirY * 0.02;
    const fwdZ = handZ + dirZ * 0.02;
    // cannon housing wrapping the forearm + ram plate
    plate(b, 'dark', aw * 1.32, fore * 1.02, aw * 1.26, 0, midY, midZ, bend);
    emitFrame(b, 'armor', 'heavyPlate', aw * 0.36, fore * 0.94, aw * 1.42, side * aw * 0.56, midY, midZ, foreAx, dirX);
    emitFrame(b, 'armor', 'heavyPlate', aw * 1.5, fore * 0.86, aw * 0.3,
      0, midY + foreFront.y * aw * 0.62, midZ + foreFront.z * aw * 0.62, foreAx, foreFront);
    emitFrame(b, 'trim', 'heavyPlate', aw * 1.36, fore * 0.1, aw * 0.34,
      0, midY + foreFront.y * aw * 0.64, midZ + foreFront.z * aw * 0.64, foreAx, foreFront);
    pentPlate(b, 'armor', aw * 1.34, aw * 0.6, aw * 0.3, 0, fwdY, fwdZ - aw * 0.1, bend);
    // forward cannon barrel + shroud + muzzle
    cylN(b, 'dark', 16, aw * 0.36, 0.14, 0, fwdY - 0.02, fwdZ - 0.12, HALF, 0, 0);
    cylN(b, 'gun', 16, aw * 0.26, 0.3, 0, fwdY - 0.02, fwdZ - 0.27, HALF, 0, 0);
    cylN(b, 'trim', 16, aw * 0.34, 0.032, 0, fwdY - 0.02, fwdZ - 0.36, HALF, 0, 0);
    cylN(b, 'dark', 12, aw * 0.2, 0.05, 0, fwdY - 0.02, fwdZ - 0.42, HALF, 0, 0);
    disc(b, 'core', 8, 0.048, 0.012, 0, fwdY - 0.02, fwdZ - 0.44);
    for (let i = 0; i < 4; i++) {
      const a = i * HALF;
      b.box('dark', 0.036, 0.05, 0.09,
        Math.cos(a) * aw * 0.24, fwdY - 0.02 + Math.sin(a) * aw * 0.24, fwdZ - 0.3);
    }
    // recoil pistons along the top of the housing
    rod(b, 'trim', 12, 0.014, side * aw * 0.3, midY + dirY * 0.16, midZ + dirZ * 0.16,
      side * aw * 0.3, midY + dirY * 0.02, midZ + dirZ * 0.02 + aw * 0.2);
    rod(b, 'trim', 12, 0.014, -side * aw * 0.3, midY + dirY * 0.16, midZ + dirZ * 0.16,
      -side * aw * 0.3, midY + dirY * 0.02, midZ + dirZ * 0.02 + aw * 0.2);
    // drum magazine on the outer face + warning stripes
    drum(b, 'dark', aw * 0.72, aw * 0.52, side * aw * 0.9, midY, midZ, 0, 0, HALF);
    cylN(b, 'trim', 12, aw * 0.24, 0.03, side * aw * 1.17, midY, midZ, 0, 0, HALF);
    cylN(b, 'dark', 8, aw * 0.12, 0.02, side * aw * 1.2, midY, midZ, 0, 0, HALF);
    b.box('accent', 0.02, 0.03, aw * 0.3, side * aw * 1.23, midY + aw * 0.3, midZ);
    b.box('accent', 0.02, 0.03, aw * 0.3, side * aw * 1.23, midY - aw * 0.3, midZ);
    bolt(b, 'trim', 0.013, 0.012, side * aw * 1.24, midY, midZ, 0, 0, HALF);
  } else {
    // right hand: compact fist (palm + knuckle plate + three fingers + thumb)
    plate(b, 'dark', aw * 1.0, aw * 1.1, aw * 1.15, 0, handY - dirY * aw * 0.5, handZ - dirZ * aw * 0.5, bend);
    emitFrame(b, 'armor', 'heavyPlate', aw * 0.9, aw * 0.85, aw * 0.22,
      0, handY - dirY * aw * 0.5 + foreFront.y * aw * 0.42, handZ - dirZ * aw * 0.5 + foreFront.z * aw * 0.42, foreAx, foreFront);
    for (let i = 0; i < 3; i++) {
      const fx = (i - 1) * aw * 0.27;
      b.box('dark', aw * 0.22, aw * 0.6, aw * 0.3, fx, handY - dirY * aw * 1.0, handZ - dirZ * aw * 1.0 - aw * 0.12, bend);
      b.box('trim', aw * 0.2, aw * 0.16, aw * 0.24, fx, handY - dirY * aw * 1.1, handZ - dirZ * aw * 1.1 - aw * 0.12, bend);
    }
    b.box('dark', aw * 0.24, aw * 0.4, aw * 0.36, side * aw * 0.46, handY - dirY * aw * 0.8, handZ - dirZ * aw * 0.8 - aw * 0.08, bend);
    bolt(b, 'trim', 0.012, 0.011, 0, handY - dirY * aw * 0.5 + foreFront.y * aw * 0.52,
      handZ - dirZ * aw * 0.5 + foreFront.z * aw * 0.52, bend);
    // ammo counter + wrist actuator on the outer forearm
    plate(b, 'dark', 0.018, aw * 0.32, aw * 0.38, aw * 0.6, midY + dirY * 0.1, midZ + dirZ * 0.1, bend);
    b.box('core', 0.008, 0.012, 0.03, aw * 0.63, midY + dirY * 0.12, midZ + dirZ * 0.12, bend);
    rod(b, 'trim', 12, 0.011, aw * 0.56, midY, midZ, aw * 0.5, handY + dirY * 0.12, handZ + dirZ * 0.12);
  }
}

/** buildLeg() — hip bearing, layered thigh, knee guard, shin pistons, boot. */
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
  b.sphere('dark', w * 0.62, 0, 0, 0);
  cylN(b, 'dark', 16, w * 0.46, w * 1.25, 0, 0, 0, 0, 0, HALF);
  cylN(b, 'trim', 12, w * 0.3, 0.022, side * w * 0.68, 0, 0, 0, 0, HALF);
  bolt(b, 'trim', 0.013, 0.012, side * w * 0.74, 0, 0, 0, 0, HALF);

  // thigh: dark frame + front shell + outer shell + seam + rear actuator
  plate(b, 'dark', w * 0.84, thigh * 0.94, w * 0.86, 0, kneeMidY, kneeMidZ, a1);
  emitFrame(b, 'armor', 'heavyPlate', w * 1.1, thigh * 0.86, w * 0.24,
    0, kneeMidY + thighFront.y * w * 0.45, kneeMidZ + thighFront.z * w * 0.45, thighAx, thighFront);
  emitFrame(b, 'armor', 'heavyPlate', w * 0.26, thigh * 0.82, w * 1.14, side * w * 0.48, kneeMidY, kneeMidZ, thighAx, dirX);
  emitFrame(b, 'trim', 'heavyPlate', w * 0.9, 0.02, w * 0.94, 0, kneeY * 0.7, kneeZ * 0.7,
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
  plate(b, 'dark', w * 0.58, thigh * 0.5, w * 0.3, 0, kneeMidY, kneeMidZ + w * 0.5, a1);
  plate(b, 'armor', w * 0.5, thigh * 0.3, w * 0.2, 0, kneeMidY - thighDirY * w * 0.1, kneeMidZ - thighDirZ * w * 0.1 - w * 0.56, a1);
  // rear thigh actuator armour
  emitFrame(b, 'armor', 'heavyPlate', w * 0.5, thigh * 0.44, w * 0.16,
    0, kneeMidY - thighFront.y * w * 0.4, kneeMidZ - thighFront.z * w * 0.4,
    thighAx, new THREE.Vector3(0, -thighFront.y, -thighFront.z));
  rod(b, 'trim', 12, 0.014, side * w * 0.36, -w * 0.1, w * 0.46, side * w * 0.36, kneeY + 0.05, kneeZ + w * 0.4);
  rod(b, 'dark', 8, 0.01, side * w * 0.26, -w * 0.18, w * 0.5, side * w * 0.28, kneeY + 0.02, kneeZ + w * 0.28);
  bolt(b, 'trim', 0.013, 0.012, -side * w * 0.28, kneeY * 0.32, kneeZ * 0.32 - w * 0.6, a1);
  // thigh-top hip guard
  plate(b, 'armor', w * 0.9, w * 0.2, w * 0.34, 0, -w * 0.2, -w * 0.34, 0.12);

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
  emitFrame(b, 'armor', 'heavyPlate', w * 0.96, shin * 0.88, w * 0.22,
    shinFront.x * w * 0.05, (kneeY + ankleY) * 0.5 + shinFront.y * w * 0.42,
    (kneeZ + ankleZ) * 0.5 + shinFront.z * w * 0.42, shinAx, shinFront);
  emitFrame(b, 'armor', 'heavyPlate', w * 0.22, shin * 0.84, w * 1.04, side * w * 0.44,
    (kneeY + ankleY) * 0.5, (kneeZ + ankleZ) * 0.5, shinAx, dirX);
  for (let i = 0; i < 3; i++) {
    const t = 0.12 - i * 0.036;
    b.box('dark', w * 0.4, 0.014, 0.05, 0,
      (kneeY + ankleY) * 0.5 + t + shinFront.y * w * 0.05,
      (kneeZ + ankleZ) * 0.5 + shinFront.z * w * 0.05, a2);
  }
  for (const sx of [-w * 0.3, w * 0.3]) {
    rod(b, 'trim', 12, 0.013, sx, kneeY - w * 0.06, kneeZ + w * 0.24, sx, ankleY + w * 0.08, ankleZ + w * 0.24);
    rod(b, 'dark', 8, 0.009, sx, ankleY + w * 0.26, ankleZ + w * 0.26, sx, ankleY + 0.02, ankleZ + w * 0.28);
  }
  emitFrame(b, 'trim', 'heavyPlate', w * 0.8, 0.03, w * 0.2,
    0, (kneeY + ankleY) * 0.5 + shinFront.y * w * 0.44,
    (kneeZ + ankleZ) * 0.5 + shinFront.z * w * 0.44, shinAx, shinFront);
  cylN(b, 'dark', 12, w * 0.4, 0.03, 0, ankleY + w * 0.3, ankleZ);
  cylN(b, 'trim', 12, w * 0.34, 0.02, 0, ankleY + w * 0.2, ankleZ);
  // armoured shin skirt above the ankle
  trapPlate(b, 'armor', w * 0.8, w * 0.3, w * 0.3, 0, ankleY + w * 0.34, ankleZ - w * 0.36, 0.16);
  // rear calf armour over the dark shin frame
  emitFrame(b, 'armor', 'heavyPlate', w * 0.62, shin * 0.52, w * 0.18,
    0, (kneeY + ankleY) * 0.5 - shinFront.y * w * 0.36, (kneeZ + ankleZ) * 0.5 - shinFront.z * w * 0.36,
    shinAx, new THREE.Vector3(0, -shinFront.y, -shinFront.z));

  // ankle joint
  b.sphere('dark', w * 0.44, 0, ankleY, ankleZ);
  cylN(b, 'trim', 16, w * 0.28, 0.03, side * w * 0.34, ankleY, ankleZ, 0, 0, HALF);

  /* --- armoured boot: sole, body, split toe caps, heel, treads, buckles --- */
  const fz = ankleZ - M.footL * 0.32;
  const soleH = M.footH * 0.34;
  const soleY = footY - M.footH * 0.53 + soleH * 0.5; // lowest point stays on the ground
  b.box('dark', M.footW * 1.02, soleH, M.footL * 1.02, 0, soleY, fz);
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
    b.box('dark', M.footW * 1.04, M.footH * 0.2, M.footL * 0.09, 0, soleY, fz - M.footL * 0.36 + i * M.footL * 0.24);
  }
  for (const sx of [-1, 1]) {
    b.box('dark', 0.014, M.footH * 0.24, M.footL * 0.16, sx * M.footW * 0.49, footY + M.footH * 0.16, fz - M.footL * 0.1);
    b.box('trim', 0.012, 0.014, M.footL * 0.12, sx * M.footW * 0.5, footY + M.footH * 0.3, fz - M.footL * 0.12);
  }
  b.box('accent', M.footW * 0.18, 0.012, 0.014, 0, footY + M.footH * 0.36, fz - M.footL * 0.44);
  bolt(b, 'trim', 0.013, 0.012, side * M.footW * 0.28, footY + M.footH * 0.1, fz - M.footL * 0.3);
}

/** buildGun() — siege rifle: heavy receiver, twin barrels, shroud, brake, drum. */
function gun(b, M, def, { s, bodyW, bodyH, bodyL, barrelLen, bodyCenterZ, barrelCenterZ, tipZ }) {
  b.buckets.clear();
  primitives(b);
  const boreY = 0.05 * s;
  const rearZ = bodyCenterZ + bodyL * 0.5;

  // receiver: main body + upper/lower + side panels + ejection port
  plate(b, 'gun', bodyW * 1.06, bodyH * 1.0, bodyL * 0.92, 0, 0.045 * s, bodyCenterZ);
  plate(b, 'dark', bodyW * 0.98, bodyH * 0.3, bodyL * 0.86, 0, 0.045 * s + bodyH * 0.5, bodyCenterZ);
  plate(b, 'dark', bodyW * 0.9, bodyH * 0.26, bodyL * 0.62, 0, 0.045 * s - bodyH * 0.44, bodyCenterZ - 0.02 * s);
  for (const side of [-1, 1]) {
    plate(b, 'gun', 0.01, bodyH * 0.56, bodyL * 0.64, side * bodyW * 0.55, 0.045 * s, bodyCenterZ);
    plate(b, 'trim', 0.008, 0.012, bodyL * 0.48, side * bodyW * 0.56, 0.045 * s + bodyH * 0.2, bodyCenterZ - 0.02 * s);
    bolt(b, 'trim', 0.011 * s, 0.011 * s, side * bodyW * 0.57, 0.045 * s - bodyH * 0.16, bodyCenterZ + bodyL * 0.24, 0, 0, HALF);
  }
  b.box('dark', 0.028 * s, 0.036 * s, 0.1 * s, bodyW * 0.5, 0.045 * s + bodyH * 0.16, bodyCenterZ + 0.03 * s);
  // top rail + rail slots
  plate(b, 'dark', 0.048 * s, 0.016 * s, bodyL * 0.84, 0, 0.045 * s + bodyH * 0.67, bodyCenterZ);
  slatRow(b, 'gun', 4, 0.055 * s, 0.009 * s, 0.018 * s, 0, 0.045 * s + bodyH * 0.73, bodyCenterZ, 0, 0, 0.055 * s);

  // stock: buffer tube + cheek + butt plate + hinge
  cylN(b, 'dark', 16, 0.028 * s, 0.17 * s, 0, 0.045 * s + bodyH * 0.2, rearZ + 0.06 * s, HALF, 0, 0);
  plate(b, 'gun', 0.052 * s, 0.105 * s, 0.22 * s, 0, 0.045 * s + 0.006 * s, rearZ + 0.17 * s);
  plate(b, 'trim', 0.06 * s, 0.12 * s, 0.028 * s, 0, 0.045 * s + 0.006 * s, rearZ + 0.29 * s);
  plate(b, 'dark', 0.034 * s, 0.034 * s, 0.1 * s, 0, 0.045 * s + bodyH * 0.36, rearZ + 0.16 * s);
  plate(b, 'dark', 0.03 * s, 0.09 * s, 0.05 * s, 0.03 * s, 0.045 * s - bodyH * 0.06, rearZ + 0.1 * s);

  // pistol grip + trigger + guard
  plate(b, 'dark', 0.054 * s, 0.2 * s, 0.075 * s, 0, -0.105 * s, bodyCenterZ + 0.04 * s, 0.24);
  b.box('dark', 0.06 * s, 0.022 * s, 0.08 * s, 0, -0.2 * s, bodyCenterZ + 0.07 * s, 0.24);
  for (let i = 0; i < 2; i++) {
    b.box('trim', 0.056 * s, 0.011 * s, 0.065 * s, 0, (-0.095 - i * 0.045) * s, bodyCenterZ + (0.03 + i * 0.02) * s, 0.24);
  }
  b.beam('gun', 0, -0.035 * s, -0.025 * s, 0, -0.115 * s, -0.06 * s, 0.009 * s);
  b.beam('gun', 0, -0.115 * s, -0.06 * s, 0, -0.115 * s, 0.037 * s, 0.009 * s);
  b.box('dark', 0.013 * s, 0.05 * s, 0.016 * s, 0, -0.075 * s, -0.02 * s, 0.2);

  // magazine: two-stage curved body + ribs + base plate
  plate(b, 'dark', 0.066 * s, 0.17 * s, 0.09 * s, 0, -0.1 * s, bodyCenterZ + 0.02 * s, 0.16);
  plate(b, 'gun', 0.062 * s, 0.11 * s, 0.08 * s, 0, -0.215 * s, bodyCenterZ + 0.05 * s, 0.3);
  plate(b, 'trim', 0.07 * s, 0.022 * s, 0.085 * s, 0, -0.275 * s, bodyCenterZ + 0.06 * s, 0.3);
  for (let i = 0; i < 3; i++) {
    b.box('trim', 0.068 * s, 0.009 * s, 0.065 * s, 0, (-0.125 - i * 0.04) * s, bodyCenterZ + (0.03 + i * 0.012) * s, 0.24);
  }
  // side-feed drum magazine under the receiver
  drum(b, 'dark', 0.09 * s, 0.07 * s, 0, -0.13 * s, bodyCenterZ + 0.18 * s, HALF, 0, 0);
  cylN(b, 'trim', 16, 0.095 * s, 0.014 * s, 0, -0.13 * s, bodyCenterZ + 0.22 * s, HALF, 0, 0);
  cylN(b, 'gun', 12, 0.05 * s, 0.016 * s, 0, -0.13 * s, bodyCenterZ + 0.228 * s, HALF, 0, 0);

  // handguard: shell + side panels + top rail + vent slots + front collar
  plate(b, 'gun', bodyW * 1.1, bodyH * 0.92, 0.3 * s, 0, 0.045 * s, bodyCenterZ - 0.34 * s);
  for (const side of [-1, 1]) {
    plate(b, 'dark', 0.012, bodyH * 0.52, 0.26 * s, side * bodyW * 0.57, 0.045 * s, bodyCenterZ - 0.34 * s);
  }
  plate(b, 'dark', 0.038 * s, 0.014 * s, 0.26 * s, 0, 0.045 * s + bodyH * 0.53, bodyCenterZ - 0.34 * s);
  slatRow(b, 'dark', 3, 0.055 * s, 0.008 * s, 0.02 * s, 0, 0.045 * s + bodyH * 0.54, bodyCenterZ - 0.34 * s, 0, 0, 0.055 * s);
  for (let i = 0; i < 4; i++) {
    b.box('dark', bodyW * 0.74, 0.026 * s, 0.014 * s, 0, 0.045 * s, bodyCenterZ - 0.26 * s - i * 0.05 * s);
  }
  cylN(b, 'trim', 16, 0.046 * s, 0.026 * s, 0, 0.045 * s, bodyCenterZ - 0.5 * s, HALF, 0, 0);
  cylN(b, 'dark', 12, 0.032 * s, 0.02 * s, 0, 0.045 * s, bodyCenterZ - 0.52 * s, HALF, 0, 0);
  // fore grip + accessory rail underneath
  plate(b, 'dark', 0.034 * s, 0.1 * s, 0.055 * s, 0, -0.012 * s, bodyCenterZ - 0.36 * s, 0.1);
  plate(b, 'gun', 0.05 * s, 0.02 * s, 0.2 * s, 0, 0.045 * s - bodyH * 0.56, bodyCenterZ - 0.3 * s);
  for (let i = 0; i < 3; i++) {
    b.box('dark', 0.054 * s, 0.012 * s, 0.016 * s, 0, 0.045 * s - bodyH * 0.6, bodyCenterZ - 0.24 * s - i * 0.045 * s);
  }

  // main barrel + gas tube + gas block + front sight
  cylN(b, 'gun', 20, 0.022 * s, barrelLen, 0, boreY, barrelCenterZ, HALF, 0, 0);
  rod(b, 'dark', 12, 0.01 * s, 0, boreY + 0.032 * s, barrelCenterZ + barrelLen * 0.42,
    0, boreY + 0.028 * s, barrelCenterZ - barrelLen * 0.3);
  plate(b, 'dark', 0.055 * s, 0.055 * s, 0.055 * s, 0, boreY + 0.03 * s, barrelCenterZ + barrelLen * 0.26);
  plate(b, 'gun', 0.03 * s, 0.014 * s, 0.065 * s, 0, boreY + 0.045 * s, barrelCenterZ - barrelLen * 0.06);
  b.box('gun', 0.014 * s, 0.032 * s, 0.016 * s, 0, boreY + 0.066 * s, barrelCenterZ - barrelLen * 0.06);
  for (const side of [-1, 1]) {
    b.box('dark', 0.009 * s, 0.024 * s, 0.032 * s, side * 0.013 * s, boreY + 0.045 * s, barrelCenterZ - barrelLen * 0.06);
  }
  cylN(b, 'trim', 12, 0.028 * s, 0.022 * s, 0, boreY, barrelCenterZ + barrelLen * 0.1, HALF, 0, 0);

  // twin extra barrels with cooling rings and their own muzzle collars
  for (const side of [-1, 1]) {
    const bx = side * 0.075 * s;
    cylN(b, 'dark', 16, 0.03 * s, barrelLen * 0.9, bx, boreY, barrelCenterZ + 0.04, HALF, 0, 0);
    for (let i = 0; i < 2; i++) {
      cylN(b, 'trim', 12, 0.036 * s, 0.024 * s, bx, boreY, barrelCenterZ - barrelLen * 0.12 + i * barrelLen * 0.3, HALF, 0, 0);
    }
    cylN(b, 'trim', 16, 0.042 * s, 0.045 * s, bx, boreY, tipZ + 0.06 * s, HALF, 0, 0);
    cylN(b, 'gun', 8, 0.022 * s, 0.03 * s, bx, boreY, tipZ + 0.03 * s, HALF, 0, 0);
  }
  // heavy shroud linking the three barrels
  plate(b, 'armor', bodyW * 1.5, bodyH * 1.2, bodyL * 0.4, 0, 0.045 * s, bodyCenterZ + 0.06);
  plate(b, 'trim', bodyW * 1.56, 0.03 * s, bodyL * 0.1, 0, 0.045 * s + bodyH * 0.62, bodyCenterZ + 0.06);

  // muzzle brake: body, trim collar, baffles, recessed bore
  cylN(b, 'dark', 24, 0.046 * s, 0.15 * s, 0, boreY, tipZ + 0.042 * s, HALF, 0, 0);
  cylN(b, 'trim', 16, 0.052 * s, 0.02 * s, 0, boreY, tipZ + 0.115 * s, HALF, 0, 0);
  for (let i = 0; i < 2; i++) {
    b.box('dark', 0.1 * s, 0.03 * s, 0.012 * s, 0, boreY, tipZ - 0.01 * s + i * 0.05 * s);
    b.box('dark', 0.03 * s, 0.1 * s, 0.012 * s, 0, boreY, tipZ - 0.01 * s + i * 0.05 * s);
  }
  cylN(b, 'gun', 12, 0.028 * s, 0.02 * s, 0, boreY, tipZ - 0.02 * s, HALF, 0, 0);

  // reflex optic on the rail + backup iron sight
  plate(b, 'dark', 0.048 * s, 0.016 * s, 0.12 * s, 0, 0.045 * s + bodyH * 0.84, bodyCenterZ + 0.03 * s);
  for (const side of [-1, 1]) {
    plate(b, 'dark', 0.014 * s, 0.055 * s, 0.034 * s, side * 0.022 * s, 0.045 * s + bodyH * 0.97, bodyCenterZ + 0.03 * s);
  }
  plate(b, 'gun', 0.052 * s, 0.014 * s, 0.11 * s, 0, 0.045 * s + bodyH * 1.13, bodyCenterZ + 0.03 * s);
  b.octa('core', 0.009 * s, 0, 0.045 * s + bodyH * 0.84, bodyCenterZ - 0.02 * s);
  plate(b, 'trim', 0.02 * s, 0.05 * s, 0.02 * s, 0, 0.045 * s + bodyH * 0.8, bodyCenterZ - bodyL * 0.36);
  // charging handle + bolt + side rails
  b.box('dark', 0.022 * s, 0.022 * s, 0.045 * s, bodyW * 0.6, 0.045 * s + bodyH * 0.3, bodyCenterZ + 0.12 * s);
  b.box('accent', 0.006 * s, 0.012 * s, 0.02 * s, bodyW * 0.62, 0.045 * s + bodyH * 0.3, bodyCenterZ + 0.14 * s);
  // folded bipod under the handguard
  for (const side of [-1, 1]) {
    rod(b, 'dark', 8, 0.012 * s, side * 0.04 * s, 0.045 * s - bodyH * 0.56, bodyCenterZ - 0.42 * s,
      side * 0.12 * s, 0.045 * s - bodyH * 1.0, bodyCenterZ - 0.34 * s);
    b.box('trim', 0.03 * s, 0.014 * s, 0.04 * s, side * 0.12 * s, 0.045 * s - bodyH * 1.02, bodyCenterZ - 0.33 * s);
  }

  // keep the exact shared muzzle offset (flash / tracer origin)
  return { tipY: boreY, tipZ };
}

/** buildRobotRig() — shoulder missile-pod hitboxes (torso zone). */
function hitboxes(addHit, torso, M, def) {
  for (const side of [-1, 1]) {
    addHit('torso', torso,
      M.chestW * 0.34, M.chestH * 0.4, M.chestD * 0.78,
      side * (M.shoulderX + M.chestW * 0.1), M.shoulderY + M.chestH * 0.28, 0.04);
  }
}

export const hooks = { pelvis, torso, head, arm, leg, gun, hitboxes };
