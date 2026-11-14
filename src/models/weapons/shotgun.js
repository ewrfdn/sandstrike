/**
 * SG-12 pump shotgun — first-person weapon module (multi-weapon pass).
 *
 * Same contract as `vxr7.js` (CONTRACT §5):
 *   createMaterials()                    procedural textures/materials + glove set
 *   buildWeapon({ mats, muzzleLight })   bare shotgun with the `pump` group
 *   buildHands({ mats })                 gloved hands + forearms (hands.js)
 *
 * Weapon space = held frame: muzzle points -Z, +Y up, +X right; root children
 * use raw held-frame units (runtime applies the 0.62 heldScale).
 *
 * The pump/forend is its own `pump` group parented at the root origin, so the
 * runtime can slide `pump.position.z` for the pump animation.  Everything else
 * (receiver, barrel + vent rib, tube magazine, walnut stock, trigger group,
 * side-saddle shells, sling) stays static.
 *
 * Handles returned by buildWeapon() — all null-safe for WeaponSystem:
 *   root, flashGroup, flashMats, muzzleLocal (0, 0, -0.92), magazine:null,
 *   spareMagazine:null, bolt:null, charging:null, trigger, reticle:null,
 *   sightLocal (ghost-ring aperture), barrels:null, pump, rocket:null
 */
import * as THREE from 'three';
import {
  add, boltRow, box, CZ, HEXBOLT, OCT, PROF, PROF_HOLE, RING, rounded, sphere, TUBE,
  canvasTexture, createFlashRig, createGloveMaterials, makeCanvasTexture, makeFlashTexture,
  makeLabelTexture, makeMetalTexture, makePolymerTexture, makeWoodTexture,
} from './artkit.js';
import { buildGlovedHands } from './hands.js';

/** Catalog / model-viewer metadata (CONTRACT §5). */
export const meta = {
  id: 'weapon-shotgun',
  weaponId: 'shotgun',
  kind: 'weapon',
  group: 'weapon',
  label: 'SG-12 · 12 号泵动霰弹枪',
  poses: ['bare', 'held'],
  defaultPose: 'bare',
  lift: true,
};

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** Every material (and procedural texture) needed by the shotgun and gloves. */
export function createMaterials() {
  const steelMap = canvasTexture(makeMetalTexture({ base: '#565c60' }), { repeatX: 5, repeatY: 3 });
  const polymerMap = canvasTexture(makePolymerTexture({ base: '#3c4144' }), { repeatX: 3, repeatY: 3 });
  const woodMap = canvasTexture(makeWoodTexture({ base: '#6b4425' }), { repeatX: 2, repeatY: 2 });
  const canvasMap = canvasTexture(makeCanvasTexture({ base: '#5b5b43' }), { repeatX: 3, repeatY: 2 });

  const matBarrel = new THREE.MeshStandardMaterial({
    color: 0x5a646b, map: steelMap, metalness: 0.72, roughness: 0.34, envMapIntensity: 0.7,
  });
  const matSteel = new THREE.MeshStandardMaterial({
    color: 0x9ba3a8, map: steelMap, metalness: 0.55, roughness: 0.42, envMapIntensity: 0.6,
  });
  const matSteelDark = new THREE.MeshStandardMaterial({
    color: 0x717a80, map: steelMap, metalness: 0.58, roughness: 0.46, envMapIntensity: 0.55,
  });
  const matBlack = new THREE.MeshStandardMaterial({
    color: 0x34393c, map: polymerMap, metalness: 0.3, roughness: 0.62, envMapIntensity: 0.4,
  });
  const matPolymer = new THREE.MeshStandardMaterial({
    color: 0x4c5254, map: polymerMap, metalness: 0.12, roughness: 0.8, envMapIntensity: 0.35,
  });
  const matWood = new THREE.MeshStandardMaterial({
    color: 0xa87546, map: woodMap, metalness: 0.02, roughness: 0.78, envMapIntensity: 0.32,
  });
  const matWoodDark = new THREE.MeshStandardMaterial({
    color: 0x7d552f, map: woodMap, metalness: 0.02, roughness: 0.82, envMapIntensity: 0.3,
  });
  const matCanvas = new THREE.MeshStandardMaterial({
    color: 0x8b8c70, map: canvasMap, metalness: 0.05, roughness: 0.93, envMapIntensity: 0.25,
  });
  const matRubber = new THREE.MeshStandardMaterial({ color: 0x1c1e20, metalness: 0.05, roughness: 0.95 });
  const matBrass = new THREE.MeshStandardMaterial({ color: 0xd8a14c, metalness: 1.0, roughness: 0.26 });
  const matShell = new THREE.MeshStandardMaterial({ color: 0x8e2f24, metalness: 0.15, roughness: 0.6 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0xc9701e, metalness: 0.5, roughness: 0.44 });
  const matBead = new THREE.MeshStandardMaterial({
    color: 0xffe0a8, emissive: 0x7a4c14, emissiveIntensity: 0.8, metalness: 0.85, roughness: 0.22,
  });

  matBarrel.name = 'barrel';
  matSteel.name = 'steel';
  matSteelDark.name = 'steelDark';
  matBlack.name = 'black';
  matPolymer.name = 'polymer';
  matWood.name = 'wood';
  matWoodDark.name = 'woodDark';
  matCanvas.name = 'canvas';
  matRubber.name = 'rubber';
  matBrass.name = 'brass';
  matShell.name = 'shell';
  matAccent.name = 'accent';
  matBead.name = 'bead';

  return {
    matBarrel, matSteel, matSteelDark, matBlack, matPolymer, matWood, matWoodDark,
    matCanvas, matRubber, matBrass, matShell, matAccent, matBead,
    ...createGloveMaterials({
      glove: 0x5c4b33,
      palm: 0x6d5a3f,
      dark: 0x2b2419,
      sleeve: 0x37331f,
      gloveRoughness: 0.92,
    }),
  };
}

// ---------------------------------------------------------------------------
// Held-pose hand mounts
// ---------------------------------------------------------------------------

const SHOTGUN_HANDS = {
  // Right hand on the wrist of the stock (behind the trigger guard).
  right: {
    position: [0.033, -0.142, 0.262],
    rotation: [0.14, 0.32, 0.05],
    sleeve: {
      points: [
        [0.048, -0.18, 0.282],
        [0.1, -0.29, 0.43],
        [0.17, -0.43, 0.64],
        [0.22, -0.56, 0.85],
      ],
      rWrist: 0.042,
      rElbow: 0.055,
    },
  },
  // Left hand C-clamps the wooden pump/forend (rides the pump animation).
  left: {
    position: [-0.056, -0.024, -0.45],
    rotation: [0.02, 0.04, 0.12],
    sleeve: {
      points: [
        [-0.078, -0.062, -0.418],
        [-0.15, -0.2, -0.25],
        [-0.235, -0.37, -0.01],
        [-0.295, -0.56, 0.24],
      ],
      rWrist: 0.042,
      rElbow: 0.055,
    },
  },
};

/** Both gloved hands + forearm sleeves for the SG-12 held pose. */
export function buildHands({ mats = createMaterials() } = {}) {
  return buildGlovedHands({
    mats: {
      glove: mats.matGlove,
      glovePalm: mats.matGlovePalm,
      gloveDark: mats.matGloveDark,
      sleeve: mats.matSleeve,
      accent: mats.matAccent,
    },
    right: SHOTGUN_HANDS.right,
    left: SHOTGUN_HANDS.left,
  });
}

// ---------------------------------------------------------------------------
// Bare weapon
// ---------------------------------------------------------------------------

/**
 * The complete SG-12 without hands, in held-frame coordinates.
 *
 * @param {{ mats?: object, muzzleLight?: THREE.PointLight|null }} [opts]
 * @returns {{ root: THREE.Group, mats: object, flashGroup: THREE.Group,
 *            flashMats: THREE.Material[], muzzleLocal: THREE.Vector3,
 *            magazine: null, spareMagazine: null, bolt: null, charging: null,
 *            trigger: THREE.Mesh, reticle: null, sightLocal: THREE.Vector3,
 *            barrels: null, pump: THREE.Group, rocket: null,
 *            muzzleLight: THREE.PointLight|null }}
 */
export function buildWeapon({ mats = createMaterials(), muzzleLight = null } = {}) {
  const {
    matBarrel, matSteel, matSteelDark, matBlack, matPolymer, matWood, matWoodDark,
    matCanvas, matRubber, matBrass, matShell, matAccent, matBead,
  } = mats;

  const root = new THREE.Group();
  root.name = 'weaponRoot';

  // ================================ BARREL ==================================
  add(root, CZ(0.0155, 0.018, 0.83, matBarrel, 18), 0, 0, -0.495); // z -0.91 .. -0.08
  add(root, CZ(0.0175, 0.0175, 0.022, matSteelDark, 18), 0, 0, -0.898);
  add(root, RING(0.016, 0.0026, matSteel, 6, 18), 0, 0, -0.91);
  const bore = add(root, new THREE.Mesh(new THREE.CircleGeometry(0.0125, 18), matBlack), 0, 0, -0.9095, 0, Math.PI, 0);
  bore.name = 'shotgun-bore';
  // ventilated rib along the top of the barrel (base rail + posts)
  add(root, box(0.012, 0.007, 0.82, matBarrel), 0, 0.021, -0.5);
  for (let i = 0; i < 8; i++) {
    add(root, box(0.009, 0.012, 0.012, matSteelDark), 0, 0.0135, -0.855 + i * 0.101);
  }
  add(root, box(0.014, 0.005, 0.82, matSteelDark), 0, 0.0255, -0.5);
  // front bead sight on a short post
  add(root, box(0.006, 0.02, 0.006, matSteelDark), 0, 0.038, -0.868);
  add(root, sphere(0.0062, matBead, 12, 9), 0, 0.052, -0.868);
  add(root, RING(0.0085, 0.0018, matSteelDark, 5, 12), 0, 0.038, -0.868, Math.PI / 2, 0, 0);

  // ============================ TUBE MAGAZINE ===============================
  add(root, CZ(0.0145, 0.0145, 0.6, matBarrel, 16), 0, -0.05, -0.44); // z -0.74 .. -0.14
  add(root, CZ(0.0165, 0.0165, 0.03, matSteelDark, 16), 0, -0.05, -0.755);
  add(root, RING(0.015, 0.0026, matSteel, 6, 16), 0, -0.05, -0.771);
  add(root, RING(0.011, 0.0028, matSteelDark, 6, 14), -0.038, -0.062, -0.7, 0, Math.PI / 2, 0); // sling loop
  // barrel clamp / band tying barrel + magazine together
  add(root, rounded(0.052, 0.088, 0.03, matSteelDark, 0.008, 2), 0, -0.024, -0.7);
  add(root, box(0.058, 0.014, 0.02, matSteel), 0, -0.024, -0.7);
  for (const sx of [-1, 1]) {
    add(root, HEXBOLT(0.0038, 0.003, matSteel), sx * 0.027, -0.024, -0.7, 0, 0, Math.PI / 2);
  }
  // second, thinner band near the receiver
  add(root, rounded(0.05, 0.082, 0.022, matSteelDark, 0.006, 2), 0, -0.022, -0.16);

  // =============================== RECEIVER =================================
  add(root, PROF([
    [-0.12, 0.048], [-0.12, -0.052], [0.02, -0.082], [0.2, -0.078],
    [0.284, -0.052], [0.288, 0.064], [0.2, 0.086], [0.02, 0.09], [-0.09, 0.072],
  ], 0.09, matSteelDark, 0.007), 0, 0, 0);
  // top plate, ejection port (right), loading port + shell lifter (bottom)
  add(root, rounded(0.078, 0.018, 0.34, matSteel, 0.005, 2), 0, 0.094, 0.075);
  add(root, box(0.006, 0.042, 0.1, matBlack), 0.0455, 0.038, -0.005);
  add(root, rounded(0.01, 0.01, 0.11, matSteel, 0.003, 1), 0.049, 0.062, -0.005);
  add(root, rounded(0.01, 0.01, 0.11, matSteel, 0.003, 1), 0.049, 0.014, -0.005);
  add(root, box(0.004, 0.036, 0.09, matBlack), 0.0575, 0.036, -0.005);
  add(root, box(0.045, 0.008, 0.11, matBlack), 0, -0.084, 0.02);
  add(root, box(0.038, 0.007, 0.1, matSteel), 0, -0.086, 0.028, 0.06, 0, 0);
  // receiver pins, side plate seams and bolt rails
  for (const [z, y] of [[-0.06, 0.02], [0.16, 0.02], [0.02, -0.045], [0.2, -0.045]]) {
    add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.098, 12), matSteel), 0, y, z, 0, 0, Math.PI / 2);
  }
  for (const sx of [-1, 1]) {
    add(root, box(0.004, 0.02, 0.3, matBlack), sx * 0.046, 0.012, 0.06);
    add(root, box(0.004, 0.012, 0.26, matBlack), sx * 0.046, -0.03, 0.05);
  }
  boltRow(root, matSteel, { x: 0.0455, y: 0.075, z: -0.07, dz: 0.06, count: 3, r: 0.0036 });
  // shell carrier / elevator visible through the loading port, plus the
  // bolt inside the ejection port
  add(root, box(0.05, 0.006, 0.16, matSteel), 0, -0.062, 0.06, 0.08, 0, 0);
  add(root, rounded(0.036, 0.022, 0.09, matSteel, 0.004, 2), 0.012, 0.028, -0.02);
  add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.05, 10), matSteelDark), 0.02, 0.03, 0.02, 0, 0, Math.PI / 2);

  // ---- cross-bolt safety + gold trigger ----
  add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.104, 12), matSteelDark), 0, -0.03, 0.208, 0, 0, Math.PI / 2);
  add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 12), matAccent), 0.055, -0.03, 0.208, 0, 0, Math.PI / 2);
  // trigger housing + guard loop + trigger blade
  add(root, rounded(0.062, 0.05, 0.15, matSteelDark, 0.008, 2), 0, -0.062, 0.145);
  add(root, PROF_HOLE([
    [0.06, -0.086], [0.202, -0.086], [0.216, -0.118], [0.202, -0.164],
    [0.13, -0.178], [0.082, -0.162], [0.062, -0.128],
  ], [
    [0.076, -0.1], [0.19, -0.1], [0.2, -0.12], [0.19, -0.152], [0.11, -0.16], [0.078, -0.136],
  ], 0.03, matSteelDark, 0.003), 0, 0, 0);
  const trigger = add(root, rounded(0.009, 0.03, 0.009, matBrass, 0.002, 1), 0, -0.128, 0.118, 0.1);
  add(trigger, rounded(0.008, 0.014, 0.006, matAccent, 0.0015, 1), 0, 0.008, 0.003);
  // hammer / sear block behind the trigger
  add(root, rounded(0.036, 0.034, 0.05, matSteel), 0, -0.07, 0.19);

  // ============================ PUMP / FOREND ===============================
  // Own group at the root origin: WeaponSystem slides pump.position.z.
  const pump = new THREE.Group();
  pump.name = 'pump';
  root.add(pump);
  add(pump, OCT(0.052, 0.3, 1.0, 0.9, matWood), 0, -0.026, -0.46); // z -0.61 .. -0.31
  add(pump, OCT(0.055, 0.024, 1.0, 0.9, matSteelDark), 0, -0.026, -0.617);
  add(pump, OCT(0.054, 0.02, 1.0, 0.9, matSteelDark), 0, -0.026, -0.303);
  // finger grooves on the underside + long seams on the flanks
  for (let i = 0; i < 8; i++) {
    add(pump, box(0.075, 0.006, 0.012, matWoodDark), 0, -0.0705, -0.585 + i * 0.033);
  }
  for (const sx of [-1, 1]) {
    add(pump, box(0.006, 0.012, 0.29, matWoodDark), sx * 0.0525, -0.026, -0.46);
    add(pump, box(0.045, 0.005, 0.29, matWoodDark), 0, 0.0015, -0.46);
  }
  // steel action bars running back into the receiver (move with the pump)
  for (const sx of [-1, 1]) {
    add(pump, box(0.012, 0.006, 0.28, matSteel), sx * 0.032, -0.062, -0.2);
    add(pump, box(0.03, 0.008, 0.06, matSteelDark), sx * 0.032, -0.062, -0.08);
  }
  add(pump, RING(0.05, 0.0035, matSteel, 6, 18), 0, -0.026, -0.31);
  boltRow(pump, matSteel, { x: 0.0535, y: -0.026, z: -0.35, dz: 0.05, count: 2, side: 1, r: 0.0032 });

  // ============================ WALNUT FURNITURE ============================
  // wrist / semi-pistol grip behind the trigger
  add(root, PROF([
    [0.2, -0.062], [0.296, -0.066], [0.322, -0.1], [0.3, -0.19],
    [0.266, -0.206], [0.236, -0.196], [0.226, -0.132], [0.192, -0.082],
  ], 0.055, matWood, 0.006), 0, 0, 0);
  for (const sx of [-1, 1]) {
    add(root, box(0.01, 0.055, 0.05, matBlack), sx * 0.028, -0.135, 0.265, 0.2, 0, 0);
  }
  add(root, box(0.052, 0.016, 0.05, matRubber), 0, -0.208, 0.272, 0.12, 0, 0);
  // stock (side profile, walnut) + cheek piece + butt pad
  add(root, PROF([
    [0.27, 0.08], [0.4, 0.077], [0.56, 0.054], [0.634, 0.038], [0.648, -0.02],
    [0.636, -0.1], [0.598, -0.174], [0.518, -0.205], [0.42, -0.203],
    [0.342, -0.166], [0.292, -0.1], [0.268, -0.03],
  ], 0.068, matWood, 0.008), 0, 0, 0);
  add(root, rounded(0.06, 0.02, 0.19, matWoodDark, 0.008, 2), 0, 0.083, 0.43);
  add(root, box(0.074, 0.235, 0.026, matRubber), 0, -0.078, 0.655, -0.05, 0, 0);
  for (let i = 0; i < 3; i++) {
    add(root, box(0.078, 0.006, 0.01, matBlack), 0, -0.16 + i * 0.075, 0.667);
  }
  add(root, RING(0.011, 0.0028, matSteelDark, 6, 14), 0, -0.2, 0.55, 0, 0, 0); // sling stud under stock
  // receiver / furniture junction plate + checkering screws
  add(root, rounded(0.072, 0.02, 0.03, matSteelDark, 0.005, 2), 0, 0.06, 0.286);
  for (const sx of [-1, 1]) {
    add(root, HEXBOLT(0.0032, 0.0024, matSteel), sx * 0.024, -0.02, 0.282, 0, 0, Math.PI / 2);
    add(root, HEXBOLT(0.0032, 0.0024, matSteel), sx * 0.024, 0.03, 0.282, 0, 0, Math.PI / 2);
  }

  // ============================= REAR GHOST RING ============================
  add(root, box(0.034, 0.016, 0.05, matSteelDark), 0, 0.1, 0.205);
  add(root, box(0.03, 0.045, 0.008, matSteelDark), 0, 0.124, 0.214);
  for (const sx of [-1, 1]) {
    add(root, box(0.008, 0.05, 0.014, matSteelDark), sx * 0.014, 0.12, 0.205);
  }
  add(root, RING(0.0115, 0.0028, matSteel, 6, 18), 0, 0.123, 0.216);
  const sightLocal = new THREE.Vector3(0, 0.123, 0.216);

  // ============================ SIDE-SADDLE SHELLS ==========================
  add(root, box(0.012, 0.088, 0.21, matBlack), -0.048, 0.012, 0.055);
  add(root, box(0.008, 0.096, 0.024, matRubber), -0.053, 0.012, -0.045);
  add(root, box(0.008, 0.096, 0.024, matRubber), -0.053, 0.012, 0.155);
  for (let i = 0; i < 4; i++) {
    const z = -0.03 + i * 0.052;
    add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0115, 0.058, 12), matShell), -0.058, 0.012, z, 0, 0, Math.PI / 2);
    add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.0122, 0.0122, 0.014, 12), matBrass), -0.058, 0.012, z + 0.033, 0, 0, Math.PI / 2);
    add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.0122, 0.0122, 0.006, 12), matAccent), -0.058, 0.012, z - 0.032, 0, 0, Math.PI / 2);
  }
  add(root, box(0.006, 0.02, 0.19, matRubber), -0.065, 0.012, 0.055);

  // ============================ SLING / MARKINGS ============================
  // sling: two short canvas straps (front band loop + stock loop) so the
  // viewmodel silhouette stays clean instead of one long strap crossing the arms
  add(root, TUBE([
    [-0.041, -0.064, -0.71],
    [-0.076, -0.136, -0.695],
    [-0.083, -0.15, -0.65],
    [-0.05, -0.086, -0.638],
  ], 0.0075, matCanvas, 14, 6), 0, 0, 0);
  add(root, TUBE([
    [0.002, -0.196, 0.552],
    [-0.062, -0.27, 0.5],
    [-0.088, -0.286, 0.43],
    [-0.06, -0.238, 0.38],
  ], 0.0075, matCanvas, 14, 6), 0, 0, 0);
  const labelMat = new THREE.MeshBasicMaterial({
    map: makeLabelTexture('SG-12', '12 GA // 3 INCH MAG', '#d2741f'),
    transparent: true, depthWrite: false, toneMapped: false, opacity: 0.8,
  });
  add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.035), labelMat), 0.0455, 0.03, 0.085, 0, Math.PI / 2, 0).renderOrder = 3;
  const serialMat = new THREE.MeshBasicMaterial({
    map: makeLabelTexture('SN 12-4471', 'SANDSTRIKE ARMORY', '#d2741f'),
    transparent: true, depthWrite: false, toneMapped: false, opacity: 0.62,
  });
  add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.026), serialMat), -0.0455, -0.02, 0.12, 0, -Math.PI / 2, 0).renderOrder = 3;
  const gaMat = new THREE.MeshBasicMaterial({
    map: makeLabelTexture('12GA', 'MAGNUM', '#d2741f'),
    transparent: true, depthWrite: false, toneMapped: false, opacity: 0.55,
  });
  add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.022), gaMat), 0.0465, 0.052, 0.17, 0, Math.PI / 2, 0).renderOrder = 3;

  // ============================ MUZZLE FLASH RIG ============================
  const muzzleLocal = new THREE.Vector3(0, 0, -0.92);
  const { flashGroup, flashMats } = createFlashRig({
    parent: root,
    muzzleLocal,
    muzzleLight,
    size: 1.15,
    color: 0xffb45a,
    coreColor: 0xfff0c0,
    coneColor: 0xffa14a,
    jets: 2,
    flashTex: makeFlashTexture(),
  });

  return {
    root,
    mats,
    flashGroup,
    flashMats,
    muzzleLocal,
    magazine: null,
    spareMagazine: null,
    bolt: null,
    charging: null,
    trigger,
    reticle: null,
    sightLocal,
    barrels: null,
    pump,
    rocket: null,
    muzzleLight,
  };
}
