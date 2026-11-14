/**
 * Extended mag (magazine capacity) — dropped-item model (`loot-mag`).
 *
 * Art pass: a curved rifle magazine (banana mag silhouette extruded from a
 * quadratic centerline), two glowing cyan caliber bands and two brass
 * cartridges poking out of the feed lips. Geometry/material keys and mesh
 * transforms are authored here; gameplay stays in src/enemies.js.
 */
import * as THREE from 'three';
import { getLootMaterials } from './shared.js';

/** Model-viewer metadata (one entry in the unified catalog). */
export const meta = { id: 'loot-mag', kind: 'world', group: 'loot', label: '弹匣扩容 · EXTENDED MAG', lift: true };

const TOP = [0, 0.215];
// Bows ~3.5 cm off the top->bottom chord so the silhouette reads as a curved
// (banana) rifle magazine instead of a straight slab.
const CTRL = [0.125, 0.013];
const BOTTOM = [0.115, -0.225];
const HALF_WIDTH_TOP = 0.085;
const HALF_WIDTH_BOTTOM = 0.072;

/** Sample the quadratic magazine centerline, its normal angle and half width. */
function centerlineAt(t) {
  const x = (1 - t) * (1 - t) * TOP[0] + 2 * (1 - t) * t * CTRL[0] + t * t * BOTTOM[0];
  const y = (1 - t) * (1 - t) * TOP[1] + 2 * (1 - t) * t * CTRL[1] + t * t * BOTTOM[1];
  const dx = 2 * (1 - t) * (CTRL[0] - TOP[0]) + 2 * t * (BOTTOM[0] - CTRL[0]);
  const dy = 2 * (1 - t) * (CTRL[1] - TOP[1]) + 2 * t * (BOTTOM[1] - CTRL[1]);
  const len = Math.hypot(dx, dy) || 1;
  return {
    x,
    y,
    // perpendicular (normal) angle of the centerline: n = (-ty, tx)
    angle: Math.atan2(dx / len, -dy / len),
    halfWidth: HALF_WIDTH_TOP + (HALF_WIDTH_BOTTOM - HALF_WIDTH_TOP) * t,
  };
}

/** Closed outline of the curved magazine in the XY plane. */
function magazineShape() {
  const steps = 12;
  const left = [];
  const right = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = centerlineAt(t);
    const nx = Math.cos(p.angle);
    const ny = Math.sin(p.angle);
    left.push([p.x + nx * p.halfWidth, p.y + ny * p.halfWidth]);
    right.push([p.x - nx * p.halfWidth, p.y - ny * p.halfWidth]);
  }
  const shape = new THREE.Shape();
  shape.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) shape.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) shape.lineTo(right[i][0], right[i][1]);
  shape.closePath();
  return shape;
}

/** Magazine geometries: extruded body, feed lips, glow bands, floor plate, cartridges. */
export function createGeometries() {
  const body = new THREE.ExtrudeGeometry(magazineShape(), {
    depth: 0.125,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 4,
  });
  body.translate(0, 0, -0.0625);
  return {
    magBody: body,
    magFeedLips: new THREE.BoxGeometry(0.175, 0.018, 0.145),
    magFloorPlate: new THREE.BoxGeometry(0.17, 0.032, 0.155),
    magBand: new THREE.BoxGeometry(0.175, 0.018, 0.152),
    magRib: new THREE.BoxGeometry(0.14, 0.016, 0.01),
    magCartridgeCase: new THREE.CylinderGeometry(0.018, 0.018, 0.085, 8),
    magCartridgeTip: new THREE.ConeGeometry(0.018, 0.055, 8),
  };
}

/**
 * Build the magazine meshes onto `parent` and return them in creation order.
 * @param {THREE.Object3D} parent
 * @param {{ geos: Object<string, THREE.BufferGeometry>, mats: Object<string, THREE.Material> }} lib
 * @returns {THREE.Mesh[]}
 */
export function buildItem(parent, { geos, mats }) {
  const meshes = [];
  const add = (geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material);
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  // curved magazine body (lighter painted steel so it reads against the sand)
  add(geos.magBody, mats.magShell);

  // thin feed-lip rim at the top opening
  const top = centerlineAt(0);
  const topNormal = [Math.cos(top.angle), Math.sin(top.angle)];
  const feed = add(geos.magFeedLips, mats.body);
  feed.position.set(
    top.x + topNormal[0] * -0.006,
    top.y + topNormal[1] * -0.006,
    0,
  );
  feed.rotation.z = top.angle;

  // floor plate at the bottom of the magazine
  const floor = centerlineAt(1);
  const floorPlate = add(geos.magFloorPlate, mats.magShell);
  floorPlate.position.set(
    floor.x + Math.sin(floor.angle) * 0.012,
    floor.y - Math.cos(floor.angle) * 0.012,
    0,
  );
  floorPlate.rotation.z = floor.angle;

  // two glowing caliber bands across the magazine
  for (const t of [0.3, 0.72]) {
    const p = centerlineAt(t);
    const band = add(geos.magBand, mats.mag);
    band.position.set(p.x, p.y, 0);
    band.rotation.z = p.angle;
  }

  // stamped reinforcement ribs on the FRONT face (-Z), flush with the panel
  for (const t of [0.4, 0.56, 0.84]) {
    const p = centerlineAt(t);
    const rib = add(geos.magRib, mats.magMetal);
    rib.position.set(p.x, p.y, -0.066);
    rib.rotation.z = p.angle;
  }

  // two brass rounds seated in the top opening, tips protruding toward FRONT -Z
  for (const offset of [-0.032, 0.032]) {
    const bx = top.x + topNormal[0] * offset;
    const by = top.y + topNormal[1] * offset + 0.012;
    const cartridge = add(geos.magCartridgeCase, mats.brass);
    cartridge.position.set(bx, by, 0);
    cartridge.rotation.x = Math.PI / 2;
    const tip = add(geos.magCartridgeTip, mats.brassDark);
    tip.position.set(bx, by, -0.07);
    tip.rotation.x = -Math.PI / 2;
  }

  return meshes;
}

/** Stage preview builder: fresh geometries + the shared material set. */
export function build(ctx) {
  return buildItem(ctx.scene, { geos: createGeometries(), mats: getLootMaterials() });
}
