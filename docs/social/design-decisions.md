# Social System — Design Decisions

Four pre-implementation choices made before the social system was built. These decisions are locked in and reflected throughout the server and client code.

---

## 1. Friend model: mutual (pending → accepted)

**Decision:** Friendships require mutual acceptance. One user sends a request (status `pending`); the other accepts (status `accepted`). There is no one-sided "follow" model.

**Rationale:** Racehorse is a competitive platform. Mutual friends means both players consent to sharing presence, activity feed, and H2H stats with each other. One-sided follows would expose presence data to strangers, which conflicts with the platform's trust model.

**Where it appears:**
- `friends` table schema: `user_id`, `friend_user_id`, `status CHECK('pending','accepted')`
- `getFriendIds()` in `routes.ts` — only returns `accepted` rows
- `GET /api/social/friends/requests` — separates incoming vs outgoing pending rows
- RLS on `activity_feed` — friends query uses accepted status

---

## 2. Public profiles: logged-in users only

**Decision:** All `/api/profile/:username` and social API endpoints require a valid Bearer token (`requireAuth`). Unauthenticated requests receive `401 Unauthorized`.

**Rationale:** Profiles expose ratings, win/loss records, and presence status. Requiring auth prevents scraping and protects players' competitive data from anonymous access. The H2H block also depends on knowing the requestor's identity.

**Where it appears:**
- `requireAuth()` called at the top of every route handler in `routes.ts`
- `fetchPublicProfile()` in `socialApi.ts` sends the Supabase session token via `authHeaders()`

---

## 3. Rival system: auto-assigned from match history

**Decision:** Rivals are not manually chosen. The server computes up to 3 auto-rivals per user by tallying opponent frequency over the past 90 days from the `matches` table, then caching the result to the `rivals` table via upsert.

**Rationale:** Manual rival designation adds friction and requires UI for managing lists. Auto-assignment surfaces the players you actually compete against most, making the rivalry feel earned rather than curated.

**Where it appears:**
- `getAutoRivals()` in `rivalService.ts` — reads `matches`, tallies opponents, sorts by game count
- Caches computed results to `rivals` table (upsert, fire-and-forget)
- `GET /api/social/rivals` returns the auto-computed list

---

## 4. Activity feed: opponent usernames included in metadata

**Decision:** Win/loss feed items include the opponent's username in `metadata` (e.g., `{ opponent: "fritz", mode: "online" }`), not just their user ID. This is denormalized at write time by the activity writer.

**Rationale:** The feed is read by many users; resolving usernames at read time would require N+1 profile queries. Writing the username at event time (when we already have it from the match context) keeps feed queries fast and simple.

**Where it appears:**
- `activityWriter.ts` — `writeMatchActivity` accepts and stores `opponentUsername` in metadata
- `ActivityFeedPanel.tsx` — reads `metadata.opponent` directly without a secondary lookup

---

## Functional regression isolation

All social system hooks are additive and fire-and-forget:

- New DB tables (`player_presence`, `activity_feed`, `rivals`) — no changes to existing tables
- New Express routes mounted at `/api/social` and `/api/profile` — existing routes unmodified
- Presence hooks in `index.ts` use `void fn().catch(() => {})` — cannot throw to game handlers
- Activity writes use `void writeActivity(...).catch(() => {})` — never block response flow
- `requireAuth` failures return early before any DB writes — no partial state

The 126 server test suite passes without modification.
