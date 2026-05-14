# Tournament Mode — Manual Smoke Test

End-to-end verification checklist. Takes ~10 minutes. Run after applying the migration whenever tournament code changes.

## Prerequisites

- Two browser windows (one normal, one incognito), each signed in as a different user.
- Local server running (`cd server && npm run dev`).
- Local client running (`cd client && npm run dev`).
- Supabase migration applied: `supabase/migrations/2026-05-14_scheduled_tournaments.sql` pasted into the SQL editor.

## 1. Verify slots seeded

In the Supabase SQL editor:

```sql
select count(*) from public.scheduled_tournaments where status = 'upcoming';
-- Expected: 360 (12 slots/day × 30 days)

select scheduled_start, registration_open_at, registration_close_at, status
  from public.scheduled_tournaments
 where status = 'upcoming'
 order by scheduled_start asc
 limit 5;
-- Expected: 5 rows showing tomorrow's slots at every 2 hours PST,
-- with open_at = start - 30 min and close_at = start - 5 min.
```

Both queries must succeed. If `count` is 0, re-run the migration.

## 2. Hub screen loads with live data

- [ ] In Browser A, click **Tournament** in the main nav.
- [ ] Verify the left panel shows the amber kicker `● Tournament`, "Compete" headline, trophy SVG, and three feature pills.
- [ ] Verify the right panel shows a `HH:MM:SS` countdown to the next slot, and three upcoming cards (each with PST time, registration count `0/8`, progress bar, status badge).
- [ ] Confirm the **Register** button on the next slot is disabled (status is `Upcoming`, not yet `Open`).

## 3. Force a tournament into registration_open

Pick a tournament that's still 30+ minutes away and force it open by backdating its `registration_open_at`:

```sql
update public.scheduled_tournaments
   set registration_open_at = now() - interval '5 minutes'
 where status = 'upcoming'
 order by scheduled_start asc
 limit 1
 returning id, scheduled_start;
-- Note the returned id — call it $T1.
```

- [ ] Within ~60 seconds (the scheduler tick), the row should flip to `status = 'registration_open'`.
- [ ] In Browser A, the corresponding card's status badge should change to a green **Open** pill and **Register** becomes clickable.

## 4. Register two users

- [ ] Click **Register** in Browser A. Card flips to `Registered ✓` + `Withdraw` + `View Bracket` ghost buttons.
- [ ] In Browser B (signed in as user 2), the same card shows `1 / 8 Registered` and a green Open badge.
- [ ] Click **Register** in Browser B. Both browsers should now show `2 / 8 Registered`.

Verify in DB:
```sql
select user_id, status from public.scheduled_tournament_registrations
 where tournament_id = '$T1';
-- Expected: 2 rows, both status='registered'.
```

## 5. Force registration close + bracket generation

Backdate `registration_close_at`:

```sql
update public.scheduled_tournaments
   set registration_close_at = now() - interval '10 seconds'
 where id = '$T1';
```

Within ~60 seconds:

- [ ] In DB: `select status from scheduled_tournaments where id = '$T1';` should be `in_progress`.
- [ ] In DB: `select round, match_number, player1_id, player2_id, status, room_code from scheduled_tournament_matches where tournament_id = '$T1' order by round, match_number;` should show **7 rows** (4 QF + 2 SF + 1 Final).
- [ ] Both registered players should have `status = 'active'` in their registration rows.
- [ ] Because only 2 players registered, the QF rows show 1 real match (between user1 and user2 if rated equal, seeded by Glicko) and 3 bye rows (`status = 'bye'`, completed automatically as walkovers).
- [ ] The 3 byes auto-advance: the top three seeds get a free pass into SF. With only 2 real players, ONE SF will be `ready` (the two players face off in SF since one is in SF1 via walkover and one is in SF2 via walkover) — verify by inspecting the SF rows.

Wait — **with 2 players the bracket structure doesn't make sense**: seeds 1 and 2 both get byes and meet in the Final. To smoke-test a full QF→SF→Final, register **at least 4** users.

> **Recommendation:** Open 4 browser windows (4 users) before this step to exercise the full bracket. With 2 users you'll just see the Final.

## 6. Join the ready match in both browsers

- [ ] In Browser A, click **Tournament** → **View Bracket** on the in-progress tournament card. Confirm the bracket renders with 4 columns (QF / SF / Final / Champion).
- [ ] Your match is highlighted with an amber border and a glow.
- [ ] At the bottom: amber banner **"Your match is ready"** with a **Join Match ›** button.
- [ ] Click **Join Match ›** in both browsers (or wait for the auto-route via `tournament:match_ready` — the in-game banner should appear automatically after the match-found flow).
- [ ] When both players land in the room, an **amber banner** appears at the top of the game screen: `Tournament · Quarterfinal · vs <opponent username> · <rating> ELO · First to 30`.
- [ ] Confirm the banner shows real opponent name + rating (NOT `null` / `—`).

## 7. Play to 30; verify advancement

- [ ] Play normally. The game uses `win_target: 30` (not 60). First player to reach 30 wins.
- [ ] On game-over, in DB: `select status, winner_id, player1_score, player2_score, completed_at from scheduled_tournament_matches where id = <your QF id>;` → status `completed`, winner_id set, scores populated.
- [ ] Loser's registration row updates to `status = 'eliminated'`.
- [ ] If this match was a QF (or you went directly to a SF due to byes), the next round's match should now show your username in one slot. The other slot waits for its winner.

## 8. Final + champion

- [ ] Complete the remaining matches until the Final ends.
- [ ] On final game-over: `tournament:completed` fires.
- [ ] The winner's browser **auto-routes to the Result screen** (`tournamentSubView === 'result'`).
- [ ] Result screen shows: amber `Tournament Complete` kicker, "Champion" label, **winner's username** (NOT `—`), and your placement (`Champion` / `Runner-up` / `Semifinalist` / `Quarterfinalist`).
- [ ] The countdown to the next scheduled tournament is displayed.
- [ ] In DB: `select status, winner_id from scheduled_tournaments where id = '$T1';` → `completed` + winner_id set.

## 9. Cancellation (separate test)

Reset one tournament back to `registration_open` with only 0–3 registrants and force `registration_close_at` backwards.

```sql
update public.scheduled_tournaments
   set status = 'registration_open',
       registration_open_at = now() - interval '10 minutes',
       registration_close_at = now() - interval '10 seconds'
 where id = '$T2';
```

- [ ] Within ~60 seconds, status should flip to `cancelled`.
- [ ] No `scheduled_tournament_matches` rows are created for that tournament.
- [ ] Registered users (if any) keep their registration rows with `status = 'registered'` (these can be ignored or cleaned up by a future op script).

## 10. Regex deletion verified (sanity)

- [ ] Search the codebase: `grep -r "T\[0-9A-Z\]+R\[123\]M" client/src/` — should return **zero** matches. The fragile regex was deleted in Phase 1; the banner now relies on `tournamentMatch` metadata supplied by the server's `room:join` ack.

## Reset between runs

To reset a single tournament for re-testing:

```sql
delete from public.scheduled_tournament_matches where tournament_id = '$T1';
delete from public.scheduled_tournament_registrations where tournament_id = '$T1';
update public.scheduled_tournaments
   set status = 'upcoming',
       winner_id = null,
       registration_open_at = scheduled_start - interval '30 minutes',
       registration_close_at = scheduled_start - interval '5 minutes'
 where id = '$T1';
```

## Quick checklist

| # | Checkpoint | DB query |
|---|---|---|
| 1 | Migration applied, 360 slots seeded | `select count(*) ... status='upcoming'` |
| 2 | Hub loads, countdown ticks | (visual) |
| 3 | Status flips to registration_open within 60s | `select status from scheduled_tournaments where id=$T1` |
| 4 | Two players can register | `select count(*) from scheduled_tournament_registrations where tournament_id=$T1` |
| 5 | Bracket auto-generates: 7 rows | `select count(*) from scheduled_tournament_matches where tournament_id=$T1` |
| 6 | Banner shows real opponent name + rating | (visual) |
| 7 | Match completes; loser eliminated; next round advances | `select status, winner_id from scheduled_tournament_matches where id=<qf>` |
| 8 | Final ends; winner=champion; auto-route to Result | (visual + `winner_id` in tournament row) |
