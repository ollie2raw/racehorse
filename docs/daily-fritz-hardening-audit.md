# Daily Fritz hardening audit — advance-before-proof

**Date:** 2026-08-20  
**Scope:** Client + server daily-fritz only. Find every remaining instance of the bug class fixed twice recently: **state / published write advancing before its proof is durably persisted**.  
**Mode:** Report only — no code changes.

**Reference incidents / fixes (context, not re-litigated here):**

1. Advance-first `/record-game` wiped `active_game` before async verify → false `fritz_state_mismatch` (aunt / mom game-1 investigation). Mitigated by deriving hand-start scores from the authority ledger (`resolveHandStartScoresForVerification`).
2. Async receipt backfill + record-game retry storms after cursor already moved (`0b79c9a`).
3. Post-play recovery draw was a **transcript fidelity** bug, not this class — out of scope except where it feeds unverified advance.

---

## 1. Enumeration: advances & published writes

Legend:

- **Gated** = durable receipt / verification / authority write happens in the same commit (or transactional command) that advances the cursor / publishes, *or* the advance is refused until that proof exists.
- **Not gated** = cursor / published blob can move (or be player-visible) while proof is missing, pending, best-effort, or fire-and-forget.

### 1.1 Server — authority cursor (`currentHandIndex` / `currentGameNumber` / `revision`)

| Location | What advances | Gated? | Notes |
|---|---|---|---|
| `server/src/http/routes/dailyFritzNextHandRoute.ts` ~388–419, 463 | `currentHandIndex += 1` after mid-game hand | **Mixed** | If verify succeeds: receipt written into `attempt.result.authority.hands` *before* upsert (or transactional `commitDailyFritzAttemptCommand` when `DAILY_FRITZ_TRANSACTIONAL_COMMANDS=true`). If verify fails but `completed_hand_scores` present: **not gated** — advances with `verification_status: 'rejected'` (~395–419). |
| `dailyFritzNextHandRoute.ts` ~216–227 | Legacy score-only path (no transcript) | **Not gated** | Marks `legacy_unverified`, advances hand index. Modern competitive attempts should 426 before this; still a live code path. |
| `dailyFritzNextHandRoute.ts` ~344–385 | Game-ending hand via `/next-hand` | **Gated (persist)** / **Not an index advance** | Persists verified (or unverified) hand + `active_game`, then **409** “finalize via record-game” — does **not** bump `currentHandIndex`. Score persistence is intentional; cursor stays for `/record-game`. |
| `server/src/http/routes/dailyFritzRecordGameRoute.ts` ~252–345, 402 | `set_result.games[]` append + `currentHandIndex = 0` + `currentGameNumber++` when set not decided | **Not gated (advance-first)** | With transcript and no prior terminal receipt: sets `verificationPending`, writes published set scores, advances cursor, responds `200` + `verification_pending`, **then** `scheduleDailyFritzRecordGameVerification` (~448–462). Receipts arrive async (or never). |
| `dailyFritzRecordGameRoute.ts` ~320–333, 347–400 | Same route when terminal hand already verified by `/next-hand`, or transactional commit | **Gated** | Sync `writeVerifiedGame` and/or `commitDailyFritzAttemptCommand` with game/hand receipts before response. Transactional path skipped when `verificationPending` (~347–348). |
| `server/src/http/routes/dailyFritzRecordGameAsyncVerification.ts` ~86–201 | Backfills hand/game receipts after advance | **After-the-fact** | Does not reverse the earlier cursor advance. On verify failure: marks `rejected` + `unverified_hands` (~105–122). |
| `server/src/http/routes/dailyFritzCompletionRoutes.ts` ~117–223 | `status: 'completed'`, final scores on attempt row | **Gated (eligibility)** | `canFinalizeDailyFritzAttempt` requires complete game authority **or** sticky `rejected` (~122–125). Blocks `pending_verification` / incomplete receipts with **409**. Leaderboard filter separately requires `verification_status === 'verified'` (`dailyFritzStore.ts` ~730–737). |
| `dailyFritzCompletionRoutes.ts` ~281–349 | `status: 'abandoned'` | N/A (terminal leave) | No verification gate; abandons started attempts. |
| `server/src/http/routes/dailyFritzCheckpointRoute.ts` ~75–76 | Writes `active_checkpoint` only | **Gated on cursor match** | `validateDailyFritzCheckpointWrite` requires matching `authorityRevision` / game / hand (`dailyFritzCheckpointPolicy.ts`). Does **not** advance authority cursor. |
| `server/src/http/routes/dailyFritzStartRoute.ts` ~250–291 | Creates/updates attempt, pins contract, `status: 'started'` | **OK / not this class** | Starts a run; no hand/game proof required. |

### 1.2 Server — player-visible / published writes

| Location | What is written | Gated? | Notes |
|---|---|---|---|
| `dailyFritzRecordGameRoute.ts` ~318–340, 402 | `attempt.result` set blob (`games[]`, set winner, scores) | **Not gated** on advance-first path | Same write that advances cursor. Hub cards / resume read this immediately. |
| `dailyFritzRecordGameRoute.ts` ~408–419 | `activity_feed` via `writeDailyFritzGameActivity` | **Not gated** | Fires after upsert even when `verificationPending`. Social/activity is player-visible without a receipt. |
| `dailyFritzCompletionRoutes.ts` ~253–261 | Leaderboard preview in response | **Gated** | Rank only if `isVerified`; store builder filters `verified` only. |
| `dailyFritzStore.ts` `buildDailyFritzLeaderboard` ~671–737 | Public leaderboard rows | **Gated** | `status === 'completed'` **and** `verification_status === 'verified'`. |
| `dailyFritzCompletionRoutes.ts` ~134–168 | Completed attempt personal result (history / hub) | **Partially gated** | Can finalize as `legacy_unverified` when `rejected` or legacy. Personal completion is visible; leaderboard still excluded. |
| `dailyFritzVerificationGlue.ts` `writeUnverifiedDailyFritzHand` ~86–104 | Sticky `rejected` + `unverified_hands` | Explicit unranked marker | Prevents silent leaderboard corruption; still advances play. |

### 1.3 Client — cursor / local “published” state

| Location | What advances | Gated? | Notes |
|---|---|---|---|
| `client/src/modules/match/hooks/useHandLifecycle.ts` `applyDailyFritzNextHandResponse` ~178–219 | Local session cursor (`handIndex` / `revision`) + new deal | **Gated on HTTP 200** | Applies only after `/next-hand` succeeds — including **`unverified: true`** success. Server may have advanced without a receipt. |
| `useHandLifecycle.ts` advance path ~400–435 | Prefetch / advance request | Does not locally bump authority before response | Correct ordering relative to server. |
| `client/src/dailyFritz/useDailyFritzRunController.ts` `submitCompletedGame` ~434–498 | Local `set_result` / between-games overlay | **Gated on `/record-game` 200** | Trusts advance-first success; may show Game N saved while async verify still pending. |
| `client/src/modules/daily/useDailyFritzSessionPersistence.ts` ~166–251 | `localStorage` + debounced `/checkpoint` | **Not authority advance** | Checkpoint revision ≠ authority revision. Sync failure returns `null` and is ignored (`api.ts` `saveDailyFritzCheckpoint` ~526–528). |
| `client/src/dailyFritz/dailyFritzCheckpointUnload.ts` | `fetch` beacon on unload | Best-effort | No user UI; can lose last mid-hand checkpoint. |

### 1.4 Dead / misleading gate

| Location | Issue |
|---|---|
| `dailyFritzVerificationGlue.ts` `readDailyFritzUnverifiedFallbackRequest` ~68–75 | **Never called** by `/next-hand`. Client documents a 3-attempt unverified fallback (`api.ts` ~615–621, `dailyFritzNextHandFailurePolicy.ts`), but server **already advances on first verify failure when scores are present** (`dailyFritzNeverStrand.test.ts` “advances immediately on the first request when scores are present”). |

---

## 2. Blast radius for every “not gated” case

| Case | Blast radius |
|---|---|
| **Advance-first `/record-game`** (cursor + `set_result.games` before async receipt) | **Same class as 409 cascade** if `/complete` runs while `pending_verification` / missing game receipt → `Daily Fritz verification is incomplete.` Player sees “couldn’t finalize” / retry loops. If async verify later fails → sticky `rejected` → finish **unranked** (not silent LB lie). If async worker **dies** before writing status → can strand at `pending_verification` until manual ops. Hub/activity already show the game as recorded. |
| **`/next-hand` advance-on-verify-failure with scores** | **Not 409 cascade** — returns 200 `unverified`. Blast: **silent competitive death** (run becomes `rejected`, never leaderboard-eligible) while play continues. Player may not notice until hub says unranked. Wrong scores from client legacy fields can be carried forward into `active_game`. |
| **Legacy score-only `/next-hand`** | Same as above for non-modern attempts; modern should 426. |
| **Activity feed on advance-first record-game** | **Social lie / premature publish** — friends can see a Daily Fritz game result that never got a receipt (or later rejected). Not LB corruption. |
| **Checkpoint save swallow** | **Corrupted / empty resume** risk on crash mid-hand — reload falls back to last good checkpoint or official hand. Not the 409 cascade; usually recoverable via authority reload. |
| **Client accepting `unverified: true`** | Propagates server never-strand into seamless next deal — **silent unranked**, same as server row above. |
| **`buildRecordedDailyFritzAttemptResult` still drops `active_game`** (`dailyFritzVerificationPolicy.ts` ~197–205) | **Residual of aunt’s bug class**, largely **mitigated** for verify by ledger-based start scores. Remaining: any UI/resume path that still trusts `active_game` after record-game sees missing progress (between-games usually OK at 0–0; mid-set tooling/debug confusion). |

---

## 3. Client fetch error handling (daily-fritz endpoints)

| Endpoint | Caller(s) | Failure UI? | Retry behavior |
|---|---|---|---|
| `GET /api/daily-fritz/today` | `useDailyFritzInit` | **Yes** — loading screen `failed` + Retry (`DailyFritzLoadingScreen`) | Manual retry; soft cache clear on retry |
| `POST /api/daily-fritz/start` | `useDailyFritzRunController` begin/continue | **Yes** — hub error / start failure message | Manual re-tap start; telemetry `start_requested` |
| `POST /api/daily-fritz/next-hand` | `useHandLifecycle` | **Yes** — hand-over modal (`handAdvanceError` + manual Continue/Retry) after silent retries | Auto retry ladder for transport/5xx; rebuild for `incomplete_transcript` / `wrong_actor`; then modal. Note: **verify-fail-with-scores is success**, not this path |
| `POST /api/daily-fritz/record-game` | `submitCompletedGame` | **Yes** — overlay `record-error` (“Game N finished, but result has not been saved”) | Auto up to 3 attempts then hard stop; Retry on overlay; authority recovery path reloads hub |
| `POST /api/daily-fritz/complete` | `submitSetCompletion` / embedded completion | **Yes** — `final-error` overlay / `resultError` | Manual `retryFinalSubmission` / completion retry |
| `POST /api/daily-fritz/checkpoint` | session persistence + unload beacon | **No** | `saveDailyFritzCheckpoint` catches → `null`; unload `fetch` fire-and-forget. Debounced retries only via later edits |
| `POST /api/daily-fritz/telemetry` | many | **No** (by design) | Swallow errors (`api.ts` ~878–880) |
| `POST /api/daily-fritz/abandon` | exported; sparse UI use | **No dedicated DF screen** if unused | Throws to caller if used |
| `GET /api/daily-fritz/leaderboard/:date` | `DailyFritzLeaderboardScreen` | **Yes** — inline error + try again | Manual reload |
| `GET /api/daily-fritz/history` | `getDailyFritzHistory` in `api.ts` | **No in-product caller found** | N/A (API exists; unused by hub UI in this tree) |
| Admin/health/events routes | admin screens | Admin-only errors | N/A for players |

---

## 4. Observability gaps — `verification_failed` & reconstructability

### What *is* durable today

- `daily_fritz_events` row (best-effort) with `event_type`, `verifier_code`, `game_number`, `hand_index`, short `payload.message`, sometimes `transcript_digest`.
- Attempt blob: `authority.hands[]` digests/scores **only for hands that verified**; `unverified_hands[]` codes if never-strand fired.
- Sentry warning/message for bypass / infrastructure codes (no full transcript).
- Successful path: `daily_fritz_verified_hands` / `daily_fritz_verified_games` when transactional/async backfill succeeds.

### What is **not** durable (cannot reconstruct after the fact)

| Failure path | Lost artifact | Why it hurts |
|---|---|---|
| `/next-hand` or `/record-game` **sync** `verification_failed` catch (`dailyFritzNextHandRoute.ts` ~488–498, `dailyFritzRecordGameRoute.ts` ~466–475) | Full transcript / journal / digest often absent | Event payload is `{ operation, message }` only — **no digest, no actions**. Same gap that forced offline BFS for aunt’s game 1. |
| `recordDailyFritzAdvanceWithoutVerification` (`dailyFritzVerificationGlue.ts` ~341–356) | Transcript + digest | Writes `verification_failed` with `outcome: advance_unverified` but **no `transcriptDigest`**, no body. |
| Advance-first async verify (`dailyFritzRecordGameAsyncVerification.ts`) | Transcript lives **only in process memory** until verify runs | Process restart / deploy mid-flight → no replay input; may leave `pending_verification` with only earlier `game_recorded` digest (if that event landed). |
| Async verify crash (`schedule…` `.catch` ~66–74) | May leave attempt still `pending_verification` | Sentry/log only; no transcript archive. |
| `recordDailyFritzEventBestEffort` failure | The event itself | Metric `event_persistence_failed`; investigation has empty timeline. |
| Client transcript build failure (competitive) | Never submitted | Sentry `transcript_build_failed`; server never sees evidence. |
| Checkpoint not saved / silent checkpoint fail | Mid-hand journal on server | Resume evidence only local; if local wiped, gone. |
| Sentry-only alerts | No durable transcript attachment | Ops see code + attempt id, not replayable log. |

**Bottom line:** Digests on *successful* `hand_verified` / `game_recorded` help *confirm* identity but **do not store the transcript**. On the failure paths that matter most (`verification_failed` + advance_unverified + async pending), we still cannot reconstruct what the client played without an external recovery miracle.

---

## 5. Top 5 (ranked)

Ranking axes: **(a)** how many real users can hit it, **(b)** silent data corruption vs visible error, **(c)** cheapness of fix.

### 1. Advance-first `/record-game` still publishes + moves cursor before durable game receipt

- **(a)** High — every competitive set that finishes a game through record-game (all multi-game / terminal paths without a prior `/next-hand` terminal receipt).
- **(b)** Visible 409 cascade on fast `/complete`; unranked if async fails; activity feed premature; not silent LB forge (LB still gated).
- **(c)** Medium — either verify+receipt in the same lock before cursor advance, or persist transcript+digest+pending job durably and block finalize until receipt/reject settles; keep never-strand as explicit reject only after archival.

### 2. `/next-hand` never-strand advances on **first** verify failure whenever scores are sent (fallback helper unused)

- **(a)** High — any transient verifier bug, transcript glitch, or fidelity regression (the class that produced post-play recovery draws) turns into an unranked run without a hard error.
- **(b)** **Silent competitive corruption** (sticky `rejected`) with continued play — worse than a modal for trust.
- **(c)** Cheap–medium — wire `readDailyFritzUnverifiedFallbackRequest` (or equivalent) so first failures **409** and only Nth attempt advances unranked; align client policy with server.

### 3. `verification_failed` paths do not persist transcript (or even digest) durably

- **(a)** Every failed verify / bypass — low daily volume, **high** cost per incident (blocks all aunt-style investigations).
- **(b)** Observability only — does not corrupt LB by itself, but makes (1)/(2) unfixable.
- **(c)** Cheap — on fail/bypass/async schedule: write truncated transcript JSON or content-addressed blob keyed by digest; always set `transcript_digest` on the event.

### 4. Async verification is fire-and-forget in-memory (crash → stranded `pending_verification`)

- **(a)** Medium — deploy/restart windows during/after game save; multi-instance without shared queue.
- **(b)** Visible strand / 409 on complete; possible stuck “Saving…” recovery loops if client retries record-game oddly.
- **(c)** Medium — durable outbox job + idempotent worker; or stop advancing until sync verify when transactional flag is on.

### 5. Checkpoint / telemetry failures are silent; activity publishes unverified games

- **(a)** Checkpoint: medium (flaky mobile networks). Activity: every advance-first game.
- **(b)** Checkpoint → resume pain (usually recoverable). Activity → **silent social wrongness**.
- **(c)** Cheap — gate `writeDailyFritzGameActivity` on verified game receipt (or on complete); surface a soft “progress may not resume offline” only if product wants (optional). Prefer gating activity first.

---

## Out of scope / explicitly not top-5

- Post-play recovery draw fidelity (fixed in PR #36) — different class.
- Transactional commands flag off by default — increases exposure of (1)/(4) but is a deployment switch, not a separate bug.
- Unused `GET /history` client helper — cleanup only.
- Leaderboard eligibility filter — already correct; do not “fix” by loosening it.

---

## Suggested next pass (when implementing)

1. Persist evidence on every `verification_failed` / async schedule.  
2. Make never-strand require explicit fallback attempts server-side.  
3. Narrow or eliminate advance-before-receipt on `/record-game` (or make pending finalize safe + observable).  

No code was changed in this audit.
