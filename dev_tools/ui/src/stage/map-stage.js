/**
 * SANDSTRIKE // DEV MAP STAGE
 *
 * Framework-free WebGL stage for the dev-tools MAP VIEWER. It owns the renderer,
 * the scene and a free-fly inspection camera, and builds the real shipping world
 * through `createWorld()` (src/world/index.js) — the same builder the game uses,
 * so what the viewer shows is what actually ships. Nothing here is part of the
 * game bundle; only `dev_tools/ui` imports it.
 *
 * The React panel (components/MapViewer.jsx) drives the controller returned by
 * `createMapStage()`; this module makes no assumptions beyond a canvas element,
 * so a plain probe page can drive it too.
 *
 * Usage:
 *   const stage = createMapStage({ canvas, quality: 'medium', onProgress, onFrame, onError });
 *   const summary = await stage.loadMap('outpost-07');
 *   stage.setActive(true);
 *   // ...
 *   stage.dispose();
 *
 * Controls (while active): drag = look, WASD = fly, Q/E = down/up, Shift = boost
 * x4, arrows = look, wheel = base speed, R = reset to the map spawn.
 *
 * Automation API: the MapViewer exposes the controller as `window.__mapStage`
 * (used by `.scratch/map-viewer-probe/*` and future scripts/*-probe.mjs).
 */
import * as THREE from 'three';
import { CONFIG } from '../../../../src/config/game.js';
import { QUALITY_SETTINGS } from '../../../../src/world/quality.js';
import { createWorld, listMaps, DEFAULT_MAP_ID } from '../../../../src/world/index.js';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
/** Neutral clear colour behind the world while it builds / when nothing is loaded. */
const BG_COLOR = 0x080a0d;
/** Longest frame delta the camera/world update accepts (tab wake-ups, hitches). */
const MAX_DT = 0.1;
/** Mouse/touch look sensitivity (radians per pixel). */
const LOOK_SENSITIVITY = 0.0028;
/** Arrow-key look speed (radians per second). */
const ARROW_YAW_SPEED = 1.7;
const ARROW_PITCH_SPEED = 1.1;
/** Vertical look clamp; mirrors the player camera limit from CONFIG. */
const MAX_PITCH = CONFIG.player.maxPitch;
/** Free-fly base speed range (m/s) and the default the slider starts at. */
const MIN_SPEED = 0.5;
const MAX_SPEED = 80;
const DEFAULT_SPEED = 12;
/** Shift boost multiplier. */
const BOOST_MULTIPLIER = 4;
/** onFrame cadence: ~5 Hz, enough for a status HUD without re-rendering React 60x/s. */
const FRAME_REPORT_INTERVAL = 200;

/** Keyboard codes the free-fly camera consumes (everything else is left to the app). */
const CONTROL_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ShiftLeft',
  'ShiftRight',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

const QUALITY_IDS = Object.keys(QUALITY_SETTINGS);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp01 = (value) => clamp(value, 0, 1);
/** Compact JSON-safe number for the state snapshot (avoids 0.30000000000004 noise). */
const round = (value, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const finite = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** True when the event target is a text field (typing must never fly the camera). */
function isTypingTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable === true;
}

/**
 * Create the map stage (synchronous — the expensive world build runs in loadMap).
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas canvas the renderer draws into
 * @param {string} [options.quality] one of src/world/quality.js ids (default 'high')
 * @param {(progress:number, label:string)=>void} [options.onProgress] world build progress 0..1
 * @param {(state:object)=>void} [options.onFrame] throttled (~5 Hz) camera/render stats
 * @param {(error:Error)=>void} [options.onError] world build / render loop failures
 * @returns {object} stage controller (see the object at the bottom of this file)
 */
export function createMapStage({ canvas, quality = 'high', onProgress, onFrame, onError } = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new Error('[map-stage] createMapStage requires a <canvas> element');
  }

  // -------------------------------------------------------------------------
  // Renderer / scene / camera — mirrors src/main.js so the preview is faithful.
  // -------------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = quality !== 'lowest';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);

  const camera = new THREE.PerspectiveCamera(CONFIG.renderer.fov, 1, CONFIG.renderer.near, CONFIG.renderer.far);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, CONFIG.player.eyeHeight, 0);

  // -------------------------------------------------------------------------
  // Stage state
  // -------------------------------------------------------------------------
  let stageQuality = QUALITY_IDS.includes(quality) ? quality : 'high';
  let disposed = false;
  let active = false;
  let world = null;
  let ready = false;
  let loading = false;
  let mapId = null;
  let mapName = null;
  let style = null;

  let yaw = 0;
  let pitch = 0;
  let baseSpeed = DEFAULT_SPEED;
  let fps = 0;
  let elapsed = 0;

  let rafId = 0;
  let lastFrameTime = 0;
  let lastReportTime = 0;

  let dragging = false;
  let dragPointerId = null;
  let lastPointerX = 0;
  let lastPointerY = 0;

  let worldUpdateFailed = false;
  let renderFailed = false;

  /** Calls are serialised: createWorld() builds into the shared scene, so two */
  /** concurrent builds would stomp each other. */
  let loadChain = Promise.resolve();

  const keys = new Set();
  /** Scratch vectors reused by the movement integrator (no per-frame garbage). */
  const moveVector = new THREE.Vector3();

  let maps = [];
  try {
    maps = listMaps();
  } catch (error) {
    console.warn('[map-stage] map registry unavailable', error);
  }
  const manifestById = new Map(maps.map((entry) => [entry.id, entry]));

  // -------------------------------------------------------------------------
  // Callbacks — a UI exception must never break the render loop.
  // -------------------------------------------------------------------------
  function reportProgress(progress, label) {
    if (disposed || typeof onProgress !== 'function') return;
    try {
      onProgress(clamp01(progress), typeof label === 'string' ? label : '');
    } catch (error) {
      /* the viewer's progress UI must never break world generation */
    }
  }

  function reportError(error) {
    if (disposed || typeof onError !== 'function') return;
    try {
      onError(error instanceof Error ? error : new Error(String(error)));
    } catch (callbackError) {
      /* ignore */
    }
  }

  // -------------------------------------------------------------------------
  // Camera helpers
  // -------------------------------------------------------------------------
  function applyCameraRotation() {
    camera.rotation.set(pitch, yaw, 0);
  }

  /** Point the free-fly camera at the current world spawn (player eye height). */
  function resetCamera() {
    const spawn = (world && world.playerSpawn) || { x: 0, y: 0, z: 0, yaw: 0 };
    camera.position.set(
      finite(spawn.x, 0),
      finite(spawn.y, 0) + CONFIG.player.eyeHeight,
      finite(spawn.z, 0)
    );
    yaw = finite(spawn.yaw, 0);
    pitch = 0;
    applyCameraRotation();
  }

  // -------------------------------------------------------------------------
  // Input — pointer drag, keyboard, wheel. Bound only while active.
  // -------------------------------------------------------------------------
  function onKeyDown(event) {
    if (!active || disposed) return;
    if (isTypingTarget(event.target)) return;
    const code = event.code || '';
    if (code === 'KeyR') {
      // Reset is an action, not a held key.
      if (!event.repeat) resetCamera();
      event.preventDefault?.();
      return;
    }
    if (!CONTROL_CODES.has(code)) return;
    keys.add(code);
    // Stop arrows / WASD from scrolling the surrounding dev-tools page.
    event.preventDefault?.();
  }

  function onKeyUp(event) {
    const code = event.code || '';
    if (!code) return;
    keys.delete(code);
  }

  function onWindowBlur() {
    keys.clear();
    endDrag();
  }

  function onPointerDown(event) {
    if (!active || disposed) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragging = true;
    dragPointerId = event.pointerId;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch (error) {
      /* pointer capture is best effort (old browsers) */
    }
    canvas.style.cursor = 'grabbing';
    event.preventDefault?.();
  }

  function onPointerMove(event) {
    if (!active || disposed || !dragging) return;
    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    if (dx === 0 && dy === 0) return;
    yaw -= dx * LOOK_SENSITIVITY;
    pitch = clamp(pitch - dy * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
    applyCameraRotation();
    event.preventDefault?.();
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (dragPointerId !== null) {
      try {
        if (canvas.hasPointerCapture?.(dragPointerId)) canvas.releasePointerCapture(dragPointerId);
      } catch (error) {
        /* best effort */
      }
    }
    dragPointerId = null;
    canvas.style.cursor = 'grab';
  }

  function onPointerUp(event) {
    if (event && typeof event.pointerId === 'number' && dragPointerId !== null && event.pointerId !== dragPointerId) {
      return;
    }
    endDrag();
  }

  function onWheel(event) {
    if (!active || disposed) return;
    event.preventDefault();
    // Wheel up = faster; exponential so each notch feels the same at any speed.
    setSpeed(baseSpeed * Math.exp(-event.deltaY * 0.0015));
  }

  function clearInput() {
    keys.clear();
    endDrag();
  }

  // -------------------------------------------------------------------------
  // Resize — canvas client size drives the drawing buffer / camera aspect.
  // -------------------------------------------------------------------------
  function resize() {
    if (disposed) return;
    const width = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 1));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // The RAF loop owns repainting while active; a hidden / inactive canvas
    // still needs one frame after a resize or it shows a stale (cleared) buffer.
    if (!active) renderOnce();
  }

  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (resizeObserver) resizeObserver.observe(canvas);

  // -------------------------------------------------------------------------
  // Render loop
  // -------------------------------------------------------------------------
  function updateCamera(dt) {
    // Keyboard look (arrows) — pointer look is applied directly in onPointerMove.
    const turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
    const tilt = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
    if (turn !== 0 || tilt !== 0) {
      yaw += turn * ARROW_YAW_SPEED * dt;
      pitch = clamp(pitch + tilt * ARROW_PITCH_SPEED * dt, -MAX_PITCH, MAX_PITCH);
    }

    // WASD / QE movement — full 3D fly direction (the camera keeps its pitch).
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const lift = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
    if (forward !== 0 || strafe !== 0 || lift !== 0) {
      const cosPitch = Math.cos(pitch);
      // forward = (-sinYaw*cosPitch, sinPitch, -cosYaw*cosPitch); right = (cosYaw, 0, -sinYaw)
      moveVector.set(
        -Math.sin(yaw) * cosPitch * forward + Math.cos(yaw) * strafe,
        Math.sin(pitch) * forward + lift,
        -Math.cos(yaw) * cosPitch * forward - Math.sin(yaw) * strafe
      );
      if (moveVector.lengthSq() > 0) {
        moveVector.normalize();
        const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? BOOST_MULTIPLIER : 1;
        camera.position.addScaledVector(moveVector, baseSpeed * boost * dt);
      }
    }

    applyCameraRotation();
  }

  function renderOnce() {
    if (disposed) return;
    try {
      renderer.render(scene, camera);
    } catch (error) {
      if (!renderFailed) {
        renderFailed = true;
        console.error('[map-stage] render failed', error);
      }
    }
  }

  function tick(now) {
    if (disposed || !active) {
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(tick);

    const rawDt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    // Clamp dt so a backgrounded tab / debugger pause cannot teleport the camera.
    const dt = clamp(rawDt, 0, MAX_DT);
    elapsed += dt;

    updateCamera(dt);

    if (world) {
      try {
        world.update(dt, elapsed);
      } catch (error) {
        if (!worldUpdateFailed) {
          worldUpdateFailed = true;
          console.error('[map-stage] world.update failed — the render loop keeps going', error);
          reportError(error);
        }
      }
    }

    renderOnce();

    if (dt > 0) {
      const instant = 1 / dt;
      fps = fps > 0 ? fps * 0.85 + instant * 0.15 : instant;
    }

    // Throttled UI stats: ~5 Hz is enough for the HUD and keeps React cheap.
    if (now - lastReportTime >= FRAME_REPORT_INTERVAL) {
      lastReportTime = now;
      if (typeof onFrame === 'function') {
        try {
          onFrame(state());
        } catch (error) {
          /* HUD callbacks must never break the loop */
        }
      }
    }
  }

  function startLoop() {
    if (rafId || disposed || !active) return;
    lastFrameTime = performance.now();
    lastReportTime = 0; // push a fresh state snapshot on the next frame
    fps = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // -------------------------------------------------------------------------
  // World lifecycle
  // -------------------------------------------------------------------------
  async function buildMap(requestedMapId, { keepCamera = false } = {}) {
    if (disposed) throw new Error('[map-stage] stage disposed');
    const wanted = typeof requestedMapId === 'string' && requestedMapId.trim() ? requestedMapId.trim() : DEFAULT_MAP_ID;

    loading = true;
    ready = false;
    mapId = null;
    mapName = null;
    style = null;

    // Tear the previous map down before the next build touches the scene.
    if (world) {
      try {
        world.dispose();
      } catch (error) {
        console.warn('[map-stage] world.dispose() failed — continuing with map swap', error);
      }
      world = null;
    }
    worldUpdateFailed = false;
    renderFailed = false;
    // disposeWorld() clears environment/fog but leaves scene.background behind;
    // reset all three so a second map load starts from the same clean scene as
    // the first one (and so the loading view is a neutral dev-tools black).
    scene.background = new THREE.Color(BG_COLOR);
    scene.fog = null;
    scene.environment = null;
    reportProgress(0, 'PREPARING MAP');

    let nextWorld;
    try {
      nextWorld = await createWorld(scene, renderer, {
        quality: stageQuality,
        mapId: wanted,
        onProgress: (progress, label) => reportProgress(progress, label),
      });
    } catch (error) {
      loading = false;
      if (disposed) throw error;
      console.error('[map-stage] failed to build map', wanted, error);
      reportError(error);
      throw error;
    }

    // The component may have been unmounted while the build was in flight.
    if (disposed) {
      try {
        nextWorld.dispose();
      } catch (error) {
        /* ignore */
      }
      throw new Error('[map-stage] stage disposed during map build');
    }

    world = nextWorld;
    mapId = typeof nextWorld.mapId === 'string' ? nextWorld.mapId : wanted;
    mapName = typeof nextWorld.mapName === 'string' ? nextWorld.mapName : mapId;
    style = typeof nextWorld.style === 'string' ? nextWorld.style : 'outpost';
    ready = true;
    loading = false;
    if (!keepCamera) resetCamera();
    reportProgress(1, 'MAP READY');
    if (!active) renderOnce();

    const manifest = manifestById.get(mapId) || {};
    return {
      id: mapId,
      name: mapName,
      subtitle: typeof manifest.subtitle === 'string' ? manifest.subtitle : '',
      style,
      format: typeof manifest.format === 'string' ? manifest.format : '',
    };
  }

  /**
   * Load / reload a map. Serialised: a request made while another build is in
   * flight runs after it (the component disables the map list meanwhile).
   *
   * @param {string} nextMapId registered map id (unknown ids fall back to the default)
   * @param {{keepCamera?: boolean}} [options] keep the current camera pose instead of
   *        snapping to the new map's spawn
   * @returns {Promise<{id:string,name:string,subtitle:string,style:string,format:string}>}
   */
  function loadMap(nextMapId, options = {}) {
    if (disposed) return Promise.reject(new Error('[map-stage] stage disposed'));
    const run = () => buildMap(nextMapId, options);
    loadChain = loadChain.then(run, run);
    return loadChain;
  }

  // -------------------------------------------------------------------------
  // Public controls
  // -------------------------------------------------------------------------
  /**
   * Start / stop the RAF loop + input handling. The scene and camera survive a
   * stop, so switching dev-tools tabs is instant when the map viewer comes back.
   * @param {boolean} next
   */
  function setActive(next) {
    const wantedActive = Boolean(next);
    if (wantedActive === active) {
      if (wantedActive) startLoop();
      return;
    }
    active = wantedActive;
    if (active) {
      startLoop();
    } else {
      stopLoop();
      clearInput();
    }
  }

  /**
   * Set the free-fly base speed (wheel and the React slider both land here).
   * @param {number} value m/s, clamped to MIN_SPEED..MAX_SPEED
   * @returns {number} the applied speed
   */
  function setSpeed(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) baseSpeed = clamp(numeric, MIN_SPEED, MAX_SPEED);
    return baseSpeed;
  }

  /**
   * Optional live quality switch (shadows only, like world.setQuality); the
   * App derives quality from the URL, so this is only used if that ever changes.
   * @param {string} value quality id
   */
  function setQuality(value) {
    if (!QUALITY_IDS.includes(value)) return stageQuality;
    stageQuality = value;
    renderer.shadowMap.enabled = value !== 'lowest';
    if (world && typeof world.setQuality === 'function') {
      try {
        world.setQuality(value);
      } catch (error) {
        console.warn('[map-stage] world.setQuality failed', error);
      }
    }
    return stageQuality;
  }

  // -------------------------------------------------------------------------
  // State snapshot (HUD / automation probes)
  // -------------------------------------------------------------------------
  /** @returns {object} live stats: camera + map identity + renderer counters */
  function state() {
    const position = camera.position;
    return {
      ready,
      mapId,
      mapName,
      style,
      position: [round(position.x), round(position.y), round(position.z)],
      yaw: round(yaw, 4),
      pitch: round(pitch, 4),
      speed: round(baseSpeed, 2),
      fps: Math.round(fps),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      textures: renderer.info.memory.textures,
      // Extras for probes / debugging (the HUD only uses the fields above).
      active,
      loading,
    };
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------
  function dispose() {
    if (disposed) return;
    disposed = true;
    active = false;
    stopLoop();
    clearInput();

    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('lostpointercapture', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('resize', resize);
    if (resizeObserver) resizeObserver.disconnect();

    if (world) {
      try {
        world.dispose();
      } catch (error) {
        console.warn('[map-stage] world.dispose() failed', error);
      }
      world = null;
    }
    ready = false;
    scene.environment = null;
    scene.fog = null;
    scene.background = null;

    // Release GL programs / buffers. The context itself is left alive on the
    // canvas so a React StrictMode remount can reuse the same <canvas> node —
    // forceContextLoss() would poison it for the second mount.
    try {
      renderer.dispose();
    } catch (error) {
      console.warn('[map-stage] renderer.dispose() failed', error);
    }
    canvas.style.cursor = 'grab';
  }

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('lostpointercapture', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('resize', resize);

  resize();

  // -------------------------------------------------------------------------
  // Controller
  // -------------------------------------------------------------------------
  return {
    /** Manifest summaries from src/world/data (id / name / subtitle / format / parts). */
    maps,
    /** Map ids accepted by loadMap() (unknown ids fall back to DEFAULT_MAP_ID). */
    defaultMapId: DEFAULT_MAP_ID,
    state,
    loadMap,
    setActive,
    resize,
    setSpeed,
    setQuality,
    resetCamera,
    dispose,
    debug: {
      get camera() {
        return camera;
      },
      get scene() {
        return scene;
      },
      get renderer() {
        return renderer;
      },
      get world() {
        return world;
      },
    },
  };
}
