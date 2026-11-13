import * as THREE from 'three';
import { TAU, matrixFor, boxGeometryWorldUV, cylinderWorldUV } from '../core.js';

export const meta = { id: 'truck', kind: 'world', group: 'hero', label: '卡车 · CARGO TRUCK' };

/** Preview builder (stage/WebUI): applies the stage layout, then builds the model. */
export function build(ctx) {
  buildWorld(ctx);
}

/** Map assembly builder: builds every instance from ctx.data.layout. */
export function buildWorld(ctx) {
  const t = ctx.data.layout.hero.truck;
  const base = matrixFor(t.x, 0, t.z, 0, t.yaw, 0);
  const UNIT = new THREE.Vector3(1, 1, 1);
  const _e = new THREE.Euler();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _off = new THREE.Matrix4();
  /** Local-space placement: T(lx,ly,lz) * R(rx,ry,rz), then the truck's base transform. */
  const place = (key, geo, lx, ly, lz, rx = 0, ry = 0, rz = 0) => {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _v.set(lx, ly, lz);
    _m.compose(_v, _q, UNIT);
    _m.premultiply(base);
    ctx.batcher.add(key, geo, _m);
    geo.dispose();
  };
  const box = (key, lx, ly, lz, w, h, d, tile = 1.6, rx = 0, ry = 0, rz = 0) =>
    place(key, boxGeometryWorldUV(w, h, d, tile), lx, ly, lz, rx, ry, rz);
  const cyl = (key, lx, ly, lz, rTop, rBottom, len, radial, rx = 0, ry = 0, rz = 0) =>
    place(key, cylinderWorldUV(rTop, rBottom, len, radial, 1.8), lx, ly, lz, rx, ry, rz);
  /** Rod between two local points (ropes, wipers, exhaust tip, antenna). */
  const rod = (key, ax, ay, az, bx, by, bz, radius, radial = 6) => {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    _m.compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, UNIT);
    _m.premultiply(base);
    const g = cylinderWorldUV(radius, radius, len, radial, 1.8);
    ctx.batcher.add(key, g, _m);
    g.dispose();
  };
  // Wheels: the axle must run ACROSS the truck (local Z). A cylinder's axis is Y,
  // so rotate +90 deg about X to lay it on Z and then apply the steering angle
  // about Y. (The old build rotated about Z, pointing the axles along the truck:
  // wheels read as full discs from the front and planks from the side.)
  const wheel = (lx, lz, r = 0.52, steer = 0, cy = null, axle = true) => {
    const y = cy === null ? r : cy;
    const center = new THREE.Vector3(lx, y, lz);
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), steer);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    const at = (key, geo, ox = 0, oy = 0, oz = 0) => {
      _m.compose(center, _q, UNIT);
      _off.makeTranslation(ox, oy, oz);
      _m.multiply(_off);
      _m.premultiply(base);
      ctx.batcher.add(key, geo, _m);
      geo.dispose();
    };
    at('rubber', cylinderWorldUV(r, r, 0.34, 16, 1.4));
    at('metalDark', cylinderWorldUV(r * 0.46, r * 0.46, 0.36, 10, 1.0));
    at('metal', cylinderWorldUV(r * 0.2, r * 0.2, 0.38, 8, 0.8));
    const side = lz >= 0 ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      at('metalDark', boxGeometryWorldUV(0.05, 0.05, 0.045, 1),
        Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, side * 0.185);
    }
    if (axle) cyl('metalDark', lx, r, 0, 0.062, 0.062, 2.36, 8, Math.PI / 2);
  };

  // ------------------------------------------------------------------ chassis
  for (const z of [-0.78, 0.78]) box('metalDark', -0.2, 0.8, z, 6.55, 0.16, 0.14, 1.4);
  for (const x of [-3.0, -2.0, -0.55, 0.9, 2.1]) box('metalDark', x, 0.8, 0, 0.14, 0.12, 1.62, 1.2);
  for (const x of [2.55, -1.55, -2.65]) box('metalDark', x, 0.62, 0, 0.3, 0.14, 1.5, 1.2);
  for (const x of [2.55, -1.55, -2.65]) for (const z of [-0.86, 0.86]) {
    box('metalDark', x, 0.68, z, 1.0, 0.07, 0.05, 1.1);      // leaf spring
    box('metalDark', x + 0.44, 0.74, z, 0.08, 0.2, 0.07, 1); // shackle
    box('metalDark', x - 0.44, 0.74, z, 0.08, 0.2, 0.07, 1);
  }

  // ---------------------------------------------------------------- front end
  box('metal', 2.72, 1.5, 0, 1.25, 0.74, 2.12, 1.4);                // hood
  box('metalDark', 3.38, 1.44, 0, 0.1, 0.78, 1.92, 1.2);            // grille panel
  for (let i = 0; i < 5; i++) box('dark', 3.44, 1.12 + i * 0.15, 0, 0.04, 0.05, 1.72, 1);
  for (const z of [-0.76, 0.76]) {
    box('metalDark', 3.4, 1.5, z, 0.12, 0.32, 0.4, 1);              // headlight bezel
    box('glowWarm', 3.47, 1.5, z, 0.04, 0.2, 0.26, 1);              // headlight lens
    box('rust', 3.44, 1.18, z * 1.28, 0.05, 0.1, 0.16, 1);          // turn signal
  }
  box('rust', 3.5, 0.64, 0, 0.3, 0.3, 2.45, 1.2);                   // front bumper
  for (const z of [-0.62, 0.62]) box('metalDark', 3.28, 0.82, z, 0.24, 0.34, 0.12, 1);
  for (const z of [-0.5, 0.5]) box('metalDark', 3.63, 0.55, z, 0.12, 0.16, 0.16, 1);  // tow hooks
  box('metal', 3.665, 0.82, 0, 0.02, 0.24, 0.62, 1);                // plate blank
  for (const z of [-1.19, 1.19]) {
    box('metal', 2.55, 1.14, z, 1.3, 0.06, 0.46, 1.3);              // front fender
    box('metal', 3.1, 1.02, z, 0.5, 0.05, 0.46, 1.2, 0, 0, -0.45);
    box('metal', 2.0, 1.02, z, 0.5, 0.05, 0.46, 1.2, 0, 0, 0.45);
    box('metalDark', 2.55, 1.075, z * 1.19, 1.3, 0.12, 0.035, 1);   // outer fender lip
    box('metalDark', 1.72, 0.8, z, 0.08, 0.22, 0.4, 1);             // fender brace
    box('rubber', 1.6, 0.6, z, 0.04, 0.44, 0.4, 1.2);               // mud flap
  }

  // ------------------------------------------------------------------ cab
  box('metal', 1.25, 1.95, 0, 1.95, 1.6, 2.24, 1.4);                // cab body
  box('metal', 1.25, 2.79, 0, 2.0, 0.1, 2.3, 1.4);                  // roof lip
  for (const z of [-0.5, 0, 0.5]) box('glowWarm', 2.1, 2.86, z, 0.12, 0.05, 0.1, 1);
  box('metalDark', 2.28, 2.66, 0, 0.16, 0.05, 1.9, 1.2);            // sun visor
  box('glass', 2.25, 2.2, 0, 0.05, 0.75, 1.8, 1);                   // windshield
  box('dark', 2.22, 2.2, 0, 0.02, 0.66, 1.68, 1);
  box('metalDark', 2.27, 2.6, 0, 0.06, 0.06, 1.86, 1.2);            // windshield frame
  box('metalDark', 2.27, 1.8, 0, 0.06, 0.06, 1.86, 1.2);
  for (const z of [-0.92, 0.92]) box('metalDark', 2.27, 2.2, z, 0.06, 0.8, 0.06, 1);
  for (const z of [-0.45, 0.25]) rod('dark', 2.3, 1.9, z, 2.3, 2.14, z + 0.3, 0.012, 5);  // wipers
  for (const z of [-1.13, 1.13]) {
    const out = Math.sign(z) * 0.02;
    box('glass', 1.35, 2.24, z, 1.2, 0.62, 0.04, 1);                // door glass
    box('metalDark', 1.35, 2.57, z, 1.32, 0.05, 0.06, 1.1);         // window frame
    box('metalDark', 1.35, 1.9, z, 1.32, 0.05, 0.06, 1.1);
    box('metalDark', 0.78, 2.24, z, 0.05, 0.6, 0.06, 1);
    box('metalDark', 1.98, 2.24, z, 0.05, 0.6, 0.06, 1);
    box('dark', 0.45, 1.95, z + out * 0.3, 0.035, 1.45, 0.03, 1);   // door seam
    box('metalDark', 1.35, 1.42, z + out * 0.5, 1.5, 0.06, 0.03, 1); // rub strip
    box('metalDark', 0.5, 2.12, z + out * 0.5, 0.06, 0.12, 0.05, 1); // upper hinge
    box('metalDark', 0.5, 1.6, z + out * 0.5, 0.06, 0.12, 0.05, 1);  // lower hinge
    box('metalDark', 0.62, 1.88, z + out, 0.16, 0.05, 0.04, 1);     // handle
    box('metalDark', 1.02, 0.72, z * 1.02, 0.62, 0.08, 0.28, 1.1);  // side step
    box('metalDark', 1.02, 0.9, z * 1.02, 0.06, 0.3, 0.2, 1);
  }
  box('glass', 0.28, 2.28, 0, 0.04, 0.5, 1.4, 1);                   // rear cab window
  box('dark', 0.31, 2.28, 0, 0.02, 0.42, 1.28, 1);
  for (const z of [-1.3, 1.3]) {
    rod('metalDark', 2.12, 2.42, z * 0.88, 2.16, 2.5, z, 0.02, 5);  // mirror arm
    box('metalDark', 2.14, 2.56, z, 0.05, 0.34, 0.22, 1);           // mirror housing
    box('glass', 2.11, 2.56, z, 0.02, 0.28, 0.16, 1);
  }
  cyl('metalDark', 0.16, 2.15, -0.96, 0.055, 0.065, 1.9, 8);        // exhaust stack
  cyl('metalDark', 0.16, 3.12, -0.96, 0.052, 0.052, 0.18, 8, 0.35);
  box('metalDark', 0.16, 1.3, -0.96, 0.16, 0.1, 0.16, 1);
  box('rust', 0.16, 2.0, -0.88, 0.14, 1.0, 0.04, 1);                // heat shield
  cyl('metalDark', 1.85, 2.86, 0.82, 0.03, 0.04, 0.1, 6);           // antenna base
  rod('metalDark', 1.85, 2.9, 0.82, 1.7, 3.9, 0.74, 0.012, 5);

  // ------------------------------------------------------------------ cargo bed
  box('metal', -1.9, 1.31, 0, 3.35, 0.14, 2.3, 1.4);                // deck
  for (const z of [-1.1, 1.1]) {
    box('metal', -1.9, 1.67, z, 3.35, 0.58, 0.1, 1.3);              // side wall
    box('metalDark', -1.9, 1.98, z, 3.4, 0.05, 0.05, 1.1);          // rub rail
    for (const x of [-0.65, -1.3, -1.95, -2.6, -3.25]) box('metalDark', x, 1.92, z, 0.14, 0.14, 0.03, 1);
  }
  box('metal', -0.3, 1.92, 0, 0.1, 1.12, 2.2, 1.3);                 // headboard
  box('metal', -3.61, 1.7, 0, 0.08, 0.7, 2.2, 1.3);                 // tailgate
  for (const z of [-0.92, 0.92]) {
    box('rust', -3.66, 1.5, z, 0.05, 0.24, 0.3, 1);                 // tail light housing
    box('glowWarm', -3.69, 1.5, z, 0.02, 0.14, 0.2, 1);             // tail light lens
  }
  box('metalDark', -3.66, 0.62, 0, 0.18, 0.2, 2.3, 1.2);            // rear step/bumper
  wheel(-0.1, 0, 0.44, Math.PI / 2, 1.9, false);                    // spare on headboard
  cyl('metalDark', -1.05, 0.82, -0.7, 0.19, 0.19, 0.95, 10, 0, 0, Math.PI / 2);  // fuel tank
  for (const x of [-1.4, -0.7]) box('metalDark', x, 0.82, -0.7, 0.06, 0.4, 0.4, 1);
  box('metalDark', 0.55, 0.8, 0.72, 0.72, 0.42, 0.34, 1.1);         // toolbox
  box('rust', 0.55, 0.8, 0.9, 0.5, 0.06, 0.02, 1);
  // tarped load: ribs, straps and tie-downs so it reads as canvas, not a crate
  box('tarp', -1.9, 1.94, 0, 3.1, 1.06, 2.08, 1.6);
  for (let i = 0; i < 5; i++) box('metalDark', -0.75 - i * 0.58, 2.49, 0, 0.08, 0.05, 2.12, 1);
  for (const z of [-0.55, 0.55]) box('metalDark', -1.9, 2.5, z, 3.14, 0.02, 0.09, 1);
  for (const x of [-0.5, -3.3]) for (const z of [-1.03, 1.03]) rod('metalDark', x, 2.46, z, x, 1.98, z * 1.06, 0.012, 5);
  for (const x of [-1.0, -2.8]) {
    rod('metalDark', x, 2.48, -1.0, x + 0.25, 1.96, -1.12, 0.012, 5);
    rod('metalDark', x, 2.48, 1.0, x + 0.25, 1.96, 1.12, 0.012, 5);
  }

  // wheels: front axle steers slightly, rear tandem runs straight
  wheel(2.55, 1.16, 0.52, 0.12);
  wheel(2.55, -1.16, 0.52, 0.12);
  wheel(-1.55, 1.16);
  wheel(-1.55, -1.16);
  wheel(-2.65, 1.16);
  wheel(-2.65, -1.16);
  // rear tandem mudguards + flaps
  for (const z of [-1.19, 1.19]) {
    box('metal', -2.1, 1.14, z, 2.55, 0.06, 0.5, 1.3);
    box('metal', -0.82, 1.02, z, 0.4, 0.05, 0.5, 1.2, 0, 0, -0.4);
    box('metal', -3.38, 1.02, z, 0.4, 0.05, 0.5, 1.2, 0, 0, 0.4);
    box('metalDark', -2.1, 1.075, z * 1.21, 2.55, 0.12, 0.035, 1);  // outer mudguard lip
    box('metalDark', -0.85, 1.28, z, 0.07, 0.24, 0.12, 1);
    box('metalDark', -3.35, 1.28, z, 0.07, 0.24, 0.12, 1);
    box('rubber', -3.42, 0.6, z, 0.04, 0.46, 0.44, 1.2);
  }
  // dust decals under the wheels + oil stain
  ctx.req.decals.push({ x: t.x + 2.2, y: 0.03, z: t.z, rx: -Math.PI / 2, ry: t.yaw, cell: 'tracks', w: 5.6, h: 2.6, opacity: 0.5 });
  ctx.req.decals.push({ x: t.x - 2.6, y: 0.032, z: t.z + 2.2, rx: -Math.PI / 2, ry: 0, cell: 'oil', w: 2.2, h: 2.2, opacity: 0.6 });
}
