import * as THREE from 'three';
import { TAU, matrixFor, rodBetween } from '../core.js';
import {
  boltGeo,
  cylGeo,
  isPreview,
  latheGeo,
  plateGeo,
  put,
  rockGeo,
  sphereGeo,
  torusGeo,
  tubeGeo,
} from './detail.js';

export const meta = { id: 'campfire', kind: 'world', group: 'hero', label: '篝火 · CAMPFIRE' };

const FIRE_TILE = 1.5;
const FIRE_APEX_Y = 1.92; // tripod apex (sail / pot chain hang from here)
const FIRE_POT_Y = 1.44; // pot centre
const FIRE_RING_R = 0.7; // stone ring radius (ring diameter ~1.6 m)

/** Deterministic 0…1 hash so the prop scatters the same way every build. */
function hash01(i, seed = 0) {
  const n = Math.sin(i * 91.7 + seed * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Natural stone resting on a surface: rotate first, then drop the geometry so its
 * lowest vertex sits exactly on `baseY` (nothing ever floats or digs in).
 */
function restingRock(ctx, key, r, opts, x, baseY, z, ry = 0, tiltX = 0, tiltZ = 0, squash = 1) {
  const geo = rockGeo(r, opts);
  if (squash !== 1) geo.scale(squash, 1, squash); // compact the lumpy silhouette
  if (tiltX) geo.rotateX(tiltX);
  if (tiltZ) geo.rotateZ(tiltZ);
  if (ry) geo.rotateY(ry);
  geo.computeBoundingBox();
  ctx.batcher.add(key, geo, matrixFor(x, baseY - geo.boundingBox.min.y, z));
  geo.dispose();
}

/** Tapered log / rod between two points (`rA` at a, `rB` at b). */
function taperedRod(ctx, key, ax, ay, az, bx, by, bz, rA, rB, radial = 10, tile = 1.4) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const geo = cylGeo(rB, rA, len, { radial, tile });
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).divideScalar(len));
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(ax + dx / 2, ay + dy / 2, az + dz / 2), q, new THREE.Vector3(1, 1, 1)
  );
  ctx.batcher.add(key, geo, m);
  geo.dispose();
}

/**
 * Log whose butt end rests exactly on the ground: solves the butt height for the
 * tilted end disc (radius `rA`), draws the log and returns that butt height.
 */
function groundRod(ctx, key, ax, az, bx, by, bz, rA, rB, radial = 10, tile = 1.4) {
  let ay = rA;
  for (let i = 0; i < 3; i++) {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const ny = (by - ay) / len;
    ay = rA * Math.sqrt(Math.max(0, 1 - ny * ny));
  }
  taperedRod(ctx, key, ax, ay, az, bx, by, bz, rA, rB, radial, tile);
  return ay;
}

/** Flat disc capping a log end (end grain), facing along `dir`. */
function endDisc(ctx, key, x, y, z, dir, r, radial = 12) {
  const geo = cylGeo(r, r, 0.016, { radial, tile: 1.0 });
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
  ctx.batcher.add(key, geo, m);
  geo.dispose();
}

/** Iron / bark band around a log at a point along its axis. */
function logBand(ctx, key, ax, ay, az, bx, by, bz, t, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const dir = new THREE.Vector3(dx, dy, dz).divideScalar(len);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  const geo = torusGeo(r, 0.008, { radialSeg: 5, tubularSeg: 14, tile: 0.9 });
  const m = new THREE.Matrix4().compose(new THREE.Vector3(ax + dx * t, ay + dy * t, az + dz * t), q, new THREE.Vector3(1, 1, 1));
  ctx.batcher.add(key, geo, m);
  geo.dispose();
}

/**
 * Showcase campfire (model stage only): 24 weathered ring stones, pebble and ash
 * ground, a six-log teepee with charred bands and end grain, a glowing coal bed,
 * a lashing-bound cooking tripod, chain-hung pot and a split-log pile.
 */
function buildCampfireDetail(ctx, c) {
  const cx = c.x;
  const cz = c.z;

  // ------------------------------------------------------------- ash ground ---
  const ash = latheGeo([
    [0.66, 0], [0.6, 0.006], [0.48, 0.014], [0.34, 0.022], [0.18, 0.028], [0.0, 0.031],
  ], { segments: 28, tile: FIRE_TILE });
  put(ctx, 'stoneDark', ash, cx, 0, cz);
  // scorched ground: flat charred patches (stones lie flat, so no hard plate edges)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + hash01(i, 3) * 0.24;
    const R = 0.18 + hash01(i, 4) * 0.42;
    restingRock(ctx, i % 3 ? 'dark' : 'stoneDark', 0.09 + hash01(i, 5) * 0.12,
      { detail: 0, seed: i * 3 + 11, flatten: 0.05, tile: FIRE_TILE },
      cx + Math.cos(a) * R, 0.002, cz + Math.sin(a) * R, hash01(i, 6) * TAU, 0, 0, 0.9);
  }
  // pale ash drifts against the ring stones
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * TAU + 0.14;
    const R = 0.55 + hash01(i, 8) * 0.12;
    put(ctx, 'stoneDark', plateGeo(0.1 + hash01(i, 9) * 0.1, 0.012, 0.06 + hash01(i, 10) * 0.07, { bevel: 0.004, tile: FIRE_TILE }),
      cx + Math.cos(a) * R, 0.011, cz + Math.sin(a) * R, 0, Math.PI / 2 - a, 0);
  }

  // ------------------------------------------------------------ stone ring ---
  const ringCount = 24;
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * TAU + (hash01(i, 11) - 0.5) * 0.09;
    const R = 0.685 + (hash01(i, 12) - 0.5) * 0.03;
    const r = 0.14 + hash01(i, 13) * 0.065;
    restingRock(
      ctx, i % 6 === 0 ? 'stone' : 'stoneDark', r,
      { detail: 2, seed: i * 7 + 3, flatten: 0.66, tile: FIRE_TILE },
      cx + Math.cos(a) * R, 0, cz + Math.sin(a) * R,
      Math.PI / 2 - a + (hash01(i, 14) - 0.5) * 0.4,
      (hash01(i, 15) - 0.5) * 0.2, (hash01(i, 16) - 0.5) * 0.2, 0.86
    );
    // chips knocked off the ring stones
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? 0.14 : -0.2;
      restingRock(ctx, k === 0 ? 'stoneDark' : 'stone', 0.024 + hash01(i, 17 + k) * 0.026, { detail: 0, seed: i * 3 + 9 + k, flatten: 0.6, tile: FIRE_TILE },
        cx + Math.cos(a + side) * (R + r * 0.68), 0, cz + Math.sin(a + side) * (R + r * 0.68), hash01(i, 18 + k) * TAU, 0, 0, 0.9);
    }
  }

  // ------------------------------------------------------- pebbles + debris ---
  for (let i = 0; i < 48; i++) {
    const a = hash01(i, 21) * TAU;
    const R = 0.18 + hash01(i, 22) * 0.46;
    restingRock(ctx, i % 3 ? 'stone' : 'stoneDark', 0.018 + hash01(i, 23) * 0.026,
      { detail: 1, seed: i * 5 + 2, flatten: 0.6, tile: FIRE_TILE },
      cx + Math.cos(a) * R, 0.012, cz + Math.sin(a) * R, hash01(i, 24) * TAU);
  }
  for (let i = 0; i < 40; i++) {
    const a = hash01(i, 25) * TAU;
    const R = 0.12 + hash01(i, 26) * 0.55;
    restingRock(ctx, i % 4 ? 'stone' : 'stoneDark', 0.012 + hash01(i, 27) * 0.016,
      { detail: 0, seed: i * 3 + 5, flatten: 0.55, tile: FIRE_TILE },
      cx + Math.cos(a) * R, 0.01, cz + Math.sin(a) * R, hash01(i, 28) * TAU);
  }
  // charcoal / bark debris
  for (let i = 0; i < 20; i++) {
    const a = hash01(i, 29) * TAU;
    const R = 0.24 + hash01(i, 30) * 0.5;
    put(ctx, i % 3 === 0 ? 'dark' : 'woodDark', plateGeo(0.05 + hash01(i, 31) * 0.07, 0.012, 0.02 + hash01(i, 32) * 0.02, { bevel: 0.003, tile: 1.0 }),
      cx + Math.cos(a) * R, 0.013, cz + Math.sin(a) * R, 0, hash01(i, 33) * TAU, 0);
  }

  // ---------------------------------------------------------------- fire logs ---
  const logs = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.22;
    const footR = 0.4 + hash01(i, 41) * 0.09;
    const lift = 0.26 + hash01(i, 42) * 0.07;
    const fx = cx + Math.cos(a) * footR;
    const fz = cz + Math.sin(a) * footR;
    const tx = cx + Math.cos(a + 0.9) * 0.07;
    const tz = cz + Math.sin(a + 0.9) * 0.07;
    const rA = 0.072 + hash01(i, 43) * 0.022; // butt end
    const rB = rA * 0.82; // burning end
    const footY = groundRod(ctx, 'wood', fx, fz, tx, lift, tz, rA, rB, 12, 1.4);
    // charred bark bands, end grain discs and a glowing ember tip
    const dir = new THREE.Vector3(fx - tx, footY - lift, fz - tz).normalize();
    endDisc(ctx, 'woodDark', fx - dir.x * 0.008, footY - dir.y * 0.008, fz - dir.z * 0.008, dir, rA * 0.97, 10);
    endDisc(ctx, 'coals', tx, lift, tz, dir.clone().negate(), rB * 0.9, 8);
    logBand(ctx, 'woodDark', fx, footY, fz, tx, lift, tz, 0.34, rA * 1.02);
    logBand(ctx, 'woodDark', fx, footY, fz, tx, lift, tz, 0.68, rB * 1.05);
    logs.push([fx, fz, tx, tz]);
  }

  // ------------------------------------------------------------- coal bed ---
  const bed = sphereGeo(0.33, { segW: 12, segH: 9, tile: FIRE_TILE });
  ctx.batcher.add('coals', bed, matrixFor(cx, 0.138, cz, 0, 0, 0, 1, 0.4, 1));
  bed.dispose();
  for (let i = 0; i < 76; i++) {
    const a = hash01(i, 51) * TAU;
    const R = hash01(i, 52) ** 0.7 * 0.3;
    restingRock(ctx, 'coals', 0.018 + hash01(i, 53) * 0.03,
      { detail: 0, seed: i * 5 + 7, flatten: 0.7, tile: 1.0 },
      cx + Math.cos(a) * R, 0.132 + 0.13 * Math.sqrt(Math.max(0, 1 - (R / 0.33) ** 2)), cz + Math.sin(a) * R, hash01(i, 54) * TAU);
  }
  // charred sticks poking out of the coal bed
  for (let i = 0; i < 8; i++) {
    const a = hash01(i, 55) * TAU;
    const R = 0.1 + hash01(i, 56) * 0.18;
    taperedRod(ctx, 'dark', cx + Math.cos(a) * R, 0.1, cz + Math.sin(a) * R,
      cx + Math.cos(a + 0.5) * (R + 0.12), 0.16 + hash01(i, 57) * 0.08, cz + Math.sin(a + 0.5) * (R + 0.12),
      0.014, 0.008, 5, 0.8);
  }

  // --------------------------------------------------------- cooking tripod ---
  const legs = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    const footX = cx + Math.cos(a) * 0.66;
    const footZ = cz + Math.sin(a) * 0.66;
    rodBetween(ctx, 'metalDark', footX, 0.03, footZ, cx, FIRE_APEX_Y, cz, 0.032, 8);
    legs.push([footX, footZ, a]);
    // iron shoe at the foot of each leg
    put(ctx, 'rust', plateGeo(0.1, 0.026, 0.1, { bevel: 0.008, tile: 0.8 }), footX, 0.021, footZ, 0, Math.PI / 2 - a, 0);
  }
  // lashings binding the three legs together under the apex
  for (const yy of [FIRE_APEX_Y - 0.12, FIRE_APEX_Y - 0.08, FIRE_APEX_Y - 0.04]) {
    const wrap = torusGeo(0.052, 0.015, { radialSeg: 5, tubularSeg: 16, tile: 0.9 });
    put(ctx, 'wood', wrap, cx, yy, cz, Math.PI / 2, 0, 0);
  }
  // rope ends hanging off the lashing
  for (let i = 0; i < 2; i++) {
    const a = 1.2 + i * 2.1;
    const pts = [];
    for (let n = 0; n <= 4; n++) {
      const d = (n / 4) * 0.22;
      pts.push(new THREE.Vector3(
        cx + Math.cos(a + n * 0.06) * (0.06 + d * 0.06), FIRE_APEX_Y - 0.1 - d, cz + Math.sin(a + n * 0.06) * (0.06 + d * 0.06)
      ));
    }
    put(ctx, 'wood', tubeGeo(pts, 0.011, { tubularSeg: 8, radialSeg: 4, tile: 0.9 }), 0, 0, 0);
  }
  // mid-leg rope wraps
  for (const [fx, fz, a] of legs) {
    const mx = fx * 0.42 + cx * 0.58;
    const mz = fz * 0.42 + cz * 0.58;
    const my = FIRE_APEX_Y * 0.58;
    const wrap = torusGeo(0.038, 0.011, { radialSeg: 5, tubularSeg: 10, tile: 0.9 });
    put(ctx, 'wood', wrap, mx, my, mz, Math.PI / 2 - 0.55, Math.PI / 2 - a, 0);
  }
  const apexRing = torusGeo(0.08, 0.017, { radialSeg: 6, tubularSeg: 16, tile: 0.8 });
  put(ctx, 'metalDark', apexRing, cx, FIRE_APEX_Y, cz, Math.PI / 2, 0, 0);

  // ------------------------------------------------------- chain + campfire pot ---
  const bailTop = FIRE_POT_Y + 0.28;
  const linkCount = 7;
  for (let i = 0; i < linkCount; i++) {
    const t = i / (linkCount - 1);
    const yy = FIRE_APEX_Y - 0.03 - t * (FIRE_APEX_Y - 0.03 - bailTop);
    const link = torusGeo(0.024, 0.006, { radialSeg: 4, tubularSeg: 9, tile: 0.6 });
    put(ctx, 'metalDark', link, cx, yy, cz, i % 2 === 0 ? Math.PI / 2 : 0, 0, 0);
  }
  const potProfile = [
    [0.02, 0], [0.155, 0.004], [0.205, 0.03], [0.225, 0.09], [0.222, 0.16],
    [0.208, 0.215], [0.218, 0.24], [0.228, 0.258], [0.212, 0.278],
  ].map(([r, yy]) => [r, yy + FIRE_POT_Y - 0.14]);
  put(ctx, 'metal', latheGeo(potProfile, { segments: 22, tile: 0.9 }), cx, 0, cz);
  // rim, rivets and bail
  put(ctx, 'metal', torusGeo(0.216, 0.011, { radialSeg: 5, tubularSeg: 16, tile: 0.7 }), cx, FIRE_POT_Y + 0.135, cz, Math.PI / 2, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.2;
    const bolt = boltGeo(0.014, 0.011, { tile: 0.5 });
    put(ctx, 'rust', bolt, cx + Math.cos(a) * 0.228, FIRE_POT_Y + 0.02, cz + Math.sin(a) * 0.228, Math.PI / 2, a, 0);
  }
  const bailPts = [];
  for (let n = 0; n <= 8; n++) {
    const ang = Math.PI * (n / 8);
    bailPts.push(new THREE.Vector3(cx - Math.cos(ang) * 0.19, FIRE_POT_Y + 0.135 + Math.sin(ang) * 0.15, cz));
  }
  put(ctx, 'metalDark', tubeGeo(bailPts, 0.012, { tubularSeg: 18, radialSeg: 4, tile: 0.7 }), 0, 0, 0);
  for (const s of [-1, 1]) {
    put(ctx, 'metalDark', plateGeo(0.03, 0.05, 0.02, { bevel: 0.006, tile: 0.5 }), cx + s * 0.19, FIRE_POT_Y + 0.14, cz, 0, 0, 0);
  }
  // ladle hanging off the bail
  taperedRod(ctx, 'metalDark', cx + 0.12, FIRE_POT_Y + 0.29, cz + 0.02, cx + 0.16, FIRE_POT_Y + 0.05, cz + 0.06, 0.009, 0.007, 5, 0.6);
  put(ctx, 'metalDark', latheGeo([
    [0.001, 0], [0.032, 0.004], [0.043, 0.022], [0.038, 0.04], [0.001, 0.045],
  ], { segments: 12, tile: 0.5 }), cx + 0.165, FIRE_POT_Y - 0.06, cz + 0.06, Math.PI, 0, 0);

  // ------------------------------------------------------- split-log woodpile ---
  const pileA = 2.5;
  const pileR = 0.77;
  const pileX = cx + Math.cos(pileA) * pileR;
  const pileZ = cz + Math.sin(pileA) * pileR;
  const tang = new THREE.Vector3(-Math.sin(pileA), 0, Math.cos(pileA));
  const rad = new THREE.Vector3(Math.cos(pileA), 0, Math.sin(pileA));
  for (let i = 0; i < 11; i++) {
    const layer = i < 4 ? 0 : i < 7 ? 1 : 2;
    const idx = layer === 0 ? i : layer === 1 ? i - 4 : i - 7;
    const across = (layer === 0 ? idx - 1.5 : idx - 1) * 0.075 + (hash01(i, 61) - 0.5) * 0.02;
    const yy = 0.062 + layer * 0.095 + hash01(i, 62) * 0.008;
    const len = 0.42 + hash01(i, 63) * 0.16;
    const dirSign = hash01(i, 64) > 0.5 ? 1 : -1;
    const ax = pileX + rad.x * across - tang.x * (len / 2) * dirSign;
    const az = pileZ + rad.z * across - tang.z * (len / 2) * dirSign;
    const bx = pileX + rad.x * across + tang.x * (len / 2) * dirSign;
    const bz = pileZ + rad.z * across + tang.z * (len / 2) * dirSign;
    const rr = 0.042 + hash01(i, 65) * 0.016;
    taperedRod(ctx, 'wood', ax, yy, az, bx, yy, bz, rr, rr * 0.95, 8, 1.4);
    endDisc(ctx, 'woodDark', ax, yy, az, tang.clone().multiplyScalar(-dirSign), rr * 0.96, 8);
    endDisc(ctx, 'woodDark', bx, yy, bz, tang.clone().multiplyScalar(dirSign), rr * 0.95, 8);
    // split face
    put(ctx, 'woodDark', plateGeo(len * 0.86, 0.016, rr * 1.1, { bevel: 0.004, tile: 1.2 }),
      pileX + rad.x * across, yy + rr * 0.55, pileZ + rad.z * across, 0, pileA, 0);
  }
  // poker leant on the ring stones
  groundRod(ctx, 'metalDark', cx + 0.78, cz - 0.36, cx + 0.26, 0.62, cz - 0.12, 0.012, 0.009, 5, 0.7);
  put(ctx, 'metalDark', torusGeo(0.035, 0.009, { radialSeg: 4, tubularSeg: 9, tile: 0.5 }), cx + 0.79, 0.05, cz - 0.36, 0.4, 0.6, 0);

  ctx.req.lights.push({ x: c.x, y: 0.8, z: c.z, color: 0xff7a2f, intensity: 6.5, distance: 7.5, kind: 'fire' });
  ctx.req.lanterns.push({ x: c.x, y: 0.5, z: c.z, kind: 'fire', size: 0.5 });
  ctx.req.smoke.push({ x: c.x, y: 0.7, z: c.z, spread: 0.6, rate: 0.5, count: 24, rise: 2.6, color: 0x6a5a48, scale: 0.9 });
}

/**
 * Map LOD campfire (in-game, `ctx.stage` undefined): same silhouette — stone ring,
 * log teepee, coal bed, tripod + chain-hung pot and the split-log pile — at a few
 * thousand triangles for the single courtyard instance.
 */
function buildCampfireLod(ctx, c) {
  const cx = c.x;
  const cz = c.z;

  // ash bed
  put(ctx, 'stoneDark', latheGeo([
    [0.6, 0], [0.5, 0.008], [0.32, 0.018], [0.0, 0.024],
  ], { segments: 16, tile: FIRE_TILE }), cx, 0, cz);
  // stone ring
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + (hash01(i, 11) - 0.5) * 0.12;
    const R = FIRE_RING_R + (hash01(i, 12) - 0.5) * 0.04;
    const r = 0.145 + hash01(i, 13) * 0.065;
    restingRock(ctx, i % 4 === 0 ? 'stone' : 'stoneDark', r, { detail: 1, seed: i * 7 + 3, flatten: 0.66, tile: FIRE_TILE },
      cx + Math.cos(a) * R, 0, cz + Math.sin(a) * R, Math.PI / 2 - a, (hash01(i, 15) - 0.5) * 0.2, (hash01(i, 16) - 0.5) * 0.2, 0.88);
  }
  // pebbles
  for (let i = 0; i < 22; i++) {
    const a = hash01(i, 21) * TAU;
    const R = 0.18 + hash01(i, 22) * 0.44;
    restingRock(ctx, i % 3 ? 'stone' : 'stoneDark', 0.016 + hash01(i, 23) * 0.024,
      { detail: 0, seed: i * 5 + 2, flatten: 0.6, tile: FIRE_TILE },
      cx + Math.cos(a) * R, 0.012, cz + Math.sin(a) * R, hash01(i, 24) * TAU);
  }
  // log teepee
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.22;
    const footR = 0.4 + hash01(i, 41) * 0.09;
    groundRod(ctx, 'wood', cx + Math.cos(a) * footR, cz + Math.sin(a) * footR,
      cx + Math.cos(a + 0.9) * 0.07, 0.26 + hash01(i, 42) * 0.07, cz + Math.sin(a + 0.9) * 0.07,
      0.075, 0.062, 7, 1.4);
  }
  // coal bed + lumps
  const bed = sphereGeo(0.33, { segW: 8, segH: 6, tile: FIRE_TILE });
  ctx.batcher.add('coals', bed, matrixFor(cx, 0.138, cz, 0, 0, 0, 1, 0.4, 1));
  bed.dispose();
  for (let i = 0; i < 16; i++) {
    const a = hash01(i, 51) * TAU;
    const R = hash01(i, 52) ** 0.7 * 0.28;
    restingRock(ctx, 'coals', 0.018 + hash01(i, 53) * 0.026, { detail: 0, seed: i * 5 + 7, flatten: 0.7, tile: 1.0 },
      cx + Math.cos(a) * R, 0.132 + 0.13 * Math.sqrt(Math.max(0, 1 - (R / 0.33) ** 2)), cz + Math.sin(a) * R, hash01(i, 54) * TAU);
  }
  // cooking tripod
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    rodBetween(ctx, 'metalDark', cx + Math.cos(a) * 0.66, 0.03, cz + Math.sin(a) * 0.66, cx, FIRE_APEX_Y, cz, 0.032, 5);
  }
  const apexRing = torusGeo(0.08, 0.017, { radialSeg: 4, tubularSeg: 10, tile: 0.8 });
  put(ctx, 'metalDark', apexRing, cx, FIRE_APEX_Y, cz, Math.PI / 2, 0, 0);
  for (let i = 0; i < 4; i++) {
    const yy = FIRE_APEX_Y - 0.1 + i * 0.035;
    const link = torusGeo(0.022, 0.005, { radialSeg: 3, tubularSeg: 7, tile: 0.6 });
    put(ctx, 'metalDark', link, cx, yy, cz, i % 2 === 0 ? Math.PI / 2 : 0, 0, 0);
  }
  // pot + bail
  put(ctx, 'metal', cylGeo(0.222, 0.18, 0.28, { radial: 10, tile: 0.9 }), cx, FIRE_POT_Y, cz);
  const bailPts = [];
  for (let n = 0; n <= 5; n++) {
    const ang = Math.PI * (n / 5);
    bailPts.push(new THREE.Vector3(cx - Math.cos(ang) * 0.19, FIRE_POT_Y + 0.135 + Math.sin(ang) * 0.15, cz));
  }
  put(ctx, 'metalDark', tubeGeo(bailPts, 0.012, { tubularSeg: 10, radialSeg: 4, tile: 0.7 }), 0, 0, 0);
  // split-log pile
  const pileA = 2.5;
  const pileX = cx + Math.cos(pileA) * 0.77;
  const pileZ = cz + Math.sin(pileA) * 0.77;
  const tang = new THREE.Vector3(-Math.sin(pileA), 0, Math.cos(pileA));
  const rad = new THREE.Vector3(Math.cos(pileA), 0, Math.sin(pileA));
  for (let i = 0; i < 5; i++) {
    const across = (i - 2) * 0.08;
    const yy = 0.055 + (i > 2 ? 0.088 : 0);
    const len = 0.44;
    const ax = pileX + rad.x * across - tang.x * (len / 2);
    const az = pileZ + rad.z * across - tang.z * (len / 2);
    taperedRod(ctx, 'wood', ax, yy, az, ax + tang.x * len, yy, az + tang.z * len, 0.05, 0.048, 6, 1.4);
  }
}

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const c = ctx.data.layout.hero.campfire;
  if (isPreview(ctx)) buildCampfireDetail(ctx, c);
  else buildCampfireLod(ctx, c);
}
