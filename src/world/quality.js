/**
 * SANDSTRIKE // sandstorm protocol — world quality presets.
 *
 * Split verbatim out of src/world.js (QUALITY_SETTINGS). These are renderer
 * budgets, independent of map data: shadow map size, dust mote counts and the
 * practical-light cap consumed by createWorld / buildDust / buildPracticalLights.
 */

export const QUALITY_SETTINGS = {
  lowest: { shadowMap: 512, dust: 140, motes: 160, anisotropy: 2, lights: 3 },
  low: { shadowMap: 1024, dust: 280, motes: 320, anisotropy: 4, lights: 5 },
  medium: { shadowMap: 2048, dust: 420, motes: 500, anisotropy: 4, lights: 6 },
  high: { shadowMap: 4096, dust: 700, motes: 800, anisotropy: 8, lights: 8 },
  ultra: { shadowMap: 4096, dust: 950, motes: 1100, anisotropy: 16, lights: 8 },
};
