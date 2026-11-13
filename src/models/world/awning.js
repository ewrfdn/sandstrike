import * as THREE from 'three';
import { clothMaterial, registerCloth, boxBatch, mergeGeometries } from '../core.js';
import { clamp, makeRNG } from '../../utils.js';

export const meta = { id: 'awning', kind: 'world', group: 'cloth', label: '遮阳篷 · AWNING' };

// Shop-awning cloth/canopy segmentation, used by the merged awning geometry below.
const AWNING_SEG_W = 16;
const AWNING_SEG_D = 10;
const AWNING_SEG_VALANCE = 48; // enough columns for a smooth scalloped hem
const AWNING_SAG = 0.055;
const VALANCE_H = 0.3;
const VALANCE_SCALLOP = 0.05;

/**
 * Shop-awning geometry: a sagging striped panel (local XY plane, +Y = the outward /
 * free front edge, +Z = up after the mesh transform) merged with a hanging front
 * valance; the valance is rotated so it stays world-vertical (fabric hangs under
 * gravity) instead of continuing the panel slope. ONE geometry so the whole awning is
 * a single mesh / material / cloth record.
 *
 * UVs: the valance reuses the panel's U range and continues its V past the panel's
 * front edge (V=1) at the same physical texel density, so the woven stripes stay
 * continuous across the fold (front view: vertical stripes running into the hem).
 */
function buildShopAwningGeometry(w, d, pitch) {
  const panel = new THREE.PlaneGeometry(w, d, AWNING_SEG_W, AWNING_SEG_D);
  const p = panel.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = clamp(p.getX(i) / w + 0.5, 0, 1);
    const v = clamp(p.getY(i) / d + 0.5, 0, 1);
    // cross-span sag + a gentle billow; both fade to zero on the front edge (v=1) so
    // the valance seam stays perfectly straight
    const sag = AWNING_SAG * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    const billow = 0.016 * Math.sin(Math.PI * u * 3) * Math.sin(Math.PI * v) * Math.sin(Math.PI * v);
    p.setZ(i, p.getZ(i) - sag - billow);
  }
  panel.computeVertexNormals();

  const valance = new THREE.PlaneGeometry(w, VALANCE_H, AWNING_SEG_VALANCE, 2);
  valance.rotateX(-Math.PI / 2); // lay the strip vertical: it now hangs along local -Z
  valance.translate(0, d / 2, -VALANCE_H / 2); // top edge sits on the panel's front edge
  const vp = valance.attributes.position;
  const vuv = valance.attributes.uv;
  for (let i = 0; i < vp.count; i++) {
    const isHem = vuv.getY(i) === 1; // bottom row (UV V=1 after the fold)
    const u = clamp(vuv.getX(i), 0, 1);
    // keep texture texel density / stripe phase continuous with the panel
    vuv.setY(i, 1 + vuv.getY(i) * (VALANCE_H / d));
    if (isHem) {
      // scalloped hem: dips up to 5 cm lower between the seams (0.30 → 0.35 m deep)
      const scallop = Math.sin(Math.PI * u * 8);
      vp.setZ(i, vp.getZ(i) - VALANCE_SCALLOP * scallop * scallop);
    }
  }
  if (pitch) {
    // swing the hem back to world-vertical: undo the panel pitch around the top edge
    valance.translate(0, -d / 2, 0);
    valance.rotateX(-pitch);
    valance.translate(0, d / 2, 0);
  }
  valance.computeVertexNormals();

  const geo = mergeGeometries([panel.toNonIndexed(), valance.toNonIndexed()]);
  panel.dispose();
  valance.dispose();
  geo.name = 'cloth:awning';
  return geo;
}

/**
 * Per-request awning/canopy/strip cloth creator, used by world.js `buildCloths`.
 * `rng` must be the shared textile RNG owned by buildCloths so the random sequence
 * (and therefore the sway phase) stays identical to the original inline branch.
 */
export function createAwning(ctx, req, rng) {
  const w = req.w;
  const d = req.d;
  if (req.type === 'strip') {
    const geo = new THREE.PlaneGeometry(w, d, 6, 6);
    const mesh = new THREE.Mesh(geo, clothMaterial(ctx, req.key));
    mesh.position.set(req.x, req.y - d / 2, req.z);
    mesh.rotation.set(0, req.ry ?? 0, 0);
    ctx.disposables.push(geo);
    ctx.objects.push(mesh);
    registerCloth(ctx, mesh, geo, 'strip', w, d, 0.1, rng() * 6.28);
    return;
  }
  if (req.type === 'awning') {
    // real shop awning: sagging striped panel + hanging scalloped front valance in one
    // merged geometry (placement/rotation semantics unchanged for every map caller)
    const geo = buildShopAwningGeometry(w, d, req.pitch ?? 0);
    const mesh = new THREE.Mesh(geo, clothMaterial(ctx, req.key));
    mesh.position.set(req.x, req.y, req.z);
    mesh.rotation.set(-Math.PI / 2 + (req.pitch ?? 0), req.ry ?? 0, 0, 'YXZ');
    mesh.name = 'cloth:awning';
    ctx.disposables.push(geo);
    ctx.objects.push(mesh);
    registerCloth(ctx, mesh, geo, 'awning', w, d, 0.035, rng() * 6.28);
    // support posts requested by a caller (canopies that ask for them; map awnings don't)
    if (req.posts && req.posts.length) {
      for (const [ox, oz] of req.posts) {
        boxBatch(ctx, 'wood', req.x + ox, (req.postH ?? 2.6) / 2, req.z + oz, 0.14, req.postH ?? 2.6, 0.14, { tile: 1.1 });
      }
    }
    return;
  }
  // ---- canopy / sail: untouched legacy flat cloth (sail reworked in pillar.js) ----
  const geo = new THREE.PlaneGeometry(w, d, 12, 8);
  // static sag
  const sag = req.type === 'canopy' ? 0.2 : req.type === 'sail' ? (req.sag ?? 0.5) : 0.05;
  if (sag > 0) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = clamp(p.getX(i) / w + 0.5, 0, 1);
      const v = clamp(p.getY(i) / d + 0.5, 0, 1);
      p.setZ(i, p.getZ(i) - sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
    }
    geo.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geo, clothMaterial(ctx, req.key));
  mesh.position.set(req.x, req.y, req.z);
  mesh.rotation.set(-Math.PI / 2 + (req.pitch ?? 0), req.ry ?? 0, 0, 'YXZ');
  mesh.name = `cloth:${req.type}`;
  ctx.disposables.push(geo);
  ctx.objects.push(mesh);
  registerCloth(ctx, mesh, geo, req.type ?? 'awning', w, d, req.type === 'canopy' ? 0.05 : 0.035, rng() * 6.28);
  // support posts for canopies
  if (req.posts && req.posts.length) {
    for (const [ox, oz] of req.posts) {
      boxBatch(ctx, 'wood', req.x + ox, (req.postH ?? 2.6) / 2, req.z + oz, 0.14, req.postH ?? 2.6, 0.14, { tile: 1.1 });
    }
  }
}

/**
 * Preview builder (stage/WebUI): a self-contained shopfront so the awning can be
 * judged physically — adobe wall mock, wall ledger beam, striped awning, front bar
 * and two ground-standing wooden poles that meet the cloth's front corners.
 */
export function build(ctx) {
  const wallW = 4.6;
  const wallH = 3.35;
  const wallD = 0.35;
  const awningW = 3.6;
  const awningD = 2.6;
  const pitch = -0.3;              // negative: high edge at the wall, slopes down/out (-Z)
  const y = 2.9;                   // cloth centre: wall edge ≈ 3.28 m, front edge ≈ 2.52 m
  const rearY = y + Math.sin(-pitch) * awningD / 2;
  const frontY = y - Math.sin(-pitch) * awningD / 2;
  const rearZ = Math.cos(pitch) * awningD / 2; // wall-side (high) edge
  const frontZ = -rearZ;                       // outward (low) front edge
  const wallZ = rearZ + wallD / 2;

  // ---- adobe shopfront wall mock (front face flush with the awning's high edge) ----
  boxBatch(ctx, 'adobe', 0, wallH / 2, wallZ, wallW, wallH, wallD, { tile: 2.2 });
  const wallFaceZ = rearZ;                 // facade plane
  const recessZ = wallFaceZ - 0.008;       // dark opening panels, just proud of the wall
  const frameZ = wallFaceZ - 0.025;        // protruding wooden frames
  // recessed doorway with jambs, lintel, door leaf and a stone threshold
  const doorW = 1.2;
  const doorH = 2.24;
  boxBatch(ctx, 'dark', 0, doorH / 2, recessZ, doorW, doorH, 0.02, { tile: 1.2 });
  for (const sx of [-1, 1]) {
    boxBatch(ctx, 'woodDark', sx * (doorW / 2 + 0.035), (doorH + 0.07) / 2, frameZ, 0.07, doorH + 0.07, 0.05, { tile: 1.2 });
  }
  boxBatch(ctx, 'woodDark', 0, doorH + 0.035, frameZ, doorW + 0.14, 0.07, 0.05, { tile: 1.2 });
  boxBatch(ctx, 'woodDark', 0, doorH / 2, wallFaceZ - 0.02, doorW - 0.16, doorH - 0.12, 0.03, { tile: 1.4 });
  boxBatch(ctx, 'stone', 0, 0.09, wallFaceZ - 0.04, doorW + 0.2, 0.18, 0.14, { tile: 1.0 });
  // two shop windows under the awning: dark openings, wooden frames, sills and muntins
  for (const sx of [-1, 1]) {
    const wx = sx * 1.45;
    const wW = 0.98;
    const wH = 0.98;
    const wy = 1.78;
    boxBatch(ctx, 'dark', wx, wy, recessZ, wW, wH, 0.02, { tile: 1.2 });
    for (const qx of [-1, 1]) {
      boxBatch(ctx, 'woodDark', wx + qx * (wW / 2 + 0.035), wy, frameZ, 0.07, wH + 0.14, 0.05, { tile: 1.2 });
    }
    boxBatch(ctx, 'woodDark', wx, wy + wH / 2 + 0.035, frameZ, wW + 0.14, 0.07, 0.05, { tile: 1.2 });
    boxBatch(ctx, 'wood', wx, wy - wH / 2 - 0.02, wallFaceZ - 0.035, wW + 0.34, 0.09, 0.12, { tile: 1.1 }); // sill
    // muntins
    boxBatch(ctx, 'woodDark', wx, wy, wallFaceZ - 0.03, 0.035, wH - 0.06, 0.03, { tile: 0.8 });
    boxBatch(ctx, 'woodDark', wx, wy, wallFaceZ - 0.03, wW - 0.06, 0.035, 0.03, { tile: 0.8 });
  }

  // ---- wall ledger beam carrying the awning's high edge + stub brackets ----
  boxBatch(ctx, 'wood', 0, rearY - 0.09, rearZ - 0.06, awningW + 0.28, 0.18, 0.14, { tile: 1.3 });
  for (const sx of [-1, 1]) boxBatch(ctx, 'woodDark', sx * 1.15, rearY - 0.34, rearZ - 0.02, 0.09, 0.5, 0.09, { tile: 1.1 });

  // ---- the striped awning itself (materialised through the real creator path) ----
  ctx.req.awnings.push({ type: 'awning', x: 0, y, z: 0, ry: 0, w: awningW, d: awningD, key: 'awning', pitch });

  // ---- front bar + two wooden poles standing on the ground at the front corners ----
  // (the bar sits just under the cloth fold, behind the world-vertical valance)
  boxBatch(ctx, 'wood', 0, frontY - 0.045, frontZ + 0.07, awningW + 0.02, 0.1, 0.1, { tile: 1.1 });
  for (const sx of [-1, 1]) {
    boxBatch(ctx, 'wood', sx * (awningW / 2 - 0.1), (frontY - 0.095) / 2, frontZ + 0.07, 0.13, frontY - 0.095, 0.13, { tile: 1.1 });
  }
}

/** Map assembly builder: materialises every awning request queued by the props pass. */
export function buildWorld(ctx) {
  const rng = makeRNG(1717);
  for (const req of ctx.req.awnings) createAwning(ctx, req, rng);
}
