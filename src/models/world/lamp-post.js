import * as THREE from 'three';
import { boxBatch, baseBox, cylinderBatch } from '../core.js';

export const meta = { id: 'lamp-post', kind: 'world', group: 'architecture', label: '路灯 · LAMP POST' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.lampPosts = [[0, 0]];
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const posts = ctx.data.layout.lampPosts;
  for (const [x, z] of posts) {
    // plinth + pole
    baseBox(ctx, 'stone', x, z, 0.36, 0.28, 0.36, { tile: 1.0 });
    cylinderBatch(ctx, 'metalDark', x, 1.8, z, 0.055, 0.09, 3.04, 8);
    boxBatch(ctx, 'metal', x, 0.42, z, 0.2, 0.12, 0.2, { tile: 0.8 });
    // arm points across the nearest street/plaza (inwards towards x=0)
    const dirX = Math.abs(x) >= 1 ? -Math.sign(x) : 0;
    const dirZ = dirX === 0 ? (z >= 0 ? -1 : 1) : 0;
    const ry = Math.atan2(dirX, dirZ);
    const armLen = 0.52;
    boxBatch(ctx, 'metalDark', x + dirX * armLen * 0.5, 3.08, z + dirZ * armLen * 0.5, 0.09, 0.09, armLen + 0.16, { tile: 0.9, ry });
    const hx = x + dirX * armLen;
    const hz = z + dirZ * armLen;
    boxBatch(ctx, 'metalDark', hx, 3.02, hz, 0.3, 0.06, 0.3, { tile: 0.8, ry });
    boxBatch(ctx, 'glowWarm', hx, 2.86, hz, 0.22, 0.26, 0.22, { tile: 0.6, ry });
    for (const s of [-1, 1]) {
      boxBatch(ctx, 'metalDark', hx + s * 0.15, 2.86, hz, 0.03, 0.3, 0.03, { tile: 0.6 });
      boxBatch(ctx, 'metalDark', hx, 2.86, hz + s * 0.15, 0.03, 0.3, 0.03, { tile: 0.6 });
    }
    ctx.req.lanterns.push({ x: hx, y: 2.84, z: hz, kind: 'warm', size: 0.3 });
  }
}
