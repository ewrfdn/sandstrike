/**
 * SANDSTRIKE // map collision, spawn resolution and layout warnings.
 *
 * This is a verbatim port of the collision/enemy-spawn logic that used to live inline in
 * `src/world.js buildWorldData()`. The push order, the `toFixed(3)` rounding and every
 * derived formula (crate foot print, tyre stack top, palm trunk, ...) are kept exactly
 * as they were so the collision set is element-for-element identical to the old build.
 *
 * Pure data module: no `three`, no DOM — importable from Node for parity checks.
 */

const TAU = Math.PI * 2;
const DEFAULT_SURFACE = 'adobe';

/** Marker that goes into the old `solid()` helper for warning-free material fallbacks. */
const SURFACE_FALLBACK = DEFAULT_SURFACE;

/** Stall corner post offsets used by `buildWorldData()` (counter stays walk-under). */
const STALL_POSTS = Object.freeze([
  [-1.55, -1.45],
  [1.55, -1.45],
  [-1.55, 1.45],
  [1.55, 1.45],
]);

/**
 * Derive the authoritative collision boxes from a normalised `layout`.
 *
 * `extraSolids` are explicitly authored blockers that have no derivation rule in the old
 * code (tunnel timber posts, mid-gate door leaves, hand cart, lumber/pallet/scrap stacks).
 * They are appended at the end, after the rule-derived boxes, and use the same rounding
 * as the old inline `solid()` calls.
 *
 * @param {object} layout normalised layout (see `formats/v1.js`)
 * @param {Array<{x:number,z:number,w:number,d:number,h:number,surface?:string,y0?:number}>} [extraSolids]
 * @returns {Array<{minX:number,maxX:number,minZ:number,maxZ:number,minY:number,maxY:number,surface:string}>}
 */
export function buildCollisionBoxes(layout, extraSolids = []) {
  const boxes = [];
  /** register a ground-to-height axis-aligned solid (identical to the old helper) */
  const solid = (x, z, w, d, h, surface = SURFACE_FALLBACK, y0 = 0) => {
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

  // ---------------------------------------------------------------- mid wall
  for (const w of layout.walls) solid(w.x, w.z, w.w, w.d, w.h, 'adobe');

  // gatehouse piers framing the central doorway
  for (const p of layout.gatePiers) solid(p.x, p.z, p.w, p.d, p.h, 'stone');

  // ------------------------------------------------------------- boundary walls
  for (const b of layout.boundary) solid(b.x, b.z, b.w, b.d, b.h, 'adobe');

  // corner towers
  for (const t of layout.towers) solid(t.x, t.z, t.w, t.d, t.h, 'adobe');

  // --------------------------------------------------- south plaza-side buildings
  for (const b of layout.buildings) solid(b.x, b.z, b.w, b.d, b.h, 'adobe');

  // ------------------------------------------------ courtyard side warehouse blocks
  for (const b of layout.blocks) solid(b.x, b.z, b.w, b.d, b.h, 'adobe');

  // ---------------------------------------------------------------- low cover walls
  for (const w of layout.lowWalls) solid(w.x, w.z, w.w, w.d, w.h, w.surface);

  // ------------------------------------------------------- courtyard colonnade
  for (const p of layout.pillars) solid(p.x, p.z, p.w, p.d, p.h, 'stone');

  // ------------------------------------------------------------- B tunnel piers
  for (const p of layout.tunnelPiers) solid(p.x, p.z, p.w, p.d, p.h, 'stone');

  // -------------------------------------------------------- stand-alone site arches
  for (const a of layout.siteArches) {
    if (!a.solidPiers) continue;
    const off = a.span / 2 - a.pierW / 2;
    solid(a.x - off, a.z, a.pierW + 0.15, a.depth + 0.2, a.height, 'stone');
    solid(a.x + off, a.z, a.pierW + 0.15, a.depth + 0.2, a.height, 'stone');
  }

  // ------------------------------------------------------------- courtyard monument
  const hero = layout.hero;
  solid(hero.monument.x, hero.monument.z, 3.5, 3.5, 0.9, 'stone');
  solid(hero.monument.x, hero.monument.z, 1.3, 1.3, 3.2, 'stone', 0.9);

  // ------------------------------------------------------------------- the well
  solid(hero.well.x, hero.well.z, 4.9, 4.9, 2.35, 'stone');
  // water jars beside the well (drawn in buildWell ~0.55 m tall)
  solid(hero.well.x + 2.6, hero.well.z + 1.2, 0.5, 0.5, 0.55, 'metal');
  solid(hero.well.x + 2.9, hero.well.z + 0.2, 0.5, 0.5, 0.55, 'metal');

  // ------------------------------------------------------------------ the truck
  // parked at yaw 0.14: the rotated footprint (~7.66 x 3.90 m) must fit inside the box
  solid(hero.truck.x, hero.truck.z, 7.8, 3.9, 2.7, 'metal');

  // --------------------------------------------------------------- market stalls
  for (const s of layout.stalls) {
    solid(s.x, s.z, 2.9, 1.2, 1.05, 'wood');
    for (const [ox, oz] of STALL_POSTS) {
      solid(s.x + ox, s.z + oz, 0.18, 0.18, 2.6, 'wood');
    }
  }

  // --------------------------------------------------------------- misc hero solids
  solid(hero.watchtower.x, hero.watchtower.z, hero.watchtower.w, hero.watchtower.d, hero.watchtower.h, 'adobe');
  solid(hero.windmill.x, hero.windmill.z, 2.1, 2.1, 2.6, 'wood');
  // radar: 3.3 m concrete pad (0.5 m high) + lattice-tower legs at player height; the
  // tower box starts at the pad top so the two boxes do not overlap in 3D
  solid(hero.radar.x, hero.radar.z, 3.0, 3.0, 0.5, 'stone');
  solid(hero.radar.x, hero.radar.z, 1.4, 1.4, 1.7, 'metal', 0.5);
  solid(hero.campfire.x, hero.campfire.z, 1.5, 1.5, 0.55, 'stone');
  // flag poles
  for (const f of hero.flagpoles) solid(f.x, f.z, 0.34, 0.34, f.h, 'wood');
  // A-long shade posts
  for (const z of hero.aLongShade.zs) solid(hero.aLongShade.x, z, 0.26, 0.26, 3.3, 'wood');
  // A site raised watch platform legs
  const ap = hero.aPlatform;
  const apLegs = [
    [-ap.w / 2 + 0.2, -ap.d / 2 + 0.2],
    [ap.w / 2 - 0.2, -ap.d / 2 + 0.2],
    [-ap.w / 2 + 0.2, ap.d / 2 - 0.2],
    [ap.w / 2 - 0.2, ap.d / 2 - 0.2],
  ];
  for (const [ox, oz] of apLegs) {
    // the SW leg stands on the radar pad; the pad collider already blocks that cell,
    // so it needs no separate leg box (a nested box double-counts in box health)
    if (Math.abs(ap.x + ox - hero.radar.x) < 1.5 && Math.abs(ap.z + oz - hero.radar.z) < 1.5) continue;
    solid(ap.x + ox, ap.z + oz, 0.3, 0.3, ap.h, 'wood');
  }
  // carts (collider sized to the real visual height so mid-height probes hit the deck)
  solid(hero.cartPlaza.x, hero.cartPlaza.z, hero.cartPlaza.w, hero.cartPlaza.d, 1.44, 'wood');
  solid(hero.aLongCart.x, hero.aLongCart.z, hero.aLongCart.w, hero.aLongCart.d, 1.2, 'wood');
  // B-site wreck — plates/scrap span ~2.8 x 2.2 m around the shattered core
  solid(hero.bWreck.x, hero.bWreck.z, 2.8, 2.2, 1.1, 'metal');

  // --------------------------------------------------------------------- crates
  for (const c of layout.crates) {
    const foot = c.s * 1.02;
    const hh = c.s * 0.82 * c.stack;
    solid(c.x, c.z, foot, foot, hh, 'wood');
  }

  // -------------------------------------------------------------------- barrels
  for (const b of layout.barrels) solid(b.x, b.z, 0.78, 0.78, 0.92, 'metal');

  // ------------------------------------------------------------ sandbag positions
  for (const [x, z, w, d, h] of layout.sandbagRuns) solid(x, z, w, d, h, 'fabric');

  // ----------------------------------------------------------------------- palms
  for (const p of layout.palms) solid(p.x, p.z, 0.55 * p.s, 0.55 * p.s, 2.7 * p.s, 'wood');

  // ------------------------------------------------------------------- lamp posts
  for (const [x, z] of layout.lampPosts) solid(x, z, 0.32, 0.32, 3.4, 'metal');

  // ------------------------------------------- loose props that used to be walk-through
  // single loose crates drawn by buildInstancedProps (visual cube is s wide, top ~0.91 s)
  for (const c of layout.looseCrates) {
    const foot = +(c.s * 1.02).toFixed(2);
    solid(c.x, c.z, foot, foot, +(c.s * 0.82).toFixed(2), 'wood');
  }
  // tyre stacks: stack top = 0.31 + (n-1) * 0.3
  for (const [x, z, n] of layout.tireStacks) solid(x, z, 1.0, 1.0, +(0.31 + (n - 1) * 0.3).toFixed(2), 'metal');
  // loose sack piles at the bomb sites (visual pile ~1.8 x 1.3 m, tops ~0.8 m)
  for (const [x, z] of layout.sackPiles) solid(x, z, 1.6, 1.2, 0.8, 'fabric');

  // ------------------------------------------- explicitly authored blockers (json `solids`)
  for (const s of extraSolids) {
    solid(s.x, s.z, s.w, s.d, s.h, s.surface ?? SURFACE_FALLBACK, s.y0 ?? 0);
  }

  return boxes;
}

/**
 * Build the `pointBlocked(x, z, clearance)` predicate used by both spawn resolution and
 * the layout warnings. Low kerbs/bags below 0.35 m are ignored (same as the old code).
 */
export function makePointBlocked(boxes) {
  return function pointBlocked(x, z, clearance) {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.maxY - b.minY < 0.35) continue;
      if (x > b.minX - clearance && x < b.maxX + clearance && z > b.minZ - clearance && z < b.maxZ + clearance) return true;
    }
    return false;
  };
}

/**
 * Resolve enemy spawn candidates against the collision set with the old spiral search
 * (0.5 m rings, 24 steps, player-distance filter). Order of the output matches the order
 * of the candidate list; candidates that cannot be resolved are dropped.
 */
export function resolveEnemySpawns(candidates, boxes, playerSpawn, resolve = {}) {
  const clearance = resolve.clearance ?? 1.45;
  const playerMinDistance = resolve.playerMinDistance ?? 4.5;
  const searchRadius = resolve.searchRadius ?? 8;
  const step = resolve.step ?? 0.5;
  const angleSteps = resolve.angleSteps ?? 24;
  const pointBlocked = makePointBlocked(boxes);

  const enemySpawns = [];
  for (const [x, z, label] of candidates) {
    let px = x;
    let pz = z;
    if (pointBlocked(px, pz, clearance)) {
      let found = false;
      for (let r = 0.5; r <= searchRadius && !found; r += step) {
        for (let a = 0; a < angleSteps && !found; a++) {
          const ang = (a / angleSteps) * TAU;
          const nx = x + Math.cos(ang) * r;
          const nz = z + Math.sin(ang) * r;
          if (!pointBlocked(nx, nz, clearance) && Math.hypot(nx - playerSpawn.x, nz - playerSpawn.z) > playerMinDistance) {
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
  return enemySpawns;
}

/**
 * Layout warnings, exactly as the old `buildWorldData()` produced them:
 * degenerate boxes, blocked resolved spawns, blocked player spawn, too few spawns.
 */
export function buildWarnings(boxes, enemySpawns, playerSpawn, resolve = {}) {
  const validateClearance = resolve.validateClearance ?? 1.1;
  const playerClearance = resolve.playerClearance ?? 0.9;
  const minCount = resolve.minCount ?? 8;

  const warnings = [];
  for (const box of boxes) {
    if (!(box.maxX > box.minX && box.maxZ > box.minZ && box.maxY > box.minY)) warnings.push('degenerate collision box');
  }
  const pointBlocked = makePointBlocked(boxes);
  for (const s of enemySpawns) {
    if (pointBlocked(s.x, s.z, validateClearance)) warnings.push(`enemy spawn blocked: ${s.label}`);
  }
  if (pointBlocked(playerSpawn.x, playerSpawn.z, playerClearance)) warnings.push('player spawn blocked');
  if (enemySpawns.length < minCount) warnings.push(`only ${enemySpawns.length} enemy spawns resolved`);
  return warnings;
}
