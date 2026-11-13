import * as THREE from 'three';
import { baseBox, boxBatch, matrixFor } from '../core.js';

export const meta = { id: 'pillar', kind: 'world', group: 'architecture', label: '石柱 · COLONNADE PILLAR' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.pillars = [{ x: 0, z: 0, w: 0.95, d: 0.95, h: 4.0, style: 'stone' }];
  ctx.stagePick = 'pillar';
  buildColonnade(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildColonnade(ctx);
}

/**
 * Colonnade: courtyard pillar rows, lintel beams, the shade sail strung between
 * them and the central monument. Shared by world.js map assembly and by the
 * pillar / monument / shade-sail model previews (the original `ctx.stagePick`
 * guards are kept verbatim so each preview composes exactly like the old stage).
 */
export function buildColonnade(ctx) {
  const L = ctx.data.layout;
  for (let i = 0; i < L.pillars.length; i++) {
    const p = L.pillars[i];
    baseBox(ctx, 'stone', p.x, p.z, p.w + 0.3, 0.35, p.d + 0.3, { tile: 1.7 });
    // shaft ends at the capital underside (was 2 cm proud of the capital slab)
    baseBox(ctx, 'stone', p.x, p.z, p.w, p.h - 0.85, p.d, { tile: 2.0, y0: 0.35 });
    const broken = i === 2 || i === 5;
    if (broken) {
      boxBatch(ctx, 'stone', p.x + 0.12, p.h - 0.2, p.z, p.w * 0.55, 0.3, p.d * 0.6, { tile: 1.4, ry: 0.4 });
    } else {
      baseBox(ctx, 'stone', p.x, p.z, p.w + 0.24, 0.28, p.d + 0.24, { tile: 1.7, y0: p.h - 0.5 });
      baseBox(ctx, 'wood', p.x, p.z, p.w * 0.85, 0.18, p.d * 0.85, { tile: 1.4, y0: p.h - 0.52 });
    }
  }
  // lintel beams across some pillars
  if (!ctx.stagePick) for (const z of [-15.2]) {
    for (const x of [-7.2, 7.2]) {
      boxBatch(ctx, 'wood', x, 4.02, z, 0.95, 0.3, 3.3, { tile: 1.5 });
    }
  }
  // shade sail strung over the courtyard between the two pillar rows (x = ±7.2).
  // The second, smaller tarp sail used to float between unsupported edges and
  // overlapped the main sail, so it was dropped.
  if (!ctx.stagePick || ctx.stagePick === 'sails') {
    ctx.req.sails.push({ x: 0, y: 4.35, z: -16.4, w: 13.8, d: 7.2, ry: 0, key: 'shade', sag: 0.55, phase: 0.4 });
  }

  // central monument (broken obelisk with cyan emitter)
  if (!ctx.stagePick || ctx.stagePick === 'monument') {
  const m = ctx.data.layout.hero.monument;
  baseBox(ctx, 'stone', m.x, m.z, 3.5, 0.9, 3.5, { tile: 2.0 });
  baseBox(ctx, 'stone', m.x, m.z, 2.2, 0.35, 2.2, { tile: 1.7, y0: 0.9 });
  baseBox(ctx, 'stone', m.x, m.z, 1.25, 3.0, 1.25, { tile: 1.9, y0: 1.25 });
  boxBatch(ctx, 'stone', m.x, 4.35, m.z, 1.35, 0.3, 1.35, { tile: 1.4, ry: 0.2 });
  // tech bands flush to the four obelisk faces (round torus rings used to clip the
  // square shaft at its corners and float off the flat faces)
  for (let i = 0; i < 3; i++) {
    const y = 2.0 + i * 0.8;
    for (const s of [-1, 1]) {
      boxBatch(ctx, 'metalDark', m.x + s * 0.645, y, m.z, 0.05, 0.09, 1.45, { tile: 0.7 });
      boxBatch(ctx, 'metalDark', m.x, y, m.z + s * 0.645, 1.45, 0.09, 0.05, { tile: 0.7 });
    }
  }
  // glowing emitter seams: the cyan core is enclosed by the stone shaft, so expose it
  // as four flush light slots on the shaft faces (it used to be completely buried)
  const core = new THREE.CylinderGeometry(0.34, 0.42, 1.5, 8);
  ctx.batcher.add('glowCyan', core, matrixFor(m.x, 3.1, m.z));
  core.dispose();
  for (const s of [-1, 1]) {
    boxBatch(ctx, 'glowCyan', m.x + s * 0.64, 3.1, m.z, 0.03, 1.15, 0.2, { tile: 0.6 });
    boxBatch(ctx, 'glowCyan', m.x, 3.1, m.z + s * 0.64, 0.2, 1.15, 0.03, { tile: 0.6 });
  }
  ctx.req.lights.push({ x: m.x, y: 3.2, z: m.z, color: 0x73e6ff, intensity: 5, distance: 7, kind: 'pulse' });
  ctx.req.decals.push({ x: m.x, y: 0.03, z: m.z, rx: -Math.PI / 2, ry: 0, cell: 'chevrons', w: 3.0, h: 3.0, opacity: 0.6 });
  }
}
