import * as THREE from 'three';
import { TAU, makeInstanced, mergeGeometries, transformed } from '../core.js';
import { makeRNG } from '../../utils.js';

export const meta = { id: 'palm', kind: 'world', group: 'clutter', label: '棕榈树 · PALM' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.palms = [{ x: 0, z: 0, s: 1.05, ry: 0.4 }];
  buildPalmFamily(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildPalmFamily(ctx);
}

/**
 * Palm tree family (bent trunk + frond crown).
 * Split out of world.js buildInstancedProps.
 */
function buildPalmFamily(ctx) {
  const L = ctx.data.layout;
  const M = ctx.materials;
  const palmItems = L.palms;
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.2, 2.8, 7, 3);
  trunkGeo.translate(0, 1.4, 0);
  // bend the trunk slightly
  {
    const p = trunkGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.pow(p.getY(i) / 2.8, 2) * 0.28);
    trunkGeo.computeVertexNormals();
  }
  makeInstanced(
    ctx,
    trunkGeo,
    M.bark,
    palmItems.map((p) => ({ x: p.x, z: p.z, y: 0, ry: p.ry, s: p.s })),
    'palm-trunks',
    'wood',
    { seed: 44 }
  );
  const frondGeos = [];
  const crownRng = makeRNG(321);
  for (let i = 0; i < 11; i++) {
    const g = new THREE.PlaneGeometry(3.0, 0.86, 5, 1);
    // taper the leaflets
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const t = p.getX(v) / 3.0 + 0.5;
      p.setY(v, p.getY(v) * (0.35 + Math.sin(t * Math.PI) * 0.85));
      p.setZ(v, -Math.pow(t, 2) * 0.55);
    }
    g.computeVertexNormals();
    const ang = (i / 11) * TAU + crownRng() * 0.4;
    const tilt = -0.45 - crownRng() * 0.55;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(0.2, 2.72 - crownRng() * 0.18, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ang, tilt, 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    frondGeos.push(transformed(g, m));
    g.dispose();
  }
  const crownGeo = mergeGeometries(frondGeos);
  makeInstanced(
    ctx,
    crownGeo,
    M.frond,
    palmItems.map((p) => ({ x: p.x, z: p.z, y: 0, ry: p.ry, s: p.s })),
    'palm-crowns',
    'wood',
    { seed: 45 }
  );
}
