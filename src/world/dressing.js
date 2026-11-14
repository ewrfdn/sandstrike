/**
 * SANDSTRIKE // sandstorm protocol — cloth, decals, posters, lanterns, practicals.
 *
 * Split out of src/world.js (buildCloths / buildSiteStencils / buildPosterRequests /
 * buildDecalsAndPosters / buildLanterns / buildPracticalLights / buildSiteDressing).
 *
 * Site-level requests (banners, stencils, posters, warm lanterns/lights, map smoke)
 * now come from `ctx.data.dressing` (map data). The push ORDER inside each req
 * array is preserved exactly, because it determines the merged geometry order:
 *   decals  = buildSiteDressing() decals first (called during props phase), then
 *             the buildSiteStencils() list (called during the cloth phase);
 *   posters = buildPosterRequests() list;
 *   banners = buildCloths() siteBanners (empty while ctx.stage, like before);
 *   smoke   = model-emitted smoke first, then map-level dressing.smoke.
 * Requests from the per-model builders (doors, well, tunnel, flags...) are still
 * queued by those modules and are not touched here.
 */
import * as THREE from 'three';
import { clamp, makeRNG } from '../utils.js';
import { clothMaterial, registerCloth, mergePlanes, matrixFor } from '../models/core.js';
import { createBanner } from '../models/world/banner.js';
import { createFlag } from '../models/world/flag.js';
import { createAwning } from '../models/world/awning.js';
import { QUALITY_SETTINGS } from './quality.js';

function buildCloths(ctx) {
  const rng = makeRNG(1717);
  // banners & flags have been requested by the architecture pass
  const siteBanners = ctx.stage ? [] : (ctx.data?.dressing?.banners ?? []);
  for (const b of siteBanners) ctx.req.banners.push({ ...b, sway: 0.05, anchor: 'top' });
  // staging flag poles (the pole meshes are part of the boundary pass; the stage
  // preview supplies its own pole proxy and requests the cloth explicitly)
  if (!ctx.stage) {
    for (const f of ctx.data.layout.hero.flagpoles) {
      // cloth hangs from just under the pole top and its readable face is turned to
      // the staging area (-Z) instead of the south wall (text used to read mirrored)
      ctx.req.flags.push({ x: f.x, y: f.h - 0.05, z: f.z, w: 2.3, h: 1.5, ry: Math.PI - 0.35, key: f.x > 0 ? 'warn' : 'title', phase: rng() * 6 });
    }
  }

  for (const req of ctx.req.banners) createBanner(ctx, req, rng);

  for (const req of ctx.req.flags) createFlag(ctx, req, rng);

  for (const req of ctx.req.awnings) createAwning(ctx, req, rng);

  for (const req of ctx.req.sails) {
    const geo = new THREE.PlaneGeometry(req.w, req.d, 14, 8);
    const sag = req.sag ?? 0.5;
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = clamp(p.getX(i) / req.w + 0.5, 0, 1);
      const v = clamp(p.getY(i) / req.d + 0.5, 0, 1);
      p.setZ(i, p.getZ(i) - sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, clothMaterial(ctx, req.key));
    mesh.position.set(req.x, req.y, req.z);
    mesh.rotation.set(-Math.PI / 2, req.ry ?? 0, 0, 'YXZ');
    mesh.name = 'shade-sail';
    ctx.disposables.push(geo);
    ctx.objects.push(mesh);
    registerCloth(ctx, mesh, geo, 'sail', req.w, req.d, 0.055, req.phase ?? rng() * 6.28);
  }
}

// ------------------------------------------------------------ decals & posters

function buildSiteStencils(ctx) {
  if (ctx.stage) return; // isolated model previews only materialise their own requests
  const d = ctx.req.decals;
  const requests = ctx.data?.dressing?.decals ?? [];
  for (const req of requests) d.push({ ...req });
}

function buildPosterRequests(ctx) {
  if (ctx.stage) return; // isolated model previews only materialise their own requests
  const d = ctx.req.posters;
  const requests = ctx.data?.dressing?.posters ?? [];
  for (const req of requests) d.push({ ...req });
}

function buildDecalsAndPosters(ctx) {
  buildSiteStencils(ctx);
  buildPosterRequests(ctx);
  const decalCells = ctx.tex.decalAtlas.cells;
  mergePlanes(ctx, ctx.req.decals, (r) => decalCells[r.cell], ctx.materials.decal, 'batch:decals');
  const posterCells = ctx.tex.posterAtlas.cells;
  mergePlanes(ctx, ctx.req.posters, (r) => posterCells[r.cell], ctx.materials.poster, 'batch:posters');
}

// ------------------------------------------------------------------- lanterns

function buildLanterns(ctx) {
  const glowScale = ctx.data?.environment?.ambience?.lanternGlowScale ?? 620;
  const positions = [];
  const colors = [];
  const sizes = [];
  const phases = [];
  const warm = new THREE.Color(0xffb060);
  const cyan = new THREE.Color(0x8ceaff);
  const fire = new THREE.Color(0xff7a2e);
  for (const req of ctx.req.lanterns) {
    const kind = req.kind ?? 'warm';
    const isFire = kind === 'fire';
    const size = req.size ?? 0.28;
    if (!isFire) {
      // hanging rod
      if (req.hang) {
        const rod = new THREE.CylinderGeometry(0.022, 0.022, Math.max(0.1, req.hang - req.y), 5);
        ctx.batcher.add('metalDark', rod, matrixFor(req.x, (req.hang + req.y) / 2, req.z));
        rod.dispose();
      }
      const hood = new THREE.CylinderGeometry(size * 0.75, size * 0.5, size * 0.34, 7);
      ctx.batcher.add('metalDark', hood, matrixFor(req.x, req.y + size * 0.62, req.z));
      hood.dispose();
      const glass = new THREE.BoxGeometry(size * 0.62, size * 0.75, size * 0.62);
      ctx.batcher.add(kind === 'cyan' ? 'glowCyan' : 'glowWarm', glass, matrixFor(req.x, req.y, req.z));
      glass.dispose();
      for (const s of [-1, 1]) {
        const bar = new THREE.BoxGeometry(0.025, size * 0.9, 0.025);
        ctx.batcher.add('metalDark', bar, matrixFor(req.x + s * size * 0.34, req.y, req.z));
        bar.dispose();
        const bar2 = new THREE.BoxGeometry(0.025, size * 0.9, 0.025);
        ctx.batcher.add('metalDark', bar2, matrixFor(req.x, req.y, req.z + s * size * 0.34));
        bar2.dispose();
      }
    }
    const c = isFire ? fire : kind === 'cyan' ? cyan : warm;
    positions.push(req.x, req.y, req.z);
    colors.push(c.r, c.g, c.b);
    sizes.push(isFire ? size * 3.4 : size * 2.6);
    phases.push((req.x * 7.3 + req.z * 3.1) % 6.283);
  }
  if (positions.length === 0) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: glowScale } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize; attribute float aPhase;
      uniform float uTime; uniform float uScale;
      varying vec3 vColor; varying float vFlicker;
      void main() {
        vColor = aColor;
        vFlicker = 0.72 + 0.2 * sin(uTime * 3.1 + aPhase) + 0.08 * sin(uTime * 11.3 + aPhase * 2.3);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(0.6, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vFlicker;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float d = dot(uv, uv);
        if (d > 1.0) discard;
        float a = pow(1.0 - d, 2.2) * vFlicker;
        gl_FragColor = vec4(vColor * 2.2, a * 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'lantern-glows';
  ctx.scene.add(points);
  ctx.objects.push(points);
  ctx.disposables.push(geo, mat);
  ctx.glowPoints = points;
}

function buildPracticalLights(ctx) {
  let count = 0;
  const q = QUALITY_SETTINGS[ctx.quality] ?? QUALITY_SETTINGS.high;
  const maxLights = q.lights ?? 8;
  for (const req of ctx.req.lights) {
    if (count >= maxLights) break;
    if (req.kind === 'accent') continue;
    if (req.kind === 'pulse') continue;
    const light = new THREE.PointLight(req.color ?? 0xffa050, req.intensity ?? 10, req.distance ?? 12, 2);
    light.position.set(req.x, req.y, req.z);
    light.castShadow = false;
    ctx.scene.add(light);
    ctx.lights.push(light);
    ctx.flickers.push({
      light,
      base: req.intensity ?? 10,
      speed: 7 + ((req.x + req.z) % 5),
      seed: (req.x * 3.7 + req.z * 1.3) % 6.28,
      fire: req.kind === 'fire',
    });
    count++;
  }
}

// ------------------------------------------------------------- site practicals

function buildSiteDressing(ctx) {
  const site = ctx.data?.dressing?.site ?? {};
  // warm lanterns at each site
  for (const req of site.lanterns ?? []) ctx.req.lanterns.push({ ...req });
  for (const req of site.lights ?? []) ctx.req.lights.push({ ...req });
  // crates / barrels are instanced already; add loose planks and scrap up top of the arch? keep lightweight
  for (const req of site.decals ?? []) ctx.req.decals.push({ ...req });
  // map-level smoke systems (model-emitted smoke is already queued by the builders)
  for (const req of ctx.data?.dressing?.smoke ?? []) ctx.req.smoke.push({ ...req });
}

export {
  buildCloths,
  buildSiteStencils,
  buildPosterRequests,
  buildDecalsAndPosters,
  buildLanterns,
  buildPracticalLights,
  buildSiteDressing,
};
