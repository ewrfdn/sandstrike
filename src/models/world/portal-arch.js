import { addArchMesh } from '../core.js';

export const meta = { id: 'portal-arch', kind: 'world', group: 'architecture', label: '中门侧拱 · PORTAL ARCH' };

/** Preview builder (stage/WebUI): the old stage entry drew one stone portal arch. */
export function build(ctx) {
  addArchMesh(ctx, { x: 0, z: 0, span: 6.0, height: 4.4, depth: 1.6, pierW: 0.3, rot: 0, style: 'stone' });
}

/**
 * Map assembly: catalog-only model — the map portal arches are not built here.
 * They are emitted by mid-wall.js buildMidWall(ctx) from ctx.data.layout.arches
 * (arch.kind !== 'shopPass'), so there is no independent map pass for this file.
 */
export function buildWorld(ctx) {
  void ctx;
}
