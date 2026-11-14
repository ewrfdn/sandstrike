import * as THREE from 'three';
import { TAU, makeInstanced, matrixFor } from '../core.js';
import { makeRNG } from '../../utils.js';
import { emit, plateGeo, rockGeo, sphereGeo, tubeGeo } from './detail.js';

export const meta = { id: 'rubble', kind: 'world', group: 'clutter', label: '碎石堆 · RUBBLE' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildRubbleFamily(ctx, true);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildRubbleFamily(ctx, false);
}

/**
 * Rubble & loose stone family.
 * Split out of world.js buildInstancedProps. `preview` is true only for the isolated
 * model-stage build, which uses the stage sample items instead of the map layout.
 *
 * The in-game map keeps one cheap instanced icosahedron per rock (5-11 rocks per
 * patch, 16 patches). The isolated stage builds the showcase version: every rock item
 * becomes a compact cluster of broken stone - a big weathered boulder, stratified cap
 * slabs, chipped flanks, pebbles banked around the base and a little dry scrub.
 */
function buildRubbleFamily(ctx, preview) {
  const M = ctx.materials;
  const hi = ctx.stage === true;
  const rockRng = makeRNG(551);
  const rubbleSpots = [
    [-31.5, 20.0, 8], [31.4, 12.0, 6], [-30.8, 6.0, 7], [30.6, 2.0, 5],
    [-16.0, -29.5, 10], [16.5, -29.8, 11], [-10.5, 19.5, 6], [11.5, 19.0, 6],
    [22.0, -20.5, 7], [-22.5, -20.8, 8], [-11.5, -25.5, 7], [12.0, -17.0, 6],
    [-28.0, -30.5, 9], [28.5, -30.4, 9], [-25.0, 22.0, 6], [25.0, -31.0, 6],
  ];
  const rockItems = [];
  if (preview) {
    for (let i = 0; i < 7; i++) {
      rockItems.push({ x: ((i % 3) - 1) * 0.42, y: 0.07 + (i % 2) * 0.05, z: (Math.floor(i / 3) - 1) * 0.36, ry: i * 1.13, rx: (i % 3) * 0.12 - 0.12, s: 0.55 + (i % 3) * 0.28 });
    }
  } else for (const [cx, cz, count] of rubbleSpots) {
    for (let i = 0; i < count; i++) {
      rockItems.push({
        x: cx + (rockRng() - 0.5) * 3.6,
        y: 0.07 + rockRng() * 0.06,
        z: cz + (rockRng() - 0.5) * 3.0,
        ry: rockRng() * TAU,
        rx: (rockRng() - 0.5) * 0.3,
        s: 0.4 + rockRng() * 1.2,
      });
    }
  }

  if (!hi) {
    // map LOD: one jittered icosahedron per rock (80 tris), still reads as chipped stone
    makeInstanced(ctx, rockGeo(0.22, { detail: 1, seed: 11 }), M.stoneDark, rockItems, 'rubble', 'stone', { seed: 46, castShadow: false });
    return;
  }

  // ---------------------------------------------------------------- showcase
  // Every preview item expands into a compact cluster, all local coordinates are in
  // units of the 0.22 m base rock radius so the pile keeps the stock footprint.
  rockItems.forEach((it, index) => {
    const s = it.s ?? 1;
    const itemMat = matrixFor(it.x, it.y, it.z, it.rx ?? 0, it.ry ?? 0, it.rz ?? 0, s, s, s);
    const rng = makeRNG(900 + index * 37);
    const add = (key, geo, lx, ly, lz, rx = 0, ry = 0, rz = 0) => {
      emit(ctx, key, geo, itemMat.clone().multiply(matrixFor(lx, ly, lz, rx, ry, rz)));
    };

    // main weathered boulder (jittered radius kept close to the stock 0.22 m rock)
    add('stoneDark', rockGeo(0.19, { detail: 3, seed: 2 + index, flatten: 0.82 }), 0, 0, 0, 0, rng() * TAU, 0);
    // stratified cap chunks sitting on top of the boulder
    for (let i = 0; i < 2; i++) {
      add('stoneDark', rockGeo(0.15, { detail: 2, seed: 40 + index * 3 + i, flatten: 0.34 }),
        (rng() - 0.5) * 0.05, 0.09 - i * 0.04, (rng() - 0.5) * 0.05,
        (rng() - 0.5) * 0.3, rng() * TAU, (rng() - 0.5) * 0.3);
    }
    // broken chunk leaning on the main boulder
    add('stoneDark', rockGeo(0.13, { detail: 2, seed: 70 + index, flatten: 0.72 }),
      0.09, -0.02, 0.05, 0.15, rng() * TAU, 0.1);
    // low chip stones around the foot of the boulder
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + rng() * 0.6;
      const rr = 0.09 + rng() * 0.04;
      add('stone', rockGeo(0.1, { detail: 1, seed: 120 + index * 5 + i, flatten: 0.55 }),
        Math.cos(a) * rr, 0.018, Math.sin(a) * rr, (rng() - 0.5) * 0.3, rng() * TAU, (rng() - 0.5) * 0.3);
    }
    // dust banked up against the stones
    for (let i = 0; i < 2; i++) {
      const a = rng() * TAU;
      const g = sphereGeo(0.11 + rng() * 0.03, { segW: 10, segH: 8, tile: 1.4 });
      g.scale(1, 0.24, 1);
      add('sandDark', g, Math.cos(a) * 0.05, 0.004, Math.sin(a) * 0.05, 0, rng() * TAU, 0);
    }
    // hairline cracks running down the boulder face
    for (let i = 0; i < 3; i++) {
      const a = rng() * TAU;
      const pts = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        const rr = 0.17 - t * 0.1;
        pts.push(new THREE.Vector3(Math.cos(a + t * 0.85) * rr, 0.15 - t * 0.06, Math.sin(a + t * 0.85) * rr));
      }
      add('stoneDark', tubeGeo(pts, 0.006, { tubularSeg: 10, radialSeg: 4, tile: 0.5 }), 0, 0, 0);
    }
    // pebble scatter hugging the base
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU + rng() * 0.5;
      const rr = 0.07 + rng() * 0.05;
      const ps = 0.15 + rng() * 0.13;
      const g = rockGeo(0.19, { detail: 1, seed: 200 + index * 16 + i, flatten: 0.6 });
      g.scale(ps, ps * 0.85, ps);
      add(i % 3 === 0 ? 'stone' : 'stoneDark', g,
        Math.cos(a) * rr, 0.012 + rng() * 0.014, Math.sin(a) * rr, 0, rng() * TAU, 0);
    }
  });
}
