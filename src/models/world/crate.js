import * as THREE from 'three';
import {
  boxGeometryWorldUV,
  cylinderWorldUV,
  makeInstanced,
  matrixFor,
  mergeGeometries,
  transformed,
} from '../core.js';
import {
  boltGeo,
  cylGeo,
  plateGeo,
  tubeGeo,
} from './detail.js';
import { makeRNG } from '../../utils.js';

export const meta = { id: 'crate', kind: 'world', group: 'clutter', label: '木箱堆 · CRATE STACK' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  ctx.data.layout.crates = [{ x: 0, z: 0, s: 1.0, ry: 0.35, stack: 3 }];
  buildCrateFamily(ctx, true);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildCrateFamily(ctx, false);
}

// ---------------------------------------------------------------------------
// authored crate proportions (metres) — stack items scale this uniformly
// ---------------------------------------------------------------------------
const HW = 0.5; // half footprint (x / z)
const BOT = -0.41; // bottom of the 0.82 m tall crate
const BODY_TOP = 0.386; // walls / corner posts stop here; lid boards sit on top
const LID_TOP = 0.410; // top of the lid boards

/**
 * Crate stack family (wooden ammo crates & small boxes).
 * Split out of world.js buildInstancedProps. `preview` is true only for the isolated
 * model-stage build, which uses the stage sample items instead of the map layout.
 */
function buildCrateFamily(ctx, preview) {
  const L = ctx.data.layout;
  const M = ctx.materials;
  const crateItems = [];
  for (const c of L.crates) {
    for (let k = 0; k < c.stack; k++) {
      // crates are 0.82·s tall (matching the collider boxes) so the stack surfaces meet
      // instead of interpenetrating, and the bottom sits exactly on the sand
      crateItems.push({
        x: c.x + (k > 0 ? (k % 2 === 0 ? 0.06 : -0.05) : 0),
        y: c.s * 0.41 + k * c.s * 0.82,
        z: c.z + (k > 0 ? (k % 2 === 0 ? -0.05 : 0.04) : 0),
        ry: c.ry + k * 0.22,
        s: c.s,
      });
    }
  }
  // a few extra loose crates / ration boxes at waist height (positions/rotations come
  // from the layout so their collision boxes are registered in buildWorldData)
  if (!preview) for (const c of L.looseCrates) {
    crateItems.push({ x: c.x, y: c.s * 0.41, z: c.z, ry: c.ry, s: c.s });
  }

  // The showroom build gets the full ~6.6k-triangle prop; the map keeps a cheap
  // instanced version (~780 tris) shared by every crate on the map.
  if (ctx.stage === true) {
    crateItems.forEach((it, i) => buildDetailCrate(ctx, it, i));
    return;
  }
  buildLowCrates(ctx, crateItems, M);
}

// ===========================================================================
// UV helper: map one board onto a single wood-texture plank strip so the grain
// runs along the board instead of across it.
// ===========================================================================

/**
 * Re-map a plate's UVs so the procedural wood grain runs along `along` ('x'|'y')
 * and the board samples a single (narrow) plank strip of the texture instead of
 * crossing the painted seams — this is what makes a bevelled board read as sawn
 * timber rather than a tiled cube face.
 */
function grainUV(geo, w, h, along, strip, vLo = 0.03, vHi = 0.9) {
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  const u0 = strip * 0.25 + 0.032;
  const u1 = u0 + 0.175;
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const tx = Math.min(1, Math.max(0, x / w + 0.5));
    const ty = Math.min(1, Math.max(0, y / h + 0.5));
    const alongT = along === 'x' ? tx : ty;
    const acrossT = along === 'x' ? ty : tx;
    uv.setXY(i, u0 + acrossT * (u1 - u0), vLo + alongT * (vHi - vLo));
  }
  uv.needsUpdate = true;
  return geo;
}

/** Board helper: bevelled plank with the grain running along its length. */
function board(w, h, d, along, strip, { bevel = 0.004, tile = 1.4 } = {}) {
  return grainUV(plateGeo(w, h, d, { bevel, tile }), w, h, along, strip);
}

/**
 * Map a board onto an explicit rectangle of the crate texture (used for the painted
 * ammunition stencils: the markings are sampled straight onto the board, so they
 * sit *in* the timber instead of being a pasted-on label plate).
 */
function stencilUV(geo, w, h, along, u0, u1, v0, v1) {
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const tx = Math.min(1, Math.max(0, pos.getX(i) / w + 0.5));
    const ty = Math.min(1, Math.max(0, pos.getY(i) / h + 0.5));
    const a = along === 'x' ? tx : ty;
    const b = along === 'x' ? ty : tx;
    uv.setXY(i, u0 + a * (u1 - u0), v0 + b * (v1 - v0));
  }
  uv.needsUpdate = true;
  return geo;
}

// ===========================================================================
// high-detail stage crate (~6.6k tris per crate)
// ===========================================================================

const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);

/** Cheap nail / rivet head: 4-sided squat cone (16 tris) vs the 24-tri hex bolt. */
function nailGeo(r = 0.0085, h = 0.006) {
  return cylinderWorldUV(r * 0.5, r, h, 4, 0.6);
}

/**
 * Build one weathered wooden ammunition crate at `it` (position / yaw / uniform scale).
 * Everything is authored around the unit crate (1.0 x 0.82 x 1.0) and pushed into the
 * preview batcher, so the whole stack merges into a handful of material draws.
 */
function buildDetailCrate(ctx, it, index) {
  const rng = makeRNG(4100 + index * 977);
  const base = matrixFor(it.x, it.y, it.z, 0, it.ry, 0, it.s, it.s, it.s);
  const B = ctx.batcher;

  /** Add a local-space part: translate/rotate inside the crate, then place the crate. */
  const part = (key, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = matrixFor(x, y, z, rx, ry, rz);
    m.premultiply(base);
    B.add(key, geo, m);
    geo.dispose();
  };
  /** Add a pre-transformed geometry (e.g. tubeGeo) in crate-local space. */
  const partLocal = (key, geo, m = null) => {
    const mm = m || new THREE.Matrix4();
    mm.premultiply(base);
    B.add(key, geo, mm);
    geo.dispose();
  };
  /** Bolt / nail head sitting on a surface point with the given outward normal. */
  const head = (key, x, y, z, nx, ny, nz, r = 0.011, h = 0.009, geoFn = boltGeo) => {
    const q = new THREE.Quaternion().setFromUnitVectors(
      _up, new THREE.Vector3(nx, ny, nz).normalize()
    );
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, _one);
    partLocal(key, geoFn(r, h), m);
  };

  const wobble = (a) => (rng() - 0.5) * a;
  const strip = () => (rng() * 4) | 0;

  // ---------------------------------------------------------------- frame
  // four square corner posts (slightly proud so they read as a separate timber)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      part('woodDark', board(0.078, BODY_TOP - BOT - 0.012, 0.078, 'y', strip(), { bevel: 0.006 }),
        sx * 0.461, (BODY_TOP + BOT) / 2, sz * 0.461);
    }
  }

  // upper + lower perimeter rails on all four faces
  for (const s of [-1, 1]) {
    for (const y of [0.348, -0.374]) {
      part('wood', board(0.842, 0.062, 0.03, 'x', strip()), 0, y, s * 0.492);
      part('wood', board(0.842, 0.062, 0.03, 'x', strip()), s * 0.492, y, 0, 0, Math.PI / 2, 0);
    }
  }

  // ------------------------------------------------------------- wall planks
  // horizontal boards, four per face, each cut a little differently. One board per
  // face carries the painted calibre stencil straight on the timber.
  const plankY = [-0.2585, -0.0945, 0.0695, 0.2335];
  for (const sz of [-1, 1]) {
    const faceRy = sz > 0 ? 0 : Math.PI;
    plankY.forEach((py, i) => {
      const w = 0.82 - rng() * 0.03;
      const jx = wobble(0.012);
      const jy = py + wobble(0.005);
      const jz = sz * 0.488 + wobble(0.006);
      const rz = wobble(0.01);
      if (i === 1) {
        part('crate', stencilUV(plateGeo(w, 0.154, 0.024, { bevel: 0.004 }),
          w, 0.154, 'x', 0.20, 0.80, 0.455, 0.565), jx, jy, jz, 0, faceRy, rz);
      } else if (i === 3 && sz > 0) {
        part('crate', stencilUV(plateGeo(w, 0.154, 0.024, { bevel: 0.004 }),
          w, 0.154, 'x', 0.16, 0.85, 0.60, 0.73), jx, jy, jz, 0, faceRy, rz);
      } else {
        part('wood', board(w, 0.154, 0.024, 'x', strip()), jx, jy, jz, 0, faceRy, rz);
      }
    });
  }
  for (const sx of [-1, 1]) {
    const faceRy = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    plankY.forEach((py, i) => {
      const w = 0.82 - rng() * 0.03;
      const jx = sx * 0.488 + wobble(0.006);
      const jy = py + wobble(0.005);
      const jz = wobble(0.012);
      const rz = wobble(0.01);
      if (i === 1) {
        part('crate', stencilUV(plateGeo(w, 0.154, 0.024, { bevel: 0.004 }),
          w, 0.154, 'x', 0.33, 0.67, 0.355, 0.42), jx, jy, jz, 0, faceRy, rz);
      } else {
        part('wood', board(w, 0.154, 0.024, 'x', strip()), jx, jy, jz, 0, faceRy, rz);
      }
    });
  }

  // diagonal wind braces on the two long faces (seen on real ammo crates)
  part('woodDark', board(1.16, 0.06, 0.016, 'x', strip()),
    0, -0.012, 0.503, 0, 0, 0.66);
  part('woodDark', board(1.16, 0.06, 0.016, 'x', strip()),
    0, -0.012, -0.503, 0, Math.PI, -0.66);

  // ------------------------------------------------------------------- lid
  // five boards across the top (grain running fore/aft), each one a bit proud of
  // its neighbour so the seams catch the light
  for (let i = 0; i < 5; i++) {
    const x = -0.38 + i * 0.19;
    part('wood', board(0.188, 0.98, 0.024, 'y', strip(), { bevel: 0.003 }),
      x + wobble(0.004), 0.400 + wobble(0.003), wobble(0.005), -Math.PI / 2, 0, wobble(0.005));
  }
  // two cross battens under the lid straps, tying the boards together
  for (const z of [-0.27, 0.29]) {
    part('woodDark', board(0.9, 0.052, 0.016, 'x', strip(), { bevel: 0.003 }),
      0, 0.4105, z, -Math.PI / 2, 0, 0);
  }
  // small painted stencil label on the lid (rotated 180° so it reads upright in plan)
  part('crate', stencilBoard(0.24, 0.09, 0.006, 0.32, 0.45, 0.68, 0.57),
    -0.13, 0.4115, 0.15, -Math.PI / 2, Math.PI, 0);
  // steel straps running across the lid
  for (const x of [-0.30, 0.30]) {
    part('metalDark', plateGeo(0.09, 0.986, 0.006, { bevel: 0.002, tile: 0.8 }),
      x, 0.4165, 0, -Math.PI / 2, 0, 0);
    for (const z of [-0.40, -0.02, 0.36]) {
      head('metal', x + wobble(0.005), 0.4205, z + wobble(0.008), 0, 1, 0, 0.0115, 0.0085);
    }
  }
  // lid corner caps (flat L over each corner + a short drop down the post)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      part('metalDark', plateGeo(0.105, 0.007, 0.105, { bevel: 0.003, tile: 0.8 }),
        sx * 0.447, 0.4155, sz * 0.447);
      part('metalDark', plateGeo(0.096, 0.08, 0.006, { bevel: 0.003, tile: 0.8 }),
        sx * 0.447, 0.368, sz * 0.5045);
      part('metalDark', plateGeo(0.096, 0.08, 0.006, { bevel: 0.003, tile: 0.8 }),
        sx * 0.5045, 0.368, sz * 0.447, 0, Math.PI / 2, 0);
      // struck corner gusset on the lid top
      part('metalDark', plateGeo(0.085, 0.006, 0.085, { bevel: 0.002, tile: 0.8 }),
        sx * 0.34, 0.4175, sz * 0.34, 0, Math.PI / 4, 0);
      head('metal', sx * 0.447, 0.4185, sz * 0.39, 0, 1, 0, 0.012, 0.009);
      head('metal', sx * 0.447, 0.352, sz * 0.5085, 0, 0, sz, 0.0115, 0.009);
      head('metal', sx * 0.5085, 0.352, sz * 0.447, sx, 0, 0, 0.0115, 0.009);
    }
  }

  // ------------------------------------------------------- metal reinforcement
  // vertical corner straps (top + bottom) on every face corner; one in five is a
  // rusted old strap instead of a repainted one
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const sy of [1, -1]) {
        const cy = sy > 0 ? 0.268 : -0.272;
        const strapKey = ((index + (sx > 0 ? 1 : 0) + (sz > 0 ? 2 : 0) + (sy > 0 ? 3 : 0)) % 5 === 0)
          ? 'rust' : 'metalDark';
        part(strapKey, plateGeo(0.06, 0.22, 0.006, { bevel: 0.003, tile: 0.8 }),
          sx * 0.438, cy, sz * 0.504);
        part(strapKey, plateGeo(0.06, 0.22, 0.006, { bevel: 0.003, tile: 0.8 }),
          sx * 0.504, cy, sz * 0.438, 0, Math.PI / 2, 0);
        head('metal', sx * 0.438, cy + 0.072, sz * 0.5085, 0, 0, sz, 0.0115, 0.009);
        head('metal', sx * 0.438, cy - 0.072, sz * 0.5085, 0, 0, sz, 0.0115, 0.009);
        head('metal', sx * 0.5085, cy + 0.072, sz * 0.438, sx, 0, 0, 0.0115, 0.009);
        head('metal', sx * 0.5085, cy - 0.072, sz * 0.438, sx, 0, 0, 0.0115, 0.009);
      }
    }
  }
  // horizontal straps just under the lid rim and above the bottom rim
  for (const s of [-1, 1]) {
    for (const y of [0.318, -0.318]) {
      const strapKey = ((index + s + (y > 0 ? 1 : 0)) % 3 === 0) ? 'rust' : 'metalDark';
      part(strapKey, plateGeo(0.95, 0.048, 0.006, { bevel: 0.002, tile: 0.8 }), 0, y, s * 0.505);
      part(strapKey, plateGeo(0.95, 0.048, 0.006, { bevel: 0.002, tile: 0.8 }),
        s * 0.505, y, 0, 0, Math.PI / 2, 0);
      for (const tx of [-0.31, 0.31]) {
        head('metal', tx, y, s * 0.509, 0, 0, s, 0.0115, 0.009);
        head('metal', s * 0.509, y, tx, s, 0, 0, 0.0115, 0.009);
      }
    }
  }

  // ------------------------------------------------------------ corner feet
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      part('metalDark', plateGeo(0.098, 0.086, 0.006, { bevel: 0.003, tile: 0.8 }),
        sx * 0.44, -0.363, sz * 0.5045);
      part('metalDark', plateGeo(0.098, 0.086, 0.006, { bevel: 0.003, tile: 0.8 }),
        sx * 0.5045, -0.363, sz * 0.44, 0, Math.PI / 2, 0);
      head('metal', sx * 0.44, -0.363, sz * 0.5085, 0, 0, sz, 0.0115, 0.009);
      head('metal', sx * 0.5085, -0.363, sz * 0.44, sx, 0, 0, 0.0115, 0.009);
    }
  }

  // ------------------------------------------------------------ banding bands
  // two steel shipping bands wrapping the box, each with a crimp seal
  for (const [by, sealX] of [[0.096, 0.3], [-0.174, -0.3]]) {
    for (const s of [-1, 1]) {
      part('metalDark', plateGeo(0.985, 0.028, 0.005, { bevel: 0.002, tile: 0.7 }), 0, by, s * 0.501);
      part('metalDark', plateGeo(0.985, 0.028, 0.005, { bevel: 0.002, tile: 0.7 }),
        s * 0.501, by, 0, 0, Math.PI / 2, 0);
    }
    part('metal', plateGeo(0.05, 0.046, 0.007, { bevel: 0.002, tile: 0.6 }), sealX, by, 0.5055);
    head('metal', sealX + 0.013, by + 0.01, 0.51, 0, 0, 1, 0.01, 0.008);
    head('metal', sealX - 0.013, by - 0.01, 0.51, 0, 0, 1, 0.01, 0.008);
  }

  // -------------------------------------------------------------- hardware
  // hinges on the back edge of the lid
  for (const hx of [-0.255, 0.255]) {
    part('metalDark', plateGeo(0.086, 0.145, 0.008, { bevel: 0.003, tile: 0.7 }), hx, 0.335, -0.5045);
    part('metalDark', plateGeo(0.086, 0.1, 0.008, { bevel: 0.003, tile: 0.7 }), hx, 0.4145, -0.444, -Math.PI / 2, 0, 0);
    part('metal', cylGeo(0.01, 0.01, 0.13, { radial: 8, tile: 0.5 }), hx, 0.388, -0.508, 0, 0, Math.PI / 2);
    head('metal', hx - 0.024, 0.308, -0.5095, 0, 0, -1, 0.011, 0.008);
    head('metal', hx + 0.024, 0.308, -0.5095, 0, 0, -1, 0.011, 0.008);
  }
  // front latch + padlock
  part('metalDark', plateGeo(0.11, 0.16, 0.009, { bevel: 0.003, tile: 0.7 }), 0, 0.332, 0.5045);
  part('metalDark', plateGeo(0.052, 0.125, 0.01, { bevel: 0.003, tile: 0.7 }), 0, 0.294, 0.5135, 0, 0, 0.06);
  head('metal', 0, 0.39, 0.5105, 0, 0, 1, 0.012, 0.009);
  head('metal', -0.032, 0.316, 0.5105, 0, 0, 1, 0.011, 0.008);
  head('metal', 0.032, 0.316, 0.5105, 0, 0, 1, 0.011, 0.008);
  // padlock body + shackle hanging from the hasp
  part('metal', cylGeo(0.022, 0.022, 0.042, { radial: 8, tile: 0.4 }), 0, 0.226, 0.5215, Math.PI / 2, 0, 0);
  part('metal', plateGeo(0.028, 0.02, 0.007, { bevel: 0.002, tile: 0.4 }), 0, 0.226, 0.5425);
  part('metal', cylGeo(0.006, 0.006, 0.018, { radial: 6, tile: 0.4 }), 0, 0.258, 0.5215, 0, 0, Math.PI / 2);
  // grab handles low on the two end faces
  for (const sx of [-1, 1]) {
    part('metalDark', plateGeo(0.011, 0.1, 0.05, { bevel: 0.003, tile: 0.7 }), sx * 0.503, -0.105, -0.075);
    part('metalDark', plateGeo(0.011, 0.1, 0.05, { bevel: 0.003, tile: 0.7 }), sx * 0.503, -0.105, 0.075);
    part('metal', cylGeo(0.009, 0.009, 0.19, { radial: 8, tile: 0.5 }), sx * 0.5085, -0.105, 0, Math.PI / 2, 0, 0);
  }

  // ------------------------------------------------------------- weathering
  // splintered / chipped boards: thin slivers wedged flush onto the faces (they only
  // rotate inside the face plane, so no edge can lift off the crate). They are kept
  // off the stencilled board so the markings stay readable.
  for (let i = 0; i < 5; i++) {
    const sx = rng() > 0.5 ? 1 : -1;
    const onZ = rng() > 0.45;
    const px = onZ ? wobble(0.68) : sx * 0.496;
    const pz = onZ ? sx * 0.496 : wobble(0.68);
    const py = rng() > 0.42 ? 0.12 + rng() * 0.16 : -0.34 + rng() * 0.13;
    const spin = wobble(0.9);
    const chip = board(0.05 + rng() * 0.05, 0.018 + rng() * 0.016, 0.016, 'x', strip(),
      { bevel: 0.002 });
    if (onZ) part('woodDark', chip, px, py, pz, 0, 0, spin);
    else part('woodDark', chip, px, py, pz, 0, Math.PI / 2, spin);
  }
  // loose nails left standing proud of the wood
  for (const [nx, ny, nz, ang] of [
    [0.16, 0.24, 0.512, 0.3], [-0.32, -0.13, 0.512, -0.4], [0.505, -0.26, 0.22, 1.2],
    [-0.505, 0.19, -0.28, -1.1], [0.505, 0.05, 0.34, 1.4],
  ]) {
    part('metal', cylGeo(0.0035, 0.0045, 0.026, { radial: 4, tile: 0.3 }), nx, ny, nz,
      Math.PI / 2 + wobble(0.3), 0, ang);
  }
  // rope tie-down hanging over the front face from the lid
  for (const rx of [-0.16, 0.16]) {
    const pts = [
      new THREE.Vector3(rx - 0.02, 0.412, 0.42),
      new THREE.Vector3(rx - 0.05, 0.33, 0.5),
      new THREE.Vector3(rx - 0.03, 0.16, 0.505),
      new THREE.Vector3(rx + 0.03, 0.04, 0.5),
      new THREE.Vector3(rx + 0.02, -0.05, 0.485),
    ];
    partLocal('rust', tubeGeo(pts, 0.011, { tubularSeg: 14, radialSeg: 5, tile: 0.6 }));
    head('metal', rx - 0.02, 0.412, 0.425, 0, 1, 0, 0.009, 0.007, nailGeo);
  }

  // last rows of nails along the plank lines (cheap, adds "built" texture)
  for (const sz of [-1, 1]) {
    for (const [nx, ny] of [[-0.36, 0.318], [0.36, 0.318], [-0.36, -0.348], [0.36, -0.348]]) {
      head('metal', nx + wobble(0.02), ny, sz * 0.5025, 0, 0, sz, 0.0085, 0.007, nailGeo);
    }
    for (const ny of plankY) {
      head('metal', -0.415, ny, sz * 0.5015, 0, 0, sz, 0.008, 0.0065, nailGeo);
      head('metal', 0.415, ny, sz * 0.5015, 0, 0, sz, 0.008, 0.0065, nailGeo);
    }
  }
  for (const sx of [-1, 1]) {
    for (const ny of plankY) {
      head('metal', sx * 0.5015, ny, -0.415, sx, 0, 0, 0.008, 0.0065, nailGeo);
      head('metal', sx * 0.5015, ny, 0.415, sx, 0, 0, 0.008, 0.0065, nailGeo);
    }
  }
}

/**
 * Thin raised board whose outward (+Z) face maps a rectangle of the crate texture.
 * (Kept for the small painted lid reference mark.)
 */
function stencilBoard(w, h, d, u0, v0, u1, v1) {
  const g = boxGeometryWorldUV(w, h, d, 1.4);
  const uv = g.attributes.uv;
  // BoxGeometry faces are +x,-x,+y,-y,+z,-z with 4 vertices each; the +z face is 16..19,
  // ordered top-left / top-right / bottom-left / bottom-right.
  uv.setXY(16, u0, v1);
  uv.setXY(17, u1, v1);
  uv.setXY(18, u0, v0);
  uv.setXY(19, u1, v0);
  uv.needsUpdate = true;
  return g;
}

// ===========================================================================
// in-game map crate (cheap instanced LOD, ≤850 tris per placement)
// ===========================================================================

/**
 * Build the merged map-level crate geometries once, then let the caller instance
 * them across every crate on the map. The stencilled crate face art of the original
 * single box is preserved; planks, corner posts, rim boards and corner straps are
 * added as shallow relief.
 *   wood mesh  : 432 tris / crate
 *   metal mesh : 344 tris / crate   (8 strap plates + 8 four-sided rivets)
 *   total      : 776 tris / crate
 */
function buildLowCrates(ctx, items, M) {
  const wood = [];
  const metal = [];
  const add = (list, geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    list.push(transformed(geo, matrixFor(x, y, z, rx, ry, rz)));
    geo.dispose();
  };

  // body: keeps the whole procedural crate texture (paint + stencil) on every face
  add(wood, new THREE.BoxGeometry(0.985, 0.795, 0.985), 0, 0.004, 0);

  // corner posts
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(wood, plateGeo(0.078, 0.8, 0.078, { bevel: 0.005, tile: 1.4 }), sx * 0.462, 0, sz * 0.462);
    }
  }
  // rim boards, top and bottom, on four faces
  for (const s of [-1, 1]) {
    for (const y of [0.352, -0.374]) {
      add(wood, plateGeo(0.84, 0.07, 0.026, { bevel: 0.004, tile: 1.4 }), 0, y, s * 0.495);
      add(wood, plateGeo(0.84, 0.07, 0.026, { bevel: 0.004, tile: 1.4 }), s * 0.495, y, 0, 0, Math.PI / 2, 0);
    }
  }
  // lid boards
  for (const x of [-0.31, 0, 0.31]) {
    add(wood, plateGeo(0.29, 0.98, 0.024, { bevel: 0.004, tile: 1.4 }), x, 0.401, 0, -Math.PI / 2, 0, 0);
  }
  // metal corner straps on the four upper corners + one rivet each
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(metal, plateGeo(0.06, 0.22, 0.006, { bevel: 0.003, tile: 0.8 }), sx * 0.44, 0.268, sz * 0.5025);
      add(metal, plateGeo(0.06, 0.22, 0.006, { bevel: 0.003, tile: 0.8 }),
        sx * 0.5025, 0.268, sz * 0.44, 0, Math.PI / 2, 0);
      add(metal, nailGeo(0.014, 0.009), sx * 0.44, 0.33, sz * 0.507);
      add(metal, nailGeo(0.014, 0.009), sx * 0.507, 0.33, sz * 0.44, 0, Math.PI / 2, 0);
    }
  }

  const woodGeo = mergeGeometries(wood);
  const metalGeo = mergeGeometries(metal);
  for (const g of wood) g.dispose();
  for (const g of metal) g.dispose();

  const crateMesh = makeInstanced(ctx, woodGeo, M.crate, items, 'crates', 'wood', { seed: 41 });
  const strapMesh = makeInstanced(ctx, metalGeo, M.metalDark, items, 'crate-straps', 'metal', { seed: 41 });
  ctx.instanced = { crates: crateMesh, crateStraps: strapMesh };
}
