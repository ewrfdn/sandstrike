import * as THREE from 'three';
import {
  TAU,
  makeInstanced,
  mergeGeometries,
  transformed,
  boxGeometryWorldUV,
} from '../core.js';
import { makeRNG } from '../../utils.js';
import { isPreview, plateGeo, cylGeo, boltGeo, latheGeo, torusGeo } from './detail.js';

export const meta = { id: 'tires', kind: 'world', group: 'clutter', label: '轮胎堆 · TIRE STACK' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildTireFamily(ctx, true);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  buildTireFamily(ctx, false);
}

// ---------------------------------------------------------------------------
// Tyre dimensions (the layout / collider depends on them):
//   ring R = 0.40, tube half-height r = 0.15 => 1.10 m outer diameter, 0.30 m
//   tall; the stack steps 0.30 m so the tyres touch.
// ---------------------------------------------------------------------------
const TIRE_R = 0.4;
const TIRE_TUBE = 0.15;
const IDENTITY = new THREE.Matrix4();

/** Add a transformed temporary geometry to a build list and dispose the source. */
function pushGeo(list, geo, matrix) {
  list.push(transformed(geo, matrix || IDENTITY));
  geo.dispose();
}

/** Merge a build list into one geometry and release the parts. */
function mergeList(list) {
  const merged = mergeGeometries(list);
  for (const g of list) g.dispose();
  return merged;
}

/** Local axes of the tyre at angle `a`: tangential, axial, radial. */
function tyreAxes(a) {
  return {
    tang: new THREE.Vector3(-Math.sin(a), Math.cos(a), 0),
    axial: new THREE.Vector3(0, 0, 1),
    rad: new THREE.Vector3(Math.cos(a), Math.sin(a), 0),
  };
}

/**
 * Tyre casing cross-section, revolved around the axle: a flat tread crown,
 * rounded shoulders and bulging sidewalls. Points are (radius, axle offset) and
 * the lathe is rotated onto Z so it matches the instanced tyre frame.
 */
function casingGeo() {
  const profile = [
    [0.232, -0.08], [0.285, -0.118], [0.335, -0.14], [0.395, -0.1495],
    [0.445, -0.146], [0.478, -0.138], [0.505, -0.124], [0.523, -0.106],
    [0.534, -0.082], [0.538, -0.045], [0.54, 0],
    [0.538, 0.045], [0.534, 0.082], [0.523, 0.106], [0.505, 0.124],
    [0.478, 0.138], [0.445, 0.146], [0.395, 0.1495], [0.335, 0.14],
    [0.285, 0.118], [0.232, 0.08],
  ];
  const casing = latheGeo(profile, { segments: 24, tile: 1.0 });
  casing.rotateX(Math.PI / 2); // lathe Y axis -> tyre Z axis
  return casing;
}

/** One angled tread block sitting proud of the casing. */
function treadBlock(rubber, a, z, len, wid, rIn, rOut, skew = 0.22, bevel = 0.0025) {
  const { tang, axial, rad } = tyreAxes(a);
  // diagonal lugs: rotate the block face towards the axle a little
  const xAxis = tang.clone().multiplyScalar(Math.cos(skew)).addScaledVector(axial, Math.sin(skew));
  const yAxis = new THREE.Vector3().crossVectors(rad, xAxis).normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
  const thick = rOut - rIn;
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  m.setPosition(rad.x * (rIn + thick / 2), rad.y * (rIn + thick / 2), z);
  pushGeo(rubber, plateGeo(len, wid, thick, { bevel, tile: 0.8 }), m);
}

/** A shoulder block: surface normal points outwards and towards the sidewall. */
function shoulderBlock(rubber, a, side, len, wid, thick) {
  const { tang, axial, rad } = tyreAxes(a);
  const n = rad.clone().multiplyScalar(0.72).addScaledVector(axial, 0.70 * side).normalize();
  const yAxis = new THREE.Vector3().crossVectors(n, tang).normalize();
  const zAxis = new THREE.Vector3().crossVectors(tang, yAxis).normalize();
  const m = new THREE.Matrix4().makeBasis(tang, yAxis, zAxis);
  m.setPosition(
    rad.x * 0.5 + axial.x * side * 0.124,
    rad.y * 0.5 + axial.y * side * 0.124,
    axial.z * side * 0.124
  );
  pushGeo(rubber, plateGeo(len, wid, thick, { bevel: 0.005, tile: 0.8 }), m);
}

/** Detailed (model-stage) tyre: casing, tread blocks, sidewall ribs + steel rim. */
function tireGeoDetailed(rng) {
  const rubber = [];
  const metal = [];

  pushGeo(rubber, casingGeo(), null);

  // ---- tread: two staggered diagonal lug rows split by a centre groove ------
  const ROWS = 17;
  for (let i = 0; i < ROWS; i++) {
    const a = (i / ROWS) * TAU;
    treadBlock(rubber, a, 0.073, 0.112, 0.104, 0.528, 0.554, 0.24);
    treadBlock(rubber, a + Math.PI / ROWS, -0.073, 0.112, 0.104, 0.528, 0.554, -0.24);
  }
  // shoulder lugs wrap over the edge and break the barrel silhouette
  for (const side of [-1, 1]) {
    for (let i = 0; i < 14; i++) {
      shoulderBlock(rubber, (i / 14) * TAU + (side > 0 ? Math.PI / 28 : 0), side, 0.084, 0.046, 0.016);
    }
  }

  // ---- sidewall: bead lip, embossed rings, moulded lettering ----------------
  for (const z of [-0.142, 0.142]) {
    pushGeo(rubber, torusGeo(0.4, 0.012, { radialSeg: 5, tubularSeg: 28 }), new THREE.Matrix4().makeTranslation(0, 0, z));
    pushGeo(rubber, torusGeo(0.315, 0.01, { radialSeg: 5, tubularSeg: 24 }), new THREE.Matrix4().makeTranslation(0, 0, z * 0.97));
    pushGeo(rubber, torusGeo(0.455, 0.009, { radialSeg: 5, tubularSeg: 24 }), new THREE.Matrix4().makeTranslation(0, 0, z * 0.93));
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + 0.26;
    const { tang, rad } = tyreAxes(a);
    const m = new THREE.Matrix4().makeBasis(tang, rad, new THREE.Vector3(0, 0, 1));
    m.setPosition(rad.x * 0.355, rad.y * 0.355, -0.143);
    pushGeo(rubber, plateGeo(0.055 + rng() * 0.03, 0.026, 0.008, { bevel: 0.003, tile: 0.6 }), m);
  }

  // ---- steel rim / hub on the -Z face (points up in the stack) --------------
  const barrel = cylGeo(0.238, 0.245, 0.2, { radial: 18, tile: 1.0 });
  barrel.rotateX(Math.PI / 2);
  pushGeo(metal, barrel, null);
  const face = cylGeo(0.232, 0.232, 0.028, { radial: 18, tile: 1.0 });
  face.rotateX(Math.PI / 2);
  face.translate(0, 0, -0.108);
  pushGeo(metal, face, null);
  const hub = cylGeo(0.082, 0.105, 0.06, { radial: 12, tile: 0.8 });
  hub.rotateX(Math.PI / 2);
  hub.translate(0, 0, -0.118);
  pushGeo(metal, hub, null);

  const lug = boltGeo(0.018, 0.015, { tile: 0.5 });
  lug.rotateX(Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    pushGeo(metal, lug.clone(), new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.158, Math.sin(a) * 0.158, -0.126));
  }
  lug.dispose();

  return { rubber: mergeList(rubber), metal: mergeList(metal) };
}

/**
 * Cheap in-game tyre: the original 8x16 torus plus a ring of box tread lugs and
 * a rim stub, kept under 520 triangles per tyre (the map shows 12 of them).
 */
function tireGeoCheap() {
  const rubber = [];
  const metal = [];

  pushGeo(rubber, new THREE.TorusGeometry(TIRE_R, TIRE_TUBE, 8, 16), null);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    const side = i % 2 ? 1 : -1;
    const { tang, axial, rad } = tyreAxes(a);
    const m = new THREE.Matrix4().makeBasis(tang, axial, rad);
    m.setPosition(rad.x * 0.548, rad.y * 0.548, side * 0.072);
    pushGeo(rubber, boxGeometryWorldUV(0.13, 0.13, 0.024, 0.8), m);
  }

  const rim = cylGeo(0.235, 0.24, 0.18, { radial: 10, tile: 1.0 });
  rim.rotateX(Math.PI / 2);
  pushGeo(metal, rim, null);

  return { rubber: mergeList(rubber), metal: mergeList(metal) };
}

/**
 * Tire stack family.
 * Split out of world.js buildInstancedProps. `preview` is true only for the isolated
 * model-stage build, which uses the stage sample items instead of the map layout.
 */
function buildTireFamily(ctx, preview) {
  const L = ctx.data.layout;
  const M = ctx.materials;
  const { rubber, metal } = isPreview(ctx) ? tireGeoDetailed(makeRNG(47)) : tireGeoCheap();
  const tireItems = [];
  if (preview) {
    for (let i = 0; i < 4; i++) {
      tireItems.push({ x: 0, y: 0.16 + i * 0.3, z: 0, rx: Math.PI / 2, ry: (i % 4) * (Math.PI / 2), s: 1 });
    }
  } else for (const [x, z, n] of L.tireStacks) {
    for (let i = 0; i < n; i++) {
      tireItems.push({ x, y: 0.16 + i * 0.3, z, rx: Math.PI / 2, ry: (i % 4) * (Math.PI / 2), s: 1 });
    }
  }
  makeInstanced(ctx, rubber, M.rubber, tireItems, 'tires', 'metal', { seed: 47 });
  makeInstanced(ctx, metal, M.rust, tireItems, 'tire-rims', 'metal', { seed: 47 });
}
