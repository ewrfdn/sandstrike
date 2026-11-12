# SANDSTRIKE // 沙暴协议 — Team Build Contract

A self-contained Three.js first-person shooter. Five waves of hostile robots in a compact, Dust II-inspired desert outpost. No external assets: every pixel of texture, every sound, every model is generated in code. Three.js is vendored locally in `vendor/three/` and imported via the import map in `index.html`.

**Quality bar:** this must read as a premium 2024-era shooter screenshot: golden-hour desert, PBR materials, long shadows, readable silhouette, dense set dressing, filmic bloom/grade, tactile first-person weapon, punchy hit feedback. No placeholders, no untextured grey boxes, no lorem ipsum.

## Run

```
node serve.mjs         # http://127.0.0.1:8080
```

Open in Chrome. Use `?dev=1` for debug hooks. Do not use Vite/Webpack. Everything is native ES modules.

## Module ownership (do not write outside your scope)

| Owner | Files |
|---|---|
| world-builder | `src/world.js`, `src/textures.js` |
| robot-combat | `src/enemies.js` |
| fx-artist | `src/effects.js` |
| hud-audio | `src/ui.js`, `src/audio.js`, `styles.css` |
| Lead | `index.html`, `src/main.js`, `src/player.js`, `src/weapons.js`, `src/postfx.js`, `src/config.js`, `src/bus.js`, `src/utils.js`, `serve.mjs`, `README.md`, `TEAM_SPEC.md` |

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


## Shared modules (Lead-owned, stable)

### `src/bus.js`
```js
import { bus, emit, on } from './bus.js';
// bus: EventTarget. emit(type, detail) -> CustomEvent. on(type, fn) -> unsubscribe fn.
```

### `src/config.js`
Exports `CONFIG` object (frozen): `{ world: { bounds }, player: {...}, waves: {...}, colors: {...}, quality }`. You generally do not need it; use values passed at construction. World bounds are **x ∈ [-34, 34], z ∈ [-34, 34]**, floor at y=0.

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
- `game:world` `{ bounds:{minX,maxX,minZ,maxZ}, landmarks:[{x,z,name}], playerSpawn:{x,z,yaw} }`
- `player:stats` `{ health, maxHealth, armor, maxArmor, mag, magSize, reserve, reloading, reloadProgress, weaponName, ads, sprinting, alive }`
- `player:hit` `{ amount, health, armor, direction:{x,y}, lowHealth }`
- `player:heal` `{ amount, health }`
- `wave:start` `{ wave, totalWaves, count, label }`
- `wave:clear` `{ wave, totalWaves, nextIn, bonus }`
- `wave:countdown` `{ seconds, nextWave }`
- `enemy:killed` `{ name, headshot, points, combo, wave, position:{x,y,z} }`
- `enemy:hitmarker` `{ headshot, kill, damage }`
- `score:change` `{ score, combo, multiplier }`
- `radar:update` `{ player:{x,z,yaw}, enemies:[{x,z,type,alive}], bounds }` (≥10 Hz)
- `weapon:notice` `{ text, type:'info'|'warn' }`
- `game:death` `{ score, wave, kills, accuracy, time, bestCombo }`
- `game:victory` `{ score, wave, kills, accuracy, time, bestCombo }`
- `fx:shake` `{ intensity, duration }`
- `fx:hitflash` `{ strength, color }`

UI → Game:
- `ui:start` (new run)
- `ui:resume`
- `ui:restart`
- `ui:pause`
- `ui:menu` (abandon run → menu)
- `ui:settings` `{ sensitivity, volume, quality }` (quality: 'medium'|'high'|'ultra'; main applies pixel ratio/bloom/shadows live if feasible)

## Module APIs

### `src/world.js` — owned by world-builder
```js
export async function createWorld(scene, renderer, { quality, onProgress } = {}) // returns world
world = {
  collideMeshes,        // THREE.Object3D[] — solid visual meshes for weapon/AI raycasts; each has userData.surface ('sand'|'stone'|'metal'|'wood'|'fabric')
  collisionBoxes,       // [{minX,maxX,minZ,maxZ,minY,maxY,surface}] axis-aligned solids. Enemies A* and player sweep against these.
  playerSpawn,          // {x,y,z,yaw} — y is feet height, yaw=0 looks toward -Z
  enemySpawns,          // [{x,y,z,label}] 8+ open-ground points distributed around the map, none inside solids
  mapBounds,            // {minX,maxX,minZ,maxZ}
  landmarks,            // [{x,z,name}] for HUD radar/map
  update(dt,time),      // animated props/ambient fx only
  dispose()
}
```
- `createWorld` owns sky, lighting, fog, terrain, buildings, props, ambient particles, environment map. It must set no global renderer state except through its own objects.
- Floor is y=0 across the playable area. Do not require stairs/slopes for traversal; raised platforms are decor or low cover only.
- Movement corridors must be ≥ 2.4 m clear. Collision boxes may not overlap enemySpawns or playerSpawn. Keep the map enclosed by solid boundary walls.
- Map layout: gold sand courtyard in an adobe desert outpost. South (z≈+26) is player staging with sandbags/truck/awnings; center plaza with a central well/cover; "mid doors" wall around z≈-8 with a double-door gap at x≈0 and flanking tunnels; A-site platform with arch and crates around (x≈17, z≈-24); A-long east lane x≈14..32; B-tunnel west around x≈-22 with a covered passage and warm lamps, B-site around (-18,-24). A ring route must connect everything so robots can path around. Place visual "A"/"B" stencils, arrows, lane dressing.
- Aesthetic: strong golden hour sun ~18° above horizon from the west, warm sky with procedural clouds and dust haze, 2048/4096 shadow map, SSAO-ish baked grime, detailed normal-mapped surfaces, no flat untextured materials. Dune silhouettes and far mesas beyond boundary walls. Animated cloth, dust motes, heat-haze sky shader, spinning turbine/radar dish or similar landmark. Draw calls target < 450.

### `src/enemies.js` — owned by robot-combat
```js
export class EnemyManager {
  constructor({ scene, world, effects, audio, getPlayer, quality='high' })
  raycastTargets   // THREE.Object3D[] hitboxes; userData.robot present
  state            // { wave, totalWaves, alive, remaining, betweenWaves }
  start()          // reset + begin wave 1 (called by main after ui:start)
  reset()
  update(dt, elapsed)
  damage(object, amount, { point, direction, headshot=false, weapon='rifle' }) // resolves robot from hit object
  dispose()
}
```
- `getPlayer()` returns `{ position: THREE.Vector3 /*feet*/, eye: THREE.Vector3, alive: boolean }`, refreshed by main each frame.
- Emit `wave:*`, `enemy:*`, `radar:update`, `score:change`, `fx:shake`, `fx:hitflash` bus events listed above. On final wave cleared emit `game:victory`. Do NOT emit `game:death`; main handles death.
- On enemy hit, call `effects.impact`/`effects.sparks` + audio. On death, call `effects.explosion` and audio.
- Robot design: 3 chassis types (scout, rifleman, heavy), all primitive-built but detailed and readable: armored plates, glowing eye/core, joint pistons, antennae, weapon. Team colors: oxidized bronze/charcoal with cyan visor for scouts, orange-red visor for heavies. Walk/aim/fire/reload/death animations procedural. Spawn materialize effect. Headshots 2× damage and special feedback.
- AI: A* on 1 m grid derived from `world.collisionBoxes` (expand by robot radius), line-of-sight raycast against `world.collideMeshes`, combat strafing, cover-ish spacing, telegraph before firing, burst hitscan with tracers via effects, accuracy balanced for fun. Robots must path around the mid wall/tunnels, not walk through walls or bunch into a single blob.
- Waves: exactly 5. Suggested counts 4, 6, 8, 10, 12 (≤ 40 total). Between-wave intermission ~6 s with countdown. Wave 3+ introduces heavy. Difficulty scales HP/speed/accuracy/aggression. Wave 5 has a heavy "WARLORD" elite. Guarantee completion is possible with rifle ammo supply; robots can drop small ammo/health pickups (handle pickup collision + heal events; main will listen? if you implement pickups, emit `player:heal`/`weapon:notice` yourself and keep it simple).
- Provide `window.__devEnemies` hook when `?dev=1`.

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
`window.__sandstrike = { game, player, enemies, weapon, world, ui, audio, effects, setState(state), skipToWave(n), godMode(bool) }` when `?dev=1`.

## Integration rules
- Native ES modules, no build step, Chromium/WebGL2 target.
- Do not add dependencies; do not import from `node_modules` at runtime.
- All procedural textures generated via canvas/DataTexture. No network requests to images/fonts/audio.
- Use `THREE.MathUtils` and `src/utils.js`. Respect color spaces: color textures SRGBColorSpace, data texture NoColorSpace.
- Every exported function/class must match this spec exactly; main is written against it. If you need a contract addition, message Lead — do not silently change names.
- Validate with `node --check src/<file>.js` and a lightweight import check where possible. Report completion with key implementation details, draw-call budgets, and any deviations.
