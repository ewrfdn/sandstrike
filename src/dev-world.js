import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/**
 * Development greybox fallback world. ONLY used with ?fallback=1 when src/world.js
 * is unavailable (e.g. during parallel build). The shipping game uses world.js.
 */
export async function createWorld(scene, renderer, { quality = 'high', onProgress } = {}) {
  const progress = (p, label) => onProgress?.(p, label);
  progress(0.1, 'DEV GREYBOX · 天空');
  await new Promise((r) => setTimeout(r, 0));

  scene.background = new THREE.Color(0xc69b72);
  scene.fog = new THREE.FogExp2(0xd6a877, 0.012);

  const sky = new Sky();
  sky.scale.setScalar(3000);
  scene.add(sky);
  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 6.2;
  skyUniforms.rayleigh.value = 1.35;
  skyUniforms.mieCoefficient.value = 0.004;
  skyUniforms.mieDirectionalG.value = 0.82;
  skyUniforms.sunPosition.value.set(-0.65, 0.18, -0.74).normalize();

  const sun = new THREE.DirectionalLight(0xffd3a0, 4.6);
  sun.position.set(-48, 34, -52);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 150;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffe0bd, 0x6b4c31, 1.2));

  const sandTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#b4834e';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 40000; i++) {
      const v = Math.random();
      ctx.fillStyle = `rgba(${40 + v * 120},${30 + v * 80},${10 + v * 50},${Math.random() * 0.2})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = `rgba(255,220,170,${Math.random() * 0.06})`;
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      const y = Math.random() * 512;
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(256, y + Math.sin(i) * 18, 512, y);
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(14, 14);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  })();

  const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, color: 0xffffff, roughness: 0.96, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), sandMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const adobeMat = new THREE.MeshStandardMaterial({ color: 0xbc8d5f, roughness: 0.92, metalness: 0 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8e765d, roughness: 0.86, metalness: 0.03 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x745133, roughness: 0.8, metalness: 0 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x49505a, roughness: 0.45, metalness: 0.75 });

  const collideMeshes = [ground];
  const collisionBoxes = [];
  const addSolid = (mesh, { w, h, d, x, y = 0, z, surface = 'stone', solid = true }) => {
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.surface = surface;
    scene.add(mesh);
    if (solid) {
      collideMeshes.push(mesh);
      collisionBoxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: y, maxY: y + h, surface });
    }
    return mesh;
  };
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

  // boundary walls
  addSolid(box(4, 9, 72, adobeMat), { w: 4, h: 9, d: 72, x: -34, z: 0, surface: 'stone' });
  addSolid(box(4, 9, 72, adobeMat), { w: 4, h: 9, d: 72, x: 34, z: 0, surface: 'stone' });
  addSolid(box(72, 9, 4, adobeMat), { w: 72, h: 9, d: 4, x: 0, z: 34, surface: 'stone' });
  addSolid(box(72, 9, 4, adobeMat), { w: 72, h: 9, d: 4, x: 0, z: -34, surface: 'stone' });

  // mid wall with a door gap
  addSolid(box(24, 4.8, 1.2, adobeMat), { w: 24, h: 4.8, d: 1.2, x: -18, z: -8, surface: 'stone' });
  addSolid(box(24, 4.8, 1.2, adobeMat), { w: 24, h: 4.8, d: 1.2, x: 18, z: -8, surface: 'stone' });
  addSolid(box(12, 2.2, 1.2, stoneMat), { w: 12, h: 2.2, d: 1.2, x: 0, z: -8, surface: 'stone' });

  // cover crates and barrels
  const covers = [
    [-10, 12, 2.4, 2.0, 2.4, 'wood'], [10, 9, 3.0, 2.6, 3.0, 'wood'],
    [-18, -18, 3.0, 3.0, 3.0, 'stone'], [18, -22, 4.0, 3.0, 4.0, 'wood'],
    [22, 2, 2.5, 3.5, 2.5, 'metal'], [-22, -2, 3.5, 3.0, 2.0, 'stone'],
    [0, 18, 3.0, 1.1, 3.0, 'sand'], [5, -18, 2.0, 2.2, 2.0, 'wood'],
    [-6, -22, 4.2, 4.0, 4.2, 'stone'], [15, 24, 3.0, 1.2, 3.0, 'wood'],
  ];
  for (const [x, z, w, h, d, surface] of covers) {
    const mat = surface === 'wood' ? woodMat : surface === 'metal' ? metalMat : stoneMat;
    addSolid(box(w, h, d, mat), { w, h, d, x, z, surface });
  }

  // simple adobe blockhouses with roofs
  for (const [x, z, w, d] of [[-23, -26, 12, 10], [23, -26, 12, 10], [24, 18, 9, 10]]) {
    addSolid(box(w, 4.6, d, adobeMat), { w, h: 4.6, d, x, z, surface: 'stone' });
    addSolid(box(w + 1.2, 0.45, d + 1.2, stoneMat), { w: w + 1.2, h: 0.45, d: d + 1.2, x, y: 4.6, z, surface: 'stone' });
  }

  // pylons / lights
  for (let i = 0; i < 6; i++) {
    const px = -22 + i * 9;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 8), metalMat);
    pole.position.set(px, 3, 29);
    pole.castShadow = true;
    scene.add(pole);
    const lamp = new THREE.PointLight(0xffb45a, 8, 12, 2);
    lamp.position.set(px, 5.8, 29);
    scene.add(lamp);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.5, 10, 1, true), metalMat);
    shade.position.set(px, 6.2, 29);
    shade.rotation.x = Math.PI;
    scene.add(shade);
  }

  const landmarks = [
    { x: 17, z: -24, name: 'A' }, { x: -18, z: -24, name: 'B' },
    { x: 0, z: 8, name: 'MID' }, { x: 0, z: 26, name: 'SPAWN' },
  ];
  const enemySpawns = [
    { x: 17, y: 0, z: -24, label: 'A' }, { x: 24, y: 0, z: -10, label: 'LONG' },
    { x: -18, y: 0, z: -24, label: 'B' }, { x: -24, y: 0, z: -4, label: 'TUN' },
    { x: 0, y: 0, z: -18, label: 'MIDN' }, { x: -26, y: 0, z: 12, label: 'WEST' },
    { x: 26, y: 0, z: 14, label: 'EAST' }, { x: 4, y: 0, z: -2, label: 'PLAZA' },
  ];

  const world = {
    scene,
    collideMeshes,
    collisionBoxes,
    playerSpawn: { x: 0, y: 0, z: 26, yaw: 0 },
    enemySpawns,
    mapBounds: { minX: -32, maxX: 32, minZ: -32, maxZ: 32 },
    landmarks,
    update() {},
    setQuality() {},
    dispose() {
      scene.remove(sky);
      ground.geometry.dispose();
      sandMat.dispose();
      sandTex.dispose();
    },
  };
  progress(0.9, 'DEV GREYBOX · 就绪');
  return world;
}
