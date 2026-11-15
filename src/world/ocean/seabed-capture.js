/**
 * SANDSTRIKE // tropical ocean — one-time seabed capture.
 *
 * Real refraction needs to know what is *under* the water. A screen-space refraction pass
 * would need an extra colour+depth prepass of the whole scene every frame; instead we bake
 * the seabed exactly once, while the world is being built, from an orthographic camera
 * looking straight down over the island:
 *
 *   - the island builders run before the ocean builder, so beach / lagoon / coral meshes
 *     already exist; we toggle every scene child invisible except the meshes tagged
 *     `userData.seabed === true` (name fallback for older terrain builds) and render them
 *     into a HalfFloat RGBA target,
 *   - the target is *linear* (three always renders non-XR targets with NoToneMapping and
 *     LinearSRGB output) and `uSeabedRect` unprojects world XZ back into it,
 *   - fog and the scene background are stashed to null during the capture: otherwise the
 *     orthographic distance to the camera would haze the baked bed,
 *   - all renderer/scene state is restored in a `finally`, and every failure path returns
 *     `null` so the water shader falls back to its procedural bed colour.
 */
import * as THREE from 'three';

/** Mesh names the ocean can fall back to while the terrain builder has not tagged yet. */
export const SEABED_MESH_NAMES = Object.freeze([
  'island-beach',
  'island-lagoon',
  'island-coral',
  'island-scatter',
  'island-tideline',
]);

/**
 * Collect the meshes that belong to the sea bed (tagged first, name fallback second).
 * @param {THREE.Scene} scene
 * @returns {THREE.Mesh[]}
 */
export function collectSeabedMeshes(scene) {
  const meshes = [];
  if (!scene || typeof scene.traverse !== 'function') return meshes;
  scene.traverse((node) => {
    if (!node || node.isMesh !== true) return;
    if (node.userData && node.userData.seabed === true) {
      meshes.push(node);
      return;
    }
    if (typeof node.name === 'string' && SEABED_MESH_NAMES.indexOf(node.name) !== -1) meshes.push(node);
  });
  return meshes;
}

/**
 * Render the seabed into a linear HalfFloat render target.
 *
 * @param {object} ctx world context (`scene`, `renderer`)
 * @param {{ resolution?: number, extent?: number }} [options]
 * @returns {{ target: THREE.WebGLRenderTarget, texture: THREE.Texture, extent: number, resolution: number, meshes: number } | null}
 */
export function captureSeabed(ctx, options = {}) {
  const renderer = ctx && ctx.renderer;
  const scene = ctx && ctx.scene;
  const resolution = Math.max(0, Math.floor(Number(options.resolution) || 0));
  if (!renderer || typeof renderer.render !== 'function' || !scene || resolution <= 0) return null;
  const extent = Math.max(16, Number(options.extent) || 130);
  const meshes = collectSeabedMeshes(scene);
  if (!meshes.length) return null;

  let target = null;
  try {
    target = new THREE.WebGLRenderTarget(resolution, resolution, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    target.texture.name = 'Sandstrike.SeabedCapture';
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    target.texture.wrapS = THREE.ClampToEdgeWrapping;
    target.texture.wrapT = THREE.ClampToEdgeWrapping;

    const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 0.1, 320);
    camera.position.set(0, 150, 0);
    // Looking straight down: +X maps to +U and -Z maps to +V, which `uSeabedRect`
    // (v = 0.5 - (z - cz) * inv) mirrors exactly.
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    // ------------------------------------------------------------- stash state
    const prevTarget = renderer.getRenderTarget();
    const prevTone = renderer.toneMapping;
    const prevAutoClear = renderer.autoClear;
    const prevClearColor = new THREE.Color(0, 0, 0);
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    const prevBackground = scene.background;
    const prevFog = scene.fog;
    const prevOverride = scene.overrideMaterial;
    const visibility = new Map();
    const setVisible = (node, visible) => {
      if (!node) return;
      if (!visibility.has(node)) visibility.set(node, node.visible);
      node.visible = visible;
    };

    // Only the seabed is rendered: hide every direct scene child (but KEEP the lights —
    // an invisible light is skipped by the renderer and would bake a black bed), then
    // re-enable the ancestor chain of each captured mesh (restored from the map after).
    for (const child of scene.children) {
      if (child.isLight === true) continue;
      setVisible(child, false);
    }
    for (const mesh of meshes) {
      let node = mesh;
      while (node && node !== scene) {
        setVisible(node, true);
        node = node.parent;
      }
    }

    try {
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.autoClear = true;
      // deep lagoon colour shows where no bed geometry exists (outside the bed radius)
      renderer.setClearColor(new THREE.Color(0.020, 0.075, 0.090), 1);
      scene.background = null;
      scene.fog = null;
      scene.overrideMaterial = null;
      renderer.setRenderTarget(target);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.toneMapping = prevTone;
      renderer.autoClear = prevAutoClear;
      renderer.setClearColor(prevClearColor, prevClearAlpha);
      scene.background = prevBackground;
      scene.fog = prevFog;
      scene.overrideMaterial = prevOverride;
      for (const [node, visible] of visibility) node.visible = visible;
    }

    return {
      target,
      texture: target.texture,
      extent,
      resolution,
      meshes: meshes.length,
    };
  } catch (error) {
    console.warn('[ocean] seabed capture failed — procedural bottom will be used', error);
    try {
      target?.dispose();
    } catch (disposeError) {
      /* ignore */
    }
    return null;
  }
}

export default captureSeabed;
