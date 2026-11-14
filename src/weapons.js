/**
 * Multi-weapon first-person weapon system.
 *
 * Owns up to `MAX_WEAPON_SLOTS` carried weapons (starting with the VXR-7). Each
 * weapon keeps its own magazine / reserve / upgrade numbers from
 * `src/config/weapons.js`, its own lazily-built held viewmodel from the weapon
 * model registry (`src/models/weapons/index.js`) and its own firing mode:
 *
 *   auto     hitscan rifle (VXR-7) — recoil, bloom, spread
 *   rocket   pooled projectile with per-frame segment raycasts + splash (RPG-7)
 *   pump     pellet spread with distance falloff, one shot per trigger pull
 *   spinup   spinning gatling: spin 0→1, then fires at rpm (M-77)
 *
 * Everything behavioural (input, ADS/hip transform, sway, firing, reload
 * timing, recoil, audio, raycasts, viewmodel switching) stays in this file; the
 * model modules only build geometry/materials/handles.
 *
 * Viewmodel rig per weapon (built once, toggled on switch):
 *   gunRoot > gun(heldScale) > { weaponRoot, handsRoot }
 *
 * The single muzzle flash light and the reticle are re-parented / re-pointed to
 * the active rig, so the switch is only a visibility toggle plus an animation.
 */
import * as THREE from 'three';
import { CONFIG } from './config/index.js';
import { emit } from './bus.js';
import { clamp, damp, rand, canvasTexture } from './utils.js';
// Weapon stat blocks + inventory rules are the single source of truth for ammo,
// damage, spread and firing modes.
import {
  DEFAULT_WEAPON_ID,
  MAX_WEAPON_SLOTS,
  WEAPON_ORDER,
  WEAPON_STATS,
  convertSupplyAmmo,
  getWeaponStats,
  weaponSlotIndex,
} from './config/weapons.js';
// Model registry: resolves a weapon type's material / weapon / hands builders.
// Unknown types are handled gracefully (the gun still works, just without a
// viewmodel) so the system boots while parallel model work is still landing.
import { getWeaponType } from './models/weapons/index.js';

/** Draw animation: lower the old gun, swap at the midpoint, raise the new one. */
const SWITCH_TIME = 0.25;
/** `weapon:slots` rate limit (contract: at most 10 Hz). */
const SLOTS_EMIT_INTERVAL_MS = 100;
/** Reload audio cue positions, as fractions of the total reload time. */
const RELOAD_CUES = Object.freeze({ magOut: 0.14, magIn: 0.42, bolt: 0.72 });
/**
 * Upgrade clamps. `magExtensionMax` is the loot ceiling stacked on top of a
 * weapon's own base magazine: the VXR-7 therefore tops out at the familiar
 * 30 + 90 = 120 rounds, while high-capacity weapons keep their base capacity
 * (the M-77 belt is 200 → up to 290 with full loot).
 */
const UPGRADE = Object.freeze({
  magExtensionMax: 90,
  damageMin: 1,
  damageMax: 4,
  reloadMulMin: 0.35,
  reloadMulMax: 1,
  reloadMinTime: 0.55,
  ammoBoostGain: 0.01,
  reloadGainMin: 0.01,
  reloadGainMax: 0.6,
});
/** Reload / pump animation offsets, relative to each rig's captured base pose. */
const POSE = Object.freeze({
  magDrop: 0.254,
  magDropRot: 0.5,
  chargePull: 0.075,
  pumpTravel: 0.075,
  boltKickZ: 0.03,
  boltKickX: 0.005,
  recoilRot: 0.35,
});
/** Hip pose of the held frame (default; a weapon may override it with
 *  `stats.viewmodel.hip`, see CONTRACT §5 — models share the held frame). */
const HIP = Object.freeze({ x: 0.166, y: -0.124, z: -0.64 });
/** Full-ADS forward offset of the held frame (default; per-weapon override via
 *  `stats.viewmodel.ads.z`). The x/y anchor normally comes from the model's
 *  `sightLocal`, so the optic stays zeroed to the crosshair; a config override
 *  may reposition it (then the ADS zero is intentionally shifted too). */
const ADS_Z = -0.52;
const HIP_ROLL = -0.02;
/** Default ADS sight offset when a model does not supply `sightLocal`. */
const DEFAULT_SIGHT = Object.freeze({ x: 0, y: 0.14 });
/** Default muzzle position (held frame) when a model does not supply one. */
const DEFAULT_MUZZLE_LOCAL = Object.freeze({ x: 0, y: 0.03, z: -0.9 });
/** Weapon id → GameAudio.shot() variant kind (rifle is the default fallback). */
const SHOT_KIND = Object.freeze({ vxr7: 'rifle', gatling: 'gatling', shotgun: 'shotgun', rpg: 'rocket' });
/** Pooled rocket projectiles (a player can have at most a handful in the air). */
const ROCKET_POOL_SIZE = 4;
/** Shared forward axis used to orient a pool rocket along its velocity. */
const ROCKET_FORWARD = new THREE.Vector3(0, 0, -1);

// Scratch objects for the per-frame viewmodel convergence solve.
const _convQuat = new THREE.Quaternion();
const _muzzleOff = new THREE.Vector3();
const _barrelDir = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _defaultMuzzle = new THREE.Vector3(
  DEFAULT_MUZZLE_LOCAL.x, DEFAULT_MUZZLE_LOCAL.y, DEFAULT_MUZZLE_LOCAL.z,
);

/** Capture the rest pose of every animatable handle so animations stay
 *  base-relative and can be authored for any weapon model. */
function captureHandleBase(handles) {
  const base = {};
  for (const key of ['magazine', 'spareMagazine', 'charging', 'bolt', 'trigger', 'pump', 'barrels', 'rocket']) {
    const obj = handles ? handles[key] : null;
    if (!obj) continue;
    base[key] = {
      position: obj.position.clone(),
      rotation: obj.rotation.clone(),
      visible: obj.visible,
    };
  }
  return base;
}

/** Collect the GPU resources owned by one held rig (deduped by Set). */
function collectRigDisposables(root, mats) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((obj) => {
    if (obj.geometry) geometries.add(obj.geometry);
    const list = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    for (const material of list) materials.add(material);
  });
  if (mats) for (const material of Object.values(mats)) if (material) materials.add(material);
  for (const material of materials) {
    for (const key of Object.keys(material)) {
      const value = material[key];
      if (value && value.isTexture) textures.add(value);
    }
  }
  return { geometries, materials, textures };
}

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
    this._disposed = false;

    // --- inventory: type id -> per-weapon runtime slot ----------------------
    // Only owned weapons have slots; WEAPON_ORDER fixes the HUD/key order.
    this._slots = new Map();
    this._slots.set(DEFAULT_WEAPON_ID, this._createSlot(DEFAULT_WEAPON_ID));
    this._activeType = DEFAULT_WEAPON_ID;
    this._rigs = new Map();
    this._rigErrors = new Set();
    this._activeRig = null;
    this._rigBase = {};

    // --- trigger / fire state ----------------------------------------------
    this.triggerDown = false;
    this.aiming = false;
    this.ads = 0;
    this.fireCooldown = 0;
    this.lastFireTime = -999;
    this.spreadBloom = 0;
    this.recoil = 0;
    this._boltKick = 0;

    // --- reload state -------------------------------------------------------
    this.reloading = false;
    this.reloadTime = 0;
    this._reloadPlayed = new Set();

    // --- mode state ---------------------------------------------------------
    this.spin = 0;
    this._barrelAngle = 0;
    this._pumpTimer = 0;
    this._pumpDuration = 0;
    this._spinSoundOn = false;

    // --- presentation state -------------------------------------------------
    this.time = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this._prevYaw = player ? player.yaw : 0;
    this._prevPitch = player ? player.pitch : 0;
    this._swayX = 0;
    this._swayY = 0;
    this._sprintBlend = 0;
    this._muzzleTimer = 0;
    this._switchT = 0;
    this._pendingRig = null;
    this._oldRig = null;
    this._dryTimer = 0;
    this._noticeTimer = 0;
    this.flashMats = [];

    // --- events / warnings --------------------------------------------------
    this._lastSlotsAt = -Infinity;
    this._warnedDamageArea = false;

    // --- firing scratch objects --------------------------------------------
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 280;
    this._targets = [];
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._end = new THREE.Vector3();
    this._fallbackDir = new THREE.Vector3();
    this._muzzleView = new THREE.Vector3();
    this._muzzleNdc = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();
    this._ejectView = new THREE.Vector3();
    this._ejectWorld = new THREE.Vector3();
    this._ejectVel = new THREE.Vector3();
    this._ejectJitter = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._hitNormal = new THREE.Vector3();
    this._normalMatrix = new THREE.Matrix3();
    this._rocketPrev = new THREE.Vector3();
    this._rocketNext = new THREE.Vector3();
    this._rocketDir = new THREE.Vector3();
    this._projOrigin = new THREE.Vector3();

    // --- pooled rocket projectiles -----------------------------------------
    this._rockets = [];
    this._projectileRoot = null;
    this._projectileAssets = null;

    this._buildScene(environment);
    this._buildProjectilePool();
    this._equipType(this._activeType);
    this._updateTransform(0);
    this._bindInput();
    this._emitSlots(true);
  }

  // ===========================================================================
  // Inventory accessors (the legacy flat fields proxy the ACTIVE weapon so old
  // callers — main.js / gamepad.js / touch.js / QA scripts — keep working).
  // ===========================================================================

  /** Active per-weapon runtime slot (null only before the first slot exists). */
  get activeSlot() {
    return this._slots.get(this._activeType) || null;
  }

  get activeType() {
    return this._activeType;
  }

  get weaponType() {
    return this._activeType;
  }

  get weaponMode() {
    return this._stats.mode;
  }

  get weaponName() {
    return this._stats.short;
  }

  get weapon() {
    return this._stats.short;
  }

  /** Stats block of the active weapon. */
  get _stats() {
    return getWeaponStats(this._activeType);
  }

  get mag() {
    const slot = this.activeSlot;
    return slot ? slot.mag : 0;
  }

  set mag(value) {
    const slot = this.activeSlot;
    if (slot) slot.mag = clamp(Math.round(Number(value) || 0), 0, slot.magSize);
  }

  get magSize() {
    const slot = this.activeSlot;
    return slot ? slot.magSize : 0;
  }

  get reserve() {
    const slot = this.activeSlot;
    return slot ? slot.reserve : 0;
  }

  set reserve(value) {
    const slot = this.activeSlot;
    if (slot) slot.reserve = clamp(Math.round(Number(value) || 0), 0, slot.reserveMax);
  }

  get reserveMax() {
    const slot = this.activeSlot;
    return slot ? slot.reserveMax : 0;
  }

  get damageMultiplier() {
    const slot = this.activeSlot;
    return slot ? slot.damageMultiplier : 1;
  }

  get magExtension() {
    const slot = this.activeSlot;
    return slot ? slot.magExtension : 0;
  }

  get reloadSpeedMul() {
    const slot = this.activeSlot;
    return slot ? slot.reloadSpeedMul : 1;
  }

  /** Loot bonus read by the HUD (1 - reloadSpeedMul). */
  get reloadBonus() {
    return 1 - this.reloadSpeedMul;
  }

  /** Current active-weapon reload duration after the reload-speed upgrade. */
  get reloadDuration() {
    const slot = this.activeSlot;
    if (!slot) return 0;
    return Math.max(UPGRADE.reloadMinTime, slot.stats.reloadTime * slot.reloadSpeedMul);
  }

  get slotIndex() {
    return weaponSlotIndex(this._activeType);
  }

  // ===========================================================================
  // View-model scene
  // ===========================================================================
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

    // The muzzle flash light is shared by all rigs and re-parented on switch.
    this.muzzleLight = new THREE.PointLight(0xffa34a, 0, 4.5, 2);
    this.viewScene.add(this.muzzleLight);
  }

  // ===========================================================================
  // Held-rig construction / equipping
  // ===========================================================================

  /**
   * Build one weapon's held rig once (lazy, first time the weapon is equipped).
   * Unknown / not-yet-implemented model types are logged once and ignored: the
   * weapon keeps working (data + firing) without a viewmodel.
   */
  _ensureRig(typeId) {
    if (this._rigs.has(typeId)) return this._rigs.get(typeId);
    if (this._rigErrors.has(typeId)) return null;
    let rig = null;
    try {
      rig = this._buildRig(typeId);
    } catch (error) {
      this._rigErrors.add(typeId);
      console.warn(
        `[weapons] viewmodel for '${typeId}' is unavailable — weapon remains usable without a model`,
        error,
      );
    }
    if (rig) this._rigs.set(typeId, rig);
    return rig;
  }

  _buildRig(typeId) {
    const type = getWeaponType(typeId);
    if (!type || typeof type.buildWeapon !== 'function' || typeof type.createMaterials !== 'function') {
      throw new Error(`[weapons] registry entry for '${typeId}' is incomplete`);
    }
    const mats = type.createMaterials();
    const gunRoot = new THREE.Group();
    gunRoot.name = `gunRoot:${typeId}`;
    const gun = new THREE.Group();
    gun.name = 'heldFrame';
    gun.scale.setScalar(Number(type.heldScale) || 1);
    gunRoot.add(gun);

    const handles = type.buildWeapon({ mats, muzzleLight: null }) || {};
    const weaponRoot = handles.root || new THREE.Group();
    gun.add(weaponRoot);

    let handsRoot = null;
    if (typeof type.buildHands === 'function') {
      const hands = type.buildHands({ mats });
      if (hands && hands.root) {
        handsRoot = hands.root;
        gun.add(handsRoot);
      }
    }

    gunRoot.visible = false;
    this.viewScene.add(gunRoot);

    return {
      typeId,
      gunRoot,
      gun,
      weaponRoot,
      handsRoot,
      mats,
      handles,
      base: captureHandleBase(handles),
      barrelAngle: 0,
    };
  }

  /** Hide every rig, show (and build if needed) the requested one, bind handles. */
  _equipType(typeId) {
    for (const rig of this._rigs.values()) rig.gunRoot.visible = false;
    this._activeType = typeId;
    const rig = this._ensureRig(typeId);
    if (rig) rig.gunRoot.visible = true;
    this._applyHandles(rig);
    this._attachMuzzleLight(rig);
    this.reloading = false;
    this.reloadTime = 0;
    this.triggerDown = false;
    this.aiming = false;
    this.spin = 0;
    this._setSpinSound(false);
    this.fireCooldown = 0;
    this._pumpTimer = 0;
    this._resetRigPose(typeId);
    this._syncRocketHandle();
    if (this.player) this.player.adsFov = this._stats.adsFov;
  }

  /** Point the flat handle fields at the active rig (all optional handles null). */
  _applyHandles(rig) {
    const h = (rig && rig.handles) || {};
    this._activeRig = rig || null;
    this._rigBase = (rig && rig.base) || {};
    this.gunRoot = rig ? rig.gunRoot : null;
    this.gun = rig ? rig.gun : null;
    this.weaponRoot = rig ? rig.weaponRoot : null;
    this.handsRoot = rig ? rig.handsRoot : null;
    this.magazine = h.magazine || null;
    this.spareMagazine = h.spareMagazine || null;
    this.bolt = h.bolt || null;
    this.charging = h.charging || null;
    this.trigger = h.trigger || null;
    this.reticle = h.reticle || null;
    this.flashGroup = h.flashGroup || null;
    this.flashMats = Array.isArray(h.flashMats) ? h.flashMats : [];
    this.muzzleLocal = h.muzzleLocal || null;
    this.sightLocal = h.sightLocal || DEFAULT_SIGHT;
    this.barrels = h.barrels || null;
    this.pump = h.pump || null;
    this.loadedRocket = h.rocket || null;
  }

  /** Re-parent the shared muzzle flash light under the active rig. */
  _attachMuzzleLight(rig) {
    if (!this.muzzleLight) return;
    const handles = rig ? rig.handles : null;
    const flashGroup = (handles && handles.flashGroup) || null;
    this.muzzleLight.removeFromParent();
    if (flashGroup) {
      // The flash rig already sits at the muzzle in held-frame space.
      this.muzzleLight.position.set(0, 0, -0.02);
      flashGroup.add(this.muzzleLight);
    } else if (rig && rig.gun) {
      if (handles && handles.muzzleLocal) this.muzzleLight.position.copy(handles.muzzleLocal);
      else this.muzzleLight.position.set(0, 0.03, -0.9);
      rig.gun.add(this.muzzleLight);
    } else {
      this.muzzleLight.position.set(0, 0.03, -0.9);
      this.viewScene.add(this.muzzleLight);
    }
    this.muzzleLight.intensity = 0;
  }

  /** Restore the rest pose of the rig's animatable handles. */
  _resetRigPose(typeId) {
    const rig = this._rigs.get(typeId);
    if (!rig) return;
    const base = rig.base;
    const handles = rig.handles || {};
    for (const key of ['magazine', 'charging', 'bolt', 'trigger', 'pump']) {
      const obj = handles[key];
      const rest = base[key];
      if (!obj || !rest) continue;
      obj.position.copy(rest.position);
      obj.rotation.copy(rest.rotation);
    }
    if (handles.spareMagazine) handles.spareMagazine.visible = false;
    if (handles.barrels && base.barrels) {
      handles.barrels.rotation.copy(base.barrels.rotation);
    }
    rig.barrelAngle = 0;
    if (rig === this._activeRig) this._barrelAngle = 0;
    const slot = this._slots.get(typeId);
    if (handles.rocket) handles.rocket.visible = !!(slot && slot.mag > 0);
    this._resetFlash();
  }

  /** Hide/show the loaded rocket of the active RPG based on ammo + reload state. */
  _syncRocketHandle() {
    if (!this.loadedRocket) return;
    this.loadedRocket.visible = this.mag > 0 && !this.reloading;
  }

  _resetFlash() {
    this._muzzleTimer = 0;
    const mats = this.flashMats || [];
    for (const material of mats) material.opacity = 0;
    if (this.muzzleLight) this.muzzleLight.intensity = 0;
  }

  /** Remove one rig from the scene and free its GPU resources. */
  _releaseRig(typeId) {
    const rig = this._rigs.get(typeId);
    if (!rig) return;
    this._rigs.delete(typeId);
    if (this.muzzleLight) this.muzzleLight.removeFromParent();
    this._disposeRigResources(rig);
    if (this._activeRig === rig) {
      this._activeRig = null;
      this._rigBase = {};
    }
  }

  _disposeRigResources(rig) {
    if (!rig || rig.disposed) return;
    rig.disposed = true;
    const { geometries, materials, textures } = collectRigDisposables(rig.gunRoot, rig.mats);
    rig.gunRoot.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
  }

  // ===========================================================================
  // Input
  // ===========================================================================
  _bindInput() {
    this._onMouseDown = (event) => {
      if (!this.active || this.touchMode || this._disposed) return;
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
      if (!this.active || this._disposed) return;
      if (event.code === 'KeyR') {
        if (!event.repeat) this.startReload();
        return;
      }
      if (event.code === 'KeyQ') {
        if (!event.repeat) this.cycleWeapon(-1);
        return;
      }
      if (event.code === 'KeyE') {
        if (!event.repeat) this.cycleWeapon(1);
        return;
      }
      // Digit1..Digit4 select the weapon in the stable WEAPON_ORDER slot list.
      const digit = /^Digit([1-4])$/.exec(event.code);
      if (digit) this.switchWeapon(Number(digit[1]) - 1);
    };
    this._onWheel = (event) => {
      if (!this.active || this.touchMode || this._disposed) return;
      if (document.pointerLockElement !== this.canvas) return;
      this.cycleWeapon(event.deltaY > 0 ? 1 : -1);
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
    document.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('blur', this._onBlur);
  }

  setActive(active) {
    this.active = active;
    this.triggerDown = false;
    this.aiming = false;
    this.spin = 0;
    this._setSpinSound(false);
    if (this.player) this.player.aiming = false;
    if (!active) {
      this._resetFlash();
    } else {
      if (this.player) {
        this._prevYaw = this.player.yaw;
        this._prevPitch = this.player.pitch;
      }
      this._emitSlots(true);
    }
  }

  /** Virtual (touch) trigger: press fires immediately, release stops automatic fire. */
  setTrigger(down) {
    const pressed = !!down;
    if (pressed === this.triggerDown) return;
    this.triggerDown = pressed;
    if (pressed) this.tryFire();
  }

  /** Virtual (touch/gamepad) aim-down-sights, same field the right mouse button drives. */
  setAiming(aiming) {
    this.aiming = !!aiming;
    if (!this.aiming && this.player) this.player.aiming = false;
  }

  /** Touch mode: mouse button input belongs to the touch layer. */
  setTouchMode(enabled = true) {
    this.touchMode = !!enabled;
    if (this.touchMode) {
      this.triggerDown = false;
      this.aiming = false;
    }
  }

  // ===========================================================================
  // Inventory API
  // ===========================================================================

  /** Resolve a slot index (0-based into WEAPON_ORDER), type id or catalog id. */
  _resolveType(indexOrType) {
    if (typeof indexOrType === 'number' && Number.isFinite(indexOrType)) {
      const index = Math.trunc(indexOrType);
      if (index >= 0 && index < WEAPON_ORDER.length) return WEAPON_ORDER[index];
      return null;
    }
    if (typeof indexOrType !== 'string' || !indexOrType) return null;
    if (WEAPON_STATS[indexOrType]) return indexOrType;
    const bare = indexOrType.startsWith('weapon-') ? indexOrType.slice(7) : indexOrType;
    if (WEAPON_STATS[bare]) return bare;
    try {
      const type = getWeaponType(indexOrType);
      if (type && WEAPON_STATS[type.id]) return type.id;
    } catch {
      /* not in the model registry (yet) */
    }
    return null;
  }

  _createSlot(typeId) {
    const stats = getWeaponStats(typeId);
    return {
      type: typeId,
      stats,
      mag: stats.magSize,
      magSize: stats.magSize,
      reserve: stats.reserveStart,
      reserveMax: stats.reserveMax,
      magExtension: 0,
      damageMultiplier: 1,
      reloadSpeedMul: 1,
    };
  }

  _recomputeMagSize(slot) {
    // Per-weapon capacity = base magazine + loot extension (the extension is
    // itself clamped to UPGRADE.magExtensionMax by every caller). A global
    // absolute cap must never be applied here: it shrank the 200-round M-77
    // belt to 120 after importProgression / addMagCapacity / resetUpgrades.
    slot.magSize = slot.stats.magSize + clamp(slot.magExtension, 0, UPGRADE.magExtensionMax);
    slot.mag = Math.min(slot.mag, slot.magSize);
  }

  /** Per-weapon HUD slots in the stable WEAPON_ORDER (1-key order). */
  getSlots() {
    return WEAPON_ORDER.map((type, index) => {
      const stats = getWeaponStats(type);
      const slot = this._slots.get(type);
      const owned = !!slot;
      return {
        type,
        name: stats.name,
        short: stats.short,
        owned,
        active: owned && type === this._activeType,
        mag: owned ? slot.mag : 0,
        magSize: owned ? slot.magSize : stats.magSize,
        reserve: owned ? slot.reserve : 0,
        slot: index + 1,
      };
    });
  }

  /**
   * Add a weapon to the inventory. Already owned → refill its reserve ammo and
   * report `added:false`. Inventory full → the ACTIVE weapon is dropped and
   * replaced by the new one (boss drops only appear once every gun is owned in
   * a later config, but the rule keeps the inventory bounded).
   *
   * @returns {{ added:boolean, replacedType:string|null, slotIndex:number }}
   */
  addWeapon(typeId) {
    const type = this._resolveType(typeId);
    if (!type) return { added: false, replacedType: null, slotIndex: -1 };
    const index = weaponSlotIndex(type);
    if (this._slots.has(type)) {
      const slot = this._slots.get(type);
      slot.reserve = slot.reserveMax;
      this._emitSlots(true);
      return { added: false, replacedType: null, slotIndex: index };
    }
    if (this._slots.size >= MAX_WEAPON_SLOTS) {
      // Drop the weapon currently in hand and replace its slot.
      const replacedType = this._activeType;
      this._releaseRig(replacedType);
      this._slots.delete(replacedType);
      this._slots.set(type, this._createSlot(type));
      this._switchT = 0;
      this._pendingRig = null;
      this._oldRig = null;
      this._equipType(type);
      const stats = this._stats;
      emit('weapon:switched', { type, name: stats.name, index });
      this._emitSlots(true);
      return { added: true, replacedType, slotIndex: index };
    }
    this._slots.set(type, this._createSlot(type));
    this._emitSlots(true);
    return { added: true, replacedType: null, slotIndex: index };
  }

  /**
   * Switch to a weapon by 0-based WEAPON_ORDER index / type id / catalog id.
   * Cancels reload, trigger and aim, plays a 0.25 s lower→raise draw animation
   * and refuses to fire until it completes.
   */
  switchWeapon(indexOrType) {
    if (this._disposed) return false;
    const type = this._resolveType(indexOrType);
    if (!type || !this._slots.has(type)) return false;
    if (type === this._activeType && this._switchT <= 0) return true;
    this._beginSwitch(type);
    return true;
  }

  _beginSwitch(type) {
    // Cancel the in-flight draw, if any, before starting a fresh one.
    if (this._switchT > 0) {
      this._doubleCommit();
    }
    this.reloading = false;
    this.reloadTime = 0;
    this._reloadPlayed.clear();
    this.triggerDown = false;
    this.aiming = false;
    this.spin = 0;
    this._setSpinSound(false);
    this.fireCooldown = 0;
    this._pumpTimer = 0;
    this.spreadBloom = 0;
    if (this.player) {
      this.player.aiming = false;
      this.player.adsFov = getWeaponStats(type).adsFov;
    }
    const nextIndex = weaponSlotIndex(type);
    const oldRig = this._activeRig;
    this._oldRig = oldRig;
    this._activeType = type;
    this._pendingRig = this._ensureRig(type);
    this._switchT = SWITCH_TIME;
    const stats = this._stats;
    this._emitSlots(true);
    emit('weapon:switched', { type, name: stats.name, index: nextIndex });
  }

  /** Finish any pending draw immediately (used when a second switch interrupts). */
  _doubleCommit() {
    this._switchT = 0;
    if (this._pendingRig) this._commitSwap();
  }

  _commitSwap() {
    const rig = this._pendingRig || this._ensureRig(this._activeType);
    this._pendingRig = null;
    if (this._oldRig && this._oldRig !== rig) this._oldRig.gunRoot.visible = false;
    this._oldRig = null;
    if (rig) rig.gunRoot.visible = true;
    this._applyHandles(rig);
    this._attachMuzzleLight(rig);
    this._resetRigPose(this._activeType);
    this._syncRocketHandle();
    this.spin = 0;
  }

  /** Cycle through owned weapons in the stable slot order. */
  cycleWeapon(dir = 1) {
    const owned = WEAPON_ORDER.filter((type) => this._slots.has(type));
    if (owned.length <= 1) return false;
    const step = dir >= 0 ? 1 : -1;
    const current = owned.indexOf(this._activeType);
    const next = owned[(current + step + owned.length) % owned.length];
    if (!next || next === this._activeType) return false;
    this.switchWeapon(next);
    return next;
  }

  /** Progression used by the stage save system (per-weapon upgrades + inventory). */
  exportProgression() {
    const perWeapon = {};
    for (const type of WEAPON_ORDER) {
      const slot = this._slots.get(type);
      if (!slot) continue;
      perWeapon[type] = {
        magExtension: slot.magExtension,
        damageMultiplier: slot.damageMultiplier,
        reloadSpeedMul: slot.reloadSpeedMul,
      };
    }
    return {
      owned: WEAPON_ORDER.filter((type) => this._slots.has(type)),
      active: this._activeType,
      perWeapon,
    };
  }

  /** Restore a `save.runState.weapons` progression snapshot (or legacy upgrades). */
  importProgression(data) {
    if (!data || typeof data !== 'object') return false;
    // Legacy upgrade snapshot (pre-inventory format) — apply to the active gun.
    if (!Array.isArray(data.owned) && !data.perWeapon) {
      this.importUpgrades(data);
      return true;
    }
    const owned = [];
    const candidates = Array.isArray(data.owned) ? data.owned : [];
    for (const raw of candidates) {
      const type = this._resolveType(raw);
      if (!type || owned.includes(type)) continue;
      owned.push(type);
      if (owned.length >= MAX_WEAPON_SLOTS) break;
    }
    if (!owned.includes(DEFAULT_WEAPON_ID)) owned.unshift(DEFAULT_WEAPON_ID);
    if (owned.length > MAX_WEAPON_SLOTS) owned.length = MAX_WEAPON_SLOTS;

    // Drop slots / rigs that are no longer owned.
    for (const type of [...this._slots.keys()]) {
      if (owned.includes(type)) continue;
      this._releaseRig(type);
      this._slots.delete(type);
    }
    // Add newly owned weapons at full ammo (reset() refills the rest).
    for (const type of owned) {
      if (!this._slots.has(type)) this._slots.set(type, this._createSlot(type));
    }
    // Restore per-weapon upgrades.
    const perWeapon = data.perWeapon && typeof data.perWeapon === 'object' ? data.perWeapon : {};
    for (const type of owned) {
      const slot = this._slots.get(type);
      const entry = perWeapon[type] || {};
      slot.magExtension = clamp(Math.round(Number(entry.magExtension) || 0), 0, UPGRADE.magExtensionMax);
      slot.damageMultiplier = clamp(Number(entry.damageMultiplier) || UPGRADE.damageMin, UPGRADE.damageMin, UPGRADE.damageMax);
      slot.reloadSpeedMul = clamp(Number(entry.reloadSpeedMul) || UPGRADE.reloadMulMax, UPGRADE.reloadMulMin, UPGRADE.reloadMulMax);
      this._recomputeMagSize(slot);
      slot.reserve = Math.min(slot.reserve, slot.reserveMax);
    }
    const requested = this._resolveType(data.active);
    const target = requested && owned.includes(requested) ? requested : owned[0];
    this._switchT = 0;
    this._pendingRig = null;
    this._oldRig = null;
    this._equipType(target);
    this._emitSlots(true);
    return true;
  }

  // ===========================================================================
  // Ammo / upgrades (all apply to the ACTIVE weapon only, except resetUpgrades)
  // ===========================================================================

  /** Supply ammo cache: `baseAmount` is converted through the weapon's ammoScale. */
  addAmmo(baseAmount) {
    const slot = this.activeSlot;
    if (!slot) return 0;
    const converted = convertSupplyAmmo(this._activeType, baseAmount);
    if (converted <= 0) return slot.reserve;
    slot.reserve = clamp(slot.reserve + converted, 0, slot.reserveMax);
    this._emitSlots();
    return slot.reserve;
  }

  /** Loot: extend the active magazine (and load the extra rounds immediately). */
  addMagCapacity(amount) {
    const slot = this.activeSlot;
    if (!slot) return 0;
    const gain = Math.max(1, Math.round(Number(amount) || 0));
    slot.magExtension = Math.min(UPGRADE.magExtensionMax, slot.magExtension + gain);
    this._recomputeMagSize(slot);
    slot.mag = Math.min(slot.magSize, slot.mag + gain);
    this._emitSlots(true);
    return slot.magSize;
  }

  /** Loot: multiplicative damage growth (5% per pickup by default). */
  addDamageBoost(fraction) {
    const slot = this.activeSlot;
    if (!slot) return 1;
    const gain = Math.max(UPGRADE.ammoBoostGain, Number(fraction) || 0);
    slot.damageMultiplier = Math.min(UPGRADE.damageMax, slot.damageMultiplier * (1 + gain));
    this._emitSlots(true);
    return slot.damageMultiplier;
  }

  /** Loot: faster reloads (12% shorter per pickup, hard floor at 0.55 s). */
  addReloadSpeed(fraction) {
    const slot = this.activeSlot;
    if (!slot) return 0;
    const gain = clamp(Number(fraction) || 0, UPGRADE.reloadGainMin, UPGRADE.reloadGainMax);
    slot.reloadSpeedMul = Math.max(UPGRADE.reloadMulMin, slot.reloadSpeedMul * (1 - gain));
    this._emitSlots(true);
    return this.reloadDuration;
  }

  /** Clear the upgrades of EVERY carried weapon (not the inventory itself). */
  resetUpgrades() {
    for (const slot of this._slots.values()) {
      slot.magExtension = 0;
      slot.damageMultiplier = 1;
      slot.reloadSpeedMul = 1;
      this._recomputeMagSize(slot);
    }
    this._emitSlots(true);
  }

  /** Legacy alias: snapshot of the active weapon's loot upgrades. */
  exportUpgrades() {
    return {
      magExtension: this.magExtension,
      damageMultiplier: this.damageMultiplier,
      reloadSpeedMul: this.reloadSpeedMul,
    };
  }

  /** Legacy alias: restore a loot-upgrade snapshot onto the active weapon. */
  importUpgrades(data) {
    if (!data) return;
    const slot = this.activeSlot;
    if (!slot) return;
    const mag = clamp(Math.round(Number(data.magExtension) || 0), 0, UPGRADE.magExtensionMax);
    slot.magExtension = mag;
    slot.damageMultiplier = clamp(Number(data.damageMultiplier) || 1, UPGRADE.damageMin, UPGRADE.damageMax);
    slot.reloadSpeedMul = clamp(Number(data.reloadSpeedMul) || 1, UPGRADE.reloadMulMin, UPGRADE.reloadMulMax);
    this._recomputeMagSize(slot);
    slot.mag = Math.min(slot.magSize, slot.mag + mag);
    this._emitSlots(true);
  }

  // ===========================================================================
  // Reload
  // ===========================================================================
  startReload() {
    if (this._disposed || !this.active) return;
    const slot = this.activeSlot;
    if (!slot || this.reloading || this._switchT > 0) return;
    if (slot.mag >= slot.magSize) return;
    if (slot.reserve <= 0) {
      if (this._noticeTimer <= 0 && slot.mag <= 0) {
        this._noticeTimer = 1.5;
        emit('weapon:notice', { text: '弹药耗尽 — 等待补给', type: 'warn' });
      }
      return;
    }
    this.reloading = true;
    this.reloadTime = 0;
    this._reloadPlayed.clear();
    this.aiming = false;
    this.triggerDown = false;
    this.spin = 0;
    if (this.player) this.player.aiming = false;
    this.audio?.reloadStart?.();
    this._syncRocketHandle();
    this._emitSlots();
  }

  _finishReload() {
    const slot = this.activeSlot;
    if (!slot) return;
    const need = slot.magSize - slot.mag;
    const take = Math.min(need, slot.reserve);
    slot.mag += take;
    slot.reserve -= take;
    this.reloading = false;
    this.reloadTime = 0;
    this._reloadPlayed.clear();
    this._resetRigPose(this._activeType);
    this._syncRocketHandle();
    this._emitSlots(true);
  }

  _updateReload(dt) {
    if (!this.reloading) return;
    this.reloadTime += dt;
    const duration = Math.max(0.01, this.reloadDuration);
    const t = this.reloadTime;
    if (t > duration * RELOAD_CUES.magOut && !this._reloadPlayed.has('magOut')) {
      this._reloadPlayed.add('magOut');
      this.audio?.reloadMagIn?.();
    }
    if (t > duration * RELOAD_CUES.magIn && !this._reloadPlayed.has('magIn')) {
      this._reloadPlayed.add('magIn');
      this.audio?.reloadMagIn?.();
    }
    if (t > duration * RELOAD_CUES.bolt && !this._reloadPlayed.has('bolt')) {
      this._reloadPlayed.add('bolt');
      this.audio?.reloadBolt?.();
    }
    if (t >= duration) this._finishReload();
  }

  // ===========================================================================
  // Firing
  // ===========================================================================

  /**
   * One trigger action. Automatic modes also call this every frame while the
   * trigger is held; single-shot modes (pump / rocket) only fire on the edge.
   */
  tryFire() {
    if (this._disposed || !this.active) return false;
    if (!this.player || !this.player.alive) return false;
    if (this._switchT > 0 || this.reloading) return false;
    if (this.fireCooldown > 0) return false;
    const slot = this.activeSlot;
    if (!slot) return false;
    const stats = slot.stats;
    if (slot.mag <= 0) {
      if (this._dryTimer <= 0) {
        this._dryTimer = 0.25;
        this.audio?.dryFire?.();
        if (slot.reserve > 0) this.startReload();
      }
      return false;
    }
    if (stats.mode === 'spinup' && this.spin < (stats.spinFireThreshold ?? 0.4)) return false;
    let fired = false;
    switch (stats.mode) {
      case 'rocket':
        fired = this._fireRocket(stats);
        break;
      case 'pump':
        fired = this._firePump(stats);
        break;
      case 'spinup':
      case 'auto':
        fired = this._fireHitscan(stats, stats.mode === 'spinup' ? 0.022 : 0.028);
        break;
      default:
        fired = this._fireHitscan(stats, 0.028);
        break;
    }
    if (fired) this._syncRocketHandle();
    return fired;
  }

  /** Shared ammo/recoil/audio/viewmodel-feedback bookkeeping for one shot. */
  _consumeRound(stats) {
    const slot = this.activeSlot;
    if (slot) slot.mag = Math.max(0, slot.mag - 1);
    this.shotsFired++;
    this.lastFireTime = this.time;
    this.fireCooldown = 60 / Math.max(1, Number(stats.rpm) || 60);
    this._boltKick = 1;
    this.spreadBloom = clamp(
      this.spreadBloom + (stats.spreadMax || 0.05) * 0.28 + (this.ads > 0.5 ? 0.003 : 0),
      0,
      (stats.spreadMax || 0.05) * 1.6,
    );
    const kick = Number(stats.recoil && stats.recoil.kick) || 0.04;
    this.recoil = clamp(this.recoil + 0.6 + kick * 8, 0, 1.8);
    this.player?.addRecoil?.(
      (Number(stats.recoil && stats.recoil.pitch) || 0) * rand(0.75, 1.25),
      (Number(stats.recoil && stats.recoil.yaw) || 0) * rand(-1, 1),
    );
    this.player?.addShake?.(clamp(0.08 + kick * 1.75, 0, 0.6));
    this._playShot();
    this._muzzleFlash(stats.mode === 'rocket' ? 1.6 : 1);
    this._emitSlots();
    emit('weapon:fired', { mag: this.mag, reserve: this.reserve, weapon: this._activeType });
  }

  /**
   * Weapon-specific report. Uses the new `GameAudio.shot(kind)` signature; older
   * audio builds ignore the argument (rifle recipe), so this stays backward
   * compatible without a second call site.
   */
  _playShot() {
    const audio = this.audio;
    if (!audio || typeof audio.shot !== 'function') return;
    try {
      audio.shot(SHOT_KIND[this._activeType] || 'rifle');
    } catch {
      try { audio.shot(); } catch { /* audio is decorative */ }
    }
  }

  /** Gatling spin whir toggling — only fires on state changes, never per frame. */
  _setSpinSound(on) {
    const next = !!on;
    if (next === this._spinSoundOn) return;
    this._spinSoundOn = next;
    try {
      this.audio?.gatlingSpin?.(next);
      if (!next) this.audio?.gatlingSpinRate?.(0);
    } catch {
      /* audio is optional */
    }
  }

  /** Camera-basis snapshot used by every hitscan / projectile shot. */
  _cameraBasis() {
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(this._origin);
    this.camera.getWorldDirection(this._forward);
    this._right.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    this._up.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
  }

  /** A spread ray around the camera forward axis. */
  _spreadDirection(spread, out) {
    const radius = Math.sqrt(Math.random()) * spread;
    const angle = Math.random() * Math.PI * 2;
    out.copy(this._forward)
      .addScaledVector(this._right, Math.cos(angle) * radius)
      .addScaledVector(this._up, Math.sin(angle) * radius)
      .normalize();
    return out;
  }

  /** Raycast helper against the world + enemy hitboxes. */
  _raycast(origin, direction, far) {
    this._raycaster.set(origin, direction);
    this._raycaster.far = far;
    const targets = this._targets;
    targets.length = 0;
    const colliders = this.world && this.world.collideMeshes;
    if (colliders) for (let i = 0; i < colliders.length; i++) targets.push(colliders[i]);
    const hitboxes = this.enemies && this.enemies.raycastTargets;
    if (hitboxes) for (let i = 0; i < hitboxes.length; i++) targets.push(hitboxes[i]);
    if (targets.length === 0) return null;
    const hits = this._raycaster.intersectObjects(targets, true);
    return hits.length ? hits[0] : null;
  }

  /** Walk up from a hit object to the owning enemy node (userData.robot/enemy). */
  _enemyNode(object) {
    let node = object;
    for (let i = 0; node && i < 20; i++) {
      if (node.userData && (node.userData.robot || node.userData.enemy)) return node;
      node = node.parent;
    }
    return null;
  }

  _zoneHeadshot(hit, node) {
    const objectZone = hit.object && hit.object.userData && hit.object.userData.zone;
    const nodeZone = node && node.userData && node.userData.zone;
    return objectZone === 'head' || nodeZone === 'head';
  }

  /** Apply damage to an enemy hit (EnemyManager owns zone multipliers + FX). */
  _damageEnemy(hit, direction, damage, stats, countHit = true) {
    const node = this._enemyNode(hit.object);
    if (!node) {
      this._worldImpact(hit, direction);
      return false;
    }
    if (countHit) this.shotsHit++;
    this.enemies.damage(hit.object, damage, {
      point: hit.point,
      direction,
      headshot: this._zoneHeadshot(hit, node),
      weapon: this._activeType,
      weaponMode: stats.mode,
      headshotMultiplier: stats.headshotMultiplier,
      limbMultiplier: stats.limbMultiplier,
    });
    return true;
  }

  /** World-space impact FX/audio for a hitscan hit (EnemyManager owns enemy FX). */
  _worldImpact(hit, direction) {
    const surface = (hit.object && hit.object.userData && hit.object.userData.surface) || 'stone';
    this._hitNormal.copy(direction).negate();
    if (hit.face && hit.face.normal) {
      this._hitNormal
        .copy(hit.face.normal)
        .applyMatrix3(this._normalMatrix.getNormalMatrix(hit.object.matrixWorld))
        .normalize();
    }
    this.effects?.impact?.(hit.point, this._hitNormal, { surface, scale: 0.9, direction });
    this.audio?.impact?.(surface, hit.distance);
  }

  /** Hitscan shot used by the `auto` and `spinup` modes. */
  _fireHitscan(stats, tracerWidth) {
    this._cameraBasis();
    const direction = this._spreadDirection(this._currentSpread(stats), this._dir);
    const hit = this._raycast(this._origin, direction, 280);
    this._consumeRound(stats);
    if (hit) {
      this._end.copy(hit.point);
      const falloff = clamp(1 - (hit.distance / 280) * 0.18, 0.84, 1);
      this._damageEnemy(hit, direction, stats.damage * this.damageMultiplier * falloff, stats);
    } else {
      this._end.copy(this._origin).addScaledVector(direction, 220);
    }
    const muzzle = this._muzzleWorldPoint(this._muzzleWorld);
    this.effects?.tracer?.(muzzle, this._end, {
      color: stats.tracerColor ?? 0xffd58a,
      width: tracerWidth,
    });
    this._ejectCasing();
    return true;
  }

  /** Shotgun: one shot per trigger edge, `pellets` rays, distance falloff. */
  _firePump(stats) {
    this._cameraBasis();
    const muzzle = this._muzzleWorldPoint(this._muzzleWorld);
    this._consumeRound(stats);
    const pellets = Math.max(1, Math.round(Number(stats.pellets) || 1));
    const range = Number(stats.range) || 45;
    const spread = this._currentSpread(stats);
    let anyHit = false;
    for (let i = 0; i < pellets; i++) {
      const direction = this._spreadDirection(spread, this._dir);
      const hit = this._raycast(this._origin, direction, range);
      if (hit) {
        this._end.copy(hit.point);
        const damage = stats.damage * this.damageMultiplier * this._falloff(stats, hit.distance);
        if (this._damageEnemy(hit, direction, damage, stats, false)) anyHit = true;
      } else {
        this._end.copy(this._origin).addScaledVector(direction, range);
      }
      this.effects?.tracer?.(muzzle, this._end, {
        color: stats.tracerColor ?? 0xffd9a0,
        width: 0.018,
        duration: 0.055,
      });
    }
    if (anyHit) this.shotsHit++;
    this._pumpDuration = Math.max(0.05, Number(stats.pumpTime) || 0.5);
    this._pumpTimer = this._pumpDuration;
    this._ejectCasing();
    return true;
  }

  /** Distance falloff for pellet / projectile damage. */
  _falloff(stats, distance) {
    const start = Number(stats.falloffStart) || 0;
    const end = Math.max(start + 0.001, Number(stats.falloffEnd) || start + 1);
    const min = clamp(Number(stats.falloffMin) || 0, 0, 1);
    if (distance <= start) return 1;
    if (distance >= end) return min;
    return 1 - (1 - min) * ((distance - start) / (end - start));
  }

  /** RPG: spawn a real projectile from the loaded launcher. */
  _fireRocket(stats) {
    this._cameraBasis();
    const direction = this._spreadDirection(this._currentSpread(stats), this._dir);
    const muzzle = this._muzzleWorldPoint(this._muzzleWorld);
    // Spawn slightly in front of the eye (the muzzle sits ~0.6 m ahead, which
    // could already be inside a wall when hugging cover).
    this._projOrigin.copy(this._origin)
      .addScaledVector(this._forward, 0.45)
      .addScaledVector(this._up, -0.05);
    this._consumeRound(stats);
    this._spawnProjectile(this._projOrigin, direction, stats);
    // A launch streak from the actual viewmodel muzzle to the projectile.
    this.effects?.tracer?.(muzzle, this._projOrigin, {
      color: stats.tracerColor ?? 0xff9a55,
      width: 0.09,
      duration: 0.12,
    });
    return true;
  }

  _currentSpread(stats) {
    const block = stats || this._stats;
    const ads = this.ads;
    const moveFactor = clamp((this.player && this.player.speed ? this.player.speed : 0) / CONFIG.player.sprintSpeed, 0, 1);
    let spread = (block.spreadHip || 0) * (1 - ads) + (block.spreadAds || 0) * ads;
    spread += (block.spreadMove || 0) * moveFactor * (1 - ads * 0.55);
    spread += this.spreadBloom;
    if (this.player && this.player.grounded === false) spread += 0.02;
    if (this.player && this.player.crouching) spread *= 0.82;
    return spread;
  }

  // ===========================================================================
  // Rocket projectiles (pooled + per-frame segment raycasts)
  // ===========================================================================

  _buildProjectilePool() {
    const scene = (this.effects && this.effects.scene) || null;
    const root = new THREE.Group();
    root.name = 'SANDSTRIKE_ROCKETS';
    if (scene) scene.add(root);
    this._projectileRoot = root;

    const glowTexture = canvasTexture(64, 64, (ctx, w, h) => {
      const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gradient.addColorStop(0, 'rgba(255,244,214,1)');
      gradient.addColorStop(0.35, 'rgba(255,156,64,0.85)');
      gradient.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }, { srgb: true });
    glowTexture.wrapS = glowTexture.wrapT = THREE.ClampToEdgeWrapping;

    const bodyGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.48, 10, 1, false);
    bodyGeo.rotateX(Math.PI / 2);
    const noseGeo = new THREE.ConeGeometry(0.055, 0.2, 10, 1, false);
    noseGeo.rotateX(-Math.PI / 2);
    noseGeo.translate(0, 0, -0.33);
    const finGeoA = new THREE.BoxGeometry(0.014, 0.17, 0.16);
    finGeoA.translate(0, 0, 0.14);
    const finGeoB = new THREE.BoxGeometry(0.17, 0.014, 0.16);
    finGeoB.translate(0, 0, 0.14);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x55605a, metalness: 0.55, roughness: 0.48 });
    const noseMat = new THREE.MeshStandardMaterial({
      color: 0x8a3a22, metalness: 0.35, roughness: 0.6, emissive: 0x5a1a08, emissiveIntensity: 1.4,
    });
    const finMat = new THREE.MeshStandardMaterial({ color: 0x3c4240, metalness: 0.4, roughness: 0.7 });
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture, color: 0xffa860, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });

    this._projectileAssets = {
      geometries: [bodyGeo, noseGeo, finGeoA, finGeoB],
      materials: [bodyMat, noseMat, finMat, glowMat],
      textures: [glowTexture],
    };

    for (let i = 0; i < ROCKET_POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.name = `rocket:${i}`;
      group.visible = false;
      group.add(new THREE.Mesh(bodyGeo, bodyMat));
      group.add(new THREE.Mesh(noseGeo, noseMat));
      group.add(new THREE.Mesh(finGeoA, finMat));
      group.add(new THREE.Mesh(finGeoB, finMat));
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(0.42, 0.42, 1);
      glow.position.z = 0.2;
      group.add(glow);
      root.add(group);
      this._rockets.push({
        active: false,
        group,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        travelled: 0,
        maxRange: 0,
        gravity: 0,
        stats: null,
        multiplier: 1,
      });
    }
  }

  _spawnProjectile(origin, direction, stats) {
    let projectile = this._rockets.find((candidate) => !candidate.active);
    if (!projectile) projectile = this._rockets[0];
    projectile.active = true;
    projectile.stats = stats;
    projectile.multiplier = this.damageMultiplier;
    projectile.pos.copy(origin);
    projectile.dir.copy(direction);
    projectile.vel.copy(direction).multiplyScalar(Number(stats.projectileSpeed) || 60);
    projectile.travelled = 0;
    projectile.maxRange = Number(stats.projectileMaxRange) || 120;
    projectile.gravity = Number(stats.projectileGravity) || 0;
    projectile.group.visible = true;
    projectile.group.position.copy(origin);
    projectile.group.quaternion.setFromUnitVectors(ROCKET_FORWARD, projectile.dir);
    return projectile;
  }

  _clearProjectiles() {
    for (const projectile of this._rockets) {
      projectile.active = false;
      projectile.stats = null;
      if (projectile.group) projectile.group.visible = false;
    }
  }

  _updateProjectiles(dt) {
    for (const projectile of this._rockets) {
      if (!projectile.active) continue;
      const stats = projectile.stats;
      if (!stats) {
        projectile.active = false;
        projectile.group.visible = false;
        continue;
      }
      if (projectile.gravity) projectile.vel.y -= projectile.gravity * dt;
      this._rocketPrev.copy(projectile.pos);
      this._rocketNext.copy(projectile.pos).addScaledVector(projectile.vel, dt);
      const segment = this._rocketPrev.distanceTo(this._rocketNext);
      if (segment <= 1e-5) continue;
      this._rocketDir.copy(this._rocketNext).sub(this._rocketPrev).normalize();
      const hit = this._raycast(projectile.pos, this._rocketDir, segment);
      if (hit) {
        this._hitNormal.copy(this._rocketDir).negate();
        if (hit.face && hit.face.normal) {
          this._hitNormal
            .copy(hit.face.normal)
            .applyMatrix3(this._normalMatrix.getNormalMatrix(hit.object.matrixWorld))
            .normalize();
        }
        this._detonateProjectile(projectile, hit.point, hit.object, this._hitNormal);
        continue;
      }
      projectile.pos.copy(this._rocketNext);
      projectile.travelled += segment;
      projectile.group.position.copy(projectile.pos);
      projectile.group.quaternion.setFromUnitVectors(ROCKET_FORWARD, this._rocketDir);
      this.effects?.tracer?.(this._rocketPrev, projectile.pos, {
        color: stats.tracerColor ?? 0xff9a55,
        width: 0.05,
        duration: 0.09,
      });
      if (projectile.travelled >= projectile.maxRange) {
        this._hitNormal.copy(this._rocketDir).negate();
        this._detonateProjectile(projectile, projectile.pos, null, this._hitNormal);
      }
    }
  }

  _detonateProjectile(projectile, point, hitObject, normal) {
    projectile.active = false;
    projectile.group.visible = false;
    const stats = projectile.stats || this._stats;
    const multiplier = projectile.multiplier || 1;
    const direction = projectile.dir;
    const node = hitObject ? this._enemyNode(hitObject) : null;
    if (node && hitObject) {
      this.shotsHit++;
      const direct = (Number(stats.damage) || 0) * multiplier;
      this.enemies.damage(hitObject, direct, {
        point,
        direction,
        headshot: this._zoneHeadshot({ object: hitObject }, node),
        weapon: projectile.stats === this._stats ? this._activeType : (stats.id || 'rpg'),
        weaponMode: 'rocket',
        headshotMultiplier: stats.headshotMultiplier,
        limbMultiplier: stats.limbMultiplier,
      });
    }
    this._explodeAt(point, normal, direction, stats, multiplier);
  }

  _explodeAt(point, normal, direction, stats, multiplier) {
    const radius = Number(stats.splashRadius) || 0;
    const splash = (Number(stats.splashDamage) || 0) * multiplier;
    this.effects?.explosion?.(point, { scale: clamp(0.9 + radius * 0.05, 0.8, 1.8) });
    this.effects?.sparks?.(point, normal, { count: 22, color: 0xffb040, speed: 10, scale: 1.2 });
    this.effects?.dustBurst?.(point, { count: 14, scale: 1.3 });
    this.audio?.explosion?.(1);
    emit('fx:shake', { intensity: clamp(0.35 + radius * 0.04, 0.3, 0.85), source: 'rocket' });
    if (radius > 0 && splash > 0) {
      this._damageArea(point, radius, splash, {
        direction,
        splashFalloff: stats.splashFalloff,
        weapon: stats.id || this._activeType,
      });
    }
    this._applySelfDamage(stats, point, multiplier);
  }

  /**
   * Splash damage: EnemyManager.damageArea when available (CONTRACT §7), otherwise
   * a robot-radius fallback so the rocket is functional before that lands.
   */
  _damageArea(center, radius, amount, opts = {}) {
    const manager = this.enemies;
    if (!manager) return 0;
    if (typeof manager.damageArea === 'function') {
      try {
        const hits = manager.damageArea(center, radius, amount, opts);
        return Number.isFinite(hits) ? hits : 1;
      } catch (error) {
        console.warn('[weapons] enemies.damageArea() failed — using fallback', error);
      }
    }
    if (!this._warnedDamageArea) {
      this._warnedDamageArea = true;
      console.warn('[weapons] enemies.damageArea() missing — falling back to robot-radius splash');
    }
    const robots = manager.robots;
    if (!Array.isArray(robots) || typeof manager.damage !== 'function') return 0;
    // EnemyManager's damageArea() reads `splashFalloff`; fall back to `falloff`
    // for compatibility with the pre-boss implementation.
    const falloffMin = clamp(Number(opts.splashFalloff ?? opts.falloff) || 0.5, 0, 1);
    let hits = 0;
    for (let i = 0; i < robots.length; i++) {
      const robot = robots[i];
      if (!robot || !robot.alive || !robot.root) continue;
      const position = robot.root.position;
      const distance = Math.hypot(position.x - center.x, position.y - center.y, position.z - center.z);
      if (distance > radius) continue;
      const falloff = 1 - (distance / radius) * (1 - falloffMin);
      const damage = Math.max(1, Math.round(amount * falloff));
      manager.damage(robot.root, damage, {
        point: center,
        direction: opts.direction,
        headshot: false,
        weapon: 'rocket',
      });
      hits++;
    }
    return hits;
  }

  /** Optional player self-damage when a splash weapon fires too close (stats-gated). */
  _applySelfDamage(stats, point, multiplier) {
    if (!stats.selfDamage || !this.player || !this.player.alive) return;
    const origin = this.player.eye || this.player.position;
    if (!origin) return;
    const radius = Number(stats.splashRadius) || 0;
    if (radius <= 0) return;
    const distance = Math.hypot(origin.x - point.x, origin.y - point.y, origin.z - point.z);
    if (distance > radius) return;
    const falloff = 1 - (distance / radius) * (1 - clamp(Number(stats.splashFalloff) || 0.5, 0, 1));
    const damage = (Number(stats.splashDamage) || 0) * multiplier * falloff * (Number(stats.selfDamageScale) || 1);
    if (damage <= 0) return;
    this.player.takeDamage(Math.max(1, Math.round(damage)), point, 'rocket');
  }

  // ===========================================================================
  // Muzzle / casing presentation helpers
  // ===========================================================================

  _muzzleFlash(power = 1) {
    this._muzzleTimer = 0.055;
    if (this.flashGroup) {
      const flashScale = rand(0.7, 1.2) * power;
      this.flashGroup.scale.setScalar(flashScale);
      this.flashGroup.rotation.z = Math.random() * Math.PI;
    }
    this.flashMats.forEach((material, index) => {
      material.opacity = index === 2 ? 0.95 : rand(0.6, 1.0);
    });
    if (this.muzzleLight) this.muzzleLight.intensity = 18 * power;
  }

  /** World-space muzzle point (viewmodel-derived, falls back to the eye axis). */
  _muzzleWorldPoint(out) {
    if (this.gun && this.flashGroup) {
      this.camera.updateMatrixWorld();
      this.gun.updateWorldMatrix(true, false);
      this.flashGroup.getWorldPosition(this._muzzleView);
      return this._viewmodelToWorld(this._muzzleView, out);
    }
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(out);
    this.camera.getWorldDirection(this._fallbackDir);
    return out.addScaledVector(this._fallbackDir, 0.55);
  }

  /** Eject one shell casing from the active viewmodel's ejection port. */
  _ejectCasing() {
    if (!this.gun) return;
    this.camera.updateMatrixWorld();
    this.gun.updateWorldMatrix(true, false);
    this.gun.localToWorld(this._ejectView.set(0.062, 0.055, 0.0));
    this._viewmodelToWorld(this._ejectView, this._ejectWorld);
    const cameraDir = this.camera.getWorldDirection(this._camDir);
    const roll = rand(-0.5, 0.5);
    this._ejectVel.copy(this._right)
      .multiplyScalar(rand(1.3, 3.4))
      .addScaledVector(this._up, rand(1.1, 2.7))
      .addScaledVector(cameraDir, rand(-1.1, -0.2))
      .add(this._ejectJitter.set(rand(-1.1, 1.1), rand(-0.5, 0.9), rand(-1.1, 1.1)))
      .applyAxisAngle(cameraDir, roll);
    this.effects?.shellCasing?.(this._ejectWorld, this._ejectVel, { scale: 0.8 });
  }

  /**
   * Convert a point in viewmodel space (viewCamera at origin, -Z forward) into
   * a world point that lands on the same screen pixel through the main camera.
   * The two cameras share a position/rotation but not a FOV, so a plain world
   * transform would make tracers drift away from the barrel.
   */
  _viewmodelToWorld(viewPoint, out) {
    const depth = Math.max(0.35, -viewPoint.z);
    this._muzzleNdc.copy(viewPoint).project(this.viewCamera);
    out.set(this._muzzleNdc.x, this._muzzleNdc.y, 0.5).unproject(this.camera);
    out.sub(this.camera.position).normalize().multiplyScalar(depth).add(this.camera.position);
    return out;
  }

  // ===========================================================================
  // Per-frame update
  // ===========================================================================
  update(dt) {
    if (this._disposed) return;
    this.time += dt;
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this._dryTimer = Math.max(0, this._dryTimer - dt);
    this._noticeTimer = Math.max(0, this._noticeTimer - dt);
    if (!this.active) return;

    this._updateSwitch(dt);
    this._updateProjectiles(dt);

    const stats = this._stats;
    const player = this.player || null;
    const sprinting = !!(player && player.sprinting && !this.aiming);
    this._sprintBlend = damp(this._sprintBlend, sprinting ? 1 : 0, 9, dt);
    const targetAds = this.aiming && !this.reloading && this._switchT <= 0 && !(player && player.sprinting) ? 1 : 0;
    this.ads = damp(this.ads, targetAds, 13, dt);
    if (player) {
      player.aiming = targetAds > 0.35;
      player.speedMultiplier = (1 - 0.35 * this.ads) * (Number(stats.moveSpeedMul) || 1);
      player.adsFov = stats.adsFov;
    }

    this.recoil = damp(this.recoil, 0, 13, dt);
    this.spreadBloom = damp(this.spreadBloom, 0, 4.2, dt);
    this._boltKick = damp(this._boltKick, 0, 15, dt);

    // --- spin-up spin state (gatling) --------------------------------------
    if (stats.mode === 'spinup') {
      const wantsSpin = this.triggerDown && !this.reloading && this._switchT <= 0
        && (this.mag > 0 || this.reserve > 0);
      const rate = wantsSpin
        ? 1 / Math.max(0.05, Number(stats.spinUpTime) || 0.55)
        : -1 / Math.max(0.05, Number(stats.spinDownTime) || 0.9);
      this.spin = clamp(this.spin + rate * dt, 0, 1);
      // Mechanical whir follows the spin amount (and fades while spinning down).
      const spinSound = this.spin > 0.03;
      this._setSpinSound(spinSound);
      if (spinSound) {
        try { this.audio?.gatlingSpinRate?.(this.spin); } catch { /* audio optional */ }
      }
    } else if (this.spin !== 0 || this._spinSoundOn) {
      this.spin = 0;
      this._setSpinSound(false);
    }

    // --- held-trigger automatic fire ---------------------------------------
    if (this.triggerDown && this.fireCooldown <= 0 && !this.reloading && this._switchT <= 0) {
      const mode = stats.mode;
      if (mode === 'auto' || mode === 'spinup') {
        if (this.mag > 0) this.tryFire();
        else if (this.reserve > 0) this.startReload();
      }
    }

    this._updateReload(dt);
    this._updateMuzzleFlash(dt);
    this._updateSway(dt);
    this._updateTransform(dt);
    this._updateWeaponAnimation(dt);

    if (this.reticle && this.reticle.material) {
      this.reticle.material.opacity = this.ads > 0.5 ? 0.95 : 0;
    }
    const timeSinceShot = this.time - this.lastFireTime;
    if (timeSinceShot > 0.25) this.spreadBloom = damp(this.spreadBloom, 0, 8, dt);
  }

  _updateSwitch(dt) {
    if (this._switchT <= 0) return;
    this._switchT = Math.max(0, this._switchT - dt);
    const elapsed = SWITCH_TIME - this._switchT;
    if (this._pendingRig && elapsed >= SWITCH_TIME * 0.5) this._commitSwap();
    if (this._switchT <= 0 && this._pendingRig) this._commitSwap();
  }

  /** 0 (raised) → 1 (lowered) → 0 (raised) draw dip for the switch animation. */
  _switchDip() {
    if (this._switchT <= 0) return 0;
    const half = SWITCH_TIME * 0.5;
    const elapsed = SWITCH_TIME - this._switchT;
    return elapsed <= half ? elapsed / half : clamp((SWITCH_TIME - elapsed) / half, 0, 1);
  }

  _updateMuzzleFlash(dt) {
    if (this._muzzleTimer <= 0) return;
    this._muzzleTimer -= dt;
    const fade = clamp(this._muzzleTimer / 0.055, 0, 1);
    for (const material of this.flashMats) material.opacity *= fade * 0.85;
    if (this.muzzleLight) this.muzzleLight.intensity = 18 * fade;
    if (this._muzzleTimer <= 0) {
      this._muzzleTimer = 0;
      for (const material of this.flashMats) material.opacity = 0;
      if (this.muzzleLight) this.muzzleLight.intensity = 0;
    }
  }

  _updateSway(dt) {
    if (!this.player) return;
    const dyaw = this.player.yaw - this._prevYaw;
    const dpitch = this.player.pitch - this._prevPitch;
    this._prevYaw = this.player.yaw;
    this._prevPitch = this.player.pitch;
    this._swayX = damp(this._swayX, clamp(dyaw * 3.2, -0.05, 0.05), 10, dt);
    this._swayY = damp(this._swayY, clamp(-dpitch * 3.2, -0.05, 0.05), 10, dt);
  }

  /** Hip / ADS pose + barrel convergence + view-camera FOV. */
  _updateTransform(dt) {
    const stats = this._stats;
    const ads = this.ads;
    const sprint = this._sprintBlend;
    const player = this.player || {};
    const bob = player.walkPhase || 0;
    const speed = clamp((player.speed || 0) / CONFIG.player.walkSpeed, 0, 1.4);
    // Optional per-weapon pose overrides (CONTRACT §5): every axis falls back to
    // the shared default when the weapon does not define it, so the VXR-7 (no
    // `viewmodel` block) runs the exact same numbers as before.
    const pose = stats.viewmodel;
    const hipPose = pose && pose.hip;
    const adsPose = pose && pose.ads;
    const hipBase = {
      x: hipPose && Number.isFinite(hipPose.x) ? hipPose.x : HIP.x,
      y: hipPose && Number.isFinite(hipPose.y) ? hipPose.y : HIP.y,
      z: hipPose && Number.isFinite(hipPose.z) ? hipPose.z : HIP.z,
    };
    const hipX = hipBase.x + Math.cos(bob) * 0.012 * speed;
    const hipY = hipBase.y - Math.abs(Math.sin(bob)) * 0.012 * speed;
    const hipZ = hipBase.z;
    const gunScale = this.gun ? this.gun.scale.x : 1;
    const sight = this.sightLocal || DEFAULT_SIGHT;
    const adsX = adsPose && Number.isFinite(adsPose.x) ? adsPose.x : -sight.x * gunScale;
    const adsY = adsPose && Number.isFinite(adsPose.y) ? adsPose.y : -sight.y * gunScale;
    const adsZ = adsPose && Number.isFinite(adsPose.z) ? adsPose.z : ADS_Z;
    const breathe = Math.sin(this.time * 1.6) * 0.0025 * (1 - ads * 0.7);
    const reloadPose = this.reloading
      ? Math.sin(clamp(this.reloadTime / Math.max(0.01, this.reloadDuration), 0, 1) * Math.PI)
      : 0;
    const stance = 1 - ads;
    const sway = 1 - ads * 0.92;
    const dip = this._switchDip();

    if (this.gunRoot) {
      this.gunRoot.position.set(
        hipX * stance + adsX * ads + this._swayX * 0.8 * sway + sprint * 0.04,
        (hipY + breathe) * stance + adsY * ads - this.recoil * 0.02 * stance
          + this._swayY * 0.7 * sway - sprint * 0.09 - reloadPose * 0.05 - dip * 0.22,
        hipZ + (adsZ - hipZ) * ads - this.recoil * 0.04 + sprint * 0.05 + reloadPose * 0.01,
      );
      this.gunRoot.rotation.set(
        (-this.recoil * 0.055) * stance + this._swayY * 0.4 * sway + sprint * 0.18
          + reloadPose * 0.16 + dip * 0.6,
        (0.060 + this._swayX * 0.6) * stance + sprint * 0.22 - reloadPose * 0.22,
        (HIP_ROLL + this._swayX * 0.8) * stance + sprint * 0.18 + reloadPose * 0.3,
      );

      // ---- weapon convergence ---------------------------------------------
      // Hip fire leaves the gun visibly angled while the hitscan goes dead
      // centre; rotate the whole viewmodel so the barrel axis points at the
      // crosshair (blended out while aiming, where the optic stays centred).
      if (stance > 0.001 && !this.reloading && this._switchT <= 0) {
        const muzzle = this.muzzleLocal || _defaultMuzzle;
        _convQuat.setFromEuler(this.gunRoot.rotation);
        _muzzleOff.copy(muzzle).multiplyScalar(gunScale).applyQuaternion(_convQuat).add(this.gunRoot.position);
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
    }

    const targetFov = ads > 0.5 ? Math.max(30, Number(stats.adsFov) - 6 || 42) : 54;
    this.viewCamera.fov = damp(this.viewCamera.fov, targetFov, 14, dt);
    this.viewCamera.updateProjectionMatrix();
  }

  /** Reload / pump / bolt / trigger / barrels animation, all base-relative. */
  _updateWeaponAnimation(dt) {
    const base = this._rigBase || {};
    const reloadT = this.reloading
      ? clamp(this.reloadTime / Math.max(0.01, this.reloadDuration), 0, 1)
      : 0;

    const magazine = this.magazine;
    if (magazine && base.magazine) {
      const rest = base.magazine;
      if (this.reloading) {
        let drop = 0;
        if (reloadT >= 0.18 && reloadT < 0.62) drop = clamp((reloadT - 0.18) / 0.44, 0, 1);
        else if (reloadT >= 0.62) drop = 1 - clamp((reloadT - 0.62) / 0.24, 0, 1);
        magazine.position.y = rest.position.y - drop * POSE.magDrop;
        magazine.position.x = rest.position.x;
        magazine.rotation.x = rest.rotation.x - drop * POSE.magDropRot;
      } else {
        magazine.position.x = damp(magazine.position.x, rest.position.x, 20, dt);
        magazine.position.y = damp(magazine.position.y, rest.position.y, 20, dt);
        magazine.rotation.x = damp(magazine.rotation.x, rest.rotation.x, 20, dt);
      }
    }

    const spare = this.spareMagazine;
    if (spare && base.spareMagazine) {
      const rest = base.spareMagazine;
      if (this.reloading && reloadT > 0.5 && reloadT < 0.88) {
        const p = clamp((reloadT - 0.5) / 0.38, 0, 1);
        spare.visible = true;
        spare.position.set(
          rest.position.x + 0.08 * (1 - p),
          rest.position.y - 0.36 + p * 0.27,
          rest.position.z + 0.04 + p * 0.02,
        );
        spare.rotation.set(rest.rotation.x, rest.rotation.y, rest.rotation.z - 0.3 * (1 - p));
      } else {
        spare.visible = false;
      }
    }

    const charging = this.charging;
    if (charging && base.charging) {
      const rest = base.charging;
      if (this.reloading && reloadT > 0.72) {
        const p = Math.sin(clamp((reloadT - 0.72) / 0.24, 0, 1) * Math.PI);
        charging.position.z = rest.position.z + p * POSE.chargePull;
      } else {
        charging.position.z = damp(charging.position.z, rest.position.z, 18, dt);
      }
    }

    const trigger = this.trigger;
    if (trigger && base.trigger) {
      const rest = base.trigger;
      trigger.rotation.x = damp(trigger.rotation.x, rest.rotation.x - POSE.recoilRot * this._boltKick, 14, dt);
    }

    const bolt = this.bolt;
    if (bolt && base.bolt) {
      const rest = base.bolt;
      const back = Math.min(1, this._boltKick * 1.4);
      bolt.position.z = rest.position.z + back * POSE.boltKickZ;
      bolt.position.x = rest.position.x + back * POSE.boltKickX;
    }

    const pump = this.pump;
    if (pump && base.pump) {
      const rest = base.pump;
      if (this._pumpTimer > 0) {
        const duration = Math.max(0.05, this._pumpDuration);
        const p = 1 - clamp(this._pumpTimer / duration, 0, 1);
        pump.position.z = rest.position.z + Math.sin(Math.PI * p) * POSE.pumpTravel;
      } else {
        pump.position.z = damp(pump.position.z, rest.position.z, 16, dt);
      }
    }
    if (this._pumpTimer > 0) this._pumpTimer = Math.max(0, this._pumpTimer - dt);

    if (this.barrels) {
      const restZ = base.barrels ? base.barrels.rotation.z : 0;
      this._barrelAngle += dt * 42 * this.spin;
      this.barrels.rotation.z = restZ + this._barrelAngle;
    }
  }

  // ===========================================================================
  // State / rendering / lifecycle
  // ===========================================================================
  getState() {
    const stats = this._stats;
    const slot = this.activeSlot;
    const duration = Math.max(0.01, this.reloadDuration);
    return {
      weapon: stats.short,
      weaponName: stats.short,
      name: stats.name,
      weaponType: this._activeType,
      weaponMode: stats.mode,
      short: stats.short,
      mag: slot ? slot.mag : 0,
      magSize: slot ? slot.magSize : stats.magSize,
      reserve: slot ? slot.reserve : 0,
      reserveMax: slot ? slot.reserveMax : stats.reserveMax,
      reloading: this.reloading,
      reloadProgress: this.reloading ? clamp(this.reloadTime / duration, 0, 1) : 0,
      ads: this.ads > 0.5,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      damageMultiplier: slot ? slot.damageMultiplier : 1,
      magExtension: slot ? slot.magExtension : 0,
      reloadBonus: 1 - (slot ? slot.reloadSpeedMul : 1),
      reloadTime: this.reloadDuration,
      slotIndex: weaponSlotIndex(this._activeType),
      maxSlots: MAX_WEAPON_SLOTS,
      ammoScale: stats.ammoScale,
      slots: this.getSlots(),
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

  reset() {
    if (this._disposed) return;
    this._switchT = 0;
    this._pendingRig = null;
    this._oldRig = null;
    for (const slot of this._slots.values()) {
      slot.mag = slot.magSize;
      slot.reserve = slot.stats.reserveStart;
    }
    this.reloading = false;
    this.reloadTime = 0;
    this._reloadPlayed.clear();
    this.triggerDown = false;
    this.aiming = false;
    this.ads = 0;
    this.fireCooldown = 0;
    this.spreadBloom = 0;
    this.recoil = 0;
    this._boltKick = 0;
    this.spin = 0;
    this._setSpinSound(false);
    this._barrelAngle = 0;
    this._pumpTimer = 0;
    this._pumpDuration = 0;
    this._dryTimer = 0;
    this._noticeTimer = 0;
    this._swayX = 0;
    this._swayY = 0;
    this._sprintBlend = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.lastFireTime = -999;
    this._clearProjectiles();
    this._equipType(this._activeType);
    if (this.player) {
      this.player.aiming = false;
      this.player.adsFov = this._stats.adsFov;
      this.player.speedMultiplier = 1;
      this._prevYaw = this.player.yaw;
      this._prevPitch = this.player.pitch;
    }
    this._updateTransform(0);
    this._emitSlots(true);
  }

  // ===========================================================================
  // Events / dispose
  // ===========================================================================

  /** `weapon:slots` emitter, rate limited to ≤10 Hz unless forced. */
  _emitSlots(force = false) {
    if (this._disposed) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - this._lastSlotsAt < SLOTS_EMIT_INTERVAL_MS) return;
    this._lastSlotsAt = now;
    emit('weapon:slots', {
      slots: this.getSlots(),
      activeIndex: weaponSlotIndex(this._activeType),
      maxSlots: MAX_WEAPON_SLOTS,
    });
  }

  dispose() {
    if (this._disposed) return;
    this._setSpinSound(false);
    this._disposed = true;
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('blur', this._onBlur);

    this._clearProjectiles();
    if (this._projectileAssets) {
      for (const geometry of this._projectileAssets.geometries) geometry.dispose();
      for (const texture of this._projectileAssets.textures) texture.dispose();
      for (const material of this._projectileAssets.materials) material.dispose();
      this._projectileAssets = null;
    }
    if (this._projectileRoot) {
      this._projectileRoot.clear();
      this._projectileRoot.removeFromParent();
      this._projectileRoot = null;
    }
    this._rockets.length = 0;

    if (this.muzzleLight) this.muzzleLight.removeFromParent();
    for (const rig of this._rigs.values()) this._disposeRigResources(rig);
    this._rigs.clear();
    this._slots.clear();
    this._activeRig = null;
    this._rigBase = {};
    this.gunRoot = null;
    this.gun = null;
    this.weaponRoot = null;
    this.handsRoot = null;
    this.magazine = null;
    this.spareMagazine = null;
    this.bolt = null;
    this.charging = null;
    this.trigger = null;
    this.reticle = null;
    this.flashGroup = null;
    this.flashMats = [];
    this.barrels = null;
    this.pump = null;
    this.loadedRocket = null;
    this.viewScene.clear();
  }
}
