/**
 * SANDSTRIKE // cheap foliage life for the island leaf materials.
 *
 * Two shader hooks, injected into the alpha-tested leaf materials (broadleaf,
 * broadleafDark, frondLush, canopy*, vegLeaf*) through `onBeforeCompile`. Both are
 * "free" at the draw-call level: no extra objects, no extra passes, ~zero CPU per
 * frame (one shared time uniform), and no geometry rebuilds.
 *
 *  1) WIND SWAY (vertex). A world-space offset applied after the instance transform,
 *     so every instanced tree/plant moves with its own phase. Amplitude grows with
 *     height above the ground, so trunks stay planted while crowns breathe.
 *     The shadow map gets the same displacement through a matching custom depth
 *     material (`getFoliageDepthMaterial`), so canopy shadows move with the leaves.
 *
 *  2) BACKLIT TRANSLUCENCY (fragment). Leaves between the camera and the low morning
 *     sun get a warm transmission term (golden rim) instead of reading as flat opaque
 *     cards. It is added to `totalEmissiveRadiance` (so tone mapping/bloom handle it)
 *     and is deliberately weak in shadowed areas — it is a look cue, not a light.
 *
 * VERTEX-PACKED LEAVES (`vertexPacked: true`)
 * The procedural tree generator has no spare vertex attributes: `mergeGeometries`
 * only carries position/normal/uv/color. So the tree bakes its per-leaf data into the
 * one `color` attribute and this module consumes it instead of letting three multiply
 * it straight into the albedo:
 *     color.r = canopy AO        -> multiplied into diffuse (uFxAO strength)
 *     color.g = wind flex 0..1   -> scales the vertex sway amplitude
 *     color.b = hue 0..1         -> mix between uFxTintA (warm yellow-green) and
 *                                   uFxTintB (cool blue-green)
 * The per-instance tint that `makeInstanced` writes through `instanceColor` is
 * multiplied into vColor by three before this code runs; that only adds a few percent
 * of per-tree variation to AO/hue/flex, which is exactly what we want.
 */
import * as THREE from 'three';

/** Uniforms shared by every patched material (one object reference per program). */
const shared = {
  uFxTime: { value: 0 },
  uFxWind: { value: 1 },
};

/** Per-material uniform blocks kept for dispose bookkeeping. */
const registry = new Set();
const depthCache = new Map();

const DEFAULT_WIND = 0.13; // metres of crown-tip travel at full strength
const DEFAULT_GLOW = 0.42;

const vertexHead = /* glsl */ `
uniform float uFxTime;
uniform float uFxWind;
`;

/**
 * Replaces <project_vertex>: builds the same mvPosition chain but inserts a world-space
 * sway offset between the instance matrix and the view matrix. Kept byte-identical to
 * three r170 otherwise (no batching path — the island models never use BatchedMesh).
 */
function projectVertexSource(useFlex) {
  const flex = useFlex
    ? /* glsl */ `
  float fxFlex = 1.0;
  #ifdef USE_COLOR
    fxFlex = 0.35 + 0.65 * color.g;
  #endif
`
    : '';
  return /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
{
  vec4 fxWorld = modelMatrix * mvPosition;
  float fxH = clamp( ( fxWorld.y - 0.25 ) * 0.085, 0.0, 1.0 );
  float fxPhase = fxWorld.x * 0.31 + fxWorld.z * 0.23;
  float fxS = sin( uFxTime * 1.15 + fxPhase ) * 0.62 + sin( uFxTime * 2.37 + fxPhase * 1.7 ) * 0.38;
  float fxAmp = uFxWind * fxH * fxH;${flex}
  fxWorld.xyz += vec3( 0.70, 0.10, 0.52 ) * ( fxS * fxAmp );
  mvPosition = viewMatrix * fxWorld;
}
gl_Position = projectionMatrix * mvPosition;
`;
}

const lightHead = /* glsl */ `
uniform float uFxGlow;
uniform vec3 uFxTransTint;
`;

/** Appended to <lights_fragment_end>; inside main(), after the direct/indirect loops. */
const lightTail = /* glsl */ `
#if NUM_DIR_LIGHTS > 0
{
  vec3 fxViewDir = normalize( vViewPosition );
  vec3 fxSunDir = directionalLights[ 0 ].direction;
  vec3 fxSunCol = directionalLights[ 0 ].color;
  float fxBack = max( dot( -fxViewDir, fxSunDir ), 0.0 );
  float fxThrough = pow( fxBack, 3.0 );
  // cards edge-on to the sun transmit the most; sun-facing cards the least
  float fxSpread = 1.0 - abs( dot( normal, fxSunDir ) ) * 0.72;
  vec3 fxTrans = diffuseColor.rgb * uFxTransTint;
  totalEmissiveRadiance += fxTrans * fxSunCol * uFxGlow * ( 0.12 + 0.88 * fxThrough ) * fxSpread;
}
#endif
`;

/** Replaces <color_fragment> for vertex-packed leaves: consume channels as semantics. */
const packedColorFragment = /* glsl */ `
#ifdef USE_COLOR
  float fxAO = mix( 1.0, clamp( vColor.r, 0.0, 1.0 ), uFxAO );
  vec3 fxHue = mix( uFxTintA, uFxTintB, clamp( vColor.b, 0.0, 1.0 ) );
  diffuseColor.rgb *= fxAO * fxHue;
#endif
`;

const packedHead = /* glsl */ `
uniform float uFxAO;
uniform vec3 uFxTintA;
uniform vec3 uFxTintB;
`;

/**
 * Patch one foliage material.
 * @param {THREE.MeshStandardMaterial} material
 * @param {object} [opts]
 * @param {number} [opts.wind]  crown-tip sway in metres
 * @param {number} [opts.glow]  translucency strength
 * @param {[number,number,number]} [opts.tint]  transmission colour multiplier
 * @param {boolean} [opts.vertexPacked]  read AO/flex/hue out of the vertex colour
 * @param {number} [opts.ao]    how strongly color.r darkens the leaf (0..1)
 * @param {[number,number,number]} [opts.hueA] warm end of the hue mix
 * @param {[number,number,number]} [opts.hueB] cool end of the hue mix
 */
export function applyFoliageFx(material, {
  wind = DEFAULT_WIND,
  glow = DEFAULT_GLOW,
  tint = [1.45, 1.32, 0.66],
  vertexPacked = false,
  ao = 1,
  hueA = [1.12, 1.04, 0.80],
  hueB = [0.92, 1.02, 0.95],
} = {}) {
  if (!material || !material.isMaterial) return material;
  const uniforms = {
    ...shared,
    uFxGlow: { value: glow },
    uFxTransTint: { value: new THREE.Vector3(tint[0], tint[1], tint[2]) },
  };
  if (vertexPacked) {
    uniforms.uFxAO = { value: ao };
    uniforms.uFxTintA = { value: new THREE.Vector3(hueA[0], hueA[1], hueA[2]) };
    uniforms.uFxTintB = { value: new THREE.Vector3(hueB[0], hueB[1], hueB[2]) };
  }
  const projectVertex = projectVertexSource(vertexPacked);
  material.userData.foliageFx = { uniforms, vertexPacked };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexHead}`)
      .replace('#include <project_vertex>', projectVertex);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${lightHead}${vertexPacked ? packedHead : ''}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${lightTail}`);
    if (vertexPacked) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', packedColorFragment);
    }
  };
  // same injected source for all foliage materials -> they share one program per mode
  material.customProgramCacheKey = () => (vertexPacked ? 'sandstrike-foliage-fx-packed-v1' : 'sandstrike-foliage-fx-v1');
  registry.add(uniforms);
  return material;
}

/** Advance the shared wind clock (call once per frame from the world update). */
export function updateFoliageFx(time) {
  shared.uFxTime.value = time;
}

/** Global wind strength multiplier (dimmed on the low quality tiers). */
export function setFoliageWindScale(scale) {
  shared.uFxWind.value = Number.isFinite(scale) ? Math.max(0, scale) : 1;
}

/** Drop the per-material registry before a texture/material rebuild (dispose path). */
export function resetFoliageFx() {
  registry.clear();
  for (const dm of depthCache.values()) dm.dispose();
  depthCache.clear();
}

// ---------------------------------------------------------------------------
// shadow depth twin: without it the leaves sway but their shadows stay frozen
// ---------------------------------------------------------------------------

/**
 * Depth material that runs the SAME wind displacement as the colour material, so the
 * cut-out canopy shadow moves with the leaves. three r170 only auto-clones the depth
 * material to copy `map`/`alphaTest`; the vertex hook has to come from us.
 *
 * Returned material is cached per surface material; assign it to
 * `mesh.customDepthMaterial` (makeInstanced does this automatically when the material
 * has a `userData.foliageFx` block).
 */
export function getFoliageDepthMaterial(material) {
  const hit = depthCache.get(material.uuid);
  if (hit) return hit;
  const fx = material.userData.foliageFx || {};
  const packed = !!fx.vertexPacked;
  const dm = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: material.map || null,
    alphaTest: material.alphaTest || 0,
    side: material.side,
    // the depth pass must see the same `color` attribute for the flex channel,
    // otherwise shaded leaves would sway further than their colour geometry
    vertexColors: packed ? !!material.vertexColors : false,
  });
  const projectVertex = projectVertexSource(packed);
  dm.onBeforeCompile = (shader) => {
    shader.uniforms.uFxTime = shared.uFxTime;
    shader.uniforms.uFxWind = shared.uFxWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexHead}`)
      .replace('#include <project_vertex>', projectVertex);
  };
  dm.customProgramCacheKey = () => (packed ? 'sandstrike-foliage-depth-packed-v1' : 'sandstrike-foliage-depth-v1');
  depthCache.set(material.uuid, dm);
  material.addEventListener('dispose', () => {
    const dead = depthCache.get(material.uuid);
    if (dead) {
      depthCache.delete(material.uuid);
      dead.dispose();
    }
  });
  return dm;
}

export default applyFoliageFx;
