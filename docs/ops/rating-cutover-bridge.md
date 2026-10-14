# Rating cutover bridge

This bridge is the old rating writer with a durable quiescence gate and
positive in-process drain status. It is a temporary deployment step before the
Ghost, Puzzle Rush, and ranked expand migrations.

The gate covers two legacy completion categories:

- Authenticated human-vs-human completion, including manual/disconnect forfeits. The old path inserts ranked game
  rows and may update both players' Glicko state. Verified move logs may also
  write Ghost training records. These completions are intentionally gated before ranked writes or abandon state.
  A manual leave rejected during quiescence retains its seat and returns a retryable error.
- An authenticated player's Fritz completion when that player has a non-empty
  move log. The old path can insert a Fritz ranked result and starts a deferred
  Ghost training/rating write. This completion is intentionally gated.

Guest-only and authenticated-vs-guest private results are not gated. The old
path does not create ranked results or call `completeGhostGame` for those
matches. Tournament routing remains on its existing path and is unchanged.

## Preconditions

1. Confirm Render is running one server instance and no deployment is in
   progress.
2. Configure a valid `ADMIN_SECRET` on the server service before deploying the
   bridge. If `ADMIN_SECRET` is unset, the status and quiesce routes return
   `401 Unauthorized`; there is no empty-secret access path.
3. Confirm the server and database health checks pass.
4. Have the exact bridge commit SHA and the reviewed expand migration SQL
   available. The bridge commit contains only the pre-expand gate migration;
   Ghost, Puzzle Rush, and ranked expand migrations are applied later.

## Apply the pre-expand gate migration

Apply `supabase/migrations/2026-10-13_rating_cutover_gate.sql` to the target
database before deploying this bridge. This creates the durable gate row used
by the bridge and no rating data is changed.

Deploying the bridge before this migration is an operator error. Rating-
affecting completions and weekly decay fail closed when the row is missing or
unreadable. The process can still serve normal unaffected routes, but the
rating cutover status route will return `503` until the row is available.

## Deploy the bridge

Deploy the exact `release/rating-cutover-bridge` commit selected for the
cutover, not a moving branch tip. Verify the commit SHA in the deployment
record. Wait for the instance to become healthy.

Before beginning cutover, make an authenticated status request and confirm it
returns `200` with `enforcement: "legacy_writers"`. Use the configured admin
secret in the header; do not put it in a URL or command history. For example,
from a shell where `ADMIN_SECRET` is already set in the environment:

```sh
curl --fail --silent --show-error \
  -H "x-admin-secret: ${ADMIN_SECRET}" \
  "${SERVER_URL}/api/ops/rating-cutover/status"
```

This preflight verifies that the route is authenticated, the bridge can read
the gate row, and the operator is addressing the expected server. A `401` or
`503` blocks cutover.

## Quiesce and prove the drain

Close the gate using the authenticated operator endpoint:

```sh
curl --fail --silent --show-error -X POST \
  -H "x-admin-secret: ${ADMIN_SECRET}" \
  -H 'content-type: application/json' \
  --data '{"enabled":true,"reason":"rating cutover"}' \
  "${SERVER_URL}/api/ops/rating-cutover/quiesce"
```

Poll the authenticated status route. Continue only when all of these are true
in the same status response:

- `quiesced` is `true`;
- `enabledInThisProcess` is `true`;
- `completionsInFlight` is `0`;
- `deferredGhostWritesInFlight` is `0`;
- `decayInFlight` is `false`;
- `drained` and `readyForExpand` are `true`.

The bridge increments an operation count before reading the durable fence, so
an operation that already observed the open gate remains visible in the drain
count. Deferred Fritz Ghost writes stay counted until settlement. Weekly decay
is counted from its begin guard and rechecks the fence before every old
unconditional profile write. A missing/unreadable gate row prevents new
rating-affecting work and prevents decay from starting.

If the process restarts after quiescence, the database intent remains closed,
but its boot ID changes. The new process is not considered drained until the
operator re-enables quiescence through the authenticated endpoint and observes
zero in-flight work for that process.

## Apply expand migrations

Only after positive drain has been observed, apply the reviewed expand
migrations in the release plan:

1. Ghost expand.
2. Puzzle Rush expand.
3. Ranked expand.

Do not run an expand migration while `readyForExpand` is false. If an old
rating-affecting completion is attempted during quiescence, it waits and then
reports a visible retryable persistence failure if the gate remains closed; it
does not report a durable success while skipping the rating write.

## Resume on the new writer

Deploy the new atomic-writer server and verify health plus Ghost completion,
Fritz completion, ranked processing, and assigned Puzzle Rush smoke flows.
After confirming the new build is serving traffic, use the authenticated
quiesce endpoint with `{"enabled":false}`. The atomic writer remains safe while
the durable intent is closed; clearing it restores the normal legacy gate
status and is not an admin bypass.

Follow the release plan's observation and contract steps. The Ghost uniqueness
contract remains incompatible with an old server; after it is applied, rollback
must use a forward fix or deliberate schema/data restoration, not an ordinary
old-binary redeploy.
