/**
 * SANDSTRIKE // ATOLL-09 tropical island ground.
 *
 * Everything the player can reach is a flat y=0 plateau inside the reef ring
 * (`terrain.boundary.radius`); it is wrapped by a sand beach (wetted down to the waterline
 * and dipping under the ocean plane), a sloping sand lagoon bed and the open ocean
 * (island-water.js). A rugged reef-rock belt closes the play ring; every rock is generated
 * *inside* its collider box footprint (`boundarySegments()`), so the visible barrier and the
 * invisible one use the exact same numbers and `map-audit` never reports an air wall.
 *
 * Cheap-but-organic look:
 *   - one merged mesh per material (ground / litter / beach / scatter / lagoon / ridge),
 *   - world-scaled UVs (~4 m per grass tile) so there is no visible texture seam,
 *   - vertex-colour storytelling: jungle litter under trees, trodden trails between the
 *     landmarks, darker wet sand below the tide line, turquoise-to-deep-blue lagoon bed,
 *   - deterministic `valueNoise` patches -?no external assets, no runtime cost.
 *
 * Contract (see ISLAND_MAP_SPEC.md §4.1):
 *   buildIslandTerrain(ctx) -> { ground }
 * `ctx.ground` points at the grass mesh named `ground` (raycasts / floor / bullets).
 */
import * as THREE from 'three';
import { TAU } from '../models/core.js';
import { makeRNG } from '../utils.js';
import { boundarySegments, playRadius } from './island-shape.js';
import { rockGeo, cylGeo } from '../models/world/detail.js';
import { ensureBatches } from './architecture.js';

// --------------------------------------------------------------------------- math bits

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (e0, e1, v) => {
  const t = clamp((v - e0) / (e1 - e0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** Cheap deterministic 2D value noise. */
function hash2(x, y) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
/** 2-octave fractal noise, 0..1. */
function fbm(x, y) {
  return (noise2(x, y) * 0.62 + noise2(x * 2.07 + 5.2, y * 2.07 - 3.1) * 0.38) / 1.0;
}

// ------------------------------------------------------------------ geometry builder

/** Small accumulator that merges many triangles into one indexed BufferGeometry. */
function builder() {
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const builderApi = {
    vert(x, y, z, u, v, c) {
      pos.push(x, y, z);
      uv.push(u, v);
      col.push(c[0], c[1], c[2]);
      return pos.length / 3 - 1;
    },
    tri(a, b, c) {
      idx.push(a, b, c);
    },
    quad(a, b, c, d) {
      idx.push(a, b, c, a, c, d);
    },
    get triangles() {
      return idx.length / 3;
    },
    toGeometry() {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      return geo;
    },
  };
  return builderApi;
}

/**
 * Push an annulus (or disc when `inner` is 0) into a builder.
 * `outer` may be a function of the angle for a naturally irregular rim.
 */
function pushRing(b, { inner, outer, rings, segments, uvTile = 4, y = 0, color, shade }) {
  const rows = [];
  for (let ri = 0; ri <= rings; ri++) {
    const t = ri / rings;
    const row = [];
    for (let si = 0; si <= segments; si++) {
      const angle = (si / segments) * TAU;
      const ro = typeof outer === 'function' ? outer(angle) : outer;
      const radius = inner + (ro - inner) * t;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const height = typeof y === 'function' ? y(radius, x, z, angle) : y;
      const c = color ? color(x, z, radius, angle, height) : [1, 1, 1];
      const u = x / uvTile;
      const v = z / uvTile;
      row.push(b.vert(x, height, z, u, v, c));
    }
    rows.push(row);
  }
  for (let ri = 0; ri < rings; ri++) {
    for (let si = 0; si < segments; si++) {
      const a = rows[ri][si];
      const b1 = rows[ri][si + 1];
      const c = rows[ri + 1][si];
      const d = rows[ri + 1][si + 1];
      // counter-clockwise seen from above (+Y normals, front side up)
      b.tri(a, c, b1);
      b.tri(b1, c, d);
    }
  }
  return rows;
}

/**
 * Push an irregular organic patch (fan of `verts` rim points around a centre) into a
 * builder. Used for leaf-litter patches, sand/grass tongues, wet-sand decals.
 */
function pushPatch(b, { cx, cz, radius, ry = 0, y = 0, verts = 12, wobble = 0.4, uvTile = 3.2, color, seed = 1, squash = 1 }) {
  const rng = makeRNG(seed);
  const cs = Math.cos(ry);
  const sn = Math.sin(ry);
  const center = b.vert(cx, y + 0.001, cz, cx / uvTile, cz / uvTile, color(cx, cz));
  const rim = [];
  for (let i = 0; i < verts; i++) {
    const a = (i / verts) * TAU + rng() * 0.22;
    const r = radius * (1 - wobble * 0.5 + rng() * wobble);
    const lx = Math.sin(a) * r;
    const lz = Math.cos(a) * r * squash;
    const x = cx + lx * cs + lz * sn;
    const z = cz - lx * sn + lz * cs;
    rim.push(b.vert(x, y, z, x / uvTile, z / uvTile, color(x, z)));
  }
  for (let i = 0; i < verts; i++) b.tri(center, rim[(i + 1) % verts], rim[i]);
  return rim;
}

/**
 * Push a whole geometry into a builder, transformed by `matrix`, tinted with one colour.
 * Handles indexed (cylinder / lathe) and non-indexed (rockGeo icosahedron) sources.
 */
function pushGeo(b, geo, matrix, color, uvTile = 1.2) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const start = b.vert(0, 0, 0, 0, 0, color);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    b.vert(v.x, v.y, v.z, v.x / uvTile, v.z / uvTile, color);
  }
  const idx = geo.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      b.tri(start + 1 + idx.getX(i), start + 1 + idx.getX(i + 1), start + 1 + idx.getX(i + 2));
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      b.tri(start + 1 + i, start + 1 + i + 1, start + 1 + i + 2);
    }
  }
  return start;
}

function addMesh(ctx, geo, material, name, { shadows = true, surface = null, cast = false } = {}) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.castShadow = cast;
  mesh.receiveShadow = shadows;
  if (surface) mesh.userData.surface = surface;
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  ctx.disposables.push(geo);
  return mesh;
}

// ------------------------------------------------------------- smooth boulder geometry

/**
 * Smooth-shaded boulder: icosahedron topology with position-based jitter and blended
 * (smooth + facet) normals, so the reef belt reads as weathered rock rather than low-poly
 * crystals. Returns a unit-radius shell (max jitter 1.22) to be scaled by the caller.
 */
function lumpGeo({ detail = 1, seed = 1, flatten = 0.8, amp = 0.26, fine = 0.08, facet = 0.45 } = {}) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const round = (x) => Math.round(x * 1500);
  const keyOf = (x, y, z) => `${round(x)},${round(y)},${round(z)}`;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n1 = Math.sin(v.x * 2.7 + v.y * 3.1 + v.z * 3.9 + seed * 5.3);
    const n2 = Math.sin(v.x * 12.7 - v.y * 11.3 + v.z * 16.7 + seed * 2.9);
    const n3 = Math.sin(v.x * 31.1 + v.y * 27.7 - v.z * 39.3 + seed * 1.7);
    const k = 1 + n1 * amp * 0.5 + n2 * fine + n3 * fine * 0.45;
    const py = v.y * k * flatten;
    // flat-bottomed shells (half-buried boulder) with a strongly blunted crown so the
    // reef reads as weathered rock instead of a row of teeth
    const topY = py > 0.42 ? 0.42 + (py - 0.42) * 0.4 : py;
    pos.setXYZ(i, v.x * k, py < 0 ? py * 0.24 : Math.min(topY, 0.82), v.z * k);
  }
  pos.needsUpdate = true;
  const buckets = new Map();
  const a = new THREE.Vector3();
  const bb = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const face = new THREE.Vector3();
  const triCount = pos.count / 3;
  const faces = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const i = t * 3;
    a.fromBufferAttribute(pos, i);
    bb.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    ab.subVectors(bb, a);
    ac.subVectors(c, a);
    face.crossVectors(ab, ac).normalize();
    faces[t * 3] = face.x;
    faces[t * 3 + 1] = face.y;
    faces[t * 3 + 2] = face.z;
    for (const p of [a, bb, c]) {
      const k = keyOf(p.x, p.y, p.z);
      let acc = buckets.get(k);
      if (!acc) {
        acc = new THREE.Vector3();
        buckets.set(k, acc);
      }
      acc.add(face);
    }
  }
  const normals = new Float32Array(pos.count * 3);
  const sm = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    sm.copy(buckets.get(keyOf(v.x, v.y, v.z))).normalize();
    const t = Math.floor(i / 3);
    const nx = sm.x * (1 - facet) + faces[t * 3] * facet;
    const ny = sm.y * (1 - facet) + faces[t * 3 + 1] * facet;
    const nz = sm.z * (1 - facet) + faces[t * 3 + 2] * facet;
    const inv = 1 / Math.hypot(nx, ny, nz);
    normals[i * 3] = nx * inv;
    normals[i * 3 + 1] = ny * inv;
    normals[i * 3 + 2] = nz * inv;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  // spherical UVs so the rock texture never stretches over a face
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u = (Math.atan2(v.z, v.x) / TAU + 0.5) * 2.6;
    const vv = (Math.asin(clamp(v.y / (1.24 * (flatten + 0.1)), -1, 1)) / Math.PI + 0.5) * 1.6;
    uv.setXY(i, u, vv);
  }
  uv.needsUpdate = true;
  geo.computeBoundingBox();
  return geo;
}

// ------------------------------------------------------------------ terrain helpers

/** Wet-sand decals / trampled trail mask from the landmark polylines. */
function makeTrailMask(paths) {
  if (!paths.length) return () => 0;
  const segs = [];
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      segs.push([path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]]);
    }
  }
  return (x, z) => {
    let best = Infinity;
    for (const [ax, az, bx, bz] of segs) {
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
      const px = ax + dx * t - x;
      const pz = az + dz * t - z;
      const d = px * px + pz * pz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
}

/** Tree-shade + litter sources read from the flora layout (already normalised map data). */
function collectShadeSpots(ctx) {
  const layout = ctx.data?.layout ?? {};
  const island = layout.island ?? {};
  const spots = [];
  const push = (list, radius, weight) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.z)) continue;
      spots.push({ x: item.x, z: item.z, r: radius * (item.s ?? 1), w: weight });
    }
  };
  push(island.jungleTrees, 5.4, 0.62);
  push(island.coconutPalms, 3.4, 0.4);
  push(island.bushes, 1.6, 0.28);
  return spots;
}

function collectPaths(ctx) {
  const landmarks = Array.isArray(ctx.data?.landmarks) ? ctx.data.landmarks : [];
  const byName = new Map(landmarks.map((l) => [String(l.name ?? '').toUpperCase(), l]));
  const spawn = ctx.data?.playerSpawn;
  const paths = [];
  const chain = (names) => {
    const pts = [];
    if (spawn) pts.push([spawn.x, spawn.z]);
    for (const name of names) {
      const l = byName.get(name);
      if (l && Number.isFinite(l.x) && Number.isFinite(l.z)) pts.push([l.x, l.z]);
    }
    if (pts.length >= 2) paths.push(pts);
  };
  chain(['CAMP', 'VILLAGE', 'HEART']);
  chain(['VILLAGE', 'JETTY']);
  chain(['HEART', 'TEMPLE']);
  chain(['HEART', 'WRECK']);
  return paths;
}

// ---------------------------------------------------------------------- ground plate

function buildGround(ctx, params) {
  const { grassRadius, segments, seed, trail, spots, grassEdge } = params;
  const M = ctx.materials;
  const b = builder();
  const grassA = [0.72, 0.9, 0.52];
  const grassB = [0.5, 0.74, 0.42];
  const litter = [0.74, 0.62, 0.42];
  const dirt = [0.66, 0.54, 0.38];
  const sand = [0.98, 0.93, 0.76];
  const shadeBonus = (x, z) => {
    let lit = 0;
    let litterW = 0;
    for (const s of spots) {
      const dx = x - s.x;
      const dz = z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > s.r) continue;
      const k = 1 - smoothstep(s.r * 0.25, s.r, d);
      lit += k * s.w;
      litterW += k * 0.5;
    }
    return { lit: clamp(lit, 0, 1), litter: clamp(litterW, 0, 1) };
  };
  pushRing(b, {
    inner: 0.05,
    outer: (angle) => grassEdge(angle),
    rings: Math.max(14, Math.round(grassRadius / 2.8)),
    segments,
    uvTile: 4.0,
    y: 0,
    color: (x, z, r, angle) => {
      const n1 = fbm(x * 0.055 + 3.7, z * 0.055 - 2.1);
      const n2 = fbm(x * 0.24 - 5.1, z * 0.24 + 4.4);
      const patch = smoothstep(0.34, 0.78, n2 * 0.7 + n1 * 0.3);
      let c = mix3(grassA, grassB, clamp(n1 * 1.15 - 0.05, 0, 1));
      c = mix3(c, litter, patch * 0.5);
      const shade = shadeBonus(x, z);
      c = mix3(c, [0.42, 0.5, 0.3], shade.lit * 0.42);
      c = mix3(c, litter, shade.litter * 0.35);
      // trodden trails: bare soil with a little litter
      const dTrail = trail(x, z);
      const onTrail = (1 - smoothstep(0.7, 2.1, dTrail)) * 0.92;
      c = mix3(c, dirt, onTrail * 0.8);
      c = mix3(c, litter, onTrail * 0.12);
      // noisy sand blend at the rim
      const edge = smoothstep(0.86, 1.0, r / Math.max(1, grassEdge(angle)));
      c = mix3(c, sand, edge * 0.9);
      const warm = 0.96 + 0.08 * n1;
      return [c[0] * warm, c[1] * warm, c[2] * warm * 0.98];
    },
  });
  // grass spits: small grass islands that push out onto the sand for a natural transition
  const rng = makeRNG(seed + 31);
  for (let i = 0; i < 40; i++) {
    const angle = rng() * TAU;
    const edge = grassEdge(angle);
    const r = edge - 0.3 + rng() * 2.6;
    const cx = Math.sin(angle) * r;
    const cz = Math.cos(angle) * r;
    const radius = 0.6 + rng() * 1.7;
    pushPatch(b, {
      cx, cz, radius, ry: angle + (rng() - 0.5) * 0.6, y: 0.005, verts: 9 + Math.floor(rng() * 4),
      wobble: 0.55, uvTile: 4.0, seed: seed + 200 + i, squash: 0.55 + rng() * 0.5,
      color: (x, z) => mix3(grassB, litter, 0.2 + fbm(x * 0.3, z * 0.3) * 0.4),
    });
  }
  const geo = b.toGeometry();
  const ground = addMesh(ctx, geo, M.jungleGrass, 'ground', { surface: 'sand' });
  ctx.ground = ground;
  return { ground, tris: b.triangles };
}

// --------------------------------------------------------------------- leaf litter

function buildLitter(ctx, params) {
  const { grassRadius, seed, spots, trail, grassEdge } = params;
  const b = builder();
  const rng = makeRNG(seed + 77);
  const browns = [
    [0.62, 0.5, 0.34],
    [0.72, 0.58, 0.38],
    [0.54, 0.46, 0.32],
    [0.78, 0.66, 0.46],
  ];
  const pick = () => browns[Math.floor(rng() * browns.length) % browns.length];
  // leaf carpets under the canopies (biggest visual payoff for the jungle floor)
  for (const s of spots) {
    if (s.w < 0.3) continue;
    const radius = Math.max(1.6, s.r * (0.52 + rng() * 0.2));
    pushPatch(b, {
      cx: s.x + (rng() - 0.5) * s.r * 0.3,
      cz: s.z + (rng() - 0.5) * s.r * 0.3,
      radius, ry: rng() * TAU, y: 0.012, verts: 13,
      wobble: 0.55, uvTile: 3.0, seed: seed + 300 + Math.floor(rng() * 999),
      color: (x, z) => mix3(pick(), [0.5, 0.42, 0.28], fbm(x * 0.4, z * 0.4) * 0.5),
    });
  }
  // scattered drifts on the open jungle floor, thinning towards the beach
  for (let i = 0; i < 80; i++) {
    const angle = rng() * TAU;
    const r = 3 + Math.pow(rng(), 0.7) * (grassRadius - 5);
    const cx = Math.sin(angle) * r;
    const cz = Math.cos(angle) * r;
    const radius = 0.5 + rng() * 1.35;
    pushPatch(b, {
      cx, cz, radius, ry: rng() * TAU, y: 0.011, verts: 7 + Math.floor(rng() * 5),
      wobble: 0.62, uvTile: 3.0, seed: seed + 600 + i,
      color: (x, z) => mix3(pick(), [0.46, 0.4, 0.27], rng() * 0.4),
    });
  }
  // debris collected at the trail edges
  for (let i = 0; i < 26; i++) {
    const along = rng();
    const path = params.paths[Math.floor(rng() * params.paths.length) % Math.max(1, params.paths.length)];
    if (!path || path.length < 2) break;
    const k = Math.min(path.length - 2, Math.floor(along * (path.length - 1)));
    const t = along * (path.length - 1) - k;
    const ax = mix(path[k][0], path[k + 1][0], t);
    const az = mix(path[k][1], path[k + 1][1], t);
    const side = rng() < 0.5 ? -1 : 1;
    const off = 0.9 + rng() * 1.2;
    const cx = ax + side * off * (rng() - 0.5) * 2;
    const cz = az + side * off * (rng() - 0.5) * 2;
    if (Math.hypot(cx, cz) > grassRadius - 1) continue;
    pushPatch(b, {
      cx, cz, radius: 0.35 + rng() * 0.6, ry: rng() * TAU, y: 0.013, verts: 7,
      wobble: 0.6, uvTile: 3.0, seed: seed + 900 + i,
      color: () => pick(),
    });
  }
  const geo = b.toGeometry();
  addMesh(ctx, geo, ctx.materials.leafLitter, 'island-litter');
  return { tris: b.triangles };
}

// ------------------------------------------------------------------- beach & lagoon

function makeShoreProfile({ landRadius, bedOuter, bedDrop, play }) {
  // last flat metre before the wet slope: keeps the whole play ring at y~?
  const spill = Math.max(landRadius - 4.5, play + 1.4);
  const drop = 0.55;
  const beachY = (r) => (r <= spill ? -0.004 : -0.004 - ((r - spill) / Math.max(0.001, landRadius - spill)) * drop);
  const seabedIn = landRadius - 1.0;
  const seabedY = (r) => {
    const y0 = beachY(seabedIn) - 0.02;
    const t = clamp((r - seabedIn) / Math.max(0.001, bedOuter - seabedIn), 0, 1);
    return y0 + (bedDrop - y0) * Math.pow(t, 1.35);
  };
  return { spill, drop, beachY, seabedIn, seabedY };
}

function buildBeach(ctx, params) {
  const { beachInner, landRadius, segments, seed, trail, profile, grassEdge } = params;
  const M = ctx.materials;
  const b = builder();
  const dry = [0.9, 0.84, 0.68];
  const dryLight = [1.0, 0.94, 0.78];
  const damp = [0.58, 0.53, 0.42];
  const wet = [0.36, 0.35, 0.3];
  pushRing(b, {
    inner: beachInner,
    outer: (angle) => landRadius + 0.4 + (fbm(Math.cos(angle) * 3.4 + 9.1, Math.sin(angle) * 3.4 - 4.7) - 0.5) * 1.6,
    rings: 14,
    segments,
    uvTile: 3.2,
    y: (r) => profile.beachY(r),
    color: (x, z, r) => {
      const n = fbm(x * 0.16 + 2.2, z * 0.16 - 8.3);
      const n2 = fbm(x * 0.62, z * 0.62);
      let c = mix3(dry, dryLight, clamp(n * 1.4 - 0.2, 0, 1));
      // shallow dry ripples
      c = mix3(c, dryLight, smoothstep(0.62, 0.9, n2) * 0.32);
      // wet band: starts before the flat-to-slope break and darkens to the waterline
      const wetK = smoothstep(profile.spill - 2.4, landRadius - 0.6, r);
      c = mix3(c, damp, wetK * 0.85);
      c = mix3(c, wet, smoothstep(landRadius - 2.4, landRadius - 0.2, r) * 0.8);
      // the underwater skirt goes darker & cooler (seen through the transparent water)
      c = mix3(c, [0.26, 0.33, 0.3], smoothstep(landRadius - 1.0, landRadius + 0.5, r) * 0.45);
      // trail mark across the sand towards the camp / jetty
      const dTrail = trail(x, z);
      const onTrail = (1 - smoothstep(0.8, 2.4, dTrail)) * 0.55;
      c = mix3(c, [0.78, 0.71, 0.56], onTrail);
      const shade = 0.93 + 0.12 * n;
      return [c[0] * shade, c[1] * shade, c[2] * shade];
    },
  });
  // sand tongues spilling into the grass so the beach/grass border is not a clean circle
  const rng = makeRNG(seed + 41);
  for (let i = 0; i < 26; i++) {
    const angle = rng() * TAU;
    const edge = grassEdge(angle);
    const r = edge - 1.4 + rng() * 3.6;
    const cx = Math.sin(angle) * r;
    const cz = Math.cos(angle) * r;
    pushPatch(b, {
      cx, cz, radius: 0.9 + rng() * 2.4, ry: angle + (rng() - 0.5) * 0.5, y: 0.004,
      verts: 10 + Math.floor(rng() * 4), wobble: 0.6, uvTile: 3.2, seed: seed + 400 + i,
      squash: 0.5 + rng() * 0.55,
      color: (x, z) => mix3(dry, dryLight, fbm(x * 0.4, z * 0.4)),
    });
  }
  const geo = b.toGeometry();
  addMesh(ctx, geo, M.beachSand, 'island-beach', { surface: 'sand' });
  return { tris: b.triangles };
}

function buildLagoon(ctx, params) {
  const { landRadius, bedOuter, segments, seed, profile } = params;
  const b = builder();
  const rng = makeRNG(seed + 55);
  pushRing(b, {
    inner: Math.max(landRadius - 1.6, params.spill + 0.4),
    outer: bedOuter,
    rings: 28,
    segments: segments,
    uvTile: 5.0,
    y: (r) => {
      const base = profile.seabedY(r);
      const shallow = 1 - smoothstep(landRadius + 1, landRadius + 14, r);
      const bars = Math.sin(r * 2.1 + fbm(r * 0.3, 1.7) * 5.0) * 0.07;
      // tiny lift where the lagoon tucks under the beach mesh so the two sand shells
      // never z-fight along the wet-sand seam
      const lift = (1 - smoothstep(landRadius - 1.2, landRadius + 2.2, r)) * 0.012;
      return base + bars * shallow + lift;
    },
    color: (x, z, r) => {
      const t = smoothstep(landRadius, landRadius + 26, r);
      const n = fbm(x * 0.11, z * 0.11);
      const n2 = fbm(x * 0.34 + 4.1, z * 0.34 - 2.7);
      // keep the shade below ~0.7: the water shader already adds most of the brightness
      const sand = [0.52, 0.55, 0.46];
      const pale = [0.65, 0.64, 0.52];
      let c = mix3(sand, pale, clamp(n * 1.4 - 0.15, 0, 1));
      // seagrass / algae mottling, strongest in the shallows
      const weed = smoothstep(0.52, 0.88, n2) * (1 - t * 0.7);
      c = mix3(c, [0.26, 0.4, 0.33], weed * 0.6);
      // turquoise shallows fading into the deep
      c = mix3(c, [0.3, 0.47, 0.43], smoothstep(0.08, 0.5, t) * 0.6);
      c = mix3(c, [0.14, 0.22, 0.27], smoothstep(0.4, 1.0, t) * 0.92);
      return c;
    },
  });
  const geo = b.toGeometry();
  addMesh(ctx, geo, ctx.materials.beachSand, 'island-lagoon', { surface: 'sand' });

  // ---------------------------------------------------------- lagoon coral scatter
  const coral = builder();
  const coralMat = ctx.materials.sand;
  const coralCols = [
    [2.1, 1.15, 1.0],
    [1.8, 0.75, 0.62],
    [2.5, 1.85, 1.05],
    [1.35, 1.6, 1.05],
    [1.9, 1.6, 1.7],
  ];
  const coralPos = (rMin, rMax) => {
    const angle = rng() * TAU;
    const r = rMin + rng() * (rMax - rMin);
    return [Math.sin(angle) * r, Math.cos(angle) * r, r];
  };
  // how tall a coral head may grow before it pierces the water surface
  const depthAt = (r) => Math.max(0, -0.38 - profile.seabedY(r));
  const proto = rockGeo(1, { detail: 0, seed: 9, flatten: 0.62, tile: 1.2 });
  const addLump = (x, y, z, sx, sy, sz, ry, col) => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
      new THREE.Vector3(sx, sy, sz),
    );
    pushGeo(coral, proto, matrix, col, 1.2);
  };
  for (let i = 0; i < 46; i++) {
    const [x, z, r] = coralPos(landRadius + 2.4, landRadius + 15);
    const y = profile.seabedY(r) + 0.03;
    const col = coralCols[Math.floor(rng() * coralCols.length) % coralCols.length];
    const s = Math.min(0.28 + rng() * 0.5, depthAt(r) * 0.62);
    if (s < 0.1) continue;
    addLump(x, y, z, s, s * 0.75, s * (0.8 + rng() * 0.5), rng() * TAU, col);
    if (rng() < 0.65) {
      addLump(x + (rng() - 0.5) * 0.7, y + 0.08, z + (rng() - 0.5) * 0.7,
        s * 0.6, s * 0.55, s * 0.6, rng() * TAU, col);
    }
  }
  // branching coral fingers
  for (let i = 0; i < 30; i++) {
    const [x, z, r] = coralPos(landRadius + 2.6, landRadius + 12);
    const y = profile.seabedY(r) + 0.02;
    const col = coralCols[Math.floor(rng() * coralCols.length) % coralCols.length];
    const room = Math.max(0.05, depthAt(r) * 0.8);
    for (let k = 0; k < 3; k++) {
      const h = Math.min(0.18 + rng() * 0.34, room);
      const geo2 = cylGeo(0.02 + rng() * 0.02, 0.05, h, { radial: 4 });
      geo2.translate(x + (rng() - 0.5) * 0.24, y + h * 0.45, z + (rng() - 0.5) * 0.24);
      const pos2 = geo2.attributes.position;
      const v2 = new THREE.Vector3();
      const tipX = (rng() - 0.5) * 0.3;
      const tipZ = (rng() - 0.5) * 0.3;
      for (let j = 0; j < pos2.count; j++) {
        v2.fromBufferAttribute(pos2, j);
        const k2 = clamp((v2.y - y) / Math.max(0.04, h), 0, 1);
        pos2.setXYZ(j, v2.x + tipX * k2, v2.y, v2.z + tipZ * k2);
      }
      pos2.needsUpdate = true;
      pushGeo(coral, geo2, new THREE.Matrix4(), col, 1.2);
      geo2.dispose();
    }
  }
  // loose rocks + seagrass blades on the lagoon floor
  for (let i = 0; i < 30; i++) {
    const [x, z, r] = coralPos(landRadius + 1.2, landRadius + 18);
    const y = profile.seabedY(r) + 0.01;
    const s = 0.16 + rng() * 0.34;
    addLump(x, y, z, s, s * 0.5, s, rng() * TAU, [1.0, 0.95, 0.8]);
  }
  for (let i = 0; i < 80; i++) {
    const [x, z, r] = coralPos(landRadius + 1, landRadius + 16);
    const y = profile.seabedY(r) + 0.01;
    const len = Math.min(0.3 + rng() * 0.5, depthAt(r) * 0.75);
    if (len < 0.08) continue;
    const wid = 0.05 + rng() * 0.04;
    const col = mix3([0.55, 1.15, 0.6], [0.95, 1.3, 0.7], rng());
    const a = rng() * TAU;
    const dirX = Math.sin(a);
    const dirZ = Math.cos(a);
    const perpX = Math.cos(a);
    const perpZ = -Math.sin(a);
    const v0 = coral.vert(x - perpX * wid, y, z - perpZ * wid, 0, 0, col);
    const v1 = coral.vert(x + perpX * wid, y, z + perpZ * wid, 1, 0, col);
    const v2 = coral.vert(x + perpX * wid * 0.4 + dirX * len, y + len * 0.55, z + perpZ * wid * 0.4 + dirZ * len, 1, 1, col);
    const v3 = coral.vert(x - perpX * wid * 0.4 + dirX * len, y + len * 0.55, z - perpZ * wid * 0.4 + dirZ * len, 0, 1, col);
    coral.quad(v0, v1, v2, v3);
  }
  proto.dispose();
  const coralGeo = coral.toGeometry();
  addMesh(ctx, coralGeo, coralMat, 'island-coral');
  return { tris: b.triangles + coral.triangles };
}

// ----------------------------------------------------------------------- beach scatter

function buildBeachScatter(ctx, params) {
  const { landRadius, seed, profile } = params;
  const b = builder();
  const rng = makeRNG(seed + 63);
  const placement = (rMin, rMax) => {
    const angle = rng() * TAU;
    const r = rMin + rng() * (rMax - rMin);
    return [Math.sin(angle) * r, Math.cos(angle) * r, r];
  };
  // shells (bright, cream/pink) + pebbles (grey/brown) in one pale-stone mesh
  const shellCols = [[1.0, 0.96, 0.86], [0.98, 0.9, 0.84], [0.92, 0.94, 0.9], [1.0, 0.92, 0.78]];
  const pebbleCols = [[0.6, 0.58, 0.52], [0.72, 0.66, 0.56], [0.5, 0.5, 0.47], [0.66, 0.6, 0.5]];
  const proto = rockGeo(1, { detail: 0, seed: 3, flatten: 0.42, tile: 0.8 });
  const tmpMatrix = new THREE.Matrix4();
  const push = (proto2, x, y, z, s, ry, col, sy = 0.6) => {
    tmpMatrix.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
      new THREE.Vector3(s, s * sy, s * (0.8 + rng() * 0.4)),
    );
    pushGeo(b, proto2, tmpMatrix, col, 1.2);
  };
  for (let i = 0; i < 75; i++) {
    const [x, z, r] = placement(params.beachInner + 1.5, profile.spill - 0.4);
    push(proto, x, profile.beachY(r) + 0.01, z, 0.03 + rng() * 0.045, rng() * TAU, shellCols[Math.floor(rng() * 4) % 4], 0.45);
  }
  for (let i = 0; i < 65; i++) {
    const [x, z, r] = placement(params.beachInner + 1.2, profile.spill - 0.2);
    push(proto, x, profile.beachY(r) + 0.009, z, 0.05 + rng() * 0.09, rng() * TAU, pebbleCols[Math.floor(rng() * 4) % 4], 0.55);
  }
  // wet-line shells, right where the sand turns dark
  for (let i = 0; i < 28; i++) {
    const [x, z, r] = placement(profile.spill - 0.7, landRadius - 0.6);
    push(proto, x, profile.beachY(r) + 0.01, z, 0.035 + rng() * 0.05, rng() * TAU, shellCols[Math.floor(rng() * 4) % 4], 0.4);
  }
  proto.dispose();
  addMesh(ctx, b.toGeometry(), ctx.materials.ruinStone, 'island-scatter');

  // dark seaweed wrack + damp-sand sheen along the tide line (one mud-material mesh)
  const w = builder();
  const wrackCols = [[0.78, 0.72, 0.5], [0.86, 0.78, 0.52], [0.7, 0.68, 0.5], [0.92, 0.8, 0.56]];
  for (let i = 0; i < 70; i++) {
    const [x, z, r] = placement(profile.spill - 1.4, landRadius - 0.2);
    const y = profile.beachY(r) + 0.008;
    const a = rng() * TAU;
    const len = 0.16 + rng() * 0.42;
    const wid = 0.015 + rng() * 0.03;
    const col = wrackCols[Math.floor(rng() * 4) % 4];
    const dirX = Math.sin(a);
    const dirZ = Math.cos(a);
    const perpX = Math.cos(a);
    const perpZ = -Math.sin(a);
    const v0 = w.vert(x - perpX * wid, y, z - perpZ * wid, 0, 0, col);
    const v1 = w.vert(x + perpX * wid, y, z + perpZ * wid, 1, 0, col);
    const v2 = w.vert(x + perpX * wid * 0.5 + dirX * len, y + 0.002, z + perpZ * wid * 0.5 + dirZ * len, 1, 1, col);
    const v3 = w.vert(x - perpX * wid * 0.5 + dirX * len, y + 0.002, z - perpZ * wid * 0.5 + dirZ * len, 0, 1, col);
    w.quad(v0, v1, v2, v3);
  }
  addMesh(ctx, w.toGeometry(), ctx.materials.mud, 'island-tideline', { shadows: true });
  return { tris: b.triangles + w.triangles };
}

// ------------------------------------------------------------------------ reef ridge

function buildReefRidge(ctx, params) {
  const { terrain, seed } = params;
  ensureBatches(ctx);
  const batcher = ctx.batcher;
  const ring = boundarySegments(terrain.boundary);
  const radius = ring.ring.radius;
  const half = ring.segments.length ? ring.segments[0].size / 2 : 1.72;
  const gapAngle = num(terrain?.boundary?.gap?.angle, 0.48);
  const gapWidth = num(terrain?.boundary?.gap?.width, 6);
  const gapHalf = gapWidth / 2 / Math.max(1, radius);
  const step = TAU / Math.max(1, ring.segments.length);
  const rng = makeRNG(seed + 91);
  const angleDist = (a, b) => Math.abs(((a - b + Math.PI) % TAU) - Math.PI);

  // rock prototypes: rounded reef block / angular shard / low slab / hero (gate posts)
  const rocks = [
    lumpGeo({ detail: 1, seed: 3, flatten: 0.9, amp: 0.3, facet: 0.5 }),
    lumpGeo({ detail: 1, seed: 8, flatten: 0.7, amp: 0.42, facet: 0.85 }),
    lumpGeo({ detail: 1, seed: 15, flatten: 0.5, amp: 0.34, facet: 0.68 }),
    lumpGeo({ detail: 2, seed: 19, flatten: 0.78, amp: 0.36, facet: 0.6 }),
  ];
  const flat = [0.9, 0.7, 0.5, 0.78];
  const chipGeo = lumpGeo({ detail: 0, seed: 21, flatten: 0.6, amp: 0.34, facet: 0.8 });
  const mossGeo = lumpGeo({ detail: 0, seed: 27, flatten: 0.4, amp: 0.3, facet: 0.35 });
  const wetGeo = lumpGeo({ detail: 0, seed: 33, flatten: 0.16, amp: 0.26, facet: 0.5 });
  // 20-tri low slab: the half-buried reef platform of the sand saddles
  const slabGeo = lumpGeo({ detail: 0, seed: 41, flatten: 0.5, amp: 0.38, facet: 0.55 });
  const SLAB_FLAT = 0.5;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let ridgeTris = 0;
  const triOf = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  const add = (key, geo, x, y, z, sx, sy, sz, ry, rx = 0, rz = 0) => {
    pos.set(x, y, z);
    e.set(rx, ry, rz, 'YXZ');
    q.setFromEuler(e);
    scl.set(sx, sy, sz);
    m.compose(pos, q, scl);
    batcher.add(key, geo, m);
    ridgeTris += triOf(geo);
  };
  // shell extremes: 1.29× horizontal reach (icosahedron jitter); the blunt-crown squash
  // below maps everything above y=0.42 to a max of 0.82 * 1.29 * flatten
  const reach = (sx, sz) => 1.29 * Math.max(sx, sz);
  const topExtent = (flatten) => {
    const raw = 1.29 * flatten;
    const blunt = raw > 0.42 ? 0.42 + (raw - 0.42) * 0.4 : raw;
    return Math.min(blunt, 0.82);
  };

  let tallCount = 0;
  let rockCount = 0;

  // ---------------------------------------------------- sand spine under the rocks
  // A low sand ridge (beach-sand material) follows the rock belt so the boulders grow out
  // of the beach instead of standing on a flat plane. It stays inside the collider
  // footprints radially (|d| <= 1.2 m) so it never turns into a visual-only blocker.
  const skirt = builder();
  const skirtRows = [-1.2, -0.62, -0.05, 0.55, 1.2];
  const skirtY = [0.004, 0.1, 0.17, 0.085, 0.004];
  const sandDry = [0.9, 0.84, 0.68];
  const sandDamp = [0.6, 0.55, 0.44];
  for (const segment of ring.segments) {
    if (segment.skipped) continue;
    const a0 = segment.angle - step * 0.5;
    const a1 = segment.angle + step * 0.5;
    const bump = 0.65 + noise2(Math.cos(segment.angle) * 5.1 + 2.4, Math.sin(segment.angle) * 5.1 - 3.3) * 0.7;
    const rows = [];
    for (let ri = 0; ri < skirtRows.length; ri++) {
      const row = [];
      for (const aa of [a0, a1]) {
        const rr = radius + skirtRows[ri];
        const x = Math.sin(aa) * rr;
        const z = Math.cos(aa) * rr;
        const y = skirtY[ri] * bump;
        const n = noise2(x * 0.55 + 3.1, z * 0.55 - 1.7);
        const edge = Math.abs(skirtRows[ri]) / 1.2;
        let c = mix3(sandDry, sandDamp, 0.22 + n * 0.3 + edge * 0.25);
        const shade = 0.82 + n * 0.3;
        row.push(skirt.vert(x, y, z, x / 3.2, z / 3.2, [c[0] * shade, c[1] * shade, c[2] * shade]));
      }
      rows.push(row);
    }
    for (let ri = 0; ri < skirtRows.length - 1; ri++) {
      const a = rows[ri][0];
      const b1 = rows[ri][1];
      const c = rows[ri + 1][0];
      const d = rows[ri + 1][1];
      skirt.tri(a, c, b1);
      skirt.tri(b1, c, d);
    }
  }
  const skirtGeo = skirt.toGeometry();
  addMesh(ctx, skirtGeo, ctx.materials.beachSand, 'island-reef-skirt');
  ridgeTris += skirt.triangles;

  // --------------------------------------------------------------- reef boulders
  for (const segment of ring.segments) {
    if (segment.skipped) continue;
    const angle = segment.angle;
    const cx = Math.sin(angle) * radius;
    const cz = Math.cos(angle) * radius;
    const n1 = noise2(Math.cos(angle) * 3.2 + 1.7, Math.sin(angle) * 3.2 - 4.1);
    const n2 = noise2(Math.cos(angle) * 7.9 - 5.3, Math.sin(angle) * 7.9 + 2.4);
    const n3 = noise2(Math.cos(angle) * 15.1 + 8.1, Math.sin(angle) * 15.1 - 6.6);
    const distGap = angleDist(angle, gapAngle);
    const gapNeighbour = distGap < gapHalf + step * 1.9;

    /** Place one boulder. `tangent`/`radial` are metres in the ring frame. */
    const place = (gi, tangent, radial, s, h, sink, key, slab = false) => {
      const sz = s * (0.8 + rng() * 0.4);
      const limit = Math.max(0, half - 0.05 - reach(s, sz));
      const dx = Math.sin(angle) * radial + Math.cos(angle) * tangent;
      const dz = Math.cos(angle) * radial - Math.sin(angle) * tangent;
      const ox = clamp(dx, -limit, limit);
      const oz = clamp(dz, -limit, limit);
      const tilt = (rng() - 0.5) * 0.12;
      const geo = slab ? slabGeo : rocks[gi];
      const fl = slab ? SLAB_FLAT : flat[gi];
      add(key, geo, cx + ox, -sink, cz + oz,
        s, (h + sink) / topExtent(fl), sz, rng() * TAU, tilt, tilt * 0.6);
      rockCount++;
      if (h > 1.25) tallCount++;
      // moss cushion on the top of the taller blocks (<= 20 % of rocks)
      if (h > 1.45 && rng() < 0.2) {
        const ms = s * (0.4 + rng() * 0.22);
        add('mossStone', mossGeo, cx + ox + (rng() - 0.5) * 0.16, -sink + h - 0.16,
          cz + oz + (rng() - 0.5) * 0.16, ms, 0.22 / topExtent(0.4), ms * (0.85 + rng() * 0.3), rng() * TAU);
      }
      return { x: cx + ox, z: cz + oz, s };
    };

    // the cluster centre drifts along the ring so the belt never reads as a regular row
    const shift = (rng() - 0.5) * 0.9;
    const saddle = n2 < 0.34;
    const lowTop = 0.45 + rng() * 0.4; // 0.45-0.85 m reef shelf in a sand saddle

    // 1) seaward block: wide + low, keeps the outer collider face visually covered
    const sea = place(rng() < 0.3 ? 2 : 0, shift + (rng() - 0.5) * 0.5, 0.38 + n1 * 0.08,
      saddle ? 1.0 + rng() * 0.22 : 0.92 + rng() * 0.24,
      saddle ? lowTop : 1.05 + rng() * 0.6, 0.3 + rng() * 0.22,
      rng() < 0.24 ? 'mossStone' : 'shoreRock', saddle);
    // wet collar where the seaward block meets the sand
    if (rng() < 0.6) {
      add('mud', wetGeo, sea.x + (rng() - 0.5) * 0.2, -0.045, sea.z + (rng() - 0.5) * 0.2,
        sea.s * (1.35 + rng() * 0.4), 0.9, sea.s * (1.2 + rng() * 0.4), rng() * TAU);
    }

    // 2) inward block: wide shelf, keeps the inner collider face visually covered
    place(rng() < 0.3 ? 2 : 0, shift - (rng() - 0.5) * 0.7, -(0.36 + n2 * 0.08),
      saddle ? 0.92 + rng() * 0.24 : 0.86 + rng() * 0.26,
      saddle ? 0.4 + rng() * 0.4 : 0.95 + rng() * 0.5, 0.26 + rng() * 0.2,
      rng() < 0.2 ? 'stoneDark' : 'shoreRock', saddle);

    // 3) tall shard(s): every segment keeps at least one collider-height rock so the
    //    collision box always has a visible side face (map-audit air walls)
    if (saddle) {
      place(1, shift + (rng() - 0.5) * 0.9, (rng() - 0.5) * 0.5,
        0.5 + rng() * 0.18, 1.2 + rng() * 0.35, 0.28 + rng() * 0.2, 'shoreRock');
    } else if (n2 > 0.3) {
      place(1, shift + (rng() - 0.5) * 1.0, (rng() - 0.5) * 0.5,
        0.52 + rng() * 0.24, 1.3 + rng() * 0.62, 0.26 + rng() * 0.3, 'shoreRock');
    }
    if (!saddle && n3 > 0.84) {
      place(1, shift + (rng() - 0.5) * 1.2, (rng() - 0.5) * 0.7,
        0.42 + rng() * 0.2, 1.05 + rng() * 0.55, 0.24 + rng() * 0.2,
        rng() < 0.14 ? 'stoneDark' : 'shoreRock');
    }

    // 4) chips / broken coral rubble spilling from the cluster
    if (rng() < 0.32) {
      const cs = 0.15 + rng() * 0.22;
      const limit = Math.max(0, half - 0.05 - reach(cs, cs));
      const ang = rng() * TAU;
      const rr = rng() * limit;
      add('shoreRock', chipGeo, cx + Math.cos(ang) * rr, -0.03, cz + Math.sin(ang) * rr,
        cs, cs * 0.6, cs * (0.8 + rng() * 0.4), rng() * TAU);
    }

    // 5) gate posts flanking the jetty gap (biggest rocks, keep the passage obvious)
    if (gapNeighbour) {
      const side = Math.sin(gapAngle - angle) >= 0 ? 1 : -1;
      const s = 0.8;
      const h = 1.9 + rng() * 0.25;
      const tangent = side * Math.max(0.2, half - 0.06 - reach(s, s));
      const dx = Math.cos(angle) * tangent;
      const dz = -Math.sin(angle) * tangent;
      add('shoreRock', rocks[3], cx + dx, -0.3, cz + dz,
        s, (h + 0.3) / topExtent(0.78), s * 0.9, rng() * TAU);
      rockCount++;
      tallCount++;
    }
  }
  ctx.terrainRidgeTris = Math.round(ridgeTris);

  // ------------------------------------------------------------- ridge foliage
  // Ferns and low bushes along the rock belt (visual only: the frond/leaf batches are
  // collide:false, real collision is the map data).
  const frond = frondGeometry();
  const leaf = unitQuad();
  const angles = [];
  for (let i = 0; i < 16; i++) angles.push((i / 16) * TAU + rng() * 0.3);
  let foliage = 0;
  for (const a of angles) {
    if (angleDist(a, gapAngle) < gapHalf + 0.05) continue;
    // Pull the fern clusters 1 m inside the rock belt and keep them low: sitting on the
    // beach/rock base instead of hovering over the water when a segment is a low saddle.
    const r = radius - 1.0 + (rng() - 0.5) * 0.8;
    const cx = Math.sin(a) * r;
    const cz = Math.cos(a) * r;
    const onRock = rng() < 0.55;
    const baseY = onRock ? 0.42 + rng() * 0.3 : 0.1 + rng() * 0.14;
    const scale = 0.8 + rng() * 0.6;
    for (let f = 0; f < 6; f++) {
      const yaw = (f / 6) * TAU + rng() * 0.5;
      const pitch = -0.5 + rng() * 1.2;
      const rollout = 0.35 + rng() * 0.55;
      m.compose(
        pos.set(cx + (rng() - 0.5) * 0.25, baseY, cz + (rng() - 0.5) * 0.25),
        q.setFromEuler(e.set(pitch, yaw, rollout, 'YXZ')),
        scl.set(scale, scale, scale),
      );
      batcher.add('frondLush', frond, m.clone());
      foliage++;
    }
    if (rng() < 0.7) {
      for (let f = 0; f < 2; f++) {
        m.compose(
          pos.set(cx + (rng() - 0.5) * 0.5, baseY + 0.2 + rng() * 0.2, cz + (rng() - 0.5) * 0.5),
          q.setFromEuler(e.set(-0.7 + rng() * 0.5, rng() * TAU, 0, 'YXZ')),
          scl.set(0.5 + rng() * 0.3, 0.5 + rng() * 0.3, 0.5),
        );
        batcher.add(rng() < 0.5 ? 'broadleaf' : 'broadleafDark', leaf, m.clone());
      }
    }
  }
  const foliageTris = 16 * (6 * 8 + 2 * 2);
  for (const geo of [...rocks, chipGeo, mossGeo, wetGeo, frond, leaf]) geo.dispose();
  return { tallCount, rockCount, foliage, tris: Math.round(ridgeTris + foliageTris) };
}

/** Simple curved frond strip (8 triangles) for the reef foliage. */
function frondGeometry() {
  const b = builder();
  const seg = 4;
  const len = 1.0;
  const wid = 0.1;
  const rows = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const y = Math.pow(t, 1.7) * 0.42 - t * 0.05;
    const w = wid * (1 - t * 0.75) * (0.35 + Math.sin(t * Math.PI) * 0.9);
    const z = t * len;
    const c = [1, 1, 1];
    rows.push([b.vert(-w, y, z, 0, t, c), b.vert(w, y, z, 1, t, c)]);
  }
  for (let i = 0; i < seg; i++) {
    b.quad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]);
  }
  return b.toGeometry();
}

/** Unit leaf card (2 triangles) for the broadleaf batches. */
function unitQuad() {
  const b = builder();
  const c = [1, 1, 1];
  const a = b.vert(-0.5, 0, -0.5, 0, 0, c);
  const bb = b.vert(0.5, 0, -0.5, 1, 0, c);
  const cc = b.vert(0.5, 0, 0.5, 1, 1, c);
  const d = b.vert(-0.5, 0, 0.5, 0, 1, c);
  b.quad(a, bb, cc, d);
  return b.toGeometry();
}

// ------------------------------------------------------------------------- assembly

/**
 * Build the whole island ground.
 * @param {object} ctx world context from createWorld()
 * @returns {{ ground: THREE.Mesh }}
 */
export function buildIslandTerrain(ctx) {
  const terrain = ctx.data?.terrain ?? {};
  const island = terrain.island ?? {};
  const sea = terrain.sea ?? {};
  const grassRadius = num(island.grassRadius, 44);
  const beachInner = num(island.beachInner, 41);
  const landRadius = num(island.landRadius, 57);
  const segments = Math.max(96, Math.round(num(island.segments, 168)));
  const seed = num(island.seed, 7712);
  const bedOuter = Math.max(landRadius + 18, num(sea.bedOuter, 96));
  const bedDrop = num(sea.bedDrop, -7.5);
  const play = playRadius(terrain);

  const profile = makeShoreProfile({ landRadius, bedOuter, bedDrop, play });
  const paths = collectPaths(ctx);
  const trail = makeTrailMask(paths);
  const spots = collectShadeSpots(ctx);
  // irregular grass rim: big lobes + small crenellation; the spawn beach (r~?6) must stay sand
  const grassEdge = (angle) => {
    const lobe = (fbm(Math.cos(angle) * 1.8 + seed * 0.013, Math.sin(angle) * 1.8 - 2.3) - 0.5) * 4.8;
    const crenel = (fbm(Math.cos(angle) * 9.2 - 4.4, Math.sin(angle) * 9.2 + 6.1) - 0.5) * 2.6;
    return clamp(grassRadius + lobe + crenel, grassRadius - 3.6, grassRadius + 1.5);
  };

  const params = {
    terrain, profile, grassRadius, beachInner, landRadius, bedOuter, bedDrop,
    segments, seed, paths, trail, spots, grassEdge, play, spill: profile.spill,
  };

  const ground = buildGround(ctx, params);
  const litter = buildLitter(ctx, params);
  const beach = buildBeach(ctx, params);
  const scatter = buildBeachScatter(ctx, params);
  const lagoon = buildLagoon(ctx, params);
  const ridge = buildReefRidge(ctx, params);
  const total = ground.tris + litter.tris + beach.tris + scatter.tris + lagoon.tris + ridge.tris;
  ctx.terrainTris = {
    ground: ground.tris,
    litter: litter.tris,
    beach: beach.tris,
    scatter: scatter.tris,
    lagoon: lagoon.tris,
    ridge: ridge.tris,
    total,
  };

  return { ground: ground.ground };
}

export default buildIslandTerrain;
