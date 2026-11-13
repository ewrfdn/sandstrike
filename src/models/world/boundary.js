/**
 * Map boundary walls, corner towers, watchtower, gate/staging signage.
 * Pure map builder (not previewed): moved verbatim out of world.js buildBoundary.
 */
import {
  TAU,
  addCrenellationsAlongX,
  addCrenellationsAlongZ,
  baseBox,
  boxBatch,
  faceRotation,
  makeSign,
  rodBetween,
} from '../core.js';

export function buildBoundary(ctx) {
  const L = ctx.data.layout;
  // main wall volumes + plinth + cornice
  for (const b of L.boundary) {
    boxBatch(ctx, 'adobe', b.x, b.h / 2, b.z, b.w, b.h, b.d, { tile: 2.6 });
    const horizontal = b.w > b.d;
    const baseW = horizontal ? b.w : b.d + 0.34;
    const baseD = horizontal ? b.d + 0.34 : b.w;
    if (horizontal) {
      boxBatch(ctx, 'stone', b.x, 0.6, b.z, b.w + 0.06, 1.2, b.d + 0.3, { tile: 2.1 });
      // stone coping: sits 0.02 m above the adobe body top (was flush at b.h, which
      // left two coplanar up-facing surfaces z-fighting across the whole wall top)
      boxBatch(ctx, 'stone', b.x, b.h - 0.14, b.z, b.w + 0.06, 0.32, b.d + 0.32, { tile: 2.1 });
    } else {
      boxBatch(ctx, 'stone', b.x, 0.6, b.z, b.w + 0.3, 1.2, b.d + 0.06, { tile: 2.1 });
      boxBatch(ctx, 'stone', b.x, b.h - 0.14, b.z, b.w + 0.32, 0.32, b.d + 0.06, { tile: 2.1 });
    }
    void baseW;
    void baseD;
  }

  // crenellations on the four walls
  addCrenellationsAlongX(ctx, -32.4, 32.4, 33.22, 6.9);
  addCrenellationsAlongX(ctx, -32.4, 32.4, -33.22, 6.9);
  addCrenellationsAlongZ(ctx, -32.4, 32.4, 33.22, 6.9);
  addCrenellationsAlongZ(ctx, -32.4, 32.4, -33.22, 6.9);

  // pilasters + arrow slits on the inside faces
  for (let x = -28; x <= 28; x += 8) {
    boxBatch(ctx, 'adobeLight', x, 2.7, 32.88, 1.25, 5.1, 0.36, { tile: 2.2 });
    boxBatch(ctx, 'adobeLight', x, 2.7, -32.88, 1.25, 5.1, 0.36, { tile: 2.2 });
  }
  for (let z = -28; z <= 28; z += 8) {
    boxBatch(ctx, 'adobeLight', 32.88, 2.7, z, 0.36, 5.1, 1.25, { tile: 2.2 });
    boxBatch(ctx, 'adobeLight', -32.88, 2.7, z, 0.36, 5.1, 1.25, { tile: 2.2 });
  }
  for (let x = -24; x <= 24; x += 12) {
    boxBatch(ctx, 'dark', x, 3.9, 32.94, 0.26, 1.05, 0.1, { tile: 1 });
    boxBatch(ctx, 'dark', x + 3, 3.9, -32.94, 0.26, 1.05, 0.1, { tile: 1 });
  }
  for (let z = -24; z <= 24; z += 12) {
    boxBatch(ctx, 'dark', 32.94, 3.9, z, 0.1, 1.05, 0.26, { tile: 1 });
    boxBatch(ctx, 'dark', -32.94, 3.9, z, 0.1, 1.05, 0.26, { tile: 1 });
  }

  // corner towers
  for (const t of L.towers) {
    if (t.kind !== 'corner') continue;
    baseBox(ctx, 'adobe', t.x, t.z, t.w, t.h, t.d, { tile: 2.4 });
    baseBox(ctx, 'stone', t.x, t.z, t.w + 0.3, 1.3, t.d + 0.3, { tile: 2.0 });
    // tower crown
    boxBatch(ctx, 'adobe', t.x, t.h + 0.35, t.z, t.w + 0.4, 0.7, t.d + 0.4, { tile: 2.2 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      boxBatch(ctx, 'adobe', t.x + Math.cos(a) * (t.w * 0.62), t.h + 0.95, t.z + Math.sin(a) * (t.d * 0.62), 0.9, 0.6, 0.9, { tile: 1.8 });
    }
    // arrow slit windows, one per face
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      boxBatch(ctx, 'dark', t.x + Math.cos(a) * (t.w / 2 + 0.01), 5.4, t.z + Math.sin(a) * (t.d / 2 + 0.01), Math.abs(Math.cos(a)) > 0.5 ? 0.1 : 0.5, 1.2, Math.abs(Math.sin(a)) > 0.5 ? 0.1 : 0.5, { tile: 1 });
    }
    // lanterns on brackets on the inward x face (they used to be buried inside the
    // adobe volume because they were offset on x AND z towards the corner)
    const inX = Math.sign(-t.x);
    const inZ = Math.sign(-t.z);
    const faceX = t.x + inX * (t.w / 2 + 0.05);
    boxBatch(ctx, 'metalDark', faceX + inX * 0.17, 6.55, t.z + inZ * 1.35, 0.34, 0.06, 0.06, { tile: 0.8 });
    ctx.req.lanterns.push({
      x: faceX + inX * 0.34, y: 6.16, z: t.z + inZ * 1.35, kind: 'warm', size: 0.28, hang: 6.52,
    });
    // banner flat on the inward x face (was floating diagonally across the corner)
    ctx.req.banners.push({
      key: 'title', x: faceX + inX * 0.02, y: 4.6, z: t.z,
      ry: faceRotation(inX, 0), w: 2.0, h: 3.6, sway: 0.03, anchor: 'top',
    });
  }

  // south-east wooden watchtower on its adobe base
  const wt = L.hero.watchtower;
  baseBox(ctx, 'adobe', wt.x, wt.z, wt.w, wt.h, wt.d, { tile: 2.4 });
  baseBox(ctx, 'stone', wt.x, wt.z, wt.w + 0.25, 0.9, wt.d + 0.25, { tile: 1.9 });
  boxBatch(ctx, 'wood', wt.x, wt.h + 0.14, wt.z, 3.5, 0.28, 3.5, { tile: 1.6 });
  // railings
  for (const [ox, oz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    boxBatch(ctx, 'wood', wt.x + ox, wt.h + 0.85, wt.z + oz, 0.16, 1.4, 0.16, { tile: 1.2 });
  }
  for (const s of [-1, 1]) {
    boxBatch(ctx, 'wood', wt.x + s * 1.6, wt.h + 1.45, wt.z, 0.14, 0.1, 3.3, { tile: 1.4 });
    boxBatch(ctx, 'wood', wt.x, wt.h + 1.45, wt.z + s * 1.6, 3.3, 0.1, 0.14, { tile: 1.4 });
    boxBatch(ctx, 'wood', wt.x + s * 1.6, wt.h + 1.0, wt.z, 0.1, 0.9, 3.1, { tile: 1.4 });
  }
  // canopy roof: posts stand on the deck (top of the 3.5 m platform is 6.68), so the
  // cloth no longer floats 2.3 m above the watchtower
  const deckTop = wt.h + 0.28;
  ctx.req.awnings.push({
    type: 'canopy', x: wt.x, y: deckTop + 2.27, z: wt.z, w: 4.0, d: 4.0,
    key: 'awning', pitch: 0, ry: 0, postH: deckTop, posts: [],
  });
  for (const [ox, oz] of [[-1.62, -1.62], [1.62, -1.62], [-1.62, 1.62], [1.62, 1.62]]) {
    boxBatch(ctx, 'wood', wt.x + ox, deckTop + 1.135, wt.z + oz, 0.14, 2.27, 0.14, { tile: 1.2 });
    // corner knee brace under the roof
    rodBetween(ctx, 'wood', wt.x + ox * 0.82, deckTop + 0.35, wt.z + oz * 0.82, wt.x + ox, deckTop + 1.5, wt.z + oz, 0.045, 5);
  }
  // ladder rungs up the base (south side)
  for (let i = 0; i < 8; i++) {
    boxBatch(ctx, 'wood', wt.x - 0.9, 0.6 + i * 0.72, wt.z + wt.d / 2 + 0.12, 0.9, 0.09, 0.12, { tile: 1 });
  }
  boxBatch(ctx, 'wood', wt.x - 1.34, 3.4, wt.z + wt.d / 2 + 0.12, 0.1, 5.6, 0.12, { tile: 1.2 });
  boxBatch(ctx, 'wood', wt.x - 0.46, 3.4, wt.z + wt.d / 2 + 0.12, 0.1, 5.6, 0.12, { tile: 1.2 });

  // stencilled number plates on staging walls
  makeSign(ctx, { text: 'OUTPOST 07', sub: '前 哨 基 地', x: 0, y: 4.9, z: 32.94, ry: Math.PI, w: 3.4, h: 1.5, seed: 71 });
  makeSign(ctx, { text: 'STAGING', sub: '集 结 区', x: -9.6, y: 3.0, z: 32.93, ry: Math.PI, w: 2.4, h: 1.1, seed: 72 });
  makeSign(ctx, { text: 'SECTOR 7', sub: '第 七 区', x: 9.6, y: 3.0, z: 32.93, ry: Math.PI, w: 2.4, h: 1.1, seed: 73 });
}
