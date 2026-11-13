/**
 * Map mid wall / MID GATE gatehouse, doors, arches and approach.
 * Pure map builder (not previewed): moved verbatim out of world.js buildMidWall.
 * mid-gate.js imports buildMidWall from here for its catalog preview.
 */
import {
  addArchMesh,
  addCrenellationsAlongX,
  baseBox,
  boxBatch,
  cylinderBatch,
  makeSign,
} from '../core.js';

export function buildMidWall(ctx) {
  const L = ctx.data.layout;
  for (const w of L.walls) {
    boxBatch(ctx, 'adobe', w.x, w.h / 2, w.z, w.w, w.h, w.d, { tile: 2.5 });
    boxBatch(ctx, 'stone', w.x, 0.5, w.z, w.w, 1.0, w.d + 0.26, { tile: 2.0 });
    // stone coping raised 0.02 m above the adobe body top to avoid coplanar z-fight
    boxBatch(ctx, 'stone', w.x, w.h - 0.14, w.z, w.w, 0.32, w.d + 0.3, { tile: 2.0 });
    // parapet crenellation along the courtyard-facing side
    addCrenellationsAlongX(ctx, w.x - w.w / 2 + 0.4, w.x + w.w / 2 - 0.4, w.z - 0.25, w.h + 0.38, 2.3);
    // pilasters on both faces
    for (let x = w.x - w.w / 2 + 2.2; x < w.x + w.w / 2 - 1.2; x += 4.4) {
      boxBatch(ctx, 'adobeLight', x, w.h / 2, w.z + w.d / 2 + 0.14, 0.9, w.h - 0.4, 0.3, { tile: 2.1 });
      boxBatch(ctx, 'adobeLight', x, w.h / 2, w.z - w.d / 2 - 0.14, 0.9, w.h - 0.4, 0.3, { tile: 2.1 });
    }
  }
  // gate piers
  for (const p of ctx.data.layout.gatePiers) {
    baseBox(ctx, 'stone', p.x, p.z, p.w, p.h, p.d, { tile: 1.8 });
    boxBatch(ctx, 'stone', p.x, 0.4, p.z, p.w + 0.16, 0.8, p.d + 0.16, { tile: 1.8 });
    boxBatch(ctx, 'stone', p.x, p.h - 0.2, p.z, p.w + 0.14, 0.4, p.d + 0.14, { tile: 1.8 });
  }

  // gatehouse body above the doorway
  boxBatch(ctx, 'adobe', 0, 5.75, -8.5, 9.4, 3.1, 2.0, { tile: 2.3 });
  boxBatch(ctx, 'stone', 0, 7.45, -8.5, 9.7, 0.3, 2.3, { tile: 2.0 });
  addCrenellationsAlongX(ctx, -4.3, 4.3, -8.7, 7.62, 1.9);
  // machicolation corbels
  for (let x = -4.2; x <= 4.2; x += 0.82) {
    boxBatch(ctx, 'stone', x, 4.05, -7.55, 0.3, 0.5, 0.5, { tile: 1.2 });
  }
  boxBatch(ctx, 'adobe', 0, 4.45, -7.6, 9.4, 0.42, 0.7, { tile: 2.0 });
  // merlon caps along gatehouse
  for (const s of [-1, 1]) {
    boxBatch(ctx, 'adobe', s * 2.6, 8.0, -8.5, 1.2, 0.7, 2.1, { tile: 1.8 });
  }
  // flagpole on the gatehouse
  cylinderBatch(ctx, 'wood', 3.4, 9.4, -8.5, 0.07, 0.1, 3.8, 6);
  ctx.req.flags.push({ x: 3.4, y: 11.2, z: -8.5, w: 1.8, h: 1.15, ry: Math.PI / 2, key: 'warn', phase: 1.7 });

  // doors: both leaves are thrown open 90°, parked against the pier jambs so the
  // 3.8 m doorway is actually walkable (they used to be drawn closed across it)
  for (const s of [-1, 1]) {
    const leafX = s * 1.82;
    const leafZ = -6.73;
    boxBatch(ctx, 'wood', leafX, 1.5, leafZ, 0.14, 3.0, 1.86, { tile: 1.7 });
    // iron bands across the leaf + hinge straps at the jamb
    for (let i = 0; i < 3; i++) {
      boxBatch(ctx, 'rust', leafX, 0.55 + i * 1.05, leafZ, 0.04, 0.1, 1.78, { tile: 1.2 });
    }
    for (const y of [0.55, 2.45]) {
      boxBatch(ctx, 'rust', leafX - s * 0.02, y, -7.55, 0.2, 0.14, 0.26, { tile: 0.8 });
    }
    // handle at the free edge
    boxBatch(ctx, 'rust', leafX + s * 0.03, 1.5, leafZ + 0.72, 0.08, 0.24, 0.06, { tile: 0.6 });
  }
  // gate sign + title banner
  makeSign(ctx, { text: 'MID GATE', sub: '中 门', x: 0, y: 5.95, z: -7.46, ry: 0, w: 3.0, h: 1.25, seed: 91, tilt: 0 });
  // faces the plaza (ry 0) and hangs in front of the machicolation cornice at z -7.5
  ctx.req.banners.push({ key: 'title', x: 0, y: 4.1, z: -7.18, ry: 0, w: 5.2, h: 2.45, sway: 0.025 });
  // lanterns flanking the gate
  for (const s of [-1, 1]) {
    ctx.req.lanterns.push({ x: s * 2.05, y: 3.35, z: -7.55, kind: 'warm', size: 0.3 });
    ctx.req.lights.push({ x: s * 2.05, y: 3.2, z: -7.2, color: 0xffa050, intensity: 9, distance: 9, kind: 'flicker' });
  }
  // inner-wall posters
  if (ctx.stagePick !== 'gate') for (const x of [-7.2, 7.0]) {
    ctx.req.posters.push({ x, y: 2.3, z: -7.72, ry: 0, cell: 'sector', w: 1.0, h: 1.85 });
  }

  // portal arches + sign boards
  for (const a of ctx.data.layout.arches) {
    if (a.kind === 'shopPass') continue;
    addArchMesh(ctx, a);
  }
  if (ctx.stagePick !== 'gate') {
    makeSign(ctx, { text: 'A LONG', sub: '长 道', x: 24.0, y: 5.15, z: -7.55, ry: 0, w: 2.6, h: 1.15, seed: 92, accent: '#8f3b2a' });
    makeSign(ctx, { text: 'B TUNNEL', sub: '隧 道', x: -24.0, y: 5.15, z: -7.55, ry: 0, w: 2.9, h: 1.2, seed: 93, accent: '#2f6470' });
  }

  // gate approach: worn threshold stones + painted lane arrows
  boxBatch(ctx, 'stone', 0, 0.045, -8.5, 4.4, 0.09, 2.4, { tile: 1.6 });
  for (const [x, cell] of [[-3.6, 'chevrons'], [3.6, 'chevrons']]) {
    ctx.req.decals.push({ x, y: 0.035, z: -6.4, rx: -Math.PI / 2, ry: 0, cell, w: 2.2, h: 2.2, opacity: 0.85 });
  }
}

/** Alias kept for the per-model contract (map assembly entry point). */
export function buildWorld(ctx) {
  buildMidWall(ctx);
}
