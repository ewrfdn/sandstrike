import * as THREE from 'three';
import { clothMaterial, registerCloth } from '../core.js';
import { makeRNG } from '../../utils.js';

export const meta = { id: 'banner', kind: 'world', group: 'cloth', label: '条幅 · BANNER' };

// Stage-only rigging material (matches the model stage's SUPPORT_MAT).
const SUPPORT_MAT = new THREE.MeshStandardMaterial({ color: 0x5c5245, roughness: 0.85, metalness: 0.05 });

/**
 * Per-request banner creator, used by world.js `buildCloths`.
 * `rng` must be the shared textile RNG owned by buildCloths so the random sequence
 * (and therefore the sway phase) stays identical to the original inline branch.
 */
export function createBanner(ctx, req, rng) {
  const w = req.w;
  const h = req.h;
  const geo = new THREE.PlaneGeometry(w, h, 10, 8);
  const mat = clothMaterial(ctx, req.key);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(req.x, req.y, req.z);
  mesh.rotation.set(req.tilt ?? 0, req.ry ?? 0, 0);
  mesh.name = `banner:${req.key}`;
  ctx.disposables.push(geo);
  ctx.objects.push(mesh);
  registerCloth(ctx, mesh, geo, 'banner', w, h, req.sway ?? 0.09, rng() * 6.28);
}

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  // preview-only scaffolding: support beam/posts so the hanging banner can be judged physically
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.8, 8), SUPPORT_MAT);
  beam.rotation.z = Math.PI / 2;
  beam.position.set(0, 4.25, 0);
  beam.castShadow = true;
  ctx.scene.add(beam);
  for (const sx of [-1.25, 1.25]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.3, 8), SUPPORT_MAT);
    post.position.set(sx, 2.15, 0);
    post.castShadow = true;
    ctx.scene.add(post);
  }
  ctx.req.banners.push({ key: 'title', x: 0, y: 2.55, z: 0, ry: 0, w: 2.4, h: 3.2, sway: 0.03, anchor: 'top' });
}

/** Map assembly builder: materialises every banner request queued by the props pass. */
export function buildWorld(ctx) {
  const rng = makeRNG(1717);
  for (const req of ctx.req.banners) createBanner(ctx, req, rng);
}
