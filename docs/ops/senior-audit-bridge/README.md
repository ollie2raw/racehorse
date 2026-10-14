# Runtime-validated rating cutover BRIDGE artifact

Deploy exact commit `e3517fb0da9644ccede64697309d7af8d9ffb8ee` from
`release/rating-cutover-bridge`, based on OLD `18bc747ac7156d0058c5acd9cddcc545660e6e28`.
Do not construct or apply a patch. The historical patch beside this README is
not the release artifact.

The committed bridge includes `supabase/migrations/2026-10-13_rating_cutover_gate.sql`.
Apply that pre-expand migration before deploying BRIDGE. No Ghost, Rush, or ranked
expand schema is required. Without the gate row, vulnerable writers fail closed.

Configure `ADMIN_SECRET` before deployment and require a successful authenticated
status request. Close the gate and positively observe all completion, deferred
Ghost, and decay counters drained on the same boot before applying any expand.
See [the cutover runbook](../senior-audit-rating-rush-cutover.md) for the exact order.

Authenticated rated human-v-human completions, including manual/disconnect forfeits, and qualifying authenticated Fritz completions
are gated. Guest/unrated private completions are not. Tournament routing is unchanged.

Before Ghost contract, the rollback target is this exact BRIDGE commit, retaining
quiescence/fail-closed behavior while preparing a forward fix. After Ghost contract,
neither OLD nor BRIDGE is an ordinary rollback target; recovery requires a compatible
forward fix or deliberate schema/data restoration.
