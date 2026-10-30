# Quiet Mahjong — Game Specification

**Document status:** running specification of the shipped game (present tense).
**Game index:** 5
**Genre:** Pair-removal puzzle
**Players:** 1 player; asynchronous score comparison
**Targets:** the StarHermit client (native) and browsers (the engine's web runtime), desktop and phones, landscape and portrait
**Technology:** a StarHermit engine script game (engine 1.28.0, host API minor 30): TypeScript in `native/`, the rules and content as plain ES modules in `js/`, the 3D garden on `starhermit:scene`, every screen on `starhermit:ui`

## 1. Product vision

Quiet Mahjong is a game in which players remove matching pairs of uncovered tiles until the layered layout is empty. Its signature setting is a moonlit garden table with ceramic tiles. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Remove matching pairs of uncovered tiles until the layered layout is empty.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **scan the layered layout, select a free tile, pair it, remove both, and reveal new choices**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Track completion time, no-hint streaks, and reshuffles; every generated deal must be solvable. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, from the platform's clock (the device's when offline).
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Score chase:** asynchronous global and friends comparisons using validated seeds and rulesets.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding pauses solo simulation. In hosted play, the authoritative clock continues where rules require it, while the returning client receives a fresh snapshot and a concise “while you were away” summary.

## 3. Screens and interaction

### Screens

- **Title** — a centred panel over the 3D garden (a slow orbit around the stone table with eleven decorative tiles): the name, the tagline, **Play**, **Resume round** when an interrupted round is stored on this device, Daily challenge, Journey, Profile, Settings, Invite a friend (signed in), Sign in with StarHermit (signed out) and a status line (signed in as / offline, a round in progress).
- **Choose a mode** — six cards: Learn (starts the first lesson), Journey, Daily, Practice, Challenge, Score chase; Back.
- **Setup** — heading, description and the facts (rules, par duration, players, assists, ranked: platform board / local records / no), then per mode: Practice's five sizes (Lesson 6, Small 12, Medium 24, Large 36, Grand 54 pairs; Medium preselected), Journey's forty stage cards (cleared ones show their best score, the next uncleared one is highlighted; Start continues there), a stage's own setup with its theme, Challenge's four cards (Start runs the first), the Daily's date, seed and board size. Start and Back (to the modes).
- **Play** — the 3D table fills the window. Top bar: the objective (the lesson's text in Learn; "Board clear!" / "Round over" at the end), pairs removed of the total with the streak, the elapsed time with the tap or time limit left, the score and the pause button. Actions: Hint, Shuffle, Undo and Camera (reset), each disabled when the rules do not allow it. A message line shows errors ("Those faces do not match."), achievements and the lesson's instruction; sound captions (when on) show under the top bar. Free tiles carry a soft outline and a ring under them; the selected tile lifts with a pulsing marker; a hint makes its pair glow for 2.2 s; a removal bursts sparks.
- **Paused / Settings** — one sheet (opened by Pause, Escape or from the title as Settings): Resume (in a round); Audio: the note that volumes, graphics, language, larger text, high contrast, reduced motion and vibration are in the StarHermit Options, **Open Options**, Captions for audio cues; Graphics: Theme (Moonlit Garden, Plum Dawn, Jade Rain, Ember Evening, Winter Quiet; Journey stages and challenges use their own theme); Controls & accessibility: Left-handed controls (the action row reversed), Color palette (standard, deuteranopia-, protanopia-, tritanopia-safe family bands), the current key bindings and **Change controls**; Help: How to play, Replay tutorial; Leave round (in a round) or Back.
- **Results** — Board clear / Round over, the reason, the score table (pairs removed, streak bonus, time bonus, completion, penalties, total), time · hints · shuffles · invalid taps · best streak, new achievements, the leaderboard line (signed in), Play again, Next (the next Journey stage or lesson) and Home.
- **How to play** — six cards: Goal, Free tiles, Select, Stuck, Controls (the live bindings), Score; Back (to the pause sheet in a round).
- **Leaderboards** (Score chase) — Global / Daily / Friends tabs, a note on where the scores come from and the top twenty.
- **Profile** — the display name (a text field for guests, the account's name when signed in), the save's sync state, stats (rounds, clears, best score, pairs) and the six achievements (◆ unlocked, ◇ locked).

Overlays (pause, results, help, score chase, profile) dim the garden; the play view's top bar and actions stay under the dim.

### Layouts

Layouts follow the window's logical size: **wide** (≥ 1024 px) puts the actions at the bottom right (left with left-handed controls); **portrait phones** (≤ 700 px wide, portrait) get a full-width thumb tray of four equal actions; **short landscape** (≤ 480 px tall) moves the status into a narrow rail at the left and the actions into a column at the right. Panels are at most 560 px wide (640 for setup and help), scroll when taller than the window and keep 44 px touch targets.

### Input

| Action | Keyboard (default) | Gamepad | Pointer / touch |
|---|---|---|---|
| Move focus among free tiles | Arrow keys | D-pad, left stick | — |
| Select the focused tile | Enter, Space, Numpad Enter | A | tap / click a tile |
| Pause / resume | Escape | Start, B | pause button |
| Hint | H | Y | Hint |
| Shuffle | S | X | Shuffle |
| Undo | U | Select / Back | Undo |
| Reset camera | C | right stick press | Camera |

Keys and pads are rebound in the runtime's Options (Change controls opens them). A short still press (under 0.6 s, under 12 px of movement) picks the tile under it; a drag orbits the camera around the board (not with reduced motion), and Camera resets it. Arrow keys move a focus ring (with the tile's name) between free tiles by the browser build's directional search; Enter taps the focused tile unless a button has focus. Menus are fully keyboard, pad and screen-reader navigable; on touch-first devices no control is pre-focused.

### Accessibility

Every live tile is an accessibility target named like the browser build's board mirror ("moon 3, layer 1, free", "… blocked", "…, selected"); round events are announced (round start, removed pairs with the streak, errors, results). Text size, high contrast (the UI's high-contrast palette), reduced motion (no title orbit, fireflies, lantern flicker, sparks, marker pulse or drag orbit) and vibration are the runtime's options. Colour is never the only cue: each face has a glyph and a family band, and the colour-vision palettes recolour the bands.

## 4. Visual and audio design

The scene is the browser build's three.js r185 garden on `starhermit:scene`: a night sky and fog per theme, the moon as a directional key light with a board-fitted shadow, ambient and hemisphere fill, a gravel ground, a round stone table (carved rim and pedestal when detailed), fourteen garden rocks, three paper lanterns with flickering warm point lights, a bright moon disc with a halo, a star field, drifting fireflies and the ceramic tiles. Punctual lights are the r185 intensities; the room environment is `new RoomEnvironment(renderer)` lowered by 3.5 (r183+), at environment intensity 0.28. Tile faces are canvas textures drawn as the browser build drew them (glaze, edge, family band, glyph, two-tone side); the colour moon emoji, 〰 and ☔ draw from the engine's emoji font, awaited with `fonts.load` before the faces are redrawn.

Graphics follow the runtime's quality level (`native/quality.ts`, the browser build's presets): Low — Lambert shading, plain boxes, no shadows or post effects; Balanced — Standard shading, rounded tiles, textured stone, stars, 1024 shadows, bloom, grade, FXAA, reflections, sparks, fireflies; High — clear-coated Physical tiles, 2048 shadows, ambient occlusion, SMAA; Ultra — 512-px faces, 4096 shadows, high ambient occlusion, MSAA. Spark and firefly counts grow with the level within a tier. Render scale, adaptive resolution and the frame-rate limit are the runtime's. Ultra faces are drawn a few per frame (the engine's canvas-work and upload bounds), and the game raises its image budget to 192 MiB for a Grand board at Ultra.

Sound: the authored one-shots in `sfx/` per event (select, deselect, remove, invalid, hint, shuffle, undo, won, lost, pause) on the effects bus, a quiet noise ambience loop and a slow pentatonic pad on the music bus (rendered into clips at start). Volumes, mute and the voice limit are the runtime's.

## 5. Technical architecture

- `js/rules.js` — the deterministic rules (seeded streams, layouts, the always-solvable deal, free tiles, legal pairs, commands, scoring, terminal states, replay); `js/content.js` — themes, lessons, Journey, challenges, achievements, the Daily's ruleset. Both unchanged from the browser build and shared with `server.js` and the node tests.
- `js/progress.js` — the progress document, its two-device merge, the game's options, reading the browser build's cloud save, the device store.
- `js/strings.js` + `js/i18n.js` — the nine locales (classic scripts loaded with `loadClassic`); `js/sh-strings.js` — the account strings.
- `native/main.ts` — the flow, the session (every mutation through `rules.apply`, the command log, snapshots), input, progression; `native/screens.ts` — the UI; `native/render.ts` — the garden; `native/platform.ts` — saves, options, leaderboards; `native/audio.ts`, `native/quality.ts`, `native/style.ts` (the UI styles from `tools/ui-style.css`, converted to `assets/ui-style.json` by `npm run css`).

Time runs on the runtime's fixed steps at 60 Hz: an active round's clock sends the rules a 1000 ms tick every 60 steps, so pauses and slow frames never cost time. A hidden window pauses a solo round; the Daily's clock keeps running and the time away is added on return ("While you were away"). After every command the round's config and command log are stored on the device (`qm:save:v1`); the title offers Resume round, which replays the log.

## 6. StarHermit integration

- **Package:** `starhermit.txt` (`engine.entry=native/main.ts`, `engine.version=1.28.0`, `engine.minor=30`, capabilities platform, storage, clipboard, the control and gamepad defaults, `engine.limits.image_mib=192`); `npm run package` writes the web loader `index.html` and `starhermit-files.json`. Development files (tests, tools, server.js, data, docs) are left out by `.starhermitignore`.
- **Saves:** progress is the game's save (`saves`, device and account); two devices' copies merge (better stage and daily results, larger counters, earliest achievement times, the union of friends). The browser build's cloud save (`game:<slug>`) is read once as a foreign save: its progress merges in, its game options are adopted, and it is replaced.
- **Settings:** the game's options (captions, theme, palette, left-handed, tutorial flag) are engine settings kept with the account; the browser build's settings KV values are adopted once and all its keys removed.
- **Device store:** the interrupted round and the local leaderboard keep the browser build's localStorage keys (`qm:save:v1`, `qm:board:v1`); browser guests' old localStorage progress does not migrate (the engine's storage is separate).
- **Leaderboards:** signed in, a finished Journey, Daily or Challenge round (not Learn or Practice, not a resigned round) posts its total to the `high-score` board through `score-script.js` (server-authoritative range check), and the results show the rank. Score chase reads the platform board (everyone's or friends') when signed in; the Daily tab and guests use the local records. Every won round is also a local record.
- **Identity:** the account's display name when signed in (guests set a local name in Profile), the invite link (copied to the clipboard), sign-in on request, and a notice when signed out.
- **Daily:** the date comes from `serverNow()` (the device's UTC clock offline).
- **Localization:** every string in en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT, following the runtime's interface language live.

## 7. Known limitations

- Pre-existing rules behaviour kept: the Long Garden (all 40 stages) and Seven Moons (7 dailies) achievements are checked before the round being finished is recorded, so the unlocking clear counts on the next win.
- The browser build's per-effect graphics overrides, render-scale slider and frame-rate readout are the runtime's Options now (a level, not per-effect choices). The "Tap-to-select (hold mode off)" setting stored a value nothing read and is not offered; "Voice cues" had no voice sounds and is the runtime's voice limit. The 2D compatibility screen for browsers without WebGL is gone (the runtime always draws).
- The procedural tones the browser build played while a sample was still decoding are not ported: until a clip loads, its event is silent.
- The local-only analytics log (`qm:analytics:v1`) is not ported.
- Signed-in paths (cloud merge, foreign-save migration, legacy settings, score posting, platform boards) cannot be driven live in the checks; their logic is covered by `tests/progress.test.mjs`.

## 8. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

## 9. Analytics and privacy

The game records no analytics (the browser build's local-only funnel log was not ported). Any future measurement covers tutorial completion, first meaningful action time, session duration bands, level attempts, quit state, input modality, performance tier, reconnect success, and accessibility feature usage only in aggregate. Use random session identifiers, short retention, and explicit consent where required. Never collect message content, drawings, voice, private board notes, or exact pointer trails as analytics.

Success targets for the first public test: median first-play time under 20 seconds, tutorial completion above 80%, crash-free sessions above 99.5%, p95 input acknowledgment below 100 ms locally, and at least 95% of supported mobile sessions holding their selected frame-rate tier.

## 10. Checks

`npm test` runs:

- `tests/rules.test.mjs` — legality, invalid-action reasons, scoring, terminal states, serialization, replay, fuzzed commands, golden sessions; `tools/validate-content.mjs` — every lesson, stage, challenge and a sweep of daily seeds solvable without soft locks.
- `tests/progress.test.mjs` — the progress merge, normalisation, the old cloud save, options and the device store; `tests/i18n.test.mjs` — every used key translated in all locales with placeholders intact, no unused rows, live switching, account strings.
- `tests/native.mjs` — the web index is current, `tsc` (no skipLibCheck), `starhermit check .` with no warnings, and render-check play scripts that drive the real UI: `journey-1.play` (desktop by pointer: Journey, a hint, pause, help, the board cleared, results, Home), `lesson-keys.play` (Lesson 1 entirely by arrow keys and Enter), `sprint-phone.play` (phone portrait at DPR 3 by touch: Moon Sprint against its clock, profile, score chase), `journey-2-landscape.play` (phone landscape by touch: a shuffle, pause, the board cleared) and today's Daily (generated at test time). The scripts are generated from the rules' greedy solver by `tools/gen-plays.mjs` (`npm run plays`).

`npm run test:browser` (`tools/browser-play.mjs`) plays the packaged web build in Chrome on the GPU (`~/games/tools/gpu-chrome.mjs`) at a desktop, a phone (DPR 3) and a phone held sideways, clearing boards through the accessibility targets, and fails on console errors or warnings.
