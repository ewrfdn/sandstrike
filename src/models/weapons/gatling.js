/**
 * M-77 gatling — first-person weapon module (multi-weapon pass).
 *
 * Same contract as `vxr7.js` (CONTRACT §5):
 *   createMaterials()                    procedural textures/materials + glove set
 *   buildWeapon({ mats, muzzleLight })   bare receiver + rotating barrel cluster
 *   buildHands({ mats })                 gloved hands + forearms (hands.js)
 *
 * Weapon space = held frame: muzzle points -Z, +Y up, +X right; root children
 * use raw held-frame units (runtime applies the 0.60 heldScale).
 *
 * The six barrels live in the `barrels` group whose local -Z axis is the bore
 * axis (0, 0): `barrels.rotation.z` is the spin the WeaponSystem drives.  The
 * static receiver / front bearing / feed system wrap around it, so the spinning
 * cluster is visibly concentric and every barrel stays parallel to the bore.
 *
 * Handles returned by buildWeapon() — all null-safe for WeaponSystem:
 *   root, flashGroup, flashMats, muzzleLocal (0, 0, -1.02), magazine (ammo box
 *   group used by the reload animation), spareMagazine (hidden replacement box),
 *   bolt:null, charging:null, trigger, reticle, sightLocal, barrels,
 *   pump:null, rocket:null
 */
import * as THREE from 'three';
import {
  add, boltRow, box, CZ, HEXBOLT, PROF, PROF_HOLE, RING, rounded, TUBE,
  canvasTexture, createFlashRig, createGloveMaterials, makeCanvasTexture, makeFlashTexture,
  makeHazardTexture, makeLabelTexture, makeMetalTexture, makePolymerTexture,
} from './artkit.js';
import { buildGlovedHands } from './hands.js';

/** Catalog / model-viewer metadata (CONTRACT §5). */
export const meta = {
  id: 'weapon-gatling',
  weaponId: 'gatling',
  kind: 'weapon',
  group: 'weapon',
  label: 'M-77 · 6 管加特林机枪',
  poses: ['bare', 'held'],
  defaultPose: 'bare',
  lift: true,
};

/** Barrel cluster geometry constants (all in held-frame units). */
const CLUSTER_R = 0.055; // radius of the ring the six barrels sit on
const BARREL_R = 0.0155;
const BARREL_FRONT = -0.935; // muzzle face of the barrel tubes
const BARREL_BACK = -0.075; // buried inside the gearbox
const BARREL_LEN = BARREL_BACK - BARREL_FRONT;

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** Every material (and procedural texture) needed by the gun and its gloves. */
export function createMaterials() {
  const steelMap = canvasTexture(makeMetalTexture({ base: '#575d5e' }), { repeatX: 5, repeatY: 3 });
  const polymerMap = canvasTexture(makePolymerTexture({ base: '#41473f' }), { repeatX: 3, repeatY: 3 });
  const canvasMap = canvasTexture(makeCanvasTexture({ base: '#565941' }), { repeatX: 3, repeatY: 2 });
  const hazardTex = makeHazardTexture();

  const matSteel = new THREE.MeshStandardMaterial({
    color: 0xa8afb1, map: steelMap, metalness: 0.46, roughness: 0.44, envMapIntensity: 0.62,
  });
  const matSteelDark = new THREE.MeshStandardMaterial({
    color: 0x868e90, map: steelMap, metalness: 0.5, roughness: 0.48, envMapIntensity: 0.58,
  });
  const matBlack = new THREE.MeshStandardMaterial({
    color: 0x42484a, map: polymerMap, metalness: 0.3, roughness: 0.62, envMapIntensity: 0.42,
  });
  const matPolymer = new THREE.MeshStandardMaterial({
    color: 0x767c6c, map: polymerMap, metalness: 0.14, roughness: 0.74, envMapIntensity: 0.38,
  });
  const matCanvas = new THREE.MeshStandardMaterial({
    color: 0x83866a, map: canvasMap, metalness: 0.06, roughness: 0.92, envMapIntensity: 0.25,
  });
  const matRubber = new THREE.MeshStandardMaterial({ color: 0x1c1e20, metalness: 0.06, roughness: 0.94 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0xc9701e, metalness: 0.5, roughness: 0.44 });
  const matBrass = new THREE.MeshStandardMaterial({ color: 0xd8a14c, metalness: 1.0, roughness: 0.26 });
  const matHazard = new THREE.MeshStandardMaterial({
    map: hazardTex, color: 0xb9b9b9, metalness: 0.3, roughness: 0.62, envMapIntensity: 0.4,
  });
  const matGlass = new THREE.MeshPhysicalMaterial({
    color: 0xcfe8f2, metalness: 0, roughness: 0.16, transparent: true, opacity: 0.08,
    depthWrite: false, side: THREE.DoubleSide, clearcoat: 0.35, envMapIntensity: 0.9,
  });
  const matGlow = new THREE.MeshBasicMaterial({ color: 0xff8a2e, toneMapped: false });
  const matGlowSoft = new THREE.MeshBasicMaterial({
    color: 0xff9a4a, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  });

  matSteel.name = 'steel';
  matSteelDark.name = 'steelDark';
  matBlack.name = 'black';
  matPolymer.name = 'polymer';
  matCanvas.name = 'canvas';
  matRubber.name = 'rubber';
  matAccent.name = 'accent';
  matBrass.name = 'brass';
  matHazard.name = 'hazard';
  matGlass.name = 'glass';
  matGlow.name = 'glow';
  matGlowSoft.name = 'glowSoft';

  return {
    matSteel, matSteelDark, matBlack, matPolymer, matCanvas, matRubber, matAccent,
    matBrass, matHazard, matGlass, matGlow, matGlowSoft,
    ...createGloveMaterials({
      glove: 0x4c4636,
      palm: 0x695a41,
      dark: 0x23221c,
      sleeve: 0x2e2d23,
      gloveRoughness: 0.94,
    }),
  };
}

// ---------------------------------------------------------------------------
// Held-pose hand mounts
// ---------------------------------------------------------------------------

const GATLING_HANDS = {
  // Right hand wraps the pistol grip under the gearbox.
  right: {
    position: [0.042, -0.23, 0.288],
    rotation: [0.16, 0.32, 0.05],
    sleeve: {
      points: [
        [0.055, -0.27, 0.308],
        [0.11, -0.385, 0.46],
        [0.18, -0.53, 0.68],
        [0.235, -0.65, 0.89],
      ],
      rWrist: 0.044,
      rElbow: 0.058,
    },
  },
  // Left hand C-clamps the tall front grip housing under the barrel bearing.
  left: {
    position: [-0.047, -0.158, -0.455],
    rotation: [0.02, 0.04, 0.12],
    sleeve: {
      points: [
        [-0.07, -0.192, -0.425],
        [-0.16, -0.33, -0.26],
        [-0.255, -0.5, -0.02],
        [-0.335, -0.66, 0.24],
      ],
      rWrist: 0.044,
      rElbow: 0.058,
    },
  },
};

/** Both gloved hands + forearm sleeves for the gatling held pose. */
export function buildHands({ mats = createMaterials() } = {}) {
  return buildGlovedHands({
    mats: {
      glove: mats.matGlove,
      glovePalm: mats.matGlovePalm,
      gloveDark: mats.matGloveDark,
      sleeve: mats.matSleeve,
      accent: mats.matAccent,
    },
    right: GATLING_HANDS.right,
    left: GATLING_HANDS.left,
  });
}

// ---------------------------------------------------------------------------
// Bare weapon
// ---------------------------------------------------------------------------

/**
 * Build the ammo box itself (also used for the hidden spare magazine).
 * @returns {THREE.Group}
 */
function buildAmmoBox(mats) {
  const { matPolymer, matSteelDark, matSteel, matBlack, matHazard, matBrass, matRubber, matAccent } = mats;
  const group = new THREE.Group();
  group.name = 'gatling-ammo-box';
  // body + lid
  add(group, rounded(0.16, 0.19, 0.22, matPolymer, 0.012, 2), 0, 0, 0);
  add(group, rounded(0.168, 0.028, 0.23, matSteelDark, 0.008, 2), 0, 0.105, 0);
  add(group, box(0.15, 0.012, 0.2, matBlack), 0, 0.092, 0);
  // outer hazard panel + stencil label
  const hazardPanel = add(group, new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.11), matHazard), 0.081, -0.02, 0, 0, Math.PI / 2, 0);
  hazardPanel.renderOrder = 2;
  const labelMat = new THREE.MeshBasicMaterial({
    map: makeLabelTexture('M-77', '7.62×51 // 200L', '#ff8a3c'),
    transparent: true, depthWrite: false, toneMapped: false, opacity: 0.78,
  });
  add(group, new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.03), labelMat), 0.0815, 0.06, 0.01, 0, Math.PI / 2, 0).renderOrder = 3;
  // latches, corner caps, carry strap on the lid
  for (const z of [-0.07, 0.07]) {
    add(group, box(0.014, 0.05, 0.03, matSteel), 0.083, 0.075, z);
    add(group, box(0.02, 0.016, 0.02, matAccent), 0.09, 0.085, z);
    add(group, box(0.012, 0.045, 0.026, matSteel), -0.083, 0.075, z);
  }
  add(group, box(0.06, 0.014, 0.026, matRubber), 0, 0.126, 0);
  // visible belt of rounds poking out of the top opening
  for (let i = 0; i < 3; i++) {
    add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.05, 10), matBrass), -0.04 + i * 0.04, 0.118, 0.055, 0.5, 0, Math.PI / 2);
  }
  return group;
}

/**
 * The complete M-77 without hands, in held-frame coordinates.
 *
 * @param {{ mats?: object, muzzleLight?: THREE.PointLight|null }} [opts]
 * @returns {{ root: THREE.Group, mats: object, flashGroup: THREE.Group,
 *            flashMats: THREE.Material[], muzzleLocal: THREE.Vector3,
 *            magazine: THREE.Group, spareMagazine: THREE.Group,
 *            bolt: null, charging: null, trigger: THREE.Mesh,
 *            reticle: THREE.Mesh, sightLocal: THREE.Vector3,
 *            barrels: THREE.Group, pump: null, rocket: null,
 *            muzzleLight: THREE.PointLight|null }}
 */
export function buildWeapon({ mats = createMaterials(), muzzleLight = null } = {}) {
  const {
    matSteel, matSteelDark, matBlack, matPolymer, matRubber, matAccent, matBrass,
    matGlass, matGlow, matGlowSoft, matCanvas,
  } = mats;

  const root = new THREE.Group();
  root.name = 'weaponRoot';

  // ========================= ROTATING BARREL CLUSTER =======================
  const barrels = new THREE.Group();
  barrels.name = 'barrels';
  root.add(barrels);
  const barrelGeo = new THREE.CylinderGeometry(BARREL_R, BARREL_R, BARREL_LEN, 12, 1, false);
  barrelGeo.rotateX(Math.PI / 2);
  const barrelCenterZ = (BARREL_FRONT + BARREL_BACK) / 2;
  // shared small geometries (disposed once through the Set in the registry)
  const muzzleCollarGeo = new THREE.CylinderGeometry(0.019, 0.0185, 0.05, 12, 1, false);
  muzzleCollarGeo.rotateX(Math.PI / 2);
  const heatRingGeo = new THREE.TorusGeometry(0.0175, 0.0022, 6, 14);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * CLUSTER_R;
    const y = Math.sin(a) * CLUSTER_R;
    const barrel = new THREE.Mesh(barrelGeo, matSteelDark);
    barrel.position.set(x, y, barrelCenterZ);
    barrels.add(barrel);
    const collar = new THREE.Mesh(muzzleCollarGeo, matSteel);
    collar.position.set(x, y, BARREL_FRONT + 0.003);
    barrels.add(collar);
    for (const z of [-0.34, -0.52]) {
      const ring = new THREE.Mesh(heatRingGeo, matAccent);
      ring.position.set(x, y, z);
      barrels.add(ring);
    }
  }
  // rotor discs + axle (rotate with the cluster so the motion reads)
  add(barrels, CZ(0.083, 0.083, 0.026, matSteelDark, 20), 0, 0, -0.615);
  add(barrels, CZ(0.079, 0.079, 0.03, matSteelDark, 20), 0, 0, -0.03);
  add(barrels, CZ(0.021, 0.021, 0.6, matBlack, 14), 0, 0, -0.32);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    add(barrels, HEXBOLT(0.0042, 0.0032, matSteel), Math.cos(a) * 0.062, Math.sin(a) * 0.062, -0.635, Math.PI / 2, 0, 0);
    add(barrels, HEXBOLT(0.0038, 0.003, matSteel), Math.cos(a) * 0.06, Math.sin(a) * 0.06, -0.048, Math.PI / 2, 0, 0);
  }
  // spin marker on the front rotor (visible rotation cue)
  add(barrels, box(0.012, 0.026, 0.016, matAccent), 0, 0.072, -0.63);

  // ============================ GEARBOX / RECEIVER ==========================
  add(root, rounded(0.2, 0.25, 0.46, matPolymer, 0.02, 2), 0, 0.01, 0.085);
  // top cover + hinge line + rail
  add(root, rounded(0.172, 0.055, 0.36, matSteelDark, 0.012, 2), 0, 0.15, 0.07);
  add(root, box(0.176, 0.008, 0.016, matBlack), 0, 0.148, -0.09);
  add(root, rounded(0.05, 0.014, 0.2, matSteelDark, 0.004, 2), 0, 0.183, 0.0);
  for (let i = 0; i < 8; i++) {
    add(root, rounded(0.044, 0.011, 0.014, matSteel, 0.002, 1), 0, 0.192, 0.08 - i * 0.021);
  }
  // rear cap + armour plate
  add(root, rounded(0.19, 0.215, 0.03, matSteelDark, 0.01, 2), 0, 0.015, 0.31);
  add(root, box(0.15, 0.16, 0.014, matBlack), 0, 0.02, 0.328);
  boltRow(root, matSteel, { x: 0.084, y: 0.09, z: 0.296, dz: 0.004, count: 1 });
  for (const [x, y] of [[-0.08, 0.1], [0.08, 0.1], [-0.08, -0.07], [0.08, -0.07]]) {
    add(root, HEXBOLT(0.0055, 0.004, matSteel), x, y, 0.332, 0, 0, 0);
  }
  // side plates with vents + panel lines + rivets
  for (const sx of [-1, 1]) {
    add(root, rounded(0.014, 0.17, 0.38, matSteelDark, 0.004, 1), sx * 0.103, 0.02, 0.06);
    for (let i = 0; i < 5; i++) {
      add(root, box(0.006, 0.012, 0.05, matBlack), sx * 0.111, 0.085, 0.18 - i * 0.062);
    }
    add(root, box(0.006, 0.05, 0.012, matBlack), sx * 0.111, 0.0, -0.075);
    boltRow(root, matSteel, { x: 0.111, y: -0.045, z: -0.075, dz: 0.075, count: 4, side: sx, r: 0.0038 });
  }
  // front gearbox bulkhead (barrels pass through its centre)
  add(root, rounded(0.215, 0.235, 0.05, matSteelDark, 0.014, 2), 0, 0.01, -0.155);
  add(root, RING(0.088, 0.011, matSteel, 8, 24), 0, 0.01, -0.182);
  add(root, box(0.21, 0.04, 0.02, matBlack), 0, 0.12, -0.182);
  add(root, box(0.21, 0.04, 0.02, matBlack), 0, -0.1, -0.182);
  // cooling shroud over the barrels + lower rail
  add(root, rounded(0.105, 0.05, 0.56, matPolymer, 0.01, 2), 0, 0.128, -0.44);
  for (let i = 0; i < 6; i++) {
    add(root, box(0.062, 0.008, 0.03, matBlack), 0, 0.155, -0.24 - i * 0.082);
  }
  add(root, box(0.02, 0.02, 0.5, matSteelDark), 0.043, 0.148, -0.42);
  add(root, box(0.02, 0.02, 0.5, matSteelDark), -0.043, 0.148, -0.42);
  add(root, rounded(0.085, 0.04, 0.42, matSteelDark, 0.008, 2), 0, -0.105, -0.37);
  // front barrel bearings (static rings the cluster spins inside)
  add(root, RING(0.104, 0.014, matSteel, 8, 26), 0, 0, -0.7);
  add(root, RING(0.094, 0.011, matSteelDark, 8, 24), 0, 0, -0.86);
  for (const z of [-0.7, -0.86]) {
    add(root, box(0.07, 0.07, 0.045, matSteelDark), 0, 0.105, z);
    add(root, box(0.07, 0.05, 0.045, matSteelDark), 0, -0.095, z);
  }
  add(root, box(0.05, 0.03, 0.34, matSteelDark), 0, -0.108, -0.73);
  // front iron sight (post + ears) on top of the shroud
  add(root, box(0.03, 0.03, 0.04, matSteelDark), 0, 0.165, -0.6);
  for (const sx of [-1, 1]) {
    add(root, box(0.008, 0.04, 0.02, matSteelDark), sx * 0.015, 0.173, -0.6);
  }
  add(root, box(0.004, 0.036, 0.006, matSteel), 0, 0.19, -0.602);

  // ============================== FRONT GRIP ================================
  // tall polymer grip housing the support hand clamps (left hand mount target)
  add(root, rounded(0.075, 0.115, 0.27, matPolymer, 0.012, 2), 0, -0.165, -0.455);
  add(root, rounded(0.082, 0.026, 0.285, matSteelDark, 0.008, 2), 0, -0.108, -0.455);
  add(root, rounded(0.077, 0.02, 0.27, matRubber, 0.006, 2), 0, -0.222, -0.455);
  for (let i = 0; i < 4; i++) {
    add(root, box(0.078, 0.008, 0.014, matBlack), 0, -0.15 - i * 0.022, -0.36);
  }
  add(root, box(0.006, 0.06, 0.02, matAccent), -0.039, -0.16, -0.4);
  add(root, box(0.006, 0.06, 0.02, matAccent), 0.039, -0.16, -0.4);

  // ============================= PISTOL GRIP ================================
  add(root, PROF([
    [0.22, -0.104], [0.308, -0.108], [0.325, -0.168], [0.312, -0.3],
    [0.278, -0.315], [0.248, -0.302], [0.246, -0.19], [0.216, -0.15],
  ], 0.056, matPolymer, 0.006), 0, 0, 0);
  add(root, box(0.05, 0.1, 0.014, matRubber), 0, -0.235, 0.303, -0.3, 0, 0);
  add(root, box(0.06, 0.02, 0.05, matSteelDark), 0, -0.32, 0.282, 0.08, 0, 0);
  for (let i = 0; i < 3; i++) {
    add(root, HEXBOLT(0.0028, 0.002, matSteel), 0.03, -0.19 - i * 0.036, 0.286 - i * 0.007, 0, 0, Math.PI / 2);
    add(root, HEXBOLT(0.0028, 0.002, matSteel), -0.03, -0.19 - i * 0.036, 0.286 - i * 0.007, 0, 0, Math.PI / 2);
  }
  // trigger housing, guard loop and trigger blade
  add(root, box(0.055, 0.075, 0.12, matSteelDark), 0, -0.13, 0.185);
  add(root, PROF_HOLE([
    [0.135, -0.152], [0.24, -0.152], [0.256, -0.186], [0.246, -0.232],
    [0.19, -0.246], [0.148, -0.232], [0.13, -0.198],
  ], [
    [0.15, -0.168], [0.228, -0.168], [0.238, -0.192], [0.228, -0.222], [0.166, -0.228], [0.148, -0.204],
  ], 0.032, matSteelDark, 0.003), 0, 0, 0);
  const trigger = add(root, rounded(0.01, 0.032, 0.011, matSteel, 0.002, 1), 0, -0.2, 0.19, 0.14);
  add(root, box(0.006, 0.03, 0.017, matAccent), 0.03, -0.15, 0.238, 0, 0, 0.2);

  // ============================ CARRYING HANDLE =============================
  for (const z of [0.075, 0.245]) {
    add(root, rounded(0.03, 0.1, 0.038, matSteelDark, 0.008, 2), 0, 0.228, z);
  }
  add(root, rounded(0.046, 0.038, 0.22, matPolymer, 0.012, 2), 0, 0.285, 0.16);
  for (let i = 0; i < 5; i++) {
    add(root, box(0.05, 0.008, 0.01, matRubber), 0, 0.303, 0.075 + i * 0.042);
  }
  add(root, rounded(0.05, 0.014, 0.05, matSteelDark, 0.004, 2), 0, 0.186, 0.16);

  // ============================ REFLEX SIGHT ================================
  const sightZ = 0.0;
  add(root, rounded(0.044, 0.02, 0.13, matSteelDark, 0.005, 2), 0, 0.2, sightZ);
  add(root, rounded(0.052, 0.03, 0.1, matSteelDark, 0.008, 2), 0, 0.225, sightZ + 0.005);
  for (const sx of [-1, 1]) {
    add(root, rounded(0.006, 0.048, 0.095, matSteelDark, 0.002, 1), sx * 0.023, 0.252, sightZ + 0.005);
  }
  add(root, rounded(0.052, 0.012, 0.1, matSteelDark, 0.004, 2), 0, 0.28, sightZ + 0.005);
  add(root, box(0.04, 0.004, 0.086, matBlack), 0, 0.238, sightZ + 0.005);
  add(root, RING(0.019, 0.0034, matSteel, 8, 20), 0, 0.257, sightZ + 0.056);
  add(root, RING(0.019, 0.0034, matSteel, 8, 20), 0, 0.257, sightZ - 0.046);
  const lens = add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.042), matGlass), 0, 0.257, sightZ + 0.053);
  lens.renderOrder = 2;
  const reticle = add(root, new THREE.Mesh(new THREE.CircleGeometry(0.005, 20), matGlow), 0, 0.257, sightZ + 0.055);
  reticle.renderOrder = 4;
  add(root, new THREE.Mesh(new THREE.RingGeometry(0.0078, 0.009, 24), matGlowSoft), 0, 0.257, sightZ + 0.0552).renderOrder = 4;
  add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 10), matSteel), 0.03, 0.262, sightZ + 0.005, 0, 0, Math.PI / 2);
  const sightLocal = new THREE.Vector3(0, 0.257, sightZ + 0.053);

  // ============================ AMMO FEED SYSTEM ============================
  const magazine = new THREE.Group();
  magazine.name = 'gatling-magazine';
  magazine.position.set(0.165, -0.105, 0.0);
  root.add(magazine);
  magazine.add(buildAmmoBox(mats));
  // flexible feed chute from the box lid into the receiver feed port
  add(magazine, TUBE([
    [0.0, 0.11, 0.0],
    [-0.02, 0.118, -0.04],
    [-0.045, 0.12, -0.07],
    [-0.066, 0.115, -0.1],
  ], 0.03, matCanvas, 16, 8), 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    add(magazine, RING(0.031, 0.0035, matSteelDark, 6, 12), -0.014 - i * 0.017, 0.116 + i * 0.003, -0.025 - i * 0.026, 1.0, 0.25, 0);
  }
  // brass rounds peeking out of the chute
  for (let i = 0; i < 3; i++) {
    add(magazine, new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.04, 8), matBrass), -0.016 - i * 0.016, 0.114 + i * 0.003, -0.03 - i * 0.028, 0.9, 0.3, 0);
  }
  // mount bracket to the receiver flank
  add(magazine, box(0.09, 0.06, 0.11, matSteelDark), -0.085, 0.03, -0.055);
  add(magazine, box(0.02, 0.12, 0.12, matBlack), -0.125, -0.01, -0.05);
  // hidden spare magazine (reload animation; built once, shown only in animation)
  const spareMagazine = buildAmmoBox(mats);
  spareMagazine.name = 'gatling-spare-magazine';
  spareMagazine.position.set(0.165, -0.42, 0.0);
  spareMagazine.visible = false;
  root.add(spareMagazine);
  // ejection chute + brass deflector under the right flank
  add(root, box(0.05, 0.03, 0.1, matBlack), 0.1, -0.075, 0.0, 0, 0, -0.2);
  add(root, box(0.04, 0.04, 0.02, matSteelDark), 0.115, -0.06, -0.06, 0, 0, -0.3);

  // ============================ CABLES / GLOW / MARKS =======================
  add(root, TUBE([
    [0.085, 0.055, 0.02],
    [0.12, 0.055, -0.2],
    [0.108, 0.075, -0.44],
    [0.075, 0.1, -0.62],
  ], 0.008, matRubber, 18, 6), 0, 0, 0);
  add(root, TUBE([
    [0.085, -0.055, 0.03],
    [0.11, -0.075, -0.18],
    [0.09, -0.085, -0.4],
    [0.05, -0.095, -0.6],
  ], 0.007, matRubber, 18, 6), 0, 0, 0);
  add(root, RING(0.025, 0.0035, matGlow, 8, 18), 0.112, 0.05, 0.14, 0, Math.PI / 2, 0);
  add(root, box(0.004, 0.006, 0.16, matGlowSoft), -0.112, 0.06, 0.05);
  const labelMat = new THREE.MeshBasicMaterial({
    map: makeLabelTexture('M-77', 'SANDSTRIKE // 6×7.62', '#ff8a3c'),
    transparent: true, depthWrite: false, toneMapped: false, opacity: 0.75,
  });
  add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.04), labelMat), -0.1125, 0.03, 0.1, 0, -Math.PI / 2, 0).renderOrder = 3;
  const warnMat = new THREE.MeshBasicMaterial({
    map: makeLabelTexture('DANGER', 'ROTATING BARRELS', '#ff8a3c'),
    transparent: true, depthWrite: false, toneMapped: false, opacity: 0.6,
  });
  add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.03), warnMat), 0.0645, 0.13, -0.5, 0, Math.PI / 2, 0).renderOrder = 3;
  // heat-scorched muzzle crowns: small dark caps on each barrel front
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(barrels, new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.008, 10), matBlack),
      Math.cos(a) * CLUSTER_R, Math.sin(a) * CLUSTER_R, BARREL_FRONT - 0.028, Math.PI / 2, 0, 0);
  }

  // ============================ MUZZLE FLASH RIG ============================
  const muzzleLocal = new THREE.Vector3(0, 0, -1.02);
  const { flashGroup, flashMats } = createFlashRig({
    parent: root,
    muzzleLocal,
    muzzleLight,
    size: 1.55,
    color: 0xffb45a,
    coreColor: 0xfff0c0,
    coneColor: 0xffa14a,
    jets: 4,
    flashTex: makeFlashTexture(),
  });

  return {
    root,
    mats,
    flashGroup,
    flashMats,
    muzzleLocal,
    magazine,
    spareMagazine,
    bolt: null,
    charging: null,
    trigger,
    reticle,
    sightLocal,
    barrels,
    pump: null,
    rocket: null,
    muzzleLight,
  };
}
