import * as THREE from 'three';
import { buildColonnade } from './pillar.js';

export const meta = { id: 'shade-sail', kind: 'world', group: 'architecture', label: '遮阳帆布 · SHADE SAIL' };

// Preview-only scaffolding material (was SUPPORT_MAT in the dev model stage).
const SUPPORT_MAT = new THREE.MeshStandardMaterial({ color: 0x5c5245, roughness: 0.85, metalness: 0.05 });

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.pillars = [];
  ctx.stagePick = 'sails';
  buildColonnade(ctx);
  // preview-only scaffolding: the sail is strung between courtyard pillars; stand in
  // four posts so the cloth's attachment height can be judged physically.
  for (const [x, z] of [[-6.9, -20.0], [6.9, -20.0], [-5.3, -10.3], [5.3, -10.3]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.4, 8), SUPPORT_MAT);
    post.position.set(x, 2.2, z);
    post.castShadow = true;
    ctx.scene.add(post);
  }
}

/** Map assembly builder: the colonnade (incl. sail + monument) is the map scenery. */
export function buildWorld(ctx) {
  buildColonnade(ctx);
}
