/**
 * SANDSTRIKE // tropical island geometry helpers (pure math, no three).
 *
 * The reef-rock boundary belt is gone — there is no collision ring to derive any more, so
 * the old `resolveBoundary` / `boundarySegments` / `islandRingBoxes` / `playRadius` /
 * `isInsidePlayRing` helpers were deleted with it. Everything shoreline-related now lives in
 * `island-shore.js` (the shared height profile + wading guard). What remains here is the one
 * cheap accessor `island-water.js` uses before the shared profile is built.
 *
 * Keep this module `three`-free: it is imported by the Node map checker.
 */

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Distance from the origin to the water line (metres). */
export function landRadius(terrain = {}) {
  return num(terrain?.island?.landRadius, 62);
}
