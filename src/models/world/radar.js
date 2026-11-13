import * as THREE from 'three';
import { TAU, matrixFor, boxGeometryWorldUV, boxBatch, cylinderBatch, rodBetween } from '../core.js';

export const meta = { id: 'radar', kind: 'world', group: 'hero', label: '雷达塔 · RADAR MAST' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const r = ctx.data.layout.hero.radar;
  // concrete pad + lattice tower
  const pad = new THREE.CylinderGeometry(1.5, 1.65, 0.5, 10);
  ctx.batcher.add('stone', pad, matrixFor(r.x, 0.25, r.z));
  pad.dispose();
  const H = 11.5;
  const legOff = 0.9;
  // legs on the cardinal axes so the axis-aligned collider faces always have a leg
  // behind them (diagonal lattice legs made the collider read as an air wall)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    const x0 = Math.cos(a) * legOff;
    const z0 = Math.sin(a) * legOff;
    const x1 = Math.cos(a) * 0.28;
    const z1 = Math.sin(a) * 0.28;
    const g = boxGeometryWorldUV(0.11, H, 0.11, 1.2);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(r.x + (x0 + x1) / 2, H / 2, r.z + (z0 + z1) / 2),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan2(z1 - z0, H) * -1, 0, Math.atan2(x1 - x0, H), 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    ctx.batcher.add('metalDark', g, m);
    g.dispose();
  }
  for (let i = 0; i < 7; i++) {
    const y = 1.0 + i * 1.6;
    const s = 1 - i * 0.1;
    const g = boxGeometryWorldUV(legOff * 2 * s, 0.07, 0.07, 1);
    for (const dir of [0, 1]) {
      const m = matrixFor(r.x, y, r.z, 0, (dir * Math.PI) / 2);
      ctx.batcher.add('metalDark', g, m);
    }
    g.dispose();
  }
  // ---- guy wires: mast ring → concrete ground anchors (both ends used to float) ----
  const mastRingY = 10.4;
  const anchorR = 3.3;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const ax = r.x + Math.cos(a) * anchorR;
    const az = r.z + Math.sin(a) * anchorR;
    rodBetween(ctx, 'metalDark', r.x + Math.cos(a) * 0.5, mastRingY, r.z + Math.sin(a) * 0.5, ax, 0.16, az, 0.022, 4);
    // low anchor footing (0.2 m — walked over, no collider required)
    boxBatch(ctx, 'stoneDark', ax, 0.1, az, 0.44, 0.2, 0.44, { tile: 0.9 });
    boxBatch(ctx, 'metalDark', ax, 0.24, az, 0.1, 0.12, 0.1, { tile: 0.6 });
  }
  // ---- yoke / neck carrying the dish, seated on the lattice top ----
  cylinderBatch(ctx, 'metalDark', r.x, H + 0.3, r.z, 0.09, 0.16, 0.62, 8);
  boxBatch(ctx, 'metalDark', r.x, H + 0.62, r.z, 0.5, 0.08, 0.5, { tile: 0.8 });
  // ---- dish assembly: a shallow lathe bowl (double-sided so the concave face reads),
  //      feed horn seated on the bowl axis + emissive receiver beacon at its tip ----
  const dishGroup = new THREE.Group();
  dishGroup.position.set(r.x, H + 0.66, r.z);
  const dishMat = ctx.materials.metalDark.clone();
  dishMat.side = THREE.DoubleSide;
  dishMat.name = 'radar-dish';
  ctx.materialsCustom.push(dishMat);
  const dishProfile = [
    [0.0, 0.34], [0.3, 0.3], [0.62, 0.18], [0.92, 0.0], [1.16, -0.2], [1.24, -0.3],
    [1.22, -0.36], [1.16, -0.32], [0.96, -0.14], [0.68, 0.02], [0.32, 0.16], [0.0, 0.2],
  ].map(([px, py]) => new THREE.Vector2(px, py));
  const dishGeo = new THREE.LatheGeometry(dishProfile, 22);
  const dish = new THREE.Mesh(dishGeo, dishMat);
  const dishDir = new THREE.Vector3(-0.8, 0.25, 0.55).normalize();
  const dishQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dishDir);
  dish.quaternion.copy(dishQuat);
  dish.position.y = 0.35;
  dish.castShadow = true;
  dishGroup.add(dish);
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.045, 0.42, 8), ctx.materials.rust);
  horn.quaternion.copy(dishQuat);
  horn.position.set(0, 0.35, 0).addScaledVector(dishDir, 0.55);
  dishGroup.add(horn);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), ctx.materials.glowCyan);
  beacon.position.set(0, 0.35, 0).addScaledVector(dishDir, 0.82);
  dishGroup.add(beacon);
  ctx.scene.add(dishGroup);
  ctx.objects.push(dishGroup, horn, dish);
  ctx.animated.push({ kind: 'radar', obj: dishGroup, speed: 0.35, material: ctx.materials.glowCyan, beacon });
  ctx.req.lanterns.push({ x: r.x - 0.7, y: H + 0.9, z: r.z + 0.5, kind: 'cyan', size: 0.18 });
}
