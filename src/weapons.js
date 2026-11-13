import * as THREE from 'three';
import { CONFIG } from './config.js';
import { emit } from './bus.js';
import { clamp, damp, rand, canvasTexture } from './utils.js';
// The VXR-7 viewmodel (geometry, materials, procedural textures, hands, muzzle
// flash rig) lives in its own model module; this file keeps the weapon system.
import { buildVxr7Viewmodel } from './models/weapons/vxr7.js';

const W = CONFIG.weapon;

// scratch objects for the per-frame viewmodel convergence solve
const _convQuat = new THREE.Quaternion();
const _muzzleOff = new THREE.Vector3();
const _barrelDir = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();

export class WeaponSystem {
  constructor({ camera, canvas, world, enemies, effects, audio, player, renderer, environment = null }) {
    this.camera = camera;
    this.canvas = canvas;
    this.world = world;
    this.enemies = enemies;
    this.effects = effects;
    this.audio = audio;
    this.player = player;
    this.renderer = renderer;

    this.active = false;
    this.touchMode = false;
    this.mag = W.magSize;
    this.magSize = W.magSize;
    this.reserve = W.reserveStart;
    this.reserveMax = W.reserveMax;
    // loot progression
    this.damageMultiplier = 1;
    this.magExtension = 0;
    this.reloadSpeedMul = 1;
    this.fireInterval = 60 / W.rpm;
    this.fireCooldown = 0;
    this.triggerDown = false;
    this.aiming = false;
    this.ads = 0;
    this.reloading = false;
    this.reloadTime = 0;
    this.reloadDuration = W.reloadTime;
    this.spreadBloom = 0;
    this.recoil = 0;
    this.recoilYaw = 0;
    this.time = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.lastFireTime = -999;
    this._prevYaw = 0;
    this._prevPitch = 0;
    this._swayX = 0;
    this._swayY = 0;
    this._sprintBlend = 0;
    this._muzzleTimer = 0;
    this._boltKick = 0;
    this._reloadPlayed = new Set();
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 280;
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._end = new THREE.Vector3();
    this._muzzleView = new THREE.Vector3();
    this._muzzleNdc = new THREE.Vector3();
    this._ejectView = new THREE.Vector3();
    this._ejectWorld = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();

    this._buildScene(environment);
    this._buildWeapon();
    this._bindInput();
  }

  // ---------------------------------------------------------------------------
  // View-model scene
  // ---------------------------------------------------------------------------
  _buildScene(environment) {
    this.viewScene = new THREE.Scene();
    this.viewScene.environment = environment;
    this.viewScene.environmentIntensity = 0.75;
    this.viewCamera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.01, 12);
    this.viewCamera.position.set(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xffe0b8, 0x33261b, 1.05);
    this.viewScene.add(hemi);

    const key = new THREE.DirectionalLight(0xffdfb6, 3.6);
    key.position.set(-2.6, 3.6, 2.2);
    this.viewScene.add(key);

    const fill = new THREE.DirectionalLight(0x9cc4e0, 1.6);
    fill.position.set(3.2, 0.7, 2.4);
    this.viewScene.add(fill);

    const rim = new THREE.DirectionalLight(0xff8d46, 2.8);
    rim.position.set(0.6, 1.6, -3.0);
    this.viewScene.add(rim);

    // soft frontal bounce so the side facing the camera keeps its material detail
    const cameraFill = new THREE.DirectionalLight(0xb4c9d6, 1.2);
    cameraFill.position.set(0.2, 1.4, 3.4);
    this.viewScene.add(cameraFill);

    this.muzzleLight = new THREE.PointLight(0xffa34a, 0, 4.5, 2);
    // parented to the flash group after the weapon is built so it tracks the muzzle
  }

  /**
   * Builds the first-person VXR-7 viewmodel. The model geometry, materials,
   * procedural textures, hands and muzzle-flash rig live in
   * `src/models/weapons/vxr7.js`; this method only parents the returned handles
   * onto the system (same field names the animation/firing code expects) and
   * applies the initial hip pose. The muzzle light created in _buildScene is
   * handed to the model so the flash rig can re-parent it under the muzzle.
   */
  _buildWeapon() {
    Object.assign(this, buildVxr7Viewmodel({
      scene: this.viewScene,
      muzzleLight: this.muzzleLight,
    }));
    this._setHipTransform(0);
  }

  _bindInput() {
    this._onMouseDown = (event) => {
      if (!this.active || this.touchMode) return;
      const locked = document.pointerLockElement === this.canvas;
      if (!locked && event.target !== this.canvas) return;
      if (event.button === 0) {
        this.triggerDown = true;
        this.tryFire();
      } else if (event.button === 2) {
        this.aiming = true;
        event.preventDefault();
      }
    };
    this._onMouseUp = (event) => {
      if (this.touchMode) return;
      if (event.button === 0) this.triggerDown = false;
      if (event.button === 2) this.aiming = false;
    };
    this._onKeyDown = (event) => {
      if (!this.active) return;
      if (event.code === 'KeyR' && !event.repeat) this.startReload();
    };
    this._onContextMenu = (event) => {
      if (this.active) event.preventDefault();
    };
    this._onBlur = () => {
      this.triggerDown = false;
      this.aiming = false;
    };
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('blur', this._onBlur);
  }

  setActive(active) {
    this.active = active;
    this.triggerDown = false;
    this.aiming = false;
    this.player.aiming = false;
    if (!active) {
      this.flashMats?.forEach((m) => { m.opacity = 0; });
      if (this.muzzleLight) this.muzzleLight.intensity = 0;
    }
  }

  /** Virtual (touch) trigger: press fires immediately, release stops automatic fire. */
  setTrigger(down) {
    const pressed = !!down;
    if (pressed === this.triggerDown) return;
    this.triggerDown = pressed;
    if (pressed) this.tryFire();
  }

  /** Virtual (touch) aim-down-sights, same field the right mouse button drives. */
  setAiming(aiming) {
    this.aiming = !!aiming;
    if (!this.aiming) this.player.aiming = false;
  }

  /** Touch mode: mouse button input belongs to the touch layer. */
  setTouchMode(enabled = true) {
    this.touchMode = !!enabled;
    if (this.touchMode) {
      this.triggerDown = false;
      this.aiming = false;
    }
  }

  reset() {
    this.mag = this.magSize;
    this.reserve = W.reserveStart;
    this.reloading = false;
    this.reloadTime = 0;
    this.triggerDown = false;
    this.aiming = false;
    this.ads = 0;
    this.fireCooldown = 0;
    this.spreadBloom = 0;
    this.recoil = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.lastFireTime = -999;
    this._prevYaw = this.player.yaw;
    this._prevPitch = this.player.pitch;
    this._reloadPlayed.clear();
    this.spareMagazine.visible = false;
    this.magazine.position.set(0, -0.096, 0.035);
    this.magazine.rotation.set(-0.12, 0, 0);
    this.flashMats.forEach((m) => { m.opacity = 0; });
    this._setHipTransform(0);
  }

  addAmmo(amount) {
    this.reserve = Math.min(this.reserveMax, this.reserve + amount);
  }

  /** Loot: extend the magazine (and load the extra rounds immediately). */
  addMagCapacity(amount) {
    const gain = Math.max(1, Math.round(amount));
    this.magSize = Math.min(120, this.magSize + gain);
    this.mag = Math.min(this.magSize, this.mag + gain);
    this.reserve = Math.max(this.reserve, Math.min(this.reserveMax, this.reserve));
    this.magExtension += gain;
    return this.magSize;
  }

  /** Loot: multiplicative damage growth (5% per pickup by default). */
  addDamageBoost(fraction) {
    const gain = Math.max(0.01, fraction);
    this.damageMultiplier = Math.min(4, this.damageMultiplier * (1 + gain));
    return this.damageMultiplier;
  }

  /** Loot: faster reloads (12% shorter per pickup, hard floor at 0.55 s). */
  addReloadSpeed(fraction) {
    const gain = clamp(fraction, 0.01, 0.6);
    this.reloadSpeedMul = Math.max(0.35, this.reloadSpeedMul * (1 - gain));
    this.reloadDuration = Math.max(0.55, W.reloadTime * this.reloadSpeedMul);
    return this.reloadDuration;
  }

  /** Hardcore difficulty: strip every pickup upgrade back to the base rifle. */
  resetUpgrades() {
    this.magSize = W.magSize;
    this.mag = Math.min(this.mag, this.magSize);
    this.damageMultiplier = 1;
    this.magExtension = 0;
    this.reloadSpeedMul = 1;
    this.reloadDuration = W.reloadTime;
  }

  /** Snapshot of everything the loot system can add (for death persistence). */
  exportUpgrades() {
    return {
      magExtension: this.magExtension,
      damageMultiplier: this.damageMultiplier,
      reloadSpeedMul: this.reloadSpeedMul,
    };
  }

  /** Re-apply a previously captured upgrade snapshot. */
  importUpgrades(data) {
    if (!data) return;
    const mag = clamp(Math.round(Number(data.magExtension) || 0), 0, 90);
    this.magExtension = mag;
    this.magSize = Math.min(120, W.magSize + mag);
    this.mag = Math.min(this.magSize, this.mag + mag);
    this.damageMultiplier = clamp(Number(data.damageMultiplier) || 1, 1, 4);
    this.reloadSpeedMul = clamp(Number(data.reloadSpeedMul) || 1, 0.35, 1);
    this.reloadDuration = Math.max(0.55, W.reloadTime * this.reloadSpeedMul);
  }

  startReload() {
    if (!this.active || this.reloading || this.mag >= this.magSize || this.reserve <= 0) {
      if (this.reserve <= 0 && this.mag <= 0) emit('weapon:notice', { text: '弹药耗尽 — 等待补给', type: 'warn' });
      return;
    }
    this.reloading = true;
    this.reloadTime = 0;
    this._reloadPlayed.clear();
    this.aiming = false;
    this.triggerDown = false;
    this.audio?.reloadStart?.();
  }

  _finishReload() {
    const need = this.magSize - this.mag;
    const take = Math.min(need, this.reserve);
    this.mag += take;
    this.reserve -= take;
    this.reloading = false;
    this.reloadTime = 0;
    this.spareMagazine.visible = false;
    this.magazine.position.set(0, -0.096, 0.035);
    this.magazine.rotation.set(-0.12, 0, 0);
  }

  tryFire() {
    if (!this.active || this.reloading || !this.player.alive) return false;
    if (this.fireCooldown > 0) return false;
    if (this.mag <= 0) {
      this.audio?.dryFire?.();
      this.startReload();
      return false;
    }
    this.fireCooldown = this.fireInterval;
    this.mag--;
    this.shotsFired++;
    this.lastFireTime = this.time;
    this._boltKick = 1;
    this.trigger.rotation.x = -0.35;

    // aim ray with dynamic spread
    this.camera.updateMatrixWorld();
    const spread = this._currentSpread();
    const dir = this.camera.getWorldDirection(this._forward).clone();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const r = Math.sqrt(Math.random()) * spread;
    const angle = Math.random() * Math.PI * 2;
    dir.addScaledVector(right, Math.cos(angle) * r).addScaledVector(up, Math.sin(angle) * r).normalize();

    this.camera.getWorldPosition(this._origin);
    this._raycaster.set(this._origin, dir);
    this._raycaster.far = 280;

    const targets = [];
    if (this.world.collideMeshes) targets.push(...this.world.collideMeshes);
    if (this.enemies.raycastTargets) targets.push(...this.enemies.raycastTargets);
    const hits = this._raycaster.intersectObjects(targets, true);
    let hit = hits.length ? hits[0] : null;
    let hitEnemy = false;

    if (hit) {
      this._end.copy(hit.point);
      let node = hit.object;
      while (node && !node.userData?.robot && !node.userData?.enemy) node = node.parent;
      if (node) {
        hitEnemy = true;
        this.shotsHit++;
        const headshot = hit.object.userData?.zone === 'head' || node.userData?.zone === 'head';
        const baseDamage = W.damage * this.damageMultiplier
          * clamp(1.0 - (hit.distance / 280) * 0.18, 0.84, 1);
        // EnemyManager owns the 2x headshot multiplier, zone resolution, FX and audio.
        this.enemies.damage(hit.object, baseDamage, {
          point: hit.point, direction: dir, headshot, weapon: 'rifle',
        });
      } else {
        const surface = hit.object.userData?.surface || 'stone';
        let normal = dir.clone().negate();
        if (hit.face?.normal) {
          normal = hit.face.normal.clone()
            .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
            .normalize();
        }
        this.effects?.impact?.(hit.point, normal, {
          surface, scale: 0.9, direction: dir,
        });
        const dist = hit.distance;
        this.audio?.impact?.(surface, dist);
      }
    } else {
      this._end.copy(this._origin).addScaledVector(dir, 220);
    }

    // --- view-model & world feedback ---
    this._muzzleTimer = 0.055;
    const flashScale = rand(0.7, 1.2);
    this.flashGroup.scale.setScalar(flashScale);
    this.flashGroup.rotation.z = Math.random() * Math.PI;
    this.flashMats.forEach((m, i) => { m.opacity = i === 2 ? 0.95 : rand(0.6, 1.0); });
    this.muzzleLight.intensity = 18;

    this.spreadBloom = clamp(this.spreadBloom + 0.011 + (this.ads > 0.5 ? 0.003 : 0), 0, W.spreadMax * 1.6);
    this.recoil = clamp(this.recoil + 1, 0, 1.6);
    this.player.addRecoil(W.recoil.pitch * rand(0.75, 1.25), W.recoil.yaw * rand(-1, 1));
    this.player.addShake(0.16);
    this.audio?.shot?.();

    // world-space muzzle position: derived from the actual viewmodel muzzle so
    // the tracer visibly leaves the barrel instead of a point floating in front
    // of the camera.
    this.camera.updateMatrixWorld();
    this.gun.updateWorldMatrix(true, false);
    this.flashGroup.getWorldPosition(this._muzzleView);
    this._viewmodelToWorld(this._muzzleView, this._muzzleWorld);
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const camUp = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);

    this.effects?.tracer?.(this._muzzleWorld, this._end, { color: 0xffd58a, width: 0.028 });
    // No world-space muzzle-flash billboard: the dedicated viewmodel flash is
    // already at the muzzle, and a 3D flash 0.7 m from the camera reads as a
    // giant screen-filling polygon for a few frames.
    // Ejection port sits behind the muzzle on the right of the receiver.
    this.gun.localToWorld(this._ejectView.set(0.062, 0.055, 0.0));
    this._viewmodelToWorld(this._ejectView, this._ejectWorld);
    const eject = this._ejectWorld;
    // Spread the ejection so a burst leaves a fan of brass instead of a single
    // clump: randomise speed, roll around the ejection axis and add jitter.
    const roll = rand(-0.5, 0.5);
    const ejectVel = camRight.clone().multiplyScalar(rand(1.3, 3.4))
      .add(camUp.clone().multiplyScalar(rand(1.1, 2.7)))
      .add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(rand(-1.1, -0.2)))
      .add(new THREE.Vector3(rand(-1.1, 1.1), rand(-0.5, 0.9), rand(-1.1, 1.1)))
      .applyAxisAngle(this.camera.getWorldDirection(new THREE.Vector3()), roll);
    this.effects?.shellCasing?.(eject, ejectVel, { scale: 0.8 });

    // smoke
    const puff = this.smokePuffs.find((p) => p.life <= 0);
    if (puff) {
      puff.life = 0.7;
      puff.mesh.visible = true;
      puff.mesh.position.copy(this.muzzleLocal).add(new THREE.Vector3(rand(-0.01, 0.01), rand(0, 0.02), 0.02));
      puff.mesh.material.opacity = 0.22;
      puff.mesh.scale.setScalar(rand(0.6, 1.0));
      puff.velocity.set(rand(-0.03, 0.03), rand(0.06, 0.14), rand(0.02, 0.08));
    }

    // shell casing glow in viewmodel (a tiny brass quip; effects owns the real casing)
    emit('weapon:fired', { mag: this.mag, reserve: this.reserve });
    return true;
  }

  /**
   * Convert a point in viewmodel space (viewCamera at origin, -Z forward) into
   * a world point that lands on the same screen pixel through the main camera.
   * The two cameras share a transform but not a FOV, so a plain world transform
   * would make tracers drift away from the barrel.
   */
  _viewmodelToWorld(viewPoint, out) {
    const depth = Math.max(0.35, -viewPoint.z);
    this._muzzleNdc.copy(viewPoint).project(this.viewCamera);
    out.set(this._muzzleNdc.x, this._muzzleNdc.y, 0.5).unproject(this.camera);
    out.sub(this.camera.position).normalize().multiplyScalar(depth).add(this.camera.position);
    return out;
  }

  _currentSpread() {
    const ads = this.ads;
    const moveFactor = clamp(this.player.speed / CONFIG.player.sprintSpeed, 0, 1);
    let spread = W.spreadHip * (1 - ads) + W.spreadAds * ads;
    spread += W.spreadMove * moveFactor * (1 - ads * 0.55);
    spread += this.spreadBloom;
    if (!this.player.grounded) spread += 0.02;
    if (this.player.crouching) spread *= 0.82;
    return spread;
  }

  update(dt) {
    this.time += dt;
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (!this.active) {
      this._updateSmoke(dt);
      return;
    }

    this._sprintBlend = damp(this._sprintBlend, this.player.sprinting && !this.aiming ? 1 : 0, 9, dt);
    const targetAds = this.aiming && !this.reloading && !this.player.sprinting ? 1 : 0;
    this.ads = damp(this.ads, targetAds, 13, dt);
    this.player.aiming = targetAds > 0.35;
    this.player.speedMultiplier = 1 - 0.35 * this.ads;

    this.recoil = damp(this.recoil, 0, 13, dt);
    this.spreadBloom = damp(this.spreadBloom, 0, 4.2, dt);
    this._boltKick = damp(this._boltKick, 0, 15, dt);

    // automatic fire
    if (this.triggerDown && this.fireCooldown <= 0 && !this.reloading) {
      if (this.mag > 0) this.tryFire();
      else if (this.reserve > 0) this.startReload();
    }

    // reload sequence
    if (this.reloading) {
      this.reloadTime += dt;
      const t = this.reloadTime;
      if (t > 0.28 && !this._reloadPlayed.has('out')) {
        this._reloadPlayed.add('out');
        this.audio?.reloadMagIn?.();
      }
      if (t > 0.86 && !this._reloadPlayed.has('in')) {
        this._reloadPlayed.add('in');
        this.audio?.reloadMagIn?.();
        this.spareMagazine.visible = true;
      }
      if (t > 1.48 && !this._reloadPlayed.has('bolt')) {
        this._reloadPlayed.add('bolt');
        this.audio?.reloadBolt?.();
      }
      if (t >= this.reloadDuration) this._finishReload();
    }

    // muzzle flash decay
    if (this._muzzleTimer > 0) {
      this._muzzleTimer -= dt;
      const fade = clamp(this._muzzleTimer / 0.055, 0, 1);
      this.flashMats?.forEach((m) => { m.opacity *= fade * 0.85; });
      if (this.muzzleLight) this.muzzleLight.intensity = 18 * fade;
      if (this._muzzleTimer <= 0) {
        this.flashMats?.forEach((m) => { m.opacity = 0; });
        if (this.muzzleLight) this.muzzleLight.intensity = 0;
      }
    }

    this._updateSmoke(dt);

    // sway from look delta
    const dyaw = this.player.yaw - this._prevYaw;
    const dpitch = this.player.pitch - this._prevPitch;
    this._prevYaw = this.player.yaw;
    this._prevPitch = this.player.pitch;
    const swayTargetX = clamp(dyaw * 3.2, -0.05, 0.05);
    const swayTargetY = clamp(-dpitch * 3.2, -0.05, 0.05);
    this._swayX = damp(this._swayX, swayTargetX, 10, dt);
    this._swayY = damp(this._swayY, swayTargetY, 10, dt);

    this._updateTransform(dt);

    this.reticle.material.opacity = this.ads > 0.5 ? 0.95 : 0;
    const timeSinceShot = this.time - this.lastFireTime;
    if (timeSinceShot > 0.25) this.spreadBloom = damp(this.spreadBloom, 0, 8, dt);
    this._updateReloadAnimation(dt);
  }

  _updateSmoke(dt) {
    for (const puff of this.smokePuffs) {
      if (puff.life > 0) {
        puff.life -= dt;
        puff.mesh.position.add(puff.velocity);
        puff.velocity.x *= 0.97;
        puff.velocity.z *= 0.97;
        puff.mesh.material.opacity = Math.max(0, puff.life / 0.7) * 0.2;
        puff.mesh.scale.multiplyScalar(1 + dt * 1.8);
        if (puff.life <= 0) puff.mesh.visible = false;
      }
    }
  }

  _updateReloadAnimation(dt) {
    if (!this.reloading) {
      this.magazine.position.y = damp(this.magazine.position.y, -0.096, 20, dt);
      this.magazine.position.x = damp(this.magazine.position.x, 0, 20, dt);
      this.magazine.rotation.x = damp(this.magazine.rotation.x, -0.12, 20, dt);
      this.charging.position.z = damp(this.charging.position.z, 0.145, 18, dt);
      this.trigger.rotation.x = damp(this.trigger.rotation.x, 0, 14, dt);
      return;
    }
    const t = clamp(this.reloadTime / this.reloadDuration, 0, 1);
    // main mag drops away around 0.2-0.45, spare comes up
    if (t < 0.18) {
      this.magazine.position.y = -0.096;
    } else if (t < 0.48) {
      const p = (t - 0.18) / 0.3;
      this.magazine.position.y = -0.096 - p * 0.28;
      this.magazine.rotation.x = -0.12 - p * 0.5;
    } else if (t < 0.62) {
      this.magazine.position.y = -0.35;
    } else {
      const p = clamp((t - 0.62) / 0.24, 0, 1);
      this.magazine.position.y = -0.35 + p * 0.254;
      this.magazine.rotation.x = -0.62 + p * 0.5;
    }

    if (t > 0.5 && t < 0.88) {
      const p = (t - 0.5) / 0.38;
      this.spareMagazine.visible = true;
      this.spareMagazine.position.set(0.08 * (1 - p), -0.36 + p * 0.27, 0.04 + p * 0.02);
      this.spareMagazine.rotation.set(-0.12, 0, -0.3 * (1 - p));
    } else {
      this.spareMagazine.visible = false;
    }

    // charging handle pull near end
    if (t > 0.72) {
      const p = Math.sin(clamp((t - 0.72) / 0.24, 0, 1) * Math.PI);
      this.charging.position.z = 0.145 + p * 0.075;
    } else {
      this.charging.position.z = 0.145;
    }
  }

  _setHipTransform(dt) {
    const swayX = this._swayX || 0;
    const swayY = this._swayY || 0;
    const bob = this.player.walkPhase || 0;
    const speed = clamp((this.player.speed || 0) / CONFIG.player.walkSpeed, 0, 1.4);
    const bobX = Math.cos(bob) * 0.012 * speed;
    const bobY = -Math.abs(Math.sin(bob)) * 0.012 * speed;
    const breathe = Math.sin(this.time * 1.6) * 0.0025;
    const sprint = this._sprintBlend;
    this.gunRoot.position.set(
      0.166 + bobX + swayX * 0.8 + sprint * 0.04,
      -0.124 + bobY + swayY * 0.7 + breathe - sprint * 0.09,
      -0.640 + sprint * 0.05 - this.recoil * 0.035
    );
    this.gunRoot.rotation.set(
      -this.recoil * 0.055 + sprint * 0.18 + swayY * 0.4,
      -0.045 + swayX * 0.6 + sprint * 0.22,
      -0.02 + swayX * 0.8 + sprint * 0.18 + Math.cos(bob) * 0.012 * speed
    );
  }

  _updateTransform(dt) {
    const ads = this.ads;
    const sprint = this._sprintBlend;
    const bob = this.player.walkPhase || 0;
    const speed = clamp((this.player.speed || 0) / CONFIG.player.walkSpeed, 0, 1.4);
    const hipX = 0.166 + Math.cos(bob) * 0.012 * speed;
    const hipY = -0.124 - Math.abs(Math.sin(bob)) * 0.012 * speed;
    const hipZ = -0.640;
    // ADS: solve the pose so the holographic reticle projects to screen centre.
    const gunScale = this.gun ? this.gun.scale.x : 0.8;
    const sight = this.sightLocal || { x: 0, y: 0.219 };
    const adsX = -sight.x * gunScale;
    const adsY = -sight.y * gunScale;
    const adsZ = -0.52;
    const breathe = Math.sin(this.time * 1.6) * 0.0025 * (1 - ads * 0.7);
    const reloadPose = this.reloading ? Math.sin(clamp(this.reloadTime / this.reloadDuration, 0, 1) * Math.PI) : 0;
    const stance = 1 - ads;
    // Sway is damped hard while aiming so the dot stays glued to the crosshair.
    const sway = 1 - ads * 0.92;

    this.gunRoot.position.set(
      hipX * stance + adsX * ads + this._swayX * 0.8 * sway + sprint * 0.04,
      (hipY + breathe) * stance + adsY * ads - this.recoil * 0.02 * stance + this._swayY * 0.7 * sway - sprint * 0.09 - reloadPose * 0.05,
      hipZ + (adsZ - hipZ) * ads - this.recoil * 0.04 + sprint * 0.05 + reloadPose * 0.01
    );
    this.gunRoot.rotation.set(
      (-this.recoil * 0.055) * stance + this._swayY * 0.4 * sway + sprint * 0.18 + reloadPose * 0.16,
      (0.060 + this._swayX * 0.6) * stance + sprint * 0.22 - reloadPose * 0.22,
      (-0.02 + this._swayX * 0.8) * stance + sprint * 0.18 + reloadPose * 0.3
    );

    // ---- weapon convergence ------------------------------------------------
    // Hip fire leaves the gun visibly angled while the hitscan goes dead centre,
    // which reads as "the bullet does not leave the barrel". Rotate the whole
    // viewmodel so the barrel axis points at the crosshair (blended out while
    // aiming, where the optic must stay perfectly centred).
    if (stance > 0.001 && !this.reloading) {
      const gunScale = this.gun ? this.gun.scale.x : 0.62;
      _convQuat.setFromEuler(this.gunRoot.rotation);
      _muzzleOff.set(0, 0.03, -0.92).multiplyScalar(gunScale).applyQuaternion(_convQuat).add(this.gunRoot.position);
      _barrelDir.set(0, 0, -1).applyQuaternion(_convQuat);
      _aimPoint.set(0, 0, -45).sub(_muzzleOff).normalize();
      let dYaw = Math.atan2(-_aimPoint.x, -_aimPoint.z) - Math.atan2(-_barrelDir.x, -_barrelDir.z);
      if (dYaw > Math.PI) dYaw -= Math.PI * 2;
      if (dYaw < -Math.PI) dYaw += Math.PI * 2;
      let dPitch = Math.asin(clamp(_aimPoint.y, -1, 1)) - Math.asin(clamp(_barrelDir.y, -1, 1));
      // keep the correction subtle so extreme pitches don't twist the viewmodel
      dYaw = clamp(dYaw, -0.14, 0.14);
      dPitch = clamp(dPitch, -0.10, 0.10);
      this.gunRoot.rotation.y += dYaw * stance;
      this.gunRoot.rotation.x += dPitch * stance;
    }
    this.viewCamera.fov = damp(this.viewCamera.fov, ads > 0.5 ? 42 : 54, 14, dt);
    this.viewCamera.updateProjectionMatrix();

    // bolt/trigger animation: recoil cycles the visible bolt
    const boltBack = Math.min(1, this._boltKick * 1.4);
    this.bolt.position.z = -0.005 + boltBack * 0.03;
    this.bolt.position.x = 0.055 + boltBack * 0.005;
  }

  getState() {
    return {
      weapon: 'VXR-7',
      mag: this.mag,
      magSize: this.magSize,
      reserve: this.reserve,
      reloading: this.reloading,
      reloadProgress: this.reloading ? clamp(this.reloadTime / this.reloadDuration, 0, 1) : 0,
      ads: this.ads > 0.5,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      damageMultiplier: this.damageMultiplier,
      magExtension: this.magExtension,
      reloadBonus: 1 - this.reloadSpeedMul,
      reloadTime: this.reloadDuration,
    };
  }

  setAspect(aspect) {
    this.viewCamera.aspect = aspect;
    this.viewCamera.updateProjectionMatrix();
  }

  render(renderer) {
    if (!this.active) return;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.clearDepth();
    renderer.render(this.viewScene, this.viewCamera);
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('blur', this._onBlur);
  }
}
