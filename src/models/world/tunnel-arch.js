import { addArchMesh } from '../core.js';

export const meta = { id: 'tunnel-arch', kind: 'world', group: 'architecture', label: '隧道拱 · TUNNEL ARCH' };

/** Preview builder (stage/WebUI): the old stage entry drew the B-tunnel arch. */
export function build(ctx) {
  addArchMesh(ctx, ctx.data.layout.tunnelArches[0]);
}

/**
 * Map assembly: catalog-only model — the map tunnel arches are not built here.
 * They are emitted by world.js buildTunnel() from ctx.data.layout.tunnelArches
 * (that builder stays in world.js), so there is no independent map pass.
 */
export function buildWorld(ctx) {
  void ctx;
}
