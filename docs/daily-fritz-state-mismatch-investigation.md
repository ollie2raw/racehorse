# Daily Fritz `fritz_state_mismatch` — Phase 3 Investigation

**Date:** 2026-08-19  
**Attempt:** `272dd33b-5ef0-4c30-8604-8c82be2ac5b4` (mom, user `889bf1a4-382b-4a18-9cc5-c8fdbe0038b4`)  
**Run:** `2026-08-19` elite tier, game 1 hand 6 (terminal hand, instant skunk 61–27)  
**Production error:** `Fritz state diverged before action 4 (client df-state-v1:c7116bcd, server df-state-v1:3a092a3b).`  
**Status:** Investigation only — no code changes in this pass.

---

## Executive summary

**Root cause:** The client transcript and Fritz state digests were **correct**. The server async verifier rebuilt hand 6 from the **wrong starting scores** (`0–0` instead of `50–23`) because `buildRecordedDailyFritzAttemptResult()` **drops `active_game`** when merging the set-result blob, and `attemptVerifyHand()` reads mid-game progress exclusively from `active_game`.

This is **not** a gameplay cheat, journal timing race, transcript mapping bug, or mandatory-draw reconstruction issue. It is a **deterministic server-side wiring bug** introduced by the advance-first `/record-game` path (PR #18): the HTTP handler saves progress, then immediately overwrites the persisted attempt result in a way that erases that progress before async verification runs.

**Offline reproducibility:** **Yes.** Replaying the recovered transcript with initial scores `50–23` verifies cleanly; replaying with `0–0` reproduces the **exact** production digest pair (`c7116bcd` vs `3a092a3b`).

---

## 1. Evidence pulled

### 1.1 Event chain (Supabase `daily_fritz_events`)

Equivalent to `GET /api/daily-fritz/events/272dd33b-5ef0-4c30-8604-8c82be2ac5b4` (admin route requires `x-admin-secret`; events were pulled directly from Supabase with service role).

| Time (UTC) | Event | Notes |
|---|---|---|
| 22:04:16 | `attempt_started` | revision 1 |
| 22:04:32 | `first_move` | game 1 hand 0 |
| 22:05:02 – 22:09:29 | `hand_verified` ×6 | hands 0–5, all clean |
| 22:10:25 | `game_recorded` | hand 6, digest `572a0cd2…`, setWinner player, 61–27 |
| 22:10:25 | `verification_failed` | **`fritz_state_mismatch`**, operation `record-game`, outcome `advance_unverified` |
| 22:10:26 | `request_failed` | `/complete` → `daily_fritz_invalid_finalize_transition` (downstream) |

Hands 0–5 verified synchronously via `/next-hand`. Hand 6 failed **async** verification scheduled by `/record-game`.

### 1.2 Checkpoint / journal

| Source | Result |
|---|---|
| `daily_fritz_events` `checkpoint_saved` | **None** for this attempt |
| `attempt.result.active_checkpoint` | **Absent** |
| Server-persisted `officialJournal` for hand 6 | **Not stored** (transcripts are not persisted; only digests in authority ledger) |
| `daily_fritz_verified_hands` for hand 6 | **No row** (hand rejected) |

The client-submitted transcript was **not** retained in the database. Recovery required offline digest search (see §2).

### 1.3 Authority ledger at failure time

Verified hands 0–5 receipts (from `attempt.result.authority.hands`):

| Hand | Actions | Score after | Digest (prefix) |
|---|---|---|---|
| 0 | 10 | 9–1 | `d9a01357…` |
| 1 | 18 | 17–6 | `8c8e204a…` |
| 2 | 14 | 24–18 | `be68c544…` |
| 3 | 19 | 31–20 | `867da51c…` |
| 4 | 8 | 43–20 | `03c7d2f7…` |
| 5 | 23 | **50–23** | `2d54a72a…` |

Hand 6 start scores (authoritative): **player 50, fritz 23**.

Terminal hand transcript digest (from `game_recorded` event):  
`572a0cd200d642e78959f39011cc071582171b3662d4287ac6ce7993700aa6d0`

---

## 2. Offline replay

### 2.1 Transcript recovery

Because the transcript JSON was not persisted, it was **reconstructed offline** by:

1. Loading the official hand-6 deal from `daily_fritz_runs` for `2026-08-19`.
2. BFS over legal player moves + official Fritz policy moves from initial state `(50, 23)`.
3. Keeping paths that terminate at `(61, 27)` domino.
4. Matching `digestDailyFritzTranscript()` to `572a0cd2…`.

Recovered transcript: **20 actions**, `clientRelease: "unknown"`, protocol v2, fritz policy v2.  
(Action 4 is Fritz play `3–6` on `left` with `preStateDigest: df-state-v1:c7116bcd`.)

### 2.2 Verifier replay results

| Initial scores | `requireStateDigests: true` | Action-4 server digest |
|---|---|---|
| **50–23 (correct)** | **PASS** | `c7116bcd` (matches client) |
| **0–0 (bug path)** | **FAIL `fritz_state_mismatch`** | **`3a092a3b` (matches production)** |
| 61–27 (post-overwrite scores) | FAIL | `205673f9` (different message) |

**Conclusion:** Production failed on the **`0–0` initial-state path**, not on the final `61–27` scores written to `active_game` immediately before save.

### 2.3 Earliest divergence (step-by-step)

Player actions do not carry digest checks; Fritz `play` actions do. State diverges from **hand start**:

| Step | Correct (50–23) digest | Wrong (0–0) digest |
|---|---|---|
| Initial | `9a998d19` | `a6fde2ef` |
| After action 0 (player draw) | `d384a456` | `d9bfa350` |
| After action 1 (player draw) | `3254c9a5` | `f8806dc3` |
| After action 2 (player play 6–6) | `5edd506f` | `e3e0cdad` |
| After action 3 (player play 0–6) | **`c7116bcd`** | **`3a092a3b`** |
| Action 4 check (Fritz play) | would pass | **FAIL detected here** |

**Earliest divergence:** initial state construction (before action 0).  
**Earliest detection:** Fritz action 4 (first Fritz `play` with a `preStateDigest` check after the divergent player sequence).

---

## 3. Candidate cause classification

| Candidate | Verdict | Evidence |
|---|---|---|
| **(a) Journal capture timing race** | **Ruled out** | Recovered transcript verifies offline with honest digests. Client journal matches engine replay when initial state is correct. |
| **(b) Transcript build / mapping error** | **Ruled out** | `toDailyFritzTranscriptActions(journal)` path is consistent; digest match confirms canonical transcript shape. |
| **(c) Mandatory-draw reconstruction drift** | **Ruled out** | Before action 4 on the correct path, `canDraw(fritz) === false`. Mismatch is not from `applyOmittedMandatoryDraws`. |
| **(d) Something else** | **Confirmed** | **`active_game` progress wiped before async verify** → verifier starts hand 6 at `0–0`. |

### 3.1 Mechanism (code path)

**`/record-game` advance-first handler** (`dailyFritzRecordGameRoute.ts`):

1. Reads progress: `readActiveGameProgress()` → `{ you: 50, fritz: 23 }` (correct).
2. Writes final scores: `writeActiveGameProgress({ you: 61, fritz: 27 })`.
3. Calls `buildRecordedDailyFritzAttemptResult({ previousResult, setResult, verificationPending: true })`.
4. Persists attempt, then schedules `runDailyFritzRecordGameVerification()`.

**Bug:** `buildRecordedDailyFritzAttemptResult` returns:

```ts
return {
  ...input.setResult,   // set-result blob (games, setWinner, …)
  authority,
  verification_status: 'pending_verification',
  // active_game NOT included → dropped
};
```

`setResult` does not contain `active_game`. Spreading it **replaces** the result object shape and **drops** `active_game`.

**Async verifier** (`dailyFritzRecordGameAsyncVerification.ts` → `attemptVerifyHand` → `verifyAttemptHand`):

```ts
const progress = readActiveGameProgress(input.attempt.result, gameNumber);
// → { you: 0, fritz: 0 } when active_game missing

createOfficialDailyFritzHandState({
  …,
  playerScore: progress.you,   // 0
  fritzScore: progress.fritz,  // 0
});
```

**Reproduced locally:**

```text
before merge active_game { game_number: 1, you: 50, fritz: 23 }
after merge active_game undefined
readActiveGameProgress after merge { gameNumber: 1, you: 0, fritz: 0 }
```

---

## 4. Scope assessment

### 4.1 Is this specific to instant skunk / hand 6?

**No.** Any terminal hand verified via **async `/record-game`** after PR #18 is affected if mid-game progress lived only in `active_game`. Instant skunk is incidental — it forces a clinching `/record-game` on the terminal hand.

Hands 0–5 used **`/next-hand`**, which updates `active_game` **after** verification and does **not** call `buildRecordedDailyFritzAttemptResult`, so they verified correctly.

### 4.2 Systemic vs rare edge case

| Dimension | Assessment |
|---|---|
| Bug class | **Systemic** on advance-first `/record-game` async verification |
| Gameplay legitimacy | Mom's hand was **legitimate**; transcript is valid |
| Client anti-cheat evidence | **Not broken** for this incident |
| Production frequency | **Low traffic** — only one `fritz_state_mismatch` on `record-game` ever (this attempt) |
| `/next-hand` mismatches | Separate historical cluster (Aug 1, attempt `542c08d6…`, action **0**, 5 retries) — likely resume/checkpoint class, **not** this bug |

### 4.3 Historical `fritz_state_mismatch` (all time)

**6 total** in `daily_fritz_events`:

- **5×** `542c08d6…` / `next-hand` / action 0 (2026-08-01)
- **1×** mom's attempt / `record-game` / action 4 (2026-08-19)

**262** total `verification_failed` with `operation: record-game` (mostly other codes: `wrong_actor`, `illegal_action`, etc.) — the wiped-progress bug would only surface as state/policy mismatch codes when the transcript is otherwise valid; mom's case is the only `fritz_state_mismatch` on that path.

Under **pre–PR #18 blocking behavior**, a rejected terminal hand would have blocked `/record-game` entirely; the mismatch would not have triggered the `/complete` finalize trap. PR #18 **surfaced** the async-verify bug by advancing first.

---

## 5. Recommended fix approach (NOT implemented)

**Do not patch verifier digest logic or loosen `fritz_state_mismatch`.** The verifier correctly detected inconsistent initial state.

### Option A (minimal, recommended): Preserve progress through record-game merge

In `buildRecordedDailyFritzAttemptResult`, carry forward `active_game` from `previousResult` (and any other non–set-result fields that async verification depends on).

Add an integration test:

1. Attempt with `active_game: { you: 50, fritz: 23 }` and authority hands 0–5.
2. `/record-game` with valid terminal transcript + `verificationPending`.
3. Assert persisted attempt still has usable hand-start progress **or** async verifier receives explicit start scores.
4. Assert async path verifies (or mock `runDailyFritzRecordGameVerification` inputs).

### Option B (more robust): Stop relying on `active_game` for verification

In `runDailyFritzRecordGameVerification`, derive hand-start scores from:

- Last verified hand in authority ledger: `hands[handIndex - 1].playerScoreAfter / fritzScoreAfter`, or
- Explicit `handStartScores` captured in `asyncVerificationInput` **before** `writeActiveGameProgress` overwrites to terminal totals.

This decouples verification from UI progress bookkeeping.

### Option C (defensive): Fail closed instead of mis-verifying

If `readActiveGameProgress` returns `0–0` but authority ledger shows prior hands with non-zero scores, **do not run digest verification** — log `missing_hand_start_progress` and treat as infrastructure error. Prevents false `fritz_state_mismatch` accusations against honest clients.

### Priority

1. Option A + test (smallest fix for the proven bug).  
2. Option B (harder to regress).  
3. Option C as belt-and-suspenders.

---

## 6. What this incident was NOT

- Not evidence of client-side cheating or Fritz policy divergence on mom's device.
- Not caused by instant-skunk scoring rules.
- Not fixed by PR #20 (`legacy_unverified` finalize) — that addresses the **downstream `/complete` trap**, not verification rejection.
- Not reproducible by replaying the journal with correct hand-start scores — verification **passes**.

---

## 7. Artifacts & commands used

- Supabase prod read: `daily_fritz_events`, `daily_fritz_attempts`, `daily_fritz_runs`
- Offline scripts: BFS transcript recovery + verifier replay (`npx tsx` one-offs in `server/`, not committed)
- Key files reviewed:
  - `server/src/http/routes/dailyFritzRecordGameRoute.ts`
  - `server/src/http/routes/dailyFritzRecordGameAsyncVerification.ts`
  - `server/src/http/routes/dailyFritzVerificationGlue.ts` (`readActiveGameProgress`, `attemptVerifyHand`)
  - `server/src/http/routes/dailyFritzVerificationPolicy.ts` (`buildRecordedDailyFritzAttemptResult`)
  - `server/src/dailyFritzVerifier.ts` (mismatch throw site)
  - `client/src/modules/match/runtime/gameCoreAdapter.ts` (journal capture — exonerated)
  - `packages/game-core/src/dailyFritzJournal.ts`

---

## 8. Sign-off checklist

| Question | Answer |
|---|---|
| Root cause identified with evidence? | **Yes** — `active_game` dropped → verifier used `0–0` start |
| Reproducible offline? | **Yes** — exact production digests on `0–0` path |
| Client transcript valid? | **Yes** — verifies with `50–23` start |
| Earliest divergence? | Initial state (detected at Fritz action 4) |
| Scope | Systemic on async `/record-game`; low observed rate |
| Fix implemented? | **No** (investigation-only per request) |
