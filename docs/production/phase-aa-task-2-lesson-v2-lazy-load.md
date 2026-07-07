# Phase AA — Task 2: Lazy-Load `lessonV2` for Standard Bot Matches

**Date:** 2026-07-06  
**Scope:** Remove unnecessary eager loading of `lessonV2` (~1.3 MB) from normal Fritz/bot play  
**Architecture:** Frozen — no gameplay, API, visual, or multiplayer behavior changes

---

## 1. Problem (post Task 1)

Task 1 split `BotMatchScreen` from 284 kB → 176 kB via `manualChunks`, but the **`lesson-v2` chunk (~1.3 MB raw)** was still fetched on standard bot entry because the bot-match import graph **statically depended** on `learn/lessonV2.ts` (canonical JSON + V2 runtime).

| Symptom | Evidence |
|--------|----------|
| `lesson-v2-*.js` ~1.3 MB | Always in BotMatch dependency graph pre-fix |
| Standard Fritz play | Parsed/fetched guided lesson infrastructure unnecessarily |
| Phase Z finding | `lessonV2` statically imported across guided/bot modules |

---

## 2. Solution (smallest safe change)

Separate **standard bot path** from **guided/authoring V2 path** using:

1. **`lessonV2LazyRegistry`** — runtime registry populated only by `preloadLessonV2ForBotMatch()` (dynamic `import()`).
2. **V2 bootstrap split** — `resolveLessonV2InitialState.ts` + `guidedV2HandCoordinator.ts` moved out of the always-loaded hand-lifecycle chunk; loaded only via registry preload.
3. **`BotMatchScreen` gate** — when `isGuidedV2Mode || isAuthoringV2Mode`, show `ScreenLoader` until `lessonV2` preload completes; then mount inner controller.
4. **Guided module lazy boundaries** — replace static `lessonV2` imports in guided runtime with registry lookups or dynamic `import()`.
5. **`useAuthoringCapture` moved to `modules/guided/`** — V2 authoring API loads via dynamic `import()` inside `useEffect`; keeps `lesson-v2` out of the `BotMatchScreen` entry chunk (critical fix).

Gameplay logic, scoring, bot engine, and guided lesson playback semantics are unchanged.

---

## 3. Files changed

| File | Change |
|------|--------|
| `client/src/modules/match/bootstrap/lessonV2LazyRegistry.ts` | **New** — preload registry + lazy V2 bootstrap/hand-advance delegates |
| `client/src/modules/match/bootstrap/resolveLessonV2InitialState.ts` | **New** — V2-only initial match state (authoring V2 + guided V2) |
| `client/src/modules/match/bootstrap/guidedV2HandCoordinator.ts` | **New** — `planGuidedV2HandAdvance` (moved out of hand-lifecycle chunk) |
| `client/src/bot/BotMatchScreen.tsx` | V2 gate + inner/outer split |
| `client/src/modules/match/bootstrap/resolveInitialBotMatchState.ts` | V2 branches delegate to lazy registry |
| `client/src/modules/match/hand-lifecycle/guidedHandCoordinator.ts` | Removed V2 hand advance (local hands only) |
| `client/src/modules/match/hooks/useHandLifecycle.ts` | V2 hand advance via registry |
| `client/src/modules/guided/useGuidedLessonBoot.ts` | V2 lesson via registry (post-preload) |
| `client/src/modules/guided/useGuidedV2CoordinationState.ts` | V2 init via registry |
| `client/src/modules/guided/useGuidedV2PlaybackEffects.ts` | V2 playback via registry |
| `client/src/modules/guided/guidedV2State.ts` | `parseLessonV2BoardState` via registry |
| `client/src/modules/guided/useGuidedMatchRuntime.ts` | Final debrief via dynamic `guidedMatchLessonLoader` import |
| `client/src/modules/guided/useGuidedMatchRuntimeTypes.ts` | Type-only debrief import (no loader runtime) |
| `client/src/modules/guided/useAuthoringCapture.ts` | **Moved** from `match/hooks/`; V2 via dynamic `import()` |
| `client/src/modules/guided/index.ts` | Export `useAuthoringCapture` |
| `client/src/modules/match/match-turn-stack/buildPlayerTurnArgs.ts` | `createV2Event` from authoring hook |
| `client/src/bot/useBotMatchScreenController.ts` | Import authoring from guided barrel |
| `client/src/modules/match/index.ts` | Re-export authoring from guided |
| `client/src/bot/useAuthoringCapture.behaviorTests.ts` | Updated hook path |

---

## 4. Bundle report

Production build: `npm run build --prefix client` (2026-07-06)

### Size-check

```
✓ AppRoutes: 72kB (limit 195kB)
✓ BotMatchScreen: 167kB (limit 244kB)
✓ index: 415kB (limit 684kB)
All bundle size checks passed.
```

### Before vs after (Task 1 → Task 2)

| Chunk | Task 1 (after) | Task 2 (after) | Delta |
|-------|---------------:|---------------:|------:|
| `BotMatchScreen-*.js` | 176 kB | **167 kB** | −9 kB |
| `bot-guided-*.js` | 95 kB | **112 kB** | +17 kB (authoring hook + dynamic V2 deps) |
| `bot-hand-lifecycle-*.js` | 37 kB | **30 kB** | −7 kB (V2 coordinator removed) |
| `lesson-v2-*.js` | 1,319 kB | **1,319 kB** | unchanged (still isolated chunk) |
| `resolveLessonV2InitialState-*.js` | — | **0.8 kB** | new async satellite |
| `guidedV2HandCoordinator-*.js` | — | **0.4 kB** | new async satellite |

### Static `lesson-v2` dependency (critical verification)

| Chunk | Static `import from './lesson-v2-*'` |
|-------|--------------------------------------|
| `BotMatchScreen-*.js` | **None** (was present pre-fix) |
| `bot-hand-lifecycle-*.js` | **None** (was present pre-fix) |
| `bot-guided-*.js` | **None** — uses `__vite__mapDeps` only |
| `guidedV2HandCoordinator-*.js` | Yes — only loaded after V2 preload |
| `lesson-v2-*.js` | N/A (chunk itself) |

---

## 5. BotMatch initial network requests (standard bot)

### Before Task 2 (normal Fritz / daily-fritz / ghost)

Typical lazy route load chain included:

- `BotMatchScreen-*.js`
- `bot-guided-*.js`
- `bot-hand-lifecycle-*.js` → **statically pulled `lesson-v2-*.js`**
- `BotMatchScreen-*.js` → **also statically pulled `lesson-v2-*.js`**
- `analyzer-*.js`, `pivotal-review-*.js`, vendors, CSS

**~1.3 MB `lesson-v2` was fetched/parsed even when guided V2 was off.**

### After Task 2 (normal Fritz / daily-fritz / ghost)

Typical chain:

- `BotMatchScreen-*.js`
- `bot-guided-*.js` (guided runtime shell — **no `lesson-v2`**)
- `bot-hand-lifecycle-*.js` (**no `lesson-v2`**)
- `analyzer-*.js`, `pivotal-review-*.js`, vendors, CSS

**`lesson-v2-*.js` is not requested** until a V2 mode actually needs it.

### When guided V2 / authoring V2 opens

1. `BotMatchScreen` renders `ScreenLoader` (“Loading lesson…”).
2. `preloadLessonV2ForBotMatch()` dynamically loads:
   - `lesson-v2-*.js`
   - `resolveLessonV2InitialState-*.js`
   - `guidedV2HandCoordinator-*.js`
3. Inner match controller mounts; guided V2 playback/authoring uses registry + `bot-guided` dynamic deps.

---

## 6. `lessonV2` availability when guided mode opens

| Mode | Availability |
|------|----------------|
| Standard bot / Fritz / Daily Fritz / Ghost | `lessonV2` **not loaded** |
| Guided V2 (`isGuidedV2Mode`) | Preloaded by gate **before** match UI; playback via `useGuidedV2PlaybackEffects` + registry |
| Authoring V2 (`isAuthoringV2Mode`) | Preloaded by gate; capture via `useAuthoringCapture` dynamic API |
| Guided V1 / authoring V1 | Unchanged (`guidedAuthoring.ts` only — no canonical JSON) |
| Learn home / AppRoutes guided start | Existing dynamic `import('./learn/lessonV2')` unchanged |

---

## 7. Verification commands

| Command | Result |
|---------|--------|
| `npm run build --prefix client` | **Pass** |
| `npm run size-check --prefix client` | **Pass** |
| `npm run typecheck --prefix client` | **Pass** |
| `npx tsx src/bot/useAuthoringCapture.behaviorTests.ts` | **Pass** |

---

## 8. Behavioral risk assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Brief loader on guided/authoring V2 entry | Low | Expected; gate prevents half-hydrated V2 state |
| V2 authoring session restore one tick later | Low | `useEffect` hydration after dynamic import; gate ensures preload before interaction |
| V2 hand advance before preload | None | Gate blocks render until registry populated |
| Standard bot regression | Low | V2 code paths gated; V1 guided/authoring unchanged |
| Guided V2 playback correctness | Low | Same `lessonV2` functions, deferred load only |
| Circular chunk warning (`lesson-v2 ↔ bot-guided ↔ hand-lifecycle`) | Info | Pre-existing `manualChunks` interaction; no functional regression observed |

**Overall:** Low risk. Largest user-visible change is a short loading state when entering guided/authoring V2 — acceptable trade for ~1.3 MB savings on the default bot path.

---

## 9. Remaining follow-ups (out of scope)

- `bot-guided` (~112 kB) still loads on every bot match (guided runtime shell). Further slimming would need a deeper guided/bot controller split.
- `index.html` modulepreload list may still reference chunks from other routes; not BotMatch-specific.
- Optional: add Playwright network assertion that standard Fritz route does not request `lesson-v2-*.js`.