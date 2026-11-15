/**
 * SANDSTRIKE // tropical ocean — per-quality-tier budgets.
 *
 * The ocean is the most expensive island visual, so every scalable knob lives here:
 * the build-time seabed capture resolution, the radial surface grid density, how many
 * swell/chop trains the shader carries, the surf + wet-sand band tessellation, and the
 * optional animated caustics. `buildIslandWater(ctx)` picks the row for `ctx.quality`.
 *
 * LOWEST has no capture at all (`capture: 0`): the water still reads as clear turquoise
 * water over a procedural sand/weed bed, it just does not show the real seabed texture.
 *
 * `denseOuter`/`spacing` control the shore-side grid ring spacing (metres); outward of
 * `denseOuter` the ring spacing grows quadratically to `horizonRadius` so the far sea
 * costs a handful of rings instead of thousands of triangles.
 */

/** Ocean budget per quality tier. Frozen so a builder can never mutate the table. */
export const OCEAN_TIERS = Object.freeze({
  lowest: Object.freeze({
    capture: 0, // procedural bottom only
    captureExtent: 130,
    segments: 112,
    gridInner: 41,
    denseOuter: 84,
    spacing: 2.6,
    growth: 0.16,
    horizonRadius: 470,
    waveTrains: 2,
    chopTrains: 2,
    refractSteps: 1,
    caustics: 0,
    surfSegments: 112,
    surfSpacing: 2.4,
    wetSegments: 96,
    wetSpacing: 2.0,
  }),
  low: Object.freeze({
    capture: 512,
    captureExtent: 130,
    segments: 144,
    gridInner: 41,
    denseOuter: 84,
    spacing: 1.8,
    growth: 0.15,
    horizonRadius: 470,
    waveTrains: 3,
    chopTrains: 3,
    refractSteps: 2,
    caustics: 1,
    surfSegments: 144,
    surfSpacing: 1.7,
    wetSegments: 112,
    wetSpacing: 1.6,
  }),
  medium: Object.freeze({
    capture: 1024,
    captureExtent: 130,
    segments: 192,
    gridInner: 41,
    denseOuter: 86,
    spacing: 1.2,
    growth: 0.14,
    horizonRadius: 470,
    waveTrains: 4,
    chopTrains: 4,
    refractSteps: 2,
    caustics: 1,
    surfSegments: 192,
    surfSpacing: 1.15,
    wetSegments: 144,
    wetSpacing: 1.2,
  }),
  high: Object.freeze({
    capture: 2048,
    captureExtent: 130,
    segments: 256,
    gridInner: 41,
    denseOuter: 88,
    spacing: 0.9,
    growth: 0.13,
    horizonRadius: 470,
    waveTrains: 5,
    chopTrains: 4,
    refractSteps: 2,
    caustics: 1,
    surfSegments: 256,
    surfSpacing: 0.85,
    wetSegments: 192,
    wetSpacing: 0.9,
  }),
  ultra: Object.freeze({
    capture: 2048,
    captureExtent: 130,
    segments: 320,
    gridInner: 41,
    denseOuter: 90,
    spacing: 0.7,
    growth: 0.12,
    horizonRadius: 470,
    waveTrains: 6,
    chopTrains: 4,
    refractSteps: 2,
    caustics: 1,
    surfSegments: 320,
    surfSpacing: 0.65,
    wetSegments: 224,
    wetSpacing: 0.7,
  }),
});

/** Resolve the ocean budget for a quality id (unknown ids fall back to `medium`). */
export function oceanTier(quality) {
  return OCEAN_TIERS[quality] || OCEAN_TIERS.medium;
}

export default oceanTier;
