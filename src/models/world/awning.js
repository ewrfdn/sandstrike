import * as THREE from 'three';
import { clothMaterial, registerCloth, boxBatch } from '../core.js';
import { clamp, makeRNG } from '../../utils.js';

export const meta = { id: 'awning', kind: 'world', group: 'cloth', label: '遮阳篷 · AWNING' };

// Stage-only rigging material (matches the model stage's SUPPORT_MAT).
const SUPPORT_MAT = new THREE.MeshStandardMaterial({ color: 0x5c5245, roughness: 0.85, metalness: 0.05 });

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

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  // preview-only scaffolding: four posts so the awning's attachment height can be judged
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 3.0, 8), SUPPORT_MAT);
    post.position.set(sx * 2.0, 1.5, sz * 2.0);
    post.castShadow = true;
    ctx.scene.add(post);
  }
  ctx.req.awnings.push({ type: 'awning', x: 0, y: 3.05, z: 0, ry: 0, w: 3.4, d: 3.0, key: 'awning', pitch: 0.3 });
}

/** Map assembly builder: materialises every awning request queued by the props pass. */
export function buildWorld(ctx) {
  const rng = makeRNG(1717);
  for (const req of ctx.req.awnings) createAwning(ctx, req, rng);
}
