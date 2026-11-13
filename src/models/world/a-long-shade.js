import { boxBatch, baseBox, rodBetween } from '../core.js';

export const meta = { id: 'a-long-shade', kind: 'world', group: 'architecture', label: 'A长道遮阳 · A-LONG SHADE' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.hero.aLongShade = { x: 0, z: 0, zs: [-1.6, 0, 1.6] };
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const sh = ctx.data.layout.hero.aLongShade;
  const zs = sh.zs;
  const wallX = sh.x + 1.3;   // east boundary wall inner face sits 1.3 m outboard
  for (const z of zs) {
    baseBox(ctx, 'wood', sh.x, z, 0.3, 0.16, 0.3, { tile: 1.0 });
    boxBatch(ctx, 'wood', sh.x, 1.75, z, 0.24, 3.18, 0.24, { tile: 1.1 });
    // diagonal brace into the wall ledger
    rodBetween(ctx, 'wood', sh.x + 0.1, 3.0, z, wallX, 3.26, z, 0.05, 4);
  }
  // ledger beam bolted along the wall + shade cloth from the posts to the wall
  const zMid = (zs[0] + zs[zs.length - 1]) / 2;
  const zLen = zs[zs.length - 1] - zs[0] + 0.6;
  boxBatch(ctx, 'wood', wallX, 3.3, zMid, 0.14, 0.14, zLen, { tile: 1.2 });
  ctx.req.awnings.push({
    type: 'awning', x: (sh.x + wallX) / 2, y: 3.38, z: zMid, w: wallX - sh.x + 0.12, d: zLen + 0.3, key: 'shade', pitch: 0, ry: 0,
  });
}
