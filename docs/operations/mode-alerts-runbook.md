# Mode Alerts Runbook

Status: manual configuration required. The repository defines durable event sources and the alert contract; Sentry/monitor ownership and notification destinations must be configured by an operator with production access.

The database events do not automatically become Sentry metrics. Configure database-rate alerts in the production Supabase SQL Editor plus the team's scheduled-query/monitoring service. Configure exception/operational-failure alerts in the Sentry project used by `SENTRY_DSN`. If no scheduled-query service is available, the owner must select one before these alerts can be marked production-verified; a saved SQL query alone is not an alert.

## Required alerts

| Alert | Window / threshold | Source | Initial response |
|---|---|---|---|
| Daily Fritz verification failures | >2% of `hand_verified + verification_failed` over 15m and at least 5 failures | `daily_fritz_failure_metrics` | Group by verifier code/release; disable the new authority path only if the failures correlate with a release and preserving attempts is confirmed. |
| Daily Fritz command conflicts | >1% over 15m and at least 5 | `daily_fritz_failure_metrics` | Check stale revision vs. operation-ID reuse; inspect release and multi-tab rate. |
| Daily Puzzle submission/recovery failures | >2% of `slot_submitted + request_failed + recovery_failed` over 15m | `daily_puzzle_failure_metrics`, `daily_puzzle_event_funnel` | Verify five-slot schema, publication readiness, and server replay rejection codes. |
| Daily Puzzle funnel collapse | `attempt_completed / attempt_started` drops 30% below 7-day same-hour baseline | `daily_puzzle_event_funnel` | Compare slot-level completion to find the first broken slot; verify publication and client release. |
| Multiplayer action rejection spike | `action_rejected / (action_accepted + action_rejected)` >3% over 10m, minimum 20 actions | `multiplayer_operational_metrics` | Split expected validation from persistence/CAS errors; inspect current release. |
| Multiplayer stale-command spike | `stale_command` >2% over 10m, minimum 10 | `multiplayer_operational_metrics` | Check reconnect/replay behavior, client release, and sequence synchronization. |
| Multiplayer persistence failures | any 3 events in 5m | `multiplayer_operational_metrics` | Check Supabase readiness/latency; block new rooms if writes cannot be confirmed. |
| Multiplayer hydration failures | any 3 events in 15m | `multiplayer_operational_metrics` | Inspect snapshot validation code and deployment restart timing. |
| Multiplayer action latency | p95 >750ms for 10m, minimum 50 actions | `multiplayer_operational_metrics` | Check DB RPC latency and Render CPU/event-loop pressure. |
| Migration drift | any failed `verify-application-schema.sql` predeploy check | deployment gate | Stop deployment; apply the reviewed ledger to staging before production. |

## Configuration procedure

1. In the production Supabase project, open **SQL Editor → New query** and save read-only panels for `daily_fritz_failure_metrics`, `daily_puzzle_failure_metrics`, `daily_puzzle_event_funnel`, and `multiplayer_operational_metrics`.
2. In the selected scheduled-query monitor, run the saved alert queries every minute. Use the exact windows/minimum-sample gates in the table above; do not page on percentages below the stated minimum sample.
3. Route Daily Fritz verification/command, Daily Puzzle submission, and multiplayer rejection/latency alerts to the engineering warning channel. Route multiplayer persistence/hydration failures and migration drift to the primary operator/on-call destination.
4. In **Sentry → Alerts → Create Alert → Issues**, add an issue alert for the operational failure names emitted by `recordOperationalFailure`, grouped by `operation`/release. Notify the same destination; Sentry is a secondary signal, not the denominator source for database rates.
5. Attach `release`, event type, failure code, and the privacy-safe room hash to incident context. Never include raw room codes or game state.
6. Send one synthetic event for every alert family, confirm the scheduled monitor fires, and record monitor name, timestamp, recipient, and recovery notification in `IMPLEMENTATION_CHECKLIST.md`.
7. Do not mark alerts `PRODUCTION-VERIFIED` until a real notification is received by the intended human destination.

## Canonical multiplayer formulas

The executable local implementation is `server/src/multiplayer/multiplayerOperationalMetrics.ts`.

- Reconnect success rate = `reconnect_succeeded / (reconnect_succeeded + reconnect_failed)`.
- Stale-command rate = `stale_command / (action_accepted + action_rejected + stale_command + request_id_conflict)`.
- Action-rejection rate = `(action_rejected + stale_command + request_id_conflict) / (action_accepted + action_rejected + stale_command + request_id_conflict)`.
- Hydration-failure rate = `room_hydration_failed / (room_hydration_succeeded + room_hydration_failed)`.
- Persistence-failure rate = `persistence_failed / (persistence_succeeded + persistence_failed)`.
- Persistence p50/p95/p99 use continuous percentiles over non-null `duration_ms` from `persistence_succeeded` events.

The loader caps one read at 50,000 events and reports `truncated=true` when the requested window saturates the cap. A truncated sample must not drive an alert; narrow the window or aggregate in SQL first.

## Operator verification record

Before enabling notifications, record these fields in `IMPLEMENTATION_CHECKLIST.md`:

- Supabase project/environment and schema migration status.
- Saved-query/monitor names and owners.
- Notification destination and backup owner.
- Synthetic trigger timestamp and received-notification timestamp.
- Resolution/recovery notification timestamp.
- Release used for the test.

## Privacy

The multiplayer event writer hashes room codes before persistence. Never add bearer tokens, raw Supabase credentials, hands, or full private game state to event payloads.

## Rollback

Telemetry writes are non-blocking. If event volume or schema health causes operational pressure, disable the call sites in a code rollback while retaining tables for incident analysis. Dropping event tables is not an emergency rollback and requires a separately reviewed migration.
