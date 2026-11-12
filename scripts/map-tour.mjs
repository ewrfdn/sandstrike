/**
 * SANDSTRIKE map tour — Playwright photo pass over the whole world.
 *
 * Opens the running game (?dev=1&quality=medium by default), waits for the dev
 * hooks, hides the UI, freezes the simulation and renders raw geometry (post FX
 * off) for a complete visual review set under shots/map/:
 *
 *   plan-top / plan-top-collision / plan-top-markers   top-down 68x68m plan shots
 *   quadrant-{ne,nw,se,sw}                             angled bird's-eye views
 *   <area>__<facing>.jpg                               eye-level (y=1.7) views for
 *                                                      every landmark + required
 *                                                      map areas, 3-4 directions
 *   *-overlay.jpg                                      eye-level evidence shots with
 *                                                      the collision-box overlay on
 *
 * Output is deterministic: same camera list on every fresh load.
 *
 * Usage:
 *   node scripts/map-tour.mjs
 *   BASE_URL=http://127.0.0.1:8080 OUT_DIR=shots/map node scripts/map-tour.mjs
 *   GPU=0 node scripts/map-tour.mjs        # force SwiftShader
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
const SHOT_DELAY_MS = Number(process.env.SHOT_DELAY_MS || 130);

const SWIFTSHADER_ARGS = [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--disable-gpu-sandbox',
];
const GPU_ARGS = [
  '--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox',
];

async function openGame(useGpu) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: useGpu ? GPU_ARGS : SWIFTSHADER_ARGS });
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/?dev=1&quality=${QUALITY}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
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
  for (const useGpu of order) {
    const t0 = Date.now();
    try {
      const s = await openGame(useGpu);
      console.log(`[load] ${s.mode} ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return s;
    } catch (err) {
      lastErr = err;
      console.warn(`[load] ${useGpu ? 'd3d11' : 'swiftshader'} failed: ${String(err).slice(0, 240)}`);
    }
  }
  throw lastErr || new Error('could not load game');
}

// ---------------------------------------------------------------------------
// Page-side setup: overlay groups + camera/shot compositor
// ---------------------------------------------------------------------------
function setupPageState() {
  const S = window.__sandstrike;
  const THREE = S.THREE;
  S.hideUI(true);
  S.setPostfxEnabled(false);
  S.freeze(true);

  const boxes = new THREE.Group();
  boxes.name = 'qa-tour-boxes';
  const markers = new THREE.Group();
  markers.name = 'qa-tour-markers';
  const boundsGroup = new THREE.Group();
  boundsGroup.name = 'qa-tour-bounds';

  const fillMat = new THREE.MeshBasicMaterial({ color: 0xff2f2f, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9 });
  for (const b of S.world.collisionBoxes) {
    const w = Math.max(0.02, b.maxX - b.minX);
    const h = Math.max(0.02, b.maxY - (b.minY ?? 0));
    const d = Math.max(0.02, b.maxZ - b.minZ);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY ?? 0) + h / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const boxGeo = new THREE.BoxGeometry(w, h, d);
    boxGeo.translate(cx, cy, cz);
    const m = new THREE.Mesh(boxGeo, fillMat);
    m.renderOrder = 990;
    boxes.add(m);
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
    edgeGeo.translate(cx, cy, cz);
    const e = new THREE.LineSegments(edgeGeo, edgeMat);
    e.renderOrder = 991;
    boxes.add(e);
  }
  const sphereGeo = new THREE.SphereGeometry(0.35, 10, 8);
  const enemyMat = new THREE.MeshBasicMaterial({ color: 0x33ff66 });
  const playerMat = new THREE.MeshBasicMaterial({ color: 0x3399ff });
  for (const s of S.world.enemySpawns) {
    const m = new THREE.Mesh(sphereGeo, enemyMat);
    m.position.set(s.x, 0.7, s.z);
    m.renderOrder = 995;
    markers.add(m);
  }
  const pm = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), playerMat);
  pm.position.set(S.world.playerSpawn.x, 0.75, S.world.playerSpawn.z);
  pm.renderOrder = 996;
  markers.add(pm);
  // map bounds rectangle
  const bb = S.world.mapBounds;
  const y = 0.08;
  const pts = [
    new THREE.Vector3(bb.minX, y, bb.minZ), new THREE.Vector3(bb.maxX, y, bb.minZ),
    new THREE.Vector3(bb.maxX, y, bb.minZ), new THREE.Vector3(bb.maxX, y, bb.maxZ),
    new THREE.Vector3(bb.maxX, y, bb.maxZ), new THREE.Vector3(bb.minX, y, bb.maxZ),
    new THREE.Vector3(bb.minX, y, bb.maxZ), new THREE.Vector3(bb.minX, y, bb.minZ),
  ];
  const boundsGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const boundsLine = new THREE.LineSegments(boundsGeo, new THREE.LineBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.95 }));
  boundsLine.renderOrder = 997;
  boundsGroup.add(boundsLine);

  S.scene.add(boxes);
  S.scene.add(markers);
  S.scene.add(boundsGroup);
  boxes.visible = false;
  markers.visible = false;
  boundsGroup.visible = false;

  window.__qaTour = {
    boxes,
    markers,
    bounds: boundsGroup,
    shoot({ pos, target, fov, overlay }) {
      boxes.visible = !!(overlay && overlay.boxes);
      markers.visible = !!(overlay && overlay.markers);
      boundsGroup.visible = !!(overlay && overlay.bounds);
      S.setCamera({ pos, target, fov });
      S.renderFrame();
      return { boxesVisible: boxes.visible, pos: S.camera.position.toArray(), fov: S.camera.fov };
    },
  };
  return { boxes: S.world.collisionBoxes.length, spawns: S.world.enemySpawns.length };
}

// ---------------------------------------------------------------------------
// Camera planning
// ---------------------------------------------------------------------------
const DIRS = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};

function buildShots(boxes, bounds) {
  const shots = [];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const insideSolid = (p) => {
    for (const b of boxes) {
      const minY = b.minY ?? 0;
      if (p[1] < minY - 0.1 || p[1] > b.maxY + 0.1) continue;
      if (p[0] > b.minX - 0.3 && p[0] < b.maxX + 0.3 && p[2] > b.minZ - 0.3 && p[2] < b.maxZ + 0.3) return true;
    }
    return false;
  };
  /** eye-level camera looking at (cx, targetY, cz) from `dist` metres opposite `facing`. */
  function eyeShot(name, cx, cz, facing, dist, { targetY = 1.55, camY = 1.7, fov = 70, overlay = null } = {}) {
    const d = DIRS[facing] || DIRS.north;
    const target = [cx, targetY, cz];
    let pos = [cx - d[0] * dist, camY, cz - d[2] * dist];
    // keep the camera inside the playable bounds
    pos[0] = clamp(pos[0], bounds.minX + 0.9, bounds.maxX - 0.9);
    pos[2] = clamp(pos[2], bounds.minZ + 0.9, bounds.maxZ - 0.9);
    // shorten the boom until the camera is out of any solid (min 1.2 m)
    let k = dist;
    while (insideSolid(pos) && k > 1.2) {
      k -= 0.5;
      pos = [cx - d[0] * k, camY, cz - d[2] * k];
      pos[0] = clamp(pos[0], bounds.minX + 0.9, bounds.maxX - 0.9);
      pos[2] = clamp(pos[2], bounds.minZ + 0.9, bounds.maxZ - 0.9);
    }
    shots.push({ name, pos, target, fov, overlay, kind: 'eye' });
  }

  // ---- top-down plan shots ------------------------------------------------
  const planCam = [0, 78, 0.1];
  const planTarget = [0, 0, 0];
  shots.push({ name: 'plan-top', pos: planCam, target: planTarget, fov: 55, overlay: null, kind: 'plan' });
  shots.push({ name: 'plan-top-collision', pos: planCam, target: planTarget, fov: 55, overlay: { boxes: true }, kind: 'plan' });
  shots.push({ name: 'plan-top-markers', pos: planCam, target: planTarget, fov: 55, overlay: { boxes: true, markers: true, bounds: true }, kind: 'plan' });

  // ---- angled bird's-eye over each quadrant -------------------------------
  const quads = {
    ne: { center: [17, 0, -17], cam: [29, 20, -5] },
    nw: { center: [-17, 0, -17], cam: [-29, 20, -5] },
    se: { center: [17, 0, 17], cam: [29, 20, 29] },
    sw: { center: [-17, 0, 17], cam: [-29, 20, 29] },
  };
  for (const [key, q] of Object.entries(quads)) {
    shots.push({ name: `quadrant-${key}`, pos: q.cam, target: q.center, fov: 58, overlay: null, kind: 'birdseye' });
  }

  // ---- landmarks (every world.landmarks entry) ---------------------------
  const landmarkAreas = [
    { key: 'staging', x: 0, z: 26, dirs: ['north', 'south', 'east', 'west'], dist: 6.5, fov: 70 },
    { key: 'plaza', x: 0, z: 9.5, dirs: ['north', 'south', 'east', 'west'], dist: 7.5, fov: 70 },
    { key: 'mid-gate', x: 0, z: -8.5, dirs: ['north', 'south', 'east', 'west'], dist: 6.5, fov: 70 },
    { key: 'courtyard', x: 0, z: -15.2, dirs: ['north', 'south', 'east', 'west'], dist: 7, fov: 70 },
    { key: 'a-site', x: 17.5, z: -24, dirs: ['west', 'east', 'south'], dist: 7.5, fov: 70 },
    { key: 'b-site', x: -18, z: -24, dirs: ['east', 'west', 'south'], dist: 7.5, fov: 70 },
    { key: 'a-long', x: 27, z: -14, dirs: ['north', 'south', 'west'], dist: 6.5, fov: 70 },
    { key: 'b-tunnel', x: -27, z: -14, dirs: ['north', 'south', 'east'], dist: 6.5, fov: 70 },
    { key: 'ct-yard', x: 0, z: -29.5, dirs: ['south', 'east', 'west'], dist: 6, fov: 70 },
  ];
  for (const a of landmarkAreas) {
    for (const dir of a.dirs) eyeShot(`${a.key}__${dir}`, a.x, a.z, dir, a.dist, { fov: a.fov });
  }

  // ---- required named areas ----------------------------------------------
  const areaShots = [
    // staging apron / south wall (flagged as suspect: flag poles)
    { name: 'staging-wall__north', x: 0, z: 29, dir: 'north', dist: 6, fov: 72 },
    { name: 'staging-wall__south', x: 0, z: 29, dir: 'south', dist: 6, fov: 72 },
    { name: 'staging-wall__east', x: 4, z: 29, dir: 'east', dist: 6, fov: 72 },
    // well plaza (close in on the well)
    { name: 'well-plaza__north', x: 0, z: 9.5, dir: 'north', dist: 4.5, fov: 72 },
    { name: 'well-plaza__east', x: 0, z: 9.5, dir: 'east', dist: 4.5, fov: 72 },
    // mid gate both sides
    { name: 'mid-gate-plaza__north', x: 0, z: -8.5, dir: 'north', dist: 4.1, fov: 74 },
    { name: 'mid-gate-courtyard__south', x: 0, z: -8.5, dir: 'south', dist: 4.1, fov: 74 },
    // A long lane, both ends
    { name: 'a-long-lane__north', x: 27, z: -14, dir: 'north', dist: 5, fov: 72 },
    { name: 'a-long-lane__south', x: 27, z: -14, dir: 'south', dist: 5, fov: 72 },
    // B tunnel interior
    { name: 'b-tunnel-inside__north', x: -27, z: -14, dir: 'north', dist: 4.5, fov: 76 },
    { name: 'b-tunnel-inside__south', x: -27, z: -14, dir: 'south', dist: 4.5, fov: 76 },
    // courtyard colonnade / monument
    { name: 'courtyard-colonnade__east', x: 0, z: -15.2, dir: 'east', dist: 6, fov: 72 },
    { name: 'courtyard-colonnade__west', x: 0, z: -15.2, dir: 'west', dist: 6, fov: 72 },
    { name: 'courtyard-monument__south', x: 0, z: -15.2, dir: 'south', dist: 3.6, fov: 74 },
    // CT yard north strip
    { name: 'ct-yard-strip__south', x: 0, z: -29, dir: 'south', dist: 3.6, fov: 74 },
    { name: 'ct-yard-strip__north', x: 0, z: -29, dir: 'north', dist: 5, fov: 74 },
    { name: 'ct-yard-strip__east', x: 0, z: -29, dir: 'east', dist: 5, fov: 74 },
    // east / west streets
    { name: 'east-street__north', x: 24, z: 8, dir: 'north', dist: 6, fov: 72 },
    { name: 'east-street__south', x: 24, z: 8, dir: 'south', dist: 6, fov: 72 },
    { name: 'east-street__west', x: 24, z: 8, dir: 'west', dist: 5, fov: 72 },
    { name: 'west-street__north', x: -24, z: 8, dir: 'north', dist: 6, fov: 72 },
    { name: 'west-street__south', x: -24, z: 8, dir: 'south', dist: 6, fov: 72 },
    { name: 'west-street__east', x: -24, z: 8, dir: 'east', dist: 5, fov: 72 },
  ];
  for (const s of areaShots) eyeShot(s.name, s.x, s.z, s.dir, s.dist, { fov: s.fov });

  // ---- boundary corners (explicit cameras inset from the corner towers) ---
  const corners = [
    { key: 'corner-sw', x: -30, z: 30 },
    { key: 'corner-se', x: 30, z: 30 },
    { key: 'corner-nw', x: -30, z: -30 },
    { key: 'corner-ne', x: 30, z: -30 },
  ];
  for (const c of corners) {
    const ix = c.x > 0 ? -1 : 1; // inward
    const iz = c.z > 0 ? -1 : 1;
    const px = c.x + ix * 4.6;
    const pz = c.z + iz * 4.6;
    const pos = [clamp(px, bounds.minX + 1.2, bounds.maxX - 1.2), 1.7, clamp(pz, bounds.minZ + 1.2, bounds.maxZ - 1.2)];
    shots.push({ name: `${c.key}__tower`, pos, target: [c.x * 0.93, 2.6, c.z * 0.93], fov: 74, overlay: null, kind: 'eye' });
    shots.push({ name: `${c.key}__along-x`, pos, target: [pos[0] + ix * 11, 1.55, pos[2]], fov: 74, overlay: null, kind: 'eye' });
    shots.push({ name: `${c.key}__along-z`, pos, target: [pos[0], 1.55, pos[2] + iz * 11], fov: 74, overlay: null, kind: 'eye' });
  }

  // ---- hand-placed overrides for viewpoints that the generic orbit cannot reach
  // (mid-gate is embedded in a wall, the B tunnel colonnade splits the corridor,
  //  A site views are blocked by the warehouse row, etc.) --------------------
  const OVERRIDES = {
    'mid-gate__east': { pos: [-6.5, 1.9, -4.5], target: [10, 1.7, -8.5], fov: 72 },
    'mid-gate__west': { pos: [6.5, 1.9, -4.5], target: [-10, 1.7, -8.5], fov: 72 },
    'a-long__north': { pos: [26.6, 1.7, -10.6], target: [26.6, 1.5, -20.5], fov: 74 },
    'a-long__south': { pos: [26.6, 1.7, -20.5], target: [26.6, 1.5, -10.5], fov: 74 },
    'a-long__west': { pos: [29.6, 1.7, -14], target: [21.6, 1.6, -14], fov: 72 },
    'b-tunnel__north': { pos: [-24.4, 1.7, -10.3], target: [-24.4, 1.5, -19.5], fov: 75 },
    'b-tunnel__south': { pos: [-24.4, 1.7, -19.4], target: [-24.4, 1.5, -10.3], fov: 75 },
    'b-tunnel__east': { pos: [-30.3, 1.7, -14], target: [-24, 1.5, -14], fov: 72 },
    'b-tunnel-inside__north': { pos: [-24.5, 1.7, -12], target: [-24.5, 1.5, -19.2], fov: 76 },
    'b-tunnel-inside__south': { pos: [-24.5, 1.7, -17.6], target: [-24.5, 1.5, -10.6], fov: 76 },
    'a-long-lane__north': { pos: [26.4, 1.7, -11.2], target: [26.4, 1.5, -19.2], fov: 74 },
    'a-long-lane__south': { pos: [26.4, 1.7, -18.8], target: [26.4, 1.5, -10.2], fov: 74 },
  };
  for (const s of shots) {
    const o = OVERRIDES[s.name];
    if (!o) continue;
    s.pos = o.pos;
    s.target = o.target;
    s.fov = o.fov;
  }

  // ---- defect evidence shots (collision-box overlay on) -------------------
  const evidence = [
    // staging flags / missing flagpoles (air wall + floating cloth)
    { name: 'evidence-staging-flags__overlay', pos: [0, 1.7, 19.5], target: [0, 5.2, 31.4], fov: 64, overlay: { boxes: true } },
    // lamp posts: collision boxes without lamp meshes
    { name: 'evidence-lamp-posts__overlay', pos: [7.8, 1.7, 16.2], target: [7.8, 1.7, 20.6], fov: 72, overlay: { boxes: true } },
    // mid gate: visual doors closed but passable
    { name: 'evidence-mid-gate-doors__overlay', pos: [0, 1.7, -4.6], target: [0, 1.6, -7.8], fov: 74, overlay: { boxes: true } },
    // A site watch platform: floating deck + invisible corner legs
    { name: 'evidence-a-platform__overlay', pos: [24.4, 1.8, -24.2], target: [29.2, 2.6, -28.2], fov: 70, overlay: { boxes: true } },
    // B tunnel: central stone arcade columns with no colliders
    { name: 'evidence-b-tunnel-columns__overlay', pos: [-27, 1.7, -9.2], target: [-27, 1.5, -20], fov: 76, overlay: { boxes: true } },
    // A-long shade posts: 3 invisible collision posts, no visual posts
    { name: 'evidence-a-long-posts__overlay', pos: [26.4, 1.7, -14.3], target: [31.3, 1.7, -14.3], fov: 72, overlay: { boxes: true } },
    // loose crates with no colliders (courtyard north)
    { name: 'evidence-loose-crates__overlay', pos: [1.4, 1.7, -16.6], target: [1.4, 0.5, -20.8], fov: 68, overlay: { boxes: true } },
    // floating stacked drums beside the truck
    { name: 'evidence-floating-barrels__overlay', pos: [-14.6, 1.8, 25.4], target: [-19.6, 1.3, 28.8], fov: 68, overlay: { boxes: true } },
    // well canopy cloth floating ~0.45 m above the winch frame tops
    { name: 'evidence-well-canopy__overlay', pos: [0, 1.9, 15.2], target: [0, 3.5, 9.5], fov: 62, overlay: { boxes: true } },
    // watchtower (30.4, 29) canopy roof floats ~2.3 m above the deck with no posts
    { name: 'evidence-watchtower-canopy', pos: [21.6, 3.2, 22.4], target: [30.4, 7.8, 29.0], fov: 62, overlay: null },
  ];
  for (const e of evidence) shots.push({ ...e, kind: 'eye' });

  return shots;
}

// ---------------------------------------------------------------------------
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const { browser, page, errors, mode } = await launch();
  const started = Date.now();
  try {
    const pageInfo = await page.evaluate(setupPageState);
    const { boxes, bounds } = await page.evaluate(() => ({
      boxes: window.__sandstrike.world.collisionBoxes.map((b) => ({ minX: b.minX, maxX: b.maxX, minY: b.minY ?? 0, maxY: b.maxY, minZ: b.minZ, maxZ: b.maxZ })),
      bounds: { ...window.__sandstrike.world.mapBounds },
    }));
    console.log(`[setup] overlay built for ${pageInfo.boxes} boxes / ${pageInfo.spawns} enemy spawns (${mode})`);
    const shots = buildShots(boxes, bounds);
    console.log(`[tour] shooting ${shots.length} frames`);

    const index = [];
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      await page.evaluate((shot) => window.__qaTour.shoot(shot), s);
      await page.waitForTimeout(SHOT_DELAY_MS);
      const file = path.join(OUT_DIR, `${s.name}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 84 });
      index.push({ name: s.name, file: file.replace(/\\/g, '/'), pos: s.pos, target: s.target, fov: s.fov, overlay: s.overlay || null, kind: s.kind });
      process.stdout.write(`\r[tour] ${i + 1}/${shots.length} ${s.name}${' '.repeat(24)}`);
    }
    process.stdout.write('\n');
    const indexFile = path.join(OUT_DIR, 'tour-index.json');
    await writeFile(indexFile, JSON.stringify({ generatedAt: new Date().toISOString(), url: `${BASE}/?dev=1&quality=${QUALITY}`, browserMode: mode, shotCount: shots.length, shots: index }, null, 2), 'utf8');
    console.log(`[tour] done in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${OUT_DIR} (${shots.length} jpg) + ${indexFile}`);
    if (errors.length) {
      console.warn(`[tour] ${errors.length} console error(s):`, errors.slice(0, 8));
    } else {
      console.log('[tour] console errors: 0');
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
