import * as THREE from 'three';
import {
  makeInstanced,
  matrixFor,
} from '../core.js';
import {
  boltGeo,
  cylGeo,
  latheGeo,
  plateGeo,
  torusGeo,
  tubeGeo,
} from './detail.js';
import { makeRNG } from '../../utils.js';

export const meta = { id: 'barrel', kind: 'world', group: 'clutter', label: '油桶 · FUEL DRUMS' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.barrels = [{ x: -0.5, z: 0.1, yaw: 0.2 }, { x: 0.55, z: -0.1, yaw: 1.4 }];
  buildBarrelFamily(ctx, true);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildBarrelFamily(ctx, false);
}

const R = 0.37; // body radius (collider / footprint stays 0.37)
const HH = 0.47; // half height, bottom sits at local -0.47

/**
 * Barrel / fuel drum family.
 * Split out from world.js buildInstancedProps. `preview` is true only for the isolated
 * model-stage build, which uses the stage sample items instead of the map layout.
 */
function buildBarrelFamily(ctx, preview) {
  const L = ctx.data.layout;
  const M = ctx.materials;
  const barrelItems = L.barrels.map((b) => ({ x: b.x, y: 0.47, z: b.z, ry: b.yaw, s: 1 }));
  // Second-row drums sit on real base drums (they used to hover 0.95 m over the sand).
  // The coordinates below are the outpost-07 site decoration; on the tropical island map
  // they landed on empty ground, so only add them for the desert map.
  const outpostSite = !ctx.data?.style;
  if (!preview && outpostSite) for (const [x, z] of [[-18.2, 28.6], [-19.3, 27.2], [-30.9, -24.8], [22.2, -28.1]]) {
    barrelItems.push({ x, y: 1.41, z, ry: 0.4, s: 1 });
  }

  // The stage build turns each drum into the ~10k-triangle showcase prop; the map
  // keeps one cheap 532-tri lathe geometry instanced over all 33 drums.
  if (ctx.stage === true) {
    barrelItems.forEach((it, i) => buildDetailBarrel(ctx, it, i));
    return;
  }
  const barrelGeo = buildLowBarrelGeo();
  makeInstanced(ctx, barrelGeo, M.rust, barrelItems, 'barrels', 'metal', { seed: 42 });
}

// ===========================================================================
// high-detail stage drum (~10k tris per drum)
// ===========================================================================

// Lathe profile of the body: rolled chime rims top / bottom, three raised rolling
// hoops stamped into the shell, then the pressed lid field with concentric rings.
const HI_PROFILE = [
  [0.000, -HH],
  [0.300, -0.470],
  [0.340, -0.468],
  [0.360, -0.462],
  [0.369, -0.452],
  [0.3720, -0.440],
  [0.369, -0.428],
  [0.366, -0.416],
  [0.366, -0.330],
  [0.371, -0.320],
  [0.3785, -0.306],
  [0.3785, -0.292],
  [0.371, -0.278],
  [0.366, -0.268],
  [0.366, -0.030],
  [0.371, -0.020],
  [0.3785, -0.008],
  [0.3785, 0.006],
  [0.371, 0.016],
  [0.366, 0.026],
  [0.366, 0.268],
  [0.371, 0.278],
  [0.3785, 0.292],
  [0.3785, 0.306],
  [0.371, 0.320],
  [0.366, 0.330],
  [0.366, 0.416],
  [0.369, 0.428],
  [0.3720, 0.440],
  [0.369, 0.452],
  [0.360, 0.462],
  [0.340, 0.468],
  [0.320, 0.470],
  [0.310, 0.464],
  [0.292, 0.462],
  [0.281, 0.4665],
  [0.269, 0.462],
  [0.246, 0.4525],
  [0.227, 0.461],
  [0.215, 0.4525],
  [0.190, 0.447],
  [0.167, 0.4555],
  [0.155, 0.447],
  [0.120, 0.4435],
  [0.060, 0.4415],
  [0.000, 0.441],
];
const HI_SEGMENTS = 38;

/**
 * Push a little deterministic damage into the shell: shallow dents squeezed inward,
 * a couple of bulges around the hoops, so the drum reads as beaten-up steel rather
 * than a perfect cylinder. Triangle count is untouched.
 */
function dentShell(geo, seed) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    if (r < 0.1) continue; // keep bungs / centres clean
    const a = Math.atan2(v.x, v.z);
    const n = Math.sin(a * 6.7 + v.y * 21.3 + seed * 3.1) * Math.cos(v.y * 15.9 - a * 2.7 + seed * 1.7);
    const d = n > 0.6 ? (n - 0.6) * 0.006 : n * 0.0024;
    const k = Math.max(0.6, (r + d) / r);
    v.x *= k;
    v.z *= k;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * Curved patch that hugs the drum shell (a sector of a cylinder, `radialSeg` quads).
 * Flat plates over a 0.37 m cylinder inevitably lift at their ends, so every repair
 * plate on the body is built as a shell sector instead.
 */
function curvedPatch(radius, height, theta, radialSeg = 4, tile = 1.2) {
  const g = new THREE.CylinderGeometry(radius, radius, height, radialSeg, 1, true, 0, theta);
  const uv = g.attributes.uv;
  const circ = Math.PI * 2 * radius;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * height) / tile);
  return g;
}

/**
 * Build one beaten-up fuel drum at `it` (position / yaw / uniform scale) into the
 * preview batcher: shell, hoops, chime rims, welds, lid with pressed rings and bungs,
 * riveted repair bands, patches and lifting lugs.
 */
function buildDetailBarrel(ctx, it, index) {
  const rng = makeRNG(7300 + index * 613);
  const s = it.s || 1;
  const base = matrixFor(it.x, it.y, it.z, 0, it.ry, 0, s, s, s);
  const B = ctx.batcher;

  const part = (key, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = matrixFor(x, y, z, rx, ry, rz);
    m.premultiply(base);
    B.add(key, geo, m);
    geo.dispose();
  };
  const partLocal = (key, geo, m = null) => {
    const mm = m || new THREE.Matrix4();
    mm.premultiply(base);
    B.add(key, geo, mm);
    geo.dispose();
  };
  const _up = new THREE.Vector3(0, 1, 0);
  const _one = new THREE.Vector3(1, 1, 1);
  /** Bolt / rivet whose head points along `(nx,ny,nz)` at a local point. */
  const head = (key, x, y, z, nx, ny, nz, r = 0.011, h = 0.008) => {
    const q = new THREE.Quaternion().setFromUnitVectors(_up, new THREE.Vector3(nx, ny, nz).normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, _one);
    partLocal(key, boltGeo(r, h), m);
  };
  /** Radially oriented shell plate; `a` is its centre angle. */
  const patch = (key, a, y, radius, w, h, { seg = 4, tile = 0.7 } = {}) => {
    const theta = w / radius;
    part(key, curvedPatch(radius, h, theta, seg, tile), 0, y, 0, 0, a - theta / 2, 0);
  };
  /** Point on the shell at angle `a` (radians, 0 = +Z) and height `y`. */
  const shellPt = (a, y, rad = R) => [Math.sin(a) * rad, y, Math.cos(a) * rad];
  const wobble = (a) => (rng() - 0.5) * a;

  // ------------------------------------------------------------------- shell
  const shell = latheGeo(HI_PROFILE, { segments: HI_SEGMENTS, tile: 1.2 });
  dentShell(shell, index * 11.7 + 2.3);
  partLocal('rust', shell);

  // rolled chime rims: a proud torus at each end of the barrel
  part('rust', torusGeo(0.372, 0.009, { radialSeg: 6, tubularSeg: 38, tile: 0.5 }), 0, -0.452, 0, Math.PI / 2, 0, 0);
  part('rust', torusGeo(0.372, 0.009, { radialSeg: 6, tubularSeg: 38, tile: 0.5 }), 0, 0.452, 0, Math.PI / 2, 0, 0);
  // foot ring the drum stands on (bottom stays at exactly -0.47)
  part('rust', torusGeo(0.336, 0.013, { radialSeg: 6, tubularSeg: 30, tile: 0.5 }), 0, -0.457, 0, Math.PI / 2, 0, 0);

  // ------------------------------------------------------------- shell rivets
  // weld rivets around the three rolling hoops
  for (const [hy, count] of [[-0.299, 15], [0.299, 15], [-0.001, 16]]) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + index * 0.23 + hy * 3.1;
      const [px, py, pz] = shellPt(a, hy + wobble(0.006), 0.3755);
      head('metal', px, py, pz, Math.sin(a), 0, Math.cos(a), 0.0115, 0.0075);
    }
  }
  // rivet rows along the chime seams
  for (const [hy, count] of [[0.432, 16], [-0.432, 16]]) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.11;
      const [px, py, pz] = shellPt(a, hy, R + 0.002);
      head('metal', px, py, pz, Math.sin(a), 0, Math.cos(a), 0.0105, 0.007);
    }
  }

  // -------------------------------------------------------------- weld seams
  // vertical seam weld down one side + a second short seam opposite
  const seamPts = [];
  for (let i = 0; i <= 8; i++) {
    const y = -0.415 + (i / 8) * 0.83;
    const a = -0.62 + Math.sin(i * 1.7 + index) * 0.03;
    seamPts.push(new THREE.Vector3(Math.sin(a) * 0.3685, y, Math.cos(a) * 0.3685));
  }
  partLocal('metalDark', tubeGeo(seamPts, 0.015, { tubularSeg: 22, radialSeg: 5, tile: 0.7 }));
  const seamPts2 = [];
  for (let i = 0; i <= 5; i++) {
    const y = 0.05 + (i / 5) * 0.34;
    const a = 1.15 + Math.sin(i * 2.1 + index) * 0.03;
    seamPts2.push(new THREE.Vector3(Math.sin(a) * 0.368, y, Math.cos(a) * 0.368));
  }
  partLocal('metalDark', tubeGeo(seamPts2, 0.012, { tubularSeg: 14, radialSeg: 5, tile: 0.7 }));
  // horizontal seam weld just under the lid rim
  const seamRing = [];
  for (let i = 0; i <= 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    seamRing.push(new THREE.Vector3(Math.sin(a) * 0.3695, 0.424, Math.cos(a) * 0.3695));
  }
  partLocal('metalDark', tubeGeo(seamRing, 0.01, { tubularSeg: 30, radialSeg: 5, tile: 0.7 }));

  // ------------------------------------------------------------------- lid
  // pressed lid rings are part of the lathe; add the hardware: two bungs, vent,
  // a lifting handle bridge and the lid rivet ring.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.08;
    const [px, py, pz] = shellPt(a, 0.457, 0.345);
    head('metal', px, py, pz, Math.sin(a) * 0.25, 1, Math.cos(a) * 0.25, 0.0105, 0.007);
  }

  // 2" bung: welded collar, cap and hex plug
  const bx = -0.09;
  const bz = 0.05;
  part('rust', torusGeo(0.072, 0.013, { radialSeg: 6, tubularSeg: 26, tile: 0.5 }), bx, 0.4465, bz, Math.PI / 2, 0, 0);
  part('metalDark', cylGeo(0.058, 0.06, 0.018, { radial: 16, tile: 0.5 }), bx, 0.455, bz);
  part('metal', cylGeo(0.03, 0.03, 0.018, { radial: 6, tile: 0.4 }), bx, 0.4665, bz);
  part('metal', new THREE.BoxGeometry(0.092, 0.008, 0.012), bx, 0.4765, bz, 0, 0.4 + index, 0);
  // 3/4" bung on the opposite side of the lid
  const b2x = 0.15;
  const b2z = -0.09;
  part('rust', torusGeo(0.048, 0.01, { radialSeg: 6, tubularSeg: 20, tile: 0.5 }), b2x, 0.447, b2z, Math.PI / 2, 0, 0);
  part('metalDark', cylGeo(0.036, 0.038, 0.016, { radial: 14, tile: 0.5 }), b2x, 0.454, b2z);
  part('metal', cylGeo(0.019, 0.019, 0.018, { radial: 6, tile: 0.4 }), b2x, 0.4655, b2z);
  // small pressure-relief vent
  part('metal', cylGeo(0.011, 0.011, 0.016, { radial: 8, tile: 0.3 }), 0.0, 0.4545, 0.2);
  part('metal', torusGeo(0.016, 0.004, { radialSeg: 4, tubularSeg: 10, tile: 0.3 }), 0.0, 0.4625, 0.2, Math.PI / 2, 0, 0);

  // ------------------------------------------------ curved repair bands / plates
  // Field repairs: each plate is a shell sector so it sits flush instead of hovering
  // at its edges. Heights / angles are jittered so the drum does not look tiled.
  const bandY = 0.178 + index * 0.014;
  const bandN = index === 0 ? 8 : 7;
  for (let i = 0; i < bandN; i++) {
    const a = ((i + rng() * 0.45) / bandN) * Math.PI * 2 + 0.18 + index * 0.3;
    const key = i % 4 === 0 ? 'metal' : (i % 5 === 3 ? 'rust' : 'metalDark');
    const w = 0.115 + rng() * 0.05;
    const h = 0.085 + rng() * 0.06;
    const y = bandY + wobble(0.02);
    patch(key, a, y, 0.3685, w, h, { seg: 4 });
    // one rivet at each end of the plate
    const da = w / 0.3685 / 2;
    for (const dir of [-1, 1]) {
      const aa = a + dir * da * 0.7;
      const [rx, ry2, rz] = shellPt(aa, y + h * 0.2, 0.3725);
      head('metal', rx, ry2, rz, Math.sin(aa), 0, Math.cos(aa), 0.0105, 0.007);
    }
  }
  // long vertical straps welded across a hoop (patching a split seam)
  const strapN = 3;
  for (let i = 0; i < strapN; i++) {
    const a = ((i + 0.35 + index * 0.17) / strapN) * Math.PI * 2 + index * 0.9;
    const y = -0.02 + wobble(0.16);
    patch('metalDark', a, y, 0.3685, 0.055, 0.22 + rng() * 0.08, { seg: 3 });
    for (let k = -1; k <= 1; k++) {
      const [rx, ry2, rz] = shellPt(a, y + k * 0.085, 0.3725);
      head('metal', rx, ry2, rz, Math.sin(a), 0, Math.cos(a), 0.0095, 0.0065);
    }
  }
  // lower band: fewer, larger, more corroded patches
  const lowN = index === 0 ? 6 : 7;
  for (let i = 0; i < lowN; i++) {
    const a = ((i + rng() * 0.4) / lowN) * Math.PI * 2 + 0.51 - index * 0.2;
    const w = 0.15 + rng() * 0.06;
    const h = 0.1 + rng() * 0.05;
    const y = -0.185 + wobble(0.03);
    patch(i % 4 === 3 ? 'rust' : 'metalDark', a, y, 0.3685, w, h, { seg: 4 });
    const [rx, , rz] = shellPt(a, y, 0.3725);
    head('metal', rx, y, rz, Math.sin(a), 0, Math.cos(a), 0.0105, 0.007);
  }
  // isolated dented / rusted panel patches
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2;
    const y = -0.34 + rng() * 0.66;
    patch(i % 2 ? 'rust' : 'metalDark', a, y, 0.3685, 0.09 + rng() * 0.05, 0.06 + rng() * 0.04,
      { seg: 3, tile: 0.6 });
  }

  // welding heat marks / short beads near the patches
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const y = -0.3 + rng() * 0.6;
    const pts = [];
    for (let k = 0; k <= 3; k++) {
      const aa = a + (k / 3) * 0.16;
      pts.push(new THREE.Vector3(Math.sin(aa) * 0.3695, y + (k - 1.5) * 0.045, Math.cos(aa) * 0.3695));
    }
    partLocal('metalDark', tubeGeo(pts, 0.009, { tubularSeg: 10, radialSeg: 4, tile: 0.6 }));
  }

  // ------------------------------------------------------------ lifting lugs
  // four folded lugs welded to the top chime, used by the crane sling
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    const [px, , pz] = shellPt(a, 0.392, 0.3665);
    part('metalDark', plateGeo(0.062, 0.085, 0.01, { bevel: 0.004, tile: 0.6 }),
      px, 0.392, pz, 0, a, 0);
    part('metalDark', plateGeo(0.05, 0.014, 0.045, { bevel: 0.004, tile: 0.6 }),
      px, 0.437, pz, -0.5, a, 0);
    const [hx, , hz] = shellPt(a, 0.395, 0.3705);
    head('metal', hx, 0.368, hz, Math.sin(a), 0, Math.cos(a), 0.0105, 0.0075);
    head('metal', hx, 0.418, hz, Math.sin(a), 0, Math.cos(a), 0.0105, 0.0075);
  }

  // small galvanised scrap patch (repair plate) tucked below the upper band
  const scrapeA = 2.45 - index * 0.4;
  patch(index === 0 ? 'sheet' : 'metal', scrapeA, -0.06, 0.3685, 0.14, 0.09, { seg: 5, tile: 0.6 });
  const [wx, , wz] = shellPt(scrapeA, -0.02, 0.3725);
  head('metal', wx, -0.02, wz, Math.sin(scrapeA), 0, Math.cos(scrapeA), 0.0095, 0.007);
}

// ===========================================================================
// in-game map drum (cheap instanced LOD, ≤600 tris per drum)
// ===========================================================================

/** 20-point profile at 14 radial segments = 532 tris: rolled rims, two rolling
 *  hoops and the recessed lid, i.e. the same silhouette as the showcase drum. */
const LOW_PROFILE = [
  [0.000, -HH],
  [0.300, -HH],
  [0.340, -0.466],
  [0.368, -0.452],
  [0.366, -0.430],
  [0.366, -0.310],
  [0.378, -0.298],
  [0.366, -0.286],
  [0.366, -0.014],
  [0.378, -0.002],
  [0.366, 0.010],
  [0.366, 0.286],
  [0.378, 0.298],
  [0.366, 0.310],
  [0.366, 0.430],
  [0.368, 0.452],
  [0.340, 0.466],
  [0.300, HH],
  [0.150, 0.452],
  [0.000, 0.450],
];

function buildLowBarrelGeo() {
  return latheGeo(LOW_PROFILE, { segments: 14, tile: 1.2 });
}
