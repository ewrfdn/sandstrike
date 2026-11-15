# SANDSTRIKE // 沙暴协议 — Team Build Contract

A self-contained Three.js first-person shooter. A 15-wave campaign in a compact, Dust II-inspired desert outpost — with a **SIEGE WARDEN siege boss every 5th wave**, four difficulty tiers, four carryable weapons and per-stage campaign saves. No external assets: every pixel of texture, every sound, every model is generated in code. Three.js is vendored locally in `vendor/three/` and imported via the import map in `index.html`.

**Quality bar:** this must read as a premium 2024-era shooter screenshot: golden-hour desert, PBR materials, long shadows, readable silhouette, dense set dressing, filmic bloom/grade, tactile first-person weapon, punchy hit feedback. No placeholders, no untextured grey boxes, no lorem ipsum.

## Run

```
node serve.mjs         # game: http://127.0.0.1:8080
npm run dev:tools      # dev viewers: http://127.0.0.1:5199/
```

Open in Chrome. Use `?dev=1` for debug hooks. The game does not use Vite/Webpack — everything is native ES modules; the only Vite + React app is the separate `dev_tools/ui/` viewer, which the shipping game never imports.

## Module ownership (do not write outside your scope)

| Owner | Files |
|---|---|
| Lead | `src/config/**` (except `src/config/enemies.js`), `src/save.js`, `src/main.js`, `src/player.js`, `src/gamepad.js`, `src/touch.js`, `src/audio.js`, `src/bus.js`, `src/postfx.js`, `index.html`, `serve.mjs`, `scripts/build-standalone.mjs`, `dev_tools/**`, `README.md`, `TEAM_SPEC.md`, `.scratch/**` |
| weapon-models | `src/models/weapons/**` (`vxr7.js`, `rpg7.js`, `gatling.js`, `shotgun.js`, `hands.js`, `artkit.js`, `preview.js`, `index.js`), `src/models/index.js`, `MODELS.md` |
| weapon-runtime | `src/weapons.js` (WeaponSystem: 4-slot carry, fire modes, pickups) |
| boss-waves | `src/enemies.js`, `src/models/robots/index.js`, `src/models/robots/boss.js`, `src/config/enemies.js`, `scripts/check.mjs` (config-contract + save-smoke sections) |
| save-ui | `src/ui/**`, `styles.css` |
| qa-verify | `scripts/**` (except the `scripts/check.mjs` sections owned by boss-waves), `shots/**` |
| world-builder | `src/world/**`, `src/textures/**` |
| fx-artist | `src/effects.js` |

Never edit a file another owner owns. Import Three.js with bare `three` and addons as `three/addons/...`.

### Mobile milestone additions (see `MOBILE_SPEC.md`)

| Owner | Files |
|---|---|
| Lead | `src/touch.js` wiring in `src/main.js`/`src/player.js`/`src/weapons.js`, `index.html`, `README.md`, `MOBILE_SPEC.md`, `TEAM_SPEC.md` |
| mobile-touch | `src/touch.js` (touch input module) |
| mobile-hud | `src/ui.js`, `styles.css` (mobile layout + touch HUD; desktop visuals unchanged) |
| mobile-qa | `scripts/mobile-qa.mjs`, `shots/mobile-*` |

Touch input flows through the virtual input API instead of synthetic keys:
`player.setMoveInput / queueJump / setCrouchHeld / setSprintHeld / setTouchMode` and
`weapon.setTrigger / setAiming / setTouchMode`. Touch devices never request pointer lock.
`?touch=1` forces the touch layer on desktop, `?touch=0` forces desktop mode.

### Gamepad milestone additions (see `GAMEPAD_SPEC.md`)

| Owner | Files |
|---|---|
| Lead | `src/gamepad.js` wiring in `src/main.js`/`src/player.js`, `GAMEPAD_SPEC.md`, `scripts/check.mjs`, `package.json`, `README.md`, `dist/sandstrike.html` (build output) |
| gamepad-input | `src/gamepad.js` (Gamepad API input module) |
| gamepad-ui | `src/ui.js`, `styles.css` (settings rows, adaptive legend, focus ring; desktop/mobile visuals unchanged) |
| gamepad-qa | `scripts/gamepad-probe.mjs`, `shots/gamepad-*` |

Gamepad input flows through the pad-specific virtual API instead of synthetic key events:
`player.setPadMoveInput / setPadSprintHeld / setPadCrouchHeld / addLook` and the
shared `weapon.setTrigger / setAiming / startReload` (called on edges only, so mouse
and pad can coexist). Pads are hot-pluggable; disconnecting one auto-pauses a run.
`?gamepad=0` disables the layer for regression testing.


## Shared modules (Lead-owned, stable)

### `src/bus.js`
```js
import { bus, emit, on } from './bus.js';
// bus: EventTarget. emit(type, detail) -> CustomEvent. on(type, fn) -> unsubscribe fn.
```

### `src/config/` (configuration root)
```
src/config/index.js     re-exports CONFIG + all content tables (single import entry: `import { CONFIG } from './config/index.js'`)
src/config/game.js      shared gameplay/renderer tunables + CONFIG.loot (incl. bossWeaponDropChance / bossWeaponDropCount)
src/config/enemies.js   robot combat stats (hp / per-shot damage), incl. the SIEGE WARDEN boss tune
src/config/difficulty.js 4 difficulty tiers (hpMul / dmgMul) + getDifficulty(id)
src/config/waves.js     WAVE_RULES boss rule + STAGE_WAVES wave lists + resolveWave / expandComposition
src/config/stages.js    stage catalog (one save slot + unlock per entry) + getStage / nextStage helpers
src/config/weapons.js   WEAPON_ORDER + WEAPON_STATS for the 4 guns + ammo conversion
src/config/maps/        map catalog: one folder per map, each a composite of JSON parts
                        (+ index.js registry, README.md format doc)
```
`CONFIG` is frozen: `{ world: { bounds }, player: {...}, waves: {...}, loot: {...}, colors: {...}, quality }`. You generally do not need it; use values passed at construction. Default map bounds are **x ∈ [-33, 33], z ∈ [-33, 33]**, floor at y=0; the active map's bounds come from `world.mapBounds`.

**Content is config-driven, never hardcoded.** Wave compositions (`STAGE_WAVES`), the boss wave rule (`WAVE_RULES`), difficulty multipliers, the stage list, weapon stats and loot chances all live in `src/config/`. `src/enemies.js` / `src/weapons.js` / `src/main.js` only read them: do not add wave tables, difficulty switches or weapon numbers back into gameplay code. `node scripts/check.mjs` fails CI when a config breaks its own contract.

Map/level data is *data*, not code: `src/config/maps/<id>/{map,terrain,environment,architecture,props,dressing,spawns}.json`, loaded by `src/world/data/` (`loadMap(id)`), rendered by `src/world/**`. A map is selected with `?map=<id>`; unknown ids fall back to `src/config/maps/index.js`'s `DEFAULT_MAP_ID`. See `src/config/maps/README.md` for the schema and how to add a map.

### `src/save.js` (campaign progression — pure data, no THREE / no DOM)
```js
export const SAVE_KEY = 'sandstrike.progress.v2';
emptyRunState(difficultyId)                        // base loadout run state
sanitizeRunState(raw)                              // strip bogus weapon ids, cap slots, clamp bonuses
createEmptyProgress()                              // one record + unlock flag per STAGES entry
loadProgress() / saveProgress(progress) / clearProgress()
stageRecords(progress) / summary(progress)         // menu / stage-select view models
continueTarget(progress)                           // last played / next uncleared stage + inherited run state
stageStartState(progress, stageId, difficultyId)   // stage snapshot → previous stage end → base loadout
recordStageStart(progress, { stageId, difficulty, run })   // legal write #1 (stage enter)
recordStageEnd(progress, { stageId, difficulty, run, stats }) // legal write #2 (stage clear + unlock next)
setLastDifficulty(progress, id)
```
main.js is the only writer. The save is written ONLY on stage enter and stage end; death / pause / menu / abandonment never touch `localStorage`. Each stage keeps its own start snapshot so REDEPLOY is stable (no stacking). UI panels read it to render the campaign / stage-select screens.

### `src/utils.js`
```js
import { clamp, lerp, damp, rand, randInt, choice, smoothstep, canvasTexture, makeRNG, disposeObject } from './utils.js';
```
`canvasTexture(w, h, drawFn, { srgb=true, repeat=[1,1], anisotropy=8 } = {})` returns a `THREE.CanvasTexture`.
`damp(current, target, lambda, dt)` frame-rate independent smoothing.

## Event bus contract (UI + audio + gameplay listen here)

Game → UI:
- `loading:progress` `{ progress: 0..1, label }`
- `game:ready` `{}`
- `game:state` `{ state: 'menu'|'playing'|'paused'|'dead'|'victory' }`
- `game:world` `{ bounds:{minX,maxX,minZ,maxZ}, landmarks:[{x,z,name}], playerSpawn:{x,z,yaw}, mapId, mapName }`
- `game:stage` `{ stageId, index, total, name, subtitle, waveCount }` — stage entered
- `game:difficulty` `{ id, label, cn, hpMul, dmgMul }` — active difficulty tier (replaces the old `difficulty:'standard'|'hardcore'` field)
- `player:stats` `{ health, maxHealth, armor, maxArmor, mag, magSize, reserve, reloading, reloadProgress, weaponName, ads, sprinting, alive, weaponType, weaponMode, weaponShort, slotIndex, stageId, stageIndex, stageTotal, difficultyId }`
- `player:hit` `{ amount, health, armor, direction:{x,y}, lowHealth }`
- `player:heal` `{ amount, health }`
- `wave:start` `{ wave, totalWaves, count, label }`
- `wave:clear` `{ wave, totalWaves, nextIn, bonus }`
- `wave:countdown` `{ seconds, nextWave }`
- `enemy:killed` `{ name, headshot, points, combo, wave, position:{x,y,z} }`
- `enemy:hitmarker` `{ headshot, kill, damage }`
- `score:change` `{ score, combo, multiplier }`
- `radar:update` `{ player:{x,z,yaw}, enemies:[{x,z,type,alive}], bounds }` (≥10 Hz)
- `weapon:notice` `{ text, type:'info'|'warn', kind? }`
- `weapon:slots` `{ slots:[{ type, name, short, owned, active, mag, magSize, reserve }], activeIndex, maxSlots }` (≤10 Hz, emitted by WeaponSystem)
- `weapon:switched` `{ type, name, index }`
- `boss:spawn` `{ name, displayName, wave, hp, maxHp }`
- `boss:health` `{ hp, maxHp, fraction }` (≤10 Hz on damage; `fraction:0` on death)
- `boss:defeated` `{ name, displayName, wave }`
- `pickup:weapon` `{ type, name }` — boss weapon drop picked up; main equips it via `weapon.addWeapon(type)`
- `pickup:collected` `{ kind, amount }` — regular loot pickup (ammo/health/mag/power/reload/relic/guard/vital)
- `game:death` `{ score, wave, kills, accuracy, time, bestCombo }`
- `game:victory` `{ score, wave, kills, accuracy, time, bestCombo, stageId, stageName, stageIndex, stageTotal, difficulty, difficultyLabel, cleared, unlockedNext, nextStageId, campaignCleared }`
- `combat:all-waves-cleared` `{ wave }` — last wave of the stage cleared (main turns this into victory + stage-end save)
- `fx:shake` `{ intensity, duration }`
- `fx:hitflash` `{ strength, color }`

UI → Game:
- `ui:new-game` `{ difficulty }` — new campaign: wipe save → stage 1 → chosen difficulty
- `ui:continue` `{}` — resume via `save.continueTarget()`
- `ui:select-stage` `{ stageId, difficulty }` — start an unlocked stage (inherits the previous stage's run state)
- `ui:next-stage` `{}` — victory screen NEXT STAGE (main resolves it via `src/save.js`)
- `ui:start` `{ difficulty? }` — legacy automation entry: continue when a save exists, otherwise new game
- `ui:restart` `{ difficulty? }` — REDEPLOY from the stage-start snapshot (same run state)
- `ui:resume`
- `ui:pause`
- `ui:menu` (abandon run → menu)
- `ui:settings` `{ sensitivity, volume, quality }` (quality: 'lowest'|'low'|'medium'|'high'|'ultra'; main applies pixel ratio/bloom/shadows live)

## Module APIs

### `src/world/index.js` — owned by world-builder
```js
export async function createWorld(scene, renderer, { quality, onProgress, mapId } = {}) // returns world
world = {
  collideMeshes,        // THREE.Object3D[] — solid visual meshes for weapon/AI raycasts; each has userData.surface ('sand'|'stone'|'metal'|'wood'|'fabric')
  collisionBoxes,       // [{minX,maxX,minZ,maxZ,minY,maxY,surface}] axis-aligned solids. Enemies A* and player sweep against these.
  playerSpawn,          // {x,y,z,yaw} — y is feet height, yaw=0 looks toward -Z
  enemySpawns,          // [{x,y,z,label}] 8+ open-ground points distributed around the map, none inside solids
  mapBounds,            // {minX,maxX,minZ,maxZ}
  landmarks,            // [{x,z,name}] for HUD radar/map
  mapId,                // active map id (folder name under src/config/maps/), null for the dev greybox
  mapName,              // active map display name (from map.json)
  update(dt,time),      // animated props/ambient fx only
  dispose()
}
```
- Map data comes from `src/world/data/index.js`: `loadMap(mapId)` → plain, structured-cloneable `ctx.data` with `{ id, name, format, layout, terrain, environment, dressing, collisionBoxes, playerSpawn, enemySpawns, mapBounds, landmarks, warnings }`. `listMaps()` returns registered map summaries. `createWorld` falls back to `DEFAULT_MAP_ID` (with a console warning) for unknown ids.
- `src/world/` modules: `index.js` (createWorld), `data/` (format dispatch/validation/collision/spawns — pure JS, no three/DOM), `quality.js`, `batcher.js`, `materials.js`, `sky.js`, `lights.js`, `terrain.js`, `architecture.js`, `props.js`, `dressing.js`, `ambience.js`, `update.js`.
- Level content lives in JSON (`src/config/maps/<id>/`); builders must consume it from `ctx.data` and never hardcode map layout. Adding a map or a level format is described in `src/config/maps/README.md`.
- `createWorld` owns sky, lighting, fog, terrain, buildings, props, ambient particles, environment map. It must set no global renderer state except through its own objects.
- Floor is y=0 across the playable area. Do not require stairs/slopes for traversal; raised platforms are decor or low cover only.
- Movement corridors must be ≥ 2.4 m clear. Collision boxes may not overlap enemySpawns or playerSpawn. Keep the map enclosed by solid boundary walls.
- Map layout (default map `outpost-07`, data in `src/config/maps/outpost-07/`): gold sand courtyard in an adobe desert outpost. South (z≈+26) is player staging with sandbags/truck/awnings; center plaza with a central well/cover; "mid doors" wall around z≈-8 with a double-door gap at x≈0 and flanking tunnels; A-site platform with arch and crates around (x≈17, z≈-24); A-long east lane x≈14..32; B-tunnel west around x≈-22 with a covered passage and warm lamps, B-site around (-18,-24). A ring route must connect everything so robots can path around. Place visual "A"/"B" stencils, arrows, lane dressing. Layout numbers live in JSON; the hardcoded leftovers are listed in `src/config/maps/README.md` → Roadmap.
- Aesthetic: strong golden hour sun ~18° above horizon from the west, warm sky with procedural clouds and dust haze, 2048/4096 shadow map, SSAO-ish baked grime, detailed normal-mapped surfaces, no flat untextured materials. Dune silhouettes and far mesas beyond boundary walls. Animated cloth, dust motes, heat-haze sky shader, spinning turbine/radar dish or similar landmark. Draw calls target < 450.

### `src/enemies.js` — owned by boss-waves
```js
export class EnemyManager {
  constructor({ scene, world, effects, audio, getPlayer, quality='high', stageId, difficulty, getOwnedWeapons })
  raycastTargets   // THREE.Object3D[] hitboxes; userData.robot present
  state            // { wave, totalWaves, alive, remaining, betweenWaves, stageId, difficulty }
  start()          // reset + begin wave 1 (called by main after the stage starts)
  reset()
  update(dt, elapsed)
  damage(object, amount, { point, direction, headshot=false, weapon='rifle' }) // resolves robot from hit object
  damageArea(center, radius, amount, { splashFalloff=0.5, point, direction, weapon='explosive' }) // AoE splash → robots damaged
  setStage(stageId) setDifficulty(idOrObject) getStage() getDifficulty()
  spawnBoss()      // dev/QA: materialise the SIEGE WARDEN immediately
  dispose()
}
```
- `getPlayer()` returns `{ position: THREE.Vector3 /*feet*/, eye: THREE.Vector3, alive: boolean }`, refreshed by main each frame.
- Emit `wave:*`, `enemy:*`, `boss:*`, `pickup:*`, `radar:update`, `score:change`, `fx:shake`, `fx:hitflash` bus events listed above. On the last wave cleared emit `combat:all-waves-cleared`; main turns that into `game:victory` + the stage-end save. Do NOT emit `game:death`; main handles death.
- **Waves are config-driven**: `_beginWave(n)` calls `resolveWave(stageId, n)` from `src/config/waves.js` (no hardcoded wave table in this file). Spawn order = lights shuffled first, heavies at the back, boss LAST after `WAVE_RULES.bossSpawnDelay`. Every `WAVE_RULES.bossEvery`-th wave spawns `WAVE_RULES.bossCount` × `bossType` (`ROBOT_TYPES.boss`, SIEGE WARDEN) and strips `bossReplaces` chassis (warlord) from that wave's composition.
- **Boss**: the boss chassis is spawnable (`TYPE_KEYS` includes `boss`, rig prewarmed once, pooled like the others). It emits `boss:spawn` / `boss:health` (≤10 Hz; fraction 0 on death) / `boss:defeated`, gets a fatter telegraph laser + longer spawn/death animations + chained explosions/bigger shake, and its notices are derived from `def.displayName`. On death it rolls `CONFIG.loot.bossWeaponDropChance` once and, on a hit, drops `bossWeaponDropCount` weapon pickups built with `createWeaponPickup(typeId)` (from `src/models/weapons/index.js`; skipped safely when a weapon model type is not registered yet). Weapon drops hover in a light column, auto-collect within 2 m → emit `pickup:weapon` `{ type, name }`, are capped at 4 live drops and disposed on collect / reset / dispose.
- **Difficulty** only scales enemy HP at spawn (`_waveMods.hp *= hpMul`, boss included) and the damage robots deal to the player (`Math.max(1, Math.round(amount * dmgMul))` in `_applyPlayerDamage`). Enemy speed/accuracy are NOT difficulty-scaled (only the per-wave mods). Unknown ids fall back to STANDARD via `getDifficulty`.
- Robot design: 5 chassis types (scout, rifleman, heavy, warlord, boss), primitive-built but detailed and readable: armored plates, glowing eye/core, joint pistons, antennae, weapon. Team colors: oxidized bronze/charcoal with cyan visor for scouts, orange-red visor for heavies; the SIEGE WARDEN is a 5.35 m siege walker with a shoulder howitzer. Walk/aim/fire/reload/death animations procedural. Spawn materialize effect. Headshots 2× damage and special feedback.
- AI: A* on 1 m grid derived from `world.collisionBoxes` (expand by robot radius), line-of-sight raycast against `world.collideMeshes`, combat strafing, cover-ish spacing, telegraph before firing, burst hitscan with tracers via effects, accuracy balanced for fun. Robots must path around the mid wall/tunnels, not walk through walls or bunch into a single blob. The boss uses the dedicated open-ground `_selectBossSpawnPoint()` search and engages at range (12-36 m); it may slide along cover in tight lanes but never spawns inside geometry.
- Pickups: regular loot table (ammo / health / mag / power / reload / relic / guard / vital) is unchanged; the boss additionally leaves a care package. Dev hook `window.__devEnemies` when `?dev=1`.

### `src/weapons.js` + `src/models/weapons/` — owned by weapon-runtime / weapon-models
```js
// WeaponSystem (src/weapons.js) — 4-slot carry, modes: auto | rocket | pump | spinup
setActive/setTrigger/setAiming/setTouchMode/reset/update/render/setAspect/dispose
getState() getSlots()
addWeapon(type) switchWeapon(indexOrType) cycleWeapon(dir=1)
exportProgression() importProgression(data)        // per-weapon upgrades + owned list (stage save)
addAmmo/addMagCapacity/addDamageBoost/addReloadSpeed resetUpgrades
```
- Weapon data lives in `src/config/weapons.js` (`WEAPON_ORDER`, `WEAPON_STATS`, `MAX_WEAPON_SLOTS`); view/world models live in `src/models/weapons/<id>.js` (`vxr7`, `rpg7`, `gatling`, `shotgun`) registered in `src/models/weapons/index.js` (`WEAPON_TYPES`).
- The player starts with only VXR-7; the other three come from boss drops. `pickup:weapon` → main calls `weapon.addWeapon(type)`; when all 4 slots are full the active slot is replaced. HUD listens to `weapon:slots` / `weapon:switched`.
- `src/models/weapons/index.js` also exports `createWeaponPickup(typeId)` — the bare, hands-free world model used by the boss weapon drops in `src/enemies.js`.
- Fire modes: `auto` hitscan (VXR-7), `rocket` projectile + `enemies.damageArea(center, splashRadius, splashDamage)` explosion (RPG-7), `pump` 8-pellet spread with distance falloff (SG-12), `spinup` spin-up then 1150 RPM (M-77).

### `src/effects.js` — owned by fx-artist
```js
export class Effects {
  constructor(scene, camera, { quality='high' }={})
  update(dt, elapsed)
  muzzleFlash(position, direction, { scale=1, color=0xffb45a, viewmodel=false } = {})
  tracer(from, to, { color=0xffd28a, width=0.035, duration=0.07 } = {})
  impact(point, normal, { surface='stone', scale=1 } = {})   // decal + particles, synchronous
  sparks(point, normal, { count=12, color=0xffb040, speed=6 } = {})
  dustBurst(position, { count=8, scale=1 } = {})
  explosion(position, { scale=1, color=0xff7a2f } = {})
  teleport(position, { color=0xff4d1f, scale=1 } = {})
  shellCasing(position, velocity, { scale=1 } = {})
  dispose()
}
```
- All pooled, capped, no allocations in hot loops. Use additive/HDR colors where appropriate. Add soft point-sprite or shader-driven particles, shockwave rings, smoke, debris. Bullet-hole decals must respect surface orientation and pool cap.
- Muzzle flash must be visible and punchy at the weapon muzzle, plus a transient light optional. Do not bring main renderer state to a bad state. `update` is called every frame while playing and during pause (safe).
- Do not add composer passes; Lead handles post FX.

### `src/ui.js`, `styles.css` — owned by hud-audio
```js
export class UI {
  constructor({ audio, quality }) // UI creates DOM inside #ui itself; index.html has empty #ui
  setQuality(q)      // optional
  dispose()
}
```
- UI subscribes to the bus for all Game → UI events above. Emits UI → Game events. No external fonts/images; use CSS gradients, inline SVG, canvas for radar. Use local system font stack: `Bahnschrift, 'DIN Alternate', 'Segoe UI', sans-serif` and monospace for numbers.
- Screens: loading with progress + tips; main menu with title, subtitle, mission brief, 3D background already on canvas, START button, quality/sensitivity/volume settings, controls legend; pause; death ("SIGNAL LOST") and victory ("SECTOR SECURED") with stats & restart/menu. Hide HUD in menu.
- HUD: top-center wave tracker (1/5 + remaining), top-left mission/objective + score, top-right compact radar (canvas, rotates with yaw, landmarks), bottom-left health/armor with segmented bars, bottom-right ammo with big mag count/reserve + reload progress, dynamic crosshair (spread/ADS/hit), hitmarker, kill feed, wave banners, countdown, low-health vignette, directional damage arcs, low-ammo warning, score/combo popups, subtle vignette/scanline/letterbox. Keep it readable and AAA-tactical, sand/orange + cyan accents, heavy but not cluttered.
- Start screen must look like a cover: huge title, military stencil feel, small red accent, top/bottom telemetry. Chinese and English bilingual (primary English designations + Chinese subtitles).
- Responsive to 1080p and 1440p; never capture pointer events outside active panels.

### `src/audio.js` — owned by hud-audio
```js
export class GameAudio {
  constructor()
  async init()                    // called inside user gesture
  suspend(), resume()
  setVolume(v)                    // 0..1 master
  setCombatIntensity(v)           // 0..1 adaptive music layer
  update(dt, listener)            // listener optional {position, forward}
  // methods called by gameplay modules (all must exist and be safe before init)
  click(), hover(), startRun(),
  shot(), dryFire(), reloadStart(), reloadMagIn(), reloadBolt(),
  hitmarker(headshot), enemyHit(), kill(),
  explosion(scale=1), enemyShot(distance=20, pan=0), robotStep(distance=10),
  teleport(), playerHurt(), playerDeath(), victory(), waveStart(wave), waveClear(),
  footstep(sprinting), jump(), land(), pickup(kind), melee()
  dispose()
}
```
- 100% synthesized Web Audio: wind beds, distant desert ambience, adaptive industrial combat pulse, weapon report with punch, mechanical reload foley, metallic robot hits, hitmarker pings, wave alarms, UI clicks. Use convolution/feedback delay, filters, stereo panners, dynamic compressor. No files/base64 audio.
- Must not throw before `init()`; no audio before a user gesture. Keep output balanced, not fatiguing.

## Lead hooks exposed for QA
When `?dev=1`, main exposes `window.__sandstrike`:
```js
{ game, player, enemies, weapon, world, ui, audio, effects, camera, scene, renderer, postfx, touch, gamepad, bus,
  save,                          // = src/save.js full export (pure data)
  progress, stage, difficulty,   // read-only campaign getters
  newCampaign(difficulty), continueCampaign(), selectStage(stageId, difficulty),
  startStage(stageId, difficulty), nextStageRun(), restartStage(),
  start(), pause(), resume(), menu(),
  forceWeapon(type), forceWeaponDrop(type), spawnBoss(),
  killAll(), jumpToWave(n), fastForward(seconds), godMode(enabled),
  freeze(enabled), renderOnce(), renderFrame(), setCamera({pos,target,fov,roll}), hideUI(), showUI(),
  setQuality(q), setAdaptiveScale(x), setPostfxEnabled(on) }
```
`window.__devEnemies` (installed by `src/enemies.js`) additionally exposes:
`spawnBoss()`, `bossInfo()`, `killAll()`, `jumpToWave(n)`, `setStage(id)`, `getStage()`, `setDifficulty(id)`, `getDifficulty()`,
`damageArea(center, radius, amount, opts)`, `dropWeapon(type[, x, z])`, `forceWeaponDrop(type)`, `weaponDrops()`,
`state()`, `robots()`, `manager`.

## Integration rules
- Native ES modules, no build step, Chromium/WebGL2 target.
- Do not add dependencies; do not import from `node_modules` at runtime.
- All procedural textures generated via canvas/DataTexture. No network requests to images/fonts/audio.
- Use `THREE.MathUtils` and `src/utils.js`. Respect color spaces: color textures SRGBColorSpace, data texture NoColorSpace.
- **Content is config-driven**: waves (`STAGE_WAVES` + `WAVE_RULES`), the boss rule, difficulty tiers, stages, weapon stats and loot chances live only in `src/config/`. Never hardcode a wave table, a difficulty switch, a stage list or weapon numbers in gameplay code.
- **Save writes are main-only and rare**: use `src/save.js` from `src/main.js` at stage enter (`recordStageStart`) and stage clear (`recordStageEnd`); death / pause / menu / abandonment never touch `localStorage`.
- Every exported function/class must match this spec exactly; main is written against it. If you need a contract addition, message Lead — do not silently change names.
- Validate with `node --check src/<file>.js` and a lightweight import check where possible. `node scripts/check.mjs` additionally validates the config contracts + `src/save.js` smoke test. Report completion with key implementation details, draw-call budgets, and any deviations.
