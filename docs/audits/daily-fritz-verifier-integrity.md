# Daily Fritz verifier & transcript integrity pass

Branch `audit/daily-fritz-verifier-integrity`, from candidate `ba3b3e75`. Scope: the verification/reconstruction pipeline only.
Closed and untouched: core engine rules (proven separately by the engine oracle), realtime, ratings, room persistence, identity/RLS,
iOS lifecycle, CI. No deploy, no migration.

**Property proved:** a Daily Fritz submission verifies if and only if it corresponds to one valid authoritative execution of the
published deal under the pinned policy; reconstruction cannot invent, omit, reorder or reinterpret gameplay in a way that changes the result.

## 1. Pipeline

```
client engine (applyGameCommand, one command per play / draw-tile / pass)
  -> officialJournal (appended inside the same state transition)          client/src/modules/match/runtime/gameCoreAdapter.ts
  -> buildDailyFritzTranscript (journal verbatim; legacy move-log only for pre-journal attempts)
  -> POST /next-hand (non-terminal hands) | /record-game (terminal hand)
server: auth -> attempt by (id, authenticated user) -> run by attempt.runDate -> (published challenge overrides deal/tier/score/size)
  -> verifyAttemptHand: seed + challenge id re-derived from the date; hand-start scores from the verified ledger (never the client);
     deal from run/published authority; draw winner derived; createOfficialDailyFritzHandState
  -> verifyDailyFritzHand: strict parse -> identity/policy-pin/digest checks -> replay on the authoritative engine
  -> result derived ONLY from the replayed terminal state (claimed scores are compared, never trusted)
  -> verified: ledger `authority.hands` (+ transactional command store when the attempt has a challenge)
     failed:   typed error, or the documented never-strand "unverified advance" (sticky `rejected`, unranked)
```

Authoritative inputs the client cannot influence: seed/deal, draw winner and starter, tier, winning score, deal size, hand-start scores,
attempt owner, pinned policy version (a new attempt can only be created by requesting the current policy version, otherwise 426).

## 2. Transcript contract

| Action | Client records | Verifier |
|---|---|---|
| human play | yes | applied literally; legality is the engine's |
| human draw | yes, one per tile | applied literally; *omitted* draws before a play/pass are reconstructed (draw while `canDraw`, which is only true with no legal play and a drawable tile, stopping at the first playable tile) |
| human pass | yes | applied literally; never reconstructed (an omitted player pass is rejected) |
| Fritz play | yes + pre-action digest | must be the official selection (v3: exact; v1/v2 historical: any top-score play) |
| Fritz draw / pass | yes + digest | applied literally; omitted draws and one omitted Fritz action are reconstructed from the pinned policy |
| post-score forced-draw chain | **no, by design** | the engine absorbs it (and an embedded pass) inside the `play` command; the verifier's engine reproduces it |
| turn change, pass counting, blocked/go-out resolution, scoring, game over | no | derived by the engine |
| hand boundary / next-hand starter | `handIndex`, `gameNumber` | bound to the expected values; starter derived from hand parity |

**Why omission is safe, and unique.** Draw order is the boneyard order of the published deal; the number of draws is fixed by the rule
(draw until a play exists or the drawable boneyard is exhausted); a pass is legal only after exhaustion. The suite searches every possible
draw count before every action of every reduced transcript with the rules oracle applied literally: **exactly one valid hand and one
outcome in 1,800 of 1,800 reduced transcripts**.

## 3. Findings

| ID | Sev | Finding | Fix |
|---|---|---|---|
| F1 | **V0** | The verifier accepted *any* top-score Fritz play. Fritz ties are common (about one non-equivalent tie per hand). A modified client could pick the tied branch that suited the player, offline, and submit it as a *verified*, leaderboard-eligible hand. Measured by forking every tie and replaying each fork through the real client path. Before the fix: **all 167 alternative Fritz plays forked from 152 hands verified** (34 ended with a different final score, 3 with a different winner; e.g. Fritz opens 2\|3 instead of the official 1\|4 and the hand ends 16-49 instead of 11-74). After the fix, across 1,800 hands: **all 3,845 alternatives rejected**, of which 2,013 were non-equivalent ties (438 = 22% with a different final score, 51 = 2.5% with a different winner) | policy v3 now requires the *exact* official selection. v1/v2 historical evidence (seeded-RNG / locale tie-breaks that cannot be re-derived) keeps the top-score rule |
| F2 | V1 | Omitting a Fritz action, then a player *draw*, was rejected `post_play_recovery_draw`: the one-omitted-Fritz-turn recovery never updated the verifier's "previous command was a play by this actor" tracker, so a valid transcript was refused in exactly the case the recovery exists for | the recovery reports what it applied and the tracker follows it |
| F3 | V1 | Finalizing a rejected run (and recording a later game with no transcript) rebuilt `attempt.result` without `unverified_hands`, so a rejected run became **streak-eligible** (the streak predicate trusts that ledger) | both rebuilds carry `unverified_hands` forward; the transcript-less path also keeps the sticky `rejected` status |
| F4 | V1 | `record-game` published the **client-claimed** result to friends' activity feeds for score-only and rejected games (any user could post "won 150-0") | the feed is written only from a verifier-derived receipt |
| F5 | V1 | A game recorded with no evidence on a protocol-pinned attempt became an anonymous `legacy_unverified` finish and earned streak credit on a fabricated score | recorded in `unverified_hands` (`missing_transcript`) on both `record-game` and `next-hand`; pre-protocol attempts unchanged |

Each fix has a failing-before / passing-after test (negative controls were run by disabling the fix).

## 4. Evidence (reproducible, seeds `daily-fritz-verifier-v1:<n>` and `daily-fritz-verifier-v2:<n>`)

Suite: `server/src/dailyFritzVerifierIntegrity.property.test.ts` (47 tests) over the harness `server/test/support/dailyFritzVerifierOracle.ts`.
`DF_VERIFIER_HANDS` (default 48, CI-sized) and `DF_VERIFIER_SEED` select the corpus; a failure prints the spec id to replay.

Independent of the code under test: the rules oracle (`engineOracle.ts`), a from-the-formula **re-implementation of the Fritz policy**, and an
independent **judge** that decides, from the rules alone, whether a transcript is a valid execution. Real: the client engine + journal +
transcript builder, and `verifyDailyFritzHand` / `verifyAttemptHand` / the routes.

- Honest three-way differential (oracle = real client path = real verifier = lockstep engine): winner, scores, hand scores, action order, final
  sequence, board, hands *in draw order*, boneyard consumption, terminal reason, terminal state digest.
- Omitted draws (every / human-only / Fritz-only / last-of-run / mixed): identical terminal state; a pass substituted for a draw chain is rejected.
- Omitted single Fritz action (play/draw/pass followed by a player play/draw/pass): identical terminal state.
- 24 one-at-a-time tamper kinds (remove, duplicate, reorder, change tile/placement, claim a tile not held, add impossible pass/draw, flip actor,
  truncate, append after terminal, change hand/game/challenge/attempt, break sequence, unknown fields; plus 3 non-semantic kinds that must verify identically).
  Every outcome agrees with the independent judge: no false accept, no false reject, no untyped crash.
- Versioning: 19 rejected shapes (newer protocol/policy/digest versions, unknown fields/kinds, bad tiles/placements, oversize) and sparse/older shapes
  that still verify; historical policy v1/v2 transcripts verify; an unpinned digest version is read as v1 and v2 digests do not silently pass.
- Determinism: same state => same decision (repeat, deep clone, hand permutation); verification reads neither `Math.random`, `Date.now` nor `performance.now`.
- Ownership: a valid transcript for challenge A is never accepted for B (as submitted, or relabeled and confirmed by the oracle); wrong attempt id, seed,
  tier and hand index are refused; a failed verification leaves the attempt untouched.
- Atomicity (real `next-hand` route, real generated hand): a refused verification persists nothing; an honest retry then advances once and replays idempotently;
  the never-strand path advances but stays sticky-unranked (not verified, not leaderboard- or streak-eligible).

## 5. Deferred

- **V2** a partially-omitted *Fritz* draw run that still carries digests is rejected (fail-closed; the journal never produces it).
- **V2** exactly one omitted Fritz action is recovered; a multi-action omitted Fritz turn fails closed (the journal never produces it).
- **V2** an attempt with no stored contract takes its policy version from the transcript. New attempts cannot reach that state (the start route pins the
  current version), so it is not reachable for attempts created by the current server; consider pinning explicitly if legacy attempts are ever replayed live.
- **V2** by the documented never-strand policy an unverified run's *claimed* scores still appear in that player's own history/personal stats (off the leaderboard,
  streak and feed).
- **V3** the ledger fields `winner` / `pointsAwarded` are labels derived from score deltas (nothing authoritative reads them; the scores are the truth).
- **V3** the state digest is a 32-bit FNV fingerprint; it is a drift detector, the replay is the authority.
