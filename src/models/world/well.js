import * as THREE from 'three';
import { matrixFor, boxBatch } from '../core.js';

export const meta = { id: 'well', kind: 'world', group: 'hero', label: '水井 · WELL' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const M = ctx.materials;
  const B = ctx.batcher;
  const w = ctx.data.layout.hero.well;
  // base + stone ring
  const base = new THREE.CylinderGeometry(2.35, 2.5, 0.22, 20, 1);
  B.add('stone', base, matrixFor(w.x, 0.11, w.z));
  base.dispose();
  const ring = new THREE.CylinderGeometry(2.1, 2.16, 0.95, 20, 1, true);
  B.add('stone', ring, matrixFor(w.x, 0.62, w.z));
  ring.dispose();
  const rim = new THREE.TorusGeometry(2.1, 0.1, 6, 22);
  B.add('stone', rim, matrixFor(w.x, 1.1, w.z, Math.PI / 2));
  rim.dispose();
  const inner = new THREE.CylinderGeometry(1.8, 1.8, 1.2, 18, 1, true);
  B.add('dark', inner, matrixFor(w.x, 0.6, w.z));
  inner.dispose();
  // water surface
  const waterGeo = new THREE.CircleGeometry(1.78, 20);
  const water = new THREE.Mesh(waterGeo, M.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(w.x, 0.86, w.z);
  water.name = 'well-water';
  ctx.scene.add(water);
  ctx.objects.push(water);
  ctx.disposables.push(waterGeo);
  void M;
  // winch frame
  for (const [ox, oz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) {
    boxBatch(ctx, 'wood', w.x + ox, 1.65, w.z + oz, 0.17, 3.3, 0.17, { tile: 1.2 });
  }
  boxBatch(ctx, 'wood', w.x, 3.2, w.z - 1.7, 3.7, 0.18, 0.18, { tile: 1.3 });
  boxBatch(ctx, 'wood', w.x, 3.2, w.z + 1.7, 3.7, 0.18, 0.18, { tile: 1.3 });
  boxBatch(ctx, 'wood', w.x - 1.7, 3.2, w.z, 0.18, 0.18, 3.7, { tile: 1.3 });
  boxBatch(ctx, 'wood', w.x + 1.7, 3.2, w.z, 0.18, 0.18, 3.7, { tile: 1.3 });
  // winch drum + rope + bucket
  const drumGeo = new THREE.CylinderGeometry(0.18, 0.18, 2.4, 8);
  ctx.batcher.add('wood', drumGeo, matrixFor(w.x, 2.55, w.z - 1.2, 0, 0, Math.PI / 2));
  drumGeo.dispose();
  const ropeGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.9, 5);
  ctx.batcher.add('metalDark', ropeGeo, matrixFor(w.x, 1.7, w.z - 1.2));
  ropeGeo.dispose();
  const bucketGeo = new THREE.CylinderGeometry(0.22, 0.18, 0.34, 9, 1, true);
  ctx.batcher.add('rust', bucketGeo, matrixFor(w.x, 0.85, w.z - 1.2));
  bucketGeo.dispose();
  // canopy cloth draped over the winch frame top beams (y 3.2, top face 3.29) —
  // it used to float 0.45 m above the posts, yawed 0.4 rad off the square frame
  ctx.req.awnings.push({ type: 'canopy', x: w.x, y: 3.32, z: w.z, w: 4.0, d: 4.0, key: 'awning', pitch: 0.06, ry: 0, postH: 3.3, posts: [] });
  // hanging lantern, rod top meets the +z frame beam
  ctx.req.lanterns.push({ x: w.x + 1.2, y: 2.86, z: w.z + 1.7, kind: 'warm', size: 0.3, hang: 3.3 });
  ctx.req.lights.push({ x: w.x, y: 2.9, z: w.z, color: 0xffa050, intensity: 7, distance: 8, kind: 'flicker' });
  // water jars beside it
  for (const [ox, oz] of [[2.6, 1.2], [2.9, 0.2]]) {
    const jar = new THREE.CylinderGeometry(0.24, 0.16, 0.55, 9);
    ctx.batcher.add('rust', jar, matrixFor(w.x + ox, 0.28, w.z + oz));
    jar.dispose();
  }
  ctx.req.decals.push({ x: w.x + 2.9, y: 0.03, z: w.z + 1.0, rx: -Math.PI / 2, ry: 0, cell: 'grime', w: 2.6, h: 2.6, opacity: 0.5 });
}
