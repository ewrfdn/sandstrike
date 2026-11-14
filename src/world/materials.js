/**
 * SANDSTRIKE // sandstorm protocol — world material library.
 *
 * Split verbatim out of src/world.js (createMaterials). Builds the shared
 * MeshStandardMaterial / ShaderMaterial set from the procedural texture library.
 * No map data is involved: one set of materials is shared by every world builder.
 */
import * as THREE from 'three';
import { stdMaterial } from '../models/core.js';
import { applyFoliageFx, resetFoliageFx } from './foliage-fx.js';

function createMaterials(tex) {
  resetFoliageFx();
  const M = {};
  M.sand = stdMaterial(tex.sand, { name: 'sand', vertexColors: true, envMapIntensity: 0.45, normalScale: 0.4 });
  M.sandDune = stdMaterial(tex.sand, { name: 'sandDune', vertexColors: true, color: 0xd8ba8e, envMapIntensity: 0.35, normalScale: 0.4 });
  M.sandDark = stdMaterial(tex.sand, { name: 'sandDark', vertexColors: true, color: 0xb38a5e, envMapIntensity: 0.3, normalScale: 0.35 });
  M.adobe = stdMaterial(tex.adobe, { name: 'adobe', vertexColors: true, envMapIntensity: 0.4 });
  M.adobeLight = stdMaterial(tex.adobe, { name: 'adobeLight', vertexColors: true, color: 0xe2c9a4, envMapIntensity: 0.45 });
  M.adobeDark = stdMaterial(tex.adobe, { name: 'adobeDark', color: 0x74573c, envMapIntensity: 0.22 });
  M.stone = stdMaterial(tex.stone, { name: 'stone', vertexColors: true, envMapIntensity: 0.45 });
  M.stoneDark = stdMaterial(tex.stone, { name: 'stoneDark', color: 0xb0a48e, envMapIntensity: 0.4 });
  M.paving = stdMaterial(tex.paving, { name: 'paving', envMapIntensity: 0.4 });
  M.wood = stdMaterial(tex.wood, { name: 'wood', vertexColors: true, envMapIntensity: 0.4 });
  M.woodDark = stdMaterial(tex.wood, { name: 'woodDark', color: 0x8f8378, vertexColors: true, envMapIntensity: 0.35 });
  M.crate = stdMaterial(tex.crate, { name: 'crate', envMapIntensity: 0.45 });
  M.metal = stdMaterial(tex.metal, { name: 'metal', envMapIntensity: 1.15 });
  M.metalDark = stdMaterial(tex.metal, { name: 'metalDark', color: 0x9a9484, envMapIntensity: 1.0 });
  M.rust = stdMaterial(tex.rust, { name: 'rust', envMapIntensity: 0.95 });
  M.sheet = stdMaterial(tex.sheet, { name: 'sheet', envMapIntensity: 1.15, side: THREE.DoubleSide });
  M.sandbag = stdMaterial(tex.sandbag, { name: 'sandbag', color: 0xd2c2a2, envMapIntensity: 0.3 });
  M.awning = stdMaterial(tex.cloth.awning, {
    name: 'awning', envMapIntensity: 0.3, side: THREE.DoubleSide, roughness: 1,
  });
  M.tarp = stdMaterial(tex.cloth.tarp, {
    name: 'tarp', envMapIntensity: 0.28, side: THREE.DoubleSide, roughness: 1,
  });
  M.shade = stdMaterial(tex.cloth.shade, {
    name: 'shade', envMapIntensity: 0.32, side: THREE.DoubleSide, roughness: 1, alphaTest: 0.12,
  });
  M.frond = stdMaterial(tex.frond, {
    color: 0xe8dfc4,
    name: 'frond', envMapIntensity: 0.3, side: THREE.DoubleSide, alphaTest: 0.42, roughness: 1,
  });
  M.bark = stdMaterial(tex.wood, { name: 'bark', color: 0x9c8466, vertexColors: true, envMapIntensity: 0.3 });
  M.palmTrunk = stdMaterial(tex.palmTrunk, { name: 'palmTrunk', envMapIntensity: 0.2 });
  M.rubber = stdMaterial(tex.rubber, { name: 'rubber', envMapIntensity: 0.25, roughness: 1 });
  M.bannerA = stdMaterial(tex.banners.a, {
    name: 'bannerA', envMapIntensity: 0.25, side: THREE.DoubleSide, alphaTest: 0.35, roughness: 1,
  });
  M.bannerB = stdMaterial(tex.banners.b, {
    name: 'bannerB', envMapIntensity: 0.25, side: THREE.DoubleSide, alphaTest: 0.35, roughness: 1,
  });
  M.bannerTitle = stdMaterial(tex.banners.title, {
    name: 'bannerTitle', envMapIntensity: 0.25, side: THREE.DoubleSide, alphaTest: 0.3, roughness: 1,
  });
  M.bannerWarn = stdMaterial(tex.banners.warn, {
    name: 'bannerWarn', envMapIntensity: 0.25, side: THREE.DoubleSide, alphaTest: 0.3, roughness: 1,
  });
  M.poster = stdMaterial({ map: tex.posterAtlas.texture }, {
    name: 'poster', envMapIntensity: 0.3, side: THREE.DoubleSide, alphaTest: 0.35, roughness: 1,
    polygonOffset: [-2, -2],
  });
  M.decal = stdMaterial({ map: tex.decalAtlas.texture }, {
    name: 'decal',
    color: 0xe8d7ba, envMapIntensity: 0.35, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    roughness: 1, metalness: 0, polygonOffset: [-4, -4],
  });
  M.glass = new THREE.MeshStandardMaterial({
    name: 'glass', color: 0x16222b, metalness: 0.55, roughness: 0.12, transparent: true, opacity: 0.62,
    envMapIntensity: 2.0, depthWrite: false,
  });
  M.water = new THREE.MeshStandardMaterial({
    name: 'water', color: 0x0d1e22, metalness: 0.95, roughness: 0.08, envMapIntensity: 1.6,
  });
  M.glowWarm = new THREE.MeshStandardMaterial({
    name: 'glowWarm', color: 0x2a1a0a, emissive: 0xffa64d, emissiveIntensity: 3.4,
    roughness: 0.55, metalness: 0, envMapIntensity: 0.4,
  });
  M.glowCyan = new THREE.MeshStandardMaterial({
    name: 'glowCyan', color: 0x0a1a1e, emissive: 0x6fe8ff, emissiveIntensity: 3.6,
    roughness: 0.5, metalness: 0, envMapIntensity: 0.4,
  });
  M.coals = new THREE.MeshStandardMaterial({
    name: 'coals', color: 0x1a0a04, emissive: 0xff5a1f, emissiveIntensity: 2.6, roughness: 0.9, metalness: 0,
  });
  M.rock = stdMaterial(tex.stone, { name: 'rock', color: 0xc2a27c, envMapIntensity: 0.35 });
  M.dark = new THREE.MeshStandardMaterial({ name: 'dark', color: 0x1b1610, roughness: 1, metalness: 0, envMapIntensity: 0.15 });
  M.canvasDark = stdMaterial(tex.cloth.tarp, { name: 'canvasDark', color: 0x8a8a80, side: THREE.DoubleSide, envMapIntensity: 0.25 });

  // -------------------------------------------------------------------------
  // ISLAND / TROPICAL set (see ISLAND_ASSETS.md §5).
  // New tropical textures are registered by src/textures/island-flora.js and
  // src/textures/island-structure.js; every key below falls back to an existing
  // set with `??` so the stage and the outpost map keep rendering while the new
  // texture modules are being authored. Once `lib.<key>` exists the fallback is
  // never taken, so no wiring change is needed after delivery.
  // -------------------------------------------------------------------------
  M.jungleGrass = stdMaterial(tex.jungleGrass ?? tex.sand, {
    name: 'jungleGrass', vertexColors: true, envMapIntensity: 0.25, normalScale: 0.5,
  });
  M.leafLitter = stdMaterial(tex.leafLitter ?? tex.sand, {
    name: 'leafLitter', vertexColors: true, color: 0xd8ccb0, envMapIntensity: 0.22, normalScale: 0.5,
  });
  // Alpha-tested leaf cards: alphaTest is also read by the shadow depth material in
  // three r170, so canopy cards cast cut-out shadows instead of solid slabs.
  // The island atlas already carries its own painted green; tints stay near-white so
  // the material colour does not double-darken it (see ISLAND_ASSETS.md §5).
  M.broadleaf = stdMaterial(tex.broadleaf ?? tex.frond, {
    name: 'broadleaf', color: 0xdfebc5, envMapIntensity: 0.3, side: THREE.DoubleSide, alphaTest: 0.4, roughness: 1,
  });
  M.broadleafDark = stdMaterial(tex.broadleaf ?? tex.frond, {
    name: 'broadleafDark', color: 0xa8bd8b, envMapIntensity: 0.26, side: THREE.DoubleSide, alphaTest: 0.4, roughness: 1,
  });
  M.frondLush = stdMaterial(tex.tropicalFrond ?? tex.frond, {
    name: 'frondLush', color: 0xe0f0c4, envMapIntensity: 0.3, side: THREE.DoubleSide, alphaTest: 0.42, roughness: 1,
  });
  // Canopy cluster atlas (lib.canopy): one card = a twig with 6-18 leaves, so the tree
  // crowns read dense at a fraction of the single-leaf card count. `canopyPale` is the
  // young sunlit flush used on the crown tops, `canopyDark` the shaded underside.
  M.canopy = stdMaterial(tex.canopy ?? tex.broadleaf ?? tex.frond, {
    name: 'canopy', color: 0xd8e8bc, envMapIntensity: 0.3, side: THREE.DoubleSide, alphaTest: 0.4, roughness: 1,
  });
  M.canopyDark = stdMaterial(tex.canopy ?? tex.broadleaf ?? tex.frond, {
    name: 'canopyDark', color: 0x9fb884, envMapIntensity: 0.24, side: THREE.DoubleSide, alphaTest: 0.4, roughness: 1,
  });
  M.canopyPale = stdMaterial(tex.canopy ?? tex.broadleaf ?? tex.frond, {
    name: 'canopyPale', color: 0xf0f4cc, envMapIntensity: 0.32, side: THREE.DoubleSide, alphaTest: 0.4, roughness: 1,
  });
  // Vertex-colour variants used by the procedural tree generator ONLY. They carry a
  // baked `color` attribute (r = canopy AO, g = wind flex, b = hue jitter) and therefore
  // MUST have vertexColors on — a geometry without a color attribute would render black.
  // Never assign these to understory models (use the M.canopy* set instead).
  M.vegLeaf = stdMaterial(tex.canopy ?? tex.broadleaf ?? tex.frond, {
    name: 'vegLeaf', vertexColors: true, color: 0xffffff, envMapIntensity: 0.3,
    side: THREE.DoubleSide, alphaTest: 0.4, roughness: 1,
  });
  M.vegLeafDark = stdMaterial(tex.canopy ?? tex.broadleaf ?? tex.frond, {
    name: 'vegLeafDark', vertexColors: true, color: 0x8fa877, envMapIntensity: 0.24,
    side: THREE.DoubleSide, alphaTest: 0.4, roughness: 1,
  });
  M.vegLeafPale = stdMaterial(tex.canopy ?? tex.broadleaf ?? tex.frond, {
    name: 'vegLeafPale', vertexColors: true, color: 0xf2f6d0, envMapIntensity: 0.32,
    side: THREE.DoubleSide, alphaTest: 0.4, roughness: 1,
  });
  M.thatch = stdMaterial(tex.thatch ?? tex.sandbag, {
    name: 'thatch', color: 0xfff4e0, envMapIntensity: 0.2, side: THREE.DoubleSide, roughness: 1,
  });
  // Ground-cover blade cards (lib.grassBlade): one card is a whole tuft of 15-24 blades.
  M.grassBlade = stdMaterial(tex.grassBlade ?? tex.broadleaf ?? tex.frond, {
    name: 'grassBlade', color: 0xe4f0c8, envMapIntensity: 0.28, side: THREE.DoubleSide, alphaTest: 0.35, roughness: 1,
  });
  M.grassBladeDry = stdMaterial(tex.grassBlade ?? tex.broadleaf ?? tex.frond, {
    name: 'grassBladeDry', color: 0xd8c9a2, envMapIntensity: 0.24, side: THREE.DoubleSide, alphaTest: 0.35, roughness: 1,
  });
  M.thatchDark = stdMaterial(tex.thatch ?? tex.sandbag, {
    name: 'thatchDark', color: 0xcbb693, envMapIntensity: 0.18, side: THREE.DoubleSide, roughness: 1,
  });
  M.barkTrop = stdMaterial(tex.tropicalBark ?? tex.wood, {
    name: 'barkTrop', vertexColors: true, envMapIntensity: 0.2,
  });
  M.barkMoss = stdMaterial(tex.tropicalBark ?? tex.wood, {
    name: 'barkMoss', vertexColors: true, color: 0xd2d8bc, envMapIntensity: 0.2,
  });
  M.bamboo = stdMaterial(tex.bamboo ?? tex.wood, {
    name: 'bamboo', envMapIntensity: 0.3, roughness: 0.85,
  });
  M.mossStone = stdMaterial(tex.mossStone ?? tex.stone, {
    name: 'mossStone', vertexColors: true, envMapIntensity: 0.25,
  });
  M.ruinStone = stdMaterial(tex.mossStone ?? tex.stone, {
    name: 'ruinStone', color: 0xe4e0d2, vertexColors: true, envMapIntensity: 0.3,
  });
  // Second ruin key, painted on the SAME volcanic masonry texture instead of the desert
  // `stone` set. Audit pass-2 (D-05) found the ruins mixing `ruinStone` (moss-stone) with
  // the shared desert `stoneDark` — two unrelated stone textures side by side, which read
  // as a black/white checkerboard. Island ruins now use ruinStone + ruinStoneDark only.
  M.ruinStoneDark = stdMaterial(tex.mossStone ?? tex.stone, {
    name: 'ruinStoneDark', color: 0xbfb6a4, vertexColors: true, envMapIntensity: 0.26,
  });
  M.shoreRock = stdMaterial(tex.mossStone ?? tex.stone, {
    name: 'shoreRock', color: 0xc6c2b6, envMapIntensity: 0.3,
  });
  M.beachSand = stdMaterial(tex.beachSand ?? tex.sand, {
    name: 'beachSand', color: 0xf6eed6, vertexColors: true, envMapIntensity: 0.4, normalScale: 0.4,
  });
  M.woven = stdMaterial(tex.woven ?? tex.cloth.awning, {
    name: 'woven', color: 0xf2ddb8, envMapIntensity: 0.25, side: THREE.DoubleSide, roughness: 1,
  });
  M.rope = stdMaterial(tex.woven ?? tex.cloth.awning, {
    name: 'rope', color: 0xd8bc8c, envMapIntensity: 0.2, roughness: 1,
  });
  M.driftWood = stdMaterial(tex.wood, {
    name: 'driftWood', color: 0xb9b2a0, vertexColors: true, envMapIntensity: 0.25,
  });
  M.mud = stdMaterial(tex.leafLitter ?? tex.sand, {
    name: 'mud', color: 0x8c7458, vertexColors: true, envMapIntensity: 0.15, roughness: 1,
  });

  // --------------------------------------------------------------- foliage life
  // Wind sway + backlit transmission on the alpha-tested leaf materials only (see
  // src/world/foliage-fx.js). Canopy clusters get a stronger transmission than the
  // single-leaf cards; bark / thatch / stone are deliberately left untouched.
  applyFoliageFx(M.broadleaf, { wind: 0.13, glow: 0.40, tint: [1.45, 1.32, 0.66] });
  applyFoliageFx(M.broadleafDark, { wind: 0.11, glow: 0.28, tint: [1.28, 1.20, 0.60] });
  applyFoliageFx(M.frondLush, { wind: 0.17, glow: 0.46, tint: [1.34, 1.46, 0.62] });
  applyFoliageFx(M.canopy, { wind: 0.13, glow: 0.48, tint: [1.50, 1.34, 0.62] });
  applyFoliageFx(M.canopyDark, { wind: 0.11, glow: 0.28, tint: [1.26, 1.18, 0.56] });
  applyFoliageFx(M.canopyPale, { wind: 0.13, glow: 0.60, tint: [1.68, 1.52, 0.74] });
  applyFoliageFx(M.vegLeaf, { wind: 0.15, glow: 0.52, tint: [1.52, 1.36, 0.62], vertexPacked: true, ao: 1 });
  applyFoliageFx(M.vegLeafDark, { wind: 0.13, glow: 0.30, tint: [1.26, 1.18, 0.56], vertexPacked: true, ao: 1 });
  applyFoliageFx(M.vegLeafPale, { wind: 0.15, glow: 0.64, tint: [1.70, 1.54, 0.76], vertexPacked: true, ao: 1 });
  applyFoliageFx(M.grassBlade, { wind: 0.05, glow: 0.30, tint: [1.30, 1.30, 0.70] });
  applyFoliageFx(M.grassBladeDry, { wind: 0.045, glow: 0.22, tint: [1.22, 1.18, 0.66] });

  return M;
}

export { createMaterials };
export default createMaterials;
