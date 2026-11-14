/**
 * SANDSTRIKE // 沙暴协议 — shared world-model core helpers.
 *
 * Geometry, batching, signage and cloth helpers, moved verbatim out of world.js so the
 * per-model modules under src/models/ can reuse them without importing world.js.
 * These helpers are pure: they only touch the `ctx` object they are handed.
 */
import * as THREE from 'three';
import { lerp, smoothstep, makeRNG, canvasTexture } from '../utils.js';
import { getFoliageDepthMaterial } from '../world/foliage-fx.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ===========================================================================
// geometry helpers
// ===========================================================================

const _tmpMatrix = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();
const _tmpVec = new THREE.Vector3();
const _tmpScale = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);

/** Merge a list of (already transformed, non-indexed) BufferGeometries. */
function mergeGeometries(geos) {
  if (geos.length === 0) return null;
  let total = 0;
  let hasColor = false;
  for (const g of geos) {
    total += g.attributes.position.count;
    if (g.attributes.color) hasColor = true;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const col = hasColor ? new Float32Array(total * 3) : null;
  let off = 0;
  for (const g of geos) {
    const count = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    if (g.attributes.uv) uvs.set(g.attributes.uv.array, off * 2);
    if (col) {
      if (g.attributes.color) col.set(g.attributes.color.array, off * 3);
      else col.fill(1, off * 3, (off + count) * 3);
    }
    off += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Box geometry whose UVs are scaled to world metres (tile = metres per texture tile). */
function boxGeometryWorldUV(w, h, d, tile = 1, uvScale = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = dims[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, (uv.getX(i) * fu) / tile * uvScale, (uv.getY(i) * fv) / tile * uvScale);
    }
  }
  return g;
}

/** Plane geometry with custom UV rect (for atlas decals) + optional world-scale UVs. */
function planeGeometry(w, h, { u0 = 0, v0 = 0, u1 = 1, v1 = 1, worldScale = 0 } = {}) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    minU = Math.min(minU, uv.getX(i));
    maxU = Math.max(maxU, uv.getX(i));
    minV = Math.min(minV, uv.getY(i));
    maxV = Math.max(maxV, uv.getY(i));
  }
  for (let i = 0; i < uv.count; i++) {
    const tu = (uv.getX(i) - minU) / (maxU - minU);
    const tv = (uv.getY(i) - minV) / (maxV - minV);
    if (worldScale > 0) {
      uv.setXY(i, (tu * w) / worldScale, (tv * h) / worldScale);
    } else {
      uv.setXY(i, u0 + tu * (u1 - u0), v0 + tv * (v1 - v0));
    }
  }
  return g;
}

/** Extruded arch: rectangular outer silhouette with an arched opening.
 *
 * The silhouette bottom is buried 0.6 m below the floor and the opening is cut down
 * to -0.5 m, so the two paths never share an edge at y≈0. Previously both bottoms sat
 * at y=0, which extruded a 4 cm stone threshold strip across every archway opening.
 */
function archGeometry(span, height, depth, pierW = 0.4, crown = 0.35, segments = 18) {
  const radius = Math.max(0.2, span / 2 - pierW);
  const springY = Math.max(0.6, height - radius);
  const GROUND_BURY = 0.6;
  const outline = new THREE.Shape();
  const totalH = height + crown;
  outline.moveTo(-span / 2, -GROUND_BURY);
  outline.lineTo(span / 2, -GROUND_BURY);
  outline.lineTo(span / 2, totalH);
  outline.lineTo(-span / 2, totalH);
  outline.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-radius, -GROUND_BURY + 0.1);
  hole.lineTo(-radius, springY);
  hole.absarc(0, springY, radius, Math.PI, 0, true);
  hole.lineTo(radius, -GROUND_BURY + 0.1);
  hole.closePath();
  outline.holes.push(hole);

  const g = new THREE.ExtrudeGeometry(outline, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 1,
    curveSegments: segments,
    steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Cylinder with UVs scaled to world metres. */
function cylinderWorldUV(rTop, rBottom, h, radial = 12, tile = 1, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, radial, 1, open);
  const uv = g.attributes.uv;
  const circ = Math.PI * (rTop + rBottom);
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * h) / tile);
  }
  return g;
}

/** Clone + transform helper used by the static batcher. */
function transformed(geo, matrix) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(matrix);
  return g;
}

function matrixFor(x, y, z, rotX = 0, rotY = 0, rotZ = 0, sx = 1, sy = 1, sz = 1) {
  _tmpVec.set(x, y, z);
  _tmpQuat.setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ'));
  _tmpScale.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_tmpVec, _tmpQuat, _tmpScale);
}

/**
 * Add a cylinder that spans two world points — used for guy wires, tripod legs,
 * diagonal braces and axle shafts (orientation from the Y axis to the segment).
 */
const _rodA = new THREE.Vector3();
const _rodB = new THREE.Vector3();
const _rodDir = new THREE.Vector3();
const _rodQuat = new THREE.Quaternion();
const _rodPos = new THREE.Vector3();
function rodBetween(ctx, key, ax, ay, az, bx, by, bz, r, radial = 6, tile = 1.4) {
  _rodA.set(ax, ay, az);
  _rodB.set(bx, by, bz);
  _rodDir.subVectors(_rodB, _rodA);
  const len = _rodDir.length();
  if (len < 1e-4) return;
  _rodDir.multiplyScalar(1 / len);
  _rodQuat.setFromUnitVectors(_yAxis, _rodDir);
  _rodPos.copy(_rodA).add(_rodB).multiplyScalar(0.5);
  const g = cylinderWorldUV(r, r, len, radial, tile);
  const m = new THREE.Matrix4().compose(_rodPos, _rodQuat, new THREE.Vector3(1, 1, 1));
  ctx.batcher.add(key, g, m);
  g.dispose();
}

/**
 * Bake cheap per-vertex AO / grime into a geometry as a color attribute.
 * Bright at the top, dirt-dark near the ground, subtle per-vertex noise.
 *
 * If the geometry already carries an authored `color` attribute (per-block stone tint,
 * wet band, bleached driftwood…), the AO is MULTIPLIED into it instead of replacing it.
 * Without this, the static batcher wiped every hand-authored tint at map build time and
 * the in-game ruins/village looked uniform while the stage previews looked right
 * (structures-report.md, risk a).
 */
function bakeVertexAO(geo, { ground = 1.5, floor = 0.55, noise = 0.06, seed = 1 } = {}) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const count = pos.count;
  const tint = geo.attributes.color;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = nor ? nor.getY(i) : 0;
    let ao = lerp(floor, 1, smoothstep(0, ground, y));
    if (ny < -0.25) ao *= 0.82; // undersides
    if (ny > 0.6) ao = Math.min(1, ao + 0.06); // tops catch sun
    const n = (Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 3.1) * 43758.5453) % 1;
    ao *= 1 - noise * Math.abs(n);
    const r = tint ? tint.getX(i) : 1;
    const g = tint ? tint.getY(i) : 1;
    const b = tint ? tint.getZ(i) : 1;
    colors[i * 3] = ao * r;
    colors[i * 3 + 1] = ao * g * (0.99 + noise * 0.15);
    colors[i * 3 + 2] = ao * b * 0.96;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// ---------------------------------------------------------------------------
// material helper (dependency of makeSign; imported back by world.js)
// ---------------------------------------------------------------------------

/** Build a MeshStandardMaterial from one of the procedural texture sets. */
function stdMaterial(set, opts = {}) {
  // Accept either a texture set { map, normalMap, ormMap } or a raw THREE.Texture.
  const raw = !!(set && set.isTexture);
  const metalPacked = !raw && !!set.ormMap;
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    map: raw ? set : set.map ?? null,
    normalMap: raw ? null : set.normalMap ?? null,
    roughnessMap: opts.roughnessMap ?? (raw ? null : set.roughnessMap ?? set.ormMap ?? null),
    metalnessMap: metalPacked ? set.ormMap : null,
    roughness: metalPacked ? 1 : opts.roughness ?? 1,
    metalness: metalPacked ? 1 : opts.metalness ?? 0.02,
    envMapIntensity: opts.envMapIntensity ?? 0.7,
    vertexColors: !!opts.vertexColors,
    side: opts.side ?? THREE.FrontSide,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    alphaTest: opts.alphaTest ?? 0,
    depthWrite: opts.depthWrite ?? true,
    emissive: new THREE.Color(opts.emissive ?? 0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  if (opts.normalScale !== undefined) mat.normalScale.set(opts.normalScale, opts.normalScale);
  if (opts.polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = opts.polygonOffset[0];
    mat.polygonOffsetUnits = opts.polygonOffset[1];
  }
  mat.name = opts.name ?? 'mat';
  return mat;
}

const FONT_DISPLAY = '"Bahnschrift Condensed", "DIN Alternate", "Arial Narrow", "Segoe UI", sans-serif';
const FONT_CJK = '"Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif';

/** Add an axis-aligned (optionally yaw-rotated) box to a material batch. */
function boxBatch(ctx, key, x, y, z, w, h, d, { tile = 2.4, ry = 0, uvOffset = null } = {}) {
  const g = boxGeometryWorldUV(w, h, d, tile);
  ctx.batcher.add(key, g, matrixFor(x, y, z, 0, ry, 0), { uvOffset });
  g.dispose();
}

/** Add a box resting on the floor (y = 0 … h). */
function baseBox(ctx, key, x, z, w, h, d, opts = {}) {
  boxBatch(ctx, key, x, h / 2 + (opts.y0 ?? 0), z, w, h, d, opts);
}

function cylinderBatch(ctx, key, x, y, z, rTop, rBottom, h, radial = 10, rot = null) {
  const g = cylinderWorldUV(rTop, rBottom, h, radial, 1.8);
  ctx.batcher.add(key, g, rot ?? matrixFor(x, y, z));
  g.dispose();
}

// ---------------------------------------------------------------- signage helper

function drawSignPlate(canvas, text, sub, opts = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const rng = makeRNG(opts.seed ?? 51);
  const bg = opts.bg ?? '#42392a';
  const fg = opts.fg ?? '#eadcb8';
  const accent = opts.accent ?? '#b8502f';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // painted metal / board texture
  for (let i = 0; i < 40; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const r = 6 + rng() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng() > 0.5 ? 'rgba(255,240,205,0.07)' : 'rgba(0,0,0,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 22; i++) {
    ctx.strokeStyle = `rgba(226,214,186,${0.04 + rng() * 0.09})`;
    ctx.lineWidth = 0.7 + rng() * 1.6;
    ctx.beginPath();
    const x = rng() * W;
    const y = rng() * H;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 80, y + (rng() - 0.5) * 26);
    ctx.stroke();
  }
  // border
  ctx.strokeStyle = fg;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, W - 24, H - 24);
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  ctx.fillRect(12, 12, W - 24, 8);
  // text
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const big = opts.big ?? 76;
  ctx.font = `900 ${big}px ${FONT_DISPLAY}`;
  ctx.fillText(text, W / 2, H * 0.44, W - 70);
  if (sub) {
    ctx.fillStyle = opts.subColor ?? accent;
    ctx.font = `900 ${opts.subSize ?? 44}px ${FONT_CJK}`;
    ctx.fillText(sub, W / 2, H * 0.72, W - 70);
  }
  // rivets
  for (const [x, y] of [[24, 24], [W - 24, 24], [24, H - 24], [W - 24, H - 24]]) {
    ctx.fillStyle = 'rgba(20,18,14,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(236,228,206,0.5)';
    ctx.beginPath();
    ctx.arc(x - 1, y - 1, 2, 0, TAU);
    ctx.fill();
  }
  // weathering punch
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 190; i++) {
    ctx.globalAlpha = 0.1 + rng() * 0.35;
    ctx.beginPath();
    ctx.arc(rng() * W, rng() * H, 0.5 + rng() * 2.4, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function makeSign(ctx, { text, sub = '', x, y, z, ry = 0, w = 2.4, h = 1.2, bg, fg, accent, big, subSize, seed = 51, tilt = 0 }) {
  const tex = canvasTexture(512, 256, (c) => drawSignPlate(c, text, sub, { bg, fg, accent, big, subSize, seed }), {
    srgb: true,
    anisotropy: ctx.tex.anisotropy,
    repeat: [1, 1],
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  ctx.textures.push(tex);
  const mat = stdMaterial({ map: tex }, { name: `sign:${text}`, roughness: 0.82, metalness: 0.12, envMapIntensity: 0.9 });
  const geo = planeGeometry(w, h);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(tilt, ry, 0);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.surface = 'metal';
  mesh.name = `sign:${text}`;
  ctx.scene.add(mesh);
  ctx.materialsCustom.push(mat);
  ctx.disposables.push(geo);
  return mesh;
}

// --------------------------------------------------------------- window / door

function faceRotation(nx, nz) {
  return Math.atan2(nx, nz);
}

/** Window inset into a wall face. (cx,cy,cz) is the anchor on the wall face. */
function addWindow(ctx, { x, y, z, nx, nz, w = 0.95, h = 1.25, shutters = true, sill = true }) {
  const ry = faceRotation(nx, nz);
  const base = matrixFor(x, y, z, 0, ry, 0);
  const part = (lx, ly, lz, bw, bh, bd, key, tile = 1.6) => {
    const g = boxGeometryWorldUV(bw, bh, bd, tile);
    const m = new THREE.Matrix4().makeTranslation(lx, ly, lz);
    m.premultiply(base);
    ctx.batcher.add(key, g, m);
    g.dispose();
  };
  part(0, 0, -0.09, w, h, 0.22, 'dark', 1);
  part(0, 0, 0.015, w - 0.1, h - 0.1, 0.02, 'glass', 1);
  // frame
  part(0, h / 2 + 0.07, 0.06, w + 0.28, 0.14, 0.2, 'woodDark');
  part(0, -h / 2 - 0.07, 0.06, w + 0.28, 0.14, 0.2, 'woodDark');
  part(-(w / 2 + 0.07), 0, 0.06, 0.14, h + 0.28, 0.2, 'woodDark');
  part(w / 2 + 0.07, 0, 0.06, 0.14, h + 0.28, 0.2, 'woodDark');
  part(0, 0, 0.05, 0.07, h, 0.06, 'woodDark');
  if (sill) part(0, -h / 2 - 0.18, 0.17, w + 0.42, 0.12, 0.4, 'stone', 2.0);
  // lintel
  part(0, h / 2 + 0.2, 0.14, w + 0.5, 0.16, 0.28, 'stone', 2.0);
  if (shutters) {
    const sw = w * 0.52;
    for (const side of [-1, 1]) {
      const g = boxGeometryWorldUV(sw, h * 0.96, 0.07, 1.4);
      const m = new THREE.Matrix4().makeTranslation(side * (w / 2 + 0.24), 0, 0.14);
      m.premultiply(base);
      ctx.batcher.add('wood', g, m);
      g.dispose();
      // shutter slats
      for (let i = 0; i < 3; i++) {
        const sg = boxGeometryWorldUV(sw * 0.86, 0.05, 0.02, 0.8);
        const sm = new THREE.Matrix4().makeTranslation(side * (w / 2 + 0.24), (i - 1) * h * 0.3, 0.19);
        sm.premultiply(base);
        ctx.batcher.add('woodDark', sg, sm);
        sg.dispose();
      }
    }
  }
}

/** Simple doorway with wooden door, stone frame and threshold. */
function addDoor(ctx, { x, y, z, nx, nz, w = 1.15, h = 2.3, key = 'wood', chip = true }) {
  const ry = faceRotation(nx, nz);
  const base = matrixFor(x, y, z, 0, ry, 0);
  const part = (lx, ly, lz, bw, bh, bd, bkey, tile = 1.8) => {
    const g = boxGeometryWorldUV(bw, bh, bd, tile);
    const m = new THREE.Matrix4().makeTranslation(lx, ly, lz);
    m.premultiply(base);
    ctx.batcher.add(bkey, g, m);
    g.dispose();
  };
  part(0, 0, -0.06, w, h, 0.16, 'dark', 1);
  part(0, 0, 0.02, w - 0.1, h - 0.08, 0.09, key);
  // planks detail + iron bands
  for (const yy of [-h * 0.28, h * 0.28]) part(0, yy, 0.09, w - 0.14, 0.09, 0.04, 'rust', 1.2);
  part(-(w / 2 + 0.1), 0, 0.05, 0.16, h + 0.24, 0.24, 'stone', 1.8);
  part(w / 2 + 0.1, 0, 0.05, 0.16, h + 0.24, 0.24, 'stone', 1.8);
  part(0, h / 2 + 0.13, 0.06, w + 0.4, 0.2, 0.26, 'stone', 1.8);
  part(0, -h / 2 + 0.03, 0.2, w + 0.36, 0.08, 0.42, 'stone', 1.8);
  // handle
  part(w * 0.3, 0, 0.12, 0.06, 0.24, 0.06, 'rust', 0.6);
}

// ---------------------------------------------------------------- boundary walls

const crenelRng = makeRNG(31337);

function addCrenellationsAlongX(ctx, x0, x1, z, topY, step = 2.4) {
  let i = 0;
  for (let x = x0; x <= x1; x += step) {
    const h = 0.5 + (i % 3) * 0.08;
    boxBatch(ctx, 'adobe', x, topY + h / 2, z, step * 0.62, h, 0.7, { tile: 2.0 });
    i++;
  }
}
function addCrenellationsAlongZ(ctx, z0, z1, x, topY, step = 2.4) {
  let i = 0;
  for (let z = z0; z <= z1; z += step) {
    const h = 0.5 + (i % 3) * 0.08;
    boxBatch(ctx, 'adobe', x, topY + h / 2, z, 0.7, h, step * 0.62, { tile: 2.0 });
    i++;
  }
}

function addArchMesh(ctx, a) {
  const g = archGeometry(a.span, a.height, a.depth, a.pierW ?? 0.3);
  ctx.batcher.add(a.style === 'adobe' ? 'adobe' : 'stone', g, matrixFor(a.x, a.y ?? 0, a.z, 0, a.rot ?? 0));
  g.dispose();
  // cap stones on the arch crown
  const topY = (a.y ?? 0) + a.height + 0.36;
  if (a.style !== 'adobe') {
    boxBatch(ctx, 'stone', a.x, topY + 0.12, a.z, a.span * 0.36, 0.24, a.depth + 0.2, { tile: 1.8, ry: a.rot ?? 0 });
  }
}

function makeInstanced(ctx, geo, material, items, name, surface, opts = {}) {
  if (items.length === 0) return null;
  // A quality tier that trims every card out of one bucket leaves mergeGeometries() with
  // an empty list and it returns null. An InstancedMesh built on a null geometry only
  // explodes later, deep inside the renderer (Frustum.intersectsObject ->
  // computeBoundingSphere: "Cannot read properties of null"), killing the whole boot.
  // island-01 quality=lowest hit exactly that through the bamboo young-flush bucket.
  if (!geo || !geo.attributes || !geo.attributes.position) return null;
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  mesh.name = name;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const tint = new THREE.Color();
  const rng = makeRNG(opts.seed ?? 909);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    pos.set(it.x, it.y, it.z);
    e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0, 'YXZ');
    q.setFromEuler(e);
    scl.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(i, m);
    const shade = 0.78 + rng() * 0.34;
    tint.setRGB(shade, shade * (0.97 + rng() * 0.05), shade * (0.94 + rng() * 0.06));
    mesh.setColorAt(i, tint);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = opts.castShadow ?? true;
  mesh.receiveShadow = true;
  // Leaf materials carry a wind displacement in their vertex shader; the shadow pass
  // needs the same displacement or the canopy shadow would stay frozen while the
  // leaves move (see src/world/foliage-fx.js).
  if (material && material.userData && material.userData.foliageFx) {
    mesh.customDepthMaterial = getFoliageDepthMaterial(material);
  }
  mesh.userData.surface = surface;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  ctx.scene.add(mesh);
  ctx.collideMeshes.push(mesh);
  ctx.objects.push(mesh);
  ctx.disposables.push(geo);
  return mesh;
}

function clothMaterial(ctx, key) {
  const M = ctx.materials;
  switch (key) {
    case 'awning': return M.awning;
    case 'tarp': return M.tarp;
    case 'shade': return M.shade;
    case 'a': return M.bannerA;
    case 'b': return M.bannerB;
    case 'warn': return M.bannerWarn;
    case 'title':
    default: return M.bannerTitle;
  }
}

function registerCloth(ctx, mesh, geo, type, w, h, amp, phase) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.scene.add(mesh);
  ctx.cloths.push({
    mesh,
    geo,
    base: new Float32Array(geo.attributes.position.array),
    type,
    w,
    h,
    amp,
    phase,
    speed: 1.15 + (phase % 1) * 1.5,
  });
}

function mergePlanes(ctx, requests, getCell, material, name) {
  const geos = [];
  for (const req of requests) {
    const cell = getCell(req);
    if (!cell) continue;
    const g = planeGeometry(req.w, req.h, { u0: cell.u0, v0: cell.v0, u1: cell.u1, v1: cell.v1 });
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(req.x, req.y, req.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(req.rx ?? 0, req.ry ?? 0, req.rz ?? 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    geos.push(transformed(g, m));
    g.dispose();
  }
  if (geos.length === 0) return null;
  const merged = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  ctx.disposables.push(merged);
  return mesh;
}

export {
  TAU,
  DEG,
  mergeGeometries,
  boxGeometryWorldUV,
  planeGeometry,
  archGeometry,
  cylinderWorldUV,
  transformed,
  matrixFor,
  rodBetween,
  bakeVertexAO,
  boxBatch,
  baseBox,
  cylinderBatch,
  makeSign,
  faceRotation,
  addWindow,
  addDoor,
  addCrenellationsAlongX,
  addCrenellationsAlongZ,
  addArchMesh,
  makeInstanced,
  clothMaterial,
  registerCloth,
  mergePlanes,
  stdMaterial,
};
