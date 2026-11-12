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

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
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
    aLongShade: { x: 31.3, z: -14.2 },
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

  const towers = [
    { x: -32.0, z: 32.0, w: 3.8, d: 3.8, h: 8.6, kind: 'corner' },
    { x: 32.0, z: 32.0, w: 3.8, d: 3.8, h: 8.6, kind: 'corner' },
    { x: -32.0, z: -32.0, w: 3.8, d: 3.8, h: 8.6, kind: 'corner' },
    { x: 32.0, z: -32.0, w: 3.8, d: 3.8, h: 8.6, kind: 'corner' },
    { x: 30.4, z: 29.0, w: 2.8, d: 2.8, h: 6.4, kind: 'watch' },
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
  const tunnelPiers = [
    { x: -27.0, z: -11.0, w: 1.0, d: 1.0, h: 3.6 },
    { x: -27.0, z: -14.2, w: 1.0, d: 1.0, h: 3.6 },
    { x: -27.0, z: -17.4, w: 1.0, d: 1.0, h: 3.6 },
  ];
  for (const p of tunnelPiers) solid(p.x, p.z, p.w, p.d, p.h, 'stone');

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
  solid(hero.well.x, hero.well.z, 4.35, 4.35, 2.35, 'stone');

  // ------------------------------------------------------------------ the truck
  solid(hero.truck.x, hero.truck.z, 7.5, 3.4, 2.7, 'metal');

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
  solid(hero.windmill.x, hero.windmill.z, 1.5, 1.5, 2.6, 'wood');
  solid(hero.radar.x, hero.radar.z, 2.4, 2.4, 3.0, 'metal');
  solid(hero.campfire.x, hero.campfire.z, 1.5, 1.5, 0.55, 'stone');
  for (const f of hero.flagpoles) solid(f.x, f.z, 0.34, 0.34, f.h, 'wood');
  // A-long shade posts
  for (const z of [-11.3, -14.3, -17.3]) solid(hero.aLongShade.x, z, 0.26, 0.26, 3.3, 'wood');
  // A site raised watch platform legs
  const ap = hero.aPlatform;
  for (const [ox, oz] of [[-ap.w / 2 + 0.2, -ap.d / 2 + 0.2], [ap.w / 2 - 0.2, -ap.d / 2 + 0.2], [-ap.w / 2 + 0.2, ap.d / 2 - 0.2], [ap.w / 2 - 0.2, ap.d / 2 - 0.2]]) {
    solid(ap.x + ox, ap.z + oz, 0.3, 0.3, ap.h, 'wood');
  }
  // carts
  solid(hero.cartPlaza.x, hero.cartPlaza.z, hero.cartPlaza.w, hero.cartPlaza.d, 1.1, 'wood');
  solid(hero.aLongCart.x, hero.aLongCart.z, hero.aLongCart.w, hero.aLongCart.d, 1.2, 'wood');
  // B-site wreck
  solid(hero.bWreck.x, hero.bWreck.z, 2.1, 1.5, 1.3, 'metal');

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
    [31.0, -9.9, 0.95, 0.1, 2], [30.3, -17.3, 0.95, 0.6, 3], [23.0, -18.4, 0.85, 0.3, 1],
    [30.0, -10.2, 0.85, 0.85, 1],
    // A site
    [12.8, -25.6, 0.95, 0.3, 2], [22.6, -27.8, 0.95, 0.5, 3], [15.2, -27.9, 0.9, 0.2, 1],
    [23.0, -22.2, 0.9, 0.7, 1], [27.0, -24.6, 0.9, 0.15, 2], [11.6, -28.4, 0.85, 0.4, 1],
    // B tunnel
    [-31.5, -11.6, 0.9, 0.2, 1], [-31.3, -15.1, 0.95, 0.6, 2], [-31.6, -18.0, 0.85, 0.1, 1],
    [-21.9, -10.8, 0.85, 0.8, 1],
    // B site
    [-13.0, -25.2, 0.95, 0.5, 2], [-23.4, -27.0, 0.95, 0.1, 3], [-17.0, -28.0, 0.9, 0.6, 1],
    [-27.6, -22.7, 0.9, 0.3, 1], [-28.6, -26.6, 0.9, 0.75, 2], [-12.6, -28.6, 0.85, 0.2, 1],
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
  solid(-1.2, 30.6, 0.75, 0.75, 0.5, 'wood'); // ammo boxes on the staging wall
  solid(0.9, 30.9, 0.75, 0.75, 0.5, 'wood');
  solid(2.4, 30.4, 0.75, 0.75, 0.5, 'wood');
  solid(-19.5, 30.8, 1.1, 0.7, 0.8, 'wood');
  solid(19.6, 30.6, 1.2, 0.7, 0.75, 'wood');
  solid(24.6, -25.8, 1.3, 1.3, 1.0, 'wood'); // A-site pallet stack
  solid(-24.6, -26.4, 1.3, 1.3, 1.0, 'wood');
  solid(-15.2, -24.8, 1.0, 1.0, 0.7, 'metal'); // B-site scrap pile
  solid(15.4, -24.6, 1.0, 1.0, 0.7, 'metal');

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
      stalls, hero, siteArches,
    },
  };
}

// #endregion WORLD_DATA

// ===========================================================================
// geometry helpers
// ===========================================================================

const _tmpMatrix = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();
const _tmpVec = new THREE.Vector3();
const _tmpScale = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);

/** Merge a list of (already transformed, non-indexed) BufferGeometries. */
function mergeGeometries(geos) {
  if (geos.length === 0) return null;
  let total = 0;
  let hasColor = false;
  for (const g of geos) {
    total += g.attributes.position.count;
    if (g.attributes.color) hasColor = true;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const col = hasColor ? new Float32Array(total * 3) : null;
  let off = 0;
  for (const g of geos) {
    const count = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    if (g.attributes.uv) uvs.set(g.attributes.uv.array, off * 2);
    if (col) {
      if (g.attributes.color) col.set(g.attributes.color.array, off * 3);
      else col.fill(1, off * 3, (off + count) * 3);
    }
    off += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Box geometry whose UVs are scaled to world metres (tile = metres per texture tile). */
function boxGeometryWorldUV(w, h, d, tile = 1, uvScale = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = dims[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, (uv.getX(i) * fu) / tile * uvScale, (uv.getY(i) * fv) / tile * uvScale);
    }
  }
  return g;
}

/** Plane geometry with custom UV rect (for atlas decals) + optional world-scale UVs. */
function planeGeometry(w, h, { u0 = 0, v0 = 0, u1 = 1, v1 = 1, worldScale = 0 } = {}) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    minU = Math.min(minU, uv.getX(i));
    maxU = Math.max(maxU, uv.getX(i));
    minV = Math.min(minV, uv.getY(i));
    maxV = Math.max(maxV, uv.getY(i));
  }
  for (let i = 0; i < uv.count; i++) {
    const tu = (uv.getX(i) - minU) / (maxU - minU);
    const tv = (uv.getY(i) - minV) / (maxV - minV);
    if (worldScale > 0) {
      uv.setXY(i, (tu * w) / worldScale, (tv * h) / worldScale);
    } else {
      uv.setXY(i, u0 + tu * (u1 - u0), v0 + tv * (v1 - v0));
    }
  }
  return g;
}

/** Extruded arch: rectangular outer silhouette with an arched opening. */
function archGeometry(span, height, depth, pierW = 0.4, crown = 0.35, segments = 18) {
  const radius = Math.max(0.2, span / 2 - pierW);
  const springY = Math.max(0.6, height - radius);
  const outline = new THREE.Shape();
  const totalH = height + crown;
  outline.moveTo(-span / 2, 0);
  outline.lineTo(span / 2, 0);
  outline.lineTo(span / 2, totalH);
  outline.lineTo(-span / 2, totalH);
  outline.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-radius, 0);
  hole.lineTo(-radius, springY);
  hole.absarc(0, springY, radius, Math.PI, 0, true);
  hole.lineTo(radius, 0);
  hole.closePath();
  outline.holes.push(hole);

  const g = new THREE.ExtrudeGeometry(outline, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 1,
    curveSegments: segments,
    steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Cylinder with UVs scaled to world metres. */
function cylinderWorldUV(rTop, rBottom, h, radial = 12, tile = 1, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, radial, 1, open);
  const uv = g.attributes.uv;
  const circ = Math.PI * (rTop + rBottom);
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * h) / tile);
  }
  return g;
}

/** Clone + transform helper used by the static batcher. */
function transformed(geo, matrix) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(matrix);
  return g;
}

function matrixFor(x, y, z, rotX = 0, rotY = 0, rotZ = 0, sx = 1, sy = 1, sz = 1) {
  _tmpVec.set(x, y, z);
  _tmpQuat.setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ'));
  _tmpScale.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_tmpVec, _tmpQuat, _tmpScale);
}

/**
 * Bake cheap per-vertex AO / grime into a geometry as a color attribute.
 * Bright at the top, dirt-dark near the ground, subtle per-vertex noise.
 */
function bakeVertexAO(geo, { ground = 1.5, floor = 0.55, noise = 0.06, seed = 1 } = {}) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = nor ? nor.getY(i) : 0;
    let ao = lerp(floor, 1, smoothstep(0, ground, y));
    if (ny < -0.25) ao *= 0.82; // undersides
    if (ny > 0.6) ao = Math.min(1, ao + 0.06); // tops catch sun
    const n = (Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 3.1) * 43758.5453) % 1;
    ao *= 1 - noise * Math.abs(n);
    colors[i * 3] = ao;
    colors[i * 3 + 1] = ao * (0.99 + noise * 0.15);
    colors[i * 3 + 2] = ao * 0.96;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

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
  medium: { shadowMap: 2048, dust: 420, motes: 500, anisotropy: 4 },
  high: { shadowMap: 4096, dust: 700, motes: 800, anisotropy: 8 },
  ultra: { shadowMap: 4096, dust: 950, motes: 1100, anisotropy: 16 },
};

/** Build a MeshStandardMaterial from one of the procedural texture sets. */
function stdMaterial(set, opts = {}) {
  // Accept either a texture set { map, normalMap, ormMap } or a raw THREE.Texture.
  const raw = !!(set && set.isTexture);
  const metalPacked = !raw && !!set.ormMap;
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    map: raw ? set : set.map ?? null,
    normalMap: raw ? null : set.normalMap ?? null,
    roughnessMap: opts.roughnessMap ?? (raw ? null : set.roughnessMap ?? set.ormMap ?? null),
    metalnessMap: metalPacked ? set.ormMap : null,
    roughness: metalPacked ? 1 : opts.roughness ?? 1,
    metalness: metalPacked ? 1 : opts.metalness ?? 0.02,
    envMapIntensity: opts.envMapIntensity ?? 0.7,
    vertexColors: !!opts.vertexColors,
    side: opts.side ?? THREE.FrontSide,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    alphaTest: opts.alphaTest ?? 0,
    depthWrite: opts.depthWrite ?? true,
    emissive: new THREE.Color(opts.emissive ?? 0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  if (opts.normalScale !== undefined) mat.normalScale.set(opts.normalScale, opts.normalScale);
  if (opts.polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = opts.polygonOffset[0];
    mat.polygonOffsetUnits = opts.polygonOffset[1];
  }
  mat.name = opts.name ?? 'mat';
  return mat;
}

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

const FONT_DISPLAY = '"Bahnschrift Condensed", "DIN Alternate", "Arial Narrow", "Segoe UI", sans-serif';
const FONT_CJK = '"Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif';
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

/** Add an axis-aligned (optionally yaw-rotated) box to a material batch. */
function boxBatch(ctx, key, x, y, z, w, h, d, { tile = 2.4, ry = 0, uvOffset = null } = {}) {
  const g = boxGeometryWorldUV(w, h, d, tile);
  ctx.batcher.add(key, g, matrixFor(x, y, z, 0, ry, 0), { uvOffset });
  g.dispose();
}

/** Add a box resting on the floor (y = 0 … h). */
function baseBox(ctx, key, x, z, w, h, d, opts = {}) {
  boxBatch(ctx, key, x, h / 2 + (opts.y0 ?? 0), z, w, h, d, opts);
}

function cylinderBatch(ctx, key, x, y, z, rTop, rBottom, h, radial = 10, rot = null) {
  const g = cylinderWorldUV(rTop, rBottom, h, radial, 1.8);
  ctx.batcher.add(key, g, rot ?? matrixFor(x, y, z));
  g.dispose();
}

// ---------------------------------------------------------------- signage helper

function drawSignPlate(canvas, text, sub, opts = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const rng = makeRNG(opts.seed ?? 51);
  const bg = opts.bg ?? '#42392a';
  const fg = opts.fg ?? '#eadcb8';
  const accent = opts.accent ?? '#b8502f';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // painted metal / board texture
  for (let i = 0; i < 40; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const r = 6 + rng() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng() > 0.5 ? 'rgba(255,240,205,0.07)' : 'rgba(0,0,0,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 22; i++) {
    ctx.strokeStyle = `rgba(226,214,186,${0.04 + rng() * 0.09})`;
    ctx.lineWidth = 0.7 + rng() * 1.6;
    ctx.beginPath();
    const x = rng() * W;
    const y = rng() * H;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 80, y + (rng() - 0.5) * 26);
    ctx.stroke();
  }
  // border
  ctx.strokeStyle = fg;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, W - 24, H - 24);
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  ctx.fillRect(12, 12, W - 24, 8);
  // text
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const big = opts.big ?? 76;
  ctx.font = `900 ${big}px ${FONT_DISPLAY}`;
  ctx.fillText(text, W / 2, H * 0.44, W - 70);
  if (sub) {
    ctx.fillStyle = opts.subColor ?? accent;
    ctx.font = `900 ${opts.subSize ?? 44}px ${FONT_CJK}`;
    ctx.fillText(sub, W / 2, H * 0.72, W - 70);
  }
  // rivets
  for (const [x, y] of [[24, 24], [W - 24, 24], [24, H - 24], [W - 24, H - 24]]) {
    ctx.fillStyle = 'rgba(20,18,14,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(236,228,206,0.5)';
    ctx.beginPath();
    ctx.arc(x - 1, y - 1, 2, 0, TAU);
    ctx.fill();
  }
  // weathering punch
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 190; i++) {
    ctx.globalAlpha = 0.1 + rng() * 0.35;
    ctx.beginPath();
    ctx.arc(rng() * W, rng() * H, 0.5 + rng() * 2.4, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function makeSign(ctx, { text, sub = '', x, y, z, ry = 0, w = 2.4, h = 1.2, bg, fg, accent, big, subSize, seed = 51, tilt = 0 }) {
  const tex = canvasTexture(512, 256, (c) => drawSignPlate(c, text, sub, { bg, fg, accent, big, subSize, seed }), {
    srgb: true,
    anisotropy: ctx.tex.anisotropy,
    repeat: [1, 1],
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  ctx.textures.push(tex);
  const mat = stdMaterial({ map: tex }, { name: `sign:${text}`, roughness: 0.82, metalness: 0.12, envMapIntensity: 0.9 });
  const geo = planeGeometry(w, h);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(tilt, ry, 0);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.surface = 'metal';
  mesh.name = `sign:${text}`;
  ctx.scene.add(mesh);
  ctx.materialsCustom.push(mat);
  ctx.disposables.push(geo);
  return mesh;
}

// --------------------------------------------------------------- window / door

function faceRotation(nx, nz) {
  return Math.atan2(nx, nz);
}

/** Window inset into a wall face. (cx,cy,cz) is the anchor on the wall face. */
function addWindow(ctx, { x, y, z, nx, nz, w = 0.95, h = 1.25, shutters = true, sill = true }) {
  const ry = faceRotation(nx, nz);
  const base = matrixFor(x, y, z, 0, ry, 0);
  const part = (lx, ly, lz, bw, bh, bd, key, tile = 1.6) => {
    const g = boxGeometryWorldUV(bw, bh, bd, tile);
    const m = new THREE.Matrix4().makeTranslation(lx, ly, lz);
    m.premultiply(base);
    ctx.batcher.add(key, g, m);
    g.dispose();
  };
  part(0, 0, -0.09, w, h, 0.22, 'dark', 1);
  part(0, 0, 0.015, w - 0.1, h - 0.1, 0.02, 'glass', 1);
  // frame
  part(0, h / 2 + 0.07, 0.06, w + 0.28, 0.14, 0.2, 'woodDark');
  part(0, -h / 2 - 0.07, 0.06, w + 0.28, 0.14, 0.2, 'woodDark');
  part(-(w / 2 + 0.07), 0, 0.06, 0.14, h + 0.28, 0.2, 'woodDark');
  part(w / 2 + 0.07, 0, 0.06, 0.14, h + 0.28, 0.2, 'woodDark');
  part(0, 0, 0.05, 0.07, h, 0.06, 'woodDark');
  if (sill) part(0, -h / 2 - 0.18, 0.17, w + 0.42, 0.12, 0.4, 'stone', 2.0);
  // lintel
  part(0, h / 2 + 0.2, 0.14, w + 0.5, 0.16, 0.28, 'stone', 2.0);
  if (shutters) {
    const sw = w * 0.52;
    for (const side of [-1, 1]) {
      const g = boxGeometryWorldUV(sw, h * 0.96, 0.07, 1.4);
      const m = new THREE.Matrix4().makeTranslation(side * (w / 2 + 0.24), 0, 0.14);
      m.premultiply(base);
      ctx.batcher.add('wood', g, m);
      g.dispose();
      // shutter slats
      for (let i = 0; i < 3; i++) {
        const sg = boxGeometryWorldUV(sw * 0.86, 0.05, 0.02, 0.8);
        const sm = new THREE.Matrix4().makeTranslation(side * (w / 2 + 0.24), (i - 1) * h * 0.3, 0.19);
        sm.premultiply(base);
        ctx.batcher.add('woodDark', sg, sm);
        sg.dispose();
      }
    }
  }
}

/** Simple doorway with wooden door, stone frame and threshold. */
function addDoor(ctx, { x, y, z, nx, nz, w = 1.15, h = 2.3, key = 'wood', chip = true }) {
  const ry = faceRotation(nx, nz);
  const base = matrixFor(x, y, z, 0, ry, 0);
  const part = (lx, ly, lz, bw, bh, bd, bkey, tile = 1.8) => {
    const g = boxGeometryWorldUV(bw, bh, bd, tile);
    const m = new THREE.Matrix4().makeTranslation(lx, ly, lz);
    m.premultiply(base);
    ctx.batcher.add(bkey, g, m);
    g.dispose();
  };
  part(0, 0, -0.06, w, h, 0.16, 'dark', 1);
  part(0, 0, 0.02, w - 0.1, h - 0.08, 0.09, key);
  // planks detail + iron bands
  for (const yy of [-h * 0.28, h * 0.28]) part(0, yy, 0.09, w - 0.14, 0.09, 0.04, 'rust', 1.2);
  part(-(w / 2 + 0.1), 0, 0.05, 0.16, h + 0.24, 0.24, 'stone', 1.8);
  part(w / 2 + 0.1, 0, 0.05, 0.16, h + 0.24, 0.24, 'stone', 1.8);
  part(0, h / 2 + 0.13, 0.06, w + 0.4, 0.2, 0.26, 'stone', 1.8);
  part(0, -h / 2 + 0.03, 0.2, w + 0.36, 0.08, 0.42, 'stone', 1.8);
  // handle
  part(w * 0.3, 0, 0.12, 0.06, 0.24, 0.06, 'rust', 0.6);
}

// ---------------------------------------------------------------- boundary walls

const crenelRng = makeRNG(31337);

function addCrenellationsAlongX(ctx, x0, x1, z, topY, step = 2.4) {
  let i = 0;
  for (let x = x0; x <= x1; x += step) {
    const h = 0.5 + (i % 3) * 0.08;
    boxBatch(ctx, 'adobe', x, topY + h / 2, z, step * 0.62, h, 0.7, { tile: 2.0 });
    i++;
  }
}
function addCrenellationsAlongZ(ctx, z0, z1, x, topY, step = 2.4) {
  let i = 0;
  for (let z = z0; z <= z1; z += step) {
    const h = 0.5 + (i % 3) * 0.08;
    boxBatch(ctx, 'adobe', x, topY + h / 2, z, 0.7, h, step * 0.62, { tile: 2.0 });
    i++;
  }
}

function buildBoundary(ctx) {
  const L = ctx.data.layout;
  // main wall volumes + plinth + cornice
  for (const b of L.boundary) {
    boxBatch(ctx, 'adobe', b.x, b.h / 2, b.z, b.w, b.h, b.d, { tile: 2.6 });
    const horizontal = b.w > b.d;
    const baseW = horizontal ? b.w : b.d + 0.34;
    const baseD = horizontal ? b.d + 0.34 : b.w;
    if (horizontal) {
      boxBatch(ctx, 'stone', b.x, 0.6, b.z, b.w + 0.06, 1.2, b.d + 0.3, { tile: 2.1 });
      boxBatch(ctx, 'stone', b.x, b.h - 0.16, b.z, b.w + 0.06, 0.32, b.d + 0.32, { tile: 2.1 });
    } else {
      boxBatch(ctx, 'stone', b.x, 0.6, b.z, b.w + 0.3, 1.2, b.d + 0.06, { tile: 2.1 });
      boxBatch(ctx, 'stone', b.x, b.h - 0.16, b.z, b.w + 0.32, 0.32, b.d + 0.06, { tile: 2.1 });
    }
    void baseW;
    void baseD;
  }

  // crenellations on the four walls
  addCrenellationsAlongX(ctx, -32.4, 32.4, 33.22, 6.9);
  addCrenellationsAlongX(ctx, -32.4, 32.4, -33.22, 6.9);
  addCrenellationsAlongZ(ctx, -32.4, 32.4, 33.22, 6.9);
  addCrenellationsAlongZ(ctx, -32.4, 32.4, -33.22, 6.9);

  // pilasters + arrow slits on the inside faces
  for (let x = -28; x <= 28; x += 8) {
    boxBatch(ctx, 'adobeLight', x, 2.7, 32.88, 1.25, 5.1, 0.36, { tile: 2.2 });
    boxBatch(ctx, 'adobeLight', x, 2.7, -32.88, 1.25, 5.1, 0.36, { tile: 2.2 });
  }
  for (let z = -28; z <= 28; z += 8) {
    boxBatch(ctx, 'adobeLight', 32.88, 2.7, z, 0.36, 5.1, 1.25, { tile: 2.2 });
    boxBatch(ctx, 'adobeLight', -32.88, 2.7, z, 0.36, 5.1, 1.25, { tile: 2.2 });
  }
  for (let x = -24; x <= 24; x += 12) {
    boxBatch(ctx, 'dark', x, 3.9, 32.94, 0.26, 1.05, 0.1, { tile: 1 });
    boxBatch(ctx, 'dark', x + 3, 3.9, -32.94, 0.26, 1.05, 0.1, { tile: 1 });
  }
  for (let z = -24; z <= 24; z += 12) {
    boxBatch(ctx, 'dark', 32.94, 3.9, z, 0.1, 1.05, 0.26, { tile: 1 });
    boxBatch(ctx, 'dark', -32.94, 3.9, z, 0.1, 1.05, 0.26, { tile: 1 });
  }

  // corner towers
  for (const t of L.towers) {
    if (t.kind !== 'corner') continue;
    baseBox(ctx, 'adobe', t.x, t.z, t.w, t.h, t.d, { tile: 2.4 });
    baseBox(ctx, 'stone', t.x, t.z, t.w + 0.3, 1.3, t.d + 0.3, { tile: 2.0 });
    // tower crown
    boxBatch(ctx, 'adobe', t.x, t.h + 0.35, t.z, t.w + 0.4, 0.7, t.d + 0.4, { tile: 2.2 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      boxBatch(ctx, 'adobe', t.x + Math.cos(a) * (t.w * 0.62), t.h + 0.95, t.z + Math.sin(a) * (t.d * 0.62), 0.9, 0.6, 0.9, { tile: 1.8 });
    }
    // arrow slit windows, one per face
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      boxBatch(ctx, 'dark', t.x + Math.cos(a) * (t.w / 2 + 0.01), 5.4, t.z + Math.sin(a) * (t.d / 2 + 0.01), Math.abs(Math.cos(a)) > 0.5 ? 0.1 : 0.5, 1.2, Math.abs(Math.sin(a)) > 0.5 ? 0.1 : 0.5, { tile: 1 });
    }
    // lanterns on inward corners
    const inX = Math.sign(-t.x);
    const inZ = Math.sign(-t.z);
    ctx.req.lanterns.push({ x: t.x + inX * 1.1, y: 6.4, z: t.z + inZ * 1.1, kind: 'warm', size: 0.28 });
    // banner on the inward face
    ctx.req.banners.push({
      key: 'title', x: t.x + inX * (t.w / 2 + 0.06), y: 4.6, z: t.z + inZ * (t.d / 2 + 0.06),
      ry: faceRotation(inX, inZ), w: 2.0, h: 3.6, sway: 0.03, anchor: 'top',
    });
  }

  // south-east wooden watchtower on its adobe base
  const wt = L.hero.watchtower;
  baseBox(ctx, 'adobe', wt.x, wt.z, wt.w, wt.h, wt.d, { tile: 2.4 });
  baseBox(ctx, 'stone', wt.x, wt.z, wt.w + 0.25, 0.9, wt.d + 0.25, { tile: 1.9 });
  boxBatch(ctx, 'wood', wt.x, wt.h + 0.14, wt.z, 3.5, 0.28, 3.5, { tile: 1.6 });
  // railings
  for (const [ox, oz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    boxBatch(ctx, 'wood', wt.x + ox, wt.h + 0.85, wt.z + oz, 0.16, 1.4, 0.16, { tile: 1.2 });
  }
  for (const s of [-1, 1]) {
    boxBatch(ctx, 'wood', wt.x + s * 1.6, wt.h + 1.45, wt.z, 0.14, 0.1, 3.3, { tile: 1.4 });
    boxBatch(ctx, 'wood', wt.x, wt.h + 1.45, wt.z + s * 1.6, 3.3, 0.1, 0.14, { tile: 1.4 });
    boxBatch(ctx, 'wood', wt.x + s * 1.6, wt.h + 1.0, wt.z, 0.1, 0.9, 3.1, { tile: 1.4 });
  }
  // canopy roof
  ctx.req.awnings.push({
    type: 'canopy', x: wt.x, y: wt.h + 2.55, z: wt.z, w: 4.0, d: 4.0,
    key: 'awning', pitch: 0.1, ry: 0, postH: wt.h + 0.3, posts: [[-1.75, -1.75], [1.75, -1.75], [-1.75, 1.75], [1.75, 1.75]],
  });
  // ladder rungs up the base (south side)
  for (let i = 0; i < 8; i++) {
    boxBatch(ctx, 'wood', wt.x - 0.9, 0.6 + i * 0.72, wt.z + wt.d / 2 + 0.12, 0.9, 0.09, 0.12, { tile: 1 });
  }
  boxBatch(ctx, 'wood', wt.x - 1.34, 3.4, wt.z + wt.d / 2 + 0.12, 0.1, 5.6, 0.12, { tile: 1.2 });
  boxBatch(ctx, 'wood', wt.x - 0.46, 3.4, wt.z + wt.d / 2 + 0.12, 0.1, 5.6, 0.12, { tile: 1.2 });

  // stencilled number plates on staging walls
  makeSign(ctx, { text: 'OUTPOST 07', sub: '前 哨 基 地', x: 0, y: 4.9, z: 32.94, ry: Math.PI, w: 3.4, h: 1.5, seed: 71 });
  makeSign(ctx, { text: 'STAGING', sub: '集 结 区', x: -9.6, y: 3.0, z: 32.93, ry: Math.PI, w: 2.4, h: 1.1, seed: 72 });
  makeSign(ctx, { text: 'SECTOR 7', sub: '第 七 区', x: 9.6, y: 3.0, z: 32.93, ry: Math.PI, w: 2.4, h: 1.1, seed: 73 });
}

// ---------------------------------------------------------------- mid wall/gate

function buildMidWall(ctx) {
  const L = ctx.data.layout;
  for (const w of L.walls) {
    boxBatch(ctx, 'adobe', w.x, w.h / 2, w.z, w.w, w.h, w.d, { tile: 2.5 });
    boxBatch(ctx, 'stone', w.x, 0.5, w.z, w.w, 1.0, w.d + 0.26, { tile: 2.0 });
    boxBatch(ctx, 'stone', w.x, w.h - 0.16, w.z, w.w, 0.32, w.d + 0.3, { tile: 2.0 });
    // parapet crenellation along the courtyard-facing side
    addCrenellationsAlongX(ctx, w.x - w.w / 2 + 0.4, w.x + w.w / 2 - 0.4, w.z - 0.25, w.h + 0.38, 2.3);
    // pilasters on both faces
    for (let x = w.x - w.w / 2 + 2.2; x < w.x + w.w / 2 - 1.2; x += 4.4) {
      boxBatch(ctx, 'adobeLight', x, w.h / 2, w.z + w.d / 2 + 0.14, 0.9, w.h - 0.4, 0.3, { tile: 2.1 });
      boxBatch(ctx, 'adobeLight', x, w.h / 2, w.z - w.d / 2 - 0.14, 0.9, w.h - 0.4, 0.3, { tile: 2.1 });
    }
  }
  // gate piers
  for (const p of ctx.data.layout.gatePiers) {
    baseBox(ctx, 'stone', p.x, p.z, p.w, p.h, p.d, { tile: 1.8 });
    boxBatch(ctx, 'stone', p.x, 0.4, p.z, p.w + 0.16, 0.8, p.d + 0.16, { tile: 1.8 });
    boxBatch(ctx, 'stone', p.x, p.h - 0.2, p.z, p.w + 0.14, 0.4, p.d + 0.14, { tile: 1.8 });
  }

  // gatehouse body above the doorway
  boxBatch(ctx, 'adobe', 0, 5.75, -8.5, 9.4, 3.1, 2.0, { tile: 2.3 });
  boxBatch(ctx, 'stone', 0, 7.45, -8.5, 9.7, 0.3, 2.3, { tile: 2.0 });
  addCrenellationsAlongX(ctx, -4.3, 4.3, -8.7, 7.62, 1.9);
  // machicolation corbels
  for (let x = -4.2; x <= 4.2; x += 0.82) {
    boxBatch(ctx, 'stone', x, 4.05, -7.55, 0.3, 0.5, 0.5, { tile: 1.2 });
  }
  boxBatch(ctx, 'adobe', 0, 4.45, -7.6, 9.4, 0.42, 0.7, { tile: 2.0 });
  // merlon caps along gatehouse
  for (const s of [-1, 1]) {
    boxBatch(ctx, 'adobe', s * 2.6, 8.0, -8.5, 1.2, 0.7, 2.1, { tile: 1.8 });
  }
  // flagpole on the gatehouse
  cylinderBatch(ctx, 'wood', 3.4, 9.4, -8.5, 0.07, 0.1, 3.8, 6);
  ctx.req.flags.push({ x: 3.4, y: 11.2, z: -8.5, w: 1.8, h: 1.15, ry: Math.PI / 2, key: 'warn', phase: 1.7 });

  // doors: both leaves thrown open, flush against the inner wall
  for (const s of [-1, 1]) {
    const doorX = s * 0.95;
    boxBatch(ctx, 'wood', doorX, 1.5, -7.68, 1.86, 3.0, 0.14, { tile: 1.7 });
    // planks / studs
    for (let i = 0; i < 3; i++) {
      boxBatch(ctx, 'rust', doorX, 0.55 + i * 1.05, -7.59, 1.8, 0.1, 0.04, { tile: 1.2 });
    }
    boxBatch(ctx, 'rust', doorX + s * 1.0, 1.5, -7.7, 0.16, 0.16, 0.2, { tile: 0.8 });
  }
  // gate sign + title banner
  makeSign(ctx, { text: 'MID GATE', sub: '中 门', x: 0, y: 5.95, z: -7.46, ry: 0, w: 3.0, h: 1.25, seed: 91, tilt: 0 });
  ctx.req.banners.push({ key: 'title', x: 0, y: 4.1, z: -7.44, ry: Math.PI, w: 5.2, h: 2.45, sway: 0.025 });
  // lanterns flanking the gate
  for (const s of [-1, 1]) {
    ctx.req.lanterns.push({ x: s * 2.05, y: 3.35, z: -7.55, kind: 'warm', size: 0.3 });
    ctx.req.lights.push({ x: s * 2.05, y: 3.2, z: -7.2, color: 0xffa050, intensity: 9, distance: 9, kind: 'flicker' });
  }
  // inner-wall posters
  for (const x of [-7.2, 7.0]) {
    ctx.req.posters.push({ x, y: 2.3, z: -7.72, ry: 0, cell: 'sector', w: 1.0, h: 1.85 });
  }

  // portal arches + sign boards
  for (const a of ctx.data.layout.arches) {
    if (a.kind === 'shopPass') continue;
    addArchMesh(ctx, a);
  }
  makeSign(ctx, { text: 'A LONG', sub: '长 道', x: 24.0, y: 5.15, z: -7.55, ry: 0, w: 2.6, h: 1.15, seed: 92, accent: '#8f3b2a' });
  makeSign(ctx, { text: 'B TUNNEL', sub: '隧 道', x: -24.0, y: 5.15, z: -7.55, ry: 0, w: 2.9, h: 1.2, seed: 93, accent: '#2f6470' });

  // gate approach: worn threshold stones + painted lane arrows
  boxBatch(ctx, 'stone', 0, 0.045, -8.5, 4.4, 0.09, 2.4, { tile: 1.6 });
  for (const [x, cell] of [[-3.6, 'chevrons'], [3.6, 'chevrons']]) {
    ctx.req.decals.push({ x, y: 0.035, z: -6.4, rx: -Math.PI / 2, ry: 0, cell, w: 2.2, h: 2.2, opacity: 0.85 });
  }
}

function addArchMesh(ctx, a) {
  const g = archGeometry(a.span, a.height, a.depth, a.pierW ?? 0.3);
  ctx.batcher.add(a.style === 'adobe' ? 'adobe' : 'stone', g, matrixFor(a.x, a.y ?? 0, a.z, 0, a.rot ?? 0));
  g.dispose();
  // cap stones on the arch crown
  const topY = (a.y ?? 0) + a.height + 0.36;
  if (a.style !== 'adobe') {
    boxBatch(ctx, 'stone', a.x, topY + 0.12, a.z, a.span * 0.36, 0.24, a.depth + 0.2, { tile: 1.8, ry: a.rot ?? 0 });
  }
}

// --------------------------------------------------------------- south bazaars

function buildBazaarRows(ctx) {
  const L = ctx.data.layout;
  for (const b of L.buildings) {
    baseBox(ctx, 'adobe', b.x, b.z, b.w, b.h, b.d, { tile: 2.5 });
    baseBox(ctx, 'stone', b.x, b.z, b.w + 0.22, 0.85, b.d + 0.22, { tile: 2.0 });
    boxBatch(ctx, 'stone', b.x, b.h + 0.06, b.z, b.w + 0.16, 0.26, b.d + 0.16, { tile: 2.0 });
    // roof parapet
    for (const s of [-1, 1]) {
      boxBatch(ctx, 'adobe', b.x + s * (b.w / 2 - 0.16), b.h + 0.5, b.z, 0.3, 0.62, b.d + 0.1, { tile: 1.8 });
      boxBatch(ctx, 'adobe', b.x, b.h + 0.5, b.z + s * (b.d / 2 - 0.16), b.w + 0.1, 0.62, 0.3, { tile: 1.8 });
    }
    // corner quoins
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        boxBatch(ctx, 'stone', b.x + sx * (b.w / 2 - 0.1), b.h / 2, b.z + sz * (b.d / 2 - 0.1), 1.0, b.h - 0.6, 1.0, { tile: 2.2 });
      }
    }
    const plazaSign = b.x > 0 ? -1 : 1; // plaza face normal x
    const faceX = b.x + plazaSign * (b.w / 2 + 0.01);
    // windows on the plaza face
    const count = b.rows + 1;
    for (let i = 0; i < count; i++) {
      const z = b.z - b.d / 2 + (b.d / (count + 1)) * (i + 1);
      addWindow(ctx, { x: faceX, y: 3.0, z, nx: plazaSign, nz: 0, w: 0.9, h: 1.25, shutters: i % 2 === 0 });
    }
    // ground floor shop front on the plaza face
    addDoor(ctx, { x: faceX, y: 1.15, z: b.z, nx: plazaSign, nz: 0, w: 1.2, h: 2.25 });
    ctx.req.awnings.push({
      type: 'awning', x: faceX - plazaSign * 0.9, y: 2.85, z: b.z, ry: plazaSign > 0 ? -Math.PI / 2 : Math.PI / 2,
      w: 4.0, d: 1.7, key: 'awning', pitch: 0.32,
    });
    makeSign(ctx, {
      text: b.x > 0 ? 'BAZAAR' : 'SUPPLY', sub: b.x > 0 ? '东 市' : '军 需',
      x: faceX - plazaSign * 0.02, y: 3.75, z: b.z, ry: plazaSign > 0 ? -Math.PI / 2 : Math.PI / 2,
      w: 2.0, h: 0.9, seed: 120 + Math.round(b.x),
    });
    // street face details
    const streetSign = b.x > 0 ? 1 : -1;
    const streetX = b.x + streetSign * (b.w / 2 + 0.01);
    for (let i = 0; i < 2; i++) {
      addWindow(ctx, { x: streetX, y: 3.2, z: b.z - b.d / 2 + 1.6 + i * 2.6, nx: streetSign, nz: 0, w: 0.7, h: 1.0, shutters: false });
    }
    ctx.req.posters.push({ x: streetX + streetSign * 0.03, y: 1.9, z: b.z - 1.4, ry: streetSign > 0 ? Math.PI / 2 : -Math.PI / 2, cell: 'ammo', w: 0.95, h: 1.7 });
    // roof clutter: water tank + vent
    if (b.h > 4.6) {
      cylinderBatch(ctx, 'rust', b.x + streetSign * 1.2, b.h + 1.1, b.z + 1.6, 0.55, 0.55, 1.3, 9);
      for (const s of [-1, 1]) {
        boxBatch(ctx, 'wood', b.x + streetSign * 1.2 + s * 0.45, b.h + 0.3, b.z + 1.6, 0.12, 0.55, 0.12, { tile: 1 });
      }
      boxBatch(ctx, 'metalDark', b.x - streetSign * 1.5, b.h + 0.45, b.z - 1.2, 0.9, 0.5, 0.6, { tile: 1.2 });
    }
    // shop awning posts + a couple of hanging rugs on the street face
    ctx.req.posters.push({ x: streetX + streetSign * 0.03, y: 2.8, z: b.z + 1.9, ry: streetSign > 0 ? Math.PI / 2 : -Math.PI / 2, cell: 'travel', w: 0.9, h: 1.6 });
  }
  // archways through the bazaar rows
  for (const a of L.arches) {
    if (a.kind === 'shopPass') addArchMesh(ctx, a);
  }
}

// ---------------------------------------------------------------- warehouses

function buildWarehouseBlocks(ctx) {
  const L = ctx.data.layout;
  for (const b of L.blocks) {
    baseBox(ctx, 'adobe', b.x, b.z, b.w, b.h, b.d, { tile: 2.6 });
    baseBox(ctx, 'stone', b.x, b.z, b.w + 0.24, 0.9, b.d + 0.24, { tile: 2.05 });
    boxBatch(ctx, 'stone', b.x, b.h + 0.04, b.z, b.w + 0.12, 0.24, b.d + 0.12, { tile: 2.0 });
    // corrugated roof sheet with a slight lean
    boxBatch(ctx, 'sheet', b.x, b.h + 0.36, b.z, b.w + 0.7, 0.1, b.d + 0.7, { tile: 1.7, ry: 0, });
    for (let i = 0; i < 4; i++) {
      boxBatch(ctx, 'wood', b.x - b.w / 2 + 0.4 + i * (b.w / 3), b.h + 0.22, b.z, 0.14, 0.4, b.d + 0.9, { tile: 1.4 });
    }
    // roof parapet on the courtyard side
    boxBatch(ctx, 'adobe', b.x, b.h + 0.64, b.z + (b.z > -15 ? 0 : 0), b.w + 0.12, 0.55, 0.28, { tile: 1.8 });
    const courtyardFace = b.x > 0 ? -1 : 1;
    const laneFace = -courtyardFace;
    const cfX = b.x + courtyardFace * (b.w / 2 + 0.01);
    const lfX = b.x + laneFace * (b.w / 2 + 0.01);
    // courtyard side: high windows + poster + drainpipe
    for (let i = 0; i < 2; i++) {
      addWindow(ctx, { x: cfX, y: 3.3, z: b.z - 1.5 + i * 3.0, nx: courtyardFace, nz: 0, w: 0.75, h: 1.1, shutters: false });
    }
    ctx.req.posters.push({ x: cfX + courtyardFace * 0.02, y: 1.7, z: b.z + 1.2, ry: courtyardFace > 0 ? Math.PI / 2 : -Math.PI / 2, cell: 'hostile', w: 1.0, h: 1.8 });
    cylinderBatch(ctx, 'rust', cfX + courtyardFace * 0.22, 2.2, b.z - b.d / 2 + 0.8, 0.13, 0.13, 4.2, 7);
    // lane side: big loading door + signage + windows
    if (b.d > 3) {
      const doubleW = 3.0;
      boxBatch(ctx, 'rust', lfX + laneFace * 0.02, 1.75, b.z, 0.16, 3.3, doubleW + 0.3, { tile: 1.6 });
      for (const s of [-1, 1]) {
        boxBatch(ctx, 'metal', lfX + laneFace * 0.1, 1.5, b.z + s * (doubleW / 4), 0.12, 2.9, doubleW / 2 - 0.08, { tile: 1.5 });
      }
      boxBatch(ctx, 'dark', lfX + laneFace * 0.06, 1.6, b.z, 0.08, 3.0, doubleW - 0.2, { tile: 1 });
      makeSign(ctx, {
        text: b.lane, sub: b.lane === 'A LONG' ? '长 道 / A' : '隧 道 / B',
        x: lfX + laneFace * 0.15, y: 4.05, z: b.z, ry: laneFace > 0 ? Math.PI / 2 : -Math.PI / 2,
        w: 3.0, h: 1.25, seed: b.x > 0 ? 141 : 142, accent: b.lane === 'A LONG' ? '#8f3b2a' : '#2f6470',
      });
    }
    for (let i = 0; i < 2; i++) {
      addWindow(ctx, { x: lfX, y: 4.4, z: b.z - 1.4 + i * 2.8, nx: laneFace, nz: 0, w: 0.6, h: 0.8, shutters: false });
    }
    // lintel over the doorway gap between block segment pairs
    if (b.door) {
      const d = b.door;
      boxBatch(ctx, 'stone', b.x, d.h + 0.28, d.z, b.w + 0.3, 0.5, d.w + 0.5, { tile: 1.9 });
      boxBatch(ctx, 'dark', b.x, d.h / 2, d.z, b.w - 0.2, d.h, 0.2, { tile: 1 });
      // side posts
      for (const s of [-1, 1]) {
        boxBatch(ctx, 'stone', b.x, d.h / 2, d.z + s * (d.w / 2 + 0.12), b.w + 0.2, d.h, 0.24, { tile: 1.8 });
      }
      makeSign(ctx, {
        text: b.lane, sub: b.lane === 'A LONG' ? 'A 长 道' : 'B 隧 道',
        x: b.x, y: d.h + 0.85, z: d.z + (b.x > 0 ? 0 : 0), ry: Math.PI / 2,
        w: 2.6, h: 1.1, seed: 150 + Math.round(b.x),
      });
    }
  }
}

// ---------------------------------------------------------------- low walls

function buildLowWalls(ctx) {
  const L = ctx.data.layout;
  const rng = makeRNG(2024);
  for (const w of L.lowWalls) {
    const key = w.surface === 'stone' ? 'stone' : 'adobe';
    baseBox(ctx, key, w.x, w.z, w.w, w.h - 0.18, w.d, { tile: w.surface === 'stone' ? 2.0 : 2.2 });
    // irregular coping stones along the top
    const along = w.w > w.d;
    const length = along ? w.w : w.d;
    const count = Math.max(2, Math.round(length / 0.72));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const off = -length / 2 + t * length;
      const cw = length / count - 0.05;
      const ch = 0.14 + rng() * 0.12;
      const cx = along ? w.x + off : w.x;
      const cz = along ? w.z : w.z + off;
      boxBatch(ctx, key, cx, w.h - 0.18 + ch / 2, cz, along ? cw : w.d + 0.1, ch, along ? w.d + 0.1 : cw, { tile: 1.4 });
    }
    // broken brick ends & rubble
    if (rng() > 0.4) {
      boxBatch(ctx, 'stone', w.x + w.w / 2 + 0.25, 0.16, w.z, 0.4, 0.3, w.d * 0.8, { tile: 1.2 });
    }
    if (rng() > 0.5) {
      ctx.req.decals.push({
        x: w.x, y: 0.03, z: w.z + (along ? w.d / 2 + 0.55 : 0), rx: -Math.PI / 2, ry: 0, cell: 'grime',
        w: 1.8, h: 1.8, opacity: 0.55,
      });
    }
  }
}

function buildColonnade(ctx) {
  const L = ctx.data.layout;
  for (let i = 0; i < L.pillars.length; i++) {
    const p = L.pillars[i];
    baseBox(ctx, 'stone', p.x, p.z, p.w + 0.3, 0.35, p.d + 0.3, { tile: 1.7 });
    baseBox(ctx, 'stone', p.x, p.z, p.w, p.h - 0.55, p.d, { tile: 2.0, y0: 0.35 });
    const broken = i === 2 || i === 5;
    if (broken) {
      boxBatch(ctx, 'stone', p.x + 0.12, p.h - 0.2, p.z, p.w * 0.55, 0.3, p.d * 0.6, { tile: 1.4, ry: 0.4 });
    } else {
      baseBox(ctx, 'stone', p.x, p.z, p.w + 0.24, 0.28, p.d + 0.24, { tile: 1.7, y0: p.h - 0.5 });
      baseBox(ctx, 'wood', p.x, p.z, p.w * 0.85, 0.18, p.d * 0.85, { tile: 1.4, y0: p.h - 0.52 });
    }
  }
  // lintel beams across some pillars
  for (const z of [-15.2]) {
    for (const x of [-7.2, 7.2]) {
      boxBatch(ctx, 'wood', x, 4.02, z, 0.95, 0.3, 3.3, { tile: 1.5 });
    }
  }
  // shade sails strung over the courtyard
  ctx.req.sails.push({ x: 0, y: 4.35, z: -16.4, w: 13.8, d: 7.2, ry: 0, key: 'shade', sag: 0.55, phase: 0.4 });
  ctx.req.sails.push({ x: 0, y: 4.15, z: -12.6, w: 10.6, d: 4.6, ry: 0.05, key: 'tarp', sag: 0.35, phase: 1.9 });

  // central monument (broken obelisk with cyan emitter)
  const m = ctx.data.layout.hero.monument;
  baseBox(ctx, 'stone', m.x, m.z, 3.5, 0.9, 3.5, { tile: 2.0 });
  baseBox(ctx, 'stone', m.x, m.z, 2.2, 0.35, 2.2, { tile: 1.7, y0: 0.9 });
  baseBox(ctx, 'stone', m.x, m.z, 1.25, 3.0, 1.25, { tile: 1.9, y0: 1.25 });
  boxBatch(ctx, 'stone', m.x, 4.35, m.z, 1.35, 0.3, 1.35, { tile: 1.4, ry: 0.2 });
  // glowing tech core rings
  for (let i = 0; i < 3; i++) {
    const y = 2.0 + i * 0.8;
    const g = new THREE.TorusGeometry(0.72, 0.045, 6, 20);
    ctx.batcher.add('metalDark', g, matrixFor(m.x, y, m.z, Math.PI / 2, i * 0.7));
    g.dispose();
  }
  const core = new THREE.CylinderGeometry(0.34, 0.42, 1.5, 8);
  ctx.batcher.add('glowCyan', core, matrixFor(m.x, 3.1, m.z));
  core.dispose();
  ctx.req.lights.push({ x: m.x, y: 3.2, z: m.z, color: 0x73e6ff, intensity: 5, distance: 7, kind: 'pulse' });
  ctx.req.decals.push({ x: m.x, y: 0.03, z: m.z, rx: -Math.PI / 2, ry: 0, cell: 'chevrons', w: 3.0, h: 3.0, opacity: 0.6 });
}

// ------------------------------------------------------------------ B tunnel

function buildTunnel(ctx) {
  const L = ctx.data.layout;
  // covered passage roof
  for (let z = -10.2; z >= -19.2; z -= 2.26) {
    boxBatch(ctx, 'sheet', -27.0, 3.5, z, 11.4, 0.1, 2.36, { tile: 1.6 });
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

// ------------------------------------------------------------- site arches

function buildSiteArches(ctx) {
  const L = ctx.data.layout;
  for (const a of L.siteArches) {
    addArchMesh(ctx, a);
    // base plinths for the free-standing pillars
    const off = a.span / 2 - a.pierW / 2;
    for (const s of [-1, 1]) {
      baseBox(ctx, 'stone', a.x + s * off, a.z, a.pierW + 0.5, 0.5, a.depth + 0.5, { tile: 1.7 });
    }
    // hanging sign under the arch
    makeSign(ctx, {
      text: a.cell === 'A' ? 'A SITE' : 'B SITE', sub: a.cell === 'A' ? 'A 点 · 阿 尔 法' : 'B 点 · 布 拉 沃',
      x: a.x, y: a.height - 0.75, z: a.z + 0.62, ry: 0, w: 2.4, h: 1.05,
      seed: a.cell === 'A' ? 181 : 182, accent: a.cell === 'A' ? '#8f3b2a' : '#2f6470',
    });
    // big wall stencil behind the site (ground decal handled in decals pass)
  }
}

// ------------------------------------------------------------------ assembly

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

function makeInstanced(ctx, geo, material, items, name, surface, opts = {}) {
  if (items.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  mesh.name = name;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const tint = new THREE.Color();
  const rng = makeRNG(opts.seed ?? 909);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    pos.set(it.x, it.y, it.z);
    e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0, 'YXZ');
    q.setFromEuler(e);
    scl.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(i, m);
    const shade = 0.78 + rng() * 0.34;
    tint.setRGB(shade, shade * (0.97 + rng() * 0.05), shade * (0.94 + rng() * 0.06));
    mesh.setColorAt(i, tint);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = opts.castShadow ?? true;
  mesh.receiveShadow = true;
  mesh.userData.surface = surface;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  ctx.scene.add(mesh);
  ctx.collideMeshes.push(mesh);
  ctx.objects.push(mesh);
  ctx.disposables.push(geo);
  return mesh;
}

function buildInstancedProps(ctx) {
  const L = ctx.data.layout;
  const M = ctx.materials;

  // ---- crates (wooden ammo crates & small boxes) ----
  const crateGeo = new THREE.BoxGeometry(1, 1, 1);
  const crateItems = [];
  for (const c of L.crates) {
    for (let k = 0; k < c.stack; k++) {
      crateItems.push({
        x: c.x + (k > 0 ? (k % 2 === 0 ? 0.06 : -0.05) : 0),
        y: c.s * 0.41 + k * c.s * 0.84,
        z: c.z + (k > 0 ? (k % 2 === 0 ? -0.05 : 0.04) : 0),
        ry: c.ry + k * 0.22,
        s: c.s,
      });
    }
  }
  // a few extra loose crates / ration boxes at waist height
  for (const [x, z, yaw, s] of [
    [-0.6, 30.2, 0.3, 0.62], [1.5, 30.8, 0.8, 0.55], [4.6, 30.2, 0.1, 0.7],
    [-17.2, 27.0, 0.5, 0.7], [20.4, 27.4, 0.9, 0.72], [-22.0, 14.0, 0.2, 0.7],
    [22.2, 15.2, 0.6, 0.68], [17.6, -7.1, 0.4, 0.7], [-17.6, -7.1, 0.9, 0.7],
    [27.4, -9.6, 0.15, 0.72], [-27.4, -9.6, 0.5, 0.66], [1.4, -20.8, 0.3, 0.72],
    [-1.6, -20.6, 0.8, 0.68], [21.6, -27.4, 0.2, 0.7], [-21.6, -27.4, 0.6, 0.7],
  ]) {
    crateItems.push({ x, y: s * 0.41, z, ry: yaw, s });
  }
  const crateMesh = makeInstanced(ctx, crateGeo, M.crate, crateItems, 'crates', 'wood', { seed: 41 });

  // ---- barrels / fuel drums ----
  const barrelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.94, 12, 1, false);
  const barrelItems = L.barrels.map((b) => ({ x: b.x, y: 0.47, z: b.z, ry: b.yaw, s: 1 }));
  // stacked drums beside the truck + B site
  for (const [x, z, y] of [[-19.6, 28.8, 1.42], [-20.4, 27.5, 1.42], [-28.6, -23.6, 1.42], [21.4, -28.6, 1.42]]) {
    barrelItems.push({ x, y, z, ry: 0.4, s: 1 });
  }
  makeInstanced(ctx, barrelGeo, M.rust, barrelItems, 'barrels', 'metal', { seed: 42 });

  // ---- sandbags ----
  const bagGeo = new THREE.SphereGeometry(0.5, 8, 5);
  bagGeo.scale(0.7, 0.24, 0.45);
  const bagItems = [];
  const bagRng = makeRNG(707);
  for (const [x, z, w, d, h] of L.sandbagRuns) {
    const alongX = w >= d;
    const length = alongX ? w : d;
    const across = Math.max(1, Math.round((alongX ? d : w) / 0.44));
    const rows = Math.max(2, Math.round(h / 0.27));
    const count = Math.max(2, Math.round(length / 0.44));
    for (let r = 0; r < rows; r++) {
      for (let a = 0; a < across; a++) {
        for (let i = 0; i < count; i++) {
          const t = (i + 0.5) / count - 0.5;
          const offA = ((a + 0.5) / across - 0.5) * ((alongX ? d : w) - 0.55);
          if (r > 0 && (i + a) % 2 === 0) continue; // stagger upper courses
          const jitter = (bagRng() - 0.5) * 0.06;
          bagItems.push({
            x: x + (alongX ? t * length + jitter : offA),
            y: 0.11 + r * 0.195,
            z: z + (alongX ? offA : t * length + jitter),
            ry: (alongX ? 0 : Math.PI / 2) + (bagRng() - 0.5) * 0.22,
            s: 1,
          });
        }
      }
    }
  }
  makeInstanced(ctx, bagGeo, M.sandbag, bagItems, 'sandbags', 'fabric', { seed: 43 });

  // ---- palm trees: trunk + frond crown ----
  const palmItems = L.palms;
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.2, 2.8, 7, 3);
  trunkGeo.translate(0, 1.4, 0);
  // bend the trunk slightly
  {
    const p = trunkGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.pow(p.getY(i) / 2.8, 2) * 0.28);
    trunkGeo.computeVertexNormals();
  }
  makeInstanced(
    ctx,
    trunkGeo,
    M.bark,
    palmItems.map((p) => ({ x: p.x, z: p.z, y: 0, ry: p.ry, s: p.s })),
    'palm-trunks',
    'wood',
    { seed: 44 }
  );
  const frondGeos = [];
  const crownRng = makeRNG(321);
  for (let i = 0; i < 11; i++) {
    const g = new THREE.PlaneGeometry(3.0, 0.86, 5, 1);
    // taper the leaflets
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const t = p.getX(v) / 3.0 + 0.5;
      p.setY(v, p.getY(v) * (0.35 + Math.sin(t * Math.PI) * 0.85));
      p.setZ(v, -Math.pow(t, 2) * 0.55);
    }
    g.computeVertexNormals();
    const ang = (i / 11) * TAU + crownRng() * 0.4;
    const tilt = -0.45 - crownRng() * 0.55;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(0.2, 2.72 - crownRng() * 0.18, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ang, tilt, 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    frondGeos.push(transformed(g, m));
    g.dispose();
  }
  const crownGeo = mergeGeometries(frondGeos);
  makeInstanced(
    ctx,
    crownGeo,
    M.frond,
    palmItems.map((p) => ({ x: p.x, z: p.z, y: 0, ry: p.ry, s: p.s })),
    'palm-crowns',
    'wood',
    { seed: 45 }
  );

  // ---- rubble & loose stones ----
  const rockGeo = new THREE.IcosahedronGeometry(0.22, 0);
  const rockItems = [];
  const rockRng = makeRNG(551);
  const rubbleSpots = [
    [-31.5, 20.0, 8], [31.4, 12.0, 6], [-30.8, 6.0, 7], [30.6, 2.0, 5],
    [-16.0, -29.5, 10], [16.5, -29.8, 11], [-10.5, 19.5, 6], [11.5, 19.0, 6],
    [22.0, -20.5, 7], [-22.5, -20.8, 8], [-11.5, -25.5, 7], [12.0, -17.0, 6],
    [-28.0, -30.5, 9], [28.5, -30.4, 9], [-25.0, 22.0, 6], [25.0, -31.0, 6],
  ];
  for (const [cx, cz, count] of rubbleSpots) {
    for (let i = 0; i < count; i++) {
      rockItems.push({
        x: cx + (rockRng() - 0.5) * 3.6,
        y: 0.07 + rockRng() * 0.06,
        z: cz + (rockRng() - 0.5) * 3.0,
        ry: rockRng() * TAU,
        rx: (rockRng() - 0.5) * 0.3,
        s: 0.4 + rockRng() * 1.2,
      });
    }
  }
  makeInstanced(ctx, rockGeo, M.stoneDark, rockItems, 'rubble', 'stone', { seed: 46, castShadow: false });

  // ---- tires ----
  const tireGeo = new THREE.TorusGeometry(0.4, 0.15, 8, 16);
  const tireItems = [];
  for (const [x, z, n] of [[-12.4, 22.6, 3], [26.4, 21.4, 4], [-29.6, -11.8, 2], [13.6, -30.6, 3]]) {
    for (let i = 0; i < n; i++) tireItems.push({ x, y: 0.16 + i * 0.3, z, rx: Math.PI / 2, s: 1 });
  }
  makeInstanced(ctx, tireGeo, M.rubber, tireItems, 'tires', 'metal', { seed: 47 });

  // ---- sack piles / market goods ----
  const sackGeo = new THREE.SphereGeometry(0.42, 7, 5);
  sackGeo.scale(1.0, 0.8, 0.75);
  const sackItems = [];
  const sackRng = makeRNG(881);
  for (const [cx, cz, n] of [[10.2, 14.2, 5], [-10.2, 14.2, 4], [10.2, 5.0, 3], [-10.2, 5.0, 5], [-15.8, -23.2, 3], [16.4, -23.0, 3]]) {
    for (let i = 0; i < n; i++) {
      sackItems.push({
        x: cx + (sackRng() - 0.5) * 1.6,
        y: 0.28 + (i % 2) * 0.34,
        z: cz + (sackRng() - 0.5) * 1.1,
        ry: sackRng() * TAU,
        s: 0.8 + sackRng() * 0.3,
      });
    }
  }
  makeInstanced(ctx, sackGeo, M.sandbag, sackItems, 'sacks', 'fabric', { seed: 48 });

  ctx.instanced = { crates: crateMesh };
}

// ------------------------------------------------------------------- the well

function buildWell(ctx) {
  const M = ctx.materials;
  const B = ctx.batcher;
  const w = ctx.data.layout.hero.well;
  // base + stone ring
  const base = new THREE.CylinderGeometry(2.35, 2.5, 0.22, 20, 1);
  B.add('stone', base, matrixFor(w.x, 0.11, w.z));
  base.dispose();
  const ring = new THREE.CylinderGeometry(2.1, 2.16, 0.95, 20, 1, true);
  B.add('stone', ring, matrixFor(w.x, 0.62, w.z));
  ring.dispose();
  const rim = new THREE.TorusGeometry(2.1, 0.1, 6, 22);
  B.add('stone', rim, matrixFor(w.x, 1.1, w.z, Math.PI / 2));
  rim.dispose();
  const inner = new THREE.CylinderGeometry(1.8, 1.8, 1.2, 18, 1, true);
  B.add('dark', inner, matrixFor(w.x, 0.6, w.z));
  inner.dispose();
  // water surface
  const waterGeo = new THREE.CircleGeometry(1.78, 20);
  const water = new THREE.Mesh(waterGeo, M.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(w.x, 0.86, w.z);
  water.name = 'well-water';
  ctx.scene.add(water);
  ctx.objects.push(water);
  ctx.disposables.push(waterGeo);
  void M;
  // winch frame
  for (const [ox, oz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) {
    boxBatch(ctx, 'wood', w.x + ox, 1.65, w.z + oz, 0.17, 3.3, 0.17, { tile: 1.2 });
  }
  boxBatch(ctx, 'wood', w.x, 3.2, w.z - 1.7, 3.7, 0.18, 0.18, { tile: 1.3 });
  boxBatch(ctx, 'wood', w.x, 3.2, w.z + 1.7, 3.7, 0.18, 0.18, { tile: 1.3 });
  boxBatch(ctx, 'wood', w.x - 1.7, 3.2, w.z, 0.18, 0.18, 3.7, { tile: 1.3 });
  boxBatch(ctx, 'wood', w.x + 1.7, 3.2, w.z, 0.18, 0.18, 3.7, { tile: 1.3 });
  // winch drum + rope + bucket
  const drumGeo = new THREE.CylinderGeometry(0.18, 0.18, 2.4, 8);
  ctx.batcher.add('wood', drumGeo, matrixFor(w.x, 2.55, w.z - 1.2, 0, 0, Math.PI / 2));
  drumGeo.dispose();
  const ropeGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.9, 5);
  ctx.batcher.add('metalDark', ropeGeo, matrixFor(w.x, 1.7, w.z - 1.2));
  ropeGeo.dispose();
  const bucketGeo = new THREE.CylinderGeometry(0.22, 0.18, 0.34, 9, 1, true);
  ctx.batcher.add('rust', bucketGeo, matrixFor(w.x, 0.85, w.z - 1.2));
  bucketGeo.dispose();
  // canopy cloth over the well
  ctx.req.awnings.push({ type: 'canopy', x: w.x, y: 3.75, z: w.z, w: 4.4, d: 4.4, key: 'awning', pitch: 0.22, ry: 0.4, postH: 3.3, posts: [] });
  // hanging lantern
  ctx.req.lanterns.push({ x: w.x + 1.3, y: 2.9, z: w.z + 1.3, kind: 'warm', size: 0.3, hang: 3.25 });
  ctx.req.lights.push({ x: w.x, y: 2.9, z: w.z, color: 0xffa050, intensity: 7, distance: 8, kind: 'flicker' });
  // water jars beside it
  for (const [ox, oz] of [[2.6, 1.2], [2.9, 0.2]]) {
    const jar = new THREE.CylinderGeometry(0.24, 0.16, 0.55, 9);
    ctx.batcher.add('rust', jar, matrixFor(w.x + ox, 0.28, w.z + oz));
    jar.dispose();
  }
  ctx.req.decals.push({ x: w.x + 2.9, y: 0.03, z: w.z + 1.0, rx: -Math.PI / 2, ry: 0, cell: 'grime', w: 2.6, h: 2.6, opacity: 0.5 });
}

// ------------------------------------------------------------------- the truck

function buildTruck(ctx) {
  const t = ctx.data.layout.hero.truck;
  const base = matrixFor(t.x, 0, t.z, 0, t.yaw, 0);
  const part = (key, lx, ly, lz, w, h, d, tile = 1.6) => {
    const g = boxGeometryWorldUV(w, h, d, tile);
    const m = new THREE.Matrix4().makeTranslation(lx, ly, lz);
    m.premultiply(base);
    ctx.batcher.add(key, g, m);
    g.dispose();
  };
  const wheel = (lx, lz, r = 0.52) => {
    const g = new THREE.CylinderGeometry(r, r, 0.34, 12);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(lx, r, lz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2, 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    m.premultiply(base);
    ctx.batcher.add('rubber', g, m);
    g.dispose();
    const hub = new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.36, 8);
    const hm = new THREE.Matrix4().compose(
      new THREE.Vector3(lx, r, lz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2, 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    hm.premultiply(base);
    ctx.batcher.add('metalDark', hub, hm);
    hub.dispose();
  };
  // chassis
  part('metalDark', 0, 0.82, 0, 7.0, 0.3, 2.35);
  part('metalDark', 2.6, 1.25, 0, 1.9, 0.55, 2.3);
  // cab
  part('metal', 1.35, 1.95, 0, 1.95, 1.35, 2.2, 1.4);
  part('metalDark', 1.35, 2.68, 0, 1.85, 0.14, 2.1);
  // windshield + side glass
  part('glass', 2.28, 2.2, 0, 0.1, 0.72, 1.86, 1);
  part('dark', 2.32, 2.2, 0, 0.02, 0.62, 1.7, 1);
  part('glass', 1.3, 2.2, 1.1, 1.35, 0.62, 0.04, 1);
  part('glass', 1.3, 2.2, -1.1, 1.35, 0.62, 0.04, 1);
  // hood + grille + bumper
  part('metal', 3.45, 1.55, 0, 1.55, 0.68, 2.2, 1.4);
  part('metalDark', 4.22, 1.42, 0, 0.1, 0.72, 2.1, 1.2);
  part('rust', 4.3, 0.92, 0, 0.22, 0.34, 2.4, 1.2);
  // headlights
  for (const z of [-0.72, 0.72]) {
    part('glowWarm', 4.2, 1.62, z, 0.08, 0.24, 0.34, 1);
  }
  // bed
  part('metal', -1.9, 1.35, 0, 3.5, 0.22, 2.3, 1.4);
  for (const z of [-1.14, 1.14]) {
    part('metal', -1.9, 1.72, z, 3.5, 0.55, 0.12, 1.3);
  }
  part('metal', -3.63, 1.72, 0, 0.12, 0.55, 2.3, 1.3);
  // tarp cover over the cargo bed
  part('tarp', -1.9, 2.22, 0, 3.3, 0.5, 2.16, 1.6);
  for (let i = 0; i < 4; i++) {
    const hoop = new THREE.TorusGeometry(1.05, 0.035, 5, 10, Math.PI);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(-0.6 - i * 0.9, 1.55, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    m.premultiply(base);
    ctx.batcher.add('metalDark', hoop, m);
    hoop.dispose();
  }
  // wheels
  wheel(2.6, 1.16);
  wheel(2.6, -1.16);
  wheel(-1.5, 1.16);
  wheel(-1.5, -1.16);
  wheel(-2.6, 1.16);
  wheel(-2.6, -1.16);
  // roll bar + antenna + spotlight
  for (const z of [-1.0, 1.0]) {
    const bar = new THREE.CylinderGeometry(0.055, 0.055, 0.95, 6);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(-2.6, 2.4, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    m.premultiply(base);
    ctx.batcher.add('metalDark', bar, m);
    bar.dispose();
  }
  const ant = new THREE.CylinderGeometry(0.02, 0.03, 2.1, 5);
  const am = new THREE.Matrix4().compose(
    new THREE.Vector3(-1.1, 2.7, 0.95),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18, 0, 0.12, 'YXZ')),
    new THREE.Vector3(1, 1, 1)
  );
  am.premultiply(base);
  ctx.batcher.add('metalDark', ant, am);
  ant.dispose();
  // dust decals under the wheels + oil stain
  ctx.req.decals.push({ x: t.x + 2.2, y: 0.03, z: t.z, rx: -Math.PI / 2, ry: t.yaw, cell: 'tracks', w: 5.6, h: 2.6, opacity: 0.5 });
  ctx.req.decals.push({ x: t.x - 2.6, y: 0.032, z: t.z + 2.2, rx: -Math.PI / 2, ry: 0, cell: 'oil', w: 2.2, h: 2.2, opacity: 0.6 });
}

// ------------------------------------------------------------ market stalls

function buildStalls(ctx) {
  const L = ctx.data.layout;
  const rng = makeRNG(661);
  for (const s of L.stalls) {
    // counter + front panel
    boxBatch(ctx, 'wood', s.x, 0.55, s.z, 2.9, 0.14, 1.2, { tile: 1.5 });
    boxBatch(ctx, 'wood', s.x, 0.28, s.z + 0.55, 2.9, 0.55, 0.1, { tile: 1.4 });
    boxBatch(ctx, 'wood', s.x, 0.3, s.z, 2.7, 0.42, 0.9, { tile: 1.5 });
    // posts
    for (const [ox, oz] of [[-1.55, -1.45], [1.55, -1.45], [-1.55, 1.45], [1.55, 1.45]]) {
      boxBatch(ctx, 'wood', s.x + ox, 1.3, s.z + oz, 0.13, 2.6, 0.13, { tile: 1.1 });
    }
    // cross beam + awning
    boxBatch(ctx, 'wood', s.x, 2.56, s.z + 1.45, 3.2, 0.12, 0.12, { tile: 1.3 });
    ctx.req.awnings.push({
      type: 'awning', x: s.x, y: 2.72, z: s.z, ry: 0, w: 3.3, d: 3.0, key: 'awning', pitch: 0.3,
    });
    // goods
    for (let i = 0; i < 4; i++) {
      const px = s.x - 1.0 + i * 0.62;
      const kind = i % 3;
      if (kind === 0) {
        const jar = new THREE.CylinderGeometry(0.13, 0.1, 0.3, 8);
        ctx.batcher.add('rust', jar, matrixFor(px, 0.74, s.z - 0.1));
        jar.dispose();
      } else if (kind === 1) {
        const basket = new THREE.CylinderGeometry(0.16, 0.13, 0.16, 8, 1, true);
        ctx.batcher.add('wood', basket, matrixFor(px, 0.72, s.z + 0.12));
        basket.dispose();
      } else {
        const g = boxGeometryWorldUV(0.3, 0.22, 0.24, 1);
        ctx.batcher.add('wood', g, matrixFor(px, 0.74, s.z, 0, rng() * 0.5));
        g.dispose();
      }
    }
    // hanging rugs / posters on the back posts
    ctx.req.posters.push({ x: s.x - 1.45, y: 1.8, z: s.z - 1.5, ry: Math.PI, cell: 'travel', w: 1.0, h: 1.7 });
    ctx.req.lanterns.push({ x: s.x + 1.55, y: 2.35, z: s.z + 1.45, kind: 'warm', size: 0.24, hang: 2.5 });
  }
  // awnings posts hold the cloth — flagged in cloth pass by type
}

// ---------------------------------------------------------------- windmill

function buildWindmill(ctx) {
  const w = ctx.data.layout.hero.windmill;
  const B = ctx.batcher;
  // splayed legs
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const x = w.x + Math.cos(a) * 0.85;
    const z = w.z + Math.sin(a) * 0.85;
    const g = boxGeometryWorldUV(0.2, 6.4, 0.2, 1.2);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(w.x + Math.cos(a) * 0.45, 3.2, w.z + Math.sin(a) * 0.45),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * 0.09, 0, -Math.cos(a) * 0.09, 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    B.add('wood', g, m);
    g.dispose();
    void x;
    void z;
  }
  // cross braces
  for (let i = 0; i < 3; i++) {
    const y = 1.4 + i * 1.9;
    const g = boxGeometryWorldUV(1.7, 0.12, 0.12, 1.2);
    B.add('wood', g, matrixFor(w.x, y, w.z, 0, 0.4 + i * 0.5));
    g.dispose();
  }
  // platform + hub + tail
  boxBatch(ctx, 'wood', w.x, 6.35, w.z, 1.9, 0.18, 1.9, { tile: 1.4 });
  const hub = new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8);
  ctx.batcher.add('metalDark', hub, matrixFor(w.x, 6.65, w.z + 0.85, Math.PI / 2));
  hub.dispose();
  boxBatch(ctx, 'sheet', w.x, 6.6, w.z - 1.6, 0.1, 0.7, 1.5, { tile: 1.2 });

  // rotating blade assembly
  const rotor = new THREE.Group();
  rotor.position.set(w.x, 6.65, w.z + 1.15);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Group();
    blade.rotation.z = (i / 4) * TAU;
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.7, 0.1), ctx.materials.wood);
    spar.position.y = 1.35;
    spar.castShadow = true;
    blade.add(spar);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 2.25), ctx.materials.awning);
    sail.position.set(0, 1.4, 0.06);
    sail.castShadow = true;
    blade.add(sail);
    // sail battens
    for (let b = 0; b < 3; b++) {
      const batten = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.04), ctx.materials.woodDark);
      batten.position.set(0, 0.6 + b * 0.75, 0.1);
      blade.add(batten);
    }
    rotor.add(blade);
  }
  ctx.scene.add(rotor);
  ctx.objects.push(rotor);
  ctx.animated.push({ kind: 'rotor', obj: rotor, speed: 0.22, axis: 'z' });
  ctx.req.lanterns.push({ x: w.x, y: 5.9, z: w.z, kind: 'warm', size: 0.2 });
}

// ------------------------------------------------------------------- radar mast

function buildRadar(ctx) {
  const r = ctx.data.layout.hero.radar;
  // concrete pad + lattice tower
  const pad = new THREE.CylinderGeometry(1.5, 1.65, 0.5, 10);
  ctx.batcher.add('stone', pad, matrixFor(r.x, 0.25, r.z));
  pad.dispose();
  const H = 11.5;
  const legOff = 0.9;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const x0 = Math.cos(a) * legOff;
    const z0 = Math.sin(a) * legOff;
    const x1 = Math.cos(a) * 0.28;
    const z1 = Math.sin(a) * 0.28;
    const g = boxGeometryWorldUV(0.11, H, 0.11, 1.2);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(r.x + (x0 + x1) / 2, H / 2, r.z + (z0 + z1) / 2),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan2(z1 - z0, H) * -1, 0, Math.atan2(x1 - x0, H), 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    ctx.batcher.add('metalDark', g, m);
    g.dispose();
  }
  for (let i = 0; i < 7; i++) {
    const y = 1.0 + i * 1.6;
    const s = 1 - i * 0.1;
    const g = boxGeometryWorldUV(legOff * 2 * s, 0.07, 0.07, 1);
    for (const dir of [0, 1]) {
      const m = matrixFor(r.x, y, r.z, 0, (dir * Math.PI) / 2);
      ctx.batcher.add('metalDark', g, m);
    }
    g.dispose();
  }
  // dish assembly
  const dishGroup = new THREE.Group();
  dishGroup.position.set(r.x, H, r.z);
  const dishGeo = new THREE.SphereGeometry(1.35, 16, 8, 0, TAU, 0, Math.PI * 0.42);
  const dish = new THREE.Mesh(dishGeo, ctx.materials.metalDark);
  dish.rotation.x = -Math.PI * 0.55;
  dish.position.y = 0.65;
  dish.castShadow = true;
  dishGroup.add(dish);
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.9, 6), ctx.materials.rust);
  horn.position.set(0, 0.95, 0.55);
  horn.rotation.x = 1.0;
  dishGroup.add(horn);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), ctx.materials.glowCyan);
  beacon.position.set(0, 1.35, -0.3);
  dishGroup.add(beacon);
  ctx.scene.add(dishGroup);
  ctx.objects.push(dishGroup);
  ctx.animated.push({ kind: 'radar', obj: dishGroup, speed: 0.35, material: ctx.materials.glowCyan, beacon });
  ctx.req.lanterns.push({ x: r.x, y: H + 1.5, z: r.z, kind: 'cyan', size: 0.18 });
  // guy wires
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const g = boxGeometryWorldUV(0.035, 6.4, 0.035, 1);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(r.x + Math.cos(a) * 3.6, 3.2, r.z + Math.sin(a) * 3.6),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55, 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    ctx.batcher.add('metalDark', g, m);
    g.dispose();
  }
}

// ------------------------------------------------------------------- carts

function buildCarts(ctx) {
  function cart(x, z, ry, scale = 1, key = 'wood') {
    const base = matrixFor(x, 0, z, 0, ry, 0);
    const part = (lx, ly, lz, w, h, d, bkey, tile = 1.4) => {
      const g = boxGeometryWorldUV(w * scale, h * scale, d * scale, tile);
      const m = new THREE.Matrix4().makeTranslation(lx * scale, ly * scale, lz * scale);
      m.premultiply(base);
      ctx.batcher.add(bkey, g, m);
      g.dispose();
    };
    part(0, 0.82, 0, 2.2, 0.14, 1.15, key);
    for (const s of [-1, 1]) part(0, 1.02, s * 0.56, 2.2, 0.42, 0.1, key);
    part(1.05, 1.02, 0, 0.1, 0.42, 1.15, key);
    // wheels
    for (const sx of [-0.72, 0.72]) {
      for (const sz of [-0.62, 0.62]) {
        const g = new THREE.CylinderGeometry(0.42 * scale, 0.42 * scale, 0.1, 10);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(sx * scale, 0.42 * scale, sz * scale),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0, 'YXZ')),
          new THREE.Vector3(1, 1, 1)
        );
        m.premultiply(base);
        ctx.batcher.add('wood', g, m);
        g.dispose();
      }
    }
    // handles
    for (const sz of [-0.4, 0.4]) {
      const g = boxGeometryWorldUV(1.2 * scale, 0.09, 0.09, 1);
      const m = new THREE.Matrix4().makeTranslation(-1.7 * scale, 0.95 * scale, sz * scale);
      m.premultiply(base);
      ctx.batcher.add('wood', g, m);
      g.dispose();
    }
    // cargo
    part(-0.2, 1.12, 0, 0.7, 0.45, 0.7, 'crate');
    part(0.55, 1.12, 0.1, 0.6, 0.4, 0.55, 'crate');
  }
  const p = ctx.data.layout.hero.cartPlaza;
  cart(p.x, p.z, 0.35, 1.0);
  const a = ctx.data.layout.hero.aLongCart;
  cart(a.x, a.z, -0.5, 1.15);
  // tipped cart at B site exit
  cart(-21.2, -18.2, 1.2, 0.95);
}

// ---------------------------------------------------------------- campfire

function buildCampfire(ctx) {
  const c = ctx.data.layout.hero.campfire;
  const rng = makeRNG(123);
  // stone ring
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const g = new THREE.IcosahedronGeometry(0.16 + rng() * 0.08, 0);
    ctx.batcher.add('stoneDark', g, matrixFor(c.x + Math.cos(a) * 0.7, 0.12, c.z + Math.sin(a) * 0.7, rng(), rng() * TAU));
    g.dispose();
  }
  // logs
  for (let i = 0; i < 5; i++) {
    const g = new THREE.CylinderGeometry(0.07, 0.09, 0.85, 6);
    const a = (i / 5) * TAU;
    ctx.batcher.add('woodDark', g, matrixFor(c.x + Math.cos(a) * 0.18, 0.2, c.z + Math.sin(a) * 0.18, Math.PI / 2 - 0.5, a, 0));
    g.dispose();
  }
  const coals = new THREE.SphereGeometry(0.34, 8, 5);
  ctx.batcher.add('coals', coals, matrixFor(c.x, 0.14, c.z, 0, 0, 0, 1, 0.4, 1));
  coals.dispose();
  ctx.req.lights.push({ x: c.x, y: 0.8, z: c.z, color: 0xff7a2f, intensity: 6.5, distance: 7.5, kind: 'fire' });
  ctx.req.lanterns.push({ x: c.x, y: 0.5, z: c.z, kind: 'fire', size: 0.5 });
  // cooking tripod
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    const g = new THREE.CylinderGeometry(0.035, 0.045, 2.1, 5);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(c.x + Math.cos(a) * 0.55, 1.0, c.z + Math.sin(a) * 0.55),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35, 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    ctx.batcher.add('metalDark', g, m);
    g.dispose();
  }
  const pot = new THREE.CylinderGeometry(0.22, 0.18, 0.28, 10);
  ctx.batcher.add('metal', pot, matrixFor(c.x, 1.15, c.z));
  pot.dispose();
  ctx.req.smoke.push({ x: c.x, y: 0.7, z: c.z, spread: 0.6, rate: 0.5, count: 24, rise: 2.6, color: 0x6a5a48, scale: 0.9 });
}

// -------------------------------------------------------- A site watch platform

function buildAPlatform(ctx) {
  const p = ctx.data.layout.hero.aPlatform;
  // deck
  boxBatch(ctx, 'wood', p.x, p.h + 0.1, p.z, p.w, 0.22, p.d, { tile: 1.5 });
  // railings
  for (const s of [-1, 1]) {
    boxBatch(ctx, 'wood', p.x + s * (p.w / 2 - 0.1), p.h + 0.75, p.z, 0.12, 1.1, p.d, { tile: 1.2 });
    boxBatch(ctx, 'wood', p.x, p.h + 0.75, p.z + s * (p.d / 2 - 0.1), p.w, 1.1, 0.12, { tile: 1.2 });
    boxBatch(ctx, 'wood', p.x + s * (p.w / 2 - 0.1), p.h + 1.25, p.z, 0.1, 0.1, p.d, { tile: 1.2 });
    boxBatch(ctx, 'wood', p.x, p.h + 1.25, p.z + s * (p.d / 2 - 0.1), p.w, 0.1, 0.1, { tile: 1.2 });
  }
  // ladder
  for (const s of [-1, 1]) {
    boxBatch(ctx, 'wood', p.x + s * 0.45, p.h / 2, p.z - p.d / 2 - 0.05, 0.1, p.h, 0.1, { tile: 1.1 });
  }
  for (let i = 0; i < 7; i++) {
    boxBatch(ctx, 'wood', p.x, 0.5 + i * 0.42, p.z - p.d / 2 - 0.05, 0.9, 0.07, 0.07, { tile: 1 });
  }
  // sandbags on the deck
  for (let i = 0; i < 3; i++) {
    const bag = new THREE.SphereGeometry(0.34, 7, 4);
    ctx.batcher.add('tarp', bag, matrixFor(p.x - 0.7 + i * 0.62, p.h + 0.3, p.z + p.d / 2 - 0.35, 0, i * 1.1, 0, 1, 0.42, 0.62));
    bag.dispose();
  }
  // A-site signal lamp
  ctx.req.lanterns.push({ x: p.x, y: p.h + 1.6, z: p.z - p.d / 2 + 0.15, kind: 'warm', size: 0.22 });
  ctx.req.lights.push({ x: p.x, y: p.h + 1.2, z: p.z, color: 0xffa050, intensity: 5, distance: 8, kind: 'accent' });
}

// ------------------------------------------------------------ B site wreck

function buildBWreck(ctx) {
  const w = ctx.data.layout.hero.bWreck;
  const rng = makeRNG(744);
  // broken chassis/shell plates
  for (let i = 0; i < 7; i++) {
    const g = boxGeometryWorldUV(0.5 + rng() * 0.9, 0.08 + rng() * 0.2, 0.3 + rng() * 0.6, 1.4);
    ctx.batcher.add('rust', g, matrixFor(w.x + (rng() - 0.5) * 2.2, 0.25 + i * 0.08, w.z + (rng() - 0.5) * 1.6, rng() * 0.8, rng() * TAU));
    g.dispose();
  }
  // shattered core
  const core = new THREE.IcosahedronGeometry(0.3, 0);
  ctx.batcher.add('glowCyan', core, matrixFor(w.x + 0.2, 0.55, w.z));
  core.dispose();
  ctx.req.lights.push({ x: w.x, y: 0.7, z: w.z, color: 0x73e6ff, intensity: 3.5, distance: 5, kind: 'pulse' });
  ctx.req.smoke.push({ x: w.x, y: 0.5, z: w.z, spread: 0.4, rate: 0.28, count: 16, rise: 1.8, color: 0x50504a, scale: 0.7 });
  ctx.req.decals.push({ x: w.x, y: 0.03, z: w.z, rx: -Math.PI / 2, ry: 0.4, cell: 'chips', w: 2.4, h: 2.4, opacity: 0.8 });
}

// ------------------------------------------------------- north wall pipeline

function buildPipeline(ctx) {
  // rusty pipe run + valve wheels along the north wall
  for (const [y, r] of [[1.35, 0.16], [1.9, 0.11]]) {
    const g = new THREE.CylinderGeometry(r, r, 62, 8);
    ctx.batcher.add('rust', g, matrixFor(0, y, -32.45, 0, 0, Math.PI / 2));
    g.dispose();
  }
  for (let x = -28; x <= 28; x += 7) {
    const bracket = boxGeometryWorldUV(0.14, 1.4, 0.5, 1);
    ctx.batcher.add('metalDark', bracket, matrixFor(x, 1.4, -32.7));
    bracket.dispose();
  }
  for (const [x, y] of [[-18, 1.35], [4, 1.35], [20, 1.9]]) {
    const wheel = new THREE.TorusGeometry(0.3, 0.045, 6, 12);
    ctx.batcher.add('metalDark', wheel, matrixFor(x, y + 0.35, -32.2, 0, 0, 0));
    wheel.dispose();
    const stem = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 5);
    ctx.batcher.add('metalDark', stem, matrixFor(x, y + 0.18, -32.3, Math.PI / 2));
    stem.dispose();
  }
}

function buildProps(ctx) {
  buildInstancedProps(ctx);
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

function clothMaterial(ctx, key) {
  const M = ctx.materials;
  switch (key) {
    case 'awning': return M.awning;
    case 'tarp': return M.tarp;
    case 'shade': return M.shade;
    case 'a': return M.bannerA;
    case 'b': return M.bannerB;
    case 'warn': return M.bannerWarn;
    case 'title':
    default: return M.bannerTitle;
  }
}

function registerCloth(ctx, mesh, geo, type, w, h, amp, phase) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.scene.add(mesh);
  ctx.cloths.push({
    mesh,
    geo,
    base: new Float32Array(geo.attributes.position.array),
    type,
    w,
    h,
    amp,
    phase,
    speed: 1.15 + (phase % 1) * 1.5,
  });
}

function buildCloths(ctx) {
  const rng = makeRNG(1717);
  // banners & flags have been requested by the architecture pass
  const siteBanners = [
    { key: 'a', x: 17.5, y: 4.4, z: -32.84, ry: 0, w: 3.2, h: 5.6 },
    { key: 'b', x: -18.0, y: 4.4, z: -32.84, ry: 0, w: 3.2, h: 5.6 },
    { key: 'a', x: 20.6, y: 4.2, z: -29.4, ry: Math.PI * 0.1, w: 2.4, h: 4.2 },
    { key: 'b', x: -20.6, y: 4.2, z: -29.4, ry: -Math.PI * 0.1, w: 2.4, h: 4.2 },
  ];
  for (const b of siteBanners) ctx.req.banners.push({ ...b, sway: 0.05, anchor: 'top' });
  // staging flag poles
  for (const f of ctx.data.layout.hero.flagpoles) {
    ctx.req.flags.push({ x: f.x, y: f.h - 0.35, z: f.z, w: 2.3, h: 1.5, ry: f.x > 0 ? -0.35 : 0.35, key: f.x > 0 ? 'warn' : 'title', phase: rng() * 6 });
  }

  for (const req of ctx.req.banners) {
    const w = req.w;
    const h = req.h;
    const geo = new THREE.PlaneGeometry(w, h, 10, 8);
    const mat = clothMaterial(ctx, req.key);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(req.x, req.y, req.z);
    mesh.rotation.set(req.tilt ?? 0, req.ry ?? 0, 0);
    mesh.name = `banner:${req.key}`;
    ctx.disposables.push(geo);
    ctx.objects.push(mesh);
    registerCloth(ctx, mesh, geo, 'banner', w, h, req.sway ?? 0.09, rng() * 6.28);
  }

  for (const req of ctx.req.flags) {
    const w = req.w;
    const h = req.h;
    const geo = new THREE.PlaneGeometry(w, h, 10, 6);
    geo.translate(w / 2, 0, 0);
    const mat = clothMaterial(ctx, req.key);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(req.x, req.y - h / 2, req.z);
    mesh.rotation.set(0, req.ry ?? 0, 0);
    mesh.name = 'flag';
    ctx.disposables.push(geo);
    ctx.objects.push(mesh);
    registerCloth(ctx, mesh, geo, 'flag', w, h, 0.14, req.phase ?? rng() * 6.28);
  }

  for (const req of ctx.req.awnings) {
    const w = req.w;
    const d = req.d;
    if (req.type === 'strip') {
      const geo = new THREE.PlaneGeometry(w, d, 6, 6);
      const mesh = new THREE.Mesh(geo, clothMaterial(ctx, req.key));
      mesh.position.set(req.x, req.y - d / 2, req.z);
      mesh.rotation.set(0, req.ry ?? 0, 0);
      ctx.disposables.push(geo);
      ctx.objects.push(mesh);
      registerCloth(ctx, mesh, geo, 'strip', w, d, 0.1, rng() * 6.28);
      continue;
    }
    const geo = new THREE.PlaneGeometry(w, d, 12, 8);
    // static sag
    const sag = req.type === 'canopy' ? 0.2 : req.type === 'sail' ? (req.sag ?? 0.5) : 0.05;
    if (sag > 0) {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = clamp(p.getX(i) / w + 0.5, 0, 1);
        const v = clamp(p.getY(i) / d + 0.5, 0, 1);
        p.setZ(i, p.getZ(i) - sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
      }
      geo.computeVertexNormals();
    }
    const mesh = new THREE.Mesh(geo, clothMaterial(ctx, req.key));
    mesh.position.set(req.x, req.y, req.z);
    mesh.rotation.set(-Math.PI / 2 + (req.pitch ?? 0), req.ry ?? 0, 0, 'YXZ');
    mesh.name = `cloth:${req.type}`;
    ctx.disposables.push(geo);
    ctx.objects.push(mesh);
    registerCloth(ctx, mesh, geo, req.type ?? 'awning', w, d, req.type === 'canopy' ? 0.05 : 0.035, rng() * 6.28);
    // support posts for canopies
    if (req.posts && req.posts.length) {
      for (const [ox, oz] of req.posts) {
        boxBatch(ctx, 'wood', req.x + ox, (req.postH ?? 2.6) / 2, req.z + oz, 0.14, req.postH ?? 2.6, 0.14, { tile: 1.1 });
      }
    }
  }

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

function mergePlanes(ctx, requests, getCell, material, name) {
  const geos = [];
  for (const req of requests) {
    const cell = getCell(req);
    if (!cell) continue;
    const g = planeGeometry(req.w, req.h, { u0: cell.u0, v0: cell.v0, u1: cell.u1, v1: cell.v1 });
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(req.x, req.y, req.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(req.rx ?? 0, req.ry ?? 0, req.rz ?? 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    geos.push(transformed(g, m));
    g.dispose();
  }
  if (geos.length === 0) return null;
  const merged = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  ctx.disposables.push(merged);
  return mesh;
}

function buildSiteStencils(ctx) {
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
  const maxLights = ctx.quality === 'medium' ? 6 : 8;
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
  ctx.collideMeshes.length = 0;
  for (const obj of ctx.worldObjects) {
    if (obj.userData && obj.userData.surface) ctx.collideMeshes.push(obj);
    if (obj.isInstancedMesh) ctx.collideMeshes.push(obj);
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
      ctx.scene.environmentIntensity = nextQuality === 'medium' ? 0.45 : 0.55;
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


