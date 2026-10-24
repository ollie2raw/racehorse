# Account identity, ownership & data-authorization audit

Branch `audit/account-identity-integrity`, from candidate `ab43d156`. Local only; production not touched.
Question: can one browser/session/account impersonate, inherit, read, mutate, merge with, or receive durable state
belonging to another identity?

## Identity model

| Identity | Created by | Client may choose it? | Trusted? | Persisted | Cleared on logout/switch |
|---|---|---|---|---|---|
| Supabase user id (UUID) | Supabase Auth | no | yes, only via `/auth/v1/user` on the bearer token (`getAuthenticatedUserIdFromToken`, 15s cache) | `auth.users`, `profiles.id` | session cleared by `signOut`; account-bound local state now cleared on principal change |
| email | Supabase Auth | at signup | never used for authority by the server (server never handles email) | `auth.users` | n/a |
| guest id (`guest_…`) | client (`getOrCreateGuestIdentityId`) | yes | **display only**; never durable, never rated | localStorage (by design) | kept (guest identity) |
| guest reconnect capability | server HMAC over (room, seat, guest id, expiry), 24h | no (server-issued) | yes — it is the *authorization* for taking a guest seat back | localStorage `rh:guest-seat:<ROOM>:<id>` | per room |
| socket identity (`socket.data.userId`) | `presence:identify` / room attach, from a verified token or a non-UUID guest label | no for UUIDs (a claimed UUID without a verified token resolves to null) | yes for UUIDs | process memory | **now dropped on a failed/downgraded identify** |
| room seat | server roster; seat ownership = roster socket/identity match | no | yes | room state | on leave/abandon |
| profile/player id | = Supabase user id | no | yes | `profiles` | n/a |
| Daily Fritz / Puzzle Rush / Ghost / history / rating | server, keyed by token user id | no | yes | service-role-only tables | n/a |
| analytics id | `identifyUser(user.id)` | no | n/a | vendor | `resetAnalytics` on null |

Guest ids and account UUIDs are disjoint namespaces: `isGuestSeatIdentity` is false for any UUID, `resolveSocketIdentity`
refuses a claimed UUID with no verified token, `resolveQueueIdentity` rejects it (`not_authenticated`).

## Findings fixed

### A1 — `friends` request recipient could re-point the row at a third account (cross-account durable read)
`friends_update_recipient` pinned `friend_user_id = auth.uid()` and `status`, but the table-level `UPDATE` grant let the
recipient set *any* column. Reproduction (real schema, real roles; test `identityRls…`): mallory1 sends mallory2 a
pending request; mallory2 runs `update friends set user_id = <victim>, status = 'accepted'` → 1 row updated, an accepted
victim↔mallory2 friendship exists, and the `activity_feed` / `rivals` accepted-friend read policies then disclose the
victim's rows to mallory2 (and the victim's friend list gains an account they never accepted).
Fix: `supabase/migrations/2026-10-16_account_identity_rls_hardening.sql` — `revoke update`, `grant update (status)`
(the only column the client writes), nothing for `anon`. Mutation-verified: reverting the grant fails the exploit test.

### A1 — logout / session loss left the socket authenticated as the previous account
`presence:identify` returned early on a null identity without touching `socket.data`, and the client only re-identified
for a *present* user. After sign-out (or expiry/revocation in another tab) the server still held the socket as A:
A stayed "online", A-targeted pushes kept arriving, and `resolveQueueIdentity` preferred the stale `socket.data.userId`.
Fix: server drops the identity (and announces offline if it was the last socket) on any failed/downgraded identify; the
client emits a guest identify when the user id goes non-null → null. Tests: `registerPresenceHandlers.test.ts`.

### A1 — account-bound local state survived logout and was consumed by the next principal
`racehorse_last_room_code` (auto-rejoin with whatever identity is current), `rh_fritz_session` (verified/local match ids
re-submitted under the next user's token), Daily Fritz checkpoints/hub cache, the admin shared secret and the
password-recovery marker were not cleared. Fix: `auth/accountBoundLocalState.ts`, run from `useAuth` on any
non-null → different principal transition (covers sign-out, `SIGNED_OUT` from another tab, expiry, A → B).
Guest identity and UI preferences are intentionally kept. Trade-off: a session that is genuinely lost mid-match no longer
auto-rejoins its room after re-login (the seat itself is still held server-side).

### A1 — `GET /api/ranking/history/:userId` returned any user's full ranked history to any signed-in user
Only token validity was checked. Now `authenticated id === :userId` else 403 (the only client caller is the owner).

### A2 — per-user social feeds returned raw `activity_feed.metadata` (internal match ids)
`/feed` and `/feed/user/:userId` bypassed the whitelist the public feed applies; the whitelist is now applied to every
row not owned by the viewer.

### A2 — `GET /api/daily-fritz/leaderboard/:date` set `Cache-Control: public` on a per-viewer response (`is_current_user`)
Now `private`.

### A2 — e2e identity shim (`Bearer e2e-daily-fritz` + `x-e2e-daily-fritz-user: <uuid>` ⇒ authenticated as any user)
was gated only on `NODE_ENV !== 'production'`; a staging/preview deploy with `NODE_ENV` unset got full impersonation.
Now also refused on any hosted runtime (`RENDER`/`VERCEL`) and when wired to the production Supabase project (unless
`RACEHORSE_ALLOW_PRODUCTION_SUPABASE=1`, the existing explicit opt-in).

### A2 — `daily_puzzles` admin write policies keyed on the JWT *email claim* (`admin@example.com`)
Authority from an email string is only as strong as email verification. Nothing writes this table as a user
(publishing is service-role). Policies dropped and write privileges revoked; the SQL sources no longer recreate them.

## RLS / database authorization

Every table reachable by `anon`/`authenticated` was classified against the real schema built from *all* of
`supabase/*.sql` + `supabase/migrations/*.sql` (`server/scripts/setupIdentityAuditDb.sh`, with Supabase's default
table privileges so RLS + explicit REVOKEs are the only barrier). Result (51 tables, 68 policies):

* server-only (deny-all policy and/or revoked grants): ranked_games, rating_periods, rush_*, puzzle_pool,
  bot_match_pending, mp_authority_events, room_command_receipts, room_live_*, ghost_deferred_completions,
  ghost_cutover_resolutions, rating_cutover_gate, user_reports/blocks, all daily_fritz_* and fritz_challenge_* write paths,
  tournament leases.
* authenticated own-read only: ghost_profiles, ghost_games, matches (participants), daily_puzzle_attempts,
  daily_fritz_attempts, game_reviews, verified_single_player_matches, review_completion_jobs, room_match_logs
  (participants; rows exist only after completion/abandon).
* authenticated own-write, id bound to `auth.uid()`: friends (insert pending / delete / recipient status), rivals,
  player_presence, profiles.username (column grant), matches (own id on one side, other side null).
* public/authenticated read by design: profiles (no email/auth columns), tournaments, daily_puzzles(published),
  daily_fritz_runs/published challenges, player_presence.

RPC trust: the only client-executable non-trigger functions are `ensure_tournament_seed_window`,
`seed_future_tournaments(days)`, `username_policy_violation(text)`, `valid_ranked_rating_context(jsonb)` — all
invoker-rights, none take an identity parameter. Every function with a `user_id`/`player_id`/`profile_id`/`owner_id`
parameter is not executable by `anon`, `authenticated` or `PUBLIC` (asserted structurally and by calling
`complete_ghost_rating_v2`, `register_for_tournament`, `commit_glicko_game_update` as A/anon with B's id: permission denied).

## Server service-role boundary / IDOR

Every durable per-user route derives the actor from the validated bearer token and filters by it (Daily Fritz attempts,
Puzzle Rush runs, Ghost `/start` `/complete` (body id compared to token, `verifiedMatch.userId` compared to token),
game reviews, review jobs, tournaments register/withdraw, friends, moderation, account delete). Real-DB test
(`accountOwnership.postgres.integration.test.ts`): B holding A's attempt/run id gets null, including a smuggled
`&user_id=eq.A` filter. Admin routes are header-secret only and fail closed.

## Guest authority

Guest seat takeover by visible id → `guest_reconnect_denied`; capability bound to (room, seat, guest id, expiry);
wrong room / seat / guest / expired / tampered / truncated / over-long all fail (`guestReconnectCapability.test.ts`);
an account UUID is never a guest identity. Abandon by a non-owning guest socket denied (realtime pass).

## Guest → account

No migration is implemented and none was invented: the guest id is only a fallback while `authUser` is null, guest
seat capabilities and guest identity are untouched by sign-in, no server path accepts a guest id as a durable owner
(guest ids never reach `profiles`, ratings, Daily Fritz, Ghost, Rush or history), so nothing is claimed, orphaned or
duplicated. Intent recorded: guests have no durable state.

## Deferred (not fixed here)

* ~~A2 — recovery-hash login CSRF / session fixation~~ — resolved in the independent review (see Reviewer addendum R3).
* A2 — `POST /api/stats/record-match` accepts solo (`loser = null`) `online` claims unverified → self-inflated
  leaderboard wins. Integrity of one's own record, not cross-account.
* A2 — unauthenticated `GET /api/ghost/profile/:userId` and `/profile-by-username/:username` expose composite logs
  (looks intentional for "play a friend's Ghost"; needs product confirmation) and create a `ghost_profiles` row on GET.
* A2 — unauthenticated tournament bracket exposes `room_code`; joining is participant-gated (`authorizeMatchParticipant`).
* ~~A2 — implicit-flow tokens for non-recovery types left in the URL; no Sentry URL scrubber~~ — resolved in review (R4).
* A3 — un-namespaced local progress (journey/learn/learning/analysis/review snapshots), guest-seat capabilities never
  pruned, raw PostgREST error text returned to clients, `mp-stats` ops info, Supabase `TRUNCATE` default grants
  (not reachable through PostgREST), native `signOut` timeout fallback, `rh:session` cache race on logout.
* Design note: the Ghost writer fence trusts a GUC (`racehorse.ghost_rating_v2`); it is a guard, the real barrier is
  that clients hold no write privilege on those tables (asserted).

## Reproducing

```
# any free loopback port; LC_ALL=C so migrations apply in the same byte order Postgres/CI use
LC_ALL=C PGHOST=127.0.0.1 PGPORT=55439 PGUSER=postgres server/scripts/setupIdentityAuditDb.sh racehorse_identity_audit
IDENTITY_AUDIT_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/racehorse_identity_audit \
  npx vitest run src/identityRls.postgres.integration.test.ts   # 207 tests
```

## Reviewer addendum (independent review + integration gate)

Reviewed `ab43d156..5c7e2b7a`, reproduced against the pre-fix schema/code, then fixed what the audit's own fixes missed.

* **R1 — friends RLS (A1, confirmed, fix verified).** Pre-fix, as role `authenticated`, the recipient's
  `update friends set user_id=<victim>, status='accepted'` returned `UPDATE 1` and exposed the victim's `activity_feed` row;
  `id`/`created_at` were also writable. After `2026-10-16_account_identity_rls_hardening.sql` every such update is
  `permission denied`; accept/block (status), reject/cancel (delete) still work; the migration is idempotent and was applied
  as an upgrade over a pre-fix database. Mutation-verified: restoring the broad `UPDATE` grant fails the suite.
* **R2 — logout socket authority.** The audit's server drop was correct but (a) an in-flight verification of the old token
  completing *after* the sign-out identify re-installed A, and (b) a verification *outage* (thrown fetch error) during A -> B kept
  A on the socket. Fixed: newest identify wins per socket; a thrown verification for a different claimed principal drops the
  held identity. A same-principal token rotation during an outage keeps the account (its own session) and recovers on the next
  identify. A 401/timeout resolves to null and downgrades. Tests: `presenceIdentityTransitions.test.ts` (fails against the audit's handler).
* **R3 — recovery link fixation (A2, resolved).** Impact: the victim's browser becomes signed in as the *attacker's* account
  (login CSRF); it persists across refresh (supabase-js persists the session); anything the victim then creates (games,
  friend requests, Daily Fritz attempts) belongs to the attacker's account and is visible to them. It is **not** takeover of the
  victim's own account. The new-password form could not distinguish a legitimate link (an attacker's own link is a legitimate
  token). Fix (no new crypto, no auth-policy change): the fragment tokens are verified with the auth server (`getUser(jwt)`,
  no session change); the link is adopted silently only if *this browser* requested a reset for that exact email in the last
  hour; otherwise the verified email is shown and the user must confirm. Cross-device recovery still works with one extra tap.
  PKCE (`flowType: 'pkce'` + `exchangeCodeForSession`) remains the architecturally cleaner fix but also requires same-browser
  completion for *every* flow (signup confirm, magic link), changes the callback URL shape, and must be validated against the
  hosted project and the native deep links: an owner decision, not a blocker now.
* **R4 — tokens in the URL.** `detectSessionInUrl` is off and only `type=recovery` is consumed, so a non-recovery
  `#access_token&refresh_token` fragment was a live credential sitting in the address bar/history entry that nothing used.
  It is now stripped at bootstrap (and token query params), and Sentry (`beforeSend`) and PostHog (`sanitize_properties`) redact it.
* **R5 — account switch.** The audit's cleanup ran in a `useEffect`: the first render/child effects with B active still read A's
  room code, Fritz ids and Daily Fritz checkpoints, A's profile stayed on screen until B's hydration finished, and a late
  `refreshProfile(A)` could repopulate A. Cleanup now runs inside `setUser`, the profile resets on principal change, and
  profile writes are dropped for a non-current principal. `accountSwitch.integration.test.tsx` drives the real `AuthProvider`.
* **R6 — signup fallback collision (confirmed).** Two auth users sharing the first 8 hex chars of their id made the second
  signup fail on `profiles_username_key`. Fallback is now `user_` + all 32 hex chars (`2026-10-16_signup_fallback_username_full_uuid.sql`,
  also `schema.sql`); existing profiles are unchanged; human username rules are unchanged.
* **R7 — e2e shim.** Requires explicit `E2E_AUTH_SHIM=1` (set only by `client/playwright.config.ts`), refused on hosted runtimes
  and whenever any production Supabase var is present, **even with** `RACEHORSE_ALLOW_PRODUCTION_SUPABASE`.
* **R8 — per-viewer cache.** `private` alone does not stop the *browser* cache answering account B with account A's cached
  response inside `max-age`; `setPrivateShortCache` now also sends `Vary: Authorization` (leaderboard, Daily Fritz today, stats).

Migrations to apply (manually, no CI runner): `2026-10-16_account_identity_rls_hardening.sql`, then
`2026-10-16_signup_fallback_username_full_uuid.sql`. Both are idempotent.
