/**
 * SANDSTRIKE // sandstorm protocol — static geometry batcher.
 *
 * Split verbatim out of src/world.js (class StaticBatcher). Accumulates
 * transformed geometry per material key and flushes it as one mesh per key —
 * the main draw-call reduction tool for static architecture.
 */
import * as THREE from 'three';
import { transformed, mergeGeometries, bakeVertexAO } from '../models/core.js';

/**
 * Accumulates transformed geometry per material key and flushes it as one mesh
 * per key — the main draw-call reduction tool for static architecture.
 */
export class StaticBatcher {
  constructor() {
    this.groups = new Map();
  }

  /** @param {string} key material key @param {THREE.BufferGeometry} geo @param {THREE.Matrix4} matrix */
  add(key, geo, matrix, opts = {}) {
    const group = this.ensure(key, opts);
    const g = transformed(geo, matrix);
    if (opts.uvScale) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * opts.uvScale, uv.getY(i) * opts.uvScale);
    }
    if (opts.uvOffset) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + opts.uvOffset[0], uv.getY(i) + opts.uvOffset[1]);
    }
    if (opts.surface && !group.surface) group.surface = opts.surface;
    group.geos.push(g);
    return g;
  }

  ensure(key, opts = {}) {
    let group = this.groups.get(key);
    if (!group) {
      group = {
        key,
        geos: [],
        material: opts.material ?? null,
        castShadow: opts.castShadow ?? true,
        receiveShadow: opts.receiveShadow ?? true,
        collide: opts.collide ?? true,
        surface: opts.surface ?? null,
        bakeAO: opts.bakeAO ?? false,
        visible: opts.visible !== false,
      };
      this.groups.set(key, group);
    }
    if (opts.material) group.material = opts.material;
    return group;
  }

  flush(parent, materials, collideMeshes) {
    const meshes = [];
    for (const group of this.groups.values()) {
      if (group.geos.length === 0) continue;
      if (group.bakeAO) {
        for (const g of group.geos) bakeVertexAO(g, { seed: group.geos.length });
      }
      const merged = mergeGeometries(group.geos);
      if (!merged) continue;
      const material = group.material || materials[group.key];
      if (!material) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `batch:${group.key}`;
      mesh.castShadow = group.castShadow;
      mesh.receiveShadow = group.receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (group.surface) mesh.userData.surface = group.surface;
      // remember the batch collidability so the raycast target list can exclude
      // decorative batch meshes (dark window recesses, glass, glow, coals)
      mesh.userData.collide = group.collide;
      parent.add(mesh);
      meshes.push(mesh);
      if (group.collide && collideMeshes && group.surface) collideMeshes.push(mesh);
      for (const g of group.geos) g.dispose();
      group.geos.length = 0;
    }
    return meshes;
  }
}

export default StaticBatcher;
