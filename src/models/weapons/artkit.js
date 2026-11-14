/**
 * Shared procedural art kit for first-person weapon viewmodels.
 *
 * The VXR-7 (`vxr7.js`) defined its own primitive helpers, canvas textures and
 * muzzle-flash rig inline.  The three weapons added with the multi-weapon pass
 * (RPG-7 / M-77 gatling / SG-12 shotgun) need exactly the same vocabulary, so it
 * lives here once:
 *
 *   primitives   rounded / box / cyl / add / CZ / PROF / PROF_HOLE / OCT / RING /
 *                TUBE / HEXBOLT â€?all coordinates are weapon space
 *                (muzzle -Z, up +Y, right +X), i.e. the un-scaled held frame.
 *   textures     brushed metal, stippled polymer, walnut grain, canvas weave,
 *                hazard stripes, stencil labels and the star-shaped muzzle flash.
 *   flash rig    the VXR-7 flashGroup/flashMats contract (sprite + core sprite +
 *                forward cone, additive / transparent / depthWrite:false mats
 *                that start at opacity 0), parameterised per weapon.
 *   hand mats    matGlove / matGlovePalm / matGloveDark / matSleeve with a
 *                per-weapon colour tint (the geometry itself comes from
 *                `hands.js` `buildGlovedHands`).
 *
 * Nothing here creates a scene, camera, light or gameplay state: every function
 * is a pure builder the weapon modules call from `createMaterials()` /
 * `buildWeapon()` / `buildHands()`.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rand } from '../../utils.js';

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

function canvasPair(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d') };
}

/** Wrap a procedural canvas into a repeating sRGB CanvasTexture. */
export function canvasTexture(canvas, { repeatX = 1, repeatY = 1 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------

/** Brushed / worn gunmetal. */
export function makeMetalTexture({ base = '#59626a', streaks = 280, smudges = 7 } = {}) {
  const { canvas, ctx } = canvasPair(512, 512);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  const img = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 20;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < streaks; i++) {
    ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? '212,220,226' : '10,12,13'},${rand(0.015, 0.07)})`;
    ctx.lineWidth = rand(0.4, 1.4);
    const x = rand(0, 512);
    const y = rand(0, 512);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rand(24, 170), y + rand(-2, 2));
    ctx.stroke();
  }
  for (let i = 0; i < smudges; i++) {
    const g = ctx.createRadialGradient(rand(0, 512), rand(0, 512), 0, rand(0, 512), rand(0, 512), rand(24, 90));
    g.addColorStop(0, 'rgba(12,14,15,.08)');
    g.addColorStop(1, 'rgba(12,14,15,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  }
  for (let i = 0; i < 110; i++) {
    ctx.fillStyle = `rgba(228,232,234,${rand(0.03, 0.16)})`;
    ctx.fillRect(rand(0, 512), rand(0, 512), rand(1, 5), rand(0.6, 2));
  }
  return canvas;
}

/** Stippled moulded polymer (grips, housings, stocks). */
export function makePolymerTexture({ base = '#3d4348', speckles = 5600 } = {}) {
  const { canvas, ctx } = canvasPair(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < speckles; i++) {
    const l = Math.random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${l},${l},${l},${rand(0.02, 0.07)})`;
    ctx.fillRect(rand(0, 256), rand(0, 256), rand(0.5, 2), rand(0.5, 2));
  }
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${rand(0.02, 0.06)})`;
    ctx.beginPath();
    ctx.moveTo(rand(0, 256), rand(0, 256));
    ctx.lineTo(rand(0, 256), rand(0, 256));
    ctx.stroke();
  }
  return canvas;
}

/** Walnut / laminated wood grain for shotgun furniture and RPG heat shields. */
export function makeWoodTexture({ base = '#6d4829', light = '196,140,86', dark = '48,28,15' } = {}) {
  const { canvas, ctx } = canvasPair(512, 512);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  // long grain: sine-warped horizontal strokes
  for (let i = 0; i < 240; i++) {
    const yBase = rand(0, 512);
    const amp = rand(2, 11);
    const freq = rand(0.008, 0.03);
    const phase = rand(0, Math.PI * 2);
    ctx.beginPath();
    ctx.strokeStyle = Math.random() > 0.45
      ? `rgba(${light},${rand(0.03, 0.13)})`
      : `rgba(${dark},${rand(0.05, 0.18)})`;
    ctx.lineWidth = rand(0.6, 3.2);
    for (let x = 0; x <= 512; x += 12) {
      const y = yBase + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.7 + i) * 1.6;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // knots
  for (let i = 0; i < 5; i++) {
    const x = rand(0, 512);
    const y = rand(0, 512);
    for (let r = 2; r < 26; r += 3) {
      ctx.strokeStyle = `rgba(${dark},${rand(0.05, 0.16)})`;
      ctx.lineWidth = rand(0.6, 1.6);
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.9, r, 0.3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // pore speckle
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(${dark},${rand(0.05, 0.2)})`;
    ctx.fillRect(rand(0, 512), rand(0, 512), rand(0.6, 2.2), rand(0.6, 1.4));
  }
  return canvas;
}

/** Woven canvas / painted fabric (RPG tube wrap, slings, ammo pouches). */
export function makeCanvasTexture({ base = '#5d5c42', warp = 26, weft = 30 } = {}) {
  const { canvas, ctx } = canvasPair(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 3) {
    ctx.fillStyle = `rgba(255,255,255,${rand(0.012, 0.04)})`;
    ctx.fillRect(i, 0, 1, 256);
    ctx.fillStyle = `rgba(0,0,0,${rand(0.02, 0.06)})`;
    ctx.fillRect(0, i, 256, 1);
  }
  for (let i = 0; i < warp; i++) {
    ctx.strokeStyle = `rgba(240,235,210,${rand(0.015, 0.05)})`;
    ctx.lineWidth = rand(0.5, 1.5);
    const y = rand(0, 256);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y + rand(-3, 3));
    ctx.stroke();
  }
  for (let i = 0; i < weft; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${rand(0.03, 0.08)})`;
    ctx.lineWidth = rand(0.5, 1.4);
    const x = rand(0, 256);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + rand(-3, 3), 256);
    ctx.stroke();
  }
  return canvas;
}

/** Stencil label plate (same language as the VXR-7 receiver markings). */
export function makeLabelTexture(text = 'M-77', sub = 'SANDSTRIKE // 7.62', accent = '#ff8a3c') {
  const { canvas, ctx } = canvasPair(512, 128);
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = 'rgba(220,220,210,.82)';
  ctx.font = '700 52px "Segoe UI", sans-serif';
  ctx.fillText(text, 14, 62);
  ctx.fillStyle = accent;
  ctx.fillRect(14, 76, 210, 5);
  ctx.fillStyle = 'rgba(190,190,180,.55)';
  ctx.font = '400 21px "Segoe UI", sans-serif';
  ctx.fillText(sub, 14, 110);
  ctx.strokeStyle = 'rgba(220,220,210,.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, 500, 116);
  return canvasTexture(canvas);
}

/** Diagonal hazard stripes (ammo box / vent warning plates). */
export function makeHazardTexture({ stripe = '#c9a22a', base = '#20211d' } = {}) {
  const { canvas, ctx } = canvasPair(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 256, 256);
  ctx.clip();
  ctx.fillStyle = stripe;
  ctx.globalAlpha = 0.82;
  for (let x = -256; x < 512; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 256);
    ctx.lineTo(x + 32, 256);
    ctx.lineTo(x + 32 + 256, 0);
    ctx.lineTo(x + 256, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // grime
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rand(0.05, 0.16)})`;
    ctx.fillRect(rand(0, 256), rand(0, 256), rand(2, 12), rand(1, 5));
  }
  return canvasTexture(canvas);
}

/** Star-burst muzzle flash (same shape as the VXR-7 rig). */
export function makeFlashTexture() {
  const { canvas, ctx } = canvasPair(256, 256);
  ctx.translate(128, 128);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.12, 'rgba(255,236,180,1)');
  g.addColorStop(0.3, 'rgba(255,165,72,.9)');
  g.addColorStop(0.6, 'rgba(255,100,30,.28)');
  g.addColorStop(1, 'rgba(255,70,10,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -128);
  ctx.lineTo(15, -24);
  ctx.lineTo(112, -32);
  ctx.lineTo(30, 0);
  ctx.lineTo(96, 44);
  ctx.lineTo(16, 24);
  ctx.lineTo(0, 128);
  ctx.lineTo(-14, 24);
  ctx.lineTo(-96, 50);
  ctx.lineTo(-26, 0);
  ctx.lineTo(-108, -30);
  ctx.lineTo(-16, -22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.95)';
  ctx.beginPath();
  ctx.arc(0, 0, 17, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Primitive builders â€?weapon space (muzzle -Z, +Y up, +X right)
// ---------------------------------------------------------------------------

/** Rounded box; `r` is clamped so RoundedBoxGeometry never degenerates. */
export function rounded(w, h, d, mat, r = Math.min(w, h, d) * 0.16, segments = 2) {
  const radius = Math.max(0.0015, Math.min(r, Math.min(w, h, d) * 0.45));
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, segments, radius), mat);
}

export function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

/** Y-axis cylinder (caller rotates); `seg` is the radial segment count. */
export function cyl(rTop, rBottom, h, mat, seg = 16) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, false), mat);
}

export function sphere(r, mat, widthSeg = 12, heightSeg = 9) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, widthSeg, heightSeg), mat);
}

export function place(mesh, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

export function add(parent, mesh, x, y, z, rx = 0, ry = 0, rz = 0) {
  place(mesh, x, y, z, rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

/** Cylinder along Z. `rFront` is the radius toward the muzzle (-Z). */
export function CZ(rFront, rRear, len, mat, seg = 16, openEnded = false) {
  const geo = new THREE.CylinderGeometry(rRear, rFront, len, seg, 1, openEnded);
  geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(geo, mat);
}

/**
 * Extruded side silhouette: `pts` are [z, y] weapon-space points, extruded
 * across X (thickness = `width`).  The workhorse for receivers, grips, stocks.
 */
export function PROF(pts, width, mat, bevel = 0.006) {
  const bevelSize = Math.max(0.0015, Math.min(bevel, width * 0.3));
  const shape = new THREE.Shape();
  pts.forEach(([z, y], i) => {
    if (i === 0) shape.moveTo(-z, y);
    else shape.lineTo(-z, y);
  });
  shape.closePath();
  const depth = Math.max(0.004, width - 2 * bevelSize);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2);
  return new THREE.Mesh(geo, mat);
}

/** Extruded silhouette with a through-hole (trigger-guard loops, stock cut-outs). */
export function PROF_HOLE(pts, holePts, width, mat, bevel = 0.004) {
  const bevelSize = Math.max(0.0015, Math.min(bevel, width * 0.3));
  const toShape = (list) => {
    const shape = new THREE.Shape();
    list.forEach(([z, y], i) => (i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
    shape.closePath();
    return shape;
  };
  const shape = toShape(pts);
  shape.holes.push(toShape(holePts));
  const depth = Math.max(0.004, width - 2 * bevelSize);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2);
  return new THREE.Mesh(geo, mat);
}

/** Faceted octagonal section swept along Z (handguards / end caps). */
export function OCT(r, len, sx, sy, mat) {
  const geo = new THREE.CylinderGeometry(r, r, len, 8, 1, false);
  geo.scale(sx, sy, 1);
  geo.rotateY(Math.PI / 8);
  geo.rotateX(Math.PI / 2);
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  geo.dispose();
  return new THREE.Mesh(flat, mat);
}

export function RING(R, r, mat, radial = 8, tubular = 18) {
  return new THREE.Mesh(new THREE.TorusGeometry(R, r, radial, tubular), mat);
}

/** Tube through a point list (cables, slings, feed chutes). Points: arrays or Vector3. */
export function TUBE(points, r, mat, tubular = 18, radial = 6) {
  const vecs = points.map((p) => (p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2])));
  const curve = new THREE.CatmullRomCurve3(vecs);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, tubular, r, radial, false), mat);
}

/** Tiny hex bolt head. */
export function HEXBOLT(r = 0.0032, h = 0.0024, mat) {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 6, 1, false), mat);
}

/** Row of hex bolt heads along Z on a side face (side = Â±1 â†?Â±X facing). */
export function boltRow(parent, mat, { x = 0.05, y = 0, z = 0, dz = 0.03, count = 4, side = 1, r = 0.0032 } = {}) {
  for (let i = 0; i < count; i++) {
    add(parent, HEXBOLT(r, r * 0.75, mat), side * x, y, z + i * dz, 0, 0, side * Math.PI / 2);
  }
}

// ---------------------------------------------------------------------------
// Muzzle-flash rig (VXR-7 contract: flashGroup + flashMats + muzzleLocal)
// ---------------------------------------------------------------------------

/**
 * Build the muzzle-flash rig at `muzzleLocal`.
 *
 * The returned handles are exactly what `WeaponSystem` drives: `flashGroup`
 * (scaled / z-rotated on every shot) and `flashMats` (array of materials whose
 * `opacity` goes 0 â†?1 â†?0); the optional `muzzleLight` is re-parented under the
 * flash group so it tracks the muzzle.  All sprite/cone materials are additive,
 * transparent and `depthWrite:false` and start fully transparent so the rig is
 * invisible at rest.
 *
 * @param {object} opts
 * @param {THREE.Object3D} opts.parent weapon root
 * @param {THREE.Vector3} opts.muzzleLocal held-frame muzzle position
 * @param {THREE.PointLight|null} [opts.muzzleLight]
 * @param {number} [opts.size] overall flash scale (1 = VXR-7 sized)
 * @param {number} [opts.color]
 * @param {number} [opts.coreColor]
 * @param {number} [opts.coneColor]
 * @param {number} [opts.jets] side-jet count (0..4) for big launcher/muzzle blasts
 * @param {THREE.Texture} [opts.flashTex]
 * @returns {{ flashGroup: THREE.Group, flashMats: THREE.Material[], muzzleLocal: THREE.Vector3 }}
 */
export function createFlashRig({
  parent,
  muzzleLocal,
  muzzleLight = null,
  size = 1,
  color = 0xffb45a,
  coreColor = 0xfff0c0,
  coneColor = 0xffa14a,
  jets = 0,
  flashTex = null,
}) {
  const flashGroup = new THREE.Group();
  flashGroup.name = 'flashGroup';
  flashGroup.position.copy(muzzleLocal);
  parent.add(flashGroup);
  const tex = flashTex || makeFlashTexture();
  const flashMats = [];

  const spriteMat = new THREE.SpriteMaterial({
    map: tex,
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    opacity: 0,
  });
  flashMats.push(spriteMat);
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(0.26 * size, 0.26 * size, 1);
  sprite.renderOrder = 5;
  sprite.frustumCulled = false;
  flashGroup.add(sprite);

  const coreMat = new THREE.SpriteMaterial({
    map: tex,
    color: coreColor,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    opacity: 0,
  });
  flashMats.push(coreMat);
  const core = new THREE.Sprite(coreMat);
  core.scale.set(0.13 * size, 0.13 * size, 1);
  core.position.z = 0.01;
  core.renderOrder = 6;
  core.frustumCulled = false;
  flashGroup.add(core);

  const coneMat = new THREE.MeshBasicMaterial({
    color: coneColor,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    opacity: 0,
  });
  flashMats.push(coneMat);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.032 * size, 0.14 * size, 8, 1, true), coneMat);
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = -0.07 * size;
  cone.renderOrder = 5;
  flashGroup.add(cone);

  // side jets: short angled cones give the big launcher/muzzle blasts volume
  const jetMat = jets > 0 ? new THREE.MeshBasicMaterial({
    color: coneColor,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    opacity: 0,
  }) : null;
  if (jetMat) {
    flashMats.push(jetMat);
    for (let i = 0; i < jets; i++) {
      const a = (i / jets) * Math.PI * 2 + Math.PI / 4;
      const jet = new THREE.Mesh(new THREE.ConeGeometry(0.02 * size, 0.1 * size, 6, 1, true), jetMat);
      jet.position.set(Math.cos(a) * 0.035 * size, Math.sin(a) * 0.035 * size, -0.02 * size);
      jet.rotation.set(Math.PI / 2, 0, a + Math.PI / 2);
      jet.rotation.order = 'YXZ';
      jet.renderOrder = 5;
      flashGroup.add(jet);
    }
  }

  if (muzzleLight) {
    muzzleLight.position.set(0, 0, -0.02);
    flashGroup.add(muzzleLight);
  }
  return { flashGroup, flashMats, muzzleLocal };
}

// ---------------------------------------------------------------------------
// Gloved-hand materials (geometry comes from hands.js)
// ---------------------------------------------------------------------------

/**
 * The four glove / sleeve materials `buildGlovedHands` needs, tinted per weapon.
 * Keys match the VXR-7 set so `WeaponSystem` disposal and hand builders are
 * interchangeable between weapons.
 */
export function createGloveMaterials({
  glove = 0x46392b,
  palm = 0x544635,
  dark = 0x25251f,
  sleeve = 0x2a2b23,
  gloveRoughness = 0.9,
  sleeveRoughness = 0.96,
} = {}) {
  const matGlove = new THREE.MeshStandardMaterial({ color: glove, roughness: gloveRoughness, metalness: 0.03 });
  const matGlovePalm = new THREE.MeshStandardMaterial({ color: palm, roughness: 0.86, metalness: 0.035 });
  const matGloveDark = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.86, metalness: 0.1 });
  const matSleeve = new THREE.MeshStandardMaterial({ color: sleeve, roughness: sleeveRoughness, metalness: 0 });
  matGlove.name = 'glove';
  matGlovePalm.name = 'glovePalm';
  matGloveDark.name = 'gloveDark';
  matSleeve.name = 'sleeve';
  return { matGlove, matGlovePalm, matGloveDark, matSleeve };
}
