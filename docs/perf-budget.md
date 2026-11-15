# Perf budget

One page. What the app costs a player in time and bytes, what each merged perf PR changed, what the budget is, and how to measure it again.
The numbers are from the Phase 1 / 1b reports (`perceived-lag-phase1.md`, `perceived-lag-phase1b-transitions.md`, measured 2026-11-13) and from the PR that changed each row.

**Rules**
1. A PR that changes one of these numbers updates its row in the same PR: the "now" column, the "last verified" date, and the PR in the history column. A perf PR that has no row adds one.
2. Numbers must come from the harness named in the row, with before and after from the same build and machine. If a number cannot be re-measured, say so in the Gaps section.
3. **Budget** is what a future PR must not exceed. `proposed` means no CI check enforces it yet: PR B turns the byte and count budgets into blocking checks, and the timing budgets stay report-only until they are calibrated on CI hardware (see "Enforcement").
4. Tags: **[M]** measured by the harness, **[C]** read from code, **[G]** guess. Everything below is [M] unless marked.

**How to measure** (all in `client/scripts/perf/`; phone = iPhone 14 landscape, CDP CPU throttle 4x, 10 Mbps / 150 ms RTT; desktop = 1440x900 at 1x; serve a production build with `node scripts/perf/staticServer.mjs <dist> <port>`; multiplayer needs the server started with `SUPABASE_URL=http://127.0.0.1:54399 ... E2E_AUTH_SHIM=1` and `node scripts/perf/supabaseStub.mjs 54399 <latencyMs>`; Daily Fritz needs a production build with only `e2eDevAuth`'s DEV gate forced; the exact env is in `perceived-lag-phase1.md` section 1):
* tap to screen and hand end: `node scripts/perf/transitionHarness.mjs --mode load|pvf|daily|mp --profile phone|desktop --maxHands 3 --base <url> --out run.json`, then `analyzeTransitions.mjs run.json`
* placement, INP, long tasks: `node scripts/perf/lagHarness.mjs --mode pvf|daily|mp --cpu 4 --profile phone ...` then `analyzeRun.mjs`
* Daily Fritz checkpoint posts and bytes: `node scripts/perf/checkpointPosts.mjs --base <url> --hands 3 --cpu 4`; durability: `checkpointResume.mjs --base <url>`
* server event loop: `EVENT_LOOP_LAG_WARN_MS=1` on the server plus `pingProbe.mjs`; CPU profile: `serverProfile.mjs`
* bundle: `npm run build --prefix client` (or `npx vite build` locally) then `npm run check:bundle-ratchet --prefix client`

## Client: taps and transitions (median of 3 runs unless a range is shown)

| Metric | Phase 1/1b baseline | Now | Budget | Last verified | History |
|---|---|---|---|---|---|
| Home -> hub, tap to first frame, desktop cold | 464 ms | **160 ms** | proposed <= 300 | 2026-11-14 | #507 (the 300 ms Suspense reveal on first-time lazy screens is gone) |
| Home -> hub, phone cold | 475 ms | **144 ms** | proposed <= 300 | 2026-11-14 | #507 |
| Hub -> Play vs Fritz setup, phone cold | 398 ms | **116 ms** | proposed <= 250 | 2026-11-14 | #507 |
| Start Match -> match, desktop cold | 330 ms | **31 ms** | proposed <= 150 | 2026-11-14 | #507 |
| Start Match -> match, phone cold | 624 ms | **380 ms** (waits for the 126 KB match chunk if the tap lands before idle prefetch) | proposed <= 600 | 2026-11-14 | #507 |
| Daily Fritz Start -> match first frame, desktop cold | 487 ms (at #507) | **54 ms** | proposed <= 200 | 2026-11-14 | #508 |
| Daily Fritz Start -> match, **phone cold** | 1.19 s (1b) / 844 ms (at #507) | **261 ms** | proposed <= 500 | 2026-11-14 | #508 (`/start` overlaps the match chunk load) |
| Daily hand end: wait beyond the 5 s reveal timer, phone | +174 ms | **~0 ms** | proposed <= 50 | 2026-11-14 | #508 (`next-hand` is sent at reveal start) |
| First-tap long task (AudioContext created in the tap), desktop / phone | 116 / 103 ms | **0 / 0 ms** | proposed 0 (no task > 50 ms on the first tap) | 2026-11-14 | #508 (context created at idle, `resume()` stays in the gesture) |
| Tile placement, tap to board paint, p50 / p95 | 9 ms / 17 ms desktop, 60 ms phone (p95) | not re-measured after #507/#508 | proposed p95 <= 100 ms phone | 2026-11-13 | none |
| INP on a phone, solo modes | p98 96-168 ms, up to 69 interactions > 100 ms per game | not re-measured | proposed p75 <= 200 ms | 2026-11-13 | none (79 forced layouts per placement are still there) |
| Cold load, phone: first paint / first working tap | 1.15 s / 1.64 s | unchanged | proposed first working tap <= 2.0 s | 2026-11-13 | none |
| Cold load, JS before first paint (brotli) | 449 KB phone, 473 KB desktop | unchanged (#507 added no `modulepreload`: 13 before, 13 after) | **proposed <= 470 KB br phone** (enforced in PR B) | 2026-11-14 | #507 |
| Total JS (bundle ratchet baseline) | 3455.8 kB (before #507) | **3461.9 kB** (baseline 3,545,020 B) | ratchet: +1.0 kB per PR, update the baseline in the PR that grows it | 2026-11-15 | #507/#510 +4.1 kB (lazyScreen, navigation gate, prefetch), #515 +0.9 kB, #520 +1.1 kB |

## Multiplayer: the hand boundary and the server (stub Supabase)

| Metric | Phase 1/1b baseline | Now | Budget | Last verified | History |
|---|---|---|---|---|---|
| Second player's `hand:ready` ack at 290 ms DB latency | 871 ms [864-880] = three sequential writes under the room lock | **306 ms [303-307] with `MP_HAND_BOUNDARY_FAST=true`** (flag default OFF, so production still pays 871) | proposed: awaited room writes = 1 with the flag on (enforced in PR B), ack <= 450 ms report-only | 2026-11-15 | #519 (flag), #520 (client resends `hand:ready` after a reconnect so a lost, acknowledged mark cannot strand a player) |
| First player's ack at 290 ms | 308 ms | **3 ms** (flag on) | proposed <= 50 ms with the flag on | 2026-11-15 | #519 |
| Second player's ack at 0 ms latency | 14 ms | 11 ms | proposed <= 50 ms | 2026-11-15 | #519 |
| Second tap 300 ms after the first (mark write already in flight), 290 ms | 604 ms | 376 ms (writes 3 -> 2) | report only | 2026-11-15 | #519 |
| Hand-ending tile appears for the opponent, 290 ms | 424 ms | 424-512 ms (not affected; that is the `game:action` path) | report only | 2026-11-15 | none |
| Room-session upload per full 30-point match | P1: 77.7 MB (285 KB average write) in one long match | 13.2 MB (9.6-15.5) with `LIVE_SESSION_LOG_ENTRIES` off; **2.3 MB (1.6-2.7) on** (S1, default OFF); different matches, same driver for the two figures | proposed: per-hand-boundary room-session bytes measured and fixed in PR B | 2026-11-15 | #518 (S1 fallback hardening, flag still off) |
| Persistence path CPU per action | n/a | 2.2-2.8 ms flag off, **1.2 ms on**; whole-process CPU difference inside the noise | report only | 2026-11-15 | #518 |
| Server event loop during one MP match (10 s window max, median) | 112-144 ms (worst 484 ms), p99 `/ping` 147-329 ms | not re-measured on production hardware | proposed: no regression vs the Phase 1 range on the stub | 2026-11-13 | #514, #515 |
| `/ping` p99 while a review job is queued and a match is live | 282 / 297 / 220 ms | **144 / 200 / 184 ms** (review decisions evaluated while live: 70 / 78 / 65 -> 0 / 1 / 2); worst single stall 325 / 520 / 243 -> 358 / 440 / 333 ms (**no improvement**) | proposed: 0 review decisions while a room is live | 2026-11-15 | #515 (CPU-scarce runs only; no effect unconstrained) |
| Boot CPU benchmark (20 searches, ~19 s wall, ~30 s after boot) | on; the production container was CPU-throttled for 62.6 s in the first 12 min after boot | removed by default (`REVIEW_CPU_BENCHMARK_ENABLED`) | proposed: none at boot | 2026-11-15 | #514 (not re-measured on Render) |

## Daily Fritz bytes

| Metric | Phase 1 baseline | Now | Budget | Last verified | History |
|---|---|---|---|---|---|
| Checkpoint posts / bytes over 3 hands, phone 4x | 26 posts / 1,039,967 B (Phase 1 over a whole game: 74 posts / 8.8 MB, p50 118 KB each) | **6 posts / 259,092 B** (3 identical runs) | **proposed <= 10 posts and <= 400 KB over 3 hands** (enforced in PR B) | 2026-11-15 | #517 (12 s window, flush on hide / pagehide / leave, retry on failure; hand end still posts at once, before `next-hand`) |
| Reload / hide / offline durability | n/a | reload restores exactly; hide then a fresh device restores from the server; offline resends the latest on reconnect | must stay true | 2026-11-15 | #517 (`checkpointResume.mjs`) |

## Not a number: audio, and what was undone
* **Tile / score sound static (#513):** sounds now fade to silence instead of stopping mid-audible. The e2e `audio-bench` spec asserts the tail is below -55 dBFS, but the original complaint was a listening one and the follow-up listening tests were never reported, so there is no measurement that the static is gone.
* **#509 (prefetch of the multiplayer chunk) was reverted (#512)** after main's Playwright went red; its gains are not in the numbers above and the cause was never proven.

## Gaps (what these numbers cannot tell you)
* **No real iPhone or Capacitor shell.** Phone rows are headless Chromium with CPU throttling on a laptop; the first-tap long-task numbers and every frame-time number are headless and software-rasterized.
* **No real Render or Supabase latency.** The multiplayer rows use a stub with a chosen delay (290 ms was inferred from `/healthz` minus `/ping` from one location, 160-350 ms). In-match Supabase round trips on Render were never measured. The 0.15-CPU container behaviour is read from `/health`, not reproduced.
* **Daily Fritz timing runs use a build with the dev-auth gate forced**, so they are slightly pessimistic; the Daily checkpoint numbers are deterministic per fixture and do not depend on it.
* **Not re-measured since Phase 1:** tile placement p95, INP, the cold-load first working tap, game end to result card, the event-loop numbers under a real match. Rows say "not re-measured" instead of repeating an old value as if it were new.
* **Not fixed yet:** 79 forced layouts per placement and whole-screen re-renders on the phone, the render-blocking Google Fonts stylesheet and the review chunks in the home `modulepreload` (~270 KB br), and the multiplayer hand boundary in production (the flag is off, and the client needs its resend fix, #520, deployed first).
* **The multiplayer hand-boundary and server-CPU measurements were taken with scratch drivers** (a socket client playing full matches and a timestamping stub) that are not in the repo yet; PR B adds repo versions so the row can be re-measured. Until then the `checkpointPosts.mjs` and `transitionHarness.mjs` rows are the reproducible ones.
* **No field data.** Everything is synthetic. Real-user timing is a separate PR (C) and does not exist yet.

## Enforcement (planned, not in this PR)
* **PR B, blocking from day one:** JS bytes before first paint; Daily checkpoint posts and bytes over 3 hands; room writes the second player awaits at a hand boundary (flag on, 290 ms stub); room-session bytes per hand boundary. These are counts and bytes, so they do not depend on runner speed. A blocking check that gives two false failures is demoted to report-only and the demotion is recorded here.
* **PR B, report-only:** the timing rows above, as a separate job (median of 3, one retry), plus a nightly run on `main` that uploads a trend artifact. A timing row becomes blocking only after ten PRs of CI data set a threshold at about 2.5x the CI p95.
