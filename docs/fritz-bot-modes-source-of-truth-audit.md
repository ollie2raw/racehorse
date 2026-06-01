# Fritz / Bot Modes — Source-of-Truth Audit

**Audit date:** 2026-05-31  
**Scope:** All client-side Fritz/bot gameplay modes (Play vs Fritz, Daily Fritz, Ghost, Learn/Guided on bot shell), plus server endpoints and persistence they depend on.  
**Mode:** Read-only mapping — no fixes applied in this pass.

**Out of scope (mentioned only):** Multiplayer/tournament Fritz bots (`serverBot.ts`, `botSeating.ts`) — separate transport; No-Brainer Lab (practice drills, not Fritz match shell).

---

## Executive summary

Fritz/bot gameplay is **almost entirely client-local**: rules in `botEngine.ts`, AI in `botHeuristics.ts`, and one **~8k-line** `BotMatchScreen.tsx` shell shared across modes. **Daily Fritz** adds a server-backed **best-of-3 set loop** (fixed deals, next-hand API, skunk rules, leaderboard). **Play vs Fritz** is local-only except optional **verified ranked** match persistence via `/api/bot-matches/local/*`.

The architecture is powerful but **vibe-coded and fragile**: hand-end timing, prefetch/advance races, parent re-render timer churn, and mode flags inside a single component create the highest correctness risk. Performance pain is dominated by **`BotMatchScreen` re-renders**, **`chooseBotMove` CPU**, **triple board layout work**, and **Daily Fritz API prefetch waterfalls** — not network for casual PVF.

---

## 1. Main files involved

### Client — match shell & engine (shared)

| File | Owns |
|------|------|
| `client/src/bot/BotMatchScreen.tsx` (~7996 lines) | **God shell:** local bot loop, hand/game/set transitions, Fritz turn effect, draw animations, Daily Fritz embed, ghost, guided/authoring/learn overlays, ranked PVF hooks, board/hand HUD |
| `client/src/bot/botEngine.ts` (~1012 lines) | Local Racehorse bot rules: deal, play, draw, pass, scoring, hand/game end, fixed deals for DF/guided |
| `client/src/bot/botHeuristics.ts` (~1812 lines) | `chooseBotMove` — tiered MC/chain search AI (client Fritz) |
| `client/src/bot/handLifecycle.ts` | Phase helpers, `canApplyNextHand`, DF advance lock, next-hand cache resolver |
| `client/src/bot/fritzConfig.ts` | Fritz tier IDs, colors, difficulty mapping |
| `client/src/bot/benchmark.ts` | Headless bot-vs-bot sim (manual, not CI) |
| `client/src/components/handOver/HandOverModal.tsx` | Hand-end reveal modal (SP + MP variants) |
| `client/src/components/handOver/handOverCopy.ts` | Hand-over copy, tile reveals |
| `client/src/components/GameOverModal.tsx` | Match game-over (PVF standalone path) |
| `client/src/components/Board.tsx` (~1252 lines) | Board render, `computeLayout` (2–3× per update) |
| `client/src/match/board/MatchLiveLayout.tsx` | Live match layout wrapper |
| `client/src/bot/RacehorseMatchArena.tsx` | Alternate arena shell (legacy/partial) |
| `client/src/bot/PlayVsFritz.css` | Canonical PVF matte/neon styling |
| `client/src/bot/botMatch.css` | In-match bot styling |

### Client — Play vs Fritz setup

| File | Owns |
|------|------|
| `client/src/bot/PlayVsFritz.tsx` | Tier + deal-size picker; `onStart({ difficulty, dealSize })` |
| `client/src/screens/SinglePlayerHubScreen.tsx` | Hub card → `botSetup` |
| `client/src/App.tsx` | Routes: `botSetup` → `bot`, lazy loads, ghost/daily/learn branches |

### Client — Daily Fritz (lobby + set loop)

| File | Owns |
|------|------|
| `client/src/dailyFritz/DailyFritzScreen.tsx` (~1745 lines) | Hub/init, embeds `BotMatchScreen`, set overlays, `record`/`complete`, skunk UI, share/LB navigation |
| `client/src/dailyFritz/api.ts` | HTTP client for all `/api/daily-fritz/*` |
| `client/src/dailyFritz/skunk.ts` | Client skunk labels/badges (threshold 30) |
| `client/src/dailyFritz/setOverlayViewModel.ts` | Overlay VM kinds: `between`, `final`, `saving`, errors |
| `client/src/dailyFritz/buildFinalOverlayViewModel.ts` | Final overlay from server set result |
| `client/src/dailyFritz/DailyFritzFinalResultOverlay.tsx` | Final result UI fragment |
| `client/src/dailyFritz/DailyFritzArenaTrack.tsx` | Best-of-3 game tracker in match |
| `client/src/dailyFritz/DailyModeProgressDeck.tsx` | Progress deck UI |
| `client/src/dailyFritz/DailyFritzLeaderboard*.tsx` | Leaderboard page/route/table |
| `client/src/dailyFritz/shareCard.ts` | Share text from overlay VM |
| `client/src/dailyFritz/format.ts` | Date/ordinal/tier display |
| `client/src/dailyFritz/dailyFritz.css` | Hub styles |
| `client/src/dailyFritz/dailyFritzMatchBoard.css` | In-match DF accents |

### Client — Ghost (bot shell variant)

| File | Owns |
|------|------|
| `client/src/ghost/GhostSetupScreen.tsx` | Ghost opponent picker |
| `client/src/ghost/logic.ts` | Ghost move resolution inside `BotMatchScreen` |

### Client — Learn / guided (bot shell variants)

| File | Owns |
|------|------|
| `client/src/learn/guidedMatch/*` | Guided lesson replay, authoring, V2 event playback |
| `client/src/learning/*` | Coach panel hooks in bot match |

### Server — Daily Fritz & ranked PVF

| File | Owns |
|------|------|
| `server/src/dailyFritz.ts` | Run generation, hand deals, attempt types |
| `server/src/dailyFritzSkunk.ts` | Skunk rules, set assembly, rank tiers |
| `server/src/dailyFritzSkunk.test.ts` | Canonical skunk tests |
| `server/src/index.ts` | `/api/daily-fritz/*`, `/api/bot-matches/local/*`, run cache warmup |
| `server/src/bot/serverBot.ts` | **Server Fritz** for MP/tournament (not PVF/DF client) |
| `server/src/multiplayer/botSeating.ts` | Fritz bot seats in rooms |
| `server/src/ranking/glicko2.ts` + `fritzRating.test.ts` | Fritz tier Glicko |
| `server/src/social/activityWriter.ts` | Daily Fritz activity feed rows |
| `supabase/daily_fritz.sql` | DB schema |

### Docs & specs

| File | Owns |
|------|------|
| `docs/daily-fritz-skunk-source-of-truth.md` | Skunk product rules |
| `docs/daily-fritz-share.md` | Share card spec |
| `docs/daily-fritz-hand-accent-audit.md` | CSS hand accent (dead rule audit) |
| `docs/agent-skills/playvsfritz-ui-standard.md` | PVF UI standard |

### Tests

| File | Covers |
|------|--------|
| `server/src/dailyFritzSkunk.test.ts` | Skunk threshold, G1/G2 mechanical set end, G3 metadata, rank helpers |
| `client/src/bot/handLifecycle.behaviorTests.ts` | `canApplyNextHand`, advance lock, prefetch cache |
| `client/src/bot/botHeuristics.behaviorTests.ts` | Move heuristics (node script) |
| `server/src/ranking/fritzRating.test.ts` | Glicko vs Fritz Master |
| `server/src/social/activityWriter.test.ts` | DF activity feed |
| `server/src/multiplayer/botSeating.test.ts` | MP bot seating |
| `server/src/scheduledTournament/tournamentHumanBotFlow.test.ts` | Tournament + server bot |
| `server/src/game/__tests__/engine.test.ts` | Shared engine rules (also used by server MP) |

---

## 2. Shared Fritz/bot architecture

```
┌─────────────────────────────────────────────────────────────┐
│ App.tsx (appMode routing)                                    │
└────────────┬───────────────────────────────┬────────────────┘
             │                               │
    PlayVsFritz.tsx                  DailyFritzScreen.tsx
    GhostSetupScreen.tsx                      │
             │                               │
             └───────────┬───────────────────┘
                         ▼
              BotMatchScreen (mode prop)
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    botEngine.ts   botHeuristics.ts   Board.tsx
    (rules)        (chooseBotMove)    (layout/render)
         │               │
         └─────── applyPlayMove / drawUntil / passTurn
                         │
              HandOverModal + handLifecycle helpers
```

| Concern | Shared implementation |
|---------|----------------------|
| **Rules engine** | `botEngine.ts` — local only for PVF/DF/Ghost/Learn |
| **AI** | `botHeuristics.chooseBotMove` — client only for these modes |
| **State** | `BotMatchState` in React `useState` inside `BotMatchScreen` |
| **Board** | `Board.tsx` + `MatchLiveLayout` + open-ends geometry |
| **Move submission** | Synchronous `applyPlayMove` / draw chain / `passTurn` → `applyAndNotify` |
| **Scoring** | `botEngine` hand-end + race-to-60 game end |
| **Hand transitions** | `notifyBotActionResult` → `handReveal` → timers → `advanceHand` |
| **Game-over** | `gameOver` flag in state; modals/overlays per mode |
| **Modals** | `HandOverModal` (hand), `GameOverModal` or DF parent overlays (game/set) |
| **Fritz thinking** | 1500ms `setTimeout` before bot effect runs (`thinkDelayMs`) |
| **Draw animation** | `runDrawSequenceLocal`, `drawSequenceActive`, flying tiles |
| **Concurrency guard** | `beginLocalRun` / `isLocalRunCurrent` tokens on player/bot actions |

**Not shared with Daily Fritz:** server deal delivery (`first_hand`, `next-hand`), set recording, skunk assembly, leaderboard.

---

## 3. Mode-specific architecture

### Play vs Fritz (`mode='bot'`, no daily props)

| Aspect | Behavior |
|--------|----------|
| Setup | `PlayVsFritz.tsx` → tier + 7/14 deal |
| Deal | `createBotMatch` — random local shuffle |
| Next hand | `startNextBotHand` — local deal |
| Game over | `GameOverModal`; optional verified match via `/api/bot-matches/local/*` when logged in |
| Skunk | **None** |
| Persistence | Optional Supabase `bot_match_pending` + Glicko on resolve |
| Parent | `App.tsx` directly mounts `BotMatchScreen` |

### Daily Fritz (`mode='daily-fritz'`)

| Aspect | Behavior |
|--------|----------|
| Lobby | `DailyFritzScreen` — `getTodayDailyFritz` / `startDailyFritz`, init phases, session cache |
| Deal | Server `first_hand` → `createFixedBotMatch`; next hands via `/api/daily-fritz/next-hand` |
| Set | Best-of-3 games; parent `recordDailyFritzGame` + `completeDailyFritz` |
| Skunk | Server `dailyFritzSkunk.ts`; client labels in `skunk.ts` |
| Game over in match | `onDailyFritzGameComplete` callback → parent records game, shows between/final overlay |
| Resume | `sessionStorage` key `racehorse:daily-fritz:v2:{attemptId}:game:{n}` |
| Hand timing | 1400ms reveal delay + 5000ms auto-advance + `isDailyFritzAdvanceLocked` min gate |
| Prefetch | `nextDailyFritzHand` on hand-end before reveal closes |

### Ghost (`mode='ghost'`)

| Aspect | Behavior |
|--------|----------|
| AI | Ghost replay logic from `ghost/logic.ts` instead of or alongside `chooseBotMove` |
| Deal | Local random like PVF |
| Persistence | Ghost move log append |

### Learn / Guided / Authoring (`mode='bot'` + flags)

| Aspect | Behavior |
|--------|----------|
| Fritz turns | Often **scripted** from lesson events — live `chooseBotMove` disabled in many guided modes |
| Next hand | Restored from authored snapshots, not `startNextBotHand` |
| Hand reveal | Guided modes skip auto-advance timers |

### Server Fritz (multiplayer/tournament — not PVF/DF UI)

| Aspect | Behavior |
|--------|----------|
| AI | `server/src/bot/serverBot.ts` — separate implementation mirroring heuristics |
| Transport | Socket `game:action` in rooms with bot seats |

### No-Brainer Lab (related but separate)

| Aspect | Behavior |
|--------|----------|
| Screen | `NoBrainerLabScreen.tsx` — practice drills, not `BotMatchScreen` |
| Progress | `localStorage` solved count |

---

## 4. Current intended user loops

### Play vs Fritz

1. Single Player hub → **Play vs Fritz** setup (tier, deal size)
2. **Start** → `BotMatchScreen` with local deal
3. Play hands until **60 points** (race scoring)
4. Each hand end: **1400ms** → hand reveal modal → **5000ms** progress → auto **next local hand**
5. **Game over** → `GameOverModal` (rematch / exit / analyzer)
6. Optional: verified ranked match recorded if authenticated

### Daily Fritz

1. Home / nav → **Daily Fritz hub** (`getTodayDailyFritz`)
2. **Start today's set** → `startDailyFritz` → embed match with server `first_hand`
3. Play **game 1** (race to 60 within game) — multiple hands per game
4. Hand end: reveal → auto-advance → server **next-hand** (prefetched)
5. **Game 1 complete** → parent **record game** → between-game overlay (skunk copy if applicable)
6. **Game 2** (or set ends early on G1 skunk)
7. **Game 3** decider if 1–1 (G3 skunk = badge only)
8. Set complete → **final overlay** → share / leaderboard
9. Reload: session cache + server attempt status; stale guard clears mismatched client state

### Ghost

1. Ghost setup → pick ghost → `BotMatchScreen` ghost mode
2. Same hand loop as PVF with ghost move sourcing

---

## 5. Actual runtime state machines

### Hand lifecycle (`handLifecycle.ts` phases)

```
playing
  → resolving-hand        (handEnded detected in notifyBotActionResult)
  → showing-hand-result   (handReveal set after DAILY_FRITZ_REVEAL_DELAY_MS = 1400ms)
  → advancing-hand        (advanceHand called after auto-advance timer)
  → dealing-next-hand     (local startNextBotHand OR DF applyDailyFritzNextHandResponse)
  → playing
  → set-complete / match-complete / error
```

### Daily Fritz init (`DailyFritzScreen`)

```
preparing → (slow) still-preparing → ready
         ↘ failed → retrying → ready
```

Active match: `activeRun` set → embedded `BotMatchScreen` → overlays: `saving` | `between` | `final` | `finalizing` | errors

### Bot turn (`BotMatchScreen` effect ~4795)

```
 Guards: currentPlayer === 'bot' && !handOver && !gameOver && !drawSequenceActive
         && not guided/scripted modes
  → wait thinkDelayMs (1500)
  → beginLocalRun('bot-turn')
  → chooseBotMove OR ghost resolve OR draw/pass chain
  → applyAndNotify → notifyBotActionResult
```

### Player turn

Click/tap → `applyPlayMove` / draw chain / pass → `applyAndNotify`  
Auto draw/pass: player-side effect when no legal plays (similar guards + local run token)

---

## 6. API / server audit

### Daily Fritz (`/api/daily-fritz/*`)

| Endpoint | Purpose |
|----------|---------|
| `GET /today` | Run + attempt status for hub |
| `POST /start` | Start attempt, return `first_hand`, verified match id |
| `POST /next-hand` | Next hand in current game (idempotent replay/ignore) |
| `POST /record-game` | Append completed game to set |
| `POST /complete` | Finalize attempt + leaderboard row |
| `POST /abandon` | Abandon attempt |
| `GET /leaderboard/:date` | Leaderboard |
| `POST /generate`, `/invalidate`, `/reset-attempt` | Admin |

**Persistence:** Supabase `daily_fritz_*` tables; in-memory `dailyFritzRunCache` on server for run warmup.

**Related:** `GET /api/home/daily-summary` — week streak includes Fritz completion.

### Play vs Fritz ranked (optional)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/bot-matches/local/start` | Create pending ranked match |
| `POST /api/bot-matches/local/resolve` | Resolve on game over |
| `POST /api/bot-matches/local/abandon` | Abandon |
| `POST /bot-matches/cleanup-stale` | Cron stale pending cleanup |

### Local-only paths (no server during play)

- All move legality, scoring, hand/game resolution for PVF
- Fritz AI (`chooseBotMove`)
- Ghost replay moves
- Guided lesson state restoration

---

## 7. Hand-end and next-hand audit

### Where hand-end is detected

- `botEngine` sets `handOver` + `handEnded` payload on domino out or blocked hand
- `applyAndNotify` → `notifyBotActionResult` when `result.handEnded` present

### Hand reveal modal

| Step | Timing / code |
|------|----------------|
| Delay before modal | `DAILY_FRITZ_REVEAL_DELAY_MS` = **1400ms** (all bot modes) |
| Modal data | `setHandReveal({ winner, pointsAwarded, remaining tiles, ... })` |
| Progress bar | `handRevealProgress` 1 → 0 via rAF when modal shown |
| Auto-advance timer | `DAILY_FRITZ_AUTO_ADVANCE_MS` = **5000ms** (all non-guided modes) |
| Min-advance guard | `dailyFritzMinAdvanceAtRef` set at hand-complete to `now + 1400 + 5000`; `isDailyFritzAdvanceLocked` blocks early `advanceHand` |

### Daily Fritz prefetch

On hand-end (non-game-over): immediately calls `nextDailyFritzHand` into `dailyFritzNextHandRef` cache while reveal runs.

### Next hand application

| Mode | Path |
|------|------|
| PVF / casual bot | `startNextBotHand` local |
| Daily Fritz | `applyDailyFritzNextHandResponse` from prefetch or fetch; requires `canApplyNextHand` |
| Guided | Authored snapshot restore |

### Final hand / game-over interaction

- If `gameOver` on hand-end: reveal may still show; auto-advance effect bails when `match.gameOver`
- Daily Fritz: `onDailyFritzGameComplete` fires from effect when `match.gameOver`; parent owns set progression
- `HandOverModal` deferred when parent handles game complete (`onDailyFritzGameComplete` set)

### Recent min-advance guard (correctness)

- **Isolated to Daily Fritz path** inside `advanceHand` via `isDailyFritzAdvanceLocked(minAdvanceAt, nowMs)`
- Shared helper tested in `handLifecycle.behaviorTests.ts`
- PVF uses same timers but DF-specific gate only runs when `isDailyFritzMode && dailyFritzPackage`

### Bypass / skip risks

| Risk | Mechanism |
|------|-----------|
| Skip reveal | `advanceHand` before min gate → retried via `scheduleHandAdvanceRetry` |
| Stuck on prefetch failure | Manual continue UI (`showManualHandAdvance`) after retries |
| `setMatch` noop | If state not `handOver` when applying next hand → error + manual continue |
| Effect cleanup clears timer | Hand reveal effect cleanup can cancel auto-advance mid-flight |
| Parent 1Hz re-render | **Mitigated:** DF lobby countdown paused when `activeRun` set (comment ~693–700) |

---

## 8. Skunk audit

**Source of truth:** `docs/daily-fritz-skunk-source-of-truth.md`

| Rule | Implementation |
|------|----------------|
| Skunk = win while opponent **&lt; 30** | `isDailyFritzSkunk(losingScore)` server + client |
| G1/G2 skunk → **2 game wins**, can end set early | `appendDailyFritzGameToSet` in `dailyFritzSkunk.ts` |
| G3 skunk → **metadata only** (badge, rank tier) | Same file; no `instantSkunk` |
| Client display | `skunk.ts`, overlay copy in `DailyFritzScreen` |

**Tests:** `server/src/dailyFritzSkunk.test.ts` — scenario matrix for G1 instant, G2 split skunk, G3 decider, non-skunk at 30+.

**Play vs Fritz:** No skunk logic.

---

## 9. Bot action / AI audit

### How Fritz chooses moves

1. `getLegalMoves(state, 'bot')` from `botEngine`
2. `chooseBotMove(state, difficulty)` in `botHeuristics.ts`:
   - Tier configs: pool size, MC samples, chain depth/width
   - Endgame deeper search when few tiles remain
   - Greedy fallback with stable tie-break (`compareMoveStable`)
3. Ghost mode may use `ghost/logic.ts` instead

### Determinism

- **Mostly deterministic** given same board/hand state and tier
- Tie-break uses stable ordering; `hashStringToUint32` used in search sampling — same state → same move unless MC sampling introduces variance at lower tiers
- **Not seeded per match** for casual PVF random deals

### Draw / pass

- Bot effect: if no playable moves → `runDrawSequenceLocal` (animated draw chain) then pass if still blocked
- Player: similar draw chain with `beginLocalRun('player-draw')`
- Engine: `drawUntilPlayableOrEmpty`, `passTurn`

### Fritz thinking delay

- Fixed **1500ms** `thinkDelayMs` before bot action executes
- UI shows "Fritz thinking" via `botTurn` derived state

### Race / duplicate action risks

| Guard | Purpose |
|-------|---------|
| `beginLocalRun` / `isLocalRunCurrent` | Cancel stale bot/player async chains |
| `handOver` / `gameOver` checks in bot effect | Skip turn when hand ended |
| `drawSequenceActiveRef` | Block bot effect during draw animation |
| Guided mode flags | Prevent live AI + scripted Fritz double mutation |
| `handTransitionInFlightRef` | Block duplicate `advanceHand` |
| `botChainPauseRef` | Pause chain during certain UI states |

**Remaining risk:** Large `BotMatchScreen` with many effects — edge cases where `match` closure in bot timer is stale vs `matchRef` (mitigated partially via `matchRef.current` in timer callback).

---

## 10. Performance / lag audit

| Rank | Cause | Impact | Where |
|------|-------|--------|-------|
| P1 | **`BotMatchScreen` size** (~8k lines, 65+ `useEffect`s) | High re-render cost | Any state change |
| P1 | **`chooseBotMove` CPU** | 50–500ms+ on Master/endgame | Bot turn effect after 1.5s delay |
| P1 | **Board `computeLayout` 2–3×** | Per board update | `Board.tsx` layout + zones + glow |
| P2 | **Fritz 1500ms think delay** | Perceived lag (intentional) | Bot effect |
| P2 | **Hand reveal 1400 + 5000ms** | Perceived pause between hands | All bot modes |
| P2 | **DF next-hand prefetch** | Network on every hand; hides latency if warm | `notifyBotActionResult` |
| P2 | **DF parent re-renders** | Was resetting timers; mitigated for countdown | `DailyFritzScreen` |
| P2 | **sessionStorage debounce** | DF match persistence writes | `dailyFritzStorageKey` |
| P3 | **Guided board deserialize** | Extra hydration on guided paths | `parseGuidedBoardState` |
| P3 | **Move log / analyzer append** | Growing arrays on long matches | `appendMove` |

**Not a factor for PVF:** socket RTT (local engine).

---

## 11. Fragility / race-condition audit

| Scenario | Risk level | Notes |
|----------|------------|-------|
| Fritz acts after hand/game over | Medium | Guards exist; closure staleness possible |
| Hand-end modal skipped | Low–Med | Min-advance gate + effect cleanup races |
| Next hand too early | Med | `isDailyFritzAdvanceLocked`, prefetch not ready → retry |
| Game-over races hand-over | Med | DF parent callback vs reveal timer ordering |
| DF set state desync | Med | `current_game_number` stale after partial merge; `resolveDailyFritzCurrentGameNumber` helper |
| Skunk ends wrong game/set | Low | Server authoritative; tested |
| Duplicate record/complete | Med | `dailyFritzCompleteKeyRef`, submit guards in parent |
| Reload stale state | Med | `shouldClearStaleClientState`, session key per game |
| Leaderboard/share stale | Low–Med | Uses overlay VM built from latest `complete` response |
| PVF vs DF behavior drift | Med | Shared timers/constants named `DAILY_FRITZ_*` but applied to PVF too |
| Double Fritz in guided | Low | Mode flags disable live bot |
| 409 end-of-run | Med | Must → `match-complete`, not generic error |
| Server cold start | Med | 10s API timeouts; user-facing slow init |

---

## 12. Testing audit

### Existing

| Area | Coverage |
|------|----------|
| Skunk rules | Strong — `dailyFritzSkunk.test.ts` |
| Hand lifecycle helpers | Good — `handLifecycle.behaviorTests.ts` |
| Bot heuristics | Partial — behavior script, not vitest CI |
| Fritz Glicko | `fritzRating.test.ts` |
| DF activity feed | `activityWriter.test.ts` |
| MP bot seating | `botSeating.test.ts` |

### Missing (high value)

| Area | Gap |
|------|-----|
| Play vs Fritz E2E | No automated happy path |
| Daily Fritz set progression | No integration test (API + client) |
| Hand-end reveal timing | No timer regression test |
| Next-hand prefetch + advance | No test for cache hit/miss/409 |
| Game-over → record → complete | No full set flow test |
| Bot turn cancellation | No test for `localRun` token |
| Reload/resume sessionStorage | No test |
| Leaderboard/share VM | No snapshot test |
| `BotMatchScreen` | Too large for unit tests; no harness |
| Performance smoke | None for Fritz modes |

**Smoke:** `client/scripts/socketSmoke.mjs` is **multiplayer only**. No Fritz smoke in CI.

---

## 13. Prioritized stabilization plan

### P0 — Correctness (fix before feature work)

1. **Hand transition invariants** — Assert single `advanceHand` in flight; log/stuck detection in DEV; manual continue only as last resort
2. **Daily Fritz set desync** — Audit `current_game_number` vs `set_result` merge paths; single source for active game index
3. **409 / end-of-run** — Verify all prefetch/advance error paths reach `match-complete` without corrupting hand state
4. **Duplicate submit guards** — Audit `recordDailyFritzGame` / `completeDailyFritz` ref keys under fast game-over
5. **Bot effect stale closure** — Prefer `matchRef` consistently in async bot timer; cancel on phase change

### P1 — Performance / perceived lag

1. **Instrument `chooseBotMove` ms** — DEV flag; cap Master search on low-end devices
2. **Reduce Board layout passes** — Single `computeLayout` return layout+zones (mirror P1a multiplayer)
3. **Split DF timers from PVF** — Named constants per mode; optional shorter PVF reveal
4. **Stabilize callbacks passed to embedded match** — Memoize `DailyFritzScreen` → `BotMatchScreen` props (partially done for countdown)
5. **Prefetch failure UX** — Don't block reveal on network; show continue when cache empty

### P2 — UX polish

1. Hand reveal duration tuning per mode
2. Fritz thinking indicator vs actual compute time
3. Server waking copy / init timeout handling

### P3 — Architecture / future

1. Extract hand lifecycle from `BotMatchScreen` into hook/module
2. Extract Daily Fritz orchestration from parent + child
3. Shared test harness for bot engine + DF API
4. Consider unified engine with server MP (long-term)

---

## 14. Recommended next prompt

Use this for the **smallest focused stabilization pass** after reading this audit:

---

**Prompt: Fritz P0 hand-transition stabilization (Daily Fritz + PVF, no UI redesign)**

Goal: Fix hand-end → next-hand correctness races without refactoring `BotMatchScreen` broadly.

1. Add DEV-only `[handLifecycle]` structured logs (or extend existing) at: hand-end detect, reveal show, auto-advance fire, `advanceHand` entry/exit, prefetch hit/miss, `applyDailyFritzNextHandResponse` noop.
2. Audit and fix **one** class of stuck states: either (A) `advanceHand` called while `isDailyFritzAdvanceLocked` loops forever, or (B) `canApplyNextHand` false when applying prefetched hand — with minimal guard/fix proven by logs.
3. Ensure `matchRef` is used in bot turn async path where closure staleness could duplicate Fritz actions after hand-over.
4. Add one integration-style test: `handLifecycle.behaviorTests.ts` or server test for next-hand idempotency + skunk G2 split (if not already covered).
5. Run `server/src/dailyFritzSkunk.test.ts`, `handLifecycle.behaviorTests.ts`, client build.

Out of scope: App.tsx split, Board layout refactor, skunk rule changes, timer duration tuning.

---

## Definition of done (this audit)

You can read this document and understand:

- **How** PVF, Daily Fritz, Ghost, and Guided modes share `BotMatchScreen` + local engine
- **What** is server-backed (DF only) vs local
- **Where** hand-end, skunk, set complete, and Fritz AI live in code
- **Why** modes feel laggy (big component, AI CPU, board layout, intentional timers)
- **Which** races are most likely before patching
- **What** the next smallest stabilization pass should target

---

## Files changed

- `docs/fritz-bot-modes-source-of-truth-audit.md` (new)

## Build/test result

Not run (read-only audit).

## Remaining risks / gaps

- No runtime timing capture in this pass (recommend DEV instrumentation before P1 perf)
- `BotMatchScreen` line-level map intentionally summarized — full effect dependency graph would be a follow-on doc
- Tournament/server bot parity with client heuristics assumed from comments, not diffed line-by-line
