/**
 * Overlay screens for the modular UI under `src/ui/`.
 *
 * Owns the pause screen, the death/victory result screens, the deployment
 * difficulty dialog and the campaign stage-select screen: markup, refs, stat
 * rendering and the `game:*` bus subscriptions that feed the result screen.
 * Navigation actions stay in the core `index.js`; the panels only call the
 * public `ui` methods / emit nothing themselves.
 *
 * Campaign data is READ-ONLY here (`src/save.js`): the game (`main.js`) is the
 * only writer of progress, the UI only renders it.
 *
 * Module map: see `.scratch/features/CONTRACT.md` §8.
 */
import {
  HINTS_GAMEPAD,
  HINTS_KEYBOARD,
  STAT_ROWS,
  bindBus,
  clamp,
  clamp01,
  diffTone,
  fmtMul,
  fmtScore,
  fmtStageCounter,
  fmtTime,
  num,
  pad2,
  q,
  qa,
} from './shared.js';
import {
  DEFAULT_DIFFICULTY_ID,
  DIFFICULTIES,
  getDifficulty,
  isDifficultyId,
} from '../config/difficulty.js';
import { DEFAULT_STAGE_ID, getStage, getStageByIndex } from '../config/stages.js';
import {
  createEmptyProgress,
  loadProgress,
  stageRecords,
  summary,
} from '../save.js';
import { settingsMarkup } from './settings.js';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const difficultyIdOf = (value) => (isDifficultyId(value) ? value : DEFAULT_DIFFICULTY_ID);

/** Normalize the current/last difficulty id from the UI data bags. */
function currentDifficultyId(ui) {
  const fromData = ui && ui.data && ui.data.difficulty ? ui.data.difficulty.id : null;
  if (isDifficultyId(fromData)) return fromData;
  const fromStats = ui && ui.data && ui.data.stats ? ui.data.stats.difficultyId : null;
  if (isDifficultyId(fromStats)) return fromStats;
  if (ui && ui.settings && isDifficultyId(ui.settings.difficulty)) return ui.settings.difficulty;
  return DEFAULT_DIFFICULTY_ID;
}

/** Stage definition for the panel: explicit id → current run stage → first stage. */
function resolveStage(ui, stageId) {
  return getStage(stageId)
    || getStage(ui && ui.data && ui.data.stage ? ui.data.stage.stageId : null)
    || getStageByIndex(1);
}

/** "STAGE 01/01 · OUTPOST 07 · 沙暴前哨 · 第七区" */
function stageLine(stage) {
  if (!stage) return 'STAGE —/—';
  const total = (uiTotalStages() || stage.index || 1);
  const index = num(stage.index, 1);
  const parts = [`STAGE ${fmtStageCounter(index, total)}`, stage.name || ''];
  if (stage.subtitle) parts.push(stage.subtitle);
  return parts.filter(Boolean).join(' · ');
}

function uiTotalStages() {
  try {
    return stageRecords(loadProgress() || createEmptyProgress()).length;
  } catch (_) {
    return 1;
  }
}

/** End-of-run stat grid shared by the death and victory screens. */
function statsMarkup() {
  return STAT_ROWS.map((row) => `
      <div class="stat">
        <span class="stat-k">${row.en} <em>${row.cn}</em></span>
        <b data-stat="${row.key}">—</b>
      </div>`).join('');
}

// ---------------------------------------------------------------------------
// Markup: pause
// ---------------------------------------------------------------------------

/** Pause screen markup (`data-screen-panel="paused"`). */
export function pauseMarkup(ui) {
  void ui;
  return `
      <section class="screen screen--pause" data-screen-panel="paused">
        <div class="pause-scrim"></div>
        <div class="pause-shell">
          <header class="pause-head">
            <div class="pause-kicker">SIMULATION SUSPENDED // 模拟暂停</div>
            <h2 class="pause-title">PAUSED</h2>
            <div class="pause-sub">TACTICAL LINK HELD · 战术链路保持</div>
            <div class="pause-stage" data-pause-stage>STAGE —/— · — · —</div>
          </header>
          <div class="pause-body">
            <div class="pause-actions">
              <button class="mbtn mbtn--primary" type="button" data-action="resume">
                <span class="mbtn-ico">▶</span>
                <span class="mbtn-copy"><b>RESUME OPERATION</b><em>继续行动</em></span>
                <span class="mbtn-key">ESC</span>
              </button>
              <button class="mbtn" type="button" data-action="restart">
                <span class="mbtn-ico">⟳</span>
                <span class="mbtn-copy"><b>RESTART OPERATION</b><em>重新开始本关</em></span>
              </button>
              <button class="mbtn mbtn--danger" type="button" data-action="menu">
                <span class="mbtn-ico">◼</span>
                <span class="mbtn-copy"><b>ABANDON // MAIN MENU</b><em>放弃任务</em></span>
              </button>
              <button class="mbtn" type="button" data-action="focus-settings">
                SYSTEM CONFIG <em>系统设置</em><span class="mbtn-key">+</span>
              </button>
            </div>
            <div class="pause-side">
              <div class="pause-runstats">
                <div class="rs"><span>WAVE <em>波次</em></span><b data-pause-wave>01 / 05</b></div>
                <div class="rs"><span>SCORE <em>得分</em></span><b data-pause-score>000000</b></div>
                <div class="rs"><span>KILLS <em>击杀</em></span><b data-pause-kills>0</b></div>
                <div class="rs"><span>TIME <em>用时</em></span><b data-pause-time>00:00</b></div>
                <div class="rs rs--wide"><span>DIFFICULTY <em>难度</em></span><b data-pause-diff>STANDARD 标准</b></div>
              </div>
            </div>
          </div>
          <footer class="pause-foot">ESC TO RESUME · 按 ESC 继续</footer>
        </div>
        ${settingsMarkup('pause')}
        <div class="screen-frame"></div>
      </section>`;
}

// ---------------------------------------------------------------------------
// Markup: death / victory
// ---------------------------------------------------------------------------

/** Death + victory result screens (`data-screen-panel="dead"` / `"victory"`). */
export function endMarkup(ui) {
  void ui;
  const stats = statsMarkup();
  return `
      <section class="screen screen--death" data-screen-panel="dead">
        <div class="end-scrim end-scrim--death"></div>
        <div class="end-shell">
          <div class="end-kicker"><i></i> OPERATION TERMINATED // 行动终止</div>
          <h2 class="end-title end-title--death">SIGNAL <span>LOST</span></h2>
          <div class="end-sub">VITAL SIGNS ZERO · 生命体征归零</div>
          <div class="end-stage" data-death-stage>STAGE —/—</div>
          <div class="end-grid">${stats}</div>
          <div class="end-actions">
            <button class="mbtn mbtn--primary" type="button" data-action="restart">
              <span class="mbtn-ico">⟳</span>
              <span class="mbtn-copy"><b>REDEPLOY</b><em>重新部署</em></span>
              <span class="mbtn-key">ENTER</span>
            </button>
            <button class="mbtn" type="button" data-action="menu">
              <span class="mbtn-copy"><b>MAIN MENU</b><em>主菜单</em></span>
            </button>
          </div>
          <div class="end-hint">从本关起始状态重新部署 · REDEPLOY FROM STAGE START</div>
          <div class="end-foot">SANDSTRIKE <b>//</b> 沙暴协议 · OPS-07</div>
        </div>
        <div class="screen-frame"></div>
      </section>

      <section class="screen screen--victory" data-screen-panel="victory">
        <div class="end-scrim end-scrim--victory"></div>
        <div class="end-shell">
          <div class="end-kicker" data-victory-kicker><i></i> OPERATION COMPLETE // 行动完成</div>
          <h2 class="end-title end-title--victory" data-victory-title>STAGE <span>CLEAR</span></h2>
          <div class="end-sub" data-victory-sub>关卡通过 · STAGE CLEAR</div>
          <div class="end-stage" data-victory-stage>STAGE —/—</div>
          <div class="end-grid">${stats}</div>
          <div class="end-unlock" data-victory-unlock>
            <span class="eu-mark">▸</span>
            <span class="eu-copy"><b data-victory-unlock-en>STAGE CLEARED</b><em data-victory-unlock-cn>关卡通过</em></span>
          </div>
          <div class="end-actions">
            <button class="mbtn mbtn--primary" type="button" data-action="next-stage" data-next-stage>
              <span class="mbtn-ico">▶</span>
              <span class="mbtn-copy"><b>NEXT STAGE</b><em data-next-stage-label>下一关</em></span>
              <span class="mbtn-key">ENTER</span>
            </button>
            <button class="mbtn" type="button" data-action="restart">
              <span class="mbtn-ico">⟳</span>
              <span class="mbtn-copy"><b>REPLAY STAGE</b><em>重玩本关</em></span>
            </button>
            <button class="mbtn" type="button" data-action="menu">
              <span class="mbtn-copy"><b>MAIN MENU</b><em>主菜单</em></span>
            </button>
          </div>
          <div class="end-foot">SANDSTRIKE <b>//</b> 沙暴协议 · CAMPAIGN</div>
        </div>
        <div class="screen-frame"></div>
      </section>`;
}

// ---------------------------------------------------------------------------
// Markup: deployment difficulty dialog
// ---------------------------------------------------------------------------

/** One difficulty card (`[data-deploy-value]`). */
function deployCardMarkup(tier) {
  return `
            <button class="deploy-card deploy-card--${diffTone(tier.tone)}" type="button" data-deploy-value="${tier.id}">
              <span class="dc-top"><b>${tier.label}</b><em>${tier.cn}</em></span>
              <span class="dc-stats">
                <span class="dc-stat"><i>HP</i><b>×${fmtMul(tier.hpMul)}</b></span>
                <span class="dc-stat"><i>DMG</i><b>×${fmtMul(tier.dmgMul)}</b></span>
              </span>
              <span class="dc-desc">${tier.desc}<em>${tier.descEn}</em></span>
              <span class="dc-tag">ENEMY HP ×${fmtMul(tier.hpMul)} // DMG ×${fmtMul(tier.dmgMul)}</span>
            </button>`;
}

/** Deployment difficulty dialog (`[data-deploy]`); text is painted by the panel. */
export function deployMarkup(ui) {
  void ui;
  return `
      <div class="deploy" data-deploy data-deploy-mode="new" aria-hidden="true">
        <div class="deploy-scrim" data-action="deploy-back"></div>
        <div class="deploy-panel" role="dialog" aria-modal="true" aria-label="Deployment difficulty">
          <div class="deploy-kicker"><i></i> DEPLOYMENT // 部署简报</div>
          <h3 class="deploy-title">
            <span data-deploy-title>SELECT DIFFICULTY</span>
            <span class="deploy-title-cn" data-deploy-title-cn>选择难度</span>
          </h3>
          <div class="deploy-stage" data-deploy-stage>STAGE —/—</div>
          <div class="deploy-warning" data-deploy-warning>开始新游戏会清空现有存档 / NEW CAMPAIGN WIPES SAVED PROGRESS</div>
          <div class="deploy-options" data-deploy-options>${DIFFICULTIES.map(deployCardMarkup).join('')}
          </div>
          <div class="deploy-foot">
            <button class="deploy-back" type="button" data-action="deploy-back">◂ BACK <em>返回</em></button>
            <span class="deploy-tip" data-deploy-tip>选择难度后开始新战役 · ENTER 使用上次难度 · ESC 返回</span>
          </div>
        </div>
      </div>`;
}

// ---------------------------------------------------------------------------
// Markup: stage-select screen
// ---------------------------------------------------------------------------

/** Campaign stage-select overlay (`[data-stage-select]`); cards painted by the panel. */
export function stageSelectMarkup(ui) {
  void ui;
  return `
      <div class="stage-select" data-stage-select aria-hidden="true">
        <div class="stage-scrim" data-action="stage-back"></div>
        <div class="stage-panel" role="dialog" aria-modal="true" aria-label="Stage select">
          <div class="stage-list" data-stage-list></div>
          <header class="stage-head">
            <div class="stage-head-copy">
              <div class="stage-kicker"><i></i> CAMPAIGN // 战役</div>
              <h3 class="stage-title">SELECT STAGE <span>选择关卡</span></h3>
            </div>
            <button class="stage-close" type="button" data-action="stage-back" aria-label="返回主菜单">✕</button>
          </header>
          <footer class="stage-foot">
            <span class="stage-save" data-stage-summary>NO SAVE // NEW CAMPAIGN REQUIRED</span>
            <span class="stage-tip">选择已解锁关卡 → 选择难度 · 手柄 A 确认 / B 返回</span>
          </footer>
        </div>
      </div>`;
}

/** One stage card; `record` comes from `src/save.js` `stageRecords()`. */
function stageCardMarkup(record, total) {
  const diff = record.difficulty ? getDifficulty(record.difficulty) : null;
  const locked = !record.unlocked;
  const state = locked ? 'LOCKED' : record.cleared ? 'CLEARED' : record.hasSave ? 'IN PROGRESS' : 'READY';
  const stateCn = locked ? '未解锁' : record.cleared ? '已通关' : record.hasSave ? '进行中' : '待部署';
  const meta = [];
  if (record.threat) meta.push(`<span class="sc-threat">THREAT · ${record.threat}</span>`);
  if (diff) {
    meta.push(`<span class="sc-diff sc-diff--${diffTone(diff.tone)}">${diff.label}<em>${diff.cn}</em></span>`);
  }
  if (record.cleared && record.bestScore > 0) {
    meta.push(`<span class="sc-best">BEST ${fmtScore(record.bestScore)}</span>`);
  }
  return `
            <button class="stage-card${locked ? ' is-locked' : ''}${record.cleared ? ' is-cleared' : ''}${record.hasSave && !record.cleared ? ' is-progress' : ''}"
              type="button" data-action="pick-stage" data-stage-value="${record.id}"${locked ? ' disabled aria-disabled="true"' : ''}>
              <span class="sc-index">${pad2(record.index)}<i>/${pad2(total)}</i></span>
              <span class="sc-body">
                <span class="sc-name">${record.name}</span>
                <span class="sc-sub">${record.subtitle || record.mapId || ''}</span>
                <span class="sc-meta">${meta.join('')}</span>
              </span>
              <span class="sc-state">${locked ? '<span class="sc-lock" data-stage-lock aria-hidden="true">▮</span>' : ''}<b>${state}</b><em>${stateCn}</em></span>
            </button>`;
}

// ---------------------------------------------------------------------------
// Pause panel
// ---------------------------------------------------------------------------

/** Pause screen panel: run stat readout, live timer and stage/difficulty line. */
export class PausePanel {
  constructor(ui, shell) {
    this.ui = ui;
    this.refs = {
      pauseWave: q(shell, '[data-pause-wave]'),
      pauseScore: q(shell, '[data-pause-score]'),
      pauseKills: q(shell, '[data-pause-kills]'),
      pauseTime: q(shell, '[data-pause-time]'),
      pauseStage: q(shell, '[data-pause-stage]'),
      pauseDiff: q(shell, '[data-pause-diff]'),
      resumeKey: q(shell, '.screen--pause [data-action="resume"] .mbtn-key'),
      pauseFoot: q(shell, '.pause-foot'),
    };
    this._lastClock = 0;
    this.renderStage();
  }

  /** Campaign context line: `STAGE 01/01 · OUTPOST 07 · VETERAN 老兵`. */
  renderStage() {
    const { data } = this.ui;
    const stage = data.stage;
    const diff = data.difficulty || (data.stats.difficultyId ? getDifficulty(data.stats.difficultyId) : null);
    if (this.refs.pauseStage) {
      const parts = [];
      if (stage) parts.push(`STAGE ${fmtStageCounter(stage.index, stage.total)}`, stage.name);
      else parts.push('STAGE —/—');
      if (diff) parts.push(`${diff.label} ${diff.cn}`);
      else if (data.stats.difficultyLabel) parts.push(data.stats.difficultyLabel);
      this.refs.pauseStage.textContent = parts.join(' · ');
      this.refs.pauseStage.classList.toggle('is-empty', !stage);
    }
    if (this.refs.pauseDiff) {
      this.refs.pauseDiff.textContent = diff ? `${diff.label} ${diff.cn}` : '—';
      if (diff) this.refs.pauseDiff.dataset.tone = diffTone(diff.tone);
      else delete this.refs.pauseDiff.dataset.tone;
    }
  }

  renderStats() {
    const { data } = this.ui;
    const wave = data.wave;
    if (this.refs.pauseWave) this.refs.pauseWave.textContent = `${pad2(wave.current || 1)} / ${pad2(wave.total || 15)}`;
    if (this.refs.pauseScore) this.refs.pauseScore.textContent = fmtScore(data.score.score);
    if (this.refs.pauseKills) this.refs.pauseKills.textContent = String(Math.round(data.kills));
    if (this.refs.pauseTime) this.refs.pauseTime.textContent = fmtTime(this.ui.runTime ?? 0);
    this.renderStage();
  }

  /** Swap the RESUME key hint + footer between keyboard and pad glyphs (§6.3). */
  refreshHints() {
    const hints = this.ui.padHintsActive() ? HINTS_GAMEPAD : HINTS_KEYBOARD;
    if (this.refs.resumeKey) this.refs.resumeKey.textContent = hints.resume;
    if (this.refs.pauseFoot) this.refs.pauseFoot.textContent = hints.pauseFoot;
  }

  setScreen(name) {
    if (name === 'paused') this.renderStats();
  }

  tick(now) {
    // Pause readout (TIME) once per second while suspended.
    if (now - this._lastClock <= 1000) return;
    this._lastClock = now;
    if (this.ui.state === 'paused') this.renderStats();
  }

  dispose() {
    this.refs = {};
  }
}

// ---------------------------------------------------------------------------
// Result (death / victory) panel
// ---------------------------------------------------------------------------

/**
 * Result screen panel. Adopts `game:death` / `game:victory` payloads into the
 * shared `ui.data` and repaints the stat grids + campaign unlock line when the
 * matching screen is up — the core renders again on the screen transition.
 */
export class EndPanel {
  constructor(ui, shell) {
    this.ui = ui;
    this.refs = {
      statNodes: {
        dead: qa(shell, '.screen--death [data-stat]'),
        victory: qa(shell, '.screen--victory [data-stat]'),
      },
      redeployKeys: qa(shell, '.screen--death [data-action="restart"] .mbtn-key, .screen--victory [data-action="restart"] .mbtn-key'),
      victoryKicker: q(shell, '[data-victory-kicker]'),
      victoryTitle: q(shell, '[data-victory-title]'),
      victorySub: q(shell, '[data-victory-sub]'),
      victoryStage: q(shell, '[data-victory-stage]'),
      victoryUnlock: q(shell, '[data-victory-unlock]'),
      victoryUnlockEn: q(shell, '[data-victory-unlock-en]'),
      victoryUnlockCn: q(shell, '[data-victory-unlock-cn]'),
      deathStage: q(shell, '[data-death-stage]'),
      nextStageBtn: q(shell, '[data-next-stage]'),
      nextStageLabel: q(shell, '[data-next-stage-label]'),
    };
    this._offBus = bindBus(this, {
      'game:death': (detail) => this._onEnd(detail, 'dead'),
      'game:victory': (detail) => this._onEnd(detail, 'victory'),
    });
  }

  _onEnd(detail, state) {
    const end = this.normalizeEnd(detail);
    this.ui.data.end = end;
    this.ui.data.kills = end.kills;
    const stage = this.ui.data.stage || {};
    const runDiff = this.ui.data.difficulty || null;
    const diffId = isDifficultyId(detail.difficulty)
      ? detail.difficulty
      : (runDiff && isDifficultyId(runDiff.id) ? runDiff.id : null);
    const diff = diffId ? getDifficulty(diffId) : runDiff;
    this.ui.data.result = {
      state,
      stageId: typeof detail.stageId === 'string' ? detail.stageId : (stage.stageId || null),
      stageName: typeof detail.stageName === 'string' && detail.stageName ? detail.stageName : (stage.name || ''),
      stageIndex: clamp(num(detail.stageIndex, num(stage.index, 1)), 1, 999),
      stageTotal: clamp(num(detail.stageTotal, num(stage.total, 1)), 1, 999),
      difficulty: diffId,
      difficultyLabel: typeof detail.difficultyLabel === 'string' && detail.difficultyLabel
        ? detail.difficultyLabel
        : (diff ? `${diff.label} ${diff.cn}` : ''),
      cleared: state === 'victory' && detail.cleared !== false,
      unlockedNext: !!detail.unlockedNext,
      nextStageId: typeof detail.nextStageId === 'string' ? detail.nextStageId : null,
      campaignCleared: !!detail.campaignCleared,
    };
    this.ui.recordBest(end.score);
    if (this.ui.state === state) this.render();
  }

  render() {
    if (!this.ui.built) return;
    const data = this.ui.data.end || this.normalizeEnd({});
    const total = this.ui.data.wave.total || data.totalWaves || 15;
    for (const kind of ['dead', 'victory']) {
      for (const node of this.refs.statNodes[kind] || []) {
        const key = node.dataset.stat;
        let value = '—';
        if (key === 'score') value = fmtScore(data.score);
        else if (key === 'wave') value = `${pad2(data.wave)} / ${pad2(total)}`;
        else if (key === 'kills') value = String(Math.round(data.kills));
        else if (key === 'accuracy') value = `${Math.round(clamp01(data.accuracy) * 100)}%`;
        else if (key === 'time') value = fmtTime(data.time);
        else if (key === 'combo') value = `×${Math.max(0, Math.round(data.bestCombo))}`;
        node.textContent = value;
      }
    }
    this.renderVictory();
    this.renderDeath();
  }

  renderVictory() {
    const result = this.ui.data.result || {};
    const campaign = !!result.campaignCleared;
    const next = result.nextStageId ? getStage(result.nextStageId) : null;
    const stageText = result.stageName
      ? `STAGE ${fmtStageCounter(result.stageIndex, result.stageTotal)} · ${result.stageName}${result.difficultyLabel ? ` · ${result.difficultyLabel}` : ''}`
      : 'STAGE —/—';
    if (this.refs.victoryKicker) {
      this.refs.victoryKicker.innerHTML = campaign
        ? '<i></i> CAMPAIGN COMPLETE // 战役完成'
        : '<i></i> OPERATION COMPLETE // 行动完成';
    }
    if (this.refs.victoryTitle) {
      this.refs.victoryTitle.innerHTML = campaign ? 'CAMPAIGN <span>COMPLETE</span>' : 'STAGE <span>CLEAR</span>';
    }
    if (this.refs.victorySub) {
      this.refs.victorySub.textContent = campaign ? '战役完成 · CAMPAIGN COMPLETE' : '关卡通过 · STAGE CLEAR';
    }
    if (this.refs.victoryStage) this.refs.victoryStage.textContent = stageText;
    const unlock = this.refs.victoryUnlock;
    if (unlock) {
      let en = 'STAGE CLEARED';
      let cn = '关卡通过';
      let tone = 'is-clear';
      if (campaign) {
        en = 'CAMPAIGN COMPLETE';
        cn = '战役完成 · 全部关卡已通关';
        tone = 'is-final';
      } else if (result.unlockedNext && next) {
        en = 'NEXT STAGE UNLOCKED';
        cn = `已解锁下一关 · ${next.name}`;
        tone = 'is-unlock';
      }
      unlock.classList.remove('is-clear', 'is-unlock', 'is-final');
      unlock.classList.add(tone);
      if (this.refs.victoryUnlockEn) this.refs.victoryUnlockEn.textContent = en;
      if (this.refs.victoryUnlockCn) this.refs.victoryUnlockCn.textContent = cn;
    }
    const nextBtn = this.refs.nextStageBtn;
    if (nextBtn) {
      const hasNext = !!(result.unlockedNext && next);
      // `hidden` alone is not enough: `.mbtn { display: flex }` would win over
      // the UA `[hidden]` rule (styles.css keeps an explicit `!important` guard).
      // Disabled + aria-hidden + tabindex keep the controller focus collector
      // from ever landing on the dead "no more stages" button.
      nextBtn.hidden = !hasNext;
      nextBtn.disabled = !hasNext;
      nextBtn.tabIndex = hasNext ? 0 : -1;
      nextBtn.setAttribute('aria-hidden', String(!hasNext));
      nextBtn.classList.toggle('is-locked', !hasNext);
      if (this.refs.nextStageLabel) {
        this.refs.nextStageLabel.textContent = hasNext ? `下一关 · ${next.name}` : '无更多关卡';
      }
    }
  }

  renderDeath() {
    const result = this.ui.data.result || {};
    const stageText = result.stageName
      ? `STAGE ${fmtStageCounter(result.stageIndex, result.stageTotal)} · ${result.stageName}${result.difficultyLabel ? ` · ${result.difficultyLabel}` : ''}`
      : 'STAGE —/—';
    if (this.refs.deathStage) this.refs.deathStage.textContent = stageText;
  }

  normalizeEnd(detail = {}) {
    const { data } = this.ui;
    const base = data.end || {};
    const accuracyRaw = num(detail.accuracy, num(base.accuracy, 0));
    return {
      score: Math.max(0, Math.round(num(detail.score, num(base.score, data.score.score)))),
      wave: clamp(num(detail.wave, num(base.wave, data.wave.current || 1)), 1, 99),
      kills: Math.max(0, Math.round(num(detail.kills, num(base.kills, data.kills)))),
      accuracy: clamp(accuracyRaw > 1 ? accuracyRaw / 100 : accuracyRaw, 0, 1),
      time: Math.max(0, num(detail.time, num(base.time, this.ui.runTime ?? 0))),
      bestCombo: Math.max(0, num(detail.bestCombo, num(base.bestCombo, 0))),
    };
  }

  setScreen(name) {
    if (name === 'dead' || name === 'victory') this.render();
  }

  /** Swap the REDEPLOY/REPLAY key hint between keyboard and pad (§6.3). */
  refreshHints() {
    const hints = this.ui.padHintsActive() ? HINTS_GAMEPAD : HINTS_KEYBOARD;
    for (const key of this.refs.redeployKeys || []) key.textContent = hints.redeploy;
  }

  dispose() {
    if (this._offBus) this._offBus();
    this._offBus = null;
    this.refs = {};
  }
}

// ---------------------------------------------------------------------------
// Deployment difficulty panel
// ---------------------------------------------------------------------------

/**
 * Difficulty chooser shared by NEW GAME (mode `new`), stage select (mode
 * `stage`) and pause restart (mode `restart`).
 *
 * On choose it persists the last-used difficulty (`ui.setDifficulty`) and calls
 * the matching core action, which emits `ui:new-game` / `ui:select-stage` /
 * `ui:restart` per CONTRACT §4.
 */
export class DeployPanel {
  constructor(ui, shell) {
    this.ui = ui;
    this.refs = {
      deploy: q(shell, '[data-deploy]'),
      panel: q(shell, '[data-deploy] .deploy-panel'),
      cards: qa(shell, '[data-deploy-value]'),
      title: q(shell, '[data-deploy-title]'),
      titleCn: q(shell, '[data-deploy-title-cn]'),
      stage: q(shell, '[data-deploy-stage]'),
      warning: q(shell, '[data-deploy-warning]'),
      tip: q(shell, '[data-deploy-tip]'),
    };
    this._mode = 'new';
    this._stageId = null;
    this._defaultId = DEFAULT_DIFFICULTY_ID;
    this._open = false;
  }

  get isOpen() {
    return this._open;
  }

  get mode() {
    return this._mode;
  }

  get stageId() {
    return this._stageId;
  }

  /**
   * Open the chooser.
   * @param {'new'|'start'|'stage'|'restart'} mode
   * @param {{stageId?: string}} [options]
   */
  open(mode = 'new', options = {}) {
    const { deploy } = this.refs;
    if (!deploy) return;
    const normalized = mode === 'stage' || mode === 'restart' ? mode : 'new';
    this._mode = normalized;
    this._stageId = normalized === 'stage'
      ? (getStage(options.stageId) ? options.stageId : (this.ui.data.stage?.stageId || DEFAULT_STAGE_ID))
      : null;
    this._open = true;
    deploy.dataset.deployMode = normalized;
    deploy.classList.add('is-open');
    deploy.setAttribute('aria-hidden', 'false');
    this._renderCopy();
    const defaultId = this._resolveDefault();
    this._defaultId = defaultId;
    this.syncDefault(defaultId);
    this._focusDefaultCard();
  }

  _resolveDefault() {
    const progress = loadProgress();
    if (this._mode === 'restart') {
      return currentDifficultyId(this.ui);
    }
    if (this._mode === 'stage' && progress && progress.stages && this._stageId) {
      const record = progress.stages[this._stageId];
      if (record && isDifficultyId(record.difficulty)) return record.difficulty;
    }
    if (progress && isDifficultyId(progress.lastDifficulty)) return progress.lastDifficulty;
    if (isDifficultyId(this.ui.settings.difficulty)) return this.ui.settings.difficulty;
    return DEFAULT_DIFFICULTY_ID;
  }

  _renderCopy() {
    const stage = resolveStage(this.ui, this._stageId);
    const title = this.refs.title;
    const titleCn = this.refs.titleCn;
    if (title) {
      title.textContent = this._mode === 'new'
        ? 'NEW CAMPAIGN'
        : this._mode === 'stage'
          ? 'DEPLOY TO STAGE'
          : 'RESTART STAGE';
    }
    if (titleCn) {
      titleCn.textContent = this._mode === 'new'
        ? '开始新战役 · 选择难度'
        : this._mode === 'stage'
          ? '部署至关卡 · 选择难度'
          : '重新开始本关 · 选择难度';
    }
    if (this.refs.stage) this.refs.stage.textContent = stageLine(stage);
    const warning = this.refs.warning;
    if (warning) {
      const show = this._mode === 'new';
      warning.hidden = !show;
      warning.classList.toggle('is-on', show);
      warning.textContent = '开始新游戏会清空现有存档 / NEW CAMPAIGN WIPES SAVED PROGRESS';
    }
    if (this.refs.tip) {
      this.refs.tip.textContent = this._mode === 'new'
        ? '选择难度后清档并开始新战役 · ENTER 使用上次难度 · ESC 返回'
        : this._mode === 'stage'
          ? '选择难度后部署 · ESC 返回选关'
          : '选择难度后从本关起始状态重新部署 · ESC 返回';
    }
  }

  _focusDefaultCard() {
    const { deploy, cards } = this.refs;
    if (!deploy) return;
    const card = (cards || []).find((item) => item.dataset.deployValue === this._defaultId) || (cards || [])[0];
    if (!card || typeof card.focus !== 'function') return;
    try {
      card.focus({ preventScroll: true });
    } catch (_) {
      try { card.focus(); } catch (__) { /* ignore */ }
    }
  }

  close() {
    this._open = false;
    const { deploy } = this.refs;
    if (!deploy) return;
    deploy.classList.remove('is-open');
    deploy.setAttribute('aria-hidden', 'true');
  }

  /** Highlight the last-used / mode-default card (also the pad focus target). */
  syncDefault(difficulty) {
    const id = isDifficultyId(difficulty)
      ? difficulty
      : (isDifficultyId(this._defaultId) ? this._defaultId : this._resolveDefault());
    this._defaultId = id;
    for (const card of this.refs.cards || []) {
      card.classList.toggle('is-default', card.dataset.deployValue === id);
    }
  }

  /** Card selection: persist last-used difficulty, close and hand off. */
  choose(difficulty) {
    if (!this._open) return;
    const id = difficultyIdOf(difficulty);
    const mode = this._mode;
    const stageId = this._stageId;
    this.ui.setDifficulty(id);
    this.ui.closeDeploy();
    if (mode === 'stage') this.ui.deployToStage(stageId, id);
    else if (mode === 'restart') this.ui.restartStageRun(id);
    else this.ui.startNewCampaign(id);
  }

  /** ENTER / pad A while the dialog is open picks the highlighted card. */
  chooseDefault() {
    this.choose(this._defaultId || this._resolveDefault());
  }

  /** Back button / ESC: return to the menu, or to the stage list when staged. */
  back() {
    if (!this._open) return;
    const fromStage = this._mode === 'stage';
    this.ui.closeDeploy();
    if (fromStage) this.ui.openStageSelect();
  }

  dispose() {
    this._open = false;
    this._mode = 'new';
    this._stageId = null;
    this.refs = {};
  }
}

// ---------------------------------------------------------------------------
// Stage-select panel
// ---------------------------------------------------------------------------

/**
 * Campaign stage list. Cards are rendered from `stageRecords(loadProgress())`
 * every time the screen opens, so a stage cleared during the session shows
 * CLEARED + next-stage unlock immediately when the menu is re-entered.
 *
 * The background menu is `aria-hidden` while open so the controller layer
 * (which collects visible buttons of the active screen) can only focus the
 * stage cards / back button.
 */
export class StageSelectPanel {
  constructor(ui, shell) {
    this.ui = ui;
    this.shell = shell;
    this.refs = {
      stageSelect: q(shell, '[data-stage-select]'),
      list: q(shell, '[data-stage-list]'),
      summary: q(shell, '[data-stage-summary]'),
    };
    this._open = false;
    this._inert = [];
  }

  get isOpen() {
    return this._open;
  }

  render() {
    if (!this.ui.built || !this.refs.list) return;
    let progress = null;
    try {
      progress = loadProgress();
    } catch (_) {
      progress = null;
    }
    const records = stageRecords(progress || createEmptyProgress());
    const total = records.length || 1;
    this.refs.list.innerHTML = records.map((record) => stageCardMarkup(record, total)).join('');
    const sum = summary(progress);
    if (this.refs.summary) {
      this.refs.summary.textContent = sum.hasProgress
        ? `CAMPAIGN ${pad2(sum.clearedCount)}/${pad2(sum.totalStages || total)} · CLEARED ${sum.clearedCount || 0} · SAVE SLOTS ${sum.totalStages || total}`
        : 'NO SAVE // NEW CAMPAIGN REQUIRED';
      this.refs.summary.classList.toggle('is-empty', !sum.hasProgress);
    }
  }

  open() {
    if (this._open) return;
    const { stageSelect } = this.refs;
    if (!stageSelect) return;
    this.render();
    this._open = true;
    stageSelect.classList.add('is-open');
    stageSelect.setAttribute('aria-hidden', 'false');
    if (this.ui.root) this.ui.root.classList.add('is-stage-open');
    this._setBackgroundInert(true);
    const target = q(stageSelect, '.stage-card:not([disabled])') || q(stageSelect, '[data-action="stage-back"]');
    // Focus one frame later: the overlay's visibility transition has to settle,
    // otherwise focus() on a still-visibility:hidden element is a no-op.
    this.ui.later(() => {
      if (!this._open || !target || !target.isConnected) return;
      try {
        target.focus({ preventScroll: true });
      } catch (_) {
        try { target.focus(); } catch (__) { /* ignore */ }
      }
    }, 30);
  }

  close() {
    if (!this._open) return;
    this._open = false;
    const { stageSelect } = this.refs;
    if (!stageSelect) return;
    stageSelect.classList.remove('is-open');
    stageSelect.setAttribute('aria-hidden', 'true');
    if (this.ui.root) this.ui.root.classList.remove('is-stage-open');
    this._setBackgroundInert(false);
  }

  /** Hide the covered menu from assistive tech + the controller focus collector. */
  _setBackgroundInert(on) {
    const screen = this.refs.stageSelect ? this.refs.stageSelect.closest('.screen') : null;
    if (!screen) return;
    const nodes = ['.menu-topbar', '.menu-body', '.menu-bottombar', '.menu-scrim']
      .map((selector) => screen.querySelector(selector))
      .filter(Boolean);
    if (on) {
      this._inert = nodes;
      for (const node of nodes) node.setAttribute('aria-hidden', 'true');
    } else {
      for (const node of nodes) node.removeAttribute('aria-hidden');
      this._inert = [];
    }
  }

  dispose() {
    this._setBackgroundInert(false);
    this._open = false;
    this.refs = {};
  }
}
