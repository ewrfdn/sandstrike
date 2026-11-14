/**
 * ISLAND RUINS — R2 `ruin-arch` · 遗迹拱门 (see ISLAND_ASSETS.md §2.3).
 *
 * A half-collapsed ceremonial gate: one pier still full height with its moulded
 * springer capital, the other broken off short, and the arch itself torn open at
 * the crown. The arch soffit is laid from individually cut radial wedge voussoirs
 * (no thin curved sheet); everything else is piled up from bevelled ashlar blocks:
 * staggered pier courses, ring voussoirs (keystone missing), fracture rubble along
 * the torn crown, vines, moss and fallen stone around the foot.
 *
 * Conventions: metres, +Y up, front face toward -Z (the stage FRONT camera),
 * base on y = 0, deterministic `makeRNG`. One hero instance in the model stage;
 * `buildWorld` reads `ctx.data.layout.island.ruinArches` and no-ops when missing.
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

export const meta = { id: 'ruin-arch', kind: 'world', group: 'ruin', label: '遗迹拱门 · RUIN ARCH' };

const KEY = 'ruinArches';
/** moss-stone texture module contract: 1 tile = 2 m. */
const TILE = 2.0;
/** Arch dimensions fed to core.js `archGeometry()` (metres, local space). */
const ARCH = Object.freeze({ span: 5.9, height: 4.2, depth: 1.92, pierW: 0.95, crown: 0.35, segments: 22 });
/** archGeometry buries its base 0.6 m; lift it back so the model stands on y = 0. */
const LIFT = 0.6;
/** World-space arch geometry (after LIFT): opening radius / springing / crown. */
const RADIUS = ARCH.span / 2 - ARCH.pierW; // 2.0 m
const SPRING = ARCH.height - RADIUS + LIFT; // 2.8 m — top of the piers
const CROWN = SPRING + RADIUS; // 4.8 m — top of the arch ring
/** How far past the crown the surviving vault is allowed to reach (m).
 *  Negative: the vault is torn off just short of the crown, so the crown block
 *  and its keystone are gone — the literal "拱顶缺一块". */
const VAULT_END = -0.12;

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

/** Preview builder (stage/WebUI): one hero instance, then build. */
export function build(ctx) {
  const L = island(ctx);
  L[KEY] = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildRuinArches(ctx, true);
}

/** Map assembly builder: build every instance from the map layout. */
export function buildWorld(ctx) {
  buildRuinArches(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildRuinArches(ctx, preview) {
  const items = island(ctx)[KEY] || [];
  if (!items.length) return;
  for (let i = 0; i < items.length; i++) buildRuinArch(ctx, items[i], preview, i);
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

/** Extruded 2D quad/prism along Z — used for the radial voussoirs. */
function prismGeo(pts, depth, tile = TILE) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -depth / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
  return geo;
}

/**
 * Wedge voussoir of the arch ring: a radial stone spanning `a0…a1` between the
 * opening radius and `rOut`, `depth` metres deep in Z. Local origin = arch centre.
 */
function voussoirGeo(rIn, rOut, a0, a1, depth) {
  const pts = [
    [Math.cos(a0) * rIn, Math.sin(a0) * rIn],
    [Math.cos(a0) * rOut, Math.sin(a0) * rOut],
    [Math.cos(a1) * rOut, Math.sin(a1) * rOut],
    [Math.cos(a1) * rIn, Math.sin(a1) * rIn],
  ];
  return prismGeo(pts, depth);
}

/**
/** True when a face point (x, y) sits inside the arch opening, i.e. no masonry. */function inOpening(x, y) {
  if (Math.abs(x) >= RADIUS + 0.04) return false;
  if (y <= 0.06) return false;
  const dy = y - SPRING;
  const halfW = dy > 0 ? Math.sqrt(Math.max(0, RADIUS * RADIUS - dy * dy)) : RADIUS;
  return Math.abs(x) < halfW + 0.04;
}

/** True when (x, y) lies inside the dressed arch ring band (left voussoirs). */
function inRingBand(x, y, rIn = 1.92, rOut = 2.62) {
  const dx = x;
  const dy = y - SPRING;
  const r = Math.hypot(dx, dy);
  return r > rIn && r < rOut && dy > -0.6;
}

/**
 * Broken silhouette of the surviving left wall mass (world coords, m). The wall
 * stands tall over the left pier and the spandrel, then is torn off diagonally
 * right at the arch crown; nothing survives above the springing to the right of
 * the tear.
 */
function wallTop(x) {
  if (x < -2.95) return 4.62;
  if (x < -1.9) return 5.02 + Math.sin((x + 2.6) * 2.0) * 0.05;
  if (x < -0.7) return 4.99 - (x + 1.9) * 0.14;
  if (x < -0.12) return 4.8 - (x + 0.7) * 1.0; // torn diagonal at the crown
  return 0; // torn away: no wall mass right of the crown
}

// ---------------------------------------------------------------------------
// the arch
// ---------------------------------------------------------------------------

function buildRuinArch(ctx, item, preview, index) {
  const rng = makeRNG(2200 + index * 173);
  const s = item.s ?? 1;
  const base = matrixFor(item.x ?? 0, item.y ?? 0, item.z ?? 0, 0, item.ry ?? 0, 0, s, s, s);
  const add = (key, geo, lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0, opts = {}) => {
    prepareTint(geo, lx, ly, lz, key, opts.tint);
    emit(ctx, key, geo, base.clone().multiply(matrixFor(lx, ly, lz, rx, ry, rz)), opts);
  };

  // ------------------------------------------------------- vault of voussoirs
  // The curved soffit is NOT a thin sheet: it is laid from individually cut
  // radial wedge voussoirs (10 stones around the surviving arc × 4 rows through
  // the 1.9 m passage), each with its own radius, depth, rotation jitter and a
  // dark mortar joint. Two stones are missing, which opens the ragged tear.
  const vaultRows = [-0.46, -0.16, 0.16, 0.46];
  const arcN = 12;
  const arcStart = Math.PI;
  const arcSpan = Math.PI * 0.46; // torn off before the crown: the right half is gone
  const vousEnd = [];
  for (let i = 0; i < arcN; i++) {
    if (i === 8 || i === 10) continue; // two missing voussoirs = the break
    const t0 = i / arcN;
    const t1 = (i + 1) / arcN;
    const a0 = arcStart - arcSpan * t0;
    const a1 = arcStart - arcSpan * t1;
    const rIn = RADIUS - 0.01 + (hash01(i, 51) - 0.5) * 0.012;
    const rOut = rIn + 0.32 + hash01(i, 52) * 0.14; // 0.32–0.46 m thick stones
    for (let r = 0; r < vaultRows.length; r++) {
      const depth = 0.34 + hash01(i * 3 + r, 53) * 0.12; // 0.34–0.46 m deep
      const zc = vaultRows[r] + (hash01(i * 5 + r, 54) - 0.5) * 0.05;
      const wob = (hash01(i * 7 + r, 55) - 0.5) * 0.06;
      add((i + r) % 4 === 0 ? 'ruinStoneDark' : 'ruinStone',
        voussoirGeo(rIn, rOut, a0 + wob * 0.5, a1 - wob * 0.5, depth),
        0, SPRING, zc, 0, 0, (hash01(i * 11 + r, 56) - 0.5) * 0.012);
    }
    vousEnd.push({ a0, a1, rIn, rOut });
  }
  // 1–2 cm dark mortar joints between neighbouring voussoirs (sunken slivers)
  for (let j = 1; j < vousEnd.length; j++) {
    const a = (vousEnd[j - 1].a0 + vousEnd[j - 1].a1) / 2;
    const rIn = Math.min(vousEnd[j - 1].rIn, vousEnd[j].rIn);
    const rOut = Math.min(vousEnd[j - 1].rOut, vousEnd[j].rOut) - 0.02;
    for (let r = 0; r < vaultRows.length; r++) {
      add('ruinStoneDark', voussoirGeo(rIn - 0.012, rOut, a - 0.008, a + 0.008, 0.36),
        0, SPRING, vaultRows[r]);
    }
  }
  // jamb lining: the inner faces of the opening, one full-depth dressed stone per
  // course (the arch springing starts exactly on top of these)
  const jambCourses = 7;
  const jambCourseH = SPRING / jambCourses;
  for (let c = 0; c < jambCourses; c++) {
    const yc = c * jambCourseH + jambCourseH / 2;
    for (const sd of [-1, 1]) {
      block(add, c % 4 === 3 ? 'mossStone' : 'ruinStone',
        sd * (RADIUS + 0.11), yc, (rng() - 0.5) * 0.02,
        0.24, jambCourseH - 0.02, 1.9, { rz: (rng() - 0.5) * 0.02 });
    }
  }

  // ------------------------------------------------------------------- piers
  const rowZ = 0.75; // front / back dressing rows sit between z ±0.5 … ±1.0
  const leftPier = { x0: -2.95, x1: -2.02 };
  const rightPier = { x0: 2.02, x1: 2.95 };
  const pierCourses = 7;
  const courseH = SPRING / pierCourses;
  for (let side = -1; side <= 1; side += 2) {
    const zc = side * rowZ;
    // left pier: full height, two staggered blocks per course (joints break)
    for (let c = 0; c < pierCourses; c++) {
      const y0 = c * courseH;
      const yc = y0 + courseH / 2;
      const W = leftPier.x1 - leftPier.x0;
      const split = W * (c % 2 === 0 ? 0.44 : 0.58) + (hash01(c * 7 + side, 1) - 0.5) * 0.08;
      const wA = split - 0.014;
      const wB = W - split - 0.014;
      const xa = leftPier.x0 + wA / 2;
      const xb = leftPier.x0 + split + 0.014 + wB / 2;
      for (const [bx, bw] of [[xa, wA], [xb, wB]]) {
        const mossy = y0 < courseH * 1.5 ? rng() < 0.36 : rng() < 0.07;
        block(add, mossy ? 'mossStone' : rng() < 0.92 ? 'ruinStone' : 'ruinStoneDark',
          bx, yc, zc + (rng() - 0.5) * 0.02, bw - 0.012, courseH - 0.026, 0.48,
          { rz: (rng() - 0.5) * 0.028, ry: (rng() - 0.5) * 0.02 });
      }
    }
    // left pier outer face column (x = -2.9 plane), one full-depth stone per course
    for (let c = 0; c < pierCourses; c++) {
      block(add, c % 4 === 3 ? 'mossStone' : 'ruinStone', -2.9, c * courseH + courseH / 2,
        (rng() - 0.5) * 0.02, 0.2, courseH - 0.03, 1.94, { rz: (rng() - 0.5) * 0.03 });
    }
    // plinth: a slightly wider foundation course under the left pier
    block(add, 'ruinStoneDark', -2.49, 0.11, zc, 1.04, 0.22, 0.52, { rz: (rng() - 0.5) * 0.03 });
    block(add, 'mossStone', -2.49, 0.32, zc, 1.0, 0.2, 0.5, { rz: (rng() - 0.5) * 0.03 });
    // outer foundation stones (kept as separate rubble blocks, not one slab)
    for (let k = 0; k < 3; k++) {
      block(add, k === 1 ? 'mossStone' : 'ruinStoneDark', -2.88, 0.12 + (k % 2) * 0.02,
        -0.62 + k * 0.62 + (rng() - 0.5) * 0.05, 0.24, 0.24, 0.56, { rz: (rng() - 0.5) * 0.05 });
    }

    // ------------------------------------------------ spandrel above the spring
    // triangular wall mass above the extrados, laid in courses that follow the top
    for (let c = 0; c < pierCourses; c++) {
      const y0 = SPRING + c * courseH;
      const yc = y0 + courseH / 2;
      let x = -2.98;
      let guard = 0;
      while (x < -0.15 && guard++ < 16) {
        const w = 0.46 + hash01(x * 5.1 + c, 4) * 0.3;
        const xc = x + w / 2;
        x += w;
        if (inOpening(xc, yc)) continue; // never brick up the arch opening
        if (inRingBand(xc, yc)) continue; // ring stones dress this band
        if (yc > wallTop(xc) - 0.04) continue; // collapsed top
        const mossy = c === 0 && rng() < 0.28 ? true : rng() < 0.05;
        block(add, mossy ? 'mossStone' : rng() < 0.85 ? 'ruinStone' : 'ruinStoneDark',
          xc, yc, zc + (rng() - 0.5) * 0.02, w - 0.024, courseH - 0.028, 0.48,
          { rz: (rng() - 0.5) * 0.035, ry: (rng() - 0.5) * 0.02 });
      }
    }

    // ------------------------------------------------------- right pier stump
    // One pier is broken off low: three ragged courses and a shattered top.
    const stumpTop = 1.36;
    const stumpCourses = Math.ceil(stumpTop / 0.42);
    for (let c = 0; c < stumpCourses; c++) {
      const y0 = c * 0.42;
      const yc = y0 + 0.21;
      const limit = stumpTop - 0.16 + hash01(c * 7 + side, 6) * 0.22;
      for (let k = 0; k < 2; k++) {
        const xa = rightPier.x0 + 0.03 + k * 0.45;
        if (yc > limit) continue;
        block(add, rng() < 0.2 ? 'mossStone' : 'ruinStone', xa + 0.21, yc, zc,
          0.42, 0.39 - rng() * 0.05, 0.48, { rz: (rng() - 0.5) * 0.05, rx: (rng() - 0.5) * 0.03 });
      }
    }
    // right stump outer side column (x = 2.9 plane)
    for (let c = 0; c < stumpCourses; c++) {
      const yc = c * 0.42 + 0.21;
      if (yc > 1.2) continue;
      block(add, 'ruinStone', 2.9, yc, (rng() - 0.5) * 0.02, 0.2, 0.38, 1.9,
        { rz: (rng() - 0.5) * 0.04 });
    }
    // broken crown of the stump: tilted splinters + a little rubble, no flat cap
    for (let k = 0; k < 5; k++) {
      block(add, rng() < 0.5 ? 'ruinStone' : 'ruinStoneDark',
        2.12 + rng() * 0.82, 1.4 + rng() * 0.13, zc + (rng() - 0.5) * 0.2,
        0.2 + rng() * 0.16, 0.12 + rng() * 0.1, 0.24 + rng() * 0.12,
        { rx: 0.2 + rng() * 0.5, ry: (rng() - 0.5) * 0.7, rz: (rng() - 0.5) * 0.7 });
    }
  }

  // ------------------------------------------------------------ dark wall core
  // Cheap shadowed mass between the two dressed faces so no joint looks straight
  // through the structure; it is kept clear of the arch opening so it never shows
  // as a flat black plate inside the passage.
  add('dark', plateGeo(0.5, SPRING - 0.06, 1.84, { bevel: 0.01, tile: 1.6 }), -2.49, (SPRING - 0.06) / 2, 0);
  add('dark', plateGeo(0.55, 1.7, 1.84, { bevel: 0.01, tile: 1.6 }), -2.44, 3.85, 0);
  add('dark', plateGeo(0.5, 1.26, 1.84, { bevel: 0.01, tile: 1.6 }), 2.49, 0.63, 0);

  // --------------------------------------------------------- springer capital
  // Protruding moulded cornice where the arch springs off the left pier: a wide
  // abacus slab plus a chamfered course, on both dressed faces.
  for (const side of [-1, 1]) {
    block(add, 'ruinStone', -2.49, SPRING - 0.09, side * 0.78, 1.03, 0.16, 0.5);
    block(add, 'ruinStoneDark', -2.49, SPRING - 0.2, side * 0.83, 0.94, 0.07, 0.4, { rz: 0.02 });
  }
  // ditto but broken off on the right stump (only a splintered stub remains)
  block(add, 'ruinStone', 2.42, 1.36, -0.5, 0.52, 0.1, 0.42, { rz: 0.18, rx: 0.2, ry: 0.4 });
  block(add, 'ruinStoneDark', 2.62, 1.41, 0.34, 0.34, 0.14, 0.26, { rz: -0.35, rx: 0.35 });

  // ---------------------------------------------- half-collapsed left pier base
  // The footing has burst outward: stones splayed off the plinth with the rubble
  // core exposed between them, so the pier looks undermined rather than boxed in.
  for (let k = 0; k < 4; k++) {
    const sd = k < 2 ? -1 : 1;
    block(add, k % 2 ? 'ruinStoneDark' : 'ruinStone',
      -2.49 + sd * (0.2 + k * 0.05), 0.13 + (k % 2) * 0.06, (k - 1.5) * 0.34,
      0.34 + hash01(k, 60) * 0.16, 0.2, 0.3,
      { rz: sd * (0.12 + hash01(k, 61) * 0.2), rx: (hash01(k, 62) - 0.5) * 0.3 });
  }
  add('mud', plateGeo(0.9, 0.16, 0.5, { bevel: 0.012, tile: 1.4 }), -2.52, 0.08, 0.34,
    0, 0.2, 0);
  for (let k = 0; k < 3; k++) {
    groundRock(add, k === 1 ? 'mossStone' : 'ruinStoneDark',
      -2.9 + hash01(k, 63) * 0.9, -0.2 + hash01(k, 64) * 0.8, 0.06 + hash01(k, 65) * 0.06, rng, preview);
  }

  // -------------------------------------------------- carved capital remnants
  // Moulded cornice bands remain readable where the springer capital survived:
  // a chamfered roll under the abacus plus knocked-off acanthus chips.
  add('ruinStoneDark', new THREE.TorusGeometry(0.52, 0.032, 5, 12), -2.49, SPRING - 0.28, 0.02,
    Math.PI / 2, 0, 0);
  for (let k = 0; k < 4; k++) {
    block(add, k % 2 ? 'mossStone' : 'ruinStone',
      -2.49 + (k % 2 ? 0.42 : -0.42), SPRING - 0.26, (k - 1.5) * 0.36,
      0.18, 0.14, 0.2, { rz: (k % 2 ? -1 : 1) * 0.4, rx: (hash01(k, 66) - 0.5) * 0.4 });
  }
  // a broken capital block lying at the foot of the pier
  block(add, 'ruinStone', -2.1, 0.12, -0.86, 0.38, 0.16, 0.3, { rz: 0.3, ry: 0.5 });
  block(add, 'ruinStoneDark', -1.72, 0.1, -0.92, 0.24, 0.12, 0.2, { rz: -0.5, ry: 0.2 });

  // ------------------------------------------------------------- ring voussoirs
  // Radial wedge stones around the opening on the front and back faces. The ring
  // stops just short of the crown, so the keystone (and the crown beside it) is
  // gone: the surviving half-arch ends in a torn edge.
  const slots = 11;
  const aStart = Math.PI;
  const aEnd = (98 * Math.PI) / 180;
  const dA = (aStart - aEnd) / slots;
  for (let side = -1; side <= 1; side += 2) {
    const zc = side * 0.78;
    for (let i = 0; i < slots; i++) {
      const a0 = aStart - i * dA;
      const a1 = a0 - dA;
      const jitterA = (hash01(i * 3 + side, 12) - 0.5) * 0.012;
      const geo = voussoirGeo(RADIUS - 0.13, 2.47 + hash01(i, 13) * 0.06, a0 - 0.004 + jitterA, a1 + 0.004, 0.44);
      // local origin = arch centre; squeeze each voussoir a touch so joints read
      add(i % 4 === 0 ? 'mossStone' : 'ruinStone', geo, 0, SPRING + (hash01(i, 14) - 0.5) * 0.006, zc,
        (hash01(i, 15) - 0.5) * 0.01, 0, (hash01(i, 16) - 0.5) * 0.01);
    }
    // the torn end of the ring: split voussoirs still keyed to the vault edge
    block(add, 'ruinStone', -0.33, 5.0, zc, 0.26, 0.4, 0.46,
      { rx: 0.2, ry: side * 0.3, rz: -0.42 });
    block(add, 'ruinStoneDark', -0.18, 4.86, zc + side * 0.07, 0.2, 0.24, 0.34,
      { rx: 0.35, ry: 0.4, rz: 0.5 });
  }
  // 1–2 cm sunken joints between the ring voussoirs make the radial bond read
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 1; i < slots; i += 2) {
      const a = aStart - i * dA;
      add('ruinStoneDark', voussoirGeo(RADIUS - 0.135, 2.42, a - 0.007, a + 0.007, 0.45),
        0, SPRING, side * 0.78);
    }
  }
  // fracture face along the torn vault edge at the crown: broken stones jammed in
  // at irregular heights/depths so the tear reads as shattered masonry, not a beam
  for (let k = 0; k < 5; k++) {
    const a = Math.PI / 2 + (0.02 + hash01(k, 19) * 0.18);
    const rr = RADIUS - 0.06 + hash01(k, 24) * 0.16;
    const px = Math.cos(a) * rr;
    const py = SPRING + Math.sin(a) * rr + (hash01(k, 25) - 0.5) * 0.16;
    const pz = -0.82 + k * 0.41 + (hash01(k, 26) - 0.5) * 0.12;
    block(add, k % 2 ? 'ruinStoneDark' : 'ruinStone', px, py, pz,
      0.2 + hash01(k, 27) * 0.14, 0.22 + hash01(k, 20) * 0.18, 0.32 + hash01(k, 28) * 0.14,
      { rx: 0.2 + hash01(k, 21) * 0.4, ry: hash01(k, 22) * 0.9, rz: -0.3 + hash01(k, 23) * 0.5 });
  }

  // -------------------------------------------------------------- top coping
  const crestRng = makeRNG(9100 + index);
  for (let x = -2.78; x < -0.2; x += 0.34) {
    const top = wallTop(x);
    const w = 0.3 + crestRng() * 0.12;
    add(crestRng() < 0.45 ? 'mossStone' : 'ruinStone',
      plateGeo(w, 0.18 + crestRng() * 0.14, 1.98, { bevel: 0.016, tile: TILE }),
      x, top + 0.05, (crestRng() - 0.5) * 0.08, (crestRng() - 0.5) * 0.14, 0, (crestRng() - 0.5) * 0.34);
  }

  // worn flagstones half-sunk into the dirt inside the gate passage (small and
  // irregular, so the floor never reads as a continuous boardwalk / bench top)
  for (let i = 0; i < 4; i++) {
    const px = -1.2 + hash01(i, 25) * 2.4;
    const pz = -0.5 + hash01(i, 26) * 1.0;
    block(add, i % 2 ? 'mossStone' : 'ruinStoneDark', px, 0.035, pz,
      0.5 + hash01(i, 27) * 0.16, 0.07, 0.44 + hash01(i, 28) * 0.16,
      { rz: (hash01(i, 29) - 0.5) * 0.08, ry: (hash01(i, 30) - 0.5) * 0.35 });
  }

  // ------------------------------------------------------------------- rubble
  // Broken voussoir stones from the fallen right-hand half, dropped and half
  // buried around the foot (kept apart so they read as stone, not a bench).
  const rubble = [
    [1.55, -1.02, 0.28, 1.6], [2.15, -0.82, 0.24, 0.4], [1.05, -1.18, 0.2, 2.4],
    [-0.32, -1.2, 0.26, 3.1], [2.55, -0.45, 0.22, 4.2],
  ];
  for (let i = 0; i < rubble.length; i++) {
    const [rx, rz, rr, tilt] = rubble[i];
    const geo = voussoirGeo(rr * 0.34, rr, -0.4, 0.4, rr * 1.5);
    geo.rotateX(1.2 + (hash01(i, 26) - 0.5) * 0.9);
    geo.rotateY(tilt);
    geo.rotateZ((hash01(i, 27) - 0.5) * 0.9);
    geo.computeBoundingBox();
    // sunk a little into the dirt so they never look perched on top of it
    add(i % 2 ? 'ruinStone' : 'ruinStoneDark', geo, rx,
      -geo.boundingBox.min.y - 0.03 + hash01(i, 28) * 0.03, rz);
  }
  const rockCount = preview ? 14 : 7;
  for (let i = 0; i < rockCount; i++) {
    // most stone spilled out from under the collapsed right-hand end
    const spill = hash01(i, 30) < 0.62;
    const rx = spill ? 1.3 + hash01(i, 31) * 1.9 : (hash01(i, 32) - 0.5) * 5.4;
    const rz = spill ? -0.9 - hash01(i, 34) * 0.55 : (hash01(i, 35) < 0.5 ? -1 : 1) * (0.95 + hash01(i, 36) * 0.35);
    groundRock(add, rng() < 0.5 ? 'ruinStoneDark' : 'ruinStone', rx, rz,
      0.1 + hash01(i, 33) * 0.13, rng, preview);
  }
  // collapsed ashlar blocks scattered at the foot
  for (let i = 0; i < (preview ? 8 : 4); i++) {
    fallenBlock(add, i % 2 ? 'ruinStone' : 'mossStone',
      (hash01(i, 40) - 0.5) * 5.2, (hash01(i, 41) < 0.5 ? -1 : 1) * (1.0 + hash01(i, 42) * 0.4),
      0.24 + hash01(i, 43) * 0.2, 0.14 + hash01(i, 44) * 0.12, 0.2 + hash01(i, 45) * 0.16,
      hash01(i, 46) * 0.5, hash01(i, 47) * 1.2, (hash01(i, 48) - 0.5) * 0.4);
  }

  // ------------------------------------------------------------------- vines
  // Hanging vines from the torn crown edge and the surviving crest, plus ivy
  // climbing the left pier.
  const vinePaths = [
    [[-0.08, 4.7, -0.9], [-0.02, 4.2, -1.0], [-0.12, 3.7, -1.02], [-0.05, 3.2, -1.0], [-0.1, 2.7, -1.04], [-0.04, 2.3, -0.98]],
    [[-1.2, 4.86, -1.0], [-1.14, 4.3, -1.04], [-1.26, 3.8, -1.0], [-1.18, 3.3, -1.05], [-1.22, 2.8, -1.0]],
    [[-2.6, 4.95, -1.0], [-2.55, 4.35, -1.04], [-2.65, 3.85, -1.0], [-2.58, 3.3, -1.05], [-2.62, 2.75, -1.0]],
  ];
  for (let v = 0; v < vinePaths.length; v++) {
    const path = vinePaths[v];
    const pts = path.map(([px, py, pz]) => new THREE.Vector3(px, py, pz));
    add(v === 0 ? 'barkMoss' : 'woodDark', tubeGeo(pts, 0.04, { tubularSeg: 16, radialSeg: 5, tile: 1.2 }));
    for (let k = 1; k < path.length; k++) {
      const [px, py, pz] = path[k];
      const leaf = leafQuad(0.2 + hash01(k + v * 7, 50) * 0.1, 0.16, k % 3 === 0 ? 'broad' : 'vine',
        { bend: 0.02, droop: 0.02 });
      add(hash01(k + v * 3, 51) < 0.4 ? 'broadleafDark' : 'broadleaf', leaf,
        px + (hash01(k, 52) - 0.5) * 0.1, py - 0.03, pz - 0.03,
        -0.25 + hash01(k, 53) * 0.5, Math.PI + (hash01(k, 54) - 0.5) * 1.2, hash01(k, 55) * 0.7);
    }
  }
  // a fourth strand drapes right through the gate mouth off the torn crown
  const mouthPath = [[-0.55, 5.15, -0.86], [-0.62, 4.55, -0.8], [-0.52, 3.95, -0.86],
    [-0.6, 3.35, -0.78], [-0.54, 2.9, -0.84]];
  {
    const pts = mouthPath.map(([px, py, pz]) => new THREE.Vector3(px, py, pz));
    add('barkMoss', tubeGeo(pts, 0.035, { tubularSeg: 16, radialSeg: 5, tile: 1.2 }));
    for (let k = 1; k < mouthPath.length; k++) {
      const [px, py, pz] = mouthPath[k];
      const leaf = leafQuad(0.22 + hash01(k, 56) * 0.1, 0.16, k % 2 ? 'vine' : 'broad', { bend: 0.02 });
      add(k % 2 ? 'broadleafDark' : 'broadleaf', leaf, px + 0.05, py - 0.04, pz - 0.04,
        -0.2, Math.PI + (hash01(k, 57) - 0.5) * 1.0, hash01(k, 58) * 0.6);
    }
  }
  // ivy fan climbing the left pier
  for (let i = 0; i < (preview ? 10 : 5); i++) {
    const px = -2.92 + hash01(i, 60) * 0.86;
    const py = 0.4 + hash01(i, 61) * 2.35;
    const leaf = leafQuad(0.17 + hash01(i, 62) * 0.1, 0.14, 'vine', { bend: 0.02 });
    add(i % 2 ? 'broadleaf' : 'broadleafDark', leaf, px, py, -1.03,
      (hash01(i, 63) - 0.5) * 0.5, Math.PI + (hash01(i, 64) - 0.5) * 0.9, hash01(i, 65) * 0.8);
  }

  // -------------------------------------------------------------------- moss
  for (let i = 0; i < (preview ? 16 : 7); i++) {
    const mx = -2.8 + hash01(i, 70) * 2.45;
    const onTop = hash01(i, 71) < 0.55;
    const geo = rockGeo(0.09 + hash01(i, 72) * 0.1, { detail: 0, seed: 70 + i, flatten: 0.2, tile: 1.6 });
    if (onTop) {
      geo.rotateY(hash01(i, 73) * Math.PI);
      add('mossStone', geo, mx, wallTop(mx) + 0.13, (hash01(i, 74) - 0.5) * 1.4);
    } else {
      geo.rotateX(Math.PI / 2);
      add('mossStone', geo, mx, 0.4 + hash01(i, 75) * 2.4, -1.025 + hash01(i, 76) * 0.03);
    }
  }
  // moss / grime in the joints of the lower courses
  for (let i = 0; i < (preview ? 8 : 4); i++) {
    add('mossStone', plateGeo(0.2 + hash01(i, 80) * 0.22, 0.04, 0.016, { bevel: 0.003, tile: 1.2 }),
      -2.7 + hash01(i, 81) * 2.6, 0.2 + hash01(i, 82) * 1.3, -1.012,
      0, 0, (hash01(i, 83) - 0.5) * 0.25);
  }

  // ---------------------------------------------------------- base skirt
  // Low berm of broken stone / bare soil around the foot so the gate grows out of
  // the jungle floor instead of standing on a clean line.
  const skirtCount = preview ? 7 : 4;
  for (let i = 0; i < skirtCount; i++) {
    const sk = -2.64 + (i / (skirtCount - 1)) * 5.28;
    const sz = (hash01(i, 110) < 0.5 ? -1 : 1) * (0.98 + hash01(i, 111) * 0.16);
    const sh = 0.1 + hash01(i, 112) * 0.12;
    add(i % 3 === 0 ? 'mud' : i % 3 === 1 ? 'leafLitter' : 'mossStone',
      plateGeo(0.42 + hash01(i, 113) * 0.3, sh, 0.3 + hash01(i, 114) * 0.18, { bevel: 0.012, tile: 1.5 }),
      sk, sh / 2 - 0.02, sz, 0, (hash01(i, 115) - 0.5) * 0.3, (hash01(i, 116) - 0.5) * 0.1);
  }
  for (let i = 0; i < (preview ? 8 : 4); i++) {
    groundRock(add, i % 3 === 0 ? 'mossStone' : 'ruinStoneDark',
      -2.7 + hash01(i, 120) * 5.4, (hash01(i, 121) < 0.5 ? -1 : 1) * (1.02 + hash01(i, 122) * 0.2),
      0.06 + hash01(i, 123) * 0.07, rng, preview);
  }
  // ---------------------------------------------------------- ground dressing
  for (let i = 0; i < (preview ? 6 : 3); i++) {
    const fx = -2.6 + hash01(i, 90) * 5.4;
    const fz = (hash01(i, 91) < 0.5 ? -1 : 1) * (0.95 + hash01(i, 92) * 0.22);
    const n = 3 + Math.floor(hash01(i, 93) * 3);
    for (let k = 0; k < n; k++) {
      const leaf = leafQuad(0.34 + hash01(k + i * 5, 94) * 0.2, 0.17, 'fern', { bend: 0.06, droop: 0.04 });
      leaf.rotateX(-Math.PI / 2 + (hash01(k, 95) - 0.5) * 0.5);
      leaf.rotateY((k / n) * Math.PI * 2 + hash01(k, 96) * 0.5);
      leaf.rotateZ(hash01(k, 97) * 0.3);
      leaf.computeBoundingBox();
      add(k % 2 ? 'broadleaf' : 'broadleafDark', leaf, fx, 0.012 - leaf.boundingBox.min.y, fz);
    }
  }
  for (let i = 0; i < (preview ? 6 : 3); i++) {
    add('leafLitter', plateGeo(0.42 + hash01(i, 100) * 0.3, 0.012, 0.32 + hash01(i, 101) * 0.24, { bevel: 0.004, tile: 1.6 }),
      (hash01(i, 102) - 0.5) * 5.6, 0.008, (hash01(i, 103) < 0.5 ? -1 : 1) * (0.85 + hash01(i, 104) * 0.35),
      0, hash01(i, 105) * Math.PI, 0);
  }
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







