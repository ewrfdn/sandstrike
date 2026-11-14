/**
 * VXR-7 first-person weapon model — pure model module, split into:
 *
 *   createVxr7Materials()   procedural steel/polymer/label/flash textures + mats
 *   buildVxr7Weapon()       bare weapon (receiver, optic, mag, flash rig) — no hands
 *   buildVxr7Hands()        gloved hands + forearms — no weapon
 *   buildVxr7Viewmodel()    compatibility layer: held rig = gunRoot > gun(.62) >
 *                           { weaponRoot, handsRoot } (both bound by default)
 *
 * The weapon and the hands only meet in the held frame (`gun`); the weapon can
 * therefore exist on its own (stage preview / future world pickups), and the
 * hands are bound to the same frame only while the weapon is equipped.
 *
 * Everything behavioural (input, ADS/hip transform, sway, firing, reload
 * timing, recoil, audio, raycasts) stays in `WeaponSystem` (src/weapons.js),
 * which keeps consuming the flat legacy handle object returned by
 * `buildVxr7Viewmodel({ scene, muzzleLight })`.
 *
 * Returned flat keys (unchanged, so `Object.assign(this, ...)` keeps working):
 *   gunRoot, gun, bolt, charging, magazine, spareMagazine, trigger, reticle,
 *   sightLocal, flashGroup, flashMats, muzzleLocal, muzzleLight, smokePuffs,
 *   matSteel, matSteelDark, matBlack, matPolymer, matRubber, matAccent,
 *   matBrass, matGlass, matGlove, matGlovePalm, matGloveDark, matSleeve
 * plus the split handles { weaponRoot, handsRoot }.
 *
 * The viewmodel has no collision/raycast data and is never added to the world
 * scene: it is rendered by WeaponSystem.render() with the view camera only.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rand } from '../../utils.js';
import { buildGlovedHands } from './hands.js';

/** Model-viewer / weapon-registry metadata (one entry in the unified catalog). */
export const meta = {
  id: 'weapon-vxr7',
  weaponId: 'vxr7',
  kind: 'weapon',
  group: 'weapon',
  label: 'VXR-7 · 5.56 突击步枪',
  poses: ['bare', 'held'],
  defaultPose: 'bare',
  lift: true,
};

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

// ---------------------------------------------------------------------------
// Procedural textures (canvas based, generated once per material set)
// ---------------------------------------------------------------------------

function makeSteelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#59626a';
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
  for (let i = 0; i < 6; i++) {
    const g = ctx.createRadialGradient(rand(0, 512), rand(0, 512), 0, rand(0, 512), rand(0, 512), rand(20, 80));
    g.addColorStop(0, 'rgba(14,16,17,.07)');
    g.addColorStop(1, 'rgba(14,16,17,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  }
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(225,230,232,${rand(0.03, 0.15)})`;
    ctx.fillRect(rand(0, 512), rand(0, 512), rand(1, 5), rand(0.6, 2));
  }
  return canvas;
}

function makePolymerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3d4348';
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
// Materials
// ---------------------------------------------------------------------------

/**
 * All materials (and their procedural canvas textures) needed by the weapon
 * and the gloved hands.  Build once and share between the weapon and hand
 * builders; the returned set owns its textures.
 */
export function createVxr7Materials() {
  const steelCanvas = makeSteelTexture();
  const steelMap = new THREE.CanvasTexture(steelCanvas);
  steelMap.colorSpace = THREE.SRGBColorSpace;
  steelMap.wrapS = steelMap.wrapT = THREE.RepeatWrapping;
  steelMap.repeat.set(6, 3);
  steelMap.anisotropy = 8;

  const polymerCanvas = makePolymerTexture();
  const polymerMap = new THREE.CanvasTexture(polymerCanvas);
  polymerMap.colorSpace = THREE.SRGBColorSpace;
  polymerMap.wrapS = polymerMap.wrapT = THREE.RepeatWrapping;
  polymerMap.repeat.set(4, 4);
  polymerMap.anisotropy = 8;

  const matSteel = new THREE.MeshStandardMaterial({
    color: 0x9aa3aa, map: steelMap, metalness: 0.34, roughness: 0.52, envMapIntensity: 0.5,
  });
  const matSteelDark = new THREE.MeshStandardMaterial({
    color: 0x7e878e, map: steelMap, metalness: 0.38, roughness: 0.55, envMapIntensity: 0.45,
  });
  const matBlack = new THREE.MeshStandardMaterial({
    color: 0x40464a, map: polymerMap, metalness: 0.28, roughness: 0.62, envMapIntensity: 0.4,
  });
  const matPolymer = new THREE.MeshStandardMaterial({
    color: 0x5b6165, map: polymerMap, metalness: 0.1, roughness: 0.78, envMapIntensity: 0.35,
  });
  const matRubber = new THREE.MeshStandardMaterial({ color: 0x1d1f21, metalness: 0.06, roughness: 0.94 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0xd2741f, metalness: 0.5, roughness: 0.42 });
  const matBrass = new THREE.MeshStandardMaterial({ color: 0xd8a14c, metalness: 1.0, roughness: 0.25 });
  const matGlass = new THREE.MeshPhysicalMaterial({
    color: 0xcfe8f2, metalness: 0, roughness: 0.16, transparent: true, opacity: 0.07,
    depthWrite: false, side: THREE.DoubleSide, clearcoat: 0.35, envMapIntensity: 0.9,
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

  matSteel.name = 'steel';
  matSteelDark.name = 'steelDark';
  matBlack.name = 'black';
  matPolymer.name = 'polymer';
  matRubber.name = 'rubber';
  matAccent.name = 'accent';
  matBrass.name = 'brass';
  matGlass.name = 'glass';

  return {
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
  };
}

// ---------------------------------------------------------------------------
// Gloved hands (mount + sleeve runs of the VXR-7 held pose)
// ---------------------------------------------------------------------------

/**
 * Mounts and sleeve runs in VXR-7 held-frame coordinates.  These values are the
 * legacy `buildHands()` values and are part of the viewmodel's visual identity:
 * do not tweak them.
 */
const VXR7_HANDS = {
  right: {
    position: [0.030, -0.098, 0.138],
    rotation: [0.12, 0.34, 0.06],
    sleeve: {
      points: [
        [0.038, -0.132, 0.152],
        [0.075, -0.225, 0.300],
        [0.135, -0.345, 0.500],
        [0.185, -0.460, 0.720],
      ],
      rWrist: 0.042,
      rElbow: 0.055,
    },
  },
  left: {
    position: [-0.046, 0.004, -0.330],
    rotation: [0.02, 0.04, 0.12],
    sleeve: {
      points: [
        [-0.066, -0.026, -0.300],
        [-0.140, -0.160, -0.175],
        [-0.230, -0.330, 0.020],
        [-0.300, -0.520, 0.230],
      ],
      rWrist: 0.042,
      rElbow: 0.055,
    },
  },
};

/**
 * Both gloved hands + forearm sleeves of the VXR-7 held pose, no weapon.
 * Returned root is meant to be parented under the held frame (`gun`).
 *
 * @param {{ mats?: object }} [opts]
 * @returns {{ root: THREE.Group, rightHand: THREE.Group, leftHand: THREE.Group }}
 */
export function buildVxr7Hands({ mats = createVxr7Materials() } = {}) {
  return buildGlovedHands({
    mats: {
      glove: mats.matGlove,
      glovePalm: mats.matGlovePalm,
      gloveDark: mats.matGloveDark,
      sleeve: mats.matSleeve,
      accent: mats.matAccent,
    },
    right: VXR7_HANDS.right,
    left: VXR7_HANDS.left,
  });
}

// ---------------------------------------------------------------------------
// Bare weapon (no hands)
// ---------------------------------------------------------------------------

/**
 * The complete VXR-7 weapon model without hands: receiver, rail, handguard,
 * barrel, optic, charging handle, magazines, pistol grip/trigger, side plates
 * and the muzzle-flash rig.  Root children use held-frame coordinates (not
 * multiplied by the 0.62 held scale) so callers can put `root` straight into a
 * held frame or into a world pickup wrapper.
 *
 * @param {{ mats?: object, muzzleLight?: THREE.PointLight|null }} [opts]
 * @returns {{ root: THREE.Group, mats: object, bolt: THREE.Mesh,
 *            charging: THREE.Group, magazine: THREE.Group,
 *            spareMagazine: THREE.Group, trigger: THREE.Mesh,
 *            reticle: THREE.Mesh, sightLocal: THREE.Vector3,
 *            flashGroup: THREE.Group, flashMats: THREE.Material[],
 *            muzzleLocal: THREE.Vector3, muzzleLight: THREE.PointLight|null }}
 */
export function buildVxr7Weapon({ mats = createVxr7Materials(), muzzleLight = null } = {}) {
  const {
    matSteel, matSteelDark, matBlack, matPolymer, matRubber, matAccent, matBrass, matGlass,
  } = mats;

  const root = new THREE.Group();
  root.name = 'weaponRoot';

  // ---- local primitive helpers (weapon space: muzzle -Z, up +Y, right +X) ----
  const RB = (w, h, d, mat, r = 0.008, seg = 2) => new THREE.Mesh(
    new RoundedBoxGeometry(w, h, d, seg, Math.max(0.0015, Math.min(r, Math.min(w, h, d) * 0.45))), mat
  );
  /** Cylinder along Z. `rFront` is the radius toward the muzzle (-Z). */
  const CZ = (rFront, rRear, len, mat, seg = 16) => {
    const geo = new THREE.CylinderGeometry(rRear, rFront, len, seg, 1, false);
    geo.rotateX(Math.PI / 2);
    return new THREE.Mesh(geo, mat);
  };
  /** Extruded side silhouette: `pts` are [z, y] weapon-space points, extruded across X. */
  const PROF = (pts, width, mat, bevel = 0.006) => {
    const bevelSize = Math.max(0.0015, Math.min(bevel, width * 0.3));
    const shape = new THREE.Shape();
    pts.forEach(([z, y], i) => {
      if (i === 0) shape.moveTo(-z, y);
      else shape.lineTo(-z, y);
    });
    shape.closePath();
    const depth = Math.max(0.004, width - 2 * bevelSize);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: bevelSize, bevelSize, bevelSegments: 1, curveSegments: 1,
    });
    geo.translate(0, 0, -depth / 2);
    geo.rotateY(Math.PI / 2);
    return new THREE.Mesh(geo, mat);
  };
  /** Faceted octagonal section swept along Z (handguard / end caps). */
  const OCT = (r, len, sx, sy, mat) => {
    const geo = new THREE.CylinderGeometry(r, r, len, 8, 1, false);
    geo.scale(sx, sy, 1);
    geo.rotateY(Math.PI / 8);
    geo.rotateX(Math.PI / 2);
    const flat = geo.toNonIndexed();
    flat.computeVertexNormals();
    geo.dispose();
    return new THREE.Mesh(flat, mat);
  };
  /** Extruded side profile with a through-hole (solid trigger-guard loop). */
  const PROF_HOLE = (pts, holePts, width, mat, bevel = 0.004) => {
    const bevelSize = Math.max(0.0015, Math.min(bevel, width * 0.3));
    const toShape = (list) => {
      const shape = new THREE.Shape();
      list.forEach(([z, y], i) => (i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
      shape.closePath();
      return shape;
    };
    const shape = toShape(pts);
    shape.holes.push(toShape(holePts));
    const depth = Math.max(0.004, width - 2 * bevelSize);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: bevelSize, bevelSize, bevelSegments: 1, curveSegments: 1,
    });
    geo.translate(0, 0, -depth / 2);
    geo.rotateY(Math.PI / 2);
    return new THREE.Mesh(geo, mat);
  };
  const RING = (R, r, mat, radial = 8, tubular = 18) => new THREE.Mesh(new THREE.TorusGeometry(R, r, radial, tubular), mat);
  const TUBE = (pts, r, mat, tubular = 18, radial = 6) => new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), tubular, r, radial, false), mat
  );
  const HEXBOLT = (r = 0.0032, h = 0.0024, mat = matSteelDark) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 6, 1, false), mat);

  // ========================== UPPER RECEIVER =================================
  add(root, PROF([
    [0.105, 0.03], [0.105, 0.1], [0.02, 0.105], [-0.1, 0.105], [-0.145, 0.098],
    [-0.145, 0.046], [-0.108, 0.032], [-0.02, 0.03], [0.05, 0.03],
  ], 0.096, matSteel, 0.008), 0, 0, 0);
  add(root, RB(0.05, 0.01, 0.26, matSteelDark, 0.003, 2), 0, 0.108, -0.02);
  // continuous picatinny rail: solid base + ribs, flush on receiver and handguard bridge
  add(root, RB(0.05, 0.014, 0.6, matSteelDark, 0.004, 2), 0, 0.118, -0.2);
  for (let i = 0; i < 18; i++) {
    add(root, RB(0.046, 0.012, 0.024, matSteel, 0.002, 1), 0, 0.1315, 0.09 - i * 0.034);
  }
  // ejection port (right): dark opening, frame, open dust cover, deflector
  add(root, RB(0.006, 0.036, 0.08, matBlack, 0.001, 1), 0.0475, 0.068, -0.045);
  add(root, RB(0.008, 0.007, 0.088, matSteelDark, 0.001, 1), 0.0485, 0.088, -0.045);
  add(root, RB(0.008, 0.007, 0.088, matSteelDark, 0.001, 1), 0.0485, 0.047, -0.045);
  add(root, CZ(0.0035, 0.0035, 0.082, matSteelDark, 8), 0.049, 0.043, -0.045);
  add(root, RB(0.004, 0.034, 0.078, matSteelDark, 0.0015, 1), 0.057, 0.028, -0.045, 0, 0, -0.95);
  add(root, RB(0.015, 0.018, 0.03, matSteel, 0.004, 2), 0.048, 0.083, 0.004, 0, 0, -0.3);
  // forward assist, bolt catch, mag release
  add(root, CZ(0.0085, 0.0085, 0.024, matSteelDark, 12), 0.046, 0.086, 0.086);
  add(root, RING(0.009, 0.0022, matSteel, 6, 12), 0.046, 0.086, 0.071);
  add(root, RB(0.01, 0.016, 0.034, matSteelDark, 0.002, 1), -0.047, -0.012, 0.03);
  add(root, RB(0.01, 0.014, 0.016, matSteelDark, 0.002, 1), 0.047, -0.03, 0.05);
  // buffer tube + compact stock (real silhouette; kept clear of the view camera)
  add(root, CZ(0.021, 0.023, 0.1, matSteelDark, 16), 0, 0.05, 0.14);
  add(root, RB(0.05, 0.062, 0.014, matSteelDark, 0.004, 2), 0, 0.05, 0.107); // receiver end plate
  add(root, RING(0.022, 0.004, matSteelDark, 6, 18), 0, 0.05, 0.098);
  add(root, PROF([
    [0.15, 0.07], [0.212, 0.066], [0.222, 0.02], [0.222, -0.012], [0.19, -0.016], [0.158, 0.002], [0.146, 0.04],
  ], 0.046, matPolymer, 0.004), 0, 0, 0);
  add(root, RB(0.04, 0.007, 0.06, matBlack, 0.002, 1), 0, 0.0665, 0.185);
  add(root, RB(0.046, 0.05, 0.01, matRubber, 0.004, 2), 0, 0.03, 0.226);
  add(root, RING(0.009, 0.0022, matSteelDark, 6, 12), 0, 0.004, 0.2);
  // flip-up rear sight on the rail
  add(root, RB(0.03, 0.01, 0.024, matSteelDark, 0.002, 1), 0, 0.139, 0.062);
  add(root, RB(0.006, 0.026, 0.008, matSteelDark, 0.001, 1), -0.011, 0.155, 0.062);
  add(root, RB(0.006, 0.026, 0.008, matSteelDark, 0.001, 1), 0.011, 0.155, 0.062);
  add(root, RING(0.0065, 0.0018, matSteel, 6, 14), 0, 0.158, 0.062);
  // receiver side detail: panel lines, bolts + seam
  for (const sx of [-1, 1]) {
    add(root, RB(0.0022, 0.006, 0.2, matBlack, 0.001, 1), sx * 0.0492, 0.056, -0.03);
    add(root, RB(0.0022, 0.004, 0.16, matBlack, 0.001, 1), sx * 0.0492, 0.036, -0.035);
    add(root, RB(0.0022, 0.04, 0.006, matBlack, 0.001, 1), sx * 0.0492, 0.062, 0.075);
  }
  for (let i = 0; i < 3; i++) {
    add(root, HEXBOLT(0.0032, 0.0024), 0.0492, 0.036, -0.085 + i * 0.028, 0, 0, Math.PI / 2);
  }
  add(root, RB(0.094, 0.004, 0.24, matSteelDark, 0.0015, 1), 0, 0.032, -0.02);

  // ============================== HANDGUARD ==================================
  add(root, OCT(0.045, 0.36, 0.94, 1.04, matPolymer), 0, 0.008, -0.34);
  // narrow raised bridge under the rail (monolithic upper look, no air gap)
  add(root, PROF([[-0.14, 0.113], [-0.525, 0.113], [-0.525, 0.046], [-0.14, 0.046]], 0.032, matSteelDark, 0.005), 0, 0, 0);
  // octagon edge ridges
  for (const sx of [-1, 1]) {
    add(root, RB(0.007, 0.007, 0.355, matPolymer, 0.0025, 1), sx * 0.0415, 0.028, -0.34);
    add(root, RB(0.007, 0.007, 0.355, matPolymer, 0.0025, 1), sx * 0.0415, -0.02, -0.34);
  }
  add(root, RB(0.028, 0.006, 0.355, matPolymer, 0.0025, 1), 0, -0.0345, -0.34);
  // M-LOK slots on both flats + bottom vents
  for (let i = 0; i < 5; i++) {
    const z = -0.2 - i * 0.058;
    add(root, RB(0.005, 0.016, 0.04, matBlack, 0.001, 1), 0.0424, 0.006, z);
    add(root, RB(0.005, 0.016, 0.04, matBlack, 0.001, 1), -0.0424, 0.006, z);
    add(root, RB(0.0022, 0.03, 0.004, matBlack, 0.001, 1), 0.0394, 0.004, z - 0.029);
    add(root, RB(0.0022, 0.03, 0.004, matBlack, 0.001, 1), -0.0394, 0.004, z - 0.029);
  }
  for (let i = 0; i < 3; i++) {
    add(root, RB(0.022, 0.005, 0.042, matBlack, 0.001, 1), 0, -0.0335, -0.22 - i * 0.07);
  }
  // accessory rails at 3 / 9 o'clock
  for (const sx of [-1, 1]) {
    add(root, RB(0.006, 0.018, 0.2, matSteelDark, 0.0015, 1), sx * 0.0435, 0.0, -0.31);
    for (let i = 0; i < 4; i++) {
      add(root, RB(0.012, 0.013, 0.024, matSteel, 0.002, 1), sx * 0.0475, 0.0, -0.245 - i * 0.048);
    }
  }
  // end cap, barrel nut, QD sockets
  add(root, OCT(0.05, 0.018, 0.94, 1.04, matSteelDark), 0, 0.008, -0.528);
  add(root, CZ(0.024, 0.024, 0.03, matSteel, 16), 0, 0.03, -0.53);
  add(root, RING(0.021, 0.003, matSteelDark, 6, 16), 0, 0.03, -0.546);
  add(root, RING(0.009, 0.0022, matSteelDark, 6, 12), 0.045, -0.016, -0.25);
  add(root, RING(0.008, 0.002, matSteelDark, 6, 12), 0, -0.0405, -0.52);

  // =========================== BARREL / MUZZLE ===============================
  add(root, CZ(0.0142, 0.016, 0.3, matSteel, 20), 0, 0.03, -0.68);
  add(root, CZ(0.0175, 0.0175, 0.03, matSteelDark, 18), 0, 0.03, -0.552);
  add(root, RB(0.038, 0.044, 0.046, matSteelDark, 0.006, 2), 0, 0.035, -0.6);
  add(root, CZ(0.012, 0.012, 0.036, matSteel, 12), 0, 0.058, -0.6);
  add(root, RB(0.03, 0.01, 0.03, matSteelDark, 0.002, 1), 0, 0.066, -0.6);
  add(root, RB(0.005, 0.024, 0.008, matSteelDark, 0.001, 1), -0.012, 0.083, -0.6);
  add(root, RB(0.005, 0.024, 0.008, matSteelDark, 0.001, 1), 0.012, 0.083, -0.6);
  add(root, RING(0.0085, 0.0018, matSteel, 6, 14), 0, 0.096, -0.6);
  add(root, RB(0.0028, 0.02, 0.003, matSteel, 0.001, 1), 0, 0.085, -0.603);
  // muzzle brake: round, ported, crowned
  add(root, CZ(0.019, 0.022, 0.095, matSteelDark, 20), 0, 0.03, -0.8775);
  for (let i = 0; i < 3; i++) {
    add(root, RB(0.012, 0.007, 0.012, matBlack, 0.001, 1), 0, 0.045, -0.855 - i * 0.022);
    add(root, RB(0.034, 0.005, 0.012, matBlack, 0.001, 1), 0, 0.03, -0.848 - i * 0.02);
  }
  add(root, CZ(0.024, 0.024, 0.014, matSteel, 20), 0, 0.03, -0.928);
  add(root, RING(0.012, 0.0035, matSteelDark, 6, 18), 0, 0.03, -0.934);

  // ========================== RAIL LIGHT MODULE ==============================
  const lightMod = new THREE.Group();
  lightMod.position.set(0.056, 0.01, -0.31);
  root.add(lightMod);
  add(lightMod, RB(0.022, 0.03, 0.055, matBlack, 0.006, 2), 0, 0, 0);
  add(lightMod, CZ(0.019, 0.019, 0.07, matSteelDark, 16), 0, 0, -0.06);
  add(lightMod, CZ(0.0165, 0.0165, 0.006, matSteel, 16), 0, 0, -0.096);
  add(lightMod, CZ(0.014, 0.014, 0.004, new THREE.MeshBasicMaterial({ color: 0x8fe8ff }), 16), 0, 0, -0.1);
  add(lightMod, RB(0.012, 0.02, 0.05, matSteelDark, 0.003, 2), -0.014, 0, 0.01);

  // ---- optic (enclosed holographic sight; the reticle anchors ADS) ----
  const optic = new THREE.Group();
  // sits directly on the top rail (rail top = 0.137) so it never floats
  optic.position.set(0, 0.142, -0.005);
  root.add(optic);
  // quick-detach mount straddling the picatinny rail + cross bolt
  add(optic, rounded(0.064, 0.03, 0.086, matSteelDark, 0.006, 2), 0, -0.004, 0.002);
  add(optic, cyl(0.009, 0.009, 0.074, matSteel, 10), 0, -0.012, 0.0, 0, 0, Math.PI / 2);
  add(optic, box(0.016, 0.02, 0.024, matBlack), 0.04, -0.008, 0.018);
  add(optic, rounded(0.052, 0.022, 0.09, matSteel, 0.005, 2), 0, 0.018, 0.0);
  // hollow housing: a bottom body + top hood + two side walls, so the sight
  // window is a real open tube you can look through (front and rear stay open)
  add(optic, rounded(0.056, 0.034, 0.1, matSteelDark, 0.008, 2), 0, 0.036, 0.002); // bottom body
  add(optic, rounded(0.056, 0.016, 0.1, matSteelDark, 0.005, 2), 0, 0.099, 0.002); // top hood
  for (const sx of [-1, 1]) {
    add(optic, rounded(0.006, 0.052, 0.1, matSteelDark, 0.0025, 1), sx * 0.025, 0.072, 0.002); // side wall
  }
  add(optic, rounded(0.044, 0.004, 0.09, matBlack, 0.0015, 1), 0, 0.054, 0.002); // dark inner floor
  // window bezels are rings only, so they never close the tube
  add(optic, new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0035, 8, 20), matSteel), 0, 0.072, 0.051);
  add(optic, new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0035, 8, 20), matSteel), 0, 0.072, -0.047);
  // glass + tiny bright holographic reticle (the reticle is drawn after the
  // glass so it always stays visible through the window)
  const lens = add(optic, new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.045), matGlass), 0, 0.072, 0.048);
  lens.renderOrder = 2;
  const reticle = add(optic, new THREE.Mesh(
    new THREE.CircleGeometry(0.0055, 20),
    new THREE.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  ), 0, 0.072, 0.05);
  reticle.renderOrder = 4;
  const reticleRing = add(optic, new THREE.Mesh(
    new THREE.RingGeometry(0.0085, 0.0095, 24),
    new THREE.MeshBasicMaterial({ color: 0xff9a4a, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  ), 0, 0.072, 0.0502);
  reticleRing.renderOrder = 4;
  // crosshair tick marks
  const tickMat = new THREE.MeshBasicMaterial({ color: 0xffb06a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const tickTop = add(optic, new THREE.Mesh(new THREE.PlaneGeometry(0.003, 0.012), tickMat), 0, 0.088, 0.0496);
  const tickBottom = add(optic, new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.003), tickMat), 0, 0.056, 0.0496);
  tickTop.renderOrder = 4;
  tickBottom.renderOrder = 4;
  // Reticle centre in held-frame space — the ADS pose is solved from this so the
  // holographic dot lands exactly on the screen crosshair (and therefore on
  // the bullet ray).
  const sightLocal = new THREE.Vector3(0, 0.142 + 0.072, -0.005 + 0.05);
  // adjustment knob, battery cap, brightness buttons, qd lever
  add(optic, cyl(0.008, 0.008, 0.014, matSteel, 12), 0.03, 0.052, 0.0, 0, 0, Math.PI / 2);
  add(optic, cyl(0.008, 0.008, 0.01, matSteel, 12), 0, 0.1, 0.008);
  add(optic, cyl(0.0065, 0.0065, 0.012, matSteelDark, 12), 0, 0.021, 0.03);
  add(optic, box(0.006, 0.008, 0.01, matAccent), -0.0275, 0.05, 0.012);
  add(optic, box(0.014, 0.008, 0.026, matAccent), 0.031, 0.03, 0.0, 0, 0, 0.1);

  // ======================= LOWER RECEIVER & CONTROLS =========================
  add(root, PROF([
    [0.14, -0.006], [0.14, -0.052], [0.108, -0.06], [0.09, -0.105], [0.02, -0.105],
    [0.006, -0.058], [-0.05, -0.055], [-0.086, -0.02], [-0.088, -0.006],
  ], 0.088, matSteel, 0.005), 0, 0, 0);
  // pistol grip: curved profile, rubber front strap, grooves, base plate
  add(root, PROF([
    [0.13, -0.052], [0.182, -0.056], [0.188, -0.078], [0.174, -0.15], [0.162, -0.166],
    [0.142, -0.161], [0.132, -0.11], [0.125, -0.07],
  ], 0.04, matPolymer, 0.004), 0, 0, 0);
  add(root, RB(0.048, 0.034, 0.07, matPolymer, 0.008, 2), 0, -0.048, 0.148); // grip tang -> receiver
  add(root, RB(0.034, 0.07, 0.012, matRubber, 0.004, 2), 0, -0.108, 0.127, 0.2);
  add(root, RB(0.042, 0.009, 0.036, matBlack, 0.003, 2), 0, -0.166, 0.146, 0.2); // grip base plate
  for (let i = 0; i < 3; i++) {
    add(root, HEXBOLT(0.0022, 0.0018), 0.019, -0.075 - i * 0.028, 0.154 - i * 0.008);
    add(root, HEXBOLT(0.0022, 0.0018), -0.019, -0.075 - i * 0.028, 0.154 - i * 0.008);
  }
  // trigger group: heavy housing welded from the receiver into the grip,
  // with a solid guard loop and the trigger blade inside the opening
  add(root, RB(0.028, 0.032, 0.082, matSteelDark, 0.006, 2), 0, -0.062, 0.112); // trigger housing
  add(root, PROF_HOLE([
    [0.076, -0.078], [0.152, -0.078], [0.158, -0.09], [0.152, -0.118], [0.13, -0.126],
    [0.098, -0.126], [0.082, -0.116], [0.076, -0.098],
  ], [
    [0.09, -0.088], [0.145, -0.088], [0.15, -0.1], [0.145, -0.116], [0.096, -0.116], [0.09, -0.1],
  ], 0.022, matSteelDark, 0.003), 0, 0, 0);
  const trigger = add(root, RB(0.008, 0.026, 0.009, matSteelDark, 0.002, 1), 0, -0.1, 0.115);
  add(trigger, RB(0.007, 0.015, 0.006, matSteel, 0.0015, 1), 0, 0.008, 0.004);
  // ambidextrous safety selectors
  for (const sx of [-1, 1]) {
    add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 12, 1, false), matSteelDark), sx * 0.047, -0.002, 0.062, 0, 0, Math.PI / 2);
    add(root, RB(0.005, 0.014, 0.03, matAccent, 0.0015, 1), sx * 0.052, -0.004, 0.075);
  }
  // charging handle (WeaponSystem animates this group in Z; base z = 0.145)
  const charge = new THREE.Group();
  charge.position.set(0, 0.105, 0.145);
  root.add(charge);
  add(charge, RB(0.05, 0.012, 0.016, matSteel, 0.003, 1), 0, 0, -0.038);
  add(charge, RB(0.012, 0.018, 0.014, matSteelDark, 0.003, 1), -0.024, 0, -0.036);
  add(charge, RB(0.012, 0.018, 0.014, matSteelDark, 0.003, 1), 0.024, 0, -0.036);
  add(charge, RB(0.02, 0.01, 0.086, matSteelDark, 0.002, 1), 0, -0.004, -0.086);
  add(charge, RB(0.036, 0.008, 0.012, matBlack, 0.002, 1), 0, -0.002, -0.132);
  // bolt — animation drives x/z; geometry sits just inside the ejection port
  const boltGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.05, 14, 1, false);
  boltGeo.rotateX(Math.PI / 2);
  boltGeo.translate(-0.006, 0, 0);
  const bolt = add(root, new THREE.Mesh(boltGeo, matSteel), 0.055, 0.062, -0.005);
  add(bolt, RB(0.012, 0.012, 0.012, matSteelDark, 0.002, 1), 0, 0, 0.022);
  // magazine (WeaponSystem resets this group to (0, -0.096, 0.035) / rot -0.12)
  const magGroup = new THREE.Group();
  magGroup.position.set(0, -0.096, 0.035);
  magGroup.rotation.x = -0.12;
  root.add(magGroup);
  const magMesh = add(magGroup, PROF([
    [-0.01, 0.048], [0.036, 0.048], [0.044, 0.0], [0.054, -0.07], [0.047, -0.122],
    [0.012, -0.116], [0.002, -0.06], [-0.012, -0.015],
  ], 0.05, matPolymer, 0.004), 0, 0, 0);
  magMesh.name = 'vxr7-magazine';
  add(magGroup, RB(0.052, 0.01, 0.062, matBlack, 0.004, 2), 0, -0.124, 0.018, -0.13, 0, 0);
  add(magGroup, RB(0.042, 0.006, 0.046, matBrass, 0.002, 1), 0, 0.038, 0.008, -0.13); // top round strip
  // spare magazine (reload animation; hidden by default)
  const spare = new THREE.Group();
  add(spare, PROF([
    [-0.01, 0.048], [0.036, 0.048], [0.044, 0.0], [0.054, -0.07], [0.047, -0.122],
    [0.012, -0.116], [0.002, -0.06], [-0.012, -0.015],
  ], 0.05, matPolymer, 0.004), 0, 0, 0);
  add(spare, RB(0.052, 0.01, 0.062, matBlack, 0.004, 2), 0, -0.124, 0.018, -0.13, 0, 0);
  spare.visible = false;
  root.add(spare);

  // ========================== MARKINGS / SIDE PLATES =========================
  add(root, RB(0.004, 0.046, 0.2, matSteelDark, 0.0015, 1), -0.0455, -0.018, 0.015); // left sideplate
  add(root, RB(0.01, 0.014, 0.03, matSteelDark, 0.002, 1), -0.049, -0.012, 0.058); // bolt catch lever
  const labelMat = new THREE.MeshBasicMaterial({
    map: makeLabelTexture(), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.92,
  });
  const label = add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.033), labelMat), -0.0492, 0.02, 0.01, 0, -Math.PI / 2);
  label.renderOrder = 3;
  const modeTex = makeLabelTexture('SEMI // AUTO', '07-421');
  add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.021),
    new THREE.MeshBasicMaterial({ map: modeTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.62 })),
    -0.0492, -0.008, 0.07, 0, -Math.PI / 2);
  const statusMat = new THREE.MeshBasicMaterial({ color: 0x73e6ff, toneMapped: false });
  add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.028), statusMat), -0.0495, 0.042, 0.075, 0, -Math.PI / 2);
  add(root, box(0.004, 0.012, 0.034, matAccent), -0.0492, 0.042, 0.112, 0, 0, 0.06);
  const serialTex = makeLabelTexture('SN 07-421', 'VXR // 5.56×45');
  add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.10, 0.024),
    new THREE.MeshBasicMaterial({ map: serialTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.68 })),
    0.0462, -0.02, 0.045, 0, Math.PI / 2, 0);
  for (let i = 0; i < 4; i++) {
    add(root, HEXBOLT(0.0042, 0.0026), -0.0462, -0.042 + (i % 2) * 0.05, -0.03 + Math.floor(i / 2) * 0.06, 0, 0, Math.PI / 2);
  }
  add(root, RING(0.011, 0.0026, matSteelDark, 6, 14), -0.0428, -0.03, 0.135, 0, Math.PI / 2, 0);

  // ---- muzzle flash assembly ----
  const flashGroup = new THREE.Group();
  flashGroup.position.set(0, 0.03, -0.92);
  root.add(flashGroup);
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
  // muzzle position in held-frame space (also the smoke spawn point) and the
  // optional flash light, re-parented under the flash group when supplied
  const muzzleLocal = new THREE.Vector3(0, 0.03, -0.95);
  if (muzzleLight) {
    muzzleLight.position.set(0, 0, -0.02);
    flashGroup.add(muzzleLight);
  }

  return {
    root,
    mats,
    bolt,
    charging: charge,
    magazine: magGroup,
    spareMagazine: spare,
    trigger,
    reticle,
    sightLocal,
    flashGroup,
    flashMats,
    muzzleLocal,
    muzzleLight,
  };
}

// ---------------------------------------------------------------------------
// Held viewmodel (compatibility layer for WeaponSystem)
// ---------------------------------------------------------------------------

/**
 * Game-facing held rig: gunRoot > gun(scale 0.62) > { weaponRoot, handsRoot }.
 * Both halves are bound (equipped) by default so `WeaponSystem` behaves exactly
 * like before the split; `WeaponSystem.equip()/unequip()` add/remove them later.
 *
 * @param {{ scene: THREE.Scene, muzzleLight: THREE.PointLight }} opts
 * @returns flat handle object (legacy fields + weaponRoot/handsRoot)
 */
export function buildVxr7Viewmodel({ scene, muzzleLight } = {}) {
  if (!scene) throw new Error('[vxr7] buildVxr7Viewmodel requires a scene');
  if (!muzzleLight) throw new Error('[vxr7] buildVxr7Viewmodel requires a muzzleLight');

  const mats = createVxr7Materials();

  const gunRoot = new THREE.Group();
  scene.add(gunRoot);

  // held frame: the weapon's held scale; hands and weapon share this frame
  const gun = new THREE.Group();
  gun.scale.setScalar(0.62);
  gunRoot.add(gun);

  const weapon = buildVxr7Weapon({ mats, muzzleLight });
  gun.add(weapon.root);

  const hands = buildVxr7Hands({ mats });
  gun.add(hands.root);

  // No square smoke cards in the viewmodel: they can catch a bad blend state
  // on some GPUs and read as a black panel. World-space smoke covers the mood.
  const smokePuffs = [];

  return {
    gunRoot,
    gun,
    ...mats,
    bolt: weapon.bolt,
    reticle: weapon.reticle,
    sightLocal: weapon.sightLocal,
    charging: weapon.charging,
    magazine: weapon.magazine,
    spareMagazine: weapon.spareMagazine,
    trigger: weapon.trigger,
    flashGroup: weapon.flashGroup,
    flashMats: weapon.flashMats,
    muzzleLocal: weapon.muzzleLocal,
    muzzleLight: weapon.muzzleLight,
    smokePuffs,
    weaponRoot: weapon.root,
    handsRoot: hands.root,
  };
}
