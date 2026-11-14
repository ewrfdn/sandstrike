/**
 * SANDSTRIKE // sandstorm protocol — ground, paving, dunes, mesas, skyline, haze.
 *
 * Split out of src/world.js (buildGroundAndTerrain + tileableNoise). All tunable
 * sizes/colours/masks/specs now come from `ctx.data.terrain` (map data); the
 * procedural frequencies (sin coefficients, noise octaves, talus ratios) stay in
 * code as before. Fallbacks below equal the pre-refactor world.js literals.
 *
 * Range convention (matches the old formulas exactly for the contract defaults):
 *   - `distance` / `width` / `depth` / `height`: [min, max] -> min + rng * (max - min)
 *   - `heights`: [base, n1Amp, n2Amp, ridgeAmp]
 *   - masks: passed to smoothstep(edge0, edge1)
 */
import * as THREE from 'three';
import { clamp, lerp, makeRNG, smoothstep } from '../utils.js';
import {
  TAU,
  mergeGeometries,
  boxGeometryWorldUV,
  planeGeometry,
  cylinderWorldUV,
  transformed,
  matrixFor,
} from '../models/core.js';

// Pre-refactor world.js defaults (contract.md terrain.json defaults).
const DEFAULT_TERRAIN = Object.freeze({
  ground: Object.freeze({
    size: 69.5,
    segments: 40,
    uvTile: 2.7,
    color: Object.freeze({
      base: 0.82,
      spread: 0.32,
      min: 0.55,
      max: 1.08,
      warmth: Object.freeze({ gBase: 0.98, gAmp: 0.03, gFreq: 0.9, b: 0.95 }),
    }),
  }),
  paving: Object.freeze({
    color: Object.freeze([0.8, 0.72, 0.6]),
    worldScale: 3.2,
    patches: Object.freeze([
      // central plaza
      [0, 9.8, 11.5, 10.5, 0.02],
      // staging apron
      // mid gate plaza
      [0, -4.6, 9.0, 4.2, 0.02],
      // courtyard
      [0, -14.5, 12.0, 10.0, 0.02],
      // A long
      [27.0, -14.2, 9.0, 8.0, 0.02],
      // A site
      [17.6, -24.6, 10.0, 7.4, 0.02],
      // B site
      [-18.0, -24.6, 10.0, 7.4, 0.02],
      // B tunnel
      [-27.0, -14.5, 11.4, 9.6, 0.02],
      // CT / north strip
      [0, -26.6, 17.0, 5.6, 0.02],
      // east street
      [25.5, 7.0, 4.0, 16.0, 0.02],
      // west street
      [-25.5, 7.0, 4.0, 16.0, 0.02],
    ]),
  }),
  dunes: Object.freeze({
    size: 430,
    segments: 110,
    uvTile: 9.5,
    nearMask: Object.freeze([38, 82]),
    farMask: Object.freeze([75, 190]),
    baseHeight: -0.45,
    farLift: 9.0,
    heights: Object.freeze([2.2, 5.4, 3.1, 4.5]),
    color: Object.freeze({
      base: 0.8,
      perHeight: 0.045,
      heightMid: 4,
      farDarken: 0.08,
      min: 0.55,
      max: 1.06,
      rgb: Object.freeze([1, 0.97, 0.92]),
    }),
  }),
  mesas: Object.freeze({
    seed: 9182,
    specs: Object.freeze([
      [-150, -190, 46, 62, 7], [30, -240, 58, 44, 9], [168, -180, 38, 78, 6],
      [235, 20, 30, 92, 8], [180, 160, 44, 60, 6], [-60, 235, 52, 70, 9],
      [-230, 110, 40, 48, 7], [-250, -70, 34, 85, 6],
    ]),
  }),
  skyline: Object.freeze({
    seed: 4455,
    count: 34,
    distance: Object.freeze([44, 78]),
    angleJitter: 0.11,
    width: Object.freeze([4, 15]),
    depth: Object.freeze([4, 15]),
    height: Object.freeze([4.5, 13.5]),
    parapetEvery: 3,
    minaretEvery: 6,
  }),
  haze: Object.freeze({ radius: 900, segments: 32, color: Object.freeze([0.56, 0.36, 0.2]), y: -1.1 }),
});

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const pair = (value, fallback) => (
  Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) ? value : fallback
);
const vec3 = (value, fallback) => (
  Array.isArray(value) && value.length >= 3 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2])
    ? value
    : fallback
);

/** Resolve `ctx.data.terrain` into the complete config used by the builder. */
export function resolveTerrain(terrain) {
  const t = terrain ?? {};
  const ground = t.ground ?? {};
  const groundColor = ground.color ?? {};
  const warmth = groundColor.warmth ?? {};
  const paving = t.paving ?? {};
  const dunes = t.dunes ?? {};
  const duneColor = dunes.color ?? {};
  const mesas = t.mesas ?? {};
  const skyline = t.skyline ?? {};
  const haze = t.haze ?? {};
  return {
    ground: {
      size: num(ground.size, DEFAULT_TERRAIN.ground.size),
      segments: num(ground.segments, DEFAULT_TERRAIN.ground.segments),
      uvTile: num(ground.uvTile, DEFAULT_TERRAIN.ground.uvTile),
      color: {
        base: num(groundColor.base, DEFAULT_TERRAIN.ground.color.base),
        spread: num(groundColor.spread, DEFAULT_TERRAIN.ground.color.spread),
        min: num(groundColor.min, DEFAULT_TERRAIN.ground.color.min),
        max: num(groundColor.max, DEFAULT_TERRAIN.ground.color.max),
        warmth: {
          gBase: num(warmth.gBase, DEFAULT_TERRAIN.ground.color.warmth.gBase),
          gAmp: num(warmth.gAmp, DEFAULT_TERRAIN.ground.color.warmth.gAmp),
          gFreq: num(warmth.gFreq, DEFAULT_TERRAIN.ground.color.warmth.gFreq),
          b: num(warmth.b, DEFAULT_TERRAIN.ground.color.warmth.b),
        },
      },
    },
    paving: {
      color: vec3(paving.color, DEFAULT_TERRAIN.paving.color),
      worldScale: num(paving.worldScale, DEFAULT_TERRAIN.paving.worldScale),
      patches: Array.isArray(paving.patches) ? paving.patches : DEFAULT_TERRAIN.paving.patches,
    },
    dunes: {
      size: num(dunes.size, DEFAULT_TERRAIN.dunes.size),
      segments: num(dunes.segments, DEFAULT_TERRAIN.dunes.segments),
      uvTile: num(dunes.uvTile, DEFAULT_TERRAIN.dunes.uvTile),
      nearMask: pair(dunes.nearMask, DEFAULT_TERRAIN.dunes.nearMask),
      farMask: pair(dunes.farMask, DEFAULT_TERRAIN.dunes.farMask),
      baseHeight: num(dunes.baseHeight, DEFAULT_TERRAIN.dunes.baseHeight),
      farLift: num(dunes.farLift, DEFAULT_TERRAIN.dunes.farLift),
      heights: vec3(dunes.heights, DEFAULT_TERRAIN.dunes.heights),
      color: {
        base: num(duneColor.base, DEFAULT_TERRAIN.dunes.color.base),
        perHeight: num(duneColor.perHeight, DEFAULT_TERRAIN.dunes.color.perHeight),
        heightMid: num(duneColor.heightMid, DEFAULT_TERRAIN.dunes.color.heightMid),
        farDarken: num(duneColor.farDarken, DEFAULT_TERRAIN.dunes.color.farDarken),
        min: num(duneColor.min, DEFAULT_TERRAIN.dunes.color.min),
        max: num(duneColor.max, DEFAULT_TERRAIN.dunes.color.max),
        rgb: vec3(duneColor.rgb, DEFAULT_TERRAIN.dunes.color.rgb),
      },
    },
    mesas: {
      seed: num(mesas.seed, DEFAULT_TERRAIN.mesas.seed),
      specs: Array.isArray(mesas.specs) ? mesas.specs : DEFAULT_TERRAIN.mesas.specs,
    },
    skyline: {
      seed: num(skyline.seed, DEFAULT_TERRAIN.skyline.seed),
      count: num(skyline.count, DEFAULT_TERRAIN.skyline.count),
      distance: pair(skyline.distance, DEFAULT_TERRAIN.skyline.distance),
      angleJitter: num(skyline.angleJitter, DEFAULT_TERRAIN.skyline.angleJitter),
      width: pair(skyline.width, DEFAULT_TERRAIN.skyline.width),
      depth: pair(skyline.depth, DEFAULT_TERRAIN.skyline.depth),
      height: pair(skyline.height, DEFAULT_TERRAIN.skyline.height),
      parapetEvery: num(skyline.parapetEvery, DEFAULT_TERRAIN.skyline.parapetEvery),
      minaretEvery: num(skyline.minaretEvery, DEFAULT_TERRAIN.skyline.minaretEvery),
    },
    haze: {
      radius: num(haze.radius, DEFAULT_TERRAIN.haze.radius),
      segments: num(haze.segments, DEFAULT_TERRAIN.haze.segments),
      color: vec3(haze.color, DEFAULT_TERRAIN.haze.color),
      y: num(haze.y, DEFAULT_TERRAIN.haze.y),
    },
  };
}

function buildGroundAndTerrain(ctx) {
  const scene = ctx.scene;
  const cfg = resolveTerrain(ctx.data?.terrain);

  // ---- playable sand floor (flat y = 0, always) ----
  const groundCfg = cfg.ground;
  const groundGeo = new THREE.PlaneGeometry(groundCfg.size, groundCfg.size, groundCfg.segments, groundCfg.segments);
  {
    const uv = groundGeo.attributes.uv;
    const tile = groundCfg.uvTile;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * groundCfg.size) / tile, (uv.getY(i) * groundCfg.size) / tile);
    // macro colour variation baked as vertex colours
    const pos = groundGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const colorCfg = groundCfg.color;
    const warmth = colorCfg.warmth;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const n =
        0.5 +
        0.24 * Math.sin(x * 0.16 + Math.sin(y * 0.12) * 1.2) * Math.cos(y * 0.19) +
        0.14 * Math.sin(x * 0.55 + y * 0.37) +
        0.08 * Math.sin(x * 1.7 - y * 1.3);
      const c = clamp(colorCfg.base + (n - 0.5) * colorCfg.spread, colorCfg.min, colorCfg.max);
      colors[i * 3] = c;
      colors[i * 3 + 1] = c * (warmth.gBase + warmth.gAmp * Math.sin(x * warmth.gFreq));
      colors[i * 3 + 2] = c * warmth.b;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  const ground = new THREE.Mesh(groundGeo, ctx.materials.sand);
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();
  ground.userData.surface = 'sand';
  scene.add(ground);
  ctx.ground = ground;
  ctx.collideMeshes.push(ground);
  ctx.disposables.push(groundGeo);

  // ---- paved patches (slightly raised + polygon offset) ----
  const pavingCfg = cfg.paving;
  ctx.materials.paving.color.setRGB(pavingCfg.color[0], pavingCfg.color[1], pavingCfg.color[2]);
  const pavingMat = ctx.materials.paving;
  const pavingPatches = pavingCfg.patches;
  const pavGeoList = [];
  for (const [x, z, w, d, y] of pavingPatches) {
    const g = planeGeometry(w, d, { worldScale: pavingCfg.worldScale });
    pavGeoList.push([g, matrixFor(x, y, z, -Math.PI / 2)]);
  }
  // merge paving planes into one draw call
  const mergedPav = mergeGeometries(pavGeoList.map(([g, m]) => {
    const t = transformed(g, m);
    g.dispose();
    return t;
  }));
  const pavingMesh = new THREE.Mesh(mergedPav, pavingMat);
  pavingMesh.name = 'batch:paving';
  pavingMesh.receiveShadow = true;
  pavingMesh.matrixAutoUpdate = false;
  pavingMesh.updateMatrix();
  pavingMesh.userData.surface = 'stone';
  scene.add(pavingMesh);
  ctx.collideMeshes.push(pavingMesh);
  ctx.disposables.push(mergedPav);

  // ---- surrounding dunes (one big displaced plane) ----
  const duneCfg = cfg.dunes;
  const duneColor = duneCfg.color;
  const duneHeights = duneCfg.heights;
  const [nearA, nearB] = duneCfg.nearMask;
  const [farA, farB] = duneCfg.farMask;
  const duneGeo = new THREE.PlaneGeometry(duneCfg.size, duneCfg.size, duneCfg.segments, duneCfg.segments);
  {
    duneGeo.rotateX(-Math.PI / 2);
    const pos = duneGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.max(Math.abs(x), Math.abs(z));
      const mask = smoothstep(nearA, nearB, r);
      const far = smoothstep(farA, farB, r);
      const dune =
        duneHeights[0] +
        duneHeights[1] * tileableNoise(x * 0.014 + 11.2, z * 0.014 + 4.7) +
        duneHeights[2] * tileableNoise(x * 0.031 - 3.3, z * 0.031 + 8.1) +
        duneHeights[3] * Math.pow(Math.abs(Math.sin(x * 0.028 + z * 0.016)), 1.6) * (1 - far);
      const y = duneCfg.baseHeight + mask * Math.max(0, dune - 1.5) + far * duneCfg.farLift;
      pos.setY(i, y);
      const c = clamp(duneColor.base + (dune - duneColor.heightMid) * duneColor.perHeight - far * duneColor.farDarken, duneColor.min, duneColor.max);
      colors[i * 3] = c * duneColor.rgb[0];
      colors[i * 3 + 1] = c * duneColor.rgb[1];
      colors[i * 3 + 2] = c * duneColor.rgb[2];
    }
    // UVs: world scale
    const uv = duneGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * duneCfg.size) / duneCfg.uvTile, (uv.getY(i) * duneCfg.size) / duneCfg.uvTile);
    duneGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    duneGeo.computeVertexNormals();
  }
  const duneMesh = new THREE.Mesh(duneGeo, ctx.materials.sandDune);
  duneMesh.name = 'dunes';
  duneMesh.position.y = 0;
  duneMesh.receiveShadow = true;
  duneMesh.matrixAutoUpdate = false;
  duneMesh.updateMatrix();
  scene.add(duneMesh);
  ctx.disposables.push(duneGeo);

  // ---- distant mesas (merged) ----
  const mesasCfg = cfg.mesas;
  const rockMat = ctx.materials.rock;
  const mesaRng = makeRNG(mesasCfg.seed);
  const mesaGeos = [];
  const mesaSpecs = mesasCfg.specs;
  for (const [x, z, h, r, sides] of mesaSpecs) {
    const base = cylinderWorldUV(r * (0.55 + mesaRng() * 0.2), r, h, sides, 7, false);
    const m = matrixFor(x, h / 2 - 2, z, 0, mesaRng() * TAU);
    mesaGeos.push(transformed(base, m));
    base.dispose();
    // talus skirt
    const skirt = cylinderWorldUV(r * 1.45, r * 1.8, h * 0.33, sides, 8, false);
    const ms = matrixFor(x, h * 0.16 - 2, z, 0, mesaRng() * TAU, 0, 1, 1, 1);
    mesaGeos.push(transformed(skirt, ms));
    skirt.dispose();
    // cap rock
    const cap = cylinderWorldUV(r * 0.5, r * 0.57, h * 0.14, sides, 7, false);
    mesaGeos.push(transformed(cap, matrixFor(x, h - 1.2, z, 0, mesaRng() * TAU)));
    cap.dispose();
  }
  const mergedMesas = mergeGeometries(mesaGeos);
  const mesas = new THREE.Mesh(mergedMesas, rockMat);
  mesas.name = 'mesas';
  mesas.matrixAutoUpdate = false;
  mesas.updateMatrix();
  mesas.castShadow = false;
  mesas.receiveShadow = false;
  scene.add(mesas);
  ctx.disposables.push(mergedMesas);

  // ---- adobe skyline outside the walls (layered silhouettes) ----
  const skylineCfg = cfg.skyline;
  const skylineGeos = [];
  const skyRng = makeRNG(skylineCfg.seed);
  const adobeDark = ctx.materials.adobeDark;
  const skylineCount = skylineCfg.count;
  const [distMin, distMax] = skylineCfg.distance;
  const [widthMin, widthMax] = skylineCfg.width;
  const [depthMin, depthMax] = skylineCfg.depth;
  const [heightMin, heightMax] = skylineCfg.height;
  for (let i = 0; i < skylineCount; i++) {
    const ang = (i / skylineCount) * TAU + skyRng() * skylineCfg.angleJitter;
    const dist = distMin + skyRng() * (distMax - distMin);
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const w = widthMin + skyRng() * (widthMax - widthMin);
    const d = depthMin + skyRng() * (depthMax - depthMin);
    const h = heightMin + skyRng() * (heightMax - heightMin);
    const geo = boxGeometryWorldUV(w, h, d, 3.5);
    skylineGeos.push(transformed(geo, matrixFor(x, h / 2 - 0.4, z, 0, -ang + Math.PI / 2)));
    geo.dispose();
    if (i % skylineCfg.parapetEvery === 0) {
      // rooftop parapet block
      const p = boxGeometryWorldUV(w * 0.7, 1.4, d * 0.7, 3.5);
      skylineGeos.push(transformed(p, matrixFor(x, h + 0.5, z, 0, skyRng() * TAU)));
      p.dispose();
    }
    if (i % skylineCfg.minaretEvery === 1) {
      // mud minaret
      const tower = cylinderWorldUV(0.8, 1.7, 9 + skyRng() * 6, 8, 3.5);
      skylineGeos.push(transformed(tower, matrixFor(x + w * 0.4, h + 4.5, z + d * 0.2, 0, 0)));
      tower.dispose();
    }
  }
  const mergedSkyline = mergeGeometries(skylineGeos);
  const skyline = new THREE.Mesh(mergedSkyline, adobeDark);
  skyline.name = 'skyline';
  skyline.matrixAutoUpdate = false;
  skyline.updateMatrix();
  skyline.castShadow = false;
  skyline.receiveShadow = false;
  scene.add(skyline);
  ctx.disposables.push(mergedSkyline);

  // ---- distant sand haze floor beyond the dunes ----
  const hazeCfg = cfg.haze;
  const farGeo = new THREE.CircleGeometry(hazeCfg.radius, hazeCfg.segments);
  const farMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(hazeCfg.color[0], hazeCfg.color[1], hazeCfg.color[2]), fog: true });
  const far = new THREE.Mesh(farGeo, farMat);
  far.rotation.x = -Math.PI / 2;
  far.position.y = hazeCfg.y;
  far.matrixAutoUpdate = false;
  far.updateMatrix();
  scene.add(far);
  ctx.disposables.push(farGeo, farMat);
}

/** Simple deterministic value noise used for the dune field. */
function tileableNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const h = (a, b) => {
    let n = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

export { buildGroundAndTerrain, tileableNoise };
export default buildGroundAndTerrain;
