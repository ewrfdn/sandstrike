import { addArchMesh, baseBox, makeSign } from '../core.js';

export const meta = { id: 'site-arch', kind: 'world', group: 'architecture', label: 'A点拱门 · SITE ARCH' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.siteArches = [ctx.data.layout.siteArches[0]];
  buildWorld(ctx);
}

/**
 * Map assembly builder: builds every instance from ctx.data.layout.
 * Moved verbatim from world.js buildSiteArches().
 */
export function buildWorld(ctx) {
  const L = ctx.data.layout;
  for (const a of L.siteArches) {
    addArchMesh(ctx, a);
    // base plinths for the free-standing pillars
    const off = a.span / 2 - a.pierW / 2;
    for (const s of [-1, 1]) {
      baseBox(ctx, 'stone', a.x + s * off, a.z, a.pierW + 0.5, 0.5, a.depth + 0.5, { tile: 1.7 });
    }
    // hanging sign under the arch
    makeSign(ctx, {
      text: a.cell === 'A' ? 'A SITE' : 'B SITE', sub: a.cell === 'A' ? 'A 点 · 阿 尔 法' : 'B 点 · 布 拉 沃',
      x: a.x, y: a.height - 0.75, z: a.z + 0.62, ry: 0, w: 2.4, h: 1.05,
      seed: a.cell === 'A' ? 181 : 182, accent: a.cell === 'A' ? '#8f3b2a' : '#2f6470',
    });
    // big wall stencil behind the site (ground decal handled in decals pass)
  }
}
