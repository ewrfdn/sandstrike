/**
 * 平板车 · HAND CART — two-wheel-ironshod timber hand cart.
 *
 * One skeleton (layout positions, bed 2.2 x 1.15 at y0.82, four r0.42 wheels,
 * handles, cargo) with two detail levels:
 *   - model-stage preview (`ctx.stage === true`): planked bed on framed bearers,
 *     boarded sides with iron straps, spoked wheels with felloes + iron tyres,
 *     lathed axles/hubs, wrapped handles and a pair of detailed cargo crates
 *     lashed down with rope — ~20k triangles.
 *   - in-game map (`buildWorld`): the same silhouette with plank bed, simple
 *     spoked wheels and box cargo, well under the 3.5k/cart map budget.
 */
import * as THREE from 'three';
import { TAU, matrixFor } from '../core.js';
import {
  isPreview, plateGeo, cylGeo, latheGeo, torusGeo, tubeGeo, boltGeo, emit,
} from './detail.js';

export const meta = { id: 'cart', kind: 'world', group: 'hero', label: '平板车 · HAND CART' };

const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.stagePick = 'cart';
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const hi = isPreview(ctx);

  function cart(x, z, ry, scale = 1, key = 'wood') {
    // uniform scale lives in the instance matrix so every part is authored at 1:1
    const base = matrixFor(x, 0, z, 0, ry, 0, scale, scale, scale);
    const add = (mkey, geo, localMatrix) => {
      const m = localMatrix.clone().premultiply(base);
      ctx.batcher.add(mkey, geo, m);
      geo.dispose();
    };
    const at = (mkey, geo, lx, ly, lz, rx = 0, ry2 = 0, rz = 0) =>
      add(mkey, geo, matrixFor(lx, ly, lz, rx, ry2, rz));
    const rod = (mkey, ax, ay, az, bx, by, bz, r, radial = 6, tile = 1.4) => {
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-4) return;
      _quat.setFromUnitVectors(UP, _dir.set(dx / len, dy / len, dz / len).normalize());
      _pos.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      add(mkey, cylGeo(r, r, len, { radial, tile }), new THREE.Matrix4().compose(_pos, _quat, ONE));
    };
    const bolt = (bx, by, bz, dx, dy, dz, r = 0.022, h = 0.016, mkey = 'metal') => {
      _quat.setFromUnitVectors(UP, _dir.set(dx, dy, dz).normalize());
      add(mkey, boltGeo(r, h, { tile: 0.8 }),
        new THREE.Matrix4().compose(new THREE.Vector3(bx, by, bz), _quat, ONE));
    };

    // ---- wheels ---------------------------------------------------------
    const wheel = (wx, wz) => {
      const out = wz > 0 ? 1 : -1;
      if (hi) {
        // lathed hub
        at('wood', latheGeo([
          [0.095, -0.05], [0.122, -0.036], [0.13, 0], [0.122, 0.036], [0.095, 0.05],
        ], { segments: 16, tile: 1.2 }), wx, 0.42, wz, Math.PI / 2);
        // sixteen spokes
        const spokes = 16;
        for (let i = 0; i < spokes; i++) {
          const a = (i / spokes) * TAU;
          at('wood', plateGeo(0.30, 0.036, 0.05, { bevel: 0.006 }),
            wx + Math.cos(a) * 0.25, 0.42 + Math.sin(a) * 0.25, wz, 0, 0, a);
        }
        // felloes (straight segments butt-jointed around the rim)
        const felloes = 24;
        for (let i = 0; i < felloes; i++) {
          const a = (i / felloes) * TAU;
          at('wood', plateGeo(0.078, 0.075, 0.08, { bevel: 0.008 }),
            wx + Math.cos(a) * 0.36, 0.42 + Math.sin(a) * 0.36, wz, 0, 0, a + Math.PI / 2);
        }
        // iron tyre, hub band and joint strakes
        at('rubber', torusGeo(0.395, 0.025, { radialSeg: 8, tubularSeg: 28 }), wx, 0.42, wz);
        at('metalDark', torusGeo(0.128, 0.013, { radialSeg: 6, tubularSeg: 14 }), wx, 0.42, wz);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + 0.16;
          at('rust', plateGeo(0.046, 0.05, 0.016, { bevel: 0.003, tile: 0.6 }),
            wx + Math.cos(a) * 0.36, 0.42 + Math.sin(a) * 0.36, wz + out * 0.048, 0, 0, a + Math.PI / 2);
        }
        // hub plate + bolts on the outward face
        at('metal', cylGeo(0.075, 0.075, 0.03, { radial: 10, tile: 0.8 }), wx, 0.42, wz + out * 0.055, Math.PI / 2);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + 0.2;
          bolt(wx + Math.cos(a) * 0.085, 0.42 + Math.sin(a) * 0.085, wz + out * 0.06, 0, 0, out, 0.019, 0.013);
        }
        // felloe nails
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU + 0.1;
          bolt(wx + Math.cos(a) * 0.36, 0.42 + Math.sin(a) * 0.36, wz + out * 0.046, 0, 0, out, 0.017, 0.011);
        }
      } else {
        at('wood', cylGeo(0.13, 0.13, 0.1, { radial: 12, tile: 1.2 }), wx, 0.42, wz, Math.PI / 2);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          at('wood', plateGeo(0.3, 0.06, 0.06, { bevel: 0.006 }),
            wx + Math.cos(a) * 0.25, 0.42 + Math.sin(a) * 0.25, wz, 0, 0, a);
        }
        at('metalDark', torusGeo(0.395, 0.025, { radialSeg: 8, tubularSeg: 16 }), wx, 0.42, wz);
      }
    };
    for (const sx of [-0.72, 0.72]) {
      for (const sz of [-0.62, 0.62]) wheel(sx, sz);
    }

    // ---- bed ------------------------------------------------------------
    if (hi) {
      const planks = 24;
      const pitch = 2.2 / planks;
      for (let i = 0; i < planks; i++) {
        at(key, plateGeo(pitch - 0.02, 0.05, 1.13, { bevel: 0.008, tile: 1.4 }),
          -1.1 + pitch / 2 + i * pitch, 0.86, 0);
      }
      // cross bearers + perimeter frame
      for (const bx of [-0.72, 0, 0.72]) {
        at('woodDark', plateGeo(0.14, 0.09, 1.14, { bevel: 0.01 }), bx, 0.795, 0);
      }
      for (const sz of [-1, 1]) {
        at('woodDark', plateGeo(2.2, 0.09, 0.1, { bevel: 0.01 }), 0, 0.8, sz * 0.56);
      }
      for (const sx of [-1, 1]) {
        at('woodDark', plateGeo(0.1, 0.09, 1.16, { bevel: 0.01 }), sx * 1.06, 0.8, 0);
        // rub rail along each end
        at('woodDark', plateGeo(0.06, 0.05, 1.16, { bevel: 0.006 }), sx * 1.05, 0.93, 0);
      }
      // bed nails
      for (let i = 0; i < planks; i++) {
        const px = -1.1 + pitch / 2 + i * pitch;
        bolt(px, 0.899, -0.45, 0, 1, 0, 0.018, 0.012);
        bolt(px, 0.899, 0.45, 0, 1, 0, 0.018, 0.012);
      }
      // corner iron brackets under the bed
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          at('metal', plateGeo(0.16, 0.14, 0.05, { bevel: 0.004, tile: 0.8 }), sx * 1.0, 0.8, sz * 0.555, 0, 0, 0);
          at('metal', plateGeo(0.05, 0.14, 0.16, { bevel: 0.004, tile: 0.8 }), sx * 1.055, 0.8, sz * 0.5);
        }
      }

      // ---- boarded sides ------------------------------------------------
      for (const sz of [-1, 1]) {
        for (let r = 0; r < 3; r++) {
          at('wood', plateGeo(2.16, 0.12, 0.04, { bevel: 0.006 }), 0, 0.945 + r * 0.12, sz * 0.575);
        }
        for (const px of [-0.9, -0.3, 0.3, 0.9]) {
          at('woodDark', plateGeo(0.07, 0.5, 0.055, { bevel: 0.006 }), px, 1.06, sz * 0.6);
          at('metal', plateGeo(0.085, 0.05, 0.03, { bevel: 0.004, tile: 0.8 }), px, 1.26, sz * 0.612);
          bolt(px, 1.02, sz * 0.632, 0, 0, sz, 0.018, 0.012);
          bolt(px, 1.16, sz * 0.632, 0, 0, sz, 0.018, 0.012);
        }
        // diagonal iron straps
        at('rust', plateGeo(0.045, 0.62, 0.018, { bevel: 0.004, tile: 0.8 }), -0.62, 1.04, sz * 0.6, 0, 0, 0.34);
        at('rust', plateGeo(0.045, 0.62, 0.018, { bevel: 0.004, tile: 0.8 }), 0.62, 1.04, sz * 0.6, 0, 0, -0.34);
        // iron sockets at the stakes + rope coil hung on the boards
        for (const px of [-0.9, -0.3, 0.3, 0.9]) {
          at('metal', plateGeo(0.095, 0.06, 0.09, { bevel: 0.004, tile: 0.8 }), px, 0.9, sz * 0.605);
        }
      }
      // rope coil hung flat against the +Z side board
      for (let i = 0; i < 3; i++) {
        at('rust', torusGeo(0.09, 0.018, { radialSeg: 6, tubularSeg: 12, tile: 0.7 }), 0.45, 1.03, 0.612 + i * 0.008);
      }
      at('metal', plateGeo(0.06, 0.05, 0.03, { bevel: 0.004, tile: 0.6 }), 0.45, 1.1, 0.62);
      // ---- front + back boards ------------------------------------------
      for (const sx of [-1, 1]) {
        for (let r = 0; r < 3; r++) {
          at('wood', plateGeo(0.04, 0.12, 1.1, { bevel: 0.006 }), sx * 1.05, 0.945 + r * 0.12, 0);
        }
        for (const pz of [-0.44, 0.44]) {
          at('woodDark', plateGeo(0.055, 0.48, 0.07, { bevel: 0.006 }), sx * 1.07, 1.05, pz);
        }
        at('rust', plateGeo(0.018, 0.06, 1.1, { bevel: 0.004, tile: 0.8 }), sx * 1.075, 1.14, 0);
        bolt(sx * 1.075, 0.96, 0.3, sx, 0, 0, 0.018, 0.012);
        bolt(sx * 1.075, 0.96, -0.3, sx, 0, 0, 0.018, 0.012);
      }
      // chain latch on the back board
      emit(ctx, 'rust', tubeGeo([
        new THREE.Vector3(-1.075, 1.16, 0.1),
        new THREE.Vector3(-1.09, 1.1, 0.18),
        new THREE.Vector3(-1.075, 1.05, 0.26),
      ], 0.011, { tubularSeg: 8, radialSeg: 4, tile: 0.6 }), base);

      // ---- axles + axle bearings ---------------------------------------
      const axleProfile = [
        [0.03, -0.58], [0.05, -0.52], [0.052, -0.2], [0.046, 0.2], [0.05, 0.52], [0.03, 0.58],
      ];
      for (const sx of [-1, 1]) {
        at('metalDark', latheGeo(axleProfile, { segments: 12, tile: 1.0 }), sx * 0.72, 0.42, 0, Math.PI / 2);
        for (const pz of [-0.33, 0.33]) {
          at('woodDark', plateGeo(0.16, 0.12, 0.14, { bevel: 0.008 }), sx * 0.72, 0.74, pz);
          bolt(sx * 0.72 + 0.09, 0.74, pz, 1, 0, 0, 0.02, 0.014);
        }
      }

      // ---- handles -------------------------------------------------------
      for (const sz of [-1, 1]) {
        at('wood', plateGeo(1.2, 0.09, 0.09, { bevel: 0.008 }), -1.7, 0.95, sz * 0.4);
        at('woodDark', cylGeo(0.062, 0.058, 0.15, { radial: 10, tile: 1.0 }), -2.23, 0.95, sz * 0.4, 0, 0, Math.PI / 2);
        at('metal', plateGeo(0.06, 0.14, 0.13, { bevel: 0.004, tile: 0.8 }), -2.12, 0.95, sz * 0.4);
        at('woodDark', plateGeo(0.14, 0.16, 0.1, { bevel: 0.008 }), -1.03, 0.92, sz * 0.4);
        bolt(-0.99, 0.99, sz * 0.4, 0, 1, 0, 0.02, 0.014);
        bolt(-1.07, 0.85, sz * 0.4, 0, 0, sz, 0.02, 0.014);
        // rope wraps around the hand grip
        for (let i = 0; i < 3; i++) {
          at('rust', torusGeo(0.074, 0.012, { radialSeg: 6, tubularSeg: 14, tile: 0.6 }),
            -2.08 + i * 0.09, 0.95, sz * 0.4, 0, Math.PI / 2, 0);
        }
      }
      at('wood', plateGeo(0.09, 0.09, 0.86, { bevel: 0.008 }), -2.14, 0.95, 0);

      // ---- cargo crates --------------------------------------------------
      const crate = (cx, y0, cz, w, h, d) => {
        const post = 0.06;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            at('woodDark', plateGeo(post, h, post, { bevel: 0.006 }),
              cx + sx * (w / 2 - post / 2), y0 + h / 2, cz + sz * (d / 2 - post / 2));
          }
        }
        const ph = (h - 0.02) / 4;
        for (let r = 0; r < 4; r++) {
          const yy = y0 + 0.008 + ph / 2 + r * ph;
          at('wood', plateGeo(w - 2 * post, ph - 0.006, 0.035, { bevel: 0.005 }), cx, yy, cz + d / 2 - 0.017);
          at('wood', plateGeo(w - 2 * post, ph - 0.006, 0.035, { bevel: 0.005 }), cx, yy, cz - d / 2 + 0.017);
          at('wood', plateGeo(0.035, ph - 0.006, d - 2 * post, { bevel: 0.005 }), cx + w / 2 - 0.017, yy, cz);
          at('wood', plateGeo(0.035, ph - 0.006, d - 2 * post, { bevel: 0.005 }), cx - w / 2 + 0.017, yy, cz);
        }
        // lid boards, running across the crate
        for (let i = 0; i < 4; i++) {
          at('woodDark', plateGeo(w - 0.02, 0.03, (d - 0.04) / 4 - 0.008, { bevel: 0.005 }),
            cx, y0 + h + 0.006, cz - (d - 0.04) / 2 + (d - 0.04) / 8 + i * ((d - 0.04) / 4));
        }
        // iron bands
        for (const yy of [y0 + h * 0.3, y0 + h * 0.78]) {
          at('rust', plateGeo(w + 0.014, 0.05, 0.02, { bevel: 0.004, tile: 0.7 }), cx, yy, cz + d / 2 + 0.012);
          at('rust', plateGeo(w + 0.014, 0.05, 0.02, { bevel: 0.004, tile: 0.7 }), cx, yy, cz - d / 2 - 0.012);
          at('rust', plateGeo(0.02, 0.05, d + 0.014, { bevel: 0.004, tile: 0.7 }), cx + w / 2 + 0.012, yy, cz);
          at('rust', plateGeo(0.02, 0.05, d + 0.014, { bevel: 0.004, tile: 0.7 }), cx - w / 2 - 0.012, yy, cz);
        }
        // corner nail heads
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            bolt(cx + sx * (w / 2 - 0.03), y0 + h * 0.55, cz + sz * (d / 2 + 0.025), 0, 0, sz, 0.018, 0.012);
          }
        }
      };
      crate(-0.2, 0.893, 0, 0.7, 0.45, 0.7);
      crate(0.57, 0.893, 0.08, 0.56, 0.4, 0.52);
      // rolled canvas against the front board
      at('tarp', cylGeo(0.085, 0.085, 0.78, { radial: 12, tile: 1.0 }), 0.95, 0.98, 0, Math.PI / 2);
      for (const pz of [-0.24, 0.24]) {
        at('rust', plateGeo(0.2, 0.04, 0.02, { bevel: 0.003, tile: 0.6 }), 0.95, 0.98, pz);
      }
      // rope lashings around the cargo + bed
      const ropeLoop = (yy, pad) => {
        emit(ctx, 'rust', tubeGeo([
          new THREE.Vector3(-0.62 - pad, yy, -0.2), new THREE.Vector3(-0.52, yy, -0.42 - pad),
          new THREE.Vector3(-0.15, yy, -0.46), new THREE.Vector3(0.2, yy, -0.44),
          new THREE.Vector3(0.6, yy, -0.42), new THREE.Vector3(0.9 + pad, yy, -0.1),
          new THREE.Vector3(0.8, yy, 0.2), new THREE.Vector3(0.62, yy, 0.44),
          new THREE.Vector3(0.15, yy, 0.46), new THREE.Vector3(-0.35, yy, 0.44),
          new THREE.Vector3(-0.62, yy, 0.3),
        ], 0.014, { tubularSeg: 24, radialSeg: 4, closed: true, tile: 0.7 }), base);
      };
      ropeLoop(1.0, 0.02);
      ropeLoop(1.22, 0.035);
      // rope knot on the near side
      at('rust', latheGeo([
        [0.0, -0.03], [0.028, -0.02], [0.034, 0.0], [0.026, 0.02], [0.0, 0.03],
      ], { segments: 8 }), 0.72, 1.22, 0.46);
    } else {
      // -------------------------------------------------- cheap map version
      for (let i = 0; i < 5; i++) {
        at(key, plateGeo(0.43, 0.07, 1.13, { bevel: 0.01 }), -0.88 + i * 0.44, 0.86, 0);
      }
      for (const sz of [-1, 1]) {
        at('woodDark', plateGeo(2.2, 0.09, 0.1, { bevel: 0.008 }), 0, 0.8, sz * 0.56);
        at(key, plateGeo(2.2, 0.34, 0.06, { bevel: 0.008 }), 0, 1.06, sz * 0.575);
      }
      for (const sx of [-1, 1]) {
        at(key, plateGeo(0.05, 0.34, 1.13, { bevel: 0.008 }), sx * 1.06, 1.06, 0);
      }
      for (const sx of [-1, 1]) {
        at('metalDark', cylGeo(0.045, 0.045, 1.2, { radial: 8, tile: 1.0 }), sx * 0.72, 0.42, 0, Math.PI / 2);
      }
      for (const sz of [-1, 1]) {
        at('wood', plateGeo(1.2, 0.09, 0.09, { bevel: 0.008 }), -1.7, 0.95, sz * 0.4);
        at('woodDark', cylGeo(0.055, 0.05, 0.14, { radial: 8, tile: 1.0 }), -2.23, 0.95, sz * 0.4, 0, 0, Math.PI / 2);
      }
      at('crate', plateGeo(0.7, 0.45, 0.7, { bevel: 0.01 }), -0.2, 1.12, 0);
      at('crate', plateGeo(0.56, 0.4, 0.52, { bevel: 0.01 }), 0.57, 1.09, 0.08);
      for (const sz of [-0.3, 0.3]) {
        at('rust', plateGeo(0.72, 0.05, 0.02, { bevel: 0.004, tile: 0.7 }), -0.2, 1.12 + 0.1, sz);
      }
      for (let i = 0; i < 16; i++) {
        bolt(-0.9 + i * 0.12, 0.899, i % 2 === 0 ? -0.42 : 0.42, 0, 1, 0, 0.02, 0.012);
      }
    }
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
