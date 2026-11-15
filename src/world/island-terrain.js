/**
 * SANDSTRIKE // ATOLL-09 tropical island ground.
 *
 * The play ring is open: the reef-rock belt that used to close the shoreline is gone, so the
 * sand runs continuously from the jungle plateau out under the sea and the player can walk
 * the whole beach down to the shallows (`island-shore.js` owns the numbers). Every sand shell
 * in this file — the beach face, the lagoon/seabed bed, the shell/wrack scatter on top of
 * them — samples that one shared profile, so the dry apron, the damp band, the wet line and
 * the submerged sand all sit on the same surface and cross-fade by depth instead of by radius:
 *
 *   plateau (y≈0) ── dry apron ── beach face ── waterline ── wading shelf ── lagoon slope ── open sea
 *
 * The waterline itself is warped per bearing (`shoreProfile().Y()`), which is why every ring
 * builder here adds `warpRadius(angle)` to its radii instead of assuming a circle.
 *
 * Cheap-but-organic look:
 *   - one merged mesh per material (ground / litter / beach / scatter / lagoon / coral),
 *   - world-scaled UVs (~4 m per grass tile) so there is no visible texture seam,
 *   - vertex-colour storytelling: jungle litter under trees, trodden trails between the
 *     landmarks, damp/wet sand driven by height above sea level, turquoise-to-deep-blue
 *     lagoon bed driven by `profile.depthAt`, coral heads, seagrass, shells and wrack,
 *   - deterministic `valueNoise` patches — no external assets, no runtime cost.
 *
 * Underwater meshes are tagged `userData.seabed = true` (beach / lagoon bed / coral /
 * beach scatter / tideline): the ocean pass captures those as the refracted bottom.
 *
 * Contract (see ISLAND_MAP_SPEC.md §4.1):
 *   buildIslandTerrain(ctx) -> { ground }
 * `ctx.ground` points at the grass mesh named `ground` (raycasts / floor / bullets);
 * `ctx.groundHeight` / `ctx.shoreProfile` / `ctx.shoreGuard` feed the walkable-height and
 * wading-guard contracts consumed by `player.js` / `enemies.js`.
 */
import * as THREE from 'three';
import { TAU } from '../models/core.js';
import { makeRNG } from '../utils.js';
import { rockGeo, cylGeo } from '../models/world/detail.js';
import { shoreProfile, warpRadius } from './island-shore.js';

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

// ------------------------------------------------------------ shoreline helpers

/**
 * Metres seaward of the warped waterline where the beach ring hands over to the lagoon bed.
 * The two rings evaluate the *same* profile height on that radius (see `seamRadius()`), so
 * they meet on identical boundary vertices: one continuous sand surface, no seam, no overlap.
 */
const BEACH_SEAM = 2.2;

/** Flat-profile radius `radius` expressed as a world radius on `angle` (adds the bearing warp). */
const warped = (radius, angle) => radius + warpRadius(angle);

/** World radius where the beach mesh ends and the lagoon/seabed mesh begins. */
const seamRadius = (profile, angle) => profile.waterlineAt(angle) + BEACH_SEAM;

/**
 * Sand colour story: one curve from dry dune sand through damp/wet to submerged sand.
 * The underwater entries stay *pale*: the tropical water is genuinely transparent now
 * (Beer-Lambert absorption + in-scatter live in the ocean shader), so the bed must keep a
 * bright neutral-warm sand value and let the water supply every bit of blue/green. A dark
 * "deep seabed" palette here (the old opaque-ocean look) composites into a murky grey band.
 */
const SAND_DRY = [1.06, 0.94, 0.70];
const SAND_DAMP = [0.74, 0.62, 0.43];
const SAND_WET = [0.54, 0.45, 0.34];
const SAND_SUBMERGED = [0.84, 0.82, 0.68];

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
 * `inner` / `outer` may each be a function of the angle for a naturally irregular rim.
 */
function pushRing(b, { inner, outer, rings, segments, uvTile = 4, y = 0, color, shade }) {
  const rows = [];
  for (let ri = 0; ri <= rings; ri++) {
    const t = ri / rings;
    const row = [];
    for (let si = 0; si <= segments; si++) {
      const angle = (si / segments) * TAU;
      const rin = typeof inner === 'function' ? inner(angle) : inner;
      const ro = typeof outer === 'function' ? outer(angle) : outer;
      const radius = rin + (ro - rin) * t;
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

function addMesh(ctx, geo, material, name, { shadows = true, surface = null, cast = false, seabed = false } = {}) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.castShadow = cast;
  mesh.receiveShadow = shadows;
  if (surface) mesh.userData.surface = surface;
  // Underwater sand shells / coral / scatter: the ocean pass captures these as the refracted
  // bottom (they stay raycast-visible and in `collideMeshes`; this flag is not "no collision").
  if (seabed) mesh.userData.seabed = true;
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  ctx.disposables.push(geo);
  return mesh;
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
//
// Both shells are rings over the *same* shared shore profile. The beach ring ends exactly
// where the lagoon ring starts (`seamRadius()`), and both evaluate `profile.Y(x, z)` on that
// boundary, so their boundary vertices are identical: one continuous sand surface instead of
// two overlapping discs (no seam, no z-fighting). Dry / damp / wet / submerged colours are
// driven by height above the sea surface — a constant-height contour — so every colour band
// follows the warped waterline instead of a perfect circle.

/** Height of the (warped) sand/seabed surface at a world position. */
const sandY = (profile, x, z) => profile.Y(x, z);

/**
 * Sand colour story shared by the beach face and its scatter: dry dune sand -> damp band ->
 * wet line -> submerged sand. `height` is the shared-profile height at (x, z); the transitions
 * are height-above-sea contours, so they bend with the warped waterline.
 */
function sandColor(profile, x, z, height, trail = null) {
  const above = height - profile.level; // metres above the sea surface (negative underwater)
  const n = fbm(x * 0.16 + 2.2, z * 0.16 - 8.3);
  const n2 = fbm(x * 0.62, z * 0.62);
  let c = mix3(SAND_DRY, [1.0, 0.96, 0.84], clamp(n * 1.4 - 0.2, 0, 1));
  // shallow dry ripples (per-vertex only: the walkable surface stays the smooth profile)
  c = mix3(c, [1.0, 0.95, 0.82], smoothstep(0.66, 0.94, n2) * 0.3);
  // Damp band: the beach only stands ~0.38 m above the sea, so the dry->damp->wet gradient is
  // authored on ~0.3 m of height (the last 3 m of beach face — the profile owns the rest).
  c = mix3(c, SAND_DAMP, smoothstep(0.31, 0.10, above) * 0.85);
  // wet line: darkest in the last few centimetres above / at the waterline
  c = mix3(c, SAND_WET, smoothstep(0.10, -0.03, above) * 0.82);
  // submerged sand seen through the transparent shallows: pale wet sand, a touch cooler than
  // the dry beach but never dark — the water shader does the depth tinting
  c = mix3(c, SAND_SUBMERGED, smoothstep(-0.02, -0.9, above) * 0.62);
  // trodden trail towards the camp / jetty (dry sand only)
  if (trail) {
    const onTrail = (1 - smoothstep(0.8, 2.4, trail(x, z))) * 0.55 * smoothstep(0.30, 0.36, above);
    c = mix3(c, [0.8, 0.73, 0.58], onTrail);
  }
  const shade = 0.93 + 0.12 * n;
  return [c[0] * shade, c[1] * shade, c[2] * shade];
}

function buildBeach(ctx, params) {
  const { beachInner, segments, seed, trail, profile, grassEdge } = params;
  const b = builder();
  // 18 rows over the ~15 m beach (0.8 m spacing): enough to read the dry-apron -> beach-face
  // break without spending triangles on the flat plateau end.
  pushRing(b, {
    inner: beachInner,
    outer: (angle) => seamRadius(profile, angle),
    rings: 18,
    segments,
    uvTile: 3.2,
    y: (r, x, z) => sandY(profile, x, z),
    color: (x, z, r, angle, height) => sandColor(profile, x, z, height, trail),
  });
  // sand tongues spilling into the grass so the beach/grass border is not a clean circle
  const rng = makeRNG(seed + 41);
  for (let i = 0; i < 26; i++) {
    const angle = rng() * TAU;
    const r = grassEdge(angle) - 1.4 + rng() * 3.6;
    const cx = Math.sin(angle) * r;
    const cz = Math.cos(angle) * r;
    pushPatch(b, {
      cx, cz, radius: 0.9 + rng() * 2.4, ry: angle + (rng() - 0.5) * 0.5,
      y: sandY(profile, cx, cz) + 0.006,
      verts: 10 + Math.floor(rng() * 4), wobble: 0.6, uvTile: 3.2, seed: seed + 400 + i,
      squash: 0.5 + rng() * 0.55,
      color: (x, z) => mix3(SAND_DRY, [1.0, 0.96, 0.84], fbm(x * 0.4, z * 0.4)),
    });
  }
  const geo = b.toGeometry();
  addMesh(ctx, geo, ctx.materials.beachSand, 'island-beach', { surface: 'sand', seabed: true });
  return { tris: b.triangles };
}

/**
 * Lagoon floor colour: a pale coral-sand bed with gentle seagrass / algae mottling.
 *
 * The bed is deliberately *bright and neutral*: the transparent ocean shader owns the
 * turquoise / deep-blue colouring, so any blue-green tint painted here would double up with
 * the water and turn the whole shallows into a murky dark band. Only past ~3 m does the bed
 * cool down slightly. Right across the beach/lagoon seam the beach's own sand colour is mixed
 * back in, which keeps the two shells from showing a colour step where they meet.
 */
function lagoonColor(profile, x, z, height, seamDepth) {
  const depth = Math.max(0, profile.depthAt(x, z));
  const deepest = Math.max(0.5, profile.level - profile.bedDrop);
  const t = clamp(depth / deepest, 0, 1);
  const n = fbm(x * 0.11, z * 0.11);
  const n2 = fbm(x * 0.34 + 4.1, z * 0.34 - 2.7);
  // pale coral sand, slightly warmer/darker than dry beach sand so it reads as "under water"
  let c = mix3([0.78, 0.78, 0.66], [0.9, 0.89, 0.76], clamp(n * 1.4 - 0.15, 0, 1));
  // seagrass / algae mottling, strongest in the shallows — a gentle value change, not a tint
  c = mix3(c, [0.56, 0.66, 0.48], smoothstep(0.52, 0.88, n2) * (1 - smoothstep(0.25, 0.75, t)) * 0.42);
  // the deep lagoon bed (past ~3.5 m) cools down modestly; the water does the real darkening
  c = mix3(c, [0.6, 0.66, 0.62], smoothstep(3.2, 6.6, depth) * 0.42);
  // beach wet-sand halo across the seam, fading out over the first 1.6 m of depth
  const shore = sandColor(profile, x, z, height);
  c = mix3(c, shore, 1 - smoothstep(seamDepth, seamDepth + 1.6, depth));
  return c;
}

function buildLagoon(ctx, params) {
  const { profile, segments, seed } = params;
  const level = profile.level;
  const rng = makeRNG(seed + 55);
  // Depth of the shared seam: the lagoon bed must look exactly like the beach there.
  const seamDepth = level - profile.height(profile.waterline + BEACH_SEAM);
  const b = builder();
  pushRing(b, {
    inner: (angle) => seamRadius(profile, angle),
    outer: profile.bedOuter,
    rings: 26,
    segments,
    uvTile: 5.0,
    y: (r, x, z, angle) => {
      const flat = Math.hypot(x, z) - warpRadius(angle); // profile-space radius (warp removed)
      const bars = Math.sin(flat * 2.1 + fbm(flat * 0.3, 1.7) * 5.0) * 0.04;
      const shallow = 1 - smoothstep(profile.waterline + 3.0, profile.waterline + 16, flat);
      // Faded out at the shared seam so both shells still agree exactly on the boundary row.
      const seamFade = smoothstep(profile.waterline + BEACH_SEAM, profile.waterline + BEACH_SEAM + 2.5, flat);
      return sandY(profile, x, z) + bars * shallow * seamFade;
    },
    color: (x, z, r, angle, height) => lagoonColor(profile, x, z, height, seamDepth),
  });
  const lagoonGeo = b.toGeometry();
  addMesh(ctx, lagoonGeo, ctx.materials.beachSand, 'island-lagoon', { surface: 'sand', seabed: true });
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
  // Coral / rock / seagrass bands are authored as *profile* radii around the island and then
  // warped per bearing, so the reef garden follows the real waterline instead of a circle.
  const coralPos = (flatMin, flatMax) => {
    const angle = rng() * TAU;
    const flat = flatMin + rng() * (flatMax - flatMin);
    const r = warped(flat, angle);
    return [Math.sin(angle) * r, Math.cos(angle) * r, flat];
  };
  const waterline = profile.waterline;
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
    const [x, z] = coralPos(waterline + 2.4, waterline + 15);
    const y = sandY(profile, x, z) + 0.03;
    const depth = Math.max(0, profile.depthAt(x, z));
    const col = coralCols[Math.floor(rng() * coralCols.length) % coralCols.length];
    // how tall a coral head may grow before it pierces the water surface
    const s = Math.min(0.28 + rng() * 0.5, depth * 0.62);
    if (s < 0.1) continue;
    addLump(x, y, z, s, s * 0.75, s * (0.8 + rng() * 0.5), rng() * TAU, col);
    if (rng() < 0.65) {
      addLump(x + (rng() - 0.5) * 0.7, y + 0.08, z + (rng() - 0.5) * 0.7,
        s * 0.6, s * 0.55, s * 0.6, rng() * TAU, col);
    }
  }
  // branching coral fingers
  for (let i = 0; i < 30; i++) {
    const [x, z] = coralPos(waterline + 2.6, waterline + 12);
    const y = sandY(profile, x, z) + 0.02;
    const col = coralCols[Math.floor(rng() * coralCols.length) % coralCols.length];
    const room = Math.max(0.05, Math.max(0, profile.depthAt(x, z)) * 0.8);
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
    const [x, z] = coralPos(waterline + 1.2, waterline + 18);
    const y = sandY(profile, x, z) + 0.01;
    const s = 0.16 + rng() * 0.34;
    addLump(x, y, z, s, s * 0.5, s, rng() * TAU, [1.0, 0.95, 0.8]);
  }
  for (let i = 0; i < 80; i++) {
    const [x, z] = coralPos(waterline + 1.0, waterline + 16);
    const y = sandY(profile, x, z) + 0.01;
    const len = Math.min(0.3 + rng() * 0.5, Math.max(0, profile.depthAt(x, z)) * 0.75);
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
  addMesh(ctx, coralGeo, coralMat, 'island-coral', { seabed: true });
  return { tris: b.triangles + coral.triangles };
}

// ----------------------------------------------------------------------- beach scatter

function buildBeachScatter(ctx, params) {
  const { beachInner, seed, profile } = params;
  const b = builder();
  const rng = makeRNG(seed + 63);
  const waterline = profile.waterline;
  // Every scatter band is a *profile* radius band: it is warped per bearing, so shells, pebbles
  // and wrack follow the real sand/water boundary instead of a perfect circle.
  const placement = (flatMin, flatMax) => {
    const angle = rng() * TAU;
    const flat = flatMin + rng() * (flatMax - flatMin);
    const r = warped(flat, angle);
    return [Math.sin(angle) * r, Math.cos(angle) * r, flat];
  };
  // shells (bright, cream/pink) + pebbles (grey/brown) in one pale-stone mesh
  const shellCols = [[1.0, 0.96, 0.86], [0.98, 0.9, 0.84], [0.92, 0.94, 0.9], [1.0, 0.92, 0.78]];
  const pebbleCols = [[0.6, 0.58, 0.52], [0.72, 0.66, 0.56], [0.5, 0.5, 0.47], [0.66, 0.6, 0.5]];
  const proto = rockGeo(1, { detail: 0, seed: 3, flatten: 0.42, tile: 0.8 });
  const tmpMatrix = new THREE.Matrix4();
  const push = (x, y, z, s, ry, col, sy = 0.6) => {
    tmpMatrix.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
      new THREE.Vector3(s, s * sy, s * (0.8 + rng() * 0.4)),
    );
    pushGeo(b, proto, tmpMatrix, col, 1.2);
  };
  for (let i = 0; i < 75; i++) {
    const [x, z] = placement(beachInner + 1.5, waterline - 1.0);
    push(x, sandY(profile, x, z) + 0.01, z, 0.03 + rng() * 0.045, rng() * TAU, shellCols[Math.floor(rng() * 4) % 4], 0.45);
  }
  for (let i = 0; i < 65; i++) {
    const [x, z] = placement(beachInner + 1.2, waterline - 0.9);
    push(x, sandY(profile, x, z) + 0.009, z, 0.05 + rng() * 0.09, rng() * TAU, pebbleCols[Math.floor(rng() * 4) % 4], 0.55);
  }
  // wet-line shells, right where the sand turns dark
  for (let i = 0; i < 28; i++) {
    const [x, z] = placement(waterline - 1.7, waterline - 0.1);
    push(x, sandY(profile, x, z) + 0.01, z, 0.035 + rng() * 0.05, rng() * TAU, shellCols[Math.floor(rng() * 4) % 4], 0.4);
  }
  // Swash marks are intentionally *not* separate geometry: a raised strip reads as a dark seam
  // at grazing angles, and the ocean pass already draws the live swash / wet-sand band from the
  // same profile (`island-shore.js`). The beach keeps its ripple storytelling in vertex colour.
  proto.dispose();
  addMesh(ctx, b.toGeometry(), ctx.materials.ruinStone, 'island-scatter', { seabed: true });

  // dark seaweed wrack + damp-sand sheen along the tide line (one mud-material mesh)
  const w = builder();
  const wrackCols = [[0.78, 0.72, 0.5], [0.86, 0.78, 0.52], [0.7, 0.68, 0.5], [0.92, 0.8, 0.56]];
  for (let i = 0; i < 70; i++) {
    const [x, z] = placement(waterline - 2.4, waterline - 0.2);
    const y = sandY(profile, x, z) + 0.008;
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
  addMesh(ctx, w.toGeometry(), ctx.materials.mud, 'island-tideline', { shadows: true, seabed: true });
  return { tris: b.triangles + w.triangles };
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
  const grassRadius = num(island.grassRadius, 44);
  const beachInner = num(island.beachInner, 41);
  const segments = Math.max(96, Math.round(num(island.segments, 168)));
  const seed = num(island.seed, 7712);

  // One shared shoreline profile drives every sand shell in this file (see island-shore.js).
  const profile = shoreProfile(terrain);
  const paths = collectPaths(ctx);
  const trail = makeTrailMask(paths);
  const spots = collectShadeSpots(ctx);
  // irregular grass rim: big lobes + small crenellation (the spawn apron must stay sand)
  const grassEdge = (angle) => {
    const lobe = (fbm(Math.cos(angle) * 1.8 + seed * 0.013, Math.sin(angle) * 1.8 - 2.3) - 0.5) * 4.8;
    const crenel = (fbm(Math.cos(angle) * 9.2 - 4.4, Math.sin(angle) * 9.2 + 6.1) - 0.5) * 2.6;
    return clamp(grassRadius + lobe + crenel, grassRadius - 3.6, grassRadius + 1.5);
  };

  const params = {
    terrain, profile, grassRadius, beachInner,
    landRadius: profile.landRadius, bedOuter: profile.bedOuter, bedDrop: profile.bedDrop,
    segments, seed, paths, trail, spots, grassEdge,
  };

  const ground = buildGround(ctx, params);
  const litter = buildLitter(ctx, params);
  const beach = buildBeach(ctx, params);
  const scatter = buildBeachScatter(ctx, params);
  const lagoon = buildLagoon(ctx, params);
  const total = ground.tris + litter.tris + beach.tris + scatter.tris + lagoon.tris;
  ctx.terrainTris = {
    ground: ground.tris,
    litter: litter.tris,
    beach: beach.tris,
    scatter: scatter.tris,
    lagoon: lagoon.tris,
    total,
  };

  // Shared shoreline contract for the rest of the world (see src/world/index.js):
  //  - groundHeight: walkable sand height at any (x, z) — player feet + robot ground follow;
  //  - shoreGuard:   the exact radial wading guard (no reef-ring colliders needed);
  //  - shoreProfile: the full profile, consumed by the ocean pass / QA tooling.
  ctx.shoreProfile = profile;
  ctx.groundHeight = (x, z) => profile.Y(x, z);
  ctx.shoreGuard = { guardRadiusAt: profile.guardRadiusAt };
  ctx.shore = ctx.shoreGuard; // legacy alias used by the QA probe

  return { ground: ground.ground };
}

export default buildIslandTerrain;
