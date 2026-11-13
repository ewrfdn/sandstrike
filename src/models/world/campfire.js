import * as THREE from 'three';
import { TAU, matrixFor, rodBetween } from '../core.js';
import { makeRNG } from '../../utils.js';

export const meta = { id: 'campfire', kind: 'world', group: 'hero', label: '篝火 · CAMPFIRE' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const c = ctx.data.layout.hero.campfire;
  const rng = makeRNG(123);
  // stone ring
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const g = new THREE.IcosahedronGeometry(0.16 + rng() * 0.08, 0);
    ctx.batcher.add('stoneDark', g, matrixFor(c.x + Math.cos(a) * 0.7, 0.12, c.z + Math.sin(a) * 0.7, rng(), rng() * TAU));
    g.dispose();
  }
  // logs
  for (let i = 0; i < 5; i++) {
    const g = new THREE.CylinderGeometry(0.07, 0.09, 0.85, 6);
    const a = (i / 5) * TAU;
    ctx.batcher.add('woodDark', g, matrixFor(c.x + Math.cos(a) * 0.18, 0.2, c.z + Math.sin(a) * 0.18, Math.PI / 2 - 0.5, a, 0));
    g.dispose();
  }
  const coals = new THREE.SphereGeometry(0.34, 8, 5);
  ctx.batcher.add('coals', coals, matrixFor(c.x, 0.14, c.z, 0, 0, 0, 1, 0.4, 1));
  coals.dispose();
  ctx.req.lights.push({ x: c.x, y: 0.8, z: c.z, color: 0xff7a2f, intensity: 6.5, distance: 7.5, kind: 'fire' });
  ctx.req.lanterns.push({ x: c.x, y: 0.5, z: c.z, kind: 'fire', size: 0.5 });
  // cooking tripod: three legs converge into an apex ring above the fire (they used
  // to splay apart in the air), with a chain hanging the pot under the apex
  const apexY = 1.92;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    rodBetween(ctx, 'metalDark', c.x + Math.cos(a) * 0.66, 0, c.z + Math.sin(a) * 0.66, c.x, apexY, c.z, 0.038, 5);
  }
  const apexRing = new THREE.TorusGeometry(0.08, 0.02, 5, 10);
  ctx.batcher.add('metalDark', apexRing, matrixFor(c.x, apexY, c.z, Math.PI / 2));
  apexRing.dispose();
  rodBetween(ctx, 'metalDark', c.x, apexY, c.z, c.x, 1.6, c.z, 0.014, 4);
  const pot = new THREE.CylinderGeometry(0.22, 0.18, 0.28, 10);
  ctx.batcher.add('metal', pot, matrixFor(c.x, 1.44, c.z));
  pot.dispose();
  const bail = new THREE.TorusGeometry(0.17, 0.013, 4, 10, Math.PI);
  ctx.batcher.add('metalDark', bail, matrixFor(c.x, 1.58, c.z));
  bail.dispose();
  ctx.req.smoke.push({ x: c.x, y: 0.7, z: c.z, spread: 0.6, rate: 0.5, count: 24, rise: 2.6, color: 0x6a5a48, scale: 0.9 });
}
