/**
 * S1 · SHORE ROCKS — wet volcanic outcrop with a carved tide pool (see ISLAND_ASSETS.md §2.4).
 *
 * A small cluster of dark volcanic / pale limestone boulders sitting on damp coral sand:
 * a tall jagged volcanic mass at the back, a pale limestone boulder behind the pool, a
 * shallow tide pool carved into the rock shelf in the foreground (dark wet bowl, still
 * water disc, pale dry rim stones, barnacles), coarse sedge and salt-grass growing out of
 * the cracks and dark wet silt where the stones meet the sand.
 *
 * Authoring notes
 *  - authored on the stage ground plane (y = 0); the map places the whole cluster on the
 *    shoreline height, the model itself never dips below y ≈ -0.03,
 *  - all randomisation is driven by `makeRNG` seeds so the cluster is identical every build,
 *  - wet / dry material split: `mud` = wet dark sand & seaweed, `stoneDark` = wet stone /
 *    pool lining, `shoreRock` = dark dry volcanic stone, `mossStone` = mossy chunks,
 *    `stone` = pale dry limestone / barnacle crust, `beachSand` = dry coral sand.
 */
import * as THREE from 'three';
import { TAU, matrixFor } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import {
  cylGeo,
  sphereGeo,
  latheGeo,
  plateGeo,
  tubeGeo,
} from '../detail.js';
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
  'mossStone', 'ruinStone', 'ruinStoneDark', 'ruinStone', 'mud', 'leafLitter',
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

/** Paint a per-vertex tint from a callback (wet bands / cracks). */
function paintGradient(geo, fn) {
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

export const meta = { id: 'shore-rocks', kind: 'world', group: 'shore', label: '岸礁石群 · SHORE ROCKS' };

/**
 * Smooth-shaded natural boulder.
 *
 * `rockGeo()` in detail.js is a flat-shaded icosahedron, which reads as a low-poly crystal
 * boulder at shore scale. This variant keeps the cheap icosahedron topology but:
 *   - jitters the vertices with position-based noise (duplicate face vertices get the same
 *     offset, so the shell stays closed),
 *   - accumulates AREA-weighted smooth normals per welded position, keeping the shaded
 *     silhouette round while the outline stays chipped,
 *   - maps the shore stone texture spherically so the UVs never stretch over a facet,
 *   - applies non-uniform scale so each block is a distinct squashed / elongated rock.
 */
function smoothRockGeo(r, { detail = 2, seed = 1, flatten = 0.72, tile = 1.0, lump = 0.22, fine = 0.07, sx = 1, sy = 1, sz = 1, facet = 0.55 } = {}) {
  // 2.6x the old 1 m tile: the ashlar joints of the mossStone map stop reading as
  // a brick wall wrapped over a boulder (audit D-09).
  const TILE_SCALE = 2.6;
  const tileU = tile * TILE_SCALE;
  const geo = new THREE.IcosahedronGeometry(r, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const round = (x) => Math.round(x * 1500);
  const keyOf = (x, y, z) => `${round(x)},${round(y)},${round(z)}`;
  // vertex jitter (position based, so shared corners move as one)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n1 = Math.sin(v.x * 2.9 + v.y * 3.3 + v.z * 3.7 + seed * 5.1);
    const n2 = Math.sin(v.x * 13.1 - v.y * 11.7 + v.z * 17.3 + seed * 2.7);
    const n3 = Math.sin(v.x * 33.7 + v.y * 29.1 - v.z * 41.3 + seed * 1.9);
    const k = 1 + n1 * lump * 0.5 + n2 * fine + n3 * fine * 0.45;
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x * sx, v.y * sy * flatten, v.z * sz);
  }
  pos.needsUpdate = true;
  // Blended normals: 62 % area-weighted smooth normal (so the surface reads as one worn
  // stone) + 38 % own face normal (so the facets keep catching the light like broken rock).
  const buckets = new Map();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const faceN = new THREE.Vector3();
  const triCount = pos.count / 3;
  const faces = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const i = t * 3;
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    faceN.crossVectors(ab, ac).normalize();
    faces[t * 3] = faceN.x;
    faces[t * 3 + 1] = faceN.y;
    faces[t * 3 + 2] = faceN.z;
    for (const p of [a, b, c]) {
      const k = keyOf(p.x, p.y, p.z);
      let acc = buckets.get(k);
      if (!acc) {
        acc = new THREE.Vector3();
        buckets.set(k, acc);
      }
      acc.add(faceN);
    }
  }
  const normals = new Float32Array(pos.count * 3);
  const smooth = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    smooth.copy(buckets.get(keyOf(v.x, v.y, v.z))).normalize();
    const t = Math.floor(i / 3);
    const nx = smooth.x * (1 - facet) + faces[t * 3] * facet;
    const ny = smooth.y * (1 - facet) + faces[t * 3 + 1] * facet;
    const nz = smooth.z * (1 - facet) + faces[t * 3 + 2] * facet;
    const inv = 1 / Math.hypot(nx, ny, nz);
    normals[i * 3] = nx * inv;
    normals[i * 3 + 1] = ny * inv;
    normals[i * 3 + 2] = nz * inv;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  // spherical UVs scaled to world metres (texture tile = `tile` metres)
  const uv = geo.attributes.uv;
  const maxY = r * sy * flatten * 1.16;
  // per-boulder UV rotation + offset (seeded), so neighbouring shells never line up
  const uOff = Math.sin(seed * 12.9898) * 0.5 + 0.5;
  const vOff = Math.sin(seed * 78.233) * 0.5 + 0.5;
  const rot = (Math.sin(seed * 39.346) * 0.5 + 0.5) * Math.PI * 2;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  for (let i = 0; i < uv.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x) + rot;
    const u = ((a / (Math.PI * 2) + 0.5) * ((Math.PI * 2 * r) / tileU) + uOff);
    const vv = ((Math.asin(Math.max(-1, Math.min(1, v.y / maxY))) / Math.PI + 0.5) * ((Math.PI * r) / tileU) + vOff);
    uv.setXY(i, u, vv);
  }
  void cosR; void sinR;
  uv.needsUpdate = true;
  return geo;
}

/** Stage preview: sample layout, then one hero cluster. */
export function build(ctx) {
  island(ctx).shoreRocks = [{ x: 0, y: 0, z: 0, ry: 0.15, s: 1 }];
  buildShoreRocks(ctx);
}

/** Map assembly: one cluster per `layout.island.shoreRocks` entry, no-op when absent. */
export function buildWorld(ctx) {
  buildShoreRocks(ctx);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildShoreRocks(ctx) {
  const items = island(ctx).shoreRocks || [];
  if (!items.length) return;
  for (let i = 0; i < items.length; i++) buildCluster(ctx, items[i], i);
}

/** Local-space placement helper: T * R * S, pre-multiplied by the instance transform. */
function placer(ctx, base) {
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const m = new THREE.Matrix4();
  return function add(key, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    e.set(rx, ry, rz, 'YXZ');
    q.setFromEuler(e);
    v.set(x, y, z);
    s.set(sx, sy, sz);
    m.compose(v, q, s);
    m.premultiply(base);
    prepareTint(geo, x, y, z, key);
    ctx.batcher.add(key, geo, m);
    geo.dispose();
  };
}

/**
 * Irregular rock lathe: takes a turned profile and pushes the vertices in / out with a
 * deterministic noise so the "carved basin" does not read as a machined bowl.
 */
function roughLathe(profile, { segments = 26, seed = 1, amp = 0.09, tile = 1.4 } = {}) {
  const geo = latheGeo(profile, { segments, tile });
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const n =
      Math.sin(a * 3.0 + v.y * 7.3 + seed * 2.1) * 0.58 +
      Math.sin(a * 7.7 - v.y * 4.4 + seed * 1.7) * 0.3 +
      Math.sin(a * 13.1 + v.y * 9.1 + seed) * 0.12;
    const k = 1 + n * amp;
    pos.setXYZ(i, v.x * k, v.y + Math.sin(a * 4.3 + seed * 1.9) * 0.012, v.z * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function buildCluster(ctx, item, index) {
  const base = matrixFor(item.x, item.y ?? 0, item.z, 0, item.ry ?? 0, 0, item.s ?? 1);
  const add = placer(ctx, base);
  const rng = makeRNG(4100 + index * 137);

  /** Highest vertex of a boulder shell, so moss / lichen can be placed on its crown. */
  const apexOf = (geo, x, y, z, ry) => {
    const p = geo.attributes.position;
    let best = -Infinity;
    let bx = 0;
    let bz = 0;
    for (let i = 0; i < p.count; i++) {
      const py = p.getY(i);
      if (py > best) {
        best = py;
        bx = p.getX(i);
        bz = p.getZ(i);
      }
    }
    return {
      x: x + bx * Math.cos(ry) + bz * Math.sin(ry),
      y: y + best,
      z: z - bx * Math.sin(ry) + bz * Math.cos(ry),
    };
  };

  /**
   * Boulder. By default its measured lowest vertex sits just under the sand line; `cy`
   * lifts it explicitly so a layer can be embedded in the boulder below. `sx/sy/sz` squash
   * the shell into an irregular slab so no two blocks share the same silhouette.
   */
  const boulder = (key, x, z, r, { detail = 2, flatten = 0.7, seed = 1, sink = 0.03, cy = null, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1, lump = 0.22, facet = 0.55, tile = 1.0 } = {}) => {
    const geo = smoothRockGeo(r, { detail, flatten, seed, sx, sy, sz, lump, facet, tile });
    geo.computeBoundingBox();
    const y = cy === null ? -geo.boundingBox.min.y - sink : cy;
    const crown = apexOf(geo, x, y, z, ry);
    // soaked band: everything below ~0.42 m is darker + a touch cooler; dry stone
    // above the waterline keeps the salt-bleached tone (task item 10 / audit D-28)
    if (key !== 'mud' && key !== 'beachSand') {
      const dry = tintAt(x, y + 0.5, z, key);
      const wetBase = key === 'ruinStoneDark' ? 0.74 : 0.62;
      paintGradient(geo, (vx, vy, vz) => {
        const worldY = vy + y;
        if (worldY > 0.42) return dry;
        const k = Math.max(0, Math.min(1, worldY / 0.42));
        const s = wetBase + k * 0.34;
        return [dry[0] * s, dry[1] * s * 1.01, dry[2] * s * 1.06];
      });
    }
    add(key, geo, x, y, z, rx, ry, rz);
    return crown;
  };
  /** Moss / lichen mat draped over a crown point (sunk so it hugs the stone). */
  const moss = (crown, r, seed) => {
    add('mossStone', smoothRockGeo(r, { detail: 1, flatten: 0.12, seed }), crown.x, crown.y - 0.04, crown.z,
      0, rng() * TAU, 0);
    // a smaller satellite patch breaks the "green pancake" outline
    add('mossStone', smoothRockGeo(r * 0.55, { detail: 0, flatten: 0.14, seed: seed + 40 }),
      crown.x + 0.16 * Math.cos(seed), crown.y - 0.05, crown.z + 0.14 * Math.sin(seed),
      0, rng() * TAU, 0.1);
  };
  /** Thin irregular ground patch (sand / wet silt / algae) — much better than a smooth blob. */
  const patch = (key, x, z, rx, rz, ry, seed) => {
    add(key, smoothRockGeo(1, { detail: 1, flatten: 0.045, seed }), x, 0.012, z, 0, ry, 0, rx, 0.5, rz);
  };

  // ------------------------------------------------------------------ boulders
  // Each mass is a chunky main shell plus 2-3 smaller shells grown into its flanks, so the
  // outline has knolls and shoulders (reef rock) instead of a single round block.
  // A — tall volcanic stack at the back right.
  boulder('shoreRock', -1.28, -0.82, 0.98, { detail: 4, flatten: 0.82, seed: 11, sx: 1.0, sz: 0.9, lump: 0.3, facet: 0.55, tile: 0.72 });
  boulder('shoreRock', -1.3, -0.84, 1.1, { detail: 1, flatten: 0.2, seed: 12, sink: 0.035, sx: 1.2, sz: 1.0, tile: 0.9 });
  boulder('shoreRock', -0.7, -0.34, 0.55, { detail: 1, flatten: 0.6, seed: 13, cy: 0.42, ry: 0.8, sx: 0.9, sz: 1.1, tile: 0.9 });
  boulder('ruinStoneDark', -1.34, -0.86, 0.58, { detail: 1, flatten: 0.55, seed: 14, cy: 1.22, ry: 1.3, tile: 0.85 });
  const crownA = boulder('mossStone', -1.24, -0.78, 0.44, { detail: 1, flatten: 0.4, seed: 15, cy: 1.5, ry: 0.5, tile: 0.85 });
  // B — pale limestone stack behind the pool, warm dry stone above a wet foot.
  boulder('ruinStone', 1.44, 0.7, 0.9, { detail: 3, flatten: 0.75, seed: 21, sx: 0.95, sz: 1.05, lump: 0.28, facet: 0.5, tile: 0.72 });
  boulder('ruinStone', 1.46, 0.72, 0.98, { detail: 1, flatten: 0.16, seed: 22, sink: 0.035, sx: 1.15, sz: 1.0, tile: 0.9 });
  boulder('ruinStone', 1.02, 0.42, 0.6, { detail: 1, flatten: 0.45, seed: 23, cy: 0.42, ry: 0.6, sx: 1.05, sz: 0.9, tile: 0.9 });
  const crownB = boulder('ruinStoneDark', 1.4, 0.68, 0.4, { detail: 1, flatten: 0.5, seed: 24, cy: 1.1, ry: 0.8, tile: 0.85 });
  // C — low wet boulder at the back centre, D — low flat slab at the back right.
  const crownC = boulder('shoreRock', 0.1, 0.9, 0.85, { detail: 2, flatten: 0.5, seed: 31, sx: 1.2, sz: 0.9, lump: 0.26, facet: 0.5, tile: 0.85 });
  boulder('mossStone', 0.16, 0.95, 0.42, { detail: 1, flatten: 0.45, seed: 32, cy: 0.55, ry: 1.3, tile: 0.85 });
  const crownD = boulder('ruinStone', -1.05, 1.12, 0.9, { detail: 2, flatten: 0.35, seed: 41, ry: 0.9, sx: 1.15, sz: 1.0, lump: 0.24, facet: 0.5, tile: 0.85 });
  boulder('ruinStoneDark', -0.86, 1.2, 0.45, { detail: 1, flatten: 0.4, seed: 42, cy: 0.4, ry: 2.4, tile: 0.9 });
  // E — small dark boulder in the near corner, as a foreground silhouette.
  const crownE = boulder('shoreRock', -1.62, -1.12, 0.46, { detail: 1, flatten: 0.55, seed: 51, ry: 1.3, lump: 0.26 });
  boulder('shoreRock', -1.5, -0.96, 0.3, { detail: 1, flatten: 0.5, seed: 52, cy: 0.38, ry: 0.4 });

  // Dark soaked collars hugging the lower third of the big masses: the wet band.
  boulder('mud', -1.3, -0.85, 1.08, { detail: 1, flatten: 0.2, seed: 18, sink: 0.04, sx: 1.24, sz: 1.02 });
  boulder('mud', 1.44, 0.7, 0.96, { detail: 1, flatten: 0.22, seed: 25, sink: 0.04, sx: 1.16, sz: 1.0 });
  boulder('mud', 0.0, 0.9, 0.85, { detail: 1, flatten: 0.16, seed: 26, sink: 0.035, sx: 1.2, sz: 0.92 });

  // Thin dark cracks running down the crevices between the stacked shells, to deepen the
  // block joints without adding geometry noise.
  add('mud', tubeGeo([
    new THREE.Vector3(-1.66, 0.62, -0.9),
    new THREE.Vector3(-1.5, 0.8, -0.66),
    new THREE.Vector3(-1.34, 0.98, -0.44),
  ], 0.018, { tubularSeg: 8, radialSeg: 3, tile: 0.9 }), 0, 0, 0);
  add('mud', tubeGeo([
    new THREE.Vector3(1.82, 0.5, 0.34),
    new THREE.Vector3(1.7, 0.7, 0.5),
    new THREE.Vector3(1.6, 0.88, 0.66),
  ], 0.016, { tubularSeg: 8, radialSeg: 3, tile: 0.9 }), 0, 0, 0);

  // Broken chips that have spalled off A and B and settled on the sand.
  for (let i = 0; i < 5; i++) {
    const a = rng() * TAU;
    const rr = 0.5 + rng() * 0.6;
    const s = 0.12 + rng() * 0.16;
    add(i % 2 ? 'ruinStoneDark' : 'shoreRock', smoothRockGeo(s, { detail: 0, flatten: 0.5, seed: 60 + i }),
      -1.1 + Math.cos(a) * rr, s * 0.45, -0.4 + Math.sin(a) * rr, rng() * 0.4, rng() * TAU, rng() * 0.3);
  }

  // --------------------------------------------------------------- tide pool
  // A shallow basin ringed by irregular wet boulders in the foreground: dark water disc,
  // pale dry rim stones and a dark soaked base (the core wet/dry split of the model).
  const PX = 0.98;
  const PZ = -0.55;
  // low wet rock base the basin is sunk into (stays below the waterline; closes the bowl)
  boulder('ruinStoneDark', PX, PZ, 1.0, { detail: 2, flatten: 0.12, seed: 3, cy: 0.1, ry: 0.6 });
  // dark wet silt lining of the basin: rim -> waterline -> basin floor
  add('mud', roughLathe([
    [0.75, 0.47], [0.7, 0.43], [0.6, 0.37], [0.42, 0.32], [0.1, 0.29],
  ], { segments: 24, seed: 5, amp: 0.14 }), PX, 0, PZ);
  // still water disc — no real water in the model; dark wet silt with a zoomed-up UV reads
  // as a flat, freshly-wet pool surface just under the rim.
  const water = new THREE.CircleGeometry(0.62, 22);
  {
    const uv = water.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3.4, uv.getY(i) * 3.4);
  }
  add('mud', water, PX, 0.345, PZ, -Math.PI / 2, 0, 0);
  // a couple of algae strands drifting at the pool edge (narrow, so they read as weed)
  for (const [ax, az] of [[PX - 0.2, PZ + 0.26], [PX + 0.24, PZ - 0.1]]) {
    add('broadleafDark', leafQuad(0.2, 0.07, 'vine'), ax, 0.35, az, -Math.PI / 2, rng() * TAU, 0);
  }
  // irregular boulder ring around the basin: pale dry limestone on the far side, dark wet
  // stone and moss on the near side. Sizes / heights vary so it never reads as a bowl.
  for (let i = 0; i < 9; i++) {
    const a = 0.2 + (i / 9) * TAU;
    const near = a > 3.1 && a < 5.7;
    const rr = 0.86 + rng() * 0.1;
    const s = near ? 0.24 + rng() * 0.08 : 0.3 + rng() * 0.13;
    const key = near ? (i % 2 ? 'ruinStoneDark' : 'shoreRock') : i % 3 === 0 ? 'mossStone' : 'ruinStone';
    add(key, smoothRockGeo(s, { detail: i === 2 || i === 6 ? 2 : 1, flatten: near ? 0.5 : 0.58, seed: 70 + i }),
      PX + Math.cos(a) * rr, (near ? 0.16 : 0.26) + rng() * 0.07, PZ + Math.sin(a) * rr,
      rng() * 0.3, rng() * TAU, rng() * 0.3);
  }
  // small wet stones right at the waterline
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.5;
    add('ruinStoneDark', smoothRockGeo(0.09 + rng() * 0.04, { detail: 0, flatten: 0.5, seed: 86 + i }),
      PX + Math.cos(a) * 0.72, 0.3 + rng() * 0.03, PZ + Math.sin(a) * 0.72, 0, rng() * TAU, 0);
  }

  // ------------------------------------------------------------ moss & lichen
  moss(crownA, 0.27, 101);
  moss(crownB, 0.22, 102);
  moss(crownC, 0.2, 103);
  moss(crownD, 0.23, 104);
  moss(crownE, 0.16, 105);

  // ------------------------------------------------- wet skirt / wet stone band
  // dark silt patches where the boulders meet the sand (the wet band)
  patch('mud', -1.28, -0.72, 1.28, 1.0, 0.4, 110);
  patch('mud', 1.32, 0.62, 0.9, 0.76, 1.1, 111);
  patch('mud', -1.05, 1.1, 0.88, 0.68, 2.2, 112);
  patch('mud', 1.0, -0.55, 1.1, 0.95, 0.7, 113);
  patch('mud', -1.6, -1.1, 0.55, 0.48, 1.7, 114);
  // pale wet limestone chunks half sunk at the waterline
  for (let i = 0; i < 5; i++) {
    const a = rng() * TAU;
    add(i % 2 ? 'ruinStoneDark' : 'ruinStone', smoothRockGeo(0.18 + rng() * 0.12, { detail: 1, flatten: 0.24, seed: 120 + i }),
      -1.2 + Math.cos(a) * 0.98, 0.05, -0.6 + Math.sin(a) * 0.88, 0, rng() * TAU, 0);
  }

  // ------------------------------------------------------------- sand & puddles
  patch('beachSand', 0.0, -1.55, 1.0, 0.6, 0.3, 140);
  patch('beachSand', -1.9, 0.35, 0.7, 0.55, 1.9, 141);
  patch('beachSand', 1.55, -1.15, 0.6, 0.5, 0.8, 142);
  // small wet puddles on the sand just above the waterline
  for (const [px, pz, pr] of [[0.2, -1.35, 0.22], [1.55, 0.05, 0.17]]) {
    add('mud', new THREE.CircleGeometry(pr, 16), px, 0.036, pz, -Math.PI / 2, 0, 0);
  }

  // -------------------------------------------------------- barnacles & shells
  // barnacle crust mats on the wet lower flanks + individual cone shells on top
  for (let i = 0; i < 4; i++) {
    const a = 1.0 + i * 1.4;
    add('ruinStone', smoothRockGeo(0.14 + rng() * 0.05, { detail: 0, flatten: 0.14, seed: 125 + i }),
      -1.25 + Math.cos(a) * 1.02, 0.2 + rng() * 0.12, -0.8 + Math.sin(a) * 0.98, 0, rng() * TAU, 0);
  }
  const barnacle = (x, y, z, s = 1) => {
    add('ruinStone', cylGeo(0.007 * s, 0.028 * s, 0.02 * s, { radial: 4 }),
      x, y, z, (rng() - 0.5) * 0.5, rng() * TAU, (rng() - 0.5) * 0.5);
  };
  for (let i = 0; i < 6; i++) {
    const a = 1.4 + i * 0.62;
    barnacle(-1.3 + Math.cos(a) * 1.18, 0.1 + rng() * 0.42, -0.82 + Math.sin(a) * 1.15, 0.9 + rng() * 0.6);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.4;
    barnacle(PX + Math.cos(a) * 0.95, 0.3 + rng() * 0.14, PZ + Math.sin(a) * 0.95, 0.8 + rng() * 0.4);
  }
  for (let i = 0; i < 4; i++) {
    const a = 2.2 + i * 0.7;
    barnacle(1.42 + Math.cos(a) * 0.84, 0.1 + rng() * 0.3, 0.72 + Math.sin(a) * 0.82, 0.8 + rng() * 0.4);
  }
  for (let i = 0; i < 3; i++) {
    barnacle(0.1 + (rng() - 0.5) * 0.85, 0.16 + rng() * 0.12, 0.9 + (rng() - 0.5) * 0.55, 0.8 + rng() * 0.3);
  }
  // a few small limpets / shells lying on the wet sand
  for (let i = 0; i < 3; i++) {
    const a = rng() * TAU;
    const rr = 0.5 + rng() * 1.2;
    add('beachSand', cylGeo(0.004, 0.03, 0.018, { radial: 5 }),
      0.1 + Math.cos(a) * rr, 0.035, -0.2 + Math.sin(a) * rr, 1.25 + rng() * 0.3, rng() * TAU, 0);
  }

  // ------------------------------------------------------------------- pebbles
  for (let i = 0; i < 6; i++) {
    const a = rng() * TAU;
    const rr = 0.55 + rng() * 1.0;
    const s = 0.05 + rng() * 0.08;
    add(i % 3 === 0 ? 'ruinStone' : 'ruinStoneDark', smoothRockGeo(s, { detail: 0, flatten: 0.55, seed: 150 + i }),
      Math.cos(a) * rr, s * 0.42, -0.2 + Math.sin(a) * rr, 0, rng() * TAU, 0);
  }

  // -------------------------------------------------------------------- sedge
  // salt-grass / sedge tufts growing out of the cracks between the boulders.
  const _v = new THREE.Vector3();
  const _e = new THREE.Euler();
  const _q = new THREE.Quaternion();
  const blade = (key, cell, x, y, z, len, wid, az, tilt) => {
    const rx = (rng() - 0.5) * 0.35;
    _e.set(rx, az, tilt, 'YXZ');
    _q.setFromEuler(_e);
    _v.set(-len * 0.46, 0, 0).applyQuaternion(_q);
    add(key, leafQuad(len, wid, cell, { bend: 0.05, droop: 0.07 }), x - _v.x, y - _v.y, z - _v.z, rx, az, tilt);
  };
  const tuft = (x, y, z, count, seed) => {
    const r = makeRNG(seed);
    for (let i = 0; i < count; i++) {
      const az = r() * TAU;
      const tilt = 1.02 + r() * 0.5;
      const len = 0.42 + r() * 0.55;
      blade(r() < 0.32 ? 'broadleaf' : 'broadleafDark', r() < 0.68 ? 'banana' : 'fern',
        x + (r() - 0.5) * 0.24, y, z + (r() - 0.5) * 0.24, len, 0.06 + r() * 0.06, az, tilt);
    }
  };
  tuft(-0.45, 0.05, -1.05, 10, 501);  // crack between the tall outcrop and the open sand
  tuft(1.75, 0.08, -1.05, 9, 502);    // beside the pool on the open sand
  tuft(0.55, 0.42, 1.15, 8, 503);     // crevice between the two back boulders
  tuft(-2.05, 0.03, -0.55, 7, 504);   // behind the tall outcrop
  // a little beach morning-glory creeper spilling over the pool rim towards the camera
  for (let i = 0; i < 6; i++) {
    const a = 3.1 + i * 0.34;
    add(i % 2 ? 'broadleaf' : 'broadleafDark', leafQuad(0.28 + rng() * 0.1, 0.19, 'broad'),
      PX + Math.cos(a) * 0.98, 0.48 + (rng() - 0.5) * 0.05, PZ + Math.sin(a) * 0.98,
      -1.2 + rng() * 0.3, a + Math.PI / 2, (rng() - 0.5) * 0.4);
  }

  // --------------------------------------------------------------- seaweed bits
  // dark weed strands washed against the wet rock band
  for (let i = 0; i < 8; i++) {
    const a = 0.2 + rng() * TAU;
    add('broadleafDark', leafQuad(0.32 + rng() * 0.24, 0.1 + rng() * 0.05, 'vine'),
      -0.6 + Math.cos(a) * (0.95 + rng() * 0.7), 0.03 + rng() * 0.05, -0.5 + Math.sin(a) * (0.95 + rng() * 0.7),
      -Math.PI / 2 + (rng() - 0.5) * 0.25, rng() * TAU, (rng() - 0.5) * 0.3);
  }

  // ---------------------------------------------------------------- wood chips
  // a couple of bleached driftwood splinters jammed between the stones
  for (let i = 0; i < 2; i++) {
    const a = rng() * TAU;
    const rr = 0.9 + rng() * 0.8;
    add('driftWood', plateGeo(0.16 + rng() * 0.24, 0.05 + rng() * 0.04, 0.035, { bevel: 0.008, tile: 1 }),
      Math.cos(a) * rr, 0.03 + rng() * 0.025, -0.2 + Math.sin(a) * rr, (rng() - 0.5) * 0.25, rng() * TAU, (rng() - 0.5) * 0.2);
  }

  // ------------------------------------------------------------------- dust
  // dry sand dust banked against the wet base to separate wet and dry bands
  for (let i = 0; i < 4; i++) {
    const a = rng() * TAU;
    const rr = 0.8 + rng() * 0.8;
    add('beachSand', sphereGeo(0.16 + rng() * 0.12, { segW: 10, segH: 8, tile: 2.2 }),
      Math.cos(a) * rr, 0.02, -0.2 + Math.sin(a) * rr, 0, rng() * TAU, 0, 1, 0.2, 1);
  }
}
