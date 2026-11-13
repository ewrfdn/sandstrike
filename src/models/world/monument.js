import { buildColonnade } from './pillar.js';

export const meta = { id: 'monument', kind: 'world', group: 'hero', label: '纪念碑 · MONUMENT' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.pillars = [];
  ctx.stagePick = 'monument';
  buildColonnade(ctx);
}

/** Map assembly builder: the colonnade pass (pillars + central monument). */
export function buildWorld(ctx) {
  buildColonnade(ctx);
}
