import * as THREE from 'three';
import { matrixFor, boxGeometryWorldUV, boxBatch } from '../core.js';
import { makeRNG } from '../../utils.js';

export const meta = { id: 'stall', kind: 'world', group: 'hero', label: '集市摊位 · MARKET STALL' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.stalls = [{ x: 0, z: 0, ry: 0 }];
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const L = ctx.data.layout;
  const rng = makeRNG(661);
  for (const s of L.stalls) {
    // counter + front panel
    boxBatch(ctx, 'wood', s.x, 0.55, s.z, 2.9, 0.14, 1.2, { tile: 1.5 });
    boxBatch(ctx, 'wood', s.x, 0.28, s.z + 0.55, 2.9, 0.55, 0.1, { tile: 1.4 });
    boxBatch(ctx, 'wood', s.x, 0.3, s.z, 2.7, 0.42, 0.9, { tile: 1.5 });
    // posts
    for (const [ox, oz] of [[-1.55, -1.45], [1.55, -1.45], [-1.55, 1.45], [1.55, 1.45]]) {
      boxBatch(ctx, 'wood', s.x + ox, 1.3, s.z + oz, 0.13, 2.6, 0.13, { tile: 1.1 });
    }
    // cross beam + awning: flat cloth resting on the 2.60 m post tops / 2.62 m beam
    // (the old 0.3 rad pitch buried the front edge 0.34 m under the beam)
    boxBatch(ctx, 'wood', s.x, 2.56, s.z + 1.45, 3.2, 0.12, 0.12, { tile: 1.3 });
    ctx.req.awnings.push({
      type: 'awning', x: s.x, y: 2.64, z: s.z, ry: 0, w: 3.3, d: 3.0, key: 'awning', pitch: 0,
    });
    // goods
    for (let i = 0; i < 4; i++) {
      const px = s.x - 1.0 + i * 0.62;
      const kind = i % 3;
      if (kind === 0) {
        const jar = new THREE.CylinderGeometry(0.13, 0.1, 0.3, 8);
        ctx.batcher.add('rust', jar, matrixFor(px, 0.74, s.z - 0.1));
        jar.dispose();
      } else if (kind === 1) {
        const basket = new THREE.CylinderGeometry(0.16, 0.13, 0.16, 8, 1, true);
        ctx.batcher.add('wood', basket, matrixFor(px, 0.72, s.z + 0.12));
        basket.dispose();
      } else {
        const g = boxGeometryWorldUV(0.3, 0.22, 0.24, 1);
        ctx.batcher.add('wood', g, matrixFor(px, 0.74, s.z, 0, rng() * 0.5));
        g.dispose();
      }
    }
    // hanging rugs / posters on the back posts
    ctx.req.posters.push({ x: s.x - 1.45, y: 1.8, z: s.z - 1.5, ry: Math.PI, cell: 'travel', w: 1.0, h: 1.7 });
    ctx.req.lanterns.push({ x: s.x + 1.55, y: 2.35, z: s.z + 1.45, kind: 'warm', size: 0.24, hang: 2.5 });
  }
  // awnings posts hold the cloth — flagged in cloth pass by type
}
