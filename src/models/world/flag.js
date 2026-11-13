import * as THREE from 'three';
import { clothMaterial, registerCloth } from '../core.js';
import { makeRNG } from '../../utils.js';

export const meta = { id: 'flag', kind: 'world', group: 'cloth', label: '旗帜 · FLAG' };

// Stage-only rigging material (matches the model stage's SUPPORT_MAT).
const SUPPORT_MAT = new THREE.MeshStandardMaterial({ color: 0x5c5245, roughness: 0.85, metalness: 0.05 });

/**
 * Per-request flag creator, used by world.js `buildCloths`.
 * `rng` must be the shared textile RNG owned by buildCloths so the random sequence
 * (and therefore the sway phase) stays identical to the original inline branch.
 */
export function createFlag(ctx, req, rng) {
  const w = req.w;
  const h = req.h;
  const geo = new THREE.PlaneGeometry(w, h, 10, 6);
  geo.translate(w / 2, 0, 0);
  const mat = clothMaterial(ctx, req.key);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(req.x, req.y - h / 2, req.z);
  mesh.rotation.set(0, req.ry ?? 0, 0);
  mesh.name = 'flag';
  ctx.disposables.push(geo);
  ctx.objects.push(mesh);
  registerCloth(ctx, mesh, geo, 'flag', w, h, 0.14, req.phase ?? rng() * 6.28);
}

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  // preview-only scaffolding: pole proxy (the real poles belong to the boundary pass)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 5.0, 8), SUPPORT_MAT);
  pole.position.set(-0.1, 2.5, 0);
  pole.castShadow = true;
  ctx.scene.add(pole);
  ctx.req.flags.push({ x: -0.1, y: 4.7, z: 0, w: 2.3, h: 1.5, ry: 0, key: 'warn', phase: 0.8 });
}

/** Map assembly builder: materialises every flag request queued by the props pass. */
export function buildWorld(ctx) {
  const rng = makeRNG(1717);
  for (const req of ctx.req.flags) createFlag(ctx, req, rng);
}
