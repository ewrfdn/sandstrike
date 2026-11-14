/**
 * Boot / home screens for the modular UI under `src/ui/`.
 *
 * Owns the `loading` and `menu` sections of the `.ui-shell`: their markup, refs
 * and the small per-screen rendering (boot progress + tips rotation, menu clock,
 * best score and the CAMPAIGN / NEW GAME / CONTINUE / SELECT STAGE action area).
 *
 * Campaign progression is READ-ONLY here: `src/save.js` `loadProgress()` /
 * `summary()` are re-read every time the menu is repainted (boot, return from a
 * run, after a stage clear), so the CONTINUE target and the save summary always
 * reflect the latest save the game wrote.
 *
 * Start/deploy/settings actions belong to the core `index.js`; this panel only
 * reports readiness, the campaign summary and its own subtree.
 *
 * Module map: see `.scratch/features/CONTRACT.md` §8.
 */
import {
  HINTS_GAMEPAD,
  HINTS_KEYBOARD,
  TIPS,
  bindBus,
  clamp01,
  fmtScore,
  fmtStageCounter,
  pad2,
  q,
} from './shared.js';
import { DEFAULT_DIFFICULTY_ID, getDifficulty, isDifficultyId } from '../config/difficulty.js';
import { getStage } from '../config/stages.js';
import { loadProgress, summary } from '../save.js';
import { settingsMarkup } from './settings.js';
import { stageSelectMarkup } from './overlays.js';

/** Loading tip the core picked before this markup exists (stable fallback 0). */
function tipIndexOf(ui) {
  const raw = Number(ui && ui.tipIndex);
  if (!Number.isFinite(raw)) return 0;
  const index = Math.floor(raw) % TIPS.length;
  return index < 0 ? index + TIPS.length : index;
}

/** Loading screen markup (`data-screen-panel="loading"`). */
export function loadingMarkup(ui) {
  const tip = TIPS[tipIndexOf(ui)];
  return `
      <section class="screen screen--loading is-active" data-screen-panel="loading">
        <div class="loading-inner">
          <header class="loading-top">
            <div class="brand"><span class="brand-glyph">◤</span><span class="brand-text">SANDSTRIKE <b>//</b> 沙暴协议</span></div>
            <div class="loading-telemetry">
              <span>OPS-07 / DUST BASIN</span><span>34.2°N 69.1°E</span><span class="tel-live">UPLINK <i></i></span>
            </div>
          </header>
          <div class="loading-core">
            <div class="loading-kicker">SYSTEM BOOT // 系统启动</div>
            <div class="loading-percent"><span data-load-pct>000</span><i>%</i></div>
            <div class="loading-track"><div class="loading-fill" data-load-fill></div><div class="loading-ticks"></div></div>
            <div class="loading-row">
              <span data-load-label>INITIALIZING RENDERER</span>
              <span data-load-phase>BOOT 01/04</span>
            </div>
            <div class="loading-tip">
              <span class="tip-k">FIELD NOTE // 战术提示</span>
              <span class="tip-en" data-tip-en>${tip.en}</span>
              <span class="tip-cn" data-tip-cn>${tip.cn}</span>
            </div>
          </div>
          <footer class="loading-bottom">
            <div class="loading-spec">WEBGL2 · PROCEDURAL TEXTURES · SYNTHESIZED AUDIO · NO EXTERNAL ASSETS</div>
            <div class="loading-legal">BUILD 1.0.0 // SANDSTRIKE PROJECT</div>
          </footer>
        </div>
        <div class="screen-frame"></div>
      </section>`;
}

/**
 * Main menu markup (`data-screen-panel="menu"`).
 *
 * Layout kept from the single-start build: topbar band, title / brief / actions,
 * meta strip and bottombar. Only the action column (NEW GAME / CONTINUE /
 * SELECT STAGE / SYSTEM CONFIG), the save summary line and the embedded
 * stage-select overlay are new.
 */
export function homeMarkup(ui) {
  void ui;
  return `
      <section class="screen screen--menu" data-screen-panel="menu">
        <div class="menu-scrim"></div>
        <div class="menu-topbar">
          <div class="tb-left"><span class="tb-dot"></span> UPLINK SECURE <em>链路正常</em></div>
          <div class="tb-mid">OPS-07 // DUST BASIN // 34.2°N 69.1°E</div>
          <div class="tb-right"><span class="tb-perf" data-menu-perf aria-hidden="true">FRAME <b data-menu-fps>--</b> FPS <i>·</i> <b data-menu-ms>--</b> MS</span>LOCAL <span data-menu-clock>--:--:--</span></div>
        </div>
        <div class="menu-body">
          <div class="menu-main">
            <div class="menu-eyebrow"><i></i> TACTICAL COMBAT SIMULATION <em>战术作战模拟</em></div>
            <h1 class="title">
              <span class="title-en">SANDSTRIKE</span>
              <span class="title-line"><span class="title-slash">//</span><span class="title-cn">沙暴协议</span></span>
            </h1>
            <div class="menu-sub">DUST BASIN OUTPOST <i>·</i> CAMPAIGN SURVIVAL <i>·</i> MACHINE LEGION</div>
            <p class="menu-brief">
              <span class="brief-en">A compromised research outpost in the DUST BASIN. Hostile machine columns are inbound across escalating waves. Hold the sector, clear every contact, then push to the next stage.</span>
              <span class="brief-cn">沙暴协议已启动：敌方机械军团正逼近废弃前哨站。肃清全部波次并通关，解锁战役的下一关。</span>
            </p>
            <div class="menu-actions">
              <button class="mbtn mbtn--primary" type="button" data-action="start" data-start disabled>
                <span class="mbtn-ico">▶</span>
                <span class="mbtn-copy"><b data-start-label>AWAITING UPLINK</b><em data-start-sub>链路建立中</em></span>
                <span class="mbtn-key">···</span>
              </button>
              <button class="mbtn mbtn--continue" type="button" data-action="continue" disabled>
                <span class="mbtn-ico">▸</span>
                <span class="mbtn-copy"><b>CONTINUE</b><em data-continue-target>继续战役</em></span>
              </button>
              <button class="mbtn mbtn--stage" type="button" data-action="stage-select" disabled>
                <span class="mbtn-ico">▦</span>
                <span class="mbtn-copy"><b>SELECT STAGE</b><em>选择关卡</em></span>
              </button>
              <button class="mbtn mbtn--ghost" type="button" data-action="focus-settings">
                SYSTEM CONFIG <em>系统设置</em><span class="mbtn-key">+</span>
              </button>
            </div>
            <div class="menu-save">
              <span class="ms-k">SAVE // 存档</span>
              <span class="ms-v" data-save-summary>NO SAVE // NEW CAMPAIGN REQUIRED</span>
            </div>
            <div class="menu-meta">
              <div class="meta"><span class="meta-k">THREAT LEVEL</span><span class="meta-v danger">SEVERE</span></div>
              <div class="meta"><span class="meta-k">BEST SCORE</span><span class="meta-v" data-menu-best>000000</span></div>
              <div class="meta"><span class="meta-k">CAMPAIGN</span><span class="meta-v" data-menu-campaign>01 STAGE</span></div>
              <div class="meta"><span class="meta-k">BUILD</span><span class="meta-v mono">1.0.0</span></div>
            </div>
          </div>
        </div>
        <div class="menu-bottombar">
          <div class="bb-left">SANDSTRIKE <b>//</b> 沙暴协议 <span>© PROJECT DUST BASIN</span></div>
          <div class="bb-right">LOCAL SESSION · BUILD 1.0.0</div>
        </div>
        ${settingsMarkup('menu')}
        ${stageSelectMarkup(ui)}
        <div class="screen-frame"></div>
      </section>`;
}

/**
 * Loading screen panel: boot progress readout + rotating field notes.
 *
 * Subscribes to `loading:progress` itself (the core does not re-broadcast it):
 * each event is mirrored into `ui.data.loading` and repainted. `onProgress` is
 * kept public and idempotent so the core may forward the same event harmlessly.
 */
export class LoadingPanel {
  constructor(ui, shell) {
    this.ui = ui;
    this.refs = {
      loadingPct: q(shell, '[data-load-pct]'),
      loadingFill: q(shell, '[data-load-fill]'),
      loadingLabel: q(shell, '[data-load-label]'),
      loadingPhase: q(shell, '[data-load-phase]'),
      tipEn: q(shell, '[data-tip-en]'),
      tipCn: q(shell, '[data-tip-cn]'),
    };
    // Tips rotate locally from the core's initial pick; never write it back.
    this._tipIndex = tipIndexOf(ui);
    this._lastTipAt = 0;
    this._offBus = null;
    this._offBus = bindBus(this, {
      'loading:progress': (detail) => this._onProgress(detail),
    });
    this.render();
  }

  /** Public forwarder: idempotent with the panel's own bus subscription. */
  onProgress(detail = {}) {
    this._onProgress(detail);
  }

  _onProgress(detail) {
    const progress = clamp01(detail.progress);
    const label = typeof detail.label === 'string' && detail.label.trim()
      ? detail.label.trim().toUpperCase()
      : '';
    this.ui.data.loading.progress = progress;
    if (label) this.ui.data.loading.label = label;
    if (this.ui.built) this.render();
  }

  render() {
    const { progress, label } = this.ui.data.loading;
    const pct = Math.min(100, Math.round(progress * 100));
    if (this.refs.loadingPct) this.refs.loadingPct.textContent = String(pct).padStart(3, '0');
    if (this.refs.loadingFill) this.refs.loadingFill.style.width = `${Math.max(2, pct)}%`;
    if (this.refs.loadingLabel && label) this.refs.loadingLabel.textContent = label;
    if (this.refs.loadingPhase) {
      const phase = pct < 24 ? 'BOOT 01/04 · CORE'
        : pct < 52 ? 'BOOT 02/04 · WORLD'
          : pct < 86 ? 'BOOT 03/04 · ASSETS'
            : 'BOOT 04/04 · UPLINK';
      this.refs.loadingPhase.textContent = phase;
    }
  }

  tick(now) {
    // Loading tips rotate every 4400 ms while the boot screen is up.
    if (this.ui.state !== 'loading') return;
    if (now - this._lastTipAt <= 4400) return;
    this._lastTipAt = now;
    this._tipIndex = (this._tipIndex + 1) % TIPS.length;
    const tip = TIPS[this._tipIndex];
    if (this.refs.tipEn) this.refs.tipEn.textContent = tip.en;
    if (this.refs.tipCn) this.refs.tipCn.textContent = tip.cn;
  }

  dispose() {
    if (this._offBus) this._offBus();
    this._offBus = null;
    this.refs = {};
  }
}

/**
 * Main menu panel: NEW GAME / CONTINUE / SELECT STAGE gating, save summary,
 * best score, clock and pad-aware hints. Rendering is driven by the core
 * (ready / gamepad / menu-enter events); the panel re-reads `src/save.js` every
 * time so the CONTINUE target can never go stale.
 */
export class HomePanel {
  constructor(ui, shell) {
    this.ui = ui;
    const startBtn = q(shell, '[data-start]');
    this.refs = {
      startBtn,
      startLabel: q(shell, '[data-start-label]'),
      startSub: q(shell, '[data-start-sub]'),
      startKey: q(shell, '[data-start] .mbtn-key'),
      continueBtn: q(shell, '[data-action="continue"]'),
      continueTarget: q(shell, '[data-continue-target]'),
      stageBtn: q(shell, '[data-action="stage-select"]'),
      saveSummary: q(shell, '[data-save-summary]'),
      menuCampaign: q(shell, '[data-menu-campaign]'),
      menuClock: q(shell, '[data-menu-clock]'),
      menuBest: q(shell, '[data-menu-best]'),
    };
    this._enabled = false;
    this._lastClock = 0;
    this.summary = null;
    this._syncActions();
  }

  setStartEnabled(enabled) {
    if (!this.refs.startBtn) return;
    this._enabled = !!enabled;
    this._syncActions();
  }

  /** Re-read the save and repaint every campaign control / line. */
  renderSaveState() {
    this._syncActions();
  }

  _syncActions() {
    const ready = this._enabled;
    const progress = safeLoadProgress();
    const sum = summary(progress);
    this.summary = sum;

    // --- NEW GAME (kept `data-start` for legacy automation) ---------------
    if (this.refs.startBtn) {
      this.refs.startBtn.disabled = !ready;
      this.refs.startBtn.classList.toggle('is-locked', !ready);
    }
    if (this.refs.startLabel) this.refs.startLabel.textContent = ready ? 'NEW GAME' : 'AWAITING UPLINK';
    if (this.refs.startSub) this.refs.startSub.textContent = ready ? '开始新战役' : '链路建立中';
    if (this.refs.startKey) {
      this.refs.startKey.textContent = ready
        ? (this.ui.padHintsActive() ? HINTS_GAMEPAD.menuStart : HINTS_KEYBOARD.menuStart)
        : '···';
    }

    // --- CONTINUE ---------------------------------------------------------
    const canContinue = ready && !!sum.canContinue;
    const continueBtn = this.refs.continueBtn;
    if (continueBtn) {
      continueBtn.disabled = !canContinue;
      continueBtn.classList.toggle('is-locked', !canContinue);
      continueBtn.setAttribute('aria-disabled', String(!canContinue));
    }
    if (this.refs.continueTarget) {
      this.refs.continueTarget.textContent = canContinue ? this._continueLine(sum) : '无可继续的战役';
      this.refs.continueTarget.classList.toggle('is-on', canContinue);
    }

    // --- SELECT STAGE -----------------------------------------------------
    const unlocked = (sum.stages || []).some((record) => record.unlocked);
    if (this.refs.stageBtn) {
      const on = ready && unlocked;
      this.refs.stageBtn.disabled = !on;
      this.refs.stageBtn.classList.toggle('is-locked', !on);
    }

    // --- save summary + campaign meta ------------------------------------
    if (this.refs.saveSummary) {
      this.refs.saveSummary.textContent = sum.hasProgress
        ? this._saveLine(sum)
        : 'NO SAVE // NEW CAMPAIGN REQUIRED';
      this.refs.saveSummary.classList.toggle('is-empty', !sum.hasProgress);
    }
    if (this.refs.menuCampaign) {
      const total = sum.totalStages || (sum.stages ? sum.stages.length : 1) || 1;
      this.refs.menuCampaign.textContent = sum.hasProgress
        ? `${fmtStageCounter(sum.clearedCount || 0, total)} CLEARED`
        : `${pad2(total)} STAGE${total === 1 ? '' : 'S'}`;
    }
  }

  /** `CAMPAIGN 01/01 · CLEARED 0 · SAVE SLOTS 1 [· COMPLETE]` */
  _saveLine(sum) {
    const total = sum.totalStages || (sum.stages ? sum.stages.length : 1) || 1;
    const cleared = sum.clearedCount || 0;
    const lastStage = sum.lastStageId ? getStage(sum.lastStageId) : null;
    const currentIndex = lastStage ? lastStage.index : 1;
    const base = `CAMPAIGN ${fmtStageCounter(currentIndex, total)} · CLEARED ${cleared} · SAVE SLOTS ${total}`;
    return sum.campaignCleared ? `${base} · COMPLETE` : base;
  }

  /** `CONTINUE · STAGE 01/01 · OUTPOST 07 · 老兵` */
  _continueLine(sum) {
    const stage = sum.continueStageId ? getStage(sum.continueStageId) : null;
    const diffId = isDifficultyId(sum.continueDifficulty) ? sum.continueDifficulty : DEFAULT_DIFFICULTY_ID;
    const diff = getDifficulty(diffId);
    const parts = ['CONTINUE'];
    if (stage) parts.push(`STAGE ${fmtStageCounter(stage.index, sum.totalStages || 1)}`, stage.name);
    if (diff) parts.push(`${diff.label} ${diff.cn}`);
    return parts.join(' · ');
  }

  renderBest() {
    if (this.refs.menuBest) this.refs.menuBest.textContent = fmtScore(this.ui.best);
  }

  renderClock() {
    if (!this.refs.menuClock) return;
    const now = new Date();
    this.refs.menuClock.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  }

  /** Swap the NEW GAME key hint between keyboard and pad glyphs (§6.3). */
  refreshHints() {
    if (!this.refs.startKey) return;
    const hints = this.ui.padHintsActive() ? HINTS_GAMEPAD : HINTS_KEYBOARD;
    this.refs.startKey.textContent = this._enabled ? hints.menuStart : '···';
  }

  setScreen(name) {
    if (name !== 'menu') return;
    this.renderBest();
    this.renderClock();
    this.renderSaveState();
  }

  tick(now) {
    // Menu clock once per second.
    if (now - this._lastClock <= 1000) return;
    this._lastClock = now;
    if (this.ui.state === 'menu') this.renderClock();
  }

  dispose() {
    this.refs = {};
    this.summary = null;
  }
}

/** `loadProgress` can throw in exotic storage modes; the menu must still paint. */
function safeLoadProgress() {
  try {
    return loadProgress();
  } catch (_) {
    return null;
  }
}
