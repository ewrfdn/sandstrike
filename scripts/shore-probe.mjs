/**
 * SANDSTRIKE // island shoreline QA probe — photos + beach-walk assertions.
 *
 * Owner: qa-shore. This script is a *probe*, not a game module: it launches Chrome
 * against the running dev server, drives `window.__sandstrike` / `window.__worldBuilt`
 * and writes screenshots + one JSON report. It never edits game code.
 *
 * What it proves (acceptance criteria for the island-shore rework):
 *   A. The reef stone ring is gone
 *      - no tall collision boxes in the r=47..57 band (the old boundary ring),
 *      - the ridge/boulder geometry triangle count collapsed,
 *      - no visible boulder cluster when probing the ring band from above.
 *   B. The player can walk the beach and wade the shallows
 *      - 8 bearings from r=30: feet track the sand/seabed (|player.y - groundY|),
 *      - every bearing reaches the waterline, stops at 0.5..0.85 m water depth,
 *      - no bearing escapes past r=68, spawn->sea walk works, walking *along*
 *        the waterline works.
 *   C. The sea is transparent, wavy and refracting
 *      - water mesh is no longer a 2-triangle flat film (geometry or time-driven
 *        vertex displacement), the surface animates between frames,
 *      - the seabed pattern is visible through the water (luminance correlation
 *        between the water render and the same view with the water hidden),
 *      - the water shader samples a scene/refraction texture (screen-space
 *        refraction) instead of being an analytic opaque-ish film.
 *
 * Output (OUT_DIR, default shots/shore):
 *   shore-{n,ne,e,se,s,sw,w,nw}.png     8 outward eye-level views from the beach
 *   waterline-{s,e,se}.png              waterline close-ups
 *   sea-grazing.png / sea-lagoon.png    low over-the-shallows views
 *   plan-island.png / plan-shore-s.png  top-down island + south-shore plan
 *   waves-1..4.png                      same waterline camera, 4x while UNFROZEN
 *   shore-probe.json                    every number below (JSON only, no images)
 *
 * Usage:
 *   node scripts/shore-probe.mjs                      # full pass -> shots/shore
 *   node scripts/shore-probe.mjs --verify             # quick regression pass
 *   node scripts/shore-probe.mjs --regression         # quality-tier + non-island map regression -> shots/regression
 *   OUT_DIR=shots/shore-baseline node scripts/shore-probe.mjs
 *   GPU=0 node scripts/shore-probe.mjs                # force SwiftShader
 *   POSTFX=1 node scripts/shore-probe.mjs             # keep the post stack on
 *   BASE_URL=http://127.0.0.1:8080 MAP=island-01 QUALITY=medium node scripts/shore-probe.mjs
 *
 * Exit code: 0 when every assertion passes, 1 otherwise (failure list printed).
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEWPORT = { width: 1280, height: 720 };

const OUTWARD = [
  ['n', 0, -1], ['ne', Math.SQRT1_2, -Math.SQRT1_2], ['e', 1, 0], ['se', Math.SQRT1_2, Math.SQRT1_2],
  ['s', 0, 1], ['sw', -Math.SQRT1_2, Math.SQRT1_2], ['w', -1, 0], ['nw', -Math.SQRT1_2, -Math.SQRT1_2],
];

/** Acceptance thresholds (also written into the JSON so the reviewer sees them). */
const THRESHOLDS = Object.freeze({
  stoneRingBoxesMax: 12,   // tall *stone* collision boxes left in the old reef band r=48.5..56.5
  ridgeTrisMax: 12000,     // island-terrain ridge triangles (full boulder belt was 28k)
  boulderBearingsMax: 6,   // of 16 ring-band probes with visible boulder geometry
  stopDepthMin: 0.48,      // m below the water surface (spec asks 0.5..0.85)
  stopDepthMax: 0.87,
  escapeRadius: 68,        // no bearing may end farther than this from the origin
  feetDry: 0.06,           // |player.y - groundY| on dry sand
  feetWater: 0.12,         // |player.y - groundY| in the shallows
  waveMotionMin: 0.25,     // mean |luminance delta| between wave frames (0..255)
  stripeVisibilityMin: 0.3, // contrast of a checkerboard under water vs water hidden
  detailCorrMin: 0.3,      // fallback: high-pass seabed-detail correlation through the water
  alongMoved: 2.5,         // metres walked along the waterline
  alongFeet: 0.12,         // feet-to-ground error while walking the waterline
});

const GPU_ARGS = ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox'];
const SWIFTSHADER_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'];

// ---------------------------------------------------------------------------
// browser launch (d3d11 first, SwiftShader fallback — same pattern as map-tour)
// ---------------------------------------------------------------------------
async function openGame({ baseUrl, map, quality, useGpu, loadTimeoutMs = 240000 }) {
  // SwiftShader fallback (used when d3d11 cannot create a context, e.g. another
  // Chrome session is hogging the GPU) is ~2.5x slower per pixel: drop to 960x540
  // so the full probe still finishes well under the 4 minute budget.
  const viewport = useGpu ? VIEWPORT : { width: 960, height: 540 };
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: useGpu ? GPU_ARGS : SWIFTSHADER_ARGS,
  });
  const page = await browser.newPage({ viewport });
  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 500));
    else if (m.type() === 'warning') warnings.push(m.text().slice(0, 500));
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e && e.message ? e.message : e).slice(0, 500)}`));
  const url = `${baseUrl}/?dev=1&map=${map}&quality=${quality}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    () => window.__sandstrikeApp?.loaded === true && !!window.__sandstrike?.world?.collisionBoxes?.length,
    null,
    { timeout: loadTimeoutMs },
  );
  return { browser, page, errors, warnings, url, viewport };
}

async function launch({ baseUrl, map, quality, wantGpu, loadTimeoutMs }) {
  const order = wantGpu ? [true, false] : [false];
  let lastErr = null;
  for (const useGpu of order) {
    const t0 = Date.now();
    try {
      const session = await openGame({ baseUrl, map, quality, useGpu, loadTimeoutMs });
      return { ...session, loadMs: Date.now() - t0, mode: useGpu ? 'd3d11' : 'swiftshader' };
    } catch (err) {
      lastErr = err;
      console.warn(`[load] ${useGpu ? 'd3d11' : 'swiftshader'} failed: ${String(err).slice(0, 240)}`);
    }
  }
  throw lastErr || new Error('could not load the game');
}

// ---------------------------------------------------------------------------
// page-side helpers — installed once, then called through window.__qaShore
// ---------------------------------------------------------------------------
function installQaHelpers({ postfx, waterLevelFallback }) {
  const S = window.__sandstrike;
  const THREE = S.THREE;
  const ctx = window.__worldBuilt || null;
  S.hideUI(true);
  S.setPostfxEnabled(!!postfx);
  S.freeze(true);

  // ---- viewmodel control (screenshot hygiene) ---------------------------------
  // The FPS rifle is drawn as a separate overlay by the render loop, and with the postfx
  // composer it ends up baked into photo-mode frames. Hide it for scenery shots and
  // restore it afterwards (renderOnce metrics still include it, like the before baseline).
  let viewmodelRenderOriginal = null;
  const setViewmodelVisible = (visible) => {
    const w = S.weapon;
    if (!w) return null;
    if (visible) {
      if (viewmodelRenderOriginal) {
        w.render = viewmodelRenderOriginal;
        viewmodelRenderOriginal = null;
      }
      if (w.viewScene) w.viewScene.visible = true;
    } else {
      if (!viewmodelRenderOriginal && typeof w.render === 'function') viewmodelRenderOriginal = w.render;
      w.render = () => {};
      if (w.viewScene) w.viewScene.visible = false;
    }
    return { patched: !!viewmodelRenderOriginal, viewSceneVisible: w.viewScene ? !!w.viewScene.visible : null };
  };

  // ---- ground / seabed ---------------------------------------------------------
  // Two independent sources, best first:
  //  1. `world.groundHeight(x, z)` — the authoritative walkable sand profile the
  //     player controller itself uses (island maps only; undefined on flat maps).
  //  2. a downward raycast against the sand shells (ground -> beach -> lagoon).
  // The profile source is what the feet assertions use; the raycast is kept as a
  // visual cross-check (it is what the player actually *sees* underfoot).
  const profileGroundY = (x, z) => {
    const fn = S.world?.groundHeight;
    if (typeof fn !== 'function') return null;
    try {
      const y = fn(x, z);
      return Number.isFinite(y) ? Math.round(y * 1000) / 1000 : null;
    } catch {
      return null;
    }
  };
  // Sand shells by surface tag (stable across renames), with a name fallback. The
  // reef skirt / coral / boulder batches / scatter must not count as walkable floor.
  const groundMeshes = [];
  S.scene.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.name || '';
    if (/water|surf|foam|mist|bird|coral|litter|scatter|skirt|rock/i.test(name)) return;
    if (o.userData?.surface === 'sand') groundMeshes.push(o);
    else if (/^(ground|island-(beach|lagoon|seabed|shore-?bed|wet-sand))$/i.test(name)) groundMeshes.push(o);
  });
  const rayTargets = groundMeshes.length ? groundMeshes : (S.world.collideMeshes || []);
  const rc = new THREE.Raycaster();
  rc.far = 220;
  const down = new THREE.Vector3(0, -1, 0);
  const from = new THREE.Vector3();
  const rayGroundYRaw = (x, z) => {
    if (!rayTargets.length) return null;
    rc.set(from.set(x, 80, z), down);
    const hits = rc.intersectObjects(rayTargets, false);
    // Degenerate triangles can return a NaN hit distance; keep scanning past those.
    for (let i = 0; i < hits.length; i += 1) {
      const y = hits[i].point.y;
      if (Number.isFinite(y)) return Math.round(y * 1000) / 1000;
    }
    return null;
  };
  const rayGroundY = (x, z) => {
    // A ray exactly down the x=0 / z=0 seam can slip between two triangles of the
    // radially triangulated sand shells; probe a few 1 cm offsets instead.
    const y = rayGroundYRaw(x, z);
    if (y != null) return y;
    const offsets = [[0.011, 0.007], [-0.009, 0.012], [0.013, -0.01], [-0.012, -0.008]];
    for (const d of offsets) {
      const y2 = rayGroundYRaw(x + d[0], z + d[1]);
      if (y2 != null) return y2;
    }
    return null;
  };
  const groundSource = typeof S.world?.groundHeight === 'function' ? 'world.groundHeight' : 'raycast';
  const groundY = (x, z) => (groundSource === 'world.groundHeight' ? (profileGroundY(x, z) ?? rayGroundY(x, z)) : rayGroundY(x, z));

  // ---- shared shoreline profile (island maps only) -----------------------------
  const shoreProfile = S.world?.shoreProfile || ctx?.shoreProfile || null;
  const shoreGuard = S.world?.shore || ctx?.shoreGuard || null;
  const guardRadiusAt = (bearing) => {
    try {
      const fn = shoreGuard?.guardRadiusAt || shoreProfile?.guardRadiusAt;
      if (typeof fn === 'function') {
        const r = fn(bearing);
        if (Number.isFinite(r)) return Math.round(r * 1000) / 1000;
      }
    } catch { /* not a shore map */ }
    return null;
  };
  const waterlineAt = (bearing) => {
    try {
      const fn = shoreProfile?.waterlineAt;
      if (typeof fn === 'function') {
        const r = fn(bearing);
        if (Number.isFinite(r)) return Math.round(r * 1000) / 1000;
      }
    } catch { /* not a shore map */ }
    return null;
  };
  const shoreSummary = shoreProfile ? {
    level: shoreProfile.level,
    landRadius: shoreProfile.landRadius,
    waterline: shoreProfile.waterline,
    wadeDepth: shoreProfile.wadeDepth,
    wadeRadius: shoreProfile.wadeRadius,
    guardRadius: shoreProfile.guardRadius,
    warpMin: shoreProfile.warpMin,
    warpMax: shoreProfile.warpMax,
    bedOuter: shoreProfile.bedOuter,
    lutSize: shoreProfile.lutSize,
  } : null;

  // ---- collision-box helpers (clear-corridor search for the walk probe) -------
  // Walking radially out of r=30 is blocked by *inland props* (palm trunks, ruin
  // walls, jetty posts) before the shore on a few bearings. Those are legitimate
  // map colliders, not the thing this probe tests, so each bearing picks the
  // clearest ±12° corridor and starts at the smallest reachable radius (>=30 m).
  const standBlocks = (x, z) => {
    const boxes = S.world.collisionBoxes || [];
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i];
      const minY = b.minY ?? 0;
      if (b.maxY <= 0.35 || minY > 1.6) continue; // empty floor / overhead
      if (x > b.minX - 0.62 && x < b.maxX + 0.62 && z > b.minZ - 0.62 && z < b.maxZ + 0.62) return b;
    }
    return null;
  };
  /** Highest collision-box top the player could be standing on at (x, z) (null if none). */
  const boxSupportAt = (x, z, y) => {
    const boxes = S.world.collisionBoxes || [];
    let top = null;
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i];
      if (b.maxY > (y ?? 0) + 0.32) continue; // too tall to be under the feet
      if (x <= b.minX - 0.5 || x >= b.maxX + 0.5 || z <= b.minZ - 0.5 || z >= b.maxZ + 0.5) continue;
      if (top == null || b.maxY > top) top = b.maxY;
    }
    return top == null ? null : Math.round(top * 1000) / 1000;
  };
  /** Support height + surface kind for one player pose (sand = walkable terrain). */
  const supportAt = (x, z, y) => {
    const sand = groundY(x, z);
    const box = boxSupportAt(x, z, y);
    const prop = box != null && (sand == null || box > sand + 0.05);
    const supportY = prop ? box : sand;
    return {
      sand,
      supportY,
      surface: prop ? 'prop' : (sand == null ? 'unknown' : 'sand'),
      feetOffset: supportY == null ? null : Math.round((y - supportY) * 1000) / 1000,
    };
  };
  const findCorridor = (baseAngle, { minStart = 30, maxStart = 44, scanTo = 66 } = {}) => {
    let best = null;
    for (let k = -6; k <= 6; k += 1) {
      const angle = baseAngle + k * 0.035; // ±12°
      const dx = Math.sin(angle);
      const dz = Math.cos(angle);
      // blocked intervals along this ray
      let firstBlock = scanTo;
      for (let r = minStart; r <= scanTo; r += 0.5) {
        if (standBlocks(dx * r, dz * r)) {
          firstBlock = r;
          break;
        }
      }
      // choose the smallest start radius in [minStart, maxStart] that is clear
      let startR = minStart;
      while (startR <= maxStart && (firstBlock - startR < 8 || standBlocks(dx * startR, dz * startR))) startR += 1;
      if (startR > maxStart) startR = minStart;
      const clearRun = firstBlock - startR;
      const score = clearRun - (startR - minStart) * 0.15; // prefer long runs close to 30 m
      if (!best || score > best.score) {
        best = { angle, dx, dz, startR, firstBlock, clearRun, offsetDeg: Math.round(k * 0.035 * 180 / Math.PI * 10) / 10, score };
      }
    }
    return best;
  };

  // ---- water level -------------------------------------------------------------
  const waterLevel = (() => {
    const l = ctx?.water?.level;
    if (typeof l === 'number' && Number.isFinite(l)) return l;
    const l2 = S.world?.data?.terrain?.sea?.level;
    if (typeof l2 === 'number' && Number.isFinite(l2)) return l2;
    return waterLevelFallback;
  })();

  // ---- pixel signature (raw framebuffer readback, downsampled luminance) -------
  // readPixels() straight after renderFrame() sees the freshly rendered drawing
  // buffer (it is only cleared when the frame is presented), so this gives us
  // deterministic frame-difference metrics without decoding PNGs.
  const readSignature = (cols = 48, rows = 27) => {
    const renderer = S.renderer;
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const lum = new Array(cols * rows).fill(0);
    const counts = new Array(cols * rows).fill(0);
    for (let gy = 0; gy < rows; gy += 1) {
      const y0 = Math.floor((gy * h) / rows);
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / rows));
      for (let gx = 0; gx < cols; gx += 1) {
        const x0 = Math.floor((gx * w) / cols);
        const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / cols));
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y += 3) {
          for (let x = x0; x < x1; x += 3) {
            const i = (y * w + x) * 4;
            sum += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
            n += 1;
          }
        }
        const k = gy * cols + gx;
        lum[k] = n ? sum / n : 0;
        counts[k] = n;
      }
    }
    return { cols, rows, lum };
  };

  const setCamera = (shot) => {
    let pos = shot.pos;
    if (shot.anchor === 'ground') {
      const g = groundY(shot.pos[0], shot.pos[2]);
      pos = [shot.pos[0], (g == null ? 0 : g) + shot.pos[1], shot.pos[2]];
    }
    S.setCamera({ pos, target: shot.target, fov: shot.fov });
    S.renderFrame();
    return { pos: S.camera.position.toArray().map((v) => Math.round(v * 1000) / 1000) };
  };

  // ---- water / ocean descriptor ------------------------------------------------
  // The island water builder exposes `ctx.ocean` for QA (tier / capture / uniforms /
  // stats), but its `.meshes` entries are plain `{ geometry, material }` descriptors,
  // NOT the scene objects. Discover the real meshes by their `ocean-*` materials
  // (falling back to the island-water/surf/wet-sand names) so we can toggle visibility.
  const oceanDebug = ctx?.ocean || null;
  const round3 = (v) => Math.round(v * 1000) / 1000;
  const meshStats = (mesh) => {
    if (!mesh || !mesh.geometry) return null;
    const geo = mesh.geometry;
    const verts = geo.attributes?.position?.count ?? 0;
    const tris = geo.index ? geo.index.count / 3 : verts / 3;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    return {
      name: mesh.name || '(unnamed)',
      verts,
      tris: Math.round(tris),
      visible: !!mesh.visible,
      renderOrder: mesh.renderOrder,
      materialName: mat?.name ?? null,
      materialType: mat?.type ?? null,
    };
  };
  const materialNameOf = (mesh) => (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name || '';
  const oceanMeshes = [];
  S.scene.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.name || '';
    const matName = materialNameOf(o);
    if (/^ocean-/.test(matName) || /^island-(water|surf|foam|wet)/i.test(name)) oceanMeshes.push(o);
  });
  let waterMeshes = oceanMeshes.filter((o) => /water|surf|foam/i.test(`${o.name} ${materialNameOf(o)}`));
  if (!waterMeshes.length) waterMeshes = oceanMeshes.filter((o) => !/wet.?sand/i.test(`${o.name} ${materialNameOf(o)}`));
  const wetSandMesh = oceanMeshes.find((o) => /wet.?sand/i.test(`${o.name} ${materialNameOf(o)}`)) || null;
  const surfMeshObj = oceanMeshes.find((o) => /surf|foam/i.test(`${o.name} ${materialNameOf(o)}`)) || null;
  const describeMaterial = (mat) => {
    if (!mat) return null;
    const uniforms = mat.uniforms || {};
    const textureUniforms = [];
    for (const key of Object.keys(uniforms)) {
      const v = uniforms[key]?.value;
      if (v && (v.isTexture || v.isWebGLRenderTarget || v.texture)) textureUniforms.push(key);
    }
    const vs = mat.vertexShader || '';
    const fs = mat.fragmentShader || '';
    const all = `${vs}\n${fs}`;
    return {
      type: mat.type,
      transparent: !!mat.transparent,
      depthWrite: !!mat.depthWrite,
      depthTest: !!mat.depthTest,
      side: mat.side,
      blending: mat.blending,
      uniformKeys: Object.keys(uniforms),
      textureUniforms,
      vertexShaderLen: vs.length,
      fragmentShaderLen: fs.length,
      vertexHasTime: /uTime|uWave|uTime\b|time/i.test(vs) && /uniform\s+float\s+\w*(?:time|Time)/.test(vs),
      vertexWritesPosition: /(?:transformed|position)\s*\.\s*[xyz]\s*(?:\+|-)?=/.test(vs),
      fragmentSamplers: (fs.match(/sampler2D|samplerCube|texture2D|textureCube/g) || []).length,
      refractionHints: [
        ...(textureUniforms.length ? [`texture-uniform:${textureUniforms.join(',')}`] : []),
        ...(/(?:refraction|refract|sceneColor|uScene|uDepth|screenSpace|grabPass)/i.test(all) ? ['shader-keyword'] : []),
      ],
    };
  };
  const waterInfo = {
    present: waterMeshes.length > 0,
    level: waterLevel,
    meshes: waterMeshes.map((o) => {
      const geo = o.geometry;
      const verts = geo?.attributes?.position?.count ?? 0;
      const tris = geo?.index ? geo.index.count / 3 : verts / 3;
      return {
        name: o.name,
        visible: o.visible,
        verts,
        tris: Math.round(tris),
        renderOrder: o.renderOrder,
        material: describeMaterial(Array.isArray(o.material) ? o.material[0] : o.material),
      };
    }),
  };
  const surfaceMesh = waterMeshes.find((o) => /water|ocean/i.test(o.name)) || waterMeshes[0] || null;
  const surfaceMat = surfaceMesh ? (Array.isArray(surfaceMesh.material) ? surfaceMesh.material[0] : surfaceMesh.material) : null;
  waterInfo.flatFilm = !!surfaceMesh
    && (surfaceMesh.geometry?.attributes?.position?.count ?? 0) <= 4
    && !(waterInfo.meshes.find((m) => m.name === surfaceMesh.name)?.material?.vertexHasTime);
  waterInfo.refractionHints = [...new Set(waterInfo.meshes.flatMap((m) => m.material?.refractionHints || []))];

  // Shader/uniform summary the Lead asked for: absorption, in-scatter, palette, wave budget.
  const uniformVec3 = (u, key) => {
    const v = u?.[key]?.value;
    if (!v) return null;
    if (typeof v === 'number') return v;
    if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) return [round3(v.x), round3(v.y), round3(v.z)];
    return null;
  };
  const oceanUniforms = oceanDebug?.uniforms || surfaceMat?.uniforms || {};
  const oceanInfo = {
    tier: oceanDebug?.tier ?? null,
    capture: oceanDebug?.capture ? {
      resolution: oceanDebug.capture.resolution ?? null,
      extent: oceanDebug.capture.extent ?? null,
      meshes: oceanDebug.capture.meshes ?? null,
    } : null,
    stats: oceanDebug?.stats ?? null,
    meshes: oceanMeshes.map(meshStats).filter(Boolean),
    uniforms: {
      absorb: uniformVec3(oceanUniforms, 'uAbsorb'),
      scatterShallow: uniformVec3(oceanUniforms, 'uScatterShallow'),
      scatterDeep: uniformVec3(oceanUniforms, 'uScatterDeep'),
      shallow: uniformVec3(oceanUniforms, 'uShallow'),
      deep: uniformVec3(oceanUniforms, 'uDeep'),
      fogDensity: uniformVec3(oceanUniforms, 'uFogDensity'),
      waveAmp: uniformVec3(oceanUniforms, 'uWaveAmp'),
      waveSpeed: uniformVec3(oceanUniforms, 'uWaveSpeed'),
      chopAmp: uniformVec3(oceanUniforms, 'uChopAmp'),
      shoreLevel: uniformVec3(oceanUniforms, 'uShoreLevel'),
      waveTrainCount: Array.isArray(oceanUniforms.uWaveDir?.value?.toArray ? oceanUniforms.uWaveDir.value.toArray() : oceanUniforms.uWaveDir?.value) ? (oceanUniforms.uWaveDir.value.toArray?.().length ?? null) : null,
    },
    wetSand: wetSandMesh ? meshStats(wetSandMesh) : null,
    surfMesh: surfMeshObj ? meshStats(surfMeshObj) : null,
  };
  waterInfo.ocean = oceanInfo;

  // ---- boulder-ring visual probe: raycast straight down in the old reef band ---
  const ringBoulderProbe = (bearingCount = 16) => {
    const boulders = [];
    S.scene.traverse((o) => {
      if (o.isMesh && /batch:(shoreRock|mossStone|stoneDark|reefRock)/.test(o.name || '')) boulders.push(o);
    });
    if (!boulders.length) return { meshes: 0, bearingCount, bearingHits: 0, heights: [] };
    const probeRc = new THREE.Raycaster();
    probeRc.far = 80;
    const heights = [];
    for (let i = 0; i < bearingCount; i += 1) {
      const a = (i / bearingCount) * Math.PI * 2;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      let best = null;
      for (const r of [50.5, 52.0, 53.5]) {
        probeRc.set(from.set(dx * r, 12, dz * r), down);
        const hits = probeRc.intersectObjects(boulders, false);
        if (hits.length && (best == null || hits[0].point.y > best)) best = Math.round(hits[0].point.y * 1000) / 1000;
      }
      heights.push(best);
    }
    return {
      meshes: boulders.length,
      bearingCount,
      bearingHits: heights.filter((v) => v != null && v > 0.45).length,
      heights,
    };
  };

  // ---- walk probe --------------------------------------------------------------
  // Runs the real controller: game.state must be 'playing' and player.enabled true
  // for `fastForward()` to tick player.update(). Teleport -> hold W -> step 0.25 s
  // at a time, sampling position / raycast ground / water depth.
  const walkProbe = (bearings, opts = {}) => {
    const maxSteps = opts.maxSteps ?? 48;
    const stepSec = opts.stepSec ?? 0.25;
    const P = S.player;
    const results = [];
    for (const [name, baseDx, baseDz] of bearings) {
      const baseAngle = Math.atan2(baseDx, baseDz); // map convention: x = sin(a), z = cos(a)
      const corridor = findCorridor(baseAngle, opts);
      const { dx, dz, startR, firstBlock } = corridor;
      const sx = dx * startR;
      const sz = dz * startR;
      const startGround = groundY(sx, sz);
      P.position.set(sx, startGround == null ? 0 : startGround, sz);
      P.velocity.set(0, 0, 0);
      P.yaw = Math.atan2(-dx, -dz); // camera forward = (-sin yaw, -cos yaw) = outward
      P.lookPitch = 0;
      P._keys.clear();
      P._keys.add('KeyW');
      const samples = [];
      let prevR = Math.hypot(sx, sz);
      let stall = 0;
      let steps = 0;
      for (let i = 0; i < maxSteps; i += 1) {
        S.fastForward(stepSec);
        steps += 1;
        const p = P.position;
        const r = Math.hypot(p.x, p.z);
        if (i % 4 === 3 || i === maxSteps - 1) {
          const g = groundY(p.x, p.z);
          const sup = supportAt(p.x, p.z, p.y);
          samples.push({
            t: Math.round(steps * stepSec * 100) / 100,
            x: Math.round(p.x * 100) / 100,
            y: Math.round(p.y * 1000) / 1000,
            z: Math.round(p.z * 100) / 100,
            radius: Math.round(r * 100) / 100,
            groundY: g,
            supportY: sup.supportY,
            surface: sup.surface,
            feetOffset: sup.feetOffset,
            depth: g == null ? null : Math.round((waterLevel - g) * 1000) / 1000,
            speed: Math.round(P.speed * 100) / 100,
            grounded: !!P.grounded,
          });
        }
        if (r - prevR > 0.05) {
          prevR = r;
          stall = 0;
        } else {
          stall += 1;
        }
        if (stall >= 12) break; // 3 s without outward progress: the shore stopped us / we are sliding
      }
      P._keys.clear();
      const p = P.position;
      const endR = Math.hypot(p.x, p.z);
      const endBearing = Math.atan2(p.x, p.z);
      const endGround = groundY(p.x, p.z);
      const endSup = supportAt(p.x, p.z, p.y);
      const endDepth = endGround == null ? null : waterLevel - endGround;
      const guardR = guardRadiusAt(endBearing);
      const waterlineR = waterlineAt(endBearing);
      // Why did the walk stop? The new wading guard is an exact radial clamp on the
      // shared shore profile, so an end radius sitting on guardRadiusAt(bearing) is
      // "stopped by the shore guard"; ending on the clear-corridor's first collision
      // box is an ordinary obstacle; no profile (old map) falls back to the distance
      // check against the first blocker.
      let stoppedBy = 'max-steps';
      if (stall >= 12) {
        if (guardR != null && Math.abs(endR - guardR) < 0.6) stoppedBy = 'shore-guard';
        else if (Math.abs(endR - firstBlock) < 2) stoppedBy = 'obstacle';
        else if (endDepth != null && endDepth > 0.2) stoppedBy = 'water/shore-guard';
        else stoppedBy = 'unknown-stall';
      }
      results.push({
        dir: name,
        corridor: {
          offsetDeg: corridor.offsetDeg,
          startRadius: Math.round(startR * 100) / 100,
          firstBlockerRadius: Math.round(firstBlock * 100) / 100,
          clearRun: Math.round(corridor.clearRun * 100) / 100,
        },
        outward: [Math.round(dx * 1000) / 1000, Math.round(dz * 1000) / 1000],
        steps,
        simTime: Math.round(steps * stepSec * 100) / 100,
        stoppedBy,
        start: { x: Math.round(sx * 100) / 100, z: Math.round(sz * 100) / 100, groundY: startGround },
        end: {
          x: Math.round(p.x * 100) / 100,
          y: Math.round(p.y * 1000) / 1000,
          z: Math.round(p.z * 100) / 100,
          radius: Math.round(endR * 100) / 100,
          bearingDeg: Math.round((endBearing * 180) / Math.PI * 10) / 10,
        },
        groundY: endGround,
        rayGroundY: rayGroundY(p.x, p.z),
        supportY: endSup.supportY,
        surface: endSup.surface,
        guardRadius: guardR,
        waterlineRadius: waterlineR,
        beyondGuard: guardR == null ? null : Math.round((endR - guardR) * 1000) / 1000,
        beyondWaterline: waterlineR == null ? null : Math.round((endR - waterlineR) * 1000) / 1000,
        feetOffset: endSup.feetOffset,
        depth: endDepth == null ? null : Math.round(endDepth * 1000) / 1000,
        grounded: !!P.grounded,
        speed: Math.round(P.speed * 100) / 100,
        samples,
      });
    }
    return results;
  };

  /** Walk forward from the real player spawn (facing the sea) — "spawn to beach". */
  const spawnWalk = (maxSteps = 48, stepSec = 0.25) => {
    const P = S.player;
    const spawn = S.world.playerSpawn || { x: 0, z: 46 };
    const startGround = groundY(spawn.x, spawn.z);
    P.position.set(spawn.x, startGround == null ? 0 : startGround, spawn.z);
    P.velocity.set(0, 0, 0);
    // spawn.yaw 0 faces north (inland): face due south / out to sea
    P.yaw = Math.PI;
    P._keys.clear();
    P._keys.add('KeyW');
    let steps = 0;
    let prevR = Math.hypot(P.position.x, P.position.z);
    let stall = 0;
    const samples = [];
    for (let i = 0; i < maxSteps; i += 1) {
      S.fastForward(stepSec);
      steps += 1;
      const p = P.position;
      const r = Math.hypot(p.x, p.z);
      if (i % 4 === 3 || i === maxSteps - 1) {
        const g = groundY(p.x, p.z);
        samples.push({ t: Math.round(steps * stepSec * 100) / 100, radius: Math.round(r * 100) / 100, y: Math.round(p.y * 1000) / 1000, groundY: g });
      }
      if (r - prevR > 0.05) {
        prevR = r;
        stall = 0;
      } else {
        stall += 1;
      }
      if (stall >= 12) break;
      if (r > 66) break;
    }
    P._keys.clear();
    const p = P.position;
    const g = groundY(p.x, p.z);
    return {
      spawn: { x: spawn.x, z: spawn.z, yaw: spawn.yaw ?? 0 },
      steps,
      simTime: Math.round(steps * stepSec * 100) / 100,
      end: { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 1000) / 1000, z: Math.round(p.z * 100) / 100, radius: Math.round(Math.hypot(p.x, p.z) * 100) / 100 },
      groundY: g,
      feetOffset: g == null ? null : Math.round((p.y - g) * 1000) / 1000,
      depth: g == null ? null : Math.round((waterLevel - g) * 1000) / 1000,
      samples,
    };
  };

  /** Teleport the player to the radius where the water is `targetDepth` deep, settle. */
  const kneeDepthProbe = (directions, targetDepth = 0.6) => {
    const P = S.player;
    const out = [];
    for (const [name, dx, dz] of directions) {
      let found = null;
      for (let r = 46; r <= 68; r += 0.25) {
        const x = dx * r;
        const z = dz * r;
        const g = groundY(x, z);
        if (g == null) continue;
        const d = waterLevel - g;
        if (d >= targetDepth) {
          found = { r, x, z, groundY: g, depth: d };
          break;
        }
      }
      if (!found) {
        out.push({ dir: name, found: false });
        continue;
      }
      P.position.set(found.x, found.groundY, found.z);
      P.velocity.set(0, 0, 0);
      P.yaw = Math.atan2(-dx, -dz);
      P._keys.clear();
      S.fastForward(0.5); // let the controller settle on the seabed
      S.fastForward(0.25);
      const p = P.position;
      const g = groundY(p.x, p.z);
      out.push({
        dir: name,
        found: true,
        target: { radius: Math.round(found.r * 100) / 100, groundY: found.groundY, depth: Math.round(found.depth * 1000) / 1000 },
        end: { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 1000) / 1000, z: Math.round(p.z * 100) / 100, radius: Math.round(Math.hypot(p.x, p.z) * 100) / 100 },
        groundY: g,
        feetOffset: g == null ? null : Math.round((p.y - g) * 1000) / 1000,
        depth: g == null ? null : Math.round((waterLevel - g) * 1000) / 1000,
        grounded: !!P.grounded,
      });
    }
    return out;
  };

  /** Walk tangentially along the waterline (the "walk the beach edge" feel test). */
  const alongBeachProbe = (dir = ['s', 0, 1], targetDepth = 0.45, seconds = 4) => {
    const P = S.player;
    const [name, dx, dz] = dir;
    let found = null;
    for (let r = 46; r <= 68; r += 0.25) {
      const g = groundY(dx * r, dz * r);
      if (g != null && waterLevel - g >= targetDepth) {
        found = { r, x: dx * r, z: dz * r, groundY: g };
        break;
      }
    }
    if (!found) return { found: false };
    // outward bearing (dx,dz) -> tangent bearing (dz,-dx) (turn left / east for s)
    const tx = dz;
    const tz = -dx;
    P.position.set(found.x, found.groundY, found.z);
    P.velocity.set(0, 0, 0);
    P.yaw = Math.atan2(-tx, -tz);
    P.lookPitch = 0;
    P._keys.clear();
    P._keys.add('KeyW');
    const start = { x: found.x, z: found.z };
    let maxFeet = 0;
    const stepSec = 0.25;
    const steps = Math.round(seconds / stepSec);
    const samples = [];
    for (let i = 0; i < steps; i += 1) {
      S.fastForward(stepSec);
      const p = P.position;
      const g = groundY(p.x, p.z);
      if (g != null) maxFeet = Math.max(maxFeet, Math.abs(p.y - g));
      if (i % 4 === 3) samples.push({ t: Math.round((i + 1) * stepSec * 100) / 100, radius: Math.round(Math.hypot(p.x, p.z) * 100) / 100, y: Math.round(p.y * 1000) / 1000, groundY: g });
    }
    P._keys.clear();
    const p = P.position;
    const moved = Math.hypot(p.x - start.x, p.z - start.z);
    const g = groundY(p.x, p.z);
    return {
      found: true,
      dir: name,
      startRadius: Math.round(found.r * 100) / 100,
      moved: Math.round(moved * 100) / 100,
      radialDrift: Math.round((Math.hypot(p.x, p.z) - found.r) * 100) / 100,
      maxFeetOffset: Math.round(maxFeet * 1000) / 1000,
      end: { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 1000) / 1000, z: Math.round(p.z * 100) / 100, radius: Math.round(Math.hypot(p.x, p.z) * 100) / 100 },
      groundY: g,
      depth: g == null ? null : Math.round((waterLevel - g) * 1000) / 1000,
      samples,
    };
  };

  // ---- staged "walk into the sea" frames ---------------------------------------
  // Pure evidence shots: put the player on the south bearing at a given radius, let the
  // controller settle/clamp, then take an eye-level POV looking straight out to sea. The
  // three frames (dry beach / ankle depth / stopped at the guard) are the user-facing
  // proof that the beach can be walked down to the water and waded.
  const stageSeaWalk = (radius) => {
    const P = S.player;
    const dx = 0;
    const dz = 1; // south
    const g0 = groundY(dx * radius, dz * radius);
    P.position.set(dx * radius, g0 == null ? 0 : g0, dz * radius);
    P.velocity.set(0, 0, 0);
    P.yaw = Math.atan2(-dx, -dz);
    P.lookPitch = 0;
    P._keys.clear();
    S.fastForward(0.35); // settle onto the sand (or let the guard clamp an over-reach)
    const p = P.position;
    const g = groundY(p.x, p.z);
    const bearing = Math.atan2(p.x, p.z);
    const ground = g == null ? 0 : g;
    const eyeY = ground + 1.62;
    // Pitch the POV down ~13 deg so the foreground sand/waterline is in frame as well as
    // the sea; a flat forward look shows only water and does not read as "standing on the beach".
    S.setCamera({ pos: [p.x, eyeY, p.z], target: [p.x + dx * 10, eyeY - 2.4, p.z + dz * 10], fov: 68 });
    S.renderFrame();
    const guardR = guardRadiusAt(bearing);
    const rNow = Math.hypot(p.x, p.z);
    return {
      radiusAsked: radius,
      radius: Math.round(rNow * 100) / 100,
      pos: [Math.round(p.x * 100) / 100, Math.round(p.y * 1000) / 1000, Math.round(p.z * 100) / 100],
      groundY: g,
      depth: g == null ? null : Math.round((waterLevel - g) * 1000) / 1000,
      feetOffset: Math.round((p.y - ground) * 1000) / 1000,
      waterline: waterlineAt(bearing) == null ? null : Math.round(waterlineAt(bearing) * 100) / 100,
      guardRadius: guardR == null ? null : Math.round(guardR * 100) / 100,
      stoppedAtGuard: guardR != null && Math.abs(rNow - guardR) < 0.3,
      eye: [Math.round(p.x * 100) / 100, Math.round(eyeY * 1000) / 1000, Math.round(p.z * 100) / 100],
    };
  };

  // ---- transparency probe -------------------------------------------------------
  // The ocean refracts a baked top-down seabed capture (`ctx.ocean.capture`), and the
  // builder exposes `ctx.ocean.recapture()` for QA. So we put a black/white checkerboard
  // just under the water surface, tag it `userData.seabed`, re-bake the capture (the
  // checkerboard is then part of "what is under the water") and render a top-down view:
  //   - transparent/refracting water → checkerboard clearly visible through it,
  //   - opaque film                  → contrast collapses,
  // then we restore the original capture + remove the plane. The high-pass correlation
  // between the water-on/water-off frames is recorded as a second, implementation-agnostic
  // number (real seabed detail retained through the water).
  const transparencyProbe = () => {
    const level = waterLevel;
    // find a shallow spot on the south beach where the water is ~0.45 m deep
    let spot = null;
    for (let r = 52; r <= 68; r += 0.25) {
      const x = 0;
      const z = r;
      const g = groundY(x, z);
      if (g == null) continue;
      const d = level - g;
      if (d >= 0.42) {
        spot = { x, z, r, groundY: g, depth: d };
        break;
      }
    }
    if (!spot) return { found: false };
    // 6x6 m checkerboard with 4x4 checks (1.5 m cells) just below the surface.
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const g2 = canvas.getContext('2d');
    for (let cy = 0; cy < 4; cy += 1) {
      for (let cx = 0; cx < 4; cx += 1) {
        g2.fillStyle = (cx + cy) % 2 ? '#ffffff' : '#000000';
        g2.fillRect(cx * 64, cy * 64, 64, 64);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, fog: false });
    const geo = new THREE.PlaneGeometry(6, 6);
    const plane = new THREE.Mesh(geo, mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(spot.x, level - 0.12, spot.z);
    plane.renderOrder = 1;
    plane.userData.seabed = true; // picked up by the ocean's capture
    S.scene.add(plane);
    const ocean = ctx?.ocean || null;
    const prevSeabedTexture = ocean?.uniforms?.uSeabed?.value ?? null;
    let recaptured = null;
    let recaptureUsed = false;
    let recaptureError = null;
    try {
      if (ocean && typeof ocean.recapture === 'function') {
        recaptured = ocean.recapture();
        if (recaptured?.texture && ocean.uniforms?.uSeabed) {
          ocean.uniforms.uSeabed.value = recaptured.texture;
          recaptureUsed = true;
        }
      }
    } catch (err) {
      recaptureError = String(err && err.message ? err.message : err);
      recaptured = null;
    }
    const cam = { pos: [spot.x, 15, spot.z + 0.001], target: [spot.x, level - 0.4, spot.z], fov: 52 };
    S.setCamera(cam);
    S.renderFrame();
    const withWater = readSignature(64, 36);
    const hidden = window.__qaShore.setWaterVisible(false);
    S.renderFrame();
    const withoutWater = readSignature(64, 36);
    window.__qaShore.setWaterVisible(true);
    // restore the original capture + remove the QA plane
    try {
      if (ocean?.uniforms?.uSeabed && prevSeabedTexture) ocean.uniforms.uSeabed.value = prevSeabedTexture;
      recaptured?.target?.dispose?.();
    } catch { /* restore is best-effort */ }
    S.scene.remove(plane);
    geo.dispose();
    mat.dispose();
    tex.dispose();
    S.renderFrame();
    // contrast inside the checkerboard footprint (central crop of the top-down view)
    const cropStd = (sig) => {
      const vals = [];
      for (let gy = 10; gy <= 25; gy += 1) {
        for (let gx = 25; gx <= 39; gx += 1) vals.push(sig.lum[gy * sig.cols + gx]);
      }
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      const v = vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length;
      return Math.round(Math.sqrt(v) * 100) / 100;
    };
    const stdWith = cropStd(withWater);
    const stdWithout = cropStd(withoutWater);
    return {
      found: true,
      view: 'top-down over shallow lagoon + seabed-capture checkerboard',
      cam,
      spot: { x: spot.x, z: spot.z, radius: Math.round(spot.r * 100) / 100, depth: Math.round(spot.depth * 1000) / 1000 },
      hiddenMeshes: hidden,
      recaptureUsed,
      recaptureError,
      captureResolution: recaptured?.resolution ?? ocean?.capture?.resolution ?? null,
      stdWithWater: stdWith,
      stdWithoutWater: stdWithout,
      stripeVisibility: stdWithout > 0.1 ? Math.round((stdWith * 1000) / stdWithout) / 1000 : null,
      withWater,
      withoutWater,
    };
  };

  // ---- genus helpers used by the Node side ------------------------------------
  window.__qaShore = {
    groundY,
    waterLevel,
    readSignature,
    setCamera,
    walkProbe,
    spawnWalk,
    kneeDepthProbe,
    alongBeachProbe,
    stageSeaWalk,
    ringBoulderProbe,
    transparencyProbe,
    setViewmodelVisible,
    waterInfo,
    surfaceMeshName: surfaceMesh ? surfaceMesh.name : null,
    /** current animated time of the water material(s), for the wave strip */
    waterTimes: () => waterMeshes.map((o) => {
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const u = mat?.uniforms || {};
      for (const key of ['uTime', 'uWaveTime', 'uTimeSec', 'time']) {
        if (u[key] && typeof u[key].value === 'number') return { mesh: o.name, key, value: Math.round(u[key].value * 1000) / 1000 };
      }
      return { mesh: o.name, key: null, value: null };
    }),
    /** hide/show every water/surf/foam mesh (transparency correlation test) */
    setWaterVisible: (visible) => {
      for (const o of waterMeshes) o.visible = visible;
      return waterMeshes.map((o) => o.name);
    },
    /** render current camera + read signature (for wave strip frames) */
    frameStats: () => {
      S.renderFrame();
      return { signature: readSignature(32, 18), times: window.__qaShore.waterTimes() };
    },
  };

  // ---- environment dump --------------------------------------------------------
  const terrain = ctx?.data?.terrain ?? null;
  const collisionBoxes = (S.world.collisionBoxes || []).map((b) => ({
    minX: b.minX, maxX: b.maxX, minY: b.minY ?? 0, maxY: b.maxY, minZ: b.minZ, maxZ: b.maxZ, surface: b.surface ?? null,
  }));
  const sceneGround = groundMeshes.map((m) => ({ name: m.name, verts: m.geometry?.attributes?.position?.count ?? 0 }));
  return {
    mapId: S.mapId,
    mapName: S.mapName,
    rawState: S.state,
    quality: S.quality,
    boxes: collisionBoxes,
    bounds: S.world.mapBounds,
    terrainTris: ctx?.terrainTris ?? null,
    terrainRidgeTris: ctx?.terrainRidgeTris ?? null,
    terrain,
    groundMeshes: sceneGround,
    rayTargetNames: rayTargets.map((m) => m.name || '(unnamed)'),
    groundSource,
    shore: shoreSummary,
    water: waterInfo,
    ocean: oceanInfo,
    hooks: {
      worldGroundHeight: typeof S.world.groundHeight,
      worldShoreProfile: typeof S.world.shoreProfile,
      worldShore: typeof S.world.shore,
      worldTerrain: typeof S.world.terrain,
      ctxGroundHeight: typeof ctx?.groundHeight,
      ctxShoreProfile: typeof ctx?.shoreProfile,
      ctxShoreGuard: typeof ctx?.shoreGuard,
      ctxWater: !!ctx?.water,
    },
    renderInfo: {
      autoReset: S.renderer.info.autoReset,
    },
  };
}

// ---------------------------------------------------------------------------
// Node-side analysis helpers
// ---------------------------------------------------------------------------
function analyzeCollision(boxes) {
  const tally = new Map();
  const ring = [];
  const stoneRing = [];
  for (const b of boxes) {
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const r = Math.hypot(cx, cz);
    const h = b.maxY - b.minY;
    const key = b.surface || '(none)';
    tally.set(key, (tally.get(key) || 0) + 1);
    if (r >= 47 && r <= 57 && h >= 0.8) ring.push({ r: Math.round(r * 100) / 100, h: Math.round(h * 100) / 100, surface: b.surface });
    // The old reef ring is surface 'stone', 2.1 m tall, centred at r≈52. Legit shore
    // props (jetty/palm poles = wood) and inland ruins (r<48.5) are excluded.
    if (b.surface === 'stone' && r >= 48.5 && r <= 56.5 && h >= 1.2 && h <= 2.6) {
      stoneRing.push({ r: Math.round(r * 100) / 100, h: Math.round(h * 100) / 100, surface: b.surface });
    }
  }
  ring.sort((a, b) => a.r - b.r);
  stoneRing.sort((a, b) => a.r - b.r);
  return {
    total: boxes.length,
    ringBoxes: ring.length,
    ringBoxesSample: ring.slice(0, 8),
    stoneRingBoxes: stoneRing.length,
    stoneRingBoxesSample: stoneRing.slice(0, 6),
    tallBoxes: boxes.filter((b) => b.maxY - b.minY >= 0.8).length,
    surfaces: Object.fromEntries([...tally.entries()].sort((a, b) => b[1] - a[1])),
  };
}

function meanAbsDiff(a, b, rowsFilter = null) {
  const cols = a.cols;
  const rows = a.rows;
  let sum = 0;
  let n = 0;
  for (let gy = 0; gy < rows; gy += 1) {
    if (rowsFilter && !rowsFilter(gy, rows)) continue;
    for (let gx = 0; gx < cols; gx += 1) {
      const i = gy * cols + gx;
      sum += Math.abs(a.lum[i] - b.lum[i]);
      n += 1;
    }
  }
  return n ? Math.round((sum / n) * 1000) / 1000 : 0;
}

function meanOf(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function stdOf(arr) {
  if (!arr.length) return 0;
  const m = meanOf(arr);
  return Math.sqrt(meanOf(arr.map((v) => (v - m) * (v - m))));
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  const ma = meanOf(a.slice(0, n));
  const mb = meanOf(b.slice(0, n));
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da < 1e-9 || db < 1e-9) return 0;
  return num / Math.sqrt(da * db);
}

/**
 * High-pass copy of a luminance signature: each cell minus its 3x3 neighbourhood mean.
 * Removes smooth gradients (fog, depth tint, vignette) so what remains is *spatial detail* —
 * the thing an opaque water film destroys and a transparent/refracting one preserves.
 */
function highPassGrid(sig, crop = { c0: 0, c1: 0, r0: 0, r1: 0 }) {
  const { cols, rows, lum } = sig;
  const c0 = crop.c0 ?? 0;
  const c1 = crop.c1 ?? cols - 1;
  const r0 = crop.r0 ?? 0;
  const r1 = crop.r1 ?? rows - 1;
  const out = [];
  for (let gy = r0; gy <= r1; gy += 1) {
    for (let gx = c0; gx <= c1; gx += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const y = gy + dy;
          const x = gx + dx;
          if (y < 0 || y >= rows || x < 0 || x >= cols) continue;
          sum += lum[y * cols + x];
          n += 1;
        }
      }
      out.push(lum[gy * cols + gx] - sum / n);
    }
  }
  return out;
}

/** Mean luminance per 4 m radial band in a top-down plan render (boulder belt evidence). */
function planBands(signature, camera, viewport) {
  const { cols, rows, lum } = signature;
  const halfV = camera.pos[1] * Math.tan((camera.fov * Math.PI) / 360);
  const metresPerPx = (2 * halfV) / viewport.height;
  const pxPerM = 1 / metresPerPx;
  const cxPx = viewport.width / 2;
  const cyPx = viewport.height / 2;
  const bands = [];
  let bandLo = 28;
  while (bandLo < 68) {
    const bandHi = bandLo + 4;
    let sum = 0;
    let n = 0;
    for (let gy = 0; gy < rows; gy += 1) {
      const py = ((gy + 0.5) / rows) * viewport.height;
      for (let gx = 0; gx < cols; gx += 1) {
        const px = ((gx + 0.5) / cols) * viewport.width;
        const r = Math.hypot(px - cxPx, py - cyPx) * metresPerPx;
        if (r >= bandLo && r < bandHi) { sum += lum[gy * cols + gx]; n += 1; }
      }
    }
    bands.push({ radius: `${bandLo}-${bandHi}`, meanLum: n ? Math.round((sum / n) * 10) / 10 : null, samples: n });
    bandLo = bandHi;
  }
  return { pxPerM: Math.round(pxPerM * 100) / 100, bands };
}

// ---------------------------------------------------------------------------
// main probe
// ---------------------------------------------------------------------------
const SHOT_DELAY_MS = Number(process.env.SHOT_DELAY_MS || 100);

export async function runProbe(options = {}) {
  const quick = options.quick ?? process.argv.includes('--verify');
  const baseUrl = options.baseUrl || process.env.BASE_URL || 'http://127.0.0.1:8080';
  const map = options.map || process.env.MAP || 'island-01';
  const quality = options.quality || process.env.QUALITY || 'medium';
  const wantGpu = options.wantGpu ?? process.env.GPU !== '0';
  const postfx = options.postfx ?? process.env.POSTFX === '1';
  const outDir = path.resolve(options.outDir || process.env.OUT_DIR || (quick ? 'shots/shore-verify' : 'shots/shore'));
  const wallStart = Date.now();
  await mkdir(outDir, { recursive: true });

  console.log(`[shore-probe] ${quick ? 'QUICK' : 'FULL'} pass -> ${outDir}`);

  const { browser, page, errors, warnings, url, loadMs, mode, viewport } = await launch({ baseUrl, map, quality, wantGpu });
  const report = {
    probe: 'shore-probe',
    version: 2,
    generatedAt: new Date().toISOString(),
    quick,
    url,
    outDir: outDir.replace(/\\/g, '/'),
    browser: { mode, viewport, postfx },
    loadMs,
    thresholds: THRESHOLDS,
    shots: [],
    errors: [],
    warnings: [],
    assertions: [],
    failures: [],
    passed: false,
  };
  const shot = async (spec) => {
    const meta = await page.evaluate((s) => window.__qaShore.setCamera(s), spec);
    await page.evaluate(() => window.__qaShore.setViewmodelVisible(false));
    await page.waitForTimeout(SHOT_DELAY_MS);
    const file = path.join(outDir, `${spec.name}.png`);
    await page.screenshot({ path: file, type: 'png' });
    await page.evaluate(() => window.__qaShore.setViewmodelVisible(true));
    report.shots.push({ name: spec.name, file: path.relative(process.cwd(), file).replace(/\\/g, '/'), camera: meta.pos, target: spec.target, fov: spec.fov, kind: spec.kind || 'eye' });
    console.log(`[shot] ${spec.name}`);
    return spec.name;
  };
  const add = (id, desc, ok, detail) => report.assertions.push({ id, desc, ok: !!ok, detail });

  try {
    // ------------------------------------------------------------------ setup
    const setupT0 = Date.now();
    const setup = await page.evaluate(installQaHelpers, { postfx, waterLevelFallback: -0.38 });
    report.setupMs = Date.now() - setupT0;
    report.map = {
      mapId: setup.mapId,
      mapName: setup.mapName,
      quality: setup.quality,
      bounds: setup.bounds,
      terrain: setup.terrain,
      shore: setup.shore,
      groundSource: setup.groundSource,
      hooks: setup.hooks,
    };
    report.collision = analyzeCollision(setup.boxes);
    report.terrain = {
      terrainTris: setup.terrainTris,
      ridgeTris: setup.terrainRidgeTris,
      groundMeshes: setup.groundMeshes,
      rayTargets: setup.rayTargetNames,
    };
    report.water = setup.water;
    report.ocean = setup.ocean;
    console.log(`[setup] map=${setup.mapId} boxes=${report.collision.total} ringBoxes=${report.collision.ringBoxes} water=${JSON.stringify((setup.ocean?.meshes || []).map((m) => `${m.name}:${m.verts}v/${m.tris}t`))} capture=${setup.ocean?.capture ? `${setup.ocean.capture.resolution}px` : 'procedural'} tier=${setup.ocean?.tier?.capture ?? '?'}`);

    // ------------------------------------------------------- start the mission
    // The game boots in the menu state; fastForward() only ticks player.update()
    // while game.state === 'playing'. selectStage() is the dev hook that enters the
    // island mission in-place (no page reload: the active map already matches).
    const start = await page.evaluate(() => {
      const S = window.__sandstrike;
      const before = { state: S.state, enabled: S.player.enabled, pos: S.player.position.toArray() };
      let mode = 'state-patch';
      let error = null;
      try {
        if (typeof S.selectStage === 'function') {
          S.selectStage('island-01', 'standard');
          if (S.state === 'playing' && S.player.enabled) mode = 'selectStage';
        }
      } catch (err) {
        error = String(err && err.message ? err.message : err);
      }
      if (mode !== 'selectStage') {
        S.game.state = 'playing';
        S.player.enabled = true;
        S.player.alive = true;
      }
      // Deterministic probe: no waves spawning mid-walk, no damage, no UI.
      try { S.enemies?.reset?.(); } catch { /* dev */ }
      try { S.godMode?.(true); } catch { /* dev */ }
      S.hideUI(true);
      S.freeze(true);
      return { before, mode, error, after: { state: S.state, enabled: S.player.enabled, stage: S.stage?.id ?? null } };
    });
    report.start = start;
    console.log(`[start] mode=${start.mode} state=${start.after.state} stage=${start.after.stage}`);
    if (start.after.state !== 'playing' || !start.after.enabled) {
      throw new Error(`could not enter play state (mode=${start.mode}, state=${start.after.state})`);
    }

    // ----------------------------------------------------------- photo pass
    const shots = [];
    for (const [name, dx, dz] of OUTWARD) {
      shots.push({
        name: `shore-${name}`, kind: 'eye', anchor: 'ground',
        pos: [dx * 50, 1.62, dz * 50], target: [dx * 64, -0.2, dz * 64], fov: 72,
      });
    }
    for (const [name, dx, dz] of [['s', 0, 1], ['e', 1, 0], ['se', Math.SQRT1_2, Math.SQRT1_2]]) {
      shots.push({
        name: `waterline-${name}`, kind: 'waterline', anchor: 'ground', waterline: true,
        pos: [dx * 51, 1.55, dz * 51], target: [dx * 58.2, -0.5, dz * 58.2], fov: 70,
      });
    }
    shots.push({ name: 'sea-grazing', kind: 'sea', pos: [0, 3.2, 44], target: [0, -1.2, 90], fov: 62 });
    shots.push({ name: 'sea-lagoon', kind: 'sea', pos: [-14, 6.5, 48], target: [8, -2.5, 78], fov: 66 });
    shots.push({ name: 'plan-island', kind: 'plan', pos: [0, 132, 0.1], target: [0, 0, 0], fov: 60 });
    shots.push({ name: 'plan-shore-s', kind: 'plan', pos: [0, 34, 44], target: [0, 0, 56], fov: 62 });
    if (quick) {
      // ~1/3 of the full runtime: top-down + 3 shoreline views + waterline close-up.
      const keep = new Set(['plan-island', 'shore-s', 'shore-e', 'shore-se', 'waterline-s', 'plan-shore-s']);
      for (const s of shots) if (keep.has(s.name)) await shot(s);
    } else {
      for (const s of shots) await shot(s);
    }

    // --------------------------------------------------- water metrics / probes
    const waterT0 = Date.now();
    const waterProbe = await page.evaluate(() => {
      const S = window.__sandstrike;
      const q = window.__qaShore;
      // render info at three representative views (water visible)
      const views = {
        spawn: { pos: [0, 1.72, 46], target: [0, 0.4, 58], fov: 70 },
        shore_s: { pos: [0, 1.62, 50], target: [0, -0.2, 62], fov: 72 },
        plan_island: { pos: [0, 132, 0.1], target: [0, 0, 0], fov: 60 },
      };
      const metrics = {};
      for (const [key, view] of Object.entries(views)) {
        S.setCamera(view);
        metrics[key] = S.renderOnce();
      }
      // plan-view luminance bands (dark boulder belt evidence)
      S.setCamera(views.plan_island);
      S.renderFrame();
      const planSig = q.readSignature(48, 27);
      // direct transparency: checkerboard under the water, with vs without water
      const transparency = q.transparencyProbe();
      return { metrics, planSig, transparency, waterTimes: q.waterTimes() };
    });
    report.metrics = waterProbe.metrics;
    const transparencyRaw = waterProbe.transparency;
    if (transparencyRaw?.found) {
      const crop = { c0: 14, c1: 49, r0: 8, r1: 27 };
      const hpWith = highPassGrid(transparencyRaw.withWater, crop);
      const hpWithout = highPassGrid(transparencyRaw.withoutWater, crop);
      report.transparency = {
        found: true,
        view: transparencyRaw.view,
        spot: transparencyRaw.spot,
        hiddenMeshes: transparencyRaw.hiddenMeshes,
        recaptureUsed: !!transparencyRaw.recaptureUsed,
        recaptureError: transparencyRaw.recaptureError || null,
        captureResolution: transparencyRaw.captureResolution ?? null,
        // Primary metric: contrast of a checkerboard injected into the seabed capture and
        // seen through the water (1.0 = as visible as with the water hidden).
        stripeVisibility: transparencyRaw.stripeVisibility,
        checkStdWithWater: transparencyRaw.stdWithWater,
        checkStdWithoutWater: transparencyRaw.stdWithoutWater,
        // Secondary, implementation-agnostic: high-pass correlation of the real seabed detail.
        detailCorrelation: Math.round(pearson(hpWith, hpWithout) * 1000) / 1000,
        detailEnergyRatio: hpWithout.length ? Math.round((stdOf(hpWith) / Math.max(1e-6, stdOf(hpWithout))) * 1000) / 1000 : null,
        withWaterStd: Math.round(stdOf(transparencyRaw.withWater.lum) * 100) / 100,
        withoutWaterStd: Math.round(stdOf(transparencyRaw.withoutWater.lum) * 100) / 100,
      };
    } else {
      report.transparency = { found: false };
    }
    report.transparency.planBands = planBands(waterProbe.planSig, { pos: [0, 132, 0.1], fov: 60 }, viewport);
    report.waterTimesAtSetup = waterProbe.waterTimes;
    report.waterProbeMs = Date.now() - waterT0;
    console.log(`[water] stripeVisibility=${report.transparency.stripeVisibility} detailCorr=${report.transparency.detailCorrelation} recapture=${report.transparency.recaptureUsed} capture=${report.transparency.captureResolution} flatFilm=${report.water.flatFilm} refractionHints=${JSON.stringify(report.water.refractionHints)}`);

    // Evidence screenshots for the transparency metric: the exact same top-down camera
    // with the water on vs. every water/surf mesh hidden (reviewer can compare detail).
    if (transparencyRaw?.found && transparencyRaw.cam) {
      const rel = (f) => path.relative(process.cwd(), f).replace(/\\/g, '/');
      await page.evaluate((cam) => { window.__sandstrike.setCamera(cam); window.__sandstrike.renderFrame(); }, transparencyRaw.cam);
      await page.evaluate(() => window.__qaShore.setViewmodelVisible(false));
      await page.waitForTimeout(SHOT_DELAY_MS);
      const onFile = path.join(outDir, 'transparency-water.png');
      await page.screenshot({ path: onFile, type: 'png' });
      report.shots.push({ name: 'transparency-water', file: rel(onFile), kind: 'transparency' });
      await page.evaluate((cam) => {
        const S = window.__sandstrike;
        S.setCamera(cam);
        window.__qaShore.setWaterVisible(false);
        S.renderFrame();
      }, transparencyRaw.cam);
      await page.waitForTimeout(SHOT_DELAY_MS);
      const offFile = path.join(outDir, 'transparency-no-water.png');
      await page.screenshot({ path: offFile, type: 'png' });
      await page.evaluate(() => window.__qaShore.setViewmodelVisible(true));
      report.shots.push({ name: 'transparency-no-water', file: rel(offFile), kind: 'transparency' });
      await page.evaluate(() => {
        window.__qaShore.setWaterVisible(true);
        window.__sandstrike.renderFrame();
      });
      console.log('[shot] transparency-water / transparency-no-water');
    }

    // -------------------------------------------------------- wave animation strip
    report.waves = { frames: [], motion: {}, skipped: quick };
    if (!quick) {
      const waveCam = shots.find((s) => s.name === 'waterline-s');
      const waveT0 = Date.now();
      let prev = null;
      let motionSum = 0;
      let motionN = 0;
      for (let i = 0; i < 4; i += 1) {
        // UNFROZEN for ~500 ms so world.update() advances the water uniforms.
        await page.evaluate(() => window.__sandstrike.freeze(false));
        await page.waitForTimeout(500);
        const frame = await page.evaluate((s) => {
          const S = window.__sandstrike;
          // Freeze again *before* aiming the QA camera: while unfrozen the player
          // controller owns the camera and would overwrite our waterline view.
          S.freeze(true);
          window.__qaShore.setCamera(s);
          return window.__qaShore.frameStats();
        }, waveCam);
        await page.evaluate(() => window.__qaShore.setViewmodelVisible(false));
        await page.waitForTimeout(80);
        const file = path.join(outDir, `waves-${i + 1}.png`);
        await page.screenshot({ path: file, type: 'png' });
        await page.evaluate(() => window.__qaShore.setViewmodelVisible(true));
        report.shots.push({ name: `waves-${i + 1}`, file: path.relative(process.cwd(), file).replace(/\\/g, '/'), camera: null, target: waveCam.target, fov: waveCam.fov, kind: 'wave' });
        report.waves.frames.push({ index: i + 1, file: path.basename(file), signature: frame.signature, times: frame.times });
        if (prev) {
          const d = meanAbsDiff(prev.signature, frame.signature);
          motionSum += d;
          motionN += 1;
          report.waves.frames[i].motionVsPrev = d;
        }
        prev = frame;
        console.log(`[waves] frame ${i + 1} times=${JSON.stringify(frame.times.map((t) => t.value))}`);
      }
      // restore the frozen photo state
      await page.evaluate(() => window.__sandstrike.freeze(true));
      report.waves.motion = {
        meanAbs: motionN ? Math.round((motionSum / motionN) * 1000) / 1000 : 0,
        samples: motionN,
      };
      report.waves.probeMs = Date.now() - waveT0;
      console.log(`[waves] mean frame motion=${report.waves.motion.meanAbs}`);
    }

    // ------------------------------------------------------------- walk probes
    const walkT0 = Date.now();
    const bearings = OUTWARD.map(([name, dx, dz]) => [name, dx, dz]);
    const walk = await page.evaluate((bs) => window.__qaShore.walkProbe(bs, 30), bearings);
    report.walk = { bearings: walk, spawnWalk: null, kneeDeep: null, alongBeach: null };
    const spawnWalk = await page.evaluate(() => window.__qaShore.spawnWalk());
    report.walk.spawnWalk = spawnWalk;
    const kneeDeep = await page.evaluate(() => window.__qaShore.kneeDepthProbe([
      ['s', 0, 1], ['e', 1, 0], ['se', Math.SQRT1_2, Math.SQRT1_2], ['sw', -Math.SQRT1_2, Math.SQRT1_2],
    ], 0.6));
    report.walk.kneeDeep = kneeDeep;
    const alongBeach = await page.evaluate(() => window.__qaShore.alongBeachProbe(['s', 0, 1], 0.45, 4));
    report.walk.alongBeach = alongBeach;
    report.walkMs = Date.now() - walkT0;
    for (const b of walk) {
      console.log(`[walk] ${b.dir.padEnd(2)} startR=${b.corridor.startRadius}m(off ${b.corridor.offsetDeg}°) sim=${b.simTime}s endR=${b.end.radius} guard=${b.guardRadius ?? 'n/a'} y=${b.end.y} ground=${b.groundY} depth=${b.depth} feetOff=${b.feetOffset} stoppedBy=${b.stoppedBy} grounded=${b.grounded}`);
    }

    // ------------------------------------------- staged "walk into the sea" frames
    // Three evidence frames at the same eye-level camera while the controller stands at
    // r≈52 (dry sand), r≈56 (ankle depth) and r≈59 (clamped by the shore guard = the
    // furthest the player can walk). Saved as walk-1/2/3.png in the output folder.
    if (!quick) {
      const seaWalk = [];
      const seaWalkT0 = Date.now();
      for (let i = 0; i < 3; i += 1) {
        const stage = await page.evaluate((r) => window.__qaShore.stageSeaWalk(r), [52, 56, 59][i]);
        await page.evaluate(() => window.__qaShore.setViewmodelVisible(false));
        await page.waitForTimeout(SHOT_DELAY_MS);
        const f = path.join(outDir, `walk-${i + 1}.png`);
        await page.screenshot({ path: f, type: 'png' });
        await page.evaluate(() => window.__qaShore.setViewmodelVisible(true));
        const rel = path.relative(process.cwd(), f).replace(/\\/g, '/');
        report.shots.push({ name: `walk-${i + 1}`, file: rel, kind: 'walk-sequence' });
        seaWalk.push({ ...stage, shot: rel });
        console.log(`[walk-seq] walk-${i + 1}: r=${stage.radius} depth=${stage.depth} feet=${stage.feetOffset} guard=${stage.guardRadius} stoppedAtGuard=${stage.stoppedAtGuard}`);
      }
      report.seaWalk = seaWalk;
      report.seaWalkMs = Date.now() - seaWalkT0;
    }

    // ------------------------------------------------------------- assertions
    const landRadius = Number(report.map?.terrain?.island?.landRadius ?? 57);
    // Prefer the shared shoreline profile exposed by the island builder; fall back to
    // the legacy "landRadius - 3.5" formula when the profile is not available.
    const shoreInfo = report.map?.shore || null;
    const waterlineEstimate = Number(shoreInfo?.waterline ?? (Number.isFinite(landRadius) ? landRadius - 3.5 : 53.5));
    const wadeDepth = report.water?.level != null ? report.water.level : -0.38;

    // A. reef ring removed
    add('A1-collision-ring-removed', `no tall stone collision box left in the old reef band r=48.5..56.5 (<=${THRESHOLDS.stoneRingBoxesMax})`, report.collision.stoneRingBoxes <= THRESHOLDS.stoneRingBoxesMax,
      `${report.collision.stoneRingBoxes} stone ring boxes (of ${report.collision.ringBoxes} tall boxes in the r=47..57 band; sample ${JSON.stringify(report.collision.stoneRingBoxesSample)})`);
    const ridgeTris = report.terrain.terrainTris?.ridge;
    add('A2-ridge-geometry-removed', `island ridge/boulder triangles <= ${THRESHOLDS.ridgeTrisMax} (belt was ~28k)`, (ridgeTris ?? 0) <= THRESHOLDS.ridgeTrisMax, `ridgeTris=${ridgeTris ?? 'missing'} (terrainTris=${JSON.stringify(report.terrain.terrainTris ? Object.keys(report.terrain.terrainTris) : null)})`);
    const ringVisual = await page.evaluate(() => window.__qaShore.ringBoulderProbe(16));
    report.ringVisual = ringVisual;
    add('A3-boulders-removed', `boulder clusters gone from the ring band (<=${THRESHOLDS.boulderBearingsMax}/16 bearings of 16)`, ringVisual.bearingHits <= THRESHOLDS.boulderBearingsMax, `bearingHits=${ringVisual.bearingHits}/16, boulderMeshes=${ringVisual.meshes}, heights=${JSON.stringify(ringVisual.heights)}`);

    // B. walkability
    const escapes = walk.filter((b) => b.end.radius > THRESHOLDS.escapeRadius);
    add('B1-no-escape', `no bearing escapes past r=${THRESHOLDS.escapeRadius}`, escapes.length === 0, escapes.length ? `escaped: ${escapes.map((b) => b.dir).join(',')}` : `max radius=${Math.max(...walk.map((b) => b.end.radius))}`);
    const badDepth = walk.filter((b) => b.depth == null || b.depth < THRESHOLDS.stopDepthMin || b.depth > THRESHOLDS.stopDepthMax);
    add('B2-stop-depth', `every bearing stops at ${THRESHOLDS.stopDepthMin}..${THRESHOLDS.stopDepthMax} m water depth`, badDepth.length === 0,
      badDepth.length ? badDepth.map((b) => `${b.dir}:${b.depth}`).join(' ') : walk.map((b) => `${b.dir}:${b.depth}`).join(' '));
    const notReached = walk.filter((b) => b.end.radius < waterlineEstimate - 1.0);
    add('B3-reaches-waterline', `every bearing walks past the waterline (>=${Math.round((waterlineEstimate - 1.0) * 100) / 100} m)`, notReached.length === 0,
      notReached.length ? `blocked shoreward: ${notReached.map((b) => `${b.dir}@${b.end.radius}`).join(' ')}` : `min radius=${Math.min(...walk.map((b) => b.end.radius))}`);
    // Feet on the walkable sand: only samples actually standing on the terrain (not on a
    // low prop top) below the waterline count. `feetOffset` is vs. the player's support
    // height (sand profile, or a box top when standing on a prop), so this cannot be
    // fooled by the player stepping onto a crate.
    const feetSamples = walk.flatMap((b) => b.samples.filter((s) => s.surface === 'sand' && s.depth != null && s.depth < -0.05).map((s) => ({ dir: b.dir, ...s })));
    const badFeetDry = feetSamples.filter((s) => s.feetOffset != null && Math.abs(s.feetOffset) > THRESHOLDS.feetDry);
    add('B4-feet-track-sand', `feet track the sand while walking the beach (|y-ground| <= ${THRESHOLDS.feetDry})`, badFeetDry.length === 0,
      `drySandSamples=${feetSamples.length}, worst=${feetSamples.length ? Math.max(...feetSamples.map((s) => Math.abs(s.feetOffset ?? 0))) : 'n/a'}`);
    const spawnOk = report.walk.spawnWalk && report.walk.spawnWalk.end.radius >= waterlineEstimate - 1.0;
    add('B5-spawn-to-sea', `walking straight out of spawn reaches the water (>=${Math.round((waterlineEstimate - 1.0) * 100) / 100} m)`, !!spawnOk,
      `spawnWalk endR=${report.walk.spawnWalk?.end?.radius ?? 'n/a'} depth=${report.walk.spawnWalk?.depth ?? 'n/a'} feetOffset=${report.walk.spawnWalk?.feetOffset ?? 'n/a'}`);
    const knee = report.walk.kneeDeep.filter((k) => k.found);
    const badKnee = knee.filter((k) => k.feetOffset == null || Math.abs(k.feetOffset) > THRESHOLDS.feetWater || k.depth < 0.3);
    add('B6-feet-track-water', `feet follow the seabed when wading (|y-ground| <= ${THRESHOLDS.feetWater})`, knee.length > 0 && badKnee.length === 0,
      badKnee.length ? badKnee.map((k) => `${k.dir}: feetOff=${k.feetOffset}, depth=${k.depth}`).join(' ') : knee.map((k) => `${k.dir}: feetOff=${k.feetOffset}, depth=${k.depth}`).join(' '));
    const along = report.walk.alongBeach;
    add('B7-walk-along-waterline', `can walk ${THRESHOLDS.alongMoved} m along the waterline while staying on the ground`, !!along?.found && along.moved >= THRESHOLDS.alongMoved && along.maxFeetOffset <= THRESHOLDS.alongFeet,
      along?.found ? `moved=${along.moved} m, radialDrift=${along.radialDrift} m, maxFeetOffset=${along.maxFeetOffset} m` : 'no knee-deep point found');
    // The new shore guard is an exact radial clamp on the shared profile (no wall collider),
    // so a correct stop sits on guardRadiusAt(endBearing). Before the rework there is no
    // guard at all and the player is stopped by the reef ring colliders instead.
    const guardStops = walk.filter((b) => b.guardRadius != null && Math.abs(b.end.radius - b.guardRadius) <= 0.6);
    add('B8-stopped-by-shore-guard', `every bearing is stopped by the shared wading guard (endR == guardRadiusAt(bearing) ±0.6 m)`, guardStops.length === walk.length,
      walk.map((b) => `${b.dir}:${b.stoppedBy}${b.guardRadius == null ? '' : ` endR=${b.end.radius}/guard=${b.guardRadius}`}`).join(' '));

    // C. water
    const surface = report.water.meshes.find((m) => /water|ocean/i.test(m.name)) || report.water.meshes[0] || null;
    add('C1-water-wavy', `water surface is displaced (>=500 verts or time-driven vertex shader)`, !report.water.flatFilm,
      `flatFilm=${report.water.flatFilm}, surfaceVerts=${surface?.verts ?? 'n/a'}, vertexHasTime=${surface?.material?.vertexHasTime ?? 'n/a'}, vertexWritesPosition=${surface?.material?.vertexWritesPosition ?? 'n/a'}`);
    add('C2-water-animates', `water animates between frames (mean |lum delta| >= ${THRESHOLDS.waveMotionMin})`, quick ? true : (report.waves.motion.meanAbs ?? 0) >= THRESHOLDS.waveMotionMin,
      quick ? 'skipped in quick mode' : `meanAbs=${report.waves.motion.meanAbs}`);
    const transparencyOk = report.transparency.found && (
      (report.transparency.recaptureUsed && report.transparency.stripeVisibility != null && report.transparency.stripeVisibility >= THRESHOLDS.stripeVisibilityMin)
      || (report.transparency.detailCorrelation != null && report.transparency.detailCorrelation >= THRESHOLDS.detailCorrMin)
    );
    add('C3-water-transparent', `seabed visible through the water (checkerboard contrast >= ${THRESHOLDS.stripeVisibilityMin} or detail correlation >= ${THRESHOLDS.detailCorrMin})`, transparencyOk,
      report.transparency.found
        ? `stripeVisibility=${report.transparency.stripeVisibility} (checkStd ${report.transparency.checkStdWithWater}/${report.transparency.checkStdWithoutWater}, recapture=${report.transparency.recaptureUsed}), detailCorrelation=${report.transparency.detailCorrelation}, spot=${JSON.stringify(report.transparency.spot)}`
        : 'no shallow spot found for the transparency test');
    add('C4-water-refraction', `water samples a scene/refraction texture (screen-space refraction)`, (report.water.refractionHints || []).length > 0,
      `hints=${JSON.stringify(report.water.refractionHints || [])}, textureUniforms=${JSON.stringify(surface?.material?.textureUniforms ?? [])}, samplers=${surface?.material?.fragmentSamplers ?? 'n/a'}`);
    add('C5-water-level', 'sea level is present and sane', report.water.present && typeof report.water.level === 'number' && report.water.level > -3 && report.water.level < 1,
      `level=${report.water.level}, wadeDepth=${wadeDepth}`);

    // D. runtime / environment
    add('D1-no-console-errors', 'no console errors / page errors during the probe', errors.length === 0, `${errors.length} error(s)${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
    const expectedShots = quick
      ? ['plan-island', 'shore-s', 'shore-e', 'shore-se', 'waterline-s', 'plan-shore-s']
      : ['plan-island', 'shore-n', 'shore-ne', 'shore-e', 'shore-se', 'shore-s', 'shore-sw', 'shore-w', 'shore-nw', 'waterline-s', 'waterline-e', 'waterline-se', 'sea-grazing', 'sea-lagoon', 'plan-shore-s', 'waves-1', 'waves-2', 'waves-3', 'waves-4', 'walk-1', 'walk-2', 'walk-3'];
    const missing = [];
    for (const name of expectedShots) {
      try {
        const st = await stat(path.join(outDir, `${name}.png`));
        if (!st.size) missing.push(name);
      } catch {
        missing.push(name);
      }
    }
    add('D2-shots-written', `all ${expectedShots.length} screenshots written`, missing.length === 0, missing.length ? `missing: ${missing.join(',')}` : 'ok');

    report.runtimeMs = Date.now() - wallStart;
    report.errors = errors.slice(0, 40);
    report.warnings = warnings.slice(0, 30);
    report.failures = report.assertions.filter((a) => !a.ok).map((a) => `${a.id}: ${a.desc} — ${a.detail}`);
    report.passed = report.failures.length === 0;
    await writeFile(path.join(outDir, 'shore-probe.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(`[report] ${path.join(outDir, 'shore-probe.json')}`);
  } catch (err) {
    report.errors = [...errors.slice(0, 40), String(err && err.stack ? err.stack : err).slice(0, 2000)];
    report.runtimeMs = Date.now() - wallStart;
    report.failures = [`probe failed: ${String(err && err.message ? err.message : err).slice(0, 400)}`];
    report.passed = false;
    try { await writeFile(path.join(outDir, 'shore-probe.json'), JSON.stringify(report, null, 2), 'utf8'); } catch { /* ignore */ }
    console.error('[probe] FAILED:', err);
  } finally {
    try { await browser.close(); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------------ summary
  const passed = report.assertions.filter((a) => a.ok).length;
  const total = report.assertions.length;
  console.log('');
  console.log(`[shore-probe] ${report.passed ? 'PASS' : 'FAIL'}  ${passed}/${total} assertions  runtime ${(report.runtimeMs / 1000).toFixed(1)}s  (load ${(loadMs / 1000).toFixed(1)}s, mode ${mode})`);
  if (report.failures.length) {
    console.log('[shore-probe] failures:');
    for (const f of report.failures) console.log(`  - ${f}`);
  }
  console.log(`[shore-probe] json: ${path.join(outDir, 'shore-probe.json')}`);
  return report;
}

// ---------------------------------------------------------------------------
// regression pass — frozen terrain layer at other quality tiers + non-island maps
// ---------------------------------------------------------------------------
/**
 * Two regression groups that do not depend on the final ocean art:
 *  1. island-01 at quality=lowest and quality=high: 1 load each, one eye-level
 *     waterline shot, console/page errors, water/surf/wet-sand mesh size, and the
 *     seabed-capture resolution per tier (lowest = procedural, high = 2048).
 *  2. outpost-07 + test-range: the island-only contracts must be absent
 *     (world.groundHeight / world.shore undefined), the player must stay on y=0
 *     while walking, the map must load with colliders + unchanged bounds, and the
 *     whole thing must be console-clean. Proves the shore rework is island-only.
 */
export async function runRegression(options = {}) {
  const baseUrl = options.baseUrl || process.env.BASE_URL || 'http://127.0.0.1:8080';
  const wantGpu = options.wantGpu ?? process.env.GPU !== '0';
  const outDir = path.resolve(options.outDir || process.env.OUT_DIR || 'shots/regression');
  await mkdir(outDir, { recursive: true });
  const wallStart = Date.now();
  const report = {
    probe: 'shore-regression',
    generatedAt: new Date().toISOString(),
    baseUrl,
    outDir: outDir.replace(/\\/g, '/'),
    tiers: {},
    maps: {},
    assertions: [],
    failures: [],
    passed: false,
  };
  const add = (id, desc, ok, detail) => report.assertions.push({ id, desc, ok: !!ok, detail });
  const relFile = (f) => path.relative(process.cwd(), f).replace(/\\/g, '/');

  // ---- 1) quality tiers on the island map -------------------------------------
  for (const quality of ['lowest', 'high']) {
    const t0 = Date.now();
    console.log(`[regression] tier ${quality} ...`);
    const session = await launch({ baseUrl, map: 'island-01', quality, wantGpu, loadTimeoutMs: 90000 });
    const { browser, page, errors, warnings, loadMs, mode, viewport } = session;
    try {
      const info = await page.evaluate(() => {
        const S = window.__sandstrike;
        const ctx = window.__worldBuilt || null;
        S.hideUI(true);
        S.setPostfxEnabled(false);
        S.freeze(true);
        const ocean = ctx?.ocean || null;
        const meshInfo = (m) => (m && m.geometry ? {
          name: m.name || m.type || '(mesh)',
          verts: m.geometry.attributes.position.count,
          tris: Math.round(m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3),
        } : null);
        const waterLevel = ocean?.profile?.level ?? ctx?.water?.level ?? null;
        const g = typeof S.world.groundHeight === 'function' ? S.world.groundHeight(0, 51) : 0;
        S.setCamera({ pos: [0, (g ?? 0) + 1.55, 51], target: [0, -0.5, 58.2], fov: 70 });
        const renderInfo = S.renderOnce();
        return {
          quality: S.quality,
          mapId: S.mapId,
          waterLevel,
          groundHeightHook: typeof S.world.groundHeight,
          shoreHook: typeof S.world.shore,
          tier: ocean?.tier ?? null,
          capture: ocean?.capture ? { resolution: ocean.capture.resolution, extent: ocean.capture.extent, meshes: ocean.capture.meshes } : null,
          stats: ocean?.stats ?? null,
          meshes: (() => {
            const list = [];
            S.scene.traverse((o) => {
              if (!o.isMesh) return;
              const mat = Array.isArray(o.material) ? o.material[0] : o.material;
              if (/^ocean-/.test(mat?.name || '') || /^island-(water|surf|foam|wet)/i.test(o.name || '')) list.push(o);
            });
            return list.map(meshInfo).filter(Boolean);
          })(),
          renderInfo,
        };
      });
      await page.waitForTimeout(SHOT_DELAY_MS);
      const file = path.join(outDir, `tier-${quality}.png`);
      await page.screenshot({ path: file, type: 'png' });
      const expectedCapture = quality === 'lowest' ? 0 : 2048;
      const captureOk = quality === 'lowest' ? info.capture == null : info.capture?.resolution === expectedCapture;
      report.tiers[quality] = {
        ...info,
        mode,
        viewport,
        loadMs,
        runtimeMs: Date.now() - t0,
        shot: relFile(file),
        errors: errors.slice(0, 10),
        warnings: warnings.slice(0, 10),
      };
      add(`R-tier-${quality}-capture`, `${quality}: seabed capture ${expectedCapture === 0 ? 'off (procedural bed)' : `= ${expectedCapture}px`}`,
        captureOk, info.capture ? `capture=${info.capture.resolution}px/${info.capture.meshes} meshes` : 'capture=procedural');
      add(`R-tier-${quality}-renders`, `${quality}: ocean meshes exist and the frame renders`, info.meshes.length >= 2 && (info.renderInfo?.triangles ?? 0) > 0,
        `meshes=${info.meshes.map((m) => `${m.name}:${m.verts}v/${m.tris}t`).join(', ')} | calls=${info.renderInfo?.calls} tris=${info.renderInfo?.triangles}`);
      add(`R-tier-${quality}-no-errors`, `${quality}: 0 console/page errors`, errors.length === 0, `${errors.length} error(s)${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''}`);
      add(`R-tier-${quality}-hooks`, `${quality}: island contracts present (world.groundHeight fn, shore profile)`, info.groundHeightHook === 'function' && !!info.tier,
        `groundHeight=${info.groundHeightHook} tier=${JSON.stringify(info.tier && { capture: info.tier.capture, segments: info.tier.segments })}`);
    } finally {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }

  // ---- 2) non-island maps: island-only contracts absent, player stays at y=0 ---
  for (const mapId of ['outpost-07', 'test-range']) {
    const t0 = Date.now();
    console.log(`[regression] map ${mapId} ...`);
    const session = await launch({ baseUrl, map: mapId, quality: 'medium', wantGpu, loadTimeoutMs: 90000 });
    const { browser, page, errors, warnings, loadMs, mode } = session;
    try {
      const info = await page.evaluate(() => {
        const S = window.__sandstrike;
        S.hideUI(true);
        S.setPostfxEnabled(false);
        S.freeze(true);
        const spawn = S.world.playerSpawn || { x: 0, y: 0, z: 0 };
        const bounds = S.world.mapBounds || null;
        const boxes = S.world.collisionBoxes ? S.world.collisionBoxes.length : 0;
        // enter play state and walk forward on the flat map: feet must stay on y=0
        S.game.state = 'playing';
        S.player.enabled = true;
        S.player.alive = true;
        try { S.enemies?.reset?.(); } catch { /* dev */ }
        try { S.godMode?.(true); } catch { /* dev */ }
        S.player.position.set(spawn.x, spawn.y ?? 0, spawn.z);
        S.player.velocity.set(0, 0, 0);
        S.player.yaw = spawn.yaw ?? 0;
        S.player._keys.clear();
        S.player._keys.add('KeyW');
        const walkYs = [];
        for (let i = 0; i < 8; i += 1) {
          S.fastForward(0.25);
          walkYs.push(Math.round(S.player.position.y * 10000) / 10000);
        }
        S.player._keys.clear();
        const endY = Math.round(S.player.position.y * 10000) / 10000;
        const eye = S.player.eye || { x: spawn.x, y: (spawn.y ?? 0) + 1.7, z: spawn.z };
        const yaw = S.player.yaw || 0;
        S.setCamera({
          pos: [eye.x, eye.y, eye.z],
          target: [eye.x - Math.sin(yaw) * 12, eye.y - 0.8, eye.z - Math.cos(yaw) * 12],
          fov: 70,
        });
        const renderInfo = S.renderOnce();
        return {
          mapId: S.mapId,
          quality: S.quality,
          hooks: {
            groundHeight: typeof S.world.groundHeight,
            shore: typeof S.world.shore,
            shoreProfile: typeof S.world.shoreProfile,
          },
          bounds,
          boxes,
          spawn,
          walkYs,
          endY,
          playerEnabled: S.player.enabled,
          renderInfo,
        };
      });
      await page.waitForTimeout(SHOT_DELAY_MS);
      const file = path.join(outDir, `map-${mapId}.png`);
      await page.screenshot({ path: file, type: 'png' });
      report.maps[mapId] = {
        ...info,
        mode,
        loadMs,
        runtimeMs: Date.now() - t0,
        shot: relFile(file),
        errors: errors.slice(0, 10),
        warnings: warnings.slice(0, 10),
      };
      const ys = info.walkYs || [];
      const stayedFlat = ys.length > 0 && ys.every((y) => Math.abs(y) < 1e-6) && Math.abs(info.endY) < 1e-6;
      add(`R-map-${mapId}-hooks-undefined`, `${mapId}: island-only contracts absent (world.groundHeight / world.shore undefined)`,
        info.hooks.groundHeight === 'undefined' && info.hooks.shore === 'undefined', JSON.stringify(info.hooks));
      add(`R-map-${mapId}-feet-flat`, `${mapId}: player stays on y=0 while walking`, stayedFlat, `walkYs=${JSON.stringify(ys)} endY=${info.endY}`);
      add(`R-map-${mapId}-world-loaded`, `${mapId}: world loads with colliders + bounds and renders`,
        info.boxes > 0 && !!info.bounds && (info.renderInfo?.triangles ?? 0) > 0,
        `boxes=${info.boxes} bounds=${JSON.stringify(info.bounds)} calls=${info.renderInfo?.calls} tris=${info.renderInfo?.triangles}`);
      add(`R-map-${mapId}-no-errors`, `${mapId}: 0 console/page errors`, errors.length === 0,
        `${errors.length} error(s)${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''}${warnings.length ? ` (${warnings.length} warnings)` : ''}`);
    } finally {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }

  // ---- 3) runtime map bounds must match the on-disk map.json -------------------
  for (const mapId of Object.keys(report.maps)) {
    try {
      const raw = await readFile(path.join(process.cwd(), 'src/config/maps', mapId, 'map.json'), 'utf8');
      const data = JSON.parse(raw);
      const b = report.maps[mapId].bounds;
      const json = data.bounds;
      const same = !!b && !!json
        && b.minX === json.minX && b.maxX === json.maxX && b.minZ === json.minZ && b.maxZ === json.maxZ;
      report.maps[mapId].mapBoundsMatchesMapJson = same;
      report.maps[mapId].mapJsonBounds = json;
      add(`R-map-${mapId}-bounds-match-json`, `${mapId}: runtime mapBounds matches src/config/maps/${mapId}/map.json`, same,
        `runtime=${JSON.stringify(b)} json=${JSON.stringify(json)}`);
    } catch (err) {
      add(`R-map-${mapId}-bounds-match-json`, `${mapId}: map.json readable`, false, String(err).slice(0, 200));
    }
  }

  report.runtimeMs = Date.now() - wallStart;
  report.failures = report.assertions.filter((a) => !a.ok).map((a) => `${a.id}: ${a.desc} — ${a.detail}`);
  report.passed = report.failures.length === 0;
  await writeFile(path.join(outDir, 'regression.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('');
  console.log(`[shore-regression] ${report.passed ? 'PASS' : 'FAIL'}  ${report.assertions.filter((a) => a.ok).length}/${report.assertions.length} assertions  runtime ${((Date.now() - wallStart) / 1000).toFixed(1)}s`);
  if (report.failures.length) {
    console.log('[shore-regression] failures:');
    for (const f of report.failures) console.log(`  - ${f}`);
  }
  console.log(`[shore-regression] json: ${path.join(outDir, 'regression.json')}`);
  return report;
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] || '').href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--regression')) {
    runRegression()
      .then((report) => process.exit(report.passed ? 0 : 1))
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else {
    runProbe()
      .then((report) => process.exit(report.passed ? 0 : 1))
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  }
}
