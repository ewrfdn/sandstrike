#!/usr/bin/env node
/**
 * Static checks: syntax, JSON import attributes, vendored imports, external asset
 * references, required deliverable modules, config contracts (difficulty / waves /
 * stages / weapons), a pure-Node save.js smoke test with an in-memory localStorage
 * stub, and full map/level-data validation (the latter lives in
 * `scripts/world-check.mjs` and is also exposed as `npm run check:maps`).
 *
 * Dynamic QA is not run here (needs a dev server + Playwright/browser). Suggested
 * commands for the campaign workstream:
 *   npm run qa:save        # scripts/save-probe.mjs
 *   npm run qa:weapons     # scripts/weapons-probe.mjs
 *   npm run qa:boss        # scripts/boss-probe.mjs
 *   npm run qa:boss-balance # scripts/boss-balance-probe.mjs
 *   node scripts/fps-probe.mjs / node scripts/quality-probe.mjs (hardware GPU)
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, extname } from 'node:path';
import { checkMaps } from './world-check.mjs';

const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    // Only JS is syntax-checked; map/level JSON is validated by world-check.mjs below.
    else if (['.js', '.mjs'].includes(extname(entry.name))) files.push(full);
  }
}
await walk('src');
await walk('scripts');
files.push('serve.mjs');

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed++;
    console.error(`✗ syntax: ${file}\n${result.stderr}`);
  } else {
    console.log(`✓ ${file}`);
  }
}

// Validate bare "three" and "three/addons/*" imports resolve against vendor/.
const importRe = /from\s+['"](three(?:\/addons\/[^'"]+)?)['"]/g;
for (const file of files.filter((f) => f.startsWith('src'))) {
  const code = await readFile(file, 'utf8');
  for (const match of code.matchAll(importRe)) {
    const spec = match[1];
    const target = spec === 'three'
      ? 'vendor/three/three.module.js'
      : join('vendor/three/addons', spec.slice('three/addons/'.length));
    const info = await stat(target).catch(() => null);
    if (!info) {
      failed++;
      console.error(`✗ missing vendored import: ${file} -> ${spec}`);
    }
  }
}

// Every JSON import must carry an import attribute (`with { type: 'json' }`): the browser
// build and Node 24 both require it, and esbuild's standalone bundle depends on it too.
const jsonImportRe = /^\s*(?:import|export)[^;\n]*?from\s+['"]([^'"]+\.json)['"][^;\n]*/gm;
const jsonAttrRe = /with\s*\{\s*type:\s*['"]json['"]\s*\}/;
for (const file of files.filter((f) => f.startsWith('src'))) {
  const code = await readFile(file, 'utf8');
  for (const match of code.matchAll(jsonImportRe)) {
    if (!jsonAttrRe.test(match[0])) {
      failed++;
      console.error(`✗ missing JSON import attribute: ${file} -> ${match[1]}`);
    }
  }
}

// No remote texture/model/audio/font references.
const remoteRe = /https?:\/\/[^\s'"`)]+\.(png|jpe?g|webp|gif|glb|gltf|hdr|exr|mp3|ogg|wav|woff2?|ttf)/gi;
for (const file of files.filter((f) => f.startsWith('src'))) {
  const code = await readFile(file, 'utf8');
  for (const match of code.matchAll(remoteRe)) {
    failed++;
    console.error(`✗ external asset reference: ${file} -> ${match[0]}`);
  }
}

// Legacy monolith files must be gone after the refactor (they were split into
// src/world/, src/config/ and src/ui/). Their presence means main.js may still
// import them.
for (const legacy of ['src/world.js', 'src/config.js', 'src/ui.js']) {
  const info = await stat(legacy).catch(() => null);
  if (info) {
    failed++;
    console.error(`✗ legacy file still present: ${legacy} (should be replaced by src/world/ / src/config/ / src/ui/)`);
  }
}

// Required deliverable modules (path -> minimum byte size; tiny re-export modules are allowed).
const REQUIRED_FILES = [
  ['index.html', 500],
  ['styles.css', 500],
  ['src/world/index.js', 500],
  ['src/world/data/index.js', 500],
  ['src/world/data/schema.js', 500],
  ['src/world/data/collision.js', 500],
  ['src/world/data/formats/v1.js', 500],
  ['src/config/index.js', 100],
  ['src/config/game.js', 500],
  ['src/config/enemies.js', 300],
  ['src/config/difficulty.js', 500],
  ['src/config/waves.js', 500],
  ['src/config/stages.js', 500],
  ['src/config/weapons.js', 500],
  ['src/save.js', 500],
  ['src/config/maps/index.js', 500],
  ['src/config/maps/README.md', 500],
  ['src/enemies.js', 500],
  ['src/effects.js', 500],
  // UI split into functional-area modules under src/ui/ (see src/ui/index.js).
  ['src/ui/index.js', 500],
  ['src/ui/shared.js', 500],
  ['src/ui/hud.js', 500],
  ['src/ui/home.js', 500],
  ['src/ui/settings.js', 500],
  ['src/ui/overlays.js', 500],
  ['src/ui/perf.js', 500],
  ['src/audio.js', 500],
  ['src/touch.js', 500],
  ['src/gamepad.js', 500],
  ['src/models/weapons/index.js', 500],
  ['src/models/weapons/rpg7.js', 1000],
  ['src/models/weapons/gatling.js', 1000],
  ['src/models/weapons/shotgun.js', 1000],
];
for (const [file, minSize] of REQUIRED_FILES) {
  const info = await stat(file).catch(() => null);
  if (!info || info.size < minSize) {
    failed++;
    console.error(`✗ missing/empty deliverable: ${file}`);
  } else {
    console.log(`✓ deliverable: ${file}`);
  }
}

// ---------------------------------------------------------------------------
// Config contracts — gameplay content is config-driven, so a config edit that
// breaks its own contract must fail CI instead of the browser at runtime.
// ---------------------------------------------------------------------------
console.log('\n--- config contracts ---');

/** One ✓/✗ line per contract assertion; failures feed the shared `failed` counter. */
function checkContract(label, condition, detail = '') {
  if (condition) {
    console.log(`✓ ${label}`);
  } else {
    failed++;
    console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Exact element-wise array equality (config values are small literal tables). */
const eqList = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

// The assertions below import the real config modules (pure JS) and run inside a
// single try/catch so a module that fails to load reports a counted ✗ instead of
// crashing the script with an unhandled rejection.
try {
  // ---- src/config/difficulty.js: four tiers, fixed multiplier table ----------
  {
    const { DIFFICULTIES, DEFAULT_DIFFICULTY_ID, getDifficulty } = await import('../src/config/difficulty.js');
    const ids = DIFFICULTIES.map((tier) => tier.id);
    checkContract('difficulty config: 4 tiers with unique ids', DIFFICULTIES.length === 4 && new Set(ids).size === 4, ids.join(', '));
    checkContract(
      'difficulty config: HP ×[0.5, 1, 2, 4] / DMG ×[0.5, 0.75, 1, 2]',
      eqList(DIFFICULTIES.map((tier) => tier.hpMul), [0.5, 1, 2, 4])
        && eqList(DIFFICULTIES.map((tier) => tier.dmgMul), [0.5, 0.75, 1, 2]),
      `HP ${DIFFICULTIES.map((tier) => tier.hpMul).join(',')} / DMG ${DIFFICULTIES.map((tier) => tier.dmgMul).join(',')}`,
    );
    checkContract(
      'difficulty config: default id exists and resolves',
      ids.includes(DEFAULT_DIFFICULTY_ID) && getDifficulty(DEFAULT_DIFFICULTY_ID).id === DEFAULT_DIFFICULTY_ID,
      DEFAULT_DIFFICULTY_ID,
    );
  }

  // ---- src/config/waves.js: total / boss rule / resolveWave ------------------
  {
    const { WAVE_RULES, STAGE_WAVES, DEFAULT_WAVE_SET, resolveWave, expandComposition } = await import('../src/config/waves.js');
    const { STAGES } = await import('../src/config/stages.js');
    const waveSets = Object.entries(STAGE_WAVES);
    const wrongLengths = waveSets.filter(([, list]) => !Array.isArray(list) || list.length !== WAVE_RULES.total).map(([id]) => id);
    checkContract(
      `wave config: WAVE_RULES.total (${WAVE_RULES.total}) matches every wave list`,
      waveSets.length >= 1 && wrongLengths.length === 0,
      wrongLengths.length ? `wrong length: ${wrongLengths.join(', ')}` : 'no wave lists',
    );
    const bossWaveIndices = [];
    for (const [, list] of waveSets) {
      for (let i = 0; i < list.length; i++) if (WAVE_RULES.bossEvery > 0 && (i + 1) % WAVE_RULES.bossEvery === 0) bossWaveIndices.push(i + 1);
    }
    checkContract(
      'wave config: bossEvery > 0 and produces at least one boss wave',
      Number.isInteger(WAVE_RULES.bossEvery) && WAVE_RULES.bossEvery > 0 && bossWaveIndices.length > 0,
      `bossEvery=${WAVE_RULES.bossEvery} bossWaves=${bossWaveIndices.join(',') || 'none'}`,
    );
    const missingWaveSets = STAGES.filter((stage) => !Object.prototype.hasOwnProperty.call(STAGE_WAVES, stage.waveSet)).map((stage) => `${stage.id}:${stage.waveSet ?? 'missing'}`);
    checkContract('wave config: every stage waveSet exists', missingWaveSets.length === 0, missingWaveSets.join(', '));

    const emptyWaves = [];
    const badBossWaves = [];
    for (const stage of STAGES) {
      const list = STAGE_WAVES[stage.waveSet] || STAGE_WAVES[DEFAULT_WAVE_SET] || [];
      for (let i = 0; i < list.length; i++) {
        const wave = i + 1;
        const resolved = resolveWave(stage.id, wave);
        const counts = {};
        const units = expandComposition(resolved.comp);
        for (const key of units) counts[key] = (counts[key] || 0) + 1;
        const isBossWave = WAVE_RULES.bossEvery > 0 && wave % WAVE_RULES.bossEvery === 0;
        if (units.length < 1) emptyWaves.push(`${stage.id}#${wave}`);
        if (!!resolved.boss !== isBossWave) badBossWaves.push(`${stage.id}#${wave}:bossFlag=${resolved.boss}`);
        if (isBossWave) {
          const bossCount = counts[WAVE_RULES.bossType] || 0;
          if (bossCount !== WAVE_RULES.bossCount) badBossWaves.push(`${stage.id}#${wave}:${WAVE_RULES.bossType}×${bossCount}`);
          for (const replaced of WAVE_RULES.bossReplaces) {
            if ((counts[replaced] || 0) > 0) badBossWaves.push(`${stage.id}#${wave}:${replaced} still present`);
          }
        }
      }
    }
    checkContract('wave config: resolveWave returns ≥1 unit for every wave of every stage', emptyWaves.length === 0, emptyWaves.join(', '));
    checkContract(
      'wave config: boss waves contain exactly bossCount boss and no bossReplaces chassis',
      badBossWaves.length === 0,
      badBossWaves.join(', '),
    );
  }

  // ---- src/config/stages.js: catalog / map ids / unlock / next chain ---------
  {
    const { STAGES, DEFAULT_STAGE_ID, getStage, getStageByIndex, nextStage } = await import('../src/config/stages.js');
    const { MAP_SOURCES } = await import('../src/config/maps/index.js');
    const ids = STAGES.map((stage) => stage.id);
    checkContract(
      'stage config: ids unique + index contiguous 1..N',
      ids.length >= 1 && new Set(ids).size === ids.length && STAGES.every((stage, i) => stage.index === i + 1),
      `indexes ${STAGES.map((stage) => stage.index).join(',')}`,
    );
    const missingMaps = STAGES.filter((stage) => !Object.prototype.hasOwnProperty.call(MAP_SOURCES, stage.mapId)).map((stage) => `${stage.id}:${stage.mapId}`);
    checkContract('stage config: every mapId exists in MAP_SOURCES', missingMaps.length === 0, missingMaps.join(', '));
    const defaultStages = STAGES.filter((stage) => stage.unlockedByDefault === true);
    checkContract(
      // A build may ship several always-playable stages (e.g. the island showcase map
      // next to OUTPOST 07); the invariant we actually need is: DEFAULT_STAGE_ID exists
      // and is itself unlocked, and at least one stage is unlocked by default.
      'stage config: DEFAULT_STAGE_ID resolvable + unlocked, >=1 unlockedByDefault',
      defaultStages.length >= 1
        && ids.includes(DEFAULT_STAGE_ID)
        && !!getStage(DEFAULT_STAGE_ID)
        && defaultStages.some((stage) => stage.id === DEFAULT_STAGE_ID),
      `default=${DEFAULT_STAGE_ID} unlockedByDefault=${defaultStages.map((stage) => stage.id).join(',') || 'none'}`,
    );
    const chainErrors = [];
    for (let i = 0; i < STAGES.length; i++) {
      const expected = STAGES[i + 1] || null;
      const actual = nextStage(STAGES[i].id);
      if (expected ? (!actual || actual.id !== expected.id) : actual !== null) chainErrors.push(`${STAGES[i].id} -> ${actual ? actual.id : 'null'}`);
      if (!getStageByIndex(i + 1) || getStageByIndex(i + 1).id !== STAGES[i].id) chainErrors.push(`getStageByIndex(${i + 1})`);
    }
    checkContract('stage config: nextStage chain is contiguous', chainErrors.length === 0, chainErrors.join(', '));
  }

  // ---- src/config/weapons.js: 4-gun roster + per-mode required stats ---------
  {
    const { WEAPON_ORDER, WEAPON_STATS, MAX_WEAPON_SLOTS, getWeaponStats } = await import('../src/config/weapons.js');
    const statIds = Object.keys(WEAPON_STATS);
    checkContract(
      'weapon config: WEAPON_STATS covers WEAPON_ORDER exactly (4 ids)',
      statIds.length === WEAPON_ORDER.length && WEAPON_ORDER.every((id) => !!WEAPON_STATS[id]),
      `stats=${statIds.join(',')} order=${WEAPON_ORDER.join(',')}`,
    );
    checkContract('weapon config: MAX_WEAPON_SLOTS === 4', MAX_WEAPON_SLOTS === 4, String(MAX_WEAPON_SLOTS));

    const MODES = ['auto', 'rocket', 'pump', 'spinup'];
    const POSITIVE = ['damage', 'rpm', 'magSize', 'reserveMax', 'reloadTime', 'adsFov', 'spreadHip', 'spreadAds', 'spreadMax', 'ammoScale'];
    const requiredByMode = {
      rocket: ['splashRadius', 'splashDamage', 'projectileSpeed'],
      spinup: ['spinUpTime'],
    };
    const problems = [];
    for (const id of WEAPON_ORDER) {
      const stats = WEAPON_STATS[id];
      if (!stats) {
        problems.push(`${id}:missing`);
        continue;
      }
      if (!MODES.includes(stats.mode)) problems.push(`${id}:mode="${stats.mode}"`);
      for (const field of POSITIVE) {
        const value = stats[field];
        if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) problems.push(`${id}.${field}=${value}`);
      }
      if (!(typeof stats.reserveStart === 'number' && Number.isFinite(stats.reserveStart) && stats.reserveStart >= 0)) problems.push(`${id}.reserveStart`);
      if (!(typeof stats.headshotMultiplier === 'number' && stats.headshotMultiplier > 0)) problems.push(`${id}.headshotMultiplier`);
      for (const field of requiredByMode[stats.mode] || []) {
        const value = stats[field];
        if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) problems.push(`${id}.${field} (${stats.mode})`);
      }
      if (stats.mode === 'pump' && !(Number.isInteger(stats.pellets) && stats.pellets >= 2)) problems.push(`${id}.pellets=${stats.pellets} (pump)`);
      if (getWeaponStats(id) !== stats) problems.push(`${id}:getWeaponStats`);
    }
    checkContract('weapon config: required numeric fields present/positive per fire mode', problems.length === 0, problems.join(', '));
  }

  // ---------------------------------------------------------------------------
  // src/save.js — pure-Node smoke test against an in-memory localStorage stub.
  // The module is documented as DOM-free; this proves the roundtrip/sanitising
  // paths that the campaign relies on run outside the browser as well.
  // ---------------------------------------------------------------------------
  console.log('\n--- save.js (pure Node smoke) ---');
  {
    const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const store = new Map();
    const stub = {
      getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
      setItem: (key, value) => { store.set(String(key), String(value)); },
      removeItem: (key) => { store.delete(String(key)); },
      clear: () => store.clear(),
      key: (index) => (Array.from(store.keys())[index] ?? null),
      get length() { return store.size; },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true });
    try {
      const save = await import('../src/save.js');
      const { STAGES, nextStage } = await import('../src/config/stages.js');
      const firstStage = STAGES[0];

      checkContract('save: SAVE_KEY is the versioned key', save.SAVE_KEY === 'sandstrike.progress.v2', save.SAVE_KEY);
      const fresh = save.createEmptyProgress();
      checkContract(
        'save: createEmptyProgress generates one record per configured stage',
        Object.keys(fresh.stages).length === STAGES.length && STAGES.every((stage) => !!fresh.stages[stage.id] && fresh.stages[stage.id].index === stage.index),
        `${Object.keys(fresh.stages).length}/${STAGES.length} records`,
      );

      const run = {
        difficulty: 'veteran',
        weapons: {
          owned: ['vxr7', 'gatling'],
          active: 'gatling',
          perWeapon: { gatling: { magExtension: 10, damageMultiplier: 1.1, reloadSpeedMul: 0.9 } },
        },
        player: { armorBonus: 25, healthBonus: 15, damageReduction: 0.1 },
        score: 777,
      };
      const started = save.recordStageStart(fresh, { stageId: firstStage.id, difficulty: 'veteran', run });
      save.saveProgress(started);
      const loaded = save.loadProgress();
      const startSnap = loaded && loaded.stages[firstStage.id] && loaded.stages[firstStage.id].start;
      checkContract(
        'save: recordStageStart → saveProgress → loadProgress preserves run.weapons.owned',
        !!startSnap && startSnap.difficulty === 'veteran'
          && eqList(startSnap.run.weapons.owned, ['vxr7', 'gatling'])
          && startSnap.run.weapons.active === 'gatling',
        JSON.stringify(startSnap && startSnap.run.weapons),
      );

      const ended = save.recordStageEnd(loaded, {
        stageId: firstStage.id,
        difficulty: 'veteran',
        run,
        stats: { score: 1234, wave: 15, kills: 40, headshots: 12, accuracy: 0.5, time: 600, bestCombo: 9 },
      });
      save.saveProgress(ended);
      const afterEnd = save.loadProgress();
      const record = afterEnd.stages[firstStage.id];
      checkContract(
        'save: recordStageEnd marks cleared, bumps clears/bestScore, stores end snapshot',
        record.cleared === true && record.clears === 1 && record.bestScore === 1234
          && !!record.end && record.end.run.weapons.active === 'gatling' && record.end.stats.wave === 15,
        JSON.stringify({ cleared: record.cleared, clears: record.clears, bestScore: record.bestScore }),
      );
      const nextDef = nextStage(firstStage.id);
      if (nextDef) {
        checkContract('save: recordStageEnd unlocks the next stage', afterEnd.stages[nextDef.id].unlocked === true, nextDef.id);
      } else {
        const campaignSummary = save.summary(afterEnd);
        checkContract(
          'save: final stage sets campaignCleared + nextStageId null',
          campaignSummary.campaignCleared === true && campaignSummary.nextStageId === null,
          JSON.stringify({ cleared: campaignSummary.campaignCleared, nextStageId: campaignSummary.nextStageId }),
        );
      }

      const sanitized = save.sanitizeRunState({
        difficulty: 'nope',
        weapons: { owned: ['plasma', 'vxr7', 'vxr7', 'rpg', 'gatling', 'shotgun', 'extra'], active: 'plasma' },
        player: { armorBonus: 9999, healthBonus: -50, damageReduction: 5 },
        score: -10,
      });
      checkContract(
        'save: sanitizeRunState strips bogus weapons, caps slots, clamps bonuses',
        eqList(sanitized.weapons.owned, ['vxr7', 'rpg', 'gatling', 'shotgun'])
          && sanitized.weapons.active === 'vxr7'
          && sanitized.difficulty === 'standard'
          && sanitized.player.armorBonus === 300
          && sanitized.player.healthBonus === 0
          && sanitized.player.damageReduction === 0.6
          && sanitized.score === 0,
        JSON.stringify({ owned: sanitized.weapons.owned, active: sanitized.weapons.active, player: sanitized.player, score: sanitized.score }),
      );

      store.set(save.SAVE_KEY, '{ not valid json');
      const corrupt = save.loadProgress();
      store.set(save.SAVE_KEY, JSON.stringify({ version: 999, stages: {} }));
      const wrongVersion = save.loadProgress();
      store.clear();
      const missing = save.loadProgress();
      checkContract('save: corrupt / wrong-version / missing save returns null', corrupt === null && wrongVersion === null && missing === null);
    } finally {
      if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
      else delete globalThis.localStorage;
    }
  }
} catch (error) {
  // A config/save module that throws while loading is itself a contract break:
  // report it in the same ✗ style and let the run exit non-zero.
  failed++;
  console.error(`✗ config/save checks crashed while loading: ${error && error.message ? error.message : error}`);
}

// Map / level data validation (folders, registry, loadMap, collision/spawn health).
console.log('\n--- map data validation ---');
const mapResult = await checkMaps();
if (!mapResult.ok) failed += mapResult.failures;

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll static checks passed.');
