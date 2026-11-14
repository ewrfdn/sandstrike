import * as THREE from 'three';
import {
  TAU,
  baseBox,
  boxBatch,
  clothMaterial,
  matrixFor,
  mergeGeometries,
  registerCloth,
  rodBetween,
  transformed,
} from '../core.js';
import {
  boltGeo,
  cylGeo,
  isPreview,
  latheGeo,
  plateGeo,
  put,
  rockGeo,
  torusGeo,
  tubeGeo,
} from './detail.js';

export const meta = { id: 'pillar', kind: 'world', group: 'architecture', label: '石柱 · COLONNADE PILLAR' };

// ---------------------------------------------------------------------------
// Shared shade-sail rig
//
// The courtyard colonnade runs two pillar rows at x = ±7.2 with three pillars per
// row (z = -12.2 / -15.2 / -18.2). The shade sail is tensioned between the four
// CORNER pillars of the two outer rows — that is the fix for the old map bug where
// the sail request sat at z -16.4 +/- 3.6 and missed every pillar.
// ---------------------------------------------------------------------------
export const SAIL_RIG = {
  // cloth corner attachment points (a touch inboard/above the post tops, where the
  // corner ropes tie back to the posts)
  corners: [
    { x: -7.0, z: -18.0 },
    { x: 7.0, z: -18.0 },
    { x: -7.0, z: -12.4 },
    { x: 7.0, z: -12.4 },
  ],
  // post tops the corner ropes tie back to
  posts: [
    { x: -7.2, z: -18.2 },
    { x: 7.2, z: -18.2 },
    { x: -7.2, z: -12.2 },
    { x: 7.2, z: -12.2 },
  ],
  cornerY: 4.15, // sail corners just above the pillar caps
  centerZ: -15.2,
  width: 14.0,
  depth: 5.6,
  // The central monument (layout.hero.monument at 0,-15.2, obelisk top at 4.5 m)
  // stands right under the sail's middle, higher than the canvas sags. The cloth keeps
  // a gridded rectangular opening clear over it so the obelisk passes through the sail
  // instead of being sliced by the canvas (sized to the 24 x 14 cloth grid).
  holeHalfX: (14.0 / 24) * 2, // 1.167 m -> 2.33 m opening across X
  holeHalfY: (5.6 / 14) * 3, // 1.20 m -> 2.40 m opening across Z
  sagEdge: 0.25, // edge midpoints hang this far below the corners
  sagCenter: 0.55, // cloth centre sag (catenary basin)
  amp: 0.055, // cloth sway amplitude (same mechanism as before)
  phase: 0.4,
  previewPostTopY: 4.0, // previews build their own posts at this height
};

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.pillars = [{ x: 0, z: 0, w: 0.95, d: 0.95, h: 4.0, style: 'stone' }];
  ctx.stagePick = 'pillar';
  buildColonnade(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildColonnade(ctx);
}

// ---------------------------------------------------------------------------
// Shade sail: catenary/hypar canvas tensioned between the four corner posts.
// ---------------------------------------------------------------------------

/** Local cloth height at (x, y): negative z sags down (mesh is laid flat by rotation). */
function sailSag(x, y) {
  const u = x / (SAIL_RIG.width / 2); // -1 … 1
  const v = y / (SAIL_RIG.depth / 2);
  const cu = Math.max(0, 1 - u * u);
  const cv = Math.max(0, 1 - v * v);
  // centre basin + the catenary dip of the four edges
  const basin = SAIL_RIG.sagCenter * cu * cv;
  const edges = SAIL_RIG.sagEdge * (u * u * (1 - v * v) + v * v * (1 - u * u));
  // gentle fabric ripples, faded out at the tensioned corners and edges
  const ripple = 0.020 * Math.sin(u * 5.1 + 0.6) * Math.sin(v * 4.3 + 1.2) * cu * cv;
  return -(basin + edges) + ripple;
}

/** Cloth-local (x, y, z) -> world position of the laid-flat sail mesh. */
function sailWorld(x, y, z) {
  return { x, y: SAIL_RIG.cornerY + z, z: SAIL_RIG.centerZ - y };
}

/** Darker binding canvas for the edge tapes and seam lines (shade texture, darkened). */
function sailBindingMaterial(ctx) {
  if (ctx.sailBindingMat) return ctx.sailBindingMat;
  const M = ctx.materials;
  const mat = M.shade.clone();
  mat.name = 'shade-binding';
  mat.color = new THREE.Color(0x93836a);
  mat.side = THREE.DoubleSide;
  mat.needsUpdate = true;
  ctx.sailBindingMat = mat;
  (ctx.materialsCustom || (ctx.materialsCustom = [])).push(mat);
  return mat;
}

/** Flat ribbon strip following the cloth surface (non-indexed, up-facing normals). */
function ribbonStrip(points, width, lift) {
  const n = points.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const nx = -ty;
    const ny = tx;
    const z = sailSag(p.x, p.y) + lift;
    const o = i * 6;
    positions[o] = p.x + nx * (width / 2);
    positions[o + 1] = p.y + ny * (width / 2);
    positions[o + 2] = z;
    positions[o + 3] = p.x - nx * (width / 2);
    positions[o + 4] = p.y - ny * (width / 2);
    positions[o + 5] = z;
    uvs[i * 4] = (i / (n - 1)) * 3.2;
    uvs[i * 4 + 1] = 0;
    uvs[i * 4 + 2] = (i / (n - 1)) * 3.2;
    uvs[i * 4 + 3] = 1;
  }
  const indices = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Edge tapes + stitched seam lines, merged into one geometry that sways with the cloth. */
function makeSailDetails() {
  const W = SAIL_RIG.width;
  const D = SAIL_RIG.depth;
  const strips = [];
  const pushStrip = (points, width, lift) => {
    strips.push(transformed(ribbonStrip(points, width, lift), matrixFor(0, 0, 0)));
  };
  const sample = (ax, ay, bx, by, count) => {
    const pts = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      pts.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
    }
    return pts;
  };
  // edge binding tapes (slightly proud, a touch over the edge like folded canvas tape)
  const inset = 0.10;
  pushStrip(sample(-W / 2 + inset, D / 2, W / 2 - inset, D / 2, 30), 0.07, 0.006);
  pushStrip(sample(-W / 2 + inset, -D / 2, W / 2 - inset, -D / 2, 30), 0.07, 0.006);
  pushStrip(sample(-W / 2, -D / 2 + inset, -W / 2, D / 2 - inset, 16), 0.07, 0.006);
  pushStrip(sample(W / 2, -D / 2 + inset, W / 2, D / 2 - inset, 16), 0.07, 0.006);
  // binding around the monument opening
  const HX = SAIL_RIG.holeHalfX;
  const HY = SAIL_RIG.holeHalfY;
  pushStrip(sample(-HX + 0.03, HY, HX - 0.03, HY, 10), 0.06, 0.006);
  pushStrip(sample(-HX + 0.03, -HY, HX - 0.03, -HY, 10), 0.06, 0.006);
  pushStrip(sample(-HX, -HY + 0.03, -HX, HY - 0.03, 6), 0.06, 0.006);
  pushStrip(sample(HX, -HY + 0.03, HX, HY - 0.03, 6), 0.06, 0.006);
  // three stitched panel seams running along the span (split around the opening)
  for (const y of [-D / 4, 0, D / 4]) {
    if (Math.abs(y) < HY) {
      pushStrip(sample(-W / 2 + 0.2, y, -HX - 0.05, y, 16), 0.022, 0.008);
      pushStrip(sample(HX + 0.05, y, W / 2 - 0.2, y, 16), 0.022, 0.008);
    } else {
      pushStrip(sample(-W / 2 + 0.2, y, W / 2 - 0.2, y, 34), 0.022, 0.008);
    }
  }
  const merged = mergeGeometries(strips);
  for (const s of strips) s.dispose();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Brass/dark corner eyelets: a ring in the cloth plane at each corner + edge midpoint. */
function addSailEyelets(ctx) {
  const W = SAIL_RIG.width;
  const D = SAIL_RIG.depth;
  const ring = new THREE.TorusGeometry(0.052, 0.013, 6, 14);
  const snap = (x, y) => {
    const w = sailWorld(x, y, sailSag(x, y) + 0.012);
    ctx.batcher.add('metalDark', ring, matrixFor(w.x, w.y, w.z, Math.PI / 2, 0, 0));
  };
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) snap((sx * W) / 2, (sy * D) / 2);
    snap((sx * W) / 2, 0); // long-edge midpoints (the sail is lashed to the lintel beams there)
  }
  for (const sy of [-1, 1]) snap(0, (sy * D) / 2);
  // reinforced corners of the monument opening
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) snap(sx * SAIL_RIG.holeHalfX, sy * SAIL_RIG.holeHalfY);
  }
  ring.dispose();
}

/** Find the top of the colonnade post standing at `post` (map) or a preview fallback. */
function postTopY(ctx, post) {
  const pillars = ctx.data.layout.pillars || [];
  for (let i = 0; i < pillars.length; i++) {
    const p = pillars[i];
    if (Math.abs(p.x - post.x) < 0.05 && Math.abs(p.z - post.z) < 0.05) {
      // broken pillars (index 2 and 5 in the layout) have no capital slab
      const broken = i === 2 || i === 5;
      return broken ? p.h - 0.05 : p.h - 0.22;
    }
  }
  return SAIL_RIG.previewPostTopY;
}

/**
 * Cloth canvas as an indexed grid, with the cells over the central monument left open
 * (the opening aligns exactly to grid lines so the rim is a clean rectangle).
 */
function makeSailClothGeometry() {
  const W = SAIL_RIG.width;
  const D = SAIL_RIG.depth;
  const SX = 24;
  const SY = 14;
  const cols = SX + 1;
  const rows = SY + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  for (let iy = 0; iy < rows; iy++) {
    const y = -D / 2 + (iy / SY) * D;
    for (let ix = 0; ix < cols; ix++) {
      const x = -W / 2 + (ix / SX) * W;
      const i = iy * cols + ix;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = sailSag(x, y);
      uvs[i * 2] = (x + W / 2) / W;
      uvs[i * 2 + 1] = (y + D / 2) / D;
    }
  }
  const indices = [];
  for (let iy = 0; iy < SY; iy++) {
    for (let ix = 0; ix < SX; ix++) {
      const cx = -W / 2 + ((ix + 0.5) / SX) * W;
      const cy = -D / 2 + ((iy + 0.5) / SY) * D;
      if (Math.abs(cx) < SAIL_RIG.holeHalfX && Math.abs(cy) < SAIL_RIG.holeHalfY) continue;
      const a = iy * cols + ix;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Build the tensioned shade sail + its rigging. Called from buildColonnade for the map
 *  and from the shade-sail preview (layout.pillars cleared, preview posts added there). */
export function addShadeSail(ctx) {
  const W = SAIL_RIG.width;
  const D = SAIL_RIG.depth;

  // --- canvas ---
  const clothGeo = makeSailClothGeometry();
  const cloth = new THREE.Mesh(clothGeo, clothMaterial(ctx, 'shade'));
  cloth.position.set(0, SAIL_RIG.cornerY, SAIL_RIG.centerZ);
  cloth.rotation.set(-Math.PI / 2, 0, 0, 'YXZ');
  cloth.name = 'shade-sail';
  ctx.disposables.push(clothGeo);
  ctx.objects.push(cloth);
  registerCloth(ctx, cloth, clothGeo, 'sail', W, D, SAIL_RIG.amp, SAIL_RIG.phase);

  // --- binding tapes + stitched seams (sway with the cloth) ---
  const detailGeo = makeSailDetails();
  const details = new THREE.Mesh(detailGeo, sailBindingMaterial(ctx));
  details.position.copy(cloth.position);
  details.rotation.copy(cloth.rotation);
  details.name = 'shade-sail-stitching';
  ctx.disposables.push(detailGeo);
  ctx.objects.push(details);
  registerCloth(ctx, details, detailGeo, 'sail', W, D, SAIL_RIG.amp, SAIL_RIG.phase);

  // --- eyelets ---
  addSailEyelets(ctx);

  // --- corner ropes from the sail corners down to the post tops ---
  for (let i = 0; i < SAIL_RIG.corners.length; i++) {
    const c = SAIL_RIG.corners[i];
    const p = SAIL_RIG.posts[i];
    const topY = postTopY(ctx, p);
    // cloth-local y for this world z corner, then rope down/out to the post head
    const localY = SAIL_RIG.centerZ - c.z;
    const cw = sailWorld(c.x, localY, 0);
    rodBetween(ctx, 'wood', cw.x, cw.y, cw.z, p.x, topY, p.z, 0.019, 5);
    // rope wrap around the post head
    const wrap = new THREE.TorusGeometry(0.055, 0.014, 5, 12);
    ctx.batcher.add('wood', wrap, matrixFor(p.x, topY - 0.02, p.z, Math.PI / 2, 0, 0));
    wrap.dispose();
  }

  // --- edge lashings from the long-edge eyelets to the lintel beams ---
  for (const sx of [-1, 1]) {
    const e = sailWorld((sx * W) / 2, 0, sailSag((sx * W) / 2, 0));
    rodBetween(ctx, 'wood', e.x, e.y, e.z, sx * 7.28, 4.17, SAIL_RIG.centerZ, 0.015, 5);
  }
}

// ===========================================================================
// Stone colonnade pillar
//
// The map used to rough the colonnade out as three boxes per post. The stage
// preview now builds the real thing: stepped ashlar plinth, round attic base
// with turned mouldings, a 24-flute shaft with entasis, a moulded capital with
// corner volutes, and iron cramps / rope ties. `ctx.stage` is the only switch —
// the map path keeps the same silhouette at roughly 2k tris per pillar.
// ===========================================================================

const COLUMN_TILE = 1.9; // metre scale of the stone texture
const COLUMN_ROPE_TILE = 1.2;

/** Vertical proportions, as fractions of H = layout h - 0.22 (the sail rig's post top). */
const COLUMN = Object.freeze({
  plinth: 0.345 / 3.78, // top of the square plinth
  base: 0.72 / 3.78, // top of the round attic base / fluted shaft foot
  head: 2.98 / 3.78, // shaft head / capital underside
  stump: 0.93, // broken pillar: truncated shaft head
});

/** Deterministic 0…1 hash, so every pillar is chipped the same way. */
function hash01(i, seed = 0) {
  const n = Math.sin(i * 91.7 + seed * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Bevelled block of dressed stone — every plain masonry unit in the pillar. */
function block(ctx, key, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0, tile = COLUMN_TILE) {
  const bevel = Math.min(0.013, w * 0.22, h * 0.22, d * 0.22);
  // plateGeo bevels outward by `bevel`; pre-shrink the face so the block keeps the
  // exact requested outer size (matters at the plinth foot / capital top).
  put(ctx, key, plateGeo(w - 2 * bevel, h - 2 * bevel, d, { bevel, tile }), x, y, z, rx, ry, rz);
}

/**
 * One square ashlar course around a pillar axis: a pair of full-length corner
 * stones plus two shorter infill stones on the other pair of faces. `acrossX`
 * swaps the long direction so alternate courses stagger their joints.
 */
function ashlarCourse(ctx, cx, cz, y0, h, half, depth, acrossX) {
  const full = 2 * half;
  const infill = Math.max(0.02, 2 * (half - depth));
  const off = half - depth / 2;
  const yc = y0 + h / 2;
  for (const s of [-1, 1]) {
    if (acrossX) {
      block(ctx, 'stone', cx, yc, cz + s * off, full, h, depth);
      block(ctx, 'stone', cx + s * off, yc, cz, depth, h, infill);
    } else {
      block(ctx, 'stone', cx + s * off, yc, cz, depth, h, full);
      block(ctx, 'stone', cx, yc, cz + s * off, infill, h, depth);
    }
  }
}

/** A small plate laid flat against a face that points radially away from (cx, cz). */
function ringPlate(ctx, key, cx, cz, R, y, a, w, h, d, tile = COLUMN_TILE) {
  const bevel = Math.min(0.008, w * 0.24, h * 0.24, d * 0.24);
  put(ctx, key, plateGeo(w, h, d, { bevel, tile }), cx + Math.cos(a) * R, y, cz + Math.sin(a) * R, 0, Math.PI / 2 - a, 0);
}

/**
 * Fluted column shaft: `flutes` concave channels parted by flat fillets, a slight
 * entasis (belly) up the height and world-scaled UVs. Indexed grid with smooth
 * analytic normals — the flute channels therefore catch the light as real
 * grooves instead of faceting. Both ends stay open and are hidden inside the
 * base / capital mouldings.
 */
function flutedShaftGeo({
  height, rBottom, rTop, flutes, samples, bands, depth,
  filletFrac = 0.27, bulge = 0.012, tile = COLUMN_TILE,
}) {
  const pitch = TAU / flutes;
  const fillet = pitch * filletFrac;
  const channel = pitch - fillet;
  // columns: two fillet edge vertices + (samples - 1) interior channel vertices
  const cols = [];
  for (let f = 0; f < flutes; f++) {
    const a0 = f * pitch;
    cols.push(a0, a0 + fillet);
    for (let i = 1; i < samples; i++) cols.push(a0 + fillet + (channel * i) / samples);
  }
  const C = cols.length;
  const rows = bands + 1;
  const pos = new Float32Array(C * rows * 3);
  const nrm = new Float32Array(C * rows * 3);
  const uv = new Float32Array(C * rows * 2);
  const fluteAt = (a) => {
    const local = a - Math.floor(a / pitch) * pitch;
    if (local <= fillet) return [0, 0];
    const s = (local - fillet) / channel;
    const sn = Math.sin(Math.PI * s);
    // dip (metres, negative) and dr/dθ of the flute surface
    return [depth * sn * sn, (-depth * Math.PI * Math.sin(TAU * s)) / channel];
  };
  for (let r = 0; r < rows; r++) {
    const t = r / bands;
    const y = t * height;
    const R = rBottom + (rTop - rBottom) * t + bulge * Math.sin(Math.PI * t);
    const dRdy = ((rTop - rBottom) + bulge * Math.PI * Math.cos(Math.PI * t)) / height;
    for (let c = 0; c < C; c++) {
      const a = cols[c];
      const [dip, slope] = fluteAt(a);
      const rad = R - dip;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let nx = slope * sa + rad * ca;
      let nz = -slope * ca + rad * sa;
      let ny = -dRdy;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const o = (r * C + c) * 3;
      pos[o] = ca * rad;
      pos[o + 1] = y;
      pos[o + 2] = sa * rad;
      nrm[o] = nx / nl;
      nrm[o + 1] = ny / nl;
      nrm[o + 2] = nz / nl;
      const uo = (r * C + c) * 2;
      uv[uo] = (a * rBottom) / tile;
      uv[uo + 1] = y / tile;
    }
  }
  const index = [];
  for (let r = 0; r < bands; r++) {
    for (let c = 0; c < C; c++) {
      const c2 = (c + 1) % C;
      const a = r * C + c;
      const b = r * C + c2;
      const cc = a + C;
      const d = b + C;
      index.push(a, cc, b, b, cc, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Rope wrapped into the flutes of the shaft (the rope sags into the channels
 * instead of hovering over the lips). Returns a closed tube around the axis.
 */
function flutedRope(ctx, key, cx, cz, y, R, depth, flutes, filletFrac, tube, segs) {
  const pitch = TAU / flutes;
  const fillet = pitch * filletFrac;
  const channel = pitch - fillet;
  const pts = [];
  const n = Math.max(18, segs);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const local = a % pitch;
    let rad = R + tube * 0.55;
    if (local > fillet) {
      const s = (local - fillet) / channel;
      const sn = Math.sin(Math.PI * s);
      rad -= depth * sn * sn;
    }
    pts.push(new THREE.Vector3(cx + Math.cos(a) * rad, y, cz + Math.sin(a) * rad));
  }
  const geo = tubeGeo(pts, tube, { tubularSeg: n, radialSeg: 4, closed: true, tile: COLUMN_ROPE_TILE });
  put(ctx, key, geo, 0, 0, 0);
}

/** Iron staple / cramp: two bolt heads tied by a short strap. */
function cramp(ctx, x, y, z, ry, len = 0.16, scale = 1) {
  block(ctx, 'metalDark', x, y, z, len, 0.022 * scale, 0.045 * scale, 0, ry, 0, 0.8);
  for (const s of [-1, 1]) {
    const geo = boltGeo(0.021 * scale, 0.016 * scale, { tile: 0.6 });
    put(ctx, 'rust', geo, x + Math.cos(ry) * s * len * 0.36, y + 0.012 * scale, z - Math.sin(ry) * s * len * 0.36);
  }
}

/**
 * Colonnade pillar: fluted stone column on a stepped plinth, capped by a moulded
 * capital (or a splintered stump for the two broken corner posts). Built for
 * both the model stage (full detail) and the map LOD (`ctx.stage` undefined).
 */
function buildStonePillar(ctx, p, broken) {
  const hi = isPreview(ctx);
  const k = p.w / 0.95; // radial scale — the mid-gate buttresses are 0.9 wide
  const H = p.h - 0.22; // stone top the sail rig ties its corner ropes to
  const zPlinth = COLUMN.plinth * H;
  const zBase = COLUMN.base * H;
  const zHead = COLUMN.head * H;
  const top = broken ? p.h - 0.05 : H;
  const rFoot = 0.437 * k;
  const rHead = 0.401 * k;

  // ---------------------------------------------------------------- plinth ---
  const plinthHalves = hi ? [0.625, 0.6, 0.575, 0.55] : [0.625, 0.565];
  const plinthHeights = hi ? [0.098, 0.09, 0.082, 0.075] : [0.175, 0.17];
  const plinthScale = zPlinth / plinthHeights.reduce((a, b) => a + b, 0);
  let y = 0;
  for (let i = 0; i < plinthHalves.length; i++) {
    const h = plinthHeights[i] * plinthScale;
    const half = plinthHalves[i] * k;
    if (i === plinthHalves.length - 1) {
      // top course laid as paving slabs so the plinth reads as separate stones
      if (hi) {
        const q = half;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            block(ctx, 'stone', p.x + sx * (q / 2), y + h / 2, p.z + sz * (q / 2), q, h, q);
          }
        }
      } else {
        for (const sx of [-1, 1]) {
          block(ctx, 'stone', p.x, y + h / 2, p.z + sx * (half / 2), half * 2, h, half);
        }
      }
    } else {
      ashlarCourse(ctx, p.x, p.z, y, h, half, Math.min(0.29 * k, half * 0.52), i % 2 === 0);
    }
    // spalled patches on the plinth faces: laid flush and only a few millimetres
    // proud, so the masonry footprint stays exactly the plinth's 1.25 m square
    if (hi) {
      const count = 4;
      for (let c = 0; c < count; c++) {
        const n = i * 7 + c * 3;
        const a = Math.floor(hash01(n, 1) * 4) * (Math.PI / 2);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const along = (hash01(n, 2) - 0.5) * half * 1.3;
        const w = 0.06 + hash01(n, 4) * 0.07;
        const hh = 0.024 + hash01(n, 6) * 0.035;
        const px = p.x + ca * (half - 0.0085) - sa * along;
        const pz = p.z + sa * (half - 0.0085) + ca * along;
        const py = Math.max(y + h * (0.32 + hash01(n, 5) * 0.36), hh / 2 + 0.003);
        put(ctx, 'stoneDark', plateGeo(w, hh, 0.02, { bevel: 0.006, tile: COLUMN_TILE }), px, py, pz, 0, Math.PI / 2 - a, 0);
        // a nibble out of the course edge above the patch
        if (c === 0) {
          put(ctx, 'stoneDark', plateGeo(w * 0.7, 0.018, 0.02, { bevel: 0.005, tile: COLUMN_TILE }),
            p.x + ca * (half - 0.014) - sa * along, y + h - 0.008, p.z + sa * (half - 0.014) + ca * along, 0.18, Math.PI / 2 - a, 0);
        }
      }
    }
    y += h;
  }

  // ------------------------------------------------------------ attic base ---
  const baseSeg = hi ? 24 : 8;
  const baseProfile = [
    [0.5, zPlinth],
    [0.542, zPlinth + 0.012],
    [0.547, zPlinth + 0.052],
    [0.522, zPlinth + 0.082],
    [0.472, zPlinth + 0.102],
    [0.455, zPlinth + 0.136],
    [0.478, zPlinth + 0.156],
    [0.516, zPlinth + 0.172],
    [0.52, zPlinth + 0.208],
    [0.492, zPlinth + 0.238],
    [0.45, zPlinth + 0.262],
    [0.437, zPlinth + 0.278],
  ].map(([r, z]) => [r * k, z]);
  put(ctx, 'stone', latheGeo(baseProfile, { segments: baseSeg, tile: COLUMN_TILE }), p.x, 0, p.z);
  // bead row + leaf tips carved at the scotia / shaft foot
  if (hi) {
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU;
      ringPlate(ctx, 'stone', p.x, p.z, 0.472 * k, zPlinth + 0.122, a, 0.036, 0.026, 0.022);
    }
    for (let i = 0; i < 18; i++) {
      const a = ((i + 0.5) / 18) * TAU;
      ringPlate(ctx, 'stone', p.x, p.z, 0.512 * k, zPlinth + 0.228, a, 0.042, 0.03, 0.024);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      const R = 0.455 * k;
      block(ctx, 'stoneDark', p.x + Math.cos(a) * R, zPlinth + 0.19, p.z + Math.sin(a) * R, 0.075, 0.11, 0.03, 0.25, Math.PI / 2 - a, 0);
      block(ctx, 'stoneDark', p.x + Math.cos(a) * (R + 0.012), zPlinth + 0.255, p.z + Math.sin(a) * (R + 0.012), 0.055, 0.06, 0.03, 0.5, Math.PI / 2 - a, 0);
    }
  }

  // --------------------------------------------------------- fluted shaft ---
  const shaftFoot = zBase - 0.022; // tucked under the base moulding
  const shaftHead = (broken ? COLUMN.stump * H : zHead) + 0.014;
  const shaftGeo = flutedShaftGeo({
    height: shaftHead - shaftFoot,
    rBottom: rFoot,
    rTop: broken ? rFoot - 0.005 : rHead,
    flutes: hi ? 24 : 12,
    samples: hi ? 6 : 2,
    bands: hi ? 24 : 5,
    depth: 0.026 * k,
    filletFrac: 0.3,
    tile: COLUMN_TILE,
  });
  put(ctx, 'stone', shaftGeo, p.x, shaftFoot, p.z);

  // rope ties cinched into the flutes, with hanging tails and knots
  const ropeBands = hi ? [0.3, 0.62] : [0.45];
  for (const f of ropeBands) {
    const t = f;
    const yy = shaftFoot + (shaftHead - shaftFoot) * t;
    const R = rFoot + (rHead - rFoot) * t + 0.012 * Math.sin(Math.PI * t);
    flutedRope(ctx, 'wood', p.x, p.z, yy, R, 0.026 * k, hi ? 24 : 12, 0.3, 0.014 * k, hi ? 48 : 10);
    if (!hi) continue;
    // knot + tail hanging down the shaft face
    block(ctx, 'wood', p.x + Math.cos(1.1) * (R + 0.012), yy, p.z + Math.sin(1.1) * (R + 0.012), 0.055, 0.045, 0.045, 0.2, 1.1, 0.5, 1.2);
    const tail = [];
    const a0 = 1.1;
    for (let i = 0; i <= 4; i++) {
      const d = (i / 4) * 0.34;
      const a = a0 + i * 0.05;
      const rad = R + 0.009;
      tail.push(new THREE.Vector3(p.x + Math.cos(a) * rad, yy - 0.03 - d, p.z + Math.sin(a) * rad));
    }
    put(ctx, 'wood', tubeGeo(tail, 0.013 * k, { tubularSeg: 10, radialSeg: 4, tile: COLUMN_ROPE_TILE }), 0, 0, 0);
  }

  if (broken) {
    // splintered stump: the two broken corner posts keep their old 3.95 m head,
    // where the shade-sail corner ropes are tied off.
    const stumpBase = shaftHead - 0.1;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.4;
      const lean = 0.1 + hash01(i, 21) * 0.22;
      block(
        ctx, 'stone',
        p.x + Math.cos(a) * rFoot * 0.42, stumpBase + 0.06 + i * 0.028, p.z + Math.sin(a) * rFoot * 0.42,
        0.2 + hash01(i, 22) * 0.16, 0.18 + hash01(i, 23) * 0.2, 0.16 + hash01(i, 24) * 0.12,
        lean * Math.sin(a), a, lean * Math.cos(a)
      );
    }
    block(ctx, 'stone', p.x + 0.1, top - 0.05, p.z - 0.02, 0.34, 0.16, 0.3, 0.16, 0.7, 0.1);
    const core = cylGeo(0.17 * k, 0.21 * k, 0.22, { radial: 10, tile: COLUMN_TILE, open: false });
    put(ctx, 'stoneDark', core, p.x, top - 0.13, p.z);
    return;
  }

  // --------------------------------------------------------------- capital ---
  const capSeg = hi ? 24 : 10;
  const astra = torusGeo(0.425 * k, 0.019 * k, { radialSeg: hi ? 8 : 5, tubularSeg: capSeg, tile: COLUMN_TILE });
  put(ctx, 'stone', astra, p.x, zHead + 0.022, p.z, Math.PI / 2, 0, 0);
  const neck = latheGeo([
    [0.4 * k, zHead + 0.034],
    [0.394 * k, zHead + 0.062],
    [0.402 * k, zHead + 0.082],
    [0.418 * k, zHead + 0.1],
  ], { segments: capSeg, tile: COLUMN_TILE });
  put(ctx, 'stone', neck, p.x, 0, p.z);
  const echinusTop = zHead + 0.3;
  const echinus = latheGeo([
    [0.418 * k, zHead + 0.1],
    [0.427 * k, zHead + 0.14],
    [0.452 * k, zHead + 0.19],
    [0.492 * k, zHead + 0.24],
    [0.532 * k, zHead + 0.28],
    [0.548 * k, echinusTop],
  ], { segments: capSeg, tile: COLUMN_TILE });
  put(ctx, 'stone', echinus, p.x, 0, p.z);
  if (hi) {
    // egg-and-dart moulding carved around the top of the echinus
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + 0.09;
      const egg = latheGeo([
        [0.001, 0], [0.024, 0.005], [0.032, 0.016], [0.028, 0.03], [0.014, 0.04], [0.001, 0.045],
      ], { segments: 10, tile: COLUMN_TILE });
      put(ctx, 'stone', egg, p.x + Math.cos(a) * 0.522 * k, zHead + 0.258, p.z + Math.sin(a) * 0.522 * k, Math.PI / 2, Math.PI / 2 - a, 0);
      ringPlate(ctx, 'stoneDark', p.x, p.z, 0.535 * k, zHead + 0.296, a, 0.026, 0.042, 0.022);
    }
    // leaf ring wrapping the foot of the echinus (hugging its flare)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.26;
      ringPlate(ctx, 'stone', p.x, p.z, 0.428 * k, zHead + 0.185, a, 0.06, 0.1, 0.036);
      ringPlate(ctx, 'stoneDark', p.x, p.z, 0.438 * k, zHead + 0.135, a, 0.045, 0.07, 0.03);
    }
  }
  // wooden capital collar banded with iron (kept from the old timber posting head)
  const collarY = echinusTop + 0.036;
  const collar = cylGeo(0.5 * k, 0.516 * k, 0.075, { radial: hi ? 20 : 10, tile: 1.4 });
  put(ctx, 'wood', collar, p.x, collarY, p.z);
  const hoop = torusGeo(0.515 * k, 0.011, { radialSeg: 5, tubularSeg: hi ? 20 : 12, tile: 0.8 });
  put(ctx, 'metalDark', hoop, p.x, collarY + 0.008, p.z, Math.PI / 2, 0, 0);

  // abacus: two ashlar courses + paving-slab top
  const abacus0 = collarY + 0.038;
  const abacusTop = top;
  const lowerH = (abacusTop - abacus0) * 0.42;
  const upperH = (abacusTop - abacus0) * 0.34;
  const capH = abacusTop - abacus0 - lowerH - upperH;
  ashlarCourse(ctx, p.x, p.z, abacus0, lowerH, 0.535 * k, 0.26 * k, true);
  ashlarCourse(ctx, p.x, p.z, abacus0 + lowerH, upperH, 0.585 * k, 0.3 * k, false);
  const q = 0.585 * k;
  const capBlockH = capH;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      block(ctx, 'stone', p.x + sx * (q / 2), abacusTop - capBlockH / 2, p.z + sz * (q / 2), q, capBlockH, q);
    }
  }
  if (hi) {
    // rosettes carved on the four abacus faces
    for (let f = 0; f < 4; f++) {
      const a = (f / 4) * TAU;
      for (const s of [-1, 1]) {
        const lat = Math.PI / 2 - a;
        const x = p.x + Math.cos(a) * 0.588 * k + Math.cos(a + Math.PI / 2) * s * 0.17 * k;
        const z = p.z + Math.sin(a) * 0.588 * k + Math.sin(a + Math.PI / 2) * s * 0.17 * k;
        put(ctx, 'stone', latheGeo([
          [0.001, 0], [0.028, 0.004], [0.04, 0.014], [0.034, 0.026], [0.016, 0.033], [0.001, 0.036],
        ], { segments: 10, tile: COLUMN_TILE }), x, abacus0 + lowerH + upperH * 0.45, z, Math.PI / 2, lat, 0);
      }
    }
    // corner volutes: nautilus scrolls on the four abacus corners
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      const ox = Math.cos(a);
      const oz = Math.sin(a);
      const centre = new THREE.Vector3(p.x + ox * 0.5 * k, zHead + 0.315, p.z + oz * 0.5 * k);
      const pts = [];
      for (let n = 0; n <= 18; n++) {
        const tt = n / 18;
        const ang = tt * TAU * 1.6;
        const rad = 0.082 * (1 - 0.78 * tt);
        pts.push(new THREE.Vector3(
          centre.x + ox * rad * Math.cos(ang),
          centre.y + rad * Math.sin(ang) + 0.03,
          centre.z + oz * rad * Math.cos(ang)
        ));
      }
      put(ctx, 'stone', tubeGeo(pts, 0.014 * k, { tubularSeg: 20, radialSeg: 5, tile: COLUMN_TILE }), 0, 0, 0);
    }
    // abacus edge chips
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.35;
      block(ctx, 'stoneDark', p.x + Math.cos(a) * 0.581 * k, abacus0 + lowerH + upperH * 0.5, p.z + Math.sin(a) * 0.581 * k,
        0.06 + hash01(i, 31) * 0.05, 0.03 + hash01(i, 32) * 0.04, 0.03 + hash01(i, 33) * 0.035,
        hash01(i, 34) * 0.4, Math.PI / 2 - a, hash01(i, 35) * 0.4);
    }
  }

  // ------------------------------------------------------------ weathering ---
  const chips = hi ? 16 : 2;
  for (let i = 0; i < chips; i++) {
    const n = 100 + i * 5;
    const a = hash01(n, 1) * TAU;
    const yy = zBase + hash01(n, 2) * (zHead - zBase);
    const t = (yy - shaftFoot) / (shaftHead - shaftFoot);
    const R = rFoot + (rHead - rFoot) * t;
    // shallow spall patch sitting in the flute lip, only a couple of mm proud
    block(
      ctx, 'stoneDark', p.x + Math.cos(a) * (R - 0.006), yy, p.z + Math.sin(a) * (R - 0.006),
      0.045 + hash01(n, 3) * 0.06, 0.02 + hash01(n, 4) * 0.035, 0.014,
      0.12, Math.PI / 2 - a, 0.1
    );
  }
  const cracks = hi ? 8 : 1;
  for (let i = 0; i < cracks; i++) {
    const n = 160 + i * 4;
    const a = hash01(n, 1) * TAU;
    const yy = zBase + 0.12 + hash01(n, 2) * (zHead - zBase - 0.2);
    const t = (yy - shaftFoot) / (shaftHead - shaftFoot);
    const R = rFoot + (rHead - rFoot) * t;
    // hairline crack laid flat on the stone: no tilt, so the ends cannot lift off
    // the curved face and read as a floating fin
    put(ctx, 'stoneDark', plateGeo(0.009 + hash01(n, 3) * 0.008, 0.1 + hash01(n, 4) * 0.1, 0.006, { bevel: 0.0015, tile: COLUMN_TILE }),
      p.x + Math.cos(a) * (R + 0.0005), yy, p.z + Math.sin(a) * (R + 0.0005), 0, Math.PI / 2 - a, 0);
  }
  // moss / grime settling on the plinth steps and at the shaft foot
  if (hi) {
    for (let i = 0; i < 10; i++) {
      const n = 200 + i * 3;
      const a = (i / 10) * TAU + hash01(n, 1) * 0.3;
      const R = (0.47 + hash01(n, 2) * 0.08) * k;
      const d = 0.05 + hash01(n, 5) * 0.05;
      block(ctx, 'stoneDark', p.x + Math.cos(a) * R, 0.012 + hash01(n, 3) * 0.03, p.z + Math.sin(a) * R,
        0.1 + hash01(n, 4) * 0.12, 0.014, d,
        0, Math.PI / 2 - a, 0);
    }
    // soot / dirt collected in the bottom of a few flutes (sits on the flute floor)
    for (let i = 0; i < 10; i++) {
      const a = ((i * 7) / 24) * TAU + 0.04;
      const yy = zBase + 0.1 + hash01(i, 41) * 0.5;
      const t = (yy - shaftFoot) / (shaftHead - shaftFoot);
      const R = rFoot + (rHead - rFoot) * t - 0.022;
      put(ctx, 'stoneDark', plateGeo(0.016, 0.18 + hash01(i, 42) * 0.36, 0.012, { bevel: 0.002, tile: COLUMN_TILE }),
        p.x + Math.cos(a) * R, yy, p.z + Math.sin(a) * R, 0, Math.PI / 2 - a, 0);
    }
    // old iron dowel plugs / weathered pitting holes on the flute lips
    for (let i = 0; i < 8; i++) {
      const a = ((i * 5 + 1.4) / 24) * TAU;
      const yy = zBase + 0.18 + hash01(i, 51) * (zHead - zBase - 0.4);
      const t = (yy - shaftFoot) / (shaftHead - shaftFoot);
      const R = rFoot + (rHead - rFoot) * t;
      put(ctx, 'stoneDark', plateGeo(0.03, 0.03, 0.012, { bevel: 0.003, tile: 0.6 }),
        p.x + Math.cos(a) * (R - 0.002), yy, p.z + Math.sin(a) * (R - 0.002), 0, Math.PI / 2 - a, 0);
    }
  }
  // iron staples (repairs): on the base moulding
  const staples = hi ? 6 : 1;
  for (let i = 0; i < staples; i++) {
    const a = (i / staples) * TAU + 0.6;
    cramp(ctx, p.x + Math.cos(a) * 0.5 * k, zPlinth + 0.2, p.z + Math.sin(a) * 0.5 * k, Math.PI / 2 - a, 0.12, k);
  }
  // fallen chips of stone resting on the plinth ledge (never outside the 1.25 m
  // masonry footprint, and never floating off the course faces)
  const rubble = hi ? 6 : 1;
  for (let i = 0; i < rubble; i++) {
    const n = 240 + i * 3;
    const a = hash01(n, 1) * TAU;
    const dist = (0.53 + hash01(n, 2) * 0.045) * k;
    const r = 0.018 + hash01(n, 3) * 0.026;
    const geo = rockGeo(r, { detail: hi ? 1 : 0, seed: i + 2, flatten: 0.62, tile: COLUMN_TILE });
    geo.rotateY(hash01(n, 4) * TAU);
    geo.rotateZ((hash01(n, 5) - 0.5) * 0.4);
    geo.computeBoundingBox();
    const yy = zPlinth - geo.boundingBox.min.y + 0.002;
    ctx.batcher.add('stoneDark', geo, matrixFor(p.x + Math.cos(a) * dist, yy, p.z + Math.sin(a) * dist));
    geo.dispose();
  }
}

/**
 * Colonnade: courtyard pillar rows, lintel beams, the shade sail strung between
 * them and the central monument. Shared by world.js map assembly and by the
 * pillar / monument / shade-sail model previews (the original `ctx.stagePick`
 * guards are kept verbatim so each preview composes exactly like the old stage).
 */
export function buildColonnade(ctx) {
  const L = ctx.data.layout;
  for (let i = 0; i < L.pillars.length; i++) {
    buildStonePillar(ctx, L.pillars[i], i === 2 || i === 5);
  }
  // lintel beams on the outside of the sail's long edges (narrowed and shifted out so
  // the tensioned cloth cannot clip them — the sail edge eyelets lash down to them)
  if (!ctx.stagePick) for (const z of [-15.2]) {
    for (const x of [-7.28, 7.28]) {
      boxBatch(ctx, 'wood', x, 4.02, z, 0.34, 0.3, 3.3, { tile: 1.5 });
    }
  }
  // tensioned shade sail over the courtyard, tied to the four corner pillars
  if (!ctx.stagePick || ctx.stagePick === 'sails') {
    addShadeSail(ctx);
  }

  // central monument (broken obelisk with cyan emitter)
  if (!ctx.stagePick || ctx.stagePick === 'monument') {
    addMonument(ctx);
  }
}

/** Central broken-obelisk monument. Shared by the colonnade and the monument preview. */
export function addMonument(ctx) {
  const m = ctx.data.layout.hero.monument;
  baseBox(ctx, 'stone', m.x, m.z, 3.5, 0.9, 3.5, { tile: 2.0 });
  baseBox(ctx, 'stone', m.x, m.z, 2.2, 0.35, 2.2, { tile: 1.7, y0: 0.9 });
  baseBox(ctx, 'stone', m.x, m.z, 1.25, 3.0, 1.25, { tile: 1.9, y0: 1.25 });
  boxBatch(ctx, 'stone', m.x, 4.35, m.z, 1.35, 0.3, 1.35, { tile: 1.4, ry: 0.2 });
  // tech bands flush to the four obelisk faces (round torus rings used to clip the
  // square shaft at its corners and float off the flat faces)
  for (let i = 0; i < 3; i++) {
    const y = 2.0 + i * 0.8;
    for (const s of [-1, 1]) {
      boxBatch(ctx, 'metalDark', m.x + s * 0.645, y, m.z, 0.05, 0.09, 1.45, { tile: 0.7 });
      boxBatch(ctx, 'metalDark', m.x, y, m.z + s * 0.645, 1.45, 0.09, 0.05, { tile: 0.7 });
    }
  }
  // glowing emitter seams: the cyan core is enclosed by the stone shaft, so expose it
  // as four flush light slots on the shaft faces (it used to be completely buried)
  const core = new THREE.CylinderGeometry(0.34, 0.42, 1.5, 8);
  ctx.batcher.add('glowCyan', core, matrixFor(m.x, 3.1, m.z));
  core.dispose();
  for (const s of [-1, 1]) {
    boxBatch(ctx, 'glowCyan', m.x + s * 0.64, 3.1, m.z, 0.03, 1.15, 0.2, { tile: 0.6 });
    boxBatch(ctx, 'glowCyan', m.x, 3.1, m.z + s * 0.64, 0.2, 1.15, 0.03, { tile: 0.6 });
  }
  ctx.req.lights.push({ x: m.x, y: 3.2, z: m.z, color: 0x73e6ff, intensity: 5, distance: 7, kind: 'pulse' });
  ctx.req.decals.push({ x: m.x, y: 0.03, z: m.z, rx: -Math.PI / 2, ry: 0, cell: 'chevrons', w: 3.0, h: 3.0, opacity: 0.6 });
}
