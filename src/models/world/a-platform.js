import * as THREE from 'three';
import { matrixFor, boxBatch, baseBox, rodBetween } from '../core.js';

export const meta = { id: 'a-platform', kind: 'world', group: 'hero', label: 'A点瞭望台 · WATCH PLATFORM' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const p = ctx.data.layout.hero.aPlatform;
  // 4 corner legs matching the collision boxes (the deck used to float, held only by
  // the ladder), with stone pads and top knee braces kept above head height
  for (const [ox, oz] of [[-p.w / 2 + 0.2, -p.d / 2 + 0.2], [p.w / 2 - 0.2, -p.d / 2 + 0.2], [-p.w / 2 + 0.2, p.d / 2 - 0.2], [p.w / 2 - 0.2, p.d / 2 - 0.2]]) {
    const lx = p.x + ox;
    const lz = p.z + oz;
    baseBox(ctx, 'stone', lx, lz, 0.34, 0.22, 0.34, { tile: 0.9 });
    baseBox(ctx, 'wood', lx, lz, 0.28, p.h - 0.02, 0.28, { tile: 1.1 });
  }
  // deck
  boxBatch(ctx, 'wood', p.x, p.h + 0.1, p.z, p.w, 0.22, p.d, { tile: 1.5 });
  // braces under the deck (above head height, purely visual)
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      rodBetween(ctx, 'wood', p.x + s * 1.3, 2.2, p.z + t * 1.1, p.x - s * 1.3, 2.95, p.z + t * 1.1, 0.05, 4);
    }
    boxBatch(ctx, 'wood', p.x + s * (p.w / 2 - 0.22), 2.9, p.z, 0.12, 0.12, p.d - 0.5, { tile: 1.1 });
  }
  boxBatch(ctx, 'wood', p.x, 2.9, p.z, p.w - 0.5, 0.12, 0.12, { tile: 1.1 });
  // railings (south face has a 1.0 m hatch gap where the ladder lands)
  for (const s of [-1, 1]) {
    boxBatch(ctx, 'wood', p.x + s * (p.w / 2 - 0.1), p.h + 0.75, p.z, 0.12, 1.1, p.d, { tile: 1.2 });
    const zr = p.z + s * (p.d / 2 - 0.1);
    if (s < 0) {
      for (const q of [-1, 1]) {
        const segW = p.w / 2 - 0.5;
        boxBatch(ctx, 'wood', p.x + q * (segW / 2 + 0.5), p.h + 0.75, zr, segW, 1.1, 0.12, { tile: 1.2 });
        boxBatch(ctx, 'wood', p.x + q * (segW / 2 + 0.5), p.h + 1.25, zr, segW, 0.1, 0.1, { tile: 1.2 });
      }
    } else {
      boxBatch(ctx, 'wood', p.x, p.h + 0.75, zr, p.w, 1.1, 0.12, { tile: 1.2 });
      boxBatch(ctx, 'wood', p.x, p.h + 1.25, zr, p.w, 0.1, 0.1, { tile: 1.2 });
    }
    boxBatch(ctx, 'wood', p.x + s * (p.w / 2 - 0.1), p.h + 1.25, p.z, 0.1, 0.1, p.d, { tile: 1.2 });
  }
  // ladder
  for (const s of [-1, 1]) {
    boxBatch(ctx, 'wood', p.x + s * 0.45, p.h / 2, p.z - p.d / 2 - 0.05, 0.1, p.h, 0.1, { tile: 1.1 });
  }
  for (let i = 0; i < 7; i++) {
    boxBatch(ctx, 'wood', p.x, 0.5 + i * 0.42, p.z - p.d / 2 - 0.05, 0.9, 0.07, 0.07, { tile: 1 });
  }
  // sandbags on the deck
  for (let i = 0; i < 3; i++) {
    const bag = new THREE.SphereGeometry(0.34, 7, 4);
    ctx.batcher.add('tarp', bag, matrixFor(p.x - 0.7 + i * 0.62, p.h + 0.3, p.z + p.d / 2 - 0.35, 0, i * 1.1, 0, 1, 0.42, 0.62));
    bag.dispose();
  }
  // A-site signal lamp hung from the top rail (it used to float beside the platform)
  ctx.req.lanterns.push({ x: p.x, y: 4.02, z: p.z - p.d / 2 + 0.2, kind: 'warm', size: 0.22, hang: 4.2 });
  ctx.req.lights.push({ x: p.x, y: p.h + 1.2, z: p.z, color: 0xffa050, intensity: 5, distance: 8, kind: 'accent' });
}
