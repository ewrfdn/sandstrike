import * as THREE from 'three';
import { matrixFor } from '../core.js';
import {
  boltGeo,
  cylGeo,
  latheGeo,
  plateGeo,
  put,
  rodGeo,
  sphereGeo,
  torusGeo,
  tubeGeo,
} from './detail.js';

export const meta = { id: 'well', kind: 'world', group: 'hero', label: '水井 · WELL' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const M = ctx.materials;
  const w = ctx.data.layout.hero.well;
  const cx = w.x;
  const cz = w.z;
  // The isolated model stage builds the showcase version; the in-game map keeps a
  // cheap studio-thumbnail level of detail on the same silhouette.
  const hi = ctx.stage === true;

  /** Ring of individual beveled stone blocks at radius `R`. */
  const stoneCourse = (y, R, h, d, n, phase, key = 'stone', jitterSeed = 1) => {
    const blockW = (Math.PI * 2 * R) / n - 0.014;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + phase;
      const k = hi ? 0.94 + ((i * 37 + jitterSeed * 13) % 11) * 0.011 : 1;
      const geo = plateGeo(blockW, h * k, d, { bevel: hi ? 0.016 : 0.01, tile: 1.9 });
      put(ctx, key, geo, cx + Math.sin(a) * R, y, cz + Math.cos(a) * R, 0, a, 0);
    }
  };

  /** Thin mortar joint between blocks of a course. */
  const mortarJoints = (y, R, h, d, n, phase) => {
    if (!hi) return;
    const jointW = (Math.PI * 2 * R) / n * 0.06;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + phase + Math.PI / n;
      const geo = plateGeo(jointW, h * 0.96, d * 0.9, { bevel: 0.004, tile: 1.6 });
      put(ctx, 'stoneDark', geo, cx + Math.sin(a) * R, y, cz + Math.cos(a) * R, 0, a, 0);
    }
  };

  // ------------------------------------------------------------------ plinth
  // recessed dark foundation + lower rubble course (kept from the original look)
  put(ctx, 'dark', cylGeo(2.28, 2.42, 0.22, { radial: hi ? 44 : 20, tile: 1.9 }), cx, 0.11, cz);
  stoneCourse(0.14, 2.36, 0.2, 0.34, hi ? 34 : 18, 0.0, 'stone', 2);

  if (hi) {
    // three ashlar courses + cap course, each block individually beveled
    stoneCourse(0.38, 2.06, 0.32, 0.22, 30, 0.0, 'stone', 3);
    stoneCourse(0.71, 2.06, 0.32, 0.22, 30, Math.PI / 30, 'stone', 5);
    mortarJoints(0.54, 2.07, 0.66, 0.21, 30, 0.0);
    stoneCourse(1.02, 2.03, 0.13, 0.38, 30, Math.PI / 30, 'stone', 7);
    // chamfered inner lining (visible over the rim / from inside)
    stoneCourse(0.62, 1.9, 0.92, 0.14, 24, 0.06, 'stoneDark', 11);
    // iron rim hoop + clamps
    put(ctx, 'metalDark', torusGeo(2.08, 0.036, { radialSeg: 8, tubularSeg: 40, tile: 0.8 }), cx, 1.12, cz, Math.PI / 2, 0, 0);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.15;
      put(ctx, 'metalDark', plateGeo(0.09, 0.16, 0.035, { bevel: 0.006, tile: 0.8 }),
        cx + Math.sin(a) * 2.09, 1.06, cz + Math.cos(a) * 2.09, 0, a, 0);
    }
    // iron straps + moss/grime wedges on the stonework
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2 + 0.3;
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const a = a0 + (k / 8) * (Math.PI / 5);
        pts.push(new THREE.Vector3(cx + Math.sin(a) * 2.13, 0.46 + (k % 2) * 0.02, cz + Math.cos(a) * 2.13));
      }
      put(ctx, 'metalDark', tubeGeo(pts, 0.022, { tubularSeg: 24, radialSeg: 5, tile: 0.9 }));
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.11;
      put(ctx, 'stoneDark', plateGeo(0.2, 0.1, 0.02, { bevel: 0.004, tile: 1.2 }),
        cx + Math.sin(a) * 2.19, 0.3 + ((i * 5) % 4) * 0.21, cz + Math.cos(a) * 2.19, 0, a, 0.1);
    }
  } else {
    // map LOD: the same silhouette with far fewer blocks
    stoneCourse(0.42, 2.07, 0.36, 0.24, 18, 0, 'stone', 3);
    stoneCourse(0.78, 2.07, 0.32, 0.24, 18, Math.PI / 18, 'stone', 5);
    stoneCourse(1.02, 2.04, 0.12, 0.36, 18, 0, 'stone', 7);
    put(ctx, 'metalDark', torusGeo(2.08, 0.04, { radialSeg: 6, tubularSeg: 18, tile: 0.8 }), cx, 1.12, cz, Math.PI / 2, 0, 0);
  }

  // inner shaft wall (dark), unchanged silhouette
  put(ctx, 'dark', cylGeo(1.8, 1.8, 1.2, { radial: hi ? 44 : 18, tile: 1.6, open: true }), cx, 0.6, cz);

  // water surface
  const waterGeo = new THREE.CircleGeometry(1.78, hi ? 56 : 20);
  const water = new THREE.Mesh(waterGeo, M.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, 0.86, cz);
  water.name = 'well-water';
  ctx.scene.add(water);
  ctx.objects.push(water);
  ctx.disposables.push(waterGeo);

  // ------------------------------------------------------------- winch frame
  const postSpots = [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]];
  for (const [ox, oz] of postSpots) {
    const px = cx + ox;
    const pz = cz + oz;
    put(ctx, 'wood', plateGeo(0.17, 3.3, 0.17, { bevel: 0.02, tile: 1.3 }), px, 1.671, pz);
    if (hi) {
      // iron collars + bolt heads on the outer faces
      for (const cy of [0.52, 1.9, 2.72]) {
        put(ctx, 'metalDark', plateGeo(0.2, 0.05, 0.2, { bevel: 0.006, tile: 0.8 }), px, cy, pz);
      }
      for (const s of [-1, 1]) {
        for (const cy of [0.2, 0.86, 2.4, 3.08]) {
          put(ctx, 'metal', boltGeo(0.016, 0.012),
            px + s * 0.086, cy, pz + s * 0.02, 0, 0, s * Math.PI / 2);
        }
      }
      // knee braces from each post up to the two head beams it carries
      const inX = ox > 0 ? -1 : 1;
      const inZ = oz > 0 ? -1 : 1;
      put(ctx, 'woodDark', rodGeo(px, 2.4, pz, px + inX * 0.52, 3.14, pz, 0.05, { radial: 6, tile: 1.2 }));
      put(ctx, 'woodDark', rodGeo(px, 2.4, pz, px, 3.14, pz + inZ * 0.52, 0.05, { radial: 6, tile: 1.2 }));
    }
  }

  // top beams (unchanged positions), doubled planks + iron straps when detailed
  for (const [ox, oz, along] of [[0, -1.7, 'x'], [0, 1.7, 'x'], [-1.7, 0, 'z'], [1.7, 0, 'z']]) {
    const bx = cx + ox;
    const bz = cz + oz;
    const bw = along === 'x' ? 3.7 : 0.18;
    const bd = along === 'x' ? 0.18 : 3.7;
    put(ctx, 'wood', plateGeo(bw, 0.18, bd, { bevel: 0.02, tile: 1.3 }), bx, 3.2, bz);
    if (hi) {
      put(ctx, 'woodDark', plateGeo(bw * 0.99, 0.05, bd * 1.24, { bevel: 0.012, tile: 1.2 }), bx, 3.09, bz);
      for (let i = 0; i < 6; i++) {
        const t = -0.42 + (i / 5) * 0.84;
        const bx2 = along === 'x' ? cx + t * 1.7 : bx;
        const bz2 = along === 'z' ? cz + t * 1.7 : bz;
        put(ctx, 'metal', boltGeo(0.018, 0.014), bx2, 3.2, bz2, along === 'x' ? Math.PI / 2 : 0, 0, along === 'x' ? 0 : Math.PI / 2);
      }
    }
  }

  // ------------------------------------------------------- winch, rope, bucket
  const drumX = cx;
  const drumY = 2.55;
  const drumZ = cz - 1.2;
  if (hi) {
    // turned drum with staves and iron hoops
    put(ctx, 'wood', latheGeo([[0.02, -1.2], [0.17, -1.2], [0.19, -1.06], [0.19, 1.06], [0.17, 1.2], [0.02, 1.2]], { segments: 24, tile: 1.2 }),
      drumX, drumY, drumZ, 0, 0, Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      put(ctx, 'woodDark', plateGeo(2.3, 0.05, 0.028, { bevel: 0.008, tile: 1.1 }),
        drumX, drumY + Math.sin(a) * 0.195, drumZ + Math.cos(a) * 0.195, a, 0, 0);
    }
    for (const ox of [-0.92, 0, 0.92]) {
      put(ctx, 'metalDark', torusGeo(0.2, 0.022, { radialSeg: 8, tubularSeg: 20, tile: 0.8 }), drumX + ox, drumY, drumZ, 0, Math.PI / 2, 0);
    }
    // axle through both posts, end caps
    put(ctx, 'metal', rodGeo(cx - 1.78, drumY, drumZ, cx + 1.78, drumY, drumZ, 0.048, { radial: 8, tile: 1.0 }));
    for (const s of [-1, 1]) {
      put(ctx, 'metalDark', cylGeo(0.055, 0.055, 0.06, { radial: 16, tile: 0.7 }), cx + s * 1.78, drumY, drumZ, 0, 0, Math.PI / 2);
    }
    // crank handle on the +X side
    put(ctx, 'metal', rodGeo(cx + 1.78, drumY, drumZ, cx + 1.88, drumY - 0.42, drumZ, 0.03, { radial: 8, tile: 1.0 }));
    put(ctx, 'metal', rodGeo(cx + 1.88, drumY - 0.42, drumZ, cx + 1.88, drumY - 0.42, drumZ + 0.34, 0.028, { radial: 8, tile: 1.0 }));
    put(ctx, 'woodDark', latheGeo([[0.012, 0], [0.042, 0.02], [0.045, 0.1], [0.04, 0.18], [0.015, 0.2]], { segments: 16, tile: 0.9 }),
      cx + 1.88, drumY - 0.42, drumZ + 0.28, Math.PI / 2, 0, 0);
  } else {
    put(ctx, 'wood', cylGeo(0.18, 0.18, 2.4, { radial: 12, tile: 1.2 }), drumX, drumY, drumZ, 0, 0, Math.PI / 2);
    for (const ox of [-0.9, 0.9]) {
      put(ctx, 'metalDark', torusGeo(0.19, 0.03, { radialSeg: 6, tubularSeg: 12, tile: 0.8 }), drumX + ox, drumY, drumZ, 0, Math.PI / 2, 0);
    }
    put(ctx, 'metal', rodGeo(cx - 1.78, drumY, drumZ, cx + 1.78, drumY, drumZ, 0.045, { radial: 6, tile: 1.0 }));
  }

  // rope: coils on the drum + the hanging run down to the bucket
  if (hi) {
    for (let i = 0; i < 5; i++) {
      put(ctx, 'rust', torusGeo(0.205, 0.022, { radialSeg: 6, tubularSeg: 18, tile: 0.7 }), drumX - 0.7 + i * 0.34, drumY, drumZ, 0, Math.PI / 2, 0);
    }
    const ropePts = [
      new THREE.Vector3(drumX + 0.2, drumY - 0.1, drumZ),
      new THREE.Vector3(drumX + 0.24, drumY - 0.6, drumZ + 0.02),
      new THREE.Vector3(drumX + 0.24, 1.42, drumZ),
      new THREE.Vector3(drumX + 0.22, 1.12, drumZ),
    ];
    put(ctx, 'rust', tubeGeo(ropePts, 0.024, { tubularSeg: 20, radialSeg: 6, tile: 0.8 }));
    // coil of spare rope resting on the rim
    for (let i = 0; i < 3; i++) {
      put(ctx, 'rust', torusGeo(0.16 - i * 0.012, 0.022, { radialSeg: 6, tubularSeg: 16, tile: 0.7 }),
        cx + 1.5, 1.24 + i * 0.045, cz + 0.5, Math.PI / 2, 0, 0);
    }
  } else {
    put(ctx, 'rust', cylGeo(0.025, 0.025, 1.9, { radial: 6, tile: 0.8 }), drumX, 1.7, drumZ);
  }

  // bucket
  const bkX = drumX;
  const bkY = 0.85;
  const bkZ = drumZ;
  if (hi) {
    put(ctx, 'rust', latheGeo([[0.02, -0.17], [0.17, -0.17], [0.2, -0.1], [0.22, 0.17], [0.2, 0.17], [0.185, 0.16]], { segments: 24, tile: 1.0 }),
      bkX, bkY, bkZ);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      put(ctx, 'woodDark', plateGeo(0.045, 0.3, 0.02, { bevel: 0.006, tile: 0.9 }),
        bkX + Math.sin(a) * 0.21, bkY + 0.01, bkZ + Math.cos(a) * 0.21, 0, a, 0);
    }
    for (const oy of [-0.12, 0.1]) {
      put(ctx, 'metalDark', torusGeo(oy < 0 ? 0.196 : 0.216, 0.014, { radialSeg: 6, tubularSeg: 20, tile: 0.6 }), bkX, bkY + oy, bkZ, Math.PI / 2, 0, 0);
    }
    const bail = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (i / 10);
      bail.push(new THREE.Vector3(bkX + Math.cos(a) * 0.21, bkY + 0.12 + Math.sin(a) * 0.17, bkZ));
    }
    put(ctx, 'metalDark', tubeGeo(bail, 0.012, { tubularSeg: 16, radialSeg: 5, tile: 0.6 }));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      put(ctx, 'metal', boltGeo(0.012, 0.008), bkX + Math.sin(a) * 0.215, bkY - 0.06, bkZ + Math.cos(a) * 0.215, 0, a, 0);
    }
  } else {
    put(ctx, 'rust', latheGeo([[0.02, -0.17], [0.18, -0.17], [0.22, 0.17], [0.02, 0.17]], { segments: 12, tile: 1.0 }), bkX, bkY, bkZ);
  }

  // --------------------------------------------------- extra yard greebles
  if (hi) {
    // pulley block hanging from the -Z head beam, above the drum
    put(ctx, 'woodDark', plateGeo(0.3, 0.12, 0.14, { bevel: 0.012, tile: 1.2 }), drumX, 3.02, drumZ + 0.24);
    put(ctx, 'metalDark', latheGeo(
      [[0.03, -0.03], [0.1, -0.03], [0.115, 0], [0.1, 0.03], [0.03, 0.03]],
      { segments: 20, tile: 0.7 }
    ), drumX, 2.92, drumZ + 0.24, 0, 0, Math.PI / 2);
    put(ctx, 'metal', rodGeo(drumX, 2.98, drumZ + 0.24, drumX, 3.2, drumZ + 0.24, 0.018, { radial: 6, tile: 0.8 }));
    for (const s of [-1, 1]) {
      put(ctx, 'metal', boltGeo(0.016, 0.012), drumX + s * 0.11, 3.02, drumZ + 0.3, Math.PI / 2, 0, 0);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.4;
      put(ctx, 'stoneDark', plateGeo(0.09, 0.03, 0.05, { bevel: 0.004, tile: 1.2 }),
        cx + Math.sin(a) * (2.4 + (i % 3) * 0.12), 0.02, cz + Math.cos(a) * (2.4 + (i % 3) * 0.12), 0, a, 0.1);
    }
    // low timber stool for the water jars
    const stoolX = cx + 2.75;
    const stoolZ = cz + 1.55;
    put(ctx, 'wood', plateGeo(0.7, 0.07, 0.42, { bevel: 0.012, tile: 1.2 }), stoolX, 0.4, stoolZ);
    put(ctx, 'woodDark', plateGeo(0.66, 0.05, 0.38, { bevel: 0.01, tile: 1.1 }), stoolX, 0.34, stoolZ);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      put(ctx, 'woodDark', rodGeo(stoolX + sx * 0.28, 0, stoolZ + sz * 0.16, stoolX + sx * 0.26, 0.36, stoolZ + sz * 0.15, 0.03, { radial: 6, tile: 1.0 }));
    }
  }

  // ------------------------------------------------------------- water jars
  const jars = [[2.6, 1.2], [2.9, 0.2]];  jars.forEach(([ox, oz], idx) => {
    const jx = cx + ox;
    const jz = cz + oz;
    const scale = idx === 0 ? 1 : 0.86;
    const hh = 0.55 * scale;
    put(ctx, 'rust', latheGeo(
      [[0.02, 0], [0.16 * scale, 0], [0.24 * scale, hh * 0.33], [0.2 * scale, hh * 0.72], [0.155 * scale, hh * 0.92], [0.185 * scale, hh], [0.02, hh]],
      { segments: hi ? 28 : 12, tile: 0.9 }
    ), jx, 0.02, jz);
    if (hi) {
      put(ctx, 'rust', torusGeo(0.17 * scale, 0.014 * scale, { radialSeg: 6, tubularSeg: 18, tile: 0.6 }), jx, 0.02 + hh * 0.94, jz, Math.PI / 2, 0, 0);
      put(ctx, 'rust', plateGeo(0.19 * scale, 0.02, 0.19 * scale, { bevel: 0.006, tile: 0.7 }), jx, 0.02 + hh + 0.012, jz);
      put(ctx, 'rust', sphereGeo(0.03 * scale, { segW: 10, segH: 8, tile: 0.4 }), jx, 0.02 + hh + 0.04, jz);
    }
  });

  // shell canopy (cloth), lantern, practical light and the grime decal: unchanged
  ctx.req.awnings.push({ type: 'canopy', x: cx, y: 3.32, z: cz, w: 4.0, d: 4.0, key: 'awning', pitch: 0.06, ry: 0, postH: 3.3, posts: [] });
  ctx.req.lanterns.push({ x: cx + 1.2, y: 2.86, z: cz + 1.7, kind: 'warm', size: 0.3, hang: 3.3 });
  ctx.req.lights.push({ x: cx, y: 2.9, z: cz, color: 0xffa050, intensity: 7, distance: 8, kind: 'flicker' });
  ctx.req.decals.push({ x: cx + 2.9, y: 0.03, z: cz + 1.0, rx: -Math.PI / 2, ry: 0, cell: 'grime', w: 2.6, h: 2.6, opacity: 0.5 });
  void M;
  void matrixFor;
}
