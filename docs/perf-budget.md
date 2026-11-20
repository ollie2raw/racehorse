# Perf budget

One page. What the app costs a player in time and bytes, what each merged perf PR changed, what the budget is, and how to measure it again.
The numbers are from the Phase 1 / 1b reports (`perceived-lag-phase1.md`, `perceived-lag-phase1b-transitions.md`, measured 2026-11-13) and from the PR that changed each row.

**Rules**
1. A PR that changes one of these numbers updates its row in the same PR: the "now" column, the "last verified" date, and the PR in the history column. A perf PR that has no row adds one.
2. Numbers must come from the harness named in the row, with before and after from the same build and machine. If a number cannot be re-measured, say so in the Gaps section.
3. **Budget** is what a future PR must not exceed. `enforced` means a blocking CI check holds it (the four Tier 1 budgets, see "Enforcement"); `proposed` means nothing enforces it yet, and the timing budgets stay report-only until they are calibrated on CI hardware.
4. Tags: **[M]** measured by the harness, **[C]** read from code, **[G]** guess. Everything below is [M] unless marked.

**How to measure** (all in `client/scripts/perf/`; phone = iPhone 14 landscape, CDP CPU throttle 4x, 10 Mbps / 150 ms RTT; desktop = 1440x900 at 1x; serve a production build with `node scripts/perf/staticServer.mjs <dist> <port>`; multiplayer needs the server started with `SUPABASE_URL=http://127.0.0.1:54399 ... E2E_AUTH_SHIM=1` and `node scripts/perf/supabaseStub.mjs 54399 <latencyMs>`; Daily Fritz needs a production build with only `e2eDevAuth`'s DEV gate forced (`scripts/perf/vite.perf-daily.config.mjs`); the exact env is in `perceived-lag-phase1.md` section 1):
* tap to screen and hand end: `node scripts/perf/transitionHarness.mjs --mode load|pvf|daily|mp --profile phone|desktop --maxHands 3 --base <url> --out run.json`, then `analyzeTransitions.mjs run.json`
* placement, INP, long tasks: `node scripts/perf/lagHarness.mjs --mode pvf|daily|mp --cpu 4 --profile phone ...` then `analyzeRun.mjs`
* Daily Fritz checkpoint posts and bytes: `node scripts/perf/checkpointPosts.mjs --base <url> --hands 3 --cpu 4`; durability: `checkpointResume.mjs --base <url>`
* server event loop: `EVENT_LOOP_LAG_WARN_MS=1` on the server plus `pingProbe.mjs`; CPU profile: `serverProfile.mjs`
* bundle: `npm run build --prefix client` (or `npx vite build` locally) then `npm run check:bundle-ratchet --prefix client`
* multiplayer hand boundary and room-session bytes: the built server on `supabaseStub.mjs <port> 290 <timeline.jsonl>`, then `node scripts/perf/mpMatchDriver.mjs --server http://127.0.0.1:3001 --mode boundary --gap 10`; a whole 30-point match: `--mode full`; server CPU and event-loop window: the `eventLoopWindow.cjs` preload (usage in its header)
* all Tier 1 budgets in one go (what CI runs): `node scripts/perf/perfBudgetsTier1.mjs`; the report-only timings: `node scripts/perf/perfTimingTier2.mjs`. Thresholds live in `scripts/perf/perf-budgets.json`.

## Client: taps and transitions (median of 3 runs unless a range is shown)

| Metric | Phase 1/1b baseline | Now | Budget | Last verified | History |
|---|---|---|---|---|---|
| Home -> hub, tap to first frame, desktop cold | 464 ms | **160 ms** | proposed <= 300 | 2026-11-14 | #507 (the 300 ms Suspense reveal on first-time lazy screens is gone) |
| Home -> hub, phone cold | 475 ms | **144 ms** | proposed <= 300 | 2026-11-14 | #507 |
| Hub -> Play vs Fritz setup, phone cold | 398 ms | **116 ms** | proposed <= 250 | 2026-11-14 | #507 |
| Start Match -> match, desktop cold | 330 ms | **31 ms** | proposed <= 150 (loose: 31 ms measured; a regression to 140 ms would pass, the old 330 ms would not; tighten to <= 100 once CI data exists) | 2026-11-14 | #507 |
| Start Match -> match, phone cold | 624 ms | **380 ms** (waits for the 126 KB match chunk if the tap lands before idle prefetch) | proposed <= 600 | 2026-11-14 | #507 |
| Daily Fritz Start -> match first frame, desktop cold | 487 ms (at #507) | **54 ms** | proposed <= 200 | 2026-11-14 | #508 |
| Daily Fritz Start -> match, **phone cold** | 1.19 s (1b) / 844 ms (at #507) | **261 ms** | proposed <= 500 | 2026-11-14 | #508 (`/start` overlaps the match chunk load) |
| Daily hand end: wait beyond the 5 s reveal timer, phone | +174 ms | **~0 ms** | proposed <= 50 | 2026-11-14 | #508 (`next-hand` is sent at reveal start) |
| First-tap long task (AudioContext created in the tap), desktop / phone | 116 / 103 ms | **0 / 0 ms** | proposed 0 (no task > 50 ms on the first tap) | 2026-11-14 | #508 (context created at idle, `resume()` stays in the gesture) |
| Tile placement, tap to board paint, p50 / p95 | 9 ms / 17 ms desktop, 60 ms phone (p95) | not re-measured after #507/#508 | proposed p95 <= 100 ms phone (60 ms measured, so 1.7x headroom: tight for a CI runner, report-only) | 2026-11-13 | none |
| Forced layout reads per tile placement (`getBoundingClientRect` calls, PvF phone 4x, `expHarness.mjs` + `analyzeExp.mjs`, full game, 3 runs) | **81.6 / 79.6 / 78.5** (mean 79.9; 9-11k calls per game) | **22.2 / 21.2 / 21.5** (mean 21.6) | proposed <= 25 now (the camera's share is gone); target <= 10 needs the tile flight's per-frame reads (about 18 per placement) removed | 2026-11-16 | camera fit measures once and re-measures only on resize / overlay change (#PR-A). Forced-layout time per placement **27.6 -> 18.8 ms (-32%)**; main-thread busy share, style-recalc share (38-40%), INP p98 and long tasks did **not** change (see Gaps) |
| INP on a phone, solo modes | p98 96-168 ms, up to 69 interactions > 100 ms per game | not re-measured | proposed p75 <= 200 ms. This is Google's "good" line, not a regression guard: desktop PvF p75 measured 48 ms, so a 4x regression would still pass. Phone p75 was never recorded; do that before choosing a guard | 2026-11-13 | none (79 forced layouts per placement are still there) |
| Cold load, phone: first paint / first working tap | 1.15 s / 1.64 s | unchanged | proposed first working tap <= 2.5 s (the earlier 2.0 s was 1.2x the measured 1.64 s: too tight for a slower runner) | 2026-11-13 | none |
| Cold load, JS before first paint (brotli) | 449 KB phone, 473 KB desktop (harness, 19 files incl. late dynamic imports) | unchanged (#507 added no `modulepreload`: 13 before, 13 after). **Tier 1 measure** (entry + the 13 `modulepreload`s in `dist/index.html`, brotli q6): **440,185 B** (440,496 B after the RUM starter, PR C) | **<= 460,000 B on the Tier 1 measure (enforced)**; the harness figure stays informational | 2026-11-15 | #507; budget corrected in PR B (the earlier 470 KB was written against the harness number, which counts more files) |
| Total JS (bundle ratchet baseline) | 3455.8 kB (before #507) | **3461.9 kB** (baseline 3,545,020 B) | ratchet: +1.0 kB per PR, update the baseline in the PR that grows it | 2026-11-15 | #507/#510 +4.1 kB (lazyScreen, navigation gate, prefetch), #515 +0.9 kB, #520 +1.1 kB |

## Multiplayer: the hand boundary and the server (stub Supabase)

| Metric | Phase 1/1b baseline | Now | Budget | Last verified | History |
|---|---|---|---|---|---|
| Second player's `hand:ready` ack at 290 ms DB latency | 871 ms [864-880] = three sequential writes under the room lock | **306 ms [303-307] with `MP_HAND_BOUNDARY_FAST=true`** (flag default OFF, so production still pays 871) | **awaited room writes = 1 with the flag on (enforced; median of 3 boundaries, second tap 10 ms after the first)**; ack <= 500 ms report-only (one write ~306 ms, two ~600, three ~870, so 500 separates them and does not depend on CPU) | 2026-11-15 | #519 (flag), #520 (client resends `hand:ready` after a reconnect so a lost, acknowledged mark cannot strand a player) |
| First player's ack at 290 ms | 308 ms | **3 ms** (flag on) | proposed <= 50 ms with the flag on (loose: a regression to awaiting the write would be 290 ms, caught; 3 -> 40 ms would not) | 2026-11-15 | #519 |
| Second player's ack at 0 ms latency | 14 ms | 11 ms | proposed <= 50 ms | 2026-11-15 | #519 |
| Second tap 300 ms after the first (mark write already in flight), 290 ms | 604 ms | 376 ms (writes 3 -> 2) | report only | 2026-11-15 | #519 |
| Hand-ending tile appears for the opponent, 290 ms | 424 ms | 424-512 ms (not affected; that is the `game:action` path) | report only | 2026-11-15 | none |
| Room-session upload per full 30-point match | P1: 77.7 MB (285 KB average write) in one long match | 13.2 MB (9.6-15.5) with `LIVE_SESSION_LOG_ENTRIES` off; **2.3 MB (1.6-2.7) on** (S1, default OFF); different matches, same driver for the two figures | **<= 2,000 B per game-state step at a hand boundary (enforced)**: the new-hand snapshot grows with the match (26 KB after hand 1, 49-75 KB after hand 2, 91-118 KB after hand 3 with S1 off), so bytes per step is the comparable figure: measured 1,055-1,485, median per run 1,187-1,357; S1 on would be about 300 | 2026-11-15 | #518 (S1 fallback hardening, flag still off) |
| Persistence path CPU per action | n/a | 2.2-2.8 ms flag off, **1.2 ms on**; whole-process CPU difference inside the noise | report only | 2026-11-15 | #518 |
| Server event loop during one MP match (10 s window max, median) | 112-144 ms (worst 484 ms), p99 `/ping` 147-329 ms | not re-measured on production hardware | not enforceable as written ("no regression" has no number); drop it unless a stub run with a fixed driver gives one (the `eventLoopWindow.cjs` preload exists for that) | 2026-11-13 | #514, #515 |
| `/ping` p99 while a review job is queued and a match is live | 282 / 297 / 220 ms | **144 / 200 / 184 ms** (review decisions evaluated while live: 70 / 78 / 65 -> 0 / 1 / 2); worst single stall 325 / 520 / 243 -> 358 / 440 / 333 ms (**no improvement**) | proposed: 0 review decisions while a room is live | 2026-11-15 | #515 (CPU-scarce runs only; no effect unconstrained) |
| Boot CPU benchmark (20 searches, ~19 s wall, ~30 s after boot) | on; the production container was CPU-throttled for 62.6 s in the first 12 min after boot | removed by default (`REVIEW_CPU_BENCHMARK_ENABLED`) | proposed: none at boot | 2026-11-15 | #514 (not re-measured on Render) |

## Daily Fritz bytes

| Metric | Phase 1 baseline | Now | Budget | Last verified | History |
|---|---|---|---|---|---|
| Checkpoint posts / bytes over 3 hands, phone 4x | 26 posts / 1,039,967 B (Phase 1 over a whole game: 74 posts / 8.8 MB, p50 118 KB each) | **6 posts / 259,092 B** (3 identical runs) | **<= 12 posts and <= 450,000 B over 3 hands (enforced)**; PR A proposed 10 / 400 KB, loosened because the posts follow wall-clock time (a slower runner plays the 3 hands over a longer time, so more 12 s windows); the old debounce gave 26 / 1.04 MB, so 12 / 450 KB still catches it | 2026-11-15 | #517 (12 s window, flush on hide / pagehide / leave, retry on failure; hand end still posts at once, before `next-hand`) |
| Reload / hide / offline durability | n/a | reload restores exactly; hide then a fresh device restores from the server; offline resends the latest on reconnect | must stay true | 2026-11-15 | #517 (`checkpointResume.mjs`) |

## Not a number: audio, and what was undone
* **Tile / score sound static (#513):** sounds now fade to silence instead of stopping mid-audible. The e2e `audio-bench` spec asserts the tail is below -55 dBFS, but the original complaint was a listening one and the follow-up listening tests were never reported, so there is no measurement that the static is gone.
* **#509 (prefetch of the multiplayer chunk) was reverted (#512)** after main's Playwright went red; its gains are not in the numbers above and the cause was never proven.

## Gaps (what these numbers cannot tell you)
* **WebKit (Playwright, Safari 26.5 build, unthrottled iPhone 14 landscape profile, 3 runs; `transitionHarness.mjs --browser webkit`)** is about 1.5-2.7x slower than Chromium on the same Mac for the same taps (median ms, Chromium vs WebKit): home -> hub 53 vs 102, Start Match 40 vs 108, Daily start 71 vs 155, multiplayer start 349 vs 490. It has no CPU throttle, long-task or long-animation-frame data, so the 4x phone rows below remain Chromium-only.
* **No real iPhone or Capacitor shell.** Phone rows are headless Chromium with CPU throttling on a laptop; the first-tap long-task numbers and every frame-time number are headless and software-rasterized.
* **No real Render or Supabase latency.** The multiplayer rows use a stub with a chosen delay (290 ms was inferred from `/healthz` minus `/ping` from one location, 160-350 ms). In-match Supabase round trips on Render were never measured. The 0.15-CPU container behaviour is read from `/health`, not reproduced.
* **Daily Fritz timing runs use a build with the dev-auth gate forced**, so they are slightly pessimistic; the Daily checkpoint numbers are deterministic per fixture and do not depend on it.
* **Not re-measured since Phase 1:** tile placement p95, INP, the cold-load first working tap, game end to result card, the event-loop numbers under a real match. Rows say "not re-measured" instead of repeating an old value as if it were new.
* **Not fixed yet:** the tile flight's per-frame layout reads (about 18 per placement; the camera's 60 are gone, #PR-A), style recalculation (38-40% of main-thread time at 4x, unchanged by removing the reads) and whole-screen re-renders on the phone, the render-blocking Google Fonts stylesheet and the review chunks in the home `modulepreload` (~270 KB br), and the multiplayer hand boundary in production (the flag is off, and the client needs its resend fix, #520, deployed first).
* **The multiplayer hand-boundary, room-session-bytes and server-CPU drivers are now in the repo** (`mpMatchDriver.mjs`, `supabaseStub.mjs` with a timeline, `eventLoopWindow.cjs`), but the Phase 1 / 1b server-CPU numbers were taken with earlier scratch versions of them.
* **Field data starts with PR C** (`docs/ops/rum-beacon.md`): a sampled first-party beacon (25% of page loads) reports medians per transition, grouped by platform, form factor, screen, memory and connection, in hourly totals. Until it has run for a while there are no field numbers in this document, and the rows above stay synthetic.

## Enforcement
**Tier 1, blocking** (`.github/workflows/perf-budgets.yml`, job "Perf Budgets (Tier 1)", `client/scripts/perf/perfBudgetsTier1.mjs`, thresholds in `perf-budgets.json`). Counts and bytes only, so runner speed does not matter:
1. JS before first paint (brotli bytes of the entry script and the `modulepreload`s in `dist/index.html`): 330,000 <= bytes <= 460,000, and 12 <= files <= 16 (14 today: entry + 13 `modulepreload`s). Two-sided since the audit (E3): the old one-sided check passed at 0 bytes when the tag parse stopped matching (attribute order, single quotes, `modulePreload: false`). Tags are now parsed attribute-order- and quote-independent (`firstPaintAssets.mjs`). Measured 441,048 B / 14 files on this PR's build; a deliberate split changes the min/max in the same PR.
2. Daily Fritz checkpoint posts and bytes over 3 hands, phone 4x: 1 <= posts <= 12, 50,000 <= bytes <= 450,000.
3. Room writes the second player awaits at a hand boundary, `MP_HAND_BOUNDARY_FAST=true`, stub at 290 ms: median <= 1.
4. Room-session bytes per game-state step at a hand boundary: 100 <= bytes/step <= 2,000.
A check outside its range (max, and min where one is set; NaN is outside) is run once more and fails only if both attempts are outside. The job runs in parallel with CI, on `pull_request` and `push` to `main` when client, server, game-core, the lockfile or the perf scripts change (a docs-only PR does not start it), and nightly.

**Demotion rule.** A blocking check that gives two false failures (a failure on a commit that did not change what the check measures, shown by a green rerun of the same commit) is demoted to report-only in the next PR: move its budget from `tier1` to a report-only section of `perf-budgets.json`, say why in this section, and keep measuring it. A check is promoted back only with a threshold set from CI data.

| Date | Check | Action | Why |
|---|---|---|---|
| (none yet) | | | |

**Tier 2, report only** (job "Perf Timing (Tier 2, report only)", `continue-on-error`, `perfTimingTier2.mjs`): Play vs Fritz home -> hub and Start Match -> match on the phone profile, cold first contentful paint, and the multiplayer second-player ack and deal time at 290 ms. Median of 3 runs, one retry for a run that errors; every run writes JSON and a step summary, and the nightly run on `main` keeps the artifact for 90 days (trend). The limits in `perf-budgets.json` are provisional: the multiplayer ones are set from stub latency (not CPU-bound, so they hold), the Play vs Fritz and paint ones are placeholders. A timing becomes blocking only after ten PRs of CI data set a limit of about 2.5x the CI p95, and only if that limit still sits below the regressed value times the CI/laptop speed factor; if it cannot, an absolute limit cannot catch the regression and the check should compare the PR against the base commit in the same job instead.

**First CI run (GitHub `ubuntu-latest`, 2026-11-15, PR #522, wall time Tier 1 4 min 51 s, Tier 2 5 min 19 s):** Tier 1 JS before first paint 440,182 B; Daily checkpoint 7 posts / 294,538 B; awaited room writes 1; room-session bytes 1,083 per step. Tier 2 (phone, cold): Play vs Fritz home -> hub 111 ms, Start Match -> match 198 ms, first contentful paint 1,248 ms; multiplayer second ack 295 ms and deal 305 ms. Note the CI runner was **not slower** than the laptop on these (it was faster on two), so the CPU-speed worry behind the loose Play vs Fritz / paint placeholders is unconfirmed; collect ten PRs before changing them. The first workflow run failed only because the script path was wrong (`client/client/...`), a configuration error that does not count towards the demotion rule.
