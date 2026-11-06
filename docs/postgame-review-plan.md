# Post-game review: from "Analyzing… Unavailable" to chess.com's Game Review

2026-11-06. Written with the fix for the failure the owner hit (Play vs Fritz, Victory 67-23: "Analyzing 0 / 44 decisions", then "Unavailable"). Phase 0 is in the same PR; phases 1 onward are the proposed order, with the owner's five open questions decided in section 8.

## 1. Why it fails today (verified in code, not guessed)

When a signed-in Play vs Fritz game ends, the client sends the player's decisions to the server (`POST /api/review-completion-jobs`) and polls the job. In production the server is the only thing that evaluates them; the browser worker path is deliberately off ("an HTTP outage cannot publish subset analysis as authoritative", `usePostGamePivotalReview.ts`).

`server/src/reviewCompletion/reviewCompletionWorker.ts` answers every poll with `unavailable: !complete && (status === 'failed_fatal' || !isReviewSweepEnabled())`. `isReviewSweepEnabled()` is true only when `REVIEW_SWEEP_ENABLED` is exactly `"true"`. That flag is the kill switch added on 2026-10-01 after the review sweep blocked the event loop (#318); with it off, jobs are accepted, nothing ever runs them, and the first poll says "unavailable". The screenshots match: 0 of 44 never moves (nothing is running the job), then "Unavailable" on the first poll. An existing test (`reviewCompletionWorker.integration.test.ts`, "reports unavailable while the sweep is switched off") pins exactly this behaviour; it is by design, not a crash.

What I could not do: read Render's environment. So this is the best explanation, not a confirmed fact. The fix below makes it checkable in one request: `curl https://racehorse.onrender.com/health` now includes `"reviewSweep": true|false`. If it says `false`, that is the cause. A job that really failed (`failed_fatal`, after five claim attempts) shows the same "Unavailable" text; the UI could not tell the two apart, which is the real defect, and Phase 0 fixes it.

## 2. What chess.com does, and what Racehorse lacks

chess.com Game Review: the moment a game ends, Review opens at once on the whole game: accuracy % for each side, a count of each classification (Brilliant, Best, Good, Inaccuracy, Mistake, Blunder), an evaluation graph, every move classified with the engine's best alternative and a short reason, key moments to jump to, and you can step through every move. It never shows "analyzing" for a minute and then gives up; it fills in.

| | chess.com | Racehorse today |
|---|---|---|
| Starts | Analysis is cached/streamed so review is immediate | Job requested 5 s after game over, or when the player opens a review (`useReviewStartTrigger`), then waits for a sweep tick (15 s) |
| Time to first result | ~seconds | 8 to 97 s of server CPU per game (measured, per a comment in `useReviewStartTrigger.ts`), one decision at a time on one thread, with tiers that can reach 120 s (tier 2) and 600 s (tier 3) per decision |
| On failure | Retries invisibly | "Unavailable", and the cause was not visible |
| Persistence | Review any time later | Result is shown only while the post-game screen is open (the job result is not kept for later) |
| Review UI | Graph, key moments, best-move arrows | Per-move review with explanations exists (95.3% of differing moves get an explanation on the production path, `review-production-explanation-coverage-2026-11-02.md`), no graph, no key-moment navigation |

What Racehorse already has and can build on: the review engine and its tiers, the second opinion that softens a label that conflicts with the whole hand (#471/#472), saved review records for multiplayer (3.9) and Daily Fritz (#473 to #479), and a Games page that lists and opens saved games.

## 3. Design principles

1. **Analysis starts during the game, not after.** Every one of the player's decisions is captured live (`reviewSnapshotRecorder`); the position is known the moment the player plays. The opponent's turn and Fritz's animation give seconds of idle time per move. A game is about 40 decisions; spread across 20 minutes of play, a tier-1 pass (2 s cap, a few ms on simple positions) is invisible.
2. **The review opens instantly with what is ready, and fills in.** At game over every decision already has a first-pass verdict; deeper tiers upgrade it in the background. The screen says how much is deeper-checked ("Depth upgrading 32 / 44"), never "Analyzing" with nothing to look at.
3. **Cache by position, not by game.** The review engine already hashes positions (`positionHash`); the same position evaluated once is reused (retries, rematches, the second opinion).
4. **Honest about authority.** A browser-computed result is the player's own private review: labelled, not shareable. The server's durable result replaces it when it arrives. The existing shareability gate in review-engine already refuses non-authoritative data.
5. **Cost-bounded.** No pre-launch spend, a free Render instance, and an event-loop outage history (2026-09-30, 10-01). Work moves to the player's device first; the server job is the upgrade, behind the kill switch, never the first thing the player waits on.
6. **Hidden information is part of the story.** Racehorse is not perfect-information: "best move" is the best against what the player could know. Say so in the copy ("based on what you could see") so a classification does not read as hindsight.

## 4. Where it runs

| Option | For | Against |
|---|---|---|
| Browser web worker, during play (first pass) and after (deeper tiers) | Free; instant; uses idle time; no server load; works offline | Result is the player's own claim (not shareable/authoritative); weaker phones need budgets and battery care |
| Server queue (today) | Authoritative; durable | One thread; 8 to 97 s per game; at ten simultaneous finished games the queue is ~15 minutes; the outage history; a free instance |
| Hybrid (proposed) | Instant first pass on the device, server job upgrades and persists | Two code paths to keep consistent (they already share review-engine) |

Proposal: hybrid. The browser worker produces the first pass during play and opens the review at once, labelled "Quick review"; the server job is requested at game end as the authoritative upgrade and the durable record, behind `REVIEW_SWEEP_ENABLED`.

## 5. Data model

One versioned saved game record per reviewed game, the format multiplayer and Daily Fritz reviews already use (you / opponent decisions, forced passes dropped, draws folded): per decision `{ decisionId, positionHash, played, candidates, evaluation, tierReached, provenance: 'device' | 'server', classification, explanation }`, plus per-game accuracy and counts. A device result is overwritten by a server result for the same `positionHash` (never the other way). Stored for signed-in players only (guests keep it in the browser). Retention needs a decision (section 8).

## 6. Screens

- **Result card** (what the owner saw): accuracy %, grade, classification counts, and an immediate Review Game; never a dead end. Failure copy names the cause; Analyze again only where it can work (Phase 0).
- **Review board**: move list with a classification badge per move; step through every move; per-move explanation and the best alternative with an arrow on the board; an advantage graph (race-score swing per hand); key moments (largest swings) as jump links; accuracy and counts at the top.
- **Mobile**: the board and the move list as two tabs or a bottom sheet; every control a 44 px target; no accidental page scroll (AGENTS section 6).
- **Accessibility**: classifications by word and icon, never colour alone; the graph has a text equivalent (the key-moment list).

## 7. Other modes

- **Daily Fritz**: already reviewable (#473 to #479); move onto the same reviewer and first-pass path so it behaves identically.
- **Multiplayer (quick and private)**: records exist (3.9); same reviewer.
- **Tournament**: rooms are deliberately never saved today (`saveMultiplayerRecord` returns `tournament_room`), so there is nothing to review. Decided (section 8, decision 3): save them once the match is complete, in Phase 6.

## 8. Decisions (2026-11-06, decided by delegation)

The owner delegated these five; each is decided.

1. **Sweep: ON now.** `REVIEW_SWEEP_ENABLED=true` on Render (worker isolation #320 and the event-loop watchdog are merged). Watch `/ping` latency and the event-loop lag log for a day; if `/ping` degrades the owner flips it back off. The kill switch stays, and Phase 0 makes either state visible (`/health`, the card copy).
2. **Quick review: yes, always provisional.** A device-computed first pass is allowed, labelled "Quick review" everywhere it appears, never written to the authoritative record, never shown as the final accuracy. The server result replaces it when it arrives.
3. **Tournament: yes, in Phase 6 only.** Save a tournament game for review once that MATCH is complete (never while the event is still live for that player's bracket opponents). It needs a server change: `saveMultiplayerRecord` must stop skipping `tournament_room`. Not in earlier phases.
4. **Retention.** Keep every game record (compact). Keep full per-decision evaluations for the most recent 100 reviewed games per player; beyond that drop the evaluation payloads, not the game. Revisit if storage grows.
5. **Device budget.** The quick pass uses a time budget, not the node budget (that one is for deterministic server and test runs): about 40 ms per decision by default and about 3 s of main-thread-equivalent work per game in total, run in a Web Worker, scaled down when the first decisions run slow. Measured with `measureReviewPositionCost.ts` (section 11); the numbers get recorded there as Phase 2 lands.

## 9. Phases (one PR each, with an acceptance test)

| Phase | Change | Acceptance |
|---|---|---|
| 0 (this PR) | Failure is honest and checkable: the job route says why (`sweep_disabled` or `failed`), `/health` shows `reviewSweep`, the prompt stops offering a retry that cannot work, the server logs each job accepted while the sweep is off, the client logs the reason | Unit tests on the route, `/health` and the prompt; fail on the old code |
| 1 | The sweep is ON (decision 1, set by the owner). Prove a full real game reviews end to end and add a timing log per job so the 8 to 97 s figure is tracked; watch `/ping` for a day | After a real Play vs Fritz game, `/health` says `reviewSweep: true`, the job completes, and the log shows its duration |
| 2 | Device first pass during play (Web Worker, a time budget of about 40 ms per decision and about 3 s per game, scaled down when the first decisions run slow, cached by `positionHash`), labelled "Quick review" and never written to the authoritative record (decision 2), so Review opens at game over with every decision classified | Playwright plays a game to the end; Review opens within 1 s with all non-forced decisions classified, the "Quick review" label shown, and no review network call needed; a test that no quick result reaches the saved record |
| 3 | Progressive upgrade: the server job (or deeper device tiers) replaces first-pass results in place; "Depth upgrading n / N"; a label never jumps by more than the second-opinion rule allows | Test: a late result changes a badge at most one step and never reorders the move list |
| 4 | Review board parity: advantage graph, key moments, best-move arrows, step through; split into two or three PRs | Reachability e2e at desktop and phone; axe-clean; the graph's text equivalent present |
| 5 | Keep it: save the record (signed-in), list it on the Games page, reopen any time; retention per decision 4 (full evaluations for the latest 100 reviewed games, the game itself kept) | Reload and reopen from Games shows the same review; the 101st game drops evaluation payloads but stays listed |
| 6 | Same reviewer for Daily Fritz and multiplayer; tournament games saved for review once the match is complete (decision 3: `saveMultiplayerRecord` stops skipping `tournament_room`, never while the event is live for that player's opponents) | One review component, three entry points, one test each; a tournament game is not reviewable until its match is complete |

## 10. Risks

- **Capacity on the free instance** once the sweep is on (single search thread, 8 to 97 s per game): mitigated by device-first (phase 2) and the queue discipline (newest game first, stale jobs dropped).
- **Long-tail positions** (tier 2 is 120 s, tier 3 is 600 s per decision, a forced position once took 39 s before the forced fast path): the device pass uses tier 1 only; deeper tiers are background and optional.
- **A device result and a server result disagreeing**: the server wins; the label and the second-opinion softening keep the change small.
- **Phones**: battery and heat; budgets per move and pause when the tab is hidden.

## 11. What was measured for this plan

`npx tsx packages/review-engine/src/devtools/measureReviewPositionCost.ts 6` on the fixture corpus (simple, mostly endgame positions), production completion settings: median 4 ms per decision, max 502 ms (one tier-2 decision), 586 ms for six. These fixtures are not representative of a full midgame, so the planning figure stays the measured 8 to 97 s per game from `useReviewStartTrigger.ts`; Phase 1 adds a per-job timing log so the real number is tracked in production.
