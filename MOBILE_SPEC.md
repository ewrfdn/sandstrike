# SANDSTRIKE // 沙暴协议 — Mobile Adaptation Contract

Status: **implemented** — kept as the integration contract + handoff record for the mobile
milestone. Extends `TEAM_SPEC.md`. File ownership was enforced during the build: never edit a
file outside your scope.

## 0. Goal

Add a first-class mobile experience to the existing desktop-only FPS demo:

1. **Touch controls** that can actually play the game: left virtual stick (move, auto-sprint),
   right drag-to-look, fire (hold), ADS (toggle), reload, jump, crouch (toggle), pause.
2. **Responsive UI**: menu / pause / death / victory screens and in-game HUD usable on phone
   screens in landscape (primary) and portrait (menu usable, gameplay shows a "rotate" hint).
3. **Mobile performance defaults**: touch devices boot at `medium` quality with a capped pixel
   ratio; the Lead adds adaptive resolution. Desktop behavior must be **pixel-identical** to
   before (`npm run qa` must still pass; no new console errors).
4. **No new dependencies, no external assets, no build step** (standalone build keeps working).

Desktop controls (keyboard + mouse + pointer lock) must keep working exactly as today.

## 1. File ownership (this milestone)

| Owner | Files |
|---|---|
| Lead | `src/player.js`, `src/weapons.js`, `src/main.js`, `index.html`, `src/config.js`, `MOBILE_SPEC.md`, `TEAM_SPEC.md`, `README.md`, `scripts/build-standalone.mjs` |
| mobile-touch | `src/touch.js` (new, only this file) |
| mobile-hud | `src/ui.js`, `styles.css` (only these two) |
| mobile-qa | `scripts/mobile-qa.mjs` (new), `shots/mobile-*` outputs |

Do not touch files owned by someone else. If the contract seems wrong or insufficient,
message the Lead instead of changing another file.

## 2. Mobile detection (implemented in `src/touch.js`, exported)

```js
/** True on phones/tablets or when forced with ?touch=1. ?touch=0 forces desktop. */
export function detectTouchMode(search = location.search) -> boolean
export class TouchControls { ... }
```

Rules, in order:

1. `?touch=1` / `?touch=true` → **true**
2. `?touch=0` / `?touch=false` / `?desktop=1` → **false**
3. `matchMedia('(pointer: coarse)').matches` → **true**
4. `matchMedia('(hover: none)').matches && navigator.maxTouchPoints > 0` → **true**
5. otherwise **false**

`main.js` calls `detectTouchMode()` and, when true, adds class `is-touch` to
`document.documentElement` (`<html class="is-touch">`) and sets `game.touchMode = true`.
`TouchControls` must also (re)assert `document.documentElement.classList.add('is-touch')` in
its constructor so `?touch=1` works even if someone constructs it directly.

## 3. `src/touch.js` — TouchControls

```js
import { TouchControls } from './touch.js';

const touch = new TouchControls({
  player,                 // Player instance (see §4 for the API it adds)
  weapon,                 // WeaponSystem instance (see §5)
  canvas,                 // <canvas id="scene">
  mount,                  // document.getElementById('ui')
  onPause: () => {},      // called by the pause button; Lead wires it to pauseGame('touch')
});
touch.setVisible(false);  // called by main on game:state; default true once constructed
touch.dispose();
```

The module subscribes to `game:state` itself (import `{ on }` from `./bus.js`):
`state === 'playing'` → `setVisible(true)`, anything else → `setVisible(false)` + `releaseAll()`.
`setVisible(v)` toggles class `is-visible` on the root and sets `aria-hidden`.
It must be null-safe: every `player`/`weapon` method call is feature-detected
(`typeof player.setMoveInput === 'function'`), so a partially wired build does not throw.

### 3.1 DOM contract (mobile-touch writes this markup, mobile-hud styles it)

A single `<div class="touch-ui" data-touch-ui>` appended to `mount` (`#ui`):

```html
<div class="touch-ui" data-touch-ui aria-hidden="true">
  <div class="touch-look" data-touch-look></div>

  <div class="touch-stick" data-touch-stick>
    <div class="touch-stick-ring"></div>
    <div class="touch-stick-knob" data-touch-knob></div>
  </div>

  <div class="touch-buttons">
    <button type="button" class="touch-btn touch-btn--crouch" data-touch-action="crouch" aria-label="Crouch / 蹲伏"><span class="tb-glyph">⌄</span><span class="tb-label">CROUCH</span></button>
    <button type="button" class="touch-btn touch-btn--jump"   data-touch-action="jump"   aria-label="Jump / 跳跃"><span class="tb-glyph">⌃</span><span class="tb-label">JUMP</span></button>
    <button type="button" class="touch-btn touch-btn--reload" data-touch-action="reload" aria-label="Reload / 换弹"><span class="tb-glyph">⟲</span><span class="tb-label">RELOAD</span></button>
    <button type="button" class="touch-btn touch-btn--ads"    data-touch-action="ads"    aria-label="Aim down sight / 机瞄"><span class="tb-glyph">+</span><span class="tb-label">ADS</span></button>
    <button type="button" class="touch-btn touch-btn--fire"   data-touch-action="fire"   aria-label="Fire / 射击"><span class="tb-glyph">◎</span><span class="tb-label">FIRE</span></button>
  </div>

  <button type="button" class="touch-pause" data-touch-action="pause" aria-label="Pause / 暂停"><span class="tb-glyph">II</span></button>

  <div class="touch-rotate" data-touch-rotate aria-hidden="true">
    <div class="rotate-glyph">▭</div>
    <div class="rotate-title">ROTATE DEVICE</div>
    <div class="rotate-cn">请横屏握持设备以投入战斗</div>
  </div>
</div>
```

Contract details:

- `.touch-look` is the right-hand look/drag surface (full height, right ~64% width, CSS
  positions it). `pointer-events: auto` only while `.touch-ui.is-visible`.
- The stick button cluster and pause button live **above** the look surface (CSS z-index).
- `data-touch-action` values: `fire`, `ads`, `reload`, `jump`, `crouch`, `pause`.
- Toggle-state buttons get class `is-on` (ADS, crouch) and `aria-pressed="true"`.
- `.touch-ui` gets class `is-visible` only while the game state is `playing`.
- The rotate hint is shown by CSS only (`@media (orientation: portrait)`) while `.is-visible`.
  JS should not need to toggle it.
- Extra class on root for QA/state: `is-firing`, `is-ads`, `is-moving` (optional, cheap to add).

### 3.2 Input behavior

Use **Pointer Events** (`pointerdown` / `pointermove` / `pointerup` / `pointercancel`), tracked per
`pointerId`, `event.preventDefault()`, and `try { el.setPointerCapture(id) } catch {}` (synthetic
events in QA throw `NotFoundError` — never let that break input). Support simultaneous
stick + look + fire (three pointers). Every listener that cancels gestures uses
`{ passive: false }`.

| Control | Gesture | Action |
|---|---|---|
| stick | drag from base (dead zone 12%, max radius measured from element rect) | `player.setMoveInput(x, forward)` with `x` = right positive, `forward` = forward positive, both −1..1 |
| stick | near-full deflection forward (mag > 0.9 && forward > 0.7) | `player.setSprintHeld(true)` else `setSprintHeld(false)` |
| stick | release / cancel | `player.setMoveInput(0, 0)`, `setSprintHeld(false)` |
| look | drag on `.touch-look` | `player.look(dx * k, dy * k)`; `k = 2.2` (hip) / `1.45` (while `weapon.ads > 0.5`) |
| fire | press & hold | `weapon.setTrigger(true)`; release/cancel → `weapon.setTrigger(false)` |
| ads | tap | toggle `weapon.setAiming(bool)`; sync `is-on` / `aria-pressed` |
| reload | tap | `weapon.startReload()` |
| jump | tap | `player.queueJump()` |
| crouch | tap | toggle `player.setCrouchHeld(bool)`; sync `is-on` / `aria-pressed` |
| pause | tap | `onPause?.()` (do **not** emit `ui:pause` yourself) |

`releaseAll()` must: stop movement/sprint, release fire, release ADS (leave crouch/ADS toggle state
alone unless you prefer resetting — reset ADS to off, keep crouch as toggled state reset off),
clear all active pointer ids. Call it on `setVisible(false)`, `window blur`,
`document visibilitychange` (hidden), and `pointercancel` at document level.
Also ignore input while `player.enabled === false` (menu/pause/dead) is already covered by
visibility, but guard jump/fire the same way.

Do not change the camera/weapon directly outside the listed APIs; do not read input in `update()`
loops beyond what is listed. No per-frame allocation.

### 3.3 Accessibility / QA hooks

- Buttons are real `<button type="button">` elements with `aria-label`.
- `window`-level: expose nothing; Lead adds `window.__sandstrike.touch = touch` when `?dev=1`.
- `dispose()` removes all listeners and the `.touch-ui` node.

## 4. `src/player.js` additions (Lead implements; mobile-touch codes against this)

```js
// New public API (exact names):
player.setMoveInput(x, forward)   // x right-positive -1..1, forward forward-positive -1..1; (0,0) clears
player.queueJump()                // same effect as pressing Space once
player.setCrouchHeld(bool)        // OR-ed with keyboard Ctrl/C; held / toggled by caller
player.setSprintHeld(bool)        // OR-ed with keyboard Shift; only sprints while moving forward
player.setTouchMode(bool)         // true: requestPointerLock() becomes a no-op and unlocked mouse look stays off
```

Keyboard behavior is unchanged; virtual values are combined additively in `update()`.

## 5. `src/weapons.js` additions (Lead implements)

```js
weapon.setTrigger(down)  // virtual trigger: true = triggerDown + immediate tryFire(), false = release
weapon.setAiming(bool)   // virtual ADS; drives the same `aiming` field the right mouse button sets
weapon.setTouchMode(bool) // true: ignore mouse mousedown/mouseup input (touch layer owns it)
```

## 6. `src/main.js` wiring (Lead)

- `const touchMode = detectTouchMode()`, `document.documentElement.classList.add('is-touch')`.
- Touch devices default to `medium` quality unless `?quality=` is present.
- Instantiate `TouchControls` after `weapon` is built; wire `onPause: () => pauseGame('touch')`;
  call `player.setTouchMode(touchMode)`, `weapon.setTouchMode(touchMode)`.
- Skip pointer-lock requests entirely in touch mode (`player.setTouchMode` handles it).
- Orientation/resize: re-run `onResize()` on `orientationchange` (250 ms delay) and on
  `visualViewport` resize; keep `renderer.setSize(w, h, false)` + `postfx.setSize`.
- Adaptive resolution on touch devices only (small pixel-ratio steps between 0.72 and the
  quality cap) — no behavior change on desktop.
- Prevent iOS long-press callout / double-tap zoom: `contextmenu` preventDefault when touch mode,
  `gesturestart` preventDefault.
- Dev hooks: `window.__sandstrike.touch = touch`.

## 6.1 Concurrent external workstream (read this)

This workspace is shared with a **separate, non-mobile workstream** that is adding
(concurrently, outside this contract):

- a DEPLOY difficulty modal: `[data-start]` / `[data-action="restart"]` now open a
  dialog; the run starts only after tapping `[data-deploy-value="standard"|"hardcore"]`
  (`src/ui.js`, `.deploy` CSS);
- a frame-counter HUD / `showFps` setting / `F3` toggle (`.fps-*` elements in `src/ui.js`);
- their own probe scripts (`scripts/fps-*.mjs`, `scripts/tmp-*.mjs`) and updates to
  `scripts/qa.mjs` (which now handles the deploy modal).

Rules for the mobile team:

1. **Never revert or restructure their blocks.** Only append/insert mobile-specific CSS
   (`styles.css`) and make the minimal touch-legend change (`src/ui.js`). Re-read a file
   immediately before every write; use targeted edits with unique anchors, never whole-file
   rewrites of `styles.css` / `src/ui.js`.
2. Start-flow assertions must go through the deploy modal (see §8 item 3).
3. Mobile QA includes a start-flow smoke check, exactly like the patched `scripts/qa.mjs`.
4. The other workstream's scratch scripts are theirs: do not delete them; the Lead cleans up
   only files owned by this team before handoff.

## 7. `styles.css` + `src/ui.js` (mobile-hud)

Required CSS contract for the touch DOM (§3.1):

- `.touch-ui` fixed inset 0 inside `#ui`, `pointer-events: none`, `opacity: 0`, and
  `.touch-ui.is-visible { opacity: 1 }`; all interactive children re-enable `pointer-events: auto`
  only under `.is-visible`:
  ```css
  .touch-ui.is-visible .touch-look,
  .touch-ui.is-visible .touch-stick,
  .touch-ui.is-visible .touch-btn,
  .touch-ui.is-visible .touch-pause { pointer-events: auto; }
  ```
  The hidden layer must never intercept menu/pause clicks.
- `touch-action: none` on `.touch-ui`, `.touch-look`, `.touch-stick`, `.touch-btn`, `.touch-pause`.
- Visual language must match the existing HUD (amber/cyan, thin borders, clipped/glass panels,
  `var(--amber)`, `var(--cyan)`, `var(--panel-*)`, letter-spacing; no external images/fonts).
- Safe areas: use `env(safe-area-inset-*)` on all four HUD corners, touch buttons and pause button.
- Sizes: fire button ≥ 76px diameter; other action buttons ≥ 52px; pause ≥ 44px tap target.
  All must sit inside the viewport at 640×320 (small landscape) without overlap:
  left stick bottom-left; action cluster bottom-right; pause top-right.
- Keep the pause button clear of the existing top-right radar panel (shift/scale the radar in the
  touch media queries).
- `.touch-rotate` hint: hidden by default; `@media (orientation: portrait)` + `.touch-ui.is-visible`
  → full-screen dim overlay with centered message. Hide the HUD in portrait-during-play if the
  hint covers it (hint has high z-index, HUD can stay underneath).
- `html.is-touch` variants: hide keyboard-only affordances (`.mbtn-key`, HUD `.ammo-hint`,
  `.pause-foot` "ESC", `kbd` hints in the HUD), enlarge tap targets, and hide `.fx-letterbox`
  and `.hud-watermark` (they eat scarce phone screen).
- Media queries (in this order at the end of `styles.css`, after existing responsive block):
  1. `@media (hover: none) and (pointer: coarse)` — touch device baseline.
  2. `@media (max-height: 500px)` — phone landscape (390/430/450 px tall): compact HUD, compact
     menu (START must be visible without scrolling), compact pause/death/victory screens.
  3. `@media (max-width: 1024px)` — tablets / small windows.
  4. `@media (orientation: portrait)` — portrait menu stack; gameplay rotate hint.
  Desktop (≥ 900px wide, fine pointer, ≥ 560px tall) must be visually unchanged.

`src/ui.js` changes (minimal, behavior-preserving):

- When `document.documentElement.classList.contains('is-touch')` (evaluate once in `_build`),
  render the CONTROLS panel with touch rows instead of keyboard rows:
  `LEFT STICK 移动`, `DRAG 视角`, `FIRE 开火`, `ADS 机瞄`, `RELOAD 换弹`, `JUMP 跳跃`,
  `CROUCH 蹲伏`, `PAUSE 暂停`. Keep the `.controls-list` structure.
- Do not change event handling, bus contracts, or HUD logic. `npm run qa` must pass unchanged.

## 8. Mobile QA (`scripts/mobile-qa.mjs`, mobile-qa)

`node scripts/mobile-qa.mjs [url]` (default `http://127.0.0.1:8080`), headless Chromium
(`playwright-core`, executable `C:/Program Files/Google/Chrome/Application/chrome.exe`,
SwiftShader args like `scripts/qa.mjs`). Emulate a phone with
`browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })`
(and a second 390×844 portrait context). Use `page.goto(url + '/?dev=1&quality=medium&touch=1')`.

Drive real touch through CDP:

```js
const client = await page.context().newCDPSession(page);
await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x2, y: y2, id: 1 }] });
await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
```

Assertions (write results to `shots/mobile-qa.json`, exit 1 on any failure, print each ✓/✗):

1. Loads with 0 console errors / page errors; `window.__sandstrikeApp.loaded === true`.
2. Menu: `[data-start]` visible, rect inside viewport, height ≥ 44 px; no horizontal page overflow.
3. Tap START → the DEPLOY difficulty modal opens (external workstream feature, see §6.1);
   tap `[data-deploy-value="standard"]` → state `playing`, `.touch-ui.is-visible`,
   `document.pointerLockElement === null`.
4. Stick: drag from stick center upward ~55 px, wait 700 ms → player moved > 0.4 m;
   after `touchEnd` → poll until player speed < 0.3 m/s (frame-paced, use a long timeout).
5. Look: drag on `.touch-look` right→left 120 px → `player.yaw` changed by > 0.25 rad.
6. Fire: hold fire button 400 ms → `weapon.mag` decreased; release + wait 400 ms → mag stable.
7. Reload: tap reload → `weapon.reloading === true`; poll until reloading false → mag refilled.
8. ADS: tap → `weapon.aiming === true`; poll (`fastForward` if needed) until `player.aiming`
   true; tap again → both false.
9. Jump: tap jump → `player.velocity.y > 0` or `player.position.y > 0` within 300 ms.
10. Crouch: tap crouch → `player.crouching === true` and eye height < 1.5 after 400 ms.
11. Pause: tap pause → state `paused`, `.touch-ui` not visible; resume via `[data-action="resume"]`.
12. Portrait (390×844): menu start button reachable; during play `.touch-rotate` hint visible.
13. Screenshots into `shots/`: `mobile-01-menu-landscape.png`, `mobile-02-playing-landscape.png`,
    `mobile-03-fire.png`, `mobile-04-paused.png`, `mobile-05-menu-portrait.png`,
    `mobile-06-portrait-rotate-hint.png`, `mobile-07-end.png` (use dev hook to force death if
    faster: `window.__sandstrike.damagePlayer(999)` then wait).
14. Desktop regression: 1600×900 without hasTouch → `.touch-ui` not visible, start click works,
    no console errors. (Full desktop QA is the Lead's job; a smoke check here is enough.)

Keep the whole run under ~5 minutes; use dev hooks (`__sandstrike.freeze`, `renderOnce`,
`start()`, `damagePlayer`) to avoid waiting on real gameplay. Screenshots must be taken after a
`renderOnce()` + short wait, like `scripts/qa.mjs` does.

## 9. Acceptance for this milestone

- `node scripts/check.mjs` passes.
- `node scripts/mobile-qa.mjs` passes all assertions, 0 console errors.
- `node scripts/qa.mjs` (desktop) still passes with 0 console errors and desktop visuals unchanged.
- `node scripts/build-standalone.mjs` + `node scripts/verify-standalone.mjs` still pass (Lead).
- Screenshots show a coherent, premium-looking mobile HUD and menu (Lead reviews).

### Final verification record (quiet machine, serialized)

| Check | Result |
|---|---|
| `node scripts/check.mjs` | pass |
| `node scripts/mobile-qa.mjs` | **14/14 groups, exit 0**, 133 s, 0 console errors (landscape/portrait/desktop), 7 fresh DPR-3 screenshots |
| `node scripts/verify-standalone.mjs` (rebuilt `sandstrike.html`) | **0 errors**, render loop normal, 0 network requests, 15/15 waves cleared on `file://` |
| `node scripts/qa.mjs` (desktop 1600×900) | **0 errors**, full 15 waves → victory, death screen, movement-direction + loot regressions pass |
| Desktop visual regression (mobile-hud evidence) | 324 mobile-only rules exist, 0 match a desktop element; clearing all 324 changed 0 of 629 nodes × 61 computed properties |
| `shots/mobile-*.png` + `shots/mobile-css-*.png` | reviewed: menu, deploy, HUD, fire, pause, death, portrait rotate hint, 640×320/932×430/tablet/desktop |

Known notes:
- Under SwiftShader a DPR-3 mobile page can present <1 frame/s, so the QA harness runs behaviour
  groups in a DPR-1 context and uses `__sandstrike.fastForward()` for frame-dependent assertions.
- Portrait gameplay intentionally shows the rotate overlay instead of the touch controls.
- Touch devices default to `medium` quality only on first visit; an explicit `?quality=` or the
  player's saved choice wins.
