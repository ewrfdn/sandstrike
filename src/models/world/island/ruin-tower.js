/**
 * ISLAND RUINS — R3 `ruin-tower` · 崩塌石塔 (see ISLAND_ASSETS.md §2.3).
 *
 * A square volcanic-stone watchtower sheared off diagonally by time: stepped
 * plinth, four ashlar wall faces laid stone by stone, alternating quoin corners,
 * one surviving corner buttress, a collapsed doorway and slit windows that open
 * onto a dark interior, an internal rubble mound, a broken stair stub and vines /
 * ferns spilling out of every crack.
 *
 * Conventions: metres, +Y up, the doorway faces -Z (the stage FRONT camera),
 * base on y = 0, deterministic `makeRNG`. One hero instance in the model stage;
 * `buildWorld` reads `ctx.data.layout.island.ruinTowers` and no-ops when missing.
 */
import * as THREE from 'three';
import { matrixFor } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { emit, plateGeo, rockGeo, tubeGeo } from '../detail.js';
import { leafQuad } from './leaf-atlas.js';

// ---------------------------------------------------------------------------
// vertex-colour tinting
// ---------------------------------------------------------------------------
// The shared stone / soil / timber materials are declared `vertexColors: true`.
// The stage batcher merges every piece of one material key into a single merged
// geometry; a merged geometry WITHOUT a `color` attribute feeds the shader a
// black default, which is why the isolated model stage showed the ruins as
// burnt-black blocks. Every geometry handed to one of these keys therefore gets
// an explicit colour attribute -- a flat per-piece tint that also breaks the
// "one block cloned N times" look. (In-game the batcher re-bakes the attribute
// into its own ground AO, so the geometry-side tint is the stage/authoring fix.)
const VC_KEYS = new Set([
  'mossStone', 'ruinStone', 'ruinStoneDark', 'stone', 'mud', 'leafLitter',
  'beachSand', 'barkMoss', 'barkTrop', 'wood', 'woodDark', 'driftWood',
  'jungleGrass', 'sand', 'sandDark', 'shoreRock',
]);

function vcHash(n, salt = 0) {
  const v = Math.sin(n * 91.7 + salt * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}

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

/** Deterministic per-piece albedo jitter: 0.90...1.08 value + a warm/cool bias. */
function tintAt(x, y, z, key) {
  const n = vcHash(x * 12.7 + y * 7.3 + z * 5.1, 41);
  const w = vcHash(z * 9.3 + x * 3.7 + y * 1.3, 42) - 0.5;
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

export const meta = { id: 'ruin-tower', kind: 'world', group: 'ruin', label: '崩塌石塔 · RUIN TOWER' };

const KEY = 'ruinTowers';
/** moss-stone texture module contract: 1 tile = 2 m. */
const TILE = 2.0;
/** Tower body (m): square footprint, wall thickness, plinth height. */
const TOWER = Object.freeze({ half: 2.45, wall: 0.62, plinth: 0.84, height: 8.8 });
const BASE_Y = TOWER.plinth;

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

/** Preview builder (stage/WebUI): one hero instance, then build. */
export function build(ctx) {
  const L = island(ctx);
  L[KEY] = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildRuinTowers(ctx, true);
}

/** Map assembly builder: build every instance from the map layout. */
export function buildWorld(ctx) {
  buildRuinTowers(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildRuinTowers(ctx, preview) {
  const items = island(ctx)[KEY] || [];
  if (!items.length) return;
  for (let i = 0; i < items.length; i++) buildRuinTower(ctx, items[i], preview, i);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function hash01(n, salt = 0) {
  const v = Math.sin(n * 91.7 + salt * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}

/** Bevelled ashlar block whose outer size is exactly w × h × d (m). */
function block(add, key, x, y, z, w, h, d, opts = {}) {
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

/** Ground a jittered rock so its lowest point rests at y = 0. */
function groundRock(add, key, x, z, r, rng, preview) {
  const detail = preview ? (r > 0.12 ? 1 : 0) : 0;
  const geo = rockGeo(r, { detail, seed: Math.floor(rng() * 1e6), flatten: 0.66, tile: TILE });
  geo.rotateY(rng() * Math.PI * 2);
  geo.rotateZ((rng() - 0.5) * 0.35);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y + 0.002, 0);
  add(key, geo, x, 0, z);
}

/**
 * Four wall faces of the tower. `plane` is the outer wall surface coordinate on
 * the face normal axis; `ry` turns the block's local X axis along the face.
 */
const FACES = Object.freeze([
  { id: 'front', nx: 0, nz: -1, ry: 0, plane: -TOWER.half },
  { id: 'back', nx: 0, nz: 1, ry: 0, plane: TOWER.half },
  { id: 'left', nx: -1, nz: 0, ry: Math.PI / 2, plane: -TOWER.half },
  { id: 'right', nx: 1, nz: 0, ry: Math.PI / 2, plane: TOWER.half },
]);

/** World position of a face point (u along the face, y up). */
function onFace(face, u, y, depth) {
  const off = depth / 2;
  if (face.nx) return { x: face.plane - face.nx * off, y, z: u };
  return { x: u, y, z: face.plane - face.nz * off };
}

/**
 * Collapsed silhouette: back-left corner tall, front-right sheared low, plus a
 * couple of big diagonal bites taken out of the crest so the top is never one
 * clean ramp.
 */
const BITES = Object.freeze([
  { x: -1.5, z: -2.35, r: 1.15, drop: 2.1 }, // main collapsed notch over the entrance
  { x: 1.7, z: 0.6, r: 0.95, drop: 1.3 }, // second bite on the right flank
  { x: -0.4, z: 2.2, r: 0.8, drop: 0.9 }, // rear-left corner nibble
]);
function topAt(x, z) {
  const slope = 6.9 - x * 0.52 + z * 0.62;
  const jitter = Math.sin(x * 2.3 + z * 1.7) * 0.22;
  let top = slope + jitter;
  for (const b of BITES) {
    const d = Math.hypot(x - b.x, z - b.z);
    if (d < b.r) top -= b.drop * (1 - d / b.r);
  }
  // quantise most of the height into broad terraces with broken cliff faces
  // between them: the collapse reads as several collapsed floors, not one ramp
  const terrace = Math.round(top / 0.82) * 0.82;
  top = top * 0.62 + terrace * 0.38;
  return Math.min(TOWER.height, Math.max(2.55, top));
}

/** Door (front face) and window openings, in face-local (u, y) coordinates. */
const DOOR = Object.freeze({ u: -0.35, halfW: 0.62, bottom: BASE_Y, top: BASE_Y + 2.25 });
function windowsFor(face) {
  switch (face.id) {
    case 'front':
      return [
        { u: -1.6, y0: 5.35, y1: 6.45 },
        { u: 1.5, y0: 2.55, y1: 3.55 },
      ];
    case 'back':
      return [
        { u: -1.35, y0: 6.0, y1: 7.05 },
        { u: 1.2, y0: 3.4, y1: 4.4 },
      ];
    case 'left':
      return [
        { u: 0.4, y0: 5.6, y1: 6.65 },
        { u: -1.35, y0: 3.2, y1: 4.2 },
      ];
    case 'right':
    default:
      return [
        { u: 0.3, y0: 3.0, y1: 4.0 },
        { u: -1.5, y0: 5.0, y1: 5.9 },
      ];
  }
}

// ---------------------------------------------------------------------------
// the tower
// ---------------------------------------------------------------------------

function buildRuinTower(ctx, item, preview, index) {
  const rng = makeRNG(3300 + index * 197);
  const s = item.s ?? 1;
  const base = matrixFor(item.x ?? 0, item.y ?? 0, item.z ?? 0, 0, item.ry ?? 0, 0, s, s, s);
  const add = (key, geo, lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0, opts = {}) => {
    prepareTint(geo, lx, ly, lz, key, opts.tint);
    emit(ctx, key, geo, base.clone().multiply(matrixFor(lx, ly, lz, rx, ry, rz)), opts);
  };

  // --------------------------------------------------------------- plinth steps
  // Two worn foundation tiers that step out past the tower footprint, each laid
  // as separate stones around the perimeter (no continuous slab).
  for (let tier = 0; tier < 2; tier++) {
    const y0 = tier * 0.42;
    const half = TOWER.half + 0.3 - tier * 0.12;
    const depth = TOWER.wall + 0.26;
    const th = 0.42;
    for (let f = 0; f < 4; f++) {
      const face = FACES[f];
      for (let k = 0; k < 3; k++) {
        const u = -half + (k + 0.5) * ((half * 2) / 3);
        const off = half - depth / 2;
        const p = face.nx
          ? { x: face.nx * off, y: y0 + th / 2, z: u }
          : { x: u, y: y0 + th / 2, z: face.nz * off };
        block(add, (f + k + tier) % 4 === 0 ? 'mossStone' : 'ruinStoneDark',
          p.x, p.y, p.z, (half * 2) / 3 - 0.03, th - 0.03, depth,
          { ry: face.ry, rz: (hash01(k + f * 3 + tier * 7, 2) - 0.5) * 0.02 });
      }
    }
    // corner stones tie the stepped perimeter together
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        block(add, 'ruinStoneDark', sx * (half - 0.26), y0 + th / 2, sz * (half - 0.26),
          0.58, th - 0.03, 0.58, { rz: (hash01(sx + sz * 3 + tier, 4) - 0.5) * 0.03 });
      }
    }
  }
  // the upper plinth course is broken: two stones have slid off and lie at the
  // foot of the tower, so the base reads as collapsing rather than poured
  block(add, 'ruinStone', TOWER.half + 0.44, 0.16, -1.2, 0.36, 0.18, 0.3, { rz: 0.16, ry: 0.5 });
  block(add, 'ruinStoneDark', TOWER.half + 0.46, 0.15, 0.1, 0.32, 0.15, 0.28, { rz: -0.2, ry: 0.9 });
  block(add, 'mossStone', -TOWER.half - 0.4, 0.16, -1.4, 0.28, 0.16, 0.24, { rz: 0.24, ry: 0.2 });

  // ----------------------------------------------------------------- wall faces
  // Every stone is placed individually in face-local (u, y) space and skipped
  // where the collapsed top line, the doorway or a window cuts through it.
  // Large ashlar blocks: taller courses keep the triangle budget inside the 10k-16k
  // band while giving the tower its cyclopean masonry scale.
  const courseH = 0.54;
  const blockW = 0.92;
  for (let f = 0; f < FACES.length; f++) {
    const face = FACES[f];
    const wins = windowsFor(face);
    const courses = Math.ceil((TOWER.height - BASE_Y) / courseH);
    for (let c = 0; c < courses; c++) {
      const yc = BASE_Y + c * courseH + courseH / 2;
      // stagger the joints per course, different phase on each face
      const phase = ((c % 2) * 0.5 + f * 0.17) * blockW;
      let u = -TOWER.half + 0.02 - phase;
      let guard = 0;
      while (u < TOWER.half - 0.02 && guard++ < 12) {
        const w = blockW - 0.02 + (hash01(u * 7.1 + c * 3.3 + f, 5) - 0.5) * 0.32;
        const u0 = Math.max(-TOWER.half + 0.02, u);
        const u1 = Math.min(TOWER.half - 0.02, u + w);
        u += w;
        if (u1 - u0 < 0.26) continue; // too small a sliver at the corner
        const uc = (u0 + u1) / 2;
        const bw = u1 - u0;
        const p = onFace(face, uc, yc, TOWER.wall);
        if (yc > topAt(p.x, p.z) - 0.06) continue; // sheared-off top
        // doorway (front face only)
        if (face.nx === 0 && face.nz === -1) {
          const d = DOOR;
          if (uc + bw / 2 > d.u - d.halfW && uc - bw / 2 < d.u + d.halfW && yc < d.top) continue;
        }
        // slit windows
        let win = false;
        for (const wn of wins) {
          if (uc + bw / 2 > wn.u - blockW * 0.52 && uc - bw / 2 < wn.u + blockW * 0.52
            && yc > wn.y0 && yc < wn.y1) win = true;
        }
        if (win) continue;
        const mossy = yc < BASE_Y + courseH * 1.6 ? rng() < 0.3
          : yc > topAt(p.x, p.z) - 0.8 ? rng() < 0.45 : rng() < 0.05;
        const key = mossy ? 'mossStone' : rng() < 0.92 ? 'ruinStone' : 'ruinStoneDark';
        block(add, key, p.x, p.y + (rng() - 0.5) * 0.01, p.z,
          bw - 0.03, courseH - 0.03, TOWER.wall - 0.02 + rng() * 0.03,
          { ry: face.ry + (rng() - 0.5) * 0.02, rz: (rng() - 0.5) * 0.02 });
      }
    }
  }

  // ------------------------------------------------------- quoins at the corners
  // Alternating long / short corner stones that lock the four wall faces together.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * (TOWER.half - 0.02);
      const cz = sz * (TOWER.half - 0.02);
      const top = Math.min(topAt(cx, cz), 5.4);
      for (let c = 0; BASE_Y + c * courseH < top - 0.15; c++) {
        const yc = BASE_Y + c * courseH + courseH / 2;
        const long = c % 2 === 0;
        const s = long ? 0.6 : 0.44;
        const off = 0.02 + s / 2 - 0.3;
        const key = (c + (sx > 0 ? 1 : 0) + (sz > 0 ? 2 : 0)) % 5 === 0 ? 'mossStone' : 'ruinStone';
        block(add, key, cx - sx * off, yc, cz - sz * off, s, courseH - 0.03, s,
          { rz: (hash01(c + sx * 7 + sz * 3, 6) - 0.5) * 0.03 });
      }
    }
  }

  // -------------------------------------------------------------- doorway frame
  // Collapsed arched(ish) doorway: threshold, jambs, shattered lintel, dark inside.
  const doorZ = -TOWER.half + 0.04;
  block(add, 'ruinStoneDark', DOOR.u, 0.06, doorZ - TOWER.wall * 0.5, DOOR.halfW * 2 + 0.5, 0.12, TOWER.wall + 0.2);
  for (const sd of [-1, 1]) {
    block(add, 'ruinStone', DOOR.u + sd * (DOOR.halfW + 0.24), DOOR.bottom + 1.1, doorZ,
      0.42, 2.2, 0.3, { rz: sd * 0.01 });
    block(add, 'ruinStoneDark', DOOR.u + sd * (DOOR.halfW + 0.1), DOOR.bottom + 0.55, doorZ - 0.04,
      0.2, 1.1, 0.24);
  }
  // lintel over the door, split and sagging
  for (let i = 0; i < 3; i++) {
    block(add, i === 1 ? 'ruinStoneDark' : 'ruinStone',
      DOOR.u - 0.55 + i * 0.55, DOOR.top + 0.2, doorZ - 0.02,
      0.55, 0.34, 0.36, { rz: (i - 1) * 0.06, rx: (i - 1) * 0.04 });
  }
  // dark material just past the doorway so the threshold reads as a passage
  add('mud', plateGeo(DOOR.halfW * 2 + 0.1, DOOR.top - 0.1, 0.14, { bevel: 0.004, tile: 1.4 }),
    DOOR.u, (DOOR.top + 0.06) / 2, -TOWER.half + TOWER.wall + 0.28);

  // ------------------------------------------------------- window reveals / slits
  for (const face of FACES) {
    for (const wn of windowsFor(face)) {
      // dark backing just inside the wall
      const innerPos = onFace(face, wn.u, (wn.y0 + wn.y1) / 2, TOWER.wall + 0.3);
      add('ruinStoneDark', plateGeo(blockW - 0.02, wn.y1 - wn.y0, 0.16, { bevel: 0.004, tile: 1.2 }),
        innerPos.x, innerPos.y, innerPos.z, 0, face.ry, 0);
      // two dressed reveal blocks narrow the hole into an arrow slit
      for (const sd of [-1, 1]) {
        const p = onFace(face, wn.u + sd * 0.31, (wn.y0 + wn.y1) / 2, TOWER.wall - 0.1);
        block(add, sd < 0 ? 'ruinStone' : 'ruinStoneDark', p.x, p.y, p.z,
          0.32, wn.y1 - wn.y0 - 0.04, 0.24, { ry: face.ry });
        // outer moulded jamb, standing 6 cm proud of the wall face: the slit now
        // has a real outer frame, so it reads as a deep recess from every angle
        const frame = onFace(face, wn.u + sd * 0.46, (wn.y0 + wn.y1) / 2, -0.06);
        block(add, 'ruinStone', frame.x, frame.y, frame.z,
          0.18, wn.y1 - wn.y0 + 0.16, 0.16, { ry: face.ry, rz: sd * 0.02 });
      }
      // lintel + sill
      const top = onFace(face, wn.u, wn.y1 + 0.12, TOWER.wall - 0.02);
      block(add, 'ruinStone', top.x, top.y, top.z, 1.0, 0.22, 0.26, { ry: face.ry });
      const sill = onFace(face, wn.u, wn.y0 - 0.1, TOWER.wall - 0.06);
      block(add, 'ruinStoneDark', sill.x, sill.y, sill.z, 0.92, 0.18, 0.34, { ry: face.ry });
      // a broken sill stone fallen into the recess
      if (hash01(wn.u * 3.1 + wn.y0, 44) < 0.5) {
        block(add, 'ruinStoneDark', sill.x, sill.y + 0.12, sill.z + 0.14,
          0.3, 0.12, 0.18, { rz: 0.3, ry: face.ry + 0.2 });
      }
    }
  }

  // ------------------------------------------------------------- corner buttress
  // One tall corner buttress survives, with a battered (sloped) head; the other
  // corners only keep the scuffed foot of theirs.
  const bt = { x: -TOWER.half - 0.16, z: TOWER.half - 0.2 };
  for (let c = 0; c < 12; c++) {
    const yc = 0.35 + c * courseH;
    const taper = Math.max(0, (c - 7)) * 0.05;
    const w = 0.46 - c * 0.008;
    block(add, rng() < 0.32 ? 'mossStone' : 'ruinStone',
      bt.x - taper * 0.5, yc, bt.z + taper * 0.3, w, courseH - 0.04, 0.46,
      { rz: (rng() - 0.5) * 0.03 });
  }
  block(add, 'ruinStone', bt.x, 5.5, bt.z, 0.5, 0.3, 0.52, { rz: 0.12, rx: 0.1 });
  block(add, 'ruinStoneDark', bt.x + 0.1, 5.78, bt.z - 0.05, 0.34, 0.2, 0.3, { rz: -0.3 });
  // low buttress stubs on the other corners
  block(add, 'ruinStoneDark', TOWER.half + 0.12, 0.42, TOWER.half - 0.25, 0.34, 0.5, 0.9, { rz: 0.05 });
  block(add, 'mossStone', TOWER.half + 0.12, 0.75, TOWER.half - 0.25, 0.3, 0.2, 0.7, { rz: -0.12 });
  // a second, half-collapsed buttress on the front-right corner: five surviving
  // courses with a ragged top, so two of the four corners carry a pier
  const bt2 = { x: TOWER.half + 0.1, z: -TOWER.half - 0.08 };
  for (let c = 0; c < 5; c++) {
    const yc = 0.42 + c * courseH;
    const w = 0.42 - c * 0.015;
    block(add, c % 3 === 1 ? 'mossStone' : 'ruinStone',
      bt2.x - (c > 2 ? 0.05 : 0), yc, bt2.z + (c > 2 ? 0.04 : 0),
      w, courseH - 0.04, 0.42, { rz: (hash01(c, 77) - 0.5) * 0.04 });
  }
  block(add, 'ruinStoneDark', bt2.x - 0.02, 0.42 + 5 * courseH, bt2.z + 0.03, 0.34, 0.2, 0.3,
    { rz: 0.2, rx: 0.14 });

  // --------------------------------------------------------------- stair stub
  // A broken external flight climbs the left face and ends in mid-air.
  for (let i = 0; i < 7; i++) {
    const y = 0.3 + i * 0.28;
    const wy = i < 5 ? 0.9 : 0.55;
    block(add, i % 3 === 0 ? 'mossStone' : 'ruinStone',
      -TOWER.half - 0.28, y, 0.9 - i * 0.34, 0.56, 0.2, wy, { rz: (hash01(i, 11) - 0.5) * 0.05 });
    block(add, 'ruinStoneDark', -TOWER.half - 0.06, y - 0.16, 0.9 - i * 0.34, 0.24, 0.18, wy * 0.6);
  }
  // stair cheek wall (broken low)
  for (let i = 0; i < 4; i++) {
    block(add, 'ruinStone', -TOWER.half - 0.52, 0.32 + i * 0.3, 0.95 - i * 0.3, 0.22, 0.28, 0.5,
      { rz: (hash01(i, 12) - 0.5) * 0.06 });
  }

  // ------------------------------------------------------------- top coping
  // Loose coping stones sit exactly on the topmost surviving course of each face
  // (course-aligned so nothing floats above the broken crest).
  for (let f = 0; f < FACES.length; f++) {
    const face = FACES[f];
    const wins = windowsFor(face);
    for (let u = -TOWER.half + 0.34; u < TOWER.half - 0.24; u += 0.62) {
      const p = onFace(face, u, 0, TOWER.wall);
      const top = topAt(p.x, p.z);
      // highest course whose stones are still placed at this (u, top)
      const cTop = Math.floor((top - 0.06 - BASE_Y) / courseH - 0.5);
      if (cTop < 1) continue;
      const yc = BASE_Y + cTop * courseH + courseH / 2;
      if (hash01(u * 5.7 + f * 3.1, 13) < 0.3) continue; // gaps in the crest
      // the top course must actually exist here (no door / window / bite cut it)
      if (hash01(u * 4.3 + f * 1.7, 17) < 0.22) continue;
      if (face.nx === 0 && face.nz === -1) {
        if (u + 0.4 > DOOR.u - DOOR.halfW && u - 0.4 < DOOR.u + DOOR.halfW && yc < DOOR.top) continue;
      }
      let cut = false;
      for (const wn of wins) {
        if (Math.abs(u - wn.u) < blockW * 0.6 && yc > wn.y0 && yc < wn.y1) cut = true;
      }
      if (cut) continue;
      const yTop = BASE_Y + (cTop + 1) * courseH;
      block(add, hash01(u * 2.9 + f, 14) < 0.45 ? 'mossStone' : 'ruinStone',
        p.x, yTop + 0.06, p.z, 0.56, 0.2 + hash01(u + f, 15) * 0.12, TOWER.wall + 0.12,
        { rz: (hash01(u * 3.3 + f, 16) - 0.5) * 0.14 });
    }
  }

  // ------------------------------------------------------------ interior mass
  // The tower is hollow but the inner faces of the wall stones already line it,
  // so only a dark floor + a dark recess past the doorway are needed to stop the
  // interior from blowing out (the broken top stays open sky).
  const innerHalf = TOWER.half - TOWER.wall - 0.04;
  // floor slab so the interior is not the studio backdrop
  add('mud', plateGeo(innerHalf * 2 + 0.1, 0.12, innerHalf * 2 + 0.1, { bevel: 0.005, tile: 1.6 }),
    0, BASE_Y - 0.06, 0);
  // rubble mound inside the tower (partly visible through the doorway)
  const moundCount = preview ? 8 : 5;
  for (let i = 0; i < moundCount; i++) {
    const a = hash01(i, 21) * Math.PI * 2;
    const rr = hash01(i, 22) * (innerHalf - 0.5);
    const mx = Math.cos(a) * rr;
    const mz = Math.sin(a) * rr;
    const r = 0.14 + hash01(i, 23) * 0.3;
    const geo = rockGeo(r, { detail: preview ? 1 : 0, seed: 60 + i, flatten: 0.62, tile: TILE });
    geo.rotateY(hash01(i, 24) * Math.PI * 2);
    geo.computeBoundingBox();
    add(i % 2 ? 'ruinStoneDark' : 'stone', geo, mx, -geo.boundingBox.min.y + BASE_Y + hash01(i, 25) * 0.35, mz);
  }
  // a surviving interior stair stub (angled slabs climbing the back wall)
  for (let i = 0; i < 5; i++) {
    block(add, 'ruinStoneDark', -0.85, BASE_Y + 0.3 + i * 0.34, 1.35 - i * 0.26, 1.5, 0.22, 0.42,
      { rx: 0.16 });
  }
  // collapsed upper floors: broken slab fragments leaning into the shell, plus two
  // charred timber beams still wedged across the void (visible through the top)
  for (let i = 0; i < 4; i++) {
    block(add, i % 2 ? 'ruinStoneDark' : 'ruinStone',
      -1.2 + i * 0.8, BASE_Y + 1.5 + hash01(i, 26) * 1.1, -0.9 + hash01(i, 27) * 1.3,
      0.9 + hash01(i, 28) * 0.5, 0.16, 0.5,
      { rx: 0.3 + hash01(i, 29) * 0.4, rz: (hash01(i, 30) - 0.5) * 0.5 });
  }
  add('woodDark', plateGeo(2.5, 0.14, 0.16, { bevel: 0.012, tile: 1.4 }),
    -0.2, BASE_Y + 3.0, 0.4, 0.12, 0.3, 0.5);
  add('woodDark', plateGeo(2.1, 0.12, 0.14, { bevel: 0.012, tile: 1.4 }),
    0.5, BASE_Y + 3.6, -0.5, -0.2, -0.4, -0.6);

  // ------------------------------------------------------------------- cracks
  // Vertical cracks running down the wall faces (thin dark stone wedges in-joint).
  for (let i = 0; i < (preview ? 7 : 3); i++) {
    const face = FACES[i % FACES.length];
    const u = -TOWER.half + 0.5 + hash01(i, 30) * (TOWER.half * 2 - 1);
    const y0 = BASE_Y + 0.4 + hash01(i, 31) * 3.2;
    const h = 0.5 + hash01(i, 32) * 1.4;
    const p = onFace(face, u, y0 + h / 2, 0.06);
    add('ruinStoneDark', plateGeo(0.05 + hash01(i, 33) * 0.04, h, 0.02, { bevel: 0.003, tile: 1.0 }),
      p.x, p.y, p.z, 0, face.ry, (hash01(i, 34) - 0.5) * 0.12);
  }

  // -------------------------------------------------------------------- vines
  // Long vines spill over the broken crest and hang down the faces, with alpha
  // leaf sprigs; a couple of them drape right across the entrance.
  const vineSeeds = [
    { face: FACES[0], u: 0.55, len: 5.4 },
    { face: FACES[0], u: -1.85, len: 4.2 },
    { face: FACES[0], u: 1.95, len: 3.0 },
    { face: FACES[2], u: 0.2, len: 4.8 },
    { face: FACES[2], u: -1.5, len: 3.4 },
    { face: FACES[1], u: 1.1, len: 3.8 },
    { face: FACES[3], u: -1.2, len: 3.2 },
  ];
  for (let v = 0; v < vineSeeds.length; v++) {
    const vs = vineSeeds[v];
    // p is the point ON the outer wall plane; the vine hangs just outside it
    const p = onFace(vs.face, vs.u, 0, 0);
    const top = topAt(p.x, p.z) - 0.12;
    // never let a vine run into the ground; shorter vines on the low sheared walls
    const len = Math.min(vs.len, Math.max(0.8, top - 0.45));
    const pts = [];
    const steps = 5;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const y = top - t * len;
      const sway = Math.sin(t * 3.1 + v) * 0.16;
      pts.push(new THREE.Vector3(
        p.x + vs.face.nx * (0.1 + sway + t * 0.05), y,
        p.z + vs.face.nz * (0.1 + sway + t * 0.05)));
    }
    add(v % 2 ? 'woodDark' : 'barkMoss', tubeGeo(pts, 0.034, { tubularSeg: 18, radialSeg: 4, tile: 1.2 }));
    for (let k = 1; k <= steps; k++) {
      const q = pts[k];
      // two leaf sprigs per node, alternating cream/dark foliage
      for (let s = 0; s < 2; s++) {
        const leaf = leafQuad(0.22 + hash01(k * 3 + v * 5 + s, 41) * 0.12, 0.17,
          k % 3 === 0 && s === 0 ? 'broad' : 'vine', { bend: 0.02, droop: 0.02 });
        add(hash01(k + v * 3 + s * 7, 42) < 0.4 ? 'broadleafDark' : 'broadleaf', leaf,
          q.x + (hash01(k * 2 + s, 43) - 0.5) * 0.24, q.y - 0.02 - s * 0.06,
          q.z - 0.02 - s * 0.04,
          -0.3 + hash01(k + s, 44) * 0.5, vs.face.ry + Math.PI + (hash01(k, 45) - 0.5) * 1.2,
          hash01(k + s * 3, 46) * 0.8);
      }
    }
  }
  // thick ivy mat climbing one corner
  for (let i = 0; i < (preview ? 16 : 6); i++) {
    const face = FACES[i % 2 === 0 ? 0 : 2];
    const u = -TOWER.half + 0.25 + hash01(i, 50) * 1.5;
    const y = BASE_Y + 0.3 + hash01(i, 51) * 4.2;
    const p = onFace(face, u, y, -0.06);
    const leaf = leafQuad(0.2 + hash01(i, 52) * 0.12, 0.16, 'vine', { bend: 0.03 });
    add(i % 2 ? 'broadleaf' : 'broadleafDark', leaf, p.x, p.y, p.z,
      (hash01(i, 53) - 0.5) * 0.5, face.ry + Math.PI + (hash01(i, 54) - 0.5) * 0.8, hash01(i, 55) * 0.7);
  }

  // --------------------------------------------------------------------- moss
  // Moss capitals sit exactly on the topmost surviving course of a wall (no
  // floating clumps above the sheared crest), plus moss banks in the joints.
  for (let i = 0; i < (preview ? 18 : 8); i++) {
    const face = FACES[i % FACES.length];
    const u = -TOWER.half + 0.25 + hash01(i, 60) * (TOWER.half * 2 - 0.5);
    const p = onFace(face, u, 0, TOWER.wall);
    const top = topAt(p.x, p.z);
    const cTop = Math.floor((top - 0.06 - BASE_Y) / courseH - 0.5);
    if (cTop < 1) continue;
    const yTop = BASE_Y + (cTop + 1) * courseH;
    const geo = rockGeo(0.1 + hash01(i, 61) * 0.12, { detail: 0, seed: 90 + i, flatten: 0.22, tile: 1.6 });
    geo.rotateY(hash01(i, 62) * Math.PI);
    add('mossStone', geo, p.x, yTop + 0.01, p.z);
  }

  // -------------------------------------------------------------- ground rubble
  const rockCount = preview ? 12 : 6;
  for (let i = 0; i < rockCount; i++) {
    const a = hash01(i, 70) * Math.PI * 2;
    const dist = TOWER.half + 0.32 + hash01(i, 71) * 0.42;
    groundRock(add, i % 3 === 0 ? 'mossStone' : 'ruinStoneDark',
      Math.cos(a) * dist, Math.sin(a) * dist, 0.1 + hash01(i, 72) * 0.16, rng, preview);
  }
  // dirt / stone berm skirt hugging the plinth so the tower is bedded into the soil
  for (let i = 0; i < (preview ? 9 : 5); i++) {
    const a = hash01(i, 95) * Math.PI * 2;
    const dist = TOWER.half + 0.24 + hash01(i, 96) * 0.16;
    const sh = 0.11 + hash01(i, 97) * 0.12;
    add(i % 3 === 0 ? 'mud' : i % 3 === 1 ? 'leafLitter' : 'mossStone',
      plateGeo(0.5 + hash01(i, 98) * 0.3, sh, 0.34 + hash01(i, 99) * 0.2, { bevel: 0.012, tile: 1.5 }),
      Math.cos(a) * dist, sh / 2 + 0.015, Math.sin(a) * dist,
      0, a, (hash01(i, 100) - 0.5) * 0.05);
  }
  // fallen blocks and broken dressings around the foot
  for (let i = 0; i < (preview ? 8 : 4); i++) {
    const a = hash01(i, 73) * Math.PI * 2;
    const dist = TOWER.half + 0.2 + hash01(i, 74) * 0.3;
    const geo = plateGeo(0.26 + hash01(i, 75) * 0.24, 0.16 + hash01(i, 76) * 0.1,
      0.2 + hash01(i, 77) * 0.16, { bevel: 0.014, tile: TILE });
    geo.rotateX(hash01(i, 78) * 0.7);
    geo.rotateY(hash01(i, 79) * Math.PI);
    geo.rotateZ((hash01(i, 80) - 0.5) * 0.7);
    geo.computeBoundingBox();
    add(i % 2 ? 'ruinStone' : 'mossStone', geo,
      Math.cos(a) * dist, -geo.boundingBox.min.y + 0.002, Math.sin(a) * dist);
  }
  // ferns and litter at the foot
  for (let i = 0; i < (preview ? 6 : 3); i++) {
    const a = hash01(i, 85) * Math.PI * 2;
    const dist = TOWER.half + 0.35 + hash01(i, 86) * 0.3;
    const fx = Math.cos(a) * dist;
    const fz = Math.sin(a) * dist;
    const n = 3 + Math.floor(hash01(i, 87) * 3);
    for (let k = 0; k < n; k++) {
      const leaf = leafQuad(0.34 + hash01(k + i * 5, 88) * 0.2, 0.17, 'fern', { bend: 0.06, droop: 0.04 });
      leaf.rotateX(-Math.PI / 2 + (hash01(k, 89) - 0.5) * 0.5);
      leaf.rotateY((k / n) * Math.PI * 2 + hash01(k, 90) * 0.5);
      leaf.rotateZ(hash01(k, 91) * 0.3);
      leaf.computeBoundingBox();
      add(k % 2 ? 'broadleaf' : 'broadleafDark', leaf, fx, 0.012 - leaf.boundingBox.min.y, fz);
    }
  }
}




