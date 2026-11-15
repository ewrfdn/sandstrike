/**
 * SANDSTRIKE // DEV TOOLS — MODEL STAGE
 *
 * Isolated per-model preview harness. Every model is rebuilt from its own module
 * under `src/models/` into an empty studio scene, placed on a platform, and
 * framed by a turntable camera. The catalog comes from `src/models/index.js`, so
 * adding a model module is enough to make it appear in the dev model viewer.
 *
 * This module was split out of the game (`src/model-stage.js`) when the dev tools
 * moved to `dev_tools/`. It is deliberately framework-free: the React panel in
 * `dev_tools/ui/src/components/ModelViewer.jsx` drives it through the API
 * returned by `createModelStage()`. Nothing here is part of the shipping game.
 *
 * Options:
 *   canvas          the <canvas> to render into (required)
 *   quality         medium | high | ultra (default high)
 *   onProgress      (progress: 0..1, label: string) => void  — texture build progress
 *   onCameraChange  (orbitState) => void — fired by drag / wheel / preset / reset
 *
 * Automation API: the returned object is also published as `window.__stage`, the
 * contract used by `scripts/model-shots.mjs`:
 *   ready, bootError, errors, models, views, show(id, opts), setView(name, opts),
 *   setPose(name), setCustomView(opts), orbitState(), orbitBy(dx,dy), zoomBy(f),
 *   resetOrbit(), renderSheet(items), render(), current(), stats(),
 *   missingMaterials(), setHitboxes(visible), debug, dispose().
 */

import * as THREE from 'three';
import { createTextureLibrary } from '../../../../src/textures.js';
import {
  buildWorldData,
  createMaterials,
  StaticBatcher,
  ensureBatches,
  buildEnvironment,
  buildLights,
  buildCloths,
  buildDecalsAndPosters,
  buildLanterns,
  buildPracticalLights,
} from '../../../../src/world/index.js';
import { MODEL_CATALOG } from '../../../../src/models/index.js';
import { createRobotPreview } from '../../../../src/models/robots/index.js';
import { createWeaponPreview } from '../../../../src/models/weapons/preview.js';

const VALID_QUALITY = ['medium', 'high', 'ultra'];

const VIEW_PRESETS = {
  // Models face -Z by convention (robot chassis / weapon muzzle), so the
  // "front" camera sits on the -Z side; three-quarter is front-left.
  'three-quarter': { az: 215, el: 17 },
  front: { az: 180, el: 9 },
  back: { az: 0, el: 12 },
  side: { az: 90, el: 11 },
  top: { az: 200, el: 68 },
};

// Pose support (robots: base/aim/walk; weapons & held props: bare/held)
const ROBOT_POSES = ['base', 'aim', 'walk'];
const CATALOG = MODEL_CATALOG;

/** Poses advertised by a catalog entry (robot chassis / weapon / held prop). */
function posesFor(entry) {
  if (!entry) return [];
  if (entry.kind === 'robot') return ROBOT_POSES;
  return Array.isArray(entry.poses) ? entry.poses.slice() : [];
}

/** Default pose of an entry, or null when it has no poses. */
function defaultPoseFor(entry) {
  const poses = posesFor(entry);
  if (!poses.length) return null;
  return entry.defaultPose && poses.includes(entry.defaultPose) ? entry.defaultPose : poses[0];
}

/** Resolve a requested pose against the entry's own pose list (fallback = default). */
function resolvePoseFor(entry, requested) {
  const poses = posesFor(entry);
  if (!poses.length) return null;
  if (requested && poses.includes(requested)) return requested;
  return defaultPoseFor(entry);
}

/**
 * Apply one pose to a built model.
 * - robots / weapons own their pose inside a preview object (`applyPose`)
 * - world models that expose `poseGroups` toggle the matching group's visibility
 *   (`bare` = all arm/held groups off)
 */
function applyPoseTo(entry, refs, pose) {
  if (!entry || !pose) return;
  if (refs.preview) {
    refs.preview.applyPose(pose);
    return;
  }
  if (refs.poseGroups) {
    for (const name of Object.keys(refs.poseGroups)) {
      const group = refs.poseGroups[name];
      if (group) group.visible = name === pose;
    }
  }
}

/**
 * Groups that the current pose has hidden (weapon hands / held-prop arms).
 * A hidden pose subtree has to be excluded from the stage bbox + triangle stats
 * so BARE genuinely reads smaller than HELD; every other mesh keeps the legacy
 * counting semantics (e.g. the viewmodel's invisible spare magazine still
 * counts, exactly like it did when the old stage measured the whole rig).
 */
function hiddenPoseGroups(refs) {
  const hidden = new Set();
  if (!refs) return hidden;
  if (refs.poseGroups) {
    for (const name of Object.keys(refs.poseGroups)) {
      const group = refs.poseGroups[name];
      if (group && group.visible === false) hidden.add(group);
    }
  }
  const hands = refs.preview && refs.preview.handsRoot;
  if (hands && hands.visible === false) hidden.add(hands);
  return hidden;
}

/** True when `obj` sits inside one of the pose groups hidden by the current pose. */
function underHiddenGroup(obj, hidden, modelRoot) {
  if (!hidden || hidden.size === 0) return false;
  let node = obj;
  while (node) {
    if (hidden.has(node)) return true;
    if (node === modelRoot) break;
    node = node.parent;
  }
  return false;
}

/**
 * Create and boot the isolated model stage.
 *
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   quality?: 'medium'|'high'|'ultra',
 *   onProgress?: (progress: number, label?: string) => void,
 *   onCameraChange?: (orbit: object) => void,
 * }} options
 * @returns {Promise<object>} the automation / viewer API (also `window.__stage`)
 */
export async function createModelStage({ canvas, quality = 'high', onProgress, onCameraChange } = {}) {
  if (!canvas) throw new Error('[model-stage] createModelStage requires a canvas');
  const QUALITY = VALID_QUALITY.includes(quality) ? quality : 'high';
  const report = (progress, label) => {
    try {
      onProgress?.(Math.max(0, Math.min(1, progress)), label);
    } catch (_) {
      /* UI progress callbacks must never break the stage */
    }
  };

  // -------------------------------------------------------------------------
  // Renderer / studio scene
  // -------------------------------------------------------------------------
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
  let sceneBuilt = false;
  let disposed = false;
  let resizeHandler = null;

  const PLATFORM_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.92, metalness: 0.02, envMapIntensity: 0.35 });
  const PLATFORM_RING_MAT = new THREE.MeshStandardMaterial({ color: 0x846f52, roughness: 0.8, metalness: 0.08, envMapIntensity: 0.4 });
  const SUPPORT_MAT = new THREE.MeshStandardMaterial({ color: 0x5c5245, roughness: 0.85, metalness: 0.06 });

  // -------------------------------------------------------------------------
  // Catalog helpers
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  let current = null; // { entry, group, preview, poseGroups, stats, box, pose }
  const debugMissingMaterials = new Set();

  // Free-orbit state (degrees / relative zoom). Drag on the canvas orbits the
  // camera around the model; wheel zooms; double-click resets to the last preset.
  const ORBIT_EL_MIN = -18;
  const ORBIT_EL_MAX = 82;
  const ORBIT_MIN_ZOOM = 0.35;
  const ORBIT_MAX_ZOOM = 3.5;
  const orbit = {
    az: VIEW_PRESETS['three-quarter'].az,
    el: VIEW_PRESETS['three-quarter'].el,
    distScale: 1,
    custom: false,
    lastPreset: 'three-quarter',
  };

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

  // -------------------------------------------------------------------------
  // Box / stats helpers
  // -------------------------------------------------------------------------
  function computeBox(root, hidden = null) {
    const box = new THREE.Box3();
    root.updateMatrixWorld(true);
    root.traverse((obj) => {
      if (underHiddenGroup(obj, hidden, modelRoot)) return;
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

  function collectStats(entry, group, box, pose, hidden = null) {
    let triangles = 0;
    let meshes = 0;
    let verts = 0;
    const materialsSet = new Set();
    const meshNames = [];
    group.traverse((obj) => {
      if (!obj.isMesh) return;
      if (underHiddenGroup(obj, hidden, modelRoot)) return;
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

  /**
   * Apply the stage layout to a freshly built / re-posed model group:
   * centre the footprint on the platform, then (for lift entries: viewmodels and
   * carried props) rest the model on the platform plane. Returns the grounded box.
   */
  function applyStageLayout(entry, group, hidden = null) {
    group.updateMatrixWorld(true);
    const box = computeBox(group, hidden);
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
    return computeBox(group, hidden);
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

  // -------------------------------------------------------------------------
  // Platform
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------
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

  function frameCamera(azDeg, elDeg, distScale) {
    if (!current) return null;
    const box = current.box;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const radius = Math.max(0.35, size.length() * 0.5);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const dist = (radius / Math.sin(fov / 2)) * 1.12 * distScale;
    const a = THREE.MathUtils.degToRad(azDeg);
    const e = THREE.MathUtils.degToRad(elDeg);
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
    orbit.az = +azDeg.toFixed(2);
    orbit.el = +elDeg.toFixed(2);
    orbit.distScale = distScale;
    return { center, dist };
  }

  function orbitState() {
    return {
      az: orbit.az,
      el: orbit.el,
      distScale: orbit.distScale,
      custom: orbit.custom,
      name: current ? current.view?.name || 'custom' : null,
      preset: orbit.lastPreset,
    };
  }

  function notifyOrbit() {
    const orbitSnapshot = orbitState();
    // The construction callback is the primary path; `api.onCameraChange` is kept
    // as a settable hook so automation / embedders can subscribe after creation
    // (the old models.html viewer relied on this hook).
    const listeners = [onCameraChange];
    try {
      if (typeof api.onCameraChange === 'function') listeners.push(api.onCameraChange);
    } catch (_) {
      /* api is initialised before boot(); defensive only */
    }
    for (const listener of listeners) {
      if (typeof listener !== 'function') continue;
      try {
        listener(orbitSnapshot);
      } catch (_) {
        /* viewer callbacks must never break the stage */
      }
    }
  }

  function setView(viewName = 'three-quarter', { distScale = 1 } = {}) {
    if (!current) return null;
    const known = !!VIEW_PRESETS[viewName];
    const preset = VIEW_PRESETS[viewName] || VIEW_PRESETS['three-quarter'];
    orbit.custom = false;
    orbit.lastPreset = known ? viewName : 'three-quarter';
    const framed = frameCamera(preset.az, preset.el, Math.max(0.05, distScale));
    if (!framed) return null;
    current.view = { name: orbit.lastPreset, az: preset.az, el: preset.el, dist: +framed.dist.toFixed(3) };
    notifyOrbit();
    return current.view;
  }

  function setCustomView({ az = orbit.az, el = orbit.el, distScale = orbit.distScale } = {}) {
    if (!current) return null;
    orbit.custom = true;
    const framed = frameCamera(az, el, Math.max(0.05, distScale));
    if (!framed) return null;
    current.view = { name: 'custom', az, el, dist: +framed.dist.toFixed(3) };
    notifyOrbit();
    return current.view;
  }

  /** Orbit by a pixel delta (drag). Returns the new orbit state. */
  function orbitBy(dx, dy, { renderNow = true } = {}) {
    if (!current) return orbitState();
    orbit.az = (((orbit.az - dx * 0.32) % 360) + 360) % 360;
    orbit.el = THREE.MathUtils.clamp(orbit.el + dy * 0.25, ORBIT_EL_MIN, ORBIT_EL_MAX);
    orbit.custom = true;
    const framed = frameCamera(orbit.az, orbit.el, orbit.distScale);
    if (framed) current.view = { name: 'custom', az: orbit.az, el: orbit.el, dist: +framed.dist.toFixed(3) };
    if (renderNow) render();
    notifyOrbit();
    return orbitState();
  }

  /** Multiply the orbit distance (wheel zoom). Returns the new orbit state. */
  function zoomBy(factor) {
    if (!current) return orbitState();
    orbit.distScale = THREE.MathUtils.clamp(orbit.distScale * factor, ORBIT_MIN_ZOOM, ORBIT_MAX_ZOOM);
    orbit.custom = true;
    const framed = frameCamera(orbit.az, orbit.el, orbit.distScale);
    if (framed) current.view = { name: 'custom', az: orbit.az, el: orbit.el, dist: +framed.dist.toFixed(3) };
    render();
    notifyOrbit();
    return orbitState();
  }

  /** Return to the last named preset (double-click / reset button). */
  function resetOrbit() {
    return setView(orbit.lastPreset || 'three-quarter');
  }

  // The renderer draws into the caller-provided canvas; all orbit/pointer
  // listeners below attach to that same element.
  function bindOrbitControls() {
    let dragging = false;
    let pointerId = null;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (!current) return;
      dragging = true;
      pointerId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      try {
        canvas.setPointerCapture?.(event.pointerId);
      } catch (_) {
        /* best effort */
      }
      canvas.style.cursor = 'grabbing';
      event.preventDefault();
    };

    const onPointerMove = (event) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      if (dx === 0 && dy === 0) return;
      orbitBy(dx, dy);
      event.preventDefault();
    };

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      if (pointerId !== null) {
        try {
          canvas.releasePointerCapture?.(pointerId);
        } catch (_) {
          /* best effort */
        }
      }
      pointerId = null;
      canvas.style.cursor = 'grab';
    };

    const onWheel = (event) => {
      if (!current) return;
      event.preventDefault();
      zoomBy(Math.exp(event.deltaY * 0.0015));
    };

    const onDoubleClick = () => {
      resetOrbit();
      render();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'none';

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDoubleClick);
    };
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  function resize() {
    // The canvas fills its flex parent; when a tab is hidden the browser still
    // reports the last laid-out size, but guard against 0 during the first frame.
    const width = Math.max(1, canvas.clientWidth || Math.round(canvas.getBoundingClientRect?.().width || 0) || 1);
    const height = Math.max(1, canvas.clientHeight || Math.round(canvas.getBoundingClientRect?.().height || 0) || 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // The stage has no render loop: resizing the drawing buffer clears the frame.
    // Repaint immediately when a model is already on screen (the React panel can
    // resize after the info bar fills).
    if (sceneBuilt && current) render();
  }

  function render() {
    if (disposed) return { calls: 0, triangles: 0 };
    renderer.render(scene, camera);
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  }

  /**
   * Render a 2×2 contact sheet of views (and optional poses) into one frame.
   * items: [{ view: 'front'|'side'|..., pose?: 'base'|'aim'|'walk'|'bare'|'held', distScale? }]
   * Poses are per-cell: robots keep the legacy framing, while weapons / held props
   * are re-framed from their posed silhouette so the bare vs held cells compare.
   */
  function renderSheet(items = []) {
    if (!current) return null;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const cw = Math.max(1, Math.floor(width / 2));
    const ch = Math.max(1, Math.floor(height / 2));
    const labels = [];
    const entry = current.entry;
    const restorePose = current.pose || defaultPoseFor(entry);
    const savedBox = current.box;
    renderer.setScissorTest(true);
    for (let i = 0; i < 4; i++) {
      const item = items[i] || { view: 'three-quarter' };
      const pose = item.pose ? resolvePoseFor(entry, item.pose) : null;
      if (pose) {
        applyPoseTo(entry, current, pose);
        current.group.updateMatrixWorld(true);
      }
      // Robots keep the legacy framing (pose never moves the platform / box);
      // weapons / held props re-frame per cell from the posed silhouette.
      if (pose && entry.kind !== 'robot') current.box = computeBox(current.group, hiddenPoseGroups(current));
      setView(item.view || 'three-quarter', { distScale: item.distScale || 1 });
      const x = (i % 2) * cw;
      const y = i < 2 ? ch : 0; // WebGL viewport origin is bottom-left
      renderer.setViewport(x, y, cw, ch);
      renderer.setScissor(x, y, cw, ch);
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      labels.push(`${String(item.view || 'three-quarter').toUpperCase()}${item.pose ? ' · ' + String(item.pose).toUpperCase() : ''}`);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // restore the interactive pose and the pre-sheet framing box
    if (restorePose) applyPoseTo(entry, current, restorePose);
    current.group.updateMatrixWorld(true);
    current.box = savedBox;
    setView('three-quarter');
    return { labels, cells: 4 };
  }

  // -------------------------------------------------------------------------
  // Show a model
  // -------------------------------------------------------------------------
  async function showModel(id, opts = {}) {
    const entry = CATALOG.find((m) => m.id === id);
    if (!entry) throw new Error(`[stage] unknown model id: ${id}`);
    if (!sceneBuilt) throw new Error('[stage] scene not ready');

    // remove previous
    if (current) {
      if (current.preview) {
        try { current.preview.dispose(); } catch (_) { /* best effort */ }
      }
      disposeGroup(current.group);
      current = null;
    }

    // Generic pose resolution: robots keep their BASE/AIM/WALK set, weapons and
    // held props advertise their own list (bare/held) on the catalog entry, and
    // show(id, {pose}) / the viewer apply to every entry that has poses.
    const pose = resolvePoseFor(entry, opts.pose);
    let group = null;
    let preview = null;
    let poseGroups = null;

    if (entry.kind === 'world') {
      const data = cloneData();
      const made = makeCtx(data);
      group = made.group;
      const built = entry.build(made.ctx);
      // Held props (RPG launcher) hand back pose-only visibility groups: their
      // gloved hands / sleeve stubs are split out of the static batcher so the
      // stage can hide them for BARE and show them for HELD.
      if (built && built.poseGroups) poseGroups = built.poseGroups;
      materialize(made.ctx);
      made.ctx.batcher.flush(group, trackMissingMaterials(), []);
      if (entry.support) addStageSupports(group, entry.support);
    } else if (entry.kind === 'robot') {
      group = new THREE.Group();
      preview = createRobotPreview(entry.type);
      preview.setHitboxesVisible(false);
      group.add(preview.rig.root);
    } else if (entry.kind === 'weapon') {
      // Dev-only weapon preview (bare weapon + hands split into weaponRoot /
      // handsRoot); no gameplay WeaponSystem is involved (weapon-split §3.4).
      group = new THREE.Group();
      preview = createWeaponPreview(entry.weaponId || entry.type);
      group.add(preview.root);
      group.rotation.y = Math.PI; // keep the legacy viewmodel-facing orientation
    }
    // Some props are authored along +X (truck) rather than the stage's -Z facing
    // convention; pre-rotate them so FRONT / SIDE / BACK labels mean what they say.
    if (entry.rotY) group.rotation.y += entry.rotY;

    // Apply the initial pose BEFORE measuring: bare vs held have different
    // silhouettes, so lift / centring / stats must describe the visible pose.
    if (pose) applyPoseTo(entry, { preview, poseGroups }, pose);

    modelRoot.add(group);
    group.updateMatrixWorld(true);

    const hidden = hiddenPoseGroups({ preview, poseGroups });
    const grounded = applyStageLayout(entry, group, hidden);

    const platformRadius = rebuildPlatform(grounded);
    const stats = collectStats(entry, group, grounded, pose, hidden);
    stats.platformRadius = +platformRadius.toFixed(2);
    stats.view = null;

    current = { entry, group, preview, poseGroups, box: grounded, stats, pose };

    setView(opts.view || 'three-quarter', { distScale: opts.distScale || 1 });
    render();
    return stats;
  }

  function setPose(name) {
    if (!current) throw new Error('[stage] current model has no pose');
    const entry = current.entry;
    const poses = posesFor(entry);
    if (!poses.length) throw new Error('[stage] current model has no pose');
    const pose = resolvePoseFor(entry, name);

    applyPoseTo(entry, current, pose);
    current.group.updateMatrixWorld(true);
    const hidden = hiddenPoseGroups(current);

    if (entry.kind === 'robot') {
      // Robots keep the legacy behaviour: pose only, no re-centring / platform
      // rebuild (their feet stay planted where the rig authored them).
      current.pose = pose;
      current.stats = collectStats(entry, current.group, computeBox(current.group), pose);
    } else {
      // Weapons / held props: re-apply the stage layout for the new silhouette
      // (centre + lift -> ground), then recompute box/stats and rebuild the
      // platform so camera framing and HUD follow BARE <-> HELD.
      const grounded = applyStageLayout(entry, current.group, hidden);
      const platformRadius = rebuildPlatform(grounded);
      const stats = collectStats(entry, current.group, grounded, pose, hidden);
      stats.platformRadius = +platformRadius.toFixed(2);
      stats.view = null;
      current.box = grounded;
      current.pose = pose;
      current.stats = stats;
    }
    // keep the free-orbit orientation when the user has rotated the model
    if (orbit.custom) setCustomView({ az: orbit.az, el: orbit.el, distScale: orbit.distScale });
    else setView(current.view?.name || orbit.lastPreset || 'three-quarter');
    render();
    return current.stats;
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  async function boot() {
    resize();
    resizeHandler = () => resize();
    window.addEventListener('resize', resizeHandler);
    bindOrbitControls();

    report(0, 'GENERATING PROCEDURAL TEXTURES…');
    tex = await createTextureLibrary(renderer, {
      quality: QUALITY,
      onProgress: (progress, label) => report(progress, label),
    });
    if (disposed) return;
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

    sceneBuilt = true;
    report(1, 'READY');
  }

  // -------------------------------------------------------------------------
  // Public API (also published as window.__stage for automation)
  // -------------------------------------------------------------------------
  const api = {
    ready: false,
    bootError: null,
    errors: [],
    // poses / defaultPose drive the dev viewer's POSE buttons + the P shortcut and
    // the automation sheets: robots advertise base/aim/walk, weapons bare/held.
    models: CATALOG.map((entry) => ({
      id: entry.id,
      label: entry.label,
      group: entry.group,
      kind: entry.kind,
      poses: posesFor(entry),
      defaultPose: defaultPoseFor(entry),
    })),
    views: Object.keys(VIEW_PRESETS),
    canvas,
    async show(id, opts = {}) {
      try {
        const stats = await showModel(id, opts);
        return stats;
      } catch (error) {
        api.errors.push(String(error && error.message ? error.message : error));
        throw error;
      }
    },
    setView,
    setCustomView,
    setPose,
    renderSheet,
    orbitState,
    orbitBy,
    zoomBy,
    resetOrbit,
    /** Optional override so external tooling can subscribe to orbit changes. */
    onCameraChange: null,
    setHitboxes(visible = true) {
      if (!current || !current.preview || typeof current.preview.setHitboxesVisible !== 'function') return 0;
      return current.preview.setHitboxesVisible(visible);
    },
    render,
    resize,
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
      /** Procedural texture library (dev texture sheets, see ISLAND_ASSETS.md §3). */
      get textures() { return tex; },
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
      if (current) {
        if (current.preview) {
          try { current.preview.dispose(); } catch (_) { /* best effort */ }
        }
        disposeGroup(current.group);
        current = null;
      }
      if (envTarget) envTarget.dispose();
      try { tex?.dispose?.(); } catch (_) { /* best effort */ }
      renderer.dispose();
      if (window.__stage === api) window.__stage = null;
    },
  };

  window.__stage = api;

  try {
    await boot();
    api.ready = true;
  } catch (error) {
    api.ready = false;
    api.bootError = String(error && error.message ? error.message : error);
    if (window.__stage === api) window.__stage.bootError = api.bootError;
    throw error;
  }
  return api;
}
