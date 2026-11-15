/**
 * SANDSTRIKE // level format adapter: `sandstrike/map@2` — tropical island.
 *
 * Same folder contract as v1 (manifest + the six part files) but a different world:
 * a closed, water-ringed island built from the ISLAND asset drop. Only what actually
 * differs from v1 is re-authored; the environment part still uses the v1
 * `buildSky/buildLights/buildEnvironment` shape, so those builders are reused verbatim.
 *
 * Key design rule: **maps place instances, the adapter derives collision.** Every
 * placement list under `architecture.json` / `props.json` is normalised into
 * `layout.island.*`, and `islandCollisionBoxes()` turns it into AABB colliders using the
 * footprint table below. There is no reef-ring collider any more: the shoreline is open and
 * the player is stopped by the wading guard (`island-shore.js`), which is an exact radial
 * clamp, not a ring of invisible boxes. Data files therefore stay tiny and readable, and
 * colliders can never drift from the visuals' documented footprints.
 *
 * Output shape (consumed by src/world/index.js + the model builders):
 *
 *   { id, name, subtitle, description, format, style: 'island',
 *     collisionBoxes, playerSpawn, enemySpawns, mapBounds, landmarks, warnings,
 *     layout: { island: {...}, crates, barrels, lowWalls, stalls, hero: { campfire } },
 *     terrain, environment, dressing }
 *
 * Pure data module: no `three`, no DOM — importable from Node for map checks.
 */
import { deepClone, withDefaults } from '../schema.js';
import {
  DRESSING_DEFAULTS,
  ENVIRONMENT_DEFAULTS,
  SPAWN_RESOLVE_DEFAULTS,
} from './v1.js';
import { buildWarnings, resolveEnemySpawns } from '../collision.js';

export const FORMAT = 'sandstrike/map@2';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- terrain defaults
// No `boundary` block: the reef-ring collider and its boulders do not exist any more. The
// island's `landRadius` is the legal placement radius (jetties may still reach past it into
// the water; the validator in `data/index.js` allows that with an explicit allowance).
export const ISLAND_TERRAIN_DEFAULTS = Object.freeze({
  island: Object.freeze({
    grassRadius: 41,
    beachInner: 38,
    landRadius: 62,
    seed: 7712,
    segments: 140,
  }),
  sea: Object.freeze({
    level: -0.38,
    bedOuter: 96,
    bedDrop: -7.5,
    shallow: Object.freeze([0.10, 0.34, 0.32]),
    deep: Object.freeze([0.02, 0.09, 0.13]),
    distance: 420,
  }),
  colors: Object.freeze({
    grass: Object.freeze([0.42, 0.62, 0.36]),
    sand: Object.freeze([0.92, 0.84, 0.66]),
    seabed: Object.freeze([0.72, 0.68, 0.52]),
    rock: Object.freeze([0.30, 0.32, 0.28]),
  }),
});

// ------------------------------------------------------- placement key grouping
export const ISLAND_LAYOUT_KEYS = Object.freeze({
  flora: Object.freeze([
    'jungleTrees', 'coconutPalms', 'vineDrapes', 'bananaPlants', 'fernClumps',
    'bambooClumps', 'bushes', 'fallenLogs', 'grassTufts',
  ]),
  village: Object.freeze(['huts', 'hutRuins', 'fences', 'dryingRacks', 'walkways', 'totems']),
  ruins: Object.freeze(['ruinWalls', 'ruinArches', 'ruinTowers', 'ruinIdols', 'ruinColumns']),
  shore: Object.freeze(['shoreRocks', 'jetties', 'canoes', 'driftwood', 'wrecks']),
});
export const ISLAND_MODEL_KEYS = Object.freeze([
  ...ISLAND_LAYOUT_KEYS.flora,
  ...ISLAND_LAYOUT_KEYS.village,
  ...ISLAND_LAYOUT_KEYS.ruins,
  ...ISLAND_LAYOUT_KEYS.shore,
]);

/** Reused desert-prop keys the island map may feed into the legacy builders. */
export const ISLAND_REUSE_KEYS = Object.freeze(['crates', 'barrels', 'lowWalls', 'stalls', 'campfires']);

// --------------------------------------------------------------- collision helpers
const round3 = (value) => +Number(value).toFixed(3);

/** Axis-aligned bounds of a yaw-rotated rectangle (XZ footprint only). */
export function rotatedAabb(x, z, w, d, ry = 0) {
  const c = Math.abs(Math.cos(ry));
  const s = Math.abs(Math.sin(ry));
  const W = w * c + d * s;
  const D = w * s + d * c;
  return { minX: x - W / 2, maxX: x + W / 2, minZ: z - D / 2, maxZ: z + D / 2 };
}

/**
 * Footprint table: what each island model contributes to the collision set.
 *
 * Units are metres; `item.s` scales everything. `y0` lets elevated decks (jetties,
 * walkways) be stepped onto by the player (support tops <= 0.32 m) while still blocking
 * robot navigation.
 *
 * Structures only: solid vegetation (jungle trees, coconut palms, bamboo clumps and
 * fallen logs) is derived by the separate table further down so the two concerns can be
 * tuned independently.
 */
const FOOTPRINTS = Object.freeze({
  // ---------------------------------------------------------------- village
  huts: (out, item) => boxRot(out, item, 5.2, 4.6, 2.9, 'wood'),
  hutRuins: (out, item) => boxRot(out, item, 4.2, 3.6, 2.2, 'wood'),
  fences: (out, item) => boxRot(out, item, 4.3, 0.4, 1.5, 'wood'),
  dryingRacks: (out, item) => boxRot(out, item, 2.9, 1.5, 1.6, 'wood'),
  walkways: (out, item) => boxRot(out, item, 6.3, 2.0, 0.3, 'wood', 0),
  totems: (out, item) => boxRot(out, item, 1.05, 1.05, 3.2, 'wood'),
  // ----------------------------------------------------------------- ruins
  ruinWalls: (out, item) => boxRot(out, item, 6.0, 1.25, 3.2, 'stone'),
  ruinArches: (out, item) => {
    const off = 2.2 * (item.s ?? 1);
    const c = Math.cos(item.ry ?? 0);
    const s = Math.sin(item.ry ?? 0);
    for (const side of [-1, 1]) {
      box(out, item.x + c * off * side, item.z - s * off * side, 0.95, 1.1, 5.0, 'stone', 0, item.s ?? 1);
    }
  },
  ruinTowers: (out, item) => boxRot(out, item, 5.4, 5.4, 8.7, 'stone'),
  ruinIdols: (out, item) => boxRot(out, item, 2.6, 2.2, 2.9, 'stone'),
  ruinColumns: (out, item) => boxRot(out, item, 0.95, 0.95, 2.6, 'stone'),
  // ----------------------------------------------------------------- shore
  shoreRocks: (out, item) => boxRot(out, item, 4.2, 3.9, 1.8, 'stone'),
  jetties: (out, item) => {
    // Deck is walkable (top 0.32 m); rails keep the player and robots off the sides.
    boxRot(out, item, 9.6, 2.4, 0.32, 'wood', 0);
    const halfD = 1.2 * (item.s ?? 1);
    const c = Math.cos(item.ry ?? 0);
    const s = Math.sin(item.ry ?? 0);
    for (const side of [-1, 1]) {
      const ox = -s * halfD * side;
      const oz = -c * halfD * side;
      const rail = rotatedAabb(item.x + ox, item.z + oz, 9.6 * (item.s ?? 1), 0.2, item.ry ?? 0);
      pushAabb(out, rail, 0, 1.05, 'wood');
    }
  },
  canoes: (out, item) => boxRot(out, item, 1.5, 4.5, 0.85, 'wood'),
  // Keep the collider hugging the visible trunk: the model is a thin bleached log
  // (~3.5 × 0.9 × 1.2 m), so the old 3.4 × 1.5 footprint plus rotated-AABB inflation
  // produced a solid invisible box well outside the mesh (map-audit air wall).
  driftwood: (out, item) => boxRot(out, item, 2.2, 0.65, 0.5, 'wood'),
  wrecks: (out, item) => boxRot(out, item, 4.4, 6.4, 2.3, 'wood'),
});

function pushAabb(out, aabb, y0, height, surface) {
  out.push({
    minX: round3(aabb.minX),
    maxX: round3(aabb.maxX),
    minZ: round3(aabb.minZ),
    maxZ: round3(aabb.maxZ),
    minY: round3(y0),
    maxY: round3(y0 + height),
    surface,
  });
}

/** Tag every box added by one footprint call with the placement array it came from. */
function tagFrom(out, start, kind) {
  for (let i = start; i < out.length; i++) out[i].kind = kind;
}

function box(out, x, z, w, d, h, surface, y0 = 0, scale = 1) {
  const aabb = rotatedAabb(x, z, w * scale, d * scale, 0);
  pushAabb(out, aabb, y0, h * Math.max(0.35, scale), surface);
}

function boxRot(out, item, w, d, h, surface, y0 = 0) {
  const scale = item.s ?? 1;
  const aabb = rotatedAabb(item.x, item.z, w * scale, d * scale, item.ry ?? 0);
  pushAabb(out, aabb, y0 + (item.y ?? 0), h * Math.max(0.35, scale), surface);
}

// ------------------------------------------------------------ solid vegetation
/**
 * Vegetation collision (player / robot physics), deliberately core-only.
 *
 * For a long time every plant was collision-free so a tree could never fragment the A*
 * grid, which also meant the player walked straight through 14 m jungle giants, palms,
 * bamboo clumps and fallen logs. These models are solid at body height, so the map now
 * derives a collider for the rigid core of each one. The box hugs the visible bole /
 * culm / log body instead of the whole silhouette, for two reasons:
 *
 *   - `scripts/map-audit.mjs` rejects collision boxes without matching visible geometry
 *     at probe height ("air walls"); a canopy-sized box would fail that contract;
 *   - leaf cards are soft cover: bushes, banana leaves, ferns, grass and hanging vines
 *     stay walk-through exactly like the outpost's planted props.
 *
 * Units are metres at `s = 1`. The numbers are mirrored from the model files
 * (`src/models/world/island/*.js`) — keep them in sync when a model is re-proportioned.
 * Unlike structure footprints these are *not* expanded by yaw: a trunk is round, so an
 * axis-aligned box around its world position is already tight (only the fallen log uses
 * rotated AABB segments). Boxes with `minY >= 1.9 m` are skipped by the robot NavGrid,
 * which is why the palm trunk is banded: the fat lower band is the only one that can
 * block the 1 m navigation grid.
 */

/** Model-space trunk skeleton of `coconut-palm.js` (metres at s = 1). */
const PALM_TRUNK_H = 7.46;

function palmT(y) {
  return Math.max(0, Math.min(1, y / PALM_TRUNK_H));
}

/** Trunk centre line: the beach-palm sweep towards +X. */
function palmCenterX(y) {
  const t = palmT(y);
  return 1.24 * Math.pow(t, 1.62) + 0.04 * t;
}

function palmCenterZ(y) {
  const t = palmT(y);
  return 0.22 * Math.pow(t, 2.2);
}

function palmRadius(y) {
  const t = palmT(y);
  return (0.25 - 0.085 * t) * (1 + 0.24 * Math.pow(1 - t, 6));
}

/** Rotate a model-space XZ offset by a placement's Y yaw (matches `makeInstanced`). */
function rotateXZ(dx, dz, ry) {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return { x: dx * c + dz * s, z: -dx * s + dz * c };
}

/**
 * Axis-aligned collider for a round-ish part: `lx/lz` + `w/d` are model-space metres at
 * `s = 1`, `y0/height` are world metres relative to the instance's own y.
 */
function vegBox(out, item, lx, lz, w, d, y0, height, surface) {
  const s = item.s ?? 1;
  const off = rotateXZ(lx * s, lz * s, item.ry ?? 0);
  const cx = item.x + off.x;
  const cz = item.z + off.z;
  const hw = (w * s) / 2;
  const hd = (d * s) / 2;
  pushAabb(out, { minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd }, (item.y ?? 0) + y0, height, surface);
}

/**
 * Jungle tree: bole radius 0.56 m at the butt tapering to ~0.37 m by 3.2 m; the S-curved
 * centre line stays within ±0.06 m, so a 1.32 m square keeps the whole visible trunk
 * inside without swallowing the air next to it. The thin buttress plates (< 1.2 m tall)
 * stay walk-through — they read as ground clutter, not as a wall.
 */
function jungleTreeFootprint(out, item) {
  const s = item.s ?? 1;
  vegBox(out, item, 0.04, -0.02, 1.32, 1.32, 0, 3.2 * s, 'wood');
}

/**
 * One palm trunk band between two **world** heights. The band is fitted to the leaning
 * centre line (average centre + furthest radius), so the box follows the sweep instead
 * of swallowing the air next to a straight-up trunk.
 */
function palmBand(out, item, y0World, y1World) {
  const s = item.s ?? 1;
  const steps = 6;
  const samples = [];
  let meanX = 0;
  let meanZ = 0;
  for (let i = 0; i <= steps; i++) {
    const y = (y0World + ((y1World - y0World) * i) / steps) / s; // model-space height
    const sample = { x: palmCenterX(y), z: palmCenterZ(y), r: palmRadius(y) };
    samples.push(sample);
    meanX += sample.x / (steps + 1);
    meanZ += sample.z / (steps + 1);
  }
  let extent = 0;
  for (const sample of samples) extent = Math.max(extent, Math.hypot(sample.x - meanX, sample.z - meanZ) + sample.r);
  vegBox(out, item, meanX, meanZ, (extent + 0.06) * 2, (extent + 0.06) * 2, y0World, y1World - y0World, 'wood');
}

/**
 * Coconut palm: two bands. The lower band (0–2 m, world height so every instance blocks
 * the same way) is what player and robot navigation see; the upper band follows the lean
 * above head height and stays out of the A* grid (`minY = 2 m >= 1.9 m`).
 */
function coconutPalmFootprint(out, item) {
  const s = item.s ?? 1;
  palmBand(out, item, 0, 2);
  palmBand(out, item, 2, 6.6 * s);
}

/**
 * Bamboo clump: one thin post per culm of the map-build clump (`bamboo-clump.js` low
 * detail = four culms). A single clump-sized box reads as an air wall in map-audit — the
 * side probes hit leaf cards *outside* the box before reaching the thin culms — while the
 * per-culm posts land the probes on the visible stalks (verified against the real scene:
 * 4/4 valid side hits per post). The posts are 2.7 s tall, well above the 0.92 m jump
 * apex, so the clump still cannot be walked or jumped through.
 */
const BAMBOO_CULMS = Object.freeze([
  { x: -0.47, z: 0.27 },
  { x: 0.11, z: -0.38 },
  { x: 0.51, z: 0.22 },
  { x: -0.22, z: -0.11 },
]);

function bambooClumpFootprint(out, item) {
  const s = item.s ?? 1;
  for (const culm of BAMBOO_CULMS) vegBox(out, item, culm.x, culm.z, 0.34, 0.34, 0, 2.7 * s, 'wood');
}

/** Local (unrotated) log segments mirrored from `fallen-log.js`'s LOG skeleton. */
const FALLEN_LOG_SEGMENTS = Object.freeze([
  { x: -1.55, z: 0.06, w: 1.56, d: 0.86, top: 0.60 }, // shattered broken end (-X)
  { x: 0.00, z: 0.13, w: 1.64, d: 0.90, top: 0.68 }, // bowed belly
  { x: 1.52, z: 0.10, w: 1.52, d: 1.00, top: 0.74 }, // butt section (+X)
  { x: 2.42, z: 0.06, w: 0.62, d: 1.46, top: 1.16 }, // upright root plate + spokes
]);

/**
 * Fallen log: a chain of short rotated AABBs along the log axis. One box around the
 * whole 5 m log would balloon once the placement is rotated (a 45° instance would get a
 * ~4 x 4 m invisible square), so each segment is rotated on its own.
 */
function fallenLogFootprint(out, item) {
  const s = item.s ?? 1;
  const ry = item.ry ?? 0;
  const y0 = item.y ?? 0;
  for (const seg of FALLEN_LOG_SEGMENTS) {
    const off = rotateXZ(seg.x * s, seg.z * s, ry);
    const aabb = rotatedAabb(item.x + off.x, item.z + off.z, seg.w * s, seg.d * s, ry);
    pushAabb(out, aabb, y0, seg.top * s, 'wood');
  }
}

/** Placement arrays that derive a solid trunk collider (exported for the map checks). */
export const ISLAND_SOLID_VEGETATION = Object.freeze(['jungleTrees', 'coconutPalms', 'bambooClumps', 'fallenLogs']);

const VEGETATION_FOOTPRINTS = Object.freeze({
  jungleTrees: jungleTreeFootprint,
  coconutPalms: coconutPalmFootprint,
  bambooClumps: bambooClumpFootprint,
  fallenLogs: fallenLogFootprint,
});

/**
 * Derive the complete collision set for an island map.
 *
 * @param {object} layoutIsland normalised `layout.island.*` arrays
 * @param {object} reuse        reused prop arrays (`crates`, `barrels`, `lowWalls`, `stalls`, `campfires`)
 * @param {Array} [extraSolids] hand-authored AABB solids (`architecture.extraSolids`)
 */
export function islandCollisionBoxes(layoutIsland, reuse = {}, extraSolids = []) {
  const out = [];

  // ------------------------------------------------------------------ structures
  for (const [key, footprint] of Object.entries(FOOTPRINTS)) {
    const items = layoutIsland[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const start = out.length;
      footprint(out, item);
      tagFrom(out, start, key);
    }
  }

  // -------------------------------------------------------- solid vegetation
  // Trees / palms / bamboo / fallen logs (see VEGETATION_FOOTPRINTS above). Soft
  // understory (bushes, banana plants, ferns, grass, vines) stays walk-through.
  for (const [key, footprint] of Object.entries(VEGETATION_FOOTPRINTS)) {
    const items = layoutIsland[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const start = out.length;
      footprint(out, item);
      tagFrom(out, start, key);
    }
  }

  // ------------------------------------------------------------- reused props
  for (const crate of reuse.crates ?? []) {
    const start = out.length;
    const s = crate.s ?? 1;
    box(out, crate.x, crate.z, s * 1.02, s * 1.02, s * 0.82 * (crate.stack ?? 1), 'wood');
    tagFrom(out, start, 'crates');
  }
  for (const barrel of reuse.barrels ?? []) {
    const start = out.length;
    box(out, barrel.x, barrel.z, 0.78, 0.78, 0.92, 'metal');
    tagFrom(out, start, 'barrels');
  }
  for (const wall of reuse.lowWalls ?? []) {
    const start = out.length;
    const aabb = rotatedAabb(wall.x, wall.z, wall.w, wall.d, wall.ry ?? 0);
    pushAabb(out, aabb, wall.y0 ?? 0, wall.h, wall.surface ?? 'stone');
    tagFrom(out, start, 'lowWalls');
  }
  for (const stall of reuse.stalls ?? []) {
    const start = out.length;
    const aabb = rotatedAabb(stall.x, stall.z, 2.9, 1.2, stall.ry ?? 0);
    pushAabb(out, aabb, 0, 1.05, 'wood');
    for (const [ox, oz] of [[-1.55, -1.45], [1.55, -1.45], [-1.55, 1.45], [1.55, 1.45]]) {
      box(out, stall.x + ox, stall.z + oz, 0.18, 0.18, 2.6, 'wood');
    }
    tagFrom(out, start, 'stalls');
  }
  for (const fire of reuse.campfires ?? []) {
    const start = out.length;
    // Fire-pit stones are only ~0.4 m tall; a 0.55 m solid box read as an invisible wall
    // to the audit's 0.5 m probe. 0.45 m still stops the player without air above it.
    box(out, fire.x, fire.z, 1.5, 1.5, 0.45, 'stone');
    tagFrom(out, start, 'campfires');
  }

  // ---------------------------------------------------- hand-authored solids
  for (const solid of extraSolids ?? []) {
    if (![solid?.x, solid?.z, solid?.w, solid?.d, solid?.h].every((v) => Number.isFinite(v))) continue;
    const start = out.length;
    box(out, solid.x, solid.z, solid.w, solid.d, solid.h, solid.surface ?? 'stone', solid.y0 ?? 0);
    tagFrom(out, start, 'extraSolids');
  }

  return out;
}

// ------------------------------------------------------------------- normalisers
const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Normalise one placement item: x/z required, y/ry/s defaulted, extra fields preserved. */
export function placementItem(raw, index) {
  const item = raw && typeof raw === 'object' ? { ...raw } : {};
  if (!Number.isFinite(item.x) || !Number.isFinite(item.z)) {
    throw new Error(`[maps] island placement #${index} is missing finite x/z: ${JSON.stringify(raw)}`);
  }
  item.x = +Number(item.x).toFixed(3);
  item.z = +Number(item.z).toFixed(3);
  item.y = num(item.y, 0);
  item.ry = num(item.ry, 0) % TAU;
  item.s = Math.max(0.05, num(item.s, 1));
  return item;
}

function placementList(raw, key) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`[maps] island layout "${key}" must be an array`);
  return raw.map((item, index) => placementItem(item, index));
}

function pickGroup(source, keys, out) {
  const group = source && typeof source === 'object' ? source : {};
  for (const key of keys) out[key] = placementList(group[key], key);
}

/** Every v1 hero prop key the legacy builders may read; harmless zeros if unused. */
function emptyHero(campfire) {
  return {
    well: { x: 0, z: 0 },
    truck: { x: 0, z: 0, ry: 0 },
    campfire: campfire ?? { x: 0, z: 0, ry: 0 },
    flagpoles: [],
    windmill: { x: 0, z: 0 },
    watchtower: { x: 0, z: 0, w: 0, d: 0, h: 0 },
    radar: { x: 0, z: 0 },
    monument: { x: 0, z: 0 },
    aLongShade: { x: 0, z: 0, zs: [] },
    aPlatform: { x: 0, z: 0, w: 0, d: 0, h: 0 },
    bWreck: { x: 0, z: 0 },
    cartPlaza: { x: 0, z: 0, w: 0, d: 0 },
    aLongCart: { x: 0, z: 0, w: 0, d: 0 },
  };
}

/**
 * Normalise a raw `sandstrike/map@2` source into the shared map-data shape.
 *
 * @param {{ id: string, manifest: object, parts: Record<string, object> }} source
 * @returns {object} plain, structured-cloneable map data
 */
export function normalize({ id: mapId, manifest = {}, parts = {} }) {
  const terrainPart = parts.terrain ?? {};
  const terrain = withDefaults(terrainPart, ISLAND_TERRAIN_DEFAULTS);
  const environment = withDefaults(parts.environment ?? {}, ENVIRONMENT_DEFAULTS);
  const dressing = withDefaults(parts.dressing ?? {}, DRESSING_DEFAULTS);

  // ------------------------------------------------------------- placements
  const island = {};
  const architecture = parts.architecture ?? {};
  const props = parts.props ?? {};
  pickGroup(architecture.village, ISLAND_LAYOUT_KEYS.village, island);
  pickGroup(architecture.ruins, ISLAND_LAYOUT_KEYS.ruins, island);
  pickGroup(architecture.shore, ISLAND_LAYOUT_KEYS.shore, island);
  pickGroup(props.flora, ISLAND_LAYOUT_KEYS.flora, island);

  // Reused desert props (already supported by the legacy buildWorld() functions).
  const reuseSource = props.reuse ?? {};
  const reuse = {
    crates: Array.isArray(reuseSource.crates) ? reuseSource.crates.map((item, i) => {
      const crate = { ...item };
      crate.x = num(crate.x, 0);
      crate.z = num(crate.z, 0);
      crate.s = num(crate.s, 1);
      crate.ry = num(crate.ry, 0);
      crate.stack = Math.max(1, Math.round(num(crate.stack, 1)));
      return crate;
    }) : [],
    barrels: (reuseSource.barrels ?? []).map((item) => ({ x: num(item.x, 0), z: num(item.z, 0), yaw: num(item.yaw, 0) })),
    lowWalls: (reuseSource.lowWalls ?? []).map((item) => ({
      x: num(item.x, 0), z: num(item.z, 0), w: num(item.w, 2), d: num(item.d, 0.6), h: num(item.h, 1.0), ry: num(item.ry, 0), surface: item.surface ?? 'stone',
    })),
    stalls: (reuseSource.stalls ?? []).map((item) => ({ x: num(item.x, 0), z: num(item.z, 0), ry: num(item.ry, 0) })),
    campfires: (reuseSource.campfires ?? []).map((item) => ({ x: num(item.x, 0), z: num(item.z, 0), ry: num(item.ry, 0) })),
  };

  const layout = {
    island,
    // v1-compatible bookkeeping so shared builders never read `undefined`
    walls: [], gatePiers: [], boundary: [], towers: [], buildings: [], blocks: [],
    lowWalls: reuse.lowWalls, pillars: [], tunnelPiers: [], arches: [], tunnelArches: [],
    siteArches: [], stalls: reuse.stalls, crates: reuse.crates, barrels: reuse.barrels,
    sandbagRuns: [], palms: [], lampPosts: [], looseCrates: [], tireStacks: [], sackPiles: [],
    hero: emptyHero(reuse.campfires[0]),
  };

  // ------------------------------------------------------------- collision set
  const collisionBoxes = islandCollisionBoxes(island, reuse, architecture.extraSolids);

  // ------------------------------------------------------------------ spawns
  const spawnsPart = parts.spawns ?? {};
  const resolve = withDefaults(spawnsPart.resolve, SPAWN_RESOLVE_DEFAULTS);
  const rawPlayer = spawnsPart.playerSpawn ?? manifest.playerSpawn ?? { x: 0, z: 46 };
  const playerSpawn = {
    x: num(rawPlayer.x, 0),
    y: num(rawPlayer.y, 0),
    z: num(rawPlayer.z, 46),
    yaw: num(rawPlayer.yaw, 0),
  };
  const candidates = (spawnsPart.enemies ?? spawnsPart.enemySpawns ?? []).map((entry, index) => {
    if (!Number.isFinite(entry?.x) || !Number.isFinite(entry?.z)) {
      throw new Error(`[maps] island enemy spawn #${index} is missing finite x/z`);
    }
    return [entry.x, entry.z, typeof entry.label === 'string' ? entry.label : `SPAWN ${index + 1}`];
  });
  const enemySpawns = resolveEnemySpawns(candidates, collisionBoxes, playerSpawn, resolve);
  const warnings = buildWarnings(collisionBoxes, enemySpawns, playerSpawn, resolve);
  const landmarks = (spawnsPart.landmarks ?? [])
    .filter((entry) => Number.isFinite(entry?.x) && Number.isFinite(entry?.z))
    .map((entry) => ({ x: +Number(entry.x).toFixed(2), z: +Number(entry.z).toFixed(2), name: String(entry.name ?? 'LANDMARK') }));

  const bounds = manifest.bounds ?? { minX: -70, maxX: 70, minZ: -70, maxZ: 70 };
  const mapBounds = {
    minX: num(bounds.minX, -70), maxX: num(bounds.maxX, 70),
    minZ: num(bounds.minZ, -70), maxZ: num(bounds.maxZ, 70),
  };

  return {
    id: mapId,
    name: manifest.name ?? mapId,
    subtitle: manifest.subtitle ?? '',
    description: manifest.description ?? '',
    format: manifest.format ?? FORMAT,
    style: 'island',
    collisionBoxes,
    playerSpawn,
    enemySpawns,
    mapBounds,
    landmarks,
    warnings,
    layout,
    terrain,
    environment,
    dressing,
  };
}

export default normalize;
