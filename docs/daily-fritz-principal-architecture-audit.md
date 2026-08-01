# Daily Fritz Principal Architecture, Reliability, Trust, and Product Audit

**Project:** Racehorse Dominoes
**Audit subject:** Daily Fritz
**Audit date:** 2026-07-31
**Audit posture:** Evidence-based repository review; implementation changes intentionally excluded

## Scope and method

This report treats Daily Fritz as a production daily benchmark, not merely as a bot-match screen. The review followed the actual entry point through the React client, API routes, server stores, shared game core, verifier, database schema, recovery storage, leaderboard, social activity, and operational event journal.

The repository contains substantial unrelated uncommitted work. It was preserved. No implementation code, schema, or configuration was changed for this audit. The only intended artifact from this task is this Markdown report.

Evidence labels used below:

- **Verified fact:** directly established from source, schema, a test, or a reproduced command.
- **Strong inference:** follows directly from the code path but would benefit from a live production replay.
- **Unverified:** the repository does not contain enough evidence to claim the behavior.
- **Estimate:** a judgment about product quality, risk, or likely behavior rather than a measured number.

The targeted server verification suite was run after inspection: **9 test files passed, 73 tests passed**. The first invocation used repository-root paths and therefore found no files; the corrected workspace-relative invocation passed. This is evidence about the selected automated tests only, not about the complete product.

---

## 1. Executive verdict

### Production verdict

Daily Fritz is **not yet production-ready as a public, high-trust daily benchmark or verified competitive leaderboard**. It has more serious engineering substance than a normal client-only daily game: the server owns the attempt row, stores a one-attempt-per-user-per-day constraint, replays submitted action transcripts through shared game rules, verifies Fritz decisions, records authority digests, and excludes unverified attempts from the leaderboard. Those are meaningful foundations.

However, the system still has a fragmented set model, a legacy score-only compatibility path, process-local concurrency control, non-transactional event logging, loosely typed JSON authority state, incomplete analytics, and no demonstrated end-to-end recovery or multi-instance test. Those gaps mean the mode can be described as **server-verified for modern attempts under normal single-instance conditions**, but not as an independently auditable, globally deterministic, operationally hardened daily competition.

### Architecture verdict

The architecture is **directionally coherent but not yet a single authoritative domain model**. The shared `@racehorse/game-core` is the best architectural decision in the feature: legality, action replay, transcript parsing, and Fritz policy are reusable rather than entirely duplicated in the route layer. The server-side `dailyFritzVerifier.ts` is also a real trust boundary, not merely a UI validation helper.

The weaker part is the orchestration around that core. A Daily Fritz attempt is represented by a relational row plus a large JSONB `result` object containing set result, authority ledger, verification metadata, and progress. The client separately holds a rich live match state in React/localStorage. The server has one current hand index for the whole attempt and resets it between games. The set abstraction exists, but it is not a first-class persisted aggregate with atomic transitions.

### Best-of-three verdict

The best-of-three format is **implemented as a real server-side set result rather than an accidental visual sequence**, and the code handles game numbering, game wins, skunks, game-two tie-breaking, and early set completion. It is nevertheless split across several modules and uses special-case skunk rules that make the state model difficult to reason about.

The current implementation does skip the next game after a set winner is determined. A normal set is decided after two game wins; a game-one skunk immediately records a mechanical 2–0; a game-two skunk can decide the set after a 1–1 split. The code explicitly treats a game-three skunk as display/ranking metadata. These rules are coherent in isolation but require a canonical domain state machine and invariant tests before they should be considered durable product rules.

### Daily-habit verdict

Daily Fritz currently feels closer to **an authenticated bot match with a daily lock and leaderboard** than to a fully realized Wordle/Chess.com-grade daily event. It has the important ingredients—one attempt per user per Pacific day, deterministic seeds, a fixed tier/deal configuration, streaks, leaderboard, final share text, and a between-game state—but it does not yet measure or expose enough of the daily experience to prove habit strength. There is no repository evidence for DAU, WAU, next-day retention, seven-day retention, time-to-first-move, share rate, or cohort performance.

### Three largest risks

1. **Distributed concurrency and atomicity:** `withDailyFritzAttemptLock` is process-local. It does not coordinate two Render instances, two worker processes, or two devices. Attempt mutation and event insertion are separate network writes. `abandon` does not use the attempt lock.
2. **Compatibility and trust ambiguity:** modern transcripts are verified, but the start route can still create legacy/unverified attempts when protocol fields are omitted. Such attempts can complete outside the public verified leaderboard, which makes “daily completion” and streak semantics less trustworthy than leaderboard semantics.
3. **The set is not a first-class aggregate:** the attempt’s JSONB result combines game history, score projection, verifier ledger, and status metadata. Normalization validates shape more than game legality or cross-field invariants. This creates migration, replay, and repair risk.

### Three highest-leverage opportunities

1. **Make the daily attempt a versioned server state machine:** persist challenge, set, game, hand, authority, and idempotency state with explicit transitions and database-enforced invariants.
2. **Close the public trust contract:** require the current transcript protocol for all new attempts, make verification status explicit in every completion/streak surface, and make finalize derive solely from server authority.
3. **Instrument the daily funnel:** add canonical challenge/version identifiers to start, first move, hand completion, game completion, set completion, resume, failure, share, and return events. Without this, product decisions about best-of-one versus best-of-three are speculation.

---

## 2. Current architecture

### System map

The verified current path is:

```text
HomeScreen / app navigation
        |
        v
AppRoutes appMode === "dailyFritz"
        |
        v
DailyFritzScreen
  ├─ useDailyFritzInit -> GET /api/daily-fritz/today
  ├─ useDailyFritzRunController
  └─ DailyFritzHubView
        |
        | Play / Continue
        v
POST /api/daily-fritz/start
        |
        ├─ Pacific date resolution
        ├─ ensureDailyFritzRunForDate
        ├─ one-attempt-per-user/day lookup or insert
        ├─ startVerifiedSinglePlayerMatch
        └─ return challenge/run/attempt/current-game package
        |
        v
DailyFritzEmbeddedMatchView
        |
        v
BotMatchScreen mode="daily-fritz"
  ├─ shared bot match runtime/state
  ├─ shared game-core legality/scoring primitives
  ├─ localStorage recovery checkpoint
  └─ move log -> DailyFritzTranscript
        |
        | Every completed hand
        v
POST /api/daily-fritz/next-hand
  ├─ parse transcript
  ├─ server reconstructs official hand state
  ├─ replay shared game commands
  ├─ verify player and Fritz actions
  ├─ append authority hand receipt
  └─ advance attempt.current_hand_index
        |
        | Completed game
        v
POST /api/daily-fritz/record-game
  ├─ verify terminal hand transcript
  ├─ aggregate game score from authority ledger
  ├─ appendDailyFritzGameToSet
  ├─ decide next game / clinch / set winner
  └─ persist set result + game authority
        |
        | Set winner exists
        v
POST /api/daily-fritz/complete
  ├─ require setWinner
  ├─ require complete authority for modern attempt
  ├─ derive final record and server receipt
  ├─ mark attempt completed
  ├─ update verified match
  └─ build verified leaderboard rank
        |
        v
GET /api/daily-fritz/leaderboard/:date
GET /api/daily-fritz/history
Home timeline / streak / social activity / final share UI
```

### Entry points and surfaces

The principal authenticated entry point is the `appMode === 'dailyFritz'` branch in `client/src/AppRoutes.tsx:570-591`, which renders `DailyFritzScreen`. `HomeScreen.tsx` contains the Daily Fritz call to action. The home model also consumes Daily Fritz state through `homePrimaryAction.ts`, `homeActivityTimeline.ts`, `homeMomentum.ts`, `homePersonalization.ts`, `homeWelcomeBack.ts`, and `homeDataLoaders.ts`.

The mode has additional surfaces:

- `client/src/dailyFritz/DailyFritzLeaderboardScreen.tsx` and `DailyFritzLeaderboard.tsx` show standings and sharing affordances.
- `client/src/bot/BotDailyFritzSetOverlay.tsx`, `DailyFritzFinalResultOverlay.tsx`, and `useDailyFritzRunController.ts` provide between-game and final-result flow.
- `client/src/dailyFritz/shareCard.ts` creates share text; the implementation uses browser clipboard/share APIs rather than a server-side share record.
- `DailyFritzBroadcastControl.tsx` and the spectator integration expose a live broadcast/read-only surface. This is adjacent to the daily mode, but spectator state is not part of attempt authority.
- `server/src/http/routes/dailyFritz.ts` exposes operational metrics and event-history routes protected by the admin secret.

The app does not have evidence of a separate notification delivery system dedicated to Daily Fritz. Home welcome-back/personalization logic is present, but a reminder scheduler or push/email delivery path was not established in this audit.

### Server boundaries

The server responsibilities are distributed across:

| Boundary | Evidence | Actual responsibility |
|---|---|---|
| Challenge generation | `server/src/dailyFritz.ts:95-356` | Date-based seed, game seeds, deterministic draw winner/tiles, game-one hand generation, metadata. |
| Date and identity | `server/src/dailyFritzIdentity.ts:1-35`, `server/src/shared/pacificDate.ts:1-64` | Rules/seed version, challenge ID, Pacific calendar date. |
| Persistence | `server/src/http/stores/dailyFritzStore.ts` | Run/attempt reads and writes, run cache, hand selection, leaderboard/history. |
| Set rules | `server/src/dailyFritzSkunk.ts:1-287` | Skunk detection, game wins, game-two skunk clinch, set winner. |
| Verification | `server/src/dailyFritzVerifier.ts` | Official state construction, command replay, transcript verification, Fritz policy checks. |
| Verification policy | `server/src/http/routes/dailyFritzVerificationPolicy.ts` | Authority ledger, protocol status, finalize gating, legacy compatibility. |
| HTTP orchestration | `server/src/http/routes/dailyFritz.ts` | Auth, route validation, mutation sequencing, response shaping. |
| Operational events | `server/src/http/stores/dailyFritzEventStore.ts` | Append-only best-effort events and aggregate view reads. |
| Match persistence | `server/src/shared/verifiedSinglePlayerMatch.ts` and route calls | Link an attempt to a verified single-player match and persist completion. |
| Health | `server/src/platform/health/registerHealthRoutes.ts` | Readiness probe includes the Daily Fritz event metrics view. |

### Client boundaries

`DailyFritzScreen.tsx` is a composition shell. Initialization and hub state are handled by `useDailyFritzInit`, display by `DailyFritzHubView`, and run orchestration by `useDailyFritzRunController`.

The actual board is not a Daily Fritz-specific game engine. `DailyFritzEmbeddedMatchView.tsx` passes `mode="daily-fritz"` into the shared `BotMatchScreen`. The shared bot runtime, hand lifecycle, move logging, draw/presentation state, and match view model therefore serve both normal Fritz matches and Daily Fritz. This reuse is valuable, but it also means Daily Fritz correctness depends on mode-specific branches inside general-purpose bot/match hooks.

The client persists an in-progress checkpoint in localStorage through `client/src/modules/daily/dailyFritzSessionStorage.ts` and `useDailyFritzSessionPersistence.ts`. The checkpoint includes schema version 7, challenge identity, attempt ID, run fingerprint, game number, hand index, live match state, move log, optional transcript, lifecycle phase, revision, and timestamps.

### Data flow and ownership

The current ownership model is:

| Concept | Current apparent owner | Assessment |
|---|---|---|
| Current Pacific day | Server `getPacificDateKey()` | Strong server authority. Client can supply a date only for certain development/debug paths. |
| Challenge ID | Server `dailyFritzIdentity.ts`, echoed to client | Deterministic but versioning is split between identity constants and run metadata. |
| Run/deal package | `daily_fritz_runs` row, read through server store | Server-owned after generation. Runs have a process cache. |
| Game-one deals | Persisted `hand_deals` JSONB | Server-owned, but normalized validation is shallow. |
| Game-two/game-three deals | Regenerated by `getDailyFritzHandForGame()` | Server-derived from algorithm and date/game seed, not stored in the run row. |
| Live board state | Client BotMatch runtime and localStorage | Client-owned provisional state. It is not leaderboard authority. |
| Legal action result | Server verifier for modern attempts | Strong authority if transcript reaches the verifier. |
| Hand progress | `daily_fritz_attempts.current_hand_index` plus authority ledger | Server-owned but updated through separate read/modify/write requests. |
| Game result | Set game entry in `attempt.result` plus authority game record | Server-derived for modern attempts, but stored in JSONB and partially accepted from client for legacy. |
| Set result | `appendDailyFritzGameToSet()` output in `attempt.result` | Server computes it during `record-game`; client also has local projections. |
| Final result | `/complete` server derivation | Server sets final fields; `completion_hash` from client is not used as the acceptance receipt. |
| Leaderboard eligibility | `isDailyFritzAttemptLeaderboardEligible()` | Requires completed + `verified` + supported protocol. |
| Streak | Server completed-attempt history | Completion-based, not necessarily verified-only unless callers filter it. |
| Analytics | Event journal plus process-local counters | Operational events exist; product funnel analytics are incomplete. |

### Direct answers to the trust questions

**Can the client invent or alter a Daily Fritz result?**

For a modern attempt whose server result has verification metadata, the client cannot make an impossible transcript pass the server replay verifier without finding a verifier/game-core defect. `record-game` and `next-hand` reconstruct and verify state. The client can still send arbitrary legacy score fields when the attempt is legacy/unverified; those attempts are intentionally excluded from the verified leaderboard but can still be completed and appear as completed history. Therefore the correct answer is: **not for a verified modern leaderboard result; yes for an unverified legacy completion claim**.

**Can the same daily set be generated differently on two devices?**

If both devices call the same server run and same server build, the run row and deterministic game seed path should match. Game one uses stored deals; games two and three regenerate from server code. Cross-version reproducibility is not guaranteed by a fully stored challenge contract. If a historical row is missing and the run is regenerated under changed generation code, the same date can produce different content. This is a **strong inference from the generation/persistence split**, not a demonstrated cross-version reproduction failure.

**Can refresh, reconnect, or version differences change the deal?**

Refresh uses a local checkpoint bound to attempt ID, challenge ID, current hand index, and run fingerprint. A mismatch causes the local snapshot to be discarded. The server remains the source when the client restarts. Version differences can invalidate the local schema or transcript and can lead to `426` update-required behavior for modern evidence. The challenge generation contract is not independently versioned at the database column level beyond identity constants and metadata.

**Can the user play the same day multiple times in a way that affects the leaderboard?**

The database has a unique index on `(run_date, user_id)` (`supabase/daily_fritz.sql:35-36`), so one authenticated identity has one attempt row per day. Completed attempts are locked. Multiple accounts are not prevented by this feature. Legacy/unverified attempts can complete but are excluded from leaderboard eligibility. Cross-device concurrent use of the same identity remains a race risk.

**Can partially completed sets become corrupted or unrecoverable?**

There is meaningful recovery support: server current hand index plus localStorage checkpoint and transcript. However, the active attempt is updated by read/verify/write operations, the result is JSONB, event logging is separate, and the local checkpoint is not a server snapshot. A server restart should not lose the database attempt, but a multi-instance race or failed final write can leave a state that requires retry or support. The repository does not prove all failure scenarios safe.

**Can old clients submit incompatible results?**

Modern attempts require the supported transcript protocol and can return `426` when evidence is missing. The start route supports a legacy path when protocol fields are omitted. This is an intentional compatibility mechanism but weakens the public semantic contract. Old clients should be explicitly isolated, expired, or marked non-competitive.

**Can the server independently reconstruct the entire set?**

For modern attempts, it can reconstruct each submitted hand from the run/date/game/hand identity and replay the transcript. It can aggregate verified hand receipts into game authority and set results. It cannot reconstruct the entire set from a single final claim alone, and the database does not store a normalized set/game/hand relational history. It depends on the authority ledger retained in the attempt JSONB.

---

## 3. Current user journey

### Discovery and eligibility

The home surface presents Daily Fritz as a daily mode. Home timeline and personalization logic recognize `daily_fritz_started` and `daily_fritz_completed`, and the route requires authentication through `DailyFritzScreen`/app auth handling. The mode is therefore not an anonymous, one-click public daily puzzle.

On entering the route, `useDailyFritzInit` loads `/api/daily-fritz/today`. The server resolves the current day in `America/Los_Angeles`, ensures a run exists, loads the user’s attempt, streak, and—when completed—leaderboard position. The hub then presents start, continue, completed, or error states.

Eligibility is primarily:

1. authenticated user;
2. a live, non-invalidated run for the server’s current Pacific date;
3. no completed or abandoned attempt for the user/date;
4. a supported or legacy-compatible client protocol.

This is a real daily lock, but the authentication requirement adds friction compared with Wordle’s anonymous first play.

### Starting the set

`useDailyFritzRunController.beginRun()` calls `startDailyFritz()`. The request sends client protocol, rules, and Fritz policy versions. The server obtains the authenticated user, resolves the Pacific date, ensures the run, creates or retrieves the one daily attempt, creates a verified single-player match if necessary, and returns the current game/hand package.

The client opens the embedded shared `BotMatchScreen` with `mode="daily-fritz"`, the attempt/game-specific `matchInstanceKey`, tier, deal size, winning score, and daily package.

### Playing a hand

The player interacts with the regular bot match board. The client runtime owns animation and live state. Move evidence is collected into a move log and then encoded as a `DailyFritzTranscript` from `packages/game-core/src/dailyFritzTranscript.ts` through client helpers.

At hand completion, the client calls `/api/daily-fritz/next-hand`. The server verifies the transcript, updates the authority ledger, and returns the next hand package. The client can locally persist active state, but it does not have authority to advance the official attempt without the server response.

### Completing a game

After the terminal hand, `useDailyFritzRunController.submitCompletedGame()` calls `/api/daily-fritz/record-game`. The server does not trust the client’s final point totals for modern attempts; it recomputes them from verified hand records. It then creates a game result with game number, seed, winner, scores, point differential, move count, hand count, and completion timestamp.

The result is passed to `appendDailyFritzGameToSet()`. If the set is not decided, the client shows a between-game overlay and the user can continue. If it is decided, the client moves to finalization.

### Set completion

`completeDailyFritz()` sends a client-generated SHA-256 completion hash and client projections, but `/complete` derives the authoritative result from the persisted set and authority ledger. It stores a new server receipt based on attempt ID and transcript digests, marks the attempt completed, updates the linked verified match, and returns a leaderboard preview/rank.

The client then renders the final result overlay. The final result can include games, skunk outcomes, point differential, streak, rank, leaderboard navigation, and share text depending on the view model.

### Resume and refresh

`useDailyFritzSessionPersistence` synchronously writes a versioned localStorage snapshot after state transitions, excluding intermediate draw animation states. The parser rejects stale challenge IDs, wrong attempt IDs, wrong run fingerprints, invalid lifecycle phases, invalid tile shapes, and mismatched server hand indexes. This is a thoughtful client recovery layer.

The server also stores current hand index and authority receipts. On refresh, the route calls `/today`/`start`, the server returns the current hand, and the client attempts local resume only when its checkpoint matches the server.

### Completion, review, sharing, and return

The leaderboard route can display daily standings and share result text. Social activity writes a `daily_fritz` activity type for completed games. Home activity/personalization consumes Daily Fritz completion state. The next-day loop is represented by Pacific date and streak calculation.

What is not established as a complete user loop is learning/review. The repository contains result/reveal and share surfaces, but there is no evidence of a chess.com-style authoritative replay viewer, mistake classification, strategic explanation, or durable per-move review product for Daily Fritz.

---

## 4. Findings table

| ID | Severity | Category | Description | Evidence | User impact | Technical impact | Recommended action |
|---|---|---|---|---|---|---|---|
| DF-01 | Critical | Trust / compatibility | The public API still permits a legacy score-only path when protocol fields are omitted at start. | `server/src/http/routes/dailyFritz.ts` start validation; `dailyFritzVerificationPolicy.ts:54-58,111-120`; client fallback in `useDailyFritzRunController.ts:307-318`; `api.ts:686-711`. | A user may see a completed daily result that is not independently verified; completion and streak semantics can be confused with leaderboard legitimacy. | Final score can be accepted from legacy fields; only modern authority is replayed. | Require current protocol for new attempts. Isolate legacy rows as non-completion or display a clear unverified state. Add a sunset migration and test that omitted protocol cannot enter competitive flow. |
| DF-02 | High | Distributed systems | Attempt locking is process-local, not distributed. | `server/src/dailyFritzAttemptLock.ts`; routes use `withDailyFritzAttemptLock`, but the lock is an in-memory map. | Two tabs/devices can show conflicting progress or error on an otherwise valid move. | Two Render instances can concurrently read the same `current_hand_index`, both verify, and race on JSONB writes. | Use a DB compare-and-swap/version column or transactional RPC with idempotency key. Keep in-memory lock only as an optimization. |
| DF-03 | High | Atomicity | Attempt mutation, verified match persistence, and event journal append are separate calls. | `dailyFritz.ts` route sequence around `upsertDailyFritzAttempt`, `persistVerifiedSinglePlayerMatch`, and `recordDailyFritzEventBestEffort`; `dailyFritzEventStore.ts:44-69`. | A timeout can leave the UI unsure whether progress was saved. | There is no atomic outbox or transaction spanning official state and telemetry. | Move official mutation to a Postgres function/transaction or transactional outbox. Make retries idempotent against a stable operation key. |
| DF-04 | High | Domain model | Set/game/hand authority is packed into `daily_fritz_attempts.result` JSONB rather than normalized/versioned aggregate state. | `supabase/daily_fritz.sql:16-32`; `DailyFritzAuthorityLedger`; `normalizeDailyFritzSetResult()` and `readAuthorityLedger()`. | Recovery/support cannot easily explain or repair a partially recorded set. | Cross-field invariants are runtime conventions; JSON shape can drift. | Introduce explicit attempt state, set result, game authority, and hand receipt models or a validated aggregate document with schema version and invariant validation. |
| DF-05 | High | Determinism | Game one’s 12 deals are persisted, but game two and game three deals are regenerated at request time from code. | `server/src/dailyFritz.ts:290-356`; `dailyFritzStore.ts:getDailyFritzHandForGame()`. | A historical challenge could change if a run row is recreated under changed generation code. | Reproducibility depends on persisted game-one snapshot plus stable server algorithm for later games; no immutable complete challenge package. | Precompute/store all three games or store a generation contract and immutable content hash. Add historical replay tests after code changes. |
| DF-06 | High | Challenge versioning | Rules/seed versions exist in identity constants, but the run schema does not have dedicated generation/rules/bot policy columns. | `dailyFritzIdentity.ts:1-35`; `daily_fritz_runs` schema; metadata `version:2` in `dailyFritz.ts:347-355`. | A user may be unable to tell whether two dates or releases used comparable rules. | Migration and replay code must infer version from mixed fields. | Persist `challenge_version`, `rules_version`, `bot_policy_version`, `generation_version`, and content digest as first-class columns. |
| DF-07 | High | Verification | The verifier is strong for modern transcripts but does not store per-action timestamps or client timing evidence. | `packages/game-core/src/dailyFritzTranscript.ts`; `dailyFritzVerifier.ts`; transcript action types. | Time-based rankings or “fastest completion” would not be trustworthy. | Cannot audit timers, idle time, speed manipulation, or replay timing. | Do not rank by time until server timestamps every accepted mutation/action or the product explicitly excludes speed. |
| DF-08 | High | Concurrency / idempotency | `start` relies on a unique database index but does not present a clear atomic create-or-return protocol for simultaneous starts. | `supabase/daily_fritz.sql:35-36`; `/start` route read/create flow. | Double clicking or two devices can produce conflict errors instead of a clean resume. | Unique constraint prevents duplicates but does not guarantee user-friendly idempotent response or preservation of one returned match ID. | Implement a database `get_or_start_attempt` operation keyed by user/date and a stable client operation key. |
| DF-09 | High | Product integrity | The final leaderboard uses `finalScore` as set games won, while `pointDiff` is the domino point differential. Names are easy to confuse. | `dailyFritz.ts:34-53,389-405`; `/complete` lines 1227-1244. | Players may not understand whether rank is based on games, points, skunks, or completion time. | Ranking semantics are encoded in a comparator and special skunk ranks rather than a documented public scoring contract. | Rename persisted fields to `set_games_won`/`set_games_lost`, publish ranking formula, and expose tie-break explanations. |
| DF-10 | Medium | Validation | Run hand normalization checks tile shape and nonempty hands but not full deck conservation, uniqueness, counts, or relation to `deal_size`. | `dailyFritzStore.ts:107-160`. | A corrupted run could fail later in a confusing verifier state. | Invalid JSONB can be accepted into the cache until gameplay fails. | Validate all 28 double-six tiles, ownership partition, dead/locked semantics, and exact deal size at generation and load. |
| DF-11 | Medium | Recovery | LocalStorage recovery is detailed but cross-tab arbitration is absent. | `dailyFritzSessionStorage.ts:145-231`; `useDailyFritzSessionPersistence.ts`; controller refs in `useDailyFritzRunController.ts:65-68`. | Two tabs can both play the same attempt and one can appear stale or lose a move. | Revision checks are per localStorage write, not a server lease or tab leader protocol. | Add BroadcastChannel/tab lease plus server version compare-and-swap. Make stale-tab behavior explicit and safe. |
| DF-12 | Medium | Recovery | There is no offline queue for official hand completion. | `client/src/dailyFritz/api.ts` sends each mutation directly; controller shows record error/retry. | Network loss at hand/game boundary interrupts the daily flow and requires manual retry. | Local state can survive but cannot advance official server state offline. | Add durable pending mutation records with operation IDs, or clearly state online-only behavior and test retry after response loss. |
| DF-13 | Medium | Observability | Event persistence is best-effort and can be dropped on a 2.5-second timeout. | `dailyFritzEventStore.ts:3,44-69`; route calls use `recordDailyFritzEventBestEffort`. | Operators may not see failures that affected players. | Event metrics are not a guaranteed audit ledger. | Use an outbox written in the same transaction as official state; monitor outbox lag and dead letters. |
| DF-14 | Medium | Analytics | The event schema captures operational lifecycle events but not a complete product funnel. | `DailyFritzEventType` includes start/hand/game/complete/failure/retry; no first-move, impression, share, return, or cohort fields. | Product team cannot prove activation, retention, or where players abandon. | Best-of-three decisions would be opinion-driven; process counters reset on deploy. | Add canonical event names and dimensions for challenge/version, user cohort, device, game, hand, and outcome. |
| DF-15 | Medium | Date logic | Streak calculation uses fixed `-08:00` date arithmetic rather than a timezone-aware calendar operation. | `dailyFritzStore.ts:getDailyFritzStreak()` versus `shared/pacificDate.ts` which has offset support. | A DST boundary could produce an incorrect streak. | Calendar-day semantics are mixed with 24-hour arithmetic. | Compare Pacific date keys using calendar date arithmetic or UTC noon normalization; add DST tests. |
| DF-16 | Medium | Product / access | Daily Fritz requires authentication before play. | Route auth handling and server `getAuthenticatedUserId()` checks on `/today` and mutations. | Higher friction than anonymous daily products; acquisition and first-play conversion may suffer. | Anonymous-to-authenticated migration is not evidenced. | Either preserve auth as an intentional competitive choice and measure conversion, or support anonymous provisional play with one-time account binding before leaderboard submission. |
| DF-17 | Medium | Product | The mode has a daily lock and leaderboard, but no evidence of server-side share events, next-day retention, or learning/review analytics. | `shareCard.ts`, leaderboard screens, home timeline; absence of corresponding event types. | Completion may not create a durable return or learning loop. | Cannot distinguish “finished once” from a healthy daily habit. | Instrument the funnel before changing format; add replay/review only after action history is durable and queryable. |
| DF-18 | Low | Code quality | The route file is a large orchestration boundary combining auth, verification, persistence, leaderboard, metrics, and admin operations. | `server/src/http/routes/dailyFritz.ts` contains all endpoint handlers. | Bugs are harder to isolate and operational fixes are riskier. | Tests need broad mocks; transaction boundaries are implicit. | Split commands/query/admin routes and move state transitions into application services. |
| DF-19 | Low | Compatibility | The client completion hash is computed and transmitted, but server completion derives a different server receipt and does not use the client hash as an acceptance check. | Client `api.ts:628-653`; route `/complete` reads `completion_hash` at 1153-1154 but server receipt is created at 1233-1235. | No direct user-visible issue, but the contract implies a protection that is not actually enforced. | Dead/ceremonial input increases confusion and false confidence. | Remove it or verify it against a canonical server recomputation; document it as a diagnostic only. |
| DF-20 | Informational | Testing | Selected unit/integration tests are broad around helpers and verifier behavior, but no repository evidence proves full browser lifecycle, multi-instance race, DB transaction rollback, or load behavior. | 9 targeted files/73 tests pass; test inventory includes verifier, skunk, draw, progress, metrics, storage, and persistence tests. | Regressions can still occur at UI/API boundary. | Passing isolated tests can overstate production readiness. | Add contract, E2E, recovery, security, determinism, and load suites described below. |

---

## 5. Best-of-three assessment

### Is there a real set abstraction?

Yes, but it is distributed. `DailyFritzSetResult` in `server/src/dailyFritz.ts:74-86` explicitly identifies `version: 2` and `format: 'best_of_3'`, contains per-game results, game win counts, point differential, set winner, and skunk metadata. `DailyFritzSetGameResult` has a constrained game number `1 | 2 | 3`.

The set transition function `appendDailyFritzGameToSet()` in `server/src/dailyFritzSkunk.ts:156-236` is the main aggregate rule implementation. The route delegates to it instead of manually calculating game wins. This is good separation of set rules from HTTP plumbing.

The abstraction is incomplete because:

- the set result is persisted inside a generic JSONB attempt result;
- the authoritative hand/game ledger is another structure inside the same JSONB;
- the client keeps a parallel set projection and sends a completion projection;
- current hand progress is a single attempt column rather than a game-scoped progress record;
- game two and three challenge content is derived at request time rather than represented in the run package;
- normalizers can accept stored fields that do not fully agree with recomputed game counts.

### Actual clinch rules

The implementation has more than “first to two games”:

1. **Normal clinch:** two played wins or two played losses, via `resolveDailyFritzSetWinnerFromGames()`.
2. **Game-one skunk:** if the loser ends below 30 (`DAILY_FRITZ_SKUNK_THRESHOLD`), the skunking side immediately gets a mechanical 2–0 set result, with `instantSkunk: true`.
3. **Game-two skunk after a split:** if two games have been played and the score is 1–1, a game-two skunk awards the set to the game-two winner even though the set is not a normal two-win sequence.
4. **Game-three skunk:** recorded for display/ranking; it does not alter the already required decider semantics.

The code comments in `dailyFritzSkunk.ts` state the game-two and game-three intent explicitly. The client’s `record-game` response sets `next_game_number` to `null` whenever `setWinner` is present, so game three is skipped after a clinch.

### What is consistent

- Game numbers are constrained to 1–3 in types, transcript parsing, and the event schema.
- The route checks the incoming game number against `currentSetResult.games.length + 1`.
- The set result contains the complete ordered game list.
- Modern game scores are derived from verified hand authority before the game is appended.
- A completed set is rejected by `/complete` unless `setWinner` exists.
- A completed attempt is replay-safe at the API layer: `/complete` returns the existing completion rather than applying it twice.

### What is inconsistent or fragile

- The persisted `current_hand_index` is shared across all games and reset to zero after each unfinished game. This is valid only if game number and set result are always read atomically with it.
- The server stores `game.seed` as a derived string but does not verify the submitted/recorded seed against the run’s versioned content package at the set transition boundary.
- `normalizeDailyFritzSetSkunkFields()` can honor stored `playerGamesWon`, `fritzGamesWon`, and `setWinner` fields instead of always deriving every value from game records. That is useful for migration, but it makes malformed JSONB harder to detect.
- The legacy replay comparison checks score/moves/hands, not action history or authority, by design. It is not suitable for a competitive result.
- Final `final_score` and `opponent_score` are set-game counts, whereas `point_diff` is domino-point differential. These names are operationally ambiguous.
- The set’s “skunk rank” is a hand-built comparator policy. It is product logic, not merely presentation, but it is not represented as a documented versioned scoring contract.

### Canonical vocabulary recommendation

The product and code should standardize on:

| Term | Canonical meaning |
|---|---|
| Challenge | The immutable date/version/rules/content package available to all players. |
| Attempt | One authenticated user’s one allowed attempt against one challenge. |
| Set | The entire best-of-three daily competition. Exactly one set winner. |
| Game | One game within the set. At most three; may be skipped if the set clinches. |
| Hand | One deal and terminal scoring event within a game. |
| Action | One legal player or Fritz command in a hand transcript. |
| Authority receipt | Server-produced digest and derived result for one verified hand/game. |
| Completion | A server transition from active set to completed set after all required authority exists. |
| Verified completion | Completion whose every required game and hand has modern authority evidence. |
| Leaderboard entry | A verified completion included under the published ranking contract. |
| Streak day | A calendar date on which the user has a qualifying server completion; define whether legacy/unverified counts. |

### Proposed set state machine

```text
not_started
  -> loading_challenge
  -> game_1_active

game_1_active
  -> game_1_active       (verified hand accepted)
  -> game_1_complete     (terminal game authority accepted)
  -> abandoned           (explicit abandon or expiry policy)
  -> incompatible_version

game_1_complete
  -> set_clinched         (normal win/loss or game-one skunk)
  -> game_2_active        (no clinch)

game_2_active
  -> game_2_active         (verified hand accepted)
  -> game_2_complete       (terminal game authority accepted)
  -> abandoned
  -> incompatible_version

game_2_complete
  -> set_clinched          (normal two-win or game-two skunk rule)
  -> game_3_active          (1–1 without special clinch)

game_3_active
  -> game_3_active          (verified hand accepted)
  -> set_clinched            (terminal game authority accepted)
  -> abandoned
  -> incompatible_version

set_clinched
  -> submitting

submitting
  -> verified                (server transaction commits completion)
  -> submission_failed       (retryable; attempt remains active or pending)

verified
  -> verified                 (idempotent replay only)

submission_failed
  -> submitting
  -> abandoned               (only if policy permits; never after committed completion)
```

Invalid transitions should include: starting a second attempt for the same user/day; recording game 2 before game 1; recording a hand for a non-current game; completing without set clinch; changing challenge/rules/policy version mid-attempt; accepting a transcript with an already-used action/hand operation key but different digest; and advancing after completion.

### Recommendation on the format

**Preserve the best-of-three model with substantial changes, and run a measured best-of-one experiment before permanently committing to it.** The code indicates that three games are intended to create a benchmark and accommodate skunk/decider drama. It does not yet prove that the three-game cost creates more retention or better skill signal than one deliberately designed game. The current path already supports a 2–0 early finish, which protects pacing. The next product decision should be evidence-led rather than a broad rewrite.

---

## 6. Wordle and Chess.com benchmark

This comparison is about product principles and system quality, not visual imitation.

| Product principle | Daily Fritz today | Wordle or Chess.com standard | Gap | Recommended response |
|---|---|---|---|---|
| Immediate understanding | Hub has a Daily Fritz CTA and set framing, but authenticated initialization and best-of-three terminology add cognitive load. | One obvious daily objective and immediate context. | Medium | Put “Today’s set: win 2 games” and current stakes above the CTA; explain one attempt and game count in plain language. |
| Low friction | Authentication is required before the challenge can start. | Wordle begins anonymously; Chess.com can preserve account continuity but supports quick entry. | High for acquisition | Measure auth-to-start conversion; consider provisional anonymous state or make auth value explicit. |
| Same global challenge | Date seed and stored run provide a common server package; games 2/3 are regenerated from server code. | Same puzzle/position with durable historical reproducibility. | Medium | Store immutable full challenge package and content digest. |
| Scarcity | Unique `(run_date,user_id)` attempt and completed/abandoned lock. | One daily attempt is clear and socially legible. | Low/medium | Publish retry/abandon rules and expose verified status. |
| Trust | Modern action transcript is replayed server-side; legacy path remains. | Mature competitive products make authority and anti-cheat boundaries clear. | High | Remove legacy competitive acceptance and document verification contract. |
| Progress clarity | Between-game overlays and set result exist; game count is tracked. | Wordle’s progress is extremely simple; Chess.com clearly shows game state and result. | Medium | Always show “Game 1 of up to 3,” set score, and clinch condition in one persistent compact area. |
| Completion moment | Final overlay, rank/leaderboard preview, streak, share text. | Wordle has memorable result/share; Chess.com has detailed post-game result/review. | Medium | Make the set result a canonical receipt with games, score formula, rank/percentile, and replay/review path. |
| Learning value | Hand result and board history exist, but no authoritative strategic review was established. | Chess.com offers review and learning feedback. | High | Add optional post-set review after authority storage is queryable; avoid fake analysis before then. |
| Sharing | Browser share/clipboard text is present. | Wordle share is standardized and low-friction; Chess.com shares meaningful game context. | Medium | Add share event, challenge ID, result encoding, and privacy-safe canonical card. |
| History | API history and leaderboard routes exist. | Mature products provide longitudinal stats and reliable historical records. | Medium | Add verified/unverified distinction, games-by-date, win/skunk/point distributions, and replay links. |
| Return motivation | Streak and home personalization exist. | Daily products make tomorrow salient and measurable. | Medium/high | Add countdown/next-day promise and measure next-day return; do not assume streak is retention. |
| Competitive legitimacy | Verified leaderboard sorting exists with skunk tie-breaks. | Chess.com ratings/rankings are clearly defined and monitored. | High | Publish ranking formula/version; add percentile and audit trail; keep unverified out everywhere competitive. |
| Cross-device continuity | Server attempt plus local checkpoint supports resume. | Mature products resume from server state with conflict handling. | Medium/high | Add server version/CAS and cross-device conflict UI. |
| Failure handling | Retry overlays and local recovery exist. | Mature products make network interruptions and duplicate requests invisible. | Medium/high | Add transactional idempotency and test response-loss/restart/multi-instance scenarios. |
| Analytics | Operational event journal exists; product funnel/retention events are absent. | Mature products can measure activation, retention, and abuse. | High | Add canonical analytics schema before format experimentation. |

The most important conclusion is that the mode has a credible **technical nucleus** but not yet a credible **public promise**. A user can be told “same daily set, verified result, one attempt” only after challenge immutability, protocol gating, and completion semantics are made explicit and testable.

---

## 7. Trust and verification assessment

### Determinism

The seed path is date-derived:

- `getDailyFritzSeed(runDate)` returns `daily-fritz-${runDate}` (`server/src/dailyFritz.ts:95-97`).
- `getDailyFritzGameSeed()` appends `:game:${gameNumber}` (`:99-101`).
- draw winner and draw tiles use deterministic random labels (`:103-177`).
- game-one deal generation uses `createDeterministicDoubleSixDeal()` for 12 hand indices (`:290-311`).

This is a strong deterministic design within a fixed code/version/runtime. The weak point is the challenge package boundary: game-one deals are stored, but later game deals are generated on demand by code. `metadata.version: 2` and game seed metadata exist, but the SQL run table does not enforce or separately index generation/rules/policy versions.

Object ordering and floating-point concerns are low for the visible seed functions because game-core random/deal logic appears integer/seed based, but this audit does not claim cross-runtime equivalence without a cross-runtime fixture test. Add a golden challenge fixture that serializes every tile and draw for all three games and compare Node/browser/shared-package output.

### Server authority

The modern verifier is the strongest part of the design:

- `DailyFritzTranscript` has bounded size, strict protocol/rules/policy versions, challenge/attempt/game/hand identity, ordered action indexes, actor types, and legal tile/position shapes.
- `createOfficialDailyFritzHandState()` constructs initial state from the server run/deal and winning-score configuration.
- `verifyDailyFritzHand()` replays actions via shared `applyGameCommand`, checks actor ownership and expected action order, validates hand completion, and derives scores.
- Fritz actions are checked against the official policy in `fritzPolicy.ts`, including deterministic scoring/tie handling.

This substantially reduces client tampering. It is materially stronger than accepting a final score or trusting a client-generated hash.

### What is not verified

The verifier does not verify or persist:

- per-action timestamps;
- client wall-clock duration;
- UI presentation sequence;
- client animation correctness;
- every client state snapshot as an audit record;
- a cryptographically signed challenge token;
- a complete normalized relational replay artifact separate from attempt JSONB.

That is acceptable if Daily Fritz ranks only verified outcome and not speed. It is not acceptable if future product language implies fastest, no-pause, or anti-cheat timing legitimacy.

### Threat model

| Threat | Current result | Severity | Rationale |
|---|---|---:|---|
| Edit localStorage | Modern submission still needs a server-valid transcript and current attempt state. | Low/Medium | Local state can cause UX trouble, but not an obvious verified score bypass. |
| Edit network final score | Modern `record-game` derives score from transcript; `/complete` derives from set/ledger. | Low | Legacy path remains the exception. |
| Replay successful submission | Unique attempt, status checks, and replay responses exist; event idempotency is separate. | Medium | Official attempt completion is mostly idempotent; multi-instance race and operation-level idempotency are not fully proven. |
| Submit impossible score | Rejected for modern transcript; score-only legacy can be accepted unverified. | High for public trust, Low for verified board | The system needs one clear policy. |
| Skip game | Game number/order and `setWinner` checks prevent normal skipping. | Low | Needs race tests. |
| Change seed/deal | Client package is not authority; server reconstructs from run. | Low/Medium | Historical regeneration/version gap remains. |
| Change bot policy | Server uses tier/policy; transcript policy version is bounded. | Low/Medium | Policy version should be stored with challenge and attempt as a first-class contract. |
| Accelerate timers | No timer authority is submitted/verified. | Informational | Do not advertise time-based competition. |
| Modify action log | Server replay rejects illegal or inconsistent transcript. | Low | Depends on verifier completeness and shared core parity tests. |
| Use old/custom client | Omitting protocol can enter legacy mode; modern attempts can require upgrade. | High | Public verified-mode boundary is not strict enough. |
| Multiple identities | One attempt per authenticated user, not one human/device. | Medium | Account abuse is outside current domain unless identity controls exist elsewhere. |
| Offline altered result before sync | No official offline completion; sync still verifies modern transcript. | Low/Medium | UX recovery is the main risk. |
| Multiple tabs/devices | Same attempt can race; process-local lock only. | High | Needs distributed CAS/operation identity. |

### Leaderboard integrity

`isDailyFritzAttemptLeaderboardEligible()` requires completed status, `verification_status === 'verified'`, and supported protocol 1 or 2. The leaderboard sorts wins first, then set final score, opponent score, skunk ranks, point differential, and completion time (`server/src/dailyFritz.ts:389-405`). This is a real protection and should be retained.

The leaderboard is not fully auditable yet because:

- ranking formula/version is not stored with each entry;
- `finalScore` naming hides that it is games won;
- completion time is used as a final tie-break but server timing semantics are not described;
- legacy completion can still exist in history/streak surfaces;
- the authority ledger is stored as JSONB and not independently queryable.

### Is it safe to publish a verified leaderboard?

**Not without remediation of DF-01, DF-02, DF-03, and DF-06.** The modern verifier is good enough to support a private beta or carefully monitored leaderboard. A public claim of fully verified global fairness should wait until protocol gating, distributed concurrency, transactional mutation, and immutable challenge versioning are complete.

---

## 8. Reliability assessment

### Recovery behavior by scenario

| Scenario | Expected behavior | Actual behavior from code | Risk | Recommended correction | Required test |
|---|---|---|---|---|---|
| Refresh during game one | Resume exact board/hand. | LocalStorage snapshot is validated against attempt, challenge, fingerprint, and server hand index. | Medium; cross-tab not resolved. | Add server version/CAS and E2E refresh at active, hand-over, and transition phases. | Browser refresh at 3+ lifecycle points. |
| Refresh between games | Resume next game or between-game state. | Server set result determines next game; controller calls start again. | Medium; UI projection can diverge from server. | Make next-game transition a server state, not inferred only from games array. | Complete G1, refresh before G2, resume. |
| Refresh during game three | Resume exact decider. | Same local checkpoint mechanism. | Medium | Add explicit game-number/fingerprint test. | Decider refresh fixture. |
| Browser crash | Recover latest checkpoint. | Synchronous localStorage persistence after transitions; pagehide flush. | Medium; storage unavailable/blocked is silently ignored. | Surface recovery status and retain server last accepted hand. | Kill/reopen browser at action boundaries. |
| Network loss during play | Continue locally, then submit when online or explain pause. | Board may continue, but official hand completion is network-dependent; controller shows retry error. | Medium/high | Durable pending mutations or explicit online-only contract. | Offline at hand completion then reconnect. |
| Server restart | Do not lose accepted progress. | Attempt and ledger are in Supabase; process cache is reconstructible. | Medium; concurrent/in-flight writes not atomic. | Transactional command and recovery reconciliation. | Restart during accepted mutation and poll attempt. |
| Client update during set | Keep compatible state or require safe migration. | Snapshot schema 7 and challenge fingerprint reject incompatible local state; server may require protocol update. | Medium | Persist protocol/version and provide explicit resume/upgrade state. | Deploy version fixture with old snapshot. |
| Login after anonymous start | Bind provisional state to account. | Daily Fritz server routes require authenticated user; anonymous start path not evidenced. | High for anonymous product path | Decide and document auth-first policy or implement binding. | Anonymous start/login matrix. |
| Logout during set | Protect attempt, prevent accidental wrong-user submission. | Auth is checked at mutations; local snapshot remains browser-local. | Medium | Clear/partition local state by user and display interrupted attempt. | Logout/login different account. |
| Second device | Resume same attempt safely. | Server attempt is shared; local board is not. | High | Server revision/CAS and explicit “another device advanced” response. | Two-device race. |
| Multiple tabs | One active writer. | No BroadcastChannel/lease evidence; refs are per React tree. | High | Tab lease plus server operation idempotency. | Two-tab simultaneous hand submit. |
| Replaying after completion | Return same result. | `/complete` handles completed replay and returns rank/preview. | Low/Medium | Add exact response contract and event semantics. | Repeat complete with same/different payload. |
| Submission timeout after success | Retry without duplicate credit. | Complete replay is idempotent; game/hand replay checks exist. | Medium | Use stable operation keys rather than request IDs for all mutations. | Drop response after DB commit. |
| Local/server disagreement | Server wins, stale checkpoint discarded. | Hand index and fingerprint checks provide protection. | Medium | Add visible recovery state and telemetry. | Corrupt local snapshot fixtures. |
| Daily reset during active set | Finish original challenge or close predictably. | Server routes use attempt date for some operations; abandon uses current Pacific date. | High/Medium | Define “attempt belongs to challenge date” and allow safe completion after midnight. | Begin before midnight, finish after reset. |
| Wrong device clock | Use server day. | Server uses Pacific date; client challenge identity is validated against server package. | Low | Add client/server clock skew telemetry if countdown matters. | Fake local clock around midnight. |
| Timezone change | Daily date remains Pacific product date. | Server Pacific date is stable; client identity helper uses run date. | Low | Document timezone. | Change OS/browser timezone. |
| DST transition | Preserve calendar streak. | `getPacificDateKey` is timezone-aware, but streak computation uses fixed offset arithmetic. | Medium | Calendar-date streak algorithm plus DST fixtures. | Spring-forward/fall-back dates. |

### Reliability strengths

- A database unique index prevents duplicate attempts for one user/date.
- The client’s recovery snapshot is more rigorous than a generic localStorage dump.
- Run fingerprints bind local state to the published run.
- Transcript and authority digest replay makes lost HTTP responses recoverable in principle.
- Completed attempts are idempotent at `/complete`.
- Health readiness probes the persisted Daily Fritz metrics view, so a missing event migration is visible to readiness rather than silently ignored.

### Reliability gaps

The key distinction is **recoverable in a single normal client/server flow** versus **correct under distributed failure**. The current system is much better at the former than the latter. In-memory locks, separate PostgREST calls, best-effort telemetry, and JSONB read-modify-write state are the dominant risks.

---

## 9. Analytics and retention assessment

### Existing operational events

`DailyFritzEventType` in `server/src/http/stores/dailyFritzEventStore.ts:7-16` currently includes:

- `attempt_started`
- `hand_verified`
- `next_hand_replayed`
- `game_recorded`
- `attempt_completed`
- `attempt_abandoned`
- `verification_failed`
- `request_failed`
- `retry_request`

Events carry attempt ID, run date, user ID, request ID, game number, hand index, status code, verifier code, transcript digest, idempotency key, payload, and created time. The Supabase migration creates an append-only table, unique idempotency index, operational indexes, and an aggregate metrics view.

The event system is useful for reliability investigations and verifier failure rates. It is not a full product analytics system. Writes are best-effort and the process also maintains in-memory counters. The metrics endpoint returns both runtime metrics and persisted aggregates, but there is no evidence of a warehouse export, cohort query, or dashboard configuration.

### What can currently be measured

With direct database access and reasonable query logic, the system can measure approximately:

- attempts started, completed, abandoned;
- hands verified and verifier failure codes;
- games recorded;
- retry and request-failure events;
- completed verified leaderboard entries by date;
- game-level wins, scores, skunks, move counts, and hand counts from result JSONB;
- completion-based streaks and historical dates;
- rank and leaderboard ordering for completed verified attempts.

These are **available data shapes**, not necessarily already computed business metrics. The repository does not contain evidence of a production report with those values.

### What is not tracked or not reliable enough

The following are not tracked in a canonical, queryable form in the inspected code:

- home impression;
- Daily Fritz hub impression;
- CTA start rate denominator;
- time to first move;
- first move success/failure;
- game-one completion funnel;
- game-two continuation rate;
- game-three continuation rate;
- 2–0 versus 2–1 outcome distribution as a first-class metric;
- share attempts/successes;
- review/replay usage;
- next-day return;
- seven-day retention;
- DAU/WAU cohort retention;
- anonymous versus authenticated conversion;
- client version/device failure rates;
- exact time spent or idle duration;
- daily challenge impression-to-completion rate.

Home timeline events such as `daily_fritz_started` and `daily_fritz_completed` are derived application activity records, not equivalent to a complete analytics funnel. They can support product UI personalization, but they do not establish exposure denominators or retention cohorts.

### Minimal canonical analytics schema

Every event should include:

```ts
type DailyFritzAnalyticsEvent = {
  eventId: string;                 // globally unique producer id
  eventName:
    | 'challenge_impressed'
    | 'hub_viewed'
    | 'attempt_started'
    | 'first_move'
    | 'hand_completed'
    | 'game_completed'
    | 'set_completed'
    | 'attempt_abandoned'
    | 'attempt_resumed'
    | 'submission_failed'
    | 'verification_failed'
    | 'share_requested'
    | 'share_succeeded'
    | 'next_day_return';
  occurredAt: string;
  userId: string | null;
  attemptId: string | null;
  challengeId: string;
  runDate: string;
  generationVersion: string;
  rulesVersion: number;
  botPolicyVersion: number;
  gameNumber: 1 | 2 | 3 | null;
  handIndex: number | null;
  setScore: { player: number; fritz: number } | null;
  outcome: string | null;
  clientVersion: string | null;
  platform: string | null;
  operationId: string | null;
};
```

Use the official event table/outbox for server lifecycle events and a separate analytics ingestion path for high-volume UI events. Do not overload verifier authority records with product analytics.

### Highest-value experiments

Only run these after the funnel can measure them:

1. **Best-of-one versus best-of-three:** primary metrics: start-to-completion, next-day return, seven-day retention, and verified leaderboard participation; guardrail: average time and abandonment.
2. **Between-game summary depth:** compact summary versus detailed review; measure G1-to-G2 continuation and total completion.
3. **Fixed versus adaptive Fritz policy:** must preserve challenge version and expose policy variant; measure completion, repeat return, and outcome concentration.
4. **Streak visibility:** visible current streak versus subtle streak; measure next-day return, not merely clicks.
5. **Percentile versus raw rank:** measure sharing and return, with fairness/competitive comprehension surveys as qualitative guardrails.
6. **Auth-first versus provisional anonymous onboarding:** measure challenge start and account conversion; never mix unverified anonymous results into the verified board.

Do not experiment with challenge generation, scoring, or protocol behavior through UI flags without versioning the challenge contract. That would contaminate comparability.

---

## 10. Test coverage assessment

### Existing coverage found

The repository contains meaningful Daily Fritz tests:

| Test area | Representative files | What it proves |
|---|---|---|
| Set/skunk rules | `server/src/dailyFritzSkunk.test.ts` | Skunk thresholds, game-one instant skunk, game-two special clinch, ranking fields. |
| Deterministic identity/draw | `server/src/dailyFritzIdentity.test.ts`, `dailyFritzDraw.test.ts` | Challenge identity, Pacific/date/seed and draw behavior. |
| Transcript contract | `packages/game-core/src/__tests__/dailyFritzTranscript.test.ts` | Protocol shape, size, action identity, parsing constraints. |
| Fritz policy | `packages/game-core/src/__tests__/fritzPolicy.test.ts` | Deterministic policy and optimal-play behavior. |
| Server replay | `server/src/dailyFritzVerifier.test.ts`, `http/routes/dailyFritzVerification.test.ts` | Official state and transcript verification. |
| Progress/idempotency | `server/src/http/routes/dailyFritzProgress.test.ts` | Hand progression/replay and result behavior. |
| Persistence normalization | `server/src/http/stores/dailyFritzStore.dealAuthority.test.ts` | Deal authority and normalization behavior. |
| Event persistence | `server/src/http/stores/dailyFritzEventStore.test.ts`, `dbIdempotencySchema.test.ts` | Event write/query contract and migration invariants. |
| Request diagnostics | `server/src/http/routes/dailyFritzRequestDiagnostics.test.ts` | Request ID and diagnostics behavior. |
| Lock helper | `server/src/dailyFritzAttemptLock.test.ts` | Single-process lock behavior. |
| Client persistence | `client/src/modules/daily/dailyFritzSessionStorage.test.ts`, `useDailyFritzSessionPersistence.test.tsx` | Snapshot validation, schema, and persistence transitions. |
| Client hand lifecycle | `client/src/modules/match/hand-lifecycle/dailyFritzHandService.test.ts`, `client/src/modules/player-turn/dailyFritzBlockedHand.test.ts` | Selected client lifecycle/blocked-hand behavior. |
| Home integration | `client/src/home/homeActivityTimeline.test.ts`, personalization tests | Derived home activity behavior. |

The selected server command passed 73 tests across 9 files. That is a useful baseline.

### False-confidence areas

Current tests do not establish:

- one complete real browser journey through all three games;
- game-one skunk and game-two skunk through actual HTTP/database state;
- refresh during each lifecycle phase with real localStorage and API response ordering;
- response loss after an accepted mutation;
- two tabs/devices submitting concurrently;
- two server instances racing on the same attempt;
- Postgres transaction rollback between attempt and event/match writes;
- server restart during a mutation;
- historical challenge replay after generation code changes;
- browser/server/shared-game-core parity across versions;
- leaderboard-only verified entries in a seeded database;
- malformed/corrupt JSONB repair behavior;
- rate limiting, abuse, account farming, and replay attacks at HTTP level;
- load behavior for thousands of simultaneous transcript submissions;
- analytics exactly-once behavior from client retries.

### Required production-grade suite

At minimum, add the fifteen required cases from the product brief:

1. Same date/version produces identical complete challenge package.
2. Different dates produce intended distinct package.
3. All three game packages and draw states are reproducible.
4. 2–0 normal clinch completes correctly and skips game three.
5. 1–1 proceeds to game three.
6. Illegal action rejected.
7. Modified result rejected.
8. Duplicate hand/game/set submissions idempotent.
9. Refresh resumes exact active state.
10. Multi-tab/device conflicts produce one authoritative outcome.
11. Server restart does not lose accepted progress or completion.
12. Historical challenge remains replayable after release.
13. Only verified attempts enter leaderboard.
14. Analytics emit once with correct identifiers.
15. Pacific midnight/DST behavior remains correct.

Add fuzz/property tests for transcript replay and set invariants. Add a contract test that runs the same generated challenge through server and browser-shared game-core fixtures. Add a load test that exercises verifier CPU and database mutation latency, not just socket capacity.

---

## 11. Target architecture

### Domain model

The clean target is a versioned aggregate with explicit child records:

```ts
type DailyChallenge = {
  challengeId: string;
  runDate: string;                 // Pacific calendar date
  generationVersion: string;
  rulesVersion: number;
  botPolicyVersion: number;
  seedVersion: number;
  seed: string;
  tier: DailyFritzTier;
  dealSize: 7 | 14;
  winningScore: number;
  games: {
    gameNumber: 1 | 2 | 3;
    seed: string;
    drawWinner: 'you' | 'bot';
    drawTiles: DailyFritzDrawTiles;
    hands: DailyFritzHandDeal[];
    contentDigest: string;
  }[];
  contentDigest: string;
  status: 'live' | 'archived' | 'invalidated';
};

type DailyAttempt = {
  attemptId: string;
  challengeId: string;
  userId: string;
  state: DailyAttemptState;
  revision: number;
  currentGame: 1 | 2 | 3 | null;
  currentHand: number | null;
  setScore: { player: number; fritz: number };
  verificationStatus: 'in_progress' | 'verified' | 'rejected' | 'legacy';
  startedAt: string;
  completedAt: string | null;
};

type VerifiedHand = {
  attemptId: string;
  gameNumber: 1 | 2 | 3;
  handIndex: number;
  transcriptDigest: string;
  actionCount: number;
  playerScoreAfter: number;
  fritzScoreAfter: number;
  terminalReason: 'domino' | 'blocked';
  verifierVersion: number;
};

type VerifiedGame = {
  attemptId: string;
  gameNumber: 1 | 2 | 3;
  playerScore: number;
  fritzScore: number;
  pointDiff: number;
  playerWon: boolean;
  handReceiptDigests: string[];
  resultDigest: string;
};
```

### State ownership

- **Shared game core:** tile model, legal actions, scoring, command application, transcript schema, deterministic Fritz policy.
- **Challenge service:** immutable date/version/package generation and content digest.
- **Attempt command service:** start, accept hand, record game, finalize, abandon, with database transactions and optimistic revision.
- **Verifier:** pure replay of one hand plus aggregation helpers; no HTTP or persistence dependencies.
- **Client:** render server package, collect actions, persist provisional checkpoint, submit idempotent commands, present recovery states.
- **Analytics:** append event/outbox layer, never authority.
- **Leaderboard query:** read only verified finalized attempts under an explicit ranking version.

### Persistence model

Preferred tables:

- `daily_challenges`: one immutable row per date/version.
- `daily_challenge_games`: three rows per challenge.
- `daily_challenge_hands`: precomputed hand packages or content digests.
- `daily_attempts`: one row per user/challenge with revision and explicit state.
- `daily_attempt_games`: one row per recorded game.
- `daily_attempt_hands`: one row per accepted hand receipt.
- `daily_attempt_operations`: idempotency key, request, digest, result, status.
- `daily_events_outbox`: transactional product/operational events.

If JSONB is retained for migration speed, it must have an explicit schema version, a strict parser, a content digest, and a database-side revision check. A generic `result` blob should not be the only durable representation of the official set.

### Command interface

```ts
type AcceptHandCommand = {
  attemptId: string;
  operationId: string;
  expectedRevision: number;
  challengeId: string;
  gameNumber: 1 | 2 | 3;
  handIndex: number;
  transcript: DailyFritzTranscript;
};

type RecordGameCommand = {
  attemptId: string;
  operationId: string;
  expectedRevision: number;
  gameNumber: 1 | 2 | 3;
  terminalHandDigest: string;
};

type CompleteAttemptCommand = {
  attemptId: string;
  operationId: string;
  expectedRevision: number;
};
```

Every command should either return the committed result or the previous committed result for the same operation ID. A different payload under the same operation ID must be rejected.

### Verification model

The server should verify every hand before making it visible as progress. `record-game` should only aggregate accepted hand rows. `/complete` should be a small transaction that checks the set state and creates the final receipt; it should not accept client score/move claims at all.

### Versioning model

Version challenge content separately from:

- rules version;
- transcript protocol version;
- Fritz policy version;
- ranking formula version;
- client compatibility range.

Historical challenge rows must remain immutable. If a bug requires invalidation, mark the challenge invalidated and publish a replacement date/version rather than silently regenerating the same identity.

---

## 12. Prioritized remediation plan

### Phase 0: Critical correctness and integrity

| Task | Scope/files | Dependencies | Risk | Expected impact | Tests | Acceptance criteria |
|---|---|---|---|---|---|---|
| Enforce modern protocol | `dailyFritz.ts` routes, client API contracts, policy module | Decide legacy sunset policy | Medium | Removes ambiguous unverified competition | Omitted protocol rejected; current protocol accepted | New attempts cannot enter score-only flow; legacy rows remain read-only and clearly labeled. |
| Make completion server-only | `/complete`, client API/controller | None | Low | Removes ceremonial trust input | Mutated final score/hash ignored or rejected | Completion derives only from verified set/game/hand rows. |
| Add transactional attempt command | store/routes/SQL RPC | Database migration | High | Prevents partial progress and race corruption | rollback, duplicate command, response loss | One command commits state + operation receipt atomically. |
| Add revision/CAS | attempts table and all mutations | Transaction command | Medium | Protects multi-device/tab writes | concurrent same-revision commands | Exactly one mutation commits; other returns current state/conflict. |
| Publish challenge package | generator/store/schema | Versioning decision | Medium | Guarantees same immutable content | golden fixtures, historical replay | All three games and content digests stored or provably reproducible by version. |

### Phase 1: Architecture consolidation

| Task | Scope/files | Dependencies | Risk | Expected impact | Tests | Acceptance criteria |
|---|---|---|---|---|---|---|
| Extract application service | split `server/src/http/routes/dailyFritz.ts` | Phase 0 state commands | Medium | Smaller route boundary, testable orchestration | service integration tests | Routes only authenticate/parse/respond. |
| Normalize set/game/hand model | SQL tables or strict aggregate schema | Challenge/attempt versioning | High | Clear support/replay semantics | invariant/property tests | No duplicate authoritative score fields without derivation rules. |
| Consolidate vocabulary | client/server types and API names | Domain model | Low | Fewer hand/game/match ambiguities | contract compile/test | Public/API fields say `setGamesWon`, not ambiguous `finalScore`. |
| Version ranking | ranking module/schema | Product ranking decision | Low | Historical fairness | fixture ordering tests | Every leaderboard row identifies ranking version. |

### Phase 2: Reliability and recovery

| Task | Scope/files | Dependencies | Risk | Expected impact | Tests | Acceptance criteria |
|---|---|---|---|---|---|---|
| Durable operation retry | client API/controller, operation table | Transaction command | Medium | Response-loss invisibility | drop-response tests | Retry returns same receipt/result. |
| Cross-tab/device arbitration | localStorage/BroadcastChannel, server CAS | Revision/CAS | Medium | Prevents stale writers | two-tab/device E2E | Stale client receives recoverable conflict, never overwrites accepted state. |
| Reconcile verified match | match persistence and attempt transaction | Transaction command | Medium | Consistent status across records | failure injection | Attempt and match status cannot diverge silently. |
| DST/calendar tests | streak/date modules | None | Low | Correct daily habit semantics | DST fixture suite | Consecutive Pacific dates work through both transitions. |
| Outbox monitoring | event store/health/ops | Transaction | Medium | Complete observability | outbox retry/dead-letter tests | Event delivery lag and failures are measurable and alerted. |

### Phase 3: Product experience

| Task | Scope/files | Dependencies | Risk | Expected impact | Tests | Acceptance criteria |
|---|---|---|---|---|---|---|
| Clarify set stakes | hub/board/overlays | Stable domain state | Low | Less cognitive load | visual/E2E assertions | Player always sees game number, set score, clinch rule, and remaining games. |
| Improve completion receipt | final overlay/share/leaderboard | Ranking/version contract | Low | Stronger completion/share moment | UI tests | Receipt explains set result, game sequence, skunks, rank/percentile, and tomorrow. |
| Add authoritative review | transcript/hand storage and viewer | Durable hand records | Medium | Learning loop | replay determinism tests | Review reproduces exact accepted game without trusting client state. |
| Decide auth strategy | onboarding/API | Analytics | Medium | Better start conversion or clearer competitive contract | funnel E2E | Auth-first or provisional flow is explicit and measured. |

### Phase 4: Analytics and experimentation

| Task | Scope/files | Dependencies | Risk | Expected impact | Tests | Acceptance criteria |
|---|---|---|---|---|---|---|
| Canonical event schema | event store/client analytics | Outbox | Medium | Measurable funnel | exactly-once/contract tests | Every event has challenge/version/attempt/game identity. |
| Funnel dashboard/query | SQL/reporting | Event schema | Low | Actual activation/retention evidence | seeded fixture queries | Start, completion, abandonment, continuation, return, and share metrics queryable. |
| Format experiment | challenge assignment/config | Analytics and ranking isolation | High | Evidence for best-of-one/three | experiment contamination tests | Variant is immutable per attempt and excluded from incompatible leaderboards. |

### Phase 5: Optimization and polish

| Task | Scope/files | Dependencies | Risk | Expected impact | Tests | Acceptance criteria |
|---|---|---|---|---|---|---|
| Load profile verifier | server verifier and DB | Stable command path | Medium | Known capacity and latency | load test | Published p95/p99 and safe concurrency envelope. |
| Reduce JSONB/read cost | stores/query indexes | Normalized model | Medium | Better operational scale | query plan tests | History/leaderboard queries remain bounded under realistic data. |
| Clean legacy/dead paths | old fields/compatibility code | Protocol sunset | Medium | Less maintenance risk | full suite | Legacy path removed or explicitly quarantined. |

---

## 13. Keep, refactor, remove, rebuild

### Keep as-is

- Date-based challenge identity and Pacific timezone resolution, subject to DST test improvements.
- Shared `@racehorse/game-core` command replay and transcript parser.
- Server-side Fritz policy evaluation and deterministic tie handling.
- Strict transcript bounds and action sequencing.
- One-attempt-per-user/day database uniqueness constraint.
- Run invalidation concept and immutable live/archived/invalidated status model.
- LocalStorage recovery checkpoint validation: attempt ID, challenge ID, run fingerprint, schema, hand index, revision.
- Set rule isolation in `dailyFritzSkunk.ts`, including explicit skunk semantics, after formalizing the product contract.
- Verified-only leaderboard eligibility.
- Idempotent completed-attempt replay behavior.
- Event idempotency key and persisted aggregate view as an operational foundation.
- Readiness probe for the Daily Fritz event migration.

### Refactor

- Split `server/src/http/routes/dailyFritz.ts` into public query, attempt command, leaderboard, and admin route modules.
- Replace ambiguous `finalScore`/`opponentScore` names with set-games terminology.
- Move challenge/run version fields from loosely interpreted metadata into typed first-class fields.
- Make `readAuthorityLedger()` deeply validate rather than cast raw JSONB arrays.
- Centralize set invariant validation and use it on every load, not only at transition time.
- Replace fixed-offset streak arithmetic with calendar date-key arithmetic.
- Make client controller operations explicit commands with operation IDs and server revisions.
- Separate product analytics from operational verifier events.
- Keep legacy compatibility in a quarantined adapter with a clear `legacy_unverified` state.

### Remove

- Client-provided score/final-result fields from the authority decision path.
- Unused/ceremonial completion hash input unless it becomes a verified canonical command digest.
- Any path that silently treats legacy completion as equivalent to verified completion.
- Implicit reliance on process-local locks as correctness protection.
- Ranking semantics hidden only in UI labels or unversioned comparator code.

### Rebuild

- The attempt persistence/transition layer as a transactional versioned aggregate.
- The complete challenge package as an immutable, versioned artifact for all three games.
- The mutation idempotency layer as durable operation receipts.
- Cross-device and multi-tab conflict handling.
- Analytics funnel and retention measurement.
- Post-set review as a server-authoritative replay product.

---

## 14. Final recommendation

Over the next one to three development cycles, Daily Fritz should become a **versioned, server-authoritative daily set with durable replay receipts and measurable return behavior**.

The recommended sequence is:

1. **Close the trust boundary:** current protocol required for new attempts; completion derives only from server authority; legacy results quarantined and clearly labeled.
2. **Make mutations transactional and distributed-safe:** revision/CAS, durable operation IDs, database transaction/outbox, and no correctness dependence on an in-memory lock.
3. **Freeze the challenge:** persist or content-address all three games, rules, draw state, bot policy, and generation versions.
4. **Make the set legible:** show the best-of-three contract, clinch rules, current game, and verified completion receipt clearly.
5. **Instrument before optimizing format:** measure impressions, start, first move, hand/game/set completion, abandonment, resume, share, and next-day/seven-day return.
6. **Only then decide the format experimentally:** preserve best-of-three as the default candidate because the existing code has a coherent set model and early clinch behavior, but compare against best-of-one using verified completion and retention metrics.

The project should not claim “Chess.com-level verification,” “same challenge for everyone,” “anti-cheat leaderboard,” or “high-retention daily mode” until the corresponding evidence exists. It can accurately claim today that it has a deterministic date-seeded daily bot challenge, a server-side transcript verifier for modern attempts, a best-of-three set rules module, database-backed one-attempt locking, local recovery checkpoints, and a verified-only leaderboard path.

That is already a substantial foundation. The next level is not more UI surface area. It is making the existing promise mathematically, transactionally, operationally, and analytically true.

---

## Appendix A: Evidence index

Primary files reviewed:

- `client/src/AppRoutes.tsx`
- `client/src/screens/HomeScreen.tsx`
- `client/src/dailyFritz/DailyFritzScreen.tsx`
- `client/src/dailyFritz/DailyFritzEmbeddedMatchView.tsx`
- `client/src/dailyFritz/useDailyFritzRunController.ts`
- `client/src/dailyFritz/api.ts`
- `client/src/dailyFritz/shareCard.ts`
- `client/src/modules/daily/dailyFritzSessionStorage.ts`
- `client/src/modules/daily/useDailyFritzSessionPersistence.ts`
- `server/src/dailyFritz.ts`
- `server/src/dailyFritzIdentity.ts`
- `server/src/dailyFritzSkunk.ts`
- `server/src/dailyFritzVerifier.ts`
- `server/src/dailyFritzAttemptLock.ts`
- `server/src/http/routes/dailyFritz.ts`
- `server/src/http/routes/dailyFritzVerificationPolicy.ts`
- `server/src/http/stores/dailyFritzStore.ts`
- `server/src/http/stores/dailyFritzEventStore.ts`
- `server/src/shared/pacificDate.ts`
- `server/src/platform/health/registerHealthRoutes.ts`
- `packages/game-core/src/dailyFritzTranscript.ts`
- `packages/game-core/src/fritzPolicy.ts`
- `supabase/daily_fritz.sql`
- `supabase/migrations/2026-07-31_daily_fritz_events.sql`

Targeted tests reviewed/executed:

- `server/src/dailyFritzSkunk.test.ts`
- `server/src/dailyFritzVerifier.test.ts`
- `server/src/http/routes/dailyFritzVerification.test.ts`
- `server/src/http/routes/dailyFritzProgress.test.ts`
- `server/src/http/stores/dailyFritzStore.dealAuthority.test.ts`
- `server/src/http/stores/dailyFritzEventStore.test.ts`
- `server/src/dailyFritzIdentity.test.ts`
- `server/src/dailyFritzDraw.test.ts`
- `server/src/dailyFritzAttemptLock.test.ts`
- `packages/game-core/src/__tests__/dailyFritzTranscript.test.ts`
- `packages/game-core/src/__tests__/fritzPolicy.test.ts`
- `client/src/modules/daily/dailyFritzSessionStorage.test.ts`
- `client/src/modules/daily/useDailyFritzSessionPersistence.test.tsx`

## Appendix B: Evidence boundary

This audit does not claim measured production traffic, users, completion counts, retention, uptime, latency, or concurrency capacity. The repository contains code paths and event schemas for those concerns, but a numerical production claim requires querying the project’s actual Supabase tables, deployment logs, analytics provider, and load-test artifacts. Where this report discusses product quality or risk, those statements are architectural judgments grounded in the inspected implementation, not usage metrics.
