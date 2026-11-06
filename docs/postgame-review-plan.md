# Post-game review: from "Analyzing… Unavailable" to chess.com's Game Review

2026-11-06. Written with the fix for the failure the owner hit (Play vs Fritz, Victory 67-23: "Analyzing 0 / 44 decisions", then "Unavailable"). Phase 0 is in the same PR; phases 1 onward are proposals for the owner to order.

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
- **Tournament**: rooms are deliberately never saved (`saveMultiplayerRecord` returns `tournament_room`), so there is nothing to review. Offering it means saving tournament games: a product and privacy decision (section 8).

## 8. Decisions for the owner

1. **Turn `REVIEW_SWEEP_ENABLED=true` on Render now?** The worker-isolation fix (#320, event-loop watchdog) is merged, so the 10-01 outage cause is addressed; the risk is capacity on a free instance. Recommended: yes, watch `/ping` and the event-loop lag log for a day. Until then every Play vs Fritz review shows "switched off right now".
2. **Allow a device-computed "Quick review" labelled non-authoritative?** Production forbids it today. Recommended: yes, as the player's private view (it is what makes instant review possible).
3. **Should tournament games be saved for review?** Needs a retention and storage decision.
4. **Retention**: how long to keep per-game review records (storage is free-tier bound).
5. **Depth budget on the device**: cap per move so a low-end phone stays cool.

## 9. Phases (one PR each, with an acceptance test)

| Phase | Change | Acceptance |
|---|---|---|
| 0 (this PR) | Failure is honest and checkable: the job route says why (`sweep_disabled` or `failed`), `/health` shows `reviewSweep`, the prompt stops offering a retry that cannot work, the server logs each job accepted while the sweep is off, the client logs the reason | Unit tests on the route, `/health` and the prompt; fail on the old code |
| 1 | Turn the sweep on in production (owner step) and prove a full real game reviews end to end; add a timing log per job so the 8 to 97 s figure is tracked | After a real Play vs Fritz game, `/health` says `reviewSweep: true`, the job completes, and the log shows its duration |
| 2 | Device first pass during play (web worker, tier 1 per captured decision, cached by `positionHash`) so Review opens at game over with every decision classified | Playwright plays a game to the end; Review opens within 1 s with all non-forced decisions classified and no review network call needed |
| 3 | Progressive upgrade: the server job (or deeper device tiers) replaces first-pass results in place; "Depth upgrading n / N"; a label never jumps by more than the second-opinion rule allows | Test: a late result changes a badge at most one step and never reorders the move list |
| 4 | Review board parity: advantage graph, key moments, best-move arrows, step through; split into two or three PRs | Reachability e2e at desktop and phone; axe-clean; the graph's text equivalent present |
| 5 | Keep it: save the record (signed-in), list it on the Games page, reopen any time | Reload and reopen from Games shows the same review |
| 6 | Same reviewer for Daily Fritz and multiplayer; tournament per decision 3 | One review component, three entry points, one test each |

## 10. Risks

- **Capacity on the free instance** once the sweep is on (single search thread, 8 to 97 s per game): mitigated by device-first (phase 2) and the queue discipline (newest game first, stale jobs dropped).
- **Long-tail positions** (tier 2 is 120 s, tier 3 is 600 s per decision, a forced position once took 39 s before the forced fast path): the device pass uses tier 1 only; deeper tiers are background and optional.
- **A device result and a server result disagreeing**: the server wins; the label and the second-opinion softening keep the change small.
- **Phones**: battery and heat; budgets per move and pause when the tab is hidden.

## 11. What was measured for this plan

`npx tsx packages/review-engine/src/devtools/measureReviewPositionCost.ts 6` on the fixture corpus (simple, mostly endgame positions), production completion settings: median 4 ms per decision, max 502 ms (one tier-2 decision), 586 ms for six. These fixtures are not representative of a full midgame, so the planning figure stays the measured 8 to 97 s per game from `useReviewStartTrigger.ts`; Phase 1 adds a per-job timing log so the real number is tracked in production.
