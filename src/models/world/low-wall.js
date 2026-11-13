import { baseBox, boxBatch } from '../core.js';
import { makeRNG } from '../../utils.js';

export const meta = { id: 'low-wall', kind: 'world', group: 'architecture', label: '矮墙 · LOW COVER WALL' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.lowWalls = [{ x: 0, z: 0, w: 4.0, d: 0.7, h: 1.25, surface: 'stone' }];
  buildWorld(ctx);
}

/**
 * Map assembly builder: builds every instance from ctx.data.layout.
 * Moved verbatim from world.js buildLowWalls().
 */
export function buildWorld(ctx) {
  const L = ctx.data.layout;
  const rng = makeRNG(2024);
  for (const w of L.lowWalls) {
    const key = w.surface === 'stone' ? 'stone' : 'adobe';
    baseBox(ctx, key, w.x, w.z, w.w, w.h - 0.18, w.d, { tile: w.surface === 'stone' ? 2.0 : 2.2 });
    // irregular coping stones along the top
    const along = w.w > w.d;
    const length = along ? w.w : w.d;
    const count = Math.max(2, Math.round(length / 0.72));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const off = -length / 2 + t * length;
      const cw = length / count - 0.05;
      const ch = 0.14 + rng() * 0.12;
      const cx = along ? w.x + off : w.x;
      const cz = along ? w.z : w.z + off;
      boxBatch(ctx, key, cx, w.h - 0.18 + ch / 2, cz, along ? cw : w.d + 0.1, ch, along ? w.d + 0.1 : cw, { tile: 1.4 });
    }
    // broken brick ends & rubble
    if (rng() > 0.4) {
      boxBatch(ctx, 'stone', w.x + w.w / 2 + 0.25, 0.16, w.z, 0.4, 0.3, w.d * 0.8, { tile: 1.2 });
    }
    if (rng() > 0.5) {
      ctx.req.decals.push({
        x: w.x, y: 0.03, z: w.z + (along ? w.d / 2 + 0.55 : 0), rx: -Math.PI / 2, ry: 0, cell: 'grime',
        w: 1.8, h: 1.8, opacity: 0.55,
      });
    }
  }
}
