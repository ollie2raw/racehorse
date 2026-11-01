# Post-game review: a saved game record, then analysis (chess.com model)

Status: **approved by the owner and in progress** (2026-11-01). The analysis engine, accuracy model and coaching prose
are **not** part of this programme and stay as they are.

## Progress and revisions (read this first)

| Phase | State |
|---|---|
| 1 Reliable saving, Analyze again, no raw errors | merged (#398) |
| 2 Save every finished Play vs Fritz game as a server record | merged (#399); owner applies `2026-11-01_game_records.sql` |
| 3 Read the record back and rebuild the game on the client | merged (#400): `GET /api/game-records/recent` and `/:sourceMatchId`, `rebuildGameFromRecord`, `savedGames` |
| 4 Games archive + "Review this game" | merged (#402): "Your games" on Rating History, analyze any saved game on demand |
| 5 The Games page: record at a glance, filters, accuracy and grade per game | merged (#403); server-side join of each game's saved review |
| 6 Multiplayer (then tournaments, Daily Fritz) | designed below; **held until after the first tournament week** (see "Multiplayer: what the code shows") |

## Multiplayer: what the code shows (2026-11-01)

How multiplayer review works today, verified in code:

- The server accepts each move and attaches the V2 review snapshot, so capture is already authoritative
  (`MoveEntry.reviewSnapshot`, `MultiplayerGameShell.tsx`).
- The analysis runs in a **browser worker** (`useReviewWorkerBatch`), not the durable server job Play vs Fritz uses.
- It is saved only for the cohort (`persistMultiplayerReview`), and with no saved game record the game never appears in
  "Your games". A multiplayer game cannot be reopened later.

Why a multiplayer game cannot simply be replayed from what the server stores today: `room_match_logs.events` carries the
actions (`tile_played` with tile and side, `tile_drawn` with the tile, `turn_passed`) but **not the dealt hands**.
`hand_started` carries only the hand number and who is on turn (`rooms.ts`); the deal is random and is never recorded.
Play vs Fritz is replayable because its deal comes from a seed the server issued; multiplayer has no seed.

What a multiplayer record needs, and the care it takes:

1. **Capture the deal at hand start** in a **server-only side structure** on the room (not in the event log: events can
   be served to spectators and on reconnect, and a hand must never travel with them). Written at the two places hands
   are dealt (`startGame`, next hand), including the starter per hand.
2. **Write the record once, at terminal completion**, next to the existing `room_match_logs` archive, one row per human
   participant (so each player's archive has the game). Idempotent per `(user, match)`; a failed write must never affect
   the result, the rating, or a tournament.
3. **Schema:** widen `game_records.mode` to include `'mp'` and add the opponent's display name and user id, plus explicit
   per-hand deals (a multiplayer deal is not derivable from a seed).
4. **Rebuild:** `rebuildGameFromRecord` takes explicit deals as well as a seed; the opponent is a human, not Fritz.
5. **Privacy:** the opponent's dealt hands are stored in the participant's own row. They are revealed only after the game
   is over (the record is written at completion, never mid-game), the same disclosure the post-game screen makes today.
6. **Verification:** replaying the saved deals plus actions must reproduce the server's final state and score; a
   mismatch is stored and flagged, as for Play vs Fritz.
7. **Tournaments are excluded at first** (a different completion path and the highest stakes).

**Why this is held:** items 1 and 2 change the multiplayer authority code (`rooms.ts`, the completion path), which also
runs tournament matches. That code should not change in the days before the first live tournament events (Monday
2026-11-02, 6 pm and 9 pm Eastern). The plan is to ship it after the first tournament week is observed stable, behind a
flag, with a differential test that the replayed final state equals the server's.

Accuracy over time, per-game accuracy and the Games page all work for any mode that has saved records, so multiplayer
will appear in the same archive with no further UI work.

Two assumptions in the original text below turned out wrong, and the plan changed because of them:

1. **"Server writes the review row itself" (old Phase 2) cannot stand alone.** The replay artifact (frozen
   explanations) is built from the browser's move-log analysis, and the review insert is `ignore-duplicates`, so a bare
   server-written row would shadow the artifact. The saved game has to come first; review is derived from it.
2. **"Unranked Play vs Fritz needs a server-issued seed" (old decision 2) is moot.** Every signed-in standalone Play vs
   Fritz game already starts a verified match with a server-issued deal (`/api/bot-matches/local/start`), so nearly
   every saved record is `replay_verified`. Only guests are unsaved.

Phase 3 also settled *where* a saved game is rebuilt. A server-side derivation would need the capture logic, which
lives in the client and cannot be imported by the server build. Rebuilding on the client with the real engine and the
real `ReviewSnapshotRecorder` gives identical snapshots by construction, feeds the existing, proven review pipeline
unchanged, and has no second implementation to drift. A server derivation can still be added later (for background
auto-analysis) behind its own flag if the free instance can afford it.

## The idea in one paragraph

chess.com saves the game itself (the PGN) on the server the moment it ends. Analysis is *derived* from that saved
game whenever it is wanted, cached forever, and reachable from the game archive. Nothing depends on the player
staying on a page, and a failed analysis can simply be run again. We should do the same: **the saved game record
is the source of truth; review is a pure function of it.**

## What is wrong today (verified in code)

1. **Review depends on client-side snapshot capture.** `ReviewSnapshotRecorder` captures a snapshot per decision, in
   memory, best-effort, Play vs Fritz only. Missing capture means a missing review row, and the code has an entire
   "capture failure / fail closed / Unavailable" vocabulary to cope with it.
2. **The browser saves the finished review.** The server computes the evaluations as a durable job, but the client
   builds the artifact and saves it with one fire-and-forget `POST /api/game-reviews` from a React effect
   (`usePostGamePivotalReview.ts`, `postGameReviewWrite.ts`). Close the tab, background the phone, navigate away,
   or hit a transient error, and the finished review is never saved. The error text promises "try again later"
   but nothing retries.
3. **A failed review cannot be re-requested.** Job id is fixed per user and game.
4. **Four different game records, one review pipeline that only understands one.** See the table below.
5. **Review coverage:** Play vs Fritz only (multiplayer is cohort-gated; Daily Fritz and tournaments have none).
6. **Server trusts the client's artifact** (rows are stamped `client-asserted`).
7. **Raw error JSON reaches players** (`{"ok":false,"error":"NOT_FOUND"}` and Social's `not_found`).

## What we already have (the foundation is better than it looks)

| Mode | Authoritative record today | Replayable? |
|---|---|---|
| Ranked Play vs Fritz / Ghost | `verified_single_player_matches.deal_snapshot` + submitted move sequence | **Yes**: `replayRankedMoveLog` (server) replays deal + moves through the engine |
| Multiplayer, tournaments | `room_match_logs` (`events`, `state_snapshot`, archived at completion) | Yes (server event log) |
| Daily Fritz | `daily_fritz_verified_hands` / `_verified_games` (server-verified) | Yes (engine journal) |
| Unranked Play vs Fritz | **none** (client-only) | n/a: the gap |

`replayRankedMoveLog` today only returns the final score. Extending it to also yield **the position before every
decision** gives exactly what review needs, with no client capture at all.

## Target architecture

```
 play ends ──► GameRecord saved (server, idempotent, retried from a client outbox)
                    │   {gameId, mode, seed/deal, rules, moves[], result, participants}
                    ▼
        adapter per mode ──► canonical decision stream
        (verified match / room log / DF journal)   (pre-state, actor, action) per decision
                    ▼
        review job (existing worker + engine, unchanged)
                    ▼
        game_reviews row written BY THE SERVER (server-derived, not client-asserted)
                    ▼
   History / archive: "Review" on every saved game, any time, any device; re-run if failed
```

Principles:

- **Saved first, analysed later.** A game is never lost because analysis failed.
- **Idempotent and retryable everywhere.** Client outbox (survives refresh/offline) → idempotent save by gameId →
  idempotent job by (gameId, engine version). A failed job is re-runnable.
- **Server-owned output.** The server persists the review; the client only reads and renders.
- **One canonical decision stream** so every mode shares one pipeline, one History entry and one UI.
- **Honest states, never raw errors:** Saving / Queued / Analysing 41 of 60 / Ready / Couldn't analyse - Retry.

## Phases (each its own PR, each shippable alone)

**Phase 1: make saving bulletproof (no engine changes; small).**
Client outbox + retry/backoff for the review write; "Couldn't analyse - Retry" that re-requests the job; honest
status copy; replace raw `{"ok":false...}` errors with player-facing states. Fixes today's "errors saving".

**Phase 2: server-owned review persistence.**
When a review job completes, the server writes the `game_reviews` row itself (artifact built server-side from the
job output). The browser no longer participates in saving. Read path unchanged for the UI.

**Phase 3: game record for Play vs Fritz (the foundation).**
Save a GameRecord for *every* Play vs Fritz game (ranked reuses `verified_single_player_matches`; unranked gets a
server-issued seed or a client-reported one stored as `client-reported` and legality-checked by replay).
Extend the replayer to emit per-decision pre-states. Review job derives snapshots from the record; client capture
becomes an optional cross-check, then is removed.

**Phase 4: extend to every mode.**
Adapters over `room_match_logs` (multiplayer + tournaments) and the Daily Fritz journal. History shows Review for all.
Cohort gate on multiplayer review removed once Phase 2 is proven.

**Phase 5: chess.com-level product polish.**
Game archive with filters, review progress and "ready" notification, per-game accuracy trend, shareable review
link, mobile layout for the review screen. Designed from screenshots, one pass at a time.

## Risks and mitigations

- **Free Render instance, one process.** Review jobs ran on the main thread and caused outages (worker isolation
  fixed it). Phase 4 raises job volume (all modes), so Phases 1-3 ship first and we watch event-loop lag before
  widening. Review stays behind the existing `REVIEW_SWEEP_ENABLED` kill switch.
- **Determinism.** Replay must reproduce the game exactly (draw order, hand deals). Mitigation: replay-verify every
  record on save and store a hash; mismatches are logged, never silently accepted.
- **Historical games** keep their current rows and honest "unavailable" notice; no backfill.
- **Schema changes** are additive migrations, owner-applied, applied before the code that needs them.

## Decisions needed from the owner

1. Approve the phasing, and start with **Phase 1 now** (safe before Monday's tournament event)?
2. Unranked Play vs Fritz: server-issued seed (stronger, one extra request at start) or client-reported seed
   (no new request, weaker)? Recommendation: server-issued, same as ranked.
3. Should Daily Fritz and tournament matches get Review in Phase 4, or only Play vs Fritz + multiplayer?
