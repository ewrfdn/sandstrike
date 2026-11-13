import * as THREE from 'three';
import { TAU, matrixFor, boxGeometryWorldUV, cylinderBatch } from '../core.js';
import { makeRNG } from '../../utils.js';

export const meta = { id: 'b-wreck', kind: 'world', group: 'hero', label: 'B点残骸 · WRECK' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const w = ctx.data.layout.hero.bWreck;
  const rng = makeRNG(744);
  // broken chassis/shell plates, settled onto the sand (minY ≈ 0)
  for (let i = 0; i < 7; i++) {
    const g = boxGeometryWorldUV(0.5 + rng() * 0.9, 0.08 + rng() * 0.2, 0.3 + rng() * 0.6, 1.4);
    ctx.batcher.add('rust', g, matrixFor(w.x + (rng() - 0.5) * 2.2, 0.22 + i * 0.08, w.z + (rng() - 0.5) * 1.6, rng() * 0.8, rng() * TAU));
    g.dispose();
  }
  // broken mount ring under the shattered core (it used to hover at y 0.55)
  cylinderBatch(ctx, 'stoneDark', w.x + 0.2, 0.17, w.z, 0.26, 0.34, 0.34, 6);
  // shattered core
  const core = new THREE.IcosahedronGeometry(0.3, 0);
  ctx.batcher.add('glowCyan', core, matrixFor(w.x + 0.2, 0.55, w.z));
  core.dispose();
  ctx.req.lights.push({ x: w.x, y: 0.7, z: w.z, color: 0x73e6ff, intensity: 3.5, distance: 5, kind: 'pulse' });
  ctx.req.smoke.push({ x: w.x, y: 0.5, z: w.z, spread: 0.4, rate: 0.28, count: 16, rise: 1.8, color: 0x50504a, scale: 0.7 });
  ctx.req.decals.push({ x: w.x, y: 0.03, z: w.z, rx: -Math.PI / 2, ry: 0.4, cell: 'chips', w: 2.4, h: 2.4, opacity: 0.8 });
}
