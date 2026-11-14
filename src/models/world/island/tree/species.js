/**
 * PROCEDURAL TREE KIT // species: the island giant ("genIslandGiant").
 *
 * One call grows the whole skeleton of one tree variant: a curved trunk, N arching main
 * limbs clipped by the crown envelope, 2-3 second-order limbs per main limb, twig tufts,
 * leaf pads, a shell-sampling point cloud, buttress plates, lianas, hanging vines and
 * epiphyte beds. Everything is a plain JS record (no THREE objects are added to a
 * scene) so `build-variant.js` can mesh it and `jungle-tree.js` can instance it.
 *
 * The art direction is inherited from the shipped hand-authored tree (14 m emergent with
 * a three-storey crown, 4 buttress plates, 5 arching limbs, 2 low shade limbs, coiled
 * lianas, 3 hanging vines, epiphytic fern copses) - the constants are now a *spec*
 * (./variants.js) and the crown geometry is generated.
 *
 * Two envelopes:
 *  - `env`     leaf / crown envelope: shell sampling, card limits, AO. Its bottom sits
 *              at the crown base, its top where the crown should end.
 *  - `growEnv` skeleton envelope: centred lower and taller, so limbs that leave the
 *              bole below the crown base still have room to grow. (GT uses one padded
 *              envelope; a 14 m three-storey crown needs the split.)
 *
 * All randomness is the caller's `makeRNG` stream. The skeleton is always generated
 * before any density-dependent decision, so stage and map builds of the same variant
 * share the exact same bones.
 */
import * as THREE from 'three';
import { GOLD, growCurve, makeBranch, sampleBranch, fitInEnvelope, indexAtPd } from './skeleton.js';
import { randUnit, range, intRange, vnoise3 } from './rng-noise.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

/** World-space direction of the island morning sun (environment.json). */
export const SUN = new THREE.Vector3(0.8, 0.26, 0.52).normalize();

const _sample = { p: new THREE.Vector3(), T: new THREE.Vector3(), r: 0, pd: 0 };
const _dir = new THREE.Vector3();
const _out = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/** Surface area of an ellipsoid (Knud Thomsen approximation, p = 1.6). */
export function ellipsoidArea(r) {
  const p = 1.6;
  const ap = r.x ** p;
  const bp = r.y ** p;
  const cp = r.z ** p;
  return 4 * Math.PI * ((ap * bp + ap * cp + bp * cp) / 3) ** (1 / p);
}

/** Horizontal crown radius available at height `y` (used to clamp leaf tips). */
export function crownRadiusAt(y, env) {
  const dy = (y - env.c.y) / env.r.y;
  return env.r.x * Math.sqrt(Math.max(0, 1 - dy * dy));
}

/** Two-octave seeded noise window for the crown shell (clump + sky-hole field). */
function shellNoise(x, y, z, seed, scale) {
  const a = vnoise3(x * 0.55 * scale, y * 0.7 * scale, z * 0.55 * scale, seed);
  const b = vnoise3(x * 1.25 * scale + 11.3, y * 1.25 * scale - 5.1, z * 1.25 * scale + 7.7, seed + 17);
  return a * 0.68 + b * 0.32;
}

/**
 * Grow one island-giant variant.
 *
 * @param {() => number} rng deterministic stream (per variant seed)
 * @param {object} spec one entry of ./variants.js
 * @returns {object} tree record consumed by `build-variant.js`
 */
export function genIslandGiant(rng, spec) {
  // ---------------------------------------------------------------- trunk
  const leanAz = spec.leanAz;
  const start = new THREE.Vector3(0, -0.32, 0);
  const dir = new THREE.Vector3(Math.cos(leanAz) * spec.lean, 1, Math.sin(leanAz) * spec.lean).normalize();
  const trunkCurve = growCurve(rng, start, dir, spec.trunkH + 0.32, spec.rTrunk0, spec.rTrunk1, {
    seg: 0.3,
    wobble: spec.trunkWobble,
    curlDecay: 0.9,
    up: 0.015,
  });
  const trunk = makeBranch(trunkCurve, { level: 0, kind: 'trunk' });
  trunk.meta = { az: leanAz };

  const tip = trunk.pts[trunk.pts.length - 1];
  const env = {
    c: new THREE.Vector3(tip.x * 0.5, tip.y + spec.crownLift, tip.z * 0.5),
    r: new THREE.Vector3(spec.crownR, spec.crownRY, spec.crownR),
  };
  const growEnv = {
    c: new THREE.Vector3(tip.x * 0.4, tip.y * 0.76, tip.z * 0.4),
    r: new THREE.Vector3(spec.crownR + 0.85, tip.y * 0.62 + 1.1, spec.crownR + 0.85),
  };

  const limbs = [];
  const subs = [];
  const twigs = [];
  const pads = [];
  const lowLimbs = [];
  const stubs = [];
  const lianas = [];
  const hangingVines = [];
  const epiphytes = [];
  const shoots = [];
  const shellTwigs = [];
  let leafLoad = 0;

  // ------------------------------------------------------------- main limbs
  const az0 = rng() * TAU;
  for (let i = 0; i < spec.limbs.count; i++) {
    const t = range(rng, spec.limbs.tMin, spec.limbs.tMax);
    sampleBranch(trunk, t, _sample);
    const az = az0 + i * GOLD + range(rng, -0.26, 0.26);
    const elev = range(rng, spec.limbs.elevMin, spec.limbs.elevMax) * DEG;
    _dir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
    _out.set(Math.cos(az), 0, Math.sin(az));
    const want = spec.limbs.len * range(rng, 0.9, 1.08);
    const len = Math.max(1.6, fitInEnvelope(_sample.p, _dir, want, growEnv));
    const curve = growCurve(rng, _sample.p, _dir, len, spec.rLimb0, spec.rLimb1, {
      seg: 0.3,
      wobble: 0.3,
      curlDecay: 0.74,
      up: 0.05,
      droop: 0.42,
      droopPow: 1.7,
      outward: _out,
      outPush: 0.17,
      env: growEnv,
      envMax: 0.98,
    });
    const limb = makeBranch(curve, {
      level: 1,
      parent: trunk,
      attachIdx: indexAtPd(trunk, _sample.pd),
      kind: 'limb',
      padArea: spec.limbs.load,
    });
    limb.meta = { az, elev, outward: _out.clone(), attach: _sample.p.clone() };
    leafLoad += limb.padArea;
    limbs.push(limb);

    // epiphyte bed in the crotch where the limb leaves the bole
    if (i < 4) {
      limb.meta.epiphyte = _sample.p.clone().addScaledVector(_out, _sample.r * 0.9).addScaledVector(UP, 0.1);
    }
  }
  // trunk beds on the shaded side mid-way up
  for (let i = 0; i < Math.min(spec.epiphytes, 3); i++) {
    const t = range(rng, 0.3, 0.62);
    sampleBranch(trunk, t, _sample);
    const a = az0 + range(rng, 0, TAU);
    epiphytes.push({
      p: new THREE.Vector3(
        _sample.p.x + Math.cos(a) * (_sample.r + 0.06),
        _sample.p.y,
        _sample.p.z + Math.sin(a) * (_sample.r + 0.06)
      ),
      scale: range(rng, 0.72, 0.95),
    });
  }
  for (const limb of limbs) {
    if (limb.meta.epiphyte) epiphytes.push({ p: limb.meta.epiphyte, scale: range(rng, 0.8, 1.05) });
  }
  while (epiphytes.length > spec.epiphytes) epiphytes.pop();

  // ---------------------------------------------------------- second-order
  for (const limb of limbs) {
    const count = intRange(rng, spec.sub.countMin, spec.sub.countMax);
    for (let k = 0; k < count; k++) {
      const t = range(rng, 0.28, 0.84);
      sampleBranch(limb, t, _sample);
      const side = k % 2 ? 1 : -1;
      const az = limb.meta.az + side * range(rng, 0.55, 1.45) + range(rng, -0.18, 0.18);
      const elev = range(rng, 0.12, 0.78);
      _dir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
      _out.set(Math.cos(az), 0, Math.sin(az));
      const want = range(rng, spec.sub.lenMin, spec.sub.lenMax) * (t < 0.5 ? 1.12 : 0.92);
      const len = Math.max(0.9, Math.min(want, fitInEnvelope(_sample.p, _dir, want, growEnv) * 1.02));
      const curve = growCurve(rng, _sample.p, _dir, len, spec.rSub0, spec.rSub1, {
        seg: 0.22,
        wobble: 0.55,
        curlDecay: 0.68,
        up: 0.05,
        droop: 0.34,
        droopPow: 1.3,
        outward: _out,
        outPush: 0.12,
        env: growEnv,
        envMax: 0.995,
      });
      const sub = makeBranch(curve, {
        level: 2,
        parent: limb,
        attachIdx: indexAtPd(limb, _sample.pd),
        kind: 'sub',
        padArea: spec.sub.load,
      });
      sub.meta = { az, outward: _out.clone(), attach: _sample.p.clone() };
      subs.push(sub);
      leafLoad += sub.padArea;

      // leaf pad at the end of every second-order limb
      const tipS = sub.pts[sub.pts.length - 1];
      const pad = {
        c: tipS.clone().addScaledVector(UP, 0.12),
        rx: 0,
        ry: 0,
        rz: 0,
        yaw: rng() * TAU,
        shade: 1,
        sub,
        twigs: [],
      };

      // --------------------------------------------------------------- twigs
      const twigCount = intRange(rng, spec.twigs.countMin, spec.twigs.countMax);
      let spread = 0;
      for (let j = 0; j < twigCount; j++) {
        const tt = range(rng, 0.3, 0.96);
        sampleBranch(sub, tt, _sample);
        const taz = az + range(rng, -1.15, 1.15);
        const te = range(rng, -0.15, 0.85);
        _dir.set(Math.cos(taz) * Math.cos(te), Math.sin(te), Math.sin(taz) * Math.cos(te)).normalize();
        const tlen = range(rng, spec.twigs.lenMin, spec.twigs.lenMax) * (tt < 0.5 ? 1.15 : 0.88);
        const tcurve = growCurve(rng, _sample.p, _dir, tlen, spec.rTwig0, spec.rTwig1, {
          seg: 0.13,
          wobble: 0.85,
          curlDecay: 0.6,
          droop: 0.34,
          droopPow: 1.1,
          up: 0.02,
          env: growEnv,
          envMax: 1.02,
        });
        const twig = makeBranch(tcurve, {
          level: 3,
          parent: sub,
          attachIdx: indexAtPd(sub, _sample.pd),
          kind: 'twig',
          padArea: spec.twigs.load,
        });
        twig.pad = pad;
        twigs.push(twig);
        pad.twigs.push(twig);
        leafLoad += twig.padArea;
        for (const tp of twig.pts) spread = Math.max(spread, tp.distanceTo(pad.c));
      }
      pad.rx = Math.max(0.5, Math.min(1.95, spread * 1.02 + 0.2));
      pad.ry = pad.rx * 0.56;
      pad.rz = pad.rx;
      // keep the pad inside the leaf envelope: a pad hanging outside would only get its
      // cards rejected by the leaf-tip clamp and leave a bald patch in the crown
      const prx = (pad.c.x - env.c.x) / env.r.x;
      const pry = (pad.c.y - env.c.y) / env.r.y;
      const prz = (pad.c.z - env.c.z) / env.r.z;
      const prho = prx * prx + pry * pry + prz * prz;
      if (prho > 0.9) {
        const k = Math.sqrt(0.9 / prho);
        pad.c.set(
          env.c.x + (pad.c.x - env.c.x) * k,
          env.c.y + (pad.c.y - env.c.y) * k,
          env.c.z + (pad.c.z - env.c.z) * k
        );
      }
      pads.push(pad);
    }
  }

  // pads shade each other: a pad with another pad above it sits in its shadow
  for (const p of pads) {
    let shade = 1;
    for (const q of pads) {
      if (q === p) continue;
      const dy = q.c.y - p.c.y;
      if (dy <= 0.05) continue;
      const dh = Math.hypot(q.c.x - p.c.x, q.c.z - p.c.z);
      const reach = (q.rx + p.rx) * 0.9;
      if (dh > reach) continue;
      shade -= 0.12 * Math.min(1, dy / Math.max(0.5, q.ry * 2)) * (1 - dh / reach);
    }
    p.shade = Math.max(0.5, shade);
  }

  // ------------------------------------------------------------ low limbs
  for (let i = 0; i < spec.lowLimbs.count; i++) {
    const t = range(rng, spec.lowLimbs.tMin, spec.lowLimbs.tMax);
    sampleBranch(trunk, t, _sample);
    const az = az0 + range(rng, 0, TAU);
    const elev = range(rng, -18, 8) * DEG;
    _dir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
    _out.set(Math.cos(az), 0, Math.sin(az));
    const want = range(rng, spec.lowLimbs.lenMin, spec.lowLimbs.lenMax);
    const len = Math.max(1.2, Math.min(want, fitInEnvelope(_sample.p, _dir, want, growEnv) * 1.08));
    const curve = growCurve(rng, _sample.p, _dir, len, spec.rLow0, spec.rLow1, {
      seg: 0.26,
      wobble: 0.4,
      curlDecay: 0.72,
      droop: 0.5,
      droopPow: 1.5,
      outward: _out,
      outPush: 0.2,
      env: growEnv,
      envMax: 1.05,
    });
    const low = makeBranch(curve, {
      level: 1,
      parent: trunk,
      attachIdx: indexAtPd(trunk, _sample.pd),
      kind: 'low',
      padArea: spec.lowLimbs.load,
    });
    low.meta = { az, outward: _out.clone() };
    lowLimbs.push(low);
    leafLoad += low.padArea;
    // dead stubs on the low limbs: storm damage keeps the silhouette from being a dome
    if (i < 2) {
      const st = 0.6 + rng() * 0.25;
      sampleBranch(low, st, _sample);
      const saz = az + range(rng, 1.2, 2.6);
      const len2 = range(rng, 0.3, 0.62);
      const pts = [_sample.p.clone()];
      for (let k = 1; k <= 3; k++) {
        const f = k / 3;
        pts.push(new THREE.Vector3(
          _sample.p.x + Math.cos(saz) * len2 * f,
          _sample.p.y - 0.42 * f * f,
          _sample.p.z + Math.sin(saz) * len2 * f
        ));
      }
      stubs.push({ pts, rads: [0.055, 0.04, 0.024, 0.01] });
    }
  }

  // ------------------------------------------------------- crown shell samples
  // GT shellFill (vegetation-tree.js:303-366) simplified: no nearest-twig search, the
  // points are pure ellipsoid samples + a two-octave noise "sky window" field, then the
  // leaf mesher hangs 1-3 cards off each surviving point.
  const shell = [];
  const wanted = spec.shell.points;
  for (let i = 0; i < wanted * 4 && shell.length < wanted; i++) {
    randUnit(rng, _tmp);
    if (_tmp.y < spec.shell.minY) continue; // no shell under the crown
    const f = range(rng, 0.9, 1.005);
    const px = env.c.x + _tmp.x * env.r.x * f;
    const py = env.c.y + _tmp.y * env.r.y * f;
    const pz = env.c.z + _tmp.z * env.r.z * f;
    if (shellNoise(px, py, pz, spec.seed, spec.shell.noise) < spec.shell.clump) continue;
    shell.push({ p: new THREE.Vector3(px, py, pz), n: new THREE.Vector3(_tmp.x, _tmp.y, _tmp.z) });
  }

  // a handful of support twigs from the nearest pad out to a shell point: without them
  // the outer cards read as floating stickers from directly below
  for (let i = 0; i < spec.shell.support && shell.length; i++) {
    const s = shell[Math.floor(rng() * shell.length)];
    let best = null;
    let bestD = Infinity;
    for (const q of pads) {
      const d = q.c.distanceTo(s.p);
      if (d < bestD) { bestD = d; best = q; }
    }
    if (!best || bestD > 3.2) continue;
    const dir2 = new THREE.Vector3().subVectors(s.p, best.c).normalize();
    dir2.y += 0.1;
    dir2.normalize();
    const c = growCurve(rng, best.c.clone(), dir2, Math.min(bestD, 2.8), spec.rTwig0 * 0.8, 0.003, {
      seg: 0.24,
      wobble: 0.35,
      curlDecay: 0.6,
      up: 0.05,
      env,
      envMax: 1.04,
    });
    const br = makeBranch(c, { level: 3, parent: best.sub || null, attachIdx: 0, kind: 'support' });
    br.meta = { shell: s };
    shellTwigs.push(br);
    s.twig = br;
  }

  // -------------------------------------------------------- buttress plates
  const buttresses = [];
  const nb = spec.buttress.count;
  const ba0 = rng() * TAU;
  for (let i = 0; i < nb; i++) {
    const plate = {
      az: ba0 + (i / nb) * TAU + range(rng, -0.22, 0.22),
      out: range(rng, spec.buttress.outMin, spec.buttress.outMax),
      h: range(rng, spec.buttress.hMin, spec.buttress.hMax),
      thick: range(rng, spec.buttress.thickMin, spec.buttress.thickMax),
      curve: range(rng, -0.24, 0.24),
      seed: Math.round(rng() * 1000),
      paws: [],
    };
    for (let k = 0; k < 3; k++) {
      const a = plate.az + plate.curve + range(rng, -0.5, 0.5);
      const rr = plate.out * range(rng, 0.82, 1.05);
      plate.paws.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, r: range(rng, 0.09, 0.16) });
    }
    buttresses.push(plate);
  }

  // -------------------------------------------------------------- coiled lianas
  for (let i = 0; i < spec.lianas; i++) {
    const phase = rng() * TAU;
    const dirS = rng() < 0.5 ? 1 : -1;
    const yTop = range(rng, spec.trunkH * 0.58, spec.trunkH * 0.82);
    const turns = range(rng, 3.4, 5.6);
    const pts = [];
    const steps = 22;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const y = 0.28 + t * (yTop - 0.28);
      sampleBranch(trunk, Math.max(0, Math.min(1, y / Math.max(1, spec.trunkH))), _sample);
      const a = phase + dirS * t * turns;
      const rr = _sample.r * 1.04 + range(rng, 0.0, 0.05) + 0.02;
      pts.push(new THREE.Vector3(_sample.p.x + Math.cos(a) * rr, y, _sample.p.z + Math.sin(a) * rr));
    }
    lianas.push({ pts, r: range(rng, 0.025, 0.045) });
  }

  // ------------------------------------------------------------ hanging vines
  for (let i = 0; i < spec.vines; i++) {
    const az = az0 + range(rng, 0, TAU);
    const rr = range(rng, env.r.x * 0.42, env.r.x * 0.68);
    const top = new THREE.Vector3(
      env.c.x + Math.cos(az) * rr,
      env.c.y + range(rng, -0.4, 0.9),
      env.c.z + Math.sin(az) * rr
    );
    const len = range(rng, spec.vineLenMin, spec.vineLenMax);
    const ph = rng() * TAU;
    const pts = [top.clone()];
    const steps = 9;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      pts.push(new THREE.Vector3(
        top.x + Math.sin(t * 3.6 + ph) * 0.34 + t * 0.16,
        top.y - len * t,
        top.z + Math.cos(t * 2.9 + ph) * 0.3 - t * 0.1
      ));
    }
    hangingVines.push({ pts, r: range(rng, 0.014, 0.026), ph });
  }

  // ------------------------------------------------------------- emergent shoots
  for (let i = 0; i < spec.shoots; i++) {
    const a = (i / spec.shoots) * TAU + range(rng, -0.3, 0.3);
    const rr = range(rng, env.r.x * 0.25, env.r.x * 0.62);
    shoots.push({
      p: new THREE.Vector3(
        env.c.x + Math.cos(a) * rr,
        env.c.y + env.r.y * range(rng, 0.55, 0.92),
        env.c.z + Math.sin(a) * rr
      ),
      a,
      up: range(rng, 0.55, 1.0),
    });
  }

  // emergent shoots need a woody stem: without one their leaf cards read as detached
  // stickers above the crown from 5 m below (D-06)
  for (const sh of shoots) {
    let best = null;
    let bestD = Infinity;
    for (const q of pads) {
      const d = q.c.distanceTo(sh.p);
      if (d < bestD) { bestD = d; best = q; }
    }
    if (!best) continue;
    const dir = new THREE.Vector3().subVectors(sh.p, best.c).normalize();
    dir.y += 0.15;
    dir.normalize();
    const c = growCurve(rng, best.c.clone(), dir, Math.min(bestD, 1.25), spec.rTwig0 * 0.62, 0.004, {
      seg: 0.22,
      wobble: 0.3,
      curlDecay: 0.7,
      up: 0.1,
      env,
      envMax: 1.04,
    });
    const br = makeBranch(c, { level: 3, parent: best.sub || null, attachIdx: 0, kind: 'shoot' });
    br.meta = { shoot: sh };
    shellTwigs.push(br);
    sh.twig = br;
  }

  // --------------------------------------------------------------- assemble record
  const branches = [trunk, ...limbs, ...subs, ...twigs, ...lowLimbs, ...shellTwigs];
  let pdMax = 0;
  for (const b of branches) pdMax = Math.max(pdMax, b.pd[b.pd.length - 1]);

  return {
    env,
    growEnv,
    trunk,
    limbs,
    lowLimbs,
    subs,
    twigs,
    pads,
    shell,
    shellTwigs,
    buttresses,
    lianas,
    hangingVines,
    epiphytes,
    stubs,
    shoots,
    branches,
    leafLoad,
    pdMax: Math.max(1, pdMax),
  };
}
