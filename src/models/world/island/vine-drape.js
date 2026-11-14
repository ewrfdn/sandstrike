/**
 * VINE DRAPE — F7 (see ISLAND_ASSETS.md §2.1).
 *
 * A curtain of lianas hanging from the edge of the canopy, rebuilt with 2 seeded
 * variants: a broken host branch whose torn ends disappear into the crown, a swollen
 * knot where the creepers gather, five lianas of different weight and curl (one thick
 * creeper that drops to the jungle floor and roots into the litter), a beard of aerial
 * roots, and leaf cards taken from the canopy cluster atlas (`lib.canopy`: 'spray' /
 * 'sprig' / 'dry') so the foliage matches the trees it hangs from.
 *
 * Rendering contract (2 draw calls per variant):
 *   wood   -> M.barkTrop (vertex colour = baked AO + moss tint)
 *   leaves -> M.vegLeaf  (vertex colour r=AO g=flex b=hue, wind + backlit translucency)
 * Both use the same accumulators as `./tree/`, so the map draw-call count does not grow.
 *
 * Rules: metres, +Y up, front -Z, base within ±0.05 m of the ground, deterministic
 * fixed-seed builds.
 */
import * as THREE from 'three';
import { makeInstanced } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { isPreview } from '../detail.js';
import { canopyCellUV } from './leaf-atlas.js';
import { BarkAccum, LeafAccum } from './tree/meshers.js';
import { range, randUnit, fbm3 } from './tree/rng-noise.js';

export const meta = { id: 'vine-drape', kind: 'world', group: 'flora', label: '藤蔓垂帘 · VINE DRAPE' };

/** Preview builder (stage/WebUI): one hero drape on a sample layout. */
export function build(ctx) {
  // ry 0: the stage reports an axis-aligned extent; a yaw-rotated drape would read wider.
  island(ctx).vineDrapes = [{ x: 0, z: 0, ry: 0, s: 1 }];
  buildVineDrapes(ctx, true);
}

/** Map assembly builder: instances every drape from ctx.data.layout. */
export function buildWorld(ctx) {
  buildVineDrapes(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

/** Drape envelope: 1.6 x 4.5 x 1.6 m (ISLAND_ASSETS §2.1); every leaf tip stays inside. */
const MAX_R = 0.75;
const MAX_Y = 4.3;

const RECT = {
  sprig: canopyCellUV('sprig', 0.035),
  spray: canopyCellUV('spray', 0.035),
  pale: canopyCellUV('pale', 0.035),
  dry: canopyCellUV('dry', 0.035),
};

// ---------------------------------------------------------------------------
// variants
// ---------------------------------------------------------------------------

/**
 * Two drapes: A is the heavy curtain (thick rooted creeper, dense top), B is a
 * lighter, wirier one with more aerial roots and a wider spread.
 */
const VINE_VARIANTS = [
  {
    id: 'vine-a',
    seed: 0x71c3,
    spread: 1,
    strands: 6,
    topLeaves: 54,
    strandLeaves: 13,
    roots: 11,
    bigR: 0.08,
    topY: 4.24,
    reachGround: [0, 2],
    hue: [0.32, 0.72],
  },
  {
    id: 'vine-b',
    seed: 0x2b95,
    spread: 1.16,
    strands: 7,
    topLeaves: 44,
    strandLeaves: 11,
    roots: 15,
    bigR: 0.062,
    topY: 4.16,
    reachGround: [1, 4],
    hue: [0.5, 0.92],
  },
];

// ---------------------------------------------------------------------------
// wood colour
// ---------------------------------------------------------------------------

function woodColor(seed) {
  return (p, pd, n, out) => {
    // under the canopy: darker high up, lighter near the light gap at the floor
    let ao = 0.86 + 0.24 * (1 - Math.min(1, p.y / 4.4));
    if (n.y < -0.25) ao *= 0.92;
    const m = fbm3(p.x, p.y, p.z, seed, 1.2);
    const moss = Math.max(0, n.y) * 0.5 * (0.4 + 0.6 * m);
    out[0] = ao * (1 - moss * 0.3);
    out[1] = ao * (1 - moss * 0.02);
    out[2] = ao * (1 - moss * 0.45);
  };
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

/** Polyline through `points` but with deterministic perpendicular sway. */
function swayed(points, amp, seed) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i].clone();
    const f = i / Math.max(1, points.length - 1);
    p.x += Math.sin(i * 1.7 + seed) * amp * f * (1 - f) * 2;
    p.z += Math.cos(i * 2.3 + seed * 1.3) * amp * f * (1 - f) * 2;
    out.push(p);
  }
  return out;
}

/** Broken end cap: a short jagged disc that reads as a snapped branch. */
function brokenEnd(wood, point, dir, radius, rng) {
  const d = dir.clone().normalize();
  const side = new THREE.Vector3(-d.z, 0, d.x).normalize();
  const n = new THREE.Vector3().crossVectors(d, side).normalize();
  // the torn face is a tiny fan of dark splinters rather than a clean disc
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + rng() * 0.5;
    const len = 0.06 + rng() * 0.07;
    const tip = point.clone()
      .addScaledVector(d, 0.03 + rng() * 0.03)
      .addScaledVector(side, Math.cos(a) * radius * 0.8)
      .addScaledVector(n, Math.sin(a) * radius * 0.8);
    const pts = [point.clone().addScaledVector(side, Math.cos(a) * radius * 0.5), tip];
    wood.addTube(pts, (t) => radius * 0.36 * (1 - t * 0.7) + 0.004, { radial: 3, tile: 0.9 });
    void len;
  }
}

// ---------------------------------------------------------------------------
// one drape variant
// ---------------------------------------------------------------------------

function drapeGeometry(hi, variant) {
  const rng = makeRNG(variant.seed);
  const wood = new BarkAccum(woodColor(variant.seed & 0xff));
  const leaves = new LeafAccum();
  const cols = variant.hue;
  const spread = variant.spread;
  const topY = variant.topY;

  // ---------------------------------------------------------------- host limb
  // A piece of the host tree: mostly horizontal, sagging, with both ends snapped off
  // (the crown of the tree covers them on the map).
  const hostPts = [];
  const hostSpan = 1.22 * spread;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    hostPts.push(new THREE.Vector3(
      -hostSpan * 0.5 + hostSpan * t,
      topY + Math.sin(t * Math.PI) * 0.1 - 0.06 * t + Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.14 + (rng() - 0.5) * 0.02,
      (rng() - 0.5) * 0.07
    ));
  }
  wood.addTube(hostPts, (t) => (0.115 - 0.06 * Math.abs(t - 0.5) * 2) * (0.92 + 0.12 * Math.sin(t * 7)), {
    radial: hi ? 7 : 5,
    tile: 1.2,
  });
  brokenEnd(wood, hostPts[0], new THREE.Vector3(-1, -0.12, 0), 0.105, rng);
  brokenEnd(wood, hostPts[hostPts.length - 1], new THREE.Vector3(1, -0.08, 0), 0.1, rng);
  // a couple of dead host twigs sticking out of the crown rim
  for (let i = 0; i < 2; i++) {
    const t = 0.28 + i * 0.4;
    const idx = Math.round(t * 8);
    const p = hostPts[idx];
    const tw = [];
    for (let k = 0; k <= 3; k++) {
      tw.push(new THREE.Vector3(
        p.x + Math.cos(2.1 + i) * 0.12 * k,
        p.y + 0.07 * k - 0.04 * k * k,
        p.z + Math.sin(2.1 + i) * 0.12 * k
      ));
    }
    wood.addTube(tw, (t2) => 0.03 * (1 - t2 * 0.8), { radial: 3, tile: 0.9 });
  }

  // ------------------------------------------------------------- anchor knot
  const knot = new THREE.Vector3(0, topY - 0.12, 0);
  wood.addRock(knot, 0.17 * spread, { seed: 77, flatten: 0.7, tile: 1.1, detail: 1 });

  // ----------------------------------------------------------------- lianas
  const strands = [];
  const strandCount = hi ? variant.strands : Math.max(3, variant.strands - 1);
  let groundCount = 0;
  for (let i = 0; i < strandCount; i++) {
    const big = i === 0;
    const target = i % 3;
    const toGround = big || variant.reachGround.includes(i) || groundCount < 1;
    if (toGround) groundCount++;
    const length = toGround ? topY - 0.05 : (1.5 + rng() * 1.7) * spread;
    const r0 = big ? variant.bigR : 0.045 + rng() * 0.028;
    const az = (i / strandCount) * TAU + rng() * 0.9;
    const rootX = Math.cos(az) * (0.1 + rng() * 0.26) * spread;
    const rootZ = Math.sin(az) * (0.1 + rng() * 0.26) * spread;
    const pts = [knot.clone()];
    const steps = hi ? 15 : 10;
    const ph = rng() * TAU;
    const twist = 0.55 + rng() * 0.9;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const y = knot.y - length * t;
      // the creep hangs, sways sideways and slowly spirals: two harmonics keep it from
      // reading as a straight pole
      const sway = Math.sin(t * 4.2 + ph) * 0.16 + Math.sin(t * 9.1 + ph * 1.7) * 0.05;
      const sp = Math.cos(t * 5.4 + ph + twist) * 0.13;
      pts.push(new THREE.Vector3(
        rootX * Math.pow(t, 0.78) + sway,
        y,
        rootZ * Math.pow(t, 0.78) + sp
      ));
    }
    const p = pts[pts.length - 1];
    if (toGround) p.y = 0.03;
    const rads = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      // thicker at the crown, a few mid-span bulges, thin tip
      const bulge = 1 + 0.28 * Math.sin(t * 5.3 + i * 2.1) * (1 - t * 0.5);
      rads.push(Math.max(0.008, r0 * bulge * (1 - t * 0.55) * (toGround ? 1 : 1 - t * 0.35)));
    }
    wood.addTube(pts, (t) => rads[Math.min(rads.length - 1, Math.round(t * (rads.length - 1)))], {
      radial: hi ? 5 : 4,
      tile: 1.0,
    });
    strands.push({ pts, rads, az, target });

    // aerial roots: thin fibres dropping off the liana
    if (hi) {
      const rootCount = Math.max(1, Math.round(variant.roots / strandCount));
      for (let r = 0; r < rootCount; r++) {
        const k = 2 + Math.floor(rng() * (steps - 4));
        const base = pts[k];
        const len = 0.25 + rng() * 0.75;
        const root = [];
        for (let q = 0; q <= 3; q++) {
          root.push(new THREE.Vector3(
            base.x + (rng() - 0.5) * 0.05 * q,
            base.y - (len * q) / 3,
            base.z + (rng() - 0.5) * 0.05 * q
          ));
        }
        wood.addTube(root, (t) => 0.009 * (1 - t * 0.5), { radial: 3, tile: 0.8 });
      }
    }

    // root fan where the creeper lands
    if (toGround) {
      for (let q = 0; q < 5; q++) {
        const a = (q / 5) * TAU + rng() * 0.7;
        const rr = 0.16 + rng() * 0.22;
        const root = [
          new THREE.Vector3(p.x, 0.045, p.z),
          new THREE.Vector3(p.x + Math.cos(a) * rr * 0.55, 0.02, p.z + Math.sin(a) * rr * 0.55),
          new THREE.Vector3(p.x + Math.cos(a) * rr, 0.008, p.z + Math.sin(a) * rr),
        ];
        wood.addTube(root, 0.014, { radial: 3, tile: 0.9 });
      }
    }
  }

  // ----------------------------------------------------------------- leaves
  // Top: a canopy cluster around the host branch so the drape grows out of the tree.
  const topLeaves = hi ? variant.topLeaves : Math.round(variant.topLeaves * 0.75);
  for (let i = 0; i < topLeaves; i++) {
    const t = rng();
    const p = hostPts[Math.floor(rng() * hostPts.length)].clone();
    p.x += (rng() - 0.5) * 0.95 * spread;
    p.y += 0.04 + rng() * 0.34;
    p.z += (rng() - 0.5) * 0.8;
    randUnit(rng, _tip);
    _tip.y += 0.2;
    _tip.normalize();
    _face.set((rng() - 0.5) * 1.4, 0.8 + rng() * 0.6, (rng() - 0.5) * 1.4).normalize();
    addCard(leaves, rng, p, _tip, _face, rng() < 0.5 ? 'sprig' : rng() < 0.85 ? 'spray' : 'pale', {
      size: 0.55 + rng() * 0.42,
      ao: 0.62 + rng() * 0.3,
      flex: 0.82 + rng() * 0.18,
      hue: cols[0] + rng() * (cols[1] - cols[0]),
      droop: 0.2,
    });
  }
  // Strand leaves: sparse, hanging with the creepers.
  const perStrand = hi ? variant.strandLeaves : Math.max(5, Math.round(variant.strandLeaves * 0.78));
  for (const s of strands) {
    for (let i = 0; i < perStrand; i++) {
      const k = 1 + Math.floor(rng() * (s.pts.length - 2));
      const p = s.pts[k].clone();
      p.x += (rng() - 0.5) * 0.2;
      p.z += (rng() - 0.5) * 0.2;
      const f = k / (s.pts.length - 1); // 0 at the crown, 1 at the tip
      _tip.set((rng() - 0.5) * 0.8, -0.8 - rng() * 0.4, (rng() - 0.5) * 0.8).normalize();
      _face.set((rng() - 0.5) * 1.2, 0.4 + rng() * 0.5, (rng() - 0.5) * 1.2).normalize();
      const dry = rng() < 0.1;
      addCard(leaves, rng, p, _tip, _face, dry ? 'dry' : rng() < 0.55 ? 'spray' : 'sprig', {
        size: 0.34 + rng() * 0.24,
        ao: clamp01(0.78 - f * 0.3) + rng() * 0.08,
        // tips swing the most: flex from how far down the strand the leaf sits
        flex: clamp01(0.45 + f * 0.55),
        hue: cols[0] + rng() * (cols[1] - cols[0]),
        droop: 0.42,
      });
    }
  }
  // A small leaf tuft at the tip of each short strand.
  for (const s of strands) {
    if (s.rads[0] > 0.05) continue;
    const p = s.pts[s.pts.length - 1].clone();
    for (let i = 0; i < 3; i++) {
      randUnit(rng, _tip);
      _tip.y -= 0.6;
      _tip.normalize();
      _face.set((rng() - 0.5) * 1.4, 0.6 + rng() * 0.5, (rng() - 0.5) * 1.4).normalize();
      addCard(leaves, rng, p, _tip, _face, i === 0 ? 'dry' : 'spray', {
        size: 0.4,
        ao: 0.55,
        flex: 0.98,
        hue: cols[0] + rng() * (cols[1] - cols[0]),
        droop: 0.5,
      });
    }
  }

  // ------------------------------------------------------------- finalise
  const woodGeo = wood.build('vine-wood');
  const leafGeo = leaves.build('vine-leaves');
  let minY = Infinity;
  for (const geo of [woodGeo, leafGeo]) {
    const pos = geo.attributes.position;
    for (let i = 1; i < pos.array.length; i += 3) if (pos.array[i] < minY) minY = pos.array[i];
  }
  if (Number.isFinite(minY)) {
    const dy = -0.01 - minY;
    woodGeo.translate(0, dy, 0);
    leafGeo.translate(0, dy, 0);
    woodGeo.computeBoundingBox();
    woodGeo.computeBoundingSphere();
    leafGeo.computeBoundingBox();
    leafGeo.computeBoundingSphere();
  }
  return { wood: woodGeo, leaves: leafGeo };
}

const _tip = new THREE.Vector3();
const _face = new THREE.Vector3();
const _Z = new THREE.Vector3();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _center = new THREE.Vector3();

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Place one 2-triangle card (same convention as the tree mesher), inside the documented envelope. */
function addCard(acc, rng, base, tipHint, faceHint, cell, { size, ao, flex, hue, droop }) {
  if (base.y > MAX_Y) return false;
  _Z.copy(faceHint).normalize();
  _X.copy(tipHint);
  _X.addScaledVector(_Z, -_X.dot(_Z));
  _X.y -= droop;
  if (_X.lengthSq() < 1e-8) _X.set(0, -1, 0);
  _X.normalize();
  _Y.crossVectors(_Z, _X).normalize();
  // nothing may dive into the litter: a single card below y=0 would lift the whole
  // instance when the model is re-grounded (and float the root fan)
  if (base.y < 0.34 && _X.y < -0.06) return false;
  let w = size;
  // keep every leaf tip inside the 1.6 x 4.5 m drape footprint (ISLAND_ASSETS §2.1)
  const a2 = _X.x * _X.x + _X.z * _X.z;
  if (a2 > 1e-5) {
    const b2 = base.x * _X.x + base.z * _X.z;
    const c2 = base.x * base.x + base.z * base.z - MAX_R * MAX_R;
    const disc = b2 * b2 - a2 * c2;
    if (disc <= 0) return false;
    const root = (-b2 + Math.sqrt(disc)) / a2;
    if (root <= 0.15) return false;
    w = Math.min(w, root);
  }
  if (_X.y > 1e-4) w = Math.min(w, (MAX_Y - base.y) / _X.y);
  if (w < 0.2) return false;
  const h = w * 0.78;
  _center.copy(base).addScaledVector(_X, w * 0.32);
  acc.card(_center, _X, _Y, _Z, w, h, RECT[cell], clamp01(ao), clamp01(flex), clamp01(hue), {
    bow: (rng() - 0.5) * w * 0.1,
  });
  return true;
}

// ---------------------------------------------------------------------------
// instancing
// ---------------------------------------------------------------------------

function buildVineDrapes(ctx, preview) {
  const items = (island(ctx).vineDrapes || []).map((d) => ({
    x: d.x,
    z: d.z,
    y: d.y ?? 0,
    ry: d.ry ?? 0,
    s: d.s ?? 1,
  }));
  if (!items.length) return;
  const M = ctx.materials;
  const stage = preview || isPreview(ctx);
  const quality = ctx.quality || 'high';
  const variantCount = stage ? 1 : quality === 'lowest' ? 1 : 2;

  for (let v = 0; v < variantCount; v++) {
    const variant = VINE_VARIANTS[v % VINE_VARIANTS.length];
    const geo = drapeGeometry(!!stage, variant);
    const bucket = [];
    for (let i = v; i < items.length; i += variantCount) bucket.push(items[i]);
    if (!bucket.length) continue;
    const name = `vine-drape-${v}`;
    makeInstanced(ctx, geo.wood, M.barkTropLight || M.barkTrop, bucket, `${name}-wood`, 'wood', { seed: 91 + v * 13, castShadow: true });
    // lowest tier: no leaf shadow map (same policy as the jungle trees)
    makeInstanced(ctx, geo.leaves, M.vegLeaf, bucket, `${name}-leaves`, 'fabric', { seed: 191 + v * 29, castShadow: quality !== 'lowest' });
  }
}
