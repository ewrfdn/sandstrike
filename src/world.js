/**
 * SANDSTRIKE // 沙暴协议 — world / environment module.
 *
 * Builds a compact 68 × 68 m golden-hour desert outpost ("OUTPOST 07") entirely
 * from procedural geometry + canvas textures. Layout is Dust II inspired:
 *
 *          N (-Z)
 *   B SITE ── CT yard ── A SITE
 *   B TUNNEL  courtyard  A LONG
 *   └─────── MID GATE ───────┘   (z = -8.5, double doors + flanking portals)
 *           PLAZA + WELL
 *          EAST / WEST STREETS
 *           STAGING + SPAWN        S (+Z)
 *
 * Floor is flat at y = 0 everywhere the player and robots walk. All movement
 * corridors are ≥ 2.6 m wide. Visual decoration may go above head height but
 * never enters `collisionBoxes` unless it is a real ground-to-height blocker.
 *
 * Public API (see TEAM_SPEC.md):
 *   const world = await createWorld(scene, renderer, { quality, onProgress });
 *   world.collideMeshes, world.collisionBoxes, world.playerSpawn, world.enemySpawns,
 *   world.mapBounds, world.landmarks, world.update(dt, time), world.dispose()
 */
import * as THREE from 'three';
import { createTextureLibrary } from './textures.js';
import { clamp, lerp, rand, choice, makeRNG, smoothstep, disposeObject, canvasTexture } from './utils.js';
import {
  TAU,
  stdMaterial,
  mergeGeometries,
  boxGeometryWorldUV,
  planeGeometry,
  cylinderWorldUV,
  transformed,
  matrixFor,
  rodBetween,
  bakeVertexAO,
  boxBatch,
  baseBox,
  makeSign,
  addArchMesh,
  clothMaterial,
  registerCloth,
  mergePlanes,
} from './models/core.js';

// Moved map models (one file per model under src/models/world/). The aliases keep the
// original local builder names so the assembly functions below read exactly as before.
import { buildBoundary } from './models/world/boundary.js';
import { buildMidWall } from './models/world/mid-wall.js';
import { buildWorld as buildBazaarRows } from './models/world/bazaar-shop.js';
import { buildWorld as buildWarehouseBlocks } from './models/world/warehouse.js';
import { buildWorld as buildLowWalls } from './models/world/low-wall.js';
import { buildColonnade } from './models/world/pillar.js';
import { buildWorld as buildSiteArches } from './models/world/site-arch.js';
import { buildWorld as buildCrateFamily } from './models/world/crate.js';
import { buildWorld as buildBarrelFamily } from './models/world/barrel.js';
import { buildWorld as buildSandbagFamily } from './models/world/sandbag.js';
import { buildWorld as buildPalmFamily } from './models/world/palm.js';
import { buildWorld as buildRubbleFamily } from './models/world/rubble.js';
import { buildWorld as buildTireFamily } from './models/world/tires.js';
import { buildWorld as buildSackFamily } from './models/world/sacks.js';
import { buildWorld as buildLampPosts } from './models/world/lamp-post.js';
import { buildWorld as buildFlagpoles } from './models/world/flagpole.js';
import { buildWorld as buildALongShade } from './models/world/a-long-shade.js';
import { buildWorld as buildWell } from './models/world/well.js';
import { buildWorld as buildTruck } from './models/world/truck.js';
import { buildWorld as buildStalls } from './models/world/stall.js';
import { buildWorld as buildWindmill } from './models/world/windmill.js';
import { buildWorld as buildRadar } from './models/world/radar.js';
import { buildWorld as buildCarts } from './models/world/cart.js';
import { buildWorld as buildCampfire } from './models/world/campfire.js';
import { buildWorld as buildAPlatform } from './models/world/a-platform.js';
import { buildWorld as buildBWreck } from './models/world/b-wreck.js';
import { buildWorld as buildPipeline } from './models/world/pipeline.js';
import { createBanner } from './models/world/banner.js';
import { createFlag } from './models/world/flag.js';
import { createAwning } from './models/world/awning.js';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

// ===========================================================================
// #region WORLD_DATA — pure layout + gameplay data (no THREE, no DOM)
// ===========================================================================

const MAP_BOUNDS = Object.freeze({ minX: -33, maxX: 33, minZ: -33, maxZ: 33 });
const PLAYER_SPAWN = Object.freeze({ x: 0, y: 0, z: 26, yaw: 0 });

/**
 * Build the authoritative layout. Both the visuals and the gameplay data are
 * derived from this one function so collision always matches what is drawn.
 */
function buildWorldData() {
  const boxes = [];
  /** register a ground-to-height axis-aligned solid */
  const solid = (x, z, w, d, h, surface = 'adobe', y0 = 0) => {
    boxes.push({
      minX: +(x - w / 2).toFixed(3),
      maxX: +(x + w / 2).toFixed(3),
      minZ: +(z - d / 2).toFixed(3),
      maxZ: +(z + d / 2).toFixed(3),
      minY: +y0.toFixed(3),
      maxY: +(y0 + h).toFixed(3),
      surface,
    });
  };

  // ---------------------------------------------------------------- hero props
  const hero = {
    well: { x: 0, z: 9.5, r: 2.1 },
    truck: { x: -10.5, z: 29.0, yaw: 0.14 },
    campfire: { x: -4.2, z: 24.6 },
    flagpoles: [
      { x: -3.4, z: 31.4, h: 7.6 },
      { x: 3.4, z: 31.4, h: 7.6 },
    ],
    windmill: { x: 24.6, z: 20.4 },
    watchtower: { x: 30.4, z: 29.0, w: 2.8, d: 2.8, h: 6.4 },
    radar: { x: 28.6, z: -30.2 },
    monument: { x: 0, z: -15.2 },
    // three shade posts on the east wall of A-long, placed in the gaps between the
    // wall-side barrels / crate stacks / cart
    aLongShade: { x: 31.3, z: -13.5, zs: [-11.1, -13.5, -15.9] },
    aPlatform: { x: 29.2, z: -28.2, w: 3.4, d: 2.6, h: 3.0 },
    bWreck: { x: -29.6, z: -27.6 },
    cartPlaza: { x: -9.2, z: 18.0, w: 2.2, d: 1.2 },
    aLongCart: { x: 30.5, z: -17.8, w: 2.6, d: 1.5 },
  };

  // ------------------------------------------------------------------- mid wall
  const walls = [
    // z = -8.5, 4.4 m tall adobe wall with central double doors and two 6 m portals
    { x: -30.0, z: -8.5, w: 6.0, d: 1.4, h: 4.4 },
    { x: -12.2, z: -8.5, w: 17.6, d: 1.4, h: 4.4 },
    { x: 12.2, z: -8.5, w: 17.6, d: 1.4, h: 4.4 },
    { x: 30.0, z: -8.5, w: 6.0, d: 1.4, h: 4.4 },
  ];
  for (const w of walls) solid(w.x, w.z, w.w, w.d, w.h, 'adobe');

  // gatehouse piers framing the 3.8 m central doorway
  const gatePiers = [
    { x: -2.65, z: -8.5, w: 1.5, d: 1.8, h: 4.8 },
    { x: 2.65, z: -8.5, w: 1.5, d: 1.8, h: 4.8 },
  ];
  for (const p of gatePiers) solid(p.x, p.z, p.w, p.d, p.h, 'stone');

  // ------------------------------------------------------------- boundary walls
  const boundary = [
    { x: 0, z: 33.6, w: 68.4, d: 1.2, h: 6.6 },
    { x: 0, z: -33.6, w: 68.4, d: 1.2, h: 6.6 },
    { x: 33.6, z: 0, w: 1.2, d: 68.4, h: 6.6 },
    { x: -33.6, z: 0, w: 1.2, d: 68.4, h: 6.6 },
  ];
  for (const b of boundary) solid(b.x, b.z, b.w, b.d, b.h, 'adobe');

  // corner towers only — the wooden watchtower is registered separately below
  // (hero.watchtower) so it is not double-boxed in the collision set.
  const towers = [
    { x: -32.0, z: 32.0, w: 3.8, d: 3.8, h: 8.6, kind: 'corner' },
    { x: 32.0, z: 32.0, w: 3.8, d: 3.8, h: 8.6, kind: 'corner' },
    { x: -32.0, z: -32.0, w: 3.8, d: 3.8, h: 8.6, kind: 'corner' },
    { x: 32.0, z: -32.0, w: 3.8, d: 3.8, h: 8.6, kind: 'corner' },
  ];
  for (const t of towers) solid(t.x, t.z, t.w, t.d, t.h, 'adobe');

  // --------------------------------------------------- south plaza-side buildings
  const buildings = [
    // east bazaar row, archway gap between E1 and E2 (z 5.6..8.6)
    { x: 17.8, z: 12.7, w: 5.6, d: 8.2, h: 5.2, style: 'shop', rows: 2 },
    { x: 17.8, z: 3.3, w: 5.6, d: 4.6, h: 4.4, style: 'shop', rows: 1 },
    // west bazaar row
    { x: -17.8, z: 12.7, w: 5.6, d: 8.2, h: 5.2, style: 'shop', rows: 2 },
    { x: -17.8, z: 3.3, w: 5.6, d: 4.6, h: 4.4, style: 'shop', rows: 1 },
  ];
  for (const b of buildings) solid(b.x, b.z, b.w, b.d, b.h, 'adobe');

  // doorways in the archway gaps (visual only in the gap, no collision)
  const arches = [
    { x: 17.8, z: 7.1, span: 3.0, height: 4.4, depth: 5.6, pierW: 0.08, rot: Math.PI / 2, solidPiers: false, style: 'adobe', kind: 'shopPass' },
    { x: -17.8, z: 7.1, span: 3.0, height: 4.4, depth: 5.6, pierW: 0.08, rot: Math.PI / 2, solidPiers: false, style: 'adobe', kind: 'shopPass' },
  ];

  // ------------------------------------------------ courtyard side warehouse blocks
  // Centre courtyard x∈[-15.5,15.5]; warehouse blocks carry a 3 m doorway at z -14..-17.
  const blocks = [
    { x: 18.25, z: -12.0, w: 5.5, d: 4.0, h: 5.4, lane: 'A LONG', door: { z: -15.5, w: 3.0, h: 3.2 } },
    { x: 18.25, z: -18.25, w: 5.5, d: 2.5, h: 5.4, lane: 'A LONG', door: null },
    { x: -18.25, z: -12.0, w: 5.5, d: 4.0, h: 5.0, lane: 'B TUNNEL', door: { z: -15.5, w: 3.0, h: 3.0 } },
    { x: -18.25, z: -18.25, w: 5.5, d: 2.5, h: 5.0, lane: 'B TUNNEL', door: null },
  ];
  for (const b of blocks) solid(b.x, b.z, b.w, b.d, b.h, 'adobe');

  // ---------------------------------------------------------------- low cover walls
  const lowWalls = [
    // plaza / mid-gate cover
    { x: -5.2, z: -4.2, w: 4.0, d: 0.7, h: 1.25, surface: 'stone' },
    { x: 5.2, z: -4.2, w: 4.0, d: 0.7, h: 1.25, surface: 'stone' },
    { x: -8.4, z: 1.2, w: 3.0, d: 0.7, h: 1.1, surface: 'adobe' },
    { x: 8.4, z: 1.2, w: 3.0, d: 0.7, h: 1.1, surface: 'adobe' },
    // courtyard
    { x: -11.5, z: -11.5, w: 4.0, d: 0.8, h: 1.5, surface: 'stone' },
    { x: 11.5, z: -17.6, w: 4.2, d: 0.8, h: 1.5, surface: 'stone' },
    // A site / A long shaping
    { x: 11.6, z: -21.0, w: 3.6, d: 0.7, h: 1.4, surface: 'adobe' },
    { x: 24.8, z: -19.9, w: 3.2, d: 0.7, h: 1.2, surface: 'stone' },
    // B site
    { x: -11.6, z: -21.0, w: 3.6, d: 0.7, h: 1.4, surface: 'adobe' },
    { x: -28.9, z: -19.9, w: 3.2, d: 0.7, h: 1.2, surface: 'stone' },
    { x: -24.4, z: -27.4, w: 4.0, d: 0.7, h: 1.3, surface: 'adobe' },
    // north strip ruins (leave gaps so the ring route flows)
    { x: -13.0, z: -29.2, w: 5.0, d: 0.8, h: 1.7, surface: 'adobe' },
    { x: 13.0, z: -29.2, w: 5.0, d: 0.8, h: 1.7, surface: 'adobe' },
    { x: 0.0, z: -29.2, w: 3.4, d: 0.8, h: 1.2, surface: 'stone' },
  ];
  for (const w of lowWalls) solid(w.x, w.z, w.w, w.d, w.h, w.surface);

  // ------------------------------------------------------- courtyard colonnade
  const pillars = [];
  for (const x of [-7.2, 7.2]) {
    for (const z of [-12.2, -15.2, -18.2]) pillars.push({ x, z, w: 0.95, d: 0.95, h: 4.0, style: 'stone' });
  }
  // mid-gate flanking buttress pillars on the courtyard side
  for (const x of [-8.6, 8.6]) pillars.push({ x, z: -9.9, w: 0.9, d: 0.9, h: 3.6, style: 'stone' });
  for (const p of pillars) solid(p.x, p.z, p.w, p.d, p.h, 'stone');

  // ------------------------------------------------------------- B tunnel piers
  // Each covered-passage bay is spanned by two 5.6 m arches (x = -30 / -24.2, see
  // buildTunnel), whose outer rims form four visible stone legs per z. Collide with
  // the legs that are actually drawn instead of the old mid-lane 1×1 ghost boxes.
  const tunnelPiers = [];
  for (const z of [-10.6, -13.4, -16.2, -19.0]) {
    for (const x of [-32.69, -27.31, -26.89, -21.51]) {
      tunnelPiers.push({ x, z, w: 0.34, d: 0.88, h: 3.6 });
    }
  }
  for (const p of tunnelPiers) solid(p.x, p.z, p.w, p.d, p.h, 'stone');
  // timber support posts at the tunnel roof edges (visible in buildTunnel). Only the
  // east-row posts are exposed; the west row is sandwiched between the boundary wall
  // and the arch legs, and the z=-13.4 post sits inside the sandbag emplacement, so
  // those are already covered by the solids above.
  for (const z of [-10.6, -16.2, -19.0]) solid(-21.16, z, 0.24, 0.24, 3.3, 'wood');

  // -------------------------------------------------------- stand-alone site arches
  const siteArches = [
    { x: 17.5, z: -22.0, span: 6.2, height: 5.6, depth: 1.1, pierW: 0.55, rot: 0, solidPiers: true, style: 'stone', cell: 'A', label: 'ALPHA ARCH' },
    { x: -18.0, z: -21.2, span: 6.0, height: 5.2, depth: 1.1, pierW: 0.55, rot: 0, solidPiers: true, style: 'stone', cell: 'B', label: 'BRAVO ARCH' },
  ];
  for (const a of siteArches) {
    arches.push(a);
    if (a.solidPiers) {
      const off = a.span / 2 - a.pierW / 2;
      solid(a.x - off, a.z, a.pierW + 0.15, a.depth + 0.2, a.height, 'stone');
      solid(a.x + off, a.z, a.pierW + 0.15, a.depth + 0.2, a.height, 'stone');
    }
  }
  // mid-wall portal arches (visual frames inside the 6 m gaps)
  arches.push(
    { x: 24.0, z: -8.5, span: 6.0, height: 4.4, depth: 1.6, pierW: 0.3, rot: 0, solidPiers: false, style: 'stone', label: 'A LONG' },
    { x: -24.0, z: -8.5, span: 6.0, height: 4.4, depth: 1.6, pierW: 0.3, rot: 0, solidPiers: false, style: 'stone', label: 'B TUNNEL' },
    { x: 0, z: -8.5, span: 4.4, height: 3.9, depth: 1.7, pierW: 0.18, rot: 0, solidPiers: false, style: 'stone', label: 'MID GATE' },
  );

  // --------------------------------------------------------- B tunnel arcade arches
  const tunnelArches = [];
  for (const z of [-10.6, -13.4, -16.2, -19.0]) {
    tunnelArches.push({ x: -30.0, z, span: 5.6, height: 3.6, depth: 0.8, pierW: 0.22, rot: 0, solidPiers: false, style: 'stone' });
    tunnelArches.push({ x: -24.2, z, span: 5.6, height: 3.6, depth: 0.8, pierW: 0.22, rot: 0, solidPiers: false, style: 'stone' });
  }

  // ------------------------------------------------------------- courtyard monument
  solid(hero.monument.x, hero.monument.z, 3.5, 3.5, 0.9, 'stone');
  solid(hero.monument.x, hero.monument.z, 1.3, 1.3, 3.2, 'stone', 0.9);

  // ------------------------------------------------------------------- the well
  solid(hero.well.x, hero.well.z, 4.9, 4.9, 2.35, 'stone');
  // water jars beside the well (drawn in buildWell ~0.55 m tall)
  solid(hero.well.x + 2.6, hero.well.z + 1.2, 0.5, 0.5, 0.55, 'metal');
  solid(hero.well.x + 2.9, hero.well.z + 0.2, 0.5, 0.5, 0.55, 'metal');

  // ------------------------------------------------------------------ the truck
  // the truck is parked at a slight angle (yaw 0.14), so its rotated footprint is
// ~7.66 x 3.90 m -- size the blocker to cover it instead of letting the bumpers
// poke through the invisible box.
solid(hero.truck.x, hero.truck.z, 7.8, 3.9, 2.7, 'metal');

  // --------------------------------------------------------------- market stalls
  const stalls = [
    { x: 10.2, z: 14.2, ry: 0 },
    { x: 10.2, z: 5.0, ry: 0 },
    { x: -10.2, z: 14.2, ry: 0 },
    { x: -10.2, z: 5.0, ry: 0 },
  ];
  for (const s of stalls) {
    solid(s.x, s.z, 2.9, 1.2, 1.05, 'wood');
    for (const [ox, oz] of [[-1.55, -1.45], [1.55, -1.45], [-1.55, 1.45], [1.55, 1.45]]) {
      solid(s.x + ox, s.z + oz, 0.18, 0.18, 2.6, 'wood');
    }
  }

  // --------------------------------------------------------------- misc hero solids
  solid(hero.watchtower.x, hero.watchtower.z, hero.watchtower.w, hero.watchtower.d, hero.watchtower.h, 'adobe');
  solid(hero.windmill.x, hero.windmill.z, 2.1, 2.1, 2.6, 'wood');
  // radar: 3.3 m concrete pad (0.5 m high) + lattice-tower legs at player height
  // radar: pad collider is the AABB inscribed in the visible decagon pad; the tower
  // collider starts at the pad top so the two boxes do not overlap in 3D
  solid(hero.radar.x, hero.radar.z, 3.0, 3.0, 0.5, 'stone');
  solid(hero.radar.x, hero.radar.z, 1.4, 1.4, 1.7, 'metal', 0.5);
  solid(hero.campfire.x, hero.campfire.z, 1.5, 1.5, 0.55, 'stone');
  // mid-gate door leaves, modelled thrown open against the jambs (see buildMidWall)
  for (const s of [-1, 1]) solid(s * 1.82, -6.73, 0.16, 1.88, 3.0, 'wood');
  for (const f of hero.flagpoles) solid(f.x, f.z, 0.34, 0.34, f.h, 'wood');
  // A-long shade posts
  for (const z of hero.aLongShade.zs) solid(hero.aLongShade.x, z, 0.26, 0.26, 3.3, 'wood');
  // A site raised watch platform legs
  const ap = hero.aPlatform;
  for (const [ox, oz] of [[-ap.w / 2 + 0.2, -ap.d / 2 + 0.2], [ap.w / 2 - 0.2, -ap.d / 2 + 0.2], [-ap.w / 2 + 0.2, ap.d / 2 - 0.2], [ap.w / 2 - 0.2, ap.d / 2 - 0.2]]) {
    // the SW leg stands on the radar pad; the pad collider already blocks that cell,
    // so it needs no separate leg box (a nested box double-counts in box health)
    if (Math.abs(ap.x + ox - hero.radar.x) < 1.5 && Math.abs(ap.z + oz - hero.radar.z) < 1.5) continue;
    solid(ap.x + ox, ap.z + oz, 0.3, 0.3, ap.h, 'wood');
  }
  // carts
  // cart colliders are sized to the cart's real visual height (deck/cargo ~1.34 m) so
  // the audit's mid-height side probes land on deck surfaces instead of through the
  // open frame between the wheels and the bed
  solid(hero.cartPlaza.x, hero.cartPlaza.z, hero.cartPlaza.w, hero.cartPlaza.d, 1.44, 'wood');
  solid(hero.aLongCart.x, hero.aLongCart.z, hero.aLongCart.w, hero.aLongCart.d, 1.2, 'wood');
  // hand cart at the B-site exit (drawn by buildCarts, yawed 1.2 rad) — moved just
  // inside the arcade mouth so its AABB no longer swallows the arch leg / support post
  solid(-22.6, -18.0, 1.8, 2.35, 1.35, 'wood');
  // B-site wreck — plates/scrap span ~2.8 × 2.2 m around the shattered core
  solid(hero.bWreck.x, hero.bWreck.z, 2.8, 2.2, 1.1, 'metal');

  // --------------------------------------------------------------------- crates
  // entry: [x, z, size, rotation, stack]
  const crateData = [
    // staging
    [-2.6, 23.4, 0.95, 0.2, 2], [-16.5, 24.2, 0.95, 0.5, 1], [3.2, 23.2, 0.95, 1.1, 1],
    [17.8, 23.9, 0.95, 0.35, 1], [-6.5, 30.7, 0.85, 0.1, 1], [7.2, 31.0, 0.85, 0.7, 1],
    [12.5, 21.8, 0.85, 0.25, 1], [-20.0, 21.2, 0.95, 0.3, 1],
    // plaza
    [5.8, 3.6, 0.95, 0.4, 2], [-5.6, 2.6, 0.95, 0.9, 1], [7.4, 16.0, 0.9, 0.2, 1],
    [-7.2, 16.2, 0.9, 0.5, 1], [2.2, -3.6, 0.85, 0.6, 1], [-2.4, -3.2, 0.85, 0.15, 1],
    [12.4, 17.9, 0.9, 0.3, 1], [-12.5, 18.2, 0.9, 0.8, 1],
    // east / west streets
    [24.2, 17.4, 0.95, 0.3, 2], [22.1, 2.5, 0.9, 0.6, 1], [26.6, -3.0, 0.9, 0.2, 1],
    [24.5, -6.9, 0.85, 0.5, 1], [-24.2, 16.5, 0.9, 0.4, 1], [-22.1, 2.0, 0.95, 0.7, 2],
    [-26.6, -3.5, 0.9, 0.1, 1], [-24.6, -6.9, 0.85, 0.9, 1],
    // courtyard
    [4.6, -11.2, 0.95, 0.25, 2], [-4.8, -18.7, 0.9, 0.4, 1], [13.7, -13.2, 0.9, 0.8, 1],
    [-13.7, -13.6, 0.9, 0.15, 1], [12.4, -18.6, 0.85, 0.5, 1], [-12.6, -19.0, 0.85, 0.3, 1],
    // A long
    [31.0, -9.9, 0.95, 0.1, 2], [27.0, -11.0, 0.95, 0.6, 3], [23.0, -18.4, 0.85, 0.3, 1],
    [30.0, -10.2, 0.85, 0.85, 1],
    // A site
    [12.8, -25.6, 0.95, 0.3, 2], [22.6, -27.8, 0.95, 0.5, 3], [15.2, -27.9, 0.9, 0.2, 1],
    [23.0, -22.2, 0.9, 0.7, 1], [27.0, -24.6, 0.9, 0.15, 2], [11.6, -28.4, 0.85, 0.4, 1],
    // B tunnel
    [-31.5, -11.6, 0.9, 0.2, 1], [-31.3, -15.1, 0.95, 0.6, 2], [-31.6, -18.0, 0.85, 0.1, 1],
    [-21.9, -10.8, 0.85, 0.8, 1],
    // B site
    [-13.0, -25.2, 0.95, 0.5, 2], [-23.4, -27.0, 0.95, 0.1, 3], [-17.0, -28.0, 0.9, 0.6, 1],
    [-27.6, -22.7, 0.9, 0.3, 1], [-28.6, -26.6, 0.9, 0.75, 2], [-11.9, -28.6, 0.85, 0.2, 1],
    // CT / north strip
    [5.8, -24.2, 0.95, 0.3, 2], [-5.8, -24.0, 0.9, 0.6, 1], [8.2, -28.4, 0.85, 0.1, 1],
    [-8.4, -28.6, 0.9, 0.5, 2], [19.0, -27.9, 0.85, 0.4, 1], [-19.0, -27.9, 0.85, 0.2, 1],
  ];
  const crates = crateData.map(([x, z, s, ry, stack]) => ({ x, z, s, ry, stack }));
  for (const c of crates) {
    const foot = c.s * 1.02;
    const hh = c.s * 0.82 * c.stack;
    solid(c.x, c.z, foot, foot, hh, 'wood');
  }

  // -------------------------------------------------------------------- barrels
  const barrelData = [
    [-18.2, 28.6], [-19.3, 27.2], [14.6, 30.4], [15.8, 29.0],
    [3.8, -1.6], [-3.8, -2.0], [12.8, 11.8], [-12.9, 12.0],
    [22.8, 12.6], [27.8, 6.2], [-23.0, 12.2], [-27.6, 6.0],
    [13.9, -17.6], [-13.9, -11.8], [13.8, -10.6], [31.0, -12.4], [30.9, -14.6],
    [22.2, -28.1], [13.0, -22.6], [29.6, -27.0],
    [-30.8, -18.6], [-31.9, -12.8], [-20.6, -28.3], [-12.4, -22.4], [-30.9, -24.8],
    [6.8, -27.4], [-6.6, -27.6], [12.4, -31.2], [-12.6, -31.4],
  ];
  const barrels = barrelData.map(([x, z]) => ({ x, z, yaw: (x * 7.3 + z * 3.1) % TAU }));
  for (const b of barrels) solid(b.x, b.z, 0.78, 0.78, 0.92, 'metal');

  // ------------------------------------------------------------ sandbag positions
  // [x, z, w, d, h]  — visual rows of individual bags, one collider per run
  const sandbagRuns = [
    [-5.6, 21.6, 5.2, 1.15, 1.05], [5.6, 21.6, 5.2, 1.15, 1.05],
    [19.6, 22.6, 2.8, 1.0, 0.9],
    [-6.3, -7.0, 2.4, 1.0, 0.9], [6.3, -7.0, 2.4, 1.0, 0.9],
    [7.0, -16.2, 3.2, 1.0, 0.9],
    [21.9, -15.4, 2.6, 1.0, 0.9],
    [26.2, -21.6, 2.8, 1.0, 0.9], [21.6, -23.6, 2.2, 0.9, 0.8],
    [-21.9, -13.0, 2.6, 1.0, 0.9],
    [-12.6, -22.0, 2.4, 0.9, 0.85],
    [-4.2, -23.2, 3.2, 1.0, 0.85],
    [22.6, 8.4, 2.6, 1.0, 0.85], [-22.6, 8.4, 2.6, 1.0, 0.85],
    [26.5, -30.6, 3.2, 1.0, 0.9], [-26.5, -30.6, 3.2, 1.0, 0.9],
  ];
  for (const [x, z, w, d, h] of sandbagRuns) solid(x, z, w, d, h, 'fabric');

  // ----------------------------------------------------------------------- palms
  const palmData = [
    [13.4, 18.2, 1.0], [-13.4, 18.2, 0.95], [13.4, 10.6, 1.05], [-13.4, 10.6, 0.9],
    [13.0, 1.6, 1.0], [-13.0, 1.6, 1.05], [12.6, -5.6, 0.92], [-12.6, -5.6, 1.0],
    [24.5, -26.8, 0.95], [-24.0, -21.8, 1.0],
  ];
  const palms = palmData.map(([x, z, s]) => ({ x, z, s, ry: (x * 13.7 + z * 5.3) % TAU }));
  for (const p of palms) solid(p.x, p.z, 0.55 * p.s, 0.55 * p.s, 2.7 * p.s, 'wood');

  // ------------------------------------------------------------------- lamp posts
  const lampPosts = [
    [-7.8, 20.6], [7.8, 20.6], [-8.8, 12.4], [8.8, 12.4],
    [-8.8, 3.6], [8.8, 3.6], [-7.0, -6.2], [7.0, -6.2],
    [22.4, 17.0], [22.4, 1.0], [-22.4, 17.0], [-22.4, 1.0],
    [-9.8, -18.8], [9.8, -18.8], [31.8, -13.0], [13.0, -28.8],
    [-13.0, -28.6], [-28.8, -21.0], [28.8, -21.0], [0, -30.6],
  ];
  for (const [x, z] of lampPosts) solid(x, z, 0.32, 0.32, 3.4, 'metal');

  // ----------------------------------------------------------------------- carts
  // (already registered above)

  // ------------------------------------------------------- clutter solids (small)
  // large lumber stacks on the staging wall — visuals in buildLooseProps
  solid(-19.5, 30.8, 1.1, 0.7, 0.8, 'wood');
  solid(19.6, 30.6, 1.2, 0.7, 0.75, 'wood');
  solid(24.6, -25.8, 1.3, 1.3, 1.0, 'wood'); // A-site pallet stack
  solid(-24.6, -26.4, 1.3, 1.3, 1.0, 'wood');
  solid(-15.2, -24.8, 1.0, 1.0, 0.7, 'metal'); // B-site scrap pile
  solid(15.4, -24.6, 1.0, 1.0, 0.7, 'metal');

  // ------------------------------------------- loose props that used to be walk-through
  // single loose crates drawn by buildInstancedProps (visual cube is s wide, top ≈ 0.91·s)
  const looseCrates = [
    [-0.6, 30.2, 0.3, 0.62], [1.5, 30.8, 0.8, 0.55], [4.6, 30.2, 0.1, 0.7],
    [-17.2, 27.0, 0.5, 0.7], [20.4, 27.4, 0.9, 0.72], [-22.0, 14.0, 0.2, 0.7],
    [22.2, 15.2, 0.6, 0.68], [17.6, -7.1, 0.4, 0.7], [-17.6, -7.1, 0.9, 0.7],
    [27.4, -9.6, 0.15, 0.72], [-27.4, -9.6, 0.5, 0.66], [1.4, -20.8, 0.3, 0.72],
    [-1.6, -20.6, 0.8, 0.68], [21.6, -27.4, 0.2, 0.7], [-21.6, -27.4, 0.6, 0.7],
  ].map(([x, z, ry, s]) => ({ x, z, ry, s }));
  for (const c of looseCrates) {
    const foot = +(c.s * 1.02).toFixed(2);
    solid(c.x, c.z, foot, foot, +(c.s * 0.82).toFixed(2), 'wood');
  }
  // tyre stacks drawn by buildInstancedProps: [x, z, count] — stack top = 0.31 + (n-1)·0.3
  const tireStacks = [[-12.4, 22.6, 3], [26.4, 21.4, 4], [-29.6, -11.8, 2], [13.6, -30.6, 3]];
  for (const [x, z, n] of tireStacks) solid(x, z, 1.0, 1.0, +(0.31 + (n - 1) * 0.3).toFixed(2), 'metal');
  // loose sack piles at the bomb sites (visual pile is ~1.8 × 1.3 m, tops ≈ 0.8 m)
  const sackPiles = [[-15.8, -23.2], [16.4, -23.0]];
  for (const [x, z] of sackPiles) solid(x, z, 1.6, 1.2, 0.8, 'fabric');

  // ------------------------------------------------------------- enemy spawn points
  const spawnCandidates = [
    [0, 15.5, 'PLAZA SOUTH'],
    [9.6, 8.2, 'PLAZA EAST'],
    [-9.6, 8.2, 'PLAZA WEST'],
    [0, -12.5, 'COURTYARD'],
    [7.5, -17.5, 'COURTYARD NE'],
    [-7.5, -17.0, 'COURTYARD NW'],
    [25.5, -13.0, 'A LONG'],
    [-24.5, -13.0, 'B TUNNEL'],
    [17.0, -26.0, 'A SITE'],
    [-18.0, -26.0, 'B SITE'],
    [0, -27.6, 'CT YARD'],
    [25.0, 10.0, 'EAST STREET'],
    [-25.0, 10.0, 'WEST STREET'],
    [30.0, -24.0, 'A SITE EAST'],
    [-30.0, -24.5, 'B SITE WEST'],
  ];

  const landmarks = [
    { x: 0, z: 26.0, name: 'STAGING' },
    { x: 0, z: 9.5, name: 'PLAZA' },
    { x: 0, z: -8.5, name: 'MID GATE' },
    { x: 0, z: -15.2, name: 'COURTYARD' },
    { x: 17.5, z: -24.0, name: 'A SITE' },
    { x: -18.0, z: -24.0, name: 'B SITE' },
    { x: 27.0, z: -14.0, name: 'A LONG' },
    { x: -27.0, z: -14.0, name: 'B TUNNEL' },
    { x: 0, z: -29.5, name: 'CT YARD' },
  ];

  // -------------------------------------------------------- resolve enemy spawns
  const pointBlocked = (x, z, clearance) => {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.maxY - b.minY < 0.35) continue;
      if (x > b.minX - clearance && x < b.maxX + clearance && z > b.minZ - clearance && z < b.maxZ + clearance) return true;
    }
    return false;
  };
  const enemySpawns = [];
  for (const [x, z, label] of spawnCandidates) {
    let px = x;
    let pz = z;
    if (pointBlocked(px, pz, 1.45)) {
      let found = false;
      for (let r = 0.5; r <= 8 && !found; r += 0.5) {
        for (let a = 0; a < 24 && !found; a++) {
          const ang = (a / 24) * TAU;
          const nx = x + Math.cos(ang) * r;
          const nz = z + Math.sin(ang) * r;
          if (!pointBlocked(nx, nz, 1.45) && Math.hypot(nx - PLAYER_SPAWN.x, nz - PLAYER_SPAWN.z) > 4.5) {
            px = nx;
            pz = nz;
            found = true;
          }
        }
      }
      if (!found) continue;
    }
    enemySpawns.push({ x: +px.toFixed(2), y: 0, z: +pz.toFixed(2), label });
  }

  const warnings = [];
  for (const box of boxes) {
    if (!(box.maxX > box.minX && box.maxZ > box.minZ && box.maxY > box.minY)) warnings.push('degenerate collision box');
  }
  for (const s of enemySpawns) {
    if (pointBlocked(s.x, s.z, 1.1)) warnings.push(`enemy spawn blocked: ${s.label}`);
  }
  if (pointBlocked(PLAYER_SPAWN.x, PLAYER_SPAWN.z, 0.9)) warnings.push('player spawn blocked');
  if (enemySpawns.length < 8) warnings.push(`only ${enemySpawns.length} enemy spawns resolved`);

  return {
    collisionBoxes: boxes,
    playerSpawn: { ...PLAYER_SPAWN },
    enemySpawns,
    mapBounds: { ...MAP_BOUNDS },
    landmarks,
    warnings,
    layout: {
      walls, boundary, towers, buildings, blocks, lowWalls, pillars, tunnelPiers,
      arches, tunnelArches, crates, barrels, sandbagRuns, palms, lampPosts, gatePiers,
      stalls, hero, siteArches, looseCrates, tireStacks, sackPiles,
    },
  };
}

// #endregion WORLD_DATA

/**
 * Accumulates transformed geometry per material key and flushes it as one mesh
 * per key — the main draw-call reduction tool for static architecture.
 */
class StaticBatcher {
  constructor() {
    this.groups = new Map();
  }

  /** @param {string} key material key @param {THREE.BufferGeometry} geo @param {THREE.Matrix4} matrix */
  add(key, geo, matrix, opts = {}) {
    const group = this.ensure(key, opts);
    const g = transformed(geo, matrix);
    if (opts.uvScale) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * opts.uvScale, uv.getY(i) * opts.uvScale);
    }
    if (opts.uvOffset) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + opts.uvOffset[0], uv.getY(i) + opts.uvOffset[1]);
    }
    if (opts.surface && !group.surface) group.surface = opts.surface;
    group.geos.push(g);
    return g;
  }

  ensure(key, opts = {}) {
    let group = this.groups.get(key);
    if (!group) {
      group = {
        key,
        geos: [],
        material: opts.material ?? null,
        castShadow: opts.castShadow ?? true,
        receiveShadow: opts.receiveShadow ?? true,
        collide: opts.collide ?? true,
        surface: opts.surface ?? null,
        bakeAO: opts.bakeAO ?? false,
        visible: opts.visible !== false,
      };
      this.groups.set(key, group);
    }
    if (opts.material) group.material = opts.material;
    return group;
  }

  flush(parent, materials, collideMeshes) {
    const meshes = [];
    for (const group of this.groups.values()) {
      if (group.geos.length === 0) continue;
      if (group.bakeAO) {
        for (const g of group.geos) bakeVertexAO(g, { seed: group.geos.length });
      }
      const merged = mergeGeometries(group.geos);
      if (!merged) continue;
      const material = group.material || materials[group.key];
      if (!material) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `batch:${group.key}`;
      mesh.castShadow = group.castShadow;
      mesh.receiveShadow = group.receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (group.surface) mesh.userData.surface = group.surface;
      // remember the batch collidability so the raycast target list can exclude
      // decorative batch meshes (dark window recesses, glass, glow, coals)
      mesh.userData.collide = group.collide;
      parent.add(mesh);
      meshes.push(mesh);
      if (group.collide && collideMeshes && group.surface) collideMeshes.push(mesh);
      for (const g of group.geos) g.dispose();
      group.geos.length = 0;
    }
    return meshes;
  }
}

// ===========================================================================
// materials
// ===========================================================================

const QUALITY_SETTINGS = {
  lowest: { shadowMap: 512, dust: 140, motes: 160, anisotropy: 2, lights: 3 },
  low: { shadowMap: 1024, dust: 280, motes: 320, anisotropy: 4, lights: 5 },
  medium: { shadowMap: 2048, dust: 420, motes: 500, anisotropy: 4, lights: 6 },
  high: { shadowMap: 4096, dust: 700, motes: 800, anisotropy: 8, lights: 8 },
  ultra: { shadowMap: 4096, dust: 950, motes: 1100, anisotropy: 16, lights: 8 },
};

function createMaterials(tex) {
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
  return M;
}

// ===========================================================================
// sky + environment lighting
// ===========================================================================

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w;
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uDust;
  uniform vec3 uSunColor;
  uniform vec3 uCloudColor;
  uniform vec3 uGround;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + 17.13;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float sunDot = clamp(dot(d, uSunDir), 0.0, 1.0);
    vec2 sunH = normalize(uSunDir.xz + vec2(0.0001));
    float towardSun = clamp(dot(normalize(d.xz + vec2(0.0001)), sunH), 0.0, 1.0);

    // vertical gradient
    float t = pow(clamp(h, 0.0, 1.0), 0.62);
    vec3 sky = mix(uHorizon, uZenith, t);

    // warm dust band hugging the horizon, biased toward the sun
    float band = exp(-max(h, 0.0) * 10.5) * (0.5 + 0.5 * towardSun);
    sky = mix(sky, uDust, clamp(band, 0.0, 1.0) * 0.55);

    // sun halo + disc (HDR so the bloom pass catches it)
    sky += uSunColor * pow(sunDot, 6.0) * 0.16;
    sky += uSunColor * pow(sunDot, 42.0) * 0.5;
    sky += uSunColor * pow(sunDot, 900.0) * 1.4;
    float disc = smoothstep(0.99955, 0.99985, sunDot);
    sky += uSunColor * disc * 5.0;

    // golden-hour cloud sheets on a virtual dome
    if (h > -0.05) {
      vec2 cuv = d.xz / (max(h, 0.02) + 0.22);
      cuv *= 0.5;
      float tt = uTime * 0.0045;
      float c1 = fbm(cuv * 1.15 + vec2(tt * 0.7, tt * 0.12));
      float c2 = fbm(cuv * 2.9 + vec2(-tt * 0.42, tt * 0.25));
      float cloud = smoothstep(0.5, 0.76, c1 * 0.68 + c2 * 0.44);
      cloud *= smoothstep(-0.02, 0.16, h) * (1.0 - smoothstep(0.5, 0.98, h) * 0.65);
      vec3 cloudCol = mix(uCloudColor * 0.72, uCloudColor, smoothstep(0.0, 0.65, sunDot));
      cloudCol += uSunColor * pow(sunDot, 14.0) * 0.35;
      sky = mix(sky, cloudCol, clamp(cloud, 0.0, 1.0) * 0.72);

      // thin high cirrus
      float ci = fbm(cuv * 5.5 + vec2(tt * 1.2, 0.0));
      float cirrus = smoothstep(0.56, 0.8, ci) * smoothstep(0.22, 0.55, h) * 0.15;
      sky = mix(sky, uCloudColor * 1.05, cirrus);
    }

    // ground / haze below the horizon
    sky = mix(sky, uGround, smoothstep(0.02, -0.16, h));
    gl_FragColor = vec4(sky, 1.0);
  }
`;

const SUN_DIR = new THREE.Vector3(-0.893, 0.305, 0.333).normalize();

function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    name: 'sky',
    uniforms: {
      uSunDir: { value: SUN_DIR.clone() },
      uTime: { value: 0 },
      uZenith: { value: new THREE.Color().setRGB(0.10, 0.235, 0.52) },
      uHorizon: { value: new THREE.Color().setRGB(1.34, 0.78, 0.36) },
      uDust: { value: new THREE.Color().setRGB(0.52, 0.29, 0.14) },
      uSunColor: { value: new THREE.Color().setRGB(2.6, 1.7, 0.9) },
      uCloudColor: { value: new THREE.Color().setRGB(1.5, 1.16, 0.88) },
      uGround: { value: new THREE.Color().setRGB(0.26, 0.17, 0.10) },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    toneMapped: true,
    fog: false,
  });
}

function buildSky(ctx) {
  const geo = new THREE.SphereGeometry(340, 48, 24);
  const mat = createSkyMaterial();
  const sky = new THREE.Mesh(geo, mat);
  sky.name = 'sky-dome';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  sky.matrixAutoUpdate = false;
  sky.updateMatrix();
  ctx.scene.add(sky);
  ctx.sky = sky;
  ctx.skyMaterial = mat;
  ctx.disposables.push(geo, mat);
  return sky;
}

function buildEnvironment(ctx) {
  const scene = new THREE.Scene();
  const mat = createSkyMaterial();
  // simpler env: strip cloud uniforms cost by using the same shader (fine, done once)
  mat.uniforms.uTime.value = 0;
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 16), mat);
  scene.add(sphere);
  const groundMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.24, 0.16, 0.095) });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 24), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  scene.add(ground);
  // warm bounce card for metal highlights
  const cardMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.4, 0.9, 0.55) });
  const card = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), cardMat);
  card.position.copy(SUN_DIR).multiplyScalar(55);
  scene.add(card);

  const pmrem = new THREE.PMREMGenerator(ctx.renderer);
  pmrem.compileCubemapShader();
  const rt = pmrem.fromScene(scene, 0.03, 0.1, 200);
  ctx.pmremTarget = rt;
  ctx.scene.environment = rt.texture;
  ctx.scene.environmentIntensity = 0.55;
  pmrem.dispose();
  for (const m of [groundMat, cardMat]) m.dispose();
  sphere.geometry.dispose();
  ground.geometry.dispose();
  card.geometry.dispose();
  mat.dispose();
  return rt;
}

function buildLights(ctx) {
  const scene = ctx.scene;
  const q = QUALITY_SETTINGS[ctx.quality] ?? QUALITY_SETTINGS.high;

  scene.fog = new THREE.FogExp2(0xd7a06c, 0.0104);
  scene.background = new THREE.Color(0xd8a877);

  // low western sun — long shadows fall to the north-east
  const sun = new THREE.DirectionalLight(0xffd2a0, 3.55);
  sun.name = 'sun';
  sun.position.set(SUN_DIR.x * 130, SUN_DIR.y * 130, SUN_DIR.z * 130);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  sun.shadow.camera.left = -46;
  sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 46;
  sun.shadow.camera.bottom = -46;
  sun.shadow.camera.near = 30;
  sun.shadow.camera.far = 290;
  sun.shadow.bias = -0.00045;
  sun.shadow.normalBias = 0.055;
  sun.shadow.radius = 2.2;
  scene.add(sun, sun.target);
  ctx.sun = sun;

  // sky / ground fill
  const hemi = new THREE.HemisphereLight(0x8fb2d8, 0xcf9a60, 0.82);
  hemi.name = 'hemi';
  scene.add(hemi);
  ctx.hemi = hemi;

  const ambient = new THREE.AmbientLight(0x5b4130, 0.17);
  scene.add(ambient);

  // warm bounce from the lit adobe walls on the east side
  const bounce = new THREE.DirectionalLight(0xffb27a, 0.58);
  bounce.position.set(75, 18, -55);
  bounce.target.position.set(0, 0, 0);
  scene.add(bounce, bounce.target);

  ctx.lights = [sun, hemi, ambient, bounce];
  return sun;
}

// ===========================================================================
// ground, paving, exterior terrain / dunes / mesas / distant skyline
// ===========================================================================

function buildGroundAndTerrain(ctx) {
  const scene = ctx.scene;
  const B = ctx.batcher;

  // ---- playable sand floor (flat y = 0, always) ----
  const groundGeo = new THREE.PlaneGeometry(69.5, 69.5, 40, 40);
  {
    const uv = groundGeo.attributes.uv;
    const tile = 2.7;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 69.5) / tile, (uv.getY(i) * 69.5) / tile);
    // macro colour variation baked as vertex colours
    const pos = groundGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const n =
        0.5 +
        0.24 * Math.sin(x * 0.16 + Math.sin(y * 0.12) * 1.2) * Math.cos(y * 0.19) +
        0.14 * Math.sin(x * 0.55 + y * 0.37) +
        0.08 * Math.sin(x * 1.7 - y * 1.3);
      const c = clamp(0.82 + (n - 0.5) * 0.32, 0.55, 1.08);
      colors[i * 3] = c;
      colors[i * 3 + 1] = c * (0.98 + 0.03 * Math.sin(x * 0.9));
      colors[i * 3 + 2] = c * 0.95;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  const ground = new THREE.Mesh(groundGeo, ctx.materials.sand);
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();
  ground.userData.surface = 'sand';
  scene.add(ground);
  ctx.ground = ground;
  ctx.collideMeshes.push(ground);
  ctx.disposables.push(groundGeo);

  // ---- paved patches (slightly raised + polygon offset) ----
  ctx.materials.paving.color.setRGB(0.8, 0.72, 0.6);
  const pavingMat = ctx.materials.paving;
  const pavingPatches = [
    // central plaza
    [0, 9.8, 11.5, 10.5, 0.02],
    // staging apron
    // mid gate plaza
    [0, -4.6, 9.0, 4.2, 0.02],
    // courtyard
    [0, -14.5, 12.0, 10.0, 0.02],
    // A long
    [27.0, -14.2, 9.0, 8.0, 0.02],
    // A site
    [17.6, -24.6, 10.0, 7.4, 0.02],
    // B site
    [-18.0, -24.6, 10.0, 7.4, 0.02],
    // B tunnel
    [-27.0, -14.5, 11.4, 9.6, 0.02],
    // CT / north strip
    [0, -26.6, 17.0, 5.6, 0.02],
    // east street
    [25.5, 7.0, 4.0, 16.0, 0.02],
    // west street
    [-25.5, 7.0, 4.0, 16.0, 0.02],
  ];
  const pavGeoList = [];
  for (const [x, z, w, d, y] of pavingPatches) {
    const g = planeGeometry(w, d, { worldScale: 3.2 });
    pavGeoList.push([g, matrixFor(x, y, z, -Math.PI / 2)]);
  }
  // merge paving planes into one draw call
  const mergedPav = mergeGeometries(pavGeoList.map(([g, m]) => {
    const t = transformed(g, m);
    g.dispose();
    return t;
  }));
  const pavingMesh = new THREE.Mesh(mergedPav, pavingMat);
  pavingMesh.name = 'batch:paving';
  pavingMesh.receiveShadow = true;
  pavingMesh.matrixAutoUpdate = false;
  pavingMesh.updateMatrix();
  pavingMesh.userData.surface = 'stone';
  scene.add(pavingMesh);
  ctx.collideMeshes.push(pavingMesh);
  ctx.disposables.push(mergedPav);

  // ---- surrounding dunes (one big displaced plane) ----
  const duneGeo = new THREE.PlaneGeometry(430, 430, 110, 110);
  {
    duneGeo.rotateX(-Math.PI / 2);
    const pos = duneGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.max(Math.abs(x), Math.abs(z));
      const mask = smoothstep(38, 82, r);
      const far = smoothstep(75, 190, r);
      const dune =
        2.2 +
        5.4 * tileableNoise(x * 0.014 + 11.2, z * 0.014 + 4.7) +
        3.1 * tileableNoise(x * 0.031 - 3.3, z * 0.031 + 8.1) +
        4.5 * Math.pow(Math.abs(Math.sin(x * 0.028 + z * 0.016)), 1.6) * (1 - far);
      const y = -0.45 + mask * Math.max(0, dune - 1.5) + far * 9.0;
      pos.setY(i, y);
      const c = clamp(0.8 + (dune - 4) * 0.045 - far * 0.08, 0.55, 1.06);
      colors[i * 3] = c;
      colors[i * 3 + 1] = c * 0.97;
      colors[i * 3 + 2] = c * 0.92;
    }
    // UVs: world scale
    const uv = duneGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 430) / 9.5, (uv.getY(i) * 430) / 9.5);
    duneGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    duneGeo.computeVertexNormals();
  }
  const duneMesh = new THREE.Mesh(duneGeo, ctx.materials.sandDune);
  duneMesh.name = 'dunes';
  duneMesh.position.y = 0;
  duneMesh.receiveShadow = true;
  duneMesh.matrixAutoUpdate = false;
  duneMesh.updateMatrix();
  scene.add(duneMesh);
  ctx.disposables.push(duneGeo);

  // ---- distant mesas (merged) ----
  const rockMat = ctx.materials.rock;
  const mesaRng = makeRNG(9182);
  const mesaGeos = [];
  const mesaSpecs = [
    [-150, -190, 46, 62, 7], [30, -240, 58, 44, 9], [168, -180, 38, 78, 6],
    [235, 20, 30, 92, 8], [180, 160, 44, 60, 6], [-60, 235, 52, 70, 9],
    [-230, 110, 40, 48, 7], [-250, -70, 34, 85, 6],
  ];
  for (const [x, z, h, r, sides] of mesaSpecs) {
    const base = cylinderWorldUV(r * (0.55 + mesaRng() * 0.2), r, h, sides, 7, false);
    const m = matrixFor(x, h / 2 - 2, z, 0, mesaRng() * TAU);
    mesaGeos.push(transformed(base, m));
    base.dispose();
    // talus skirt
    const skirt = cylinderWorldUV(r * 1.45, r * 1.8, h * 0.33, sides, 8, false);
    const ms = matrixFor(x, h * 0.16 - 2, z, 0, mesaRng() * TAU, 0, 1, 1, 1);
    mesaGeos.push(transformed(skirt, ms));
    skirt.dispose();
    // cap rock
    const cap = cylinderWorldUV(r * 0.5, r * 0.57, h * 0.14, sides, 7, false);
    mesaGeos.push(transformed(cap, matrixFor(x, h - 1.2, z, 0, mesaRng() * TAU)));
    cap.dispose();
  }
  const mergedMesas = mergeGeometries(mesaGeos);
  const mesas = new THREE.Mesh(mergedMesas, rockMat);
  mesas.name = 'mesas';
  mesas.matrixAutoUpdate = false;
  mesas.updateMatrix();
  mesas.castShadow = false;
  mesas.receiveShadow = false;
  scene.add(mesas);
  ctx.disposables.push(mergedMesas);

  // ---- adobe skyline outside the walls (layered silhouettes) ----
  const skylineGeos = [];
  const skyRng = makeRNG(4455);
  const adobeDark = ctx.materials.adobeDark;
  for (let i = 0; i < 34; i++) {
    const ang = (i / 34) * TAU + skyRng() * 0.11;
    const dist = 44 + skyRng() * 34;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const w = 4 + skyRng() * 11;
    const d = 4 + skyRng() * 11;
    const h = 4.5 + skyRng() * 9;
    const geo = boxGeometryWorldUV(w, h, d, 3.5);
    skylineGeos.push(transformed(geo, matrixFor(x, h / 2 - 0.4, z, 0, -ang + Math.PI / 2)));
    geo.dispose();
    if (i % 3 === 0) {
      // rooftop parapet block
      const p = boxGeometryWorldUV(w * 0.7, 1.4, d * 0.7, 3.5);
      skylineGeos.push(transformed(p, matrixFor(x, h + 0.5, z, 0, skyRng() * TAU)));
      p.dispose();
    }
    if (i % 6 === 1) {
      // mud minaret
      const tower = cylinderWorldUV(0.8, 1.7, 9 + skyRng() * 6, 8, 3.5);
      skylineGeos.push(transformed(tower, matrixFor(x + w * 0.4, h + 4.5, z + d * 0.2, 0, 0)));
      tower.dispose();
    }
  }
  const mergedSkyline = mergeGeometries(skylineGeos);
  const skyline = new THREE.Mesh(mergedSkyline, adobeDark);
  skyline.name = 'skyline';
  skyline.matrixAutoUpdate = false;
  skyline.updateMatrix();
  skyline.castShadow = false;
  skyline.receiveShadow = false;
  scene.add(skyline);
  ctx.disposables.push(mergedSkyline);

  // ---- distant sand haze floor beyond the dunes ----
  const farGeo = new THREE.CircleGeometry(900, 32);
  const farMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.56, 0.36, 0.20), fog: true });
  const far = new THREE.Mesh(farGeo, farMat);
  far.rotation.x = -Math.PI / 2;
  far.position.y = -1.1;
  far.matrixAutoUpdate = false;
  far.updateMatrix();
  scene.add(far);
  ctx.disposables.push(farGeo, farMat);
}

/** Simple deterministic value noise used for the dune field. */
function tileableNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const h = (a, b) => {
    let n = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

// ===========================================================================
// architecture — boundary, mid gate, bazaar, warehouses, tunnel, site arches
// ===========================================================================

const FONT_MONO = 'Consolas, "Cascadia Mono", "Courier New", monospace';

function ensureBatches(ctx) {
  const M = ctx.materials;
  const B = ctx.batcher;
  const def = (key, material, surface, opts = {}) =>
    B.ensure(key, {
      material,
      surface,
      bakeAO: opts.bakeAO ?? false,
      castShadow: opts.castShadow ?? true,
      receiveShadow: opts.receiveShadow ?? true,
      collide: opts.collide ?? true,
    });
  def('adobe', M.adobe, 'stone', { bakeAO: true });
  def('adobeLight', M.adobeLight, 'stone', { bakeAO: true });
  def('stone', M.stone, 'stone', { bakeAO: true });
  def('stoneDark', M.stoneDark, 'stone', { bakeAO: true });
  def('wood', M.wood, 'wood', { bakeAO: true });
  def('woodDark', M.woodDark, 'wood', { bakeAO: true });
  def('metal', M.metal, 'metal');
  def('metalDark', M.metalDark, 'metal');
  def('rust', M.rust, 'metal');
  def('sheet', M.sheet, 'metal');
  def('rubber', M.rubber, 'metal');
  def('dark', M.dark, 'stone', { castShadow: false, collide: false });
  def('glass', M.glass, 'stone', { castShadow: false, collide: false });
  def('crate', M.crate, 'wood');
  def('glowWarm', M.glowWarm, 'metal', { castShadow: false, collide: false });
  def('glowCyan', M.glowCyan, 'metal', { castShadow: false, collide: false });
  def('coals', M.coals, 'stone', { castShadow: false, collide: false });
  def('tarp', M.tarp, 'fabric', { bakeAO: false });
  def('awning', M.awning, 'fabric', {});
}

// ------------------------------------------------------------------ B tunnel

function buildTunnel(ctx) {
  const L = ctx.data.layout;
  // covered passage roof. Panel depth matches the 2.26 m bay spacing: with the old
  // 2.36 m depth neighbouring panels overlapped 0.10 m, so their coplanar underside
  // faces z-fought in 11.4 m long strips across the ceiling.
  for (let z = -10.2; z >= -19.2; z -= 2.26) {
    boxBatch(ctx, 'sheet', -27.0, 3.5, z, 11.4, 0.1, 2.26, { tile: 1.6 });
  }
  for (const z of [-10.6, -13.4, -16.2, -19.0]) {
    boxBatch(ctx, 'wood', -27.0, 3.3, z, 11.5, 0.26, 0.24, { tile: 1.4 });
    // support posts flush to the walls
    for (const x of [-32.82, -21.16]) {
      baseBox(ctx, 'wood', x, z, 0.22, 3.3, 0.22, { tile: 1.2 });
    }
  }
  // low parapet along the tunnel roof edges
  for (const x of [-32.6, -21.4]) {
    boxBatch(ctx, 'adobe', x, 3.72, -14.6, 0.28, 0.4, 9.8, { tile: 1.8 });
  }
  // arches
  for (const a of L.tunnelArches) addArchMesh(ctx, a);
  // hanging lanterns + warm practicals
  for (const [x, z, flick] of [[-27, -11.8, 1], [-27, -15.2, 0], [-24.6, -18.4, 1], [-29.6, -10.0, 0]]) {
    ctx.req.lanterns.push({ x, y: 2.85, z, kind: 'warm', size: 0.34, hang: 3.3 });
    if (flick) ctx.req.lights.push({ x, y: 2.7, z, color: 0xff9a44, intensity: 13, distance: 13, kind: 'flicker' });
  }
  // signs at both portals
  makeSign(ctx, { text: 'B TUNNEL', sub: '西 隧 道', x: -24.0, y: 3.0, z: -9.42, ry: Math.PI, w: 2.6, h: 1.1, seed: 171, accent: '#2f6470' });
  makeSign(ctx, { text: 'B SITE', sub: 'B 点', x: -24.0, y: 3.0, z: -19.7, ry: 0, w: 2.3, h: 1.0, seed: 172, accent: '#2f6470' });
  // cloth strips hanging from the roof for warmth
  for (const [x, z] of [[-31.2, -12.4], [-22.8, -15.8], [-30.4, -18.2]]) {
    ctx.req.awnings.push({ type: 'strip', x, y: 3.35, z, w: 1.2, d: 2.2, key: 'awning', ry: 0.1, pitch: 0, strip: true });
  }
  // wall stencils
  for (const [x, z, cell] of [[-32.9, -12.6, 'tracks'], [-21.1, -16.2, 'tag'], [-32.9, -17.2, 'num07']]) {
    ctx.req.decals.push({ x, y: 1.6, z, rx: 0, ry: Math.PI / 2, cell, w: 1.6, h: 1.6, opacity: 0.75 });
  }
}

function buildArchitecture(ctx) {
  ensureBatches(ctx);
  buildBoundary(ctx);
  buildMidWall(ctx);
  buildBazaarRows(ctx);
  buildWarehouseBlocks(ctx);
  buildLowWalls(ctx);
  buildColonnade(ctx);
  buildTunnel(ctx);
  buildSiteArches(ctx);
}

// ===========================================================================
// props — instanced clutter + hero set pieces
// ===========================================================================

function buildInstancedProps(ctx) {
  // Each clutter family is its own model module; the call order below is part of the
  // visual contract (identical registration order to the original monolithic builder).
  buildCrateFamily(ctx);    // also publishes ctx.instanced.crates
  buildBarrelFamily(ctx);
  buildSandbagFamily(ctx);
  buildPalmFamily(ctx);
  buildRubbleFamily(ctx);
  buildTireFamily(ctx);
  buildSackFamily(ctx);
}

/**
 * Loose dressing that previously only existed as bare collision boxes: the two
 * staging lumber stacks and the two site scrap heaps. Each matches its solid.
 */
function buildLooseProps(ctx) {
  // staging lumber / plank stacks (solids: 1.1×0.7×0.8 and 1.2×0.7×0.75 wood)
  for (const [x, z, w, d, h] of [[-19.5, 30.8, 1.1, 0.7, 0.8], [19.6, 30.6, 1.2, 0.7, 0.75]]) {
    const rows = 4;
    for (let i = 0; i < rows; i++) {
      boxBatch(ctx, 'wood', x + (i % 2 ? 0.03 : -0.02), (i + 0.5) * (h / rows), z, w - 0.02, (h / rows) * 0.86, d, { tile: 1.2, ry: i % 2 ? 0.05 : -0.04 });
    }
    boxBatch(ctx, 'woodDark', x, h + 0.03, z, w * 0.5, 0.06, d * 0.9, { tile: 1.0 });
  }
  // site scrap heaps (solids: 1.0×1.0×0.7 metal at both bomb sites)
  for (const [x, z] of [[-15.2, -24.8], [15.4, -24.6]]) {
    boxBatch(ctx, 'rust', x, 0.12, z, 0.94, 0.24, 0.7, { tile: 1.2 });
    boxBatch(ctx, 'rust', x - 0.03, 0.33, z + 0.04, 0.82, 0.18, 0.6, { tile: 1.2, ry: 0.18 });
    boxBatch(ctx, 'rust', x + 0.05, 0.5, z - 0.03, 0.66, 0.16, 0.5, { tile: 1.2, ry: -0.24 });
    boxBatch(ctx, 'metalDark', x, 0.64, z, 0.5, 0.14, 0.4, { tile: 1.2, ry: 0.4 });
    rodBetween(ctx, 'metalDark', x + 0.32, 0.05, z + 0.3, x + 0.05, 0.95, z + 0.02, 0.035, 5);
  }
}

function buildProps(ctx) {
  buildInstancedProps(ctx);
  buildLampPosts(ctx);
  buildFlagpoles(ctx);
  buildALongShade(ctx);
  buildLooseProps(ctx);
  buildWell(ctx);
  buildTruck(ctx);
  buildStalls(ctx);
  buildWindmill(ctx);
  buildRadar(ctx);
  buildCarts(ctx);
  buildCampfire(ctx);
  buildAPlatform(ctx);
  buildBWreck(ctx);
  buildPipeline(ctx);
}

// ===========================================================================
// cloth, banners, decals, posters, lanterns, practicals, ambience
// ===========================================================================

function buildCloths(ctx) {
  const rng = makeRNG(1717);
  // banners & flags have been requested by the architecture pass
  const siteBanners = ctx.stage ? [] : [
    { key: 'a', x: 17.5, y: 4.4, z: -32.84, ry: 0, w: 3.2, h: 5.6 },
    { key: 'b', x: -18.0, y: 4.4, z: -32.84, ry: 0, w: 3.2, h: 5.6 },
    { key: 'a', x: 20.6, y: 4.2, z: -29.4, ry: Math.PI * 0.1, w: 2.4, h: 4.2 },
    { key: 'b', x: -20.6, y: 4.2, z: -29.4, ry: -Math.PI * 0.1, w: 2.4, h: 4.2 },
  ];
  for (const b of siteBanners) ctx.req.banners.push({ ...b, sway: 0.05, anchor: 'top' });
  // staging flag poles (the pole meshes are part of the boundary pass; the stage
  // preview supplies its own pole proxy and requests the cloth explicitly)
  if (!ctx.stage) {
    for (const f of ctx.data.layout.hero.flagpoles) {
      // cloth hangs from just under the pole top and its readable face is turned to
      // the staging area (-Z) instead of the south wall (text used to read mirrored)
      ctx.req.flags.push({ x: f.x, y: f.h - 0.05, z: f.z, w: 2.3, h: 1.5, ry: Math.PI - 0.35, key: f.x > 0 ? 'warn' : 'title', phase: rng() * 6 });
    }
  }

  for (const req of ctx.req.banners) createBanner(ctx, req, rng);

  for (const req of ctx.req.flags) createFlag(ctx, req, rng);

  for (const req of ctx.req.awnings) createAwning(ctx, req, rng);

  for (const req of ctx.req.sails) {
    const geo = new THREE.PlaneGeometry(req.w, req.d, 14, 8);
    const sag = req.sag ?? 0.5;
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = clamp(p.getX(i) / req.w + 0.5, 0, 1);
      const v = clamp(p.getY(i) / req.d + 0.5, 0, 1);
      p.setZ(i, p.getZ(i) - sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, clothMaterial(ctx, req.key));
    mesh.position.set(req.x, req.y, req.z);
    mesh.rotation.set(-Math.PI / 2, req.ry ?? 0, 0, 'YXZ');
    mesh.name = 'shade-sail';
    ctx.disposables.push(geo);
    ctx.objects.push(mesh);
    registerCloth(ctx, mesh, geo, 'sail', req.w, req.d, 0.055, req.phase ?? rng() * 6.28);
  }
}

// ------------------------------------------------------------ decals & posters

function buildSiteStencils(ctx) {
  if (ctx.stage) return; // isolated model previews only materialise their own requests
  const d = ctx.req.decals;
  const ground = -Math.PI / 2;
  // bomb-site stencils
  d.push({ x: 17.6, y: 0.045, z: -25.3, rx: ground, ry: 0.06, cell: 'siteA', w: 5.4, h: 5.4, opacity: 1 });
  d.push({ x: -18.0, y: 0.045, z: -25.3, rx: ground, ry: -0.04, cell: 'siteB', w: 5.4, h: 5.4, opacity: 1 });
  d.push({ x: 17.6, y: 0.04, z: -21.2, rx: ground, ry: 0, cell: 'splat', w: 3.0, h: 3.0, opacity: 0.65 });
  d.push({ x: -18.0, y: 0.04, z: -21.6, rx: ground, ry: 0, cell: 'splat', w: 3.0, h: 3.0, opacity: 0.65 });
  // lane arrows
  d.push({ x: 27.0, y: 0.04, z: -11.4, rx: ground, ry: Math.PI, cell: 'arrow', w: 2.4, h: 3.0, opacity: 0.9 });
  d.push({ x: 27.0, y: 0.04, z: -17.2, rx: ground, ry: Math.PI, cell: 'arrow', w: 2.4, h: 3.0, opacity: 0.9 });
  d.push({ x: -27.0, y: 0.04, z: -11.2, rx: ground, ry: Math.PI, cell: 'arrow', w: 2.4, h: 3.0, opacity: 0.9 });
  d.push({ x: 0.0, y: 0.04, z: 23.2, rx: ground, ry: Math.PI, cell: 'chevrons', w: 1.45, h: 1.45, opacity: 0.28 });
  d.push({ x: 0.0, y: 0.04, z: -10.8, rx: ground, ry: 0, cell: 'chevrons', w: 1.7, h: 1.7, opacity: 0.42 });
  // hazard stripes at thresholds
  d.push({ x: 0, y: 0.042, z: -6.9, rx: ground, ry: 0, cell: 'hazard', w: 4.2, h: 1.6, opacity: 0.9 });
  d.push({ x: 24.0, y: 0.042, z: -7.4, rx: ground, ry: 0, cell: 'hazard', w: 4.6, h: 1.6, opacity: 0.85 });
  d.push({ x: -24.0, y: 0.042, z: -7.4, rx: ground, ry: 0, cell: 'hazard', w: 4.6, h: 1.6, opacity: 0.85 });
  // grime & chips on walls
  const wallRng = makeRNG(1919);
  const wallSpots = [
    [15.48, -12.4, -Math.PI / 2], [-15.48, -12.0, Math.PI / 2], [21.02, -13.4, Math.PI / 2],
    [-21.02, -13.2, -Math.PI / 2], [-32.88, -14.0, Math.PI / 2], [32.88, -14.0, -Math.PI / 2],
  ];
  for (const [x, z, ry] of wallSpots) {
    d.push({ x, y: 1.3 + wallRng() * 1.0, z: z + wallRng() * 1.6, rx: 0, ry, cell: 'grime', w: 2.2, h: 2.2, opacity: 0.6 });
    d.push({ x, y: 2.1 + wallRng() * 0.8, z: z + wallRng() * 2.0, rx: 0, ry, cell: 'chips', w: 1.4, h: 1.4, opacity: 0.8 });
  }
  // graffiti / tags
  d.push({ x: 15.46, y: 2.2, z: -17.0, rx: 0, ry: -Math.PI / 2, cell: 'tag', w: 2.2, h: 1.4, opacity: 0.9 });
  d.push({ x: -15.46, y: 2.2, z: -16.6, rx: 0, ry: Math.PI / 2, cell: 'skull', w: 1.8, h: 1.8, opacity: 0.85 });
  d.push({ x: 21.04, y: 1.7, z: -17.8, rx: 0, ry: Math.PI / 2, cell: 'num07', w: 1.6, h: 1.6, opacity: 0.8 });
  // footprints & stains
  d.push({ x: 0.3, y: 0.04, z: 18.0, rx: ground, ry: 0.1, cell: 'footprints', w: 1.0, h: 2.4, opacity: 0.5 });
  d.push({ x: -1.2, y: 0.04, z: 12.4, rx: ground, ry: 0.05, cell: 'footprints', w: 1.0, h: 2.4, opacity: 0.45 });
  d.push({ x: 8.6, y: 0.04, z: 2.6, rx: ground, ry: 0, cell: 'oil', w: 1.8, h: 1.8, opacity: 0.5 });
  d.push({ x: -8.0, y: 0.04, z: -2.0, rx: ground, ry: 0, cell: 'oil', w: 1.4, h: 1.4, opacity: 0.45 });
  d.push({ x: 17.2, y: 0.04, z: -29.2, rx: ground, ry: 0.3, cell: 'tracks', w: 4.0, h: 2.2, opacity: 0.45 });
  d.push({ x: -18.4, y: 0.04, z: -29.4, rx: ground, ry: -0.2, cell: 'tracks', w: 4.0, h: 2.2, opacity: 0.45 });
}

function buildPosterRequests(ctx) {
  if (ctx.stage) return; // isolated model previews only materialise their own requests
  const d = ctx.req.posters;
  // staging / spawn boards
  d.push({ x: -6.2, y: 2.2, z: 32.86, ry: Math.PI, cell: 'water', w: 1.1, h: 2.0 });
  d.push({ x: 6.8, y: 2.2, z: 32.86, ry: Math.PI, cell: 'hostile', w: 1.1, h: 2.0 });
  d.push({ x: -9.4, y: 2.4, z: 32.86, ry: Math.PI, cell: 'ammo', w: 1.1, h: 2.0 });
  // courtyard walls
  d.push({ x: -12.0, y: 2.4, z: -9.42, ry: 0, cell: 'sector', w: 1.0, h: 1.8 });
  d.push({ x: 11.4, y: 2.4, z: -9.42, ry: 0, cell: 'shabao', w: 1.0, h: 1.8 });
  // A / B site
  d.push({ x: 20.0, y: 2.6, z: -19.42, ry: 0, cell: 'aArrow', w: 1.2, h: 2.2 });
  d.push({ x: -21.0, y: 2.6, z: -19.42, ry: 0, cell: 'medevac', w: 1.1, h: 2.0 });
}

function buildDecalsAndPosters(ctx) {
  buildSiteStencils(ctx);
  buildPosterRequests(ctx);
  const decalCells = ctx.tex.decalAtlas.cells;
  mergePlanes(ctx, ctx.req.decals, (r) => decalCells[r.cell], ctx.materials.decal, 'batch:decals');
  const posterCells = ctx.tex.posterAtlas.cells;
  mergePlanes(ctx, ctx.req.posters, (r) => posterCells[r.cell], ctx.materials.poster, 'batch:posters');
}

// ------------------------------------------------------------------- lanterns

function buildLanterns(ctx) {
  const positions = [];
  const colors = [];
  const sizes = [];
  const phases = [];
  const warm = new THREE.Color(0xffb060);
  const cyan = new THREE.Color(0x8ceaff);
  const fire = new THREE.Color(0xff7a2e);
  for (const req of ctx.req.lanterns) {
    const kind = req.kind ?? 'warm';
    const isFire = kind === 'fire';
    const size = req.size ?? 0.28;
    if (!isFire) {
      // hanging rod
      if (req.hang) {
        const rod = new THREE.CylinderGeometry(0.022, 0.022, Math.max(0.1, req.hang - req.y), 5);
        ctx.batcher.add('metalDark', rod, matrixFor(req.x, (req.hang + req.y) / 2, req.z));
        rod.dispose();
      }
      const hood = new THREE.CylinderGeometry(size * 0.75, size * 0.5, size * 0.34, 7);
      ctx.batcher.add('metalDark', hood, matrixFor(req.x, req.y + size * 0.62, req.z));
      hood.dispose();
      const glass = new THREE.BoxGeometry(size * 0.62, size * 0.75, size * 0.62);
      ctx.batcher.add(kind === 'cyan' ? 'glowCyan' : 'glowWarm', glass, matrixFor(req.x, req.y, req.z));
      glass.dispose();
      for (const s of [-1, 1]) {
        const bar = new THREE.BoxGeometry(0.025, size * 0.9, 0.025);
        ctx.batcher.add('metalDark', bar, matrixFor(req.x + s * size * 0.34, req.y, req.z));
        bar.dispose();
        const bar2 = new THREE.BoxGeometry(0.025, size * 0.9, 0.025);
        ctx.batcher.add('metalDark', bar2, matrixFor(req.x, req.y, req.z + s * size * 0.34));
        bar2.dispose();
      }
    }
    const c = isFire ? fire : kind === 'cyan' ? cyan : warm;
    positions.push(req.x, req.y, req.z);
    colors.push(c.r, c.g, c.b);
    sizes.push(isFire ? size * 3.4 : size * 2.6);
    phases.push((req.x * 7.3 + req.z * 3.1) % 6.283);
  }
  if (positions.length === 0) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 620 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize; attribute float aPhase;
      uniform float uTime; uniform float uScale;
      varying vec3 vColor; varying float vFlicker;
      void main() {
        vColor = aColor;
        vFlicker = 0.72 + 0.2 * sin(uTime * 3.1 + aPhase) + 0.08 * sin(uTime * 11.3 + aPhase * 2.3);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(0.6, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vFlicker;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float d = dot(uv, uv);
        if (d > 1.0) discard;
        float a = pow(1.0 - d, 2.2) * vFlicker;
        gl_FragColor = vec4(vColor * 2.2, a * 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'lantern-glows';
  ctx.scene.add(points);
  ctx.objects.push(points);
  ctx.disposables.push(geo, mat);
  ctx.glowPoints = points;
}

function buildPracticalLights(ctx) {
  let count = 0;
  const q = QUALITY_SETTINGS[ctx.quality] ?? QUALITY_SETTINGS.high;
  const maxLights = q.lights ?? 8;
  for (const req of ctx.req.lights) {
    if (count >= maxLights) break;
    if (req.kind === 'accent') continue;
    if (req.kind === 'pulse') continue;
    const light = new THREE.PointLight(req.color ?? 0xffa050, req.intensity ?? 10, req.distance ?? 12, 2);
    light.position.set(req.x, req.y, req.z);
    light.castShadow = false;
    ctx.scene.add(light);
    ctx.lights.push(light);
    ctx.flickers.push({
      light,
      base: req.intensity ?? 10,
      speed: 7 + ((req.x + req.z) % 5),
      seed: (req.x * 3.7 + req.z * 1.3) % 6.28,
      fire: req.kind === 'fire',
    });
    count++;
  }
}

// -------------------------------------------------------------- dust & smoke

function buildDust(ctx) {
  const q = QUALITY_SETTINGS[ctx.quality] ?? QUALITY_SETTINGS.high;
  const count = q.dust;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const rng = makeRNG(3535);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rng() - 0.5) * 64;
    positions[i * 3 + 1] = 0.2 + rng() * 8.5;
    positions[i * 3 + 2] = (rng() - 0.5) * 64;
    seeds[i] = rng();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float t = uTime * 0.06;
        p.x += sin(t * 2.1 + aSeed * 21.0) * 2.4;
        p.z += cos(t * 1.7 + aSeed * 17.0) * 2.4;
        p.y += sin(t * 3.4 + aSeed * 9.0) * 0.7 + fract(uTime * 0.015 + aSeed) * 0.8;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp((0.9 + aSeed * 1.8) * (13.0 / max(2.0, -mv.z)), 1.0, 7.0);
        gl_Position = projectionMatrix * mv;
        vAlpha = 0.10 + 0.22 * aSeed;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float d = dot(uv, uv);
        if (d > 1.0) discard;
        float a = (1.0 - d) * (1.0 - d) * vAlpha;
        gl_FragColor = vec4(vec3(1.0, 0.84, 0.62) * 1.2, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'dust-motes';
  ctx.scene.add(points);
  ctx.objects.push(points);
  ctx.disposables.push(geo, mat);
  ctx.dust = points;
}

function buildSmoke(ctx) {
  const systems = ctx.req.smoke;
  if (!systems.length) return;
  let total = 0;
  for (const s of systems) total += s.count;
  const positions = new Float32Array(total * 3);
  const seeds = new Float32Array(total);
  const colors = new Float32Array(total * 3);
  const rates = new Float32Array(total);
  const rises = new Float32Array(total);
  const spreads = new Float32Array(total);
  const rng = makeRNG(2626);
  let i = 0;
  for (const s of systems) {
    const col = new THREE.Color(s.color ?? 0x8a8074);
    for (let k = 0; k < s.count; k++) {
      positions[i * 3] = s.x + (rng() - 0.5) * s.spread;
      positions[i * 3 + 1] = s.y;
      positions[i * 3 + 2] = s.z + (rng() - 0.5) * s.spread;
      seeds[i] = rng();
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
      rates[i] = (s.rate ?? 0.4) * (0.7 + rng() * 0.6);
      rises[i] = s.rise ?? 2.2;
      spreads[i] = s.spread ?? 0.4;
      i++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aRate', new THREE.BufferAttribute(rates, 1));
  geo.setAttribute('aRise', new THREE.BufferAttribute(rises, 1));
  geo.setAttribute('aSpread', new THREE.BufferAttribute(spreads, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 560 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; attribute vec3 aColor; attribute float aRate; attribute float aRise; attribute float aSpread;
      uniform float uTime; uniform float uScale;
      varying float vAlpha; varying vec3 vColor;
      void main() {
        float life = fract(uTime * aRate + aSeed * 7.13);
        vec3 p = position;
        p.y += life * aRise;
        p.x += sin(life * 5.1 + aSeed * 13.0) * aSpread * (0.4 + life);
        p.z += cos(life * 4.3 + aSeed * 9.0) * aSpread * (0.4 + life);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.55 + life * 2.4) * uScale / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
        vAlpha = sin(life * 3.1415) * 0.22;
        vColor = aColor;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha; varying vec3 vColor;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float d = dot(uv, uv);
        if (d > 1.0) discard;
        gl_FragColor = vec4(vColor, (1.0 - d) * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'smoke';
  ctx.scene.add(points);
  ctx.objects.push(points);
  ctx.disposables.push(geo, mat);
  ctx.smoke = points;
}

// ------------------------------------------------------------- site practicals

function buildSiteDressing(ctx) {
  // warm lanterns at each site
  ctx.req.lanterns.push({ x: 17.5, y: 3.15, z: -20.3, kind: 'warm', size: 0.32, hang: 4.9 });
  ctx.req.lanterns.push({ x: -18.0, y: 3.15, z: -20.4, kind: 'warm', size: 0.32, hang: 4.7 });
  ctx.req.lights.push({ x: 17.5, y: 3.2, z: -21.0, color: 0xffa050, intensity: 11, distance: 12, kind: 'flicker' });
  ctx.req.lights.push({ x: -18.0, y: 3.2, z: -21.0, color: 0xffa050, intensity: 11, distance: 12, kind: 'flicker' });
  // crates / barrels are instanced already; add loose planks and scrap up top of the arch? keep lightweight
  ctx.req.decals.push({ x: 17.5, y: 4.55, z: -21.95, rx: 0, ry: 0, cell: 'warn', w: 1.4, h: 1.4, opacity: 0.7 });
  ctx.req.decals.push({ x: -18.0, y: 4.3, z: -21.15, rx: 0, ry: 0, cell: 'warn', w: 1.3, h: 1.3, opacity: 0.7 });
}

// ===========================================================================
// life support: update / dispose
// ===========================================================================

function updateCloths(ctx, time) {
  for (const c of ctx.cloths) {
    const attr = c.geo.attributes.position;
    const arr = attr.array;
    const base = c.base;
    for (let i = 0; i < attr.count; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      const u = clamp(bx / c.w + 0.5, 0, 1);
      const v = clamp(by / c.h + 0.5, 0, 1);
      let weight;
      if (c.type === 'banner') weight = Math.sin(Math.PI * u) * Math.pow(1 - v, 1.3);
      else if (c.type === 'flag') weight = Math.pow(clamp(bx / c.w, 0, 1), 1.15) * (0.55 + 0.45 * Math.sin(Math.PI * v));
      else if (c.type === 'strip') weight = Math.pow(1 - v, 1.4) * Math.sin(Math.PI * u);
      else weight = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      const wave =
        Math.sin(time * c.speed + u * 3.1 + c.phase) * c.amp * weight +
        Math.sin(time * c.speed * 1.63 + v * 4.7 + c.phase * 2.1) * c.amp * 0.45 * weight;
      arr[i * 3 + 2] = base[i * 3 + 2] + wave;
    }
    attr.needsUpdate = true;
    c.geo.computeVertexNormals();
  }
}

function updateWorld(ctx, dt, time) {
  if (ctx.disposed) return;
  if (ctx.skyMaterial) ctx.skyMaterial.uniforms.uTime.value = time;
  if (ctx.glowPoints) ctx.glowPoints.material.uniforms.uTime.value = time;
  if (ctx.dust) ctx.dust.material.uniforms.uTime.value = time;
  if (ctx.smoke) ctx.smoke.material.uniforms.uTime.value = time;
  updateCloths(ctx, time);
  for (const a of ctx.animated) {
    if (a.kind === 'rotor') a.obj.rotation.z += a.speed * dt;
    else if (a.kind === 'radar') {
      a.obj.rotation.y += a.speed * dt;
      if (a.beacon && a.beacon.material) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
        a.beacon.material.emissiveIntensity = 2.0 + pulse * 3.4;
      }
    }
  }
  for (const f of ctx.flickers) {
    const t = time * f.speed + f.seed;
    let k = 0.82 + 0.12 * Math.sin(t) + 0.06 * Math.sin(t * 2.7);
    if (f.fire) k += 0.1 * Math.sin(time * 17.0 + f.seed * 3.1);
    f.light.intensity = f.base * k;
  }
  // subtle sun warmth shift over time (dust in the air)
  if (ctx.sun) ctx.sun.intensity = 3.55 + Math.sin(time * 0.05) * 0.08;
}

function disposeWorld(ctx) {
  if (ctx.disposed) return;
  ctx.disposed = true;
  const scene = ctx.scene;
  const objects = ctx.worldObjects ?? [];
  const materials = new Set();
  const geometries = new Set();
  for (const obj of objects) {
    obj.traverse?.((node) => {
      if (node.geometry) geometries.add(node.geometry);
      const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      for (const m of mats) materials.add(m);
    });
    if (obj.parent) obj.parent.remove(obj);
  }
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  for (const t of ctx.textures) t.dispose();
  try {
    ctx.tex.dispose?.();
  } catch (err) {
    /* ignore */
  }
  if (ctx.pmremTarget) ctx.pmremTarget.dispose();
  scene.environment = null;
  scene.fog = null;
  ctx.cloths.length = 0;
  ctx.flickers.length = 0;
  ctx.collideMeshes.length = 0;
  ctx.objects.length = 0;
  ctx.disposables.length = 0;
}

// ===========================================================================
// PUBLIC API — createWorld()
// ===========================================================================

/**
 * Build the complete outpost.
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ quality?: 'medium'|'high'|'ultra', onProgress?: (progress:number, label:string)=>void }} [options]
 */
export async function createWorld(scene, renderer, { quality = 'high', onProgress } = {}) {
  const q = QUALITY_SETTINGS[quality] ? quality : 'high';
  const report = (p, label) => {
    if (typeof onProgress === 'function') {
      try {
        onProgress(clamp(p, 0, 1), label);
      } catch (err) {
        /* UI errors must never break world generation */
      }
    }
  };

  const childrenBefore = new Set(scene.children);
  const textures = [];
  const objects = [];
  const disposables = [];
  const materialsCustom = [];
  const collideMeshes = [];
  const lights = [];
  const flickers = [];
  const cloths = [];
  const animated = [];
  const req = { banners: [], awnings: [], sails: [], flags: [], decals: [], posters: [], lanterns: [], lights: [], smoke: [] };

  const ctx = {
    scene,
    renderer,
    quality: q,
    data: null,
    tex: null,
    materials: null,
    textures,
    objects,
    disposables,
    materialsCustom,
    collideMeshes,
    lights,
    flickers,
    cloths,
    animated,
    req,
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
  };

  report(0.02, 'SURVEYING SECTOR 7');
  ctx.data = buildWorldData();
  if (ctx.data.warnings.length) {
    console.warn('[world] layout warnings:', ctx.data.warnings);
  }

  report(0.04, 'GENERATING MATERIALS');
  ctx.tex = await createTextureLibrary(renderer, {
    quality: q,
    onProgress: (p, label) => report(0.04 + p * 0.46, label),
  });
  ctx.materials = createMaterials(ctx.tex);
  for (const m of Object.values(ctx.materials)) materialsCustom.push(m);
  await nextFrame();

  report(0.52, 'LIGHTING THE GOLDEN HOUR');
  buildSky(ctx);
  buildLights(ctx);
  buildEnvironment(ctx);
  await nextFrame();

  report(0.6, 'SCULPTING DUNES');
  buildGroundAndTerrain(ctx);
  await nextFrame();

  report(0.68, 'RAISING WALLS & GATES');
  buildArchitecture(ctx);
  await nextFrame();

  report(0.77, 'DRESSING THE OUTPOST');
  buildProps(ctx);
  buildSiteDressing(ctx);
  await nextFrame();

  report(0.85, 'HANGING CLOTH & STENCILS');
  buildCloths(ctx);
  buildDecalsAndPosters(ctx);
  buildLanterns(ctx);
  buildPracticalLights(ctx);
  buildDust(ctx);
  buildSmoke(ctx);
  await nextFrame();

  report(0.93, 'FLUSHING GEOMETRY');
  const batchMeshes = ctx.batcher.flush(scene, ctx.materials, ctx.collideMeshes);
  for (const m of batchMeshes) objects.push(m);
  // world objects are exactly what this builder added to the scene
  ctx.worldObjects = scene.children.filter((child) => !childrenBefore.has(child));
  // Rebuild the raycast target list: exactly one entry per solid visual mesh. Skip
  // batches flagged collide:false (dark recess planes, glass, glow, coals) and drop
  // the duplicate instanced entries the old two-pass rebuild produced.
  ctx.collideMeshes.length = 0;
  const seenCollide = new Set();
  for (const obj of ctx.worldObjects) {
    if (!obj || !obj.isObject3D || seenCollide.has(obj)) continue;
    const surface = obj.userData && obj.userData.surface;
    if (!surface && !obj.isInstancedMesh) continue;
    if (obj.userData && obj.userData.collide === false) continue;
    seenCollide.add(obj);
    ctx.collideMeshes.push(obj);
  }
  // make sure the ground counts for raycasts even without a surface on batch registration
  if (ctx.ground && !ctx.collideMeshes.includes(ctx.ground)) ctx.collideMeshes.push(ctx.ground);
  ctx.collideMeshes = ctx.collideMeshes.filter((o) => o && o.isObject3D);

  report(1, 'SECTOR SECURED');

  if (typeof window !== 'undefined') {
    window.__worldBuilt = ctx;
  }

  const world = {
    collideMeshes: ctx.collideMeshes,
    collisionBoxes: ctx.data.collisionBoxes,
    playerSpawn: ctx.data.playerSpawn,
    enemySpawns: ctx.data.enemySpawns,
    mapBounds: ctx.data.mapBounds,
    landmarks: ctx.data.landmarks,
    update(dt, time) {
      updateWorld(ctx, dt ?? 0.016, time ?? performance.now() / 1000);
    },
    dispose() {
      disposeWorld(ctx);
    },
    /** Optional live quality switch (shadows only; materials stay intact). */
    setQuality(nextQuality) {
      if (!QUALITY_SETTINGS[nextQuality]) return;
      ctx.quality = nextQuality;
      const settings = QUALITY_SETTINGS[nextQuality];
      if (ctx.sun) {
        if (ctx.sun.shadow.map) {
          ctx.sun.shadow.map.dispose();
          ctx.sun.shadow.map = null;
        }
        ctx.sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
        ctx.sun.shadow.needsUpdate = true;
      }
      const envIntensity = { lowest: 0.35, low: 0.4, medium: 0.45, high: 0.55, ultra: 0.55 };
      ctx.scene.environmentIntensity = envIntensity[nextQuality] ?? 0.55;
    },
    /** Debug info (dev tools). */
    debug: {
      get drawInfo() {
        return { sun: ctx.sun, lights: ctx.lights.length, cloths: ctx.cloths.length, batches: batchMeshes.length };
      },
    },
  };

  return world;
}

export {
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
};
