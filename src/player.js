import * as THREE from 'three';
import { CONFIG } from './config.js';
import { emit } from './bus.js';
import { clamp, damp, rand } from './utils.js';

const P = CONFIG.player;
const KEY = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  sprint: ['ShiftLeft', 'ShiftRight'],
};

/** First-person mercenary controller with capsule-vs-AABB collision. */
export class Player {
  constructor({ camera, canvas, world, audio }) {
    this.camera = camera;
    this.canvas = canvas;
    this.world = world;
    this.audio = audio;
    this.radius = P.radius;
    this.standHeight = P.standHeight;
    this.crouchHeight = P.crouchHeight;
    this.bodyHeight = P.standHeight;
    this.eyeHeight = P.eyeHeight;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.spawn = null;
    this.enabled = false;
    this.allowUnlockedLook = false;
    this.touchMode = false;
    /** Virtual (touch) movement axes: x = right positive, forward = forward positive, both -1..1. */
    this.virtualMove = { x: 0, forward: 0 };
    this.crouchHeld = false;
    this.sprintHeld = false;
    this.sensitivity = P.mouseSensitivity;
    this.aiming = false;
    this.speedMultiplier = 1;
    this.sprinting = false;
    this.crouching = false;
    this.grounded = true;
    this.yaw = 0;
    this.pitch = 0;
    this.lookPitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.bobTime = 0;
    this.bobAmount = 0;
    this.landDip = 0;
    this.shakeTrauma = 0;
    this.shakeTime = 0;
    this.health = P.maxHealth;
    this.maxHealth = P.maxHealth;
    this.armor = 60;
    this.maxArmor = P.maxArmor;
    this.alive = true;
    this.timeSinceDamage = 999;
    this.kills = 0;
    this.walkPhase = 0;
    this._keys = new Set();
    this._jumpQueued = false;
    this._wasGrounded = true;
    this._footstepAccum = 0;
    this._lastDamageDirection = { x: 0, y: 0 };
    this._registerInput();
    this.camera.rotation.order = 'YXZ';
  }

  _registerInput() {
    this._onKeyDown = (event) => {
      if (!this.enabled) return;
      this._keys.add(event.code);
      if (KEY.jump.includes(event.code) && !event.repeat) this._jumpQueued = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    };
    this._onKeyUp = (event) => this._keys.delete(event.code);
    this._onMouseMove = (event) => {
      if (!this.enabled || this.touchMode) return;
      const locked = document.pointerLockElement === this.canvas;
      if (!locked && !this.allowUnlockedLook) return;
      const sens = this.sensitivity * (this.aiming ? 0.62 : 1);
      this.yaw -= event.movementX * sens;
      this.lookPitch = clamp(this.lookPitch - event.movementY * sens, -P.maxPitch, P.maxPitch);
    };
    this._onBlur = () => this._keys.clear();
    this._onMouseDown = (event) => {
      if (this.touchMode) return;
      if (document.pointerLockElement !== this.canvas && !this.allowUnlockedLook && this.enabled) {
        this.requestPointerLock();
      } else if (event.button === 0) {
        // no-op, weapon handles firing
      }
    };
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('blur', this._onBlur);
  }

  requestPointerLock() {
    if (this.touchMode) return;
    const el = this.canvas;
    if (!el || !el.requestPointerLock) return;
    const fallback = () => {
      try {
        const p = el.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => { /* requires user gesture */ });
      } catch { /* ignore */ }
    };
    try {
      const promise = el.requestPointerLock({ unadjustedMovement: true });
      if (promise && typeof promise.catch === 'function') promise.catch(fallback);
    } catch {
      fallback();
    }
  }

  reset(spawn = this.world.playerSpawn) {
    this.spawn = spawn;
    this.position.set(spawn.x, spawn.y ?? 0, spawn.z);
    this.velocity.set(0, 0, 0);
    this.yaw = spawn.yaw ?? 0;
    this.pitch = 0;
    this.lookPitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.health = this.maxHealth;
    this.armor = 60;
    this.alive = true;
    this.enabled = true;
    this.timeSinceDamage = 999;
    this._keys.clear();
    this.virtualMove.x = 0;
    this.virtualMove.forward = 0;
    this.crouchHeld = false;
    this.sprintHeld = false;
    this._jumpQueued = false;
    this.shakeTrauma = 0;
    this.landDip = 0;
    this.bodyHeight = this.standHeight;
    this.eyeHeight = P.eyeHeight;
    this.camera.fov = CONFIG.renderer.fov;
    this.camera.updateProjectionMatrix();
    this._updateCamera(0);
  }

  setSensitivity(value) {
    this.sensitivity = clamp(value, 0.0004, 0.012);
  }

  /**
   * Mobile/touch mode: pointer lock is never requested and unlocked mouse look
   * stays off; the TouchControls layer feeds the virtual input API instead.
   */
  setTouchMode(enabled = true) {
    this.touchMode = !!enabled;
    if (this.touchMode) this.allowUnlockedLook = false;
  }

  /** Virtual joystick. x = right positive, forward = forward positive; (0, 0) releases. */
  setMoveInput(x, forward) {
    this.virtualMove.x = clamp(Number(x) || 0, -1, 1);
    this.virtualMove.forward = clamp(Number(forward) || 0, -1, 1);
  }

  /** Queue one jump (same as pressing Space once). */
  queueJump() {
    this._jumpQueued = true;
  }

  /** Held virtual crouch, OR-ed with the keyboard crouch keys. */
  setCrouchHeld(held) {
    this.crouchHeld = !!held;
  }

  /** Held virtual sprint, OR-ed with the keyboard sprint keys. */
  setSprintHeld(held) {
    this.sprintHeld = !!held;
  }

  addRecoil(pitch, yaw) {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
    this.recoilPitch = clamp(this.recoilPitch, -0.35, 0.45);
  }

  addShake(intensity = 0.4) {
    this.shakeTrauma = clamp(this.shakeTrauma + intensity, 0, 1);
  }

  takeDamage(rawAmount, fromPosition = null, source = 'robot') {
    if (!this.alive || this.godMode) return;
    const amount = Math.max(0, rawAmount);
    const armorPart = Math.min(this.armor, amount * 0.64);
    this.armor -= armorPart;
    const healthPart = amount - armorPart;
    this.health = Math.max(0, this.health - healthPart);
    this.timeSinceDamage = 0;
    this.audio?.playerHurt?.();
    this.addShake(0.42 + Math.min(0.35, amount / 120));

    let direction = { x: 0, y: 0, angle: 0, distance: 0 };
    if (fromPosition) {
      const dx = fromPosition.x - this.position.x;
      const dz = fromPosition.z - this.position.z;
      const sin = Math.sin(-this.yaw);
      const cos = Math.cos(-this.yaw);
      // rotate world delta into player-local space; +x right, +y forward
      const localX = dx * cos + dz * sin;
      const localZ = -dx * sin + dz * cos;
      const distance = Math.hypot(localX, localZ) || 1;
      direction = {
        x: localX / distance,
        y: -localZ / distance,
        angle: Math.atan2(localX / distance, -localZ / distance),
        distance,
      };
      this._lastDamageDirection = direction;
    }

    emit('player:hit', {
      amount: Math.round(amount),
      health: Math.ceil(this.health),
      armor: Math.ceil(this.armor),
      direction,
      source,
      lowHealth: this.health <= 30,
    });

    if (this.health <= 0) {
      this.alive = false;
      this.enabled = false;
      emit('player:died', { source });
    }
  }

  heal(amount) {
    if (!this.alive) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
    emit('player:stats', this.stats);
  }

  addArmor(amount) {
    this.armor = Math.min(this.maxArmor, this.armor + amount);
  }

  /** Rare relic: raise the armor ceiling and fully restore health + armor. */
  grantRelic(armorBonus = 50) {
    this.maxArmor = Math.min(400, this.maxArmor + Math.max(0, armorBonus));
    this.health = this.maxHealth;
    this.armor = this.maxArmor;
    this.timeSinceDamage = 0;
    emit('player:stats', this.stats);
    return this.maxArmor;
  }

  /** Hardcore difficulty: drop relic / permanent bonuses back to the base spec. */
  resetArmorCap(baseMax = P.maxArmor) {
    this.maxArmor = baseMax;
    this.armor = Math.min(this.armor, this.maxArmor);
    emit('player:stats', this.stats);
  }

  /** Restore a permanent armor-cap bonus carried over from a previous run. */
  applyArmorBonus(bonus, baseMax = P.maxArmor) {
    const extra = Math.max(0, Number(bonus) || 0);
    this.maxArmor = Math.min(400, baseMax + extra);
    this.armor = this.maxArmor;
    emit('player:stats', this.stats);
  }

  get stats() {
    return {
      health: Math.ceil(this.health),
      maxHealth: this.maxHealth,
      armor: Math.ceil(this.armor),
      maxArmor: this.maxArmor,
      alive: this.alive,
    };
  }

  get isMoving() {
    return this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z > 0.8;
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  _isDown(codes) {
    for (const code of codes) if (this._keys.has(code)) return true;
    return false;
  }

  update(dt) {
    if (!this.enabled || !this.alive) return;
    this.timeSinceDamage += dt;

    // --- desired movement -------------------------------------------------
    let inputX = 0;
    let inputZ = 0;
    if (this._isDown(KEY.forward)) inputZ -= 1;
    if (this._isDown(KEY.back)) inputZ += 1;
    if (this._isDown(KEY.left)) inputX -= 1;
    if (this._isDown(KEY.right)) inputX += 1;
    // Virtual (touch) axes are additive with the keyboard so both coexist.
    inputX += this.virtualMove.x;
    inputZ -= this.virtualMove.forward;
    inputX = clamp(inputX, -1, 1);
    inputZ = clamp(inputZ, -1, 1);
    const wantsSprint = (this._isDown(KEY.sprint) || this.sprintHeld) && inputZ < 0 && !this.aiming;
    this.sprinting = wantsSprint && this.grounded;
    this.crouching = (this._isDown(KEY.crouch) || this.crouchHeld) && !this.sprinting;

    const targetHeight = this.crouching ? this.crouchHeight : this.standHeight;
    this.bodyHeight = damp(this.bodyHeight, targetHeight, 14, dt);
    const targetEye = this.crouching ? P.crouchEyeHeight : P.eyeHeight;
    this.eyeHeight = damp(this.eyeHeight, targetEye, 13, dt);

    let speed = this.sprinting ? P.sprintSpeed : this.crouching ? P.crouchSpeed : P.walkSpeed;
    if (this.aiming) speed = Math.min(speed, P.adsSpeed);
    speed *= this.speedMultiplier;

    const len = Math.hypot(inputX, inputZ);
    if (len > 0) { inputX /= len; inputZ /= len; }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Camera basis at yaw θ: forward = (-sinθ, -cosθ), right = (cosθ, -sinθ).
    // inputZ is -1 for W (forward), so this is right*inputX + forward*(-inputZ).
    const wishX = inputX * cos + inputZ * sin;
    const wishZ = -inputX * sin + inputZ * cos;
    const targetVX = wishX * speed;
    const targetVZ = wishZ * speed;
    const accel = this.grounded ? P.accel : P.airAccel;
    this.velocity.x = damp(this.velocity.x, targetVX, accel, dt);
    this.velocity.z = damp(this.velocity.z, targetVZ, accel, dt);

    // --- jump / gravity ---------------------------------------------------
    if (this._jumpQueued && this.grounded && !this.crouching) {
      this.velocity.y = P.jumpSpeed;
      this.grounded = false;
      this.audio?.jump?.();
    }
    this._jumpQueued = false;

    const prevY = this.position.y;
    this.velocity.y -= P.gravity * dt;
    // --- horizontal collision (axis-separated) ---------------------------
    this._moveAxis('x', this.velocity.x * dt);
    this._moveAxis('z', this.velocity.z * dt);

    // --- vertical integration and box tops -------------------------------
    this.position.y += this.velocity.y * dt;
    const support = this._supportHeight(this.position.x, this.position.z, prevY, this.position.y);
    if (this.position.y <= support + 0.0001) {
      if (!this._wasGrounded && this.velocity.y < -4.5) {
        this.audio?.land?.();
        this.landDip = Math.min(0.085, Math.abs(this.velocity.y) * 0.012);
      }
      this.position.y = support;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    this._wasGrounded = this.grounded;

    // hard floor safety
    if (this.position.y < 0) { this.position.y = 0; this.velocity.y = 0; this.grounded = true; }

    // bounds
    const b = this.world.mapBounds;
    this.position.x = clamp(this.position.x, b.minX + this.radius + 0.08, b.maxX - this.radius - 0.08);
    this.position.z = clamp(this.position.z, b.minZ + this.radius + 0.08, b.maxZ - this.radius - 0.08);

    // --- footsteps --------------------------------------------------------
    const horizontalSpeed = this.speed;
    if (this.grounded && horizontalSpeed > 0.7) {
      const interval = this.sprinting ? 0.29 : this.crouching ? 0.55 : 0.38;
      this._footstepAccum += dt * (horizontalSpeed / P.walkSpeed);
      if (this._footstepAccum >= interval) {
        this._footstepAccum = 0;
        this.audio?.footstep?.(this.sprinting);
        this.addShake(0.025);
      }
      this.walkPhase += dt * (this.sprinting ? 12.5 : this.crouching ? 5.5 : 8.2);
    } else {
      this._footstepAccum = Math.min(this._footstepAccum, 0.3);
    }

    // --- recovery ---------------------------------------------------------
    this.recoilPitch = damp(this.recoilPitch, 0, 9.5, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, 11, dt);
    this.landDip = damp(this.landDip, 0, 9, dt);
    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.9);
    this.shakeTime += dt;

    // health regeneration (non-lethal, after a lull in combat)
    if (this.timeSinceDamage > P.healthRegenDelay && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + P.healthRegenRate * dt);
    }

    this._updateCamera(dt);
  }

  _moveAxis(axis, amount) {
    if (amount === 0) return;
    const r = this.radius;
    this.position[axis] += amount;
    const feet = this.position.y;
    const head = feet + this.bodyHeight * 0.9;
    for (let i = 0; i < this.world.collisionBoxes.length; i++) {
      const box = this.world.collisionBoxes[i];
      if (head <= box.minY + 0.01 || feet >= box.maxY - 0.32) continue; // can step/jump over low tops
      const minX = box.minX - r;
      const maxX = box.maxX + r;
      const minZ = box.minZ - r;
      const maxZ = box.maxZ + r;
      if (this.position.x <= minX || this.position.x >= maxX || this.position.z <= minZ || this.position.z >= maxZ) continue;
      if (axis === 'x') {
        this.position.x = amount > 0 ? minX : maxX;
        this.velocity.x = 0;
      } else {
        this.position.z = amount > 0 ? minZ : maxZ;
        this.velocity.z = 0;
      }
    }
  }

  _supportHeight(x, z, prevY, newY) {
    const r = this.radius * 0.82;
    let top = 0;
    const ceiling = Math.max(prevY + 0.32, newY + 0.02);
    for (let i = 0; i < this.world.collisionBoxes.length; i++) {
      const box = this.world.collisionBoxes[i];
      if (box.maxY > ceiling + 0.001 || box.maxY <= top) continue;
      if (x <= box.minX - r || x >= box.maxX + r || z <= box.minZ - r || z >= box.maxZ + r) continue;
      top = box.maxY;
    }
    return top;
  }

  _updateCamera(dt) {
    const pitch = clamp(this.lookPitch + this.recoilPitch, -P.maxPitch, P.maxPitch);
    this.pitch = pitch;
    const horizontal = this.speed;
    const targetBob = this.grounded ? clamp(horizontal / P.sprintSpeed, 0, 1) : 0;
    this.bobAmount = damp(this.bobAmount, targetBob, 8, dt);
    const bobY = Math.sin(this.walkPhase * 2) * 0.023 * this.bobAmount + this.landDip;
    const bobX = Math.cos(this.walkPhase) * 0.018 * this.bobAmount;
    const breathe = Math.sin(this.shakeTime * 1.35) * 0.0032;

    let shakeX = 0;
    let shakeY = 0;
    let shakeRoll = 0;
    if (this.shakeTrauma > 0) {
      const t = this.shakeTrauma * this.shakeTrauma;
      shakeX = (Math.sin(this.shakeTime * 79) + Math.sin(this.shakeTime * 37.3)) * 0.0022 * t;
      shakeY = (Math.cos(this.shakeTime * 63) + Math.cos(this.shakeTime * 29.7)) * 0.0022 * t;
      shakeRoll = (Math.sin(this.shakeTime * 51) * 0.0045) * t;
    }

    this.eye.set(
      this.position.x + bobX + shakeX,
      this.position.y + this.eyeHeight + bobY + breathe + shakeY,
      this.position.z
    );
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(
      clamp(pitch + shakeY * 0.6, -P.maxPitch, P.maxPitch),
      this.yaw + this.recoilYaw + shakeX * 0.7,
      Math.sin(this.walkPhase) * 0.0035 * this.bobAmount + shakeRoll
    );
    // subtle FOV breathing while sprinting
    const targetFov = (this.aiming ? CONFIG.weapon.adsFov : CONFIG.renderer.fov) + (this.sprinting ? 1.8 : 0);
    this.camera.fov = damp(this.camera.fov, targetFov, 12, dt);
    this.camera.updateProjectionMatrix();
  }

  look(dx, dy) {
    this.yaw -= dx * this.sensitivity;
    this.lookPitch = clamp(this.lookPitch - dy * this.sensitivity, -P.maxPitch, P.maxPitch);
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('blur', this._onBlur);
  }
}
