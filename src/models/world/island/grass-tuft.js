/**
 * GRASS TUFT — F9 (P1, see ISLAND_ASSETS.md §2.1).
 *
 * A dense clump of rainforest ground grass. The first pass warped 72 single-leaf atlas
 * cards into thin blades, which read as a pale "paper fan" (the painted leaf was being
 * squeezed into a ribbon). This pass uses the dedicated ground-cover atlas
 * (`lib.grassBlade`, one card = 15-24 tapered blades fanned out of one root):
 *
 *   - INNER layer: 22-34 `tuft` cards, 0.32-0.58 m, crossed yaws, roots sunk 2 cm;
 *   - MID layer:   taller `tuftTall` cards (0.6-0.95 m), slightly leaned;
 *   - OUTER layer: `tuftDry` straw cards pressed against the outside rim;
 *   - ground transition: `cover` cards (low moss + round leaves) at the foot;
 *   - a few old single-blade cards and two broadleaf weeds for 1-2 m foreground detail;
 *   - seed stalks rebuilt as CROSSED ribbons (a flat ribbon vanished edge-on) with
 *     smaller, darker seed heads (the old bright ellipses read as floating beads).
 *
 * Rules honoured here: metres, +Y up, front is -Z, base sits on the soil; all cards
 * sample the shared atlases; all randomness comes from one fixed-seed `makeRNG()`;
 * the stage build is one hero tuft, the map build reads `layout.island.grassTufts`.
 */
import * as THREE from 'three';
import {
  makeInstanced,
  matrixFor,
  transformed,
  mergeGeometries,
  bakeVertexAO,
  TAU,
} from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { sphereGeo } from '../detail.js';
import { leafCellUV, grassQuad } from './leaf-atlas.js';

export const meta = { id: 'grass-tuft', kind: 'world', group: 'flora', label: '雨林草簇 · GRASS TUFT' };

/** Preview builder (stage/WebUI): one-item sample layout + hero tuft. */
export function build(ctx) {
  island(ctx).grassTufts = [{ x: 0, z: 0, ry: 0.3, s: 1 }];
  buildGrassTufts(ctx, true);
}

/** Map assembly builder: instantiates every tuft from ctx.data.layout. */
export function buildWorld(ctx) {
  buildGrassTufts(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

// ---------------------------------------------------------------------------
// local geometry helpers (self-contained model file — see the bucket contract)
// ---------------------------------------------------------------------------

function push(list, geo, matrix) {
  list.push(transformed(geo, matrix));
  geo.dispose();
}

function merge(list) {
  const merged = mergeGeometries(list);
  for (const g of list) g.dispose();
  return merged;
}

/** Point + frame on an arched centre line at normalised distance t. */
function archFrame(len, th0, k, t) {
  const a = th0 - k * t;
  const sag = len / k;
  return {
    x: sag * (Math.sin(th0) - Math.sin(a)),
    y: sag * (Math.cos(a) - Math.cos(th0)),
    a,
  };
}

/** Re-map a wrapped geometry to planar world XZ UVs (mud no longer reads as stripes). */
function planarUV(geo, tile = 0.9) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
  uv.needsUpdate = true;
  return geo;
}

/** Card-count multiplier per quality tier (topology stays identical). */
function cardScale(ctx) {
  const q = ctx.quality || 'high';
  if (q === 'lowest') return 0.55;
  if (q === 'low') return 0.75;
  return 1;
}

/**
 * One ground-cover card standing on its root. `grassQuad` puts the root on y=0, so the
 * card is pushed 2 cm into the soil: that is what stops the row of card bases from
 * reading as floating paper. `tilt` leans the whole card outwards.
 */
function standCard(parts, rng, x, z, yaw, { w, h, cell, tilt = 0, sink = 0.02, bend = 0.02 }) {
  push(parts.blade, grassQuad(w, h, cell, { bend, lean: tilt * h }), matrixFor(x, -sink, z, tilt, yaw, 0));
}

/**
 * Grass blade: a narrow tapered strip sampling an atlas cell. Kept for the few
 * foreground blades that need the old spiky silhouette.
 */
function bladeCard(len, width, cell, { th0 = 1.2, k = 0.6, segs = 4, cols = 2, baseW = 0.6 } = {}) {
  const { u0, v0, u1, v1 } = leafCellUV(cell, 0.02);
  const vcount = (segs + 1) * cols;
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const uv = new Float32Array(vcount * 2);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const f = archFrame(len, th0, k, t);
    const sa = Math.sin(f.a);
    const ca = Math.cos(f.a);
    const nx = -sa;
    const ny = ca;
    const halfW = (width * 0.5) * (baseW + (1 - baseW) * Math.min(1, t / 0.2)) * Math.pow(1 - t, 0.6);
    for (let j = 0; j < cols; j++) {
      const u = cols > 1 ? j / (cols - 1) - 0.5 : 0;
      const vi = i * cols + j;
      pos[vi * 3] = f.x;
      pos[vi * 3 + 1] = f.y;
      pos[vi * 3 + 2] = halfW * 2 * u;
      nor[vi * 3] = nx;
      nor[vi * 3 + 1] = ny;
      nor[vi * 3 + 2] = 0;
      uv[vi * 2] = u0 + (u1 - u0) * t;
      uv[vi * 2 + 1] = v0 + (v1 - v0) * (cols > 1 ? j / (cols - 1) : 0.5);
    }
  }
  const index = [];
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a0 = i * cols + j;
      const b0 = a0 + cols;
      index.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/**
 * Opaque straw blade for the dead litter at the tuft foot (thatch material), built as
 * TWO perpendicular ribbons — a single flat ribbon is invisible edge-on, which is why
 * the old seed stalks looked like floating heads.
 */
function strawStalk(len, width, { th0 = 0.4, k = 1.0, segs = 4 } = {}) {
  const list = [];
  for (let c = 0; c < 2; c++) {
    const pos = [];
    const nor = [];
    const uv = [];
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const f0 = archFrame(len, th0, k, t0);
      const f1 = archFrame(len, th0, k, t1);
      const w0 = (width * 0.5) * (1 - t0);
      const w1 = (width * 0.5) * (1 - t1);
      const n0 = [-Math.sin(f0.a), Math.cos(f0.a), 0];
      const n1 = [-Math.sin(f1.a), Math.cos(f1.a), 0];
      // second ribbon is rotated 90 degrees about the stalk axis (its width is along Y
      // of the first, i.e. the quad's "flat" plane is vertical instead of horizontal)
      const off = (v, n, w) => (c === 0
        ? [v[0], v[1], n[2] !== 0 ? w : 0]
        : [v[0], v[1], 0]);
      const quad = c === 0
        ? [
            [f0.x, f0.y, -w0], [f0.x, f0.y, w0], [f1.x, f1.y, -w1],
            [f1.x, f1.y, -w1], [f0.x, f0.y, w0], [f1.x, f1.y, w1],
          ]
        : [
            [f0.x, f0.y - w0, 0], [f0.x, f0.y + w0, 0], [f1.x, f1.y - w1, 0],
            [f1.x, f1.y - w1, 0], [f0.x, f0.y + w0, 0], [f1.x, f1.y + w1, 0],
          ];
      for (let q = 0; q < 6; q++) {
        const v = quad[q];
        pos.push(v[0], v[1], v[2]);
        const n = q < 3 ? n0 : n1;
        nor.push(n[0], n[1], c === 0 ? 0 : 1);
        uv.push(q === 1 || q === 2 || q === 4 || q === 5 ? 1 : 0, q < 3 ? t0 * 2 : t1 * 2);
      }
      void off;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    list.push(geo);
  }
  return mergeGeometries(list);
}

// ---------------------------------------------------------------------------
// tuft builder
// ---------------------------------------------------------------------------

/** The three crossed layers of ground-cover cards that make the tuft. */
function addCoverLayers(parts, rng, qs) {
  // --- inner layer: short dense tufts, roots all around the crown
  const inner = Math.max(6, Math.round(34 * qs));
  for (let i = 0; i < inner; i++) {
    const a = (i / inner) * TAU + rng() * 0.7;
    const rr = rng() * 0.12;
    standCard(parts, rng, Math.cos(a) * rr, Math.sin(a) * rr, a + (rng() - 0.5) * 0.8, {
      w: 0.3 + rng() * 0.16,
      h: 0.32 + rng() * 0.26,
      cell: 'tuft',
      tilt: (rng() - 0.5) * 0.22,
      sink: 0.025 + rng() * 0.01,
    });
  }
  // --- mid layer: tall fine blades pushing above the mass
  const mid = Math.max(4, Math.round(20 * qs));
  for (let i = 0; i < mid; i++) {
    const a = (i / mid) * TAU * 1.07 + rng() * 0.6;
    const rr = rng() * 0.16;
    standCard(parts, rng, Math.cos(a) * rr, Math.sin(a) * rr, a + (rng() - 0.5) * 0.5, {
      w: 0.26 + rng() * 0.14,
      h: 0.6 + rng() * 0.34,
      cell: 'tuftTall',
      tilt: (rng() - 0.5) * 0.16,
      sink: 0.03,
    });
  }
  // --- outer layer: dry straw cards pressed against the rim
  const dry = Math.max(3, Math.round(9 * qs));
  for (let i = 0; i < dry; i++) {
    const a = (i / dry) * TAU + rng() * 0.8;
    const rr = 0.16 + rng() * 0.14;
    standCard(parts, rng, Math.cos(a) * rr, Math.sin(a) * rr, a + (rng() - 0.5) * 1.0, {
      w: 0.28 + rng() * 0.12,
      h: 0.28 + rng() * 0.2,
      cell: 'tuftDry',
      tilt: (rng() - 0.5) * 0.4,
      sink: 0.025,
    });
  }
  // --- ground transition: low moss/round-leaf cards lying at the foot
  const cover = Math.max(2, Math.round(5 * qs));
  for (let i = 0; i < cover; i++) {
    const a = (i / cover) * TAU + rng() * 1.1;
    const rr = 0.18 + rng() * 0.2;
    standCard(parts, rng, Math.cos(a) * rr, Math.sin(a) * rr, a, {
      w: 0.3 + rng() * 0.14,
      h: 0.24 + rng() * 0.1,
      cell: 'cover',
      tilt: (rng() - 0.5) * 0.3,
      sink: 0.03,
    });
  }
  // --- foreground detail: a few old single blades poking out of the mass
  const detail = Math.max(3, Math.round(10 * qs));
  for (let i = 0; i < detail; i++) {
    const yaw = rng() * TAU;
    const lean = rng();
    push(parts.bladeDark, bladeCard(0.34 + rng() * 0.16, 0.06 + rng() * 0.03, rng() < 0.5 ? 'broad' : 'fern', {
      th0: 1.3 - 0.55 * lean, k: 0.45 + 0.75 * lean, segs: 4, cols: 2,
    }), matrixFor(Math.cos(yaw) * 0.04, 0.0, -Math.sin(yaw) * 0.04, 0, yaw, 0));
  }
}

/**
 * A few curving seed stalks with small seed heads. The stalk is a crossed-ribbon straw
 * (visible from any angle) and the panicle is 15% smaller than the first pass and rides
 * the darker thatch material, so it stops reading as a bright floating bead.
 */
function addSeedStalks(parts, rng, count) {
  for (let i = 0; i < count; i++) {
    const yaw = rng() * TAU;
    const len = 0.74 + rng() * 0.08; // arch tip stays below 0.8 m
    const th0 = 1.3 + rng() * 0.1;
    const k = 0.5 + rng() * 0.12;
    push(parts.dead, strawStalk(len, 0.034, { th0, k, segs: 4 }),
      matrixFor(Math.cos(yaw) * 0.02, 0.0, -Math.sin(yaw) * 0.02, 0, yaw, 0));
    // leaf whorl just under the panicle: ties the head to the tuft visually
    const near = archFrame(len, th0, k, 0.82);
    for (let w = 0; w < 3; w++) {
      const wa = yaw + w * 2.1 + (rng() - 0.5) * 0.35;
      push(parts.bladeDark, bladeCard(0.15 + rng() * 0.06, 0.1 + rng() * 0.03, 'broad', {
        th0: 0.2 + rng() * 0.9, k: 1.35, segs: 2, cols: 2, baseW: 0.5,
      }), matrixFor(
        Math.cos(yaw) * 0.02 + Math.cos(yaw) * near.x, 0.0 + near.y, -Math.sin(yaw) * 0.02 - Math.sin(yaw) * near.x,
        0, wa, 0
      ));
    }
    // seed head at the tip of the arch (15% smaller than before, darker material)
    const tip = archFrame(len, th0, k, 1);
    const head = sphereGeo(0.0085 + rng() * 0.003, { segW: 5, segH: 4, tile: 0.3 });
    head.scale(1, 2.1, 1);
    push(parts.rice, head, matrixFor(
      Math.cos(yaw) * 0.02 + Math.cos(yaw) * tip.x, tip.y - 0.01, -Math.sin(yaw) * 0.02 - Math.sin(yaw) * tip.x,
      (rng() - 0.5) * 0.3, yaw, (rng() - 0.5) * 0.3
    ));
  }
}

/** Broad-leaf weeds pushing up through the grass. */
function addWeeds(parts, rng, count) {
  for (let i = 0; i < count; i++) {
    const yaw = rng() * TAU;
    const rr = 0.08 + rng() * 0.24;
    const len = 0.26 + rng() * 0.14;
    for (let j = 0; j < 2; j++) {
      const a = yaw + j * 2.2 + (rng() - 0.5) * 0.4;
      push(parts.weed, bladeCard(len, 0.32, 'broad', {
        th0: 0.95 + j * 0.2, k: 1.3, segs: 3, cols: 3, baseW: 0.42,
      }), matrixFor(Math.cos(yaw) * rr, 0.05, -Math.sin(yaw) * rr, 0, a, 0));
    }
  }
}

/** Brown dead straw blades slumped around the foot of the tuft. */
function addDeadBlades(parts, rng, count) {
  for (let i = 0; i < count; i++) {
    const yaw = rng() * TAU;
    push(parts.dead, strawStalk(0.22 + rng() * 0.12, 0.02, { th0: 0.5 + rng() * 0.2, k: 0.9, segs: 3 }),
      matrixFor(Math.cos(yaw) * 0.05, 0.0, -Math.sin(yaw) * 0.05, 0, yaw, 0));
  }
}

/** Wet soil mound + a few dead leaves at the base. */
function addGround(parts, rng) {
  const mound = sphereGeo(0.26, { segW: 10, segH: 6, tile: 1.0 });
  mound.scale(1, 0.1, 1);
  mound.computeVertexNormals();
  push(parts.mud, planarUV(mound, 0.85), matrixFor(0, 0.005, 0, 0, 0.4, 0));
  // a couple of spent leaf scraps pressed into the mound (kept on the mound top, and
  // tilted so the rim sinks into the soil instead of hovering above it)
  for (let i = 0; i < 4; i++) {
    const a = rng() * TAU;
    const rr = 0.1 + rng() * 0.12;
    const g = new THREE.PlaneGeometry(0.08 + rng() * 0.05, 0.04 + rng() * 0.02);
    const uv = g.attributes.uv;
    for (let v = 0; v < uv.count; v++) uv.setXY(v, uv.getX(v) * 0.12, uv.getY(v) * 0.08);
    push(parts.litter, g, matrixFor(Math.cos(a) * rr, 0.018, Math.sin(a) * rr, -1.53, rng() * TAU, 0));
  }
}

// ---------------------------------------------------------------------------
// family builder
// ---------------------------------------------------------------------------

function grassTuftGeometry(hi, rng, qs) {
  const parts = { blade: [], bladeDark: [], weed: [], dead: [], rice: [], mud: [], litter: [] };
  addCoverLayers(parts, rng, qs);
  addSeedStalks(parts, rng, hi ? 4 : 3);
  addWeeds(parts, rng, hi ? 4 : 2);
  addDeadBlades(parts, rng, hi ? 8 : 5);
  addGround(parts, rng);
  return {
    // mud / leafLitter are vertex-colour materials: bake height AO for them
    blade: merge(parts.blade),
    bladeDark: merge(parts.bladeDark),
    weed: merge(parts.weed),
    dead: merge(parts.dead),
    rice: merge(parts.rice),
    mud: bakeVertexAO(merge(parts.mud), { ground: 0.4, floor: 0.58, noise: 0.1, seed: 73 }),
    litter: bakeVertexAO(merge(parts.litter), { ground: 0.3, floor: 0.6, noise: 0.08, seed: 79 }),
  };
}

function buildGrassTufts(ctx, preview) {
  const items = (island(ctx).grassTufts || []).map((p) => ({
    x: p.x, z: p.z, y: p.y ?? 0, ry: p.ry ?? 0, rx: p.rx ?? 0, rz: p.rz ?? 0, s: p.s ?? 1,
  }));
  if (!items.length) return;
  const M = ctx.materials;
  const hi = preview || ctx.stage === true;
  const qs = cardScale(ctx);
  const rng = makeRNG(8821);
  const geo = grassTuftGeometry(hi, rng, qs);
  const opts = { seed: 811, castShadow: true };
  makeInstanced(ctx, geo.blade, M.grassBlade, items, 'grass-tuft-cards', 'fabric', opts);
  makeInstanced(ctx, geo.bladeDark, M.broadleafDark, items, 'grass-tuft-blades', 'fabric', opts);
  makeInstanced(ctx, geo.weed, M.broadleaf, items, 'grass-tuft-weeds', 'fabric', opts);
  makeInstanced(ctx, geo.dead, M.thatchDark, items, 'grass-tuft-dead-blades', 'fabric', opts);
  makeInstanced(ctx, geo.rice, M.thatchDark, items, 'grass-tuft-seed-heads', 'fabric', opts);
  makeInstanced(ctx, geo.mud, M.mud, items, 'grass-tuft-mound', 'sand', opts);
  makeInstanced(ctx, geo.litter, M.leafLitter, items, 'grass-tuft-litter', 'sand', opts);
}
