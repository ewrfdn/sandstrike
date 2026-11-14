/**
 * Robot chassis shared library — geometry primitives, palette/vertex-colour
 * machinery and the generic part builders used by every chassis.
 *
 * Moved verbatim out of src/enemies.js by the model-split refactor; primitive
 * arguments and emission order are unchanged.  Each generic builder calls the
 * chassis module's hook (if it exported one) at the position where the old
 * `if (key === ...) / else if` chain sat, so the merged geometry is identical.
 *
 * A chassis module (`./scout.js`, `./rifleman.js`, ...) exports:
 *   meta   model-viewer metadata (id / kind / group / label / type / defaultPose)
 *   def    its ROBOT_TYPES entry (gameplay stats + model dimensions)
 *   hooks  { pelvis, torso, head, arm, leg, gun, hitboxes } — only the branches
 *          that chassis actually had; hooks receive the generic builder's
 *          locals so the moved branch bodies could stay verbatim.  `pelvis` is
 *          invoked after the generic pelvis and, like the others, may rewrite
 *          the queued bucket for a fully chassis-specific pelvis.
 */
import * as THREE from 'three';

const _TMP = {
  v1: new THREE.Vector3(),
  v2: new THREE.Vector3(),
  v3: new THREE.Vector3(),
  v4: new THREE.Vector3(),
  v5: new THREE.Vector3(),
  v6: new THREE.Vector3(),
  q1: new THREE.Quaternion(),
  q2: new THREE.Quaternion(),
  e1: new THREE.Euler(),
  m1: new THREE.Matrix4(),
};

const UP = new THREE.Vector3(0, 1, 0);

function hash01(x, y, z) {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

/* ================================================================== *
 *  1. Geometry utilities — shared primitive library + merge-by-material
 * ================================================================== */

export function createUnitGeos() {
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 10, 1),
    cyl6: new THREE.CylinderGeometry(1, 1, 1, 6, 1),
    // open-ended variant for enemy laser sights: a capped cylinder aimed at the
    // player's eye put its end-cap exactly on the camera and read as a giant
    // cyan hexagon for a frame.
    cyl6Open: new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
    cone: new THREE.ConeGeometry(1, 1, 6, 1),
    sphere: new THREE.SphereGeometry(1, 10, 8),
    octa: new THREE.OctahedronGeometry(1, 0),
  };
}

export function disposeUnitGeos(geos) {
  if (!geos) return;
  for (const key in geos) {
    const g = geos[key];
    if (g && g.dispose) g.dispose();
  }
}

/**
 * Palette bucket -> render channel. Palette colours are baked into vertex colours,
 * so every animated chassis part is a single draw call; the hit-flash and the
 * visor/core pulse are then just two tiny per-instance material clones.
 */
const BUCKET_DEFS = {
  armor: { channel: 'body', tint: 'armor', shade: 1 },
  dark: { channel: 'body', tint: 'dark', shade: 1 },
  trim: { channel: 'body', tint: 'trim', shade: 1 },
  gun: { channel: 'body', tint: 'gun', shade: 1 },
  accent: { channel: 'body', tint: 'visor', shade: 0.9 },
  visor: { channel: 'glow', tint: 'visor', shade: 1 },
  core: { channel: 'glow', tint: 'visor', shade: 0.8 },
};

const WHITE_TINT = [0.75, 0.75, 0.75];
const _tintColor = new THREE.Color();

/** Palette hex -> linear RGB triple (respects three's colour management). */
export function paletteTints(palette) {
  const out = {};
  for (const key in palette) {
    _tintColor.setHex(palette[key]);
    out[key] = [_tintColor.r, _tintColor.g, _tintColor.b];
  }
  return out;
}

/**
 * Merge { geo, matrix, tint:[r,g,b], shade } entries into one non-indexed geometry
 * with per-vertex colour (subtle brushed-metal variation * palette tint).
 */
function mergeEntries(entries) {
  let total = 0;
  const prepared = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let g = entry.geo.clone();
    g.applyMatrix4(entry.matrix);
    if (g.index) {
      const ng = g.toNonIndexed();
      g.dispose();
      g = ng;
    }
    prepared.push(g);
    total += g.attributes.position.count;
  }
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const colors = new Float32Array(total * 3);
  let offset = 0;
  for (let i = 0; i < prepared.length; i++) {
    const g = prepared[i];
    const entry = entries[i];
    const tint = entry.tint || WHITE_TINT;
    const shadeBase = entry.shade === undefined ? 1 : entry.shade;
    const posAttr = g.attributes.position;
    const norAttr = g.attributes.normal;
    const uvAttr = g.attributes.uv;
    const vcount = posAttr.count;
    const vstart = offset * 3;
    positions.set(posAttr.array, vstart);
    if (norAttr) normals.set(norAttr.array, vstart);
    if (uvAttr) uvs.set(uvAttr.array, offset * 2);
    for (let v = 0; v < vcount; v++) {
      const vi = vstart + v * 3;
      const shade = shadeBase * (0.82 + hash01(positions[vi], positions[vi + 1], positions[vi + 2]) * 0.3);
      colors[vi] = Math.min(1.2, tint[0] * shade);
      colors[vi + 1] = Math.min(1.2, tint[1] * shade);
      colors[vi + 2] = Math.min(1.2, tint[2] * shade);
    }
    offset += vcount;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/** Accumulates primitives per render channel, then bakes one merged mesh each. */
export class RigBuilder {
  constructor(geos, tints) {
    this.geos = geos;
    this.tints = tints || {};
    this.buckets = new Map();
  }

  _list(channel) {
    let list = this.buckets.get(channel);
    if (!list) {
      list = [];
      this.buckets.set(channel, list);
    }
    return list;
  }

  _push(key, geo, matrix) {
    const def = BUCKET_DEFS[key] || BUCKET_DEFS.armor;
    this._list(def.channel).push({
      geo,
      matrix,
      tint: this.tints[def.tint] || WHITE_TINT,
      shade: def.shade,
    });
  }

  box(key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    _TMP.e1.set(rx, ry, rz);
    _TMP.q1.setFromEuler(_TMP.e1);
    _TMP.m1.compose(_TMP.v1.set(x, y, z), _TMP.q1, _TMP.v2.set(w, h, d));
    this._push(key, this.geos.box, _TMP.m1.clone());
  }

  cyl(key, r, h, x, y, z, rx = 0, ry = 0, rz = 0, geoKey = 'cyl') {
    _TMP.e1.set(rx, ry, rz);
    _TMP.q1.setFromEuler(_TMP.e1);
    _TMP.m1.compose(_TMP.v1.set(x, y, z), _TMP.q1, _TMP.v2.set(r, h, r));
    this._push(key, this.geos[geoKey] || this.geos.cyl, _TMP.m1.clone());
  }

  sphere(key, r, x, y, z, sx = 1, sy = 1, sz = 1) {
    _TMP.m1.compose(_TMP.v1.set(x, y, z), _TMP.q1.identity(), _TMP.v2.set(r * sx, r * sy, r * sz));
    this._push(key, this.geos.sphere, _TMP.m1.clone());
  }

  octa(key, r, x, y, z) {
    _TMP.m1.compose(_TMP.v1.set(x, y, z), _TMP.q1.identity(), _TMP.v2.set(r, r, r));
    this._push(key, this.geos.octa, _TMP.m1.clone());
  }

  /** Thin cylinder spanning two local points (pistons, antennae, cables). */
  beam(key, x1, y1, z1, x2, y2, z2, r) {
    _TMP.v1.set(x2 - x1, y2 - y1, z2 - z1);
    const len = _TMP.v1.length();
    if (len < 1e-4) return;
    _TMP.v1.divideScalar(len);
    _TMP.q1.setFromUnitVectors(UP, _TMP.v1);
    _TMP.m1.compose(
      _TMP.v2.set((x1 + x2) * 0.5, (y1 + y2) * 0.5, (z1 + z2) * 0.5),
      _TMP.q1,
      _TMP.v3.set(r, len, r),
    );
    this._push(key, this.geos.cyl6, _TMP.m1.clone());
  }

  /** Box whose local +Y axis points along (dx,dy,dz); centred at x,y,z. */
  boxDir(key, w, d, len, x, y, z, dx, dy, dz) {
    _TMP.v1.set(dx, dy, dz);
    const l = _TMP.v1.length();
    if (l < 1e-4) return;
    _TMP.v1.divideScalar(l);
    _TMP.q1.setFromUnitVectors(UP, _TMP.v1);
    _TMP.m1.compose(_TMP.v2.set(x, y, z), _TMP.q1, _TMP.v3.set(w, len, d));
    this._push(key, this.geos.box, _TMP.m1.clone());
  }

  finish(group, materials, castShadow = true) {
    const meshes = [];
    for (const [channel, entries] of this.buckets) {
      const mat = materials[channel];
      if (!mat || !entries.length) continue;
      const mesh = new THREE.Mesh(mergeEntries(entries), mat);
      mesh.castShadow = castShadow && channel === 'body';
      mesh.receiveShadow = channel === 'body';
      mesh.userData.enemyPart = channel;
      group.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}

/* ================================================================== *
 *  2. Materials + generic part builders
 * ================================================================== */

/** Base materials shared by every rig: the palette lives in baked vertex colours. */
export function createRobotBaseMaterials() {
  return {
    body: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      metalness: 0.84,
      roughness: 0.4,
      envMapIntensity: 1.0,
    }),
    glow: new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      toneMapped: false,
    }),
  };
}

/** Per-instance clones so hit-flash / visor-core pulse are local to one robot. */
export function createRigMaterialSet(baseMats) {
  const body = baseMats.body.clone();
  const glow = baseMats.glow.clone();
  return { mats: { body, glow }, body, glow, cloned: [body, glow] };
}

function buildPelvis(b, M, def, hooks) {
  const pw = M.pelvisW;
  const ph = M.pelvisH;
  const pd = M.pelvisD;
  b.box('dark', pw * 0.82, ph * 0.9, pd * 0.86, 0, 0, 0);
  b.box('armor', pw, ph, pd, 0, ph * 0.06, 0);
  b.cyl('trim', pw * 0.34, ph * 0.42, 0, ph * 0.5, 0);
  for (const side of [-1, 1]) {
    b.sphere('dark', M.hipX * 0.6, side * M.hipX, -ph * 0.16, 0);
    b.octa('trim', M.hipX * 0.36, side * M.hipX, -ph * 0.16, 0);
    b.box('armor', pw * 0.2, ph * 1.05, pd * 0.92, side * (pw * 0.56), -ph * 0.24, 0, 0, 0, side * -0.24);
    b.box('trim', pw * 0.05, ph * 0.86, pd * 0.46, side * (pw * 0.67), -ph * 0.18, -pd * 0.16);
  }
  b.box('armor', pw * 0.38, ph * 0.8, pd * 0.1, 0, -ph * 0.08, -pd * 0.52, -0.1, 0, 0);
  b.box('accent', pw * 0.16, ph * 0.1, 0.02, 0, ph * 0.28, -pd * 0.55);
  b.box('dark', pw * 0.5, ph * 0.6, pd * 0.16, 0, 0, pd * 0.55);
  b.box('accent', pw * 0.3, 0.028, 0.025, 0, ph * 0.2, pd * 0.64);
  b.beam('dark', -pw * 0.3, ph * 0.4, pd * 0.2, -pw * 0.2, ph * 0.44, pd * 0.4, 0.022);
  b.beam('dark', pw * 0.3, ph * 0.4, pd * 0.2, pw * 0.2, ph * 0.44, pd * 0.4, 0.022);

  if (hooks && hooks.pelvis) hooks.pelvis(b, M, def, { pw, ph, pd });
}

/**
 * Generic torso + the chassis-specific torso branch (old `if (key === ...)`).
 */
export function buildTorso(b, M, def, hooks) {
  const cw = M.chestW;
  const ch = M.chestH;
  const cd = M.chestD;
  const cy = M.chestY;

  // inner frame + layered front armour
  b.box('dark', cw * 0.8, ch * 0.86, cd * 0.82, 0, cy, 0);
  b.box('armor', cw, ch * 0.42, cd, 0, cy + ch * 0.26, 0);
  b.box('armor', cw * 0.96, ch * 0.3, cd * 1.1, 0, cy + ch * 0.02, -cd * 0.02, -0.1, 0, 0);
  b.box('armor', cw * 0.9, ch * 0.24, cd * 1.02, 0, cy - ch * 0.24, -cd * 0.01, 0.08, 0, 0);
  b.box('trim', cw * 0.34, ch * 0.2, cd * 0.18, 0, cy + ch * 0.02, -cd * 0.56);
  b.cyl('dark', cw * 0.22, ch * 0.12, 0, cy + ch * 0.5, 0);
  b.cyl('trim', cw * 0.16, ch * 0.05, 0, cy + ch * 0.56, 0);
  b.cyl('dark', cw * 0.1, ch * 0.2, 0, M.neckY - ch * 0.1, 0);

  for (const side of [-1, 1]) {
    b.sphere('dark', M.armW * 1.05, side * M.shoulderX, M.shoulderY, 0);
    b.box('armor', cw * 0.3, ch * 0.16, cd * 0.86, side * (M.shoulderX + cw * 0.04), M.shoulderY + ch * 0.12, 0, 0, 0, side * 0.2);
    b.box('armor', cw * 0.22, ch * 0.1, cd * 0.7, side * (M.shoulderX + cw * 0.14), M.shoulderY + ch * 0.05, 0, 0, 0, side * 0.38);
    b.box('trim', cw * 0.05, ch * 0.06, cd * 0.6, side * (M.shoulderX + cw * 0.2), M.shoulderY + ch * 0.12, 0, 0, 0, side * 0.3);
  }
  for (let i = -1; i <= 1; i++) {
    b.box('dark', cw * 0.08, ch * 0.14, 0.03, i * cw * 0.16, cy - ch * 0.02, -cd * 0.53);
  }
  // reactor / core glow + team stripe
  b.cyl('core', cw * 0.08, 0.035, 0, cy + ch * 0.12, -cd * 0.54, Math.PI / 2, 0, 0);
  b.sphere('core', cw * 0.045, 0, cy + ch * 0.12, -cd * 0.57);
  b.box('core', cw * 0.72, 0.022, 0.02, 0, cy + ch * 0.42, -cd * 0.52);
  // backpack + radiators
  b.box('dark', cw * 0.56, ch * 0.52, cd * 0.3, 0, cy, cd * 0.55);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      b.box('dark', 0.03, ch * 0.2, cd * 0.24, side * (cw * 0.5 + 0.045), cy - ch * 0.12 + i * ch * 0.16, cd * 0.36);
    }
  }

  if (hooks && hooks.torso) hooks.torso(b, M, def, { cw, ch, cd, cy });
}

/**
 * Generic head + the chassis-specific head branch.
 */
export function buildHead(b, M, def, hooks) {
  const w = M.headW;
  const h = M.headH;
  const d = M.headD;
  const y = M.headY;
  b.box('dark', w * 0.84, h * 0.8, d * 0.88, 0, y, 0.01);
  b.box('armor', w, h * 0.62, d, 0, y + h * 0.18, 0);
  b.box('armor', w * 0.88, h * 0.28, d * 1.08, 0, y + h * 0.46, -d * 0.02, 0.08, 0, 0);
  b.box('armor', w * 0.82, h * 0.32, d * 0.92, 0, y - h * 0.42, 0.01, -0.06, 0, 0);
  // visor recess + emissive slit.  The recess is a solid dark box whose front
  // face sits at -0.52d-0.03, so the slit has to be placed PROUD of that face
  // (5 mm) or it is buried inside the recess and the heads read as a black band
  // from every angle (verified on the model stage, flat-body pass).
  b.box('dark', w * 0.92, h * 0.3, 0.06, 0, y + h * 0.02, -d * 0.52);
  b.box('visor', w * 0.74, h * 0.12, 0.032, 0, y + h * 0.02, -d * 0.52 - 0.019);
  for (const side of [-1, 1]) {
    b.box('dark', w * 0.12, h * 0.18, d * 0.4, side * (w * 0.53), y, -d * 0.05);
  }
  b.box('trim', w * 0.6, h * 0.08, d * 0.7, 0, y + h * 0.56, 0.02);

  if (hooks && hooks.head) hooks.head(b, M, def, { w, h, d, y });
}

/**
 * Generic arm + the chassis-specific arm branch.
 */
export function buildArm(b, M, def, side, hooks) {
  const bend = side > 0 ? M.armBendR : M.armBendL;
  const dirY = Math.cos(bend);
  const dirZ = Math.sin(bend);
  const elbowY = -M.armUpper;
  const handY = elbowY - dirY * M.armFore;
  const handZ = -dirZ * M.armFore;
  const aw = M.armW;

  b.sphere('armor', aw * 1.18, 0, 0, 0);
  b.octa('dark', aw * 0.82, 0, -0.02, 0);
  b.cyl('dark', aw * 0.56, aw * 0.5, 0, -aw * 0.1, 0);
  b.boxDir('armor', aw * 1.15, aw * 1.25, M.armUpper * 1.02, 0, elbowY * 0.5, 0, 0, -1, 0);
  b.box('dark', aw * 0.92, M.armUpper * 0.52, aw * 0.96, 0, elbowY * 0.52, 0);
  b.octa('trim', aw * 0.76, 0, elbowY, 0);
  b.sphere('dark', aw * 0.5, 0, elbowY, 0);
  const midY = (elbowY + handY) * 0.5;
  const midZ = (handZ + 0) * 0.5;
  b.boxDir('armor', aw * 1.05, aw * 1.2, M.armFore * 1.05, 0, midY, midZ, 0, -dirY, -dirZ);
  b.boxDir('dark', aw * 0.62, aw * 0.72, M.armFore * 0.72, 0, midY + aw * 0.1, midZ - aw * 0.1, 0, -dirY, -dirZ);
  // arm "piston" trim rod: it used to sit at a fixed +x*0.86aw, floating
  // 1.2 cm (scout) to 5.5 cm (warlord) outside the arm and sitting inboard on
  // the left arm.  Clamp it to the outer face of the upper arm (0.6aw, mirrored
  // per side) and scale its radius with the chassis so it stays on the arm.
  b.beam('trim', side * aw * 0.6, elbowY * 0.4, aw * 0.2, side * aw * 0.6, midY, midZ + aw * 0.42, 0.016 * (aw / 0.1));
  b.box('dark', aw * 1.2, aw * 1.05, aw * 1.3, 0, handY - aw * 0.3, handZ);
  b.boxDir('armor', 0.05, aw * 0.9, M.armFore * 0.82, side * (aw * 0.62), midY, midZ, 0, -dirY, -dirZ);

  if (hooks && hooks.arm) hooks.arm(b, M, def, side, { bend, dirY, dirZ, elbowY, handY, handZ, midY, midZ, aw });
}

/**
 * Generic leg + the chassis-specific leg branch.
 */
export function buildLeg(b, M, def, side, hooks) {
  const w = M.legW;
  const a1 = 0.1;
  const a2 = -0.17;
  const kneeY = -Math.cos(a1) * M.legThigh;
  const kneeZ = -Math.sin(a1) * M.legThigh;
  const ankleY = kneeY - Math.cos(a2) * M.legShin;
  const ankleZ = kneeZ - Math.sin(a2) * M.legShin;
  const thighDirY = Math.cos(a1);
  const thighDirZ = Math.sin(a1);
  const shinDirY = Math.cos(a2);
  const shinDirZ = Math.sin(a2);

  b.sphere('dark', w * 0.62, 0, 0, 0);
  b.octa('trim', w * 0.46, 0, 0, 0);
  b.boxDir('armor', w * 1.12, w * 1.3, M.legThigh, 0, kneeY * 0.5, kneeZ * 0.5, 0, -thighDirY, -thighDirZ);
  b.boxDir('dark', w * 0.64, w * 0.8, M.legThigh * 0.55, 0, kneeY * 0.55, kneeZ * 0.55, 0, -thighDirY, -thighDirZ);
  b.box('armor', w * 1.24, w * 0.4, w * 0.5, 0, kneeY + w * 0.05, kneeZ - w * 0.3, 0.2, 0, 0);
  b.sphere('dark', w * 0.5, 0, kneeY, kneeZ);
  b.boxDir('armor', w * 0.96, w * 1.12, M.legShin * 1.02, 0, (kneeY + ankleY) * 0.5, (kneeZ + ankleZ) * 0.5, 0, -shinDirY, -shinDirZ);
  b.boxDir('dark', w * 0.54, w * 0.66, M.legShin * 0.62, 0, (kneeY + ankleY) * 0.55, (kneeZ + ankleZ) * 0.55, 0, -shinDirY, -shinDirZ);
  b.beam('trim', w * 0.5, kneeY * 0.55, kneeZ * 0.55 + w * 0.32, w * 0.5, (kneeY + ankleY) * 0.5, (kneeZ + ankleZ) * 0.5 + w * 0.3, 0.014);
  b.sphere('dark', w * 0.44, 0, ankleY, ankleZ);
  // foot + toe
  const footY = Math.min(ankleY - M.footH * 0.5, -M.hipY + M.footH * 0.5);
  b.box('armor', M.footW, M.footH, M.footL, 0, footY, ankleZ - M.footL * 0.32);
  b.box('dark', M.footW * 0.9, M.footH * 0.42, M.footL * 1.02, 0, footY - M.footH * 0.32, ankleZ - M.footL * 0.32);
  b.box('trim', M.footW * 0.72, M.footH * 0.34, M.footL * 0.24, 0, footY + M.footH * 0.1, ankleZ - M.footL * 0.74, 0.1, 0, 0);
  b.box('dark', M.footW * 1.04, M.footH * 0.24, M.footL * 0.3, 0, footY - M.footH * 0.12, ankleZ + M.footL * 0.18);
  b.box('accent', w * 0.3, w * 0.3, 0.02, 0, kneeY * 0.82, kneeZ + w * 0.36);

  if (hooks && hooks.leg) hooks.leg(b, M, def, side, { w, a1, a2, kneeY, kneeZ, ankleY, ankleZ, thighDirY, thighDirZ, shinDirY, shinDirZ, footY });
}

/**
 * Extra barrels / heavier silhouette for the big chassis (heavy + warlord).
 * Kept here because two chassis share the exact same branch.
 */
export function addHeavyGunExtras(b, { s, bodyW, bodyH, bodyL, barrelLen, bodyCenterZ, barrelCenterZ, tipZ }) {
  const sx = 0.075 * s;
  for (const side of [-1, 1]) {
    b.cyl('dark', 0.028 * s, barrelLen * 0.86, side * sx, 0.05 * s, barrelCenterZ + 0.04, Math.PI / 2, 0, 0);
    b.cyl('trim', 0.04 * s, 0.05 * s, side * sx, 0.05 * s, tipZ + 0.02, Math.PI / 2, 0, 0);
  }
  b.box('armor', bodyW * 1.5, bodyH * 1.2, bodyL * 0.55, 0, 0.045 * s, bodyCenterZ + 0.08);
  b.cyl('dark', 0.09 * s, 0.14 * s, 0, 0.02 * s, bodyCenterZ + 0.16 * s, 0, 0, Math.PI / 2);
}

/**
 * Left forearm armoured cannon / ram shield (heavy + warlord share this branch).
 */
export function addLeftArmCannon(b, M, { aw, dirY, dirZ, handY, handZ, midY, midZ }) {
  // left forearm is an armoured cannon / ram shield
  b.boxDir('armor', aw * 1.5, aw * 1.4, M.armFore * 1.1, 0, midY, midZ, 0, -dirY, -dirZ);
  b.boxDir('dark', aw * 0.9, aw * 0.9, M.armFore * 0.9, 0, midY - aw * 0.1, midZ - aw * 0.5, 0, -dirY, -dirZ);
  b.cyl('accent', aw * 0.14, 0.03, 0, handY - aw * 0.05, handZ - aw * 0.5, Math.PI / 2, 0, 0);
}

/**
 * Generic gun + the chassis-specific gun branch.  A hook may return a
 * `{ tipY, tipZ }` override for the muzzle offset (the boss rotary gun does).
 */
export function buildGun(b, M, def, hooks) {
  const s = def.gun.scale;
  const bodyW = 0.13 * s;
  const bodyH = 0.16 * s;
  const bodyL = 0.52 * s;
  const barrelLen = 0.46 * s;
  const bodyCenterZ = -bodyL * 0.42;
  const barrelCenterZ = -(bodyL * 0.86 + barrelLen * 0.5);
  const tipZ = -(bodyL * 0.86 + barrelLen + 0.03);

  b.box('gun', bodyW, bodyH, bodyL, 0, 0.045 * s, bodyCenterZ);
  b.cyl('gun', 0.036 * s, barrelLen, 0, 0.05 * s, barrelCenterZ, Math.PI / 2, 0, 0);
  b.cyl('dark', 0.062 * s, 0.09 * s, 0, 0.05 * s, tipZ + 0.02, Math.PI / 2, 0, 0);
  b.box('dark', bodyW * 0.66, bodyH * 0.6, bodyL * 0.5, 0, 0.05 * s, -(bodyL * 0.86 + 0.1 * s));
  b.box('dark', 0.085 * s, 0.24 * s, 0.15 * s, 0, -0.19 * s, bodyCenterZ + 0.06 * s, 0.24, 0, 0);
  b.box('gun', bodyW * 0.9, bodyH * 0.82, 0.22 * s, 0, 0.04 * s, 0.1 * s);
  b.box('dark', 0.05 * s, 0.05 * s, 0.26 * s, 0, 0.045 * s + bodyH * 0.5 + 0.03 * s, bodyCenterZ - 0.08 * s);
  b.box('accent', 0.022 * s, 0.022 * s, 0.06 * s, 0, 0.045 * s + bodyH * 0.5 + 0.06 * s, bodyCenterZ - 0.17 * s);
  b.box('accent', bodyW * 1.04, 0.02 * s, 0.17 * s, 0, 0.045 * s, bodyCenterZ - 0.03 * s);
  b.box('dark', 0.07 * s, 0.18 * s, 0.08 * s, 0, -0.12 * s, 0.03 * s, 0.22, 0, 0);
  b.beam('trim', 0.02 * s, 0.02 * s, 0.24 * s, 0.02 * s, -0.01 * s, 0.16 * s, 0.012 * s);

  const metrics = { s, bodyW, bodyH, bodyL, barrelLen, bodyCenterZ, barrelCenterZ, tipZ };
  const tip = hooks && hooks.gun ? hooks.gun(b, M, def, metrics) : undefined;
  return tip || { tipY: 0.05 * s, tipZ };
}

/**
 * Build a full animated robot rig (shared by all spawns of a type via the pool).
 * Eight pivoting groups: pelvis, torso, head, both arms (right carries the gun), both legs.
 */
export function buildRobotRig(def, rigMats, geos, hitGeo, hitMat, hooks) {
  const M = def.model;
  const mats = rigMats.mats;
  const tints = paletteTints(def.palette);
  const mergedGeos = [];
  const collect = (meshes) => {
    for (let i = 0; i < meshes.length; i++) mergedGeos.push(meshes[i].geometry);
  };

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  root.name = 'robot_' + def.key;

  const pelvis = new THREE.Group();
  pelvis.position.y = M.hipY;
  root.add(pelvis);
  let b = new RigBuilder(geos, tints);
  buildPelvis(b, M, def, hooks);
  collect(b.finish(pelvis, mats, true));

  const torso = new THREE.Group();
  torso.position.y = M.torsoPivotY;
  pelvis.add(torso);
  b = new RigBuilder(geos, tints);
  buildTorso(b, M, def, hooks);
  collect(b.finish(torso, mats, true));

  const head = new THREE.Group();
  head.position.y = M.neckY;
  torso.add(head);
  b = new RigBuilder(geos, tints);
  buildHead(b, M, def, hooks);
  collect(b.finish(head, mats, true));

  const armL = new THREE.Group();
  armL.position.set(-M.shoulderX, M.shoulderY, 0);
  torso.add(armL);
  b = new RigBuilder(geos, tints);
  buildArm(b, M, def, -1, hooks);
  collect(b.finish(armL, mats, true));

  const armR = new THREE.Group();
  armR.position.set(M.shoulderX, M.shoulderY, 0);
  torso.add(armR);
  b = new RigBuilder(geos, tints);
  buildArm(b, M, def, 1, hooks);
  collect(b.finish(armR, mats, true));

  const gunGroup = new THREE.Group();
  const handY = -(M.armUpper + Math.cos(M.armBendR) * M.armFore);
  const handZ = -Math.sin(M.armBendR) * M.armFore;
  gunGroup.position.set(0, handY, handZ);
  armR.add(gunGroup);
  b = new RigBuilder(geos, tints);
  const gunInfo = buildGun(b, M, def, hooks);
  collect(b.finish(gunGroup, mats, true));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, gunInfo.tipY, gunInfo.tipZ);
  gunGroup.add(muzzle);

  const legL = new THREE.Group();
  legL.position.set(-M.hipX, M.hipY, 0);
  root.add(legL);
  b = new RigBuilder(geos, tints);
  buildLeg(b, M, def, -1, hooks);
  collect(b.finish(legL, mats, true));

  const legR = new THREE.Group();
  legR.position.set(M.hipX, M.hipY, 0);
  root.add(legR);
  b = new RigBuilder(geos, tints);
  buildLeg(b, M, def, 1, hooks);
  collect(b.finish(legR, mats, true));

  /* ---- hitboxes (invisible, zero draw cost, ride the animated pivots) ---- */
  const hitboxes = [];
  const addHit = (zone, parent, w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(hitGeo, hitMat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.visible = false;
    mesh.userData.zone = zone;
    parent.add(mesh);
    hitboxes.push(mesh);
    return mesh;
  };
  addHit('head', head, M.headW * 1.1, M.headH * 1.25, M.headD * 1.12, 0, M.headY, 0);
  addHit('torso', torso, M.chestW * 1.02, M.chestH * 0.9, M.chestD * 1.14, 0, M.chestY, 0);
  addHit('limb', pelvis, M.pelvisW * 1.12, M.pelvisH * 1.7, M.pelvisD * 1.16, 0, 0, 0);

  // Arms: the original single vertical slab stopped at the elbow, so the bent
  // forearm, hand and grips hung outside it and side shots at the extended arm
  // missed (D8).  Keep the slab for the upper arm, add an axis-aligned volume
  // around the elbow→hand segment (one arm width of padding, still 'limb').
  const addArmHit = (parent, bend) => {
    const elbowY = -M.armUpper;
    const handY = elbowY - Math.cos(bend) * M.armFore;
    const handZ = -Math.sin(bend) * M.armFore;
    const armLen = M.armUpper + M.armFore * 0.9;
    const armHitY = -(M.armUpper * 0.5 + M.armFore * 0.4);
    addHit('limb', parent, M.armW * 1.6, armLen, M.armW * 1.6, 0, armHitY, -M.armFore * 0.2);
    addHit('limb', parent, M.armW * 1.6,
      Math.abs(handY - elbowY) + M.armW * 2.0,
      Math.abs(handZ) + M.armW * 1.4,
      0, (elbowY + handY) * 0.5, handZ * 0.5);
  };
  addArmHit(armL, M.armBendL);
  addArmHit(armR, M.armBendR);

  // Legs: the slab only spans hip→ankle, leaving the 14-22 cm boots outside it
  // (D7).  One foot volume per leg rides the leg pivot and stays 'limb'.
  const legLen = M.legThigh + M.legShin;
  const footHitY = -M.hipY + M.footH * 0.5;
  const footHitZ = -M.footL * 0.2;
  addHit('limb', legL, M.legW * 1.55, legLen, M.legW * 1.7, 0, -legLen * 0.5, 0);
  addHit('limb', legR, M.legW * 1.55, legLen, M.legW * 1.7, 0, -legLen * 0.5, 0);
  addHit('limb', legL, M.footW * 1.2, M.footH * 1.6, M.footL * 1.15, 0, footHitY, footHitZ);
  addHit('limb', legR, M.footW * 1.2, M.footH * 1.6, M.footL * 1.15, 0, footHitY, footHitZ);

  // Shoulder-mounted hardpoints sit outside the torso slab, so shots at them
  // used to pass straight through (D4).  Give each pod/tower its own torso-zone
  // volume; sizes are measured from the buildTorso() geometry with a small
  // margin and overlap the torso slab so there is no seam.

  if (hooks && hooks.hitboxes) hooks.hitboxes(addHit, torso, M, def);

  return {
    def,
    root,
    parts: { pelvis, torso, head, armL, armR, gunGroup, legL, legR },
    hitboxes,
    muzzle,
    mats: rigMats,
    mergedGeos,
    baseGunX: gunGroup.position.x,
    baseGunY: gunGroup.position.y,
    baseGunZ: gunGroup.position.z,
    baseHipY: M.hipY,
  };
}
