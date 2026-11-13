/**
 * SANDSTRIKE // 沙暴协议
 * src/enemies.js — hostile robot chassis, squad AI, combat and the fifteen-wave director.
 *
 * Owner: robot-combat.  Public contract: see TEAM_SPEC.md ("src/enemies.js").
 *
 * Exports:
 *   class EnemyManager {
 *     constructor({ scene, world, effects, audio, getPlayer, quality })
 *     raycastTargets   // THREE.Object3D[] — hitbox meshes, userData.robot + userData.zone
 *     state            // { wave, totalWaves, alive, remaining, betweenWaves }
 *     start() reset() update(dt, elapsed) damage(object, amount, opts) dispose()
 *     debugKillAll()   // QA helper: instantly clears the active wave
 *   }
 *
 * Everything is built from procedural primitives (shared geometries, merged per material),
 * navigated with an A* grid derived from world.collisionBoxes, and animated procedurally.
 * No DOM, no async, no allocations in the per-frame hot paths beyond tiny bus payloads.
 */
import * as THREE from 'three';
import { emit } from './bus.js';
import { clamp, lerp, damp, dampAngle, angleDelta, rand, randInt, choice, smoothstep } from './utils.js';
import { CONFIG } from './config.js';
import {
  ROBOT_TYPES,
  TYPE_KEYS,
  buildRobotRig,
  createRobotBaseMaterials,
  createRigMaterialSet,
  createUnitGeos,
  disposeUnitGeos,
} from './models/robots/index.js';

/* ================================================================== *
 *  0. Constants & micro helpers
 * ================================================================== */

const TAU = Math.PI * 2;
const WORLD_BOUNDS = (CONFIG.world && CONFIG.world.bounds) || { minX: -34, maxX: 34, minZ: -34, maxZ: 34 };
const TOTAL_WAVES = (CONFIG.waves && CONFIG.waves.total) || 5;
const BETWEEN_TIME = (CONFIG.waves && CONFIG.waves.betweenTime) || 6.5;
const FIRST_DELAY = (CONFIG.waves && CONFIG.waves.firstDelay) || 2.2;
const HEADSHOT_MULT = (CONFIG.weapon && CONFIG.weapon.headshotMultiplier) || 2.3;
const LIMB_MULT = (CONFIG.weapon && CONFIG.weapon.limbMultiplier) || 0.72;
/** Independent bonus-drop table (chances/effects live in config.js). */
const LOOT = CONFIG.loot || {};

const IS_DEV = (() => {
  try {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev');
  } catch (_) {
    return false;
  }
})();

const _TMP = {
  v1: new THREE.Vector3(),
  v2: new THREE.Vector3(),
  v3: new THREE.Vector3(),
  v4: new THREE.Vector3(),
  v5: new THREE.Vector3(),
  v6: new THREE.Vector3(),
  q1: new THREE.Quaternion(),
  q2: new THREE.Quaternion(),
  e1: new THREE.Euler(),
  m1: new THREE.Matrix4(),
};

const UP = new THREE.Vector3(0, 1, 0);
const EMPTY_ARRAY = [];

/** Safe call into a dependency that may be missing / not implemented yet. */
function callOptional(target, method, ...args) {
  if (!target) return undefined;
  const fn = target[method];
  if (typeof fn !== 'function') return undefined;
  try {
    return fn.apply(target, args);
  } catch (_) {
    return undefined;
  }
}

/** Copy a THREE.Vector3-like or plain {x,y,z} into a target Vector3. */
function copyVec(target, src) {
  if (src && typeof src.x === 'number') target.set(src.x, src.y || 0, src.z || 0);
  else target.set(0, 0, 0);
  return target;
}

const dist2D = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

/** Yaw (three.js convention: yaw 0 faces -Z) that looks from (fx,fz) toward (tx,tz). */
function yawToPoint(fx, fz, tx, tz) {
  return Math.atan2(-(tx - fx), -(tz - fz));
}

function easeOutCubic(t) {
  t = clamp(t, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t) {
  t = clamp(t, 0, 1);
  return t * t * t;
}

/* ================================================================== *
 *  Robot model definitions — one module per chassis in src/models/robots/.
 * ================================================================== */

/* ================================================================== *
 *  1. Wave script
 * ================================================================== */

const WAVE_STAGES = [
  { comp: { scout: 4 }, label: 'SCOUT SWEEP // 侦察清扫' },
  { comp: { scout: 4, rifleman: 2 }, label: 'RIFLE TEAM // 步枪分队' },
  { comp: { scout: 3, rifleman: 3, heavy: 2 }, label: 'HEAVY CONTACT // 重装接触' },
  { comp: { scout: 2, rifleman: 4, heavy: 4 }, label: 'SIEGE LINE // 围攻阵线' },
  { comp: { scout: 3, rifleman: 4, heavy: 4, warlord: 1 }, label: 'WARLORD // 监军降临' },
  { comp: { scout: 4, rifleman: 4, heavy: 3 }, label: 'COUNTERATTACK // 敌军反扑' },
  { comp: { scout: 3, rifleman: 6, heavy: 4 }, label: 'SHOCK WAVE // 冲击波次' },
  { comp: { scout: 4, rifleman: 6, heavy: 4 }, label: 'ATTRITION // 消耗战' },
  { comp: { scout: 2, rifleman: 8, heavy: 6 }, label: 'SIEGE ESCALATION // 围攻升级' },
  { comp: { rifleman: 6, heavy: 6, warlord: 1 }, label: 'WARLORD II // 双刃监军' },
  { comp: { scout: 4, rifleman: 6, heavy: 6 }, label: 'IRON RAIN // 钢铁弹雨' },
  { comp: { scout: 4, rifleman: 8, heavy: 6 }, label: 'DEAD GROUND // 死亡地带' },
  { comp: { scout: 3, rifleman: 8, heavy: 8 }, label: 'LAST LINE // 最后防线' },
  { comp: { scout: 4, rifleman: 8, heavy: 8 }, label: 'FINAL PUSH // 最终冲锋' },
  { comp: { rifleman: 8, heavy: 8, warlord: 1 }, label: 'OMEGA WARLORD // 终焉监军' },
];

function waveMods(wave) {
  const k = clamp(wave - 1, 0, TOTAL_WAVES - 1);
  return {
    hp: 1 + 0.035 * k,
    speed: 1 + 0.025 * k,
    acc: 1 + 0.04 * k,
    dmg: 1 + 0.032 * k,
    cooldown: 1 - 0.04 * k,
    telegraph: 1 - 0.035 * k,
    tokens: clamp(2 + Math.floor((wave - 1) / 4), 2, 6),
  };
}

function stageCount(stage) {
  let n = 0;
  for (const key in stage.comp) n += stage.comp[key];
  return n;
}

/** Expand a wave composition into a spawn order (bigger chassis materialise later). */
function buildSpawnOrder(stage) {
  const order = [];
  const heavyFirst = [];
  for (const key of TYPE_KEYS) {
    const count = stage.comp[key] || 0;
    for (let i = 0; i < count; i++) {
      if (key === 'heavy' || key === 'warlord') heavyFirst.push(key);
      else order.push(key);
    }
  }
  // shuffle lights a little; bosses/heavies spawn at the back of the queue for drama
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  return order.concat(heavyFirst);
}

/* ================================================================== *
 *  2. A* navigation grid (1 m cells, robot-radius clearance)
 * ================================================================== */

const DIRS_8 = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, 1.41421356],
  [1, -1, 1.41421356],
  [-1, 1, 1.41421356],
  [-1, -1, 1.41421356],
];

class NavGrid {
  constructor(bounds, cellSize, boxes, radius) {
    this.cellSize = cellSize;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.maxX = bounds.maxX;
    this.maxZ = bounds.maxZ;
    this.gw = Math.max(2, Math.ceil((this.maxX - this.minX) / cellSize));
    this.gh = Math.max(2, Math.ceil((this.maxZ - this.minZ) / cellSize));
    this.radius = radius;
    const n = this.gw * this.gh;
    this.blocked = new Uint8Array(n);
    this._build(boxes);
    this.gScore = new Float32Array(n);
    this.fScore = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.stamp = 0;
    this.heap = new Int32Array(Math.max(128, n * 3));
    this.heapSize = 0;
  }

  _build(boxes) {
    const cell = this.cellSize;
    const list = boxes || [];
    for (let b = 0; b < list.length; b++) {
      const box = list[b];
      if (!box) continue;
      if (box.maxY <= 0.18) continue; // floor / rugs
      if (box.minY >= 1.9) continue; // overhead only (awnings, arches: walk beneath)
      const minX = box.minX - this.radius;
      const maxX = box.maxX + this.radius;
      const minZ = box.minZ - this.radius;
      const maxZ = box.maxZ + this.radius;
      let cx0 = Math.floor((minX - this.minX) / cell);
      let cx1 = Math.floor((maxX - this.minX) / cell);
      let cz0 = Math.floor((minZ - this.minZ) / cell);
      let cz1 = Math.floor((maxZ - this.minZ) / cell);
      cx0 = clamp(cx0, 0, this.gw - 1);
      cx1 = clamp(cx1, 0, this.gw - 1);
      cz0 = clamp(cz0, 0, this.gh - 1);
      cz1 = clamp(cz1, 0, this.gh - 1);
      for (let cz = cz0; cz <= cz1; cz++) {
        const z = this.minZ + (cz + 0.5) * cell;
        if (z < minZ || z > maxZ) continue;
        const row = cz * this.gw;
        for (let cx = cx0; cx <= cx1; cx++) {
          const x = this.minX + (cx + 0.5) * cell;
          if (x < minX || x > maxX) continue;
          this.blocked[row + cx] = 1;
        }
      }
    }
    // Keep a little skirt clear at the very edge of the playable map.
    for (let cz = 0; cz < this.gh; cz++) {
      const z = this.minZ + (cz + 0.5) * cell;
      for (let cx = 0; cx < this.gw; cx++) {
        const x = this.minX + (cx + 0.5) * cell;
        if (x < this.minX + 0.2 || x > this.maxX - 0.2 || z < this.minZ + 0.2 || z > this.maxZ - 0.2) {
          this.blocked[cz * this.gw + cx] = 1;
        }
      }
    }
  }

  cellX(x) {
    return clamp(Math.floor((x - this.minX) / this.cellSize), 0, this.gw - 1);
  }

  cellZ(z) {
    return clamp(Math.floor((z - this.minZ) / this.cellSize), 0, this.gh - 1);
  }

  centerX(cx) {
    return this.minX + (cx + 0.5) * this.cellSize;
  }

  centerZ(cz) {
    return this.minZ + (cz + 0.5) * this.cellSize;
  }

  isFree(cx, cz) {
    return cx >= 0 && cx < this.gw && cz >= 0 && cz < this.gh && this.blocked[cz * this.gw + cx] === 0;
  }

  freeAt(x, z) {
    return this.isFree(this.cellX(x), this.cellZ(z));
  }

  nearestFree(cx, cz, maxRing = 7) {
    if (this.isFree(cx, cz)) return cz * this.gw + cx;
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
          if (this.isFree(cx + dx, cz + dz)) return (cz + dz) * this.gw + (cx + dx);
        }
      }
    }
    return -1;
  }

  lineFree(x0, z0, x1, z1) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (this.cellSize * 0.35)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isFree(this.cellX(x0 + dx * t), this.cellZ(z0 + dz * t))) return false;
    }
    return true;
  }

  /** Returns a smoothed waypoint list [{x,z}] from (sx,sz) to near (gx,gz), or null. */
  findPath(sx, sz, gx, gz) {
    const startIdx = this.nearestFree(this.cellX(sx), this.cellZ(sz), 4);
    const goalIdx = this.nearestFree(this.cellX(gx), this.cellZ(gz), 7);
    if (startIdx < 0 || goalIdx < 0) return null;
    if (startIdx === goalIdx) return [{ x: gx, z: gz }];

    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.stamp = 1;
    }
    const stamp = this.stamp;
    this.heapSize = 0;

    const gw = this.gw;
    const goalCx = goalIdx % gw;
    const goalCz = (goalIdx / gw) | 0;
    const heur = (idx) => {
      const cx = idx % gw;
      const cz = (idx / gw) | 0;
      const ax = Math.abs(cx - goalCx);
      const az = Math.abs(cz - goalCz);
      return ax + az + (1.41421356 - 2) * Math.min(ax, az);
    };

    this.gScore[startIdx] = 0;
    this.fScore[startIdx] = heur(startIdx);
    this.parent[startIdx] = -1;
    this.seen[startIdx] = stamp;
    this._heapPush(startIdx);

    let iterations = 0;
    while (this.heapSize > 0 && iterations < 6000) {
      iterations++;
      const cur = this._heapPop();
      if (this.closed[cur] === stamp) continue;
      this.closed[cur] = stamp;
      if (cur === goalIdx) return this._reconstruct(cur, sx, sz, gx, gz);
      const cx = cur % gw;
      const cz = (cur / gw) | 0;
      const gcur = this.gScore[cur];
      for (let k = 0; k < 8; k++) {
        const dir = DIRS_8[k];
        const nx = cx + dir[0];
        const nz = cz + dir[1];
        if (nx < 0 || nx >= gw || nz < 0 || nz >= this.gh) continue;
        const ni = nz * gw + nx;
        if (this.blocked[ni]) continue;
        if (dir[0] !== 0 && dir[1] !== 0) {
          // no corner cutting through wall diagonals
          if (this.blocked[cz * gw + nx] || this.blocked[nz * gw + cx]) continue;
        }
        if (this.closed[ni] === stamp) continue;
        const ng = gcur + dir[2];
        if (this.seen[ni] !== stamp || ng < this.gScore[ni]) {
          this.seen[ni] = stamp;
          this.gScore[ni] = ng;
          this.fScore[ni] = ng + heur(ni);
          this.parent[ni] = cur;
          this._heapPush(ni);
        }
      }
    }
    return null;
  }

  _reconstruct(goalIdx, sx, sz, gx, gz) {
    const gw = this.gw;
    const cells = [];
    let idx = goalIdx;
    let guard = 0;
    while (idx !== -1 && guard++ < 4096) {
      cells.push(idx);
      idx = this.parent[idx];
    }
    cells.reverse();
    const pts = [];
    for (let i = 0; i < cells.length; i++) {
      pts.push({ x: this.centerX(cells[i] % gw), z: this.centerZ((cells[i] / gw) | 0) });
    }
    if (this.freeAt(gx, gz)) pts[pts.length - 1] = { x: gx, z: gz };

    // String-pull: greedily skip waypoints while the straight segment stays walkable.
    const out = [];
    let curX = sx;
    let curZ = sz;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineFree(curX, curZ, pts[j].x, pts[j].z)) j--;
      const p = pts[j];
      out.push({ x: p.x, z: p.z });
      curX = p.x;
      curZ = p.z;
      i = j + 1;
      if (out.length >= 48) break;
    }
    return out;
  }

  _heapPush(idx) {
    if (this.heapSize >= this.heap.length) return;
    const heap = this.heap;
    const f = this.fScore;
    let i = this.heapSize++;
    heap[i] = idx;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[heap[p]] <= f[heap[i]]) break;
      const tmp = heap[p];
      heap[p] = heap[i];
      heap[i] = tmp;
      i = p;
    }
  }

  _heapPop() {
    const heap = this.heap;
    const f = this.fScore;
    const rootIdx = heap[0];
    this.heapSize--;
    const last = heap[this.heapSize];
    if (this.heapSize > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.heapSize && f[heap[l]] < f[heap[m]]) m = l;
        if (r < this.heapSize && f[heap[r]] < f[heap[m]]) m = r;
        if (m === i) break;
        const tmp = heap[m];
        heap[m] = heap[i];
        heap[i] = tmp;
        i = m;
      }
    }
    return rootIdx;
  }
}

/* ================================================================== *
 *  3. Robot runtime — spawn / navigate / shoot / die
 * ================================================================== */

class Robot {
  constructor(manager, typeKey, rig) {
    this.mgr = manager;
    this.type = typeKey;
    this.def = ROBOT_TYPES[typeKey];
    this.rig = rig;
    this.root = rig.root;
    this.parts = rig.parts;
    this.hitboxes = rig.hitboxes;
    this.muzzle = rig.muzzle;
    this.laser = rig.laser || null;
    this.radius = this.def.radius;
    this.height = this.def.height;
    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this._eyeWorld = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();
    this._shotDir = new THREE.Vector3();
    this._shotEnd = new THREE.Vector3();
    this._shotNormal = new THREE.Vector3();
    this._moveX = 0;
    this._moveZ = 0;
    this.hitboxesRegistered = false;
    this.active = false;
    this.alive = false;
    this.dead = false;
    this._applyDefaults();
  }

  _applyDefaults() {
    this.wave = 1;
    this.mods = waveMods(1);
    this.maxHp = this.def.hp;
    this.hp = this.def.hp;
    this.state = 'dead';
    this.stateTime = 0;
    this.age = 0;
    this.spawnT = 0;
    this.deathT = 0;
    this.deathDuration = 2;
    this.deathFall = 1;
    this.deathTwist = 0;
    this.deathSecondary = 0;
    this._deathFade = false;
    this.fireState = 'idle';
    this.fireTimer = 0;
    this.shotTimer = 0;
    this.shotsLeft = 0;
    this.telegraph = 0;
    this.cooldownT = 0;
    this.ammo = 0;
    this.reloadT = 0;
    this.hasToken = false;
    this.tokenWait = 0;
    this.los = false;
    this.losTimer = 0;
    this.lastSeen = 99;
    this.everSeen = false;
    this.lastKnownX = 0;
    this.lastKnownZ = 0;
    this.path = null;
    this.pathIndex = 0;
    this.pathDestX = NaN;
    this.pathDestZ = NaN;
    this.nextPathAt = 0;
    this.stuckTime = 0;
    this.lastX = 0;
    this.lastZ = 0;
    this.speed2D = 0;
    this.strafeDir = 1;
    this.strafeTimer = 1;
    this.flankDir = 1;
    this.flankTimer = 4;
    this.flankHold = 0;
    this.repositionMode = 'seek';
    this.reactT = 0;
    this.damageFlash = 0;
    this.flashApplied = false;
    this.stagger = 0;
    this.staggerLean = 0;
    this.recoil = 0;
    this.walkPhase = 0;
    this.stepAccum = 0;
    this.bodyYaw = 0;
    this.aimYaw = 0;
    this.aimTargetTwist = 0;
    this.aimTargetPitch = 0;
    this.headTargetYaw = 0;
    this.headTargetPitch = 0;
    this.torsoTwistActual = 0;
    this.torsoPitchActual = 0;
  }

  spawn(x, z, wave, mods) {
    this._applyDefaults();
    this.wave = wave;
    this.mods = mods;
    this.maxHp = Math.max(1, Math.round(this.def.hp * mods.hp));
    this.hp = this.maxHp;
    this.active = true;
    this.alive = true;
    this.dead = false;
    this.state = 'spawn';
    this.stateTime = 0;
    this.age = 0;
    this.spawnT = 0;
    this.cooldownT = rand(0.35, 1.15);
    this.ammo = this.def.fire.mag;
    this.losTimer = rand(0.02, 0.2);
    this.path = null;
    this.pathDestX = NaN;
    this.pathDestZ = NaN;
    this.nextPathAt = 0;
    this.lastX = x;
    this.lastZ = z;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = rand(0.8, 1.7);
    this.flankDir = Math.random() < 0.5 ? -1 : 1;
    this.flankTimer = rand(3.0, 6.0);
    this.walkPhase = rand(0, TAU);
    const p = this.mgr._player;
    this.bodyYaw = p.alive ? yawToPoint(x, z, p.x, p.z) : rand(0, TAU);
    this.aimYaw = this.bodyYaw;
    this._basePose();
    this.root.position.set(x, -0.45, z);
    this.root.rotation.set(0, this.bodyYaw, 0);
    this.root.scale.setScalar(0.22);
    this.root.visible = true;
    this.root.userData.robot = this;
    if (this.laser) this.laser.visible = false;
    const mats = this.rig.mats;
    mats.glow.color.setScalar(1.55);
    mats.body.emissive.setRGB(0, 0, 0);
    this.flashApplied = false;
    this.mgr._onRobotSpawn(this);
  }

  _basePose() {
    const M = this.def.model;
    const parts = this.parts;
    parts.pelvis.position.set(0, M.hipY, 0);
    parts.pelvis.rotation.set(0, 0, 0);
    parts.torso.position.set(0, M.torsoPivotY, 0);
    parts.torso.rotation.set(0, 0, 0);
    parts.head.position.y = M.neckY;
    parts.head.rotation.set(0, 0, 0);
    parts.armL.rotation.set(0.05, 0, 0.06);
    parts.armR.rotation.set(0, 0, 0);
    parts.gunGroup.position.set(this.rig.baseGunX, this.rig.baseGunY, this.rig.baseGunZ);
    parts.gunGroup.rotation.set(0, 0, 0);
    parts.legL.position.set(-M.hipX, M.hipY, 0);
    parts.legL.rotation.set(0, 0, 0);
    parts.legR.position.set(M.hipX, M.hipY, 0);
    parts.legR.rotation.set(0, 0, 0);
    this.root.rotation.set(0, this.bodyYaw, 0);
    this.root.scale.setScalar(1);
    this.root.position.y = 0;
    this.vel.set(0, 0, 0);
  }

  update(dt) {
    this.age += dt;
    this.stateTime += dt;
    if (this.state === 'spawn') {
      this._updateSpawn(dt);
      return;
    }
    if (this.state === 'dying') {
      this._updateDeath(dt);
      return;
    }
    if (!this.alive || this.state === 'dead') return;

    this.stagger = Math.max(0, this.stagger - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 5.5);
    this.recoil = Math.max(0, this.recoil - dt * 7);

    this._updateLOS(dt);
    this._chooseState(dt);
    this._updateLocomotion(dt);
    this._updateAim(dt);
    this._updateWeapon(dt);
    this._updateAnimation(dt);
    this._updateLaser();

    this.root.updateMatrixWorld(true);
  }

  /* ---------------- perception ---------------- */

  getEyeWorld(out) {
    return out.set(this.pos.x, this.pos.y + this.def.eyeHeight, this.pos.z);
  }

  _updateLOS(dt) {
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.los = this.mgr.checkLOS(this);
      const key = this.def.key;
      this.losTimer = (key === 'scout' ? 0.16 : key === 'heavy' || key === 'warlord' ? 0.24 : 0.2) + Math.random() * 0.08;
      if (this.los) {
        const p = this.mgr._player;
        this.lastKnownX = p.x;
        this.lastKnownZ = p.z;
        this.everSeen = true;
      }
    }
    if (this.los) this.lastSeen = 0;
    else this.lastSeen += dt;
  }

  /* ---------------- behaviour ---------------- */

  _chooseState(dt) {
    const p = this.mgr._player;
    const D = this.def;
    if (!p.alive) {
      this.state = 'idle';
      if (this.fireState !== 'idle') this._endFire(true);
      return;
    }
    const dist = dist2D(this.pos.x, this.pos.z, p.x, p.z);

    if (this.state === 'idle') this.state = 'advance';

    if (this.los && dist <= D.ranges.max * 1.12) {
      if (dist < D.ranges.min) {
        this.state = 'reposition';
        this.repositionMode = 'back';
      } else {
        this.state = 'engage';
      }
    } else if (this.los) {
      this.state = 'advance';
    } else if (this.lastSeen < 2.2) {
      if (this.state !== 'reposition' || this.repositionMode !== 'flank') {
        this.state = 'reposition';
        this.repositionMode = 'seek';
      }
    } else if (this.state === 'reposition' && this.repositionMode === 'flank') {
      // keep the flank manoeuvre running even without LOS
    } else {
      this.state = 'advance';
    }

    // Occasional flank manoeuvre while trading fire.
    this.flankTimer -= dt;
    if (this.flankTimer <= 0) {
      this.flankTimer = rand(3.6, 6.5);
      if (this.state === 'engage' && Math.random() < 0.6 && this.stagger <= 0) {
        this.state = 'reposition';
        this.repositionMode = 'flank';
        this.flankDir = Math.random() < 0.5 ? -1 : 1;
        this.flankHold = rand(1.1, 2.2);
      }
    }
    if (this.state === 'reposition' && this.repositionMode === 'flank') {
      this.flankHold -= dt;
      const flank = this._flankPoint(p, D);
      const fd = dist2D(this.pos.x, this.pos.z, flank.x, flank.z);
      if (this.flankHold <= 0 || (this.los && fd < 2.2 && dist < D.ranges.ideal + 2)) {
        this.state = 'engage';
        this.repositionMode = 'seek';
      }
    }
  }

  _flankPoint(p, D) {
    const baseAng = Math.atan2(this.pos.x - p.x, this.pos.z - p.z);
    const ang = baseAng + this.flankDir * 0.95;
    const radius = clamp(D.ranges.ideal, 5, 17);
    return { x: p.x + Math.sin(ang) * radius, z: p.z + Math.cos(ang) * radius };
  }

  /* ---------------- path requests ---------------- */

  _requestPath(tx, tz, urgent = false) {
    const mgr = this.mgr;
    if (!urgent && mgr.time < this.nextPathAt) return;
    if (!urgent && this.path && Math.abs(this.pathDestX - tx) < 1.2 && Math.abs(this.pathDestZ - tz) < 1.2) return;
    if (!mgr.consumePathBudget()) {
      this.nextPathAt = mgr.time + 0.07;
      return;
    }
    const grid = mgr.navFor(this.radius);
    let path = grid.findPath(this.pos.x, this.pos.z, tx, tz);
    if (!path && mgr._navLight && grid !== mgr._navLight) {
      // Big chassis occasionally cannot thread a 2.4 m doorway on the expanded
      // heavy grid; fall back to the light clearance grid. Wall collision
      // resolution keeps the visual body out of the geometry.
      path = mgr._navLight.findPath(this.pos.x, this.pos.z, tx, tz);
    }
    this.nextPathAt = mgr.time + rand(1.3, 2.3);
    if (path && path.length) {
      this.path = path;
      this.pathIndex = 0;
      this.pathDestX = tx;
      this.pathDestZ = tz;
    } else {
      this.path = null;
      this.pathDestX = NaN;
      this.pathDestZ = NaN;
      this.nextPathAt = mgr.time + 0.5;
    }
  }

  _followPath() {
    if (!this.path || !this.path.length) return null;
    while (this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex];
      if (dist2D(this.pos.x, this.pos.z, wp.x, wp.z) < 0.55) {
        this.pathIndex++;
        continue;
      }
      return wp;
    }
    this.path = null;
    this.nextPathAt = 0;
    return null;
  }

  _steerTo(tx, tz, speed) {
    const grid = this.mgr.navFor(this.radius);
    const direct = grid.lineFree(this.pos.x, this.pos.z, tx, tz);
    let wx = tx;
    let wz = tz;
    if (!direct) {
      if (!this.path || Math.abs(this.pathDestX - tx) > 2.2 || Math.abs(this.pathDestZ - tz) > 2.2) {
        this._requestPath(tx, tz);
      }
      const wp = this._followPath();
      if (wp) {
        wx = wp.x;
        wz = wp.z;
      }
    } else {
      this.path = null;
    }
    const dx = wx - this.pos.x;
    const dz = wz - this.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.08) {
      this._moveX = 0;
      this._moveZ = 0;
      return 0;
    }
    this._moveX = dx / len;
    this._moveZ = dz / len;
    return speed;
  }

  /* ---------------- locomotion ---------------- */

  _updateLocomotion(dt) {
    const mgr = this.mgr;
    const p = mgr._player;
    const D = this.def;
    const pos = this.pos;
    const dist = dist2D(pos.x, pos.z, p.x, p.z);
    let speed = D.speed * this.mods.speed;
    if (this.stagger > 0) speed *= 0.32;
    if (this.fireState === 'aim' || this.fireState === 'burst') speed *= 0.62;
    if (this.reloadT > 0) speed *= 0.85;

    this._moveX = 0;
    this._moveZ = 0;
    let desiredSpeed = 0;

    if (!p.alive || this.state === 'idle') {
      // stand down
    } else if (this.state === 'engage') {
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = rand(0.9, 2.0);
        this.strafeDir *= -1;
      }
      const dirX = (p.x - pos.x) / Math.max(dist, 1e-4);
      const dirZ = (p.z - pos.z) / Math.max(dist, 1e-4);
      let radial = 0;
      if (dist > D.ranges.ideal + 1.5) radial = 1;
      else if (dist < D.ranges.ideal - 1.5) radial = -1;
      let mx = -dirZ * this.strafeDir * 0.95 + dirX * radial;
      let mz = dirX * this.strafeDir * 0.95 + dirZ * radial;
      const len = Math.hypot(mx, mz) || 1;
      mx /= len;
      mz /= len;
      const grid = mgr.navFor(this.radius);
      if (!grid.lineFree(pos.x, pos.z, pos.x + mx * 1.5, pos.z + mz * 1.5)) {
        this.strafeDir *= -1;
        mx = -mx;
        mz = -mz;
        this.strafeTimer = rand(0.4, 0.9);
      }
      this._moveX = mx;
      this._moveZ = mz;
      desiredSpeed = speed * 0.9;
    } else if (this.state === 'reposition') {
      if (this.repositionMode === 'back') {
        const dirX = (p.x - pos.x) / Math.max(dist, 1e-4);
        const dirZ = (p.z - pos.z) / Math.max(dist, 1e-4);
        let mx = -dirX - dirZ * 0.4 * this.flankDir;
        let mz = -dirZ + dirX * 0.4 * this.flankDir;
        const len = Math.hypot(mx, mz) || 1;
        this._moveX = mx / len;
        this._moveZ = mz / len;
        desiredSpeed = speed;
        if (this.los && dist > D.ranges.min + 1.2) {
          this.state = 'engage';
        }
      } else if (this.repositionMode === 'flank') {
        const flank = this._flankPoint(p, D);
        desiredSpeed = this._steerTo(flank.x, flank.z, speed);
      } else {
        const td = dist2D(pos.x, pos.z, this.lastKnownX, this.lastKnownZ);
        if (td < 1.4) desiredSpeed = this._steerTo(p.x, p.z, speed);
        else desiredSpeed = this._steerTo(this.lastKnownX, this.lastKnownZ, speed);
      }
    } else {
      let tx = p.x;
      let tz = p.z;
      if (!this.los && this.everSeen && this.lastSeen < 6) {
        tx = this.lastKnownX;
        tz = this.lastKnownZ;
      }
      desiredSpeed = this._steerTo(tx, tz, speed);
    }

    // hit reaction: sidestep while recovering
    if (this.reactT > 0) {
      this.reactT -= dt;
      if (this._moveX !== 0 || this._moveZ !== 0) {
        const mx = -this._moveZ * this.flankDir * 0.7;
        const mz = this._moveX * this.flankDir * 0.7;
        this._moveX += mx;
        this._moveZ += mz;
        const len = Math.hypot(this._moveX, this._moveZ) || 1;
        this._moveX /= len;
        this._moveZ /= len;
      }
    }
    if (this.stuckTime > 0.2) {
      // small perpendicular nudge to break free
      const nx = -this._moveZ * this.flankDir;
      const nz = this._moveX * this.flankDir;
      this._moveX = this._moveX * 0.4 + nx * 0.9;
      this._moveZ = this._moveZ * 0.4 + nz * 0.9;
      const len = Math.hypot(this._moveX, this._moveZ) || 1;
      this._moveX /= len;
      this._moveZ /= len;
    }

    const targetVX = this._moveX * desiredSpeed;
    const targetVZ = this._moveZ * desiredSpeed;
    this.vel.x = damp(this.vel.x, targetVX, 11, dt);
    this.vel.z = damp(this.vel.z, targetVZ, 11, dt);
    pos.x += this.vel.x * dt;
    pos.z += this.vel.z * dt;

    this._separateFromCrowd();
    mgr.resolveWorldCollision(this);

    const moved = dist2D(this.lastX, this.lastZ, pos.x, pos.z);
    const wanted = Math.hypot(this.vel.x, this.vel.z);
    this.speed2D = moved / Math.max(dt, 1e-4);
    if (wanted > 0.9 && moved < wanted * dt * 0.3) this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
    if (this.stuckTime > 0.6) {
      this.stuckTime = 0.21;
      this.path = null;
      this.nextPathAt = 0;
      this.strafeDir *= -1;
      this.strafeTimer = rand(0.7, 1.4);
    }
    this.lastX = pos.x;
    this.lastZ = pos.z;

    // body faces travel direction, or the player when fighting in place
    if (this.speed2D > 0.35) {
      const moveYaw = Math.atan2(-this.vel.x, -this.vel.z);
      this.bodyYaw = dampAngle(this.bodyYaw, moveYaw, 8, dt);
    } else if (this.los) {
      this.bodyYaw = dampAngle(this.bodyYaw, yawToPoint(pos.x, pos.z, p.x, p.z), 5, dt);
    }
    this.root.rotation.y = this.bodyYaw;
  }

  _separateFromCrowd() {
    const robots = this.mgr.robots;
    const pos = this.pos;
    for (let i = 0; i < robots.length; i++) {
      const other = robots[i];
      if (other === this || !other.alive) continue;
      if (other.state === 'spawn' || other.state === 'dying') continue;
      const dx = pos.x - other.pos.x;
      const dz = pos.z - other.pos.z;
      const min = this.radius + other.radius + 0.12;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.55;
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
      }
    }
    const p = this.mgr._player;
    if (p.alive) {
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      const min = this.radius + 0.45;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = min - d;
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
      }
    }
  }

  /* ---------------- aiming / animation ---------------- */

  _updateAim(dt) {
    const p = this.mgr._player;
    const pos = this.pos;
    if (!p.alive) {
      this.aimTargetTwist = 0;
      this.aimTargetPitch = -0.18;
      this.headTargetYaw = 0;
      this.headTargetPitch = -0.1;
      return;
    }
    const M = this.def.model;
    const chestY = pos.y + M.hipY + M.torsoPivotY + M.chestY;
    const targetYaw = yawToPoint(pos.x, pos.z, p.x, p.z);
    const dxz = Math.max(0.25, dist2D(pos.x, pos.z, p.x, p.z));
    const pitch = Math.atan2(p.ey - chestY, dxz);
    this.aimTargetTwist = clamp(angleDelta(this.bodyYaw, targetYaw), -1.15, 1.15);
    this.aimTargetPitch = clamp(pitch * 0.65, -0.36, 0.3);
    this.headTargetYaw = clamp(angleDelta(this.bodyYaw + this.torsoTwistActual, targetYaw), -0.5, 0.5);
    this.headTargetPitch = clamp(pitch * 0.5, -0.3, 0.35);
  }

  _updateAnimation(dt) {
    const parts = this.parts;
    const M = this.def.model;
    const mats = this.rig.mats;
    const moving = this.speed2D > 0.2;
    if (moving) this.walkPhase += dt * (this.speed2D / this.def.stride) * TAU;
    const speedRatio = clamp(this.speed2D / Math.max(0.1, this.def.speed * this.mods.speed), 0, 1.2);
    const amp = moving ? 0.22 + speedRatio * 0.34 : 0;
    const swing = Math.sin(this.walkPhase);
    const swingB = Math.sin(this.walkPhase + Math.PI);

    // legs
    parts.legL.rotation.x = swing * amp;
    parts.legR.rotation.x = swingB * amp;
    parts.legL.position.y = M.hipY + Math.max(0, swing) * 0.055 * amp;
    parts.legR.position.y = M.hipY + Math.max(0, swingB) * 0.055 * amp;
    parts.legL.rotation.z = 0.02;
    parts.legR.rotation.z = -0.02;

    // torso aim + lean / stagger
    this.staggerLean = damp(this.staggerLean, this.stagger > 0 ? 1 : 0, 12, dt);
    this.torsoTwistActual = dampAngle(this.torsoTwistActual, this.aimTargetTwist, 10, dt);
    this.torsoPitchActual = damp(this.torsoPitchActual, this.aimTargetPitch, 10, dt);
    const lean = speedRatio * 0.085 - this.staggerLean * 0.17 - this.recoil * 0.045;
    parts.torso.rotation.y = this.torsoTwistActual;
    parts.torso.rotation.x = this.torsoPitchActual + lean;
    parts.torso.rotation.z = swing * 0.02 * amp;

    // head tracks the target in addition to the torso
    parts.head.rotation.y = dampAngle(parts.head.rotation.y, this.headTargetYaw, 13, dt);
    parts.head.rotation.x = damp(parts.head.rotation.x, this.headTargetPitch, 10, dt) - this.recoil * 0.03;

    // body bob / sway
    const bob = moving ? Math.abs(swing) * 0.05 * amp : Math.sin(this.age * 1.9) * 0.01;
    parts.pelvis.position.y = M.hipY + bob;
    parts.pelvis.rotation.z = swing * 0.03 * amp;
    parts.pelvis.rotation.y = swing * 0.07 * amp;
    parts.pelvis.rotation.x = -this.staggerLean * 0.06;

    // arms: left counter-swings, right braces the weapon
    const hold = this.fireState === 'aim' || this.fireState === 'burst' ? 1 : 0;
    parts.armL.rotation.x = damp(parts.armL.rotation.x, 0.05 - swing * amp * 0.6 - hold * 0.12, 12, dt);
    parts.armL.rotation.z = 0.08 + Math.sin(this.walkPhase * 2) * 0.02 * amp + hold * 0.05;
    parts.armR.rotation.x = damp(parts.armR.rotation.x, this.aimTargetPitch * 0.3 + this.recoil * 0.16 - hold * 0.05, 14, dt);
    parts.armR.rotation.z = -0.03;

    // gun recoil / reload fidget
    const reloadAnim = this.reloadT > 0
      ? Math.sin(clamp(1 - this.reloadT / Math.max(0.01, this.def.fire.reload), 0, 1) * Math.PI) * 0.6
      : 0;
    parts.gunGroup.position.set(this.rig.baseGunX, this.rig.baseGunY, this.rig.baseGunZ + this.recoil * 0.11);
    parts.gunGroup.rotation.x = this.recoil * 0.18 + reloadAnim * 0.45;
    parts.gunGroup.rotation.z = reloadAnim * 0.28;

    // emissive pulse / hit feedback (one shared glow material per rig)
    let glow = 1.12;
    if (this.fireState === 'aim') {
      const pulse = 0.5 + 0.5 * Math.sin(this.age * 40);
      glow = 1.45 + pulse * 1.7;
    } else if (this.fireState === 'burst') {
      glow = 2.3;
    }
    if (this.damageFlash > 0.001) glow += this.damageFlash * 1.3;
    mats.glow.color.setScalar(glow);
    const f = this.damageFlash;
    if (f > 0.001) {
      mats.body.emissive.setRGB(0.8 * f, 0.32 * f, 0.1 * f);
      this.flashApplied = true;
    } else if (this.flashApplied) {
      mats.body.emissive.setRGB(0, 0, 0);
      this.flashApplied = false;
    }

    // footstep foley
    if (moving && this.speed2D > 0.8) {
      this.stepAccum += this.speed2D * dt;
      if (this.stepAccum > this.def.stride) {
        this.stepAccum = 0;
        const d = dist2D(this.pos.x, this.pos.z, this.mgr._player.x, this.mgr._player.z);
        this.mgr._audio('robotStep', d);
      }
    }
  }

  /* ---------------- weapon ---------------- */

  _showLaser(on) {
    this._laserWanted = on;
    if (this.laser && !on) this.laser.visible = false;
  }

  _updateLaser() {
    if (!this.laser) return;
    if (!this._laserWanted || this.fireState !== 'aim') {
      this.laser.visible = false;
      return;
    }
    const p = this.mgr._player;
    if (!p.alive) {
      this.laser.visible = false;
      return;
    }
    this.muzzle.getWorldPosition(this._muzzleWorld);
    const dx = p.ex - this._muzzleWorld.x;
    const dy = p.ey - this._muzzleWorld.y;
    const dz = p.ez - this._muzzleWorld.z;
    const len = Math.hypot(dx, dy, dz);
    // Stop the telegraph beam short of the camera. The sight's far end used to
    // terminate at the player eye, so its end cap could sit on the near plane.
    const VISIBLE_STOP = 1.25;
    const visibleLen = len - VISIBLE_STOP;
    if (len < 0.4 || visibleLen < 0.2) {
      this.laser.visible = false;
      return;
    }
    const inv = 1 / len;
    this._shotNormal.set(dx * inv, dy * inv, dz * inv);
    const centerDist = len * 0.5 - VISIBLE_STOP * 0.5;
    this.laser.position.set(
      this._muzzleWorld.x + this._shotNormal.x * centerDist,
      this._muzzleWorld.y + this._shotNormal.y * centerDist,
      this._muzzleWorld.z + this._shotNormal.z * centerDist,
    );
    _TMP.q1.setFromUnitVectors(UP, this._shotNormal);
    this.laser.quaternion.copy(_TMP.q1);
    this.laser.scale.set(0.016, visibleLen, 0.016);
    this.laser.visible = true;
  }

  _updateWeapon(dt) {
    const p = this.mgr._player;
    const fire = this.def.fire;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        this.ammo = fire.mag;
      }
      return;
    }
    if (this.cooldownT > 0) this.cooldownT -= dt;
    if (!p.alive) {
      if (this.fireState !== 'idle') this._endFire(true);
      return;
    }
    const dist = dist2D(this.pos.x, this.pos.z, p.x, p.z);

    if (this.fireState === 'idle') {
      this.telegraph = 0;
      if (
        this.los &&
        dist < this.def.ranges.max * 1.1 &&
        dist > 1.2 &&
        this.cooldownT <= 0 &&
        this.stagger <= 0 &&
        this.ammo > 0 &&
        this.mgr.tryAcquireToken(this)
      ) {
        this.fireState = 'aim';
        this.fireTimer = fire.telegraph * this.mods.telegraph * rand(0.9, 1.1);
        this.telegraph = 1;
        this._showLaser(true);
        this.mgr._onTelegraph(this);
      }
    } else if (this.fireState === 'aim') {
      this.fireTimer -= dt;
      this.telegraph = clamp(this.fireTimer / Math.max(0.01, fire.telegraph * this.mods.telegraph), 0, 1);
      if (!this.los || this.stagger > 0.4 || !p.alive) {
        this._endFire(true);
      } else if (this.fireTimer <= 0) {
        this.fireState = 'burst';
        this.shotsLeft = Math.min(fire.shots, this.ammo);
        this.shotTimer = 0;
        this.recoil = 0.2;
        // burst fires immediately from the next update
      }
    } else if (this.fireState === 'burst') {
      this.shotTimer -= dt;
      if (this.shotTimer <= 0) {
        this._fireShot();
        this.ammo--;
        this.shotsLeft--;
        this.shotTimer = fire.interval;
        if (this.shotsLeft <= 0 || this.ammo <= 0) this._endFire(false);
      }
    }
  }

  _endFire(cancelled) {
    const wasFiring = this.fireState === 'aim' || this.fireState === 'burst';
    this.fireState = 'idle';
    this.telegraph = 0;
    this.shotsLeft = 0;
    this._showLaser(false);
    this.mgr.releaseToken(this);
    if (wasFiring) {
      if (!cancelled) {
        this.cooldownT = this.def.fire.cooldown * this.mods.cooldown * rand(0.85, 1.2);
        if (this.ammo <= 0) this.reloadT = this.def.fire.reload * rand(0.95, 1.05);
      } else {
        this.cooldownT = Math.max(this.cooldownT, 0.45);
      }
    }
  }

  _fireShot() {
    const mgr = this.mgr;
    const p = mgr._player;
    if (!p.alive) return;
    const fire = this.def.fire;
    this.root.updateMatrixWorld(true);
    this.muzzle.getWorldPosition(this._muzzleWorld);
    const dist = Math.hypot(p.ex - this._muzzleWorld.x, p.ey - this._muzzleWorld.y, p.ez - this._muzzleWorld.z);
    let acc = fire.accuracy * this.mods.acc;
    const rangeFactor = clamp(1.18 - dist / (this.def.ranges.max * 1.45), 0.35, 1.0);
    const movePenalty = 1 - clamp(p.speed / 8, 0, 1) * 0.35;
    const selfMovePenalty = this.speed2D > 1.2 ? 0.9 : 1;
    acc = clamp(acc * rangeFactor * movePenalty * selfMovePenalty, 0.06, 0.92);
    const hit = Math.random() < acc;

    this._shotEnd.set(p.ex, p.ey, p.ez);
    if (!hit) {
      // visibly off-target tracer
      this._shotDir.set(p.ex - this._muzzleWorld.x, p.ey - this._muzzleWorld.y, p.ez - this._muzzleWorld.z).normalize();
      const ox = rand(-1, 1);
      const oy = rand(-0.7, 0.8);
      const oz = rand(-1, 1);
      const dot = ox * this._shotDir.x + oy * this._shotDir.y + oz * this._shotDir.z;
      this._shotNormal.set(ox - this._shotDir.x * dot, oy - this._shotDir.y * dot, oz - this._shotDir.z * dot);
      if (this._shotNormal.lengthSq() < 1e-4) this._shotNormal.set(0, 0.4, 0.4);
      this._shotNormal.normalize();
      const off = rand(0.5, 2.1);
      this._shotEnd.addScaledVector(this._shotNormal, off);
    } else {
      this._shotEnd.x += rand(-0.06, 0.06);
      this._shotEnd.y += rand(-0.06, 0.06);
    }
    this._shotDir.copy(this._shotEnd).sub(this._muzzleWorld);
    if (this._shotDir.lengthSq() < 1e-6) this._shotDir.set(0, 0, -1);
    this._shotDir.normalize();

    mgr._fx('tracer', this._muzzleWorld, this._shotEnd, {
      color: this.def.palette.tracer,
      width: this.def.key === 'warlord' ? 0.045 : 0.03,
      duration: 0.07,
    });
    mgr._fx('muzzleFlash', this._muzzleWorld, this._shotDir, {
      scale: this.def.key === 'heavy' || this.def.key === 'warlord' ? 1.5 : 1.0,
      color: this.def.palette.visor,
    });
    mgr._audio('enemyShot', dist, mgr.panFor(this._muzzleWorld.x, this._muzzleWorld.z));
    mgr.stats.shotsFired++;
    this.recoil = Math.min(1.25, this.recoil + 0.62);

    if (hit) {
      mgr._applyPlayerDamage(this, fire.damage * this.mods.dmg, this._muzzleWorld);
    }
  }

  /* ---------------- damage / death ---------------- */

  takeDamage(amount, opts = {}, hitObject) {
    if (!this.alive || this.state === 'spawn' || this.state === 'dying' || this.state === 'dead') return 0;
    const mgr = this.mgr;
    let zone = 'torso';
    if (hitObject && hitObject.userData && hitObject.userData.zone) zone = hitObject.userData.zone;
    else if (opts.headshot === true) zone = 'head';
    const headshot = zone === 'head';

    let dmg = Math.max(0.01, amount);
    if (headshot) dmg *= HEADSHOT_MULT;
    else if (zone === 'limb') dmg *= LIMB_MULT * this.def.resist;
    else dmg *= this.def.resist;
    dmg = Math.max(1, dmg);

    this.hp -= dmg;
    this.damageFlash = 1;
    const heavyHit = headshot || dmg > 20;
    const staggerAdd = (headshot ? 0.55 : heavyHit ? 0.34 : 0.16) * (1 - (this.def.staggerResist || 0));
    this.stagger = Math.max(this.stagger, staggerAdd);

    // hit from the flank / rear: relocate instead of standing still
    if (opts.direction && typeof opts.direction.x === 'number') {
      const fx = -Math.sin(this.bodyYaw);
      const fz = -Math.cos(this.bodyYaw);
      const dot = fx * opts.direction.x + fz * opts.direction.z;
      if (dot > 0.15) {
        this.flankDir = (fx * opts.direction.z - fz * opts.direction.x) >= 0 ? 1 : -1;
        this.strafeDir = this.flankDir;
        this.strafeTimer = rand(1.0, 1.7);
        this.reactT = 1.0;
        if (!this.los && this.everSeen) this._requestPath(this.lastKnownX, this.lastKnownZ, true);
      }
    }

    const point = opts.point;
    if (point && typeof point.x === 'number') {
      if (opts.direction && typeof opts.direction.x === 'number') {
        this._shotNormal.set(-opts.direction.x, -(opts.direction.y || 0), -opts.direction.z);
        if (this._shotNormal.lengthSq() < 1e-5) this._shotNormal.set(0, 0, 1);
        this._shotNormal.normalize();
      } else {
        this._shotNormal.set(0, 0, 1);
      }
      mgr._fx('impact', point, this._shotNormal, {
        surface: 'metal',
        scale: headshot ? 1.5 : 1.1,
        direction: opts.direction,
        // hitboxes move with the robot; a world-space decal would float mid-air
        decal: false,
      });
      mgr._fx('sparks', point, this._shotNormal, {
        count: headshot ? 16 : 8,
        color: this.def.palette.visor,
        speed: headshot ? 8 : 5,
      });
    }
    mgr._audio('enemyHit');
    mgr._audio('hitmarker', headshot);

    if (this.hp <= 0) {
      mgr._killRobot(this, headshot, dmg, opts.point, opts.direction);
    } else {
      emit('enemy:hitmarker', { headshot, kill: false, damage: Math.round(dmg) });
    }
    return dmg;
  }

  startDeath() {
    if (this.state === 'dying' || this.state === 'dead') return;
    this.state = 'dying';
    this.stateTime = 0;
    this.alive = false;
    this.dead = true;
    this._endFire(true);
    this._unregisterHitboxes();
    this.root.userData.robot = null;
    if (this.laser) this.laser.visible = false;
    this.deathT = 0;
    const key = this.def.key;
    this.deathDuration = key === 'warlord' ? 3.6 : key === 'heavy' ? 2.6 : key === 'rifleman' ? 2.1 : 1.9;
    this.deathFall = Math.random() < 0.74 ? 1 : -1;
    this.deathTwist = rand(-0.6, 0.6);
    this.deathSecondary = 0;
    this._deathFade = false;
    this.rig.mats.glow.color.setScalar(2.4);
  }

  _updateDeath(dt) {
    this.deathT += dt;
    const dur = this.deathDuration;
    const t = this.deathT;
    const k = clamp(t / dur, 0, 1);
    const parts = this.parts;
    const M = this.def.model;
    const mats = this.rig.mats;

    if (k > 0.2 && this.deathSecondary === 0) {
      this.deathSecondary = 1;
      this.mgr._deathBurst(this, 0.65);
    }
    if (k > 0.5 && this.deathSecondary === 1 && (this.def.key === 'heavy' || this.def.key === 'warlord')) {
      this.deathSecondary = 2;
      this.mgr._deathBurst(this, 0.45);
    }

    const fall = easeInCubic(clamp(t / (dur * 0.42), 0, 1));
    this.root.rotation.x = this.deathFall * fall * 1.45;
    this.root.rotation.z = Math.sin(t * 3.1) * 0.035 * (1 - fall) + this.deathTwist * fall * 0.35;
    this.root.position.y = -0.1 * fall;
    parts.legL.rotation.x = -0.35 - fall * 0.55;
    parts.legR.rotation.x = 0.28 + fall * 0.45;
    parts.armL.rotation.x = 0.35 + fall * 0.85;
    parts.armR.rotation.x = -0.15 - fall * 0.5;
    parts.head.rotation.x = fall * 0.45;
    parts.torso.rotation.y = Math.sin(t * 1.7) * 0.12 * (1 - k);
    parts.gunGroup.rotation.x = fall * 0.55;

    const flick = Math.random();
    mats.glow.color.setScalar(Math.max(0, (1 - k) * 2.4 * flick));

    if (k > 0.84) {
      if (!this._deathFade) {
        this._deathFade = true;
        this.mgr._fx('dustBurst', this.root.position, { count: 14, scale: 1.5 });
      }
      const shrink = 1 - smoothstep(0.84, 1, k);
      this.root.scale.setScalar(0.6 + 0.4 * shrink);
    }
    this.root.updateMatrixWorld(true);
    if (k >= 1) {
      this.state = 'dead';
      this.root.visible = false;
      this.mgr._onDeathAnimDone(this);
    }
  }

  /* ---------------- hitbox registry ---------------- */

  _registerHitboxes() {
    if (this.hitboxesRegistered) return;
    const targets = this.mgr.raycastTargets;
    for (let i = 0; i < this.hitboxes.length; i++) {
      const h = this.hitboxes[i];
      h.userData.robot = this;
      h.userData.type = this.type;
      targets.push(h);
    }
    this.hitboxesRegistered = true;
  }

  _unregisterHitboxes() {
    if (!this.hitboxesRegistered) return;
    const targets = this.mgr.raycastTargets;
    for (let i = 0; i < this.hitboxes.length; i++) {
      const h = this.hitboxes[i];
      h.userData.robot = null;
      const idx = targets.indexOf(h);
      if (idx >= 0) targets.splice(idx, 1);
    }
    this.hitboxesRegistered = false;
  }

  _updateSpawn(dt) {
    const dur = this.def.key === 'warlord' ? 1.2 : this.def.key === 'heavy' ? 0.9 : 0.7;
    this.spawnT = clamp(this.spawnT + dt / dur, 0, 1);
    const e = easeOutCubic(this.spawnT);
    const M = this.def.model;
    this.root.scale.setScalar(0.22 + 0.78 * e);
    this.root.position.y = -0.45 * (1 - e);
    this.parts.pelvis.position.y = M.hipY + (1 - e) * 0.08;
    this.parts.torso.rotation.z = Math.sin(this.spawnT * 42) * 0.05 * (1 - e);
    this.parts.head.rotation.y = Math.sin(this.spawnT * 29) * 0.14 * (1 - e);
    this.parts.armL.rotation.z = 0.06 + Math.sin(this.spawnT * 33) * 0.1 * (1 - e);
    const mats = this.rig.mats;
    mats.glow.color.setScalar(1.6 + (1 - e) * 3.2 + Math.sin(this.age * 50) * 0.3);
    const f = (1 - e) * 0.6;
    mats.body.emissive.setRGB(0.35 * f, 0.7 * f, 0.9 * f);
    if (this.spawnT >= 1) {
      this.root.position.y = 0;
      this.root.scale.setScalar(1);
      this.parts.torso.rotation.set(0, 0, 0);
      this.parts.head.rotation.set(0, 0, 0);
      this.parts.armL.rotation.set(0.05, 0, 0.06);
      this.parts.pelvis.position.y = M.hipY;
      mats.body.emissive.setRGB(0, 0, 0);
      this.flashApplied = false;
      this.state = 'advance';
      this.stateTime = 0;
      this._registerHitboxes();
      this.mgr._onSpawnComplete(this);
    }
    this.root.updateMatrixWorld(true);
  }
}

/* ================================================================== *
 *  4. Director / manager
 * ================================================================== */

class EnemyManager {
  constructor({ scene, world, effects, audio, getPlayer, quality = 'high' } = {}) {
    this.scene = scene || null;
    this.world = world || {};
    this.effects = effects || null;
    this.audio = audio || null;
    this.getPlayer = typeof getPlayer === 'function' ? getPlayer : () => null;
    this.quality = quality || 'high';

    this.state = { wave: 0, totalWaves: TOTAL_WAVES, alive: 0, remaining: 0, betweenWaves: false };
    this.raycastTargets = [];
    this.robots = [];
    this.time = 0;
    this.stats = {
      damageDealt: 0,
      playerDamageDealt: 0,
      shotsFired: 0,
      shotsHit: 0,
      robotsSpawned: 0,
      deaths: 0,
    };

    this._running = false;
    this._disposed = false;
    this._phase = 'idle';
    this._phaseTimer = 0;
    this._nextCountdownSecond = -1;
    this._startedAt = 0;
    this._spawnQueue = [];
    this._waveMods = waveMods(1);
    this._tokenLimit = 2;
    this._tokensUsed = 0;
    this._pathBudget = 0;

    this._score = 0;
    this._combo = 0;
    this._bestCombo = 0;
    this._comboTimer = 0;
    this._kills = 0;
    this._headshotKills = 0;

    this._player = {
      x: 0, y: 0, z: 0,
      ex: 0, ey: 1.68, ez: 0,
      alive: false, yaw: 0, speed: 0,
      health: 100, armor: 0, accuracy: 0, kills: 0,
    };
    this._playerPrevX = 0;
    this._playerPrevZ = 0;
    this._playerInit = false;

    this._geo = createUnitGeos();
    this._hitGeo = new THREE.BoxGeometry(1, 1, 1);
    this._hitMat = new THREE.MeshBasicMaterial({ color: 0xff3355 });
    this._upVec = new THREE.Vector3(0, 1, 0);
    this._fxVec = new THREE.Vector3();
    this._baseMats = createRobotBaseMaterials();
    this._laserMaterials = new Map();
    this._rigPools = new Map();

    this._navBuilt = false;
    this._navLight = null;
    this._navHeavy = null;
    this._navBoxRef = null;
    this._navBoxCount = -1;
    this._bounds = this._normalizeBounds(null);
    this._boxes = [];
    this._boxHash = null;
    this._boxHashCell = 3;
    this._boxStamp = 0;
    this._nearbyStamp = 0;
    this._nearby = [];
    this._losMeshes = [];
    this._losRay = new THREE.Raycaster();
    this._losHits = [];
    this._spawnPoints = [];
    this._spawnUse = new Map();
    this._spawnRef = null;
    this._spawnCount = -1;

    this._pickupPool = [];
    this._pickupGeos = null;
    this._pickupMats = null;

    this._radarAccum = 0;
    this._radarEnemies = [];
    this._radarPlayer = { x: 0, z: 0, yaw: 0 };
    this._radarBounds = { minX: -34, maxX: 34, minZ: -34, maxZ: 34 };

    this._lights = [];
    this._lightIndex = 0;
    this._initLights();

    // Warm one rig of each chassis so the boot-time renderer.compile() bakes the
    // robot shader variants while the loading screen is up (no wave-1 hitch).
    this._prewarmTypes();

    if (IS_DEV) this._installDevHook();
  }

  /* ---------------- public API ---------------- */

  start() {
    if (this._disposed) return;
    this.reset();
    this._ensureWorld();
    this._running = true;
    this._startedAt = 0;
    this._startCountdown(1, FIRST_DELAY);
    this._emitRadar();
  }

  reset() {
    this._running = false;
    while (this.robots.length) this._retireRobot(this.robots[this.robots.length - 1]);
    this.robots.length = 0;
    this.raycastTargets.length = 0;
    this._spawnQueue.length = 0;
    for (let i = 0; i < this._pickupPool.length; i++) {
      const item = this._pickupPool[i];
      item.active = false;
      item.life = 0;
      if (item.group) item.group.visible = false;
    }
    for (let i = 0; i < this._lights.length; i++) {
      const slot = this._lights[i];
      slot.duration = 0;
      slot.light.intensity = 0;
    }
    this.state.wave = 0;
    this.state.totalWaves = TOTAL_WAVES;
    this.state.alive = 0;
    this.state.remaining = 0;
    this.state.betweenWaves = false;
    this._phase = 'idle';
    this._phaseTimer = 0;
    this._nextCountdownSecond = -1;
    this._tokensUsed = 0;
    this._tokenLimit = 2;
    this._pathBudget = 0;
    this._spawnUse.clear();
    this.time = 0;
    this._score = 0;
    this._combo = 0;
    this._bestCombo = 0;
    this._comboTimer = 0;
    this._kills = 0;
    this._headshotKills = 0;
    this.stats.damageDealt = 0;
    this.stats.playerDamageDealt = 0;
    this.stats.shotsFired = 0;
    this.stats.shotsHit = 0;
    this.stats.robotsSpawned = 0;
    this.stats.deaths = 0;
    this._radarAccum = 0;
    this._radarEnemies.length = 0;
    this._playerInit = false;
    this._player.alive = false;
    for (let i = 0; i < this._lights.length; i++) this._lights[i].light.intensity = 0;
  }

  /** Only the HIGH/ULTRA tiers let robots feed the sun shadow map. */
  _castsShadow() {
    return this.quality === 'high' || this.quality === 'ultra';
  }

  /** Live quality switch from main.js: update active + pooled rig shadow flags. */
  setQuality(quality) {
    if (typeof quality !== 'string' || !quality) return;
    this.quality = quality;
    const cast = this._castsShadow();
    const apply = (root) => {
      if (!root) return;
      root.traverse((o) => { if (o.isMesh) o.castShadow = cast; });
    };
    for (let i = 0; i < this.robots.length; i++) apply(this.robots[i] && this.robots[i].root);
    for (const pool of this._rigPools.values()) {
      for (let i = 0; i < pool.length; i++) apply(pool[i] && pool[i].root);
    }
  }

  update(dt, elapsed) {
    if (this._disposed || !this._running) return;
    if (!(dt > 0)) return;
    if (dt > 0.06) dt = 0.06; // tab-return / hitch safety; pause-safe because main stops calling us
    this._ensureWorld();
    this._refreshPlayer(dt);
    this.time += dt;
    this._startedAt += dt;
    this._pathBudget = 3;

    this._updateDirector(dt);

    if (this._comboTimer > 0) {
      this._comboTimer -= dt;
      if (this._comboTimer <= 0 && this._combo > 0) {
        this._combo = 0;
        emit('score:change', { score: this._score, combo: 0, multiplier: 1 });
      }
    }

    const robots = this.robots;
    for (let i = robots.length - 1; i >= 0; i--) {
      const robot = robots[i];
      if (!robot || !robot.active) continue;
      if (robot.state === 'dead') {
        this._retireRobot(robot);
        continue;
      }
      robot.update(dt);
    }

    this._updatePickups(dt);
    this._updateLights(dt);
    this._updateRadar(dt);
    this._syncState();
  }

  /** Resolve the hit object to its owning robot and apply weapon damage. */
  damage(object, amount, opts = {}) {
    if (this._disposed) return 0;
    const robot = this._resolveRobot(object);
    if (!robot) return 0;
    return robot.takeDamage(amount, opts || {}, object);
  }

  /** QA helper: kill everything currently on the field and clear pending spawns. */
  debugKillAll() {
    if (this._disposed) return 0;
    let count = 0;
    const list = this.robots.slice();
    for (let i = 0; i < list.length; i++) {
      const robot = list[i];
      if (robot.alive) {
        this._killRobot(robot, false, robot.hp, null, null);
        count++;
      }
    }
    this._spawnQueue.length = 0;
    if (this._phase === 'spawning') this._phase = 'active';
    return count;
  }

  /** QA helper: jump straight to a wave (1..5) without the intermission. */
  debugJumpToWave(wave) {
    if (this._disposed) return;
    const n = clamp(Math.round(wave || 1), 1, TOTAL_WAVES);
    this.reset();
    this._ensureWorld();
    this._running = true;
    this._beginWave(n);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._running = false;
    this.reset();
    for (const pool of this._rigPools.values()) {
      for (let i = 0; i < pool.length; i++) this._disposeRig(pool[i]);
    }
    this._rigPools.clear();
    if (this._hitGeo) this._hitGeo.dispose();
    if (this._hitMat) this._hitMat.dispose();
    disposeUnitGeos(this._geo);
    if (this._baseMats) {
      if (this._baseMats.body) this._baseMats.body.dispose();
      if (this._baseMats.glow) this._baseMats.glow.dispose();
      this._baseMats = null;
    }
    for (const mat of this._laserMaterials.values()) mat.dispose();
    this._laserMaterials.clear();
    for (let i = 0; i < this._pickupPool.length; i++) {
      const item = this._pickupPool[i];
      if (this.scene && item.group) this.scene.remove(item.group);
    }
    this._pickupPool.length = 0;
    if (this._pickupGeos) {
      for (const key in this._pickupGeos) this._pickupGeos[key].dispose();
      this._pickupGeos = null;
    }
    if (this._pickupMats) {
      for (const key in this._pickupMats) this._pickupMats[key].dispose();
      this._pickupMats = null;
    }
    for (let i = 0; i < this._lights.length; i++) {
      const slot = this._lights[i];
      if (this.scene) this.scene.remove(slot.light);
      if (slot.light.dispose) slot.light.dispose();
    }
    this._lights.length = 0;
    this._losMeshes.length = 0;
    this._radarEnemies.length = 0;
    if (IS_DEV && typeof window !== 'undefined') {
      if (window.__devEnemies && window.__devEnemies.manager === this) delete window.__devEnemies;
    }
  }

  /* ---------------- dependencies / world ---------------- */

  _fx(method, ...args) {
    return callOptional(this.effects, method, ...args);
  }

  _audio(method, ...args) {
    return callOptional(this.audio, method, ...args);
  }

  _normalizeBounds(bounds) {
    const b = bounds || {};
    return {
      minX: typeof b.minX === 'number' ? b.minX : WORLD_BOUNDS.minX,
      maxX: typeof b.maxX === 'number' ? b.maxX : WORLD_BOUNDS.maxX,
      minZ: typeof b.minZ === 'number' ? b.minZ : WORLD_BOUNDS.minZ,
      maxZ: typeof b.maxZ === 'number' ? b.maxZ : WORLD_BOUNDS.maxZ,
    };
  }

  _ensureWorld() {
    const w = this.world || {};
    const boxes = Array.isArray(w.collisionBoxes) ? w.collisionBoxes : EMPTY_ARRAY;
    const spawns = Array.isArray(w.enemySpawns) ? w.enemySpawns : EMPTY_ARRAY;
    const navSame = this._navBuilt && this._navBoxRef === boxes && this._navBoxCount === boxes.length;
    if (!navSame) this._rebuildWorld(boxes);
    if (this._spawnRef !== spawns || this._spawnCount !== spawns.length) {
      this._spawnRef = spawns;
      this._spawnCount = spawns.length;
      this._buildSpawnPoints(spawns);
    }
  }

  _rebuildWorld(boxes) {
    const w = this.world || {};
    this._bounds = this._normalizeBounds(w.mapBounds);
    const b = this._bounds;
    this._radarBounds.minX = b.minX;
    this._radarBounds.maxX = b.maxX;
    this._radarBounds.minZ = b.minZ;
    this._radarBounds.maxZ = b.maxZ;

    this._boxes = boxes;
    this._navLight = new NavGrid(b, 1, boxes, 0.58);
    this._navHeavy = new NavGrid(b, 1, boxes, 0.72);
    this._navBoxRef = boxes;
    this._navBoxCount = boxes.length;
    this._navBuilt = true;

    // Spatial hash for robot-vs-wall collision resolution.
    const cell = this._boxHashCell;
    const hash = new Map();
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (!box) continue;
      const x0 = Math.floor(box.minX / cell);
      const x1 = Math.floor(box.maxX / cell);
      const z0 = Math.floor(box.minZ / cell);
      const z1 = Math.floor(box.maxZ / cell);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = cx + ',' + cz;
          let arr = hash.get(key);
          if (!arr) {
            arr = [];
            hash.set(key, arr);
          }
          arr.push(box);
        }
      }
    }
    this._boxHash = hash;

    // Flatten collideMeshes (objects or groups) for line-of-sight raycasts.
    this._losMeshes.length = 0;
    const meshes = Array.isArray(w.collideMeshes) ? w.collideMeshes : [];
    for (let i = 0; i < meshes.length; i++) {
      const obj = meshes[i];
      if (!obj) continue;
      if (obj.isMesh) {
        this._losMeshes.push(obj);
      } else if (typeof obj.traverse === 'function') {
        obj.traverse((child) => {
          if (child && child.isMesh) this._losMeshes.push(child);
        });
      }
    }

    this._buildSpawnPoints(w.enemySpawns);
  }

  _buildSpawnPoints(enemySpawns) {
    const points = [];
    const seen = new Set();
    const list = Array.isArray(enemySpawns) ? enemySpawns : [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s || typeof s.x !== 'number' || typeof s.z !== 'number') continue;
      const key = Math.round(s.x * 2) + ':' + Math.round(s.z * 2);
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ x: s.x, z: s.z });
    }
    if (points.length < 4) {
      const b = this._bounds;
      const cx = (b.minX + b.maxX) * 0.5;
      const cz = (b.minZ + b.maxZ) * 0.5;
      const radius = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.36;
      const nav = this._navLight || this._navHeavy;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * TAU;
        const x = cx + Math.sin(ang) * radius;
        const z = cz + Math.cos(ang) * radius;
        if (nav) {
          const idx = nav.nearestFree(nav.cellX(x), nav.cellZ(z), 6);
          if (idx >= 0) points.push({ x: nav.centerX(idx % nav.gw), z: nav.centerZ((idx / nav.gw) | 0) });
        } else {
          points.push({ x, z });
        }
      }
    }
    this._spawnPoints = points;
  }

  navFor(radius) {
    if (radius > 0.68 && this._navHeavy) return this._navHeavy;
    return this._navLight || this._navHeavy;
  }

  consumePathBudget() {
    if (this._pathBudget <= 0) return false;
    this._pathBudget--;
    return true;
  }

  /* ---------------- player tracking ---------------- */

  _refreshPlayer(dt) {
    let raw = null;
    try {
      raw = this.getPlayer ? this.getPlayer() : null;
    } catch (_) {
      raw = null;
    }
    const player = this._player;
    const prevX = player.x;
    const prevZ = player.z;
    let hasPos = false;
    if (raw) {
      const pos = raw.position;
      if (pos && typeof pos.x === 'number') {
        player.x = pos.x;
        player.y = typeof pos.y === 'number' ? pos.y : 0;
        player.z = pos.z;
        hasPos = true;
      } else if (typeof raw.x === 'number') {
        player.x = raw.x;
        player.y = typeof raw.y === 'number' ? raw.y : 0;
        player.z = typeof raw.z === 'number' ? raw.z : 0;
        hasPos = true;
      }
      if (hasPos) {
        const eye = raw.eye;
        if (eye && typeof eye.x === 'number') {
          player.ex = eye.x;
          player.ey = eye.y;
          player.ez = eye.z;
        } else {
          player.ex = player.x;
          player.ey = player.y + 1.68;
          player.ez = player.z;
        }
        player.alive = raw.alive !== false;
        player.yaw = this._readYaw(raw);
        if (typeof raw.health === 'number') player.health = raw.health;
        if (typeof raw.armor === 'number') player.armor = raw.armor;
        if (typeof raw.accuracy === 'number') player.accuracy = raw.accuracy;
        if (typeof raw.kills === 'number') player.kills = raw.kills;
      }
    }
    if (!hasPos) {
      player.alive = false;
    }
    if (this._playerInit && dt > 0) {
      const inst = dist2D(prevX, prevZ, player.x, player.z) / dt;
      player.speed = damp(player.speed, Math.min(inst, 14), 14, dt);
    } else {
      player.speed = 0;
      this._playerInit = true;
    }
    this._playerPrevX = player.x;
    this._playerPrevZ = player.z;
  }

  _readYaw(raw) {
    if (typeof raw.yaw === 'number') return raw.yaw;
    if (typeof raw.viewYaw === 'number') return raw.viewYaw;
    if (typeof raw.facing === 'number') return raw.facing;
    if (raw.rotation && typeof raw.rotation.y === 'number') return raw.rotation.y;
    if (raw.camera && raw.camera.rotation && typeof raw.camera.rotation.y === 'number') return raw.camera.rotation.y;
    if (raw.forward && typeof raw.forward.x === 'number') return Math.atan2(-raw.forward.x, -raw.forward.z);
    if (raw.lookDir && typeof raw.lookDir.x === 'number') return Math.atan2(-raw.lookDir.x, -raw.lookDir.z);
    return this._player.yaw;
  }

  panFor(x, z) {
    const p = this._player;
    const dx = x - p.x;
    const dz = z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const yaw = p.yaw;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    return clamp(((dx * rx + dz * rz) / len) * 0.85, -1, 1);
  }

  /* ---------------- line of sight ---------------- */

  checkLOS(robot) {
    const p = this._player;
    if (!p.alive) return false;
    if (!this._losMeshes.length) return true;
    robot.getEyeWorld(_TMP.v4);
    const dx = p.ex - _TMP.v4.x;
    const dy = p.ey - _TMP.v4.y;
    const dz = p.ez - _TMP.v4.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.25) return true;
    _TMP.v5.set(dx / dist, dy / dist, dz / dist);
    this._losRay.set(_TMP.v4, _TMP.v5);
    this._losRay.near = 0.02;
    this._losRay.far = Math.max(0.1, dist - 0.35);
    this._losHits.length = 0;
    try {
      this._losRay.intersectObjects(this._losMeshes, false, this._losHits);
    } catch (_) {
      return true;
    }
    return this._losHits.length === 0;
  }

  /* ---------------- collision ---------------- */

  _nearbyBoxes(x, z) {
    const out = this._nearby;
    out.length = 0;
    const hash = this._boxHash;
    if (!hash) return out;
    const cell = this._boxHashCell;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = hash.get((cx + dx) + ',' + (cz + dz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const box = arr[i];
          if (out.indexOf(box) === -1) out.push(box);
        }
      }
    }
    return out;
  }

  resolveWorldCollision(robot) {
    const pos = robot.pos;
    const r = robot.radius;
    const boxes = this._nearbyBoxes(pos.x, pos.z);
    const heightGate = robot.height * 0.55;
    for (let iter = 0; iter < 2; iter++) {
      let pushed = false;
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        const minY = typeof box.minY === 'number' ? box.minY : 0;
        const maxY = typeof box.maxY === 'number' ? box.maxY : 4;
        if (maxY <= 0.12) continue; // floor-level decoration
        if (minY >= heightGate) continue; // overhead only
        const closestX = clamp(pos.x, box.minX, box.maxX);
        const closestZ = clamp(pos.z, box.minZ, box.maxZ);
        const dx = pos.x - closestX;
        const dz = pos.z - closestZ;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            const push = r - d;
            pos.x += (dx / d) * push;
            pos.z += (dz / d) * push;
          } else {
            const dl = pos.x - box.minX;
            const dr = box.maxX - pos.x;
            const db = pos.z - box.minZ;
            const df = box.maxZ - pos.z;
            const m = Math.min(dl, dr, db, df);
            if (m === dl) pos.x = box.minX - r;
            else if (m === dr) pos.x = box.maxX + r;
            else if (m === db) pos.z = box.minZ - r;
            else pos.z = box.maxZ + r;
          }
          pushed = true;
        }
      }
      if (!pushed) break;
    }
    const b = this._bounds;
    pos.x = clamp(pos.x, b.minX + r + 0.15, b.maxX - r - 0.15);
    pos.z = clamp(pos.z, b.minZ + r + 0.15, b.maxZ - r - 0.15);
  }

  /* ---------------- tokens / player damage ---------------- */

  tryAcquireToken(robot) {
    if (robot.def.boss) {
      robot.hasToken = true;
      return true;
    }
    if (this._tokensUsed >= this._tokenLimit) return false;
    this._tokensUsed++;
    robot.hasToken = true;
    return true;
  }

  releaseToken(robot) {
    if (!robot.hasToken) return;
    robot.hasToken = false;
    if (!robot.def.boss) this._tokensUsed = Math.max(0, this._tokensUsed - 1);
  }

  _applyPlayerDamage(robot, amount, fromPos) {
    const p = this._player;
    if (!p.alive) return;
    const amt = Math.max(1, Math.round(amount));
    emit('combat:player-hit', {
      amount: amt,
      source: 'robot',
      enemy: robot.type,
      from: { x: fromPos.x, y: fromPos.y, z: fromPos.z },
    });
    this.stats.playerDamageDealt += amt;
    this.stats.shotsHit++;
  }

  /* ---------------- spawning / director ---------------- */

  _startCountdown(nextWave, seconds) {
    this._phase = 'countdown';
    this._phaseTimer = Math.max(0.05, seconds);
    this._nextCountdownSecond = Math.ceil(this._phaseTimer);
    this.state.betweenWaves = true;
    this.state.alive = this._aliveCount();
    this.state.remaining = 0;
    emit('wave:countdown', { seconds: this._nextCountdownSecond, nextWave });
  }

  _beginWave(wave) {
    const n = clamp(wave, 1, TOTAL_WAVES);
    const stage = WAVE_STAGES[n - 1];
    if (!stage) return;
    this._waveMods = waveMods(n);
    this._tokenLimit = this._waveMods.tokens;
    this._tokensUsed = 0;
    this._spawnUse.clear();
    const order = buildSpawnOrder(stage);
    this._spawnQueue.length = 0;
    let at = 0.05;
    for (let i = 0; i < order.length; i++) {
      const key = order[i];
      if (i > 0) {
        at += key === 'warlord' ? 1.0 : key === 'heavy' ? 0.55 : rand(0.22, 0.48);
      }
      this._spawnQueue.push({ type: key, at: this.time + at });
    }
    this.state.wave = n;
    this.state.betweenWaves = false;
    this.state.remaining = order.length;
    this._phase = 'spawning';
    emit('wave:start', { wave: n, totalWaves: TOTAL_WAVES, count: order.length, label: stage.label });
    this._audio('waveStart', n);
    if (stage.comp.warlord) {
      emit('fx:shake', { intensity: 0.45, duration: 0.55 });
      emit('weapon:notice', { text: 'WARLORD DEPLOYED // 监军已部署', type: 'warn' });
    }
  }

  _updateDirector(dt) {
    if (this._phase === 'countdown') {
      this._phaseTimer -= dt;
      const sec = Math.max(0, Math.ceil(this._phaseTimer));
      if (sec !== this._nextCountdownSecond) {
        this._nextCountdownSecond = sec;
        emit('wave:countdown', { seconds: sec, nextWave: this.state.wave + 1 });
      }
      if (this._phaseTimer <= 0) this._beginWave(this.state.wave + 1);
    } else if (this._phase === 'spawning' || this._phase === 'active') {
      this._processSpawnQueue();
      if (this._phase === 'spawning' && this._spawnQueue.length === 0) this._phase = 'active';
      if (this._phase === 'active' && this._aliveCount() === 0) this._clearWave();
    } else if (this._phase === 'victory-delay') {
      this._phaseTimer -= dt;
      if (this._phaseTimer <= 0) {
        this._phase = 'done';
        this.state.alive = 0;
        this.state.remaining = 0;
        emit('combat:all-waves-cleared', { wave: TOTAL_WAVES });
      }
    }
  }

  _processSpawnQueue() {
    const queue = this._spawnQueue;
    let guard = 0;
    while (queue.length && queue[0].at <= this.time && guard++ < 8) {
      const item = queue.shift();
      this._spawnRobot(item.type);
    }
  }

  _spawnRobot(type) {
    const def = ROBOT_TYPES[type];
    if (!def) return;
    const point = this._selectSpawnPoint(def);
    if (!point) {
      this._spawnQueue.unshift({ type, at: this.time + 0.5 });
      if (this._spawnQueue.length > 32) this._spawnQueue.length = 0;
      return;
    }
    const rig = this._acquireRig(type);
    const robot = new Robot(this, type, rig);
    robot.spawn(point.x, point.z, this.state.wave, this._waveMods);
    this.robots.push(robot);
    this.stats.robotsSpawned++;
  }

  _selectSpawnPoint(def) {
    const points = this._spawnPoints;
    const p = this._player;
    const nav = this._navLight || this.navFor(def.radius);
    if (!points.length) {
      if (!nav) return null;
      for (let i = 0; i < 24; i++) {
        const cx = randInt(0, nav.gw - 1);
        const cz = randInt(0, nav.gh - 1);
        if (!nav.isFree(cx, cz)) continue;
        const x = nav.centerX(cx);
        const z = nav.centerZ(cz);
        if (p.alive && dist2D(x, z, p.x, p.z) < 11) continue;
        return { x, z, idx: -1 };
      }
      return null;
    }
    let best = null;
    let bestScore = -Infinity;
    const attempts = Math.min(points.length, 12);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const idx = randInt(0, points.length - 1);
      const sp = points[idx];
      if (nav && !nav.freeAt(sp.x, sp.z)) continue;
      const dp = dist2D(sp.x, sp.z, p.x, p.z);
      if (p.alive && dp < 11) continue;
      let minRobot = 60;
      for (let r = 0; r < this.robots.length; r++) {
        const other = this.robots[r];
        if (!other.alive) continue;
        const d = dist2D(sp.x, sp.z, other.pos.x, other.pos.z);
        if (d < minRobot) minRobot = d;
      }
      const used = this._spawnUse.get(idx) || 0;
      // Prefer spawns that are a comfortable approach distance away: fast chassis
      // come from farther out, slow heavies appear closer so every wave makes
      // contact within a few seconds of the spawn materialisation.
      const desired = clamp(13 + (def.speed || 3) * 1.8, 16, 26);
      const score = -Math.abs(dp - desired) * 1.5 + Math.min(minRobot, 10) * 3.2 - used * 8 + rand(0, 5);
      if (score > bestScore) {
        bestScore = score;
        best = { x: sp.x, z: sp.z, idx };
      }
    }
    if (!best) {
      for (let i = 0; i < points.length; i++) {
        const sp = points[i];
        if (nav && !nav.freeAt(sp.x, sp.z)) continue;
        best = { x: sp.x, z: sp.z, idx: i };
        break;
      }
    }
    if (best && best.idx >= 0) {
      this._spawnUse.set(best.idx, (this._spawnUse.get(best.idx) || 0) + 1);
    }
    return best;
  }

  _aliveCount() {
    let n = 0;
    for (let i = 0; i < this.robots.length; i++) if (this.robots[i].alive) n++;
    return n;
  }

  _clearWave() {
    const n = this.state.wave;
    this._phase = 'clearing';
    this.state.betweenWaves = true;
    const bonus = 150 * n + (n === TOTAL_WAVES ? 1000 : 0);
    this._score += bonus;
    emit('wave:clear', { wave: n, totalWaves: TOTAL_WAVES, nextIn: n < TOTAL_WAVES ? BETWEEN_TIME : 0, bonus });
    emit('score:change', { score: this._score, combo: this._combo, multiplier: 1 });
    this._audio('waveClear');
    if (n >= TOTAL_WAVES) {
      this._phase = 'victory-delay';
      this._phaseTimer = 2.2;
      this._tokensUsed = 0;
      this.state.alive = 0;
      this.state.remaining = 0;
      return;
    }
    this._startCountdown(n + 1, BETWEEN_TIME);
  }

  /* ---------------- kill / death ---------------- */

  _killRobot(robot, headshot, damage, point, direction) {
    if (!robot || robot.state === 'dying' || robot.state === 'dead') return;
    robot.startDeath();
    this._kills++;
    if (headshot) this._headshotKills++;
    this._combo++;
    this._comboTimer = 4.2;
    if (this._combo > this._bestCombo) this._bestCombo = this._combo;
    const mult = 1 + Math.min(this._combo, 20) * 0.05;
    const points = Math.round(robot.def.score * mult * (headshot ? 1.5 : 1));
    this._score += points;
    const pos = robot.pos;
    const centerY = pos.y + robot.height * 0.55;
    emit('enemy:killed', {
      name: robot.def.displayName,
      headshot: !!headshot,
      points,
      combo: this._combo,
      wave: this.state.wave,
      position: { x: pos.x, y: centerY, z: pos.z },
    });
    emit('enemy:hitmarker', { headshot: !!headshot, kill: true, damage: Math.round(damage || robot.maxHp) });
    emit('score:change', { score: this._score, combo: this._combo, multiplier: +mult.toFixed(2) });
    this.stats.deaths++;
    this._audio('kill');
    const scale = robot.def.key === 'warlord' ? 3.0 : robot.def.key === 'heavy' ? 1.7 : 1.05;
    this._fx('explosion', new THREE.Vector3(pos.x, centerY, pos.z), { scale, color: robot.def.palette.tracer });
    this._fx('dustBurst', new THREE.Vector3(pos.x, 0.25, pos.z), { count: 12, scale: 1.1 });
    this._audio('explosion', scale);
    this._flashLight(pos.x, robot.height * 0.5, pos.z, robot.def.palette.tracer,
      robot.def.key === 'warlord' ? 55 : 26, 0.35);
    if (robot.def.key === 'heavy' || robot.def.key === 'warlord') {
      emit('fx:shake', {
        intensity: robot.def.key === 'warlord' ? 0.6 : 0.22,
        duration: robot.def.key === 'warlord' ? 0.55 : 0.25,
      });
    }
    if (robot.def.boss) {
      emit('fx:hitflash', { strength: 0.45, color: 0xffc27a });
      emit('weapon:notice', { text: 'WARLORD ELIMINATED // 监军击破', type: 'info' });
    }
    this._dropPickupsFor(robot);
  }

  _deathBurst(robot, scale) {
    const pos = new THREE.Vector3(
      robot.pos.x + rand(-0.55, 0.55),
      Math.max(0.3, robot.pos.y + rand(0.4, robot.height * 0.75)),
      robot.pos.z + rand(-0.55, 0.55),
    );
    this._fx('explosion', pos, { scale, color: robot.def.palette.tracer });
    this._fx('sparks', pos, this._upVec, { count: 8, color: robot.def.palette.visor, speed: 6 });
    this._audio('explosion', Math.max(0.25, scale * 0.6));
    this._flashLight(pos.x, pos.y, pos.z, robot.def.palette.tracer, 16, 0.2);
  }

  _onRobotSpawn(robot) {
    const def = robot.def;
    const pos = new THREE.Vector3(robot.pos.x, 0.05, robot.pos.z);
    this._fx('teleport', pos, {
      color: def.palette.visor,
      scale: def.key === 'warlord' ? 2.4 : def.key === 'heavy' ? 1.6 : 1.1,
    });
    this._audio('teleport');
    this._flashLight(robot.pos.x, 1.4, robot.pos.z, def.palette.visor, def.key === 'warlord' ? 48 : 26, def.boss ? 0.8 : 0.45);
  }

  _onSpawnComplete(robot) {
    this._fx('dustBurst', new THREE.Vector3(robot.pos.x, 0.2, robot.pos.z), {
      count: 10,
      scale: Math.max(0.9, robot.radius * 1.8),
    });
    this._audio('robotStep', dist2D(robot.pos.x, robot.pos.z, this._player.x, this._player.z));
    if (robot.def.boss) emit('fx:shake', { intensity: 0.5, duration: 0.6 });
  }

  _onTelegraph(robot) {
    // Hook kept for audio polish; visor pulse + laser already telegraph the shot.
    this._lastTelegraph = robot ? robot.type : null;
  }

  _onDeathAnimDone(robot) {
    this._retireRobot(robot);
  }

  _retireRobot(robot) {
    if (!robot || !robot.active) return;
    robot._unregisterHitboxes();
    robot.alive = false;
    robot.active = false;
    for (let i = 0; i < robot.hitboxes.length; i++) robot.hitboxes[i].userData.robot = null;
    if (robot.laser) robot.laser.visible = false;
    if (robot.root) {
      robot.root.visible = false;
      robot.root.userData.robot = null;
      robot.root.position.set(0, -60, 0);
    }
    const pool = this._rigPools.get(robot.type);
    if (pool) pool.push(robot.rig);
    else this._rigPools.set(robot.type, [robot.rig]);
    const idx = this.robots.indexOf(robot);
    if (idx >= 0) this.robots.splice(idx, 1);
  }

  /* ---------------- rig pool ---------------- */

  _acquireRig(type) {
    let pool = this._rigPools.get(type);
    if (!pool) {
      pool = [];
      this._rigPools.set(type, pool);
    }
    if (pool.length) {
      const rig = pool.pop();
      rig.root.position.set(0, -60, 0);
      rig.root.visible = false;
      if (rig.laser) rig.laser.visible = false;
      return rig;
    }
    return this._buildRig(type);
  }

  /** Build one rig per chassis during construction (boot-time shader prewarm). */
  _prewarmTypes() {
    for (let i = 0; i < TYPE_KEYS.length; i++) {
      const key = TYPE_KEYS[i];
      let pool = this._rigPools.get(key);
      if (!pool) {
        pool = [];
        this._rigPools.set(key, pool);
      }
      if (!pool.length) pool.push(this._buildRig(key));
    }
  }

  _buildRig(type) {
    const def = ROBOT_TYPES[type];
    const rigMats = createRigMaterialSet(this._baseMats);
    const rig = buildRobotRig(def, rigMats, this._geo, this._hitGeo, this._hitMat);
    if (!this._castsShadow()) {
      rig.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    }
    rig.root.visible = false;
    rig.root.position.set(0, -60, 0);
    if (this.scene) {
      this.scene.add(rig.root);
    }
    const laserMat = this._getLaserMaterial(type);
    const laser = new THREE.Mesh(this._geo.cyl6Open, laserMat);
    laser.visible = false;
    laser.renderOrder = 4;
    laser.frustumCulled = false;
    laser.scale.set(0.016, 1, 0.016);
    rig.laser = laser;
    if (this.scene) this.scene.add(laser);
    return rig;
  }

  _getLaserMaterial(type) {
    let mat = this._laserMaterials.get(type);
    if (!mat) {
      const def = ROBOT_TYPES[type];
      mat = new THREE.MeshBasicMaterial({
        color: def.palette.visor,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      this._laserMaterials.set(type, mat);
    }
    return mat;
  }

  _disposeRig(rig) {
    if (!rig) return;
    if (rig.mergedGeos) {
      for (let i = 0; i < rig.mergedGeos.length; i++) rig.mergedGeos[i].dispose();
    }
    const clones = rig.mats && rig.mats.cloned ? rig.mats.cloned : [];
    for (let i = 0; i < clones.length; i++) clones[i].dispose();
    if (this.scene) {
      if (rig.root) this.scene.remove(rig.root);
      if (rig.laser) this.scene.remove(rig.laser);
    }
  }

  /* ---------------- damage plumbing ---------------- */

  _resolveRobot(object) {
    let o = object;
    for (let i = 0; o && i < 20; i++) {
      const ud = o.userData;
      if (ud) {
        if (ud.robot) return ud.robot;
        if (ud.robotRef && ud.robotRef !== o && ud.robotRef.userData) {
          const ref = ud.robotRef.userData.robot;
          if (ref) return ref;
        }
      }
      o = o.parent;
    }
    return null;
  }

  /* ---------------- pickups ---------------- */

  _initPickups() {
    this._pickupGeos = {
      ammoBody: new THREE.BoxGeometry(0.42, 0.32, 0.32),
      ammoLid: new THREE.BoxGeometry(0.34, 0.07, 0.26),
      ammoStripe: new THREE.BoxGeometry(0.44, 0.05, 0.34),
      healthBody: new THREE.CylinderGeometry(0.16, 0.2, 0.38, 10),
      healthRing: new THREE.TorusGeometry(0.21, 0.028, 6, 14),
      // magazine upgrade: a tall curved mag + band
      magBody: new THREE.BoxGeometry(0.2, 0.46, 0.16),
      magBand: new THREE.BoxGeometry(0.24, 0.06, 0.2),
      magTip: new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8),
      // damage upgrade: a glowing core in a caged frame
      powerCore: new THREE.OctahedronGeometry(0.15, 0),
      powerCage: new THREE.IcosahedronGeometry(0.24, 0),
      powerRing: new THREE.TorusGeometry(0.26, 0.02, 6, 18),
      // reload-speed upgrade: stopwatch bezel + bolt
      reloadDisc: new THREE.CylinderGeometry(0.17, 0.17, 0.06, 16),
      reloadRing: new THREE.TorusGeometry(0.2, 0.028, 8, 22),
      reloadBolt: new THREE.BoxGeometry(0.05, 0.2, 0.05),
      // rare relic: tall golden prism inside two rings
      relicCore: new THREE.OctahedronGeometry(0.22, 0),
      relicRingA: new THREE.TorusGeometry(0.3, 0.022, 8, 24),
      relicRingB: new THREE.TorusGeometry(0.24, 0.016, 8, 20),
      relicBeam: new THREE.CylinderGeometry(0.05, 0.16, 1.6, 10, 1, true),
      // damage-reduction guard: hexagonal shield plate + glowing core + halo
      guardPlate: new THREE.CylinderGeometry(0.27, 0.31, 0.06, 6),
      guardCore: new THREE.IcosahedronGeometry(0.11, 0),
      guardRing: new THREE.TorusGeometry(0.33, 0.02, 6, 20),
      // max-health vital core: green orb inside a cross frame
      vitalOrb: new THREE.SphereGeometry(0.15, 12, 10),
      vitalCrossA: new THREE.BoxGeometry(0.07, 0.34, 0.07),
      vitalCrossB: new THREE.BoxGeometry(0.34, 0.07, 0.07),
      vitalRing: new THREE.TorusGeometry(0.28, 0.02, 6, 20),
    };
    this._pickupMats = {
      body: new THREE.MeshStandardMaterial({ color: 0x2c2b27, metalness: 0.72, roughness: 0.48 }),
      magMetal: new THREE.MeshStandardMaterial({ color: 0x384049, metalness: 0.85, roughness: 0.32 }),
      ammo: new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false }),
      health: new THREE.MeshBasicMaterial({ color: 0x59f0c8, toneMapped: false }),
      mag: new THREE.MeshBasicMaterial({ color: 0x7cc8ff, toneMapped: false }),
      power: new THREE.MeshBasicMaterial({ color: 0xff5a3c, toneMapped: false }),
      reload: new THREE.MeshBasicMaterial({ color: 0xc084ff, toneMapped: false }),
      relic: new THREE.MeshBasicMaterial({ color: 0xffe27a, toneMapped: false }),
      relicBeam: new THREE.MeshBasicMaterial({
        color: 0xffd062, transparent: true, opacity: 0.28, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
      guard: new THREE.MeshBasicMaterial({ color: 0x66e2ff, toneMapped: false }),
      guardPlate: new THREE.MeshStandardMaterial({ color: 0x27343c, metalness: 0.9, roughness: 0.28 }),
      vital: new THREE.MeshBasicMaterial({ color: 0xa6ff5e, toneMapped: false }),
      vitalFrame: new THREE.MeshStandardMaterial({ color: 0x2d3a24, metalness: 0.78, roughness: 0.36 }),
      powerCage: new THREE.MeshStandardMaterial({
        color: 0x40464e, metalness: 0.8, roughness: 0.35, transparent: true, opacity: 0.55,
      }),
    };
  }

  _createPickupItem() {
    const geos = this._pickupGeos;
    const mats = this._pickupMats;
    const group = new THREE.Group();
    const ammoBody = new THREE.Mesh(geos.ammoBody, mats.body);
    const ammoLid = new THREE.Mesh(geos.ammoLid, mats.body);
    ammoLid.position.y = 0.18;
    const ammoStripe = new THREE.Mesh(geos.ammoStripe, mats.ammo);
    ammoStripe.position.y = -0.06;
    group.add(ammoBody, ammoLid, ammoStripe);
    const healthBody = new THREE.Mesh(geos.healthBody, mats.body);
    const healthRing = new THREE.Mesh(geos.healthRing, mats.health);
    healthRing.rotation.x = Math.PI / 2;
    healthRing.position.y = 0.12;
    group.add(healthBody, healthRing);
    // --- magazine capacity loot: stacked extended mags ---
    const magParts = [];
    const magBody = new THREE.Mesh(geos.magBody, mats.magMetal);
    magBody.rotation.z = 0.12;
    group.add(magBody);
    magParts.push(magBody);
    for (let i = 0; i < 2; i++) {
      const band = new THREE.Mesh(geos.magBand, mats.mag);
      band.position.set(0, -0.1 + i * 0.24, 0);
      band.rotation.z = 0.12;
      group.add(band);
      magParts.push(band);
    }
    const magTip = new THREE.Mesh(geos.magTip, mats.mag);
    magTip.position.set(0.02, 0.26, 0);
    magTip.rotation.z = 0.12;
    group.add(magTip);
    magParts.push(magTip);
    // --- damage loot: glowing core inside a wireframe cage ---
    const powerParts = [];
    const powerCore = new THREE.Mesh(geos.powerCore, mats.power);
    group.add(powerCore);
    powerParts.push(powerCore);
    const powerCage = new THREE.Mesh(geos.powerCage, mats.powerCage);
    powerCage.scale.setScalar(1.1);
    group.add(powerCage);
    powerParts.push(powerCage);
    const powerRing = new THREE.Mesh(geos.powerRing, mats.power);
    powerRing.rotation.x = Math.PI / 2.4;
    group.add(powerRing);
    powerParts.push(powerRing);
    // --- reload speed loot: stopwatch dial with a bolt hand ---
    const reloadParts = [];
    const reloadDisc = new THREE.Mesh(geos.reloadDisc, mats.magMetal);
    reloadDisc.rotation.x = Math.PI / 2.2;
    group.add(reloadDisc);
    reloadParts.push(reloadDisc);
    const reloadRing = new THREE.Mesh(geos.reloadRing, mats.reload);
    reloadRing.rotation.x = Math.PI / 2.2;
    group.add(reloadRing);
    reloadParts.push(reloadRing);
    const reloadBolt = new THREE.Mesh(geos.reloadBolt, mats.reload);
    reloadBolt.position.set(0, 0.02, 0.06);
    reloadBolt.rotation.set(Math.PI / 2.2, 0, 0.5);
    group.add(reloadBolt);
    reloadParts.push(reloadBolt);
    // --- rare relic: golden prism + rotating rings + light column ---
    const relicParts = [];
    const relicCore = new THREE.Mesh(geos.relicCore, mats.relic);
    relicCore.scale.set(1, 1.35, 1);
    group.add(relicCore);
    relicParts.push(relicCore);
    const relicRingA = new THREE.Mesh(geos.relicRingA, mats.relic);
    relicRingA.rotation.x = Math.PI / 2.4;
    group.add(relicRingA);
    relicParts.push(relicRingA);
    const relicRingB = new THREE.Mesh(geos.relicRingB, mats.relic);
    relicRingB.rotation.set(Math.PI / 2, 0, 0.6);
    group.add(relicRingB);
    relicParts.push(relicRingB);
    const relicBeam = new THREE.Mesh(geos.relicBeam, mats.relicBeam);
    relicBeam.position.y = 0.55;
    group.add(relicBeam);
    relicParts.push(relicBeam);
    // --- damage-reduction guard: hex shield plate with a glowing core/halo ---
    const guardParts = [];
    const guardPlate = new THREE.Mesh(geos.guardPlate, mats.guardPlate);
    guardPlate.rotation.x = Math.PI / 2;
    group.add(guardPlate);
    guardParts.push(guardPlate);
    const guardCore = new THREE.Mesh(geos.guardCore, mats.guard);
    group.add(guardCore);
    guardParts.push(guardCore);
    const guardRing = new THREE.Mesh(geos.guardRing, mats.guard);
    guardRing.rotation.x = Math.PI / 2.6;
    group.add(guardRing);
    guardParts.push(guardRing);
    // --- max-health vital core: green cross frame around a glowing orb ---
    const vitalParts = [];
    const vitalOrb = new THREE.Mesh(geos.vitalOrb, mats.vitalFrame);
    group.add(vitalOrb);
    vitalParts.push(vitalOrb);
    const vitalCrossA = new THREE.Mesh(geos.vitalCrossA, mats.vital);
    group.add(vitalCrossA);
    vitalParts.push(vitalCrossA);
    const vitalCrossB = new THREE.Mesh(geos.vitalCrossB, mats.vital);
    vitalCrossB.rotation.z = Math.PI / 2;
    group.add(vitalCrossB);
    vitalParts.push(vitalCrossB);
    const vitalRing = new THREE.Mesh(geos.vitalRing, mats.vital);
    vitalRing.rotation.x = Math.PI / 2.8;
    group.add(vitalRing);
    vitalParts.push(vitalRing);
    group.visible = false;
    group.position.set(0, -60, 0);
    if (this.scene) this.scene.add(group);
    return {
      group,
      ammoMeshes: [ammoBody, ammoLid, ammoStripe],
      healthMeshes: [healthBody, healthRing],
      magMeshes: magParts,
      powerMeshes: powerParts,
      reloadMeshes: reloadParts,
      relicMeshes: relicParts,
      guardMeshes: guardParts,
      vitalMeshes: vitalParts,
      active: false,
      kind: 'ammo',
      baseY: 0.42,
      bob: 0,
      spin: 0,
      life: 0,
    };
  }

  _spawnPickup(kind, x, z) {
    if (!this._pickupGeos) this._initPickups();
    let item = null;
    for (let i = 0; i < this._pickupPool.length; i++) {
      if (!this._pickupPool[i].active) {
        item = this._pickupPool[i];
        break;
      }
    }
    if (!item) {
      item = this._createPickupItem();
      this._pickupPool.push(item);
    }
    item.kind = kind;
    item.active = true;
    item.life = kind === 'relic' ? 45
      : kind === 'guard' || kind === 'vital' ? 38
        : kind === 'mag' || kind === 'power' || kind === 'reload' ? 34 : 28;
    item.bob = rand(0, TAU);
    item.spin = rand(0, TAU);
    item.baseY = kind === 'relic' ? 0.95
      : kind === 'guard' ? 0.62
        : kind === 'vital' ? 0.6
          : kind === 'mag' || kind === 'power' || kind === 'reload' ? 0.55 : 0.42;
    item.group.position.set(x, item.baseY, z);
    item.group.rotation.y = item.spin;
    item.group.visible = true;
    const showAmmo = kind === 'ammo';
    const showHealth = kind === 'health';
    const showMag = kind === 'mag';
    const showPower = kind === 'power';
    const showReload = kind === 'reload';
    const showGuard = kind === 'guard';
    const showVital = kind === 'vital';
    for (let i = 0; i < item.ammoMeshes.length; i++) item.ammoMeshes[i].visible = showAmmo;
    for (let i = 0; i < item.healthMeshes.length; i++) item.healthMeshes[i].visible = showHealth;
    for (let i = 0; i < item.magMeshes.length; i++) item.magMeshes[i].visible = showMag;
    for (let i = 0; i < item.powerMeshes.length; i++) item.powerMeshes[i].visible = showPower;
    for (let i = 0; i < item.reloadMeshes.length; i++) item.reloadMeshes[i].visible = showReload;
    for (let i = 0; i < item.guardMeshes.length; i++) item.guardMeshes[i].visible = showGuard;
    for (let i = 0; i < item.vitalMeshes.length; i++) item.vitalMeshes[i].visible = showVital;
    const showRelic = kind === 'relic';
    for (let i = 0; i < item.relicMeshes.length; i++) item.relicMeshes[i].visible = showRelic;
  }

  _despawnPickup(item) {
    item.active = false;
    item.life = 0;
    item.group.visible = false;
    item.group.position.set(0, -60, 0);
  }

  _dropPickupsFor(robot) {
    const pos = robot.pos;
    const key = robot.def.key;
    const jx = rand(-0.7, 0.7);
    const jz = rand(-0.7, 0.7);
    // Bonus loot rolls independently of the normal drop table (see CONFIG.loot).
    // Rare relic: 1% — restores health and armor together and raises the armor cap.
    if (Math.random() < (LOOT.relicChance ?? 0.01)) {
      this._spawnPickup('relic', pos.x + jx * 0.4, pos.z + jz * 0.4);
      emit('weapon:notice', { text: '稀有装备已空投 // RELIC DETECTED', type: 'warn' });
    }
    // Shield module: 10% — each pickup cuts incoming damage by 5%.
    if (Math.random() < (LOOT.guardChance ?? 0.1)) {
      this._spawnPickup('guard', pos.x + rand(-1.1, 1.1), pos.z + rand(-1.1, 1.1));
    }
    // Vital core: 5% — each pickup raises max health by 10%.
    if (Math.random() < (LOOT.vitalChance ?? 0.05)) {
      this._spawnPickup('vital', pos.x + rand(-1.1, 1.1), pos.z + rand(-1.1, 1.1));
    }
    if (key === 'warlord') {
      // the boss always leaves a full care package
      this._spawnPickup('health', pos.x - 1.0, pos.z + 0.4);
      this._spawnPickup('ammo', pos.x + 1.0, pos.z + 0.4);
      this._spawnPickup('mag', pos.x - 0.2, pos.z - 1.4);
      this._spawnPickup('power', pos.x + 1.6, pos.z - 0.6);
      this._spawnPickup('reload', pos.x - 1.6, pos.z - 0.6);
      return;
    }
    const roll = Math.random();
    if (key === 'heavy') {
      if (roll < 0.44) this._spawnPickup('ammo', pos.x + jx, pos.z + jz);
      else if (roll < 0.66) this._spawnPickup('health', pos.x + jx, pos.z + jz);
      else if (roll < 0.8) this._spawnPickup('mag', pos.x + jx, pos.z + jz);
      else if (roll < 0.9) this._spawnPickup('power', pos.x + jx, pos.z + jz);
      else if (roll < 0.97) this._spawnPickup('reload', pos.x + jx, pos.z + jz);
    } else if (key === 'rifleman') {
      if (roll < 0.3) this._spawnPickup('ammo', pos.x + jx, pos.z + jz);
      else if (roll < 0.42) this._spawnPickup('health', pos.x + jx, pos.z + jz);
      else if (roll < 0.52) this._spawnPickup('mag', pos.x + jx, pos.z + jz);
      else if (roll < 0.6) this._spawnPickup('power', pos.x + jx, pos.z + jz);
      else if (roll < 0.67) this._spawnPickup('reload', pos.x + jx, pos.z + jz);
    } else {
      if (roll < 0.2) this._spawnPickup('ammo', pos.x + jx, pos.z + jz);
      else if (roll < 0.28) this._spawnPickup('health', pos.x + jx, pos.z + jz);
      else if (roll < 0.36) this._spawnPickup('mag', pos.x + jx, pos.z + jz);
      else if (roll < 0.42) this._spawnPickup('power', pos.x + jx, pos.z + jz);
      else if (roll < 0.47) this._spawnPickup('reload', pos.x + jx, pos.z + jz);
    }
  }

  _collectPickup(item) {
    const kind = item.kind;
    const pos = item.group.position;
    const sparkColor = kind === 'ammo' ? 0xffb347
      : kind === 'health' ? 0x59f0c8
        : kind === 'mag' ? 0x7cc8ff
          : kind === 'reload' ? 0xc084ff
            : kind === 'relic' ? 0xffe27a
              : kind === 'guard' ? 0x66e2ff
                : kind === 'vital' ? 0xa6ff5e
                  : 0xff5a3c;
    const special = kind === 'relic' || kind === 'guard' || kind === 'vital';
    this._fx('sparks', pos, this._upVec, {
      count: kind === 'relic' ? 28 : special ? 18 : kind === 'mag' || kind === 'power' ? 16 : 10,
      color: sparkColor,
      speed: kind === 'relic' ? 8 : special ? 6.5 : kind === 'mag' || kind === 'power' ? 6 : 4.5,
    });
    if (kind === 'relic') {
      this._fx('dustBurst', pos, { count: 16, scale: 1.6, color: 0xffe27a });
      this._flashLight(pos.x, pos.y + 0.6, pos.z, 0xffd062, 26, 0.6);
      emit('fx:shake', { intensity: 0.25, duration: 0.3 });
    } else if (kind === 'guard') {
      this._fx('dustBurst', pos, { count: 10, scale: 1.1, color: 0x66e2ff });
      this._flashLight(pos.x, pos.y + 0.4, pos.z, 0x66e2ff, 16, 0.4);
      emit('fx:shake', { intensity: 0.12, duration: 0.2 });
    } else if (kind === 'vital') {
      this._fx('dustBurst', pos, { count: 10, scale: 1.1, color: 0xa6ff5e });
      this._flashLight(pos.x, pos.y + 0.4, pos.z, 0xa6ff5e, 16, 0.4);
      emit('fx:shake', { intensity: 0.12, duration: 0.2 });
    }
    this._audio('pickup', kind);

    if (kind === 'health') {
      emit('player:heal', { amount: 20 });
      emit('weapon:notice', { text: '+20 装甲修复 // FIELD REPAIR', type: 'info' });
      emit('pickup:collected', { kind, amount: 20 });
    } else if (kind === 'mag') {
      emit('weapon:notice', { text: '+5 弹匣容量 // EXTENDED MAG', type: 'info', kind: 'loot' });
      emit('pickup:collected', { kind, amount: 5 });
    } else if (kind === 'power') {
      emit('weapon:notice', { text: '+5% 子弹威力 // DAMAGE BOOST', type: 'info', kind: 'loot' });
      emit('pickup:collected', { kind, amount: 0.05 });
    } else if (kind === 'reload') {
      emit('weapon:notice', { text: '-12% 换弹时间 // FAST HANDS', type: 'info', kind: 'loot' });
      emit('pickup:collected', { kind, amount: 0.12 });
    } else if (kind === 'relic') {
      emit('weapon:notice', { text: '稀有装备：生命/护甲全满 +50 护甲上限 // RELIC ACQUIRED', type: 'warn', kind: 'relic' });
      emit('pickup:collected', { kind, amount: 50 });
    } else if (kind === 'guard') {
      const pct = Math.round((LOOT.guardReduction ?? 0.05) * 100);
      emit('weapon:notice', { text: `+${pct}% 伤害减免 // DAMAGE GUARD`, type: 'info', kind: 'guard' });
      emit('pickup:collected', { kind, amount: LOOT.guardReduction ?? 0.05 });
    } else if (kind === 'vital') {
      const pct = Math.round((LOOT.vitalHealthGain ?? 0.1) * 100);
      emit('weapon:notice', { text: `+${pct}% 生命上限 // VITAL CORE`, type: 'info', kind: 'vital' });
      emit('pickup:collected', { kind, amount: LOOT.vitalHealthGain ?? 0.1 });
    } else {
      emit('weapon:notice', { text: '+40 弹药储备 // AMMO CACHE', type: 'info' });
      emit('pickup:collected', { kind, amount: 40 });
    }
    this._despawnPickup(item);
  }

  _updatePickups(dt) {
    const p = this._player;
    for (let i = 0; i < this._pickupPool.length; i++) {
      const item = this._pickupPool[i];
      if (!item.active) continue;
      item.life -= dt;
      item.bob += dt * 2.4;
      item.spin += dt * 1.7;
      item.group.position.y = item.baseY + Math.sin(item.bob) * 0.07;
      item.group.rotation.y = item.spin;
      if (item.life <= 0) {
        this._despawnPickup(item);
        continue;
      }
      if (!p.alive) continue;
      const d = dist2D(item.group.position.x, item.group.position.z, p.x, p.z);
      if (d < 1.5) {
        this._collectPickup(item);
      } else if (d < 2.8) {
        const pull = (2.8 - d) * 1.9 * dt;
        const dx = p.x - item.group.position.x;
        const dz = p.z - item.group.position.z;
        const len = Math.hypot(dx, dz) || 1;
        item.group.position.x += (dx / len) * pull;
        item.group.position.z += (dz / len) * pull;
      }
    }
  }

  /* ---------------- lights ---------------- */

  _initLights() {
    const count = this.quality === 'medium' ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xff7a45, 0, 16, 2);
      light.position.set(0, -60, 0);
      if (this.scene) this.scene.add(light);
      this._lights.push({ light, peak: 0, t: 0, duration: 0 });
    }
  }

  _flashLight(x, y, z, color, peak, duration) {
    if (!this._lights.length) return;
    const slot = this._lights[this._lightIndex++ % this._lights.length];
    slot.light.position.set(x, y, z);
    slot.light.color.setHex(color);
    slot.light.intensity = peak;
    slot.peak = peak;
    slot.t = 0;
    slot.duration = Math.max(0.05, duration);
  }

  _updateLights(dt) {
    for (let i = 0; i < this._lights.length; i++) {
      const slot = this._lights[i];
      if (slot.duration <= 0) continue;
      slot.t += dt;
      const k = 1 - slot.t / slot.duration;
      if (k <= 0) {
        slot.duration = 0;
        slot.light.intensity = 0;
      } else {
        slot.light.intensity = slot.peak * k * k;
      }
    }
  }

  /* ---------------- radar / state ---------------- */

  _updateRadar(dt) {
    this._radarAccum += dt;
    if (this._radarAccum < 0.083) return;
    this._radarAccum = 0;
    this._emitRadar();
  }

  _emitRadar() {
    const enemies = this._radarEnemies;
    let n = 0;
    for (let i = 0; i < this.robots.length; i++) {
      const robot = this.robots[i];
      if (!robot.alive) continue;
      let item = enemies[n];
      if (!item) {
        item = { x: 0, z: 0, type: 'scout', alive: true };
        enemies.push(item);
      }
      item.x = robot.pos.x;
      item.z = robot.pos.z;
      item.type = robot.type;
      item.alive = true;
      n++;
    }
    if (enemies.length > n) enemies.length = n;
    this._radarPlayer.x = this._player.x;
    this._radarPlayer.z = this._player.z;
    this._radarPlayer.yaw = this._player.yaw;
    emit('radar:update', {
      player: this._radarPlayer,
      enemies,
      bounds: this._radarBounds,
    });
  }

  _syncState() {
    this.state.alive = this._aliveCount();
    this.state.remaining = this.state.alive + this._spawnQueue.length;
    this.state.totalWaves = TOTAL_WAVES;
  }

  /* ---------------- dev hooks ---------------- */

  _installDevHook() {
    try {
      window.__devEnemies = {
        manager: this,
        killAll: () => this.debugKillAll(),
        jumpToWave: (n) => this.debugJumpToWave(n),
        start: () => this.start(),
        reset: () => this.reset(),
        spawnPickup: (kind, x = 0, z = 0) => { this._spawnPickup(kind, x, z); return kind; },
        state: () => JSON.parse(JSON.stringify(this.state)),
        robots: () => this.robots.map((r) => ({
          type: r.type,
          state: r.state,
          hp: Math.round(r.hp),
          maxHp: r.maxHp,
          x: +r.pos.x.toFixed(2),
          z: +r.pos.z.toFixed(2),
          los: r.los,
          fire: r.fireState,
        })),
      };
    } catch (_) {
      /* dev hook is best-effort only */
    }
  }
}

export { EnemyManager };

/* ================================================================== *
 *  5. DEV — isolated chassis previews (moved to src/models/robots/preview.js)
 * ================================================================== */

// Re-exported so existing imports of `createRobotPreview` from src/enemies.js
// (the model stage / automation) keep working after the model split.
export { createRobotPreview } from './models/robots/index.js';
