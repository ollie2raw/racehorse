# Bot Match Bundle Chunk Ownership

**Status:** Intentional architecture (Phase AA Tasks 1–3)  
**Enforced by:** `npm run check:bot-match-lazy`, `npm run size-check`, Playwright `e2e/bot-match-lazy-chunks.spec.ts`

This document defines **why each major Vite manual chunk exists** and which user flows may load it.

---

## Design principle

Standard **Play vs Fritz / Daily Fritz / Ghost** bot matches must load only the **gameplay shell** at entry. Heavy optional systems defer until explicitly needed:

| Deferred system | Trigger |
|-----------------|---------|
| `lesson-v2` | Guided V2 or Authoring V2 preload |
| `analyzer` | Post-game analysis or Game Reviewer open |

---

## Chunk reference

### `BotMatchScreen-*.js` (~171 kB budget: 244 kB)

**Owner:** Core bot match shell.

**Contains:** `BotMatchScreen`, view model assembly, modals, HUD wiring, lazy import boundaries.

**Must NOT contain (static):** `lesson-v2`, `analyzer` runtime.

**Loaded by:** Any bot-mode route (Fritz, Daily Fritz, Ghost, Guided when entered).

---

### `lesson-v2-*.js` (~1.3 MB)

**Owner:** Guided / authoring V2 lesson runtime.

**Contains:** `learn/lessonV2.ts`, canonical JSON lesson data, V2 playback helpers.

**Loaded by:**

- `preloadLessonV2ForBotMatch()` when `isGuidedV2Mode || isAuthoringV2Mode`
- Learn hub guided V2 start (after preload gate)

**Must NOT load on:** Standard Fritz without guided/authoring V2 flags.

---

### `analyzer-*.js` (~14 kB engine + analysis helpers)

**Owner:** Post-game move analysis engine.

**Contains:** `moveAnalyzer`, `handSegmentation`, `consequenceChain`, `analysisTypes`.

**Loaded by:**

- Dynamic `import('analyzer/moveAnalyzer')` after `gameOver` (pivotal review)
- Lazy `GameReviewer` open (via mapDeps chain)

**Must NOT load on:** Standard in-match Fritz play.

---

### `game-reviewer-*.js` (~64 kB)

**Owner:** In-match / post-game review **UI** (`GameReviewer`, sidebar copy).

**Contains:** Board/DominoTile presentation for move-by-move review.

**Note:** Shares Board components with match shell; may load eagerly via chunk hoisting. This is **review UI shell**, not the analysis engine (`analyzer` chunk).

---

### `bot-engine-*.js` (~170 kB)

**Owner:** Gameplay engine.

**Contains:** `modules/match/runtime/botEngine` — legal moves, apply play, match state.

**Loaded by:** All bot matches (required for play).

---

### `bot-heuristics-*.js` (~24 kB)

**Owner:** Fritz AI decisioning.

**Contains:** `modules/fritz/botHeuristics`.

**Loaded by:** All Fritz/bot matches during play. Also used by analyzer oracle on demand.

---

### `bot-guided-*.js` (~115 kB)

**Owner:** Guided mode runtime shell (V1 + V2 coordination hooks).

**Contains:** Guided placement, coach presentation, authoring capture hooks.

**Must NOT statically import:** `lesson-v2`, `analyzer` (uses lazy registry + dynamic imports).

---

### `bot-hand-lifecycle-*.js` (~30 kB)

**Owner:** Hand advance, reveal scheduling, daily Fritz hand transitions.

**Loaded by:** Bot match controller (eager with guided shell).

---

### `move-logger-*.js` (~3.5 kB)

**Owner:** In-play move log recording (`game/moveLogger.ts`).

**Contains:** `MoveEntry` types, tile tuples, board snapshots for logging.

**Loaded by:** All bot matches during play. **Not** part of analyzer.

---

### `pivotal-review-*.js` (~20 kB)

**Owner:** Post-game pivotal review UI (wizard cards, prompts).

**Loaded by:** Post-game overlays when review eligible. Uses analysis **results** passed in — does not statically import analyzer engine.

---

## Regression guards

| Guard | What it checks |
|-------|----------------|
| `check:bot-match-lazy` | Source graph from `BotMatchScreen.tsx` + dist chunks `BotMatchScreen`, `bot-guided`, `bot-hand-lifecycle` have no static `lesson-v2` / `analyzer` imports |
| `check:size-check` | `BotMatchScreen` chunk byte budget |
| `e2e/bot-match-lazy-chunks.spec.ts` | Network: standard Fritz skips optional chunks; guided V2 loads `lessonV2` |

---

## Related docs

- [phase-aa-task-1-botmatch-bundle.md](./phase-aa-task-1-botmatch-bundle.md)
- [phase-aa-task-2-lesson-v2-lazy-load.md](./phase-aa-task-2-lesson-v2-lazy-load.md)
- [phase-aa-task-3-analyzer-lazy-load.md](./phase-aa-task-3-analyzer-lazy-load.md)