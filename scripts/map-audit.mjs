/**
 * SANDSTRIKE map audit — automated geometric QA of the world layout.
 *
 * Opens the running dev server (http://127.0.0.1:8080 by default), waits for the
 * game + dev hooks, freezes the simulation, then runs an in-page audit:
 *
 *   1. spawn safety           playerSpawn + enemySpawns vs collisionBoxes
 *   2. box health             degenerate / duplicate / contained collision boxes
 *   3. air walls              every collision box > 0.5 m must have visual geometry
 *                             (raycast probes against world.collideMeshes)
 *   4. visual-only blockers   walkable cells whose horizontal rays hit geometry that
 *                             has no collision box (0.35 m tolerance)
 *   5. clearance/connectivity 0.5 m raster, player r=0.45 / robot r=0.58/0.72/1.05,
 *                             BFS from player spawn, only-spawn reachability
 *   6. narrow pins            corridor width < 2.4 m along X or Z
 *   7. floor checks           downward rays at every spawn + landmark
 *
 * Writes shots/map/audit.json and prints a console summary. READ-ONLY on src/.
 *
 * Usage:
 *   node scripts/map-audit.mjs
 *   BASE_URL=http://127.0.0.1:8080 node scripts/map-audit.mjs
 *   GPU=0 node scripts/map-audit.mjs          # force SwiftShader
 *   OPEN_OUT_DIR=.scratch/qa ...
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const QUALITY = process.env.QUALITY || 'medium';
const OUT_DIR = process.env.OUT_DIR || 'shots/map';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WANT_GPU = process.env.GPU !== '0';
const VIEWPORT = { width: 1280, height: 720 };
// MAP=<map-id> selects a map folder (e.g. MAP=island-01); STAGE=<stage-id> is an
// optional deep link (appended as &stage=). Default = legacy outpost-07 behaviour.
const MAP = process.env.MAP || '';
const STAGE = process.env.STAGE || '';
const URL_PARAMS = [
  'dev=1',
  `quality=${QUALITY}`,
  ...(MAP ? [`map=${MAP}`] : []),
  ...(STAGE ? [`stage=${STAGE}`] : []),
].join('&');

const SWIFTSHADER_ARGS = [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--disable-gpu-sandbox',
];
const GPU_ARGS = [
  '--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox',
];

async function openGame(useGpu) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: useGpu ? GPU_ARGS : SWIFTSHADER_ARGS,
  });
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/?${URL_PARAMS}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    () => window.__sandstrikeApp?.loaded === true && !!window.__sandstrike?.world?.collisionBoxes?.length,
    null,
    { timeout: 180000 },
  );
  return { browser, page, errors, mode: useGpu ? 'd3d11' : 'swiftshader' };
}

async function launch() {
  const order = WANT_GPU ? [true, false] : [false];
  let lastErr = null;
  for (const gpu of order) {
    const t0 = Date.now();
    try {
      const session = await openGame(gpu);
      console.log(`[load] ${session.mode} ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return session;
    } catch (err) {
      lastErr = err;
      console.warn(`[load] ${gpu ? 'd3d11' : 'swiftshader'} failed: ${String(err).slice(0, 300)}`);
    }
  }
  throw lastErr || new Error('could not load game');
}

// ---------------------------------------------------------------------------
// The audit runs entirely inside the page (no extra deps).
// ---------------------------------------------------------------------------
function runAuditInPage() {
  const S = window.__sandstrike;
  const THREE = S.THREE;
  const world = S.world;
  const scene = S.scene;
  const tStart = performance.now();
  const timings = {};

  // ======================================================================
  // 0. Raw data
  // ======================================================================
  const boxes = world.collisionBoxes.map((b, i) => ({
    i,
    minX: +b.minX, maxX: +b.maxX,
    minY: +(typeof b.minY === 'number' ? b.minY : 0),
    maxY: +b.maxY,
    minZ: +b.minZ, maxZ: +b.maxZ,
    surface: b.surface || 'unknown',
  }));
  const bounds = { ...world.mapBounds };
  const playerSpawn = { ...world.playerSpawn };
  const enemySpawns = (world.enemySpawns || []).map((s) => ({ ...s }));
  const landmarks = (world.landmarks || []).map((l) => ({ ...l }));
  const nBoxes = boxes.length;
  const round = (v, n = 3) => +Number(v).toFixed(n);

  // ======================================================================
  // 1. World triangle soup + uniform-grid ray caster
  //    (world.collideMeshes is what bullets/AI raycast against)
  // ======================================================================
  const tTri0 = performance.now();
  const meshes = [];
  const meshSeen = new Set();
  for (const m of world.collideMeshes || []) {
    if (!m || !m.isMesh) continue;
    const key = m.isInstancedMesh ? `${m.uuid}#i` : m.uuid;
    if (meshSeen.has(key)) continue;
    meshSeen.add(key);
    meshes.push(m);
  }
  const meshNames = [];
  const triFlat = [];
  const triMeshId = [];
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const instMat = new THREE.Matrix4();
  const worldMat = new THREE.Matrix4();
  function pushTriangle(a, b, c, mi) {
    triFlat.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    triMeshId.push(mi);
  }
  for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi];
    meshNames.push(mesh.name || mesh.type || `mesh${mi}`);
    const geo = mesh.geometry;
    const posAttr = geo && geo.attributes && geo.attributes.position;
    if (!posAttr) continue;
    const idx = geo.index;
    const nTri = Math.floor((idx ? idx.count : posAttr.count) / 3);
    mesh.updateMatrixWorld(true);
    if (mesh.isInstancedMesh) {
      for (let ii = 0; ii < mesh.count; ii++) {
        mesh.getMatrixAt(ii, instMat);
        worldMat.multiplyMatrices(mesh.matrixWorld, instMat);
        for (let t = 0; t < nTri; t++) {
          const a = idx ? idx.getX(t * 3) : t * 3;
          const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
          const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
          v0.fromBufferAttribute(posAttr, a).applyMatrix4(worldMat);
          v1.fromBufferAttribute(posAttr, b).applyMatrix4(worldMat);
          v2.fromBufferAttribute(posAttr, c).applyMatrix4(worldMat);
          pushTriangle(v0, v1, v2, mi);
        }
      }
    } else {
      const wm = mesh.matrixWorld;
      for (let t = 0; t < nTri; t++) {
        const a = idx ? idx.getX(t * 3) : t * 3;
        const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        v0.fromBufferAttribute(posAttr, a).applyMatrix4(wm);
        v1.fromBufferAttribute(posAttr, b).applyMatrix4(wm);
        v2.fromBufferAttribute(posAttr, c).applyMatrix4(wm);
        pushTriangle(v0, v1, v2, mi);
      }
    }
  }
  // batch groups flagged collide:false in src/world/batcher.js (dark/glass/glow/coals) still
  // leak into world.collideMeshes through the worldObjects rebuild — these are
  // intentional see-through decoration for the visual-only pass.
  const DECOR_ALLOWLIST = /^batch:(dark|glass|glowWarm|glowCyan|coals)$/;
  const rawCollideMeshes = (world.collideMeshes || []).filter((m) => m && m.isMesh).length;
  const triPos = new Float32Array(triFlat);
  const triCount = triMeshId.length;

  // uniform 3D grid (1.5 m cells) over the playable volume — sized from the live
  // world.mapBounds (+2 m margin) so the same caster works for the 66x66 outpost
  // (nx=49) and the 140x140 island (nx=97) without hardcoding.
  const GPAD = 2;
  const G = {
    x0: Math.floor((bounds.minX - GPAD) / 1.5) * 1.5,
    y0: -1,
    z0: Math.floor((bounds.minZ - GPAD) / 1.5) * 1.5,
    s: 1.5,
    ny: 10,
  };
  G.nx = Math.ceil((bounds.maxX + GPAD - G.x0) / G.s) + 1;
  G.nz = Math.ceil((bounds.maxZ + GPAD - G.z0) / G.s) + 1;
  const cellArrays = new Array(G.nx * G.ny * G.nz);
  const cellId = (ix, iy, iz) => (iz * G.nx + ix) * G.ny + iy;
  for (let t = 0; t < triCount; t++) {
    const k = t * 9;
    const ax = triPos[k], ay = triPos[k + 1], az = triPos[k + 2];
    const bx = triPos[k + 3], by = triPos[k + 4], bz = triPos[k + 5];
    const cx = triPos[k + 6], cy = triPos[k + 7], cz = triPos[k + 8];
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx);
    const minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    const minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz);
    const ix0 = Math.max(0, Math.floor((minX - G.x0) / G.s));
    const ix1 = Math.min(G.nx - 1, Math.floor((maxX - G.x0) / G.s));
    const iy0 = Math.max(0, Math.floor((minY - G.y0) / G.s));
    const iy1 = Math.min(G.ny - 1, Math.floor((maxY - G.y0) / G.s));
    const iz0 = Math.max(0, Math.floor((minZ - G.z0) / G.s));
    const iz1 = Math.min(G.nz - 1, Math.floor((maxZ - G.z0) / G.s));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iy = iy0; iy <= iy1; iy++) {
          const id = cellId(ix, iy, iz);
          let arr = cellArrays[id];
          if (!arr) { arr = []; cellArrays[id] = arr; }
          arr.push(t);
        }
      }
    }
  }
  timings.triangleSoupMs = round(performance.now() - tTri0, 1);

  const visited = new Int32Array(triCount).fill(-1);
  let rayStamp = 0;
  function triTest(ti, ox, oy, oz, dx, dy, dz, maxT) {
    const k = ti * 9;
    const ax = triPos[k], ay = triPos[k + 1], az = triPos[k + 2];
    const e1x = triPos[k + 3] - ax, e1y = triPos[k + 4] - ay, e1z = triPos[k + 5] - az;
    const e2x = triPos[k + 6] - ax, e2y = triPos[k + 7] - ay, e2z = triPos[k + 8] - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-12 && det < 1e-12) return -1;
    const inv = 1 / det;
    const tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-4 || u > 1.0001) return -1;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const vv = (dx * qx + dy * qy + dz * qz) * inv;
    if (vv < -1e-4 || u + vv > 1.0001) return -1;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (tt < 1e-4 || tt > maxT) return -1;
    return tt;
  }
  /** Raycast against world.collideMeshes. Returns {t, x,y,z, mesh} or null. */
  function raycast(ox, oy, oz, dx, dy, dz, maxT) {
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    rayStamp++;
    const stamp = rayStamp;
    let ix = Math.floor((ox - G.x0) / G.s);
    let iy = Math.floor((oy - G.y0) / G.s);
    let iz = Math.floor((oz - G.z0) / G.s);
    if (ix < 0 || ix >= G.nx || iy < 0 || iy >= G.ny || iz < 0 || iz >= G.nz) {
      // walk the origin to the grid boundary (probes are always near the map)
      return null;
    }
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > 1e-9 ? Math.abs(G.s / dx) : Infinity;
    const tDeltaY = Math.abs(dy) > 1e-9 ? Math.abs(G.s / dy) : Infinity;
    const tDeltaZ = Math.abs(dz) > 1e-9 ? Math.abs(G.s / dz) : Infinity;
    const bx = G.x0 + (ix + (stepX > 0 ? 1 : 0)) * G.s;
    const by = G.y0 + (iy + (stepY > 0 ? 1 : 0)) * G.s;
    const bz = G.z0 + (iz + (stepZ > 0 ? 1 : 0)) * G.s;
    let tMaxX = Math.abs(dx) > 1e-9 ? (bx - ox) / dx : Infinity;
    let tMaxY = Math.abs(dy) > 1e-9 ? (by - oy) / dy : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-9 ? (bz - oz) / dz : Infinity;
    let bestT = maxT;
    let bestTri = -1;
    let guard = 0;
    while (guard++ < 600) {
      const arr = cellArrays[cellId(ix, iy, iz)];
      if (arr) {
        for (let n = 0; n < arr.length; n++) {
          const ti = arr[n];
          if (visited[ti] === stamp) continue;
          visited[ti] = stamp;
          const tt = triTest(ti, ox, oy, oz, dx, dy, dz, bestT);
          if (tt >= 0 && tt < bestT) { bestT = tt; bestTri = ti; }
        }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        if (tMaxX > maxT) break;
        ix += stepX; tMaxX += tDeltaX;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > maxT) break;
        iy += stepY; tMaxY += tDeltaY;
      } else {
        if (tMaxZ > maxT) break;
        iz += stepZ; tMaxZ += tDeltaZ;
      }
      if (ix < 0 || ix >= G.nx || iy < 0 || iy >= G.ny || iz < 0 || iz >= G.nz) break;
    }
    if (bestTri < 0) return null;
    return {
      t: bestT,
      x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT,
      mesh: meshNames[triMeshId[bestTri]] || '?',
    };
  }
  timings.raycasterSetupMs = round(performance.now() - tTri0, 1);

  // ======================================================================
  // 2. Box health: degenerate / duplicate / contained
  // ======================================================================
  const degenerate = [];
  for (const b of boxes) {
    if (!(b.maxX > b.minX + 1e-4) || !(b.maxZ > b.minZ + 1e-4) || !(b.maxY > b.minY + 1e-4)) {
      degenerate.push({ index: b.i, box: b });
    }
  }
  const byKey = new Map();
  for (const b of boxes) {
    const key = [b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ].map((v) => v.toFixed(3)).join('|');
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(b.i);
  }
  const duplicates = [];
  for (const [key, ids] of byKey) if (ids.length > 1) duplicates.push({ bounds: key, indices: ids });
  const overlapEps = 1e-3;
  const contained = [];
  for (let a = 0; a < nBoxes; a++) {
    const A = boxes[a];
    for (let b = 0; b < nBoxes; b++) {
      if (a === b) continue;
      const B = boxes[b];
      if (
        A.minX >= B.minX - overlapEps && A.maxX <= B.maxX + overlapEps &&
        A.minZ >= B.minZ - overlapEps && A.maxZ <= B.maxZ + overlapEps &&
        A.minY >= B.minY - overlapEps && A.maxY <= B.maxY + overlapEps
      ) {
        const volA = (A.maxX - A.minX) * (A.maxZ - A.minZ) * (A.maxY - A.minY);
        const volB = (B.maxX - B.minX) * (B.maxZ - B.minZ) * (B.maxY - B.minY);
        contained.push({
          inner: a, outer: b,
          innerBox: A, outerBox: B,
          innerVolume: round(volA, 3), outerVolume: round(volB, 3),
          fullyHidden: A.minY >= B.minY - overlapEps && A.maxY <= B.maxY + overlapEps,
        });
      }
    }
  }
  // Significant footprint overlaps (advisory: props placed on/through each other)
  const overlaps = [];
  for (let a = 0; a < nBoxes; a++) {
    const A = boxes[a];
    for (let b = a + 1; b < nBoxes; b++) {
      const B = boxes[b];
      const ix = Math.min(A.maxX, B.maxX) - Math.max(A.minX, B.minX);
      const iz = Math.min(A.maxZ, B.maxZ) - Math.max(A.minZ, B.minZ);
      const iy = Math.min(A.maxY, B.maxY) - Math.max(A.minY, B.minY);
      if (ix <= 0.02 || iz <= 0.02 || iy <= 0.02) continue;
      const areaA = (A.maxX - A.minX) * (A.maxZ - A.minZ);
      const areaB = (B.maxX - B.minX) * (B.maxZ - B.minZ);
      const ratio = (ix * iz) / Math.max(1e-6, Math.min(areaA, areaB));
      if (ratio >= 0.6) {
        overlaps.push({
          a, b, ratio: round(ratio, 2), surfaces: [A.surface, B.surface],
          overlap: { x: round(ix), z: round(iz), y: round(iy) },
        });
      }
    }
  }
  overlaps.sort((p, q) => q.ratio - p.ratio);

  // ======================================================================
  // helpers shared by later sections
  // ======================================================================
  const insideFootprint = (b, x, z, e = 0) => x >= b.minX - e && x <= b.maxX + e && z >= b.minZ - e && z <= b.maxZ + e;
  const pointCoveredByBox = (x, y, z, hTol, yTol) => {
    for (let i = 0; i < nBoxes; i++) {
      const b = boxes[i];
      if (x >= b.minX - hTol && x <= b.maxX + hTol && z >= b.minZ - hTol && z <= b.maxZ + hTol &&
          y >= b.minY - yTol && y <= b.maxY + yTol) return b;
    }
    return null;
  };

  // ======================================================================
  // 3. Spawn safety
  // ======================================================================
  function pointSafety(x, z, y0) {
    const solids = [];
    for (const b of boxes) {
      if (!insideFootprint(b, x, z, 0)) continue;
      const overlapsBody = b.maxY > y0 + 0.05 && b.minY < y0 + 1.75;
      if (overlapsBody) solids.push({ index: b.i, surface: b.surface, box: b });
    }
    let nearest = null;
    let nearestDist = Infinity;
    for (const b of boxes) {
      if (b.maxY <= y0 + 0.35) continue; // low props are step-over clutter
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      const d = Math.hypot(dx, dz);
      if (d < nearestDist) { nearestDist = d; nearest = b; }
    }
    let headClearance = Infinity;
    let headBox = null;
    for (const b of boxes) {
      if (!insideFootprint(b, x, z, 0.15)) continue;
      if (b.minY <= y0 + 0.05 || b.minY > y0 + 3.0) continue;
      const clr = b.minY - (y0 + 1.75);
      if (clr < headClearance) { headClearance = clr; headBox = b; }
    }
    // visual prop at the feet / inside the point (downward ray against collideMeshes)
    const dh = raycast(x, y0 + 4.0, z, 0, -1, 0, 4.2);
    const visualOccupant = dh && dh.y > y0 + 0.18 && dh.y < y0 + 2.0 ? { mesh: dh.mesh, y: round(dh.y) } : null;
    // nearby visual-only prop at body height (walk-through clutter)
    let visualNear = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nh = raycast(x, y0 + 1.0, z, dx, 0, dz, 0.8);
      if (!nh || nh.t < 0.1) continue;
      const cover = pointCoveredByBox(nh.x, nh.y, nh.z, 0.35, 0.2);
      if (!cover) { visualNear = { mesh: nh.mesh, distance: round(nh.t, 2), at: { x: round(nh.x, 2), y: round(nh.y, 2), z: round(nh.z, 2) } }; break; }
    }
    return {
      x: round(x), z: round(z), y: round(y0),
      insideSolids: solids,
      nearestBlocker: nearest ? {
        index: nearest.i, surface: nearest.surface, distance: round(nearestDist),
        box: { minX: nearest.minX, maxX: nearest.maxX, minY: nearest.minY, maxY: nearest.maxY, minZ: nearest.minZ, maxZ: nearest.maxZ },
      } : null,
      headClearance: Number.isFinite(headClearance) ? round(headClearance) : null,
      overheadBox: headBox ? { index: headBox.i, minY: headBox.minY, surface: headBox.surface } : null,
      visualOccupant,
      visualNear,
      safe: solids.length === 0 && nearestDist >= 0.45,
    };
  }
  const spawnSafety = {
    player: { label: 'playerSpawn', ...pointSafety(playerSpawn.x, playerSpawn.z, playerSpawn.y || 0) },
    enemies: enemySpawns.map((s) => ({ label: s.label, ...pointSafety(s.x, s.z, s.y || 0) })),
  };

  // ======================================================================
  // 4. Floor checks (downward ray at spawns / landmarks, plus landmark-in-solid)
  // ======================================================================
  const floorObjs = [];
  // `ground` / `batch:paving` = outpost-07 floors. The island splits its floor into
  // named island-* meshes (see src/world/island-terrain.js), so include those too —
  // otherwise every beach/landmark floor check falsely reports "no floor".
  const ISLAND_FLOOR = /^island-(beach|lagoon|ground|bench)$/;
  scene.traverse((o) => {
    if (o.isMesh && (o.name === 'ground' || o.name === 'batch:paving' || ISLAND_FLOOR.test(o.name))) floorObjs.push(o);
  });
  const floorRay = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const up = new THREE.Vector3(0, 1, 0);
  function floorAt(x, z) {
    floorRay.set(new THREE.Vector3(x, 6, z), down);
    const hits = floorRay.intersectObjects(floorObjs, false);
    if (!hits.length) return null;
    return { y: round(hits[0].point.y, 3), mesh: hits[0].object.name || 'floor' };
  }
  const floorChecks = {
    spawns: [
      { kind: 'player', label: 'playerSpawn', x: playerSpawn.x, z: playerSpawn.z, floor: floorAt(playerSpawn.x, playerSpawn.z) },
      ...enemySpawns.map((s) => ({ kind: 'enemy', label: s.label, x: s.x, z: s.z, floor: floorAt(s.x, s.z) })),
    ],
    landmarks: landmarks.map((l) => ({
      kind: 'landmark', label: l.name, x: l.x, z: l.z,
      floor: floorAt(l.x, l.z),
      insideSolid: (() => {
        const hit = pointCoveredByBox(l.x, 0.9, l.z, 0.0, 0.0);
        return hit ? { index: hit.i, surface: hit.surface, maxY: hit.maxY } : null;
      })(),
    })),
  };

  // ======================================================================
  // 5. Clearance / connectivity raster (0.5 m)
  // ======================================================================
  const tClear0 = performance.now();
  const step = 0.5;
  const gx0 = bounds.minX;
  const gz0 = bounds.minZ;
  const gw = Math.round((bounds.maxX - bounds.minX) / step);
  const gh = Math.round((bounds.maxZ - bounds.minZ) / step);
  const nCells = gw * gh;
  const rules = {
    // main acceptance rule from the task: real ground blocker
    spec: (b) => b.maxY > 0.9 && b.minY < 1.2,
    // stricter: anything the player actually bumps into (step-up limit at 0.32 m)
    strict: (b) => b.maxY > 0.32 && b.minY < 1.9,
    // mirrors src/enemies.js NavGrid: maxY>0.18, minY<1.9
    nav: (b) => b.maxY > 0.18 && b.minY < 1.9,
  };
  const cellCX = (ix) => gx0 + (ix + 0.5) * step;
  const cellCZ = (iz) => gz0 + (iz + 0.5) * step;
  const cellOf = (x, z) => {
    const ix = Math.min(gw - 1, Math.max(0, Math.floor((x - gx0) / step)));
    const iz = Math.min(gh - 1, Math.max(0, Math.floor((z - gz0) / step)));
    return iz * gw + ix;
  };
  function buildBlocked(ruleName, radius) {
    const rule = rules[ruleName];
    const blocked = new Uint8Array(nCells);
    for (const b of boxes) {
      if (!rule(b)) continue;
      const minX = b.minX - radius, maxX = b.maxX + radius;
      const minZ = b.minZ - radius, maxZ = b.maxZ + radius;
      if (maxX < bounds.minX || minX > bounds.maxX || maxZ < bounds.minZ || minZ > bounds.maxZ) continue;
      const ix0 = Math.max(0, Math.floor((minX - gx0) / step) - 1);
      const ix1 = Math.min(gw - 1, Math.floor((maxX - gx0) / step) + 1);
      const iz0 = Math.max(0, Math.floor((minZ - gz0) / step) - 1);
      const iz1 = Math.min(gh - 1, Math.floor((maxZ - gz0) / step) + 1);
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = cellCZ(iz);
        if (z < minZ || z > maxZ) continue;
        const row = iz * gw;
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = cellCX(ix);
          if (x < minX || x > maxX) continue;
          blocked[row + ix] = 1;
        }
      }
    }
    return blocked;
  }
  function nearestFree(blocked, x, z, maxR = 4) {
    const start = cellOf(x, z);
    if (!blocked[start]) return { cell: start, dist: 0 };
    let best = null;
    const cx = Math.floor((x - gx0) / step);
    const cz = Math.floor((z - gz0) / step);
    for (let r = 1; r <= maxR / step; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const ix = cx + dx, iz = cz + dz;
          if (ix < 0 || ix >= gw || iz < 0 || iz >= gh) continue;
          const id = iz * gw + ix;
          if (!blocked[id]) {
            const d = Math.hypot((ix - cx) * step, (iz - cz) * step);
            if (!best || d < best.dist) best = { cell: id, dist: d, ix, iz };
          }
        }
      }
      if (best) return best;
    }
    return best;
  }
  function componentLabels(blocked) {
    const comp = new Int32Array(nCells).fill(-1);
    const queue = new Int32Array(nCells);
    const comps = [];
    let nextComp = 0;
    for (let start = 0; start < nCells; start++) {
      if (blocked[start] || comp[start] !== -1) continue;
      const id = nextComp++;
      let head = 0, tail = 0;
      queue[tail++] = start;
      comp[start] = id;
      let minIx = gw, maxIx = 0, minIz = gh, maxIz = 0;
      while (head < tail) {
        const c = queue[head++];
        const ix = c % gw;
        const iz = (c / gw) | 0;
        if (ix < minIx) minIx = ix;
        if (ix > maxIx) maxIx = ix;
        if (iz < minIz) minIz = iz;
        if (iz > maxIz) maxIz = iz;
        for (let k = 0; k < 4; k++) {
          const nx = ix + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const nz = iz + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || nx >= gw || nz < 0 || nz >= gh) continue;
          const nid = nz * gw + nx;
          if (blocked[nid] || comp[nid] !== -1) continue;
          comp[nid] = id;
          queue[tail++] = nid;
        }
      }
      comps.push({
        id, cells: tail,
        bbox: {
          minX: round(gx0 + minIx * step), maxX: round(gx0 + (maxIx + 1) * step),
          minZ: round(gz0 + minIz * step), maxZ: round(gz0 + (maxIz + 1) * step),
        },
        center: { x: round(gx0 + ((minIx + maxIx + 1) / 2) * step), z: round(gz0 + ((minIz + maxIz + 1) / 2) * step) },
      });
    }
    return { comp, comps };
  }
  const variants = {};
  const variantDefs = [
    { id: 'player_r045_spec', radius: 0.45, rule: 'spec', label: 'player r=0.45, blocker maxY>0.9' },
    { id: 'player_r045_strict', radius: 0.45, rule: 'strict', label: 'player r=0.45, blocker maxY>0.32 (actual bump)' },
    { id: 'robot_r058_nav', radius: 0.58, rule: 'nav', label: 'robot light r=0.58, nav rule' },
    { id: 'robot_r072_nav', radius: 0.72, rule: 'nav', label: 'robot heavy r=0.72, nav rule' },
    { id: 'robot_r105_nav', radius: 1.05, rule: 'nav', label: 'robot super-heavy r=1.05 (safety), nav rule' },
  ];
  for (const def of variantDefs) {
    const t0 = performance.now();
    const blocked = buildBlocked(def.rule, def.radius);
    const { comp, comps } = componentLabels(blocked);
    const playerCell = cellOf(playerSpawn.x, playerSpawn.z);
    const playerComp = blocked[playerCell] ? -1 : comp[playerCell];
    const spawnResults = enemySpawns.map((s) => {
      const cell = cellOf(s.x, s.z);
      const isBlocked = blocked[cell] === 1;
      const nf = isBlocked ? nearestFree(blocked, s.x, s.z) : null;
      const compId = isBlocked ? (nf ? comp[nf.cell] : -2) : comp[cell];
      return {
        label: s.label, x: s.x, z: s.z,
        cellBlocked: isBlocked,
        nearestFreeDistance: nf ? round(nf.dist, 2) : 0,
        reachableFromPlayer: playerComp !== -1 && compId === playerComp,
      };
    });
    const landmarkResults = landmarks.map((l) => {
      const cell = cellOf(l.x, l.z);
      const isBlocked = blocked[cell] === 1;
      const nf = isBlocked ? nearestFree(blocked, l.x, l.z) : null;
      const compId = isBlocked ? (nf ? comp[nf.cell] : -2) : comp[cell];
      return {
        name: l.name, x: l.x, z: l.z,
        cellBlocked: isBlocked,
        nearestFreeDistance: nf ? round(nf.dist, 2) : 0,
        reachableFromPlayer: playerComp !== -1 && compId === playerComp,
      };
    });
    const freeCells = nCells - blocked.reduce((acc, v) => acc + v, 0);
    const reachableCells = comps.filter((c) => c.id === playerComp).reduce((a, c) => a + c.cells, 0);
    // ---- playable-ring statistics (r <= 52 m per ISLAND_MAP_SPEC.md §1) ----------
    // The 140x140 island bounds contain a lot of open ocean that has no colliders; counting
    // it as "free" makes the raw reach % meaningless. Restrict the quota to the play ring.
    const RING_R = 52;
    let ringCells = 0, ringFreeCells = 0, ringReachCells = 0, ringBlockedCells = 0;
    const ringUnreachableByComp = new Map();
    const ringQuadrants = { NE: { free: 0, reach: 0 }, NW: { free: 0, reach: 0 }, SE: { free: 0, reach: 0 }, SW: { free: 0, reach: 0 } };
    for (let iz = 0; iz < gh; iz++) {
      for (let ix = 0; ix < gw; ix++) {
        const cx = cellCX(ix), cz = cellCZ(iz);
        if (cx * cx + cz * cz > RING_R * RING_R) continue;
        ringCells++;
        const c = iz * gw + ix;
        if (blocked[c]) { ringBlockedCells++; continue; }
        ringFreeCells++;
        const q = cx >= 0 ? (cz >= 0 ? 'SE' : 'NE') : (cz >= 0 ? 'SW' : 'NW');
        ringQuadrants[q].free++;
        if (comp[c] === playerComp) {
          ringReachCells++;
          ringQuadrants[q].reach++;
        } else {
          ringUnreachableByComp.set(comp[c], (ringUnreachableByComp.get(comp[c]) || 0) + 1);
        }
      }
    }
    const ringArea = Math.PI * RING_R * RING_R;
    const ringUnreachable = [...ringUnreachableByComp.entries()]
      .filter(([, cells]) => cells >= 8)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([compId, cells]) => {
        const cp = comps.find((c) => c.id === compId);
        return { compId, cells, center: cp ? cp.center : null, bbox: cp ? cp.bbox : null };
      });
    const playRing = {
      radius: RING_R,
      areaM2: round(ringArea, 0),
      cells: ringCells,
      freeCells: ringFreeCells,
      freeAreaM2: round(ringFreeCells * step * step, 0),
      blockedCells: ringBlockedCells,
      reachableCells: ringReachCells,
      reachablePct: ringFreeCells ? round((ringReachCells / ringFreeCells) * 100, 1) : null,
      unreachableComponents: ringUnreachable,
      quadrants: ringQuadrants,
    };
    const disconnected = comps
      .filter((c) => c.id !== playerComp && c.cells >= 4)
      .sort((a, b) => b.cells - a.cells)
      .slice(0, 12);
    variants[def.id] = {
      label: def.label, radius: def.radius, blockerRule: def.rule,
      freeCells, totalCells: nCells,
      playerSpawnCellBlocked: blocked[playerCell] === 1,
      reachableCells, reachablePct: round((reachableCells / Math.max(1, freeCells)) * 100, 1),
      playRing,
      componentCount: comps.length,
      largestComponentCells: comps.length ? Math.max(...comps.map((c) => c.cells)) : 0,
      disconnectedComponents: disconnected,
      unreachableEnemySpawns: spawnResults.filter((s) => !s.reachableFromPlayer),
      unreachableLandmarks: landmarkResults.filter((l) => !l.reachableFromPlayer),
      blockedEnemySpawnCells: spawnResults.filter((s) => s.cellBlocked),
      enemySpawns: spawnResults,
      landmarks: landmarkResults,
      buildMs: round(performance.now() - t0, 1),
    };
  }
  timings.clearanceMs = round(performance.now() - tClear0, 1);

  // ======================================================================
  // 6. Narrow corridor pins (< 2.4 m) on the player walkable raster
  // ======================================================================
  const tPin0 = performance.now();
  const pinBlocked = buildBlocked('spec', 0.45);
  const pinComp = componentLabels(pinBlocked);
  const playerPinComp = pinComp.comps.length
    ? pinComp.comp[cellOf(playerSpawn.x, playerSpawn.z)]
    : -1;
  const pinCells = [];
  const scanBoxes = boxes.filter((b) => rules.spec(b));
  const MAXSCAN = 8;
  function corridorX(x, z) {
    let left = Infinity, right = Infinity;
    let leftBox = null, rightBox = null;
    for (const b of scanBoxes) {
      if (z < b.minZ || z > b.maxZ) continue;
      if (b.maxX <= x && x - b.maxX < left) { left = x - b.maxX; leftBox = b; }
      if (b.minX >= x && b.minX - x < right) { right = b.minX - x; rightBox = b; }
    }
    if (!Number.isFinite(left) || !Number.isFinite(right) || left > MAXSCAN || right > MAXSCAN) return { width: Infinity, blockers: [] };
    return { width: left + right, blockers: [{ axis: 'x', side: 'left', index: leftBox.i, maxY: leftBox.maxY, surface: leftBox.surface }, { axis: 'x', side: 'right', index: rightBox.i, maxY: rightBox.maxY, surface: rightBox.surface }] };
  }
  function corridorZ(x, z) {
    let near = Infinity, far = Infinity;
    let nearBox = null, farBox = null;
    for (const b of scanBoxes) {
      if (x < b.minX || x > b.maxX) continue;
      if (b.maxZ <= z && z - b.maxZ < near) { near = z - b.maxZ; nearBox = b; }
      if (b.minZ >= z && b.minZ - z < far) { far = b.minZ - z; farBox = b; }
    }
    if (!Number.isFinite(near) || !Number.isFinite(far) || near > MAXSCAN || far > MAXSCAN) return { width: Infinity, blockers: [] };
    return { width: near + far, blockers: [{ axis: 'z', side: 'near', index: nearBox.i, maxY: nearBox.maxY, surface: nearBox.surface }, { axis: 'z', side: 'far', index: farBox.i, maxY: farBox.maxY, surface: farBox.surface }] };
  }
  for (let iz = 0; iz < gh; iz++) {
    for (let ix = 0; ix < gw; ix++) {
      const id = iz * gw + ix;
      if (pinBlocked[id]) continue;
      if (playerPinComp !== -1 && pinComp.comp[id] !== playerPinComp) continue;
      const x = cellCX(ix), z = cellCZ(iz);
      const rx = corridorX(x, z);
      const rz = corridorZ(x, z);
      const useX = rx.width <= rz.width;
      const best = useX ? rx : rz;
      if (best.width < 2.4) {
        pinCells.push({ id, ix, iz, x: round(x, 2), z: round(z, 2), width: round(best.width, 2), axis: useX ? 'x' : 'z', blockers: best.blockers });
      }
    }
  }
  // cluster pin cells (8-neighbour)
  const pinById = new Map(pinCells.map((p) => [p.id, p]));
  const pinSeen = new Uint8Array(nCells);
  const pins = [];
  for (const pc of pinCells) {
    if (pinSeen[pc.id]) continue;
    const stack = [pc.id];
    pinSeen[pc.id] = 1;
    let count = 0;
    let minIx = gw, maxIx = 0, minIz = gh, maxIz = 0;
    let minW = Infinity;
    let sumX = 0;
    let sumZ = 0;
    const blockerMap = new Map();
    while (stack.length) {
      const cid = stack.pop();
      const cell = pinById.get(cid);
      if (!cell) continue;
      count++;
      sumX += cell.x;
      sumZ += cell.z;
      const ix = cid % gw;
      const iz = (cid / gw) | 0;
      if (ix < minIx) minIx = ix;
      if (ix > maxIx) maxIx = ix;
      if (iz < minIz) minIz = iz;
      if (iz > maxIz) maxIz = iz;
      if (cell.width < minW) minW = cell.width;
      for (const b of cell.blockers) blockerMap.set(`${b.index}`, b);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = ix + dx, nz = iz + dz;
          if (nx < 0 || nx >= gw || nz < 0 || nz >= gh) continue;
          const nid = nz * gw + nx;
          if (pinSeen[nid] || pinBlocked[nid] || !pinById.has(nid)) continue;
          pinSeen[nid] = 1;
          stack.push(nid);
        }
      }
    }
    const blockers = [...blockerMap.values()];
    const structural = blockers.some((b) => b.maxY > 1.9);
    const propPinch = blockers.every((b) => b.maxY <= 1.9);
    pins.push({
      cells: count,
      minWidth: round(minW, 2),
      bbox: {
        minX: round(gx0 + minIx * step, 1), maxX: round(gx0 + (maxIx + 1) * step, 1),
        minZ: round(gz0 + minIz * step, 1), maxZ: round(gz0 + (maxIz + 1) * step, 1),
      },
      center: { x: round(sumX / count, 1), z: round(sumZ / count, 1) },
      blockers,
      structural: structural && !propPinch,
      propPinch,
      playerCanPass: minW > 2 * 0.45,
      robotCanPass: minW > 2 * 0.72,
    });
  }
  pins.sort((a, b) => a.minWidth - b.minWidth);
  timings.pinsMs = round(performance.now() - tPin0, 1);
  const narrowPins = {
    threshold: 2.4,
    rule: 'corridor width between spec blockers along X or Z; parent cells walkable for r=0.45',
    count: pins.length,
    structuralCount: pins.filter((p) => p.structural).length,
    propPinchCount: pins.filter((p) => p.propPinch).length,
    robotBlockedCount: pins.filter((p) => !p.robotCanPass).length,
    clusters: pins,
  };

  // ======================================================================
  // 7. AIR WALLS — collision boxes without visible geometry
  // ======================================================================
  const tAir0 = performance.now();
  const KNOWN_BOX_GROUPS = {
    'metal|0.32x0.32x3.40': 'layout.lampPosts[20] — collider only, no lamp mesh is built',
    'wood|0.34x0.34x7.60': 'layout.hero.flagpoles[2] — collider only, no pole mesh is built',
    'wood|0.26x0.26x3.30': 'layout.hero.aLongShade[3] — collider only, no A-long shade posts built',
    'wood|0.30x0.30x3.00': 'layout.hero.aPlatform[4] — corner legs collider only, deck has no legs',
    'wood|1.10x0.70x0.80': 'buildWorldData staging clutter solid (-19.5, 30.8) — no matching prop',
    'wood|1.20x0.70x0.75': 'buildWorldData staging clutter solid (19.6, 30.6) — no matching prop',
    'metal|1.00x1.00x0.70': 'buildWorldData site scrap/pallet solid — no matching prop',
  };
  const boxSignature = (b) => {
    const w = round(b.maxX - b.minX, 2);
    const d = round(b.maxZ - b.minZ, 2);
    const h = round(b.maxY - b.minY, 2);
    return `${b.surface}|${w.toFixed(2)}x${d.toFixed(2)}x${h.toFixed(2)}`;
  };
  const airWalls = [];
  const topOnlySuspects = [];
  const airChecked = [];
  const SIDE_TOL = 0.25; // horizontal tolerance around box bounds for a "visible face" hit
  for (const b of boxes) {
    const h = b.maxY - b.minY;
    if (h <= 0.5) continue;
    airChecked.push(b.i);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const ex = (b.maxX - b.minX) / 2;
    const ez = (b.maxZ - b.minZ) / 2;
    const midY = b.minY + Math.min(h * 0.55, h - 0.12);
    const probes = [
      { dir: 'x+', o: [cx + ex + 0.55, midY, cz], d: [-1, 0, 0], reach: 0.55 + 2 * ex + 0.35 },
      { dir: 'x-', o: [cx - ex - 0.55, midY, cz], d: [1, 0, 0], reach: 0.55 + 2 * ex + 0.35 },
      { dir: 'z+', o: [cx, midY, cz + ez + 0.55], d: [0, 0, -1], reach: 0.55 + 2 * ez + 0.35 },
      { dir: 'z-', o: [cx, midY, cz - ez - 0.55], d: [0, 0, 1], reach: 0.55 + 2 * ez + 0.35 },
    ];
    let sideHits = 0;
    const sideEvidence = [];
    for (const p of probes) {
      const hit = raycast(p.o[0], p.o[1], p.o[2], p.d[0], p.d[1], p.d[2], p.reach);
      const valid = !!hit &&
        hit.x >= b.minX - SIDE_TOL && hit.x <= b.maxX + SIDE_TOL &&
        hit.z >= b.minZ - SIDE_TOL && hit.z <= b.maxZ + SIDE_TOL &&
        hit.y >= b.minY - 0.15 && hit.y <= b.maxY + 0.15;
      if (valid) sideHits++;
      sideEvidence.push({
        dir: p.dir, hit: !!hit,
        hitAt: hit ? { x: round(hit.x, 2), y: round(hit.y, 2), z: round(hit.z, 2) } : null,
        hitMesh: hit ? hit.mesh : null,
        hitDistance: hit ? round(hit.t, 2) : null,
        valid,
      });
    }
    // top face probe
    const topOriginY = b.maxY + 0.55;
    const topHit = raycast(cx, topOriginY, cz, 0, -1, 0, 0.55 + h + 0.4);
    const topValid = !!topHit && Math.abs(topHit.y - b.maxY) <= 0.4 &&
      topHit.x >= b.minX - 0.2 && topHit.x <= b.maxX + 0.2 &&
      topHit.z >= b.minZ - 0.2 && topHit.z <= b.maxZ + 0.2;
    const sig = boxSignature(b);
    const entry = {
      index: b.i,
      box: { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, minZ: b.minZ, maxZ: b.maxZ },
      center: { x: round(cx, 2), y: round(midY, 2), z: round(cz, 2) },
      footprint: [round(b.maxX - b.minX, 2), round(b.maxZ - b.minZ, 2)],
      height: round(h, 2),
      surface: b.surface,
      sideHits,
      topValid,
      topHit: topHit ? { x: round(topHit.x, 2), y: round(topHit.y, 2), z: round(topHit.z, 2), mesh: topHit.mesh } : null,
      nearestSideHit: sideEvidence.find((s) => s.hit) || null,
      probes: sideEvidence,
      signature: sig,
      knownGroup: KNOWN_BOX_GROUPS[sig] || null,
    };
    if (sideHits === 0 && !topValid) {
      airWalls.push({ ...entry, kind: 'no-visual' });
    } else if (sideHits === 0 && topValid) {
      // only the ceiling/overhang above the box was hit — a real prop should show
      // its own side surfaces; this usually means the collider is an invisible leg
      // tucked under a deck/roof.
      topOnlySuspects.push({ ...entry, kind: 'top-only' });
    }
  }
  const airBySurface = {};
  for (const a of [...airWalls, ...topOnlySuspects]) airBySurface[a.surface] = (airBySurface[a.surface] || 0) + 1;
  const groupMap = new Map();
  for (const a of [...airWalls, ...topOnlySuspects]) {
    const key = a.signature;
    let g = groupMap.get(key);
    if (!g) {
      g = { signature: key, knownGroup: a.knownGroup, count: 0, kind: a.kind, indices: [], centers: [] };
      groupMap.set(key, g);
    }
    g.count++;
    g.indices.push(a.index);
    g.centers.push(`${a.center.x},${a.center.z}`);
  }
  const airGroups = [...groupMap.values()].sort((a, b) => b.count - a.count);
  timings.airWallsMs = round(performance.now() - tAir0, 1);

  // ======================================================================
  // 8. VISUAL-ONLY BLOCKERS — walkable cells, horizontal rays, no collider
  // ======================================================================
  const tVis0 = performance.now();
  const freeRaster = buildBlocked('strict', 0.05); // cells not inside any bumpable solid (+margin)
  const visSamples = [];
  for (let iz = 0; iz < gh; iz++) {
    for (let ix = 0; ix < gw; ix++) {
      const id = iz * gw + ix;
      if (freeRaster[id]) continue;
      visSamples.push({ x: cellCX(ix), z: cellCZ(iz) });
    }
  }
  const visHits = [];
  let originInside = 0;
  let decorSkipped = 0;
  const TOL_H = 0.35;
  const TOL_Y = 0.2;
  const nearestBoxDistance = (x, y, z) => {
    let best = Infinity;
    let bestBox = null;
    for (let i = 0; i < nBoxes; i++) {
      const b = boxes[i];
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      const dy = Math.max(b.minY - y, 0, y - b.maxY);
      const d = Math.hypot(dx, dy, dz);
      if (d < best) { best = d; bestBox = b; }
    }
    return { d: best, box: bestBox };
  };
  for (const p of visSamples) {
    for (let d = 0; d < 6; d++) {
      let oy = 1.0, dx = 0, dz = 0;
      if (d === 0) { dx = 1; }
      else if (d === 1) { dx = -1; }
      else if (d === 2) { dz = 1; }
      else if (d === 3) { dz = -1; }
      else { oy = 0.5; if (d === 4) dx = 1; else dz = 1; }
      const hit = raycast(p.x, oy, p.z, dx, 0, dz, 1.8);
      if (!hit) continue;
      if (hit.t < 0.2) { originInside++; continue; }
      const cover = pointCoveredByBox(hit.x, hit.y, hit.z, TOL_H, TOL_Y);
      if (cover) continue;
      if (DECOR_ALLOWLIST.test(hit.mesh)) { decorSkipped++; continue; }
      const nb = nearestBoxDistance(hit.x, hit.y, hit.z);
      visHits.push({
        from: { x: round(p.x, 2), z: round(p.z, 2) },
        hit: { x: round(hit.x, 2), y: round(hit.y, 2), z: round(hit.z, 2) },
        mesh: hit.mesh,
        probeY: oy,
        distance: round(hit.t, 2),
        dir: `${dx > 0 ? '+x' : dx < 0 ? '-x' : dz > 0 ? '+z' : '-z'}`,
        nearestBoxDistance: round(nb.d, 2),
        nearestBoxIndex: nb.box ? nb.box.i : null,
      });
    }
  }
  // cluster by rounded hit position + mesh
  const clusterMap = new Map();
  for (const h of visHits) {
    const key = `${Math.round(h.hit.x * 2) / 2}|${Math.round(h.hit.z * 2) / 2}|${h.mesh}`;
    let c = clusterMap.get(key);
    if (!c) {
      c = {
        mesh: h.mesh, x: Math.round(h.hit.x * 2) / 2, z: Math.round(h.hit.z * 2) / 2,
        yMin: h.hit.y, yMax: h.hit.y, rays: 0,
        nearestBoxDistance: h.nearestBoxDistance,
        nearestBoxIndex: h.nearestBoxIndex,
        probes: [], froms: [],
      };
      clusterMap.set(key, c);
    }
    c.rays++;
    c.yMin = Math.min(c.yMin, h.hit.y);
    c.yMax = Math.max(c.yMax, h.hit.y);
    c.nearestBoxDistance = Math.min(c.nearestBoxDistance, h.nearestBoxDistance);
    if (c.probes.length < 3) c.probes.push({ x: h.hit.x, y: h.hit.y, z: h.hit.z, probeY: h.probeY, from: h.from });
    if (c.froms.length < 3) c.froms.push(h.from);
  }
  const visClusters = [...clusterMap.values()].map((c) => {
    const nb = c.nearestBoxIndex != null ? boxes[c.nearestBoxIndex] : null;
    return {
      ...c,
      yMin: round(c.yMin, 2), yMax: round(c.yMax, 2),
      attachedToCollider: c.nearestBoxDistance <= 0.8,
      nearestBox: nb ? { index: nb.i, surface: nb.surface, maxY: nb.maxY, maxY_visible: nb.maxY } : null,
    };
  });
  visClusters.sort((a, b) => b.rays - a.rays);
  const visByMesh = {};
  for (const c of visClusters) visByMesh[c.mesh] = (visByMesh[c.mesh] || 0) + 1;
  timings.visualOnlyMs = round(performance.now() - tVis0, 1);

  // ======================================================================
  // 8b. FLOATING PROPS — instanced props / cloth flags with no support below
  // ======================================================================
  const tFloat0 = performance.now();
  const floatingProps = [];
  // Only elevated instanced props whose own collider footprint does not sit under
  // them are tested; ground props and crowns attached to trunks are excluded.
  const supportNames = new Set(['barrels']);
  const instMeshes = [];
  for (const m of meshes) if (m.isInstancedMesh && supportNames.has(m.name)) instMeshes.push(m);
  const bb = new THREE.Box3();
  const bboxScale = new THREE.Vector3();
  const instM = new THREE.Matrix4();
  const instV = new THREE.Vector3();
  for (const m of instMeshes) {
    const geo = m.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    bb.copy(geo.boundingBox);
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, instM);
      instM.decompose(instV, new THREE.Quaternion(), bboxScale);
      const bottom = instV.y + bb.min.y * bboxScale.y;
      if (bottom <= 0.32) continue; // rests on / near the floor
      // stack support: a collision box of the same prop family (base drum) directly under it
      const supportedByBox = boxes.some((b) => insideFootprint(b, instV.x, instV.z, 0.3) && b.maxY >= bottom - 0.5);
      if (supportedByBox) continue;
      floatingProps.push({
        mesh: m.name, x: round(instV.x, 2), z: round(instV.z, 2), bottom: round(bottom, 2),
        kind: 'instanced-prop-floating',
      });
    }
  }
  // flags: cloth mesh whose hinge point has nothing within 4 m below it (no pole)
  for (const obj of scene.children) {
    if (obj.name !== 'flag') continue;
    const hit = raycast(obj.position.x, obj.position.y + 0.2, obj.position.z, 0, -1, 0, 12);
    const gap = hit ? obj.position.y - hit.y : 99;
    if (gap > 4.0) {
      floatingProps.push({
        mesh: 'flag-cloth', x: round(obj.position.x, 2), z: round(obj.position.z, 2),
        bottom: round(obj.position.y - 0.75, 2), gapBelow: round(gap, 2),
        kind: 'flag-no-pole',
      });
    }
  }
  timings.floatingMs = round(performance.now() - tFloat0, 1);

  // ======================================================================
  // meta + result
  // ======================================================================
  timings.totalMs = round(performance.now() - tStart, 1);
  const surfaceCounts = {};
  for (const b of boxes) surfaceCounts[b.surface] = (surfaceCounts[b.surface] || 0) + 1;
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      url: location.href,
      mapId: (world && world.mapId) || null,
      quality: new URLSearchParams(location.search).get('quality') || 'default',
      renderer: (() => {
        const gl = S.renderer.getContext();
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
      })(),
      mapBounds: bounds,
      playerSpawn, enemySpawnCount: enemySpawns.length, landmarkCount: landmarks.length,
      collisionBoxCount: nBoxes,
      surfaceCounts,
      uniqueCollideMeshes: meshes.length,
      rawCollideMeshCount: rawCollideMeshes,
      duplicateCollideMeshEntries: rawCollideMeshes - meshes.length,
      meshTriangleCount: triCount,
      triangleCountRendered: S.renderer.info.render.triangles,
      timings,
    },
    boxHealth: {
      degenerate,
      duplicateCount: duplicates.length,
      duplicates,
      containedCount: contained.length,
      contained,
      significantOverlapCount: overlaps.length,
      significantOverlaps: overlaps.slice(0, 25),
    },
    spawnSafety,
    floorChecks,
    airWalls: {
      tested: airChecked.length,
      suspectCount: airWalls.length,
      topOnlyCount: topOnlySuspects.length,
      totalNoSideVisual: airWalls.length + topOnlySuspects.length,
      bySurface: airBySurface,
      groups: airGroups,
      suspects: airWalls,
      topOnlySuspects,
    },
    visualOnlyBlockers: {
      sampledWalkableCells: visSamples.length,
      originInsideVisualCount: originInside,
      decorAllowedSkippedHits: decorSkipped,
      rawHitCount: visHits.length,
      clusterCount: visClusters.length,
      attachedClusterCount: visClusters.filter((c) => c.attachedToCollider).length,
      freestandingClusterCount: visClusters.filter((c) => !c.attachedToCollider).length,
      tallFreestandingClusterCount: visClusters.filter((c) => !c.attachedToCollider && c.yMax >= 0.9).length,
      byMesh: visByMesh,
      clusters: visClusters,
      rawHits: visHits.slice(0, 600),
    },
    floatingProps: {
      count: floatingProps.length,
      list: floatingProps,
    },
    clearance: {
      gridStep: step,
      bounds,
      blockerRules: {
        spec: 'maxY>0.9 && minY<1.2',
        strict: 'maxY>0.32 && minY<1.9',
        nav: 'maxY>0.18 && minY<1.9 (matches src/enemies.js NavGrid)',
      },
      variants,
    },
    narrowPins,
    warnings: (window.__worldBuilt?.data?.warnings) || [],
  };
}

// ---------------------------------------------------------------------------
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const { browser, page, errors, mode } = await launch();
  try {
    // freeze + hide UI + raw render, and neutralise the always-on render loop so
    // the CPU-bound audit gets the whole main thread.
    await page.evaluate(() => {
      const S = window.__sandstrike;
      S.hideUI(true);
      S.setPostfxEnabled(false);
      S.freeze(true);
      try { S.renderer.render = () => {}; } catch (e) { /* ignore */ }
    });
    const t0 = Date.now();
    const result = await page.evaluate(runAuditInPage);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    result.meta.elapsedSeconds = Number(elapsed);
    result.meta.browserMode = mode;
    result.meta.consoleErrors = errors.slice(0, 20);

    const jsonPath = path.join(OUT_DIR, 'audit.json');
    await writeFile(jsonPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(`\n[audit] page time ${elapsed}s -> ${jsonPath}`);

    // ---- console summary ----
    const m = result.meta;
    console.log(`\n=== MAP AUDIT SUMMARY ===`);
    console.log(`boxes ${m.collisionBoxCount} | collideMeshes ${m.uniqueCollideMeshes} (${m.meshTriangleCount} tris) | draws ${m.triangleCountRendered}`);
    console.log(`spawns: player ${result.spawnSafety.player.safe ? 'SAFE' : 'UNSAFE'} | enemies unsafe: ${result.spawnSafety.enemies.filter((s) => !s.safe).map((s) => s.label).join(', ') || 'none'}`);
    console.log(`box health: degenerate ${result.boxHealth.degenerate.length} | exact-duplicate groups ${result.boxHealth.duplicateCount} | contained ${result.boxHealth.containedCount} | big-overlaps ${result.boxHealth.significantOverlapCount} | duplicate collideMesh entries ${m.duplicateCollideMeshEntries}`);
    console.log(`AIR WALLS: ${result.airWalls.suspectCount} fully invisible + ${result.airWalls.topOnlyCount} top-only = ${result.airWalls.totalNoSideVisual}/${result.airWalls.tested}  ${JSON.stringify(result.airWalls.bySurface)}`);
    for (const g of result.airWalls.groups) {
      console.log(`  - x${g.count} ${g.signature} files:${g.kind} ${g.knownGroup ? '<' + g.knownGroup + '>' : ''} centres: ${g.centers.slice(0, 22).join(' ')}`);
    }
    console.log(`VISUAL-ONLY blockers: ${result.visualOnlyBlockers.clusterCount} clusters (${result.visualOnlyBlockers.rawHitCount} probe hits): ${JSON.stringify(result.visualOnlyBlockers.byMesh)}`);
    for (const c of result.visualOnlyBlockers.clusters.slice(0, 24)) {
      console.log(`  - ${c.mesh} @ (${c.x}, ${c.z}) y ${c.yMin}..${c.yMax} rays=${c.rays} nearestBox=${c.nearestBoxDistance}m${c.attachedToCollider ? ' (attached)' : ' (freestanding)'}`);
    }
    console.log(`FLOATING PROPS: ${result.floatingProps.count}`);
    for (const c of result.floatingProps.list.slice(0, 16)) {
      console.log(`  - ${c.mesh} @ (${c.x}, ${c.z}) bottom ${c.bottom} ${c.kind}${c.gapBelow != null ? ' gapBelow ' + c.gapBelow : ''}`);
    }
    for (const [id, v] of Object.entries(result.clearance.variants)) {
      console.log(`clearance ${id}: reach ${v.reachablePct}% | comps ${v.componentCount} (largest ${v.largestComponentCells}) | blocked spawn cells ${v.blockedEnemySpawnCells.length} | unreachable spawns ${v.unreachableEnemySpawns.length} | unreachable landmarks ${v.unreachableLandmarks.map((l) => l.name).join(',') || 'none'}`);
      if (v.playRing) {
        const pr = v.playRing;
        const q = Object.entries(pr.quadrants).map(([k, vv]) => `${k} ${vv.free ? Math.round((vv.reach / vv.free) * 100) : 100}%`).join(' ');
        console.log(`  play-ring r<=${pr.radius}: reach ${pr.reachablePct}% of ${pr.freeAreaM2}m2 (${pr.freeCells} free cells) | quadrants ${q} | in-ring unreachable comps ${pr.unreachableComponents.length ? pr.unreachableComponents.map((c) => `${c.cells}c @ (${c.center ? c.center.x + ',' + c.center.z : '?'})`).join(', ') : 'none'}`);
      }
    }
    console.log(`NARROW PINS (<2.4m): ${result.narrowPins.count} (structural ${result.narrowPins.structuralCount}, prop-pinch ${result.narrowPins.propPinchCount}, robot-blocked ${result.narrowPins.robotBlockedCount})`);
    for (const p of result.narrowPins.clusters.slice(0, 15)) {
      console.log(`  - centre (${p.center.x}, ${p.center.z}) width ${p.minWidth}m bbox ${JSON.stringify(p.bbox)} cells ${p.cells} ${p.structural ? 'STRUCT' : p.propPinch ? 'PROP' : 'mixed'} playerPass ${p.playerCanPass} robotPass ${p.robotCanPass}`);
    }
    const badFloors = [...result.floorChecks.spawns, ...result.floorChecks.landmarks].filter((f) => !f.floor || Math.abs(f.floor.y) > 0.05);
    console.log(`floor: ${badFloors.length} bad floors${badFloors.length ? ' -> ' + badFloors.map((f) => `${f.label}:${f.floor ? f.floor.y : 'none'}`).join(', ') : ''}`);
    console.log(`landmarks inside solids: ${result.floorChecks.landmarks.filter((l) => l.insideSolid).map((l) => `${l.label}(${l.insideSolid.surface} maxY ${l.insideSolid.maxY})`).join(', ') || 'none'}`);
    console.log(`console errors: ${errors.length}`);
    console.log(`timings: ${JSON.stringify(result.meta.timings)}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
