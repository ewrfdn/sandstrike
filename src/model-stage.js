/**
 * SANDSTRIKE // sandstorm protocol — DEV MODEL STAGE
 *
 * Isolated model preview for visual QA. Every model is rebuilt from the real
 * procedural builder into an empty studio scene, placed on a platform, and
 * framed by a turntable camera. Nothing here is part of the shipping game:
 * stage.html is a dev-only page and `?dev=1` is not required.
 *
 * URL params:
 *   ?m=<modelId>       show this model on boot
 *   ?view=<viewName>   three-quarter | front | back | side | top
 *   ?pose=<poseName>   robot poses: base | aim | walk
 *   ?quality=<q>       texture quality (medium | high | ultra)
 *
 * Automation API: window.__stage (see the object at the bottom).
 */

import * as THREE from 'three';
import { createTextureLibrary } from './textures.js';
import {
  buildWorldData,
  createMaterials,
  StaticBatcher,
  ensureBatches,
  buildEnvironment,
  buildLights,
  buildMidWall,
  buildBazaarRows,
  buildWarehouseBlocks,
  buildLowWalls,
  buildColonnade,
  buildSiteArches,
  addArchMesh,
  buildInstancedProps,
  buildWell,
  buildTruck,
  buildStalls,
  buildWindmill,
  buildRadar,
  buildCarts,
  buildCampfire,
  buildAPlatform,
  buildBWreck,
  buildPipeline,
  buildLampPosts,
  buildFlagpoles,
  buildALongShade,
  buildCloths,
  buildDecalsAndPosters,
  buildLanterns,
  buildPracticalLights,
} from './world.js';
import { createRobotPreview } from './enemies.js';
import { WeaponSystem } from './weapons.js';

const params = new URLSearchParams(location.search);
const QUALITY = ['medium', 'high', 'ultra'].includes(params.get('quality')) ? params.get('quality') : 'high';

const canvas = document.getElementById('stage');
const titleEl = document.getElementById('stage-title');
const nameEl = document.getElementById('stage-name');
const metaEl = document.getElementById('stage-meta');
const statusEl = document.getElementById('stage-status');
const quadrantsEl = document.getElementById('stage-quadrants');
const quadrantLabels = quadrantsEl ? Array.from(quadrantsEl.querySelectorAll('span')) : [];

// ---------------------------------------------------------------------------
// Renderer / studio scene
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d11);

const camera = new THREE.PerspectiveCamera(36, 1, 0.03, 400);
const modelRoot = new THREE.Group();
modelRoot.name = 'modelRoot';
scene.add(modelRoot);
const platformRoot = new THREE.Group();
platformRoot.name = 'platformRoot';
scene.add(platformRoot);

let tex = null;
let materials = null;
let envTarget = null;
let stageKey = null;
let stageRim = null;
let stageFill = null;

const PLATFORM_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.92, metalness: 0.02, envMapIntensity: 0.35 });
const PLATFORM_RING_MAT = new THREE.MeshStandardMaterial({ color: 0x846f52, roughness: 0.8, metalness: 0.08, envMapIntensity: 0.4 });
const SUPPORT_MAT = new THREE.MeshStandardMaterial({ color: 0x5c5245, roughness: 0.85, metalness: 0.05 });

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------
const BASE_DATA = buildWorldData();
const cloneData = () => structuredClone(BASE_DATA);

function makeCtx(data) {
  const group = new THREE.Group();
  const ctx = {
    scene: group,
    renderer,
    quality: QUALITY,
    data,
    tex,
    materials,
    textures: [],
    objects: [],
    disposables: [],
    materialsCustom: [],
    collideMeshes: [],
    lights: [],
    flickers: [],
    cloths: [],
    animated: [],
    req: { banners: [], awnings: [], sails: [], flags: [], decals: [], posters: [], lanterns: [], lights: [], smoke: [] },
    batcher: new StaticBatcher(),
    sky: null,
    skyMaterial: null,
    sun: null,
    hemi: null,
    glowPoints: null,
    dust: null,
    smoke: null,
    pmremTarget: null,
    worldObjects: [],
    disposed: false,
    stage: true,
  };
  ensureBatches(ctx);
  return { ctx, group };
}

/** Materialise the cloth/decal/lantern/practical requests queued by a builder. */
function materialize(ctx) {
  buildCloths(ctx);
  buildDecalsAndPosters(ctx);
  buildLanterns(ctx);
  buildPracticalLights(ctx);
}

/** Add stage-only support rigging so hanging textiles can be judged physically. */
function addStageSupports(group, kind) {
  if (kind === 'banner') {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.8, 8), SUPPORT_MAT);
    beam.rotation.z = Math.PI / 2;
    beam.position.set(0, 4.25, 0);
    beam.castShadow = true;
    group.add(beam);
    for (const sx of [-1.25, 1.25]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.3, 8), SUPPORT_MAT);
      post.position.set(sx, 2.15, 0);
      post.castShadow = true;
      group.add(post);
    }
  } else if (kind === 'sail' || kind === 'awning') {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 3.0, 8), SUPPORT_MAT);
      post.position.set(sx * 2.0, 1.5, sz * 2.0);
      post.castShadow = true;
      group.add(post);
    }
  }
}

// ---------------------------------------------------------------------------
// Catalog: every buildable model on its own platform
// ---------------------------------------------------------------------------
/**
 * kind: 'world' | 'robot' | 'weapon'
 * label: HUD label
 * group: QA bucket
 */
const CATALOG = [
  // ---- instanced clutter families -------------------------------------------------
  {
    id: 'crate', kind: 'world', group: 'clutter', label: '木箱堆 · CRATE STACK',
    build(ctx) {
      ctx.stageFilter = 'crates';
      ctx.data.layout.crates = [{ x: 0, z: 0, s: 1.0, ry: 0.35, stack: 3 }];
      buildInstancedProps(ctx);
    },
  },
  {
    id: 'barrel', kind: 'world', group: 'clutter', label: '油桶 · FUEL DRUMS',
    build(ctx) {
      ctx.stageFilter = 'barrels';
      ctx.data.layout.barrels = [{ x: -0.5, z: 0.1, yaw: 0.2 }, { x: 0.55, z: -0.1, yaw: 1.4 }];
      buildInstancedProps(ctx);
    },
  },
  {
    id: 'sandbag', kind: 'world', group: 'clutter', label: '沙袋墙 · SANDBAG RUN',
    build(ctx) {
      ctx.stageFilter = 'sandbags';
      ctx.data.layout.sandbagRuns = [[0, 0, 2.6, 0.95, 0.9]];
      buildInstancedProps(ctx);
    },
  },
  {
    id: 'palm', kind: 'world', group: 'clutter', label: '棕榈树 · PALM',
    build(ctx) {
      ctx.stageFilter = 'palms';
      ctx.data.layout.palms = [{ x: 0, z: 0, s: 1.05, ry: 0.4 }];
      buildInstancedProps(ctx);
    },
  },
  {
    id: 'rubble', kind: 'world', group: 'clutter', label: '碎石堆 · RUBBLE',
    build(ctx) {
      ctx.stageFilter = 'rubble';
      buildInstancedProps(ctx);
    },
  },
  {
    id: 'tires', kind: 'world', group: 'clutter', label: '轮胎堆 · TIRE STACK',
    build(ctx) {
      ctx.stageFilter = 'tires';
      buildInstancedProps(ctx);
    },
  },
  {
    id: 'sacks', kind: 'world', group: 'clutter', label: '麻袋堆 · SACK PILE',
    build(ctx) {
      ctx.stageFilter = 'sacks';
      buildInstancedProps(ctx);
    },
  },

  // ---- hero props -----------------------------------------------------------------
  { id: 'well', kind: 'world', group: 'hero', label: '水井 · WELL', build: (ctx) => buildWell(ctx) },
  { id: 'truck', kind: 'world', group: 'hero', label: '卡车 · CARGO TRUCK', rotY: Math.PI / 2, build: (ctx) => buildTruck(ctx) },
  { id: 'windmill', kind: 'world', group: 'hero', label: '风车 · WINDMILL', build: (ctx) => buildWindmill(ctx) },
  { id: 'radar', kind: 'world', group: 'hero', label: '雷达塔 · RADAR MAST', build: (ctx) => buildRadar(ctx) },
  { id: 'cart', kind: 'world', group: 'hero', label: '平板车 · HAND CART', build: (ctx) => { ctx.stagePick = 'cart'; buildCarts(ctx); } },
  { id: 'campfire', kind: 'world', group: 'hero', label: '篝火 · CAMPFIRE', build: (ctx) => buildCampfire(ctx) },
  { id: 'a-platform', kind: 'world', group: 'hero', label: 'A点瞭望台 · WATCH PLATFORM', build: (ctx) => buildAPlatform(ctx) },
  { id: 'b-wreck', kind: 'world', group: 'hero', label: 'B点残骸 · WRECK', build: (ctx) => buildBWreck(ctx) },
  {
    id: 'pipeline', kind: 'world', group: 'hero', label: '管线 · PIPE RUN', build(ctx) {
      ctx.stagePick = 'pipeline';
      buildPipeline(ctx);
      // QA scaffolding: the real pipe run is bolted to the north boundary wall.
      const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 3.4, 0.3), new THREE.MeshStandardMaterial({ color: 0x8a6a49, roughness: 0.95 }));
      wall.position.set(0, 1.7, -0.62);
      wall.receiveShadow = true;
      ctx.scene.add(wall);
    }
  },
  {
    id: 'stall', kind: 'world', group: 'hero', label: '集市摊位 · MARKET STALL',
    build(ctx) {
      ctx.data.layout.stalls = [{ x: 0, z: 0, ry: 0 }];
      buildStalls(ctx);
    },
  },
  {
    id: 'monument', kind: 'world', group: 'hero', label: '纪念碑 · MONUMENT',
    build(ctx) {
      ctx.data.layout.pillars = [];
      ctx.stagePick = 'monument';
      buildColonnade(ctx);
    },
  },

  // ---- architecture ---------------------------------------------------------------
  {
    id: 'bazaar-shop', kind: 'world', group: 'architecture', label: '集市店铺 · BAZAAR SHOP',
    build(ctx) {
      ctx.data.layout.buildings = [{ x: 0, z: 0, w: 5.6, d: 8.2, h: 5.2, style: 'shop', rows: 2 }];
      ctx.data.layout.arches = [];
      buildBazaarRows(ctx);
      addArchMesh(ctx, { x: 0, z: 0, span: 3.0, height: 4.4, depth: 5.6, pierW: 0.08, rot: Math.PI / 2, style: 'adobe' });
    },
  },
  {
    id: 'warehouse', kind: 'world', group: 'architecture', label: '仓库块 · WAREHOUSE BLOCK',
    build(ctx) {
      ctx.data.layout.blocks = [{ x: 0, z: 0, w: 5.5, d: 4.0, h: 5.4, lane: 'A LONG', door: null }];
      buildWarehouseBlocks(ctx);
    },
  },
  {
    id: 'low-wall', kind: 'world', group: 'architecture', label: '矮墙 · LOW COVER WALL',
    build(ctx) {
      ctx.data.layout.lowWalls = [{ x: 0, z: 0, w: 4.0, d: 0.7, h: 1.25, surface: 'stone' }];
      buildLowWalls(ctx);
    },
  },
  {
    id: 'pillar', kind: 'world', group: 'architecture', label: '石柱 · COLONNADE PILLAR',
    build(ctx) {
      ctx.data.layout.pillars = [{ x: 0, z: 0, w: 0.95, d: 0.95, h: 4.0, style: 'stone' }];
      ctx.stagePick = 'pillar';
      buildColonnade(ctx);
    },
  },
  {
    id: 'shade-sail', kind: 'world', group: 'architecture', label: '遮阳帆布 · SHADE SAIL',
    build(ctx) {
      ctx.data.layout.pillars = [];
      ctx.stagePick = 'sails';
      buildColonnade(ctx);
      // QA scaffolding: the sail is strung between courtyard pillars; stand in
      // four posts so the cloth's attachment height can be judged physically.
      for (const [x, z] of [[-6.9, -20.0], [6.9, -20.0], [-5.3, -10.3], [5.3, -10.3]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.4, 8), SUPPORT_MAT);
        post.position.set(x, 2.2, z);
        post.castShadow = true;
        ctx.scene.add(post);
      }
    },
  },
  {
    id: 'site-arch', kind: 'world', group: 'architecture', label: 'A点拱门 · SITE ARCH',
    build(ctx) {
      ctx.data.layout.siteArches = [BASE_DATA.layout.siteArches[0]];
      buildSiteArches(ctx);
    },
  },
  {
    id: 'portal-arch', kind: 'world', group: 'architecture', label: '中门侧拱 · PORTAL ARCH',
    build(ctx) {
      addArchMesh(ctx, { x: 0, z: 0, span: 6.0, height: 4.4, depth: 1.6, pierW: 0.3, rot: 0, style: 'stone' });
    },
  },
  {
    id: 'tunnel-arch', kind: 'world', group: 'architecture', label: '隧道拱 · TUNNEL ARCH',
    build(ctx) {
      addArchMesh(ctx, BASE_DATA.layout.tunnelArches[0]);
    },
  },
  {
    id: 'mid-gate', kind: 'world', group: 'architecture', label: '中门 · MID GATE',
    build(ctx) {
      ctx.stagePick = 'gate';
      ctx.data.layout.walls = [];
      ctx.data.layout.arches = [BASE_DATA.layout.arches.find((a) => a.label === 'MID GATE')];
      buildMidWall(ctx);
    },
  },

  // ---- cloth samples (stage supplies its own minimal rigging) ---------------------
  {
    id: 'banner', kind: 'world', group: 'cloth', label: '条幅 · BANNER', support: 'banner',
    build(ctx) {
      addStageSupports(ctx.scene, 'banner');
      ctx.req.banners.push({ key: 'title', x: 0, y: 2.55, z: 0, ry: 0, w: 2.4, h: 3.2, sway: 0.03, anchor: 'top' });
    },
  },
  {
    id: 'flag', kind: 'world', group: 'cloth', label: '旗帜 · FLAG', support: 'flag',
    build(ctx) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 5.0, 8), SUPPORT_MAT);
      pole.position.set(-0.1, 2.5, 0);
      pole.castShadow = true;
      ctx.scene.add(pole);
      ctx.req.flags.push({ x: -0.1, y: 4.7, z: 0, w: 2.3, h: 1.5, ry: 0, key: 'warn', phase: 0.8 });
    },
  },
  {
    id: 'awning', kind: 'world', group: 'cloth', label: '遮阳篷 · AWNING', support: 'awning',
    build(ctx) {
      addStageSupports(ctx.scene, 'awning');
      ctx.req.awnings.push({ type: 'awning', x: 0, y: 3.05, z: 0, ry: 0, w: 3.4, d: 3.0, key: 'awning', pitch: 0.3 });
    },
  },

  // ---- rebuilt / previously missing fixtures (post-defect-fix QA) -----------------
  {
    id: 'lamp-post', kind: 'world', group: 'architecture', label: '路灯 · LAMP POST',
    build(ctx) {
      ctx.data.layout.lampPosts = [[0, 0]];
      buildLampPosts(ctx);
    },
  },
  {
    id: 'flagpole', kind: 'world', group: 'cloth', label: '旗杆+旗 · FLAGPOLE',
    build(ctx) {
      ctx.data.layout.hero.flagpoles = [{ x: 0, z: 0, h: 7.6 }];
      buildFlagpoles(ctx);
      ctx.req.flags.push({ x: 0, y: 7.25, z: 0, w: 2.3, h: 1.5, ry: 0.35, key: 'title', phase: 0.8 });
    },
  },
  {
    id: 'a-long-shade', kind: 'world', group: 'architecture', label: 'A长道遮阳 · A-LONG SHADE',
    build(ctx) {
      ctx.data.layout.hero.aLongShade = { x: 0, z: 0, zs: [-1.6, 0, 1.6] };
      buildALongShade(ctx);
    },
  },

  // ---- robots ---------------------------------------------------------------------
  { id: 'robot-scout', kind: 'robot', group: 'robots', label: 'SCATTER-9 · 侦察机', type: 'scout', defaultPose: 'base' },
  { id: 'robot-rifleman', kind: 'robot', group: 'robots', label: 'VULTURE-3 · 步枪机', type: 'rifleman', defaultPose: 'base' },
  { id: 'robot-heavy', kind: 'robot', group: 'robots', label: 'BULWARK-7 · 重装机', type: 'heavy', defaultPose: 'base' },
  { id: 'robot-warlord', kind: 'robot', group: 'robots', label: 'KHARON-Ω · 监军', type: 'warlord', defaultPose: 'base' },

  // ---- first-person weapon --------------------------------------------------------
  { id: 'weapon-vxr7', kind: 'weapon', group: 'weapon', label: 'VXR-7 · 视模 VIEWMODEL', lift: true },
];

const VIEW_PRESETS = {
  // Models face -Z by convention (robot chassis / weapon muzzle), so the
  // "front" camera sits on the -Z side; three-quarter is front-left.
  'three-quarter': { az: 215, el: 17 },
  front: { az: 180, el: 9 },
  back: { az: 0, el: 12 },
  side: { az: 90, el: 11 },
  top: { az: 200, el: 68 },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let current = null; // { entry, group, stats, box, pose }
let weapon = null;
let sceneBuilt = false;
let debugMissingMaterials = new Set();

const _box = new THREE.Box3();
const _tmpBox = new THREE.Box3();
const _mat4 = new THREE.Matrix4();
const _vec = new THREE.Vector3();

function trackMissingMaterials() {
  return new Proxy(materials, {
    get(target, key) {
      const value = target[key];
      if (!value) debugMissingMaterials.add(String(key));
      return value;
    },
  });
}

// ---------------------------------------------------------------------------
// Box / stats helpers
// ---------------------------------------------------------------------------
function computeBox(root) {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (obj.visible === false) return;
    if (obj.userData && obj.userData.zone) return; // invisible robot hitboxes
    // Ground decals are flat quads painted on the floor; including them shifts the
    // camera away from the silhouette (e.g. the truck's oil puddle sits 2 m beside it).
    if (obj.name === 'batch:decals' || (obj.material && obj.material.name === 'decal')) return;
    if (obj.isInstancedMesh) {
      const geo = obj.geometry;
      if (!geo) return;
      if (!geo.boundingBox) geo.computeBoundingBox();
      for (let i = 0; i < obj.count; i++) {
        obj.getMatrixAt(i, _mat4);
        _mat4.premultiply(obj.matrixWorld);
        _tmpBox.copy(geo.boundingBox).applyMatrix4(_mat4);
        box.union(_tmpBox);
      }
      return;
    }
    if (!obj.isMesh) return;
    const geo = obj.geometry;
    if (!geo) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (!geo.boundingBox || geo.boundingBox.isEmpty()) return;
    _tmpBox.copy(geo.boundingBox).applyMatrix4(obj.matrixWorld);
    box.union(_tmpBox);
  });
  return box;
}

function collectStats(entry, group, box, pose) {
  let triangles = 0;
  let meshes = 0;
  let verts = 0;
  const materialsSet = new Set();
  const meshNames = [];
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    meshes++;
    const geo = obj.geometry;
    if (!geo) return;
    const per = geo.index ? geo.index.count / 3 : (geo.attributes.position?.count || 0) / 3;
    const count = obj.isInstancedMesh ? obj.count : 1;
    triangles += per * count;
    verts += (geo.attributes.position?.count || 0) * count;
    if (obj.material) materialsSet.add(obj.material.uuid);
    if (meshNames.length < 40) meshNames.push(obj.name || obj.type);
  });
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return {
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    group: entry.group,
    pose: pose || null,
    bboxMin: box.min.toArray().map((v) => +v.toFixed(3)),
    bboxMax: box.max.toArray().map((v) => +v.toFixed(3)),
    size: size.toArray().map((v) => +v.toFixed(3)),
    center: center.toArray().map((v) => +v.toFixed(3)),
    minY: +box.min.y.toFixed(3),
    maxY: +box.max.y.toFixed(3),
    footprint: +Math.max(size.x, size.z).toFixed(3),
    triangles: Math.round(triangles),
    meshes,
    verts: Math.round(verts),
    materials: materialsSet.size,
    meshNames,
  };
}

function disposeGroup(group) {
  if (!group) return;
  const geometries = new Set();
  group.traverse((obj) => {
    if (obj.geometry) geometries.add(obj.geometry);
  });
  for (const geo of geometries) {
    try { geo.dispose(); } catch (_) { /* shared geometry from a preview pool */ }
  }
  if (group.parent) group.parent.remove(group);
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------
function rebuildPlatform(box) {
  while (platformRoot.children.length) {
    const child = platformRoot.children[0];
    platformRoot.remove(child);
    if (child.geometry) child.geometry.dispose();
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  const radius = THREE.MathUtils.clamp(Math.max(size.x, size.z) * 0.62 + 0.55, 0.7, 42);
  const discGeo = new THREE.CylinderGeometry(radius, radius * 1.045, 0.2, 72);
  const disc = new THREE.Mesh(discGeo, PLATFORM_MAT);
  disc.position.y = -0.1;
  disc.receiveShadow = true;
  disc.castShadow = false;
  platformRoot.add(disc);
  const ringGeo = new THREE.RingGeometry(radius * 0.965, radius * 0.995, 72);
  const ring = new THREE.Mesh(ringGeo, PLATFORM_RING_MAT);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  platformRoot.add(ring);
  return radius;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
function updateStageLights(center) {
  if (!stageKey) return;
  const dir = camera.position.clone().sub(center);
  if (dir.lengthSq() < 1e-6) dir.set(0, 1, 1);
  dir.normalize();
  stageKey.position.copy(center).addScaledVector(dir, 14).add(new THREE.Vector3(0, 9, 0));
  stageKey.target.position.copy(center);
  stageRim.position.copy(center).addScaledVector(dir, -12).add(new THREE.Vector3(0, 6, 0));
  stageRim.target.position.copy(center);
  stageFill.position.copy(center).add(new THREE.Vector3(-9, 5, 7));
  stageFill.target.position.copy(center);
  for (const light of [stageKey, stageRim, stageFill]) light.target.updateMatrixWorld(true);
}

function setView(viewName = 'three-quarter', { distScale = 1 } = {}) {
  if (!current) return null;
  const preset = VIEW_PRESETS[viewName] || VIEW_PRESETS['three-quarter'];
  const az = THREE.MathUtils.degToRad(preset.az);
  const el = THREE.MathUtils.degToRad(preset.el);
  const box = current.box;
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const radius = Math.max(0.35, size.length() * 0.5);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = (radius / Math.sin(fov / 2)) * 1.12 * distScale;
  const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(0.02, dist * 0.01);
  camera.far = dist * 8 + 120;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  updateStageLights(center);
  current.view = { name: viewName, az: preset.az, el: preset.el, dist: +dist.toFixed(3) };
  return current.view;
}

function setCustomView({ az = 35, el = 17, distScale = 1 } = {}) {
  if (!current) return null;
  const box = current.box;
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const radius = Math.max(0.35, size.length() * 0.5);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = (radius / Math.sin(fov / 2)) * 1.12 * distScale;
  const a = THREE.MathUtils.degToRad(az);
  const e = THREE.MathUtils.degToRad(el);
  camera.position.set(
    center.x + Math.cos(e) * Math.sin(a) * dist,
    center.y + Math.sin(e) * dist,
    center.z + Math.cos(e) * Math.cos(a) * dist
  );
  camera.near = Math.max(0.02, dist * 0.01);
  camera.far = dist * 8 + 120;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  updateStageLights(center);
  current.view = { name: 'custom', az, el, dist: +dist.toFixed(3) };
  return current.view;
}

// ---------------------------------------------------------------------------
// Render / HUD
// ---------------------------------------------------------------------------
function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function render() {
  renderer.render(scene, camera);
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
}

/**
 * Render a 2×2 contact sheet of views (and optional robot poses) into one frame.
 * items: [{ view: 'front'|'side'|..., pose?: 'base'|'aim'|'walk', distScale? }]
 */
function renderSheet(items = []) {
  if (!current) return null;
  const width = renderer.domElement.clientWidth || window.innerWidth;
  const height = renderer.domElement.clientHeight || window.innerHeight;
  const cw = Math.max(1, Math.floor(width / 2));
  const ch = Math.max(1, Math.floor(height / 2));
  const labels = [];
  renderer.setScissorTest(true);
  for (let i = 0; i < 4; i++) {
    const item = items[i] || { view: 'three-quarter' };
    if (current.preview && item.pose) current.preview.applyPose(item.pose);
    setView(item.view || 'three-quarter', { distScale: item.distScale || 1 });
    const x = (i % 2) * cw;
    const y = i < 2 ? ch : 0; // WebGL viewport origin is bottom-left
    renderer.setViewport(x, y, cw, ch);
    renderer.setScissor(x, y, cw, ch);
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const label = `${String(item.view || 'three-quarter').toUpperCase()}${item.pose ? ' · ' + String(item.pose).toUpperCase() : ''}`;
    labels.push(label);
    if (quadrantLabels[i]) quadrantLabels[i].textContent = label;
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (quadrantsEl) quadrantsEl.classList.add('is-on');
  if (current.preview) current.preview.applyPose(current.stats.pose || 'base');
  setView('three-quarter');
  return { labels, cells: 4 };
}

function updateHud(stats) {
  if (!stats) return;
  const index = CATALOG.findIndex((m) => m.id === stats.id) + 1;
  titleEl.innerHTML = `<span class="idx">[${String(index).padStart(2, '0')}/${CATALOG.length}]</span> `;
  nameEl.textContent = stats.label;
  const lines = [
    `ID   ${stats.id}   GROUP ${stats.group}`,
    `SIZE ${stats.size[0].toFixed(2)} × ${stats.size[1].toFixed(2)} × ${stats.size[2].toFixed(2)} m`,
    `minY ${stats.minY.toFixed(3)} m   maxY ${stats.maxY.toFixed(3)} m   ground gap ${stats.minY > 0.02 ? '+' + stats.minY.toFixed(2) : stats.minY < -0.02 ? stats.minY.toFixed(2) : '0.00'}`,
    `TRIS ${stats.triangles.toLocaleString('en-US')}   MESH ${stats.meshes}   VERTS ${stats.verts.toLocaleString('en-US')}`,
  ];
  if (stats.pose) lines.push(`POSE ${stats.pose}`);
  metaEl.textContent = lines.join('\n');
}

// ---------------------------------------------------------------------------
// Show a model
// ---------------------------------------------------------------------------
async function showModel(id, opts = {}) {
  const entry = CATALOG.find((m) => m.id === id);
  if (!entry) throw new Error(`[stage] unknown model id: ${id}`);
  if (!sceneBuilt) throw new Error('[stage] scene not ready');

  // remove previous
  if (current) {
    if (current.weaponRoot && current.weaponRoot.parent) current.weaponRoot.parent.remove(current.weaponRoot);
    if (current.preview) {
      try { current.preview.dispose(); } catch (_) { /* best effort */ }
    }
    disposeGroup(current.group);
    current = null;
  }

  const pose = entry.kind === 'robot' ? (opts.pose || entry.defaultPose || 'base') : null;
  let group = null;
  let preview = null;
  let weaponRoot = null;

  if (entry.kind === 'world') {
    const data = cloneData();
    const made = makeCtx(data);
    group = made.group;
    entry.build(made.ctx);
    materialize(made.ctx);
    made.ctx.batcher.flush(group, trackMissingMaterials(), []);
    if (entry.support) addStageSupports(group, entry.support);
  } else if (entry.kind === 'robot') {
    group = new THREE.Group();
    preview = createRobotPreview(entry.type);
    preview.setHitboxesVisible(false);
    preview.applyPose(pose);
    group.add(preview.rig.root);
  } else if (entry.kind === 'weapon') {
    group = new THREE.Group();
    if (!weapon) throw new Error('[stage] weapon viewmodel not built');
    weaponRoot = weapon.gunRoot;
    group.add(weaponRoot);
    group.rotation.y = Math.PI;
  }
  // Some props are authored along +X (truck) rather than the stage's -Z facing
  // convention; pre-rotate them so FRONT / SIDE / BACK labels mean what they say.
  if (entry.rotY) group.rotation.y += entry.rotY;

  modelRoot.add(group);
  group.updateMatrixWorld(true);

  const box = computeBox(group);
  if (box.isEmpty()) {
    box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  }

  // centre the footprint on the platform; Y stays at the model's authored height
  // so floating / sunk geometry is visible against the platform plane.
  const center = new THREE.Vector3();
  box.getCenter(center);
  group.position.x -= center.x;
  group.position.z -= center.z;
  // Viewmodels / held items have no ground of their own: rest them on the platform
  if (entry.lift) group.position.y += 0.02 - box.min.y;
  group.updateMatrixWorld(true);
  const grounded = computeBox(group);

  const platformRadius = rebuildPlatform(grounded);
  const stats = collectStats(entry, group, grounded, pose);
  stats.platformRadius = +platformRadius.toFixed(2);
  stats.view = null;

  current = { entry, group, preview, weaponRoot, box: grounded, stats };
  if (quadrantsEl) quadrantsEl.classList.remove('is-on');

  setView(opts.view || 'three-quarter', { distScale: opts.distScale || 1 });
  render();
  updateHud(stats);
  return stats;
}

function setPose(name) {
  if (!current || !current.preview) throw new Error('[stage] current model has no pose');
  current.preview.applyPose(name);
  current.group.updateMatrixWorld(true);
  current.stats = collectStats(current.entry, current.group, computeBox(current.group), name);
  setView(current.view?.name || 'three-quarter');
  render();
  updateHud(current.stats);
  return current.stats;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  resize();
  window.addEventListener('resize', resize);
  statusEl.textContent = 'GENERATING PROCEDURAL TEXTURES…';

  tex = await createTextureLibrary(renderer, {
    quality: QUALITY,
    onProgress: (p, label) => {
      statusEl.textContent = `${label || 'BUILDING'} ${(p * 100).toFixed(0)}%`;
    },
  });
  materials = createMaterials(tex);

  // Studio lighting + environment reuse the real world lighting rig, then add a
  // neutral three-point rig so material detail reads on every turntable angle.
  const lightCtx = { scene, renderer, quality: QUALITY, sun: null, hemi: null, lights: [] };
  buildLights(lightCtx);
  envTarget = buildEnvironment(lightCtx);
  // neutral studio backdrop instead of the desert sky
  scene.background = new THREE.Color(0x0a0d11);
  scene.fog = null;
  scene.environmentIntensity = 0.85;

  stageKey = new THREE.DirectionalLight(0xfff1da, 2.9);
  stageRim = new THREE.DirectionalLight(0xffb27a, 1.9);
  stageFill = new THREE.DirectionalLight(0x9fc2e8, 1.1);
  for (const light of [stageKey, stageRim, stageFill]) {
    light.target.position.set(0, 0, 0);
    scene.add(light);
    scene.add(light.target);
  }
  const bounce = new THREE.AmbientLight(0xffd9b0, 0.22);
  scene.add(bounce);

  // First-person weapon viewmodel (own hand/gun model, built by WeaponSystem).
  weapon = new WeaponSystem({
    camera,
    canvas,
    world: {},
    enemies: null,
    effects: null,
    audio: null,
    player: { alive: true, position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.7, 0) },
    renderer,
    environment: scene.environment,
  });

  sceneBuilt = true;
  statusEl.classList.add('is-hidden');

  const wanted = params.get('m');
  if (wanted) {
    try {
      await showModel(wanted, { pose: params.get('pose') || undefined, view: params.get('view') || undefined });
    } catch (error) {
      console.error('[stage] failed to show model', wanted, error);
      statusEl.textContent = `FAILED: ${wanted} — ${error.message}`;
      statusEl.classList.remove('is-hidden');
    }
  }

  window.__stage.ready = true;
  window.__stage.errors = [];
  console.info('[stage] ready', { models: CATALOG.length });
}

window.__stage = {
  ready: false,
  errors: [],
  models: CATALOG.map(({ id, label, group, kind }) => ({ id, label, group, kind })),
  views: Object.keys(VIEW_PRESETS),
  async show(id, opts = {}) {
    try {
      const stats = await showModel(id, opts);
      return stats;
    } catch (error) {
      window.__stage.errors.push(String(error && error.message ? error.message : error));
      console.error('[stage] show failed', error);
      throw error;
    }
  },
  setView,
  setCustomView,
  setPose,
  renderSheet,
  setHitboxes(visible = true) {
    if (!current || !current.preview) return 0;
    return current.preview.setHitboxesVisible(visible);
  },
  render,
  current() {
    return current ? current.stats : null;
  },
  stats() {
    return current ? current.stats : null;
  },
  missingMaterials() {
    return Array.from(debugMissingMaterials);
  },
  debug: {
    THREE,
    get camera() { return camera; },
    get scene() { return scene; },
    get current() { return current; },
    get renderer() { return renderer; },
  },
  dispose() {
    if (current) {
      disposeGroup(current.group);
      current = null;
    }
    if (envTarget) envTarget.dispose();
  },
};

boot().catch((error) => {
  console.error('[stage] boot failed', error);
  statusEl.textContent = `STAGE BOOT FAILED — ${error.message}`;
  statusEl.classList.remove('is-hidden');
  window.__stage.ready = false;
  window.__stage.bootError = String(error && error.message ? error.message : error);
});
