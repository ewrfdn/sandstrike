/**
 * ISLAND RUINS — R1 `ruin-wall` · 遗迹残墙 (see ISLAND_ASSETS.md §2.3).
 *
 * A 6 m run of collapsed ashlar masonry: every stone is an individually bevelled
 * block laid in offset courses (two masonry rows + a dark rubble core), with a
 * jagged collapsed top, a breached hole punched through the right-hand end, moss
 * banks, fig roots climbing the face and vines spilling over the coping.
 *
 * Conventions: metres, +Y up, the finished wall runs along X with its front face
 * toward -Z (the stage FRONT camera), base on y = 0, deterministic `makeRNG`.
 * One hero instance in the model stage; `buildWorld` reads
 * `ctx.data.layout.island.ruinWalls` and builds nothing when the key is missing.
 */
import * as THREE from 'three';
import { matrixFor } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { cylGeo, emit, plateGeo, rockGeo, tubeGeo } from '../detail.js';
import { leafQuad } from './leaf-atlas.js';

export const meta = { id: 'ruin-wall', kind: 'world', group: 'ruin', label: '遗迹残墙 · RUIN WALL' };

/** Layout array key owned by this model (ISLAND_ASSETS.md §8). */
const KEY = 'ruinWalls';
/** moss-stone texture module contract: 1 tile = 2 m. */
const TILE = 2.0;
/** Nominal masonry course height (m). */
const COURSE = 0.4;
/** Height / depth of one masonry row; the wall is two rows + a 0.2 m core. */
const ROW_D = 0.5;
/** Overall hero footprint (m) — used only for documentation / sanity. */
export const WALL = Object.freeze({ length: 6.0, height: 3.2, depth: 1.2 });

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

/** Preview builder (stage/WebUI): one hero instance, then build. */
export function build(ctx) {
  const L = island(ctx);
  L[KEY] = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildRuinWalls(ctx, true);
}

/** Map assembly builder: build every instance from the map layout. */
export function buildWorld(ctx) {
  buildRuinWalls(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildRuinWalls(ctx, preview) {
  const items = island(ctx)[KEY] || [];
  if (!items.length) return;
  for (let i = 0; i < items.length; i++) buildRuinWall(ctx, items[i], preview, i);
}

// ---------------------------------------------------------------------------
// small deterministic helpers
// ---------------------------------------------------------------------------

/** 0…1 hash — stable per (index, salt), so every run chips the wall identically. */
function hash01(n, salt = 0) {
  const v = Math.sin(n * 91.7 + salt * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}

// ---------------------------------------------------------------------------
// vertex-colour tinting (albedo variation)
// ---------------------------------------------------------------------------
// The shared stone / soil materials are declared `vertexColors: true`. The batcher
// merges every piece of one material key into a single geometry, and a merged
// geometry WITHOUT a `color` attribute feeds the shader a black default — that is
// why the masonry used to render as burnt-black blocks. Writing an explicit colour
// attribute per piece both fixes that and gives every ashlar stone its own albedo
// jitter instead of a wall of identical clones.
const VC_KEYS = new Set([
  'mossStone', 'ruinStone', 'ruinStoneDark', 'stone', 'mud', 'leafLitter', 'beachSand',
  'barkMoss', 'barkTrop', 'wood', 'woodDark', 'driftWood', 'jungleGrass',
]);

/** Flat RGB tint written into a geometry's vertex-colour attribute. */
function paintTint(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Per-vertex tint from a callback `(x, y, z, i) => [r, g, b]` (wet bands, cracks). */
function gradientTint(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Deterministic per-piece albedo jitter: 0.90…1.08 value + a warm/cool bias. */
function tintAt(x, y, z, key) {
  const n = hash01(x * 12.7 + y * 7.3 + z * 5.1, 41);
  const w = hash01(z * 9.3 + x * 3.7 + y * 1.3, 42) - 0.5;
  // mossy stones sit a touch darker and greener than the dressed ashlar
  const base = key === 'mossStone' ? 0.93 : key === 'ruinStoneDark' ? 0.97 : 1.0;
  const v = base * (0.9 + n * 0.18);
  const warm = w * 0.06;
  return [v * (1 + warm), v * (1 - warm * 0.2), v * (1 - warm)];
}

/** Ensure a vertex-tinted material key carries a colour attribute. */
function prepareTint(geo, x = 0, y = 0, z = 0, key = '', tint = null) {
  if (!VC_KEYS.has(key) || geo.attributes.color) return geo;
  if (tint) {
    if (typeof tint === 'function') gradientTint(geo, tint);
    else paintTint(geo, tint[0], tint[1], tint[2]);
  } else {
    paintTint(geo, ...tintAt(x, y, z, key));
  }
  return geo;
}

/**
 * Collapsed wall silhouette: for a given x (local metres) returns the height the
 * masonry is allowed to reach. Several flat terraces with little cliff faces
 * between them read as a stepped collapse instead of one smooth ramp; per-block
 * jitter in the course loop adds the ragged erosion on top of those steps.
 */
function topAt(x) {
  if (x < -2.62) return 0.94; // broken low left end
  if (x < -2.45) return 1.28 + (x + 3.0) * 0.5; // rubble shoulder
  if (x < -2.18) return 1.62; // first terrace
  if (x < -1.86) return 1.96 + (x + 2.18) * 0.9; // step up
  if (x < -1.72) return 2.15 + (x + 1.86) * 1.3; // steep shoulder
  if (x < -0.34) return 2.88 + Math.sin((x + 1.7) * 1.35) * 0.08; // tall mid run
  if (x < 0.22) return 2.62; // dropped terrace in the middle of the run
  if (x < 0.55) return 2.78 + (x - 0.22) * 0.5; // small step back up
  if (x < 1.2) return 2.9 - (x - 0.55) * 0.85; // stepped collapse
  if (x < 1.62) return 2.36; // shelf above the breach
  if (x < 2.62) return 2.4 - (x - 1.2) * 0.32; // right shoulder
  return 1.18 - (x - 2.62) * 0.28; // low broken right end
}

/** Breach punched through the right-hand shoulder (local x, y). */
function inBreach(x, y) {
  const dx = (x - 2.06) / 0.46;
  const dy = (y - 1.02) / 0.66;
  return dx * dx + dy * dy < 1;
}

/** Bevelled ashlar block whose outer size is exactly w × h × d (m). */
function block(ctx, add, key, x, y, z, w, h, d, opts = {}) {
  // per-stone masonry variation: randomised bevel width, texture rotation and UV
  // offset so no two ashlar blocks wear the same moss patch the same way
  const r1 = hash01(x * 9.1 + y * 4.3 + z * 6.7, 31);
  const bevel = Math.min(0.008 + r1 * 0.012, w * 0.22, h * 0.22, d * 0.22);
  const geo = plateGeo(w - 2 * bevel, h - 2 * bevel, d, { bevel, tile: TILE });
  if (hash01(x * 3.3 + z * 5.1 + y * 1.7, 32) < 0.48) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
  }
  add(key, geo, x, y, z, opts.rx || 0, opts.ry || 0, opts.rz || 0, {
    uvOffset: opts.uvOffset || [
      hash01(x * 13.1 + y * 7.7 + z * 2.3, 3),
      hash01(z * 11.3 + y * 5.1 + x * 1.9, 9),
    ],
  });
}

// ---------------------------------------------------------------------------
// the wall
// ---------------------------------------------------------------------------

function buildRuinWall(ctx, item, preview, index) {
  const rng = makeRNG(1700 + index * 131);
  const s = item.s ?? 1;
  const base = matrixFor(item.x ?? 0, item.y ?? 0, item.z ?? 0, 0, item.ry ?? 0, 0, s, s, s);
  /** Add geometry in wall-local space (the instance transform is pre-multiplied). */
  const add = (key, geo, lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0, opts = {}) => {
    prepareTint(geo, lx, ly, lz, key, opts.tint);
    emit(ctx, key, geo, base.clone().multiply(matrixFor(lx, ly, lz, rx, ry, rz)), opts);
  };

  const halfLen = WALL.length / 2;
  const rowZ = WALL.depth * 0.25; // ±0.3 m: front / back masonry row centres
  const brickD = ROW_D;

  // ------------------------------------------------------------- rubble core
  // Dark core that fills the 0.2 m cavity between the two masonry rows. It is
  // built in short vertical strips so the breach is a genuine see-through hole,
  // and each strip stops just under the collapsed top.
  const coreSeg = 24;
  for (let i = 0; i < coreSeg; i++) {
    const x = -halfLen + (i + 0.5) * ((WALL.length) / coreSeg);
    const top = Math.max(0.25, topAt(x) - 0.06);
    // leave the breach open: split the strip into below / above pieces
    if (inBreach(x, 1.02)) {
      const lowTop = 0.3;
      add('dark', plateGeo(0.23, lowTop, 0.2, { bevel: 0.004, tile: 1.4 }), x, lowTop / 2, 0);
      const hiBot = 1.72;
      if (top > hiBot + 0.05) {
        add('dark', plateGeo(0.23, top - hiBot, 0.2, { bevel: 0.004, tile: 1.4 }), x, (top + hiBot) / 2, 0);
      }
    } else {
      add('dark', plateGeo(0.23, top, 0.2, { bevel: 0.004, tile: 1.4 }), x, top / 2, 0);
    }
  }

  // ----------------------------------------------------------- ashlar courses
  // Two rows of staggered blocks. Row/phase offsets alternate per course so the
  // joints of the front row never line up with the back row (proper bond).
  const rows = [
    { z: -rowZ, keyBias: 0.5 },
    { z: rowZ, keyBias: 0.5 },
  ];
  let blockCount = 0;
  for (let row = 0; row < rows.length; row++) {
    const rz = rows[row].z;
    const courses = Math.ceil((WALL.height + 0.1) / COURSE);
    for (let c = 0; c < courses; c++) {
      const y0 = c * COURSE;
      const yc = y0 + COURSE / 2;
      // stagger: shift the start of each course, alternate direction of travel
      const dir = c % 2 === 0 ? 1 : -1;
      let cursor = dir === 1 ? -halfLen : halfLen;
      let g = 0;
      while ((dir === 1 && cursor < halfLen) || (dir === -1 && cursor > -halfLen)) {
        const w = 0.46 + rng() * 0.36; // block length in X
        const bw = Math.min(w, dir === 1 ? halfLen - 0.09 - cursor : cursor + halfLen - 0.09);
        if (bw < 0.16) break;
        const xc = dir === 1 ? cursor + bw / 2 : cursor - bw / 2;
        const courseTop = topAt(xc) + (hash01(c * 7 + g, row * 3 + 1) - 0.5) * 0.22;
        const missing = rng() < 0.055; // a few stones have dropped out near the top
        const visible = y0 < courseTop - 0.03 && !inBreach(xc, yc) && !(missing && y0 > courseTop - 0.5);
        if (visible) {
          const h = COURSE - 0.028 - rng() * 0.012;
          const d = brickD - 0.02 + rng() * 0.03;
          // small settled/tilted offsets: nothing in a ruin is perfectly plumb
          const jitterX = (rng() - 0.5) * 0.02;
          // individual blocks step in and out of the wall face (±4.5 cm) so the
          // masonry reads as separate stones in depth, not one flat panel
          const relief = (rng() - 0.5) * 0.09;
          const jitterZ = relief;
          const tiltZ = (rng() - 0.5) * 0.035 + relief * 0.35;
          const tiltY = (rng() - 0.5) * 0.03;
          // lower courses + the top of the run are the mossiest blocks
          const mossy = y0 < COURSE * 1.2 ? rng() < 0.34 : y0 > courseTop - 0.6 ? rng() < 0.5 : rng() < 0.06;
          const key = mossy ? 'mossStone' : rng() < 0.9 ? 'ruinStone' : 'ruinStoneDark';
          block(ctx, add, key, xc + jitterX, yc, rz + jitterZ, bw - 0.026, h, d, { rz: tiltZ, ry: tiltY });
          blockCount++;
          // a stone that has slipped proud of the course (deep relief shadow)
          if (rng() < 0.03 && y0 > 0.3 && y0 < courseTop - 0.45) {
            block(ctx, add, 'ruinStoneDark', xc + jitterX + (rng() - 0.5) * 0.1, yc - 0.03,
              rz - Math.sign(rz) * (d / 2 + 0.02), bw * (0.4 + rng() * 0.3), h * 0.55, 0.05,
              { rx: (rng() - 0.5) * 0.12, rz: tiltZ * 1.5 });
          }
          // one block per course pushed in: its missing face becomes a recess
          if (rng() < 0.02 && y0 > 0.5) {
            block(ctx, add, 'mud', xc, yc, rz - Math.sign(rz) * (d / 2 - 0.02), bw * 0.6, h * 0.7, 0.06);
          }
        }
        cursor = dir === 1 ? cursor + bw : cursor - bw;
        g++;
        if (g > 24) break;
      }
    }
  }

  // --------------------------------------------------------- coping / crest
  // Full-depth cap stones along the surviving crest; each is tilted and offset
  // so the top edge never reads as a straight line.
  let x = -halfLen + 0.2;
  while (x < halfLen - 0.42) {
    const t = topAt(x);
    const cw = 0.34 + hash01(x * 9.1, 5) * 0.3;
    if (t > 0.5 && !(inBreach(x, 1.02) && hash01(x * 3.3, 2) < 0.6)) {
      const rz = (hash01(x * 5.7, 6) - 0.5) * 0.24;
      const dirX = (hash01(x * 2.9, 7) - 0.5) * 0.16;
      const ch = 0.13 + hash01(x * 4.4, 8) * 0.1;
      add(hash01(x * 6.1, 9) < 0.4 ? 'mossStone' : 'ruinStone',
        plateGeo(cw, ch, WALL.depth * 0.96, { bevel: 0.014, tile: TILE }),
        x + dirX, t + ch / 2 - 0.03, (hash01(x * 1.7, 10) - 0.5) * 0.06, 0.02, 0.03, rz);
    }
    x += cw + 0.03;
  }

  // ------------------------------------------------------------- broken splinters
  // Detached blocks still balanced on the crest / leaning into the breach.
  const shards = [
    [-2.55, 1.44, -0.12, 0.3, 0.2, 0.24, 0.18],
    [-1.55, 2.94, 0.14, 0.42, 0.16, 0.3, -0.3],
    [-0.4, 3.0, -0.05, 0.3, 0.22, 0.22, 0.5],
    [0.75, 2.56, 0.1, 0.34, 0.24, 0.26, 0.7],
    [1.7, 2.02, -0.2, 0.28, 0.2, 0.3, -0.45],
    [2.3, 1.0, 0.24, 0.36, 0.22, 0.24, 0.2],
  ];
  for (let i = 0; i < shards.length; i++) {
    const [sx, sy, sz, sw, sh, sd, tilt] = shards[i];
    block(ctx, add, i % 2 ? 'mossStone' : 'ruinStone', sx, sy, sz, sw, sh, sd, {
      rx: hash01(i, 21) * 0.35, ry: hash01(i, 22) * 0.5, rz: tilt,
    });
  }

  // --------------------------------------------------------- broken teeth
  // Half-height stones still keyed into the crest where the courses dropped away:
  // small vertical spurs that step the outline instead of a clean top line.
  const teeth = [
    [-2.32, 0.16, -0.22], [-1.08, 0.2, 0.18], [-0.62, 0.14, -0.12],
    [0.42, 0.18, 0.24], [1.34, 0.16, -0.18], [2.18, 0.14, 0.12],
  ];
  for (let i = 0; i < teeth.length; i++) {
    const [tx, tw, tz] = teeth[i];
    const ty = topAt(tx) + 0.02;
    const th = 0.2 + hash01(i, 44) * 0.14;
    block(ctx, add, i % 3 === 0 ? 'mossStone' : 'ruinStone', tx, ty - th / 2,
      tz, tw, th, brickD * 0.72,
      { rz: (hash01(i, 45) - 0.5) * 0.16, rx: (hash01(i, 46) - 0.5) * 0.1 });
  }

  // ------------------------------------------------------------------ breach
  // Broken block faces around the breach rim + a dark inner recess, so the hole
  // reads as punched-through masonry rather than a missing chunk in one panel.
  const rim = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    rim.push(a);
  }
  for (const a of rim) {
    const rr = 0.55;
    const bx = 2.06 + Math.cos(a) * rr;
    const by = 1.02 + Math.sin(a) * rr * 1.25;
    if (by < 0.1) continue;
    block(ctx, add, 'mossStone', bx, by, -rowZ - 0.02, 0.2, 0.18, 0.16, {
      rx: 0.2, ry: 0.3, rz: a,
    });
  }
  // the rubble core exposed inside the breach: loose stones packed between the
  // rows, spilling out onto the foot of the wall
  for (let i = 0; i < (preview ? 11 : 5); i++) {
    const bx = 1.62 + hash01(i, 51) * 0.86;
    const by = 0.12 + hash01(i, 52) * 1.3;
    const bz = (hash01(i, 53) - 0.5) * 0.24;
    const r = 0.06 + hash01(i, 54) * 0.09;
    const geo = rockGeo(r, { detail: 0, seed: 200 + i, flatten: 0.72, tile: TILE });
    geo.rotateY(hash01(i, 55) * Math.PI * 2);
    add(i % 3 === 0 ? 'mud' : i % 2 ? 'ruinStoneDark' : 'ruinStone', geo, bx, by, bz);
  }
  // a couple of wedge stones jammed into the breach mouth
  block(ctx, add, 'ruinStone', 1.72, 1.66, -0.16, 0.26, 0.16, 0.2, { rz: 0.55, rx: 0.3 });
  block(ctx, add, 'ruinStoneDark', 2.38, 0.44, 0.14, 0.22, 0.2, 0.18, { rz: -0.4, ry: 0.4 });
  // rubble spilling out of the breach along the front foot
  for (let i = 0; i < 7; i++) {
    const bx = 1.75 + rng() * 0.9;
    const bz = -rowZ - 0.2 - rng() * 0.16;
    groundRock(add, key2(rng), bx, bz, 0.07 + rng() * 0.08, rng, preview);
  }

  // ------------------------------------------------------------------ masonry base
  // A few fallen ashlar blocks banked against the foot of the wall.
  for (let i = 0; i < 7; i++) {
    const bx = (rng() - 0.5) * 4.6;
    if (Math.abs(bx) > 2.8) continue;
    const bz = (rng() < 0.5 ? -1 : 1) * (0.36 + rng() * 0.1);
    fallenBlock(add, rng() < 0.5 ? 'ruinStone' : 'mossStone', bx, bz,
      0.3 + rng() * 0.26, 0.16 + rng() * 0.12, 0.22 + rng() * 0.18,
      rng() * 0.4, rng() * 1.2, (rng() - 0.5) * 0.4);
  }

  // ------------------------------------------------------------- base skirt
  // 0.1–0.25 m berm of broken stone and bare soil where the masonry has sunk into
  // the jungle floor: a continuous low skirt so the wall never stands on a line.
  for (let i = 0; i < (preview ? 5 : 3); i++) {
    const sx = -2.48 + (i / 6) * 4.96 + (hash01(i, 60) - 0.5) * 0.2;
    const sz = (hash01(i, 61) < 0.5 ? -1 : 1) * (0.4 + hash01(i, 62) * 0.16);
    const sw = 0.42 + hash01(i, 63) * 0.26;
    const sh = 0.1 + hash01(i, 64) * 0.13;
    add(i % 3 === 0 ? 'leafLitter' : i % 3 === 1 ? 'mud' : 'mossStone',
      plateGeo(sw, sh, 0.34 + hash01(i, 65) * 0.2, { bevel: 0.012, tile: 1.5 }),
      sx, sh / 2 - 0.02, sz, 0, (hash01(i, 66) - 0.5) * 0.3, (hash01(i, 67) - 0.5) * 0.1);
  }
  for (let i = 0; i < (preview ? 5 : 3); i++) {
    const sx = (hash01(i, 70) - 0.5) * 5.1;
    const sz = (hash01(i, 71) < 0.5 ? -1 : 1) * (0.44 + hash01(i, 72) * 0.16);
    groundRock(add, key2(rng), sx, sz, 0.05 + hash01(i, 73) * 0.07, rng, preview);
  }

  // -------------------------------------------------------------- root system
  // Fig-style roots climbing the front face and wrapping the left end.
  const roots = [
    [[-1.62, 0.02, -0.64], [-1.55, 0.55, -0.66], [-1.68, 1.1, -0.67], [-1.5, 1.6, -0.66], [-1.58, 2.1, -0.65]],
    [[-1.72, 0.02, -0.6], [-1.9, 0.4, -0.64], [-2.05, 0.85, -0.66], [-2.0, 1.25, -0.64], [-2.14, 1.55, -0.62]],
    [[0.9, 0.02, -0.62], [0.98, 0.45, -0.64], [0.88, 0.9, -0.66], [1.02, 1.3, -0.64], [0.95, 1.62, -0.63]],
  ];
  for (const r of roots) {
    const pts = r.map(([px, py, pz]) => new THREE.Vector3(px, py, pz));
    add('barkMoss', tubeGeo(pts, 0.055, { tubularSeg: 14, radialSeg: 5, tile: 1.6 }));
    // root collar where it meets the ground
    add('barkMoss', cylGeo(0.08, 0.11, 0.16, { radial: 8, tile: 1.4 }), r[0][0], 0.08, r[0][2]);
  }

  // -------------------------------------------------------------------- vines
  // Hanging vine curtains spilling over the crest, plus leaf sprigs on the faces.
  const vines = [
    [[-1.35, 2.96, -0.5], [-1.3, 2.6, -0.62], [-1.42, 2.0, -0.6], [-1.36, 1.45, -0.66], [-1.4, 0.95, -0.62], [-1.35, 0.55, -0.64]],
    [[0.28, 2.97, -0.46], [0.36, 2.7, -0.6], [0.3, 2.2, -0.63], [0.4, 1.8, -0.6], [0.34, 1.4, -0.65]],
    [[2.55, 1.24, -0.5], [2.5, 0.9, -0.62], [2.6, 0.6, -0.6], [2.52, 0.3, -0.64]],
  ];
  for (let v = 0; v < vines.length; v++) {
    const pts = vines[v].map(([px, py, pz]) => new THREE.Vector3(px, py, pz));
    add(v < 2 ? 'woodDark' : 'barkMoss', tubeGeo(pts, 0.022, { tubularSeg: 16, radialSeg: 4, tile: 1.2 }));
    // leaf cards along the strand
    for (let k = 1; k < vines[v].length; k++) {
      const [px, py, pz] = vines[v][k];
      const leaf = leafQuad(0.15 + hash01(k + v * 9, 31) * 0.08, 0.12, k % 3 === 0 ? 'broad' : 'vine', {
        droop: 0.02, bend: 0.02,
      });
      add(hash01(k + v * 5, 33) < 0.4 ? 'broadleafDark' : 'broadleaf', leaf,
        px + (hash01(k, 34) - 0.5) * 0.16, py - 0.02, pz - 0.03,
        -0.2 + hash01(k, 35) * 0.4, Math.PI + (hash01(k, 36) - 0.5) * 1.1, hash01(k, 37) * 0.6);
    }
  }

  // --------------------------------------------------------------------- moss
  // Flattened moss banks pressed onto the coping and the lower courses.
  const mossCount = preview ? 14 : 6;
  for (let i = 0; i < mossCount; i++) {
    const mx = (rng() - 0.5) * 5.4;
    const t = topAt(mx);
    const onTop = rng() < 0.62 && t > 0.5;
    const r = 0.1 + rng() * 0.12;
    const geo = rockGeo(r, { detail: 0, seed: 40 + i, flatten: 0.22, tile: 1.6 });
    geo.rotateY(rng() * Math.PI);
    if (onTop) {
      geo.rotateX(rng() * 0.15);
      add('mossStone', geo, mx, t - 0.03, (rng() - 0.5) * 0.5);
    } else {
      geo.rotateX(Math.PI / 2);
      add('mossStone', geo, mx, 0.18 + rng() * 1.7, -WALL.depth / 2 - 0.005 + rng() * 0.02);
    }
  }
  // moss / grime bands in the mortar joints of the lower courses
  for (let i = 0; i < (preview ? 5 : 3); i++) {
    const mx = (rng() - 0.5) * 5.2;
    const my = 0.18 + rng() * 0.9;
    add('mossStone', plateGeo(0.18 + rng() * 0.24, 0.035 + rng() * 0.03, 0.016, { bevel: 0.003, tile: 1.2 }),
      mx, my, -WALL.depth / 2 - 0.006, 0, 0, (rng() - 0.5) * 0.3);
  }

  // ---------------------------------------------- moss tufts in the joints
  // Small cushions growing out of the mortar lines, plus vines' leaf sprigs, so
  // the face is never uniform even between the big moss patches.
  for (let i = 0; i < (preview ? 5 : 3); i++) {
    const mx = -2.55 + hash01(i, 80) * 5.0;
    const my = 0.22 + hash01(i, 81) * 2.2;
    const geo = rockGeo(0.045 + hash01(i, 82) * 0.05, { detail: 0, seed: 300 + i, flatten: 0.3, tile: 1.3 });
    geo.rotateY(hash01(i, 83) * Math.PI);
    add(hash01(i, 84) < 0.5 ? 'mossStone' : 'broadleafDark', geo,
      mx, my, -(WALL.depth / 2) + 0.02, hash01(i, 85) * 0.8, hash01(i, 86) * 2, 0);
  }

  // -------------------------------------------------------------- ground litter
  // Ferns and leaf litter sprouting from the foot, never hanging below the plinth.
  for (let i = 0; i < (preview ? 7 : 3); i++) {
    const fx = (rng() - 0.5) * 4.4;
    const fz = (rng() < 0.5 ? -1 : 1) * (0.42 + rng() * 0.12);
    const n = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const leaf = leafQuad(0.34 + rng() * 0.2, 0.17, 'fern', { bend: 0.06, droop: 0.04 });
      leaf.rotateX(-Math.PI / 2 + (rng() - 0.5) * 0.5);
      leaf.rotateY((k / n) * Math.PI * 2 + rng() * 0.5);
      leaf.rotateZ(rng() * 0.3);
      leaf.computeBoundingBox();
      add(k % 2 ? 'broadleaf' : 'broadleafDark', leaf, fx, 0.012 - leaf.boundingBox.min.y, fz);
    }
  }
  // ferns growing out of the wall's own joints (small, sparse)
  for (let i = 0; i < (preview ? 4 : 2); i++) {
    const fx = -2.3 + hash01(i, 90) * 4.4;
    const fy = 0.42 + hash01(i, 91) * 1.1;
    for (let k = 0; k < 3; k++) {
      const leaf = leafQuad(0.2 + hash01(k, 92) * 0.12, 0.12, 'fern', { bend: 0.04, droop: 0.05 });
      leaf.rotateX(-0.5 + (hash01(k, 93) - 0.5) * 0.5);
      leaf.rotateY(Math.PI + (hash01(k, 94) - 0.5) * 1.2);
      add(k % 2 ? 'broadleaf' : 'broadleafDark', leaf, fx, fy, -WALL.depth / 2 - 0.01,
        0, 0, (hash01(k, 95) - 0.5) * 0.6);
    }
  }
  for (let i = 0; i < (preview ? 4 : 2); i++) {
    const lx = (rng() - 0.5) * 4.6;
    const lz = (rng() < 0.5 ? -1 : 1) * (0.3 + rng() * 0.2);
    add('leafLitter', plateGeo(0.4 + rng() * 0.3, 0.012, 0.3 + rng() * 0.22, { bevel: 0.004, tile: 1.6 }),
      lx, 0.008, lz, 0, rng() * Math.PI, 0);
  }

  void preview;
}

/** Pick a rubble key from the seeded RNG (kept out of the call sites for clarity). */
function key2(rng) {
  const r = rng();
  return r < 0.4 ? 'ruinStoneDark' : r < 0.86 ? 'ruinStone' : 'mossStone';
}

/** Drop a jittered rock so its lowest point rests on y = 0. */
function groundRock(add, key, x, z, r, rng, preview) {
  const detail = preview ? (r > 0.11 ? 1 : 0) : 0;
  const geo = rockGeo(r, { detail, seed: Math.floor(rng() * 1e6), flatten: 0.6, tile: TILE });
  geo.rotateY(rng() * Math.PI * 2);
  geo.rotateZ((rng() - 0.5) * 0.4);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y + 0.002, 0);
  add(key, geo, x, 0, z);
}

/** A bevelled block tipped over on the ground, rotated first so it cannot sink. */
function fallenBlock(add, key, x, z, w, h, d, rx, ry, rz) {
  const bevel = Math.min(0.016, w * 0.22, h * 0.22, d * 0.22);
  const geo = plateGeo(w - 2 * bevel, h - 2 * bevel, d, { bevel, tile: TILE });
  geo.rotateX(rx);
  geo.rotateY(ry);
  geo.rotateZ(rz);
  geo.computeBoundingBox();
  add(key, geo, x, -geo.boundingBox.min.y + 0.002, z);
}








