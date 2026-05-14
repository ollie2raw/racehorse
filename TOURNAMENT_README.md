# Racehorse — Scheduled Hourly Tournaments

8-player single-elimination brackets, fully automated, running every 2 hours on a fixed PST schedule.

---

> ## ⚠ Single-instance only
>
> **This system assumes the server runs as a single process.** Each tournament-match room is reserved in-memory via `createReservedRoom()` on the process that handles the bracket generation, and `room.scheduledTournamentMatchId` lives only in that process's memory. If you scale horizontally:
>
> - Match-found routing will send both players to the same reserved room code, but only one server actually owns that room — the other player's `room:join` will fail with `Room not found`.
> - The game-over hook that calls `applyMatchResult()` reads `room.scheduledTournamentMatchId` from memory; on a non-owning process it would be `undefined` and the bracket would not advance.
>
> **Before scaling out**, persist the room → matchId mapping (use `findTournamentMatchByRoom(roomCode)` already implemented in `engine.ts`) and either (a) sticky-route all sockets for a given room to one server, or (b) move room state to Redis.

---

## Schedule

- **Timezone**: America/Los_Angeles (DST-aware).
- **Slots**: 12 AM · 2 AM · 4 AM · 6 AM · 8 AM · 10 AM · 12 PM · 2 PM · 4 PM · 6 PM · 8 PM · 10 PM (PST/PDT).
- **Registration**: opens 30 minutes before start, closes 5 minutes before start.

## Auto-reseed (always ≥ 30 days ahead)

The table stays topped up to ≥ 360 future slots automatically via **two redundant mechanisms**:

1. **pg_cron daily job** (preferred, runs in-database). Migration `2026-05-14_auto_seed_tournaments.sql` registers `seed-tournaments-daily` at `03:00` daily, which calls `public.ensure_tournament_seed_window()`. The DO block only registers the job if the `pg_cron` extension is installed; otherwise it logs a NOTICE and falls through.
2. **Server-side 24-hour fallback** (`server/src/scheduledTournament/scheduler.ts`). Every server instance calls the same RPC at boot and then every 24 hours. Multiple instances calling concurrently is safe — `seed_future_tournaments` uses `ON CONFLICT (scheduled_start) DO NOTHING`.

Both invoke the same idempotent SQL functions; running both simultaneously is harmless.

**Manual top-up** (operator):
```sql
select public.seed_future_tournaments(30);       -- inserts up to 30 days of new slots
select public.ensure_tournament_seed_window();   -- only seeds if < 360 future slots remain
```

**Verify** at any time:
```sql
select count(*) from public.scheduled_tournaments where scheduled_start > now();
-- Should always be ≥ 360.
```

## Locked rules

| Decision | Value | Reason |
|---|---|---|
| Min players to start | **4** | Top seeds get byes when 5–7 register |
| Match win target | **First to 30** | Set per-room when reserving (not global) |
| Disconnect handling | **Existing 30s reconnect window, then forfeit** | Reuses the battle-tested room reconnect system |
| Rating impact | **None — tournament results don't touch Glicko** | Recorded only in `scheduled_tournament_matches` |
| Schedule timezone | **America/Los_Angeles** | DST handled by Postgres `at time zone` |
| Tournament accent color | **Amber/orange** (`var(--accent-amber)`) | Per AGENTS.md §2 |

## How to run locally

1. **Apply the migration** (one-time):
   - Paste `supabase/migrations/2026-05-14_scheduled_tournaments.sql` into the Supabase SQL editor, OR
   - Run `supabase db push` if you have the CLI linked.
   - Verify: `select count(*) from public.scheduled_tournaments where status = 'upcoming';` → 360 rows (12 slots × 30 days).
2. **Start the server**: `cd server && npm run dev` — the scheduler boots automatically.
3. **Start the client**: `cd client && npm run dev`.
4. Sign in → click **Tournament** in the main nav.

### To force-start a tournament for testing

```sql
update public.scheduled_tournaments
   set registration_open_at = now() - interval '10 minutes',
       registration_close_at = now() - interval '5 minutes'
 where status = 'upcoming'
 order by scheduled_start asc
 limit 1;
```

The 1-minute scheduler tick will pick this up: it'll open registration, then immediately close it on the next minute and generate the bracket if ≥ 4 players are registered.

## Architecture

```
Scheduler (60s tick) ──► sets status='registration_open' ──► emits tournament:registration_open
                  └──► sets status='in_progress' ──► generateBracket()
                                                          │
                              ┌─── createReservedRoom() x7 (4 QF + 2 SF + 1 Final) ───┐
                              ▼                                                       ▼
                       insertMatch() x7                                      Room.scheduledTournamentMatchId
                              │
                              └─► emit tournament:bracket_generated + tournament:match_ready per ready QF

Players click Join Match → existing room:join socket event with the reserved code.
                              │
Match plays through the existing multiplayer pipeline (rooms.ts, broadcastStateUpdate,
state:update, hand:ended, rematch, reconnect — ALL unchanged).
                              │
On game-over: broadcastStateUpdate's IIFE detects room.scheduledTournamentMatchId
   ▶ calls applyMatchResult() → updates the match row, propagates the winner
     to the next round, fires tournament:match_updated. Skips processRealtimeMultiplayerGame.
     If Final → completeTournament() → emit tournament:completed.
```

## Files

```
server/src/scheduledTournament/
  types.ts                # shared row/event types
  bracket.ts              # pure: seedBracket() + advanceSlot()
  bracket.test.ts         # 13 unit tests (vitest, passing)
  persistence.ts          # Supabase REST wrappers
  engine.ts               # generateBracket / applyMatchResult / completeTournament / cancelTournament
  scheduler.ts            # 60s tick → openRegistration / closeRegistrationAndStart
  socketHandlers.ts       # tournament:register / withdraw / get_bracket
  routes.ts               # GET /api/tournaments/upcoming, /:id, /:id/bracket, /my; POST/DELETE /:id/register
  index.ts                # barrel + initScheduledTournaments(io, app, socket)

server/src/index.ts       # registers init in io.on('connection'); game-over hook routes
                          # tournament matches to applyMatchResult() and bypasses ranked logging
server/src/rooms.ts       # Room type adds optional scheduledTournamentMatchId + scheduledTournamentId

supabase/migrations/
  2026-05-14_scheduled_tournaments.sql  # 3 tables, indexes, RLS, 30-day slot seed

client/src/tournament/
  types.ts                              # client mirror types
  tournamentApi.ts                      # REST client (fetchUpcoming/Bracket, register/withdraw)
  useTournament.ts                      # React hook: socket subscriptions + REST polling
  TournamentHubScreen.tsx               # countdown + 3 upcoming cards
  tournamentHub.css
  TournamentBracketScreen.tsx           # 4-column bracket + "your match is ready" banner
  tournamentBracket.css
  TournamentMatchBanner.tsx             # thin amber banner over in-tournament game
  tournamentMatchBanner.css
  TournamentResultScreen.tsx            # champion display
  tournamentResult.css

client/src/App.tsx        # routes appMode='tournament' to the new hub (sub-views: hub/bracket/result)
                          # renders TournamentMatchBanner when joinedRoom matches T*R*M* pattern
```

## Tables

`scheduled_tournaments` (one row per slot, pre-seeded 30 days out):
- `id`, `scheduled_start`, `registration_open_at`, `registration_close_at`
- `status`: `upcoming` → `registration_open` → `in_progress` → `completed` | `cancelled`
- `format` (default `'7-tile'`), `win_target` (default `30`), `max_players` (default `8`)
- `winner_id` (set on completion)

`scheduled_tournament_registrations`:
- one row per (tournament_id, user_id)
- `status`: `registered` → `active` (on bracket gen) → `eliminated` | `winner`
- `seed` set when bracket generates

`scheduled_tournament_matches`:
- 7 rows per tournament (4 QF, 2 SF, 1 Final)
- `status`: `waiting` → `ready` → `in_progress` → `completed` (or `bye` if player1/player2 is null at QF time)
- `room_code`: reserved socket-io room code, format `T<short>R<round>M<num>`

**RLS:**
- All three tables readable by everyone (tournament data is public).
- Registrations writable only by the owning `auth.uid()`.
- Match writes are service-role only.

## Socket events

| Event | Direction | Payload |
|---|---|---|
| `tournament:register` | client → server | `{ tournamentId, userId }` |
| `tournament:withdraw` | client → server | `{ tournamentId, userId }` |
| `tournament:get_bracket` | client → server | `{ tournamentId }` → `{ view: BracketView }` |
| `tournament:registration_open` | server → all | `{ tournamentId }` |
| `tournament:registration_updated` | server → all | `{ tournamentId }` |
| `tournament:bracket_generated` | server → all | `{ tournamentId }` |
| `tournament:match_ready` | server → 2 sockets | `{ tournamentId, matchId, round, matchNumber, roomCode, opponent }` |
| `tournament:match_updated` | server → all | `{ tournamentId, matchId }` |
| `tournament:completed` | server → all | `{ tournamentId, winnerId }` |
| `tournament:cancelled` | server → all | `{ tournamentId }` |

Note: there is no `tournament:join_match` event — joining uses the existing `room:join` with the bracket-supplied `room_code`. There is no `tournament:match_result` event either — game results flow through the existing `state:update` game-over branch, which detects `room.scheduledTournamentMatchId` and calls `applyMatchResult()`. This keeps the new tournament code from duplicating the room/game protocol.

## REST endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/tournaments/upcoming` | Next 5 tournaments, enriched with `registered_count` |
| `GET` | `/api/tournaments/:id` | Full tournament row |
| `GET` | `/api/tournaments/:id/bracket` | `{ tournament, registrations (with username+rating), matches }` |
| `GET` | `/api/tournaments/my?userId=…` | All registrations for the user |
| `POST` | `/api/tournaments/:id/register` | Body: `{ userId }`. 409 if closed/full |
| `DELETE` | `/api/tournaments/:id/register` | Body: `{ userId }` |

## Tests

Server-side: `cd server && npx vitest run src/scheduledTournament`
- `bracket.test.ts` — 13 cases covering seeding, byes, ties, advancement routing.

## Known limitations / future work

- **Result screen** does not yet show final scores or your placement — currently displays `'—'`. Wire `useTournament().activeBracket` into it in a follow-up.
- **Match banner opponent name/rating**: the banner detects tournament rooms by code shape but does not yet inject the opponent's display name or rating. Plug `useTournament` into App.tsx and pass the data through to `TournamentMatchBanner`.
- **Legacy lobby tournament** (`server/src/tournament/`, `client/src/screens/TournamentScreen.tsx`) is preserved but unreachable through the nav. Safe to delete in a follow-up PR.
- **In-memory scheduler state**: the scheduler polls Supabase, so multi-instance deployment is safe — but the in-memory `room` state (`scheduledTournamentMatchId`) lives on a single process. Tournament rooms must be created and played on the same server instance. If you horizontally scale, route by `tournament_id` or persist `room.scheduledTournamentMatchId` lookups via `findTournamentMatchByRoom()` (already implemented in `engine.ts`).
- **Bracket image / illustration**: the trophy is inline SVG. Consider replacing with a richer SVG or sprite if branding evolves.
