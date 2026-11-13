import * as THREE from 'three';
import { matrixFor, boxGeometryWorldUV } from '../core.js';

export const meta = { id: 'cart', kind: 'world', group: 'hero', label: '平板车 · HAND CART' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.stagePick = 'cart';
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  function cart(x, z, ry, scale = 1, key = 'wood') {
    const base = matrixFor(x, 0, z, 0, ry, 0);
    const part = (lx, ly, lz, w, h, d, bkey, tile = 1.4) => {
      const g = boxGeometryWorldUV(w * scale, h * scale, d * scale, tile);
      const m = new THREE.Matrix4().makeTranslation(lx * scale, ly * scale, lz * scale);
      m.premultiply(base);
      ctx.batcher.add(bkey, g, m);
      g.dispose();
    };
    part(0, 0.82, 0, 2.2, 0.14, 1.15, key);
    for (const s of [-1, 1]) part(0, 1.02, s * 0.56, 2.2, 0.42, 0.1, key);
    part(1.05, 1.02, 0, 0.1, 0.42, 1.15, key);
    // wheels
    for (const sx of [-0.72, 0.72]) {
      for (const sz of [-0.62, 0.62]) {
        const g = new THREE.CylinderGeometry(0.42 * scale, 0.42 * scale, 0.1, 10);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(sx * scale, 0.42 * scale, sz * scale),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0, 'YXZ')),
          new THREE.Vector3(1, 1, 1)
        );
        m.premultiply(base);
        ctx.batcher.add('wood', g, m);
        g.dispose();
      }
    }
    // handles
    for (const sz of [-0.4, 0.4]) {
      const g = boxGeometryWorldUV(1.2 * scale, 0.09, 0.09, 1);
      const m = new THREE.Matrix4().makeTranslation(-1.7 * scale, 0.95 * scale, sz * scale);
      m.premultiply(base);
      ctx.batcher.add('wood', g, m);
      g.dispose();
    }
    // cargo
    part(-0.2, 1.12, 0, 0.7, 0.45, 0.7, 'crate');
    part(0.55, 1.12, 0.1, 0.6, 0.4, 0.55, 'crate');
  }
  const p = ctx.data.layout.hero.cartPlaza;
  const a = ctx.data.layout.hero.aLongCart;
  if (ctx.stagePick === 'cart') {
    cart(0, 0, 0.35, 1.0);
    return;
  }
  cart(p.x, p.z, 0.35, 1.0);
  cart(a.x, a.z, -0.5, 1.15);
  // tipped cart at B site exit
  cart(-22.6, -18.0, 1.2, 0.95);
}
