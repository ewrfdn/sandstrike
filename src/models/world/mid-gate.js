import { buildMidWall } from './mid-wall.js';

export const meta = { id: 'mid-gate', kind: 'world', group: 'architecture', label: '中门 · MID GATE' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.stagePick = 'gate';
  ctx.data.layout.walls = [];
  ctx.data.layout.arches = [ctx.data.layout.arches.find((a) => a.label === 'MID GATE')];
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildMidWall(ctx);
}
