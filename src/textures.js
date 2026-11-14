/**
 * SANDSTRIKE // procedural texture library — public entry point.
 *
 * The implementation was split into one module per material under src/textures/:
 *   core.js           shared canvas / noise / texture helpers
 *   cloth-common.js   fold, tear and stencil helpers for fabric
 *   atlas.js          cell helpers for poster & decal atlases
 *   sand / adobe / stone / paving / wood / crate / metal / rust / sheet-metal /
 *   sandbag / cloth / banners / posters / decals / rubber / palm
 *   index.js          createTextureLibrary() assembly
 *
 * Tune a single material by editing its own file; nothing else needs to change.
 */
export { createTextureLibrary } from './textures/index.js';
