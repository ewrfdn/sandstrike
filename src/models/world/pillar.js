import * as THREE from 'three';
import {
  baseBox,
  boxBatch,
  clothMaterial,
  matrixFor,
  mergeGeometries,
  registerCloth,
  rodBetween,
  transformed,
} from '../core.js';

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

/**
 * Colonnade: courtyard pillar rows, lintel beams, the shade sail strung between
 * them and the central monument. Shared by world.js map assembly and by the
 * pillar / monument / shade-sail model previews (the original `ctx.stagePick`
 * guards are kept verbatim so each preview composes exactly like the old stage).
 */
export function buildColonnade(ctx) {
  const L = ctx.data.layout;
  for (let i = 0; i < L.pillars.length; i++) {
    const p = L.pillars[i];
    baseBox(ctx, 'stone', p.x, p.z, p.w + 0.3, 0.35, p.d + 0.3, { tile: 1.7 });
    // shaft ends at the capital underside (was 2 cm proud of the capital slab)
    baseBox(ctx, 'stone', p.x, p.z, p.w, p.h - 0.85, p.d, { tile: 2.0, y0: 0.35 });
    const broken = i === 2 || i === 5;
    if (broken) {
      boxBatch(ctx, 'stone', p.x + 0.12, p.h - 0.2, p.z, p.w * 0.55, 0.3, p.d * 0.6, { tile: 1.4, ry: 0.4 });
    } else {
      baseBox(ctx, 'stone', p.x, p.z, p.w + 0.24, 0.28, p.d + 0.24, { tile: 1.7, y0: p.h - 0.5 });
      baseBox(ctx, 'wood', p.x, p.z, p.w * 0.85, 0.18, p.d * 0.85, { tile: 1.4, y0: p.h - 0.52 });
    }
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
