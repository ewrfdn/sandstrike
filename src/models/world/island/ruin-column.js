/**
 * ISLAND RUINS — R5 `ruin-column` · 断柱 (see ISLAND_ASSETS.md §2.3, P1).
 *
 * A single ceremonial column snapped off at two thirds of its height: stepped
 * plinth, three fluted drums still standing (the top one sheared diagonally), the
 * carved capital knocked off and lying beside it, and two fallen drums half sunk
 * into the jungle floor. Everything is individually cut stone; moss, ferns and
 * rubble reclaim the base.
 *
 * Conventions: metres, +Y up, front toward -Z, base on y = 0, deterministic
 * `makeRNG`. One hero instance in the model stage; `buildWorld` reads
 * `ctx.data.layout.island.ruinColumns` and no-ops when missing.
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

export const meta = { id: 'ruin-column', kind: 'world', group: 'ruin', label: '断柱 · RUIN COLUMN' };

const KEY = 'ruinColumns';
/** moss-stone texture module contract: 1 tile = 2 m. */
const TILE = 2.0;
/** Shaft radius / drum height / plinth top (m). */
const COL = Object.freeze({ r: 0.34, drum: 0.56, base: 0.46 });

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

/** Preview builder (stage/WebUI): one hero instance, then build. */
export function build(ctx) {
  const L = island(ctx);
  L[KEY] = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildRuinColumns(ctx, true);
}

/** Map assembly builder: build every instance from the map layout. */
export function buildWorld(ctx) {
  buildRuinColumns(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildRuinColumns(ctx, preview) {
  const items = island(ctx)[KEY] || [];
  if (!items.length) return;
  for (let i = 0; i < items.length; i++) buildRuinColumn(ctx, items[i], preview, i);
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

/** Ground a rotated chunk so its lowest point sits on y = 0. */
function ground(add, key, geo, x, z, sink = 0.002) {
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y + sink, 0);
  add(key, geo, x, 0, z);
}

/** Fluted shaft segment: cylinder whose radius is modulated into `flutes` shallow
 *  vertical grooves (4 % deep), so the shaft reads as a carved classical column
 *  instead of a smooth pipe — and at a fraction of the cost of separate ridges. */
function flutedDrumGeo(r, h, flutes = 14) {
  const radial = flutes * 4;
  const geo = new THREE.CylinderGeometry(r * 0.96, r, h, radial, 1, false);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const land = Math.cos(a * flutes) * 0.5 + 0.5; // 1 = arris (land), 0 = groove
    const k = 1 - 0.04 * (1 - land);
    pos.setXYZ(i, v.x * k, v.y, v.z * k);
    // groove floors sit in shadow: bake a little albedo falloff into the colour
    const shade = 0.86 + land * 0.16;
    col[i * 3] = shade;
    col[i * 3 + 1] = shade;
    col[i * 3 + 2] = shade;
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const uv = geo.attributes.uv;
  const circ = Math.PI * 2 * r;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / 1.4, (uv.getY(i) * h) / 1.4);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Stone drum (fluted column segment) standing at (x, z). */
function drum(add, key, x, y, z, h, rng, seed) {
  const r = COL.r + (hash01(seed, 2) - 0.5) * 0.02;
  add(key, flutedDrumGeo(r, h), x, y, z, 0, hash01(seed, 3) * Math.PI, 0, {
    uvOffset: [hash01(seed, 4), hash01(seed, 5)],
  });
  // carved ring at the drum joint (kept within ±10 % of the shaft tone: a near-black
  // band read as tape wrapped round a pipe, see audit D-24)
  add('ruinStoneDark', new THREE.TorusGeometry(r * 0.94, 0.025, 4, 12), x, y + h / 2 - 0.02, z,
    Math.PI / 2, 0, 0);
}

// ---------------------------------------------------------------------------
// the column
// ---------------------------------------------------------------------------

function buildRuinColumn(ctx, item, preview, index) {
  const rng = makeRNG(5500 + index * 229);
  const s = item.s ?? 1;
  const base = matrixFor(item.x ?? 0, item.y ?? 0, item.z ?? 0, 0, item.ry ?? 0, 0, s, s, s);
  const add = (key, geo, lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0, opts = {}) => {
    prepareTint(geo, lx, ly, lz, key, opts.tint);
    emit(ctx, key, geo, base.clone().multiply(matrixFor(lx, ly, lz, rx, ry, rz)), opts);
  };

  // -------------------------------------------------------------------- plinth
  // Two stepped foundation courses, laid stone by stone (the lower one is mostly
  // swallowed by the soil).
  for (let tier = 0; tier < 2; tier++) {
    const half = 0.62 - tier * 0.09;
    const y0 = 0.11 + tier * 0.2;
    const th = 0.2;
    for (let f = 0; f < 4; f++) {
      const a = (f / 4) * Math.PI * 2;
      const nx = Math.round(Math.cos(a));
      const nz = Math.round(Math.sin(a));
      const off = half - 0.11;
      block(add, (f + tier) % 3 === 0 ? 'mossStone' : 'ruinStoneDark',
        nx ? nx * off : 0, y0, nz ? nz * off : 0,
        nx ? 0.22 : half * 2 - 0.02, th, nz ? 0.22 : half * 2 - 0.02,
        { rz: (hash01(f + tier * 3, 6) - 0.5) * 0.03 });
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        block(add, 'ruinStoneDark', sx * (half - 0.13), y0, sz * (half - 0.13), 0.26, th, 0.26,
          { rz: (hash01(sx + sz * 3 + tier, 7) - 0.5) * 0.04 });
      }
    }
  }
  // square plinth slab under the shaft
  block(add, 'ruinStone', 0, COL.base - 0.07, 0, 0.86, 0.14, 0.86, { rz: 0.01 });

  // ---------------------------------------------------------------- standing shaft
  // Three drums still stand; the top one is sheared off diagonally.
  const drumH = COL.drum;
  const shaftDrums = preview ? 3 : 3;
  for (let d = 0; d < shaftDrums; d++) {
    const yc = COL.base + d * drumH + drumH / 2;
    // the 14 vertical flutes are cut into the drum geometry itself (flutedDrumGeo)
    drum(add, 'ruinStone', 0, yc, 0, drumH - 0.015, rng, d + 1);
  }
  // carved base moulding: a torus roll where the shaft meets the plinth
  add('ruinStoneDark', new THREE.TorusGeometry(COL.r + 0.03, 0.035, 4, 12), 0, COL.base + 0.03, 0,
    Math.PI / 2, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    block(add, 'ruinStoneDark', Math.cos(a) * (COL.r + 0.02), COL.base - 0.02, Math.sin(a) * (COL.r + 0.02),
      0.12, 0.08, 0.14, { ry: -a });
  }
  // sheared top: a half drum plus a slanted fracture face
  const topY = COL.base + shaftDrums * drumH;
  drum(add, 'ruinStone', 0, topY + 0.14, 0, 0.28, rng, 9);
  add('ruinStoneDark', cylGeo(COL.r * 0.9, COL.r * 0.98, 0.09, { radial: 12, tile: 1.2 }),
    0, topY + 0.31, 0, 0.34, 0.2, 0);
  block(add, 'ruinStoneDark', 0.12, topY + 0.34, -0.08, 0.22, 0.12, 0.2, { rx: 0.4, rz: 0.5 });
  block(add, 'ruinStone', -0.18, topY + 0.28, 0.06, 0.2, 0.1, 0.18, { rx: -0.3, rz: -0.4 });
  // remnant of the carved capital still bedded on the broken drum: abacus corner,
  // two acanthus chips and a volute fragment
  block(add, 'ruinStone', 0.1, topY + 0.4, 0.02, 0.36, 0.1, 0.34, { rz: 0.1, ry: 0.2 });
  block(add, 'mossStone', -0.16, topY + 0.46, -0.1, 0.2, 0.12, 0.18, { rz: -0.35, rx: 0.2 });
  block(add, 'ruinStoneDark', 0.24, topY + 0.47, 0.12, 0.16, 0.1, 0.14, { rz: 0.5 });
  add('ruinStoneDark', new THREE.TorusGeometry(0.09, 0.022, 4, 8, Math.PI * 1.5),
    -0.2, topY + 0.42, 0.14, 0, 0.4, 0.6);

  // ------------------------------------------------------------------- capital
  // The carved capital was knocked off and lies broken beside the plinth.
  const capAng = 0.7;
  const capX = Math.cos(capAng) * 0.64;
  const capZ = Math.sin(capAng) * 0.52;
  block(add, 'ruinStone', capX, 0.2, capZ, 0.62, 0.2, 0.62, { ry: 0.5, rz: 0.06 });
  block(add, 'ruinStoneDark', capX + 0.1, 0.33, capZ - 0.06, 0.5, 0.12, 0.5, { ry: 0.62, rx: 0.2 });
  block(add, 'ruinStone', capX - 0.34, 0.14, capZ + 0.2, 0.24, 0.16, 0.2, { ry: 0.9, rz: -0.3 });

  // ------------------------------------------------------------ fallen drums
  // Two drums knocked flat; they lean against each other, half sunk in leaf mould.
  const fallen = [
    { ang: 2.5, dist: 0.6, y: 0.31, tilt: 0.04 },
    { ang: 4.1, dist: 0.52, y: 0.3, tilt: -0.06 },
  ];
  for (let i = 0; i < fallen.length; i++) {
    const f = fallen[i];
    const fx = Math.cos(f.ang) * f.dist;
    const fz = Math.sin(f.ang) * f.dist;
    const geo = cylGeo(COL.r * 0.94, COL.r, COL.drum - 0.02, { radial: 12, tile: 1.4 });
    geo.rotateZ(Math.PI / 2);
    geo.rotateY(f.ang + Math.PI / 2 + f.tilt);
    ground(add, i % 2 ? 'mossStone' : 'ruinStone', geo, fx, fz, -0.03);
    // fractured end ring
    const endGeo = cylGeo(COL.r * 0.9, COL.r * 1.0, 0.12, { radial: 12, tile: 1.2 });
    endGeo.rotateZ(Math.PI / 2);
    endGeo.rotateY(f.ang + Math.PI / 2 + f.tilt);
    add('ruinStoneDark', endGeo, fx, f.y + 0.03, fz, 0.28, 0.1, 0.2);
    // the broken end exposes the rough core: jagged chunks around the fracture,
    // so the drum is not a clean cylinder cut
    for (let k = 0; k < 3; k++) {
      const ka = f.ang + (hash01(i * 7 + k, 44) - 0.5) * 1.2;
      const kg = rockGeo(0.07 + hash01(i * 5 + k, 45) * 0.06,
        { detail: 0, seed: 400 + i * 7 + k, flatten: 0.7, tile: TILE });
      kg.rotateY(hash01(i + k, 46) * Math.PI * 2);
      kg.computeBoundingBox();
      kg.translate(0, -kg.boundingBox.min.y + 0.002, 0);
      add(k % 2 ? 'ruinStoneDark' : 'ruinStone', kg,
        fx + Math.cos(ka) * (COL.drum / 2 + 0.02), 0, fz + Math.sin(ka) * (COL.drum / 2 + 0.02));
    }
  }

  // ---------------------------------------------------------------- rubble / moss
  for (let i = 0; i < (preview ? 9 : 5); i++) {
    const a = hash01(i, 20) * Math.PI * 2;
    const dist = 0.55 + hash01(i, 21) * 0.24;
    const r = 0.07 + hash01(i, 22) * 0.1;
    const geo = rockGeo(r, { detail: preview ? 1 : 0, seed: 120 + i, flatten: 0.62, tile: TILE });
    geo.rotateY(hash01(i, 23) * Math.PI * 2);
    geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.min.y + 0.002, 0);
    add(i % 3 === 0 ? 'mossStone' : 'ruinStoneDark', geo, Math.cos(a) * dist, 0, Math.sin(a) * dist);
  }
  // moss caps on the fractured top and on the fallen drums
  for (let i = 0; i < (preview ? 7 : 4); i++) {
    const geo = rockGeo(0.08 + hash01(i, 30) * 0.08, { detail: 0, seed: 30 + i, flatten: 0.22, tile: 1.5 });
    geo.rotateY(hash01(i, 31) * Math.PI);
    if (i < 3) add('mossStone', geo, (hash01(i, 32) - 0.5) * 0.4, topY + 0.2, (hash01(i, 33) - 0.5) * 0.4);
    else add('mossStone', geo, 0.6 - i * 0.22, 0.44, -0.5 + hash01(i, 34) * 0.3);
  }

  // ------------------------------------------------------------ vines / ferns
  // A thin vine climbs the shaft and spills over the broken top.
  const vpts = [];
  for (let k = 0; k <= 5; k++) {
    const t = k / 5;
    vpts.push(new THREE.Vector3(
      Math.cos(t * 2.6 + 0.4) * (COL.r + 0.03),
      COL.base + 0.12 + t * (topY - COL.base + 0.3),
      Math.sin(t * 2.6 + 0.4) * (COL.r + 0.03)));
  }
  add('barkMoss', tubeGeo(vpts, 0.022, { tubularSeg: 16, radialSeg: 4, tile: 1.2 }));
  for (let k = 1; k <= 5; k++) {
    const q = vpts[k];
    const leaf = leafQuad(0.16 + hash01(k, 40) * 0.1, 0.14, k % 2 ? 'vine' : 'broad', { bend: 0.02 });
    add(k % 2 ? 'broadleaf' : 'broadleafDark', leaf, q.x + 0.05, q.y - 0.02, q.z,
      -0.2, hash01(k, 41) * Math.PI * 2, hash01(k, 42) * 0.6);
  }
  // ground ferns at the foot
  for (let i = 0; i < (preview ? 4 : 2); i++) {
    const a = hash01(i, 50) * Math.PI * 2;
    const dist = 0.6 + hash01(i, 51) * 0.24;
    for (let k = 0; k < 3; k++) {
      const leaf = leafQuad(0.3 + hash01(k + i * 3, 52) * 0.16, 0.15, 'fern', { bend: 0.05, droop: 0.03 });
      leaf.rotateX(-Math.PI / 2 + (hash01(k, 53) - 0.5) * 0.5);
      leaf.rotateY((k / 3) * Math.PI * 2 + hash01(k, 54) * 0.4);
      leaf.computeBoundingBox();
      add(k % 2 ? 'broadleaf' : 'broadleafDark', leaf,
        Math.cos(a) * dist, 0.012 - leaf.boundingBox.min.y, Math.sin(a) * dist);
    }
  }
  // leaf litter over the plinth steps
  for (let i = 0; i < (preview ? 3 : 2); i++) {
    add('leafLitter', plateGeo(0.34 + hash01(i, 60) * 0.2, 0.012, 0.26 + hash01(i, 61) * 0.16,
      { bevel: 0.004, tile: 1.4 }),
      (hash01(i, 62) - 0.5) * 1.1, 0.42 + hash01(i, 63) * 0.02, (hash01(i, 64) - 0.5) * 1.0,
      0, hash01(i, 65) * Math.PI, 0);
  }
  // ------------------------------------------------------------- base skull / skirt
  // Low ring of broken stone, soil and sand hugging the plinth, so the column is
  // bedded into the floor rather than balanced on a flat square.
  for (let i = 0; i < (preview ? 6 : 3); i++) {
    const a = (i / 6) * Math.PI * 2 + 0.35;
    const sh = 0.11 + hash01(i, 70) * 0.1;
    add(i % 3 === 0 ? 'mud' : i % 3 === 1 ? 'leafLitter' : 'beachSand',
      plateGeo(0.34 + hash01(i, 71) * 0.2, sh, 0.26 + hash01(i, 72) * 0.16, { bevel: 0.01, tile: 1.4 }),
      Math.cos(a) * 0.72, sh / 2 + 0.012, Math.sin(a) * 0.66, 0, a, (hash01(i, 73) - 0.5) * 0.06);
  }
  for (let i = 0; i < (preview ? 5 : 3); i++) {
    const a = hash01(i, 75) * Math.PI * 2;
    const geo = rockGeo(0.06 + hash01(i, 76) * 0.06, { detail: 0, seed: 500 + i, flatten: 0.66, tile: TILE });
    geo.rotateY(hash01(i, 77) * Math.PI * 2);
    geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.min.y + 0.002, 0);
    add(i % 2 ? 'ruinStoneDark' : 'mossStone', geo, Math.cos(a) * 0.74, 0, Math.sin(a) * 0.68);
  }
  void rng;
}


