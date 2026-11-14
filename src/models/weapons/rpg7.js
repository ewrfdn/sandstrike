/**
 * RPG-7 rocket launcher — first-person weapon module (multi-weapon pass).
 *
 * Same contract as `vxr7.js` (CONTRACT §5), consumed by three places:
 *   - `src/models/weapons/preview.js`      dev stage BARE / HELD preview
 *   - `src/models/weapons/index.js`        WEAPON_TYPES registry + world pickups
 *   - `WeaponSystem` (src/weapons.js)      lazily built held rig, rocket mode
 *
 *   createMaterials()                    procedural textures/materials + glove set
 *   buildWeapon({ mats, muzzleLight })   bare launcher, held-frame coordinates
 *   buildHands({ mats })                 gloved hands + forearms (hands.js)
 *
 * Weapon space = held frame: muzzle points -Z, +Y up, +X right.  Root children
 * use raw held-frame units (the runtime applies the 0.62 heldScale), so the
 * world pickup wrapper scales the same model down without any extra work.
 *
 * Handles returned by buildWeapon() — all null-safe for WeaponSystem:
 *   root, flashGroup, flashMats, muzzleLocal, magazine:null, spareMagazine:null,
 *   bolt:null, charging:null, trigger, reticle, sightLocal, barrels:null,
 *   pump:null, rocket
 *
 * Design notes: the geometry is adapted from the design-only world prop
 * (`src/models/world/rpg-launcher.js` — not modified) into a real held weapon:
 * olive canvas-wrapped launch tube, wooden heat shield + pistol grip, steel
 * bands/bolts, rear venturi bell, mechanical sights + compact reflex sight,
 * sling, and a loaded PG-7V round (bulbous warhead, dark cone, brass probe,
 * four stabiliser fins) exposed as the `rocket` group so the runtime can hide
 * it after firing and show it again when the reload finishes.
 */
import * as THREE from 'three';
import {
  add, box, CZ, HEXBOLT, OCT, PROF, PROF_HOLE, RING, rounded, TUBE,
  canvasTexture, createFlashRig, createGloveMaterials, makeCanvasTexture,
  makeFlashTexture, makeLabelTexture, makeMetalTexture, makePolymerTexture, makeWoodTexture,
} from './artkit.js';
import { buildGlovedHands } from './hands.js';

/** Catalog / model-viewer metadata (CONTRACT §5). */
export const meta = {
  id: 'weapon-rpg',
  weaponId: 'rpg',
  kind: 'weapon',
  group: 'weapon',
  label: 'RPG-7 · 40mm 火箭筒',
  poses: ['bare', 'held'],
  defaultPose: 'bare',
  lift: true,
};

/** Launch-tube axis height in held-frame space (hands/rail values are built around it). */
const BORE_Y = 0.02;

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/**
 * Every material (and procedural texture) needed by the launcher and its gloved
 * hands.  `matGlove*` / `matSleeve` use the same key names as the VXR-7 so the
 * hand builder and WeaponSystem disposal are interchangeable.
 */
export function createMaterials() {
  const steelMap = canvasTexture(makeMetalTexture({ base: '#5a5d54' }), { repeatX: 5, repeatY: 3 });
  const blackMap = canvasTexture(makePolymerTexture({ base: '#3b3f3a' }), { repeatX: 3, repeatY: 3 });
  const tubeMap = canvasTexture(makeCanvasTexture({ base: '#5c5e42' }), { repeatX: 4, repeatY: 2 });
  const woodMap = canvasTexture(makeWoodTexture({ base: '#6a4626' }), { repeatX: 2, repeatY: 2 });
  const rocketMap = canvasTexture(makeCanvasTexture({ base: '#565b3c' }), { repeatX: 3, repeatY: 2 });

  const matSteel = new THREE.MeshStandardMaterial({
    color: 0x9aa39a, map: steelMap, metalness: 0.42, roughness: 0.5, envMapIntensity: 0.55,
  });
  const matSteelDark = new THREE.MeshStandardMaterial({
    color: 0x767e76, map: steelMap, metalness: 0.48, roughness: 0.53, envMapIntensity: 0.5,
  });
  const matBlack = new THREE.MeshStandardMaterial({
    color: 0x3f443d, map: blackMap, metalness: 0.3, roughness: 0.66, envMapIntensity: 0.4,
  });
  const matPolymer = new THREE.MeshStandardMaterial({
    color: 0x555a4c, map: blackMap, metalness: 0.12, roughness: 0.78, envMapIntensity: 0.35,
  });
  const matTube = new THREE.MeshStandardMaterial({
    color: 0x8d9076, map: tubeMap, metalness: 0.2, roughness: 0.74, envMapIntensity: 0.4,
  });
  const matTubeDark = new THREE.MeshStandardMaterial({
    color: 0x6b6e57, map: tubeMap, metalness: 0.24, roughness: 0.72, envMapIntensity: 0.35,
  });
  const matWarhead = new THREE.MeshStandardMaterial({
    color: 0x8d9273, map: rocketMap, metalness: 0.22, roughness: 0.7, envMapIntensity: 0.4,
  });
  const matWood = new THREE.MeshStandardMaterial({
    color: 0xb08555, map: woodMap, metalness: 0.02, roughness: 0.82, envMapIntensity: 0.3,
  });
  const matWoodDark = new THREE.MeshStandardMaterial({
    color: 0x87603a, map: woodMap, metalness: 0.02, roughness: 0.85, envMapIntensity: 0.28,
  });
  const matCanvas = new THREE.MeshStandardMaterial({
    color: 0x8f9074, map: tubeMap, metalness: 0.05, roughness: 0.92, envMapIntensity: 0.25,
  });
  const matRubber = new THREE.MeshStandardMaterial({ color: 0x1d1f21, metalness: 0.06, roughness: 0.94 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0xc9701e, metalness: 0.5, roughness: 0.44 });
  const matRust = new THREE.MeshStandardMaterial({ color: 0x8c4d27, metalness: 0.32, roughness: 0.86 });
  const matBrass = new THREE.MeshStandardMaterial({ color: 0xd8a14c, metalness: 1.0, roughness: 0.28 });
  const matGlass = new THREE.MeshPhysicalMaterial({
    color: 0xcfe8f2, metalness: 0, roughness: 0.16, transparent: true, opacity: 0.08,
    depthWrite: false, side: THREE.DoubleSide, clearcoat: 0.35, envMapIntensity: 0.9,
  });
  const matGlow = new THREE.MeshBasicMaterial({ color: 0xff7a2a, toneMapped: false });
  const matGlowSoft = new THREE.MeshBasicMaterial({
    color: 0xff9a4a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  });

  matSteel.name = 'steel';
  matSteelDark.name = 'steelDark';
  matBlack.name = 'black';
  matPolymer.name = 'polymer';
  matTube.name = 'tube';
  matTubeDark.name = 'tubeDark';
  matWarhead.name = 'warhead';
  matWood.name = 'wood';
  matWoodDark.name = 'woodDark';
  matCanvas.name = 'canvas';
  matRubber.name = 'rubber';
  matAccent.name = 'accent';
  matRust.name = 'rust';
  matBrass.name = 'brass';
  matGlass.name = 'glass';
  matGlow.name = 'glow';
  matGlowSoft.name = 'glowSoft';

  return {
    matSteel, matSteelDark, matBlack, matPolymer, matTube, matTubeDark, matWarhead,
    matWood, matWoodDark, matCanvas, matRubber, matAccent, matRust, matBrass,
    matGlass, matGlow, matGlowSoft,
    ...createGloveMaterials({
      glove: 0x4c4834,
      palm: 0x6b5f47,
      dark: 0x24251c,
      sleeve: 0x2c2e24,
    }),
  };
}

// ---------------------------------------------------------------------------
// Held-pose hand mounts (weapon-space mounts + sleeve runs)
// ---------------------------------------------------------------------------

const RPG_HANDS = {
  // Right hand wraps the rear pistol grip; forearm drops back/down out of frame.
  right: {
    position: [0.034, -0.108, 0.368],
    rotation: [0.14, 0.30, 0.05],
    sleeve: {
      points: [
        [0.048, -0.158, 0.392],
        [0.095, -0.268, 0.545],
        [0.165, -0.415, 0.745],
        [0.215, -0.545, 0.955],
      ],
      rWrist: 0.042,
      rElbow: 0.055,
    },
  },
  // Left hand C-clamps the wooden front pistol grip under the launch tube.
  left: {
    position: [-0.033, -0.088, -0.225],
    rotation: [0.02, 0.04, 0.12],
    sleeve: {
      points: [
        [-0.055, -0.125, -0.19],
        [-0.14, -0.265, 0.0],
        [-0.23, -0.435, 0.23],
        [-0.295, -0.6, 0.45],
      ],
      rWrist: 0.042,
      rElbow: 0.055,
    },
  },
};

/**
 * Both gloved hands + forearm sleeves for the RPG held pose.  The returned root
 * is parented under the held frame by the caller (same frame as `weapon.root`).
 */
export function buildHands({ mats = createMaterials() } = {}) {
  return buildGlovedHands({
    mats: {
      glove: mats.matGlove,
      glovePalm: mats.matGlovePalm,
      gloveDark: mats.matGloveDark,
      sleeve: mats.matSleeve,
      accent: mats.matAccent,
    },
    right: RPG_HANDS.right,
    left: RPG_HANDS.left,
  });
}

// ---------------------------------------------------------------------------
// Bare launcher
// ---------------------------------------------------------------------------

/** Lathe profile around the -Z axis: entries are [radius, forwardOffset]. */
function lathe(profile, mat, seg = 26) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0006, r), y));
  const geo = new THREE.LatheGeometry(pts, seg);
  geo.rotateX(-Math.PI / 2); // profile +Y → weapon forward (-Z)
  return new THREE.Mesh(geo, mat);
}

/**
 * The complete RPG-7 without hands, in held-frame coordinates.
 *
 * @param {{ mats?: object, muzzleLight?: THREE.PointLight|null }} [opts]
 * @returns {{ root: THREE.Group, mats: object, flashGroup: THREE.Group,
 *            flashMats: THREE.Material[], muzzleLocal: THREE.Vector3,
 *            magazine: null, spareMagazine: null, bolt: null, charging: null,
 *            trigger: THREE.Mesh, reticle: THREE.Mesh, sightLocal: THREE.Vector3,
 *            barrels: null, pump: null, rocket: THREE.Group,
 *            muzzleLight: THREE.PointLight|null }}
 */
export function buildWeapon({ mats = createMaterials(), muzzleLight = null } = {}) {
  const {
    matSteel, matSteelDark, matBlack, matPolymer, matTube, matTubeDark, matWarhead,
    matWood, matWoodDark, matCanvas, matRubber, matAccent, matRust, matBrass,
    matGlass, matGlow, matGlowSoft,
  } = mats;

  const root = new THREE.Group();
  root.name = 'weaponRoot';

  // ============================== LAUNCH TUBE ================================
  add(root, CZ(0.047, 0.047, 0.98, matTube, 20), 0, BORE_Y, 0);
  // front reinforcing collar + dark bore face
  add(root, CZ(0.053, 0.05, 0.075, matSteelDark, 20), 0, BORE_Y, -0.505);
  add(root, RING(0.05, 0.0045, matSteel, 6, 22), 0, BORE_Y, -0.541);
  const bore = add(root, new THREE.Mesh(new THREE.CircleGeometry(0.044, 20), matBlack), 0, BORE_Y, -0.545, 0, Math.PI, 0);
  bore.name = 'rpg-bore';
  // steel reinforcing bands along the tube
  for (const z of [-0.36, 0.44]) {
    add(root, CZ(0.0515, 0.0515, 0.03, matRust, 20), 0, BORE_Y, z);
  }
  // rear collar + venturi bell (opening points backward, +Z)
  add(root, CZ(0.05, 0.058, 0.1, matSteelDark, 20), 0, BORE_Y, 0.515);
  add(root, CZ(0.058, 0.112, 0.15, matSteelDark, 20), 0, BORE_Y, 0.615);
  add(root, RING(0.112, 0.009, matRust, 6, 24), 0, BORE_Y, 0.688);
  add(root, CZ(0.1, 0.1, 0.012, matBlack, 20), 0, BORE_Y, 0.676);
  // venturi ribs + support strut bridging the bell to the tube
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    add(root, box(0.012, 0.015, 0.13, matSteel), Math.cos(a) * 0.085, BORE_Y + Math.sin(a) * 0.085, 0.628, 0, 0, a);
  }
  add(root, box(0.02, 0.055, 0.17, matSteelDark), 0, BORE_Y - 0.07, 0.6, 0.16, 0, 0);

  // ============================ WOODEN HEAT SHIELD ==========================
  add(root, OCT(0.078, 0.4, 1.0, 1.0, matWood), 0, BORE_Y, -0.02);
  add(root, OCT(0.082, 0.034, 0.98, 1.0, matSteelDark), 0, BORE_Y, -0.203);
  add(root, OCT(0.082, 0.034, 0.98, 1.0, matSteelDark), 0, BORE_Y, 0.163);
  // wooden ribs / seams along the shield
  for (const sx of [-1, 1]) {
    add(root, box(0.006, 0.008, 0.34, matWoodDark), sx * 0.062, BORE_Y + 0.048, -0.02);
    add(root, box(0.006, 0.008, 0.34, matWoodDark), sx * 0.062, BORE_Y - 0.048, -0.02);
  }
  add(root, box(0.05, 0.007, 0.34, matWoodDark), 0, BORE_Y + 0.076, -0.02);
  add(root, box(0.05, 0.007, 0.34, matWoodDark), 0, BORE_Y - 0.076, -0.02);
  // stencil bands (orange) on the tube
  add(root, CZ(0.048, 0.048, 0.014, matAccent, 20), 0, BORE_Y, -0.43);
  add(root, CZ(0.048, 0.048, 0.014, matAccent, 20), 0, BORE_Y, 0.405);
  // small stencil plate + serial markings on the right side of the tube
  const labelMat = new THREE.MeshBasicMaterial({
    map: makeLabelTexture('RPG-7V', 'PG-7V // 40MM HEAT', '#d2741f'),
    transparent: true, depthWrite: false, toneMapped: false, opacity: 0.85,
  });
  const label = add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.038), labelMat), 0.0475, BORE_Y + 0.02, 0.31, 0, Math.PI / 2, 0);
  label.renderOrder = 3;
  const warnMat = new THREE.MeshBasicMaterial({
    map: makeLabelTexture('CAUTION', 'BACKBLAST // 15 M', '#d2741f'),
    transparent: true, depthWrite: false, toneMapped: false, opacity: 0.6,
  });
  add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.028), warnMat), -0.0475, BORE_Y + 0.01, 0.37, 0, -Math.PI / 2, 0).renderOrder = 3;

  // ========================== SIGHTS & OPTIC ================================
  // hooded front post
  add(root, box(0.03, 0.045, 0.05, matSteelDark), 0, BORE_Y + 0.068, -0.4);
  for (const sx of [-1, 1]) {
    add(root, box(0.008, 0.055, 0.024, matSteelDark), sx * 0.016, BORE_Y + 0.09, -0.4);
  }
  add(root, box(0.004, 0.05, 0.006, matSteel), 0, BORE_Y + 0.094, -0.402);
  add(root, RING(0.024, 0.0032, matSteel, 6, 18), 0, BORE_Y + 0.098, -0.4);
  // flip-up rear leaf
  add(root, box(0.03, 0.03, 0.045, matSteelDark), 0, BORE_Y + 0.062, 0.225);
  add(root, box(0.036, 0.05, 0.007, matSteelDark), 0, BORE_Y + 0.095, 0.23);
  add(root, RING(0.011, 0.0026, matSteel, 6, 16), 0, BORE_Y + 0.101, 0.233);
  // compact reflex sight (rail + hollow housing + glass + amber dot = reticle)
  add(root, box(0.038, 0.014, 0.13, matSteelDark), 0, BORE_Y + 0.085, 0.02);
  for (let i = 0; i < 3; i++) {
    add(root, box(0.042, 0.006, 0.012, matSteel), 0, BORE_Y + 0.094, 0.062 - i * 0.032);
  }
  add(root, rounded(0.052, 0.026, 0.1, matSteelDark, 0.006, 2), 0, BORE_Y + 0.106, 0.02);
  add(root, rounded(0.052, 0.014, 0.1, matSteelDark, 0.004, 2), 0, BORE_Y + 0.178, 0.02);
  for (const sx of [-1, 1]) {
    add(root, rounded(0.006, 0.056, 0.1, matSteelDark, 0.002, 1), sx * 0.023, BORE_Y + 0.143, 0.02);
  }
  add(root, box(0.04, 0.004, 0.09, matBlack), 0, BORE_Y + 0.124, 0.02);
  add(root, RING(0.019, 0.0032, matSteel, 8, 20), 0, BORE_Y + 0.146, 0.071);
  add(root, RING(0.019, 0.0032, matSteel, 8, 20), 0, BORE_Y + 0.146, -0.031);
  const lens = add(root, new THREE.Mesh(new THREE.PlaneGeometry(0.046, 0.042), matGlass), 0, BORE_Y + 0.146, 0.068);
  lens.renderOrder = 2;
  const reticle = add(root, new THREE.Mesh(new THREE.CircleGeometry(0.0052, 20), matGlow), 0, BORE_Y + 0.146, 0.07);
  reticle.renderOrder = 4;
  add(root, new THREE.Mesh(new THREE.RingGeometry(0.008, 0.0092, 24), matGlowSoft), 0, BORE_Y + 0.146, 0.0702)
    .renderOrder = 4;
  // adjustment knob + battery cap
  add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.014, 10), matSteel), 0.031, BORE_Y + 0.15, 0.02, 0, 0, Math.PI / 2);
  add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 10), matSteelDark), 0, BORE_Y + 0.189, 0.03);
  // sight line = reflex window centre (ADS zero)
  const sightLocal = new THREE.Vector3(0, BORE_Y + 0.146, 0.068);

  // ============================ GRIP / TRIGGER ==============================
  // rear pistol grip (wood) + steel backstrap
  add(root, PROF([
    [0.318, -0.018], [0.418, -0.02], [0.442, -0.046], [0.432, -0.13],
    [0.408, -0.196], [0.368, -0.208], [0.338, -0.196], [0.332, -0.12], [0.316, -0.06],
  ], 0.05, matWood, 0.006), 0, 0, 0);
  add(root, box(0.044, 0.09, 0.014, matRubber), 0, -0.135, 0.415, -0.3, 0, 0);
  add(root, box(0.052, 0.02, 0.05, matSteelDark), 0, -0.212, 0.39, 0.08, 0, 0);
  for (let i = 0; i < 3; i++) {
    add(root, HEXBOLT(0.0026, 0.002), 0.027, -0.09 - i * 0.036, 0.392 - i * 0.006, 0, 0, Math.PI / 2);
    add(root, HEXBOLT(0.0026, 0.002), -0.027, -0.09 - i * 0.036, 0.392 - i * 0.006, 0, 0, Math.PI / 2);
  }
  // trigger housing + solid guard loop with trigger blade inside
  add(root, box(0.05, 0.05, 0.11, matSteelDark), 0, -0.035, 0.352);
  add(root, PROF_HOLE([
    [0.302, -0.052], [0.405, -0.052], [0.422, -0.086], [0.412, -0.132],
    [0.36, -0.146], [0.318, -0.132], [0.298, -0.098],
  ], [
    [0.318, -0.066], [0.392, -0.066], [0.402, -0.09], [0.392, -0.12], [0.336, -0.126], [0.316, -0.104],
  ], 0.03, matSteelDark, 0.003), 0, 0, 0);
  const trigger = add(root, rounded(0.009, 0.03, 0.01, matSteelDark, 0.002, 1), 0, -0.11, 0.352, 0.12);
  add(trigger, rounded(0.008, 0.016, 0.007, matSteel, 0.0015, 1), 0, 0.01, 0.004);
  // safety lever on the left of the trigger group
  add(root, box(0.006, 0.03, 0.016, matAccent), -0.029, -0.06, 0.404, 0, 0, 0.2);

  // ============================ FRONT FURNITURE =============================
  // sling swivel + front band bolts
  add(root, RING(0.012, 0.0035, matSteelDark, 6, 16), 0.049, BORE_Y - 0.02, -0.3, 0, Math.PI / 2, 0);
  add(root, RING(0.012, 0.0035, matSteelDark, 6, 16), -0.049, BORE_Y - 0.02, 0.44, 0, Math.PI / 2, 0);
  // wooden lower fore-end under the shield (support-hand rail + heat shield cover)
  add(root, PROF([
    [-0.13, -0.052], [0.115, -0.052], [0.128, -0.08], [0.11, -0.102], [-0.115, -0.102], [-0.14, -0.078],
  ], 0.056, matWoodDark, 0.005), 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    add(root, box(0.058, 0.005, 0.008, matBlack), 0, -0.1035, -0.075 + i * 0.05);
  }
  // front pistol grip (support hand) with steel butt cap + grip grooves
  add(root, PROF([
    [-0.15, -0.03], [-0.245, -0.03], [-0.288, -0.052], [-0.298, -0.14],
    [-0.262, -0.178], [-0.2, -0.182], [-0.158, -0.162], [-0.142, -0.07],
  ], 0.055, matWood, 0.006), 0, 0, 0);
  add(root, box(0.06, 0.018, 0.062, matSteelDark), 0, -0.186, -0.226, 0.12, 0, 0);
  for (let i = 0; i < 3; i++) {
    add(root, box(0.058, 0.005, 0.009, matWoodDark), 0, -0.2 + i * 0.028, -0.25 + i * 0.012);
  }
  add(root, box(0.008, 0.05, 0.012, matAccent), 0.03, -0.11, -0.24, 0.1, 0, 0);
  add(root, box(0.008, 0.05, 0.012, matAccent), -0.03, -0.11, -0.24, 0.1, 0, 0);
  // shoulder rest (rear, under the venturi)
  add(root, PROF([
    [0.47, -0.055], [0.62, -0.075], [0.625, -0.135], [0.56, -0.145], [0.47, -0.1],
  ], 0.05, matWoodDark, 0.005), 0, 0, 0);
  add(root, box(0.085, 0.105, 0.02, matRubber), 0, -0.115, 0.628, 0.1, 0, 0);
  // sling: canvas strap hanging under the left flank of the tube
  add(root, TUBE([
    [-0.066, BORE_Y - 0.055, -0.3],
    [-0.115, BORE_Y - 0.17, -0.1],
    [-0.122, BORE_Y - 0.205, 0.12],
    [-0.096, BORE_Y - 0.14, 0.35],
    [-0.075, BORE_Y - 0.06, 0.44],
  ], 0.008, matCanvas, 22, 6), 0, 0, 0);
  // mounting bolts + side plate seams
  for (let i = 0; i < 5; i++) {
    add(root, HEXBOLT(0.0034, 0.0026), 0.0505, BORE_Y + 0.012, -0.26 + i * 0.14, 0, 0, Math.PI / 2);
  }
  add(root, box(0.004, 0.02, 0.22, matBlack), 0.0495, BORE_Y - 0.036, 0.24);
  add(root, box(0.004, 0.014, 0.16, matBlack), -0.0495, BORE_Y - 0.03, 0.2);

  // ============================ LOADED PG-7V ROUND ==========================
  const rocket = new THREE.Group();
  rocket.name = 'rpg-rocket';
  root.add(rocket);
  const ROCKET_Z = -0.52; // rear face of the warhead, right at the tube mouth
  // tail nozzle poking out of the tube
  add(rocket, CZ(0.083, 0.07, 0.075, matSteelDark, 18), 0, BORE_Y, ROCKET_Z + 0.045);
  add(rocket, RING(0.084, 0.004, matRust, 6, 20), 0, BORE_Y, ROCKET_Z + 0.083);
  add(rocket, CZ(0.068, 0.068, 0.008, matBlack, 18), 0, BORE_Y, ROCKET_Z + 0.081);
  // bulbous HEAT warhead body (lathe) + dark conical nose + brass probe
  const bulb = lathe([
    [0.072, 0.0], [0.087, 0.014], [0.098, 0.052], [0.106, 0.112],
    [0.11, 0.18], [0.109, 0.245], [0.104, 0.3], [0.1, 0.345], [0.099, 0.36],
  ], matWarhead, 26);
  add(rocket, bulb, 0, BORE_Y, ROCKET_Z);
  add(rocket, RING(0.106, 0.0045, matRust, 6, 24), 0, BORE_Y, ROCKET_Z - 0.13);
  add(rocket, RING(0.109, 0.0035, matSteelDark, 6, 24), 0, BORE_Y, ROCKET_Z - 0.25);
  const cone = lathe([
    [0.1, 0.0], [0.096, 0.035], [0.082, 0.085], [0.062, 0.14],
    [0.04, 0.19], [0.022, 0.23], [0.012, 0.255], [0.009, 0.27],
  ], matSteelDark, 24);
  add(rocket, cone, 0, BORE_Y, ROCKET_Z - 0.36);
  add(rocket, CZ(0.009, 0.012, 0.075, matBrass, 12), 0, BORE_Y, ROCKET_Z - 0.66);
  add(rocket, new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), matBrass), 0, BORE_Y, ROCKET_Z - 0.698);
  // four stabiliser fins (shared geometry) folded close to the warhead base
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.145, 0);
  finShape.lineTo(0.14, 0.022);
  finShape.lineTo(0.105, 0.062);
  finShape.lineTo(0.035, 0.05);
  finShape.lineTo(0, 0.022);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.006, bevelEnabled: false, curveSegments: 1,
  });
  finGeo.rotateY(Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, matSteelDark);
    fin.position.set(0, BORE_Y, ROCKET_Z + 0.005);
    fin.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;
    fin.translateY(0.092);
    rocket.add(fin);
    const hinge = box(0.02, 0.014, 0.03, matSteelDark);
    hinge.position.set(0, BORE_Y, ROCKET_Z + 0.004);
    hinge.rotation.z = fin.rotation.z;
    hinge.translateY(0.088);
    rocket.add(hinge);
  }
  // stencilled charge markings on the warhead
  const chargeMat = new THREE.MeshBasicMaterial({
    map: makeLabelTexture('PG-7V', 'HEAT // 40MM', '#d2741f'),
    transparent: true, depthWrite: false, toneMapped: false, opacity: 0.72,
  });
  add(rocket, new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.036), chargeMat), 0.108, BORE_Y + 0.01, ROCKET_Z - 0.19, 0, Math.PI / 2, 0)
    .renderOrder = 3;
  add(rocket, new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.034), chargeMat), -0.108, BORE_Y + 0.01, ROCKET_Z - 0.19, 0, -Math.PI / 2, 0)
    .renderOrder = 3;

  // ============================ MUZZLE FLASH RIG ============================
  // The launcher flash fires at the (now empty) tube mouth: the loaded rocket is
  // hidden by the runtime on the same frame, so this reads as the launch plume
  // escaping around the round instead of a flash embedded in the warhead.
  const muzzleLocal = new THREE.Vector3(0, BORE_Y, -0.6);
  const { flashGroup, flashMats } = createFlashRig({
    parent: root,
    muzzleLocal,
    muzzleLight,
    size: 1.9,
    color: 0xffc070,
    coreColor: 0xfff3d0,
    coneColor: 0xffab5a,
    jets: 4,
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
    reticle,
    sightLocal,
    barrels: null,
    pump: null,
    rocket,
    muzzleLight,
  };
}
