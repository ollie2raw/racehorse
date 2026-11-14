# Perceived lag, Phase 1b: the transitions (no app changes)

Written 2026-11-13, after `perceived-lag-phase1.md`. Scope: app load, entering a game, the pre-game draw, hand end, game end and tile placement, for Play vs Fritz (PvF), Daily Fritz and multiplayer (MP), on a throttled phone profile and on desktop. Pacing is out of scope, so fixed timers are reported only to split them from waiting. Nothing in `client/src` or `server/src` was changed. Tools: `client/scripts/perf/` (`transitionHarness.mjs`, `analyzeTransitions.mjs`, …); per-run timelines: `docs/perceived-lag-phase1b-data/`.

Tags: **[M]** measured · **[C]** read from code · **[G]** guess. "Residual" below means time in a window that is neither a network call in flight nor main-thread busy, i.e. animation or a timer.

## Verdict: where the player waits, ranked by milliseconds

| # | Cause | What the player waits | How often | Tag |
|---|---|---|---|---|
| 1 | **MP hand boundary**: the host's next hand waits on three sequential Supabase round trips | host **0.9 s** after the reveal closes (guest 0.3 s); final move of the game acks in **0.5 s**; the tile that ends a hand takes **0.3–0.4 s** to appear; phone result card **1.5 s** after the last tile | every hand (11 hands ≈ 10 s per match, host) | M (290 ms DB latency injected; 160–350 ms estimated for production) |
| 2 | **React Suspense reveal throttle** on every first-time lazy screen | **≈ 300 ms** per screen (hub, tier screen, match screen each 330–600 ms; the same tap is **11–49 ms** once the screen has loaded once) | 3–4 times on the way from home to a match, once per session | M + C |
| 3 | **Cold phone load**: painted but not tappable, heavy before first paint | first paint 1.15 s, **first working tap 1.64 s** (0.5 s after paint); 3.5 s to first paint on 1.6 Mbps; 450 KB brotli / 1.6 MB decoded JS before first paint | once per cold visit | M |
| 4 | **Daily Fritz awaited calls** | tap Start → match **1.19 s** on phone (`/start` 417 ms awaited); `next-hand` goes out only at the end of the 5 s reveal and the modal closes after it returns (**+0.3 s**) | every Daily entry and hand end | M, production floor is larger: G |
| 5 | **Main-thread work during modals and at the first tap** (phone) | 0.7–1.2 s of busy main thread per hand end; MP game end 0.9 s; first tap of a session stalls **100–180 ms** (`new AudioContext()` inside the tap) | every hand end; first tap | M (audio cost on a real phone: unknown) |

Not ranked, by instruction: fixed timers (pre-game draw 4.0 s, hand reveal 2.0 s + 5.0 s, Fritz opening 3–5 s). Placement is fast: **p95 17 ms desktop, 60 ms phone** in solo modes, and the only long tail is cause 1 (section 7).

## 1. Method and what to distrust

Same harness family as Phase 1: real Chromium, full games played by a driver, production build served by `scripts/perf/staticServer.mjs` (brotli plus the `vercel.json` cache headers, prerendered routes). Phone = iPhone 14 landscape (the match screen is landscape-only), 4x CPU, 10 Mbps down / 5 Mbps up, **150 ms RTT on HTTP** (stands in for the 180–440 ms production `/ping` floor; websocket frames are not throttled by Chromium). MP runs use the Supabase stub at 290 ms (`/healthz − /ping` from Phase 1). Timelines come from an in-page state-signature sampler (screen, draw tiles, hand, playable tiles, board, hand-over modal, result), per-tap marks, animation starts, resource timing, websocket frames and CDP main-thread deltas every 100 ms.

* Daily Fritz runs use a production build with only the dev-auth gate forced on, entered by deep link to `/daily-fritz` (the home card opens the sign-in modal in this environment). An earlier all-DEV build was discarded: it loads a debug-ingest module around hand end.
* Runs I disturbed (analysis commands during a run) were discarded and rerun quiet. Phone PvF first-tap stalls of 2–3 s in those runs were contention, not the app; five quiet repeats give 100–178 ms.
* The 8 s cold "player picks" in the PvF phone run is a driver artifact: a separate probe finds the draw tiles tappable 450 ms after they are marked pickable (3 of 3 cold runs, nothing covering them). The warm run is used for that timeline.
* Not measured: a real iPhone/Capacitor; GPU compositing; Supabase inside a real match; production server CPU effects; Daily phone game end (the quiet run stops at 3 hands).

## 2. App load [M]

| | desktop cold | desktop warm | phone cold | phone warm | phone, 1.6 Mbps cold |
|---|---|---|---|---|---|
| first paint / LCP | 408 / 680 ms (hero image) | 464 / 464 | 1148 / 1688 (H1 text) | 736 / 736 | 3488 / 4196 |
| DOMContentLoaded | 219 | 46 | 910 | 298 | 3174 |
| requests (before first paint) | 49 (42) | 49 (44) | 49 (22) | 49 (44) | 49 (22) |
| JS before first paint | 473 KB br / 1659 KB decoded, 31 files | cache | 449 KB br / 1584 KB, 17 files | cache | same, last byte at 3.6 s |
| CSS before first paint | 71 KB, 8 files | cache | 63 KB, 4 files | cache | 55 KB main sheet arrives at 2.1 s |
| main thread, first 3 s | 655 ms (script 357) | 327 ms | 705 ms (script 392) | — | — |

* **First working tap** (5 quiet repeats, `React props attached` probe): desktop **0.47–0.48 s** (paint at 0.24–0.38 s); phone **1.63–1.68 s** (paint 1.13–1.19 s, LCP 1.67–1.72 s). A tap in that gap does nothing.
* Before first paint: render-blocking Google Fonts stylesheet (1 KB, 156 ms local, 296 ms on the phone profile; two woff2 files, 47 KB, follow from another origin), plus `index.css` 55 KB, `pivotal-review.css` and `game-reviewer.css` 7 KB. No audio and no web-font files before first paint; the audio sample (11 KB) is fetched at the first tap.
* The home page `modulepreload`s 13 chunks including the review code (`game-reviewer`, `analyzer`, `pivotal-review`, `bot-guided`, `bot-engine`, `vendor-supabase`): about 270 KB brotli, of which the review chunks (`game-reviewer`, `analyzer`, `pivotal-review`) are 83 KB [M + C: `dist/index.html`]. [G] The home screen does not need them to paint.
* Long tasks: before the first tap none over 100 ms; the phone cold run has two 65 ms tasks at hydration. TBT 50–128 ms phone, 52–63 ms desktop.
* **First tap** [M + C]: 100–178 ms long task on phone, 102–113 ms desktop, in every quiet run. Profile: `ensureContext` (`new AudioContext()`, `installAudioUnlock` in the audio engine) runs synchronously inside the `pointerdown` handler. Headless Chromium opens an audio device; the cost on a real iPhone is unknown [G: smaller].

## 3. Entering a game [M]

Tap to first frame of the next screen (phone cold / phone warm / desktop warm). Network is idle in solo modes.

| step | phone cold | phone warm | desktop warm | what is in it |
|---|---|---|---|---|
| home → Single Player hub | 597 ms | 347 | 345 | chunk 3.6 KB + 5 small files; main 80–337 ms; **≈ 260 ms residual** |
| hub → Play vs Fritz | 465 | 448 | 331 | 15 KB (2 images); main 175–191; **≈ 270 ms residual** |
| Start Match → match screen | 595 | 365 | 331 | **17–18 chunks, 126–131 KB br / 332 KB decoded** (BotMatchScreen 68 KB br / 252 KB), no API call; main 51–143; **≈ 230–450 ms residual** |
| Daily Fritz: Start → match screen | 1187 (`/start` awaited 417 ms) | 762 | 466 (`/start` 6 ms) | 19–21 chunks, 138–143 KB br |
| MP: Start Match → match screen (host) | 698 (`game:start` ack 301 ms) | — | 628 (ack 312 ms) | ack = one Supabase write at 290 ms; 9 files 37 KB |

* **Suspense throttle** [M + C]: the residual is constant (≈ 260–290 ms) whatever the chunk size. Experiment: tap the same two screens again after leaving them; they now render in **11–13 ms (desktop) and 47–49 ms (phone)**, against 337–565 ms and 414–481 ms the first time (`suspense-revisit-experiment.txt`). React holds a revealed Suspense boundary until 300 ms after its fallback committed (`globalMostRecentFallbackTime + 300`, bundle line `8006`); routes are `React.lazy` behind `Suspense` with `ScreenLoader` and `startTransition` is used nowhere [C].
* Interactive: PvF draw tiles pickable **321 ms** after the tap (desktop), 355 phone warm, 592 phone cold; Daily 464 desktop, 1139 phone cold; MP 619 / 652. A trial tap passes 450 ms after the tiles look ready (they settle during the entrance animations `match-hud/board/deck-enter`).
* Board mount, first 1.5 s: 3–6 commits, 91–396 ms main-thread task (phone MP 294), layout ≤ 36 ms, style 4–83 ms; `getBoundingClientRect` 5,200–18,000 calls per game (Phase 1 cause 3).

## 4. Pre-game draw [M, timers C]

Phone warm PvF, relative to the Start tap: tiles pickable **355 ms** → player picks ≈ 1.3 s (driver, ≤ 0.2 s of that) → "you / Fritz goes first" 2.37 s → hand on screen and **first playable tile 5.37 s**. Desktop 5.29 s; Daily 5.44 s desktop / 6.20 s phone cold; MP 5.59 s desktop / 5.25 s phone (then +445 ms turn hand-off, 31 commits).

| segment | ms | network | main thread | residual |
|---|---|---|---|---|
| Start tap → tiles pickable | 355 | 0 | 130 | 225 (loader `rh-screen-loader-in`, Suspense) |
| pickable → pick | 962 | 0 | 58 | 903 (entrance animations; includes driver reaction) |
| pick → hand on screen | 4057 | 0 | 217 | 3840 |

The last segment is the three timers `PRE_GAME_DRAW_OPPONENT_PICK_DELAY_MS` 1000 + `REVEAL_PAUSE_MS` 2000 + `RESULT_DISPLAY_MS` 1000 = 4000 [C]. Non-timer wait from tap to playable is **≈ 0.9–1.3 s** (screen reveal, settle, an 88–95 ms long task on phone); no request is awaited in PvF, one in Daily (`/start`) and one in MP (`game:start`). Images: 1–2 per segment, no decode stall seen.

## 5. Hand end [M]

Last tile to the next hand's first playable tile. Fixed timers [C]: reveal delay 2000 ms (solo, `DAILY_FRITZ_HAND_REVEAL_DELAY_MS`) / 1400 ms (MP, `HAND_REVEAL_OPEN_DELAY_MS`); modal auto-continue 4000 ms (+≈ 1 s solo); Fritz opening 3.0–5.3 s when he starts the hand.

| mode | total | network in flight | main-thread busy | waiting that is not a timer |
|---|---|---|---|---|
| PvF desktop | 7.0–7.1 s (player opens), 10.5–13.9 s (Fritz opens) | 0 | 0.33–1.04 s (one hand has two long tasks, 71 and 112 ms) | 0.3–1.0 s |
| PvF phone | 7.03–7.05 / 10.1–13.2 s | 0 | 0.72–1.01 s | 0.7–1.0 s |
| Daily desktop | 7.0–7.5 / 10.5–11.2 s | 9–158 ms (`next-hand`) | 0.35–0.9 s | 0.4–1.0 s |
| Daily phone | 7.3 / 10.8 s | **307 ms** | 0.62–1.6 s | 0.9–1.9 s |
| MP desktop, 290 ms DB | 6.3–7.1 s | **host 890–915 ms** (guest 290–305) | 0.26–0.32 s | host 1.2 s, guest 0.6 s |
| MP phone, 290 ms DB | 6.3–7.8 s (one hand 9.5 s) | host 891–928 ms | 0.76–1.2 s | host 1.7–2.1 s |

* **MP** [M + C]: the host's `hand:ready` is sent at 3.9–4.0 s of the reveal and acked 4.8–4.9 s; `closed → next hand dealt` is **890–916 ms**. `registerGameplayActionHandlers.ts` persists before acking a hand change; three sequential writes ≈ 3 × 290 ms. At 0 ms of DB latency Phase 1 measured the same ack at 25 ms.
* **Daily** [M + C]: `POST /api/daily-fritz/next-hand` is issued at 4.97–5.01 s of the reveal (at the auto-advance, not early) and the modal closes 40 ms after it returns: 307 ms on the phone profile (150 ms RTT + 13 ms server), +≈ 0.3 s on every hand. The code has a prefetch coordinator (`useHandLifecycle.ts:386`) but the request starts at the advance. [G] In production (floor 0.2–0.4 s, server verification on 0.15 CPU) this is 0.4–1 s.
* PvF/Daily phone: the main thread is 4–15 % busy during the 5 s reveal (phone 4x); no long task over 100 ms in these runs.

## 6. Game end [M]

* **PvF**: the result card mounts **10–38 ms** after the last tile (no hand-over modal, no request).
* **Daily desktop**: `record-game` (43 ms) then `complete` (56 ms), sequentially; the result card fades in at +100 ms and +609 ms. Phone not measured.
* **MP desktop**: the final `game:action` acks in ≈ 515 ms (normal 22–49 ms); the result mounts 87 ms after the last tile.
* **MP phone**: last tile → result card **1,472 ms** = 475 ms network (two `game:action`, the second 540 ms) + 902 ms main-thread busy (result screen render at 4x) + 94 ms residual.

## 7. Tile placement [M]

Placement tap → board tile count rises (frame start).

| | n | p50 | p95 | p99 | max | notes |
|---|---|---|---|---|---|---|
| PvF desktop | 49 | 8 | 17 | 37 | 37 | |
| Daily desktop | 44 | 9 | 14 | 23 | 23 | |
| MP desktop (290 ms DB) | 96 | 10 | **187** | 392 | 392 | mid-hand 80: p95 **37**, max 67; hand/game-ending 16: p95 **392** |
| PvF phone | 60 | 35 | 60 | 71 | 71 | |
| Daily phone (quiet, 3 hands) | 13 | 38 | 57 | 57 | 57 | small sample |
| MP phone (290 ms DB) | 102 | 55 | 121 | 362 | 366 | mid-hand p95 107, max 153; ending tiles 362–366 |

Tile tap → drop zone visible: p50 3–5 ms desktop, 18–25 ms phone (p95 ≤ 46). Draw (boneyard tap → tile in hand): p50 90–230 ms solo; MP 284–605 ms, p95 1.5–2.2 s (forced-draw animation 325 ms stagger + 1,170 ms flight [C]).

Long tail: **all 6 desktop placements over 100 ms are hand- or game-ending tiles** in MP (their broadcast waits on the synchronous persistence flush [C], ≈ one DB round trip + 100 ms). Solo-mode tails (phone 46–71 ms) and MP mid-hand tails on phone (100–153 ms) are the click handler itself: 43–90 ms of script in the `index` chunk plus a `game-reviewer` rAF callback at 4x. A mis-paired set of "1.58 s" placements in my first pass was an artifact (Fritz's reply tile, 1.58 s after mine, landing as my next tap); the pairing now anchors on the tile leaving the hand.

## 8. Proposed budgets

| transition | budget | now |
|---|---|---|
| first paint, phone 4G/4x | ≤ 1.5 s | 1.15 s ✓ |
| paint → first working tap | ≤ 200 ms | 500 ms phone, 100–240 ms desktop |
| JS before first paint | ≤ 250 KB brotli | 450–473 KB |
| first tap stall | ≤ 50 ms | 100–180 ms (headless) |
| menu tap → next screen, warm | ≤ 100 ms over chunk time | 330–450 ms |
| tap Start → match first frame | ≤ 300 ms (PvF/MP), ≤ 500 ms with a server call | 327–595 PvF; 762–1187 Daily; 628–698 MP |
| match screen → draw tiles tappable and settled | ≤ 300 ms | 321–592 + 450 settle |
| hand end → next hand playable, non-timer wait | ≤ 400 ms | 0.4–1.0 s solo desktop; 0.7–1.9 s phone; MP host 1.2–2.1 s |
| game end → result card | ≤ 300 ms | PvF 10–38 ms ✓; MP phone 1,472 ms |
| placement p95 (incl. ending tiles) | ≤ 100 ms phone, ≤ 50 ms desktop | PvF ✓; MP 121 / 187 ✗ |
| long tasks >50 ms during a transition | ≤ 1 | 0–3 |

## 9. What would prove each cause wrong

1. MP hand boundary: a production match whose `hand:ready` ack is under about 150 ms, or a production `/healthz − /ping` under 50 ms measured from Render's region.
2. Suspense throttle: a first-time tap that renders in under 100 ms with the chunk cached (the revisit experiment already shows the converse).
3. Cold load: first working tap within 200 ms of paint on a real phone, or the preloaded review chunks absent from the home page's critical path.
4. Daily: `next-hand` already resolved before the reveal closes in production (a prefetch hit), or `/start` under 200 ms.
5. Audio stall: under 30 ms on a real iPhone.

## 10. Reproduce

```
node client/scripts/perf/staticServer.mjs client/dist 5401        # after: vite build && node scripts/prerender.mjs
node client/scripts/perf/transitionHarness.mjs --mode load|pvf|daily|mp --profile phone|desktop --base http://127.0.0.1:5401 --out run.json   # --early 1 for first-tap runs
node client/scripts/perf/analyzeTransitions.mjs run.json > run.summary.json && node client/scripts/perf/viewTransitions.mjs run.summary.json
node client/scripts/perf/placementTail.mjs run.json 0 100 · probeDrawCover.mjs · loadDetail.mjs · earlySummary.mjs · bundleTransitions.mjs
```
