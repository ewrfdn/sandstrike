import { baseBox, boxBatch } from '../core.js';
import { addMonument, buildColonnade, SAIL_RIG } from './pillar.js';

export const meta = { id: 'shade-sail', kind: 'world', group: 'architecture', label: '遮阳帆布 · SHADE SAIL' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.pillars = [];
  ctx.stagePick = 'sails';
  buildColonnade(ctx); // builds the tensioned sail + ropes (ropes tie to previewPostTopY)

  // Preview-only rigging: four wooden posts exactly under the sail corners, with two
  // lintel beams riding outside the cloth edges. Nothing passes through the canvas.
  const postH = SAIL_RIG.previewPostTopY;
  for (const p of SAIL_RIG.posts) {
    baseBox(ctx, 'stone', p.x, p.z, 0.42, 0.18, 0.42, { tile: 1.2 });
    boxBatch(ctx, 'wood', p.x, postH / 2 + 0.05, p.z, 0.24, postH, 0.24, { tile: 1.6 });
    boxBatch(ctx, 'wood', p.x, postH - 0.28, p.z, 0.82, 0.16, 0.82, { tile: 1.3 }); // head
  }
  for (const x of [-7.28, 7.28]) {
    boxBatch(ctx, 'wood', x, 4.02, SAIL_RIG.centerZ, 0.34, 0.3, 6.3, { tile: 1.5 });
  }
  // the monument the canvas opening is cut for (otherwise the hole reads as missing cloth)
  addMonument(ctx);
}

/** Map assembly builder: the colonnade (incl. sail + monument) is the map scenery. */
export function buildWorld(ctx) {
  buildColonnade(ctx);
}
