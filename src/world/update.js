/**
 * SANDSTRIKE // sandstorm protocol — per-frame life support & teardown.
 *
 * Split verbatim out of src/world.js (updateCloths / updateWorld / disposeWorld).
 * The only data-driven value is the sun-warmth pulse ("dust in the air"): its base
 * intensity comes from `environment.lights.sun.intensity` and the excursion from
 * `environment.lights.sunPulse` (map data), with the pre-refactor constants as
 * fallbacks.
 */
import { clamp } from '../utils.js';
import { updateFoliageFx } from './foliage-fx.js';

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

function updateCloths(ctx, time) {
  for (const c of ctx.cloths) {
    const attr = c.geo.attributes.position;
    const arr = attr.array;
    const base = c.base;
    for (let i = 0; i < attr.count; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      const u = clamp(bx / c.w + 0.5, 0, 1);
      const v = clamp(by / c.h + 0.5, 0, 1);
      let weight;
      if (c.type === 'banner') weight = Math.sin(Math.PI * u) * Math.pow(1 - v, 1.3);
      else if (c.type === 'flag') weight = Math.pow(clamp(bx / c.w, 0, 1), 1.15) * (0.55 + 0.45 * Math.sin(Math.PI * v));
      else if (c.type === 'strip') weight = Math.pow(1 - v, 1.4) * Math.sin(Math.PI * u);
      else weight = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      const wave =
        Math.sin(time * c.speed + u * 3.1 + c.phase) * c.amp * weight +
        Math.sin(time * c.speed * 1.63 + v * 4.7 + c.phase * 2.1) * c.amp * 0.45 * weight;
      arr[i * 3 + 2] = base[i * 3 + 2] + wave;
    }
    attr.needsUpdate = true;
    c.geo.computeVertexNormals();
  }
}

function updateWorld(ctx, dt, time) {
  if (ctx.disposed) return;
  if (ctx.skyMaterial) ctx.skyMaterial.uniforms.uTime.value = time;
  if (ctx.glowPoints) ctx.glowPoints.material.uniforms.uTime.value = time;
  if (ctx.dust) ctx.dust.material.uniforms.uTime.value = time;
  if (ctx.smoke) ctx.smoke.material.uniforms.uTime.value = time;
  // Tropical island: animated ocean / surf and the pollen-mist-bird ambience.
  if (ctx.water) ctx.water.update(time);
  if (ctx.islandAmbience) ctx.islandAmbience.update(time);
  updateFoliageFx(time);
  updateCloths(ctx, time);
  for (const a of ctx.animated) {
    if (a.kind === 'rotor') a.obj.rotation.z += a.speed * dt;
    else if (a.kind === 'radar') {
      a.obj.rotation.y += a.speed * dt;
      if (a.beacon && a.beacon.material) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
        a.beacon.material.emissiveIntensity = 2.0 + pulse * 3.4;
      }
    }
  }
  for (const f of ctx.flickers) {
    const t = time * f.speed + f.seed;
    let k = 0.82 + 0.12 * Math.sin(t) + 0.06 * Math.sin(t * 2.7);
    if (f.fire) k += 0.1 * Math.sin(time * 17.0 + f.seed * 3.1);
    f.light.intensity = f.base * k;
  }
  // subtle sun warmth shift over time (dust in the air)
  if (ctx.sun) {
    const lights = ctx.data?.environment?.lights;
    const baseIntensity = num(lights?.sun?.intensity, 3.55);
    const amplitude = num(lights?.sunPulse?.amplitude, 0.08);
    const speed = num(lights?.sunPulse?.speed, 0.05);
    ctx.sun.intensity = baseIntensity + Math.sin(time * speed) * amplitude;
  }
}

function disposeWorld(ctx) {
  if (ctx.disposed) return;
  ctx.disposed = true;
  const scene = ctx.scene;
  const objects = ctx.worldObjects ?? [];
  const materials = new Set();
  const geometries = new Set();
  for (const obj of objects) {
    obj.traverse?.((node) => {
      if (node.geometry) geometries.add(node.geometry);
      const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      for (const m of mats) materials.add(m);
    });
    if (obj.parent) obj.parent.remove(obj);
  }
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  for (const t of ctx.textures) t.dispose();
  try {
    ctx.tex.dispose?.();
  } catch (err) {
    /* ignore */
  }
  if (ctx.pmremTarget) ctx.pmremTarget.dispose();
  scene.environment = null;
  scene.fog = null;
  ctx.cloths.length = 0;
  ctx.flickers.length = 0;
  ctx.collideMeshes.length = 0;
  ctx.objects.length = 0;
  ctx.disposables.length = 0;
}

export { updateCloths, updateWorld, disposeWorld };
