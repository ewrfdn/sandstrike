/**
 * SANDSTRIKE // sandstorm protocol — static architecture assembly.
 *
 * Split verbatim out of src/world.js (ensureBatches / buildTunnel /
 * buildArchitecture). The per-model builders live under src/models/world/ and
 * read their layout from `ctx.data.layout`; only the B-tunnel dressing below
 * (roof panels, timber posts, parapet, signs, hanging cloth, stencils) stays
 * hard-coded here because it is procedural building code, not map data.
 */
import { addArchMesh, makeSign, boxBatch, baseBox } from '../models/core.js';
import { buildBoundary } from '../models/world/boundary.js';
import { buildMidWall } from '../models/world/mid-wall.js';
import { buildWorld as buildBazaarRows } from '../models/world/bazaar-shop.js';
import { buildWorld as buildWarehouseBlocks } from '../models/world/warehouse.js';
import { buildWorld as buildLowWalls } from '../models/world/low-wall.js';
import { buildColonnade } from '../models/world/pillar.js';
import { buildWorld as buildSiteArches } from '../models/world/site-arch.js';

function ensureBatches(ctx) {
  const M = ctx.materials;
  const B = ctx.batcher;
  const def = (key, material, surface, opts = {}) =>
    B.ensure(key, {
      material,
      surface,
      bakeAO: opts.bakeAO ?? false,
      castShadow: opts.castShadow ?? true,
      receiveShadow: opts.receiveShadow ?? true,
      collide: opts.collide ?? true,
    });
  def('adobe', M.adobe, 'stone', { bakeAO: true });
  def('adobeLight', M.adobeLight, 'stone', { bakeAO: true });
  def('stone', M.stone, 'stone', { bakeAO: true });
  def('stoneDark', M.stoneDark, 'stone', { bakeAO: true });
  def('wood', M.wood, 'wood', { bakeAO: true });
  def('woodDark', M.woodDark, 'wood', { bakeAO: true });
  def('metal', M.metal, 'metal');
  def('metalDark', M.metalDark, 'metal');
  def('rust', M.rust, 'metal');
  def('sheet', M.sheet, 'metal');
  def('rubber', M.rubber, 'metal');
  def('dark', M.dark, 'stone', { castShadow: false, collide: false });
  def('glass', M.glass, 'stone', { castShadow: false, collide: false });
  def('crate', M.crate, 'wood');
  def('glowWarm', M.glowWarm, 'metal', { castShadow: false, collide: false });
  def('glowCyan', M.glowCyan, 'metal', { castShadow: false, collide: false });
  def('coals', M.coals, 'stone', { castShadow: false, collide: false });
  def('tarp', M.tarp, 'fabric', { bakeAO: false });
  def('awning', M.awning, 'fabric', {});

  // --------------------------------------------------------------- island map
  // Tropical island keys (see ISLAND_ASSETS.md §5). Foliage cards are alpha-tested,
  // so they cast cut-out shadows but never collect bullet decals (`collide:false`
  // only drops them from the raycast surface list — real collision is map data).
  // Only registered for island-style maps: defining empty batches for outpost-07 used
  // to leave 40+ unused meshes/objects in its scene (world-verify stats regression).
  if (ctx.data?.style === 'island') {
    def('jungleGrass', M.jungleGrass, 'sand', { bakeAO: true });
    def('leafLitter', M.leafLitter, 'sand', { bakeAO: true });
    def('broadleaf', M.broadleaf, 'fabric', { bakeAO: false, collide: false });
    def('broadleafDark', M.broadleafDark, 'fabric', { bakeAO: false, collide: false });
    def('frondLush', M.frondLush, 'fabric', { bakeAO: false, collide: false });
    def('canopy', M.canopy, 'fabric', { bakeAO: false, collide: false });
    def('canopyDark', M.canopyDark, 'fabric', { bakeAO: false, collide: false });
    def('canopyPale', M.canopyPale, 'fabric', { bakeAO: false, collide: false });
    def('grassBlade', M.grassBlade, 'fabric', { bakeAO: false, collide: false });
    def('grassBladeDry', M.grassBladeDry, 'fabric', { bakeAO: false, collide: false });
    def('thatch', M.thatch, 'fabric', { bakeAO: false });
    def('thatchDark', M.thatchDark, 'fabric', { bakeAO: false });
    def('barkTrop', M.barkTrop, 'wood', { bakeAO: true });
    def('barkMoss', M.barkMoss, 'wood', { bakeAO: true });
    def('bamboo', M.bamboo, 'wood', { bakeAO: true });
    def('mossStone', M.mossStone, 'stone', { bakeAO: true });
    def('ruinStone', M.ruinStone, 'stone', { bakeAO: true });
    def('ruinStoneDark', M.ruinStoneDark, 'stone', { bakeAO: true });
    def('shoreRock', M.shoreRock, 'stone', { bakeAO: true });
    def('beachSand', M.beachSand, 'sand', { bakeAO: true });
    def('woven', M.woven, 'fabric', { bakeAO: false });
    def('rope', M.rope, 'fabric', { bakeAO: false });
    def('driftWood', M.driftWood, 'wood', { bakeAO: true });
    def('mud', M.mud, 'sand', { bakeAO: true });
  }
}

// ------------------------------------------------------------------ B tunnel

function buildTunnel(ctx) {
  const L = ctx.data.layout;
  // covered passage roof. Panel depth matches the 2.26 m bay spacing: with the old
  // 2.36 m depth neighbouring panels overlapped 0.10 m, so their coplanar underside
  // faces z-fought in 11.4 m long strips across the ceiling.
  for (let z = -10.2; z >= -19.2; z -= 2.26) {
    boxBatch(ctx, 'sheet', -27.0, 3.5, z, 11.4, 0.1, 2.26, { tile: 1.6 });
  }
  for (const z of [-10.6, -13.4, -16.2, -19.0]) {
    boxBatch(ctx, 'wood', -27.0, 3.3, z, 11.5, 0.26, 0.24, { tile: 1.4 });
    // support posts flush to the walls
    for (const x of [-32.82, -21.16]) {
      baseBox(ctx, 'wood', x, z, 0.22, 3.3, 0.22, { tile: 1.2 });
    }
  }
  // low parapet along the tunnel roof edges
  for (const x of [-32.6, -21.4]) {
    boxBatch(ctx, 'adobe', x, 3.72, -14.6, 0.28, 0.4, 9.8, { tile: 1.8 });
  }
  // arches
  for (const a of L.tunnelArches) addArchMesh(ctx, a);
  // hanging lanterns + warm practicals
  for (const [x, z, flick] of [[-27, -11.8, 1], [-27, -15.2, 0], [-24.6, -18.4, 1], [-29.6, -10.0, 0]]) {
    ctx.req.lanterns.push({ x, y: 2.85, z, kind: 'warm', size: 0.34, hang: 3.3 });
    if (flick) ctx.req.lights.push({ x, y: 2.7, z, color: 0xff9a44, intensity: 13, distance: 13, kind: 'flicker' });
  }
  // signs at both portals
  makeSign(ctx, { text: 'B TUNNEL', sub: '西 隧 道', x: -24.0, y: 3.0, z: -9.42, ry: Math.PI, w: 2.6, h: 1.1, seed: 171, accent: '#2f6470' });
  makeSign(ctx, { text: 'B SITE', sub: 'B 点', x: -24.0, y: 3.0, z: -19.7, ry: 0, w: 2.3, h: 1.0, seed: 172, accent: '#2f6470' });
  // cloth strips hanging from the roof for warmth
  for (const [x, z] of [[-31.2, -12.4], [-22.8, -15.8], [-30.4, -18.2]]) {
    ctx.req.awnings.push({ type: 'strip', x, y: 3.35, z, w: 1.2, d: 2.2, key: 'awning', ry: 0.1, pitch: 0, strip: true });
  }
  // wall stencils
  for (const [x, z, cell] of [[-32.9, -12.6, 'tracks'], [-21.1, -16.2, 'tag'], [-32.9, -17.2, 'num07']]) {
    ctx.req.decals.push({ x, y: 1.6, z, rx: 0, ry: Math.PI / 2, cell, w: 1.6, h: 1.6, opacity: 0.75 });
  }
}

function buildArchitecture(ctx) {
  ensureBatches(ctx);
  buildBoundary(ctx);
  buildMidWall(ctx);
  buildBazaarRows(ctx);
  buildWarehouseBlocks(ctx);
  buildLowWalls(ctx);
  buildColonnade(ctx);
  buildTunnel(ctx);
  buildSiteArches(ctx);
}

export { ensureBatches, buildTunnel, buildArchitecture };
export default buildArchitecture;
