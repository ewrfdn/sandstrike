/**
 * SANDSTRIKE // 沙暴协议 — Combat HUD panel
 * ---------------------------------------------------------------------------
 * Extracted from the old monolithic `src/ui.js` (markup from `_build`, plus the
 * `_on*` handlers, `_render*` painters, transient feedback helpers, radar and
 * the HUD part of the frame loop).
 *
 * The UI core (`src/ui/index.js`) owns the state machine, the actions, the rAF
 * loop and the global click/input delegation; this module only builds its own
 * markup/refs, subscribes to the combat bus events and exposes the render and
 * feedback entry points the core calls.
 *
 * Contract: `.scratch/ui-refactor-contract.md` ("hud.js").
 */
import {
  bindBus,
  clamp,
  clamp01,
  diffTone,
  fmtMul,
  fmtScore,
  fmtStageCounter,
  HINTS_GAMEPAD,
  HINTS_KEYBOARD,
  num,
  pad2,
  q,
  rand,
  weaponModeLabel,
} from './shared.js';
import { getDifficulty, isDifficultyId } from '../config/difficulty.js';

/**
 * `.ui-fx` vignette/scanline layer + `.hud` combat HUD. Copied verbatim from
 * the old `_build` template. `ui` is accepted for the uniform panel contract;
 * this markup is static.
 */
export function hudMarkup(ui) {
  return `
      <div class="ui-fx" aria-hidden="true">
        <div class="fx-vignette"></div>
        <div class="fx-scanlines"></div>
        <div class="fx-grain"></div>
        <div class="fx-heat"></div>
        <div class="fx-letterbox fx-letterbox--top"></div>
        <div class="fx-letterbox fx-letterbox--bottom"></div>
        <div class="fx-flash" data-flash></div>
        <div class="fx-low-health" data-low-health></div>
        <div class="fx-arcs" data-arcs></div>
      </div>

      <div class="hud" data-hud aria-hidden="true">
        <div class="hud-corner hud-corner--tl"></div>
        <div class="hud-corner hud-corner--tr"></div>
        <div class="hud-corner hud-corner--bl"></div>
        <div class="hud-corner hud-corner--br"></div>

        <div class="hud-top-center">
          <div class="wave-panel">
            <div class="wave-kicker">
              <span class="dot"></span> ASSAULT WAVE <em>进攻波次</em>
              <span class="wave-mode" data-wave-mode>STANDARD</span>
              <span class="wave-state" data-wave-state>STANDBY</span>
            </div>
            <div class="wave-row">
              <span class="wave-current" data-wave-current>01</span>
              <span class="wave-slash">/</span>
              <span class="wave-total" data-wave-total>05</span>
              <span class="wave-divider"></span>
              <span class="wave-hostiles"><span class="wh-k">HOSTILES</span><span class="wh-v" data-wave-remaining>00</span></span>
            </div>
            <div class="wave-pips" data-wave-pips></div>
            <div class="wave-stage" data-wave-stage>
              <span class="ws-k">STAGE</span>
              <span class="ws-index" data-stage-index>--/--</span>
              <span class="ws-name" data-stage-label>—</span>
            </div>
          </div>
        </div>

        <div class="hud-top-left">
          <div class="obj-panel">
            <div class="obj-kicker">PRIMARY OBJECTIVE // 主要目标</div>
            <div class="obj-text">ELIMINATE HOSTILES <em>歼灭全部敌方单位</em></div>
            <div class="obj-track"><i data-objective-fill></i><b data-objective-wave>WAVE 01</b></div>
          </div>
          <div class="score-panel">
            <div class="score-top">
              <span class="score-kicker">SCORE // 得分</span>
              <span class="score-best">BEST <b data-best>000000</b></span>
            </div>
            <div class="score-value" data-score>000000</div>
            <div class="score-meta">
              <span class="combo" data-combo>×1.0</span>
              <span class="multi">MULTIPLIER</span>
              <span class="kills">KILLS <b data-kills>0</b></span>
            </div>
          </div>
        </div>

        <div class="hud-top-right">
          <div class="radar-panel">
            <div class="radar-head">
              <span class="radar-kicker">RECON</span><em>侦察</em>
              <span class="radar-mode"><i></i>LIVE</span>
            </div>
            <div class="radar-screen">
              <canvas class="radar-canvas" width="512" height="512" aria-hidden="true"></canvas>
              <div class="radar-brackets"></div>
              <span class="radar-bearing" data-bearing>000°</span>
            </div>
            <div class="radar-foot">
              <span data-radar-hostiles>04</span><span class="rf-k">HOSTILES</span>
              <span class="rf-sep"></span><span class="rf-k">RANGE</span><span data-radar-range>42M</span>
            </div>
          </div>
          <div class="perf-panel" data-perf aria-hidden="true">
            <div class="perf-head">
              <span class="perf-kicker">FRAME <i>//</i> <em>帧率</em></span>
              <span class="perf-state" data-perf-state>SYNC</span>
            </div>
            <div class="perf-row">
              <span class="perf-fps" data-fps>--</span>
              <span class="perf-unit">FPS</span>
              <span class="perf-ms"><b data-frametime>--</b> MS</span>
            </div>
            <canvas class="perf-graph" data-perf-graph width="244" height="46" aria-hidden="true"></canvas>
          </div>
          <div class="killfeed" data-killfeed aria-live="polite"></div>
        </div>

        <div class="hud-bottom-left">
          <div class="vitals-panel">
            <div class="vital">
              <div class="vital-head">
                <span class="vital-ico">✚</span><span class="vital-name">VITALS</span><em>生命</em>
                <span class="vital-num" data-health>100</span><span class="vital-max" data-health-max>/100</span>
              </div>
              <div class="vital-seg" data-health-seg></div>
            </div>
            <div class="vital vital--armor">
              <div class="vital-head">
                <span class="vital-ico">◈</span><span class="vital-name">ARMOR</span><em>护甲</em>
                <span class="vital-num" data-armor>100</span><span class="vital-max" data-armor-max>/100</span>
              </div>
              <div class="vital-seg" data-armor-seg></div>
            </div>
            <div class="vital-status"><span class="status-dot"></span><span data-health-state>COMBAT READY</span><em>状态正常</em></div>
            <div class="vital-buffs" data-vital-buffs></div>
          </div>
        </div>

        <div class="hud-bottom-right">
          <div class="weapon-slots" data-weapon-slots aria-hidden="true">
            <button class="wslot is-active" type="button" tabindex="-1" data-slot="0" data-slot-type="vxr7">
              <span class="wslot-key">1</span>
              <span class="wslot-name">VXR-7</span>
              <span class="wslot-ammo"><b>30</b><i>/</i><span>300</span></span>
            </button>
            <button class="wslot is-empty" type="button" tabindex="-1" data-slot="1">
              <span class="wslot-key">2</span>
              <span class="wslot-name">EMPTY</span>
              <span class="wslot-ammo"><b>—</b></span>
            </button>
            <button class="wslot is-empty" type="button" tabindex="-1" data-slot="2">
              <span class="wslot-key">3</span>
              <span class="wslot-name">EMPTY</span>
              <span class="wslot-ammo"><b>—</b></span>
            </button>
            <button class="wslot is-empty" type="button" tabindex="-1" data-slot="3">
              <span class="wslot-key">4</span>
              <span class="wslot-name">EMPTY</span>
              <span class="wslot-ammo"><b>—</b></span>
            </button>
          </div>
          <div class="ammo-panel">
            <div class="ammo-head">
              <span class="ammo-weapon" data-weapon-name>VXR-7 突击步枪</span>
              <span class="ammo-mode" data-weapon-mode>AUTO</span>
            </div>
            <div class="ammo-readout">
              <span class="ammo-mag" data-mag>30</span>
              <span class="ammo-div">/</span>
              <span class="ammo-reserve" data-reserve>300</span>
            </div>
            <div class="ammo-ticks" data-mag-ticks></div>
            <div class="ammo-loot" data-ammo-loot></div>
            <div class="ammo-reload" data-reload>
              <div class="reload-track"><i data-reload-fill></i></div>
              <span class="reload-text">RELOADING <em>换弹中</em></span>
            </div>
            <div class="ammo-hint">R — RELOAD <em>换弹</em> · 1-4 — SWITCH <em>切枪</em></div>
          </div>
        </div>

        <div class="crosshair" data-crosshair aria-hidden="true">
          <i class="ch-dot"></i>
          <i class="ch-line ch-t"></i><i class="ch-line ch-b"></i>
          <i class="ch-line ch-l"></i><i class="ch-line ch-r"></i>
          <i class="ch-ring"></i>
          <div class="ch-hitmarker" data-hitmarker><i></i><i></i><i></i><i></i></div>
        </div>

        <div class="score-pops" data-score-pops></div>
        <div class="notices" data-notices></div>
        <div class="wave-banner" data-banner>
          <div class="banner-kicker" data-banner-kicker>WAVE INBOUND</div>
          <div class="banner-title" data-banner-title>WAVE 01</div>
          <div class="banner-sub" data-banner-sub>HOSTILES: 04 // 敌军接近</div>
        </div>
        <div class="intermission" data-intermission>
          <div class="int-kicker">NEXT WAVE IN <em>下一波</em></div>
          <div class="int-time" data-int-time>06</div>
          <div class="int-track"><i data-int-fill></i></div>
          <div class="int-label" data-int-label>WAVE 02 // 准备</div>
        </div>
        <div class="boss-bar" data-boss-bar aria-hidden="true">
          <div class="boss-top">
            <span class="boss-kicker"><i></i> BOSS // 攻城督军</span>
            <span class="boss-name" data-boss-name>SIEGE WARDEN</span>
            <span class="boss-hp" data-boss-hp>— / —</span>
          </div>
          <div class="boss-track"><i class="boss-fill" data-boss-fill></i></div>
        </div>
        <div class="hud-watermark">SANDSTRIKE <b>//</b> 沙暴协议 <span>OPS-07</span></div>
      </div>
  `;
}

export class HudPanel {
  constructor(ui, shell) {
    this.ui = ui;
    this.shell = shell;
    this._disposed = false;
    this._offBus = null;

    // Transient HUD state that used to live on the old UI instance.
    this._shake = 0;
    this._wasShaking = false;
    this._lastRadarDraw = 0;
    this._kickTimer = 0;
    this._bannerTimer = 0;
    this._feedTimers = new Set();
    this._arcEls = [];
    this._arcIndex = 0;
    this._intermissionMax = 6;
    this._intermissionNext = 2;
    this._prevMag = null;
    this._pipTotal = 0;
    this._ammoTickCount = 0;
    // Campaign/loadout additions: slot strip re-render rate-limit (≤10 Hz) and
    // the boss bar auto-hide timer (fades out 1.2 s after the defeat event).
    this._slotNodes = [];
    this._slotsTimer = 0;
    this._slotsDirty = false;
    this._bossHideTimer = 0;
    this._bossVisible = false;

    this.refs = {
      hud: q(shell, '[data-hud]'),
      waveCurrent: q(shell, '[data-wave-current]'),
      waveTotal: q(shell, '[data-wave-total]'),
      waveRemaining: q(shell, '[data-wave-remaining]'),
      waveState: q(shell, '[data-wave-state]'),
      waveMode: q(shell, '[data-wave-mode]'),
      wavePips: q(shell, '[data-wave-pips]'),
      objectiveFill: q(shell, '[data-objective-fill]'),
      objectiveWave: q(shell, '[data-objective-wave]'),
      score: q(shell, '[data-score]'),
      combo: q(shell, '[data-combo]'),
      kills: q(shell, '[data-kills]'),
      best: q(shell, '[data-best]'),
      health: q(shell, '[data-health]'),
      armor: q(shell, '[data-armor]'),
      healthMax: q(shell, '[data-health-max]'),
      armorMax: q(shell, '[data-armor-max]'),
      healthSeg: q(shell, '[data-health-seg]'),
      armorSeg: q(shell, '[data-armor-seg]'),
      healthState: q(shell, '[data-health-state]'),
      vitalBuffs: q(shell, '[data-vital-buffs]'),
      bearing: q(shell, '[data-bearing]'),
      radarHostiles: q(shell, '[data-radar-hostiles]'),
      radarRange: q(shell, '[data-radar-range]'),
      radarCanvas: q(shell, '.radar-canvas'),
      weaponName: q(shell, '[data-weapon-name]'),
      mag: q(shell, '[data-mag]'),
      reserve: q(shell, '[data-reserve]'),
      magTicks: q(shell, '[data-mag-ticks]'),
      ammoLoot: q(shell, '[data-ammo-loot]'),
      reload: q(shell, '[data-reload]'),
      reloadFill: q(shell, '[data-reload-fill]'),
      crosshair: q(shell, '[data-crosshair]'),
      hitmarker: q(shell, '[data-hitmarker]'),
      killfeed: q(shell, '[data-killfeed]'),
      scorePops: q(shell, '[data-score-pops]'),
      notices: q(shell, '[data-notices]'),
      banner: q(shell, '[data-banner]'),
      bannerKicker: q(shell, '[data-banner-kicker]'),
      bannerTitle: q(shell, '[data-banner-title]'),
      bannerSub: q(shell, '[data-banner-sub]'),
      intermission: q(shell, '[data-intermission]'),
      intTime: q(shell, '[data-int-time]'),
      intFill: q(shell, '[data-int-fill]'),
      intLabel: q(shell, '[data-int-label]'),
      flash: q(shell, '[data-flash]'),
      lowHealth: q(shell, '[data-low-health]'),
      arcs: q(shell, '[data-arcs]'),
      ammoHint: q(shell, '.ammo-hint'),
      // Campaign / loadout additions (CONTRACT §8).
      waveStage: q(shell, '[data-wave-stage]'),
      stageIndex: q(shell, '[data-stage-index]'),
      stageLabel: q(shell, '[data-stage-label]'),
      ammoMode: q(shell, '[data-weapon-mode]'),
      weaponSlots: q(shell, '[data-weapon-slots]'),
      bossBar: q(shell, '[data-boss-bar]'),
      bossName: q(shell, '[data-boss-name]'),
      bossHp: q(shell, '[data-boss-hp]'),
      bossFill: q(shell, '[data-boss-fill]'),
      // Frame-counter nodes live inside `.hud`; perf.js queries them itself,
      // but the contract lists them here for parity with the old refs bag.
      perfPanel: q(shell, '[data-perf]'),
      perfState: q(shell, '[data-perf-state]'),
      perfFps: q(shell, '[data-fps]'),
      perfMs: q(shell, '[data-frametime]'),
      perfGraph: q(shell, '[data-perf-graph]'),
    };

    // Build segmented meters, wave pips, ammo ticks and damage-arc pool in JS
    // so their counts follow the live config (same as the old `_build`).
    this._buildSegments(this.refs.healthSeg, 20);
    this._buildSegments(this.refs.armorSeg, 20);
    this._buildPips(ui.data.wave.total || 15);
    this._buildAmmoTicks(30);
    this._buildArcs(6);
    this._buildWeaponSlots();

    // The old `_build` painted the contextual hints last; keyboard markup is the
    // default so this is a no-op until a pad is already mirrored in.
    this.refreshHints();

    this._offBus = bindBus(this, {
      'player:stats': (detail) => this._onStats(detail),
      'player:hit': (detail) => this._onPlayerHit(detail),
      'player:heal': (detail) => this._onHeal(detail),
      'wave:start': (detail) => this._onWaveStart(detail),
      'wave:clear': (detail) => this._onWaveClear(detail),
      'wave:countdown': (detail) => this._onCountdown(detail),
      'enemy:killed': (detail) => this._onKilled(detail),
      'enemy:hitmarker': (detail) => this._onHitmarker(detail),
      'score:change': (detail) => this._onScore(detail),
      'radar:update': (detail) => this._onRadar(detail),
      'weapon:notice': (detail) => this._onNotice(detail),
      'weapon:fired': () => this._onWeaponFired(),
      'weapon:slots': (detail) => this._onSlots(detail),
      'weapon:switched': (detail) => this._onSwitched(detail),
      'boss:spawn': (detail) => this._onBossSpawn(detail),
      'boss:health': (detail) => this._onBossHealth(detail),
      'boss:defeated': (detail) => this._onBossDefeated(detail),
      'fx:shake': (detail) => this._onShake(detail),
      'fx:hitflash': (detail) => this._onHitflash(detail),
      'game:world': (detail) => this._onWorld(detail),
      'game:stage': (detail) => this._onStage(detail),
      'game:difficulty': (detail) => this._onDifficulty(detail),
    });
  }

  // =========================================================================
  // Bus event handlers (logic moved verbatim from the old UI core)
  // =========================================================================

  _onWorld(detail) {
    const ui = this.ui;
    const radar = ui.data.radar;
    if (detail.bounds && typeof detail.bounds === 'object') {
      const b = detail.bounds;
      const minX = num(b.minX, -34);
      const maxX = num(b.maxX, 34);
      const minZ = num(b.minZ, -34);
      const maxZ = num(b.maxZ, 34);
      radar.bounds = { minX, maxX, minZ, maxZ };
      radar.range = clamp(Math.max(maxX - minX, maxZ - minZ) / 2 + 8, 30, 60);
      if (this.refs.radarRange) this.refs.radarRange.textContent = `${Math.round(radar.range)}M`;
    }
    if (Array.isArray(detail.landmarks)) {
      radar.landmarks = detail.landmarks
        .filter((item) => item && Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.z)))
        .slice(0, 14)
        .map((item) => ({ x: Number(item.x), z: Number(item.z), name: String(item.name || '') }));
    }
    if (detail.playerSpawn && Number.isFinite(Number(detail.playerSpawn.x))) {
      if (!radar.player || (radar.player.x === 0 && radar.player.z === 0)) {
        radar.player = {
          x: Number(detail.playerSpawn.x),
          z: Number(detail.playerSpawn.z),
          yaw: num(detail.playerSpawn.yaw, 0),
        };
      }
    }
    ui.data.worldReady = true;
  }

  /**
   * `game:stage` (CONTRACT §4): remember the campaign context and paint the
   * STAGE row inside the wave panel. Tolerates partial payloads.
   */
  _onStage(detail) {
    const ui = this.ui;
    const index = clamp(num(detail.index, num(detail.stageIndex, 1)), 1, 99);
    const total = clamp(num(detail.total, num(detail.stageTotal, index)), 1, 99);
    ui.data.stage = {
      stageId: typeof detail.stageId === 'string' ? detail.stageId : (ui.data.stage ? ui.data.stage.stageId : null),
      index,
      total,
      name: typeof detail.name === 'string' && detail.name ? detail.name : (ui.data.stage ? ui.data.stage.name : ''),
      subtitle: typeof detail.subtitle === 'string' ? detail.subtitle : (ui.data.stage ? ui.data.stage.subtitle : ''),
      waveCount: Math.max(1, num(detail.waveCount, ui.data.stage ? ui.data.stage.waveCount : ui.data.wave.total || 15)),
    };
    if (!ui.built) return;
    this.renderStage();
    this.renderWave();
  }

  /**
   * `game:difficulty` (CONTRACT §4): full tier object `{id,label,cn,hpMul,dmgMul}`
   * — also accepts the legacy `{ difficulty: 'standard'|'hardcore' }` string.
   */
  _onDifficulty(detail) {
    const ui = this.ui;
    let tier = null;
    if (detail && (detail.id || detail.label)) {
      const base = isDifficultyId(detail.id) ? getDifficulty(detail.id) : null;
      tier = {
        id: isDifficultyId(detail.id) ? detail.id : (base ? base.id : 'standard'),
        label: typeof detail.label === 'string' && detail.label ? detail.label : (base ? base.label : 'STANDARD'),
        cn: typeof detail.cn === 'string' ? detail.cn : (base ? base.cn : ''),
        hpMul: num(detail.hpMul, base ? base.hpMul : 1),
        dmgMul: num(detail.dmgMul, base ? base.dmgMul : 0.75),
        tone: typeof detail.tone === 'string' ? detail.tone : (base ? base.tone : 'normal'),
      };
    } else if (typeof detail.difficulty === 'string') {
      if (detail.difficulty === 'hardcore') {
        tier = { id: 'hardcore', label: 'HARDCORE', cn: '硬核', hpMul: 2, dmgMul: 1, tone: 'hard' };
      } else {
        tier = { ...getDifficulty(detail.difficulty) };
      }
    }
    if (!tier) return;
    ui.data.difficulty = tier;
    ui.data.stats.difficultyId = tier.id;
    ui.data.stats.difficulty = tier.id;
    if (!ui.built) return;
    this.renderWave();
  }

  _onStats(detail) {
    const ui = this.ui;
    const stats = ui.data.stats;
    // Merge defensively: events from different owners may be partial snapshots
    // (e.g. player.js emits heal stats without weapon fields).
    if (detail.maxHealth !== undefined) stats.maxHealth = clamp(num(detail.maxHealth, stats.maxHealth), 1, 10000);
    if (detail.maxArmor !== undefined) stats.maxArmor = clamp(num(detail.maxArmor, stats.maxArmor), 0, 10000);
    if (detail.health !== undefined) stats.health = clamp(num(detail.health, stats.health), 0, stats.maxHealth);
    if (detail.armor !== undefined) stats.armor = clamp(num(detail.armor, stats.armor), 0, stats.maxArmor);
    if (detail.magSize !== undefined) stats.magSize = clamp(num(detail.magSize, stats.magSize), 1, 999);
    if (detail.mag !== undefined) stats.mag = clamp(num(detail.mag, stats.mag), 0, stats.magSize);
    if (detail.reserve !== undefined) stats.reserve = Math.max(0, num(detail.reserve, stats.reserve));
    if (typeof detail.reloading === 'boolean') stats.reloading = detail.reloading;
    if (detail.reloadProgress !== undefined) stats.reloadProgress = clamp01(detail.reloadProgress);
    if (typeof detail.weaponName === 'string' && detail.weaponName.trim()) stats.weaponName = detail.weaponName.trim();
    if (typeof detail.ads === 'boolean') stats.ads = detail.ads;
    if (typeof detail.sprinting === 'boolean') stats.sprinting = detail.sprinting;
    if (typeof detail.alive === 'boolean') stats.alive = detail.alive;
    if (detail.damageMultiplier !== undefined) {
      stats.damageMultiplier = clamp(num(detail.damageMultiplier, stats.damageMultiplier), 1, 8);
    }
    if (detail.magExtension !== undefined) {
      stats.magExtension = clamp(num(detail.magExtension, stats.magExtension), 0, 999);
    }
    if (detail.reloadBonus !== undefined) {
      stats.reloadBonus = clamp(num(detail.reloadBonus, stats.reloadBonus ?? 0), 0, 0.85);
    }
    if (detail.difficulty === 'standard' || detail.difficulty === 'hardcore') stats.difficulty = detail.difficulty;
    if (detail.maxArmor !== undefined) stats.maxArmor = clamp(num(detail.maxArmor, stats.maxArmor), 1, 999);
    if (detail.damageReduction !== undefined) {
      stats.damageReduction = clamp(num(detail.damageReduction, stats.damageReduction ?? 0), 0, 0.9);
    }
    if (detail.healthBonus !== undefined) {
      stats.healthBonus = clamp(num(detail.healthBonus, stats.healthBonus ?? 0), 0, 9999);
    }
    // Campaign / loadout fields added by CONTRACT §4's `player:stats`; every one
    // of them is optional so older producers keep working.
    if (typeof detail.weaponMode === 'string' && detail.weaponMode) stats.weaponMode = detail.weaponMode;
    if (typeof detail.weaponType === 'string' && detail.weaponType) stats.weaponType = detail.weaponType;
    if (typeof detail.weaponShort === 'string' && detail.weaponShort) stats.weaponShort = detail.weaponShort;
    if (detail.slotIndex !== undefined) stats.slotIndex = clamp(Math.round(num(detail.slotIndex, stats.slotIndex || 0)), 0, 3);
    if (typeof detail.difficultyId === 'string' && isDifficultyId(detail.difficultyId)
      && (!ui.data.difficulty || ui.data.difficulty.id !== detail.difficultyId)) {
      this._onDifficulty({ id: detail.difficultyId });
    }
    if (typeof detail.stageId === 'string' && (!ui.data.stage || ui.data.stage.stageId !== detail.stageId)) {
      this._onStage({
        stageId: detail.stageId,
        index: detail.stageIndex,
        total: detail.stageTotal,
        name: detail.stageName,
      });
    }
    if (ui.built) {
      this.renderVitals();
      this.renderAmmo();
      this.renderCrosshairState();
      if (this._prevMag !== null && stats.mag < this._prevMag && ui.state === 'playing') {
        this._crosshairKick((this._prevMag - stats.mag) * 3.2);
      }
      this._prevMag = stats.mag;
    } else {
      this._prevMag = stats.mag;
    }
  }

  _onPlayerHit(detail) {
    const amount = Math.max(0, num(detail.amount, 0));
    let angle = num(detail.angle, NaN);
    const dir = detail.direction || {};
    if (!Number.isFinite(angle)) {
      const x = num(dir.x, 0);
      const y = num(dir.y, 1);
      angle = Math.atan2(x, y || 0.0001);
    }
    if (this.ui.built) {
      this._hurtArc(angle, clamp(amount / 35, 0.25, 1));
      if (amount > 6) this.flash('rgba(255,44,28,0.9)', clamp(0.12 + amount / 160, 0.12, 0.5), 320);
      if (detail.lowHealth) this.notice({ text: 'LOW HEALTH // 生命垂危', type: 'warn', kind: 'health' });
    }
  }

  _onHeal(detail) {
    const amount = Math.max(0, num(detail.amount, 0));
    if (!this.ui.built) return;
    this.flash('rgba(94,255,196,0.9)', clamp(0.08 + amount / 220, 0.08, 0.3), 420);
    this.notice({ text: `+${Math.round(amount)} VITALS // 生命恢复`, type: 'info', kind: 'heal' });
  }

  _onWaveStart(detail) {
    const ui = this.ui;
    const wave = clamp(num(detail.wave, 1), 1, 99);
    const total = clamp(num(detail.totalWaves, ui.data.wave.total || 15), 1, 99);
    const count = Math.max(0, num(detail.count, 0));
    ui.data.wave = {
      ...ui.data.wave,
      current: wave,
      total,
      remaining: count,
      count,
      initialCount: count,
      killed: 0,
      cleared: Math.max(0, wave - 1),
      label: typeof detail.label === 'string' ? detail.label : '',
    };
    ui.data.kills = ui.data.kills || 0;
    if (!ui.built) return;
    if (total !== this._pipTotal) this._buildPips(total);
    this.renderWave();
    this.renderObjective();
    this._hideIntermission();
    const label = ui.data.wave.label ? ` · ${ui.data.wave.label}` : '';
    this._showBanner({
      kicker: 'WAVE INBOUND // 敌军来袭',
      title: `WAVE ${pad2(wave)}`,
      sub: `${count} HOSTILES${label} // 敌军 ${count}`,
      kind: 'is-inbound',
      hold: 2600,
    });
  }

  _onWaveClear(detail) {
    const ui = this.ui;
    const wave = clamp(num(detail.wave, ui.data.wave.current), 1, 99);
    const total = clamp(num(detail.totalWaves, ui.data.wave.total || 15), 1, 99);
    const nextIn = Math.max(0, num(detail.nextIn, 6));
    const bonus = Math.max(0, num(detail.bonus, 0));
    ui.data.wave.current = wave;
    ui.data.wave.total = total;
    ui.data.wave.remaining = 0;
    ui.data.wave.cleared = wave;
    if (ui.data.wave.initialCount > 0) ui.data.wave.killed = ui.data.wave.initialCount;
    if (!ui.built) return;
    this.renderWave();
    this.renderObjective();
    this._showBanner({
      kicker: 'AREA CLEAR // 区域肃清',
      title: `WAVE ${pad2(wave)} CLEARED`,
      sub: bonus > 0 ? `+${Math.round(bonus)} BONUS // 波次奖励` : 'SECTOR CLEAR // 区域安全',
      kind: 'is-clear',
      hold: 2300,
    });
    this.renderBest();
    if (wave < total) {
      this._intermissionMax = Math.max(1, nextIn);
      this._intermissionNext = wave + 1;
      ui.later(() => {
        if (ui.data.wave.current === wave) this._showIntermission(nextIn, wave + 1);
      }, 1100);
    }
  }

  _onCountdown(detail) {
    const seconds = Math.max(0, num(detail.seconds, 0));
    const nextWave = Math.max(1, num(detail.nextWave, this.ui.data.wave.current + 1));
    this._intermissionNext = nextWave;
    if (!this.ui.built) return;
    this._showIntermission(seconds, nextWave);
  }

  _onKilled(detail) {
    const ui = this.ui;
    const headshot = !!detail.headshot;
    const points = Math.max(0, Math.round(num(detail.points, 0)));
    ui.data.kills = Math.max(0, num(ui.data.kills, 0)) + 1;
    const wave = ui.data.wave;
    wave.killed = Math.min(wave.initialCount || wave.killed + 1, wave.killed + 1);
    if (wave.remaining > 0) wave.remaining = Math.max(0, wave.remaining - 1);
    if (!ui.built) return;
    this._addKillFeed(detail, headshot);
    this._spawnScorePop(points, headshot);
    this.renderWave();
    this.renderScore();
    this.renderObjective();
  }

  _onHitmarker(detail) {
    const headshot = !!detail.headshot;
    const kill = !!detail.kill;
    if (!this.ui.built || this.ui.state !== 'playing') return;
    const marker = this.refs.hitmarker;
    if (!marker) return;
    marker.className = 'ch-hitmarker';
    void marker.offsetWidth;
    marker.classList.add('is-on');
    if (headshot) marker.classList.add('is-headshot');
    if (kill) marker.classList.add('is-kill');
    this._crosshairKick(headshot ? 9 : 5);
  }

  _onWeaponFired() {
    if (!this.ui.built || this.ui.state !== 'playing') return;
    this._crosshairKick(3.2);
  }

  /**
   * `weapon:slots` (CONTRACT §4): full 4-slot snapshot. Stored immediately, the
   * DOM is repainted on a ≤10 Hz timer so rapid fire/reload events cannot thrash
   * the HUD (weapons.js already rate-limits, this is belt-and-braces).
   */
  _onSlots(detail) {
    const raw = Array.isArray(detail.slots) ? detail.slots : null;
    if (!raw) return;
    const slots = raw.slice(0, 4).map((slot) => ({
      type: typeof slot.type === 'string' ? slot.type : '',
      name: typeof slot.name === 'string' ? slot.name : '',
      short: typeof slot.short === 'string' && slot.short ? slot.short : (typeof slot.name === 'string' ? slot.name : ''),
      owned: !!slot.owned,
      active: !!slot.active,
      mag: Math.max(0, num(slot.mag, 0)),
      magSize: Math.max(1, num(slot.magSize, 1)),
      reserve: Math.max(0, num(slot.reserve, 0)),
    }));
    while (slots.length < 4) slots.push({ type: '', name: '', short: '', owned: false, active: false, mag: 0, magSize: 1, reserve: 0 });
    const activeIndex = clamp(
      Math.round(num(detail.activeIndex, slots.findIndex((slot) => slot.active))),
      0, 3
    );
    this.ui.data.weaponSlots = {
      slots,
      activeIndex: activeIndex >= 0 ? activeIndex : 0,
      maxSlots: clamp(Math.round(num(detail.maxSlots, 4)), 1, 4),
    };
    if (activeIndex >= 0) this.ui.data.stats.slotIndex = activeIndex;
    if (!this.ui.built) return;
    this._scheduleSlotsRender();
  }

  _onSwitched(detail) {
    const ui = this.ui;
    const name = String(detail.name || detail.type || 'WEAPON').toUpperCase();
    if (detail.index !== undefined) ui.data.stats.slotIndex = clamp(Math.round(num(detail.index, 0)), 0, 3);
    if (!ui.built) return;
    if (!ui.data.weaponSlots) this.renderWeaponSlots();
    this.notice({ text: `SWITCHED · ${name} // 已切换武器`, type: 'info', kind: 'weapon' });
  }

  // --- Boss bar ------------------------------------------------------------

  _onBossSpawn(detail) {
    const ui = this.ui;
    const maxHp = Math.max(1, num(detail.maxHp, num(detail.hp, 1)));
    const hp = clamp(num(detail.hp, maxHp), 0, maxHp);
    ui.data.boss = {
      name: typeof detail.name === 'string' ? detail.name : 'boss',
      displayName: typeof detail.displayName === 'string' && detail.displayName
        ? detail.displayName
        : (typeof detail.name === 'string' ? detail.name : 'SIEGE WARDEN'),
      hp,
      maxHp,
      fraction: hp / maxHp,
      defeated: false,
    };
    if (!ui.built) return;
    if (this._bossHideTimer) {
      clearTimeout(this._bossHideTimer);
      this._bossHideTimer = 0;
    }
    this._showBossBar();
    this.renderBoss();
  }

  _onBossHealth(detail) {
    const ui = this.ui;
    const boss = ui.data.boss;
    if (!boss) return;
    const maxHp = Math.max(1, num(detail.maxHp, boss.maxHp));
    const hp = clamp(num(detail.hp, boss.hp), 0, maxHp);
    boss.maxHp = maxHp;
    boss.hp = hp;
    boss.fraction = clamp01(num(detail.fraction, hp / maxHp));
    if (!ui.built) return;
    this.renderBoss();
  }

  _onBossDefeated(detail) {
    const ui = this.ui;
    const boss = ui.data.boss;
    if (boss) {
      boss.hp = 0;
      boss.fraction = 0;
      boss.defeated = true;
      if (detail && typeof detail.displayName === 'string' && detail.displayName) boss.displayName = detail.displayName;
    }
    if (!ui.built) return;
    this.renderBoss();
    const bar = this.refs.bossBar;
    if (bar) bar.classList.add('is-dead');
    if (this._bossHideTimer) clearTimeout(this._bossHideTimer);
    this._bossHideTimer = setTimeout(() => {
      this._bossHideTimer = 0;
      if (!this._disposed) this._hideBossBar();
    }, 1200);
  }

  _showBossBar() {
    const bar = this.refs.bossBar;
    if (!bar) return;
    bar.classList.remove('is-dead');
    bar.classList.add('is-active');
    bar.setAttribute('aria-hidden', 'false');
    this._bossVisible = true;
  }

  _hideBossBar() {
    const bar = this.refs.bossBar;
    this._bossVisible = false;
    if (!bar) return;
    bar.classList.remove('is-active', 'is-dead');
    bar.setAttribute('aria-hidden', 'true');
    if (this.refs.bossFill) this.refs.bossFill.style.width = '0%';
  }

  /** Paint the boss bar from `ui.data.boss`. */
  renderBoss() {
    const boss = this.ui.data.boss;
    const bar = this.refs.bossBar;
    if (!bar) return;
    if (!boss) {
      this._hideBossBar();
      return;
    }
    if (this.refs.bossName) this.refs.bossName.textContent = boss.displayName || boss.name || 'BOSS';
    if (this.refs.bossHp) {
      this.refs.bossHp.textContent = boss.defeated
        ? 'DESTROYED // 已摧毁'
        : `${Math.max(0, Math.round(boss.hp))} / ${Math.round(boss.maxHp)}`;
      this.refs.bossHp.classList.toggle('is-dead', !!boss.defeated);
    }
    if (this.refs.bossFill) {
      const pct = boss.defeated ? 0 : clamp01(num(boss.fraction, boss.hp / Math.max(1, boss.maxHp))) * 100;
      this.refs.bossFill.style.width = `${pct.toFixed(1)}%`;
    }
    bar.dataset.fraction = String(clamp01(num(boss.fraction, 0)).toFixed(2));
    if (!this._bossVisible) this._showBossBar();
  }

  _onScore(detail) {
    const ui = this.ui;
    const score = Math.max(0, num(detail.score, ui.data.score.score));
    ui.data.score.score = score;
    ui.data.score.combo = Math.max(0, num(detail.combo, ui.data.score.combo));
    ui.data.score.multiplier = clamp(num(detail.multiplier, ui.data.score.multiplier), 0, 99);
    if (!ui.built) return;
    this.renderScore();
  }

  _onRadar(detail) {
    const radar = this.ui.data.radar;
    if (detail.player && typeof detail.player === 'object') {
      radar.player = {
        x: num(detail.player.x, radar.player.x),
        z: num(detail.player.z, radar.player.z),
        yaw: num(detail.player.yaw, radar.player.yaw),
      };
    }
    if (Array.isArray(detail.enemies)) {
      radar.enemies = detail.enemies
        .filter((enemy) => enemy && enemy.alive !== false && Number.isFinite(Number(enemy.x)) && Number.isFinite(Number(enemy.z)))
        .slice(0, 48)
        .map((enemy) => ({
          x: Number(enemy.x),
          z: Number(enemy.z),
          type: String(enemy.type || 'rifleman'),
          alive: true,
        }));
      if (this.ui.built && this.refs.radarHostiles) {
        this.refs.radarHostiles.textContent = pad2(radar.enemies.length);
      }
      // NOTE: do not override wave.remaining from radar. Radar only knows about
      // materialised robots; the wave director's count includes the spawn queue.
    }
    if (detail.bounds && typeof detail.bounds === 'object') {
      const b = detail.bounds;
      radar.bounds = {
        minX: num(b.minX, -34), maxX: num(b.maxX, 34),
        minZ: num(b.minZ, -34), maxZ: num(b.maxZ, 34),
      };
    }
  }

  _onNotice(detail) {
    const text = typeof detail.text === 'string' ? detail.text.trim() : '';
    if (!text) return;
    if (!this.ui.built) return;
    const type = detail.type === 'warn' ? 'warn' : 'info';
    this.notice({ text, type });
  }

  _onShake(detail) {
    const intensity = clamp(num(detail.intensity, 0), 0, 2);
    if (intensity <= 0) return;
    this._shake = Math.min(26, Math.max(this._shake, intensity * 16));
  }

  _onHitflash(detail) {
    if (!this.ui.built) return;
    let color = detail.color;
    if (typeof color === 'number') color = `#${Math.max(0, Math.min(0xffffff, color)).toString(16).padStart(6, '0')}`;
    if (typeof color !== 'string' || !color) color = 'rgba(255,196,128,0.85)';
    const strength = clamp(num(detail.strength, 0.25), 0, 1);
    this.flash(color, clamp(0.05 + strength * 0.35, 0.05, 0.55), 260);
  }

  // =========================================================================
  // Public rendering API
  // =========================================================================

  /** HUD half of the old `_syncAll`: repaint every static HUD plate. */
  renderAll() {
    if (!this.ui.built) return;
    this.renderVitals();
    this.renderAmmo();
    this.renderCrosshairState();
    this.renderScore();
    this.renderWave();
    this.renderObjective();
    this.renderWeaponSlots();
    this.renderBest();
  }

  renderVitals() {
    const ui = this.ui;
    const stats = ui.data.stats;
    const healthPct = stats.maxHealth > 0 ? stats.health / stats.maxHealth : 0;
    const armorPct = stats.maxArmor > 0 ? stats.armor / stats.maxArmor : 0;
    if (this.refs.health) this.refs.health.textContent = String(Math.round(stats.health));
    if (this.refs.armor) this.refs.armor.textContent = String(Math.round(stats.armor));
    if (this.refs.healthMax) this.refs.healthMax.textContent = `/${Math.round(stats.maxHealth)}`;
    if (this.refs.armorMax) this.refs.armorMax.textContent = `/${Math.round(stats.maxArmor)}`;
    this._fillSegments(this.refs.healthSeg, healthPct);
    this._fillSegments(this.refs.armorSeg, armorPct);
    if (this.refs.vitalBuffs) {
      const parts = [];
      const dr = Math.round(clamp01(stats.damageReduction ?? 0) * 100);
      const hp = Math.round(stats.healthBonus ?? 0);
      if (dr > 0) parts.push(`DR -${dr}%`);
      if (hp > 0) parts.push(`HP +${hp}`);
      this.refs.vitalBuffs.textContent = parts.join('  //  ');
      this.refs.vitalBuffs.classList.toggle('is-on', parts.length > 0);
    }
    const low = stats.alive && healthPct <= 0.35;
    const critical = stats.alive && healthPct <= 0.18;
    const root = ui.root;
    root.classList.toggle('is-low-health', low && ui.state === 'playing');
    root.classList.toggle('is-critical', critical && ui.state === 'playing');
    root.style.setProperty('--health-pct', healthPct.toFixed(3));
    if (this.refs.healthState) {
      let label = 'COMBAT READY';
      let cn = '状态正常';
      if (!stats.alive) { label = 'SIGNAL LOST'; cn = '生命体征归零'; }
      else if (critical) { label = 'CRITICAL'; cn = '危殆'; }
      else if (low) { label = 'WOUNDED'; cn = '受伤'; }
      this.refs.healthState.textContent = label;
      const holder = this.refs.healthState.parentElement;
      if (holder) {
        const em = holder.querySelector('em');
        if (em) em.textContent = cn;
      }
    }
  }

  _fillSegments(container, pct) {
    if (!container) return;
    const segments = container.children;
    const filled = Math.ceil(clamp01(pct) * segments.length - 0.0001);
    for (let i = 0; i < segments.length; i++) {
      segments[i].classList.toggle('on', i < filled);
    }
  }

  renderAmmo() {
    const ui = this.ui;
    const stats = ui.data.stats;
    if (this.refs.mag) this.refs.mag.textContent = String(Math.round(stats.mag));
    if (this.refs.reserve) this.refs.reserve.textContent = String(Math.round(stats.reserve));
    if (this.refs.weaponName) this.refs.weaponName.textContent = stats.weaponName;
    if (this.refs.ammoMode) {
      const label = weaponModeLabel(stats.weaponMode);
      if (this.refs.ammoMode.textContent !== label) this.refs.ammoMode.textContent = label;
      this.refs.ammoMode.dataset.mode = String(stats.weaponMode || 'auto');
    }
    if (this.refs.magTicks && this._ammoTickCount !== stats.magSize) this._buildAmmoTicks(stats.magSize);
    if (this.refs.magTicks) {
      const ticks = this.refs.magTicks.children;
      for (let i = 0; i < ticks.length; i++) ticks[i].classList.toggle('on', i < stats.mag);
    }
    const low = stats.mag <= stats.magSize * 0.25;
    const empty = stats.mag <= 0;
    ui.root.classList.toggle('is-low-ammo', low);
    ui.root.classList.toggle('is-empty', empty);
    if (this.refs.ammoLoot) {
      const dmg = Math.round(((stats.damageMultiplier ?? 1) - 1) * 100);
      const mag = Math.round(stats.magExtension ?? 0);
      const rld = Math.round((stats.reloadBonus ?? 0) * 100);
      const parts = [];
      if (mag > 0) parts.push(`MAG +${mag}`);
      if (dmg > 0) parts.push(`DMG +${dmg}%`);
      if (rld > 0) parts.push(`RLD -${rld}%`);
      const upgraded = parts.length > 0;
      this.refs.ammoLoot.textContent = upgraded ? parts.join('  //  ') : '';
      this.refs.ammoLoot.classList.toggle('is-on', upgraded);
    }
    if (this.refs.reload) {
      this.refs.reload.classList.toggle('is-on', !!stats.reloading);
      if (this.refs.reloadFill) {
        this.refs.reloadFill.style.width = `${Math.round(clamp01(stats.reloadProgress) * 100)}%`;
      }
    }
    // Without a weapon:slots snapshot yet, at least keep the active-slot
    // highlight in sync with the `player:stats` slotIndex fallback.
    if (!ui.data.weaponSlots) this._setActiveSlot(num(stats.slotIndex, 0));
  }

  /** Highlight one slot in the weapon strip (0-3). */
  _setActiveSlot(index) {
    const nodes = this._slotNodes;
    if (!nodes || !nodes.length) return;
    const active = clamp(Math.round(num(index, 0)), 0, nodes.length - 1);
    for (let i = 0; i < nodes.length; i++) nodes[i].classList.toggle('is-active', i === active);
  }

  /**
   * Paint the 4-slot weapon strip from `ui.data.weaponSlots` (fallback: the
   * current-weapon `player:stats` snapshot).
   */
  renderWeaponSlots() {
    const nodes = this._slotNodes;
    if (!nodes || !nodes.length) return;
    const data = this.ui.data.weaponSlots;
    const stats = this.ui.data.stats;
    let activeIndex = data ? data.activeIndex : num(stats.slotIndex, 0);
    activeIndex = clamp(Math.round(num(activeIndex, 0)), 0, nodes.length - 1);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const slot = data ? data.slots[i] : null;
      let owned;
      let name;
      let mag;
      let reserve;
      if (slot) {
        owned = !!slot.owned && !!slot.type;
        name = slot.short || slot.name || String(slot.type || '').toUpperCase();
        mag = slot.mag;
        reserve = slot.reserve;
        if (slot.type) node.dataset.slotType = slot.type;
        else delete node.dataset.slotType;
      } else {
        owned = !data && i === activeIndex;
        name = owned ? (stats.weaponShort || stats.weaponName || 'VXR-7') : 'EMPTY';
        mag = owned ? stats.mag : 0;
        reserve = owned ? stats.reserve : 0;
      }
      node.classList.toggle('is-empty', !owned);
      node.classList.toggle('is-active', owned && i === activeIndex);
      node.setAttribute('aria-disabled', String(!owned));
      node.disabled = false; // visual-only control (slot strip is not clickable in HUD)
      const nameEl = node.querySelector('.wslot-name');
      if (nameEl) nameEl.textContent = owned ? (name || '—') : 'EMPTY';
      const ammoEl = node.querySelector('.wslot-ammo b');
      if (ammoEl) ammoEl.textContent = owned ? String(Math.round(num(mag, 0))) : '—';
      const reserveEl = node.querySelector('.wslot-ammo span');
      // The `/` separator lives in `<i>`; the trailing span only carries the
      // reserve count (empty for unowned slots).
      if (reserveEl) reserveEl.textContent = owned ? String(Math.round(num(reserve, 0))) : '';
      const dividerEl = node.querySelector('.wslot-ammo i');
      if (dividerEl) dividerEl.style.display = owned ? '' : 'none';
    }
  }

  /** Coalesce `weapon:slots` bursts into at most one repaint per 100 ms. */
  _scheduleSlotsRender() {
    if (this._slotsTimer) {
      this._slotsDirty = true;
      return;
    }
    this._slotsTimer = this.ui.later(() => {
      this._slotsTimer = 0;
      if (this._disposed) return;
      this.renderWeaponSlots();
      if (this._slotsDirty) {
        this._slotsDirty = false;
        this._scheduleSlotsRender();
      }
    }, 100);
  }

  renderCrosshairState() {
    if (!this.ui.built) return;
    const stats = this.ui.data.stats;
    const gap = stats.ads ? 5 : stats.sprinting ? 25 : stats.reloading ? 18 : 13;
    this.ui.root.classList.toggle('is-ads', !!stats.ads);
    this.ui.root.classList.toggle('is-sprint', !!stats.sprinting);
    this.ui.root.style.setProperty('--ch-gap', `${gap}px`);
    this.ui.root.style.setProperty('--ch-op', stats.ads ? '0.86' : '0.94');
  }

  _crosshairKick(amount = 6) {
    if (!this.ui.built) return;
    this.ui.root.style.setProperty('--ch-kick', `${clamp(amount, 2, 14).toFixed(1)}px`);
    this.ui.root.classList.add('is-firing');
    if (this._kickTimer) clearTimeout(this._kickTimer);
    this._kickTimer = setTimeout(() => {
      if (this._disposed) return;
      this.ui.root.style.setProperty('--ch-kick', '0px');
      this.ui.root.classList.remove('is-firing');
    }, 110);
  }

  renderScore() {
    const { score, multiplier } = this.ui.data.score;
    if (this.refs.score) this.refs.score.textContent = fmtScore(score);
    if (this.refs.combo) this.refs.combo.textContent = `×${Number(multiplier || 1).toFixed(1)}`;
    if (this.refs.kills) this.refs.kills.textContent = String(Math.round(this.ui.data.kills));
    this.ui.root.classList.toggle('is-combo-hot', multiplier >= 2);
  }

  renderWave() {
    const ui = this.ui;
    const wave = ui.data.wave;
    const current = clamp(wave.current || 1, 1, wave.total || 15);
    if (this.refs.waveCurrent) this.refs.waveCurrent.textContent = pad2(current);
    if (this.refs.waveTotal) this.refs.waveTotal.textContent = pad2(wave.total || 15);
    if (this.refs.waveRemaining) this.refs.waveRemaining.textContent = pad2(wave.remaining || 0);
    if (this.refs.waveState) {
      let state = 'STANDBY';
      if (ui.state === 'playing') state = 'LIVE';
      else if (ui.state === 'paused') state = 'HOLD';
      else if (ui.state === 'dead') state = 'LOST';
      else if (ui.state === 'victory') state = 'CLEAR';
      this.refs.waveState.textContent = state;
    }
    if (this.refs.wavePips) {
      const pips = this.refs.wavePips.children;
      for (let i = 0; i < pips.length; i++) {
        pips[i].classList.toggle('is-done', i < (wave.cleared || 0));
        pips[i].classList.toggle('is-current', i === current - 1 && ui.state !== 'menu');
      }
    }
    if (this.refs.objectiveWave) this.refs.objectiveWave.textContent = `WAVE ${pad2(current)}`;
    if (this.refs.waveMode) {
      const tier = ui.data.difficulty;
      const legacy = ui.data.stats.difficulty;
      const tone = tier ? diffTone(tier.tone) : (legacy === 'hardcore' ? 'hard' : 'normal');
      const label = tier
        ? tier.label
        : (legacy === 'hardcore' ? 'HARDCORE' : 'STANDARD');
      const cn = tier && tier.cn ? ` ${tier.cn}` : '';
      this.refs.waveMode.textContent = `${label}${cn}`;
      this.refs.waveMode.classList.remove('is-easy', 'is-normal', 'is-hard', 'is-nightmare', 'is-hardcore');
      this.refs.waveMode.classList.add(`is-${tone}`);
      if (legacy === 'hardcore' && !tier) this.refs.waveMode.classList.add('is-hardcore');
      this.refs.waveMode.dataset.tone = tone;
      this.refs.waveMode.title = tier
        ? `ENEMY HP ×${fmtMul(tier.hpMul)} // ENEMY DMG ×${fmtMul(tier.dmgMul)}`
        : '';
    }
    this.renderStage();
  }

  /** Paint the STAGE row inside the wave panel (`game:stage` / `player:stats`). */
  renderStage() {
    const ui = this.ui;
    const stage = ui.data.stage;
    if (this.refs.stageIndex) {
      this.refs.stageIndex.textContent = stage
        ? fmtStageCounter(stage.index, stage.total)
        : '--/--';
    }
    if (this.refs.stageLabel) {
      this.refs.stageLabel.textContent = stage ? (stage.name || '—') : '—';
      this.refs.stageLabel.classList.toggle('is-empty', !stage);
    }
    if (this.refs.waveStage) this.refs.waveStage.classList.toggle('is-empty', !stage);
  }

  renderObjective() {
    if (!this.refs.objectiveFill) return;
    const wave = this.ui.data.wave;
    const total = Math.max(1, wave.total || 15);
    const inWave = wave.initialCount > 0 ? clamp((wave.killed || 0) / wave.initialCount, 0, 1) : 0;
    const clearedWaves = wave.cleared || 0;
    const progress = clamp((clearedWaves + inWave) / total, 0, 1);
    this.refs.objectiveFill.style.width = `${(progress * 100).toFixed(1)}%`;
  }

  renderBest() {
    if (this.refs.best) this.refs.best.textContent = fmtScore(this.ui.best);
  }

  // =========================================================================
  // Transient feedback elements
  // =========================================================================

  /** Push a notice row into the HUD notice stack (merge-queued, 3 rows max). */
  notice({ text, type = 'info', kind = '' }) {
    const wrap = this.refs.notices;
    if (!wrap) return;
    // Collapse duplicate consecutive notices (e.g. spammy pickups).
    const last = wrap.lastElementChild;
    if (last && last.dataset.text === text) {
      last.classList.remove('is-on');
      void last.offsetWidth;
      last.classList.add('is-on');
      return;
    }
    const row = document.createElement('div');
    row.className = `notice${type === 'warn' ? ' is-warn' : ''}${kind ? ` notice--${kind}` : ''}`;
    row.dataset.text = text;
    const tag = document.createElement('span');
    tag.className = 'notice-tag';
    tag.textContent = type === 'warn' ? '!' : '▸';
    const body = document.createElement('span');
    body.className = 'notice-text';
    body.textContent = text;
    row.append(tag, body);
    wrap.appendChild(row);
    while (wrap.children.length > 3) wrap.firstElementChild.remove();
    this.ui.later(() => {
      row.classList.add('is-out');
      this.ui.later(() => row.remove(), 280);
    }, 3300);
  }

  /** Full-screen colour flash (damage / heal / hit flash). */
  flash(color, strength, duration = 300) {
    if (!this.ui.built) return;
    const el = this.refs.flash;
    if (!el) return;
    el.style.setProperty('--flash-color', color);
    el.style.setProperty('--flash-i', String(clamp(strength, 0.02, 0.7)));
    el.style.setProperty('--flash-dur', `${duration}ms`);
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
  }

  _addKillFeed(detail, headshot) {
    const feed = this.refs.killfeed;
    if (!feed) return;
    const name = String(detail.name || 'HOSTILE').slice(0, 42).toUpperCase();
    const points = Math.max(0, Math.round(num(detail.points, 0)));
    const combo = Math.max(0, num(detail.combo, 0));
    const row = document.createElement('div');
    row.className = `feed-row${headshot ? ' is-headshot' : ''}`;
    const ico = document.createElement('span');
    ico.className = 'feed-ico';
    ico.textContent = headshot ? '◈' : '✕';
    const weapon = document.createElement('span');
    weapon.className = 'feed-weapon';
    weapon.textContent = 'VXR-7';
    const arrow = document.createElement('span');
    arrow.className = 'feed-arrow';
    arrow.textContent = '▸';
    const target = document.createElement('span');
    target.className = 'feed-name';
    target.textContent = name;
    row.append(ico, weapon, arrow, target);
    if (headshot) {
      const tag = document.createElement('span');
      tag.className = 'feed-tag';
      tag.textContent = 'HEADSHOT';
      row.appendChild(tag);
    }
    if (points > 0) {
      const pts = document.createElement('span');
      pts.className = 'feed-points';
      pts.textContent = `+${points}`;
      row.appendChild(pts);
    }
    if (combo > 1) {
      const cb = document.createElement('span');
      cb.className = 'feed-combo';
      cb.textContent = `×${Math.round(combo)}`;
      row.appendChild(cb);
    }
    feed.prepend(row);
    while (feed.children.length > 5) feed.lastElementChild.remove();
    const timer = setTimeout(() => {
      this._feedTimers.delete(timer);
      row.classList.add('is-out');
      const removeTimer = setTimeout(() => {
        this._feedTimers.delete(removeTimer);
        row.remove();
      }, 260);
      this._feedTimers.add(removeTimer);
    }, 4600);
    this._feedTimers.add(timer);
  }

  _spawnScorePop(points, headshot) {
    const wrap = this.refs.scorePops;
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = `score-pop${headshot ? ' is-headshot' : ''}`;
    el.textContent = `${headshot ? '◈' : ''}+${Math.round(points)}`;
    el.style.left = `${57 + rand(0, 7)}%`;
    el.style.top = `${56 + rand(0, 7)}%`;
    wrap.appendChild(el);
    if (wrap.children.length > 7) wrap.firstElementChild.remove();
    this.ui.later(() => el.remove(), 980);
  }

  _showBanner({ kicker, title, sub, kind = '', hold = 2400 }) {
    if (!this.ui.built) return;
    if (this._bannerTimer) {
      clearTimeout(this._bannerTimer);
      this._bannerTimer = 0;
    }
    const banner = this.refs.banner;
    if (!banner) return;
    this.refs.bannerKicker.textContent = kicker;
    this.refs.bannerTitle.textContent = title;
    this.refs.bannerSub.textContent = sub;
    banner.className = `wave-banner is-on ${kind}`.trim();
    this._bannerTimer = setTimeout(() => {
      this._bannerTimer = 0;
      if (!this._disposed && banner) banner.classList.remove('is-on');
    }, hold);
  }

  _showIntermission(seconds, nextWave) {
    if (!this.ui.built) return;
    const panel = this.refs.intermission;
    if (!panel) return;
    this._intermissionMax = Math.max(this._intermissionMax, seconds, 1);
    this._intermissionNext = nextWave;
    this.refs.intTime.textContent = pad2(Math.ceil(seconds));
    this.refs.intLabel.textContent = `WAVE ${pad2(nextWave)} // 准备`;
    if (this.refs.intFill) {
      const pct = clamp(seconds / this._intermissionMax, 0, 1);
      this.refs.intFill.style.width = `${(pct * 100).toFixed(1)}%`;
    }
    panel.classList.add('is-on');
  }

  _hideIntermission() {
    if (this.ui.built && this.refs.intermission) this.refs.intermission.classList.remove('is-on');
  }

  _hurtArc(angle, strength) {
    if (!this._arcEls.length) return;
    const arc = this._arcEls[this._arcIndex % this._arcEls.length];
    this._arcIndex += 1;
    const degrees = (angle * 180) / Math.PI;
    arc.style.setProperty('--a', `${degrees.toFixed(1)}deg`);
    arc.style.setProperty('--i', String(clamp(0.4 + strength, 0.35, 1)));
    arc.classList.remove('is-on');
    void arc.offsetWidth;
    arc.classList.add('is-on');
  }

  // =========================================================================
  // Frame loop — HUD shake decay + ~30 Hz radar
  // =========================================================================

  tick(now, dt) {
    if (this._disposed) return;
    // HUD shake decay.
    if (this._shake > 0.08) {
      this._shake *= Math.exp(-9 * dt);
      const hud = this.refs.hud;
      if (hud) {
        const x = rand(-1, 1) * this._shake;
        const y = rand(-1, 1) * this._shake * 0.7;
        const r = rand(-1, 1) * this._shake * 0.03;
        hud.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${r.toFixed(2)}deg)`;
        this._wasShaking = true;
      }
    } else if (this._wasShaking) {
      this._shake = 0;
      this._wasShaking = false;
      const hud = this.refs.hud;
      if (hud) hud.style.transform = '';
    }

    // Radar ~30 Hz only while the HUD is live.
    if (this.ui.state === 'playing' && now - this._lastRadarDraw > 32) {
      this._lastRadarDraw = now;
      this._drawRadar(now);
    }
  }

  // =========================================================================
  // Radar
  // =========================================================================

  _drawRadar(now) {
    const canvas = this.refs.radarCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const R = W / 2 - 10;
    const radar = this.ui.data.radar;
    const yaw = num(radar.player.yaw, 0);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const range = clamp(num(radar.range, 42), 20, 80);
    const k = R / range;
    const px = num(radar.player.x, 0);
    const pz = num(radar.player.z, 0);

    const project = (x, z) => {
      const dx = x - px;
      const dz = z - pz;
      return { x: dx * cos - dz * sin, y: dx * sin + dz * cos, dist: Math.hypot(dx, dz) };
    };

    ctx.clearRect(0, 0, W, H);

    // Plate wash.
    const plate = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    plate.addColorStop(0, 'rgba(10, 18, 21, 0.72)');
    plate.addColorStop(0.72, 'rgba(7, 12, 14, 0.62)');
    plate.addColorStop(1, 'rgba(4, 7, 8, 0.78)');
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // Rings + crosshairs.
    ctx.save();
    ctx.strokeStyle = 'rgba(124, 231, 255, 0.16)';
    ctx.lineWidth = 1.2;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(124, 231, 255, 0.07)';
    ctx.setLineDash([4, 10]);
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Bearing ticks every 30 degrees.
    ctx.save();
    ctx.translate(cx, cy);
    for (let deg = 0; deg < 360; deg += 30) {
      ctx.save();
      ctx.rotate((deg * Math.PI) / 180 - yaw);
      ctx.strokeStyle = deg % 90 === 0 ? 'rgba(246, 226, 192, 0.42)' : 'rgba(246, 226, 192, 0.16)';
      ctx.beginPath();
      ctx.moveTo(0, -R + 3);
      ctx.lineTo(0, -R + (deg % 90 === 0 ? 13 : 8));
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // Landmarks.
    if (radar.landmarks && radar.landmarks.length) {
      ctx.save();
      ctx.font = '600 15px Bahnschrift, "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const mark of radar.landmarks) {
        const local = project(mark.x, mark.z);
        let x = local.x * k;
        let y = local.y * k;
        const len = Math.hypot(x, y);
        const clamped = len > R * 0.94;
        if (clamped) {
          const scale = (R * 0.94) / (len || 1);
          x *= scale; y *= scale;
        }
        const sx = cx + x;
        const sy = cy + y;
        ctx.fillStyle = clamped ? 'rgba(246, 226, 192, 0.25)' : 'rgba(246, 226, 192, 0.52)';
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-3, -3, 6, 6);
        ctx.restore();
        if (!clamped && mark.name) {
          const label = String(mark.name).slice(0, 12).toUpperCase();
          ctx.fillStyle = 'rgba(246, 226, 192, 0.42)';
          ctx.fillText(label, sx + 7, sy + 1);
        }
      }
      ctx.restore();
    }

    // Enemies.
    const enemyColor = (type) => {
      const t = String(type).toLowerCase();
      if (t.includes('heavy') || t.includes('warlord')) return 'rgba(255, 86, 66, 0.96)';
      if (t.includes('scout')) return 'rgba(124, 231, 255, 0.96)';
      return 'rgba(255, 158, 74, 0.96)';
    };
    for (const enemy of radar.enemies) {
      const local = project(enemy.x, enemy.z);
      let x = local.x * k;
      let y = local.y * k;
      const len = Math.hypot(x, y);
      const clamped = len > R * 0.95;
      if (clamped) {
        const scale = (R * 0.95) / (len || 1);
        x *= scale; y *= scale;
      }
      const sx = cx + x;
      const sy = cy + y;
      const color = enemyColor(enemy.type);
      ctx.save();
      if (clamped) {
        ctx.translate(sx, sy);
        ctx.rotate(Math.atan2(y, x) + Math.PI / 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -7);
        ctx.lineTo(5, 4);
        ctx.lineTo(-5, 4);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Sweep.
    const sweep = ((now * 0.00042) % 1) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sweep);
    if (typeof ctx.createConicGradient === 'function') {
      const cone = ctx.createConicGradient(-0.42, 0, 0);
      cone.addColorStop(0, 'rgba(124, 231, 255, 0)');
      cone.addColorStop(0.085, 'rgba(124, 231, 255, 0.20)');
      cone.addColorStop(0.12, 'rgba(124, 231, 255, 0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(124, 231, 255, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(R * 0.96, 0);
    ctx.stroke();
    ctx.restore();

    // Center player chevron.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(255, 232, 198, 0.96)';
    ctx.shadowColor = 'rgba(255, 158, 74, 0.9)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // North marker.
    const nx = cx + sin * R * 0.86;
    const ny = cy - cos * R * 0.86;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 158, 74, 0.92)';
    ctx.font = '700 16px Bahnschrift, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);
    ctx.restore();

    // Bearing readout.
    const heading = (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
    if (this.refs.bearing) this.refs.bearing.textContent = `${String(Math.round(heading)).padStart(3, '0')}°`;
  }

  // =========================================================================
  // Lifecycle (called by the UI core)
  // =========================================================================

  /** HUD part of the old `_setScreen`: repaint plates that depend on the state. */
  setScreen(name) {
    const ui = this.ui;
    if (!ui.built) return;
    this.renderWave();
    if (name === 'menu') {
      this._hideIntermission();
    }
    if (name !== 'playing' && name !== 'paused') this._hideBossBar();
    if (name === 'playing') {
      ui.root.classList.remove('is-dying', 'is-victorious');
      this._prevMag = ui.data.stats.mag;
      this.renderVitals();
      this.renderAmmo();
      this.renderWeaponSlots();
      this.renderCrosshairState();
    }
    this.renderVitals();
  }

  /** Reset the combat data + HUD DOM for a fresh run (old `_resetRun`). */
  resetRun() {
    const ui = this.ui;
    this._prevMag = null;
    ui.data.stats = {
      health: 100, maxHealth: 100, armor: 100, maxArmor: 100,
      mag: 30, magSize: 30, reserve: 300, reloading: false, reloadProgress: 0,
      weaponName: 'VXR-7 突击步枪', weaponType: 'vxr7', weaponMode: 'auto', weaponShort: 'VXR-7', slotIndex: 0,
      ads: false, sprinting: false, alive: true,
      damageMultiplier: 1, magExtension: 0, reloadBonus: 0,
      damageReduction: 0, healthBonus: 0,
    };
    ui.data.wave = {
      current: 1, total: 15, remaining: 0, label: '', count: 0, initialCount: 0, killed: 0, cleared: 0,
    };
    ui.data.score = { score: 0, combo: 0, multiplier: 1 };
    ui.data.kills = 0;
    ui.data.end = null;
    ui.data.result = null;
    ui.data.weaponSlots = null;
    ui.data.boss = null;
    if (this._bossHideTimer) {
      clearTimeout(this._bossHideTimer);
      this._bossHideTimer = 0;
    }
    if (ui.built) {
      this.refs.killfeed.replaceChildren();
      this.refs.notices.replaceChildren();
      this.refs.scorePops.replaceChildren();
      this.refs.banner.classList.remove('is-on');
      this._hideIntermission();
      this._hideBossBar();
      this.renderWeaponSlots();
      ui.root.classList.remove(
        'is-low-health', 'is-critical', 'is-low-ammo', 'is-empty',
        'is-ads', 'is-sprint', 'is-combo-hot', 'is-dying', 'is-victorious',
      );
      ui.root.style.setProperty('--ch-kick', '0px');
      this.renderVitals();
      this.renderAmmo();
      this.renderCrosshairState();
      this.renderScore();
      this.renderWave();
      this.renderObjective();
    }
  }

  /** Swap the ammo hint between keyboard and pad glyphs (old `_syncControlHints` HUD half). */
  refreshHints() {
    if (!this.ui.built) return;
    const hints = this.ui.padHintsActive() ? HINTS_GAMEPAD : HINTS_KEYBOARD;
    if (this.refs.ammoHint && this.refs.ammoHint.innerHTML !== hints.ammo) this.refs.ammoHint.innerHTML = hints.ammo;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._offBus) {
      this._offBus();
      this._offBus = null;
    }
    for (const id of this._feedTimers) clearTimeout(id);
    this._feedTimers.clear();
    if (this._kickTimer) {
      clearTimeout(this._kickTimer);
      this._kickTimer = 0;
    }
    if (this._bannerTimer) {
      clearTimeout(this._bannerTimer);
      this._bannerTimer = 0;
    }
    if (this._bossHideTimer) {
      clearTimeout(this._bossHideTimer);
      this._bossHideTimer = 0;
    }
    this._arcEls = [];
    this._slotNodes = [];
  }

  // =========================================================================
  // JS-built sub-elements
  // =========================================================================

  _buildSegments(container, count) {
    if (!container) return;
    container.replaceChildren();
    for (let i = 0; i < count; i++) {
      const segment = document.createElement('i');
      container.appendChild(segment);
    }
  }

  _buildPips(total) {
    const container = this.refs.wavePips;
    if (!container) return;
    container.replaceChildren();
    container.classList.toggle('is-many', total > 8);
    for (let i = 0; i < total; i++) {
      const pip = document.createElement('i');
      pip.className = 'pip';
      container.appendChild(pip);
    }
    this._pipTotal = total;
  }

  _buildAmmoTicks(count) {
    const container = this.refs.magTicks;
    if (!container) return;
    container.replaceChildren();
    for (let i = 0; i < count; i++) {
      const tick = document.createElement('i');
      container.appendChild(tick);
    }
    this._ammoTickCount = count;
  }

  _buildArcs(count) {
    const container = this.refs.arcs;
    if (!container) return;
    container.replaceChildren();
    this._arcEls = [];
    for (let i = 0; i < count; i++) {
      const arc = document.createElement('i');
      arc.className = 'dmg-arc';
      container.appendChild(arc);
      this._arcEls.push(arc);
    }
  }

  /** Cache the 4 handmade `.wslot` buttons from the HUD markup. */
  _buildWeaponSlots() {
    const wrap = this.refs.weaponSlots;
    this._slotNodes = wrap ? Array.from(wrap.querySelectorAll('.wslot')) : [];
  }
}

export default HudPanel;
