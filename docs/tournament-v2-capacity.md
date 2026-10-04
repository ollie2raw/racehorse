# Tournament v2: capacity and hosting

Phase 0, item 3. Measured 2026-10-04 on `origin/main` = `ad20db2e`.

**Short answer:** the current Render free instance (0.1 CPU, 512 MB, sleeps
when idle) can run about **one 8-player event's first round** (4 matches)
before players feel lag. It can't be relied on to start an event on time. The
**minimum for a marketed launch is a 1-CPU / 2 GB instance** (Render
`1c-2g`, "Standard"). Four things need fixing regardless of tier (§5).

---

## 1. How this was measured

`server/scripts/tournamentCapacityProbe.ts` (committed with this doc):

- Spawns the **real server** (`src/index.ts`, `NODE_ENV=production`, all
  default flags, so tournaments and the review sweep are off) with
  `SUPABASE_URL` pointed at an in-process stub that answers every request
  instantly and counts requests and bytes by path. Nothing touches a real
  Supabase project.
- Drives scripted **guest pairs through private 30-point matches** over
  socket.io. A tournament match is a reserved room on the same runtime
  (`act()`, live-session persistence, authority events, broadcasts), so per-move
  cost is the same. Tournament-only extras (match RPCs, scheduler) are a few
  requests per match, not per move.
- "Human pace" = each player waits 1.25–3.75 s (mean 2.5 s) before moving,
  which is **faster** than real dominoes play. Real load per match is lower,
  so the numbers below are conservative.
- Fractional CPUs are emulated with `server/scripts/cfsThrottle.py`. It reads the
  server's CPU time every 0.5 ms and SIGSTOPs it once it has used its quota in
  each 100 ms period, which is how Linux CFS throttles a container (`cpu.max`).
  Host: Apple M2. A Render vCPU is assumed **≈ 2× slower per thread** than an M2
  core (not measured; typical for shared cloud vCPUs). So **0.1 CPU ≈ 5 ms
  per 100 ms** on the M2 (the "pessimistic" rows), with 10 ms per 100 ms as the
  optimistic bound. Starter (0.5) ≈ 25 ms and Standard (1) ≈ 50 ms.
- 90–120 s per run, so most matches are mid-game at the end. That is the
  steady state that matters.

Limits: one laptop, the probe's clients share a process with the stub, and
the server ran from TypeScript source (tsx) rather than compiled `dist`. Treat
the numbers as ±30%. The run at 400 unthrottled matches was **probe-bound**
(the client process saturated first), so no single-core ceiling is claimed.

## 2. Results

### 2.1 Unthrottled cost per move (M2)

| Run | Actions/s | Server CPU (% of one core) | CPU per action | Peak RSS | Supabase per action |
|---|---|---|---|---|---|
| 1 match, full speed (108 actions, game over in 10 s) | 10.8 | — | 5.7 ms | 188 MB | 3.2 requests |
| 20 matches, full speed (all finished) | 77 | 22% | 2.9 ms | 333 MB | 3.2 requests, **125 KB** |
| 50 matches, human pace | 18 | 8.5% | 4.8 ms | 189 MB | 3.3 requests, 51 KB avg / 141 KB max per live-session write |
| 200 matches, human pace | 73 | 34% | 4.8 ms | 415 MB | 3.3 requests |

At 200 matches latency is already uneven (move ack p95 253 ms, p99 711 ms;
`/healthz` max 1.7 s) at only 34% CPU, so the event loop is blocked in large
synchronous chunks: JSON serialization and cloning of the full event log on
every move (§5.1), plus GC. Memory cost is **≈ 1.3 MB per live match** above an
idle ~130–150 MB.

### 2.2 Emulated Render tiers, human pace

Move ack = the time from a player's move to the server's acknowledgement.
`/healthz` = time to answer a trivial HTTP request (what UptimeRobot sees).

| Tier (emulated) | Live matches | Throttled periods | Move ack p50 / p95 / p99 | `/healthz` p95 / max | Verdict |
|---|---|---|---|---|---|
| **Free 0.1**, pessimistic | 4 | 50% | 104 / 485 / 615 ms | 764 ms / 1.8 s | noticeable lag already |
| | 8 | 84% | 316 / 1,351 / 1,733 ms | 3.7 s / 7.3 s | bad |
| | 16 | 95% | 1.5 / 3.6 / 4.4 s | timeouts (10 s) | unusable; watchdog stall alert at 32 |
| **Free 0.1**, optimistic | 8 | 31% | 9 / 225 / 773 ms | 433 ms / 1.9 s | borderline |
| | 16 | 62% | 62 / 616 / 1,039 ms | 1.7 s / 5.7 s | bad |
| | 32 | 92% | 0.7 / 1.6 / 2.0 s | 4.3 s / 6.5 s | unusable |
| **Starter 0.5** (`0.5c-512mb`) | 32 | 19% | 8 / 56 / 225 ms | 123 ms / 842 ms | good |
| | 64 | 48% | 8 / 207 / 451 ms | 388 ms / 1.9 s | acceptable |
| | 128 | 91% | 257 / 1,225 / 1,640 ms | 2.9 s / 10 s | bad |
| **Standard 1** (`1c-2g`) | 64 | 5% | 6 / 17 / 117 ms | 15 ms / 315 ms | very good |
| | 128 | 14% | 5 / 43 / 255 ms | 119 ms / 980 ms | good |

The server's own event-loop lag monitor logged warnings in **every** emulated
free-tier run, including 4 matches. At 32 matches its watchdog fired a stall
alert. In production those warnings and alerts would fire at real tournament
load.

### 2.3 What that means in tournaments

An 8-player event has at most **4 matches at once** (round 1), then 2, then 1.
A 4-player event has 2. With 3 non-overlapping events a day, tournaments alone
need 4 live matches at peak. **Everything else running at that moment adds to
it**: ranked and private live rooms, Daily Fritz verification, review jobs
when enabled.

| Tier | Comfortable live matches (p95 move ack ≲ 250 ms) | Concurrent 8-player events in round 1 (nothing else running) |
|---|---|---|
| Free 0.1 | 2–8 (pessimistic–optimistic) | **≈ 1**, and lag is visible at 4 |
| Starter 0.5 | ≈ 64 | ≈ 16, but 512 MB RAM caps it near 250 matches and leaves little headroom |
| Standard 1 / 2 GB | ≥ 128 (not saturated in this test) | ≥ 32 |

Live-session writes grow over a match (avg 51 KB, max 141 KB) because each
one re-serializes the whole event log (§5.1). Fixing that should cut CPU per
move; the table assumes no fix. (The split between game state and event log
wasn't measured; Phase 1's load test should record it.)

## 3. Supabase traffic per event (current code)

Per move: **3.2 requests**: `room_live_sessions` upsert, `mp_authority_events`
insert, `room_command_receipts` insert. A 30-point match is ~110 moves, so:

| | Requests | Bytes written |
|---|---|---|
| One match | ~350 | **~5–12 MB** (live-session row rewritten with the whole event log each move) |
| One 8-player event (7 matches) | ~2,500 | ~40–80 MB |
| 3 events a day | ~7,500 | ~120–250 MB/day |

Supabase doesn't bill ingress, but every one of those upserts rewrites a large
TOASTed `jsonb` row, so it shows up as database CPU, WAL and autovacuum load on
a small instance. The v2 scheduler itself adds almost nothing: ~1 generation RPC
a day, one small read per lifecycle wake-up, and a 30 s tick only while an
event is live (≈ 360 reads a day; design §6.3). Today's v1 tick is 2,880+ reads
a day whether or not anyone plays.

## 4. If the instance is asleep at event start

From Render's docs (fetched 2026-10-04, render.com/docs/free): a free web
service "spins down … 15 minutes without receiving any inbound traffic", and
spin-up "takes about one minute". Render "might restart a Free web service at
any time", and a workspace gets 750 free instance-hours a month (just enough
for one always-awake service).

What happens to v1 today, and to v2 without the guards:

1. Registration closes hours before, so traffic stops. 15 minutes later the
   process is stopped. **No timer fires while stopped**, so nothing starts
   the event.
2. The first request after start (a player opening the app) wakes it about a
   minute later. Boot recovery then runs the overdue work: the event starts
   late, and every join deadline starts counting from that late dispatch.
3. If nobody opens the app, the event just doesn't happen until someone does.
4. Any in-memory state is gone after a sleep or a random restart. Rooms
   recover from `room_live_sessions` and the deadlines are in the DB, so v2's
   boot catch-up (design §5.4) is what makes this survivable.

UptimeRobot (HARDENING_PLAN D-4) pings keep it awake only while that monitor is
active and keeps hitting a route. I couldn't verify from here that it still is.
v2 adds an explicit wake call one minute before each configured start (design
§6.4). On the free tier that's **required**; on a paid instance it's a backstop.

## 5. Fix regardless of tier

1. **Stop re-sending the whole event log on every move.** `buildLiveSessionRow`
   (`server/src/multiplayer/roomLivePersistence.ts`) puts `structuredClone(room.events)`
   into every upsert, so bytes per match grow with the square of its length
   (avg 51 KB, max 141 KB per write, ~11 MB per match). Persist the game state
   plus only the events since the last durable write (or cap the snapshot to
   the events hydration actually needs). This is the largest CPU, latency and
   Supabase-write lever measured here. It's a multiplayer-runtime change, so it
   needs its own PR and the restart chaos script (`npm run
   chaos:multiplayer-restart`), not a tournament PR.
2. **Wake the server for each event start** (design §6.4), and boot catch-up
   with the deadline-extension rule (design §5.4).
3. **Tournament scheduler idles at zero** (design §6.2–6.3): no 30 s tick
   between events, no 6-hourly seeding.
4. **Per-event socket rooms instead of `io.emit` to every client** (review C6).
   It doesn't matter at 4 matches, but on a marketed launch every connected
   client would receive every event's roster and bracket updates.

Not urgent but noted: the per-IP guest socket limits (10 `room:create` and 240
`game:action` a minute) key signed-out users by IP. That doesn't affect
tournaments (signed-in, keyed by user id), but it could affect guests behind
carrier NAT once there's marketing traffic.

## 6. Recommendation

| Stage | Minimum | Why |
|---|---|---|
| Real-people playtest (4–8 friends, one event) | Free tier **plus** a manual wake (open the app 5 min before) | One event = 4 live matches; lag visible but playable on the optimistic estimate |
| Launch with marketing | **Standard `1c-2g`** (1 CPU, 2 GB) | ≥ 128 live matches with p95 move ack ~43 ms in this test, no sleep, 4× the RAM headroom of Starter. Starter's 512 MB caps out under spikes and leaves no room for the review worker thread |
| If tournaments plus live multiplayer regularly exceed ~100 live matches | `2c-4g` or a second instance | A second instance needs the scheduler singleton (`TOURNAMENT_SCHEDULER_ENABLED`) and sticky sessions for in-memory rooms. That's a separate design |

Prices (recalled, **not verified**: render.com/pricing did not render for me):
Starter ≈ $7/month, Standard ≈ $25/month. Check the pricing page before
deciding.

Reproduce:

```sh
cd server
MATCHES=16 THINK_MS=2500 DURATION_S=90 THROTTLE_QUOTA_MS=5 npx tsx scripts/tournamentCapacityProbe.ts
```
