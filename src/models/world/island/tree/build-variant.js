/**
 * PROCEDURAL TREE KIT // build one tree variant into two geometries.
 *
 * `buildTreeVariant(spec, { lod, density })` runs the whole pipeline:
 *
 *   1. skeleton   — genIslandGiant (curves + envelope + pads + shell points)
 *   2. radii      — pipeRadii (radius from carried leaf area, trunk continuity)
 *   3. wood       — BarkAccum: trunk (with buttress flare/flutes), limbs, twigs,
 *                   buttress plates, root paws, lianas, hanging vines, epiphytes
 *   4. leaves     — LeafAccum: pad cards, twig sprays, limb masses, low shade fans,
 *                   crown skirt, shell cards (with sky windows), top flush, vines,
 *                   epiphytes, litter
 *   5. bake       — wood vertex colour = AO + moss; leaf vertex colour = (AO, flex, hue)
 *   6. ground     — shift so minY ≈ -0.01 m
 *
 * Two outputs only (wood / leaves) => two draw calls per variant. `lod: 'map'` halves
 * the wood ring counts and skips every second decorative branch, `density` scales the
 * card counts (0.63 ≈ the map LOD, 1 = full stage density).
 */
import * as THREE from 'three';
import { clamp } from '../../../../utils.js';
import { BarkAccum, LeafAccum } from './meshers.js';
import { genIslandGiant, SUN } from './species.js';
import { pipeRadii, sampleBranch } from './skeleton.js';
import { makeRNG, range, chance, fbm3, randUnit } from './rng-noise.js';
import { canopyCellUV } from '../leaf-atlas.js';

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

/** Atlas cell rects, cached (the contract lives in leaf-atlas.js). */
const RECT = {
  sprig: canopyCellUV('sprig', 0.035),
  spray: canopyCellUV('spray', 0.035),
  pale: canopyCellUV('pale', 0.035),
  dry: canopyCellUV('dry', 0.035),
};

/** Card sizes by cell (m): one card = a whole leafy twig, so these are big on purpose. */
const CARD_W = {
  sprig: [0.9, 1.4],
  spray: [0.6, 0.95],
  pale: [0.78, 1.15],
  dry: [0.55, 0.85],
};

// scratch: the generator places thousands of cards, no per-card allocation
const _u = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _Z = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _face = new THREE.Vector3();
const _s = { p: new THREE.Vector3(), T: new THREE.Vector3(), r: 0, pd: 0 };

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// colour bakes
// ---------------------------------------------------------------------------

/** Wood vertex colour: baked AO + moss tint, read by M.barkTrop (vertexColors). */
function makeWoodColor(seed) {
  return (p, pd, n, out) => {
    let ao = 0.96 + 0.3 * smooth(0.1, 3.4, p.y);
    if (n.y < -0.2) ao *= 0.9;
    if (n.y > 0.55) ao = Math.min(1.05, ao + 0.05);
    const m = fbm3(p.x, p.y, p.z, seed, 0.85);
    const base = 1 - smooth(0.9, 4.2, p.y);
    let moss = (base * 0.8 + Math.max(0, n.y) * 0.4) * (0.4 + 0.6 * m);
    moss = clamp(moss, 0, 1) * 0.85;
    // bark is warm brown, moss pulls it olive-green without hiding the texture
    out[0] = ao * (1 - moss * 0.36) * (0.99 + 0.03 * m);
    out[1] = ao * (1 - moss * 0.04) * (0.95 + 0.09 * m);
    out[2] = ao * (1 - moss * 0.5);
  };
}

/** Canopy-local AO for a card that belongs to `pad` (GT padTopF/padShade, simplified). */
function padAO(pad, p) {
  const ly = (p.y - pad.c.y) / Math.max(0.2, pad.ry);
  const lx = (p.x - pad.c.x) / Math.max(0.2, pad.rx);
  const lz = (p.z - pad.c.z) / Math.max(0.2, pad.rz);
  const topF = clamp((ly + 1) * 0.5, 0, 1);
  const rim = clamp(Math.hypot(lx, lz), 0, 1);
  const ao = (0.33 + 0.67 * topF) * (0.8 + 0.2 * rim) * pad.shade;
  return clamp(ao, 0.27, 1);
}

/** Canopy AO for a card placed against the crown envelope. */
function envAO(env, p, extra = 1) {
  const ly = (p.y - env.c.y) / env.r.y;
  const lx = (p.x - env.c.x) / env.r.x;
  const lz = (p.z - env.c.z) / env.r.z;
  const topF = clamp((ly + 1) * 0.5, 0, 1);
  const rim = clamp(Math.hypot(lx, lz), 0, 1);
  return clamp((0.34 + 0.66 * topF) * (0.82 + 0.18 * rim) * extra, 0.28, 1);
}

// ---------------------------------------------------------------------------
// card placement
// ---------------------------------------------------------------------------

/**
 * Place one 2-triangle card. The crown clamps (horizontal `leafR`, vertical `leafTop`)
 * are applied here for every card, so no generator branch can poke through the
 * documented envelope.
 */
function placeCard(acc, rng, env, cfg) {
  const { base, tipHint, faceHint, cell, ao, flex, hue, droop = 0.24, sizeBoost = 1 } = cfg;
  const leafR = cfg.leafR;
  const leafTop = cfg.leafTop;
  if (base.y > leafTop + 0.25) return false;

  _Z.copy(faceHint);
  if (_Z.lengthSq() < 1e-8) _Z.copy(UP);
  _Z.normalize();
  // GT: make the card normal face the sun hemisphere so a backlit card still lights
  if (_Z.dot(SUN) < 0) _Z.negate();

  _X.copy(tipHint);
  if (_X.lengthSq() < 1e-8) _X.set(1, 0, 0);
  _X.addScaledVector(_Z, -_X.dot(_Z));
  _X.y -= droop;
  if (_X.lengthSq() < 1e-8) {
    _X.set(0, -1, 0).addScaledVector(_Z, -_Z.y * -1);
  }
  _X.normalize();
  _Y.crossVectors(_Z, _X).normalize();

  const [wMin, wMax] = CARD_W[cell];
  let w = range(rng, wMin, wMax) * sizeBoost;
  const aspect = cell === 'dry' ? 0.72 : 0.78;

  // horizontal envelope clamp (circle of radius leafR around the crown axis)
  const bx = base.x - env.c.x;
  const bz = base.z - env.c.z;
  const dh0 = Math.hypot(bx, bz);
  if (dh0 > leafR - 0.04) return false;
  const a2 = _X.x * _X.x + _X.z * _X.z;
  if (a2 > 1e-5) {
    const b2 = bx * _X.x + bz * _X.z;
    const c2 = dh0 * dh0 - leafR * leafR;
    const disc = b2 * b2 - a2 * c2;
    if (disc <= 0) return false;
    const root = (-b2 + Math.sqrt(disc)) / a2;
    if (root <= 0.05) return false;
    w = Math.min(w, root);
  }
  if (_X.y > 1e-4) w = Math.min(w, (leafTop - base.y) / _X.y);
  if (w < 0.26) return false;

  _c.copy(base).addScaledVector(_X, w * (cfg.centerBias ?? 0.5));
  acc.card(_c, _X, _Y, _Z, w, w * aspect, RECT[cell], ao, flex, hue, {
    bow: (rng() - 0.5) * w * 0.12,
  });
  return true;
}

/** Card flex: distance-to-root, normalised (GT flexFn `vegetation.js:857`). */
function flexOf(pd, pdMax) {
  return Math.pow(clamp(pd / Math.max(1, pdMax), 0, 1), 1.6);
}

// ---------------------------------------------------------------------------
// leaf fills
// ---------------------------------------------------------------------------

const _ao = { pad: 0.5, env: 0.8 };

/** Iterate one pad: mostly outward-facing cards, a few filler cards inside. */
function fillPad(acc, rng, ctx, pad, count) {
  const { env, density, spec, pdMax, leafR, leafTop } = ctx;
  const hueBase = pad.hue;
  for (let i = 0; i < count; i++) {
    randUnit(rng, _u);
    const f = Math.pow(rng(), 0.52) * 0.86;
    _p.set(
      pad.c.x + _u.x * pad.rx * f,
      pad.c.y + _u.y * pad.ry * f,
      pad.c.z + _u.z * pad.rz * f
    );
    // face + grow direction come from the crown envelope (outward + up = sunny leaves)
    _n.set(
      (_p.x - env.c.x) / (env.r.x * env.r.x),
      (_p.y - env.c.y) / (env.r.y * env.r.y),
      (_p.z - env.c.z) / (env.r.z * env.r.z)
    ).normalize();
    randUnit(rng, _tip);
    _tip.multiplyScalar(0.55).addScaledVector(_n, 0.55);
    _tip.y += 0.28 + rng() * 0.3;
    _tip.normalize();
    randUnit(rng, _face);
    _face.multiplyScalar(0.42).addScaledVector(_n, 0.75).addScaledVector(UP, 0.34);
    _face.normalize();

    const top = (_p.y - pad.c.y) / Math.max(0.2, pad.ry);
    const under = _n.y < -0.05 || top < -0.25;
    let cell;
    const r = rng();
    if (under) cell = r < 0.62 ? 'sprig' : r < 0.86 ? 'spray' : 'dry';
    else if (top > 0.45) cell = r < 0.3 ? 'pale' : r < 0.88 ? 'spray' : 'sprig';
    else cell = r < 0.46 ? 'sprig' : r < 0.94 ? 'spray' : 'dry';
    const sizeBoost = under ? 1.06 : 0.94 + 0.1 * rng();
    const ao = padAO(pad, _p) * (under ? 0.92 : 1);
    const flex = flexOf(pad.pd + (pad.c.y - _p.y) * 0.3, pdMax);
    placeCard(acc, rng, env, {
      base: _p,
      tipHint: _tip,
      faceHint: _face,
      cell,
      ao,
      flex,
      hue: clamp(hueBase + (rng() - 0.5) * 0.22, 0, 1),
      droop: under ? 0.4 : 0.2,
      sizeBoost,
      leafR,
      leafTop,
    });
  }
}

/** Cards strung along a twig: the fine outer lace of the canopy. */
function fillTwig(acc, rng, ctx, twig, count) {
  const { env, pdMax, leafR, leafTop } = ctx;
  const n = twig.pts.length;
  for (let i = 0; i < count; i++) {
    const k = 1 + Math.floor(rng() * (n - 1));
    _p.copy(twig.pts[k]);
    _p.x += (rng() - 0.5) * 0.1;
    _p.y += (rng() - 0.5) * 0.1;
    _p.z += (rng() - 0.5) * 0.1;
    _n.set(
      (_p.x - env.c.x) / (env.r.x * env.r.x),
      (_p.y - env.c.y) / (env.r.y * env.r.y),
      (_p.z - env.c.z) / (env.r.z * env.r.z)
    ).normalize();
    randUnit(rng, _tip);
    _tip.multiplyScalar(0.6).addScaledVector(_n, 0.5);
    _tip.y -= 0.22 + rng() * 0.2;
    _tip.normalize();
    randUnit(rng, _face);
    _face.multiplyScalar(0.5).addScaledVector(_n, 0.6).addScaledVector(UP, 0.4).normalize();
    const cell = rng() < 0.62 ? 'spray' : rng() < 0.9 ? 'sprig' : 'pale';
    placeCard(acc, rng, env, {
      base: _p,
      tipHint: _tip,
      faceHint: _face,
      cell,
      ao: envAO(env, _p) * (0.86 + 0.14 * rng()),
      flex: flexOf(twig.pd[n - 1], pdMax),
      hue: clamp(0.5 + (rng() - 0.5) * 0.6, 0, 1),
      droop: 0.34,
      sizeBoost: 0.86 + 0.2 * rng(),
      leafR,
      leafTop,
    });
  }
}

/** Outer shell pass — the continuous silhouette + sky windows (GT shellFill). */
function fillShell(acc, rng, ctx) {
  const { env, spec, density, pdMax, leafR, leafTop } = ctx;
  const total = Math.round(spec.foliage.shell * density);
  const pts = ctx.tree.shell;
  if (!pts.length) return;
  for (let i = 0; i < total; i++) {
    const s = pts[i % pts.length];
    _p.copy(s.p);
    // pull slightly in so the card silhouette, not the card centre, is the outline
    _p.x -= (s.p.x - env.c.x) * 0.03;
    _p.y -= (s.p.y - env.c.y) * 0.03;
    _p.z -= (s.p.z - env.c.z) * 0.03;
    // anchor the card to its support twig (D-06: unsupported cards read as floating
    // stickers from 5 m below); unsupported points only keep small spray cards
    const tw = s.twig || null;
    if (tw) {
      const tip = tw.pts[tw.pts.length - 1];
      _p.lerp(tip, 0.5);
    } else if (rng() < 0.34) {
      continue;
    }
    _n.copy(s.n).normalize();
    randUnit(rng, _tip);
    _tip.multiplyScalar(0.5).addScaledVector(_n, 0.72);
    _tip.y += 0.34 + rng() * 0.34;
    _tip.normalize();
    randUnit(rng, _face);
    _face.multiplyScalar(0.38).addScaledVector(_n, 0.78).addScaledVector(UP, 0.3).normalize();
    const yTop = (_p.y - env.c.y) / env.r.y;
    let cell;
    const r = rng();
    if (yTop > 0.35) cell = r < 0.26 ? 'pale' : r < 0.9 ? 'spray' : 'sprig';
    else if (yTop < -0.2) cell = r < 0.5 ? 'sprig' : r < 0.78 ? 'spray' : 'dry';
    else cell = r < 0.4 ? 'sprig' : r < 0.86 ? 'spray' : 'pale';
    const pd = s.twig ? s.twig.pd[s.twig.pd.length - 1] : 13.5 + _p.y * 0.18;
    placeCard(acc, rng, env, {
      base: _p,
      tipHint: _tip,
      faceHint: _face,
      cell,
      ao: envAO(env, _p, 0.98),
      flex: flexOf(pd, pdMax),
      hue: clamp((yTop + 1) * 0.4 + (rng() - 0.5) * 0.3, 0, 1),
      droop: 0.16,
      sizeBoost: tw ? 1 : 0.62,
      centerBias: 0.2,
      leafR,
      leafTop,
    });
  }
}

/** Cards in squashed balls sampled along a limb, so the crown stays continuous. */
function fillLimbMass(acc, rng, ctx, limb, t, count) {
  const { env, pdMax, leafR, leafTop } = ctx;
  sampleBranch(limb, t, _s);
  const outward = limb.meta.outward;
  const spread = 0.5 + t * 0.42;
  for (let i = 0; i < count; i++) {
    randUnit(rng, _u);
    _p.set(
      _s.p.x + _u.x * spread * 0.8,
      _s.p.y + _u.y * spread * 0.45,
      _s.p.z + _u.z * spread * 0.8
    );
    _n.set(
      (_p.x - env.c.x) / (env.r.x * env.r.x),
      (_p.y - env.c.y) / (env.r.y * env.r.y),
      (_p.z - env.c.z) / (env.r.z * env.r.z)
    ).normalize();
    randUnit(rng, _tip);
    _tip.multiplyScalar(0.6).addScaledVector(outward, 0.5).addScaledVector(UP, 0.18).normalize();
    randUnit(rng, _face);
    _face.multiplyScalar(0.45).addScaledVector(_n, 0.7).addScaledVector(UP, 0.3).normalize();
    const top = (_p.y - env.c.y) / env.r.y;
    const under = _n.y < -0.05;
    const cell = under ? (rng() < 0.7 ? 'sprig' : 'dry') : top > 0.4 ? (rng() < 0.4 ? 'pale' : 'spray') : rng() < 0.5 ? 'spray' : 'sprig';
    placeCard(acc, rng, env, {
      base: _p,
      tipHint: _tip,
      faceHint: _face,
      cell,
      ao: envAO(env, _p) * (under ? 0.9 : 1),
      flex: flexOf(_s.pd + 0.6, pdMax),
      hue: clamp(0.5 + (rng() - 0.5) * 0.55, 0, 1),
      droop: under ? 0.42 : 0.24,
      sizeBoost: 0.95 + 0.14 * rng(),
      centerBias: 0.36,
      leafR,
      leafTop,
    });
  }
}

/** Big drooping shade fans under the low limbs (the dark third storey). */
function fillLowShade(acc, rng, ctx, low, t, count) {
  const { env, pdMax, leafR, leafTop } = ctx;
  sampleBranch(low, t, _s);
  const outward = low.meta.outward;
  for (let i = 0; i < count; i++) {
    randUnit(rng, _u);
    const spread = 0.48 + t * 0.3;
    _p.set(
      _s.p.x + _u.x * spread,
      _s.p.y + _u.y * spread * 0.4 - 0.1,
      _s.p.z + _u.z * spread
    );
    _n.set(
      (_p.x - env.c.x) / (env.r.x * env.r.x),
      (_p.y - env.c.y) / (env.r.y * env.r.y),
      (_p.z - env.c.z) / (env.r.z * env.r.z)
    ).normalize();
    randUnit(rng, _tip);
    _tip.multiplyScalar(0.55).addScaledVector(outward, 0.55);
    _tip.y -= 0.55 + rng() * 0.4;
    _tip.normalize();
    randUnit(rng, _face);
    _face.multiplyScalar(0.4).addScaledVector(outward, 0.35).addScaledVector(UP, 0.18).normalize();
    const cell = rng() < 0.68 ? 'sprig' : rng() < 0.85 ? 'spray' : 'dry';
    placeCard(acc, rng, env, {
      base: _p,
      tipHint: _tip,
      faceHint: _face,
      cell,
      ao: clamp(envAO(env, _p) * 0.72, 0.28, 0.72),
      flex: flexOf(_s.pd + 0.4, pdMax),
      hue: clamp(0.22 + (rng() - 0.5) * 0.4, 0, 1),
      droop: 0.5,
      sizeBoost: 1.12,
      centerBias: 0.38,
      leafR,
      leafTop,
    });
  }
}

/** The skirt between the low limbs and the crown: keeps the tree a column, not a ball. */
function fillSkirt(acc, rng, ctx) {
  const { env, spec, density, pdMax, leafR, leafTop } = ctx;
  // hang the skirt cards off the low limbs instead of an abstract ring: every card then
  // has wood under it (D-06) and the lower crown still fills the gap to the main limbs
  const lows = ctx.tree.lowLimbs || [];
  if (!lows.length) return;
  const stations = Math.max(2, Math.round(spec.foliage.skirt * density));
  const total = Math.max(2, Math.round(spec.foliage.skirtCards * density));
  const count = Math.max(2, Math.round(total / (lows.length * stations) * 1.35));
  for (const low of lows) {
    const outward = low.meta.outward;
    for (let i = 0; i < stations; i++) {
      const t = 0.1 + (i / stations) * 0.62;
      sampleBranch(low, t, _s);
      for (let k = 0; k < count; k++) {
        randUnit(rng, _u);
        const spread = 0.5;
        _p.set(
          _s.p.x + _u.x * spread,
          _s.p.y + _u.y * spread * 0.4 - 0.12,
          _s.p.z + _u.z * spread
        );
        _n.set(
          (_p.x - env.c.x) / (env.r.x * env.r.x),
          (_p.y - env.c.y) / (env.r.y * env.r.y),
          (_p.z - env.c.z) / (env.r.z * env.r.z)
        ).normalize();
        randUnit(rng, _tip);
        _tip.multiplyScalar(0.45).addScaledVector(outward, 0.35);
        _tip.y -= 0.6 + rng() * 0.4;
        _tip.normalize();
        randUnit(rng, _face);
        _face.multiplyScalar(0.42).addScaledVector(_n, 0.4).addScaledVector(UP, 0.16).normalize();
        placeCard(acc, rng, env, {
          base: _p,
          tipHint: _tip,
          faceHint: _face,
          cell: rng() < 0.68 ? 'sprig' : 'spray',
          ao: clamp(0.44 + rng() * 0.16, 0.3, 0.66),
          flex: flexOf(_s.pd + 0.8, pdMax),
          hue: clamp(0.25 + (rng() - 0.5) * 0.4, 0, 1),
          droop: 0.55,
          sizeBoost: 1.05,
          leafR,
          leafTop,
        });
      }
    }
  }
}

/** Young sunlit flush on the very top of the crown. */
function fillShoots(acc, rng, ctx) {
  const { env, spec, density, pdMax, leafR, leafTop } = ctx;
  for (const shoot of ctx.tree.shoots) {
    const count = Math.max(2, Math.round(spec.foliage.shoot * density));
    for (let i = 0; i < count; i++) {
      _p.copy(shoot.p);
      _p.x += (rng() - 0.5) * 0.45;
      _p.y += rng() * 0.45;
      _p.z += (rng() - 0.5) * 0.45;
      randUnit(rng, _tip);
      _tip.multiplyScalar(0.4).addScaledVector(UP, shoot.up * 1.2).normalize();
      randUnit(rng, _face);
      _face.multiplyScalar(0.5).addScaledVector(UP, 0.5).normalize();
      placeCard(acc, rng, env, {
        base: _p,
        tipHint: _tip,
        faceHint: _face,
        cell: rng() < 0.42 ? 'pale' : 'spray',
        ao: clamp(0.78 + rng() * 0.2, 0.6, 1),
        flex: flexOf(pdMax * 0.94, pdMax),
        hue: clamp(0.62 + (rng() - 0.5) * 0.3, 0, 1),
        droop: 0.1,
        sizeBoost: 0.9,
        centerBias: 0.3,
        leafR,
        leafTop,
      });
    }
  }
}

/** Leafage clinging to the hanging vines. */
function fillVines(acc, rng, ctx) {
  const { env, spec, density, pdMax, leafR, leafTop } = ctx;
  for (const vine of ctx.tree.hangingVines) {
    const pts = vine.pts;
    const count = Math.max(3, Math.round(spec.foliage.vine * density));
    for (let i = 0; i < count; i++) {
      const k = 1 + Math.floor(rng() * (pts.length - 1));
      _p.copy(pts[k]);
      _p.x += (rng() - 0.5) * 0.16;
      _p.z += (rng() - 0.5) * 0.16;
      randUnit(rng, _tip);
      _tip.multiplyScalar(0.45).addScaledVector(UP, -0.75).normalize();
      randUnit(rng, _face);
      _face.multiplyScalar(0.6).addScaledVector(UP, 0.25).normalize();
      placeCard(acc, rng, env, {
        base: _p,
        tipHint: _tip,
        faceHint: _face,
        cell: rng() < 0.55 ? 'spray' : rng() < 0.8 ? 'sprig' : 'dry',
        ao: clamp(0.4 + rng() * 0.22, 0.3, 0.68),
        flex: flexOf(9 + (12 - _p.y), pdMax),
        hue: clamp(0.32 + (rng() - 0.5) * 0.5, 0, 1),
        droop: 0.5,
        sizeBoost: 0.95,
        leafR,
        leafTop,
      });
    }
  }
}

/** Epiphyte copses: small drooping ferns/broadleaf clusters on the limbs and bole. */
function fillEpiphytes(acc, rng, ctx) {
  const { env, spec, density, pdMax, leafR, leafTop } = ctx;
  for (const bed of ctx.tree.epiphytes) {
    const count = Math.max(4, Math.round(spec.foliage.epi * density));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + rng() * 0.5;
      const rr = 0.12 + rng() * 0.3 * bed.scale;
      _p.set(
        bed.p.x + Math.cos(a) * rr + (rng() - 0.5) * 0.1,
        bed.p.y + (rng() - 0.5) * 0.14,
        bed.p.z + Math.sin(a) * rr + (rng() - 0.5) * 0.1
      );
      _tip.set(Math.cos(a) * 0.95, -0.5 - rng() * 0.35, Math.sin(a) * 0.95).normalize();
      _face.set(Math.cos(a) * 0.6, 0.35, Math.sin(a) * 0.6).normalize();
      placeCard(acc, rng, env, {
        base: _p,
        tipHint: _tip,
        faceHint: _face,
        cell: rng() < 0.62 ? 'spray' : rng() < 0.84 ? 'sprig' : 'dry',
        ao: clamp(0.52 + rng() * 0.18, 0.34, 0.8),
        flex: flexOf(bed.p.y + 2.4, pdMax),
        hue: clamp(0.36 + (rng() - 0.5) * 0.5, 0, 1),
        droop: 0.5,
        sizeBoost: 0.62,
        leafR,
        leafTop,
      });
    }
  }
}

/** Ground litter ring: the old model's leaf litter, now atlas cards. */
function fillLitter(acc, rng, ctx) {
  const { env, spec, density, leafR, leafTop } = ctx;
  const count = Math.max(6, Math.round(spec.foliage.litter * density));
  for (let i = 0; i < count; i++) {
    const a = rng() * TAU;
    const rr = range(rng, 1.2, 3.1);
    _p.set(Math.cos(a) * rr, 0.03 + rng() * 0.02, Math.sin(a) * rr);
    _tip.set(Math.cos(a), -0.1, Math.sin(a)).normalize();
    _face.set(-Math.cos(a) * 0.2, 1, -Math.sin(a) * 0.2).normalize();
    placeCard(acc, rng, env, {
      base: _p,
      tipHint: _tip,
      faceHint: _face,
      cell: rng() < 0.55 ? 'dry' : 'spray',
      ao: 0.55,
      flex: 0.1,
      hue: clamp(0.2 + rng() * 0.4, 0, 1),
      droop: 0.05,
      sizeBoost: 0.72,
      leafR,
      leafTop,
    });
  }
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * Build one tree variant.
 *
 * @param {object} spec one entry of ./variants.js
 * @param {{lod?: 'stage'|'map', density?: number}} [opts]
 * @returns {{wood: THREE.BufferGeometry, leaves: THREE.BufferGeometry,
 *            stats: object}}
 */
export function buildTreeVariant(spec, opts = {}) {
  const lod = opts.lod || 'stage';
  const map = lod === 'map';
  const density = opts.density ?? 1;
  const rng = makeRNG(spec.seed);
  const tree = genIslandGiant(rng, spec);
  pipeRadii(tree.trunk, { rBase: spec.rBase, rMin: 0.007, rMax: spec.rMax ?? 0.6 });

  const wood = new BarkAccum(makeWoodColor(spec.seed & 0xff));
  const leaves = new LeafAccum();
  const ctx = {
    tree,
    env: tree.env,
    spec,
    density,
    pdMax: tree.pdMax,
    leafR: spec.leafR,
    leafTop: spec.leafTop,
  };

  // ------------------------------------------------------------------ wood
  wood.addBranch(tree.trunk, {
    radial: map ? 9 : 12,
    stride: map ? 2 : 1,
    tile: 1.3,
    disp: spec.trunk,
    dispLen: spec.trunkH,
  });
  for (const limb of tree.limbs) {
    wood.addBranch(limb, { radial: map ? 5 : 7, stride: map ? 2 : 1, tile: 1.25 });
  }
  for (const low of tree.lowLimbs) {
    wood.addBranch(low, { radial: map ? 5 : 7, stride: map ? 2 : 1, tile: 1.2 });
  }
  for (let i = 0; i < tree.subs.length; i++) {
    if (map && i % 2 === 1) continue;
    wood.addBranch(tree.subs[i], { radial: map ? 4 : 5, stride: map ? 2 : 1, tile: 1.1 });
  }
  for (let i = 0; i < tree.twigs.length; i++) {
    if (map && i % 2 === 1) continue;
    // 3-sided twig tubes + every third skeleton point: inside a pad nobody can read them,
    // and they were the single most expensive part of the wood budget
    wood.addBranch(tree.twigs[i], { radial: 3, stride: 3, tile: 0.9 });
  }
  for (const tw of tree.shellTwigs) {
    if (map && tree.shellTwigs.indexOf(tw) % 2 === 1) continue;
    wood.addBranch(tw, { radial: 3, stride: 2, tile: 0.8 });
  }
  // buttress plates + root paws + feeding roots
  for (const b of tree.buttresses) {
    wood.addButtress(b, { sections: map ? 8 : 12, tile: 1.15 });
    for (let i = 0; i < b.paws.length; i++) {
      if (map && i === 2) continue;
      const paw = b.paws[i];
      wood.addRock(new THREE.Vector3(paw.x, paw.r * 0.35, paw.z), paw.r, {
        seed: 31 + Math.round(paw.x * 7 + paw.z * 5),
        flatten: 0.6,
        tile: 1.4,
      });
    }
    // thin feeding roots snaking through the litter
    const ax = Math.cos(b.az + b.curve);
    const az = Math.sin(b.az + b.curve);
    const rootCount = map ? 1 : 2;
    for (let i = 0; i < rootCount; i++) {
      const spread = (i - 0.5) * 0.7;
      const pts = [];
      for (let k = 0; k <= 3; k++) {
        const d = b.out - 0.2 + k * 0.3;
        pts.push(new THREE.Vector3(
          Math.cos(b.az + b.curve + spread * 0.3) * d * 0.9 + ax * spread * 0.2,
          0.03 + k * 0.008,
          Math.sin(b.az + b.curve + spread * 0.3) * d * 0.9 + az * spread * 0.2
        ));
      }
      wood.addTube(pts, (t) => 0.03 * (1 - t * 0.78), { radial: 3, tile: 1.2 });
    }
  }
  // lianas + hanging vines
  for (const l of tree.lianas) {
    wood.addTube(l.pts, (t) => l.r * (1 - t * 0.4), { radial: map ? 3 : 4, stride: map ? 4 : 2, tile: 1.1 });
  }
  for (const v of tree.hangingVines) {
    wood.addTube(v.pts, (t) => v.r * (1 - t * 0.35), { radial: 3, stride: 2, tile: 0.9 });
  }
  // dead stubs
  for (const st of tree.stubs) {
    wood.addTube(st.pts, (t) => st.rads[0] * (1 - t) + 0.008, { radial: 3, tile: 1.0 });
  }
  // epiphyte moss cushions
  for (let i = 0; i < tree.epiphytes.length; i++) {
    if (map && i % 2 === 1 && i > 2) continue;
    const bed = tree.epiphytes[i];
    wood.addRock(bed.p, 0.16 * bed.scale, { seed: 51 + i * 13, flatten: 0.55, tile: 1.2 });
  }

  // ----------------------------------------------------------------- leaves
  // per-pad hue so neighbouring pads drift between blue-green and yellow-green
  for (const pad of tree.pads) {
    pad.hue = range(rng, spec.foliage.hue[0], spec.foliage.hue[1]);
    pad.pd = pad.sub ? pad.sub.pd[pad.sub.pd.length - 1] : 12;
  }
  const padCards = Math.max(8, Math.round(spec.foliage.pad * density));
  for (const pad of tree.pads) {
    fillPad(leaves, rng, ctx, pad, padCards);
  }
  const twigCards = Math.max(4, Math.round(spec.foliage.twig * density));
  for (const twig of tree.twigs) fillTwig(leaves, rng, ctx, twig, twigCards);
  fillShell(leaves, rng, ctx);
  for (const limb of tree.limbs) {
    const stations = spec.foliage.limb;
    for (let i = 0; i < stations.length; i++) {
      const t = 0.24 + i * 0.3;
      fillLimbMass(leaves, rng, ctx, limb, t, Math.max(3, Math.round(stations[i] * density)));
    }
  }
  for (const low of tree.lowLimbs) {
    for (const t of [0.42, 0.6, 0.78, 0.94]) {
      fillLowShade(leaves, rng, ctx, low, t, Math.max(3, Math.round(spec.foliage.low * density)));
    }
  }
  fillSkirt(leaves, rng, ctx);
  fillShoots(leaves, rng, ctx);
  fillVines(leaves, rng, ctx);
  fillEpiphytes(leaves, rng, ctx);
  fillLitter(leaves, rng, ctx);

  // ------------------------------------------------------------- finalise geo
  const woodGeo = wood.build('tree-wood');
  const leafGeo = leaves.build('tree-leaves');

  // rest the tree on the ground: shift so the lowest point is just below y=0
  let minY = Infinity;
  for (const geo of [woodGeo, leafGeo]) {
    const pos = geo.attributes.position;
    for (let i = 1; i < pos.array.length; i += 3) if (pos.array[i] < minY) minY = pos.array[i];
  }
  if (Number.isFinite(minY)) {
    const dy = -0.012 - minY;
    woodGeo.translate(0, dy, 0);
    leafGeo.translate(0, dy, 0);
    woodGeo.computeBoundingBox();
    woodGeo.computeBoundingSphere();
    leafGeo.computeBoundingBox();
    leafGeo.computeBoundingSphere();
  }

  const woodTris = woodGeo.index ? woodGeo.index.count / 3 : woodGeo.attributes.position.count / 3;
  const leafTris = leafGeo.attributes.position.count / 3;
  const box = new THREE.Box3().union(woodGeo.boundingBox).union(leafGeo.boundingBox);
  const size = new THREE.Vector3();
  box.getSize(size);

  return {
    wood: woodGeo,
    leaves: leafGeo,
    stats: {
      variant: spec.id,
      lod,
      density,
      cards: leaves.cards,
      woodTris: Math.round(woodTris),
      leafTris: Math.round(leafTris),
      tris: Math.round(woodTris + leafTris),
      height: +size.y.toFixed(3),
      crownX: +size.x.toFixed(3),
      crownZ: +size.z.toFixed(3),
      minY: +box.min.y.toFixed(3),
      pads: tree.pads.length,
      branches: tree.branches.length,
    },
  };
}

export default buildTreeVariant;
