/**
 * ISLAND RUINS — R4 `ruin-idol` · 断裂石像 (see ISLAND_ASSETS.md §2.3).
 *
 * A half-buried colossal stone bust sinking into the jungle floor: worn pedestal,
 * broad chest with a carved collar, and a tilted head whose features are all cut
 * as geometry — heavy brow ridge, hollowed eye sockets, a flat broken nose, cheek
 * planes, a chipped jaw and a missing wedge of the cranium. Weathering is made of
 * chips, spalls and cracks rather than texture; moss banks and ferns take the
 * monument back.
 *
 * Conventions: metres, +Y up, the face looks toward -Z (the stage FRONT camera),
 * base on y = 0, deterministic `makeRNG`. One hero instance in the model stage;
 * `buildWorld` reads `ctx.data.layout.island.ruinIdols` and no-ops when missing.
 */
import * as THREE from 'three';
import { matrixFor } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { cylGeo, emit, plateGeo, rockGeo, tubeGeo } from '../detail.js';
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

export const meta = { id: 'ruin-idol', kind: 'world', group: 'ruin', label: '断裂石像 · RUIN IDOL' };

const KEY = 'ruinIdols';
/** moss-stone texture module contract: 1 tile = 2 m. */
const TILE = 2.0;
/** Head centre (the whole head assembly is tilted a few degrees around it). */
const HEAD = Object.freeze({ x: 0, y: 2.32, z: 0.04, r: 0.6 });
/** Stone-rich cell of the 2 m mossStone tile (probed from the runtime albedo):
 *  carved faces use it so they read as clean dressed stone, not moss. */
const FACE_UV = [0.292, 0.042];
const FACE_TINT = [1.06, 1.02, 0.97];

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

/** Preview builder (stage/WebUI): one hero instance, then build. */
export function build(ctx) {
  const L = island(ctx);
  L[KEY] = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildRuinIdols(ctx, true);
}

/** Map assembly builder: build every instance from the map layout. */
export function buildWorld(ctx) {
  buildRuinIdols(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildRuinIdols(ctx, preview) {
  const items = island(ctx)[KEY] || [];
  if (!items.length) return;
  for (let i = 0; i < items.length; i++) buildRuinIdol(ctx, items[i], preview, i);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function hash01(n, salt = 0) {
  const v = Math.sin(n * 91.7 + salt * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}

/** Bevelled stone block whose outer size is exactly w × h × d (m). */
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
  // Carved face / chest planes (local z < -0.3) are biased onto a stone-rich cell
  // of the mossStone atlas and tinted a touch brighter, so the features read as
  // clean dressed ashlar against the mossy body instead of disappearing in moss.
  const facePlane = z < -0.3;
  add(key, geo, x, y, z, opts.rx || 0, opts.ry || 0, opts.rz || 0, {
    uvOffset: opts.uvOffset || (facePlane ? FACE_UV : [
      hash01(x * 13.1 + y * 7.7 + z * 2.3, 3),
      hash01(z * 11.3 + y * 5.1 + x * 1.9, 9),
    ]),
    tint: opts.tint || (facePlane && key === 'ruinStone' ? FACE_TINT : null),
  });
}

/** Ground a jittered rock so its lowest point rests at y = 0. */
function groundRock(add, key, x, z, r, rng, preview) {
  const detail = preview ? (r > 0.12 ? 1 : 0) : 0;
  const geo = rockGeo(r, { detail, seed: Math.floor(rng() * 1e6), flatten: 0.62, tile: TILE });
  geo.rotateY(rng() * Math.PI * 2);
  geo.rotateZ((rng() - 0.5) * 0.35);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y + 0.002, 0);
  add(key, geo, x, 0, z);
}

// ---------------------------------------------------------------------------
// the idol
// ---------------------------------------------------------------------------

function buildRuinIdol(ctx, item, preview, index) {
  const rng = makeRNG(4400 + index * 211);
  const s = item.s ?? 1;
  const base = matrixFor(item.x ?? 0, item.y ?? 0, item.z ?? 0, 0, item.ry ?? 0, 0, s, s, s);
  const add = (key, geo, lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0, opts = {}) => {
    prepareTint(geo, lx, ly, lz, key, opts.tint);
    emit(ctx, key, geo, base.clone().multiply(matrixFor(lx, ly, lz, rx, ry, rz)), opts);
  };

  // Tilted head frame: everything inside the head leans a few degrees to the
  // side (long centuries of settling). Head-piece coordinates are LOCAL to HEAD.
  const headRot = new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(-0.055, 0.1, 0.045, 'YXZ'));
  const headPlace = new THREE.Matrix4().makeTranslation(HEAD.x, HEAD.y, HEAD.z);
  // the head is deliberately oversized (colossal head on a small bust)
  const headScale = new THREE.Matrix4().makeScale(1.2, 1.2, 1.2);
  const addHead = (key, geo, lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0, opts) => {
    emit(ctx, key, geo,
      base.clone().multiply(headPlace).multiply(headRot).multiply(headScale)
        .multiply(matrixFor(lx, ly, lz, rx, ry, rz)), opts);
  };

  // ------------------------------------------------------------- buried pedestal
  // Only one corner of the original plinth still breaks the surface.
  block(add, 'ruinStoneDark', -0.1, 0.14, 0.2, 1.62, 0.28, 1.3, { rz: -0.03, rx: 0.02 });
  block(add, 'ruinStone', 0.62, 0.3, 0.15, 0.7, 0.24, 0.9, { rz: 0.06, ry: 0.1 });
  // sunk brow of the plinth (edge stones half swallowed by the soil)
  for (let i = 0; i < 4; i++) {
    block(add, i % 2 ? 'mossStone' : 'ruinStoneDark',
      -0.75 + i * 0.52, 0.1 + hash01(i, 2) * 0.05, -0.72 + hash01(i, 3) * 0.14,
      0.46, 0.2, 0.34, { rz: (hash01(i, 4) - 0.5) * 0.1, ry: (hash01(i, 5) - 0.5) * 0.3 });
  }

  // ---------------------------------------------------------------------- torso
  // Tapering bust: broad sloped shoulders narrowing into the waist, with a carved
  // V-collar band and a sun-disc pendant.
  block(add, 'ruinStone', 0, 0.66, 0.05, 1.34, 0.8, 1.02, { rz: 0.01 });
  for (const sd of [-1, 1]) {
    // sloping shoulder masses
    block(add, sd < 0 ? 'ruinStone' : 'ruinStoneDark',
      sd * 0.72, 0.94, 0.02, 0.66, 0.42, 0.94, { rz: -sd * 0.24, ry: sd * 0.05 });
    block(add, sd < 0 ? 'ruinStoneDark' : 'ruinStone',
      sd * 1.0, 0.82, 0.0, 0.32, 0.34, 0.78, { rz: -sd * 0.34 });
  }
  // broken right shoulder: a chipped-off wedge of the deltoid
  block(add, 'mossStone', 1.06, 0.98, -0.04, 0.26, 0.18, 0.6, { rz: -0.5, rx: 0.2 });
  block(add, 'ruinStoneDark', 0.98, 0.7, -0.2, 0.24, 0.3, 0.4, { rz: 0.4 });
  // upper chest / collar shelf
  block(add, 'ruinStone', 0, 1.14, 0.02, 1.08, 0.22, 0.86, { rz: -0.02 });
  // carved V-collar band down the chest front
  for (const sd of [-1, 1]) {
    block(add, 'ruinStoneDark', sd * 0.2, 1.0, -0.51, 0.08, 0.42, 0.06, { rz: sd * 0.52 });
  }
  // pendant / sun disc set into the chest
  block(add, 'ruinStoneDark', 0, 0.88, -0.52, 0.3, 0.3, 0.1, { rz: Math.PI / 4 });
  block(add, 'ruinStone', 0, 0.88, -0.56, 0.17, 0.17, 0.08, { rz: Math.PI / 4 });
  // weathered chips along the shoulders / chest edges
  for (let i = 0; i < 5; i++) {
    block(add, i % 2 ? 'mossStone' : 'ruinStoneDark',
      -0.95 + hash01(i, 10) * 1.9, 0.92 + hash01(i, 11) * 0.22, -0.42 + hash01(i, 12) * 0.18,
      0.2 + hash01(i, 13) * 0.16, 0.12 + hash01(i, 14) * 0.12, 0.18 + hash01(i, 15) * 0.12,
      { rz: (hash01(i, 16) - 0.5) * 0.7, rx: (hash01(i, 17) - 0.5) * 0.4 });
  }
  // collar rings around the neck
  for (let i = 0; i < 2; i++) {
    const R = i === 0 ? 0.44 : 0.36;
    add(i === 0 ? 'ruinStone' : 'ruinStoneDark',
      new THREE.TorusGeometry(R, 0.05, 4, 12), 0, 1.28 + i * 0.1, 0.02, Math.PI / 2, 0, 0);
  }

  // ----------------------------------------------------------------------- neck
  // Thick neck sunk into the collar (the head sits a touch low, half-buried look).
  add('ruinStone', cylGeo(0.3, 0.34, 0.6, { radial: 12, tile: TILE }), 0, 1.55, 0.02);

  // ----------------------------------------------------------------------- head
  // Colossal carved head assembled from stone blocks. The carved planes PROJECT
  // and RECEDE instead of sitting on one flat sheet: the brow and nose stand
  // proud, the eye sockets and mouth are sunk behind them, so the face reads in
  // silhouette even from the four-view camera.
  block(addHead, 'ruinStone', 0, 0.2, 0.1, 0.98, 0.66, 0.76, { rx: 0.01 });
  // crown / head-dress band
  block(addHead, 'ruinStoneDark', 0, 0.54, 0.04, 1.0, 0.14, 0.78, { rz: -0.02 });
  // back of the skull flattens into a carved head-dress slab
  block(addHead, 'ruinStone', 0, 0.06, 0.42, 0.82, 0.74, 0.16, { rx: -0.05 });
  // missing wedge of the cranium: a jagged bite out of the top-left
  block(addHead, 'ruinStoneDark', -0.36, 0.52, 0.12, 0.34, 0.18, 0.42,
    { rz: 0.42, rx: 0.2, ry: 0.5 });
  for (let i = 0; i < 2; i++) {
    block(addHead, 'ruinStoneDark',
      -0.22 + hash01(i, 23) * 0.42, 0.44 + hash01(i, 24) * 0.07, -0.06 + hash01(i, 25) * 0.34,
      0.16 + hash01(i, 26) * 0.1, 0.05, 0.16,
      { rz: (hash01(i, 27) - 0.5) * 0.3, rx: (hash01(i, 28) - 0.5) * 0.2 });
  }
  // temples / sides of the head
  for (const sd of [-1, 1]) {
    block(addHead, 'ruinStone', sd * 0.47, 0.02, -0.06, 0.2, 0.56, 0.62, { rz: sd * 0.05 });
  }
  // forehead plate
  block(addHead, 'ruinStone', 0, 0.36, -0.42, 0.86, 0.26, 0.2);
  // heavy brow ridge: two chunky slabs meeting over the nose, broken on the left
  for (const sd of [-1, 1]) {
    block(addHead, 'ruinStone', sd * 0.23, 0.18, -0.49, 0.5, 0.17, 0.26,
      { rz: -sd * 0.1, ry: sd * 0.06 });
  }
  block(addHead, 'ruinStoneDark', -0.34, 0.25, -0.42, 0.2, 0.16, 0.2, { rz: 0.55, rx: 0.3 });
  // eye sockets: dark recesses framed by brow above, cheek below, nose and temple
  for (const sd of [-1, 1]) {
    block(addHead, 'dark', sd * 0.23, 0.02, -0.33, 0.36, 0.24, 0.28, { rz: -sd * 0.05 });
    // inner shadow block behind the socket lip: the hole reads 24 cm deep
    block(addHead, 'dark', sd * 0.23, 0.03, -0.2, 0.24, 0.16, 0.18, { rz: -sd * 0.05 });
  }
  // cheekbones project past the sockets
  for (const sd of [-1, 1]) {
    block(addHead, 'ruinStone', sd * 0.33, -0.12, -0.44, 0.3, 0.28, 0.22,
      { rz: sd * 0.14, ry: sd * -0.1 });
  }
  // broad nose rising off the brow; the tip has sheared away
  // triangular nose: a three-sided prism, one flat plane facing the viewer
  {
    const nose = cylGeo(0.05, 0.15, 0.46, { radial: 3, tile: 1.2 });
    nose.rotateY(Math.PI / 6);
    addHead('ruinStone', nose, 0, 0.08, -0.5, 0, 0, 0);
  }
  block(addHead, 'ruinStoneDark', 0, -0.14, -0.47, 0.26, 0.13, 0.2, { rx: 0.4 });
  // mouth: a dark slot under a projecting lip stone
  block(addHead, 'ruinStone', 0, -0.3, -0.45, 0.44, 0.12, 0.2);
  block(addHead, 'dark', 0, -0.38, -0.4, 0.38, 0.1, 0.14);
  // chin + wide jaw, its right corner broken away
  block(addHead, 'ruinStone', -0.04, -0.5, -0.42, 0.52, 0.22, 0.22, { rz: 0.03 });
  block(addHead, 'ruinStone', -0.14, -0.42, -0.1, 0.8, 0.3, 0.6);
  block(addHead, 'ruinStoneDark', 0.36, -0.5, 0.0, 0.3, 0.18, 0.36, { rz: -0.42, rx: 0.3 });
  block(addHead, 'ruinStone', 0.46, -0.6, -0.02, 0.16, 0.12, 0.2, { rz: -0.9 });
  // ears: chipped stone discs
  for (const sd of [-1, 1]) {
    addHead(sd < 0 ? 'mossStone' : 'ruinStone',
      cylGeo(0.16, 0.18, 0.12, { radial: 10, tile: TILE }), sd * 0.5, 0.0, 0.04, 0, 0, Math.PI / 2);
  }
  // two shallow carved lines on the forehead only (no clutter on the face)
  for (let i = 0; i < 2; i++) {
    block(addHead, 'ruinStoneDark', -0.1 + i * 0.2, 0.37, -0.5, 0.05, 0.1, 0.04, { rz: 0.05 });
  }
  // eyebrow ridges sitting proud over the sockets (thin carved fillets)
  for (const sd of [-1, 1]) {
    block(addHead, 'ruinStone', sd * 0.22, 0.11, -0.5, 0.3, 0.06, 0.1,
      { rz: -sd * 0.16 });
  }
  // nose bridge fillet + flared nostril chips
  block(addHead, 'ruinStone', 0, 0.16, -0.52, 0.07, 0.3, 0.08, { rx: 0.02 });
  for (const sd of [-1, 1]) {
    block(addHead, 'ruinStoneDark', sd * 0.14, -0.1, -0.45, 0.08, 0.08, 0.1, { rz: sd * 0.5 });
  }
  // upper lip plate over the mouth slot (the mouth reads as a carved line)
  block(addHead, 'ruinStone', 0, -0.32, -0.49, 0.4, 0.07, 0.12, { rx: 0.06 });
  // chin cleft chip and a chipped jaw angle
  block(addHead, 'ruinStoneDark', 0.02, -0.55, -0.4, 0.1, 0.12, 0.08, { rz: 0.2 });
  block(addHead, 'mossStone', -0.34, -0.56, -0.18, 0.16, 0.14, 0.18, { rz: 0.4, rx: 0.2 });
  // carved pattern band across the brow (incised glyph strokes)
  for (let i = 0; i < 4; i++) {
    block(addHead, i % 2 ? 'ruinStoneDark' : 'ruinStone',
      -0.18 + i * 0.12, 0.42, -0.46, 0.06, 0.08, 0.05, { rz: 0.2 - i * 0.12 });
  }

  // ------------------------------------------------- carved neck / garment detail
  // Incised rings and vertical strokes on the neck, plus a shoulder garment
  // ridge and a spiral motif on the left shoulder.
  for (let i = 0; i < 2; i++) {
    add(i === 0 ? 'ruinStoneDark' : 'ruinStone',
      new THREE.TorusGeometry(0.31 + i * 0.015, 0.028, 4, 10), 0, 1.42 + i * 0.14, 0.02,
      Math.PI / 2, 0, 0);
  }
  for (let i = 0; i < 3; i++) {
    const a = -0.9 + i * 0.9;
    add('ruinStoneDark', plateGeo(0.04, 0.24, 0.02, { bevel: 0.003, tile: 1.0 }),
      Math.cos(a) * 0.3, 1.52, Math.sin(a) * 0.3 + 0.02, 0, a, 0);
  }
  // V-collar band down the chest
  for (const sd of [-1, 1]) {
    block(add, 'ruinStoneDark', sd * 0.19, 1.06, -0.52, 0.07, 0.4, 0.06, { rz: sd * 0.5 });
  }
  // garment fold ridges across the chest
  for (let i = 0; i < 3; i++) {
    block(add, i % 2 ? 'ruinStone' : 'ruinStoneDark', -0.34 + i * 0.34, 0.62 + (i % 2) * 0.1, -0.54,
      0.28, 0.07, 0.06, { rz: (i - 1) * 0.2 });
  }
  // spiral / volute motif carved on the left shoulder
  add('ruinStoneDark', new THREE.TorusGeometry(0.12, 0.024, 4, 8, Math.PI * 1.4),
    -0.78, 1.02, -0.47, 0, 0.3, 0.4);
  add('ruinStone', new THREE.TorusGeometry(0.06, 0.02, 4, 8, Math.PI * 1.4),
    -0.78, 1.02, -0.49, 0, 0.3, 0.4);

  // ------------------------------------------------------------------ weathering
  // Spall chips and hairline cracks read as erosion, kept off the face so the
  // carved features stay readable.
  for (let i = 0; i < (preview ? 12 : 6); i++) {
    const a = 0.6 + hash01(i, 32) * Math.PI * 1.4; // back / sides only
    const px = Math.cos(a) * (0.46 + hash01(i, 33) * 0.05);
    const pz = Math.sin(a) * (0.42 + hash01(i, 34) * 0.05);
    addHead(hash01(i, 35) < 0.5 ? 'ruinStoneDark' : 'mossStone',
      rockGeo(0.07 + hash01(i, 36) * 0.08, { detail: 0, seed: 30 + i, flatten: 0.3, tile: 1.4 }),
      px, 0.02 + hash01(i, 31) * 0.5, pz, hash01(i, 37) * 2, hash01(i, 38) * 2, 0);
  }
  for (let i = 0; i < 3; i++) {
    const a = 0.9 + i * 1.5;
    const pts = [];
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      pts.push(new THREE.Vector3(
        Math.cos(a) * 0.45 * (1 - t * 0.08),
        0.44 - t * 0.8,
        Math.sin(a) * 0.45 * (1 - t * 0.08)));
    }
    addHead('ruinStoneDark', tubeGeo(pts, 0.008, { tubularSeg: 8, radialSeg: 3, tile: 0.8 }));
  }
  // chest cracks
  for (let i = 0; i < 3; i++) {
    add('ruinStoneDark', plateGeo(0.02, 0.3 + hash01(i, 40) * 0.3, 0.012, { bevel: 0.002, tile: 1.0 }),
      -0.4 + i * 0.36, 0.75 + hash01(i, 41) * 0.2, -0.63, 0, 0, (hash01(i, 42) - 0.5) * 0.3);
  }

  // ------------------------------------------------------------------- moss
  // Moss banks settle on upward faces: skull crown (back half only, so the
  // carved face stays readable), shoulders and plinth.
  for (let i = 0; i < (preview ? 14 : 7); i++) {
    const onHead = i < 7;
    const geo = rockGeo(0.1 + hash01(i, 50) * 0.12, { detail: 0, seed: 50 + i, flatten: 0.2, tile: 1.6 });
    geo.rotateY(hash01(i, 51) * Math.PI);
    if (onHead) {
      const a = Math.PI * (0.15 + hash01(i, 52) * 0.7); // rear hemisphere
      const r = hash01(i, 53) * HEAD.r * 0.7;
      addHead('mossStone', geo, Math.cos(a) * r, HEAD.r * (0.8 + hash01(i, 54) * 0.2), Math.sin(a) * r * 0.9);
    } else if (i < 11) {
      add('mossStone', geo, -0.7 + hash01(i, 55) * 1.4, 1.24 + hash01(i, 56) * 0.06, -0.1 + hash01(i, 57) * 0.2);
    } else {
      add('mossStone', geo, -0.75 + hash01(i, 58) * 1.5, 0.26 + hash01(i, 59) * 0.06, -0.5 + hash01(i, 60) * 0.25);
    }
  }

  // ------------------------------------------------------------- ground dressing
  // Rubble ring, ferns and litter so the bust grows straight out of the jungle floor.
  const rockCount = preview ? 12 : 6;
  for (let i = 0; i < rockCount; i++) {
    const a = hash01(i, 65) * Math.PI * 2;
    const dist = 0.85 + hash01(i, 66) * 0.55;
    groundRock(add, i % 3 === 0 ? 'mossStone' : 'ruinStoneDark',
      Math.cos(a) * dist * 0.95, Math.sin(a) * dist * 0.8, 0.09 + hash01(i, 67) * 0.14, rng, preview);
  }
  // fallen chips of the idol's carved surface
  for (let i = 0; i < (preview ? 6 : 3); i++) {
    block(add, i % 2 ? 'ruinStone' : 'ruinStoneDark',
      -0.8 + hash01(i, 70) * 1.6, 0.06 + hash01(i, 71) * 0.04, -0.75 + hash01(i, 72) * 0.4,
      0.16 + hash01(i, 73) * 0.14, 0.1 + hash01(i, 74) * 0.06, 0.12 + hash01(i, 75) * 0.1,
      { rz: (hash01(i, 76) - 0.5) * 0.8, ry: hash01(i, 77) * 1.5 });
  }
  // ferns pushing out of the base
  for (let i = 0; i < (preview ? 5 : 2); i++) {
    const a = hash01(i, 80) * Math.PI * 2;
    const dist = 0.85 + hash01(i, 81) * 0.4;
    const fx = Math.cos(a) * dist * 0.95;
    const fz = Math.sin(a) * dist * 0.85;
    const n = 3 + Math.floor(hash01(i, 82) * 3);
    for (let k = 0; k < n; k++) {
      const leaf = leafQuad(0.34 + hash01(k + i * 5, 83) * 0.2, 0.17, 'fern', { bend: 0.06, droop: 0.04 });
      leaf.rotateX(-Math.PI / 2 + (hash01(k, 84) - 0.5) * 0.5);
      leaf.rotateY((k / n) * Math.PI * 2 + hash01(k, 85) * 0.5);
      leaf.rotateZ(hash01(k, 86) * 0.3);
      leaf.computeBoundingBox();
      add(k % 2 ? 'broadleaf' : 'broadleafDark', leaf, fx, 0.012 - leaf.boundingBox.min.y, fz);
    }
  }
  // leaf litter / bare soil patches
  for (let i = 0; i < (preview ? 4 : 2); i++) {
    add('leafLitter', plateGeo(0.5 + hash01(i, 90) * 0.3, 0.012, 0.38 + hash01(i, 91) * 0.22, { bevel: 0.004, tile: 1.6 }),
      (hash01(i, 92) - 0.5) * 2.0, 0.008, (hash01(i, 93) - 0.5) * 1.6, 0, hash01(i, 94) * Math.PI, 0);
  }
  // ------------------------------------------------------------- half-buried skirt
  // Sand / soil berm and broken stone bedded around the pedestal: the idol is
  // sinking into the jungle floor, not standing on top of it.
  for (let i = 0; i < (preview ? 8 : 4); i++) {
    const a = (i / (preview ? 8 : 4)) * Math.PI * 2 + 0.3;
    const dist = 1.02 + hash01(i, 95) * 0.12;
    const sh = 0.12 + hash01(i, 96) * 0.1;
    add(i % 4 === 0 ? 'beachSand' : i % 4 === 1 ? 'mud' : i % 4 === 2 ? 'leafLitter' : 'mossStone',
      plateGeo(0.42 + hash01(i, 97) * 0.24, sh, 0.3 + hash01(i, 98) * 0.16, { bevel: 0.01, tile: 1.5 }),
      Math.cos(a) * dist, sh / 2 + 0.012, Math.sin(a) * dist,
      0, a, (hash01(i, 99) - 0.5) * 0.06);
  }
  for (let i = 0; i < (preview ? 5 : 3); i++) {
    const a = hash01(i, 100) * Math.PI * 2;
    groundRock(add, i % 2 ? 'mossStone' : 'ruinStoneDark',
      Math.cos(a) * 1.05, Math.sin(a) * 0.95, 0.05 + hash01(i, 101) * 0.06, rng, preview);
  }
}



