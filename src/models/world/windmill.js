/**
 * 风车 · WINDMILL — timber trestle windmill, hero prop.
 *
 * Two levels of detail share one skeleton (layout coords, leg splay, platform,
 * rotating rotor Group, tail boom + vane, lantern request):
 *   - model-stage preview (`ctx.stage === true`): braced/chamfered tower, planked
 *     platform with railing + ladder, boarded head housing, cog + pinion, and
 *     battened sails with a subdivided canvas — ~20k triangles.
 *   - in-game map (`buildWorld`): the same silhouette with cheap rods, a plank
 *     deck and simple battens — well under the 12k map budget.
 */
import * as THREE from 'three';
import { TAU, matrixFor, boxBatch, rodBetween, mergeGeometries, transformed } from '../core.js';
import {
  isPreview, plateGeo, cylGeo, latheGeo, torusGeo, tubeGeo, boltGeo, emit, put,
} from './detail.js';

export const meta = { id: 'windmill', kind: 'world', group: 'hero', label: '风车 · WINDMILL' };

// ---------------------------------------------------------------------------
// local helpers (shared scratch objects, geometry is always disposed by emit/put)
// ---------------------------------------------------------------------------
const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();

/** Tapered round timber from a to b (legs, king posts). */
function taperRod(ctx, key, ax, ay, az, bx, by, bz, rA, rB, radial = 10, tile = 1.4) {
  _dir.set(bx - ax, by - ay, bz - az);
  const len = _dir.length();
  if (len < 1e-4) return;
  _dir.multiplyScalar(1 / len);
  const geo = cylGeo(rB, rA, len, { radial, tile });
  _quat.setFromUnitVectors(UP, _dir);
  _pos.set(ax + (bx - ax) / 2, ay + (by - ay) / 2, az + (bz - az) / 2);
  emit(ctx, key, geo, new THREE.Matrix4().compose(_pos, _quat, ONE));
}

/** Horizontal sawn beam between two points (yaw only). Returns its length. */
function yawBeam(ctx, key, x0, y, z0, x1, z1, h, d, { tile = 1.4, bevel = 0.012 } = {}) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return 0;
  const geo = plateGeo(len, h, d, { bevel, tile });
  put(ctx, key, geo, (x0 + x1) / 2, y, (z0 + z1) / 2, 0, Math.atan2(-dz, dx), 0);
  return len;
}

/** Bolt head at a point, axis `dir`. */
function boltHead(ctx, x, y, z, dx, dy, dz, r = 0.028, h = 0.02, key = 'metal') {
  _dir.set(dx, dy, dz);
  if (_dir.lengthSq() < 1e-6) _dir.set(0, 1, 0);
  _dir.normalize();
  _quat.setFromUnitVectors(UP, _dir);
  emit(ctx, key, boltGeo(r, h, { tile: 1.0 }), new THREE.Matrix4().compose(_pos.set(x, y, z), _quat, ONE));
}

/** Subdivided plane with UVs scaled to world texture metres. */
function canvasGrid(w, h, sx, sy, tile = 1.1) {
  const geo = new THREE.PlaneGeometry(w, h, sx, sy);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  return geo;
}

/** Uniform vertex shade so un-batched wood matches the batched (AO-baked) wood. */
function addShade(geo, base = 0.93, lift = 0.05) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = base + lift * (pos.getY(i) / 9);
    colors[i * 3] = s;
    colors[i * 3 + 1] = s * (0.995 + 0.008 * Math.sin(pos.getX(i) * 5.3 + pos.getZ(i) * 3.1));
    colors[i * 3 + 2] = s * 0.965;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Rotating blade assembly: merged per material so the Group still spins cheaply. */
function buildRotor(ctx, X, Z, hi) {
  const rotor = new THREE.Group();
  rotor.position.set(X, 6.65, Z + 1.15);

  const mats = {
    wood: ctx.materials.wood,
    woodDark: ctx.materials.woodDark,
    canvas: ctx.materials.shade, // pale sail cloth (the awning texture is striped)
    metal: ctx.materials.metal,
    metalDark: ctx.materials.metalDark,
  };
  const rotorParts = new Map();
  const push = (key, geo, m) => {
    const t = transformed(geo, m);
    geo.dispose();
    if (!rotorParts.has(key)) rotorParts.set(key, []);
    rotorParts.get(key).push(t);
  };

  const battenCount = hi ? 24 : 18;
  const canvasSegX = hi ? 10 : 6;
  const canvasSegY = hi ? 16 : 8;

  // ---- four sails -------------------------------------------------------
  const rotZ = new THREE.Matrix4();
  for (let b = 0; b < 4; b++) {
    const angle = (b / 4) * TAU;
    const blade = new Map();
    const bp = (key, geo, m) => {
      const t = transformed(geo, m);
      geo.dispose();
      if (!blade.has(key)) blade.set(key, []);
      blade.get(key).push(t);
    };
    const at = (key, geo, x, y, z, rx = 0, ry = 0, rz = 0) =>
      bp(key, geo, new THREE.Matrix4().makeTranslation(x, y, z)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'))));

    // main stock / spar (bevel keeps the rotor span at the old 2.7 m radius)
    at('wood', plateGeo(0.15, 2.668, 0.12, { bevel: 0.016, tile: 1.4 }), 0, 1.334, 0);
    // sail frame laths
    for (const sx of [-1, 1]) at('woodDark', plateGeo(0.05, 2.34, 0.05, { bevel: 0.008 }), sx * 0.38, 1.46, 0.055);
    at('woodDark', plateGeo(0.82, 0.075, 0.06, { bevel: 0.008 }), 0, 2.62, 0.055);
    at('woodDark', plateGeo(0.82, 0.075, 0.06, { bevel: 0.008 }), 0, 0.31, 0.055);
    // canvas: subdivided so the shading breaks up like cloth
    at('canvas', canvasGrid(0.74, 2.26, canvasSegX, canvasSegY), 0, 1.46, 0.045);
    // battens
    const y0 = 0.42;
    const y1 = 2.53;
    for (let i = 0; i < battenCount; i++) {
      const y = y0 + ((y1 - y0) * i) / (battenCount - 1);
      at('woodDark', plateGeo(0.78, 0.045, 0.045, { bevel: 0.006 }), 0, y, 0.088);
    }
    // sail tip cap + stock iron straps
    at('woodDark', plateGeo(0.18, 0.09, 0.13, { bevel: 0.01 }), 0, 2.64, 0);
    if (hi) {
      // back-side diagonal braces from the stock out to the sail corners
      for (const sx of [-1, 1]) {
        const x1 = sx * 0.38;
        const len = Math.hypot(x1, 2.3);
        bp('wood', cylGeo(0.024, 0.024, len, { radial: 6, tile: 1.4 }),
          new THREE.Matrix4().compose(
            new THREE.Vector3(x1 / 2, 1.45, -0.06),
            new THREE.Quaternion().setFromUnitVectors(UP, _dir.set(x1 / len, 2.3 / len, 0).normalize()),
            ONE));
      }
      // iron straps clamping the stock
      for (const yy of [0.62, 1.46, 2.3]) {
        at('metal', plateGeo(0.21, 0.06, 0.17, { bevel: 0.008, tile: 1.2 }), 0, yy, 0);
      }
    }
    // blade bolts through the frame laths (heads face the sail face)
    const nb = hi ? 6 : 0;
    for (let i = 0; i < nb; i++) {
      const y = 0.55 + i * 0.38;
      const sx = i % 2 === 0 ? -1 : 1;
      bp('metal', boltGeo(0.022, 0.014, { tile: 0.8 }),
        new THREE.Matrix4().makeTranslation(sx * 0.38, y, 0.105)
          .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    }
    rotZ.makeRotationZ(angle);
    for (const [key, geos] of blade) {
      for (const g of geos) {
        g.applyMatrix4(rotZ);
        if (!rotorParts.has(key)) rotorParts.set(key, []);
        rotorParts.get(key).push(g);
      }
    }
  }

  // ---- hub boss, straps, bolts -----------------------------------------
  const hubProfile = [
    [0.0, -0.3], [0.1, -0.3], [0.16, -0.24], [0.175, -0.02],
    [0.15, 0.1], [0.1, 0.16], [0.0, 0.16],
  ];
  push('metalDark', latheGeo(hubProfile, { segments: hi ? 20 : 12 }),
    new THREE.Matrix4().makeTranslation(0, 0, -0.1)
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  push('rust', torusGeo(0.185, 0.022, { radialSeg: 6, tubularSeg: hi ? 16 : 10 }),
    new THREE.Matrix4().makeTranslation(0, 0, 0.02));
  for (let i = 0; i < 4; i++) {
    push('woodDark', plateGeo(0.24, 0.9, 0.05, { bevel: 0.008 }),
      new THREE.Matrix4().makeTranslation(0, 0.48, 0.055)
        .multiply(new THREE.Matrix4().makeRotationZ((i / 4) * TAU)));
  }
  const hubBolts = hi ? 8 : 4;
  for (let i = 0; i < hubBolts; i++) {
    const a = (i / hubBolts) * TAU;
    push('metal', boltGeo(0.026, 0.018, { tile: 0.8 }),
      new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.125, Math.sin(a) * 0.125, 0.07));
  }
  push('metal', boltGeo(0.055, 0.05, { tile: 0.8 }), new THREE.Matrix4().makeTranslation(0, 0, 0.075));

  // ---- merge per material, add to the rotating group -------------------
  for (const [key, geos] of rotorParts) {
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    if (key === 'wood' || key === 'woodDark') addShade(merged, key === 'woodDark' ? 0.8 : 0.93, 0.06);
    const mesh = new THREE.Mesh(merged, mats[key]);
    mesh.name = `rotor:${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    rotor.add(mesh);
    ctx.disposables.push(merged);
  }

  ctx.scene.add(rotor);
  ctx.objects.push(rotor);
  ctx.animated.push({ kind: 'rotor', obj: rotor, speed: 0.22, axis: 'z' });
  return rotor;
}

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const w = ctx.data.layout.hero.windmill;
  const X = w.x;
  const Z = w.z;
  const hi = isPreview(ctx);

  // ---- trestle: four splayed legs on the cardinal axes (keeps the axis-aligned
  // map collision box backed by geometry) -------------------------------------
  const legBaseR = 0.95;
  const legTopR = 0.3;
  const legTopY = 6.3;
  const legR = (y) => legBaseR + ((legTopR - legBaseR) * y) / legTopY;
  const legX = (i, y) => X + Math.cos((i / 4) * TAU) * legR(y);
  const legZ = (i, y) => Z + Math.sin((i / 4) * TAU) * legR(y);

  for (let i = 0; i < 4; i++) {
    const bx = legX(i, 0);
    const bz = legZ(i, 0);
    const tx = legX(i, legTopY);
    const tz = legZ(i, legTopY);
    if (hi) {
      const mx = legX(i, 3.15);
      const mz = legZ(i, 3.15);
      taperRod(ctx, 'wood', bx, 0.02, bz, mx, 3.15, mz, 0.158, 0.118, 10);
      taperRod(ctx, 'wood', mx, 3.15, mz, tx, legTopY, tz, 0.118, 0.078, 10);
      // stone footing + iron base shoe
      put(ctx, 'stone', plateGeo(0.52, 0.16, 0.52, { bevel: 0.022, tile: 1.8 }), bx, 0.102, bz);
      put(ctx, 'metal', plateGeo(0.34, 0.05, 0.34, { bevel: 0.01, tile: 1.2 }), bx, 0.205, bz);
      boltHead(ctx, bx + 0.19, 0.235, bz, 0, 1, 0, 0.024, 0.016);
      boltHead(ctx, bx - 0.19, 0.235, bz, 0, 1, 0, 0.024, 0.016);
      // iron clamp where the two leg sections scarf together
      put(ctx, 'metal', plateGeo(0.27, 0.075, 0.27, { bevel: 0.008, tile: 1.2 }), bx + (tx - bx) * 0.5, 3.15, bz + (tz - bz) * 0.5);
      boltHead(ctx, bx + (tx - bx) * 0.5, 3.15, bz + (tz - bz) * 0.5 + 0.15, 0, 0, 1, 0.022, 0.014);
      boltHead(ctx, bx + (tx - bx) * 0.5, 3.15, bz + (tz - bz) * 0.5 - 0.15, 0, 0, -1, 0.022, 0.014);
    } else {
      taperRod(ctx, 'wood', bx, 0.014, bz, tx, legTopY, tz, 0.12, 0.08, 10);
      put(ctx, 'stone', plateGeo(0.46, 0.14, 0.46, { bevel: 0.02, tile: 1.8 }), bx, 0.09, bz);
    }
  }

  // ---- horizontal girts (braced rings) ------------------------------------
  const girtYs = hi ? [1.05, 2.2, 3.35, 4.5, 5.65] : [1.6, 3.4, 5.2];
  for (const y of girtYs) {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const x0 = legX(i, y);
      const z0 = legZ(i, y);
      const x1 = legX(j, y);
      const z1 = legZ(j, y);
      if (hi) yawBeam(ctx, 'wood', x0, y, z0, x1, z1, 0.15, 0.13);
      else rodBetween(ctx, 'wood', x0, y, z0, x1, y, z1, 0.055, 6, 1.3);
      if (hi) {
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz) || 1;
        const mx = (x0 + x1) / 2 - X;
        const mz = (z0 + z1) / 2 - Z;
        const ml = Math.hypot(mx, mz) || 1;
        const nx = mx / ml;
        const nz = mz / ml;
        for (const end of [0, 1]) {
          const ex = end ? x1 - (dx / len) * 0.24 : x0 + (dx / len) * 0.24;
          const ez = end ? z1 - (dz / len) * 0.24 : z0 + (dz / len) * 0.24;
          boltHead(ctx, ex + nx * 0.075, y, ez + nz * 0.075, nx, 0, nz, 0.03, 0.022);
        }
      }
    }
  }

  if (hi) {
    // knee braces under every girt (upper four rings), clamped to leg + beam
    for (const y of girtYs.slice(1)) {
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const x0 = legX(i, y);
        const z0 = legZ(i, y);
        const x1 = legX(j, y);
        const z1 = legZ(j, y);
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz) || 1;
        for (const end of [0, 1]) {
          const legIdx = end ? j : i;
          const ex = end ? x1 - (dx / len) * 0.5 : x0 + (dx / len) * 0.5;
          const ez = end ? z1 - (dz / len) * 0.5 : z0 + (dz / len) * 0.5;
          rodBetween(ctx, 'wood',
            legX(legIdx, y - 0.64), y - 0.64, legZ(legIdx, y - 0.64),
            ex, y - 0.03, ez, 0.036, 6, 1.4);
        }
      }
    }
    // X cross-bracing on the two lowest bands
    for (const [y0, y1] of [[1.05, 2.2], [2.2, 3.35]]) {
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        rodBetween(ctx, 'wood', legX(i, y0), y0, legZ(i, y0), legX(j, y1), y1, legZ(j, y1), 0.034, 6, 1.4);
        rodBetween(ctx, 'wood', legX(j, y0), y0, legZ(j, y0), legX(i, y1), y1, legZ(i, y1), 0.034, 6, 1.4);
        const mx = (legX(i, y0) + legX(j, y1)) / 2;
        const mz = (legZ(i, y0) + legZ(j, y1)) / 2;
        boltHead(ctx, mx, (y0 + y1) / 2, mz, 0, 1, 0, 0.03, 0.02);
      }
    }
  } else {
    // cheaper map bracing: knee braces at the two upper rings + one X per face
    for (const y of girtYs.slice(1)) {
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const x0 = legX(i, y);
        const z0 = legZ(i, y);
        const x1 = legX(j, y);
        const z1 = legZ(j, y);
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz) || 1;
        for (const end of [0, 1]) {
          const legIdx = end ? j : i;
          const ex = end ? x1 - (dx / len) * 0.5 : x0 + (dx / len) * 0.5;
          const ez = end ? z1 - (dz / len) * 0.5 : z0 + (dz / len) * 0.5;
          rodBetween(ctx, 'wood',
            legX(legIdx, y - 0.7), y - 0.7, legZ(legIdx, y - 0.7),
            ex, y - 0.03, ez, 0.03, 5, 1.4);
        }
      }
    }
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      rodBetween(ctx, 'wood', legX(i, 1.6), 1.6, legZ(i, 1.6), legX(j, 3.4), 3.4, legZ(j, 3.4), 0.028, 5, 1.4);
    }
  }

  // ---- platform ------------------------------------------------------------
  if (hi) {
    for (const z of [-0.6, 0, 0.6]) put(ctx, 'wood', plateGeo(1.8, 0.09, 0.11, { bevel: 0.012 }), X, 6.345, Z + z);
    for (let i = 0; i < 10; i++) {
      put(ctx, 'wood', plateGeo(1.86, 0.05, 0.19, { bevel: 0.01 }), X, 6.415, Z + (-0.855 + i * 0.19));
    }
    put(ctx, 'woodDark', plateGeo(1.94, 0.1, 0.08, { bevel: 0.01 }), X, 6.37, Z - 0.93);
    put(ctx, 'woodDark', plateGeo(1.94, 0.1, 0.08, { bevel: 0.01 }), X, 6.37, Z + 0.93);
    put(ctx, 'woodDark', plateGeo(0.08, 0.1, 1.94, { bevel: 0.01 }), X - 0.93, 6.37, Z);
    put(ctx, 'woodDark', plateGeo(0.08, 0.1, 1.94, { bevel: 0.01 }), X + 0.93, 6.37, Z);
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      put(ctx, 'wood', plateGeo(0.2, 0.2, 0.06, { bevel: 0.01 }), X + px * 0.8, 6.33, Z + pz * 0.8);
    }
    // nails along the deck boards
    for (let i = 0; i < 10; i++) {
      const z = -0.855 + i * 0.19;
      for (const sx of [-1, 1]) {
        boltHead(ctx, X + sx * 0.78, 6.445, Z + z, 0, 1, 0, 0.018, 0.012);
      }
    }
    // knee braces from the leg tops up to the deck underside
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const mx = (legX(i, 6.1) + legX(j, 6.1)) / 2;
      const mz = (legZ(i, 6.1) + legZ(j, 6.1)) / 2;
      for (const end of [0, 1]) {
        const lx = end ? legX(j, 5.55) : legX(i, 5.55);
        const lz = end ? legZ(j, 5.55) : legZ(i, 5.55);
        rodBetween(ctx, 'wood', lx, 5.55, lz, mx + (end ? 0.3 : -0.3), 6.29, mz, 0.032, 5, 1.4);
      }
    }
  } else {
    // map deck: six boards on two joists
    for (const z of [-0.45, 0.45]) put(ctx, 'wood', plateGeo(1.8, 0.09, 0.12, { bevel: 0.01 }), X, 6.345, Z + z);
    for (let i = 0; i < 6; i++) {
      put(ctx, 'wood', plateGeo(1.86, 0.05, 0.3, { bevel: 0.01 }), X, 6.415, Z + (-0.75 + i * 0.3));
    }
  }

  // ---- platform railing (left + back, gap at the boom and ladder) ----------
  if (hi) {
    const posts = [[-0.9, -0.9], [-0.9, 0], [-0.9, 0.9], [-0.28, -0.9], [0.28, -0.9], [0.9, -0.9], [0.9, 0]];
    for (const [px, pz] of posts) {
      put(ctx, 'woodDark', plateGeo(0.075, 0.62, 0.075, { bevel: 0.008 }), X + px, 6.75, Z + pz);
    }
    const segs = [
      [-0.9, -0.9, -0.9, 0.9],
      [0.9, -0.9, 0.9, 0],
      [-0.9, -0.9, -0.28, -0.9],
      [0.28, -0.9, 0.9, -0.9],
    ];
    for (const [x0, z0, x1, z1] of segs) {
      yawBeam(ctx, 'wood', X + x0, 6.98, Z + z0, X + x1, Z + z1, 0.06, 0.05, { bevel: 0.008 });
      yawBeam(ctx, 'wood', X + x0, 6.74, Z + z0, X + x1, Z + z1, 0.055, 0.045, { bevel: 0.008 });
    }
    for (const [px, pz] of posts) boltHead(ctx, X + px, 7.06, Z + pz, 0, 1, 0, 0.022, 0.014);
    for (const [x0, z0, x1, z1] of segs) {
      boltHead(ctx, X + x0, 6.98, Z + z0, 0, 0, 1, 0.022, 0.014);
      boltHead(ctx, X + x1, 6.98, Z + z1, 0, 0, 1, 0.022, 0.014);
      // thin balusters between the two rails
      for (const t of [0.34, 0.67]) {
        put(ctx, 'woodDark', plateGeo(0.05, 0.5, 0.045, { bevel: 0.006 }),
          X + x0 + (x1 - x0) * t, 6.73, Z + z0 + (z1 - z0) * t);
      }
    }
  } else {
    // map railing: corner posts + two rails on the left and back edges
    for (const [px, pz] of [[-0.9, -0.9], [-0.9, 0.9], [0.9, -0.9]]) {
      put(ctx, 'woodDark', plateGeo(0.07, 0.55, 0.07, { bevel: 0.006 }), X + px, 6.72, Z + pz);
    }
    put(ctx, 'wood', plateGeo(0.06, 0.055, 1.8, { bevel: 0.006 }), X - 0.9, 6.94, Z);
    put(ctx, 'wood', plateGeo(1.8, 0.055, 0.06, { bevel: 0.006 }), X, 6.94, Z - 0.9);
  }

  // ---- ladder up the +X face ----------------------------------------------
  {
    const bottom = [X + 1.6, 0, Z];
    const top = [X + 1.0, 6.44, Z];
    const lean = Math.atan2(bottom[0] - top[0], top[1]); // tilt back toward the tower
    const len = Math.hypot(bottom[0] - top[0], top[1]);
    // bevel expands the extruded outline, so account for it when planting the feet
    const stileW = hi ? 0.075 : 0.07;
    const stileH = len + 0.04;
    const halfV = ((stileW + 0.016) * Math.sin(lean) + (stileH + 0.016) * Math.cos(lean)) / 2;
    for (const sz of [-1, 1]) {
      put(ctx, 'wood',
        plateGeo(stileW, stileH, 0.06, { bevel: 0.008 }),
        (bottom[0] + top[0]) / 2, halfV, Z + sz * 0.22, 0, 0, lean);
    }
    const rungs = hi ? 19 : 14;
    for (let i = 1; i <= rungs; i++) {
      const t = i / (rungs + 1);
      const y = top[1] * t;
      const x = bottom[0] + (top[0] - bottom[0]) * t;
      put(ctx, 'wood', plateGeo(0.06, 0.055, 0.44, { bevel: 0.008 }), x, y, Z, 0, 0, lean);
      if (hi) {
        boltHead(ctx, x, y, Z + 0.245, 0, 0, 1, 0.02, 0.014);
        boltHead(ctx, x, y, Z - 0.245, 0, 0, -1, 0.02, 0.014);
      }
    }
    // top brackets tying the ladder to the platform edge
    for (const sz of [-1, 1]) {
      put(ctx, 'metal', plateGeo(0.26, 0.06, 0.09, { bevel: 0.008 }), X + 1.0, 6.42, Z + sz * 0.22);
      boltHead(ctx, X + 0.98, 6.42, Z + sz * 0.22, 0, 1, 0, 0.022, 0.014);
    }
    // ground shoes
    for (const sz of [-1, 1]) {
      put(ctx, 'metal', plateGeo(0.16, 0.035, 0.12, { bevel: 0.006, tile: 1.0 }), X + 1.6, 0.024, Z + sz * 0.22);
    }
  }

  // ---- head housing (hi only; the map keeps the bare hub) -----------------
  if (hi) {
    const hw = 0.62; // half width
    const hd = 0.55; // half depth
    // corner posts
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        put(ctx, 'wood', plateGeo(0.095, 0.84, 0.095, { bevel: 0.008 }), X + sx * hw, 6.86, Z + sz * hd);
      }
    }
    // back wall planks
    for (let i = 0; i < 5; i++) {
      put(ctx, 'wood', plateGeo(1.24, 0.15, 0.05, { bevel: 0.008 }), X, 6.52 + i * 0.16, Z - hd);
    }
    // side walls
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        put(ctx, 'wood', plateGeo(0.05, 0.15, 1.1, { bevel: 0.008 }), X + sx * hw, 6.52 + i * 0.16, Z);
      }
    }
    // front wall: boards around the axle opening
    put(ctx, 'wood', plateGeo(1.24, 0.15, 0.05, { bevel: 0.008 }), X, 6.52, Z + hd);
    put(ctx, 'wood', plateGeo(1.24, 0.15, 0.05, { bevel: 0.008 }), X, 6.84, Z + hd);
    put(ctx, 'wood', plateGeo(1.24, 0.15, 0.05, { bevel: 0.008 }), X, 7.0, Z + hd);
    put(ctx, 'wood', plateGeo(1.24, 0.15, 0.05, { bevel: 0.008 }), X, 7.16, Z + hd);
    for (const sx of [-1, 1]) {
      put(ctx, 'wood', plateGeo(0.4, 0.16, 0.05, { bevel: 0.008 }), X + sx * 0.42, 6.67, Z + hd);
    }
    // roof: four boards per pitch + ridge cap
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const z = -0.62 + i * 0.4;
        put(ctx, 'woodDark', plateGeo(0.74, 0.055, 0.37, { bevel: 0.008 }),
          X + sx * 0.33, 7.37, Z + z, 0, 0, -sx * 0.375);
      }
      put(ctx, 'wood', plateGeo(0.08, 0.1, 1.3, { bevel: 0.008 }), X + sx * 0.66, 7.22, Z, 0, 0, -sx * 0.375);
    }
    put(ctx, 'woodDark', plateGeo(0.13, 0.07, 1.34, { bevel: 0.01 }), X, 7.53, Z);
    // roof battens
    for (const sx of [-1, 1]) {
      for (const zz of [-0.42, 0.02, 0.46]) {
        put(ctx, 'woodDark', plateGeo(0.82, 0.035, 0.07, { bevel: 0.006, tile: 1.0 }),
          X + sx * 0.33, 7.405, Z + zz, 0, 0, -sx * 0.375);
      }
    }
    // gable infill boards
    for (const sz of [-1, 1]) {
      put(ctx, 'woodDark', plateGeo(0.52, 0.15, 0.05, { bevel: 0.008 }), X, 7.34, Z + sz * 0.6);
      put(ctx, 'woodDark', plateGeo(0.28, 0.13, 0.05, { bevel: 0.008 }), X, 7.46, Z + sz * 0.6);
    }
    // door on the back wall
    put(ctx, 'woodDark', plateGeo(0.38, 0.62, 0.045, { bevel: 0.008 }), X, 6.77, Z - hd - 0.03);
    for (const sx of [-1, 1]) {
      put(ctx, 'wood', plateGeo(0.06, 0.7, 0.06, { bevel: 0.006 }), X + sx * 0.22, 6.77, Z - hd - 0.05);
    }
    put(ctx, 'wood', plateGeo(0.5, 0.07, 0.06, { bevel: 0.006 }), X, 7.11, Z - hd - 0.05);
    for (const yy of [6.6, 6.96]) {
      put(ctx, 'rust', plateGeo(0.2, 0.055, 0.03, { bevel: 0.006, tile: 1.0 }), X + 0.12, yy, Z - hd - 0.06);
    }
    boltHead(ctx, X - 0.1, 6.78, Z - hd - 0.07, 0, 0, -1, 0.02, 0.014);
    boltHead(ctx, X + 0.2, 7.0, Z - hd - 0.08, 0, 0, -1, 0.02, 0.014);
    // window on the left wall
    put(ctx, 'dark', plateGeo(0.04, 0.26, 0.3, { bevel: 0.006, tile: 1.0 }), X - hw - 0.02, 6.86, Z + 0.12);
    put(ctx, 'woodDark', plateGeo(0.05, 0.05, 0.4, { bevel: 0.006 }), X - hw - 0.05, 7.02, Z + 0.12);
    put(ctx, 'woodDark', plateGeo(0.05, 0.05, 0.4, { bevel: 0.006 }), X - hw - 0.05, 6.7, Z + 0.12);
    for (const sz of [-1, 1]) {
      put(ctx, 'woodDark', plateGeo(0.05, 0.3, 0.05, { bevel: 0.006 }), X - hw - 0.05, 6.86, Z + 0.12 + sz * 0.17);
    }
    // wall corner bolts
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        boltHead(ctx, X + sx * 0.67, 7.0, Z + sz * 0.55, sx, 0, 0, 0.022, 0.014);
        boltHead(ctx, X + sx * 0.67, 6.66, Z + sz * 0.55, sx, 0, 0, 0.022, 0.014);
      }
    }

    // ---- main axle (lathed) + bearing block ------------------------------
    const axleProfile = [
      [0.0, -0.3], [0.1, -0.3], [0.125, -0.24], [0.135, -0.05], [0.135, 0.05],
      [0.115, 0.22], [0.095, 0.27], [0.095, 0.3], [0.0, 0.3],
    ];
    put(ctx, 'metalDark', latheGeo(axleProfile, { segments: 18 }), X, 6.65, Z + 0.85, Math.PI / 2, 0, 0);
    // bearing block proud of the front wall, clear of the cog wheel
    put(ctx, 'woodDark', plateGeo(0.3, 0.28, 0.05, { bevel: 0.01 }), X, 6.65, Z + 0.58);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        boltHead(ctx, X + sx * 0.11, 6.65 + sy * 0.1, Z + 0.61, 0, 0, 1, 0.024, 0.016);
      }
    }

    // ---- great cog wheel on the axle -------------------------------------
    const gearZ = Z + 0.66;
    const rimProfile = [
      [0.16, -0.03], [0.52, -0.03], [0.52, 0.03], [0.16, 0.03], [0.16, -0.03],
    ];
    put(ctx, 'woodDark', latheGeo(rimProfile, { segments: 20 }), X, 6.65, gearZ, Math.PI / 2, 0, 0);
    const teeth = 30;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * TAU;
      put(ctx, 'wood', plateGeo(0.12, 0.13, 0.085, { bevel: 0.01 }),
        X + Math.cos(a) * 0.575, 6.65 + Math.sin(a) * 0.575, gearZ, 0, 0, a);
      if (i % 2 === 0) {
        boltHead(ctx, X + Math.cos(a) * 0.34, 6.65 + Math.sin(a) * 0.34, gearZ + 0.032, 0, 0, 1, 0.024, 0.016);
      }
    }
    // spokes
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      put(ctx, 'wood', plateGeo(0.36, 0.09, 0.055, { bevel: 0.008 }),
        X + Math.cos(a) * 0.31, 6.65 + Math.sin(a) * 0.31, gearZ, 0, 0, a);
    }
    // iron hub boss + bolts on the cog face
    put(ctx, 'metalDark', cylGeo(0.19, 0.19, 0.13, { radial: 16, tile: 1.0 }), X, 6.65, gearZ, Math.PI / 2, 0, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      boltHead(ctx, X + Math.cos(a) * 0.13, 6.65 + Math.sin(a) * 0.13, gearZ + 0.07, 0, 0, 1, 0.022, 0.014);
    }
    // brake lever on the front wall with its rope led down to a deck cleat
    put(ctx, 'woodDark', plateGeo(0.14, 0.2, 0.07, { bevel: 0.008 }), X + 0.42, 6.98, Z + hd + 0.03);
    boltHead(ctx, X + 0.42, 7.04, Z + hd + 0.075, 0, 0, 1, 0.022, 0.014);
    rodBetween(ctx, 'wood', X + 0.42, 6.98, Z + hd + 0.05, X + 0.56, 7.12, Z + hd + 0.09, 0.026, 6, 1.4);
    put(ctx, 'woodDark', cylGeo(0.045, 0.04, 0.14, { radial: 8, tile: 1.0 }), X + 0.565, 7.14, Z + hd + 0.095, 0, 0, -0.55);
    emit(ctx, 'rust', tubeGeo([
      new THREE.Vector3(X + 0.56, 7.12, Z + hd + 0.09),
      new THREE.Vector3(X + 0.66, 6.8, Z + hd + 0.21),
      new THREE.Vector3(X + 0.72, 6.47, Z + hd + 0.3),
    ], 0.016, { tubularSeg: 10, radialSeg: 4, tile: 0.8 }),
    new THREE.Matrix4().makeTranslation(0, 0, 0));
    put(ctx, 'woodDark', plateGeo(0.2, 0.045, 0.09, { bevel: 0.006 }), X + 0.74, 6.455, Z + hd + 0.32);
    boltHead(ctx, X + 0.68, 6.47, Z + hd + 0.32, 0, 1, 0, 0.02, 0.014);
    boltHead(ctx, X + 0.79, 6.47, Z + hd + 0.32, 0, 1, 0, 0.02, 0.014);
  } else {
    // map head: boarded housing, plain cog and axle (still reads as the mill head)
    const hw = 0.62;
    const hd = 0.55;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        put(ctx, 'wood', plateGeo(0.09, 0.8, 0.09, { bevel: 0.008 }), X + sx * hw, 6.84, Z + sz * hd);
      }
    }
    for (const sz of [-1, 1]) {
      put(ctx, 'wood', plateGeo(1.24, 0.36, 0.05, { bevel: 0.008 }), X, 6.66, Z + sz * hd);
    }
    for (const sx of [-1, 1]) {
      put(ctx, 'wood', plateGeo(0.05, 0.36, 1.1, { bevel: 0.008 }), X + sx * hw, 6.66, Z);
    }
    for (const sx of [-1, 1]) {
      put(ctx, 'woodDark', plateGeo(0.74, 0.06, 1.3, { bevel: 0.008 }), X + sx * 0.33, 7.37, Z, 0, 0, -sx * 0.375);
    }
    put(ctx, 'woodDark', plateGeo(0.13, 0.07, 1.32, { bevel: 0.008 }), X, 7.52, Z);
    put(ctx, 'woodDark', plateGeo(0.36, 0.6, 0.04, { bevel: 0.006 }), X, 6.76, Z - hd - 0.03);
    put(ctx, 'dark', plateGeo(0.04, 0.24, 0.28, { bevel: 0.005 }), X - hw - 0.02, 6.86, Z + 0.1);
    // cog wheel: plain disc + teeth + spokes
    const gearZ = Z + 0.66;
    put(ctx, 'woodDark', cylGeo(0.5, 0.5, 0.06, { radial: 16, tile: 1.2 }), X, 6.65, gearZ, Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      put(ctx, 'wood', plateGeo(0.12, 0.13, 0.08, { bevel: 0.01 }),
        X + Math.cos(a) * 0.56, 6.65 + Math.sin(a) * 0.56, gearZ, 0, 0, a);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      put(ctx, 'wood', plateGeo(0.34, 0.09, 0.05, { bevel: 0.006 }),
        X + Math.cos(a) * 0.3, 6.65 + Math.sin(a) * 0.3, gearZ, 0, 0, a);
    }
    const axle = new THREE.CylinderGeometry(0.13, 0.13, 0.6, 12);
    ctx.batcher.add('metalDark', axle, matrixFor(X, 6.65, Z + 0.85, Math.PI / 2, 0, 0));
    axle.dispose();
    const hub = new THREE.CylinderGeometry(0.19, 0.19, 0.22, 10);
    ctx.batcher.add('metalDark', hub, matrixFor(X, 6.65, Z + 1.07, Math.PI / 2, 0, 0));
    hub.dispose();
    // a handful of structural bolts so the map silhouette keeps the "bolted timber" read
    for (const y of girtYs) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        boltHead(ctx, legX(i, y) + Math.cos(a) * 0.125, y, legZ(i, y) + Math.sin(a) * 0.125, Math.cos(a), 0, Math.sin(a), 0.026, 0.018);
      }
    }
    for (const [px, pz] of [[-0.8, -0.8], [0.8, 0.8]]) {
      boltHead(ctx, X + px, 6.445, Z + pz, 0, 1, 0, 0.024, 0.016);
    }
    for (const sx of [-1, 1]) {
      boltHead(ctx, X + sx * 0.66, 7.0, Z + 0.55, sx, 0, 0, 0.022, 0.014);
    }
  }

  // ---- tail vane carried by a real boom off the platform -------------------
  // (the boom + struts stay exactly as they were: they are what makes the vane
  // visibly attached instead of floating)
  if (!hi) {
    // map vane: flat sheet panel, but with a real frame so it does not read as a slab
    boxBatch(ctx, 'sheet', X, 6.6, Z - 1.6, 0.1, 0.7, 1.5, { tile: 1.2 });
    for (const zz of [-2.3, -0.9]) {
      boxBatch(ctx, 'woodDark', X, 6.6, Z + zz, 0.11, 0.74, 0.09, { tile: 1.2 });
    }
    boxBatch(ctx, 'woodDark', X, 6.92, Z - 1.6, 0.11, 0.08, 1.52, { tile: 1.2 });
    boxBatch(ctx, 'woodDark', X, 6.28, Z - 1.6, 0.11, 0.08, 1.52, { tile: 1.2 });
    for (const zz of [-2.3, -0.9]) {
      boltHead(ctx, X + 0.07, 6.6, Z + zz, 1, 0, 0, 0.02, 0.014);
    }
  }
  boxBatch(ctx, 'wood', X, 6.55, Z - 1.28, 0.12, 0.12, 0.78, { tile: 1.2 });
  for (const s of [-1, 1]) {
    rodBetween(ctx, 'wood', X + s * 0.72, 6.44, Z - 0.88, X + s * 0.05, 6.54, Z - 1.58, 0.045, 4);
  }
  if (hi) {
    // boarded vane filling the same envelope as the old flat sheet vane
    for (let i = 0; i < 4; i++) {
      put(ctx, 'wood', plateGeo(0.07, 0.16, 1.46, { bevel: 0.008 }), X, 6.33 + i * 0.16, Z - 1.6);
    }
    put(ctx, 'woodDark', plateGeo(0.095, 0.075, 1.52, { bevel: 0.008 }), X, 6.9, Z - 1.6);
    put(ctx, 'woodDark', plateGeo(0.095, 0.075, 1.52, { bevel: 0.008 }), X, 6.26, Z - 1.6);
    for (const zz of [-2.3, -1.6, -0.9]) {
      put(ctx, 'woodDark', plateGeo(0.095, 0.72, 0.09, { bevel: 0.008 }), X, 6.58, Z + zz);
    }
    // iron rivets down the two end stiles
    for (const zz of [-2.3, -0.9]) {
      for (let i = 0; i < 4; i++) {
        boltHead(ctx, X + 0.05, 6.33 + i * 0.17, Z + zz, 1, 0, 0, 0.022, 0.014);
      }
    }
    // riveted strap onto the boom and diagonal tie rods
    put(ctx, 'rust', plateGeo(0.14, 0.16, 0.3, { bevel: 0.008, tile: 1.0 }), X, 6.55, Z - 1.28);
    boltHead(ctx, X + 0.077, 6.55, Z - 1.28, 1, 0, 0, 0.024, 0.016);
    for (const zz of [-1.22, -1.98]) {
      put(ctx, 'rust', plateGeo(0.055, 0.54, 0.08, { bevel: 0.006, tile: 1.0 }), X + 0.045, 6.58, Z + zz);
      boltHead(ctx, X + 0.08, 6.4, Z + zz, 1, 0, 0, 0.02, 0.014);
      boltHead(ctx, X + 0.08, 6.76, Z + zz, 1, 0, 0, 0.02, 0.014);
    }
    for (const s of [-1, 1]) {
      rodBetween(ctx, 'wood', X + s * 0.05, 6.32, Z - 2.12, X + s * 0.05, 6.84, Z - 1.1, 0.022, 4, 1.2);
    }
  }

  // ---- rope coil wound around the +X leg ----------------------------------
  if (hi) {
    const coilY = 1.95;
    const cx = legX(0, coilY);
    for (let i = 0; i < 3; i++) {
      put(ctx, 'rust', torusGeo(0.14, 0.032, { radialSeg: 6, tubularSeg: 14, tile: 0.9 }),
        cx, coilY + i * 0.075, Z, Math.PI / 2, 0, 0);
    }
    // stub peg the coil hangs from
    rodBetween(ctx, 'wood', cx, coilY + 0.16, Z, cx + 0.26, coilY + 0.16, Z, 0.022, 5, 1.2);
  }

  // ---- rotating blade assembly (same Group contract as before) -----------
  buildRotor(ctx, X, Z, hi);

  // lantern hangs from the platform underside instead of floating in mid-air
  ctx.req.lanterns.push({ x: w.x + 0.55, y: 5.72, z: w.z + 0.55, kind: 'warm', size: 0.2, hang: 6.26 });
}
