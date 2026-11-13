import {
  addArchMesh,
  addDoor,
  addWindow,
  baseBox,
  boxBatch,
  cylinderBatch,
  makeSign,
} from '../core.js';

export const meta = { id: 'bazaar-shop', kind: 'world', group: 'architecture', label: '集市店铺 · BAZAAR SHOP' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.buildings = [{ x: 0, z: 0, w: 5.6, d: 8.2, h: 5.2, style: 'shop', rows: 2 }];
  ctx.data.layout.arches = [];
  buildWorld(ctx);
  addArchMesh(ctx, { x: 0, z: 0, span: 3.0, height: 4.4, depth: 5.6, pierW: 0.08, rot: Math.PI / 2, style: 'adobe' });
}

/**
 * Map assembly builder: builds every instance from ctx.data.layout.
 * Moved verbatim from world.js buildBazaarRows().
 */
export function buildWorld(ctx) {
  const L = ctx.data.layout;
  for (const b of L.buildings) {
    const plazaSign = b.x > 0 ? -1 : 1; // plaza face normal x
    const faceX = b.x + plazaSign * (b.w / 2 + 0.01);
    baseBox(ctx, 'adobe', b.x, b.z, b.w, b.h, b.d, { tile: 2.5 });
    // stone podium plinth: notched across the shop door on the plaza face so the
    // 2.25 m door leaf is not buried behind the 0.85 m base course
    {
      const plinthW = b.w + 0.22;
      const plinthD = b.d + 0.22;
      const doorGap = 1.8;
      const sideD = (plinthD - doorGap) / 2;
      baseBox(ctx, 'stone', b.x, b.z - doorGap / 2 - sideD / 2, plinthW, 0.85, sideD, { tile: 2.0 });
      baseBox(ctx, 'stone', b.x, b.z + doorGap / 2 + sideD / 2, plinthW, 0.85, sideD, { tile: 2.0 });
      baseBox(ctx, 'stone', b.x - plazaSign * 0.12, b.z, plinthW - 0.24, 0.85, doorGap, { tile: 2.0 });
    }
    boxBatch(ctx, 'stone', b.x, b.h + 0.06, b.z, b.w + 0.16, 0.26, b.d + 0.16, { tile: 2.0 });
    // roof parapet
    for (const s of [-1, 1]) {
      boxBatch(ctx, 'adobe', b.x + s * (b.w / 2 - 0.16), b.h + 0.5, b.z, 0.3, 0.62, b.d + 0.1, { tile: 1.8 });
      boxBatch(ctx, 'adobe', b.x, b.h + 0.5, b.z + s * (b.d / 2 - 0.16), b.w + 0.1, 0.62, 0.3, { tile: 1.8 });
    }
    // corner quoins
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        boxBatch(ctx, 'stone', b.x + sx * (b.w / 2 - 0.1), b.h / 2, b.z + sz * (b.d / 2 - 0.1), 1.0, b.h - 0.6, 1.0, { tile: 2.2 });
      }
    }
    // windows on the plaza face
    const count = b.rows + 1;
    for (let i = 0; i < count; i++) {
      const z = b.z - b.d / 2 + (b.d / (count + 1)) * (i + 1);
      addWindow(ctx, { x: faceX, y: 3.0, z, nx: plazaSign, nz: 0, w: 0.9, h: 1.25, shutters: i % 2 === 0 });
    }
    // ground floor shop front on the plaza face
    addDoor(ctx, { x: faceX, y: 1.15, z: b.z, nx: plazaSign, nz: 0, w: 1.2, h: 2.25 });
    // storefront awning projects off the facade (was offset 0.9 m the wrong way and
    // buried inside the adobe); pitch sign keeps the high edge at the wall
    ctx.req.awnings.push({
      type: 'awning', x: faceX + plazaSign * 0.9, y: 2.85, z: b.z,
      ry: plazaSign > 0 ? -Math.PI / 2 : Math.PI / 2,
      w: 4.0, d: 1.7, key: 'awning', pitch: -0.32,
    });
    makeSign(ctx, {
      text: b.x > 0 ? 'BAZAAR' : 'SUPPLY', sub: b.x > 0 ? '东 市' : '军 需',
      x: faceX + plazaSign * 0.02, y: b.rows > 1 ? 4.3 : 3.75, z: b.z,
      ry: plazaSign > 0 ? Math.PI / 2 : -Math.PI / 2,
      w: 2.0, h: 0.9, seed: 120 + Math.round(b.x),
    });
    // street face details
    const streetSign = b.x > 0 ? 1 : -1;
    const streetX = b.x + streetSign * (b.w / 2 + 0.01);
    for (let i = 0; i < 2; i++) {
      addWindow(ctx, { x: streetX, y: 3.2, z: b.z - b.d / 2 + 1.6 + i * 2.6, nx: streetSign, nz: 0, w: 0.7, h: 1.0, shutters: false });
    }
    ctx.req.posters.push({ x: streetX + streetSign * 0.03, y: 1.9, z: b.z - 1.4, ry: streetSign > 0 ? Math.PI / 2 : -Math.PI / 2, cell: 'ammo', w: 0.95, h: 1.7 });
    // roof clutter: water tank + vent
    if (b.h > 4.6) {
      cylinderBatch(ctx, 'rust', b.x + streetSign * 1.2, b.h + 1.1, b.z + 1.6, 0.55, 0.55, 1.3, 9);
      for (const s of [-1, 1]) {
        boxBatch(ctx, 'wood', b.x + streetSign * 1.2 + s * 0.45, b.h + 0.3, b.z + 1.6, 0.12, 0.55, 0.12, { tile: 1 });
      }
      boxBatch(ctx, 'metalDark', b.x - streetSign * 1.5, b.h + 0.45, b.z - 1.2, 0.9, 0.5, 0.6, { tile: 1.2 });
    }
    // shop awning posts + a couple of hanging rugs on the street face
    ctx.req.posters.push({ x: streetX + streetSign * 0.03, y: 2.8, z: b.z + 1.9, ry: streetSign > 0 ? Math.PI / 2 : -Math.PI / 2, cell: 'travel', w: 0.9, h: 1.6 });
  }
  // archways through the bazaar rows
  for (const a of L.arches) {
    if (a.kind === 'shopPass') addArchMesh(ctx, a);
  }
}
