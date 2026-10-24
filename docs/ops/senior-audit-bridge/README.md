# Runtime-validated rating cutover BRIDGE artifact

Deploy exact commit `7f5003404e6e87f06b8d4028130fb213340a77be` from
`release/rating-cutover-bridge-prime` (BRIDGE′). It is historical BRIDGE `3ccd6ff8c73c5cfd0efb24dde83d62cca82f7353`
(`release/rating-cutover-bridge`, **superseded as a deployment artifact: never deploy it or roll back to it**) plus the writer-epoch
support described in [the cutover runbook](../senior-audit-rating-rush-cutover.md). That BRIDGE is in turn based on
historical `e3517fb0da9644ccede64697309d7af8d9ffb8ee`, which is superseded and
**must not be deployed**: it could report drain while ranked catch-up still wrote.
Do not construct or apply a patch. The historical patch beside this README is
not the release artifact.

The committed bridge includes `supabase/migrations/2026-10-13_rating_cutover_gate.sql`.
Apply that pre-expand migration before deploying BRIDGE. No Ghost, Rush, or ranked
expand schema is required. Without the gate row, vulnerable writers fail closed.

Configure `ADMIN_SECRET` before deployment and require a successful authenticated
status request. Close the gate and positively observe all completion, deferred
Ghost, and decay counters drained (catch-up and admin processing use the completion counter) on the same boot before applying any expand.
See [the cutover runbook](../senior-audit-rating-rush-cutover.md) for the exact order.

Authenticated rated human-v-human completions, including manual/disconnect forfeits, and qualifying authenticated Fritz completions
are gated. Boot/periodic/weekly ranked catch-up, admin rating processing and
authenticated Fritz disconnect rating work use the same admission/in-flight
protocol. The disconnect unit starts before pending-match mutation. Guest/unrated private completions are not. Tournament routing is unchanged.

Before Ghost contract, the rollback target is this exact BRIDGE′ commit (never `3a65ab1c` or `3ccd6ff8`), retaining
quiescence/fail-closed behavior while preparing a forward fix. After Ghost contract,
neither OLD nor BRIDGE is an ordinary rollback target; recovery requires a compatible
forward fix or deliberate schema/data restoration.
