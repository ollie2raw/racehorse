# Learn / Guided Hotfix Report

Date: 2026-07-09

## Root Cause

The browser crash had one direct cause and one supporting fragility:

1. In [client/src/bot/BotMatchScreen.tsx](/Users/olivermorid/racehorse-dominoes/client/src/bot/BotMatchScreen.tsx), the lesson-V2 preload gate checked `props.mode === 'bot'`.
2. The main guided route in [client/src/AppRoutes.tsx](/Users/olivermorid/racehorse-dominoes/client/src/AppRoutes.tsx) does not pass a `mode` prop at all; it relies on downstream code defaulting `mode` to `'bot'`.

That meant the preload gate was silently disabled on the real guided-game route, so `BotMatchScreenInner` rendered immediately and `resolveInitialBotMatchState()` called `resolveLessonV2InitialState()` before the bootstrap registry was loaded.

There was also a second brittleness issue:

- Learn routes were lazy-importing through the broad `./learn` barrel instead of leaf files, which widened the Learn chunk graph unnecessarily.
- Guided V2 boot code still had synchronous registry reads, so any missed preload would fail hard.

This was easier to surface in production/deployed mode because `lessonV2` is split into its own chunk while guided runtime lives in a separate `bot-guided` chunk.

## Files Changed

- [client/src/AppRoutes.tsx](/Users/olivermorid/racehorse-dominoes/client/src/AppRoutes.tsx)
- [client/src/bot/BotMatchScreen.tsx](/Users/olivermorid/racehorse-dominoes/client/src/bot/BotMatchScreen.tsx)
- [client/src/modules/guided/useGuidedLessonBoot.ts](/Users/olivermorid/racehorse-dominoes/client/src/modules/guided/useGuidedLessonBoot.ts)
- [client/src/modules/guided/useGuidedV2CoordinationState.ts](/Users/olivermorid/racehorse-dominoes/client/src/modules/guided/useGuidedV2CoordinationState.ts)
- [client/src/bot/BotMatchScreen.hotfix.test.tsx](/Users/olivermorid/racehorse-dominoes/client/src/bot/BotMatchScreen.hotfix.test.tsx)
- [client/src/modules/guided/useGuidedLessonBoot.test.tsx](/Users/olivermorid/racehorse-dominoes/client/src/modules/guided/useGuidedLessonBoot.test.tsx)
- [client/src/learn/LearnHowToPlayRacehorse.test.tsx](/Users/olivermorid/racehorse-dominoes/client/src/learn/LearnHowToPlayRacehorse.test.tsx)

## What Changed

- `BotMatchScreen` now treats an omitted `mode` prop as `'bot'` for lesson-V2 preload gating, which matches the real route contract.
- `BotMatchScreen` also has a stricter lesson-V2 gate:
  - blocks synchronously on entry into guided/authoring V2 mode
  - waits for `preloadLessonV2ForBotMatch()` before rendering guided internals
  - shows a recoverable guided boot error view if preload fails instead of crashing into the ErrorBoundary
- `useGuidedLessonBoot` now refuses to synchronously touch the lesson-V2 registry until preload has completed.
- `useGuidedV2CoordinationState` now has the same defensive guard for its initial playback cursor setup.
- `AppRoutes` now lazy-loads Learn leaf components directly instead of importing them through the `./learn` barrel.

## Tests Added

- `BotMatchScreen.hotfix.test.tsx`
  - guided V2 waits for preload before rendering
  - guided V2 with no explicit `mode` prop still triggers the preload gate
  - transitioning from normal bot mode into guided V2 re-enters the loading gate
  - preload failure shows recoverable UI instead of crashing
- `useGuidedLessonBoot.test.tsx`
  - no synchronous `getLessonV2Module()` access before preload
- `LearnHowToPlayRacehorse.test.tsx`
  - How to Play content renders nonblank

## Commands Run

- `npm test -- src/bot/BotMatchScreen.hotfix.test.tsx src/modules/guided/useGuidedLessonBoot.test.tsx src/learn/LearnHowToPlayRacehorse.test.tsx`
- `npm test --prefix client`
- `npm run build --prefix client`
- `npm run preview --prefix client -- --host 127.0.0.1 --port 4175`

Preview note:

- The preview server started successfully on `127.0.0.1:4175`.
- Follow-up `curl` checks from the sandbox could not connect back to that local preview port, so route verification beyond build/test stayed limited by the execution environment.

## Remaining Risks

- This hotfix closes the synchronous registry/preload race and isolates Learn route lazy imports, but it does not redesign the broader `lessonV2` chunking strategy.
- The Vite circular-chunk warning for `bot-guided -> bot-hand-lifecycle -> bot-guided` still exists. It was not changed here because this was a targeted production hotfix, not a chunking refactor.
