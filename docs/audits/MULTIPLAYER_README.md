# Racehorse — Multiplayer & Matchmaking

How to run, test, and reason about the head-to-head matchmaking queue.

## Architecture

```
Client (React)                Server (Node + Socket.io)            Supabase
──────────────                ─────────────────────────            ─────────
MatchmakingScreen ──emit─►    queue:join  →  QueueService
                                              │
                                              └──tick(1s)──► findPairs()
                                                                  │
                              queue:matched ◄──io.to()────────────┘
                                  │
                                  └──► createReservedRoom()
                                              │
                                              └─► recordMatchStart() ──► matchmaking_matches
                                                                              (in_progress)

(after countdown)
AutoJoin           ──room:join──► joinRoom() ──► auto-start hook ──► startGame()
                                                                       │
Game state         ◄──state:update─ broadcastStateUpdate() ────────────┘

Game over         ◄──state:update─ broadcastStateUpdate()
                                  │
                                  └─► recordMatchEnd() ─────────► matchmaking_matches
                                                                    (completed)
                                  └─► processRealtimeMultiplayerGame()  → ratings update
```

## Run locally

1. **Apply the migration** (one-time):
   - Open `supabase/migrations/2026-05-13_matchmaking.sql` and paste it into the Supabase SQL editor, OR
   - Run `supabase db push` if you have the Supabase CLI linked to this project.

2. **Start the server**:
   ```bash
   cd server && npm run dev
   ```

3. **Start the client**:
   ```bash
   cd client && npm run dev
   ```

4. **Sign in** as any user → click **Multiplayer** → press **Find Match**.

## What you should see

| State | UI | What's happening |
|---|---|---|
| Idle | Big "Find Match" button + online count badge | Connected, awaiting click |
| Searching | Pulsing rings + elapsed timer (M:SS) | Server sweeping the queue every 1s |
| Match Found | Full-screen overlay, opponent name+rating, 3-2-1 countdown | Server emitted `queue:matched` |
| In Match | Existing shared-board game screen | Server auto-started the game |
| Post Match | Existing game-over UI; "Back" returns to MatchmakingScreen | Existing rating pipeline ran |
| Timeout (90s) | "Search again" (no bot bridge) | Server emitted `queue:timeout` |

## Quick match policy

- **Humans only**: synthetic queue seats (`sim:…` IDs, `Bot (sim)` display name, or `isSim`) are rejected on `queue:join` and purged every queue tick so they cannot pair with a real player.

## ELO window expansion

| Waited | Half-width |
|---|---|
| 0 – 30 s | ±100 |
| 30 – 60 s | ±200 |
| 60 – 90 s | ±300 |
| 90 s + | unbounded (also fires the timeout fallback) |

See `server/src/matchmaking/pairing.ts`. The pure-function pairing algorithm has unit tests in `pairing.test.ts`.

Set `MATCHMAKING_DEBUG=1` on the server to log each successful queue join (and rejections) plus every candidate evaluation in `findPairs` (verbose; turn off after diagnosing).

## Multi-instance deployments

The queue is **in-memory in one Node process**. If you run more than one Socket.io server behind a load balancer without sticky sessions (or a shared adapter plus a centralized queue), two players can both be “searching” on **different** instances — they never appear in the same `findPairs` sweep and will hit the 90s timeout. Mitigations: sticky sessions to one instance, or Redis / Supabase-backed queue coordination with `@socket.io/redis-adapter`.

## Two-real-player local testing

```bash
MATCHMAKING_DEV_MODE=0 NODE_ENV=production npm run dev   # server
npm run dev                                              # client
```

Open two browser windows (one normal, one incognito), sign in as different users. Both press *Find Match*. Within 1–2 seconds, both see the Match Found overlay and are redirected into the same reserved room (code prefix `MM`).

## Cancel and re-queue

Pressing **Cancel** during searching emits `queue:leave` and immediately returns the UI to Idle. The user can `Find Match` again right away.

A disconnect (closed tab / network drop) auto-leaves the queue via the `socket.on('disconnect')` handler — no stale entries.

## Match disconnect handling

Inside a match, the **existing 30-second reconnect window** (`server/src/rooms.ts`, `client/src/multiplayer/useMultiplayerConnection.ts`) applies. Matchmaking adds no new disconnect logic — it just funnels into the battle-tested room system. If a player fully drops out, the existing forfeit flow runs and `recordMatchEnd` is called with the normal `winnerSocketId` resolution.

## Database tables

`matchmaking_matches` — row per H2H match (non-sim only).

| Column | Notes |
|---|---|
| `id` | UUID; set client-side at row insert so we can attach it to the in-memory room |
| `room_code` | reserved socket-io room code (prefix `MM`) |
| `player_a_id`, `player_b_id` | `auth.users.id` |
| `player_a_rating`, `player_b_rating` | Glicko snapshot at match start |
| `status` | `in_progress` → `completed` / `abandoned` / `forfeit` |
| `winner_id` | filled on game-over |
| `player_a_rating_change`, `player_b_rating_change` | ELO delta from `processRealtimeMultiplayerGame` |
| `is_sim` | `true` if either side was a sim bot (currently always `false` for inserted rows — sim matches are skipped) |
| `started_at`, `ended_at` |  |

RLS: a user can SELECT only rows where they were a participant.

`profiles.glicko_rating` is read at queue-join time via the service role (see `fetchPlayerRating` in `server/src/matchmaking/index.ts`).

## Files added

```
server/src/matchmaking/
   types.ts              shared type definitions
   pairing.ts            pure pairing algorithm + ratingWindowMsAt
   pairing.test.ts       10 unit tests (vitest, passing)
   queueService.ts       in-memory queue + 1s sweep
   queueService.test.ts  9 unit tests (vitest, passing)
   persistence.ts        recordMatchStart / recordMatchEnd
   simBot.ts             sim opponent move loop
   index.ts              socket handler module

client/src/matchmaking/
   types.ts              client mirror types
   useMatchmaking.ts     React hook around queue:* socket events
   OnlineCountBadge.tsx
   MatchFoundOverlay.tsx
   matchFoundOverlay.css
   MatchmakingScreen.tsx 5-state screen
   matchmakingScreen.css

supabase/migrations/
   2026-05-13_matchmaking.sql

MULTIPLAYER_README.md   (this file)
```

## Files touched

```
server/src/index.ts     +import registerMatchmakingHandlers/recordMatchEnd/startSimOpponentLoop
                        +call to registerMatchmakingHandlers in connection handler
                        +auto-start hook at end of room:join success path
                        +recordMatchEnd in game-over branch after processRealtimeMultiplayerGame

server/src/rooms.ts     +three optional fields on Room: matchmakingMatchId / matchmakingIsSim
                                                       / matchmakingSimSocketId

client/src/App.tsx      +import MatchmakingScreen
                        +mpSubView state ('quick' | 'private')
                        +handleMatchmakingAutoJoin callback
                        +wrap PrivateMatchLobbyScreen render in sub-view toggle
```

## Known limitations / future work

- Queue state is in-memory on a single server process; see **Multi-instance deployments** above.
- The sim bot is intentionally random, not heuristic. Wire `client/src/bot/botHeuristics` into the server if you want smarter bots.
- "Opponent disconnected" forfeit handling reuses the existing room reconnect window. Matchmaking adds no new behavior here — verified during integration testing.
- Sim matches don't write to `matchmaking_matches` because their userIds aren't in `auth.users`. If we ever want sim history, we'd add a synthetic `sim_user_id` row or relax the FK.
