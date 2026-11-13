import * as THREE from 'three';
import { matrixFor, boxGeometryWorldUV, boxBatch } from '../core.js';

export const meta = { id: 'pipeline', kind: 'world', group: 'hero', label: '管线 · PIPE RUN' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.stagePick = 'pipeline';
  buildWorld(ctx);
  // preview-only scaffolding: the real pipe run is bolted to the north boundary wall.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 3.4, 0.3), new THREE.MeshStandardMaterial({ color: 0x8a6a49, roughness: 0.95 }));
  wall.position.set(0, 1.7, -0.62);
  wall.receiveShadow = true;
  ctx.scene.add(wall);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  if (ctx.stagePick === 'pipeline') {
    // compact 6 m sample of the north-wall pipe run for isolated inspection
    for (const [y, r] of [[1.35, 0.16], [1.9, 0.11]]) {
      const g = new THREE.CylinderGeometry(r, r, 6, 8);
      ctx.batcher.add('rust', g, matrixFor(0, y, 0, 0, 0, Math.PI / 2));
      g.dispose();
    }
    for (let x = -2.4; x <= 2.4; x += 2.4) {
      const bracket = boxGeometryWorldUV(0.14, 1.4, 0.5, 1);
      ctx.batcher.add('metalDark', bracket, matrixFor(x, 1.4, -0.25));
      bracket.dispose();
    }
    const wheel = new THREE.TorusGeometry(0.3, 0.045, 6, 12);
    ctx.batcher.add('metalDark', wheel, matrixFor(1.4, 1.7, 0.25));
    wheel.dispose();
    const stem = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 5);
    ctx.batcher.add('metalDark', stem, matrixFor(1.4, 1.53, 0.15, Math.PI / 2));
    stem.dispose();
    return;
  }
  // rusty pipe run + valve wheels along the north wall
  for (const [y, r] of [[1.35, 0.16], [1.9, 0.11]]) {
    const g = new THREE.CylinderGeometry(r, r, 62, 8);
    ctx.batcher.add('rust', g, matrixFor(0, y, -32.45, 0, 0, Math.PI / 2));
    g.dispose();
  }
  for (let x = -28; x <= 28; x += 7) {
    const bracket = boxGeometryWorldUV(0.14, 1.4, 0.5, 1);
    ctx.batcher.add('metalDark', bracket, matrixFor(x, 1.4, -32.7));
    bracket.dispose();
  }
  for (const [x, y] of [[-18, 1.35], [4, 1.35], [20, 1.9]]) {
    const wheel = new THREE.TorusGeometry(0.3, 0.045, 6, 12);
    ctx.batcher.add('metalDark', wheel, matrixFor(x, y + 0.35, -32.2, 0, 0, 0));
    wheel.dispose();
    // hub block ties the wheel centre back onto the stem
    boxBatch(ctx, 'metalDark', x, y + 0.35, -32.24, 0.1, 0.1, 0.16, { tile: 0.6 });
    const stem = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 5);
    ctx.batcher.add('metalDark', stem, matrixFor(x, y + 0.18, -32.3, Math.PI / 2));
    stem.dispose();
  }
}
