import * as THREE from 'three';
import { TAU, matrixFor, boxBatch, rodBetween } from '../core.js';

export const meta = { id: 'windmill', kind: 'world', group: 'hero', label: '风车 · WINDMILL' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const w = ctx.data.layout.hero.windmill;
  const B = ctx.batcher;
  // legs on the cardinal axes: the splayed silhouette plus the axis-aligned collision
  // box means diagonal legs would leave the box faces without geometry behind them
  const legTopR = 0.3;
  const legBaseR = 0.95;
  const legTopY = 6.3;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    rodBetween(
      ctx, 'wood',
      w.x + Math.cos(a) * legBaseR, 0, w.z + Math.sin(a) * legBaseR,
      w.x + Math.cos(a) * legTopR, legTopY, w.z + Math.sin(a) * legTopR,
      0.1, 5, 1.3
    );
  }
  // horizontal bracing rings between adjacent legs at three heights
  for (const y of [1.6, 3.4, 5.2]) {
    const r = legBaseR + ((legTopR - legBaseR) * y) / legTopY;
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * TAU;
      const a1 = ((i + 1) / 4) * TAU;
      rodBetween(ctx, 'wood', w.x + Math.cos(a0) * r, y, w.z + Math.sin(a0) * r, w.x + Math.cos(a1) * r, y, w.z + Math.sin(a1) * r, 0.055, 4);
    }
  }
  // platform + hub + tail
  boxBatch(ctx, 'wood', w.x, 6.35, w.z, 1.9, 0.18, 1.9, { tile: 1.4 });
  const hub = new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8);
  ctx.batcher.add('metalDark', hub, matrixFor(w.x, 6.65, w.z + 0.85, Math.PI / 2));
  hub.dispose();
  // tail vane panel, now carried by a real boom off the platform (it used to float)
  boxBatch(ctx, 'sheet', w.x, 6.6, w.z - 1.6, 0.1, 0.7, 1.5, { tile: 1.2 });
  boxBatch(ctx, 'wood', w.x, 6.55, w.z - 1.28, 0.12, 0.12, 0.78, { tile: 1.2 });
  for (const s of [-1, 1]) {
    rodBetween(ctx, 'wood', w.x + s * 0.72, 6.44, w.z - 0.88, w.x + s * 0.05, 6.54, w.z - 1.58, 0.045, 4);
  }
  // head axle from the hub to the rotor plane (sails now visibly attach)
  rodBetween(ctx, 'metalDark', w.x, 6.65, w.z + 0.9, w.x, 6.65, w.z + 1.18, 0.06, 6);

  // rotating blade assembly
  const rotor = new THREE.Group();
  rotor.position.set(w.x, 6.65, w.z + 1.15);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Group();
    blade.rotation.z = (i / 4) * TAU;
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.7, 0.1), ctx.materials.wood);
    spar.position.y = 1.35;
    spar.castShadow = true;
    blade.add(spar);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 2.25), ctx.materials.awning);
    sail.position.set(0, 1.4, 0.06);
    sail.castShadow = true;
    blade.add(sail);
    // sail battens
    for (let b = 0; b < 3; b++) {
      const batten = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.04), ctx.materials.woodDark);
      batten.position.set(0, 0.6 + b * 0.75, 0.1);
      blade.add(batten);
    }
    rotor.add(blade);
  }
  ctx.scene.add(rotor);
  ctx.objects.push(rotor);
  ctx.animated.push({ kind: 'rotor', obj: rotor, speed: 0.22, axis: 'z' });
  // lantern hangs from the platform underside instead of floating in mid-air
  ctx.req.lanterns.push({ x: w.x + 0.55, y: 5.72, z: w.z + 0.55, kind: 'warm', size: 0.2, hang: 6.26 });
}
