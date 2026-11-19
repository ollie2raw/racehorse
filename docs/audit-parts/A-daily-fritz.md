# Audit part A: Daily Fritz integrity (2026-11-17, read-only)

Scope: PR #508 (next hand requested during the reveal) and PR #517 (checkpoint 12 s window, retry, flush on hide/pagehide/unmount), plus the server routes they call: `/start`, `/checkpoint`, `/next-hand`, `/record-game`, `/complete`, and the leaderboard predicate.
Method: pre-mortem, scenario walk-through, one tests-only proof file. No production code was changed. No dev server, browser or perf run was used.

Labels: **confirmed** means proven by a test run here or by an unambiguous code path (cited). **Read from code** means traced by reading, not executed. **Guess** means plausible but not traced to the end.

Tests-only file added (the lead decides whether to commit it):
`server/src/dailyFritzDealPredictability.audit.test.ts`. It passes (2/2, `nice -n 19 npx vitest run src/dailyFritzDealPredictability.audit.test.ts` from `server/`).

---

## Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| A1 | **Critical (design)** | Every deal for every date, including Fritz's hidden tiles and the boneyard order, can be computed from the public date string. The Fritz policy is deterministic and ships in the client. So a modified client can solve the set offline (even days ahead) and submit a transcript that verifies and ranks. | confirmed (test) |
| A2 | High (design) | Save-scumming: a hand can be replayed until it goes well. The server keeps no "first attempt" record, and the client controls whether checkpoints exist. | read from code |
| A3 | Medium | `/checkpoint` stores client-built match state without checking it. The stale-checkpoint guard is a client-chosen counter. That is safe for honest clients and does not touch scores, but the checkpoint is not tamper-evident. | read from code |
| A4 | Medium (unproven) | A whole-row `upsert` on `/checkpoint` (and `/start`) has no revision guard. The attempt lock lives in process memory. If two server processes ever overlap (a deploy overlap or more than one instance), a checkpoint write can roll back a committed hand: index and ledger. That would strand an honest player or force the never-strand fallback, which leaves the run permanently unranked. | read from code; needs production topology |
| A5 | Low | The client treats every checkpoint rejection the same way, so permanent 4xx answers (`hand_mismatch`, `stale_checkpoint`, `revision_mismatch`) are retried 3 times over ~22 s and again on online/hide. The hand-end checkpoint racing #508's early next-hand produces this routinely. | read from code |
| A6 | Low | The INV-13 "score writes go through the verifier" gate is a text heuristic. It passes any file that contains the substring `verif`. | read from code |
| A7 | Low (docs) | A comment in `dailyFritzCheckpointUnload.ts` says the local snapshot restores lost progress on the same device. Resume reads only the server checkpoint. | confirmed (code) |

Questions asked by the lead, short answers:

- **Forge a hand score?** No. Hand scores come from replaying the transcript against the server's deal. The hand-start score comes from the previous verified receipt. Client `completed_hand_scores` are used only on paths that mark the run `rejected` (`dailyFritzNextHandRoute.ts:356-360, 228-236`; `dailyFritzVerificationGlue.ts:106-140`). Ranking requires `verification_status === 'verified'` and an empty `unverified_hands` list (`dailyFritzStore.ts:836-855`). Finalize never promotes a rejected run (`dailyFritzAttemptFinalize.ts:57-63`). Read from code.
- **Forge Fritz's moves?** No. Each Fritz action must equal the pinned policy's decision. Policy v3 is exact (`dailyFritzVerifier.ts:155-179, 461-471`). New attempts can only pin v3: `supportsVerifier` requires `requestedFritz === FRITZ_POLICY_VERSION` (`dailyFritzStartRoute.ts:117-121, 152-158`). Refuted that a client can choose the lenient v1/v2 tie rule for a new attempt. Read from code.
- **Replay, reorder or skip a hand?** Skip and reorder: no. `completed_hand_index` must equal the server cursor, and anything else gets 409 (`dailyFritzNextHandRoute.ts:127-130, 310-335`). The game number must be current (`:113-116`). A transcript replay with the same digest is idempotent; a different digest gets `verified_hand_conflict` (`:263-309`). One attempt per user per date (`dailyFritzStartRoute.ts:135-140`). Replaying a hand *before* submitting it (save-scum) is possible: see A2.
- **What does the server verify vs trust?** Verified: the full transcript against the server deal, policy and contract pins, the state-digest chain, hand-start scores from the ledger, terminal state, and game scores against the receipts (`hasCompleteDailyFritzGameAuthority`, `dailyFritzVerificationPolicy.ts:229-241`). Trusted: checkpoint contents (A3). Never checked: timing. There is no minimum hand duration and no wall-clock plausibility check. Combined with A1, nothing distinguishes a solved line from a played one.
- **Can #508's early request send an incomplete transcript and sticky-reject an honest player?** The guard is sound as written, read from code. The early request goes out only if the screen state has `handOver`, a non-empty official journal, no `gameOver`, and a transcript that built without error (`useHandLifecycle.ts:801-816`). The advance-time path builds from the same `matchRef` with the same builder, so the early body cannot be less complete than the body that was always sent (`useHandLifecycle.ts:408-420`). A bad transcript is *not* refused by the server: any non-infrastructure verifier code advances the run as `rejected` (`dailyFritzVerificationGlue.ts:89-95`, `dailyFritzNextHandRoute.ts:367-403, 455-483`). So the guard is the only protection. The mutation run in part F confirmed that the `handOver` and `gameOver` guards are each pinned by a test. **Unproven:** whether `officialJournal` can be non-empty and `handOver` true while the journal still lacks the last command. The code says they are written by the same engine command (`gameCoreAdapter.ts:64`). Not tested on device.
  - Side note: the client's `incomplete_transcript` and `wrong_actor` rebuild-and-retry branches (`useHandLifecycle.ts:503-520`) are effectively dead for a protocol attempt that sends scores. The server answers those codes with a 200 unverified advance, not an error. Read from code.
- **Can a retry produce a sticky rejected state for an honest player?** Only through the infrastructure code `missing_hand_start_progress`. The server refuses it with a 409 until the client sends `unverified_fallback` with `verification_attempts >= 2` (`dailyFritzVerificationGlue.ts:72-95`). The client sends that after 2 failures, and the run is then `rejected` for good. That code fires only when the ledger has a gap, which is what A4 would cause.
- **Can a stale checkpoint overwrite a newer one?** Not for an honest client in one process. The server requires the same hand index and authority revision, and `checkpointRevision` must be strictly greater than the stored one (`dailyFritzCheckpointPolicy.ts:187-206`). `/next-hand` clears the checkpoint (`dailyFritzNextHandRoute.ts:489`), so a delayed post from hand N is refused with `hand_mismatch` after the advance. The client drops a pending snapshot once a newer revision is confirmed (`useDailyFritzSessionPersistence.ts:93-96, 117-118`). A beacon racing a window post can arrive out of order. The older one then gets 409, which is harmless. Across processes, see A4.
- **Crash or offline at each step:** see the table at the end.
- **Do score writes go through the verifier (AGENTS.md)?** Yes for ranking: only receipts produce `verified`. Client scores are persisted only into `active_game` and `unverified_hands` on paths that set `rejected`. The architecture gate that checks this is weak (A6).

---

## A1. Critical (design): deals are predictable from the date alone

**Evidence (confirmed).**
- `server/src/dailyFritz.ts:75-81`: `getDailyFritzSeed(runDate)` returns `` `daily-fritz-${runDate}` ``. The game seed is `` `${seed}:game:${n}` ``. There is no server secret.
- `server/src/dailyFritz.ts:252-268, 270-290`: every hand is `createDeterministicDoubleSixDeal({ seed: `${gameSeed}:hand:${i}` })`. The published-challenge path enforces the same seed (`dailyFritzPublishedChallenge.ts:161-187`).
- `createDeterministicDoubleSixDeal` comes from `@racehorse/game-core` and is bundled into the client (`client/src/modules/match/runtime/botEngine.ts:22, 278`).
- The deal, including `fritz_tiles` and the boneyard order, is also sent to the client in `/start` `first_hand` and in every `/next-hand` `hand` (`dailyFritzStartRoute.ts:333, 398`; `dailyFritzNextHandRoute.ts:143-181`).
- The Fritz policy is a pure function (v3), it is server-verified, and it ships in the client bundle (`dailyFritzVerifier.ts:164-168`).
- Proof: `server/src/dailyFritzDealPredictability.audit.test.ts` reproduces a 2027 deal (game 1 hand 0, and game 3 hand 15) from the date string with game-core alone. It passes.

**Repro.** `cd server && nice -n 19 npx vitest run src/dailyFritzDealPredictability.audit.test.ts`.

**Impact.** A motivated player (or a shared script) can enumerate their own move choices against a fully known, deterministic opponent and deck, and submit the best line found. It verifies, so it ranks. This works for any future date, so a solution can be ready before the day opens. Nothing in the verifier can detect it, because the line *is* legal. Every honest leaderboard position is at risk once one person automates this.

**Suggested fix (needs a product decision; no change made).**
1. Add a server-held secret to the seed (`HMAC(secret, date)`). That stops pre-computation and stops anyone deriving the deal from the date.
2. Stop sending `fritz_tiles` and the boneyard order to the client. Reveal draws one tile at a time, and Fritz moves from the server. This is the real fix for "solve during play", but it is a large architectural change: the client engine currently runs the whole hand locally.
3. Short of that: add plausibility signals (hand duration, perfect-play rate against an oracle) as review flags, not hard gates.

## A2. High (design): save-scumming a hand

**Evidence (read from code).** The server cursor moves only on `/next-hand`. A reload resumes from `resume_checkpoint` if one is stored, otherwise the hand restarts from the deal (`resolveDailyFritzSession.ts:13-37`; `dailyFritzCheckpointPolicy.ts:208-221`). The client chooses whether and what to checkpoint. A player who blocks `/api/daily-fritz/checkpoint` (devtools request blocking), or who goes offline mid-hand and then force-closes, can replay the hand as often as they like and submit only the best transcript. Draws reveal boneyard tiles on the first try, so each retry is better informed.

**Did #517 change this?** Not materially. Offline posts were dropped before #517 as well. The new 12 s window would add an online way in (kill the process with no hide event), but on mobile the OS normally fires `visibilitychange` before a kill, and that now flushes. Guess: the window does not widen the practical exploit for a non-technical player.

**Impact.** It compounds A1. A ranked score can be a best-of-N.

**Suggested fix.** Record server-side when each hand is first dealt and how many times a hand-start was served (`/start` and resume). Flag or unrank attempts that restarted a hand without a checkpoint. Without hiding the deal (A1, item 2) this can only be detected, not prevented.

## A3. Medium: checkpoint contents are trusted as stored

**Evidence (read from code).** `parseDailyFritzServerCheckpoint` validates shape only: tile ranges, phases, `handNumber === currentHandIndex + 1` (`dailyFritzCheckpointPolicy.ts:113-175`). `match` (hands, boneyard, scores), `officialJournal`, `moveLog` and `transcript` are stored as sent. `checkpointRevision` is client-chosen, so a client can always "rewind" by posting an old state with a higher revision.

**Impact.** Integrity is unaffected: the hand-end transcript is re-verified from the server deal, and a tampered resume state fails verification, which makes the run `rejected`. The checkpoint is therefore a convenience, not evidence. The risk is future code that treats it as authoritative. For example, a review or recovery feature that reads `active_checkpoint.match.players.*.score` would trust unverified data.

**Suggested fix.** Document `active_checkpoint` as untrusted in the type. Optionally store a server digest of the journal prefix, replay-verified on write. The cost is CPU on every checkpoint.

## A4. Medium (unproven): lost update between processes

**Evidence (read from code).**
- `withDailyFritzAttemptLock` is a `Map` in process memory (`server/src/dailyFritzAttemptLock.ts:1-24`).
- `/checkpoint` reads the attempt, then calls `upsertDailyFritzAttempt` (`dailyFritzCheckpointRoute.ts:52-76`). That is a PostgREST `merge-duplicates` upsert of the *whole row*: `current_hand_index`, `result` (including the authority ledger), and `revision` unchanged (`dailyFritzStore.ts:266-291, 636-652`). There is no `revision = expected` predicate, unlike the transactional RPC (`supabase/migrations/2026-08-01_daily_fritz_transactional_commands.sql:344-345`).
- `/start` also upserts without taking the lock (`dailyFritzStartRoute.ts:301, 317`). That happens only on first entry, when the contract or `verifiedMatchId` is missing.

**Scenario.** Process P1 serves `/checkpoint` (reads hand N, revision R). Process P2 commits `/next-hand` (hand N+1, revision R+1, receipt for N). P1 then upserts its stale row, which reverts the hand index to N, drops the receipt, and resets the revision to R. The client's next `/next-hand` for N+1 gets 400 "ahead of the persisted attempt". On recovery, a later hand can hit `missing_hand_start_progress`, and after 2 tries the client sends `unverified_fallback`. **An honest run then becomes permanently unranked.**

**When it can happen.** Only with two live server processes. The ops docs assume exactly one Render instance (`docs/ops/senior-audit-rating-rush-cutover.md:202`). Whether a deploy overlaps old and new processes on the current plan is **unproven** and needs a production check.

**Suggested fix.** Write the checkpoint with a conditional update (`revision=eq.R`, or a dedicated `active_checkpoint` column or RPC) instead of a whole-row upsert. Do the same for the remaining `upsertDailyFritzAttempt` callers on a live attempt.

## A5. Low: permanent checkpoint rejections are retried like offline failures

**Evidence (read from code).** `saveDailyFritzCheckpoint` returns `null` for any error, 4xx included (`client/src/dailyFritz/api.ts:432-454`). `postPendingCheckpoint` then keeps the snapshot and retries after 2 s, 5 s and 15 s (`useDailyFritzSessionPersistence.ts:115-125`). The `online` and hide events re-post it too. The hand-end checkpoint is posted at hand end, and #508's early `/next-hand` follows about 2 s later. If the checkpoint post is slow or retried, it lands after the advance and gets 422 `hand_mismatch`, up to 4 times.

**Impact.** Wasted requests only; each one costs a whole-match body (~40-90 KB per the #517 numbers). A real `revision_mismatch` also fails silently for a whole hand, so there is no resume point and no signal. That predates #517.

**Suggested fix.** Treat 409 and 422 from `/checkpoint` as final: drop the pending snapshot, and for `revision_mismatch` log a telemetry event.

## A6. Low: INV-13 is a substring heuristic

**Evidence (read from code).** `client/scripts/checkArchitectureInvariants.ts:908-940` flags a `dailyFritz*.ts` route file that matches `req.body.<..score|result..>` only if the file *also* lacks `/verif/i` anywhere. Any import such as `dailyFritzVerificationGlue` satisfies it. It cannot tell whether the scores read reach a ranked field.

**Suggested fix.** Add a behaviour test instead. For each mutating route, POST inflated `completed_hand_scores` or `player_score` with a valid transcript, and assert the ledger and `final_score` equal the replayed values. Some `dailyFritzVerifierGate*.test.ts` files may cover parts of this already; not checked in full.

## A7. Low (docs): the comment says a local snapshot restores lost progress

`client/src/dailyFritz/dailyFritzCheckpointUnload.ts:6-8` says the local snapshot "still restores it on the same device". `useBotMatchBootstrap.ts:76-89` discards the local snapshot and seeds it from the server (`resolveDailyFritzSession` reads only `resume_checkpoint`). The PR #517 description agrees with the code, not the comment. **Impact:** the 12 s loss window on a crash with no hide event is real on every device, not only a new one. Fix the comment.

---

## Crash or offline at each step (read from code)

| Moment | What is durable | What a resume does |
|---|---|---|
| Mid-hand, no hide event (OS kill, power) | The last window post (≤12 s old) or the last flush | Resumes at that checkpoint. Later moves are replayed by the player. Fritz is deterministic, so the outcome is the same if the player repeats the moves. |
| Mid-hand, offline | The last post before going offline | The same. Pending posts retry 3 times, then on `online` or hide (`useDailyFritzSessionPersistence.ts:356-366`). A beacon sent offline is probably lost. |
| Hand end, before the reveal | The hand-end checkpoint (`hand_transition`) if its immediate post landed | Replays the reveal, then calls `/next-hand`. |
| Reveal up, early `/next-hand` committed, response lost | Server at N+1 with the receipt; checkpoint cleared | Starts hand N+1 fresh. A retry with the same digest gets `replayed`. |
| Early `/next-hand` failed (network) | Server at N | Advance rebuilds and re-sends (`handLifecycleRules.ts:194-211`). |
| Game-ending hand | `/next-hand` returns 409 and persists the receipt and progress (`dailyFritzNextHandRoute.ts:405-453`); the early request is skipped for `gameOver` | `/record-game` reuses the receipt (`dailyFritzRecordGameRoute.ts:205-245`). |

## Unproven: needs a device or production

1. Whether Render overlaps two server processes during a deploy on the current plan (A4).
2. iOS/WebView: whether `visibilitychange` → `sendBeacon` with the token in the body is delivered on app-switcher kill. This decides whether the 12 s window loses moves in practice.
3. Whether `handOver === true` with a non-empty journal is *always* complete on a real device under load. This is the one remaining hole in #508's guard.
4. Production rates since #508 and #517: `advance_unverified` and `verification_failed` events by verifier code, and the share of `rejected` attempts. The queries are in `docs/daily-fritz-early-next-hand-rollout.md`. They were not run, because this audit had no production access.
5. Whether anyone is already exploiting A1 or A2. That needs a review of top leaderboard transcripts against an oracle.
