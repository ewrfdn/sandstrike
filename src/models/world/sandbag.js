import * as THREE from 'three';
import { makeRNG } from '../../utils.js';
import { makeInstanced } from '../core.js';

export const meta = { id: 'sandbag', kind: 'world', group: 'clutter', label: '沙袋墙 · SANDBAG RUN' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.sandbagRuns = [[0, 0, 2.6, 0.95, 0.9]];
  buildSandbagFamily(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildSandbagFamily(ctx);
}

/**
 * Sandbag run family.
 * Split out of world.js buildInstancedProps.
 */
function buildSandbagFamily(ctx) {
  const L = ctx.data.layout;
  const M = ctx.materials;
  const bagGeo = new THREE.SphereGeometry(0.5, 8, 5);
  bagGeo.scale(0.7, 0.24, 0.45);
  const bagItems = [];
  const bagRng = makeRNG(707);
  for (const [x, z, w, d, h] of L.sandbagRuns) {
    const alongX = w >= d;
    const length = alongX ? w : d;
    const across = Math.max(1, Math.round((alongX ? d : w) / 0.44));
    // enough courses to actually fill the collision height (bags were only ~0.62 m tall
    // behind 0.9 m cover, leaving an invisible lip above the visible stack)
    const rows = Math.max(2, Math.round(h / 0.18));
    const courseStep = (h - 0.24) / Math.max(1, rows - 1);
    const count = Math.max(2, Math.round(length / 0.44));
    for (let r = 0; r < rows; r++) {
      for (let a = 0; a < across; a++) {
        for (let i = 0; i < count; i++) {
          const t = (i + 0.5) / count - 0.5;
          const offA = ((a + 0.5) / across - 0.5) * ((alongX ? d : w) - 0.55);
          if (r > 0 && (i + a) % 2 === 0) continue; // stagger upper courses
          const jitter = (bagRng() - 0.5) * 0.06;
          bagItems.push({
            x: x + (alongX ? t * length + jitter : offA),
            y: 0.11 + r * courseStep,
            z: z + (alongX ? offA : t * length + jitter),
            ry: (alongX ? 0 : Math.PI / 2) + (bagRng() - 0.5) * 0.22,
            s: 1,
          });
        }
      }
    }
  }
  makeInstanced(ctx, bagGeo, M.sandbag, bagItems, 'sandbags', 'fabric', { seed: 43 });
}
