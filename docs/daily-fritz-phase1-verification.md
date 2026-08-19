# Daily Fritz Phase 1 Verification (main)

Date: 2026-08-19
Branch verified: `main`

## Merge proof

Command run:

`git log main --oneline | rg -i "pull request #16|feat/daily-fritz-platform-phase1|phase 1 platform hardening|d943ce4|30953e3"`

Output:

- `d943ce4 Merge branch 'feat/daily-fritz-platform-phase1'`
- `30953e3 feat(daily-fritz): Phase 1 platform hardening — observability, mutations, next_action`

Result: Phase-1 branch content is present on `main` via merge commit `d943ce4`.

## Phase 1 item status

| Item | Status | Evidence on `main` |
|---|---|---|
| 1.1 Unified mutation client: `/start`, `/next-hand`, `/record-game`, `/complete` all share one timeout+retry wrapper | TRUE | Shared wrapper entrypoint remains `timedApiPost` in `client/src/dailyFritz/api.ts` (line 214). All four mutations now use it directly: `/start` (line 466), `/next-hand` (line 625), `/complete` (line 779), `/record-game` (line 807). |
| 1.2 Journal-only evidence: record-game completion passes `officialJournal`, and move-log reconstruction is gated to legacy AND pre-journal only | TRUE | Explicit gate in `client/src/dailyFritz/dailyFritzTranscript.ts`: `useLegacyMoveLogReconstruction = !hasJournal && input.attemptPredatesJournalRollout === true` (line 114), with post-journal hard fail when missing journal (line 116), and journal short-circuit (line 165). Record-game path still passes journal (`client/src/dailyFritz/useDailyFritzRunController.ts` line 373) and legacy gate input (`line 375`). Added test proving journal wins even when legacy-flagged: `client/src/dailyFritz/dailyFritzTranscript.test.ts` line 338. |
| 1.3 Client Sentry: `dailyFritzObservability.ts` exists and is called from saving-timeout and cursor-divergence paths | TRUE | File exists and captures via Sentry: `client/src/dailyFritz/dailyFritzObservability.ts` lines 11, 16; supports `saving_timeout` and `cursor_divergence` (lines 4, 6). Called from saving-timeout path: `client/src/dailyFritz/useDailyFritzRunController.ts` lines 601-602. Called from cursor-divergence path: `client/src/modules/daily/useDailyFritzSessionPersistence.ts` lines 140-142. |
| 1.4 Checkpoint under attempt lock: `dailyFritzCheckpointRoute` wrapped in `withDailyFritzAttemptLock` | TRUE | `server/src/http/routes/dailyFritzCheckpointRoute.ts` imports lock at line 2 and wraps handler logic with `await withDailyFritzAttemptLock(attemptId, async () => { ... })` at line 35. |
| 1.5 Safari fix: `.catch()` on `play()` | TRUE | `client/src/utils/sound.ts` line 224: `void instance.play().catch(() => {});` |
| 1.6 Metrics export: `dailyFritzMetrics` counters persisted anywhere vs in-memory only | TRUE | Source-of-truth contract is now explicit in code: in-memory map is ephemeral cache only (`server/src/http/routes/dailyFritzMetrics.ts` lines 23-24), and increments are mirrored to durable events for canonical dashboard/alerting usage (`line 42`). Durable mapping is centralized in `server/src/http/routes/dailyFritzMetricsExport.ts` via `METRIC_EVENT_MAP` (line 3) with persisted-source comment (line 20). |

## Remaining Phase 1 work (FALSE/PARTIAL only)

- None for 1.1, 1.2, and 1.6 after this pass.
