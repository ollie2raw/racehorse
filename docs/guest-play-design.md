# Guest play: design

Status: approved in direction by the owner on 2026-11-01. Nothing is built. Server and database work waits until after the first tournament week (events Mon 2026-11-02, 18:00 and 21:00 ET).

## Goal

A first-time visitor can play the real Daily Fritz set, and Play vs Fritz, without making an account first. When they create one, the game they just played, their streak and their Games archive come with them. This is the "play first, then save it" flow chess.com-style products use, and it removes the sign-in wall that the 2026-11-01 launch audit flagged as the worst first impression.

## Decisions (owner, 2026-11-01)

1. A guest who upgrades the same day appears on that day's Daily Fritz leaderboard.
2. A captcha protects guest creation.
3. Play vs Fritz guests get their games recorded too, so the Games page fills in after sign-up.

## How it works today (verified in code)

- Every Daily Fritz route needs a signed-in user: `getAuthenticatedUserId` in `server/src/platform/auth/supabaseAuth.ts` resolves a Supabase token to a user id; `dailyFritzTodayRoute.ts:74-79` answers 401 without one.
- The daily set is a server-held run (`daily_fritz_runs`). Deals are handed out one hand at a time, and the verifier replays the player's transcript against the server's own deals. Scores are never trusted from the client.
- A profile row is created by the `handle_new_user` trigger on `auth.users`. It copes with a user who has no username: it assigns `user_<8 hex>` (`supabase/migrations/2026-08-26_signup_profile_username_from_metadata.sql`).
- The client treats a `user_*` username as "no handle chosen yet" and prompts for one (`useAppSessionUi.ts:110`, `isTemporaryUsername`).
- `signUp` in `client/src/auth/useAuth.ts:571` always calls `auth.signUp`, which creates a new user.
- `clearAccountBoundLocalState` already clears Daily Fritz checkpoints, review outboxes and room state when the principal changes, so one account cannot resume another's state.
- The server reads only the user id from `/auth/v1/user`; Supabase also returns `is_anonymous`, which nothing uses yet.
- `game_records` and the review pipeline key on `auth.uid()`, so they work for any authenticated user.

## The design

**Use Supabase anonymous sessions, not a separate guest mode.** An anonymous session is a real authenticated user with no email. Every existing route, the verifier, `game_records` and RLS work unchanged, because the guest has a user id.

1. **Create lazily.** The session is created when the visitor first taps Play on Daily Fritz or Play vs Fritz (`supabase.auth.signInAnonymously`), never on page load. This keeps bots and idle visits from creating rows.
2. **Upgrade in place.** Creating an account while the current user is anonymous calls `updateUser({ email, password })` on that same user instead of `auth.signUp`, so the user id is kept and everything attached to it stays. The handle is then set with the existing `updateUsername` (the `handle_new_user` trigger only runs on insert, so signup metadata is not re-read). Supabase makes the user permanent (`is_anonymous` false) once the email is confirmed; until then the user keeps playing as a guest.
3. **Signing in to an existing account from a guest session** switches users; the guest's game stays on the abandoned guest user. Version 1 says so plainly in the sign-in screen ("This replaces your guest session"). Merging two users' Daily Fritz attempts is out of scope: there is one attempt per user per day, so a merge has no clean rule.
4. **Guests are not ranked and cannot enter tournaments until upgraded.** Enforced in the database, not the client (see G2).
5. **Guest games are recorded like anyone's.** Daily Fritz attempts, transcripts, streaks and `game_records` all attach to the guest user id and become the account's when it is upgraded. Review ("Analyze") works for a guest too.
6. **Guests are cleaned up.** A sweep deletes guest users with no activity for 30 days; all of their rows cascade.

### Why upgraded guests can appear on the leaderboard (decision 1)
The attempt is verified and stored under the user id like any other. Once the user is permanent they pass the eligibility filter and the existing leaderboard query returns them. No copy step.

### Residual risk, accepted and bounded
Guest sessions are free, so one person could play today's set as guest A to learn the deals, then play it again as guest B and upgrade B with a better run. Scores cannot be forged (the verifier replays them); only foreknowledge can. This exposure already exists with email accounts; guests make it cheaper. Mitigations: the captcha (decision 2), Supabase's per-IP limit on anonymous sign-ins, and a lower cap we add on guest creations per day per IP. We monitor attempts-per-IP in the Daily Fritz metrics.

## Interactions to handle

- **Username prompt.** `useAppSessionUi.ts:110` must not prompt an anonymous user to choose a handle; the prompt belongs to the upgrade step.
- **Sign out as a guest** would orphan the session. Replace it with "Create an account to keep your games" and a confirmed "Leave guest session".
- **Native app.** The captcha widget must work inside the Capacitor webview; test on a device before turning it on (Turnstile is the first choice, hCaptcha the fallback).
- **CSP.** The strict CSP needs the captcha provider's script and frame origins.
- **Telemetry.** PostHog and Sentry identify the guest user with a `guest` property, so funnels (guest started, finished, upgraded) can be measured.
- **Moderation and reports** work on the user id and need no change.
- **Privacy.** The privacy policy and the App Store privacy answers get a line about anonymous identifiers; account deletion already covers the user id.

## Delivery plan (one PR per row)

| Phase | Work | Where | When |
|---|---|---|---|
| G0 | Enable anonymous sign-ins in Supabase; enable the captcha provider and add its secret; review the anonymous sign-in rate limit | Owner, Supabase dashboard | any time |
| G1 | Client auth groundwork **behind `VITE_ENABLE_GUEST_PLAY` (off)**: `ensureGuestSession`, `isAnonymous` in auth state, username-prompt suppression, upgrade-in-place in `signUp`, sign-in and sign-out wording for guests, tests with a mocked Supabase client | client only | event week |
| G2 | Migration: `profiles.is_guest` (set by `handle_new_user`, flipped by a trigger on `auth.users` when `is_anonymous` becomes false); leaderboard queries and tournament registration RPCs exclude guests; guest cleanup sweep; server principal helper that returns `is_anonymous`; tests including an authenticated-role RLS probe against a dev project | database and server | after the event week |
| G3 | Guest UI: Daily Fritz and Play vs Fritz buttons start a guest session; after a finished game, "Save this game: create an account"; Games page for guests; replaces the 1.9 "Sign in to play" button | client | after G2 |
| G4 | Captcha widget and CSP; native device test; privacy copy; flip the flag | client, config, docs | after G3 |

The flag stays off until G2 is deployed: without the eligibility filter a guest could appear on the leaderboard under a placeholder name.

## Test plan

- Unit: auth state transitions (none, guest, upgrading, permanent), username prompt suppression, upgrade vs new-signup selection, sign-out wording.
- Database: trigger flips `is_guest` when a user is upgraded; guests are absent from leaderboard and tournament registration; cleanup deletes only inactive guests and cascades.
- End to end (fake backend extended with anonymous users): play a guest Daily Fritz game, upgrade, see it on the leaderboard and in Games; guest cannot register for a tournament.
- Abuse: guest creation over the per-IP cap is refused.

## Open items

- Confirm in the dev project that `updateUser({ email, password })` on an anonymous user behaves as documented with this project's email-confirmation setting.
- Decide the per-IP daily cap for guest creation once there is real traffic data.
- Owner: pick the captcha provider.
