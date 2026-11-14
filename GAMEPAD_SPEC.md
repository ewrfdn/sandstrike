# SANDSTRIKE // 沙暴协议 — Gamepad / Controller Contract

## 0. Goal

Add full **gamepad (controller) support** to SANDSTRIKE without changing the
mouse + keyboard or touch experience:

- Standard-mapping pads (Xbox / PlayStation / Switch Pro / generic) work over
  USB or Bluetooth through the browser **Gamepad API**.
- **Gameplay**: left stick move, right stick look, RT fire (analog, full-auto),
  LT ADS (hold), A jump, B crouch toggle, X reload, LB / L3 sprint hold,
  **RB / D-pad right = next weapon, D-pad left = previous weapon**,
  START pause/resume.
- **Menus**: D-pad / sticks move a visible focus ring, A confirms, B goes back,
  START confirms outside gameplay. The whole game (boot → NEW GAME / CONTINUE /
  SELECT STAGE → difficulty → play → pause → death/victory → redeploy) is
  playable with only a controller. D-pad keeps its menu-navigation role outside
  gameplay (weapon cycling only applies while playing).
- **Campaign / weapons (current build)**: the player starts with only the
  VXR-7; the other three guns (RPG-7 / M-77 gatling / SG-12 shotgun) come from
  the SIEGE WARDEN boss drop (5% per boss kill) and are cycled with RB / D-pad
  once owned. The HUD shows a 4-slot weapon rail plus a boss HP bar during boss
  waves; the pad legend/hints cover the new cycle controls.
- **Polished integration**: hot-plug (auto-pause on disconnect), rumble
  (persisted on/off setting), adaptive control legend / key hints, HUD state,
  no console errors, works in the single-file build too.
- **Zero regression**: keyboard, mouse, pointer lock, touch layer and the
  existing QA probes behave exactly as before.

Non-goals: remapping UI, multiple local players, motion controls, non-standard
mapping editors. Pads whose `mapping !== 'standard'` still use the standard
index layout as a best effort.

## 1. File ownership (this milestone)

| Owner | Files |
|---|---|
| Lead | `GAMEPAD_SPEC.md`, `src/main.js`, `src/player.js`, `src/config/game.js`, `scripts/check.mjs`, `package.json`, `README.md`, `sandstrike.html` (build output) |
| gamepad-input | `src/gamepad.js` (new input module) — nothing else |
| gamepad-ui | `src/ui.js`, `styles.css` — nothing else |
| gamepad-qa | `scripts/gamepad-probe.mjs` (new), `shots/gamepad-*` — nothing else |

Never edit a file owned by another owner. Put throw-away experiments in
`.scratch/<your-name>/`.

Run the game with the already-running local server: <http://127.0.0.1:8080>
(`node serve.mjs`; it is already up). Chrome:
`C:/Program Files/Google/Chrome/Application/chrome.exe`. There is no build
step for development: ES modules are served directly.

## 2. Detection & global mode

- New module `src/gamepad.js` exports:

```js
/** True when this browser exposes the Gamepad API (feature detection only). */
export function detectGamepadSupport();
```

- `src/main.js` constructs the controller only when supported and not disabled
  by `?gamepad=0`. No other URL parameter is needed; a fake pad can be injected
  from tests (see §8).
- While a pad is connected the module toggles the document class
  `html.is-gamepad` (adds on connect, removes on disconnect). The class is a
  styling/legend hint only — **input never depends on it**.
- On touch devices `html.is-touch` keeps priority for the control legend
  (mobile layout is never replaced); gameplay input from both layers is
  independent (§4 pad fields vs touch virtual fields).

## 3. `src/gamepad.js` — `GamepadControls`

Plain ES module, no imports from Three.js, no build step, no external assets.
Import only `{ on, emit } from './bus.js'` (and optionally `clamp/damp` from
`./utils.js`).

### 3.1 Constructor

```js
new GamepadControls({
  player = null,        // Player instance (may be missing at boot: feature-detect every call)
  weapon = null,        // WeaponSystem instance (feature-detect every call)
  settings = {},        // { sensitivity = 1, vibrate = true }
});
```

Construction must never throw when `player`/`weapon`/`navigator.getGamepads`
are missing. It registers its own listeners (`game:state` bus event, window
`blur`, document `visibilitychange`, pointerdown to suspend the focus ring) and
starts with zero state. `main.js` calls `update(dt)` every animation frame
(including menu / paused states — menu navigation lives here).

### 3.2 Public API (exact names)

```js
get supported()          // boolean, Gamepad API available
get connected()          // boolean, >= 1 pad currently connected
get active()             // boolean, connected && some pad input within the last 2 s
get id()                 // string | '' raw pad id
get kind()               // 'xbox' | 'playstation' | 'switch' | 'generic' | ''
get mapping()            // string | '' pad.mapping
get vibrationEnabled()   // boolean
get gameState()          // 'menu' | 'playing' | 'paused' | 'dead' | 'victory' | 'boot'
getState()               // QA snapshot, plain object (see §3.8)
setSensitivity(mult)     // 0.25..3 look sensitivity multiplier (settings.sensitivity)
setVibrationEnabled(on)  // toggles rumble, persists through UI settings (module only stores it)
update(dt = 1 / 60)      // one polling + input step; dt in seconds, clamp 0..0.1
releaseAll()             // release every virtual input this module owns
dispose()                // remove listeners, releaseAll(), remove html classes
```

- Input is forwarded through the **virtual input API** (same philosophy as
  `src/touch.js`), never synthetic DOM key events:
  - `player.setPadMoveInput(x, forward)` — x right positive, forward positive,
    both −1..1, 0 when idle.
  - `player.setPadSprintHeld(bool)`, `player.setPadCrouchHeld(bool)`.
  - `player.queueJump()` on the A edge.
  - `player.addLook(dYaw, dPitch)` — radians, applied directly (see §4).
  - `weapon.setTrigger(bool)` **only on edge** (hold state is tracked by the
    weapon). Never call it with the same value every frame: that would cancel a
    mouse-held trigger.
  - `weapon.setAiming(bool)` **only on edge**, same reason.
  - `weapon.startReload()` on the X edge.
  - `weapon.cycleWeapon(+1)` on the RB / D-pad right edge and
    `weapon.cycleWeapon(-1)` on the D-pad left edge (gameplay only; a one-weapon
    inventory is a safe no-op). Never call it every frame: it starts a short
    draw animation and cancels reloads/ADS.
- All calls must be guarded (`typeof fn === 'function'`), never throw.

### 3.3 Standard mapping

`mapping === 'standard'` indices (also used as best effort otherwise):

| Control | Index | Behaviour |
|---|---|---|
| Left stick | axes 0/1 | move; radial deadzone **0.16**, rescale after deadzone |
| Right stick | axes 2/3 | look; radial deadzone **0.20**, response curve `pow(t, 1.55)` |
| A | 0 | jump (edge) / confirm in menus |
| B | 1 | crouch toggle (edge, gameplay) / back in menus |
| X | 2 | reload (edge) |
| Y | 3 | reserved, unused |
| LB | 4 | sprint hold (gameplay) |
| RB | 5 | next carried weapon (edge, gameplay; same as D-pad right) |
| LT | 6 | ADS hold, analog `value > 0.32` |
| RT | 7 | fire, analog `value > 0.32`; hold = automatic fire |
| Back / View | 8 | back (menus), unused in gameplay |
| Start / Options | 9 | pause toggle in playing/paused; confirm otherwise (edge) |
| L3 | 10 | sprint hold (gameplay) |
| R3 | 11 | unused |
| D-pad up/down | 12/13 | menu focus navigation only |
| D-pad left | 14 | gameplay: previous carried weapon (edge); menus: focus navigation only |
| D-pad right | 15 | gameplay: next carried weapon (edge); menus: focus navigation only |

Analog values: `value = btn.value ?? (btn.pressed ? 1 : 0)`.

### 3.4 Gameplay feel (constants in `gamepad.js`)

```js
const PAD_MOVE_DEADZONE = 0.16;
const PAD_LOOK_DEADZONE = 0.20;
const PAD_LOOK_SPEED = 2.9;        // rad/s at full deflection, sensitivity = 1
const PAD_LOOK_CURVE = 1.55;
const PAD_LOOK_ADS_SCALE = 0.55;   // multiplier while weapon.ads > 0.5
const PAD_LOOK_DAMP = 22;          // velocity smoothing lambda (utils.damp)
const PAD_TRIGGER_THRESHOLD = 0.32;
const PAD_MENU_REPEAT_DELAY = 0.42; // s before first auto-repeat
const PAD_MENU_REPEAT_RATE = 0.13;  // s between repeats
const PAD_RUMBLE_MIN_INTERVAL = 0.05; // s throttle
const PAD_ACTIVE_TIMEOUT = 2.0;    // s, for `active`
```

- **Look**: build target velocity
  `yawRate = -xNorm * PAD_LOOK_SPEED * sensitivity * (ads ? 0.55 : 1)`,
  `pitchRate = -yNorm * same`. Smooth the two velocities with
  `damp(current, target, PAD_LOOK_DAMP, dt)` and call
  `player.addLook(yawRate * dt, pitchRate * dt)` once per update.
  Sign convention: stick right => look right (yaw decreases), stick up =>
  look up (pitch increases).
- **Move**: `player.setPadMoveInput(x, -y)` after deadzone/rescale; diagonal is
  normalized by `Player.update()` itself (just pass the raw axes; do not
  re-normalize). Always call it every update while playing (cheap, and it
  guarantees pad input is released when the stick returns to center).
- **Fire / ADS edges**: keep `_triggerSent` / `_aimSent`; call the weapon
  setter only when the boolean changes.
- **Weapon cycling edges** (gameplay only): `RB` or D-pad right →
  `weapon.cycleWeapon(1)`; D-pad left → `weapon.cycleWeapon(-1)`. Edge-triggered
  and guarded (`typeof weapon.cycleWeapon === 'function'`). The weapon system
  cancels reload/ADS, plays the ~0.25 s draw animation and emits
  `weapon:switched` + `weapon:slots`; the HUD rail highlights the new slot.
  In menus these inputs stay focus-navigation inputs (§3.5).
- **Rumble** (`_rumble(weak, strong, ms)`): only when `vibrationEnabled`,
  `pad.vibrationActuator.playEffect` exists, and ≥ `PAD_RUMBLE_MIN_INTERVAL`
  since the last pulse. Always `try/catch` and ignore promise rejections.
  Trigger from bus events (subscribe in the constructor, unsubscribe in
  `dispose`):
  | bus event | weak | strong | ms |
  |---|---|---|---|
  | `weapon:fired` | 0.18 | 0.05 | 55 |
  | `enemy:hitmarker` | 0.25 | 0.12 | 60 |
  | `enemy:killed` | 0.50 | 0.35 | 110 |
  | `player:hit` | 0.85 | 0.65 | 150 |
  Increment a counter in `getState()` (`rumbleCount`, `lastRumble`) for QA.

### 3.5 Menu focus navigation (controller-only)

The module owns a DOM focus ring — `ui.js` only styles it (`.gp-focus`).

The menu flow changed with the campaign update: the action column is now
**NEW GAME** (`[data-start]`, same legacy hook) / **CONTINUE** /
**SELECT STAGE** / SYSTEM CONFIG, gated by save state. NEW GAME opens the
difficulty deploy panel (`[data-deploy]`, four `[data-deploy-value]` cards:
recruit / standard / veteran / nightmare); SELECT STAGE opens the stage-select
overlay (`[data-stage-select]` with `[data-stage-value]` stage cards, locked
stages `disabled`). Outside combat the in-run HUD also shows the 4-slot weapon
rail and the boss HP bar, which the pad legend/hints describe.

- Candidate elements come from the currently visible UI:
  - if `[data-deploy]` has class `is-open`: its `[data-deploy-value]` buttons;
  - else the active screen: `.screen.is-active button:not([disabled]), .screen.is-active input[type="range"]`.
    The stage-select overlay (`[data-stage-select].is-open`) reuses this query — `ui.js`
    marks the covered menu regions `aria-hidden="true"` while it is open, so only its
    enabled `.stage-card` / stage-back buttons survive the visibility filter below.
  - Filter out elements with `offsetParent === null`, zero-size rects, or
    ancestors with `[hidden]` / `aria-hidden="true"`.
- Focus management:
  - `_focusEl`: add class `gp-focus` and call `el.focus({ preventScroll: true })`;
    remove `gp-focus` from the previous element.
  - When entering a screen / deploy-open / when the focused element disappears,
    focus the **default** candidate, in priority order:
    1. `.deploy-card.is-default` inside the open deploy panel
       (fallback: first deploy card),
    2. `[data-start]:not([disabled])` (menu, once ready),
    3. `[data-action="resume"]` (pause screen),
    4. `[data-action="restart"]` (death/victory),
    5. first candidate.
  - No focus ring while `gameState === 'playing'` (clear it) or after a
    pointerdown (mouse user takes over; suspend until the next pad nav input).
  - Activate focused element with A / START outside gameplay:
    `el.click()` for buttons; for `input[type="range"]` A does nothing.
  - D-pad / left or right stick (threshold 0.55) navigate spatially: pick the
    nearest candidate whose center lies in the pressed direction
    (`forward = dx*dirX + dy*dirY > 2`, score = `forward + 2.2 * |lateral|`);
    edges fire once + auto-repeat after the delay/rate above.
  - When an `input[type="range"]` is focused, left/right adjust its value by
    step (sensitivity step 0.05, volume step 1) and dispatch a bubbling `input`
    event; clamp to `min`/`max`.
  - Firing A/START must not also trigger gameplay actions while not playing.
- START in `playing`/`paused`: emit bus event `gamepad:toggle-pause`.
- B / Back outside gameplay: emit `gamepad:back` (do not click anything).
- Pressing Start on menu/deploy/dead/victory behaves like A (confirm focused).

### 3.6 Bus events emitted

```js
emit('gamepad:state', {
  supported: true, connected, id, kind, mapping, active,
  source: 'poll' | 'connect' | 'disconnect',
});
// only when connected/id/kind/mapping changes (never every frame)
emit('gamepad:notice', { text, type: 'info' | 'warn' }); // connect / disconnect text
emit('gamepad:toggle-pause', {});                       // START in playing/paused
emit('gamepad:back', {});                               // B/Back outside gameplay
emit('gamepad:action', { action, source: 'gamepad' });  // optional edge telemetry
```

Connect notice text: `CONTROLLER ONLINE // 手柄已连接` (info).
Disconnect notice text: `CONTROLLER LOST // 手柄已断开` (warn).

### 3.7 Lifecycle / robustness

- Subscribe `game:state` in the constructor: on `playing` reset per-run toggles
  (crouch off) and keep polling; on `paused`/`dead`/`victory`/`menu` call
  `releaseAll()`. `releaseAll()` zeroes move, sprint, crouch, sends
  `weapon.setTrigger(false)` / `setAiming(false)` only if previously sent,
  clears pressed/edge tracking and the focus ring is cleared when leaving
  menus only if gameplay starts.
- `window.blur` / `document.visibilitychange` (hidden): `releaseAll()`.
- Handle pads appearing/disappearing while the page runs (poll every frame;
  also listen to `gamepadconnected`/`gamepaddisconnected` if present, but never
  depend on them). Disconnect while playing is auto-paused by `main.js`;
  the module only has to emit state + notice.
- Multiple pads: first connected non-null wins; switching pads keeps working.
- `dispose()` removes every listener, clears focus classes, removes
  `html.is-gamepad`, and is idempotent.

### 3.8 QA snapshot (`getState()`)

Return at least:

```js
{
  supported, connected, active, id, kind, mapping,
  axes: [..4 numbers..],
  buttonsDown: [indices of pressed/valued buttons],
  focused: '<tag>[data-...=...]' /* stable selector-ish string or '' */,
  gameState, vibrationEnabled, rumbleCount, lastRumble,
  triggerSent, aimSent, padCount,
}
```

No allocations in hot loops other than the snapshot; no per-frame DOM writes
beyond the focus ring changes (which only happen on focus transitions).

## 4. `src/player.js` additions (Lead implements — gamepad-input codes against this)

```js
this.padMove = { x: 0, forward: 0 };  // constructor
this.padSprintHeld = false;           // constructor
this.padCrouchHeld = false;           // constructor

/** Gamepad virtual axes (independent of touch so both can coexist). */
setPadMoveInput(x, forward) { /* clamp −1..1 */ }
setPadSprintHeld(held) { this.padSprintHeld = !!held; }
setPadCrouchHeld(held) { this.padCrouchHeld = !!held; }

/** Absolute look delta in radians, independent of mouse sensitivity. */
addLook(dYaw, dPitch) {
  this.yaw += Number(dYaw) || 0;
  this.lookPitch = clamp(this.lookPitch + (Number(dPitch) || 0), -P.maxPitch, P.maxPitch);
}
```

In `update(dt)` they are additive with the existing keyboard/touch inputs:

- `inputX += this.padMove.x; inputZ -= this.padMove.forward;`
- `wantsSprint` OR-ed with `this.padSprintHeld`
- `crouching` OR-ed with `this.padCrouchHeld` (still `&& !this.sprinting`)
- `reset()` clears padMove / padSprintHeld / padCrouchHeld.

No changes to `src/weapons.js` are required: `setTrigger`, `setAiming`,
`startReload` already exist. Edge-only calls keep mouse input working (§3.2).

## 5. `src/main.js` wiring (Lead)

1. Import `{ GamepadControls, detectGamepadSupport } from './gamepad.js'`.
2. `DEFAULT_SETTINGS` gains `vibrate: true`; `loadSettings()` mirrors it.
3. After `postfx` is constructed in `boot()` (before the touch block), build:

```js
let gamepad = null;
if (detectGamepadSupport() && params.get('gamepad') !== '0') {
  try {
    gamepad = new GamepadControls({
      player, weapon,
      settings: { sensitivity: settings.sensitivity, vibrate: settings.vibrate !== false },
    });
  } catch (error) {
    console.warn('[SANDSTRIKE] gamepad controls failed to initialise', error);
    gamepad = null;
  }
}
```

4. `animate()`: call `gamepad?.update(dt)` once per frame, inside the existing
   try block, before the `game.state` branch (menus must navigate too).
5. `fastForward()` dev hook: call `try { gamepad?.update(dt); } catch {}`
   inside the loop before `player.update(dt)` (only while state is playing) so
   QA can drive the pad deterministically.
6. Pointer lock: in `startRun()` and `resumeGame()` request pointer lock only
   when the pad is not being used:
   `if (!(gamepad && gamepad.active)) player.requestPointerLock();`
   (a gamepad button press is not a browser user activation, so locking would
   fail and show a misleading mouse-lock error).
7. `on('ui:settings')`: forward `detail.sensitivity` -> `gamepad?.setSensitivity`
   and `detail.vibrate` -> `gamepad?.setVibrationEnabled`, and keep them in the
   local `settings` object.
8. `on('gamepad:state')`: when `detail.connected === false` and
   `game.state === 'playing'`, `pauseGame('gamepad')` (auto-pause on
   disconnect). UI shows the notice.
9. Dev hooks: add `gamepad` to `window.__sandstrike` and
   `get gamepad() { return gamepad; }` to `window.__sandstrikeApp`.

## 6. `src/ui.js` + `styles.css` (gamepad-ui)

### 6.1 Settings rows (both panels, rendered by `settingsMarkup`)

Insert after the RENDER QUALITY row, before FRAME COUNTER:

```html
<div class="set-row set-row--pad">
  <span class="set-label">CONTROLLER <em>手柄</em></span>
  <span class="set-pad" data-pad-status>NOT DETECTED</span>
</div>
<div class="set-row set-row--toggle">
  <span class="set-label">VIBRATION <em>震动反馈</em></span>
  <button type="button" class="set-toggle" data-action="vibrate" aria-pressed="true">
    <span class="toggle-dot"></span><span data-vibrate-label>ENABLED</span>
  </button>
</div>
```

- Settings object: `vibrate: stored.vibrate !== false` (default **on**),
  persisted in `sandstrike.settings.v1`; include in `_saveSettings()`,
  `_emitSettings()` (`vibrate` field) and `_syncSettingsInputs()`.
- Action `vibrate` -> `_setVibrate(!this.settings.vibrate)`; label
  `ENABLED` / `DISABLED`, `aria-pressed`, `.is-off` class like the FPS toggle.
- Status text: disconnected `NOT DETECTED` (muted), connected
  `XBOX · CONNECTED` / `PLAYSTATION · CONNECTED` / `SWITCH · CONNECTED` /
  `GENERIC · CONNECTED` with `.is-on` (green) class.

### 6.2 Adaptive control legend

- Add a `PAD_CONTROLS` row list and render the legend dynamically:
  wrap the list as `<ul class="controls-list" data-controls-list>${...}</ul>`
  and add `_renderControlsLegend()` choosing priority
  **touch (`html.is-touch`) > gamepad connected > keyboard**.
- Rows (Xbox glyphs; PlayStation uses ✕ ○ □ △ L1 L2 R2 OPTIONS):
  `LSTICK` MOVE 移动, `RSTICK` LOOK 视角, `RT` FIRE 射击, `LT` ADS 机瞄,
  `X` RELOAD 换弹, `RB / D-PAD` CYCLE WEAPON 切换武器,
  `LB/L3` SPRINT 冲刺, `A` JUMP 跳跃, `B` CROUCH 蹲伏,
  `START` PAUSE 暂停, `D-PAD` MENUS 菜单导航.
  Use `<kbd>` badges (same markup shape as the keyboard list). On touch devices
  the legend priority (`is-touch` > gamepad > keyboard) keeps the touch rows and
  shows the `⇄ SWITCH 切换武器` entry instead.
- On `gamepad:state` connected/id changes call `_renderControlsLegend()` and
  `_syncControlHints()`.

### 6.3 Contextual key hints

When a pad is connected (and not touch), swap the keyboard hints in place; the
gamepad module uses A/START semantics from §3.5:

- menu START button `.mbtn-key`: `A` (was `···`),
- pause RESUME `.mbtn-key`: `START` (was `ESC`),
- death/victory REDEPLOY `.mbtn-key`: `A` (was `ENTER`),
- pause footer text: `START TO RESUME · 按 START 继续` (was `ESC TO RESUME · 按 ESC 继续`),
- HUD `.ammo-hint`: `X — RELOAD 换弹` (was `R — RELOAD 换弹`);
  while more than one weapon is owned also append
  `· RB/D-PAD — CYCLE 切换武器` / on PlayStation `R1/D-PAD`.
  Restore the keyboard strings on disconnect (keyboard or touch mode).
Add the refs you need (`padStatuses`, `vibrateLabels`, `vibrateToggles`,
`controlsList`, `ammoHint`, …) in `this.refs`.

### 6.4 Bus handlers (in `_bindBus()`)

```js
bind('gamepad:state', (detail) => this._onGamepadState(detail));
bind('gamepad:notice', (detail) => this._notice(detail));
bind('gamepad:toggle-pause', () => {
  if (this.state === 'playing') this._pause();
  else if (this.state === 'paused') this._resume();
});
bind('gamepad:back', () => {
  if (this._deployOpen) { this._closeDeploy(); return; }
  if (this.state === 'paused') { this._resume(); return; }
  if ((this.state === 'dead' || this.state === 'victory') && this._endVisible) {
    this._toMenu(); return;
  }
});
```

`_onGamepadState(detail)`:

- toggles `document.documentElement.classList.toggle('is-gamepad', !!detail.connected)`,
- stores `this._pad = { connected, id, kind, mapping }`,
- updates both status rows (both settings panels), calls
  `_renderControlsLegend()` + `_syncControlHints()`,
- shows the connect/disconnect notice (only on an actual transition; the first
  poll at boot must not flash a notice).

### 6.5 Deploy default card

In `_openDeploy()` mark the current difficulty card: add class `is-default`
to `[data-deploy-value="${this.settings.difficulty}"]`, remove it elsewhere, so
the gamepad module can focus it (§3.5) and keyboard/mouse users see which card
was last used. Style it subtly (amber border + corner tick; no new text row).

### 6.6 `styles.css`

- `.gp-focus` ring: 2 px amber outline with offset + soft glow; visible over
  light sand and dark glass; must not cause layout shift. Prime it for
  `.mbtn`, `.deploy-card`, `.set-toggle`, `.set-quality button`,
  `input[type="range"]`.
- `.set-pad` status line (mono, 8 px, muted; `.is-on` green).
- `.deploy-card.is-default` subtle highlight.
- `html.is-gamepad` tweaks only where needed (cursor stays visible).
- Mobile: `html.is-touch` rules keep priority; pad legend row markup must fit
  in the existing compact settings/controls layout at 844×390 and 1280×720.
  Do not regress the existing `.controls-list` breakpoints.

## 7. Single-file build (Lead)

After the feature lands, run `node scripts/build-standalone.mjs` and keep
`sandstrike.html` in sync; `node scripts/verify-standalone.mjs` must still pass.

## 8. `scripts/gamepad-probe.mjs` (gamepad-qa)

`node scripts/gamepad-probe.mjs [url]` — black-box Playwright probe against
<http://127.0.0.1:8080> (default). Mirror the style of `scripts/mobile-qa.mjs`:
grouped checks, `chk()`/`finish()`, JSON result, screenshots, exit code 1 on
failure, zero console-error tolerance.

**Fake pad injection** (must be an init script, before the page boots):

```js
await page.addInitScript(() => {
  const pad = {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
    index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: {
      playEffect(type, params) {
        (window.__rumbleLog = window.__rumbleLog || []).push({ type, ...params });
        return Promise.resolve('complete');
      },
      reset() { return Promise.resolve('complete'); },
    },
  };
  window.__fakePad = pad;
  window.__setPadConnected = (on) => { pad.connected = !!on; };
  window.__setPadAxis = (i, v) => { pad.axes[i] = Number(v); };
  window.__setPadButton = (i, pressed, value) =>
    { pad.buttons[i] = { pressed: !!pressed, touched: !!pressed, value: value ?? (pressed ? 1 : 0) }; };
  window.__setPadId = (id) => { pad.id = String(id); };
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => (pad.connected ? [pad] : []),
  });
});
```

Also support a second context without the init script for keyboard reference.
Use `?dev=1&quality=medium` (SwiftShader args copied from `qa.mjs`); use
`window.__sandstrike.fastForward(seconds)` for deterministic gameplay ticks and
real waits (300–800 ms) for UI transitions. The Lead adds
`gamepad.update(dt)` to `fastForward()` for this purpose.

### Required groups (all must pass)

1. **API / detection** — `__sandstrikeApp.gamepad` exists; `getState().supported`,
   `connected`, `kind === 'xbox'`; `html.is-gamepad` set; settings row shows
   `CONNECTED`.
2. **Legend / status DOM** — menu controls list shows RT/LT/A/B/X rows (not
   WASD/MOUSE/ESC); both settings panels show the controller status.
3. **Menu navigation / campaign flow** — NEW GAME (`[data-start]`) focused by
   default (`gp-focus`); D-pad down/up moves focus; CONTINUE is disabled without
   a save; A on SYSTEM CONFIG does nothing harmful; A on NEW GAME opens the
   deploy panel; `.deploy-card.is-default` focused; D-pad left/right moves focus
   across the four difficulty cards (recruit / standard / veteran / nightmare);
   A starts the run (`state === 'playing'`). Once playing, the HUD weapon rail
   (`[data-weapon-slots]`) has 4 `[data-slot]` cells with slot 0 active and only
   the VXR-7 owned, and `[data-boss-bar]` stays hidden until a boss wave.
4. **Pad-only start** — from a fresh page: A (menu) → A (deploy) reaches
   `playing` without any mouse/keyboard event; `document.pointerLockElement`
   is not required; no console error.
5. **Movement** — left stick forward / right / diagonal moves the player in the
   correct camera-relative direction with `fastForward` (distance within ±20 %
   of `walkSpeed * time`), diagonal speed not faster than forward; 0.10
   deflection (inside deadzone) moves < 0.05 m.
6. **Sprint / jump / crouch** — LB held + forward reaches sprint speed
   (≈ `7.3 m/s` ±20 %); L3 also sprints; A sets `grounded === false` and
   `position.y > 0` briefly; B toggles `crouching` on, B again off.
7. **Look** — right stick right decreases yaw, up increases pitch; pitch clamps
   at ±`maxPitch`; 0.1 deflection does not move the view.
8. **ADS / fire / reload / weapon cycle** — LT hold drives `weapon.ads > 0.8`
   and lowers `viewCamera.fov`, release returns `< 0.2`; RT tap fires exactly one
   round; RT held 0.5 s fires ≥ 4 rounds (640 rpm) and release stops; X reloads
   and the magazine refills after `fastForward(2.6)`. After
   `__sandstrike.forceWeapon('gatling')`, RB (or D-pad right) fires exactly one
   `cycleWeapon` and the HUD rail highlights slot 2 (M-77, 200-round belt) while
   ADS is cancelled and no shot is possible until the draw finishes; D-pad left
   cycles back to the VXR-7; with a one-weapon inventory both inputs are safe
   no-ops (no console error).
9. **Look slowdown while ADS** — yaw delta over the same `fastForward` window
   with LT held is ≤ 70 % of the hip-fire delta.
10. **Pause / resume / hot-plug** — START pauses (`state === 'paused'`,
    pause screen active, RESUME focused, `gp-focus`); START resumes; pressing B
    in pause resumes; disconnect while playing auto-pauses and shows the warning
    notice; reconnect restores `html.is-gamepad`; nothing is stuck (trigger
    false, stick zero).
11. **Rumble + setting persistence** — `window.__rumbleLog` grows after firing;
    toggle VIBRATION off in the pause settings (pad focus or click); fire again
    → log stops growing; `localStorage['sandstrike.settings.v1'].vibrate === false`;
    reload → toggle still OFF and `getState().vibrationEnabled === false`.
12. **PlayStation + keyboard fallback** — set pad id to
    `Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)`,
    reconnect → status shows `PLAYSTATION`, legend shows `✕`/`○`; disconnect →
    legend returns to keyboard (WASD/MOUSE), keyboard `W` still moves and mouse
    click still fires after pointer-lock click.
13. **Console / screenshots** — zero console errors and pageerrors in the pad
    context; fresh screenshots (delete first):
    `shots/gamepad-01-menu.png` (1600×900, pad connected, focus ring, pad
    legend), `gamepad-02-deploy.png`, `gamepad-03-playing.png`,
    `gamepad-04-ads.png`, `gamepad-05-paused.png` (RESUME focused),
    `gamepad-06-settings.png` (both controller + vibration rows visible),
    `gamepad-07-mobile-pad.png` (844×390, `touch=1`, pad status visible,
    touch layout intact). Write `shots/gamepad-probe.json` with per-group
    checks, timings and screenshot paths; print a readable summary.

Assertion thresholds may be loosened only with a written note in the JSON and
in the final report (SwiftShader frame timing is noisy, so prefer
`fastForward`-based comparisons over wall-clock).

## 9. Acceptance

- `node scripts/check.mjs` passes, `src/gamepad.js` is listed as a deliverable.
- `node scripts/gamepad-probe.mjs` passes with 0 console errors.
- Existing probes still pass (at minimum `scripts/controls-probe.mjs`,
  `scripts/mobile-qa.mjs`; the verifier also runs `scripts/qa.mjs` when the
  machine is quiet).
- `node scripts/build-standalone.mjs` + `node scripts/verify-standalone.mjs`
  pass; standalone file still opens from `file://` with the pad working.
- README documents the mapping, settings, hot-plug behaviour, `?gamepad=0`,
  and the probe command.
- Diff contains no debug leftovers, no changed tunables outside this scope.
