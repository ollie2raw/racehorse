# Perceived lag, Phase 1: measurements (no app changes)

Written 2026-11-13. Scope: Daily Fritz, Play vs Fritz, multiplayer, on phone and laptop. The post-game review is parked; it appears here only
to say whether it causes lag (it does not). Nothing in `client/src` or `server/src` was changed. Tools and raw summaries are in
`client/scripts/perf/` and `docs/perceived-lag-phase1-data/`.

Tags: **[M]** measured here · **[C]** read from code · **[G]** guess / extrapolation. Each ranked cause ends with what would prove it wrong.

## Verdict

The tap-to-tile path is already fast: own-tile tap to board paint is **p50 9 ms** [M] (the earlier `draw-and-play-diagnosis.md` got 12 ms).
Bot search, the review snapshot recorder, post-game review, heap growth and CSS animations are **not** causes (section 3).
What a player feels comes from five things, ranked by measured impact:

| # | Cause | Where felt | Headline number |
|---|---|---|---|
| 1 | Supabase writes sit on the critical path at every hand boundary | MP, pause between hands | `hand:ready` ack **883 ms p50** at 290 ms DB latency (25 ms at 0) [M] |
| 2 | Server main thread stalls during MP matches (full-room persistence each move) on a 0.15-CPU instance | MP, every move | event-loop window max **median 112–144 ms**, worst 484 ms (3–5 ms in solo modes) [M, local] |
| 3 | Client main thread: forced layout and whole-screen re-renders on every placement | all modes, worst on phone | **79** `getBoundingClientRect` per placement; INP p98 **96–168 ms**, up to 69 interactions >100 ms per game at 4x [M] |
| 4 | Daily Fritz checkpoint uploads the whole move log every ~2 s | Daily Fritz on mobile data | p50 **118 KB**, max 261 KB, **74 posts / 8.8 MB per game** [M] |
| 5 | Fritz reply pacing (deliberate) plus a 115–200 ms stall on the first tap of a session | solo modes | reply p50 1.6 s (earlier doc) [M]; first-tap long task 114–200 ms in every game run [M] |

## 1. How it was measured

* **Client**: production Chromium (Playwright), full games played by a driver, CDP CPU throttle 4x with an iPhone 14 landscape profile ("phone",
  the match screen is landscape-only) vs 1440x900 at 1x ("desktop"). In-page: Long Tasks, Long Animation Frames (script attribution), Event Timing
  (INP), per-frame deltas, board-tile and hand-count changes, a React DevTools hook stub counting commits, CDP `Performance.getMetrics`, heap after forced
  GC every 12 steps, every request and websocket frame. CPU profiles (250 µs) on an unminified build for attribution.
* **Builds**: true production build for PvF and MP. Daily Fritz sign-in is dev-only (`e2eDevAuth`), so Daily runs use a build with `import.meta.env.DEV`
  forced on. PvF on both builds: desktop identical (INP p75 48 ms, 1 long task); phone DEV is about 25 % heavier (18.3 % vs 14.5 % busy). Daily numbers are therefore slightly pessimistic.
* **Server**: the real server (`npm run dev`, e2e env) with `EVENT_LOOP_LAG_WARN_MS=1` so the existing monitor logs every 10 s window, a 250 ms `/ping` probe,
  and an inspector CPU profile. Multiplayer needs Supabase, which this checkout has no credentials for, so `scripts/perf/supabaseStub.mjs` answers PostgREST with a chosen latency and counts bytes.
* **Production**: only public read-only endpoints (`/ping`, `/health`, `/healthz`), about 30 requests in total.

Not measured: a real iPhone through Capacitor (no device in this session); real GPU compositing (headless Chromium rasterizes in software, so
the 5 % slow frames at desktop size say nothing about GPUs); Supabase round trip from inside a match (estimated, below); review sweep on/off with a job running (needs the job queue, see 2); cold start after idle sleep (the production instance did not restart across a roughly 45-minute gap between two `/health` reads, so it looks always-on).

## 2. Ranked causes

### 1. Hand-boundary Supabase waits (MP) [M + C]

* [C] `registerGameplayActionHandlers.ts:200-215`: a mid-hand move broadcasts first and persists off the critical path; a move that ends a hand or game `await`s `flushScheduledLiveRoomPersistence` **before** broadcasting. `hand:ready` also persists before it acks.
* [M] Mid-hand ack p50 22–49 ms with or without 290 ms of DB latency, so ordinary moves are unaffected. `hand:ready` ack: **25 ms (0 latency) → 883 ms p50 (290 ms)**, about three sequential round trips. Acks of hand-ending moves are not clearly affected in this small sample (guest p95 204 → 326 ms, host 172 → 142 ms); the code predicts about +300 ms there.
* [M] Production DB round trip, estimated as `/healthz` minus `/ping`, six pairs: 160–350 ms (median about 290). Production `/ping` is itself 180–440 ms from here against 13 ms locally, a fixed floor on every call.
* [G] On production each hand change therefore costs roughly 0.9 s plus the floor, and the game-over save the same again.
* Wrong if: a real match on Render shows `hand:ready` ack under about 150 ms, or `healthz − ping` is under 50 ms from inside Render's region (my vantage point could inflate it).

### 2. Server stalls and CPU saturation during MP [M local, G for production]

* [M] Event-loop lag per 10 s window (monitor floor of 20 ms subtracted), by scenario:

  | scenario | median window max | p99 `/ping` | worst window |
  |---|---|---|---|
  | idle, PvF, Daily Fritz | 3–5 ms | 1–5 ms | 63–205 ms (rare) |
  | one MP match | **112–144 ms** (nearly every window over 70 ms) | 147–329 ms | 217–484 ms |

  `/ping` during MP: p95 72–146 ms, max 771 ms, 16–62 pings >100 ms per match.
* [M] Profile of an MP match (240 s, about 185 actions): 96 ms of main-thread CPU per action. Persistence chain 2.3 s, of which Sentry `startSpan` around Supabase fetches 1.65 s, `structuredClone` 1.3 s, `buildLiveSessionRow` 0.66 s, `assertJsonSerializable` 0.57 s, GC 2.3 s. The longest bursts (260–490 ms) are GC pauses and `structuredClone`.
* [M] Every move upserts the **whole room session**: `room_live_sessions` **279 calls, 285 KB average, 77.7 MB in one match** (plus about 500 small receipt/event writes). The measured cause of the CPU in the previous bullet. Also a Supabase egress/DB-churn cost while pre-launch spend is meant to be zero.
* [M] Production `/health`: quota **0.15 CPUs**; 435 of 3,229 periods throttled (62.6 s) in the first 12 minutes after boot (the review CPU benchmark runs 20 searches, 19 s wall, about 30 s after boot [C, `/health` benchmark block]); afterwards about 0 (44 more throttled periods between uptime 737 s and 4,673 s, no players).
* [G] One local match uses about 7 % of a fast core; Render's 0.15 quota on a slower core means one or two concurrent matches can exhaust it. This is an extrapolation, not a measurement.
* REVIEW_SWEEP on vs off [C, not measured]: review search runs in a `worker_threads` Worker (`reviewSearchRunner.ts`), so it is off the event loop but shares the cgroup quota; production has sweep on and bounded-exact on (`/health`). The 20-run boot benchmark is the one measured instance of a worker competing with the main thread (62 s throttled).
* Wrong if: `/health` throttle counters and the event-loop log on Render stay flat while a real MP match runs.

### 3. Client main thread (all modes, worst on phone) [M]

| 4x phone profile | long tasks (>50 ms) | INP p75 / p98 | interactions >100 ms | main thread busy | style recalc share |
|---|---|---|---|---|---|
| PvF, prod build | 7 (647 ms, max 176) | 64 / 96 ms | 4 of 245 | 14.5 % | 35 % |
| PvF, DEV build, full game | 23 (2.1 s, max 403) | 72 / 112 ms | 23 of 662 | 18.3 % | 37 % |
| Daily Fritz, DEV build | 20 (1.5 s, max 175) | 72 / 112 ms | 18 of 365 | 19.2 % | 35 % |
| MP, prod build | 19 (1.6 s, max 193) | 88 / 168 ms | 34 of 250 | **27.7 %** | 37 % |

Input delay p75 is 34–40 ms on phone (taps land while the main thread is busy); 1 ms on desktop. Desktop 1x: INP p75 48–56 ms, 1–8 long tasks per game, one up to 510 ms at game over in MP.

* **Forced layout** [M]: 9,211 `getBoundingClientRect` calls in a 200 s PvF game, **79 per placement**, 2.8 s (about 10 % of main-thread task time at 4x); 524 calls over 2 ms. The CPU profile shows `commitRoot` 4.6 s ≈ `getBoundingClientRect` 4.6 s: the commit phase is almost entirely layout effects forcing reflow. Callers: `useBoardCamera.ts` (auto-fit effect re-armed by every `layout`/`boardTileCount` change, 1 sync + 3 rAF `runFit`), `collectReservedRects`, `rectOf` [C].
* **Re-render breadth** [M]: 15 commits per placed tile in PvF, **29 in MP**; each commit renders 26–45 components including about 11 `DominoTileComponent`. `BotMatchScreenInner` has 370 hooks and 26 distinct state hooks that each changed 60–170 times in a 150 s game; about 60 % of commits are frame-locked (median gap 16.5 ms) score/number readouts. Which state change causes which re-render could not be isolated cleanly (my origin probe is approximate); the breadth numbers stand.
* **Long frames are render work** [M]: in MP the 0.7–1.2 s long-animation-frames have zero script time (style/layout/paint) near hand-over and game-over.
* **First tap** [M+C]: a `pointerdown` handler stalls 114–200 ms on the first tap of every session: `installAudioUnlock` creates the `AudioContext` and primes audio synchronously inside the event.
* Wrong if: batching `getBoundingClientRect` per frame or memoising tiles leaves INP and style-recalc share unchanged. Infinite CSS animations are **ruled out** [M]: about 0.8 alive, pausing them changed style time 10.0 s → 11.8 s.

### 4. Daily Fritz checkpoint payload [M]

* 74 `POST /api/daily-fritz/checkpoint` per game, one about every 2 s (fire-and-forget, debounced, so it does not block taps [C]). Body **p50 118 KB, max 261 KB, 8.8 MB per game**: each carries the whole `moveLog` (79 KB of an 89 KB snapshot at 50 moves, about 1.6 KB per entry), so bytes grow quadratically.
* Serialising it is cheap (`JSON.stringify` 1.05 ms, `setItem` 0.24 ms at 4x). The cost is uplink and server parsing, which I could not measure on production. [G] on cellular this competes with the hand-over verification calls (`next-hand`, `record-game`).
* Wrong if: production checkpoint latency stays under about 300 ms on a throttled mobile network and `next-hand` is unaffected while they are in flight.

### 5. Deliberate pacing and cold paths [M + C]

* Fritz's reply is fixed theater pacing in `botTurnGuards.ts`: 1.58 s p50, 5–7 s tail (earlier doc, confirmed: my own-tile-to-Fritz-tile p50 is 3.4 s including draws and scoring chains). Not lag, but the largest wait in solo modes.
* After a deploy the first minutes run throttled (cause 2); no cold start after idle sleep was observed.

## 3. Ruled out (measured)

| Suspect | Result |
|---|---|
| Bot search on the main thread | `chooseBotMove` p50 0.1–1.8 ms, max 20 ms at 4x; 0 over 50 ms (the 90 ms budget is never reached in play) |
| Review snapshot recorder | **141 ms inclusive per whole game** at 4x (0.3 % of JS), about 1 ms per decision; `analyzeMoveLog` 13 ms |
| Post-game review (client) | prod build: 22 commits, 0 long tasks, 0 slow frames in 25 s after game over. DEV build shows 655 commits but still no slow frames |
| JS heap | 7.5 → 12.2 MB after GC over a full game; plateaus; DOM nodes +226, listeners +150 (small, linear; not proven a leak) |
| Dropped frames in animations (phone 4x) | 0.3–1.5 % of frames over 25 ms vs 0.2–0.4 % idle baseline; 5 % at desktop size is software raster, not a finding |
| Network mid-game (PvF) | 5 API calls per game, none during play. Daily: 74 checkpoints + 7 `next-hand`; MP: 321 full `state:update` (2.8 KB each) and about 260 `player:dragging` per player, about 1 MB per game |
| `/ping` and event loop in solo modes | p99 ≤ 5 ms, lag 3–5 ms: the server is not involved in PvF |

## 4. Proposed budgets

Client, on the 4x phone profile: own tap → board paint p95 ≤ 50 ms (met); INP p98 ≤ 100 ms (now 96–168); no long task >50 ms during tile/bot animation and at most one per hand ≤ 100 ms (now 19–23 per game); frames >25 ms ≤ 1 % (met); commits per placed tile ≤ 5 (15 / 29); `getBoundingClientRect` ≤ 10 per placement (79); first tap ≤ 50 ms (114–200).
Server, during a live match: event-loop lag p99 ≤ 50 ms and max ≤ 100 ms; `/ping` p99 ≤ 50 ms; action ack p95 ≤ 150 ms; `hand:ready` and game-over ack ≤ 200 ms at production DB latency (now about 880 / 326); Supabase bytes per move ≤ 20 KB (285 KB); Daily checkpoint ≤ 10 KB or a delta (118 KB p50); `nrThrottled` growth ≤ 5 per 10 min after the first 5 min.

## 5. Reproduce

```
vite build (DEV forced on only for Daily): see "Builds"        # then vite preview on a private port
node client/scripts/perf/supabaseStub.mjs 54399 [latencyMs]   # server: SUPABASE_URL=http://127.0.0.1:54399 SUPABASE_SERVICE_KEY=stub EVENT_LOOP_LAG_WARN_MS=1 + the e2e env
node client/scripts/perf/lagHarness.mjs --mode pvf|daily|mp|idle --base <url> --profile phone|desktop --cpu 4 --out run.json
node client/scripts/perf/analyzeRun.mjs run.json              # also expHarness / analyzeExp / analyzeCpuProfile / profileBursts / serverProfile / checkpointSize / pingProbe
```
