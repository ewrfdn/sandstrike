import { boxBatch, baseBox, cylinderBatch } from '../core.js';

export const meta = { id: 'flagpole', kind: 'world', group: 'cloth', label: '旗杆+旗 · FLAGPOLE' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.hero.flagpoles = [{ x: 0, z: 0, h: 7.6 }];
  buildWorld(ctx);
  // preview-only: the stage requests the flag cloth explicitly (map path queues it in buildCloths)
  ctx.req.flags.push({ x: 0, y: 7.25, z: 0, w: 2.3, h: 1.5, ry: 0.35, key: 'title', phase: 0.8 });
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  for (const f of ctx.data.layout.hero.flagpoles) {
    baseBox(ctx, 'stone', f.x, f.z, 0.5, 0.34, 0.5, { tile: 1.0 });
    cylinderBatch(ctx, 'wood', f.x, 3.95, f.z, 0.1, 0.14, 7.3, 8);
    // finial + halyard cleat (the cleat also gives the hanging cloth a real fitting)
    cylinderBatch(ctx, 'stone', f.x, 7.76, f.z, 0.015, 0.1, 0.3, 8);
    boxBatch(ctx, 'metalDark', f.x, 7.42, f.z, 0.16, 0.06, 0.16, { tile: 0.6 });
    boxBatch(ctx, 'metalDark', f.x, 6.15, f.z, 0.26, 0.07, 0.26, { tile: 0.6 });
  }
}
