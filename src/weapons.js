import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CONFIG } from './config.js';
import { emit } from './bus.js';
import { clamp, damp, rand, canvasTexture } from './utils.js';

const W = CONFIG.weapon;

/** Small helpers for building the view-model out of primitives. */
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

// scratch objects for the per-frame viewmodel convergence solve
const _convQuat = new THREE.Quaternion();
const _muzzleOff = new THREE.Vector3();
const _barrelDir = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();

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

export class WeaponSystem {
  constructor({ camera, canvas, world, enemies, effects, audio, player, renderer, environment = null }) {
    this.camera = camera;
    this.canvas = canvas;
    this.world = world;
    this.enemies = enemies;
    this.effects = effects;
    this.audio = audio;
    this.player = player;
    this.renderer = renderer;

    this.active = false;
    this.touchMode = false;
    this.mag = W.magSize;
    this.magSize = W.magSize;
    this.reserve = W.reserveStart;
    this.reserveMax = W.reserveMax;
    // loot progression
    this.damageMultiplier = 1;
    this.magExtension = 0;
    this.reloadSpeedMul = 1;
    this.fireInterval = 60 / W.rpm;
    this.fireCooldown = 0;
    this.triggerDown = false;
    this.aiming = false;
    this.ads = 0;
    this.reloading = false;
    this.reloadTime = 0;
    this.reloadDuration = W.reloadTime;
    this.spreadBloom = 0;
    this.recoil = 0;
    this.recoilYaw = 0;
    this.time = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.lastFireTime = -999;
    this._prevYaw = 0;
    this._prevPitch = 0;
    this._swayX = 0;
    this._swayY = 0;
    this._sprintBlend = 0;
    this._muzzleTimer = 0;
    this._boltKick = 0;
    this._reloadPlayed = new Set();
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 280;
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._end = new THREE.Vector3();
    this._muzzleView = new THREE.Vector3();
    this._muzzleNdc = new THREE.Vector3();
    this._ejectView = new THREE.Vector3();
    this._ejectWorld = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();

    this._buildScene(environment);
    this._buildWeapon();
    this._bindInput();
  }

  // ---------------------------------------------------------------------------
  // View-model scene
  // ---------------------------------------------------------------------------
  _buildScene(environment) {
    this.viewScene = new THREE.Scene();
    this.viewScene.environment = environment;
    this.viewScene.environmentIntensity = 0.75;
    this.viewCamera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.01, 12);
    this.viewCamera.position.set(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xffe0b8, 0x33261b, 1.05);
    this.viewScene.add(hemi);

    const key = new THREE.DirectionalLight(0xffdfb6, 3.6);
    key.position.set(-2.6, 3.6, 2.2);
    this.viewScene.add(key);

    const fill = new THREE.DirectionalLight(0x9cc4e0, 1.6);
    fill.position.set(3.2, 0.7, 2.4);
    this.viewScene.add(fill);

    const rim = new THREE.DirectionalLight(0xff8d46, 2.8);
    rim.position.set(0.6, 1.6, -3.0);
    this.viewScene.add(rim);

    // soft frontal bounce so the side facing the camera keeps its material detail
    const cameraFill = new THREE.DirectionalLight(0xb4c9d6, 1.2);
    cameraFill.position.set(0.2, 1.4, 3.4);
    this.viewScene.add(cameraFill);

    this.muzzleLight = new THREE.PointLight(0xffa34a, 0, 4.5, 2);
    // parented to the flash group after the weapon is built so it tracks the muzzle
  }

  _buildWeapon() {
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

    this.matSteel = new THREE.MeshStandardMaterial({
      color: 0xc2c8cc, map: steelMap, metalness: 0.82, roughness: 0.32, envMapIntensity: 1.15,
    });
    this.matSteelDark = new THREE.MeshStandardMaterial({
      color: 0x8c9297, map: steelMap, metalness: 0.85, roughness: 0.38, envMapIntensity: 1.05,
    });
    this.matBlack = new THREE.MeshStandardMaterial({
      color: 0x474d50, map: polymerMap, metalness: 0.70, roughness: 0.47, envMapIntensity: 0.95,
    });
    this.matPolymer = new THREE.MeshStandardMaterial({
      color: 0x7a7e80, map: polymerMap, metalness: 0.18, roughness: 0.7, envMapIntensity: 0.7,
    });
    this.matRubber = new THREE.MeshStandardMaterial({ color: 0x151718, metalness: 0.05, roughness: 0.95 });
    this.matAccent = new THREE.MeshStandardMaterial({ color: 0xd46b26, metalness: 0.55, roughness: 0.4 });
    this.matBrass = new THREE.MeshStandardMaterial({ color: 0xd8a14c, metalness: 1.0, roughness: 0.25 });
    this.matGlass = new THREE.MeshPhysicalMaterial({
      color: 0x7fb8c9, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.24,
      transmission: 0.2, clearcoat: 1,
    });
    this.matGlove = new THREE.MeshStandardMaterial({
      color: 0x46392b, roughness: 0.9, metalness: 0.03,
    });
    this.matGlovePalm = new THREE.MeshStandardMaterial({
      color: 0x544635, roughness: 0.86, metalness: 0.035,
    });
    this.matGloveDark = new THREE.MeshStandardMaterial({
      color: 0x25251f, roughness: 0.86, metalness: 0.1,
    });
    this.matSleeve = new THREE.MeshStandardMaterial({
      color: 0x2a2b23, roughness: 0.96, metalness: 0,
    });

    const root = new THREE.Group();
    this.gunRoot = root;
    this.viewScene.add(root);

    const gun = new THREE.Group();
    gun.scale.setScalar(0.62);
    root.add(gun);
    this.gun = gun;

    // ---- receiver / body ----
    add(gun, rounded(0.105, 0.11, 0.30, this.matSteel, 0.012, 2), 0, 0.005, -0.01);
    add(gun, rounded(0.096, 0.064, 0.31, this.matSteelDark, 0.014, 2), 0, 0.081, -0.015);
    add(gun, rounded(0.084, 0.072, 0.22, this.matBlack, 0.01, 2), 0, -0.048, 0.035);
    // ejection port
    add(gun, box(0.012, 0.034, 0.085, this.matBlack), 0.051, 0.055, -0.01);
    const bolt = add(gun, box(0.010, 0.026, 0.06, this.matSteel), 0.055, 0.062, -0.005);
    this.bolt = bolt;
    add(gun, rounded(0.024, 0.022, 0.038, this.matSteelDark, 0.004, 2), 0.058, 0.084, 0.035);
    // safety / selector
    add(gun, cyl(0.012, 0.012, 0.008, this.matAccent, 16), 0.058, 0.018, 0.058, 0, 0, Math.PI / 2);
    // warning band near receiver
    add(gun, box(0.104, 0.008, 0.102, this.matAccent), 0, 0.0, -0.12);

    // ---- full-length top rail ----
    const railCount = 15;
    const railGeo = new RoundedBoxGeometry(0.046, 0.018, 0.031, 1, 0.003);
    for (let i = 0; i < railCount; i++) {
      const m = new THREE.Mesh(railGeo, this.matSteelDark);
      add(gun, m, 0, 0.132, 0.075 - i * 0.039);
    }
    add(gun, box(0.052, 0.01, 0.56, this.matBlack), 0, 0.12, -0.19);

    // ---- handguard ----
    const hg = add(gun, rounded(0.084, 0.082, 0.30, this.matPolymer, 0.016, 2), 0, 0.012, -0.34);
    hg.rotation.z = 0.0;
    // rail segments under handguard
    add(gun, box(0.05, 0.01, 0.28, this.matBlack), 0, 0.059, -0.35);
    // vent slots (recessed dark) both sides + bottom
    for (let i = 0; i < 5; i++) {
      add(gun, box(0.004, 0.016, 0.032, this.matBlack), 0.043, 0.01, -0.25 - i * 0.05, 0, 0, 0.0);
      add(gun, box(0.004, 0.016, 0.032, this.matBlack), -0.043, 0.01, -0.25 - i * 0.05, 0, 0, 0.0);
      add(gun, box(0.022, 0.004, 0.034, this.matBlack), 0, -0.032, -0.25 - i * 0.05);
    }
    // side rail (M-LOK / picatinny accent)
    for (let i = 0; i < 4; i++) {
      add(gun, box(0.008, 0.012, 0.032, this.matAccent), 0.045, -0.01, -0.27 - i * 0.06);
    }
    // hand stop
    add(gun, rounded(0.022, 0.052, 0.03, this.matBlack, 0.006, 2), 0, -0.052, -0.43, -0.2);
    // gas block
    add(gun, rounded(0.048, 0.052, 0.06, this.matSteelDark, 0.006, 2), 0, 0.042, -0.53);
    // barrel
    const barrel = cyl(0.015, 0.018, 0.30, this.matBlack, 18);
    add(gun, barrel, 0, 0.03, -0.67, Math.PI / 2);
    // muzzle brake
    const brake = rounded(0.036, 0.036, 0.085, this.matSteel, 0.008, 2);
    add(gun, brake, 0, 0.03, -0.845);
    for (let i = 0; i < 3; i++) {
      add(gun, box(0.038, 0.007, 0.012, this.matBlack), 0, 0.03 + 0.009, -0.83 - i * 0.018);
    }
    add(gun, cyl(0.011, 0.013, 0.012, this.matBlack, 16), 0, 0.03, -0.89, Math.PI / 2);
    // front sight folded
    add(gun, box(0.02, 0.036, 0.02, this.matSteelDark), 0, 0.085, -0.53);
    add(gun, box(0.008, 0.018, 0.006, this.matSteel), 0, 0.105, -0.53);

    // ---- optic (open-hood holographic sight, deliberately skeletal) ----
    const optic = new THREE.Group();
    // sits directly on the top rail (rail top = 0.141) so it never looks like it
    // is floating above the receiver
    optic.position.set(0, 0.142, -0.005);
    gun.add(optic);
    // clamp block straddling the picatinny rail + cross bolt
    add(optic, rounded(0.064, 0.030, 0.086, this.matSteelDark, 0.006, 2), 0, -0.004, 0.002);
    add(optic, cyl(0.009, 0.009, 0.072, this.matSteel, 10), 0, -0.012, 0.0, 0, 0, Math.PI / 2);
    add(optic, box(0.016, 0.020, 0.024, this.matBlack), 0.040, -0.008, 0.018);
    // mount + body
    add(optic, rounded(0.060, 0.014, 0.092, this.matSteelDark, 0.004, 2), 0, 0.014, 0);
    add(optic, rounded(0.056, 0.020, 0.088, this.matBlack, 0.005, 2), 0, 0.030, 0.004);
    add(optic, rounded(0.050, 0.012, 0.072, this.matSteelDark, 0.004, 2), 0, 0.045, 0.004);
    // four slim uprights + open top hood, so the sand world stays visible through it
    for (const z of [-0.035, 0.035]) {
      add(optic, rounded(0.006, 0.052, 0.007, this.matSteelDark, 0.002, 1), -0.027, 0.072, z);
      add(optic, rounded(0.006, 0.052, 0.007, this.matSteelDark, 0.002, 1), 0.027, 0.072, z);
    }
    add(optic, rounded(0.064, 0.009, 0.086, this.matSteelDark, 0.003, 2), 0, 0.099, 0.0);
    add(optic, box(0.052, 0.003, 0.07, this.matSteel), 0, 0.105, 0.0);
    // glass + tiny bright holographic reticle
    const lens = add(optic, new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.045), this.matGlass), 0, 0.072, 0.048);
    lens.renderOrder = 2;
    this.reticle = add(optic, new THREE.Mesh(
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
    this.sightLocal = new THREE.Vector3(0, 0.142 + 0.072, -0.005 + 0.05);
    // adjustment knob, battery cap, qd lever
    add(optic, cyl(0.007, 0.007, 0.012, this.matSteel, 12), 0.032, 0.052, 0.0, 0, 0, Math.PI / 2);
    add(optic, cyl(0.006, 0.006, 0.009, this.matSteelDark, 12), 0, 0.034, 0.04);
    add(optic, box(0.014, 0.008, 0.026, this.matAccent), 0.038, 0.022, 0.0, 0, 0, 0.1);

    // ---- charging handle & bolt release ----
    const charge = new THREE.Group();
    charge.position.set(0, 0.105, 0.145);
    gun.add(charge);
    add(charge, box(0.045, 0.012, 0.018, this.matSteel), 0, 0, 0);
    add(charge, box(0.012, 0.018, 0.016, this.matSteelDark), -0.023, 0, 0.002);
    this.charging = charge;

    // ---- magazine ----
    const magGroup = new THREE.Group();
    magGroup.position.set(0, -0.096, 0.035);
    magGroup.rotation.x = -0.12;
    gun.add(magGroup);
    const magMesh = add(magGroup, rounded(0.062, 0.155, 0.095, this.matPolymer, 0.01, 2), 0, -0.07, 0.02);
    magMesh.rotation.x = -0.13;
    add(magGroup, rounded(0.068, 0.016, 0.10, this.matBlack, 0.005, 2), 0, -0.148, 0.03, -0.13);
    // witness strip of rounds
    for (let i = 0; i < 3; i++) {
      add(magGroup, cyl(0.005, 0.005, 0.056, this.matBrass, 10), 0, -0.02 - i * 0.018, 0.038, Math.PI / 2);
    }
    this.magazine = magGroup;

    // ---- spare magazine (reload animation) ----
    const spare = new THREE.Group();
    const spareMesh = add(spare, rounded(0.062, 0.155, 0.095, this.matPolymer, 0.01, 2), 0, -0.07, 0.02);
    spareMesh.rotation.x = -0.13;
    add(spare, rounded(0.068, 0.016, 0.10, this.matBlack, 0.005, 2), 0, -0.148, 0.03, -0.13);
    spare.visible = false;
    gun.add(spare);
    this.spareMagazine = spare;

    // ---- pistol grip / trigger guard / trigger ----
    add(gun, rounded(0.056, 0.16, 0.075, this.matPolymer, 0.012, 2), 0, -0.115, 0.13, 0.21);
    add(gun, box(0.045, 0.012, 0.16, this.matBlack), 0, -0.074, 0.06, 0.08);
    add(gun, rounded(0.038, 0.008, 0.12, this.matBlack, 0.004, 2), 0, -0.098, 0.105);
    this.trigger = add(gun, box(0.008, 0.032, 0.012, this.matSteelDark), 0, -0.087, 0.085, 0.2);
    // grip texture panels
    add(gun, box(0.005, 0.085, 0.06, this.matRubber), 0.03, -0.12, 0.14, 0.21);
    add(gun, box(0.005, 0.085, 0.06, this.matRubber), -0.03, -0.12, 0.14, 0.21);

    // ---- rear receiver cap (stock/butt is behind the camera and never shown,
    // which keeps the viewmodel silhouette clean) ----
    add(gun, rounded(0.085, 0.09, 0.02, this.matSteelDark, 0.006, 2), 0, 0.012, 0.152);
    add(gun, box(0.052, 0.016, 0.012, this.matBlack), 0, 0.062, 0.158);
    add(gun, cyl(0.012, 0.012, 0.014, this.matBrass, 12), 0.03, -0.02, 0.16, 0, 0, Math.PI / 2);
    // qd sling point on the left rear of the receiver
    add(gun, new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.003, 6, 12), this.matSteelDark), -0.052, -0.02, 0.155, 0, Math.PI / 2);

    // ---- rail light / laser module ----
    const lightMod = new THREE.Group();
    lightMod.position.set(0, -0.015, -0.32);
    gun.add(lightMod);
    add(lightMod, rounded(0.045, 0.034, 0.09, this.matBlack, 0.006, 2), 0.052, 0.0, 0);
    add(lightMod, cyl(0.012, 0.012, 0.015, this.matSteelDark, 14), 0.052, 0.0, -0.052, Math.PI / 2);
    add(lightMod, cyl(0.008, 0.008, 0.006, new THREE.MeshBasicMaterial({ color: 0x8fe8ff }), 14), 0.052, 0.0, -0.061, Math.PI / 2);
    // cable
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.052, -0.016, -0.27),
      new THREE.Vector3(0.06, -0.06, -0.20),
      new THREE.Vector3(0.035, -0.07, -0.10),
    ]);
    add(gun, new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.0035, 5), this.matRubber));

    // sling omitted from the viewmodel: a loose strap this close to the camera
    // reads as a floating stick and breaks the silhouette.

    // ---- markings / side plates ----
    const labelMat = new THREE.MeshBasicMaterial({
      map: makeLabelTexture(), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.92,
    });
    const label = add(gun, new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.033), labelMat), -0.0545, 0.008, 0.026, 0, -Math.PI / 2);
    label.renderOrder = 3;
    // recessed receiver side plate breaks up the silhouette and catches rim light
    add(gun, rounded(0.006, 0.072, 0.19, this.matSteelDark, 0.002, 1), -0.052, 0.002, -0.015);
    for (let i = 0; i < 3; i++) {
      add(gun, cyl(0.006, 0.006, 0.005, this.matSteel, 10), -0.056, 0.031, -0.085 + i * 0.062, 0, 0, Math.PI / 2);
      add(gun, cyl(0.0045, 0.0045, 0.004, this.matSteel, 10), -0.056, -0.028, -0.06 + i * 0.062, 0, 0, Math.PI / 2);
    }
    // ambi selector + glowing status bar + low-profile QD point
    add(gun, cyl(0.011, 0.011, 0.009, this.matAccent, 14), -0.058, -0.04, 0.075, 0, 0, Math.PI / 2);
    const statusMat = new THREE.MeshBasicMaterial({ color: 0x73e6ff, toneMapped: false });
    add(gun, new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.028), statusMat), -0.0575, 0.034, 0.078, 0, -Math.PI / 2);
    add(gun, new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0028, 6, 14), this.matSteelDark), -0.062, -0.005, 0.17, 0, Math.PI / 2);
    // stencilled warning stripe on the upper receiver
    add(gun, box(0.006, 0.014, 0.036, this.matAccent), -0.052, 0.052, 0.13, 0, 0, 0.06);
    // long accent rail + fire-mode pictogram break up the black slab
    add(gun, box(0.003, 0.006, 0.12, this.matAccent), -0.053, -0.008, 0.09);
    const modeTex = makeLabelTexture('SEMI // AUTO', '07-421');
    add(gun, new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.021),
      new THREE.MeshBasicMaterial({ map: modeTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.55 })),
      -0.054, 0.038, 0.075, 0, -Math.PI / 2);
    // small hex bolts around the side plate
    for (let i = 0; i < 4; i++) {
      add(gun, cyl(0.0045, 0.0045, 0.004, this.matSteel, 6), -0.0555, -0.045 + (i % 2) * 0.078, -0.02 + Math.floor(i / 2) * 0.055, 0, 0, Math.PI / 2);
    }
    // small serial plate on right side
    const serialTex = makeLabelTexture('SN 07-421', 'VXR // 5.56×45');
    const serialMat = new THREE.MeshBasicMaterial({ map: serialTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.62 });
    add(gun, new THREE.Mesh(new THREE.PlaneGeometry(0.10, 0.024), serialMat), 0.0535, -0.035, 0.06, 0, Math.PI / 2, 0);

    // ---- hands / arms ----
    this._buildHands(gun);

    // ---- muzzle flash assembly ----
    const flashGroup = new THREE.Group();
    flashGroup.position.set(0, 0.03, -0.92);
    gun.add(flashGroup);
    const flashTex = makeFlashTexture();
    this.flashMats = [];
    // Sprite-based flash: always camera-facing, additive (a black texel adds
    // nothing), and deliberately small so it can never fill the screen.
    const flashSpriteMat = new THREE.SpriteMaterial({
      map: flashTex, color: 0xffb45a, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, toneMapped: false, opacity: 0,
    });
    this.flashMats.push(flashSpriteMat);
    const flashSprite = new THREE.Sprite(flashSpriteMat);
    flashSprite.scale.set(0.26, 0.26, 1);
    flashSprite.renderOrder = 5;
    flashSprite.frustumCulled = false;
    flashGroup.add(flashSprite);
    const coreMat = new THREE.SpriteMaterial({
      map: flashTex, color: 0xfff0c0, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, toneMapped: false, opacity: 0,
    });
    this.flashMats.push(coreMat);
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
    this.flashMats.push(coneMat);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.14, 8, 1, true), coneMat);
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = -0.07;
    cone.renderOrder = 5;
    flashGroup.add(cone);
    this.flashGroup = flashGroup;
    this.muzzleLocal = new THREE.Vector3(0, 0.03, -0.95);    this.muzzleLight.position.set(0, 0, -0.02);
    flashGroup.add(this.muzzleLight);

    // No square smoke cards in the viewmodel: they can catch a bad blend state
    // on some GPUs and read as a black panel. World-space smoke covers the mood.
    this.smokePuffs = [];

    this._setHipTransform(0);
  }

  _buildHands(gun) {
    const glove = this.matGlove;
    const dark = this.matGloveDark;
    const sleeve = this.matSleeve;
    const palmMat = this.matGlovePalm;


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
    add(right, box(0.012, 0.014, 0.012, this.matAccent), 0.016, -0.008, 0.020, 0.1);
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
    // (no wrist tubes: a cylinder pointing at the camera reads as a dark peg)

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
    // four fingers curling up and over the top of the handguard
    for (let i = 0; i < 4; i++) {
      const z = -0.052 + i * 0.021;
      chain(left, [
        new THREE.Vector3(0.006, 0.026, z),
        new THREE.Vector3(0.022, 0.050, z - 0.002),
        new THREE.Vector3(0.048, 0.060, z - 0.004),
        new THREE.Vector3(0.070, 0.050, z - 0.006),
      ], 0.0092 - i * 0.0004, glove);
      // knuckle pad on the back of the finger, facing the camera
      add(left, rounded(0.013, 0.012, 0.014, dark, 0.004, 1),
        0.028, 0.062, z - 0.002, 0.1, 0, -0.2);
    }
    // thumb along the left flank, pointing toward the muzzle
    chain(left, [
      new THREE.Vector3(-0.012, 0.010, -0.026),
      new THREE.Vector3(-0.010, 0.016, -0.054),
      new THREE.Vector3(-0.002, 0.018, -0.078),
    ], 0.0106, glove);
    // (wrist tubes removed — they read as pegs poking into frame)
  }

  _bindInput() {
    this._onMouseDown = (event) => {
      if (!this.active || this.touchMode) return;
      const locked = document.pointerLockElement === this.canvas;
      if (!locked && event.target !== this.canvas) return;
      if (event.button === 0) {
        this.triggerDown = true;
        this.tryFire();
      } else if (event.button === 2) {
        this.aiming = true;
        event.preventDefault();
      }
    };
    this._onMouseUp = (event) => {
      if (this.touchMode) return;
      if (event.button === 0) this.triggerDown = false;
      if (event.button === 2) this.aiming = false;
    };
    this._onKeyDown = (event) => {
      if (!this.active) return;
      if (event.code === 'KeyR' && !event.repeat) this.startReload();
    };
    this._onContextMenu = (event) => {
      if (this.active) event.preventDefault();
    };
    this._onBlur = () => {
      this.triggerDown = false;
      this.aiming = false;
    };
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('blur', this._onBlur);
  }

  setActive(active) {
    this.active = active;
    this.triggerDown = false;
    this.aiming = false;
    this.player.aiming = false;
    if (!active) {
      this.flashMats?.forEach((m) => { m.opacity = 0; });
      if (this.muzzleLight) this.muzzleLight.intensity = 0;
    }
  }

  /** Virtual (touch) trigger: press fires immediately, release stops automatic fire. */
  setTrigger(down) {
    const pressed = !!down;
    if (pressed === this.triggerDown) return;
    this.triggerDown = pressed;
    if (pressed) this.tryFire();
  }

  /** Virtual (touch) aim-down-sights, same field the right mouse button drives. */
  setAiming(aiming) {
    this.aiming = !!aiming;
    if (!this.aiming) this.player.aiming = false;
  }

  /** Touch mode: mouse button input belongs to the touch layer. */
  setTouchMode(enabled = true) {
    this.touchMode = !!enabled;
    if (this.touchMode) {
      this.triggerDown = false;
      this.aiming = false;
    }
  }

  reset() {
    this.mag = this.magSize;
    this.reserve = W.reserveStart;
    this.reloading = false;
    this.reloadTime = 0;
    this.triggerDown = false;
    this.aiming = false;
    this.ads = 0;
    this.fireCooldown = 0;
    this.spreadBloom = 0;
    this.recoil = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.lastFireTime = -999;
    this._prevYaw = this.player.yaw;
    this._prevPitch = this.player.pitch;
    this._reloadPlayed.clear();
    this.spareMagazine.visible = false;
    this.magazine.position.set(0, -0.096, 0.035);
    this.magazine.rotation.set(-0.12, 0, 0);
    this.flashMats.forEach((m) => { m.opacity = 0; });
    this._setHipTransform(0);
  }

  addAmmo(amount) {
    this.reserve = Math.min(this.reserveMax, this.reserve + amount);
  }

  /** Loot: extend the magazine (and load the extra rounds immediately). */
  addMagCapacity(amount) {
    const gain = Math.max(1, Math.round(amount));
    this.magSize = Math.min(120, this.magSize + gain);
    this.mag = Math.min(this.magSize, this.mag + gain);
    this.reserve = Math.max(this.reserve, Math.min(this.reserveMax, this.reserve));
    this.magExtension += gain;
    return this.magSize;
  }

  /** Loot: multiplicative damage growth (5% per pickup by default). */
  addDamageBoost(fraction) {
    const gain = Math.max(0.01, fraction);
    this.damageMultiplier = Math.min(4, this.damageMultiplier * (1 + gain));
    return this.damageMultiplier;
  }

  /** Loot: faster reloads (12% shorter per pickup, hard floor at 0.55 s). */
  addReloadSpeed(fraction) {
    const gain = clamp(fraction, 0.01, 0.6);
    this.reloadSpeedMul = Math.max(0.35, this.reloadSpeedMul * (1 - gain));
    this.reloadDuration = Math.max(0.55, W.reloadTime * this.reloadSpeedMul);
    return this.reloadDuration;
  }

  /** Hardcore difficulty: strip every pickup upgrade back to the base rifle. */
  resetUpgrades() {
    this.magSize = W.magSize;
    this.mag = Math.min(this.mag, this.magSize);
    this.damageMultiplier = 1;
    this.magExtension = 0;
    this.reloadSpeedMul = 1;
    this.reloadDuration = W.reloadTime;
  }

  /** Snapshot of everything the loot system can add (for death persistence). */
  exportUpgrades() {
    return {
      magExtension: this.magExtension,
      damageMultiplier: this.damageMultiplier,
      reloadSpeedMul: this.reloadSpeedMul,
    };
  }

  /** Re-apply a previously captured upgrade snapshot. */
  importUpgrades(data) {
    if (!data) return;
    const mag = clamp(Math.round(Number(data.magExtension) || 0), 0, 90);
    this.magExtension = mag;
    this.magSize = Math.min(120, W.magSize + mag);
    this.mag = Math.min(this.magSize, this.mag + mag);
    this.damageMultiplier = clamp(Number(data.damageMultiplier) || 1, 1, 4);
    this.reloadSpeedMul = clamp(Number(data.reloadSpeedMul) || 1, 0.35, 1);
    this.reloadDuration = Math.max(0.55, W.reloadTime * this.reloadSpeedMul);
  }

  startReload() {
    if (!this.active || this.reloading || this.mag >= this.magSize || this.reserve <= 0) {
      if (this.reserve <= 0 && this.mag <= 0) emit('weapon:notice', { text: '弹药耗尽 — 等待补给', type: 'warn' });
      return;
    }
    this.reloading = true;
    this.reloadTime = 0;
    this._reloadPlayed.clear();
    this.aiming = false;
    this.triggerDown = false;
    this.audio?.reloadStart?.();
  }

  _finishReload() {
    const need = this.magSize - this.mag;
    const take = Math.min(need, this.reserve);
    this.mag += take;
    this.reserve -= take;
    this.reloading = false;
    this.reloadTime = 0;
    this.spareMagazine.visible = false;
    this.magazine.position.set(0, -0.096, 0.035);
    this.magazine.rotation.set(-0.12, 0, 0);
  }

  tryFire() {
    if (!this.active || this.reloading || !this.player.alive) return false;
    if (this.fireCooldown > 0) return false;
    if (this.mag <= 0) {
      this.audio?.dryFire?.();
      this.startReload();
      return false;
    }
    this.fireCooldown = this.fireInterval;
    this.mag--;
    this.shotsFired++;
    this.lastFireTime = this.time;
    this._boltKick = 1;
    this.trigger.rotation.x = -0.35;

    // aim ray with dynamic spread
    this.camera.updateMatrixWorld();
    const spread = this._currentSpread();
    const dir = this.camera.getWorldDirection(this._forward).clone();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const r = Math.sqrt(Math.random()) * spread;
    const angle = Math.random() * Math.PI * 2;
    dir.addScaledVector(right, Math.cos(angle) * r).addScaledVector(up, Math.sin(angle) * r).normalize();

    this.camera.getWorldPosition(this._origin);
    this._raycaster.set(this._origin, dir);
    this._raycaster.far = 280;

    const targets = [];
    if (this.world.collideMeshes) targets.push(...this.world.collideMeshes);
    if (this.enemies.raycastTargets) targets.push(...this.enemies.raycastTargets);
    const hits = this._raycaster.intersectObjects(targets, true);
    let hit = hits.length ? hits[0] : null;
    let hitEnemy = false;

    if (hit) {
      this._end.copy(hit.point);
      let node = hit.object;
      while (node && !node.userData?.robot && !node.userData?.enemy) node = node.parent;
      if (node) {
        hitEnemy = true;
        this.shotsHit++;
        const headshot = hit.object.userData?.zone === 'head' || node.userData?.zone === 'head';
        const baseDamage = W.damage * this.damageMultiplier
          * clamp(1.0 - (hit.distance / 280) * 0.18, 0.84, 1);
        // EnemyManager owns the 2x headshot multiplier, zone resolution, FX and audio.
        this.enemies.damage(hit.object, baseDamage, {
          point: hit.point, direction: dir, headshot, weapon: 'rifle',
        });
      } else {
        const surface = hit.object.userData?.surface || 'stone';
        let normal = dir.clone().negate();
        if (hit.face?.normal) {
          normal = hit.face.normal.clone()
            .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
            .normalize();
        }
        this.effects?.impact?.(hit.point, normal, {
          surface, scale: 0.9, direction: dir,
        });
        const dist = hit.distance;
        this.audio?.impact?.(surface, dist);
      }
    } else {
      this._end.copy(this._origin).addScaledVector(dir, 220);
    }

    // --- view-model & world feedback ---
    this._muzzleTimer = 0.055;
    const flashScale = rand(0.7, 1.2);
    this.flashGroup.scale.setScalar(flashScale);
    this.flashGroup.rotation.z = Math.random() * Math.PI;
    this.flashMats.forEach((m, i) => { m.opacity = i === 2 ? 0.95 : rand(0.6, 1.0); });
    this.muzzleLight.intensity = 18;

    this.spreadBloom = clamp(this.spreadBloom + 0.011 + (this.ads > 0.5 ? 0.003 : 0), 0, W.spreadMax * 1.6);
    this.recoil = clamp(this.recoil + 1, 0, 1.6);
    this.player.addRecoil(W.recoil.pitch * rand(0.75, 1.25), W.recoil.yaw * rand(-1, 1));
    this.player.addShake(0.16);
    this.audio?.shot?.();

    // world-space muzzle position: derived from the actual viewmodel muzzle so
    // the tracer visibly leaves the barrel instead of a point floating in front
    // of the camera.
    this.camera.updateMatrixWorld();
    this.gun.updateWorldMatrix(true, false);
    this.flashGroup.getWorldPosition(this._muzzleView);
    this._viewmodelToWorld(this._muzzleView, this._muzzleWorld);
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const camUp = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);

    this.effects?.tracer?.(this._muzzleWorld, this._end, { color: 0xffd58a, width: 0.028 });
    // No world-space muzzle-flash billboard: the dedicated viewmodel flash is
    // already at the muzzle, and a 3D flash 0.7 m from the camera reads as a
    // giant screen-filling polygon for a few frames.
    // Ejection port sits behind the muzzle on the right of the receiver.
    this.gun.localToWorld(this._ejectView.set(0.062, 0.055, 0.0));
    this._viewmodelToWorld(this._ejectView, this._ejectWorld);
    const eject = this._ejectWorld;
    // Spread the ejection so a burst leaves a fan of brass instead of a single
    // clump: randomise speed, roll around the ejection axis and add jitter.
    const roll = rand(-0.5, 0.5);
    const ejectVel = camRight.clone().multiplyScalar(rand(1.3, 3.4))
      .add(camUp.clone().multiplyScalar(rand(1.1, 2.7)))
      .add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(rand(-1.1, -0.2)))
      .add(new THREE.Vector3(rand(-1.1, 1.1), rand(-0.5, 0.9), rand(-1.1, 1.1)))
      .applyAxisAngle(this.camera.getWorldDirection(new THREE.Vector3()), roll);
    this.effects?.shellCasing?.(eject, ejectVel, { scale: 0.8 });

    // smoke
    const puff = this.smokePuffs.find((p) => p.life <= 0);
    if (puff) {
      puff.life = 0.7;
      puff.mesh.visible = true;
      puff.mesh.position.copy(this.muzzleLocal).add(new THREE.Vector3(rand(-0.01, 0.01), rand(0, 0.02), 0.02));
      puff.mesh.material.opacity = 0.22;
      puff.mesh.scale.setScalar(rand(0.6, 1.0));
      puff.velocity.set(rand(-0.03, 0.03), rand(0.06, 0.14), rand(0.02, 0.08));
    }

    // shell casing glow in viewmodel (a tiny brass quip; effects owns the real casing)
    emit('weapon:fired', { mag: this.mag, reserve: this.reserve });
    return true;
  }

  /**
   * Convert a point in viewmodel space (viewCamera at origin, -Z forward) into
   * a world point that lands on the same screen pixel through the main camera.
   * The two cameras share a transform but not a FOV, so a plain world transform
   * would make tracers drift away from the barrel.
   */
  _viewmodelToWorld(viewPoint, out) {
    const depth = Math.max(0.35, -viewPoint.z);
    this._muzzleNdc.copy(viewPoint).project(this.viewCamera);
    out.set(this._muzzleNdc.x, this._muzzleNdc.y, 0.5).unproject(this.camera);
    out.sub(this.camera.position).normalize().multiplyScalar(depth).add(this.camera.position);
    return out;
  }

  _currentSpread() {
    const ads = this.ads;
    const moveFactor = clamp(this.player.speed / CONFIG.player.sprintSpeed, 0, 1);
    let spread = W.spreadHip * (1 - ads) + W.spreadAds * ads;
    spread += W.spreadMove * moveFactor * (1 - ads * 0.55);
    spread += this.spreadBloom;
    if (!this.player.grounded) spread += 0.02;
    if (this.player.crouching) spread *= 0.82;
    return spread;
  }

  update(dt) {
    this.time += dt;
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (!this.active) {
      this._updateSmoke(dt);
      return;
    }

    this._sprintBlend = damp(this._sprintBlend, this.player.sprinting && !this.aiming ? 1 : 0, 9, dt);
    const targetAds = this.aiming && !this.reloading && !this.player.sprinting ? 1 : 0;
    this.ads = damp(this.ads, targetAds, 13, dt);
    this.player.aiming = targetAds > 0.35;
    this.player.speedMultiplier = 1 - 0.35 * this.ads;

    this.recoil = damp(this.recoil, 0, 13, dt);
    this.spreadBloom = damp(this.spreadBloom, 0, 4.2, dt);
    this._boltKick = damp(this._boltKick, 0, 15, dt);

    // automatic fire
    if (this.triggerDown && this.fireCooldown <= 0 && !this.reloading) {
      if (this.mag > 0) this.tryFire();
      else if (this.reserve > 0) this.startReload();
    }

    // reload sequence
    if (this.reloading) {
      this.reloadTime += dt;
      const t = this.reloadTime;
      if (t > 0.28 && !this._reloadPlayed.has('out')) {
        this._reloadPlayed.add('out');
        this.audio?.reloadMagIn?.();
      }
      if (t > 0.86 && !this._reloadPlayed.has('in')) {
        this._reloadPlayed.add('in');
        this.audio?.reloadMagIn?.();
        this.spareMagazine.visible = true;
      }
      if (t > 1.48 && !this._reloadPlayed.has('bolt')) {
        this._reloadPlayed.add('bolt');
        this.audio?.reloadBolt?.();
      }
      if (t >= this.reloadDuration) this._finishReload();
    }

    // muzzle flash decay
    if (this._muzzleTimer > 0) {
      this._muzzleTimer -= dt;
      const fade = clamp(this._muzzleTimer / 0.055, 0, 1);
      this.flashMats?.forEach((m) => { m.opacity *= fade * 0.85; });
      if (this.muzzleLight) this.muzzleLight.intensity = 18 * fade;
      if (this._muzzleTimer <= 0) {
        this.flashMats?.forEach((m) => { m.opacity = 0; });
        if (this.muzzleLight) this.muzzleLight.intensity = 0;
      }
    }

    this._updateSmoke(dt);

    // sway from look delta
    const dyaw = this.player.yaw - this._prevYaw;
    const dpitch = this.player.pitch - this._prevPitch;
    this._prevYaw = this.player.yaw;
    this._prevPitch = this.player.pitch;
    const swayTargetX = clamp(dyaw * 3.2, -0.05, 0.05);
    const swayTargetY = clamp(-dpitch * 3.2, -0.05, 0.05);
    this._swayX = damp(this._swayX, swayTargetX, 10, dt);
    this._swayY = damp(this._swayY, swayTargetY, 10, dt);

    this._updateTransform(dt);

    this.reticle.material.opacity = this.ads > 0.5 ? 0.95 : 0;
    const timeSinceShot = this.time - this.lastFireTime;
    if (timeSinceShot > 0.25) this.spreadBloom = damp(this.spreadBloom, 0, 8, dt);
    this._updateReloadAnimation(dt);
  }

  _updateSmoke(dt) {
    for (const puff of this.smokePuffs) {
      if (puff.life > 0) {
        puff.life -= dt;
        puff.mesh.position.add(puff.velocity);
        puff.velocity.x *= 0.97;
        puff.velocity.z *= 0.97;
        puff.mesh.material.opacity = Math.max(0, puff.life / 0.7) * 0.2;
        puff.mesh.scale.multiplyScalar(1 + dt * 1.8);
        if (puff.life <= 0) puff.mesh.visible = false;
      }
    }
  }

  _updateReloadAnimation(dt) {
    if (!this.reloading) {
      this.magazine.position.y = damp(this.magazine.position.y, -0.096, 20, dt);
      this.magazine.position.x = damp(this.magazine.position.x, 0, 20, dt);
      this.magazine.rotation.x = damp(this.magazine.rotation.x, -0.12, 20, dt);
      this.charging.position.z = damp(this.charging.position.z, 0.145, 18, dt);
      this.trigger.rotation.x = damp(this.trigger.rotation.x, 0, 14, dt);
      return;
    }
    const t = clamp(this.reloadTime / this.reloadDuration, 0, 1);
    // main mag drops away around 0.2-0.45, spare comes up
    if (t < 0.18) {
      this.magazine.position.y = -0.096;
    } else if (t < 0.48) {
      const p = (t - 0.18) / 0.3;
      this.magazine.position.y = -0.096 - p * 0.28;
      this.magazine.rotation.x = -0.12 - p * 0.5;
    } else if (t < 0.62) {
      this.magazine.position.y = -0.35;
    } else {
      const p = clamp((t - 0.62) / 0.24, 0, 1);
      this.magazine.position.y = -0.35 + p * 0.254;
      this.magazine.rotation.x = -0.62 + p * 0.5;
    }

    if (t > 0.5 && t < 0.88) {
      const p = (t - 0.5) / 0.38;
      this.spareMagazine.visible = true;
      this.spareMagazine.position.set(0.08 * (1 - p), -0.36 + p * 0.27, 0.04 + p * 0.02);
      this.spareMagazine.rotation.set(-0.12, 0, -0.3 * (1 - p));
    } else {
      this.spareMagazine.visible = false;
    }

    // charging handle pull near end
    if (t > 0.72) {
      const p = Math.sin(clamp((t - 0.72) / 0.24, 0, 1) * Math.PI);
      this.charging.position.z = 0.145 + p * 0.075;
    } else {
      this.charging.position.z = 0.145;
    }
  }

  _setHipTransform(dt) {
    const swayX = this._swayX || 0;
    const swayY = this._swayY || 0;
    const bob = this.player.walkPhase || 0;
    const speed = clamp((this.player.speed || 0) / CONFIG.player.walkSpeed, 0, 1.4);
    const bobX = Math.cos(bob) * 0.012 * speed;
    const bobY = -Math.abs(Math.sin(bob)) * 0.012 * speed;
    const breathe = Math.sin(this.time * 1.6) * 0.0025;
    const sprint = this._sprintBlend;
    this.gunRoot.position.set(
      0.166 + bobX + swayX * 0.8 + sprint * 0.04,
      -0.124 + bobY + swayY * 0.7 + breathe - sprint * 0.09,
      -0.640 + sprint * 0.05 - this.recoil * 0.035
    );
    this.gunRoot.rotation.set(
      -this.recoil * 0.055 + sprint * 0.18 + swayY * 0.4,
      -0.045 + swayX * 0.6 + sprint * 0.22,
      -0.02 + swayX * 0.8 + sprint * 0.18 + Math.cos(bob) * 0.012 * speed
    );
  }

  _updateTransform(dt) {
    const ads = this.ads;
    const sprint = this._sprintBlend;
    const bob = this.player.walkPhase || 0;
    const speed = clamp((this.player.speed || 0) / CONFIG.player.walkSpeed, 0, 1.4);
    const hipX = 0.166 + Math.cos(bob) * 0.012 * speed;
    const hipY = -0.124 - Math.abs(Math.sin(bob)) * 0.012 * speed;
    const hipZ = -0.640;
    // ADS: solve the pose so the holographic reticle projects to screen centre.
    const gunScale = this.gun ? this.gun.scale.x : 0.8;
    const sight = this.sightLocal || { x: 0, y: 0.219 };
    const adsX = -sight.x * gunScale;
    const adsY = -sight.y * gunScale;
    const adsZ = -0.52;
    const breathe = Math.sin(this.time * 1.6) * 0.0025 * (1 - ads * 0.7);
    const reloadPose = this.reloading ? Math.sin(clamp(this.reloadTime / this.reloadDuration, 0, 1) * Math.PI) : 0;
    const stance = 1 - ads;
    // Sway is damped hard while aiming so the dot stays glued to the crosshair.
    const sway = 1 - ads * 0.92;

    this.gunRoot.position.set(
      hipX * stance + adsX * ads + this._swayX * 0.8 * sway + sprint * 0.04,
      (hipY + breathe) * stance + adsY * ads - this.recoil * 0.02 * stance + this._swayY * 0.7 * sway - sprint * 0.09 - reloadPose * 0.05,
      hipZ + (adsZ - hipZ) * ads - this.recoil * 0.04 + sprint * 0.05 + reloadPose * 0.01
    );
    this.gunRoot.rotation.set(
      (-this.recoil * 0.055) * stance + this._swayY * 0.4 * sway + sprint * 0.18 + reloadPose * 0.16,
      (0.060 + this._swayX * 0.6) * stance + sprint * 0.22 - reloadPose * 0.22,
      (-0.02 + this._swayX * 0.8) * stance + sprint * 0.18 + reloadPose * 0.3
    );

    // ---- weapon convergence ------------------------------------------------
    // Hip fire leaves the gun visibly angled while the hitscan goes dead centre,
    // which reads as "the bullet does not leave the barrel". Rotate the whole
    // viewmodel so the barrel axis points at the crosshair (blended out while
    // aiming, where the optic must stay perfectly centred).
    if (stance > 0.001 && !this.reloading) {
      const gunScale = this.gun ? this.gun.scale.x : 0.62;
      _convQuat.setFromEuler(this.gunRoot.rotation);
      _muzzleOff.set(0, 0.03, -0.92).multiplyScalar(gunScale).applyQuaternion(_convQuat).add(this.gunRoot.position);
      _barrelDir.set(0, 0, -1).applyQuaternion(_convQuat);
      _aimPoint.set(0, 0, -45).sub(_muzzleOff).normalize();
      let dYaw = Math.atan2(-_aimPoint.x, -_aimPoint.z) - Math.atan2(-_barrelDir.x, -_barrelDir.z);
      if (dYaw > Math.PI) dYaw -= Math.PI * 2;
      if (dYaw < -Math.PI) dYaw += Math.PI * 2;
      let dPitch = Math.asin(clamp(_aimPoint.y, -1, 1)) - Math.asin(clamp(_barrelDir.y, -1, 1));
      // keep the correction subtle so extreme pitches don't twist the viewmodel
      dYaw = clamp(dYaw, -0.14, 0.14);
      dPitch = clamp(dPitch, -0.10, 0.10);
      this.gunRoot.rotation.y += dYaw * stance;
      this.gunRoot.rotation.x += dPitch * stance;
    }
    this.viewCamera.fov = damp(this.viewCamera.fov, ads > 0.5 ? 42 : 54, 14, dt);
    this.viewCamera.updateProjectionMatrix();

    // bolt/trigger animation: recoil cycles the visible bolt
    const boltBack = Math.min(1, this._boltKick * 1.4);
    this.bolt.position.z = -0.005 + boltBack * 0.03;
    this.bolt.position.x = 0.055 + boltBack * 0.005;
  }

  getState() {
    return {
      weapon: 'VXR-7',
      mag: this.mag,
      magSize: this.magSize,
      reserve: this.reserve,
      reloading: this.reloading,
      reloadProgress: this.reloading ? clamp(this.reloadTime / this.reloadDuration, 0, 1) : 0,
      ads: this.ads > 0.5,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      damageMultiplier: this.damageMultiplier,
      magExtension: this.magExtension,
      reloadBonus: 1 - this.reloadSpeedMul,
      reloadTime: this.reloadDuration,
    };
  }

  setAspect(aspect) {
    this.viewCamera.aspect = aspect;
    this.viewCamera.updateProjectionMatrix();
  }

  render(renderer) {
    if (!this.active) return;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.clearDepth();
    renderer.render(this.viewScene, this.viewCamera);
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('blur', this._onBlur);
  }
}
