import * as THREE from 'three';
import { boxGeometryWorldUV, cylinderWorldUV } from '../core.js';

export const meta = { id: 'rpg-launcher', kind: 'world', group: 'weapon', label: 'RPG-7 · 火箭筒（手持）' };

/**
 * RPG-7 style rocket launcher carried in first person: launch tube, wooden heat
 * shield, iron sights, grips, canvas sling, shoulder rest and a loaded PG-7
 * warhead, plus the gloved hands / sleeve stubs that hold it (no display stand).
 * Design study only: nothing places this in the map.
 */
function buildLauncher(ctx) {
  const UNIT = new THREE.Vector3(1, 1, 1);
  const _e = new THREE.Euler();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const place = (key, geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _v.set(x, y, z);
    _m.compose(_v, _q, UNIT);
    ctx.batcher.add(key, geo, _m);
    geo.dispose();
  };
  const box = (key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, tile = 1.2) =>
    place(key, boxGeometryWorldUV(w, h, d, tile), x, y, z, rx, ry, rz);
  const cyl = (key, rTop, rBottom, h, x, y, z, rx = 0, ry = 0, rz = 0, radial = 12, tile = 1.2) =>
    place(key, cylinderWorldUV(rTop, rBottom, h, radial, tile), x, y, z, rx, ry, rz);
  const rod = (key, ax, ay, az, bx, by, bz, radius, radial = 6) => {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    _m.compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, UNIT);
    const g = cylinderWorldUV(radius, radius, len, radial, 1.2);
    ctx.batcher.add(key, g, _m);
    g.dispose();
  };

  // ------------------------------------------------------------ held weapon
  // (no display cradle: this is a first-person carried launcher; the gloved
  // hands and sleeve stubs below sit where the player's arms would be)

  // ------------------------------------------------------------- the launcher
  const LY = 1.33;
  cyl('metalDark', 0.05, 0.05, 1.35, 0, LY, 0, Math.PI / 2, 0, 0, 12);     // launch tube
  // rear end: short venturi bell (opening backwards) with a dark throat, a rim
  // and a collar - not a long taper, so it reads as a nozzle instead of a cone
  cyl('metalDark', 0.056, 0.056, 0.12, 0, LY, 0.7, Math.PI / 2, 0, 0, 12);   // collar
  cyl('metalDark', 0.118, 0.056, 0.2, 0, LY, 0.86, Math.PI / 2, 0, 0, 12);   // venturi bell
  cyl('rust', 0.122, 0.122, 0.022, 0, LY, 0.965, Math.PI / 2, 0, 0, 12);     // bell rim
  cyl('dark', 0.104, 0.104, 0.03, 0, LY, 0.958, Math.PI / 2, 0, 0, 12);      // throat interior
  box('metalDark', 0.05, 0.08, 0.2, 0, LY - 0.1, 0.82, 0.2, 0, 0);           // bell support strut
  // wooden heat shield + metal bands
  cyl('wood', 0.079, 0.079, 0.5, 0, LY, 0.12, Math.PI / 2, 0, 0, 14, 0.9);
  for (const z of [-0.12, 0.34]) cyl('metalDark', 0.086, 0.086, 0.035, 0, LY, z, Math.PI / 2, 0, 0, 14);
  // grips + trigger group
  box('wood', 0.06, 0.16, 0.1, 0, LY - 0.13, -0.3, 0.16);
  box('wood', 0.07, 0.2, 0.11, 0, LY - 0.17, 0.24, -0.22);
  box('metal', 0.035, 0.09, 0.05, 0, LY - 0.09, 0.2, -0.1);
  box('metalDark', 0.02, 0.02, 0.16, 0, LY - 0.12, 0.14, 0.2);
  rod('metalDark', 0, LY - 0.2, 0.31, 0, LY - 0.24, 0.12, 0.011);
  rod('metalDark', 0, LY - 0.24, 0.12, 0, LY - 0.14, 0.07, 0.011);
  // shoulder rest (the launcher is shouldered when fired)
  box('wood', 0.05, 0.06, 0.2, 0, LY - 0.07, 0.52, -0.2);
  box('rubber', 0.09, 0.15, 0.2, 0, LY - 0.15, 0.62, -0.28);
  // iron sights: front post + ring, rear aperture + elevation drum
  box('dark', 0.03, 0.13, 0.05, 0, LY + 0.1, -0.44);
  place('metalDark', new THREE.TorusGeometry(0.045, 0.01, 5, 10), 0, LY + 0.13, -0.44);
  box('dark', 0.12, 0.05, 0.09, 0, LY + 0.11, 0.03);
  place('metalDark', new THREE.TorusGeometry(0.03, 0.008, 5, 10), 0, LY + 0.12, 0.03);
  cyl('metal', 0.03, 0.03, 0.14, 0.09, LY + 0.1, 0.03, 0, 0, Math.PI / 2, 8);
  box('dark', 0.045, 0.035, 0.34, 0.065, LY + 0.085, -0.16);               // optic rail
  // canvas sling
  for (const seg of [
    [0.06, LY + 0.04, -0.55, 0.075, LY - 0.1, -0.2],
    [0.075, LY - 0.1, -0.2, 0.075, LY - 0.12, 0.25],
    [0.075, LY - 0.12, 0.25, 0.06, LY + 0.03, 0.62],
  ]) rod('canvasDark', ...seg, 0.012);
  // stencilled bands on the tube
  for (const z of [-0.36, 0.52]) box('rust', 0.104, 0.012, 0.03, 0, LY + 0.002, z);
  // loaded PG-7 warhead: body, nose cone (apex FORWARD) and bands
  cyl('canvasDark', 0.105, 0.105, 0.44, 0, LY, -0.9, Math.PI / 2, 0, 0, 12, 0.9);
  cyl('canvasDark', 0.105, 0.004, 0.38, 0, LY, -1.3, Math.PI / 2, 0, 0, 12, 0.9);
  for (const z of [-0.72, -1.06]) cyl('rust', 0.109, 0.109, 0.028, 0, LY, z, Math.PI / 2, 0, 0, 12);
  // ---------------------------------------- gloved hands + sleeve stubs (held)
  // right hand wraps the pistol grip, left hand supports the foregrip; the
  // sleeve stubs drop back out of frame exactly like the other viewmodels
  box('dark', 0.1, 0.13, 0.13, 0.012, LY - 0.2, 0.27, -0.2);
  for (let i = 0; i < 4; i++) {
    box('dark', 0.022, 0.07, 0.06, -0.033 + i * 0.022, LY - 0.245, 0.315, -0.45);
  }
  box('dark', 0.03, 0.06, 0.09, 0.06, LY - 0.15, 0.2, -0.05);
  box('metalDark', 0.11, 0.06, 0.11, 0.02, LY - 0.3, 0.33, -0.2);
  rod('tarp', 0.02, LY - 0.32, 0.35, 0.14, LY - 0.8, 0.98, 0.072);
  rod('tarp', 0.045, LY - 0.45, 0.51, 0.14, LY - 0.8, 0.98, 0.082);

  box('dark', 0.095, 0.11, 0.13, -0.005, LY - 0.19, -0.3, 0.14);
  for (let i = 0; i < 4; i++) {
    box('dark', 0.022, 0.06, 0.055, -0.033 + i * 0.022, LY - 0.235, -0.35, 0.45);
  }
  box('dark', 0.03, 0.055, 0.08, -0.055, LY - 0.15, -0.26, 0.2);
  box('metalDark', 0.1, 0.06, 0.1, -0.01, LY - 0.28, -0.37, 0.16);
  rod('tarp', -0.01, LY - 0.3, -0.4, -0.16, LY - 0.72, 0.12, 0.068);
  rod('tarp', -0.04, LY - 0.4, -0.27, -0.16, LY - 0.72, 0.12, 0.078);
}

/** Preview builder (stage/WebUI): same builder as map assembly (design-only model). */
export function build(ctx) {
  buildWorld(ctx);
}

/** Map assembly builder: the launcher is never placed in the map, but must stay buildable. */
export function buildWorld(ctx) {
  buildLauncher(ctx);
}
