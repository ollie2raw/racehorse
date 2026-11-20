# Perceived lag: attribution of the remaining long tasks (2026-11-20, measurement only, no app change)

Build: main `b4a89888`, Vite production build, served by `scripts/perf/staticServer.mjs`. Harness: `scripts/perf/eventsHarness.mjs` (Event Timing + long-animation-frames + optional CDP CPU profile), Chromium via Playwright, phone profile = CDP CPU throttle 4x. Analyzers: `analyzeEvents.mjs`, `mainThreadStretches.py` (stretches of continuous main-thread work in a CPU profile, grouped by what runs in them), `discreteEventBursts.mjs`. Unminified builds (`vite build --minify false`) were used only to read function names; the code is the same.
Conditions: the laptop was not fully idle (macOS `ApplicationsStorageExtension` at about 40% of a core; load average 1.9 during the Play vs Fritz runs, 18-22 during the multiplayer and headed runs). Absolute numbers are inflated by that; the attribution (which function) is not.

## Play vs Fritz, phone profile, n=10 sessions per build (measured)

| long task | what it is | evidence |
|---|---|---|
| 100-318 ms "e in bot-hand-lifecycle" | `create` -> `ensureContext()` in the audio engine: the `AudioContext` is created from `requestIdleCallback` (`createContextWhenIdle`). Not tied to a tap. | 5 of 6 profiled sessions have one stretch of about 90 ms (104 ms in the single most-detailed profile) whose whole stack is `create > ensureContext`; long-task logs show 104-128 ms |
| Start Match `yb` (96-108 ms; `dispatchDiscreteEvent` in the unminified build) | One synchronous React render of the match screen inside the click: controller hook about 39 ms (of which `useMatchTurnStack` about 15 ms, `useReviewRuntime` about 5 ms), screen about 40 ms, commit about 38 ms (passive effects about 33 ms, of which `updateHandTileSize` about 19 ms: a layout measurement in an effect, the "forced layout" seen before) | 5 profiled Start Match flushes, mean of each frame's inclusive time |
| `uy`/`sy` (index chunk) | React scheduler work (`performWorkUntilDeadline`), 6-9 ms of script inside a 140-190 ms task: the task is mostly render, not one function | long-task logs |
| `_` in game-reviewer near a placement (minified only, 2 of 10 sessions, 170-234 ms) | not attributed (did not occur in the unminified runs) | long-task logs |

Long tasks over 100 ms on current main: 10 in 10 sessions minified, 9 in 10 unminified (the earlier 17 in 10 was an older build; the code differs, so no improvement is claimed).

## Multiplayer, phone profile, 6 runs x host+guest (unminified; load average 18-22, indicative only)
- 5 stretches of about 96 ms: `useTileFlight.step -> liveTo -> rectOf -> getBoundingClientRect` (a forced layout inside the tile-flight animation frame; the layout is dirty from a React commit just before). Read from the profile; the cause (why the layout is dirty) is not verified.
- React render/commit stretches of 100-135 ms (`DominoTileComponent` about 35 ms in one).
- 62 stretches "led by the garbage collector" (about 142 ms) are not trusted: they coincide with machine load of 18-22.

## Headed vs headless, same minified build, n=10 each (measured, inconclusive)
Presentation delay p98 (ms), headless -> headed: placement 28 -> 104, tile-pick 30 -> 85, draw 38 -> 71. Headed is slower, not faster, so the headless presentation delay is not an under-estimate caused by missing rasterization. But the headed runs ran at load average 22 with a real window compositor and the Storage helper busy, so the size of the difference is not a property of the app. A clean comparison needs an idle machine.

## Not verified
- The real phone (all of this is desktop Chromium with CPU throttle).
- Multiplayer rates (contaminated by load); `useTileFlight` forced layout on a phone.
- Whether `ensureContext` in an idle callback ever lands on a tap on a real device: in these runs it fired with no interaction.

## What this suggests (not done; each needs its own measured PR)
1. Create the `AudioContext` earlier or lazily on first sound, or split it into smaller steps, so the 90-130 ms does not land mid-game.
2. Start Match: defer or cheapen `updateHandTileSize` (read layout once, in a layout effect, not a passive one) and `useMatchTurnStack` init.
3. `useTileFlight`: cache the target rect per flight instead of reading it every frame.
