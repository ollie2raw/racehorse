# Daily Fritz end-of-hand regression audit

Date: 2026-08-09

## Scope and conclusion

This audit covers the Daily Fritz local checkpoint, resume bootstrap, hand transition,
game recording, set completion, verifier, and transactional command path. It was written
before the corrective implementation.

The recurring modal failures are one class of bug, not a collection of verifier bugs.
The local checkpoint is assembled from three independently updated sources:

1. `dailyFritzHandIndex`, held in React state;
2. `match`, held in `MatchSessionStore`; and
3. `moveLog`, held in `ReplayRecorder`.

`useDailyFritzSessionPersistence` serializes whichever versions happen to be visible in a
render. The snapshot has a local counter named `revision`, but it is not the server attempt's
`authority_revision`. `loadPersistedDailyFritzMatch` checks the attempt, run fingerprint,
policy, game-specific storage key, and equality of the local/server hand index. It does not
bind the snapshot to the server revision, and it does not assert that the match's hand number
belongs to that hand index.

This leaves a hand-boundary window in `applyDailyFritzNextHandResponse`: the response's new
hand index is written to React state separately from the new match being written to the match
store. A render/checkpoint can therefore pair the new index with the old terminal match and
old replay evidence (or the old index with the new match). The former is persistent and
dangerous: after reload, `/start` returns the new server index, the equality-only resume gate
accepts the mislabeled local terminal hand, and `/next-hand` or `/record-game` submits the old
hand's actions against the new official deal.

**Root-cause statement:** The modal gets stuck because a non-atomic local checkpoint can
relabel an old terminal `match`/`moveLog` with a newly committed `currentHandIndex`, and resume
accepts that checkpoint without matching the server `authority_revision` or checking the
match-number/hand-index invariant. This happens whenever a checkpoint is observed while a
hand-boundary response is being applied across the independent React, match-store, and replay
stores. It produces different error messages because the old action stream is replayed against
a different official deal/turn sequence, so the first verifier invariant reached depends on
the tiles, starter, forced draws, and exact interruption timing.

## 1. History reconstruction

### Persistence and resume trail

| Date | Commit | Relevant behavior at the hand boundary |
| --- | --- | --- |
| 2026-07-12 | `2854352` preserve lifecycle and exclude unverified rankings | Introduced structured `active_hand` / `hand_transition` / `completed` snapshots and restored the full local match when its hand index equaled the server index. |
| 2026-07-13 | `7f0f4bd` verify official hands and derive results server-side | Made the replay log into competitive verification evidence for `/next-hand` and `/record-game`. From this point, a torn local match/log checkpoint became an authority failure rather than only a visual resume defect. |
| 2026-07-22 | `562152c` persist Daily Fritz and puzzle sessions | Moved checkpoints to `localStorage` and made writes synchronous. It temporarily allowed a local hand index ahead of the server (`local >= server`), directly allowing local identity to override server identity. |
| 2026-07-23 | `594fa80` ship P1 resume/verifier/protocol hardening | Restored strict hand-index equality and stopped soft init retries from wiping checkpoints. This closed index-ahead snapshots, but equality still could not detect a new index paired with an old match/log. |
| 2026-07-23 | `feafe56` discard stale local match checkpoints | Tightened cleanup and snapshot replacement; did not bind a checkpoint to server revision. |
| 2026-07-23 | `bb313a2` preserve verified hand evidence | Failed closed when a verifier-required transcript could not be built, surfacing corrupted resume evidence rather than silently downgrading it. |
| 2026-07-25 | `be625d7` prevent corrupt hand transcripts | Added move-log canonicalization/duplicate guards and action-order fixes. These repair individual evidence defects after the checkpoint has already been assembled. |
| 2026-07-25 | `e7ea379` prevent resume verification drift | Added run fingerprinting, excluded draw-presentation checkpoints, and reloaded the official hand after deterministic rejection. It still restored full local lifecycle state on hand-index equality. |
| 2026-07-25 | `21f9e60` make hand verification evidence idempotent | Froze completed-hand evidence, deduplicated placements, and improved request idempotency. A frozen torn snapshot remains torn. |
| 2026-07-25 | `c07b063` retire unsafe schema-seven resumes | Invalidated all older draw-race checkpoints. This removed existing corrupt data but did not make future cross-store snapshots impossible. |
| 2026-07-25 | `1f1c103` make attempt transitions atomic | Added server-side compare-and-swap behavior. Server authority became atomic while the client checkpoint remained cross-store and non-atomic. |
| 2026-07-31 | `fe3cc30` preserve transcript protocol on resume | Persisted protocol provenance so a v1 checkpoint was not re-encoded as v2. This fixed one way identical local actions could be interpreted differently. |
| 2026-07-31 | `d64e4c6` harden observability and recovery | Added request diagnostics, event journaling, retry/replay metrics, and verifier-failure events. It made the symptom trail visible but did not reconcile local/server cursors. |
| 2026-07-31 | `b00de7b` pin authority and harden recovery | Pinned policy/run contracts, added transactional authority responses, and turned several mismatches into reload recovery. The client still ignored successful response revisions during checkpointing. |
| 2026-07-31 | `b60f6ed` commit Fritz evidence before cancellable presentation | Reordered Fritz evidence ahead of presentation to close a concrete match-ahead-of-log race. This demonstrates the shared cross-store timing problem but only covers the Fritz action path. |
| 2026-08-01 | `7940dd8` harden transactional authority | Added attempt operations and authoritative revision/operation outcomes. `/start`, `/next-hand`, `/record-game`, and `/complete` return revisions, but the client does not use them to qualify local resume. |
| 2026-08-01 | `1ef7f67` scope outbox idempotency per attempt | Fixed outbox collisions where operation IDs repeat between attempts. This is durable analytics/command plumbing, not the modal root cause. |
| 2026-08-02 | `74c5bc6` tolerate formatted outbox RPCs | Made the migration recognize formatted RPC definitions. It is operationally related to the command path, not client resume identity. |
| 2026-08-03 | `b2a6e77` rebuild incomplete hand transcripts | Stopped verification from the immediate hand-end callback and rebuilt evidence after `incomplete_transcript`. This handles one render-order outcome of the shared race. |
| 2026-08-04 | `888efba` harden transcript recovery | Sorted persisted actions and rebuilt frozen evidence for `wrong_actor`. This handles a second outcome of the same race. |
| 2026-08-04 | `57ba8f1` recover omitted Daily Fritz turns | Let the verifier deterministically insert one omitted Fritz turn before a player action. This handles a third outcome of match state being ahead of replay evidence. |
| 2026-08-07 | `e05adf0` clear rejected resume on reload | Removed a rejected snapshot immediately before reload so the persistence effect could not recreate it. This is recovery after corruption, not prevention. |
| 2026-08-07 | `1b75bb4` preserve turn during forced draws | Fixed an intermediate forced-draw state changing turn ownership. |
| 2026-08-07 | `8121dda` wake Fritz after forced pass | Fixed the frozen Fritz turn seen after the locked-boneyard player pass. It repairs gameplay continuation, but the authority/checkpoint class remains. |

### Requested-file ownership

- `useDailyFritzSessionPersistence.ts` and `dailyFritzSessionStorage.ts` were introduced as
  structured lifecycle persistence in `2854352`, made durable/synchronous in `562152c`, and
  repeatedly hardened by `594fa80`, `feafe56`, `e7ea379`, `c07b063`, `fe3cc30`, and `b00de7b`.
- `dailyFritzHandService.ts` and its tests entered the verified-hand path in `7f0f4bd`, then
  gained evidence failure handling in `bb313a2`, frozen/idempotent evidence in `21f9e60`,
  protocol preservation in `fe3cc30`, and authority pinning in `b00de7b`.
- `useDailyFritzRunController.ts` gained verified `record-game` submission in `7f0f4bd`, set
  resume/finalization handling in `594fa80`, authority recovery in `b00de7b`, and transactional
  response behavior in `7940dd8`.
- `useDailyFritzInit.ts` gained soft-cache resume handling in `594fa80` and telemetry/authority
  initialization in `7940dd8`. It fetches `/today`; it does not reconcile a local match. The
  effective reconciliation occurs later in `useBotMatchBootstrap` after `/start`.
- `server/src/http/routes/dailyFritz.ts` gained verified hand/game endpoints in `7f0f4bd`,
  verifier pinning in `bb313a2`/`ad7f873`, diagnostics in `d64e4c6`, pinned authority in
  `b00de7b`, transactional commands in `7940dd8`, and duplicate terminal-game replay in
  `e7c4486`.
- `server/src/dailyFritzVerifier.ts` gained server replay in `7f0f4bd`, forced-draw inference in
  `0fdf6c0`, protocol/policy pinning in `b00de7b`, and omitted Fritz-turn recovery in `57ba8f1`.
- `server/src/http/stores/dailyFritzCommandStore.ts` was introduced in `7940dd8`; `1ef7f67` and
  `74c5bc6` corrected outbox scoping and migration compatibility.

## 2. Complete state model

### Client beliefs

```text
                           /start response
                 (attempt, game, hand, scores, revision, deal)
                                      |
                                      v
  useDailyFritzRunController.activeRun / dailyFritzPackage
     believes: attempt + current game; keeps the original response revision
                                      |
            +-------------------------+--------------------------+
            |                         |                          |
            v                         v                          v
  React dailyFritzHandIndex   MatchSessionStore.match    ReplayRecorder.moveLog
  updated from next-hand      updated by game engine     appended independently
  response                    and next-hand deal         and subscribed separately
            |                         |                          |
            +-------------------------+--------------------------+
                                      |
                                      v
                    useDailyFritzSessionPersistence
             serializes the versions visible in one render
                                      |
                                      v
             localStorage snapshot (local revision only)
                                      |
                                      v
                  useBotMatchBootstrap on reload
       accepts snapshot when local hand index == /start hand index
       then restores local match + move log + modal hand result
```

The hand-over modal reads `handReveal` restored from `handResult`, `match.gameOver`, and
`handAdvanceError` from `useHandLifecycle`. The set/game-over overlay independently reads
`match.gameOver`, `ghostResultError`, and the run controller's `setOverlay`. Thus authority,
board lifecycle, transcript, and error presentation are not read from one reconciled object.

### Server authority

```text
daily_fritz_attempts
  status
  current_game_number
  current_hand_index
  revision
  result.active_game scores
  result.authority.hand receipts
  result.authority.game receipts
             |
             v
daily_fritz_attempt_operations
  (attempt_id, operation_id, request_digest, expected revision, outcome)
             |
             +-- hand:G:H  -> accept_verified_hand
             +-- game:G:record -> record_verified_game
             +-- finalize:set -> finalize_verified_attempt
```

`commit_daily_fritz_attempt_command` is the atomic server reconciliation point. Its revision
is returned by all successful transition endpoints, but that cursor is not currently carried
through the client checkpoint.

### Hand transition

```text
PLAYING hand H at server revision R
  |
  | final action: ReplayRecorder append and MatchSessionStore terminal update
  v
LOCAL HAND_TRANSITION H (modal visible; server is still H/R)
  |
  | after reveal: POST /next-hand
  | expects attempt/game/H and transcript for official hand H
  v
SERVER verify transcript
  |
  +-- terminal game -> 409 "finalize verified game"; client moves to game completion
  |
  +-- non-terminal -> atomic hand:H commit
                       receipt written
                       hand index H+1
                       revision R+1
                       response contains H+1/R+1/deal/scores
                                      |
                                      v
                    CLIENT applies cursor and match separately
                                      |
                                      v
                           PLAYING hand H+1
```

### Game and set transition

```text
LOCAL GAME_OVER at game G, hand H (server still G/H/R)
  |
  | POST /record-game with terminal-hand transcript
  v
SERVER verifies terminal hand, writes hand + game receipt atomically
  |
  +-- set not decided -> game G+1, hand 0, revision R+1
  |                     client shows between-game overlay; Continue calls /start
  |
  +-- set decided -> needs_completion, revision R+1
                        |
                        | POST /complete (idempotent finalize:set)
                        v
                     status=completed, revision R+2
```

### Resume behavior at every interruption point

| Interruption | Server after reload | Existing local snapshot | Required behavior | Current behavior/risk |
| --- | --- | --- | --- | --- |
| Before `/next-hand` is sent | H/R | terminal H/R-base | Restore H evidence and retry once | Restores by index only; no server-revision proof. |
| Request sent, server has not committed | H/R | terminal H/R-base | Same as before-send | Usually works if snapshot is coherent. |
| Server committed, response lost | H+1/R+1 | terminal H/R-base | Reject local; open official H+1 | Index mismatch rejects it. |
| Response received, before local cursor update | H+1/R+1 | terminal H/R-base | Reject local; open official H+1 | Index mismatch rejects it. |
| Cursor updated, before match/log update | H+1/R+1 | may become **index H+1 + terminal match H** | Reject torn checkpoint | Current equality gate accepts it on reload. This is the primary corrupting window. |
| Match updated, before checkpoint update | H+1/R+1 | older terminal H/R-base | Reject old local; official H+1 is safe | Index mismatch does so. |
| New checkpoint updated | H+1/R+1 | active H+1/R+1 | Restore current-hand progress | Works if checkpoint is coherent. |
| Before `/record-game` | G/H/R | completed G terminal evidence | Restore terminal game and retry record | Current loader rejects `completed`; UI relies on other flow and can restart the hand. |
| `/record-game` sent, not committed | G/H/R | completed G | Retry record | Same gap as above. |
| Game committed, response lost | G+1/0/R+1 or needs-completion | completed G | Server game/set identity wins; replay/complete as appropriate | `/start` has enough authority, but local revision is not compared. |
| Record response received, before overlay/local update | authoritative next game/set | completed G | Same as response-lost | Server identity must win. |
| Before `/complete` | needs-completion/R | final set result | Retry finalization | `/start` detects `needs_completion` and auto-finalizes. |
| `/complete` committed, response lost | completed/R+1 | finalizing UI/local completed state | Fetch completed result; never replay a hand | `/complete` is idempotent; hub refresh is the recovery path. |

`useDailyFritzInit` itself only refreshes `/today` and a session cache. On Resume/Start,
`startDailyFritz` fetches server authority, then `useBotMatchBootstrap` separately loads the
local checkpoint. The latter is therefore the actual resume reconciliation point, and today it
uses hand-index equality rather than an authority cursor plus structural invariants.

## 3. Error catalog

### Verifier errors rendered in the hand-over or record-game error surface

| Error/code | State-machine branch | Terminal? |
| --- | --- | --- |
| `Transcript actor does not own the turn ...` / `wrong_actor` | Old/torn actions are replayed against a hand with a different starter or a missing preceding action. | Recoverable by authoritative refresh; rebuilding the same persisted log is not recovery. |
| `Transcript does not complete the hand.` / `incomplete_transcript` | Terminal match state was checkpointed before all terminal replay actions, or wrong-hand actions stop short in the new deal. | Recoverable if a coherent local action stream exists; otherwise authoritative restart. |
| `Transcript action ... is illegal` / `illegal_action` | A tile/position/pass/draw from the old deal is applied to the new official state. | The submitted evidence is invalid, but the attempt is recoverable by discarding that hand checkpoint. |
| `Fritz action does not match the official policy ...` / `fritz_action_mismatch` | Persisted Fritz action was chosen from a different pre-state/deal. | Recoverable by authoritative refresh. |
| `Fritz state diverged before action ...` / `fritz_state_mismatch` | Action fingerprint belongs to a different/torn pre-state. | Recoverable by authoritative refresh. |
| `Transcript contains an action after hand completion.` / `post_terminal_action` | Wrong-hand stream reaches a terminal state earlier than the local stream, or legacy recovery actions trail a terminal play. | Recoverable checkpoint mismatch, not a terminal attempt failure. |
| `Fritz action is missing its official pre-action state fingerprint.` / `missing_fritz_state_digest` | Resume re-encodes incomplete/legacy evidence under a pinned digest contract. | Client update or authoritative restart; not a reason to strand the modal. |
| policy version/contract mismatch | Local snapshot provenance differs from the pinned attempt. | Recoverable by authoritative refresh; current policy gates already reject most of these. |
| challenge/attempt/game/hand mismatch | Transcript envelope identity differs from route authority. | Challenge/attempt mismatch can be terminal integrity failure; game/hand mismatch is normally stale local state. |
| malformed transcript / missing placement | Cross-store log lacks required evidence. | Recoverable by authoritative restart; not retryable with identical data. |

### Route/command and presentation errors

| Error/state | Cause | Classification |
| --- | --- | --- |
| `Daily Fritz hand/game is no longer current.` | Request was built from an older client cursor after another request/session advanced authority. | Expected idempotency/reconciliation case, not a terminal modal error. |
| `verified_hand_conflict` | Same hand operation ID already committed with a different transcript digest. | Authoritative refresh; do not keep retrying local evidence. |
| `stale_revision` / `command_slot_conflict` | Transactional command raced with an already committed transition. | Authoritative refresh. |
| `Daily Fritz game is complete; finalize the verified game.` | `/next-hand` was called for a terminal game. | Normal branch to `/record-game`, not failure. |
| `Daily Fritz game was already recorded with a different result.` | Local completed-game evidence differs from the durable receipt. | Authoritative set result wins. |
| `Game saved, but the next match could not be determined.` | Successful record response lacked `next_game_number`. | Server contract failure; retry/fetch authority. |
| `Could not start the next hand. Tap Continue to retry.` | Server response arrived but local match no longer satisfied `canApplyNextHand`. | Client transition divergence; requires reconciliation, not blind retry. |
| network/timeout copy (`Couldn't load the next hand...`) | No authoritative outcome is known. | Transparently retryable with the same operation identity. |
| `record-error` / `final-error` overlays | `/record-game` or `/complete` rejected/failed. | Network errors are retryable; authority conflicts require refetch. |

The server telemetry taxonomy currently labels challenge/start/verification/command/
persistence/recovery/submission/unknown, but the modal does not emit one event containing the
transition phase plus client and server cursors. Existing recovery events therefore show that
recovery happened without proving which independent belief diverged.

## 4. Correctness requirements for the fix

1. A local snapshot must be bound to the server `authority_revision` from which its current
   hand began. The snapshot's local monotonic write counter must have a different name/role.
2. Game number, hand index, and authority revision must be treated as one authority cursor and
   updated together from `/start`, `/next-hand`, and `/record-game` responses.
3. Persistence and load must reject a checkpoint unless
   `match.handNumber === currentHandIndex + 1`; a boundary render that mixes old/new stores must
   not overwrite the last coherent checkpoint.
4. `/start` is the resume reconciliation point. Server attempt/game/hand/revision chooses the
   identity. Local data may resume move state only for that exact cursor.
5. A terminal local checkpoint at the exact server cursor is pending evidence for the current
   official hand. A terminal checkpoint at any other cursor is discarded, never relabeled.
6. Accepted-request/lost-response cases must converge through server idempotency without a
   duplicate hand/game or an error modal.
7. Modal telemetry must include transition phase, endpoint, local cursor, server cursor (when
   returned), lifecycle phase, match hand number, verifier code, and recovery decision.

## 5. Implemented reconciliation and proof

The corrective implementation makes `/start` the single resume reconciliation point. The
client now treats `(gameNumber, handIndex, authorityRevision)` as one server authority cursor.
A local checkpoint is eligible only when all three cursor fields match that response and
`match.handNumber === handIndex + 1`. The local monotonic persistence counter is now named
`checkpointRevision`, so it cannot be mistaken for server authority.

At a live hand boundary, the cursor is committed only if the new official match is accepted by
the match store. The persistence effect refuses to serialize any intermediate render whose
match hand and authority cursor disagree, preserving the last coherent checkpoint. A coherent
schema-8 checkpoint is migrated once by binding it to the `/start` revision; the historical
torn shape is rejected by the structural invariant. Exact-cursor terminal evidence is retained
so `/record-game` can be retried after interruption. A terminal checkpoint at any different
cursor is discarded and the official server state is opened.

The parameterized state matrix in
`client/src/modules/daily/dailyFritzSessionStorage.test.ts` names and covers:

- before `/next-hand` send;
- during an uncommitted `/next-hand` request;
- committed `/next-hand` with response lost;
- response received before local cursor update;
- cursor updated before match state;
- match updated before snapshot persistence;
- coherent new-hand snapshot persisted;
- before and during `/record-game`;
- committed `/record-game` with response lost;
- record response received before overlay update;
- set receipt committed before `/complete`; and
- committed `/complete` with response lost.

The persistence-hook regression test additionally proves that a cursor/match-divergent render
cannot overwrite the last good checkpoint. API conflict tests prove the server's structured
revision/state payload survives the HTTP client, allowing both recovery and telemetry to use
the authoritative cursor rather than parsing display strings.

Production-safe diagnostics now emit the transition phase, endpoint, client cursor, server
cursor/state, lifecycle phase, match hand, HTTP status/code, and recovery decision for modal
failures. The persistence invariant logs and emits recovery telemetry immediately if a live
cross-store divergence is observed.

### Verification on 2026-08-09

- Focused storage/persistence/API retry suite: 4 files, 47 tests passed.
- Daily Fritz client baseline (API, transcript, session storage, lifecycle, and blocked-hand
  coverage): 18 files, 136 tests passed.
- Hand lifecycle behavior script: passed.
- Blocked-hand behavior script: passed.
- Focused server verifier/route/command baseline: 6 files, 47 tests passed.
- Full server test baseline: 53 files, 333 tests passed.
- Client production build: passed (`tsc -b` and Vite).
- Server production build: passed.

The build retains existing Vite warnings for a circular manual chunk, a mixed dynamic/static
import, and large output chunks; none is introduced by this reconciliation change.

## 6. Follow-up fallthrough audit (2026-08-09, before follow-up changes)

The interruption matrix above proved the checkpoint acceptance decision, but it did not prove
every screen-level fallthrough after rejection. Tracing the mounted application found the
following behavior.

### Set receipt committed, `/complete` not yet committed

```text
reload Daily Fritz route
  -> useDailyFritzInit.runInit()
  -> GET /api/daily-fritz/today
  -> server sees attempt.status=started + set_result.setWinner
  -> today response: attempt_status=started, needs_completion=true,
                     current_game_number=null, set_result=<clinched set>
  -> DailyFritzScreen renders the hub
  -> no automatic /start call
  -> player must press "Resume Today's Set"
  -> continueSet()
  -> POST /api/daily-fritz/start
  -> server returns needs_completion=true + attempt/verified-match IDs,
     current authority revision, and the clinched set result
  -> handleStartResponse()
  -> submitSetCompletion(boardContext=false)
  -> POST /api/daily-fritz/complete
  -> on success the controller clears the overlay and refreshes /today
  -> completed hub is rendered
```

Therefore, before the follow-up correction, the player did **not** automatically land on the
completed-result overlay. They first saw the normal hub with a manual Resume action. After
pressing it they saw no error, but completion happened without a visible final-result overlay
and returned them to the completed hub. The local `revision_mismatch` was safely rejected, but
the claimed automatic recovery/player experience was not true.

### Other fallthrough-dependent rows

| Server state after interruption | Actual route-load behavior before follow-up | Missing proof/gap |
| --- | --- | --- |
| Same hand/revision (request never committed) | `/today` renders the hub; Resume manually calls `/start`; exact-cursor terminal checkpoint is then restored. | Storage acceptance was tested, but the Resume-to-embedded-screen path was not independently tested. |
| Next hand committed, response lost | `/today` renders the hub; Resume manually calls `/start`; stale checkpoint is rejected and the official next hand is created. | Rejection was tested, but controller/screen fallthrough was not. |
| Next game committed, record response lost | `/today` renders the hub; Resume manually calls `/start`; game-mismatched checkpoint is rejected and the official next game is created. | Rejection was tested, but controller/screen fallthrough was not. |
| Set receipt committed, completion pending | Manual Resume path above. | Automatic completion and final-result rendering were absent. |
| `/complete` committed, response lost | `/today` returns `attempt_status=completed`; the completed hub renders and its CTA opens the leaderboard. `/start` is not called. | This is clean and authoritative, but it is a hub result state rather than replaying the final modal. |

The follow-up implementation and tests below must preserve the cursor/revision/match-hand
invariants. No recovery path may accept a mismatched local checkpoint to avoid the hub or
spinner.

## 7. Follow-up implementation and actual-browser findings

### Completion fallthrough correction

The route controller now detects `today.attempt_status === 'started'` together with
`needs_completion` and a clinched `set_result`, calls `/start` automatically, opens the embedded
result surface, and calls `/complete` with board context. The visible sequence is the normal
Daily Fritz loading state, then `Posting set…`, then the final Daily Fritz result overlay. It
does not render hub error copy, a blank embedded board, or a manual Retry/Resume action first.
An already committed `/complete` remains authoritative: `/today` renders the completed hub and
does not replay `/start` or `/complete`.

`useDailyFritzRunController.test.tsx` proves all three controller fallthroughs:

- set receipt committed before `/complete`: automatic `/today` -> `/start` -> `/complete` ->
  final result overlay;
- active/next-game authority: manual Resume -> `/start` -> embedded server hand/cursor; and
- `/complete` committed with response lost: completed `/today` state with no command replay.

### Remaining gap found by the manual pass: rejected checkpoint retention

The first actual-browser committed-response-loss reproduction found that reconciliation correctly
rejected the prior terminal hand, but left that rejected value in local storage at checkpoint
revision 19. The authoritative fresh hand began its local counter at zero, so the monotonic write
guard rejected every new save. The screen initially looked correct while storage remained pinned
to the previous hand. The rejection path now removes the mismatched checkpoint before opening the
official hand. A named storage test proves a fresh checkpoint at revision 1 can replace the
rejected revision-19 terminal value.

### Remaining gap found by the manual pass: duplicate forced-draw evidence

The next real interruption run exposed a second, independent exact-once failure. On authoritative
hand index 2 the player had no legal opener, drew exactly one physical tile (`5-5`), and then had
a legal play. The persisted move log nevertheless contained two adjacent player `draw` actions
with identical pre-action hands and boards. The verifier correctly accepted the first mandatory
draw and rejected the second with `illegal_action: Draw is not legal.` This was the source of the
delayed hand-over Retry state that appeared only after the recovered hand finished.

Player forced draws now record each actual draw step with that step's own pre-action snapshot.
The replay recorder also enforces exact-once Daily Fritz evidence: an immediately repeated
draw/pass from the identical pre-action state is ignored, while a legitimate multi-draw chain is
retained because each successive rack differs. This does not relax server verification or infer
an optional draw. The existing local-run ownership token is also checked before starting the
player no-move effect, so a reset presentation flag cannot by itself create a second draw run.

The focused actual-browser rerun proved:

- `/start` returned authoritative hand index 2, player rack
  `2-6, 0-1, 3-4, 1-5, 1-2, 3-6, 1-3`, empty board, player starter;
- the UI drew the authoritative first boneyard tile `5-5` once;
- the saved checkpoint contained hand number 3, the same rack plus `5-5`, empty board, and one
  (not two) draw entry; and
- the completed recovered hand was accepted by the real verifier as `hand_verified`, with 16
  actions and transcript digest
  `8fe3833df8c6786c06b880e6dd3f426196510da0ca6a9a8ca990163b683f93ab`.

### Updated root-cause statement

The modal got stuck because a hand-boundary interruption could leave rejected terminal state in
the monotonic checkpoint slot, preventing the authoritative replacement from ever persisting,
and because overlapping player no-move capture could serialize one forced draw twice. The exact
visible error depended on timing and hand shape: a stale/torn hand produced actor, policy, or
illegal-action verifier errors; a player-opening hand requiring a forced draw produced a delayed
second-draw `illegal_action`. Reconciliation now removes rejected authority state before saving
the server hand, and move evidence is exact-once at the physical pre-action-state boundary.

## 8. Manual interruption verification (actual local app, 2026-08-09)

This pass used the real Vite client at `127.0.0.1:5174`, the local server at `127.0.0.1:3001`,
real ephemeral Supabase-authenticated users, the published Daily Fritz deal, and the real server
verifier. Requests were held, aborted after commit, or taken offline in Chrome rather than mocked
inside the application. Background checks used Chrome DevTools `Page.setWebLifecycleState` to
freeze the renderer for 1.2 seconds and then reactivate it, which models the stronger mobile-tab
suspension case. Headless Chrome continues to report `document.visibilityState === "visible"`
while explicitly frozen, so command success plus the post-reactivation UI/authority state—not
that DOM property—was used as the lifecycle assertion.

| Scenario | What was done | Expected | Actual |
| --- | --- | --- | --- |
| 1. Before Continue | Waited for the terminal hand reveal, then closed and reopened the tab before auto-advance completed. Repeated four consecutive times at the same boundary. | The same terminal hand remains available; no duplicate transition, error, or lost evidence. | **Pass (4/4).** Every reload restored the same hand-over reveal and clean checkpoint. The fourth reload advanced normally. |
| 2. Mid-`/next-hand` | Held the real request before it reached the server, froze/reactivated the renderer, then closed the tab and reloaded. | Retry/reconciliation opens one coherent hand without an error modal. | **Pass.** Foreground remained clean; reload resumed the same authority cursor and continued play. |
| 3a. `/next-hand` committed, response lost | Let `route.fetch()` commit the command, aborted the response, froze/reactivated, then reloaded. | `/start` authority wins; the stale terminal checkpoint is discarded; no duplicate hand. | **Pass after the rejected-checkpoint fix.** The server hand/cursor and rendered hand matched, the board was empty, and a fresh lower local checkpoint revision persisted. |
| 3b. Network killed as `/next-hand` fired | Took the browser context offline as the transition fired, restored connectivity, and reloaded. | The pending terminal checkpoint retries or reconciles without a stuck modal. | **Pass.** The authoritative next hand opened and later verified successfully. |
| 4. Mid-`/record-game` | Held the real game-record request at the terminal game boundary, froze/reactivated, closed, and reloaded. | The game receipt is not duplicated and set progress is preserved. | **Pass.** Reload rendered the authoritative next-game state directly (rather than replaying the interstitial), with no error text or lost score. |
| 5. Mid-`/complete` | Held the real completion request after the final game receipt existed, froze/reactivated, closed, and reloaded. | Automatic `/today` -> `/start` -> `/complete` recovery ends at the final result with no manual action or error-looking state. | **Pass.** Reload showed only normal loading/`Posting set…` progress, then the final `Daily Fritz result` dialog automatically. There was no hub Resume button, Retry button, error copy, blank board, or user click. |
| 6. Background/foreground at every boundary | At the reveal, pending next-hand, response-loss, pending record-game, and pending complete states, explicitly froze and reactivated the Chrome renderer before continuing. | Suspension does not lose the checkpoint, duplicate a command, or surface an error. | **Pass at all five points.** Each surface was still coherent after reactivation; the subsequent reload/transition checks above also passed. |
| 7. Repeated interruption | Repeated scenario 1 four times consecutively against the same hand boundary. | No second/third-occurrence-only corruption or idempotency failure. | **Pass (4/4).** No error modal, duplicate hand, or progress loss appeared. |

### Fallthrough UI trace observed in the real browser

```text
terminal final game
  -> POST /record-game commits set receipt
  -> POST /complete is held; tab closes
reload
  -> GET /today returns started + needs_completion + clinched set_result
  -> controller automatically calls POST /start (no user action)
  -> /start returns the same attempt IDs, authority revision, and needs_completion
  -> embedded result surface opens
  -> "Posting set…" progress state renders
  -> POST /complete commits/replays idempotently
  -> final Daily Fritz result dialog renders
```

The player therefore lands on the completed-result screen with zero visible error. The only
intermediate state is the intended progress spinner/copy (`Posting set…`); it is not an error,
blank surface, or manual recovery action. A separately verified committed-`/complete` reload
returns `attempt_status=completed` from `/today` and renders the completed hub without replaying
`/start` or `/complete`.

The manual pass also found the two gaps documented in section 7 before the final clean run. They
were treated as product failures, not test exceptions. The final run was performed after both
root-cause fixes and completed every close/reload and lifecycle interruption without a modal
error or verifier rejection.

### Follow-up verification baseline

- Isolated staged reconciliation suite: 8 files, 67 tests passed.
- Isolated staged Daily Fritz client baseline: 20 files, 142 tests passed.
- Hand-lifecycle behavior test: passed.
- Blocked-hand behavior test: passed.
- Full server baseline: 127 shard-files, 652 tests passed.
- Client and server production builds: passed.

The broader client baseline initially caught that exact-once canonicalization treated two legacy
draws with empty/default snapshots as duplicates. That was a real compatibility gap: empty
snapshots mean evidence is unavailable, not that two actions share a pre-state. Exact-once
deduplication now requires non-empty matching hands plus matching board evidence. The named
legacy multi-draw regression test and the full baseline both pass without relaxing the authority
cursor or match-hand reconciliation invariants.
