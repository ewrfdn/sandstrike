import { addWindow, baseBox, boxBatch, cylinderBatch, makeSign } from '../core.js';

export const meta = { id: 'warehouse', kind: 'world', group: 'architecture', label: '仓库块 · WAREHOUSE BLOCK' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.blocks = [{ x: 0, z: 0, w: 5.5, d: 4.0, h: 5.4, lane: 'A LONG', door: null }];
  buildWorld(ctx);
}

/**
 * Map assembly builder: builds every instance from ctx.data.layout.
 * Moved verbatim from world.js buildWarehouseBlocks().
 */
export function buildWorld(ctx) {
  const L = ctx.data.layout;
  for (const b of L.blocks) {
    baseBox(ctx, 'adobe', b.x, b.z, b.w, b.h, b.d, { tile: 2.6 });
    baseBox(ctx, 'stone', b.x, b.z, b.w + 0.24, 0.9, b.d + 0.24, { tile: 2.05 });
    boxBatch(ctx, 'stone', b.x, b.h + 0.04, b.z, b.w + 0.12, 0.24, b.d + 0.12, { tile: 2.0 });
    // corrugated roof sheet with a slight lean
    boxBatch(ctx, 'sheet', b.x, b.h + 0.36, b.z, b.w + 0.7, 0.1, b.d + 0.7, { tile: 1.7, ry: 0, });
    for (let i = 0; i < 4; i++) {
      boxBatch(ctx, 'wood', b.x - b.w / 2 + 0.4 + i * (b.w / 3), b.h + 0.22, b.z, 0.14, 0.4, b.d + 0.9, { tile: 1.4 });
    }
    const courtyardFace = b.x > 0 ? -1 : 1;
    const laneFace = -courtyardFace;
    const cfX = b.x + courtyardFace * (b.w / 2 + 0.01);
    const lfX = b.x + laneFace * (b.w / 2 + 0.01);
    // roof parapet must sit on the courtyard roof edge (it used to run across the roof
    // centre, along X, floating on the middle of the slab)
    boxBatch(ctx, 'adobe', b.x + courtyardFace * (b.w / 2 - 0.14), b.h + 0.64, b.z, 0.28, 0.55, b.d + 0.12, { tile: 1.8 });
    // courtyard side: high windows + poster + drainpipe
    for (let i = 0; i < 2; i++) {
      addWindow(ctx, { x: cfX, y: 3.3, z: b.z - 1.5 + i * 3.0, nx: courtyardFace, nz: 0, w: 0.75, h: 1.1, shutters: false });
    }
    ctx.req.posters.push({ x: cfX + courtyardFace * 0.02, y: 1.7, z: b.z + 1.2, ry: courtyardFace > 0 ? Math.PI / 2 : -Math.PI / 2, cell: 'hostile', w: 1.0, h: 1.8 });
    // drainpipe in the clear band between the two courtyard windows
    cylinderBatch(ctx, 'rust', cfX + courtyardFace * 0.22, 2.2, b.z + 0.15, 0.13, 0.13, 4.2, 7);
    // lane side: big loading door + signage + windows
    if (b.d > 3) {
      const doubleW = 3.0;
      boxBatch(ctx, 'rust', lfX + laneFace * 0.02, 1.75, b.z, 0.16, 3.3, doubleW + 0.3, { tile: 1.6 });
      for (const s of [-1, 1]) {
        boxBatch(ctx, 'metal', lfX + laneFace * 0.1, 1.5, b.z + s * (doubleW / 4), 0.12, 2.9, doubleW / 2 - 0.08, { tile: 1.5 });
      }
      // dark recess backing: keep it 0.02 m behind the rust plate's outer face
      // (0.06 put both faces on x = lfX +/- 0.1 and they z-fought in the door gap)
      boxBatch(ctx, 'dark', lfX + laneFace * 0.04, 1.6, b.z, 0.08, 3.0, doubleW - 0.2, { tile: 1 });
      makeSign(ctx, {
        text: b.lane, sub: b.lane === 'A LONG' ? '长 道 / A' : '隧 道 / B',
        x: lfX + laneFace * 0.2, y: 4.05, z: b.z, ry: laneFace > 0 ? Math.PI / 2 : -Math.PI / 2,
        w: 2.0, h: 1.25, seed: b.x > 0 ? 141 : 142, accent: b.lane === 'A LONG' ? '#8f3b2a' : '#2f6470',
      });
    }
    for (let i = 0; i < 2; i++) {
      addWindow(ctx, { x: lfX, y: 4.4, z: b.z - 1.4 + i * 2.8, nx: laneFace, nz: 0, w: 0.6, h: 0.8, shutters: false });
    }
    // lintel over the doorway gap between block segment pairs (the passage is a real
    // walk-through: the old black backing plane across its centre has been removed)
    if (b.door) {
      const d = b.door;
      boxBatch(ctx, 'stone', b.x, d.h + 0.28, d.z, b.w + 0.3, 0.5, d.w + 0.5, { tile: 1.9 });
      // Side posts. The 0.24 m slab is centred so its passage-facing face stands
      // 0.03 m PROUD of the adobe block face. At 0.12 the slab face was exactly
      // coplanar with the block face (z = d.z +/- d.w/2), so the two opaque surfaces
      // z-fought over ~12 m2 of each passage wall and strobed between the stone and
      // adobe textures whenever the camera moved.
      for (const s of [-1, 1]) {
        boxBatch(ctx, 'stone', b.x, d.h / 2, d.z + s * (d.w / 2 + 0.09), b.w + 0.2, d.h, 0.24, { tile: 1.8 });
      }
      makeSign(ctx, {
        text: b.lane, sub: b.lane === 'A LONG' ? 'A 长 道' : 'B 隧 道',
        x: b.x, y: d.h + 0.85, z: d.z + (b.x > 0 ? 0 : 0), ry: Math.PI / 2,
        w: 2.6, h: 1.1, seed: 150 + Math.round(b.x),
      });
    }
  }
}
