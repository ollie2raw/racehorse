# Casual Daily Fritz — Implementation Plan (Deferred)

**Status:** Not implemented in the Fritz difficulty product pass (2026-06-01).  
**Reason:** Requires schema, API, and leaderboard partitioning — larger than a copy-only pass.

---

## Goal

Add **Casual Daily Fritz** (`fritz_tier: standard`) alongside **Classic Daily Fritz** (`fritz_tier: elite`), with **separate leaderboards** and no score mixing.

---

## Minimum viable scope

### Database (Supabase)

- Add `track text not null default 'classic'` to `daily_fritz_runs` with check `track in ('classic', 'casual')`.
- Change unique key from `run_date` alone to **`(run_date, track)`**.
- Add `track` to `daily_fritz_attempts` (denormalized from run or FK).
- Leaderboard queries filter `track = $1`.

### Seed / deals

- Classic seed: existing `daily-fritz-{runDate}`.
- Casual seed: `daily-fritz-{runDate}:casual` (or `track` in seed string) so deals differ from Classic.

### Server (`server/src/index.ts`, `dailyFritz.ts`)

- `ensureDailyFritzRunForDate(runDate, { track, fritzTier })` — Classic → elite, Casual → standard.
- `GET /api/daily-fritz/today?track=classic|casual`
- `POST /start`, `/record-game`, `/complete`, `/leaderboard/:date` accept `track`.
- Warmup cron generates **both** tracks per date.

### Client

- Hub: two cards — **Classic Daily Fritz** (Elite, gold) and **Casual Daily Fritz** (Standard, blue).
- Separate session cache keys per track.
- `DailyFritzLeaderboardScreen` route param or query for track.

### Out of scope for v1

- Shared streak across tracks
- Adaptive routing
- Skunk rule differences on Casual (product pass 2)

---

## Estimated effort

| Area | Size |
|------|------|
| Migration + server API | Medium |
| Client hub + API client | Medium |
| LB + share card | Small |
| QA (two tracks, no cross-leak) | Medium |

**~2–3 focused days** after Classic product pass ships.

---

## Acceptance criteria

- [ ] Classic daily unchanged (Elite tier, existing LB rows migrate to `track=classic`).
- [ ] Casual daily uses Standard AI only; separate LB.
- [ ] Same calendar date can have two independent attempts (one per track).
- [ ] No attempt/completion writes cross tracks.

---

## Suggested PR sequence

1. Migration + server read paths (Classic default backward compatible).
2. Client API + Classic path regression tests.
3. Casual hub card + start/complete flow.
4. Casual leaderboard UI.
